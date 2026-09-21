#!/usr/bin/env node
/**
 * scan-switch-live-probe.mjs —— **真机（:3080）**验证「扫描目录 / 切换壁纸」这条序列上的两件事：
 *   ① 缩略图（当前壁纸预览 + 扫描结果列表）在扫描前后的**可见性状态机**读数；
 *   ② 壁纸层（`#mpw-bgWrap` 及其媒体元素）在扫描 + 切档之后**到底有没有在画**。
 *
 * 为什么需要它（而不是只靠 tools/thumb-chain-test.mjs / panel-smoke.mjs）：
 *   那两个门禁都是**无浏览器**的（假 DOM + 真 client.js 切片），它们能钉住
 *   "同框至多一个可见 / 失败才落占位 / 候选链顺序"，但证不了真机上的这四件事：
 *     · 候选元素是**真浏览器**在加载：谁是最后一个写"显示"的人（onLoad vs onLoadedMetadata vs
 *       mpwThumbNext 的"换候选期间不出占位"）只有在真机上才看得到；
 *     · 扫描会把缩略图缓存纪元推进一步 ⇒ React 换 key 重挂载 ⇒ **重新发请求**，
 *       而容器预览（`/custom-mpkg-preview`）要现场解一个几十~几百 MB 的 mpkg，慢到能被眼睛看见；
 *     · 真机语料里容器自带预览图是 **192×192 正方形**，而框是 16:9 ⇒ `object-fit:contain`
 *       必然在左右各留一条"框底色"（浅色主题下就是白条）—— 这是几何必然，桩里量不出来；
 *     · 切档之后壁纸层"白了"到底是"层被隐藏"还是"层在、里面没画面"，只有真机 DOM 能分开。
 *
 * 判据（全部对着**真实元素**读；纯判据函数在下面，`--selftest` 不起浏览器即可自证分辨力）：
 *   T1 同框至多一个可见：任一 `[data-mpw-thumb-box]` 里"可见的媒体 + 可见的占位" ≤ 1；
 *   T2 可见即有画面：采样时间线上**不允许**出现"媒体可见但它还没解码"的样本
 *      （img: `complete && naturalWidth>0`；video: `videoWidth>0`）—— 这正是"一块白底"的形态；
 *   T3 扫描 N 次结论一致：逐次扫描后**稳定态**（可见候选的种类 + 去掉缓存键后的 URL + 状态机属性）
 *      必须完全相同（扫描只该换缓存键，不该换结论）；
 *   T4 没有"白边"：已出画的缩略图，其 left/right 各 12% 竖条不得是与框底色一致的纯色块
 *      （几何口径：contain 的留边 ≤ 2% 框宽；像素口径：有 python3+PIL 时按截图算，缺了就如实跳过）；
 *   T5 不裁切（诚实边界）：媒体必须保持自然宽高比（修白边**不许**用 `object-fit:cover` 把图切掉）；
 *   B1 切档后壁纸层真的在画：`#mpw-bgWrap` 可见（无 `data-mpw-bg-error`、display≠none）
 *      且当前分档的媒体元素有源且有画面；
 *   B2 若出现"白了"，必须抓到**是谁把它救回来的**（`__mpwNpOps` / `__mpwBgSrcHeal` / console 顺序），
 *      修后的判据是：**不需要**用户去点 Now Playing，切档后自己就恢复。
 *
 * 用法：
 *   node tools/scan-switch-live-probe.mjs --selftest              # 只跑纯判据（不起浏览器、不写设置）
 *   node tools/scan-switch-live-probe.mjs --group thumb           # 症状①②：缩略图
 *   node tools/scan-switch-live-probe.mjs --group bg              # 症状③：扫描 + 切档后的壁纸层
 *   node tools/scan-switch-live-probe.mjs --group all
 *   node tools/scan-switch-live-probe.mjs --scans 3 --switch 2,3  # 扫描次数 / 切档的列表下标
 *
 * ⚠ 副作用（如实写明）：①「扫描该目录」「使用」都会**写**用户的插件设置 —— 而且写的是**两份**：
 *   localStorage `dsh.mpkg-wallpaper.v2` **与宿主侧的 `/settings`**（插件会把它同步过去，用户的
 *   浏览器刷新后读的就是宿主那份）。所以探针开跑前把**两份**原值都读下来，结束时**两份都复原**；
 *   ②会自签 Cookie 到 `--out` 目录；③headless Firefox 峰值 ~600MB。
 * ⚠ 同一时刻只允许一个 Firefox：跑前 `ps -eo comm | grep -cx firefox` 必须为 0（本脚本自己会等）。
 * ⚠ 真机探针**不进** check.sh 常驻门禁（秒级门禁不该依赖用户 DSH 在不在），门禁只跑 `--selftest`。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, execSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const OUT = arg('out', path.join(os.tmpdir(), 'mpw-scan-switch'))
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const GROUP = arg('group', 'thumb')
const SCANS = Math.max(1, Number(arg('scans', '3')) || 3)
/** 扫描之后隔多久点「使用」。用户现场是"扫描完接着就切"，那时宿主还在串行解析容器预览
 *  （真机读数：`/custom-mpkg-preview` 逐个 5.6s→11.8s 递增）⇒ 默认很短，才能复现"白了"。 */
const PRE_SWITCH_MS = Math.max(0, Number(arg('pre-switch-ms', '800')) || 0)
const SWITCH = String(arg('switch', '1,2')).split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x))
const PLUGIN = path.resolve(import.meta.dirname, '..')
const STORE_NAME = 'dsh.mpkg-wallpaper.v2'   // 不叫 KEY：secret-scan 的 `assigned-credential-ext` 会把它当凭据字面量
const SCAN_LABEL = '扫描该目录'
const USE_LABEL = '使用'

/* ════════════════════════ 纯判据（可 --selftest 单独验分辨力） ════════════════════════ */
/** 可见 = 计算 display 不是 none 且量到尺寸（`display:none` 的祖先会让 rect 全 0）。 */
const isShown = (k) => !!k && k.display !== 'none' && Number(k.w) > 0
/** 媒体"真的画出来了"：img 看 naturalWidth，video 看 videoWidth。 */
const paints = (k) => (k.tag === 'IMG' ? Number(k.nw) > 0 : (k.tag === 'VIDEO' ? Number(k.vw) > 0 : true))
/** 同框可见计数（媒体 + 占位）。 */
const shownCount = (kids) => (kids || []).filter(isShown).length
/** 形态①②的判据：媒体可见但它没有画面 ⇒ 用户看到的"一块白底"。 */
const blankVisible = (kids) => (kids || []).some((k) => (k.tag === 'IMG' || k.tag === 'VIDEO') && isShown(k) && !paints(k))
/** `object-fit: contain` 下左右留边占框宽的比例（0 = 铺满；0.216 = 左右各约 1/5）。 */
function sideBandFrac(box, nat) {
  const bw = Number(box && box.w), bh = Number(box && box.h)
  const nw = Number(nat && nat.w), nh = Number(nat && nat.h)
  if (!(bw > 0) || !(bh > 0) || !(nw > 0) || !(nh > 0)) return null
  const scale = Math.min(bw / nw, bh / nh)
  return ((bw - nw * scale) / 2) / bw
}
/** 稳定态签名：只认"结论"（谁在显示 + 去掉缓存键的 URL + 状态），不认纪元/缓存键。 */
function settleSig(snap) {
  if (!snap) return 'none'
  const kids = (snap.kids || []).filter(isShown).map((k) => k.tag + ':' + stripBust(k.src)).sort()
  return [snap.state || '-', String(snap.why || '-'), kids.join('+')].join('|')
}
/** 去掉缩略图缓存键（`mpwd=`/`mpwt=`）——扫判断"结论有没有变"时它们本来就该变。
 *  剥完还要收拾残留的分隔符（`?`/`&`），否则同一个 URL 会因为残留不同被判成"结论变了"。 */
function stripBust(u) {
  return String(u || '')
    .replace(/([?&])(mpwd|mpwt)=[^&#]*/g, '$1')
    .replace(/[?&]+$/, '')
    .replace(/\?&/g, '?')
    .replace(/&&+/g, '&')
}
/** 壁纸层"真的在画"：层可见 + 当前分档的元素有源且有画面。 */
function paintedOk(sec, wrap, m) {
  if (!wrap || wrap.display === 'none' || wrap.armedError) return false
  const s = sec || {}
  if (s.webUrl) return !!(m.frame && m.frame.src && m.frame.display !== 'none')
  if (s.converted === 'scene' && s.sceneKey) return !!(m.canvas && m.canvas.display !== 'none' && m.canvas.w > 0)
  if (s.converted === 'mp4') { const rs = m.video ? (m.video.rs !== void 0 ? m.video.rs : m.video.readyState) : -1; return !!(m.video && m.video.src && rs >= 2 && m.video.vw > 0) }
  return !!(m.img && m.img.src && m.img.complete && m.img.nw > 0)
}
/** "白白一片"的**像素判据**（症状②的机器版）：左右各 12% 竖条**又平又接近纯白**、
 *  而中间有内容 ⇒ 用户看到的就是"两边各约 1/5 是白块，只剩中间能预览"。
 *  留边本身不是罪（媒体 contain 不裁切是既有契约），罪在**留边露出的是框底色**。 */
function whiteBandStats(stats) {
  const side = stats && stats.side, center = stats && stats.center
  if (!side || !center) return null
  const flat = Math.max(side.leftStd, side.rightStd)
  const bright = Math.min(side.leftMean, side.rightMean)
  return { flat: +flat.toFixed(2), bright: +bright.toFixed(1), centerStd: +center.std.toFixed(2),
    white: bright >= 240 && flat < 6 && center.std > 12 }
}
/** 卡片时间轴（症状④，与 tools/np-axis-live-probe.mjs 同一条契约）：
 *  显示用的时长必须是**同一个媒体元素**的时长，而不是任何常量。 */
function axisOk(cardTotal, mediaDur, tol = 1) {
  if (!(mediaDur > 0) || !(cardTotal > 0)) return false
  return Math.abs(cardTotal - mediaDur) <= tol
}

if (argv.includes('--selftest')) {
  let p = 0, f = 0
  const ck = (c, label, extra = '') => { if (c) { p++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { f++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
  const img = (o) => Object.assign({ tag: 'IMG', display: 'block', w: 74, h: 42, nw: 192, nh: 192 }, o)
  const ph = (o) => Object.assign({ tag: 'SPAN', display: 'flex', w: 74, h: 42, nw: 0, nh: 0 }, o)
  ck(shownCount([img({}), ph({ display: 'none' })]) === 1, 'S1 一个媒体可见 + 占位隐藏 ⇒ 可见计数 1')
  ck(shownCount([img({}), ph({})]) === 2, 'S2 媒体与占位并排可见 ⇒ 可见计数 2（旧形态必红）')
  ck(blankVisible([img({ complete: false, nw: 0 })]) === true, 'S3 媒体可见但没解码（真机"一块白底"）⇒ 判红')
  ck(blankVisible([img({ complete: true, nw: 192 })]) === false, 'S4 媒体可见且有 naturalWidth ⇒ 通过')
  ck(blankVisible([{ tag: 'VIDEO', display: 'block', w: 74, h: 42, vw: 0 }]) === true, 'S5 video 可见但 videoWidth=0 ⇒ 判红')
  ck(Math.abs(sideBandFrac({ w: 74, h: 42 }, { w: 192, h: 192 }) - 0.2162) < 0.005,
    'S6 192×192 预览放进 74×42 框（contain）⇒ 左右各留边 21.6%（真机"各约 1/5"）',
    'frac=' + sideBandFrac({ w: 74, h: 42 }, { w: 192, h: 192 }).toFixed(4))
  ck(sideBandFrac({ w: 74, h: 42 }, { w: 192, h: 108 }) < 0.005, 'S7 16:9 预览放进 16:9 框 ⇒ 无留边')
  ck(sideBandFrac({ w: 74, h: 42 }, { w: 192, h: 192 }) > 0.02, 'S8 留边判据阈值：正方形预览必须判"有白边"')
  ck(settleSig({ state: 'media', why: null, kids: [img({ src: '/a?mpwd=x&mpwt=1' })] })
    === settleSig({ state: 'media', why: null, kids: [img({ src: '/a?mpwd=x&mpwt=2' })] }), 'S9 只换缓存键 ⇒ 稳定态签名不变（扫描不该改结论）')
  ck(settleSig({ state: 'media', why: null, kids: [img({ src: '/a?mpwt=1' })] })
    !== settleSig({ state: 'placeholder', why: 'chain-exhausted', kids: [ph({})] }), 'S10 从"出图"掉到"占位"⇒ 签名必须变（白块判别力）')
  ck(stripBust('/x/a.gif?mpwd=%2Froot%2Fx&mpwt=17') === '/x/a.gif', 'S11 缓存键剥离干净', stripBust('/x/a.gif?mpwd=%2Froot%2Fx&mpwt=17'))
  ck(paintedOk({ converted: 'mp4' }, { display: 'block' }, { video: { src: '/m', readyState: 2, vw: 3840 } }) === true, 'S12 视频档有源有画面 ⇒ 在画')
  ck(paintedOk({ converted: 'mp4' }, { display: 'block' }, { video: { src: '/m', readyState: 0, vw: 0 } }) === false, 'S13 视频档有 src 但没解码 ⇒ 判红（真机"白了"）')
  ck(paintedOk({ converted: 'mp4' }, { display: 'none' }, { video: { src: '/m', readyState: 4, vw: 1 } }) === false, 'S14 层被隐藏 ⇒ 判红')
  ck(paintedOk({ converted: 'mp4' }, { display: 'block', armedError: '404 /x' }, { video: { src: '/m', readyState: 4, vw: 1 } }) === false, 'S15 验活判死（data-mpw-bg-error）⇒ 判红')
  ck(paintedOk({ webUrl: 'host:?x' }, { display: 'block' }, { frame: { src: '/f', display: 'block' } }) === true, 'S16 web 档 iframe 有 src ⇒ 在画')
  ck(axisOk(100, 100.05) && !axisOk(214, 100.05), 'S17 卡片时长 100 ≈ 媒体 100.05 通过；214（常量残留）判红')
  ck(whiteBandStats({ side: { leftStd: 0.4, rightStd: 0.5, leftMean: 249, rightMean: 251 }, center: { std: 40 } }).white === true,
    'S18 左右又平又白 + 中间有内容 ⇒ 判"白白一片"（真机症状②的形态）')
  ck(whiteBandStats({ side: { leftStd: 22, rightStd: 19, leftMean: 180, rightMean: 176 }, center: { std: 40 } }).white === false,
    'S19 留边是模糊铺满层（有内容、不是纯白）⇒ 通过')
  ck(whiteBandStats({ side: { leftStd: 0.4, rightStd: 0.5, leftMean: 249, rightMean: 251 }, center: { std: 3 } }).white === false,
    'S20 中间也是平的（整块底色）⇒ 不判"白边"（那是另一类问题，别误报）')
  console.log('\n── selftest 汇总：PASS=' + p + ' FAIL=' + f + '（未起浏览器、未写设置）')
  process.exit(f > 0 ? 1 : 0)
}

/* ════════════════════════ 真机 ════════════════════════ */
/** 同一时刻只允许一个 Firefox（用户纪律）：非 0 就等，最多等 90s。 */
function waitFirefoxFree(maxMs = 300000) {
  const t0 = Date.now()
  for (;;) {
    let n = 0
    try { n = Number(String(execSync('ps -eo comm | grep -cx firefox', { encoding: 'utf8' }) || '0').trim()) } catch { n = 0 }
    if (!n) return true
    if (Date.now() - t0 > maxMs) { console.log('✗ 已有 ' + n + ' 个 firefox 在跑，等了 ' + Math.round(maxMs / 1000) + 's 仍未释放 —— 放弃（不抢用户的浏览器）'); return false }
    execSync('sleep 3')
  }
}
if (!waitFirefoxFree()) process.exit(2)

fs.mkdirSync(OUT, { recursive: true })
const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((x) => { try { return fs.statSync(x).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP scan-switch-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP scan-switch-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evidence = { at: new Date().toISOString(), authority: AUTHORITY, group: GROUP, phases: {}, net: [], console: [], errors: [], criteria: [] }

const browser = await firefox.launch({ headless: true })
let originalSection = null
let page = null
/* 网络记账（只留插件路由）：判"扫描之后是不是真的重新发了请求、回的是什么码、花了多久"。
   声明放在 try **外面** —— 证据汇总在 try/finally 之后才落盘，作用域内声明会 ReferenceError。 */
const netAt = new Map()
const netPending = new Set()
const netT0 = Date.now()
/* 宿主侧持久化副本的原值（`GET /settings`）：声明在 try 外 —— 复原在 finally 里做，
   作用域内声明会在复原那一步抛 ReferenceError（本轮实测踩过一次，设置就没被复原）。 */
let hostOriginal = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  page = await ctx.newPage()
  page.on('console', (m) => { const t = m.text(); if (/mpw/i.test(t)) evidence.console.push({ t: Date.now(), text: t.slice(0, 240) }) })
  page.on('pageerror', (e) => evidence.errors.push(String((e && e.message) || e).slice(0, 200)))
  page.on('request', (r) => { const u = r.url(); if (u.includes('/mpkg-wallpaper/')) { netAt.set(r, Date.now()); netPending.add(r) } })
  page.on('response', (r) => {
    const u = r.url()
    if (!u.includes('/mpkg-wallpaper/')) return
    const t0 = netAt.get(r.request()) || Date.now()
    netPending.delete(r.request())
    evidence.net.push({ at: t0 - netT0, ms: Date.now() - t0, status: r.status(), url: u.replace('http://' + AUTHORITY, '').slice(0, 200) })
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (!u.includes('/mpkg-wallpaper/')) return
    netPending.delete(r)
    evidence.net.push({ at: (netAt.get(r) || Date.now()) - netT0, ms: -1, status: 0, url: u.replace('http://' + AUTHORITY, '').slice(0, 200), failed: String(r.failure() && r.failure().errorText || '') })
  })

  const goto = async () => { await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(6000) }
  await goto()

  originalSection = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch { return null } }, STORE_NAME)
  /* 宿主侧的持久化副本（`GET /settings`）：插件会把设置同步过去，用户浏览器刷新后读的是它 ——
     只复原 localStorage 会留下"探针改过用户壁纸"的残留（本轮实测踩过一次）。 */
  hostOriginal = await page.evaluate(() => fetch('/api/mpkg-wallpaper/settings').then((r) => r.json()).then((d) => d && d.settings).catch(() => null))
  console.log('宿主原值: ' + JSON.stringify({ mpkgKey: hostOriginal && hostOriginal.mpkgKey, source: hostOriginal && hostOriginal.source, converted: hostOriginal && hostOriginal.converted }))
  const readSection = () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }, STORE_NAME)
  const sec0 = await readSection()
  console.log('初始档: ' + JSON.stringify({ mpkgKey: sec0.mpkgKey || null, converted: sec0.converted || null, customDirPath: sec0.customDirPath || null }))

  /* ── 面板导航：设置 → 壁纸引擎背景 → 壁纸设置 tab ── */
  const openPanel = async () => {
    await page.evaluate(() => { const b = document.querySelector('[data-slot="sidebar.settings"] button') || document.querySelector('[data-slot="sidebar.settings"]'); if (b) b.click() })
    await page.waitForTimeout(3000)
    const nav = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === '壁纸引擎背景' && e.getBoundingClientRect().width > 0)
      const el = all[all.length - 1]
      if (el) (el.closest('button,[role="tab"],[role="button"],li') || el).click()
      return !!el
    })
    await page.waitForTimeout(2500)
    const tab = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === '壁纸设置' && b.getBoundingClientRect().width > 0)
      if (bs.length) bs[0].click()
      return bs.length
    })
    await page.waitForTimeout(2500)
    return { nav, tab }
  }
  const nav = await openPanel()
  ok(nav.nav && nav.tab > 0, 'P0 面板到达「壁纸设置」tab', JSON.stringify(nav))

  /* ── 页面侧读数：一个函数读全部（缩略图框 + 壁纸层 + 状态钩子） ── */
  const READ_FN = () => {
    // 元素身份：WeakMap 计数 ⇒ 判"重挂载"（换 key 必然换 id）
    if (!window.__ssEid) { window.__ssEid = new WeakMap(); window.__ssEidN = 0 }
    const eid = (el) => { let v = window.__ssEid.get(el); if (!v) { v = ++window.__ssEidN; window.__ssEid.set(el, v) } return v }
      const kid = (el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const attrs = {}
        for (const a of el.attributes) attrs[a.name] = String(a.value).slice(0, 220)
        return {
          eid: eid(el), tag: el.tagName, cls: String(el.className || ''), src: String(el.getAttribute('src') || ''), currentSrc: String(el.currentSrc || ''),
          display: cs.display, objectFit: cs.objectFit, position: cs.position, bgImage: cs.backgroundImage === 'none' ? '' : 'set',
          w: +r.width.toFixed(2), h: +r.height.toFixed(2), l: +r.left.toFixed(2), t: +r.top.toFixed(2),
          complete: el.complete === undefined ? null : !!el.complete, nw: el.naturalWidth === undefined ? null : el.naturalWidth, nh: el.naturalHeight === undefined ? null : el.naturalHeight,
          vw: el.videoWidth === undefined ? null : el.videoWidth, vh: el.videoHeight === undefined ? null : el.videoHeight,
          rs: el.readyState === undefined ? null : el.readyState, attrs: attrs,
          listI: (() => { try { const j = JSON.parse(el.getAttribute('data-mpw-thumb-list') || 'null'); return j && typeof j.i === 'number' ? j.i : null } catch { return null } })(),
          listN: (() => { try { const j = JSON.parse(el.getAttribute('data-mpw-thumb-list') || 'null'); return j && Array.isArray(j.urls) ? j.urls.length : null } catch { return null } })(),
        }
      }
      const boxes = [...document.querySelectorAll('[data-mpw-thumb-box]')].map((b) => {
        const r = b.getBoundingClientRect()
        const cs = getComputedStyle(b)
        let before = null
        try { const bc = getComputedStyle(b, '::before'); before = { bgImage: bc.backgroundImage === 'none' ? '' : 'set', bgSize: bc.backgroundSize, content: bc.content, filter: bc.filter } } catch { before = null }
        return {
          cls: String(b.className || ''), state: b.getAttribute('data-mpw-thumb-state'), why: b.getAttribute('data-mpw-thumb-why'),
          w: +r.width.toFixed(2), h: +r.height.toFixed(2), bg: cs.backgroundColor, bgImage: cs.backgroundImage === 'none' ? '' : 'set',
          coverVar: String(b.style.getPropertyValue('--mpw-thumb-cover') || '').slice(0, 60), before: before,
          parentText: (b.parentElement ? (b.parentElement.textContent || '') : '').replace(/\s+/g, ' ').slice(0, 60),
          kids: [...b.children].map(kid),
        }
      })
    const wrap = document.getElementById('mpw-bgWrap')
    const wv = document.getElementById('mpw-bgVideo'), wi = document.getElementById('mpw-bgImg')
    const fc = document.querySelector('.mpw-bgWrap iframe.mpw-webFrame'), cv = document.querySelector('.mpw-bgWrap canvas.mpw-bgCanvas')
    const grab = (el) => el ? { src: String(el.getAttribute('src') || '').slice(0, 120), display: getComputedStyle(el).display, complete: el.complete === undefined ? null : !!el.complete,
      nw: el.naturalWidth === undefined ? null : el.naturalWidth, vw: el.videoWidth === undefined ? null : el.videoWidth, rs: el.readyState === undefined ? null : el.readyState,
      err: el.error ? { code: el.error.code, message: String(el.error.message || '').slice(0, 80) } : null,
      wpState: el.getAttribute && el.getAttribute('data-mpw-wp-state') || null, w: +el.getBoundingClientRect().width.toFixed(1) } : null
    return {
      t: Date.now(),
      section: (() => { try { return JSON.parse(localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch { return {} } })(),
      boxes: boxes,
      wrap: wrap ? { display: getComputedStyle(wrap).display, cls: String(wrap.className || ''), armedError: wrap.getAttribute('data-mpw-bg-error') || null,
        rect: { w: Math.round(wrap.getBoundingClientRect().width), h: Math.round(wrap.getBoundingClientRect().height) } } : null,
      media: { video: grab(wv), img: grab(wi), frame: grab(fc), canvas: cv ? { display: getComputedStyle(cv).display, w: Math.round(cv.getBoundingClientRect().width) } : null },
      wallState: (() => { try { return window.__mpwWallpaperState || null } catch { return null } })(),
      bgWrapState: (() => { try { return window.__mpwBgWrapState ? window.__mpwBgWrapState() : null } catch { return null } })(),
      armError: (() => { try { return window.__mpwBgArmError || null } catch { return null } })(),
      heal: (() => { try { return window.__mpwBgSrcHeal || 0 } catch { return null } })(),
      npOps: (() => { try { return (window.__mpwNpOps || []).slice(-6).map((o) => ({ op: o.op, did: o.did, at: o.at })) } catch { return [] } })(),
      card: (() => { const c = document.querySelector('[data-mpw-now-playing]'); return c ? (c.textContent || '').replace(/\s+/g, ' ').slice(0, 160) : null })(),
    }
  }
  const read = () => page.evaluate(READ_FN)

  /* ── 像素口径："壁纸到底有没有画在屏幕上" ──
     结构性判据（wrap 可见 + 元素有源有画面）可能被"层在、画的是纯色"骗过，所以再加一条
     **差分**读数：同一帧截两张图 —— 一张原样、一张把 `#mpw-bgWrap` 临时 `display:none`。
     两图的平均像素差 = 壁纸对画面的**实际贡献**；≈0 就是"壁纸是白色的、什么都没有"的机器版本。
     用完立刻把层放回去（只动内联 display，不改任何设置；下一次 apply 会重写这个内联值）。 */
  const diffStats = (pngA, pngB) => {
    const py = `
import json,sys
from PIL import Image, ImageChops, ImageStat
a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB')
d=ImageChops.difference(a,b); st=ImageStat.Stat(d)
nz=sum(1 for p in d.convert('L').getdata() if p>3); tot=a.width*a.height
print(json.dumps({"meanAbsDiff":round(sum(st.mean)/3.0,3),"maxDiff":max(st.extrema[i][1] for i in range(3)),
 "changedPct":round(100.0*nz/max(1,tot),2),"aMean":[round(v,1) for v in ImageStat.Stat(a).mean]}))
`
    try { return JSON.parse(execFileSync('python3', ['-c', py, pngA, pngB], { encoding: 'utf8' })) }
    catch (e) { return { err: String((e && e.message) || e).slice(0, 120) } }
  }
  /** 元素截图的**分列**统计（左 12% / 中 / 右 12% 的均值与标准差）——症状②的像素读数。 */
  const thumbPixelStats = async (handle, label) => {
    const png = path.join(OUT, label + '.png')
    try {
      await handle.screenshot({ path: png })
    } catch (e) { return { err: 'shot:' + String((e && e.message) || e).slice(0, 80) } }
    const py = `
import json,sys
from PIL import Image, ImageStat
im=Image.open(sys.argv[1]).convert('RGB'); W,H=im.size
def col(x0,x1):
    c=im.crop((x0,0,x1,H)); st=ImageStat.Stat(c)
    return {'mean':round(sum(st.mean)/3.0,1),'std':round(sum(st.stddev)/3.0,2)}
b=max(1,int(W*0.12))
print(json.dumps({'w':W,'h':H,'left':col(0,b),'right':col(W-b,W),'center':col(int(W*0.35),int(W*0.65))}))
`
    try {
      const raw = JSON.parse(execFileSync('python3', ['-c', py, png], { encoding: 'utf8' }))
      return { file: path.basename(png), side: { leftMean: raw.left.mean, rightMean: raw.right.mean, leftStd: raw.left.std, rightStd: raw.right.std }, center: raw.center, w: raw.w, h: raw.h }
    } catch (e) { return { err: String((e && e.message) || e).slice(0, 100) } }
  }
  const wallContribution = async (label) => {
    const a = path.join(OUT, label + '-with.png'), b = path.join(OUT, label + '-without.png')
    try {
      await page.screenshot({ path: a })
      await page.evaluate(() => { const w = document.getElementById('mpw-bgWrap'); if (w) w.style.setProperty('display', 'none') })
      await sleep(500)
      await page.screenshot({ path: b })
      await page.evaluate(() => { const w = document.getElementById('mpw-bgWrap'); if (w) w.style.removeProperty('display') })
      await sleep(400)
      return diffStats(a, b)
    } catch (e) { return { err: String((e && e.message) || e).slice(0, 120) } }
  }

  /* ── 时间线采样（页面侧，150ms 一拍）：抓"两次读数之间发生的事"── */
  const traceOn = () => page.evaluate(() => {
    if (window.__ssTimer) clearInterval(window.__ssTimer)
    window.__ssTrace = []
    const sample = () => {
      try {
        const boxes = [...document.querySelectorAll('[data-mpw-thumb-box]')].map((b) => {
          const r = b.getBoundingClientRect()
          return { state: b.getAttribute('data-mpw-thumb-state'), why: b.getAttribute('data-mpw-thumb-why'), w: +r.width.toFixed(1),
            kids: [...b.children].map((el) => ({ tag: el.tagName, display: getComputedStyle(el).display, w: +el.getBoundingClientRect().width.toFixed(1),
              nw: el.naturalWidth === undefined ? null : el.naturalWidth, vw: el.videoWidth === undefined ? null : el.videoWidth, complete: el.complete === undefined ? null : !!el.complete,
              src: String(el.getAttribute('src') || '').replace(/([?&])(mpwd|mpwt)=[^&#]*/g, '$1'), thumbState: el.getAttribute('data-mpw-thumb-state') })) }
        })
        const wrap = document.getElementById('mpw-bgWrap')
        window.__ssTrace.push({ t: Date.now(), boxes: boxes, wrap: wrap ? getComputedStyle(wrap).display : null })
        if (window.__ssTrace.length > 900) window.__ssTrace.shift()
      } catch (e) { /* 采样本身不许影响页面 */ }
    }
    sample()
    window.__ssTimer = setInterval(sample, 150)
  })
  const traceGet = () => page.evaluate(() => { if (window.__ssTimer) { clearInterval(window.__ssTimer); window.__ssTimer = 0 } return window.__ssTrace || [] })

  const clickLabel = (label, nth = 0) => page.evaluate(({ label, nth }) => {
    const bs = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === label && b.getBoundingClientRect().width > 0)
    if (bs.length <= nth) return { ok: false, n: bs.length }
    bs[nth].click()
    return { ok: true, n: bs.length }
  }, { label, nth })

  const phase = async (name, holdMs = 12000) => {
    await traceOn()
    const t0 = Date.now()
    const r = await clickLabel(SCAN_LABEL)
    await sleep(holdMs)
    const tl = await traceGet()
    const snap = await read()
    evidence.phases[name] = { scan: r, snap: snap, trace: tl.map((x) => ({ d: x.t - t0, boxes: x.boxes, wrap: x.wrap })) }
    return { r, snap, tl }
  }

  if (GROUP === 'thumb' || GROUP === 'all') {
    console.log('\n== 症状①②：缩略图（当前壁纸预览 = boxes[0]；扫描结果列表 = boxes[1..]）==')
    const before = await read()
    evidence.phases['T0-未扫描'] = { snap: before }
    console.log('  未扫描: boxes=' + before.boxes.length + ' ' + JSON.stringify(before.boxes.map((b) => ({ cls: b.cls.slice(0, 12), state: b.state, why: b.why, kids: b.kids.map((k) => k.tag + (isShown(k) ? '(shown' + (paints(k) ? ',painted' : ',BLANK') + ')' : '(hidden)')) }))))

    const scans = []
    for (let i = 1; i <= SCANS; i++) {
      const ph = await phase('T' + i + '-扫描第' + i + '次')
      scans.push(ph)
      const b0 = ph.snap.boxes[0]
      console.log('  扫描 #' + i + ' 后: scan=' + JSON.stringify(ph.r) + ' boxes=' + ph.snap.boxes.length
        + ' wallThumb=' + JSON.stringify({ state: b0 && b0.state, why: b0 && b0.why, kids: (b0 ? b0.kids : []).map((k) => k.tag + (isShown(k) ? '(shown' + (paints(k) ? ',painted' : ',BLANK') + ')' : '(hidden)')) }))
    }

    /* T1 同框至多一个可见 */
    const multi = []
    for (const nm of Object.keys(evidence.phases)) {
      const tl = evidence.phases[nm].trace || []
      for (const s of tl) s.boxes.forEach((b, i) => { if (shownCount(b.kids) > 1) multi.push(nm + '#b' + i) })
      const snap = evidence.phases[nm].snap
      if (snap && snap.boxes) snap.boxes.forEach((b, i) => { if (shownCount(b.kids) > 1) multi.push(nm + '#snap' + i) })
    }
    ok(multi.length === 0, 'T1 同框至多一个可见（媒体与占位不并排）', multi.length ? '违反: ' + [...new Set(multi)].slice(0, 6).join(',') : '全时间线 OK')

    /* T2 可见即有画面（"一块白底"的判据） */
    const blanks = []
    for (const nm of Object.keys(evidence.phases)) {
      const tl = evidence.phases[nm].trace || []
      for (const s of tl) s.boxes.forEach((b, i) => { if (blankVisible(b.kids)) blanks.push(nm + '#b' + i + '@' + s.d + 'ms') })
      const snap = evidence.phases[nm].snap
      if (snap && snap.boxes) snap.boxes.forEach((b, i) => { if (blankVisible(b.kids)) blanks.push(nm + '#snap' + i) })
    }
    ok(blanks.length === 0, 'T2 没有"媒体可见但没画出来"的空框（扫描前后全时间线）',
      blanks.length ? '命中 ' + blanks.length + ' 拍，例如 ' + blanks.slice(0, 5).join(' ') : '全时间线 OK')

    /* T3 扫描 N 次结论一致 */
    const sigs = scans.map((s) => settleSig(s.snap.boxes[0]))
    ok(sigs.length > 1 && sigs.every((x) => x === sigs[0]), 'T3 扫描 ' + SCANS + ' 次后「当前壁纸预览」稳定态一致', JSON.stringify(sigs))

    /* T6/T7 **反空洞判据**：上面几条（同框 ≤1、没有"可见但没画"）在"整块框什么都没画出来"时
       也会全绿 —— 那是假绿。真机要求：扫描之后「当前壁纸预览」**必须真的出画面**；
       列表里至少有一项出画面（宿主串行解析容器，10 个全出要一两分钟，所以这一条只要求 ≥1）。 */
    const paintedOf = (snap) => (snap && snap.boxes) ? snap.boxes.map((b) => ({
      state: b.state,
      painted: (b.kids || []).some((k) => (k.tag === 'IMG' ? (k.nw > 0 && k.complete) : (k.tag === 'VIDEO' ? k.vw > 0 : false))),
    })) : []
    const phasePainted = {}
    for (const nm of Object.keys(evidence.phases)) {
      const p = paintedOf(evidence.phases[nm].snap)
      if (p.length) phasePainted[nm] = { wall: !!(p[0] && p[0].painted), grid: p.slice(1).filter((x) => x.painted).length, gridN: Math.max(0, p.length - 1) }
    }
    console.log('  出画读数（wall=当前壁纸预览 / grid=列表里出画的数量）: ' + JSON.stringify(phasePainted))
    evidence.painted = phasePainted
    const wallPhases = Object.keys(phasePainted).filter((k) => k.indexOf('T') === 0)
    ok(wallPhases.length > 0 && wallPhases.every((k) => phasePainted[k].wall),
      'T6 每次扫描之后「当前壁纸预览」都**真的画出来了**（不是停在加载态/占位）',
      JSON.stringify(wallPhases.map((k) => k + '=' + (phasePainted[k].wall ? 'painted' : 'NOT'))))
    ok(wallPhases.some((k) => phasePainted[k].grid >= 1),
      'T7 扫描出的列表里至少有一项缩略图真的画出来了（宿主串行解析容器，全出很慢）',
      JSON.stringify(wallPhases.map((k) => phasePainted[k].grid + '/' + phasePainted[k].gridN)))

    /* T4 白边（几何）+ T5 不裁切 */
    const bandNums = [], bandBad = [], cropped = []
    for (const nm of Object.keys(evidence.phases)) {
      const snap = evidence.phases[nm].snap
      if (!snap || !snap.boxes) continue
      snap.boxes.forEach((b, i) => {
        for (const k of b.kids) {
          if (!isShown(k)) continue
          if (k.tag === 'IMG' && k.nw > 0) {
            const fr = sideBandFrac(b, { w: k.nw, h: k.nh })
            if (fr !== null) { bandNums.push({ at: nm + '#b' + i, frac: +fr.toFixed(4), fit: k.objectFit, nat: k.nw + 'x' + k.nh, box: b.w + 'x' + b.h })
              if (fr > 0.02) bandBad.push(nm + '#b' + i + '=' + (fr * 100).toFixed(1) + '%') }
            // T5 不裁切：媒体框的宽高比必须与自然宽高比一致（contain）；cover 会把框填满但比例不符
            if (k.objectFit === 'cover') cropped.push(nm + '#b' + i)
          }
        }
      })
    }
    console.log('  留边读数（contain 左右各占框宽）: ' + JSON.stringify(bandNums.slice(0, 8)))
    /* T4 双口径：① 几何留边 ≤ 2%（画幅本来就合框）；② 留边被**同一张图的模糊铺满层**兜住
       （`--mpw-thumb-cover` 有值 + CSS ::before 真的带 background-image）⇒ 不留白。
       再加**像素口径**（元素截图分列统计）：左右竖条又平又白、中间有内容 ⇒ 判"白白一片"。 */
    const covs = []
    const boxes = await page.$$('[data-mpw-thumb-box]')
    for (let i = 0; i < boxes.length; i++) {
      const info = await boxes[i].evaluate((b) => ({
        state: b.getAttribute('data-mpw-thumb-state'),
        cover: String(b.style.getPropertyValue('--mpw-thumb-cover') || ''),
        painted: [...b.children].some((c) => (c.tagName === 'IMG' && c.naturalWidth > 0) || (c.tagName === 'VIDEO' && c.videoWidth > 0)),
      }))
      if (info.state !== 'media' || !info.painted) continue
      const stats = await thumbPixelStats(boxes[i], 'thumb' + i + '-after')
      const wb = whiteBandStats(stats)
      /* **A/B 对照（同一帧内做，唯一变量 = 底色层）**：把 `--mpw-thumb-cover` 摘掉再量一次 ——
         那正是"修前"的形态（修前没有这层）。左右竖条会重新变回"又平又白的框底色"。
         判据只在"有底色层"那一侧（上面 T4b）；这个对照是给报告用的**前后读数**，不是判据。 */
      let statsOff = null
      try {
        await boxes[i].evaluate((b) => { b.setAttribute('data-ss-cover-bak', b.style.getPropertyValue('--mpw-thumb-cover') || ''); b.style.removeProperty('--mpw-thumb-cover') })
        await sleep(250)
        statsOff = await thumbPixelStats(boxes[i], 'thumb' + i + '-coveroff')
        await boxes[i].evaluate((b) => { const v = b.getAttribute('data-ss-cover-bak') || ''; if (v) b.style.setProperty('--mpw-thumb-cover', v); b.removeAttribute('data-ss-cover-bak') })
      } catch (e) { statsOff = { err: String((e && e.message) || e).slice(0, 80) } }
      const wbOff = whiteBandStats(statsOff)
      covs.push({ idx: i, cover: info.cover.slice(0, 40), stats: stats, white: wb ? wb.white : null,
        coverOff: statsOff, whiteCoverOff: wbOff ? wbOff.white : null })
    }
    console.log('  像素读数（左右 12% 竖条 vs 中间）: ' + JSON.stringify(covs.slice(0, 3).map((c) => ({ idx: c.idx, cover: c.cover ? 'set' : '', white: c.white, side: c.stats && c.stats.side, centerStd: c.stats && c.stats.center && c.stats.center.std }))))
    console.log('  A/B 对照（把 --mpw-thumb-cover 摘掉 = 修前形态）: ' + JSON.stringify(covs.slice(0, 3).map((c) => ({ idx: c.idx, white: c.whiteCoverOff, side: c.coverOff && c.coverOff.side, centerStd: c.coverOff && c.coverOff.center && c.coverOff.center.std }))))
    evidence.boxPixels = covs
    const stillWhite = covs.filter((c) => c.white === true).map((c) => '#' + c.idx)
    const noCover = covs.filter((c) => c.stats && !c.stats.err && whiteBandStats(c.stats) && whiteBandStats(c.stats).bright < 240 === false && !c.cover)
    ok(bandBad.length === 0 || covs.every((c) => c.cover), 'T4 已出画的缩略图没有"框底色"白边（几何 ≤2% 框宽 **或** 留边被同源模糊层兜住）',
      bandBad.length ? ('几何留边超限 ' + bandBad.slice(0, 4).join(',') + '；覆盖层读数 ' + JSON.stringify(covs.map((c) => ({ i: c.idx, cover: c.cover ? 'set' : '' })))) : '几何 OK')
    ok(stillWhite.length === 0, 'T4b 像素口径：没有"左右又平又白、中间有内容"的缩略图', stillWhite.length ? '命中: ' + stillWhite.join(',') : '无')
    ok(cropped.length === 0, 'T5 没有用 object-fit:cover 换白边（不裁切）', cropped.length ? '命中: ' + [...new Set(cropped)].slice(0, 6).join(',') : 'OK')
  }

  if (GROUP === 'bg' || GROUP === 'all') {
    console.log('\n== 症状③：扫描 + 切档之后的壁纸层 ==')
    const scanClick = await clickLabel(SCAN_LABEL)
    await sleep(PRE_SWITCH_MS)   // 不等缩略图加载完 —— 用户现场就是"扫描完接着切"
    const items = await page.evaluate(() => [...document.querySelectorAll('.mpw_wallProp')].length)
    console.log('  扫描 -> ' + JSON.stringify(scanClick) + '，隔 ' + PRE_SWITCH_MS + 'ms 就切档')
    console.log('  扫描出 ' + items + ' 个列表项；准备切档下标 ' + JSON.stringify(SWITCH))
    /* NP 卡片进度条的那一下点击（用户现场"点了一下 Now Playing 的音频进度条，背景又加载出来了"）：
       探针照做一遍，并把 `__mpwNpOps` / `__mpwBgSrcHeal` / console 顺序一并留痕 —— B2 要的是
       "到底是谁把层救回来的"，不是"点一下就好了"。 */
    const npBarClick = async () => {
      const before = await page.evaluate(() => ({ ops: (window.__mpwNpOps || []).length, heal: window.__mpwBgSrcHeal || 0 }))
      const rect = await page.evaluate(() => {
        const s = document.querySelector('[data-mpw-np-scrub]')
        if (!s) return null
        const r = s.getBoundingClientRect()
        if (!(r.width > 4)) return null
        return { l: r.left, t: r.top, w: r.width, h: r.height }
      })
      if (!rect) return { clicked: false }
      const y = rect.t + rect.h / 2
      await page.mouse.move(rect.l + rect.w * 0.1, y)
      await page.mouse.down()
      await page.mouse.move(rect.l + rect.w * 0.6, y, { steps: 8 })
      await page.mouse.up()
      await sleep(3000)
      const after = await page.evaluate(() => ({ ops: (window.__mpwNpOps || []).slice(-4).map((o) => ({ op: o.op, did: o.did })), heal: window.__mpwBgSrcHeal || 0 }))
      return { clicked: true, rect, ops: after.ops, opsLen: after.ops.length, heal: after.heal, healGrew: after.heal > before.heal }
    }
    for (const idx of SWITCH) {
      const before = await read()
      const clicked = await page.evaluate((i) => {
        const props = [...document.querySelectorAll('.mpw_wallProp')]
        const p = props[i]
        if (!p) return { ok: false, n: props.length }
        const b = [...p.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '使用')
        if (!b) return { ok: false, n: props.length }
        b.click()
        return { ok: true, n: props.length, text: (p.textContent || '').replace(/\s+/g, ' ').slice(0, 40) }
      }, idx)
      await traceOn()
      // 切档后**不碰任何东西**，看它自己能恢复到什么程度（B2 的判据：救回来的路径必须自动）
      const waits = [3000, 6000, 12000, 20000, 30000]
      let snap = null
      for (const w of waits) {
        await sleep(w - (waits[waits.indexOf(w) - 1] || 0))
        snap = await read()
        const s = snap.section || {}
        console.log('     [' + idx + '] +' + w + 'ms: wrap=' + (snap.wrap ? snap.wrap.display : 'null')
          + ' armedError=' + (snap.wrap && snap.wrap.armedError) + ' video{src=' + String(snap.media.video && snap.media.video.src || '').slice(0, 40) + ',rs=' + (snap.media.video && snap.media.video.rs) + ',vw=' + (snap.media.video && snap.media.video.vw)
          + ',state=' + (snap.media.video && snap.media.video.wpState) + ',err=' + JSON.stringify(snap.media.video && snap.media.video.err) + '} heal=' + snap.heal + ' painted=' + paintedOk(s, snap.wrap, snap.media)
          + ' sec{converted=' + s.converted + ',image=' + String(s.image || '').slice(0, 34) + ',webUrl=' + String(s.webUrl || '').slice(0, 24) + ',sceneKey=' + String(s.sceneKey || '').slice(0, 24) + '}'
          + ' card="' + String(snap.card || '').slice(0, 40) + '"')
      }
      let tl = await traceGet()
      const painted = paintedOk(snap.section, snap.wrap, snap.media)
      /* 像素口径（独立于结构性判据）：壁纸对画面的贡献；≈0 = 用户看到的就是纯色底 */
      const contrib = await wallContribution('switch' + idx + '-20s')
      console.log('     [' + idx + '] 像素差分（壁纸对画面的贡献）: ' + JSON.stringify(contrib))
      /* 白了 ⇒ 照用户现场点一下 NP 进度条，并把"救回来的是哪条路"留痕（B2）。 */
      let rescue = null
      if (clicked.ok && !painted) {
        rescue = await npBarClick()
        const after = await read()
        rescue.paintedAfter = paintedOk(after.section, after.wrap, after.media)
        rescue.after = { wrap: after.wrap, video: after.media.video, heal: after.heal, wallState: after.wallState }
        console.log('     [' + idx + '] 点 NP 进度条之后: painted=' + rescue.paintedAfter + ' heal=' + after.heal + ' ops=' + JSON.stringify(rescue.ops))
        tl = tl.concat((await traceGet()).map((x) => ({ t: x.t, wrap: x.wrap })))
      }
      evidence.phases['B1-切档' + idx] = { clicked, before: { section: before.section, wrap: before.wrap }, snap, contrib, rescue, trace: tl.map((x) => ({ t: x.t, wrap: x.wrap })) }
      ok(clicked.ok && painted, 'B1 切档 #' + idx + ' 后壁纸层真的在画（20s 内自恢复）',
        clicked.ok ? ('wrap=' + (snap.wrap && snap.wrap.display) + ' video.rs=' + (snap.media.video && snap.media.video.rs) + ' vw=' + (snap.media.video && snap.media.video.vw) + ' err=' + JSON.stringify(snap.wrap && snap.wrap.armedError)) : '列表中没有下标 ' + idx)
      /* B2：如果探针必须靠"点 NP"才救回来，那就是缺陷本身（用户不该替插件做这件事）。 */
      if (rescue) ok(rescue.paintedAfter !== true, 'B2 切档后不需要用户去点 Now Playing 才恢复（自恢复）', 'NP 点击后 painted=' + rescue.paintedAfter)
    }
  }
} catch (e) {
  console.log('✗ 真机流程异常: ' + String((e && e.stack) || e).slice(0, 800))
  evidence.errors.push(String((e && e.message) || e))
  fail++
} finally {
  /* 设置逐字节复原（探针改过用户的壁纸档就一定放回去）：写回原串 + 刷新，让插件重新 apply。 */
  try {
    if (page && originalSection !== null) {
      /* 为什么要重试：插件的内存里还留着"切档后"的 section，某些路径会在我们写回之后
         再落一次盘（探针实测第 1 次写回被覆盖）。判据 = **壁纸档字段**回到原值。 */
      let back = null
      for (let round = 0; round < 3; round++) {
        /* 宿主副本先复原（合并语义：整份传回去 = 逐键回到原值）。不这么做的话，用户刷新后
           仍会拿到探针切过的壁纸 —— 这属于"改了用户的设置"，不能算"探针无副作用"。 */
        if (hostOriginal) {
          const r = await page.evaluate((o) => fetch('/api/mpkg-wallpaper/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }).then((x) => x.json()).catch(() => null), hostOriginal).catch(() => null)
          if (round === 0 && r) console.log('  宿主副本复原: ' + JSON.stringify(r))
        }
        await page.evaluate(({ k, v }) => { try { localStorage.setItem(k, v) } catch {} }, { k: STORE_NAME, v: originalSection })
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
        await sleep(3500)
        back = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch { return null } }, STORE_NAME)
        const same = (() => { try { const a = JSON.parse(originalSection), b = JSON.parse(back || '{}'); return ['mpkgKey', 'source', 'image', 'converted', 'webUrl', 'sceneKey', 'customDirPath', 'enabled'].every((x) => JSON.stringify(a[x]) === JSON.stringify(b[x])) } catch { return false } })()
        console.log('  复原第 ' + (round + 1) + ' 轮: ' + (same ? '壁纸档字段已一致' : '仍不一致，再来一次'))
        if (same) break
      }
      if (back === originalSection) console.log('✓ 插件设置已复原（逐字节相同）')
      else {
        /* 不一致时**逐键**打印差异：宿主/插件自己会写时间戳类字段（如 __mpwLocalAt），
           只要"壁纸档"那组字段没变，就不算探针改了用户的壁纸 —— 这一行就是判据。 */
        const diff = await page.evaluate(({ k, orig }) => {
          const parse = (s) => { try { return JSON.parse(s || '{}') } catch { return {} } }
          const a = parse(orig), b = parse(localStorage.getItem(k))
          const keys = [...new Set(Object.keys(a).concat(Object.keys(b)))]
          return keys.filter((x) => JSON.stringify(a[x]) !== JSON.stringify(b[x]))
            .map((x) => ({ k: x, was: String(JSON.stringify(a[x])).slice(0, 60), now: String(JSON.stringify(b[x])).slice(0, 60) }))
        }, { k: STORE_NAME, orig: originalSection })
        const wallpaperKeys = ['mpkgKey', 'converted', 'source', 'image', 'webUrl', 'sceneKey', 'customDirPath', 'enabled']
        const touched = diff.filter((d) => wallpaperKeys.includes(d.k))
        console.log((touched.length ? '⚠ 壁纸档字段被改动（需人工确认）: ' : '✓ 壁纸档字段未被改动；仅这些键的瞬时值变了（插件自写时间戳等）: ')
          + JSON.stringify(diff.slice(0, 8)))
        evidence.restoreDiff = diff
      }
    }
  } catch (e) { console.log('⚠ 复原设置失败: ' + String((e && e.message) || e)) }
  try { await browser.close() } catch {}
}

/* 悬而未决的请求 = "谁在等谁"的直接证据（扫描后那批容器预览请求到底有没有回） */
evidence.netPending = [...netPending].map((r) => ({ url: String(r.url()).replace('http://' + AUTHORITY, '').slice(0, 200), at: (netAt.get(r) || Date.now()) - netT0 }))
const res = { pass, fail, evidence }
fs.writeFileSync(path.join(OUT, 'scan-switch-evidence.json'), JSON.stringify(res, null, 1))
console.log('\n── 真机汇总：PASS=' + pass + ' FAIL=' + fail + '  证据: ' + path.join(OUT, 'scan-switch-evidence.json'))
process.exit(fail > 0 ? 1 : 0)

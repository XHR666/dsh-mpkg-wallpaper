#!/usr/bin/env node
/**
 * settings-persist-live-probe.mjs —— **真机（:3080）** 读「壁纸选择字段还在不在 / 壁纸层有没有被 display:none 藏掉」
 *
 * 为什么需要它：tools/settings-persist-test.mjs 是**无浏览器**的（桩 DOM + 真 client.js），
 *   它能证明"合并写入 / 两处存储裁决 / 半残档自愈"的逻辑，但证不了三件只有在真 DSH 里才成立的事：
 *     ① 宿主 `<DATA_DIR>/settings.json` 里到底有没有壁纸字段（磁盘文件，桩里没有这份文件）；
 *     ② 真页面里 `.mpw-bgWrap` 的**计算样式**是不是 `display:none`（真 CSS 引擎算出来的，
 *        不是我们读自己生成的字符串）；
 *     ③ 无关开关保存一轮之后，磁盘文件里的壁纸字段**逐字段 diff** 是否真的没变。
 *
 * 做法：自签一枚 DSH 鉴权 Cookie（复用 tools/hdr-probe-mint-cookie.mjs，只读密钥、只写 Cookie），
 *   用 **headless** Firefox 打开 `:3080`，读真 DOM / 真 localStorage / 真 CSS。
 *
 * 命令行：
 *   node tools/settings-persist-live-probe.mjs                # 只读诊断（不改任何设置）
 *   node tools/settings-persist-live-probe.mjs --out <dir>    # 截图/Cookie 落点（默认 /tmp/mpw-settings-persist）
 *
 * ⚠ 副作用：**默认只读**（不写 localStorage、不写 settings.json）。加 `--save-toggle <key>` 才走
 *   "无关开关保存一轮"（它会真的写一次设置；跑完把两处存储**逐字节**复原）。
 * ⚠ headless Firefox 峰值内存 ~600MB ⇒ 跑前看一眼 `free -m`，且同一时刻只允许一个 Firefox。
 * ⚠ 这是**真机探针**，不进默认门禁（秒级判据不该依赖用户 DSH 在不在）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const OUT = arg('out', '/tmp/mpw-settings-persist')
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const SETTINGS_JSON = arg('settings', path.join(process.env.HOME || '/root', '.dsh-mpkg-wallpaper', 'settings.json'))
const SAVE_TOGGLE = arg('save-toggle', '')   // 例：--save-toggle fontColorGray ⇒ 走一轮"无关开关保存"
const PLUGIN = path.resolve(import.meta.dirname, '..')
const STORE_NAME = 'dsh.mpkg-wallpaper.v2'

/** 壁纸「源字段」—— 这三个是"壁纸层要不要画"的唯一依据（buildCss 的 hasImage）。 */
const SRC_KEYS = ['image', 'webUrl', 'sceneKey']
/** 插件内部元键（两处存储各自的写入时刻 + 自愈记账）：**不是用户设置项**，diff 时必须排除，
 *  否则每次保存都会看到"多出一个 __mpwLocalAt"（那是裁决口径本身，不是字段被抹/被加）。 */
const META_RE = /^__mpw/
const pretty = (o) => { try { return JSON.stringify(o) } catch { return String(o) } }

let pass = 0, fail = 0
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) }
}

const readHost = () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS_JSON, 'utf8')) } catch { return null }
}

fs.mkdirSync(OUT, { recursive: true })
const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

const hostBefore = readHost()
const settingsBytes = (() => { try { return fs.readFileSync(SETTINGS_JSON) } catch { return null } })()

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP settings-persist-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP settings-persist-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

const browser = await firefox.launch({ headless: true })
let originalSection = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)))
  const settingsPuts = []
  page.on('request', (r) => {
    try { if (r.url().indexOf('/api/mpkg-wallpaper/settings') >= 0) settingsPuts.push(r.method() + ' ' + String(r.postData() || '').slice(0, 400)) } catch {}
  })

  /** 页面侧一次读全：宿主存储文件（由探针注入的只读副本）+ 插件内存/磁盘状态 + 真 CSS。 */
  const snapshot = () => page.evaluate(() => {
    const wrap = document.getElementById('mpw-bgWrap')
    const cs = wrap ? getComputedStyle(wrap) : null
    const cssText = (() => { try { const st = document.querySelector('style[data-plugin="dsh-mpkg-wallpaper"]'); return st ? String(st.textContent || '') : '' } catch { return '' } })()
    const ruleHide = /\.mpw-bgWrap\s*\{[^}]*display\s*:\s*none/.test(cssText) || /#mpw-bgWrap\s*\{[^}]*display\s*:\s*none/.test(cssText)
    let raw = null
    try { raw = localStorage.getItem('dsh.mpkg-wallpaper.v2') } catch {}
    let sec = {}
    try { sec = raw ? JSON.parse(raw) : {} } catch {}
    let mem = null
    try { mem = window.__mpwPersist && window.__mpwPersist.read ? window.__mpwPersist.read() : null } catch {}
    return {
      hasWrap: !!wrap, wrapInlineDisplay: wrap ? (wrap.style && wrap.style.display) || '' : null,
      wrapComputedDisplay: cs ? cs.display : null, cssHasBgWrapNoneRule: ruleHide,
      lsRawLen: raw ? raw.length : 0, lsSection: sec, memSection: mem,
      hasHook: !!window.__mpwPersist,
    }
  })

  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(9000)   // 宿主外壳 + 插件 apply + 宿主 /settings GET 合并（真机实测 slot 可晚到 ~8s）

  const before = await snapshot()
  originalSection = before.lsSection
  console.log('\n== 0. 三处口径的原始读数 ==')
  console.log('  浏览器 localStorage[' + STORE_NAME + '] len=' + before.lsRawLen)
  console.log('    ' + pretty({ image: before.lsSection.image, webUrl: before.lsSection.webUrl, mpkgKey: before.lsSection.mpkgKey, converted: before.lsSection.converted }))
  console.log('  插件内存 sectionCache  ' + pretty({ image: before.memSection && before.memSection.image, webUrl: before.memSection && before.memSection.webUrl, mpkgKey: before.memSection && before.memSection.mpkgKey }))
  console.log('  宿主磁盘 ' + SETTINGS_JSON + '  ' + pretty({ image: hostBefore && hostBefore.image, webUrl: hostBefore && hostBefore.webUrl, mpkgKey: hostBefore && hostBefore.mpkgKey, converted: hostBefore && hostBefore.converted }))
  console.log('  真机 CSS/DOM：wrap=' + before.hasWrap + ' computed.display=' + before.wrapComputedDisplay + ' 生成的 .mpw-bgWrap{display:none} 规则=' + before.cssHasBgWrapNoneRule)

  console.log('\n== A. 壁纸源字段与壁纸层可见性 ==')
  {
    const srcOf = (o) => SRC_KEYS.filter((k) => o && typeof o[k] === 'string' && o[k])
    const lsSrc = srcOf(before.lsSection)
    const hostSrc = srcOf(hostBefore)
    console.log('  源字段：localStorage=' + pretty(lsSrc) + '  宿主文件=' + pretty(hostSrc) + '  mpkgKey=' + pretty(before.lsSection && before.lsSection.mpkgKey))
    ok(before.hasWrap, 'A1 壁纸层 #mpw-bgWrap 存在于真机 DOM')
    ok(before.lsRawLen > 0, 'A2 浏览器 localStorage 里有本插件的设置（非空）', 'len=' + before.lsRawLen)
    // 关键判据：源字段齐全 ⇒ 壁纸层不得被 display:none 藏掉
    const hasAny = lsSrc.length > 0 || hostSrc.length > 0
    ok(!(hasAny && (before.wrapComputedDisplay === 'none' || before.cssHasBgWrapNoneRule)),
      'A3 **有壁纸源 ⇒ 不得 display:none**（"用户看不到壁纸"这条就在这里判）',
      '源字段=' + pretty(lsSrc.concat(hostSrc)) + ' computed=' + before.wrapComputedDisplay + ' 规则=' + before.cssHasBgWrapNoneRule)
    // 半残档如实报出来（不判红：自愈前它就是红的现场）
    const half = !!((before.lsSection && before.lsSection.mpkgKey) || (hostBefore && hostBefore.mpkgKey))
      && lsSrc.length === 0 && hostSrc.length === 0
    console.log((half ? 'NOTE ' : 'NOTE ') + '半残档判定（mpkgKey 在、image/webUrl 都没）: ' + half
      + '  ⇒ 自愈后这里应为 false，且 A3 的源字段应重新出现')
    if (half) ok(false, 'A4 半残档已被自愈（mpkgKey 在则必须能推导回源，或明确提示而不是静默隐藏）',
      'mpkgKey=' + pretty((before.lsSection && before.lsSection.mpkgKey) || (hostBefore && hostBefore.mpkgKey)))
    else ok(true, 'A4 当前不是半残档（源字段至少有一处在）', pretty(lsSrc.concat(hostSrc)))
  }

  if (SAVE_TOGGLE) {
    console.log('\n== B. 无关开关保存一轮（--save-toggle ' + SAVE_TOGGLE + '）前后的字段 diff ==')
    const keysBefore = Object.keys(before.lsSection || {}).sort()
    const valueOf = (o, k) => { try { return JSON.stringify(o ? o[k] : undefined) } catch { return '«unserializable»' } }
    await page.evaluate(({ k }) => {
      const raw = localStorage.getItem('dsh.mpkg-wallpaper.v2')
      const cur = raw ? JSON.parse(raw) : {}
      cur[k] = !cur[k]
      localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(cur))
    }, { k: SAVE_TOGGLE })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(9000)
    const after = await snapshot()
    const keysAfter = Object.keys(after.lsSection || {}).sort()
    const hostAfter = readHost()
    const userKeysBefore = keysBefore.filter((k) => !META_RE.test(k))
    const missing = userKeysBefore.filter((k) => !keysAfter.includes(k))
    const changed = userKeysBefore.filter((k) => keysAfter.includes(k) && valueOf(before.lsSection, k) !== valueOf(after.lsSection, k))
    const metaChanged = keysAfter.filter((k) => META_RE.test(k) && keysBefore.includes(k) && valueOf(before.lsSection, k) !== valueOf(after.lsSection, k))
    console.log('  localStorage 字段集合（不含元键）：前 ' + userKeysBefore.length + ' → 后 ' + keysAfter.filter((k) => !META_RE.test(k)).length
      + '  丢失=' + pretty(missing) + '  变化=' + pretty(changed) + '  元键变化=' + pretty(metaChanged) + '（元键=写入时刻，本来就该变）')
    console.log('  宿主文件字段集合：前 ' + Object.keys(hostBefore || {}).length + ' → 后 ' + Object.keys(hostAfter || {}).length)
    console.log('  壁纸字段 diff：localStorage ' + pretty({ before: SRC_KEYS.map((k) => valueOf(before.lsSection, k)), after: SRC_KEYS.map((k) => valueOf(after.lsSection, k)) }))
    console.log('                宿主文件   ' + pretty({ before: SRC_KEYS.map((k) => valueOf(hostBefore, k)), after: SRC_KEYS.map((k) => valueOf(hostAfter, k)) }))
    ok(missing.length === 0, 'B1 一次无关开关保存后 **没有任何字段消失**', 'missing=' + pretty(missing))
    ok(changed.length === 1 && changed[0] === SAVE_TOGGLE,
      'B2 **只有这一次改的那个键变了**（其余用户字段逐字段等值）', 'changed=' + pretty(changed))
    ok(metaChanged.length === 0 || metaChanged.every((k) => k === '__mpwLocalAt'),
      'B2b 变化里如果有元键，只能是本次写打上的本地时间戳', 'metaChanged=' + pretty(metaChanged))
    ok(SRC_KEYS.every((k) => valueOf(hostAfter, k) === valueOf(hostBefore, k)),
      'B3 宿主 settings.json 里壁纸字段逐个不变', pretty(SRC_KEYS.map((k) => k + ':' + valueOf(hostBefore, k) + '→' + valueOf(hostAfter, k))))
    const putCount = settingsPuts.length
    console.log('  期间对 /settings 的请求 ' + putCount + ' 条：' + pretty(settingsPuts.slice(0, 3).map((s) => s.slice(0, 120))))
    /* 复原 */
    try {
      if (originalSection) await page.evaluate(({ sec }) => localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(sec)), { sec: originalSection })
      if (settingsBytes) fs.writeFileSync(SETTINGS_JSON, settingsBytes)
    } catch (e) { console.log('  复原失败：' + String(e && e.message || e)) }
  }

  console.log('\n== Z. 页面错误（只报本插件相关）==')
  {
    const ours = errs.filter((e) => /mpkg-wallpaper|mpw|now-playing|data-mpw/i.test(String(e)))
    ok(ours.length === 0, 'Z1 0 个本插件相关的 pageerror', ours.slice(0, 3).join(' | ') || '（其余页面错误 ' + errs.length + ' 条，如实列出：' + errs.slice(0, 2).map((x) => String(x).slice(0, 70)).join(' | ') + '）')
  }

  console.log('\n── 汇总：PASS=' + pass + ' FAIL=' + fail)
  process.exitCode = fail > 0 ? 1 : 0
} finally {
  try { fs.writeFileSync(path.join(OUT, 'settings-persist-probe-summary.json'), JSON.stringify({ pass, fail, at: new Date().toISOString() }, null, 2)) } catch {}
  try { await browser.close() } catch {}
}
/* 兜底复原：哪怕上面 throw，磁盘设置文件写回原字节 */
if (settingsBytes) { try { const cur = fs.readFileSync(SETTINGS_JSON); if (!cur.equals(settingsBytes)) fs.writeFileSync(SETTINGS_JSON, settingsBytes) } catch {} }

// mpkg-sweep-test.mjs —— 任务④：`.mpkg`「**真出画**」补扫（此前只扫过静态目录表，从未挂载渲染过）
//
// 为什么要有它：全库 155 个 `.mpkg`（magic `PKGM0014`×145 / `PKGM0018`×10），此前只做过**离线**两件事
//   ——目录表可读 155/155、`scene.json` 存在性 70/155。**没有任何一条真机判据回答"挂上去会不会出画"**。
//   本文件就是补这一条：从含 `scene.json` 的 70 个里抽 13 个（优先 `wallpaperE/**` 新分类名 + `wallpapertest1_*`），
//   再抓 3 个**不含** `scene.json` 的做对照（那 85 个从未被审计过，且占全库 55%）。
//
// 每个包只判三件事（任务书原文）：
//   ① **画布非空**：截画布那一块 → 页面内解码 → `meanL/maxL/stdL/litFrac`（纯黑空画布的签名是 `maxL=0`）；
//   ② **页面脚本错计数**：`pageerror`（未捕获异常）+ 页面自己 `❌` 行（页面把启动异常 catch 成日志，不计入 pageerror）；
//   ③ **`?res=dpr` 下画布尺寸跟随**：读 `window.__mpwLiveRes` + 改 viewport 后画布重算（活档位块自己 publish 的读数）。
//
// 挂载路径（本文件先把三条候选探清，结论写在 `--route` 的候选表里）：
//   · `/media/dev/<itemId>/<file>.mpkg` —— **不通**：`itemId` 只允许**单个路径段**且必须是 `activeRoot`
//     （8902 当前库根 = `<WS>/allwallpaper/dd`）的**直接子目录**；70 个带 scene 的包全在 `wallpaperE/**`
//     与 `delete/wallpapertest1/**` 下 ⇒ `404 壁纸不存在`。改库根才能用（本文件**不**动全局库根）。
//   · `?pkgpath=<绝对路径>` —— **通**，且是唯一对本语料通用的一条：8899 的 `MPW_ALLOW_DIRS` 里含
//     `<MPW_ROOT>/allwallpaper`，8902 的 `/webloader/**` 反向代理把页面**与**它自己的 `/pkgpath` 一起转给 8899。
//   · `?pkgurl=<http url>` —— 通（页面先直连、失败退 `/pkgurl` 服务端代理），但需要先有一个**能取到该 .mpkg 字节**的
//     HTTP 源；当前库根下没有这样的源 ⇒ 只作为"库根合适时的替代"记在报告里，不作为本次扫描路径。
//
// 口径（照抄 `tests/_gl-browser.mjs` 的文件头，不另造）：**有头优先**（`DISPLAY=:0`）+ **能力前置探针**
//   + 拿不到 WebGL2 ⇒ **SKIP + 原样读数**（不假红/不假绿）。
//
// 用法（**一次一批，跑完整批自己关浏览器**）：
//   node tests/mpkg-sweep-test.mjs --batch ALL [--offset N --limit M]   # 全语料（含 scene.json 的 .mpkg），分块跑
//   node tests/mpkg-sweep-test.mjs --batch A          # 7 个（3×wallpapertest1 + 4×wallpaperE）
//   node tests/mpkg-sweep-test.mjs --batch B          # 6 个
//   node tests/mpkg-sweep-test.mjs --batch C          # 3 个对照（**不含** scene.json）
//   node tests/mpkg-sweep-test.mjs --only 红鸾樱落     # 冒烟：只跑名字含它的那个
//   --out <file>（默认 tests/mpkg-sweep-<batch>.json）· --timeout <ms>（默认 60000）· --min-free-mb（默认 1200）
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { ROOT, WS, TESTS } from './_root.mjs'
/* 口径唯一实现（有头优先 + 能力前置 + 无 GL 打 SKIP）：见 `tests/_gl-browser.mjs` 文件头 */
import { launchGLBrowser, glCapability, glReading, logGLSkip, glSkipWhy, closeQuiet, findPlaywright } from './_gl-browser.mjs'
import { walkContainers, readIndexHead, readSceneJsonText } from './_pkg-index.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const BATCH = argVal('--batch') || 'A'
const ONLY = argVal('--only')
const OUT = argVal('--out') || path.join(TESTS, 'mpkg-sweep-' + BATCH + '.json')
const TIMEOUT = Number(argVal('--timeout') || 90000)
const MIN_FREE_MB = Number(argVal('--min-free-mb') || 1400)
/* 包内看门狗：渲染途中可用内存掉到这条线以下 ⇒ **立刻**关掉上下文并停批（本机曾 OOM；`alone` 那个
   7500×7500 DXT5（解码 214.6MB）+ godrays/depthparallax 全屏 FBO 链在软件 GL 下实测把内容进程推到 3.7GB）。 */
const ABORT_FREE_MB = Number(argVal('--abort-free-mb') || 900)
/* `?res=` 档位：默认 `dpr`（任务书第③条要的就是它）。deviceScaleFactor 默认 **1**（= 画布 = CSS 尺寸，
   省掉 4× 画布/FBO 内存）；`--dsf 2` 可复现"2× 屏按显示尺寸×DPR 出图"（红鸾樱落那条读数是这么取的）。 */
const RES = argVal('--res') || 'dpr'
const DSF = Number(argVal('--dsf') || 1)
const EXTRA_Q = argVal('--extra-q') || ''
const NO_RESIZE = argv.includes('--no-resize')
/* ①(2026-09-24) `--hide-shell`：恢复旧的"先摘外壳再截图"口径。**本机实测该口径会让画布截图恒为纯黑**
   （见像素段注释与 tests/mpkg-videoblack-probe.mjs 的读数），只用于复现旧读数，不作为判定依据。 */
const HIDE_SHELL_MODE = argv.includes('--hide-shell')
/* `--save-shots <dir>`：把每个包的画布那一块**落盘**（用来肉眼复核"截到的到底是不是画面"）。 */
const SAVE_SHOTS = argVal('--save-shots')
/* 首帧之后给 `<video>`（PKGM0014 的 `__videoBase`）的有界等待窗口。 */
const VIDEO_WAIT_MS = Number(argVal('--video-wait') || 20000)
const AUTHORITY = argVal('--authority') || process.env.MPW_SWEEP_AUTHORITY || '127.0.0.1:8902'
/* 挂载路径（探清后写死一条；`--route media` 只用于**复现 404**，不参与扫描） */
const ROUTE = argVal('--route') || 'pkgpath'
const CORPUS = path.join(WS, 'allwallpaper')

/* ── 抽样表（任务书口径：优先 `wallpaperE/` 新分类名 + `wallpapertest1_*`）────────────────────────
   分批口径 = **内存**：PKGM0014（视频+scene.json）批量小、可 6~7 个一批；PKGM0018（真场景工程）里
   除红鸾樱落外都是"大贴图 + 全屏效果链"，**一个一批**（D 批），跑完立刻关浏览器。 */
const SAMPLE = {
  A: [
    { rel: 'delete/wallpapertest1/wallpapertest1_红鸾樱落.mpkg', why: 'wallpapertest1_* 最小（9.4MB/PKGM0018，149 条目）' },
    { rel: 'wallpaperE/佩丽卡/佩丽卡1_10.mpkg', why: 'wallpaperE 新名字（14.3MB，PKGM0014 视频+scene.json 型）' },
    { rel: 'wallpaperE/庄方宜/庄方宜_7.mpkg', why: 'wallpaperE 新名字（19.9MB，PKGM0014）' },
    { rel: 'wallpaperE/小鸟游星野/小鸟游星野11_10.mpkg', why: 'wallpaperE 新名字（21.0MB，PKGM0014）' },
    { rel: 'wallpaperE/白洲梓/白洲梓1_10.mpkg', why: 'wallpaperE 新名字（21.8MB，PKGM0014）' },
    { rel: 'wallpaperE/白洲梓/白洲梓1_05.mpkg', why: 'wallpaperE 新名字（22.5MB，PKGM0014）' },
    { rel: 'wallpaperE/洁尔佩塔/洁尔佩塔_4.mpkg', why: 'wallpaperE 新名字（27.6MB，PKGM0014，preview.gif 型）' },
  ],
  B: [
    { rel: 'wallpaperE/洛茜/洛茜_11.mpkg', why: 'wallpaperE 新名字（29.2MB，PKGM0014，scene.json 57KB 最大）' },
    { rel: 'wallpaperE/蔚蓝档案/蔚蓝档案_04.mpkg', why: 'wallpaperE 新名字（41.8MB，PKGM0014）' },
    { rel: 'wallpaperE/陈千语/陈千语_01.mpkg', why: '**唯一**带 scene.json 的 `*_01.mpkg`（58.7MB，PKGM0014）' },
    { rel: 'wallpaperE/卡提希娅/卡提希娅_09.mpkg', why: '对照：**无 scene.json**（9.2MB，3 条目 = preview+project.json+mp4）' },
    { rel: 'wallpaperE/佩丽卡/佩丽卡1_01.mpkg', why: '对照：**无 scene.json**（10.6MB，3 条目）' },
    { rel: 'wallpaperE/白洲梓/白洲梓1_07.mpkg', why: '对照：**无 scene.json**（11.8MB，3 条目）' },
  ],
  /* G 批（2026-09-24 补）：70 个含 `scene.json` 的 `.mpkg` 里的**下一批**，取**视频最大的几个**
     （各 ~58MB，仍在"容器整包在内存里"的安全区内；`--abort-free-mb` 看门狗照旧生效）。 */
  G: [
    { rel: 'wallpaperE/砂狼白子/砂狼白子11_03.mpkg', why: '补扫：59.8MB 视频条目（70 个里最大的一档）' },
    { rel: 'wallpaperE/佩丽卡/佩丽卡1_06.mpkg', why: '补扫：59.7MB' },
    { rel: 'wallpaperE/白洲梓/白洲梓_09.mpkg', why: '补扫：59.0MB' },
    { rel: 'wallpaperE/洛茜/洛茜_07.mpkg', why: '补扫：58.8MB' },
    { rel: 'wallpaperE/蔚蓝档案/蔚蓝档案_06.mpkg', why: '补扫：58.8MB' },
    { rel: 'wallpaperE/佩丽卡/佩丽卡1_09.mpkg', why: '补扫：58.6MB' },
    { rel: 'wallpaperE/芙宁娜/芙宁娜1_04.mpkg', why: '补扫：58.4MB（NSL 类脚本包的对照）' },
    { rel: 'wallpaperE/遐蝶/遐蝶_09.mpkg', why: '补扫：58.1MB' },
  ],
  /* D 批 = 大 PKGM0018（真场景工程）：**一个一批**，每个自带一次独立浏览器生命周期 */
  D: [
    { rel: 'delete/wallpapertest1/wallpapertest1_夜莺night——【time_variation_时间变化】alone_孤独の少女【原画：rella].mpkg', why: '任务⑤ 同包（49.2MB/PKGM0018，132 条目，含 7500×7500 DXT5）' },
  ],
  E: [
    { rel: 'delete/wallpapertest1/wallpapertest1_夜莺night——【customize自定义】firefly_流萤_星空之誓——夜莺night崩坏星穹铁道.mpkg', why: 'wallpapertest1_*（73.8MB/PKGM0018，127 条目）' },
  ],
  F: [
    { rel: 'delete/wallpapertest1/wallpapertest1_夜莺Night——Honkai Star Rail Castorice 遐蝶 冥河永渡 崩坏星穹铁道The Etern.mpkg', why: 'wallpapertest1_*（78.0MB/PKGM0018，49 条目）' },
  ],
}
/*  ⓐ(2026-09-25 任务④收口) `--batch ALL`：**全语料枚举**（不再靠手写抽样表）——
    从语料根递归找 `*.mpkg`/`*.pkg`，用离线目录表判 `hasScene`（只读目录表 + 一条 scene.json，不占内存），
    只保留**含 scene.json** 的包（= 真场景工程；不含的就是纯视频档，不属本项）。
    · `delete/` 下的副本**排除**（它们与库内保留副本逐字节相同，扫了等于重复劳动；读数里明说排除数）；
    · `--offset/--limit` 分块 ⇒ 每块一次独立浏览器生命周期（内存优先：不为了一轮扫完把 RSS 堆上去）。 */
const SCENE_ALL = (() => {
  if (BATCH !== 'ALL') return null
  const OFFSET = Number(argVal('--offset') || 0)
  const LIMIT = Number(argVal('--limit') || 0)
  const all = walkContainers(CORPUS).map((p) => path.relative(CORPUS, p)).sort()
  const INCLUDE_PKG = argv.includes('--include-pkg')
  const kept = all.filter((r) => (!r.startsWith('delete' + path.sep) && !r.startsWith('delete/'))
    && (INCLUDE_PKG || /\.mpkg$/i.test(r)))
  const scene = []
  for (const r of kept) {
    try { if (readIndexHead(path.join(CORPUS, r)).entries.some((x) => /(^|\/)scene\.json$/i.test(x.name))) scene.push({ rel: r, why: 'ALL：含 scene.json（离线判据）' }) } catch { /* 读不动就在下面按"跳过"如实记 */ }
  }
  const slice = scene.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined)
  console.log('   --batch ALL：语料 ' + all.length + ' 个容器（排除 delete/ 副本与 ' + (INCLUDE_PKG ? '0' : '非 .mpkg') + ' 后 ' + kept.length + '）· 含 scene.json ' + scene.length +
    ' · 本块 offset=' + OFFSET + ' limit=' + (LIMIT || '不限') + ' ⇒ ' + slice.length + ' 个')
  return slice
})()
const rows = ONLY
  ? Object.values(SAMPLE).flat().filter((r) => r.rel.includes(ONLY))
  : (SCENE_ALL || SAMPLE[BATCH] || [])
if (!rows.length) { console.log('SKIP mpkg-sweep —— 抽样表里没有匹配项（--batch ' + BATCH + (ONLY ? ' --only ' + ONLY : '') + '）'); process.exit(0) }

/* ── 离线读数（不占内存：只读目录表 + 那一条 scene.json）──────────────────────────────────── */
const offline = (rel) => {
  const abs = path.join(CORPUS, rel)
  const out = { abs, exists: false, mb: null, magic: null, entries: null, hasScene: false, sceneLayers: null, sceneVisible: null, videoEntry: null, pkgError: null }
  try { if (!fs.statSync(abs).isFile()) return out; out.exists = true; out.mb = +(fs.statSync(abs).size / 1048576).toFixed(1) } catch (e) { out.pkgError = String(e.message).slice(0, 80); return out }
  try {
    const idx = readIndexHead(abs)
    out.magic = idx.magic; out.entries = idx.count
    out.hasScene = idx.entries.some((x) => /(^|\/)scene\.json$/i.test(x.name))
    const v = idx.entries.find((x) => /\.(mp4|webm|mov)$/i.test(x.name)); out.videoEntry = v ? v.name : null
  } catch (e) { out.pkgError = '目录表: ' + String(e.message).slice(0, 80) }
  if (out.hasScene) {
    try {
      const j = JSON.parse(readSceneJsonText(abs))
      const objs = (j && j.objects) || []
      out.sceneLayers = objs.length
      out.sceneVisible = objs.filter((o) => { const v = o.visible; return v === undefined || v === true || (v && typeof v === 'object') }).length
    } catch (e) { out.pkgError = (out.pkgError ? out.pkgError + ' · ' : '') + 'scene.json: ' + String(e.message).slice(0, 80) }
  }
  return out
}

const memMB = () => { try { const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); return m ? Math.round(+m[1] / 1024) : null } catch { return null } }
const freeDiskNote = () => { const a = memMB(); return a == null ? '?' : a + 'MB' }

console.log('== 任务④ .mpkg 真出画补扫 · batch ' + BATCH + ' · ' + rows.length + ' 个 ==')
console.log('   语料根   : ' + CORPUS)
console.log('   挂载路径 : ' + (ROUTE === 'pkgpath' ? '/webloader/?pkgpath=<绝对路径>（经 :' + AUTHORITY + ' 反代到 :8899 的渲染器页）' : ROUTE))
console.log('   可用内存 : ' + freeDiskNote())

/* ── 浏览器阶段 ─────────────────────────────────────────────────────────────────────────── */
/*  ⓑ(2026-09-25) 本机纪律：**同一时刻只允许一个 Firefox**（15GB 机器，曾 OOM；多开既互相抢内存，
    也会让"画布/像素读数"互相干扰）。启动前先看一眼有没有别人在跑 —— 有就 SKIP 并打印 PID，
    不硬闯；确实要并发（例如专门的对照实验）用 `--force` 显式越过。 */
{
  const others = (() => { try { return execSync("pgrep -af firefox | grep -v pgrep", { encoding: 'utf8' }).trim() } catch { return '' } })()
  if (others && !argv.includes('--force')) {
    console.log('SKIP mpkg-sweep —— 已有 Firefox 在跑（本机纪律：同一时刻只允许一个）：\n' + others.split('\n').map((l) => '    ' + l.slice(0, 140)).join('\n') + '\n    等它跑完再跑本档，或显式 --force')
    process.exit(0)
  }
}
/*  `--enum-only`：只做离线枚举/判据（不启动浏览器）—— 用来核"这一批到底选了哪些包"、
    也用来在机器忙（已有 Firefox / 内存紧张）时先取清单，真正的出画扫描留给空闲时段。 */
if (argv.includes('--enum-only')) {
  for (const r of rows) { const o = offline(r.rel); console.log('  ' + r.rel + '  → ' + (o.mb || '?') + 'MB · 条目 ' + (o.entries == null ? '?' : o.entries) + ' · scene 层 ' + (o.sceneLayers == null ? '-' : o.sceneLayers) + (o.pkgError ? ' · ⚠ ' + o.pkgError : '')) }
  console.log('\n--enum-only：共 ' + rows.length + ' 个（未启动浏览器）')
  process.exit(0)
}
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP mpkg-sweep —— 找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP mpkg-sweep —— playwright 没有 firefox 导出'); process.exit(0) }

/** 页面内读数（**只回数字/短字符串**，不把像素搬进 Node）。 */
const READ_STATE = () => {
  const g = (k) => { try { return window[k] } catch (e) { return null } }
  const cv = document.getElementById('sc') || document.querySelector('canvas')
  const logTxt = (() => { try { const el = document.getElementById('log'); return el ? String(el.textContent || '') : '' } catch (e) { return '' } })()
  const vids = (() => {
    try {
      return [...document.querySelectorAll('video')].map((v) => ({
        rs: v.readyState, ns: v.networkState, err: v.error ? String(v.error.message || ('code ' + v.error.code)) : null,
        w: v.videoWidth, h: v.videoHeight, src: String(v.currentSrc || v.src || '').slice(0, 24),
      }))
    } catch (e) { return [] }
  })()
  const ls = g('__sceneLayers'), ts = g('__mpwTexStats'), lr = g('__mpwLiveRes'), rt = g('__mpwResTier')
  return {
    canvas: cv ? { w: cv.width, h: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight } : null,
    layers: Array.isArray(ls) ? ls.length : null,
    texStats: Array.isArray(ts) ? ts.length : null,
    liveRes: lr ? { w: lr.width, h: lr.height, cssW: lr.cssW, cssH: lr.cssH, dpr: lr.dpr, dprCap: lr.dprCap, capped: lr.capped, updates: lr.updates, why: lr.why } : null,
    resTier: rt ? { name: rt.name, requested: rt.requested, width: rt.width, height: rt.height, live: !!rt.live } : null,
    bootError: g('__mpwBootError') || null,
    firstFrame: !!g('__mpwFirstFrame'),
    moduleStarted: !!g('__mpwModuleStarted'),
    videos: vids,
    logLen: logTxt.length,
    logFatal: (logTxt.match(/❌/g) || []).length,
    logWarn: (logTxt.match(/⚠/g) || []).length,
    logTail: logTxt.trim().split('\n').slice(-8).map((s) => s.slice(0, 200)),
    logKey: (() => { const m = logTxt.match(/(容器: [^\n]*|scene\.json 解析: [^\n]*|绑定纹理的层: [^\n]*|✅ 首帧完成 [^\n]*|启动失败[^\n]*|取包[^\n]*)/g); return m ? m.slice(-4).map((s) => s.slice(0, 120)) : [] })(),
  }
}

/** 摘掉渲染器页自己的外壳（面板/日志/帧率角标…）：它们是**页面的 UI**，压在画布上会把像素读数污染成
    "所有包都长一个样"（第一版实测 6 个 PKGM0014 的 meanL 全在 92.9~93.9、litFrac 全是 0.9204~0.9209 ——
    那是外壳，不是画面）。口径同 `tests/cover-ab-probe.mjs`：只留画布与含画布的祖先；
   **`<video>` 元素不隐藏**（`__videoBase` 的载体是 `display` 参与解码的 2×2 视频，藏了可能停解码）。 */
const HIDE_SHELL = () => {
  const hidden = []
  try {
    for (const el of [...document.body.children]) {
      if (el.tagName === 'CANVAS' || el.tagName === 'VIDEO') continue
      if (el.querySelector && el.querySelector('canvas')) continue
      el.style.display = 'none'; hidden.push(el.id || el.tagName)
    }
  } catch (e) { return { err: String(e.message).slice(0, 120) } }
  return { hidden }
}

/** 画布那一块的像素统计（截 → 页面内解码 → 只回读数）。`null` = 没有画布。 */
const PIXEL_STATS = async (page, probe, shotName = 'shot') => {
  let box = null
  try { box = await page.locator('#sc').first().boundingBox() } catch (e) { box = null }
  if (!box || box.width < 2 || box.height < 2) return { err: '没有可截的画布盒' }
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.floor(box.width), height: Math.floor(box.height) } })
  if (SAVE_SHOTS) { try { fs.mkdirSync(SAVE_SHOTS, { recursive: true }); fs.writeFileSync(path.join(SAVE_SHOTS, shotName + '.png'), buf) } catch (e) { /* 存不下就算了 */ } }
  const r = await probe.evaluate(async (dataUrl) => {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = dataUrl })
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const g2 = c.getContext('2d'); g2.drawImage(img, 0, 0)
    const d = g2.getImageData(0, 0, c.width, c.height).data
    let sum = 0, sum2 = 0, max = 0, lit = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      sum += L; sum2 += L * L; if (L > max) max = L; if (L > 16) lit++; n++
    }
    const mean = sum / n
    return { w: c.width, h: c.height, meanL: +mean.toFixed(3), maxL: +max.toFixed(1), stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3), litFrac: +(lit / n).toFixed(4), bytes: d.length }
  }, 'data:image/png;base64,' + buf.toString('base64')).catch((e) => ({ err: String((e && e.message) || e).slice(0, 120) }))
  return r
}

const { browser, launchNote } = await launchGLBrowser(firefox)
const results = []
let aborted = null
try {
  const gl = await glCapability(browser)
  if (!gl.webgl2) {
    /* 无 GL ⇒ 整档 SKIP（本机无头 Firefox 连 WebGL1 都建不了：画布永远 300×150 空 ⇒ 任何"非空"断言都是假红） */
    logGLSkip('mpkg 真出画补扫（batch ' + BATCH + '）', launchNote, gl, '画布/像素类读数一律不可信')
    glSkipWhy()
    if (browser) await closeQuiet(browser)
    process.exit(0)
  }
  console.log('   GL 前置: ' + glReading(launchNote, gl))

  /* 视频解码能力（一次性读数）：PKGM0014 全是"mp4 作最底层 + scene 层叠加"，如果这台 Firefox 连
     H.264 都解不了，那"视频底层没出画"是**环境缺能力**，不是产品坏 —— 必须先量出来再谈结论。 */
  const codec = await (async () => {
    const c = await browser.newContext({ viewport: { width: 200, height: 150 } })
    const pg = await c.newPage()
    try {
      await pg.goto('about:blank')
      const r = await pg.evaluate(() => {
        const v = document.createElement('video')
        return { mp4: v.canPlayType('video/mp4'), h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'), webm: v.canPlayType('video/webm; codecs="vp9"') }
      })
      await c.close()
      return r
    } catch (e) { await c.close().catch(() => {}); return { err: String((e && e.message) || e).slice(0, 100) } }
  })()
  console.log('   视频解码能力(canPlayType): ' + JSON.stringify(codec))

  /* 探针页（只用来解码截图，一直在）；被测页**每个包一个新 context**（软件 GL 下纹理不回收，串页会累积） */
  const probeCtx = await browser.newContext({ viewport: { width: 400, height: 300 } })
  const probe = await probeCtx.newPage()
  await probe.goto('about:blank')

  for (const r of rows) {
    const off = offline(r.rel)
    const free = memMB()
    if (free != null && free < MIN_FREE_MB) {
      aborted = '可用内存 ' + free + 'MB < 下限 ' + MIN_FREE_MB + 'MB ⇒ 主动停批（余下未跑）'
      console.log('  ⛔ ' + aborted)
      break
    }
    const rec = { rel: r.rel, why: r.why, off, freeBefore: free, url: null, pageErrors: [], consoleErrors: [], state: null, pixel: null, dprFollow: null, verdict: null, notes: [], ms: null }
    console.log('\n── [' + (results.length + 1) + '/' + rows.length + '] ' + r.rel + '  (' + off.mb + 'MB ' + off.magic + '/' + off.entries + ' 条目' + (off.hasScene ? ', scene.json ' + off.sceneLayers + ' 层' : ', **无 scene.json**') + ', 可用 ' + free + 'MB)')
    if (!off.exists) { rec.verdict = 'SKIP 文件不存在'; results.push(rec); console.log('   SKIP 文件不存在'); continue }

    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: DSF })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => { if (rec.pageErrors.length < 6) rec.pageErrors.push(String((e && e.message) || e).slice(0, 300)) })
    page.on('console', (m) => { if (m.type() === 'error' && rec.consoleErrors.length < 6) rec.consoleErrors.push(String(m.text()).slice(0, 200)) })
    const tPkg = Date.now()
    try {
      const url = 'http://' + AUTHORITY + '/webloader/?type=scene&id=mpkg-sweep&res=' + encodeURIComponent(RES) + '&_t=' + Date.now()
        + (EXTRA_Q ? '&' + EXTRA_Q : '') + '&pkgpath=' + encodeURIComponent(off.abs)
      rec.url = url
      console.log('   URL: /webloader/?type=scene&id=mpkg-sweep&res=' + RES + (EXTRA_Q ? '&' + EXTRA_Q : '') + '&pkgpath=<' + r.rel + '>')
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      /* 就绪轮询（**不盲等**）：首帧 / 启动失败 / 超时，三者取先到者。软件 GL 首帧实测可到 +20s。
         每轮都看一眼系统可用内存：**渲染途中**掉到 ABORT 线以下就立刻收手（本机曾 OOM）。 */
      const t0 = Date.now()
      let st = null
      for (;;) {
        await page.waitForTimeout(1500)
        const fm = memMB()
        if (fm != null && fm < ABORT_FREE_MB) {
          rec.verdict = 'ABORT 内存'
          rec.notes.push('渲染途中可用内存 ' + fm + 'MB < ' + ABORT_FREE_MB + 'MB ⇒ 立刻关上下文停批（不冒险 OOM）')
          aborted = '包 `' + r.rel + '` 渲染途中可用内存 ' + fm + 'MB < ' + ABORT_FREE_MB + 'MB ⇒ 停批'
          console.log('   ⛔ ' + rec.notes[rec.notes.length - 1])
          break
        }
        st = await page.evaluate(READ_STATE)
        const done = st.firstFrame || st.bootError || st.logFatal > 0
        if (done || Date.now() - t0 > TIMEOUT) break
      }
      rec.state = st
      if (rec.verdict === 'ABORT 内存') { results.push(rec); break }
      /* 视频底层的**有界**等待：`__videoBase` 是"容器里 project.json.file 指向的 mp4"，
         首帧可能早于 `<video>` 拿到数据（rs<2）⇒ 直接截会得到"只有叠加层"的画面。
         这里最多再等 VIDEO_WAIT_MS，读到 rs≥2 或 getError 就走（超时也照读，读数里带 rs）。 */
      const vids0 = st.videos || []
      if (vids0.length && vids0.some((v) => v.rs < 2 && !v.err)) {
        const tv = Date.now()
        for (;;) {
          await page.waitForTimeout(1500)
          const stv = await page.evaluate(READ_STATE)
          st = stv
          const vv = stv.videos || []
          if (vv.every((v) => v.rs >= 2 || v.err) || Date.now() - tv > VIDEO_WAIT_MS) break
        }
        rec.videoWaitMs = Date.now() - tv
        rec.state = st
      }
      /* ①(2026-09-24 采样口径缺陷，实测) **不再"先 display:none 摘外壳再截图"** —— 那一步会把**每一张**
         WebGL 画布的截图变成纯黑（与画的是什么无关）。取证（`tests/mpkg-videoblack-probe.mjs`，同一个包、
         同一个 URL 形状 `?type=scene&id=mpkg-sweep&res=dpr`、同一个 960×540 viewport）：
           · 不摘外壳：t=2.6s `meanL=10.8 maxL=255`；t=6.3s 起稳定 `meanL=12.56 maxL=255`（视频 rs=4、ct 在走）
           · 摘外壳：t=4.1s 起**一路 `meanL=0 maxL=0`**，到 t=14.8s（视频 ct=9.88 仍在放）依旧是 0
         机制层：`body` 的子元素全被 `display:none` 后 `body` 高度塌成 0，此时 Firefox 对这段区域的截图会走
         "重新绘制"路径，而 WebGL 画布是 `preserveDrawingBuffer:false`（默认）⇒ 重绘拿到的是**已被清空**的缓冲。
         ⇒ 口径改成"**不摘外壳，只按画布盒裁剪**"（与 `mpkg-video*-probe.mjs` 一致，那两个探针一直这么量，
         读数一直正常）。要复现旧口径/对拍时用 `--hide-shell` 显式打开。 */
      if (HIDE_SHELL_MODE) {
        rec.shell = await page.evaluate(HIDE_SHELL).catch((e) => ({ err: String((e && e.message) || e).slice(0, 120) }))
        rec.shellNote = '⚠ --hide-shell：本机实测该口径会把画布截图变纯黑（见文件头注释），读数不可用于判定"是否出画"'
        await page.waitForTimeout(700)
      } else rec.shell = { skipped: '不摘外壳（按画布盒裁剪；见 --hide-shell 注释）' }
      st = await page.evaluate(READ_STATE)
      rec.stateAfterHide = { canvas: st.canvas, liveRes: st.liveRes, videos: st.videos }
      const shotName = r.rel.replace(/[^\w.\u4e00-\u9fa5-]+/g, '_').slice(-70)
      rec.pixel = await PIXEL_STATS(page, probe, shotName)
      /* `?res=dpr` 跟随：改 viewport → 活档位块应重算画布（`__mpwLiveRes.updates` 增加、宽高跟着换） */
      if (NO_RESIZE) rec.dprFollow = { skipped: '--no-resize' }
      else try {
        const before = { w: st.canvas && st.canvas.w, h: st.canvas && st.canvas.h, live: st.liveRes }
        await page.setViewportSize({ width: 700, height: 394 })
        await page.waitForTimeout(1200)
        const st2 = await page.evaluate(READ_STATE)
        /* 期望宽度 = cssW × min(dpr, cap)；`cap` 未封顶时页面 publish 的是 null ⇒ 这时乘数就是 dpr
           （`resolveLiveCanvasSize` 的语义，见 demo.html 的活档位块）。 */
        const lr2 = st2.liveRes
        const want = lr2 ? Math.round(lr2.cssW * (lr2.dprCap == null ? (lr2.dpr || 1) : Math.min(lr2.dpr || 1, lr2.dprCap))) : null
        rec.dprFollow = {
          before, after: { w: st2.canvas && st2.canvas.w, h: st2.canvas && st2.canvas.h, live: st2.liveRes },
          changed: !!(st2.canvas && before.w && st2.canvas.w !== before.w),
          matchesLiveRes: !!(st2.canvas && st2.liveRes && st2.canvas.w === st2.liveRes.w && st2.canvas.h === st2.liveRes.h),
          updatesGrew: !!(st2.liveRes && before.live && st2.liveRes.updates > before.live.updates),
          formula: st2.liveRes ? { cssW: st2.liveRes.cssW, cssH: st2.liveRes.cssH, dpr: st2.liveRes.dpr, cap: st2.liveRes.dprCap, want, got: st2.canvas && st2.canvas.w, capped: st2.liveRes.capped } : null,
        }
      } catch (e) { rec.dprFollow = { err: String((e && e.message) || e).slice(0, 140) } }
    } catch (e) {
      rec.pageErrors.push('探针级异常: ' + String((e && e.message) || e).slice(0, 200))
    } finally {
      await ctx.close().catch(() => {})
    }
    rec.ms = Date.now() - tPkg
    rec.freeAfter = memMB()
    /* ── 定性（只按读数，不按观感）───────────────────────────────────────────────────── */
    const st = rec.state || {}
    const px = rec.pixel || {}
    const nonEmpty = !!(px && !px.err && px.maxL > 0 && px.litFrac > 0.0005)
    const scriptErrs = (rec.pageErrors.length) + (st.logFatal || 0)
    if (rec.verdict === 'ABORT 内存') { /* 看门狗已定性（读数不完整 ⇒ 不算 PASS 也不算 FAIL） */ }
    else if (st.layers == null && st.bootError) rec.verdict = 'FAIL 未挂载（启动异常）'
    else if (st.layers == null && !st.moduleStarted) rec.verdict = 'FAIL 未挂载（module 都没起来）'
    else if (!nonEmpty && st.layers > 0) rec.verdict = 'FAIL 挂上了但画布空/纯黑'
    else if (!nonEmpty) rec.verdict = 'FAIL 画布空'
    else rec.verdict = 'PASS 出画'
    rec.summary = {
      layers: st.layers, texStats: st.texStats, nonEmpty,
      meanL: px.meanL, maxL: px.maxL, stdL: px.stdL, litFrac: px.litFrac, shot: px.w ? px.w + 'x' + px.h : null,
      scriptErrs, pageErrors: rec.pageErrors.length, logFatal: st.logFatal || 0,
      firstFrame: !!st.firstFrame, bootError: st.bootError ? String(st.bootError.message || st.bootError).slice(0, 200) : null,
      videos: st.videos || [], dprFollow: rec.dprFollow, ms: rec.ms, freeAfter: rec.freeAfter,
    }
    results.push(rec)
    console.log('   → ' + rec.verdict + ' | 层=' + st.layers + ' texStats=' + st.texStats + ' | 画布 ' + (px.w ? px.w + 'x' + px.h : '?')
      + (px.meanL == null ? '' : ' meanL=' + px.meanL + ' maxL=' + px.maxL + ' stdL=' + px.stdL + ' lit=' + px.litFrac)
      + ' | 脚本错=' + scriptErrs + ' (pageerror ' + rec.pageErrors.length + ' + ❌ ' + (st.logFatal || 0) + ')'
      + ' | res=' + RES + ' 跟随=' + (rec.dprFollow && rec.dprFollow.matchesLiveRes ? '✓' : '✗') + (rec.dprFollow && rec.dprFollow.changed ? '/尺寸变更✓' : '/尺寸未变')
      + ' | 用时 ' + Math.round(rec.ms / 1000) + 's 可用内存 ' + free + '→' + rec.freeAfter + 'MB')
    if (rec.pageErrors.length) console.log('     pageerror: ' + rec.pageErrors[0])
    if (st.bootError) console.log('     __mpwBootError: ' + JSON.stringify(st.bootError).slice(0, 300))
    if (st.logFatal) console.log('     ❌ 行: ' + (st.logTail || []).filter((l) => /❌/.test(l)).slice(0, 2).join(' ¶ '))
    if ((st.videos || []).length) console.log('     <video>: ' + JSON.stringify(st.videos))
  }
  await probeCtx.close().catch(() => {})
} finally {
  await closeQuiet(browser)
}

/* ── 报告：小表 + 明细 + 落盘 ─────────────────────────────────────────────────────────────── */
const cell = (s) => String(s == null ? '-' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
console.log('\n\n== ④ 抽扫表（batch ' + BATCH + '）==\n')
console.log('| 包（相对路径） | 层数/texStats 条数 | 画布非空 | 脚本错 | 备注 |')
console.log('| --- | --- | --- | --- | --- |')
for (const r of results) {
  const s = r.summary || {}
  const px = r.pixel || {}
  const nonEmpty = r.summary ? (s.nonEmpty ? '是' : '否') : '-'
  const note = []
  if (r.verdict && /^FAIL/.test(r.verdict)) note.push(r.verdict)
  if (r.off && !r.off.hasScene) note.push('**无 scene.json**')
  if (r.off && r.off.magic) note.push(r.off.magic + '/' + r.off.entries)
  if (px.meanL != null) note.push('meanL=' + px.meanL + ' maxL=' + px.maxL + ' stdL=' + px.stdL)
  if (s.bootError) note.push('bootError: ' + String(s.bootError).slice(0, 120))
  if (s.videos && s.videos.length) note.push('video rs=' + s.videos.map((v) => v.rs + (v.err ? '!/' + v.err : '')).join(','))
  if (r.dprFollow && r.dprFollow.formula) note.push('res=dpr ' + JSON.stringify(r.dprFollow.formula))
  if (r.dprFollow && r.dprFollow.err) note.push('res=dpr 探针异常: ' + r.dprFollow.err)
  if (r.pageErrors && r.pageErrors.length) note.push('pageerror: ' + r.pageErrors[0])
  console.log('| `' + cell(r.rel) + '` | ' + cell(s.layers) + '/' + cell(s.texStats) + ' | ' + nonEmpty + ' | '
    + cell(s.scriptErrs == null ? '-' : s.scriptErrs) + ' | ' + cell(note.join(' · ').slice(0, 320)) + ' |')
}
if (aborted) console.log('\n⛔ 本批提前停止：' + aborted)
const pass = results.filter((r) => r.verdict && r.verdict.startsWith('PASS')).length
const fail = results.filter((r) => r.verdict && r.verdict.startsWith('FAIL')).length
console.log('\n本批汇总：' + results.length + ' 个（PASS ' + pass + ' / FAIL ' + fail + ' / 其他 ' + (results.length - pass - fail) + '）')
try { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), batch: BATCH, route: ROUTE, authority: AUTHORITY, launchNote, gl: null, aborted, rows: results }, null, 1)) ; console.log('读数已落盘: ' + OUT) } catch (e) { console.log('⚠ 读数落盘失败: ' + e.message) }
console.log('\n明细（原样错误文本）:')
for (const r of results) {
  if (!r.summary) continue
  const s = r.summary
  console.log('· ' + r.rel)
  console.log('    ' + r.verdict + ' | ' + JSON.stringify({ layers: s.layers, texStats: s.texStats, canvas: (s.shot || '-'), meanL: s.meanL, maxL: s.maxL, stdL: s.stdL, litFrac: s.litFrac, firstFrame: s.firstFrame, bootError: s.bootError, videos: s.videos }))
  if (r.state && r.state.logKey && r.state.logKey.length) console.log('    log: ' + r.state.logKey.join(' ¶ '))
  if (r.pageErrors.length) console.log('    pageerror: ' + JSON.stringify(r.pageErrors))
  if (r.consoleErrors.length) console.log('    console.error: ' + JSON.stringify(r.consoleErrors.slice(0, 3)))
}
process.exit(0)

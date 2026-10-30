// renderer-gap-matrix.mjs —— Phase 0「实测差距矩阵」：**同一个包、两档各挂一次**，把"只有产物能加载"变成一张可核对的表
//
// 为什么要有它（`docs/RENDERER-UNIFY-FINAL-PLAN.md` §1/§2 的 Phase 0）：
//   目标（用户原话）是"一个最终渲染器，把两个渲染器能加载的东西都一起用出来"。要让"产物独有可加载"归零，
//   **先得知道到底哪些包只有产物能加载、失败类是什么** —— 靠读文档/猜是不行的，必须逐个包真挂一次。
//   本文件只做**测量**：不碰任何产品代码、不改库根、不写产品目录，读数落 `reports/renderer-gap-matrix.json`，
//   人读报告落 `docs/reports/renderer-gap-matrix.md`（后者由人/agent 按本文件的读数撰写）。
//
// 两个渲染器表面（口径与 `docs/RENDERER-UNIFY-PLAN.md` §1.1 一致）：
//   · **本仓**：`http://127.0.0.1:8902/webloader/?type=scene&id=<id>&pkgpath=<abs>&res=dpr&shell=0`
//     （demo.html + core/**，:8902 自己直供；`?pkgpath=` 直挂任意容器，**不需要**切库根）
//   · **产物**：`http://127.0.0.1:8902/wallpaper-engine-webgl/renderer/index.html?type=scene&id=<id>&pkgpath=<abs>`
//     ⚠ 产物页**不认 `?pkgpath=`、也不认 `?id=`**（`lib/pkg` 只读 URL 里的 type/src/fit/renderDpr/sceneFps/
//       muted/loop/filter/mediaBase/liveSystem/opaque —— 静态 grep 命中即此 11 个）。本文件实测（探测①）：
//       照上面那条 URL 直开，产物只挂它自带的 `/wallpaper-engine-webgl/default-wallpaper/index.html` iframe，
//       永远不出画布。⇒ 产物侧走它**自己的公开契约** `window.__wp.loadSceneFile(blob, projectJson)`
//       （`demo/bench-patch.js` 的本地壁纸预览与合成样例就是这么挂的，`:10453`/`:6915`），
//       包字节由页面内 `fetch('/pkgpath?p=<abs>')` 取（与 `?pkgpath=` 同一条服务端通路）。
//       这条差异写进报告；`?type=scene&id=&pkgpath=` 三个参数仍照原样带上（产物忽略它们，不影响判定）。
//
// 枚举口径（与 `tests/mpkg-sweep-test.mjs --batch ALL` 同源）：`walkContainers()` + `readIndexHead()`，
//   只取**含 `scene.json`** 的容器，**排除 `delete/` 副本**。语料根覆盖 `<WS>/allwallpaper/{dd,0923,0917,wallpaperE}`
//   （某个根不在就跳过并在 JSON 里记 `missingRoots`）。⚠ 与 mpkg-sweep 的一处**有意不同**：本文件默认**也收 `.pkg`**
//   （`--mpkg-only` 可切回"只 .mpkg"）—— 否则 `dd/0923/0917` 三根（全是 `scene.pkg`，PKGV 容器）会整根为空，
//   而"语料根至少覆盖这两类"正是本任务的要求。两边的计数都写进 JSON 的 `corpus` 段。
//
// 逐包读数：`ok（是否出画）/ 首帧ms / canvas 尺寸 / 层数或纹理数 / 日志错误类 / 是否只有背景`。
//   · 本仓首帧判据：`window.__mpwFirstFrame`（demo.html:8353 置 1，同处打 `✅ 首帧完成 <ms>ms` ⇒ 首帧 ms 取它）；
//   · 产物首帧判据（**实测探测②后写死，见报告"未测/测不准"§判据来源**）：页面上出现 `w/h > 0` 且
//     **不是 300×150** 的 canvas（未挂载时产物一个 canvas 都没有，只有默认壁纸 iframe）；
//   · 产物日志面：产物页**没有** `#log`/`#logbody`（那是测试台注入的元素）⇒ 日志取 Playwright 的
//     `console.warn/error`（产物把错误写成 `console.warn("scene render failed:", …)`、
//     `console.warn("[we-scene] 跳过效果（pass 编译失败）:", …)` 这类）——`#log` 判据在产物侧**不存在**，如实记。
//   · 是否只有背景：截"画布那一块" → 页面内解码 → `meanL/maxL/stdL/litFrac`（与 mpkg-sweep 同款）；
//     测不到（没有画布/截不到）写 `unmeasured`，不猜。
//
// 分批 + 看门狗（内存优先，本机 15GB 曾 OOM）：
//   `--offset/--limit` 每批一次独立浏览器生命周期；`--abort-free-mb`（默认 900）渲染途中低于即停批；
//   `--min-free-mb`（默认 1400）开跑/换包前低于即不跑余下。读数**按 rel 增量合并**进 `--out`，
//   所以分多批跑完 = 一份完整 JSON（`runs[]` 记每一批）。
//   跑前若 `pgrep -af run-all-tests` 有全量套件在跑 ⇒ `sleep 60` 等它结束（套件不取这把锁）。
//
// 用法（**浏览器一律走 flock**，同一时刻只允许一个 Firefox；另一条音频线也用这把锁）：
//   flock /tmp/.mpw-firefox.lock -c 'node tests/renderer-gap-matrix.mjs --offset 0 --limit 8'
//   flock /tmp/.mpw-firefox.lock -c 'node tests/renderer-gap-matrix.mjs --only 红鸾樱落'      # 冒烟
//   node tests/renderer-gap-matrix.mjs --enum-only                                            # 离线枚举（不起浏览器）
//   常用开关：--out <file>（默认 reports/renderer-gap-matrix.json）· --timeout <ms>（默认 90000）
//             --sides repo,upstream · --repo-only / --up-only · --mpkg-only · --roots dd,0923,0917,wallpaperE
//             --force（越过"已有 Firefox 在跑"的 SKIP）· --no-pixels（跳过像素读数，省时间）
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'
/* 口径唯一实现（有头优先 + 能力前置 + 无 GL 打 SKIP）：见 `tests/_gl-browser.mjs` 文件头 */
import { launchGLBrowser, glCapability, glReading, logGLSkip, glSkipWhy, closeQuiet, findPlaywright } from './_gl-browser.mjs'
import { walkContainers, readIndexHead, readEntryBytes } from './_pkg-index.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const has = (k) => argv.includes(k)

const AUTHORITY = argVal('--authority') || '127.0.0.1:8902'
const OUT = argVal('--out') || path.join(ROOT, 'reports', 'renderer-gap-matrix.json')
const TIMEOUT = Number(argVal('--timeout') || 90000)
const MIN_FREE_MB = Number(argVal('--min-free-mb') || 1400)
const ABORT_FREE_MB = Number(argVal('--abort-free-mb') || 900)
const OFFSET = Number(argVal('--offset') || 0)
const LIMIT = Number(argVal('--limit') || 0)
const ONLY = argVal('--only')
/* 视口与画布口径：两档**同一视口**（960×540，dsf=1 = 省 4× 画布/FBO 内存）；本仓多带 `?res=dpr&shell=0`
   （任务书指定；dsf=1 时 `res=dpr` 的画布 = CSS 尺寸 × 1）。 */
const VW = Number(argVal('--vw') || 960)
const VH = Number(argVal('--vh') || 540)
const DSF = Number(argVal('--dsf') || 1)
const RES = argVal('--res') || 'dpr'
const POLL = Number(argVal('--poll') || 800)
const NO_PIXELS = has('--no-pixels')
/* `--settle-ms`：判定"出画"之后再等这么久才做**像素读数**。为什么需要它（实测）：首帧那一刻截图会撞上
   "视频还在解码 / 场景还在淡入 / 纹理还在上传"，读出来是纯黑 —— 那是**读数时机**问题，不是没出画。
   `--rerun-blank <repo|upstream|both>`：只重测上一轮"出画但像素读数 blank/unmeasured"的包（配合本档用）。 */
const SETTLE = Number(argVal('--settle-ms') || 0)
const RERUN_BLANK = argVal('--rerun-blank')
/* `--save-shots <dir>`：把每次像素读数的画布截图落盘（肉眼复核 + 报告取证用；落 /tmp，不落仓库）。 */
const SAVE_SHOTS = argVal('--save-shots')
const RETAIN_ROWS = has('--no-merge') ? false : true
const SIDES = (() => {
  if (has('--repo-only')) return ['repo']
  if (has('--up-only')) return ['upstream']
  const v = argVal('--sides'); if (v) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return ['repo', 'upstream']
})()
const ROOTS = (argVal('--roots') || 'dd,0923,0917,wallpaperE').split(',').map((s) => s.trim()).filter(Boolean)
const INCLUDE_PKG = !has('--mpkg-only')
const CORPUS = path.join(WS, 'allwallpaper')

/* ── 失败类（短标签）：**只从读到的日志原文归类**，按下面的顺序取首个命中（越具体越靠前）───────
   两个来源共用一张表：本仓 = `#log` 的行；产物 = `console.warn/error` 的文本。
   任务书点名的形态都在里面：`跳过编译失败的 pass`（产物原文）/`wrong operand types`/`纹理上传报错 0x5xx`/
   `no matching overloaded`/`❌`/`⚠`。 */
const CLASSES = [
  ['pkg-magic', /不是 scene\.pkg|魔数/i],
  ['boot', /启动失败|不支持 WebGL2|WebGL 上下文|Failed to create WebGL|CONTEXT_LOST/i],
  ['pkg-read', /取包|目录表|入口表|容器读取|pkgpath|pkgurl|HTTP (4|5)\d\d/i],
  ['scene-parse', /scene\.json 解析|scene\.json 读取|场景解析|解析 scene/i],
  ['shader-pass', /跳过编译失败的 pass|pass 编译失败|着色器编译失败|shader compile|编译失败的 pass/i],
  ['gl-operand', /wrong operand types|no matching overloaded|纹理上传报错|INVALID_OPERATION|INVALID_VALUE|INVALID_FRAMEBUFFER|glGetError/i],
  ['video', /视频帧上传失败|视频解码|video decode|readyState=|MediaError/i],
  ['particle', /粒子图层 .*失败|particle .*FAIL/i],
  ['puppet', /puppet 图层|puppet 渲染器|模型图层|model 图层/i],
  ['layer-load', /加载失败|初始化失败|绘制失败/i],
  ['font', /字体加载失败|字体.*失败/i],
  ['script', /脚本 .*失败|求值失败|general 脚本|对象脚本|效果开关脚本/i],
  ['render-loop', /scene render failed|scene render error|scene render/i],
  ['texture-miss', /纹理.*(缺失|找不到|不存在)|材质.*(缺失|找不到)|资源.*(缺失|找不到)|缺少 mediaBase/i],
  ['unmounted', /未挂载|没有可渲染|空场景|no scene/i],
]
const classifyLines = (lines) => {
  for (const [tag, re] of CLASSES) {
    const hit = (lines || []).find((l) => re.test(String(l)))
    if (hit) return { tag, line: String(hit).slice(0, 240) }
  }
  return null
}
/* pass 级落差（有画，但某个效果 pass 被**跳过编译**）：这是"能不能加载"之外的另一类缺口
   （`docs/RENDERER-UNIFY-FINAL-PLAN.md` §2 Phase 1 的 hlsl2glsl 规则族就在这一类）。单独抽出来，
   免得被"status=ok"淹没。 */
const PASS_RE = /跳过.*pass|跳过效果|编译失败|链接失败|着色器.*失败/
const passSkipsOf = (lines) => [...new Set((lines || []).map(String).filter((l) => PASS_RE.test(l)))].slice(0, 10).map((l) => l.slice(0, 300))

/* ── 离线枚举（不占内存：只读目录表 + 一条 scene.json）──────────────────────────────────── */
const memMB = () => { try { const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); return m ? Math.round(+m[1] / 1024) : null } catch { return null } }

const enumerate = () => {
  const all = []
  const missingRoots = []
  const magicTally = {}
  let excludedDelete = 0; let withSceneAny = 0; let withSceneMpkg = 0; let unreadable = 0
  for (const root of ROOTS) {
    const dir = path.join(CORPUS, root)
    if (!fs.existsSync(dir)) { missingRoots.push(root); continue }
    for (const abs of walkContainers(dir)) {
      const rel = path.relative(CORPUS, abs)
      if (rel === 'delete' || rel.startsWith('delete' + path.sep)) { excludedDelete++; continue }
      const isMpkg = /\.mpkg$/i.test(abs)
      let idx = null
      try { idx = readIndexHead(abs) } catch { unreadable++; continue }
      if (!idx.entries.some((x) => /(^|\/)scene\.json$/i.test(x.name))) continue
      withSceneAny++
      if (isMpkg) withSceneMpkg++
      const key = root + ' ' + idx.magic
      magicTally[key] = (magicTally[key] || 0) + 1
      let mb = null
      try { mb = +(fs.statSync(abs).size / 1048576).toFixed(1) } catch { /* 读不到大小就 null */ }
      all.push({ rel, abs, root, mb, magic: idx.magic, entries: idx.count, hasProjectJson: idx.entries.some((x) => /(^|\/)project\.json$/i.test(x.name)), upstreamMagicOK: /^PKGV/i.test(idx.magic) })
    }
  }
  /* `delete/` 副本**不在四个语料根里**（所以上面的循环碰不到它们）：显式扫一遍给个数，免得报告里写成
     "排除 0 个"被误读成"没排除"。口径与 `mpkg-sweep-test.mjs --batch ALL` 的 `!r.startsWith('delete/')` 一致。 */
  let deleteCopies = 0; let deleteCopiesWithScene = 0
  for (const abs of walkContainers(CORPUS)) {
    const rel = path.relative(CORPUS, abs)
    if (!(rel === 'delete' || rel.startsWith('delete' + path.sep))) continue
    deleteCopies++
    try { if (readIndexHead(abs).entries.some((x) => /(^|\/)scene\.json$/i.test(x.name))) deleteCopiesWithScene++ } catch { /* 读不动不计数 */ }
  }
  /* 重包先跑：让 watchdog 在内存最宽裕时先啃硬的；同体积按路径稳定排序（分批复现友好）。 */
  all.sort((a, b) => (b.mb || 0) - (a.mb || 0) || a.rel.localeCompare(b.rel))
  return {
    rows: all, missingRoots, magicTally,
    stats: {
      roots: ROOTS, corpus: CORPUS, includePkg: INCLUDE_PKG,
      containersTotal: (() => { let n = 0; for (const r of ROOTS) { try { n += walkContainers(path.join(CORPUS, r)).length } catch { /* 缺根 */ } } return n })(),
      excludedDelete, deleteCopies, deleteCopiesWithScene, unreadable, withSceneAny, withSceneMpkg,
      kept: all.length, keptMpkg: all.filter((r) => /\.mpkg$/i.test(r.rel)).length,
      keptPkg: all.filter((r) => !/\.mpkg$/i.test(r.rel)).length,
    },
  }
}

let ENUM = null
{
  const e = enumerate()
  ENUM = e
  let rows = e.rows
  if (!INCLUDE_PKG) rows = rows.filter((r) => /\.mpkg$/i.test(r.rel))
  if (ONLY) rows = rows.filter((r) => r.rel.includes(ONLY))
  if (RERUN_BLANK) {
    const sides = RERUN_BLANK === 'both' ? ['repo', 'upstream'] : [RERUN_BLANK]
    let prev = null
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch { /* 还没有旧读数 ⇒ 空集 */ }
    const keep = new Set(((prev && prev.rows) || [])
      .filter((r) => sides.some((s) => r[s] && r[s].status === 'ok' && /^(blank|unmeasured)/.test(String(r[s].onlyBackground || 'unmeasured'))))
      .map((r) => r.rel))
    rows = rows.filter((r) => keep.has(r.rel))
    console.log('   --rerun-blank ' + RERUN_BLANK + '：上一轮"出画但像素不可用"的包 ' + keep.size + ' 个 ⇒ 本档选 ' + rows.length + ' 个')
  }
  ENUM.selected = rows.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined)
  ENUM.filteredTotal = rows.length
}

console.log('== Phase 0 · 渲染器差距矩阵（两档各挂一次）==')
console.log('   语料根   : ' + ROOTS.map((r) => CORPUS + '/' + r).join(' · ') + (ENUM.missingRoots.length ? '（**缺根**：' + ENUM.missingRoots.join(',') + '）' : ''))
console.log('   容器     : 共 ' + ENUM.stats.containersTotal + ' 个 · 排除 delete/ 副本 ' + ENUM.stats.excludedDelete + ' · 目录表读不动 ' + ENUM.stats.unreadable)
console.log('   含 scene : ' + ENUM.stats.withSceneAny + ' 个（.mpkg ' + ENUM.stats.withSceneMpkg + ' / .pkg ' + (ENUM.stats.withSceneAny - ENUM.stats.withSceneMpkg) + '）⇒ 本档取 ' + ENUM.stats.kept + ' 个（.mpkg ' + ENUM.stats.keptMpkg + ' / .pkg ' + ENUM.stats.keptPkg + '）' + (INCLUDE_PKG ? '' : ' · --mpkg-only'))
console.log('   魔数分布 : ' + Object.entries(ENUM.magicTally).sort().map(([k, v]) => k + '×' + v).join(' · '))
console.log('   本批     : offset=' + OFFSET + ' limit=' + (LIMIT || '不限') + ' ⇒ ' + ENUM.selected.length + ' 个 · 两档 ' + SIDES.join('+') + ' · 视口 ' + VW + '×' + VH + '@' + DSF + ' · 上限 ' + Math.round(TIMEOUT / 1000) + 's/次')
console.log('   可用内存 : ' + memMB() + 'MB（下限 ' + MIN_FREE_MB + 'MB / 途中停批 ' + ABORT_FREE_MB + 'MB）')
if (has('--enum-only')) {
  for (const r of ENUM.selected) console.log('  ' + r.rel + '  → ' + r.mb + 'MB · ' + r.magic + ' · ' + r.entries + ' 条目' + (r.hasProjectJson ? ' · 含 project.json' : ''))
  console.log('\n--enum-only：共 ' + ENUM.selected.length + ' 个（未启动浏览器）')
  process.exit(0)
}
if (!ENUM.selected.length) { console.log('SKIP renderer-gap-matrix —— 本批没有匹配的包'); process.exit(0) }

/* ── 跑前：全量套件不取锁 ⇒ 有就跑者等它（任务书口径）──────────────────────────────────── */
{
  const suite = () => {
    try {
      return execSync('pgrep -af run-all-tests', { encoding: 'utf8' }).trim().split('\n')
        .filter((l) => l && !/pgrep|renderer-gap-matrix/.test(l))
    } catch { return [] }
  }
  for (let i = 0; i < 20; i++) {
    const running = suite()
    if (!running.length) break
    console.log('   ⏳ 全量套件在跑（' + running[0].slice(0, 100) + '）⇒ sleep 60 等它结束（' + (i + 1) + '/20）')
    execSync('sleep 60')
  }
}
/* 同一时刻只允许一个 Firefox（本机纪律；另一条音频线也用同一把 flock，正常不会撞上） */
{
  const others = (() => {
    try {
      return execSync('pgrep -af firefox', { encoding: 'utf8' }).trim().split('\n').filter((l) => l && !/pgrep|renderer-gap-matrix/.test(l))
    } catch { return [] }
  })()
  if (others.length && !has('--force')) {
    console.log('SKIP renderer-gap-matrix —— 已有 Firefox 在跑（本机纪律：同一时刻只允许一个）：\n' + others.map((l) => '    ' + l.slice(0, 140)).join('\n') + '\n    等它跑完再跑本档，或显式 --force')
    process.exit(0)
  }
}

const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP renderer-gap-matrix —— 找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP renderer-gap-matrix —— playwright 没有 firefox 导出'); process.exit(0) }

/* ── 离线：scene.json 的层数 + project.json 文本（产物 `loadSceneFile(blob, project)` 要它；缺就 null）── */
const pkgMeta = (abs) => {
  const out = { sceneLayers: null, sceneVisible: null, project: null, note: null }
  try {
    const idx = readIndexHead(abs)
    const sc = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
    if (sc) {
      try {
        const j = JSON.parse(readEntryBytes(abs, idx, sc).toString('utf8'))
        const objs = (j && j.objects) || []
        out.sceneLayers = objs.length
        out.sceneVisible = objs.filter((o) => { const v = o.visible; return v === undefined || v === true || (v && typeof v === 'object') }).length
      } catch (e) { out.note = 'scene.json 解析: ' + String(e.message).slice(0, 80) }
    }
    const pj = idx.entries.find((x) => /(^|\/)project\.json$/i.test(x.name))
    if (pj) { try { out.project = JSON.parse(readEntryBytes(abs, idx, pj).toString('utf8')) } catch { out.project = null } }
  } catch (e) { out.note = '目录表: ' + String(e.message).slice(0, 80) }
  return out
}

/* ── 页面内读数：本仓（`#log` + `__mpw*` 全局）──────────────────────────────────────────── */
const REPO_STATE = () => {
  const g = (k) => { try { return window[k] } catch (e) { return null } }
  const cv = document.getElementById('sc') || document.querySelector('canvas')
  const logTxt = (() => { try { const el = document.getElementById('log'); return el ? String(el.textContent || '') : '' } catch (e) { return '' } })()
  const lines = logTxt.split('\n').map((s) => s.trim()).filter(Boolean)
  const ls = g('__sceneLayers'); const ts = g('__mpwTexStats'); const lr = g('__mpwLiveRes')
  const ff = (() => { const m = /✅ 首帧完成 (\d+)ms/.exec(logTxt); return m ? Number(m[1]) : null })()
  const be = g('__mpwBootError')
  return {
    canvas: cv ? { w: cv.width, h: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight } : null,
    layers: Array.isArray(ls) ? ls.length : null,
    texStats: Array.isArray(ts) ? ts.length : null,
    liveRes: lr ? { w: lr.width, h: lr.height } : null,
    firstFrame: !!g('__mpwFirstFrame'),
    firstFrameMs: ff,
    bootError: be ? String((be && be.message) || be).slice(0, 200) : null,
    logFatal: (logTxt.match(/❌/g) || []).length,
    logWarn: (logTxt.match(/⚠/g) || []).length,
    logLines: lines.slice(-60).map((s) => s.slice(0, 300)),
    /* **只把带 ❌/⚠ 的行**当错误面（`#log` 里大量行是信息行：`scene.json 解析: 3 layers`、`✅ 首帧完成`…，
       拿它们归类会得出一堆假错误类 —— 首版冒烟就踩过，这里按标记行过滤）。 */
    logErrorLines: lines.filter((s) => /❌|⚠/.test(s)).slice(-40).map((s) => s.slice(0, 300)),
  }
}

/* ── 页面内读数：产物（无 `#log`；canvas + `__wpStats`；日志走 console 捕获）────────────── */
const UP_STATE = () => {
  const cvs = [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight }))
  const best = cvs.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || null
  let stats = null
  try { stats = window.__wpStats ? JSON.parse(JSON.stringify(window.__wpStats)) : null } catch (e) { stats = { err: String(e.message).slice(0, 60) } }
  return {
    canvas: best, canvases: cvs, stats,
    wpReady: !!(window.__wp && typeof window.__wp.loadSceneFile === 'function'),
    wpMethods: window.__wp ? Object.keys(window.__wp).length : 0,
    bodyKids: document.body.children.length,
    cap: Array.isArray(window.__mpwCap) ? window.__mpwCap.slice(-24) : [],
    rej: Array.isArray(window.__mpwRej) ? window.__mpwRej.slice(-8) : [],
  }
}
/* 产物侧 console 捕获（在**页面脚本之前**装）：Playwright 的 `msg.text()` 对 `console.warn("…", err)` 只给
   "scene render failed: Error" —— 真消息在第二个实参里（实测：`不是 scene.pkg，魔数: PKGM0014`）。
   所以必须在页面内把实参逐个 stringify。 */
const UP_CONSOLE_HOOK = () => {
  window.__mpwCap = []; window.__mpwRej = []
  const fmt = (x) => {
    try {
      if (x instanceof Error) return String(x.message || x.name || 'Error')
      if (typeof x === 'object' && x !== null) { try { return JSON.stringify(x).slice(0, 200) } catch (e) { return '[obj]' } }
      return String(x)
    } catch (e) { return '?' }
  }
  for (const k of ['warn', 'error']) {
    const orig = console[k] ? console[k].bind(console) : () => {}
    console[k] = (...a) => { try { window.__mpwCap.push(k + ': ' + a.map(fmt).join(' ').slice(0, 300)) } catch (e) { /* 满/冻结 */ } return orig(...a) }
  }
  window.addEventListener('unhandledrejection', (e) => { try { window.__mpwRej.push(fmt(e.reason)) } catch (err) { /* 忽略 */ } })
  window.addEventListener('error', (e) => { try { window.__mpwRej.push('error: ' + String(e.message || '')) } catch (err) { /* 忽略 */ } })
}

/* 产物"出画"判据：存在 w/h>0 且**不是 300×150** 的 canvas（未挂载时产物一个 canvas 都没有）。
   300×150 = HTML canvas 默认尺寸，是"建了但没设过尺寸"的签名，按任务书口径排除。 */
const upCanvasOK = (st) => !!(st && st.canvas && st.canvas.w > 0 && st.canvas.h > 0 && !(st.canvas.w === 300 && st.canvas.h === 150))

/* ── 像素读数（截画布那一块 → 页面内解码 → 只回读数；与 mpkg-sweep 同款）──────────────────── */
const PIXEL_STATS = async (page, probe, box, name) => {
  if (!box || box.width < 2 || box.height < 2) return { err: '没有可截的画布盒' }
  const clip = {
    x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)),
    width: Math.max(1, Math.min(Math.floor(box.width), VW - Math.max(0, Math.floor(box.x)))),
    height: Math.max(1, Math.min(Math.floor(box.height), VH - Math.max(0, Math.floor(box.y)))),
  }
  if (clip.width < 2 || clip.height < 2) return { err: '画布盒不在视口内' }
  try {
    const buf = await page.screenshot({ clip })
    if (SAVE_SHOTS) { try { fs.mkdirSync(SAVE_SHOTS, { recursive: true }); fs.writeFileSync(path.join(SAVE_SHOTS, String(name || 'shot').replace(/[^\w.\u4e00-\u9fa5-]+/g, '_').slice(-70) + '.png'), buf) } catch { /* 存不下就算了 */ } }
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
      return { w: c.width, h: c.height, meanL: +mean.toFixed(3), maxL: +max.toFixed(1), stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3), litFrac: +(lit / n).toFixed(4) }
    }, 'data:image/png;base64,' + buf.toString('base64'))
    return r
  } catch (e) { return { err: String((e && e.message) || e).slice(0, 140) } }
}
/** 像素读数 → "是否只有背景"的人读标签（测不到就 unmeasured，不猜）。 */
const onlyBackgroundLabel = (px) => {
  if (!px || px.err || px.maxL == null) return 'unmeasured'
  if (px.maxL <= 1) return 'blank（全黑，可能没出画）'
  if (px.stdL < 0.6) return 'uniform（整块一个色 = 疑似只有背景）'
  return 'content（有非均匀内容）'
}
const canvasBox = async (page, pick) => {
  try {
    return await page.evaluate((which) => {
      const cvs = [...document.querySelectorAll('canvas')]
      const c = which === 'biggest' ? cvs.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] : (document.getElementById('sc') || cvs[0])
      if (!c) return null
      const r = c.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }, pick)
  } catch { return null }
}

/* ── 起浏览器 ─────────────────────────────────────────────────────────────────────────── */
const { browser, launchNote } = await launchGLBrowser(firefox)
const results = []
let aborted = null
let glInfo = null
try {
  const gl = await glCapability(browser)
  glInfo = gl
  if (!gl.webgl2) {
    logGLSkip('渲染器差距矩阵（offset=' + OFFSET + ' limit=' + (LIMIT || '不限') + '）', launchNote, gl, '画布/像素类读数一律不可信')
    glSkipWhy()
    await closeQuiet(browser)
    process.exit(0)
  }
  console.log('   GL 前置: ' + glReading(launchNote, gl))
  const probeCtx = await browser.newContext({ viewport: { width: 400, height: 300 } })
  const probe = await probeCtx.newPage()
  await probe.goto('about:blank')

  for (const r of ENUM.selected) {
    const free0 = memMB()
    if (free0 != null && free0 < MIN_FREE_MB) {
      aborted = '换包前可用内存 ' + free0 + 'MB < 下限 ' + MIN_FREE_MB + 'MB ⇒ 主动停批（余下未跑）'
      console.log('  ⛔ ' + aborted)
      break
    }
    const meta = pkgMeta(r.abs)
    const rec = {
      rel: r.rel, root: r.root, abs: r.abs, mb: r.mb, magic: r.magic, entries: r.entries,
      hasProjectJson: r.hasProjectJson, upstreamMagicOK: r.upstreamMagicOK,
      sceneLayers: meta.sceneLayers, sceneVisible: meta.sceneVisible,
      repo: { status: 'skipped' }, upstream: { status: 'skipped' },
      verdict: null, freeBefore: free0, note: meta.note || null,
    }
    console.log('\n── [' + (results.length + 1) + '/' + ENUM.selected.length + '] ' + r.rel + '  (' + r.mb + 'MB ' + r.magic + '/' + r.entries + ' 条目, scene 层 ' + (meta.sceneLayers == null ? '?' : meta.sceneLayers) + ', 可用 ' + free0 + 'MB)')

    /* ── ① 本仓档 ───────────────────────────────────────────────────────────────────── */
    if (SIDES.includes('repo')) {
      const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF })
      const page = await ctx.newPage()
      const pageErrors = []
      page.on('pageerror', (e) => { if (pageErrors.length < 6) pageErrors.push(String((e && e.message) || e).slice(0, 300)) })
      const t0 = Date.now()
      const url = 'http://' + AUTHORITY + '/webloader/?type=scene&id=' + encodeURIComponent(path.basename(r.rel).replace(/\.[^.]+$/, ''))
        + '&pkgpath=' + encodeURIComponent(r.abs) + '&res=' + encodeURIComponent(RES) + '&shell=0'
      const out = { url, status: null, firstFrameMs: null, firstSeenMs: null, canvas: null, layers: null, texStats: null, errorClass: null, errorLine: null, logFatal: 0, logWarn: 0, pageErrors, pixel: null, onlyBackground: null, timeout: false, ms: null, logTail: [], memAbort: false }
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        let st = null
        for (;;) {
          await page.waitForTimeout(POLL)
          const fm = memMB()
          if (fm != null && fm < ABORT_FREE_MB) {
            out.memAbort = true; aborted = '包 `' + r.rel + '` 渲染途中可用内存 ' + fm + 'MB < ' + ABORT_FREE_MB + 'MB ⇒ 停批'
            break
          }
          st = await page.evaluate(REPO_STATE).catch(() => null)
          if (!st) break
          if (st.firstFrame) { out.status = 'ok'; out.firstSeenMs = Date.now() - t0; break }
          if (st.bootError) { out.status = 'fail'; break }
          if (Date.now() - t0 > TIMEOUT) { out.status = 'timeout'; out.timeout = true; break }
        }
        if (st) {
          if (SETTLE > 0 && out.status === 'ok') {
            /* 出画后再等一等才读数（视频解码/淡入/纹理上传都可能晚于"首个已完成帧"） */
            await page.waitForTimeout(SETTLE)
            const st2 = await page.evaluate(REPO_STATE).catch(() => null)
            if (st2) st = st2
            out.settleMs = SETTLE
          }
          out.canvas = st.canvas; out.layers = st.layers; out.texStats = st.texStats
          out.firstFrameMs = st.firstFrameMs; out.logFatal = st.logFatal; out.logWarn = st.logWarn
          out.logTail = st.logLines.slice(-14)
          if (st.bootError) { out.bootError = st.bootError; out.status = 'fail' }
          if (!NO_PIXELS) {
            const box = st.canvas ? await canvasBox(page, 'sc') : null
            out.pixel = await PIXEL_STATS(page, probe, box, 'repo_' + r.rel)
            out.onlyBackground = onlyBackgroundLabel(out.pixel)
          } else out.onlyBackground = 'unmeasured'
          if (out.status === 'ok' && st.firstFrameMs != null) out.firstFrameMs = st.firstFrameMs
          out.errorLines = (st.logErrorLines || []).slice(-8)
          out.passSkips = passSkipsOf(st.logErrorLines || [])
          const cls = classifyLines([...(st.logErrorLines || []), ...(st.bootError ? [st.bootError] : [])])
          if (cls) {
            /* 出画的包里 ⚠ 常常是**信息性**的（档位回显/首帧台账/`缺 model:` 兜底）⇒ 只当 `warnClass` 留痕，
               不污染失败类直方图；失败行（❌）才落 `errorClass`。 */
            if (out.status === 'ok') { out.warnClass = cls.tag; out.warnLine = cls.line } else { out.errorClass = cls.tag; out.errorLine = cls.line }
          }
        }
        if (out.memAbort) out.status = 'abort'
      } catch (e) {
        out.status = out.status || 'fail'
        out.probeError = String((e && e.message) || e).slice(0, 200)
      } finally { await ctx.close().catch(() => {}) }
      /* 出画但日志里有 ❌：**不改判定**（首帧已到），只如实留错误类（失败类直方图分"有画但有错"看）。 */
      if (out.status === 'ok' && out.errorClass && /❌/.test(out.logTail.join('\n'))) out.note2 = '出画但有 ❌（错误类 ' + out.errorClass + '）'
      out.ms = Date.now() - t0
      if (out.status === 'ok' && !out.canvas) out.status = 'fail'
      if (out.status === 'ok' && out.canvas && (out.canvas.w <= 0 || out.canvas.h <= 0)) out.status = 'fail'
      rec.repo = out
      console.log('   本仓 → ' + out.status + ' | 首帧 ' + (out.firstFrameMs == null ? (out.firstSeenMs == null ? '-' : '~' + out.firstSeenMs) : out.firstFrameMs) + 'ms | 画布 ' + (out.canvas ? out.canvas.w + '×' + out.canvas.h : '-')
        + ' | 层 ' + out.layers + ' tex ' + out.texStats + ' | 错类 ' + (out.errorClass || '-') + ' | 背景? ' + out.onlyBackground
        + ' | ❌' + out.logFatal + ' ⚠' + out.logWarn + ' | ' + Math.round(out.ms / 1000) + 's')
      if (out.errorLine) console.log('      ↳ ' + out.errorLine)
      if (out.probeError) console.log('      ↳ 探针异常: ' + out.probeError)
      if (out.memAbort) break
    }

    /* ── ② 产物档 ───────────────────────────────────────────────────────────────────── */
    if (SIDES.includes('upstream')) {
      const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF })
      const page = await ctx.newPage()
      const pageErrors = []; const cons = []
      page.on('pageerror', (e) => { if (pageErrors.length < 6) pageErrors.push(String((e && e.message) || e).slice(0, 300)) })
      page.on('console', (m) => {
        const t = m.type(); if (t !== 'warning' && t !== 'error') return
        if (cons.length < 24) cons.push('[' + t + '] ' + String(m.text()).slice(0, 300))
      })
      /* 页面内 console 实参捕获（`msg.text()` 拿不到 Error 实参的真消息，见 UP_CONSOLE_HOOK 注释） */
      await page.addInitScript(UP_CONSOLE_HOOK)
      const t0 = Date.now()
      const url = 'http://' + AUTHORITY + '/wallpaper-engine-webgl/renderer/index.html?type=scene&id='
        + encodeURIComponent(path.basename(r.rel).replace(/\.[^.]+$/, '')) + '&pkgpath=' + encodeURIComponent(r.abs)
      const out = { url, mount: 'loadSceneFile(blob, projectJson)（产物页不认 ?pkgpath=/?id=，探测①）', status: null, bytes: null, firstSeenMs: null, canvas: null, canvases: null, stats: null, errorClass: null, errorLine: null, pageErrors, console: cons, cap: [], rej: [], pixel: null, onlyBackground: null, timeout: false, ms: null, memAbort: false }
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForFunction(() => window.__wp && typeof window.__wp.loadSceneFile === 'function', null, { timeout: 30000 })
        /* 挂载：包字节在**页面内**取（同一条 /pkgpath 服务端通路），project.json 由 Node 侧从容器里解出来喂进去 */
        const boot = await page.evaluate(async ({ p, project }) => {
          try {
            const rs = await fetch('/pkgpath?p=' + encodeURIComponent(p), { cache: 'no-store' })
            if (!rs.ok) return { err: 'HTTP ' + rs.status }
            const buf = await rs.arrayBuffer()
            window.__wp.loadSceneFile(new Blob([buf], { type: 'application/octet-stream' }), project)
            return { bytes: buf.byteLength }
          } catch (e) { return { err: String((e && e.message) || e).slice(0, 160) } }
        }, { p: r.abs, project: meta.project }).catch((e) => ({ err: 'evaluate: ' + String((e && e.message) || e).slice(0, 120) }))
        out.bytes = boot && boot.bytes != null ? boot.bytes : null
        if (boot && boot.err) out.mountError = boot.err
        let st = null
        let fatalAt = null
        for (;;) {
          await page.waitForTimeout(POLL)
          const fm = memMB()
          if (fm != null && fm < ABORT_FREE_MB) {
            out.memAbort = true; aborted = '包 `' + r.rel + '` 产物档渲染途中可用内存 ' + fm + 'MB < ' + ABORT_FREE_MB + 'MB ⇒ 停批'
            break
          }
          st = await page.evaluate(UP_STATE).catch(() => null)
          if (!st) break
          const seen = [...(st.cap || []), ...(st.rej || []), ...cons]
          if (upCanvasOK(st)) { out.status = 'ok'; out.firstSeenMs = Date.now() - t0; out.cap = st.cap || []; out.rej = st.rej || []; break }
          /* 产物把挂载失败写成 console.warn（`scene render failed: 不是 scene.pkg，魔数: PKGM0014` …）：
             见到致命行再给 8s 宽限，仍没有画布就按失败收（不必等满 90s；读数里留原样行）。 */
          const fatal = seen.find((l) => /scene render failed|scene render error|不是 scene\.pkg|魔数|缺少 mediaBase|未支持的纹理格式/i.test(l))
          if (fatal && fatalAt == null) fatalAt = Date.now()
          if (fatalAt != null && Date.now() - fatalAt > 8000) { out.status = 'fail'; out.cap = st.cap || []; out.rej = st.rej || []; break }
          if (Date.now() - t0 > TIMEOUT) { out.status = 'timeout'; out.timeout = true; out.cap = st.cap || []; out.rej = st.rej || []; break }
        }
        if (st) {
          if (SETTLE > 0 && out.status === 'ok') {
            /* 出画后再等一等才读数（产物侧尤其：canvas 是**挂载时**就建好的，首帧可能还没画上去） */
            await page.waitForTimeout(SETTLE)
            const st2 = await page.evaluate(UP_STATE).catch(() => null)
            if (st2) st = st2
            out.settleMs = SETTLE
          }
          out.canvas = st.canvas; out.canvases = st.canvases; out.stats = st.stats; out.wpMethods = st.wpMethods; out.bodyKids = st.bodyKids
          out.cap = st.cap || out.cap; out.rej = st.rej || out.rej
          if (out.status == null) out.status = upCanvasOK(st) ? 'ok' : 'fail'
          if ((out.status === 'ok' || upCanvasOK(st)) && !NO_PIXELS) {
            const box = await canvasBox(page, 'biggest')
            out.pixel = await PIXEL_STATS(page, probe, box, 'up_' + r.rel)
            out.onlyBackground = onlyBackgroundLabel(out.pixel)
          } else out.onlyBackground = 'unmeasured'
        }
        if (!out.status) out.status = boot && boot.err ? 'fail' : (out.timeout ? 'timeout' : 'fail')
        if (out.memAbort) out.status = 'abort'
        const cls = classifyLines([...(out.cap || []), ...(out.rej || []), ...cons, ...pageErrors, ...(out.mountError ? [out.mountError] : [])])
        out.passSkips = passSkipsOf([...(out.cap || []), ...cons])
        if (cls) {
          if (out.status === 'ok') { out.warnClass = cls.tag; out.warnLine = cls.line } else { out.errorClass = cls.tag; out.errorLine = cls.line }
        }
      } catch (e) {
        out.status = out.status || 'fail'
        out.probeError = String((e && e.message) || e).slice(0, 200)
      } finally { await ctx.close().catch(() => {}) }
      out.ms = Date.now() - t0
      if (out.status === 'ok' && !upCanvasOK({ canvas: out.canvas })) out.status = 'fail'
      rec.upstream = out
      console.log('   产物 → ' + out.status + ' | 首次见画布 ' + (out.firstSeenMs == null ? '-' : '~' + out.firstSeenMs) + 'ms | 画布 ' + (out.canvas ? out.canvas.w + '×' + out.canvas.h : '-')
        + ' | bytes ' + out.bytes + ' | 错类 ' + (out.errorClass || '-') + ' | 背景? ' + out.onlyBackground + ' | warn/err ' + cons.length + ' | ' + Math.round(out.ms / 1000) + 's')
      if (out.errorLine) console.log('      ↳ ' + out.errorLine)
      if (out.probeError) console.log('      ↳ 探针异常: ' + out.probeError)
      if (out.memAbort) break
    }

    /* ── 定性 ───────────────────────────────────────────────────────────────────────── */
    const okOf = (s) => s && s.status === 'ok'
    const sk = (s) => !s || s.status === 'skipped'
    if (sk(rec.repo) || sk(rec.upstream)) rec.verdict = 'partial（只跑了一档：' + SIDES.join('+') + '）'
    else if (okOf(rec.repo) && okOf(rec.upstream)) rec.verdict = 'both-ok'
    else if (okOf(rec.upstream) && !okOf(rec.repo)) rec.verdict = 'upstream-only'
    else if (okOf(rec.repo) && !okOf(rec.upstream)) rec.verdict = 'repo-only'
    else rec.verdict = 'both-fail'
    rec.freeAfter = memMB()
    results.push(rec)
    console.log('   ⇒ ' + rec.verdict + '（可用内存 ' + free0 + '→' + rec.freeAfter + 'MB）')
    if (aborted) break
  }
  await probeCtx.close().catch(() => {})
} finally {
  await closeQuiet(browser)
}

/* ── 合并进 --out（按 rel 增量；分多批跑完 = 一份完整 JSON）───────────────────────────────── */
const loadPrior = () => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch { return null } }
const prior = RETAIN_ROWS ? loadPrior() : null
const byRel = new Map()
for (const row of ((prior && prior.rows) || [])) byRel.set(row.rel, row)
for (const row of results) {
  const old = byRel.get(row.rel)
  if (!old) { byRel.set(row.rel, row); continue }
  /* 只覆盖**本次真跑过的那一档**，另一档保留旧读数（--repo-only / 单档补跑不会把另一档抹掉） */
  const merged = { ...old, ...row }
  for (const side of ['repo', 'upstream']) {
    if (row[side] && row[side].status === 'skipped' && old[side] && old[side].status !== 'skipped') merged[side] = old[side]
  }
  merged.verdict = null
  const okOf = (s) => s && s.status === 'ok'
  const sk = (s) => !s || s.status === 'skipped'
  if (sk(merged.repo) || sk(merged.upstream)) merged.verdict = 'partial'
  else if (okOf(merged.repo) && okOf(merged.upstream)) merged.verdict = 'both-ok'
  else if (okOf(merged.upstream) && !okOf(merged.repo)) merged.verdict = 'upstream-only'
  else if (okOf(merged.repo) && !okOf(merged.upstream)) merged.verdict = 'repo-only'
  else merged.verdict = 'both-fail'
  byRel.set(row.rel, merged)
}
const allRows = [...byRel.values()].sort((a, b) => (b.mb || 0) - (a.mb || 0) || a.rel.localeCompare(b.rel))
const tally = (pred) => allRows.filter(pred).length
const counts = {
  enumerated: allRows.length,
  measuredBoth: tally((r) => r.verdict && r.verdict !== 'partial'),
  partial: tally((r) => !r.verdict || r.verdict === 'partial'),
  bothOk: tally((r) => r.verdict === 'both-ok'),
  upstreamOnly: tally((r) => r.verdict === 'upstream-only'),
  repoOnly: tally((r) => r.verdict === 'repo-only'),
  bothFail: tally((r) => r.verdict === 'both-fail'),
}
const hist = (side) => {
  const h = {}
  for (const r of allRows) {
    const s = r[side]; if (!s || s.status === 'ok' || s.status === 'skipped') continue
    const tag = s.errorClass || (s.status === 'timeout' ? 'timeout' : s.status === 'abort' ? 'abort-mem' : 'no-log-class')
    if (!h[tag]) h[tag] = { n: 0, sample: null, sampleRel: null, statuses: {} }
    h[tag].n++
    h[tag].statuses[s.status] = (h[tag].statuses[s.status] || 0) + 1
    if (!h[tag].sample) { h[tag].sample = s.errorLine || (s.bootError || s.probeError || (s.console && s.console[0]) || '').slice(0, 220) || null; h[tag].sampleRel = r.rel }
  }
  return Object.fromEntries(Object.entries(h).sort((a, b) => b[1].n - a[1].n))
}
const brief = (r, side) => {
  const s = r[side] || {}
  return {
    rel: r.rel, mb: r.mb, magic: r.magic, sceneLayers: r.sceneLayers, verdict: r.verdict, upstreamMagicOK: r.upstreamMagicOK,
    status: s.status, errorClass: s.errorClass || null, errorLine: s.errorLine || null, warnClass: s.warnClass || null,
    canvas: s.canvas ? s.canvas.w + '×' + s.canvas.h : null, firstFrameMs: s.firstFrameMs == null ? (s.firstSeenMs == null ? null : '~' + s.firstSeenMs) : s.firstFrameMs,
    layers: s.layers == null ? null : s.layers, texStats: s.texStats == null ? null : s.texStats,
    onlyBackground: s.onlyBackground || null, timeout: !!s.timeout, ms: s.ms,
  }
}
const output = {
  at: new Date().toISOString(),
  script: 'we-scene-demo/tests/renderer-gap-matrix.mjs',
  plan: 'we-scene-demo/docs/RENDERER-UNIFY-FINAL-PLAN.md §1/§2 Phase 0',
  authority: AUTHORITY,
  viewport: { width: VW, height: VH, deviceScaleFactor: DSF },
  repoUrlShape: 'http://' + AUTHORITY + '/webloader/?type=scene&id=<id>&pkgpath=<abs>&res=' + RES + '&shell=0',
  upstreamUrlShape: 'http://' + AUTHORITY + '/wallpaper-engine-webgl/renderer/index.html?type=scene&id=<id>&pkgpath=<abs>',
  upstreamMountContract: 'window.__wp.loadSceneFile(new Blob([bytes]), projectJson)；包字节由页面内 fetch(/pkgpath?p=<abs>) 取。理由：产物页只认 type/src/fit/renderDpr/sceneFps/muted/loop/filter/mediaBase/liveSystem/opaque 共 11 个参数，不认 ?pkgpath=/?id=（实测：直开只挂默认壁纸 iframe、无 canvas）',
  judgements: {
    repoOk: 'window.__mpwFirstFrame 为真（demo.html:8353）；首帧 ms 取 #log 的 `✅ 首帧完成 <ms>ms`',
    upstreamOk: '出现 w/h>0 且不等于 300×150 的 canvas（未挂载时产物一个 canvas 都没有）；产物页**没有** #log/#logbody，错误面 = console.warn/error',
    upstreamFatal: 'console.warn 命中 scene render failed / scene render error / 不是 scene.pkg / 缺少 mediaBase 后 8s 仍无画布 ⇒ fail（不用等满超时）',
    onlyBackground: '画布截图 → meanL/maxL/stdL/litFrac：maxL<=1 = blank；stdL<0.6 = uniform（疑似只有背景）；截不到 = unmeasured',
    timeoutsMs: TIMEOUT,
    upstreamContainerMagic: '产物的读包函数只吃**以 PKGV 开头**的魔数（minified bundle 静态命中：`if(!r.startsWith("PKGV"))throw new Error("不是 scene.pkg，魔数: "+r)`）⇒ PKGM0014/PKGM0018（本仓 .mpkg 语料）在产物侧结构性不可加载；该结论另有 /tmp 对照实验（把同一份字节的魔数改成 PKGV 后产物即出画，见 docs/reports/renderer-gap-matrix.md §判据来源）。行内 `upstreamMagicOK` 即该静态判据。',
  },
  watchdog: { minFreeMb: MIN_FREE_MB, abortFreeMb: ABORT_FREE_MB, pollMs: POLL },
  corpus: ENUM.stats,
  missingRoots: ENUM.missingRoots,
  magicTally: ENUM.magicTally,
  counts,
  histogram: { repoFail: hist('repo'), upstreamFail: hist('upstream') },
  tables: {
    upstreamOnly: allRows.filter((r) => r.verdict === 'upstream-only').map((r) => brief(r, 'upstream')),
    repoOnly: allRows.filter((r) => r.verdict === 'repo-only').map((r) => brief(r, 'repo')),
    bothFail: allRows.filter((r) => r.verdict === 'both-fail').map((r) => ({ rel: r.rel, mb: r.mb, magic: r.magic, repo: brief(r, 'repo'), upstream: brief(r, 'upstream') })),
  },
  runs: [...((prior && prior.runs) || []), {
    at: new Date().toISOString(), offset: OFFSET, limit: LIMIT || null, sides: SIDES, roots: ROOTS, only: ONLY || null,
    selected: ENUM.selected.length, measured: results.length, aborted, launchNote, gl: glInfo ? glReading(launchNote, glInfo) : null,
  }],
  rows: allRows,
  measuredThisRun: results.map((r) => ({ rel: r.rel, repo: r.repo.status, upstream: r.upstream.status, verdict: r.verdict })),
}
try {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(output, null, 1))
  console.log('\n读数已落盘（按 rel 合并）: ' + OUT)
} catch (e) { console.log('\n⚠ 读数落盘失败: ' + e.message) }

/* ── 累计三表（人读摘要；报告由 agent 依本 JSON 撰写）────────────────────────────────────── */
console.log('\n== 累计（' + allRows.length + ' 个包 · 两档都测过 ' + counts.measuredBoth + ' / 只测一档 ' + counts.partial + '）==')
console.log('   产物独有 ' + counts.upstreamOnly + ' · 本仓独有 ' + counts.repoOnly + ' · 两边都出画 ' + counts.bothOk + ' · 两边都失败 ' + counts.bothFail)
console.log('\n| 包 | MB | 魔数 | 产物 | 本仓 | 判 |')
console.log('| --- | --- | --- | --- | --- | --- |')
for (const r of ENUM.selected) {
  const m = byRel.get(r.rel)
  if (!m) continue
  const f = (s) => !s || s.status === 'skipped' ? '-' : (s.status + (s.errorClass ? '(' + s.errorClass + ')' : '') + (s.canvas ? ' ' + s.canvas.w + '×' + s.canvas.h : ''))
  console.log('| `' + r.rel + '` | ' + m.mb + ' | ' + m.magic + ' | ' + f(m.upstream) + ' | ' + f(m.repo) + ' | ' + m.verdict + ' |')
}
if (aborted) console.log('\n⛔ 本批提前停止：' + aborted)
console.log('\n本次逐包判定: ' + JSON.stringify(output.measuredThisRun))
process.exit(0)

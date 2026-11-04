// blob-media-retry-test.mjs — 上游 Firefox Bug 2056444（**blob 喂媒体首次 load 静默挂住**）的页内兜底判据。
//
// 被验的对象：`demo.html` 里那一个共用的**有界重试看门狗** `mpwBlobMediaRetry(el, label)`
// （夹在 `// ═══ MPW-BLOBRETRY-BEGIN/END ═══` 之间）+ **每一处** blob→媒体元素的接线。
//
// 为什么需要（已定性，本文件不重新证）：Bug 2005247（Firefox 152 起）把 blob 数据改成内容进程经 IPC 读
//   （`RemoteLazyInputStream`），blob > 1MB 的 IPC 内联上限时流不再同步报长度 ⇒
//   `CloneableWithRangeMediaResource` 在异步 IPC 流上做同步读 ⇒ 首次元数据读（MP4 的 moov 常在尾部 =
//   远端 seek）挂住：`readyState` 恒 0、`networkState` 恒 1、不触发 error、`play()` 永不 settle。
//   四条实测证据：tests/mpkg-video-codec-probe.mjs · tests/mpkg-video-decode-probe.mjs ·
//   tests/mpkg-videobase-live-probe.mjs · tests/mpkg-videobase-recovery-probe.mjs（后者实测"只补一次
//   load() 就恢复"）。上游已修：155 nightly → beta 154 → release 153（153.0.3）/ESR153。
//
// 本文件三层判据（纯 Node、不开浏览器、不读语料、无仓库产物）：
//   S1 结构（**自推导，不硬编码行号**）：扫 demo.html 自己找出"`URL.createObjectURL(...)` 的结果被用来喂
//      `<video>`/`<audio>`/`new Audio()`"的每一处，逐处断言其后 40 行内有看门狗调用；**发现新站点却没接线
//      就红**（新站点若无法被自动判定，也红 —— 逼人工来接线或来登记"为什么不接"）；同时钉住助手函数的
//      源码契约（上游缺陷号 / 四条证据文件名 / "健康浏览器上永不触发" / 只写一个全局）。
//   S2 行为：按 BEGIN/END 标记切出助手函数的**真实源码**，在 mock 元素 + 假时钟上跑 6 个场景
//      （rs 已 ≥1 / rs 0→0→4 / rs 恒 0 / error 非空 / load() 抛错 / 无 window），逐条钉住"最多 2 次、
//      间隔 1500ms、拿到元数据立刻停、健康浏览器零 load()、绝不外泄异常"。
//   S3 变异自证：把 demo.html 复制到隔离目录（只用单文件 copy，**不用 fs.cpSync(recursive)**：本机 /tmp
//      是 tmpfs，递归 cpSync 会 EINVAL），字符串手术真改真跑，断言"期望红集"**精确相等**。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROOT } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const IS_MUTANT = (process.argv.find((a) => a.startsWith('--mutant=')) || '').slice('--mutant='.length) || null
const DEMO = path.join(ROOT, 'demo.html')
const html = fs.readFileSync(DEMO, 'utf8')

let pass = 0, fail = 0
const results = []
function check(name, cond, detail) {
  const ok = !!cond
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
  results.push({ name, ok })
}

const BEGIN = '// ═══ MPW-BLOBRETRY-BEGIN ═══'
const END = '// ═══ MPW-BLOBRETRY-END ═══'
const iBegin = html.indexOf(BEGIN), iEnd = html.indexOf(END)
const HELPER_SRC = (iBegin >= 0 && iEnd > iBegin) ? html.slice(iBegin, iEnd + END.length) : ''
const FN_NAME = (/function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(HELPER_SRC) || [])[1] || ''
const iModule = html.indexOf('<script type="module">')
const LINES = html.split('\n')
const lineOf = (idx) => (idx < 0 ? -1 : html.slice(0, idx).split('\n').length)

console.log('== 上游 Firefox Bug 2056444（blob 喂媒体静默挂住）看门狗：结构 + 行为 + 变异自证 ==')
console.log('   demo.html: 助手 ' + lineOf(iBegin) + '…' + lineOf(iEnd) + ' 行 · 函数名 ' + (FN_NAME || '(缺)') +
  ' · 文件 ' + LINES.length + ' 行' + (IS_MUTANT ? ' · ⚠ 变异模式：' + IS_MUTANT + '（隔离副本 root=' + ROOT + '）' : ''))

/* ───────────────────────── S1：结构（自推导站点清单） ───────────────────────── */
/** 轻量注释/字符串扫描：返回所有注释区间的 [start,end)，用于把注释里举例的 `mpwBlobMediaRetry(el, '…')` 排除掉。 */
function commentRanges(src) {
  const out = []
  let i = 0, mode = null, start = 0
  while (i < src.length) {
    const c = src[i], c2 = src[i + 1]
    if (mode === null) {
      if (c === '/' && c2 === '/') { mode = '//'; start = i; i += 2; continue }
      if (c === '/' && c2 === '*') { mode = '/*'; start = i; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { mode = c; i++; continue }
      i++; continue
    }
    if (mode === '//') { if (c === '\n') { out.push([start, i]); mode = null } i++; continue }
    if (mode === '/*') { if (c === '*' && c2 === '/') { out.push([start, i + 2]); mode = null; i += 2; continue } i++; continue }
    if (c === '\\') { i += 2; continue }
    if (c === mode) { mode = null; i++; continue }
    i++
  }
  if (mode === '//' || mode === '/*') out.push([start, src.length])
  return out
}
const COMMENTS = commentRanges(html)
const inComment = (idx) => COMMENTS.some(([a, b]) => idx >= a && idx < b)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 媒体元素变量登记表（`const v = document.createElement('video')` / `const el = new Audio()`）
const mediaVars = new Map()
for (const m of html.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:document\.createElement\(\s*['"](?:video|audio)['"]\s*\)|new\s+Audio\s*\()/g)) {
  mediaVars.set(m[1], lineOf(m.index))
}
// 接线调用（label 必须是**中文短名**：注释里举例的 `'…'` 不算）
const wireRe = new RegExp(esc(FN_NAME || 'mpwBlobMediaRetry') + "\\s*\\(\\s*([A-Za-z_$][\\w$.]*)\\s*,\\s*'([^']*)'\\s*\\)", 'g')
const wires = []
for (const m of html.matchAll(wireRe)) {
  if (inComment(m.index) || !/[\u4e00-\u9fa5]/.test(m[2])) continue
  wires.push({ idx: m.index, line: lineOf(m.index), el: m[1], label: m[2] })
}
// createObjectURL 站点（接收者 = 它左边的赋值目标）
const sites = []
for (const m of html.matchAll(/URL\.createObjectURL\s*\(/g)) {
  if (inComment(m.index)) continue
  const lineStart = html.lastIndexOf('\n', m.index) + 1
  const prefix = html.slice(lineStart, m.index)
  const rm = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*(?:await\s+)?$/.exec(prefix)
  sites.push({ idx: m.index, line: lineOf(m.index), recv: rm ? rm[1] : null, media: false, rule: '', anchor: -1, why: '' })
}
/** 逐站点判定"这发 objectURL 是不是喂给了媒体元素"（三条数据链规则 + 非媒体消费者兜底）。 */
function classifySite(s) {
  const W = 40
  const recv = s.recv
  if (!recv) { s.why = '无法识别接收者（新写法）⇒ 需人工判定'; return }
  const base = recv.split('.')[0]
  // 规则①直接：`<媒体变量>.src = URL.createObjectURL(...)`
  if (/\.src$/.test(recv) && mediaVars.has(base)) { s.media = true; s.rule = '直接 <' + base + '>.src'; s.anchor = s.line; return }
  // 规则②标识符：其后 40 行内出现 `<媒体变量>.src = …接收者…`
  if (/^[A-Za-z_$][\w$]*$/.test(recv)) {
    for (let l = s.line + 1; l <= Math.min(s.line + W, LINES.length); l++) {
      for (const m of LINES[l - 1].matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\.src\s*=\s*([^\n]*)/g)) {
        if (mediaVars.has(m[1]) && new RegExp('(?:^|[^\\w$.])' + esc(recv) + '(?:[^\\w$]|$)').test(m[2])) {
          s.media = true; s.rule = '第 ' + l + ' 行 <' + m[1] + '>.src = ' + recv; s.anchor = l; return
        }
      }
    }
  } else if (recv.includes('.')) {
    // 规则③属性：`rec.blobUrl = objectURL` ⇒ 找"包住它的函数"的调用点，再看那个返回值有没有进媒体 src
    const pre = html.slice(0, s.idx)
    const fm = [...pre.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)].pop()
    if (fm) {
      const fn = fm[1]
      for (let l = s.line + 1; l <= Math.min(s.line + W, LINES.length); l++) {
        const mm = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*' + esc(fn) + '\\s*\\(').exec(LINES[l - 1])
        if (!mm) continue
        const alias = mm[1]
        for (let l2 = l + 1; l2 <= Math.min(l + W, LINES.length); l2++) {
          for (const m2 of LINES[l2 - 1].matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\.src\s*=\s*([^\n]*)/g)) {
            if (mediaVars.has(m2[1]) && new RegExp('(?:^|[^\\w$.])' + esc(alias) + '(?:[^\\w$]|$)').test(m2[2])) {
              s.media = true; s.rule = fn + '() → 第 ' + l2 + ' 行 <' + m2[1] + '>.src = ' + alias; s.anchor = l2; return
            }
          }
        }
      }
    }
  }
  // 非媒体消费者（字体 / iframe / 下载 <a>）：在站点前后 40 行里找证据
  const lo = Math.max(1, s.line - W), hi = Math.min(LINES.length, s.line + W)
  const win = LINES.slice(lo - 1, hi).join('\n')
  if (/new\s+FontFace\s*\(/.test(win)) { s.why = '← FontFace（CSS 字体，不是 <video>/<audio>）'; return }
  if (/createElement\(\s*['"]iframe['"]\s*\)|contentWindow|contentDocument/.test(win)) { s.why = '← iframe（文档帧，不是 <video>/<audio>）'; return }
  s.why = '判不出来（既不像媒体、也找不到非媒体消费者）'
}
for (const s of sites) classifySite(s)
const mediaSites = sites.filter((s) => s.media)
const unresolvedSites = sites.filter((s) => !s.media && !s.why)

console.log('-- S1 站点清单（自推导）--')
for (const s of sites) {
  console.log('   ' + (s.media ? '🎬' : '· ') + ' demo.html:' + s.line + '  接收者=' + (s.recv || '?') +
    (s.media ? '  [媒体 via ' + s.rule + ']' : '  [非媒体 ' + s.why + ']'))
}
console.log('   媒体元素变量: ' + JSON.stringify([...mediaVars.keys()]) + ' · 看门狗调用: ' +
  JSON.stringify(wires.map((w) => 'L' + w.line + ':' + w.label)))

check('S1-A 助手函数夹在 MPW-BLOBRETRY-BEGIN/END 之间且**只定义一次**',
  !!FN_NAME && html.split('function ' + FN_NAME + '(').length === 2 && iBegin >= 0 && iEnd > iBegin && iBegin > iModule,
  'name=' + FN_NAME + ' begin=' + iBegin + ' end=' + iEnd + ' module@' + iModule)
check('S1-B 助手定义在**每一处**调用之前（源码序：先定义后调用）',
  wires.length > 0 && wires.every((w) => w.idx > iEnd), 'firstWire@' + (wires[0] && wires[0].idx) + ' end@' + iEnd)
check('S1-C 每一处 createObjectURL 都被自动判定（无"未判定"站点 ⇒ 新站点必须来接线或来登记）',
  unresolvedSites.length === 0 && sites.length >= 7,
  '站点=' + sites.length + ' 未判定=' + unresolvedSites.length + (unresolvedSites.map((s) => ' L' + s.line).join('')))
check('S1-D blob→媒体站点全部被识别为媒体（自推导清单非空）',
  mediaSites.length >= 5, '媒体站点=' + mediaSites.length + ' @' + JSON.stringify(mediaSites.map((s) => s.line)))
for (const s of mediaSites) {
  const hit = wires.find((w) => w.line > s.line && w.line <= s.line + 40)
  check('S1-D2[demo.html:' + s.line + ' ' + s.recv + '] 其后 40 行内接上看门狗',
    !!hit, hit ? 'L' + hit.line + ' el=' + hit.el + ' label=' + hit.label : '（未接线！）')
}
check('S1-D3 接线数 == blob→媒体站点数（不漏、不重复）', wires.length === mediaSites.length,
  '接线=' + wires.length + ' 站点=' + mediaSites.length)
check('S1-D4 四个约定 label 都出现（视频纹理 / 视频底层 / 声音层 / 音频面板）',
  ['视频纹理', '视频底层', '声音层', '音频面板'].every((l) => wires.some((w) => w.label === l)),
  JSON.stringify([...new Set(wires.map((w) => w.label))]))
{
  const b = html.indexOf('// ═══ MPW-VIDEOBASE-BEGIN ═══'), e = html.indexOf('// ═══ MPW-VIDEOBASE-END ═══')
  const inBlock = mediaSites.filter((s) => s.idx > b && s.idx < e)
  const wired = inBlock.filter((s) => wires.some((w) => w.idx > s.idx && w.idx < e))
  check('S1-D5 MPW-VIDEOBASE 段（视频作最底层）里的 blob→媒体站点已接线',
    b >= 0 && e > b && inBlock.length >= 1 && wired.length === inBlock.length,
    '块内站点=' + inBlock.length + ' 已接线=' + wired.length)
}
{
  // 非 blob 的媒体站点（HTTP 直供）：**不需要**看门狗 —— 这里把"不接"这件事变成判据，报告同时写明依据
  const httpSites = []
  for (let l = 1; l <= LINES.length; l++) {
    for (const m of LINES[l - 1].matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\.src\s*=\s*(['"])([^'"]+)\2/g)) {
      if (mediaVars.has(m[1])) httpSites.push({ line: l, v: m[1], url: m[3] })
    }
  }
  console.log('   非 blob 媒体 src（HTTP 直供，不需要看门狗）: ' +
    JSON.stringify(httpSites.map((s) => 'L' + s.line + ' ' + s.v + '.src=' + s.url)))
  check('S1-E HTTP 直供的媒体 src（/ddvideo/、/videolib/）确实不是 blob ⇒ 其后 40 行内没有看门狗调用',
    httpSites.length >= 2 && httpSites.every((s) => /^(\/|https?:)/.test(s.url)) &&
      httpSites.every((s) => !wires.some((w) => w.line > s.line && w.line <= s.line + 40)),
    JSON.stringify(httpSites.map((s) => s.url)))
}
check('S1-T1 助手源码含上游缺陷号 2056444/2005247 + 上限 2 次 + 间隔 1500ms',
  HELPER_SRC.includes('2056444') && HELPER_SRC.includes('2005247') && /MAX\s*=\s*2/.test(HELPER_SRC) && HELPER_SRC.includes('1500'))
check('S1-T2 助手源码含"健康浏览器上永不触发"与四条实测证据文件名',
  HELPER_SRC.includes('健康浏览器上永不触发') && ['tests/mpkg-video-codec-probe.mjs', 'tests/mpkg-video-decode-probe.mjs',
    'tests/mpkg-videobase-live-probe.mjs', 'tests/mpkg-videobase-recovery-probe.mjs'].every((f) => HELPER_SRC.includes(f)))
check('S1-T3 助手源码里的失败/重试行标记齐全（🔁 / ⚠ / "始终未出元数据 rs=0，已重试 2 次"）',
  HELPER_SRC.includes('🔁') && HELPER_SRC.includes('⚠') && HELPER_SRC.includes('始终未出元数据 rs=0，已重试 2 次'))
check('S1-T4 助手只写一个全局 window.__mpwBlobMediaRetry（不引入别的全局）',
  [...HELPER_SRC.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].every((m) => m[1] === '__mpwBlobMediaRetry') &&
    HELPER_SRC.includes('window.__mpwBlobMediaRetry') &&
    [...HELPER_SRC.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].length > 0,
  JSON.stringify([...new Set([...HELPER_SRC.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]))]))
check('S1-T5 每个接线点都是 try/catch 包起来的（切片 harness 里符号不存在也不能打挂既有测试）',
  wires.length > 0 && wires.every((w) => /try\s*\{[^\n]*mpwBlobMediaRetry[^\n]*\}\s*catch/.test(LINES[w.line - 1])))

/* ───────────────────────── S2：行为（切真源码 + mock 元素 + 假时钟） ───────────────────────── */
console.log('-- S2 行为（按标记切出助手函数真实源码，在 mock 元素 + 假时钟上跑）--')
/** 假时钟：`advance(ms)` 只跑到期定时器；每个回调里新排的定时器不在本次到期内（不会自激）。 */
function mkClock() {
  let now = 0, seq = 0
  const q = new Map()
  return {
    setTimeout: (fn, ms) => { const id = ++seq; q.set(id, { at: now + (Number(ms) || 0), fn }); return id },
    clearTimeout: (id) => { q.delete(id) },
    now: () => now,
    pending: () => q.size,
    advance(ms) {
      const target = now + ms
      for (;;) {
        let bestId = -1, bestAt = Infinity
        for (const [id, t] of q) if (t.at <= target && t.at < bestAt) { bestAt = t.at; bestId = id }
        if (bestId < 0) break
        const t = q.get(bestId); q.delete(bestId); now = t.at; t.fn()
      }
      now = target
    },
  }
}
function mkSandbox(opts = {}) {
  const logs = []
  const clock = mkClock()
  const win = {}
  const sb = { logf: (m) => logs.push(String(m)), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console }
  if (!opts.noWindow) sb.window = win
  vm.createContext(sb)
  const fn = vm.runInContext(HELPER_SRC + '\n' + FN_NAME, sb)
  return { fn, logs, clock, win, sb }
}
function mkEl(o = {}) {
  const el = { loads: 0, plays: 0 }
  let err = o.err === undefined ? null : o.err
  Object.defineProperty(el, 'error', { get: () => err, set: (v) => { err = v }, enumerable: true })
  Object.defineProperty(el, 'readyState', { get: () => (typeof o.rs === 'function' ? o.rs() : (o.rs || 0)) })
  el.load = () => { el.loads++; if (o.loadThrows) throw new Error('load boom') }
  el.play = () => {
    el.plays++
    if (o.playThrows) throw new Error('play boom')
    return o.playRejects ? Promise.reject(new Error('play reject')) : Promise.resolve()
  }
  return el
}

// ① rs 已 ≥1：健康浏览器路径 —— 一次 load() 都不许调、不许计时、不许打日志
{
  const { fn, logs, clock } = mkSandbox()
  const el = mkEl({ rs: 4 })
  let threw = null
  try { fn(el, '视频纹理') } catch (e) { threw = e.message }
  check('S2-1a rs≥1：调用不抛', threw === null, String(threw))
  check('S2-1b rs≥1：零次 load()（首次检查不打扰健康浏览器）', el.loads === 0, 'loads=' + el.loads)
  check('S2-1c rs≥1：不排任何计时器、零日志', clock.pending() === 0 && logs.length === 0, 'pending=' + clock.pending() + ' logs=' + logs.length)
  clock.advance(10000)
  check('S2-1d rs≥1：10s 后仍零 load / 零日志（彻底不打扰）', el.loads === 0 && logs.length === 0)
}
// ② rs 0→0→4：1.5s 检查点看到 0 ⇒ 补 1 次 load()；3.0s 检查点看到 4 ⇒ 停（无 give-up）
{
  const { fn, logs, clock, win } = mkSandbox()
  const el = mkEl({ rs: () => (clock.now() >= 3000 ? 4 : 0) })
  fn(el, '视频底层')
  check('S2-2a 装上后未到检查点 ⇒ 零 load()、恰好 1 个计时器', el.loads === 0 && clock.pending() === 1, 'loads=' + el.loads + ' pending=' + clock.pending())
  clock.advance(1500)
  check('S2-2b 1.5s 检查点 rs=0 ⇒ 恰好 1 次 load()', el.loads === 1, 'loads=' + el.loads)
  check('S2-2c 恰好 1 行 🔁 日志（含 label + 第 1/2 次 + 2056444）',
    logs.length === 1 && logs[0].includes('🔁') && logs[0].includes('视频底层') && /第 1\/2 次/.test(logs[0]) && logs[0].includes('2056444'),
    JSON.stringify(logs))
  check('S2-2d 每次重试后重新发起播放 el.play()', el.plays === 1, 'plays=' + el.plays)
  clock.advance(1500)
  check('S2-2e 3.0s 检查点 rs=4 ⇒ 立刻停：不再 load、无 ⚠、不再计时',
    el.loads === 1 && !logs.some((l) => l.includes('⚠')) && clock.pending() === 0,
    'loads=' + el.loads + ' logs=' + logs.length + ' pending=' + clock.pending())
  clock.advance(10000)
  check('S2-2f 之后 10s 无任何新动作（日志恰好 1 行）', el.loads === 1 && el.plays === 1 && logs.length === 1 && clock.pending() === 0)
  check('S2-2g 计数钩子：calls=1 retries=1 gaveUp=0 · byLabel 分档',
    win.__mpwBlobMediaRetry && win.__mpwBlobMediaRetry.calls === 1 && win.__mpwBlobMediaRetry.retries === 1 &&
      win.__mpwBlobMediaRetry.gaveUp === 0 && win.__mpwBlobMediaRetry.byLabel['视频底层'].retries === 1,
    JSON.stringify(win.__mpwBlobMediaRetry))
}
// ③ rs 恒 0：恰好 2 次重试（间隔 1500ms）+ 恰好 1 行 ⚠ give-up，之后不再计时
{
  const { fn, logs, clock, win } = mkSandbox()
  const el = mkEl({ rs: 0 })
  fn(el, '声音层')
  clock.advance(1500)
  check('S2-3a 第 1 个检查点：1 次 load()、1 行 🔁（第 1/2 次）', el.loads === 1 && logs.length === 1 && /第 1\/2 次/.test(logs[0]), JSON.stringify(logs))
  clock.advance(1500)
  check('S2-3b 第 2 个检查点（间隔 1500ms）：第 2 次 load()、第 2 行 🔁（第 2/2 次）',
    el.loads === 2 && logs.length === 2 && /第 2\/2 次/.test(logs[1]), JSON.stringify(logs))
  check('S2-3c 2 次用尽前不打 ⚠（还在等元数据）', !logs.some((l) => l.includes('⚠')) && clock.pending() === 1)
  clock.advance(1500)
  check('S2-3d 2 次用尽仍 rs=0 ⇒ 恰好 1 行 ⚠（含 label + "始终未出元数据 rs=0，已重试 2 次"）',
    logs.filter((l) => l.includes('⚠')).length === 1 && logs[2].includes('声音层') && logs[2].includes('始终未出元数据 rs=0，已重试 2 次'),
    JSON.stringify(logs))
  check('S2-3e 用尽后不再计时、重试次数封顶在 2', clock.pending() === 0 && el.loads === 2, 'pending=' + clock.pending() + ' loads=' + el.loads)
  clock.advance(60000)
  check('S2-3f 之后 60s 无任何新动作（恰好 3 行日志：2×🔁 + 1×⚠）', logs.length === 3 && el.loads === 2 && el.plays === 2 && clock.pending() === 0)
  check('S2-3g 计数钩子：calls=1 retries=2 gaveUp=1 · byLabel.声音层 同值',
    win.__mpwBlobMediaRetry && win.__mpwBlobMediaRetry.calls === 1 && win.__mpwBlobMediaRetry.retries === 2 &&
      win.__mpwBlobMediaRetry.gaveUp === 1 && JSON.stringify(win.__mpwBlobMediaRetry.byLabel['声音层']) === '{"calls":1,"retries":2,"gaveUp":1}',
    JSON.stringify(win.__mpwBlobMediaRetry))
}
// ④ error 非空：零次重试（装上时就有错 / 第一个检查点才出错，两种都要停）
{
  const { fn, logs, clock } = mkSandbox()
  const el = mkEl({ rs: 0, err: { code: 4 } })
  fn(el, '视频纹理')
  check('S2-4a error 非空（装上时）⇒ 零次 load()、零计时、零日志',
    el.loads === 0 && clock.pending() === 0 && logs.length === 0, 'loads=' + el.loads + ' pending=' + clock.pending())
  clock.advance(10000)
  check('S2-4b error 非空：10s 后仍零动作', el.loads === 0 && logs.length === 0 && clock.pending() === 0)
}
{
  const { fn, logs, clock } = mkSandbox()
  const el = mkEl({ rs: 0 })
  fn(el, '视频纹理')
  el.error = { code: 2 }   // 第一个检查点之前才报错
  clock.advance(1500)
  check('S2-4c error 在第一个检查点才出现 ⇒ 零次重试、立刻停、不再计时',
    el.loads === 0 && logs.length === 0 && clock.pending() === 0, 'loads=' + el.loads + ' logs=' + logs.length + ' pending=' + clock.pending())
}
// ⑤ load() / play() 抛错或 reject：异常一律不外泄，重试与 give-up 照常
{
  const { fn, logs, clock } = mkSandbox()
  const el = mkEl({ rs: 0, loadThrows: true, playRejects: true })
  let threw = null
  try { fn(el, '视频纹理') } catch (e) { threw = e.message }
  clock.advance(1500); clock.advance(1500); clock.advance(1500)
  check('S2-5a load() 每次都抛错 ⇒ 调用与定时器回调都不外泄异常', threw === null, String(threw))
  check('S2-5b load() 抛错仍按 2 次计并最终 give-up 恰好 1 行 ⚠',
    el.loads === 2 && logs.filter((l) => l.includes('⚠')).length === 1 && clock.pending() === 0, JSON.stringify(logs))
  const el2 = mkEl({ rs: 0, playThrows: true })
  let threw2 = null
  try { fn(el2, '视频纹理') } catch (e) { threw2 = e.message }
  clock.advance(4500)
  check('S2-5c play() 同步抛错 ⇒ 同样被吞掉（重试继续到封顶）', threw2 === null && el2.loads === 2, String(threw2) + ' loads=' + el2.loads)
}
// ⑥ 无 window：照常工作、只不写计数钩子、绝不抛
{
  const { fn, logs, clock } = mkSandbox({ noWindow: true })
  const el = mkEl({ rs: 0 })
  let threw = null
  try { fn(el, '视频纹理') } catch (e) { threw = e.message }
  check('S2-6a 无 window：不抛异常', threw === null, String(threw))
  clock.advance(4500)
  check('S2-6b 无 window：仍完成 2 次重试 + 1 行 ⚠（计数钩子只跳过写入）',
    el.loads === 2 && logs.length === 3 && clock.pending() === 0, 'loads=' + el.loads + ' logs=' + logs.length)
}

/* ───────────────────────── S3：变异自证（真改副本、真跑、期望红集精确相等） ───────────────────────── */
function mutDeleteVideobaseWire(src) {
  const b = src.indexOf('// ═══ MPW-VIDEOBASE-BEGIN ═══'), e = src.indexOf('// ═══ MPW-VIDEOBASE-END ═══')
  if (b < 0 || e < 0) return src
  const seg = src.slice(b, e).split('\n')
  const i = seg.findIndex((l) => l.includes(FN_NAME + '('))
  if (i < 0) return src
  seg.splice(i, 1)
  return src.slice(0, b) + seg.join('\n') + src.slice(e)
}
function mutHelperNoop(src) {
  const b = src.indexOf(BEGIN), e = src.indexOf(END)
  if (b < 0 || e < 0) return src
  const seg = src.slice(b, e)
  const m = /function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.exec(seg)
  if (!m) return src
  const at = b + m.index + m[0].length
  return src.slice(0, at) + '\n  return\n' + src.slice(at)
}
// 期望红集 = 子进程里实际变红的 check 名（下面按实测登记；比较前把 check 名里的行号归一成 `#`，
// 免得将来在站点之前插几行就让"期望红集"整体失配 —— 变异要证的是**判据**分辨力，不是行号稳定性）
const MUTANTS = [
  {
    id: 'delete-videobase-wire', what: '删掉 MPW-VIDEOBASE 处的看门狗调用 ⇒ S1 站点接线判据必红', apply: mutDeleteVideobaseWire,
    expect: [
      'S1-D2[demo.html:# url] 其后 40 行内接上看门狗',
      'S1-D3 接线数 == blob→媒体站点数（不漏、不重复）',
      'S1-D4 四个约定 label 都出现（视频纹理 / 视频底层 / 声音层 / 音频面板）',
      'S1-D5 MPW-VIDEOBASE 段（视频作最底层）里的 blob→媒体站点已接线',
    ],
  },
  {
    id: 'helper-early-return', what: '让助手函数刚进函数体就 return ⇒ S2 行为判据必红', apply: mutHelperNoop,
    expect: [
      'S2-2a 装上后未到检查点 ⇒ 零 load()、恰好 1 个计时器',
      'S2-2b 1.5s 检查点 rs=0 ⇒ 恰好 1 次 load()',
      'S2-2c 恰好 1 行 🔁 日志（含 label + 第 1/2 次 + 2056444）',
      'S2-2d 每次重试后重新发起播放 el.play()',
      'S2-2e 3.0s 检查点 rs=4 ⇒ 立刻停：不再 load、无 ⚠、不再计时',
      'S2-2f 之后 10s 无任何新动作（日志恰好 1 行）',
      'S2-2g 计数钩子：calls=1 retries=1 gaveUp=0 · byLabel 分档',
      'S2-3a 第 1 个检查点：1 次 load()、1 行 🔁（第 1/2 次）',
      'S2-3b 第 2 个检查点（间隔 1500ms）：第 2 次 load()、第 2 行 🔁（第 2/2 次）',
      'S2-3c 2 次用尽前不打 ⚠（还在等元数据）',
      'S2-3d 2 次用尽仍 rs=0 ⇒ 恰好 1 行 ⚠（含 label + "始终未出元数据 rs=0，已重试 2 次"）',
      'S2-3e 用尽后不再计时、重试次数封顶在 2',
      'S2-3f 之后 60s 无任何新动作（恰好 3 行日志：2×🔁 + 1×⚠）',
      'S2-3g 计数钩子：calls=1 retries=2 gaveUp=1 · byLabel.声音层 同值',
      'S2-5b load() 抛错仍按 2 次计并最终 give-up 恰好 1 行 ⚠',
      'S2-5c play() 同步抛错 ⇒ 同样被吞掉（重试继续到封顶）',
      'S2-6b 无 window：仍完成 2 次重试 + 1 行 ⚠（计数钩子只跳过写入）',
    ],
  },
]

if (IS_MUTANT) {
  const spec = MUTANTS.find((m) => m.id === IS_MUTANT)
  if (!spec) { console.error('未知变异 id: ' + IS_MUTANT); process.exit(2) }
  const norm = (a) => a.map((s) => s.replace(/demo\.html:\d+/g, 'demo.html:#')).sort()
  const got = norm(results.filter((r) => !r.ok).map((r) => r.name))
  const want = norm(spec.expect.slice())
  const same = want.length > 0 && JSON.stringify(got) === JSON.stringify(want)
  console.log((same ? 'MUTANT-RED-OK ' : 'MUTANT-MISMATCH ') + IS_MUTANT +
    '\n   期望红(' + want.length + '): ' + JSON.stringify(want) +
    '\n   实际红(' + got.length + '): ' + JSON.stringify(got))
  process.exit(same ? 0 : 1)
}

console.log('-- S3 变异自证（隔离副本里真改 demo.html 再跑本文件）--')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-blobretry-mutant-'))
  const original = fs.readFileSync(DEMO, 'utf8')   // 隔离副本逐文件拷贝（不用 fs.cpSync：本机 /tmp 上会 EINVAL）
  try {
    fs.copyFileSync(DEMO, path.join(tmp, 'demo.html'))
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'))   // _root.mjs 认它当仓库根
    for (const m of MUTANTS) {
      const out = m.apply(original)
      if (out === original) { check('MM-' + m.id + ' 突变补丁命中源码', false, '手术串未命中 ⇒ 变异无效，本段读数不算数'); continue }
      fs.writeFileSync(path.join(tmp, 'demo.html'), out)
      const r = spawnSync(process.execPath, [FILE, '--mutant=' + m.id],
        { env: Object.assign({}, process.env, { MPW_REPO_ROOT: tmp }), encoding: 'utf8', timeout: 120000, maxBuffer: 8 << 20 })
      const lines = String(r.stdout || '').split('\n').filter((s) => /MUTANT-(RED-OK|MISMATCH)|期望红|实际红/.test(s))
      const line = lines.find((s) => /MUTANT-(RED-OK|MISMATCH)/.test(s)) || ''
      console.log('   ' + (lines.map((s) => s.trim()).join(' ⏎ ') || ('（子进程无 MUTANT 标记行，exit=' + r.status + '）')))
      check('MM-' + m.id + ' 必红：' + m.what, r.status === 0 && /MUTANT-RED-OK/.test(line),
        (line.trim() || ('exit=' + r.status)) + (r.stderr ? ' stderr=' + String(r.stderr).trim().split('\n').slice(-1)[0] : ''))
    }
    fs.writeFileSync(path.join(tmp, 'demo.html'), original)
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}

console.log('\n===== blob 媒体看门狗: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

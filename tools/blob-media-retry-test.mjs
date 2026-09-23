// blob-media-retry-test.mjs —— blob 媒体「有界重试看门狗」的判据（2026-09-23）
//
// 背景（已定性，有实测证据）：把**包内字节**做成 `blob:` URL 再喂 `<video>`/`<audio>`，在受影响的
// Firefox 构建上会**静默挂住** —— `readyState` 恒 0、`networkState` 恒 1、**不触发 error**、
// `play()` 的 Promise 永不 settle。上游回归 = Bug 2056444（Bug 2005247 引入，Firefox 152 起；
// 官方已修 155 nightly → beta 154 → release 153（153.0.3）/ ESR153）。机制：blob 数据超过 **1MiB 的
// IPC 内联上限**后改走 IPC 异步流，`CloneableWithRangeMediaResource` 在异步 IPC 流上做同步读 ⇒
// 首次元数据读（MP4 的 moov 常在**尾部** = 远端 seek）挂住；`decodeAudioData` 同族也会挂。
// 证据（兄弟仓库 `../we-scene-demo`，只读引用）：`tests/mpkg-video-decode-probe.mjs`（同一段 22MB
// h264：HTTP 直供 rs=4≈0.4s / blob 恒 rs=0 / 14KB blob rs=4 ⇒ 与 1MiB 上限相关 / 四种建 blob 写法全复现）、
// `tests/mpkg-videobase-recovery-probe.mjs`（真页面卡 rs=0 后**只补一次 load()** 就恢复，画面真的出来）。
// ⇒ 页内兜底 = `lib/client.js` 里**唯一定义**的 `mpwBlobMediaRetry(el, label)`：最多 2 次、间隔 1500ms。
//
// 本文件钉三组（纯 Node、无浏览器、无网络、< 3s）：
//   S1 **结构（自推导，不硬编码行号）**：从 `lib/client.js` 源码里**自己找**出"`URL.createObjectURL(...)`
//      的结果被用来喂 `<video>`/`<audio>`/`new Audio()`"的每一处（媒体元素集合也是从源码里
//      `document.createElement("video"|"audio")` 推导的），断言其后若干行内必有看门狗调用；
//      新站点没接线 ⇒ 红。顺带钉：标记唯一 / 契约常量在位 / label 短中文且互不相同 /
//      **非**媒体站点（下载链接、`img.src`）不许接线（防过度接线）。
//   S2 **行为**：按 `MPW-BLOBRETRY-BEGIN/END` 切出助手函数的**真实源码文本**，在 mock 元素 + 假时钟上跑：
//      ①rs 已 ≥1 ⇒ 零次 `load()`；②rs 0→0→4 ⇒ 恰好 1 次重试后停、无 give-up 行；③rs 恒 0 ⇒ 恰好 2 次重试
//      + 1 行 give-up 且之后不再计时；④`error` 非空 ⇒ 零次重试；⑤`load()` 抛错 ⇒ 异常不外泄；
//      另加：非 blob 源不戳 / 元素已摘不抛 / 无 `window` 照跑 / 事件先撤待发的那一发 / 计数钩子逐字段。
//   S3 **变异自证（真改副本、真跑子进程、断言"期望红集"精确相等）**：①删掉一处接线 ⇒ S1 必红；
//      ②助手函数立刻 return ⇒ S2 必红。副本只拷 `lib/client.js` 单个文件到 mkdtemp（本机 /tmp 是 tmpfs，
//      `fs.cpSync(recursive)` 会 EINVAL ⇒ 手动逐文件拷贝）。
//
// 运行：node tools/blob-media-retry-test.mjs            （全过 ALL PASS，退出码 0）
//      node tools/blob-media-retry-test.mjs --no-mutations   （子进程模式：只跑 S1+S2；副本路径由
//                                                            env MPW_BLOBRETRY_CLIENT 指定）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const CLIENT = process.env.MPW_BLOBRETRY_CLIENT || path.join(repoRoot, 'lib', 'client.js')
const NO_MUT = process.argv.includes('--no-mutations')
const LOOKAHEAD = 20   // "站点之后若干行内"的窗口（真实接线在 +7 / +10 行，留一倍余量）
const WANT_MAX_RETRY = 2
const WANT_GAP_MS = 1500

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 240) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 400) + ']' : '')) }
}
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const countOf = (s, ch) => s.split(ch).length - 1

const src = fs.readFileSync(CLIENT, 'utf8')
const lines = src.split('\n')
const lineOf = (idx) => src.slice(0, idx).split('\n').length

/* ══════════════════════════════════════════════════════════════════════════════════════
   S1：结构 —— 站点自推导 + 接线断言
   ══════════════════════════════════════════════════════════════════════════════════════ */
console.log('== S1 结构（站点自推导，不硬编码行号）==')

/* ① 标记切块（助手函数只许定义一次；名字也**从源码推导**，不硬编码） */
const MARK_B = '/* ═══ MPW-BLOBRETRY-BEGIN ═══ */'
const MARK_E = '/* ═══ MPW-BLOBRETRY-END ═══ */'
const iB = src.indexOf(MARK_B), iE = src.indexOf(MARK_E)
const BEGIN_LINE = iB >= 0 ? lineOf(iB) : -1
const END_LINE = iE >= 0 ? lineOf(iE) : -1
ok('S1-1 MPW-BLOBRETRY-BEGIN/END 标记各恰好一次，且 BEGIN 在 END 之前',
  iB >= 0 && iE > iB && countOf(src, MARK_B) === 1 && countOf(src, MARK_E) === 1,
  JSON.stringify({ BEGIN: BEGIN_LINE, END: END_LINE }))
/* 标记之间 = 助手函数的**真实源码文本**（S2 直接求值这一段，保证测的是产线代码而不是复写） */
const sliceFrom = iB + MARK_B.length
const sliceTo = iE
const INNER = iE > iB ? src.slice(sliceFrom, sliceTo) : ''
const fnMatch = INNER.match(/function\s+([A-Za-z_$][\w$]*)\s*\(\s*el\s*,\s*label\s*\)/)
const HELPER = fnMatch ? fnMatch[1] : ''
ok('S1-2 标记之间是一个 `function <name>(el, label)` 声明，名字可从源码推导',
  !!HELPER, HELPER || '没匹配到')
ok('S1-3 助手函数在整份源码里**只定义一次**（没有第二份拷贝/影子实现）',
  !!HELPER && countOf(src, 'function ' + HELPER) === 1, 'count=' + countOf(src, 'function ' + HELPER))
let evalErr = ''
try { new Function('window', 'console', 'setTimeout', 'clearTimeout', INNER + '\nreturn ' + HELPER + ';') } catch (e) { evalErr = String(e && e.message || e) }
ok('S1-4 切出的真实源码文本可独立求值（不依赖闭包里的其它名字）', !evalErr, evalErr || 'new Function OK')

/* ② 契约常量 / 证据出处 / 日志标记：静态在位（行为侧由 S2 钉） */
const need = [
  ['上游缺陷号 2056444', /2056444/],
  ['有界 2 次', new RegExp('RETRY_MAX\\s*=\\s*' + WANT_MAX_RETRY + '\\b')],
  ['间隔 1500ms', new RegExp('RETRY_GAP_MS\\s*=\\s*' + WANT_GAP_MS + '\\b')],
  ['重试日志标记 🔁', /🔁/],
  ['give-up 标记 ⚠', /⚠/],
  ['"健康浏览器上永不触发" 的边界说明', /健康浏览器上永不触发/],
  ['兄弟仓库探针 ①（decode）', /mpkg-video-decode-probe\.mjs/],
  ['兄弟仓库探针 ②（recovery = load() 兜底的依据）', /mpkg-videobase-recovery-probe\.mjs/],
  ['真的调 el.load()', /el\.load\(\)/],
  ['重发播放（play + catch 吞掉）', /const p = el\.play\(\);\s*if \(p && typeof p\.catch === ['"]function['"]\) p\.catch\(\(\) => \{\}\)/],
  ['计数钩子 window.__mpwBlobMediaRetry', /window\.__mpwBlobMediaRetry/],
  ['计数四字段 calls/retries/gaveUp/byLabel', /calls[\s\S]{0,400}retries[\s\S]{0,400}gaveUp[\s\S]{0,400}byLabel/],
  ['仅当 window 存在时写钩子', /typeof window === "undefined"/],
]
for (const [name, re] of need) ok('S1-5 助手函数里在位：' + name, re.test(INNER))

/* ③ 媒体元素集合**从源码推导**（`document.createElement("video"|"audio")` / `new Audio(`）——不硬编码变量名 */
const MEDIA_IDS = new Set()
for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*["'](video|audio)["']\s*\)/g)) MEDIA_IDS.add(m[1])
for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:window\.)?Audio\s*\(/g)) MEDIA_IDS.add(m[1])
ok('S1-6 媒体元素集合是**推导**出来的（不用硬编码变量名）', MEDIA_IDS.size >= 2, [...MEDIA_IDS].join(','))

/* ④ 每个 `URL.createObjectURL(...)` 站点：判它是不是"喂媒体元素"，媒体站点必须接线 */
const FEEDER_CALL = /(showVideoEl|showVideoEdge|showAudioEl|playMediaEl|playVideo|playAudio)\s*\(\s*VAR\b/
const SRC_ASSIGN = /([A-Za-z_$][\w$]*)\s*\.\s*(?:src\s*=|setAttribute\(\s*["']src["']\s*,)\s*VAR\b/
const HREF_ASSIGN = /([A-Za-z_$][\w$]*)\s*\.\s*href\s*=\s*VAR\b/
const isMediaName = (n) => MEDIA_IDS.has(n)
  || (/audio|video|vid|player|media/i.test(n) && !/img|image|thumb|frame|canvas|script/i.test(n))
const sites = []
for (const m of src.matchAll(/(?:([A-Za-z_$][\w$]*)\s*=\s*)?URL\s*\.\s*createObjectURL\s*\(/g)) {
  const ln = lineOf(m.index)
  const v = m[1] || null
  const win = lines.slice(ln - 1, ln - 1 + LOOKAHEAD).join('\n')
  let kind = 'non-media', why = '窗口内没有喂给媒体元素的直接证据'
  if (v) {
    const fm = win.match(new RegExp(FEEDER_CALL.source.replace('VAR', v)))
    const sm = win.match(new RegExp(SRC_ASSIGN.source.replace('VAR', v)))
    const hm = win.match(new RegExp(HREF_ASSIGN.source.replace('VAR', v)))
    if (fm) { kind = 'media'; why = fm[1] + '(' + v + ')' }
    else if (sm && isMediaName(sm[1])) { kind = 'media'; why = sm[1] + '.src/' + sm[1] + '.setAttribute(src) = ' + v }
    else if (sm) { why = sm[1] + '.src = ' + v + '（非媒体元素：' + sm[1] + '）' }
    else if (hm) { why = hm[1] + '.href = ' + v + '（锚点下载/跳转，不是媒体）' }
  } else why = '未绑定到变量（内联实参）'
  const wireLine = lines.slice(ln - 1, ln - 1 + LOOKAHEAD).find((l) => new RegExp('(?:^|[^\\w$])' + HELPER + '\\s*\\(').test(l) && !/function\s/.test(l))
  const label = wireLine && (wireLine.match(new RegExp(HELPER + '\\(\\s*[^,]+,\\s*"([^"]+)"\\s*\\)')) || [])[1]
  sites.push({ ln, v, kind, why, wired: !!wireLine, wireLine: wireLine || '', label: label || '' })
}
const mediaSites = sites.filter((s) => s.kind === 'media')
const otherSites = sites.filter((s) => s.kind !== 'media')
console.log('    媒体喂入站点 ' + mediaSites.length + ' 处：' + mediaSites.map((s) => '@' + s.ln + ' ' + s.why).join(' | '))
console.log('    非媒体站点 ' + otherSites.length + ' 处：' + otherSites.map((s) => '@' + s.ln + ' ' + s.why).join(' | '))
ok('S1-7 自推导出的媒体喂入站点 ≥ 2 处（视频壁纸 + 音轨那条路；0 处 ⇒ 分类器瞎了）',
  mediaSites.length >= 2, 'media=' + mediaSites.length + ' other=' + otherSites.length)
ok('S1-8 每一处媒体喂入站点，其后 ' + LOOKAHEAD + ' 行内都有 `' + HELPER + '` 调用（新站点没接线 ⇒ 这里红）',
  mediaSites.length > 0 && mediaSites.every((s) => s.wired),
  mediaSites.filter((s) => !s.wired).map((s) => '@' + s.ln + ' ' + s.why).join(' | ') || 'all wired')
ok('S1-9 接线点的 label 是**非空短中文**（如「视频壁纸」「音轨」），且互不相同（计数钩子按 label 分桶）',
  mediaSites.length > 0 && mediaSites.every((s) => /^[\u4e00-\u9fa5]{2,6}$/.test(s.label))
  && new Set(mediaSites.map((s) => s.label)).size === mediaSites.length,
  mediaSites.map((s) => '@' + s.ln + '="' + s.label + '"').join(' | '))
ok('S1-10 非媒体站点（JSON 下载链接 / img.src）**不许**接线（防过度接线）',
  otherSites.length >= 1 && otherSites.every((s) => !s.wired),
  otherSites.filter((s) => s.wired).map((s) => '@' + s.ln).join(' | ') || ('other=' + otherSites.length + ' 全未接线'))
const callSites = countOf(src, HELPER + '(') - countOf(src, 'function ' + HELPER + '(')
ok('S1-11 接线调用总数 === 媒体站点数（没有多余/漏掉的调用点）',
  callSites === mediaSites.length, JSON.stringify({ calls: callSites, media: mediaSites.length }))

/* ══════════════════════════════════════════════════════════════════════════════════════
   S2：行为 —— 切真实源码，在 mock 元素 + 假时钟上跑
   ══════════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== S2 行为（切 MPW-BLOBRETRY 块的真实源码，mock 元素 + 假时钟）==')

/** 造一个用例沙盒：假时钟（可 advance）+ mock 元素 + 日志捕获 + 计数钩子的 window。 */
function makeCase(opts = {}) {
  let now = 0, seq = 0
  const q = []
  const setT = (fn, ms) => { const t = { id: ++seq, at: now + Number(ms || 0), fn, dead: false }; q.push(t); return t.id }
  const clrT = (id) => { const t = q.find((x) => x.id === id); if (t) t.dead = true }
  const advance = (ms) => {
    const end = now + ms
    for (let guard = 0; guard < 5000; guard++) {
      const due = q.filter((t) => !t.dead && t.at <= end).sort((a, b) => (a.at - b.at) || (a.id - b.id))[0]
      if (!due) break
      due.dead = true
      now = Math.max(now, due.at)
      due.fn()   // 回调自己吞异常；这里不 try ⇒ 外泄的异常会直接炸出测试（S2-5 要的就是它不炸）
    }
    now = end
  }
  const pending = () => q.filter((t) => !t.dead).length
  const logs = []
  const push = (...a) => logs.push(a.map((x) => String(x)).join(' '))
  const con = { log: push, warn: push, error: push }
  const el = {
    loads: 0, plays: 0, playCaught: false, listeners: {}, emit(k) { const l = this.listeners[k] || []; this.listeners[k] = []; for (const f of l) f() },
    src: opts.src === undefined ? 'blob:http://127.0.0.1:3080/mpw-node-1' : opts.src,
    getAttribute(k) { return k === 'src' ? this.src : null },
    load() { this.loads++; if (opts.loadThrows) throw new Error('load() 故意抛错') },
    play() { this.plays++; const p = { catch() { el.playCaught = true; return p } }; return p },
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn) },
  }
  Object.defineProperty(el, 'readyState', { get() { return typeof opts.rs === 'function' ? opts.rs(now) : (opts.rs || 0) } })
  Object.defineProperty(el, 'error', { get() { return typeof opts.error === 'function' ? opts.error(now) : (opts.error || null) } })
  const win = opts.noWindow ? undefined : {}
  const helper = new Function('window', 'console', 'setTimeout', 'clearTimeout', INNER + '\nreturn ' + HELPER + ';')(win, con, setT, clrT)
  const label = opts.label === undefined ? '视频盲测' : opts.label
  const invoke = (e = el) => { try { helper(e, label); return null } catch (err) { return err } }
  return { el, win, logs, advance, pending, invoke, label, linesWith: (ch) => logs.filter((s) => s.indexOf(ch) >= 0) }
}

/* ① 健康浏览器：rs 已 ≥1 ⇒ 一次 load() 都不许调、也不许计时 */
{
  const c = makeCase({ rs: () => 4 })
  const err = c.invoke()
  ok('S2-1 首次检查 rs≥1 ⇒ 零次 `load()`、零行日志、零计时（一次都不打扰）',
    !err && c.el.loads === 0 && c.el.plays === 0 && c.pending() === 0 && c.logs.length === 0
    && JSON.stringify(c.win.__mpwBlobMediaRetry) === JSON.stringify({ calls: 1, retries: 0, gaveUp: 0, byLabel: { [c.label]: { calls: 1, retries: 0, gaveUp: 0 } } }),
    JSON.stringify({ loads: c.el.loads, pending: c.pending(), logs: c.logs.length, hook: c.win.__mpwBlobMediaRetry }))
}

/* ② rs 0→0→4：恰好 1 次重试后停，无 give-up 行 */
{
  const c = makeCase({ rs: (t) => (t >= 3000 ? 4 : 0) })
  c.invoke()
  c.advance(WANT_GAP_MS)
  const afterFirst = { loads: c.el.loads, retry: c.linesWith('🔁').length }
  c.advance(60000)
  ok('S2-2 rs 0→0→4 ⇒ 恰好 1 次重试后停（无 ⚠、不再计时）',
    afterFirst.loads === 1 && afterFirst.retry === 1 && c.linesWith('⚠').length === 0
    && c.el.loads === 1 && c.pending() === 0 && c.win.__mpwBlobMediaRetry.retries === 1 && c.win.__mpwBlobMediaRetry.gaveUp === 0,
    JSON.stringify({ afterFirst, after: { loads: c.el.loads, pending: c.pending(), retries: c.win.__mpwBlobMediaRetry.retries, gaveUp: c.win.__mpwBlobMediaRetry.gaveUp } }))
}

/* ③ rs 恒 0：恰好 2 次重试 + 1 行 ⚠，之后不再计时 */
{
  const c = makeCase({ rs: () => 0, label: '音轨' })
  c.invoke()
  c.advance(WANT_GAP_MS); const at1 = { loads: c.el.loads, retry: c.linesWith('🔁').length, give: c.linesWith('⚠').length }
  c.advance(WANT_GAP_MS); const at2 = { loads: c.el.loads, retry: c.linesWith('🔁').length, give: c.linesWith('⚠').length }
  c.advance(WANT_GAP_MS); const at3 = { loads: c.el.loads, retry: c.linesWith('🔁').length, give: c.linesWith('⚠').length }
  c.advance(600000); const at4 = { loads: c.el.loads, retry: c.linesWith('🔁').length, give: c.linesWith('⚠').length, pending: c.pending() }
  const hook = c.win.__mpwBlobMediaRetry
  ok('S2-3 rs 恒 0 ⇒ 恰好 ' + WANT_MAX_RETRY + ' 次重试 + 1 行 ⚠，且之后不再计时/不再 load()',
    at1.loads === 1 && at1.give === 0 && at2.loads === 2 && at2.give === 0
    && at3.loads === 2 && at3.retry === WANT_MAX_RETRY && at3.give === 1
    && at4.loads === 2 && at4.give === 1 && at4.pending === 0,
    JSON.stringify({ at1, at2, at3, at4 }))
  ok('S2-10 计数钩子逐字段：calls/retries/gaveUp + byLabel 同口径分桶',
    hook.calls === 1 && hook.retries === WANT_MAX_RETRY && hook.gaveUp === 1
    && JSON.stringify(hook) === JSON.stringify({ calls: 1, retries: WANT_MAX_RETRY, gaveUp: 1, byLabel: { 音轨: { calls: 1, retries: WANT_MAX_RETRY, gaveUp: 1 } } }),
    JSON.stringify(hook))
  const one = c.linesWith('🔁')[0] || '', two = c.linesWith('🔁')[1] || '', give = c.linesWith('⚠')[0] || ''
  ok('S2-11 每次重试**恰好一行**日志（含 🔁 / label / 第几次 / 缺陷号 2056444）；⚠ 行如实写"始终未出元数据 rs=0，已重试 2 次"',
    c.linesWith('🔁').length === WANT_MAX_RETRY && c.linesWith('⚠').length === 1
    && one.indexOf('音轨') >= 0 && one.indexOf('2056444') >= 0 && one.indexOf('1/2') >= 0
    && two.indexOf('2/2') >= 0 && two.indexOf('2056444') >= 0
    && /始终未出元数据 rs=0，已重试 2 次/.test(give) && give.indexOf('音轨') >= 0,
    JSON.stringify({ one: one.slice(0, 120), two: two.slice(0, 120), give: give.slice(0, 120) }))
  ok('S2-12 每次重试都重新发起播放（play() 被调用且挂上了 catch）',
    c.el.plays === WANT_MAX_RETRY && c.el.playCaught, JSON.stringify({ plays: c.el.plays, caught: c.el.playCaught }))
}

/* ④ error 非空：零次重试（武装时就报错 / 中途报错两种情况） */
{
  const c1 = makeCase({ rs: () => 0, error: { code: 4 } })
  const e1 = c1.invoke(); c1.advance(60000)
  const c2 = makeCase({ rs: () => 0, error: (t) => (t >= WANT_GAP_MS ? { code: 4 } : null) })
  const e2 = c2.invoke(); c2.advance(60000)
  ok('S2-4 `error` 非空 ⇒ 零次重试、零行日志（武装时已报错 / 中途报错都不戳）',
    !e1 && !e2 && c1.el.loads === 0 && c1.logs.length === 0 && c2.el.loads === 0 && c2.logs.filter((s) => s.indexOf('🔁') >= 0 || s.indexOf('⚠') >= 0).length === 0,
    JSON.stringify({ atArm: { loads: c1.el.loads, logs: c1.logs.length }, midway: { loads: c2.el.loads, pending: c2.pending() } }))
}

/* ⑤ load() 抛错：异常不外泄（有界节奏照走完） */
{
  const c = makeCase({ rs: () => 0, loadThrows: true })
  const err1 = c.invoke()
  let err2 = null
  try { c.advance(600000) } catch (e) { err2 = e }
  ok('S2-5 `load()` 抛错 ⇒ 异常不外泄（武装与两次重试都不炸），⚠ 仍如实收尾',
    !err1 && !err2 && c.el.loads === WANT_MAX_RETRY && c.linesWith('⚠').length === 1,
    JSON.stringify({ invokeErr: err1 && err1.message, tickErr: err2 && err2.message, loads: c.el.loads, give: c.linesWith('⚠').length }))
}

/* ⑥ 边界：非 blob 源不戳 / 元素已摘不抛 / 无 window 照跑 / 事件先撤待发的那一发 */
{
  const c1 = makeCase({ rs: () => 0, src: 'http://127.0.0.1:3080/api/mpkg-wallpaper/media?token=x&index=1' })
  c1.invoke(); c1.advance(600000)
  ok('S2-6 非 blob: 源（HTTP 直供/宿主路由）⇒ 一次都不戳（那是探针里 rs=4 的健康路径）',
    c1.el.loads === 0 && c1.pending() === 0 && c1.logs.length === 0, JSON.stringify({ loads: c1.el.loads, src: c1.el.src.slice(0, 40) }))

  const c2 = makeCase({ rs: () => 0 })
  const e2 = c2.invoke(null)
  c2.advance(60000)
  ok('S2-7 元素已摘（el = null）⇒ 不抛、不计时（calls 仍记账，便于"接线被走到"取证）',
    !e2 && c2.pending() === 0 && c2.win.__mpwBlobMediaRetry.calls === 1, JSON.stringify(c2.win.__mpwBlobMediaRetry))

  const c3 = makeCase({ rs: () => 0, noWindow: true, label: '无窗口' })
  const e3 = c3.invoke(); let e3b = null
  try { c3.advance(600000) } catch (e) { e3b = e }
  ok('S2-8 无 `window` ⇒ 兜底照跑（2 次重试 + 1 行 ⚠），只是不写计数钩子',
    !e3 && !e3b && c3.el.loads === WANT_MAX_RETRY && c3.linesWith('⚠').length === 1,
    JSON.stringify({ loads: c3.el.loads, give: c3.linesWith('⚠').length }))

  const c4 = makeCase({ rs: (t) => (t >= 400 ? 4 : 0) })
  c4.invoke()
  ok('S2-13 武装时挂上 loadedmetadata/error 一次性监听（真出元数据 ⇒ 待发的那一发被撤掉，不产生多余 load()）',
    (c4.el.listeners.loadedmetadata || []).length === 1 && (c4.el.listeners.error || []).length === 1)
  c4.advance(1000)          // rs 已在 400ms 变 4：t=1500 那一发不许再触发 load()
  c4.el.emit('loadedmetadata')
  c4.advance(600000)
  ok('S2-9 中途真出元数据（事件路径）⇒ 立刻停：零次 load()、零行日志、零计时',
    c4.el.loads === 0 && c4.pending() === 0 && c4.logs.length === 0,
    JSON.stringify({ loads: c4.el.loads, pending: c4.pending(), logs: c4.logs.length }))
}

/* ══════════════════════════════════════════════════════════════════════════════════════
   S3：变异自证（真改副本、真跑子进程、断言"期望红集"精确相等）
   ══════════════════════════════════════════════════════════════════════════════════════ */
if (!NO_MUT) {
  console.log('\n== S3 变异自证（副本在 mkdtemp；真树不许变；期望红集精确相等）==')
  const before = sha(CLIENT)
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-blobretry-'))
  process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* tmp */ } })
  const redOf = (out) => ({ S1: /✗ S1-/.test(out), S2: /✗ S2-/.test(out), S3: /✗ S3-/.test(out) })
  const MUTS = [
    {
      id: 'wiring-removed', group: 'S1',
      why: '删掉视频壁纸那处接线（站点还在、调用没了）⇒ S1 必须红，S2 必须仍绿',
      from: mediaSites[0] && mediaSites[0].wireLine, to: '/* MUTATED: 接线被删 */',
    },
    {
      id: 'helper-immediate-return', group: 'S2',
      why: '助手函数第一句就 return ⇒ 一次 load() 都不补 ⇒ S2 必须红，S1 必须仍绿',
      from: (HELPER && new RegExp('function\\s+' + HELPER + '\\s*\\(\\s*el\\s*,\\s*label\\s*\\)\\s*\\{').exec(INNER) || [null])[0],
      to: null,   // 由下面按 from 现算：在 `{` 之后插 ` return;`
      isInsert: true,
    },
  ]
  for (const m of MUTS) {
    if (!m.from || countOf(src, m.from) !== 1) {
      ok('S3 ' + m.id + '：变异锚点在真源码里唯一', false, '锚点没匹配上/不唯一：' + String(m.from).slice(0, 90))
      continue
    }
    const mutated = m.isInsert ? src.replace(m.from, m.from + ' return;') : src.replace(m.from, m.to)
    const copyFile = path.join(tmpRoot, 'mut-' + m.id, 'client.js')
    fs.mkdirSync(path.dirname(copyFile), { recursive: true })
    fs.copyFileSync(CLIENT, copyFile)              // 单个文件手动拷（/tmp 是 tmpfs，cpSync(recursive) 会 EINVAL）
    fs.writeFileSync(copyFile, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-mutations'], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, MPW_BLOBRETRY_CLIENT: copyFile },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    const got = redOf(out)
    const want = { S1: m.group === 'S1', S2: m.group === 'S2', S3: false }
    const redOk = JSON.stringify(got) === JSON.stringify(want) && r.status !== 0
    ok('S3 ' + m.id + '：期望红集精确相等（' + JSON.stringify(want) + '）',
      JSON.stringify(got) === JSON.stringify(want), '实际=' + JSON.stringify(got) + ' exit=' + r.status + ' ' + m.why)
    ok('S3 ' + m.id + '：子进程如实红（退出码非 0）', r.status !== 0, 'exit=' + r.status)
    if (redOk) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got) + '（期望 ' + JSON.stringify(want) + '）')
  }
  ok('S3-真树 sha256 跑前跑后逐字相同（变异只碰 mkdtemp 副本）', sha(CLIENT) === before)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ blob 媒体有界重试看门狗未通过'); process.exit(1) }
console.log('✓ blob 媒体有界重试看门狗通过：站点自推导接线 S1 + 真实源码行为 S2 + 变异自证 S3')

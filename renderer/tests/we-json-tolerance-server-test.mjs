// we-json-tolerance-server-test.mjs —— 「包内/包旁 JSON 的严格解析」在**服务端 + elysia 入口**的残留收口判据
//
// 为什么单开一条（与 `tests/we-json-tolerance-test.mjs` 同口径、不同面）：
//   那条测的是 `parseWeJson` 本体与**页面/bundle**里的解析点（P-177）。本仓还有**三类不经过页面**的入口：
//   ① `:8902` 测试台服务（库里的 `project.json` = 包旁；容器条目里的 `project.json` = 包内）；
//   ② `server/we-scene-demo-server.mjs`（自身唯一的 `JSON.parse` 是请求体；包旁读走 `core/scene-project-json.mjs`）；
//   ③ elysia 浏览器入口的 `makePkg().readJson()`（读的是 **pkg 条目**）。
//   它们的共同后果与 P-177 一模一样：官方 `assets/effects/fluidsimulation/effect.json` 第 402 行自带尾逗号
//   （WE 用 jsoncpp 照用）⇒ 标准 `JSON.parse` 抛 ⇒ 这些地方"读失败就 catch 成 null"⇒ **整份属性表/条目**
//   静默消失，日志一行都没有。所以：**包内/包旁的一律走 `parseWeJson`（同一份实现，不复制第三份）**，
//   **宿主自有状态与 HTTP 请求体一律保持严格**（"读失败 ≠ 没存过"；客户端发坏 JSON 必须 400）。
//
// 分类判定（每一处都有理由，写在代码里紧跟站点的 `[we-json:strict|<分类>]` 标记上；本测试逐条反查，
//   标记缺分类或分类不认识 ⇒ 判红 —— "加了标记但没说清为什么"不算数）：
//   · 包内（走 parseWeJson）：`readPkgEntryHeadJson()`（容器目录表里的 `…/project.json`）、
//     elysia `makePkg().readJson(name)`（pkg 条目文本）；
//   · 包旁（走 parseWeJson）：`:8902` `readProjectJson(dir)` = `<库项目录>/project.json`
//     （WE 工坊布局里与 `scene.pkg` 同级 —— `core/scene-project-json.mjs` 的查找链读的就是同一个官方法）；
//   · HTTP 请求体（保持严格）：`readJsonBody()`（`POST /api/props` 等）、`POST /diag` 体、`POST /baseline` 体、
//     `:8899` 的基线快照体 —— 客户端给坏 JSON 必须**如实 400**，宽容会把客户端 bug 糊成"服务端读懂了"；
//   · 宿主自有状态（保持严格）：`:8902` 的 `<reports>/bench-props/*.json`（属性覆盖，同一个文件由本服务的
//     `writeOverrides` 写）、`<reports>/web-store/*.json`（web 帧存储，由 `POST /api/web-store` 写）、
//     `<reports>/web-replace.json`（宿主注入策略）—— 宽容会把**损坏**糊成"能读"，
//     本仓既有纪律是宿主设置"读失败 ≠ 没存过"。
//
// 判据（纯 Node、无浏览器、无网络（只连本机回环）、不读语料，实测秒级）：
//   S1 静态/自推导扫描（不写死行号）：三个文件里每一处代码区 `JSON.parse(` 站点**逐条归类** ——
//      **包内严格残留 == 0**（机器可读一行 `WE-JSON-SERVER-SCAN`）；宿主侧那些必须**带理由标记**
//      （`[we-json:strict|request-body]` / `[we-json:strict|host-state]`）且**逐类计数精确相等**
//      （放宽任何一处 ⇒ 计数变 ⇒ 必红）；`.json()` 站点 0 处；
//      与扫描器无关的正向证据：两处包内/包旁站点确实写着 `parseWeJson`、elysia 确实走 `lib.parseWeJson`。
//   S2 行为（**切片生产代码**，不是重写一份）：`elysia/demo-elysia.js` 的 `rd` + `makePkg` 原文取出后
//      在隔离作用域里跑 ⇒ 官方那份带尾逗号的 `effect.json` 读得出（20 pass / 9 FBO）；且语义与改动前逐条一致
//      （**条目不存在 ⇒ null**；条目在而 JSON 真坏 ⇒ **照样抛**；健康 JSON 逐位等价 `JSON.parse`）。
//   E  端到端（起**真** `:8902` 服务 + 真夹具库 + 真 HTTP）：尾逗号 `project.json` ⇒ `/api/props` 有属性、
//      `/api/library` 有标题；尾逗号**容器内** `project.json` ⇒ `/api/mpkg` 的 `declared` 有值；
//      真坏 JSON 仍然空（不放宽）；请求体带尾逗号 ⇒ **400**（严格）；损坏的宿主覆盖/帧存储**不许**被糊成"能读"。
//   M  变异自证（隔离副本；真树一个字节都不动）：
//      M1/M2/M6 = **改回去**（包内/包旁退回严格）⇒ 端到端读数必须翻回旧值且期望红集 == 实际红集；
//      M3/M4/M5 = **反向放宽**（宿主覆盖 / 请求体 / 帧存储改成宽容）⇒ 必须变红（证明"保持严格"这条决定承重）。
//      每个变异体都打印 `MUTANT-RED-OK`。
//
// 用法: node tests/we-json-tolerance-server-test.mjs [--json] [--no-mutant] [--server=<路径>] [--elysia=<路径>]
// 退出码: 0 全绿 / 1 有失败（或变异没按期望变红）/ 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const HERE = fileURLToPath(import.meta.url)
const SERVER_REAL = path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs')
const SERVER8899_REAL = path.join(ROOT, 'server', 'we-scene-demo-server.mjs')
const ELYSIA_REAL = path.join(ROOT, 'elysia', 'demo-elysia.js')
const DEMO_DIR = path.join(ROOT, 'demo')
const WE = process.env.MPW_WE_ASSETS || path.join(WS, 'wallpaper_engine', 'assets')
const OFFICIAL = path.join(WE, 'effects', 'fluidsimulation', 'effect.json')

const argv = process.argv.slice(2)
const argVal = (n) => { const f = argv.find((a) => a.startsWith(`--${n}=`)); return f ? f.slice(f.indexOf('=') + 1) : null }
const JSON_OUT = argv.includes('--json')
const NO_MUT = argv.includes('--no-mutant')
const SERVER = argVal('server') || SERVER_REAL
const ELYSIA = argVal('elysia') || ELYSIA_REAL
if (!fs.existsSync(SERVER) || !fs.existsSync(ELYSIA)) { console.error('被测文件不存在：' + SERVER + ' / ' + ELYSIA); process.exit(2) }

let pass = 0, fail = 0
const failedIds = []
function check(id, name, cond, detail) {
  const ok = !!cond
  if (ok) { pass++; console.log(`  ✓ ${id} ${name}${detail ? '  [' + detail + ']' : ''}`) }
  else { fail++; failedIds.push(id); console.log(`  ✗ ${id} ${name}${detail ? '  → ' + detail : ''}`) }
  return ok
}
/** 端到端读数：**无论过不过都打一行**（变异阶段靠它拿"改前读数"）。 */
const reading = (id, text) => console.log(`  · 读数 ${id} ${text}`)

console.log('== 「包内/包旁 JSON」严格解析残留收口（服务端 + elysia 入口）==')
console.log('   repo=' + ROOT)
console.log('   server=' + SERVER)
console.log('   elysia=' + ELYSIA)

/* ═══════════════════════ S1：静态 / 自推导扫描（不写死行号） ═══════════════════════ */

/** 注释范围（`/* *\/` 与 `//`）—— 只用来判"站点在不在注释里"。 */
function commentRanges(src) {
  const out = []
  for (const re of [/\/\*[\s\S]*?\*\//g, /\/\/[^\n]*/g]) { let m; while ((m = re.exec(src)) !== null) out.push([m.index, m.index + m[0].length]) }
  return out
}
const inComment = (rs, i) => rs.some(([a, b]) => i >= a && i < b)
/** 行内未闭合引号 ⇒ 站点在（单行）字符串里。 */
function inStringOnLine(src, idx) {
  const ls = src.lastIndexOf('\n', idx) + 1
  let q = 0
  const before = src.slice(ls, idx)
  for (let i = 0; i < before.length; i++) {
    if (before[i] === '\\') { i++; continue }
    if (before[i] === '"' || before[i] === "'" || before[i] === '`') q++
  }
  return q % 2 === 1
}
/** 取 `(` 起点的参数文本（平衡括号）。 */
function callArg(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (!depth) return src.slice(openIdx + 1, i) }
  }
  return ''
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length
/** 代码区的 `JSON.parse(` 站点（注释/字符串里的另记，不算站点）。 */
function jsonParseSites(src) {
  const rs = commentRanges(src)
  const sites = [], skipped = []
  const re = /JSON\.parse\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    const at = m.index
    const site = { at, line: lineOf(src, at), arg: callArg(src, at + m[0].length - 1).trim(), ctx: src.slice(Math.max(0, at - 900), at) }
    if (inComment(rs, at)) skipped.push({ why: '注释', line: site.line })
    else if (inStringOnLine(src, at)) skipped.push({ why: '字符串', line: site.line })
    else sites.push(site)
  }
  return { sites, skipped }
}
/** 站点紧邻的决策标记 `[we-json:strict|<分类>]`（**必须**存在于宿主侧站点上方，理由写在标记里）。
 *  分类只有两个合法值：`request-body`（HTTP 请求体）/ `host-state`（宿主自有状态）—— 见文件头的判定表。 */
function strictMarker(ctx) {
  const i = ctx.lastIndexOf('[we-json:strict')
  if (i < 0) return null
  const text = ctx.slice(i)
  const m = /^\[we-json:strict\|(request-body|host-state)\]/.exec(text)
  return { cat: m ? m[1] : 'unknown-marker', text }
}
/** 包内/包旁的正向写法（**残留判定与扫描器无关的那一路**）：站点没有严格标记、又出现在这些上下文里 ⇒ 残留。 */
const PKG_SIDE_CTX = /readProjectJson|readPkgEntryHeadJson|makePkg|\breadJson\b|project\.json|effect\.json|material\.json|scene\.json/

const FILES = [
  { key: 'server-8902', p: SERVER, label: 'server/we-scene-demo-server-8902.mjs' },
  { key: 'server-8899', p: SERVER8899_REAL, label: 'server/we-scene-demo-server.mjs' },
  { key: 'elysia', p: ELYSIA, label: 'elysia/demo-elysia.js' },
]
/* 宿主侧严格站点的**期望分类计数**（放宽/新增任何一处都会让计数不等 ⇒ 必红）。 */
const EXPECTED_STRICT = {
  'server-8902': { 'request-body': 3, 'host-state': 3 },
  'server-8899': { 'request-body': 1, 'host-state': 0 },
  'elysia': { 'request-body': 0, 'host-state': 0 },
}
const scanReport = {}
{
  const unclassified = [], pkgResidual = [], strictLedger = [], skippedAll = [], unmatchedMarker = []
  for (const f of FILES) {
    const src = fs.readFileSync(f.p, 'utf8')
    const { sites, skipped } = jsonParseSites(src)
    const per = { 'request-body': 0, 'host-state': 0, unknownMarker: 0, sites: sites.length }
    for (const s of sites) {
      const mk = strictMarker(s.ctx)
      if (mk) {
        /* 标记必须**自带分类**（`[we-json:strict|request-body]` / `[we-json:strict|host-state]`）——
           没写清分类 = 判红，避免"加了标记但没说为什么"混过去。 */
        if (mk.cat === 'unknown-marker') unmatchedMarker.push({ file: f.label, line: s.line, hint: mk.text.slice(0, 60).replace(/\s+/g, ' ') })
        else per[mk.cat]++
        strictLedger.push({ file: f.label, line: s.line, cat: mk.cat })
      } else if (PKG_SIDE_CTX.test(s.ctx) || PKG_SIDE_CTX.test(s.arg)) {
        pkgResidual.push({ file: f.label, line: s.line, arg: s.arg.slice(0, 60), ctx: s.ctx.replace(/\s+/g, ' ').slice(-70) })
      } else {
        unclassified.push({ file: f.label, line: s.line, arg: s.arg.slice(0, 60) })
      }
    }
    skippedAll.push({ file: f.label, skipped: skipped.map((x) => x.line + ':' + x.why) })
    scanReport[f.key] = per
  }
  check('S1-1', '三个文件里每一个代码区 `JSON.parse(` 站点都被归类（包内残留 / 宿主侧标记 / 未分类三选一，没有"来历不明"）',
    unclassified.length === 0 && unmatchedMarker.length === 0 && Object.values(scanReport).reduce((a, b) => a + b.sites, 0) >= 6,
    JSON.stringify({ 未分类: unclassified, 标记缺理由: unmatchedMarker, 跳过: skippedAll }))
  check('S1-2', '**包内/包旁 JSON 严格解析残留 0 处**（自推导扫描 + 与扫描器无关的正向写法两路都过）',
    pkgResidual.length === 0 &&
      /return parseWeJson\(fs\.readFileSync\(p, 'utf8'\)\)/.test(fs.readFileSync(SERVER, 'utf8')) &&     // 8902: 库项目录 project.json
      /const j = parseWeJson\(text\)/.test(fs.readFileSync(SERVER, 'utf8')) &&                          // 8902: 容器条目 project.json
      /lib\.parseWeJson\(rd\(b\)\)/.test(fs.readFileSync(ELYSIA, 'utf8')) &&                            // elysia: pkg 条目
      !/JSON\.parse\s*\(\s*rd\(/.test(fs.readFileSync(ELYSIA, 'utf8')),
    JSON.stringify({ 包内严格残留: pkgResidual }))
  const countBad = []
  for (const [k, want] of Object.entries(EXPECTED_STRICT)) {
    const got = scanReport[k] || {}
    for (const [cat, n] of Object.entries(want)) if (got[cat] !== n) countBad.push({ file: k, cat, got: got[cat], want: n })
  }
  check('S1-3', '宿主侧严格站点**逐类计数精确相等**（请求体 / 宿主自有状态；每处都带 `[we-json:strict]` 理由标记）：'
    + JSON.stringify(EXPECTED_STRICT),
    countBad.length === 0, JSON.stringify({ 不等: countBad, 实际: scanReport, 台账: strictLedger }))
  /* `.json()`（Response.json 严格解析）站点 —— 三个文件里 0 处（有就全表打印，不静默放过）。 */
  const dotJson = []
  for (const f of FILES) {
    const src = fs.readFileSync(f.p, 'utf8'), rs = commentRanges(src)
    const re = /\.json\s*\(\s*\)/g
    let m
    while ((m = re.exec(src)) !== null) { if (!inComment(rs, m.index) && !inStringOnLine(src, m.index)) dotJson.push({ file: f.label, line: lineOf(src, m.index) }) }
  }
  check('S1-4', '三个文件里 `.json()`（严格解析）站点 0 处', dotJson.length === 0, JSON.stringify(dotJson))
  console.log('  · WE-JSON-SERVER-SCAN ' + JSON.stringify({
    pkgStrictResidual: pkgResidual.length, unclassified: unclassified.length, dotJson: dotJson.length,
    strictPerFile: scanReport, hostStrictLedger: strictLedger.map((x) => x.file + ':' + x.line + ':' + x.cat),
  }))
  /* 台账外的**间接**路径（**只报告、不判红**）：`:8899` 的 `/project/<id>`、`/props/<id>` 走
     `core/scene-project-json.mjs` 的 `projectJsonProbe()`，那里也是严格 `JSON.parse`。本线可写文件里
     没有它 ⇒ 不动它，只把事实与建议打在门上，避免"看起来包内残留 0 处"被过度解读。 */
  try {
    const coreSrc = fs.readFileSync(path.join(ROOT, 'core', 'scene-project-json.mjs'), 'utf8')
    const stillStrict = /JSON\.parse\(fs\.readFileSync/.test(coreSrc)
    console.log('  · NOTE 间接路径（本线**未改**，不判红）：core/scene-project-json.mjs 的 projectJsonProbe 仍是严格 '
      + (stillStrict ? '`JSON.parse(fs.readFileSync)`' : '（已不是严格解析 —— 台账请更新）')
      + ' ⇒ :8899 的 /project/<id> 与 /props/<id> 命中"带尾逗号的官方 project.json"时仍是 404；'
      + '建议改用 parseWeJson 后由该文件的属主复核 tests/project-json-test.mjs 的 A9。')
  } catch { /* 文件不在就跳过这条说明 */ }
}

/* ═══════════════════════ S2：elysia 的 readJson（切片**生产代码**） ═══════════════════════ */
/** 从 `elysia/demo-elysia.js` 原文取出 `rd` 与 `makePkg`（平衡花括号），在隔离作用域里求值。 */
function loadElysiaMakePkg(p, lib) {
  const src = fs.readFileSync(p, 'utf8')
  const rdM = /^const rd = \(b\) =>[^\n]*$/m.exec(src)
  const mkSig = /function makePkg\(pkg\)\s*\{/.exec(src)
  if (!rdM || !mkSig) throw new Error('切片锚点没命中（rd / makePkg）')
  const open = mkSig.index + mkSig[0].length - 1
  let depth = 0, end = -1
  for (let i = open; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { end = i; break } } }
  if (end < 0) throw new Error('makePkg 花括号不配平')
  const body = src.slice(mkSig.index, end + 1)
  const fn = new Function('lib', rdM[0] + '\n' + body + '\n;return makePkg;')
  return fn(lib)
}
{
  const bytes = {}
  /* 官方那份带尾逗号的 effect.json（本机装了 WE 才有；没有就退到合成夹具，不假绿）。 */
  const officialRaw = fs.existsSync(OFFICIAL) ? fs.readFileSync(OFFICIAL, 'utf8') : null
  if (officialRaw) bytes['effect.json'] = new TextEncoder().encode(officialRaw)
  bytes['synthetic.json'] = new TextEncoder().encode('{\n  "passes": [ { "name": "a", }, ],\n  "note": "尾逗号 + 注释", // jsoncpp 允许\n}')
  bytes['healthy.json'] = new TextEncoder().encode('{"a":[1,{"b":"x"}]}')
  bytes['broken.json'] = new TextEncoder().encode('{"a":,}')
  bytes['str.json'] = new TextEncoder().encode('{"a":"x,}y","b":"p,]q"}')
  /* `lib` 只注入两件真实依赖：`getEntry`（测试桩给字节）与 **bundle 的 `parseWeJson` 本体**
     （`import` 真实现，不是副本 —— 这样"elysia 走的是页面/bundle 那一份实现"本身就是被断言的事实）。 */
  const bundle = await import('file://' + path.join(ROOT, 'core', 'we-scene-bundle.js'))
  const lib = { getEntry: (pkg, name) => pkg.__bytes[name] || null, parseWeJson: bundle.parseWeJson }
  let sliceErr = null, pkg = null
  try {
    const makePkg = loadElysiaMakePkg(ELYSIA, lib)
    pkg = makePkg({ entries: Object.keys(bytes).map((n) => ({ name: n })), __bytes: bytes })
    check('S2-0', 'elysia 的 `makePkg().readJson` **切片自生产代码**（锚点命中）且缺条目 ⇒ null（语义与改动前一致）',
      pkg.readJson('nope.json') === null && typeof pkg.readJson === 'function')
  } catch (e) {
    sliceErr = String((e && e.message) || e)
    check('S2-0', 'elysia 的 `makePkg().readJson` 切片自生产代码（锚点命中）', false, sliceErr)
  }
  if (pkg) {
    if (officialRaw) {
      let strictOk = true
      try { JSON.parse(officialRaw) } catch { strictOk = false }
      /* M6（退回严格）时这一行**必然抛** —— 那就是"改前读数"，不许让它逃到 S2-0 去（归因要准）。 */
      let r = null
      try { r = pkg.readJson('effect.json') } catch { r = null }
      check('S2-1', '官方 `effects/fluidsimulation/effect.json`（' + Buffer.byteLength(officialRaw) + ' B）：严格 `JSON.parse` **失败**、'
        + 'elysia 的 readJson **读得到**（20 pass / 9 FBO）',
        strictOk === false && !!r && Array.isArray(r.passes) && r.passes.length === 20 && Array.isArray(r.fbos) && r.fbos.length === 9,
        JSON.stringify({ strictOk, passes: r && r.passes ? r.passes.length : null, fbos: r && r.fbos ? r.fbos.length : null }))
      reading('S2-official', 'elysia readJson(effect.json) 条目数 passes=' + (r && r.passes ? r.passes.length : null)
        + ' fbos=' + (r && r.fbos ? r.fbos.length : null) + '；严格 JSON.parse=' + (strictOk ? '成功' : '失败')
        + (r ? '' : '；readJson 直接抛（= 改前行为）'))
    } else {
      console.log('  · S2-1 SKIP —— 本机没有官方 WE 目录（' + OFFICIAL + '），改用合成夹具断言（见 S2-2）')
    }
    const syn = pkg.readJson('synthetic.json')
    let brokenThrows = false
    try { pkg.readJson('broken.json') } catch { brokenThrows = true }
    const healthy = pkg.readJson('healthy.json'), strv = pkg.readJson('str.json')
    check('S2-2', 'elysia 语义与改动前逐条一致：尾逗号/注释读得到、**字符串内的 `,}` 一字不动**、健康 JSON 逐位等价、'
      + '**真坏 JSON 仍然抛**（不放宽）',
      !!syn && Array.isArray(syn.passes) && syn.passes.length === 1 && brokenThrows &&
        JSON.stringify(healthy) === JSON.stringify(JSON.parse('{"a":[1,{"b":"x"}]}')) &&
        strv.a === 'x,}y' && strv.b === 'p,]q',
      JSON.stringify({ syn: syn && syn.passes && syn.passes.length, brokenThrows, healthy, strv }))
  }
}

/* ═══════════════════════ E：端到端（真服务 + 真夹具库 + 真 HTTP） ═══════════════════════ */

/** 造一个真 PKG 家族容器（PKGV=场景包 / PKGM=合集；目录表 + 原样存储的载荷）。 */
function buildPkg(magic, files) {
  const i32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeInt32LE(n | 0, 0); return b }
  const u32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0, 0); return b }
  const sized = (s) => { const body = Buffer.from(String(s), 'utf8'); return Buffer.concat([i32(body.length), body]) }
  let off = 0
  const metas = files.map(([name, content]) => { const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content)); const m = { name, buf, offset: off }; off += buf.length; return m })
  const head = [sized(magic), i32(metas.length)]
  for (const m of metas) head.push(sized(m.name), u32(m.offset), u32(m.buf.length))
  return Buffer.concat([...head, ...metas.map((m) => m.buf)])
}
/** 尾逗号 + 注释的官方风格 `project.json`（jsoncpp 允许；标准 JSON.parse 不认）。 */
const TC_PROJECT = [
  '{',
  '  "type": "Scene",',
  '  "title": "尾逗号夹具",',
  '  "file": "scene.json",',
  '  "preview": "preview.gif",',
  '  "general": {',
  '    "properties": {',
  '      "clock": { "type": "bool", "text": "时钟/Clock", "value": false, "order": 100, },',
  '      "strength": { "type": "slider", "text": "强度/Strength", "value": 0.5, "min": 0, "max": 1.5, "order": 104, }, // jsoncpp 允许注释',
  '    },',
  '  },',
  '}',
].join('\n')
const CONTAINER_NAME = '夹具容器_01.mpkg'
const CONTAINER = buildPkg('PKGM0018', [
  ['preview.gif', Buffer.from('GIF89a-container-preview-bytes')],
  ['project.json', Buffer.from('{\n "title": "容器内尾逗号标题",\n "type": "Scene",\n "file": "scene.pkg",\n}', 'utf8')],
  ['scene.pkg', Buffer.from('PKGV0022-inside-container')],
])
function writeFile(p, content) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content) }
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wejson-8902-'))
  const ws = path.join(base, 'ws')
  const lib = path.join(ws, 'allwallpaper', 'dd')
  fs.mkdirSync(path.join(ws, 'reports'), { recursive: true })
  writeFile(path.join(lib, 'tc-item', 'project.json'), TC_PROJECT)                  // 包旁：尾逗号 + 注释
  writeFile(path.join(lib, 'tc-item', 'scene.pkg'), 'PKGV0022-tc')
  writeFile(path.join(lib, 'tc-item', 'preview.gif'), 'GIF89a-tc')
  writeFile(path.join(lib, 'healthy-item', 'project.json'), JSON.stringify({ type: 'scene', title: '健康夹具', file: 'scene.json', general: { properties: { clock: { type: 'bool', value: true } } } }))
  writeFile(path.join(lib, 'healthy-item', 'scene.pkg'), 'PKGV0022-healthy')
  writeFile(path.join(lib, 'broken-item', 'project.json'), '{ 这不是 JSON !! }')      // 真坏：**不许**被糊成能读
  writeFile(path.join(lib, 'broken-item', 'scene.pkg'), 'PKGV0022-broken')
  writeFile(path.join(lib, 'post-item', 'project.json'), JSON.stringify({ type: 'scene', title: '请求体夹具', general: { properties: { clock: { type: 'bool', value: false } } } }))
  writeFile(path.join(lib, 'post-item', 'scene.pkg'), 'PKGV0022-post')
  writeFile(path.join(lib, 'mpkg-item', CONTAINER_NAME), CONTAINER)                  // 包内：容器条目里的 project.json
  // 宿主自有状态的两份**损坏**夹具（尾逗号）：严格 ⇒ 读失败（不被糊成"能读"）
  writeFile(path.join(ws, 'reports', 'bench-props', 'tc-item.json'), '{\n "itemId": "tc-item",\n "overrides": { "clock": true, },\n}')
  writeFile(path.join(ws, 'reports', 'web-store', 'aaaaaa111111.json'), '{\n "wallId": "aaaaaa111111",\n "data": { "k": "v", },\n}')
  return { base, ws, lib }
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}
function request(port, method, urlPath, opts) {
  const o = opts || {}
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, o.headers || {})
    let body
    if (o.raw !== undefined) { body = Buffer.from(o.raw); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(body.length) }
    else if (o.json !== undefined) { body = Buffer.from(JSON.stringify(o.json)); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(body.length) }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, timeout: 8000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        let json = null
        try { json = JSON.parse(buf.toString('utf8')) } catch { json = null }
        resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), json })
      })
    })
    req.on('timeout', () => req.destroy(new Error('超时：' + method + ' ' + urlPath)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function startServer(fx) {
  const port = await freePort()
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    MPW_ROOT: fx.ws,
    MPW_LIBRARY_DIR: fx.lib,
    MPW_REPORTS_DIR: path.join(fx.ws, 'reports'),
    MPW_BENCH_STATIC_DIR: DEMO_DIR,
    MPW_OPEN_CMD: '/bin/true',
  })
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (c) => { log += c.toString() })
  child.stderr.on('data', (c) => { log += c.toString() })
  const deadline = Date.now() + 15000
  for (;;) {
    if (child.exitCode !== null) throw new Error('服务提前退出（code=' + child.exitCode + '）：\n' + log)
    try { const r = await request(port, 'GET', '/__health'); if (r.status === 200) break } catch { /* 还没起来 */ }
    if (Date.now() > deadline) throw new Error('服务 15s 未就绪：' + SERVER + '\n' + log)
    await sleep(100)
  }
  return { port, child, log: () => log, stop: async () => { try { child.kill('SIGTERM') } catch { /* 已退 */ } await sleep(120); try { child.kill('SIGKILL') } catch { /* 已退 */ } } }
}

/* ═══════════════════════ 主套件（--no-mutant 时只跑这一段） ═══════════════════════ */
async function runSuite() {
  const fx = makeFixture()
  const s = await startServer(fx)
  try {
    const P = s.port
    /* E1：/api/library —— 标题/属性是不是从**包旁** project.json 读出来的。 */
    const lib = await request(P, 'GET', '/api/library')
    const tc = ((lib.json || {}).items || []).find((x) => x.itemId === 'tc-item')
    reading('E1', 'GET /api/library → status=' + lib.status + ' items=' + ((lib.json || {}).items || []).length
      + ' tc-item.title=' + JSON.stringify(tc && tc.title) + ' tc-item.hasProject=' + (tc && tc.hasProject)
      + ' tc-item.properties=' + (tc && tc.properties ? Object.keys(tc.properties).length : null) + ' 项')
    check('E1', '尾逗号 project.json 的条目在 `/api/library` 里**读得到**标题与属性表（改前：title 回落到 itemId、hasProject=false）',
      lib.status === 200 && !!tc && tc.title === '尾逗号夹具' && tc.hasProject === true &&
        !!tc.properties && Object.keys(tc.properties).length === 2,
      JSON.stringify({ status: lib.status, title: tc && tc.title, hasProject: tc && tc.hasProject, properties: tc && tc.properties ? Object.keys(tc.properties) : null }))

    /* E2：/api/props —— 属性**条目数**（任务书要的前后读数之一）。宿主覆盖那条纪律归 E6，别混进来。 */
    const pr = await request(P, 'GET', '/api/props?item=tc-item')
    const props = (pr.json || {}).props || []
    reading('E2', 'GET /api/props?item=tc-item → status=' + pr.status + ' props=' + props.length
      + ' projectJson=' + (pr.json || {}).projectJson + ' overriddenCount=' + (pr.json || {}).overriddenCount)
    check('E2', '尾逗号 project.json ⇒ `/api/props` 出 2 条属性 + projectJson=true（改前：props=0 / projectJson=false）',
      pr.status === 200 && props.length === 2 && (pr.json || {}).projectJson === true,
      JSON.stringify({ status: pr.status, props: props.length, projectJson: (pr.json || {}).projectJson }))

    /* E3：/api/mpkg —— **包内**条目里的 project.json（容器摘要的 declared）。 */
    const mk = await request(P, 'GET', '/api/mpkg?item=mpkg-item&file=' + encodeURIComponent(CONTAINER_NAME))
    const declared = (mk.json || {}).declared
    reading('E3', 'GET /api/mpkg?item=mpkg-item → status=' + mk.status + ' tableOk=' + (mk.json || {}).tableOk
      + ' entries=' + (mk.json || {}).entries + ' declared.title=' + JSON.stringify(declared && declared.title))
    check('E3', '尾逗号**容器内** project.json ⇒ `/api/mpkg` 的 `declared` 读得到（改前：declared=null）',
      mk.status === 200 && !!declared && declared.title === '容器内尾逗号标题' && declared.type === 'Scene',
      JSON.stringify({ status: mk.status, declared }))

    /* E5：真坏 JSON **仍然**读不到（口径：不放宽）。 */
    const bad = await request(P, 'GET', '/api/props?item=broken-item')
    reading('E5', 'GET /api/props?item=broken-item（真坏 JSON）→ status=' + bad.status + ' props=' + ((bad.json || {}).props || []).length)
    check('E5', '真坏 JSON 仍然读不到（props=0；宽容**不许**把它糊成能读）',
      bad.status === 200 && ((bad.json || {}).props || []).length === 0, JSON.stringify({ status: bad.status, props: (bad.json || {}).props }))

    /* E7：宿主自有状态（web-store 帧存储）损坏 ⇒ 读失败，不许被糊成"能读"。 */
    const ws1 = await request(P, 'GET', '/api/web-store?wallId=aaaaaa111111')
    reading('E7', 'GET /api/web-store?wallId=aaaaaa111111（损坏的帧存储）→ status=' + ws1.status + ' data=' + JSON.stringify((ws1.json || {}).data))
    check('E7', '宿主自有状态（web-store 帧存储）损坏 ⇒ **不**被宽容糊成"能读"（data={}）',
      ws1.status === 200 && (ws1.json || {}).data && Object.keys((ws1.json || {}).data).length === 0,
      JSON.stringify({ status: ws1.status, data: (ws1.json || {}).data }))

    /* E4：HTTP 请求体**保持严格**（尾逗号 ⇒ 400；合法 ⇒ 200）。放在最后：合法那次会落覆盖文件。 */
    const bad4 = await request(P, 'POST', '/api/props?item=post-item', { raw: '{"clock":true,}' })
    const ok4 = await request(P, 'POST', '/api/props?item=post-item', { json: { clock: true } })
    reading('E4', 'POST /api/props（请求体）→ 尾逗号 body status=' + bad4.status + '、合法 body status=' + ok4.status)
    check('E4', 'HTTP 请求体**保持严格**：带尾逗号的 body ⇒ **400**（客户端 bug 不许被糊成"服务端读懂了"）；合法 body ⇒ 200',
      bad4.status === 400 && ok4.status === 200 && /JSON/.test(bad4.body),
      JSON.stringify({ badStatus: bad4.status, badBody: bad4.body.slice(0, 80), okStatus: ok4.status }))

    /* E6：宿主自有状态（属性覆盖）损坏 ⇒ 不许生效（只依赖**覆盖文件**的读侧，刻意不依赖 project.json，
       这样"把 project.json 改回严格"的变异不会连带把这条判据弄红 —— 每条判据只钉一件事）。 */
    const pr2 = await request(P, 'GET', '/api/props?item=tc-item')
    const clockDesc = (((pr2.json || {}).props) || []).find((d) => d.name === 'clock')
    reading('E6', 'GET /api/props?item=tc-item overridden 字段 → ' + JSON.stringify((pr2.json || {}).overridden)
      + ' overriddenCount=' + (pr2.json || {}).overriddenCount + ' clock.overridden=' + (clockDesc && clockDesc.overridden))
    check('E6', '损坏的宿主属性覆盖（bench-props 尾逗号）**不许**被宽容糊成"能读"（overridden={}、overriddenCount=0）',
      (pr2.json || {}).overriddenCount === 0 && JSON.stringify((pr2.json || {}).overridden) === '{}',
      JSON.stringify({ overridden: (pr2.json || {}).overridden, overriddenCount: (pr2.json || {}).overriddenCount }))
  } finally { await s.stop() }
  return fx
}

/* ═══════════════════════ M：变异自证（隔离副本；真树一个字节都不动） ═══════════════════════ */

/** 用平衡花括号把函数体整段换掉（不靠缩进/正则）。 */
function replaceFunctionBody(src, name, newBody) {
  const sig = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{')
  const m = sig.exec(src)
  if (!m) return null
  const open = m.index + m[0].length - 1
  let depth = 0, end = -1
  for (let i = open; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { end = i; break } } }
  if (end < 0) return null
  return src.slice(0, open + 1) + newBody + src.slice(end)
}
/** 变异副本：把 8902 的相对 import 改写成指向**真树**的绝对路径（副本在 /tmp，相对路径会断）。 */
function mutantServerSource(src) {
  return src.replace(/from '(\.\.?\/[^']+)'/g, (m0, rel) => 'from ' + JSON.stringify(path.resolve(path.dirname(SERVER_REAL), rel)))
}
const STRICT_READ_PROJECT = "  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\\uFEFF/, '')) } catch { return null }"
const STRICT_ENTRY_JSON = "      const j = JSON.parse(text)\n      return j && typeof j === 'object' && !Array.isArray(j) ? j : null"
const TOLERANT_OVERRIDES = "  try {\n    const j = parseWeJson(fs.readFileSync(p, 'utf8'))\n"
const TOLERANT_BODY = "    const v = parseWeJson(text)\n"
const STRICT_STORE = "    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\\uFEFF/, ''))\n    return (j && typeof j === 'object' && j.data && typeof j.data === 'object') ? j.data : {}"
const TOLERANT_STORE = "    const j = parseWeJson(fs.readFileSync(file, 'utf8'))\n    return (j && typeof j === 'object' && j.data && typeof j.data === 'object') ? j.data : {}"

const MUTANTS = [
  {
    id: 'M1', kind: 'server', dir: '改回去', name: '`:8902` readProjectJson 退回严格 JSON.parse（修之前的行为）',
    build: (src) => src.replace("  try { return parseWeJson(fs.readFileSync(p, 'utf8')) } catch (e) { return swallowWeJson('readProjectJson(' + p + ')', e) }", STRICT_READ_PROJECT),
    want: () => ['S1-2', 'E1', 'E2'],
  },
  {
    id: 'M2', kind: 'server', dir: '改回去', name: '`:8902` readPkgEntryHeadJson（容器条目）退回严格 JSON.parse',
    build: (src) => src.replace("      const j = parseWeJson(text)\n      return j && typeof j === 'object' && !Array.isArray(j) ? j : null", STRICT_ENTRY_JSON),
    want: () => ['S1-2', 'E3'],
  },
  {
    id: 'M6', kind: 'elysia', dir: '改回去', name: 'elysia `makePkg().readJson` 退回严格 JSON.parse',
    build: (src) => src.replace('lib.parseWeJson(rd(b))', 'JSON.parse(rd(b))'),
    /* 官方那份 effect.json 不在场时 S2-1 会 SKIP（诚实跳过，不假绿）⇒ 期望红集跟着变。 */
    want: () => (fs.existsSync(OFFICIAL) ? ['S1-2', 'S2-1'] : ['S1-2']),
  },
  {
    id: 'M3', kind: 'server', dir: '反向放宽', name: '把 `:8902` 的**宿主属性覆盖**读侧改成宽容（"读失败≠没存过"这条纪律的反例）',
    build: (src) => src.replace("  try {\n    const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\\uFEFF/, ''))\n", TOLERANT_OVERRIDES),
    want: () => ['S1-3', 'E6'],
  },
  {
    id: 'M4', kind: 'server', dir: '反向放宽', name: '把 `:8902` 的 **HTTP 请求体**解析改成宽容（客户端坏 JSON 不再 400）',
    build: (src) => src.replace('    const v = JSON.parse(text)\n', TOLERANT_BODY),
    want: () => ['S1-3', 'E4'],
  },
  {
    id: 'M5', kind: 'server', dir: '反向放宽', name: '把 `:8902` 的**宿主帧存储**（web-store）读侧改成宽容',
    build: (src) => src.replace(STRICT_STORE, TOLERANT_STORE),
    want: () => ['S1-3', 'E7'],
  },
]

async function main() {
  const fx = await runSuite()
  const treeBefore = { server: fs.readFileSync(SERVER_REAL, 'utf8'), server8899: fs.readFileSync(SERVER8899_REAL, 'utf8'), elysia: fs.readFileSync(ELYSIA_REAL, 'utf8') }
  let mutantRows = []
  if (!NO_MUT) {
    console.log('\n== 变异自证（隔离副本；真树一个字节都不动）==')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wejson-srv-mut-'))
    try {
      for (const mu of MUTANTS) {
        const realSrc = fs.readFileSync(mu.kind === 'elysia' ? ELYSIA_REAL : SERVER_REAL, 'utf8')
        let mutated = mu.build(realSrc)
        if (typeof mutated !== 'string' || mutated === realSrc) {
          check('M-' + mu.id, '变异（' + mu.name + '）—— 变异锚点命中（可替换）', false, '锚点没命中（变异体构造失败）')
          continue
        }
        const args = ['--no-mutant']
        if (mu.kind === 'elysia') {
          const p = path.join(tmp, mu.id + '-demo-elysia.js')
          fs.writeFileSync(p, mutated)
          args.push('--elysia=' + p)
        } else {
          const p = path.join(tmp, mu.id + '-server-8902.mjs')
          fs.writeFileSync(p, mutantServerSource(mutated))
          args.push('--server=' + p)
        }
        const r = await new Promise((resolve) => {
          const c = spawn(process.execPath, [HERE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
          let out = ''
          c.stdout.on('data', (d) => { out += d.toString() })
          c.stderr.on('data', (d) => { out += d.toString() })
          c.on('exit', (code) => resolve({ code, out }))
        })
        const reds = r.out.split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*([A-Za-z0-9._-]+)/.exec(l) || [])[1]).filter(Boolean)
        const want = mu.want()
        const same = reds.length === want.length && want.every((x) => reds.includes(x))
        console.log('\n─── 变异 ' + mu.id + '（' + mu.dir + '）：' + mu.name)
        console.log('    子进程退出码 = ' + r.code + '（要求非 0）')
        const readings = r.out.split('\n').filter((l) => l.includes('· 读数')).map((l) => l.trim())
        console.log('    ' + (mu.dir === '改回去' ? '**改前读数**（变异体 = 修之前的行为）' : '**放宽后的读数**（必须与真树不同）') + '：')
        console.log(readings.length ? readings.map((l) => '      ' + l).join('\n') : '      （无）')
        console.log('    RED 行（原文）：\n' + (r.out.split('\n').filter((l) => l.includes('✗')).map((l) => '      ' + l.trim()).join('\n') || '      （无）'))
        check('M-' + mu.id, '变异（' + mu.name + '）⇒ **期望红集 == 实际红集**（期望 ' + JSON.stringify(want) + '）',
          r.code === 1 && same, 'exit=' + r.code + ' 期望=' + JSON.stringify(want) + ' 实际=' + JSON.stringify(reds.slice(0, 12)))
        if (r.code === 1 && same) console.log('    MUTANT-RED-OK ' + mu.id + ' 红集=' + JSON.stringify(reds))
        mutantRows.push({ id: mu.id, dir: mu.dir, code: r.code, want, reds, readings })
      }
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp 清不掉不致命 */ } }
    check('M-X', '真树 server/*.mjs 与 elysia/demo-elysia.js 未被变异触碰（逐字节相同）',
      treeBefore.server === fs.readFileSync(SERVER_REAL, 'utf8') &&
      treeBefore.server8899 === fs.readFileSync(SERVER8899_REAL, 'utf8') &&
      treeBefore.elysia === fs.readFileSync(ELYSIA_REAL, 'utf8'))
  }
  try { fs.rmSync(fx.base, { recursive: true, force: true }) } catch { /* 夹具清不掉不致命 */ }

  const ok = fail === 0
  console.log('\n═══ 汇总 ═══')
  console.log('断言 ' + (pass + fail) + ' 项：通过 ' + pass + ' / 失败 ' + fail)
  for (const id of failedIds) console.log('  FAIL ' + id)
  console.log(ok ? 'WE-JSON-TOLERANCE-SERVER: 全绿 ✓' : 'WE-JSON-TOLERANCE-SERVER: 有失败 ✗')
  if (JSON_OUT) console.log('WE-JSON-TOLERANCE-SERVER-JSON ' + JSON.stringify({ ok, pass, fail, failed: failedIds, scan: scanReport, mutants: mutantRows }))
  process.exit(ok ? 0 : 1)
}

const watchdog = setTimeout(() => { console.error('WE-JSON-TOLERANCE-SERVER: 看门狗超时（180s）—— 本套件应当秒级完成'); process.exit(1) }, 180000)
watchdog.unref()
main().catch((e) => {
  console.error('WE-JSON-TOLERANCE-SERVER: 崩了\n' + (e && e.stack ? e.stack : e))
  if (JSON_OUT) console.log('WE-JSON-TOLERANCE-SERVER-JSON ' + JSON.stringify({ ok: false, crashed: String((e && e.message) || e) }))
  process.exit(1)
})

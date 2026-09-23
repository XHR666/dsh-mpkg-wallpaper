// tools/we-json-tolerance-test.mjs —— 官方随包 JSON 的**宽容解析**判据（插件侧，P-177 同口径）。
//
// 被验对象（两处实现，同一语义）：
//   · `lib/client.js` 的 `MPW-WEJSON` 块（`mpwParseWeJson` / `mpwWeJsonStats` / `mpwWeJsonSwallowed`）——
//     浏览器侧；**所有吃"包内条目文本"的解析点**都必须走它；
//   · `lib/pkg-extract.js` 的同名块 —— 宿主（Node）侧（scene.json / model.json / material.json）。
// 参照物：渲染器仓 `core/we-scene-bundle.js` 的 `export function parseWeJson` + `weJsonStats()`（P-177）。
//
// ── 为什么（官方证据，2026-09-24 官方产物盘点）────────────────────────────────────────
//   官方随包发布的 `wallpaper_engine/assets/effects/fluidsimulation/effect.json`（10,224 B）**自己就带尾逗号**
//   （第 402 行 `"shaders/effects/fluidsimulation_normal.vert",` 后面紧跟 `}`）⇒ 标准 `JSON.parse` 报
//   `Expecting value: line 403 column 2`。WE 照发照用 ⇒ 官方容忍尾逗号（引擎用 jsoncpp，二进制里带
//   `allowTrailingCommas`/`allowComments` 开关名）。我们这边凡是"读失败就 catch 成 null"的地方都是**静默**
//   丢整份文件：project.json 属性表空白、web 壁纸 general.properties 一条都推不下去、宿主侧 scene.json
//   少一层/少一条音轨 —— 日志一行都没有。
//
// ── 三层判据（纯 Node、无浏览器、无网络、不读语料，实测 <3s）────────────────────────────
//   S1 结构 / 静态覆盖（自推导扫描，不写死行号）：
//      · 两处实现的标记块与定义都在；
//      · `lib/client.js` 里**每一个**代码区 `JSON.parse(` 站点逐条归类：**包内 0 处残留严格 `JSON.parse`**；
//        非包内的那些只能落进**带理由**的白名单，且白名单每条都必须仍然命中（防"遮羞布"腐烂）；
//      · 包内解析点清单（6 处）逐条按**模式**存在且都走 `mpwParseWeJson`；包内 `.json()` 残留 0 处；
//      · 每个"吞掉"的包内解析点的 catch 里都有 `mpwWeJsonSwallowed`（计数 + 一行诊断，不许静默）。
//   S2 行为（**把两处实现切片后跑生产代码**，夹具与渲染器 `tests/we-json-tolerance-test.mjs` **逐条同一套**）：
//      尾逗号（对象/数组/嵌套/多处/单键）、**字符串内的 `,}`/`,]`/`//`/`/*` 一个字都不动**、注释只在尾逗号
//      仍失败时才吃、BOM、真坏 JSON **仍然抛**、计数逐项 +1、`stats()` 只读快照、吞掉要记账、
//      **健康文件逐位等价 `JSON.parse`**（含确定性 fuzz）；
//      · **两仓同口径的唯一证据**：同一组夹具喂给 ①插件 client 实现 ②插件 pkg-extract 实现
//        ③渲染器 `parseWeJson`，三边读数（解析值 + 计数增量 + 抛/不抛）**逐条相同**。
//   S3 变异自证（隔离副本；真树一个字节都不动，跑完对拍 sha256）：
//      M1 把 `mpwParseWeJson` 退回严格 `JSON.parse` ⇒ 尾逗号/注释/BOM 夹具必红；
//      M2 把 `extractProjectInfo` 的调用点换回严格解析 ⇒ 静态覆盖必红；
//      M3 把某个吞点的 `mpwWeJsonSwallowed` 拿掉 ⇒ 记账静态断言必红。
//      三组都要求 **期望红集 == 实际红集**，并打印 `MUTANT-RED-OK`。
//
// 用法：
//   node tools/we-json-tolerance-test.mjs                    # 全部（含三组变异）
//   node tools/we-json-tolerance-test.mjs --no-mutations     # 只跑 S1/S2（变异体子进程用）
//   node tools/we-json-tolerance-test.mjs --repo <副本根>     # 变异副本（真树不动）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const REPO = path.resolve(argOf('--repo', path.join(here, '..')))
const NO_MUT = process.argv.includes('--no-mutations')
const CLIENT = path.join(REPO, 'lib', 'client.js')
const PKGX = path.join(REPO, 'lib', 'pkg-extract.js')
/* 渲染器仓（兄弟仓，只读）：`<工作区>/we-scene-demo`。变异副本里通常不存在 ⇒ S2-P2 诚实跳过（不假绿）。 */
const SIBLING = path.join(REPO, '..', 'we-scene-demo')
const RENDERER_BUNDLE = path.join(SIBLING, 'core', 'we-scene-bundle.js')
const RENDERER_TEST = path.join(SIBLING, 'tests', 'we-json-tolerance-test.mjs')

let pass = 0, fail = 0
const failed = []
const check = (id, name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + id + ' ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; failed.push(id); console.log('  ✗ ' + id + ' ' + name + (detail ? '  → ' + detail : '')) }
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length
const clientSrc = fs.readFileSync(CLIENT, 'utf8')
const pkgxSrc = fs.readFileSync(PKGX, 'utf8')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-wejson-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 忽略 */ } })

console.log('== 官方随包 JSON 的宽容解析（P-177 同口径）+ 包内解析点全覆盖 ==')
console.log('   repo=' + REPO)

/* ═══════════════════════ S1：结构 / 静态覆盖（自推导，不写死行号） ═══════════════════════ */

/** 注释范围（`/* *\/` 与 `//`，含行尾）。只用来判"这个站点在不在注释里"；判不了字符串（见下）。 */
function commentRanges(src) {
  const out = []
  for (const re of [/\/\*[\s\S]*?\*\//g, /\/\/[^\n]*/g]) {
    let m
    while ((m = re.exec(src)) !== null) out.push([m.index, m.index + m[0].length])
  }
  return out
}
const inComment = (rs, idx) => rs.some(([a, b]) => idx >= a && idx < b)
/** 行内未闭合引号 ⇒ 站点在（单行）字符串里。多行模板串在 client.js 里不含解析点（站点表全量打印可人工核）。 */
function inStringOnLine(src, idx) {
  const ls = src.lastIndexOf('\n', idx) + 1
  const before = src.slice(ls, idx)
  let q = 0
  for (let i = 0; i < before.length; i++) {
    if (before[i] === '\\') { i++; continue }
    if (before[i] === '"' || before[i] === "'" || before[i] === '`') q++
  }
  return q % 2 === 1
}
/** 取 `(` 起点的参数文本（平衡括号；原文）。 */
function callArg(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (!depth) return src.slice(openIdx + 1, i) }
  }
  return ''
}
/** 取 `{` 起点的块体（平衡花括号；原文）。 */
function braceBody(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (!depth) return src.slice(openIdx + 1, i) }
  }
  return ''
}
/** 代码区的 `JSON.parse(` 站点（注释里/字符串里的另记，不算站点）。 */
function jsonParseSites(src) {
  const rs = commentRanges(src)
  const sites = [], skipped = []
  const re = /JSON\.parse\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    const at = m.index
    const arg = callArg(src, at + m[0].length - 1).trim()
    const ctx = src.slice(Math.max(0, at - 700), at)
    const fnM = /function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{[^{}]*$/.exec(ctx.replace(/\n/g, ' '))
    const site = { at, line: lineOf(src, at), arg, ctx, fn: fnM ? fnM[1] : '' }
    if (inComment(rs, at)) skipped.push(Object.assign({ why: '注释' }, site))
    else if (inStringOnLine(src, at)) skipped.push(Object.assign({ why: '字符串' }, site))
    else sites.push(site)
  }
  return { sites, skipped }
}

const BEG = '/* ═══ MPW-WEJSON-BEGIN ═══ */'
const END = '/* ═══ MPW-WEJSON-END ═══ */'
/** 切出 MPW-WEJSON 块并在隔离作用域里跑**生产实现**（client.js 的块引用 mpwErr/window 都有兜底）。 */
function loadBlockApi(src, label) {
  const b = src.indexOf(BEG), e = src.indexOf(END)
  if (b < 0 || e < 0 || e < b) throw new Error(label + ': 找不到 MPW-WEJSON-BEGIN/END 标记')
  const block = src.slice(b, e + END.length)
  const fn = new Function(block + '\n;return { parse: mpwParseWeJson, stats: mpwWeJsonStats, swallowed: mpwWeJsonSwallowed };')
  return { api: fn(), block, begin: b, end: e + END.length }
}

/* ── S1-1：两处实现都在（标记块 + 三个入口） ── */
let cBlock = null, pBlock = null
{
  try { cBlock = loadBlockApi(clientSrc, 'client.js') } catch (e) { /* 下面报 */ }
  try { pBlock = loadBlockApi(pkgxSrc, 'pkg-extract.js') } catch (e) { /* 下面报 */ }
  check('S1-1', '两处实现都有 MPW-WEJSON 标记块 + `mpwParseWeJson`/`mpwWeJsonStats`/`mpwWeJsonSwallowed`',
    !!(cBlock && pBlock && typeof cBlock.api.parse === 'function' && typeof cBlock.api.stats === 'function' &&
      typeof cBlock.api.swallowed === 'function' && typeof pBlock.api.parse === 'function' && typeof pBlock.api.stats === 'function'),
    JSON.stringify({ client: !!cBlock, pkgExtract: !!pBlock }))
}

/* ── S1-2：client.js 的 JSON.parse 站点逐条归类（包内 0 处残留） ── */
const CLIENT_PKG_RULES = [
  { id: 'pkg-readEntry', why: 'mpkg 容器条目文本（readEntry ⇒ project.json 等包内文件）', test: (s) => /readEntry\s*\(/.test(s.arg) },
  { id: 'pkg-hostMedia', why: '宿主 /media 供来的包内条目文本（readFull ⇒ 同一个 project.json）', test: (s) => /readFull\s*\(/.test(s.arg) },
  { id: 'pkg-projectText', why: 'project.json 文本（extractProjectInfo 的入参就是包内 project.json）', test: (s) => /\bjsonText\b/.test(s.arg) },
]
/* 非包内白名单：每条都必须**带理由**，且必须仍然命中（S1-2c 反查，防白名单腐烂成遮羞布）。 */
const CLIENT_NONPKG_RULES = [
  { id: 'wejson-internal', why: '宽容解析实现自己的三次尝试（`JSON.parse` 本体），不是"读包内条目"的调用点', test: (s) => s.at >= cBlock.begin && s.at <= cBlock.end },
  { id: 'frame-localstorage', why: '帧内作者页面的 localStorage 运行时状态（审计 #12 要求 error 与 empty 分开；宽容会把"损坏"糊成"能读"）', test: (s) => /mpwReadFrameStored|ls\.getItem/.test(s.fn + ' ' + s.ctx) },
  { id: 'host-settings', why: '宿主自己的设置/自愈台账 JSON（localStorage STORE_KEY / mpw_settings_backup / MPW_WEBRISK_SEEN_KEY / mpwPersistSection 落盘快照 / 帧内 setWebCfg）——不是包内条目，且损坏必须保持"读失败≠没存过"的语义', test: (s) => /localStorage|mpw_settings_backup|MPW_WEBRISK_SEEN_KEY|STORE_KEY|mpwPersistSection|setWebCfg|loadJson/.test(s.arg + ' ' + s.ctx) },
  { id: 'deep-clone', why: '深拷贝惯用法 `JSON.parse(JSON.stringify(x))`：根本没有外部文本', test: (s) => /JSON\.stringify/.test(s.arg) },
  { id: 'builtin-const', why: '本文件内置常量（面板离线副本 MPW_DIAG_FLAGS_FALLBACK），编译期定死、不是包内条目', test: (s) => /MPW_DIAG_FLAGS_FALLBACK/.test(s.arg) },
  { id: 'dom-attr-payload', why: 'DOM 属性上的预览候选链载荷（UI 状态），不是包内条目', test: (s) => /mpwThumbPayloadGet|data-mpw-thumb-list/.test(s.fn + ' ' + s.ctx) },
  { id: 'user-backup-file', why: '用户导入的**插件备份文件**（自产 app:"dsh-mpkg-wallpaper"）——不是 WE 包；且坏档必须报错（backup.bad），不能糊过去', test: (s) => /reader\.result|importBackup/.test(s.arg + ' ' + s.ctx) },
]
{
  const { sites, skipped } = jsonParseSites(clientSrc)
  const unclassified = [], pkgSites = [], matched = new Map()
  for (const s of sites) {
    const pkg = CLIENT_PKG_RULES.find((r) => r.test(s))
    if (pkg) { pkgSites.push({ line: s.line, rule: pkg.id, arg: s.arg.slice(0, 50) }); continue }
    const w = CLIENT_NONPKG_RULES.find((r) => r.test(s))
    if (!w) { unclassified.push({ line: s.line, arg: s.arg.slice(0, 60) }); continue }
    matched.set(w.id, (matched.get(w.id) || 0) + 1)
  }
  check('S1-2a', 'client.js 里每一个代码区 `JSON.parse(` 站点都被归类（没有"来历不明"的解析点；注释/字符串里的另记）',
    unclassified.length === 0 && sites.length >= 10 && skipped.every((s) => s.why === '注释' || s.why === '字符串'),
    JSON.stringify({ 站点: sites.length, 跳过: skipped.map((s) => s.line + ':' + s.why), 未分类: unclassified }))
  /* 除了"逐条归类"，再加一条**与扫描器无关**的正向证据：包内读法（readEntry/readFull/jsonText）一个都不许配严格解析。 */
  const rawResidual = [
    /JSON\.parse\s*\(\s*new TextDecoder/.test(clientSrc) ? 'JSON.parse(new TextDecoder…' : null,
    /JSON\.parse\s*\(\s*jsonText\s*\)/.test(clientSrc) ? 'JSON.parse(jsonText)' : null,
    /JSON\.parse\s*\(\s*(?:txt|pjTxt)\s*\)/.test(clientSrc) ? 'JSON.parse(txt|pjTxt)' : null,
  ].filter(Boolean)
  check('S1-2b', 'client.js 里**包内 JSON 解析点 0 处残留严格 `JSON.parse`**（逐条归类 + 与扫描器无关的正向模式两路都过）',
    pkgSites.length === 0 && rawResidual.length === 0,
    JSON.stringify({ pkgSites, 正向残留: rawResidual }))
  const deadRules = CLIENT_NONPKG_RULES.filter((r) => !matched.get(r.id)).map((r) => r.id)
  check('S1-2c', '非包内白名单每条都仍然命中（台账不腐烂；' + CLIENT_NONPKG_RULES.length + ' 条各带理由）',
    deadRules.length === 0,
    JSON.stringify({ 命中: Object.fromEntries(matched), 失效: deadRules }))
}

/* ── S1-3：包内解析点清单（6 处）逐条按模式存在，且都走 mpwParseWeJson ── */
const PKG_INVENTORY = [
  { id: 'mpkg 容器内 project.json（readEntry）', re: /mpwParseWeJson\(new TextDecoder\(\)\.decode\(await readEntry\(proj\)\)\)/ },
  { id: '宿主 /media 的 project.json（readFull）', re: /mpwParseWeJson\(new TextDecoder\(\)\.decode\(await readFull\(projIdx\)\)\)/ },
  { id: 'project.json 文本（extractProjectInfo）', re: /mpwParseWeJson\(jsonText\)/ },
  { id: '网页壁纸目录 project.json（webShimPushProps）', re: /mpwParseWeJson\(txt\)[\s\S]{0,220}?mpwWeJsonSwallowed\("webShimPushProps:project\.json"/ },
  { id: 'L2D loadJson.json（设置页 webCfg）', re: /mpwParseWeJson\(txt\)[\s\S]{0,220}?mpwWeJsonSwallowed\("webCfg:loadJson\.json"/ },
  { id: '场景目录 project.json（custom-folder，时段导入）', re: /mpwParseWeJson\(pjTxt\)[\s\S]{0,220}?mpwWeJsonSwallowed\("customFolder:project\.json/ },
]
{
  const missing = PKG_INVENTORY.filter((x) => !x.re.test(clientSrc)).map((x) => x.id)
  check('S1-3', '包内 JSON 解析点清单（' + PKG_INVENTORY.length + ' 处）逐条在，且都走 `mpwParseWeJson`',
    missing.length === 0, JSON.stringify({ 缺: missing }))
}

/* ── S1-4：包内 JSON 的 `Response.json()` 残留 0 处（其余 .json() 站点是宿主路由/渲染器生成物，全表打印留证） ── */
{
  const re = /\.json\s*\(\s*\)/g
  const rs = commentRanges(clientSrc)
  const pkgBad = [], all = []
  let m
  while ((m = re.exec(clientSrc)) !== null) {
    if (inComment(rs, m.index) || inStringOnLine(clientSrc, m.index)) continue   // 注释里举例的 `r.json()` 不算站点
    const line = lineOf(clientSrc, m.index)
    const ctx = clientSrc.slice(Math.max(0, m.index - 300), m.index + 20)
    const pkgName = /(project|scene|loadJson|material|model|effect)\.json/.test(ctx)
    const pkgFolder = /custom-folder|library-|dirBase|HOST_BASE|\/media|\.mpkg|scene\.pkg/.test(ctx)
    if (pkgName && pkgFolder) pkgBad.push({ line, ctx: ctx.replace(/\s+/g, ' ').slice(-80) })
    else all.push(line)
  }
  check('S1-4', 'client.js 里包内 JSON 不再走 `Response.json()`（严格解析）—— 0 处残留；其余 ' + all.length +
    ' 处 `.json()` 都是宿主自有路由/渲染器生成物（行号留证）', pkgBad.length === 0, JSON.stringify({ 包内残留: pkgBad }))
}

/* ── S1-5：包内解析点都记账（catch 里必须有 mpwWeJsonSwallowed） ── */
function callSites(src, name) {
  const rs = commentRanges(src)
  const re = new RegExp(name + '\\s*\\(', 'g')
  const out = []
  let m
  while ((m = re.exec(src)) !== null) {
    const at = m.index
    if (inComment(rs, at) || inStringOnLine(src, at)) continue
    const lineText = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', at))
    if (/function\s+$/.test(src.slice(Math.max(0, at - 40), at)) || /__mpwWeJson\s*=/.test(lineText)) continue
    const seg = src.slice(at, at + 2600)
    const ci = seg.indexOf('catch')
    let accounted = false, sawCatch = false
    if (ci >= 0) {
      sawCatch = true
      const open = seg.indexOf('{', ci)
      accounted = open >= 0 && /mpwWeJsonSwallowed/.test(braceBody(seg, open))
    }
    out.push({ line: lineOf(src, at), sawCatch, accounted })
  }
  return out
}
{
  const sites = callSites(clientSrc, 'mpwParseWeJson')
  const swallowed = sites.filter((s) => s.sawCatch)
  const unaccounted = swallowed.filter((s) => !s.accounted)
  check('S1-5', 'client.js：包内解析点 ' + sites.length + ' 处（清单 6 处）；凡"原来就吞"的（' + swallowed.length +
    ' 处）catch 里都有 `mpwWeJsonSwallowed`（计数 + 一行诊断，不静默）',
    sites.length === PKG_INVENTORY.length && swallowed.length === PKG_INVENTORY.length && unaccounted.length === 0,
    JSON.stringify({ sites: sites.length, swallowed: swallowed.length, unaccounted }))
}

/* ── S1-6：pkg-extract.js（宿主侧）同样 0 处残留 ── */
{
  const { sites } = jsonParseSites(pkgxSrc)
  const blockLines = [lineOf(pkgxSrc, pkgxSrc.indexOf(BEG)), lineOf(pkgxSrc, pkgxSrc.indexOf(END))]
  const bad = sites.filter((s) => s.line < blockLines[0] || s.line > blockLines[1]).map((s) => ({ line: s.line, arg: s.arg.slice(0, 50) }))
  const rawResidual = [
    /JSON\.parse\s*\(\s*textDecoder\.decode/.test(pkgxSrc) ? 'JSON.parse(textDecoder.decode…' : null,
    /JSON\.parse\s*\(\s*readFileSync/.test(pkgxSrc) ? 'JSON.parse(readFileSync…' : null,
  ].filter(Boolean)
  const calls = callSites(pkgxSrc, 'mpwParseWeJson')
  const unaccounted = calls.filter((s) => s.sawCatch && !s.accounted)
  check('S1-6', 'pkg-extract.js：`JSON.parse` 只出现在 MPW-WEJSON 块内（包内读取点 0 处残留；' + calls.length +
    ' 处读取点都记账）',
    bad.length === 0 && rawResidual.length === 0 && calls.length >= 4 && unaccounted.length === 0,
    JSON.stringify({ 块外JSONparse: bad, 正向残留: rawResidual, 读取点: calls.length, 未记账: unaccounted }))
}

/* ═══════════════════════ S2：行为夹具（与渲染器同一套输入） ═══════════════════════ */

/* 夹具表：**逐条抄自**渲染器 `tests/we-json-tolerance-test.mjs`（S2 段），只在末尾追加一条
   "尾逗号后面隔着块注释"的判别性夹具（extra: true —— 不参与"同源"断言，参与全部行为断言）。 */
const FIXTURES = [
  { id: 'S2-F1', name: '对象尾逗号', text: '{"a":1,"b":[1,2,],}', want: { a: 1, b: [1, 2] }, counter: 'trailingComma' },
  { id: 'S2-F2', name: '数组尾逗号', text: '[1,2,3,]', want: [1, 2, 3], counter: 'trailingComma' },
  { id: 'S2-F3', name: '嵌套 + 多处', text: '{"a":{"b":[{"c":1,},],},}', want: { a: { b: [{ c: 1 }] } }, counter: 'trailingComma' },
  { id: 'S2-F4', name: '只留一个逗号', text: '{"a":1,}', want: { a: 1 }, counter: 'trailingComma' },
  { id: 'S2-F5', name: '合法 JSON 逐位相同', text: '{"a":[1,{"b":"x"}]}', want: { a: [1, { b: 'x' }] }, counter: 'plain' },
  { id: 'S2-F6', name: '字符串内的 `,}`/`,]`/`//`/`/*` 内容逐位不变', text: '{"a":"x,}y","b":"p,]q","c":"line//not-comment","d":"/*keep*/"}', want: { a: 'x,}y', b: 'p,]q', c: 'line//not-comment', d: '/*keep*/' }, counter: 'plain' },
  { id: 'S2-F7', name: '带 BOM 的官方文件能解析（JSON.parse 自己不认 BOM）', text: '\uFEFF{"a":1}', want: { a: 1 }, counter: 'plain' },
  { id: 'S2-F8', name: '注释兜底（行注释 + 块注释）', text: '{"a":1, // 官方 jsoncpp 允许注释\n "b":2}', want: { a: 1, b: 2 }, counter: 'comments' },
  { id: 'S2-F9', name: '注释里的括号/逗号不影响结构', text: '{"a":1 /* } , ] */ }', want: { a: 1 }, counter: 'comments' },
  { id: 'S2-F10', name: '真坏 JSON **仍然抛**（不糊成 undefined）', text: '{"a":,}', throws: true, counter: 'failed' },
  { id: 'S2-F11', name: '尾逗号隔着块注释（判别性：注释感知的前瞻 / extra）', text: '{"a":1, /* c */ }', want: { a: 1 }, counter: 'comments', extra: true },
]
const COUNTER_KEYS = ['calls', 'plain', 'trailingComma', 'comments', 'failed', 'swallowed']
const snapshot = (api) => { const s = api.stats(); const o = {}; for (const k of COUNTER_KEYS) o[k] = Number(s[k] || 0); return o }
/** 跑一例：返回 { ok, value, delta }（异常文案不参与对拍 —— 各引擎措辞会不同）。 */
const run = (api, text) => {
  const a = snapshot(api)
  let ok = true, value = null
  try { value = api.parse(text) } catch (e) { ok = false }
  const b = snapshot(api)
  const delta = {}; for (const k of COUNTER_KEYS) delta[k] = b[k] - a[k]
  return { ok, value, delta }
}

/* ── S2-F*：期望值（与渲染器测试里写的 want 相同） ── */
for (const f of FIXTURES) {
  const r = run(cBlock.api, f.text)
  const okWant = f.throws ? !r.ok : (r.ok && JSON.stringify(r.value) === JSON.stringify(f.want))
  check(f.id, f.name, okWant, f.throws ? (r.ok ? '居然解析成功' : '按预期抛') : JSON.stringify(r.ok ? r.value : '(抛)').slice(0, 90))
}

/* ── S2-7：计数逐项 +1（每例该涨哪个计数器是语义，不是巧合） ── */
{
  const bad = []
  for (const f of FIXTURES) {
    const r = run(cBlock.api, f.text)
    for (const k of COUNTER_KEYS) {
      const want = k === 'calls' ? 1 : (k === f.counter ? 1 : 0)
      if (r.delta[k] !== want) bad.push({ id: f.id, k, got: r.delta[k], want })
    }
  }
  check('S2-7', '计数逐项对得上（calls 每例 +1；plain/trailingComma/comments/failed 各归各位）',
    bad.length === 0, JSON.stringify(bad.slice(0, 6)))
}

/* ── S2-8：`stats()` 是只读快照 ── */
{
  const a = cBlock.api.stats()
  a.calls = -999
  check('S2-8', '`mpwWeJsonStats()` 返回副本（改它不影响内部计数）', cBlock.api.stats().calls !== -999,
    JSON.stringify({ after: cBlock.api.stats().calls }))
}

/* ── S2-9：吞掉要记账（计数 + 至少一行诊断） ── */
{
  const warns = []
  const origWarn = console.warn, origErr = console.error
  console.warn = (...a) => warns.push(a.map(String).join(' '))
  console.error = (...a) => warns.push(a.map(String).join(' '))
  try {
    const a = cBlock.api.stats()
    const ret = cBlock.api.swallowed('test:probe', new Error('synthetic bad json'))
    const b = cBlock.api.stats()
    const delta = Number(b.swallowed || 0) - Number(a.swallowed || 0)
    check('S2-9', '包内 JSON 解析失败被吞时：`swallowed` +1 且**至少一行诊断**（不再是日志零线索），返回值恒 null',
      delta === 1 && warns.length >= 1 && ret === null,
      JSON.stringify({ delta, lines: warns.slice(0, 1) }))
  } finally { console.warn = origWarn; console.error = origErr }
}

/* ── S2-10：健康文件逐位等价 `JSON.parse`（含确定性 fuzz，不依赖 Math.random） ── */
{
  let seed = 20260924
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const leaf = () => {
    const xs = ['x', 'a,}', 'p,]q', '// 不是注释', '/* 也不是 */', '', '中文', '\uFEFF 头']
    return rnd() < 0.5 ? Math.floor(rnd() * 4096) : xs[Math.floor(rnd() * xs.length)]
  }
  const val = (d) => {
    if (d <= 0) return leaf()
    if (rnd() < 0.5) { const o = {}; const n = 1 + Math.floor(rnd() * 3); for (let i = 0; i < n; i++) o['k' + i] = val(d - 1); return o }
    const a = []; const n = 1 + Math.floor(rnd() * 3); for (let i = 0; i < n; i++) a.push(val(d - 1)); return a
  }
  const bad = []
  for (let i = 0; i < 40; i++) {
    const text = JSON.stringify(val(3))
    const strict = JSON.parse(text)
    const r = run(cBlock.api, text)
    if (!r.ok || JSON.stringify(r.value) !== JSON.stringify(strict) || r.delta.plain !== 1) bad.push({ i, text: text.slice(0, 60), ok: r.ok, delta: r.delta })
  }
  check('S2-10', '健康文件**逐位等价** `JSON.parse`（40 例确定性 fuzz：值相同 + plain 计数 +1，宽容路径一次都不走）',
    bad.length === 0, JSON.stringify(bad.slice(0, 3)))
}

/* ── S2-P1：插件内两处实现（client / pkg-extract）逐夹具读数全等 ── */
{
  const diff = []
  for (const f of FIXTURES) {
    const a = run(cBlock.api, f.text), b = run(pBlock.api, f.text)
    if (a.ok !== b.ok || JSON.stringify(a.value) !== JSON.stringify(b.value) || JSON.stringify(a.delta) !== JSON.stringify(b.delta)) {
      diff.push({ id: f.id, client: { ok: a.ok, d: a.delta }, pkgx: { ok: b.ok, d: b.delta } })
    }
  }
  check('S2-P1', '插件内两处实现（client.js / pkg-extract.js）逐夹具读数全等（解析值 + 计数增量 + 抛/不抛）',
    diff.length === 0, JSON.stringify(diff.slice(0, 3)))
}

/* ── S2-E2E：宿主侧**真路由函数**（不是切片）吃尾逗号 scene.json 也照样出结果 ── */
{
  try {
    const { scanSceneAudio } = await import('file://' + PKGX)
    /* 官方风格的 scene.json：**带尾逗号 + 注释**（jsoncpp 允许；标准 JSON.parse 不认）。 */
    const sceneText = '{\n  "version": 1,\n  "objects": [\n    { "name": "bg", "image": "textures/a.tex", },\n    { "name": "bgm", "sound": ["sounds/a.mp3"], }, // 官方 jsoncpp 允许注释\n  ],\n}'
    let strictOk = true
    try { JSON.parse(sceneText) } catch (e) { strictOk = false }
    const buildPkg = (entries) => {
      const magic = 'PKGV0022', parts = [], table = []
      let off = 0
      for (const e of entries) { const b = Buffer.from(e.data); table.push({ name: e.name, offset: off, size: b.length }); parts.push(b); off += b.length }
      const names = table.map((t) => { const n = Buffer.from(t.name, 'utf8'); const h = Buffer.alloc(4); h.writeUInt32LE(n.length, 0); return Buffer.concat([h, n]) })
      const head = Buffer.alloc(4 + magic.length + 4)
      head.writeUInt32LE(magic.length, 0); Buffer.from(magic).copy(head, 4); head.writeUInt32LE(table.length, 4 + magic.length)
      const idx = table.map((t, i) => { const b = Buffer.alloc(8); b.writeUInt32LE(t.offset, 0); b.writeUInt32LE(t.size, 4); return Buffer.concat([names[i], b]) })
      return Buffer.concat([head, ...idx, ...parts])
    }
    const dir = path.join(TMP, 'e2e')
    fs.mkdirSync(dir, { recursive: true })
    const pkgPath = path.join(dir, 'scene.pkg')
    fs.writeFileSync(pkgPath, buildPkg([
      { name: 'scene.json', data: Buffer.from(sceneText, 'utf8') },
      { name: 'sounds/a.mp3', data: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(60, 0)]) },
    ]))
    const aud = scanSceneAudio(pkgPath, { cache: false })
    const track = aud.tracks.find((t) => t.path === 'sounds/a.mp3')
    check('S2-E2E', '宿主侧真函数 `scanSceneAudio` 吃"尾逗号 + 注释"的 scene.json：严格 `JSON.parse` 抛，但 sound 层引用（refs）照样推得出来',
      strictOk === false && !!track && Array.isArray(track.refs) && track.refs.indexOf('bgm') >= 0,
      JSON.stringify({ strictOk, tracks: aud.tracks }))
  } catch (e) {
    check('S2-E2E', '宿主侧真函数端到端（尾逗号 scene.json）', false, String((e && e.message) || e))
  }
}

/* ── S2-OFF：官方真样本（本机装了 WE 才跑；没装就 SKIP —— 不假绿） ── */
{
  const WE = process.env.MPW_WE_ASSETS || path.join(REPO, '..', 'wallpaper_engine', 'assets')
  const OFFICIAL = path.join(WE, 'effects', 'fluidsimulation', 'effect.json')
  if (fs.existsSync(OFFICIAL)) {
    const raw = fs.readFileSync(OFFICIAL, 'utf8')
    let strictOk = true
    try { JSON.parse(raw) } catch (e) { strictOk = false }
    const r = run(cBlock.api, raw)
    const okShape = r.ok && r.value && Array.isArray(r.value.passes) && r.value.passes.length === 20 &&
      Array.isArray(r.value.fbos) && r.value.fbos.length === 9
    check('S2-OFF', '官方 `effects/fluidsimulation/effect.json`（' + Buffer.byteLength(raw) + ' B）：严格 `JSON.parse` **失败**、宽容解析**成功**且形状对（20 pass / 9 FBO）',
      strictOk === false && okShape && r.delta.trailingComma === 1,
      JSON.stringify({ strictOk, ok: r.ok, passes: r.ok && r.value ? r.value.passes.length : null, fbos: r.ok && r.value ? r.value.fbos.length : null, delta: r.delta }))
  } else {
    console.log('  · S2-OFF SKIP —— 本机没有官方 WE 目录（' + OFFICIAL + '）')
  }
}

/* ── S2-SRC + S2-P2：与渲染器**同一套夹具 / 同一组读数**（两仓同口径的唯一证据） ── */
let rendererAvailable = false
{
  if (fs.existsSync(RENDERER_TEST)) {
    const rsrc = fs.readFileSync(RENDERER_TEST, 'utf8')
    const miss = FIXTURES.filter((f) => !f.extra).filter((f) => {
      const forms = [f.text, f.text.replace(/\uFEFF/g, '\\uFEFF'), f.text.replace(/"/g, '\\"'), f.text.replace(/\n/g, '\\n')]
      return !forms.some((x) => rsrc.includes(x))
    }).map((f) => f.id)
    check('S2-SRC', '夹具是**从渲染器 tests/we-json-tolerance-test.mjs 逐条抄来的**（原文命中；extra 夹具不参与）',
      miss.length === 0, JSON.stringify({ 未命中: miss }))
  } else {
    console.log('  · S2-SRC SKIP —— 兄弟仓的测试文件不在（' + RENDERER_TEST + '）')
  }
  if (fs.existsSync(RENDERER_BUNDLE)) {
    try {
      const R = await import('file://' + RENDERER_BUNDLE)
      const rApi = { parse: R.parseWeJson, stats: R.weJsonStats }
      rendererAvailable = typeof rApi.parse === 'function' && typeof rApi.stats === 'function'
      const diff = []
      const shared = (d) => ({ calls: d.calls, plain: d.plain, trailingComma: d.trailingComma, comments: d.comments, failed: d.failed })
      for (const f of FIXTURES) {
        const a = run(cBlock.api, f.text), b = run(rApi, f.text)
        if (a.ok !== b.ok || JSON.stringify(a.value) !== JSON.stringify(b.value) || JSON.stringify(shared(a.delta)) !== JSON.stringify(shared(b.delta))) {
          diff.push({ id: f.id, plugin: { ok: a.ok, d: shared(a.delta) }, renderer: { ok: b.ok, d: shared(b.delta) } })
        }
      }
      check('S2-P2', '**两仓同口径**：同一组夹具下，插件实现与渲染器 `parseWeJson` 的读数逐条相同（值 + 五个共享计数 + 抛/不抛）',
        diff.length === 0, JSON.stringify(diff.slice(0, 3)))
    } catch (e) {
      check('S2-P2', '渲染器 `parseWeJson` 可导入并逐条对拍', false, String((e && e.message) || e))
    }
  } else {
    console.log('  · S2-P2 SKIP —— 兄弟仓的 core/we-scene-bundle.js 不在（' + RENDERER_BUNDLE + '）')
  }
}

/* ═══════════════════════ S3：变异自证（隔离副本；真树不动） ═══════════════════════ */

/** 用平衡花括号把函数体整段换掉（不靠缩进/正则）。 */
function replaceFunctionBody(src, name, newBody) {
  const sig = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{')
  const m = sig.exec(src)
  if (!m) return null
  const open = m.index + m[0].length - 1
  let depth = 0, end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break } }
  }
  if (end < 0) return null
  return src.slice(0, open + 1) + newBody + src.slice(end)
}

const fn = fileURLToPath(import.meta.url)
const FILE_SHA = { client: sha(CLIENT), pkgx: sha(PKGX) }

if (!NO_MUT) {
  console.log('\n== 变异自证（隔离副本；真树一个字节都不动）==')
  /* 变异体在**临时副本**里跑：副本没有兄弟仓 ⇒ S2-SRC/S2-P2 诚实跳过 ⇒ 期望红集里不含它们。 */
  const mutants = [
    {
      id: 'M1',
      name: '把 `mpwParseWeJson` 退回严格 `JSON.parse`（= 修之前的行为；只摘掉宽容兜底，计数口径不变）',
      target: 'client',
      build: (src) => replaceFunctionBody(src, 'mpwParseWeJson',
        ' MPW_WEJSON.calls++; try { const v = JSON.parse(text); MPW_WEJSON.plain++; return v } catch (e) { MPW_WEJSON.failed++; throw e } '),
      want: () => ['S2-F1', 'S2-F2', 'S2-F3', 'S2-F4', 'S2-F7', 'S2-F8', 'S2-F9', 'S2-F11', 'S2-7', 'S2-P1'],
    },
    {
      id: 'M2',
      name: '把 `extractProjectInfo` 的调用点换回严格 `JSON.parse`',
      target: 'client',
      build: (src) => src.replace('mpwParseWeJson(jsonText)', 'JSON.parse(jsonText)'),
      want: () => ['S1-2b', 'S1-3', 'S1-5'],
    },
    {
      id: 'M3',
      name: '把 `extractProjectInfo` 吞点里的 `mpwWeJsonSwallowed` 拿掉（回到静默）',
      target: 'client',
      build: (src) => src.replace('return mpwWeJsonSwallowed("extractProjectInfo:project.json", e);', 'return null;'),
      want: () => ['S1-5'],
    },
  ]
  for (const mu of mutants) {
    const root = path.join(TMP, mu.id.toLowerCase(), 'repo')
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
    const orig = mu.target === 'client' ? clientSrc : pkgxSrc
    const mutated = mu.build(orig)
    if (typeof mutated !== 'string' || mutated === orig) {
      check('S3-' + mu.id, '变异（' + mu.name + '）—— 变异锚点命中（可替换）', false, '锚点没命中（变异体构造失败）')
      continue
    }
    fs.writeFileSync(path.join(root, 'lib', 'client.js'), mu.target === 'client' ? mutated : clientSrc)
    fs.writeFileSync(path.join(root, 'lib', 'pkg-extract.js'), mu.target === 'client' ? pkgxSrc : mutated)
    const r = spawnSync(process.execPath, [fn, '--no-mutations', '--repo', root], { encoding: 'utf8' })
    const reds = (r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(S\d[^\s]*)/.exec(l) || [])[1]).filter(Boolean)
    const want = mu.want()
    const same = reds.length === want.length && want.every((x) => reds.includes(x))
    check('S3-' + mu.id, '变异（' + mu.name + '）⇒ **期望红集 == 实际红集**',
      same, 'exit=' + r.status + ' 期望=' + JSON.stringify(want) + ' 实际=' + JSON.stringify(reds.slice(0, 14)))
    if (same) console.log('    MUTANT-RED-OK ' + mu.id + ' 红集=' + JSON.stringify(reds))
  }
  check('S3-M4', '真树 lib/client.js + lib/pkg-extract.js 未被变异触碰（sha256 逐字节相同）',
    FILE_SHA.client === sha(CLIENT) && FILE_SHA.pkgx === sha(PKGX))
  console.log('  · 两仓对拍（S2-SRC/S2-P2）：渲染器仓' + (rendererAvailable ? '**在场**，已逐条对拍' : '不在场，本轮跳过（不假绿）'))
}

console.log('\n===== we-json-tolerance: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

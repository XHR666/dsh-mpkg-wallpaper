#!/usr/bin/env node
// diag-flag-check.mjs — 诊断开关抓取 + 文档双向比对（ZCODE-MERGED-3 第 2 项 2.2 / 1.3 数据源）
//
// 做什么：
//   1. 从真实代码抓"诊断/控制开关"（URL query 参数），来源五类（--source 可单独跑）：
//        core/we-scene-bundle.js / demo.html / demo/bench-patch.js / elysia/**/*.js / dsh-mpkg-wallpaper/lib/client.js
//      ①(2026-09-24 任务 B) 新增 `demo/bench-patch.js` 一个抓取源：测试台（bench）页的开关
//        （propimg/online/sample/shell/… 见 `demo/bench-patch.js`）此前只能登记在 docs 的"补丁层开关"附录里，
//        进不了主表 ⇒ 主表与代码不同步。抓取**规则**未动（仍是下面 a/b/c/d 四条），只多喂一个文件。
//      判定"开关存在"的口径（代码里真实解析，注释/字符串链接不算）：
//        a) URLSearchParams（绑定 location.* 的标识符或链式调用）上的 .get/.has/.getAll
//        b) new URL(location.*).searchParams 上的 .get/.has/.getAll
//        c) 正则字面量 /[\?&]name=.../（bundle 的 mcc/pp/whitefallback 写法）
//        d) localStorage 诊断键（仅 PLUGIN_LS_FLAGS 白名单，当前= mpwdiag，见下）
//   2. 与 README-DIAGNOSTICS.md 主表逐名双向比对：
//        代码有·文档无 → 漏写；文档有·代码无 → 陈旧。有差异退出码 1。
//   3. 产出 diag-flags.json（面板速查区数据源；面板内置副本由 tools/panel-smoke.mjs 断言一致）。
//
// 用法：
//   node diag-flag-check.mjs                # 抓取 + 比对 + 写 diag-flags.json
//   node diag-flag-check.mjs --fix-hint     # 差异时额外打印建议增删的表格行
//   node diag-flag-check.mjs --list         # 只打印抓取结果（人工核对默认值用）
//
// 注意：本脚本只读代码 + 写 diag-flags.json，不改任何源码。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(here)
const README = path.join(path.resolve(here, '..'), 'docs', 'README-DIAGNOSTICS.md')   // ①(2026-09-16) 说明 md 已收进 docs/（本脚本在 tests/）
// ①(P-101 2026-09-16 目录再整理) 产物落 **web/**：server/we-scene-demo-server.mjs 的 /diag-flags.json
//   路由从 `web/diag-flags.json` 读（URL 仍是 `/diag-flags.json`）；它是面板在线数据源，随站点外壳发布。
const JSON_OUT = path.join(path.resolve(here, '..'), 'web', 'diag-flags.json')
// ①(2026-09-16 目录整理) 插件是**兄弟目录**（`<父>/dsh-mpkg-wallpaper`），不是本仓库的子目录：
//   收拢前这里写 `path.join(ROOT,'dsh-mpkg-wallpaper',...)` —— 那要 BC 其实是**永不命中**的陈旧写法
//   （实测：本机路径是 `<工作区>/dsh-mpkg-wallpaper/lib/client.js`）⇒ 白丢 8 个插件侧开关。
//   现按仓库既有惯例（run-all-tests.sh / start-demo.sh 的 MPW_ROOT 口径）解析到真实落点。
const MPW_ROOT_DIR = process.env.MPW_ROOT || path.resolve(ROOT, '..')
// ①(2026-10-30 路径固化) 渲染器并入插件工作区后，插件树在 `ROOT/../plugin`（本目录的兄弟目录，改名自
//   `dsh-mpkg-wallpaper`）；env `MPW_PLUGIN_DIR` 可显式覆盖；旧兄弟仓名保留为回退（原检出仍可跑）。
const CLIENT = [process.env.MPW_PLUGIN_DIR && path.join(process.env.MPW_PLUGIN_DIR, 'lib', 'client.js'),
  path.join(ROOT, '..', 'plugin', 'lib', 'client.js'),
  path.join(MPW_ROOT_DIR, 'dsh-mpkg-wallpaper', 'lib', 'client.js')]
  .filter(Boolean).find((p) => { try { return fs.existsSync(p) } catch { return false } })
  || path.join(ROOT, '..', 'plugin', 'lib', 'client.js')

// localStorage 诊断开关白名单（client.js 侧非 URL 参数的开关；新增时在此登记 + README ⑤ 补行）
const PLUGIN_LS_FLAGS = ['mpwdiag']

/* ①(2026-09-19) **路由/URL 参数名不算诊断开关** —— 插件侧 client.js 里大量出现
   `host:?custom=1&folder=<dir>&file=<f>`、`/raw?ltoken=…`、`/media?token=…` 这类**路由查询参数**
   （以及注释里的同形示例文本），会被 c) 正则字面量规则 `[?&]name=` 误当成诊断开关抓出来
   （实测：custom/folder/ltoken/token 四个 ⇒ 门禁报"代码有·文档无"）。
   这里显式列出这些**参数名**并跳过；真正的诊断开关仍会被抓（它们不在这个名单里）。
   维护口径：只往这里加"确实是路由参数"的名字；能当开关用的名字**不许**加进来。 */
const ROUTE_PARAM_NAMES = ['custom', 'folder', 'ltoken', 'token', 'file', 'index', 'offset', 'refs', 'w', 'h', 'src', 'type', 'fit', 'custommpkg', 'web', 'scene', 'shim', 'embed', 'thumbpost', 'pkgurl', 'item', 'dir', 'path', 'name']

// 面板速查区"常用开关"（MERGED-3 1.3/2.3 精简版 8–10 个；面板 i18n 键 diagflag.<name> 与此对应）
const COMMON_FLAGS = ['att', 'mcc', 'piv', 'align', 'parallax', 'gyro', 'audio', 'whitefallback', 'hier', 'isolate', 'audit']
// 常用开关的"一键复制 URL 片段"（canonical 用法；面板速查区直接展示/复制）
const COMMON_USAGE = {
  att: 'att=legacy', mcc: 'mcc=1', piv: 'piv=1', align: 'align=0', parallax: 'parallax=legacy', gyro: 'gyro=1',
  audio: 'audio=1', whitefallback: 'whitefallback=0', hier: 'hier=0', isolate: 'isolate=<层名>', audit: 'audit=3',
}

// ---------------- 抓取 ----------------

/** 从一段源码抓开关名。返回 Map<name, [{line, pattern}]> */
function extractFlags(label, src) {
  const found = new Map()
  const lines = src.split('\n')
  const add = (name, line, pattern) => {
    if (!name || !/^[a-z][a-z0-9_]{0,31}$/.test(name)) return
    if (!found.has(name)) found.set(name, [])
    const rec = { file: label, line, pattern }
    const arr = found.get(name)
    if (!arr.some((r) => r.line === line && r.pattern === pattern)) arr.push(rec)
  }
  // 收集"绑定到 location.* 的 URLSearchParams / URL"标识符（非 location 的 URLSearchParams
  // 如 client.js 解析 host: 标记的 p.get('ltoken') 不是诊断开关，必须排除）
  const spIds = new Set()
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    let m
    const reBind = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+URLSearchParams\s*\(([^;]*)\)/g
    while ((m = reBind.exec(ln))) if (/location\./.test(m[2] || '')) spIds.add(m[1])
    const reUrl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+URL\s*\(([^;]*)\)/g
    while ((m = reUrl.exec(ln))) if (/location\./.test(m[2] || '')) spIds.add(m[1] + '.searchParams')
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    // a) 标识符上的 get/has/getAll
    for (const id of spIds) {
      const re = new RegExp('\\b' + id.replace('.', '\\.') + '\\s*\\.\\s*(get|has|getAll)\\s*\\(\\s*[\'"]([a-zA-Z][\\w-]*)[\'"]', 'g')
      let m
      while ((m = re.exec(ln))) add(m[2], i + 1, 'searchParams.' + m[1] + "('" + m[2] + "')")
    }
    // b) 链式：new URLSearchParams(location.*).get('x') / new URL(location.*).searchParams.get('x')
    let m
    const reChain = /new\s+URL(?:SearchParams)?\s*\([^;]*?location\.[^;]*?\)\s*(?:\.searchParams)?\s*\.\s*(get|has|getAll)\s*\(\s*['"]([a-zA-Z][\w-]*)['"]/g
    while ((m = reChain.exec(ln))) add(m[2], i + 1, 'searchParams.' + m[1] + "('" + m[2] + "')")
    // c) 正则字面量 /[\?&]name=…/（源码文本里就是 "[?&]name=" 这串字符）
    const reRe = /\[\?&\]([a-zA-Z][\w-]*)(?:=|[^\w-])/g
    while ((m = reRe.exec(ln))) {
      // ①(2026-09-19) 这条规则会从**注释/示例文本**里抓出 `?folder=` 这类**路由参数**（插件侧尤其多）⇒
      //   只跳过 ROUTE_PARAM_NAMES 名单里的名字；真正从 location.search 读的开关走 a)/b) 两条规则，不受影响。
      if (ROUTE_PARAM_NAMES.indexOf(m[1]) >= 0) continue
      add(m[1], i + 1, 'regex [?&]' + m[1] + '=')
    }
    // d) localStorage 诊断键（白名单内才算）
    const reLs = /localStorage\.(?:get|set|remove)Item\s*\(\s*['"]([\w.-]+)['"]/g
    while ((m = reLs.exec(ln))) if (PLUGIN_LS_FLAGS.includes(m[1])) add(m[1], i + 1, "localStorage('" + m[1] + "')")
  }
  return found
}

function collect() {
  const merged = new Map() // name -> [{file,line,pattern}]
  const sources = []
  const absorb = (label, src) => {
    sources.push(label)
    for (const [name, sites] of extractFlags(label, src)) {
      if (!merged.has(name)) merged.set(name, [])
      merged.get(name).push(...sites)
    }
  }
  absorb('core/we-scene-bundle.js', fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8'))   // ①(P-101) 内核在 core/
  absorb('demo.html', fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8'))
  // ①(2026-09-24 任务 B) 测试台补丁层：`demo/bench-patch.js`（bench 页在 demo.html 之后注入的开关都在这）。
  //   为什么必须收：这些开关**真实解析 URL**（`new URLSearchParams(location.search)`），是用户可用的诊断开关，
  //   但它们不在 demo.html 里 ⇒ 以前主表只能靠人工"补丁层开关"附录记，双向比对看不见 ⇒ 漂移。
  absorb('demo/bench-patch.js', fs.readFileSync(path.join(ROOT, 'demo', 'bench-patch.js'), 'utf8'))
  const elysiaDir = path.join(ROOT, 'elysia')
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) walk(fp)
      else if (e.name.endsWith('.js')) absorb('elysia/' + path.relative(elysiaDir, fp).replace(/\\/g, '/'), fs.readFileSync(fp, 'utf8'))
    }
  }
  if (fs.existsSync(elysiaDir)) walk(elysiaDir)
  if (fs.existsSync(CLIENT)) absorb('dsh-mpkg-wallpaper/lib/client.js', fs.readFileSync(CLIENT, 'utf8'))
  return { merged, sources }
}

// ---------------- README 主表解析 ----------------

// 主表定界（README 里用 HTML 注释标出校验范围，历史附录等区不参与比对）
const TBL_BEGIN = '<!-- FLAG-TABLE-BEGIN -->'
const TBL_END = '<!-- FLAG-TABLE-END -->'

function parseReadmeFlags() {
  if (!fs.existsSync(README)) return { names: new Map(), text: '' }
  const text = fs.readFileSync(README, 'utf8')
  const i = text.indexOf(TBL_BEGIN)
  const j = text.indexOf(TBL_END)
  const seg = i >= 0 && j > i ? text.slice(i + TBL_BEGIN.length, j) : ''
  const names = new Map() // name -> 组名
  let group = ''
  for (const raw of seg.split('\n')) {
    const ln = raw.trim()
    const gm = /^#{2,4}\s*(.+)$/.exec(ln)
    if (gm) { group = gm[1].trim(); continue }
    if (!ln.startsWith('|')) continue
    const cell = ln.split('|').map((s) => s.trim())
    const name = (cell[1] || '').replace(/^`|`$/g, '')
    if (!name || name === '开关' || /^[-:]+$/.test(name)) continue
    if (/^[a-z][\w-]{0,31}$/.test(name)) names.set(name, group)
  }
  return { names, text }
}

// ---------------- 主流程 ----------------

const argv = process.argv.slice(2)
const listOnly = argv.includes('--list')
const fixHint = argv.includes('--fix-hint')

const { merged, sources } = collect()
const codeNames = [...merged.keys()].sort()
const { names: readmeNames } = parseReadmeFlags()
const docNames = [...readmeNames.keys()].sort()

if (listOnly) {
  console.log('代码里抓到的开关（' + codeNames.length + ' 个，来自 ' + sources.join(' / ') + '）：')
  for (const n of codeNames) {
    const sites = merged.get(n).map((s) => s.file + ':' + s.line + ' ' + s.pattern).join('；')
    console.log('  ' + n.padEnd(16) + sites)
  }
  process.exit(0)
}

const missingInDoc = codeNames.filter((n) => !readmeNames.has(n))
const staleInDoc = docNames.filter((n) => !merged.has(n))

// 产出 diag-flags.json（面板数据源；common 标记速查区精简版集合）
const payload = {
  generatedAt: new Date().toISOString(),
  generator: 'node diag-flag-check.mjs（脚本自动生成，勿手改）',
  codeBasis: sources,
  rule: 'URLSearchParams(new URLSearchParams/new URL + location.*) 的 get/has/getAll、正则 [?&]name=、白名单 localStorage 键',
  common: COMMON_FLAGS.filter((n) => merged.has(n)).map((n) => ({ name: n, usage: COMMON_USAGE[n] || (n + '=1') })),
  flags: codeNames.map((n) => ({ name: n, common: COMMON_FLAGS.includes(n), sites: merged.get(n) })),
}
// ①(2026-09-18) **幂等写出**：只把 `generatedAt` 当"内容变了才更新的时间戳"，内容（除它以外）逐字相同时
//   **不重写文件**。为什么：以前每跑一次门禁（`run-all-tests.sh` 含本项）都会把这份生成物重写一遍 ⇒
//   跑完门禁工作树**必然**多出 ` M web/diag-flags.json`（只差一个时间戳），"跑完就脏"会污染每个人的
//   `git status`、也让"提交前后逐字一致"这类证明没法做（本仓库已两次把它的重生成单独提交过）。
//   判据：同一次内容连跑两次，第二次 mtime/字节都不变。
{
  const next = JSON.stringify(payload, null, 2) + '\n'
  let prev = null
  try { prev = fs.readFileSync(JSON_OUT, 'utf8') } catch { /* 首次生成 */ }
  const strip = (t) => (t || '').replace(/"generatedAt": "[^"]*",\n/, '')
  if (prev !== null && strip(prev) === strip(next)) {
    // 内容没变 ⇒ 保持旧时间戳、不落盘（避免"跑一次门禁就脏一个文件"）
  } else {
    fs.writeFileSync(JSON_OUT, next)
    globalThis.__diagFlagsWrote = true
  }
}

let fail = 0
if (missingInDoc.length) {
  fail++
  console.error('✗ 代码有·文档无（漏写 ' + missingInDoc.length + ' 个）: ' + missingInDoc.join(', '))
  if (fixHint) for (const n of missingInDoc) {
    const site = merged.get(n)[0]
    console.error('    + | `' + n + '` | | | | | ' + site.file + ':' + site.line + ' |')
  }
}
if (staleInDoc.length) {
  fail++
  console.error('✗ 文档有·代码无（陈旧 ' + staleInDoc.length + ' 个）: ' + staleInDoc.join(', '))
  if (fixHint) for (const n of staleInDoc) console.error('    - 移除或移入"历史开关"附录（主表外）: ' + n)
}
if (!fail) {
  console.log('✓ diag-flag-check：代码 ' + codeNames.length + ' 个开关 == README 主表 ' + docNames.length + ' 行，0 差异')
  console.log('  diag-flags.json ' + (globalThis.__diagFlagsWrote ? '已写出' : '未变（保持旧时间戳，不落盘）') + '（common=' + payload.common.length + ' 个常用）')
} else {
  console.error('  diag-flags.json 仍已写出（当前抓取结果），但文档比对有差异 → 退出码 1')
}
process.exit(fail ? 1 : 0)

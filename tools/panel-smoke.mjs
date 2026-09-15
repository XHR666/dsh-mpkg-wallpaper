// tools/panel-smoke.mjs — 插件设置面板冒烟测试（无需浏览器）
// 目的：在 Node 里用桩 React 直接调用插件注册的 settings.section 组件，
//       一旦面板渲染抛错（例如 h/t 未定义、字段类型错误）立刻失败——
//       这类 bug 之前只能靠用户反复刷新才能发现。
// 用法: node tools/panel-smoke.mjs [--section <json文件>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// 支持 --client <path> 指定被测文件（用于验证测试本身能抓到历史 bug）
const argClient = process.argv.indexOf('--client')
const clientPath = argClient > 0 ? process.argv[argClient + 1] : path.join(here, '..', 'lib', 'client.js')
const src = fs.readFileSync(clientPath, 'utf8')

let fail = 0

/* ---------- 桩 React ---------- */
const mkEl = (type, props, ...kids) => ({ __el: true, type, props: props || {}, kids: kids.flat(9) })
const hookState = []
const react = {
  createElement: mkEl,
  Fragment: Symbol('Fragment'),
  memo: (f) => f,
  useState: (init) => {
    const i = hookState.length
    if (hookState[i] === undefined) hookState[i] = typeof init === 'function' ? init() : init
    return [hookState[i], (v) => { hookState[i] = typeof v === 'function' ? v(hookState[i]) : v }]
  },
  useEffect: () => {},
  useMemo: (f) => f(),
  useRef: (v) => ({ current: v === undefined ? null : v }),
  useCallback: (f) => f,
  Component: class { constructor(p) { this.props = p } setState() {} },
}
const ReactDOM = { createPortal: (node) => node, render: () => {}, unmountComponentAtNode: () => {} }

/* ---------- 桩浏览器环境 ---------- */
const listeners = {}
const el = (tag = 'div') => ({
  tagName: String(tag).toUpperCase(), style: {}, className: '', id: '', textContent: '', innerHTML: '',
  children: [], childNodes: [], parentElement: null, dataset: {}, nodeType: 1,
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  setAttribute() {}, getAttribute: () => null, removeAttribute() {}, hasAttribute: () => false,
  appendChild(c) { this.children.push(c); c.parentElement = this; return c },
  insertBefore(c) { return this.appendChild(c) },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c },
  remove() { if (this.parentElement) this.parentElement.removeChild(this) },
  addEventListener(k, f) { (listeners[k] = listeners[k] || []).push(f) },
  removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 }),
  getContext: () => null, focus() {}, click() {}, contains: () => false, matches: () => false,
})
const docEl = el('html')
const doc = {
  documentElement: docEl, body: el('body'), head: el('head'), title: 'test',
  createElement: (t) => el(t), createElementNS: (ns, t) => el(t), createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
  createDocumentFragment: () => el('fragment'),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  fonts: { add() {}, ready: Promise.resolve() }, readyState: 'complete',
}
globalThis.document = doc
globalThis.window = globalThis
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
globalThis.dispatchEvent = () => true
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', position: 'static', display: 'block', visibility: 'visible', opacity: '1', zIndex: 'auto', backdropFilter: 'none', overflow: 'visible', contain: 'none', isolation: 'auto', willChange: 'auto', color: '', fontSize: '', height: '', overflowY: '' })
globalThis.location = { href: 'http://127.0.0.1:3080/', search: '', hash: '', origin: 'http://127.0.0.1:3080' }
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-smoke', language: 'zh-CN' }, configurable: true }) } catch {}
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null },
  setItem(k, v) { this._m.set(k, String(v)) },
  removeItem(k) { this._m.delete(k) },
}
globalThis.CSS = { supports: () => true }
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0)
globalThis.cancelAnimationFrame = () => {}
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
try { if (!globalThis.performance) Object.defineProperty(globalThis, 'performance', { value: { now: () => Date.now() }, configurable: true }) } catch {}
globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; this.complete = false } set src(v) { this._s = v } get src() { return this._s } }
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}
const fetchCalls = []
const diagEvents = []
globalThis.fetch = async (url, opts) => {
  fetchCalls.push(String(url))
  try { if (String(url).indexOf('/diag') >= 0 && opts && opts.body) diagEvents.push(JSON.parse(opts.body)) } catch {}
  return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
}

/* ---------- 载入插件并取到注册的 section 组件 ---------- */
const registry = []
globalThis.__ModuleLoader__ = { load: (reg) => registry.push(reg) }
const stubRequire = (name) => {
  if (name === 'react') return react
  if (name === 'react-dom') return ReactDOM
  if (name === 'react-dom/client') return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
  return {}
}
// ① 执行插件脚本：它会把 factory 注册进 __ModuleLoader__
new Function('require', 'module', 'exports', src)(stubRequire, { exports: {} }, {})
if (!registry.length) { console.error('✗ 插件未向 __ModuleLoader__ 注册'); process.exit(1) }
// ② 调用 factory 取 plugin exports（真实宿主也是这么做的）
let plugin = null
for (const reg of registry) {
  try {
    const out = reg.factory(stubRequire)
    if (out && typeof out.apply === 'function') { plugin = out; break }
    if (out && out.default && typeof out.default.apply === 'function') { plugin = out.default; break }
  } catch (e) { console.error('factory 调用失败:', e && e.message) }
}
if (!plugin) plugin = globalThis.__mpwClientLoaded
if (!plugin || typeof plugin.apply !== 'function') { console.error('✗ 未取到插件 apply()'); process.exit(1) }

let sectionComp = null
const ctx = {
  slots: {
    inject: (name, fn) => { try { fn() } catch (e) { console.error('inject 失败:', e.message) } },
    register: (opts, comp) => { if (opts && opts.name === 'settings.section') sectionComp = comp; return { dispose() {} } },
  },
  locale: { bind: () => (k) => k, register: () => ({ dispose() {} }) },
  effect: (f) => { try { f() } catch {} },
  logger: { info() {}, warn() {}, error() {} },
}
// ①(2026-09-13) 捕获 apply 期间的 console.error：buildCss 抛错时只 console.error 不抛出，
//   但样式表会保持为空 → 用户看到"整个画面错乱"。这里把它升级为测试失败。
const applyErrors = []
{ const origErr = console.error; console.error = (...a) => { applyErrors.push(a.map((x) => (x && x.message) || String(x)).join(' ')); origErr.apply(console, a) } 
  try { plugin.apply(ctx) } finally { console.error = origErr } }
if (applyErrors.length) { fail++; console.error('✗ apply 期间出现错误: ' + applyErrors.slice(0, 3).join(' | ')) }
if (!sectionComp) { console.error('✗ 未注册 settings.section 组件'); process.exit(1) }

/* ---------- 用真实设置数据渲染 ---------- */
const argFile = process.argv.indexOf('--section')
let section = {}
const defaultFile = '/root/.dsh-mpkg-wallpaper/settings.json'
const file = argFile > 0 ? process.argv[argFile + 1] : defaultFile
try { if (fs.existsSync(file)) section = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn('设置读取失败:', e.message) }
globalThis.localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(section))

const cases = [
  { name: '空设置', data: {} },
  { name: '仅 enabled', data: { enabled: true } },
  { name: '真实设置（宿主副本）', data: section },
  { name: '有壁纸 + 布尔型脏字段', data: Object.assign({}, section, { image: true, fromMpkg: true, source: 'bgcs_abydos03.mp4' }) },
  { name: 'mpkg 状态 + 自定义目录', data: Object.assign({}, section, { mpkgKey: 'custommpkg|x.mpkg', mpkgName: 'x.mpkg', customDirPath: '/tmp' }) },
]
/* ---------- 静态断言 -1（2026-09-13）：CSS 模板字符串的注释里不得出现反引号 ----------
   背景：连续两次把反引号写进模板字符串内的 CSS 注释 → 模板被提前终止 → buildCss 抛
   ReferenceError → 样式表保持为空 → 用户看到"整个画面错乱"。这类错误语法检查不报（模板本身合法），
   必须在静态层面拦。做法：找出所有 `css += \` ... \`` 片段，检查其内部是否还有反引号。 */
try {
  const offenders = []
  const re = /css\s*\+=\s*`/g
  let m
  while ((m = re.exec(src))) {
    // 从起始反引号开始找结束反引号（跳过 \` 转义）
    let i = m.index + m[0].length, end = -1
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue }
      if (src[i] === '`') { end = i; break }
      i++
    }
    if (end < 0) { offenders.push('未闭合的模板字符串 @' + m.index); continue }
  }
  if (offenders.length) { fail++; console.error('✗ 静态检查: ' + offenders.join(', ')) }
  else console.log('✓ 静态检查: CSS 模板字符串闭合正常（注释内无反引号）')
} catch (e) { console.error('静态检查-1异常:', e.message) }

/* ---------- 静态断言 0（2026-09-13 新增）：生成 CSS 的**结构与关键锚点**必须成立 ----------
   背景：用户实测刷新后"整个画面错乱（壁纸跑到 UI 下面）"，根因是插件样式表整体缺失/被
   CSS 解析错误吞掉 → .mpw-bgWrap 失去 position:fixed 掉进普通流。这里在 Node 里把 apply()
   生成的 CSS 收集起来做结构与锚点校验，这类问题以后刷新前就能拦下。 */
try {
  const styles = []
  const walk = (node) => {
    if (!node || !node.children) return
    for (const c of node.children) {
      if (c.tagName === 'STYLE' && typeof c.textContent === 'string') styles.push(c.textContent)
      walk(c)
    }
  }
  walk(doc.head); walk(doc.body); walk(doc.documentElement)
  // ①(2026-09-13) 优先用插件暴露的 __mpwBuildCss 直接构建 CSS（桩环境里 apply 的样式注入
  //   路径不可达 → 只靠收集 <style> 会误报）。对多组关键设置各构建一次并校验结构与锚点。
  const combos = [
    ['真实设置（含壁纸）', { image: true }],
    ['侧边栏不透出', { image: true, sidebar: false }],
    ['统一虚化开', { image: true, unifyTint: true }],
    ['统一虚化关', { image: true, unifyTint: false }],
    ['悬浮开', { image: true, float: true }],
    ['液态玻璃 CSS 开', { image: true, lgCss: true }],
    ['全部关', { image: true, sidebar: false, headerBg: false, unifyTint: false, float: false, lgCss: false }],
  ]
  const built = []
  if (typeof globalThis.__mpwBuildCss === 'function') {
    for (const [label, patch] of combos) built.push([label, String(globalThis.__mpwBuildCss(patch) || '')])
  }
  const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''")
  const css = built.length ? built.map(([l, c]) => '/* == ' + l + ' == */\n' + c).join('\n') : styles.join('\n')
  const dumpIdx = process.argv.indexOf('--css')
  if (dumpIdx > 0 && process.argv[dumpIdx + 1]) { fs.writeFileSync(process.argv[dumpIdx + 1], css); console.log('（已导出 CSS → ' + process.argv[dumpIdx + 1] + '，' + css.length + ' 字节）') }
  const problems = []
  if (!css.trim()) problems.push('CSS 为空（样式表未注入）')
  const cssT = strip(css)
  let depth = 0, bad = -1
  for (let i = 0; i < cssT.length; i++) {
    if (cssT[i] === '{') depth++
    else if (cssT[i] === '}') { depth--; if (depth < 0 && bad < 0) bad = i }
  }
  if (bad >= 0) problems.push('CSS 出现多余 }（会丢弃后续规则）@' + bad)
  else if (depth !== 0) problems.push('CSS 花括号不配平 depth=' + depth + '（未闭合的 @supports/规则会把后面所有规则吞进条件块或嵌套块 → 大面积规则失效）')
  const leftover = cssT.match(/\$\{[^}]{0,40}/)
  if (leftover) problems.push('模板占位符残留: ' + leftover[0].slice(0, 40))
  if (!/\.mpw-bgWrap/.test(cssT)) problems.push('缺少 .mpw-bgWrap 规则（壁纸层样式缺失 → 画面错乱）')
  if (!/\.pI_x6G_sidebarCol/.test(cssT)) problems.push('缺少 .pI_x6G_sidebarCol 规则')
  for (const [label, c] of built) {
    if (c.indexOf('/*BUILD_ERROR*/') === 0) { problems.push('[' + label + '] buildCss 抛错: ' + c.slice(0, 160)); continue }
    const t = strip(c)
    let d2 = 0, bad2 = -1
    for (let i = 0; i < t.length; i++) { if (t[i] === '{') d2++; else if (t[i] === '}') { d2--; if (d2 < 0 && bad2 < 0) bad2 = i } }
    // 说明：历史上这里把"末尾少 1 个 }"当警告放过，结果真有一个 @supports 一直没闭合，
    // 把"玻璃统一块"之后的全部规则都吞进了条件块（详见 client.js 中 2026-09-13 的注释）。
    // 现在一律判失败：花括号不配平 = 一定有规则跑到了错误的层级。
    if (bad2 >= 0) problems.push('[' + label + '] 出现多余 }（会丢弃后续规则）@' + bad2)
    else if (d2 !== 0) problems.push('[' + label + '] 花括号不配平 depth=' + d2 + '（未闭合的 @supports 会吞掉后续规则）')
    if (!/\.mpw-bgWrap/.test(t)) problems.push('[' + label + '] 缺 .mpw-bgWrap 规则')
    if (/\.mpw-bgWrap/.test(t) && !/\.mpw-bgWrap\s*\{[^}]*position:\s*fixed/.test(t) && !/\.mpw-bgWrap\s*\{[^}]*display:\s*none/.test(t)) problems.push('[' + label + '] .mpw-bgWrap 既非 fixed 也非 hidden（壁纸会掉进普通流）')
    if (!/\.pI_x6G_sidebarCol/.test(t)) problems.push('[' + label + '] 缺 .pI_x6G_sidebarCol')
    const lo = t.match(/\$\{[^}]{0,40}/)
    if (lo) problems.push('[' + label + '] 模板占位符残留: ' + lo[0].slice(0, 40))
  }
  if (built.length) console.log('（已按 ' + built.length + ' 组设置分别构建 CSS）')
  if (problems.length) { fail++; console.error('✗ CSS 结构校验: ' + problems.slice(0, 8).join(' | ')) }
  else console.log('✓ CSS 结构校验: 花括号配平 + 关键锚点齐全（' + css.length + ' 字节）')
} catch (e) { fail++; console.error('✗ CSS 结构校验异常: ' + (e && e.message)) }

/* ---------- 静态断言 1：任何函数体用了 h( 就必须自己声明 h（或从参数接收） ---------- */
try {
  const lines = src.split('\n')
  const offenders = []
  const declRe = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/
  for (let i = 0; i < lines.length; i++) {
    const m = declRe.exec(lines[i])
    if (!m) continue
    const name = m[1], params = m[2] || ''
    // 参数里已接收 h（如 ({h}) 或 (props)）→ 跳过
    if (/(^|[{,\s])h([,}\s=]|$)/.test(params)) continue
    // 取该函数体（花括号配平）
    let depth = 0, started = false, body = []
    for (let j = i; j < Math.min(lines.length, i + 4000); j++) {
      const ln = lines[j]
      for (const ch of ln) { if (ch === '{') { depth++; started = true } else if (ch === '}') depth-- }
      body.push(ln)
      if (started && depth === 0) break
    }
    const text = body.join('\n')
    if (!/[^\w.$]h\(/.test(text)) continue
    if (/const\s+h\s*=\s*react\.createElement/.test(text)) continue
    if (/const\s*\{[^}]*\bh\b[^}]*\}\s*=\s*(props|this\.props)/.test(text)) continue
    offenders.push(name + ' (行 ' + (i + 1) + ')')
  }
  if (offenders.length) { fail++; console.error('✗ 静态检查: 以下函数用了 h() 但未声明 h → ' + offenders.join(', ')) }
  else console.log('✓ 静态检查: 所有使用 h() 的函数都自行声明了 h')
} catch (e) { console.error('静态检查1异常:', e.message) }

/* ---------- 静态断言 2：组件内 `h` 必须在首次使用前声明 ---------- */
try {
  const i = src.indexOf('function MpkgSectionImpl')
  const j = src.indexOf('function WallThumb', i) > 0 ? src.length : src.length
  const body = src.slice(i, j)
  const declIdx = body.search(/const\s+h\s*=\s*react\.createElement/)
  const useIdx = body.search(/[^\w.]h\(/)
  if (declIdx < 0) { fail++; console.error('✗ 静态检查: MpkgSectionImpl 内没有 `const h = react.createElement` 声明') }
  else if (useIdx >= 0 && useIdx < declIdx) { fail++; console.error('✗ 静态检查: `h` 在第 ' + useIdx + ' 字符处被使用，但声明在第 ' + declIdx + ' 字符处（TDZ/未定义风险）') }
  else console.log('✓ 静态检查: h 声明先于首次使用')
} catch (e) { console.error('静态检查异常:', e.message) }

for (const c of cases) {
  hookState.length = 0
  globalThis.localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(c.data))
  try {
    const tree = sectionComp({ t: (k) => k, close: () => {} })
    // ①(2026-09-12) 递归执行树里的函数组件（深度≤4）：插件里"子组件用了未声明的 h"这类
    //   错误只有真正调用子组件才会暴露（此前只构建 element 描述符 → 漏检）。
    let nodes = 0
    const walk = (node, depth) => {
      if (!node || depth > 4) return
      if (Array.isArray(node)) { node.forEach((n) => walk(n, depth)); return }
      if (typeof node === 'function') { walk(node({ t: (k) => k, src: 'x.mp4', checked: false, onChange() {}, disabled: false, children: null }), depth + 1); return }
      if (typeof node !== 'object') return
      if (typeof node.type === 'function') { nodes++; walk(node.type(Object.assign({ t: (k) => k, src: 'x.mp4', checked: false, onChange() {}, disabled: false }, node.props || {})), depth + 1); return }
      if (node.kids) walk(node.kids, depth + 1)
    }
    walk(tree, 0)
    const okTree = tree && (tree.__el || typeof tree === 'object')
    console.log(`✓ ${c.name}: 渲染成功（返回元素树；递归执行子组件 ${nodes} 个）`)
  } catch (e) {
    fail++
    console.error(`✗ ${c.name}: 抛出 ${e && e.message}`)
    console.error('   ' + String(e && e.stack || '').split('\n').slice(1, 4).join('\n   '))
  }
}
console.log('\n── 全链路 trace（插桩有效性验证）──')
for (const e of diagEvents.filter((x) => x.kind === 'trace').slice(0, 14)) {
  console.log('  ' + String(e.why).padEnd(16) + ' ' + JSON.stringify(e.data).slice(0, 110))
}

/* ---------- MERGED-3 1.2/1.3/2.3：sceneExtUrl 输入框 + 诊断开关速查区断言 ---------- */
//   1) 渲染树里存在 sceneExtUrl 输入框（placeholder 键）与 diag 折叠入口；
//   2) 面板 diagflag.* i18n 键集合 == we-scene-demo/diag-flags.json 的 common 集合
//      == client.js 内置副本 MPW_DIAG_FLAGS_FALLBACK 集合（渲染器离线时的兜底数据同源）。
try {
  const problems = []
  hookState.length = 0
  globalThis.localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify({ enabled: true }))
  const treeUX = sectionComp({ t: (k) => k, close: () => {} })
  const flat = JSON.stringify(treeUX, (k, v) => (typeof v === 'function' ? String(v) : v))
  if (!/\"type\":\"input\"/.test(flat) || flat.indexOf('scnRender.extUrl.ph') < 0) problems.push('sceneExtUrl 输入框缺失（1.2）')
  // 折叠区收起时也恒在树里的键（diag.copy/copyed/fold 只在展开态出现 → 用字典断言覆盖）
  for (const k of ['scnRender.extUrl', 'scnRender.extUrl.hint', 'scnRender.extUrl.save', 'scnRender.extUrl.test', 'diag.sec', 'diag.sec.desc', 'diag.expand', 'diag.more']) {
    if (flat.indexOf(k) < 0) problems.push('渲染树缺 i18n 键 ' + k)
  }
  // zh/en 字典里的 diagflag.* 键集合
  const dictNames = (dictSrc) => {
    const set = new Set()
    const re = /"(diagflag)\.([a-z0-9_]+)(\.d)?":/g
    let m
    while ((m = re.exec(dictSrc))) set.add(m[2] + (m[3] || ''))
    return set
  }
  const zhSeg = src.slice(src.indexOf('const zh = {'), src.indexOf('const en = {'))
  const enSeg = src.slice(src.indexOf('const en = {'))
  const zhNames = [...dictNames(zhSeg).keys()].filter((x) => !x.endsWith('.d'))
  const zhDescs = dictNames(zhSeg)
  const enNames = [...dictNames(enSeg).keys()].filter((x) => !x.endsWith('.d'))
  for (const k of ['diag.copy', 'diag.copied', 'diag.fold']) {
    if (!new RegExp('"' + k + '":').test(zhSeg)) problems.push('zh 字典缺 ' + k)
    if (!new RegExp('"' + k + '":').test(enSeg)) problems.push('en 字典缺 ' + k)
  }
  // 内置副本（离线兜底）
  const fbMatch = /MPW_DIAG_FLAGS_FALLBACK\s*=\s*(['"])((?:[^'\\]|\\.)*?)\1/.exec(src)
  let fbNames = []
  if (fbMatch) {
    try {
      let raw = fbMatch[2]
      if (fbMatch[1] === "'") raw = raw.replace(/\\'/g, "'")
      else raw = raw.replace(/\\"/g, '"')
      fbNames = JSON.parse(raw).map((x) => x.name)
    } catch (e) { problems.push('MPW_DIAG_FLAGS_FALLBACK 解析失败: ' + e.message) }
  } else problems.push('client.js 缺 MPW_DIAG_FLAGS_FALLBACK 常量')
  // 脚本生成的 JSON（渲染器在线数据源）
  const jsonPath = path.join(here, '..', '..', 'we-scene-demo', 'diag-flags.json')
  let jsonNames = []
  try {
    const dj = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    jsonNames = (dj.common || []).map((x) => (typeof x === 'string' ? x : x.name))
  } catch (e) { problems.push('diag-flags.json 读取失败: ' + e.message) }
  const eq = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
  if (!jsonNames.length) problems.push('diag-flags.json common 集合为空')
  if (!eq(zhNames, jsonNames)) problems.push('zh diagflag 集合 != JSON common（zh=' + zhNames.join(',') + ' json=' + jsonNames.join(',') + '）')
  if (!eq(enNames, jsonNames)) problems.push('en diagflag 集合 != JSON common')
  if (!eq(fbNames, jsonNames)) problems.push('内置副本集合 != JSON common')
  for (const n of jsonNames) if (!zhDescs.has(n + '.d')) problems.push('缺 zh 描述键 diagflag.' + n + '.d')
  if (problems.length) { fail++; console.error('✗ 场景体验断言: ' + problems.slice(0, 6).join(' | ')) }
  else console.log('✓ 场景体验断言: sceneExtUrl 输入框在树 + diag 折叠入口在树 + diagflag 集合三源一致（' + jsonNames.length + ' 个常用开关）')
} catch (e) { fail++; console.error('✗ 场景体验断言异常: ' + (e && e.message)) }

console.log(`\n面板冒烟：${cases.length - fail}/${cases.length} 通过` + (fail ? ' ✗' : ' ✓'))
process.exit(fail ? 1 : 0)

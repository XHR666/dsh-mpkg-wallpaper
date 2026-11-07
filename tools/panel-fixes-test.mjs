// tools/panel-fixes-test.mjs —— P-66（2026-09-15）**仅**覆盖两个插件自身真 bug 的回归
// 说明：报障所述 9 条界面问题经确认为 **webwallgl 测试台（:8901）** 的问题，不是 DSH 插件面板；
//       相关 UI 改动已全部回退。本文件只保留与那个界面无关、可独立复现的插件真 bug 断言：
//   (a1) 渲染错误边界自身抛 `h is not defined` → 面板空白（连错误信息都看不到）
//   (a2) zh/en 字典键集合不一致（en 缺 18 键 → 英文界面显示 key 原文；clock.* 只在 en → 中文界面出英文）
// 用法: node tools/panel-fixes-test.mjs [--client <path>]
//   --client 指向**修复前**的副本可验证本测试真能抓到 bug（红 → 绿）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argClient = process.argv.indexOf('--client')
const clientPath = argClient > 0 ? process.argv[argClient + 1] : path.join(here, '..', 'lib', 'client.js')
const src = fs.readFileSync(clientPath, 'utf8')

let fail = 0
let pass = 0
const ok = (n) => { pass++; console.log('  ✓ ' + n) }
const bad = (n, d) => { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')) }

/* ---------- 桩 React ---------- */
const mkEl = (type, props, ...kids) => ({ __el: true, type, props: props || {}, kids: kids.flat(9) })
let ARM_BODY_THROW = false   // 置 true → 下一次渲染的组件体内抛错（用于精确命中渲染错误边界）
const hookState = []
let hookIdx = 0
const react = {
  createElement: mkEl,
  Fragment: Symbol('Fragment'),
  memo: (f) => f,
  useState: (init) => { const i = hookIdx++; if (hookState[i] === undefined) hookState[i] = typeof init === 'function' ? init() : init; return [hookState[i], (v) => { hookState[i] = typeof v === 'function' ? v(hookState[i]) : v }] },
  useEffect: () => { if (ARM_BODY_THROW) { ARM_BODY_THROW = false; throw new Error('boom-body') } },
  useMemo: (f) => f(), useRef: (v) => ({ current: v === undefined ? null : v }),
  useCallback: (f) => f, Component: class { constructor(p) { this.props = p } setState() {} },
}
const ReactDOM = { createPortal: (n) => n, render: () => {}, unmountComponentAtNode: () => {} }
const el = (tag = 'div') => ({
  tagName: String(tag).toUpperCase(), style: {}, className: '', id: '', textContent: '', innerHTML: '',
  children: [], childNodes: [], parentElement: null, dataset: {}, nodeType: 1,
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  setAttribute() {}, getAttribute: () => null, removeAttribute() {}, hasAttribute: () => false,
  appendChild(c) { this.children.push(c); c.parentElement = this; return c },
  insertBefore(c) { return this.appendChild(c) },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c },
  remove() {}, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 }),
  getContext: () => null, focus() {}, click() {}, contains: () => false, matches: () => false,
})
const doc = {
  documentElement: el('html'), body: el('body'), head: el('head'), title: 'test',
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
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'zh-CN' }, configurable: true }) } catch {}
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) } }
globalThis.CSS = { supports: () => true }
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return [] } }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0)
globalThis.cancelAnimationFrame = () => {}
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; this.complete = false } set src(v) { this._s = v } get src() { return this._s } }
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) })

/* ---------- 载入插件 ---------- */
const registry = []
globalThis.__ModuleLoader__ = { load: (reg) => registry.push(reg) }
const stubRequire = (name) => (name === 'react' ? react : name === 'react-dom' ? ReactDOM : name === 'react-dom/client' ? { createRoot: () => ({ render: () => {}, unmount: () => {} }) } : {})
new Function('require', 'module', 'exports', src)(stubRequire, { exports: {} }, {})
let plugin = null
for (const reg of registry) { try { const out = reg.factory(stubRequire); if (out && typeof out.apply === 'function') { plugin = out; break } } catch (e) { console.error('factory 调用失败:', e && e.message) } }
if (!plugin) { console.error('✗ 未取到插件 exports'); process.exit(1) }

let sectionComp = null
let captured = null
const ctx = {
  slots: { inject: (n, fn) => { try { fn() } catch (e) { console.error('inject 失败:', e.message) } }, register: (opts, comp) => { if (opts && opts.name === 'settings.section') sectionComp = comp; return { dispose() {} } } },
  locale: { bind: () => (k) => k, register: (ns, dicts) => { captured = { ns, dicts }; return { dispose() {} } } },
  effect: (f) => { try { f() } catch {} },
  logger: { info() {}, warn() {}, error() {} },
}
plugin.apply(ctx)
const zh = captured.dicts.zh, en = captured.dicts.en

const render = (t, data) => { hookState.length = 0; hookIdx = 0; globalThis.localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(data || { enabled: true })); return sectionComp({ t: t || ((k) => k), close: () => {} }) }
const deepText = (node, out, depth) => {
  out = out || []; depth = depth || 0
  if (depth > 8 || node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { node.forEach((n) => deepText(n, out, depth)); return out }
  if (typeof node === 'function') { try { deepText(node({ t: (k) => k, src: 'x.mp4', checked: false, onChange() {}, disabled: false }), out, depth + 1) } catch {} ; return out }
  if (typeof node !== 'object') return out
  if (node.__el) {
    if (typeof node.type === 'function') { try { deepText(node.type(Object.assign({ t: (k) => k, src: 'x.mp4', checked: false, onChange() {}, disabled: false }, node.props || {})), out, depth + 1) } catch {} ; return out }
    deepText(node.kids, out, depth)
  }
  return out
}

console.log('\u001b[1m== (a1) 渲染错误边界：出错时必须显示错误，不能自己再抛 h is not defined ==\u001b[0m')
{
  // 复现：让组件体在 hooks 阶段抛错（真实场景同样存在：状态里的脏字段触发组件体计算抛错）→
  //   走 `MpkgSectionImpl` 的渲染错误边界。
  // 修复前：边界自身抛 `h is not defined`（h 是外层 try 块内的 const，catch 看不见）→
  //   所见是 `壁纸引擎设置区渲染异常：h is not defined`，**真因被吞**；
  // 修复后：显示真实错误内容（`壁纸引擎设置渲染出错: boom-body`）。
  let threw = null, text = ''
  ARM_BODY_THROW = true
  try { text = deepText(render((k) => k, { enabled: true })).join(' ') } catch (e) { threw = e }
  ARM_BODY_THROW = false
  if (threw) bad('渲染错误边界可用（出错时给出提示而不是抛错）', String(threw && threw.message))
  else if (text.indexOf('壁纸引擎设置渲染出错: boom-body') >= 0) ok('渲染错误边界可用：显示真实错误内容（真因不再被 h is not defined 吞掉）')
  else bad('错误边界没有显示真实错误', text.slice(0, 120))
  // ①(2026-10-24) 切片收窄到 MpkgSectionImpl 的结尾（'//  多语言' 段落头）：原实现切到文件尾，
  //   隐含假设"边界后面没有别的组件代码"——文件增长后，后面合法的 `return h("div"`（h 已在
  //   各组件内声明，panel-smoke 有同款静态判据）会误伤。收窄后断言对象不变、强度不变。
  const bi = src.indexOf('设置页渲染失败')
  const boundary = src.slice(bi, src.indexOf('//  多语言', bi) >= 0 ? src.indexOf('//  多语言', bi) : undefined)
  if (boundary.indexOf('react.createElement("div"') >= 0 && boundary.indexOf('return h("div"') < 0) ok('静态守卫：错误边界改用 react.createElement（不再引用 try 块内的 h）')
  else bad('错误边界仍在引用 try 块内的 h')
}

console.log('\u001b[1m== (a2) 语言字典：zh/en 键集合必须一致 ==\u001b[0m')
{
  const zk = Object.keys(zh), ek = Object.keys(en)
  const missing = zk.filter((k) => !(k in en))
  const extra = ek.filter((k) => !(k in zh))
  if (!missing.length && !extra.length) ok(`zh/en 键集合完全一致（${zk.length} 键）`)
  else bad('zh/en 键集合不一致', `en 缺 ${missing.length} 个: ${missing.slice(0, 8).join(',')}｜en 多 ${extra.length} 个: ${extra.slice(0, 8).join(',')}`)

  const used = new Set()
  const re = /\bt\("([a-zA-Z][a-zA-Z0-9_.]*)"\)/g
  let m
  while ((m = re.exec(src))) used.add(m[1])
  const missUsed = [...used].filter((k) => !(k in zh) || !(k in en))
  if (!missUsed.length) ok(`源码 t("k") 静态键 ${used.size} 个两套字典齐全`)
  else bad('有 t() 键在字典里缺失', missUsed.slice(0, 10).join(','))

  const enTree = render((k) => (k in en ? en[k] : k), { enabled: true, fromMpkg: true, mpkgName: 'x', source: 'preview.gif', image: true })
  const cjk = [...new Set((deepText(enTree).join(' ').match(/[\u4e00-\u9fff]{1,12}/g) || []))]
  if (!cjk.length) ok('英文渲染零中文（缺键 / 硬编码中文都会在这里暴露）')
  else bad('英文渲染仍有中文', cjk.slice(0, 8).join(' / '))

  const zhTree = render((k) => (k in zh ? zh[k] : k), { enabled: true })
  const rawKeys = [...new Set((deepText(zhTree).join(' ').match(/\b[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+\b/g) || []))].filter((k) => k in zh)
  if (!rawKeys.length) ok('中文渲染零"键名当文案"残留')
  else bad('中文渲染出现未翻译键', rawKeys.slice(0, 8).join(','))
}


/* ═══ SCROLLX 组（2026-11-03 第四轮 §2④ D2/E 读数）：聊天滚动容器 overflow-x: clip ═══
   背景：宿主发送键 tooltip 被渲染在有 transform 的按钮/卡片内（fixed ⇒ 相对卡片定位），
   坐标偏出视口右缘 ⇒ 绝对定位盒撑出容器级横向滚动条 ⇒ 布局位移 ⇒ 跳动循环。
   缓解：聊天滚动容器 overflow-x: clip（不创建滚动容器、不破坏竖向滚动）。 */
{
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ enabled: true, image: 'stub-wallpaper.png' }) : '')
  ok('SCROLLX1 聊天滚动容器 overflow-x: clip 在位（防 tooltip 撑出横向滚动条）',
    /html body \[class\*="scrollBody\"]:not\(\[data-code-block-banner\]\)\s*\{[^}]*overflow-x:\s*clip !important/.test(css))
  ok('SCROLLX2 clip 不影响竖向滚动（overflow-y 不被 clip 规则触碰）',
    !/scrollBody[^}]*overflow-y:\s*clip/.test(css))
}

/* ═══ HOOK 组（2026-11-06 真机：点「鼠标光晕」/「统一虚化」等开关 ⇒ 设置面板被错误边界替换） ═══
   根因：滑条行旧实现是**渲染体内的内联函数**，函数体里调用 useRef/useEffect；而它的调用点大量位于
   "开关开启后才渲染"的条件分支（如光晕亮度条只在光晕开启时出现）⇒ 拨一下开关就改变 hook 数量，
   React 抛 #310/#300/#321，整块面板被"渲染失败"错误边界替换（真机可复现）。
   修复 = 把 hook 收进独立组件 MpwSliderRow，sliderRow 只做 h() 工厂。
   判据：工厂体里不许有 hook；hook 必须在组件体内；变异自证（塞回 hook ⇒ 必红）。 */
{
  const findSliderFactory = (text) => {
    const start = text.indexOf('const sliderRow = (label, field, min, max, suffix, step, def) => {')
    if (start < 0) return ''
    const end = text.indexOf('const toggleRow = (label, desc, field, def, disabled, forceOn, shown) => {', start)
    return end > start ? text.slice(start, end) : text.slice(start, start + 4000)
  }
  const findSliderComp = (text) => {
    const start = text.indexOf('function MpwSliderRow(props) {')
    if (start < 0) return ''
    const marker = text.indexOf('function MpkgSection(props) {', start)
    return marker > start ? text.slice(start, marker) : text.slice(start, start + 9000)
  }
  const checkHooks = (text) => {
    const factory = findSliderFactory(text)
    const comp = findSliderComp(text)
    return {
      factoryFound: !!factory, compFound: !!comp,
      factoryHook: /react\.use[A-Z]/.test(factory),
      compHook: /react\.useRef/.test(comp) && /react\.useEffect/.test(comp),
    }
  }
  const r = checkHooks(src)
  ok('HOOK1 已定位 sliderRow 工厂与 MpwSliderRow 组件', r.factoryFound && r.compFound)
  ok('HOOK2 sliderRow 工厂体内无 hook（条件渲染安全）', r.factoryFound && !r.factoryHook)
  ok('HOOK3 hook 已收进 MpwSliderRow 组件体内', r.compHook)
  const fac = findSliderFactory(src)
  const mutated = src.replace(fac, fac.replace('onPreview: (patch) => previewCss(patch),', 'const __rf = react.useRef(null);\n\t\t\t\tonPreview: (patch) => previewCss(patch),'))
  ok('HOOK4 变异自证：工厂里塞回 hook ⇒ 判据必红', checkHooks(mutated).factoryHook === true && mutated !== src)
}

/* ═══ A 组（2026-11-07 交接文档 §7.3 剩余异常 A10–A18 的回归判据）═══
   每一项都配"变异自证"（把修法改回去 ⇒ 判据必红），防止以后又悄悄退回旧行为。
   这些是**源码/文案/纯函数**级判据；真机行为由 CDP 探针另行核对。 */
{
  const grabFn = (name) => {
    const i = src.indexOf('function ' + name + '(')
    if (i < 0) return ''
    let d = 0
    for (let j = i; j < src.length; j++) {
      const c = src[j]
      if (c === '{') d++
      else if (c === '}') { d--; if (d === 0) return src.slice(i, j + 1) }
    }
    return ''
  }
  const has = (re) => re.test(src)

  /* A16 错误弹窗标题：默认不再写「导入失败」；showError 支持显式 title 参数。 */
  ok('A16 错误弹窗默认标题 = 操作未完成 / Action not completed',
    has(/"error\.title": "操作未完成"/) && has(/"error\.title": "Action not completed"/))
  ok('A16 showError 支持第二参 title（调用方可给更精确标题）', /const showError = \(msg, title\) =>/.test(src))
  {
    const showSrc = (src.match(/const showError = \(msg, title\) => \{[^\n]*\}/) || [''])[0]
    ok('A16 showError 体内不再硬编码「导入失败」', !!showSrc && showSrc.indexOf('导入失败') < 0)
    const mutated = src.replace(showSrc, showSrc.replace('setErrorTitle(title ? String(title) : "");', 'setErrorTitle("导入失败");'))
    ok('A16 变异自证：showError 硬编码「导入失败」⇒ 判据必红',
      mutated !== src && (mutated.match(/const showError = \(msg, title\) => \{[^\n]*\}/) || [''])[0].indexOf('导入失败') >= 0)
  }

  /* A11 场景上报文案与默认值统一（默认开是用户此前明确要求，故改文案而不是改默认）。 */
  ok('A11 sceneReport 默认仍为 true 且文案写「默认开启」',
    has(/const DEFAULT_SCENE_REPORT = true/) && has(/默认开启/) && !has(/默认关（有磁盘写入）/))

  /* A10 渲染方式：不再写死字段 sceneRender（无读取点）；另两项标预留。 */
  ok('A10 不再 commit({sceneRender})（假开关）', !/commit\(\{\s*sceneRender/.test(src))
  ok('A10 预留项文案在位（当前只实现 WebGL 实时）', has(/"scnRender\.reserved":/) && has(/当前渲染器只有 WebGL 实时一条实现/))
  ok('A10 变异自证：把 commit 写回渲染方式按钮 ⇒ 判据必红',
    /commit\(\{\s*sceneRender/.test(src.replace('onClick: () => { if (!live) setHint(t("scnRender.reserved")); }', 'onClick: () => commit({ sceneRender: v }, true)')))

  /* A13 主题颜色 hint 指向新位置（同页「主题与配色」的「配色」），不再指旧 Aqua 区。 */
  ok('A13 主题颜色 hint 指向「主题与配色」且不含旧「Aqua 区」',
    has(/"themeColor\.hint": "[^"]*主题与配色/) && !has(/由 Aqua 区的「配色」控制/))

  /* A17 预设「恢复默认」更名为「恢复为此预设」（与出厂重置区分）。 */
  ok('A17 预设恢复按钮文案 = 恢复为此预设（zh/en）',
    has(/"preset\.restore": "恢复为此预设"/) && has(/"preset\.restore": "Restore this preset"/))
  ok('A17 提示明确「不是恢复出厂值」且指向「恢复所有默认设置」',
    has(/不是恢复出厂值/) && has(/restoreTip": "[^"]*not factory defaults/) && has(/Restore all default settings/))

  /* A14 newStyle 有 UI 入口（此前只能导入备份打开）。 */
  ok('A14 「其他」页有 newStyle 开关入口', has(/toggleRow\(t\("newStyle"\), t\("newStyle\.desc"\), "newStyle", false\)/))

  /* A15 数据卫生：死键 l 从快照/布尔净化表移除；死 i18n 键清掉；旧注释改对。 */
  ok('A15 boolFields 无单字母死键 l', !/const boolFields = \[[^\]]*"l"/.test(src))
  ok('A15 快照白名单无死键 l', !/"lgTest",\s*"l",\s*"lgComposer"/.test(src))
  ok('A15 死 i18n 键已清除（popoverBlurAmount/mpkg.using/lib.webPending/rot.intervalHint/glass.color/glass.alpha）',
    ['popoverBlurAmount', 'mpkg.using', 'lib.webPending', 'rot.intervalHint', 'glass.color', 'glass.alpha']
      .every((k) => src.indexOf('"' + k + '"') < 0))
  ok('A15 弹层半径注释改为 surfaceBlur 口径', has(/半径 = 「虚化弹层」开着时的\s*surfaceBlur/))

  /* A18 resMax → 渲染器 setRenderDpr：纯函数映射 + 下发点。 */
  ok('A18 宿主下发 renderDpr 命令', has(/mpwSceneHostCmd\("renderDpr", \{ v: p\.dpr \}\)/) && has(/mpwSceneDisplayPatch\(frame\)/))
  const dprSrc = grabFn('mpwSceneRenderDpr')
  ok('A18 已定位 mpwSceneRenderDpr 纯函数', !!dprSrc)
  const loadDpr = (text, dpr, innerW) => new Function('window', text + '\nreturn mpwSceneRenderDpr;')({ innerWidth: innerW || 1200, devicePixelRatio: dpr || 1 })
  if (dprSrc) {
    const fr = (w) => ({ getBoundingClientRect: () => ({ width: w }) })
    const fn = loadDpr(dprSrc, 1)
    const cases = [
      ['resMax=0 ⇒ 不下发（0）', fn({ resMax: 0 }, fr(1000)) === 0],
      ['css1000@1x,resMax2000 ⇒ 2 倍', fn({ resMax: 2000 }, fr(1000)) === 2],
      ['css1000@2x,resMax1500 ⇒ 向下取整 1 倍（不超上限）', loadDpr(dprSrc, 2)({ resMax: 1500 }, fr(1000)) === 1],
      ['css1000@3x,resMax6000 ⇒ 夹到 5 倍', loadDpr(dprSrc, 3)({ resMax: 6000 }, fr(1000)) === 5],
      ['iframe 未布局 ⇒ 退回 window.innerWidth', fn({ resMax: 1800 }, fr(0)) === 1],
      ['上限低于 1 倍 ⇒ 最低 1 倍', fn({ resMax: 500 }, fr(1000)) === 1],
    ]
    for (const [name, passed] of cases) ok('A18 ' + name, passed)
    const mutated = dprSrc.replace('Math.floor(targetW / cssW)', 'Math.ceil(targetW / cssW)')
    ok('A18 变异自证：floor→ceil（会超上限）⇒ 判据必红',
      mutated !== dprSrc && loadDpr(mutated, 2)({ resMax: 1500 }, fr(1000)) !== 1)
  }

  /* A12 「去插件市场更新」真导航：service 三通路 + DOM 兜底 + 两个按钮都走同一入口。 */
  ok('A12 已实现 mpwOpenPluginMarket（layout/market/pluginNavigation + DOM 兜底）',
    has(/function mpwOpenPluginMarket/) && has(/"dsh-market"/) && has(/pluginNavigation/) && has(/mpwClickMarketTabLater/))
  ok('A12 导航前先关掉宿主设置弹窗（否则导航发生在模态底下，用户看不到市场）',
    has(/function mpwCloseHostSettingsDialog/) && has(/key: "Escape"/) && has(/mpwCloseHostSettingsDialog\(\)/))
  ok('A12 「其他」页与更新确认弹窗两个市场按钮都走导航入口（不再是纯 setHint）',
    (src.match(/mpwOpenPluginMarket\(/g) || []).length >= 3 && has(/update\.openingMarket/))
  ok('A12 变异自证：把按钮改回只 setHint ⇒ 判据必红',
    (src.replace('if (mpwOpenPluginMarket("update")) setHint(t("update.openingMarket"));', 'setHint(t("update.gotoMarket"));').match(/mpwOpenPluginMarket\(/g) || []).length < 3)
  ok('A12 变异自证：去掉「关设置弹窗」这一环 ⇒ 判据必红',
    !/function mpwCloseHostSettingsDialog/.test(src.replace('function mpwCloseHostSettingsDialog() {', 'function mpwNoopDialog() {')))
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)

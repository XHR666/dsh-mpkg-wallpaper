// tools/panel-fixes-test.mjs —— P-66（2026-09-15）**仅**覆盖两个插件自身真 bug 的回归
// 说明：用户报的 9 条界面问题经确认为 **webwallgl 测试台（:8901）** 的问题，不是 DSH 插件面板；
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
  //   用户看到的是 `壁纸引擎设置区渲染异常：h is not defined`，**真因被吞**；
  // 修复后：显示真实错误内容（`壁纸引擎设置渲染出错: boom-body`）。
  let threw = null, text = ''
  ARM_BODY_THROW = true
  try { text = deepText(render((k) => k, { enabled: true })).join(' ') } catch (e) { threw = e }
  ARM_BODY_THROW = false
  if (threw) bad('渲染错误边界可用（出错时给出提示而不是抛错）', String(threw && threw.message))
  else if (text.indexOf('壁纸引擎设置渲染出错: boom-body') >= 0) ok('渲染错误边界可用：显示真实错误内容（真因不再被 h is not defined 吞掉）')
  else bad('错误边界没有显示真实错误', text.slice(0, 120))
  const boundary = src.slice(src.indexOf('设置页渲染失败'))
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

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)

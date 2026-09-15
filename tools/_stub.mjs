// tools/_stub.mjs — 无浏览器的插件加载桩（panel-smoke / css-matrix 共用）
// 把 lib/client.js 在 Node 里跑起来：注册 __ModuleLoader__ → 调用 factory → 拿到 plugin
// → 用桩 ctx 执行 apply()，并返回 settings.section 组件、诊断事件、apply 期间的错误。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export function installStubs() {
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
  return { react, ReactDOM, doc, listeners, fetchCalls, diagEvents }
}

/**
 * 载入插件并 apply()。
 * @param {{clientPath?:string, search?:string, settings?:object, quiet?:boolean}} opts
 */
export function loadPlugin(opts = {}) {
  const stubs = installStubs()
  const clientPath = opts.clientPath || path.join(here, '..', 'lib', 'client.js')
  const src = fs.readFileSync(clientPath, 'utf8')
  if (opts.search !== undefined) globalThis.location = { href: 'http://127.0.0.1:3080/' + String(opts.search), search: String(opts.search), hash: '', origin: 'http://127.0.0.1:3080' }
  if (opts.settings) globalThis.localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(opts.settings))

  const registry = []
  globalThis.__ModuleLoader__ = { load: (reg) => registry.push(reg) }
  const stubRequire = (name) => {
    if (name === 'react') return stubs.react
    if (name === 'react-dom') return stubs.ReactDOM
    if (name === 'react-dom/client') return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
    return {}
  }
  new Function('require', 'module', 'exports', src)(stubRequire, { exports: {} }, {})
  if (!registry.length) throw new Error('插件未向 __ModuleLoader__ 注册')
  let plugin = null
  for (const reg of registry) {
    try {
      const out = reg.factory(stubRequire)
      if (out && typeof out.apply === 'function') { plugin = out; break }
      if (out && out.default && typeof out.default.apply === 'function') { plugin = out.default; break }
    } catch (e) { if (!opts.quiet) console.error('factory 调用失败:', e && e.message) }
  }
  if (!plugin) plugin = globalThis.__mpwClientLoaded
  if (!plugin || typeof plugin.apply !== 'function') throw new Error('未取到插件 apply()')

  let sectionComp = null
  const ctx = {
    slots: {
      inject: (name, fn) => { try { fn() } catch (e) { if (!opts.quiet) console.error('inject 失败:', e.message) } },
      register: (o, comp) => { if (o && o.name === 'settings.section') sectionComp = comp; return { dispose() {} } },
    },
    locale: { bind: () => (k) => k, register: () => ({ dispose() {} }) },
    effect: (f) => { try { f() } catch (e) { if (!opts.quiet) console.error('effect 失败:', e.message) } },
    logger: { info() {}, warn() {}, error() {} },
  }
  const applyErrors = []
  const origErr = console.error
  console.error = (...a) => { applyErrors.push(a.map((x) => (x && x.message) || String(x)).join(' ')); if (!opts.quiet) origErr.apply(console, a) }
  try { plugin.apply(ctx) } finally { console.error = origErr }

  return { src, plugin, sectionComp, ctx, applyErrors, ...stubs }
}

/** 读取宿主真实设置（存在则用，不存在给空对象） */
export function readSection(file) {
  try { const f = file || '/root/.dsh/.dsh-mpkg-wallpaper/settings.json'; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
  return {}
}

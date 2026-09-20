// tools/_stub.mjs — 无浏览器的插件加载桩（panel-smoke / css-matrix 共用）
// 把 lib/client.js 在 Node 里跑起来：注册 __ModuleLoader__ → 调用 factory → 拿到 plugin
// → 用桩 ctx 执行 apply()，并返回 settings.section 组件、诊断事件、apply 期间的错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export function installStubs(opts = {}) {
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
  // ①(2026-09-17 持久化轮) 桩 DOM 也要有 **id 索引**：生产里 `getElementById('mpw-bgWrap')` 会拿到
  //   已存在的层（ensureBgDom 幂等复用），桩恒返回 null ⇒ 每次重载都新建一层、`#mpw-bgImg` 永远查不到，
  //   连"刷新后壁纸是否恢复"这种最关键的断言都做不了（也用假语义掩盖了重复挂载）。
  const byId = new Map()
  const el = (tag = 'div') => {
    const node = {
    tagName: String(tag).toUpperCase(),
    // 真 DOM 的 `style` 是 CSSStyleDeclaration（有 setProperty/removeProperty）。桩原先只给 `{}`
    // ⇒ 壁纸挂载后 `wrap.style.setProperty('--mpw-zoom', …)` 抛 TypeError，被"有源必挂"兜底当成
    // "没挂上"再补一次（假失败）。这里补上最小实现，桩行为贴近真 DOM。
    style: { setProperty(k, v) { this[k] = String(v) }, removeProperty(k) { delete this[k] }, getPropertyValue(k) { return this[k] === undefined ? '' : String(this[k]) } },
    className: '', textContent: '', innerHTML: '',
    children: [], childNodes: [], parentElement: null, dataset: {}, nodeType: 1,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    // ①(2026-09-17 better-sidebar 适配轮) 真 DOM 的属性表。原先 setAttribute 是空实现、
    //   getAttribute 恒 null ⇒ "版本探测到底有没有把 data-mpw-bs-version 写到 body 上"这种
    //   **结果落点**在桩里根本断言不了（只能断言"代码跑过"，正是假绿的温床）。现在每个节点
    //   一份最小属性表，set/get/remove/has 与真 DOM 同语义。
    __attrs: new Map(),
    setAttribute(k, v) { this.__attrs.set(String(k), String(v)) },
    getAttribute(k) { const key = String(k); return this.__attrs.has(key) ? this.__attrs.get(key) : null },
    removeAttribute(k) { this.__attrs.delete(String(k)) },
    hasAttribute(k) { return this.__attrs.has(String(k)) },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c },
    insertBefore(c) { return this.appendChild(c) },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c },
    remove() { if (this.parentElement) this.parentElement.removeChild(this) },
    addEventListener(k, f) { (listeners[k] = listeners[k] || []).push(f) },
    removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 }),
    getContext: () => null, focus() {}, click() {}, contains: () => false, matches: () => false,
    }
    try {
      Object.defineProperty(node, 'id', {
        configurable: true,
        get () { return node.__id || '' },
        set (v) { node.__id = String(v); if (v) byId.set(String(v), node) },
      })
    } catch {}
    return node
  }
  const docEl = el('html')
  const doc = {
    documentElement: docEl, body: el('body'), head: el('head'), title: 'test',
    createElement: (t) => el(t), createElementNS: (ns, t) => el(t), createTextNode: (t) => ({ textContent: t, nodeType: 3 }),
    createDocumentFragment: () => el('fragment'),
    getElementById: (id) => byId.get(String(id)) || null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
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
  // ①(2026-09-17 持久化轮) `opts.localStorage` 允许用例传一份**自己持有的**存储（默认每次新建）：
  //   "刷新/重启"用例要跨两次 loadPlugin 复用同一份 localStorage —— 否则重新载入会把数据清空，
  //   测的就不是"重载后能不能恢复"了。
  globalThis.localStorage = opts.localStorage || {
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
  // ①(持久化轮) 桩里没有渲染引擎，`blob:` URL 在断言里不可比对 ⇒ 桩把"字符串内容"原样当
  //   URL 返回（真浏览器里 Blob → ObjectURL 才是真实路径）。这样"刷新后壁纸是否真是原来那张"
  //   可以用 `img.src === <原 dataURL>` **严格相等**判定，而不是只能比前缀。
  globalThis.URL.createObjectURL = (v) => (typeof v === 'string' ? v : 'blob:stub')
  globalThis.URL.revokeObjectURL = () => {}
  const fetchCalls = []
  const diagEvents = []
  // ①(2026-09-17 壁纸层可见性轮) 允许用例**替换宿主应答**（installStubs({fetch})）：
  //   默认桩 = 宿主不可用（ok:false/404）；bgwrap-visible-test 用它模拟"宿主 /settings 返回
  //   settings:null / 慢响应 / 带 opacity 的合并"三种时序场景。
  globalThis.fetch = typeof opts.fetch === 'function'
    ? async (url, o) => { fetchCalls.push(String(url)); try { if (String(url).indexOf('/diag') >= 0 && o && o.body) diagEvents.push(JSON.parse(o.body)) } catch {}; return opts.fetch(String(url), o) }
    : async (url, opts2) => {
      fetchCalls.push(String(url))
      try { if (String(url).indexOf('/diag') >= 0 && opts2 && opts2.body) diagEvents.push(JSON.parse(opts2.body)) } catch {}
      return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    }
  return { react, ReactDOM, doc, listeners, fetchCalls, diagEvents }
}

/**
 * 载入插件并 apply()。
 * @param {{clientPath?:string, search?:string, settings?:object, quiet?:boolean, fetch?:Function}} opts
 */
export function loadPlugin(opts = {}) {
  const stubs = installStubs(opts)
  const clientPath = opts.clientPath || path.join(here, '..', 'lib', 'client.js')
  const src = fs.readFileSync(clientPath, 'utf8')
  if (opts.search !== undefined) globalThis.location = { href: 'http://127.0.0.1:3080/' + String(opts.search), search: String(opts.search), hash: '', origin: 'http://127.0.0.1:3080' }
  if (opts.settings) globalThis.localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(opts.settings))
  // ①(2026-09-17 持久化轮) IndexedDB 桩：只在用例显式传入 `indexedDB` 时装上（默认**不装** ⇒
  //   走"IDB 不可用"的降级分支）。用例自己提供持久化对象（跨"重载"复用同一份 db 实例）。
  if (opts.indexedDB !== undefined) globalThis.indexedDB = opts.indexedDB
  else { try { delete globalThis.indexedDB } catch {} }
  // `Blob` 在 Node 18+ 是内建全局（写侧落 IDB 的是真 Blob/dataURL，读侧用 instanceof Blob 判定）。
  if (typeof globalThis.Blob === 'undefined' && opts.Blob) globalThis.Blob = opts.Blob

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
  // ①(2026-09-19，P-128) 语言字典**留证**：桩原来把 `register(NS, {zh,en})` 的参数吞掉（只返回 dispose），
  //   ⇒ 想看"某个 i18n 键还在不在两套字典里"只能去正则读源码。改成把实参记下来并随结果返回
  //   （`loadPlugin(...).localeDicts`），switch-wiring-test 用它断言"已退役开关的文案 0 残留"。
  //   纯增量：不改任何既有返回值/语义。
  let localeDicts = null, localeNs = null
  const ctx = {
    slots: {
      inject: (name, fn) => { try { fn() } catch (e) { if (!opts.quiet) console.error('inject 失败:', e.message) } },
      register: (o, comp) => { if (o && o.name === 'settings.section') sectionComp = comp; return { dispose() {} } },
    },
    locale: {
      bind: () => (k) => k,
      register: (ns, dicts) => {
        if (dicts && typeof dicts === 'object' && (dicts.zh || dicts.en)) { localeDicts = dicts; localeNs = ns }
        return { dispose() {} }
      },
    },
    effect: (f) => { try { f() } catch (e) { if (!opts.quiet) console.error('effect 失败:', e.message) } },
    logger: { info() {}, warn() {}, error() {} },
  }
  const applyErrors = []
  const origErr = console.error
  console.error = (...a) => { applyErrors.push(a.map((x) => (x && x.message) || String(x)).join(' ')); if (!opts.quiet) origErr.apply(console, a) }
  try { plugin.apply(ctx) } finally { console.error = origErr }

  return { src, plugin, sectionComp, ctx, applyErrors, localeDicts, localeNs, ...stubs }
}

/** 读取宿主真实设置（存在则用，不存在给空对象）。
 *  ①(2026-09-21 跨平台轮) 默认档原来写死作者本机 home 下的固定路径 ⇒ 换个人/换台机器（Windows
 *  根本没有 /root）就读成恒空夹具，且属于"写死宿主绝对路径"。改成按 os.homedir() 推导，
 *  本机（root）取值一字未变。 */
export function readSection(file) {
  try { const f = file || path.join(os.homedir(), '.dsh', '.dsh-mpkg-wallpaper', 'settings.json'); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
  return {}
}

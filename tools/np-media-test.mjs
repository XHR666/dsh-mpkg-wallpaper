#!/usr/bin/env node
/**
 * np-media-test.mjs —— 「Now playing / 壁纸声音」接线的**无浏览器**门禁（①(NP-3)）
 *
 * 为什么单独一个文件：`tools/now-playing-test.mjs` 管的是**组件与挂载点**（生成区/顺序/收起/单实例/
 * 产物 CSS 纯增量），本文件管**声音接线**（数据源判定 / 音轨清单路由 / 播放落点 / 静音落点 /
 * 让位）。两者都用真代码：本文件把 `lib/client.js` 用 `tools/_stub.mjs` 真加载并 apply，
 * 驱动的是**同一批函数**（`lib/client.js` 里的 `__mpwNpTest` 钩子暴露的就是生产实现本身）。
 *
 * 覆盖的真机 bug（docs/NOW-PLAYING-DSH.md §7.7）：
 *   ① video 类壁纸音频不能播（`video.muted` 硬编码 true、静音设置从不落到元素）
 *   ② web 类壁纸目录里自带的音频没接到控件（清单 URL 拼错：自定义目录壁纸没有 folderName）
 *   ③ 上一首/下一首语义（按清单顺序，不是"回到开头"/跳上跳下）
 *   ④/⑤ 播放标记要说的是**播放状态**，不是"展开进度"
 *   ⑥ 声音控制打不开（静音只写设置、不落元素）
 *   ⑦ 传输键不重载壁纸（不碰 iframe src / video src）
 *   ⑨ 让位：宿主同一位置已有别的插件的元素 ⇒ 不挂/撤下且不重建（`data-mpw-np-yield`）
 *
 * 用法：
 *   node tools/np-media-test.mjs                    # 全部（含变异自证）
 *   node tools/np-media-test.mjs --no-mutations      # 只跑主体
 *   node tools/np-media-test.mjs --client <path> --np <path>   # 变异用（副本）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const npPath = path.resolve(argOf('--np', path.join(repoRoot, 'lib', 'now-playing.js')))
const NO_MUT = process.argv.includes('--no-mutations')

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  — ' + detail : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-np-media-'))
const cleanup = () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }

/* ══════════════ 载入两个真模块 ══════════════ */
const clientSrc = fs.readFileSync(clientPath, 'utf8')
const npSrc = fs.readFileSync(npPath, 'utf8')
/** CJS 风格的源（lib/*.js 都是）在 ESM 里用 module/exports 包一层跑 —— 与 tools/_stub.mjs 同路。 */
function loadCjsSource(src, label) {
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, () => ({}))
  const keys = Object.keys(m.exports || {})
  if (!keys.length) throw new Error(label + ' 的导出为空（CJS/ESM 加载方式错了）')
  return m.exports
}
const NP = loadCjsSource(npSrc, 'lib/now-playing.js')
const { installStubs, loadPlugin } = await import('./_stub.mjs')

/* ══════════════ 桩 DOM：侧栏 + 媒体元素（只实现这一轮真正用到的语义） ══════════════ */
function buildSidebar(doc, opts) {
  const o = opts || {}
  const col = doc.createElement('div')
  col.className = 'pI_x6G_sidebarCol'
  col.getBoundingClientRect = () => ({ x: 0, y: 0, width: o.width === undefined ? 280 : o.width, height: 900, top: 0, left: 0, right: o.width || 280, bottom: 900 })
  doc.body.appendChild(col)
  const root = col.appendChild(doc.createElement('div'))
  root.className = 'hHd-Xa_root'
  root.setAttribute('data-mpw-sidebar-root', '')
  const foot = root.appendChild(doc.createElement('div'))
  foot.className = 'hHd-Xa_footArea'
  const actions = foot.appendChild(doc.createElement('div'))
  actions.className = 'hHd-Xa_footerActions'
  const outlet = actions.appendChild(doc.createElement('div'))
  outlet.setAttribute('data-slot', 'sidebar.footer.action')
  const settingsArea = foot.appendChild(doc.createElement('div'))
  settingsArea.className = 'hHd-Xa_settingsArea'
  const settingsOutlet = settingsArea.appendChild(doc.createElement('div'))
  settingsOutlet.setAttribute('data-slot', 'sidebar.settings')
  return { col, root, foot, actions, outlet, settingsArea, settingsOutlet }
}
function makeWin() {
  const counts = { resize: 0, mutation: 0, raf: 0, liveResize: 0, liveMutation: 0 }
  const resizeCbs = [], mutCbs = [], mutOpts = [], logs = []
  const win = {
    __counts: counts, __resizeCbs: resizeCbs, __mutCbs: mutCbs, __mutOpts: mutOpts,
    ResizeObserver: class { constructor(cb) { counts.resize++; counts.liveResize++; resizeCbs.push(cb) } observe() {} disconnect() { counts.liveResize-- } },
    MutationObserver: class { constructor(cb) { counts.mutation++; counts.liveMutation++; mutCbs.push(cb) } observe(t, o) { mutOpts.push(o || {}) } disconnect() { counts.liveMutation-- } },
    requestAnimationFrame: (f) => { counts.raf++; return setTimeout(() => f(Date.now()), 0) },
    cancelAnimationFrame: () => {},
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (h) => clearTimeout(h),
    performance: { now: () => Date.now() },
  }
  win.__log = { info: (...a) => logs.push(['info', a.join(' ')]), warn: (...a) => logs.push(['warn', a.join(' ')]), error: (...a) => logs.push(['error', a.join(' ')]) }
  win.__logs = logs
  return win
}
/** E/F 组要**真**的选择器（控制器的 resolveAnchor 全靠 querySelector）：
 *  `_stub.mjs` 的 querySelector 恒 null ⇒ 挂载判据会假红。这里实现这一轮用到的那一小撮语义：
 *  tag / [attr] / [attr="v"] / [class*="x"] / 后代组合（空格）。 */
function matchCompound(el, c) {
  if (!el || el.nodeType !== 1) return false
  const m = String(c).match(/^([a-zA-Z][\w-]*)?((?:\[[^\]]*\])*)$/)
  if (!m) return false
  if (m[1] && String(el.tagName || '').toLowerCase() !== m[1].toLowerCase()) return false
  const attrs = m[2] ? (m[2].match(/\[[^\]]*\]/g) || []) : []
  for (const a of attrs) {
    const body = a.slice(1, -1)
    const eq = body.indexOf('=')
    if (eq < 0) { if (!el.hasAttribute(body)) return false; continue }
    const name = body.slice(0, eq)
    const raw = body.slice(eq + 1).replace(/^["']|["']$/g, '')
    if (name.endsWith('*')) { if (String(el.getAttribute(name.slice(0, -1)) || '').indexOf(raw) < 0) return false }
    else if (String(el.getAttribute(name) || '') !== raw) return false
  }
  return true
}
function matchesSel(el, sel) {
  const parts = String(sel).trim().split(/\s+/)
  if (parts.length > 1) {
    let node = el && el.parentNode
    for (let i = parts.length - 2; i >= 0; i--) {
      while (node && !matchCompound(node, parts[i])) node = node.parentNode
      if (!node) return false
      node = node.parentNode
    }
  }
  return matchCompound(el, parts[parts.length - 1])
}
function walkEl(el, fn) { fn(el); for (const c of (el.childNodes || []).slice()) walkEl(c, fn) }
function makeSelDoc() {
  const mk = (tag) => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), nodeType: 1, className: '', textContent: '', isConnected: true,
      childNodes: [], parentNode: null, __attrs: new Map(), __w: 300,
      style: { _m: new Map(), display: '', setProperty(k, v) { this._m.set(String(k), String(v)) }, removeProperty(k) { this._m.delete(String(k)) }, getPropertyValue(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : '' } },
      get children() { return this.childNodes },
      get firstChild() { return this.childNodes[0] || null },
      get parentElement() { return this.parentNode },
      get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i >= 0 ? (p.childNodes[i + 1] || null) : null },
      setAttribute(k, v) { this.__attrs.set(String(k), v === undefined || v === null ? '' : String(v)); if (String(k) === 'class') this.className = String(v) },
      getAttribute(k) { const q = String(k); return this.__attrs.has(q) ? this.__attrs.get(q) : null },
      removeAttribute(k) { this.__attrs.delete(String(k)) },
      hasAttribute(k) { return this.__attrs.has(String(k)) },
      appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c },
      insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); return c },
      removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null } return c },
      remove() { if (this.parentNode) this.parentNode.removeChild(this) },
      getBoundingClientRect() { const h = this.__h === undefined ? 200 : this.__h; return { x: 0, y: 0, width: this.__w, height: h, top: 0, left: 0, right: this.__w, bottom: h } },
      closest(sel) { let n = this; while (n) { if (matchesSel(n, sel)) return n; n = n.parentNode } return null },
      matches(sel) { return matchesSel(this, sel) },
      querySelectorAll(sel) { const out = []; for (const c of this.childNodes) walkEl(c, (n) => { if (matchesSel(n, sel)) out.push(n) }); return out },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null },
    }
    return el
  }
  const doc = { createElement: mk }
  doc.documentElement = mk('html')
  doc.body = doc.documentElement.appendChild(mk('body'))
  doc.querySelector = (s) => doc.documentElement.querySelector(s)
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s)
  return doc
}
/** E/F 组的侧栏（与真机结构同形，字段名来自宿主源码 + 真机 DOM）。 */
function buildSelSidebar(doc, opts) {
  const o = opts || {}
  const col = doc.createElement('div'); col.className = 'pI_x6G_sidebarCol'; col.__w = o.width === undefined ? 280 : o.width
  doc.body.appendChild(col)
  const root = col.appendChild(doc.createElement('div')); root.className = 'hHd-Xa_root'; root.setAttribute('data-mpw-sidebar-root', '')
  const foot = root.appendChild(doc.createElement('div')); foot.className = 'hHd-Xa_footArea'
  const actions = foot.appendChild(doc.createElement('div')); actions.className = 'hHd-Xa_footerActions'
  const outlet = actions.appendChild(doc.createElement('div')); outlet.setAttribute('data-slot', 'sidebar.footer.action')
  const slot = outlet.appendChild(doc.createElement('div')); slot.className = 'mpw_np_slot'; slot.setAttribute('data-mpw-np-slot', '')
  const settingsArea = foot.appendChild(doc.createElement('div')); settingsArea.className = 'hHd-Xa_settingsArea'
  const settingsOutlet = settingsArea.appendChild(doc.createElement('div')); settingsOutlet.setAttribute('data-slot', 'sidebar.settings')
  return { col, root, foot, actions, outlet, settingsArea, settingsOutlet }
}
const stubReact = { createElement: (type, props, ...kids) => ({ __el: true, type, props: props || {}, kids }) }
/** 造一个 NP 控制器（用真 lib/now-playing.js）。 */
function makeCtl(doc, win, opts) {
  const o = opts || {}
  const mod = NP.createNowPlaying({
    math: loadCjsSource(fs.readFileSync(path.join(repoRoot, 'lib', 'now-playing-math.js'), 'utf8'), 'math'),
    react: stubReact, t: (k) => k, doc, win, log: win.__log,
    createRoot: () => ({ render: () => {}, unmount: () => {} }),
    onTransport: o.onTransport || (() => {}),
  })
  return { mod, ctl: mod.createController() }
}
/** 浅渲染出一棵 element 树 → 找带某 aria-label 的节点。 */
function findByProps(node, pred, out) {
  out = out || []
  if (!node || typeof node !== 'object') return out
  if (node.props && pred(node.props, node)) out.push(node)
  for (const k of (node.kids || [])) findByProps(k, pred, out)
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ══════════════ 每个用例一份干净的桩环境（真 client.js + 真 apply） ══════════════ */
/* client.js 首个语句是 `if (globalThis.__mpwClientLoaded) return …`（防重复注册）⇒ 每个用例
   都要把它与几处"一次性接线"旗标清掉，否则第二次 loadPlugin 会抛"未注册"（既有门禁同一口径）。 */
const SESS_GUARDS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwSectionTest', '__mpwNpTest',
  '__mpwPowerWired', '__mpwNpOwnsSound', '__mpwErrHook', '__mpwSandboxCapHook', '__mpwLnGuard', '__mpwWebShimHook',
  '__mpwNowPlaying', '__mpwNowPlayingSlotAction', '__mpwNpCtlSeq',
  /* `apply()` 自己也有幂等守卫（宿主可能对两个 module id 各 apply 一次）：
     不清它，同一个进程里第二次 loadPlugin 的 apply 会被整个忽略（H 组立刻假红）。 */
  '__mpwAppliedOnce']
function clearSessionGuards() { for (const k of SESS_GUARDS) { try { delete globalThis[k] } catch { /* ignore */ } } }

function freshPlugin(opts = {}) {
  clearSessionGuards()
  /* ⚠ 这里**不能**自己先 installStubs：`loadPlugin()` 内部会再装一份**新的**桩环境，
     插件真正读到的是那一份 —— 先装的话，我们造的媒体元素在插件的 document 里根本不存在
     （`getElementById('mpw-bgVideo')` → null ⇒ npActiveVideo 恒假，整组断言假红）。
     所以顺序是：loadPlugin → 在**它的** doc 上造元素 → 走真 apply 路径（__mpwNpTest.apply）。 */
  const loaded = loadPlugin({ clientPath, settings: opts.settings || {}, quiet: true, fetch: opts.fetch })
  const doc = loaded.doc
  const stubs = loaded
  const bar = buildSidebar(doc, { width: opts.width || 280 })
  /* 媒体元素：真代码只用 getElementById('mpw-bgWrap'/'mpw-bgVideo') + wrap.querySelector('iframe.mpw-webFrame') */
  const wrap = doc.createElement('div'); wrap.id = 'mpw-bgWrap'
  const video = doc.createElement('video'); video.id = 'mpw-bgVideo'
  video.__attrs.set('class', 'mpw-bgVideo')
  video.style = { display: 'none', setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }
  video.paused = true; video.muted = true; video.volume = 1; video.duration = NaN; video.currentTime = 0
  video.__plays = 0; video.__pauses = 0
  video.play = () => { video.__plays++; video.paused = false; return { catch() {} } }
  video.pause = () => { video.__pauses++; video.paused = true }
  const frame = doc.createElement('iframe')
  frame.className = 'mpw-webFrame'
  frame.muted = true
  const innerAudio = doc.createElement('audio'); innerAudio.muted = true
  const frameDoc = { querySelectorAll: (sel) => (String(sel).indexOf('audio') >= 0 ? [innerAudio] : []) }
  frame.contentDocument = frameDoc
  frame.querySelector = () => null
  wrap.querySelector = (sel) => (String(sel).indexOf('iframe') >= 0 ? frame : null)
  wrap.appendChild(video); wrap.appendChild(frame)
  doc.body.appendChild(wrap)
  /* 真代码造的 <audio>（我们自己的播放器）也必须有媒体语义 */
  const realCreate = doc.createElement
  const audios = []
  doc.createElement = (t) => {
    const el = realCreate(t)
    if (String(t).toLowerCase() === 'audio') {
      el.paused = true; el.muted = false; el.volume = 1; el.currentTime = 0; el.duration = NaN; el.readyState = 0
      el.__plays = 0; el.__pauses = 0
      el.play = () => { el.__plays++; el.paused = false; return { catch() {} } }
      el.pause = () => { el.__pauses++; el.paused = true }
      audios.push(el)
    }
    return el
  }
  const T = globalThis.__mpwNpTest
  /* 走真 apply 路径（等价于宿主 applyFromStorageInner 里那一次 applyNowPlaying）：
     这样"切壁纸/改设置之后控件状态会不会跟着变"也是真代码跑的。 */
  /* noApply：H 组专用 —— 要验的正是"**插件自己的 apply 路径**有没有走到 NP"，
     我们自己再补一次 apply 会把结论掩盖掉（变异就打不红了）。 */
  if (!opts.noApply) { try { if (T && T.apply) T.apply(opts.settings || {}) } catch (e) { /* 用例自己会断言 */ } }
  return { stubs, doc, win: globalThis, bar, wrap, video, frame, innerAudio, audios, loaded, T }
}
/** 桩 fetch 的应答是微任务 ⇒ 先让它落地，再放夹具（否则夹具会被"清单 404"的回调覆盖）。 */
async function settle() { await sleep(20) }
const SEC_VIDEO = { image: 'host:?custom=1&folder=3582362359&file=Mid-Autumn%20Hoshino.mp4', converted: 'mp4', mpkgKey: 'custom|3582362359', mpkgName: 'Hoshino', npNowPlaying: true, mute: true, enabled: true }
const SEC_WEB = { webUrl: 'host:?custom=1&folder=3646392375&file=index.html&shim=1', converted: 'web', mpkgKey: 'custom|3646392375', mpkgName: 'Columbina', npNowPlaying: true, mute: true, enabled: true, image: '' }
const TRACKS6 = [
  { path: '1-1.wav.ogg', size: 66741, mime: 'audio/mpeg' }, { path: '2.wav.ogg', size: 79222, mime: 'audio/mpeg' },
  { path: '3.wav.ogg', size: 57526, mime: 'audio/mpeg' }, { path: '4.wav.ogg', size: 48886, mime: 'audio/mpeg' },
  { path: '5.wav.ogg', size: 79414, mime: 'audio/mpeg' }, { path: 'BGM.wav', size: 2461988, mime: 'audio/mpeg' },
]

/* ══════════════ A. 音轨清单作用域（纯函数：真机 bug②的根因就在这里） ══════════════ */
console.log('\n== A. npAudioScope / 两条宿主路由：壁纸目录到底在哪（自定义目录的壁纸没有 folderName）==')
{
  const F = freshPlugin()
  const T = F.T
  const S = (o) => T.scope(o)
  ok('A1 folderName（插件自己的库/老形态）⇒ custom 目录', (() => { const s = S({ folderName: 'abc' }); return s && s.mode === 'custom' && s.folder === 'abc' && s.src === 'folderName' })(), JSON.stringify(S({ folderName: 'abc' })))
  ok('A2 mpkgKey="custom|<folder>"（**真机 web 壁纸的形态**）⇒ custom 目录', (() => { const s = S({ mpkgKey: 'custom|3646392375' }); return s && s.mode === 'custom' && s.folder === '3646392375' && s.src === 'mpkgKey' })(), JSON.stringify(S({ mpkgKey: 'custom|3646392375' })))
  ok('A3 mpkgKey="library|<ltoken>"（插件库）⇒ library', (() => { const s = S({ mpkgKey: 'library|tok123' }); return s && s.mode === 'library' && s.ltoken === 'tok123' })(), JSON.stringify(S({ mpkgKey: 'library|tok123' })))
  ok('A4 mpkgKey="custommpkg|<folder>/<file>"（自定义目录里的 mpkg）⇒ custom 目录', (() => { const s = S({ mpkgKey: 'custommpkg|777/x.mpkg' }); return s && s.mode === 'custom' && s.folder === '777' })(), JSON.stringify(S({ mpkgKey: 'custommpkg|777/x.mpkg' })))
  ok('A5 webUrl="host:?custom=1&folder=X&file=.."（无 mpkgKey 时）⇒ custom 目录', (() => { const s = S({ webUrl: 'host:?custom=1&folder=3650880224&file=index.html' }); return s && s.mode === 'custom' && s.folder === '3650880224' && s.src === 'webUrl' })(), JSON.stringify(S({ webUrl: 'host:?custom=1&folder=3650880224&file=index.html' })))
  ok('A6 image="host:?ltoken=Y&file=.."（插件库的视频壁纸）⇒ library', (() => { const s = S({ image: 'host:?ltoken=lt9&file=a.mp4' }); return s && s.mode === 'library' && s.ltoken === 'lt9' })(), JSON.stringify(S({ image: 'host:?ltoken=lt9&file=a.mp4' })))
  ok('A7 一点线索都没有 ⇒ null（不瞎猜目录）', S({ image: 'data:image/png;base64,AAA' }) === null, JSON.stringify(S({ image: 'data:image/png;base64,AAA' })))
  ok('A8 scanUrl：custom ⇒ /custom-scene-audio?refs=0&folder=<编码>', T.scanUrl({ mpkgKey: 'custom|3646392375' }) === '/api/mpkg-wallpaper/custom-scene-audio?refs=0&folder=3646392375', T.scanUrl({ mpkgKey: 'custom|3646392375' }))
  ok('A8b scanUrl：library ⇒ /library-scene-audio?refs=0&ltoken=<编码>', T.scanUrl({ mpkgKey: 'library|a b' }) === '/api/mpkg-wallpaper/library-scene-audio?refs=0&ltoken=a%20b', T.scanUrl({ mpkgKey: 'library|a b' }))
  /* ①(NP-4 2026-09-19 真机修复) A9 收紧成**两条**（这条断言只增不减：原来那条的"单段路径
     ⇒ /raw?file=<basename>"原样保留在 A9a，新增 A9a2/A9a3 判"有子目录时必须走 path 式前缀路由"）。
     为什么必须改：旧写法无条件取 basename ⇒ 音轨在子目录里时恒 404（真机：`3744579963` 的
     10 条音轨全在 `assets/audio/`，`raw?...&file=CH0200_…ogg` 实测 **404**；而
     `custom-folder/3744579963/assets/audio/CH0200_…ogg` 实测 **200 / audio/ogg**）
     ⇒ "上一首/下一首"看着在切、其实一条都放不出来。 */
  ok('A9a trackUrl：custom **单段**路径 ⇒ /raw?custom=1&folder=&file=（与改动前逐字节相同）',
    T.trackUrl({ mpkgKey: 'custom|3646392375' }, 'backgroundmuisc.mp3') === '/api/mpkg-wallpaper/raw?custom=1&folder=3646392375&file=backgroundmuisc.mp3',
    T.trackUrl({ mpkgKey: 'custom|3646392375' }, 'backgroundmuisc.mp3'))
  /* 归一化那一步的判据：`sub/../x.mp3` 丢掉 `..` 之后是 **2 段**（`sub/x.mp3`）⇒ 走 path 式路由，
     而且产物里不许出现 `..`（A9a3 是这条的完整版）。 */
  ok('A9a1 trackUrl：`sub/../x.mp3` 归一化成 `sub/x.mp3`（丢 `..` 段）⇒ path 式、产物无 `..`',
    (() => { const u = T.trackUrl({ mpkgKey: 'custom|3646392375' }, 'sub/../backgroundmuisc.mp3'); return u === '/api/mpkg-wallpaper/custom-folder/3646392375/sub/backgroundmuisc.mp3' && u.indexOf('..') < 0 })(),
    T.trackUrl({ mpkgKey: 'custom|3646392375' }, 'sub/../backgroundmuisc.mp3'))
  ok('A9a2 trackUrl：custom **有子目录** ⇒ path 式 /custom-folder/<folder>/<逐段编码>（真机 200 的那条）',
    T.trackUrl({ mpkgKey: 'custom|3744579963' }, 'assets/audio/CH0200_MemorialLobby_1_1.ogg') === '/api/mpkg-wallpaper/custom-folder/3744579963/assets/audio/CH0200_MemorialLobby_1_1.ogg',
    T.trackUrl({ mpkgKey: 'custom|3744579963' }, 'assets/audio/CH0200_MemorialLobby_1_1.ogg'))
  /* 防穿越的另一半：`.` / `..` 段必须被**丢掉**（丢掉之后要么退化成单段走 /raw，要么整段被
     过滤到只剩文件名），任何一个 `..` 都不许出现在产物 URL 里 —— 这是 A9 原来那条的意图。 */
  {
    const cases = ['assets/../../etc/passwd', 'a/./b/x.ogg', '..\\..\\x.ogg', 'assets/audio/x.ogg', 'sounds/中文 名.mp3']
    const urls = cases.map((c) => T.trackUrl({ mpkgKey: 'custom|3744579963' }, c))
    const noDotDot = urls.every((u) => u.indexOf('..') < 0 && u.indexOf('./') < 0 && u.indexOf('\\') < 0)
    const encoded = urls.every((u) => !/[^\x00-\x7f]/.test(u))
    ok('A9a3 trackUrl 防穿越：`.`/`..` 段被丢掉、反斜杠不进 URL、非 ASCII 逐段编码', noDotDot && encoded,
      JSON.stringify(cases.map((c, i) => c + ' → ' + urls[i])))
  }
  ok('A9a4 trackUrl：包内音轨（source=pkg，文件在 scene.pkg 里）⇒ **空串**（宿主没有字节通道 ⇒ 调用方标"只列清单"）',
    T.trackUrl({ mpkgKey: 'custom|3719111841' }, 'sounds/x.mp3', 'pkg') === '', JSON.stringify(T.trackUrl({ mpkgKey: 'custom|3719111841' }, 'sounds/x.mp3', 'pkg')))
  ok('A9b trackUrl：library **单段** ⇒ /raw?ltoken=&file=（同改动前）', T.trackUrl({ mpkgKey: 'library|tok1' }, 'BGM.wav') === '/api/mpkg-wallpaper/raw?ltoken=tok1&file=BGM.wav', T.trackUrl({ mpkgKey: 'library|tok1' }, 'BGM.wav'))
  ok('A9b2 trackUrl：library **有子目录** ⇒ /library-web/<ltoken>/<逐段编码>（prefix 路由同样支持嵌套）',
    T.trackUrl({ mpkgKey: 'library|tok1' }, 'assets/a/b.ogg') === '/api/mpkg-wallpaper/library-web/tok1/assets/a/b.ogg',
    T.trackUrl({ mpkgKey: 'library|tok1' }, 'assets/a/b.ogg'))
  ok('A10 真机那一串（用户现场）：web 壁纸的 scanUrl 是 custom 路由，不是 library（旧写法拼成 library ⇒ 404 ⇒ 恒 0 条）',
    T.scanUrl(SEC_WEB).indexOf('/custom-scene-audio?refs=0&folder=3646392375') > 0, T.scanUrl(SEC_WEB))
}

/* ══════════════ B. 数据源判定（谁在放 / 有没有音轨） ══════════════ */
console.log('\n== B. npResolveMedia：只有**当前真的在放**的那个媒体才算源；没音轨就如实显示 ==')
{
  /* B1/B2：页面里那个空壳 video（display:none、无 src）在 web 壁纸下**不算**源 */
  const F = freshPlugin({ settings: SEC_WEB })
  await settle()
  F.T.seedTracks(undefined, [])       /* 清单为空：web 壁纸只提供静音 */
  const webEmpty = F.T.resolve(SEC_WEB)
  ok('B1 隐藏空壳 video（无 src/display:none）+ web 壁纸 ⇒ 不判成 video（真机 bug 4/5/6 的同一根因）',
    webEmpty.kind === 'web' && webEmpty.canPlay === false && webEmpty.canVolume === true,
    JSON.stringify({ kind: webEmpty.kind, canPlay: webEmpty.canPlay, canVolume: webEmpty.canVolume, byline: webEmpty.byline }))
  /* 真的在放的视频壁纸 ⇒ video 源 */
  F.video.style.display = ''
  F.video.setAttribute('src', SEC_VIDEO.image)
  F.video.paused = false
  F.video.mozHasAudio = true
  const vid = F.T.resolve(SEC_VIDEO)
  ok('B2 真的在放的视频壁纸（display 非 none + 有 src + converted=mp4）⇒ kind=video、canPlay/canVolume=true',
    vid.kind === 'video' && vid.canPlay === true && vid.canVolume === true && vid.playing === true,
    JSON.stringify({ kind: vid.kind, canPlay: vid.canPlay, canVolume: vid.canVolume, playing: vid.playing, hasAudio: vid.hasAudio }))
  ok('B2b 单个视频没有曲目清单 ⇒ canPrev/canNext=false（不假装有上一首/下一首）', vid.canPrev === false && vid.canNext === false, JSON.stringify({ prev: vid.canPrev, next: vid.canNext }))
  /* 明确无音轨 ⇒ 如实显示 + 静音键禁用 */
  F.video.mozHasAudio = false
  const noAud = F.T.resolve(SEC_VIDEO)
  ok('B3 浏览器明确说"这个视频没有音轨"（mozHasAudio=false）⇒ 副标题=无音轨说明 + 静音键禁用（如实，不假装能出声）',
    noAud.hasAudio === false && noAud.canVolume === false && /noAudio/.test(String(noAud.byline)),
    JSON.stringify({ hasAudio: noAud.hasAudio, canVolume: noAud.canVolume, byline: noAud.byline }))
  ok('B3b 有音轨（mozHasAudio=true）⇒ 静音键可用', (() => { F.video.mozHasAudio = true; const m = F.T.resolve(SEC_VIDEO); return m.hasAudio === true && m.canVolume === true })(), '')
  ok('B3c 浏览器**判断不了**（没有 mozHasAudio/audioTracks）⇒ hasAudio=null、静音键仍可用（不知道就不禁用）',
    (() => { delete F.video.mozHasAudio; const m = F.T.resolve(SEC_VIDEO); return m.hasAudio === null && m.canVolume === true })(), '')

  /* B5/B7：目录里有音轨清单 ⇒ kind=track（web 壁纸目录自带音频被接到控件） */
  const F2 = freshPlugin({ settings: SEC_WEB })
  await settle()
  F2.T.seedTracks(undefined, [{ path: 'backgroundmuisc.mp3', size: 1665645, mime: 'audio/mpeg' }])
  const one = F2.T.resolve(SEC_WEB)
  ok('B5 web 壁纸目录里那 1 条音轨 ⇒ kind=track、canPlay=true、曲名=文件名（真机 bug②：以前这条根本不接）',
    one.kind === 'track' && one.canPlay === true && one.title === 'backgroundmuisc.mp3',
    JSON.stringify({ kind: one.kind, title: one.title, byline: one.byline, canPlay: one.canPlay }))
  ok('B5b 只有一条 ⇒ canPrev/canNext=false（清单顺序语义：一条没有上下首）', one.canPrev === false && one.canNext === false, '')
  const F3 = freshPlugin({ settings: { ...SEC_WEB, mpkgKey: 'custom|3580207945' } })
  await settle()
  F3.T.seedTracks({ mpkgKey: 'custom|3580207945' }, TRACKS6)
  const six = F3.T.resolve({ ...SEC_WEB, mpkgKey: 'custom|3580207945' })
  ok('B7 6 条清单 ⇒ kind=track、canPrev/canNext=true、副标题带 1/6 序号',
    six.kind === 'track' && six.canPrev === true && six.canNext === true && /1\/6/.test(String(six.byline)),
    JSON.stringify({ title: six.title, byline: six.byline, prev: six.canPrev, next: six.canNext }))
  ok('B8 封面只取**浏览器真能用**的 URL：host: 伪 URL 不当封面（塞进 CSS 只会是加载失败的 background）',
    (() => { const m = F3.T.resolve({ ...SEC_VIDEO, image: 'host:?custom=1&folder=1&file=p.jpg' }); return m.cover === '' })(),
    'host: ⇒ cover=' + JSON.stringify(F3.T.resolve({ ...SEC_VIDEO, image: 'host:?custom=1&folder=1&file=p.jpg' }).cover))
  ok('B8b data:/http 封面照旧直接可用（零行为变化）',
    (() => { const a = F3.T.resolve({ ...SEC_VIDEO, image: 'data:image/png;base64,AAA' }); const b = F3.T.resolve({ ...SEC_VIDEO, image: 'https://x/y.jpg' }); return /^data:/.test(a.cover) && /^https:/.test(b.cover) })(), '')
}

/* ══════════════ C. 播放/换曲的落点（不碰壁纸） ══════════════ */
console.log('\n== C. 传输动作的落点：真实媒体 + 按清单顺序 + 不碰壁纸 ==')
{
  const SEC6 = { ...SEC_WEB, mpkgKey: 'custom|3580207945', webUrl: 'host:?custom=1&folder=3580207945&file=index.html&shim=1' }
  const F = freshPlugin({ settings: SEC6 })
  await settle()
  F.T.seedTracks(SEC6, TRACKS6)
  const frameSrc0 = F.frame.getAttribute('src')
  const vidSrc0 = F.video.getAttribute('src')
  F.T.load(0)
  const a = F.T.audio()
  ok('C1 清单到位后装源：src = 清单第 1 条的 /raw URL（只装源，不自动播放）',
    !!a && /file=1-1\.wav\.ogg/.test(String(a.getAttribute('src') || '')) && a.paused === true,
    a ? String(a.getAttribute('src')) : 'no audio')
  F.T.transport('play', SEC6)
  ok('C1b transport("play") ⇒ 真调 audio.play()（不是"点了没反应"）', !!a && a.__plays >= 1, 'plays=' + (a && a.__plays))
  F.T.transport('next', SEC6)
  const afterNext = F.T.audio()
  ok('C2 下一首 ⇒ 清单第 2 条（**按清单顺序**推进，不是跳上跳下）', /file=2\.wav\.ogg/.test(String(afterNext.getAttribute('src') || '')), String(afterNext.getAttribute('src')))
  F.T.transport('next', SEC6); F.T.transport('next', SEC6)
  ok('C2b 连点下一首 ⇒ 依次第 3/第 4 条（顺序严格 +1）', /file=4\.wav\.ogg/.test(String(F.T.audio().getAttribute('src') || '')), String(F.T.audio().getAttribute('src')))
  F.T.transport('prev', SEC6)
  ok('C3 上一首 ⇒ 回退到第 3 条（-1，不是"回到开头"）', /file=3\.wav\.ogg/.test(String(F.T.audio().getAttribute('src') || '')), String(F.T.audio().getAttribute('src')))
  F.T.load(0); F.T.transport('prev', SEC6)
  ok('C3b 第 1 条再上一首 ⇒ 环形回清单最后一条', /file=BGM\.wav/.test(String(F.T.audio().getAttribute('src') || '')), String(F.T.audio().getAttribute('src')))
  ok('C4 全程没碰壁纸：iframe src 与壁纸 video 的 src 一个字节都没变（判据=不 remount）',
    F.frame.getAttribute('src') === frameSrc0 && F.video.getAttribute('src') === vidSrc0,
    JSON.stringify({ frame: [frameSrc0, F.frame.getAttribute('src')], video: [vidSrc0, F.video.getAttribute('src')] }))
  /* 单条清单：next/prev 不动（不假装有第二首） */
  const F2 = freshPlugin({ settings: SEC_WEB })
  await settle()
  F2.T.seedTracks(SEC_WEB, [{ path: 'backgroundmuisc.mp3', size: 1665645, mime: 'audio/mpeg' }])
  F2.T.load(0)
  const srcBefore = String(F2.T.audio().getAttribute('src') || '')
  F2.T.transport('next', SEC_WEB)
  ok('C5 只有 1 条 ⇒ next/prev 不动 src（控制器那边也会把键 disabled）', String(F2.T.audio().getAttribute('src') || '') === srcBefore, srcBefore)
  /* 视频壁纸：play/pause 落到 video，且**不**碰我们的 audio */
  const F3 = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  F3.video.style.display = ''
  F3.video.setAttribute('src', SEC_VIDEO.image)
  F3.video.paused = true
  F3.T.transport('play', SEC_VIDEO)
  ok('C6 视频壁纸：play ⇒ video.play()（此前 play 落在空壳 video 上，用户看到"点了没用"）', F3.video.__plays >= 1 && F3.video.paused === false, 'plays=' + F3.video.__plays + ' paused=' + F3.video.paused)
  F3.T.transport('pause', SEC_VIDEO)
  ok('C6b 视频壁纸：pause ⇒ video.pause()', F3.video.__pauses >= 1 && F3.video.paused === true, 'pauses=' + F3.video.__pauses)
}

/* ══════════════ D. 静音：写设置 **并且** 落到真实元素 ══════════════ */
console.log('\n== D. 静音落点：设置项 + video/audio/帧内元素（真机 bug⑥"声音控制打不开、一直静音"）==')
{
  const F = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  F.video.style.display = ''
  F.video.setAttribute('src', SEC_VIDEO.image)
  F.video.muted = true
  F.T.transport('mute', SEC_VIDEO)
  await sleep(30)
  const sec = JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}')
  ok('D1 点一次静音键 ⇒ 设置项 mute 落成 false（旧写法也做得到）', sec.mute === false, 'mute=' + sec.mute)
  /* ⚠ 语义变更（2026-09-20，NP-5/C4，见 docs/WALLPAPER-LIFECYCLE.md §8.5/§8.6）：
     旧口径 = "点一次静音键 ⇒ 元素立刻按设置变可听"；
     现在多一道**浏览器策略契约**：**首次用户手势之前一律 muted**（否则就是"加载后若干秒自己从 muted
     翻成可听"，真机 48/48 拍的可听播放就是这么来的）。
     `transport('mute')` 是卡片上的**显式用户操作** ⇒ 它自己会解除那道闸（`npGestureUnlock('card')`），
     所以 D1b 应当仍然成立；同时补一条"手势前不许自己变可听"的反向判据（D1c）。 */
  /* ①(NP-5/C4) 之后这条判据拆成**两半**（口径见 docs/WALLPAPER-LIFECYCLE.md §8.5）：
     ①卡片上的静音键是"显式用户操作" ⇒ 解除 C4 手势闸、裁决变成"可听"（`wantMuted()===false`）；
     ②把该裁决落到元素上 ⇒ `video.muted` 变 false（旧写法从建 DOM 起写死 true、再没人赋值
       —— 真机 bug①⑥"声音控制打不开、一直静音"的根因）。两半都断言，分辨力不降。 */
  ok('D1b ⇒ 卡片静音键 = 显式用户操作 ⇒ 解除 C4 闸 + 裁决为"可听"（wantMuted=false）',
    F.T.wantMuted() === false, 'wantMuted=' + F.T.wantMuted())
  try { F.T.applyMute() } catch (e) {}
  await sleep(20)
  ok('D1b1 ⇒ 该裁决真的落到元素：video.muted 变 false（旧写法从建 DOM 起写死 true、再没人赋值）',
    F.video.muted === false, 'video.muted=' + F.video.muted)
  ok('D1b2 ⇒ 断言读的就是插件视野里的那个元素（bgElements().video === 夹具元素，防"断言了另一个节点"的假红）',
    (() => { try { return F.T && globalThis.__mpwLifecycleTest && globalThis.__mpwLifecycleTest.video() === F.video } catch (e) { return false } })(),
    'same=' + (globalThis.__mpwLifecycleTest && globalThis.__mpwLifecycleTest.video() === F.video))
  {
    /* D1c：**没有任何用户操作**时，绝不能自己从 muted 翻成可听（C4） */
    const F3 = freshPlugin({ settings: Object.assign({}, SEC_VIDEO, { mute: false }) })
    await settle()
    F3.video.style.display = ''
    F3.video.setAttribute('src', SEC_VIDEO.image)
    F3.video.muted = true
    F3.T.applyMute()
    await sleep(30)
    const gate = globalThis.__mpwLifecycleTest
    ok('D1c 没被用户交互过 ⇒ 即使设置 mute=false 也**保持 muted**（不许"加载后若干秒自己变可听"）',
      F3.video.muted === true && (!gate || gate.gestureSeen() === false), 'video.muted=' + F3.video.muted + ' gestureSeen=' + (gate ? gate.gestureSeen() : 'n/a'))
    if (gate) {
      gate.gestureUnlock('test')
      F3.T.applyMute()
      await sleep(20)
      ok('D1d 手势/卡片操作之后 ⇒ 按设置变可听（闸门不是"永久静音"）', F3.video.muted === false, 'video.muted=' + F3.video.muted)
    }
  }
  /* 我们自己的 audio 也跟设置 */
  const F2 = freshPlugin({ settings: SEC_WEB })
  await settle()
  F2.T.seedTracks(SEC_WEB, [{ path: 'backgroundmuisc.mp3', size: 1665645, mime: 'audio/mpeg' }])
  F2.T.load(0)
  F2.T.transport('mute', SEC_WEB)
  await sleep(30)
  ok('D2 ⇒ 我们自己的 <audio>.muted 也跟设置（true → false）', F2.T.audio().muted === false, 'audio.muted=' + F2.T.audio().muted)
  /* web 帧：设置 + 帧内元素 */
  const F3 = freshPlugin({ settings: SEC_WEB })
  F3.frame.muted = true; F3.innerAudio.muted = true
  F3.T.transport('mute', SEC_WEB)
  await sleep(30)
  ok('D3 ⇒ web 帧 frame.muted=false **且**帧内 audio 元素 muted=false（帧内的声音也归静音键管）',
    F3.frame.muted === false && F3.innerAudio.muted === false,
    JSON.stringify({ frame: F3.frame.muted, inner: F3.innerAudio.muted }))
  /* 我们的播放器在放音时，帧内强制静音（同一首别放两遍） */
  const F4 = freshPlugin({ settings: { ...SEC_WEB, mute: false } })
  await settle()
  F4.T.seedTracks(SEC_WEB, [{ path: 'backgroundmuisc.mp3', size: 1665645, mime: 'audio/mpeg' }])
  F4.T.load(0)
  F4.T.transport('play', SEC_WEB)
  await sleep(30)
  ok('D4 我们的播放器在放音（设置 mute=false）时 ⇒ 帧内**强制静音**（防同一首叠着放两遍），且 ownsSound=true',
    F4.frame.muted === true && F4.T.ownsSound() === true, JSON.stringify({ frame: F4.frame.muted, owns: F4.T.ownsSound() }))
}

/* ══════════════ E. 让位（默认开的配套：不抢别人的位置） ══════════════ */
console.log('\n== E. 让位：槽里已有别的插件的元素 ⇒ 不挂/撤下且不重建（data-mpw-np-yield）==')
{
  /* E1 挂载前占用者 */
  {
    const doc = makeSelDoc()
    const bar = buildSelSidebar(doc)
    const foreign = doc.createElement('div'); foreign.textContent = 'other-plugin'
    bar.outlet.appendChild(foreign)
    const win = makeWin()
    const { ctl } = makeCtl(doc, win)
    ctl.setSlotNode(bar.slot)
    ctl.setEnabled(true)
    const nodes = doc.querySelectorAll('[data-mpw-now-playing]').length
    ok('E1 **挂载前**槽里就有外来 div ⇒ 一个节点都不挂（挂载前判据）', nodes === 0, 'nodes=' + nodes)
    ok('E2 让位状态可查询：data-mpw-np-yield="foreign-occupant"（写在我们的 slot div 上）', (() => {
      const y = doc.querySelectorAll('[data-mpw-np-yield]')[0]
      return !!y && y.getAttribute('data-mpw-np-yield') === 'foreign-occupant'
    })(), 'inspect.yield=' + ctl.inspect().yield)
    ok('E3 让位时留下**一行可读 warn**（不静默）', win.__logs.some((l) => l[0] === 'warn' && /yield to another plugin/.test(l[1])), JSON.stringify(win.__logs.filter((l) => l[0] === 'warn').slice(0, 1)))
    /* 外来元素移走 ⇒ 回来 */
    foreign.remove()
    if (win.__mutCbs[0]) win.__mutCbs[0]()
    await sleep(20)
    const back = doc.querySelectorAll('[data-mpw-now-playing]').length
    ok('E4 外来元素移走 ⇒ 我们回来（让位不是单向的），且 yield 状态清掉', back === 1 && ctl.inspect().yield === null, 'nodes=' + back + ' yield=' + ctl.inspect().yield)
  }
  /* E5 挂载后插入 ⇒ 撤下且不重建 */
  {
    const doc = makeSelDoc()
    const bar = buildSelSidebar(doc)
    const win = makeWin()
    const { ctl } = makeCtl(doc, win)
    ctl.setSlotNode(bar.slot)
    ctl.setEnabled(true)
    ok('E5 干净的槽 ⇒ 正常挂载（1 个）', doc.querySelectorAll('[data-mpw-now-playing]').length === 1, 'nodes=' + doc.querySelectorAll('[data-mpw-now-playing]').length)
    const foreign = doc.createElement('div'); foreign.textContent = 'other-plugin-2'
    bar.outlet.appendChild(foreign)
    if (win.__mutCbs[0]) win.__mutCbs[0]()
    await sleep(20)
    ok('E6 挂载后**外来元素插进来** ⇒ 撤下（0 个）', doc.querySelectorAll('[data-mpw-now-playing]').length === 0, 'nodes=' + doc.querySelectorAll('[data-mpw-now-playing]').length)
    ok('E6b 撤下后留下 yield 状态', ctl.inspect().yield === 'foreign-occupant', 'yield=' + ctl.inspect().yield)
    if (win.__mutCbs[0]) win.__mutCbs[0]()
    ctl.evaluate()
    await sleep(20)
    ok('E7 外来元素还在时**不重建**（再来两拍仍是 0 —— "撤下且不重建"这条就在这里判）', doc.querySelectorAll('[data-mpw-now-playing]').length === 0, 'nodes=' + doc.querySelectorAll('[data-mpw-now-playing]').length)
    ok('E7b 观察者用 subtree 观察侧栏根（否则"别人插进同一个 slot"永远看不到）',
      win.__mutOpts.some((o) => o && o.childList === true && o.subtree === true), JSON.stringify(win.__mutOpts))
  }
  /* E8 不误判：宿主的 slot 出口 / 底部组自有格子 / 空 div 都不算占用者 */
  {
    const doc = makeSelDoc()
    const bar = buildSelSidebar(doc)
    const empty = doc.createElement('div'); empty.__w = 0; empty.__h = 0    /* 空壳：无文字、无子元素、量出来 0×0 */
    bar.outlet.appendChild(empty)
    const win = makeWin()
    const { ctl } = makeCtl(doc, win)
    ctl.setSlotNode(bar.slot)
    ctl.setEnabled(true)
    ok('E8 槽里只有**空 div**（无文字无尺寸）⇒ 不算占用者，我们照挂', doc.querySelectorAll('[data-mpw-now-playing]').length === 1 && ctl.inspect().yield === null,
      'nodes=' + doc.querySelectorAll('[data-mpw-now-playing]').length + ' yield=' + ctl.inspect().yield)
  }
  /* E10/E11 ①(NP-3) 真机 bug（切壁纸后控件再也不出现）：锚点在挂载那一刻还没渲染出来时，
     **不许打一行 warn 就算了** —— 要盯着文档，宿主侧栏一出现就挂上。 */
  {
    const doc = makeSelDoc()
    const win = makeWin()
    const { ctl } = makeCtl(doc, win)
    ctl.setEnabled(true)                       /* 此刻文档里**没有**侧栏 */
    const hasEarly = doc.querySelectorAll('[data-mpw-now-playing]').length
    ok('E10 挂载那一刻宿主侧栏还没渲染 ⇒ 不注入、但**起锚点观察**（inspect().anchorWatch=body）而不是就此放弃',
      hasEarly === 0 && ctl.inspect().observers.anchorWatch === 'body',
      'nodes=' + hasEarly + ' watch=' + ctl.inspect().observers.anchorWatch + ' warn=' + win.__logs.filter((l) => l[0] === 'warn').length)
    const bar2 = buildSelSidebar(doc)          /* 侧栏后出现（真机 t≈1–8s） */
    if (win.__mutCbs[0]) win.__mutCbs[0]()     /* 观察者回调（生产里由 MutationObserver 触发） */
    await sleep(30)
    const after = doc.querySelectorAll('[data-mpw-now-playing]').length
    ok('E11 侧栏后出现 ⇒ 自动挂上（1 个），且观察目标换回侧栏根（不再盯整个文档）',
      after === 1 && ctl.inspect().observers.anchorWatch === 'sidebar-root',
      'nodes=' + after + ' watch=' + ctl.inspect().observers.anchorWatch + ' anchor=' + ctl.inspect().anchorMode)
    void bar2
  }
  /* E9 降级锚点（footArea）：宿主自己的 footerActions/settingsArea 不算占用者 */
  {
    const doc = makeSelDoc()
    const bar = buildSelSidebar(doc)
    const win = makeWin()
    const { ctl } = makeCtl(doc, win)
    ctl.setSlotNode(bar.slot)
    ctl.setEnabled(true)
    ok('E9 降级锚点（footArea）：宿主自己的 footerActions/settingsArea 不算占用者 ⇒ 照挂（不误伤宿主）',
      doc.querySelectorAll('[data-mpw-now-playing]').length === 1 && ctl.inspect().yield === null,
      'nodes=' + doc.querySelectorAll('[data-mpw-now-playing]').length + ' anchor=' + ctl.inspect().anchorMode + ' yield=' + ctl.inspect().yield)
  }
}

/* ══════════════ F. 播放标记（播放状态 vs 展开进度） ══════════════ */
console.log('\n== F. 标记：形状说的是**播放状态**，不是展开进度（真机 bug④⑤的视觉半边）==')
{
  const { mod } = makeCtl(makeSelDoc(), makeWin())
  const pathD = (node) => findByProps(node, (p) => p && p.d).map((n) => String(n.props.d)).join('|')
  const opsOf = (node) => findByProps(node, (p) => p && /(^|\s)mpw_np_op(\s|$)/.test(String(p.className || '')))
  /* 收起态（p=0）：playing=false ⇒ 播放三角；playing=true ⇒ 暂停双条 —— 两者必须不同 */
  const collapsedPaused = pathD(mod.PlayMark({ p: 0, mark: 0, playing: false, size: 14 }))
  const collapsedPlaying = pathD(mod.PlayMark({ p: 0, mark: 1, playing: true, size: 14 }))
  const expandedPaused = pathD(mod.PlayMark({ p: 1, mark: 0, playing: false, size: 18 }))
  const expandedPlaying = pathD(mod.PlayMark({ p: 1, mark: 1, playing: true, size: 18 }))
  ok('F1 收起态(p=0)：暂停 ⇒ 播放三角；播放 ⇒ 暂停双条（**两者不同**；旧写法按 p 画 ⇒ 恒为三角，这一条必红）',
    collapsedPaused !== collapsedPlaying && collapsedPaused.length > 0,
    'paused=' + collapsedPaused.slice(0, 28) + '… playing=' + collapsedPlaying.slice(0, 28) + '…')
  ok('F2 展开态(p=1)：暂停 ⇒ 播放三角（**不是**旧写法的恒暂停双条）',
    expandedPaused !== expandedPlaying && expandedPaused === collapsedPaused,
    'expanded.paused=' + expandedPaused.slice(0, 28) + '… collapsed.paused=' + collapsedPaused.slice(0, 28) + '…')
  ok('F2b 同一个播放状态下，形状**与 p 无关**（p 只管尺寸/位置；旧写法 p=0 与 p=1 的形状正好相反）',
    collapsedPlaying === expandedPlaying, '')
  ok('F2c 不传 mark 时退回 playing（组件单独渲染/旧调用方也不会说谎）',
    pathD(mod.PlayMark({ p: 1, playing: false, size: 18 })) === expandedPaused && pathD(mod.PlayMark({ p: 1, playing: true, size: 18 })) === expandedPlaying, '')
  /* 组件：传输行的四键 + disabled 语义 */
  const media = { kind: 'track', title: 't', byline: 'b', total: 10, playing: false, muted: true, canPlay: true, canVolume: true, canPrev: true, canNext: true }
  const tree = mod.NowPlaying({ p: 1, mark: 0, open: true, playing: false, at: 0, media, note: '', onPrev() {}, onNext() {}, onPlayPause() {}, onVolume() {} })
  const labels = opsOf(tree).map((n) => n.props['aria-label'])
  ok('F3 展开态传输行 = 上一首 / 播放 / 下一首 / 取消静音 四个键（按**语义**不按位置）',
    labels.length === 4 && /prev/.test(labels[0]) && /play/.test(labels[1]) && /next/.test(labels[2]) && /unmute/.test(labels[3]),
    JSON.stringify(labels))
  const treeShut = mod.NowPlaying({ p: 0, mark: 0, open: false, playing: false, at: 0, media, note: '', onPrev() {}, onNext() {}, onPlayPause() {}, onVolume() {} })
  const labelsShut = opsOf(treeShut).map((n) => n.props['aria-label'])
  ok('F4 收起态只有 3 个键（第 4 键随卡片出现：收起态传输行是按 88px 三键行定位的，硬塞会溢出右边距）',
    labelsShut.length === 3 && /prev/.test(labelsShut[0]) && /play/.test(labelsShut[1]) && /next/.test(labelsShut[2]),
    JSON.stringify(labelsShut))
  const treeNoList = mod.NowPlaying({ p: 1, mark: 0, open: true, playing: false, at: 0, media: { ...media, canPrev: false, canNext: false }, note: '', onPrev() {}, onNext() {}, onPlayPause() {}, onVolume() {} })
  const opsNoList = opsOf(treeNoList)
  ok('F5 没有清单（canPrev/canNext=false）⇒ 上一首/下一首 disabled（不假装有列表）',
    opsNoList[0].props.disabled === true && opsNoList[2].props.disabled === true, JSON.stringify(opsNoList.map((n) => !!n.props.disabled)))
  /* 控制器：setMedia 驱动 mark 补间（不是展开进度） */
  const doc2 = makeSelDoc()
  const win2 = makeWin()
  const { ctl } = makeCtl(doc2, win2)
  ctl.setEnabled(true)
  ctl.setMedia({ playing: true, canPlay: true })
  await sleep(900)
  const markAfterPlay = ctl.inspect().mark
  ctl.setMedia({ playing: false })
  await sleep(900)
  const markAfterPause = ctl.inspect().mark
  ok('F6 控制器：setMedia({playing:true/false}) ⇒ mark 补间跑到 1 / 回到 0（标记由播放状态驱动）',
    markAfterPlay === 1 && markAfterPause === 0, 'mark(play)=' + markAfterPlay + ' mark(pause)=' + markAfterPause)
  ok('F7 补间是**自停**的（到站后没有活着的 rAF）', ctl.inspect().observers.rafLive === 0, JSON.stringify(ctl.inspect().observers))
}

/* ══════════════ H. web 壁纸路径不许跳过 NP 那一次 apply（真机 np=0 的根因） ══════════════ */
console.log('\n== H. applyFromStorageInner 的 web 分支提前 return ⇒ NP 那一次 apply 被整段跳过（真机 np=0）==')
{
  const F = freshPlugin({ settings: SEC_WEB, noApply: true })
  await settle()
  const insp = F.T && globalThis.__mpwNowPlaying ? globalThis.__mpwNowPlaying.inspect() : null
  ok('H1 web 壁纸档也要走到 NP apply（inspect().enabled=true）；旧写法 web 分支提前 return ⇒ 永远是 false',
    !!insp && insp.enabled === true, JSON.stringify(insp && { enabled: insp.enabled, anchor: insp.anchorMode, watch: insp.observers && insp.observers.anchorWatch }))
  const F2 = freshPlugin({ settings: SEC_VIDEO, noApply: true })
  await settle()
  const insp2 = globalThis.__mpwNowPlaying ? globalThis.__mpwNowPlaying.inspect() : null
  ok('H2 视频壁纸档（非 web 路径）同样走到 NP apply（对照组）', !!insp2 && insp2.enabled === true, JSON.stringify(insp2 && { enabled: insp2.enabled }))
  const F4 = freshPlugin({ settings: { ...SEC_WEB, float: true }, noApply: true })
  await settle()
  ok('H4 web 壁纸档也要落 `data-mpw-float` 门控属性（buildCss 里悬浮那套规则全靠它开门；旧写法同样漏）',
    F4.doc.body.hasAttribute('data-mpw-float') === true, 'body[data-mpw-float]=' + F4.doc.body.hasAttribute('data-mpw-float'))
  const F3 = freshPlugin({ settings: { ...SEC_WEB, npNowPlaying: false }, noApply: true })
  await settle()
  const insp3 = globalThis.__mpwNowPlaying ? globalThis.__mpwNowPlaying.inspect() : null
  ok('H3 开关显式关 ⇒ 依然纯拆除（没有控制器或 enabled=false，且零节点）',
    (!insp3 || insp3.enabled === false) && F3.doc.querySelectorAll('[data-mpw-now-playing]').length === 0,
    JSON.stringify({ ctl: !!insp3, enabled: insp3 && insp3.enabled, nodes: F3.doc.querySelectorAll('[data-mpw-now-playing]').length }))
}

/* ══════════════ I. 卡片几何：缩放原点必须落在卡片中心（真机"被切掉"的根因） ══════════════ */
console.log('\n== I. .mpw_np 宽度必须 = 组件的 W（否则 scale 的原点偏右、卡片右缘被 overflow:hidden 切掉）==')
{
  const MATH2 = loadCjsSource(fs.readFileSync(path.join(repoRoot, 'lib', 'now-playing-math.js'), 'utf8'), 'math')
  const css = String(NP.NP_CSS || '')
  const m = /\[data-mpw-now-playing\]\s*\.mpw_np\s*\{([^}]*)\}/.exec(css)
  const body = m ? m[1] : ''
  const w = /(?:^|[\s;])width:\s*(\d+)px/.exec(body)
  ok('I1 NP_CSS 里 .mpw_np 有**确定宽度**（不是 width:auto —— grid 会把 auto 夹到区域宽，缩放原点就偏了）',
    !!w, m ? body.trim().replace(/\s+/g, ' ').slice(0, 120) : '未找到 [data-mpw-now-playing] .mpw_np 规则')
  ok('I2 那个宽度**正好等于** math 的 W（改 math 的 W 而忘了这里 ⇒ 本组必红）',
    !!w && Number(w[1]) === MATH2.W, 'css=' + (w && w[1]) + 'px  math.W=' + MATH2.W)
  ok('I3 max-width:none（否则 260 会被 100% 之类的约束再夹一次）',
    /(?:^|[\s;])max-width:\s*none/.test(body), body.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ').slice(0, 120))
  ok('I4 水平居中：溢出必须**均分**（grid 的 center 在溢出时退化成 start，Firefox 实测就是 start）',
    /margin-inline:\s*calc\(\(100% - 260px\) \/ 2\)/.test(body), body.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ').slice(0, 160))
  /* I5 贴合缩放量的是**我们自己的容器**，不是"侧栏列"（真机上后者可能是另一列 280 宽）。 */
  {
    const doc = makeSelDoc()
    const bar = buildSelSidebar(doc, { width: 280 })     /* 列 280（真机上被误当成我们的那一列） */
    const win = makeWin()
    const { ctl } = makeCtl(doc, win)
    ctl.setSlotNode(bar.slot)
    ctl.setEnabled(true)
    const node = doc.querySelectorAll('[data-mpw-now-playing]')[0] || null
    if (node) { node.__w = 256 }                          /* 我们的容器实际只有 256（宿主扣掉 padding 后） */
    ctl.evaluate()
    const fit = node && node.style.getPropertyValue('--mpw-np-fit')
    const expect = Math.round(Math.max(0.5, Math.min(1, 256 / MATH2.W)) * 1000) / 1000
    ok('I5 fit 按**容器实测宽度**算（容器 256 已是内容宽 ⇒ ' + expect + '，不再重复扣 24px padding），不是按被误命中的 280 列',
      String(fit) === String(expect), 'fit=' + fit + ' 期望=' + expect + ' colWidth=' + ctl.inspectCollapse().colWidth)
    ok('I5b inspectCollapse 同时给出容器宽与列宽（排障时要能看见这个差）',
      typeof ctl.inspectCollapse().colWidth === 'number' && typeof ctl.inspectCollapse().width === 'number',
      JSON.stringify(ctl.inspectCollapse()))
  }
}

/* ══════════════ J. blob 兜底 URL 的 revoke（①(2026-09-23 资源审计 #2)） ══════════════
   审计原话（docs/RESOURCE-AUDIT-20260923.md §2.1 #2）：`lib/client.js` 的 np 播放器 blob 兜底
   `URL.createObjectURL(...)` 建完 URL **从不 revoke** —— 全仓 11 处 `revokeObjectURL` 没有一处
   覆盖它；blob URL 只在 `revokeObjectURL` 或**文档卸载**时释放 ⇒ 自动连播 N 首 = 每支 ≤32MiB 的
   Blob 常驻到页面卸载（单调增长）。同文件壁纸档（`lastBgSig`）早已修过同一处，np 档是漏网。
   本组钉住四件事：①"先设新 src、再 revoke 旧 URL"的顺序；②台账只保留当前那一支；
   ③换曲（npLoadTrack）释放上一支；④清 src（npAudioHardReset）/卸载（npDropAudio）释放并清空台账。 */
console.log('\n== J. np blob 兜底 URL：换曲/清 src/卸载都必须 revoke 上一支（否则每曲 ≤32MiB 常驻到卸载）==')
{
  const created = [], revoked = []
  let seq = 0
  let el = null
  /** revoke 那一刻元素指向谁 —— 这是"先设新 src 再 revoke 旧 URL"的唯一判据（顺序反了必红）。 */
  const curSrc = () => { try { return String((el && el.getAttribute('src')) || '') } catch { return 'ERR' } }
  /** 桩 fetch：/raw 的 content-type 在真机上是 octet-stream（部分浏览器据此拒播）⇒ blob 兜底是常态路径。 */
  const blobFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }),
  })
  try {
    const F = freshPlugin({ settings: SEC_WEB, fetch: blobFetch })
    await settle()
    /* ⚠ 桩环境是**每次 loadPlugin 重新安装**的（`_stub.installStubs` 会重写 `URL.createObjectURL`）⇒
       必须在 freshPlugin **之后**再接管这两个函数；先接管会被桩覆盖成恒 'blob:stub'（本组会假红）。 */
    globalThis.URL.createObjectURL = () => { const u = 'blob:np-' + (++seq); created.push(u); return u }
    globalThis.URL.revokeObjectURL = (u) => { revoked.push({ url: String(u), srcAtRevoke: curSrc() }) }
    const T = F.T
    /* 桩的 addEventListener 是**共享表**（所有元素一个 map）⇒ 只认"造成 npAudio 之后新增"的 error 处理器 */
    const beforeErr = (F.stubs.listeners['error'] || []).slice()
    T.seedTracks(SEC_WEB, [{ path: 'a.ogg', size: 1000, mime: 'audio/mpeg' }])
    T.load(0)
    el = T.audio()
    /* 桩元素的 `.src` 属性与属性表是两套；真 DOM 里 `el.src = x` 会同时写属性表（生产代码两条路都用：
       npLoadTrack 走 setAttribute、blob 兜底走 `.src =`）。补一个与真 DOM 同语义的访问器，
       否则"revoke 那一刻元素指向谁"根本断言不到（假绿温床）。 */
    try { Object.defineProperty(el, 'src', { configurable: true, get() { return this.getAttribute('src') || '' }, set(v) { this.setAttribute('src', String(v)) } }) } catch { /* 已定义过就跳过 */ }
    const npErr = (F.stubs.listeners['error'] || []).filter((f) => beforeErr.indexOf(f) < 0)
    const fireError = async () => { for (const f of npErr) { try { f({ type: 'error' }) } catch { /* 生产代码自己有兜底 */ } } await settle() }
    await fireError()
    ok('J1 兜底生效：src = blob URL、台账记下这一支，且此刻**零** revoke（它还在用）',
      curSrc() === created[0] && T.blobUrl() === created[0] && revoked.length === 0,
      JSON.stringify({ src: curSrc(), ledger: T.blobUrl(), created: created.slice(), revoked: revoked.length }))
    /* 第二次兜底：同一作用域换了清单条目 ⇒ 换了曲目 URL（**不经过 npLoadTrack**）——
       这正是"blob → blob 直接换手、台账里还握着上一支"的场景。 */
    T.seedTracks(SEC_WEB, [{ path: 'a2.ogg', size: 1200, mime: 'audio/mpeg' }])
    await fireError()
    ok('J2 第二次兜底 revoke 上一支，且发生在**新 src 装上之后**（revoke 那一刻 src 已是新 blob）',
      revoked.length === 1 && revoked[0].url === created[0] && revoked[0].srcAtRevoke === created[1],
      JSON.stringify(revoked))
    ok('J3 台账只保留"当前那一支"（自动连播 N 首不再累积 N 支 ≤32MiB 的 Blob）',
      T.blobUrl() === created[1] && created.length === 2, JSON.stringify({ ledger: T.blobUrl(), created: created.slice() }))
    /* 换曲（npLoadTrack）：装的是普通曲目 URL ⇒ 上一支 blob 在"新 src 已装上"之后释放。 */
    T.load(0)
    const urlB = T.trackUrl(SEC_WEB, 'a2.ogg')
    ok('J4 换曲（npLoadTrack）释放上一支：revoke 那一刻 src = 新曲目 URL（非空、且不是被回收的那支）',
      revoked.length === 2 && revoked[1].url === created[1] && revoked[1].srcAtRevoke === urlB && T.blobUrl() === '',
      JSON.stringify({ revoked: revoked[1], expectSrc: urlB, ledger: T.blobUrl() }))
    /* 清 src 路径（npAudioHardReset：换壁纸前的硬归零）。 */
    T.seedTracks(SEC_WEB, [{ path: 'c.ogg', size: 1300, mime: 'audio/mpeg' }])
    await fireError()
    T.hardReset('test')
    ok('J5 清 src（npAudioHardReset）释放并清空台账：revoke 那一刻 src 已经为空',
      revoked.length === 3 && revoked[2].url === created[2] && revoked[2].srcAtRevoke === '' && T.blobUrl() === '',
      JSON.stringify({ revoked: revoked[2], ledger: T.blobUrl() }))
    /* 卸载路径（npDropAudio：NP 开关被关掉/拆除时）。 */
    T.seedTracks(SEC_WEB, [{ path: 'd.ogg', size: 1400, mime: 'audio/mpeg' }])
    await fireError()
    T.dropAudio()
    ok('J6 卸载（npDropAudio）释放并清空台账（旧写法只 removeAttribute ⇒ URL 活到页面卸载）',
      revoked.length === 4 && revoked[3].url === created[3] && T.blobUrl() === '',
      JSON.stringify({ revoked: revoked[3], ledger: T.blobUrl() }))
    T.dropAudio()
    ok('J7 幂等：没有 blob 时再卸载一次不会重复 revoke（台账已空 ⇒ 零副作用）', revoked.length === 4, 'revoked=' + revoked.length)
  } finally {
    /* 桩环境是全局的：还原 createObjectURL/revokeObjectURL，避免影响后面的组 */
    delete globalThis.URL.createObjectURL
    delete globalThis.URL.revokeObjectURL
  }
}

/* ══════════════ G. 分辨力自证（RED-if-reverted） ══════════════ */
const MUTS = [
  {
    id: 'mark-driven-by-morph-again', expect: 'F', file: 'np',
    why: '①(NP-3) 把标记形状改回按**展开进度**画（旧写法 tq = 1 - p）⇒ 收起态恒三角/展开态恒双条（真机 bug④⑤）',
    mut: (s) => s.replace('const tq = 1 - m;', 'const tq = 1 - p;'),
  },
  {
    id: 'hidden-shell-video-accepted-again', expect: 'B', file: 'client',
    why: '①(NP-3) 把"只有当前真的在放的那个 video 才算源"的判据删掉（旧写法：查询命中的第一个 video，'
      + '而页面里**永远**有一个隐藏空壳 #mpw-bgVideo）⇒ web 壁纸被判成 video、播放/静音全落在空壳上',
    /* ①(2026-09-21 真机 P0) 判据从"display 一票否决"改成 **src 非空 + section 是视频档 + 非 web 档**
       三条（`display:none` 不再是否认依据：它只表示"画面此刻不可见"，不表示换了媒体）。
       变异因此改成"把这三条一起删掉" —— 语义与旧变异完全相同（空壳 video 又被当成当前媒体）。 */
    mut: (s) => s
      .replace('			if (!src) return null;', '			/* 变异：不查 src */')
      .replace('			if (s.webUrl) return null;', '			/* 变异：不查 web 档 */')
      .replace('			return isVid ? video : null;', '			return video;   /* 变异：命中的第一个 video 就算"当前媒体" */'),
  },
  {
    id: 'audio-scope-loses-custom-mpkgkey', expect: 'A', file: 'client',
    why: '①(NP-3) 删掉 mpkgKey="custom|<folder>" 这条作用域（旧写法只认 folderName）⇒ 自定义目录里的'
      + 'web 壁纸永远拉不到清单（真机 bug②：目录里的音频没接到控件）',
    /* ②(2026-09-20) 作用域构造点改成"目录名判据 + customScope()"（folder 必须是目录名）⇒
       变异注入点跟着改：删掉 `custom|<folder>` 那一条（语义与旧断言完全一致：删掉即拉不到清单）。 */
    mut: (s) => s.replace("			let m = /^custom\\|(.+)$/.exec(key);\n			if (m) return customScope(String(m[1]).split(\"/\")[0], \"mpkgKey\");", ""),
  },
  {
    id: 'mute-only-writes-setting', expect: 'D', file: 'client',
    why: '①(NP-3) 把静音键的"落到真实元素"那一步删掉（旧写法只 saveSection）⇒ 设置变了、声音不动（真机 bug⑥）',
    mut: (s) => s.replace("					saveSection({ mute: next });\n					npApplyMute();", "					saveSection({ mute: next });"),
  },
  {
    id: 'yield-check-removed', expect: 'E', file: 'np',
    why: '①(NP-3) 让位判据失效（occupantOf 恒 null）⇒ 别的插件已经在槽里我们照样挂上去（默认开就成了抢位）',
    mut: (s) => s.replace('      if (isOurNode(el)) continue;                                      /* ① */',
      '      if (isOurNode(el)) continue;                                      /* ① */\n      return el; /* 变异：任何非我们的节点都当占用者？不 —— 直接短路成"没有占用者" */\n      // eslint-disable-next-line no-unreachable'),
  },
  {
    id: 'np-fit-measures-wrong-column', expect: 'I', file: 'np',
    why: '①(NP-3) 把贴合缩放改回量"侧栏列"（= 真机根因原样：那一列可能是另一列 280 宽，'
      + '而我们容器只有 256 ⇒ fit 偏大、卡片右边被切 10.9px）',
    mut: (s) => s.replace('const w = r ? Number(r.width) : NaN;\n        if (isFinite(w) && w > 0) return w;',
      'const w = r ? Number(r.width) : NaN;\n        if (false && isFinite(w) && w > 0) return w;'),
  },
  {
    id: 'np-card-centering-removed', expect: 'I', file: 'np',
    why: '①(NP-3) 删掉"溢出均分"（= grid center 在溢出时退化成 start）⇒ 缩放原点右移 14px、卡片右缘被切',
    mut: (s) => s.replace('	margin-inline: calc((100% - 260px) / 2);\n	justify-self: center;\n', ''),
  },
  {
    id: 'np-card-width-unpinned', expect: 'I', file: 'np',
    why: '①(NP-3) 把 .mpw_np 的确定宽度删掉（= 真机根因原样：grid 把 width:auto 夹到区域宽，'
      + 'scale 原点量的是被夹过的盒子中心 ⇒ 卡片整体右移、右缘被切掉）',
    mut: (s) => s.replace('	width: 260px;\n	max-width: none;', ''),
  },
  {
    id: 'web-path-skips-float-attr', expect: 'H', file: 'client',
    why: '①(NP-3) 把 web 分支补上的 `data-mpw-float` 门控删掉（= 漏项原样）⇒ web 壁纸期间开悬浮不生效',
    mut: (s) => s.replace(
      '\t\t\t\ttry {\n'
      + '\t\t\t\t\tconst floatWeb = section.float !== void 0 ? !!section.float : DEFAULT_FLOAT;\n'
      + '\t\t\t\t\tif (floatWeb) document.body.setAttribute("data-mpw-float", "");\n'
      + '\t\t\t\t\telse document.body.removeAttribute("data-mpw-float");\n'
      + '\t\t\t\t} catch (e) {}\n', ''),
  },
  {
    id: 'web-path-skips-np-apply', expect: 'H', file: 'client',
    why: '①(NP-3) 把 web 分支补上的那次 applyNowPlaying 删掉（= 旧写法：web 壁纸路径提前 return，'
      + 'NP 整段 apply 被跳过）⇒ 刷新/切到 web 壁纸后控件根本不挂（真机 bug②⑥的前提，探针 np=0 就是它）',
    mut: (s) => s.replace(
      '				try { applyNowPlaying(section); } catch (e) { mpwErr("applyNowPlaying(web)", e); }\n', ''),
  },
  {
    id: 'anchor-watch-removed', expect: 'E', file: 'np',
    why: '①(NP-3) 把"锚点还没出现时盯住文档"那一步删掉（旧写法：打一行 warn 就 return）'
      + '⇒ 真机切壁纸（整页 reload）后宿主侧栏晚出现，控件从此再也不出现（探针抓到的第二条真机 bug）',
    mut: (s) => s.replace('        startObservers(true);      /* 盯 document.body：侧栏一出现就挂上（事件驱动，不轮询） */',
      '        return api;'),
  },
  {
    id: 'prev-next-collapse-to-restart', expect: 'C', file: 'client',
    why: '①(NP-3) 把"上一首/下一首"改回"回到开头"（旧写法 op=restart 只把 currentTime 归零）'
      + '⇒ 曲目顺序语义消失（用户现场第 3/7 条）',
    /* ①(NP-4)：NP-4 在那一行外面包了一层"记 did"（`did = npStepTrack(...) ? ... : ...`），
       注入点跟着更新 —— 判据本身没变（把"按清单换曲"改回"什么都不做"）。 */
    mut: (s) => s.replace("did = npStepTrack(op === \"next\" ? 1 : -1, true) ? \"step\" : \"step(nolist)\";",
      "if (false) npStepTrack(1, true);"),
  },
  /* ══ ①(2026-09-23 资源审计 #2) blob 兜底 URL 的三条 revoke 路径，各来一个变异 ══ */
  {
    id: 'np-blob-url-never-revoked-on-swap', expect: 'J', file: 'client',
    why: '①(资源审计 #2) 把 blob 兜底里的 `npBlobUrlSet(obj)` 删掉（= 审计原样：建完 URL 从不 revoke）'
      + '⇒ 每兜底一次就钉住一支 ≤32MiB 的 Blob 到页面卸载，自动连播 N 首 = 32MiB × N 单调增长',
    mut: (s) => s.replace("npAudio.src = obj;\n\t\t\t\t\tnpBlobUrlSet(obj);", "npAudio.src = obj;"),
  },
  {
    id: 'np-blob-url-never-revoked-on-track-change', expect: 'J', file: 'client',
    why: '①(资源审计 #2) 把 npLoadTrack（换曲）里的 `npBlobUrlSet("")` 删掉 ⇒ 上一支 blob URL 在换曲后'
      + '仍然留在 registry（元素已经指向新曲目 URL，那支 Blob 再也无人回收）',
    mut: (s) => s.replace('\t\t\t\tnpBlobUrlSet("");\n\t\t\t\tconst st = readSection();', '\t\t\t\tconst st = readSection();'),
  },
  {
    id: 'np-blob-url-never-revoked-on-drop', expect: 'J', file: 'client',
    why: '①(资源审计 #2) 把 npDropAudio（卸载）里的 `npBlobUrlSet("")` 删掉 ⇒ 关掉 NP/拆除播放器后'
      + 'blob URL 活到页面卸载（旧写法只 removeAttribute("src")，不释放 Blob）',
    mut: (s) => s.replace('\t\t\tnpBlobUrlSet("");\n\t\t\tnpAudio = null;', '\t\t\tnpAudio = null;'),
  },
]
if (!NO_MUT) {
  console.log('\n== G. 分辨力自证：' + MUTS.length + ' 组变异必须各自让**指定那一组**变红（副本在 mkdtemp，真树不动）==')
  const GROUPS = { A: /✗ A\d/, B: /✗ B\d/, C: /✗ C\d/, D: /✗ D\d/, E: /✗ E\d/, F: /✗ F\d/, H: /✗ H\d/, I: /✗ I\d/, J: /✗ J\d/ }
  for (const m of MUTS) {
    const src = m.file === 'np' ? npSrc : clientSrc
    const mutated = m.mut(src)
    if (mutated === src) { ok('G 变异 ' + m.id + ' 注入成功', false, '注入点没匹配上（源码改了？）'); continue }
    const copy = path.join(tmpRoot, 'mut-' + m.id + (m.file === 'np' ? '.np.js' : '.js'))
    fs.writeFileSync(copy, mutated)
    const args = [fileURLToPath(import.meta.url), '--no-mutations', m.file === 'np' ? '--np' : '--client', copy]
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 })
    const out = (r.stdout || '') + (r.stderr || '')
    const caught = Object.keys(GROUPS).filter((g) => GROUPS[g].test(out))
    const got = caught.includes(m.expect) ? m.expect : (r.status === 0 ? 'PASS' : 'FAIL(其它)')
    ok('G 变异 ' + m.id + '：期望 ' + m.expect + ' 组变红，实际 ' + got, got === m.expect, m.why + '  [exit=' + r.status + ']')
    if (got !== m.expect) console.error('      ↑ 实际报红分组：[' + caught.join(',') + ']')
  }
}

cleanup()
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ NP 声音接线门禁未通过'); process.exit(1) }
console.log('✓ NP 声音接线门禁通过：清单作用域/数据源判定/播放落点/静音落点/让位/标记状态 —— 全部有判据，且各有变异自证')

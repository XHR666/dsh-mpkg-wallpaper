// p142-nav-sound-test.mjs —— ①(P-142 2026-09-19 用户第 1/2/3 项) 资源管理器收纳 + 声音控件（NowPlaying）+
// video 壁纸的声音接线。
//
// 登记待办：**本项尚未写进 `tests/run-all-tests.sh`**（P-142 的纪律：不碰那份脚本，登记由主对话统一做）。
//   建议登记名：`p142-nav-sound`，命令：`node tests/p142-nav-sound-test.mjs`（秒级 / 无浏览器 / 无网络 / 无 GPU）。
//
// 用户三条原话（逐字）：
//   ①「8901 最左边的资源管理器，也要设置一个可以将它收纳起来的按键」
//   ②「(D1) 把调整它这个声音的这一项放到壁纸配置的下面（也就是壁纸配置这一栏，它的下面一部分做成声音的那个控件），
//      然后我这个声音控件，它可以被展开，按照它当前的范围大小去计算它后面被挡住的选项」
//   ③「有一些 video 壁纸它也是有声音的，但是默认给他静音掉了 —— Video 壁纸的声音也要接入我这个声音的控件」
//
// 本机无 GPU / 不能开浏览器 ⇒ 判据分三层，全部秒级：
//   A 层（静态）：`demo/index.html` + `demo/bench-patch.js` 的真源码结构（含 demo-check D8/D9 那两条不变量
//                 在**本次新增规则**上的等价复核：SITE_LAYOUT_CSS ⊆ 静态表 / 大括号平衡 / 类块里没有 @media /
//                 安全网零漂移）；
//   B 层（假 DOM 驱动真代码）：`initNavSound({doc, win, …})` 是真的那份实现（从 bench-patch.js import），
//                 假 DOM 只提供本段用到的面（选择器/class/属性/事件/getBoundingClientRect）⇒ 点击、连点、
//                 刷新保持、遮挡几何、video 播放/暂停/音量/进度全是真分支；
//   C 层（变异自证）：把实现/样式在 os.tmpdir() 的副本上故意改坏，**同一批判据**必须变红（含未变异对照）。
//
// 用法: node tests/p142-nav-sound-test.mjs [--mutation-verbose]     退出码 0 = 通过
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const PATCH_PATH = path.join(ROOT, 'demo', 'bench-patch.js')
const HTML_PATH = path.join(ROOT, 'demo', 'index.html')
const MUT_VERBOSE = process.argv.includes('--mutation-verbose')

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
const line = (s) => console.log(s)
const group = (t) => console.log('\n══ ' + t + ' ══')

/* ═══════════════════════════ 假 DOM（够本段用；不改真代码） ═══════════════════════════ */
function simpleMatch(el, s) {
  let rest = String(s || '').trim()
  if (rest === '*') return true
  const tag = (rest.match(/^[a-zA-Z][\w-]*/) || [])[0]
  if (tag) { if (el.tagName !== tag.toUpperCase()) return false; rest = rest.slice(tag.length) }
  for (const m of rest.matchAll(/\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)) {
    if (m[1] && !el._cls.has(m[1])) return false
    if (m[2] && el.id !== m[2]) return false
    if (m[3]) {
      const have = el.getAttribute(m[3])
      const want = m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : (m[6] !== undefined ? m[6] : undefined))
      if (want === undefined) { if (have === null) return false } else if (String(have) !== want) return false
    }
  }
  return true
}
function matchesSel(el, sel) {
  const parts = String(sel).trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean)
  let idx = parts.length - 1
  if (!simpleMatch(el, parts[idx])) return false
  idx--
  let node = el.parentNode
  while (idx >= 0) {
    if (parts[idx] === '>') {
      idx--
      if (!node || !simpleMatch(node, parts[idx])) return false
      node = node.parentNode; idx--
      continue
    }
    let hit = null, n = node
    while (n) { if (simpleMatch(n, parts[idx])) { hit = n; break } n = n.parentNode }
    if (!hit) return false
    node = hit.parentNode; idx--
  }
  return true
}
function mkEl(tag, opt = {}) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    id: opt.id || '',
    type: opt.type || '',
    title: opt.title || '',
    textContent: opt.textContent || '',
    value: opt.value !== undefined ? String(opt.value) : undefined,
    style: Object.assign({}, opt.style),
    dataset: Object.assign({}, opt.dataset),
    _attrs: Object.assign({}, opt.attrs),
    _cls: new Set(String(opt.cls || '').split(/\s+/).filter(Boolean)),
    _kids: [],
    _listeners: {},
    _dispatched: [],
    parentNode: null,
    _rect: opt.rect || null,
    hidden: !!opt.hidden,
  }
  el.classList = {
    add: (c) => { el._cls.add(c) },
    remove: (c) => { el._cls.delete(c) },
    contains: (c) => el._cls.has(c),
    toggle: (c, force) => { const on = force === undefined ? !el._cls.has(c) : !!force; if (on) el._cls.add(c); else el._cls.delete(c); return on },
    toString: () => [...el._cls].join(' '),
  }
  Object.defineProperty(el, 'children', { get: () => el._kids })
  Object.defineProperty(el, 'firstChild', { get: () => el._kids[0] || null })
  el.appendChild = (k) => { k.parentNode = el; el._kids.push(k); return k }
  el.removeChild = (k) => { const i = el._kids.indexOf(k); if (i >= 0) { el._kids.splice(i, 1); k.parentNode = null } return k }
  el.setAttribute = (k, v) => { el._attrs[k] = String(v) }
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null)
  el.hasAttribute = (k) => k in el._attrs
  el.removeAttribute = (k) => { delete el._attrs[k] }
  el.addEventListener = (t, h) => { (el._listeners[t] = el._listeners[t] || []).push(h) }
  el.removeEventListener = (t, h) => { el._listeners[t] = (el._listeners[t] || []).filter((x) => x !== h) }
  el.dispatchEvent = (ev) => { el._dispatched.push(ev && ev.type); for (const h of (el._listeners[ev.type] || [])) h(ev); return true }
  el.fire = (t, ev) => { for (const h of (el._listeners[t] || []).slice()) h(Object.assign({ type: t, preventDefault() {}, stopPropagation() {}, target: el }, ev)) }
  el.getBoundingClientRect = () => Object.assign({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, el._rect || {})
  el.querySelector = (sel) => queryAll(el, sel)[0] || null
  el.querySelectorAll = (sel) => queryAll(el, sel)
  return el
}
function queryAll(root, sel) {
  const out = []
  const walk = (n) => { for (const k of n._kids) { if (matchesSel(k, sel)) out.push(k); walk(k) } }
  walk(root)
  return out
}
function mkDoc(bodyEl) {
  const doc = {
    body: bodyEl,
    documentElement: mkEl('html'),
    querySelector: (sel) => (matchesSel(bodyEl, sel) ? bodyEl : null) || queryAll(bodyEl, sel)[0] || null,
    querySelectorAll: (sel) => queryAll(bodyEl, sel),
    createElement: (t) => mkEl(t),
    addEventListener: () => {},
  }
  return doc
}
class FakeMutationObserver {
  constructor(cb) { this.cb = cb; FakeMutationObserver.last = this }
  observe() { this.observed = true }
  disconnect() {}
  takeRecords() { return [] }
  poke() { this.cb([], this) }
}
function mkStore(init = {}) {
  const m = Object.assign({}, init)
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v) },
    removeItem: (k) => { delete m[k] },
    _map: m,
  }
}
function flush(n = 6) { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => {}) ; return p }

/* ═══════════════════════════ 测试台页面树（结构照 demo/index.html） ═══════════════════════════ */
function mkVideo() {
  const v = mkEl('video')
  v.paused = true; v.volume = 1; v.muted = true; v.currentTime = 0; v.duration = NaN; v.readyState = 0
  v._plays = 0; v._pauses = 0; v._seeks = []
  v.play = () => { v._plays++; v.paused = false; return Promise.resolve() }
  v.pause = () => { v._pauses++; v.paused = true }
  return v
}
/** 真 renderer 的 `window.__wp` 契约（`demo/assets/renderer-BOSoB05I.js` 里那段）的假实现：
 *  setVolume 同时写 volume 与 muted、resume/pause 落到 videoPairs/单个 video 上。 */
function mkWp(videos, { noop = false } = {}) {
  return {
    calls: [],
    setVolume(t) {
      this.calls.push(['setVolume', Number(t)])
      if (noop) return
      for (const v of videos) { v.volume = Math.max(0, Math.min(1, Number(t))); v.muted = Number(t) <= 0 }
    },
    resume() { this.calls.push(['resume']); if (!noop) for (const v of videos) v.play() },
    pause() { this.calls.push(['pause']); if (!noop) for (const v of videos) v.pause() },
  }
}
/** 组件（P-138 产物）真正渲染出来的那棵子树里、本补丁会读/点到的部分。 */
function buildSnd(mount, opt = {}) {
  const box = mkEl('div', { cls: 'snd-box', rect: opt.cardRect })
  box.setAttribute('data-open', opt.expanded ? '' : null)
  const tap = mkEl('button', { cls: 'snd-tap', attrs: { 'aria-expanded': String(!!opt.expanded), 'aria-label': opt.expanded ? 'Collapse the player' : 'Open the player' } })
  const like = mkEl('button', { cls: 'snd-like', attrs: { 'aria-label': 'Add to liked songs', 'aria-pressed': 'false' } })
  const ops = mkEl('span', { cls: 'snd-ops' })
  const back = mkEl('button', { cls: 'snd-op', attrs: { 'aria-label': 'Restart' } })
  const lead = mkEl('button', { cls: 'snd-op', attrs: { 'aria-label': opt.playing ? 'Pause' : 'Play', 'aria-pressed': String(!!opt.playing), 'data-lead': '' } })
  const next = mkEl('button', { cls: 'snd-op', attrs: { 'aria-label': 'Next' } })
  const run = mkEl('span', { cls: 'snd-run', style: { width: String(Number(opt.progress) || 0) + '%' } })
  const snd = mkEl('div', { cls: 'snd' })
  const bar = mkEl('span', { cls: 'snd-bar' })
  bar.appendChild(mkEl('span', { cls: 'snd-rail' }))
  bar.appendChild(run)
  ops.appendChild(back); ops.appendChild(lead); ops.appendChild(next)
  box.appendChild(mkEl('span', { cls: 'snd-art' }))
  box.appendChild(mkEl('span', { cls: 'snd-say' }))
  box.appendChild(bar); box.appendChild(tap); box.appendChild(like); box.appendChild(ops)
  snd.appendChild(box)
  mount.appendChild(snd)
  // 假「React」：真组件的事件是挂在容器（#np-mount）上的委托监听器，**离散事件同步 flush**
  // ⇒ 冒泡到父节点 #np-host 时属性已是新值。这里逐字模拟这条顺序契约。
  mount.addEventListener('click', (e) => {
    let n = e.target
    while (n && n !== mount) {
      if (n.classList && n.classList.contains('snd-op') && n.getAttribute('aria-pressed') !== null) {
        const on = n.getAttribute('aria-pressed') === 'true'
        n.setAttribute('aria-pressed', on ? 'false' : 'true')
        n.setAttribute('aria-label', on ? 'Play' : 'Pause')
        return
      }
      if (n.classList && n.classList.contains('snd-tap')) {
        const on = n.getAttribute('aria-expanded') === 'true'
        n.setAttribute('aria-expanded', on ? 'false' : 'true')
        return
      }
      n = n.parentNode
    }
  })
  return { snd, box, tap, like, ops, back, lead, next, run }
}
/** 冒泡路径（target → … → #np-host），按注册顺序调监听器 —— 与浏览器的顺序一致。 */
function firePath(target, type, ev = {}) {
  const chain = []
  let n = target
  while (n) { chain.push(n); n = n.parentNode }
  for (const el of chain) for (const h of (el._listeners[type] || []).slice()) h(Object.assign({ type, preventDefault() {}, stopPropagation() {}, target }, ev))
}

const VIEW = { propsTop: 68, propsBottom: 900, bodyTop: 144 }
function mkPage(opt = {}) {
  const store = mkStore(opt.store || {})
  const body = mkEl('body')
  const sidebar = mkEl('aside', { id: 'sidebar' })
  const toggle = mkEl('button', { id: 'sidebar-toggle', type: 'button', attrs: { 'aria-controls': 'sidebar', 'aria-expanded': 'true' } })
  sidebar.appendChild(toggle)
  sidebar.appendChild(mkEl('div', { cls: 'sidebar-title' }))
  const list = mkEl('ul', { id: 'list' })
  sidebar.appendChild(list)
  const props = mkEl('aside', { id: 'props' })
  const propsBody = mkEl('div', { id: 'props-body', rect: { left: 1280, right: 1600, top: VIEW.bodyTop, bottom: VIEW.propsBottom, width: 320, height: VIEW.propsBottom - VIEW.bodyTop } })
  const items = []
  const ROW = Number(opt.rowH || 65)
  const nItems = Number(opt.items === undefined ? 30 : opt.items)
  // 滚动容器口径：内容(4px padding-top + N 行) + 底高预留（由静态表那条 `#props-body{padding-bottom:…}` 决定）
  propsBody.scrollTop = Number(opt.scrollTop || 0)
  propsBody.scrollHeight = 4 + ROW * nItems + Number(opt.pad === undefined ? 239 : opt.pad)
  propsBody.clientHeight = VIEW.propsBottom - VIEW.bodyTop
  for (let i = 0; i < nItems; i++) {
    const top = VIEW.bodyTop + 4 + ROW * i
    const it = mkEl('div', { cls: 'prop', dataset: { propId: 'p' + i }, rect: { left: 1280, right: 1600, top, bottom: top + ROW, width: 320, height: ROW } })
    items.push(it); propsBody.appendChild(it)
  }
  props.appendChild(propsBody)
  const host = mkEl('div', { id: 'np-host' })
  const mount = mkEl('div', { id: 'np-mount' })
  /*  ⑦(2026-10-05 第 ⑦ 项「去掉壁纸配置底部那条多余播放进度条」) `#np-audio` 现在 `display:none!important`
      且 `--mpw-np-strip:0px` ⇒ 夹具里它也必须**零高**（否则这条夹具在测一个真机上不存在的 30px 传输条）。 */
  const audio = mkEl('div', { id: 'np-audio', rect: { left: 1280, right: 1600, top: VIEW.propsBottom, bottom: VIEW.propsBottom, width: 320, height: 0 } })
  const mute = mkEl('button', { id: 'np-mute', type: 'button', attrs: { 'aria-pressed': 'true' } })
  const wave = mkEl('path', { id: 'np-mute-wave' })
  const slash = mkEl('path', { id: 'np-mute-slash' })
  /*  ③(2026-09-25 用户第 3 条) 页面上**不再有** `#np-volume`（它现在由组件渲染在卡片内部）⇒ 夹具也不放它：
      放一个"真实页面里不存在的元素"会让 C 组那批判据测到一条不存在的路径（假绿）。 */
  const seek = mkEl('button', { id: 'np-seek', type: 'button', rect: { left: 1400, right: 1560, top: 880, bottom: 894, width: 160, height: 14 } })
  const run = mkEl('span', { id: 'np-run', style: { width: '0%' } })
  const time = mkEl('span', { id: 'np-time', textContent: '0:00 / 0:00' })
  const stageNote = mkEl('span', { id: 'np-stage', textContent: '' })
  seek.appendChild(run)
  audio.appendChild(mute); audio.appendChild(wave); audio.appendChild(slash); audio.appendChild(seek); audio.appendChild(time); audio.appendChild(stageNote)
  host.appendChild(mount); host.appendChild(audio)
  props.appendChild(host)
  const frame = mkEl('iframe', { id: 'frame' })
  const iframeDoc = mkEl('#document-fragment')
  const videos = opt.videos === undefined ? [mkVideo()] : opt.videos
  for (const v of videos) iframeDoc.appendChild(v)
  frame.contentDocument = iframeDoc
  frame.contentWindow = opt.win__wp === undefined ? { __wp: mkWp(videos, { noop: !!opt.wpNoop }) } : opt.win__wp
  body.appendChild(sidebar); body.appendChild(props); body.appendChild(frame)
  const main = mkEl('div', { id: 'main' }); body.appendChild(main)
  const doc = mkDoc(body)
  const tbVol = mkEl('input', { id: 'volume', type: 'range', value: opt.toolbarVol === undefined ? '0' : String(opt.toolbarVol) })
  body.appendChild(tbVol)
  const win = { localStorage: store, MutationObserver: FakeMutationObserver, addEventListener: () => {} }
  return { doc, win, body, sidebar, toggle, list, props, propsBody, items, host, mount, audio, mute, seek, run, time, stageNote, frame, videos, store, tbVol }
}
/** 用**真代码**初始化：`initNavSound` 从 bench-patch.js import（不是复制一份逻辑）。 */
async function mkRuntime(mod, opt = {}) {
  const p = mkPage(opt)
  const mounts = []
  const npState = { mounted: 0 }
  const api = mod.initNavSound({
    doc: p.doc,
    win: p.win,
    loadNowPlaying: async () => ({
      mountNowPlaying(el, opts) {
        npState.mounted++
        mounts.push({ el, opts })
        const built = buildSnd(el, { playing: false, expanded: false, progress: 0, cardRect: opt.cardRect })
        //  ①(P-161) 这个夹具模拟的是**装饰态**组件（没有受控面）：`update()` 不提供 ⇒ 补丁不会进入
        //  受控模式 ⇒ 本文件 C 组那批"aria 桥 + 宿主点击拦截"的判据仍然测的是它们该测的那条路。
        //  受控模式（真组件）的行为由 `bench-ui-headless` T 组与 `bench-shell-fixes` G 组覆盖。
        return { unmount() {} }
      },
    }),
  })
  api.__page = p
  api.__mounts = mounts
  await api.mountSound()
  await flush(2)
  api.__snd = p.mount.querySelector('.snd') ? {
    box: p.mount.querySelector('.snd-box'), tap: p.mount.querySelector('.snd-tap'),
    lead: p.mount.querySelector('.snd-op[data-lead]'), back: p.mount.querySelectorAll('.snd-op')[0],
    next: p.mount.querySelectorAll('.snd-op')[2], run: p.mount.querySelector('.snd-run'),
  } : null
  return api
}

/* ═══════════════════════════ 判据（主跑与变异跑共用同一批） ═══════════════════════════ */
const BENCHO_TOKENS = ['--card', '--font-num', '--font-ui', '--ink', '--ink-3', '--ink-4', '--ink-rgb', '--on-ink', '--on-slab', '--pane', '--pane-edge', '--slab', '--surface-2', '--surface-3']
/** 从静态表里读"展开态预留高度"的模型值（单位 px）：没有那条预留规则 = 只用产物自己的 20px。 */
function reserveModel(htmlSrc) {
  const has = /#props-body\{padding-bottom:calc\(20px \+ var\(--mpw-np-cover\)\)\}/.test(htmlSrc)
  const card = Number((htmlSrc.match(/--mpw-np-card:(\d+)px/) || [])[1] || 0)
  const strip = Number((htmlSrc.match(/--mpw-np-strip:(\d+)px/) || [])[1] || 0)
  /*  ③(2026-09-25 issue0924a2 用户第 3 条)**契约再变一次**：音量控件从"卡片下面那条独立行
      （`--mpw-np-vol`）"挪进**卡片内部**（组件受控档的时钟行音量轨 + 传输行第四键）。
      ⇒ NP 栈回到"卡片 + 传输条"两段：`--mpw-np-cover = card + strip`，`--mpw-np-vol` **整个变量都不该再有**
      （它曾经存在这件事由下面的 `volVar` 读数如实带出来：为 0 且页面里也没有那条声明）。
      这条判据要保护的事没变：展开态**不许永久遮住**属性项。 */
  const volVar = Number((htmlSrc.match(/--mpw-np-vol:(\d+)px/) || [])[1] || 0)
  const noVolVar = !/--mpw-np-vol:/.test(htmlSrc)
  const coverRule = /--mpw-np-cover:calc\(var\(--mpw-np-card\) \+ var\(--mpw-np-strip\)\)/.test(htmlSrc)
  return { has, card, vol: volVar, noVolVar, strip, coverRule, cover: card + strip, pad: has ? 20 + card + strip : 20 }
}
/** HTML 里每个 id 的**嵌套深度**（去注释/脚本后按标签栈算）——用来断言 DOM 归属关系。 */
function idDepths(html) {
  const src = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
  const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param'])
  const out = {}
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  let depth = 0, m
  while ((m = re.exec(src))) {
    if (m[1] === '/') { depth = Math.max(0, depth - 1); continue }
    const tag = m[2].toLowerCase()
    const idm = m[3].match(/\bid="([^"]+)"/)
    if (idm && !(idm[1] in out)) out[idm[1]] = depth
    if (m[4] !== '/' && !VOID.has(tag)) depth++
  }
  return out
}
/** A 层：只看源码文本。 */
function staticFacts(patchSrc, htmlSrc, mod) {
  const F = []
  const push = (name, ok, detail) => F.push({ name, ok: !!ok, detail })
  const depths = idDepths(htmlSrc)
  const nav = mod.sidebarCollapsePlan(true)

  push('A1 收纳状态 = 网格第 1 列变窄（`body.bench-nav-collapsed{--mpw-lib-w:26px}` + `#workbench{…var(--mpw-lib-w,300px)…}`）',
    /body\.bench-nav-collapsed\{--mpw-lib-w:26px\}/.test(htmlSrc) && /#workbench\{flex:1;grid-template-columns:var\(--mpw-lib-w,300px\) auto minmax\(0,1fr\)!important/.test(htmlSrc))
  push('A2 收起时除了把手之外 `#sidebar` 的所有子节点都撤掉（`#sidebar > :not(#sidebar-toggle){display:none!important}`）',
    /body\.bench-nav-collapsed #sidebar > :not\(#sidebar-toggle\)\{display:none!important\}/.test(htmlSrc))
  push('A3 收起**不是**把侧栏藏起来/盖住（没有 `#sidebar{display:none}` 那类规则；侧栏仍在网格里占 26px）',
    !/bench-nav-collapsed[^{}]*#sidebar\{[^}]*display:none/.test(htmlSrc) && /body\.bench-nav-collapsed #sidebar\{border-right/.test(htmlSrc))
  push('A4 把手是 `#sidebar` 的**直接**子节点、且是原生 `<button type="button">` + aria-controls=sidebar + aria-expanded（Tab/Enter/Space 由浏览器保证）',
    depths['sidebar-toggle'] !== undefined && depths['sidebar-toggle'] === depths['list'] &&
    /<button type="button" id="sidebar-toggle" aria-controls="sidebar" aria-expanded="true"/.test(htmlSrc))
  push('A5 键盘只有一条通路：⑭ 段里 `navBtn.addEventListener` 恰好一次、且**没有**给把手补 keydown（补了就是键盘一次+click 再一次 = 双重翻转）',
    (patchSrc.match(/navBtn\.addEventListener\(/g) || []).length === 1 && !/navBtn\.addEventListener\('keydown'/.test(patchSrc) && /__benchNavBound/.test(patchSrc))
  push('A6 状态用**绝对写法**（`classList.toggle(cls, want)`），不是"按当前状态反推"的翻转',
    /classList\.toggle\(p\.bodyClass, p\.collapsed\)/.test(patchSrc))
  push("A7 首帧同步脚本：读 `bench-sidebar-collapsed`、只认 '1'、认 `?shell=off`，且与 JS 常量同名",
    /localStorage\.getItem\('bench-sidebar-collapsed'\) !== '1'/.test(htmlSrc) && /shell=\(off\|0\|false\|no\)/.test(htmlSrc) &&
    mod.NAV_COLLAPSED_STORE === 'bench-sidebar-collapsed' && nav.readCollapsed('1') === true && nav.readCollapsed('0') === false)
  push('A8 导轨宽度三处同值：JS 常量 26 === 静态表 `#sidebar-toggle{…width:26px…}` === 收起列宽 26px',
    mod.NAV_RAIL_W === 26 && /#sidebar-toggle\{position:absolute;top:0;right:0;width:26px;height:35px/.test(htmlSrc) && nav.railWidth === 26)
  push('A9 窄屏（堆叠布局没有"第 1 列"可收）：收起 = 侧栏塌成 34px 横条 —— 规则在 `.bench-narrow` 类块里（安全网不重复）',
    /html\.bench-shell\.bench-narrow body\.bench-nav-collapsed #sidebar\{flex:none;height:34px;min-height:34px;max-height:34px\}/.test(htmlSrc))

  const res = reserveModel(htmlSrc)
  push('A10 声音控件挂点结构：`#np-host` 与 `#props-body` **同深度**（都是 `#props` 的直接子节点 ⇒ 不进产物的属性列表），`#np-mount` 在它里面',
    depths['np-host'] !== undefined && depths['np-host'] === depths['props-body'] && depths['np-mount'] === depths['np-host'] + 1)
  push('A11 `#np-host` 排在 `#props-body` **之后**（= 壁纸配置栏的下半部分）',
    htmlSrc.indexOf('id="props-body"') < htmlSrc.indexOf('id="np-host"'))
  push('A12【契约已更新：第 ⑦ 项】NP 栈 = **只剩卡片**（传输条撤掉：`--mpw-np-strip:0px`、`#np-audio` 隐藏；音量控件在卡片内部）：`--mpw-np-card:189px` = `now-playing-math.OPEN`、`--mpw-np-cover = card` = 189',
    res.card === 189 && res.strip === 0 && res.cover === 189 && res.noVolVar && res.vol === 0,
    JSON.stringify({ card: res.card, strip: res.strip, vol: res.vol, noVolVar: res.noVolVar, cover: res.cover }))
  push('A13 「不许永久遮住」的兑现方式：`#props-body{padding-bottom:calc(20px + var(--mpw-np-cover))}`（把**展开态**高度也算进滚动容器）',
    res.has)
  push('A14 传输条是补丁自己的容器（`#np-audio` 是 `#np-host` 的子节点）；组件挂点 `#np-mount` 不被补丁写 DOM（无 innerHTML/appendChild/textContent 赋值）',
    depths['np-audio'] === depths['np-mount'] && !/mountEl\.(innerHTML|appendChild|textContent)/.test(patchSrc))
  push('A15 只在同源 iframe 里找 `<video>`（`#frame.contentDocument`）+ `__wp`（`contentWindow.__wp.setVolume` 是函数才认）',
    /contentDocument/.test(patchSrc) && /contentWindow\.__wp/.test(patchSrc) && /typeof a\.setVolume === 'function'/.test(patchSrc))
  push('A16 进度订阅的是 `timeupdate`/`durationchange` 这一类媒体事件（需求③）',
    /'timeupdate', 'durationchange', 'loadedmetadata'/.test(patchSrc) && /addEventListener\(ev, \(\) => paintProgress\(\)\)/.test(patchSrc))
  push('A17 音量有两条落点：`api.setVolume()` **并且**直接写 `<video>` 的 `volume/muted`（API 缺席时也真的作用到元素）',
    /api\.setVolume\(eff\)/.test(patchSrc) && /el\.volume = clamp01\(vol\); el\.muted = !\(eff > 0\)/.test(patchSrc))
  push('A18 默认仍是静音（初始音量取工具条 `#volume`，默认 0 ⇒ muted=true），不自动出声',
    /let vol = toolbarVol \? clamp01\(toolbarVol\.value\) : 0/.test(patchSrc) && /let muted = !\(vol > 0\)/.test(patchSrc))
  push('A19 14 个 Bencho token 一个都没在 demo/index.html 里定义（组件自己落在 `.snd` 上）',
    BENCHO_TOKENS.every((t) => !new RegExp(t.replace(/-/g, '\\-') + ':').test(htmlSrc)),
    BENCHO_TOKENS.filter((t) => new RegExp(t.replace(/-/g, '\\-') + ':').test(htmlSrc)).join(','))
  push('A20 没有新 URL 开关：⑭ 段与首帧脚本里出现的查询参数名 ⊆ {shell}',
    (() => {
      const seg = patchSrc.slice(patchSrc.indexOf('⑭(P-142'), patchSrc.indexOf('export function init()'))
      const names = new Set()
      for (const m of (seg + htmlSrc.slice(htmlSrc.indexOf('<body>'))).matchAll(/\[[?&]([a-z][\w-]*)=/g)) names.add(m[1])
      return [...names].every((n) => n === 'shell')
    })())
  push('A21 组件 CSS 是**组件自带**那份（`./now-playing/now-playing.css` 存在且被本页 `<link>` 引；不是把样式写进本页）',
    fs.existsSync(path.join(ROOT, 'demo', 'now-playing', 'now-playing.css')) && /<link rel="stylesheet" href="\.\/now-playing\/now-playing\.css" \/>/.test(htmlSrc))
  // D7 同口径：本页 id 唯一（本次新增的挂在页面上的 id：sidebar-toggle / np-host / np-mount / np-audio /
  //   np-mute / np-seek / np-run / np-time / np-stage / np-mute-wave / np-mute-slash；
  //   ⚠ `np-volume` **不在**这份清单里：③ 起它由**组件**渲染在卡片内部（见 bench-issue0924a-line-A 的 A2*））
  const idAll = [...htmlSrc.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  const dupIds = [...new Set(idAll.filter((x, i) => idAll.indexOf(x) !== i))]
  const NEW_IDS = ['sidebar-toggle', 'np-host', 'np-mount', 'np-audio', 'np-mute', 'np-seek', 'np-run', 'np-time', 'np-stage', 'np-mute-wave', 'np-mute-slash']
  push('A28（D7 同口径）demo/index.html 的 id 全局唯一，且本次新增的 11 个页面 id 各出现恰好一次（`np-volume` 归组件渲染 ⇒ 不在页面里）',
    dupIds.length === 0 && NEW_IDS.every((x) => idAll.filter((y) => y === x).length === 1),
    dupIds.length ? '重复：' + dupIds.join(',') : '新 id ' + NEW_IDS.length + ' 个各 1 次')
  push('A22 组件四周的透明区不吃点击（`#np-mount > *{pointer-events:none}` + `.snd button{pointer-events:auto}`）⇒ 收起时上下那 55.5px 空隙照常点得到后面的属性项',
    /#np-mount > \*\{pointer-events:none\}/.test(htmlSrc) && /#np-mount \.snd button\{pointer-events:auto\}/.test(htmlSrc))

  // demo-check D8/D9 那两条不变量在**本次新增规则**上的等价复核（全量由 demo-check 跑）
  const mStatic = htmlSrc.match(/<style id="bench-shell-static">([\s\S]*?)<\/style>/)
  const mArr = patchSrc.match(/const SITE_LAYOUT_CSS = \[([\s\S]*?)\]\.join\(''\)/)
  if (mStatic && mArr) {
    const items = [...mArr[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"))
    const norm = (t) => t.replace(/\s+/g, ' ').trim()
    const staticSet = new Set(mStatic[1].split('\n').map(norm).filter((l) => l && l.includes('{')))
    const missing = []
    for (const it of items) {
      if (!it.includes('{') || it.startsWith('@media')) continue
      const i = it.indexOf('{')
      const sels = it.slice(0, i).split(',').map((x) => x.trim())
      const want = norm(sels.map((x) => (x.startsWith('html[') ? x : 'html.bench-shell ' + x)).join(', ') + norm(it.slice(i)))
      if (!staticSet.has(want)) missing.push(want.slice(0, 70))
    }
    push('A23（D8 同口径）SITE_LAYOUT_CSS 的每条布局规则都在静态表里逐字命中（含 ⑭ 新增的 30 条）', missing.length === 0,
      missing.length ? missing.slice(0, 2).join(' | ') + ' …共' + missing.length : '逐条一致；条目 ' + items.filter((x) => x.includes('{')).length)
    const cssRaw = mStatic[1]
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ')
    let depth = 0, neg = -1
    for (let i = 0; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') { depth--; if (depth < 0 && neg < 0) neg = i } }
    push('A24（D9 同口径）静态样式块大括号平衡（剥注释）', depth === 0 && neg < 0, 'depth=' + depth)
    const firstNarrow = css.indexOf('html.bench-shell.bench-narrow')
    const safetyAt = css.indexOf('@media (max-width:1180px)')
    push('A25（D9 同口径）`.bench-narrow` 类块里没有 @media 混进来（⑭ 的窄屏规则加在类块内、安全网之前）',
      firstNarrow >= 0 && safetyAt > firstNarrow && css.slice(firstNarrow, safetyAt).indexOf('@media') < 0)
    const canon = (sel) => sel.split(',').map((s) => s.trim().replace(/^html\.bench-shell(\.bench-narrow)?\s+/, '')).filter(Boolean).sort().join(' | ')
    const leaf = (t) => [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m2) => ({ narrow: m2[1].includes('bench-narrow'), key: canon(m2[1].trim().replace(/\s+/g, ' ')), decl: m2[2].trim().replace(/\s+/g, ' ') }))
    const classRules = new Set(leaf(css.slice(firstNarrow, safetyAt)).filter((r) => r.narrow).map((r) => r.key + '{' + r.decl + '}'))
    const drift = leaf(css.slice(safetyAt)).filter((r) => !classRules.has(r.key + '{' + r.decl + '}'))
    push('A26（D9 同口径）纯 CSS 安全网（@media ≤1180）零漂移', drift.length === 0, drift.slice(0, 2).map((r) => r.key).join(' | '))
  } else {
    push('A23–A26 静态表/SITE_LAYOUT_CSS 两块都能定位', false, '缺 <style id="bench-shell-static"> 或 SITE_LAYOUT_CSS')
  }

  // 「按它真实的 API 接」：①(P-161) 起 opts 是五个 —— P-138 的三个旋钮 + 受控面 data/onTransport
  // （都是组件自己导出的**类型化**入口，不是补丁臆造的 onPlayPause/onVolume/getState）。
  try {
    const mount = fs.readFileSync(path.join(ROOT, 'demo', 'now-playing', 'mount.tsx'), 'utf8')
    const keys = [...mount.matchAll(/^\s{2}([a-zA-Z]+)\?:/gm)].map((m) => m[1])
    push('A27 组件的真实 opts = morph/corner/stroke + data/onTransport（补丁只传这四个，没有臆造回调）',
      keys.length === 5 && keys.join(',') === 'morph,corner,stroke,data,onTransport' &&
      /mountNowPlaying\(mountEl, \{ corner: 16, stroke: false, data: npSnapshot\(\), onTransport: npTransport \}\)/.test(patchSrc) &&
      !/onPlayPause|onVolume|getState/.test(patchSrc),
      'mount.tsx opts=' + JSON.stringify(keys))
  } catch (e) { push('A27 能读到 mount.tsx 的 opts 类型', false, String(e.message)) }
  return F
}
/** B 层：假 DOM 驱动真代码。 */
async function domFacts(mod, htmlSrc) {
  const F = []
  const push = (name, ok, detail) => F.push({ name, ok: !!ok, detail })
  const res = reserveModel(htmlSrc)

  /* ── ① 收纳 ── */
  {
    const rt = await mkRuntime(mod)
    const p = rt.__page
    push('B1 默认（无记忆键）：展开态 —— body 无状态类、aria-expanded=true、不写记忆键',
      !p.body.classList.contains('bench-nav-collapsed') && p.toggle.getAttribute('aria-expanded') === 'true' && !('bench-sidebar-collapsed' in p.store._map))
    push('B2 点一次：收起 —— body 有状态类、aria-expanded=false、记忆键=1、且 DOM 里始终只有**一个** `#list` 容器',
      (() => {
        p.toggle.fire('click')
        return p.body.classList.contains('bench-nav-collapsed') && p.toggle.getAttribute('aria-expanded') === 'false' &&
          p.store._map['bench-sidebar-collapsed'] === '1' && p.doc.querySelectorAll('#list').length === 1
      })())
    // 连点 N 次：状态只由次数奇偶决定（用户点名的"点几次就重复开/关"）
    rt.setNavCollapsed(false)                       // 从展开态起算（B2 已经点过 1 次）
    let parityOk = true, detail = ''
    const bad = []
    for (let n = 1; n <= 10; n++) {
      p.toggle.fire('click')
      const collapsed = p.body.classList.contains('bench-nav-collapsed')
      const aria = p.toggle.getAttribute('aria-expanded')
      const want = n % 2 === 1
      if (collapsed !== want || aria !== String(!want) || p.doc.querySelectorAll('#list').length !== 1) {
        parityOk = false; bad.push('n=' + n + ' collapsed=' + collapsed + ' aria=' + aria)
      }
    }
    detail = bad.length ? bad.slice(0, 3).join(' | ') : 'N=1..10 逐次一致（状态、aria、#list 计数）'
    push('B3 连点 10 次：状态 = 次数奇偶、aria-expanded 始终与状态一致、`#list` 容器数恒为 1', parityOk, detail)
    push('B4 按钮上恰好一个 click 监听器、没有 keydown 监听器（原生 button ⇒ 键盘不会和 click 叠加）',
      (p.toggle._listeners.click || []).length === 1 && !(p.toggle._listeners.keydown || []).length,
      'click=' + (p.toggle._listeners.click || []).length + ' keydown=' + ((p.toggle._listeners.keydown || []).length))
    // 键盘激活：浏览器对 Enter/Space 就是派发 click
    const before = p.body.classList.contains('bench-nav-collapsed')
    p.toggle.fire('click', {})
    push('B5 键盘激活（Enter/Space 在浏览器里等价于 click）走同一条路 ⇒ 状态翻转一次', p.body.classList.contains('bench-nav-collapsed') !== before)
    // 绝对写法：重复设同一个值不会来回翻
    rt.setNavCollapsed(true); rt.setNavCollapsed(true); rt.setNavCollapsed(true)
    push('B6 幂等：反复 setNavCollapsed(true) 之后仍是收起（绝对写法，不会"每次都翻"）',
      p.body.classList.contains('bench-nav-collapsed') === true && p.toggle.getAttribute('aria-expanded') === 'false')
    // 重复初始化（同一份 DOM 上再 init 一次）不许变成"一次点击翻两下"
    const again = mod.initNavSound({ doc: p.doc, win: p.win, loadNowPlaying: async () => ({ mountNowPlaying: () => ({ update() {}, unmount() {} }) }) })
    const was = p.body.classList.contains('bench-nav-collapsed')
    p.toggle.fire('click')
    push('B7 二次初始化后点一次仍然只翻一次（`__benchNavBound` 拦住重复绑定 ⇒ 不会"点一次翻两下"）',
      p.body.classList.contains('bench-nav-collapsed') !== was, 'was=' + was + ' now=' + p.body.classList.contains('bench-nav-collapsed'))
    push('B8 二次初始化返回的对象也可用（不抛）', !!again && typeof again.setNavCollapsed === 'function')
  }
  {
    const rt = await mkRuntime(mod, { store: { 'bench-sidebar-collapsed': '1' } })
    const p = rt.__page
    push('B9 刷新保持：记忆键 = ' + "'1'" + ' ⇒ 重载后仍是收起（body 类 + aria-expanded=false）',
      p.body.classList.contains('bench-nav-collapsed') && p.toggle.getAttribute('aria-expanded') === 'false')
  }
  {
    const rt = await mkRuntime(mod, { store: { 'bench-sidebar-collapsed': 'garbage' } })
    push('B10 非法记忆值 ⇒ 回落展开（不把页面卡在半个状态）', !rt.__page.body.classList.contains('bench-nav-collapsed'))
  }
  // 舞台跟着重算的几何账（模型：默认列 300 / mid 档 240，导轨 26）
  {
    const gain = (libW) => libW - mod.NAV_RAIL_W
    push('B11 舞台跟着重算：`#main` 宽度增量 = 默认列宽 − 导轨宽（300−26=274；mid 档 240−26=214；`#main` 是第 3 列 ⇒ 直接吃满）',
      gain(300) === 274 && gain(240) === 214 && /#main\{grid-column:3;/.test(htmlSrc) && /grid-template-columns:var\(--mpw-lib-w,300px\) auto minmax\(0,1fr\)/.test(htmlSrc),
      'Δ300=' + gain(300) + ' Δ240=' + gain(240))
  }

  /* ── ② 声音控件 + 遮挡 ── */
  /*  ③(2026-09-25 用户第 3 条) NP 栈回到两段（卡片 + 传输条）：那条 26px 的独立音量行撤掉了
      ⇒ 这里的 `VOL` 恒为 0（保留变量是为了让"卡片挂点顶边"的算式与静态表的 `--mpw-np-cover` 显式对上）。 */
  const CARD_MOUNT = 189, SHUT = 78, STRIP = res.strip, VOL = res.vol   /* ⑦：STRIP 现在 = 0（跟静态表取值，不再写死 30） */
  {
    const cardTop = VIEW.propsBottom - STRIP - VOL - CARD_MOUNT
    const rt = await mkRuntime(mod, { pad: res.pad, cardRect: { left: 1330, right: 1590, top: cardTop + (CARD_MOUNT - SHUT) / 2, bottom: cardTop + (CARD_MOUNT - SHUT) / 2 + SHUT, width: 260, height: SHUT } })
    const p = rt.__page
    push('B12 挂载走的是 P-138 的真实 API：`mountNowPlaying(#np-mount, {corner:16, stroke:false})`，且 `#props[data-np="mounted"]`',
      rt.__mounts.length === 1 && rt.__mounts[0].el === p.mount && rt.__mounts[0].opts.corner === 16 && rt.__mounts[0].opts.stroke === false &&
      p.props.getAttribute('data-np') === 'mounted', JSON.stringify(rt.__mounts.map((m) => m.opts)))
    const collapsedPlan = rt.npOcclusion()
    // 收起态遮挡：那一条 78px 的窄条（卡片居中于 189 的挂点里 ⇒ 上下各 55.5px 透明）+ 30px 传输条
    push('B13【契约已更新：第 ⑦ 项】收起态：遮挡矩形 = 78px 卡片（居中在 189px 挂点里），`cover` = 底边到卡片顶边 = **134px**（撤掉 30px 传输条前是 164）',
      collapsedPlan.cover === 134 && collapsedPlan.items === 30, JSON.stringify({ cover: collapsedPlan.cover, items: collapsedPlan.items }))
    push('B14 收起态实测：被遮挡的属性项 = **3** 项（卡片压住 2 项 + 传输条压住 1 项），遮挡透明空隙不计数',
      collapsedPlan.coveredCount === 3, 'covered=' + JSON.stringify(collapsedPlan.covered))
    // 展开态：卡片 = 189（组件自己 morph）
    rt.__snd.box._rect = { left: 1330, right: 1590, top: cardTop, bottom: cardTop + CARD_MOUNT, width: 260, height: CARD_MOUNT }
    rt.__snd.tap.setAttribute('aria-expanded', 'true')
    const expandedPlan = rt.npOcclusion()
    push('B15【契约已更新：第 ⑦ 项】展开态：`cover` = 卡片 189px（= 静态表的 `--mpw-np-cover`；传输条已撤、音量行在卡片**内部**，都不额外占高）',
      expandedPlan.cover === 189 && expandedPlan.cover === res.cover)
    push('B16【契约已更新】展开态实测：被遮挡的属性项 = **4** 项（比收起态多一项：卡片长大的那一截；改前是 5 项 —— 多出来的那项原本是独立音量条）',
      expandedPlan.coveredCount === 4, 'covered=' + JSON.stringify(expandedPlan.covered))
    push('B17 「不许永久遮住」：展开态下 30 项**全部**滚得到（`unreachable=0`）—— 因为滚动容器把展开态高度算进了 padding（`scrollKnown=true` ⇒ 这条不是"口径缺失换来的假绿"）',
      expandedPlan.unreachableCount === 0 && expandedPlan.items === 30 && expandedPlan.scrollKnown === true)
    push('B18 收起态同样 0 项不可达（两个状态都断言，不只看展开）', collapsedPlan.unreachableCount === 0 && collapsedPlan.scrollKnown === true)
    push('B19【契约已更新】实测数字写进了 DOM：`#np-host[data-cover|data-covered|data-unreachable|data-items]`（真机/X11 直接读）',
      p.host.getAttribute('data-cover') === '189' && p.host.getAttribute('data-covered') === '4' &&
      p.host.getAttribute('data-unreachable') === '0' && p.host.getAttribute('data-items') === '30')
    // 判别力自证（把预留拿掉 ⇒ 同一批项里有 4 项永远滚不到）
    const noReserve = mod.npOcclusionPlan({
      body: { top: VIEW.bodyTop, bottom: VIEW.propsBottom, scrollTop: 0, scrollHeight: 4 + 65 * 30 + 20 },
      card: { top: cardTop, bottom: cardTop + CARD_MOUNT, left: 1330, right: 1590 },
      strip: { top: VIEW.propsBottom - STRIP, bottom: VIEW.propsBottom, left: 1280, right: 1600 },
      items: p.items.map((el) => ({ id: el.dataset.propId, rect: el.getBoundingClientRect() })),
    })
    push('B20 判别力：把 `#props-body` 的底高预留拿掉（模拟改回产物默认 20px）⇒ 立刻出现 **3 项**"滚到底也看不到"（撤掉传输条前是 4；少的那一项就是原来被传输条压住的那条）⇒ B17/B18 不是恒真',
      noReserve.unreachableCount === 3, 'unreachable=' + JSON.stringify(noReserve.unreachable))
    push('B21【契约已更新】遮挡计数与"透明空隙"分辨得开（空隙不遮任何项）：收起/展开的 coveredCount 差 = 1（卡片长大 111px 恰好多吃一项；改前那 +1 是独立音量条）',
      expandedPlan.coveredCount - collapsedPlan.coveredCount === 1)
    // 「按它当前的范围大小算」：属性表滚动 ⇒ 被压住的是哪几项会变 ⇒ 去抖后重算（data-* 跟着更新）
    const idsBefore = p.host.getAttribute('data-covered-ids')
    p.propsBody.scrollTop = 200
    for (const el of p.items) { const r = el.getBoundingClientRect(); el._rect = { left: r.left, right: r.right, top: r.top - 200, bottom: r.bottom - 200, width: r.width, height: r.height } }
    p.propsBody.fire('scroll')
    await new Promise((r) => setTimeout(r, 200))
    push('B22 属性表滚动后重算：`data-scroll` 跟上（200），且被压住的是**另外几项**（不是钉在第一次测量上）',
      p.host.getAttribute('data-scroll') === '200' && !!idsBefore && p.host.getAttribute('data-covered-ids') !== idsBefore,
      'scroll=' + p.host.getAttribute('data-scroll') + ' ids: ' + idsBefore + ' → ' + p.host.getAttribute('data-covered-ids'))
  }

  /* ── ③ video 壁纸的声音 ── */
  {
    const cardTop = VIEW.propsBottom - STRIP - CARD_MOUNT
    const rt = await mkRuntime(mod, { cardRect: { left: 1330, right: 1590, top: cardTop + 55, bottom: cardTop + 55 + SHUT, width: 260, height: SHUT } })
    const p = rt.__page, v = p.videos[0]
    rt.probeStage()
    push('C1 探测到同源 iframe 里的 `<video>`（1 个）且认到 renderer 的 `__wp`（有 setVolume）',
      rt.stageVideos().length === 1 && !!rt.stageApi() && rt.activeVideo() === v)
    push('C2 默认静音：初始化后 `<video>.muted=true`（用户抱怨的是"没接进控件"，不是"必须自动出声"）',
      v.muted === true && rt.audio().muted === true)
    // 组件播放键 → video（真点击路径：按钮 → React 委托 → #np-host）
    firePath(rt.__snd.lead, 'click')
    await flush(4)
    push('C3 点组件的播放键 ⇒ `__wp.resume()` 被调 + `<video>` 真的开始播（paused=false，play() 调用 1 次）',
      p.frame.contentWindow.__wp.calls.some((c) => c[0] === 'resume') && v.paused === false && v._plays === 1,
      JSON.stringify(p.frame.contentWindow.__wp.calls))
    firePath(rt.__snd.lead, 'click')
    await flush(4)
    push('C4 再点一次（组件里是暂停）⇒ `__wp.pause()` + `<video>.paused=true`',
      p.frame.contentWindow.__wp.calls.filter((c) => c[0] === 'pause').length === 1 && v.paused === true)
    /*  ③(2026-09-25 用户第 3 条)**契约更新**：音量控件不再是页面上的 `#np-volume`（组件渲染在卡片里），
        所以这里驱动的是它的**落点**（组件 `send('volume', v)` → `npTransport('volume', v)` → `setVideoVolume(v)`）；
        控件本身的存在性/几何在浏览器档（bench-issue0924a-line-A A2*、bench-dsh-libroot B5b*、IA 组）里断言。 */
    rt.setVideoVolume(0.4)
    push('C5【契约已更新】音量落点：`setVideoVolume(0.4)`（= 组件音量轨 `onChange` 的那条链）→ `__wp.setVolume(0.4)` **并且** `<video>.volume=0.4 / muted=false`',
      p.frame.contentWindow.__wp.calls.some((c) => c[0] === 'setVolume' && c[1] === 0.4) && v.volume === 0.4 && v.muted === false,
      JSON.stringify({ volume: v.volume, muted: v.muted, calls: p.frame.contentWindow.__wp.calls.slice(-2) }))
    push('C5b【契约已更新】页面上的传输条 `#np-audio` 里**没有**音量滑条（`#np-volume` 只在组件里）—— 夹具与真页面同形，避免测一条不存在的路径',
      !p.audio.querySelector('#np-volume'))
    push('C6 工具条 `#volume` 只被**写值**、不派发事件（否则会触发产物重挂载 / 和 change 监听成环）',
      p.tbVol.value === '0.4' && p.tbVol._dispatched.length === 0, 'value=' + p.tbVol.value + ' dispatched=' + JSON.stringify(p.tbVol._dispatched))
    p.mute.fire('click')
    push('C7 静音键：`<video>.muted=true` 但滑块值保住（0.4），`aria-pressed` 与之一致',
      v.muted === true && v.volume === 0.4 && p.mute.getAttribute('aria-pressed') === 'true')
    p.mute.fire('click')
    push('C8 取消静音：`<video>.muted=false`、音量仍是 0.4、`aria-pressed=false`',
      v.muted === false && v.volume === 0.4 && p.mute.getAttribute('aria-pressed') === 'false')
    rt.setVideoVolume(0)
    push('C9 滑杆拉到 0 = 静音（muted=true）：音量通道自己就能静音', v.muted === true && rt.audio().effective === 0)
    rt.setVideoVolume(0.6)
    // 工具条那支改值 ⇒ 同步进控件与 video（另一个方向，同样只写值）
    p.tbVol.value = '0.25'
    p.tbVol.fire('change')
    push('C10【契约已更新】工具条音量变化 ⇒ 唯一真源与 `<video>` 跟着走（0.25）；组件侧的滑条值由 `pumpNp()` 推 `data.volume` 重画（读数走 `audio()`）',
      v.volume === 0.25 && rt.audio().vol === 0.25)
    // 进度同步（需求③）
    v.duration = 120; v.currentTime = 30
    v.fire('timeupdate')
    push('C11 进度与 `<video>.currentTime/duration` 同步：`#np-run` 宽度 25.00%、读数 0:30 / 2:00',
      p.run.style.width === '25.00%' && p.time.textContent === '0:30 / 2:00', p.run.style.width + ' | ' + p.time.textContent)
    v.duration = 300
    v.fire('durationchange')
    push('C12 `durationchange` 重新算（0:30 / 5:00、10.00%）—— 时长变了不会被钉在旧值上',
      p.time.textContent === '0:30 / 5:00' && p.run.style.width === '10.00%', p.time.textContent + ' | ' + p.run.style.width)
    // 点击进度条 = 跳转（ratio × duration）
    p.seek.fire('click', { clientX: 1480 })
    push('C13 点进度条中段（clientX 落在 50%）⇒ `<video>.currentTime = 150`（300 的一半）',
      Math.abs(v.currentTime - 150) < 1e-9, String(v.currentTime))
    // 重播 / 下一个
    p.run.style.width = '40%'; v.currentTime = 90
    firePath(rt.__snd.back, 'click')
    await flush(4)
    push('C14 组件的「重播」键 ⇒ `<video>.currentTime = 0`（同一个键在两个世界里同义）', v.currentTime === 0)
    const v2 = mkVideo()
    p.frame.contentDocument.appendChild(v2)
    rt.probeStage()
    firePath(rt.__snd.next, 'click')
    await flush(4)
    push('C15 组件的「下一个」键：舞台里有 2 个 video ⇒ 切到第 2 个（第 1 个暂停）；只有一个时与重播同义',
      v2.currentTime === 0 && v2._plays >= 1 && v.paused === true, JSON.stringify({ v1: v.paused, v2plays: v2._plays }))
    push('C16 重复探测不叠监听器（`el.__benchNpBound`）：每个媒体事件在同一个 `<video>` 上恰好 1 个监听器',
      (v._listeners.timeupdate || []).length === 1 && (v._listeners.durationchange || []).length === 1,
      'timeupdate=' + (v._listeners.timeupdate || []).length)
    push('C17 探测到了就自停（不留常驻定时器）：`armProbe()` 返回 null（不需要再排定时器）', rt.armProbe() === null)
  }
  {
    // 没有 `__wp`（renderer 还没就绪 / 老版本）时也必须真的作用到 <video>
    const rt = await mkRuntime(mod, { win__wp: undefined, cardRect: { left: 1330, right: 1590, top: 700, bottom: 778, width: 260, height: SHUT } })
    const p = rt.__page, v = p.videos[0]
    rt.probeStage()
    firePath(rt.__snd.lead, 'click')
    await flush(4)
    push('C18 `__wp` 缺席时播放键仍然真的作用到 `<video>`（直接 play()）', v.paused === false && v._plays === 1)
    rt.setVideoVolume(0.5)
    push('C19 `__wp` 缺席时音量仍然真的作用到 `<video>`（volume=0.5 / muted=false）', v.volume === 0.5 && v.muted === false)
  }
  {
    // `__wp` 在、但它没做到（版本漂移/半途失败）⇒ 兜底直写元素
    const rt = await mkRuntime(mod, { wpNoop: true, cardRect: { left: 1330, right: 1590, top: 700, bottom: 778, width: 260, height: SHUT } })
    const p = rt.__page, v = p.videos[0]
    rt.probeStage()
    firePath(rt.__snd.lead, 'click')
    await flush(4)
    push('C20 `__wp` 在但没动作（no-op）⇒ 兜底直写 `<video>`（播放键真的能控制它）', v.paused === false && p.frame.contentWindow.__wp.calls.some((c) => c[0] === 'resume'))
  }
  {
    // 非 video 壁纸（舞台里没有 <video>）：不抛、不动作，且把状态写在 DOM 上
    const rt = await mkRuntime(mod, { videos: [], cardRect: { left: 1330, right: 1590, top: 700, bottom: 778, width: 260, height: SHUT } })
    const p = rt.__page
    let threw = null
    try { rt.probeStage(); firePath(rt.__snd.lead, 'click'); rt.paintProgress() } catch (e) { threw = e.message }
    push('C21 没有 video 的壁纸（scene 类）：不抛、不动作，`#np-host[data-stage="0"]` / `data-state="no-video"`',
      threw === null && p.host.getAttribute('data-stage') === '0' && p.host.getAttribute('data-state') === 'no-video')
    push('C22 没有 video 时音量滑杆照常工作（不抛，值留住）', rt.setVideoVolume(0.35) === 0.35)
  }
  return F
}

/* ═══════════════════════════ 主跑 ═══════════════════════════ */
const patchSrc = fs.readFileSync(PATCH_PATH, 'utf8')
const htmlSrc = fs.readFileSync(HTML_PATH, 'utf8')
const mod = await import(pathToFileURL(PATCH_PATH).href + '?t=' + Date.now())

line('①(P-142) 资源管理器收纳 + 声音控件（NowPlaying）+ video 壁纸声音接线 —— 假 DOM 驱动真代码（无浏览器）')
group('A 静态结构与不变量（demo/index.html + demo/bench-patch.js 真源码）')
const A = staticFacts(patchSrc, htmlSrc, mod)
for (const f of A) check(f.name, f.ok, f.detail)
group('B/C 假 DOM 驱动真代码（收纳 / 遮挡 / video）')
const BC = await domFacts(mod, htmlSrc)
for (const f of BC) check(f.name, f.ok, f.detail)

/* ═══════════════════════════ 变异自证（os.tmpdir() 副本；真树不动） ═══════════════════════════ */
group('D 变异自证（RED-IF-REVERTED；副本在 os.tmpdir()）')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p142-mut-'))
  const mutations = [
    { id: 'nav:去掉 aria-expanded 同步（状态与无障碍信息脱钩）', file: 'bench-patch.js', from: "try { navBtn.setAttribute('aria-expanded', p.ariaExpanded) } catch {}", to: '' },
    { id: 'nav:收起改成"翻转"写法（classList.toggle(cls) 丢掉 want）', file: 'bench-patch.js', from: 'classList.toggle(p.bodyClass, p.collapsed)', to: 'classList.toggle(p.bodyClass)' },
    { id: 'nav:去掉重复绑定守卫（二次 init 后点一次翻两下）', file: 'bench-patch.js', from: 'if (navBtn && !navBtn.__benchNavBound) {', to: 'if (navBtn) {' },
    { id: 'nav:删掉"列宽 26px"规则（收起后舞台不会变宽）', file: 'index.html', from: 'html.bench-shell body.bench-nav-collapsed{--mpw-lib-w:26px}\n', to: '' },
    { id: 'sound:删掉 #props-body 的底高预留（展开后 4 项永远滚不到）', file: 'index.html', from: 'html.bench-shell #props-body{padding-bottom:calc(20px + var(--mpw-np-cover))}\n', to: '' },
    { id: 'sound:卡片高度写错（189 → 160，遮挡账与组件真实几何脱钩）', file: 'index.html', from: '--mpw-np-card:189px', to: '--mpw-np-card:160px' },
    { id: 'video:音量只写 API、不落到 <video>（API 缺席时音量失效）', file: 'bench-patch.js', from: 'try { el.volume = clamp01(vol); el.muted = !(eff > 0) } catch {}', to: '' },
    { id: 'video:播放/暂停只走 API、不核实元素（API no-op 时播放键失效）', file: 'bench-patch.js', from: 'if (a && want !== !a.paused) { try { want ? a.play() : a.pause() } catch {} }', to: '' },
    { id: 'video:进度不订 timeupdate（进度条不再跟 <video> 同步）', file: 'bench-patch.js', from: "const VIDEO_EVENTS = ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'ended', 'seeking', 'seeked', 'volumechange']", to: "const VIDEO_EVENTS = ['loadedmetadata', 'play', 'pause']" },
  ]
  const writeMut = (mut) => {
    const dir = fs.mkdtempSync(path.join(tmp, 'm-'))
    const p = fs.readFileSync(PATCH_PATH, 'utf8')
    const h = fs.readFileSync(HTML_PATH, 'utf8')
    const broken = mut.file === 'index.html' ? h.replace(mut.from, mut.to) : p.replace(mut.from, mut.to)
    const changed = broken !== (mut.file === 'index.html' ? h : p)
    // 两份都要落盘：index.html 的变异也要能被**原始** bench-patch.js 驱动（判据只改一处，别的照旧）
    fs.writeFileSync(path.join(dir, 'index.html'), mut.file === 'index.html' ? broken : h)
    fs.writeFileSync(path.join(dir, 'bench-patch.js'), mut.file === 'index.html' ? p : broken)
    return { dir, changed, patch: mut.file === 'index.html' ? p : broken, html: mut.file === 'index.html' ? broken : h }
  }
  for (const mut of mutations) {
    const m = writeMut(mut)
    check(`变异「${mut.id}」确实改到了文件`, m.changed)
    let red = []
    try {
      const mmod = await import(pathToFileURL(path.join(m.dir, 'bench-patch.js')).href + '?m=' + encodeURIComponent(mut.id))
      const facts = staticFacts(m.patch, m.html, mmod).concat(await domFacts(mmod, m.html))
      red = facts.filter((f) => !f.ok)
      check(`变异「${mut.id}」⇒ 判据变红（${red.length} 条红）`, red.length > 0, red.length ? '' : '改坏了却全绿 ⇒ 判据是假的')
      if (red.length) line(`    RED: ${red[0].name}${red[0].detail ? ' — ' + red[0].detail : ''}`)
      if (red.length && MUT_VERBOSE) for (const r of red) line(`      · ${r.name} — ${r.detail || ''}`)
    } catch (e) {
      check(`变异「${mut.id}」⇒ 判据变红（导入即抛也算红）`, true, 'throw: ' + e.message)
      line('    RED: 导入变异副本抛错 — ' + e.message)
    }
    fs.rmSync(m.dir, { recursive: true, force: true })
  }
  // 对照组：未变异的副本必须全绿（证明上面那些红是变异带来的，不是判据恒假）
  const ctrl = staticFacts(patchSrc, htmlSrc, mod).concat(await domFacts(mod, htmlSrc))
  const ctrlRed = ctrl.filter((f) => !f.ok)
  check('对照：未变异的真源码在同一批判据上全绿', ctrlRed.length === 0, ctrlRed.slice(0, 2).map((f) => f.name).join(' | '))
  fs.rmSync(tmp, { recursive: true, force: true })
}

/* ═══════════════════════════ 实测读数（绿跑也打印；数字与 B13–B18 断言同一批） ═══════════════════════════ */
group('实测读数（几何模型：`#props` 832 高 / `#props-body` 756 高 / `.prop` 行高 65px（= 产物 CSS 8+name+6+24+8+1）/ 30 项）')
{
  const res = reserveModel(htmlSrc)
  const cardTop = VIEW.propsBottom - res.strip - res.vol - res.card    // ①(第 ② 条) 减去音量条高度
  const items = []
  for (let i = 0; i < 30; i++) { const top = VIEW.bodyTop + 4 + 65 * i; items.push({ id: 'p' + i, rect: { left: 1280, right: 1600, top, bottom: top + 65 } }) }
  const bodyBase = { top: VIEW.bodyTop, bottom: VIEW.propsBottom, scrollTop: 0, scrollHeight: 4 + 65 * 30 + res.pad }
  const stripRect = { left: 1280, right: 1600, top: VIEW.propsBottom - res.strip, bottom: VIEW.propsBottom }
  const shut = 78                                                        // = now-playing-math.SHUT
  const collapsed = mod.npOcclusionPlan({ body: bodyBase, strip: stripRect, items, card: { left: 1330, right: 1590, top: cardTop + (res.card - shut) / 2, bottom: cardTop + (res.card - shut) / 2 + shut } })
  const expanded = mod.npOcclusionPlan({ body: bodyBase, strip: stripRect, items, card: { left: 1330, right: 1590, top: cardTop, bottom: cardTop + res.card } })
  const noReserve = mod.npOcclusionPlan({ body: Object.assign({}, bodyBase, { scrollHeight: 4 + 65 * 30 + 20 }), strip: stripRect, items, card: { left: 1330, right: 1590, top: cardTop, bottom: cardTop + res.card } })
  line(`  · 收起态：卡片 ${shut}px（居中于 ${res.card}px 挂点）⇒ cover **${collapsed.cover}px**，遮挡 **${collapsed.coveredCount} 项**（${collapsed.covered.join(',')}），滚不到 ${collapsed.unreachableCount} 项`)
  line(`  · 展开态：卡片 ${res.card}px ⇒ cover **${expanded.cover}px**（= 静态表 --mpw-np-cover），遮挡 **${expanded.coveredCount} 项**（${expanded.covered.join(',')}），滚不到 ${expanded.unreachableCount} 项`)
  line(`  · 判别力：把 \`#props-body\` 的底高预留拿掉（改回产物默认 20px）⇒ 立刻 **${noReserve.unreachableCount} 项**滚到底也看不到（${noReserve.unreachable.slice(0, 4).join(',')}…）`)
  line(`  · 收纳：导轨 ${mod.NAV_RAIL_W}px；`+'`#main`'+` 宽度增量 = 300−26 = 274px（mid 档 240−26 = 214px）；键名 \`${mod.NAV_COLLAPSED_STORE}\``)
  check('E1【契约已更新：第 ⑦ 项】读数自洽：收起/展开的 cover 与遮挡计数就是 B13–B16 断言的那四个数（**134/3 与 189/4**），且判别力非零（4）',
    collapsed.cover === 134 && collapsed.coveredCount === 3 && expanded.cover === 189 && expanded.coveredCount === 4 && noReserve.unreachableCount === 3,
    JSON.stringify({ collapsed: [collapsed.cover, collapsed.coveredCount], expanded: [expanded.cover, expanded.coveredCount], noReserve: noReserve.unreachableCount }))
}
/* ═══════════════════════════ 汇总 ═══════════════════════════ */
let pass = 0
for (const c of checks) { if (!c.ok) console.log(`FAIL  ${c.name}${c.detail !== undefined ? '  — ' + c.detail : ''}`); if (c.ok) pass++ }
const bucket = (re) => checks.filter((c) => re.test(c.name)).length
console.log(`\n${pass}/${checks.length} 通过（P-142 收纳 + 声音控件 + video 声音；A 静态 ${bucket(/^A\d/)} / B-C 假 DOM ${bucket(/^[BC]\d/)} / E 读数 ${bucket(/^E\d/)} / D 变异 ${bucket(/^变异|^对照/)}）`)
process.exit(pass === checks.length ? 0 : 1)

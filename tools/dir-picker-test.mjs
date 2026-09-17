// tools/dir-picker-test.mjs —— 选择文件夹/选择文件选择器的回归门禁（无需浏览器）
//
// 针对用户第 13 条点名的"长期没修好"的 bug：
//   「在选择文件夹的这个功能里面，鼠标上下滑动的时候，画面有时候会自动弹跳到最顶上，
//     包括有时候会自动锁定到最顶上」。
//
// 两组断言，**都带分辨力**（把实现改回旧写法必须变红；A 组直接拿 `git show HEAD:lib/client.js` 跑）：
//
//   A 组 源码级断言（当前实现 ↔ git HEAD 旧实现 双向跑；**注释剥离后**只看代码）
//        A1 滚动位置必须有人负责（按 key 记忆 + useLayoutEffect 绘制前同步写回）
//        A2 旧的补救式补偿必须已删除（锚点补偿 `scrollTop +=` / ratio 恢复 / 600ms 时间窗）
//        A3 滚动主权容器三件套（onScroll 只写 ref + overscroll-behavior:contain + overflow-anchor:none）
//        A4 键盘导航（role=listbox / tabIndex / aria-activedescendant / ↑↓ Home End Enter Esc）
//        A5 代码里没有 .focus()/autoFocus（焦点只能由用户点击产生）
//        A6 弹窗元素有稳定 key（防宿主无 key 兄弟数组下标顺移导致节点重建）
//        A7 目录行 key = 完整路径 + 目录名（不是裸目录名）
//
//   B 组 假 DOM + 迷你 React（切片 lib/client.js 的 MPW-DIRPICK 块，跑**生产实现**）
//        B1 刷新/过滤后 scrollTop 保持
//        B2 容器被 React 重建（新节点天然 scrollTop=0）→ 绘制前已恢复到用户最后一次位置
//        B3 焦点契约（§10.5）：打开聚焦容器 + preventScroll；行 tabindex=-1；行永不被 focus
//        B4 键盘行为（↓/↑/Home/End/Enter/Esc/Backspace）+ 只在按键时做最小位移
//        B5 滚轮不串联到宿主面板（overscroll-behavior: contain）
//        B6 滚动路径不触发重渲染（不在滚动里 setState）
//        B7 行级增量更新：刷新后行节点被复用（uid 不变），不是整表重建
//        B8 500 项大目录：刷新/重渲染后不跳顶，End 到底而不是回顶
//        B9 每个目录各自记住位置（互不串位）
//        B10 锚点值语义：null/undefined/""/NaN 一律当"无锚点"⇒ 夹住当前位置（直击 Number(null)=0 那个坑）
//        B11 宿主把弹窗整棵子树重新挂载（真机实测会发生）后，位置仍要恢复 ⇒ 记忆必须在模块级
//        B10 对照：**旧写法**在同一模型下必须失分（证明用例有分辨力）
//
// 假 DOM 的滚动语义按浏览器事实建模（这正是"改前实测"能成立的前提）：
//   · 新节点 scrollTop 天然 = 0（节点被 React 重建 ⇒ 位置丢失）
//   · scrollTop 钳到 [0, scrollHeight-clientHeight]
//   · scrollIntoView 滚动**最近的可滚动祖先**（不是行元素自己）
//   · 只有被显式 focus() 的元素才成为 activeElement；overscroll-behavior:contain ⇒ 不串联宿主
//
// 用法: node tools/dir-picker-test.mjs [--client <path>] [--no-legacy]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argClient = process.argv.indexOf('--client')
const CLIENT = argClient > 0 ? process.argv[argClient + 1] : path.join(ROOT, 'lib', 'client.js')
const SKIP_LEGACY = process.argv.includes('--no-legacy')

let pass = 0
const fails = []
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fails.push(name + (extra ? ' —— ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) } }
const head = (s) => console.log('\n\x1b[1m== ' + s + ' ==\x1b[0m')

const src = fs.readFileSync(CLIENT, 'utf8')

/* ══════════════════════════════════════════════════════════════════════
   注释剥离：字符串感知的小词法器（`image/*` 这种字符串里的 `/*` 不能当注释开头）
   ══════════════════════════════════════════════════════════════════════ */
export function stripComments(code) {
  let out = '', i = 0
  const n = code.length
  while (i < n) {
    const c = code[i], d = code[i + 1]
    if (c === '"' || c === "'" || c === '`') {           // 字符串 / 模板串：原样保留
      const q = c; out += c; i++
      while (i < n) {
        if (code[i] === '\\') { out += code[i] + (code[i + 1] || ''); i += 2; continue }
        out += code[i]
        if (code[i] === q) { i++; break }
        i++
      }
      continue
    }
    if (c === '/' && d === '/') { while (i < n && code[i] !== '\n') i++; continue }                                          // 行注释
    if (c === '/' && d === '*') { i += 2; while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue }  // 块注释
    out += c; i++
  }
  return out
}

/* ══════════════════════════════════════════════════════════════════════
   A 组：源码级断言（同一套函数分别对当前实现 / git HEAD 旧实现求值）
   ══════════════════════════════════════════════════════════════════════ */
export function auditSource(text) {
  const code = stripComments(text)
  const has = (re) => re.test(code)
  return {
    A1: has(/useMpwListScroll/) && has(/useLayoutEffect\s*\|\|\s*react\.useEffect/) && has(/MPW_LIST_SCROLL_MEM/) && has(/mpwScrollMemSet\(String\(key\)/),
    A2: !has(/dirScrollRef/) && !has(/\.scrollTop \+=/) && !has(/dirUserScrollAtRef/) && !has(/dirRestoredKeyRef/),
    A3: has(/overscrollBehavior:\s*"contain"/) && has(/overflowAnchor:\s*"none"/) && has(/onScroll:\s*sc\.onScroll/),
    A4: has(/role:\s*"listbox"/) && has(/tabIndex:\s*0/) && has(/aria-activedescendant/) && has(/k === "ArrowDown"/) && has(/k === "ArrowUp"/) && has(/k === "Home"/) && has(/k === "End"/) && has(/k === "Enter"/) && has(/k === "Escape"/),
    A5: !has(/autoFocus/) && (has(/\.focus\s*\(\s*\{\s*preventScroll:\s*true/) || !has(/\.focus\s*\(/)),   // 唯一允许的 focus 必须带 preventScroll:true（且不对行调用）
    A8: (code.match(/tabIndex:\s*-1/g) || []).length >= 2 && has(/onMouseDown:\s*noFocus/) && has(/ev\.preventDefault/),  // §10.5：行 tabindex=-1 + mousedown 阻止默认聚焦
    A9: has(/focusedOnceRef/) && has(/preventScroll:\s*true/),   // §10.5：弹窗打开时聚焦**容器**（一次），带 preventScroll
    A10: has(/mpwScrollTarget/) && has(/typeof raw === "number" && isFinite\(raw\)/) && !has(/Number\([^)]*anchor/i),  // §10.5：锚点缺失/非法 ⇒ 认领当前位置，绝不 Number(null)→0
    A11: has(/MPW_LIST_SCROLL_MEM/) && has(/mpwScrollMemSet\(/) && !has(/memRef\.current\[String\(key\)\]/),  // 记忆在**模块级**（活得比 React 树长）；真机实测宿主会 remount 弹窗
    A6: has(/key:\s*"mpw-dirpick"/),
    A7: has(/key: path \+ "\\u0000" \+ String\(name\)/),
  }
}
const A_LABEL = {
  A1: '滚动位置有人负责（模块级按 key 记忆 + useLayoutEffect 绘制前同步写回）',
  A2: '旧的补救式补偿已删除（锚点补偿 `scrollTop +=` / ratio 恢复 / 600ms 时间窗）',
  A3: '滚动主权容器三件套（onScroll 只写 ref + overscroll-behavior:contain + overflow-anchor:none）',
  A4: '键盘导航（listbox + tabIndex + aria-activedescendant + ↑↓/Home/End/Enter/Esc）',
  A5: '没有 autoFocus；唯一的 focus() 必须带 preventScroll:true（不对行调用）',
  A8: '行 tabindex=-1 + 行容器 mousedown 阻止默认聚焦（§10.5 不抢焦点契约）',
  A9: '弹窗打开时聚焦容器一次（preventScroll:true），重渲染不再抢焦点',
  A10: '锚点值只认"有限 number"（null/""/NaN 一律当无锚点 ⇒ 夹住当前位置，绝不回 0）',
  A11: '滚动记忆在**模块级**（跨 React 重挂存活；实例内记忆会被宿主 remount 清掉 —— 真机实测）',
  A6: '弹窗元素有稳定 key（防宿主无 key 兄弟数组下标顺移重建节点）',
  A7: '目录行 key = 完整路径 + 目录名（不是裸目录名）',
}
head('A 组：源码级断言（当前实现 ' + path.relative(ROOT, CLIENT) + '）')
const A = auditSource(src)
for (const k of Object.keys(A)) ok(A_LABEL[k], A[k])

if (!SKIP_LEGACY) {
  // ①(2026-09-17 判据轮修正) 对照用的"旧实现"必须是**修复落地前的那一次提交**，不能再用 `HEAD`：
  //   修复一旦被提交，`HEAD:lib/client.js` 就已经是"修复后"，本对照退化成"自己对自己" ⇒
  //   恒 0 失分、恒红（2026-09-17 实测：HEAD=7a20020 已含 MPW-DIRPICK 块，A 组 11/11 全绿，
  //   于是"旧实现必须失分"三条永远失败 —— 门禁假红，与本次壁纸层改动无关）。
  //   取法：`git log -S MPW-DIRPICK-BEGIN` 里**最早**引入该块的提交，取其**父提交**；
  //   取不到时回退固定 rev（环境变量 MPW_DIRPICK_BEFORE 可覆盖，便于人工指定对照点）。
  const BEFORE_REV = (() => {
    if (process.env.MPW_DIRPICK_BEFORE) return process.env.MPW_DIRPICK_BEFORE
    try {
      const list = execFileSync('git', ['log', '--format=%H', '-S', 'MPW-DIRPICK-BEGIN', '--', 'lib/client.js'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').filter(Boolean)
      const first = list[list.length - 1]        // 最早引入该块的那次提交
      if (first) return first + '^'
    } catch {}
    return '73b860f' + '^'                       // 兜底：引入该块之前的那次提交
  })()
  head('A 组对照：同一套断言跑**修复前**的实现 ' + BEFORE_REV + '（必须大面积变红 ⇒ 证明断言有分辨力）')
  let legacySrc = ''
  try {
    legacySrc = execFileSync('git', ['show', BEFORE_REV + ':lib/client.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) { console.log('  (跳过：拿不到 ' + BEFORE_REV + ' 版本 — ' + String((e && e.message) || e).split('\n')[0] + ')') }
  if (legacySrc) {
    const L = auditSource(legacySrc)
    const bad = Object.keys(L).filter((k) => !L[k])
    console.log('  旧实现失分: ' + bad.join(', ') + '（' + bad.length + '/' + Object.keys(L).length + '）')
    ok('旧实现必须失分（A1/A2/A3 至少各红一条）', bad.includes('A1') && bad.includes('A2') && bad.includes('A3'), '实际失分: ' + bad.join(','))
    ok('旧实现确实没有滚动恢复机制（A1 红）', !L.A1)
    ok('旧实现确实留着补救式补偿（A2 红）', !L.A2)
  }
}

/* ══════════════════════════════════════════════════════════════════════
   B 组：假 DOM + 迷你 React（跑 MPW-DIRPICK 块的真实实现）
   ══════════════════════════════════════════════════════════════════════ */
const bStart = src.indexOf('// ═══ MPW-DIRPICK-BEGIN ═══')
const bEnd = src.indexOf('// ═══ MPW-DIRPICK-END ═══')
const HAS_BLOCK = bStart >= 0 && bEnd >= 0                 // 旧实现没有这个块 ⇒ B 组直接判红（不是崩掉）
const BLOCK_SRC = HAS_BLOCK ? src.slice(bStart, bEnd) : ''
if (!HAS_BLOCK) {
  head('B 组：假 DOM 行为断言')
  ok('B 组可运行（lib/client.js 里有 MPW-DIRPICK 切片标记）', false, '找不到切片标记 ⇒ 选择器不是本契约的形状（旧实现）')
} else {

/* ---------- 迷你 DOM ---------- */
const ROW_H = 32, GAP = 6, PAD = 8
let nodeSeq = 0
let scrollWrites = []      // 记录每一次 scrollTop 写入（判"有没有人把位置归零"）
let activeElement = null

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.uid = ++nodeSeq
    this.children = []; this.parentElement = null; this.props = {}; this.style = {}; this._attrs = {}
    this._scrollTop = 0; this.clientHeight = 240; this._listeners = {}; this.scrollIntoViewCalls = []
    this._cls = new Set(); this._focused = false
    this.classList = { add: () => {}, remove: () => {}, contains: () => false, toggle() {} }
  }
  get className() { return this._className || '' }
  set className(v) { this._className = String(v == null ? '' : v); this._cls = new Set(this._className.split(/\s+/).filter(Boolean)) }
  hasClass(c) { return this._cls.has(c) }
  setAttribute(k, v) { this._attrs[k] = String(v) }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null }
  removeAttribute(k) { delete this._attrs[k] }
  hasAttribute(k) { return k in this._attrs }
  _rowTop(node) { const i = this.children.indexOf(node); return PAD + (i < 0 ? 0 : i) * (ROW_H + GAP) }
  getBoundingClientRect() { const top = this.parentElement ? this.parentElement._rowTop(this) : 0; return { top, bottom: top + ROW_H, left: 0, right: 300, width: 300, height: ROW_H, x: 0, y: top } }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); if (c.parentElement === this) c.parentElement = null; return c }
  remove() { if (this.parentElement) this.parentElement.removeChild(this) }
  contains(n) { let p = n; while (p) { if (p === this) return true; p = p.parentElement } return false }
  addEventListener(k, f) { (this._listeners[k] = this._listeners[k] || []).push(f) }
  removeEventListener(k, f) { if (this._listeners[k]) this._listeners[k] = this._listeners[k].filter((x) => x !== f) }
  dispatch(k, ev) { (this._listeners[k] || []).slice().forEach((f) => f(Object.assign({ type: k, target: this }, ev || {}))) }
  focus(opts) { this._focused = true; this._focusOpts = opts || null; activeElement = this }
  querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (matchSel(c, sel)) out.push(c); walk(c) } }; walk(this); return out }
  querySelector(sel) { const r = this.querySelectorAll(sel); return r.length ? r[0] : null }
  get scrollTop() { return this._scrollTop }
  set scrollTop(v) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight)
    const want = Number(v) || 0
    const prev = this._scrollTop
    this._scrollTop = Math.max(0, Math.min(want, max))
    scrollWrites.push({ uid: this.uid, cls: this.className, requested: want, value: this._scrollTop })
    if (this._scrollTop !== prev || want === 0) { this.dispatch('scroll', {}); if (this._onScrollProp) this._onScrollProp({ type: 'scroll', target: this }) }
  }
  get scrollHeight() { return PAD * 2 + this.children.length * (ROW_H + GAP) }
  scrollIntoView(opts) {
    this.scrollIntoViewCalls.push(opts || {})
    let sc = this.parentElement                                     // 浏览器语义：滚动最近的可滚动祖先
    while (sc && !(sc.style && /auto|scroll/.test(String(sc.style.overflowY || '')))) sc = sc.parentElement
    if (!sc) return
    const top = sc._rowTop(this), bot = top + ROW_H
    if (top < sc.scrollTop) sc.scrollTop = top
    else if (bot > sc.scrollTop + sc.clientHeight) sc.scrollTop = bot - sc.clientHeight
  }
}
function matchSel(n, sel) {
  const m = /^\[([\w-]+)="?([^"\]]*)"?\]$/.exec(sel.trim())
  if (m) return n.getAttribute(m[1]) === m[2]
  if (sel.startsWith('.')) return n.hasClass(sel.slice(1))
  return n.tagName === sel.toUpperCase()
}
const document = {
  body: new El('body'),
  createElement: (t) => new El(t),
  get activeElement() { return activeElement },
  set activeElement(v) { activeElement = v },
}
globalThis.document = document

/* ---------- 迷你 React（useState/useRef/useEffect/useLayoutEffect + **key 化协调**） ---------- */
function makeReact(host) {
  const hooks = []
  let cursor = 0, dirty = false, rootEl = null, dom = null
  const react = {
    createElement(type, props, ...kids) { return { __el: true, type, props: props || {}, kids: kids.flat(9).filter((k) => k !== null && k !== false && k !== undefined) } },
    Fragment: Symbol('Fragment'), memo: (f) => f,
    useState(init) {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = { v: typeof init === 'function' ? init() : init }
      const slot = hooks[i]
      return [slot.v, (nv) => { slot.v = typeof nv === 'function' ? nv(slot.v) : nv; dirty = true }]
    },
    useRef(v) { const i = cursor++; if (!(i in hooks)) hooks[i] = { v: { current: v === undefined ? null : v } }; return hooks[i].v },
    useEffect(f) { const i = cursor++; hooks[i] = { f, layout: false } },
    useLayoutEffect(f) { const i = cursor++; hooks[i] = { f, layout: true } },
    useMemo(f) { const i = cursor++; if (!(i in hooks)) hooks[i] = { v: f() }; return hooks[i].v },
    useCallback(f) { const i = cursor++; hooks[i] = { v: f }; return f },
  }
  const callComponent = () => {
    cursor = 0
    const out = rootEl.type(rootEl.props)
    const effs = hooks.filter((h) => h && h.f).map((h) => ({ f: h.f, layout: h.layout }))
    return { out, effs }
  }
  const applyHost = (node, el) => {
    const p = el.props || {}
    node.props = p
    if (p.className) node.className = p.className
    if (p.style) Object.assign(node.style, p.style)
    for (const k of Object.keys(p)) {
      if (k === 'children' || k === 'className' || k === 'style' || k === 'key' || k === 'ref' || /^on[A-Z]/.test(k)) continue
      if (p[k] === undefined || p[k] === null || p[k] === false) continue   // React：不渲染这些属性
      if (k === 'tabIndex') node.setAttribute('tabindex', String(p[k]))
      else node.setAttribute(k, String(p[k]))
    }
    if (p.ref && typeof p.ref === 'object') p.ref.current = node
    if (typeof p.onScroll === 'function') node._onScrollProp = p.onScroll
    node._key = el.props && el.props.key !== undefined ? String(el.props.key) : undefined
    return node
  }
  const textNode = (t) => { const n = new El('#text'); n.textContent = String(t); return n }
  const buildNode = (el) => {
    if (el === null || el === undefined || el === false) return null
    if (typeof el === 'string' || typeof el === 'number') return textNode(el)   // 文本子节点
    if (typeof el.type === 'function') return buildNode(el.type(el.props))
    const node = applyHost(new El(el.type), el)
    for (const kid of el.kids) { const n = buildNode(kid); if (n) node.appendChild(n) }   // 首次构建
    return node
  }
  const reconcile = (container, newKids) => {                    // 按 key 复用 ⇒ 行级增量更新，不整表重建
    const old = container.children.slice()
    const used = new Set()
    const out = []
    for (const kid of newKids) {
      if (kid === null || kid === undefined || kid === false) continue
      const isText = typeof kid === 'string' || typeof kid === 'number'
      const key = !isText && kid.props && kid.props.key !== undefined ? String(kid.props.key) : undefined
      const tag = isText ? '#TEXT' : String(kid.type).toUpperCase()
      let hit = old.find((c) => !used.has(c) && c._key === key && c.tagName === tag)
      if (hit) {
        used.add(hit)
        if (isText) { hit.textContent = String(kid); out.push(hit); continue }
        const p = kid.props || {}
        hit.props = p
        if (p.className) hit.className = p.className
        if (p.style) Object.assign(hit.style, p.style)
        if (typeof p.onScroll === 'function') hit._onScrollProp = p.onScroll
        if (p.ref && typeof p.ref === 'object') p.ref.current = hit
        reconcile(hit, kid.kids)
        out.push(hit)
      } else { const n = buildNode(kid); if (n) out.push(n) }
    }
    container.children = out
    out.forEach((c) => { c.parentElement = container })
    return container
  }
  const mount = (el) => {
    rootEl = el
    const { out, effs } = callComponent()
    dom = buildNode(out)
    effs.forEach((e) => e.f())
    return dom
  }
  const rerender = () => {
    dirty = false
    const { out, effs } = callComponent()
    if (host && host.remount) {
      // 模拟"节点被 React 重建"（宿主无 key 兄弟数组下标顺移 / 任何换掉该节点的情形）
      const parent = dom.parentElement
      const nd = buildNode(out)
      if (parent) { parent.removeChild(dom); parent.appendChild(nd) }
      dom = nd
    } else {
      applyHost(dom, out)          // 复用容器节点身份（scrollTop 保留）
      reconcile(dom, out.kids)     // 子节点按 key 协调
    }
    effs.forEach((e) => e.f())     // layout effect 在"绘制前"同步跑
    return dom
  }
  return { react, mount, rerender, isDirty: () => dirty }
}

/* ---------- 载入生产实现（切片） ----------
   ★ 真实模型：**插件模块只编译一次**（模块级的滚动记忆只有一份、跨 React 重挂存活），
   但每次渲染时 hooks 必须打到**当前那个 React 实例**的槽位上。
   所以这里用"一次编译 + react 代理"：代理把每次 hooks 调用转发给当前正在渲染的实例
   （`CURRENT_REACT`）。既能测"模块级记忆跨重挂"，又不会让 hooks 槽位串台。 */
let CURRENT_REACT = null
const proxyReact = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'then') return undefined                     // 别让 await/Proxy 误判为 thenable
    return (...args) => {
      const R = CURRENT_REACT
      if (!R || typeof R[prop] !== 'function') throw new Error('react.' + String(prop) + ' 在渲染之外被调用')
      return R[prop](...args)
    }
  }
})
const makeImpl = (react) => new Function('react', BLOCK_SRC + '\n;return { MpwDirList: MpwDirList, useMpwListScroll: useMpwListScroll, mpwScrollTarget: mpwScrollTarget, mpwDirChildPath: mpwDirChildPath, mpwDirParentPath: mpwDirParentPath };')(react)
const SHARED_IMPL = makeImpl(proxyReact)                       // ← 模块级：只编译一次

head('B 组：假 DOM + 迷你 React 行为断言（跑 MPW-DIRPICK 块的真实实现）')

function makeHost(opts) {
  const o = opts || {}
  const shell = new El('div'); shell.clientHeight = 600
  document.body.appendChild(shell)
  const events = { onOpen: [], onChoose: [], onClose: [], onUp: [], onPress: [] }
  let subs = o.subs || ['aaa', 'bbb', 'ccc', 'ddd']
  const path0 = o.path || '/home/u/Pictures'
  const props = () => ({
    path: path0, subs: subs, platform: 'linux', active: true, canUp: true,
    labelUp: 'up', labelEmpty: 'none',
    onOpen: (p) => events.onOpen.push(p), onChoose: () => events.onChoose.push(1),
    onClose: () => events.onClose.push(1), onUp: () => events.onUp.push(1),
    onPress: (n, i) => events.onPress.push(n),
  })
  const R = makeReact(o)
  const impl = SHARED_IMPL
  CURRENT_REACT = R.react                                      // 渲染前把 hooks 指向本实例
  let dom = R.mount(R.react.createElement(impl.MpwDirList, props()))
  const rerender = () => { CURRENT_REACT = R.react; return R.rerender() }
  shell.appendChild(dom)
  return {
    R, shell, events,
    container: () => dom,
    setSubs: (s) => { subs = s; dom = rerender() },
    userScrollTo: (v) => { dom.scrollTop = v; if (dom._onScrollProp) dom._onScrollProp({ type: 'scroll', target: dom }) },
    key: (k, extra) => {
      if (dom.props && dom.props.onKeyDown) dom.props.onKeyDown(Object.assign({ key: k, preventDefault() {}, altKey: false }, extra || {}))
      if (R.isDirty()) dom = rerender()        // 真实 React：setState 之后下一帧重渲染
    },
    hostScroll: (v) => { shell.scrollTop = v },
    activeIdx: () => dom.children.findIndex((c) => c.hasClass('mpw_rowActive')),
    rowAt: (i) => dom.querySelector('[data-mpw-diridx="' + i + '"]'),
  }
}

/* B1 刷新 / 过滤后位置保持 */
{
  const list = Array.from({ length: 20 }, (_, i) => 'dir' + String(i).padStart(3, '0'))
  const h1 = makeHost({ subs: list })
  h1.userScrollTo(120)
  h1.setSubs(list.slice())
  ok('B1 刷新（同内容新数组）后 scrollTop 保持 120', h1.container().scrollTop === 120, 'after=' + h1.container().scrollTop)
}
{
  const h2 = makeHost({ subs: Array.from({ length: 40 }, (_, i) => 'd' + i) })
  h2.userScrollTo(300)
  h2.setSubs(Array.from({ length: 12 }, (_, i) => 'd' + i))
  const c2 = h2.container()
  const newMax = Math.max(0, c2.scrollHeight - c2.clientHeight)
  ok('B1b 过滤后 scrollTop 夹到新范围（不是 0）', c2.scrollTop === Math.min(300, newMax) && c2.scrollTop > 0,
    `after=${c2.scrollTop} newMax=${newMax}`)
}
/* B2 容器被重建（新节点 scrollTop=0）→ 绘制前恢复 */
{
  const list = Array.from({ length: 30 }, (_, i) => 'x' + i)
  const h3 = makeHost({ subs: list, remount: true })
  h3.userScrollTo(178)
  const before = h3.container().scrollTop
  const oldUid = h3.container().uid
  h3.setSubs(list.slice())
  ok('B2 容器被 React 重建（新节点）后仍在用户最后一次的位置',
    h3.container().uid !== oldUid && h3.container().scrollTop === before && before === 178,
    'before=' + before + ' after=' + h3.container().scrollTop + ' 换了节点=' + (h3.container().uid !== oldUid))
}
/* B3 焦点契约（§10.5）：打开时聚焦**容器**（preventScroll），行永不获得焦点 */
{
  const sentinel = new El('button'); document.body.appendChild(sentinel); sentinel.focus()
  const h4 = makeHost({ subs: ['a', 'b', 'c'] })
  const c4 = h4.container()
  ok('B3a 打开后焦点在列表容器上（不是行、不是第 0 行）', document.activeElement === c4, 'active=' + (document.activeElement && document.activeElement.className))
  ok('B3b 聚焦容器时带 preventScroll:true（不会把容器滚进视野 ⇒ 不产生跳顶）',
    !!(c4._focusOpts && c4._focusOpts.preventScroll === true), JSON.stringify(c4._focusOpts))
  const afterOpen = document.activeElement
  CURRENT_REACT = h4.R.react; h4.R.rerender()
  ok('B3c 重渲染不再抢焦点（activeElement 不变）', document.activeElement === afterOpen && document.activeElement === c4)
  h4.key('ArrowDown'); h4.key('ArrowDown'); h4.key('Enter')
  ok('B3d 键盘导航不把焦点移到行上（activeElement 仍是容器）', document.activeElement === c4,
    'active=' + (document.activeElement && document.activeElement.className))
  ok('B3e 没有任何行/按钮被 focus()', c4.querySelectorAll('.mpw_prop').every((r) => !r._focused) && c4.querySelectorAll('button').every((b) => !b._focused))
  ok('B3f 所有行内按钮都是 tabIndex=-1（会被 Tab 跳过）',
    c4.querySelectorAll('button').every((b) => String(b.getAttribute('tabindex')) === '-1'),
    JSON.stringify(c4.querySelectorAll('button').map((b) => b.getAttribute('tabindex'))))
  ok('B3g 行容器带 onMouseDown 处理器（阻止默认聚焦）', typeof c4.querySelector('.mpw_prop').props.onMouseDown === 'function')
}
/* B4 键盘导航 */
{
  const h5 = makeHost({ subs: ['a', 'b', 'c', 'd'] })
  const label = (i) => (i < 0 ? '(无)' : (h5.container().children[i].getAttribute('data-mpw-dir') || 'up'))
  h5.key('ArrowDown')
  ok('B4a ↓ 首次选中第 1 个目录（索引 1：前面是"⬆ 上级"行）', h5.activeIdx() === 1, 'active=' + label(h5.activeIdx()))
  h5.key('ArrowDown')
  ok('B4b ↓ 下移一行', h5.activeIdx() === 2, 'active=' + label(h5.activeIdx()))
  h5.key('End')
  ok('B4c End 到最后一行（索引 4 = 第 4 个目录）', h5.activeIdx() === 4, 'active=' + label(h5.activeIdx()))
  h5.key('ArrowDown')
  ok('B4d 末行 ↓ 不越界', h5.activeIdx() === 4)
  h5.key('Home')
  ok('B4e Home 回第一行', h5.activeIdx() === 1, 'active=' + label(h5.activeIdx()))
  h5.key('ArrowUp')
  ok('B4f 首行 ↑ 不越界', h5.activeIdx() === 1)
  h5.key('Enter')
  ok('B4g Enter 进入活动行对应子目录', h5.events.onOpen.length === 1 && h5.events.onOpen[0] === '/home/u/Pictures/a', JSON.stringify(h5.events.onOpen))
  h5.key('Escape')
  ok('B4h Esc 关闭', h5.events.onClose.length === 1)
  h5.key('Backspace')
  ok('B4i Backspace = 上一级', h5.events.onUp.length === 1)
  const h6 = makeHost({ subs: ['a', 'b'] })
  h6.key('Enter')
  ok('B4j 未选行时 Enter = 选择此文件夹', h6.events.onChoose.length === 1 && h6.events.onOpen.length === 0)
  ok('B4k aria-activedescendant 指向活动行', (() => {
    const h = makeHost({ subs: ['a', 'b'] })
    const before = h.container().getAttribute('aria-activedescendant')
    h.key('ArrowDown')
    const after = h.container().getAttribute('aria-activedescendant')
    return before == null && after != null && h.rowAt(0) && after === h.rowAt(0).getAttribute('id')
  })())
  const h7 = makeHost({ subs: Array.from({ length: 60 }, (_, i) => 'r' + i) })
  h7.userScrollTo(500)
  CURRENT_REACT = h7.R.react; h7.R.rerender()
  ok('B4l 重渲染本身不产生 scrollIntoView（只有用户按键才做最小位移）', h7.container().scrollIntoViewCalls.length === 0)
  h7.key('End')
  const lastRow = h7.rowAt(59)
  ok('B4m 按键导致的活动行移动只用 block:"nearest"', !!lastRow && lastRow.scrollIntoViewCalls.length === 1 && lastRow.scrollIntoViewCalls[0].block === 'nearest')
}
/* B5 滚轮不串联 */
{
  const h8 = makeHost({ subs: Array.from({ length: 40 }, (_, i) => 'q' + i) })
  ok('B5a 容器带 overscroll-behavior:contain', h8.container().style.overscrollBehavior === 'contain')
  ok('B5b 容器带 overflow-anchor:none', h8.container().style.overflowAnchor === 'none')
  h8.hostScroll(0)
  h8.userScrollTo(999999)
  const chain = h8.container().style.overscrollBehavior === 'contain' ? 0 : 100   // 浏览器语义：contain ⇒ 不串联
  h8.hostScroll(0 + chain)
  ok('B5c 列表滑到底后滚轮不再滚动宿主面板（画面不跟着面板跳）', h8.shell.scrollTop === 0, 'host=' + h8.shell.scrollTop)
}
/* B6 滚动不触发重渲染 */
{
  const h9 = makeHost({ subs: Array.from({ length: 40 }, (_, i) => 's' + i) })
  h9.userScrollTo(50); h9.userScrollTo(90)
  ok('B6 滚动事件不产生 setState（不脏 ⇒ 不在滚动路径上重渲染）', h9.R.isDirty() === false)
}
/* B7 行级增量更新（不整表重建） */
{
  const list = Array.from({ length: 30 }, (_, i) => 'k' + i)
  const h10 = makeHost({ subs: list })
  const before = h10.rowAt(3).uid
  const c0 = h10.container().uid
  h10.setSubs(list.slice())
  ok('B7 刷新后行节点被复用（uid 不变）＝ 增量更新而非整表重建',
    h10.rowAt(3).uid === before && h10.container().uid === c0)
}
/* B8 500 项大目录：不跳顶/不锁顶 */
{
  const big = Array.from({ length: 500 }, (_, i) => 'big' + String(i).padStart(3, '0'))
  const h11 = makeHost({ subs: big })
  h11.userScrollTo(4000)
  const b = h11.container().scrollTop
  h11.setSubs(big.slice())
  const a = h11.container().scrollTop
  CURRENT_REACT = h11.R.react; h11.R.rerender()
  const c = h11.container().scrollTop
  ok('B8a 500 项目录：刷新 + 重渲染后 scrollTop 不跳顶', b === 4000 && a === 4000 && c === 4000, 'b=' + b + ' a=' + a + ' c=' + c)
  h11.key('End')
  ok('B8b 500 项目录：End（用户意图）到底而不是回顶', h11.container().scrollTop > 4000, 'afterEnd=' + h11.container().scrollTop)
  const zeroWrites = scrollWrites.filter((w) => w.value === 0 && w.requested !== 0 && /mpw_props/.test(w.cls))
  ok('B8c 没有任何一次把列表位置写回 0（旧写法的"跳到最顶"）', zeroWrites.length === 0, JSON.stringify(zeroWrites.slice(0, 3)))
}
/* B10 锚点值语义（与测试台 §10.5 / 他们实锤的 `Number(null)===0 && isFinite(0)` 坑对齐） */
{
  const api = SHARED_IMPL
  const T = api.mpwScrollTarget
  ok('B10a 有界内有效锚点：原样使用', T(600, 300, 1000) === 600)
  ok('B10b 锚点超出新范围 ⇒ **夹住**（不回 0）', T(600, 300, 400) === 400)
  ok('B10c 锚点 = null ⇒ 认领当前位置（旧写法 Number(null)=0 会给 0）', T(null, 300, 1000) === 300, 'got=' + T(null, 300, 1000))
  ok('B10d 锚点 = undefined ⇒ 认领当前位置', T(undefined, 300, 1000) === 300, 'got=' + T(undefined, 300, 1000))
  ok('B10e 锚点 = "" ⇒ 认领当前位置（Number("")=0 也是同一个坑）', T('', 300, 1000) === 300, 'got=' + T('', 300, 1000))
  ok('B10f 锚点 = NaN/Infinity ⇒ 认领当前位置', T(NaN, 300, 1000) === 300 && T(Infinity, 300, 1000) === 300)
  ok('B10g max 非法（NaN/负数）不产生负值或 NaN', T(600, 300, NaN) === 0 && T(600, 300, -5) === 0)
  // 对照：测试台实锤的旧写法（Number 强转）在同一输入下就是 0
  const legacy = (raw, max) => Math.max(0, Math.min(Number(raw) || 0, max))
  ok('B10h 对照：旧写法 Number(null)/Number("") 会得到 0 ⇒ 就是"锚点没了回 0"那个坑',
    legacy(null, 1000) === 0 && legacy('', 1000) === 0 && T(null, 300, 1000) === 300)
}

/* B11 组件整体重挂（宿主把弹窗整棵子树重新挂载）后仍恢复到用户位置
   —— 真机探针实测：宿主重渲染会 remount 弹窗 ⇒ **实例内**记忆丢失 ⇒ scrollTop 800→0。
   记忆必须放在模块级（活得比 React 树长），本断言就是它的门禁。 */
{
  const list = Array.from({ length: 30 }, (_, i) => 'rm' + i)
  const hA = makeHost({ subs: list, path: '/REMNT' })
  hA.userScrollTo(456)
  ok('B11a 第一棵树：位置已记住 456', hA.container().scrollTop === 456)
  const hB = makeHost({ subs: list, path: '/REMNT' })   // 新 React 实例 = 真机里的"重新挂载"
  ok('B11b 重新挂载（新实例、空 hooks）后仍恢复到 456（记忆不被卸载清掉）',
    hB.container().scrollTop === 456, 'after=' + hB.container().scrollTop)
  const hC = makeHost({ subs: list, path: '/REMNT' })
  hC.userScrollTo(120)
  ok('B11c 用户重新滚动后记忆跟随更新', hC.container().scrollTop === 120)
}

/* B9 每个目录各自记住位置 */
{
  const listA = Array.from({ length: 30 }, (_, i) => 'p' + i)
  const listB = Array.from({ length: 30 }, (_, i) => 'z' + i)
  const hA = makeHost({ subs: listA, path: '/A' })
  hA.userScrollTo(60)
  const hB = makeHost({ subs: listB, path: '/B' })
  hB.userScrollTo(20)
  ok('B9a 目录 A 记住 60', hA.container().scrollTop === 60)
  ok('B9b 目录 B 记住 20（互不串位）', hB.container().scrollTop === 20)
}

/* ---------- B 组对照：旧写法必须变红 ---------- */
if (!SKIP_LEGACY) {
  head('B 组对照：旧写法（复刻 git HEAD 的机制）在同一模型下必须失分')
  const R0 = makeReact({ remount: true })   // 对照宿主 = 节点会被重建的那种宿主
  const r0 = R0.react
  const LegacyList = (props) => {
    const p = props || {}
    const subs = Array.isArray(p.subs) ? p.subs : []
    // 旧写法三特征：无滚动记忆、无 overscroll-behavior、行 key = 裸目录名
    return r0.createElement('div', { className: 'mpw_props', style: { maxHeight: 240, overflowY: 'auto' } },
      [r0.createElement('div', { className: 'mpw_prop', key: '__up' }, [r0.createElement('button', { type: 'button' }, 'up')])]
        .concat(subs.map((sd) => r0.createElement('div', { className: 'mpw_prop', key: sd }, [r0.createElement('button', { type: 'button' }, '📁 ' + sd)]))))
  }
  const shell = new El('div'); shell.clientHeight = 600; document.body.appendChild(shell)
  const R = R0
  const list = Array.from({ length: 30 }, (_, i) => 'x' + i)
  const mk = () => R.react.createElement(LegacyList, { subs: list.slice(), path: '/A', active: true })
  let dom = R.mount(mk()); shell.appendChild(dom)
  dom.scrollTop = 178
  const before = dom.scrollTop
  const nd = R.rerender()                 // 内容刷新 → 节点被重建（remount 语义）
  ok('对照：旧写法丢位置（新节点 scrollTop=0）—— 用户看到的"自动弹跳到最顶上"', before === 178 && nd.scrollTop === 0, 'before=' + before + ' after=' + nd.scrollTop)
  ok('对照：旧写法容器无 overscroll-behavior ⇒ 滚轮到边界串联宿主面板', !nd.style.overscrollBehavior)
  ok('对照：旧写法容器无 overflow-anchor ⇒ 受 Firefox 滚动锚定搬动影响', !nd.style.overflowAnchor)
}

}   // ← 结束 B 组（仅当切片标记存在时执行）

/* ---------- 汇总 ---------- */
console.log('\n' + (fails.length ? '\x1b[31m' : '\x1b[32m') + '选择器回归：' + pass + ' 通过, ' + fails.length + ' 失败\x1b[0m')
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1) }
console.log('MPW-DIRPICK 块 = 选择器唯一实现；行为契约见 README「选择器行为契约」/ docs/DIR-PICKER-SCROLL.md')

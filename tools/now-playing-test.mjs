// tools/now-playing-test.mjs —— ①(NP-1 2026-09-19 用户第 1 条) Now playing 的常驻门禁
//
// 为什么需要它：
//   这一轮往**宿主的左侧栏**里放了一个控件（用户原话「now playing 挂载到 dsh 设置上面
//   有一个开关启用是否挂载 左边栏收起就隐藏」）。宿主侧栏是别人的 React 树，
//   三个最容易静默坏掉的地方恰好都不是"看一眼就知道"：
//     ① 开关**默认关**时到底有没有偷偷注入 DOM / 装观察者（"关不掉"是用户最烦的一类 bug）；
//     ② 挂载点是不是真的在「设置」入口**前面**（插错位置不会报错，只会出现在下面）；
//     ③ 左侧栏收起时组件有没有真的隐藏（判据依赖宿主常量 56px，写错阈值只会"有时候不隐藏"）。
//   再加上一半实现是**内联生成区**（lib/now-playing.js / -math.js 逐字节进 client.js，
//   因为宿主只下发 exports["./client"] 那**一个**文件）—— 生成物与源漂移是这类形态的经典坑
//   （docs/CLIENT-JS-SPLIT-ASSESSMENT.md §3(A) 明文要求配一条"生成物与源一致"的门禁）。
//
// 判据（7 组，全部无浏览器、假 DOM）：
//   A. 生成区与源**逐字节一致**（漂移门禁）+ 生成区确实在 buildCss 之前、只暴露 CSS/工厂两个名字
//   B. 开关**默认关** ⇒ 零注入（DOM 里 0 个 [data-mpw-now-playing]）+ 零观察者 + 产物里 0 行 NP 规则
//   C. 数学：两端 / 边界 / 同心圆角（corner 0/16/32）/ swell 峰值位置 / goo 两端为 0 / 八点四边形
//   D. 侧栏宽度 < 阈值 ⇒ data-mpw-np-hidden；恢复宽度 ⇒ 移除；量不到宽度时宿主信号兜底
//   E. 挂载点在「设置」入口**之前**（文档序断言）+ 重复开关/重复挂载只有一个容器 + 兜底锚点会留日志
//   F. 分辨力自证（RED-if-reverted）：6 组变异各自必须让**指定那一组**变红
//      （在 mkdtemp 副本里做，真树不动；夹具 < 1MB）
//   G. **真机复核回归**（探针 tools/np-sidebar-live-probe.mjs 抓到的 bug）：物理宽度优先于宿主信号
//      （256px 展开态不许被 wide=false 藏起来）+ slot 出口后出现重锚的那一刻不许翻转 hidden
//      + 搬动那一帧量到的异常几何不许粘住（一次性补判）。根因与时间线见 docs/NOW-PLAYING-DSH.md §7.6
//
// 用法: node tools/now-playing-test.mjs [--client <path>] [--no-mutations] [--json-only]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const NP_PATH = path.join(repoRoot, 'lib', 'now-playing.js')
const MATH_PATH = path.join(repoRoot, 'lib', 'now-playing-math.js')
const ONLY_JSON = process.argv.includes('--json-only')
/* 变异子进程不许再跑变异段（否则孙进程 = fork 炸弹；与 switch-wiring-test 同一条纪律）。 */
const NO_MUT = process.argv.includes('--no-mutations')

/* 真实断言助手（本仓教训：ok(name, detail) 恒真 = 假绿） */
let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-now-playing-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

/* ══════════════════════ 加载：CJS 风格的源（与 tools/_stub.mjs 同一条路） ══════════════════════
   本仓 package.json 是 "type":"module" ⇒ 直接 import 一个 CJS 风格的 .js 会**静默得到空对象**
   （不报错！）。这里用与 _stub.mjs 载入 client.js 完全相同的 new Function 形态，
   并**断言导出非空** —— 空导出必须当场炸，而不是变成一堆"看起来通过"的断言。 */
function loadCjsSource(file) {
  const src = fs.readFileSync(file, 'utf8')
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, (name) => { throw new Error('不该 require(' + name + ')') })
  const keys = Object.keys(m.exports || {})
  if (!keys.length) throw new Error('空导出（加载方式错了？见文件头）：' + file)
  return m.exports
}

/* ══════════════════════ A. 生成区提取（从**真实产物**里读，而不是读源文件） ══════════════════════
   测试必须打"真正发货的那份代码"：模块的运行时副本在 client.js 的生成区里。
   提取判据由 tools/build-now-playing.mjs 的输出形态固定（两条 IIFE + 固定前后缀）。 */
const GEN_START = '// >>> MPW-NP-GEN-START (generated — do not edit by hand)'
const GEN_END = '// <<< MPW-NP-GEN-END'

function regionOf(src) {
  const a = src.indexOf(GEN_START)
  const b = src.indexOf(GEN_END)
  if (a < 0 || b < 0 || b < a) return null
  return src.slice(a, b + GEN_END.length)
}
/** 从生成区里抠出一条 IIFE 的正文。正文是**逐字节内联**的（生成器不留缩进，见其文件头），
    所以这里不做任何变换 —— 抠出来的字符串必须与源文件逐字节相同。 */
const IIFE_HEAD = '\n\t\t\tconst module = { exports: {} };\n'
const IIFE_TAIL = '\n\t\t\treturn module.exports;'
function iifeBody(region, header) {
  const i = region.indexOf(header)
  if (i < 0) return null
  const j = region.indexOf(IIFE_HEAD, i)
  if (j < 0) return null
  const k = region.indexOf(IIFE_TAIL, j)
  if (k < 0) return null
  return region.slice(j + IIFE_HEAD.length, k)
}

const clientSrc = fs.readFileSync(clientPath, 'utf8')
const region = regionOf(clientSrc)
let NP = null, MATH = null
console.log(`══ Now playing 门禁（生成区漂移 + 开关默认关 + 挂载顺序 + 收起隐藏 + 单实例）══\n产物：${path.relative(repoRoot, clientPath)}`)

console.log('\n== A. 生成区（lib/client.js 的内联区）与源逐字节一致 ==')
{
  ok('A1 产物里有生成区标记（MPW-NP-GEN-START/END）', !!region,
    region ? region.length + ' 字符' : '未找到 —— 生成器没跑过？')
  if (region) {
    const mathSrc = fs.readFileSync(MATH_PATH, 'utf8').replace(/\n$/, '')
    const compSrc = fs.readFileSync(NP_PATH, 'utf8').replace(/\n$/, '')
    const gotMath = iifeBody(region, 'const MPW_NP_MATH = (function () {')
    const gotComp = iifeBody(region, 'const MPW_NP = (function () {')
    ok('A2 生成区里的 lib/now-playing-math.js 与源逐字节一致（无漂移）',
      gotMath === mathSrc, gotMath === null ? '抠不出正文' : ('生成区 ' + (gotMath || '').length + ' 字符 / 源 ' + mathSrc.length + ' 字符'))
    ok('A3 生成区里的 lib/now-playing.js 与源逐字节一致（无漂移）',
      gotComp === compSrc, gotComp === null ? '抠不出正文' : ('生成区 ' + (gotComp || '').length + ' 字符 / 源 ' + compSrc.length + ' 字符'))
    ok('A4 生成区只额外暴露三个名字（MPW_NP_MATH / MPW_NP / MPW_NP_CSS），不泄漏别的绑定',
      /const MPW_NP_CSS = MPW_NP\.NP_CSS;/.test(region) && (region.match(/^[ \t]*const MPW_NP[A-Z_]* =/gm) || []).length === 3,
      (region.match(/^[ \t]*const MPW_NP[A-Z_]* =/gm) || []).join(' , '))
    ok('A5 生成区在 buildCss 之前（常量必须先于使用点定义，否则 TDZ）',
      clientSrc.indexOf(GEN_START) < clientSrc.indexOf('function buildCss(section) {'),
      'region@' + clientSrc.indexOf(GEN_START) + ' buildCss@' + clientSrc.indexOf('function buildCss(section) {'))
    try {
      MATH = iifeBody(region, 'const MPW_NP_MATH = (function () {')
      const mm = { exports: {} }
      new Function('module', 'exports', 'require', MATH)(mm, mm.exports, () => { throw new Error('np math 不该 require') })
      NP = (() => {
        const cm = { exports: {} }
        new Function('module', 'exports', 'require', iifeBody(region, 'const MPW_NP = (function () {'))(cm, cm.exports, () => { throw new Error('np 不该 require') })
        return cm.exports
      })()
      ok('A6 从生成区里能取到运行期模块（数学 ' + Object.keys(mm.exports).length + ' 项 / 组件 ' +
        Object.keys(NP).length + ' 项）', Object.keys(mm.exports).length > 60 && typeof NP.createNowPlaying === 'function')
      MATH = mm.exports
    } catch (e) {
      ok('A6 从生成区里能取到运行期模块', false, String(e && e.message || e))
    }
  }
}

/* ══════════════════════ 假 DOM（无浏览器；只实现这一轮真正用到的那一小撮语义） ══════════════════════ */
function parseCompound(txt) {
  const parts = []
  const re = /\[([a-zA-Z-]+)(?:([*$^]?=)"([^"]*)")?\]|\.([A-Za-z0-9_-]+)/g
  let m
  while ((m = re.exec(txt))) {
    if (m[1]) parts.push({ attr: m[1], op: m[2] || null, val: m[3] })
    else if (m[4]) parts.push({ cls: m[4] })
  }
  return parts
}
function attrOf(el, k) {
  if (k === 'class') return el.className || ''
  return el.hasAttribute(k) ? el.getAttribute(k) : null
}
function matchCompound(el, parts) {
  for (const p of parts) {
    if (p.cls) {
      if ((' ' + String(el.className || '') + ' ').indexOf(' ' + p.cls + ' ') < 0) return false
      continue
    }
    const v = attrOf(el, p.attr)
    if (v === null) return false
    if (p.op === '*=' && String(v).indexOf(p.val) < 0) return false
    if (p.op === '=' && String(v) !== p.val) return false
    if (p.op === '$=' && String(v).slice(-p.val.length) !== p.val) return false
    if (p.op === '^=' && String(v).slice(0, p.val.length) !== p.val) return false
  }
  return true
}
function matchesSel(el, sel) {
  const steps = String(sel).trim().split(/\s+/).map(parseCompound)
  if (!steps.length) return false
  if (!matchCompound(el, steps[steps.length - 1])) return false
  let n = el.parentNode, i = steps.length - 2
  while (i >= 0 && n) { if (matchCompound(n, steps[i])) i--; n = n.parentNode }
  return i < 0
}
function walk(el, fn) { fn(el); for (const c of el.childNodes.slice()) walk(c, fn) }

function makeDoc() {
  const doc = { __w: 0 }
  const mk = (tag) => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), nodeType: 1,
      __attrs: new Map(), __w: 300, className: '', childNodes: [], parentNode: null, isConnected: true,
      style: {
        _m: new Map(),
        setProperty(k, v) { this._m.set(String(k), String(v)) },
        removeProperty(k) { this._m.delete(String(k)) },
        getPropertyValue(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : '' },
      },
      get children() { return this.childNodes },
      get firstChild() { return this.childNodes[0] || null },
      get nextSibling() {
        const p = this.parentNode; if (!p) return null
        const i = p.childNodes.indexOf(this)
        return i >= 0 ? (p.childNodes[i + 1] || null) : null
      },
      setAttribute(k, v) { this.__attrs.set(String(k), v === void 0 || v === null ? '' : String(v)) },
      getAttribute(k) { const q = String(k); return this.__attrs.has(q) ? this.__attrs.get(q) : null },
      removeAttribute(k) { this.__attrs.delete(String(k)) },
      hasAttribute(k) { return this.__attrs.has(String(k)) },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c },
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c)
        const i = ref ? this.childNodes.indexOf(ref) : -1
        if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c)
        c.parentNode = this; return c
      },
      removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null } return c },
      remove() { if (this.parentNode) this.parentNode.removeChild(this) },
      getBoundingClientRect() { return { x: 0, y: 0, width: this.__w, height: 200, top: 0, left: 0, right: this.__w, bottom: 200 } },
      closest(sel) { let n = this; while (n) { if (matchesSel(n, sel)) return n; n = n.parentNode } return null },
      matches(sel) { return matchesSel(this, sel) },
      querySelectorAll(sel) { const out = []; for (const c of this.childNodes) walk(c, (n) => { if (matchesSel(n, sel)) out.push(n) }); return out },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null },
    }
    return el
  }
  doc.createElement = mk
  doc.documentElement = mk('html')
  doc.body = doc.documentElement.appendChild(mk('body'))
  doc.head = doc.documentElement.appendChild(mk('head'))
  doc.querySelector = (s) => doc.documentElement.querySelector(s)
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s)
  return doc
}

/** 造一棵与**真机结构同形**的侧栏（字段名逐条来自宿主源码 + 真机 DOM 核对，见 docs/NOW-PLAYING-DSH.md §3）。 */
function buildSidebar(doc, opts) {
  const o = opts || {}
  const frame = doc.body.appendChild(doc.createElement('div'))
  frame.className = 'pI_x6G_frame'
  const col = frame.appendChild(doc.createElement('div'))
  col.className = 'pI_x6G_sidebarCol'
  col.__w = o.width === void 0 ? 280 : o.width
  const root = col.appendChild(doc.createElement('div'))
  root.className = 'hHd-Xa_root hHd-Xa_quietBars'
  root.setAttribute('data-mpw-sidebar-root', '')
  const foot = root.appendChild(doc.createElement('div'))
  foot.className = 'hHd-Xa_footArea'
  const actions = foot.appendChild(doc.createElement('div'))
  actions.className = 'hHd-Xa_footerActions'
  const slot = actions.appendChild(doc.createElement('div'))
  slot.setAttribute('data-slot', 'sidebar.footer.action')
  slot.setAttribute('data-mpw-np-slot', '')
  slot.className = 'mpw_np_slot'
  const settingsArea = foot.appendChild(doc.createElement('div'))
  settingsArea.className = 'hHd-Xa_settingsArea'
  const settingsSlot = settingsArea.appendChild(doc.createElement('div'))
  settingsSlot.setAttribute('data-slot', 'sidebar.settings')
  const triggerRow = settingsSlot.appendChild(doc.createElement('div'))
  triggerRow.className = 'VOzbGW_triggerRow'
  const trigger = triggerRow.appendChild(doc.createElement('button'))
  trigger.className = 'VOzbGW_trigger'
  trigger.setAttribute('aria-label', '设置')
  return { frame, col, root, foot, actions, slot, settingsArea, settingsSlot, trigger }
}

/** 文档序（先序）——"在设置入口之前"就是拿这个数比的，不依赖父子层级。 */
function docOrder(doc, el) {
  let n = -1, hit = -1
  walk(doc.documentElement, (x) => { n++; if (x === el && hit < 0) hit = n })
  return hit
}

/** 计数版 window：观察者/raf 一律记账 ⇒ "关的时候零观察者"是可断言的。 */
function makeWin() {
  const counts = { resize: 0, mutation: 0, raf: 0, caf: 0, liveResize: 0, liveMutation: 0, liveRaf: 0 }
  const resizeCbs = [], mutCbs = []
  const logs = []
  const win = {
    __counts: counts, __resizeCbs: resizeCbs, __mutCbs: mutCbs,
    ResizeObserver: class { constructor(cb) { counts.resize++; counts.liveResize++; resizeCbs.push(cb) } observe() {} disconnect() { counts.liveResize-- } },
    MutationObserver: class { constructor(cb) { counts.mutation++; counts.liveMutation++; mutCbs.push(cb) } observe() {} disconnect() { counts.liveMutation-- } },
    requestAnimationFrame: (f) => { counts.raf++; counts.liveRaf++; return setTimeout(() => { counts.liveRaf--; f(Date.now()) }, 0) },
    cancelAnimationFrame: () => { counts.caf++ },
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (h) => clearTimeout(h),
    performance: { now: () => Date.now() },
  }
  win.__logs = logs
  win.__log = { info: (...a) => logs.push(['info', a.join(' ')]), warn: (...a) => logs.push(['warn', a.join(' ')]), error: (...a) => logs.push(['error', a.join(' ')]) }
  return win
}

const stubReact = { createElement: (type, props, ...kids) => ({ __el: true, type, props: props || {}, kids }) }

/** 造一个控制器：switchOn 决定初始开关（默认 false = 默认档）。 */
function makeCtl(doc, win, opts) {
  const o = opts || {}
  let rendered = 0
  const mod = NP.createNowPlaying({
    math: MATH, react: stubReact, t: (k) => k, doc, win, log: win.__log,
    createRoot: () => ({ render: () => { rendered++ }, unmount: () => {} }),
    onTransport: o.onTransport || (() => {}),
  })
  const ctl = mod.createController()
  return { mod, ctl, renders: () => rendered }
}

/* ══════════ B. 开关默认**开**（①(NP-3) 新要求）⇒ 默认档就接线；关档仍零注入零观察者 ══════════
   ①(NP-3 2026-09-19) 语义变更（用户裁定，不是放宽）：
     · 默认值从 false 改成 **true**（"NP 开关默认改成开"）；
     · 于是"关 ⇒ 零注入"那几条判据的**夹具**必须显式写 `npNowPlaying: false`（以前靠默认值），
       而"默认档 ⇒ 真的挂上"变成新判据（B1b/B12）。
   断言只增不减：B1 改判 true、B8/B10 的夹具改成显式关，新增 B1b/B12/B13。 */
console.log('\n== B. 开关默认开（DEFAULT_NP_NOW_PLAYING=true）⇒ 默认档接线；显式关仍零注入 ==')
{
  ok('B1 源码里的默认值是 true（改回 false 必须让本组变红）',
    /const DEFAULT_NP_NOW_PLAYING = true;/.test(clientSrc),
    (clientSrc.match(/const DEFAULT_NP_NOW_PLAYING = [^;]+;/) || ['<未找到>'])[0])
  /* ①(NP-4) B2 收紧：原来只判"npNowPlaying 是 boolFields 的**最后一个**元素"（`[^\]]*"npNowPlaying"\]`）
     —— NP-4 在它后面追加了 `npLinkWallpaper`，那条正则就恒假（**判据绑在了"谁是最后一个"上**，
     这是断言写法的问题，不是放宽）。现在判"它在这个数组里、且数组以它或它的兄弟收尾"，
     并同时判新键也在（只增不减：原来真正想说的"已登记"一个字都没少）。 */
  ok('B2 npNowPlaying 已登记进 boolFields（否则接线审计与导入净化都会漏掉它）',
    /const boolFields = \[[^\]]*"npNowPlaying"[^\]]*\]/.test(clientSrc))
  ok('B2b ①(NP-4)② npLinkWallpaper 也登记进 boolFields（新开关同样要过接线审计）',
    /const boolFields = \[[^\]]*"npLinkWallpaper"[^\]]*\]/.test(clientSrc))
  ok('B2c ①(NP-4)① npVolume 登记进 numFields（导入净化按数值走，字符串会被拒）',
    /const numFields = \[[^\]]*"npVolume"[^\]]*\]/.test(clientSrc))
  ok('B3 npNowPlaying 已登记进 BACKUP_FIELDS（随备份导出/导入）',
    /const BACKUP_FIELDS = \[[\s\S]{0,1400}?"npNowPlaying"/.test(clientSrc))
  /* 开关关：控制器一个节点都不建、一个观察者都不装 */
  {
    const doc = makeDoc(); buildSidebar(doc, { width: 280 })
    const win = makeWin()
    const { ctl } = makeCtl(doc, win)
    ctl.setEnabled(false)
    ok('B4 关 ⇒ DOM 里 0 个 [data-mpw-now-playing]',
      doc.querySelectorAll('[data-mpw-now-playing]').length === 0,
      '实际 ' + doc.querySelectorAll('[data-mpw-now-playing]').length)
    ok('B5 关 ⇒ 0 个观察者、0 次 rAF（构造数 = 0，不是"装了再断"）',
      win.__counts.resize === 0 && win.__counts.mutation === 0 && win.__counts.raf === 0,
      JSON.stringify(win.__counts))
    /* 控制器**自己不会**自动挂载：开关的落点是 apply 路径（applyNowPlaying → setEnabled）。
       所以"造出来但不 setEnabled"必须零注入零观察者 —— 这一条与默认值无关，永远成立。 */
    const doc2 = makeDoc(); buildSidebar(doc2, { width: 280 })
    const win2 = makeWin()
    makeCtl(doc2, win2)
    ok('B6 控制器造出来但没人调 setEnabled ⇒ 零注入零观察者（挂载只由开关落点驱动）',
      doc2.querySelectorAll('[data-mpw-now-playing]').length === 0 && win2.__counts.resize === 0 && win2.__counts.mutation === 0,
      JSON.stringify(win2.__counts))
  }
  /* 真产物的 CSS：关 ⇒ 一行 NP 规则都没有；开 ⇒ 有。这是"产物级"的零注入判据。 */
  let built = null
  try {
    const { loadPlugin } = await import('./_stub.mjs')
    const loaded = loadPlugin({ clientPath, settings: {}, quiet: true })
    if (loaded.applyErrors.length) ok('B7 产物的 buildCss 可跑（apply 无错）', false, loaded.applyErrors.slice(0, 2).join(' | '))
    else if (typeof globalThis.__mpwBuildCss !== 'function') ok('B7 产物的 buildCss 可跑（apply 无错）', false, '未暴露 __mpwBuildCss')
    else {
      ok('B7 产物的 buildCss 可跑（apply 无错）', true)
      const off = String(globalThis.__mpwBuildCss({ image: true, enabled: true, npNowPlaying: false }) || '')
      const on = String(globalThis.__mpwBuildCss({ image: true, enabled: true, npNowPlaying: true }) || '')
      const dflt = String(globalThis.__mpwBuildCss({ image: true, enabled: true }) || '')
      ok('B8 开关**显式关** ⇒ 产物里 0 处 [data-mpw-now-playing] / .mpw_np_ 规则',
        off.indexOf('data-mpw-now-playing') < 0 && off.indexOf('.mpw_np_') < 0,
        '关档里 NP 命中 ' + (off.split('data-mpw-now-playing').length - 1) + ' 次')
      ok('B9 开关开 ⇒ 产物里出现 NP 规则（开关真的接线了）',
        on.indexOf('data-mpw-now-playing') >= 0 && on.indexOf('.mpw_np_box') >= 0)
      /* 纯增量：把 NP 那一段整块从"开"里去掉，应当逐字节回到"关" */
      const NP_CSS = NP && NP.NP_CSS
      ok('B10 NP 规则是**纯追加**：开档 − NP 段 == 关档（逐字节）',
        !!NP_CSS && on.split(NP_CSS).join('') === off,
        '开 ' + on.length + ' 字节 / 关 ' + off.length + ' 字节 / NP 段 ' + (NP_CSS || '').length)
      ok('B11 桩 DOM 里 0 个 NP 节点（桩没有宿主侧栏锚点 ⇒ 不注入，也不崩）',
        (() => { let n = 0; walk(globalThis.document.documentElement, (x) => { if (x.hasAttribute && x.hasAttribute('data-mpw-now-playing')) n++ }); return n === 0 })(),
        '桩 DOM 全树 0 命中')
      /* ①(NP-3) 新判据：默认档（section 里**没有**这个键）必须走"开"这条产物路径 */
      ok('B1b 默认档（section 里没有 npNowPlaying 键）⇒ 产物里就有 NP 规则（默认开真的生效）',
        dflt.indexOf('data-mpw-now-playing') >= 0 && dflt.split(NP_CSS || '\u0000').join('') === off,
        '默认档 ' + dflt.length + ' 字节；与显式关档 ' + (dflt === off ? '相同' : '不同'))
      /* ①(NP-3) 真机 bug 的产物级判据：**没有壁纸**（无 image/webUrl）时，buildCss 走的是
         `if (!hasImage)` 那条提前 return —— 它以前忘了拼 __npCss ⇒ NP 控件整份样式丢失
         （真机现场：用户的 section 正是"mpkgKey 还在、image 没了"这种半残档）。 */
      {
        const onNoImg = String(globalThis.__mpwBuildCss({ npNowPlaying: true }) || '')
        const offNoImg = String(globalThis.__mpwBuildCss({ npNowPlaying: false }) || '')
        ok('B12 **无壁纸**（无 image/webUrl）那条 return 路径也必须带 NP 段（真机"控件没样式"的根因）',
          onNoImg.indexOf('data-mpw-now-playing') >= 0 && onNoImg.indexOf('.mpw_np_box') >= 0,
          '无壁纸 + 开：NP 命中 ' + (onNoImg.split('data-mpw-now-playing').length - 1) + ' 次；长度 ' + onNoImg.length)
        ok('B13 无壁纸路径上 NP 段同样是**纯追加**（开 − NP 段 == 关，逐字节）',
          !!NP_CSS && onNoImg.split(NP_CSS).join('') === offNoImg,
          '无壁纸：开 ' + onNoImg.length + ' / 关 ' + offNoImg.length + ' / NP 段 ' + (NP_CSS || '').length)
      }
      built = { off, on }
    }
  } catch (e) { ok('B7 产物的 buildCss 可跑（apply 无错）', false, String(e && e.message || e)) }
}

/* ══════════════════════ C. 数学（纯函数，值与上游语义逐条对） ══════════════════════ */
console.log('\n== C. 数学（来自 lib/now-playing-math.js；两端 / 边界 / 同心圆角 / swell / goo）==')
if (MATH) {
  const near = (a, b, eps) => Math.abs(a - b) <= (eps === void 0 ? 1e-9 : eps)
  ok('C1 clamp/mix 两端与越界', MATH.clamp(5, 0, 1) === 1 && MATH.clamp(-2, 0, 1) === 0 && MATH.mix(0, 10, 0) === 0 && MATH.mix(0, 10, 1) === 10 && MATH.mix(0, 10, 0.5) === 5)
  ok('C2 QUART 两端：0→0、1→1，且**永不越过**目标（quart-out 的全部意义）',
    MATH.QUART(0) === 0 && MATH.QUART(1) === 1 && (() => { for (let i = 0; i <= 1000; i++) { const v = MATH.QUART(i / 1000); if (v < 0 || v > 1) return false } return true })())
  ok('C3 SWING 两端为 0/1 且中点为 0.5（进也缓、出也缓）',
    near(MATH.SWING(0), 0) && near(MATH.SWING(1), 1) && near(MATH.SWING(0.5), 0.5))
  ok('C4 时长旋钮：50 = 上游调好的 460ms；0/100 = 736/184（注释里点名的那两个数）',
    near(MATH.durationOf(50), 460, 1e-6) && near(MATH.durationOf(0), 736, 1e-6) && near(MATH.durationOf(100), 184, 1e-6),
    [MATH.durationOf(0), MATH.durationOf(50), MATH.durationOf(100)].join(' / '))
  ok('C5 同心圆角 corner=0 ⇒ 内外都是 0（零半径没有"平行"可言，偏移必须跟着淡出）',
    JSON.stringify(MATH.artRadius(0)) === '[0,0]' && JSON.stringify(MATH.boxRadius(0)) === '[0,0]' && MATH.cornerOffset(0) === 0)
  ok('C6 同心圆角 corner=16（默认）⇒ 封面 [10,16]、盒子 [20,26] = 封面 + PAD(10)',
    JSON.stringify(MATH.artRadius(16)) === '[10,16]' && JSON.stringify(MATH.boxRadius(16)) === '[20,26]',
    'artR=' + JSON.stringify(MATH.artRadius(16)) + ' boxR=' + JSON.stringify(MATH.boxRadius(16)))
  ok('C7 同心圆角 corner=32 ⇒ 封面 [20,32]（64px 的封面正好成圆）、盒子 [30,42]，偏移封顶在 10',
    JSON.stringify(MATH.artRadius(32)) === '[20,32]' && JSON.stringify(MATH.boxRadius(32)) === '[30,42]' && MATH.cornerOffset(32) === 10)
  ok('C8 圆角旋钮超范围要夹住（0..CORNER_MAX=32），不能外推',
    JSON.stringify(MATH.artRadius(-5)) === '[0,0]' && JSON.stringify(MATH.artRadius(999)) === '[20,32]')
  ok('C9 盒子高度两端：SHUT=78 → OPEN=189（注释里"the box goes from 78 to 189"）',
    MATH.boxHeight(0) === 78 && MATH.boxHeight(1) === 189, MATH.boxHeight(0) + ' → ' + MATH.boxHeight(1))
  ok('C10 封面尺寸两端 40 → 64，且位置两端都不动（素材只长大、不移动）',
    MATH.artSize(0) === 40 && MATH.artSize(1) === 64 && MATH.artX() === MATH.PAD && MATH.artY() === MATH.PAD)
  ok('C11 宽度永不变化（上游整段设计的立足点）', MATH.W === 260 && MATH.barWidth() === MATH.W - MATH.PAD * 2,
    'W=' + MATH.W + ' bar=' + MATH.barWidth())
  ok('C12 swell 峰值位置 = 0.63（^1.5 的用意），峰值 1',
    (() => { let b = -1, bt = 0; for (let i = 0; i <= 20000; i++) { const u = i / 20000, v = MATH.swellOf(u); if (v > b) { b = v; bt = u } } return near(bt, 0.63, 0.002) && near(b, 1, 1e-6) })(),
    (() => { let b = -1, bt = 0; for (let i = 0; i <= 20000; i++) { const u = i / 20000, v = MATH.swellOf(u); if (v > b) { b = v; bt = u } } return 'peak@u=' + bt.toFixed(4) + ' max=' + b.toFixed(6) })())
  ok('C13 swell 两端为 0（按两次落回起点；浮点容差 1e-12）',
    Math.abs(MATH.swellOf(0)) < 1e-12 && Math.abs(MATH.swellOf(1)) < 1e-12,
    MATH.swellOf(0) + ' / ' + MATH.swellOf(1))
  ok('C14 zoom 只在**合上**时缩（打开时恒 1）',
    MATH.zoomOf(true, 1) === 1 && near(MATH.zoomOf(false, 1), 1 - 0.035) && MATH.zoomOf(false, 0) === 1)
  ok('C15 goo 两端为 0、中点为 1（路上的鼓包，不是两个状态的差别）',
    Math.abs(MATH.gooOf(0)) < 1e-12 && Math.abs(MATH.gooOf(1)) < 1e-12 && near(MATH.gooOf(0.5), 1),
    MATH.gooOf(0) + ' / ' + MATH.gooOf(0.5) + ' / ' + MATH.gooOf(1))
  ok('C16 goo 的三件事：靠拢 1.6、压扁 0.13、拉高 0.11；倾斜带方向（暂停 ≠ 播放倒放）',
    near(MATH.gooPull(1), 1.6) && JSON.stringify(MATH.gooScale(1)) === '[0.87,1.11]' && MATH.gooTip(true, 1) === -9 && MATH.gooTip(false, 1) === 9)
  ok('C17 迟入场 late：p≤0.6 为 0、p=0.8 为 0.5、p≥1 为 1（只在最后 40% 出现）',
    MATH.lateOf(0.6) === 0 && near(MATH.lateOf(0.8), 0.5) && MATH.lateOf(1) === 1)
  ok('C18 八点四边形：暂停 = 两根竖条；播放 = 内边缘收到中点，且两边同绕向',
    MATH.quad(MATH.PAUSE_L, MATH.PLAY_L, 0) === 'M6.00 4.00L10.00 4.00L10.00 20.00L6.00 20.00Z'
    && MATH.quad(MATH.PAUSE_L, MATH.PLAY_L, 1) === 'M6.50 4.00L13.25 8.00L13.25 16.00L6.50 20.00Z'
    && MATH.quad(MATH.PAUSE_R, MATH.PLAY_R, 0) === 'M14.00 4.00L18.00 4.00L18.00 20.00L14.00 20.00Z'
    && MATH.quad(MATH.PAUSE_R, MATH.PLAY_R, 1) === 'M13.25 8.00L20.00 12.00L20.00 12.00L13.25 16.00Z',
    MATH.quad(MATH.PAUSE_L, MATH.PLAY_L, 1))
  ok('C19 八个点逐一成对（每个点都是 a↔b 的线性混合，t=0.5 时正好在中点）',
    (() => { const half = MATH.quad(MATH.PAUSE_L, MATH.PLAY_L, 0.5); const q = MATH.quad(MATH.PAUSE_L, MATH.PLAY_L, 0); const r = MATH.quad(MATH.PAUSE_L, MATH.PLAY_L, 1); return half !== q && half !== r && /^M[\d.]+ [\d.]+L/.test(half) })())
  ok('C20 时钟：mm:ss 补零；进度百分比与剩余时长在两端都对',
    MATH.clock(0) === '0:00' && MATH.clock(59) === '0:59' && MATH.clock(60) === '1:00' && MATH.clock(214) === '3:34'
    && MATH.runPct(0) === 0 && MATH.runPct(MATH.TOTAL) === 100 && MATH.remain(52) === MATH.TOTAL - 52)
  ok('C21 tickClock 到 TOTAL 回 0（上游 `s >= TOTAL ? 0 : s + 1`）',
    MATH.tickClock(213) === 214 && MATH.tickClock(214) === 0 && MATH.tickClock(0) === 1)
  ok('C22 可选旋钮的弹性映射：50 是"原样"（两端都可发货的那条约束）',
    near(MATH.rate(50), 1) && near(MATH.overshoot(50, 0.9), 0.9) && MATH.springOf(50).k > MATH.springOf(0).k)
  ok('C23 传输行两端：按钮 24→34、播放键 30→46、间距 5→14、行心 x 206→130',
    MATH.transportSide(0) === 24 && MATH.transportSide(1) === 34 && MATH.transportLead(0) === 30 && MATH.transportLead(1) === 46
    && MATH.transportGap(0) === 5 && MATH.transportGap(1) === 14 && MATH.opsX(0) === 206 && MATH.opsX(1) === 130,
    'opsX ' + MATH.opsX(0) + ' → ' + MATH.opsX(1))
  ok('C24 轨道两端：贴到盒底内侧 → 卡片里 RAIL_Y=96；左右两端两个状态都不动',
    MATH.barTop(0) === 78 - 10 - 3 && MATH.barTop(1) === MATH.RAIL_Y && MATH.barLeft() === MATH.PAD && MATH.barTop(1) === 96,
    'barTop ' + MATH.barTop(0) + ' → ' + MATH.barTop(1))
} else {
  ok('C 组前置：生成区里取到了数学模块', false, 'A6 失败 ⇒ C 组无法执行')
}

/* ══════════════════════ D. 左侧栏收起 ⇒ 隐藏 ══════════════════════ */
console.log('\n== D. 左侧栏收起判据（宽度 < 阈值 / 宿主自己的状态）⇒ data-mpw-np-hidden ==')
{
  const NP_THRESHOLD = NP ? NP.NP_COLLAPSE_MAX_W : null
  ok('D1 阈值常量存在且是 96（宿主 computeColumns：收起 56 / 展开 ≥264 ⇒ 96 落在这条带子里）',
    NP_THRESHOLD === 96, 'NP_COLLAPSE_MAX_W=' + NP_THRESHOLD)
  const { ctl } = makeCtl(doc0(), makeWin())
  ok('D2 纯判据 shouldHide：宽度 < 阈值 ⇒ 收起；≥ 阈值 ⇒ 展开',
    ctl.shouldHide(56, false) === true && ctl.shouldHide(95.9, false) === true
    && ctl.shouldHide(96, false) === false && ctl.shouldHide(280, false) === false)
  ok('D3 宿主信号只在**量不到宽度**时生效（NaN+宿主说收起 ⇒ 隐藏；NaN+宿主没说 ⇒ 可见）'
    + '［①(NP-2) 语义更正：原来写"宿主状态优先、宽度是兜底"，真机 bug 见 G 组］',
    ctl.shouldHide(NaN, true) === true && ctl.shouldHide(NaN, false) === false)
  ok('D4 量不到宽度（NaN/undefined）⇒ **不隐藏**（宁可露出来，也不要一次量不到就永久消失）',
    ctl.shouldHide(NaN, false) === false && ctl.shouldHide(void 0, false) === false)
  function doc0() { const d = makeDoc(); buildSidebar(d, { width: 280 }); return d }
}
{
  /* 端到端：真控制器 + 假侧栏，缩到 56px（并让宿主打上自己的折叠标记）⇒ 隐藏；扩回 280 ⇒ 撤掉 */
  const doc = makeDoc(); const sb = buildSidebar(doc, { width: 280 })
  const win = makeWin(); const { ctl } = makeCtl(doc, win)
  ctl.setEnabled(true)
  const box = doc.querySelector('[data-mpw-now-playing]')
  ok('D5 开 ⇒ 容器已挂上，且初始不隐藏', !!box && !box.hasAttribute('data-mpw-np-hidden'))
  sb.col.__w = 56; sb.frame.setAttribute('data-sidebar-collapsed', 'true'); sb.root.className = 'hHd-Xa_root hHd-Xa_collapsed'
  ctl.evaluate()
  ok('D6 宽度 56 + 宿主的 data-sidebar-collapsed ⇒ data-mpw-np-hidden 出现',
    !!(box && box.hasAttribute('data-mpw-np-hidden')))
  /* 走**观察者回调**那条真实路径，而不是只调 evaluate() */
  sb.col.__w = 280; sb.frame.removeAttribute('data-sidebar-collapsed'); sb.root.className = 'hHd-Xa_root'
  for (const cb of win.__resizeCbs.slice()) cb([{ target: sb.col }])
  ok('D7 宽度恢复 280 + 宿主标记撤掉 ⇒ data-mpw-np-hidden 被移除',
    !!(box && !box.hasAttribute('data-mpw-np-hidden')))
  ok('D8 宿主 collapsed 属性 + **量不到宽度** ⇒ 隐藏（宿主信号在最需要它的场合仍然生效）'
    + '［①(NP-2) 语义更正：旧写法是"280 宽 + 属性 ⇒ 隐藏"，那正是真机 bug 的形状，已挪到 G1 反向断言］',
    (() => {
      const realRect = sb.col.getBoundingClientRect
      sb.col.getBoundingClientRect = () => null          /* 量不到 ⇒ 只剩宿主信号 */
      sb.frame.setAttribute('data-sidebar-collapsed', 'true'); ctl.evaluate()
      const h = box.hasAttribute('data-mpw-np-hidden')
      sb.frame.removeAttribute('data-sidebar-collapsed'); ctl.evaluate()
      const u = !box.hasAttribute('data-mpw-np-hidden')
      sb.col.getBoundingClientRect = realRect
      return h && u
    })())
  ok('D9 只靠**宽度**也能隐藏（宿主属性/类都不给：56 宽 ⇒ 隐藏）',
    (() => { const w = sb.col.__w; sb.col.__w = 56; ctl.evaluate(); const h = box.hasAttribute('data-mpw-np-hidden'); sb.col.__w = w; ctl.evaluate(); return h && !box.hasAttribute('data-mpw-np-hidden') })())
  ok('D10 侧栏根的 collapsed 类（CSS-modules 本地名子串）也算宿主信号 —— 同样只在量不到宽度时生效',
    (() => {
      const realRect = sb.col.getBoundingClientRect
      sb.col.getBoundingClientRect = () => null
      sb.root.className = 'hHd-Xa_root hHd-Xa_collapsed'; ctl.evaluate()
      const h = box.hasAttribute('data-mpw-np-hidden')
      sb.col.getBoundingClientRect = realRect                     /* 量得到：280 宽 ⇒ 类不再能藏它 */
      ctl.evaluate()
      const veto = !box.hasAttribute('data-mpw-np-hidden')
      sb.root.className = 'hHd-Xa_root'; ctl.evaluate()
      return h && veto
    })())
  const insp = ctl.inspectCollapse()
  /* ①(NP-3) 口径变更（真机根因，不是放宽）：贴合缩放量的是**我们自己那个容器**的宽度，
     不是"侧栏列"—— 真机上 `[class*="sidebarCol"]` 不止一处（右栏/dock 同类名），
     命中的可能是另一列（280），于是 fit 算成 0.985、卡片比可用宽度宽 24px、右缘被切 10.9px。
     原来这条断言是拿 `sb.col.__w` 驱动 fit 的 ⇒ 现在要改容器宽度才驱动得动。 */
  ok('D11 贴合缩放量**容器**宽度并夹在 [0.5,1]：容器 280 ⇒ fit≤1；容器 56 ⇒ 夹到下限 0.5'
    + '［①(NP-3) 语义更正：原来量的是侧栏列，真机上会量错列］',
    insp.fit <= 1 && insp.fit >= 0.5 && (() => { box.__w = 56; const f = ctl.inspectCollapse().fit; box.__w = 280; return f === 0.5 })(),
    'fit@容器280=' + insp.fit + ' 容器宽=' + insp.width + ' 列宽=' + insp.colWidth)
  ctl.setEnabled(false)
}

/* ══════════════════════ E. 挂载点顺序 + 单实例 ══════════════════════ */
console.log('\n== E. 挂载点在「设置」入口之前 + 重复开关只有一个容器 + 兜底锚点留日志 ==')
{
  /* E1..E3：三条锚点路径都要落在"设置入口之前"（文档序），包括首选的开槽 slot */
  const cases = [
    ['E1 宿主 slot（首选）', (sb) => { /* slot 在 */ }],
    ['E2 [data-slot="sidebar.settings"]（降级①）', (sb) => { sb.slot.remove() }],
    ['E3 [class*="settingsArea"]（降级②）', (sb) => { sb.slot.remove(); sb.settingsSlot.removeAttribute('data-slot') }],
  ]
  for (const [name, prep] of cases) {
    const doc = makeDoc(); const sb = buildSidebar(doc, { width: 280 })
    const win = makeWin(); const { ctl } = makeCtl(doc, win)
    prep(sb)
    ctl.setEnabled(true)
    const box = doc.querySelector('[data-mpw-now-playing]')
    const before = !!box && docOrder(doc, box) >= 0 && docOrder(doc, box) < docOrder(doc, sb.trigger)
    ok(name + ' ⇒ 容器在设置入口**之前**（文档序）', before,
      box ? ('容器@' + docOrder(doc, box) + ' 设置@' + docOrder(doc, sb.trigger) + ' 模式=' + ctl.inspect().anchorMode) : '没有容器')
    if (name.indexOf('E1') === 0) {
      ok('E1b 首选路径把容器放进宿主 slot 出口**内部**（位置由宿主给，不动它的结构）',
        box.parentNode === sb.slot && ctl.inspect().anchorMode === 'slot', ctl.inspect().anchorMode)
      ok('E1c 宿主 slot 的 wide 已接线（**量不到宽度**时它决定隐藏；量得到时以物理宽度为准，见 G 组）',
        (() => {
          const realRect = sb.col.getBoundingClientRect
          sb.col.getBoundingClientRect = () => null
          ctl.setHostCollapsed(true); const h = box.hasAttribute('data-mpw-np-hidden')
          ctl.setHostCollapsed(false); const u = !box.hasAttribute('data-mpw-np-hidden')
          ctl.setHostCollapsed(null)
          sb.col.getBoundingClientRect = realRect
          ctl.evaluate()
          return h && u
        })())
    }
    ctl.setEnabled(false)
  }
  /* E4：兜底路径必须留日志（不静默） */
  {
    const doc = makeDoc(); const sb = buildSidebar(doc, { width: 280 })
    const win = makeWin(); const { ctl } = makeCtl(doc, win)
    sb.slot.remove(); sb.settingsSlot.remove(); sb.settingsArea.remove()
    ctl.setEnabled(true)
    const box = doc.querySelector('[data-mpw-now-playing]')
    const warned = win.__logs.some(([lvl, m]) => lvl === 'warn' && /anchor fallback/.test(m))
    ok('E4 找不到设置锚点 ⇒ 退回底部组第一位，并**留一行 warn**（不静默）',
      !!box && box.parentNode === sb.foot && ctl.inspect().anchorMode === 'foot-first' && warned,
      '模式=' + ctl.inspect().anchorMode + ' 日志=' + (warned ? '有' : '无'))
    ctl.setEnabled(false)
  }
  /* E5：连底部组都没有 ⇒ 不注入 + 留日志 */
  {
    const doc = makeDoc(); const sb = buildSidebar(doc, { width: 280 })
    const win = makeWin(); const { ctl } = makeCtl(doc, win)
    sb.slot.remove(); sb.settingsSlot.remove(); sb.settingsArea.remove(); sb.foot.remove()
    ctl.setEnabled(true)
    const warned = win.__logs.some(([lvl, m]) => lvl === 'warn' && /anchors not found/.test(m))
    ok('E5 侧栏锚点全丢 ⇒ 一个节点都不注入 + 留一行 warn',
      doc.querySelectorAll('[data-mpw-now-playing]').length === 0 && warned)
    ctl.setEnabled(false)
  }
  /* E6：重复开 / 重复挂载只有一个容器 */
  {
    const doc = makeDoc(); buildSidebar(doc, { width: 280 })
    const win = makeWin(); const { ctl } = makeCtl(doc, win)
    ctl.setEnabled(true); ctl.setEnabled(true); ctl.setEnabled(true)
    ctl.ensureAnchored(); ctl.setEnabled(true)
    ok('E6 连开 4 次 + 强制重锚 ⇒ 全树只有 1 个容器（"再点即开"不叠节点）',
      doc.querySelectorAll('[data-mpw-now-playing]').length === 1,
      '实际 ' + doc.querySelectorAll('[data-mpw-now-playing]').length)
    /* E7：关 ⇒ 一个不留（含游离节点）；再开 ⇒ 还是 1 个 */
    ctl.setEnabled(false)
    const afterOff = doc.querySelectorAll('[data-mpw-now-playing]').length
    ctl.setEnabled(true)
    ok('E7 关 ⇒ 0 个（含游离）；再开 ⇒ 又只有 1 个（开/关可反复）',
      afterOff === 0 && doc.querySelectorAll('[data-mpw-now-playing]').length === 1,
      '关后 ' + afterOff + ' / 开后 ' + doc.querySelectorAll('[data-mpw-now-playing]').length)
    /* E8：宿主 React 重渲染把我们挤掉 ⇒ 自动插回同一个位置 */
    const box = doc.querySelector('[data-mpw-now-playing]')
    box.remove()
    const orphan = doc.querySelectorAll('[data-mpw-now-playing]').length
    ctl.ensureAnchored()
    const back = doc.querySelector('[data-mpw-now-playing]')
    ok('E8 被宿主重渲染挤掉 ⇒ ensureAnchored 插回同一位置（不新建第二个）',
      orphan === 0 && !!back && doc.querySelectorAll('[data-mpw-now-playing]').length === 1)
    ok('E9 卸载后观察者全部断开（live 计数归零）',
      (() => { ctl.setEnabled(false); return win.__counts.liveResize === 0 && win.__counts.liveMutation === 0 && win.__counts.liveRaf === 0 })(),
      JSON.stringify(win.__counts))
  }
  /* E10：做不到的动作不许假装 —— 没有可播源时点播放只出说明（console + 面板），不是静默 */
  {
    const doc = makeDoc(); buildSidebar(doc, { width: 280 })
    const win = makeWin()
    let transported = 0
    const { mod, ctl } = makeCtl(doc, win, { onTransport: () => { transported++ } })
    ctl.setEnabled(true)
    ctl.setMedia({ kind: 'none', canPlay: false, total: null, title: '', byline: '' })
    const tree = (() => {
      let found = null
      const comp = mod.NowPlaying
      const render = comp({ p: 0, open: false, playing: false, at: 0, media: ctl.inspect().media, note: '', onPlayPause: () => {} })
      const walkEl = (n) => { if (!n || typeof n !== 'object') return; if (n.props && n.props.className === 'mpw_np_op' && n.props.disabled) found = true; (n.kids || []).forEach(walkEl) }
      walkEl(render)
      return found
    })()
    ok('E10 无可控音轨 ⇒ 播放键 disabled（点了也不会"假装在放"）', tree === true)
    ctl.setEnabled(false)
  }
}

/* ══════════ G. 真机复核回归：物理宽度优先 + 重锚那一刻不许翻转 hidden ══════════
   来历（真机探针 tools/np-sidebar-live-probe.mjs 抓到，主对话跑的）：
     第二次加载（开关已开）时的时间线 ——
       t≈2000ms np=true  hidden=false anchor=settings-slot（容器落在降级锚点，可见）
       t≈8000ms np=true  hidden=TRUE  anchor=slot inSlot=true（宿主 slot 出口**终于**渲染出来，
                 组件重锚进 slot 的那一刻，宿主交下来的 wide=false 把 256px 展开的侧栏判成收起）
     用户视角 =「刷新后控件自己消失」，而且之后没有事件再来纠正 ⇒ 隐藏**粘住**。
   本组就是那条时间线的无浏览器复刻：三档判据 + 重锚不翻转 + 异常几何不粘住。 */
console.log('\n== G. 真机复核回归（物理宽度优先；slot 后出现重锚的那一刻不许翻转 hidden）==')
{
  const W = 256   /* 真机读数：展开态栏宽 256px（宿主收起恰好 56px，阈值 96px） */
  function doc0() { const d = makeDoc(); buildSidebar(d, { width: W }); return d }
  const { ctl } = makeCtl(doc0(), makeWin())
  ok('G1 宿主说收起（wide=false）+ 实测栏宽 256px ⇒ **不隐藏**（物理事实优先 = 真机 bug 的判据）',
    ctl.shouldHide(W, true) === false && ctl.shouldHide(280, true) === false,
    'shouldHide(256,true)=' + ctl.shouldHide(W, true) + ' shouldHide(280,true)=' + ctl.shouldHide(280, true))
  ok('G2 宿主说展开 / 或这版宿主压根没给（wide=true / 缺省）+ 256px ⇒ 不隐藏',
    ctl.shouldHide(W, false) === false)
  ok('G3 真的窄了（56px）⇒ 隐藏 —— 宿主说什么都一样（宽度自己够判）',
    ctl.shouldHide(56, true) === true && ctl.shouldHide(56, false) === true && ctl.shouldHide(95.9, true) === true)
  ok('G4 量不到宽度时才轮到宿主信号（NaN+收起 ⇒ 隐藏；NaN+宿主没说 ⇒ 可见）',
    ctl.shouldHide(NaN, true) === true && ctl.shouldHide(NaN, false) === false)
}
{
  /* G5/G6：复刻真机时间线 —— 组件先落在降级锚点（`[data-slot="sidebar.settings"]`），
     slot 出口**晚一步**才被宿主渲染出来 ⇒ setSlotNode() + setHostCollapsed(true)（= 交下来
     wide=false）⇒ ensureAnchored() 把容器搬进 slot。**搬完 hidden 必须仍然是 false。** */
  const doc = makeDoc()
  const sb = buildSidebar(doc, { width: 256 })
  sb.slot.remove()                                  /* 真机 t≈2000ms：slot 出口还没渲染 */
  const win = makeWin(); const { ctl } = makeCtl(doc, win)
  ctl.setEnabled(true)
  const box = doc.querySelector('[data-mpw-now-playing]')
  const anchorBefore = ctl.inspect().anchorMode
  const visibleBefore = !!box && !box.hasAttribute('data-mpw-np-hidden')
  /* 真机 t≈8000ms：宿主把 slot 出口插进 footerActions，并把我们的 div 挂上去 */
  const slot = doc.createElement('div')
  slot.className = 'mpw_np_slot'
  slot.setAttribute('data-slot', 'sidebar.footer.action')
  slot.setAttribute('data-mpw-np-slot', '')
  sb.actions.appendChild(slot)
  ctl.setSlotNode(slot)
  ctl.setHostCollapsed(true)                        /* 真机那一帧交下来的就是 wide=false */
  ctl.ensureAnchored()
  const insp = ctl.inspectCollapse()
  ok('G5 降级锚点 ⇒ slot 后出现 ⇒ 重锚进 slot（复刻真机那一帧）',
    anchorBefore === 'settings-slot' && insp && ctl.inspect().anchorMode === 'slot' && box.parentNode === slot
    && visibleBefore,
    anchorBefore + ' → ' + ctl.inspect().anchorMode + ' / 重锚前可见=' + visibleBefore)
  ok('G6 重锚那一刻**不许翻转 hidden**（wide=false + 256px ⇒ 仍可见）',
    !box.hasAttribute('data-mpw-np-hidden') && ctl.inspectCollapse().hidden === false,
    'hidden=' + ctl.inspectCollapse().hidden + ' width=' + ctl.inspectCollapse().width
    + ' hostWide=' + ctl.inspectCollapse().hostWide)
  await new Promise((r) => setTimeout(r, 10))       /* 让一次性补判跑完，再确认一次 */
  ok('G6b 补判之后仍然可见（4 秒后真机也不会自己消失；这一条对应探针 L6 的"任何时刻"口径）',
    !box.hasAttribute('data-mpw-np-hidden') && ctl.inspectCollapse().settlePending === false,
    'settlePending=' + ctl.inspectCollapse().settlePending)
  ctl.setEnabled(false)
}
{
  /* G7/G8：搬动那一帧量到**异常几何**（0 宽：DOM 正在变）⇒ 一次性补判必须纠正，不许粘住。
     真机同类形状：决策发生在宿主渲染中的那一帧，之后没有事件再来 ⇒ 隐藏永久粘住。 */
  const doc = makeDoc(); const sb = buildSidebar(doc, { width: 256 })
  const win = makeWin(); const { ctl } = makeCtl(doc, win)
  const realRect = sb.col.getBoundingClientRect
  let bad = true
  sb.col.getBoundingClientRect = () => (bad
    ? { x: 0, y: 0, width: 0, height: 200, top: 0, left: 0, right: 0, bottom: 200 }
    : realRect.call(sb.col))
  ctl.setEnabled(true)
  const box = doc.querySelector('[data-mpw-now-playing]')
  const hiddenAtMount = !!box && box.hasAttribute('data-mpw-np-hidden')
  bad = false                                        /* 宿主渲染稳定 ⇒ 几何恢复 256px */
  await new Promise((r) => setTimeout(r, 10))        /* flush 一次性补判（setTimeout(0)） */
  ok('G7 量到异常几何（0 宽）那一帧的隐藏决定**不许粘住**：补判必须纠正回可见',
    hiddenAtMount === true && !box.hasAttribute('data-mpw-np-hidden'),
    '挂载时 hidden=' + hiddenAtMount + ' 补判后 hidden=' + box.hasAttribute('data-mpw-np-hidden'))
  ctl.setEnabled(false)
  ok('G8 一次性补判不是常驻 rAF、关掉后无残留（raf 计数仍为 0；live* 全归零）',
    win.__counts.raf === 0 && win.__counts.liveResize === 0 && win.__counts.liveMutation === 0
    && win.__counts.liveRaf === 0,
    JSON.stringify(win.__counts))
}

/* ══════════════════════ F. 分辨力自证（RED-if-reverted） ══════════════════════ */
const MUTS = [
  {
    id: 'threshold-reverted-to-always-expanded',
    expect: 'D',
    why: '把"量到窄栏（< 阈值）⇒ 收起"改成永不收起（= 收起时组件不隐藏，用户第 3 条要求失效）',
    mut: (s) => s.replace('if (measurable) return true;', 'if (false) return true;'),
  },
  {
    id: 'host-signal-beats-width-restored',
    expect: 'G',
    why: '把"物理宽度优先"改回**旧写法**（宿主说收起就收起）⇒ 真机 bug 复现：'
      + '256px 展开态被 wide=false 写成 hidden（这就是探针 L6 抓到的那条）',
    mut: (s) => s.replace('if (measurable && width >= NP_COLLAPSE_MAX_W) return false;', 'if (false) return false;'),
  },
  {
    id: 'settle-reevaluation-removed',
    expect: 'G',
    why: '删掉搬动后的一次性补判 ⇒ 搬动那一帧量到的异常几何会**粘住**（真机表现为控件永久消失）',
    mut: (s) => s.replace('settleTimer = win.setTimeout(() => { settleTimer = 0; evaluate(); }, 0);', 'settleTimer = 0;'),
  },
  {
    id: 'switch-default-flipped-to-false',
    expect: 'B',
    why: '①(NP-3) 把开关默认值改回 false（= 默认档不挂控件、不拼 NP 段，"默认开"这条要求失效）',
    mut: (s) => s.replace('const DEFAULT_NP_NOW_PLAYING = true;', 'const DEFAULT_NP_NOW_PLAYING = false;'),
  },
  {
    id: 'single-instance-guard-removed',
    expect: 'E',
    why: '删掉"已经挂着就绝不再建第二个容器"的幂等守卫（= 重复开关/宿主重渲染会叠出第二个容器）。'
      + '①(NP-3) 注：这条守卫现在在 tryMount() 的首行（setEnabled 那边也还留着一层），'
      + '所以要打的是 tryMount 里那一条 —— 只删 setEnabled 那层已经打不红了（两处都幂等）。',
    /* 两处幂等守卫**都要**打掉才复现得了（这就是"两处都幂等"的含义：只删一处，另一处仍然挡住）
       —— 变异失败本身也是一条信息：删掉任一处都不会叠节点。 */
    mut: (s) => s.replace('    function tryMount() {\n      if (container) return false;', '    function tryMount() {\n      if (false) return false;')
      .replace('if (enabled) { ensureAnchored(); evaluate(); return api; }', 'if (false) { ensureAnchored(); evaluate(); return api; }'),
  },
  {
    id: 'np-css-dropped-on-no-image-path',
    expect: 'B',
    why: '①(NP-3) 把"无壁纸"那条 return 上的 NP 段删掉（= 真机 bug 原样：section 少了 image/webUrl 时'
      + '控件整份样式丢失、传输键掉到卡片外点不到；真机上用户的档正是这种半残档）',
    mut: (s) => s.replace('return emitSurfaceTokens(css + buildUiCss(section, false)) + __npCss;',
      'return emitSurfaceTokens(css + buildUiCss(section, false));'),
  },
  {
    id: 'generated-region-drifted',
    expect: 'A',
    why: '往生成区里塞一个空格（= 生成物与源漂移；形态 (A) 必须抓到这种静默漂移）',
    mut: (s) => s.replace('const MPW_NP_CSS = MPW_NP.NP_CSS;', 'const MPW_NP_CSS  = MPW_NP.NP_CSS;'),
  },
]
if (!NO_MUT && !ONLY_JSON) {
  console.log('\n== F. 分辨力自证：7 组变异必须各自让**指定那一组**变红（副本在 mkdtemp，真树不动）==')
  const GROUPS = {
    A: /✗ A\d/,
    B: /✗ B\d/,
    C: /✗ C\d/,
    D: /✗ D\d/,
    E: /✗ E\d/,
    G: /✗ G\d/,
  }
  for (const m of MUTS) {
    const mutated = m.mut(clientSrc)
    if (mutated === clientSrc) { ok('F 变异 ' + m.id + ' 注入成功', false, '注入点没匹配上（源码改了？）'); continue }
    const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--client', copy, '--no-mutations'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 })
    const out = (r.stdout || '') + (r.stderr || '')
    const caught = Object.keys(GROUPS).filter((g) => GROUPS[g].test(out))
    const got = caught.includes(m.expect) ? m.expect : (r.status === 0 ? 'PASS' : 'FAIL(其它)')
    ok('F 变异 ' + m.id + '：期望 ' + m.expect + ' 组变红，实际 ' + got, got === m.expect,
      m.why + '  [exit=' + r.status + ']')
    if (got !== m.expect) {
      console.error('      ↑ 实际报红分组：[' + caught.join(',') + ']；RED 行：'
        + out.split('\n').filter((l) => /^\s*✗/.test(l)).slice(0, 3).join(' | '))
    }
  }
}

cleanup()
if (!ONLY_JSON) {
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  if (fail) { console.error('✗ Now playing 门禁未通过'); process.exit(1) }
  console.log('✓ Now playing 门禁通过：生成区无漂移 + 开关默认开（显式关仍零注入；无壁纸路径也带 NP 段）'
    + ' + 挂载在设置入口之前 + 左侧栏收起即隐藏 + 单实例')
}

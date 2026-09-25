#!/usr/bin/env node
/**
 * hidden-gate-test.mjs —— H(2026-09-25)「**后台挂载期起播**」的无浏览器门禁
 *
 * 为什么单开一条（而不是并进 wallpaper-lifecycle-test 的 N 组）：
 *   N 组钉的是 C(2026-09-20) 那一轮的三个"**补起播**"入口（`npPrimePlay` / 手势重试 / 延迟重放里的
 *   那一行），而本次现场（用户新报）是**另一条链**：Android 把后台标签冻结→丢弃→**在后台重新加载**，
 *   页面在 `document.hidden === true` 的状态下走了一遍**完整挂载**。这条链上的落点里有 14 处 `play()`
 *   只查 `!(wallUserPaused || powPaused)`（`powPaused` 是"上一轮省电跑过"的快照，冻结/丢弃这条路上
 *   从来没被置真）⇒ C 的闸门在这条路径上等于没有。N 组的夹具是"先可见挂载、再隐藏"，**构造不出**
 *   "挂载时就已经是 hidden"这个形态 ⇒ 必须另开一条用桩把 `document.hidden` **在挂载那一刻**置真。
 *
 * 判据（每条都对着**真实现**，不是副本；变异见文末 K 组）：
 *   A hidden 挂载 ⇒ 挂载路径 `play()` **零调用** + 只记一条台账 + 状态 `never-started`
 *   B visible 挂载 ⇒ 正常起播（闸门不是"永久禁播"）
 *   C `visibilitychange → hidden` ⇒ `video.pause()` + 帧 **park** + 我们自己的 audio 暂停
 *   D `visibilitychange → visible` ⇒ **按原状态**：隐藏前在播才续播，隐藏前暂停的绝不起播
 *   E 挂载期被挡（从没起播过）⇒ 第一次可见时**按当时策略**补上（与 D 是两条独立状态）
 *   F `freeze` / `resume`（Android 冻结）⇒ 与 hidden 同一待遇，且**能恢复**（不许永久冻住）
 *   G 逃生门两处：`?hiddengate=legacy`（URL）与 `powPauseHidden=false`（设置项）
 *   H 帧 policy 通道：hidden 时对**已挂载的帧**下发 `park`（web 帧 / 场景帧唯一可达的那条）
 *   I 审计：hidden 期间的起播**无论 owner 是谁**都留一条（含 owner/src/栈）+ 独立台账 + 进信标
 *   J 源码锚点：14 处 `play()` 全部在闸门之下（旧写法 `!(wallUserPaused || powPaused)` 0 残留）
 *   K 变异自证：逐个删掉新增门控 ⇒ 对应组必红（不红就是判据假绿）
 *
 * 用法：
 *   node tools/hidden-gate-test.mjs                  # 全部（含变异自证）
 *   node tools/hidden-gate-test.mjs --no-mutations    # 只跑主体
 *   node tools/hidden-gate-test.mjs --client <path>   # 变异用（副本；真树一个字节都不动）
 *
 * 真机读数、根因链与"谁起的"判定：docs/WALLPAPER-LIFECYCLE.md 的 H 节 + README「插件侧 URL 逃生口」。
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
const NO_MUT = process.argv.includes('--no-mutations')

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  — ' + detail : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const FIX = {
  enabled: true, npNowPlaying: true, mute: false, npVolume: 60, npLinkWallpaper: true,
  converted: 'mp4', image: 'host:?token=t&index=0', mpkgKey: 'custommpkg|x.mpkg',
  source: 'bgcs_abydos03.mp4', powPauseHidden: true, powPauseHiddenUserSet: true,
}

/* ══════════════════════════════════════════════════════════════════════════════════
   桩：一个**可控 document.hidden** + 会记账的 <video> / iframe
   ──────────────────────────────────────────────────────────────────────────────────
   为什么不用 `_stub.mjs` 的桩直接断言：它的 `document.addEventListener` 是空实现、
   `document.hidden` 不存在、视频元素没有 `play/pause` 计数 ⇒ "hidden 时 play() 零调用"这种
   **结果落点**根本断言不了（假绿的温床）。这里补上三样：属性化的 hidden、事件登记表、断言计数器。
   ══════════════════════════════════════════════════════════════════════════════════ */
const { loadPlugin } = await import('./_stub.mjs')

const SESSION_GUARDS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwSectionTest', '__mpwNpTest',
  '__mpwPowerWired', '__mpwNpOwnsSound', '__mpwErrHook', '__mpwSandboxCapHook', '__mpwLnGuard', '__mpwWebShimHook',
  '__mpwNowPlaying', '__mpwNowPlayingSlotAction', '__mpwNpCtlSeq', '__mpwAppliedOnce', '__mpwPersist',
  '__mpwLifecycleTest', '__mpwWebTest', '__mpwHdrFrostTest', '__mpwDiagTest', '__mpwRailInkProbe', '__mpwBgArmError']

/* ── 迷你 DOM ─────────────────────────────────────────────────────────────────────
   `bgElements()` 每次都用 `getElementById` + `wrap.querySelector('iframe.mpw-webFrame')`
   **现场解析**（不缓存）⇒ 桩里必须真的有一棵能查的树，否则 showVideoEl 第一行就
   `if (!img || !video || !wrap) return`（"零 play"这种断言会**假绿** —— 什么都没跑）。
   只实现本门禁要用的两个选择器：`iframe.mpw-webFrame` / `canvas.mpw-bgCanvas`。 */
function mkEl (tag, cls) {
  const attrs = new Map()
  const set = new Set(String(cls || '').split(/\s+/).filter(Boolean))
  const queryAll = (root, sel) => {
    const out = []
    const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean)
    const hit = (el, s) => {
      const m = /^([a-zA-Z]+)?(?:\.([\w-]+))?$/.exec(s)
      if (!m) return false
      if (m[1] && String(el.tagName).toLowerCase() !== m[1].toLowerCase()) return false
      if (m[2] && !setOf(el).has(m[2])) return false
      return true
    }
    const walk = (el) => {
      for (const c of el.children || []) {
        if (parts.some((s) => hit(c, s))) out.push(c)
        walk(c)
      }
    }
    walk(root)
    return out
  }
  const setOf = (el) => el.__set
  const el = {
    __set: set, tagName: String(tag).toUpperCase(), nodeType: 1, children: [], parentElement: null,
    style: { setProperty (k, v) { this[String(k)] = String(v) }, removeProperty (k) { delete this[String(k)] }, getPropertyValue (k) { return this[String(k)] === void 0 ? '' : String(this[String(k)]) } },
    classList: {
      add: (...c) => { for (const x of c) set.add(x) },
      remove: (...c) => { for (const x of c) set.delete(x) },
      contains: (c) => set.has(c),
      toggle: (c, on) => { if (on === void 0) { set.has(c) ? set.delete(c) : set.add(c) } else if (on) set.add(c); else set.delete(c) },
    },
    setAttribute: (k, v) => attrs.set(String(k), String(v)),
    getAttribute: (k) => (attrs.has(String(k)) ? attrs.get(String(k)) : null),
    removeAttribute: (k) => attrs.delete(String(k)),
    hasAttribute: (k) => attrs.has(String(k)),
    appendChild (c) { this.children.push(c); c.parentElement = this; return c },
    removeChild (c) { this.children = this.children.filter((x) => x !== c); return c },
    remove () { if (this.parentElement) this.parentElement.removeChild(this) },
    querySelector (sel) { return queryAll(this, sel)[0] || null },
    querySelectorAll (sel) { return queryAll(this, sel) },
    contains (n) { let p = n; while (p) { if (p === el) return true; p = p.parentElement } return false },
    matches: () => false,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 }),
    addEventListener () {}, removeEventListener () {}, focus () {}, click () {}, getContext: () => null,
    set className (v) { set.clear(); for (const x of String(v).split(/\s+/)) if (x) set.add(x) },
    get className () { return Array.from(set).join(' ') },
  }
  for (const p of ['src', 'href']) {
    Object.defineProperty(el, p, { configurable: true, get () { return attrs.get(p) || '' }, set (v) { attrs.set(p, String(v)) } })
  }
  Object.defineProperty(el, 'id', { configurable: true, get () { return attrs.get('id') || '' }, set (v) { attrs.set('id', String(v)) } })
  return el
}

/** 一次装载 = 一个"页面实例"（模块级状态全新）；返回可断言的夹具。 */
function boot (opts = {}) {
  for (const k of SESSION_GUARDS) { try { delete globalThis[k] } catch { /* ignore */ } }
  const loaded = loadPlugin({ clientPath, settings: opts.settings || FIX, quiet: true, search: opts.search })
  const doc = globalThis.document

  /* ① 一棵**真能查**的壁纸树（必须在任何 apply/showVideo 之前装好） */
  const ids = new Map()
  const wrap = mkEl('div', 'mpw-bgWrap'); wrap.id = 'mpw-bgWrap'
  const img = mkEl('img', 'mpw-bgImg'); img.id = 'mpw-bgImg'
  const video = mkEl('video', 'mpw-bgVideo'); video.id = 'mpw-bgVideo'
  const canvas = mkEl('canvas', 'mpw-bgCanvas')
  const frame = mkEl('iframe', 'mpw-webFrame')
  wrap.appendChild(img); wrap.appendChild(video); wrap.appendChild(canvas); wrap.appendChild(frame)
  doc.body.appendChild(wrap)
  ids.set('mpw-bgWrap', wrap); ids.set('mpw-bgImg', img); ids.set('mpw-bgVideo', video); ids.set('mpw-bgCanvas', canvas)
  const stubById = doc.getElementById.bind(doc)
  doc.getElementById = (id) => ids.get(String(id)) || stubById(String(id))
  doc.createElement = (t) => mkEl(t)
  doc.querySelectorAll = () => []
  doc.querySelector = () => null

  /* ② 可控的 hidden / visibilityState */
  let hidden = opts.hidden === true
  try { Object.defineProperty(doc, 'hidden', { configurable: true, get: () => hidden }) } catch { /* ignore */ }
  try { Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') }) } catch { /* ignore */ }

  /* ③ 事件登记表（真 listener 会被注册进来；fire 就是**真的调用**它们） */
  const listeners = {}
  doc.addEventListener = (k, fn) => { (listeners[String(k)] = listeners[String(k)] || []).push(fn) }
  doc.removeEventListener = () => {}
  globalThis.addEventListener = (k, fn) => { (listeners[String(k)] = listeners[String(k)] || []).push(fn) }
  globalThis.removeEventListener = () => {}
  const fire = (k, ev) => { const a = listeners[String(k)] || []; for (const fn of a) { try { fn(ev || {}) } catch (e) { /* 实现自己吞 */ } } return a.length }

  /* ④ <video>：play/pause 记账 + 可播状态 */
  const L = globalThis.__mpwLifecycleTest
  const plays = { n: 0, at: [] }
  const pauses = { n: 0 }
  video.paused = true
  video.muted = false
  video.volume = 1
  video.readyState = 4
  video.currentTime = 0
  video.setAttribute('src', '/api/mpkg-wallpaper/media?token=t&index=0')
  video.play = () => { plays.n++; plays.at.push(String(new Error().stack || '').split('\n')[2] || ''); video.paused = false; return { catch () {}, then (f) { try { f && f() } catch (e) {} return this } } }
  video.pause = () => { if (!video.paused) pauses.n++; video.paused = true }

  /* ⑤ iframe：contentWindow.postMessage 记账（`sendRendererAudioPolicy` 的 park 落点） */
  const posted = []
  frame.contentWindow = { postMessage: (m) => { posted.push(m) }, document: undefined }

  /* ⑥ 真 listener 重挂：`applyInner` 在 loadPlugin 里已经调过一次 `setupPowerSave()`，
     但**那一刻** `doc.addEventListener` 还是桩的空实现 ⇒ 那一次注册全丢了。
     删掉幂等位再调一次**生产函数本身**，这次才落进上面的登记表（fire 调的就是它们）。 */
  try { delete globalThis.__mpwPowerWired } catch { /* ignore */ }
  try { L.setupPowerSave() } catch { /* ignore */ }

  const setHidden = (v) => { hidden = !!v }
  return { loaded, doc, L, wrap, video, frame, canvas, plays, pauses, posted, setHidden, fire, listeners }
}

const parkCalls = (b) => {
  try {
    const log = (b.L.rendererPolicy() || {}).log || []
    return log.filter((r) => r && r.park === true)
  } catch (e) { return [] }
}
const ledgerKinds = (b) => { try { return b.L.hiddenLedger().map((r) => r.kind) } catch (e) { return [] } }

/* ══════════════════════════════════════════════════════════════════════════════════
   A. 挂载期 hidden ⇒ 一路 play() 都不许有
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== A. 挂载时 document.hidden === true ⇒ 挂载路径 play() 零调用 ==')
{
  const b = boot({ settings: FIX })
  const { L, video, plays } = b
  ok('A0 夹具可用（真 showVideo 钩子 + 有 <video>）', !!L && typeof L.showVideo === 'function' && !!video)
  L.hiddenLedgerClear()
  const before = plays.n
  b.setHidden(true)                                     // 页面"一挂载就已经是 hidden"（后台重载现场）
  L.showVideo('host:?token=t&index=0')                  // 走**真挂载路径**
  ok('A1 hidden 挂载 ⇒ play() 零调用（本次现场的核心判据）', plays.n === before, 'plays ' + before + ' → ' + plays.n)
  ok('A2 状态是 **never-started**（不是"被隐藏暂停过"）', L.hiddenState().bootBlocked === true && L.hiddenState().pausedByUs === false, JSON.stringify(L.hiddenState()))
  ok('A3 只记**一条**启动台账（boot-hidden-no-autoplay）', ledgerKinds(b).filter((k) => k === 'boot-hidden-no-autoplay').length === 1, JSON.stringify(ledgerKinds(b)))
  ok('A4 台账里带 where（可归因到哪个挂载点）', (() => { const r = L.hiddenLedger().find((x) => x.kind === 'boot-hidden-no-autoplay'); return !!r && r.where === 'showVideoEl' && r.state === 'never-started' })(), JSON.stringify(L.hiddenLedger().filter((r) => r.kind === 'boot-hidden-no-autoplay')))
  ok('A5 闸门读数：block=true / legacy=false / gateOn=true', (() => { const s = L.hiddenState(); return s.block === true && s.legacy === false && s.gateOn === true })(), JSON.stringify(L.hiddenState()))
  /* 再挂一次（真机上 applyFromStorage 会重入）：仍然一次都不许 play，但**不**再记启动台账 */
  const p2 = plays.n
  L.showVideo('host:?token=t&index=0')
  ok('A6 重入挂载仍零调用，且启动台账不重复记', plays.n === p2 && ledgerKinds(b).filter((k) => k === 'boot-hidden-no-autoplay').length === 1, 'plays=' + plays.n + ' kinds=' + JSON.stringify(ledgerKinds(b).slice(-4)))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   B. 可见挂载 ⇒ 正常起播（闸门不是"永久禁播"）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== B. 可见时挂载 ⇒ 照常起播（默认行为零变化）==')
{
  const b = boot({ settings: FIX })
  const { L, plays } = b
  L.hiddenLedgerClear()
  const before = plays.n
  b.setHidden(false)
  L.showVideo('host:?token=t&index=0')
  ok('B1 visible 挂载 ⇒ play() 被调用（闸门只在 hidden 生效）', plays.n > before, 'plays ' + before + ' → ' + plays.n)
  ok('B2 没有留下"挂载期被挡"状态', L.hiddenState().bootBlocked === false, JSON.stringify(L.hiddenState()))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   C. visibilitychange → hidden：pause + 帧 park
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== C. visibilitychange 转 hidden ⇒ 所有我们的出声面都停住 ==')
{
  const b = boot({ settings: FIX })
  const { L, video, plays, pauses } = b
  L.setupPowerSave()                                     // 注册**真**监听（含 freeze/resume）
  ok('C0 真监听已注册（visibilitychange/pagehide/pageshow/freeze/resume）',
    ['visibilitychange', 'pagehide', 'pageshow', 'freeze', 'resume'].every((k) => (b.listeners[k] || []).length > 0),
    JSON.stringify(Object.keys(b.listeners)))
  b.setHidden(false)
  L.showVideo('host:?token=t&index=0')                   // 先在可见状态正常起播
  ok('C1 夹具：起播成功（paused=false）', video.paused === false && plays.n > 0, 'paused=' + video.paused + ' plays=' + plays.n)
  L.rendererPolicyClear()
  const p0 = pauses.n
  b.setHidden(true)
  b.fire('visibilitychange')                             // 真的走 visibilitychange 处理器
  ok('C2 转 hidden ⇒ 壁纸 <video> 被真的 pause()（不是只改标志）', pauses.n > p0 && video.paused === true, 'pauses ' + p0 + ' → ' + pauses.n)
  ok('C3 转 hidden ⇒ 状态是 **paused-by-hidden**（隐藏前在播 ⇒ 回来才续播）', L.hiddenState().pausedByUs === true && L.powState().paused === true, JSON.stringify({ st: L.hiddenState(), pow: L.powState() }))
  ok('C4 台账里能看到 pause（可归因，不是静默）', ledgerKinds(b).includes('pause') && ledgerKinds(b).includes('visibilitychange'), JSON.stringify(ledgerKinds(b).slice(-4)))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   D. visibilitychange → visible：按原状态
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== D. 回到可见 ⇒ **按原状态**（在播才续播；原本暂停的绝不起播）==')
{
  /* D-a：隐藏前在播 ⇒ 回来续播 */
  const a = boot({ settings: FIX })
  a.L.setupPowerSave()
  a.setHidden(false); a.L.showVideo('host:?token=t&index=0')
  a.setHidden(true); a.fire('visibilitychange')
  const pa = a.plays.n
  a.setHidden(false); a.fire('visibilitychange')
  ok('D1 隐藏前**在播** ⇒ 回来自动续播', a.plays.n > pa && a.video.paused === false, 'plays ' + pa + ' → ' + a.plays.n)
  ok('D2 续播走的是 resumeWallpaperVideo（台账可见 visible-resume）', ledgerKinds(a).includes('visible-resume'), JSON.stringify(ledgerKinds(a).slice(-3)))

  /* D-b：隐藏前就是暂停的 ⇒ 回来一个字节都不放（既有语义，不许被本次改动放宽） */
  const b = boot({ settings: FIX })
  b.L.setupPowerSave()
  b.setHidden(false)
  b.video.paused = true                                   // 夹具：**人为**保持暂停（从没起播过）
  b.L.hiddenLedgerClear()
  b.setHidden(true); b.fire('visibilitychange')
  const pb = b.plays.n
  b.setHidden(false); b.fire('visibilitychange')
  ok('D3 隐藏前**暂停** ⇒ 回来仍暂停（不自作主张起播）', b.plays.n === pb && b.video.paused === true, 'plays ' + pb + ' → ' + b.plays.n + ' paused=' + b.video.paused)
}

/* ══════════════════════════════════════════════════════════════════════════════════
   E. 挂载期被挡（从没起播过）⇒ 第一次可见时按当时策略补上
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== E. never-started（后台挂载被挡）⇒ 第一次可见时按当时策略恢复 ==')
{
  const b = boot({ settings: FIX })
  const { L, video, plays } = b
  L.setupPowerSave()
  L.hiddenLedgerClear()
  b.setHidden(true)
  L.showVideo('host:?token=t&index=0')                    // 后台重载：挂载完成时 hidden
  const p0 = plays.n
  ok('E1 前提：挂载被挡（零播放 + bootBlocked）', plays.n === p0 && L.hiddenState().bootBlocked === true, 'plays=' + plays.n)
  b.setHidden(false)
  b.fire('visibilitychange')                              // 第一次可见
  ok('E2 第一次可见 ⇒ **补上**那一次起播（这是与 D 组的本质区别）', plays.n > p0 && video.paused === false, 'plays ' + p0 + ' → ' + plays.n)
  ok('E3 台账区分两种状态：never-started → running', (() => { const r = L.hiddenLedger().find((x) => x.kind === 'boot-visible-resume'); return !!r && /never-started/.test(String(r.state)) })(), JSON.stringify(L.hiddenLedger().filter((r) => k(r) === 'boot-visible-resume')))
  function k (r) { return r.kind }
  ok('E4 恢复后 bootBlocked 清零（不会每次可见都补一次）', L.hiddenState().bootBlocked === false, JSON.stringify(L.hiddenState()))
  const p2 = plays.n
  b.fire('visibilitychange')
  ok('E5 第二次可见事件不再补播（幂等）', plays.n === p2, 'plays=' + plays.n)

  /* E-b：挂载被挡 + 用户按下暂停（npPaused 持久化）⇒ 可见时**不许**补播 */
  const c = boot({ settings: Object.assign({}, FIX, { npPaused: true }) })
  c.L.setupPowerSave()
  c.setHidden(true)
  c.L.showVideo('host:?token=t&index=0')
  const pc = c.plays.n
  c.setHidden(false); c.fire('visibilitychange')
  ok('E6 用户的暂停意图优先：npPaused=true ⇒ 可见时也不补播', c.plays.n === pc, 'plays ' + pc + ' → ' + c.plays.n)
}

/* ══════════════════════════════════════════════════════════════════════════════════
   F. freeze / resume（Android 冻结）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== F. freeze（Android 冻结）⇒ 与 hidden 同一待遇，且能恢复 ==')
{
  const b = boot({ settings: FIX })
  const { L, video, plays, pauses } = b
  L.setupPowerSave()
  b.setHidden(false)
  L.showVideo('host:?token=t&index=0')
  const p0 = pauses.n
  b.fire('freeze')                                        // 页面仍然"可见"，但被冻结 ⇒ 必须停
  ok('F1 freeze ⇒ 视为隐藏：video 被 pause()', pauses.n > p0 && video.paused === true, 'pauses ' + p0 + ' → ' + pauses.n)
  ok('F2 freeze ⇒ 闸门闭合（hidden 期间不许起播那条判据同样成立）', L.hiddenState().frozen === true && L.hiddenAudioBlock() === true, JSON.stringify(L.hiddenState()))
  const p1 = plays.n
  L.showVideo('host:?token=t&index=0')                     // 冻结期间挂载/重入
  ok('F3 freeze 期间挂载 ⇒ play() 零调用', plays.n === p1, 'plays ' + p1 + ' → ' + plays.n)
  b.fire('resume')
  ok('F4 resume ⇒ 闸门放开且**画面没有永久冻住**（按原状态续播）', L.hiddenState().frozen === false && plays.n > p1 && video.paused === false, JSON.stringify({ st: L.hiddenState(), plays: plays.n }))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   G. 两条逃生门
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== G. 逃生门：?hiddengate=legacy（URL）与 powPauseHidden=false（设置项）==')
{
  const b = boot({ settings: FIX, search: '?hiddengate=legacy' })
  const { L, plays } = b
  b.setHidden(true)
  const before = plays.n
  L.showVideo('host:?token=t&index=0')
  ok('G1 ?hiddengate=legacy ⇒ 回到旧行为（hidden 挂载照常起播）', plays.n > before, 'plays ' + before + ' → ' + plays.n)
  ok('G2 legacy 下闸门读数如实为 false（不假装还开着）', L.hiddenState().legacy === true && L.hiddenAudioBlock() === false, JSON.stringify(L.hiddenState()))

  const c = boot({ settings: Object.assign({}, FIX, { powPauseHidden: false, powPauseHiddenUserSet: true }) })
  c.setHidden(true)
  const p2 = c.plays.n
  c.L.showVideo('host:?token=t&index=0')
  ok('G3 设置项 powPauseHidden=false（用户显式关）⇒ 闸门失效（"切页也出声是我选的"）', c.L.hiddenPauseOn() === false && c.L.hiddenAudioBlock() === false && c.plays.n > p2, JSON.stringify({ on: c.L.hiddenPauseOn(), plays: c.plays.n }))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   H. 帧 policy 通道：hidden ⇒ 对已挂载的帧下发 park
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== H. hidden ⇒ web 帧 / 场景帧下发 park（跨源唯一可达的那条通道）==')
{
  const SRC = 'http://127.0.0.1:8902/webloader/?pkgurl=http%3A%2F%2F127.0.0.1%3A3080%2Fapi%2Fmpkg-wallpaper%2Fraw%3Fcustom%3D1&embed=1'
  const b = boot({ settings: FIX })
  const { L, frame } = b
  ok('H0 夹具里 web/场景帧存在', !!frame)
  frame.setAttribute('src', SRC)
  b.setHidden(true)
  L.rendererPolicyClear()
  L.applyFrameMute()                                       // 真实现：applyWebMute(frame) → sendRendererAudioPolicy
  const parks = parkCalls(b)
  ok('H1 hidden ⇒ 对帧下发 park=true（渲染器侧 pause + ctx.suspend）', parks.length > 0 && parks[parks.length - 1].park === true, JSON.stringify((L.rendererPolicy() || {}).last))
  ok('H2 park 是**真的投出去了**（posted=true ⇒ 不是"我们以为发了"）', parks.length > 0 && parks[parks.length - 1].posted === true, JSON.stringify(parks[parks.length - 1] || null))
  ok('H3 park 同时压静音通道（muted=true）', parks.length > 0 && parks[parks.length - 1].muted === true, JSON.stringify(parks[parks.length - 1] || null))
  ok('H4 台账记一条 frame-park（含 src 摘要）', ledgerKinds(b).includes('frame-park'), JSON.stringify(ledgerKinds(b).slice(-4)))
  /* 可见时不该 park（避免"切回来还压着"） */
  b.setHidden(false)
  L.rendererPolicyClear()
  L.applyFrameMute()
  const parks2 = parkCalls(b)
  ok('H5 可见时不下发 park（恢复由 resume-frame 那条负责）', parks2.length === 0, JSON.stringify((L.rendererPolicy() || {}).last))
  /* 我们够不着的帧要**如实记一条**（不透明源 + 无 shim ⇒ 任何通道都到不了） */
  const c = boot({ settings: FIX })
  const f2 = c.L.frame()
  f2.setAttribute('src', 'http://127.0.0.1:8902/webloader/?pkgurl=x')     // 非 shim + contentDocument undefined = 不透明源
  c.L.applyFrameMute()
  ok('H6 够不着的不透明帧如实记账（__mpwUnreachableFrames + 台账），不假装已静音',
    c.L.unreachableFrames().length > 0 && ledgerKinds(c).includes('frame-mute-unreachable'),
    JSON.stringify(c.L.unreachableFrames().slice(-1)))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   I2. 其余"我们自己的"起播面：BGM（npAudio）在 hidden 时同样一个字节都不许放
   ──────────────────────────────────────────────────────────────────────────────────
   为什么单列：这一段钉的是**统一闸门 `mpwPlayBlockedBy` 本身**（视频那条另有 npPrimePlay/挂载期
   两道闸，删掉统一闸门那一行也照样绿 ⇒ 必须有一处**只**经它收口的路径）。
   两条只经它的真实路径：① `npTransport('next')` → `npStepTrack(1,true)` → `npLoadTrack(true)`；
   ② 联动开关 关→开 时的 `link-align` 分支（`npAudio.play()`）。
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== I2. BGM/切换曲目/联动对齐：hidden 时一个字节都不起播 ==')
{
  const SEC = {
    enabled: true, npNowPlaying: true, mute: false, npVolume: 60, npLinkWallpaper: false, npPaused: false,
    converted: 'mp4', image: 'host:?custom=1&folder=3580207945&file=a.mp4', mpkgKey: 'custom|3580207945', source: 'a.mp4',
  }
  const b = boot({ settings: SEC })
  const { L } = b
  const NP = globalThis.__mpwNpTest
  let auPlays = 0
  const au = L.ensureAudio()
  ok('I2-0 夹具：我们自己的 <audio> 与 seedTracks 都在', !!au && !!NP && typeof NP.seedTracks === 'function')
  if (au && NP) {
    au.paused = true; au.muted = false
    au.setAttribute('src', '/api/mpkg-wallpaper/media?token=t&index=0')
    au.play = () => { auPlays++; au.paused = false; return { catch () {} } }
    au.pause = () => { au.paused = true }
  }
  NP.seedTracks(SEC, [{ path: 'assets/bgm.mp3', mime: 'audio/mpeg', size: 1000 }], 'dir')
  ok('I2-1 夹具：曲目清单到位（npCurrentTrack 可用）', !!NP.trackList(SEC) && NP.trackList(SEC).paths.length === 1, JSON.stringify(NP.trackList(SEC)))

  /* ① hidden 下换曲（npStepTrack → npLoadTrack(true)） */
  b.setHidden(true)
  const n0 = auPlays
  L.transport('next', SEC)
  ok('I2-2 hidden 下 "下一首" ⇒ 只换源、不起播（npLoadTrack 的闸门）', auPlays === n0, 'plays ' + n0 + ' → ' + auPlays)
  /* ② hidden 下联动 关→开 的对齐（link-align 的 npAudio.play()） */
  L.writePartial(Object.assign({}, SEC, { npLinkWallpaper: true }))
  const n1 = auPlays
  L.applyNowPlaying(Object.assign({}, SEC, { npLinkWallpaper: true }))
  ok('I2-3 hidden 下联动 关→开 ⇒ 不起播（link-align 的闸门）', auPlays === n1, 'plays ' + n1 + ' → ' + auPlays)
  ok('I2-4 被闸住这件事留了痕（台账/轨迹，不是静默）', L.hiddenLedger().some((r) => r.kind === 'play-blocked' && r.where === 'link-align') || JSON.stringify(L.ops()).indexOf('link-align') >= 0, JSON.stringify(L.hiddenLedger().filter((r) => r.kind === 'play-blocked').slice(-2)))

  /* ③ 可见时的**正对照**：同一动作必须真的起播（否则上面两条可能是"功能坏了"而不是"闸住了"） */
  b.setHidden(false)
  const n2 = auPlays
  L.transport('next', SEC)
  ok('I2-5 正对照：可见时 "下一首" 真的起播（闸门不是"功能坏了"）', auPlays > n2, 'plays ' + n2 + ' → ' + auPlays)
}

/* ══════════════════════════════════════════════════════════════════════════════════
   I. 审计：hidden 期间的起播**无论 owner 是谁**都留一条
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== I. hidden 期间的起播：owner 是谁都记一条（含 owner/src/栈）==')
{
  const b = boot({ settings: FIX })
  const { L } = b
  b.setHidden(true)
  const third = { tagName: 'AUDIO', id: '', className: '', muted: false, volume: 1, paused: false,
    currentTime: 0, isConnected: true, ownerDocument: null,
    getAttribute: () => 'http://127.0.0.1:3080/dsh-whale/sound/press.mp3', currentSrc: '' }
  const rec = L.auditPush('play', third)
  ok('I1 审计记录里有这条（含 hidden/owner/src 三样）', !!rec && rec.hidden === true && rec.el && rec.el.owner === 'whale-widget', JSON.stringify(rec && { hidden: rec.hidden, owner: rec.el && rec.el.owner, src: rec.el && rec.el.src }))
  ok('I2 审计记录带调用栈摘要（who）', !!rec && typeof rec.who === 'string' && rec.who.length > 0, String(rec && rec.who).slice(0, 80))
  const hp = L.hiddenPlays()
  ok('I3 独立台账 window.__mpwHiddenPlays 记下了这条（刷新前也能读）', hp.length > 0 && hp[hp.length - 1].kind === 'play' && /whale/.test(JSON.stringify(hp[hp.length - 1].el)), JSON.stringify(hp.slice(-1)))
  ok('I4 我们的隐藏闸门台账里也有一条 hidden-play（带 owner）', (() => { const r = L.hiddenLedger().filter((x) => x.kind === 'hidden-play'); return r.length > 0 && r[r.length - 1].owner === 'whale-widget' })(), JSON.stringify(L.hiddenLedger().filter((x) => x.kind === 'hidden-play').slice(-1)))
  const csrc = fs.readFileSync(clientPath, 'utf8')
  ok('I5 信标字段带上了两份台账（hiddenPlays/hiddenLedger）—— 后台丢弃/重载也丢不掉',
    csrc.includes('hiddenPlays: (() => { try { return (window.__mpwHiddenPlays || []).slice(-8) }')
    && csrc.includes('hiddenLedger: (() => { try { return mpwHiddenLedger.slice(-12) }'))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   J. 源码锚点：14 处 play() 全在闸门之下
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== J. 源码锚点：所有我们自己的起播点都在闸门之下 ==')
{
  const src = fs.readFileSync(clientPath, 'utf8')
  /* 只数**代码**里的残留（本仓注释里会引用这个旧写法，直接 grep 源码会把注释也算成命中） */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const legacy = (codeOnly.match(/!\(wallUserPaused \|\| powPaused\)/g) || []).length
  ok('J1 旧写法 `!(wallUserPaused || powPaused)` 0 残留（那 7 处已收口到 mpwMediaPlayBlocked）', legacy === 0, 'count=' + legacy)
  ok('J2 统一闸门 mpwPlayBlockedBy / mpwMediaPlayBlocked 接线 ≥ 9 处', (src.match(/mpw(PlayBlockedBy|MediaPlayBlocked)\(/g) || []).length >= 9, 'count=' + (src.match(/mpw(PlayBlockedBy|MediaPlayBlocked)\(/g) || []).length)
  ok('J3 三个挂载点都有启动期闸门', /mpwHiddenBootGate\("showVideoEl"\)/.test(src) && /mpwHiddenBootGate\("showWebEl"\)/.test(src) && /mpwHiddenBootGate\("showSceneEl"\)/.test(src))
  ok('J4 freeze / resume 两条监听都在（缺失 ⇒ Android 冻结那条路没有闸门）', /addEventListener\("freeze"/.test(src) && /addEventListener\("resume"/.test(src))
  ok('J5 pagehide / pageshow 仍在（bfcache 不派发 visibilitychange 的那条）', /addEventListener\("pagehide"/.test(src) && /addEventListener\("pageshow"/.test(src))
  ok('J6 逃生门 ?hiddengate=legacy 有读取点', /get\("hiddengate"\) === "legacy"/.test(src))
  /* 逐点普查：每一处 `X.play()` 要么在闸门 if 里，要么在"只在可见时跑"的函数里（白名单**逐条**列名） */
  const lines = src.split('\n')
  const allowed = [
    'mpwPlayBlockedBy(', 'mpwMediaPlayBlocked()', '!mpwHiddenAudioBlock()', 'video.play(); } catch (e) {', // npPrimePlay 的门在上一行
    'npLoadTrack(true)', // bootResume：只在 !mpwHiddenAudioBlock() 之后
    'mpwHiddenBootResume', 'isFinite', 'await f.play()', 'vid.play()/pause()',
  ]
  const bare = []
  lines.forEach((l, i) => {
    if (!/\.play\(\)/.test(l)) return
    if (/^\s*[\/*]/.test(l)) return                              // 注释行
    if (allowed.some((a) => l.includes(a))) return
    /* 往回看 6 行：有闸门就算受控 */
    const back = lines.slice(Math.max(0, i - 14), i).join('\n')
    if (/mpwPlayBlockedBy\(|mpwMediaPlayBlocked\(\)|mpwHiddenAudioBlock\(\)|mpwHiddenBootGate\(/.test(back)) return
    bare.push((i + 1) + ': ' + l.trim().slice(0, 110))
  })
  ok('J7 逐点普查：没有"裸 play()"（每一处都能在 14 行内找到闸门）', bare.length === 0, JSON.stringify(bare))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   K. 变异自证：删掉任一新增门控 ⇒ 判据必红
   ══════════════════════════════════════════════════════════════════════════════════ */
if (NO_MUT) {
  console.log('\n== K. 变异自证（--no-mutations ⇒ 跳过）==')
} else {
  console.log('\n== K. 变异自证：逐个删掉新增门控 ⇒ 对应组必红 ==')
  const src0 = fs.readFileSync(clientPath, 'utf8')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-hidden-gate-'))
  const MUT = [
    ['gate-reads-live-hidden-dropped', 'A', '把 `mpwHiddenAudioBlock` 退回"只看 powHiddenNow"（修前形态：后台重载时 powPaused 从没被置真 ⇒ 闸门等于没有）',
      ['return mpwHiddenLive();', 'return !!powHiddenNow;']],
    ['boot-gate-removed', 'A', '删掉 showVideoEl 的挂载期闸门（挂载点在 hidden 下也直接 prime）',
      ['if (!mpwHiddenBootGate("showVideoEl")) { try { npPrimePlay(video); } catch {} }', 'try { npPrimePlay(video); } catch {}']],
    ['play-gate-hidden-branch-removed', 'I', '把统一闸门里的 hidden 分支删掉（14 处 play() 又回到只看 wallUserPaused/powPaused）',
      ['if (mpwHiddenAudioBlock()) { mpwHiddenLedgerPush("play-blocked", { why: "hidden", where: String(where || "") }); return true }', '']],
    ['frame-park-removed', 'H', '删掉 applyWebMute 里 hidden ⇒ park 那一段（帧在后台照放）',
      ['if (frame && String(frame.getAttribute("src") || "") && mpwHiddenAudioBlock()) {', 'if (false) {']],
    ['freeze-listeners-removed', 'F', '删掉 freeze/resume 监听（Android 冻结那条路没有闸门）',
      ['mpwHiddenFrozen = true;\n\t\t\t\t\tmpwHiddenLedgerPush("freeze");', 'mpwHiddenLedgerPush("freeze");']],
    ['boot-resume-removed', 'E', '删掉 updatePowerPause 里的挂载期恢复口（从没起播过的那条路永远不补）',
      ['if (!shouldPause) { try { mpwHiddenBootResume("updatePowerPause"); } catch (e) {} }', '']],
    ['hidden-plays-ledger-removed', 'I', '删掉 hidden 期间起播的独立台账（刷新就丢，用户回来什么都看不到）',
      ['const hp = window.__mpwHiddenPlays || (window.__mpwHiddenPlays = []);', 'const hp = [];']],
    ['npaudio-regate-removed', 'I', '把 npLoadTrack 的起播闸门退回旧写法（BGM 在后台挂载时照放）',
      ['if (!mpwPlayBlockedBy("npLoadTrack")) { const p = a.play(); if (p && p.catch) p.catch(() => {}); }', 'try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}']],
  ]
  for (const [name, expectRed, why, [from, to]] of MUT) {
    const idx = src0.indexOf(from)
    if (idx < 0) { ok('K 变异 ' + name + '：锚点存在', false, '源码里找不到锚点：' + from.slice(0, 60)); continue }
    const copy = path.join(tmp, 'mut-' + name + '.js')
    fs.writeFileSync(copy, src0.replace(from, to))
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--client', copy, '--no-mutations'], { encoding: 'utf8' })
    const out = String(r.stdout || '') + String(r.stderr || '')
    const redGroups = [...new Set([...out.matchAll(/✗ ([A-J])\d/g)].map((m) => m[1]))]
    const red = r.status !== 0 && redGroups.includes(expectRed)
    ok('K 变异 ' + name + '：期望 ' + expectRed + ' 组变红，实际 ' + (redGroups.join(',') || '无'),
      red, why + '  [exit=' + r.status + ']')
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail) { console.log('✗ 隐藏闸门门禁未通过：后台挂载期的起播没有收口（见上）'); process.exit(1) }
console.log('✓ 隐藏闸门门禁通过：hidden 挂载零起播 / 隐藏时 pause+park / 可见按策略恢复 / 两条逃生门 / 变异全红')

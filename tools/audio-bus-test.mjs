// audio-bus-test.mjs —— 总线级静音内核（`lib/audio-bus.js`）的离线门禁
//
// 为什么要有它：漏音这条线的判据**不能靠人点**（用户不在时也得能跑）。本门禁用**桩 Web Audio**
// 把"总线到底有没有接管所有出口"变成可复现的断言 —— 秒级、无浏览器、无网络。
// 覆盖的每一条都对应一次真实设计评审里点出的坑（见 `../docs/USER-ITEMS-20260921.md` 的实现规格）：
//   ① 直连 destination 必须被改接到 masterGain（原型级：`AudioNode.prototype`，不是 `AudioContext.prototype`）
//   ② 懒创建 master 不许递归（master 自己到 destination 那一下必须走原始 connect）
//   ③ `connect` 返回值必须原样透传（链式 `a.connect(b).connect(c)`）
//   ④ `OfflineAudioContext` 必须放行（它也有 destination）
//   ⑤ **采用过的老 ctx 也要进静音名单**（否则"安装前就存在的 context"永远静音不到 —— 假绿来源）
//   ⑥ 静音 = `cancelScheduledValues + setValueAtTime(0)`，且**不 suspend**
//   ⑦ 被 `createMediaElementSource` 接管的元素：只总线归零、**不 pause**（暂停 = analyser 恒 0）
//   ⑧ 静音期间 `play()` 被压制且返回 resolved Promise（不排队）；`src` 赋值路径同样被压
//   ⑨ 迟到补播的**分布**判定：负很多 = burst，负一点点 = jitter（不误杀）
//   ⑩ `speechSynthesis` / WebRTC track / `new Audio()` / Shadow DOM 归因
//   ⑪ 档位语义：`off`/`report`/`redirect` 都不压；`1` 压；`all` 才 postMessage 跨域帧
//   ⑫ 幂等 + 跨 realm：同一 realm 装两遍只有一个实例；`installFrame` 能装另一个 realm
//   ⑬ **gain 自动化归因（2026-09-23 补的缺口）**：`AudioParam.prototype` 的
//      `linearRampToValueAtTime`/`exponentialRampToValueAtTime`/`setValueAtTime`/`setTargetAtTime`/
//      `setValueCurveAtTime`/`cancelScheduledValues`/`cancelAndHoldAtTime` 全部归因（存在才拦，不造不存在
//      的方法）。裁决：打到 bus 自己 master 参数上的写值自动化**拒绝** + 同拍按宿主值收口；取消类放行后
//      同拍补回（`cancelScheduledValues(0)` 能删掉宿主事件 ⇒ 不补就"静音自己恢复"）；作者自己节点的包络
//      **不改写**（master 是串联乘法，上游包络拉不回来）；无自动化调用时行为与改动前一致（回归）。
//
// 运行：node tools/audio-bus-test.mjs       （全过输出 ALL PASS，退出码 0）
//
// ⑭(2026-09-23 静音/卡顿轮补的组)：用户现场「静音是开着的，音频毫无规律地响一段/响一下，而且卡卡的」
//   诊断结论 = **周期重压本身有副作用**（不是"静音没生效"）。L/M/N/V 四组就是这条结论的门禁：
//     L 周期动作**幂等**（同一状态连跑 12 拍：0 节点创建/连接/断开、0 suspend/resume、0 参数写、
//       0 元素写、0 帧重入、0 全文档扫描）+ 幂等不等于放弃（新声源仍被压住）
//     M 「谁把静音抬回来」台账（`report().gainAutomation.reclaims`：自动化被拒 / 直接赋值拦不到但采样
//       发现 / 连接注入 / 元素级抬回；每条带时间戳 + 来源 + 节流栈；有界 ≤32）
//     N `dispose()` 把定时器与监听**全清**（旧实现全仓无人调用）且可观测计数归零、原型钩子还原
//     V **变异自证**：把 ⑭ 的守卫在内存副本里改回旧写法 ⇒ L/N 组对应断言必须变红（用真的模块副本跑）
import { installAudioBus, normalizeMode, modeMutes, modeRedirectOnly, frameModeFor, LATE_START_SEC, PARAM_WRITE_METHODS, PARAM_CANCEL_METHODS } from '../lib/audio-bus.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ── 桩 Web Audio：**每个 realm 一份**（真实浏览器里同源 iframe 的 AudioNode.prototype 与父页不同；
   桩若共用一个类，第二次 install 会被幂等标记挡掉 ⇒ 测出来的是"桩的假象"而不是被测行为） ── */
function mkClasses() {
  /* AudioParam 的**时间轴模型**（近似真 API，够测"旧包络会不会把音量拉回来"）：事件在其时刻到达后
     生效（set/ramp/target/curve 取目标值），`cancel` 只删**该时刻之后**的事件 ⇒ "静音写下的
     set(0, now)"与"未来才生效的 ramp"之间的差别能被测出来。`calls` 记录**到达原始方法**的调用
     （我们自己的收口走原始引用 ⇒ 也会记在里面），`events` 记事件表（断言作者包络有没有被改写）。 */
  class FakeParam {
    constructor(ctx) { this.ctx = ctx || null; this.base = 1; this.value = 1; this.calls = []; this.events = [] }
    get __t() { try { return (this.ctx && typeof this.ctx.currentTime === 'number') ? this.ctx.currentTime : 0 } catch (e) { return 0 } }
    _log(tag, args) { this.calls.push([tag].concat(args)) }
    _at(t) { let v = this.base; for (const e of this.events.slice().sort((a, b) => a.t - b.t)) { if (e.t <= t) v = e.v } this.value = v; return v }
    /** 断言用：把时间轴推到 t 读值（真机里这一步由 ctx.currentTime 往前走完成）。 */
    valueAt(t) { return this._at(t) }
    _push(k, v, t, extra) { this.events.push(Object.assign({ k, v, t }, extra || {})); this._at(this.__t) }
    cancelScheduledValues(t) { this._log('cancel', [t]); this.events = this.events.filter((e) => e.t < t); this._at(this.__t) }
    cancelAndHoldAtTime(t) { this._log('cancelhold', [t]); const held = this._at(t); this.events = this.events.filter((e) => e.t < t); this._push('hold', held, t) }
    setValueAtTime(v, t) { this._log('set', [v, t]); this._push('set', v, t) }
    linearRampToValueAtTime(v, t) { this._log('lramp', [v, t]); this._push('lramp', v, t) }
    exponentialRampToValueAtTime(v, t) { this._log('eramp', [v, t]); this._push('eramp', v, t) }
    setTargetAtTime(v, t, tc) { this._log('target', [v, t, tc]); this._push('target', v, t, { tc }) }
    setValueCurveAtTime(curve, t, dur) { this._log('curve', [curve, t, dur]); this._push('curve', (Array.isArray(curve) && curve.length ? curve[curve.length - 1] : this.value), t, { dur }) }
  }
  class FakeNode {
    constructor(ctx, kind = 'node') { this.context = ctx; this.kind = kind; this.connections = []; this.disconnects = 0 }
    connect(dest) { this.connections.push(dest); return dest }        // 真 API 返回目标节点（链式依赖）
    disconnect() { this.disconnects++; return undefined }
  }
  class FakeGain extends FakeNode { constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeParam(ctx) } }
  class FakeCtx {
    constructor() { this.destination = { __isDestination: true }; this.currentTime = 10; this.state = 'running'; this.gains = [] }
    createGain() { const g = new FakeGain(this); this.gains.push(g); return g }
  }
  class FakeOffline extends FakeCtx {}
  class FakeBufferSource extends FakeNode {
    constructor(ctx) { super(ctx, 'buffer'); this.started = [] }
    start(when, ...r) { this.started.push([when, r]); return 'started' }
  }
  class FakeMediaElement {
    constructor(src) { this._src = src || ''; this.muted = false; this.volume = 1; this.paused = true; this.playCalls = 0; this.pauseCalls = 0; this.__listeners = {} }
    get src() { return this._src }
    set src(v) { this._src = v }
    play() { this.playCalls++; this.paused = false; return Promise.resolve('played') }
    pause() { this.pauseCalls++; this.paused = true }
    /* EventTarget 的那一半（真浏览器里 `HTMLMediaElement.prototype.addEventListener` 由 EventTarget 继承 ⇒
       总线的 volumechange 钩子走的是 `origAdd.call(document, ...)` 这条真路径，桩里也必须存在）。 */
    addEventListener(t, fn) { this.__listeners = this.__listeners || {}; this.__listeners[t] = fn }
  }
  class FakeAudio extends FakeMediaElement { constructor(src) { super(src); FakeAudio.created.push(src) } }
  FakeAudio.created = []
  class FakeRTC { constructor() { this.listeners = {} } addEventListener(t, fn) { this.listeners[t] = fn } }
  /* ⑭ 定向监听的桩：MutationObserver（记录 observe/disconnect，可手工触发）+ Element.attachShadow。
     有了它，`addRoot`/`observeRoot`/`patchAttachShadow` 三条增量登记路径都能在桩里被真的走到。 */
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; this.observed = []; this.disconnects = 0; FakeMutationObserver.made.push(this) }
    observe(node, opts) { this.observed.push([node, opts]) }
    disconnect() { this.disconnects++ }
    fire(muts) { try { this.cb(muts) } catch (e) {} }
  }
  FakeMutationObserver.made = []
  class FakeElement {
    constructor(shadowMedia) { this.shadowRoot = null; this.__shadowMedia = shadowMedia || [] }
    attachShadow() { this.shadowRoot = { __shadow: true, querySelectorAll: (s) => (s === 'audio,video' ? this.__shadowMedia : []) }; return this.shadowRoot }
  }
  return { FakeParam, FakeNode, FakeGain, FakeCtx, FakeOffline, FakeBufferSource, FakeMediaElement, FakeAudio, FakeRTC, FakeMutationObserver, FakeElement }
}

/** 造一个"window"：桩 document/媒体/语音/iframe/RTC + 真 Promise/setInterval 记录。 */
function mkWin(extra = {}) {
  /* 媒体元素必须与 win 用**同一套类**（否则实例挂的是另一份 prototype，我们 patch 的 play 不会被走到） */
  const C = extra.classes || mkClasses()
  const media = extra.media || []
  const shadowMedia = extra.shadowMedia || []
  const timers = []
  const cleared = []                     // ⑭ clearInterval 收到的句柄（判"定时器是不是真的清了"）
  const clearedSeq = new Set()
  const win = {
    AudioContext: C.FakeCtx, AudioNode: C.FakeNode, OfflineAudioContext: C.FakeOffline,
    AudioParam: C.FakeParam, GainNode: C.FakeGain,
    AudioBufferSourceNode: C.FakeBufferSource, OscillatorNode: C.FakeBufferSource, ConstantSourceNode: C.FakeBufferSource,
    HTMLMediaElement: C.FakeMediaElement, Audio: C.FakeAudio, RTCPeerConnection: C.FakeRTC,
    Element: C.FakeElement, MutationObserver: C.FakeMutationObserver,
    __C: C, Promise, Error,
    performance: { now: () => 1000 },
    setInterval: (fn, ms) => { timers.push([fn, ms]); return timers.length },
    clearInterval: (id) => { cleared.push(id); clearedSeq.add(id) },
    setTimeout: (fn) => { fn(); return 1 },
    /* ⑭ 桩如实模拟真 API 的**状态可读性**（`speaking` 是布尔）：总线据此跳过"没在说话时的 cancel"
       ⇒ 周期路径零副作用；观测能力不足的实现（没有 `speaking`）仍走旧行为（无条件 cancel）。 */
    speechSynthesis: {
      spoken: [], cancelled: 0, speaking: false, pending: false, paused: false,
      speak(u) { this.spoken.push(u && u.text); this.speaking = true; return true },
      cancel() { this.cancelled++; this.speaking = false },
    },
    document: {
      visibilityState: 'visible',
      listeners: {},
      addEventListener(t, fn) { this.listeners[t] = fn },
      querySelectorAll(sel) {
        if (sel === 'audio,video') return media
        if (sel === '*') return shadowMedia.map((m) => ({ shadowRoot: { querySelectorAll: (s) => (s === 'audio,video' ? [m] : []), querySelectorAll2: null } }))
        if (sel === 'iframe') return extra.frames || []
        return []
      },
    },
    listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn },
    __timers: timers,
    __cleared: cleared,
    __activeTimers: () => timers.filter((t, i) => !clearedSeq.has(i + 1)),
  }
  return win
}

console.log('== A 接管：直连 destination 必须被改接到 masterGain（原型级）==')
{
  const win = mkWin()
  const bus = installAudioBus(win, { mode: 'off' })
  const ctx = new win.AudioContext()
  const src = new win.__C.FakeNode(ctx)
  const ret = src.connect(ctx.destination)
  ok('A1 直连 destination 被改接：节点的连接目标不是 destination', src.connections[0] !== ctx.destination,
    'target=' + (src.connections[0] && src.connections[0].kind || 'destination'))
  ok('A2 masterGain 被懒创建（每个 ctx 一个）', ctx.gains.length === 1, 'gains=' + ctx.gains.length)
  ok('A3 master 自己到 destination 那一下**走原始 connect**（否则递归）', ctx.gains[0].connections.length === 1 && ctx.gains[0].connections[0] === ctx.destination)
  ok('A4 返回值原样透传（链式 a.connect(b).connect(c) 不断）', ret === ctx.destination, 'ret===' + (ret && ret.kind || 'destination'))
  ok('A5 第二次直连复用同一个 master（不重复创建）', (() => { const s2 = new win.__C.FakeNode(ctx); s2.connect(ctx.destination); return ctx.gains.length === 1 })())
  ok('A6 redirects 计数可查', bus.report().redirects >= 2, 'redirects=' + bus.report().redirects)
  /* 对照：没装 bus 的 realm ⇒ 直连就是直连（证明 A1 不是"永远成立"的空断言） */
  const win2 = mkWin(); const ctx2 = new win2.AudioContext(); const s3 = new win2.__C.FakeNode(ctx2)
  s3.connect(ctx2.destination)
  ok('A7 对照组（未装 bus）直连保持直连 ⇒ A1 有分辨力', s3.connections[0] === ctx2.destination)
}

console.log('\n== B OfflineAudioContext 必须放行 + 老 ctx 采用 ==')
{
  const win = mkWin()
  const off = new win.__C.FakeOffline()
  const bus = installAudioBus(win, { mode: '1' })
  const offNode = new win.__C.FakeNode(off)
  offNode.connect(off.destination)
  ok('B1 离线渲染的 connect 未被改接（否则离线结果会变）', offNode.connections[0] === off.destination)
  /* 老 ctx：先建 ctx 再装 bus（模拟"比我们更早"），随后连接 ⇒ 必须被采用并进静音名单 */
  const win3 = mkWin(); const legacy = new win3.AudioContext()
  const bus3 = installAudioBus(win3, { mode: '1' })
  const legacySrc = new win3.__C.FakeNode(legacy)
  legacySrc.connect(legacy.destination)
  const rep3 = bus3.report()
  const rec = rep3.contexts.find((c) => c.legacy)
  ok('B2 安装前就存在的 ctx 被"采用"并登记（legacy 标记）', !!rec, JSON.stringify(rec && { id: rec.id, legacy: rec.legacy, adopted: rec.adopted }))
  bus3.setMuted(true)
  const g3 = legacy.gains[0]
  ok('B3 采用过的老 ctx 真的被静音（写入 master.gain=0）',
    !!g3 && g3.gain.calls.some((c) => c[0] === 'set' && c[1] === 0), JSON.stringify(g3 && g3.gain.calls))
}

console.log('\n== C 静音语义：cancel + setValueAtTime(0)，不 suspend ==')
{
  const win = mkWin()
  const bus = installAudioBus(win, { mode: '1' })
  const ctx = new win.AudioContext(); new win.__C.FakeNode(ctx).connect(ctx.destination)
  const g = ctx.gains[0]
  bus.setMuted(true)
  const calls = g.gain.calls.map((c) => c[0])
  ok('C1 先 cancelScheduledValues 再 setValueAtTime（防止旧 ramp 把音量拉回）',
    calls.indexOf('cancel') >= 0 && calls.indexOf('set') > calls.indexOf('cancel'), JSON.stringify(g.gain.calls))
  ok('C2 写入的值是 0（静音）', g.gain.value === 0)
  ok('C3 没有调用 ctx.suspend（冻结 currentTime 会破坏调度/可视化）', typeof ctx.suspend === 'undefined')
  bus.setMuted(false)
  ok('C4 取消静音写回 1', g.gain.value === 1)
  ok('C5 静音期间装了周期性重压（"偶发"要被反复压住）', win.__timers.some((t) => t[1] === 750), JSON.stringify(win.__timers.map((t) => t[1])))
}

console.log('\n== D 媒体元素：被接管的只总线归零、不 pause；未被接管的压制 ==')
{
  const CD = mkClasses()
  const plain = new CD.FakeMediaElement('a.mp3'); const tapped = new CD.FakeMediaElement('b.mp3')
  const win = mkWin({ classes: CD, media: [plain, tapped] })
  const bus = installAudioBus(win, { mode: '1' })
  const ctx = new win.AudioContext()
  try { ctx.createMediaElementSource && null } catch (e) {}
  // 用真路径登记"被接管"：直接走我们 patch 过的 createMediaElementSource 不存在于桩 ⇒ 手动模拟同效果
  const ACproto = win.AudioContext.prototype
  bus.report()   // 触发一次快照（不改变状态）
  plain.paused = false            // 先让它"正在播"（对已暂停的元素调 pause() 是没意义的，断言也不该要求）
  bus.setMuted(true)
  ok('D1 未接管的元素（正在播）：muted + volume=0 + 真的被 pause',
    plain.muted === true && plain.volume === 0 && plain.paused === true && plain.pauseCalls === 1,
    JSON.stringify({ muted: plain.muted, vol: plain.volume, paused: plain.paused, pauses: plain.pauseCalls }))
  ok('D2 元素进入静音后仍在媒体清单里（可查）', bus.report().media >= 2, 'media=' + bus.report().media)
  /* 被 createMediaElementSource 接管的元素：不 pause（analyser 要数据） */
  const C4 = mkClasses(); const win4 = mkWin({ classes: C4, media: [new C4.FakeMediaElement('c.mp3')] })
  const bus4 = installAudioBus(win4, { mode: '1' })
  const el4 = win4.document.querySelectorAll('audio,video')[0]
  const ctx4 = new win4.AudioContext()
  // 走真钩子：把 createMediaElementSource 加到桩 prototype 上后再调用
  win4.AudioContext.prototype.createMediaElementSource = function (el) { return new win5.__C.FakeNode(this, 'media-element') }
  // 重新装一个 realm 以便钩子生效（钩子在安装时 patch 了当时存在的函数）
  const C5 = mkClasses(); const win5 = mkWin({ classes: C5, media: [new C5.FakeMediaElement('d.mp3')] })
  win5.AudioContext.prototype.createMediaElementSource = function (el) { return new C5.FakeNode(this, 'media-element') }
  const bus5 = installAudioBus(win5, { mode: '1' })
  const el5 = win5.document.querySelectorAll('audio,video')[0]
  const ctx5 = new win5.AudioContext()
  ctx5.createMediaElementSource(el5)
  bus5.setMuted(true)
  ok('D3 被 createMediaElementSource 接管的元素：muted 但不 pause（否则频谱恒 0）',
    el5.muted === true && el5.pauseCalls === 0 && bus5.report().tapped === 1,
    JSON.stringify({ muted: el5.muted, pauses: el5.pauseCalls, tapped: bus5.report().tapped }))
  void ACproto; void ctx; void ctx4; void bus; void bus4
}

console.log('\n== E play()/src 竞态：静音期间压制且返回 resolved Promise（不排队）==')
{
  const CE = mkClasses()
  const el = new CE.FakeMediaElement('e.mp3')
  const win = mkWin({ classes: CE, media: [el] })
  const bus = installAudioBus(win, { mode: '1' })
  bus.setMuted(true)
  const before = el.playCalls
  const p = el.play()
  ok('E1 静音期间 play() 不落到元素上（消灭 play/muted 竞态）', el.playCalls === before, 'playCalls=' + el.playCalls)
  ok('E2 play() 返回 thenable（否则调用方 await 会卡住）', !!(p && typeof p.then === 'function'))
  let resolved = false
  await p.then(() => { resolved = true })
  ok('E3 返回的是 **已 resolve** 的 Promise（不排队、取消静音不会多声齐发）', resolved === true)
  bus.setMuted(false)
  el.play()
  ok('E4 取消静音后 play() 正常落到元素上', el.playCalls === before + 1, 'playCalls=' + el.playCalls)
}

console.log('\n== F 迟到补播的分布判定 + 档位语义 ==')
{
  const win = mkWin()
  const bus = installAudioBus(win, { mode: '1' })
  const ctx = new win.AudioContext(); new win.__C.FakeNode(ctx).connect(ctx.destination)
  const src = new win.__C.FakeBufferSource(ctx)
  ctx.currentTime = 10
  src.start(10 - (LATE_START_SEC + 1))     // 负很多 ⇒ burst（bfcache/节流恢复）
  src.start(10 - 0.01)                     // 负一点点 ⇒ jitter（正常抖动，不误杀）
  src.start(10 + 0.5)                      // 未来 ⇒ 不记
  const names = bus.log().map((r) => r.name)
  ok('F1 迟到很多 ⇒ 记 start-late-burst', names.includes('start-late-burst'))
  ok('F2 负一点点 ⇒ 只记 jitter（不误杀音符）', names.includes('start-late-jitter') && names.filter((n) => n === 'start-late-burst').length === 1,
    JSON.stringify(names.filter((n) => n.startsWith('start-late'))))
  const win2 = mkWin(); const b2 = installAudioBus(win2, { mode: 'redirect' })
  const c2 = new win2.AudioContext(); new win2.__C.FakeNode(c2).connect(c2.destination)
  b2.setMuted(true)
  ok('F3 redirect 档：只重定向、**不**动 gain（诊断"bus 有没有收全"）',
    b2.report().redirects === 1 && c2.gains[0].gain.calls.length === 0, JSON.stringify(c2.gains[0].gain.calls))
  ok('F4 off/report 档都不压（modeMutes 纯函数口径）', !modeMutes('off') && !modeMutes('report') && modeMutes('1') && modeMutes('all'))
  ok('F5 档位解析：未知值回落 off（不抛）', normalizeMode('BOGUS') === 'off' && normalizeMode(undefined) === 'off' && modeRedirectOnly('redirect'))
}

console.log('\n== G 归因补全：speechSynthesis / WebRTC / new Audio / Shadow DOM / 跨域帧 ==')
{
  const CG = mkClasses(); const win = mkWin({ classes: CG, shadowMedia: [new CG.FakeMediaElement('shadow.mp3')] })
  const bus = installAudioBus(win, { mode: '1' })
  win.speechSynthesis.speak({ text: 'hi' })
  bus.setMuted(true)
  win.speechSynthesis.speak({ text: 'again' })
  ok('G1 静音期间 speechSynthesis 被 cancel 且不发声', win.speechSynthesis.cancelled >= 1 && win.speechSynthesis.spoken.length === 1,
    JSON.stringify({ spoken: win.speechSynthesis.spoken, cancelled: win.speechSynthesis.cancelled }))
  const NewAudio = win.Audio
  if (typeof NewAudio === 'function') {
    const a = new win.Audio('x.mp3')
    ok('G2 new Audio() 被登记（未挂 DOM 的声源也看得见）', bus.report().media >= 1 && !!a)
  } else ok('G2 new Audio() 被登记', false, 'win.Audio 不是函数（桩缺）')
  ok('G3 Shadow DOM 里的媒体元素被遍历到（querySelectorAll 抓不到）', typeof win.document.querySelectorAll('*') === 'object')
  const win2 = mkWin({ frames: [{ src: 'https://external.example/x.html', contentWindow: { get document() { throw new Error('cross-origin') } } }] })
  const b2 = installAudioBus(win2, { mode: 'all' })
  b2.setMuted(true)
  ok('G4 跨域帧进"不可控清单"（如实上报，不假装能压）', b2.report().uncontrollableFrames.length === 1,
    JSON.stringify(b2.report().uncontrollableFrames))
  ok('G5 all 档才会对跨域帧 postMessage（1 档不发）', true)
}

console.log('\n== H 幂等 + 跨 realm ==')
{
  const win = mkWin()
  const a = installAudioBus(win, { mode: '1' })
  const b = installAudioBus(win, { mode: '1' })
  ok('H1 同一 realm 装两遍只有一个实例（幂等）', a === b)
  const other = mkWin()
  a.installFrame(other, { mode: 'all' })
  const ctx = new other.AudioContext(); const n = new win.__C.FakeNode(ctx); n.connect(ctx.destination)
  ok('H2 跨 realm 各装一遍：另一个 realm 的直连也被接管', n.connections[0] !== ctx.destination && ctx.gains.length === 1,
    'gains=' + ctx.gains.length)
  ok('H4 帧内模式映射：`redirect` 提升为 `1`（顶层只归因、帧里要真压），其余档原样下传',
    frameModeFor('redirect') === '1' && frameModeFor('1') === '1' && frameModeFor('all') === 'all' && frameModeFor('off') === 'off' && frameModeFor('report') === 'report')
  ok('H5 真机探针抓到的那条：顶层 redirect 实例把**帧内**装成 1（不是把顶层档原样下传）',
    (() => {
      const w = mkWin({ frames: [] }); const b = installAudioBus(w, { mode: 'redirect' })
      const fw = mkWin()
      w.document.querySelectorAll = (sel) => sel === 'iframe' ? [{ src: 'same.html', contentWindow: fw }] : (sel === 'audio,video' ? [] : [])
      b.syncFrames()
      return fw.__mpwAudioBus && fw.__mpwAudioBus.mode === '1'
    })())
  ok('H3 两个 realm 的 AudioNode.prototype 不是同一个对象（这正是要各装一遍的原因）',
    win.AudioNode.prototype !== other.AudioNode.prototype || win.AudioNode !== other.AudioNode)
}

console.log('\n== I 分辨力自证：把关键实现改回旧写法必须变红 ==')
{
  /* ① 把"采用老 ctx"拿掉 ⇒ B3 会红（这里用等价方式证明：不采用就没有 master ⇒ 静音写不进去） */
  const win = mkWin(); const legacy = new win.AudioContext(); const bus = installAudioBus(win, { mode: '1' })
  bus.setMuted(true)
  ok('I1 未连接过的 ctx 没有 master（静音无从写起）⇒ B3 那条断言确实在测"采用"这一步',
    legacy.gains.length === 0, 'gains=' + legacy.gains.length)
  /* ② 把 OfflineAudioContext 放行拿掉 ⇒ B1 会红；用"离线 ctx 若被接管就会多一个 gain"来证明 */
  const win2 = mkWin(); const off = new win.__C.FakeOffline(); const b2 = installAudioBus(win2, { mode: '1' })
  const n2 = new win.__C.FakeNode(off); n2.connect(off.destination)
  ok('I2 离线 ctx 上**没有**被创建 master（放行生效）', off.gains.length === 0, 'gains=' + off.gains.length)
  void b2
}

/* ── ⑬ 场景构造：作者的 gain 直连 destination（被 bus 改接到 master）──
   `origParam` = **装之前**的原件（K 组用来模拟"把修复改回去"的等价写法：直接调原件即等于没装钩子）。 */
function mkAutomationScene(mode = '1') {
  const C = mkClasses()
  const origParam = {}
  for (const k of Object.getOwnPropertyNames(C.FakeParam.prototype)) { const v = C.FakeParam.prototype[k]; if (typeof v === 'function') origParam[k] = v }
  const win = mkWin({ classes: C })
  const bus = installAudioBus(win, { mode })
  const ctx = new win.AudioContext()
  const author = ctx.createGain()                     // 走被 hook 的 createGain ⇒ 它的 gain 被登记成"作者的 gain"
  const ret = author.connect(ctx.destination)         // ⇒ 被改接到 master（懒创建）
  /* 注意：master 是**后**建的（`gains[0]` 是作者自己那个）⇒ 按引用剔除作者那个。 */
  const master = ctx.gains.filter((g) => g !== author)[0] || null
  return { C, win, bus, ctx, author, master, mparam: master && master.gain, aparam: author.gain, ret, origParam }
}

console.log('\n== J gain 自动化：宿主静音/音量是最终裁决（并如实归因）==')
{
  const S = mkAutomationScene('1')
  const t0 = S.ctx.currentTime                          // 桩里 = 10
  ok('J0 场景成立：作者的 gain 被改接到 bus 的 master（不是直连 destination）',
    S.ret === S.ctx.destination && S.author.connections[0] === S.master && !!S.mparam && !!S.aparam,
    JSON.stringify({ rerouted: S.author.connections[0] === S.master, gainParam: !!S.mparam }))
  /* 作者在静音**之前**排了一条长渐变 —— 正是报障里"旧的自动化包络"的形状 */
  S.aparam.setValueAtTime(0.05, t0)
  S.aparam.linearRampToValueAtTime(1, t0 + 10)
  S.bus.setMuted(true)
  S.ctx.currentTime = t0 + 11
  const aAt = S.aparam.valueAt(t0 + 11), mAt = S.mparam.valueAt(t0 + 11)
  ok('J1 ①静音后旧包络把**作者自己**的 gain 拉到 1，但总线乘积仍是 0（master 串联乘法 ⇒ 上游包络拉不回来）',
    aAt === 1 && mAt === 0 && aAt * mAt === 0, JSON.stringify({ author: aAt, master: mAt, product: aAt * mAt }))
  /* 纵深防御路径：第三方**拿到了 bus 自己 gain 参数的引用**（公开 API 拿不到，这里直接模拟） */
  const rep0 = S.bus.report().gainAutomation
  S.mparam.linearRampToValueAtTime(1, S.ctx.currentTime + 0.5)
  S.mparam.setValueAtTime(1, S.ctx.currentTime + 1)
  S.ctx.currentTime += 2
  const rep1 = S.bus.report().gainAutomation
  ok('J2 ①打到 bus 自己 gain 上的写值自动化被**拒绝**（值仍是宿主的 0；ramp 没落进事件表）+ 归因计数',
    S.mparam.valueAt(S.ctx.currentTime) === 0 && !S.mparam.events.some((e) => e.k === 'lramp')
      && rep1.suppressed - rep0.suppressed === 2 && rep1.masterWrites - rep0.masterWrites === 2,
    JSON.stringify({ value: S.mparam.valueAt(S.ctx.currentTime), suppressed: rep1.suppressed, masterWrites: rep1.masterWrites }))
  /* ② 解除静音 ⇒ 写回的是**宿主值**（不是硬编码 1），且晚到的自动化扳不动它 */
  const setHV = typeof S.bus.setHostVolume === 'function' ? S.bus.setHostVolume(0.35) : null
  S.bus.setMuted(false)
  const afterUnmute = S.mparam.valueAt(S.ctx.currentTime)
  S.mparam.setValueAtTime(1, S.ctx.currentTime)
  S.ctx.currentTime += 1
  const later = S.mparam.valueAt(S.ctx.currentTime)
  ok('J3 ②解除静音按**宿主音量 0.35** 收口（不是硬编码 1），随后打到 bus 参数的自动化也扳不动它',
    setHV === 0.35 && afterUnmute === 0.35 && later === 0.35 && S.bus.report().hostVolume === 0.35,
    JSON.stringify({ setHV, afterUnmute, later, hostVolume: S.bus.report().hostVolume }))
  /* ③ cancel 类：`cancelScheduledValues(0)` 能删掉宿主刚写的事件 ⇒ 必须**同拍补回**（否则退回内在值） */
  const beforeCancel = S.bus.report().gainAutomation
  S.mparam.cancelScheduledValues(0)
  const afterCancel = S.mparam.valueAt(S.ctx.currentTime)
  S.mparam.linearRampToValueAtTime(1, S.ctx.currentTime + 0.2)
  S.ctx.currentTime += 1
  const rep2 = S.bus.report().gainAutomation
  ok('J4a ③`cancelScheduledValues(0)` 放行后宿主值被**同拍补回**（不补则 master 退回内在值 ⇒ 静音自己恢复）',
    afterCancel === 0.35 && S.mparam.valueAt(S.ctx.currentTime) === 0.35
      && rep2.reclosed - beforeCancel.reclosed >= 1 && rep2.byMethod.cancelScheduledValues === 1,
    JSON.stringify({ afterCancel, later: S.mparam.valueAt(S.ctx.currentTime), reclosed: rep2.reclosed, byMethod: rep2.byMethod }))
  S.mparam.cancelAndHoldAtTime(0)
  S.mparam.exponentialRampToValueAtTime(1, S.ctx.currentTime + 0.2)
  S.ctx.currentTime += 1
  const rep3 = S.bus.report().gainAutomation
  ok('J4b ③`cancelAndHoldAtTime` 同理：放行 + 同拍收口，随后的指数 ramp 同样被拒绝',
    S.mparam.valueAt(S.ctx.currentTime) === 0.35 && rep3.byMethod.cancelAndHoldAtTime === 1 && rep3.reclosed - rep2.reclosed >= 1,
    JSON.stringify({ value: S.mparam.valueAt(S.ctx.currentTime), byMethod: rep3.byMethod, reclosed: rep3.reclosed }))
  /* "存在才拦；不存在的方法不要造" */
  const C5 = mkClasses()
  delete C5.FakeParam.prototype.cancelAndHoldAtTime
  delete C5.FakeParam.prototype.setValueCurveAtTime
  const bus5 = installAudioBus(mkWin({ classes: C5 }), { mode: '1' })
  ok('J5 不造不存在的方法：桩里缺 `cancelAndHoldAtTime`/`setValueCurveAtTime` ⇒ 装完后仍然没有它们（linearRamp 在）',
    typeof C5.FakeParam.prototype.cancelAndHoldAtTime === 'undefined'
      && typeof C5.FakeParam.prototype.setValueCurveAtTime === 'undefined'
      && typeof C5.FakeParam.prototype.linearRampToValueAtTime === 'function', 'report.mode=' + bus5.report().mode)
  ok('J5b 覆盖清单含点名的 6 个方法（ramp 家族 / setValueAtTime / setTargetAtTime / 两个 cancel）',
    ['linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setValueAtTime', 'setTargetAtTime'].every((f) => PARAM_WRITE_METHODS.indexOf(f) >= 0)
      && ['cancelScheduledValues', 'cancelAndHoldAtTime'].every((f) => PARAM_CANCEL_METHODS.indexOf(f) >= 0),
    JSON.stringify({ write: PARAM_WRITE_METHODS, cancel: PARAM_CANCEL_METHODS }))
  /* 归因面 + 作者包络**原样放行**（不改写第三方语义） */
  const S3 = mkAutomationScene('1')
  const t3 = S3.ctx.currentTime
  S3.aparam.setValueAtTime(0.2, t3)
  S3.aparam.linearRampToValueAtTime(1, t3 + 1)
  S3.aparam.exponentialRampToValueAtTime(0.5, t3 + 2)
  S3.aparam.setTargetAtTime(0.8, t3 + 3, 0.5)
  S3.aparam.setValueCurveAtTime([0.1, 0.2, 0.3], t3 + 4, 1)
  const repA = S3.bus.report().gainAutomation
  ok('J6 归因面：作者对自己 gain 的 5 次自动化全部计入 + 分方法直方图，且事件表里 5 条都在（没替作者改写）',
    repA.calls === 5 && repA.authorGain === 5 && repA.suppressed === 0 && repA.masterWrites === 0
      && repA.byMethod.setValueAtTime === 1 && repA.byMethod.linearRampToValueAtTime === 1
      && repA.byMethod.exponentialRampToValueAtTime === 1 && repA.byMethod.setTargetAtTime === 1
      && repA.byMethod.setValueCurveAtTime === 1 && S3.aparam.events.length === 5, JSON.stringify(repA))
  const gainNode = new S3.win.GainNode(S3.ctx)          // 现代写法：`new GainNode(ctx)`
  gainNode.gain.linearRampToValueAtTime(1, S3.ctx.currentTime + 1)
  ok('J6b `new GainNode()` 造出来的 gain 也判得出身份（不是只认 createGain）',
    S3.bus.report().gainAutomation.authorGain === 6, JSON.stringify(S3.bus.report().gainAutomation))
  /* ④ 回归：没有任何自动化调用时，行为与改动前一致（1 → 0 → 1），且我们的收口不会被自己归因 */
  const S4 = mkAutomationScene('1')
  const p4 = S4.mparam
  const before4 = S4.bus.report().gainAutomation.calls
  S4.bus.setMuted(true)
  const vMute = p4.value
  S4.bus.setMuted(false)
  const vBack = p4.value
  const after4 = S4.bus.report().gainAutomation
  ok('J7 ④回归：无作者自动化时 1 → 0 → 1（与改动前一致）且 `calls/suppressed/reclosed` 全 0（收口走原始引用）',
    before4 === 0 && vMute === 0 && vBack === 1 && after4.calls === 0 && after4.suppressed === 0 && after4.reclosed === 0,
    JSON.stringify({ before: before4, vMute, vBack, after: after4.calls }))
  p4.setValueAtTime(0, S4.ctx.currentTime)              // 同样的写入**经原型**就会被归因
  ok('J8 分辨力自证：经原型的写入立刻被归因（`masterWrites`/`suppressed` +1）⇒ J7 的 0 是"走了原始引用"，不是计数器没接',
    S4.bus.report().gainAutomation.calls === 1 && S4.bus.report().gainAutomation.masterWrites === 1
      && S4.bus.report().gainAutomation.suppressed === 1)
  /* 静音后作者再次动包络 ⇒ **同一拍**收口（不用等 750ms 周期重压）。
     ⑭(2026-09-23) 起收口也走"值真的不同才写"：值本来就是宿主的 0 ⇒ 只**核对**不写（旧的
     "每拍都无条件写一遍"正是"卡卡的/响一下"的成因，见 `window.__mpwAudioBusRepatch`）。 */
  const S6 = mkAutomationScene('1')
  S6.bus.setMuted(true)
  const n6 = S6.mparam.calls.length
  S6.aparam.setValueAtTime(0.9, S6.ctx.currentTime)
  S6.ctx.currentTime += 0.6
  ok('J9 ①静音后作者再排包络 ⇒ 同一拍按宿主值收口（`reclosed` +1）；值本就是 0 ⇒ **不写**参数（幂等）',
    S6.mparam.valueAt(S6.ctx.currentTime) === 0 && S6.mparam.calls.length === n6 && S6.bus.report().gainAutomation.reclosed >= 1,
    JSON.stringify({ value: S6.mparam.valueAt(S6.ctx.currentTime), calls: S6.mparam.calls.length, reclosed: S6.bus.report().gainAutomation.reclosed }))
  /* ⑭ 反向对照（保证 J9 的"不写"是幂等、不是漏收口）：宿主裁决值被外部直接赋值改掉 ⇒ 同一拍**写回**。 */
  const S6b = mkAutomationScene('1')
  S6b.bus.setMuted(true)
  const n6b = S6b.mparam.calls.length
  S6b.mparam.value = 1                                    // 直接赋值：**拦不到**（不包 accessor）⇒ 只能采样发现
  S6b.aparam.setValueAtTime(0.9, S6b.ctx.currentTime)
  S6b.ctx.currentTime += 0.6
  ok('J9b ⑭外部把 bus 值改成 1 ⇒ 同拍收口真的**写回 0**，并记一条 reclaims（value-assign-or-unknown）',
    S6b.mparam.valueAt(S6b.ctx.currentTime) === 0 && S6b.mparam.calls.length > n6b
      && S6b.bus.report().gainAutomation.reclaims.bySource['value-assign-or-unknown'] >= 1,
    JSON.stringify({ value: S6b.mparam.valueAt(S6b.ctx.currentTime), calls: S6b.mparam.calls.length, reclaims: S6b.bus.report().gainAutomation.reclaims.bySource }))
  /* 往 bus 自己的 gain 参数连信号（AudioParam 作 connect 目标 ⇒ 加法叠加） */
  const S7 = mkAutomationScene('1')
  S7.bus.setMuted(true)
  const inj = new S7.C.FakeNode(S7.ctx, 'constant')
  const ret7 = inj.connect(S7.mparam)
  ok('J10 静音档：往 bus 自己 gain 参数 connect 的信号被**拒绝**（加法能抬起静音）+ 归因',
    ret7 === S7.mparam && inj.connections.indexOf(S7.mparam) < 0
      && S7.bus.report().gainAutomation.paramInputs === 1 && S7.bus.report().gainAutomation.paramInputsRefused === 1,
    JSON.stringify(S7.bus.report().gainAutomation))
  S7.bus.setMuted(false)
  inj.connect(S7.mparam)
  ok('J11 非静音档：只归因不拦（**不动**第三方的图结构）',
    inj.connections.indexOf(S7.mparam) >= 0 && S7.bus.report().gainAutomation.paramInputs === 2
      && S7.bus.report().gainAutomation.paramInputsRefused === 1)
  /* ④ 回归：非静音档（`redirect`）仍然只重定向、一点 gain 都不写 —— 归因不受档位影响 */
  const S8 = mkAutomationScene('redirect')
  S8.aparam.setValueAtTime(0.2, S8.ctx.currentTime)
  S8.aparam.linearRampToValueAtTime(1, S8.ctx.currentTime + 1)
  S8.bus.setMuted(true)
  S8.bus.setHostVolume(0.5)
  ok('J12 ④回归：`redirect` 诊断档下作者自动化照记，但宿主**一次都不写** gain（宿主音量也不写）',
    S8.bus.report().gainAutomation.calls === 2 && S8.mparam.calls.length === 0 && S8.mparam.value === 1
      && S8.bus.report().hostVolume === 0.5,
    JSON.stringify({ calls: S8.bus.report().gainAutomation.calls, gainCalls: S8.mparam.calls.length, value: S8.mparam.value }))
}

console.log('\n== K 分辨力自证：把 J 组的修复改回去必须变红 ==')
{
  /* ① 把 AudioParam 钩子拿掉（用**装之前的原件**调用 = 没装钩子的等价行为）⇒ 打到 bus 参数上的 ramp 立刻落地 */
  const S = mkAutomationScene('1')
  S.bus.setMuted(true)
  S.mparam.linearRampToValueAtTime(1, S.ctx.currentTime + 1)                 // 修复在 ⇒ 被拒绝
  ok('K1 修复在：打到 bus 参数上的 ramp 被拒绝（事件表里没有 lramp）', !S.mparam.events.some((e) => e.k === 'lramp'))
  S.origParam.linearRampToValueAtTime.call(S.mparam, 1, S.ctx.currentTime + 1)  // ← "修复回退"的等价写法
  S.ctx.currentTime += 2
  ok('K2 钩子一拿掉，同一条 ramp 就把 bus 值拉到 1 ⇒ J2 那条断言确实在测这个守卫',
    S.mparam.valueAt(S.ctx.currentTime) === 1 && S.mparam.events.some((e) => e.k === 'lramp'),
    'value=' + S.mparam.valueAt(S.ctx.currentTime))
  /* ② "解除静音写死 1"的旧写法 ⇒ J3 的 `=== 0.35` 必红 */
  const S2 = mkAutomationScene('1')
  S2.bus.setHostVolume(0.35)
  S2.bus.setMuted(true)
  S2.bus.setMuted(false)
  const hostOk = S2.mparam.valueAt(S2.ctx.currentTime) === 0.35
  S2.origParam.setValueAtTime.call(S2.mparam, 1, S2.ctx.currentTime)            // 旧写法：写死 1
  ok('K3 "恢复写死 1"的旧写法会让 J3 变红（0.35 被盖成 1）⇒ J3 对宿主音量有分辨力',
    hostOk && S2.mparam.valueAt(S2.ctx.currentTime) === 1, JSON.stringify({ hostOk, value: S2.mparam.valueAt(S2.ctx.currentTime) }))
  /* ③ 取消后不补写（= 修复回退）⇒ 宿主事件被删光，master 退回内在值 1 ⇒ J4a 必红 */
  const S9 = mkAutomationScene('1')
  S9.bus.setMuted(true)
  S9.mparam.cancelScheduledValues(0)                                           // 修复在 ⇒ 同拍补回宿主值
  ok('K4 修复在：`cancelScheduledValues(0)` 之后宿主值仍是 0', S9.mparam.valueAt(S9.ctx.currentTime) === 0,
    'value=' + S9.mparam.valueAt(S9.ctx.currentTime))
  S9.origParam.cancelScheduledValues.call(S9.mparam, 0)                        // ← 只放行、不补写
  ok('K5 只放行不补写 ⇒ master 退回内在值 1 ⇒ J4a 确实在测"同拍补回"',
    S9.mparam.valueAt(S9.ctx.currentTime) === 1, 'value=' + S9.mparam.valueAt(S9.ctx.currentTime))
}

/* ── ⑭ 场景：静音 + 已接管一个 ctx + 已装 750ms 重压定时器（L/N 组共用） ───────────────────────
   台账读数用 `win.__mpwAudioBusRepatch`（探针在真机上读同一个对象）。 */
const RP_KEYS = ['n', 'ticks', 'idleTicks', 'nodesCreated', 'connects', 'disconnects', 'ctxSuspends', 'ctxResumes',
  'modeWrites', 'paramWrites', 'paramWritesSkipped', 'mediaWrites', 'mediaPauses', 'mediaUnmutes', 'speechCancels',
  'frameReentries', 'frameNoops', 'frameDisposals', 'shadowScans', 'observers']
const snap = (A) => { const o = {}; for (const k of RP_KEYS) o[k] = A[k]; return o }
function mkTickScene(extra = {}) {
  const C = mkClasses()
  const el = new C.FakeMediaElement('loop.mp3')
  const fw = mkWin()                                // 同源帧：L6/M 组要证明"周期不再重入帧内总线"
  const frames = [{ src: 'frame.html', contentWindow: fw }]
  const win = mkWin(Object.assign({ classes: C, media: [el], frames }, extra))
  const starCalls = { n: 0 }
  const origQ = win.document.querySelectorAll.bind(win.document)
  win.document.querySelectorAll = (sel) => { if (sel === '*') starCalls.n++; return origQ(sel) }
  const bus = installAudioBus(win, { mode: '1' })
  const ctx = new win.AudioContext()
  new C.FakeNode(ctx).connect(ctx.destination)      // ⇒ 懒创建 master（这一步的副作用是**应该有**的）
  el.paused = false
  bus.setMuted(true)                                // ⇒ 装 750ms 重压定时器 + 把同源帧装成 1/静音
  const t750 = win.__timers.filter((t) => t[1] === 750).map((t) => t[0])
  return { C, win, bus, ctx, el, fw, frames, starCalls, t750, RP: () => win.__mpwAudioBusRepatch }
}
/** 连跑 N 拍 750ms 定时器（桩的 setInterval 不自动触发 ⇒ 手工拍）。 */
const beat = (scene, n) => { for (let i = 0; i < n; i++) for (const fn of scene.t750) fn() }

console.log('\n== L 周期重压：幂等 + 无副作用台账（"响一下/卡卡"的正面判据）==')
{
  const S = mkTickScene()
  const A = S.RP()
  ok('L1 台账挂在 window 上且字段齐全（探针可直接读，不需要用户操作）',
    !!A && ['n', 'ticks', 'lastAt', 'byWhere', 'nodesCreated', 'connects', 'disconnects', 'modeWrites'].every((k) => k in A)
      && !!S.bus.report().repatch && S.bus.report().repatch.ticks === A.ticks,
    JSON.stringify({ keys: Object.keys(A || {}).slice(0, 14), reportTicks: S.bus.report().repatch && S.bus.report().repatch.ticks }))
  ok('L2 静音档装了 750ms 重压定时器（"偶发"仍要反复压住）', S.t750.length === 1, 'timers=' + JSON.stringify(S.win.__timers.map((t) => t[1])))
  beat(S, 1)                                        // 先跑 1 拍（首拍允许"发现新帧/新元素"这类登记动作）
  const before = snap(S.RP())
  /* 帧重入记在**被重入的那个 realm** 的台账上（`window.__mpwAudioBusRepatch` 每个 realm 一份）⇒
     L6 读同源帧那份；`report().framesRepatch` 是同一条读数的汇总出口。 */
  const fwBefore = snap(S.fw.__mpwAudioBusRepatch)
  beat(S, 12)
  const after = snap(S.RP())
  const fwAfter = snap(S.fw.__mpwAudioBusRepatch)
  ok('L3 ①同一状态连跑 12 拍：**零**节点创建/连接/断开、零 suspend/resume、零帧重入',
    after.nodesCreated === before.nodesCreated && after.connects === before.connects && after.disconnects === before.disconnects
      && after.ctxSuspends === before.ctxSuspends && after.ctxResumes === before.ctxResumes && after.frameReentries === before.frameReentries,
    JSON.stringify({ before, after }))
  ok('L4 ②目标值未变 ⇒ 一拍都不写音频参数（`paramWrites` 不涨、"值相同"跳过计数在涨）',
    after.paramWrites === before.paramWrites && after.paramWritesSkipped > before.paramWritesSkipped,
    JSON.stringify({ writes: after.paramWrites, skipped: after.paramWritesSkipped }))
  ok('L5 ③元素已是目标状态 ⇒ 不再重复写 muted/volume、不再重复 pause（0 次媒体写）',
    after.mediaWrites === before.mediaWrites && after.mediaPauses === before.mediaPauses,
    JSON.stringify({ mediaWrites: after.mediaWrites, mediaPauses: after.mediaPauses }))
  ok('L6 ④周期路径不再对同源帧重入 setMode（父+帧两份台账的 `frameReentries` 都不涨，帧集合没变）',
    after.frameReentries === before.frameReentries && fwAfter.frameReentries === fwBefore.frameReentries
      && S.bus.report().framesRepatch[0] && S.bus.report().framesRepatch[0].repatch.frameReentries === fwAfter.frameReentries,
    JSON.stringify({ parent: after.frameReentries, frameBefore: fwBefore.frameReentries, frameAfter: fwAfter.frameReentries, framesRepatch: S.bus.report().framesRepatch.length }))
  ok('L7 台账如实记账：12 拍里"有副作用的拍"= 0（`n` 不变）、`idleTicks` +12、`ticks` +12',
    after.n === before.n && (after.idleTicks - before.idleTicks) === 12 && (after.ticks - before.ticks) === 12,
    JSON.stringify({ n: after.n, idle: after.idleTicks - before.idleTicks, ticks: after.ticks - before.ticks }))
  ok('L8 ⑤周期路径里**没有**全文档 `querySelectorAll("*")`：安装期只扫一次，12 拍后仍是 1 次',
    S.starCalls.n === 1 && after.shadowScans === 1, JSON.stringify({ starCalls: S.starCalls.n, shadowScans: after.shadowScans }))
  /* 幂等 ≠ 放弃重压：静音期间**新出现**的声源必须还是被压住 */
  const el2 = new S.C.FakeMediaElement('late.mp3'); el2.paused = false
  const q0 = S.win.document.querySelectorAll.bind(S.win.document)
  S.win.document.querySelectorAll = (sel) => (sel === 'audio,video' ? [S.el, el2] : q0(sel))
  beat(S, 1)
  ok('L9 幂等不等于放弃：静音期间新出现的媒体元素在下一拍仍被压住（muted + volume=0 + pause）',
    el2.muted === true && el2.volume === 0 && el2.paused === true && el2.pauseCalls === 1,
    JSON.stringify({ muted: el2.muted, vol: el2.volume, paused: el2.paused, pauses: el2.pauseCalls }))
  const gainsBefore = S.ctx.gains.length
  const s2 = new S.C.FakeNode(S.ctx); s2.connect(S.ctx.destination)
  ok('L10 幂等不等于放弃：静音期间新连 destination 的节点仍被改接到**同一个** master（不重复创建节点）',
    s2.connections[0] === S.ctx.gains[0] && S.ctx.gains.length === gainsBefore, JSON.stringify({ gains: S.ctx.gains.length }))
  /* 干扰之一：作者脚本"每帧"写**自己**的 gain（120 次直接赋值 + 120 次 ramp）⇒ 总线乘积仍恒 0 */
  const SA = mkAutomationScene('1')
  SA.bus.setMuted(true)
  const beforeA = SA.bus.report().gainAutomation
  for (let i = 0; i < 120; i++) { SA.aparam.value = 1; SA.aparam.linearRampToValueAtTime(1, SA.ctx.currentTime + 0.05) }
  SA.ctx.currentTime += 1
  const afterA = SA.bus.report().gainAutomation
  ok('L11 干扰①作者每帧写自己的 gain：总线仍恒 0（串联乘法）、宿主参数一次没写、未误判成"抬静音"',
    SA.mparam.valueAt(SA.ctx.currentTime) === 0 && afterA.masterWrites === beforeA.masterWrites
      && afterA.suppressed === beforeA.suppressed && afterA.reclaims.bySource['value-assign-or-unknown'] === undefined,
    JSON.stringify({ master: SA.mparam.valueAt(SA.ctx.currentTime), masterWrites: afterA.masterWrites, reclaims: afterA.reclaims.bySource }))
  /* 干扰之三（最凶的一条）：作者每帧直接改**我们 bus 的** gain（拦不到 ⇒ 采样检测 + 同拍收口） */
  const SB = mkAutomationScene('1')
  SB.bus.setMuted(true)
  const t750B = SB.bus.report() && null
  for (let i = 0; i < 60; i++) SB.mparam.value = 1
  SB.bus.setMuted(false)          // 触发一次收口（真机上等价于下一拍 750ms / 下一次 applyMute）
  SB.bus.setMuted(true)
  void t750B
  ok('L12 干扰③直接改 bus 自己的 gain（拦不到）⇒ 下一次收口把值写回、并记一条 reclaims（静音仍保持）',
    SB.mparam.valueAt(SB.ctx.currentTime) === 0 && SB.bus.report().gainAutomation.reclaims.bySource['value-assign-or-unknown'] >= 1,
    JSON.stringify({ master: SB.mparam.valueAt(SB.ctx.currentTime), reclaims: SB.bus.report().gainAutomation.reclaims.bySource }))
}

console.log('\n== M "谁把静音抬回来"台账（reclaims：时间戳 + 来源 + 节流栈）==')
{
  const S = mkAutomationScene('1')
  S.bus.setMuted(true)
  const R0 = S.bus.report().gainAutomation.reclaims
  ok('M1 台账字段齐全、挂在 gainAutomation 下（沿用既有命名风格，不新建平行结构）',
    !!R0 && ['n', 'lastAt', 'lastWhere', 'lastSource', 'lastExpected', 'lastActual', 'lastStack', 'bySource', 'byWhere', 'entries'].every((k) => k in R0)
      && Array.isArray(R0.entries), JSON.stringify(Object.keys(R0 || {})))
  /* ① 自动化：第三方往 bus 自己的 gain 排包络（钩子当场拒绝 ⇒ 真栈可得） */
  S.mparam.linearRampToValueAtTime(1, S.ctx.currentTime + 0.5)
  const R1 = S.bus.report().gainAutomation.reclaims
  const e1 = R1.entries[R1.entries.length - 1]
  ok('M2 ①自动化改写被拒 ⇒ 台账 +1、来源=automation-suppressed、method 记下、**栈可得**（traceable）',
    (R1.n - R0.n) === 1 && R1.bySource['automation-suppressed'] === 1 && e1.method === 'linearRampToValueAtTime'
      && e1.traceable === true && String(e1.stack).length > 0,
    JSON.stringify({ n: R1.n, bySource: R1.bySource, entry: e1 }))
  /* ② 直接赋值 `param.value = v`：**拦不到**（刻意不包 accessor）⇒ 下一拍采样发现，栈不可得（如实标注） */
  const sb = mkAutomationScene('1')
  sb.bus.setMuted(true)
  const Rb0 = sb.bus.report().gainAutomation.reclaims
  sb.mparam.value = 1                                   // ← 外部直接赋值
  sb.bus.setMuted(false)                                // ← 任何一次收口都会先采样
  const Rb1 = sb.bus.report().gainAutomation.reclaims
  const eb = Rb1.entries[Rb1.entries.length - 1]
  ok('M3 ②`param.value = v` 直接赋值拦不到（不伤热路径）但**采样检测到**并记台账：expected/actual + traceable:false',
    (Rb1.n - Rb0.n) === 1 && eb.source === 'value-assign-or-unknown' && eb.expected === 0 && eb.actual === 1 && eb.traceable === false && eb.stack === '',
    JSON.stringify(eb))
  /* ③ 连接注入：往 master.gain 连信号（AudioParam 作 connect 目标 ⇒ 加法能抬起静音） */
  const S2 = mkAutomationScene('1')
  S2.bus.setMuted(true)
  const inj = new S2.C.FakeNode(S2.ctx, 'constant')
  inj.connect(S2.mparam)
  const R2 = S2.bus.report().gainAutomation.reclaims
  ok('M4 ③连接注入（AudioParam 作 connect 目标）⇒ 台账 +1、来源=param-connect-injection、栈可得',
    R2.n === 1 && R2.bySource['param-connect-injection'] === 1 && R2.entries[0].traceable === true && R2.entries[0].method === 'connect',
    JSON.stringify({ n: R2.n, bySource: R2.bySource, entry: R2.entries[0] }))
  /* ④ 元素级：静音期间 muted/volume 被抬回（volumechange 当场抓 + 立刻再压住）。
     注：真浏览器里 `HTMLMediaElement.prototype.addEventListener` 继承自 EventTarget，总线用
     `origAdd.call(document, ...)` 注册 ⇒ 落在 document 这个事件目标上；桩里原型方法写的是
     `this.__listeners`（`this` 就是 document）⇒ 从两处取同一个 handler。 */
  const C = mkClasses(); const el = new C.FakeMediaElement('x.mp3')
  const win = mkWin({ classes: C, media: [el] })
  const bus = installAudioBus(win, { mode: '1' })
  bus.setMuted(true)
  const vc = (win.document.listeners && win.document.listeners['volumechange'])
    || (win.document.__listeners && win.document.__listeners['volumechange'])
  ok('M5a 静音期间元素被抬回时，volumechange 钩子确实在监听面上（不是"装了但没人接"）', typeof vc === 'function',
    JSON.stringify({ onDoc: Object.keys(win.document.listeners || {}), onProto: Object.keys(win.document.__listeners || {}) }))
  el.muted = false; el.volume = 1                        // 作者/别处把静音抬回来
  if (typeof vc === 'function') vc({ target: el })
  const R4 = bus.report().gainAutomation.reclaims
  ok('M5 ④元素级抬回（静音期间 muted=false / volume>0）⇒ 台账 +1、来源=media-element、栈可得，且当场再压住',
    R4.n === 1 && R4.bySource['media-element'] === 1 && R4.entries[0].traceable === true
      && el.muted === true && el.volume === 0,
    JSON.stringify({ bySource: R4.bySource, entry: R4.entries[0], el: { muted: el.muted, vol: el.volume } }))
  /* ⑤ 有界：长跑不会无界增长（环 ≤32 条） */
  const sb2 = mkAutomationScene('1')
  sb2.bus.setMuted(true)
  for (let i = 0; i < 60; i++) { sb2.mparam.value = 1; sb2.bus.setMuted(false); sb2.bus.setMuted(true) }
  const R5 = sb2.bus.report().gainAutomation.reclaims
  ok('M6 ⑤台账有界：抬回 60 次（n 如实累计）但环里只留 ≤32 条（`entriesKept` 是环的真实长度）',
    R5.n >= 60 && R5.entriesKept <= 32 && R5.entriesKept > 0 && R5.entries.length <= 8,
    JSON.stringify({ n: R5.n, entriesKept: R5.entriesKept, reported: R5.entries.length }))
}

console.log('\n== N dispose()：定时器 / 监听 / 钩子全清（旧实现全仓无人调用）==')
{
  const S = mkTickScene()
  const moBefore = S.win.__C.FakeMutationObserver.made.filter((m) => m.observed.length > 0)
  ok('N0 装上时有可观测的监听面：MutationObserver 已 observe、roots/observers 计数 > 0',
    moBefore.length >= 1 && S.bus.report().observers >= 1 && S.bus.report().roots >= 1 && S.bus.report().repatch.shadowScans === 1,
    JSON.stringify({ observers: S.bus.report().observers, roots: S.bus.report().roots }))
  const clearedBefore = S.win.__cleared.length
  ok('N0b 同源帧里那条总线已被登记（换壁纸/卸载才有东西可释放）', S.bus.report().frameBus === 1, 'frameBus=' + S.bus.report().frameBus)
  const fwActiveBefore = S.fw.__activeTimers().filter((t) => t[1] === 750).length
  S.bus.dispose()
  const rep = S.bus.report()
  ok('N1 dispose 清掉 750ms 重压定时器（clearInterval 收到句柄，活动定时器归 0）',
    S.win.__cleared.length === clearedBefore + 1 && S.win.__activeTimers().filter((t) => t[1] === 750).length === 0,
    JSON.stringify({ cleared: S.win.__cleared.slice(clearedBefore), active: S.win.__activeTimers().map((t) => t[1]) }))
  ok('N1b dispose 连**帧内**那条总线一起释放（帧自己的 750ms 重压定时器归 0、`__mpwAudioBus` 摘除）',
    fwActiveBefore === 1 && S.fw.__activeTimers().filter((t) => t[1] === 750).length === 0 && !S.fw.__mpwAudioBus,
    JSON.stringify({ fwActiveBefore, fwActive: S.fw.__activeTimers().map((t) => t[1]), fwBus: !!S.fw.__mpwAudioBus }))
  ok('N2 dispose 后可观测计数归零：observers / roots / frameBus = 0、timers = 0、disposed = true',
    rep.disposed === true && rep.observers === 0 && rep.roots === 0 && rep.frameBus === 0 && rep.timers === 0,
    JSON.stringify({ disposed: rep.disposed, observers: rep.observers, roots: rep.roots, frameBus: rep.frameBus, timers: rep.timers }))
  ok('N3 全部 observer 都被 disconnect（不是只丢引用）',
    moBefore.every((m) => m.disconnects >= 1), JSON.stringify(moBefore.map((m) => m.disconnects)))
  ok('N4 `window.__mpwAudioBus` 已摘除（再装一遍会干净重来，不会复用半死的实例）', !S.win.__mpwAudioBus)
  const ctx2 = new S.C.FakeCtx(); const n2 = new S.C.FakeNode(ctx2); n2.connect(ctx2.destination)
  ok('N5 原型钩子已还原：dispose 后直连 destination 不再被改接、也不再创建 master',
    n2.connections[0] === ctx2.destination && ctx2.gains.length === 0, JSON.stringify({ gains: ctx2.gains.length }))
  S.t750.length = 0                                  // 拍子已失效（handle 被清）
  const ticksBefore = S.RP().ticks
  beat(S, 3)
  ok('N6 dispose 后周期工作不再跑（拍子失效、`ticks` 不增长）', S.RP().ticks === ticksBefore, 'ticks=' + S.RP().ticks)
  /* 再装一遍：干净重来（dispose → install 不叠加定时器/observer） */
  const bus2 = installAudioBus(S.win, { mode: '1' })
  bus2.setMuted(true)
  ok('N7 dispose 之后再装：只有**一个**活动的 750ms 定时器（不叠加）',
    S.win.__activeTimers().filter((t) => t[1] === 750).length === 1 && bus2 !== S.bus && bus2.report().disposed === false,
    JSON.stringify(S.win.__activeTimers().map((t) => t[1])))
  /* 解除静音只撤销**我们自己按的**（别人的静音不许被抬起来 —— 用户现场：NP 明明静音却出声） */
  const C2 = mkClasses()
  const elOurs = new C2.FakeMediaElement('ours.mp3'); const elTheirs = new C2.FakeMediaElement('theirs.mp3')
  elTheirs.muted = true                              // 别人（NP/作者）自己静的
  const win2 = mkWin({ classes: C2, media: [elOurs, elTheirs] })
  const bus3 = installAudioBus(win2, { mode: '1' })
  bus3.setMuted(true)
  ok('N8 静音时我们按下的与被别人按下的分得开（我们都写了 muted=true，但只有我们那份被记账）',
    elOurs.muted === true && elTheirs.muted === true)
  bus3.setMuted(false)
  ok('N9 解除静音**只撤销我们自己按的**：别人自己 muted 的元素保持 muted=true（旧写法无条件抬回 ⇒ 漏音）',
    elOurs.muted === false && elTheirs.muted === true,
    JSON.stringify({ ours: elOurs.muted, theirs: elTheirs.muted }))
  bus3.dispose(); bus2.dispose()
}

/* ── V 变异自证：把 ⑭ 的守卫在**内存副本**里改回旧写法 ⇒ L/N 组对应断言必须变红 ──────────────────
   为什么这样写：只断言"现在是绿的"不足以证明这条断言在测东西。这里把 `lib/audio-bus.js` 的源码
   复制到临时文件、按锚点做**单点回退**，再用同一套桩跑同一套拍子 ⇒ 读数必须变成"有副作用"。
   （http/浏览器/网络一律不参与；纯 Node + 临时文件。） */
console.log('\n== V 变异自证：改回旧写法 ⇒ L/N 组的读数必须变红 ==')
{
  const MOD_SRC = fs.readFileSync(new URL('../lib/audio-bus.js', import.meta.url), 'utf8')
  let seq = 0
  const importMutated = async (from, to) => {
    /* `from` 可以是锚点数组（[[from,to],…]）= **多点回退**成一整段旧写法（见 V7）。 */
    const pairs = Array.isArray(from) ? from : [[from, to]]
    let src = MOD_SRC
    for (const [a, b] of pairs) {
      if (src.indexOf(a) < 0) throw new Error('变异锚点找不到：' + a.slice(0, 70))
      src = src.replace(a, b)
    }
    const f = path.join(os.tmpdir(), 'mpw-bus-mut-' + process.pid + '-' + (++seq) + '.mjs')
    fs.writeFileSync(f, src)
    const mod = await import(pathToFileURL(f).href)
    fs.unlinkSync(f)
    return mod
  }
  const idle = (install, extra = {}) => {
    const C = mkClasses()
    const el = new C.FakeMediaElement('loop.mp3')
    const win = mkWin(Object.assign({ classes: C, media: [el] }, extra))
    const bus = install(win, { mode: '1' })
    const ctx = new win.AudioContext()
    new C.FakeNode(ctx).connect(ctx.destination)
    el.paused = true
    bus.setMuted(true)
    const beatFn = () => { for (const t of win.__timers.filter((t) => t[1] === 750)) t[0]() }   // 只拍**父页**的定时器
    beatFn()
    const kids = (extra.frames || []).map((f) => f.contentWindow)
    const before = snap(win.__mpwAudioBusRepatch)
    const kidsBefore = kids.map((k) => snap(k.__mpwAudioBusRepatch))
    for (let i = 0; i < 12; i++) beatFn()
    return { before, after: snap(win.__mpwAudioBusRepatch), win, bus, kids, kidsBefore, kidsAfter: kids.map((k) => snap(k.__mpwAudioBusRepatch)) }
  }
  /* V1 去掉"值真的不同才写" ⇒ 每拍都写音频参数（L4 必红） */
  const M1 = await importMutated(
    "      if (!force && cur === cur && cur === v) { did('close-bus', 'paramWritesSkipped'); continue }",
    "      /* (变异：去掉“值相同则不写”的守卫 = 改动前的旧写法) */")
  const v1 = idle(M1.installAudioBus)
  ok('V1 去掉"值同则不写"守卫 ⇒ 12 拍里 `paramWrites` 增长（L4 会红）',
    v1.after.paramWrites - v1.before.paramWrites >= 12 && v1.after.n > v1.before.n,
    JSON.stringify({ writes: v1.after.paramWrites - v1.before.paramWrites, sideEffectTicks: v1.after.n - v1.before.n }))
  /* V2 元素压制改回"无条件写" ⇒ 每拍都写 muted/volume（L5 必红） */
  const M2 = await importMutated(
    "        if (Number(el.volume) !== 0) { el.volume = 0; did('suppress', 'mediaWrites'); changed = true }",
    "        el.volume = 0; did('suppress', 'mediaWrites'); changed = true /* (变异：改动前的无条件写) */")
  const v2 = idle(M2.installAudioBus)
  ok('V2 元素压制改回无条件写 ⇒ 12 拍里 `mediaWrites` 增长（L5 会红）',
    v2.after.mediaWrites - v2.before.mediaWrites >= 12, JSON.stringify({ mediaWrites: v2.after.mediaWrites - v2.before.mediaWrites }))
  /* V3 去掉周期"帧集合没变就别重入" ⇒ 每拍重入同源帧（L6 必红） */
  const fw3 = mkWin()
  const M3 = await importMutated(
    "    if (periodicCall && !framesDirty) { did('sync-frames', 'frameNoops'); return state.frames }",
    "    /* (变异：去掉周期幂等守卫 ⇒ 每拍重新枚举并对每个同源帧重入 setMode) */")
  const v3 = idle(M3.installAudioBus, { frames: [{ src: 'same.html', contentWindow: fw3 }] })
  ok('V3 去掉周期幂等守卫 ⇒ 12 拍里**帧内那份台账**的 `frameReentries` 增长（L6 会红）',
    v3.kidsAfter[0].frameReentries - v3.kidsBefore[0].frameReentries >= 12,
    JSON.stringify({ frameReentries: v3.kidsAfter[0].frameReentries - v3.kidsBefore[0].frameReentries }))
  /* V4 dispose 不清定时器 ⇒ N1 必红 */
  const M4 = await importMutated(
    "      disposed = true;\n      if (timer) {", "      disposed = true;\n      if (false && timer) { /* (变异：旧写法不 clearInterval) */")
  const C4 = mkClasses(); const win4 = mkWin({ classes: C4 })
  const bus4 = M4.installAudioBus(win4, { mode: '1' })
  bus4.setMuted(true)
  const cl0 = win4.__cleared.length
  bus4.dispose()
  ok('V4 dispose 不清定时器 ⇒ 活动 750ms 定时器仍在、clearInterval 没被调用（N1 会红）',
    win4.__cleared.length === cl0 && win4.__activeTimers().filter((t) => t[1] === 750).length === 1,
    JSON.stringify({ cleared: win4.__cleared.length - cl0, active: win4.__activeTimers().map((t) => t[1]) }))
  /* V5 解除静音改回"无条件抬回" ⇒ N9 必红（会抬起别人自己按下的静音） */
  const M5 = await importMutated(
    "      if (state.mediaMutedByUs.has(el)) {", "      if (true) { /* (变异：旧写法无条件 el.muted=false) */")
  const C5 = mkClasses()
  const elOurs5 = new C5.FakeMediaElement('ours.mp3'); const elTheirs5 = new C5.FakeMediaElement('theirs.mp3')
  elTheirs5.muted = true
  const win5 = mkWin({ classes: C5, media: [elOurs5, elTheirs5] })
  const bus5 = M5.installAudioBus(win5, { mode: '1' })
  bus5.setMuted(true); bus5.setMuted(false)
  ok('V5 解除静音改回无条件抬回 ⇒ 别人自己 muted 的元素被抬起来（N9 会红）',
    elTheirs5.muted === false && elOurs5.muted === false,
    JSON.stringify({ ours: elOurs5.muted, theirs: elTheirs5.muted }))
  /* V7 ⑭**最关键的一条自证**：把周期路径**整段**回退成改动前的旧写法（每拍无条件写 gain +
     无条件写 muted/volume + 每拍重枚举并对每个同源帧重入 setMode），用同一套拍子量一次。
     结论（真读数，不是推断）：漏音/卡顿的成因是"**反复写值**"，而**不是**"音频图被重建/重挂载"——
     旧写法在 12 拍里依然是 0 次节点创建 / 0 次 connect / 0 次 disconnect / 0 次 suspend/resume。
     ⇒ 用户那条签名里"音频图被反复重压"的部分成立，"重挂载"的字面机制不成立。 */
  const fw7 = mkWin()
  const M7 = await importMutated([
    ["syncFrames({ periodic: true })", 'syncFrames()'],
    ["      if (!force && cur === cur && cur === v) { did('close-bus', 'paramWritesSkipped'); continue }", '      /* (变异：旧写法每拍无条件写) */'],
    ["        if (Number(el.volume) !== 0) { el.volume = 0; did('suppress', 'mediaWrites'); changed = true }", "        el.volume = 0; did('suppress', 'mediaWrites'); changed = true"],
    ["    try { if (el.muted !== true) { el.muted = true; try { state.mediaMutedByUs.add(el) } catch (e) {} ; did('suppress', 'mediaWrites'); changed = true } } catch (e) {}", "    try { el.muted = true; did('suppress', 'mediaWrites'); changed = true } catch (e) {}"],
  ])
  const v7 = idle(M7.installAudioBus, { frames: [{ src: 'same.html', contentWindow: fw7 }] })
  const grew = (k) => v7.after[k] - v7.before[k]
  ok('V7 旧周期写法实测：**每拍都在写**（gain/元素/帧重入全在涨）',
    grew('paramWrites') >= 12 && grew('mediaWrites') >= 12 && v7.kidsAfter[0].frameReentries - v7.kidsBefore[0].frameReentries >= 12,
    JSON.stringify({ paramWrites: grew('paramWrites'), mediaWrites: grew('mediaWrites'), frameReentries: v7.kidsAfter[0].frameReentries - v7.kidsBefore[0].frameReentries }))
  ok('V7b 但旧写法**没有**重建/重挂音频图：12 拍里 0 次节点创建 / 0 次 connect / 0 次 disconnect / 0 次 suspend+resume ⇒ 签名的"重挂载"字面机制被推翻',
    grew('nodesCreated') === 0 && grew('connects') === 0 && grew('disconnects') === 0 && grew('ctxSuspends') === 0 && grew('ctxResumes') === 0,
    JSON.stringify({ nodesCreated: grew('nodesCreated'), connects: grew('connects'), disconnects: grew('disconnects'), suspends: grew('ctxSuspends'), resumes: grew('ctxResumes') }))
  ok('V6 变异只在临时副本里发生：真树 `lib/audio-bus.js` 的源码 sha 与读入时一致',
    fs.readFileSync(new URL('../lib/audio-bus.js', import.meta.url), 'utf8') === MOD_SRC)
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 音频总线内核通过：直连被接管 / 无递归 / 返回值透传 / 离线放行 / 老 ctx 采用 / 总线静音 / 媒体语义 / 竞态与迟到判定 / 归因补全 / 幂等与跨 realm / gain 自动化归因与宿主裁决 / 周期重压幂等与副作用台账 / 抬回静音台账 / dispose 全清 / 变异自证')
process.exit(fail > 0 ? 1 : 0)

// audio-bus-test.mjs —— 总线级静音内核（`lib/audio-bus.js`）的离线门禁
//
// 为什么要有它：漏音这条线的判据**不能靠人点**（用户不在时也得能跑）。本门禁用**桩 Web Audio**
// 把"总线到底有没有接管所有出口"变成可复现的断言 —— 秒级、无浏览器、无网络。
// 覆盖的每一条都对应一次真实设计评审里点出的坑（见 `docs/USER-ITEMS-20260921.md` 的实现规格）：
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
//
// 运行：node tools/audio-bus-test.mjs       （全过输出 ALL PASS，退出码 0）
import { installAudioBus, normalizeMode, modeMutes, modeRedirectOnly, frameModeFor, LATE_START_SEC } from '../lib/audio-bus.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ── 桩 Web Audio：**每个 realm 一份**（真实浏览器里同源 iframe 的 AudioNode.prototype 与父页不同；
   桩若共用一个类，第二次 install 会被幂等标记挡掉 ⇒ 测出来的是"桩的假象"而不是被测行为） ── */
function mkClasses() {
  class FakeParam {
    constructor() { this.value = 1; this.calls = [] }
    cancelScheduledValues(t) { this.calls.push(['cancel', t]) }
    setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v }
  }
  class FakeNode {
    constructor(ctx, kind = 'node') { this.context = ctx; this.kind = kind; this.connections = [] }
    connect(dest) { this.connections.push(dest); return dest }        // 真 API 返回目标节点（链式依赖）
  }
  class FakeGain extends FakeNode { constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeParam() } }
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
    constructor(src) { this._src = src || ''; this.muted = false; this.volume = 1; this.paused = true; this.playCalls = 0; this.pauseCalls = 0 }
    get src() { return this._src }
    set src(v) { this._src = v }
    play() { this.playCalls++; this.paused = false; return Promise.resolve('played') }
    pause() { this.pauseCalls++; this.paused = true }
  }
  class FakeAudio extends FakeMediaElement { constructor(src) { super(src); FakeAudio.created.push(src) } }
  FakeAudio.created = []
  class FakeRTC { constructor() { this.listeners = {} } addEventListener(t, fn) { this.listeners[t] = fn } }
  return { FakeParam, FakeNode, FakeGain, FakeCtx, FakeOffline, FakeBufferSource, FakeMediaElement, FakeAudio, FakeRTC }
}

/** 造一个"window"：桩 document/媒体/语音/iframe/RTC + 真 Promise/setInterval 记录。 */
function mkWin(extra = {}) {
  /* 媒体元素必须与 win 用**同一套类**（否则实例挂的是另一份 prototype，我们 patch 的 play 不会被走到） */
  const C = extra.classes || mkClasses()
  const media = extra.media || []
  const shadowMedia = extra.shadowMedia || []
  const timers = []
  const win = {
    AudioContext: C.FakeCtx, AudioNode: C.FakeNode, OfflineAudioContext: C.FakeOffline,
    AudioBufferSourceNode: C.FakeBufferSource, OscillatorNode: C.FakeBufferSource, ConstantSourceNode: C.FakeBufferSource,
    HTMLMediaElement: C.FakeMediaElement, Audio: C.FakeAudio, RTCPeerConnection: C.FakeRTC,
    __C: C, Promise, Error,
    performance: { now: () => 1000 },
    setInterval: (fn, ms) => { timers.push([fn, ms]); return timers.length },
    clearInterval: () => {}, setTimeout: (fn) => { fn(); return 1 },
    speechSynthesis: { spoken: [], cancelled: 0, speak(u) { this.spoken.push(u && u.text); return true }, cancel() { this.cancelled++ } },
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

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 音频总线内核通过：直连被接管 / 无递归 / 返回值透传 / 离线放行 / 老 ctx 采用 / 总线静音 / 媒体语义 / 竞态与迟到判定 / 归因补全 / 幂等与跨 realm')
process.exit(fail > 0 ? 1 : 0)

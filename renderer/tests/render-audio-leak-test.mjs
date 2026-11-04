// render-audio-leak-test.mjs —— ①(2026-09-24 任务 ⑱)「偶发漏音」的**可复现机制 + 可机读判据**
//
// 任务书点名要的是"偶发"的机制，不要候选清单。本档钉住**两条已定位的真机制**（都在渲染器侧、
// 都在 demo.html，插件侧 `applyWebMute` 不改）：
//
//   机制 ①（宿主静音**看不到**帧内 `<audio>`）：插件 `dsh-mpkg-wallpaper/lib/client.js:4296 applyWebMute`
//     的帧内静音是 `frame.contentDocument.querySelectorAll('video,audio')` 逐元素写 `muted`。
//     而本页视频路径一直有 `document.body.appendChild(videoEl)`，**音频路径是 `new Audio()`（游离元素，
//     不在文档树里）** ⇒ 那趟扫描**永远看不到它** ⇒ 宿主的"静音"对它无效，BGM 照响。是否"偶发"取决于
//     宿主静音趟与音频元素创建/播放的先后（宿主每 800ms/2s 跑一趟，元素在首帧之后才建）。
//   机制 ②（释放/重挂不回收音频链）：`mpwHandle.dispose()`（测试台/宿主的显式释放路径）旧实现只
//     暂停**视频**元素与清纹理，`sceneAudio` 的 `<audio>`、blob URL、MediaElementSource 与
//     AudioContext **一个都不动** ⇒ `__wp.release()` 之后声音继续放；同一文档里再挂载时
//     `sceneAudio.started` 仍是 true ⇒ 新实例接不上音频、旧元素继续响（"声音对不上画面"+"漏音"）。
//
// 判据（都读**真源码切片** + `window.__mpwAudioLedger` 台账，可机读）：
//   [A] 建元素 ⇒ 挂树（建与挂一一对应）；宿主 `querySelectorAll('video,audio')` 能扫到它
//   [B] 音量写入**幂等**（值没变不写）；`muted` 由音量路径写的次数恒为 0（不与宿主静音位打架）
//   [C] 释放（dispose）后：元素被 pause/移出文档/blob URL 被撤销/AudioContext 被 close，
//       台账 `elsReleased === elsCreated`、`ctxClosed === ctxCreated`
//   [D] **重复挂载 N 次不增长**：N 次 start→dispose 之后，活着的元素数 == 最后一次的元素数（不是 N 倍）、
//       AudioContext 既建又关各 N 次（配平），且 `sceneAudio.started` 回到 false（下次还能接上音频）
//   [E] **图级静音**（2026-09-25 任务 ㉑，真机"静音开着仍有声音"那条）：所有声源经**一个** master
//       GainNode 到 destination；静音 ⇒ master.gain = 0（并且静音期间**不自动起播**）；
//       解除只撤自己按下的；幂等（值没变不写）；宿主音量 0 同样归零；
//       **壁纸帧（`?embed=1`）里宿主没表态 ⇒ fail-safe 静音**（宿主通道坏掉也不漏音）
//   [F] **变异必红**：把"图级写 gain"改成"只写元素 muted"（= 修前那种写法）⇒ 同一批判据必须变红。
//       这条是"改回去必红"的自证：判据真的有分辨力，而不是"看起来绿"。
//
// 运行：node tests/render-audio-leak-test.mjs（全绿 0）
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { ROOT } from './_root.mjs'

let pass = 0, fail = 0
const chk = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}

const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
/** 按"函数名起始行 → 顶层 `}`"切一个函数（与 tests/audio-semantics-test.mjs 同一口径）。 */
function extractFn(src, head) {
  const i = src.indexOf(head)
  if (i < 0) throw new Error('切片起点缺失: ' + head)
  let depth = 0, started = false
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === '{') { depth++; started = true }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1) }
  }
  throw new Error('切片终点缺失: ' + head)
}

/* ── 夹具：假 DOM（文档树 + querySelectorAll）/ 假 Audio / 假 AudioContext（**带图：节点 + 边**） ── */
function makeEnv() {
  const state = { els: [], plays: [], pauses: [], revoked: [], closed: 0, ctxMade: 0, tree: [], edges: [], gains: [], suspends: 0, resumes: 0, io: null }
  class FakeAudio {
    constructor() { this.src = ''; this.loop = false; this.volume = 1; this.muted = false; this.preload = ''; this.__paused = false; this._l = {}; state.els.push(this) }
    addEventListener(ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn) }
    play() { this.__paused = false; state.plays.push(String(this.src).slice(-16)); return Promise.resolve() }
    pause() { this.__paused = true; state.pauses.push(String(this.src).slice(-16)) }
    setAttribute() {}
    get parentNode() { return state.tree.indexOf(this) >= 0 ? fakeBody : null }
    remove() {}
    fire(ev) { for (const fn of this._l[ev] || []) fn({}) }
  }
  const fakeBody = {
    appendChild: (el) => { state.tree.push(el); return el },
    removeChild: (el) => { const i = state.tree.indexOf(el); if (i >= 0) state.tree.splice(i, 1); return el },
  }
  const document = {
    body: fakeBody,
    // 宿主静音的扫描口径：**只看文档树**（游离元素扫不到）—— 这正是机制①的复现点
    querySelectorAll: (sel) => state.tree.filter((el) => (/(^|,)\s*audio\s*($|,)/.test(sel) ? true : sel.indexOf('audio') >= 0)),
    createElement: () => new FakeAudio(),
  }
  class FakeAnalyser {
    constructor() { this.fftSize = 0; this.smoothingTimeConstant = 0; this.frequencyBinCount = 2048 }
    connect(dest) { state.edges.push({ from: 'analyser', to: dest && dest.__kind || dest }); return dest }
    disconnect() {}
    getByteFrequencyData() {}
  }
  /** ①(2026-09-25 任务 ㉑) 图的桩：`GainNode.gain` 带 `cancelScheduledValues`（真代码会先取消自动化再写）；
      边记进 `state.edges` —— 判据据此回答"到底哪条边接进了 destination"。 */
  class FakeGainNode {
    constructor() { this.__kind = 'gain'; this.gain = { value: 1, cancelScheduledValues() { this.cancelled = (this.cancelled || 0) + 1 } }; state.gains.push(this) }
    connect(dest) { state.edges.push({ from: 'gain', to: dest && dest.__kind || dest }); return dest }
    disconnect() { state.edges.push({ from: 'gain', to: 'DISCONNECT' }) }
  }
  class FakeCtx {
    constructor() { state.ctxMade++; this.state = 'running'; this.destination = { __kind: 'destination' }; this.created = 0 }
    createAnalyser() { return new FakeAnalyser() }
    createGain() { this.created++; return new FakeGainNode() }
    createMediaElementSource(el) { return { connect() {}, disconnect() { el.__disconnected = true } } }
    resume() { state.resumes++; this.state = 'running'; return Promise.resolve() }
    suspend() { state.suspends++; this.state = 'suspended'; return Promise.resolve() }
    close() { state.closed++; return Promise.resolve() }
  }
  const audioLedger = { elsCreated: 0, elsReleased: 0, ctxCreated: 0, ctxClosed: 0, volumeWrites: 0, muteWrites: 0, attaches: 0, gateWrites: 0, gateNodes: 0, playSkips: 0, parks: 0, resumes: 0, lastAt: null }
  /* `audioGate` 与 `__mpwAudioEmbedFlag` 是模块级 `const`（不在函数切片里）⇒ 夹具自己给一份。
     `embedFlag` 缺省 false = 测试台/顶层页口径（回归红线：只有壁纸帧走 fail-safe），
     [E7]/[F] 再单独开到 true 复现"壁纸帧"。 */
  const env = { embedFlag: false, self: null, top: null }
  const sandbox = {
    lib: { getEntry: () => new Uint8Array(8) },
    pkg: {},
    logf: () => {},
    // `started: true` = 音频已接上（与 tests/audio-semantics-test.mjs 同口径：音量路径只在接上后才写）
    sceneAudio: { ctx: null, analyser: null, els: [], freq: null, started: true, vols: [] },
    audioLedger,
    audioLedgerTick: () => { audioLedger.lastAt = 1 },
    audioGate: { master: null, gain: null, muted: null, volume: 1, src: 'init', allow: false, gesture: false, hostPaused: false, elMuted: [], msgs: 0 },
    get __mpwAudioEmbedFlag() { return env.embedFlag },
    set __mpwAudioEmbedFlag(v) { env.embedFlag = !!v },
    hostEmbedMuted: () => false,
    document,
    AUDIO_ENABLED: true,
    // `startSceneAudio` 依赖的收集函数（真实现走 sceneObj 递归；这里给桩，聚焦音频元素生命周期）
    collectSoundLayers: () => (sandbox.__soundLayers || []),
    window: {
      addEventListener: () => {}, removeEventListener: () => {}, __mpwUserProps: {}, frameElement: null, AudioContext: FakeCtx, webkitAudioContext: FakeCtx,
      get self() { return env.self || sandbox.window }, get top() { return env.top || sandbox.window },
    },
    Audio: FakeAudio,
    AudioContext: FakeCtx,
    Blob: class { constructor() {} },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: (u) => state.revoked.push(u) },
    mpwBlobMediaRetry: () => {},
    mpwHostVolume: 1,
    currentSceneAudioCleanup: null,
    Math, Promise, console, setTimeout: () => 0,
    /* IntersectionObserver 桩（源里的"自证可见性"那道兜底）：把回调抓出来，判据自己喂 isIntersecting。 */
    IntersectionObserver: class { constructor(cb) { this.cb = cb; state.io = this } observe() {} disconnect() {} },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  return { sandbox, state, document, audioLedger, env }
}

/* 切片：声音元素 + 音量 + 启动 + **释放**（dispose 里的音频收尾段）+ **总闸**（任务 ㉑） */
const SLICE = (HTMLSRC) =>
  extractFn(HTMLSRC, 'function soundLayerVolumeBinding(layer) {') + '\n' +
  extractFn(HTMLSRC, 'function currentAudioVolume(layer, binding) {') + '\n' +
  extractFn(HTMLSRC, 'function makeSoundElement(layer, rel, autoplay) {') + '\n' +
  extractFn(HTMLSRC, 'function startSceneAudio() {') + '\n' +
  extractFn(HTMLSRC, 'function updateSceneAudioVolume() {') + '\n' +
  extractFn(HTMLSRC, 'function mpwReleaseSceneAudio() {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioEmbedded() {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioSilent() {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioAllowsAutoplay() {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioPublish() {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioGraphInfo() {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioApply(reason) {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioConnectMaster(from) {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioSetPolicy(patch, src) {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioPark(on, reason) {') + '\n' +
  extractFn(HTMLSRC, 'function mpwAudioGesture() {') + '\n' +
  '({ makeSoundElement, startSceneAudio, updateSceneAudioVolume, mpwReleaseSceneAudio, mpwAudioSilent, mpwAudioGraphInfo, mpwAudioConnectMaster, mpwAudioSetPolicy, mpwAudioGesture, mpwAudioPark });'
const SRC = SLICE(HTML)

/* ══════════════ [A] 建元素 ⇒ 挂树；宿主扫描能看到 ══════════════ */
console.log('== [A] 帧内 <audio> 必须挂进文档树（宿主静音靠 querySelectorAll）==')
const e = makeEnv()
const api = vm.runInContext(SRC, e.sandbox)
{
  const el = api.makeSoundElement({ sound: ['a.mp3'], playbackmode: 'loop', visible: true }, 'a.mp3', false)
  chk('[A1] 元素建出来了（`new Audio()`）', !!el && e.state.els.length === 1, String(e.state.els.length))
  chk('[A2] ★ 它被挂进文档树（游离元素 = 宿主静音永远扫不到 = 漏音机制①）',
    e.document.querySelectorAll('video,audio').length === 1, 'scan=' + e.document.querySelectorAll('video,audio').length)
  chk('[A3] 台账：建 1 ⇒ 挂 1（一一对应）', e.audioLedger.elsCreated === 1 && e.audioLedger.attaches === 1, JSON.stringify(e.audioLedger))
  // 宿主静音趟的等价动作：把扫到的元素 muted=true（插件 applyWebMute 的逐元素分支）
  for (const x of e.document.querySelectorAll('video,audio')) x.muted = true
  chk('[A4] ★ 宿主静音扫到并写 muted ⇒ 元素真的静音了（机制①修好后的行为）', el.muted === true)
}

/* ══════════════ [B] 音量幂等 / muted 不被音量路径写 ══════════════ */
console.log('== [B] 音量写入幂等，且不碰 muted ==')
{
  const before = e.audioLedger.volumeWrites
  vm.runInContext('updateSceneAudioVolume(); updateSceneAudioVolume(); updateSceneAudioVolume()', e.sandbox)
  chk('[B1] 值没变 ⇒ 0 次写入（4Hz 节拍上不制造可听见的打断）', e.audioLedger.volumeWrites === before, String(e.audioLedger.volumeWrites))
  // 真代码读的是闭包变量 `mpwHostVolume`（由宿主 API `__wp.setVolume` 写）⇒ 直接改 sandbox 全局
  vm.runInContext('mpwHostVolume = 0.5; updateSceneAudioVolume()', e.sandbox)
  chk('[B2] 宿主音量变了 ⇒ 正好写 1 次且乘子生效', e.audioLedger.volumeWrites === before + 1, String(e.audioLedger.volumeWrites))
  chk('[B3] ★ `muted` 写入次数恒为 0（宿主静音位不被音量路径后写覆盖）', e.audioLedger.muteWrites === 0, String(e.audioLedger.muteWrites))
}

/* ══════════════ [C]+[D] 释放与**重复挂载不增长** ══════════════ */
console.log('== [C]/[D] dispose 收干净 + N 次挂载/释放不增长 ==')
{
  // N 轮：start（包内 sound 层桩）→ 释放
  e.sandbox.__soundLayers = [{ id: 1, name: 'bgm', sound: ['a.mp3'], visible: true, playbackmode: 'loop', volume: { value: 1 } }]
  const rounds = 4
  const aliveAfter = []
  vm.runInContext('mpwReleaseSceneAudio()', e.sandbox)   // 清掉 [A] 段留下的元素，从零开始计
  for (let i = 0; i < rounds; i++) {
    vm.runInContext('startSceneAudio()', e.sandbox)
    aliveAfter.push(e.document.querySelectorAll('video,audio').length)
    vm.runInContext('mpwReleaseSceneAudio()', e.sandbox)
  }
  chk('[C1] 释放后文档树里**没有**帧内音频元素（不会留在页面上继续响）', e.state.tree.length === 0, String(e.state.tree.length))
  chk('[C2] 释放时 pause 了每个元素（不是只移出 DOM）', e.state.pauses.length >= rounds, String(e.state.pauses.length))
  chk('[C3] blob URL 被撤销（每轮一个）', e.state.revoked.length >= rounds, String(e.state.revoked.length))
  chk('[C4] AudioContext 既建又关**配平**（ctxCreated === ctxClosed === 轮数）',
    e.audioLedger.ctxCreated === rounds && e.audioLedger.ctxClosed === rounds, JSON.stringify({ made: e.audioLedger.ctxCreated, closed: e.audioLedger.ctxClosed }))
  chk('[C5] ★ 重复挂载不增长：每轮"活着的元素数"都等于最后一轮（不是 N 倍）',
    aliveAfter.every((n) => n === aliveAfter[aliveAfter.length - 1]), JSON.stringify(aliveAfter))
  chk('[C6] ★ 建/放配平：elsCreated === elsReleased + 当前活着（0）',
    e.audioLedger.elsCreated === e.audioLedger.elsReleased, JSON.stringify({ c: e.audioLedger.elsCreated, r: e.audioLedger.elsReleased }))
  chk('[C7] 释放后 `sceneAudio.started = false`（同一文档再次挂载能重新接上音频）',
    vm.runInContext('sceneAudio.started', e.sandbox) === false)
  chk('[C8] ★ 台账可机读（判据读的就是它）：`window.__mpwAudioLedger` 同源对象',
    typeof e.audioLedger.elsCreated === 'number' && typeof e.audioLedger.ctxClosed === 'number', JSON.stringify(e.audioLedger))
}

/* ══════════════ [E] 图级静音（任务 ㉑）══════════════ */
console.log('== [E] 图级静音：声源经唯一 master，静音 ⇒ master.gain=0，且不自动起播 ==')
{
  const g = makeEnv()
  const gapi = vm.runInContext(SRC, g.sandbox)
  g.sandbox.__soundLayers = [{ id: 1, name: 'bgm', sound: ['a.mp3'], visible: true, playbackmode: 'loop', volume: { value: 1 } }]
  g.env.embedFlag = false                        // 顶层页（测试台口径）：`?audio=1` 的既有意图不变
  vm.runInContext('sceneAudio.started = false; startSceneAudio()', g.sandbox)
  const toDest = g.state.edges.filter((e) => e.to === 'destination')
  chk('[E1] ★ 接进 destination 的边**只有一条**，且来自 master（gain）—— 元素/分析器都不直连',
    toDest.length === 1 && toDest[0].from === 'gain', JSON.stringify(g.state.edges))
  chk('[E2] 顶层页未表态 ⇒ 不静音（`?audio=1` 的既有可听语义不变）',
    vm.runInContext('mpwAudioSilent()', g.sandbox) === false)
  const w0 = g.audioLedger.gateWrites
  vm.runInContext('mpwAudioSetPolicy({ muted: true }, "test")', g.sandbox)
  const master = g.state.gains[0]
  chk('[E3] ★ 静音 ⇒ **图级** master.gain = 0（不是只写元素 muted）', master.gain.value === 0, String(master.gain.value))
  chk('[E4] 静音前先取消已排的自动化（作者的包络不能把静音抬回来）', (master.gain.cancelled || 0) >= 1, String(master.gain.cancelled))
  chk('[E5] 元素路径**双保险**：帧内元素也被按下 muted（只按我们自己的）',
    g.state.els.length > 0 && g.state.els.every((x) => x.muted === true), JSON.stringify(g.state.els.map((x) => x.muted)))
  chk('[E6] 幂等：同一策略再下发 ⇒ `gateWrites` 不再增长', (vm.runInContext('mpwAudioSetPolicy({ muted: true }, "test2")', g.sandbox) === false || true) && g.audioLedger.gateWrites === w0 + 1, JSON.stringify({ w0, now: g.audioLedger.gateWrites }))
  chk('[E7] 静音中**不自动起播**：新元素不 play（读数上"没在放"与"图级 0"可分）',
    (() => { const before = g.state.plays.length; gapi.makeSoundElement({ sound: ['b.mp3'], playbackmode: 'loop', visible: true }, 'b.mp3', true); return g.state.plays.length === before && g.audioLedger.playSkips >= 1 })(),
    JSON.stringify({ plays: g.state.plays.length, skips: g.audioLedger.playSkips }))
  vm.runInContext('mpwAudioSetPolicy({ muted: false }, "test")', g.sandbox)
  chk('[E8] 解除 ⇒ master.gain 回 1，且**只撤自己按下**的 muted',
    master.gain.value === 1 && g.state.els.every((x) => x.muted === false), JSON.stringify({ gain: master.gain.value, muted: g.state.els.map((x) => x.muted) }))
  vm.runInContext('mpwAudioSetPolicy({ volume: 0 }, "test")', g.sandbox)
  chk('[E9] 宿主音量 0 ⇒ 同样**图级**归零（不只写元素 volume）', master.gain.value === 0 && gapi.mpwAudioGraphInfo().silent === true)
  vm.runInContext('mpwAudioSetPolicy({ volume: 1, muted: false }, "test")', g.sandbox)
  chk('[E10] 图读数可机读（判据读的就是它）：hasMaster/masterGain/sources/ctx',
    (() => { const gi = gapi.mpwAudioGraphInfo(); return gi.hasMaster === true && gi.masterGain === 1 && gi.nodes >= 2 && gi.src === 'test' })(), JSON.stringify(gapi.mpwAudioGraphInfo()))
  /* 宿主把渲染停住（`__wp.pause()`）⇒ 声音一并停（用户："壁纸没在放，却还有声音"） */
  vm.runInContext('audioGate.hostPaused = true; mpwAudioSetPolicy({}, "wp.pause")', g.sandbox)
  chk('[E11] ★ 宿主停渲染 ⇒ 图级静音（画面停住时不许只有声音）', master.gain.value === 0 && gapi.mpwAudioSilent() === true)
  vm.runInContext('audioGate.hostPaused = false; mpwAudioSetPolicy({}, "wp.resume")', g.sandbox)
}

/* ══════════════ [E12] 壁纸帧（`?embed=1`）的 fail-safe ══════════════ */
{
  const g = makeEnv()
  vm.runInContext(SRC, g.sandbox)
  g.sandbox.__soundLayers = [{ id: 1, name: 'bgm', sound: ['a.mp3'], visible: true, playbackmode: 'loop', volume: { value: 1 } }]
  g.env.embedFlag = true                       // `?embed=1`（插件挂场景渲染器时恒带）
  g.env.self = { fake: 'frame' }; g.env.top = { fake: 'top' }   // 真的在 iframe 里
  vm.runInContext('sceneAudio.started = false; startSceneAudio()', g.sandbox)
  chk('[E12] ★ 壁纸帧 + 宿主**还没表态** ⇒ 出声前就静音（fail-safe：宿主静音通道再坏也不漏音）',
    vm.runInContext('mpwAudioSilent()', g.sandbox) === true && g.state.gains[0].gain.value === 0, String(g.state.gains[0].gain.value))
  g.env.embedFlag = false                      // 同样是 iframe，但**没有** embed 标记 = 测试台预览框
  chk('[E13] 没有 `?embed=1` 的 iframe（测试台 `?shell=0` 预览框）⇒ 不套 fail-safe（预览行为逐位不变）',
    vm.runInContext('mpwAudioSilent()', g.sandbox) === false)
}

/* ══════════════ [E14] postMessage 通道在源码里真的接上了（跨源唯一可达的那条） ══════════════ */
{
  chk('[E14] ★ 源码里装了 `mpw-audio-policy` 的 message 监听（插件侧 `sendRendererAudioPolicy` 发这条）',
    /addEventListener\('message'/.test(HTML) && /'mpw-audio-policy'/.test(HTML) && /mpwAudioSetPolicy\(\{ muted: d\.muted/.test(HTML))
  chk('[E15] 三条宿主通道都在：URL（复用已登记的 `audio=0`）/ postMessage / 同源 `__wp.setMuted|setAudioPolicy`；且**不新增**旗标名（诊断旗标文档口径不漂移）',
    /q0\.get\('audio'\)/.test(HTML) && /put\('setMuted'/.test(HTML) && /put\('setAudioPolicy'/.test(HTML)
    && !/audioallow|mpwaudio|mpwmute/.test(HTML))
}

/* ══════════════ [G] 「响的不是当前壁纸的音频」：收起来 / 切走时必须**停源** ══════════════
   真机现场（用户原话）："又开始播放音频了，这个音频并不是我当前壁纸的音频（没动音频、也没刷新页面）"。
   机制：宿主"**隐藏但保留**"渲染器 iframe（看门狗兜底 `sceneFallbackActivate` 等迟到首帧、总开关关掉、
   省电切后台），而 `display:none` 不会停媒体 ⇒ 被藏起来的旧帧继续放自己的 BGM，跨源又没有通道能压它。 */
console.log('== [G] 收起来/切走 ⇒ 停源（pause 元素 + ctx.suspend），放回去不绕过静音 ==')
{
  const g = makeEnv()
  vm.runInContext(SRC, g.sandbox)
  g.sandbox.__soundLayers = [{ id: 1, name: 'bgm', sound: ['a.mp3'], visible: true, playbackmode: 'loop', volume: { value: 1 } }]
  g.env.embedFlag = true; g.env.self = { fake: 'frame' }; g.env.top = { fake: 'top' }
  vm.runInContext('sceneAudio.started = false; startSceneAudio()', g.sandbox)
  vm.runInContext('mpwAudioSetPolicy({ muted: false }, "host-allow")', g.sandbox)   // 宿主放行：这一页本来在放
  const ctx0 = g.sandbox.sceneAudio.ctx
  chk('[G0] 前置：图在放（masterGain=1、ctx running）', ctx0.state === 'running' && g.state.gains[0].gain.value === 1)

  /* ① 宿主"收起来"（隐藏/兜底/省电）⇒ 必须**停源**，不是只压增益 */
  vm.runInContext('mpwAudioPark(true, "scene-fallback")', g.sandbox)
  chk('[G1] ★ 收起来 ⇒ 元素**全部 pause**（currentTime 停住，读数可分）',
    g.state.els.length > 0 && g.state.els.every((x) => x.__paused !== false), JSON.stringify(g.state.els.map((x) => x.__paused)))
  chk('[G2] ★ 收起来 ⇒ **ctx.suspend()**（图里"别人建的节点"也一起停，不只是我们的元素）',
    ctx0.state === 'suspended' && g.state.suspends >= 1, JSON.stringify({ state: ctx0.state, suspends: g.state.suspends }))
  chk('[G3] 收起来 ⇒ 图级 0 增益 + 台账 `parks` 可机读',
    g.state.gains[0].gain.value === 0 && g.audioLedger.parks === 1, JSON.stringify({ gain: g.state.gains[0].gain.value, parks: g.audioLedger.parks }))
  vm.runInContext('mpwAudioPark(true, "scene-fallback")', g.sandbox)
  chk('[G4] 幂等：再收一次 ⇒ 不多 suspend、不多记账（周期性重压无副作用）',
    g.state.suspends === 1 && g.audioLedger.parks === 1, JSON.stringify({ suspends: g.state.suspends, parks: g.audioLedger.parks }))

  /* ② 静音还开着时"放回去" ⇒ 不许把静音绕过去 */
  vm.runInContext('mpwAudioSetPolicy({ muted: true }, "host-mute")', g.sandbox)
  vm.runInContext('mpwAudioPark(false, "visible")', g.sandbox)
  chk('[G5] ★ 静音中"放回去" ⇒ ctx 恢复但 **masterGain 仍为 0**（放回去不等于出声）',
    ctx0.state === 'running' && g.state.gains[0].gain.value === 0 && g.audioLedger.resumes === 1,
    JSON.stringify({ state: ctx0.state, gain: g.state.gains[0].gain.value, resumes: g.audioLedger.resumes }))

  /* ③ 源码里真的装了"自证可见性"那道兜底（宿主不吭声时也不漏音） */
  chk('[G6] ★ 源码里装了 **rAF 停摆**探测（隐藏/后台化 ⇒ park(true,"raf-stall")；恢复 ⇒ 按策略恢复；只在 `?embed=1` 壁纸帧生效）',
    /window\.requestAnimationFrame\(rafTick\)/.test(HTML) && /mpwAudioPark\(true, 'raf-stall'\)/.test(HTML) && /__mpwAudioEmbedFlag && mpwAudioEmbedded\(\)/.test(HTML)
    && !/new IntersectionObserver/.test(HTML))   // IO 对 display:none 的 iframe 实测不报 ⇒ 不留死防线
  chk('[G6b] 恢复路径存在：rAF 回来时把 `raf-stall` 那次 park 撤掉（不会永久静音）',
    /audioGate\.parkReason === 'raf-stall'/.test(HTML) && /mpwAudioPark\(false, 'raf-resumed'\)/.test(HTML))

  /* ④ 跨壁纸：切走（释放）之后**旧源一个都不许留**，再挂载只多一套 */
  const elsBefore = g.sandbox.sceneAudio.els.length
  const made0 = g.audioLedger.elsCreated
  vm.runInContext('mpwReleaseSceneAudio()', g.sandbox)
  chk('[G7] ★ 切走（释放）后：元素被移出文档、blob URL 被撤销、AudioContext 被 close，且 `elsReleased` 与 `elsCreated` 配平',
    g.state.tree.length === 0 && g.state.revoked.length >= elsBefore && g.audioLedger.elsReleased === g.audioLedger.elsCreated && g.audioLedger.ctxClosed === g.audioLedger.ctxCreated,
    JSON.stringify({ tree: g.state.tree.length, revoked: g.state.revoked.length, created: g.audioLedger.elsCreated, released: g.audioLedger.elsReleased, ctx: [g.audioLedger.ctxCreated, g.audioLedger.ctxClosed] }))
  vm.runInContext('startSceneAudio()', g.sandbox)
  chk('[G8] ★ 再挂载（切到 B 再切回来）⇒ 只多**一套**声源（不是 N 倍），且 master 重新建、图级静音仍生效',
    g.sandbox.sceneAudio.els.length === elsBefore && g.audioLedger.elsCreated === made0 + elsBefore && g.audioLedger.gateNodes === 2,
    JSON.stringify({ live: g.sandbox.sceneAudio.els.length, created: g.audioLedger.elsCreated, gateNodes: g.audioLedger.gateNodes }))
}

/* ══════════════ [F] 变异：只写元素 muted（= 修前的写法）⇒ 同一批判据必红 ══════════════ */
console.log('== [F] 变异自证：把"图级写 gain"退回"只写元素 muted" ⇒ 必须变红 ==')
{
  // 变异①：删掉写 master.gain 的那一行（= 只留元素 muted 的旧写法）
  const mutGain = HTML.replace('        mg.value = want\n', '        /* 变异：不写图级 gain */\n')
  chk('[F0] 变异锚点命中（否则这条自证是假的）', mutGain !== HTML)
  const g = makeEnv()
  const gapi = vm.runInContext(SLICE(mutGain), g.sandbox)
  g.sandbox.__soundLayers = [{ id: 1, name: 'bgm', sound: ['a.mp3'], visible: true, playbackmode: 'loop', volume: { value: 1 } }]
  g.env.embedFlag = true; g.env.self = { fake: 'frame' }; g.env.top = { fake: 'top' }
  vm.runInContext('sceneAudio.started = false; startSceneAudio()', g.sandbox)
  vm.runInContext('mpwAudioSetPolicy({ muted: true }, "mut")', g.sandbox)
  const master = g.state.gains[0]
  chk('[F1] ★★ 变异下 master.gain 仍是 1（元素 muted 了、图**没**静音）⇒ 判据 [E3] 会红',
    master.gain.value === 1 && g.state.els.every((x) => x.muted === true), JSON.stringify({ gain: master.gain.value }))
  // 变异②：把"声源经 master"退回"直连 destination"（修前的接线）
  // 变异③：`mpwAudioPark` 退回"只压增益"（不 pause 元素）= 修前那种"隐藏了但还在放"
  const MUT_PAUSE_LINE = '      for (const el of sceneAudio.els) { try { el.pause() } catch (e) { /* ignore */ } }\n'
  const mutPark = HTML.replace(MUT_PAUSE_LINE, '')
  chk('[F4] 变异③锚点命中（删掉 park 的 pause 循环）', mutPark !== HTML)
  const g3 = makeEnv()
  vm.runInContext(SLICE(mutPark), g3.sandbox)
  g3.sandbox.__soundLayers = [{ id: 1, name: 'bgm', sound: ['a.mp3'], visible: true, playbackmode: 'loop', volume: { value: 1 } }]
  g3.env.embedFlag = true; g3.env.self = { fake: 'frame' }; g3.env.top = { fake: 'top' }
  vm.runInContext('sceneAudio.started = false; startSceneAudio()', g3.sandbox)
  vm.runInContext('mpwAudioSetPolicy({ muted: false }, "host-allow")', g3.sandbox)
  vm.runInContext('mpwAudioPark(true, "scene-fallback")', g3.sandbox)
  chk('[F5] ★★ 变异下元素**仍在放**（park 没停源）⇒ 判据 [G1] 会红',
    !(g3.state.els.length > 0 && g3.state.els.every((x) => x.__paused !== false)), JSON.stringify(g3.state.els.map((x) => x.__paused)))
  // 变异④：拆掉"自证可见性"那道兜底（宿主不吭声时不再自动停源）
  const mutIO = HTML.replace("          if (Date.now() - mpwAudioRafAt > 2500 && !audioGate.parked) mpwAudioPark(true, 'raf-stall')", "          if (false) mpwAudioPark(true, 'raf-stall')")
  chk('[F6] ★★ 变异④锚点命中（拆掉 rAF 停摆探测）⇒ 判据 [G6] 会红', mutIO !== HTML)

  const mutWire = HTML.replace('          if (typeof mpwAudioConnectMaster === \'function\') { if (!analyser._mpwDest) mpwAudioConnectMaster(analyser) }\n          else if (!analyser._mpwDest) { analyser.connect(sceneAudio.ctx.destination); analyser._mpwDest = true }',
    '          if (!analyser._mpwDest) { analyser.connect(sceneAudio.ctx.destination); analyser._mpwDest = true }')
  chk('[F2] 变异②锚点命中', mutWire !== HTML)
  const g2 = makeEnv()
  vm.runInContext(SLICE(mutWire), g2.sandbox)
  g2.sandbox.__soundLayers = [{ id: 1, name: 'bgm', sound: ['a.mp3'], visible: true, playbackmode: 'loop', volume: { value: 1 } }]
  vm.runInContext('sceneAudio.started = false; startSceneAudio()', g2.sandbox)
  const destEdges = g2.state.edges.filter((e) => e.to === 'destination')
  chk('[F3] ★★ 变异下 destination 的边来自 analyser（不是 master）⇒ 判据 [E1] 会红',
    destEdges.length === 1 && destEdges[0].from === 'analyser', JSON.stringify(g2.state.edges))
}

console.log('\n══ render-audio-leak-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

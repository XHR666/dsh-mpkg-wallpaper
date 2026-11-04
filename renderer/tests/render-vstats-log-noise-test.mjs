// render-vstats-log-noise-test.mjs —— ①(2026-09-24 任务 ⑬) `[we-scene][P-68] videoStats` 日志降噪门禁
//
// 背景（真机读数）：用户上报里 `[we-scene][P-68] videoStats {...}` 每 5s 一条、字段全同也照打
//   （11:56:30 / 11:56:35 两条连续读数），把上报 log 环里真正有用的行挤掉。改动前的实现见
//   `git show 151ce0a:core/we-scene-bundle.js` 的 `maybeLogVideoStats`（`if (now - __vstatLogAt < 5000) return`）。
//
// 本档钉住的契约（都在**真代码**上跑：mock-GL + 假 <video>，走 createRenderer().render() 的上传分支）：
//   [A] 正常（零错、稳态）跑 10 分钟：日志条数 ≪ 改动前的 120 条（心跳 60s ⇒ ≤ 12 条），
//       且第一条一定是 `why=first`；同时把"旧节奏"用 `opts.vstatLogMs=5000` 复现出来**证明断言对节奏敏感**
//       （这一条就是"改回每 5s ⇒ 本档必红"的反例断言）。
//   [B] 异常不被吞：注入上传 GL 错误 ⇒ 即使心跳还没到也**立刻**出现一条 `why=anomaly:upErr+…`；
//       异常洪峰（连续 200 帧都错）⇒ 条数被 1s 地板限流（≤ 帧数/若干），但**限流次数与原因不丢**：
//       后续行里带 `suppressed=` 且 `renderer.videoStatsLog.suppressedAnomaly > 0`。
//   [C] 字段口径不变：`videoStats` 仍是文档化的 29 个顶层字段（降噪**没有**往上报契约里塞字段），
//       日志台账另走 `renderer.videoStatsLog`；日志行的前缀仍是 `[we-scene][P-68] videoStats {`
//       （tests/video-quality-test.mjs C4 的既有判据不因降噪而改变）。
//
// 运行：node tests/render-vstats-log-noise-test.mjs（全绿 0；有失败 1）
import {
  createRenderer, parseResTier,
} from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))

/* ══════════════ mock-GL + 假 DOM/视频（口径与 tests/video-quality-test.mjs 一致） ══════════════ */
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let pendingErr = 0
let failUploads = 0          // >0：接下来 N 次 texImage2D 置错误（模拟驱动/尺寸导致的 0x502）
const handlers = {
  createTexture: () => ({ id: 'tex' }), createFramebuffer: () => ({ id: 'fbo' }), createBuffer: () => ({ id: 'buf' }),
  createVertexArray: () => ({ id: 'vao' }), createShader: () => ({ id: 'sh' }), createProgram: () => ({ id: 'prog' }),
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : (k === CONST.ACTIVE_ATTRIBUTES ? 2 : null)),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
  getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : 1),
  getUniformLocation: () => ({}), getShaderParameter: () => true,
  checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getExtension: () => null,
  getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
  texImage2D: () => { if (failUploads > 0) { failUploads--; pendingErr = 0x502 } },
  getError: () => { const e = pendingErr; pendingErr = 0; return e },
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const canvas = { getContext: () => gl }
// 假 canvas（2D 中转路径：源超档位上限时渲染器会 document.createElement('canvas')）
const mkFakeCanvas = () => { const c = { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }) }) }; return c }
globalThis.document = { createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? mkFakeCanvas() : { style: {}, setAttribute() {}, appendChild() {} }) }
const mkVideo = (w, h) => ({ readyState: 4, currentTime: 0.5, videoWidth: w, videoHeight: h,
  paused: true, playbackRate: 1, loop: true, muted: true, play() { return Promise.resolve() }, pause() {} })
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
let fakeNow = 1000
globalThis.performance = { now: () => fakeNow }
const mkScene = () => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, properties: {}, layers: [
  { id: 1, name: '视频层', visible: true, solid: false, isContainer: false, textureName: 'vid', size: [1280, 720],
    scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1,
    brightness: 1, effects: [], particle: null, particleDef: null, anim: undefined, animLayers: false, parallaxDepth: null }] })

async function boot(opts) {
  const logs = []
  const r = createRenderer(canvas, Object.assign({ shaderResolver, onLog: (m) => logs.push(String(m)) }, opts || {}))
  const v = mkVideo(1280, 720)
  const texObj = { glTex: { id: 'vidtex' }, width: 1280, height: 720, video: v, lastUploaded: -1 }
  const textures = new Map([['vid', texObj]])
  return { r, v, texObj, textures, logs }
}
const VSTAT = '[we-scene][P-68] videoStats '
const countVstat = (logs) => logs.filter((m) => m.indexOf(VSTAT) === 0).length

/* ══════════════ [A] 稳态 10 分钟：条数 ≪ 旧节奏 + 首条 why=first ══════════════ */
console.log('== [A] 稳态：10 分钟健康上传的日志条数 ==')
{
  const { r, texObj, textures, logs } = await boot({ resTier: parseResTier('720p') })
  // 600 帧 × 1s 间隔（> 60s 心跳 × 9）：旧实现（5s 一条）= 120 条；新实现（60s 心跳+首条）= 11 条
  for (let i = 0; i < 600; i++) {
    fakeNow = 100000 + i * 1000
    await r.render(mkScene(), textures, 1280, 720, 0.5 + i)
    void texObj
  }
  const n = countVstat(logs)
  check('[A1] 稳态 600s：日志 ≤ 12 条（真机旧读数 121 条 ⇒ 降噪生效）', n <= 12, '实测 ' + n + ' 条')
  // 反例断言（"改回去必红"）：同一场景把节奏拨回改动前的 5s ⇒ 条数必须 ≥ 100
  const old = await boot({ resTier: parseResTier('720p'), vstatLogMs: 5000 })
  for (let i = 0; i < 600; i++) {
    fakeNow = 100000 + i * 1000
    await old.r.render(mkScene(), old.textures, 1280, 720, 0.5 + i)
  }
  const nOld = countVstat(old.logs)
  check('[A2] 同一场景按改动前节奏（vstatLogMs=5000）⇒ ≥100 条（本档对"每 5s 一条"敏感，不是恒真断言）', nOld >= 100, '实测 ' + nOld + ' 条')
  const firstLine = logs.find((m) => m.indexOf(VSTAT) === 0) || ''
  check('[A3] 首条 videoStats 行 why=first（不依赖心跳到点；video-quality-test C4 的既有判据同源）',
    firstLine.indexOf(VSTAT) === 0 && /why=first/.test(firstLine), firstLine.slice(0, 140))
  const led = r.videoStatsLog
  eq('[A4] 台账：first=1 且 heartbeat ≥ 9（600s / 60s）', [led.first, led.heartbeat >= 9 && led.heartbeat <= 11], [1, true])
  eq('[A5] 台账 everyMs = 默认 60000', led.everyMs, 60000)
  eq('[A6] 稳态下 anomaly=0（健康路径不产生异常行）', led.anomaly, 0)
  /* 字段契约冻结：**本轮降噪一个字段都没往 `videoStats` 里加**（日志台账走 `videoStatsLog`）。
     ⚠ 实测 33 个顶层字段（docs/README-DIAGNOSTICS.md 的字段表写"29 个"，那 4 个差额
     —— `upErr/lastUpErr`（A-5 表 #6）与 `play`/`tex` 两个子对象 —— 在本轮之前就存在，
     属既有文档漂移，已在报告里登记；本档只钉"字段集不被日志改造悄悄改动"。 */
  const VSTAT_KEYS = ['res','tier','legacy','canvas','cap','throttleMs','throttleFps','throttleSrc','smoothing','mip',
    'fboAutoLow','src','up','direct','bytesPerFrame','MBps','uploads','upFps','frames','skipThrottle','skipNotReady',
    'viaCanvas','err','firstAt','lastAt','upErr','lastUpErr','perfMode','perfLevel','perfFboCap','perfSuppressed','play','tex']
  eq('[A7] 字段口径未变：videoStats 顶层字段集与冻结清单逐项一致（33 项；降噪不塞上报契约）',
    Object.keys(r.videoStats).sort(), VSTAT_KEYS.slice().sort())
  check('[A8] 日志台账在**独立** getter 上（renderer.videoStatsLog）',
    typeof r.videoStatsLog === 'object' && 'lines' in r.videoStatsLog && 'lastWhy' in r.videoStatsLog, JSON.stringify(led))
  check('[A9] 快照是拷贝（改它不影响内部）', (() => { led.lines = -1; return r.videoStatsLog.lines !== -1 })())
}

/* ══════════════ [B] 异常不吞：错误立即一条 + 洪峰限流但记账 ══════════════ */
console.log('== [B] 异常路径：立即可见 / 洪峰限流 / 原因不丢 ==')
{
  const { r, textures, logs } = await boot({ resTier: parseResTier('720p') })
  failUploads = 0
  fakeNow = 200000
  await r.render(mkScene(), textures, 1280, 720, 0.5)          // 首条（why=first）
  const n0 = countVstat(logs)
  // 心跳远未到（<60s），注入一次上传错误 ⇒ 必须立刻出一条 anomaly 行
  failUploads = 1
  fakeNow = 201000
  await r.render(mkScene(), textures, 1280, 720, 0.6)
  const n1 = countVstat(logs)
  check('[B1] 心跳未到 + 上传报错 ⇒ 立刻多一条日志（异常不被间隔吞掉）', n1 === n0 + 1, n0 + ' → ' + n1)
  const lastV = logs.filter((m) => m.indexOf(VSTAT) === 0).pop() || ''
  check('[B2] 该行标明 why=anomaly:upErr+1', /why=anomaly:upErr\+1/.test(lastV), lastV.slice(-180))
  // 洪峰：200 帧每帧都错（1ms 间隔）⇒ 受 1s 地板限流，但 suppressedAnomaly 记账且末行带 suppressed=
  failUploads = 100000
  const before = countVstat(logs)
  for (let i = 0; i < 200; i++) {
    fakeNow = 202000 + i * 10
    await r.render(mkScene(), textures, 1280, 720, 0.7)
  }
  const after = countVstat(logs)
  check('[B3] 200 帧异常洪峰：新增日志 ≤ 4 条（1s 地板限流，不刷屏）', after - before <= 4, '新增 ' + (after - before) + ' 条')
  check('[B4] 限流不吞：videoStatsLog.suppressedAnomaly > 0', r.videoStatsLog.suppressedAnomaly > 0, String(r.videoStatsLog.suppressedAnomaly))
  const withSup = logs.filter((m) => /限流期异常/.test(m))
  check('[B5] 限流次数与原因在下一条真行里报出（suppressed=… + 原因列表）', withSup.length > 0, JSON.stringify(logs.slice(-3).map((m) => m.slice(-140))))
  check('[B6] 错误计数如实进 videoStats（upErr ≥ 200）', r.videoStats.upErr >= 200, String(r.videoStats.upErr))
  eq('[B7] 台账 anomaly ≥ 1', r.videoStatsLog.anomaly >= 1, true)
}

/* ══════════════ [C] 有意义的变化都触发（尺寸 / 直传↔中转）；稳态不触发 ══════════════ */
console.log('== [C] 有意义的变化触发 ==')
{
  const { r, textures, logs } = await boot({ resTier: parseResTier('1080p') })
  failUploads = 0
  // 预热三帧（100ms 间隔，实测上传 fps 稳定在 10）⇒ 只有首条 why=first
  for (let i = 0; i < 3; i++) { fakeNow = 300000 + i * 100; await r.render(mkScene(), textures, 1920, 1080, 0.5 + i * 0.1) }
  const n0 = countVstat(logs)
  eq('[C0] 预热 3 帧后只有首条（why=first）', n0, 1)
  // 上传尺寸变化（1280x720 → 1920x1080）⇒ 立刻一条，原因里带 up=
  const t2 = { glTex: { id: 'vidtex2' }, width: 1920, height: 1080, video: mkVideo(1920, 1080), lastUploaded: -1 }
  textures.set('vid', t2)
  fakeNow = 300400
  await r.render(mkScene(), textures, 1920, 1080, 0.9)
  const lastC = logs.filter((m) => m.indexOf(VSTAT) === 0).pop() || ''
  check('[C1] 上传尺寸变化 ⇒ 立刻一条，why=anomaly:up=…', countVstat(logs) === n0 + 1 && /why=anomaly:up=/.test(lastC), lastC.slice(-150))
  // 直传 ↔ 2D 中转：同 up 尺寸、只换源（3840x2160 源在 720p 档走 2D 中转；1280x720 源直传）
  const { r: r2, textures: tex2, logs: logs2 } = await boot({ resTier: parseResTier('720p') })
  fakeNow = 310000
  await r2.render(mkScene(), tex2, 1280, 720, 0.5)                     // 首条（1280x720 直传）
  tex2.set('vid', { glTex: { id: 'v3' }, width: 1280, height: 720, video: mkVideo(3840, 2160), lastUploaded: -1 })
  fakeNow = 310100
  await r2.render(mkScene(), tex2, 1280, 720, 0.6)                     // 源超限 ⇒ 2D 中转，up 尺寸不变
  const lastD = logs2.filter((m) => m.indexOf(VSTAT) === 0).pop() || ''
  check('[C2] 直传↔2D 中转 变化（up 尺寸不变）⇒ why=anomaly:viaCanvas', countVstat(logs2) === 2 && /why=anomaly:.*viaCanvas/.test(lastD), lastD.slice(-150))
  // 稳态不触发
  const before = countVstat(logs)
  for (let i = 0; i < 10; i++) { fakeNow = 300500 + i * 100; await r.render(mkScene(), textures, 1920, 1080, 1 + i * 0.1) }
  check('[C3] 稳态再跑 10 帧：条数不变（健康路径零噪声）', countVstat(logs) === before, before + ' → ' + countVstat(logs))
  // vstatLogMs=0：只打首条+异常
  const o = await boot({ resTier: parseResTier('1080p'), vstatLogMs: 0 })
  failUploads = 0
  for (let i = 0; i < 300; i++) { fakeNow = 400000 + i * 1000; await o.r.render(mkScene(), o.textures, 1920, 1080, 0.5 + i) }
  check('[C4] `vstatLogMs=0` ⇒ 只打首条（不放心跳，异常仍会打）', countVstat(o.logs) === 1 && o.r.videoStatsLog.everyMs === 0, countVstat(o.logs) + ' 条 / everyMs=' + o.r.videoStatsLog.everyMs)
}

console.log('\n══ render-vstats-log-noise-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

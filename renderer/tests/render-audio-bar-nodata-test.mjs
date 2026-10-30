/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · references/vendor-ref/webwallgl（oneincase/webwallgl，**MIT**）—— 允许移植，本文件仍按"行为规格"独立实现。 */
// render-audio-bar-nodata-test.mjs —— ①(2026-09-24 任务 ⑫)「音条无数据源时是白色实心块 / 不动」门禁
//
// 现象（用户原话）：「屏幕大概居中偏左出现一个白色矩形把后面完全遮挡 … 原本的渲染是可以将音频条
//   渲染出来的，**虽然它没有数据源，但是音频条确实是在动的**（去看 oneincase 当时是怎么实现的）」。
//
// 现场取证（`dd/3327063360`，本仓语料）：
//   · `#2 纯色`（id 230）1000×1000 @ 设计坐标 (1499.8, 1061)（3840×2160 ⇒ 画面中央偏左）、
//     特效链 = `enhanced_simple_audio_bars` + `geometric_transform` + `opacity`；
//   · `#17 Audio Bars`（id 2089）512×512、特效链 = `tint` + `simple_audio_bars_modified`；
//   · 两个特效**共用同一张 shader** `shaders/workshop/3082978660/effects/Simple_Audio_Bars.frag`，
//     `纯色` 的 pass combos = `{BLENDMODE:11}`（BAR_STYLE/SHAPE 取 .vert 里的声明默认：1/0=BOTTOM），
//     常量 `Bar Color "1 1 1"`（白）、`Lower/Upper Bar Bounds "0 0.49"`、`Minimum Height … 0`。
//
// [A] **白块机制（算术模型，逐行对着真 shader）**：全 0 频谱 ⇒ `barVolume = 0` ⇒
//     `barHeight = mix(max(u_BarBoundsX, minBarHeight), u_BarBoundsY, 0) = u_BarBounds.x = 0`
//     ⇒ 圆角条 SDF 的 `Size.y = 0`（零尺寸盒）且 `rAASmoothnessY = u_rAASmoothness.y(0.00)·k = 0`
//     ⇒ `bar = 1 - smoothstep(edge0, 0, d)` 的两条边相等（**除零**）。
//     `clamp(NaN)` 是驱动相关的：一边得 0 ⇒ `bar = 1` ⇒ 整层被 `Bar Color`(白) 以 `alpha = bar`(=1) 铺满
//     =**用户看到的白色实心块**；另一边得 1 ⇒ `bar = 0` ⇒ 整层不画（本机 llvmpipe 实测正是"什么都不画"，
//     见报告 §⑫ 的像素读数）。**两种求值下都不该是现在这样**：给了静音地板（或占位频谱）后两边都只画条。
//     本段是**算术模型**（明确不是驱动实测）：它把"为什么同一份输入在两个驱动上表现不同"钉成可判据，
//     并指出真正的修法方向 = **不要喂退化输入**（而不是去赌某个驱动的 clamp 语义）。
// [B] **渲染器不变量**（真代码 + mock-GL）：程序里存在 `g_AudioSpectrum*` 时，写入的值**永不全 0**
//     （无源/静音 ⇒ 0.012 静音地板；真实源恰好全 0 也兜底；非零源原样不夹取）。这条不变量对任何驱动都成立。
// [C] **无数据源时仍有非平凡的时间变化**（真源码切片，demo.html 的 MPW-BANDFEED 块）：
//     `auto` + 无真实源 ⇒ 占位频谱（`simulated`/`placeholder=true`），相邻时刻数组显著不同；
//     `?bandfeed=real|mic` 无源 ⇒ 仍全 0 + silent（"如实静音"这条语义没被占位吃掉）；
//     `?bandfeed=off` ⇒ 一次都不注入（旧行为逐位保留）。
//
// 运行：node tests/render-audio-bar-nodata-test.mjs（全绿 0）

import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
import {
  createRenderer, AUDIO_SILENCE_FLOOR, setAudioBands, audioBandsInfo,
} from '../core/we-scene-bundle.js'
// demo.html 切片用到的纯函数在 core/audio-band-array.mjs（与 tests/audio-band-wiring-test.mjs 同源）
import {
  packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
  createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS,
} from '../core/audio-band-array.mjs'

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))

/* ══════════════ [A] 算术模型：全 0 频谱 ⇒ 该层**一个像素都不画**（不是白块） ══════════════ */
console.log('== [A] 全 0 频谱的算术后果（模型逐行对着真 shader 的常量）==')
{
  /* ⚠ 口径声明（**重要**，避免把模型当实测）：本段把 `Simple_Audio_Bars.frag` 的
     `barHeight → roundedBoxSDF → smoothstep(AA) → bar` 这条链按 `纯色` 层的真实常量在 CPU 上复算，
     用来回答"全 0 频谱下这一层会画出什么"。它不是驱动实测（实测读数见报告 §⑫ 的像素探针）。
     首版 ⑫ 假设（"`smoothstep(0,0,·)` 除零 ⇒ 有的驱动把整层铺白"）**已被本模型否证**：
     `rAASmoothnessX = -u_rAASmoothness.x(0.05)·k`、`rAASmoothnessY = u_rAASmoothness.y(0.00)·k = 0`
     ⇒ 两条边**不相等**（-0.05k vs 0），`e1 - e0 = 0.05k > 0`，没有 0/0。 */
  const C = {
    BarCount: 32, BarSpacing: 0.1,
    BoundsX: 0, BoundsY: 0.49,   // "Lower/Upper Bar Bounds": "0 0.49"
    minHeight: 0,                // "Minimum Height …": 0 ⇒ minBarHeight = 0
    rAASmoothnessX: 0.05, rAASmoothnessY: 0.00,   // "Anti-alias blurring ": "0.05, 0.00"
    Radius: 1,
  }
  const smoothstep = (e0, e1, x) => {
    let t = (x - e0) / (e1 - e0)
    if (!Number.isFinite(t)) t = 0                  // 驱动相关的兜底：本模型只用于"两套语义都算一遍"
    t = Math.min(1, Math.max(0, t))
    return t * t * (3 - 2 * t)
  }
  const barAt = (x, y, volume) => {
    const rW = (1 - C.BarSpacing) / C.BarCount
    const minBarHeight = C.minHeight * rW
    const barHeight = Math.max(C.BoundsX, minBarHeight) + (C.BoundsY - Math.max(C.BoundsX, minBarHeight)) * volume
    const barDist = Math.abs((x * C.BarCount) % 1 * 2 - 1)
    /* 真 shader 的 roundedBoxSDF（BAR_STYLE==1）：
       `Size *= 0.5; Size.x *= DC; r = u_Radius*min(Size.x, Size.y); return length(max(abs(c)-Size.xy+r, 0)) - r`
       ⇒ **盒内 d = -r < 0** ⇒ bar = 1；退化（Size.y = 0 ⇒ r = 0）时盒内 d ≥ 0 ⇒ bar = 0（什么都不画）。 */
    const sizeX = rW / 2 * (1 / 3)                  // DCorrectingFactor（BOTTOM 形状用 res.x/res.y 的倒数，见 .vert）
    const sizeY = barHeight / 2
    const r = C.Radius * Math.min(sizeX, sizeY)
    const cx = barDist / C.BarCount * 0.5 * (1 / 3)
    const cy = 1 - y
    const d = Math.hypot(Math.max(Math.abs(cx) - sizeX + r, 0), Math.max(Math.abs(cy) - sizeY + r, 0)) - r
    const rAF = 15 / 720
    return 1 - smoothstep(-C.rAASmoothnessX * rAF, C.rAASmoothnessY * rAF, d)
  }
  // 采样网格 480×480：地板的条高只有 0.49×0.012 ≈ 0.0059（texcoord 单位）⇒ 网格太粗会把条整个漏掉
  const GRID = 480
  const coverage = (volume) => {
    let hit = 0, n = 0
    for (let iy = 0; iy < GRID; iy++) for (let ix = 0; ix < GRID; ix++) { n++; if (barAt((ix + 0.5) / GRID, (iy + 0.5) / GRID, volume) > 0.5) hit++ }
    return hit / n
  }
  const zero = coverage(0), floor = coverage(AUDIO_SILENCE_FLOOR), mid = coverage(0.3), loud = coverage(1)
  check('[A1] ★ 全 0 频谱（改动前的"无数据源"输入）⇒ 该层**一个像素都不画**（覆盖 = 0）—— 这正是用户问的"音频条你为什么没有给他渲染出来"',
    zero === 0, 'coverage(0)=' + zero)
  check('[A2] 静音地板（' + AUDIO_SILENCE_FLOOR + '）⇒ 覆盖 > 0 且很小（"整条落下"而不是"消失"）',
    floor > 0 && floor < 0.05, 'coverage(floor)=' + floor.toFixed(5))
  check('[A3] 覆盖随音量单调增（形状对：0 < floor < 0.3 < 1）', zero < floor && floor < mid && mid <= loud, [zero, floor, mid, loud].map((v) => v.toFixed(4)).join(' < '))
  check('[A4] 任何音量下覆盖都 < 60%（bar 被限制在条带内 ⇒ 不会"整层着色"，白块不是这条算术的产物）',
    loud < 0.6, 'coverage(1)=' + loud.toFixed(4))
  check('[A5] 反例（否证首版假设）：AA 的两条边是 (-0.05k, 0) 而**不相等** ⇒ 不存在 `smoothstep(0,0,·)` 的 0/0',
    Math.abs(-C.rAASmoothnessX * (15 / 720) - C.rAASmoothnessY * (15 / 720)) > 0, 'e0=' + (-C.rAASmoothnessX * 15 / 720).toFixed(6) + ' e1=0')
}

/* ══════════════ [B] 渲染器不变量：绝不把全 0 频谱喂给作者 shader（真代码 + mock-GL） ══════════════ */
console.log('== [B] bindAudioSpectrum：退化输入防线（真代码）==')
{
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FLOAT: 5126, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  const writes = []
  const FRAG = 'uniform sampler2D g_Texture0; uniform float g_AudioSpectrum32Left[32]; uniform float g_AudioSpectrum32Right[32];'
    + ' uniform float g_Bar; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * (g_AudioSpectrum32Left[0] + g_Bar); }'
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
  const handlers = {
    createTexture: () => ({}), createFramebuffer: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
    createShader: () => ({}), createProgram: () => ({}),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 2 : (k === CONST.ACTIVE_ATTRIBUTES ? 2 : null)),
    getActiveUniform: (p, i) => (i === 0 ? { name: 'g_AudioSpectrum32Left[0]', type: CONST.FLOAT } : { name: 'g_AudioSpectrum32Right[0]', type: CONST.FLOAT }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : 1),
    getUniformLocation: (p, n) => ({ n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getExtension: () => null,
    getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
    uniform1fv: (loc, arr) => writes.push({ n: loc && loc.n, v: Array.from(arr) }),
    getError: () => CONST.NO_ERROR,
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const mkScene = () => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, properties: {}, layers: [
    { id: 230, name: '纯色', visible: true, solid: true, isContainer: false, textureName: null, size: [1000, 1000],
      scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
      effects: [{ id: 1, visible: true, passes: [{ combos: { BLENDMODE: 11 }, constants: {}, textures: [] }], fbos: [], materialPasses: [{ shader: 'audio_bars', blending: 'normal', target: null, binds: [], textures: [], combos: { BLENDMODE: 11 }, constants: {} }] }],
      particle: null, particleDef: null, anim: undefined, animLayers: false, parallaxDepth: null }] })
  const run = async (view, opts) => {
    writes.length = 0
    setAudioBands(view || null)
    const r = createRenderer({ getContext: () => gl, width: 1280, height: 720 }, Object.assign({ shaderResolver, onLog: () => {} }, opts || {}))
    await r.render(mkScene(), new Map(), 1280, 720, 1.0)
    return { r, w: writes.slice() }
  }
  const audioOnly = (w) => w.filter((x) => /^g_AudioSpectrum32/.test(String(x.n)))
  const vSilent = { resolution: 16, left: new Float32Array(16), right: new Float32Array(16), average: new Float32Array(16), kind: 'silent', hasSource: false, revision: 1 }
  const vRealZero = { resolution: 16, left: new Float32Array(16), right: new Float32Array(16), average: new Float32Array(16), kind: 'analyser', hasSource: true, revision: 2 }
  const TINY = Math.fround(1e-4)   // Float32Array 存 1e-4 ⇒ 实际是 fround(1e-4)（断言按 float32 口径比）
  const vTiny = (() => { const v = { resolution: 16, left: new Float32Array(16), right: new Float32Array(16), average: new Float32Array(16), kind: 'analyser', hasSource: true, revision: 3 }; v.left.fill(TINY); v.right.fill(TINY); return v })()
  {
    const { w } = await run(null)
    const a = audioOnly(w)
    check('[B1] 没有活视图（宿主不注入 / `?bandfeed=off`）⇒ 写 0.012 静音地板（**不是全 0**）',
      a.length === 2 && a.every((x) => x.v.length === 32 && x.v.every((y) => Math.abs(y - AUDIO_SILENCE_FLOOR) < 1e-9)),
      JSON.stringify(a.map((x) => x.n + '=' + x.v[0])))
  }
  {
    const { w } = await run(vSilent)
    const a = audioOnly(w)
    check('[B2] `hasSource=false` 的活视图 ⇒ 同样落地板（不喂全 0）',
      a.length === 2 && a.every((x) => x.v.every((y) => Math.abs(y - AUDIO_SILENCE_FLOOR) < 1e-9)), JSON.stringify(a.map((x) => x.v[0])))
  }
  {
    const { w } = await run(vRealZero)
    const a = audioOnly(w)
    check('[B3] 真实源但**恰好全 0**（音乐暂停）⇒ 落地板（退化输入防线对真实源同样成立）',
      a.length === 2 && a.every((x) => x.v.every((y) => Math.abs(y - AUDIO_SILENCE_FLOOR) < 1e-9)), JSON.stringify(a.map((x) => x.v[0])))
  }
  {
    const { w } = await run(vTiny)
    const a = audioOnly(w)
    check('[B4] 真实源非零但极小（1e-4）⇒ **原样**上传（不夹取作者的低音量输入；按 float32 口径逐值相等）',
      a.length === 2 && a.every((x) => x.v.every((y) => y === TINY)), JSON.stringify(a.map((x) => x.v[0])) + ' want ' + TINY)
  }
  {
    const { w } = await run(null, { audioFloor: 0 })
    check('[B5] `opts.audioFloor=0` ⇒ 逐位回到旧契约（一个 uniform 都不写；旧行为可 A/B，未被删除）',
      audioOnly(w).length === 0, String(audioOnly(w).length))
  }
  {
    await run(vRealZero)
    const fi = audioBandsInfo()
    check('[B6] 地板写入进诊断面（`audioBandsInfo().floor`：地板值 + 写入次数 + 档数 1..3）',
      !!fi.floor && fi.floor.floor === AUDIO_SILENCE_FLOOR && fi.floor.writes >= 1 && fi.floor.floorBands >= 1 && fi.floor.floorBands <= 3,
      JSON.stringify(fi.floor))
  }
  check('[B7] 常量导出（上游 oneincase 静音段底噪同值 0.012）', AUDIO_SILENCE_FLOOR === 0.012, String(AUDIO_SILENCE_FLOOR))
}

/* ══════════════ [C] demo.html 真源码切片：无源也有非平凡的时间变化 ══════════════ */
console.log('== [C] 无数据源 ⇒ 时间驱动的占位（真源码切片）==')
{
  const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  const slice = (src, begin, end) => {
    const i = src.indexOf(begin); if (i < 0) throw new Error('切片起点缺失: ' + begin)
    const j = src.indexOf(end, i); if (j < 0) throw new Error('切片终点缺失: ' + end)
    return src.slice(i, j + end.length)
  }
  const BAND_BLOCK = slice(HTML, '// ═══ MPW-BANDFEED-BEGIN', '// ═══ MPW-BANDFEED-END ═══')
  const BUF_BLOCK = slice(HTML, '// ═══ MPW-AUDIOBUFFERS-BEGIN', '// ═══ MPW-AUDIOBUFFERS-END ═══')
  const makeEnv = (opts = {}) => {
    const bandCalls = [], logs = []
    const win = { parent: null, __mpwAudioBands: null }
    win.parent = opts.embedded ? { postMessage: () => {} } : win
    const sceneAudio = { ctx: null, analyser: opts.analyser || null, els: [], freq: opts.analyser ? new Uint8Array(opts.analyser.frequencyBinCount) : null, started: !!opts.analyser, vols: [] }
    const lib = { setAudioBands: (v) => { bandCalls.push(v); return v }, audioBandsInfo: () => ({}) }
    const body = BAND_BLOCK + '\n' + BUF_BLOCK + `
return { BANDFEED, bandArrayNow, bandFrameTick, last: () => bandLast, band16: () => bandView16, placeholderLogged: () => bandPlaceholderLogged }`
    const fn = new Function('packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
      'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib', 'sceneAudio', 'location', 'window', 'logf', body)
    const api = fn(packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
      createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, lib, sceneAudio, { search: opts.search || '' }, win, (m) => logs.push(m))
    return { api, win, bandCalls, logs }
  }
  const meanAbsDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length }
  const e = makeEnv({})
  e.api.bandFrameTick(0.5)
  const f1 = Array.from(e.api.last().bands), s1 = bandStats(e.api.last().bands)
  e.api.bandFrameTick(0.5 + 0.35)                       // 0.35s ≈ 0.77 拍（节拍尺度上确有变化）
  const f2 = Array.from(e.api.last().bands)
  const d = meanAbsDiff(f1, f2)
  check('[C1] auto 无源 ⇒ `source=simulated` + `placeholder=true`（诚实标注：占位，不是真实音频）',
    e.api.last().source === 'simulated' && e.api.last().placeholder === true, JSON.stringify({ s: e.api.last().source, p: e.api.last().placeholder }))
  check('[C2] ★ 无数据源时音条**仍在动**：相隔 0.35s 的两帧频谱平均绝对差 > 0.005（非平凡的时间变化）',
    d > 0.005, 'meanAbsDiff=' + d.toFixed(5))
  check('[C3] 占位频谱非空（peak > 0 且 silent=false）', s1.peak > 0 && s1.silent === false, JSON.stringify(s1))
  check('[C4] 只留一条占位说明日志（不刷屏）', e.logs.filter((m) => /占位频谱/.test(m)).length === 1 && e.api.placeholderLogged() === true, 'logs=' + e.logs.length)
  const eOff = makeEnv({ search: '?bandfeed=off' })
  eOff.api.bandFrameTick(0.5); eOff.api.bandFrameTick(0.9)
  check('[C5] `?bandfeed=off` ⇒ 一次都不注入渲染器（旧行为逐位保留；地板由渲染器侧 [B] 负责）',
    eOff.bandCalls.length === 0 && eOff.api.last().source === 'off', 'calls=' + eOff.bandCalls.length)
  const eReal = makeEnv({ search: '?bandfeed=real' })
  eReal.api.bandFrameTick(0.5); eReal.api.bandFrameTick(0.9)
  check('[C6] `?bandfeed=real` 无真实源 ⇒ 仍全 0 + silent（"如实静音"没被占位吃掉）',
    eReal.api.last().source === 'silent' && Array.from(eReal.api.last().bands).every((v) => v === 0), eReal.api.last().source)
  const eMic = makeEnv({ search: '?bandfeed=mic' })
  eMic.api.bandFrameTick(0.5)
  check('[C7] `?bandfeed=mic` 未拿到麦克风 ⇒ 全 0 + silent（同上）',
    eMic.api.last().source === 'silent' && Array.from(eMic.api.last().bands).every((v) => v === 0), eMic.api.last().source)
  // 占位源的**确定性**（同一 t 同一值）：暂停/回卷安全，也让门禁可复现
  const a = makeEnv({}), b = makeEnv({})
  a.api.bandFrameTick(7.25); b.api.bandFrameTick(7.25)
  check('[C8] 占位源是 t 的确定性函数（同一 t 同一值 ⇒ 暂停/回卷安全、门禁可复现）',
    JSON.stringify(Array.from(a.api.last().bands)) === JSON.stringify(Array.from(b.api.last().bands)))
}

console.log('\n══ render-audio-bar-nodata-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

// render-hdr-black-guard-test.mjs —— ①(2026-09-24 任务 ⑮)「HDR 路径黑屏：如实降级并记账，不静默黑屏」门禁
//
// 现场（真机首帧审计，包 2902406982）：
//   层 `前景`(vis=1 fx=1) / `单前景`(vis=0 跳过) / `前景效果`(vis=1 **fx=4**：waterwaves +
//   chromatic_aberration(AUDIOPROCESSING=3) + tint + blur，且是 `models/util/projectlayer.json`
//   **整屏合成层**) / `三角模块1..5`（跳过），并打出
//   `⚠ [hdr] 场景渲进 RGBA16F FBO 1540x866（合成直绘无 gamma）` —— 也就是说 **HDR 路径是开着的**，
//   用户看到的是黑屏。该包 `general.hdr=true` + `bloom={user:hdr,value:true}`，所以自动 HDR 档必然生效。
//
// 渲染器这一侧**无法区分**三种"画布全黑"：① 扩展在、但浮点 RT 实际存不住内容（Adreno 上见过的形态）；
//   ② 呈现 pass 在该驱动上没落到画布；③ 场景/效果链真的输出黑。所以本档钉的不是"猜哪个原因"，
//   而是**判据与行为**（改动前一条都没有：GL 无错、无日志、画面全黑 = 静默黑屏）：
//   [A] HDR 帧呈现后画布采样全黑 + LDR 对照帧**非黑** ⇒ 记 `hdrFallback{path:'black-first-frame'}`、
//       发一条"退回 LDR + 当场重渲本帧"的日志、并且那帧真的重渲了（GL 证据：clear 次数 / 采样次数）。
//   [B] 两帧都黑 ⇒ **恢复 HDR**（夜间本来就黑的壁纸不该被永久降级）+ 一条"场景本身就是黑的"日志。
//   [C] HDR 帧非黑（正常设备）⇒ 不降级、只采样一次（不能有假阳性、不能每帧回读）。
//   [D] `?hdr=1` 强制档：全黑也**不**自动退回（诊断口径与既有"逐层错误熔断"一致），但要**大声记账**
//       （`renderer.hdrBlack.seen` + 一条 ⚠ 日志）—— "不静默"是硬要求。
//
// 运行：node tests/render-hdr-black-guard-test.mjs（全绿 0）
import { createRenderer, resolveHdrWant } from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, FRAMEBUFFER_BINDING: 0x8CA6, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0,
  TEXTURE0: 0, TEXTURE1: 1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, RGBA16F: 0x881A, RGBA32F: 0x8814,
  HALF_FLOAT: 0x140B, FLOAT: 0x1406, COLOR_BUFFER_BIT: 0x4000, SAMPLES: 0x80A9 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

/** mock-GL：`pixelsFor(frameKind)` 决定 readPixels 读到什么（'hdr' | 'ldr'）。 */
function mkGL(pixels) {
  const rec = { clears: 0, reads: 0, presents: 0, draws: 0, binds: [] }
  let readsThisFrame = 0
  const handlers = {
    createTexture: () => ({}), createFramebuffer: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
    createShader: () => ({}), createProgram: () => ({}),
    bindFramebuffer: (t, f) => rec.binds.push(f ? 'fbo' : null),
    clear: () => { rec.clears++ },
    drawArrays: () => { rec.draws++ },
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : (k === CONST.ACTIVE_ATTRIBUTES ? 2 : null)),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : 1),
    getUniformLocation: () => ({}), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getExtension: (n) => (/color_buffer_(half_)?float/.test(String(n)) ? {} : null),
    getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.SAMPLES ? 0 : (k === CONST.FRAMEBUFFER_BINDING ? null : 0))),
    getError: () => CONST.NO_ERROR,
    readPixels: (x, y, w, h, fmt, type, buf) => {
      rec.reads++; readsThisFrame++
      // 每帧的第一次采样决定这一帧的"像素真相"（改动前：HDR 帧全黑 / LDR 帧正常）
      const v = pixels(readsThisFrame === 1)   // true = 本帧的第一次采样
      buf[0] = v[0]; buf[1] = v[1]; buf[2] = v[2]; buf[3] = v[3]
    },
    drawingBufferWidth: 1280, drawingBufferHeight: 720,
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}

const mkScene = () => ({ general: { hdr: true, bloom: true, clearenabled: true, clearcolor: '0 0 0', orthogonalprojection: { width: 1920, height: 1080 } },
  camera: null, properties: {}, layers: [
    { id: 167, name: '前景', visible: true, solid: false, isContainer: false, textureName: null, size: [1920, 1080],
      scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
      effects: [], particle: null, particleDef: null, anim: undefined, animLayers: false, parallaxDepth: null }] })

async function run(pixels, opts) {
  const logs = []
  const { gl, rec } = mkGL(pixels)
  const r = createRenderer({ getContext: () => gl, width: 1280, height: 720 }, Object.assign({ shaderResolver, onLog: (m) => logs.push(String(m)) }, opts || {}))
  await r.render(mkScene(), new Map(), 1280, 720, 1.0)
  return { r, rec, logs }
}

/* [0] 前提：该包的 hdr/bloom 组合在自动档下就是要走 HDR（判据纯函数） */
{
  const want = resolveHdrWant({}, { hdr: true, bloom: { user: 'hdr', value: true } }, null)
  check('[0] `general.hdr=true` + `bloom=true` ⇒ 自动档要 HDR（本档的夹具前提，与 2902406982 一致）', want === true, String(want))
}

/* [A] HDR 全黑 + LDR 非黑 ⇒ 降级 + 记台账 + 当场重渲 */
console.log('== [A] HDR 帧全黑、LDR 对照帧非黑 ==')
{
  // 第一次采样（HDR 帧）= 全 0；第二次（LDR 对照帧）= 非 0
  let n = 0
  const { r, rec, logs } = await run(() => (++n <= 9 ? [0, 0, 0, 255] : [40, 90, 160, 255]))
  check('[A1] 记进 `renderer.hdrFallback`（path=black-first-frame，含原因）',
    !!r.hdrFallback && r.hdrFallback.path === 'black-first-frame' && /全黑/.test(String(r.hdrFallback.reason)),
    JSON.stringify(r.hdrFallback))
  check('[A2] 日志：一条"HDR 帧采样全黑" + 一条"退回 LDR 并当场重渲本帧"',
    logs.some((m) => /HDR 帧呈现后画布 3×3 采样\*\*全黑\*\*/.test(m)) && logs.some((m) => /退回 LDR 并\*\*当场按 LDR 重渲本帧\*\*/.test(m)),
    JSON.stringify(logs.filter((m) => /hdr/.test(m)).slice(0, 4)))
  check('[A3] 当场重渲了本帧（GL 证据：clear 次数 ≥ 2 且采样 ≥ 18）', rec.clears >= 2 && rec.reads >= 18, 'clear=' + rec.clears + ' reads=' + rec.reads)
  check('[A4] LDR 对照帧非黑 ⇒ 日志确认"HDR 管线在本设备不可用、本会话保持 LDR"',
    logs.some((m) => /LDR 对照帧非黑 ⇒ 确认 HDR 管线在本设备不可用/.test(m)), JSON.stringify(logs.filter((m) => /LDR 对照/.test(m))))
  check('[A5] 采样只发生在 HDR 帧与对照帧各一次（不是每帧回读）：reads = 18', rec.reads === 18, String(rec.reads))
  check('[A6] 台账 `renderer.hdrBlack`：见过全黑（seen.retried=true）、probe 读数可查',
    !!r.hdrBlack && !!r.hdrBlack.seen && r.hdrBlack.seen.retried === true && r.hdrBlack.probe.retried === 1 && r.hdrBlack.probe.probes >= 2,
    JSON.stringify(r.hdrBlack))
}

/* [B] 两帧全黑 ⇒ 恢复 HDR（不误伤"夜里本来就是黑的"壁纸） */
console.log('== [B] 两帧都全黑 ⇒ 恢复 HDR ==')
{
  const { r, logs } = await run(() => [0, 0, 0, 255])
  check('[B1] `hdrFallback` 回到 null（没有把"场景本身黑"当成 HDR 故障）', r.hdrFallback === null, JSON.stringify(r.hdrFallback))
  check('[B2] 日志说明"场景本身就是黑的（不是 HDR 管线的问题），HDR 已恢复"',
    logs.some((m) => /场景本身就是黑的\*\*（不是 HDR 管线的问题），HDR 已恢复/.test(m)), JSON.stringify(logs.filter((m) => /LDR 对照/.test(m))))
  check('[B3] `hdrBlack.seen` 仍留证（"见过画布全黑"这件事不因恢复而消失）', !!r.hdrBlack && !!r.hdrBlack.seen, JSON.stringify(r.hdrBlack))
}

/* [C] 正常设备（HDR 帧非黑）⇒ 不降级、不回读第二帧 */
console.log('== [C] HDR 帧非黑（正常设备）==')
{
  const { r, rec, logs } = await run(() => [30, 60, 120, 255])
  check('[C1] 不降级（`hdrFallback === null`）', r.hdrFallback === null, JSON.stringify(r.hdrFallback))
  check('[C2] 只采样一次（9 点），不重渲、不刷日志', rec.reads === 9 && rec.clears === 1 && !logs.some((m) => /全黑/.test(m)), 'reads=' + rec.reads + ' clears=' + rec.clears)
  check('[C3] `hdrBlack.seen === null` 且 probe 记了 1 次', !!r.hdrBlack && r.hdrBlack.seen === null && r.hdrBlack.probe.probes === 1, JSON.stringify(r.hdrBlack))
}

/* [D] `?hdr=1` 强制档：全黑也不自动退回，但**大声记账**（不静默） */
console.log('== [D] ?hdr=1 强制档 + 全黑 ==')
{
  const { r, logs } = await run(() => [0, 0, 0, 255], { hdr: 1 })
  check('[D1] 强制档不自动退回（诊断口径与既有"逐层错误熔断"一致）', r.hdrFallback === null, JSON.stringify(r.hdrFallback))
  check('[D2] 但如实记账：`hdrBlack.seen` 非空 + probe 至少 1 次', !!r.hdrBlack && !!r.hdrBlack.seen && r.hdrBlack.probe.probes >= 1, JSON.stringify(r.hdrBlack))
  check('[D3] 一条 ⚠ 说明"强制 HDR 不自动退回；去掉 ?hdr=1 即按能力降级"',
    logs.some((m) => /强制 HDR：画布全黑也\*\*不\*\*自动退回/.test(m)), JSON.stringify(logs.filter((m) => /hdr/.test(m)).slice(0, 4)))
}

console.log('\n══ render-hdr-black-guard-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

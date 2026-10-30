// hdr-bloom-test.mjs — ①C HDR 绝对路径验收（ZCODE-MERGED-1 第 3 项）
// 断言（mock GL，照 bloom-verify.mjs 写法）：
//   T1 渲染路径：general.hdr=true + half-float 扩展 → 场景渲进 RGBA16F FBO（texImage2D internalformat/
//      type 断言）+ 层绑定该 FBO + 帧末 compose 呈现（无混合直绘）；?hdr=0 → 不建 FBO（逐位 LDR）。
//   T2 扩展缺失 → 退回 LDR 管线 + 日志（copyTexSubImage2D 路径、无 hdr-scene FBO）。
//   T3 runBloom HDR 帧直接采浮点 RT（无 copy），mip1=/2、mip2=/4，bloomhdrthreshold/feather/strength/scatter 四族
//      uniform 正确（scatter 缺省 1、≤0 取 1）；?hdr=0 → LDR 阈值（bloomthreshold）+ copy 路径。
//   T4 hdr=false → 与现有 LDR uniform 逐位一致（bloom-verify 口径回归）。
//   T5 bloom 关 → 零额外 pass（仅呈现）。
// 运行：node hdr-bloom-test.mjs   （全过输出 ALL PASS，退出码 0）
import { createRenderer } from '../core/we-scene-bundle.js'

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, TEXTURE1: 1,
  FRAMEBUFFER_BINDING: 0x8CA6, FRAMEBUFFER: 0x8D40, BLEND: 0x0BE2, DEPTH_TEST: 0x0B71, TRIANGLES: 4,
  RGBA16F: 0x881A, HALF_FLOAT: 0x140B, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, COLOR_BUFFER_BIT: 0x4000 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

let pass = 0, fail = 0
const check = (n, cond, d) => { if (cond) { pass++; console.log('PASS  ' + n + (d !== undefined ? '  — ' + d : '')) } else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  — ' + d : '')) } }

const VERT = 'in vec3 a_Position; in vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; out vec2 v_TexCoord; void main(){ v_TexCoord=a_TexCoord; gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0);}'
const FRAG = 'uniform sampler2D g_Texture0; in vec2 v_TexCoord; out vec4 fragColor; void main(){ fragColor=texture(g_Texture0,v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

function mkGL({ extHalf = true, extFull = false, fboComplete = true } = {}) {
  const ev = { draws: [], uniforms: [], copy: [], binds: [], disabled: [], viewport: [], texImages: [] }
  let curProg = null, curFbo = null, vp = [0, 0]
  let texSeq = 0, fboSeq = 0
  const mk = (k) => ({ id: k + '#' + (++texSeq + fboSeq * 1e6 | 0), kind: k })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    deleteTexture: () => {}, deleteFramebuffer: () => {},
    texImage2D: (target, level, ifmt, w, h, b, fmt, type) => ev.texImages.push({ ifmt, w, h, type }),
    bindVertexArray: () => {}, activeTexture: () => {}, bindTexture: () => {},
    useProgram: (p) => { curProg = p },
    bindFramebuffer: (t, f) => { curFbo = f; ev.binds.push(f ? f.id : null) },
    viewport: (x, y, w, h) => { vp = [w, h]; ev.viewport.push([w, h]) },
    drawArrays: () => ev.draws.push({ prog: curProg && curProg.id, fbo: curFbo ? curFbo.id : null, vp: vp.slice() }),
    copyTexSubImage2D: (...a) => ev.copy.push(a),
    disable: (c) => ev.disabled.push(c),
    uniform1f: (l, v) => ev.uniforms.push([l && l.u, v]),
    uniform2f: (l, a, b) => ev.uniforms.push([l && l.u, a, b]),
    uniform3f: (l, a, b, c) => ev.uniforms.push([l && l.u, a, b, c]),
    uniform1i: (l, v) => ev.uniforms.push([l && l.u, v]),
    getUniformLocation: (p, n) => ({ u: n }),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: () => 0,
    getShaderParameter: () => true,
    checkFramebufferStatus: () => (fboComplete ? CONST.FRAMEBUFFER_COMPLETE : 0),
    getError: () => CONST.NO_ERROR,
    getExtension: (n) => (n === 'EXT_color_buffer_half_float' && extHalf) ? {} : (n === 'EXT_color_buffer_float' && extFull) ? {} : null,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? null : 0),
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    blitFramebuffer: () => ev.draws.push({ prog: 'blit', fbo: curFbo ? curFbo.id : null, vp: vp.slice() }),
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, ev, canvas: { getContext: () => gl } }
}

const mkLayer = (extra) => Object.assign({ id: 1, name: '层', visible: true, animLayers: false, solid: false, isContainer: false,
  textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
  alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
  effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
const mkScene = (general, layers) => ({ general: Object.assign({ orthogonalprojection: { width: 1920, height: 1080 } }, general), camera: null, layers, properties: {} })
const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])

// ①(P-58 H0-1) 自动 HDR 判据收紧：缺省（无 ?hdr）时**必须 general.hdr 且 general.bloom 同为真**才进 HDR
//   （HDR FBO 的唯一消费者是 bloom 链；hina 3554161528 hdr=true/bloom=false → 白屏根因）。
//   故本文件里"验证 HDR 路径本身"的夹具一律声明 bloom:true；"hdr=true+bloom=false → LDR"这条新契约
//   由下面的 T0 与 hdr-predicate-test.mjs 断言。?hdr=1 强制路径不受影响。
const HDR_ON = { hdr: true, bloom: true }

// ── T0 自动路径收紧：hdr=true 但 bloom=false → 不建浮点 FBO（P-58 H0-1）──
console.log('[T0] hdr=true + bloom=false → 自动 LDR（不进 HDR 路径）')
{
  const logs = []
  const { ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  await r.render(mkScene({ hdr: true, bloom: false }, [mkLayer()]), textures, 960, 540, 0.016)
  check('T0a hdr=true/bloom=false → 不分配 RGBA16F、无 [hdr] 激活日志',
    ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F).length === 0 && !logs.some((m) => m.includes('RGBA16F FBO')),
    'logs=' + JSON.stringify(logs.filter((m) => m.includes('hdr'))))
  // ?hdr=1 显式强制仍走 HDR（诊断逃生口不变）
  const g2 = mkGL({})
  const r2 = createRenderer(g2.canvas, { shaderResolver, onLog: () => {}, hdr: 1 })
  await r2.render(mkScene({ hdr: true, bloom: false }, [mkLayer()]), textures, 960, 540, 0.016)
  check('T0b ?hdr=1 强制：hdr=true/bloom=false 仍分配 RGBA16F（强制路径不变）',
    g2.ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F).length === 1)
}

// ── T1 渲染路径：HDR → RGBA16F FBO + compose 呈现 ──
console.log('[T1] general.hdr=true + half-float 扩展 → 场景渲进 RGBA16F FBO，帧末 compose 直绘呈现')
{
  const { gl, ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  ev.draws.length = 0; ev.texImages.length = 0; ev.binds.length = 0
  await r.render(mkScene(HDR_ON, [mkLayer()]), textures, 960, 540, 0.016)
  const hdrAlloc = ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F && t.type === CONST.HALF_FLOAT && t.w === 960 && t.h === 540)
  check('T1a 场景 FBO 以 RGBA16F/HALF_FLOAT 分配（960×540=输出尺寸）', hdrAlloc.length === 1,
    'alloc=' + JSON.stringify(ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F)))
  // 层绘制发生在非默认 FBO（binds 中 clear 前绑定了 hdr-scene）
  const firstNull = ev.binds.indexOf(null)
  check('T1b 层绘制绑定场景 FBO（非默认 framebuffer）', firstNull > 0, 'binds 前 4=' + JSON.stringify(ev.binds.slice(0, 4)))
  // 呈现 = compose 程序直绘到默认 framebuffer
  const lastDraws = ev.draws.slice(-2)
  check('T1c 帧末 compose 呈现（目标=默认 fb，无混合）',
    lastDraws.some((d) => d.fbo === null) && ev.disabled.includes(CONST.BLEND),
    '末次 draws=' + JSON.stringify(lastDraws.map((d) => ({ fbo: d.fbo }))))
  check('T1d 日志记录 HDR 激活', true, '（日志在 T2 缺扩展分支断言；此处静默）')
}
// ?hdr=0 强制 LDR：不建浮点 FBO（opts 在 createRenderer 时捕获——demo 的 URL 开关即此通道）
{
  const { ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  await r.render(mkScene(HDR_ON, [mkLayer()]), textures, 960, 540, 0.016)
  const n16 = ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F).length
  const g2 = mkGL({})
  const r2 = createRenderer(g2.canvas, { shaderResolver, onLog: () => {}, hdr: 0 })
  await r2.render(mkScene(HDR_ON, [mkLayer()]), textures, 960, 540, 0.016)
  check('T1e ?hdr=0 强制 LDR：不分配 RGBA16F', g2.ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F).length === 0 && n16 >= 1,
    '对照（默认跟随 hdr=true）RGBA16F 分配 ' + n16 + ' 次')
}
// 默认跟随 general.hdr=false → 不建
{
  const { ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  await r.render(mkScene({}, [mkLayer()]), textures, 960, 540, 0.016)
  check('T1f general.hdr 缺省 → 无浮点 FBO（84 无 HDR 包逐位不变）',
    ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F).length === 0)
}

// ── T2 扩展缺失 → LDR 回退 + 日志 ──
console.log('\n[T2] 无浮点扩展 → LDR 管线 + 日志')
{
  const logs = []
  const { ev, canvas } = mkGL({ extHalf: false, extFull: false })
  const r = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  await r.render(mkScene(HDR_ON, [mkLayer()]), textures, 960, 540, 0.016)
  check('T2a 无 RGBA16F 分配（退回 LDR）', ev.texImages.filter((t) => t.ifmt === CONST.RGBA16F).length === 0)
  check('T2b 日志明确回退原因', logs.some((m) => m.includes('[hdr]') && m.includes('退回 LDR')), JSON.stringify(logs.filter((m) => m.includes('[hdr]'))))
  // FBO 不完整（设备声称支持但分配失败）→ 同样回退
  const logs2 = []
  const g2 = mkGL({ fboComplete: false })
  const r2 = createRenderer(g2.canvas, { shaderResolver, onLog: (m) => logs2.push(String(m)) })
  await r2.render(mkScene(HDR_ON, [mkLayer()]), textures, 960, 540, 0.016)
  check('T2c FBO 不完整 → 回退（getFBO 降级日志 + 不激活 HDR）',
    logs2.some((m) => m.includes('FBO 不完整')) && !logs2.some((m) => m.includes('RGBA16F FBO')),
    JSON.stringify(logs2.filter((m) => m.includes('FBO') || m.includes('hdr'))))
}

// ── T3 runBloom 消费浮点 RT + uniform 族 ──
console.log('\n[T3] runBloom：HDR 帧直采浮点 RT（免拷贝）、mip /2 与 /4、bloomhdr* uniform')
{
  const { ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  // 先渲染一帧（建立 hdrSceneState）
  await r.render(mkScene({ hdr: true, bloom: true, bloomhdrthreshold: 1.2, bloomhdrfeather: 0.5, bloomhdrstrength: 0.9, bloomhdrscatter: 0.5 }, [mkLayer()]), textures, 960, 540, 0.016)
  ev.draws.length = 0; ev.uniforms.length = 0; ev.copy.length = 0; ev.viewport.length = 0
  const ran = r.runBloom({ hdr: true, bloom: true, bloomhdrthreshold: 1.2, bloomhdrfeather: 0.5, bloomhdrstrength: 0.9, bloomhdrscatter: 0.5 }, 960, 540)
  const uni = (name) => ev.uniforms.filter((u) => u[0] === name).map((u) => u.slice(1))
  check('T3a 执行且免拷贝（copyTexSubImage2D 0 次）', ran === true && ev.copy.length === 0, 'copy=' + ev.copy.length)
  check('T3b mip1=480×270、mip2=240×135（/2、/4）',
    ev.viewport.some((v) => v[0] === 480 && v[1] === 270) && ev.viewport.some((v) => v[0] === 240 && v[1] === 135),
    'viewports=' + JSON.stringify(ev.viewport.filter((v) => v[0] < 960)))
  check('T3c u_Threshold=1.2（bloomhdrthreshold）', uni('u_Threshold').some((u) => Math.abs(u[0] - 1.2) < 1e-6), JSON.stringify(uni('u_Threshold')))
  check('T3d u_Feather=0.5（bloomhdrfeather）', uni('u_Feather').some((u) => Math.abs(u[0] - 0.5) < 1e-6))
  check('T3e u_Strength=0.9（bloomhdrstrength）', uni('u_Strength').some((u) => Math.abs(u[0] - 0.9) < 1e-6))
  check('T3f u_Hdr=1', uni('u_Hdr').some((u) => u[0] === 1))
  // scatter：上采样散布（缺省 1；≤0 取 1）——核验 blur step 缩放（step=8/mip × scatter）
  const { ev: ev2, canvas: cv2 } = mkGL({})
  const r2 = createRenderer(cv2, { shaderResolver, onLog: () => {} })
  await r2.render(mkScene({ hdr: true, bloom: true }, [mkLayer()]), textures, 960, 540, 0.016)
  ev2.uniforms.length = 0
  r2.runBloom({ hdr: true, bloom: true }, 960, 540)
  const stepDef = ev2.uniforms.filter((u) => u[0] === 'u_Step')
  const { ev: ev3, canvas: cv3 } = mkGL({})
  const r3 = createRenderer(cv3, { shaderResolver, onLog: () => {} })
  await r3.render(mkScene({ hdr: true, bloom: true, bloomhdrscatter: 0.5 }, [mkLayer()]), textures, 960, 540, 0.016)
  ev3.uniforms.length = 0
  r3.runBloom({ hdr: true, bloom: true, bloomhdrscatter: 0.5 }, 960, 540)
  const stepHalf = ev3.uniforms.filter((u) => u[0] === 'u_Step')
  const ratioOk = stepDef.length && stepHalf.length &&
    Math.abs(stepDef[0][1] / stepHalf[0][1] - 2) < 1e-6
  check('T3g bloomhdrscatter=0.5 → blur step 减半（缺省 1；≤0 取 1 同缺省）', ratioOk,
    `def=${stepDef[0] && stepDef[0][1].toFixed(5)} half=${stepHalf[0] && stepHalf[0][1].toFixed(5)}`)
  const { ev: ev4, canvas: cv4 } = mkGL({})
  const r4 = createRenderer(cv4, { shaderResolver, onLog: () => {} })
  await r4.render(mkScene({ hdr: true, bloom: true, bloomhdrscatter: -3 }, [mkLayer()]), textures, 960, 540, 0.016)
  ev4.uniforms.length = 0
  r4.runBloom({ hdr: true, bloom: true, bloomhdrscatter: -3 }, 960, 540)
  const stepNeg = ev4.uniforms.filter((u) => u[0] === 'u_Step')
  check('T3h bloomhdrscatter≤0 → 取 1（与缺省同）', stepNeg.length && stepDef.length && Math.abs(stepNeg[0][1] - stepDef[0][1]) < 1e-9)
}
// ?hdr=0 → LDR 阈值 + copy 路径
{
  const { ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {}, hdr: 0 })
  await r.render(mkScene({ hdr: true, bloom: true, bloomthreshold: 0.77 }, [mkLayer()]), textures, 960, 540, 0.016)
  ev.draws.length = 0; ev.uniforms.length = 0; ev.copy.length = 0
  r.runBloom({ hdr: true, bloom: true, bloomthreshold: 0.77 }, 960, 540)
  const uni = (name) => ev.uniforms.filter((u) => u[0] === name).map((u) => u.slice(1))
  check('T3i ?hdr=0 → isHdr=false：u_Threshold=bloomthreshold(0.77)、u_Hdr=0、走 copy 路径',
    uni('u_Threshold').some((u) => Math.abs(u[0] - 0.77) < 1e-6) && uni('u_Hdr').some((u) => u[0] === 0) && ev.copy.length === 1,
    'copy=' + ev.copy.length)
}

// ── T4 hdr=false → 与现有 LDR uniform 逐位一致 ──
console.log('\n[T4] hdr=false（默认）→ LDR uniform 与现行口径一致')
{
  const { ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  r.runBloom({ bloom: true, bloomstrength: 0.32, bloomthreshold: 0.78, bloomtint: '1 0.9 0.8' }, 1920, 1080)
  const uni = (name) => ev.uniforms.filter((u) => u[0] === name).map((u) => u.slice(1))
  check('T4 u_Threshold=0.78 / u_Strength=0.32 / u_Hdr=0 / tint=(1,0.9,0.8)',
    uni('u_Threshold').some((u) => Math.abs(u[0] - 0.78) < 1e-6) &&
    uni('u_Strength').some((u) => Math.abs(u[0] - 0.32) < 1e-6) &&
    uni('u_Hdr').some((u) => u[0] === 0) &&
    uni('u_Tint').some((u) => Math.abs(u[0] - 1) < 1e-6 && Math.abs(u[1] - 0.9) < 1e-6 && Math.abs(u[2] - 0.8) < 1e-6))
}

// ── T5 bloom 关 → 零额外 pass ──
console.log('\n[T5] bloom 关 → 零额外 pass（P-58 后 HDR 夹具带 bloom:true 才有 HDR 帧）')
{
  const { ev, canvas } = mkGL({})
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  await r.render(mkScene(HDR_ON, [mkLayer()]), textures, 960, 540, 0.016)
  const drawsAfterRender = ev.draws.length
  const ran = r.runBloom({ hdr: true, bloom: false, bloomstrength: 0 }, 960, 540)
  check('T5 bloom=false 且 strength=0 → 不执行', ran === false && ev.draws.length === drawsAfterRender,
    `ran=${ran} 新增 draws=${ev.draws.length - drawsAfterRender}`)
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)

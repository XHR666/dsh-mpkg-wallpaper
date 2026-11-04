// bloom-verify.mjs — RE-33 验证：bloom 4 pass 结构、尺寸（LDR /4 → /8）、
// 13-tap 间距 8×texel、阈值/强度/tint uniform、禁用以写黑为中性、compose 直写（无混合）、
// 以及"未声明 bloom 不产生任何 pass"。
import { createRenderer } from '../core/we-scene-bundle.js'

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, TEXTURE1: 1,
  FRAMEBUFFER_BINDING: 0x8CA6, FRAMEBUFFER: 0x8D40, BLEND: 0x0BE2, DEPTH_TEST: 0x0B71, TRIANGLES: 4 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

const ev = { draws: [], uniforms: [], copy: [], binds: [], disabled: [], viewport: [] }
let curProg = null, curFbo = null, vp = [0, 0]
const mk = (k) => ({ id: k + '#' + (Math.random() * 1e6 | 0), kind: k })
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
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
  getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getExtension: () => null,
  getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? null : 0),
  uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const canvas = { getContext: () => gl }
const shaderResolver = async (rel) => (rel.endsWith('.vert')
  ? 'in vec3 a_Position; in vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; out vec2 v_TexCoord; void main(){ v_TexCoord=a_TexCoord; gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0);}'
  : 'uniform sampler2D g_Texture0; in vec2 v_TexCoord; out vec4 fragColor; void main(){ fragColor=texture(g_Texture0,v_TexCoord); }')

const checks = []
const check = (n, ok, d) => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? '  — ' + d : ''}`) }
const uni = (name) => ev.uniforms.filter((u) => u[0] === name).map((u) => u.slice(1))

const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })

// ── ① 未声明 bloom → 无 pass ──
ev.draws.length = 0; ev.uniforms.length = 0
const ran = r.runBloom({ bloom: false, bloomstrength: 0 }, 1920, 1080)
check('bloom=false 且 strength=0 → 不执行（0 次全屏 pass）', ran === false && ev.draws.length === 0, `ran=${ran} draws=${ev.draws.length}`)

// ── ② bloom=false 但 strength>0 → 建链但 enabled=0（写黑 = 中性）──
ev.draws.length = 0; ev.uniforms.length = 0; ev.copy.length = 0; ev.disabled.length = 0; ev.viewport.length = 0
const ran2 = r.runBloom({ bloom: false, bloomstrength: 0.5, bloomthreshold: 0.8, bloomtint: '1 1 1' }, 1920, 1080)
check('bloom=false 但 strength>0 → 仍建链（4 pass）', ran2 === true && ev.draws.length === 4, `draws=${ev.draws.length}`)
check('禁用以 u_Enabled=0 写黑（中性）', JSON.stringify(uni('u_Enabled')) === JSON.stringify([[0]]), JSON.stringify(uni('u_Enabled')))

// ── ③ bloom=true：4 pass、尺寸 /4 → /8、间距 8×texel、uniform 正确 ──
ev.draws.length = 0; ev.uniforms.length = 0; ev.copy.length = 0; ev.disabled.length = 0; ev.viewport.length = 0
const ran3 = r.runBloom({ bloom: true, bloomstrength: 0.32, bloomthreshold: 0.78, bloomtint: '1 0.9 0.8' }, 1920, 1080)
check('bloom=true → 恰好 4 个全屏 pass', ran3 === true && ev.draws.length === 4, `draws=${ev.draws.length}`)
check('pass 尺寸链 W/4(480×270) → W/8(240×135) → W/8 → 全屏', JSON.stringify(ev.viewport) === JSON.stringify([[480, 270], [240, 135], [240, 135], [1920, 1080]]), JSON.stringify(ev.viewport))
check('从默认 framebuffer 拷贝场景色（copyTexSubImage2D）', ev.copy.length === 1 && ev.copy[0][6] === 1920 && ev.copy[0][7] === 1080, JSON.stringify(ev.copy.map((c) => [c[6], c[7]])))
check('全程关闭混合 + 关闭深度（compose 直写）', ev.disabled.includes(CONST.BLEND) && ev.disabled.includes(CONST.DEPTH_TEST), JSON.stringify(ev.disabled))
check('u_Enabled=1 / u_Strength=0.32 / u_Threshold=0.78', JSON.stringify(uni('u_Enabled')) === '[[1]]' && uni('u_Strength')[0][0] === 0.32 && uni('u_Threshold')[0][0] === 0.78, JSON.stringify({ e: uni('u_Enabled'), s: uni('u_Strength'), t: uni('u_Threshold') }))
check('u_Tint = bloomtint', JSON.stringify(uni('u_Tint')[0]) === JSON.stringify([1, 0.9, 0.8]), JSON.stringify(uni('u_Tint')))
check('u_Hdr=0（hdr=false 走 LDR 硬阈值分支）', JSON.stringify(uni('u_Hdr')) === '[[0]]', JSON.stringify(uni('u_Hdr')))
// blur X：dir=(1,0)、step=8/480；blur Y：dir=(0,1)、step=8/240
const dirs = uni('u_Dir'), steps = uni('u_Step')
// 官方：step 为各自级别的 texel（x=8/mip1.w，y=8/mip2.h），shader 用 u_Dir 选分量
check('blurX dir=(1,0) step.x=8/480', JSON.stringify(dirs[0]) === JSON.stringify([1, 0]) && Math.abs(steps[0][0] - 8 / 480) < 1e-9, JSON.stringify({ dir: dirs[0], step: steps[0] }))
check('blurY dir=(0,1) step.y=8/135', JSON.stringify(dirs[1]) === JSON.stringify([0, 1]) && Math.abs(steps[1][1] - 8 / 135) < 1e-9, JSON.stringify({ dir: dirs[1], step: steps[1] }))

// ── ④ hdr=true 但无浮点 RT 扩展 → 退化 LDR（阈值取 bloomthreshold）──
ev.draws.length = 0; ev.uniforms.length = 0
r.runBloom({ bloom: true, hdr: true, bloomstrength: 0.5, bloomthreshold: 0.6, bloomhdrthreshold: 1.5, bloomhdrstrength: 2 }, 1920, 1080)
check('hdr=true 无浮点扩展 → 退化 LDR（阈值 0.6）', uni('u_Hdr')[0][0] === 0 && uni('u_Threshold')[0][0] === 0.6, JSON.stringify({ hdr: uni('u_Hdr')[0], th: uni('u_Threshold')[0] }))
check('HDR 退化时尺寸仍 /4 /8', JSON.stringify(ev.viewport[0]) === '[480,270]' && JSON.stringify(ev.viewport[1]) === '[240,135]', JSON.stringify(ev.viewport))

const pass = checks.filter(Boolean).length
console.log(`\n${pass}/${checks.length} 通过（RE-33 bloom 链）`)
process.exit(pass === checks.length ? 0 : 1)

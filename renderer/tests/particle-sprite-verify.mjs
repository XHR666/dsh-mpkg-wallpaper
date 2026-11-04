// particle-sprite-verify.mjs — RE-31 端到端验证：粒子层精灵表帧动画（真实 .tex TEXS → 顶点 UV）
// 断言：
//   ① 精灵表粒子层的 quad 纵横比 = 帧纵横比 rate（官方 g_RenderVar1.w）；
//   ② SEQUENCE 模式：帧值 (1−lifetime/init)×mult → 帧索引随时间推进（跨行按行主序进位）；
//   ③ randomframe（RANDOMONE）：同一粒子终身固定帧，不同粒子可不同帧；
//   ④ flags bit2（spritenoframeblending）或 randomframe → blend 顶点属性恒 0；
//   ⑤ 非精灵纹理：UV 恒为整图 0..1 角点（不回归）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

const events = { draw: [], buffer: [] }
let curProg = null
const mk = (kind) => ({ id: kind + '#' + (Math.random() * 1e6 | 0) })
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: () => {}, activeTexture: () => {}, bindTexture: () => {}, useProgram: (p) => { curProg = p },
  vertexAttribPointer: () => {},
  bufferData: (target, data, usage) => { events.buffer.push(data && data.length ? Float32Array.from(data) : data) },
  drawArrays: (m, f, c) => events.draw.push({ prog: curProg && curProg.id, count: c }),
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
  getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_TexCoordB' ? 2 : n === 'a_Blend' ? 3 : n === 'a_Alpha' ? 4 : -1,
  getUniformLocation: () => ({ u: 1 }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
  uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const canvas = { getContext: () => gl }
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG1 = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG1)

const checks = []
const check = (name, cond, detail) => { checks.push({ name, ok: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// 真实精灵表：官方 fog1.tex（64 帧 8×8）
const FOG = `${MPW_WS}/wallpaper_engine/assets/materials/particle/fog/fog1.tex`
const fogTex = lib.parseTex(new Uint8Array(fs.readFileSync(FOG)))
const fogSprite = lib.spriteInfo(fogTex)
check('加载官方 fog1 精灵表', !!fogSprite && fogSprite.numFrames === 64, fogSprite ? `${fogSprite.numFrames}帧 ${fogSprite.cols}x${fogSprite.rows} rate=${fogSprite.rate}` : 'null')

function mkLayer(extra) {
  return Object.assign({ id: 1, name: '粒子层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
}
const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })

// 从 batch 顶点缓冲提取每个粒子的 (u,v,uvB,blend)（每粒子 6 顶点 × 9 float）
function particleAttrs() {
  const buf = events.buffer.filter((b) => b && b.length && b.length % 54 === 0 && b.length >= 54).pop()
  if (!buf) return null
  const out = []
  for (let p = 0; p < buf.length / 54; p++) {
    const o = p * 54
    out.push({ u: buf[o + 3], v: buf[o + 4], uB: buf[o + 5], vB: buf[o + 6], blend: buf[o + 7], alpha: buf[o + 8], w: buf[o + 6 - 3], x0: buf[o], y0: buf[o + 1] })
  }
  return out
}
// 顶点里横向/纵向尺寸（用于校验 rate）：取第 0 与第 1 顶点、第 0 与第 2 顶点
function quadExtent(buf, projW, projH) {
  if (!buf || buf.length < 54) return null
  // 6 顶点顺序：(-1,-1)(-1,1)(1,-1)(1,1)(-1,1)(1,1) → v0 v1 v2
  // NDC → 设计像素需乘回 projW/2、projH/2（1920×1080 时 NDC 比值 ≠ 像素比值）
  const dx = Math.abs(buf[2 * 9 + 0] - buf[0]) * projW / 2
  const dy = Math.abs(buf[1 * 9 + 1] - buf[0 * 9 + 1]) * projH / 2
  return { dx, dy, ratio: dx > 0 ? dy / dx : 0 }
}

const def = {
  maxcount: 6, animationmode: 'sequence', sequencemultiplier: 1, starttime: 0,
  emitter: [{ name: 'boxrandom', rate: 30, distancemin: '0 0 0', distancemax: '600 400 0', origin: '0 0 0', directions: '0 0 0', speedmin: 0, speedmax: 0, instantaneous: 1 }],
  initializer: [{ name: 'lifetimerandom', min: 1, max: 1 }, { name: 'sizerandom', min: 100, max: 100 }],
}

// ── ① SEQUENCE：帧随时间推进 ──
{
  events.buffer.length = 0
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  const textures = new Map([['fog', { glTex: { id: 'fog' }, width: fogTex.width, height: fogTex.height, sprite: fogSprite }]])
  const layer = mkLayer({ particle: 'p', particleDef: def, particleTexName: 'fog' })
  const seen = new Set()
  const exts = []
  for (const t of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
    events.buffer.length = 0
    await r.render(mkScene([layer]), textures, 1920, 1080, t)
    const attrs = particleAttrs()
    if (attrs) for (const a of attrs) seen.add((a.u * 1e4 | 0) + ':' + (a.v * 1e4 | 0))
    const b = events.buffer.filter((x) => x && x.length % 54 === 0 && x.length >= 54).pop()
    const e = quadExtent(b, 1920, 1080)
    if (e) exts.push(e)
  }
  check('SEQUENCE：帧随时间变化（>3 个不同帧）', seen.size > 3, `不同帧=${seen.size}`)
  const fr = [...seen].map((s) => { const [u, v] = s.split(':').map((x) => Number(x) / 1e4); return { col: Math.round(u * fogSprite.cols), row: Math.round(v * fogSprite.rows) } })
  const rowsSeen = new Set(fr.map((f) => f.row))
  check('SEQUENCE：至少跨 2 行（行主序进位）', rowsSeen.size >= 2, '行=' + [...rowsSeen].join(','))
  if (exts.length) {
    const { ratio } = exts[exts.length - 1]
    check('quad 纵横比 = 帧纵横比 rate', Math.abs(ratio - fogSprite.rate) < 0.02, `顶点比值=${ratio.toFixed(4)} rate=${fogSprite.rate.toFixed(4)}`)
  }
}

// ── ② randomframe：终身固定帧、不同粒子可不同帧 ──
{
  events.buffer.length = 0
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  const textures = new Map([['fog', { glTex: { id: 'fog' }, width: fogTex.width, height: fogTex.height, sprite: fogSprite }]])
  const rdef = Object.assign({}, def, { animationmode: 'randomframe' })
  const layer = mkLayer({ particle: 'p', particleDef: rdef, particleTexName: 'fog' })
  const runFrames = async () => {
    const per = []
    for (const t of [0.1, 0.5, 0.9]) {
      events.buffer.length = 0
      await r.render(mkScene([layer]), textures, 1920, 1080, t)
      const attrs = particleAttrs()
      if (attrs) per.push(attrs.map((a) => (a.u * 1e4 | 0) + ':' + (a.v * 1e4 | 0)))
    }
    return per
  }
  const per = await runFrames()
  // 每帧重建粒子系统（确定性重放）：粒子按序生成，比较三次采样的公共前缀
  const n = Math.min(...per.map((a) => a.length))
  let stable = per.length >= 2 && n > 0
  for (let i = 0; i < n && stable; i++) if (!(per[0][i] === per[1][i] && per[0][i] === per[2][i])) stable = false
  check('randomframe：同一粒子帧终身不变', stable, per.map((a) => a.length).join('/') + ' 公共前缀=' + n)
  const distinct = new Set(per.length ? per[0] : [])
  check('randomframe：不同粒子帧不同（>1）', distinct.size > 1, `不同帧=${distinct.size}/${per.length ? per[0].length : 0}`)
  const blends = new Set()
  for (const a of (await (async () => { events.buffer.length = 0; await r.render(mkScene([layer]), textures, 1920, 1080, 0.3); return particleAttrs() || [] })())) blends.add(a.blend)
  check('randomframe：blend 恒 0（关闭帧混合）', blends.size === 1 && blends.has(0), 'blend=' + [...blends].join(','))
}

// ── ③ particle flags bit2=2（spritenoframeblending）：SEQUENCE 也关混合 ──
{
  events.buffer.length = 0
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  const textures = new Map([['fog', { glTex: { id: 'fog' }, width: fogTex.width, height: fogTex.height, sprite: fogSprite }]])
  // ①(修正 2026-09-13) flags 值 4 实测=透视相机（presets/*perspective 材质），
  //   spritenoframeblending 是 bit2=2
  const nb = Object.assign({}, def, { flags: 2 })
  const layer = mkLayer({ particle: 'p', particleDef: nb, particleTexName: 'fog' })
  events.buffer.length = 0
  await r.render(mkScene([layer]), textures, 1920, 1080, 0.37)
  const attrs = particleAttrs() || []
  check('flags bit2=2：blend 恒 0', attrs.length > 0 && attrs.every((a) => a.blend === 0), 'n=' + attrs.length)
  // ── ③b flags 值 4 = 透视相机（RE-37）：z>0 粒子近大远小 ──
  {
    // directions z=1 + sign z=+1 → 所有粒子固定在 z=+100（透视放大 1000/900，确定性可比）
    const pdef = Object.assign({}, def, { flags: 4, emitter: [{ name: 'boxrandom', rate: 60, distancemin: '0 0 100', distancemax: '0 0 100', origin: '0 0 0', directions: '1 1 1', sign: '0 0 1', speedmin: 0, speedmax: 0, instantaneous: 1 }] })
    const ptex = new Map([['halo', { glTex: { id: 'halo' }, width: 256, height: 256 }]])
    const pl = mkLayer({ particle: 'p', particleDef: pdef, particleTexName: 'halo' })
    const ortho = mkLayer({ particle: 'p', particleDef: Object.assign({}, pdef, { flags: 0 }), particleTexName: 'halo' })
    const rr = createRenderer(canvas, { shaderResolver, onLog: () => {} })
    const measure = async (layer) => {
      events.buffer.length = 0
      await rr.render(mkScene([layer]), ptex, 1920, 1080, 0.2)
      const b = events.buffer.filter((x) => x && x.length % 54 === 0 && x.length >= 54).pop()
      return quadExtent(b, 1920, 1080)
    }
    const eOrtho = await measure(ortho)
    const ePersp = await measure(pl)
    // z=100 → 透视放大 1000/900 = 1.111
    const k = eOrtho && ePersp && eOrtho.dx > 0 ? ePersp.dx / eOrtho.dx : 0
    check('flags=4 透视：z=100 粒子放大约 1.111', Math.abs(k - 1000 / 900) < 0.01, `比值=${k.toFixed(4)}`)
  }
}

// ── ④ 非精灵纹理：UV 仍是 0/1 角点，uvB==uv ──
{
  events.buffer.length = 0
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  const textures = new Map([['halo', { glTex: { id: 'halo' }, width: 256, height: 256 }]])
  const layer = mkLayer({ particle: 'p', particleDef: def, particleTexName: 'halo' })
  events.buffer.length = 0
  await r.render(mkScene([layer]), textures, 1920, 1080, 0.4)
  const attrs = particleAttrs() || []
  const allCorner = attrs.length > 0 && attrs.every((a) => (a.u === 0 || a.u === 1) && (a.v === 0 || a.v === 1) && a.uB === a.u && a.vB === a.v && a.blend === 0)
  check('非精灵纹理：UV=角点且 uvB=uv', allCorner, attrs.slice(0, 2).map((a) => `${a.u},${a.v}/${a.uB},${a.vB}`).join(' '))
}

const pass = checks.filter((c) => c.ok).length
console.log(`\n${pass}/${checks.length} 通过`)
process.exit(pass === checks.length ? 0 : 1)

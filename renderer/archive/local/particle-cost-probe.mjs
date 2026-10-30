// particle-cost-probe.mjs — P-69 取证：真包粒子层"每帧粒子数 / 模拟步数 / 渲染耗时"改前→改后
// 用法: node particle-cost-probe.mjs [pkgid] [--frames N] [--mode incr|replay]
//   复用 particle-shape-audit.mjs 的 mock-GL 骨架（真实 renderScene + 真实包），逐帧推进时间，
//   每帧记录：particleStats.{alive,drawn,simSteps,simUpdates} 与 render() 的墙钟耗时。
import fs from 'node:fs'
import { createRenderer } from './we-scene-bundle.js'
import * as lib from './we-scene-bundle.js'

const DIR = process.env.MPW_SCENES || path.join(process.env.MPW_ROOT || path.resolve('.', '..'), 'allwallpaper', 'dd') /* ①(2026-11-03 可移植性) */
const WE_ASSETS = process.env.MPW_WE_ASSETS || path.join(process.env.MPW_ROOT || path.resolve('.', '..'), 'wallpaper_engine', 'assets') /* ①(2026-11-03 可移植性) */
const args = process.argv.slice(2)
const id = args.find((a) => !a.startsWith('-')) || '3554161528'
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'incr'
const NF = args.includes('--frames') ? Number(args[args.indexOf('--frames') + 1]) : 40
if (mode === 'replay') globalThis.location = { search: '?psim=replay' }
const dec = new TextDecoder()
const W = 3840, H = 2160

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  BLEND: 0x0BE2, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, ONE: 1, ZERO: 0, RG8: 0x8229, RG: 0x8227 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let seq = 0, curUnit = 0, curProg = null, curFbo = null, curVerts = null
const mk = (k) => ({ id: k + '#' + (++seq) })
const setUni = (loc, v) => { if (loc && loc.p && loc.n) { if (!progUni.has(loc.p.id)) progUni.set(loc.p.id, {}); progUni.get(loc.p.id)[loc.n] = v } }
const progUni = new Map()
const curTex = new Array(8).fill(null)
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u },
  bindTexture: (t, tex) => { curTex[curUnit] = tex || null }, bindFramebuffer: (t, f) => { curFbo = f },
  useProgram: (p) => { curProg = p }, bindBuffer: () => {},
  bufferData: (t, data) => { curVerts = data && data.length ? Float32Array.from(data) : null },
  texImage2D: (...a) => { const b = curTex[curUnit]; if (!b || a.length < 9) return; const px = a[8]; if (px && px.rgba) texPixels.set(b.id, { w: px.width, h: px.height }) },
  uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v),
  uniform2f: (l, a, b) => setUni(l, [a, b]), uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
  uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
  drawArrays: () => {}, drawElements: () => {},
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
  getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_TexCoordB' ? 2 : n === 'a_Blend' ? 3 : n === 'a_Alpha' ? 4 : -1,
  getUniformLocation: (p, n) => ({ p, n }),
  getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER ? curFbo : 0),
  isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
}
const texPixels = new Map()
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; void main(){ gl_Position = vec4(a_Position,1.0); }'
const FRAG = 'void main(){ gl_FragColor = vec4(1.0); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
const scene = lib.parseScene(sceneJson, null, { readParticleDef, attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
lib.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
// 纹理（只走粒子层需要的）
const textures = new Map()
const put = (name, buf) => {
  if (textures.has(name) || !buf) return
  let tex; try { tex = lib.parseTex(buf) } catch { return }
  let m; try { m = lib.decodeMip0(tex) } catch { return }
  if (!m || !m.rgba) return
  const gt = lib.makeTextureMip(gl, [m], tex.format === 8)
  if (gt) textures.set(name, { glTex: gt, width: m.width, height: m.height, rg88: tex.format === 8, format: tex.format, sprite: (() => { try { return lib.spriteInfo(tex) } catch { return null } })() })
}
for (const l of scene.layers) {
  if (l.particleDef && l.particleDef.material) {
    try { const e = lib.getEntry(pkg, l.particleDef.material); const tn = e ? ((JSON.parse(dec.decode(e)).passes || [])[0] || {}).textures?.[0] : null
      if (tn) { l.particleTexName = tn; const te = lib.getEntry(pkg, 'materials/' + tn + '.tex') || (fs.existsSync(WE_ASSETS + '/materials/' + tn + '.tex') ? fs.readFileSync(WE_ASSETS + '/materials/' + tn + '.tex') : null); put(tn, te ? new Uint8Array(te) : null) } } catch {}
  }
  if (!l.image) continue
  try {
    let model; const bi = lib.resolveBuiltin(l.image)
    if (bi && bi.kind === 'model') model = bi.value
    else { const me = lib.getEntry(pkg, l.image); if (!me) continue; model = JSON.parse(dec.decode(me)) }
    const mat = lib.resolveMaterial(model); if (!mat) continue
    let material; const bm = lib.resolveBuiltin(mat.materialPath)
    if (bm && bm.kind === 'material') material = bm.value
    else { const me2 = lib.getEntry(pkg, mat.materialPath); if (!me2) continue; material = JSON.parse(dec.decode(me2)) }
    const tn = ((material.passes || [])[0] || {}).textures?.[0]
    if (tn) { l.textureName = tn; const e = lib.getEntry(pkg, 'materials/' + tn + '.tex') || (fs.existsSync(WE_ASSETS + '/materials/' + tn + '.tex') ? fs.readFileSync(WE_ASSETS + '/materials/' + tn + '.tex') : null); put(tn, e ? new Uint8Array(e) : null) }
  } catch {}
}
const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver, aggregate: true })
const rows = []
let t = args.includes('--t0') ? Number(args[args.indexOf('--t0') + 1]) : 12.5   // 稳态：hina 的重粒子层在 t≥12.5s 才积累满
for (let f = 0; f < NF; f++) {
  t += 1 / 30
  const t0 = performance.now()
  await r.render(scene, textures, 1920, 1080, t)
  const ms = performance.now() - t0
  rows.push({ f, t: +t.toFixed(3), ms: +ms.toFixed(1), alive: r.particleStats.alive, drawn: r.particleStats.drawn,
    simSteps: r.particleStats.simSteps, simUpdates: r.particleStats.simUpdates, simMode: r.particleStats.simMode })
}
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }
console.log(`包 ${id}  模式=${rows[0].simMode}  帧数=${NF}（1/30s 步进）`)
console.log(`  render 中位耗时 ${med(rows.map((x) => x.ms)).toFixed(1)} ms/帧   最差 ${Math.max(...rows.map((x) => x.ms)).toFixed(1)} ms`)
console.log(`  粒子层 drawn 中位 ${med(rows.map((x) => x.drawn))}   alive 中位 ${med(rows.map((x) => x.alive))}`)
console.log(`  模拟步数 中位 ${med(rows.map((x) => x.simSteps))}   粒子更新次数 中位 ${med(rows.map((x) => x.simUpdates))}`)
console.log('  末 6 帧:', JSON.stringify(rows.slice(-6)))
fs.writeFileSync('/tmp/p69-particle-cost-' + mode + '.json', JSON.stringify(rows, null, 1))

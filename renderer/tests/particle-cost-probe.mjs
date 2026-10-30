// particle-cost-probe.mjs — P-103 人工取证工具（**不进 run-all-tests**，与 P-65 的 particle-shape-audit 同族）
//
// 为什么需要它：门禁只答"对不对"，不答"贵不贵"。P-69 把 hina 的粒子从
// 62.8ms/96000 次更新降到 1.7ms/245 —— 之后任何一次粒子改动都必须自带"没有回退"的数字，
// 否则只能靠真机手感回归（用户第 2 项"非常卡"就是这么来的）。
//
// 做法：对**真实包**驱动**真实 renderScene**（core/we-scene-bundle.js）+ mock GL，
// 按 1/30s 步进连跑 N 帧，逐帧读 `renderer.particleStats`（simSteps/simUpdates/alive/drawn）
// 并用 `performance.now()` 量整帧 ms，最后给中位数/均值/最大值。
//
// 用法：
//   node tests/particle-cost-probe.mjs [pkgid ...] [--frames 30] [--t0 12.5] [--json /tmp/out.json]
//   默认包：3554161528（hina，13 粒子层）/ 3719111841（凯尔希，8 粒子层）
// 环境变量（与 ?… 同形的**档位名**，探针把它翻成 location.search 再交 createRenderer）：
//   PQUAD_MODE=legacy    → ?pquad=legacy   （P-103①：quad 不做图层 scale/角度变换）
//   PROT_MODE=legacy     → ?prot=legacy    （P-103②：不吃 rotationrandom/angularmovement）
//   PEXP_MODE=legacy     → ?pexp=legacy    （P-103③：随机分布忽略 exponent）
//   PSPEED_MODE=legacy   → ?pspeed=legacy  （P-103④：发射器 speedmin/speedmax 不产生初速）
//   TRAIL_MODE=quad|off  → ?trail=…        （P-65 既有档位，用于"几何改动是否影响代价"的对照）
import fs from 'node:fs'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'

const MPW_WS = process.env.MPW_ROOT || '~/DSHarea'
const DIR = `${MPW_WS}/allwallpaper/dd`
const WE_ASSETS = `${MPW_WS}/wallpaper_engine/assets`
const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const FRAMES = Math.max(1, Number(argOf('frames', 30)))
const T0 = Number(argOf('t0', 12.5))
const JSON_OUT = argOf('json', '')
const ids = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--frames') && !(i > 0 && argv[i - 1] === '--t0') && !(i > 0 && argv[i - 1] === '--json'))
const PKGS = ids.length ? ids : ['3554161528', '3719111841']
const dec = new TextDecoder()
const W = 3840, H = 2160

// 档位 → location.search（与 demo 的 `?x=legacy` 同形）
const q = []
for (const [env, flag] of [['PQUAD_MODE', 'pquad'], ['PROT_MODE', 'prot'], ['PEXP_MODE', 'pexp'], ['PSPEED_MODE', 'pspeed']]) {
  const v = process.env[env]
  if (v) q.push(flag + '=' + v)
}
if (process.env.TRAIL_MODE && process.env.TRAIL_MODE !== 'on') q.push('trail=' + process.env.TRAIL_MODE)
if (q.length) globalThis.location = { search: '?' + q.join('&') }

// ───────────────────────── mock GL（与 particle-shape-audit 同族的最小集） ─────────────────────────
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  BLEND: 0x0BE2, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, ONE: 1, ZERO: 0, RG8: 0x8229, RG: 0x8227 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let seq = 0, curUnit = 0, curProg = null, curFbo = null
const progUni = new Map()
const draws = []
const curTex = new Array(8).fill(null)
const mk = (k) => ({ id: k + '#' + (++seq) })
const setUni = (loc, v) => { if (loc && loc.p && loc.n) { if (!progUni.has(loc.p.id)) progUni.set(loc.p.id, {}); progUni.get(loc.p.id)[loc.n] = v } }
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u },
  bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  bindFramebuffer: (t, f) => { curFbo = f }, useProgram: (p) => { curProg = p }, bindBuffer: () => {},
  bufferData: () => {}, texImage2D: () => {},
  uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v),
  uniform2f: (l, a, b) => setUni(l, [a, b]), uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
  uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
  drawArrays: (m, f, c) => draws.push({ prog: curProg && curProg.id, count: c, fbo: curFbo && curFbo.id }),
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
  getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_TexCoordB' ? 2 : n === 'a_Blend' ? 3 : n === 'a_Alpha' ? 4 : -1,
  getUniformLocation: (p, n) => ({ p, n }),
  getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
  isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG1 = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG1)
const canvasOf = () => ({ getContext: () => gl })

// ───────────────────────── 真实包 + 真实纹理上传链 ─────────────────────────
function loadPkg(id) {
  const dir = `${DIR}/${id}/`
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(dir + 'scene.pkg')))
  const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (path) => { try { const e = lib.getEntry(pkg, path); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sceneJson, null, { readParticleDef, legacyAnimY: true })
  lib.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: false, log: () => {} })
  return { pkg, scene }
}
function texBytes(pkg, name) {
  const e = lib.getEntry(pkg, 'materials/' + name + '.tex')
  if (e) return new Uint8Array(e)
  const p = WE_ASSETS + '/materials/' + name + '.tex'
  return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null
}
function buildTextures(pkg, scene) {
  const textures = new Map()
  const put = (name, buf) => {
    if (textures.has(name) || !buf) return
    let tex, m
    try { tex = lib.parseTex(buf) } catch { return }
    try { m = lib.decodeMip0(tex) } catch { return }
    if (!m || !m.rgba) return
    const gt = lib.makeTextureMip(gl, [m], tex.format === 8)
    if (!gt) return
    textures.set(name, { glTex: gt, width: m.width, height: m.height, rg88: tex.format === 8, format: tex.format,
      sprite: (() => { try { return lib.spriteInfo(tex) } catch { return null } })() })
  }
  for (const l of scene.layers) {
    if (l.particleDef) {
      const e = l.particleDef.material ? lib.getEntry(pkg, l.particleDef.material) : null
      if (e) { try { const tn = ((JSON.parse(dec.decode(e)).passes || [])[0] || {}).textures?.[0]; if (tn) { l.particleTexName = tn; put(tn, texBytes(pkg, tn)) } } catch {} }
      continue
    }
    if (!l.image) continue
    try {
      let model; const bi = lib.resolveBuiltin(l.image)
      if (bi && bi.kind === 'model') model = bi.value
      else { const me = lib.getEntry(pkg, l.image); if (!me) continue; model = JSON.parse(dec.decode(me)) }
      if (model.solidlayer) l.solid = true
      const mat = lib.resolveMaterial(model); if (!mat) continue
      let material; const bm = lib.resolveBuiltin(mat.materialPath)
      if (bm && bm.kind === 'material') material = bm.value
      else { const me2 = lib.getEntry(pkg, mat.materialPath); if (!me2) continue; material = JSON.parse(dec.decode(me2)) }
      const tn = ((material.passes || [])[0] || {}).textures?.[0]
      if (tn) { l.textureName = tn; put(tn, texBytes(pkg, tn)) }
    } catch {}
  }
  return textures
}

// ───────────────────────── 主流程 ─────────────────────────
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const report = { mode: q.join('&') || 'default', frames: FRAMES, t0: T0, pkgs: {} }
console.log(`# particle-cost-probe  mode=${report.mode}  frames=${FRAMES}  t0=${T0}s  包=${PKGS.join(',')}`)
for (const id of PKGS) {
  let pkg, scene
  try { ({ pkg, scene } = loadPkg(id)) } catch (e) { console.log(`## ${id} 读取失败: ${e.message}`); continue }
  const textures = buildTextures(pkg, scene)
  const partLayers = scene.layers.filter((l) => l.particleDef)
  const r = createRenderer(canvasOf(), { onLog: () => {}, shaderResolver, aggregate: true })
  const ms = [], steps = [], updates = [], alive = [], drawn = []
  for (let i = 0; i < FRAMES; i++) {
    const t = T0 + i / 30
    draws.length = 0
    const t0 = performance.now()
    await r.render(scene, textures, W, H, t)
    ms.push(performance.now() - t0)
    const st = r.particleStats
    steps.push(st.simSteps); updates.push(st.simUpdates); alive.push(st.alive); drawn.push(st.drawn)
  }
  const row = { layers: partLayers.length, msMed: +med(ms).toFixed(2), msMean: +mean(ms).toFixed(2), msMax: +Math.max(...ms).toFixed(2),
    stepsMed: med(steps), stepsMax: Math.max(...steps), updatesMed: med(updates), updatesMax: Math.max(...updates),
    aliveMed: med(alive), drawnMed: med(drawn), drawsLast: draws.length }
  report.pkgs[id] = row
  console.log(`## ${id}  粒子层=${row.layers}  ms/帧 中位=${row.msMed} 均值=${row.msMean} 最大=${row.msMax}`)
  console.log(`   simSteps/帧 中位=${row.stepsMed} 最大=${row.stepsMax} | simUpdates/帧 中位=${row.updatesMed} 最大=${row.updatesMax} | 存活粒子中位=${row.aliveMed} | 实画层中位=${row.drawnMed}`)
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1))

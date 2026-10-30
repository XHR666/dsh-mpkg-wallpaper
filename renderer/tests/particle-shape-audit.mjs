// particle-shape-audit.mjs — P-65 取证工具（用户第 8/9/10/12/13 项：粒子/半透明层）
//
// 对**真实包**驱动**真实 renderScene**（core/we-scene-bundle.js），逐层隔离，产出三组可量化证据：
//   ① 贴图 .tex 的 format/flags（官方 TEX0FORMAT 判据）+ 解码后形状通道统计
//   ② 实际送进 GL 的**顶点流几何**：quad 长轴角度分布（"竖线"判据）、长宽比、顶点/段数
//   ③ 用**真实顶点流里的 UV** 采样 **GPU 侧贴图字节**，按两版 PARTICLE_FS 语义算像素指标：
//        cornerA = 四边形四角 alpha（1.000 = 硬边矩形）、meanA = 覆盖区平均 alpha、
//        opaquePct = alpha≥0.9 的采样占比
//      v1 = P-59 现状（u_Color*tex.rgb, u_Alpha*v_Alpha*tex.a，无格式转换）
//      v2 = P-65（先过官方 common_fragment.h ConvertTexture0Format，再乘）
//
// 用法：node particle-shape-audit.mjs [pkgid ...]
//   默认 3554161528（hina）/ 3544152633（Girl and cat）/ 3326873240（第 1 个，rope）
//   环境变量 TRAIL_MODE=on|quad|off 对应 ?trail=…（默认 on；quad 复现 P-59 旧几何）
//   ①(P-103 2026-09-17) 新增四个粒子档位环境变量（与 particle-cost-probe.mjs **同一套名字与同一套 `?…=legacy` 写法**）：
//   PQUAD_MODE / PROT_MODE / PEXP_MODE / PSPEED_MODE = legacy ⇒ 出"改前"几何；
//   全不设 = official（与真机默认逐位同路）。用途：quad 长宽比 / 长轴角散布 / 竖直占比 /
//   alpha 覆盖率的**前后 A/B 数字**（几何改动的可见判据），产物 JSON 名带上档位标签防覆盖。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const DIR = `${MPW_WS}/allwallpaper/dd`
const WE_ASSETS = `${MPW_WS}/wallpaper_engine/assets`
const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const PKGS = ids.length ? ids : ['3554161528', '3544152633', '3326873240']
const dec = new TextDecoder()
const W = 3840, H = 2160
const TRAIL = process.env.TRAIL_MODE || 'on'
// ①(P-103) 四个粒子档位 → 同一个 location.search（多个档位可叠加，与 cost-probe 的拼接顺序一致）
const MODE_Q = []
for (const [env, flag] of [['PQUAD_MODE', 'pquad'], ['PROT_MODE', 'prot'], ['PEXP_MODE', 'pexp'], ['PSPEED_MODE', 'pspeed']]) {
  if (process.env[env]) MODE_Q.push(flag + '=' + process.env[env])
}
const SEARCH_Q = (TRAIL !== 'on' ? ['trail=' + TRAIL] : []).concat(MODE_Q)
const MODE_TAG = SEARCH_Q.length ? SEARCH_Q.join('&') : 'official'
if (SEARCH_Q.length) { globalThis.location = { search: '?' + SEARCH_Q.join('&') } }

// ───────────────────────── mock GL ─────────────────────────
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  BLEND: 0x0BE2, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, ONE: 1, ZERO: 0, RG8: 0x8229, RG: 0x8227 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let seq = 0, curUnit = 0, curProg = null, curFbo = null, curBuf = null
const texPixels = new Map()          // glTex.id -> { w, h, rgba }（GPU 侧字节；RG88 按 GL_RG 上传口径展开）
const progUni = new Map()
const draws = []
let curVerts = null
const curTex = new Array(8).fill(null)
const mk = (k) => ({ id: k + '#' + (++seq) })
const setUni = (loc, v) => { if (loc && loc.p && loc.n) { if (!progUni.has(loc.p.id)) progUni.set(loc.p.id, {}); progUni.get(loc.p.id)[loc.n] = v } }
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u },
  bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  bindFramebuffer: (t, f) => { curFbo = f }, useProgram: (p) => { curProg = p },
  bindBuffer: (t, b) => { curBuf = b },
  bufferData: (t, data) => { curVerts = data && data.length ? Float32Array.from(data) : null },
  texImage2D: (...a) => {
    const bound = curTex[curUnit]
    if (!bound || a.length < 9) return
    let w = a[3], h = a[4], px = a[8]
    if (px && px.rgba) { w = px.width; h = px.height; px = px.rgba }
    if (!px || !px.length) return
    const n = w * h
    if (a[2] === CONST.RG8 || a[2] === CONST.RG) {
      const out = new Uint8Array(n * 4)
      for (let p = 0; p < n; p++) { out[p * 4] = px[p * 2]; out[p * 4 + 1] = px[p * 2 + 1]; out[p * 4 + 2] = px[p * 2]; out[p * 4 + 3] = 255 }
      texPixels.set(bound.id, { w, h, rgba: out, layout: 'GL_RG→(r,g,0,1)' })
    } else {
      texPixels.set(bound.id, { w, h, rgba: new Uint8Array(px.buffer ? px.buffer.slice(px.byteOffset, px.byteOffset + n * 4) : px), layout: 'RGBA' })
    }
  },
  uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v),
  uniform2f: (l, a, b) => setUni(l, [a, b]), uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
  uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
  drawArrays: (m, f, c) => draws.push({ prog: curProg && curProg.id, count: c, verts: curVerts,
    tex: curTex.slice().map((t) => (t ? t.id : null)), fbo: curFbo && curFbo.id,
    uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) }),
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

// ───────────────────────── 真实包 ─────────────────────────
function loadPkg(id) {
  const dir = `${DIR}/${id}/`
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(dir + 'scene.pkg')))
  const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (path) => { try { const e = lib.getEntry(pkg, path); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  // 与 demo.html:1374/1595 同一 readParticleDef 口径
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
// 纹理表：走真实上传链路（parseTex→decodeMip0→makeTextureMip），mock 捕获到的是 GPU 侧字节
function buildTextures(pkg, scene, onlyLayer) {
  const textures = new Map()
  const put = (name, buf) => {
    if (textures.has(name) || !buf) return
    let tex; try { tex = lib.parseTex(buf) } catch { return }
    let m; try { m = lib.decodeMip0(tex) } catch { return }
    if (!m || !m.rgba) return
    const rg88 = tex.format === 8
    const gt = lib.makeTextureMip(gl, [m], rg88)
    if (!gt) return
    textures.set(name, { glTex: gt, width: m.width, height: m.height, rg88, format: tex.format,
      sprite: (() => { try { return lib.spriteInfo(tex) } catch { return null } })(), __tex: tex })
  }
  for (const l of scene.layers) {
    if (onlyLayer && l !== onlyLayer) continue
    if (onlyLayer) {
      if (l.particleDef) {
        const e = l.particleDef.material ? lib.getEntry(pkg, l.particleDef.material) : null
        if (e) { try { const tn = ((JSON.parse(dec.decode(e)).passes || [])[0] || {}).textures?.[0]; if (tn) { l.particleTexName = tn; put(tn, texBytes(pkg, tn)) } } catch {} }
      }
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

// ───────────────────────── 像素 / 几何度量 ─────────────────────────
function sampleTex(t, u, v) {
  const { w, h, rgba } = t
  let x = u * w - 0.5, y = v * h - 0.5
  x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y))
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const o = (yy, xx) => (yy * w + xx) * 4
  const mix = (a, b, k) => a + (b - a) * k
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) out[c] = mix(mix(rgba[o(y0, x0) + c], rgba[o(y0, x1) + c], fx), mix(rgba[o(y1, x0) + c], rgba[o(y1, x1) + c], fx), fy) / 255
  return out
}
// v1 = P-59 现状；v2 = P-65（官方 ConvertTexture0Format）
function fsShape(ver, texel, fmt) {
  if (ver >= 2) {
    if (fmt === 8 || fmt === 10) return [texel[0], texel[0], texel[0], texel[1]]
    if (fmt === 9 || fmt === 11) return [1, 1, 1, texel[0]]
  }
  return texel
}
// 用**真实顶点流里的 UV**（每 quad 的 6 个顶点）算像素指标
function quadPixels(verts, t, fmt, uAlpha) {
  const q = Math.floor(verts.length / 54)
  const res = { quads: q, v1: { cornerA: 0, meanA: 0, opaquePct: 0 }, v2: { cornerA: 0, meanA: 0, opaquePct: 0 }, corners: 0 }
  if (!q || !t) return res
  const nq = Math.min(q, 40)
  for (let i = 0; i < nq; i++) {
    const b = i * 54
    // 顶点表 k0..k5 = BL,TL,BR,BR,TL,TR → 四角 = k0(BL) k1(TL) k2/k3(BR) k5(TR)
    const cornersUV = [[verts[b + 3], verts[b + 4]], [verts[b + 9 + 3], verts[b + 9 + 4]], [verts[b + 2 * 9 + 3], verts[b + 2 * 9 + 4]], [verts[b + 5 * 9 + 3], verts[b + 5 * 9 + 4]]]
    for (const ver of [1, 2]) {
      let ca = 0
      for (const [u, v] of cornersUV) ca += fsShape(ver, sampleTex(t, u, v), fmt)[3]
      res['v' + ver].cornerA += ca / 4
      let sa = 0, op = 0, n = 0
      for (let a = 0; a < 8; a++) for (let c = 0; c < 8; c++) {
        const u = cornersUV[0][0] + (cornersUV[2][0] - cornersUV[0][0]) * ((c + 0.5) / 8)
        const v = cornersUV[0][1] + (cornersUV[1][1] - cornersUV[0][1]) * ((a + 0.5) / 8)
        const al = fsShape(ver, sampleTex(t, u, v), fmt)[3] * uAlpha
        sa += al; n++; if (al >= 0.9) op++
      }
      res['v' + ver].meanA += sa / n
      res['v' + ver].opaquePct += op / n * 100
    }
    res.corners++
  }
  for (const ver of ['v1', 'v2']) {
    res[ver].cornerA = +(res[ver].cornerA / res.corners).toFixed(3)
    res[ver].meanA = +(res[ver].meanA / res.corners).toFixed(3)
    res[ver].opaquePct = +(res[ver].opaquePct / res.corners).toFixed(1)
  }
  return res
}
// 几何：quad 长轴角度（"竖线"判据 = 长轴恒竖直）+ 长/短边比
function geomMetrics(verts) {
  const q = Math.floor(verts.length / 54)
  const ang = [], ratio = []
  for (let i = 0; i < q; i++) {
    const b = i * 54
    const X = [], Y = []
    for (let k = 0; k < 6; k++) { X.push(verts[b + k * 9]); Y.push(verts[b + k * 9 + 1]) }
    // 三角形 A = k0,k1,k2；两条边 e1=k1-k0（沿 v），e2=k2-k0（沿 u）
    const e1 = [X[1] - X[0], Y[1] - Y[0]], e2 = [X[2] - X[0], Y[2] - Y[0]]
    const l1 = Math.hypot(e1[0], e1[1]), l2 = Math.hypot(e2[0], e2[1])
    const long = l1 >= l2 ? e1 : e2, short = l1 >= l2 ? l2 : l1
    ang.push(Math.abs(Math.atan2(long[1], long[0]) * 180 / Math.PI))
    ratio.push(short > 1e-9 ? (l1 >= l2 ? l1 : l2) / short : Infinity)
  }
  const vert = ang.filter((a) => Math.abs(a - 90) <= 8).length
  const finite = ratio.filter((r) => Number.isFinite(r)).sort((a, b) => a - b)
  return { quads: q, verticalPct: q ? +(vert / q * 100).toFixed(0) : 0,
    ratioMed: finite.length ? +finite[finite.length >> 1].toFixed(2) : 0,
    ratioMax: finite.length ? +finite[finite.length - 1].toFixed(2) : 0,
    angleMed: ang.length ? +ang.slice().sort((a, b) => a - b)[ang.length >> 1].toFixed(0) : 0,
    angleSpread: ang.length ? +(Math.max(...ang) - Math.min(...ang)).toFixed(0) : 0 }
}

// ───────────────────────── 主流程 ─────────────────────────
let pass = 0, fail = 0
const check = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n) } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }
const report = { trailMode: TRAIL, mode: MODE_TAG, pkgs: {} }
console.log(`# TRAIL_MODE=${TRAIL}  档位=${MODE_TAG}`)
for (const id of PKGS) {
  const { pkg, scene } = loadPkg(id)
  const parts = scene.layers.filter((l) => l.particleDef)
  console.log(`\n#### ${id}  层=${scene.layers.length} 粒子层=${parts.length}`)
  report.pkgs[id] = {}
  for (const target of parts) {
    for (const l of scene.layers) if (l.particleDef) l.visible = (l === target)
    const textures = buildTextures(pkg, scene, target)
    if (!textures.size) { console.log(`  "${target.name}" (id=${target.id}) 贴图缺失`); continue }
    draws.length = 0
    const logs = []
    const r = createRenderer(canvasOf(), { onLog: (m) => logs.push(String(m)), shaderResolver, aggregate: true })
    const t0 = Date.now()
    await r.render(scene, textures, W, H, 12.5)
    const ms = Date.now() - t0
    const batches = draws.filter((d) => d.count > 6 && d.verts && d.verts.length === d.count * 9)
    const cfg = lib.particleTrailCfg(target.particleDef)
    const texName = target.particleTexName
    const gt = textures.get(texName)
    const fmt = gt ? lib.texFormatOf(gt) : -1
    const px = gt && gt.glTex ? texPixels.get(gt.glTex.id) : null
    const head = `  "${String(target.name).slice(0, 30)}" id=${target.id} renderer=${cfg.name} tex=${texName} fmt=${fmt}`
    if (!batches.length) {
      console.log(head + `  → 0 粒子批（trailDegenerate=${r.particleStats.trailDegenerate} 顶点预算内） ${ms}ms`)
      report.pkgs[id][target.id] = { name: target.name, renderer: cfg.name, tex: texName, fmt, batches: 0, ms }
      continue
    }
    const g = geomMetrics(batches[0].verts)
    const q = quadPixels(batches[0].verts, px, fmt, 1)
    console.log(head)
    console.log(`    几何: 批=${batches.length} quad/段=${g.quads} 长轴角中位=${g.angleMed}° 角度散布=${g.angleSpread}° 竖直占比=${g.verticalPct}% 长/短边 中位=${g.ratioMed} 最大=${g.ratioMax}`)
    console.log(`    像素(v1→v2): 四角alpha ${q.v1.cornerA}→${q.v2.cornerA} | 覆盖均值alpha ${q.v1.meanA}→${q.v2.meanA} | 不透明占比 ${q.v1.opaquePct}%→${q.v2.opaquePct}%`)
    console.log(`    stats: shapeFrom=${JSON.stringify(r.particleStats.shapeFrom)} trail={seg:${r.particleStats.trailSegments},deg:${r.particleStats.trailDegenerate},drawn:${r.particleStats.trailDrawn}} 存活=${r.particleStats.alive} ${ms}ms`)
    report.pkgs[id][target.id] = { name: target.name, renderer: cfg.name, tex: texName, fmt, geom: g, px: q, ms,
      stats: { shapeFrom: r.particleStats.shapeFrom, seg: r.particleStats.trailSegments, deg: r.particleStats.trailDegenerate, drawn: r.particleStats.trailDrawn, alive: r.particleStats.alive } }
  }
}
function canvasOf() { return { getContext: () => gl } }
console.log('\n===== particle-shape-audit: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
fs.writeFileSync(path.join(os.tmpdir(), 'particle-shape-audit-' + TRAIL + '-' + MODE_TAG.replace(/[^a-z0-9=]+/gi, '_') + '.json'), JSON.stringify(report, null, 1))
process.exit(fail ? 1 : 0)

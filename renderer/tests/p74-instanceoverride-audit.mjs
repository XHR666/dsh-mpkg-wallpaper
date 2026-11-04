// p74-instanceoverride-audit.mjs — P-74 ①②③④ 的**改前→改后**量化工具（真包 + mock-GL 驱动真实 renderScene）
//
// 口径复用 particle-cost-probe.mjs / particle-shape-audit.mjs：
//   · 真包 = $MPW_ROOT/allwallpaper/dd/<id>/scene.pkg（真实 parse + 真实 renderScene）
//   · mock-GL 记录：每次 drawArrays 的顶点流（世界/局部→NDC 前）、每层粒子存活数、fxStats
//
// 四个档位（同一进程内串行跑，互不影响）：
//   默认                = P-74 全部生效（io=on, psize=official, velocityrandom y 翻转, fx FBO 修复）
//   ?io=off             = P-74 ① 回退（instanceoverride 一个字段都不读 = P-73 行为）
//   ?psize=legacy       = P-74 ② 回退（quad 边长 = p.size = 官方的 2×）
//   legacy-all          = io=off + psize=legacy（= P-73，可对拍"改前"）
//
// 用法：node p74-instanceoverride-audit.mjs [pkgid ...]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const DIR = `${MPW_WS}/allwallpaper/dd`
const WE = `${MPW_WS}/wallpaper_engine/assets`
const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const PKGS = ids.length ? ids : ['3719111841', '3326873240', '3544152633']
const dec = new TextDecoder()
const W = 3840, H = 2160

// ── 简易 PNG 解码（8bit RGB/RGBA/灰度，5 filter）—— 与 preview.mjs:41-92 同源 ──
function decodePNG(buf) {
  const b = Buffer.from(buf); const idat = []; let w = 0, h = 0, bd = 0, ct = 0
  let off = 8
  while (off < b.length) {
    const len = b.readUInt32BE(off); const type = b.toString('latin1', off + 4, off + 8)
    const data = b.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bd !== 8) throw new Error('bit depth ' + bd)
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0
  if (!ch) throw new Error('color type ' + ct)
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * ch + 1
  const rgba = new Uint8Array(w * h * 4); let prev = new Uint8Array(w * ch)
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride]; const cur = new Uint8Array(w * ch)
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * ch
      for (let k = 0; k < ch; k++) {
        let v = raw[i + k]
        if (f === 1) v = (v + (x > 0 ? cur[(x - 1) * ch + k] : 0)) & 255
        else if (f === 2) v = (v + prev[x * ch + k]) & 255
        else if (f === 3) v = (v + (((x > 0 ? cur[(x - 1) * ch + k] : 0) + prev[x * ch + k]) >> 1)) & 255
        else if (f === 4) {
          const a = x > 0 ? cur[(x - 1) * ch + k] : 0, c = prev[x * ch + k], b2 = x > 0 ? prev[(x - 1) * ch + k] : 0
          const p = a + c - b2, pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c)) & 255
        }
        cur[x * ch + k] = v & 255
      }
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (ct === 6) { for (let k = 0; k < 4; k++) rgba[o + k] = cur[x * 4 + k] }
      else if (ct === 2) { rgba[o] = cur[x*3]; rgba[o+1] = cur[x*3+1]; rgba[o+2] = cur[x*3+2]; rgba[o+3] = 255 }
      else if (ct === 0) { rgba[o] = rgba[o+1] = rgba[o+2] = cur[x]; rgba[o+3] = 255 }
      else if (ct === 4) { rgba[o] = rgba[o+1] = cur[x*2]; rgba[o+3] = cur[x*2+1] }
    }
    prev = cur
  }
  return { rgba, width: w, height: h }
}

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  RG8: 0x8229, RG: 0x8227 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

function makeGl(rec) {
  let seq = 0, curUnit = 0, curProg = null, curFbo = null
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const progName = new Map(), texName = new Map()
  const curTex = new Array(8).fill(null)
  const texDims = new Map()
  const progUni = new Map()
  const setUni = (loc, v) => { if (loc && loc.p && loc.n) { if (!progUni.has(loc.p.id)) progUni.set(loc.p.id, {}); progUni.get(loc.p.id)[loc.n] = v } }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: (t, f) => { curFbo = f }, useProgram: (p) => { curProg = p }, bindBuffer: () => {},
    bufferData: (t, data) => { rec.lastVerts = (data && data.length) ? Float32Array.from(data) : null },
    texImage2D: (...a) => {
      const b = curTex[curUnit]; if (!b) return
      if (a.length >= 9 && a[8] && a[8].rgba) texDims.set(b.id, [a[8].width, a[8].height])
      else if (a.length >= 6 && typeof a[3] === 'number') texDims.set(b.id, [a[3], a[4]])
    },
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v),
    uniform2f: (l, a, b) => setUni(l, [a, b]), uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
    drawArrays: (mode, first, count) => { rec.draws++ },
    drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 0 : k === CONST.ACTIVE_ATTRIBUTES ? 0 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_TexCoordB: 2, a_Blend: 3, a_Alpha: 4 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER ? curFbo : 0),
    isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, progName, texName, texDims, setUni, progUni }
}

async function loadScene(id, mode) {
  // 档位：mode = { io:'on'|'off', psize:'official'|'legacy' }；用 location.search 驱动（与真机同一开关）
  const q = []
  if (mode.io === 'off') q.push('io=off')
  if (mode.psize === 'legacy') q.push('psize=legacy')
  if (mode.maxtex === 'legacy') q.push('maxtex=0')
  if (mode.vy === 'legacy') q.push('vy=legacy')
  globalThis.location = { search: q.length ? '?' + q.join('&') : '' }
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
  const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sceneJson, null, { readParticleDef, attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  lib.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
  const rec = { draws: 0, lastVerts: null }
  const g = makeGl(rec)
  const readTex = (rel) => lib.getEntry(pkg, rel) || (fs.existsSync(WE + '/' + rel) ? new Uint8Array(fs.readFileSync(WE + '/' + rel)) : null)
  const textures = new Map()
  const put = (name, buf) => {
    if (textures.has(name) || !buf) return
    let tex; try { tex = lib.parseTex(buf) } catch { return }
    let m; try { m = lib.decodeMip0(tex) } catch { return }
    if (!m) return
    if (m.png || m.image) { try { const d = decodePNG(m.png || m.image); m = { width: d.width, height: d.height, rgba: d.rgba } } catch { return } }
    if (!m.rgba && !m.bitmap) return
    const gt = lib.makeTextureMip(g.gl, [m.bitmap ? m : { width: m.width, height: m.height, rgba: m.rgba, fmt: tex.format }], tex.format === 8)
    if (!gt) return
    g.texName.set(gt.id, name)
    textures.set(name, { glTex: gt, width: m.width, height: m.height, format: tex.format })
  }
  for (const l of scene.layers) {
    if (l.particleDef && l.particleDef.material) {
      try { const e = lib.getEntry(pkg, l.particleDef.material); const tn = e ? ((JSON.parse(dec.decode(e)).passes || [])[0] || {}).textures?.[0] : null
        if (tn) { l.particleTexName = tn; put(tn, readTex('materials/' + tn + '.tex')) } } catch {}
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
      if (tn) { l.textureName = tn; put(tn, readTex('materials/' + tn + '.tex')) }
      for (const ef of (l.effects || [])) for (const p of (ef.passes || [])) for (const t of (p.textures || [])) {
        if (typeof t === 'string' && t && t.indexOf('_rt_') !== 0 && t.indexOf('util/') !== 0) put(t, readTex('materials/' + t + '.tex'))
      }
    } catch (e) {}
  }
  for (const l of scene.layers) for (const ef of (l.effects || [])) lib.resolveEffectChain(pkg, ef, (b) => dec.decode(b))
  const shaderResolver = async (rel) => { const e = lib.getEntry(pkg, rel) || (fs.existsSync(WE + '/' + rel) ? fs.readFileSync(WE + '/' + rel) : null); return e ? dec.decode(e) : null }
  const r = createRenderer({ getContext: () => g.gl }, { onLog: () => {}, shaderResolver, aggregate: true })
  return { scene, textures, r, rec, pkg }
}

const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }

// ── 主测量：粒子层逐层"每帧粒子数 / 尺寸(设计像素) / 速度" ──
async function probe(id, mode, frames = 24, t0 = 3.0) {
  const { scene, textures, r } = await loadScene(id, mode)
  const partIdx = scene.layers.map((l, i) => (l.particleDef ? i : -1)).filter((i) => i >= 0)
  let t = t0
  const rows = []
  for (let f = 0; f < frames; f++) {
    t += 1 / 30
    await r.render(scene, textures, 1920, 1080, t)
    rows.push({ t: +t.toFixed(3), alive: r.particleStats.alive, drawn: r.particleStats.drawn, io: r.particleStats.io })
  }
  return { scene, r, rows, partIdx }
}

// 直接建系 + 单帧模拟，逐层导出"每帧粒子数 / 尺寸 / 速度"（不依赖 GL 顶点流，口径与 buildParticleSystem 同源）
export function layerParticleStats(scene, time = 4.0) {
  const out = []
  const ctxs = []
  scene.layers.forEach((l, i) => { if (l.particleDef) ctxs.push({ i, l }) })
  for (const { i, l } of ctxs) {
    const sys = lib.buildParticleSystem(l.particleDef, {
      origin: l.origin, scale: l.scale, angle: (l.angles && l.angles[2]) || 0,
      alphaMul: typeof l.alpha === 'number' ? l.alpha : 1, rateMul: 1,
      seedStr: String(l.id) + '|' + String(l.origin || ''),
      maxCount: Math.min((l.particleDef && l.particleDef.maxcount) || 100, 20000),
      instanceoverride: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('io') === 'off') ? null : (l.instanceoverride || null),
      vyLegacy: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('vy') === 'legacy'),
    })
    lib.simulateParticleSystem(sys, time)
    const sizes = sys.particles.map((p) => p.size)
    const cm = [0, 1, 2].map((k) => sys.particles.length ? sys.particles.reduce((x, p) => x + p.color[k], 0) / sys.particles.length : 0)
    const vy = sys.particles.map((p) => p.vel[1])
    const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
    out.push({
      idx: i, name: l.name, id: l.id, renderer: lib.particleTrailCfg(l.particleDef).name,
      io: l.instanceoverride || null,
      alive: sys.particles.length,
      sizeMean: +mean(sizes).toFixed(2), sizeMin: sizes.length ? +Math.min(...sizes).toFixed(2) : 0, sizeMax: sizes.length ? +Math.max(...sizes).toFixed(2) : 0,
      // 设计像素边长：sprite = size/2（official）或 size（legacy）；rope 家族 = size
      colorMean: cm.map((v) => +v.toFixed(4)),
      vyMean: +mean(vy).toFixed(2),
      vyNeg: vy.filter((v) => v < -1e-9).length, vyPos: vy.filter((v) => v > 1e-9).length,
    })
  }
  return out
}

// ── CLI ──
const MODES = {
  after: { io: 'on', psize: 'official' },
  'io-off': { io: 'off', psize: 'official' },
  'psize-legacy': { io: 'on', psize: 'legacy' },
  before: { io: 'off', psize: 'legacy' },
  'maxtex-legacy': { io: 'on', psize: 'official', maxtex: 'legacy' },
  'vy-legacy': { io: 'on', psize: 'official', vy: 'legacy' },
}
if (process.argv[1] && process.argv[1].endsWith('p74-instanceoverride-audit.mjs')) {
  for (const id of PKGS) {
    console.log('\n════════ 包 ' + id + ' ════════')
    for (const [tag, mode] of Object.entries(MODES)) {
      const { scene, r, rows } = await probe(id, mode)
      const stats = layerParticleStats(scene, 4.0)
      console.log(`\n── 档位 ${tag}（io=${mode.io}, psize=${mode.psize}, maxtex=${mode.maxtex || 'fix'}, vy=${mode.vy || 'official'}）`)
      console.log('  帧末粒子存活 ' + rows[rows.length - 1].alive + '（中位 ' + med(rows.map((x) => x.alive)) + '）  fx 层 ' + r.fxStats.layers
        + '  psizeMode=' + r.particleStats.psizeMode + ' ioMode=' + r.particleStats.ioMode)
      for (const s of stats) {
        if (!s.alive && !s.io) continue
        const edge = s.renderer === 'sprite' || s.renderer === 'spritetrail'
          ? (mode.psize === 'legacy' ? s.sizeMean : s.sizeMean / 2) : s.sizeMean
        console.log('   #' + String(s.idx).padStart(2) + ' ' + String(s.name).slice(0, 22).padEnd(22)
          + ' r=' + String(s.renderer).padEnd(11) + ' alive=' + String(s.alive).padStart(4)
          + ' sizeMean=' + String(s.sizeMean).padStart(8) + ' quadEdge=' + edge.toFixed(2)
          + ' color=' + JSON.stringify(s.colorMean)
          + ' vyMean=' + String(s.vyMean).padStart(10) + ' (neg ' + s.vyNeg + '/pos ' + s.vyPos + ')'
          + (s.io ? ' io=' + JSON.stringify(s.io).replace(/"enabled":true,?/, '').slice(0, 110) : ''))
      }
    }
    // fx 台账（④）：改后 vs 改前
    for (const mt of ['after', 'maxtex-legacy']) {
    const { r } = await probe(id, MODES[mt])
    const fx = r.fxStats
    const deg = Object.values(fx.perLayer).filter((v) => v.quadW < 2 || v.quadH < 2).length
    console.log('\n── fxStats（' + (mt === 'after' ? '改后 maxtex=fix' : '改前 maxtex=0/P-73') + '）：'
      + fx.layers + ' 个效果层，其中 FBO 退化(<2px) ' + deg + ' 个')
    for (const [n, v] of Object.entries(fx.perLayer)) {
      console.log('   ' + n.padEnd(24) + ' effects=' + v.effects + ' passes=' + v.passes + ' quad=' + v.quadW + 'x' + v.quadH
        + ' input=' + v.inputKind + ' copyDrawn=' + v.copyDrawn + ' out=' + v.outKind + (v.outSize ? '/' + v.outSize : '') + (v.fallback ? ' fallback=' + v.fallback : ''))
    }
    }
  }
}

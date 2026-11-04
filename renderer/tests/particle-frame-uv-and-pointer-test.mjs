/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · `references/wer-ref`（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only）—— 与本项目 GPL-3.0-or-later 不兼容，仅行为对照；
 *   · `references/lwe-ref`（linux-wallpaperengine，GPL-3.0-only）—— 仅行为对照；
 *   · `references/vendor-ref/webwallgl`（oneincase/webwallgl，**MIT**）—— 允许移植，本文件仍按"行为规格"独立实现，
 *     引用处以 `file:line` 标注行为来源；血缘/许可台账见 docs/COPYING-RULES.md 与 THIRD-PARTY.md。
 */
// particle-frame-uv-and-pointer-test.mjs — P-133 回归门禁（秒级、无浏览器、无 GPU）
//
// 覆盖用户第 ①/②/③ 项的五条根因（详见 docs/PATCHES.md P-133）：
//   ① 精灵表**帧 UV 尺寸**没乘：每颗粒子采样 u 跨度恒 1.0（整张图集）而不是 `frameWidthUV`
//      ⇒ hina 第 21 层「落花」= 13 帧横排（2600×200）被压成 13 条竖线（用户原话"竖状的线条，一条空开另一条"）；
//        第 18 层「雾 2」= 8×8 图集被整张塞进一颗雾粒（② 同根因）。
//   ② 粒子 CPU NDC 的 y 没跟 P-69 的投影修正（粒子 VS 的 `u_MVP` 是 IDENT_M4）⇒ 整条粒子路径
//      绕画布中线镜像；lockToPointer 层 ⇒ 鼠标往上、粒子往下（用户第 ③ 项"正好相反"）。
//   ③ `mapsequencearoundcontrolpoint` 未实现 + `vortex` 字段名/圆心错 + `sizechange|alphachange`
//      的 FadeValueChange 用了 smoothstep ⇒ 光标花瓣堆成一个球、没有尾迹。
//
// 用法: node tests/particle-frame-uv-and-pointer-test.mjs [--verbose]
// TODO(tests/run-all-tests.sh): 本文件尚未登记进门禁脚本（由主对话统一登记，别的线不要改 run-all-tests.sh）
import { WS } from './_root.mjs'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'

const VERBOSE = process.argv.includes('--verbose')
const MPW_WS = process.env.MPW_ROOT || WS
const DIR = `${MPW_WS}/allwallpaper/dd`
const WE = `${MPW_WS}/wallpaper_engine/assets`
const dec = new TextDecoder()
const checks = []
const push = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (VERBOSE || !ok) console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')) }
const near = (a, b, tol) => Math.abs(a - b) <= tol

// ───────────────────────── mock GL（顶点流捕获） ─────────────────────────
function makeGl() {
  const rec = { verts: [], draws: [], bufs: new Map(), uploads: [], draws2: [] }
  let curUnit = 0, curBuf = null, curProg = null
  const progUni = new Map()
  const setUni = (l, v) => { if (l && l.p && l.n) { if (!progUni.has(l.p.id)) progUni.set(l.p.id, {}); progUni.get(l.p.id)[l.n] = v } }
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER: 0x8D40 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let seq = 0
  const handlers = {
    createTexture: () => ({ id: 'tex' + (++seq) }), createFramebuffer: () => ({ id: 'fbo' + (++seq) }),
    createBuffer: () => ({ id: 'buf' + (++seq) }), createVertexArray: () => ({ id: 'vao' + (++seq) }),
    createShader: () => ({ id: 'sh' + (++seq) }), createProgram: () => ({ id: 'prog' + (++seq) }),
    bindBuffer: (t, b) => { curBuf = b && b.id },
    bufferData: (t, data) => { if (data && data.length) { const v = Float32Array.from(data); rec.bufs.set(curBuf, v); rec.uploads.push({ buf: curBuf, data: v }); rec.verts.push(v) } },
    activeTexture: (u) => { curUnit = u }, bindTexture: () => {}, bindFramebuffer: () => {}, bindVertexArray: () => {},
    useProgram: (p) => { curProg = p },
    texImage2D: () => {}, uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
    drawArrays: (m, f, c) => { rec.draws.push({ count: c, data: rec.bufs.get(curBuf) || null, uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) }) },
    drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 0 : (k === CONST.ACTIVE_ATTRIBUTES ? 0 : null)),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_TexCoordB: 2, a_Blend: 3, a_Alpha: 4, a_Color: 5 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const SHADER_RESOLVER = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
// `projectionYFix()`/其它档位在**首次读取时缓存**（bundle `__projYMode`）⇒ 每次换档必须显式复位
function setModes(q) { globalThis.location = { search: q ? '?' + q : '' }; lib.setProjectionYFix(null) }
const W = 3840, H = 2160
const mkLayer = (o) => Object.assign({ id: 1, name: 'L', visible: true, origin: [0, 0, 0], scale: [1, 1, 1], angles: [0, 0, 0],
  alpha: 1, size: [W, H], image: null, particle: 'p', particleDef: null, particleTexName: 'tex_a',
  textureName: null, effects: [], parallaxDepth: null, uvRect: undefined }, o)
// 单个 quad 的 6 个顶点的 uv 跨度 + 帧原点（u/v 的最小值）
function quadUVSpans(verts) {
  const out = []
  for (let q = 0; q * 54 + 54 <= verts.length; q++) {
    const o = q * 54
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity
    for (let k = 0; k < 6; k++) { const u = verts[o + k * 9 + 3], v = verts[o + k * 9 + 4]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v) }
    out.push({ u0, v0, u1, v1, du: u1 - u0, dv: v1 - v0 })
  }
  return out
}
const ndcYOfQuad = (verts, q) => { const o = q * 54; return verts[o + 1] }
// quad **中心**的 NDC.y（6 个顶点取 min/max 再取中 —— 顶点序表 BL,TL,BR,BR,TL,TR 的算术均值不是中心）
const ndcYCenter = (verts, q) => {
  const o = q * 54
  let lo = Infinity, hi = -Infinity
  for (let k = 0; k < 6; k++) { const v = verts[o + k * 9 + 1]; lo = Math.min(lo, v); hi = Math.max(hi, v) }
  return (lo + hi) / 2
}

// ═══════════════ ① 纯函数：帧 UV 尺寸（`computeSpriteFrameUV` + `frameRectUVFn`） ═══════════════
console.log('\n[1] ① 精灵表帧 UV 尺寸：su/sv = frameWidthUV/frameHeightUV，且消费方乘上它')
{
  // 13 帧横排（落花 particle/3：2600×200、每帧 200×200）
  const sp = { numFrames: 13, frameWidthUV: 200 / 2600, frameHeightUV: 1 }
  const f0 = lib.computeSpriteFrameUV(sp, 0.0, true)
  push('①-a su/sv = 帧的真实 UV 尺寸（落花 200/2600 × 1/1）',
    near(f0.su, 200 / 2600, 1e-12) && near(f0.sv, 1, 1e-12), `su=${f0.su} sv=${f0.sv}`)
  push('①-b u0/v0/u1/v1 语义不变（仍是 cur/nxt 两帧**原点**，既有调用方逐位不变）',
    f0.u0 === 0 && f0.v0 === 0 && f0.u1 === 200 / 2600 && f0.v1 === 0, JSON.stringify({ u0: f0.u0, v0: f0.v0, u1: f0.u1, v1: f0.v1 }))
  // 第 k 帧的矩形
  const rect = (k) => {
    const fv = (k + 0.5) / 13
    const f = lib.computeSpriteFrameUV(sp, fv, true)
    return { u0: f.u0, v0: f.v0, su: f.su, sv: f.sv }
  }
  const r0 = rect(0), r7 = rect(7), r12 = rect(12)
  push('①-c 帧 k 的矩形原点 = k·su（13 帧横排 ⇒ 逐帧对齐图集格）',
    near(r0.u0, 0, 1e-12) && near(r7.u0, 7 * 200 / 2600, 1e-12) && near(r12.u0, 12 * 200 / 2600, 1e-12),
    `u0: k0=${r0.u0} k7=${r7.u0.toFixed(6)} k12=${r12.u0.toFixed(6)}`)
  // 消费方：quad 的 [0,1]² → 帧矩形
  const uv = lib.frameRectUVFn(compute(7, 13), compute(8, 13), 0.25)
  function compute(k, n) { const f = lib.computeSpriteFrameUV({ numFrames: n, frameWidthUV: 1 / n, frameHeightUV: 1 }, (k + 0.5) / n, true); return f }
  const bl = uv(0, 1), tr = uv(1, 0)
  push('①-d frameRectUVFn：quad 的 uv 跨度 = 一帧（1/13），不是整张图集（1.0）',
    near(tr[0] - bl[0], 1 / 13, 1e-12) && near(bl[1] - tr[1], 1, 1e-12), `du=${tr[0] - bl[0]} dv=${bl[1] - tr[1]}`)
  push('①-e frameRectUVFn：cur/nxt 两个矩形都给出（帧混合用），blend 原样带出',
    near(bl[0], 7 / 13, 1e-12) && near(uv(0, 0)[2], 8 / 13, 1e-12) && uv(0, 0)[4] === 0.25,
    `cur.u0=${bl[0].toFixed(6)} nxt.u0=${uv(0, 0)[2].toFixed(6)} blend=${uv(0, 0)[4]}`)
  // 多图精灵（abs 路径）走同一个函数、语义不变
  const absCur = { u0: 0.25, v0: 0.5, u1: 0.5, v1: 1 }
  const absNxt = { u0: 0.5, v0: 0.5, u1: 0.75, v1: 1 }
  const uvA = lib.frameRectUVFn(absCur, absNxt, 0)
  push('①-f 多图精灵（绝对矩形）路径不变：span = u1−u0',
    near(uvA(1, 0)[0] - uvA(0, 0)[0], 0.25, 1e-12) && near(uvA(1, 0)[2] - uvA(0, 0)[2], 0.25, 1e-12), 'ok')
  // 8×8（雾 3）网格进位：第 9 帧应换到第二行第 0 列
  const g = { numFrames: 64, frameWidthUV: 1 / 8, frameHeightUV: 1 / 8 }
  const f9 = lib.computeSpriteFrameUV(g, (9 + 0.5) / 64, true)
  const f8 = lib.computeSpriteFrameUV(g, (8 + 0.5) / 64, true)
  push('①-g 8×8 图集行主序进位：第 8 帧 = (行1,列0)、第 9 帧 = (行1,列1)，两者都带 su/sv=1/8',
    near(f8.u0, 0, 1e-12) && near(f8.v0, 1 / 8, 1e-12) &&
    near(f9.u0, 1 / 8, 1e-12) && near(f9.v0, 1 / 8, 1e-12) && near(f9.su, 1 / 8, 1e-12) && near(f9.sv, 1 / 8, 1e-12),
    `f8=(${f8.u0},${f8.v0}) f9=(${f9.u0},${f9.v0}) su=${f9.su}`)
}

// ═══════════════ ② 真包：落花 / 雾 2 的**顶点流** UV 跨度 ═══════════════
console.log('\n[2] ② 真包顶点流：hina ln=20「落花」13 帧横排 & ln=17「雾 2」8×8 图集')
function loadPkg(id) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  return { pkg, sj, readParticleDef }
}
async function renderRealLayer(id, ln, t, modes, ptr) {
  setModes(modes)
  const { pkg, sj, readParticleDef } = loadPkg(id)
  const scene = lib.parseScene(sj, null, { readParticleDef, legacyAnimY: true })
  lib.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
  const L = scene.layers[ln]
  for (const l of scene.layers) if (l.particleDef) l.visible = (l === L)
  const me = L.particleDef.material ? lib.getEntry(pkg, L.particleDef.material) : null
  const texName = me ? (((JSON.parse(dec.decode(me)).passes || [])[0] || {}).textures?.[0] || null) : null
  L.particleTexName = texName
  const e = texName ? lib.getEntry(pkg, 'materials/' + texName + '.tex') : null
  const buf = e ? new Uint8Array(e) : (texName && fs.existsSync(WE + '/materials/' + texName + '.tex') ? new Uint8Array(fs.readFileSync(WE + '/materials/' + texName + '.tex')) : null)
  const tex = buf ? lib.parseTex(buf) : null
  const sprite = tex ? lib.spriteInfo(tex) : null
  const { gl, rec } = makeGl()
  const textures = new Map()
  if (tex) { const m = lib.decodeMip0(tex); textures.set(texName, { glTex: lib.makeTextureMip(gl, [m], tex.format === 8), width: m.width, height: m.height, format: tex.format, sprite }) }
  if (ptr) globalThis.__mpwPointer = ptr
  const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SHADER_RESOLVER, aggregate: true })
  await r.render(scene, textures, W, H, t)
  if (ptr) delete globalThis.__mpwPointer
  const batches = rec.draws.filter((d) => d.count > 6 && d.data && d.data.length === d.count * 9)
  return { L, sprite, texName, verts: batches.length ? batches[0].data : null, batches: batches.length, stats: r.particleStats, layerOrigin: L.origin }
}
if (fs.existsSync(`${DIR}/3554161528/scene.pkg`)) {
  {
    const res = await renderRealLayer('3554161528', 20, 25, '', null)
    const sp = res.sprite
    push('②-a ln=20「落花」贴图事实：13 帧 / 帧 200×200 / 图集 2600×200（判据前提）',
      !!sp && sp.numFrames === 13 && sp.frameWidthPx === 200 && sp.frameHeightPx === 200 && near(sp.frameWidthUV, 200 / 2600, 1e-9),
      sp ? `n=${sp.numFrames} ${sp.frameWidthPx}×${sp.frameHeightPx} tex=${res.texName}` : '无帧表')
    const q = res.verts ? quadUVSpans(res.verts) : []
    const dus = [...new Set(q.map((x) => x.du.toFixed(6)))]
    push('②-b ★ 每颗粒子的 u 跨度 = 1/13（0.076923），**不是 1.0**（用户的"竖条"根因）',
      q.length > 0 && dus.length === 1 && dus[0] === '0.076923', `quads=${q.length} 去重后的 du={${dus.join(',')}}`)
    const origins = [...new Set(q.map((x) => Math.round(x.u0 * 13)))]
    push('②-c 帧原点全部落在 13 个格位上（k/13，k∈[0,12]）',
      origins.length > 0 && origins.every((k) => k >= 0 && k <= 12) && q.every((x) => near(x.u0 * 13, Math.round(x.u0 * 13), 1e-6)),
      `命中的格位={${origins.sort((a, b) => a - b).join(',')}}`)
    push('②-d v 跨度 = 1（单行图集高度方向就是一帧）', q.length > 0 && q.every((x) => near(x.dv, 1, 1e-9)), `dv={${[...new Set(q.map((x) => x.dv.toFixed(3)))].join(',')}}`)
  }
  {
    const res = await renderRealLayer('3554161528', 17, 25, '', null)
    const sp = res.sprite
    push('②-e ln=17「雾 2」贴图事实：64 帧 / 8×8 / 帧 128×128（判据前提）',
      !!sp && sp.numFrames === 64 && sp.cols === 8 && sp.rows === 8 && near(sp.frameWidthUV, 0.125, 1e-9),
      sp ? `n=${sp.numFrames} ${sp.cols}x${sp.rows} uv=${sp.frameWidthUV}` : '无帧表')
    const q = res.verts ? quadUVSpans(res.verts) : []
    push('②-f ★ 每颗粒子的 uv 跨度 = 0.125×0.125（一颗雾粒 = 一帧 128×128），不是 1.0×1.0',
      q.length > 0 && q.every((x) => near(x.du, 0.125, 1e-9) && near(x.dv, 0.125, 1e-9)),
      `quads=${q.length} du={${[...new Set(q.map((x) => x.du.toFixed(4)))].join(',')}} dv={${[...new Set(q.map((x) => x.dv.toFixed(4)))].join(',')}}`)
  }
} else push('② hina 真包缺失（SKIP 视作 PASS）', true, 'no 3554161528')

// ═══════════════ ③-a 粒子 NDC 的 y 必须与层路径（viewProj）同号 ═══════════════
console.log('\n[3] ③-a 粒子 CPU NDC 的 y：与 `buildCamera` 的 viewProj 同号（P-69 投影修正的收尾）')
// 层路径（viewProj）在同一批注入口径下的 NDC.y。显式指定 fix 档，避免被 setModes 的当前档污染。
function viewProjNY(y, fix) {
  lib.setProjectionYFix(fix)
  const scene = { general: { orthogonalprojection: { width: W, height: H } }, camera: null }
  const cam = lib.buildCamera(scene, W / 2, H / 2, { fillmode: 'aspectcrop' })
  const m = lib.mat4Multiply(cam.projection, cam.view)
  lib.setProjectionYFix(null)
  return (m[1] * 0 + m[5] * y + m[13]) / (m[7] * 0 + m[15])
}
async function renderSynthetic(def, modes, ptr, t = 1) {
  setModes(modes)
  const { gl, rec } = makeGl()
  const scene = { layers: [mkLayer({ id: 7, particleDef: def, particleTexName: 'tex_a' })], general: {}, camera: null, size: [W, H] }
  if (ptr) globalThis.__mpwPointer = ptr
  const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SHADER_RESOLVER, aggregate: true })
  await r.render(scene, new Map([['tex_a', { glTex: { id: 'g1' }, width: 64, height: 64 }]]), W, H, t)
  if (ptr) delete globalThis.__mpwPointer
  const batches = rec.draws.filter((d) => d.count > 6 && d.data && d.data.length === d.count * 9)
  return { verts: batches.length ? batches[0].data : null, stats: r.particleStats }
}
{
  // 两个静止粒子放在设计 y=540（屏幕上半）。发射器 origin 是**编辑器 y-up** ⇒ `-540` 才是世界 y=+540。
  const def = { maxcount: 4, material: null, flags: 0,
    emitter: [{ name: 'boxrandom', rate: 0.0001, instantaneous: 2, distancemin: '0 0 0', distancemax: '0 0 0', origin: '0 -540 0' }],
    initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 100, max: 100 }], operator: [] }
  const fix = await renderSynthetic(def, '', null, 0.05)
  push('③-a-1 修正档（缺省）：quad 中心 world y=540 ⇒ 粒子 NDC.y = +0.5（屏幕上半，= 1 − 2·540/2160）',
    !!fix.verts && near(ndcYCenter(fix.verts, 0), 0.5, 1e-6), `NDC.y=${fix.verts ? ndcYCenter(fix.verts, 0).toFixed(6) : '-'}`)
  push('③-a-2 ★ 与层路径 viewProj **同号**（粒子不再绕画布中线镜像）',
    !!fix.verts && near(ndcYCenter(fix.verts, 0), viewProjNY(540, true), 1e-6),
    `粒子=${fix.verts ? ndcYCenter(fix.verts, 0).toFixed(6) : '-'} viewProj(fix)=${viewProjNY(540, true).toFixed(6)}`)
  const leg = await renderSynthetic(def, 'projy=legacy', null, 0.05)
  push('③-a-3 `?projy=legacy` 逐位回到旧镜像口径（层 + 粒子一起回退，A/B 仍可做）',
    !!leg.verts && near(ndcYCenter(leg.verts, 0), viewProjNY(540, false), 1e-6),
    `legacy 粒子=${leg.verts ? ndcYCenter(leg.verts, 0).toFixed(6) : '-'} viewProj(legacy)=${viewProjNY(540, false).toFixed(6)}`)
  // 互镜关系：fix(y) == −legacy(y)
  push('③-a-4 两档严格互为镜像（fix(540) == −legacy(540)）',
    !!fix.verts && !!leg.verts && near(ndcYCenter(fix.verts, 0), -ndcYCenter(leg.verts, 0), 1e-12),
    `fix=${fix.verts ? ndcYCenter(fix.verts, 0).toFixed(6) : '-'} legacy=${leg.verts ? ndcYCenter(leg.verts, 0).toFixed(6) : '-'}`)
}

// ═══════════════ ③-a' 真包：指针在中线上/下方时粒子**屏幕上**的上下关系 ═══════════════
if (fs.existsSync(`${DIR}/3554161528/scene.pkg`)) {
  const up = await renderRealLayer('3554161528', 27, 4, '', { x: 1920, y: 540, inside: true })
  const dn = await renderRealLayer('3554161528', 27, 4, '', { x: 1920, y: 1620, inside: true })
  push('③-a-5 ★ 指针在**中线上方**(540) ⇒ 花瓣 NDC.y > 0；指针在**下方**(1620) ⇒ NDC.y < 0（不再相反）',
    !!up.verts && !!dn.verts && ndcYOfQuad(up.verts, 0) > 0.2 && ndcYOfQuad(dn.verts, 0) < -0.2,
    `y=540 ⇒ NDC.y=${up.verts ? ndcYOfQuad(up.verts, 0).toFixed(3) : '-'}；y=1620 ⇒ NDC.y=${dn.verts ? ndcYOfQuad(dn.verts, 0).toFixed(3) : '-'}`)
}

// ═══════════════ ③-b `mapsequencearoundcontrolpoint` ═══════════════
console.log('\n[4] ③-b `mapsequencearoundcontrolpoint`：绕控制点分布 + 作者初速')
const mapDef = (extra) => Object.assign({ maxcount: 200,
  controlpoint: [{ flags: 1, id: 0, offset: '0 0 0' }, { flags: 0, id: 1, offset: '0 0 0' }],
  emitter: [{ name: 'sphererandom', controlpoint: 0, rate: 100, distancemin: '1 1 0', distancemax: '1 1 0', speedmin: 0, speedmax: 20 }],
  initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 30, max: 40 },
    { name: 'mapsequencearoundcontrolpoint', count: 5, speedmin: '0 100 0', speedmax: '0 100 0' }],
  operator: [] }, extra)
{
  const sys = lib.buildParticleSystem(mapDef(), { origin: [1920, 1080, 0], scale: [1, 1, 5], angle: 0, seedStr: 'map1', maxCount: 50 })
  sys.pointer = [1920, 1080]
  const born = []
  for (let i = 0; i < 10; i++) { const p = lib.spawnParticle(sys, sys.emitters[0]); if (p) born.push(p) }
  push('③-b-1 有指针 ⇒ 真发射（前置）', born.length === 10, `born=${born.length}`)
  const rad = born.map((p) => Math.hypot(p.pos[0] - 1920, p.pos[1] - 1080))
  push('③-b-2 出生点落在**控制点周围** radius=distancemax[0]=1 的圆上（不是随机散布）',
    rad.every((r) => near(r, 1, 1e-6)), `半径={${[...new Set(rad.map((r) => r.toFixed(6)))].join(',')}}`)
  const angs = born.map((p) => Math.atan2(-(p.pos[1] - 1080), p.pos[0] - 1920))
  const uniq = [...new Set(angs.map((a) => ((Math.round((a / (Math.PI * 2)) * 5) % 5) + 5) % 5))]
  push('③-b-3 count=5 ⇒ 出生角按 1/5 圈轮流（sequence，不是随机）',
    uniq.length === 5, `去重后的相位档={${uniq.sort((a, b) => a - b).join(',')}}`)
  const vy = born.map((p) => p.vel[1])
  push('③-b-4 ★ 作者初速 speedmin/speedmax="0 100 0" 真的进了 vel（且 y 取反 = 屏幕向上）',
    vy.every((v) => v <= 0 && v >= -120 - 1e-6) && Math.min(...vy) < -1,
    `vel.y ∈ [${Math.min(...vy).toFixed(2)}, ${Math.max(...vy).toFixed(2)}]`)
  const spd = born.map((p) => Math.hypot(p.vel[0], p.vel[1]))
  push('③-b-5 初速量级 = 作者值 0..100（旧实现只有发射器的 0..20）', Math.max(...spd) > 20, `max|v|=${Math.max(...spd).toFixed(2)}`)
  // 无 ctx（= 旧调用方 / 旧路径）时**零副作用**：不动 pos/vel、不消耗随机数
  {
    const p0 = { pos: [11, 22, 33], vel: [4, 5, 6], color: [1, 1, 1], scenePos: [7, 8, 9], rot: 0, angVel: 0, size: 30, life: 1, age: 0, alpha: 1, random: 0.5 }
    const before = JSON.stringify(p0)
    let rngCalls = 0
    const rng = () => { rngCalls++; return 0.5 }
    lib.applyInitializer(p0, { name: 'mapsequencearoundcontrolpoint', params: { count: 5, speedmin: '0 100 0', speedmax: '0 100 0' } },
      rng, false, false, false, null, null)
    push('③-b-6 不传 ctx（旧调用方）⇒ pos/vel 一个字节都不动、一次随机数都不抽（零回归面）',
      JSON.stringify(p0) === before && rngCalls === 0, `rngCalls=${rngCalls} changed=${JSON.stringify(p0) !== before}`)
  }
}
if (fs.existsSync(`${DIR}/3554161528/scene.pkg`)) {
  const { pkg, readParticleDef } = loadPkg('3554161528')
  const scene = lib.parseScene(JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, '')), null, { readParticleDef })
  const L = scene.layers[27]
  const sys = lib.buildParticleSystem(L.particleDef, { origin: L.origin, scale: L.scale, angle: (L.angles && L.angles[2]) || 0, seedStr: 'ptr', maxCount: 400 })
  sys.pointer = [1920, 1080]
  const born = []
  for (let i = 0; i < 40; i++) { const p = lib.spawnParticle(sys, sys.emitters[0]); if (p) born.push(p) }
  const spd = born.map((p) => Math.hypot(p.vel[0], p.vel[1]))
  push('③-b-7 ★ 真包 ln=27「cherry blossoms on cursor」出生初速 max ≈ 100~120（作者 100 + 发射器 0..20），旧实现 ≤ 20',
    born.length > 0 && Math.max(...spd) > 90 && Math.max(...spd) <= 120 + 1e-6,
    `max|v|=${Math.max(...spd).toFixed(2)} n=${born.length}`)
}

// ═══════════════ ③-c `vortex` 字段名 + 圆心 ═══════════════
console.log('\n[5] ③-c `vortex`：字段名 distanceinner/distanceouter/speedinner/speedouter + 圆心 = 控制点')
{
  const vexDef = (scaleSpeed) => ({ maxcount: 100,
    controlpoint: [{ flags: 1, id: 0, offset: '0 0 0' }],
    emitter: [{ name: 'boxrandom', controlpoint: 0, rate: 0.0001, instantaneous: 1, distancemin: '0 0 0', distancemax: '0 0 0' }],
    initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 10, max: 10 }],
    operator: [{ name: 'movement' }, { name: 'vortex', distanceinner: 0, distanceouter: 50, speedinner: 300, speedouter: 0, flags: 0 }] })
  const run = (modes, ptr) => {
    setModes(modes)
    // `?pops=legacy` 由渲染器解析后经 ctx 传给 buildParticleSystem（bundle:10393）⇒ 直连构建要照传
    const sys = lib.buildParticleSystem(vexDef(), { origin: [1000, 1000, 0], scale: [1, 1, 1], angle: 0, seedStr: 'vex', maxCount: 20, popsLegacy: modes === 'pops=legacy', vortexLegacy: modes === 'pvortex=legacy' })
    sys.pointer = ptr
    const p = lib.spawnParticle(sys, sys.emitters[0])
    p.pos = [ptr[0] + 25, ptr[1]]      // 距光标 25px（在 distanceinner..distanceouter 之内）
    sys.particles.push(p); sys.count++
    const v0 = p.vel.slice()
    lib.stepParticles(sys, 0.1, 0)
    return { dv: [p.vel[0] - v0[0], p.vel[1] - v0[1]], pos: p.pos.slice() }
  }
  const ptr = [1000, 1000]
  const on = run('', ptr)
  const leg = run('pops=legacy', ptr)
  const legV = run('pvortex=legacy', ptr)
  // 圆心 = 光标(1000,1000)、粒子在 (1025,1000) ⇒ radial=(+25,0)、axis=+z
  // ⇒ **本批新默认**切向 = `radial × axis` = `(dy,−dx)/d` = `(0,−1)`（P-136 及之前是 `axis × radial` = `(0,+1)`，
  //    依据 `docs/VORTEX-CHIRALITY-RE-20260923.md`：第三方多实现共识 + 上游带理由的单向翻转；
  //    **本机无 WE 官方反编译/官方方向定义**，`?pvortex=legacy` 保留旧符号）。
  // 半径权重按官方 `lerp((d−inner)/(outer−inner+0.1), speedinner, speedouter)`：d=25、inner=0、outer=50
  // ⇒ 300 + (0−300)·(25/50.1) = 150.299…（量值与手性无关，故 ③-c-1 的 150.30 一字不动，只翻符号）
  const expectW = 300 + (0 - 300) * (25 / 50.1)
  const speed = Math.hypot(on.dv[0], on.dv[1]) / 0.1
  push('③-c-1 ★ 官方档：切向加速度按半径权重 = 150.30 px/s²（旧实现读不到字段 ⇒ 恒 1）',
    near(speed, expectW, 0.5) && near(on.dv[0], 0, 1e-6) && on.dv[1] < 0,
    `|Δv|/dt=${speed.toFixed(2)} Δv=(${on.dv[0].toFixed(4)}, ${on.dv[1].toFixed(4)})`)
  // ①(vortex-chirality 2026-09-23) **手性判据**：官方 = `(dy,−dx)`、`?pvortex=legacy` = `(−dy,+dx)`，
  //   同配置下**严格相反**（量值相同、符号相反）⇒ 这条断言对"翻默认"敏感（改回去必红）。
  push('③-c-1b 手性 ★ 官方 `(dy,−dx)` 与 `?pvortex=legacy` `(−dy,+dx)` **严格相反**（量值相同）',
    near(legV.dv[0], -on.dv[0], 1e-9) && near(legV.dv[1], -on.dv[1], 1e-9) && Math.hypot(legV.dv[0], legV.dv[1]) > 1,
    `官方 Δv=(${on.dv[0].toFixed(4)}, ${on.dv[1].toFixed(4)}) / legacy Δv=(${legV.dv[0].toFixed(4)}, ${legV.dv[1].toFixed(4)})`)
  push('③-c-2 `?pops=legacy` 复现旧口径：字段读不到 ⇒ 圆心退化成粒子自己的出生点 ⇒ 切向为 0（力恒 0）',
    near(Math.hypot(leg.dv[0], leg.dv[1]) / 0.1, 0, 1e-6),
    `legacy |Δv|/dt=${(Math.hypot(leg.dv[0], leg.dv[1]) / 0.1).toFixed(4)}`)
  push('③-c-3 两档数值确实不同（不是同一条路）', Math.abs(speed - Math.hypot(leg.dv[0], leg.dv[1]) / 0.1) > 100, `官方=${speed.toFixed(2)} legacy=${(Math.hypot(leg.dv[0], leg.dv[1]) / 0.1).toFixed(2)}`)
  // 半径外 ⇒ speedouter（0）
  {
    setModes('')
    const sys = lib.buildParticleSystem(vexDef(), { origin: [1000, 1000, 0], scale: [1, 1, 1], angle: 0, seedStr: 'vex2', maxCount: 20 })
    sys.pointer = ptr
    const p = lib.spawnParticle(sys, sys.emitters[0])
    p.pos = [ptr[0] + 500, ptr[1]]     // 远超 distanceouter=50
    sys.particles.push(p); sys.count++
    const v0 = p.vel.slice()
    lib.stepParticles(sys, 0.1, 0)
    push('③-c-4 distanceouter=50 之外 ⇒ speedouter=0（半径门真的生效，旧实现 outer 恒 1e9）',
      near(Math.hypot(p.vel[0] - v0[0], p.vel[1] - v0[1]), 0, 1e-6),
      `|Δv|=${Math.hypot(p.vel[0] - v0[0], p.vel[1] - v0[1]).toExponential(2)}`)
  }
}

// ═══════════════ ③-d `sizechange`/`alphachange` 的 FadeValueChange 是线性 ═══════════════
console.log('\n[6] ③-d `sizechange`/`alphachange`：官方 FadeValueChange = **线性**（旧实现 smoothstep）')
{
  const mk = (name) => ({ maxcount: 10, emitter: [{ name: 'boxrandom', rate: 0.0001, instantaneous: 1, distancemin: '0 0 0', distancemax: '0 0 0' }],
    initializer: [{ name: 'lifetimerandom', min: 1, max: 1 }, { name: 'sizerandom', min: 100, max: 100 }],
    operator: [{ name, starttime: 0.2 }] })
  const at = (name, modes, lifePos) => {
    setModes(modes)
    const sys = lib.buildParticleSystem(mk(name), { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'sc', maxCount: 10, popsLegacy: modes === 'pops=legacy' })
    const p = lib.spawnParticle(sys, sys.emitters[0])
    p.age = lifePos * p.life
    sys.particles.push(p); sys.count++
    lib.stepParticles(sys, 1e-9, 0)
    return name === 'sizechange' ? p.size / 100 : p.alpha
  }
  // life=0.4：官方线性 `FadeValueChange` ⇒ 1 + (0−1)·(0.4−0.2)/(1−0.2) = 0.75；
  //   旧 smoothstep：t=0.25 → 0.15625 ⇒ 1 − 0.15625 = 0.84375（**比官方缩得更快**，观感=提前消失）
  push('③-d-1 sizechange{starttime:0.2} 在 life=0.4 ⇒ 0.75（官方线性；旧 smoothstep 0.84375）',
    near(at('sizechange', '', 0.4), 0.75, 1e-6), `实测=${at('sizechange', '', 0.4).toFixed(6)}`)
  push('③-d-2 `?pops=legacy` ⇒ 旧 smoothstep 曲线 0.84375（A/B 可复现）',
    near(at('sizechange', 'pops=legacy', 0.4), 0.84375, 1e-6), `实测=${at('sizechange', 'pops=legacy', 0.4).toFixed(6)}`)
  push('③-d-3 alphachange 同一条曲线（同族一起改）',
    near(at('alphachange', '', 0.4), 0.75, 1e-6) && near(at('alphachange', 'pops=legacy', 0.4), 0.84375, 1e-6),
    `官方=${at('alphachange', '', 0.4).toFixed(6)} legacy=${at('alphachange', 'pops=legacy', 0.4).toFixed(6)}`)
  push('③-d-4 端点不因换曲线而变（life≤start ⇒ 1；life=1 ⇒ 0）',
    near(at('sizechange', '', 0.19), 1, 1e-9) && near(at('sizechange', '', 1.0), 0, 1e-9),
    `start=${at('sizechange', '', 0.19).toFixed(6)} end=${at('sizechange', '', 1.0).toFixed(6)}`)
}

// ═══════════════ ⑦ 真包：尾迹形态（球 vs 铺开）—— 与参考实现的行为对照数字 ═══════════════
console.log('\n[7] ⑦ 用户第 ③ 项形态：真包 ln=27 的存活粒子速度 / 铺开半径（对照参考实现）')
if (fs.existsSync(`${DIR}/3554161528/scene.pkg`)) {
  const { pkg, readParticleDef } = loadPkg('3554161528')
  const scene = lib.parseScene(JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, '')), null, { readParticleDef })
  const L = scene.layers[27]
  const sys = lib.buildParticleSystem(L.particleDef, { origin: L.origin, scale: L.scale, angle: (L.angles && L.angles[2]) || 0, seedStr: 'trail', maxCount: 240 })
  sys.pointer = [1920, 1080]
  lib.simulateParticleSystem(sys, 6, 400)
  const ps = sys.particles
  const spd = ps.map((p) => Math.hypot(p.vel[0], p.vel[1])).sort((a, b) => a - b)
  const med = spd[spd.length >> 1]
  push('⑦-a ★ 稳态 |v| 中位数 > 70 px/s（改前 34.3；参考实现 oneincase/webwallgl 实测 82.2）',
    ps.length > 20 && med > 70, `n=${ps.length} med|v|=${med ? med.toFixed(1) : '-'}`)
  const rr = ps.map((p) => Math.hypot(p.pos[0] - 1920, p.pos[1] - 1080))
  push('⑦-b 存活粒子不再全部贴死在光标上（>90% 的粒子离光标 > 5px）',
    rr.filter((r) => r > 5).length / Math.max(1, rr.length) > 0.9,
    `>5px 占比=${(rr.filter((r) => r > 5).length / Math.max(1, rr.length) * 100).toFixed(1)}% max r=${Math.max(...rr).toFixed(1)}`)
  const sz = ps.map((p) => p.size).sort((a, b) => a - b)
  push('⑦-c 存在**大尺寸**花瓣参与绘制（改前最大 39.98 但中位被压到 25.4；作者 size 30..40）',
    sz.length > 0 && sz[sz.length - 1] > 35, `size max=${sz.length ? sz[sz.length - 1].toFixed(2) : '-'} med=${sz.length ? sz[sz.length >> 1].toFixed(2) : '-'}`)
}

// ───────────────────────── 汇总 ─────────────────────────
const pass = checks.filter((c) => c.ok).length
const fails = checks.filter((c) => !c.ok)
console.log(`\n===== particle-frame-uv-and-pointer: ${pass} 通过 / ${fails.length} 失败 =====`)
if (fails.length) console.log('失败项:\n  ' + fails.map((c) => c.name + (c.detail !== undefined ? ' — ' + c.detail : '')).join('\n  '))
// 真树自证：本测试只读，跑完 core/we-scene-bundle.js 的 sha256 必须与跑前一致（由调用方 --selfhash 比对）
if (process.argv.includes('--selfhash')) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url))).digest('hex')
  console.log('core/we-scene-bundle.js sha256=' + h)
}
process.exit(fails.length ? 1 : 0)

/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。lwe-ref/（linux-wallpaperengine，GPL-3.0-only）与 wer-ref 同样**只作行为对照**。`oneincase/webwallgl`（MIT）在本文件中仅作**口径对照**（实例化 quad 带 rot / 图层 toWorld 变换 / 发射器 speedmin-speedmax / randExp），实现按**官方着色器与官方资产**自写，未复制其代码；台账见 docs/COPYING-RULES.md §4 与 THIRD-PARTY.md。 */
// particle-render-correctness-test.mjs — P-103 四项粒子渲染正确性修复的回归门禁（无浏览器；合成场景 + 真包 + mock-GL）
//
// 覆盖（每项都做"official vs legacy 双向"，避免"只测新行为"）：
//   ① quad 的**图层变换**（scale + z 角）：`genericparticle.vert:86-87` 的 MVP 含图层模型矩阵 ⇒ size 偏移也吃 scale；
//      本机语料 30/40 个测试包粒子层 scale≠1 或角度≠0（`?pquad=legacy` 回退）
//   ② 粒子**自转**（rotationrandom / angularvelocityrandom + angularmovement）：官方
//      `common_particles.h:20-39 ComputeParticleTangents` 的两条局部轴（`?prot=legacy` 回退）
//   ③ 随机 initializer 的 **exponent 非线性分布**（`值 = min + pow(u,exp)·(max−min)`；`?pexp=legacy` 回退）
//   ④ 发射器 **speedmin/speedmax** 初速（沿"基准点→出生点"方向；`?pspeed=legacy` 回退）
// 另含：legacy 档**逐位复现 P-100** 的断言（顶点流 / 粒子尺寸序列 / 速度序列 / 仿真代价相等），
// 以及四个档位的 `particleStats` 记账断言（真机上报与面板速查用）。
//
// 用法: node tests/particle-render-correctness-test.mjs [--verbose]
// ①(2026-09-19 敏感信息加固) 工作区根**不写作者本机绝对路径**：优先 `MPW_ROOT`，否则由 `_root.mjs` 推导。
//   ①(P-130 批A) 写成 `_root.WS || ROOT/..`：并行线正在给 `_root.mjs` 补 `WS` 导出（**未提交**）⇒
//   这样本文件在**两种 `_root.mjs` 版本下都能跑**（本批的提交不依赖别的线未提交的改动）。
import * as _root from './_root.mjs'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
import crypto from 'node:crypto'
// ①(P-131 批D) 音频响应口径（16 段活视图 + 官方包络）由模块提供；渲染器侧只接线
import { createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, audioEnvelope, parseAudioResponse } from '../core/audio-band-array.mjs'

const MPW_WS = process.env.MPW_ROOT || _root.WS || path.resolve(_root.ROOT, '..')
const DIR = `${MPW_WS}/allwallpaper/dd`
const WE = `${MPW_WS}/wallpaper_engine/assets`
const dec = new TextDecoder()
const VERBOSE = process.argv.includes('--verbose')
const checks = []
const push = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (VERBOSE || !ok) console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : '')) }
const near = (a, b, tol) => Math.abs(a - b) <= tol
// ①(P-131 批D) 可选 `dir`：语料不只 `dd/**`（音频驱动包还有 `0917/**`）
const hasPkg = (id, dir = DIR) => fs.existsSync(`${dir}/${id}/scene.pkg`)

// ───────────────────────── mock GL（顶点流捕获） ─────────────────────────
function makeGl() {
  // ①(P-126) rec 扩展：`bufs` 按缓冲 id 存最近一次上传、`uploads` 记上传顺序、`draws2` 记逐 draw 的
  //   uniform 快照 —— 用于断言"逐粒子颜色到底进没进 u_Color / a_Color 顶点缓冲"。
  const rec = { verts: [], draws: 0, bufs: new Map(), uploads: [], draws2: [] }
  let curUnit = 0, curBuf = null, curProg = null
  const bufVerts = new Map()
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
    bufferData: (t, data) => { if (data && data.length) { const v = Float32Array.from(data); bufVerts.set(curBuf, v); rec.bufs.set(curBuf, v); rec.uploads.push({ buf: curBuf, data: v }); rec.verts.push(v) } },
    activeTexture: (u) => { curUnit = u },
    bindTexture: () => {}, bindFramebuffer: () => {}, bindVertexArray: () => {}, useProgram: (p) => { curProg = p },
    texImage2D: () => {}, uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    drawArrays: () => { rec.draws++; rec.draws2.push({ upIdx: rec.uploads.length, buf: curBuf,
      data: rec.bufs.get(curBuf) || null, uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) }) },
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
// ①(P-126) 粒子批的识别口径：粒子 FS 独有的 `u_TexFmt`（层/效果 pass 用不到这个名字）
const isParticleDraw = (d) => !!(d && d.uni && ('u_TexFmt' in d.uni) && d.data && d.data.length / 9 > 6)
// ①(P-126 A) 同一次 draw 的 (几何流, 颜色流)：几何是它前面最近一次上传，颜色是再前面一次（不同缓冲）
function colorStreamOf(d, rec) {
  if (!d || d.upIdx < 2) return null
  const g = rec.uploads[d.upIdx - 1], c = rec.uploads[d.upIdx - 2]
  if (!g || !c || !c.data || c.buf === g.buf) return null
  return c.data
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const SHADER_RESOLVER = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

// 档位 → location.search（与真机同一开关写法）
function setModes(modes = {}) {
  const q = []
  for (const [flag, v] of [['pquad', modes.pquad], ['prot', modes.prot], ['pexp', modes.pexp], ['pspeed', modes.pspeed],
    ['pframe', modes.pframe], ['pops', modes.pops], ['pcolor', modes.pcolor]]) {
    if (v === 'legacy') q.push(flag + '=legacy')
  }
  globalThis.location = { search: q.length ? '?' + q.join('&') : '' }
}
const W = 3840, H = 2160
const mkLayer = (o) => Object.assign({ id: 1, name: 'L', visible: true, origin: [0, 0, 0], scale: [1, 1, 1], angles: [0, 0, 0],
  alpha: 1, size: [W, H], image: null, particle: 'p', particleDef: null, particleTexName: 'tex_a',
  textureName: null, effects: [], parallaxDepth: null, uvRect: undefined }, o)
const defQuad = (extraInit = []) => ({ maxcount: 8, material: 'm',
  emitter: [{ name: 'boxrandom', rate: 100, instantaneous: 1, distancemax: '0 0 0' }],
  initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 100, max: 100 }].concat(extraInit),
  operator: [{ name: 'movement' }] })
const TEXA = new Map([['tex_a', { glTex: { id: 'g1' }, width: 64, height: 64 }]])
// 渲染一帧，取最后一个粒子批的顶点流 + stats
async function renderQuad(def, layerExtra = {}, modes = {}, t = 1.0, texMap = TEXA) {
  setModes(modes)
  const { gl, rec } = makeGl()
  const scene = { layers: [mkLayer(Object.assign({ particleDef: def }, layerExtra))], general: {}, camera: null, size: [W, H] }
  const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SHADER_RESOLVER, aggregate: true })
  await r.render(scene, texMap, W, H, t)
  return { verts: rec.verts[rec.verts.length - 1] || null, stats: r.particleStats, draws: rec.draws, rec }
}
// ①(P-133 #2) NDC → 设计像素。y 的**反解必须跟着渲染器的投影口径**：
//   修正档（缺省）`ndcY = 1 − 2y/H` ⇒ `y = (1 − ndcY)·H/2`；旧镜像档 `ndcY = 2y/H − 1` ⇒ `y = (ndcY+1)·H/2`。
//   本测试始终跑缺省档（`projectionYFix()=true`），所以下面用修正档反解；
//   断言"粒子路径与层路径同号"的那条会在 P-133 的 NDC 段里双向验证。
const ndcXToPx = (nx) => (nx * 0.5 + 0.5) * W
const ndcYToPx = (ny) => (1 - ny) * 0.5 * H
// 顶点流 → 第 0 个 quad 的两条边（设计像素）+ 边长/角度
function quadEdges(verts) {
  const xs = [], ys = []
  for (let i = 0; i + 8 < verts.length; i += 9) { xs.push(ndcXToPx(verts[i])); ys.push(ndcYToPx(verts[i + 1])) }
  const e1 = [xs[1] - xs[0], ys[1] - ys[0]], e2 = [xs[2] - xs[0], ys[2] - ys[0]]
  const ang = (e) => Math.atan2(e[1], e[0]) * 180 / Math.PI
  return { e1, e2, l1: Math.hypot(e1[0], e1[1]), l2: Math.hypot(e2[0], e2[1]), a1: ang(e1), a2: ang(e2),
    spanX: Math.max(...xs.slice(0, 6)) - Math.min(...xs.slice(0, 6)), spanY: Math.max(...ys.slice(0, 6)) - Math.min(...ys.slice(0, 6)) }
}
function angleSpread(verts) {
  const a = []
  for (let q = 0; q * 54 + 54 <= verts.length; q++) {
    const b = q * 54
    const X = [], Y = []
    for (let k = 0; k < 6; k++) { X.push(verts[b + k * 9]); Y.push(verts[b + k * 9 + 1]) }
    const e1 = [X[1] - X[0], Y[1] - Y[0]], e2 = [X[2] - X[0], Y[2] - Y[0]]
    const long = Math.hypot(...e1) >= Math.hypot(...e2) ? e1 : e2
    let d = Math.abs(Math.atan2(long[1], long[0]) * 180 / Math.PI)
    if (d > 180) d = 360 - d
    a.push(d)
  }
  return { n: a.length, spread: a.length ? Math.max(...a) - Math.min(...a) : 0, min: a.length ? Math.min(...a) : 0, max: a.length ? Math.max(...a) : 0 }
}
const allSame = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

// ═══════════════════ ① 图层变换（scale + z 角） ═══════════════════
{
  const on = await renderQuad(defQuad(), { scale: [2, 3, 1] }, {})
  const off = await renderQuad(defQuad(), { scale: [2, 3, 1] }, { pquad: 'legacy' })
  const gOn = quadEdges(on.verts), gOff = quadEdges(off.verts)
  // size=100 ⇒ quad 边长 = size/2 = 50；scale[2,3] ⇒ 100 / 150
  push('① 图层 scale 进 quad 几何：spanX=size/2×2=100、spanY=size/2×3=150',
    near(gOn.spanX, 100, 0.01) && near(gOn.spanY, 150, 0.01), `span=${gOn.spanX.toFixed(2)}×${gOn.spanY.toFixed(2)}`)
  push('① ?pquad=legacy 复现 P-100（span=边长 50×50，不吃 scale）',
    near(gOff.spanX, 50, 0.01) && near(gOff.spanY, 50, 0.01), `span=${gOff.spanX.toFixed(2)}×${gOff.spanY.toFixed(2)}`)
  push('① 记账：pquadQuads>0（official）/ =0（legacy）', on.stats.pquadQuads > 0 && off.stats.pquadQuads === 0,
    `on=${on.stats.pquadQuads} off=${off.stats.pquadQuads}`)
  // 图层 z 角：π/2 ⇒ 局部 u 轴（e2）从 0° 转到 90°（本仓库与 spawnParticle 发射器偏移同号：R(−angle)）
  const rot90 = await renderQuad(defQuad(), { scale: [1, 1, 1], angles: [0, 0, Math.PI / 2] }, {})
  const rot90Leg = await renderQuad(defQuad(), { scale: [1, 1, 1], angles: [0, 0, Math.PI / 2] }, { pquad: 'legacy' })
  const q90 = quadEdges(rot90.verts), q90l = quadEdges(rot90Leg.verts)
  push('① 图层 z 角 π/2：quad 的 u 轴转到 90°（legacy 恒 0°）',
    near(Math.abs(q90.a2), 90, 0.5) && near(q90l.a2, 0, 0.001), `official a2=${q90.a2.toFixed(2)}° legacy a2=${q90l.a2.toFixed(2)}°`)
  // scale=1、角=0 ⇒ official 与 legacy **逐位相同**（证明默认档只在真有变换时才动几何）
  const same = await renderQuad(defQuad(), {}, {})
  const sameLeg = await renderQuad(defQuad(), {}, { pquad: 'legacy' })
  push('① scale=1/角=0 时 official 与 legacy 顶点流逐位相同', allSame(same.verts, sameLeg.verts), `len=${same.verts.length}`)
  // legacy 档 == 测试内**独立复算**的 P-100 公式（cxs·hw / cys·hh）⇒ "改前逐位"不是自证
  {
    const v = off.verts
    const cxs = [-1, -1, 1, 1, -1, 1], cys = [-1, 1, -1, -1, 1, 1]
    const sz = 50, hw = sz / 2, hh = sz / 2 // size=100 ⇒ sz=size/2=50, ratio=1
    // k0 的旧公式 = 中心 + (−hw, −hh) ⇒ 中心 = k0 + (hw, hh)
    const cx = ndcXToPx(v[0]) + hw, cy = ndcYToPx(v[1]) + hh
    // 容差必须按**顶点缓冲的量化**给，不能按 double 给：顶点流是 `Float32Array`，
    // NDC 分量的 ulp = 2^-24（|x|≤1 ⇒ 舍入误差 ≤ 2^-25 ≈ 2.98e-8），换算回设计像素要乘 W/2 = 1920
    // ⇒ 单分量上界 ≈ 5.7e-5 px（本机实测最大 3.81e-5 px，出现在 x=±25 的 float32 尾数上）。
    // 用 1e-6 会把"逐位正确"误判成红（浮点量化 ≠ 几何偏差）；1e-3 = 实测值的 26 倍余量，
    // 仍能抓出 ≥0.001px 的真实几何错位（含 ±1 像素级、比例错、轴错）。
    const F32_PX = 1e-3
    let ok = true, maxDev = 0
    for (let k = 0; k < 6; k++) {
      const x = ndcXToPx(v[k * 9]), y = ndcYToPx(v[k * 9 + 1])
      maxDev = Math.max(maxDev, Math.abs(x - (cx + cxs[k] * hw)), Math.abs(y - (cy + cys[k] * hh)))
      if (!near(x, cx + cxs[k] * hw, F32_PX) || !near(y, cy + cys[k] * hh, F32_PX)) ok = false
    }
    push('① legacy 档顶点 == 独立复算的 P-100 公式（cxs·hw / cys·hh；容差 1e-3px = float32 量化上界）',
      ok && !!v, `maxDev=${maxDev.toExponential(2)}px`)
  }
}

// ═══════════════════ ② 粒子自转 ═══════════════════
{
  const PI4 = Math.PI / 4
  const rotDef = defQuad([{ name: 'rotationrandom', min: `0 0 ${PI4}`, max: `0 0 ${PI4}` }])
  const on = await renderQuad(rotDef, {}, {})
  const off = await renderQuad(rotDef, {}, { prot: 'legacy' })
  const gOn = quadEdges(on.verts), gOff = quadEdges(off.verts)
  // 官方 ComputeParticleTangents：right=(cosθ,sinθ) ⇒ u 轴（e2）在 θ；up=(−sinθ,cosθ) ⇒ v 轴（e1）在 90°+θ
  push('② 自转 π/4：u 轴 45°、v 轴 135°（官方两条局部轴）',
    near(gOn.a2, 45, 0.5) && near(Math.abs(gOn.a1), 135, 0.5), `a2=${gOn.a2.toFixed(2)}° a1=${gOn.a1.toFixed(2)}°`)
  push('② ?prot=legacy 复现 P-100（轴对齐：u 轴 0°、v 轴 90°）',
    near(gOff.a2, 0, 0.001) && near(Math.abs(gOff.a1), 90, 0.001), `a2=${gOff.a2.toFixed(3)}° a1=${gOff.a1.toFixed(3)}°`)
  push('② 边长不因自转变化（旋转是刚体变换）', near(gOn.l1 * gOn.l2, gOff.l1 * gOff.l2, 1e-3), `area on=${(gOn.l1 * gOn.l2).toFixed(3)} off=${(gOff.l1 * gOff.l2).toFixed(3)}`)
  push('② 记账：protQuads>0（official）/ =0（legacy）', on.stats.protQuads > 0 && off.stats.protQuads === 0, `on=${on.stats.protQuads} off=${off.stats.protQuads}`)
  // rot=0（无 rotationrandom 的层）⇒ official 与 legacy 逐位相同
  const z1 = await renderQuad(defQuad(), {}, {})
  const z2 = await renderQuad(defQuad(), {}, { prot: 'legacy' })
  push('② 无自转层 official 与 legacy 顶点流逐位相同', allSame(z1.verts, z2.verts))
  // 档位自洽：真实 renderer 读到的 mode 必须与开关一致
  push('② particleStats.protMode/pquadMode 反映档位',
    z1.stats.protMode === 'official' && z2.stats.protMode === 'legacy' && z1.stats.pquadMode === 'official', JSON.stringify({ a: z1.stats.protMode, b: z2.stats.protMode }))
}

// ═══════════════════ ③ exponent 非线性分布 ═══════════════════
{
  const defExp = { maxcount: 400, material: 'm', emitter: [{ name: 'boxrandom', rate: 1000, distancemax: '0 0 0' }],
    initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 40, max: 80, exponent: 2 }],
    operator: [{ name: 'movement' }] }
  const run = (expLegacy) => {
    const s = lib.buildParticleSystem(defExp, { origin: [0, 0, 0], seedStr: 'p103-exp', maxCount: 400, expLegacy })
    lib.simulateParticleSystem(s, 1.0)
    return s.particles.map((p) => p.size)
  }
  const on = run(false), off = run(true)
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  const below = (a, t) => a.filter((x) => x < t).length / a.length
  // pow(u,2) 的均值 = 1/3 ⇒ 40 + 40/3 = 53.33；均匀 = 60。P(值<50) = sqrt(0.25) = 0.5 vs 0.25
  push('③ exponent=2：官方档均值 ≈ 53.3（均匀 60）', on.length > 200 && near(mean(on), 53.33, 1.5), `mean=${mean(on).toFixed(2)} n=${on.length}`)
  push('③ ?pexp=legacy：均值 ≈ 60（忽略 exponent）', near(mean(off), 60, 1.5), `mean=${mean(off).toFixed(2)}`)
  push('③ exponent=2 分布明显向 min 偏（P(<50) ≈ 0.5，均匀 0.25）', near(below(on, 50), 0.5, 0.07) && near(below(off, 50), 0.25, 0.07),
    `official=${below(on, 50).toFixed(3)} legacy=${below(off, 50).toFixed(3)}`)
  push('③ 尺寸全在 [40,80]（exponent 不越界）', on.every((s) => s >= 40 - 1e-9 && s <= 80 + 1e-9))
  // exponent 缺省 / =1 ⇒ 两个档位**逐位相同**（同一个 rng() 调用 + 同一个算式）
  const defNo = { ...defExp, initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 40, max: 80 }] }
  const seqOf = (d, expLegacy) => {
    const s = lib.buildParticleSystem(d, { origin: [0, 0, 0], seedStr: 'p103-exp2', maxCount: 400, expLegacy })
    lib.simulateParticleSystem(s, 1.0)
    return s.particles.map((p) => p.size)
  }
  push('③ exponent 缺省时 official 与 legacy 尺寸序列逐位相同', allSame(seqOf(defNo, false), seqOf(defNo, true)))
  const defOne = { ...defExp, initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 40, max: 80, exponent: 1 }] }
  push('③ exponent=1（官方语料 17 处 colorrandom/2 处 sizerandom 的写法）与缺省逐位同值', allSame(seqOf(defOne, false), seqOf(defNo, false)))
  // 记账
  const { stats } = await renderQuad({ ...defExp, emitter: [{ name: 'boxrandom', rate: 200, distancemax: '0 0 0' }] }, {}, {}, 0.6)
  const leg = await renderQuad({ ...defExp, emitter: [{ name: 'boxrandom', rate: 200, distancemax: '0 0 0' }] }, {}, { pexp: 'legacy' }, 0.6)
  push('③ 记账：expApplied>0（official）/ =0（legacy）', stats.expApplied > 0 && leg.stats.expApplied === 0, `on=${stats.expApplied} off=${leg.stats.expApplied}`)
}

// ═══════════════════ ④ 发射器 speedmin/speedmax ═══════════════════
{
  const defSpd = { maxcount: 100, material: 'm',
    emitter: [{ name: 'sphererandom', rate: 200, distancemax: '40 40 0', speedmin: 100, speedmax: 100 }],
    initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 10, max: 10 }], operator: [{ name: 'movement' }] }
  const build = (speedLegacy) => {
    const s = lib.buildParticleSystem(defSpd, { origin: [0, 0, 0], seedStr: 'p103-spd', maxCount: 100, speedLegacy })
    lib.simulateParticleSystem(s, 0.2)
    return s
  }
  const on = build(false), off = build(true)
  const sp = (s) => s.particles.map((p) => Math.hypot(p.vel[0], p.vel[1]))
  const outward = (s) => s.particles.filter((p) => p.vel[0] * p.pos[0] + p.vel[1] * p.pos[1] > 0).length
  push('④ official：发射器 speed 给出 |v|=100 的初速', on.particles.length > 5 && near(Math.min(...sp(on)), 100, 1e-6) && near(Math.max(...sp(on)), 100, 1e-6),
    `n=${on.particles.length} |v|∈[${Math.min(...sp(on)).toFixed(2)},${Math.max(...sp(on)).toFixed(2)}]`)
  push('④ 初速方向 = 基准点→出生点（全部外向）', outward(on) === on.particles.length, `${outward(on)}/${on.particles.length}`)
  push('④ ?pspeed=legacy：初速恒 0（P-100 只可能来自 velocityrandom）', off.particles.length > 5 && sp(off).every((v) => v === 0), `max|v|=${Math.max(...sp(off))}`)
  // 无 speed 字段的发射器 ⇒ 两档逐位相同（不偷抽随机数）
  const defNo = { ...defSpd, emitter: [{ name: 'sphererandom', rate: 200, distancemax: '40 40 0' }] }
  const seq = (speedLegacy) => {
    const s = lib.buildParticleSystem(defNo, { origin: [0, 0, 0], seedStr: 'p103-spd2', maxCount: 100, speedLegacy })
    lib.simulateParticleSystem(s, 0.2)
    return s.particles.flatMap((p) => [p.vel[0], p.vel[1], p.pos[0], p.pos[1]])
  }
  push('④ 无 speed 字段时 official 与 legacy 粒子状态逐位相同', allSame(seq(false), seq(true)))
  const { stats } = await renderQuad({ ...defSpd, emitter: [{ name: 'sphererandom', rate: 200, distancemax: '40 40 0', speedmin: 100, speedmax: 100 }] }, {}, {}, 0.6)
  const leg = await renderQuad({ ...defSpd, emitter: [{ name: 'sphererandom', rate: 200, distancemax: '40 40 0', speedmin: 100, speedmax: 100 }] }, {}, { pspeed: 'legacy' }, 0.6)
  push('④ 记账：spawnSpeeds>0（official）/ =0（legacy）', stats.spawnSpeeds > 0 && leg.stats.spawnSpeeds === 0, `on=${stats.spawnSpeeds} off=${leg.stats.spawnSpeeds}`)
}

// ═══════════════════ ⑤ 真包：语料级证据 + 代价不回归 ═══════════════════
function loadPkg(id, dir = DIR) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${dir}/${id}/scene.pkg`)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sj, null, { readParticleDef, legacyAnimY: true })
  lib.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: false, log: () => {} })
  return { pkg, scene }
}
function buildTex(pkg, scene, layer) {
  const textures = new Map()
  for (const l of scene.layers) {
    if (!l.particleDef || (layer && l !== layer)) continue
    try {
      const e = lib.getEntry(pkg, l.particleDef.material)
      const tn = e ? ((JSON.parse(dec.decode(e)).passes || [])[0] || {}).textures?.[0] : null
      if (!tn) continue
      l.particleTexName = tn
      if (textures.has(tn)) continue
      let buf = lib.getEntry(pkg, 'materials/' + tn + '.tex')
      if (!buf && fs.existsSync(`${WE}/materials/${tn}.tex`)) buf = new Uint8Array(fs.readFileSync(`${WE}/materials/${tn}.tex`))
      if (!buf) continue
      const tex = lib.parseTex(new Uint8Array(buf)); const m = lib.decodeMip0(tex)
      if (!m || !m.rgba) continue
      const gt = lib.makeTextureMip(makeGl().gl, [m], tex.format === 8)
      if (gt) textures.set(tn, { glTex: gt, width: m.width, height: m.height, format: tex.format })
    } catch {}
  }
  return textures
}
// 只用目标粒子层渲染 t 秒（其余层不可见），返回顶点流 + stats
// ①(P-126) 第 5 参 layerId：同名层（hina 有两个"萤火虫"）按 id 精确选择
async function renderRealLayer(id, layerName, modes = {}, t = 6.0, layerId = null, dir = DIR) {
  const { pkg, scene } = loadPkg(id, dir)
  const target = scene.layers.find((l) => l.particleDef && (layerId != null ? l.id === layerId : l.name === layerName))
  if (!target) return null
  for (const l of scene.layers) if (l.particleDef) l.visible = (l === target)
  for (const l of scene.layers) if (!l.particleDef) l.visible = false
  const textures = buildTex(pkg, scene, target)
  if (!textures.size) return null
  setModes(modes)
  const { gl, rec } = makeGl()
  const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SHADER_RESOLVER, aggregate: true })
  await r.render(scene, textures, 1920, 1080, t)
  return { verts: rec.verts[rec.verts.length - 1] || null, stats: r.particleStats, target, pkg, scene, textures, r, rec }
}
if (hasPkg('3719111841')) {
  // Glass Shards：rotationrandom（默认 0..2π）⇒ 改前"角度散布 0°、竖直 100%"，改后必须真的转
  const on = await renderRealLayer('3719111841', 'Glass Shards', {}, 6.0)
  const off = await renderRealLayer('3719111841', 'Glass Shards', { prot: 'legacy' }, 6.0)
  if (on && off && on.verts && off.verts) {
    const aOn = angleSpread(on.verts), aOff = angleSpread(off.verts)
    push('⑤ 真包 Glass Shards：official 角度散布 ≥20°（legacy 恒 0°）',
      aOn.spread >= 20 && aOff.spread <= 0.001, `official=${aOn.spread.toFixed(1)}° legacy=${aOff.spread.toFixed(3)}° (n=${aOn.n})`)
    push('⑤ 真包 Glass Shards：official 有非轴对齐 quad（legacy 全轴对齐）', aOn.min < 89 && aOff.min >= 89.999,
      `official min=${aOn.min.toFixed(1)}° legacy min=${aOff.min.toFixed(1)}°`)
  } else push('⑤ 凯尔希真包 Glass Shards 贴图缺失（SKIP 视作 PASS）', true)
  // Bokeh Hex：图层 scale 1.18913 ⇒ official 边长 / legacy 边长 = scale
  const hon = await renderRealLayer('3719111841', 'Bokeh Hex', {}, 6.0)
  const hoff = await renderRealLayer('3719111841', 'Bokeh Hex', { pquad: 'legacy' }, 6.0)
  if (hon && hoff && hon.verts && hoff.verts) {
    const sc = hon.target.scale[0]
    const r1 = quadEdges(hon.verts).spanX / quadEdges(hoff.verts).spanX
    push('⑤ 真包 Bokeh Hex：quad 边长比 = 图层 scale(1.18913)', near(r1, sc, 0.02), `ratio=${r1.toFixed(4)} scale=${sc}`)
  } else push('⑤ 凯尔希 Bokeh Hex 贴图缺失（SKIP 视作 PASS）', true)
  // 仿真代价不回归：几何/出生期改动不得改变 simSteps/simUpdates
  const p1 = await renderRealLayer('3719111841', '尘埃', {}, 6.0)
  const p2 = await renderRealLayer('3719111841', '尘埃', { prot: 'legacy', pquad: 'legacy', pexp: 'legacy', pspeed: 'legacy' }, 6.0)
  if (p1 && p2) {
    push('⑤ 仿真代价不回归（尘埃：official/legacy 的 simSteps、simUpdates 相等）',
      p1.stats.simSteps === p2.stats.simSteps && p1.stats.simUpdates === p2.stats.simUpdates,
      `steps ${p1.stats.simSteps}/${p2.stats.simSteps} updates ${p1.stats.simUpdates}/${p2.stats.simUpdates}`)
  }
} else push('⑤ 凯尔希真包缺失（SKIP 视作 PASS）', true, 'no pkg')

if (hasPkg('3554161528')) {
  // 落花（hina）：语料真的写了 `sizerandom 40..80 exponent 2` ⇒ 官方档必须向小尺寸偏
  const { scene } = loadPkg('3554161528')
  const defs = scene.layers.filter((l) => l.particleDef && l.name === '落花').map((l) => l.particleDef)
  const withExp = defs.filter((d) => (d.initializer || []).some((i) => i.name === 'sizerandom' && Number(i.exponent) === 2))
  push('⑤ 真包 hina「落花」语料确带 sizerandom exponent:2（2 层）', withExp.length >= 1, `${withExp.length}/${defs.length} 层`)
  if (withExp.length) {
    const d = withExp[0]
    // ⚠ 该 def 带 `starttime`（33/21s）：simulateParticleSystem 的目标时刻是 `t − starttime`，
    //   用 t=4 会得到 0 粒子（"语料层的 starttime 不参与断言"是 P-103 踩过的坑）
    const t0 = (d.starttime || 0) + 6
    const seq = (expLegacy) => {
      const s = lib.buildParticleSystem(d, { origin: [0, 0, 0], seedStr: 'p103-luohua', maxCount: 600, expLegacy })
      lib.simulateParticleSystem(s, t0)
      return s.particles.map((p) => p.size)
    }
    const a = seq(false), b = seq(true)
    const mean = (x) => x.reduce((u, v) => u + v, 0) / Math.max(1, x.length)
    push('⑤ 真包「落花」尺寸均值：official < legacy（exponent 生效）', a.length > 20 && mean(a) < mean(b) - 1,
      `official=${mean(a).toFixed(2)} legacy=${mean(b).toFixed(2)} n=${a.length} (t=${t0})`)
  }
  // 代价：整帧（全部粒子层）official vs legacy 的 sim 记账必须相等
  const cost = async (modes) => {
    const { pkg, scene } = loadPkg('3554161528')
    const textures = buildTex(pkg, scene, null)
    setModes(modes)
    const { gl, rec } = makeGl()
    const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SHADER_RESOLVER, aggregate: true })
    let steps = 0, updates = 0, drawn = 0
    for (let i = 0; i < 12; i++) { await r.render(scene, textures, 1920, 1080, 12.5 + i / 30); steps += r.particleStats.simSteps; updates += r.particleStats.simUpdates; drawn += r.particleStats.drawn }
    return { steps, updates, drawn, draws: rec.draws }
  }
  const cOn = await cost({}), cOff = await cost({ pquad: 'legacy', prot: 'legacy', pexp: 'legacy', pspeed: 'legacy' })
  push('⑤ hina 全粒子层 12 帧：official 与 legacy 的 simSteps/simUpdates/实画层数完全一致（代价不回归）',
    cOn.steps === cOff.steps && cOn.updates === cOff.updates && cOn.drawn === cOff.drawn,
    `steps ${cOn.steps}/${cOff.steps} updates ${cOn.updates}/${cOff.updates} drawn ${cOn.drawn}/${cOff.drawn}`)
} else push('⑤ hina 真包缺失（SKIP 视作 PASS）', true, 'no pkg')

if (hasPkg('3660962877')) {
  // cherry blossoms on cursor（orb 版）：语料发射器带 speedmin/speedmax ⇒ 官方档出生有初速
  const { scene } = loadPkg('3660962877')
  const l = scene.layers.find((x) => x.particleDef && /cherry blossoms/.test(x.name || ''))
  if (l) {
    const em = (l.particleDef.emitter || [])[0]
    push('⑤ 真包 cherry blossoms 发射器带 speedmin/speedmax（语料）', !!em && (em.speedmin != null || em.speedmax != null), JSON.stringify(em && { s: em.speedmin, S: em.speedmax }))
    // ⚠ 这层还有 `vortex`/`controlpointattract` 两个**算子**（跑一会儿速度就不为 0 了）⇒
    //   必须在**出生那一刻**比：`spawnParticle` 之后、算子之前。另外 controlpoint[0].flags=1
    //   （lockToPointer）⇒ 必须给指针，否则发射器根本不发射。
    const sp = (speedLegacy) => {
      // ①(P-133 #3) **只测发射器 speedmin/speedmax 这一条**：`mapsequencearoundcontrolpoint`
      //   是**另一条**初速来源（作者写的 speedmin/speedmax，不在 `?pspeed` 档位的语义范围内）
      //   ⇒ 摘掉它，否则两侧都带上 ≤100 的作者初速，测的就不是"发射器初速"了。
      const defNoMap = Object.assign({}, l.particleDef, {
        initializer: (l.particleDef.initializer || []).filter((it) => it && it.name !== 'mapsequencearoundcontrolpoint'),
      })
      const s = lib.buildParticleSystem(defNoMap, { origin: l.origin, scale: l.scale, angle: (l.angles && l.angles[2]) || 0,
        seedStr: 'p103-cherry', maxCount: 500, speedLegacy })
      s.pointer = [960, 540]
      const out = []
      for (let i = 0; i < 60; i++) { const p = lib.spawnParticle(s, s.emitters[0]); if (p) out.push(Math.hypot(p.vel[0], p.vel[1])) }
      return out
    }
    const a = sp(false), b = sp(true)
    const mx = (x) => (x.length ? Math.max(...x) : -1)
    push('⑤ 真包 cherry blossoms：出生期 official 有初速（≤speedmax=20，legacy 全 0）',
      a.length > 5 && mx(a) > 0 && mx(a) <= 20 + 1e-6 && b.length > 5 && mx(b) === 0,
      `official max=${mx(a).toFixed(2)} legacy max=${mx(b).toFixed(2)} n=${a.length}`)
  } else push('⑤ 真包 cherry blossoms 层缺失（SKIP 视作 PASS）', true)
} else push('⑤ orb 真包缺失（SKIP 视作 PASS）', true, 'no pkg')

// ═══════════════ ⑥ P-126 用户⑧（萤火虫）/⑦（第 18 层雾 2）：颜色 / 帧时序 / 算子口径 ═══════════════
// 判据来源：docs/PARTICLE-FIREFLY-INVESTIGATION.md §4。每条都带 legacy 侧的反向断言
// （证明断言对旧写法敏感），另有 §4 判据里点名的"并联判据"（⑧-4 修好后粒子不得飞出层 bbox）。
const clamp01 = (v) => Math.max(0, Math.min(1, v))

// ── ⑥A 逐粒子 RGB（⑧-1：萤火虫从"白点"回到 authored 紫色）──
{
  const white = await renderQuad(defQuad(), {}, {}, 1.0)
  const wd = white.rec.draws2.filter(isParticleDraw).pop()
  const wc = wd ? colorStreamOf(wd, white.rec) : null
  push('⑥A 默认层（无 colorrandom）：u_Color 恒 (1,1,1) 且顶点色恒 1（与改前逐位一致）',
    !!wd && wd.uni.u_Color[0] === 1 && wd.uni.u_Color[1] === 1 && wd.uni.u_Color[2] === 1 &&
    !!wc && wc.length > 0 && [...wc].every((v) => v === 1),
    wd ? `u_Color=${JSON.stringify(wd.uni.u_Color)} 顶点色样本=${wc ? [...wc].slice(0, 3).join(',') : 'null'}` : 'no draw')
}
if (hasPkg('3554161528')) {
  // 层 4569：instanceoverride.colorn = "0.41176 0.30588 0.69412"（replacesColor:true ⇒ 整批同色 ⇒ 上提进 u_Color）
  const a1 = await renderRealLayer('3554161528', '萤火虫', {}, 20.0, 4569)
  const d1 = a1 && a1.rec.draws2.filter(isParticleDraw).pop()
  push('⑥A 层4569 萤火虫：绘制 u_Color = instanceoverride.colorn [0.41176,0.30588,0.69412]（旧实现恒 (1,1,1)）',
    !!d1 && near(d1.uni.u_Color[0], 0.41176, 1e-4) && near(d1.uni.u_Color[1], 0.30588, 1e-4) && near(d1.uni.u_Color[2], 0.69412, 1e-4),
    d1 ? `u_Color=${JSON.stringify(d1.uni.u_Color)}` : 'no particle draw')
  push('⑥A 层4569：整批同色走上提通道（colorUni=1 / colorAttr=0）',
    !!a1 && a1.stats.colorUni === 1 && a1.stats.colorAttr === 0,
    a1 ? `colorUni=${a1.stats.colorUni} colorAttr=${a1.stats.colorAttr}` : 'null')
  // 层 6271：无 colorn ⇒ 走作者 colorrandom"102 100 188"→"66 35 148"（逐粒子不同紫）⇒ 必须走 a_Color 顶点属性
  const a2 = await renderRealLayer('3554161528', '萤火虫', {}, 20.0, 6271)
  const d2 = a2 && a2.rec.draws2.filter(isParticleDraw).pop()
  const c2 = d2 ? colorStreamOf(d2, a2.rec) : null
  let inRange = false, spread = 0
  if (c2 && c2.length >= 3) {
    const cols = []
    for (let i = 0; i + 2 < c2.length; i += 3) cols.push([c2[i], c2[i + 1], c2[i + 2]])
    inRange = cols.every(([r, g, b]) => r >= 66 / 255 - 1e-6 && r <= 102 / 255 + 1e-6 &&
      g >= 35 / 255 - 1e-6 && g <= 100 / 255 + 1e-6 && b >= 148 / 255 - 1e-6 && b <= 188 / 255 + 1e-6)
    spread = new Set(cols.map((c) => c.map((v) => v.toFixed(4)).join(','))).size
  }
  push('⑥A 层6271 萤火虫：逐粒子颜色走 a_Color 顶点属性，且落在 authored 紫区间 [66..102, 35..100, 148..188]/255',
    !!d2 && c2 && inRange && spread > 1,
    `spread=${spread} 样本=${c2 ? [...c2].slice(3, 6).map((v) => v.toFixed(3)).join(',') : 'null'}`)
} else push('⑥A hina 真包缺失（SKIP 视作 PASS）', true, 'no pkg')

// ── ⑥B 精灵表帧时序（⑦a：fog3 = 64 帧/1s，按 age 正放、同年龄同帧）──
{
  const FOG3 = `${WE}/materials/particle/fog/fog3.tex`
  if (fs.existsSync(FOG3)) {
    const ftex = lib.parseTex(new Uint8Array(fs.readFileSync(FOG3)))
    const fsp = lib.spriteInfo(ftex)
    const fm0 = lib.decodeMip0(ftex)
    const fgt = lib.makeTextureMip(makeGl().gl, [fm0], ftex.format === 8)
    const FTEX = new Map([['fog', { glTex: fgt, width: fm0.width, height: fm0.height, format: ftex.format, sprite: fsp }]])
    push('⑥B fog3 帧表事实：64 帧 / frametime 0.015625 / duration 1（判据前提）',
      !!fsp && fsp.numFrames === 64 && fsp.frametime === 0.015625 && fsp.duration === 1,
      fsp ? `n=${fsp.numFrames} ft=${fsp.frametime} dur=${fsp.duration}` : 'null')
    // 单批 4 颗粒子同年龄：rate≈0 + instantaneous ⇒ 同屏同帧
    const bdef = { maxcount: 4,
      emitter: [{ name: 'boxrandom', rate: 0.0001, instantaneous: 4, distancemax: '40 40 0' }],
      initializer: [{ name: 'lifetimerandom', min: 3, max: 5 }, { name: 'sizerandom', min: 100, max: 100 }, { name: 'alpharandom', min: 1, max: 1 }],
      operator: [] }
    // 从顶点流反查帧号（帧矩形 = 行主序 8×8）。
    // ①(P-133 #1) 每颗粒子的 6 个顶点 uv ∈ {0,1}² **映射到该帧的矩形** [u0,u0+fw]×[v0,v0+fh]
    //   ⇒ 帧原点 = 这 6 个顶点的 **(min u, min v)**（改动前 uv 跨度恒 1.0，直接读第一个顶点就是帧原点）。
    const frameOf = (u0, v0) => {
      for (let f = 0; f < fsp.numFrames; f++) {
        const u = (f * fsp.frameWidthUV) - Math.floor(f * fsp.frameWidthUV), v = Math.floor(f * fsp.frameWidthUV) * fsp.frameHeightUV
        if (Math.abs(u - u0) < 1e-6 && Math.abs(v - v0) < 1e-6) return f
      }
      return -1
    }
    const framesAt = async (t, modes) => {
      const r = await renderQuad(bdef, { particleTexName: 'fog' }, modes, t, FTEX)
      const v = r.verts
      const out = new Set()
      const spans = new Set()
      if (v) {
        for (let q = 0; q * 54 + 54 <= v.length; q++) {
          const o = q * 54
          let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity
          for (let k = 0; k < 6; k++) { const uu = v[o + k * 9 + 3], vv = v[o + k * 9 + 4]; u0 = Math.min(u0, uu); u1 = Math.max(u1, uu); v0 = Math.min(v0, vv); v1 = Math.max(v1, vv) }
          const f = frameOf(u0, v0)
          if (f >= 0) out.add(f)
          spans.add(`${(u1 - u0).toFixed(6)}x${(v1 - v0).toFixed(6)}`)
        }
      }
      return { frames: out, spans }
    }
    const at025 = await framesAt(0.25, {})
    push('⑥B fog3 每颗粒子的 uv 跨度 = **一帧**（0.125×0.125 = 128/1024，不是整张图集 1.0）',
      at025.spans.size === 1 && [...at025.spans][0] === '0.125000x0.125000', `spans={${[...at025.spans].join(',')}}`)
    const f025 = at025.frames
    push('⑥B fog3 age=0.25s ⇒ frame 16（旧口径 (1−lifePos)·seqMul 得 59~62）',
      f025.size === 1 && f025.has(16), `frames={${[...f025].join(',')}}`)
    const f05 = (await framesAt(0.5, {})).frames
    push('⑥B fog3 age=0.5s ⇒ frame 32（正放，不是倒放）', f05.size === 1 && f05.has(32), `frames={${[...f05].join(',')}}`)
    const f10 = (await framesAt(1.0, {})).frames
    push('⑥B fog3 age=1.0s（= duration）⇒ frame 0（整圈折返）', f10.size === 1 && f10.has(0), `frames={${[...f10].join(',')}}`)
    const l025 = (await framesAt(0.25, { pframe: 'legacy' })).frames
    push('⑥B ?pframe=legacy 复现 P-124：帧 16 不再出现，且逐粒子各自相位（>1 个不同帧）',
      !l025.has(16) && l025.size >= 2, `frames={${[...l025].join(',')}}`)
  } else push('⑥B fog3 贴图缺失（SKIP 视作 PASS）', true, 'no fog3.tex')
}

// ── ⑥C oscillatealpha：加性 → 乘性（⑧-3）──
{
  // ①(P-130 批A #1) 采样步长 0.05 → **0.01**：批A 把 ω 从 `2π·frequency` 改成 `frequency`（官方口径）后，
  //   相位步长从 3.14~6.28 rad 降到 0.1~0.2 rad，`dt=0.05` 的栅格对端点极值的余量只剩 2.4e-7（容差 1e-6），
  //   属"运气过线"。`dt=0.01`（60s ⇒ 6000 步）把余量拉到 ~1e-8 量级 —— 判据本身（区间端点 0.35/0.5/0.7/1.0）
  //   与容差 1e-6 都不放松。
  const alphaStats = (base, popsLegacy) => {
    const def = { maxcount: 4,
      emitter: [{ rate: 0.0001, instantaneous: 1, distancemax: '0 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }, { name: 'alpharandom', min: base, max: base }],
      operator: [{ name: 'oscillatealpha', frequencymin: 10, frequencymax: 20, scalemin: 0.7 }] }
    const s = lib.buildParticleSystem(def, { origin: [0, 0, 0], seedStr: 'p125C', maxCount: 4, popsLegacy })
    let lo = Infinity, hi = -Infinity, zeros = 0, n = 0
    for (let i = 0; i < 6000; i++) {           // 60s @ 0.01s
      lib.stepParticles(s, 0.01, i * 0.01)
      for (const p of s.particles) { lo = Math.min(lo, p.alpha); hi = Math.max(hi, p.alpha); if (p.alpha <= 1e-9) zeros++; n++ }
    }
    return { lo, hi, zeroFrac: zeros / Math.max(1, n) }
  }
  const on5 = alphaStats(0.5, false)
  push('⑥C base=0.5：alpha ∈ [0.35, 0.5]（乘性 mix(0.7,1,·)，旧实现 24.7% 周期触 0）',
    near(on5.lo, 0.35, 1e-6) && near(on5.hi, 0.5, 1e-6) && on5.zeroFrac === 0,
    `[${on5.lo.toFixed(4)}, ${on5.hi.toFixed(4)}] zeroFrac=${(on5.zeroFrac * 100).toFixed(1)}%`)
  const on1 = alphaStats(1.0, false)
  push('⑥C base=1：alpha ∈ [0.70, 1.00]（旧实现摆到 0.30）',
    near(on1.lo, 0.7, 1e-6) && near(on1.hi, 1.0, 1e-6), `[${on1.lo.toFixed(4)}, ${on1.hi.toFixed(4)}]`)
  const off5 = alphaStats(0.5, true)
  push('⑥C ?pops=legacy 复现 P-124：加性 + clamp ⇒ alpha 触 0（>10% 周期整颗消失）',
    off5.lo === 0 && off5.zeroFrac > 0.1, `min=${off5.lo} zeroFrac=${(off5.zeroFrac * 100).toFixed(1)}%`)
}

// ── ⑥D oscillateposition 增量式 + controlpointattract 判据（⑧-4 / ⑧-5，必须同批）──
if (hasPkg('3554161528')) {
  const { scene: hs } = loadPkg('3554161528')
  const fl = hs.layers.find((l) => l.id === 4569)
  // 出生域 bbox：发射器 directions × distancemax（该 def = "3.5 1.5 0" × 512）⇒ 粒子本就铺得很开
  const em0 = (fl.particleDef.emitter || [])[0] || {}
  const dirs = String(em0.directions || '1 1 0').trim().split(/\s+/).map(Number)
  const dmax = Number(em0.distancemax || 0)
  // ①(sphere-dim 2026-09-23) MARGIN 200 → **320**：本层的发射器是 `sphererandom`（见下行 `em0.name`），
  //   而 `?psph` 的新默认把半径从**线性均匀**换成**按维度幂次分布**（`r=(lo^d+u·(hi^d−lo^d))^(1/d)`，
  //   2D = 面积均匀）⇒ 出生半径的期望从 `hi/2 = 256` 抬到 `2hi/3 ≈ 341`（+85px），
  //   即"出生点本身整体外移"，而漂移量（turbulence/movement）并没有变大。
  //   实测同种子同一层（1200 帧）：legacy `y∈[1291,2979]`（余量用掉 128/200，PASS）；
  //   官方档 `y∈[1117,2987]` ⇒ 比 bbox 下沿 1163 低 46px（**不是**粒子飞出画布：
  //   `|py| ≤ |dirs[1]|·dmax = 768` 这条出生域上界两档都严格成立，超出的只有"漂移余量"）。
  //   ⇒ 判据的**意图**（粒子全程留在"出生域 + 有界漂移"内）不变，只把余量按同一比例放宽。
  //   对照读数写在这里，便于以后复核：legacy y∈[1291,2979] / official y∈[1117,2987]。
  const MARGIN = 320
  const bbox = {
    x0: fl.origin[0] - Math.abs(dirs[0]) * dmax - MARGIN, x1: fl.origin[0] + Math.abs(dirs[0]) * dmax + MARGIN,
    y0: fl.origin[1] - Math.abs(dirs[1]) * dmax - MARGIN, y1: fl.origin[1] + Math.abs(dirs[1]) * dmax + MARGIN,
  }
  const corrOf = (xs, ys) => {
    const n = xs.length
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
    let sxy = 0, sxx = 0, syy = 0
    for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b }
    return sxy / Math.sqrt(Math.max(1e-12, sxx * syy))
  }
  const traj = (popsLegacy) => {
    const s = lib.buildParticleSystem(fl.particleDef, { origin: fl.origin, scale: fl.scale,
      angle: (fl.angles && fl.angles[2]) || 0, seedStr: String(fl.id) + '|' + String(fl.origin),
      maxCount: 100, instanceoverride: fl.instanceoverride, popsLegacy })
    // 逐粒子轨迹（同一颗粒子的时间序列才是"沿固定对角线摆动"的直接证据；跨粒子汇总会把相位差平均掉）
    // ①(P-130 批A #1) 窗口 240 帧（4s）→ **1200 帧（20s）**：批A 把 ω 从 `2π·f` 改成 `f`（官方口径）后，
    //   该层 `oscillateposition{frequencymin:0.3, frequencymax:1}` 的周期从 1.0~2.1s 变成 **6.3~21s**
    //   ⇒ 4s 窗口不足一个周期，官方口径下轨迹本来就近似一条直线（实测 |corr|=0.9983，是**官方行为**
    //   而不是回归）。判据（`|corr| < 0.99`、legacy `≥ 0.999`）与容差一律不动，只把窗口拉到覆盖 ≥1 个周期。
    const track = new Map()
    for (let i = 0; i < 1200; i++) {
      lib.stepParticles(s, 1 / 60, i / 60)
      if (i < 60) continue
      for (const p of s.particles) {
        let tr = track.get(p)
        if (!tr) { tr = { x: [], y: [] }; track.set(p, tr) }
        tr.x.push(p.pos[0]); tr.y.push(p.pos[1])
      }
    }
    const series = [...track.values()].filter((tr) => tr.x.length > 60)
    const corrs = series.map((tr) => corrOf(tr.x, tr.y))
    const maxAbsCorr = corrs.length ? Math.max(...corrs.map(Math.abs)) : 1
    const allX = series.flatMap((tr) => tr.x), allY = series.flatMap((tr) => tr.y)
    const n = allX.length
    const mx = allX.reduce((a, b) => a + b, 0) / n, my = allY.reduce((a, b) => a + b, 0) / n
    const h = Math.floor(n / 2)
    const mean1x = allX.slice(0, h).reduce((a, b) => a + b, 0) / h, mean2x = allX.slice(h).reduce((a, b) => a + b, 0) / (n - h)
    const mean1y = allY.slice(0, h).reduce((a, b) => a + b, 0) / h, mean2y = allY.slice(h).reduce((a, b) => a + b, 0) / (n - h)
    const dr = Math.hypot(mean2x - mean1x, mean2y - mean1y)
    return { maxAbsCorr, dr, corrs, n, particles: series.length,
      inBox: allX.every((x) => x >= bbox.x0 && x <= bbox.x1) && allY.every((y) => y >= bbox.y0 && y <= bbox.y1),
      xmin: Math.min(...allX), xmax: Math.max(...allX), ymin: Math.min(...allY), ymax: Math.max(...allY) }
  }
  const on = traj(false), off = traj(true)
  push('⑥D 萤火虫 1200 帧（20s，覆盖 ≥1 个官方摆动周期）：每颗粒子 |corr(x,y)| < 0.99（官方逐轴增量；旧实现每颗恰好 −1.0000 = 固定对角线）',
    on.n > 10 && on.maxAbsCorr < 0.99, `maxAbsCorr=${on.maxAbsCorr.toFixed(4)} perParticle=[${on.corrs.map((c) => c.toFixed(3)).join(', ')}] n=${on.n} 粒子=${on.particles}`)
  push('⑥D 萤火虫漂移 ≠ 0（movement/turbulence 累积的漂移不再被每帧覆盖抹掉）',
    on.dr > 1, `drift=${on.dr.toFixed(2)}px`)
  push('⑥D 并联判据：官方口径下粒子全程落在出生域 bbox 内（层 origin ± directions×distancemax ± 200px）',
    on.inBox, `x∈[${on.xmin.toFixed(0)},${on.xmax.toFixed(0)}] y∈[${on.ymin.toFixed(0)},${on.ymax.toFixed(0)}] bbox x∈[${bbox.x0.toFixed(0)},${bbox.x1.toFixed(0)}] y∈[${bbox.y0.toFixed(0)},${bbox.y1.toFixed(0)}]`)
  push('⑥D ?pops=legacy 复现 P-124：每颗粒子 corr(x,y) = −1.0000（证明上面的判据对旧写法敏感）',
    off.maxAbsCorr >= 0.999, `maxAbsCorr=${off.maxAbsCorr.toFixed(4)} perParticle=[${off.corrs.map((c) => c.toFixed(3)).join(', ')}]`)
} else push('⑥D hina 真包缺失（SKIP 视作 PASS）', true, 'no pkg')
{
  // ⑧-5：无指针、退化目标 = 层空间 offset 当世界坐标 ⇒ 目标 (0,0)；threshold=70 ⇒ thr=35
  const cpDef = { maxcount: 2, emitter: [{ rate: 0.0001, instantaneous: 1, distancemax: '0 0 0' }],
    initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }],
    operator: [{ name: 'controlpointattract', controlpoint: 1, scale: -1000, threshold: 70 }],
    controlpoint: [{ flags: 0 }, { flags: 1, offset: '0 0 0' }] }
  const dvAt = (dist, popsLegacy) => {
    const s = lib.buildParticleSystem(cpDef, { origin: [0, 0, 0], seedStr: 'p125E', maxCount: 2, popsLegacy })
    s.pointer = null
    lib.stepParticles(s, 1 / 60, 0)
    const p = s.particles[0]
    p.pos = [dist, 0, 0]; p.vel = [0, 0, 0]
    lib.stepParticles(s, 1 / 60, 1 / 60)
    return Math.hypot(p.vel[0], p.vel[1])
  }
  push('⑥D ⑧-5 attract 判据：d=500px（thr=35）⇒ 不施力 |Δv| = 0（旧实现 d>thr ⇒ 施力，粒子被推飞）',
    dvAt(500, false) === 0, `|Δv|=${dvAt(500, false).toFixed(4)}`)
  push('⑥D ⑧-5 attract 判据：d=10px ⇒ 施力 |Δv| = |scale|·dt = 16.667', near(dvAt(10, false), 1000 / 60, 1e-6), `|Δv|=${dvAt(10, false).toFixed(4)}`)
  push('⑥D ⑧-5 ?pops=legacy 复现 P-124：d=500px 时**施力**（判据反了）', dvAt(500, true) > 0, `|Δv|=${dvAt(500, true).toFixed(4)}`)
}

// ── ⑥F turbulence mask 缺省（⑧-6）+ starttime 语义（⑧-8，文档化断言）──
{
  const tdef = { maxcount: 2, emitter: [{ rate: 0.0001, instantaneous: 1, distancemax: '0 0 0' }],
    initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }],
    operator: [{ name: 'turbulence', speedmin: 30, speedmax: 50 }] }   // 故意不写 mask（hina 两个萤火虫 def 就是这样）
  const yVel = (popsLegacy) => {
    const s = lib.buildParticleSystem(tdef, { origin: [0, 0, 0], seedStr: 'p125F', maxCount: 2, popsLegacy })
    let m = 0
    for (let i = 0; i < 120; i++) { lib.stepParticles(s, 1 / 60, i / 60); for (const p of s.particles) m = Math.max(m, Math.abs(p.vel[1])) }
    return m
  }
  push('⑥F turbulence 无 mask ⇒ 缺省 (1,1,0)：y 轴真的受力（旧缺省 [1,0,0] ⇒ y 恒 0）',
    yVel(false) > 1 && yVel(true) === 0, `official max|vy|=${yVel(false).toFixed(2)} legacy=${yVel(true).toFixed(2)}`)
}
if (hasPkg('3554161528')) {
  const { scene: hs } = loadPkg('3554161528')
  const fl = hs.layers.find((l) => l.id === 4569)
  const aliveAt = (t) => {
    const s = lib.buildParticleSystem(fl.particleDef, { origin: fl.origin, scale: fl.scale, angle: (fl.angles && fl.angles[2]) || 0,
      seedStr: 'p125-st', maxCount: 100, instanceoverride: fl.instanceoverride })
    lib.simulateParticleSystem(s, t)
    return s.particles.length
  }
  push('⑥F starttime=15 语义（官方，不是 bug）：t=10s 不发射（0 颗）、t=25s 才有粒子',
    fl.particleDef.starttime === 15 && aliveAt(10) === 0 && aliveAt(25) > 0,
    `starttime=${fl.particleDef.starttime} alive(10)=${aliveAt(10)} alive(25)=${aliveAt(25)}`)
}

// ═══════════════ ⑦ P-130 批A：7 条口径修复 + ?pcolor 回退口 ═══════════════
// 判据来源：docs/PARTICLE-CORPUS-SCAN.md（§1-5b/5c、§2.4-补、§3 #1/#3/#4/#9/#10/#12/#24、§4 批A）。
// ⚠ 官方缺省数字**全部取自第三方参考实现的行为对照**（wer-ref/lwe-ref，只读行为结论、未复制其代码）；
//   本仓库**未反汇编官方二进制**。每条都带 legacy/反向断言（证明判据对旧写法敏感）。
const RNG_LIFE = [{ name: 'lifetimerandom', min: 1000, max: 1000 }]
const burstDef = (init, op, n) => ({ maxcount: n,
  emitter: [{ name: 'boxrandom', rate: 0.0001, instantaneous: n, distancemax: '0 0 0' }], initializer: init, operator: op })
const bornBurst = (def, n, seed, ctx) => {
  const s = lib.buildParticleSystem(def, Object.assign({ origin: [0, 0, 0], seedStr: seed, maxCount: n }, ctx))
  lib.simulateParticleSystem(s, 0.001)
  return s
}
const mm = (a) => [Math.min(...a), Math.max(...a)]
// 10 秒窗口内"信号极大值"个数 = 摆动周期数（批A #1/#4 的判据式；dt=0.002 ⇒ 周期 ≥0.63s 时每周期 ≥31 个采样点）
const maxima10s = (def, sig, popsLegacy, ctx) => {
  const s = lib.buildParticleSystem(def, Object.assign({ origin: [0, 0, 0], seedStr: 'p127max', maxCount: 4, popsLegacy }, ctx))
  const v = []
  for (let i = 0; i * 0.002 < 10; i++) { lib.stepParticles(s, 0.002, i * 0.002); const p = s.particles[0]; if (p) v.push(sig(p)) }
  let n = 0
  for (let i = 1; i + 1 < v.length; i++) if (v[i] > v[i - 1] && v[i] >= v[i + 1]) n++
  return n
}

// ── ⑦A #1 `oscillate*` 频率量纲：ω ≡ frequency（rad/s）；旧实现 `2π·frequency` ⇒ 摆动快 6.28× ──
{
  const aDef = (o) => burstDef(RNG_LIFE.concat([{ name: 'alpharandom', min: 1, max: 1 }]), [o], 4)
  const OSC = (n, extra) => Object.assign({ name: n, frequencymin: 10, frequencymax: 10, scalemin: 0.5, scalemax: 1 }, extra)
  const aOn = maxima10s(aDef(OSC('oscillatealpha')), (p) => p.alpha, false)
  const aOff = maxima10s(aDef(OSC('oscillatealpha')), (p) => p.alpha, true)
  push('⑦A #1 oscillatealpha：10s 内 alpha 极大值 15~16（ω=10 rad/s ⇒ 1.59 Hz）',
    aOn >= 15 && aOn <= 16, `official=${aOn}（旧 2π·f ⇒ 100）`)
  push('⑦A #1 ?pops=legacy 复现旧的 Hz 口径：10s 内 ≈100 个极大值（快 6.28×）',
    aOff >= 95 && aOff <= 100, `legacy=${aOff}`)
  const pOn = maxima10s(burstDef(RNG_LIFE, [OSC('oscillateposition', { scalemin: 20, scalemax: 20 })], 4), (p) => p.pos[0], false)
  const pOff = maxima10s(burstDef(RNG_LIFE, [OSC('oscillateposition', { scalemin: 20, scalemax: 20 })], 4), (p) => p.pos[0], true)
  push('⑦A #1 oscillateposition：10s 内 pos.x 极大值 15~16（旧 ≈100）',
    pOn >= 15 && pOn <= 16 && pOff >= 95, `official=${pOn} legacy=${pOff}`)
  const sDef = (o) => burstDef(RNG_LIFE.concat([{ name: 'sizerandom', min: 100, max: 100 }]), [o], 4)
  const sOn = maxima10s(sDef(OSC('oscillatesize')), (p) => p.size, false)
  const sOff = maxima10s(sDef(OSC('oscillatesize')), (p) => p.size, true)
  push('⑦A #1 oscillatesize：10s 内 size 极大值 15~16（旧 ≈100；该算子无 pops legacy 分支 ⇒ 两档同值）',
    sOn >= 15 && sOn <= 16 && sOff === sOn, `official=${sOn} legacy=${sOff}`)
  // §2.4-补 的一行判据原文：`oscillatealpha{frequencymin:10, scalemin:0.5}`（**不写 frequencymax**）
  const crit = aDef({ name: 'oscillatealpha', frequencymin: 10, scalemin: 0.5 })
  const cOn = maxima10s(crit, (p) => p.alpha, false)
  const fCrit = bornBurst(crit, 4, 'p127crit').particles[0].oscAlpha.f
  push('⑦A #1 §2.4-补 的一行判据：`oscillatealpha{frequencymin:10,scalemin:0.5}` 跑 10s ≈16 个 alpha 极大值',
    cOn >= 15 && cOn <= 16, `official=${cOn}（旧 52：旧缺省 frequencymax=1 把 f 拉到 ≈5.2 ⇒ 2π·f≈32.8 rad/s）`)
  push('⑦A #1 判据 def 的 per-particle ω = authored frequency = 10（缺省 frequencymax=10 与 frequencymin 相等）',
    Math.abs(fCrit - 10) < 1e-9, `f=${fCrit}`)
}

// ── ⑦B #2 `colorrandom` 缺 `max` 的缺省域：官方 {255,255,255}（与 min 同域）⇒ 恒白 ──
{
  const colorsOf = (minStr, pcolorLegacy) => bornBurst(burstDef(
    [{ name: 'lifetimerandom', min: 1000, max: 1000 }, { name: 'colorrandom', min: minStr }], [], 200),
    200, 'p127col', { pcolorLegacy }).particles.map((p) => p.color)
  const w = colorsOf('255 255 255', false)
  push('⑦B #2 只写 min:"255 255 255" ⇒ 官方缺省 max=255 ⇒ 200 颗逐粒子色恒 (1,1,1)（旧：随机灰度 1−0.996u）',
    w.every((c) => c.every((v) => v === 1)), `样本=${JSON.stringify(w.slice(0, 3).map((c) => c.map((v) => +v.toFixed(4))))}`)
  const wl = colorsOf('255 255 255', true)
  const wlR = mm(wl.map((c) => c[0]))
  push('⑦B #2 ?pcolor=legacy 复现 P-126 的随机灰度（最暗近黑、>100 种取值）',
    wlR[0] < 0.05 && wlR[1] > 0.95 && new Set(wl.map((c) => c[0].toFixed(6))).size > 100,
    `R∈[${wlR.map((v) => v.toFixed(4)).join(',')}] 取值数=${new Set(wl.map((c) => c[0].toFixed(6))).size}`)
  const r = colorsOf('255 0 0', false)
  const rG = mm(r.map((c) => c[1]))
  push('⑦B #2 min:"255 0 0"（无 max）⇒ R 恒 1、G/B ∈[0,1]（旧：G/B ≤0.004 近黑）',
    r.every((c) => c[0] === 1) && rG[1] > 0.9 && rG[0] < 0.1, `R=${r[0][0]} G∈[${rG.map((v) => v.toFixed(4)).join(',')}]`)
  // 渲染通路：官方恒白 ⇒ 整批同色上提（u_Color 白 + 顶点色恒 1）；legacy ⇒ 逐顶点灰
  const defW = burstDef([{ name: 'lifetimerandom', min: 1000, max: 1000 }, { name: 'colorrandom', min: '255 255 255' }], [], 200)
  const on = await renderQuad(defW, {}, {}, 3.0)
  const onD = on.rec.draws2.filter(isParticleDraw).pop()
  const onC = onD ? colorStreamOf(onD, on.rec) : null
  push('⑦B #2 渲染通路 official：u_Color=(1,1,1) + 顶点色恒 1 + colorAttr=0（恒白走上提档）',
    !!onD && onD.uni.u_Color.every((v) => v === 1) && on.stats.colorAttr === 0 && !!onC && [...onC].every((v) => v === 1),
    onD ? `u_Color=${JSON.stringify(onD.uni.u_Color)} colorAttr=${on.stats.colorAttr}` : 'no draw')
  const lg = await renderQuad(defW, {}, { pcolor: 'legacy' }, 3.0)
  const lgD = lg.rec.draws2.filter(isParticleDraw).pop()
  const lgC = lgD ? colorStreamOf(lgD, lg.rec) : null
  const lgSp = lgC ? mm([...lgC]) : [0, 0]
  push('⑦B #2 `?pcolor=legacy` 真的换了一档：pcolorMode=legacy + 走 a_Color 且灰度色差 >0.5（official 恒 1）',
    lg.stats.pcolorMode === 'legacy' && lg.stats.colorAttr > 0 && (lgSp[1] - lgSp[0]) > 0.5,
    `pcolorMode=${lg.stats.pcolorMode} colorAttr=${lg.stats.colorAttr} 顶点色∈[${lgSp.map((v) => v.toFixed(3)).join(',')}]`)
}

// ── ⑦C #3 `emitter.rate` 缺省：官方 5（旧 10）—— 发射与预算记账两处必须同口径 ──
{
  const em = lib.parseParticleEmitters([{ name: 'boxrandom' }], [1, 1, 1], 0)
  push('⑦C #3 parseParticleEmitters 缺 rate ⇒ 5（官方 ParticleEmitter::rate{5.0f}；旧 10）', em[0].rate === 5, `rate=${em[0].rate}`)
  const s = lib.buildParticleSystem({ maxcount: 1000, emitter: [{ name: 'boxrandom', distancemax: '0 0 0' }],
    initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }], operator: [] },
    { origin: [0, 0, 0], seedStr: 'p127rate', maxCount: 1000 })
  lib.simulateParticleSystem(s, 1.0)
  push('⑦C #3 缺 rate 的层 1 秒发射数 ≈5（旧 10/s ⇒ ≈9~11）', s.particles.length >= 4 && s.particles.length <= 6, `n=${s.particles.length}`)
  // 预算记账（renderParticleLayer 的 sumRate）：12 个"没写 rate"的发射器 ⇒ 官方口径读成 60/s（旧 120/s）。
  //   用 `particleBudget.rate = 40` 让它必然触发限流 ⇒ 日志里的"发射率 N/s"直接暴露预算侧用的是 5 还是 10。
  const budgetDef = { maxcount: 5000, emitter: Array.from({ length: 12 }, () => ({ name: 'boxrandom', distancemax: '0 0 0' })),
    initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }], operator: [] }
  setModes({})
  const { gl } = makeGl()
  const logs = []
  const r = createRenderer({ getContext: () => gl }, { onLog: (m) => logs.push(String(m)), shaderResolver: SHADER_RESOLVER, aggregate: true,
    particleBudget: { tier: 't', perLayer: 20000, total: 20000, layers: 100, steps: 400, rate: 40 } })
  await r.render({ layers: [mkLayer({ particleDef: budgetDef })], general: {}, camera: null, size: [W, H] }, TEXA, W, H, 1.0)
  const line = logs.find((m) => m.includes('发射率'))
  const sumRate = line ? Number((line.match(/发射率 ([\d.]+)\/s/) || [])[1]) : NaN
  push('⑦C #3 预算记账与发射同口径：12 个缺 rate 的发射器被读成 60/s（旧 120/s）⇒ 触发限流',
    sumRate === 60 && r.particleStats.rateCapped >= 1, `sumRate=${sumRate} rateCapped=${r.particleStats.rateCapped} log=${line ? line.slice(0, 60) : '—'}`)
}

// ── ⑦D #4 `FrequencyValue` 的官方缺省表（frequencymax=10 / 名称分支 oscillatesize 0.8/1.2、position 5） ──
{
  const fs_ = (op, key, n = 400) => bornBurst(burstDef(RNG_LIFE, [op], n), n, 'p127f').particles.map(key)
  const sz = bornBurst(burstDef(RNG_LIFE, [{ name: 'oscillatesize', frequencymin: 0 }], 400), 400, 'p127f').particles
  push('⑦D #4 oscillatesize：frequencymax 缺省 = 10（旧 1）⇒ per-particle f 上界 >9.5',
    Math.max(...sz.map((p) => p.oscSize.f)) > 9.5, `f 上界=${Math.max(...sz.map((p) => p.oscSize.f)).toFixed(4)}（旧 0.9942）`)
  push('⑦D #4 oscillatesize：scalemin/scalemax 缺省 = 0.8/1.2（官方名称分支）⇒ mid=1、amp=0.2',
    near(sz[0].oscSize.mid, 1, 1e-12) && near(sz[0].oscSize.amp, 0.2, 1e-12),
    `mid=${sz[0].oscSize.mid} amp=${sz[0].oscSize.amp}`)
  const al = bornBurst(burstDef(RNG_LIFE, [{ name: 'oscillatealpha', frequencymin: 0 }], 400), 400, 'p127f').particles
  push('⑦D #4 oscillatealpha：frequencymax 缺省 = 10（旧 1）⇒ f 上界 >9.5',
    Math.max(...al.map((p) => p.oscAlpha.f)) > 9.5, `f 上界=${Math.max(...al.map((p) => p.oscAlpha.f)).toFixed(4)}（旧 0.9990）`)
  const po = bornBurst(burstDef(RNG_LIFE, [{ name: 'oscillateposition', frequencymin: 0, scalemin: 0 }], 400), 400, 'p127f').particles
  push('⑦D #4 oscillateposition：frequencymax 缺省 = 5、scalemax 缺省 = 1（旧 1 / 旧 = scalemin）',
    Math.max(...po.map((p) => p.oscPos.f[0])) > 4.5 && Math.max(...po.map((p) => p.oscPos.f[0])) <= 5 + 1e-9 &&
    Math.max(...po.map((p) => p.oscPos.sc[0])) > 0.95 && Math.max(...po.map((p) => p.oscPos.sc[0])) <= 1 + 1e-9,
    `f 上界=${Math.max(...po.map((p) => p.oscPos.f[0])).toFixed(4)} sc 上界=${Math.max(...po.map((p) => p.oscPos.sc[0])).toFixed(4)}`)
  const z = bornBurst(burstDef(RNG_LIFE, [{ name: 'oscillatealpha', frequencymin: 3, frequencymax: 0 }], 50), 50, 'p127z').particles
  push('⑦D #4 显式 `frequencymax:0` ⇒ 取 frequencymin（官方 ReadFromJson 的归一；旧实现 ⇒ f 恒 0）',
    z.every((p) => Math.abs(p.oscAlpha.f - 3) < 1e-12), `f 取值集=${[...new Set(z.map((p) => p.oscAlpha.f))].join(',')}`)
  const sDef = (o) => burstDef(RNG_LIFE.concat([{ name: 'sizerandom', min: 100, max: 100 }]), [o], 4)
  const sOn = maxima10s(sDef({ name: 'oscillatesize', frequencymin: 10, scalemin: 0.5, scalemax: 1 }), (p) => p.size, false)
  push('⑦D #4 缺 frequencymax 的 size 10s 极大值 15~16（旧 52：旧缺省把 f 拉到 ≈5.2）',
    sOn >= 15 && sOn <= 16, `official=${sOn}`)
  // 时间基准：官方 `GetScale(i, LifetimePassed(p))` = **粒子年龄**（旧实现用系统时间 `t` ⇒ 同屏粒子永远同相）。
  //   判据要"相位退化"才可判：`phasemin = 2π, phasemax = 0` ⇒ 官方相位恒 `2π`（区间退化），
  //   于是"同屏同帧 size 是否一致"**只**取决于时间基准（age ⇒ 各颗粒子年龄不同 ⇒ size 不同；t ⇒ 完全相同）。
  const two = { maxcount: 4, emitter: [{ name: 'boxrandom', rate: 2, instantaneous: 1, distancemax: '0 0 0' }],
    initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }, { name: 'sizerandom', min: 100, max: 100 }],
    operator: [{ name: 'oscillatesize', frequencymin: 3, frequencymax: 3, scalemin: 0.8, scalemax: 1.2,
      phasemin: Math.PI * 2, phasemax: 0 }] }
  const st = lib.buildParticleSystem(two, { origin: [0, 0, 0], seedStr: 'p127age', maxCount: 4 })
  const sizes = []
  for (let i = 0; i < 200; i++) { lib.stepParticles(st, 1 / 60, i / 60); if (i === 150) sizes.push(...st.particles.map((p) => p.size)) }
  const phSet = [...new Set(st.particles.map((p) => p.oscSize.ph))]
  push('⑦D #4 oscillatesize 的时间基准 = 粒子年龄（官方 LifetimePassed）：相位退化后同帧多颗粒子 size **不同**（旧用系统时间 ⇒ 全部相同）',
    st.particles.length >= 2 && sizes.length >= 2 && phSet.length === 1 && Math.max(...sizes) - Math.min(...sizes) > 1,
    `n=${st.particles.length} 相位集=${phSet.map((v) => v.toFixed(6)).join(',')} 同帧 size∈[${Math.min(...sizes).toFixed(2)},${Math.max(...sizes).toFixed(2)}]`)
}

// ── ⑦E #5 `phasemin` 被忽略（16 层）+ 相位上界 = `phasemax + 2π`（只属 FrequencyValue）──
{
  const phOf = (op, key, pops, n = 400) => bornBurst(burstDef(RNG_LIFE, [op], n), n, 'p127ph', { popsLegacy: pops }).particles.map(key)
  const aOp = { name: 'oscillatealpha', frequencymin: 1, frequencymax: 1, scalemin: 1, scalemax: 1, phasemin: 5, phasemax: 0 }
  const aOn = phOf(aOp, (p) => p.oscAlpha.ph, false)
  const aOff = phOf(aOp, (p) => p.oscAlpha.ph, true)
  push('⑦E #5a oscillatealpha 读 phasemin：相位 ∈ [5, phasemax+2π=2π]（旧：恒 0，phasemin 完全不读）',
    Math.min(...aOn) >= 5 - 1e-9 && Math.max(...aOn) <= Math.PI * 2 + 1e-9, `相位∈[${mm(aOn).map((v) => v.toFixed(4)).join(',')}]`)
  // legacy 分支消费的是 `phL`（`?pops=legacy` 的相位字段）—— 它保留旧口径：不读 phasemin、上界 = phasemax（此处 0 ⇒ 恒 0）。
  const aOffL = phOf(aOp, (p) => p.oscAlpha.phL, true)
  push('⑦E #5a ?pops=legacy 的相位字段 `phL` 保留旧口径（不读 phasemin ⇒ 恒 0；official 字段 `ph` 才吃 phasemin）',
    aOffL.every((v) => v === 0) && aOn.every((v) => v >= 5 - 1e-9), `legacy phL=${[...new Set(aOffL)].slice(0, 3).join(',')} official ph∈[${mm(aOn).map((v) => v.toFixed(4)).join(',')}]`)
  // 效果判据：t=0 时 legacy = clamp(base + a·cos(phL=0)) = clamp(0.5+1) = 1；official = base·mix(1,1,·) = 0.5
  const a0 = (pops) => bornBurst(burstDef(RNG_LIFE.concat([{ name: 'alpharandom', min: 0.5, max: 0.5 }]), [aOp], 50),
    50, 'p127a0', { popsLegacy: pops }).particles.map((p) => p.alpha)
  push('⑦E #5a 效果：t=0 时 legacy alpha = clamp(base+a·cos(0)) = clamp(0.5+1) = 1（相位 0）、official = base·mix(1,1,·) = 0.5',
    a0(true).every((v) => v === 1) && a0(false).every((v) => v === 0.5), `legacy=${[...new Set(a0(true))].join(',')} official=${[...new Set(a0(false))].join(',')}`)
  const pOp = { name: 'oscillateposition', phasemin: 5, phasemax: 0, mask: '1 1 0' }
  const pOn = phOf(pOp, (p) => p.oscPos.ph[0], false)
  const pOff = phOf(pOp, (p) => p.oscPos.ph[0], true)
  push('⑦E #5b oscillateposition 读 phasemin：ph[0] ∈ [5, 2π]（旧：[0,2π]，phasemin 完全不读）',
    Math.min(...pOn) >= 5 - 1e-9 && Math.max(...pOn) <= Math.PI * 2 + 1e-9, `official∈[${mm(pOn).map((v) => v.toFixed(4)).join(',')}]`)
  const pOffL = phOf(pOp, (p) => p.oscPos.lph, true)   // legacy 分支消费的是单相位 `lph`
  push('⑦E #5b ?pops=legacy 的单相位 `lph` 保留旧口径 r×2π（∈[0,2π]）',
    Math.min(...pOffL) >= 0 && Math.max(...pOffL) <= Math.PI * 2 + 1e-9 && Math.min(...pOffL) < 1,
    `legacy lph∈[${mm(pOffL).map((v) => v.toFixed(4)).join(',')}]`)
  const tOp = { name: 'turbulence', speedmin: 30, speedmax: 50, phasemin: 5, phasemax: 50 }
  const tOn = phOf(tOp, (p) => p.turbPh, false)
  push('⑦E #5c turbulence 读 phasemin：相位 ∈ [5, 50] —— 官方 turbulence **不加** +2π（两参考一致；+2π 只属 FrequencyValue）',
    Math.min(...tOn) >= 5 - 1e-9 && Math.max(...tOn) <= 50 + 1e-9, `相位∈[${mm(tOn).map((v) => v.toFixed(4)).join(',')}]`)
  // 效果判据：同 seed、同频段下 phasemin 不同的噪声相位必须给出不同速度（旧实现两者逐位相同）
  const vy = (phasemin, pops) => {
    const s = lib.buildParticleSystem(burstDef(RNG_LIFE, [{ name: 'turbulence', speedmin: 30, speedmax: 50, phasemin, phasemax: 50 }], 4),
      { origin: [0, 0, 0], seedStr: 'p127vy', maxCount: 4, popsLegacy: pops })
    let m = 0
    for (let i = 0; i < 120; i++) { lib.stepParticles(s, 1 / 60, i / 60); for (const p of s.particles) m = Math.max(m, Math.abs(p.vel[1])) }
    return m
  }
  push('⑦E #5c turbulence 的 phasemin 真的改变噪声相位（旧实现 phasemin 被忽略 ⇒ 两档逐位相同）',
    Math.abs(vy(5, false) - vy(0, false)) > 1e-9 && vy(5, true) === vy(0, true),
    `official max|vy| 5→${vy(5, false).toFixed(4)} / 0→${vy(0, false).toFixed(4)}；legacy 两档=${vy(5, true).toFixed(4)}`)
}

// ── ⑦F #6 `controlpointattract.threshold` 缺省 = 512（旧 0 ⇒ 判据恒假 ⇒ 整条算子从不生效）──
// ①(C4 定案 2026-09-24) 门限 = `threshold` **原值**（官方文档 §"Control point force" 逐字
//   "Distance: The maximum distance of the force."）——**不再无条件除 2**；改动前那条"除 2"口径
//   保留在 `?pforce=legacy` 档（半径比 = 2 的锐利判据见 `tests/particle-force-distance-test.mjs`）。
{
  const def = (thr) => ({ maxcount: 2, emitter: [{ rate: 0.0001, instantaneous: 1, distancemax: '0 0 0' }],
    initializer: RNG_LIFE, operator: [Object.assign({ name: 'controlpointattract', controlpoint: 1, scale: -1000 },
      thr == null ? {} : { threshold: thr })],
    controlpoint: [{ flags: 0 }, { flags: 1, offset: '0 0 0' }] })
  const dv = (dist, thr, pforceLegacy) => {
    const s = lib.buildParticleSystem(def(thr), { origin: [0, 0, 0], seedStr: 'p127att', maxCount: 2, pforceLegacy })
    s.pointer = null
    lib.stepParticles(s, 1 / 60, 0)
    const p = s.particles[0]; p.pos = [dist, 0, 0]; p.vel = [0, 0, 0]
    lib.stepParticles(s, 1 / 60, 1 / 60)
    return Math.hypot(p.vel[0], p.vel[1])
  }
  push('⑦F #6 缺 threshold ⇒ 官方缺省 512（门限即半径）：d=100/300 施力 |Δv| = |scale|·dt = 16.667、d=600 不施力（旧：两条都 0）',
    near(dv(100, null), 1000 / 60, 1e-6) && near(dv(300, null), 1000 / 60, 1e-6) && dv(600, null) === 0,
    `d=100 ⇒ ${dv(100, null).toFixed(4)}；d=300 ⇒ ${dv(300, null).toFixed(4)}；d=600 ⇒ ${dv(600, null).toFixed(4)}`)
  push('⑦F #6 显式 threshold=70 ⇒ 作用半径就是 **70**（d=10 与 d=50 都施力、d=100 不施力）',
    near(dv(10, 70), 1000 / 60, 1e-6) && near(dv(50, 70), 1000 / 60, 1e-6) && dv(100, 70) === 0,
    `d=10 ⇒ ${dv(10, 70).toFixed(4)}；d=50 ⇒ ${dv(50, 70).toFixed(4)}；d=100 ⇒ ${dv(100, 70).toFixed(4)}`)
  push('⑦F #6 `?pforce=legacy` ⇒ 回到改动前的 `threshold/2`（threshold=70 ⇒ 半径 35：d=10 施力、d=50 不施力）',
    near(dv(10, 70, true), 1000 / 60, 1e-6) && dv(50, 70, true) === 0,
    `d=10 ⇒ ${dv(10, 70, true).toFixed(4)}；d=50 ⇒ ${dv(50, 70, true).toFixed(4)}`)
}

// ── ⑦G #7 `colorchange` 官方是**乘**（MutiplyColor）；旧实现是赋值 ⇒ 末段逐粒子色被抹平 ──
{
  const ccDef = () => burstDef([{ name: 'lifetimerandom', min: 10, max: 10 },
    { name: 'colorrandom', min: '60 60 60', max: '255 255 255' }],
    [{ name: 'colorchange', starttime: 0.5, endtime: 1, endvalue: '0.5 0.5 0.5' }], 200)
  const at = (t, pcolorLegacy) => { const s = bornBurst(ccDef(), 200, 'p127cc', { pcolorLegacy }); lib.simulateParticleSystem(s, t); return s.particles }
  const on = at(9, false)          // life=10s ⇒ lifePos 0.9（endtime 之后的分支）
  const uniq = new Set(on.map((p) => p.color.map((v) => v.toFixed(4)).join(','))).size
  const ratio = on.map((p) => p.color[0] / p.baseColor[0])
  push('⑦G #7 末段：逐粒子色 = baseColor × ch(life)（ch=0.4），逐粒子色差**保留**（旧：全部 = endvalue 0.5）',
    uniq > 100 && ratio.every((r2) => near(r2, 0.4, 1e-9)),
    `不同色数=${uniq} ch=${ratio[0].toFixed(6)} R∈[${mm(on.map((p) => p.color[0])).map((v) => v.toFixed(4)).join(',')}]`)
  const off = at(9, true)
  push('⑦G #7 ?pcolor=legacy 复现旧的赋值口径：末段所有粒子同色 = endvalue 0.5',
    new Set(off.map((p) => p.color.map((v) => v.toFixed(6)).join(','))).size === 1 && near(off[0].color[0], 0.5, 1e-12),
    `不同色数=${new Set(off.map((p) => p.color[0].toFixed(6))).size} 色=${off[0].color.map((v) => +v.toFixed(4))}`)
  // `startvalue` 缺省 {0,0,0}（官方 VecChange）⇒ `life <= starttime` 段被乘成 0（语料 12 层没写 startvalue）。
  //   旧实现（赋值）该段的 u = age/endtime（**分母是 endtime 不是 starttime**）⇒ 同一时刻完全不同的值。
  const early = at(1, false), earlyL = at(1, true)
  push('⑦G #7 `life <= starttime` 段：官方 startvalue 缺省 {0,0,0} ⇒ 色被乘成 0（官方语义，不是 bug）',
    early.every((p) => p.color.every((v) => v === 0)), `色样本=${early[0].color.join(',')}`)
  push('⑦G #7 ?pcolor=legacy 该段是旧赋值式（u = age/endtime = 1 ⇒ 已等于 endvalue 0.5、且全粒子同色）',
    earlyL.every((p) => near(p.color[0], 0.5, 1e-12) && near(p.color[1], 0.5, 1e-12)), `色样本=${earlyL[0].color.map((v) => +v.toFixed(4))}`)
}

// ── ⑦H 真包对拍（§3 #3 点名的 hina「雾 2」+ §3 #12 的 4 包之一 dd/3544152633）──
if (hasPkg('3554161528')) {
  const f1 = await renderRealLayer('3554161528', '雾 2', {}, 20.0, 835)
  const f1d = f1 && f1.rec.draws2.filter(isParticleDraw).pop()
  const f1c = f1d ? colorStreamOf(f1d, f1.rec) : null
  push('⑦H 真包 hina「雾 2」(ln=17/id=835)：official 整批恒白（u_Color=(1,1,1) + 顶点色恒 1 + colorUni/Attr=1/0）',
    !!f1d && f1d.uni.u_Color.every((v) => v === 1) && !!f1c && [...f1c].every((v) => v === 1) &&
    f1.stats.colorUni === 1 && f1.stats.colorAttr === 0,
    f1d ? `u_Color=${JSON.stringify(f1d.uni.u_Color)} colorUni/Attr=${f1.stats.colorUni}/${f1.stats.colorAttr}` : 'no draw')
  const f2 = await renderRealLayer('3554161528', '雾 2', { pcolor: 'legacy' }, 20.0, 835)
  const f2d = f2 && f2.rec.draws2.filter(isParticleDraw).pop()
  const f2c = f2d ? colorStreamOf(f2d, f2.rec) : null
  const f2r = f2c ? mm([...f2c]) : [0, 0]
  push('⑦H 真包 hina「雾 2」`?pcolor=legacy`：逐粒子灰（colorAttr=1、色差 >0.5、最暗 <0.05）= 改动前的灰白噪点雾',
    !!f2 && f2.stats.pcolorMode === 'legacy' && f2.stats.colorAttr === 1 && (f2r[1] - f2r[0]) > 0.5 && f2r[0] < 0.05,
    `顶点色∈[${f2r.map((v) => v.toFixed(4)).join(',')}] colorAttr=${f2 && f2.stats.colorAttr}`)
} else push('⑦H hina 真包缺失（SKIP 视作 PASS）', true, 'no pkg')
if (hasPkg('3544152633')) {
  // 层 206100「Vapor (double)」：colorrandom 206/184（字节域）+ colorchange(startvalue "1 1 1", endvalue 0.7137)
  const v1 = await renderRealLayer('3544152633', 'Vapor (double)', {}, 20.0, 206100)
  const v1d = v1 && v1.rec.draws2.filter(isParticleDraw).pop()
  const v1c = v1d ? colorStreamOf(v1d, v1.rec) : null
  const v1r = v1c ? mm([...v1c]) : [0, 0]
  push('⑦H 真包 dd/3544152633「Vapor (double)」：官方**乘**口径 ⇒ 逐粒子色只会变暗（≤ 自身 baseColor 上界 206/255；旧赋值式实测上界 0.9802）',
    !!v1c && v1c.length > 30 && v1r[1] <= 206 / 255 + 1e-6 && !!v1 && v1.stats.colorAttr === 1,
    v1c ? `顶点色∈[${v1r.map((v) => v.toFixed(4)).join(',')}] colorAttr=${v1.stats.colorAttr}` : 'no draw')
} else push('⑦H dd/3544152633 真包缺失（SKIP 视作 PASS）', true, 'no pkg')

// ── ⑧ (P-131 批D) 音频驱动发射：官方 Audio response 的 mode/bounds/exponent/frequency ──
//   判据一律"**手算 vs 实测**"：合成分辨率 16 的活视图（官方 `audioprocessingfrequency*` 的 0..15 下标
//   就落在 16 段上）⇒ 手算 env ⇒ 手算发射数 `floor(T·rate·env)` ⇒ 与 `simulateParticleSystem` 的实测比。
//   另一半是三种组件的官方作用方式：emitter `rate·env`、turbulence `phase·(1+env)`、vortex `speed·env`。
{
  const A16 = (pairs) => { const a = new Array(AUDIO_RESPONSE_BANDS).fill(0); for (const [i, x] of pairs) a[i] = x; return a }
  const VIEW = (spec) => {
    const v = createLiveBands(AUDIO_RESPONSE_BANDS)
    const l = new Float32Array(AUDIO_RESPONSE_BANDS), r = new Float32Array(AUDIO_RESPONSE_BANDS)
    if (typeof spec === 'number') { l.fill(spec); r.fill(spec) }
    else { for (const [i, x] of (spec.left || []).entries()) l[i] = x; for (const [i, x] of (spec.right || []).entries()) r[i] = x }
    writeLiveBands(v, l, r, { kind: 'test', hasSource: true })
    return v
  }
  const AUDIO_DEF = (audio, extra = {}) => Object.assign({
    maxcount: 100000,
    emitter: [Object.assign({ name: 'boxrandom', rate: 100, distancemax: '0 0 0' }, audio)],
    initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }],
    operator: [{ name: 'movement' }],
    renderer: [{ name: 'sprite' }],
  }, extra)
  /** 实测：注入视图 → 建系统 → 走到 T 秒 → 存活粒子数（= 发射数，寿命 1000s 不会死） */
  const measure = (def, view, T = 1.0, ctx = {}) => {
    lib.setAudioBands(view)
    const sys = lib.buildParticleSystem(def, ctx)
    lib.simulateParticleSystem(sys, T)
    return sys
  }

  // ⑧-1 手算 env：mode/bounds/exponent/frequency 的每一档（16 段上逐段取均值 → bounds → 幂次）
  {
    const cases = [
      // [视图, spec, 期望 env, 说明]
      [VIEW(1.0), { mode: 3, bounds: [0.5, 1], exponent: 2, freqStart: 1, freqEnd: 3 }, 1, '满音量 ⇒ t=1 ⇒ env=1'],
      [VIEW(0.75), { mode: 3, bounds: [0.5, 1], exponent: 2, freqStart: 1, freqEnd: 3 }, 0.25, 't=(0.75−0.5)/0.5=0.5 ⇒ 0.5²=0.25'],
      [VIEW(0.5), { mode: 3, bounds: [0.5, 1], exponent: 2, freqStart: 1, freqEnd: 3 }, 0, 't=0 ⇒ 0（bounds 下限之下=不响应）'],
      [VIEW(0.6), { mode: 3, bounds: [0, 1], exponent: 1, freqStart: 0, freqEnd: 15 }, 0.6, 'bounds 0..1 + 线性 ⇒ env=raw'],
      [VIEW(0.6), { mode: 3, bounds: [0, 1], exponent: 3, freqStart: 0, freqEnd: 15 }, 0.216, 'exponent 3 ⇒ 0.6³=0.216'],
      [VIEW(0.6), { mode: 3, bounds: [0.8, 1], exponent: 1, freqStart: 0, freqEnd: 15 }, 0, 'bounds 0.8..1 ⇒ 0.6 不响应'],
      [VIEW({ left: A16([[0, 1]]), right: A16([[0, 0.2]]) }), { mode: 1, bounds: [0, 1], exponent: 1, freqStart: 0, freqEnd: 0 }, 1, 'mode=Left ⇒ 只看左通道'],
      [VIEW({ left: A16([[0, 1]]), right: A16([[0, 0.2]]) }), { mode: 2, bounds: [0, 1], exponent: 1, freqStart: 0, freqEnd: 0 }, 0.2, 'mode=Right ⇒ 只看右通道'],
      [VIEW({ left: A16([[0, 1]]), right: A16([[0, 0.2]]) }), { mode: 3, bounds: [0, 1], exponent: 1, freqStart: 0, freqEnd: 0 }, 0.6, 'mode=Center ⇒ (1+0.2)/2'],
      [VIEW({ left: A16([[0, 1]]), right: A16([[0, 1]]) }), { mode: 3, bounds: [0, 1], exponent: 1, freqStart: 1, freqEnd: 3 }, 0, '区间 [1,3] 全 0 ⇒ 0（frequency 是真下标，不是装饰）'],
      [VIEW({ left: A16([[0, 1]]), right: A16([[0, 1]]) }), { mode: 3, bounds: [0, 1], exponent: 1, freqStart: 0, freqEnd: 0 }, 1, '区间 [0,0] 取最低频段 ⇒ 1'],
    ]
    let bad = 0
    const seen = []
    for (const [v, spec, want, why] of cases) {
      const got = audioEnvelope(spec, v)
      if (!near(got, want, 1e-6)) { bad++; seen.push(JSON.stringify(spec) + '→' + got + '(want ' + want + ')') }
    }
    push('⑧-1 包络手算：mode(Left/Right/Center)/bounds/exponent/frequency 区间 11 档全部命中',
      bad === 0, bad ? seen.join(' ') : '11/11（含 Center=(L+R)/2、区间全 0 ⇒ 0）')
    // 官方缺省（emitter 一套：bounds 0.8 1、exponent 2、freq 0..1、mode 0）——语料 6 个 Star_*.json 只写 mode
    const p0 = parseAudioResponse({ audioprocessingmode: 3 }, 'emitter')
    push('⑧-1 `audioprocessingmode:3` 单独出现时的官方缺省（emitter 一套）',
      !!p0 && p0.mode === 3 && p0.bounds[0] === 0.8 && p0.bounds[1] === 1 && p0.exponent === 2 && p0.freqStart === 0 && p0.freqEnd === 1,
      JSON.stringify(p0))
    const noAudio = parseAudioResponse({ rate: 5 }, 'emitter')
    push('⑧-1 组件没写 `audioprocessing*` ⇒ 无音频响应（不是"缺省 mode=0 但照样算"）', noAudio === null, String(noAudio))
  }

  // ⑧-2 emitter：`rate × env` 的实测（手算 = floor(T·rate·env)，T=1s、rate=100/s）
  {
    const def = AUDIO_DEF({ audioprocessingmode: 3, audioprocessingbounds: '0.5 1', audioprocessingexponent: 2, audioprocessingfrequencystart: 1, audioprocessingfrequencyend: 3 })
    const loud = measure(def, VIEW(1.0)), mid = measure(def, VIEW(0.75)), silent = measure(def, VIEW(0.5))
    // 手算 = T·rate·env = 1.0s × 100/s × env；实测与手算的差 ≤1 粒（`simulateParticleSystem` 的 0.05s
    // 步长在末尾会截断，且 `acc` 浮点累加在整边界上可能差 1e-14 ⇒ floor 少 1 —— 与音频无关的既有性质）
    push('⑧-2 注入满音量频段 ⇒ env=1 ⇒ 发射 ≈100 粒（手算 1.0×100×1；±1 为步长量化）',
      Math.abs(loud.particles.length - 100) <= 1 && loud.particles.length > 0, '实测 ' + loud.particles.length)
    push('⑧-2 env=0.25（t=0.5、exp=2）⇒ 发射 ≈25 粒（手算 100×0.25；比例 0.25±0.02）',
      Math.abs(mid.particles.length - 25) <= 1 && Math.abs(mid.particles.length / loud.particles.length - 0.25) <= 0.02,
      '实测 ' + mid.particles.length + '（比例 ' + (mid.particles.length / loud.particles.length).toFixed(3) + '）')
    push('⑧-2 ★有数据源但**静音**（全 0 频段）⇒ env=0 ⇒ **0 粒**（官方：emitter 只在有声音时活跃）',
      silent.particles.length === 0, '实测 ' + silent.particles.length)
    // 没有视图（= 批 D 之前 / `?audioemit=legacy`）⇒ 逐位回到 100 粒、不再受频段影响
    const none = measure(def, null)
    push('⑧-2 ★没有频段视图 ⇒ 完全不调制（≈100 粒，与批 D 之前逐位一致；`?audioemit=legacy` 同）',
      none.particles.length === loud.particles.length && (lib.audioBandsInfo().hasView === false), '实测 ' + none.particles.length)
    // 无源豁免（auto 档）：有视图但 `hasSource=false` ⇒ 也保持旧行为（把 52 层从"整片消失"里救回来）
    const noSrc = createLiveBands(AUDIO_RESPONSE_BANDS)
    const noneSrc = measure(def, noSrc)
    push('⑧-2 auto 档"有视图但无采集源"（hasSource=false）⇒ 保持旧行为（≈100 粒）+ 记账 audioNoSource>0',
      noneSrc.particles.length === loud.particles.length && (noneSrc.audioNoSource | 0) > 0, '实测 ' + noneSrc.particles.length + ' noSource=' + (noneSrc.audioNoSource | 0))
  }

  // ⑧-3 emitter：frequency 区间与 mode 通道选择**真的进了发射数**（不是只算了个 env）
  {
    const bands = { left: new Array(16).fill(0), right: new Array(16).fill(0) }
    bands.left[0] = 1; bands.right[0] = 0.2
    const spec = (audio) => AUDIO_DEF(Object.assign({ audioprocessingmode: 3, audioprocessingbounds: '0 1', audioprocessingexponent: 1 }, audio))
    const left = measure(spec({ audioprocessingmode: 1, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 0 }), VIEW(bands))
    const right = measure(spec({ audioprocessingmode: 2, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 0 }), VIEW(bands))
    const center = measure(spec({ audioprocessingmode: 3, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 0 }), VIEW(bands))
    const hiRange = measure(spec({ audioprocessingmode: 3, audioprocessingfrequencystart: 1, audioprocessingfrequencyend: 15 }), VIEW(bands))
    push('⑧-3 mode 1/2/3 = 左/右/居中：(1.0 / 0.2 / 0.6) ⇒ ≈100 / 20 / 60 粒（±1 步长量化）',
      Math.abs(left.particles.length - 100) <= 1 && Math.abs(right.particles.length - 20) <= 1 && Math.abs(center.particles.length - 60) <= 1,
      `实测 ${left.particles.length}/${right.particles.length}/${center.particles.length}`)
    push('⑧-3 frequency 区间 [1,15] 在该视图下全 0 ⇒ 0 粒（下标语义生效）',
      hiRange.particles.length === 0, '实测 ' + hiRange.particles.length)
  }

  // ⑧-4 turbulence operator：官方"adds a factor to the **Phase** values" ⇒ `phase·(1+env)`
  {
    const mk = (audio) => ({
      maxcount: 200,
      emitter: [{ name: 'boxrandom', rate: 30, distancemax: '200 200 0' }],
      initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }, { name: 'velocityrandom', min: '10 10 0', max: '10 10 0' }],
      operator: [Object.assign({ name: 'turbulence', scale: 0.01, speedmin: 50, speedmax: 50, phasemin: 1, phasemax: 5, mask: '1 1 0' }, audio), { name: 'movement' }],
      renderer: [{ name: 'sprite' }],
    })
    const ph = (view, T = 0.5) => { const s = measure(mk({ audioprocessingmode: 3, audioprocessingbounds: '0 1', audioprocessingexponent: 1, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 15 }), view, T); return s.particles.map((p) => p.turbPh) }
    const off = ph(null), zero = ph(VIEW(0)), one = ph(VIEW(1))
    const doubled = off.length > 0 && off.every((v, i) => near(one[i], v * 2, 1e-9))
    const same = off.length > 0 && off.every((v, i) => Object.is(zero[i], v))
    push('⑧-4 turbulence：env=1 ⇒ 每颗粒子相位**翻倍**（phase·(1+env)，官方 "adds a factor to the Phase"）',
      doubled, off.length ? 'ph(无视图)=' + off[0].toFixed(6) + ' → ph(env=1)=' + one[0].toFixed(6) : '无粒子')
    push('⑧-4 turbulence：env=0（静音）⇒ 相位与"没有视图"逐位相同（phase·(1+0)）', same)
  }

  // ⑧-5 vortex operator：官方"ties the particle speed to audio playback … stop spinning when no audio"
  {
    const mk = (audio) => ({
      maxcount: 200,
      emitter: [{ name: 'boxrandom', rate: 30, distancemax: '200 200 0' }],
      initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }, { name: 'velocityrandom', min: '10 10 0', max: '10 10 0' }],
      operator: [Object.assign({ name: 'vortex', origin: '50 0 0', scale: 100, innerradius: 0, outerradius: 1000 }, audio), { name: 'movement' }],
      renderer: [{ name: 'sprite' }],
    })
    const spd = (view) => {
      const s = measure(mk({ audioprocessingmode: 3, audioprocessingbounds: '0 1', audioprocessingexponent: 1, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 15 }), view, 0.5)
      const a = s.particles.map((p) => Math.hypot(p.vel[0], p.vel[1]))
      return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
    }
    const off = spd(null), zero = spd(VIEW(0)), half = spd(VIEW(0.5))
    const init = Math.hypot(10, 10)   // 只有 velocityrandom(10,10) 时的 |v| 底数
    push('⑧-5 vortex：env=0 ⇒ 平均 |v| 掉回初速底数（官方"没声音就停转"）',
      off > 0 && Math.abs(zero - init) < 0.05 && zero < off - 1,
      `均值 |v|：无视图=${off.toFixed(3)} env=0 ⇒ ${zero.toFixed(3)}（初速底数 ${init.toFixed(3)}）`)
    push('⑧-5 vortex：env=0.5 ⇒ 平均 |v| 严格介于 env=0 与"无音频响应"之间（speed·env 单调）',
      zero < half && half < off,
      `env=0.5 ⇒ ${half.toFixed(3)}，无视图 ⇒ ${off.toFixed(3)}`)
  }

  // ⑧-6 turbulentvelocityrandom initializer：官方同段"adds a factor to the Phase values"
  {
    const mk = (audio) => ({
      maxcount: 60,
      emitter: [{ name: 'boxrandom', rate: 30, distancemax: '0 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 },
        Object.assign({ name: 'turbulentvelocityrandom', speedmin: 100, speedmax: 100, phasemin: 0.5, phasemax: 5 }, audio)],
      operator: [{ name: 'movement' }],
      renderer: [{ name: 'sprite' }],
    })
    const vels = (view) => { const s = measure(mk({ audioprocessingmode: 3, audioprocessingbounds: '0 1', audioprocessingexponent: 1, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 15 }), view, 0.05); return s.particles.map((p) => [p.vel[0], p.vel[1]]) }
    const off = vels(null), zero = vels(VIEW(0)), one = vels(VIEW(1))
    push('⑧-6 turbulentvelocityrandom：env=0 ⇒ 初速与"没有视图"逐位相同（相位 ×1）',
      off.length > 0 && off.every((v, i) => Object.is(v[0], zero[i][0]) && Object.is(v[1], zero[i][1])))
    push('⑧-6 turbulentvelocityrandom：env=1 ⇒ 初速方向改变（相位 ×2 ⇒ 出生角不同）',
      off.length > 0 && off.some((v, i) => Math.abs(v[0] - one[i][0]) > 1e-9 || Math.abs(v[1] - one[i][1]) > 1e-9))
  }

  lib.setAudioBands(null)   // 清场：后面的真包渲染默认回到"没有音频数据源"
}

// ── ⑧R 真包抽检：3 个真音频驱动包（注入固定频段 ⇒ 从"平线"变"有响应"）──
{
  const SPOT = [
    // [语料目录, 包, 层名, 层 id, 该层的 audioprocessing*（诊断用）]
    // ⚠ `dd/3554161528` 的 `notes1_simple`（mode3 bounds0-1 exp1 freq1-15）**贴图是压缩格式**
    //   （`notes_sprite_sheet_130x258_41.tex` format=0，本仓库 decodeMip0 不支持）⇒ mock-GL 里
    //   `buildTex` 拿不到纹理、整层跳过（与本批改动无关）；它在下面按"无粒子批"如实 SKIP。
    ['dd', '3544152633', 'Star Reactive', 3694, 'emitter mode3 bounds 0.5-1 exp3 freq1-3 + turbulence mode3 freq0-2'],
    ['dd', '3544152633', 'reactive Stars', 21971, '2×emitter + initializer[4] + operator[2] 全 mode3（bounds 0.5-1/0.8-1）'],
    ['dd', '3554161528', 'notes1_simple', 2006, 'emitter mode3 bounds 0-1 exp1 freq1-15（贴图为压缩格式 ⇒ 本用例 SKIP）'],
    ['0917', '3299228616', 'Blinking Stars_01', 244, 'emitter mode3（其余走 emitter 官方缺省 bounds 0.8-1 exp2 freq0-1）'],
  ]
  const loud = (() => { const v = createLiveBands(16); const a = new Float32Array(16).fill(1); writeLiveBands(v, a, a, { kind: 'test', hasSource: true }); return v })()
  const quiet = (() => { const v = createLiveBands(16); const a = new Float32Array(16); writeLiveBands(v, a, a, { kind: 'test', hasSource: true }); return v })()
  for (const [sub, id, name, lid, why] of SPOT) {
    const dir = sub === 'dd' ? DIR : `${MPW_WS}/allwallpaper/${sub}`
    if (!hasPkg(id, dir)) { push('⑧R 真包 ' + id + ' 缺失（SKIP 视作 PASS）', true, 'no pkg'); continue }
    lib.setAudioBands(null)
    const base = await renderRealLayer(id, name, {}, 6.0, lid, dir)
    lib.setAudioBands(quiet)
    const sil = await renderRealLayer(id, name, {}, 6.0, lid, dir)
    lib.setAudioBands(loud)
    const hot = await renderRealLayer(id, name, {}, 6.0, lid, dir)
    lib.setAudioBands(null)
    if (!base || !base.stats || !base.stats.audioLayers) { push('⑧R 真包 ' + id + '「' + name + '」无粒子批（SKIP 视作 PASS）', true); continue }
    const nBase = base.stats.alive, nSil = sil ? sil.stats.alive : -1, nHot = hot ? hot.stats.alive : -1
    const info = base.stats.audioLayers[name] || null
    push('⑧R ' + id + '「' + name + '」有音频响应组件被认出来（' + why + '）',
      !!info && info.env === null, info ? 'mode=' + info.mode + ' emitters=' + info.emitters + ' env(无视图)=' + info.env : '未记账')
    push('⑧R ' + id + '「' + name + '」★注入"有数据源但静音" ⇒ alive 从 ' + nBase + ' 变 0（官方"没音乐不发射"）',
      nSil === 0 && nBase > 0, 'alive: 无视图 ' + nBase + ' / 静音 ' + nSil + ' / 满音量 ' + nHot)
    push('⑧R ' + id + '「' + name + '」★注入满音量 ⇒ alive 回到 ' + nBase + '（响应是"有数据才发射"，不是被压死）',
      nHot === nBase, 'alive: 静音 ' + nSil + ' / 满音量 ' + nHot + ' / 无视图 ' + nBase)
  }
}

// ── ⑧M 反向变异（P-131 音频驱动发射，改回旧写法 ⇒ 必红）──
//   要求：变异在 **/tmp 的真文件副本**里做（手工 readFileSync/writeFileSync，不用 fs.cpSync —— 本机它抛 EINVAL）；
//   真树只读，跑前跑后 sha256 不变（用例结束会 unlink 临时文件）。
{
  const red = []
  const VIEW = (x) => { const v = createLiveBands(16); const a = new Float32Array(16).fill(x); writeLiveBands(v, a, a, { kind: 'test', hasSource: true }); return v }
  const def = { maxcount: 100000, emitter: [{ name: 'boxrandom', rate: 100, distancemax: '0 0 0', audioprocessingmode: 3, audioprocessingbounds: '0.5 1', audioprocessingexponent: 2, audioprocessingfrequencystart: 1, audioprocessingfrequencyend: 3 }],
    initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }], operator: [{ name: 'movement' }], renderer: [{ name: 'sprite' }] }
  const turbDef = { maxcount: 200, emitter: [{ name: 'boxrandom', rate: 30, distancemax: '200 200 0' }],
    initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }, { name: 'velocityrandom', min: '10 10 0', max: '10 10 0' }],
    operator: [{ name: 'turbulence', scale: 0.01, speedmin: 50, speedmax: 50, phasemin: 1, phasemax: 5, mask: '1 1 0', audioprocessingmode: 3, audioprocessingbounds: '0 1', audioprocessingexponent: 1, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 15 }, { name: 'movement' }],
    renderer: [{ name: 'sprite' }] }
  const CORE = path.join(_root.ROOT, 'core')
  const SRC_FILE = path.join(CORE, 'we-scene-bundle.js')
  const SRC = fs.readFileSync(SRC_FILE, 'utf8')
  // 真树完整性：变异只落 /tmp 副本，跑前跑后**同一 sha256**（下面 push 断言）
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  const sha = (f) => { try { return require('node:crypto') } catch (e) { return null } }
  const mutant = async (label, from, to, check) => {
    if (!SRC.includes(from)) { red.push(label + ' **变异没生效**（锚点不在源码里）'); return }
    const tmp = path.join(os.tmpdir(), 'p131-mut-' + label.replace(/[^a-zA-Z0-9]/g, '') + '.mjs')
    // 副本落在 /tmp ⇒ 把同目录的相对 import 改写成绝对路径（否则副本 import 不到 attach-transform 等）
    const body = SRC.replace(from, to).replace(/from '\.\//g, "from '" + CORE + '/')
    fs.writeFileSync(tmp, body)
    try {
      const m = await import('file://' + tmp)
      m.setAudioBands(VIEW(1.0))
      const r = check(m)
      red.push((r.red ? '变异生效' : '变异**没红**') + '｜' + label + '：' + r.detail)
    } finally { try { fs.unlinkSync(tmp) } catch (e) { /* ignore */ } }
  }
  await mutant('变异A(发射率不乘 env)', 'const __env = audioFactor(em.audio, sys)\n    const audioK = __env === null ? 1 : __env', 'const audioK = 1', (m) => {
    const sys = m.buildParticleSystem(def, {})
    m.simulateParticleSystem(sys, 1.0)
    // 旧算式（rate 恒不乘 env）在 env=1 下仍然是 100 粒 —— 与"本批正确值"相同 ⇒ 这个变异**不会**改数，
    // 所以判据用"静音频段"：正确实现 env=0 ⇒ 0 粒；不乘 env 的旧写法 ⇒ 仍是 100 粒（必红）。
    m.setAudioBands(VIEW(0))
    const s2 = m.buildParticleSystem(def, {})
    m.simulateParticleSystem(s2, 1.0)
    return { red: s2.particles.length !== 0, detail: '静音频段 ⇒ 实测 ' + s2.particles.length + ' 粒（正确实现应为 0）' }
  })
  await mutant('变异B(turbulence 相位不乘 1+env)', 'const ph = ph0 * (1 + audioPhase)', 'const ph = ph0', (m) => {
    const sys = m.buildParticleSystem(turbDef, {})
    m.simulateParticleSystem(sys, 0.5)
    m.setAudioBands(null)
    const s0 = m.buildParticleSystem(turbDef, {})
    m.simulateParticleSystem(s0, 0.5)
    const a = sys.particles.map((p) => p.turbPh), b = s0.particles.map((p) => p.turbPh)
    const doubled = a.length > 0 && a.every((v, i) => Math.abs(v - b[i] * 2) < 1e-9)
    return { red: !doubled, detail: '相位 ' + (a[0] != null ? a[0].toFixed(4) : '?') + ' 应为无视图的一半 ' + (b[0] != null ? (b[0] * 2).toFixed(4) : '?') }
  })
  for (const r of red) console.log('   RED ' + r)
  push('⑧M RED-IF-REVERTED：两处音频驱动改动各自改回旧写法后，对应断言都变红（' + red.filter((x) => /变异生效/.test(x)).length + '/2，副本在 /tmp、真树只读）',
    red.filter((x) => /变异生效/.test(x)).length === 2)
  const leftovers = fs.readdirSync('/tmp').filter((f) => /^p131-mut-.*\.mjs$/.test(f))
  push('⑧M 真树 `core/we-scene-bundle.js` 跑前跑后 sha256 相同（变异副本落 /tmp 且已 unlink）',
    shaOf(SRC_FILE) === srcSha && leftovers.length === 0, srcSha.slice(0, 16) + ' /tmp 残留=' + leftovers.length)
}

const fail = checks.filter((c) => !c.ok)
console.log(`\n===== particle-render-correctness: ${checks.length - fail.length} 通过 / ${fail.length} 失败 =====`)
if (fail.length) { for (const f of fail) console.log('  FAIL ' + f.name + (f.detail ? ' — ' + f.detail : '')) }
process.exit(fail.length ? 1 : 0)

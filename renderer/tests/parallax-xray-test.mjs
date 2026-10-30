// parallax-xray-test.mjs —— ①(P-338 2026-10-12) 视差链 + xray 族的**指针接线**：注入通道必须真的驱动它们
//
// 复现：`node tests/parallax-xray-test.mjs`（纯 Node + mock-GL，**不需要浏览器 / 网络 / GPU**）
// 退出码：0 全绿 / 1 有断言失败。
//
// ── 这份判据要回答的两个现场问题（用户原话）──────────────────────────────────────────────
//   ②「`夜莺night——【parallax_视差】blue_archive_妃咲…` 这个壁纸**视差效果没有实现**；
//      开了指针注入后移动指针**仍无效果**」
//   ③「x-ray 效果也没有实现；指针注入后同样没有」
//
// ── 改前实测（本档 §A 的 A2/A5 就是它的机器形式）────────────────────────────────────────
//   同一场景、同一指针、同一帧数，只换输入通道：
//     DOM 派发 `window.mousemove`（clientX 0.95×1000）⇒ 层中心 NDC 位移 **Δ=−864.0000px**
//     注入通道 `globalThis.__mpwPointer = {x:0.95·3840, y:0.05·2160}` ⇒ **Δ=0.0000px**（改前）
//   根因（源码）：视差链只认自己那个 `window.mousemove` 私有监听器 `attachParallaxListener()`；
//   注入通道（宿主 / 测试台「指针注入」的 `__wp.pushPointer` 写的就是 `window.__mpwPointer`）
//   与画布 `pointermove` 一个都到不了 `parallaxState` ⇒ 场景级 `parDisp`、对象级 `parallaxDepth`、
//   以及 `g_ParallaxPosition`（官方 `effects/depthparallax` 的输入）**三处一起冻在中点**。
//   而 `effects/depthparallax` 正是该壁纸用的视差效果（`scene.json` 里 2 例：层「地板」「纸堆」）。
//
// ── x-ray 侧的实测（§B）──────────────────────────────────────────────────────────────
//   该 x-ray 包自带的 `shaders/effects/xray.frag:43` 比官方桌面版**多一行**：
//     `unprojectedUVs *= CAST2(1.0 / max(0.00001, g_PointerState.y));`
//   本仓改前把 `g_PointerState.y` 写成**指针的层 UV v** ⇒ 精灵采样偏移被放大 `1/v` 倍
//   ⇒ 开窗面积随光标高度剧烈变化：v=1.00→6.50%、v=0.50→3.24%、v=0.25→0.82%、v=0.10→0.12%、
//      v=0.02→**0.01%**（等于"贴近顶边就没有 x-ray"）；
//   本机官方桌面资产 `wallpaper_engine/assets/effects/xray/shaders/effects/xray.frag`
//   **没有这一行**（等价于因子 1.0）⇒ 本仓改后对 xray 族填 1.0，窗口面积稳定在 6.50%~13.00%。
//   面积由 `builtinAssetTextureRGBA('particle/halo_6')`（= `g_Texture2` 的官方默认精灵）
//   + 逐行复算的 shader 数学给出（见下面 `xrayWindowArea`，纯函数、可手算复核）。
//
// ── 档位（回退位）──────────────────────────────────────────────────────────────────
//   `?ptrwiring=legacy` = 两处接线**一起**逐位回到改动前（A：视差链只认 `window.mousemove`；
//   B：xray 族 `.y` = 指针层 UV v）。判据用 `opts.parallaxPtrLegacy` / `opts.xrayStateLegacy`
//   在同进程里切两态（显式布尔优先于 URL 档）——**不需要起第二个进程**。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const MPW_WS = process.env.MPW_ROOT || WS
const CORE_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

let passN = 0, failN = 0, skipN = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const skip = (name, detail) => { skipN++; console.log('  SKIP ' + name + (detail ? '  [' + detail + ']' : '')) }
const V = (o) => JSON.stringify(o)

// ═════════════════════════ mock-GL（与 tests/ptrfx-uniform-test.mjs 同款最小实现）════════════════════
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FLOAT: 0x1406, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51,
  FLOAT_VEC4: 0x8B52, INT: 0x1404, BOOL: 0x8B56, FLOAT_MAT4: 0x8B5C, FLOAT_MAT3: 0x8B5B, SAMPLER_2D: 0x8B5E }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const TYPE_OF = { float: CONST.FLOAT, int: CONST.INT, bool: CONST.BOOL, vec2: CONST.FLOAT_VEC2, vec3: CONST.FLOAT_VEC3,
  vec4: CONST.FLOAT_VEC4, mat4: CONST.FLOAT_MAT4, mat3: CONST.FLOAT_MAT3, sampler2D: CONST.SAMPLER_2D }
function mkGL() {
  let seq = 0, curProg = null
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const shaderSrc = new Map(), progShaders = new Map(), uniCache = new Map()
  const rec = { uniWrites: [], draws: 0 }
  const parseUnis = (p) => {
    const out = [], seen = new Set()
    for (const s of (progShaders.get(p) || [])) {
      const src = shaderSrc.get(s) || ''
      const re = /uniform\s+(?:lowp |mediump |highp )?([A-Za-z0-9_]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\[\s*\d+\s*\])?\s*;/g
      let m
      while ((m = re.exec(src)) !== null) {
        const name = m[3] ? m[2] + '[0]' : m[2]
        if (seen.has(name)) continue
        seen.add(name)
        out.push({ name, type: TYPE_OF[m[1]] || CONST.FLOAT })
      }
    }
    return out
  }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    attachShader: (p, s) => { if (!progShaders.has(p)) progShaders.set(p, []); progShaders.get(p).push(s) },
    shaderSource: (s, src) => { shaderSrc.set(s, String(src)) },
    bindVertexArray: () => {}, bindBuffer: () => {}, bufferData: () => {}, bindAttribLocation: () => {}, linkProgram: () => {},
    activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {}, useProgram: (p) => { curProg = p },
    drawArrays: () => { rec.draws++ }, drawElements: () => {},
    getProgramParameter: (p, k) => {
      if (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) return true
      if (k === CONST.ACTIVE_ATTRIBUTES) return 2
      if (k === CONST.ACTIVE_UNIFORMS) { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p).length }
      return null
    },
    getActiveUniform: (p, i) => { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p)[i] || null },
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1),
    getUniformLocation: (p, n) => ({ p, n: String(n).replace(/\[0\]$/, '') }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1f: (l, a) => rec.uniWrites.push({ name: l && l.n, kind: 'f', v: a }),
    uniform1i: (l, a) => rec.uniWrites.push({ name: l && l.n, kind: 'i', v: a }),
    uniform2f: (l, a, b) => rec.uniWrites.push({ name: l && l.n, kind: 'f2', v: [a, b] }),
    uniform3f: (l, a, b, c) => rec.uniWrites.push({ name: l && l.n, kind: 'f3', v: [a, b, c] }),
    uniform4f: (l, a, b, c, d) => rec.uniWrites.push({ name: l && l.n, kind: 'f4', v: [a, b, c, d] }),
    uniform1fv: (l, arr) => rec.uniWrites.push({ name: l && l.n, kind: 'fv', v: Array.from(arr) }),
    uniformMatrix4fv: (l, t, m) => rec.uniWrites.push({ name: l && l.n, kind: 'm4', v: m ? Array.from(m) : null }),
    uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
/** 声明视差位置 + 指针族（含 xray 族的 `g_PointerScale` 变体）。 */
const FRAG_P = ['uniform sampler2D g_Texture0;', 'uniform vec2 g_ParallaxPosition;', 'uniform vec2 g_PointerPosition;',
  'uniform vec4 g_PointerState;', 'varying vec2 v_TexCoord;',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * (g_ParallaxPosition.x + g_PointerPosition.y + g_PointerState.z); }'].join('\n')
const FRAG_P_XRAY = FRAG_P.replace('uniform sampler2D g_Texture0;', 'uniform sampler2D g_Texture0;\nuniform float g_PointerScale;')
/** 不声明 `g_PointerScale` 的普通效果程序（`g_PointerState.y` 的 A6 契约必须逐位不变）。 */
const FRAG_P_PLAIN = FRAG_P
const lastW = (rec, name) => { const w = rec.uniWrites.filter((x) => x.name === name); return w.length ? w[w.length - 1].v : null }
const eq = (a, b, eps) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
  a.every((x, i) => Math.abs(x - b[i]) <= (eps === undefined ? 1e-6 : eps))

// ═════════════════════════ 官方算式（写在这里，**不抄实现**）════════════════════════════
const PROJ_W = 3840, PROJ_H = 2160
const CAM_CX = PROJ_W / 2, CAM_CY = PROJ_H / 2
const WINDOW_W = 1000, WINDOW_H = 500
const NDC_TOL = 1e-6
const ndcOf = (relDesignX) => (relDesignX + CAM_CX) / PROJ_W * 2 - 1
const pxOf = (ndc) => ndc * PROJ_W / 2
/** 官方 (o1)：`S = 0.5 − p·min(influence,1)`；本仓 `parDisp = (0.5 − cursor)·ortho·min(infl,1)`。 */
const parDispPx = (cursor, ortho, influence) => (0.5 - cursor) * ortho * Math.min(influence, 1)
/** 官方 (o2)：`offset = (rootPos − S) ∘ depth × amount`；层心在画布中心 ⇒ 期望读 = parDisp·depth·amount。 */
const officialOffsetPx = (cursor, ortho, influence, depth, amount) => parDispPx(cursor, ortho, influence) * depth * amount
const officialReadingNdc = (cursor, ortho, influence, depth, amount) => ndcOf(officialOffsetPx(cursor, ortho, influence, depth, amount))

// ═════════════════════════ 合成夹具 ═════════════════════════
const TEX = new Map([['tex_a', { glTex: { id: 't_a' }, width: 64, height: 64 }]])
/** 满幅层（层 UV == 画布归一 ⇒ `__fxPointerToLayerUV` 的恒等支）。 */
const mkLayer = (extra) => Object.assign({ id: 1, name: 'L', visible: true, solid: false, isContainer: false,
  textureName: 'tex_a', size: [PROJ_W, PROJ_H], scale: [1, 1, 1], origin: [CAM_CX, CAM_CY, 0], angles: [0, 0, 0],
  alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, parallaxDepth: [1, 1], effects: [] }, extra || {})
const mkEffect = (frag) => ({ file: 'fx_' + frag, visible: true, passes: [{ combos: {}, constantshadervalues: {}, textures: [null] }], fbos: [],
  materialPasses: [{ shader: frag, blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} }] })
const PAR_ON = { cameraparallax: true, cameraparallaxamount: 0.5, cameraparallaxdelay: 0, cameraparallaxmouseinfluence: 1 }
const mkScene = (layers, general) => ({ general: Object.assign({ orthogonalprojection: { width: PROJ_W, height: PROJ_H } }, general || {}),
  camera: null, properties: {}, layers })
/**
 * 建一个渲染器会话：假 `window`（收 `mousemove` 监听器）+ mock-GL + 逐层 NDC 台账 + uniform 台账。
 * `ptr` = 'none' | 'dom' | 'inject'：只有 'dom' 派发 `window.mousemove`，只有 'inject' 写注入通道。
 */
async function mkRun(lib, scene, rendererOpts, frag) {
  const handlers = []
  const savedWin = globalThis.window
  globalThis.window = { innerWidth: WINDOW_W, innerHeight: WINDOW_H,
    addEventListener: (t, f) => handlers.push({ t, f }), removeEventListener: () => {} }
  delete globalThis.__mpwPointer
  const { gl, rec } = mkGL()
  const last = {}
  const r = lib.createRenderer({ getContext: () => gl },
    Object.assign({ shaderResolver: async (rel) => (String(rel).endsWith('.vert') ? VERT : (frag || FRAG_P)),
      onLog: () => {}, onLayerDraw: (layer, info) => { last[String(layer.name)] = [info.mvp[12], info.mvp[13]] } }, rendererOpts || {}))
  let t = 0
  return {
    async frame(dt) { t += (dt === undefined ? 1 / 60 : dt); await r.render(scene, TEX, 1280, 720, t) },
    moveDom(x, y) {
      const mm = handlers.find((h) => h.t === 'mousemove')
      if (!mm) throw new Error('mousemove 监听没挂上（attachParallaxListener 未生效）')
      mm.f({ clientX: x * WINDOW_W, clientY: y * WINDOW_H })
    },
    moveInject(x, y) { globalThis.__mpwPointer = { x: x * PROJ_W, y: y * PROJ_H, inside: true } },
    /** 注入**层 UV** 坐标（满幅层 == 画布归一，但语义上写的是层 UV，便于 × 非满幅层复用） */
    moveInjectLayerUV(u, v) { globalThis.__mpwPointer = { x: u * PROJ_W, y: v * PROJ_H, inside: true } },
    clearInject() { delete globalThis.__mpwPointer },
    readLayer(name) { const v = last[name]; return v ? [v[0], v[1]] : null },
    uniform(name) { return lastW(rec, name) },
    hasDomListener: () => !!handlers.find((h) => h.t === 'mousemove'),
    restore() { delete globalThis.__mpwPointer; if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin },
  }
}

// ═════════════════════════ xray 窗口面积的**纯数学**复算（不依赖 GL）════════════════════════
/** `g_Texture2` 的官方默认精灵（本仓内置程序化贴图，与渲染端同一个函数）。 */
let HALO = null
function haloAlphaAt(u, v) {
  const S = HALO.width, A = HALO.rgba
  const x = Math.min(S - 1, Math.max(0, Math.round(u * S - 0.5)))
  const y = Math.min(S - 1, Math.max(0, Math.round(v * S - 0.5)))
  return A[(y * S + x) * 4 + 3] / 255
}
const sat01 = (x) => Math.min(1, Math.max(0, x))
/**
 * 逐行复算包内 `shaders/effects/xray.frag` + `xray.vert`（不含 `common_blending.h` 的 ApplyBlending，
 * 因为面积只取决于 halo 采样因子）：
 *   vert：`v_PointerUV.xyz = (pointer*2-1,0,1) · ETVPInverse`（本仓 ETVPInverse = 单位阵）→ `.xy *= 0.5`；
 *          `v_PointerUV.w = g_Texture0Resolution.y / -g_Texture0Resolution.x`；`v_PointerScale = 1/size`。
 *   frag：`unprojectedUVs = saturate(texSource − pointerUV) − 0.5` → `*= v_PointerScale * vec2(1, w)`
 *          → `*= 1/max(1e-5, g_PointerState.y)` → `+= 0.5` → `tex(g_Texture2, ·).ra`。
 * @returns {number} blend 因子 > 0.02 的像素占整层比例（0..1）
 */
function xrayWindowArea(P, pointerScale, stateY, texRes, N = 160) {
  const vx = (P[0] * 2 - 1) * 0.5
  const vy = ((1 - P[1]) * 2 - 1) * 0.5
  const w = texRes[1] / -texRes[0]
  const sp = pointerScale > 0.001 ? 1 / pointerScale : 999
  const f = 1 / Math.max(0.00001, stateY)
  let n = 0
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const tu = (i + 0.5) / N, tv = (j + 0.5) / N
      let ox = sat01(tu - vx) - 0.5, oy = sat01((1 - tv) - vy) - 0.5
      ox *= sp; oy *= sp * w
      ox *= f; oy *= f
      if (haloAlphaAt(ox + 0.5, oy + 0.5) > 0.02) n++
    }
  }
  return n / (N * N)
}

// ═════════════════════════ 被测 suite（核心；变异副本重跑同一个函数）════════════════════════
async function runSuite(lib, o) {
  const opt = o || {}
  const checks = {}, show = {}
  const C = (id, cond, detail) => { checks[id] = !!cond; show[id] = detail === undefined ? '' : String(detail) }
  HALO = lib.builtinAssetTextureRGBA('particle/halo_6')
  const CURSOR = [0.95, 0.05]

  // ── §A 视差链：三个通道 × 两档 = 六格真值表 ──────────────────────────────────────────
  {
    const sc = mkScene([mkLayer({ parallaxDepth: [1, 1] })], PAR_ON)
    const wantX = officialReadingNdc(CURSOR[0], PROJ_W, 1, 1, 0.5)     // cursor 0.95 ⇒ −864.0000px
    const wantY = 0.5 * PROJ_H * (0.5 - 0.5)                          // 预置：y 用同一式（见下）
    void wantY

    // ① DOM 通道（改动前就有，作为"官方算式"的锚）
    {
      const run = await mkRun(lib, sc, {})
      try {
        await run.frame()
        run.moveDom(CURSOR[0], CURSOR[1])
        await run.frame()
        const got = run.readLayer('L')
        C('PAR-DOM-OFFICIAL', Math.abs(pxOf(got[0]) - officialOffsetPx(CURSOR[0], PROJ_W, 1, 1, 0.5)) <= 1e-3,
          'Δx=' + pxOf(got[0]).toFixed(4) + 'px 官方=' + officialOffsetPx(CURSOR[0], PROJ_W, 1, 1, 0.5).toFixed(4) + 'px')
      } finally { run.restore() }
    }
    // ② 注入通道（**本轮新行为**：改前 Δx 恒 0.0000px）
    {
      const run = await mkRun(lib, sc, {})
      try {
        await run.frame()
        run.moveInject(CURSOR[0], CURSOR[1])
        await run.frame()
        const got = run.readLayer('L')
        const gotPx = pxOf(got[0])
        C('PAR-INJECT-OFFICIAL', Math.abs(gotPx - officialOffsetPx(CURSOR[0], PROJ_W, 1, 1, 0.5)) <= 1e-3,
          'Δx=' + gotPx.toFixed(4) + 'px 官方=' + officialOffsetPx(CURSOR[0], PROJ_W, 1, 1, 0.5).toFixed(4) + 'px（改前 0.0000px）')
      } finally { run.restore() }
    }
    // ③ 注入通道 + legacy 档 ⇒ **逐位回改动前**（0；这是"回退位真的回退了"的机器形式）
    {
      const run = await mkRun(lib, sc, { parallaxPtrLegacy: true })
      try {
        await run.frame()
        run.moveInject(CURSOR[0], CURSOR[1])
        await run.frame()
        const got = run.readLayer('L')
        C('PAR-INJECT-LEGACY-ZERO', Math.abs(pxOf(got[0])) <= 0.01, 'Δx=' + pxOf(got[0]).toFixed(6) + 'px（legacy 期望 0；容差 0.01px = float32 MVP 量化）')
      } finally { run.restore() }
    }
    // ④ legacy 档下 DOM 通道照旧（证"回退位只回退了新行为"，不是把整条链关掉）
    {
      const run = await mkRun(lib, sc, { parallaxPtrLegacy: true })
      try {
        await run.frame()
        run.moveDom(CURSOR[0], CURSOR[1])
        await run.frame()
        const got = run.readLayer('L')
        C('PAR-LEGACY-DOM-STILL-WORKS', Math.abs(pxOf(got[0]) - officialOffsetPx(CURSOR[0], PROJ_W, 1, 1, 0.5)) <= 1e-3,
          'Δx=' + pxOf(got[0]).toFixed(4) + 'px')
      } finally { run.restore() }
    }
    // ⑤ y 分量走同一个源（cursor.y=0.1 ⇒ parDispY=+864px ⇒ 层位移 +432px）
    {
      const run = await mkRun(lib, sc, {})
      try {
        await run.frame()
        run.moveInject(0.5, 0.1)
        await run.frame()
        const got = run.readLayer('L')
        const wantPy = officialOffsetPx(0.1, PROJ_H, 1, 1, 0.5)
        const gotPy = got[1] * PROJ_H / 2
        /* ⚠ 符号口径：`mvp[13]` 是 **NDC y（朝上）**，而本仓世界 y 朝下 ⇒ 世界 +y 位移在 NDC 上读作负号。
           `tests/official-parallax-formula-test.mjs` 的"读数口径"里同样只判 x（y 有已知残余差异）
           ⇒ 这里判**幅值**并打印两侧符号，不假装逐位对齐。 */
        C('PAR-INJECT-Y', Math.abs(Math.abs(gotPy) - Math.abs(wantPy)) <= 0.01,
          'Δy(NCD 口径)=' + gotPy.toFixed(4) + 'px 世界期望=' + wantPy.toFixed(4) + 'px（|Δ| 相等；符号为 y-down→NDC 翻转）')
      } finally { run.restore() }
    }
    // ⑥ 完全没指针 ⇒ 不位移（不是"没指针就当 0.5 重算"）
    {
      const run = await mkRun(lib, sc, {})
      try {
        await run.frame()
        await run.frame()
        const got = run.readLayer('L')
        C('PAR-NO-POINTER-NO-DRIFT', Math.abs(pxOf(got[0])) <= 0.01, 'Δx=' + pxOf(got[0]).toFixed(6) + 'px（容差 0.01px）')
      } finally { run.restore() }
    }
  }

  // ── §A2 `g_ParallaxPosition`（官方 `effects/depthparallax` 的输入）────────────────────
  {
    // ① 注入 ⇒ uniform 逐位 = 注入的归一坐标
    {
      const sc = mkScene([mkLayer({ effects: [mkEffect('depthparallax')] })], PAR_ON)
      const run = await mkRun(lib, sc, {})
      try {
        await run.frame()
        run.moveInject(0.92, 0.08)
        await run.frame()
        const got = run.uniform('g_ParallaxPosition')
        C('PXPOS-INJECT', eq(got, [0.92, 0.08], 1e-6), 'g_ParallaxPosition=' + V(got) + '（期望 [0.92,0.08]）')
      } finally { run.restore() }
    }
    // ② legacy 档 + 注入 ⇒ 冻在中心
    {
      const sc = mkScene([mkLayer({ effects: [mkEffect('depthparallax')] })], PAR_ON)
      const run = await mkRun(lib, sc, { parallaxPtrLegacy: true })
      try {
        await run.frame()
        run.moveInject(0.92, 0.08)
        await run.frame()
        const got = run.uniform('g_ParallaxPosition')
        C('PXPOS-LEGACY-CENTER', eq(got, [0.5, 0.5], 1e-9), 'g_ParallaxPosition=' + V(got) + '（legacy 期望 [0.5,0.5]）')
      } finally { run.restore() }
    }
    // ③ 场景**没声明** cameraparallax ⇒ 不喂（`tests/ptrfx-uniform-test.mjs` A5 的契约逐位不变）
    {
      const sc = mkScene([mkLayer({ effects: [mkEffect('depthparallax')] })], {})
      const run = await mkRun(lib, sc, {})
      try {
        await run.frame()
        run.moveInject(0.92, 0.08)
        await run.frame()
        const got = run.uniform('g_ParallaxPosition')
        C('PXPOS-NO-CAMERAPARALLAX', eq(got, [0.5, 0.5], 1e-9), 'g_ParallaxPosition=' + V(got) + '（无 cameraparallax 期望 [0.5,0.5]）')
      } finally { run.restore() }
    }
  }

  // ── §B xray：`g_PointerState.y` 与由此算出的开窗面积 ──────────────────────────────────
  const XR_SIZE = 0.39, XR_TEXRES = [4132, 3000]
  {
    const P = [0.9, 0.02]
    // ① xray 族（声明 g_PointerScale）⇒ `.y = 1`
    let stY = null
    {
      const sc = mkScene([mkLayer({ effects: [mkEffect('xray')] })], PAR_ON)
      const run = await mkRun(lib, sc, {}, FRAG_P_XRAY)
      try {
        await run.frame()
        run.moveInjectLayerUV(P[0], P[1])
        await run.frame()
        const st = run.uniform('g_PointerState')
        stY = st ? st[1] : null
        C('XRAY-STATE-Y-ONE', !!st && Math.abs(st[1] - 1) <= 1e-9,
          'g_PointerState=' + V(st) + '（xray 族期望 .y=1）')
        C('XRAY-STATE-Z-KEPT', !!st && Math.abs(st[0] - P[0]) <= 1e-3 && Math.abs(st[2] - 0) <= 1e-9,
          '.x=' + (st && st[0]) + ' .z=' + (st && st[2]) + '（只有 .y 变，.x/.z 不动）')
      } finally { run.restore() }
    }
    // ② 数值：把台账里**实际写出的** `.y` 代进 shader 数学 ⇒ 开窗面积
    {
      const area = (stY === null) ? -1 : xrayWindowArea(P, XR_SIZE, stY, XR_TEXRES)
      C('XRAY-WINDOW-AREA', area >= 0.05,
        '开窗面积=' + (area * 100).toFixed(2) + '%（指针 v=0.02；期望 ≥5%，即官方桌面 xray 的稳定量级）')
    }
    // ③ legacy 档 ⇒ `.y` 逐位 = 指针层 UV v，面积塌到 1% 以下（这就是用户看到的"没有 x-ray"）
    {
      const sc = mkScene([mkLayer({ effects: [mkEffect('xray')] })], PAR_ON)
      const run = await mkRun(lib, sc, { xrayStateLegacy: true }, FRAG_P_XRAY)
      try {
        await run.frame()
        run.moveInjectLayerUV(P[0], P[1])
        await run.frame()
        const st = run.uniform('g_PointerState')
        const area = st ? xrayWindowArea(P, XR_SIZE, st[1], XR_TEXRES) : -1
        C('XRAY-STATE-LEGACY-V', !!st && Math.abs(st[1] - P[1]) <= 1e-3,
          'g_PointerState=' + V(st) + '（legacy 期望 .y=' + P[1] + '）')
        C('XRAY-WINDOW-AREA-LEGACY-TINY', area >= 0 && area <= 0.005,
          'legacy 开窗面积=' + (area * 100).toFixed(3) + '%（期望 ≤0.5% ⇒ "贴近顶边就没有 x-ray"）')
      } finally { run.restore() }
    }
    // ④ **非** xray 族（不声明 g_PointerScale）⇒ `.y` 仍是指针 v（`ptrfx-uniform-test` A6 契约逐位不变）
    {
      const sc = mkScene([mkLayer({ effects: [mkEffect('plain')] })], PAR_ON)
      const run = await mkRun(lib, sc, {}, FRAG_P_PLAIN)
      try {
        await run.frame()
        run.moveInjectLayerUV(0.8, 0.2)
        await run.frame()
        const st = run.uniform('g_PointerState')
        C('XRAY-OTHER-PROG-KEEPS-V', !!st && Math.abs(st[1] - 0.2) <= 1e-6 && Math.abs(st[0] - 0.8) <= 1e-6,
          'g_PointerState=' + V(st) + '（非 xray 族期望 [0.8,0.2,0,0]）')
      } finally { run.restore() }
    }
  }

  // ── §C 真实语料（缺语料 ⇒ SKIP；变异副本用 skipCorpus 跳过，红集才与语料无关）────────────
  if (!opt.skipCorpus) {
    const dir1004 = path.join(MPW_WS, 'allwallpaper', '1004')
    const pick = (re) => {
      try { return fs.readdirSync(dir1004).find((n) => re.test(n)) || null } catch (e) { return null }
    }
    const parMpkg = pick(/妃咲.*\.mpkg$/)
    const xrayMpkg = pick(/x-ray.*\.mpkg$/)
    const readPkgScene = (file) => {
      const buf = fs.readFileSync(path.join(dir1004, file))
      const pkg = lib.parsePkg(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
      const rdT = (e) => new TextDecoder().decode(e)
      const txt = (n) => { const e = lib.getEntry(pkg, n); return e ? rdT(e) : null }
      return { pkg, rdT, txt }
    }
    if (!parMpkg) skip('RP-PARALLAX-MECHANISM', '语料缺席：' + path.join('allwallpaper', '1004') + '/…妃咲….mpkg')
    else {
      const { pkg, rdT, txt } = readPkgScene(parMpkg)
      const sj = JSON.parse(txt('scene.json'))
      const g = sj.general || {}
      const depths = (sj.objects || []).filter((o) => o.parallaxDepth !== undefined).length
      const dp = (sj.objects || []).filter((o) => (o.effects || []).some((e) => /depthparallax/.test(String(e.file)))).length
      const xr = (sj.objects || []).filter((o) => (o.effects || []).some((e) => /(^|\/)xray\//.test(String(e.file)))).length
      const camP = (g.cameraparallax && typeof g.cameraparallax === 'object') ? g.cameraparallax.value : g.cameraparallax
      C('RP-PARALLAX-MECHANISM', camP === true && depths >= 30 && dp === 2 && xr === 0,
        'cameraparallax=' + camP + ' 带 parallaxDepth 的对象=' + depths + ' 个 depthparallax 效果=' + dp + ' 个 xray 效果=' + xr +
        ' ⇒ 机制 = 相机/对象 parallaxDepth + depthparallax 效果（**不是** xray）')
      // 端到端：真实场景 + 注入 ⇒ `g_ParallaxPosition` 跟着走（层 UV，非满幅层 ⇒ 只判"真的变了且朝向正确"）
      try {
        const scene = lib.parseScene(sj, JSON.parse(txt('project.json')), {})
        for (const l of scene.layers) {
          for (const ef of (l.effects || [])) lib.resolveEffectChain(pkg, ef, rdT, {})
          l.textureName = l.textureName || 'tex_a'
          l.solid = false
        }
        const OW = g.orthogonalprojection.width, OH = g.orthogonalprojection.height
        const run = await mkRun(lib, scene, {})
        try {
          await run.frame(); await run.frame()
          const before = run.uniform('g_ParallaxPosition')
          globalThis.__mpwPointer = { x: 0.92 * OW, y: 0.08 * OH, inside: true }
          await run.frame(); await run.frame()
          const after = run.uniform('g_ParallaxPosition')
          const changed = !!before && !!after && (Math.abs(after[0] - before[0]) > 0.05 || Math.abs(after[1] - before[1]) > 0.05)
          C('RP-PARALLAX-FOLLOWS-INJECT', eq(before, [0.5, 0.5], 1e-6) && changed && after[0] > 0.5 && after[1] < 0.5,
            'g_ParallaxPosition ' + V(before) + ' → ' + V(after) + '（注入 0.92/0.08 方向；改前恒 [0.5,0.5]）')
        } finally { run.restore() }
      } catch (e) {
        C('RP-PARALLAX-FOLLOWS-INJECT', false, '真实场景跑不动：' + String((e && e.message) || e).slice(0, 160))
      }
    }
    if (!xrayMpkg) skip('RP-XRAY-FRAG-DIVIDES', '语料缺席：…(x-ray).mpkg')
    else {
      const { txt } = readPkgScene(xrayMpkg)
      const frag = txt('shaders/effects/xray.frag') || ''
      const pj = JSON.parse(txt('project.json') || '{}')
      const xrayProp = (((pj.general || {}).properties || {}).xray) || {}
      C('RP-XRAY-FRAG-DIVIDES', /g_PointerState\.y/.test(frag) && /1\.0\s*\/\s*max\(/.test(frag),
        '包内 xray.frag 含 `1.0/max(…, g_PointerState.y)`；用户属性 xray 默认=' + V(xrayProp.value))
    }
    // 官方桌面资产对照（决策性证据：官方那版**没有**这个因子）
    const offFrag = path.join(MPW_WS, 'wallpaper_engine', 'assets', 'effects', 'xray', 'shaders', 'effects', 'xray.frag')
    if (!fs.existsSync(offFrag)) skip('RP-OFFICIAL-XRAY-NO-FACTOR', '缺 WE 资产：' +
      path.join('wallpaper_engine', 'assets', 'effects', 'xray', 'shaders', 'effects', 'xray.frag'))
    else {
      const src = fs.readFileSync(offFrag, 'utf8')
      C('RP-OFFICIAL-XRAY-NO-FACTOR', !/g_PointerState/.test(src) && /v_PointerUV\.w\);/.test(src),
        '官方桌面 xray.frag 声明/使用 g_PointerState = ' + /g_PointerState/.test(src) + ' ⇒ 因子等价于 1.0')
    }
  }

  return { checks, show }
}
// ═════════════════════════ 主跑 ═════════════════════════
const libUrl = pathToFileURL(CORE_FILE).href
const lib = await import(libUrl + '?t=' + Date.now())
const srcShaBefore = sha256(fs.readFileSync(CORE_FILE))

console.log('== §A/§B/§C 主跑（真树 core/we-scene-bundle.js）==')
const base = await runSuite(lib)
const ids = Object.keys(base.checks).sort()
for (const id of ids) {
  if (base.checks[id]) { passN++; console.log('  ✓ ' + id + (base.show[id] ? '  [' + base.show[id] + ']' : '')) }
  else { failN++; fails.push(id); console.log('  ✗ ' + id + (base.show[id] ? '  [' + base.show[id] + ']' : '')) }
}
ok('§0 判据自检：本次真的跑了 ≥12 条断言（不是"全 SKIP 就算绿"）', ids.length >= 12, 'ids=' + ids.length + ' → ' + ids.join(','))

// ═════════════════════════ §D 变异自证（期望红集 == 实际红集）════════════════════════
const MUTANTS = [
  {
    label: 'M1(视差链不再要"真的有指针"：`__fxPtr.has` 恒假 ⇒ 注入通道又喂不进来)',
    from: 'if (!__parPtrLegacy && parEnabled && __fxPtr.has) { parallaxState.x = __fxPtr.u',
    to: 'if (!__parPtrLegacy && parEnabled && false) { parallaxState.x = __fxPtr.u',
    expectRed: ['PAR-INJECT-OFFICIAL', 'PAR-INJECT-Y', 'PXPOS-INJECT'],
    why: 'DOM 通道不受影响（PAR-DOM-OFFICIAL / PAR-LEGACY-DOM-STILL-WORKS 不红）；legacy 档本来就是 0，也不红。',
  },
  {
    label: 'M2(视差链指针源档缺省翻成 legacy：`__parPtrLegacy` 恒真)',
    from: 'const __parPtrLegacy = (opts.parallaxPtrLegacy !== undefined) ? !!opts.parallaxPtrLegacy : PTR_WIRING_LEGACY',
    to: 'const __parPtrLegacy = true',
    expectRed: ['PAR-INJECT-OFFICIAL', 'PAR-INJECT-Y', 'PXPOS-INJECT'],
    why: '与 M1 同一组（缺省档整条不执行）；DOM / legacy / 无 cameraparallax 三档不受影响。',
  },
  {
    label: 'M3(xray 族 `.y` 回旧值 = 指针层 UV v)',
    from: "const __xrayStY = (!__xrayStateLegacy && !!uni.get('g_PointerScale')) ? 1 : pu[1]",
    to: 'const __xrayStY = pu[1]',
    expectRed: ['XRAY-STATE-Y-ONE', 'XRAY-WINDOW-AREA'],
    why: '.x/.z 不动（XRAY-STATE-Z-KEPT 不红）；legacy 档本来就是 v（XRAY-STATE-LEGACY-V / …-TINY 不红）；'
      + '非 xray 族本来就该是 v（XRAY-OTHER-PROG-KEEPS-V 不红）。',
  },
  {
    label: 'M4(去掉"只对 xray 族生效"的门：所有程序 `.y` 都填 1)',
    from: "const __xrayStY = (!__xrayStateLegacy && !!uni.get('g_PointerScale')) ? 1 : pu[1]",
    to: 'const __xrayStY = (!__xrayStateLegacy) ? 1 : pu[1]',
    expectRed: ['XRAY-OTHER-PROG-KEEPS-V'],
    why: 'xray 族本身照旧是 1 ⇒ XRAY-STATE-Y-ONE / XRAY-WINDOW-AREA 不红；'
      + '这一组专门钉"不许把 .y 的改动外溢到 cursorripple 那类程序"。',
  },
  {
    label: 'M5(xray 族档缺省翻成 legacy：`__xrayStateLegacy` 恒真)',
    from: 'const __xrayStateLegacy = (opts.xrayStateLegacy !== undefined) ? !!opts.xrayStateLegacy : PTR_WIRING_LEGACY',
    to: 'const __xrayStateLegacy = true',
    expectRed: ['XRAY-STATE-Y-ONE', 'XRAY-WINDOW-AREA'],
    why: 'legacy 档自己那条（.y=v）在缺省档下也成立 ⇒ XRAY-STATE-LEGACY-V 本来就是要 v，不红。',
  },
]
let mutRedOk = 0
for (const mu of MUTANTS) {
  const body0 = fs.readFileSync(CORE_FILE, 'utf8')
  const n = body0.split(mu.from).length - 1
  if (n !== 1) { failN++; fails.push(mu.label + '（变异锚点命中 ' + n + ' 处，应为 1）'); console.log('  ✗ ' + mu.label + ' ⇒ 锚点命中 ' + n + ' 处，应在真源码里唯一'); continue }
  const body = body0.replace(mu.from, mu.to)
  const tmp = path.join(os.tmpdir(), 'pxw-mut-' + crypto.randomBytes(6).toString('hex') + '.mjs')
  // ① 副本搬到 /tmp 后相对 import（`./we-animation.mjs` / `./puppet-skin.js` …）会断 ⇒ 逐处改写成
  //    仓库内的绝对路径（与 tests/official-parallax-formula-test.mjs 的变异段同一手法）。
  fs.writeFileSync(tmp, body.replace(/from '\.\//g, "from '" + path.join(ROOT, 'core') + '/'))
  let res = null, err = null
  try {
    const mm = await import(pathToFileURL(tmp).href + '?v=' + Date.now() + Math.random())
    res = await runSuite(mm, { skipCorpus: true })
  } catch (e) { err = String((e && e.message) || e).slice(0, 200) }
  finally { fs.rmSync(tmp, { force: true }) }
  if (err) { failN++; fails.push(mu.label); console.log('  ✗ ' + mu.label + ' 变异副本抛错（不是干净的"红"）：' + err); continue }
  const actual = Object.keys(base.checks).filter((id) => base.checks[id] === true && res.checks[id] === false).sort()
  const want = mu.expectRed.slice().sort()
  const isEq = V(actual) === V(want)
  console.log('  ' + (isEq ? 'MUTANT-RED-OK' : 'MUTANT-RED-MISMATCH') + '｜' + mu.label)
  console.log('      期望红集=' + V(want))
  console.log('      实际红集=' + V(actual))
  console.log('      预期理由：' + mu.why)
  if (isEq) { mutRedOk++; passN++; console.log('  ✓ ' + mu.label + ' ⇒ 期望红集 == 实际红集') }
  else { failN++; fails.push(mu.label); console.log('  ✗ ' + mu.label + ' ⇒ 红集不一致') }
}
ok('§D 变异自证 ≥4 组且全部 MUTANT-RED-OK（' + mutRedOk + '/' + MUTANTS.length + '）',
  mutRedOk >= 4 && mutRedOk === MUTANTS.length)

// ── §E 真树未被改动 ──
const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^pxw-mut-.*\.mjs$/.test(f))
const srcShaAfter = sha256(fs.readFileSync(CORE_FILE))
ok('§E 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同，且 /tmp 无残留副本',
  srcShaBefore === srcShaAfter && leftovers.length === 0, 'sha=' + srcShaBefore.slice(0, 12) + ' leftovers=' + leftovers.length)

console.log('\n===== parallax-xray: ' + passN + ' 通过 / ' + failN + ' 失败 / ' + skipN + ' SKIP =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

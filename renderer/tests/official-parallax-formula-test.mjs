// official-parallax-formula-test.mjs —— ①(RE-24 官方鼠标视差**静态逆向对齐** 2026-09-24) 实证门禁
//
// 逆向依据（**本档不重做取证**，只按字节/指令复算；全文与逐条 file:offset 见）：
//   · `docs/OFFICIAL-PARALLAX-RE-20260924.md`（工作区 `docs/`；§A.2/§A.3/§B-4 与"对照表"）
//   · 转储 `docs/_official-extract/parallax/`：`A3`(arm64 Scene::Update) `A4`(arm64 Scene::Draw)
//     `A18`(官方资产/shader/defaults) `A20`(官方工程 parallaxDepth 分布)
//     `desktop/C1_disasm_parallax_update_wallpaper64.txt`(桌面平滑闭式)
//     `desktop/C2_disasm_perlayer_weight_wallpaper64.txt`(桌面每层权重)
//
// ── 本档要钉住的**官方算式**（每条都能指到指令；断言里写的是官方式子，不是本仓实现）──────────
//   (o1) 归一化位置：`S = 0.5 − p · min(influence, 1)`
//        A3 `0x2556140 fadd s0,s2,s2`(2·influence) → `0x2556154 fminnm s0,s0,s1`(s1=2.0)
//        → `0x2556164/0x2556168 fmul`(乘到 p) → `0x2556174 fadd`(+0.5) → `0x2556248 str [x19,#704]`。
//        `p` 是**中心相对**输入（鼠标居中 ⇒ p=0 ⇒ S=0.5=中性；官方 shader 再 `S*2-1` 才成 −1..1）。
//   (o2) 每层位移：`offset = (rootPos − S) ∘ depth × amount`
//        A4 `0x2557c28 ldr d2,[x22,#248]`(顶层祖先位置) → `0x2557c2c fsub`(−S)
//        → `0x2557c34 fmul`(×amount) → `0x2557c38 fmul`(∘depth)；`x22` 是 `GetParent()` 循环的根。
//        x86-64 独立复现：C2 `14014c9a7/9b9/cb/d5`。**乘法**（对这两个槽的 `addss` 全量扫描 0 命中）。
//   (o3) `depth` 取**顶层祖先**的 `parallaxDepth`（A4 读 `[x22,#320]`；旁证 A20：官方 37 个工程里
//        40/40 处 parallaxDepth 都在顶层 `depth=0`）。
//   (o4) 平滑：`k = min(1, (1 − delay/3) · 10 · dt)`；`delay <= dt` ⇒ **吸附**；**只封顶不夹下界**。
//        C1 `0x14014b6c2/6ce/6f8/6fa/705/709/711/716/71b/758`。官方默认 delay=0.1 ⇒ 60fps 时 k≈0.161111。
//   (o5) 场景级 `cameraparallax === false` ⇒ **冻结**（保持上次视差位置，不归零）：C1 `0x14014b626 je`。
//
// ── 本仓映射（**自己复算过**；与逆向报告的一版读法有出入，见下）──────────────────────────────
//   本仓 `parallaxState` 是 [0,1] 原始指针（中心 0.5）⇒ `(0.5 − parallaxState) = −p`；
//   本仓 `parDisp` ≡ `(S − 0.5) × 画布`（**中心相对位移**）⇒ 每层 `(ox − camCx) + parDisp`
//   ≡ 官方 `(rootPos − S)×画布`（`camCx = 0.5·画布` 与 `parDisp` 里的 `0.5·画布` **对消**）。
//   ⚠ 所以缺省档里那两项**不是**"鼠标重复计入"（逆向报告 §对照表 #9 的读法）：删 `(ox−camCx)` 会丢官方
//     `root` 参考点、删 `parDisp` 会丢鼠标项 —— 本档 §C 的 `OFF-TWO-TERMS-KEPT` + 变异 M6 把这条钉死，
//     并给出"只改鼠标 ⇒ 位移变化率"的读数（`OFF-MOUSE-ONCE`）。
//
// ── 读数口径（诚实边界）──────────────────────────────────────────────────────────────────
//   mock-GL 的 `onLayerDraw` 给的是 WebGL 的 **float32** MVP ⇒ 层中心 ~1920px 的量化误差（~1.2e-4px）
//   会在大数相减里放大成小位移的相对误差 ⇒ **不能用 float64 精确相等**。本档统一在 **NDC** 空间判：
//   实测误差 ≤ 5e-8 = **1 ulp float32**，判据取 `NDC_TOL = 1e-6`（≈8 ulp，且比最小的判别差
//   0.0175 NDC ≈ 33.6px 小 4 个数量级）。**逐位**级的比较用在 §D：改前/改后构建过的是同一条
//   float32 通路，那里做的是真正的 bit-exact 相等。
//
// 用法：`node tests/official-parallax-formula-test.mjs`（纯 Node + mock-GL，**不需要浏览器**）
// 退出码：0 全绿 / 1 有断言失败。
//
// ── ①(官方默认值对齐 2026-09-24) 本档新增 §F/§G（**上一轮只对齐了公式，没对齐默认值**）──────────
//   官方默认（缺属性兜底）：`cameraparallaxamount = 0.5`(44/44)、`cameraparallaxdelay = 0.1`(44/44)、
//   `cameraparallaxmouseinfluence = 0.0`(43/44，另 1 个 1.0) —— 出处 = 44 个官方
//   `wallpaper_engine/assets/effects/*/preview/scene.json`（例 `effects/blend/preview/scene.json`
//   字节偏移 307/340/388）；统计见 `docs/_official-extract/parallax/A18_...txt:35-41` 与
//   `reports/parallax-defaults-20260924.md` §1。本仓旧默认 = amount 0 / delay 1 / influence 1。
//   §F = 缺属性必须用官方默认（含"非零位移"与手算常数）；§G = `?parallax=legacy` 缺属性逐位回旧默认
//   （与 `git show HEAD:` 的改前构建对拍）。变异新增 M7（默认值改回旧的）/ M8（显式 0 当缺省）/
//   M9（legacy 档也换新默认）/ M10（只把 amount 默认改回 0）。
import fs from 'node:fs'

/* “改前”基线：0.5.6（6b90af1）之前的那次提交 —— 视差默认值还是旧的 amount=0/delay=1/influence=1。 */
const PRE_DEFAULTS_REV = '912c8d1'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

let passN = 0, failN = 0, skipN = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const skip = (name, detail) => { skipN++; console.log('  SKIP ' + name + (detail ? '  [' + detail + ']' : '')) }
const V = (o) => JSON.stringify(o)
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// ═════════════════════════ mock-GL（与 tests/parallax-live-test.mjs B 段同款最小实现）═══════════
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
  const rec = { draws: [], uniWrites: [] }
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
    drawArrays: (m, f, c) => rec.draws.push({ prog: curProg && curProg.id, count: c }), drawElements: () => {},
    getProgramParameter: (p, k) => {
      if (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) return true
      if (k === CONST.ACTIVE_ATTRIBUTES) return 2
      if (k === CONST.ACTIVE_UNIFORMS) { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p).length }
      return null
    },
    getActiveUniform: (p, i) => { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p)[i] || null },
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_Alpha' ? 2 : -1),
    getUniformLocation: (p, n) => ({ p, n: String(n).replace(/\[0\]$/, '') }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1fv: (l, a) => rec.uniWrites.push({ name: l && l.n, v: Array.from(a) }),
    uniform1f: (l, a) => rec.uniWrites.push({ name: l && l.n, v: a }),
    uniform1i: (l, a) => rec.uniWrites.push({ name: l && l.n, v: a }),
    uniform2f: (l, a, b) => rec.uniWrites.push({ name: l && l.n, v: [a, b] }),
    uniform3f: (l, a, b, c) => rec.uniWrites.push({ name: l && l.n, v: [a, b, c] }),
    uniform4f: (l, a, b, c, d) => rec.uniWrites.push({ name: l && l.n, v: [a, b, c, d] }),
    uniformMatrix4fv: (l, t, m) => rec.uniWrites.push({ name: l && l.n, v: Array.from(m || []) }),
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
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const resolverFor = async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG)

// ═════════════════════════ 官方算式（写在这里，**不抄实现**）════════════════════════════════
const PROJ_W = 3840, PROJ_H = 2160
const CAM_CX = PROJ_W / 2, CAM_CY = PROJ_H / 2
const WINDOW_W = 1000, WINDOW_H = 500          // mock `window.innerWidth/Height`（指针归一化的分母）
const NDC_TOL = 1e-6                           // 见文件头"读数口径"
/** "层中心相对画布中心的设计像素" → 该层中心的 NDC（即 mock-GL 的 `mvp[12]`）。 */
const ndcOf = (relDesignX) => (relDesignX + CAM_CX) / PROJ_W * 2 - 1
const pxOf = (ndc) => ndc * PROJ_W / 2
const nearNdc = (gotNdc, wantRelDesignX) => Math.abs(gotNdc - ndcOf(wantRelDesignX)) <= NDC_TOL
/** 官方 (o1)：`S = 0.5 − p·min(influence,1)`；`cursor` 是 [0,1] 原始指针 ⇒ `p = cursor − 0.5`。 */
const officialS = (cursor, influence) => 0.5 - (cursor - 0.5) * Math.min(influence, 1)
/**
 * 官方 (o2)：`offset = (rootPos − S) ∘ depth × amount`（设计像素）。
 * 两套构建都对 x 做 `1 − x` 镜像（A3 `0x2556180/0x2556184 fcsel`；桌面 C1 `0x14014b7da subss`），
 * 本仓的 `(0.5 − ·)` 口径正是**镜像后**的那一支 ⇒ 期望值用 `Sm = 1 − S`。
 * ⚠ 官方**只翻 x**；本仓对 y 用同一式（镜像也落到 y 上）——**已知残余差异**，故本档只判 x。
 */
const officialOffsetX = (oxRoot, S, depth, amount) => ((oxRoot / PROJ_W) - (1 - S)) * PROJ_W * depth * amount
/** mock-GL 读到的"层中心设计像素 x" = `(ox + parOffX) − camCx` ⇒ 期望读数 = 层位 + 官方位移。 */
const officialReadingX = (oxRoot, S, depth, amount) => (oxRoot - CAM_CX) + officialOffsetX(oxRoot, S, depth, amount)

// ═════════════════════════ 夹具与探针 ═════════════════════════════════════════════════════
const TEX = new Map([['tex_a', { glTex: { id: 't_a' }, width: 64, height: 64 }]])
/** 一层（默认满幅居中；`origin` 是设计像素的层中心，内部补 z=0 —— 渲染器会读 `origin[2]`）。 */
const L = (id, name, depth, origin, extra) => Object.assign({
  id, name, visible: true, size: [PROJ_W, PROJ_H], scale: [1, 1, 1],
  origin: origin ? [origin[0], origin[1], 0] : [CAM_CX, CAM_CY, 0],
  angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
  parallaxDepth: depth, textureName: 'tex_a', effects: [] }, extra || {})
const mkScene = (layers, general) => ({
  general: Object.assign({ orthogonalprojection: { width: PROJ_W, height: PROJ_H } }, general || {}),
  camera: null, properties: {}, layers,
})
/** 建一个渲染器会话（指针监听 + 逐层 NDC 台账）。 */
async function mkRun(lib, scene, rendererOpts) {
  const handlers = []
  const savedWin = globalThis.window
  globalThis.window = { innerWidth: WINDOW_W, innerHeight: WINDOW_H,
    addEventListener: (t, f) => handlers.push({ t, f }), removeEventListener: () => {} }
  const { gl } = mkGL()
  const last = {}
  const r = lib.createRenderer({ getContext: () => gl, width: 1280, height: 720 },
    Object.assign({ shaderResolver: resolverFor, onLog: () => {},
      // `mvp` 是行向量约定：m[12]/m[13] = 层中心 **NDC**（本档在 NDC 空间判，见文件头"读数口径"）
      onLayerDraw: (layer, info) => { last[String(layer.name)] = [info.mvp[12], info.mvp[13]] } }, rendererOpts || {}))
  let t = 0
  return {
    async frame(dt) { t += (dt === undefined ? 1 / 60 : dt); await r.render(scene, TEX, 1280, 720, t) },
    move(x, y) {
      const mm = handlers.find((h) => h.t === 'mousemove')
      if (!mm) throw new Error('mousemove 监听没挂上（attachParallaxListener 未生效）')
      mm.f({ clientX: x * WINDOW_W, clientY: y * WINDOW_H })
    },
    read() { const o = {}; for (const k of Object.keys(last)) o[k] = [last[k][0], last[k][1]]; return o },
    hasListener: () => !!handlers.find((h) => h.t === 'mousemove'),
    restore() { if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin },
  }
}
/**
 * 标准读数：帧 1 指针在中心（⇒ `tx = 0` ⇒ `parDisp = 0`）→ 派发 mousemove → 再跑 `frames` 帧。
 * `delay = 0` 时 `delay <= dt` ⇒ 官方**吸附** ⇒ 恰好 1 帧后 `parDisp === tx`（**无收敛残差**）。
 * @returns `{ readings: { 层名: [ndcX, ndcY] }, hasListener }`
 */
async function probe(lib, scene, cursor, o) {
  const opt = o || {}
  const run = await mkRun(lib, scene, opt.rendererOpts)
  try {
    await run.frame(opt.dt)
    run.move(cursor[0], cursor[1])
    const n = opt.frames === undefined ? 1 : opt.frames
    for (let i = 0; i < n; i++) await run.frame(opt.dt)
    return { readings: run.read(), hasListener: run.hasListener() }
  } finally { run.restore() }
}

// ═════════════════════════ 断言集（可真/假，供变异对比）═══════════════════════════════════
/**
 * 跑完整套判据，返回 `{ checks, show }`：`checks[id] = true/false/'skip'`，`show[id]` = 原样读数串。
 * 变异自证的做法就是拿同一个函数跑变异副本，比较"基档通过 → 变异后为假"的红集。
 */
async function runSuite(lib) {
  const checks = {}, show = {}
  const C = (id, cond, detail) => { checks[id] = !!cond; show[id] = detail }
  const D007 = [0.07, 0.07], D14 = [1.4, 1.4]

  // ── §A 官方默认值夹具（`cameraparallaxmouseinfluence = 0.0`，A18 43/44）+ §B 逐位比较 ──
  {
    const sc = mkScene([L(1, 'def', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxdelay: 0.1, cameraparallaxmouseinfluence: 0.0 })
    const r = await probe(lib, sc, [0.95, 0.5], { frames: 30 })
    C('OFF-DEFAULTS-INFL0', nearNdc(r.readings.def[0], 0),
      'influence=0（官方默认）⇒ 鼠标右移到底读数 x=' + pxOf(r.readings.def[0]).toFixed(6) + 'px（期望 0）')

    // B1 乘法（官方）vs 加法（旧 lwe）：depth 0.07、amount 0.5、influence 1、cursor 0.9
    const sc1 = mkScene([L(2, 'b1', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 1, cameraparallaxdelay: 0 })
    const r1 = await probe(lib, sc1, [0.9, 0.5])
    const S1 = officialS(0.9, 1)
    const want1 = officialReadingX(CAM_CX, S1, 0.07, 0.5)              // 官方（乘）：−53.76
    const tx1 = (0.5 - 0.9) * PROJ_W * Math.min(1, 1)
    const sum1 = (0.07 + 0.5) * tx1                                    // 旧加法式：−875.52
    C('OFF-PRODUCT-NOT-SUM', nearNdc(r1.readings.b1[0], want1) && !nearNdc(r1.readings.b1[0], sum1),
      'x=' + pxOf(r1.readings.b1[0]).toFixed(6) + 'px 官方(乘)=' + want1 + ' 旧(加)=' + sum1)

    // B2 `0.5` 的位置：influence 0.5、cursor 0.7（p=0.2）⇒ 官方 S=0.4（不是 (0.5−p)·infl=0.15）
    const sc2 = mkScene([L(3, 'b2', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 0.5, cameraparallaxdelay: 0 })
    const r2 = await probe(lib, sc2, [0.7, 0.5])
    const want2 = officialReadingX(CAM_CX, officialS(0.7, 0.5), 0.07, 0.5)          // S=0.4 ⇒ −13.44
    const wrong2 = officialReadingX(CAM_CX, (0.5 - (0.7 - 0.5)) * 0.5, 0.07, 0.5)   // S=0.15 ⇒ −47.04
    C('OFF-HALF-NOT-SCALED', nearNdc(r2.readings.b2[0], want2) && !nearNdc(r2.readings.b2[0], wrong2),
      'x=' + pxOf(r2.readings.b2[0]).toFixed(6) + 'px 官方(0.5−p·0.5→S=0.4)=' + want2 +
      ' 旧((0.5−p)·0.5→S=0.15)=' + wrong2)

    // B3 influence 截断：influence=2 必须与 influence=1 **同值**（官方 min(·,1)）
    const sc3 = mkScene([L(4, 'b3', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 2, cameraparallaxdelay: 0 })
    const r3 = await probe(lib, sc3, [0.9, 0.5])
    const want3 = officialReadingX(CAM_CX, officialS(0.9, 2), 0.07, 0.5)            // min(2,1)=1 ⇒ −53.76
    const unclamped3 = officialReadingX(CAM_CX, 0.5 - (0.9 - 0.5) * 2, 0.07, 0.5)   // 未截断 ⇒ −107.52
    C('OFF-INFLUENCE-CLAMP', nearNdc(r3.readings.b3[0], want3) && !nearNdc(r3.readings.b3[0], unclamped3)
      && nearNdc(r3.readings.b3[0], want1),
      'x=' + pxOf(r3.readings.b3[0]).toFixed(6) + 'px 官方(min(2,1)=1)=' + want3 + ' 未截断=' + unclamped3)

    // B4 平滑闭式：delay 0.1、dt 1/60、**改鼠标后 1 帧** ⇒ parDisp = tx·k，k 按官方闭式手算
    const K_DT = 1 / 60, DELAY = 0.1
    const kOffic = Math.min(1, (1 - DELAY / 3) * 10 * K_DT)
    const kOld = 1 - Math.exp(-(K_DT * Math.log(100)) / DELAY)
    const tx4 = (0.5 - 0.7) * PROJ_W * Math.min(1, 1)                 // −768
    const sc4 = mkScene([L(5, 'b4', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 1, cameraparallaxdelay: DELAY })
    const r4 = await probe(lib, sc4, [0.7, 0.5], { dt: K_DT, frames: 1 })
    const want4 = tx4 * kOffic * 0.07 * 0.5, old4 = tx4 * kOld * 0.07 * 0.5
    C('OFF-K-CLOSED-FORM', nearNdc(r4.readings.b4[0], want4) && !nearNdc(r4.readings.b4[0], old4),
      'x=' + pxOf(r4.readings.b4[0]).toFixed(6) + 'px 官方 k=' + kOffic + ' ⇒ ' + want4 +
      '；旧指数式 k=' + kOld + ' ⇒ ' + old4)

    // B5 `delay <= dt` ⇒ 吸附（k=1）：delay=0 边界夹具 ⇒ 与 B1 同值（精确值）
    C('OFF-K-SNAP-DELAY0', nearNdc(r1.readings.b1[0], tx1 * 0.07 * 0.5),
      'delay=0 ⇒ k=1 ⇒ x=' + pxOf(r1.readings.b1[0]).toFixed(6) + 'px（= tx·depth·amount 精确值）')

    // B6 k **只封顶不夹下界**：delay=1、dt=0.2 ⇒ 未封顶 k=1.3333，封顶后 k=1
    const sc6 = mkScene([L(6, 'b6', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 1, cameraparallaxdelay: 1 })
    const r6 = await probe(lib, sc6, [0.7, 0.5], { dt: 0.2 })
    const kRaw6 = (1 - 1 / 3) * 10 * 0.2
    const want6 = tx4 * Math.min(1, kRaw6) * 0.07 * 0.5, uncapped6 = tx4 * kRaw6 * 0.07 * 0.5
    C('OFF-K-CAP-ONLY', nearNdc(r6.readings.b6[0], want6) && !nearNdc(r6.readings.b6[0], uncapped6),
      'x=' + pxOf(r6.readings.b6[0]).toFixed(6) + 'px 封顶后 k=1 ⇒ ' + want6 + '；未封顶 k=' + kRaw6 + ' ⇒ ' + uncapped6)

    // B7 下界**不夹**：delay=6、dt=1/60 ⇒ 官方 k = (1−2)·10/60 = −1/6（反向外插）；旧式夹成 0（冻结）
    const sc7 = mkScene([L(7, 'b7', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 1, cameraparallaxdelay: 6 })
    const r7 = await probe(lib, sc7, [0.7, 0.5])
    const kNeg7 = (1 - 6 / 3) * 10 * (1 / 60)
    const want7 = tx4 * kNeg7 * 0.07 * 0.5
    C('OFF-K-NO-LOWER-CLAMP', nearNdc(r7.readings.b7[0], want7) && !nearNdc(r7.readings.b7[0], 0),
      'x=' + pxOf(r7.readings.b7[0]).toFixed(6) + 'px 官方 k=' + kNeg7 + ' ⇒ ' + want7 + '（旧式夹成 0 ⇒ 0）')
  }

  // ── §C 官方反例钉死 ──
  {
    // C3 子层 depth ≠ 顶层 depth ⇒ 取**顶层**（A4 `[x22,#320]`；A20 旁证）
    const sc = mkScene([
      L(10, 'root', D14),
      L(11, 'child', D007, [CAM_CX, CAM_CY], { parent: 10 }),
    ], { cameraparallax: true, cameraparallaxamount: 0.5, cameraparallaxmouseinfluence: 1, cameraparallaxdelay: 0 })
    const r = await probe(lib, sc, [0.9, 0.5])
    const byRoot = officialReadingX(CAM_CX, officialS(0.9, 1), 1.4, 0.5)
    const byOwn = officialReadingX(CAM_CX, officialS(0.9, 1), 0.07, 0.5)
    C('OFF-ROOT-ANCESTOR-DEPTH',
      nearNdc(r.readings.child[0], byRoot) && !nearNdc(r.readings.child[0], byOwn)
      && Math.abs(r.readings.child[0] - r.readings.root[0]) <= NDC_TOL,
      'child x=' + pxOf(r.readings.child[0]).toFixed(6) + 'px root x=' + pxOf(r.readings.root[0]).toFixed(6) +
      'px 顶层 depth 1.4 ⇒ ' + byRoot + '；本层 depth 0.07 ⇒ ' + byOwn + '（子层完全继承顶层）')

    // C4 鼠标**只进一次**：两层同 depth、只 `origin` 不同 ⇒ `Δ读数` 完全相同，且等于官方系数**一份**
    const sc4 = mkScene([
      L(20, 'm1', D007, [CAM_CX, CAM_CY]),
      L(21, 'm2', D007, [CAM_CX + 600, CAM_CY]),
    ], { cameraparallax: true, cameraparallaxamount: 0.5, cameraparallaxmouseinfluence: 1, cameraparallaxdelay: 0 })
    const rc = await probe(lib, sc4, [0.5, 0.5])
    const rm = await probe(lib, sc4, [0.9, 0.5])
    const d1 = pxOf(rm.readings.m1[0] - rc.readings.m1[0]), d2 = pxOf(rm.readings.m2[0] - rc.readings.m2[0])
    const coef = officialOffsetX(CAM_CX, officialS(0.9, 1), 0.07, 0.5) - officialOffsetX(CAM_CX, officialS(0.5, 1), 0.07, 0.5)
    C('OFF-MOUSE-ONCE', Math.abs(d1 - coef) <= 1e-3 && Math.abs(d2 - coef) <= 1e-3 && Math.abs(2 * coef - coef) > 1e-3,
      '只改鼠标（0.5→0.9）⇒ Δm1=' + d1.toFixed(6) + 'px Δm2=' + d2.toFixed(6) +
      'px 官方一份=' + coef + '（重复计入会是 ' + (2 * coef) + '）')

    // C4b 两项都在（**不能**只保留 `Scene[704..708]` 那一项）：离层心的 `root` 参考点项也进位移
    const S9 = officialS(0.9, 1)
    const wantM2 = officialReadingX(CAM_CX + 600, S9, 0.07, 0.5)         // 600 + (−32.76) = 567.24
    const onlyMouse = (CAM_CX + 600 - CAM_CX) + ((0.5 - 0.9) * PROJ_W * Math.min(1, 1)) * 0.07 * 0.5  // 546.24
    C('OFF-TWO-TERMS-KEPT',
      nearNdc(rm.readings.m2[0], wantM2) && !nearNdc(rm.readings.m2[0], onlyMouse) && Math.abs(wantM2 - onlyMouse) > 1,
      'm2@鼠标0.9 x=' + pxOf(rm.readings.m2[0]).toFixed(6) + 'px 官方两项=' + wantM2 +
      '；只留鼠标项会得到=' + onlyMouse + '（差 ' + (wantM2 - onlyMouse).toFixed(3) + 'px）')
  }

  // ── §D `?parallax=legacy` **逐位**回归（与改前构建对拍；这里是真 bit-exact）──────────────
  const LEGACY_FIXTURES = [
    { tag: 'L1', depth: D007, amount: 0.5, influence: 1, delay: 0.1, cursor: [0.9, 0.5], dt: 1 / 60, frames: 3 },
    { tag: 'L2', depth: [3.8, 4.2], amount: 0.5, influence: 0.07, delay: 0.1, cursor: [0.9, 0.25], dt: 1 / 60, frames: 40 },
    { tag: 'L3', depth: [0.25, 0.25], amount: 1.75, influence: 2, delay: 0.5, cursor: [0.3, 0.5], dt: 1 / 30, frames: 5 },
  ]
  const mkFixtureScene = (f) => mkScene([L(1, 'leg', f.depth)],
    { cameraparallax: true, cameraparallaxamount: f.amount, cameraparallaxmouseinfluence: f.influence, cameraparallaxdelay: f.delay })
  const runFixture = async (l, f, legacy) => (await probe(l, mkFixtureScene(f), f.cursor,
    { dt: f.dt, frames: f.frames, rendererOpts: legacy ? { parallaxLegacy: true } : undefined })).readings.leg
  /**
   * ①(2026-09-24) **缺属性**的 legacy 夹具：`?parallax=legacy` 必须逐位回**旧默认**
   * （amount 0 / delay 1 / influence 1），不是官方默认。
   *  · LM1 三个全缺（旧默认 amount=0 ⇒ 位移 0；新默认若漏进 legacy 也不会变，见报告 §判据）
   *  · LM2 只写 amount=0.5（旧默认 delay=1 / influence=1 ⇒ **非零**鼠标位移；最能区分新旧默认）
   *  · LM3 只缺 delay（旧默认 delay=1 ⇒ k=0.1111…；旧式指数平滑）
   *  层居中 ⇒ 读数就是纯位移（`(ox−camCx)=0`）。
   */
  const LEGACY_MISSING_FIXTURES = [
    { tag: 'LM1', depth: D007, general: { cameraparallax: true }, cursor: [0.9, 0.5], dt: 1 / 60, frames: 3 },
    { tag: 'LM2', depth: D007, general: { cameraparallax: true, cameraparallaxamount: 0.5 }, cursor: [0.9, 0.5], dt: 1 / 60, frames: 5 },
    { tag: 'LM3', depth: D007, general: { cameraparallax: true, cameraparallaxamount: 0.5, cameraparallaxmouseinfluence: 1 }, cursor: [0.7, 0.5], dt: 1 / 60, frames: 1 },
  ]
  const runMissingFixture = async (l, f, legacy) => (await probe(l, mkScene([L(1, 'leg', f.depth)], f.general), f.cursor,
    { dt: f.dt, frames: f.frames, rendererOpts: legacy ? { parallaxLegacy: true } : undefined })).readings.leg
  const OLD_SRC = (() => {
    /* ①(2026-09-24 口径修正，与 portability-fix 同一条教训) "改前"必须**钉死提交号**，不能用 `HEAD`：
       本轮改动一旦提交（0.5.6 = 6b90af1），`HEAD` 就**变成改后** ⇒ 反假绿判据 `…-DIFFERS-FROM-PREV` 必然假红。
       `912c8d1` = 0.5.6 之前那一次提交（视差默认值仍是旧的 0/1/1）。**不要**顺手把它更新成新提交。 */
    try { return execFileSync('git', ['show', PRE_DEFAULTS_REV + ':core/we-scene-bundle.js'], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 }).toString('utf8') }
    catch (e) { return null }
  })()
  let oldLib = null, tmpOld = null
  if (OLD_SRC && OLD_SRC.length > 1000) {
    try {
      tmpOld = path.join(os.tmpdir(), 'offpar-prev-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mjs')
      fs.writeFileSync(tmpOld, OLD_SRC.replace(/from '\.\//g, "from '" + path.join(ROOT, 'core') + '/'))
      oldLib = await import(pathToFileURL(tmpOld).href + '?v=' + Date.now())
    } catch (e) { oldLib = null; console.log('  （改前构建 import 失败：' + String(e && e.message).slice(0, 120) + '）') }
    finally { if (tmpOld) fs.rmSync(tmpOld, { force: true }); tmpOld = null }
  }
  if (!oldLib) {
    for (const id of ['LEGACY-BITEXACT-VS-PREV', 'LEGACY-KEEPS-OLD-INFLUENCE', 'DEFAULT-EXPLICIT-BITEXACT-VS-PREV',
      'DEF-MISSING-DIFFERS-FROM-PREV', 'DEF-LEGACY-MISSING-BITEXACT', 'DEF-LEGACY-MISSING-NONZERO']) {
      checks[id] = 'skip'; show[id] = '拿不到改前构建（git show ' + PRE_DEFAULTS_REV + ':core/we-scene-bundle.js 失败 —— 浅克隆缺该提交就应如实报红）'
    }
  } else {
    const same = [], diff = []
    for (const f of LEGACY_FIXTURES) {
      const a = await runFixture(oldLib, f, true), b = await runFixture(lib, f, true)
      const eq = a[0] === b[0] && a[1] === b[1]
      same.push(f.tag + ':' + eq)
      if (!eq) diff.push(f.tag + ' prev=' + V(a) + ' now=' + V(b))
    }
    C('LEGACY-BITEXACT-VS-PREV', diff.length === 0,
      '三个夹具（influence/amount/delay 各不同，含 influence=2 一档）**逐位相同** [' + same.join(' ') + ']' +
      (diff.length ? ' 差异：' + diff.join('; ') : ''))
    const f2 = LEGACY_FIXTURES[2]
    const a2 = await runFixture(oldLib, f2, true), b2 = await runFixture(lib, f2, true)
    C('LEGACY-KEEPS-OLD-INFLUENCE', a2[0] === b2[0] && a2[1] === b2[1],
      'legacy 档 influence=2 **不截断**（旧口径）：prev=' + pxOf(a2[0]).toFixed(6) + 'px now=' + pxOf(b2[0]).toFixed(6) + 'px')
    // ①(2026-09-24 **口径更新**：HEAD 已经是上一轮"公式对齐"后的构建) 缺省档 + **显式给值**的读数必须与
    //   HEAD **逐位相同** —— 本轮的授权面只有"缺属性兜底用什么值"，公式/显式值路径一个字都不许动。
    //   （上一轮那条 `DEFAULT-DIFFERS-FROM-PREV`（缺省档必须与改前不同）是**上一轮**的反假绿，HEAD 换了之后
    //   它按设计不再成立 ⇒ 换成这条方向相反的护栏 + 下面 `DEF-MISSING-DIFFERS-FROM-PREV`。）
    const diffs = []
    for (const f of LEGACY_FIXTURES) {
      const a = await runFixture(oldLib, f, false), b = await runFixture(lib, f, false)
      if (!(a[0] === b[0] && a[1] === b[1])) diffs.push(f.tag + ' prev=' + V(a) + ' now=' + V(b))
    }
    C('DEFAULT-EXPLICIT-BITEXACT-VS-PREV', diffs.length === 0,
      '缺省档 + 显式给值（L1/L2/L3 三个夹具）与 HEAD 构建**逐位相同**（本轮只动缺属性兜底）' +
      (diffs.length ? ' 差异：' + diffs.join('; ') : ''))
    // 反假绿（本轮方向）：**缺属性**夹具在 HEAD 与新构建之间**必须不同**（否则"旧默认没生效"或"新默认没生效"）
    const prF = await probe(oldLib, mkScene([L(30, 'f1', D007, [CAM_CX + 600, CAM_CY])], { cameraparallax: true }), [0.5, 0.5])
    const nrF = await probe(lib, mkScene([L(30, 'f1', D007, [CAM_CX + 600, CAM_CY])], { cameraparallax: true }), [0.5, 0.5])
    C('DEF-MISSING-DIFFERS-FROM-PREV', prF.readings.f1[0] !== nrF.readings.f1[0],
      '缺三个属性的夹具：HEAD 读数 x=' + pxOf(prF.readings.f1[0]).toFixed(6) + 'px（旧默认 amount=0，零位移）⇒ 新构建 x=' +
      pxOf(nrF.readings.f1[0]).toFixed(6) + 'px（官方默认 amount=0.5 ⇒ +21px）—— 本轮改动真的生效（反假绿）')

    // ①(2026-09-24) **缺属性**夹具：legacy 档必须逐位回旧默认（amount 0 / delay 1 / influence 1）
    const sameM = [], diffM = []
    for (const f of LEGACY_MISSING_FIXTURES) {
      const a = await runMissingFixture(oldLib, f, true), b = await runMissingFixture(lib, f, true)
      const eq = a[0] === b[0] && a[1] === b[1]
      sameM.push(f.tag + ':' + eq)
      if (!eq) diffM.push(f.tag + ' prev=' + V(a) + ' now=' + V(b))
    }
    C('DEF-LEGACY-MISSING-BITEXACT', diffM.length === 0,
      '缺属性夹具（LM1 三个全缺 / LM2 缺 delay+influence / LM3 只缺 delay）legacy 档与改前构建**逐位相同** [' +
      sameM.join(' ') + ']' + (diffM.length ? ' 差异：' + diffM.join('; ') : ''))
    const lm2Old = await runMissingFixture(oldLib, LEGACY_MISSING_FIXTURES[1], true)
    C('DEF-LEGACY-MISSING-NONZERO', Math.abs(pxOf(lm2Old[0])) > 1 && Math.abs(pxOf(lm2Old[1])) < 1e-3,
      'LM2（显式 amount=0.5、**缺** delay+influence）改前构建 legacy 档 x=' + pxOf(lm2Old[0]).toFixed(6) +
      'px y=' + pxOf(lm2Old[1]).toExponential(3) + 'px（旧默认 delay=1/influence=1 ⇒ 旧指数 k=0.0739/帧、5 帧后非零）' +
      ' —— 反假绿：否则"逐位相同"可能只是两边都 0')
  }

  // ①(2026-09-24) 缺省档 vs legacy 档在**同一缺属性场景**上必须不同（证明 legacy 真用旧默认，不是"两档一起换了"）
  {
    const lm2Legacy = await runMissingFixture(lib, LEGACY_MISSING_FIXTURES[1], true)
    const lm2Default = await runMissingFixture(lib, LEGACY_MISSING_FIXTURES[1], false)
    C('LEGACY-DEFAULTS-DIFFER-FROM-OFFICIAL', lm2Legacy[0] !== lm2Default[0],
      'LM2 同场景：legacy（旧默认 delay=1/influence=1）x=' + pxOf(lm2Legacy[0]).toFixed(6) +
      'px ≠ 缺省档（官方默认 influence=0 ⇒ 鼠标项恒 0）x=' + pxOf(lm2Default[0]).toFixed(6) + 'px')
  }

  // ── §E #6 冻结 vs 归零（用"冻结窗口之后**恢复帧**的读数"判别）───────────────────────────
  {
    const sc = mkScene([L(1, 'fz', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 1, cameraparallaxdelay: 0 })
    const run = await mkRun(lib, sc)
    try {
      await run.frame()                       // 中心
      run.move(0.9, 0.5)
      await run.frame()                       // delay=0 ⇒ 吸附 ⇒ parDisp = tx 精确
      const before = run.read().fz[0]
      sc.general.cameraparallaxdelay = 0.1    // 恢复帧用**非吸附** k，才能区分"冻结"与"归零"
      sc.general.cameraparallax = false       // 官方：关 ⇒ 冻结（保持上次值）
      await run.frame(); await run.frame(); await run.frame()
      const during = run.read().fz[0]
      sc.general.cameraparallax = true
      await run.frame()                       // 恢复帧（k=0.161111）
      const after = run.read().fz[0]
      const k = Math.min(1, (1 - 0.1 / 3) * 10 * (1 / 60))
      const tx = (0.5 - 0.9) * PROJ_W * Math.min(1, 1)
      const frozen = tx * 0.07 * 0.5          // −53.76：冻结 ⇒ 恢复帧读回原值
      const zeroed = tx * k * 0.07 * 0.5      // ≈ −8.66：归零 ⇒ 恢复帧要从 0 重新爬
      C('OFF-FREEZE-NOT-ZERO', nearNdc(after, frozen) && !nearNdc(after, zeroed) && nearNdc(before, frozen),
        '关前 x=' + pxOf(before).toFixed(6) + 'px；冻结窗口内 x=' + pxOf(during).toFixed(6) +
        'px（本仓消费门仍在 ⇒ 0，见报告"残余"）；恢复帧 x=' + pxOf(after).toFixed(6) +
        'px；冻结期望=' + frozen + '；归零会得到=' + zeroed)
    } finally { run.restore() }
  }

  // ── §F 官方默认值（缺属性兜底）：amount 0.5 / delay 0.1 / influence 0.0（A18：44/44）──────────────
  //   官方算式（**写死在断言里**，不是抄实现；与 §A~§C 同一套，只是参数取默认值）：
  //     (o1) 归一化位置 `S = 0.5 − p · min(influence, 1)`；鼠标居中 ⇒ p = 0 ⇒ S = 0.5
  //     (o2) 每层位移 `offset = (rootPos − S) ∘ depth × amount`（设计像素）
  //     (o4) 平滑 `k = min(1, (1 − delay/3) · 10 · dt)`；delay = 0.1、dt = 1/60 ⇒ k = 29/180 = 0.1611111…
  //   ⇒ "场景开了视差、属性缺失"的读数 = 把下面 DEF 这三个**官方默认值**代进 (o1)(o2)(o4)。
  //   层心离画布中心 600px（`(ox−camCx) = 600`）、depth 0.07 ⇒ 缺 amount 时官方位移 = 600×0.07×0.5 = **21px**（非零）。
  {
    const DEF = { amount: 0.5, delay: 0.1, influence: 0.0 }   // 官方默认（44/44 官方 preview scene.json）
    // F0 手算自检（纯算术，不依赖被测实现；防止我把公式抄错）
    const kDef = (1 - DEF.delay / 3) * 10 * (1 / 60)
    C('DEF-OFFICIAL-DEFAULTS-HAND-MATH',
      Math.abs(600 * 0.07 * DEF.amount - 21) < 1e-9
      && Math.abs(600 + 600 * 0.07 * DEF.amount - 621) < 1e-9
      && Math.abs(kDef - 29 / 180) < 1e-15,
      '手算：位移 600×0.07×0.5=21px ⇒ 读数 600+21=621px（float64 实测 ' + (600 * 0.07 * DEF.amount) +
      '）；k=(1−0.1/3)×10×(1/60)=' + kDef + ' == 29/180=' + (29 / 180))

    // F1 三个属性**全缺** ⇒ 用官方默认 ⇒ **非零**位移，且与手算 621px 一致（float32 通路末位以内）
    const scF = mkScene([L(30, 'f1', D007, [CAM_CX + 600, CAM_CY])], { cameraparallax: true })
    const rF = await probe(lib, scF, [0.5, 0.5])
    const wantF1 = officialReadingX(CAM_CX + 600, officialS(0.5, DEF.influence), 0.07, DEF.amount)
    const oldF1 = officialReadingX(CAM_CX + 600, officialS(0.5, DEF.influence), 0.07, 0)   // 旧默认 amount=0
    const pxF1 = pxOf(rF.readings.f1[0])
    C('DEF-MISSING-AMOUNT-OFFICIAL',
      nearNdc(rF.readings.f1[0], wantF1) && !nearNdc(rF.readings.f1[0], oldF1)
      && Math.abs(pxF1 - 621) <= 1e-3 && Math.abs(pxF1 - 600) > 1,
      '缺三个属性（general 只有 cameraparallax=true）⇒ 读数 x=' + pxF1.toFixed(6) + 'px；官方默认 amount=0.5 ⇒ ' +
      '手算 600×0.07×0.5=21px 位移 ⇒ 621px（公式值 ' + wantF1 + '）；本仓旧默认 amount=0 ⇒ ' + oldF1 + 'px（零位移）')

    // F2 缺 influence ⇒ 官方默认 0.0 ⇒ **鼠标一点都推不动**（但视差链路真的挂着：hasListener）
    //    正对照（同场景显式 influence=1）必须动 —— 否则"读数不变"可能只是"视差没启用"。
    //   （amount 显式给 0.5 ⇒ 这条夹具只考 influence 一个默认值，不被 amount 默认值污染）
    const scF2 = mkScene([L(31, 'f2', D007, [CAM_CX + 600, CAM_CY])],
      { cameraparallax: true, cameraparallaxamount: 0.5 })
    const rF2a = await probe(lib, scF2, [0.5, 0.5], { frames: 5 })
    const rF2b = await probe(lib, scF2, [0.95, 0.5], { frames: 5 })
    //   （正对照显式给 amount ⇒ "动没动"只反映鼠标项，不被 amount 默认值污染）
    const scF2c = mkScene([L(32, 'f2c', D007, [CAM_CX + 600, CAM_CY])],
      { cameraparallax: true, cameraparallaxamount: 0.5, cameraparallaxmouseinfluence: 1 })
    const cA = await probe(lib, scF2c, [0.5, 0.5], { frames: 5 })
    const cB = await probe(lib, scF2c, [0.95, 0.5], { frames: 5 })
    C('DEF-MISSING-INFLUENCE-ZERO',
      rF2a.readings.f2[0] === rF2b.readings.f2[0] && rF2a.hasListener && rF2b.hasListener
      && cA.readings.f2c[0] !== cB.readings.f2c[0],
      '缺 mouseinfluence ⇒ 官方默认 0.0：鼠标 0.5→0.95 读数**逐位不变**（' + pxOf(rF2a.readings.f2[0]).toFixed(6) +
      'px，mousemove 监听=' + rF2a.hasListener + '）；正对照显式 influence=1 同动作 Δ=' +
      pxOf(cB.readings.f2c[0] - cA.readings.f2c[0]).toFixed(6) + 'px ≠ 0')

    // F3 缺 delay ⇒ 官方默认 0.1（不是旧默认 1）：显式 influence=1、鼠标 0.5→0.7 后**1 帧**
    //    ⇒ k = (1−0.1/3)×10×(1/60) = 29/180；旧默认 delay=1 ⇒ k = 0.1111…
    const txF3 = (0.5 - 0.7) * PROJ_W * Math.min(1, 1)
    const kF3old = (1 - 1 / 3) * 10 * (1 / 60)
    //   （amount 显式给 0.5 ⇒ 这条夹具只考 delay 一个默认值，不被 amount 默认值污染）
    const scF3 = mkScene([L(33, 'f3', D007)], { cameraparallax: true, cameraparallaxamount: 0.5,
      cameraparallaxmouseinfluence: 1 })
    const rF3 = await probe(lib, scF3, [0.7, 0.5], { dt: 1 / 60, frames: 1 })
    const wantF3 = txF3 * kDef * 0.07 * DEF.amount
    const oldF3 = txF3 * kF3old * 0.07 * DEF.amount
    C('DEF-MISSING-DELAY-OFFICIAL',
      nearNdc(rF3.readings.f3[0], wantF3) && !nearNdc(rF3.readings.f3[0], oldF3),
      '缺 delay ⇒ 官方默认 0.1 ⇒ k=' + kDef + '（手算 ' + wantF3 + '）；本仓旧默认 delay=1 ⇒ k=' + kF3old +
      '（' + oldF3 + '）；实测 x=' + pxOf(rF3.readings.f3[0]).toFixed(6) + 'px')

    // F4 作者**显式**给值 ⇒ 以作者值为准（amount 0.25 / delay 0 = 吸附 / influence 1）
    const scF4 = mkScene([L(34, 'f4', D007)], { cameraparallax: true, cameraparallaxamount: 0.25,
      cameraparallaxmouseinfluence: 1, cameraparallaxdelay: 0 })
    const rF4 = await probe(lib, scF4, [0.9, 0.5])
    const txF4 = (0.5 - 0.9) * PROJ_W * Math.min(1, 1)   // −1536
    const wantF4 = txF4 * 0.07 * 0.25                 // ⇒ −26.88px
    const wrongF4 = txF4 * kDef * 0.07 * 0.25         // 若把"显式 delay=0"当缺省（0.1）会得到这个
    C('DEF-EXPLICIT-VALUES-WIN',
      nearNdc(rF4.readings.f4[0], wantF4) && !nearNdc(rF4.readings.f4[0], wrongF4),
      '作者值 amount=0.25/delay=0(吸附)/influence=1 ⇒ x=' + pxOf(rF4.readings.f4[0]).toFixed(6) + 'px 手算=' + wantF4 +
      '；若 delay 被当缺省（0.1）会是 ' + wrongF4)

    // F5 显式 amount=0 ⇒ **零位移**（"显式 0"不是"缺省"）：层心 600px、depth 0.07 ⇒ 读数回到层位 600px
    const scF5 = mkScene([L(35, 'f5', D007, [CAM_CX + 600, CAM_CY])],
      { cameraparallax: true, cameraparallaxamount: 0 })
    const rF5 = await probe(lib, scF5, [0.9, 0.5])
    C('DEF-EXPLICIT-ZERO-IS-EXPLICIT',
      nearNdc(rF5.readings.f5[0], 600) && !nearNdc(rF5.readings.f5[0], wantF1),
      '显式 cameraparallaxamount=0 ⇒ x=' + pxOf(rF5.readings.f5[0]).toFixed(6) + 'px（= 层位 600px，零位移）；' +
      '若把 0 当缺省 ⇒ 官方默认 0.5 ⇒ ' + wantF1 + 'px（差 ' + (wantF1 - 600).toFixed(3) + 'px）')
  }
  return { checks, show }
}

// ═════════════════════════ 跑真树 ═════════════════════════════════════════════════════════
const CORE_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const srcShaBefore = sha256(fs.readFileSync(CORE_FILE))
console.log('[A/B/C/D/E/F] 官方公式判据 + 官方默认值判据（离线 mock-GL；真树只读）')
const lib = await import('../core/we-scene-bundle.js')
const base = await runSuite(lib)
console.log('── 官方算式判据 ──')
for (const id of Object.keys(base.checks)) {
  if (base.checks[id] === 'skip') skip(id, base.show[id])
  else ok(id, base.checks[id], base.show[id])
}

// ═════════════════════════ §G 变异自证（MUTANT-RED-OK：期望红集 == 实际红集）═══════════════
console.log('[G] RED-IF-REVERTED：把官方对齐逐条改回旧写法（副本落 /tmp，真树只读）')
const MUTANTS = [
  {
    label: 'M1(influence 回旧式：不再 min(·,1) 截断)',
    from: '        const inflClamped = opts.parallaxLegacy ? influence : Math.min(influence, 1)',
    to: '        const inflClamped = influence',
    expectRed: ['OFF-INFLUENCE-CLAMP', 'DEFAULT-EXPLICIT-BITEXACT-VS-PREV'],
    why: '只有 influence>1 那一档（B3、以及 L3 夹具的 influence=2）会变；其余档 influence<=1 时 min 是恒等 ⇒ 不红。'
      + 'L3 是"显式给值"夹具，公式一改它就与 HEAD 不同 ⇒ 本轮那条"显式值逐位不变"的护栏也红（正确）',
  },
  {
    label: 'M2(平滑回旧指数式 1−exp(−dt·ln100/delay))',
    from: '        } else if (delay <= parDt) {\n          k = 1                                          // 官方：delay <= dt ⇒ 吸附到目标（不平滑）\n        } else {\n          k = Math.min(1, (1 - delay / 3) * 10 * parDt)   // 官方：只封顶 1.0，**不夹下界**\n        }',
    to: '        } else {\n          const LN100 = Math.log(100)\n          k = 1\n          if (delay > 0) k = 1 - Math.exp(-(Math.max(0, parDt) * LN100) / delay)\n          k = Math.min(1, Math.max(0, k))\n        }',
    expectRed: ['OFF-K-CLOSED-FORM', 'OFF-K-CAP-ONLY', 'OFF-K-NO-LOWER-CLAMP',
      'DEFAULT-EXPLICIT-BITEXACT-VS-PREV', 'DEF-MISSING-DELAY-OFFICIAL'],
    why: 'delay=0（吸附）与冻结恢复档在两式下同值 ⇒ 不红；其余 k 档全红。'
      + '①(2026-09-24 口径更新) DEFAULT-EXPLICIT-BITEXACT-VS-PREV 红 = 改回旧 k 后"显式给值"的读数与 HEAD 不再逐位相同（正确）；'
      + 'DEF-MISSING-DELAY-OFFICIAL 红 = 缺 delay 用官方默认 0.1，旧指数式下 k 不是 29/180（正确）',
  },
  {
    label: 'M3(每层回旧加法式 (depth+amount)×disp)',
    from: '          parOffX = ((pox - camCx) + parDispX) * dpx * parAmount\n          parOffY = ((poy - camCy) + parDispY) * dpy * parAmount',
    to: '          parOffX = (dpx + parAmount) * parDispX\n          parOffY = (dpy + parAmount) * parDispY',
    expectRed: ['OFF-PRODUCT-NOT-SUM', 'OFF-HALF-NOT-SCALED', 'OFF-INFLUENCE-CLAMP', 'OFF-K-CLOSED-FORM',
      'OFF-K-SNAP-DELAY0', 'OFF-K-CAP-ONLY', 'OFF-K-NO-LOWER-CLAMP', 'OFF-ROOT-ANCESTOR-DEPTH',
      'OFF-MOUSE-ONCE', 'OFF-TWO-TERMS-KEPT', 'OFF-FREEZE-NOT-ZERO',
      'DEFAULT-EXPLICIT-BITEXACT-VS-PREV', 'DEF-MISSING-AMOUNT-OFFICIAL', 'DEF-MISSING-DELAY-OFFICIAL',
      'DEF-MISSING-DIFFERS-FROM-PREV', 'DEF-EXPLICIT-VALUES-WIN'],
    why: '所有用缺省每层式的读数都变（influence=0 档 parDisp 恒 0 ⇒ 加法式也得 0 ⇒ ①DEF-MISSING-INFLUENCE-ZERO'
      + ' 与 ②DEF-EXPLICIT-ZERO-IS-EXPLICIT 不红：前者只比较"鼠标动不动"、后者读数是零位移，两档都 0）',
  },
  {
    label: 'M4(depth 取本层，不回顶层祖先)',
    from: '      const parDepthSrc = (parRoot && parRoot.parallaxDepth) ? parRoot : layer',
    to: '      const parDepthSrc = layer',
    expectRed: ['OFF-ROOT-ANCESTOR-DEPTH'],
    why: '只有带 parent 的夹具（C3）顶层≠本层；其余夹具都是顶层层 ⇒ parRoot===layer',
  },
  {
    label: 'M5(#6 回旧的"关就归零")',
    from: '      // else：官方 `cameraparallax === false` ⇒ **冻结**（保持上一次的 `parDispX/Y`，不归零）—— 见上方 #6。',
    to: '      else { parDispX = 0; parDispY = 0 }   // MUTANT：旧口径（关 ⇒ 归零）',
    expectRed: ['OFF-FREEZE-NOT-ZERO'],
    why: '冻结只在"关→开"的恢复帧上可分辨；其余档场景级开关恒 true',
  },
  {
    label: 'M6(#4 机械"只保留 Scene[704..708] 那一项"，删掉 (ox−camCx))',
    from: '          parOffX = ((pox - camCx) + parDispX) * dpx * parAmount',
    to: '          parOffX = (parDispX) * dpx * parAmount',
    expectRed: ['OFF-TWO-TERMS-KEPT', 'DEF-MISSING-AMOUNT-OFFICIAL', 'DEF-MISSING-DIFFERS-FROM-PREV'],
    why: '只有"层 origin 不在画布中心"的判据能看见 root 参考点项（居中夹具 (ox−camCx)=0 ⇒ 不红）；'
      + '本轮 F1 夹具特意把层心放在 +600px ⇒ DEF-MISSING-AMOUNT-OFFICIAL 也红（正确）。'
      + '①实测修正：DEF-MISSING-DIFFERS-FROM-PREV 也红 —— 删掉 `(ox−camCx)` 后新构建的 F1 读数回到层位 600px，'
      + '正是 HEAD（旧默认 amount=0）的读数 ⇒ "本轮改动生效"这一判据为假（正确：这条变异抹掉了本轮改动的可观测性）。'
      + 'DEF-MISSING-INFLUENCE-ZERO 不红：它只比较"鼠标动不动"，F1/F2 的鼠标项在缺 influence 时恒 0',
  },
  // ── ①(2026-09-24 本轮新增) 官方默认值对齐的变异：M7 默认值改回旧的 / M8 显式 0 当缺省 /
  //    M9 legacy 档也换新默认 / M10 只把 amount 默认改回 0 ──────────────────────────────────────
  {
    label: 'M7(三个默认值全改回旧的 amount=0/delay=1/influence=1)',
    from: '    const parDefaultAmount = opts.parallaxLegacy ? 0 : 0.5        // 官方 0.5（44/44）；本仓旧 0\n'
      + '    const parDefaultDelay = opts.parallaxLegacy ? 1 : 0.1         // 官方 0.1（44/44）；本仓旧 1\n'
      + '    const parDefaultInfluence = opts.parallaxLegacy ? 1 : 0       // 官方 0.0（43/44，另 1 个 1.0）；本仓旧 1',
    to: '    const parDefaultAmount = 0\n    const parDefaultDelay = 1\n    const parDefaultInfluence = 1',
    expectRed: ['DEF-MISSING-AMOUNT-OFFICIAL', 'DEF-MISSING-INFLUENCE-ZERO', 'DEF-MISSING-DELAY-OFFICIAL',
      'DEF-MISSING-DIFFERS-FROM-PREV'],
    why: '缺属性三条全回旧 ⇒ 三个 DEF-MISSING-* 判据全红（F2 夹具显式给了 amount ⇒ 默认 influence 变 1 就真能推动鼠标项）。'
      + '缺属性夹具与 HEAD 读数重合 ⇒ DEF-MISSING-DIFFERS-FROM-PREV 红。'
      + '显式给值的判据（DEF-EXPLICIT-*/DEFAULT-EXPLICIT-BITEXACT-VS-PREV）与 legacy 逐位判据不红：它们不吃缺省常量。'
      + '①实测修正：LEGACY-DEFAULTS-DIFFER-FROM-OFFICIAL **不红** —— LM2 有**显式** amount、两档的 k 算式不同'
      + '（缺省档官方闭式 k=0.1111 / legacy 旧指数式 k=0.0739）⇒ 即便默认值全一样，两档读数仍不同（该判据要 M9 才红）',
  },
  {
    label: 'M8(把"显式 0"当缺省：三处 typeof 判定改成真值判定)',
    edits: [
      ["typeof general.cameraparallaxamount === 'number' ? general.cameraparallaxamount : parDefaultAmount",
        'general.cameraparallaxamount ? general.cameraparallaxamount : parDefaultAmount'],
      ["typeof general.cameraparallaxmouseinfluence === 'number' ? general.cameraparallaxmouseinfluence : parDefaultInfluence",
        'general.cameraparallaxmouseinfluence ? general.cameraparallaxmouseinfluence : parDefaultInfluence'],
      ["typeof general.cameraparallaxdelay === 'number' ? general.cameraparallaxdelay : parDefaultDelay",
        'general.cameraparallaxdelay ? general.cameraparallaxdelay : parDefaultDelay'],
    ],
    expectRed: ['OFF-PRODUCT-NOT-SUM', 'OFF-HALF-NOT-SCALED', 'OFF-INFLUENCE-CLAMP', 'OFF-K-SNAP-DELAY0',
      'OFF-ROOT-ANCESTOR-DEPTH', 'OFF-MOUSE-ONCE', 'OFF-TWO-TERMS-KEPT', 'OFF-FREEZE-NOT-ZERO',
      'DEF-EXPLICIT-ZERO-IS-EXPLICIT', 'DEF-EXPLICIT-VALUES-WIN'],
    why: '存量夹具里有 6 处**显式 delay=0**（吸附档）被当成缺省 ⇒ k 变成 0.1611（B1/B2/B3/C3/C4/冻结档全红）；'
      + '本轮两条"显式 0"判据（amount=0 / delay=0）也红。'
      + '§A 的 influence=0.0 与官方默认 0 同值 ⇒ 不红；缺属性夹具（MISSING 系列）本来就走缺省 ⇒ 不红；legacy 档不吃这条 ⇒ 不红',
  },
  {
    label: 'M9(legacy 档也换新默认：parDefault* 去掉 parallaxLegacy 判断)',
    edits: [
      ['const parDefaultAmount = opts.parallaxLegacy ? 0 : 0.5', 'const parDefaultAmount = 0.5'],
      ['const parDefaultDelay = opts.parallaxLegacy ? 1 : 0.1', 'const parDefaultDelay = 0.1'],
      ['const parDefaultInfluence = opts.parallaxLegacy ? 1 : 0', 'const parDefaultInfluence = 0'],
    ],
    expectRed: ['DEF-LEGACY-MISSING-BITEXACT', 'LEGACY-DEFAULTS-DIFFER-FROM-OFFICIAL'],
    why: '缺属性的 legacy 夹具（LM2 缺 delay+influence / LM3 缺 delay）与 HEAD 不再逐位相同；'
      + '两档默认改成同一套 ⇒ "缺省档 ≠ legacy 档"不再成立。'
      + 'LM1 三个全缺且层居中 ⇒ 两档都得 0 ⇒ 单独看 LM1 不红（这也正是要三个夹具一起判的原因）；'
      + 'DEF-LEGACY-MISSING-NONZERO 用的是 HEAD 构建读数 ⇒ 不受变异影响',
  },
  {
    label: 'M10(只把 amount 默认改回 0)',
    from: '    const parDefaultAmount = opts.parallaxLegacy ? 0 : 0.5        // 官方 0.5（44/44）；本仓旧 0',
    to: '    const parDefaultAmount = opts.parallaxLegacy ? 0 : 0        // MUTANT：旧默认',
    expectRed: ['DEF-MISSING-AMOUNT-OFFICIAL', 'DEF-MISSING-DIFFERS-FROM-PREV'],
    why: '只有"缺 amount"的读数变（F1 位移归零、与 HEAD 重合）；'
      + 'F2 只看"鼠标动不动"（缺 influence=0 ⇒ 两档都 0）⇒ 不红；F3/legacy 夹具都显式写了 amount ⇒ 不红',
  },
]
let mutRedOk = 0
for (const mu of MUTANTS) {
  const body0 = fs.readFileSync(CORE_FILE, 'utf8')
  // ①(2026-09-24) 支持 `edits: [[from,to],…]`（多处单变量同改，如"三处真值判定"）；老的 from/to 单点形态不变。
  const edits = mu.edits || [[mu.from, mu.to]]
  const badAnchor = edits.find(([f]) => !body0.includes(f))
  if (badAnchor) {
    failN++; console.log('  ✗ ' + mu.label + ' 变异锚点不在源码里：' + V(String(badAnchor[0]).slice(0, 60)))
    continue
  }
  let mutated = body0
  for (const [f, t] of edits) mutated = mutated.replace(f, t)
  const tmp = path.join(os.tmpdir(), 'offpar-mut-' + mu.label.replace(/[^A-Za-z0-9]/g, '') + '-' + Math.random().toString(36).slice(2) + '.mjs')
  fs.writeFileSync(tmp, mutated.replace(/from '\.\//g, "from '" + path.join(ROOT, 'core') + '/'))
  let res = null, err = null
  try {
    const mm = await import(pathToFileURL(tmp).href + '?v=' + Date.now() + Math.random())
    res = await runSuite(mm)
  } catch (e) { err = String((e && e.message) || e).slice(0, 200) }
  finally { fs.rmSync(tmp, { force: true }) }
  if (err) { failN++; console.log('  ✗ ' + mu.label + ' 变异副本抛错（不是干净的"红"）：' + err); continue }
  // 红集口径：**基档通过** 而变异后为假的那些 id（基档自身有假项时不混进来）
  const actual = Object.keys(base.checks).filter((id) => base.checks[id] === true && res.checks[id] === false).sort()
  const want = mu.expectRed.slice().sort()
  const eq = V(actual) === V(want)
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-RED-MISMATCH') + '｜' + mu.label)
  console.log('      期望红集=' + V(want))
  console.log('      实际红集=' + V(actual))
  console.log('      预期理由：' + mu.why)
  if (eq) { mutRedOk++; passN++; console.log('  ✓ ' + mu.label + ' ⇒ 期望红集 == 实际红集') }
  else { failN++; fails.push(mu.label); console.log('  ✗ ' + mu.label + ' ⇒ 红集不一致') }
}
ok('G 变异自证组数 ≥3 且全部 MUTANT-RED-OK（' + mutRedOk + '/' + MUTANTS.length + '）',
  mutRedOk >= 3 && mutRedOk === MUTANTS.length)

// ── 真树未被改动 ──
const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^offpar-(mut|prev)-.*\.mjs$/.test(f))
const srcShaAfter = sha256(fs.readFileSync(CORE_FILE))
ok('H 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同，且 /tmp 无残留副本',
  srcShaBefore === srcShaAfter && leftovers.length === 0,
  'sha=' + srcShaBefore.slice(0, 12) + ' leftovers=' + leftovers.length)

console.log('\n===== official-parallax-formula: ' + passN + ' 通过 / ' + failN + ' 失败 / ' + skipN + ' SKIP =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

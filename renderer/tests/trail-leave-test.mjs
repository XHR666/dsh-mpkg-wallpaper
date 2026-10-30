/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · `references/vendor-ref/webwallgl`（oneincase/webwallgl，**MIT**）—— P-136 明确照抄的那几个函数见
 *     `core/we-particle-pointer.mjs` 文件头与 THIRD-PARTY.md §14；本文件只**读**它的行号作行为对照；
 *   · `references/wer-ref`（GPL-2.0-only）、`references/lwe-ref`（GPL-3.0-only）—— 与本项目 GPL-3.0-or-later
 *     许可不兼容，本文件不引用其任何内容。
 */
// trail-leave-test.mjs — ①(尾迹离开 2026-09-19) 鼠标尾迹在**指针离开窗口**时的行为回归门禁
//   （秒级、无浏览器、无 GPU；真包一节缺语料时 SKIP 不计票）
//
// ── 用户实测（原话要点）─────────────────────────────────────────────────────────────────────
//   "如果我把鼠标挪出屏幕外 … 直接把粒子效果拖到屏幕中间再进行消失 … 这个应该是我鼠标挪出去过后
//    他就直接消失，而不是粒子先回到屏幕中央再消失。"
//   "这一项 oneincase 也没有做好：他的画面中，在鼠标挪出去的时候，鼠标尾迹会在屏幕边缘最后挪出的
//    地方一直转圈，不会消失。" ⇒ **两条都不许**：既不许"回到画面中心"，也不许"边缘一直转圈"。
//
// ── 根因（本文件钉死的三条代码路径）─────────────────────────────────────────────────────────
//   ① 力中心退化：`core/we-scene-bundle.js` 的 `vortex` 在拿不到指针时把圆心换成 `sys.origin`
//      （= **图层原点**；全屏尾迹层就是**画面中心**），`controlpointattract` 则把 authored
//      `cp.offset`（层空间）当世界坐标用（= 画面左上角）。上游同形：`particles.js:1011`
//      `const base = this._cpPos(v.cp) || [0, 0, 0]`（`_cpPos` 无指针 ⇒ null ⇒ 圆心 = 系统原点）。
//   ② 没有"最后已知指针"：`core/we-particle-pointer.mjs` 的块 F 只做上游那半句（有指针就
//      `setPointer`），本仓库 P-118/P-121 的语义是"离开 ⇒ 无指针"⇒ 下游只能退化（①）。
//      上游自己的宿主在离开时**保留最后位置**（`pointer.js` 的 `pushExternalLeave`），所以它走不到 ①，
//      代价就是用户看到的"在最后离开点一直转圈"（它的发射器不停发）。
//   ③ 离开瞬间的收尾：P-136 的写法是 `sys.particles.length = 0`（一帧蒸发）——本批改成
//      `finishTrailInPlace()`（有界衰减：每帧严格更少 + alpha 逐帧渐隐 + 第 k 帧归零），
//      位置一帧不改、力中心冻结在最后离开点。
//
// ── 判据口径（"离开后 N 帧内粒子数/位置"）────────────────────────────────────────────────────
//   · **力中心**：`sys.__ptrForceX/__ptrForceY/__ptrForceKind` —— 指针控制点算子在当帧**实际用的
//     圆心/目标**（只读记账，见 bundle 里两处 `①(尾迹离开 2026-09-19 · 只读记账…)`）。
//     这是"粒子效果有没有被拖到画面中心"的**直接**可断言口径：离开后它必须 = 最后离开点。
//   · **质心**：存活粒子 `pos` 的均值（世界设计像素）；另有顶点流质心（真正上屏的 quad）。
//   · **粒子数**：`sys.particles.length`（锁指针层：离开帧起恒为 0）。
//
// ── 用法 ──────────────────────────────────────────────────────────────────────────────────
//   node tests/trail-leave-test.mjs [--probe] [--no-mutation] [--verbose]
//     --probe         变异子进程用：只跑判据并印 `PASS/FAIL <tag>` + `PROBE {json}`，rc=1 = 有红
//     --no-mutation   跳过内置的 4 组"红-if-reverted"变异自证
//   环境变量：
//     MPW_TRAIL_BUNDLE  备用渲染器**副本**绝对路径（变异自检用；平时不要设）
//     MPW_ROOT          工作区根（默认 = 仓库的上一级）—— 真包一节用
//   退出码：0 = 全过（含 SKIP）；1 = 有真失败；2 = 用法错误。
//
// ── 与既有门禁的关系（不许悄悄改别人的断言）──────────────────────────────────────────────
//   `tests/pointer-leave-test.mjs` 的 P3b 要求"离开后**连续 3 帧**存活粒子为 0"（第 1 帧就算）
//   ⇒ 渲染器侧收尾窗口策略值取 1 帧（`TRAIL_FINISH_FRAMES = 1`），k>1 的衰减性质在本文件
//   **单元层**（`finishTrailInPlace(sys, 4)`）逐条钉住：将来 P3b 放宽成"第 2 帧起为 0"，
//   把常量改成 2~4 即可，判据已就位。
import { WS, ROOT } from './_root.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const VERBOSE = process.argv.includes('--verbose')
const IS_PROBE = process.argv.includes('--probe')
const MUTATION = !process.argv.includes('--no-mutation')
const MPW_WS = process.env.MPW_ROOT || WS
const DIR = `${MPW_WS}/allwallpaper/dd`
const ROOTDIR = ROOT

// ── 被测渲染器（默认真文件；变异自检用 /tmp 副本）──
const BUNDLE = process.env.MPW_TRAIL_BUNDLE
  ? path.resolve(process.env.MPW_TRAIL_BUNDLE)
  : path.join(ROOTDIR, 'core', 'we-scene-bundle.js')
if (!fs.existsSync(BUNDLE)) { console.log('用法错误：渲染器不存在 ' + BUNDLE); process.exit(2) }
const lib = await import(pathToFileURL(BUNDLE).href)
const ptrMod = await import(pathToFileURL(path.join(path.dirname(BUNDLE), 'we-particle-pointer.mjs')).href)

// ── 计票 ──
const checks = []
const push = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  if (VERBOSE || !ok || IS_PROBE) console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? ' — ' + detail : ''))
}
const note = (name, detail) => { if (VERBOSE || IS_PROBE) console.log('  · ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) }
const probe = []   // 变异子进程要按 tag 复核的判据（名字以 `[probe]` 前缀标出）
const pk = (name, ok, detail) => { push(name, ok, detail); probe.push({ tag: name, ok: !!ok, detail }) }
const near = (a, b, tol) => Math.abs(a - b) <= tol
const f1 = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(1) : String(v))

// ═══════════════════════════ 假 canvas / mock-GL（与 pointer-leave-test.mjs 同源写法）═══════════════
const W = 3840, H = 2160
const DIAG = Math.hypot(W, H)
const FRAME = 1 / 30
const CENTER = [W / 2, H / 2]
const PTR_IN = { x: Math.round(W * 0.8), y: Math.round(H * 0.2) }        // (0.8, 0.2) —— 父任务指定
const PTR_MOVE = 8
const LEAVE_PT = { x: PTR_IN.x + PTR_MOVE * 20, y: PTR_IN.y }            // 漂移后的离开点
const PTR_BACK = { x: Math.round(W * 0.2), y: Math.round(H * 0.8) }      // 回来时的位置（与离开点远）
const WARM = 600

function makeGl() {
  const rec = { verts: [], draws: [], bufs: new Map() }
  let curBuf = null, curProg = null
  const progUni = new Map()
  const setUni = (l, v) => { if (l && l.p && l.n) { if (!progUni.has(l.p.id)) progUni.set(l.p.id, {}); progUni.get(l.p.id)[l.n] = v } }
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER: 0x8D40 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let seq = 0
  const handlers = {
    canvas: null,     // ← 关键：`gl.canvas` 必须是"有 addEventListener 的元素"，否则指针钩子装不上（见 makeRig）
    createTexture: () => ({ id: 'tex' + (++seq) }), createFramebuffer: () => ({ id: 'fbo' + (++seq) }),
    createBuffer: () => ({ id: 'buf' + (++seq) }), createVertexArray: () => ({ id: 'vao' + (++seq) }),
    createShader: () => ({ id: 'sh' + (++seq) }), createProgram: () => ({ id: 'prog' + (++seq) }),
    bindBuffer: (t, b) => { curBuf = b && b.id },
    bufferData: (t, data) => { if (data && data.length) { const v = Float32Array.from(data); rec.bufs.set(curBuf, v); rec.verts.push(v) } },
    activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {}, bindVertexArray: () => {},
    useProgram: (p) => { curProg = p },
    texImage2D: () => {}, uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
    drawArrays: (m, f, c) => { rec.draws.push({ count: c, data: rec.bufs.get(curBuf) || null }) },
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
  return { gl, rec, setCanvas: (c) => { handlers.canvas = c } }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const SR = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
globalThis.location = { search: '' }
lib.setProjectionYFix(null)

const mkLayer = (id, origin, def, extra) => Object.assign({
  id, name: 'trail-' + id, visible: true, origin, scale: [1, 1, 1], angles: [0, 0, 0],
  alpha: 1, size: [W, H], image: null, particle: 'p' + id, particleDef: def, particleTexName: 'trail_tex',
  textureName: null, effects: [], parallaxDepth: null, uvRect: undefined,
}, extra || {})

/** 造一台"假事件目标画布 + mock-GL + 真 createRenderer"的台子（DOM 指针通道）。 */
function makeRig(layers) {
  const listeners = new Map()
  const fired = []
  const rect = { left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 }
  const { gl, rec, setCanvas } = makeGl()
  const canvas = {
    width: W, height: H, clientWidth: W, clientHeight: H, style: {},
    getContext: () => gl,
    getBoundingClientRect: () => rect,
    setAttribute: () => {},
    contains: (n) => n === canvas,
    addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn) },
    removeEventListener: (t, fn) => { const a = listeners.get(t) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) },
  }
  setCanvas(canvas)
  const scene = {
    general: { orthogonalprojection: { width: W, height: H } }, camera: null, layers, properties: {},
  }
  const textures = new Map([['trail_tex', { glTex: { id: 'trail_tex_gl' }, width: 64, height: 64 }]])
  const cache = new Map()
  const renderer = lib.createRenderer(canvas, { shaderResolver: SR, onLog: () => {}, particleSysCache: cache })
  let t = 0
  const snap = (L) => {
    const entry = cache.get(L.id); const sys = entry && entry.sys
    const P = (sys && sys.particles) || []
    const n = P.length
    const cx = n ? P.reduce((a, p) => a + p.pos[0], 0) / n : NaN
    const cy = n ? P.reduce((a, p) => a + p.pos[1], 0) / n : NaN
    const batches = rec.draws.filter((d) => d.count > 6 && d.data && d.data.length === d.count * 9)
    const v = batches.length ? batches[0].data : null
    let vx = NaN, vy = NaN, vn = 0
    if (v) {
      let sx = 0, sy = 0
      for (let k = 0; k + 54 <= v.length; k += 54) {
        // 每个 quad 的 6 个顶点取中心（x 直接均值；y 用 min/max 中点，顶点序不是中心对称）
        sx += (v[k * 0 + 0] + v[k * 9 + 0] + v[k * 9 * 2 + 0]) / 3
        let lo = Infinity, hi = -Infinity
        for (let j = 0; j < 6; j++) { const y = v[k + j * 9 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y) }
        sy += (lo + hi) / 2
        vn++
      }
      if (vn) { vx = (sx / vn + 1) / 2 * W; vy = (1 - sy / vn) / 2 * H }
    }
    return {
      L, sys, alive: n, cx, cy,
      dCenter: n ? Math.hypot(cx - CENTER[0], cy - CENTER[1]) : NaN,
      dLeave: n ? Math.hypot(cx - LEAVE_PT.x, cy - LEAVE_PT.y) : NaN,
      ptr: sys ? sys.pointer : null,
      skipped: sys ? (sys.__ptrSkipped || 0) : 0,
      cleared: sys ? (sys.__ptrCleared || 0) : 0,
      fx: sys ? sys.__ptrForceX : undefined, fy: sys ? sys.__ptrForceY : undefined, fk: sys ? sys.__ptrForceKind : undefined,
      meanAlpha: n ? P.reduce((a, p) => a + p.alpha, 0) / n : NaN,
      posCopy: P.map((p) => [p.pos[0], p.pos[1]]),
      // 本帧**新生**粒子（= 年龄最小的一代）的出生位置：必须在快照那一刻冻结 ——
      // `sys` 是活的，事后读 `sys.particles` 会读到后续帧的状态（本文件踩过一次）。
      bornPos: (() => { if (!n) return []; const ma = Math.min(...P.map((p) => p.age)); return P.filter((p) => p.age <= ma + 1e-9).map((p) => [p.pos[0], p.pos[1]]) })(),
      vertCentroid: [vx, vy], quads: vn,
    }
  }
  return {
    gl, rec, scene, textures, renderer, cache, listeners, fired,
    get time() { return t },
    async frame(target) {
      t += FRAME
      rec.draws.length = 0
      for (const L of scene.layers) if (L.particleDef) L.visible = (L === target)
      return renderer.render(scene, textures, W, H, t)
    },
    fire(type, ev) {
      const a = listeners.get(type) || []
      fired.push({ type, n: a.length })
      for (const fn of a) fn(ev)
      return a.length
    },
    snap,
  }
}

// ── 合成 def（两条"影子"路线各一份）──
const CP_PTR = [{ flags: 1, id: 0, offset: '0 0 0' }]
// ① 尘埃层：发射器**不**挂在指针上（照常在层原点附近发射），但**算子**用指针控制点
//    （真实语料 6 个包：`controlpointattract:1` 的 尘埃/萤火虫/vapor/matrix_trail）。
//    层原点故意放在**画面正中** ⇒ 旧写法（无指针 ⇒ 圆心/目标退化）正好把人拽到画面中心。
const dustDef = (op) => ({
  maxcount: 400, controlpoint: CP_PTR,
  emitter: [{ name: 'boxrandom', rate: 60, distancemin: '-40 -40 0', distancemax: '40 40 0', origin: '0 0 0' }],
  initializer: [{ name: 'lifetimerandom', min: 6, max: 6 }, { name: 'sizerandom', min: 20, max: 20 }],
  // `movement` 是**位移积分器**（`p.pos += p.vel·dt`，见 bundle `case 'movement'`）——
  //   没有它，吸引子/涡流算出来的 `p.vel` 一次都不会落到位置上（本文件的漂移判据会静默失效）。
  operator: [{ name: 'movement', drag: 1, gravity: '0 0 0' }].concat(op),
})
const ATTRACT_OP = [{ name: 'controlpointattract', controlpoint: 0, origin: '0 0 0', scale: 2000, threshold: 8000 }]
const VORTEX_OP = [{ name: 'vortex', controlpoint: 0, distanceinner: 0, distanceouter: 100000, speedinner: 600, speedouter: 600 }]
// ② 尾迹层：发射器**挂在指针上**（照抄块的用法；P-136 的真包层 389 同形）
const trailDef = {
  maxcount: 600, controlpoint: CP_PTR,
  emitter: [{ name: 'sphererandom', controlpoint: 0, rate: 120, distancemin: '0 0 0', distancemax: '2 2 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }],
  initializer: [{ name: 'lifetimerandom', min: 0.5, max: 0.5 }, { name: 'sizerandom', min: 20, max: 20 }],
  operator: [{ name: 'controlpointattract', controlpoint: 0, origin: '0 0 0', scale: -600, threshold: 50 },
    { name: 'vortex', controlpoint: 0, distanceinner: 0, distanceouter: 50, speedinner: 300, speedouter: 0 }],
}
// 对照层（无指针控制点）：离开不许误伤它
const freeDef = {
  maxcount: 2000,
  emitter: [{ name: 'boxrandom', rate: 240, distancemin: '0 0 0', distancemax: '3 3 0', origin: '0 0 0', directions: '1 1 0' }],
  initializer: [{ name: 'lifetimerandom', min: 30, max: 30 }],
}

/** 跑一条"指针进 → 移动 → 离开 → 回来"的帧序列，逐帧读数。 */
async function runLeaveScenario(def, extra) {
  const L = mkLayer(9101, CENTER.slice(), def, extra)
  const rig = makeRig([L])
  // 绿前提：钩子已装（建渲染器那一刻）
  rig.fire('pointermove', { clientX: PTR_IN.x, clientY: PTR_IN.y, pointerId: 1, pointerType: 'mouse' })
  let pre = null
  for (let i = 0; i < WARM; i++) { await rig.frame(L); pre = rig.snap(L) }
  const inFrames = []
  for (let i = 1; i <= PTR_MOVE; i++) {
    rig.fire('pointermove', { clientX: PTR_IN.x + i * 20, clientY: PTR_IN.y, pointerId: 1, pointerType: 'mouse' })
    await rig.frame(L)
    inFrames.push(rig.snap(L))
  }
  const lastIn = inFrames[inFrames.length - 1]
  // ★ 真实"离开窗口"事件（DOM 通道，非注入）：画布 pointerleave
  const hit = rig.fire('pointerleave', { pointerId: 1, clientX: LEAVE_PT.x, clientY: LEAVE_PT.y })
  const out = []
  for (let i = 0; i < 12; i++) {
    await rig.frame(L); out.push(rig.snap(L))
  }
  // 回到窗口：重新 pointermove（不同位置）
  rig.fire('pointermove', { clientX: PTR_BACK.x, clientY: PTR_BACK.y, pointerId: 1, pointerType: 'mouse' })
  const back = []
  for (let i = 0; i < 60; i++) { await rig.frame(L); back.push(rig.snap(L)) }
  return { L, rig, pre, inFrames, lastIn, hit, out, back }
}

// ═══════════════════════════ [1] 纯函数层：影子 + 就地收尾 ═══════════════════════════
console.log('\n[1] 纯函数：最后已知指针（影子）+ 有界衰减收尾（core/we-particle-pointer.mjs）')
{
  const sys = { originX: 1920, originY: 1080, originZ: 0, scaleX: 1, scaleY: 1, angleZ: 0, pointerLocal: null,
    localControlPoints: [{ id: 0, lockToPointer: true, offset: [0, 0, 0] }, { id: 1, lockToPointer: false, offset: [7, 9, 0] }] }
  const world = [PTR_IN.x, PTR_IN.y]
  const on = ptrMod.pushPointerFrame(sys, world)
  push('1a `pushPointerFrame(sys, 指针)` 返回 true（本帧有活指针）', on === true, `ret=${on}`)
  push('1b 影子记下最后已知指针（世界设计坐标，与入参逐位相同）',
    !!sys.pointerShadow && sys.pointerShadow[0] === world[0] && sys.pointerShadow[1] === world[1], JSON.stringify(sys.pointerShadow))
  push('1c 指针在画面内 ⇒ `pointerLeaveFrames` 恒为 0（离开计数只在本帧无指针时涨）', sys.pointerLeaveFrames === 0, `frames=${sys.pointerLeaveFrames}`)
  const off1 = ptrMod.pushPointerFrame(sys, null)
  const off2 = ptrMod.pushPointerFrame(sys, null)
  const off3 = ptrMod.pushPointerFrame(sys, null)
  push('1d `pushPointerFrame(sys, null)` 返回 false（= upstream 那半句"本帧不推进"）', off1 === false && off2 === false && off3 === false,
    `ret=${off1},${off2},${off3}`)
  push('1e 连续 3 帧无指针 ⇒ `pointerLeaveFrames` = 3（离开第几帧可断言）', sys.pointerLeaveFrames === 3, `frames=${sys.pointerLeaveFrames}`)
  push('1f 影子在离开后**保留**（这正是"不许回到画面中心"的记忆）',
    !!sys.pointerShadow && sys.pointerShadow[0] === world[0] && sys.pointerShadow[1] === world[1], JSON.stringify(sys.pointerShadow))
  push('1g 照抄块 E 的 `cpPos` **未改**：有指针 = pointerLocal + offset；无指针（`pointerLocal=null`，与 bundle 同口径）照旧返回 null',
    JSON.stringify(ptrMod.cpPos(sys, 0)) === JSON.stringify([sys.pointerLocal.x, sys.pointerLocal.y, 0])
    && (() => { const bak = sys.pointerLocal; sys.pointerLocal = null; const r = ptrMod.cpPos(sys, 0) === null; sys.pointerLocal = bak; return r })(),
    `有指针=${JSON.stringify(ptrMod.cpPos(sys, 0))}；置 null 后=null`)
  const sw = ptrMod.shadowCpWorld(sys, 0) || null
  push('1h ★ `shadowCpWorld` 在无指针帧上 = **最后已知指针**（世界），不是 null 也不是层原点',
    !!sw && near(sw[0], world[0], 1e-9) && near(sw[1], world[1], 1e-9), JSON.stringify(sw))
  push('1i `shadowCpWorld` 对非锁指针控制点 = cp.offset 经层变换（与 `cpWorld` 同式）',
    JSON.stringify(ptrMod.shadowCpWorld(sys, 1)) === JSON.stringify(ptrMod.cpWorld(sys, 1)) && !!ptrMod.shadowCpWorld(sys, 1),
    JSON.stringify(ptrMod.shadowCpWorld(sys, 1)))
  const never = { originX: 0, originY: 0, originZ: 0, scaleX: 1, scaleY: 1, angleZ: 0, pointerLocal: null,
    localControlPoints: [{ id: 0, lockToPointer: true, offset: [0, 0, 0] }] }
  push('1j 从未有过指针（首帧 / `?cursor=off` 全程）⇒ 影子为空（保持旧行为，不无中生有）',
    ptrMod.shadowCpWorld(never, 0) === null && ptrMod.pointerShadowWorld(never) === null, 'null')
  const copy = ptrMod.pointerShadowWorld(sys)
  if (copy) copy[0] = -1
  push('1k `pointerShadowWorld` 返回副本（调用方改不动内部状态）',
    !!copy && !!sys.pointerShadow && sys.pointerShadow[0] === world[0], JSON.stringify(sys.pointerShadow))

  // ── 有界衰减（k=4；现网策略值是 1，见常量注释与文件头）──
  const mkP = (x) => ({ pos: [x, 100, 0], alpha: 1, _initAlpha: 1 })
  const s2 = { particles: [mkP(1), mkP(2), mkP(3), mkP(4), mkP(5), mkP(6), mkP(7), mkP(8)], count: 8, pointerLeaveFrames: 0 }
  const seq = [], alphas = [], maxMove = []
  for (let f = 1; f <= 5; f++) {
    s2.pointerLeaveFrames = f
    // 位置快照按**对象身份**取（收尾会从数组头部丢粒子 ⇒ 按下标比对会串位）
    const before = new Map(s2.particles.map((p) => [p, [p.pos[0], p.pos[1]]]))
    const left = ptrMod.finishTrailInPlace(s2, 4)
    seq.push(left)
    alphas.push(s2.particles.length ? s2.particles.reduce((a, p) => a + p.alpha, 0) / s2.particles.length : 0)
    let md = 0
    for (const p of s2.particles) {
      const b = before.get(p)
      if (b) md = Math.max(md, Math.hypot(p.pos[0] - b[0], p.pos[1] - b[1]))
    }
    maxMove.push(md)
  }
  push('1l ★ `finishTrailInPlace(sys, 4)`：粒子数**每帧严格下降**（第 1 帧就有减、不是一帧清空）',
    seq[0] > 0 && seq[0] < 8 && seq[1] < seq[0] && seq[2] < seq[1] && seq[3] < seq[2], `序列=${seq.join('→')}`)
  push('1m ★ 第 k=4 帧归零（有界收尾，不会留残影、也不会"一直转圈"）', seq[3] === 0 && seq[4] === 0, `序列=${seq.join('→')}`)
  push('1n ★ 收尾期间留下的粒子位置**一帧都不改**（本函数只动 alpha 与数组头部）',
    maxMove.every((m) => m === 0), `max|Δpos|=${JSON.stringify(maxMove)}`)
  push('1o ★ alpha 逐帧渐隐（第 1 帧 < 初值且 > 0 ⇒ 可见的渐隐而不是"啪"地消失）',
    alphas[0] > 0 && alphas[0] < 1 && alphas[1] < alphas[0], `平均 alpha=${alphas.map((a) => a.toFixed(3)).join('→')}`)
  push('1p 丢的是**最老的**（发射序头部）⇒ 留下的是"最后离开点那一簇"',
    s2.particles.length === 0 || s2.particles[0].pos[0] >= 1, `剩 ${s2.particles.length} 粒`)
  push('1q 现网策略值 `TRAIL_FINISH_FRAMES === 1`（= 离开帧即归零，与既有门禁 P3b 兼容）',
    ptrMod.TRAIL_FINISH_FRAMES === 1, `TRAIL_FINISH_FRAMES=${ptrMod.TRAIL_FINISH_FRAMES}`)
  const src = fs.readFileSync(path.join(path.dirname(BUNDLE), 'we-particle-pointer.mjs'), 'utf8')
  push('1r 策略值的**理由写进了源码**（点名 P3b 与"k>1 只是改一行"）',
    /P3b/.test(src) && /TRAIL_FINISH_FRAMES/.test(src) && /finishTrailInPlace\(sys, k\)/.test(src), 'ok')
}

// ═══════════════════════════ [2] 合成"光标尘埃"层：离开后力中心 = 最后离开点 ═══════════════════════
console.log('\n[2] 合成（层原点 = 画面正中 + 指针控制点算子）：离开后力中心/质心都不许回到画面中心')
let SC = null
{
  const dust = await runLeaveScenario(dustDef(ATTRACT_OP))
  const vortex = await runLeaveScenario(dustDef(VORTEX_OP))
  const trail = await runLeaveScenario(trailDef)
  SC = { dust, vortex, trail }
  const { pre, lastIn, hit, out, back } = dust
  // 绿前提
  push('2a 绿前提：离开前该层存活粒子 > 0（判据有意义）', lastIn.alive > 0, `alive=${lastIn.alive}`)
  push('2b 绿前提：离开前力中心 = 指针（≤1px）且 kind=controlpointattract',
    near(lastIn.fx, LEAVE_PT.x, 1) && near(lastIn.fy, LEAVE_PT.y, 1) && lastIn.fk === 'controlpointattract',
    `力中心=(${lastIn.fx && lastIn.fx.toFixed(1)}, ${lastIn.fy && lastIn.fy.toFixed(1)}) kind=${lastIn.fk} 指针=(${LEAVE_PT.x},${LEAVE_PT.y})`)
  push('2c 绿前提：离开前质心到画面中心 > 0.2·对角线（粒子确实聚在 0.8/0.2 那一侧）',
    lastIn.dCenter > 0.2 * DIAG, `dCenter=${lastIn.dCenter.toFixed(0)}px 阈值=${(0.2 * DIAG).toFixed(0)}px`)
  push('2d 绿前提：`pointerleave` 真派发到了监听器（走的是 DOM 通道，不是注入通道）', hit >= 1, `命中 ${hit} 个监听器`)
  // ★ 核心：离开后
  const o1 = out[0]
  pk('2e ★★ 离开后第 1 帧：力中心 = **最后离开点**（≤1px，指针消失后算子仍在离开点上作用）',
    near(o1.fx, LEAVE_PT.x, 1) && near(o1.fy, LEAVE_PT.y, 1),
    `力中心=(${f1(o1.fx)}, ${f1(o1.fy)}) 离开点=(${LEAVE_PT.x},${LEAVE_PT.y})`)
  pk('2f ★★ 离开后第 1 帧：力中心到**画面中心**距离 > 0.2·对角线（没有退化到层原点 = 画面正中）',
    Math.hypot(o1.fx - CENTER[0], o1.fy - CENTER[1]) > 0.2 * DIAG,
    `到画面中心=${Math.hypot(o1.fx - CENTER[0], o1.fy - CENTER[1]).toFixed(0)}px 阈值=${(0.2 * DIAG).toFixed(0)}px（层 origin=${CENTER.join(',')}）`)
  push('2g ★ 离开后第 1 帧：力中心到层 origin 距离 > 1000px（明确不是"退化到 sys.origin"那条路径）',
    Math.hypot(o1.fx - CENTER[0], o1.fy - CENTER[1]) > 1000,
    `=${Math.hypot(o1.fx - CENTER[0], o1.fy - CENTER[1]).toFixed(0)}px`)
  push('2h ★ 离开后 12 帧：力中心**一直** = 离开点（每帧 ≤1px，不随时间漂回中心）',
    out.every((f) => near(f.fx, LEAVE_PT.x, 1) && near(f.fy, LEAVE_PT.y, 1)),
    `力中心序列=${out.map((f) => '(' + f.fx.toFixed(0) + ',' + f.fy.toFixed(0) + ')').join(' ')}`)
  push('2i ★ 离开后 12 帧：质心到画面中心的距离**不随帧数单调靠近中心**',
    out.every((f, i) => i === 0 || f.dCenter >= out[i - 1].dCenter - 2),
    `dCenter 序列=${out.map((f) => f.dCenter.toFixed(0)).join('→')}`)
  pk('2j ★★ 离开后 12 帧：质心到画面中心 > 0.2·对角线（父任务判据："不会移动到画面中心附近"）',
    out.every((f) => f.dCenter > 0.2 * DIAG),
    `min dCenter=${Math.min(...out.map((f) => f.dCenter)).toFixed(0)}px 阈值=${(0.2 * DIAG).toFixed(0)}px`)
  push('2k ★ 离开后 12 帧：质心到**离开点** < 0.35·对角线（留在离开点一侧，而不是飞向别处）',
    out.every((f) => f.dLeave < 0.35 * DIAG),
    `max dLeave=${Math.max(...out.map((f) => f.dLeave)).toFixed(0)}px 阈值=${(0.35 * DIAG).toFixed(0)}px`)
  push('2l 离开后：`sys.pointer` 为 null（对外语义不变）且该层**不靠指针发射**（__ptrSkipped 不涨）',
    out.every((f) => f.ptr === null) && out[11].skipped === lastIn.skipped,
    `ptr=null×12 skipped ${lastIn.skipped}→${out[11].skipped}`)
  push('2m ★ 顶点流（真正上屏的 quad）质心也在离开点一侧、不在画面中心附近',
    out.every((f) => !isFinite(f.vertCentroid[0]) || Math.hypot(f.vertCentroid[0] - CENTER[0], f.vertCentroid[1] - CENTER[1]) > 0.2 * DIAG),
    `顶点质心=${out.slice(0, 3).map((f) => '(' + (f.vertCentroid[0] || 0).toFixed(0) + ',' + (f.vertCentroid[1] || 0).toFixed(0) + ')').join(' ')}`)
  const dBack = (k) => Math.hypot(back[k].cx - PTR_BACK.x, back[k].cy - PTR_BACK.y)
  const nBack = back.length - 1
  push('2n 回到窗口：力中心立刻回到新指针，且质心**朝新指针方向**移动（60 帧后显著更近）',
    near(back[nBack].fx, PTR_BACK.x, 1) && near(back[nBack].fy, PTR_BACK.y, 1) && dBack(nBack) < dBack(0) - 100,
    `力中心=(${f1(back[nBack].fx)}, ${f1(back[nBack].fy)})；到新指针 ${dBack(0).toFixed(0)}→${dBack(nBack).toFixed(0)}px`)

  // ── 涡流层的圆心（上游 `|| [0,0,0]` 那条退化路径）──
  const vlast = vortex.lastIn, vout = vortex.out[0]
  push('2o 涡流绿前提：离开前圆心 = 指针（≤1px）且 kind=vortex',
    near(vlast.fx, LEAVE_PT.x, 1) && near(vlast.fy, LEAVE_PT.y, 1) && vlast.fk === 'vortex',
    `圆心=(${f1(vlast.fx)}, ${f1(vlast.fy)}) kind=${vlast.fk}`)
  pk('2p ★★ 涡流：离开后圆心 = 最后离开点（≤1px）——**不是** `sys.origin`（= 画面中心，上游 `|| [0,0,0]` 的形态）',
    near(vout.fx, LEAVE_PT.x, 1) && near(vout.fy, LEAVE_PT.y, 1) && Math.hypot(vout.fx - CENTER[0], vout.fy - CENTER[1]) > 1000,
    `圆心=(${f1(vout.fx)}, ${f1(vout.fy)}) 到画面中心=${Math.hypot(vout.fx - CENTER[0], vout.fy - CENTER[1]).toFixed(0)}px`)
  push('2q 涡流：离开后 12 帧圆心一直在离开点（不在画面中心附近打转）',
    vortex.out.every((f) => Math.hypot(f.fx - CENTER[0], f.fy - CENTER[1]) > 0.2 * DIAG),
    `min 到中心=${Math.min(...vortex.out.map((f) => Math.hypot(f.fx - CENTER[0], f.fy - CENTER[1]))).toFixed(0)}px`)
}

// ═══════════════════════════ [3] 合成"尾迹"层：离开即停 + 归零 + 回来重建 ═══════════════════════
console.log('\n[3] 合成（发射器挂指针 = 真包层 389 同形）：离开即停、粒子归零、回来重建')
{
  const { trail } = SC
  const { lastIn, out, back } = trail
  push('3a 绿前提：离开前尾迹存在（alive > 0）、**本帧新生**粒子出生在指针上（≤6px）、整条尾迹在指针那一侧',
    lastIn.alive > 0 && lastIn.bornPos.length > 0
    && lastIn.bornPos.every((q) => Math.hypot(q[0] - LEAVE_PT.x, q[1] - LEAVE_PT.y) <= 6)
    && lastIn.dCenter > 0.2 * DIAG,
    `alive=${lastIn.alive} 新生 ${lastIn.bornPos.length} 粒 max 距指针=${Math.max(...lastIn.bornPos.map((q) => Math.hypot(q[0] - LEAVE_PT.x, q[1] - LEAVE_PT.y))).toFixed(2)}px 质心到画面中心=${lastIn.dCenter.toFixed(0)}px`)
  push('3b 绿前提：离开前力中心 = 指针（≤1px）',
    near(lastIn.fx, LEAVE_PT.x, 1) && near(lastIn.fy, LEAVE_PT.y, 1), `力中心=(${f1(lastIn.fx)}, ${f1(lastIn.fy)})`)
  pk('3c ★★ 离开帧起粒子数 = 0（"挪出去就直接消失"，不是先回到画面中央再消失）',
    out.every((f) => f.alive === 0), `alive=${out.map((f) => f.alive).join(',')}`)
  push('3d ★ 离开后 12 帧恒为 0（没有"在边缘最后挪出的地方一直转圈"= 上游那条行为）',
    out.every((f) => f.alive === 0) && out[11].cleared >= 1, `__ptrCleared=${out[11].cleared}`)
  push('3e ★ 离开后粒子数序列"单调下降并归零"（k = TRAIL_FINISH_FRAMES = 1 帧内）',
    [lastIn.alive, ...out.map((f) => f.alive)].every((v, i, a) => i === 0 || v <= a[i - 1]) && out[0].alive === 0 && lastIn.alive > 0,
    `序列=${[lastIn.alive, ...out.map((f) => f.alive)].join('→')}（窗口 k=${ptrMod.TRAIL_FINISH_FRAMES}）`)
  push('3f ★ 离开后不再新增发射（累计发射冻结；防"冻结在离开点继续发射"= 上游的转圈式假修）',
    out.every((f) => f.alive === 0) && out[11].skipped > lastIn.skipped,
    `__ptrSkipped ${lastIn.skipped}→${out[11].skipped}，12 帧里 0 颗新粒子`)
  push('3g 机制证据：离开后 `sys.pointer === null`（发射门靠它，不靠"清空一次"）',
    out.every((f) => f.ptr === null), 'ptr=null×12')
  push('3h ★ 回到窗口：尾迹重建（alive > 0 且累计发射越过离开时的水位）',
    back.some((f) => f.alive > 0), `alive 峰值=${Math.max(...back.map((f) => f.alive))}`)
  const b19 = back[19]
  const born = b19.posCopy.filter((p) => Math.hypot(p[0] - PTR_BACK.x, p[1] - PTR_BACK.y) <= 6)
  push('3i ★ 重建后的粒子出生在新指针位置（6px 内存在新生粒子）', born.length > 0, `6px 内 ${born.length}/${b19.posCopy.length} 粒`)
  push('3j ★ 重建后的力中心 = 新指针（不是离开点、不是画面中心）',
    near(b19.fx, PTR_BACK.x, 1) && near(b19.fy, PTR_BACK.y, 1),
    `力中心=(${f1(b19.fx)}, ${f1(b19.fy)}) 新指针=(${PTR_BACK.x},${PTR_BACK.y})`)
  push('3k 重建后质心到画面中心 > 0.2·对角线（没有"恢复时又从画面中心冒出来"）',
    b19.dCenter > 0.2 * DIAG, `dCenter=${b19.dCenter.toFixed(0)}px`)
}

// ═══════════════════════════ [4] 真包：hina 3554161528 层 389「cherry blossoms on cursor」═══════════════
console.log('\n[4] 真包 dd/3554161528 ln=389「cherry blossoms on cursor」（spritetrail + vortex + 两个 attract）')
let REAL = null
if (fs.existsSync(`${DIR}/3554161528/scene.pkg`)) {
  const dec = new TextDecoder()
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/3554161528/scene.pkg`)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sj, null, { readParticleDef, legacyAnimY: true })
  lib.applyRenderConfig(scene, { sceneId: '3554161528', clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
  const L = scene.layers.find((l) => String(l.id) === '389')
  const me = L.particleDef.material ? lib.getEntry(pkg, L.particleDef.material) : null
  const texName = me ? (((JSON.parse(dec.decode(me)).passes || [])[0] || {}).textures?.[0] || null) : null
  const e = texName ? lib.getEntry(pkg, 'materials/' + texName + '.tex') : null
  const tex = e ? lib.parseTex(new Uint8Array(e)) : null
  L.particleTexName = texName
  const rig = makeRig(scene.layers)
  const textures = new Map()
  if (tex) { const m = lib.decodeMip0(tex); textures.set(texName, { glTex: lib.makeTextureMip(rig.gl, [m], tex.format === 8), width: m.width, height: m.height, format: tex.format, sprite: lib.spriteInfo(tex) }) }
  rig.textures.clear()
  for (const [k, v] of textures) rig.textures.set(k, v)
  let t = 20
  const step = async (ev) => { if (ev) rig.fire(ev.type, ev.ev); t += FRAME; rig.rec.draws.length = 0; for (const l of scene.layers) if (l.particleDef) l.visible = (l === L); await rig.renderer.render(scene, rig.textures, W, H, t); return rig.snap(L) }
  rig.fire('pointermove', { clientX: PTR_IN.x, clientY: PTR_IN.y, pointerId: 1, pointerType: 'mouse' })
  for (let i = 0; i < 300; i++) await step(null)
  for (let i = 1; i <= PTR_MOVE; i++) await step({ type: 'pointermove', ev: { clientX: PTR_IN.x + i * 20, clientY: PTR_IN.y, pointerId: 1, pointerType: 'mouse' } })
  const lastIn = rig.snap(L)
  rig.fire('pointerleave', { pointerId: 1, clientX: LEAVE_PT.x, clientY: LEAVE_PT.y })
  const out = []
  for (let i = 0; i < 12; i++) out.push(await step(null))
  const back = []
  rig.fire('pointermove', { clientX: PTR_BACK.x, clientY: PTR_BACK.y, pointerId: 1, pointerType: 'mouse' })
  for (let i = 0; i < 40; i++) back.push(await step(null))
  REAL = { L, lastIn, out, back, texName }
  push('4a 真包前置：层 389 是 spritetrail 层、贴图 particle/3、origin=画面正中（判据前提）',
    String(L.id) === '389' && texName === 'particle/3' && near(L.origin[0], W / 2, 1) && near(L.origin[1], H / 2, 1),
    `origin=${JSON.stringify(L.origin)} tex=${texName}`)
  push('4b 真包绿前提：离开前尾迹存在（alive ≥ 150，与 P-136 台账同量级）', lastIn.alive >= 150, `alive=${lastIn.alive}`)
  push('4c 真包绿前提：离开前力中心 = 指针（≤1px；该层 vortex/两个 attract 都用 cp0=指针）',
    near(lastIn.fx, LEAVE_PT.x, 1) && near(lastIn.fy, LEAVE_PT.y, 1), `力中心=(${f1(lastIn.fx)}, ${f1(lastIn.fy)})`)
  push('4d 真包绿前提：离开前质心到画面中心 > 0.2·对角线（尾迹甩在指针身后，不在画面中心）',
    lastIn.dCenter > 0.2 * DIAG, `dCenter=${lastIn.dCenter.toFixed(0)}px 阈值=${(0.2 * DIAG).toFixed(0)}px`)
  pk('4e ★★ 真包：离开帧起 alive = 0（不拖到画面中央、也不留残影）', out.every((f) => f.alive === 0),
    `alive=${out.map((f) => f.alive).join(',')}`)
  push('4f ★ 真包：离开后 12 帧恒 0（无"边缘一直转圈"）', out.every((f) => f.alive === 0), `第 12 帧 alive=${out[11].alive}`)
  push('4g 真包：离开后不再新增发射（__ptrSkipped 单调增长）', out[11].skipped > lastIn.skipped, `skipped ${lastIn.skipped}→${out[11].skipped}`)
  const bLast = back[back.length - 1]
  push('4h ★ 真包：回到窗口后尾迹重建（alive > 0，且力中心回到新指针）',
    back.some((f) => f.alive > 0) && near(bLast.fx, PTR_BACK.x, 1) && near(bLast.fy, PTR_BACK.y, 1),
    `alive 峰值=${Math.max(...back.map((f) => f.alive))} 力中心=(${f1(bLast.fx)}, ${f1(bLast.fy)})`)
  note('真包逐帧读数（离开前 1 帧 / 离开后 12 帧 / 回来末帧）',
    JSON.stringify({
      pre: [lastIn.alive, +lastIn.cx.toFixed(0), +lastIn.cy.toFixed(0), +lastIn.dCenter.toFixed(0), f1(lastIn.fx), f1(lastIn.fy)],
      out: out.map((f) => [f.alive, isFinite(f.cx) ? +f.cx.toFixed(0) : null, isFinite(f.dCenter) ? +f.dCenter.toFixed(0) : null]),
      back: [bLast.alive, +bLast.cx.toFixed(0), f1(bLast.fx), f1(bLast.fy)],
    }))
} else {
  push('4 真包缺失（SKIP 视作 PASS）', true, 'no 3554161528')
}

// ═══════════════════════════ [5] 变异自证（RED-IF-REVERTED，4 组）═══════════════════════════
console.log('\n[5] 变异自证：改回旧写法 ⇒ 指定断言必红（每组都做"反向自证：未变异 ⇒ 绿"）')
function probeRun(env) {
  let rc = 0, out = ''
  try {
    out = execFileSync(process.execPath, [path.join(ROOTDIR, 'tests/trail-leave-test.mjs'), '--probe'], {
      env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 600000,
    })
  } catch (err) { rc = err.status == null ? 1 : err.status; out = String(err.stdout || '') + String(err.stderr || '') }
  return { rc, out }
}
function copyCore(tmp) {
  for (const f of fs.readdirSync(path.join(ROOTDIR, 'core'))) {
    if (!/\.(mjs|js)$/.test(f)) continue
    fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(ROOTDIR, 'core', f)))
  }
}
if (!MUTATION) {
  push('5 变异自证跳过（--no-mutation）', true, 'skip')
} else if (IS_PROBE) {
  push('5 变异自证在 --probe 模式下不跑（子进程只跑判据）', true, 'skip')
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-leave-mut-'))
  const cases = [
    {
      tag: 'M1 力中心退化（`__cpWorldLocked` 无指针 ⇒ null，回到"退化到层原点/左上角"的旧写法）',
      file: 'we-scene-bundle.js',
      anchor: '    return shadowCpWorld(sys, Number(cpIdx))\n',
      to: '    return null\n',
      wantFail: /^  FAIL 2e |^  FAIL 2p /m,
      wantTags: ['2e', '2p'],
    },
    {
      tag: 'M2 收尾改回"一帧清空"（P-136 的 `particles.length = 0`）',
      file: 'we-particle-pointer.mjs',
      anchor: '  const win = Math.max(1, Math.floor(k || sys.trailFinishFrames || TRAIL_FINISH_FRAMES))\n',
      to: '  const win = 1; sys.particles.length = 0; sys.count = 0; return 0\n',
      wantFail: /^  FAIL 1l /m,
      wantTags: ['1l', '1m'],
    },
    {
      tag: 'M3 影子没有记忆（离开帧把最后已知指针丢掉 = 块 F 原样那半句）',
      file: 'we-particle-pointer.mjs',
      anchor: '  if (sys.pointerShadow) sys.pointerLeaveFrames = (sys.pointerLeaveFrames || 0) + 1\n',
      to: '  sys.pointerShadow = null; sys.pointerLocalShadow = null; sys.pointerLeaveFrames = (sys.pointerLeaveFrames || 0) + 1\n',
      wantFail: /^  FAIL 1f |^  FAIL 2e /m,
      wantTags: ['1f', '2e'],
    },
    {
      tag: 'M4 发射门放开（离开后冻结在最后位置**继续发射** = 上游"边缘一直转圈"那条行为）',
      file: 'we-scene-bundle.js',
      anchor: '  const __P = em.__ptrLocked ? sys.pointer : null\n',
      to: '  const __P = em.__ptrLocked ? (sys.pointer || pointerShadowWorld(sys)) : null\n',
      wantFail: /^  FAIL 3c /m,
      wantTags: ['3c', '3d'],
    },
  ]
  try {
    for (const c of cases) {
      const dir = fs.mkdtempSync(path.join(tmp, 'case-'))
      copyCore(dir)
      const target = path.join(dir, c.file)
      const src = fs.readFileSync(target, 'utf8')
      const hits = src.split(c.anchor).length - 1
      push(`5 变异锚点唯一（${c.tag}）`, hits === 1, `命中 ${hits} 次 @ ${c.file}`)
      if (hits !== 1) continue
      fs.writeFileSync(target, src.replace(c.anchor, c.to))
      const mut = probeRun({ MPW_TRAIL_BUNDLE: path.join(dir, 'we-scene-bundle.js') })
      push(`5 ★ RED 生效：${c.tag} ⇒ 子进程 rc=1`, mut.rc === 1, `rc=${mut.rc}`)
      const failLines = mut.out.split('\n').filter((l) => l.startsWith('  FAIL')).slice(0, 6)
      push(`5 RED 的**理由对得上**：${c.tag} ⇒ 指定断言变红（${c.wantTags.join('/')}）`,
        c.wantFail.test(mut.out), failLines.join(' ｜ ') || '(无 FAIL 行)')
      const clean = probeRun({ MPW_TRAIL_BUNDLE: path.join(ROOTDIR, 'core/we-scene-bundle.js') })
      push(`5 反向自证：未变异的真文件 ⇒ rc=0（上一条不是"怎么都红"）`, clean.rc === 0,
        `rc=${clean.rc}${clean.rc ? ' ' + clean.out.split('\n').filter((l) => l.startsWith('  FAIL')).slice(0, 3).join(' ｜ ') : ''}`)
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}

// ═══════════════════════════ [6] 汇总 / 探针输出 ═══════════════════════════
const failList = checks.filter((c) => !c.ok)
if (IS_PROBE) {
  const summary = SC ? {
    dust: { pre: SC.dust.lastIn.alive, outFx: SC.dust.out.map((f) => [f.alive, f1(f.fx), f1(f.fy), +f.dCenter.toFixed(0)]) },
    vortex: { pre: SC.vortex.lastIn.alive, outFx: SC.vortex.out.map((f) => [f.alive, f1(f.fx), f1(f.fy)]) },
    trail: { pre: SC.trail.lastIn.alive, out: SC.trail.out.map((f) => f.alive), backPeak: Math.max(...SC.trail.back.map((f) => f.alive)) },
    real: REAL ? { pre: REAL.lastIn.alive, out: REAL.out.map((f) => f.alive) } : null,
  } : null
  console.log('PROBE ' + JSON.stringify(summary))
  console.log(`PROBE-RESULT pass=${checks.length - failList.length} fail=${failList.length}`)
  process.exit(failList.length ? 1 : 0)
}
const pass = checks.length - failList.length
console.log(`\n===== trail-leave: ${pass} 通过 / ${failList.length} 失败 =====`)
if (failList.length) {
  console.log('失败断言：')
  for (const f of failList.slice(0, 30)) console.log('  ✗ ' + f.name + (f.detail ? '  — ' + f.detail : ''))
  process.exit(1)
}
process.exit(0)

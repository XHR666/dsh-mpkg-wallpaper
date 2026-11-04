#!/usr/bin/env node
/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · references/vendor-ref/webwallgl（oneincase/webwallgl，**MIT**）—— 允许移植；本文件仍按"行为规格"独立实现，
 *     引用处以 `file:line` 标注行为来源；
 *   · references/lwe-ref（linux-wallpaperengine，GPL-3.0-only）、references/wer-ref（Aromatic05/wallpaper-engine-renderer，
 *     GPL-2.0-only）—— 与本项目 GPL-3.0-or-later 不兼容，仅行为对照。
 * 血缘/许可台账见 docs/COPYING-RULES.md 与 THIRD-PARTY.md。
 */
// ptrfx-uniform-test.mjs — ①(上游 issue #4 + #5 P0) 效果链的**指针 / 指针状态 / 帧时间 / 视差位置** uniform 接线
//
// 复现：node tests/ptrfx-uniform-test.mjs
//
// ── 为什么需要它（取证与锚点）──────────────────────────────────────────────────────────
// 官方资产原文（证据强度 ①，本机 `wallpaper_engine/assets/effects/**`，逐条可 grep）：
//   · `cursorripple/shaders/effects/cursorripple_apply_force.vert:6,49,53` 用 `g_PointerPosition(-Last)`
//     + `g_EffectTextureProjectionMatrixInverse`；同效果 `.frag` 用 `g_PointerState.z`（点击冲量）
//     与 `g_Frametime`（`timeAmt = g_Frametime / 0.02`，不绑定 ⇒ 恒 0 ⇒ 水波完全不动且无报错）；
//   · `depthparallax/shaders/effects/depthparallax.vert:6,8,9,33-38` 用 `g_ParallaxPosition`（`*2-1`）
//     + `CAST3X3(g_EffectTextureProjectionMatrixInverse)`；
//   · `xray/shaders/effects/xray.vert:3,8,37,40` 用 `g_PointerPosition` + ETVPInverse + `g_PointerScale`；
//   · `fluidsimulation/shaders/effects/fluidsimulation_vorticity.vert:6,64,69` 同上。
// 改动前（本仓库源码，最强证据）：`g_PointerPosition` / `g_PointerPositionLast` **硬编码 (0,0)**；
//   其余 6 个名字**全仓 0 命中**（从不写 ⇒ 保持 GL 初值 0）⇒ 上述 4 个官方效果拿不到任何输入。
// 档位：缺省 **official（开）**；`?ptrfx=legacy` = **逐位回到改动前**（Pos/PosLast 恒 (0,0)、其余一个都不写）。
//
// ── 断言分组 ─────────────────────────────────────────────────────────────────────────
//   A official 档（缺省）：值真的被写进**声明了这些 uniform 的程序**、且随指针/时间/按键变化
//     （A1..A11：满幅层恒等 / 小层 UV 换算 / last=上一帧 / 帧时间钳制 / 按键 / 视差中心与跟随 /
//      ETVP 单位阵 / 跨 pass 一致 / xray 停位 / 台账）
//   B legacy 档：Pos/PosLast 恒 (0,0)、其余 6 个**在台账里缺席**、且与指针/时间无关（两次不同输入的
//      台账逐位相同）；并逐键对比 official↔legacy：**只有** 7 个新名字不同，其余每个 uniform 逐位相同
//   C 官方资产证据：本地 WE 资产里这些 uniform 的声明与用处（缺资产则 SKIP，不红）
//   D 变异自证（RED-IF-REVERTED）：把真源码复制到 /tmp 逐条改回旧写法，A/B 组断言必须变红
//
// 用法: node tests/ptrfx-uniform-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, WS } from './_root.mjs'

const MPW_WS = process.env.MPW_ROOT || WS

// ═════════════════════════ mock GL（按 shaderSource 真源码报 uniform + 记录每次 uniform 写入）═════════════════════════
// 关键：`getActiveUniform` 必须报**程序里真的存在**的 uniform —— 否则"官方 shader 声明了才写"与
// "xray 停位只对声明 g_PointerScale 的程序生效"这两条判据都测不出来。
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
  FLOAT: 0x1406, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52, INT: 0x1404, BOOL: 0x8B56,
  FLOAT_MAT4: 0x8B5C, FLOAT_MAT3: 0x8B5B, SAMPLER_2D: 0x8B5E }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const TYPE_OF = { float: CONST.FLOAT, int: CONST.INT, bool: CONST.BOOL, vec2: CONST.FLOAT_VEC2, vec3: CONST.FLOAT_VEC3,
  vec4: CONST.FLOAT_VEC4, mat4: CONST.FLOAT_MAT4, mat3: CONST.FLOAT_MAT3, sampler2D: CONST.SAMPLER_2D }

function mkGL() {
  let seq = 0, curProg = null, curUnit = 0
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const shaderSrc = new Map(), progShaders = new Map(), uniCache = new Map()
  const rec = { draws: [], uniWrites: [], glsl: [] }
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
    shaderSource: (s, src) => { shaderSrc.set(s, String(src)); rec.glsl.push(String(src)) },
    bindVertexArray: () => {}, bindBuffer: () => {}, bufferData: () => {}, bindAttribLocation: () => {}, linkProgram: () => {},
    activeTexture: (u) => { curUnit = u - CONST.TEXTURE0 }, bindTexture: () => {}, bindFramebuffer: () => {},
    useProgram: (p) => { curProg = p },
    drawArrays: (m, f, c) => rec.draws.push({ prog: curProg && curProg.id, count: c }), drawElements: () => {},
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
    uniformMatrix3fv: (l, t, m) => rec.uniWrites.push({ name: l && l.n, kind: 'm3', v: m ? Array.from(m) : null }),
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}

// ═════════════════════════ 合成夹具 ═════════════════════════
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
// 声明**全部** 7 个效果输入 uniform（= 官方 cursorripple/depthparallax 族的声明面）
const FRAG_PTR = [
  'uniform sampler2D g_Texture0;',
  'uniform vec2 g_PointerPosition;',
  'uniform vec2 g_PointerPositionLast;',
  'uniform vec4 g_PointerState;',
  'uniform float g_Frametime;',
  'uniform vec2 g_ParallaxPosition;',
  'uniform mat4 g_EffectTextureProjectionMatrix;',
  'uniform mat4 g_EffectTextureProjectionMatrixInverse;',
  'varying vec2 v_TexCoord;',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * (g_PointerPosition.x + g_PointerPositionLast.y + g_ParallaxPosition.x + g_Frametime + g_PointerState.z); }',
].join('\n')
// xray 族：多声明一个 `g_PointerScale`（官方 xray.vert:8）—— 停位判据只对这种程序生效
const FRAG_XRAY = FRAG_PTR.replace('uniform sampler2D g_Texture0;', 'uniform sampler2D g_Texture0;\nuniform float g_PointerScale;')
const FRAG_PLAIN = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const resolverFrag = (frag) => async (rel) => (rel.endsWith('.vert') ? VERT : frag)
const mkEffect = (shader, passes) => ({ file: 'fx_' + shader, visible: true,
  passes: new Array(passes || 1).fill(0).map(() => ({ combos: {}, textures: [null] })), fbos: [],
  materialPasses: new Array(passes || 1).fill(0).map((_, i) => ({ shader: shader + (i ? '_p' + i : ''), blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} })) })
const mkLayer = (extra) => Object.assign({ id: 1, name: '层', visible: true, solid: false, isContainer: false,
  textureName: 'tex_a', size: [1920, 1080], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center',
  color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined, effects: [], particle: null, particleDef: null,
  parallaxDepth: null, uvRect: undefined }, extra)
const mkScene = (layers, general) => ({ general: Object.assign({ orthogonalprojection: { width: 1920, height: 1080 } }, general || {}), camera: null, layers, properties: {} })
const TEXTURES = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 64, height: 64 }]])
const IDENT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const eq = (a, b, eps) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= (eps === undefined ? 1e-6 : eps))
const lastW = (rec, name) => { const w = rec.uniWrites.filter((x) => x.name === name); return w.length ? w[w.length - 1].v : null }
const allW = (rec, name) => rec.uniWrites.filter((x) => x.name === name).map((x) => x.v)

/** 让 mock 的 `uniform*` 台账按"程序级最后一次写入"折叠成一张表（跨 pass 对比用）。 */
function lastByProgram(lib_unused, rec) { return null }

// ═════════════════════════ 被测 suite（可对变异副本重跑：lib 由参数注入）════════════════════════
async function suite(lib, tag) {
  const checks = []
  const push = (name, ok, detail) => checks.push({ name: (tag && tag !== 'repo' ? tag + '｜' : '') + name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  const mkRenderer = (frag, extraOpts) => {
    const { gl, rec } = mkGL()
    const opts = Object.assign({ shaderResolver: resolverFrag(frag), onLog: () => {} }, extraOpts || {})
    const r = lib.createRenderer({ getContext: () => gl }, opts)
    return { r, rec, opts }
  }
  const W = 1920, H = 1080                       // 画布 = 设计画布 ⇒ 满幅层的层 UV == 画布归一（恒等分支）
  const setPtr = (x, y, buttons) => { globalThis.__mpwPointer = (buttons === undefined) ? { x, y } : { x, y, buttons } }
  const clrPtr = () => { delete globalThis.__mpwPointer }

  // ── A official 档（缺省 = 开）────────────────────────────────────────────────────────
  {
    clrPtr()
    const { r, rec } = mkRenderer(FRAG_PTR)
    const eff = mkEffect('fxptr')
    const scene = mkScene([mkLayer({ effects: [eff] })])
    setPtr(1536, 216)                            // 设计坐标 = (0.8, 0.2) × 画布 1920×1080
    await r.render(scene, TEXTURES, W, H, 0.5)   // 第一帧：dt 首帧 = 1/60（同上游初值）
    const pos = lastW(rec, 'g_PointerPosition')
    push('A1 ★official：「官方 shader 声明了的」pass 真的收到 g_PointerPosition，且满幅层上 == 画布归一 (0.8,0.2)',
      eq(pos, [0.8, 0.2]), 'pos=' + JSON.stringify(pos))
    push('A2 ★official：g_PointerPosition ≠ (0,0)（改动前恒 (0,0)）', !!pos && !eq(pos, [0, 0]), JSON.stringify(pos))
    push('A3 official：g_PointerPositionLast 首帧 = 当前值（无假位移，上游 renderer.js:819-822 的 `p ? p.lastU : 0.5`）',
      eq(lastW(rec, 'g_PointerPositionLast'), [0.8, 0.2]), JSON.stringify(lastW(rec, 'g_PointerPositionLast')))
    push('A4 official：g_Frametime 首帧 = 1/60（上游 renderer.js:659 初值）',
      Math.abs(lastW(rec, 'g_Frametime') - 1 / 60) < 1e-9, JSON.stringify(lastW(rec, 'g_Frametime')))
    push('A5 official：g_ParallaxPosition 缺省 = 画布中心 (0.5,0.5)（视差未开 ⇒ depthparallax 零偏移）',
      eq(lastW(rec, 'g_ParallaxPosition'), [0.5, 0.5]), JSON.stringify(lastW(rec, 'g_ParallaxPosition')))
    push('A6 official：g_PointerState = (u,v,左键?1:0,0)，无按键时 z=0',
      eq(lastW(rec, 'g_PointerState'), [0.8, 0.2, 0, 0]), JSON.stringify(lastW(rec, 'g_PointerState')))
    push('A7 ★official：ETVP 与 ETVPInverse 都写成单位阵（lwe-ref CPass.cpp:881-882 同口径）',
      eq(lastW(rec, 'g_EffectTextureProjectionMatrix'), IDENT4) && eq(lastW(rec, 'g_EffectTextureProjectionMatrixInverse'), IDENT4),
      JSON.stringify(lastW(rec, 'g_EffectTextureProjectionMatrixInverse')))
    // 第二帧：指针移动 + 时间前进 ⇒ last == 上一帧的 current、Pos ≠ PosLast、dt 跟着时间走
    setPtr(384, 864)                             // (0.2, 0.8)
    const nFrame1 = rec.uniWrites.length          // A10 只看第一帧的写入（第二帧指针已变）
    await r.render(scene, TEXTURES, W, H, 1.0)
    const pos2 = lastW(rec, 'g_PointerPosition'), last2 = lastW(rec, 'g_PointerPositionLast')
    push('A8 ★official：第二帧 Pos=(0.2,0.8) 且 PosLast=(0.8,0.2)=上一帧的值（帧间位移非 0 ⇒ cursorripple 起波）',
      eq(pos2, [0.2, 0.8]) && eq(last2, [0.8, 0.2]) && !eq(pos2, last2), 'pos=' + JSON.stringify(pos2) + ' last=' + JSON.stringify(last2))
    push('A9 official：第二帧 g_Frametime = 0.5（dt∈(0,1) 直取；上游 renderer.js:1897）',
      Math.abs(lastW(rec, 'g_Frametime') - 0.5) < 1e-9, JSON.stringify(lastW(rec, 'g_Frametime')))
    push('A10 official：同一帧内所有 pass 拿到的指针值一致（一次快照，逐 pass 不漂）',
      new Set(rec.uniWrites.slice(0, nFrame1).filter((w) => w.name === 'g_PointerPosition').map((w) => JSON.stringify(w.v))).size === 1
      && rec.uniWrites.slice(0, nFrame1).filter((w) => w.name === 'g_PointerPosition').length >= 1,
      JSON.stringify(allW(rec, 'g_PointerPosition')))
    // dt 钳制：跳 5s ⇒ 0.1；同一时间重复 ⇒ 0.001（上游同一行的 `Math.min(0.1, Math.max(0.001, …))`）
    await r.render(scene, TEXTURES, W, H, 6.0)
    const dtJump = lastW(rec, 'g_Frametime')
    await r.render(scene, TEXTURES, W, H, 6.0)
    const dtZero = lastW(rec, 'g_Frametime')
    push('A11 official：帧时间钳制：跳 5s ⇒ 0.1（上限）、同刻重复 ⇒ 1/60（上游 `dt || 1/60` 的 0 分支）',
      Math.abs(dtJump - 0.1) < 1e-9 && Math.abs(dtZero - 1 / 60) < 1e-9, 'jump=' + dtJump + ' repeat=' + dtZero)
    // 按键
    setPtr(1536, 216, 1)
    await r.render(scene, TEXTURES, W, H, 6.1)
    const stDown = lastW(rec, 'g_PointerState')
    setPtr(1536, 216, 0)
    await r.render(scene, TEXTURES, W, H, 6.2)
    const stUp = lastW(rec, 'g_PointerState')
    push('A12 ★official：g_PointerState.z 跟注入 buttons 走（1 = 左键按下 ⇒ cursorripple 点击冲量；0 = 松开）',
      eq(stDown, [0.8, 0.2, 1, 0]) && eq(stUp, [0.8, 0.2, 0, 0]), JSON.stringify(stDown) + ' → ' + JSON.stringify(stUp))
    const st = r.ptrFxStats
    push('A13 official：台账 ptrFxStats 如实（mode=official、有指针帧、写入次数 > 0、上一帧值）',
      st.mode === 'official' && st.pointerFrames >= 5 && st.uniformWrites > 0 && eq(st.lastPointer, [0.8, 0.2]),
      JSON.stringify({ mode: st.mode, frames: st.frames, pf: st.pointerFrames, w: st.uniformWrites }))
    clrPtr()
  }

  // ── A2 小层：画布归一 → **层 UV** 的换算真的生效（不是恒等直通）────────────────────────
  {
    clrPtr()
    // 半幅层（960×540，锚在画布左上象限）⇒ 层 UV 与画布归一必然不同
    const layer = mkLayer({ size: [960, 540], origin: [480, 810, 0], effects: [mkEffect('fxsmall')] })
    const { r, rec, opts } = mkRenderer(FRAG_PTR)
    const scene = mkScene([layer])
    setPtr(1536, 216)
    await r.render(scene, TEXTURES, W, H, 0.5)
    const pos = lastW(rec, 'g_PointerPosition')
    // 独立复算（上游 renderer.js:840-848 的 toLayerU/toLayerV；framed 窗口用与生产同一套换算）
    const cam = lib.buildCamera(scene, W, H, opts)
    const fw = cam.projW, fh = cam.projH               // 画布 == 设计画布 ⇒ framed 窗口 == proj
    const offX = cam.projW / 2 - fw / 2, offY = cam.projH / 2 - fh / 2
    const lw = 960, lh = 540
    const lx = layer.origin[0] - lw / 2, ly = (cam.projH - layer.origin[1]) - lh / 2
    const exp = [(offX + 0.8 * fw - lx) / lw, (offY + 0.2 * fh - ly) / lh]
    push('A14 ★official：小层的 g_PointerPosition 走**层 UV 换算**（= 上游 toLayerU/V 独立复算值）',
      eq(pos, exp, 1e-4), 'pos=' + JSON.stringify(pos) + ' exp=' + JSON.stringify(exp))
    push('A15 换算不是恒等直通（层 UV ≠ 画布归一 (0.8,0.2) ⇒ 判据有分辨力）',
      !eq(pos, [0.8, 0.2], 1e-3), JSON.stringify(pos))
    clrPtr()
  }

  // ── A3 跨 pass 一致（两 pass 效果链）────────────────────────────────────────────────
  {
    clrPtr()
    const { r, rec } = mkRenderer(FRAG_PTR)
    const scene = mkScene([mkLayer({ effects: [mkEffect('fxa', 2), mkEffect('fxb', 2)] })])
    setPtr(1536, 216)
    await r.render(scene, TEXTURES, W, H, 0.5)
    const vals = allW(rec, 'g_PointerPosition')
    push('A16 多效果/多 pass：每一条效果链都拿到同一个指针值（4 次 pass ⇒ 4 次写入且值一致）',
      vals.length >= 4 && new Set(vals.map((v) => JSON.stringify(v))).size === 1, JSON.stringify(vals))

    // ── xray 停位（只对声明 g_PointerScale 的程序；iris/ripple 用中心）──
    const glx = mkGL()
    const fx = lib.createRenderer({ getContext: () => glx.gl }, { shaderResolver: resolverFrag(FRAG_XRAY), onLog: () => {} })
    clrPtr()                                     // **从未**收到指针
    await fx.render(mkScene([mkLayer({ effects: [mkEffect('xrayp')] })]), TEXTURES, W, H, 0.5)
    const parkPos = lastW(glx.rec, 'g_PointerPosition')
    const cam2 = lib.buildCamera(mkScene([mkLayer()]), W, H, {})
    push('A17 ★official：xray 族（声明 g_PointerScale）未收到指针时停到画布外（上游 renderer.js:283-300 / :816-822）',
      !!parkPos && (parkPos[0] < -0.5 || parkPos[0] > 1.5) && (parkPos[1] < -0.5 || parkPos[1] > 1.5),
      'pos=' + JSON.stringify(parkPos))
    // 收到指针后不再停位
    setPtr(1536, 216)
    await fx.render(mkScene([mkLayer({ effects: [mkEffect('xrayp')] })]), TEXTURES, W, H, 0.6)
    const unPark = lastW(glx.rec, 'g_PointerPosition')
    push('A18 official：收到指针后 xray 不再停位（回到真实层 UV）', eq(unPark, [0.8, 0.2]), JSON.stringify(unPark))
    push('A19 official：台账记了停位帧（parkFrames ≥ 1）', fx.ptrFxStats.parkFrames >= 1, JSON.stringify(fx.ptrFxStats.parkFrames))
    clrPtr()
  }

  // ── A4 视差位置真的跟 parallaxState 走（假 window + mousemove）────────────────────────
  {
    clrPtr()
    const savedWin = globalThis.window
    const handlers = []
    globalThis.window = { innerWidth: 1000, innerHeight: 500,
      addEventListener: (t, f) => handlers.push({ t, f }), removeEventListener: () => {} }
    try {
      const { r, rec } = mkRenderer(FRAG_PTR, { parallaxOff: false })
      const scene = mkScene([mkLayer({ effects: [mkEffect('fxpar')] })], { cameraparallax: true, cameraparallaxamount: 0.5 })
      await r.render(scene, TEXTURES, W, H, 0.5)
      push('A20 official：视差未动时 g_ParallaxPosition = 中心 (0.5,0.5)',
        eq(lastW(rec, 'g_ParallaxPosition'), [0.5, 0.5]), JSON.stringify(lastW(rec, 'g_ParallaxPosition')))
      const mm = handlers.find((h) => h.t === 'mousemove')
      push('A21 official：`?parallax=1` 档会挂 mousemove（attachParallaxListener 生效，假 DOM 可观测）', !!mm)
      if (mm) mm.f({ clientX: 800, clientY: 100 })
      await r.render(scene, TEXTURES, W, H, 0.6)
      push('A22 ★official：g_ParallaxPosition 跟着视差状态走 → (0.8,0.2)（issue #5 的"视差壁纸根本不动"）',
        eq(lastW(rec, 'g_ParallaxPosition'), [0.8, 0.2]), JSON.stringify(lastW(rec, 'g_ParallaxPosition')))
    } finally {
      if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin
    }
  }

  // ── B legacy 档（?ptrfx=legacy）：逐位回到改动前 ─────────────────────────────────────
  const LEGACY_MAP = {}
  {
    clrPtr()
    const savedLoc = globalThis.location
    globalThis.location = { search: '?ptrfx=legacy' }
    let r1, rec1, r2, rec2
    try {
      const a = mkRenderer(FRAG_PTR); r1 = a.r; rec1 = a.rec
      const scene = mkScene([mkLayer({ effects: [mkEffect('fxleg')], id: 2 })])
      setPtr(1536, 216)
      await r1.render(scene, TEXTURES, W, H, 0.5)
      setPtr(384, 864)
      await r1.render(scene, TEXTURES, W, H, 1.0)
      // 第二次：**同进程新渲染器**，指针与时间都不同
      const b = mkRenderer(FRAG_PTR); r2 = b.r; rec2 = b.rec
      clrPtr()
      await r2.render(mkScene([mkLayer({ effects: [mkEffect('fxleg')] })]), TEXTURES, W, H, 9.0)
    } finally {
      if (savedLoc === undefined) delete globalThis.location; else globalThis.location = savedLoc
    }
    clrPtr()
    push('B1 ★legacy：g_PointerPosition 恒 (0,0)（即使注入了 (0.8,0.2)/(0.2,0.8)）',
      eq(lastW(rec1, 'g_PointerPosition'), [0, 0]), JSON.stringify(lastW(rec1, 'g_PointerPosition')))
    push('B2 ★legacy：g_PointerPositionLast 恒 (0,0)', eq(lastW(rec1, 'g_PointerPositionLast'), [0, 0]), JSON.stringify(lastW(rec1, 'g_PointerPositionLast')))
    const NEW6 = ['g_PointerState', 'g_Frametime', 'g_ParallaxPosition', 'g_EffectTextureProjectionMatrix', 'g_EffectTextureProjectionMatrixInverse']
    const wroteNew = NEW6.filter((n) => rec1.uniWrites.some((w) => w.name === n))
    push('B3 ★legacy：其余 5 个新名字**一个都没写**（程序声明了它们 ⇒ 值保持 GL 初值 0 = 改动前）',
      wroteNew.length === 0, '误写=' + JSON.stringify(wroteNew))
    // ①`g_Time` 是**改动前就有**的每帧时间 uniform，本就随时间变；本判据只钉"指针类"uniform 与指针/帧时间无关
    const fp = (rec) => [...new Set(rec.uniWrites.filter((w) => w.name !== 'g_Time').map((w) => w.name + '=' + JSON.stringify(w.v)))].sort().join(';')
    push('B4 ★legacy：legacy 台账与指针/帧时间**无关**（两次不同指针+时间的运行，除既有 g_Time 外逐位相同）',
      fp(rec1) === fp(rec2), 'len=' + rec1.uniWrites.length + '/' + rec2.uniWrites.length)
    for (const k of Object.keys(LEGACY_MAP)) delete LEGACY_MAP[k]
    LEGACY_MAP.fp = fp(rec1)
    // 与 official 档逐键对比：只允许 7 个新名字不同
    const gl2 = mkGL()
    const off = lib.createRenderer({ getContext: () => gl2.gl }, { shaderResolver: resolverFrag(FRAG_PTR), onLog: () => {} })
    setPtr(1536, 216)
    await off.render(mkScene([mkLayer({ effects: [mkEffect('fxleg')] })]), TEXTURES, W, H, 0.5)
    const byName = (rec) => { const m = new Map(); for (const w of rec.uniWrites) m.set(w.name, JSON.stringify(w.v)); return m }
    const mo = byName(gl2.rec), ml = byName(rec1)
    const diff = []
    for (const k of new Set([...mo.keys(), ...ml.keys()])) if (mo.get(k) !== ml.get(k)) diff.push(k)
    const allowed = ['g_PointerPosition', 'g_PointerPositionLast', ...NEW6]
    const unexpected = diff.filter((k) => !allowed.includes(k))
    push('B5 ★official↔legacy 逐键对比：**只有** 7 个新名字有差异，其余每个 uniform 逐位相同',
      unexpected.length === 0, '意外差异=' + JSON.stringify(unexpected) + ' 差异键=' + JSON.stringify(diff.sort()))
    clrPtr()
  }

  // ── B2 无指针通道：中心（官方缺省）而不是角上；且 current==last（无假位移）────────────
  {
    clrPtr()
    globalThis.location = undefined
    const { r, rec } = mkRenderer(FRAG_PTR)
    await r.render(mkScene([mkLayer({ effects: [mkEffect('fxnone')] })]), TEXTURES, W, H, 0.5)
    delete globalThis.location
    push('B6 official：从未收到指针 ⇒ g_PointerPosition = 中心 (0.5,0.5)（上游 `p ? p.u : 0.5`；不是角上）',
      eq(lastW(rec, 'g_PointerPosition'), [0.5, 0.5]), JSON.stringify(lastW(rec, 'g_PointerPosition')))
    push('B7 official：无指针时 Pos == PosLast（帧间位移恒 0 ⇒ 不会拉出假波纹）',
      eq(lastW(rec, 'g_PointerPosition'), lastW(rec, 'g_PointerPositionLast')), JSON.stringify([lastW(rec, 'g_PointerPosition'), lastW(rec, 'g_PointerPositionLast')]))
    push('B8 official：台账 pointerFrames 不增长（诚实地记"这帧没有指针"）', r.ptrFxStats.pointerFrames === 0, JSON.stringify(r.ptrFxStats.pointerFrames))
    clrPtr()
  }
  return checks
}

// ═════════════════════════ 主跑（真模块）════════════════════════
const lib = await import('../core/we-scene-bundle.js')
const results = await suite(lib, 'repo')
let passN = 0, failN = 0
for (const c of results) { if (c.ok) { passN++; console.log('  ✓ ' + c.name + (c.detail ? '  [' + c.detail + ']' : '')) } else { failN++; console.log('  ✗ ' + c.name + ' — ' + c.detail) } }

// ═════════════════════════ C 官方资产证据（缺资产 ⇒ SKIP，不红）════════════════════════
console.log('\n[C] 官方资产证据（wallpaper_engine/assets/effects/**）')
{
  const FX = path.join(MPW_WS, 'wallpaper_engine', 'assets', 'effects')
  const need = [
    ['cursorripple/shaders/effects/cursorripple_apply_force.vert', ['g_PointerPosition', 'g_PointerPositionLast', 'g_EffectTextureProjectionMatrixInverse']],
    ['cursorripple/shaders/effects/cursorripple_apply_force.frag', ['g_PointerState', 'g_Frametime']],
    ['depthparallax/shaders/effects/depthparallax.vert', ['g_ParallaxPosition', 'g_EffectTextureProjectionMatrixInverse']],
    ['xray/shaders/effects/xray.vert', ['g_PointerPosition', 'g_EffectTextureProjectionMatrixInverse', 'g_PointerScale']],
    ['fluidsimulation/shaders/effects/fluidsimulation_vorticity.vert', ['g_PointerPosition', 'g_PointerPositionLast']],
  ]
  if (!fs.existsSync(FX)) console.log('  SKIP 无官方资产（' + FX + '）')
  else {
    let hit = 0
    for (const [rel, names] of need) {
      const p = path.join(FX, rel)
      if (!fs.existsSync(p)) { console.log('  SKIP 缺 ' + rel); continue }
      const src = fs.readFileSync(p, 'utf8')
      const miss = names.filter((n) => !new RegExp('uniform\\s+\\w+\\s+' + n + '\\b').test(src))
      const use = names.filter((n) => (src.split(n).length - 1) > 1)
      if (miss.length === 0 && use.length > 0) hit++
      const nm = 'C1 官方 ' + rel.split('/')[0] + '：声明并真的使用 ' + names.join('/')
      if (miss.length === 0 && use.length > 0) { passN++; console.log('  ✓ ' + nm) } else { failN++; console.log('  ✗ ' + nm + ' — 未声明=' + JSON.stringify(miss) + ' 未使用=' + JSON.stringify(names.filter((n) => !use.includes(n)))) }
    }
    if (hit === need.length) { passN++; console.log('  ✓ C2 ★' + hit + '/' + need.length + ' 条官方效果原文同时满足「声明 + 使用」= 接线面就是官方语义') }
    else { failN++; console.log('  ✗ C2 只有 ' + hit + '/' + need.length + ' 条满足') }
  }
  // 上游参考（③，非官方）：帧时间钳制式与 xray 停位判据的原文出处
  const REF = path.join(MPW_WS, 'references', 'vendor-ref', 'webwallgl', 'renderer', 'vendor', 'we-scene', 'render', 'renderer.js')
  if (fs.existsSync(REF)) {
    const rs = fs.readFileSync(REF, 'utf8')
    const okDt = /lastFrametime\s*=\s*dt\s*>\s*0\s*&&\s*dt\s*<\s*1\s*\?\s*dt\s*:\s*Math\.min\(0\.1/.test(rs)
    const okPark = /XRAY_IDLE_SCREEN_UV\s*=\s*-1/.test(rs) && /xrayShouldParkPointer/.test(rs)
    if (okDt && okPark) { passN++; console.log('  ✓ C3 上游参考（③，MIT 副本）原文可核对：帧时间钳制式 + xray 停位判据') }
    else { failN++; console.log('  ✗ C3 上游参考原文与注释不符：dt=' + okDt + ' park=' + okPark) }
  } else console.log('  SKIP 无上游只读副本（' + REF + '）')
}

// ═════════════════════════ D 变异自证（RED-IF-REVERTED）════════════════════════
console.log('\n[D] RED-IF-REVERTED：把真源码逐条改回旧写法（副本落 /tmp，真树只读）')
{
  const SRC_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const CORE = path.dirname(SRC_FILE)
  const SRC = fs.readFileSync(SRC_FILE, 'utf8')
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  const PTR_SET = "      setVal(uni, 'g_PointerPosition', (l) => gl.uniform2f(l, pu[0], pu[1]))"
  const mutants = [
    { label: 'M1(g_PointerPosition 回到硬编码 (0,0))', from: PTR_SET, to: "      setVal(uni, 'g_PointerPosition', (l) => gl.uniform2f(l, 0, 0))",
      expect: (r) => r.some((c) => /^A[12]/.test(c.name.replace(/^mut｜/, '')) && !c.ok) },
    { label: 'M2(legacy 档也写新 uniform)', from: "    if (PTRFX_MODE === 'legacy') {", to: '    if (false) {',
      expect: (r) => r.some((c) => /^B[13]/.test(c.name.replace(/^mut｜/, '')) && !c.ok) },
    { label: 'M3(不调用 __fxPtrFrame ⇒ 指针/帧时间永不推进)', from: '    __fxPtrFrame(cam, time)\n', to: '',
      expect: (r) => r.some((c) => /^A[148]/.test(c.name.replace(/^mut｜/, '')) && !c.ok) },
  ]
  for (const mu of mutants) {
    if (!SRC.includes(mu.from)) { failN++; console.log('  ✗ ' + mu.label + ' 变异锚点不在源码里'); continue }
    const body = SRC.replace(mu.from, mu.to)
    const tmp = path.join(os.tmpdir(), 'ptrfx-mut-' + mu.label.replace(/[^A-Za-z0-9]/g, '') + '.mjs')
    fs.rmSync(tmp, { force: true })
    fs.writeFileSync(tmp, body.replace(/from '\.\//g, "from '" + CORE + '/'))
    let red = false, detail = ''
    try {
      const mm = await import('file://' + tmp + '?v=' + Date.now())
      const res = await suite(mm, 'mut')
      red = mu.expect(res)
      const bad = res.filter((c) => !c.ok).map((c) => c.name.replace(/^mut｜/, ''))
      detail = '变红断言 ' + bad.length + ' 条：' + bad.slice(0, 4).join(' / ')
    } catch (e) { detail = '变异体抛错：' + String(e && e.message).slice(0, 140) }
    finally { fs.rmSync(tmp, { force: true }) }
    console.log('  RED ' + (red ? '变异生效' : '变异**没红**') + '｜' + mu.label + '：' + detail)
    if (red) { passN++; console.log('  ✓ D ' + mu.label + ' ⇒ 对应断言变红（RED-IF-REVERTED）') }
    else { failN++; console.log('  ✗ D ' + mu.label + ' ⇒ 断言没红') }
  }
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^ptrfx-mut-.*\.mjs$/.test(f))
  const same = shaOf(SRC_FILE) === srcSha && leftovers.length === 0
  if (same) { passN++; console.log('  ✓ D 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（变异副本落 /tmp 且已 unlink）') }
  else { failN++; console.log('  ✗ D 真树被改动或 /tmp 有残留：sha=' + (shaOf(SRC_FILE) === srcSha) + ' 残留=' + leftovers.length) }
}

console.log('\n===== ptrfx-uniform: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
process.exit(failN ? 1 : 0)

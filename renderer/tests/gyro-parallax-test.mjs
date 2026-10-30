#!/usr/bin/env node
// gyro-parallax-test.mjs — ①(用户 2026-09-24「鼠标视差的功能在移动端设备上，比如安卓系统上，
//   它是以陀螺仪来实现视差的」) 的姿态源判据（纯 Node / 无浏览器 / 无网络 / 无 GPU / 秒级）。
//
// 被测对象是 **demo.html 里 MPW-GYRO-BEGIN/END 之间那一段真实源码**（不是本档重写的式子）：
// 本档把那段切片写成临时模块（`/tmp`）再 import —— 与 `parallax-live-test.mjs` 的"真源码切片求值"、
// `log-panel-collapse-test.mjs` 的"按 `<script id=…>` 切片跑假 DOM"是同一条纪律。
// ⚠ 为什么姿态源住在 demo.html 而不是独立模块（`core/we-gyro-source.mjs`）：`core/**` 里被浏览器
//   相对 import 的新文件要在**三处**登记（8899 路由 / `build-pages.mjs` 产物映射 / `web/sw.js` 预缓存），
//   而 `tests/core-module-wiring-test.mjs` 的 C 段是**按文件名**双向核对的 ⇒ 只加模块不改那三处必红，
//   那三处又都不在本轮的写入清单里。故实现内联在页面里（`PAGE` 门内一条接线），换来的代价是
//   本档必须切片而不是 import。
//
// ── 断言分组 ─────────────────────────────────────────────────────────────────────────
//   A 切片与静态锚点：真源码切片拿得到、片子自足（无 import/export 副作用）、开关解析没有把
//     `gyro` 暴露给 `diag-flag-check.mjs`（否则 README 开关表会对不上 ⇒ docs-check 红）；
//     以及"合成画布 pointermove 真的走 bundle 既有 `__ptrSource.pushExternal()`"的静态锚点。
//   B 姿态源（mock window/deviceorientation）：
//     ① 无事件 ⇒ `enabled:true`、uv 保持中心、计数 0、零副作用（不写注入通道、不派发事件）
//     ② 一串 beta/gamma ⇒ uv 单调跟随、clamp 在 [0,1]、事件计数正确（另有一条默认 EMA 的行为）
//     ③ 超出量程/NaN/缺字段 ⇒ 只计数，不污染 uv/last
//     ④ `?gyro=0` ⇒ **完全不监听**（一个 deviceorientation 监听都不挂）
//     ⑤ `Object.defineProperty` 不可用（`__mpwGyro` 被冻）⇒ 不抛、照样计数、失败记账
//     另：auto 语义（有鼠标不动 / 触摸才上）、无事件看门狗记账、iOS `requestPermission` 被拒记账、
//     中立位 = 首个有效读数、纯映射解析解。
//   C 桥接 → 视差/指针（真 `core/we-scene-bundle.js` + mock GL）：
//     姿态 u 变化 ⇒ `g_ParallaxPosition` 跟随、正深度层 Δx 按官方公式（−0.4·3840·0.07·3.8·0.5）、
//     深度 0 层一动不动；两条指针落点分别可测（注入通道 / 画布 pointermove→pushExternal）；
//     `?gyro=0` 时逐位不动；桥接三个 sink 计数与零 failed。
//   D 变异自证（RED-IF-REVERTED）≥3 组：把切片逐条改坏，**期望红集 == 实际红集** 才打印 MUTANT-RED-OK。
//
// 用法: node tests/gyro-parallax-test.mjs
// 退出码：0 全绿 / 1 有断言失败。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

let passN = 0, failN = 0
const redOrder = []
const fails = []
const ok = (id, name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + id + ' ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; redOrder.push(id); fails.push(id + ' ' + name); console.log('  ✗ ' + id + ' ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const V = (o) => JSON.stringify(o)
const near = (a, b, eps) => Number.isFinite(a) && Math.abs(a - b) <= (eps === undefined ? 1e-5 : eps)

// ═════════════════════════ A 真源码切片（demo.html 的 MPW-GYRO 段）═════════════════════════
console.log('[A] `demo.html` 真源码切片：MPW-GYRO-BEGIN/END')
const DEMO_FILE = path.join(ROOT, 'demo.html')
const DEMO_SHA0 = crypto.createHash('sha256').update(fs.readFileSync(DEMO_FILE)).digest('hex')
const DEMO = fs.readFileSync(DEMO_FILE, 'utf8')
const MARK_B = '// ═══ MPW-GYRO-BEGIN ═══'
const MARK_E = '// ═══ MPW-GYRO-END ═══'
const iB = DEMO.indexOf(MARK_B)
const iE = DEMO.indexOf(MARK_E)
const SLICE = (iB >= 0 && iE > iB) ? DEMO.slice(iB + MARK_B.length, iE) : ''
const GYRO_EXPORTS = ['mpwGyroClamp01', 'mpwGyroModeFrom', 'mpwGyroReadDeg', 'mpwGyroUv',
  'mpwGyroAutoDecide', 'mpwGyroNeedsPermission', 'mpwCreateGyroSource', 'mpwAttachGyroBridge']
const MOD_SRC = SLICE + '\nexport { ' + GYRO_EXPORTS.join(', ') + ' }\n'
const TMPFILES = []
async function loadMod(src, tag) {
  const f = path.join(os.tmpdir(), 'mpw-gyro-' + process.pid + '-' + tag + '.mjs')
  fs.writeFileSync(f, src)
  TMPFILES.push(f)
  return import(pathToFileURL(f).href + '?v=' + tag)
}
ok('A1', '★两个标记都在 demo.html 里、切出来的就是真源码（' + SLICE.length + ' 字节）',
  iB >= 0 && iE > iB && SLICE.length > 2000, 'BEGIN@' + iB + ' END@' + iE)
ok('A2', '★切片自足：不依赖页面里任何绑定（无 import/export、无 `lib.`/`logf`/`PAGE`/`cv` 引用）',
  !/^\s*(import|export)\b/m.test(SLICE) && !/\blib\.|\blogf\b|\bPAGE\b|\bcv\./.test(SLICE))
ok('A3', '接线锚点在页面里（PAGE 门 + 桥接调用 + 可读句柄）',
  /if \(PAGE\) \{[\s\S]{0,900}mpwAttachGyroBridge\(/.test(DEMO) && DEMO.includes('window.__mpwGyroBridge')
  && DEMO.includes('search: location.search'))
// A4：①(2026-09-24 主对话改口径) `?gyro=` **已经正式登记**进诊断开关表 ⇒ 这里改成断言**双向一致**：
//   代码里有一处 `new URLSearchParams(location.search).get('gyro')` 的**权威读点**（diag-flag-check 的抓取口径），
//   且 `docs/README-DIAGNOSTICS.md` 主表里有 `gyro` 行、`web/diag-flags.json` 里有 `gyro` 条目。
//   （原来是反过来的：断言"抓不到"以保住 docs-check 绿 —— 那是权宜；登记之后就该验一致性。）
{
  const DEMO = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  const patChain = /new\s+URLSearchParams\s*\(\s*location\.search\s*\)\s*\.\s*get\s*\(\s*['"]gyro['"]\s*\)/
  const readme = fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8')
  const flagJson = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'diag-flags.json'), 'utf8')) } catch (e) { return null } })()
  const inJson = !!(flagJson && (flagJson.flags || []).some((f) => (f && f.name) === 'gyro'))
  ok('A4', '★`?gyro=` 与诊断开关表**双向一致**：代码有权威读点 + README 有行 + diag-flags.json 有条目',
    patChain.test(DEMO) && /^\| `gyro` \|/m.test(readme) && inJson,
    'chain=' + patChain.test(DEMO) + ' readme=' + /^\| `gyro` \|/m.test(readme) + ' json=' + inJson)
}
// A5/A6：静态锚点（bundle 既有实现，本轮的实现一行都没改它）
{
  const BUNDLE = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
  ok('A5', '★静态锚点：bundle 的画布 pointermove 处理里调 `__ptrSource.pushExternal({u:p.nx,v:p.ny…})`（= 需求说的"喂进指针源"）',
    BUNDLE.includes('__ptrSource.pushExternal({ u: p.nx, v: p.ny, buttons: __pointerButtons })'))
  // A6：「`?ptrfx=` 与视差正交」这条文档口径的**静态依据**：视差支（LN100 平滑 → parDispX 累加那段）
  //   里不出现 PTRFX_MODE；而效果链那 7 个 uniform 的写入路径上有 `PTRFX_MODE === 'legacy'` 门。
  const i0 = BUNDLE.indexOf('const LN100 = Math.log(100)')
  const i1 = BUNDLE.indexOf('__renderSeq++', i0)
  const parBlock = (i0 > 0 && i1 > i0) ? BUNDLE.slice(i0, i1) : ''
  ok('A6', '★正交性依据：视差支不含 `PTRFX_MODE`（`?ptrfx=legacy` 关不掉视差），效果链写入路径有 legacy 门',
    parBlock.length > 500 && !parBlock.includes('PTRFX_MODE') && BUNDLE.includes("if (PTRFX_MODE === 'legacy') {"),
    'parBlock=' + parBlock.length + 'B 含PTRFX_MODE=' + parBlock.includes('PTRFX_MODE'))
}

// ═════════════════════════ 假 DOM / 假 GL ════════════════════════════════════════════════
function mkEventTarget() {
  const listeners = new Map()
  const t = {
    stats: { added: {}, delivered: {}, handlerErrors: 0 },
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return
      const a = listeners.get(type) || []
      if (!a.includes(fn)) a.push(fn)
      listeners.set(type, a)
      t.stats.added[type] = a.length
    },
    removeEventListener(type, fn) {
      const a = listeners.get(type)
      if (!a) return
      const i = a.indexOf(fn)
      if (i >= 0) a.splice(i, 1)
      t.stats.added[type] = a.length
    },
    dispatchEvent(ev) {
      const type = ev && ev.type
      t.stats.delivered[type] = (t.stats.delivered[type] || 0) + 1
      for (const fn of (listeners.get(type) || []).slice()) {
        try { fn(ev) } catch (e) { t.stats.handlerErrors++ }
      }
      return true
    },
    count(type) { return (listeners.get(type) || []).length },
  }
  return t
}
/** 假 window：事件目标 + 鼠标/指针/姿态事件构造器 + matchMedia + 可手动触发的 setTimeout。 */
function mkWindow(o) {
  o = o || {}
  const w = mkEventTarget()
  w.innerWidth = o.width || 1280
  w.innerHeight = o.height || 720
  w.devicePixelRatio = 1
  w.ontouchstart = null                     // 触摸设备信号（auto 判定用）
  w.navigator = { maxTouchPoints: o.touch === false ? 0 : 5, userAgent: 'mpw-gyro-test' }
  w.matchMedia = (q) => ({ matches: o.finePointer === true, media: String(q) })
  w.MouseEvent = function MouseEvent(type, init) { Object.assign(this, init || {}); this.type = type }
  w.PointerEvent = function PointerEvent(type, init) { Object.assign(this, init || {}); this.type = type }
  if (o.noApi !== true) {
    w.DeviceOrientationEvent = function DeviceOrientationEvent(type, init) { Object.assign(this, init || {}); this.type = type }
    if (typeof o.permission === 'function') w.DeviceOrientationEvent.requestPermission = o.permission
  }
  w.__timers = []
  w.setTimeout = (fn, ms) => { w.__timers.push({ fn, ms }); return w.__timers.length }
  w.clearTimeout = () => {}
  w.fire = (type, init) => w.dispatchEvent(Object.assign({ type }, init || {}))
  w.fireTimer = (ms) => { const t = w.__timers.find((x) => x.ms === ms) || w.__timers[0]; if (t) t.fn(); return !!t }
  // ① 忠实模拟本页宿主 API 块的既有行为：预建 `window.__mpwPointer = {x:0,y:0,inside:false}`
  //   （P-118 G5：显式 inside:false ⇒ `__pointerDesign` 直接判"无指针"，画布 DOM 通道被挡住）
  w.__mpwPointer = { x: 0, y: 0, inside: false }
  return w
}
/** 假画布：`framePointerMap` 的 legacy 档只用到 getBoundingClientRect。 */
function mkCanvas(w, o) {
  o = o || {}
  const c = mkEventTarget()
  c.width = o.width || 1280
  c.height = o.height || 720
  c.clientWidth = c.width
  c.clientHeight = c.height
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height, right: c.width, bottom: c.height })
  c.contains = () => true
  c.getContext = () => null
  return c
}
/** mock GL：与 `parallax-live-test.mjs` B 段同款最小实现 + `canvas`（bundle 的 `__hookPointer` 要它）。 */
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FLOAT: 0x1406, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51,
  FLOAT_VEC4: 0x8B52, INT: 0x1404, BOOL: 0x8B56, FLOAT_MAT4: 0x8B5C, FLOAT_MAT3: 0x8B5B, SAMPLER_2D: 0x8B5E }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const TYPE_OF = { float: CONST.FLOAT, int: CONST.INT, bool: CONST.BOOL, vec2: CONST.FLOAT_VEC2, vec3: CONST.FLOAT_VEC3,
  vec4: CONST.FLOAT_VEC4, mat4: CONST.FLOAT_MAT4, mat3: CONST.FLOAT_MAT3, sampler2D: CONST.SAMPLER_2D }
function mkGL(canvas) {
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
    uniform1f: (l, a) => rec.uniWrites.push({ name: l && l.n, v: a }),
    uniform1i: (l, a) => rec.uniWrites.push({ name: l && l.n, v: a }),
    uniform1fv: (l, a) => rec.uniWrites.push({ name: l && l.n, v: Array.from(a) }),
    uniform2f: (l, a, b) => rec.uniWrites.push({ name: l && l.n, v: [a, b] }),
    uniform3f: (l, a, b, c) => rec.uniWrites.push({ name: l && l.n, v: [a, b, c] }),
    uniform4f: (l, a, b, c, d) => rec.uniWrites.push({ name: l && l.n, v: [a, b, c, d] }),
    uniformMatrix4fv: (l, t, m) => rec.uniWrites.push({ name: l && l.n, v: Array.from(m || []) }),
    uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop === 'canvas') return canvas
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}

// ═════════════════════════ 合成场景 / 视差探针 ════════════════════════════════════════════
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
// 声明视差 + 指针族 uniform（= 官方 depthparallax/cursorripple/xray 的声明面）
const FRAG = [
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
const resolverFor = async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG)
const mkEffect = (shader) => ({ file: 'fx_' + shader, visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [],
  materialPasses: [{ shader: shader, blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} }] })
const mkLayer = (extra) => Object.assign({ id: 1, name: '层', visible: true, solid: false, isContainer: false,
  textureName: 'tex_bg', size: [3840, 2160], scale: [1, 1, 1], origin: [1920, 1080, 0], angles: [0, 0, 0], alignment: 'center',
  color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined, effects: [], particle: null, particleDef: null,
  parallaxDepth: null, uvRect: undefined }, extra)
/** 3840×2160 设计画布；参数取用户样本 0917/3233141951 的作者值（与 parallax-live B 段同一套）。 */
const mkScene = () => ({
  general: { orthogonalprojection: { width: 3840, height: 2160 }, cameraparallax: true,
    cameraparallaxamount: 0.5, cameraparallaxmouseinfluence: 0.07, cameraparallaxdelay: 0.1 },
  camera: null, properties: {},
  layers: [
    mkLayer({ id: 1, name: '背景', parallaxDepth: [3.8, 4.2], effects: [mkEffect('fxpar')] }),
    mkLayer({ id: 2, name: '零深度', parallaxDepth: [0, 0], textureName: 'tex_fg' }),
  ],
})
const TEXTURES = new Map([['tex_bg', { glTex: { id: 't_bg' }, width: 64, height: 64 }],
  ['tex_fg', { glTex: { id: 't_fg' }, width: 64, height: 64 }]])
const NDC2PX = 1920                    // NDC → 设计像素（projW/2 = 3840/2）
const EXP_DX = -0.4 * 3840 * 0.07 * 3.8 * 0.5   // = −204.288（官方 (0.5−mouse)∘depth×amount）
// 真渲染器：**在设 `globalThis.location` 之前** import（bundle 的档位常量在模块装载期读 location，
// Node 下没有 location ⇒ 取缺省档：framegeom=legacy / 不关指针 / ptrfx=official —— 正是本档要的）。
const bundle = await import('../core/we-scene-bundle.js')

/**
 * 姿态 → 视差/指针 的端到端探针（真 bundle + mock GL；姿态走**真**假 window 事件）。
 * @param mod 被姿态源模块（真切片或变异体）
 * @param o `search`/`sinks`/`cfg`/`center`/`gamma`/`beta`/`pose`/`tilt`
 */
async function probe(mod, o) {
  o = o || {}
  const win = mkWindow(o)
  const canvas = mkCanvas(win)
  const { gl, rec } = mkGL(canvas)
  const saved = { w: globalThis.window, l: globalThis.location }
  globalThis.window = win
  /* ①(2026-09-24 口径修正) `?gyro` 缺省已改成**不启用** ⇒ 这组"测姿态源机制"的用例显式给 `gyro=1`
     （`o.search === undefined` 时默认开启；要测缺省/关闭的用例自己传 `''` 或 `'?gyro=0'`）。 */
  const qs = (o.search === undefined) ? 'gyro=1' : o.search
  globalThis.location = { search: qs, href: 'http://localhost/demo.html' + qs }
  const lines = []
  try {
    const reads = {}
    const r = bundle.createRenderer({ getContext: () => gl, width: 1280, height: 720 }, {
      shaderResolver: resolverFor, onLog: () => {}, parallaxOff: o.parallaxOff === undefined ? false : o.parallaxOff,
      onLayerDraw: (layer, info) => { reads[String(layer.name)] = [info.mvp[12], info.mvp[13]] },
    })
    const bridge = mod.mpwAttachGyroBridge({
      win: win, canvas: canvas, getProjSize: () => [3840, 2160], search: qs,
      cfg: o.cfg, center: o.center, log: (m) => lines.push(m), sinks: o.sinks,
    })
    const scene = mkScene()
    let t = 0
    const step = async (n) => { for (let i = 0; i < n; i++) { t += 1 / 60; await r.render(scene, TEXTURES, 1280, 720, t) } }
    /** 喂 n 个**同一个**姿态读数（默认 20 个：让页面默认的 EMA 平滑收敛到稳态，测量才可比）。 */
    const pose = (beta, gamma, n) => { for (let i = 0; i < (n || 40); i++) win.fire('deviceorientation', { alpha: 0, beta: beta, gamma: gamma }) }
    await step(2)
    const p0 = V(reads)
    if (o.pose !== false) {
      pose(0, 0)                       // 首个有效读数 = 中立位（uv 应停在中心）
      await step(2)
    }
    const p1 = V(reads)
    if (o.tilt !== false) {
      pose(o.beta || 0, o.gamma === undefined ? 24 : o.gamma)
      /* ①(2026-09-24 视差对齐官方后) 平滑从旧的指数式（k≈0.536/帧）换成官方闭式

         `k = min(1,(1−delay/3)·10·dt)`（delay=0.1、60fps ⇒ **0.1611**）⇒ 24 帧只剩 1.45% 残余

         （实测偏差 3.014px，与 204.288×1.45%=2.96px 吻合）。这里把收敛窗口按**新 k** 放宽到 60 帧，

         而判据本身（Δx 必须等于 −204.288）不放宽。 */

      await step(60)   // 官方 k≈0.1611/帧 ⇒ 60 帧后残余 <1e-4
    }
    const p2 = V(reads)
    const lastW = (name) => { const w = rec.uniWrites.filter((x) => x.name === name); return w.length ? w[w.length - 1].v : null }
    return {
      win, canvas, rec, bridge, reads, p0, p1, p2, lines, uni: lastW,
      ndcX: (n) => (reads[n] ? reads[n][0] : NaN),
      dx: (n) => (reads[n] ? reads[n][0] : NaN) * NDC2PX,
    }
  } finally {
    if (saved.w === undefined) delete globalThis.window; else globalThis.window = saved.w
    if (saved.l === undefined) delete globalThis.location; else globalThis.location = saved.l
  }
}

// ═════════════════════════ 被测 suite（可对变异副本重跑）═════════════════════════════════
async function suite(mod) {
  const res = []              // { id, name, ok, detail }
  const push = (id, name, cond, detail) => res.push({ id, name, ok: !!cond, detail: String(detail === undefined ? '' : detail) })

  // ── B1 ① 无事件 ─────────────────────────────────────────────────────────────────
  {
    const win = mkWindow({})
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=auto', log: () => {} })
    src.start()
    const st = src.state
    push('B1', '①无事件（?gyro=auto）⇒ enabled=true、uv 保持中心 (0.5,0.5)、events=0、applied=0、零副作用',
      st.enabled === true && st.mode === 'auto' && st.why === 'auto:touch' && st.uv.u === 0.5 && st.uv.v === 0.5
      && st.events === 0 && st.applied === 0 && st.invalid === 0 && st.ignored === 0
      && win.count('deviceorientation') === 1 && win.count('deviceorientationabsolute') === 1
      && win.__mpwPointer.inside === false && win.__mpwPointer.x === 0
      && win.stats.delivered.mousemove === undefined && win.stats.delivered.pointermove === undefined
      && win.__mpwGyro === st,
      'enabled=' + st.enabled + ' why=' + st.why + ' uv=' + V(st.uv) + ' listeners=' + st.listeners
      + ' 注入=' + V(win.__mpwPointer) + ' 派发=' + V(win.stats.delivered))
  }
  // ── B2 ② gamma ⇒ u 单调 + clamp ─────────────────────────────────────────────────
  {
    const win = mkWindow({})
    const sinkCalls = []
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=1', cfg: { smooth: 1 }, log: () => {},
      onUv: (u, v) => sinkCalls.push([u, v]) })
    src.start()
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 0 })
    const us = []
    for (const g of [6, 12, 18, 24]) { win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: g }); us.push(src.state.uv.u) }
    const mono = us.every((u, i) => i === 0 ? u > 0.5 : u > us[i - 1])
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 80 })
    const hi = src.state.uv.u
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: -80 })
    const lo = src.state.uv.u
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 90 })
    const top = src.state.uv.u
    push('B2', '②gamma 递增 ⇒ u 单调跟随（0.6/0.7/0.8/0.9）、±80° 被 clamp 在 [0,1]、events 计数正确',
      mono && us[0] === 0.6 && us[3] === 0.9 && hi === 1 && lo === 0 && top === 1
      && src.state.events === 8 && src.state.applied === 8 && sinkCalls.length === 8,
      'us=' + V(us) + ' hi=' + hi + ' lo=' + lo + ' events=' + src.state.events + ' applied=' + src.state.applied)
  }
  // ── B3 ② beta ⇒ v 单调 + clamp（轴不能互换）──────────────────────────────────────
  {
    const win = mkWindow({})
    const sinkCalls = []
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=1', cfg: { smooth: 1 }, log: () => {},
      onUv: (u, v) => sinkCalls.push([u, v]) })
    src.start()
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 0 })
    const vs = []
    for (const b of [6, 12, 18, 24]) { win.fire('deviceorientation', { alpha: 0, beta: b, gamma: 0 }); vs.push(src.state.uv.v) }
    const mono = vs.every((v, i) => i === 0 ? v > 0.5 : v > vs[i - 1])
    win.fire('deviceorientation', { alpha: 0, beta: 180, gamma: 0 })
    const hi = src.state.uv.v
    win.fire('deviceorientation', { alpha: 0, beta: -180, gamma: 0 })
    const lo = src.state.uv.v
    push('B3', '②beta 递增 ⇒ v 单调跟随（0.6/0.7/0.8/0.9）、±180° 被 clamp（gamma 不参与 v）',
      mono && vs[3] === 0.9 && hi === 1 && lo === 0 && src.state.uv.u === 0.5 && sinkCalls.length === 7,   // 7 发有效读数：中立位 1 + 4 + ±180 2
      'vs=' + V(vs) + ' hi=' + hi + ' lo=' + lo + ' u=' + src.state.uv.u + ' applied=' + src.state.applied)
  }
  // ── B4 ③ 无效读数不污染状态 ─────────────────────────────────────────────────────
  {
    const win = mkWindow({})
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=1', cfg: { smooth: 1 }, log: () => {} })
    src.start()
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 0 })
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 12 })
    const snap = V({ uv: src.state.uv, last: src.state.last })
    const bad = [{ beta: NaN, gamma: 0 }, { beta: 0, gamma: NaN }, { beta: null, gamma: null }, { beta: 0, gamma: null },
      { alpha: 0 }, { beta: 0, gamma: 91 }, { beta: 181, gamma: 0 }, { beta: -181, gamma: 0 },
      { beta: Infinity, gamma: 0 }, { beta: 'x', gamma: 0 }]
    for (const e of bad) win.fire('deviceorientation', e)
    push('B4', '③NaN/缺字段/超量程（共 ' + bad.length + ' 发）⇒ 只计数，uv 与 last 逐位不被污染、events 不虚增',
      src.state.invalid === bad.length && V({ uv: src.state.uv, last: src.state.last }) === snap && src.state.events === 2,
      'invalid=' + src.state.invalid + ' events=' + src.state.events + ' 污染=' + (V({ uv: src.state.uv, last: src.state.last }) !== snap))
  }
  // ── B5 ④ ?gyro=0 完全不监听 ─────────────────────────────────────────────────────
  {
    const win = mkWindow({})
    const src = mod.mpwCreateGyroSource({ win: win, search: '?gyro=0', log: () => {} })
    src.start()
    const direct = src.feed({ alpha: 0, beta: 10, gamma: 10 })
    push('B5', '④`?gyro=0` ⇒ mode=off、一个监听都不挂、喂进来的读数也进不去（ignored 记账）',
      src.mode === 'off' && src.state.enabled === false && src.state.why === 'mode-off'
      && win.count('deviceorientation') === 0 && win.count('deviceorientationabsolute') === 0 && src.state.listeners === 0
      && direct === false && src.state.events === 0 && src.state.ignored === 1 && src.state.uv.u === 0.5
      && win.__mpwPointer.inside === false,
      'listeners=' + src.state.listeners + ' events=' + src.state.events + ' ignored=' + src.state.ignored)
  }
  // ── B6 ⑤ defineProperty 不可用（__mpwGyro 被冻）⇒ 不抛 ────────────────────────────
  {
    const win = mkWindow({})
    Object.defineProperty(win, '__mpwGyro', { value: null, writable: false, configurable: false })
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=1', cfg: { smooth: 1 }, log: () => {} })
    let threw = null
    try {
      src.start()
      win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 0 })
      win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 12 })
    } catch (e) { threw = (e && e.message) || String(e) }
    push('B6', '⑤状态发布不可用（`__mpwGyro` 不可配置不可写）⇒ 不抛、事件照常计数、失败如实记账',
      threw === null && src.state.events === 2 && src.state.uv.u === 0.7
      && (src.state.publishFailures + src.state.publishFallbacks) >= 1,
      'threw=' + V(threw) + ' events=' + src.state.events + ' pubFail=' + src.state.publishFailures + '/' + src.state.publishFallbacks)
  }
  // ── B7/B8 auto 语义 ─────────────────────────────────────────────────────────────
  {
    const wFine = mkWindow({ finePointer: true })
    const sFine = mod.mpwCreateGyroSource({ win: wFine, search: 'gyro=auto', log: () => {} })
    sFine.start()
    const wTouch = mkWindow({})
    const sTouch = mod.mpwCreateGyroSource({ win: wTouch, search: 'gyro=auto', log: () => {} })
    sTouch.start()
    push('B7', 'auto：有细指针（`pointer: fine` = 鼠标/触控板）⇒ 不启用、不挂监听、不碰注入通道、why 记账',
      sFine.state.enabled === false && sFine.state.why === 'auto:fine-pointer' && sFine.state.listeners === 0
      && wFine.count('deviceorientation') === 0 && wFine.__mpwPointer.inside === false)
    push('B8', 'auto：触摸设备（maxTouchPoints>0）⇒ 启用、why=auto:touch（= 手机上"什么都不用加"就能用）',
      sTouch.state.enabled === true && sTouch.state.why === 'auto:touch' && sTouch.state.listeners === 2
      && sTouch.state.supported === true)
    /* ①(2026-09-24 口径修正) **缺省 = 不启用**：项目所有者明确"陀螺仪只是讲实现方式的区别" ⇒ 默认一个监听都不挂。 */
    const wDef = mkWindow({})
    const sDef = mod.mpwCreateGyroSource({ win: wDef, search: '', log: () => {} })
    sDef.start()
    push('B14', '缺省（不带 ?gyro）⇒ 不启用、0 监听、不碰注入通道、why=off:default（桌面/手机都不做陀螺仪，显式 ?gyro=1|auto 才开）',
      sDef.state.enabled === false && sDef.state.mode === 'off' && sDef.state.listeners === 0
      && wDef.count('deviceorientation') === 0 && wDef.__mpwPointer.inside === false
      && /off/.test(String(sDef.state.why)),
      'mode=' + sDef.state.mode + ' why=' + sDef.state.why + ' listeners=' + sDef.state.listeners)
  }
  // ── B9 无事件看门狗（如实记账，不静默）───────────────────────────────────────────
  {
    const win = mkWindow({})
    const lines = []
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=1', log: (m) => lines.push(m) })
    src.start()
    const fired = win.fireTimer(3000)
    push('B9', '不是传感器设备 / 没有事件 ⇒ 到点记一条 + `why=no-events` + `noEvents` 位（一行日志，不静默、不抛）',
      fired && src.state.noEvents === true && src.state.why === 'no-events' && lines.length >= 2
      && /0 个有效事件/.test(lines[lines.length - 1] || ''),
      'timers=' + win.__timers.length + ' timerMs=' + (win.__timers[0] && win.__timers[0].ms) + ' logs=' + lines.length)
  }
  // ── B10 iOS 13+ requestPermission：有就请求、被拒只记账 ──────────────────────────
  {
    const wDeny = mkWindow({ permission: () => Promise.resolve('denied') })
    const sDeny = mod.mpwCreateGyroSource({ win: wDeny, search: 'gyro=1', log: () => {} })
    sDeny.start()
    const beforeListeners = wDeny.count('deviceorientation')
    const rDeny = await sDeny.requestPermission()
    const wGrant = mkWindow({ permission: () => Promise.resolve('granted') })
    const sGrant = mod.mpwCreateGyroSource({ win: wGrant, search: 'gyro=1', log: () => {} })
    sGrant.start()
    const rGrant = await sGrant.requestPermission()
    push('B10', 'iOS 13+：有 `requestPermission` 才请求（手势里挂着）；granted ⇒ 挂监听，denied ⇒ 记账不抛',
      sDeny.state.permission === 'denied' && rDeny === 'denied' && beforeListeners === 0
      && sDeny.state.gestureArmed === true && sDeny.state.enabled === true
      && rGrant === 'granted' && sGrant.state.permission === 'granted' && wGrant.count('deviceorientation') === 1)
  }
  // ── B11 中立位 = 首个有效读数 ────────────────────────────────────────────────────
  {
    const win = mkWindow({})
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=1', cfg: { smooth: 1 }, log: () => {} })
    src.start()
    win.fire('deviceorientation', { alpha: 0, beta: 40, gamma: -15 })      // 手机竖着拿（beta=40）也从中立位起
    const first = { uv: src.state.uv, center: src.state.center }
    win.fire('deviceorientation', { alpha: 0, beta: 40, gamma: 0 })
    push('B11', '中立位 = 首个有效读数（手机怎么拿都从中心起，只跟相对偏转）',
      first.uv.u === 0.5 && first.uv.v === 0.5 && first.center.beta === 40 && first.center.gamma === -15
      && first.center.source === 'first-event' && src.state.uv.u === 0.75 && src.state.uv.v === 0.5,
      'first=' + V(first) + ' 之后=' + V(src.state.uv))
  }
  // ── B12 纯映射解析解（含轴不互换、clamp、无效）────────────────────────────────────
  {
    const t = (b, g, c) => mod.mpwGyroUv(b, g, c)
    const ctr = { beta: 0, gamma: 0 }
    const a = t(0, 24, { range: 30, center: ctr })
    const b = t(24, 0, { range: 30, center: ctr })
    const hi = t(0, 80, { range: 30, center: ctr })
    const lo = t(0, -80, { range: 30, center: ctr })
    push('B12', '纯映射：u←gamma / v←beta（不互换）、±range 满幅、越界 clamp、NaN/超量程/缺中立位 ⇒ null',
      a && a.u === 0.9 && a.v === 0.5 && b && b.u === 0.5 && b.v === 0.9
      && hi && hi.u === 1 && hi.v === 0.5 && lo && lo.u === 0 && lo.v === 0.5
      && t(NaN, 0, { range: 30, center: ctr }) === null && t(0, 91, { range: 30, center: ctr }) === null
      && t(181, 0, { range: 30, center: ctr }) === null && t(0, 0, { range: 30, center: { beta: null, gamma: null } }) === null,
      'a=' + V(a) + ' b=' + V(b) + ' hi=' + V(hi) + ' lo=' + V(lo))
  }
  // ── B13 页面默认 EMA：单调、不越界、不超调 ───────────────────────────────────────
  {
    const win = mkWindow({})
    const src = mod.mpwCreateGyroSource({ win: win, search: 'gyro=1', log: () => {} })   // 用页面默认 cfg.smooth=0.35
    src.start()
    win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 0 })
    const seq = []
    for (let i = 0; i < 20; i++) { win.fire('deviceorientation', { alpha: 0, beta: 0, gamma: 24 }); seq.push(src.state.uv.u) }
    push('B13', '默认 EMA（smooth=0.35）：单调收敛到 0.9、不超调、恒在 [0,1]（消传感器抖动但保留单调性）',
      seq.every((u, i) => u > (i ? seq[i - 1] : 0.5) && u <= 0.9 + 1e-12) && seq[19] > 0.899 && seq[19] < 0.9 && src.state.uv.v === 0.5,
      'u: ' + seq[0].toFixed(4) + '→' + seq[19].toFixed(6))
  }

  // ── C1/C2/C3/C6 端到端：姿态 ⇒ 视差（真 bundle + mock GL）───────────────────────
  {
    const p = await probe(mod, {})
    const par0 = p.uni('g_ParallaxPosition')
    const pos2 = p.uni('g_PointerPosition')
    const beforeBg = JSON.parse(p.p0)['背景'][0] * NDC2PX
    const afterBg = JSON.parse(p.p2)['背景'][0] * NDC2PX
    const beforeZero = JSON.parse(p.p0)['零深度'][0] * NDC2PX
    const afterZero = JSON.parse(p.p2)['零深度'][0] * NDC2PX
    push('C1', '★姿态 γ=24°（Δu=0.4）⇒ `g_ParallaxPosition` 真的跟到 (0.9,0.5)；中立位那一步逐位不动',
      Array.isArray(par0) && near(par0[0], 0.9) && near(par0[1], 0.5)
      && p.p0 === p.p1 && p.bridge.counts.last && near(p.bridge.counts.last.u, 0.9) && near(p.bridge.counts.last.v, 0.5),
      'parallax=' + V(par0) + ' 中立位逐位不动=' + (p.p0 === p.p1) + ' last=' + V(p.bridge.counts.last))
    push('C2', '★正深度层 Δx = 官方公式 −204.288px（−Δu·3840·0.07·3.8·0.5；实测 ' + (afterBg - beforeBg).toFixed(3) + '）',
      Math.abs((afterBg - beforeBg) - EXP_DX) < 0.5, '期望=' + EXP_DX.toFixed(3))
    push('C3', '深度 0 的层一动不动（视差只作用于带 parallaxDepth 的层）',
      Math.abs(afterZero - beforeZero) < 1e-6, 'Δx=' + (afterZero - beforeZero))
    push('C6', '桥接三个 sink 都真的投递成功（parallax/pointer/inject > 0，failed=0）',
      p.bridge.counts.parallax > 0 && p.bridge.counts.pointer > 0 && p.bridge.counts.inject > 0 && p.bridge.counts.failed === 0,
      V(p.bridge.counts))
    push('C4a', '★指针链（注入通道，本页实际生效那条）：`sinks.pointer=false` 时 `g_PointerPosition` 仍 = 姿态 (0.9,0.5)',
      Array.isArray(pos2) && near(pos2[0], 0.9) && near(pos2[1], 0.5)
      && p.win.__mpwPointer.inside === true && near(p.win.__mpwPointer.x, 0.9 * 3840, 1e-3),
      'pos=' + V(pos2) + ' 注入=' + V(p.win.__mpwPointer))
  }
  {
    const p = await probe(mod, { sinks: { inject: false } })
    const pos2 = p.uni('g_PointerPosition')
    push('C4b', '★指针源链（合成画布 pointermove ⇒ bundle `__hookPointer` ⇒ `__ptrSource.pushExternal` + `__pointerN`）：'
      + '`sinks.inject=false`（注入通道仍停在页面预建的 inside:false）时 `g_PointerPosition` 仍是姿态 (0.9,0.5)',
      p.canvas.stats.delivered.pointermove > 0 && p.canvas.count('pointermove') >= 1
      && Array.isArray(pos2) && near(pos2[0], 0.9) && near(pos2[1], 0.5)
      && p.win.__mpwPointer.inside === false,
      '交付=' + p.canvas.stats.delivered.pointermove + ' 监听=' + p.canvas.count('pointermove') + ' pos=' + V(pos2))
  }
  // ── C7 视差关着（页面缺省 `parallaxOff:true`）时姿态源照样喂指针 ────────────────────
  {
    const p = await probe(mod, { parallaxOff: true })
    const pos2 = p.uni('g_PointerPosition')
    push('C7', '★`?parallax` 缺省（视差关）时：姿态**仍然喂指针**（`g_PointerPosition` = (0.9,0.5)、注入通道在写），'
      + '而层逐位不动（视差没开）—— 这就是"与 `?ptrfx=` / `?parallax=` 正交"的实测',
      p.p0 === p.p2 && Array.isArray(pos2) && near(pos2[0], 0.9) && near(pos2[1], 0.5)
      && p.win.__mpwPointer.inside === true && p.bridge.counts.inject > 0,
      '层逐位相同=' + (p.p0 === p.p2) + ' pos=' + V(pos2) + ' counts=' + V(p.bridge.counts))
  }
  // ── C5 ?gyro=0 ⇒ 逐位不动 ───────────────────────────────────────────────────────
  {
    const p = await probe(mod, { search: '?gyro=0' })
    push('C5', '★`?gyro=0`：即使有姿态事件也**逐位不动**（p0 === p2）、0 监听、指针/视差都没被喂',
      p.p0 === p.p2 && p.bridge.state.enabled === false && p.bridge.state.listeners === 0
      && p.bridge.counts.parallax === 0 && p.bridge.counts.pointer === 0 && p.bridge.counts.inject === 0
      && p.win.count('deviceorientation') === 0 && p.win.__mpwPointer.inside === false,
      '逐位相同=' + (p.p0 === p.p2) + ' counts=' + V(p.bridge.counts) + ' listeners=' + p.bridge.state.listeners)
  }
  return res
}

// ═════════════════════════ 跑真切片 ═══════════════════════════════════════════════════════
console.log('\n[B/C] 姿态源与桥接（真源码切片 + mock window + 真 bundle + mock GL）')
const lib = await loadMod(MOD_SRC, 'real')
{
  const res = await suite(lib)
  for (const r of res) ok(r.id, r.name, r.ok, r.detail)
}

// ═════════════════════════ D 变异自证（期望红集 == 实际红集）══════════════════════════════
console.log('\n[D] RED-IF-REVERTED：把真切片逐条改坏，期望红集 == 实际红集')
const MUTANTS = [
  {
    tag: 'M1',
    label: 'u/v 映射写反（gamma↔beta 互换）',
    pairs: [['MPW_GYRO_SIGN_U * (gamma - cGamma)', 'MPW_GYRO_SIGN_U * (beta - cBeta)'],
      ['MPW_GYRO_SIGN_V * (beta - cBeta)', 'MPW_GYRO_SIGN_V * (gamma - cGamma)']],
    expect: ['B2', 'B3', 'B6', 'B11', 'B12', 'B13', 'C1', 'C2', 'C4a', 'C4b', 'C7'],
  },
  {
    tag: 'M2',
    label: 'clamp 去掉（两处：纯映射 + EMA 出口）',
    pairs: [['return { u: mpwGyroClamp01(u), v: mpwGyroClamp01(v) }', 'return { u: u, v: v }'],
      ['const u = mpwGyroClamp01(state.uv.u + (raw.u - state.uv.u) * s)', 'const u = state.uv.u + (raw.u - state.uv.u) * s'],
      ['const v = mpwGyroClamp01(state.uv.v + (raw.v - state.uv.v) * s)', 'const v = state.uv.v + (raw.v - state.uv.v) * s']],
    expect: ['B2', 'B3', 'B12'],
  },
  {
    tag: 'M3',
    label: '没事件时的中心值写成 NaN',
    pairs: [['uv: { u: MPW_GYRO_CENTER, v: MPW_GYRO_CENTER },', 'uv: { u: NaN, v: NaN },']],
    expect: ['B1', 'B5'],
  },
  {
    tag: 'M4',
    label: '`?gyro=0` 不生效（off 分支短路掉）',
    pairs: [["if (mode === 'off') {", 'if (false) {']],
    /* ①(2026-09-24 口径修正后的级联) M4 把 `off` 分支短路 ⇒ `?gyro=0` 与**缺省**（也走 off）一起失效
       ⇒ 红集是 B5（显式 0）、C5（0 档逐位不动）**加上 B14（缺省不启用）**。这是"off 语义"被整体破坏的
       正确级联，不是判据放宽。 */
    expect: ['B14', 'B5', 'C5'],
  },
]
for (const mu of MUTANTS) {
  let body = MOD_SRC, missing = null
  for (const [from, to] of mu.pairs) {
    if (!body.includes(from)) { missing = from; break }
    body = body.replace(from, to)
  }
  if (missing) { failN++; console.log('  ✗ D ' + mu.tag + ' 变异锚点不在真源码里：' + V(missing.slice(0, 80))); continue }
  let got = null, err = null
  try {
    const mm = await loadMod(body, mu.tag)
    const res = await suite(mm)
    got = res.filter((r) => !r.ok).map((r) => r.id)
  } catch (e) { err = (e && e.message) || String(e) }
  const exp = mu.expect.slice().sort()
  const act = got ? got.slice().sort() : null
  const eqSets = act && act.length === exp.length && act.every((x, i) => x === exp[i])
  if (eqSets) {
    passN++
    console.log('  MUTANT-RED-OK ' + mu.tag + '（' + mu.label + '）⇒ 红集 = ' + V(act))
  } else {
    failN++
    console.log('  ✗ D ' + mu.tag + '（' + mu.label + '）红集不符：期望 ' + V(exp) + ' 实际 ' + V(act) + (err ? ' 抛=' + err : ''))
    fails.push('D ' + mu.tag + ' 红集不符')
  }
}
// 真树只读自证 + /tmp 无残留
{
  const shaNow = crypto.createHash('sha256').update(fs.readFileSync(DEMO_FILE)).digest('hex')
  for (const f of TMPFILES) fs.rmSync(f, { force: true })
  const left = fs.readdirSync(os.tmpdir()).filter((f) => /^mpw-gyro-/.test(f))
  ok('D0', '真树 demo.html 跑前跑后 sha256 相同（切片只在 /tmp 里变异）且 /tmp 无残留',
    shaNow === DEMO_SHA0 && left.length === 0, 'sha同=' + (shaNow === DEMO_SHA0) + ' 残留=' + V(left))
}

console.log('\n===== gyro-parallax: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

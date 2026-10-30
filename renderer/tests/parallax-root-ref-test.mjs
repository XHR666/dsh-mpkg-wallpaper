// parallax-root-ref-test.mjs —— ①(P-348 2026-10-12) 视差**参考点**的口径 + 两个"死回退位"回归判据
//
// 复现：`node tests/parallax-root-ref-test.mjs`（纯 Node + mock-GL，无浏览器 / 网络 / GPU）
//
// ── 这一档为什么存在（前因）────────────────────────────────────────────────────────────
// P-309（`69db5aa`，2026-10-11）把对象级视差的**参考点**与 `parallaxDepth` **同源**取顶层祖先
// （官方 A4：`0x2557c28`（读 `[x22,#248]` 参考点位置）与 `0x2557c30`（读 `[x22,#320]` depth）
// **同一个 `x22`**，`x22` = `GetParent()` 循环到根 ⇒ 见 `reports/parallax-official-align-20260924.md` §5.1）。
// 但落地时那两行**接线写坏了**，而配套判据 `tests/parallax-root-position-test.mjs` 只做了**正则级**断言
// （"`parPosLegacy` 这个名字出现在源码里"）⇒ bug 在一条**放空的判据**后面躲了一整轮：
//   · `__parPosLegacy` 的三元**错位**（挂在 IIFE 返回值上、else 支误接 `PARALLAX_OFF_LEGACY`）
//     ⇒ `?parpos=legacy` **从来没生效**；反过来 **`?paroff=legacy` 会悄悄把参考点退回本层**；
//   · `__parOffLegacy` 取的是 **"传没传"**（`!== undefined`）而不是**值** ⇒ `parallaxOffLegacy:false`
//     反而**打开**旧门控；而 `?paroff=legacy` 从没进过它本该管的门控。
// 本档是**行为级**判据（真跑 renderScene + mock-GL 读层心位移），把上面每一条都钉死。
//
// ── 读数口径（务必先读）──────────────────────────────────────────────────────────────
// mock-GL 的 `onLayerDraw` 给的是层心 **NDC**；本档统一换算成
//   `reading = mvp[12] · W/2 = (ox − camCx) + parOffX`（"层心相对画布中心的设计像素"）
// ⇒ **没有视差时** `reading = ox − camCx`；有视差时再加上 `parOffX`。
//
// ── 参考点**改不动**幅度/速度（本档 §B/§C 的机器形式）────────────────────────────────────
// 官方每层位移 `offset = (rootPos − S) ∘ depth × amount` 里：
//   · `S`（= `Scene[704..708]`，随鼠标/时间变化）只由 `parDisp` 承担 ⇒ **时间项与参考点无关**；
//   · `rootPos`（参考点）在两次采样之间是**常量** ⇒ 它只贡献一个**静态位移**。
// ⇒ 换参考点**不可能**改变"晃动幅度 / 速度"，只能改静态位置。实测（真包 `妃咲`，240 帧/采样点收敛后）：
//   峰峰值 `pp_x = Δcursor · W · min(influence,1) · amount · depth = 1.0 × 3840 × 0.31 × 0.1 × depth`
//   = **119.04 px × |depth|**，与参考点选哪一层**逐层相同**（§C 的两条断言）。
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
    drawArrays: () => {}, drawElements: () => {},
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
    uniform1f: () => {}, uniform1i: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniform1fv: () => {}, uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return gl
}
const PROJ_W = 3840, PROJ_H = 2160
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const TEX = new Map([['tex_a', { glTex: { id: 't_a' }, width: 64, height: 64 }]])
const mkL = (id, name, ox, oy, depth, parent) => ({ id, name, visible: true, solid: false, isContainer: false,
  textureName: 'tex_a', size: [200, 200], scale: [1, 1, 1], origin: [ox, oy, 0], angles: [0, 0, 0], alignment: 'center',
  color: [1, 1, 1], alpha: 1, brightness: 1, parallaxDepth: depth, effects: [], parent })
const mkScene = (layers, general) => ({ general: Object.assign({ orthogonalprojection: { width: PROJ_W, height: PROJ_H } }, general || {}),
  camera: null, properties: {}, layers })
/** 读数换算：`mvp[12]`（层心 NDC x）→ "层心相对画布中心的设计像素"。 */
const px = (mvp12) => mvp12 * PROJ_W / 2

/**
 * 跑一档：`search` 是假的 `location.search`（模块级 `?parparallax=…` 常量在 **import 时**求值 ⇒ 每个 query
 * 必须重新 import 一次，带缓存破坏参数），`opts` 进 `createRenderer`。
 * `cursors` 给多个注入指针位置时按顺序采样（每个位置 `frames` 帧，等 EMA 收敛）。
 */
async function runCase(scene, opt) {
  const o = opt || {}
  const coreUrl = o.coreUrl || CORE_FILE
  const savedLoc = globalThis.location, savedWin = globalThis.window
  if (o.search === undefined) delete globalThis.location
  else globalThis.location = { search: o.search }
  globalThis.window = { innerWidth: PROJ_W, innerHeight: PROJ_H, addEventListener: () => {}, removeEventListener: () => {} }
  const mod = await import(pathToFileURL(coreUrl).href + '?v=' + crypto.randomBytes(4).toString('hex'))
  const cur = {}
  const r = mod.createRenderer({ getContext: () => mkGL() },
    Object.assign({ shaderResolver: async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG),
      onLog: () => {}, onLayerDraw: (layer, info) => { cur[layer.name] = px(info.mvp[12]) } }, o.opts || {}))
  void mod
  const frames = o.frames || 3
  const samples = []
  const cursors = o.cursors || [[0.5, 0.5]]
  let t = 0
  for (const c of cursors) {
    if (c === null) delete globalThis.__mpwPointer
    else globalThis.__mpwPointer = { x: c[0] * PROJ_W, y: c[1] * PROJ_H, inside: true }
    for (let k = 0; k < frames; k++) await r.render(scene, TEX, PROJ_W, PROJ_H, (t += 1 / 60))
    samples.push(Object.assign({}, cur))
  }
  delete globalThis.__mpwPointer
  if (savedLoc === undefined) delete globalThis.location; else globalThis.location = savedLoc
  if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin
  const names = Object.keys(samples[0] || {})
  const out = {}
  for (const n of names) {
    const xs = samples.map((s) => s[n])
    out[n] = { last: xs[xs.length - 1], pp: Math.max(...xs) - Math.min(...xs), all: xs }
  }
  return out
}

// ═════════════════════════ 夹具 ═════════════════════════
/* F1：**静态参考项**隔离夹具。根 R 在画布左（ox=800，depth 1），子层 C 在右（ox=3200，继承根的 depth 1）；
   `cameraparallaxmouseinfluence = 0` ⇒ `parDisp ≡ 0` ⇒ 读数里**只剩参考点那一项**，可手算到 0.1px。
   官方期望（`offset = (rootPos − S) ∘ depth × amount`，S=0.5 恒定）：
     · 根参考：两者同值 `(800−1920)×1×0.1 = −112.0px`
       ⇒ reading(R) = (800−1920) + (−112) = **−1232.0**；reading(C) = (3200−1920) + (−112) = **+1168.0**
     · 本层参考（`?parpos=legacy`）：R 不变 −1232.0；C = (3200−1920)×1×0.1 = +128 ⇒ **+1408.0** */
const F1 = mkScene([mkL(1, 'R', 800, PROJ_H / 2, [1, 1], undefined), mkL(2, 'C', 3200, PROJ_H / 2, null, 1)],
  { cameraparallax: true, cameraparallaxamount: 0.1, cameraparallaxdelay: 0, cameraparallaxmouseinfluence: 0 })
const F1_ROOT = { R: -1232.0, C: 1168.0 }
const F1_LAYER = { R: -1232.0, C: 1408.0 }
/* F2：**幅度与参考点无关**夹具。两个独立根（各自带一个子层）depth 4 / 1，`influence = 1`，指针从 x=0 扫到 x=1
   ⇒ 官方峰峰值 `pp = Δcursor · W · min(infl,1) · amount · depth = 0.5×3840×1×0.1×depth = 192.0 px × depth`。 */
const F2 = mkScene([
  mkL(11, 'R4', 1920, 1080, [4, 4], undefined), mkL(12, 'C4', 3100, 1080, null, 11),
  mkL(21, 'R1', 1920, 1080, [1, 1], undefined), mkL(22, 'C1', 3100, 1080, null, 21),
], { cameraparallax: true, cameraparallaxamount: 0.1, cameraparallaxdelay: 0, cameraparallaxmouseinfluence: 1 })
const F2_PP_UNIT = 0.5 * 3840 * 1 * 0.1   // 指针扫描区间 Δcursor=0.5 ⇒ 192.0 px / 单位 depth
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.05 : tol)

// ═════════════════════════ 被测 suite ═════════════════════════
async function runSuite(lib, o) {
  const opt = o || {}
  const CU = opt.coreUrl        // 变异副本的 URL（缺省 = 真树）
  const checks = {}, show = {}
  const C = (id, cond, detail) => { checks[id] = !!cond; show[id] = detail === undefined ? '' : String(detail) }
  void lib

  // ── §A 参考点口径（F1：静态参考项，可手算）────────────────────────────────────────
  {
    const r = await runCase(F1, { coreUrl: CU })
    C('REF-ROOT-DEFAULT', near(r.R.last, F1_ROOT.R) && near(r.C.last, F1_ROOT.C),
      '缺省 ⇒ R=' + r.R.last.toFixed(1) + ' C=' + r.C.last.toFixed(1) +
      '（根参考期望 ' + F1_ROOT.R + ' / ' + F1_ROOT.C + '；本层参考会是 ' + F1_LAYER.C + '）')
  }
  {
    const r = await runCase(F1, { search: '?parpos=legacy' , coreUrl: CU})
    C('REF-POS-LEGACY-URL', near(r.R.last, F1_LAYER.R) && near(r.C.last, F1_LAYER.C),
      '?parpos=legacy ⇒ C=' + r.C.last.toFixed(1) + '（本层参考期望 ' + F1_LAYER.C + '；坏接线时恒 ' + F1_ROOT.C + '）')
  }
  {
    const r = await runCase(F1, { opts: { parallaxPosLegacy: true }, coreUrl: CU })
    C('REF-POS-LEGACY-OPT', near(r.C.last, F1_LAYER.C),
      'opts.parallaxPosLegacy:true ⇒ C=' + r.C.last.toFixed(1) + '（期望 ' + F1_LAYER.C + '）')
  }
  {
    const r = await runCase(F1, { search: '?paroff=legacy' , coreUrl: CU})
    C('REF-OFF-LEGACY-DOES-NOT-MOVE-REF', near(r.C.last, F1_ROOT.C),
      '?paroff=legacy ⇒ C=' + r.C.last.toFixed(1) + '（**不该**动参考点，期望 ' + F1_ROOT.C + '；坏接线时会变成 ' + F1_LAYER.C + '）')
  }

  // ── §B 幅度：与参考点无关 + 严格正比 depth（F2）──────────────────────────────────
  {
    const a = await runCase(F2, { cursors: [[0.5, 0.5], [1.0, 0.5], [0.5, 0.5]], frames: 400 , coreUrl: CU})
    const b = await runCase(F2, { search: '?parpos=legacy', cursors: [[0.5, 0.5], [1.0, 0.5], [0.5, 0.5]], frames: 400 , coreUrl: CU})
    const want4 = F2_PP_UNIT * 4, want1 = F2_PP_UNIT * 1
    C('REF-AMP-INDEPENDENT-OF-REF',
      near(a.R4.pp, want4, 0.5) && near(b.R4.pp, want4, 0.5) && near(a.R1.pp, want1, 0.5) && near(b.R1.pp, want1, 0.5),
      'pp: 根参考 R4=' + a.R4.pp.toFixed(1) + ' R1=' + a.R1.pp.toFixed(1) +
      '；本层参考 R4=' + b.R4.pp.toFixed(1) + ' R1=' + b.R1.pp.toFixed(1) +
      '（官方期望 ' + want4 + ' / ' + want1 + ' ⇒ 参考点改不动幅度）')
    C('REF-AMP-LOCKSTEP-BY-DEPTH',
      near(a.C4.pp, a.R4.pp, 0.05) && near(a.C1.pp, a.R1.pp, 0.05) && near(a.R4.pp / a.R1.pp, 4, 0.01),
      '同一根下根/子层逐位同幅（C4=' + a.C4.pp.toFixed(1) + ' == R4=' + a.R4.pp.toFixed(1) +
      '；C1=' + a.C1.pp.toFixed(1) + ' == R1=' + a.R1.pp.toFixed(1) + '）；幅度比 = ' + (a.R4.pp / a.R1.pp).toFixed(3) + '（期望 4）')
  }

  // ── §C 门控回退位（`__parOffLegacy` 取"值"而不是"传没传"）──────────────────────────
  {
    const off = await runCase(F1, { opts: { parallaxOff: true }, coreUrl: CU })
    const offFalse = await runCase(F1, { opts: { parallaxOff: true, parallaxOffLegacy: false }, coreUrl: CU })
    const offTrue = await runCase(F1, { opts: { parallaxOff: true, parallaxOffLegacy: true }, coreUrl: CU })
    C('OFF-GATE-OPT-FALSE', near(offFalse.R.last, 800 - 1920) && near(offFalse.C.last, 3200 - 1920),
      'parallaxOff:true + parallaxOffLegacy:**false** ⇒ R=' + offFalse.R.last.toFixed(1) + ' C=' + offFalse.C.last.toFixed(1) +
      '（"传了 false" 必须等于"没传" ⇒ 无视差 = −1120.0 / +1280.0；旧口径会误开 ⇒ ' + off.R.last.toFixed(1) + ' / ' + off.C.last.toFixed(1) + '）')
    C('OFF-GATE-OPT-TRUE', near(offTrue.R.last, F1_ROOT.R) && near(offTrue.C.last, F1_ROOT.C),
      'parallaxOff:true + parallaxOffLegacy:**true** ⇒ R=' + offTrue.R.last.toFixed(1) + ' C=' + offTrue.C.last.toFixed(1) +
      '（回旧口径 ⇒ 位移保留，期望 ' + F1_ROOT.R + ' / ' + F1_ROOT.C + '）')
  }

  // ── §D 真包（缺语料 ⇒ SKIP；变异副本用 skipCorpus 跳过 ⇒ 红集与语料无关）────────────
  if (!opt.skipCorpus) {
    const dir1004 = path.join(MPW_WS, 'allwallpaper', '1004')
    let file = null
    try { file = fs.readdirSync(dir1004).find((n) => /妃咲.*\.mpkg$/.test(n)) || null } catch (e) { file = null }
    if (!file) skip('RP-ROOTREF-LOCKSTEP', '语料缺席：' + path.join('allwallpaper', '1004') + '/…妃咲….mpkg')
    else {
      try {
        const buf = fs.readFileSync(path.join(dir1004, file))
        const pkg = lib.parsePkg(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
        const rdT = (e) => new TextDecoder().decode(e)
        const txt = (n) => { const e = lib.getEntry(pkg, n); return e ? rdT(e) : null }
        const sj = JSON.parse(txt('scene.json'))
        const g = sj.general
        const OW = g.orthogonalprojection.width
        const amount = g.cameraparallaxamount, infl = Math.min(g.cameraparallaxmouseinfluence, 1)
        const scene = lib.parseScene(sj, JSON.parse(txt('project.json')), {})
        for (const l of scene.layers) { l.textureName = 'tex_a'; l.solid = false; l.visible = true }
        const sweep = [[0.5, 0.5], [1.0, 0.5], [0.5, 0.5]]
        const a = await runCase(scene, { cursors: sweep, frames: 240 , coreUrl: CU})
        const b = await runCase(scene, { search: '?parpos=legacy', cursors: sweep, frames: 240 , coreUrl: CU})
        const unit = 0.5 * OW * infl * amount    // 指针扫描区间 Δcursor=0.5 ⇒ 每单位 depth 的峰峰值 0.5×3840×0.31×0.1 = 59.52 px
        const names = Object.keys(a)
        let worst = 0, worstName = '-', same = 0, refMoved = 0, maxStatic = 0, maxStaticName = '-'
        for (const n of names) {
          if (!b[n]) continue
          if (Math.abs(a[n].last - b[n].last) <= 0.01) same++
          else { refMoved++; if (Math.abs(a[n].last - b[n].last) > maxStatic) { maxStatic = Math.abs(a[n].last - b[n].last); maxStaticName = n } }
          const rel = Math.abs(a[n].pp - b[n].pp)
          if (rel > worst) { worst = rel; worstName = n }
        }
        C('RP-AMP-IDENTICAL-ACROSS-REF', names.length >= 10 && worst <= 0.01,
          names.length + ' 层；根参考 vs 本层参考的峰峰值最大差 = ' + worst.toFixed(4) + 'px（' + worstName + '）⇒ 参考点只改静态项')
        C('RP-ROOTREF-IS-OBSERVABLE', refMoved >= 3 && maxStatic > 50,
          refMoved + '/' + names.length + ' 层的**静态位置**随参考点改变，最大 ' + maxStatic.toFixed(1) + 'px（' + maxStaticName +
          '）⇒ P-309 的改动是可观测的（不是空改），其余 ' + same + ' 层根/本层同位')
      } catch (e) {
        C('RP-AMP-IDENTICAL-ACROSS-REF', false, '真包跑不动：' + String((e && e.message) || e).slice(0, 160))
      }
    }
  }
  return { checks, show }
}

// ═════════════════════════ 主跑 ═════════════════════════
const libUrl = pathToFileURL(CORE_FILE).href
const lib = await import(libUrl + '?t=' + Date.now())
const srcShaBefore = sha256(fs.readFileSync(CORE_FILE))

console.log('== §A/§B/§C/§D 主跑（真树 core/we-scene-bundle.js）==')
const base = await runSuite(lib, { coreUrl: CORE_FILE })
const ids = Object.keys(base.checks).sort()
for (const id of ids) {
  if (base.checks[id]) { passN++; console.log('  ✓ ' + id + (base.show[id] ? '  [' + base.show[id] + ']' : '')) }
  else { failN++; fails.push(id); console.log('  ✗ ' + id + (base.show[id] ? '  [' + base.show[id] + ']' : '')) }
}
ok('§0 判据自检：本次真的跑了 ≥6 条断言（不是"全 SKIP 就算绿"）', ids.length >= 6, 'ids=' + ids.length + ' → ' + ids.join(','))

// ═════════════════════════ §E 变异自证（期望红集 == 实际红集）════════════════════════
const MUTANTS = [
  {
    label: 'M1(参考点恒取本层 ⇒ 整个 P-309 被撤销)',
    from: '          const parPosSrc = __parPosLegacy ? layer : parDepthSrc',
    to: '          const parPosSrc = layer   // MUTANT：撤销 P-309',
    expectRed: ['REF-ROOT-DEFAULT', 'REF-OFF-LEGACY-DOES-NOT-MOVE-REF', 'OFF-GATE-OPT-TRUE'],
    why: '`?parpos=legacy` 档本来就期望本层 ⇒ REF-POS-LEGACY-URL/OPT 不红（正确）；'
      + 'OFF-GATE-OPT-FALSE 只看"关掉了没有"（两者都关）⇒ 不红；而 **OFF-GATE-OPT-TRUE 断言的是精确读数**'
      + '（该档 C 的子层读数是参考点相关的）⇒ 参考点一改它就红（正确，不是噪声）。',
  },
  {
    label: 'M2(把 P-309 那个错位三元原样装回去 ⇒ `?parpos=legacy` 失效 + `?paroff=legacy` 偷偷改参考点)',
    from: '    const __parPosLegacy = (opts.parallaxPosLegacy !== undefined)\n      ? !!opts.parallaxPosLegacy : PARALLAX_POS_LEGACY',
    to: '    const __parPosLegacy = (() => { try { return new URLSearchParams(location.search).get(\'parpos\') === \'legacy\' } catch (e) { return false } })()\n      ? !!opts.parallaxOffLegacy : PARALLAX_OFF_LEGACY',
    expectRed: ['REF-POS-LEGACY-URL', 'REF-POS-LEGACY-OPT', 'REF-OFF-LEGACY-DOES-NOT-MOVE-REF'],
    why: '缺省档（无 URL 无 opts）两式都给 false ⇒ REF-ROOT-DEFAULT 不红 —— 这正是它躲过一轮的原因；'
      + '门控两档与参考点无关 ⇒ 不红。',
  },
  {
    label: 'M3(`__parOffLegacy` 回"传没传"而不是值)',
    from: '    const __parOffLegacy = (opts.parallaxOffLegacy !== undefined)\n      ? !!opts.parallaxOffLegacy : PARALLAX_OFF_LEGACY',
    to: '    const __parOffLegacy = (opts.parallaxOffLegacy !== undefined)   // MUTANT',
    expectRed: ['OFF-GATE-OPT-FALSE'],
    why: '`parallaxOffLegacy:true` 两式都为真 ⇒ OFF-GATE-OPT-TRUE 不红；'
      + '`?paroff=legacy` 那一档的 `parallaxOff` 没给 ⇒ 门控本来就开 ⇒ REF-OFF-LEGACY-DOES-NOT-MOVE-REF 不红。',
  },
  {
    label: 'M4(参考点档缺省翻成 legacy ⇒ 反向：把"本层口径"当默认发出去)',
    from: '      ? !!opts.parallaxPosLegacy : PARALLAX_POS_LEGACY',
    to: '      ? !!opts.parallaxPosLegacy : true   // MUTANT：默认回本层',
    expectRed: ['REF-ROOT-DEFAULT', 'REF-OFF-LEGACY-DOES-NOT-MOVE-REF', 'OFF-GATE-OPT-TRUE'],
    why: '显式 legacy 的两档本来就期望本层 ⇒ 不红；OFF-GATE-OPT-FALSE 只看"关掉了没有" ⇒ 不红；'
      + 'OFF-GATE-OPT-TRUE 断言精确读数（子层读数随参考点而变）⇒ 默认口径一翻它就红（正确）。',
  },
]
let mutRedOk = 0
for (const mu of MUTANTS) {
  const body0 = fs.readFileSync(CORE_FILE, 'utf8')
  const n = body0.split(mu.from).length - 1
  if (n !== 1) { failN++; fails.push(mu.label + '（锚点命中 ' + n + ' 处，应为 1）'); console.log('  ✗ ' + mu.label + ' ⇒ 锚点命中 ' + n + ' 处，应在真源码里唯一'); continue }
  const body = body0.replace(mu.from, mu.to)
  const tmp = path.join(os.tmpdir(), 'pxr-mut-' + crypto.randomBytes(6).toString('hex') + '.mjs')
  // 副本搬到 /tmp 后相对 import（`./we-animation.mjs` / `./puppet-skin.js` …）会断 ⇒ 改写成仓库内绝对路径
  fs.writeFileSync(tmp, body.replace(/from '\.\//g, "from '" + path.join(ROOT, 'core') + '/'))
  let res = null, err = null
  try {
    const mm = await import(pathToFileURL(tmp).href + '?v=' + Date.now() + Math.random())
    res = await runSuite(mm, { skipCorpus: true, coreUrl: tmp })
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
ok('§E 变异自证 ≥3 组且全部 MUTANT-RED-OK（' + mutRedOk + '/' + MUTANTS.length + '）',
  mutRedOk >= 3 && mutRedOk === MUTANTS.length)

// ── §F 真树未被改动 ──
const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^pxr-mut-.*\.mjs$/.test(f))
const srcShaAfter = sha256(fs.readFileSync(CORE_FILE))
ok('§F 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同，且 /tmp 无残留副本',
  srcShaBefore === srcShaAfter && leftovers.length === 0, 'sha=' + srcShaBefore.slice(0, 12) + ' leftovers=' + leftovers.length)

console.log('\n===== parallax-root-ref: ' + passN + ' 通过 / ' + failN + ' 失败 / ' + skipN + ' SKIP =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

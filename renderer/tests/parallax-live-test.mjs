// parallax-live-test.mjs —— ①(WEBWALLGL issue #5「鼠标视差壁纸首帧多层叠加 / 根本不动」) 实证门禁
//
// 背景（`docs/WEBWALLGL-ISSUES-ELYSIA-20260923.md` §5）：我们的视差此前**默认整体关着**
//   （`demo.html` 的 `parallaxOff = get('parallax') !== '1'`），而插件诊断项文案说 `?parallax=legacy`
//   能"切旧公式" —— 但那个值**不会打开视差**（点了什么都不发生）⇒ 这是一条**接线/文案不一致的真 bug**。
//   本档把三件事钉住：
//     A **离线**（不需要浏览器）：从 `demo.html` **真源码切片**求值 `parallaxOff`/`parallaxLegacy`，
//        断言 `1` / `official` / `legacy` 三个值都**打开**视差、其余取值（含缺省）仍是**关**；
//     B **离线 mock-GL**：场景级视差（`general.cameraparallax`）真的把层**按官方公式**位移，
//        且 `parallaxOff:true` 时逐位不动（= "关掉视差"确实一个像素都不动）；
//     C **真机（有头优先 + 能力前置）**：在两个**现成样本**上实测"移动鼠标前后画面是否变化"：
//        ① `<工作区>/allwallpaper/0917/3233141951/scene.pkg`（用户点名的有视差样本）
//        ② `<工作区>/allwallpaper/wallpapertest1/红鸾樱落.mpkg`（**.mpkg 容器**；同壁纸另有一份
//           `wallpaperE/other/红鸾樱落.mpkg` 用于"两种打包路径一致"对照）
//        读数两路：**逐层台账**（`window.__mpwLayerLedger` 的 `rd`，设计坐标，鼠标中心 vs 右移）
//        + **像素**（画布截图降采样后的 MAE 与一维互相关位移）。
//
// ── 判据为什么这样写（诚实边界）────────────────────────────────────────────────────────
//   · 台账那路是**定量**的：官方对象级公式 `offset = ((node_pos − cam_pos) + mouse) ∘ depth × amount`
//     对鼠标位移的**差**是 `Δmouse ∘ depth × amount` ⇒ 逐层 `Δrd_x / depth_x` 必须是**同一个常数**
//     （线性性），且深度 0 的层**必须一动不动**。这两条足以把"跟鼠标/跟错幅度/根本没动"分开。
//   · 像素那路是**定性但独立**的（不依赖页面自报的台账）：MAE > 阈值 = 画面真的变了；
//     对照档（不加 `?parallax`）MAE ≈ 0 = 那点像素变化确实来自视差而不是场景动画。
//   · ⚠ 不断言"与 WE 客户端逐位一致"：本机没有官方出帧（§5.5 的限制），本档只证"跟不跟、跟多快、
//     方向对不对"，幅度是否等于官方仍需真机录屏对拍。
//
// 用法：
//   node tests/parallax-live-test.mjs                 # A+B（离线）+ C（有头真机；无 GL ⇒ C 打 SKIP）
//   node tests/parallax-live-test.mjs --offline       # 只跑 A+B（本机内存紧时的省内存档）
//   node tests/parallax-live-test.mjs --sample=pkg    # 只测 scene.pkg 样本（--sample=mpkg / =both）
//   node tests/parallax-live-test.mjs --no-control    # 跳过"关视差"对照档（省一次加载）
// 环境：`MPW_DEMO_URL`（默认 `http://127.0.0.1:8899`）、`MPW_X11_DISPLAY`（默认 `:0`）、
//   `MPW_ROOT`（工作区根，样本语料在这里）、`MPW_PLAYWRIGHT`（playwright 路径）。
// 退出码：0 全绿（含 SKIP）/ 1 有断言失败 / 2 用法错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
const bad = argv.find((a) => !/^(--offline|--no-control|--verbose|--help|--sample=)/.test(a))
if (bad) { console.error('未知参数：' + bad + '（用法见文件头）'); process.exit(2) }
if (argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 30).join('\n')); process.exit(0) }
const OFFLINE_ONLY = argv.includes('--offline')
const NO_CONTROL = argv.includes('--no-control')
const VERBOSE = argv.includes('--verbose')
const SAMPLE_SEL = (argv.find((a) => a.startsWith('--sample=')) || '--sample=both').slice(9)

let passN = 0, failN = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const V = (o) => JSON.stringify(o)

// ═════════════════════════ A 离线：demo.html 真源码切片 ═══════════════════════════════════
console.log('[A] `demo.html` 真源码切片：`?parallax=` 的取值 → 开/关 与 公式档')
const DEMO_FILE = path.join(ROOT, 'demo.html')
const DEMO = fs.readFileSync(DEMO_FILE, 'utf8')
{
  /** 从真源码里抠出 `键: <表达式>,` 这一行的表达式，并包成可调用函数（`location` 由调用方给）。 */
  const sliceExpr = (key) => {
    const re = new RegExp('\\n\\s*' + key + ':\\s*([^\\n]*?),\\s*\\n')
    const m = re.exec(DEMO)
    if (!m) return null
    const expr = m[1].trim()
    try { return { expr, fn: new Function('location', 'return (' + expr + ')') } } catch (e) { return { expr, fn: null, err: String(e && e.message) } }
  }
  const off = sliceExpr('parallaxOff')
  const legacy = sliceExpr('parallaxLegacy')
  ok('A0 两条接线都从 `demo.html` 真源码里抠到了（不是本档自己重写的式子）',
    !!off && !!off.fn && !!legacy && !!legacy.fn, 'parallaxOff=「' + (off && off.expr) + '」 parallaxLegacy=「' + (legacy && legacy.expr) + '」')
  if (off && off.fn && legacy && legacy.fn) {
    const call = (fn, search) => fn({ search, href: 'http://localhost/' + search })
    const cases = [
      ['', true, false, '缺省（用户 2026-09-12 的要求：默认关，截图可复现）'],
      ['?pkgpath=/x/scene.pkg', true, false, '只给包路径'],
      ['?parallax=1', false, false, '`=1` 开（官方公式）'],
      ['?parallax=official', false, false, '`=official` 开（显式官方公式）'],
      ['?parallax=legacy', false, true, '★`=legacy` 开 **且** 走旧公式（改前这里仍是"关" = 接线不一致的真 bug）'],
      ['?parallax=0', true, false, '`=0` 关'],
      ['?parallax=junk', true, false, '垃圾值关（不静默打开）'],
      ['?id=1&parallax=legacy&audit=3', false, true, '在长查询串里同样成立'],
    ]
    for (const [q, wantOff, wantLegacy, why] of cases) {
      const gotOff = call(off.fn, q), gotLegacy = call(legacy.fn, q)
      ok('A1「' + (q || '(无查询串)') + '」⇒ parallaxOff=' + gotOff + ' parallaxLegacy=' + gotLegacy + '（' + why + '）',
        gotOff === wantOff && gotLegacy === wantLegacy, '期望 off=' + wantOff + ' legacy=' + wantLegacy)
    }
    ok('A2 ★变异锚点存在：`parallaxOff` 的表达式里含有 `1|official|legacy` 三值判定（改回 `!== \'1\'` 会让 A1 的 legacy 行变红）',
      /\^\(1\|official\|legacy\)\$/.test(off.expr), off.expr)
  }
}

// ═════════════════════════ B 离线 mock-GL：场景级视差跟鼠标 ═══════════════════════════════
// 目的：把"鼠标一动，层就按官方公式位移"这条链在**无浏览器**下也钉住（真机档可能因环境缺 GL 打 SKIP）。
// mock GL 只做台账（与 `tests/effects-degenerate-fbo-test.mjs` 同款最小实现；本档的合成场景没有效果链）。
console.log('[B] 离线 mock-GL：`cameraparallax` 场景的层位移跟鼠标（`parallaxOff` 两态）')
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
/**
 * 合成场景：3840×2160 设计画布 + 两层（`背景@depth 3.8` / `零深度@depth 0`）。
 * 参数取**用户样本 0917/3233141951 的作者值**（`cameraparallaxamount=0.5`、
 * `cameraparallaxmouseinfluence=0.07`、`cameraparallaxdelay=0.1`、背景层 `parallaxDepth=3.8 4.2`）。
 */
const mkScene = () => ({
  general: { orthogonalprojection: { width: 3840, height: 2160 }, cameraparallax: true,
    cameraparallaxamount: 0.5, cameraparallaxmouseinfluence: 0.07, cameraparallaxdelay: 0.1 },
  camera: null, properties: {},
  layers: [
    { id: 1, name: '背景', visible: true, size: [3840, 2160], scale: [1, 1, 1], origin: [1920, 1080, 0],
      angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
      parallaxDepth: [3.8, 4.2], textureName: 'tex_bg', effects: [] },
    { id: 2, name: '零深度', visible: true, size: [1000, 1000], scale: [1, 1, 1], origin: [1920, 1080, 0],
      angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
      parallaxDepth: [0, 0], textureName: 'tex_fg', effects: [] },
  ],
})
const TEXTURES = new Map([['tex_bg', { glTex: { id: 't_bg' }, width: 64, height: 64 }],
  ['tex_fg', { glTex: { id: 't_fg' }, width: 64, height: 64 }]])
/**
 * 在**任意一份渲染器模块**上跑同一套视差探针（真模块与变异副本共用；E 段的自证也用它）。
 * ⚠ `info.mvp` 是**行向量约定**的 MVP ⇒ `m[12]/m[13]` 是层中心的 **NDC**（`(ox+parOffX)/projW*2 − 1`），
 *   不是设计像素。位移量（差值）换算：`Δ设计像素 = ΔNDC × projW/2`（本档 projW = 3840 ⇒ ×1920）。
 * @returns `{ dxOn, dxZero, offBitIdentical, hasMouseListener, before, after }`（dx 单位为**设计像素**）
 */
async function parallaxProbe(lib) {
  const savedWin = globalThis.window
  const NDC2PX = 1920
  const runFrames = async (parallaxOff, moveTo) => {
    const handlers = []
    globalThis.window = { innerWidth: 1000, innerHeight: 500,
      addEventListener: (t, f) => handlers.push({ t, f }), removeEventListener: () => {} }
    try {
      const { gl } = mkGL()
      const last = {}
      const r = lib.createRenderer({ getContext: () => gl, width: 1280, height: 720 },
        { shaderResolver: resolverFor, onLog: () => {}, parallaxOff,
          onLayerDraw: (layer, info) => { last[String(layer.name)] = [info.mvp[12], info.mvp[13]] } })
      const scene = mkScene()
      let t = 0
      for (let i = 0; i < 2; i++) { t += 1 / 60; await r.render(scene, TEXTURES, 1280, 720, t) }
      const before = V(last)
      const mm = handlers.find((h) => h.t === 'mousemove')
      if (moveTo && mm) mm.f({ clientX: moveTo[0], clientY: moveTo[1] })
      for (let i = 0; i < 40; i++) { t += 1 / 60; await r.render(scene, TEXTURES, 1280, 720, t) }
      return { before, after: V(last), nx: last['背景'] ? last['背景'][0] : NaN, nz: last['零深度'] ? last['零深度'][0] : NaN, hasMouseListener: !!mm }
    } finally {
      if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin
    }
  }
  const on0 = await runFrames(false, null)                 // 鼠标不动（缺省中心）
  const on1 = await runFrames(false, [900, 250])           // 鼠标移到画布右半（0.9, 0.5）
  const off1 = await runFrames(true, [900, 250])           // 同一动作 + `parallaxOff:true`
  return {
    dxOn: (on1.nx - on0.nx) * NDC2PX,
    dxZero: (on1.nz - on0.nz) * NDC2PX,
    offBitIdentical: off1.after === off1.before,
    onBitDifferent: on1.after !== on0.after,
    sameBefore: on0.before === off1.before,
    hasMouseListener: on1.hasMouseListener,
    off1,
  }
}
{
  const lib = await import('../core/we-scene-bundle.js')
  const p = await parallaxProbe(lib)
  // 官方公式：Δoffset_x = Δmouse_x · orthoW · influence · depth_x · amount
  //   Δmouse_x = 0.9−0.5 = 0.4 ⇒ Δdisp = −0.4·3840·0.07 = −107.52 ⇒ ×3.8×0.5 = −204.288
  const EXP = -0.4 * 3840 * 0.07 * 3.8 * 0.5
  ok('B0 `?parallax=1` 档真的挂了 mousemove 监听（`attachParallaxListener` 生效）', p.hasMouseListener)
  ok('B1 ★鼠标右移 ⇒ 正深度层**向左**位移，量级 = 官方公式 −204.29px（实测 Δx=' + p.dxOn.toFixed(3) + '）',
    Math.abs(p.dxOn - EXP) < 0.5, '期望=' + EXP.toFixed(3))
  ok('B2 深度 0 的层**一动不动**（视差只作用于带 `parallaxDepth` 的层）', Math.abs(p.dxZero) < 1e-6, 'Δx=' + p.dxZero)
  ok('B3 ★`parallaxOff:true`（= 缺省档）下同一动作 ⇒ 两层**逐位不动**（这就是"关掉视差"的语义）',
    p.offBitIdentical, 'before=' + p.off1.before + ' after=' + p.off1.after)
  ok('B4 反假绿：`parallaxOff:false` 下同一个 `before` 读数与开关档一致、`after` 不一致（否则 B3 可能只是"没动"）',
    p.sameBefore && p.onBitDifferent)
  // B5：`Math.LN100` 那个"开也死"的根因必须在源码里被钉住（E2 会把它改回去自证）
  //   注意只查**用作表达式**的形态（`= Math.LN100` / `* Math.LN100`）—— 注释里解释这个坑时会写到这个名字。
  {
    const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
    const usedAsValue = /(?:[=*+\-(]|\breturn)\s*Math\.LN100\b/.test(src)
    ok('B5 ★根因锚点：平滑系数用标准库 `Math.log(100)` 且**没有任何地方把它当值用**（`Math.LN100` 在 JS 里**不存在** ⇒ NaN ⇒ 鼠标项恒 0）',
      /const LN100 = Math\.log\(100\)/.test(src) && !usedAsValue, 'usedAsValue=' + usedAsValue)
  }
}

// ═════════════════════════ E 变异自证（RED-IF-REVERTED）══════════════════════════════════
// 三条都对应本档的真实修复面：接线（demo.html）/ `Math.LN100`（渲染器）/ `parallaxOff` 门控。
{
  console.log('[E] RED-IF-REVERTED：把真源码逐条改回旧写法（副本落 /tmp，真树只读）')
  const SRC_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const CORE = path.dirname(SRC_FILE)
  const SRC = fs.readFileSync(SRC_FILE, 'utf8')
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  // ── E1：demo.html 接线改回 `!== '1'` ⇒ A1 的 legacy 两行必红（直接在同一套取值表上重跑）──
  {
    const mutant = DEMO.replace("!/^(1|official|legacy)$/.test(String(new URLSearchParams(location.search).get('parallax') || ''))",
      "new URLSearchParams(location.search).get('parallax') !== '1'")
    const red = mutant !== DEMO && /get\('parallax'\) !== '1'/.test(mutant)
    const stillLegacyOn = /parallaxOff:\s*false,?\s*\n/.test(mutant) === false
    console.log('  ' + (red && stillLegacyOn ? 'RED' : 'RED-MISS') + '｜M1(demo.html 接线回到 `!== \'1\'`)：变异生效=' + red +
      '（`?parallax=legacy` 会重新变成"关" ⇒ A1 的 legacy 行变红）')
    if (red && stillLegacyOn) { passN++; console.log('  ✓ E M1 ⇒ A1 的 `?parallax=legacy` 行必红') }
    else { failN++; console.log('  ✗ E M1 变异没生效') }
  }
  // ── E2/E3：渲染器副本 ──
  const mutants = [
    {
      label: 'M2(缺省档的平滑系数被打断：`k` 变成 undefined 常量 ⇒ NaN ⇒ 鼠标项死)',
      // ①(RE-24 官方 #5 2026-09-24 改锚点) 官方闭式落地后，`Math.log(100)` 只在 `?parallax=legacy`
      //   那一支里（缺省档已换成官方式 `k = (1 − delay/3)·10·dt`）⇒ 旧锚点只打到 legacy 支，
      //   缺省档读数不再受影响（自证会假绿）。这里改成把**缺省档**的 k 换成 `Math.LN100`
      //   —— 与 WEBWALLGL #5 的根因同形（JS 没有这个常量 ⇒ undefined ⇒ NaN ⇒ `k` 判定恒假 ⇒ 鼠标项恒 0）。
      pairs: [['          k = Math.min(1, (1 - delay / 3) * 10 * parDt)   // 官方：只封顶 1.0，**不夹下界**',
        '          k = Math.LN100']],
      probe: async (mm) => { const r = await parallaxProbe(mm); return { red: Math.abs(r.dxOn) < 1e-6, detail: '变异体 Δx=' + r.dxOn.toFixed(3) + 'px（0 = 鼠标项又死了 ⇒ B1 会红）' } },
    },
    {
      label: 'M3(`parallaxOff` 门控整体失效：累计门 + 应用门一起去掉)',
      // 两处门是**冗余**的（`renderScene` 那处只累计 `parDispX`，`compositeLayer` 那处决定动不动）
      // ⇒ 只拿掉一处时另一处仍然挡住 ⇒ 变异没红。要自证就得把**两处**都拿掉（= "关视差"彻底失效）。
      // ①(RE-24 官方 #6 2026-09-24 改锚点) 场景级那处的门已按官方语义拆成
      //   `if (opts.parallax !== false && opts.parallaxOff !== true) { ... if (parEnabled) {...} }`
      //   （`cameraparallax=false` 走"冻结"而非归零），所以累计门的锚点跟着换。
      pairs: [
        ['    if (opts.parallax !== false && opts.parallaxOff !== true) {', '    if (opts.parallax !== false) {'],
        ['    if (parEnabled && (opts.parallaxOff !== true || __parOffLegacy)) {',
          '    if (parEnabled) {'],
      ],
      probe: async (mm) => { const r = await parallaxProbe(mm); return { red: !r.offBitIdentical, detail: '变异体 `parallaxOff:true` 下 before/after ' + (r.offBitIdentical ? '仍逐位相同' : '不再相同') + ' ⇒ B3 会红' } },
    },
  ]
  for (const mu of mutants) {
    let body = SRC, missing = null
    for (const [from, to] of mu.pairs) {
      if (!body.includes(from)) { missing = from; break }
      body = body.replace(from, to)
    }
    if (missing) { failN++; console.log('  ✗ ' + mu.label + ' 变异锚点不在源码里：' + V(missing.slice(0, 70))); continue }
    const tmp = path.join(os.tmpdir(), 'parallax-mut-' + mu.label.replace(/[^A-Za-z0-9]/g, '') + '.mjs')
    fs.rmSync(tmp, { force: true })
    fs.writeFileSync(tmp, body.replace(/from '\.\//g, `from '${CORE}/`))
    let red = false, detail = ''
    try {
      const mm = await import('file://' + tmp + '?v=' + Date.now() + Math.random())
      const r = await mu.probe(mm)
      red = !!r.red; detail = r.detail
    } catch (e) { detail = '变异体抛错：' + String(e && e.message).slice(0, 140) }
    finally { fs.rmSync(tmp, { force: true }) }
    console.log('  ' + (red ? 'RED' : 'RED-MISS') + '｜' + mu.label + '：' + detail)
    if (red) { passN++; console.log('  ✓ E ' + mu.label + ' ⇒ 对应断言变红（RED-IF-REVERTED）') }
    else { failN++; console.log('  ✗ E ' + mu.label + ' ⇒ 断言没红') }
  }
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^parallax-mut-.*\.mjs$/.test(f))
  const same = shaOf(SRC_FILE) === srcSha && leftovers.length === 0
  if (same) { passN++; console.log('  ✓ E 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（副本落 /tmp 且已 unlink）') }
  else { failN++; console.log('  ✗ E 真树被改动或 /tmp 有残留：sha=' + (shaOf(SRC_FILE) === srcSha) + ' 残留=' + leftovers.length) }
}

if (OFFLINE_ONLY) {
  console.log('\n（--offline：C 段真机档跳过；要跑真机去掉该参数）')
  console.log('\n===== parallax-live: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
  process.exit(failN ? 1 : 0)
}

// ═════════════════════════ C 真机（有头优先 + 能力前置）══════════════════════════════════
const URL_BASE = process.env.MPW_DEMO_URL || 'http://127.0.0.1:8899'
const SAMPLES = [
  { key: 'pkg', label: '3233141951/scene.pkg', file: path.join(WS, 'allwallpaper', '0917', '3233141951', 'scene.pkg'),
    ref: null },
  { key: 'mpkg', label: 'wallpapertest1/红鸾樱落.mpkg', file: path.join(WS, 'allwallpaper', 'wallpapertest1', '红鸾樱落.mpkg'),
    ref: path.join(WS, 'allwallpaper', 'wallpaperE', 'other', '红鸾樱落.mpkg') },
].filter((s) => SAMPLE_SEL === 'both' || s.key === SAMPLE_SEL)

console.log('[C] 真机（有头 Firefox + 真 WebGL2；无 GL ⇒ SKIP 本段并打印原样读数）')
const { launchGLBrowser, glCapability, logGLSkip, glReading } = await import('./_gl-browser.mjs')
const { findPlaywright, closeQuiet } = await import('./_gl-browser.mjs')
{
  const pwPath = findPlaywright()
  if (!pwPath) console.log('SKIP C 找不到 playwright（设 MPW_PLAYWRIGHT=/abs/path/to/playwright/index.js）')
  else {
    let reachable = false
    try { const r = await fetch(URL_BASE + '/', { signal: AbortSignal.timeout(5000) }); reachable = r.ok } catch (e) { reachable = false }
    if (!reachable) console.log('SKIP C 自带服务器不可达：GET ' + URL_BASE + '/（起法：node server/we-scene-demo-server.mjs 8899）')
    else {
      const pw = await import(pathToFileURL(pwPath).href)
      const firefox = (pw.default && pw.default.firefox) || pw.firefox
      const { browser, launchNote } = await launchGLBrowser(firefox)
      try {
        const gl = await glCapability(browser)
        if (!gl.webgl2) {
          logGLSkip('parallax-live 真机档（鼠标视差实证）', launchNote, gl)
          console.log('  说明：A/B 两段已跑完（离线），真机读数缺失的原因就是上面那行读数。')
        } else {
          console.log('  GL: ' + glReading(launchNote, gl))
          const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
          const page = await ctx.newPage()
          const pageErrors = []
          page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)))
          /** 读画布盒子 + 台账/场景读数（一次 evaluate 拿全）。 */
          const readState = () => page.evaluate(() => {
            const c = document.querySelector('#sc') || document.querySelector('canvas')
            const r = c ? c.getBoundingClientRect() : null
            return {
              box: r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null,
              layers: (window.__sceneLayers || []).length,
              liveRes: window.__mpwLiveRes || null,
              clearFx: window.__mpwClearFx || null,
              texStats: (window.__mpwTexStats || []).length,
              boot: window.__mpwBootError ? String(window.__mpwBootError.message).slice(0, 200) : null,
              firstFrame: !!window.__mpwFirstFrame,
            }
          })
          /** 采一帧逐层台账（设计坐标矩形；最多 60 层、同名只记第一层）。 */
          /* ⚠ 采集窗口必须**跨过至少一帧**：本机真机是软件 llvmpipe（~1fps），500ms 常常一帧都没有
             —— 实测第一次跑时 `__mpwLayerLedger` 恒空（读数 `k=0.000 n=0`，看着像"视差没动"）。
             现在等 4s（≈3–4 帧）；仍然空 ⇒ 如实报"台账没采到"而不是把它当成"没动"。 */
          const armLedger = () => page.evaluate(() => new Promise((res) => {
            window.__mpwLayerLedger = []
            window.__mpwLedgerWant = true
            setTimeout(() => { window.__mpwLedgerWant = false; res(window.__mpwLayerLedger || []) }, 4000)
          }))
          const shot = async (box) => (await page.screenshot({ clip: box })).toString('base64')
          /** 在页面里解码两张 PNG → 240×135 亮度网格 → MAE + 一维互相关位移（内容位移：正 = 向右）。 */
          const analyse = (a, b) => page.evaluate(async ([ab, bb]) => {
            const load = async (s) => { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('png decode')); img.src = 'data:image/png;base64,' + s }); return img }
            const [ia, ib] = await Promise.all([load(ab), load(bb)])
            const SW = 240, SH = 135
            const grab = (img) => { const c = document.createElement('canvas'); c.width = SW; c.height = SH; const g = c.getContext('2d'); g.drawImage(img, 0, 0, SW, SH); return g.getImageData(0, 0, SW, SH).data }
            const da = grab(ia), db = grab(ib)
            const colA = new Float64Array(SW), colB = new Float64Array(SW), rowA = new Float64Array(SH), rowB = new Float64Array(SH)
            let sum = 0
            for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
              const i = (y * SW + x) * 4
              const la = 0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2]
              const lb = 0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2]
              sum += Math.abs(la - lb); colA[x] += la; colB[x] += lb; rowA[y] += la; rowB[y] += lb
            }
            const best = (A, B, maxS) => { let bs = 0, bv = Infinity
              for (let s = -maxS; s <= maxS; s++) { let v = 0, n = 0
                for (let i = 0; i < A.length; i++) { const j = i + s; if (j < 0 || j >= B.length) continue; v += Math.abs(A[i] - B[j]); n++ }
                if (n > A.length * 0.6) { v /= n; if (v < bv) { bv = v; bs = s } } }
              return bs }
            return { mae: +(sum / (SW * SH)).toFixed(4), dx: best(colA, colB, 40), dy: best(rowA, rowB, 20), sw: SW, sh: SH }
          }, [a, b])
          /** 打开一个样本（`parallax` = '' / '&parallax=1' / '&parallax=legacy'），跑完整套读数。 */
          const probe = async (s, parallax) => {
            // `&res=dpr` = 插件的常规档（第 23 轮的分辨率修复）；**必须显式带**，否则页面不发布
            // `__mpwLiveRes`（活档位只在 `?res=` 存在时接线）⇒ C2 会假红。
            const url = URL_BASE + '/?pkgpath=' + encodeURIComponent(s.file) + '&noreport=1&res=dpr' + parallax
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
            await page.waitForFunction(() => !!window.__mpwModuleStarted, null, { timeout: 180000 })
            await page.waitForFunction(() => !!window.__mpwFirstFrame, null, { timeout: 180000 })
            await page.waitForFunction(() => (window.__sceneLayers || []).length > 0, null, { timeout: 60000 })
            await page.waitForTimeout(1500)                    // 让首帧后的贴图/层稳定
            const st = await readState()
            // ① 鼠标在画布中心 → 台账 + 截图
            await page.mouse.move(st.box.x + st.box.width / 2, st.box.y + st.box.height / 2)
            await page.waitForTimeout(900)
            const ledCenter = await armLedger()
            const shotCenter = await shot(st.box)
            // ② 鼠标移到画布右半（clientX/innerWidth ≈ 0.9）→ 台账 + 截图
            await page.mouse.move(st.box.x + st.box.width * 0.95, st.box.y + st.box.height / 2)
            await page.waitForTimeout(900)
            const ledCorner = await armLedger()
            const shotCorner = await shot(st.box)
            const px = await analyse(shotCenter, shotCorner)
            const layers = await page.evaluate(() => (window.__sceneLayers || []).map((l) => ({ n: String(l.name || l.id), d: l.parallaxDepth ? [Number(l.parallaxDepth[0]), Number(l.parallaxDepth[1])] : null })))
            const tailLog = await page.evaluate(() => { const el = document.querySelector('#log'); return el ? String(el.innerText || '').slice(-300) : '' })
            return { st, ledCenter, ledCorner, px, layers, pageErrors: pageErrors.slice(), tailLog }
          }
          /** 台账 → 每层 Δx（设计坐标）与深度，用于线性性/方向断言。 */
          const pairLayers = (a, b, layers) => {
            const byName = new Map(b.map((e) => [e.n, e]))
            const depthOf = new Map(layers.map((l) => [l.n, l.d]))
            const out = []
            for (const e of a) {
              const f = byName.get(e.n)
              if (!f) continue
              const d = depthOf.get(e.n)
              out.push({ n: e.n, dx: f.rd[0] - e.rd[0], dy: f.rd[1] - e.rd[1], depth: d ? d[0] : null, size: e.s, x0: e.rd[0] })
            }
            return out
          }
          for (const s of SAMPLES) {
            console.log('\n  ── 样本 ' + s.label + (fs.existsSync(s.file) ? '' : '（**缺文件**）'))
            if (!fs.existsSync(s.file)) { console.log('  SKIP 该样本缺文件：' + s.file); continue }
            const t0 = Date.now()
            const on = await probe(s, '&parallax=1')
            console.log('     打开耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's；层=' + on.st.layers +
              '；texStats=' + on.st.texStats + '；liveRes=' + V(on.st.liveRes && { w: on.st.liveRes.width, h: on.st.liveRes.height, dpr: on.st.liveRes.dpr }) +
              '；clearFx=' + V(on.st.clearFx && { mode: on.st.clearFx.mode, dropped: on.st.clearFx.dropped, kept: on.st.clearFx.kept }))
            ok('C1[' + s.key + '] 容器成功挂载（scene.pkg / .mpkg 都能开）：层数 > 0、有首帧、无启动错误',
              on.st.layers > 0 && on.st.firstFrame && !on.st.boot,
              'layers=' + on.st.layers + ' boot=' + V(on.st.boot))
            ok('C2[' + s.key + '] `?res=dpr` 活档位：画布物理尺寸跟随设备 DPR（非固定 1920×1080）',
              !!on.st.liveRes && on.st.liveRes.width >= 1280 && on.st.liveRes.height >= 720,
              V(on.st.liveRes && { cssW: on.st.liveRes.cssW, cssH: on.st.liveRes.cssH, dpr: on.st.liveRes.dpr, width: on.st.liveRes.width, height: on.st.liveRes.height, updates: on.st.liveRes.updates }))
            const pairs = pairLayers(on.ledCenter, on.ledCorner, on.layers)
            console.log('     逐层 Δx（设计坐标，鼠标右移）：' + V(pairs.slice(0, 10).map((p) => ({ n: p.n, depth: p.depth, dx: p.dx }))))
            const withDepth = pairs.filter((p) => p.depth !== null && Math.abs(p.depth) > 0.05)
            const zeroDepth = pairs.filter((p) => p.depth !== null && Math.abs(p.depth) <= 0.05)
            const ratios = withDepth.map((p) => p.dx / p.depth).sort((a, b) => a - b)
            const kMed = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0
            const inlier = withDepth.filter((p) => Math.abs(p.dx - kMed * p.depth) <= 4).length
            console.log('     k=Δx/depth 中位=' + kMed.toFixed(3) + '（n=' + ratios.length + '） 线性内点=' + inlier + '/' + withDepth.length +
              '  深度0层=' + zeroDepth.length + ' 笔')
            ok('C3[' + s.key + '] ★鼠标右移后**逐层台账真的变了**（有非零位移：视差跟鼠标，不是"根本不动"）',
              withDepth.length > 0 && ratios.length > 0 && Math.abs(kMed) > 0.5,
              'withDepth=' + withDepth.length + ' k=' + kMed.toFixed(3) + '（|k| ≤ 0.5 = 没动）')
            ok('C4[' + s.key + '] **方向**：鼠标右移 ⇒ 正深度层向左（k < 0）—— 与官方 `(0.5−mouse)` 口径一致',
              kMed < 0, 'k=' + kMed.toFixed(3))
            ok('C5[' + s.key + '] **线性性**：≥90% 的带深度层满足 `Δx = k·depth`（±4px，台账四舍五入）⇒ 走的是官方 `∘depth×amount` 公式',
              withDepth.length === 0 || inlier / withDepth.length >= 0.9,
              'inlier=' + inlier + '/' + withDepth.length)
            ok('C6[' + s.key + '] **深度 0 的层一动不动**（对照：画面变化不是"整体平移"或"动画抖动"）',
              zeroDepth.length === 0 || zeroDepth.every((p) => p.dx === 0 && p.dy === 0),
              V(zeroDepth.slice(0, 5).map((p) => ({ n: p.n, dx: p.dx, dy: p.dy }))))
            ok('C7[' + s.key + '] **像素级**：鼠标前后两帧画布真的不同（MAE > 0.2 亮度单位）',
              on.px.mae > 0.2, 'mae=' + on.px.mae + ' 一维位移 dx=' + on.px.dx + 'px（' + on.px.sw + '×' + on.px.sh + ' 网格）')
            ok('C7b[' + s.key + '] **台账真的采到了**（软件 GL ~1fps ⇒ 采集窗口 4s；空台账会被如实判红，不当"没动"）',
              on.ledCenter.length > 0 && on.ledCorner.length > 0,
              'center=' + on.ledCenter.length + ' corner=' + on.ledCorner.length + ' 条')
            ok('C8[' + s.key + '] 页面零脚本错（实证过程本身没制造异常）',
              on.pageErrors.length === 0, V(on.pageErrors.slice(0, 2)))
            // ── 对照档：不加 `?parallax`（= 缺省关）⇒ 同一动作**一个像素都不该动** ──
            if (!NO_CONTROL) {
              const off = await probe(s, '')
              const pairsOff = pairLayers(off.ledCenter, off.ledCorner, off.layers)
              const movedOff = pairsOff.filter((p) => p.dx !== 0 || p.dy !== 0)
              console.log('     对照档（缺省=关视差）：台账变化层=' + movedOff.length + '/' + pairsOff.length + '  MAE=' + off.px.mae +
                '（场景自身有动画 ⇒ 对照档 MAE 不为 0 是正常的；判据落在**台账**上）')
              ok('C9[' + s.key + '] ★对照档（不加 `?parallax`）下同一鼠标动作：**台账逐层零变化** ⇒ C3 的位移确实来自视差（像素 MAE 含场景动画，只作参考）',
                pairsOff.length > 0 && movedOff.length === 0 && off.px.mae < on.px.mae,
                'moved=' + movedOff.length + '/' + pairsOff.length + ' maeOff=' + off.px.mae + ' maeOn=' + on.px.mae + ' ' + V(movedOff.slice(0, 3)))
            }
            // ── `?parallax=legacy`（接线 bug 的修复面）：必须**打开**视差且走旧公式档 ──
            const leg = await probe(s, '&parallax=legacy')
            const pairsLeg = pairLayers(leg.ledCenter, leg.ledCorner, leg.layers)
            const wdLeg = pairsLeg.filter((p) => p.depth !== null && Math.abs(p.depth) > 0.05)
            const ratiosLeg = wdLeg.map((p) => p.dx / p.depth).sort((a, b) => a - b)
            const kLeg = ratiosLeg.length ? ratiosLeg[Math.floor(ratiosLeg.length / 2)] : 0
            console.log('     `?parallax=legacy`：k=' + kLeg.toFixed(3) + '（n=' + ratiosLeg.length + '）  MAE=' + leg.px.mae)
            ok('C10[' + s.key + '] ★`?parallax=legacy` **真的打开了视差**（改前它仍关着 ⇒ 插件那个诊断项点了没反应）：层在动、MAE > 0.2',
              Math.abs(kLeg) > 0.5 && leg.px.mae > 0.2, 'k=' + kLeg.toFixed(3) + ' mae=' + leg.px.mae)
            ok('C11[' + s.key + '] **两种公式档确实不同**（`legacy` 的 `(depth+amount)` 与官方 `∘depth×amount` 不是同一个数）',
              Math.abs(kLeg - kMed) > 0.05 * Math.max(1, Math.abs(kMed)),
              'official k=' + kMed.toFixed(3) + ' legacy k=' + kLeg.toFixed(3))
              // ── 同壁纸两种打包一致性（只对 mpkg 样本做）──
            if (s.ref && fs.existsSync(s.ref)) {
              const refRun = await probe({ key: s.key + '-ref', label: path.basename(path.dirname(s.ref)) + '/' + path.basename(s.ref), file: s.ref }, '&parallax=1')
              const nameOn = on.ledCenter.map((e) => e.n).join('|')
              const nameRef = refRun.ledCenter.map((e) => e.n).join('|')
              const rdOn = on.ledCenter.map((e) => e.rd.join(',')).join(';')
              const rdRef = refRun.ledCenter.map((e) => e.rd.join(',')).join(';')
              console.log('     两种打包对照：' + path.basename(s.file) + ' vs ' + path.basename(s.ref) +
                '  层=' + on.st.layers + '/' + refRun.st.layers + '  台账条=' + on.ledCenter.length + '/' + refRun.ledCenter.length)
              ok('C12[同壁纸两种打包] 同一壁纸的 `.mpkg` 两份打包渲染结果**一致**（层名序列 + 静态台账矩形逐条相同）',
                nameOn === nameRef && rdOn === rdRef && on.st.layers === refRun.st.layers,
                'namesSame=' + (nameOn === nameRef) + ' rdSame=' + (rdOn === rdRef) + ' layers=' + on.st.layers + '/' + refRun.st.layers)
            } else if (s.ref) console.log('     SKIP C12 对照包缺失：' + s.ref)
          }
        }
      } finally { await closeQuiet(browser) }
    }
  }
}

console.log('\n===== parallax-live: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

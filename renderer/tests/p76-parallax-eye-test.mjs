// p76-parallax-eye-test.mjs — P-76：两条真机 bug 的回归门禁（真包 3719111841 + mock-GL 真实绘制路径）
// 复现：node p76-parallax-eye-test.mjs
//
// 【问题 1】凯尔希「身后的背景没有」/ 屏幕左侧盖不到
//   真机证据：每一帧 `【帧N】左缘=178,178,178`（= 页面灰，没被覆盖）；台账 rd=[1430,-2518,4246,2546]
//   而官方标定 refrender[31]=[-208.63,-208.73,4244.28,2546.57]（应当满幅）⇒ Δx0=+1639。
//   根因（两处口径错，都在 `core/we-scene-bundle.js` compositeLayer）：
//     (A) 空间：官方对象级视差 offset=((node_pos−cam_pos)+mouse)∘depth×amount 是**世界像素**，
//         旧实现把它 mat4Translate 在 mat4Scale(m,w,h,1) **之后** ⇒ 又被 (w,h) 放大一次。
//         背景正常 w=4244.28 ⇒ offx 0.3863px → 1639.4px；offy 0.9193px → 2341.0px。
//     (B) 门控：`opts.parallaxOff`（demo 默认 true，注释写"视差整体停用"）旧实现只停鼠标项，
//         对象级 (node_pos−cam_pos) 项照旧生效。
//   本测试用 mock-GL 走**真实** render()/compositeLayer，逐字复刻 demo.html:3588-3626 + mpwLedgerYDown
//   的口径取实绘矩形，四态对拍：默认 / 仅空间回退 / 仅门控回退 / 双回退（= 真机 bug 复现，反证）。
//
// 【问题 2】凯尔希「眼睛位置不对」（眼皮与眼珠错位）
//   真机台账：眼睛组合(mesh) rd=[1912,541,305,253] sc=[1,1]；左眼皮(layer) rd=[2306,594,132,90]；
//   右眼上眼睑(mesh) rd=[2512,568,80,47] sc=[0.693,0.693]。
//   根因：`applyRenderConfig` 的 `?eyehack`（EYE_HACK_SCENES 白名单含 3719111841）写
//     `l.size=[405,120]; l.scale=[1,1,…]` —— 这是按"四边形层 w=size×scale"写的，但本层是 **puppet
//     蒙皮层**：demo.html:3521 把 layer.scale 直接当 u_Scale 交给 renderMeshLayer（不读 size/uvRect）
//     ⇒ 眼睛网格被放大 1/0.69297=1.4431 倍并从 x[2219,2430] 挪到 x[1912,2217]。
//   修法：把 es 反向折进 size（size×scale ≡ es ⇒ 四边形路径逐位不变），layer.scale 保持 authored。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import { installPuppet } from '../elysia/we-renderer/puppet.js'

// ① 模块级旗标（PARALLAX_SPACE_LEGACY 等）在 **import 时**按 location.search 求值；这里钉成空查询，
//   保证默认态 = 修复后；回退态一律走 opts.* 显式传入（同进程内可切两态，见 A3-A5）。
globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const r2 = (v) => Math.round(v * 100) / 100
const near = (a, b, tol) => Math.abs(a - b) <= tol

const ROOT = process.env.MPW_ROOT || WS
const DD = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const SCENE = '3719111841'
const PKG = path.join(DD, SCENE, 'scene.pkg')
const REF_PATH = './refrender-3719111841.json'
if (!fs.existsSync(PKG)) {
  console.log('SKIP p76-parallax-eye：缺真包 ' + PKG)
  process.exit(0)
}
const dec = new TextDecoder()
const pkgBytes = new Uint8Array(fs.readFileSync(PKG))
const REF = fs.existsSync(REF_PATH) ? JSON.parse(fs.readFileSync(REF_PATH, 'utf8')) : null
const sceneJsonText = () => {
  const p = lib.parsePkg(pkgBytes)
  return { p, txt: dec.decode(lib.getEntry(p, 'scene.json')).replace(/^\uFEFF/, '') }
}
const { p: PKG0, txt: SCENE_TXT } = sceneJsonText()
const entry = (n) => { const e = lib.getEntry(PKG0, n); return e ? new Uint8Array(e) : null }
// ① 与 demo.html:2812 同源：project.json 的 general.properties（`background` combo 决定 背景正常/暗色 谁可见）
const PROJECT = (() => {
  const p = path.join(DD, SCENE, 'project.json')
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null } catch (e) { return null }
})()
const PROPS_SCHEMA = (PROJECT && PROJECT.general && PROJECT.general.properties) || null
const PROPS = PROPS_SCHEMA ? lib.propsDefaults(PROPS_SCHEMA) : null

// ═══════════════════════ mock GL（与 render-audit.mjs 同款最小实现）═══════════════════════
function makeMockGL() {
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6,
    READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let ids = 0, curUnit = 0, curFbo = null, curProg = null, curBuf = null
  const bufData = new Map()
  const curTex = new Array(8).fill(null)
  const mk = (k) => ({ id: k + '#' + (++ids) })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: (t, f) => { curFbo = f }, useProgram: (p) => { curProg = p },
    bindBuffer: (t, b) => { curBuf = b },
    bufferData: (t, data) => { if (curBuf) bufData.set(curBuf.id, Array.from(data).slice(0, 10)) },
    drawArrays: () => {}, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_Alpha' ? 2 : -1,
    getUniformLocation: () => ({ u: 1 }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {}, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, CONST }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
const W = 3840, H = 2160

// 用真实 renderScene 画一遍，返回 { 层名: {rd, quad} }（口径 = demo.html:3588-3626 + mpwLedgerYDown）
async function gpuRects(renderOpts) {
  const { gl, CONST } = makeMockGL()
  const scene = lib.parseScene(JSON.parse(SCENE_TXT), null, { attachCtx: { readEntry: entry, time: 0 } })
  // 与 demo.html:2865 同参（rr=null：父链模式默认停用 refrender 绝对定位）
  lib.applyRenderConfig(scene, { sceneId: SCENE, refrender: null, anchor: 'refcenter', hideUI: true, hideParticles: true, clearBgFx: true, log: () => {}, properties: PROPS, propertiesSchema: PROPS_SCHEMA })
  const textures = new Map()
  for (const l of scene.layers) {
    try {
      if (!l.image) continue
      const me = entry(l.image); if (!me) continue
      const mj = JSON.parse(dec.decode(me)); if (!mj) continue
      const mat = lib.resolveMaterial(mj); if (!mat) continue
      const mate = entry(mat.materialPath); if (!mate) continue
      const material = JSON.parse(dec.decode(mate))
      const tn = material.passes && material.passes[0] && material.passes[0].textures && material.passes[0].textures[0]
      if (tn) { l.textureName = tn; if (!textures.has(tn)) textures.set(tn, { glTex: { __name: tn, id: 'tex_' + tn }, width: 1024, height: 1024 }) }
    } catch (e) {}
  }
  const out = {}
  const renderer = lib.createRenderer({ getContext: () => gl, width: W, height: H }, {
    onLog: () => {}, shaderResolver, onMeshLayer: () => {},
    onLayerDraw: (layer, info) => {
      if (gl.getParameter(CONST.FRAMEBUFFER_BINDING) !== null) return   // demo:3584 只记上屏那一趟
      const m = info.mvp
      const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
      const scr = (v, n) => (v * 0.5 + 0.5) * n
      const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
      const x0 = Math.round(scr(Math.min(A[0], B[0]), info.width)), x1 = Math.round(scr(Math.max(A[0], B[0]), info.width))
      const yA = scr(Math.min(A[1], B[1]), info.height), yB = scr(Math.max(A[1], B[1]), info.height)
      const projH = Number((scene.general && scene.general.orthogonalprojection && scene.general.orthogonalprojection.height)) || info.height
      const oyPx = (layer.origin && isFinite(Number(layer.origin[1]))) ? Number(layer.origin[1]) / projH * info.height : null
      const lo = Math.min(yA, yB), hi = Math.max(yA, yB)
      const flipped = (oyPx === null || !isFinite(Number(oyPx))) ? true
        : (Math.abs((info.height - (lo + hi) / 2) - Number(oyPx)) < Math.abs((lo + hi) / 2 - Number(oyPx)))
      const conv = (v) => (flipped ? (info.height - v) : v)
      const y0 = Math.round(Math.min(conv(lo), conv(hi))), y1 = Math.round(Math.max(conv(lo), conv(hi)))
      const nm = String(layer.name || layer.id).slice(0, 20)
      if (out[nm]) return
      out[nm] = { rd: [x0, y0, x1 - x0, y1 - y0], quad: [Math.round(info.quadW), Math.round(info.quadH)] }
    },
    trace: false, auditFrames: 1, copyBackground: false, clearBgFx: true, hideParticles: true,
    ...renderOpts,
  })
  await renderer.render(scene, textures, W, H, 1.0)
  return out
}

// ═══════════════════════ A. 背景层：视差空间 + 门控 ═══════════════════════
console.log('── A. 背景正常(31) 对象级视差：空间口径 + parallaxOff 门控（mock-GL 真实 compositeLayer）──')
const REF31 = REF ? REF['31'] : [-208.63, -208.73, 4244.28, 2546.57]
const wants = [
  // [名称, renderOpts, 期望 rd x0, 期望 rd y0, 容差, 期望"覆盖整屏"?, 期望"盖不到左缘"?]
  ['默认（parallaxOff=true，demo 缺省）', { parallaxOff: true }, -209, -209, 2, true, false],
  ['视差开（parallaxOff=false，鼠标居中 = disp 0）', { parallaxOff: false }, -208, -208, 2, true, false],
  // (A) 单独回退：门控是新的（parallaxOff=false 本来就不门控）+ 空间回退 ⇒ 位移被 w 放大 ⇒ 1639px bug
  ['仅空间回退 ?parspace=legacy（隔离 (A)：视差开，世界位移 0.386px × w）', { parallaxOff: false, parallaxSpaceLegacy: true }, 1431, -2519, 3, false, true],
  // (B) 单独回退：门控旧（不挡）+ 空间是新 ⇒ 位移仍只是 0.386 世界像素 ⇒ 无害（证明 (B) 不是 1639px 的来源）
  ['仅门控回退 ?paroff=legacy（隔离 (B)：世界位移 0.386px，本就不致 bug）', { parallaxOff: true, parallaxOffLegacy: true }, -208, -208, 2, true, false],
  // 双回退 = 真机配置（parallaxOff=true 只停鼠标项 + 位移后乘 S）⇒ 逐位复现真机台账
  ['双回退（= 真机 bug 复现，反证）', { parallaxOff: true, parallaxSpaceLegacy: true, parallaxOffLegacy: true }, 1431, -2519, 3, false, true],
  ['?parallax=legacy 旧公式（disp=0 → 位移 0）', { parallaxOff: true, parallaxLegacy: true, parallaxOffLegacy: true }, -209, -209, 2, true, false],
]
const got = {}
for (const [name, o, wx0, wy0, tol, cover, occl] of wants) {
  const r = await gpuRects(o)
  const bg = r['背景正常']
  got[name] = bg
  check('A 背景正常 有台账矩形（' + name + '）', !!bg, bg ? JSON.stringify(bg.rd) : 'missing')
  if (!bg) continue
  check('A rd.x0 = ' + wx0 + ' ±' + tol + '（' + name + '）', near(bg.rd[0], wx0, tol), 'got ' + bg.rd[0] + ' rd=' + JSON.stringify(bg.rd))
  check('A rd.y0 = ' + wy0 + ' ±' + tol + '（' + name + '）', near(bg.rd[1], wy0, tol), 'got ' + bg.rd[1])
  const covers = bg.rd[0] <= 1 && bg.rd[1] <= 1 && bg.rd[0] + bg.rd[2] >= W - 1 && bg.rd[1] + bg.rd[3] >= H - 1
  check('A ' + (cover ? '覆盖整屏 0..' + W + '/0..' + H + '（≤1px 出血）' : '确实盖不到左缘（bug 特征）') + '（' + name + '）', cover ? covers : !covers,
    'x=[' + bg.rd[0] + ',' + (bg.rd[0] + bg.rd[2]) + '] y=[' + bg.rd[1] + ',' + (bg.rd[1] + bg.rd[3]) + ']')
  if (occl) check('A 左侧被漏掉的宽度 > 1000px（' + name + '）', bg.rd[0] > 1000, 'x0=' + bg.rd[0])
}
if (REF) {
  const bg = got['默认（parallaxOff=true，demo 缺省）']
  check('A 默认态与官方标定 refrender[31] Δ=(0,0,≤1,≤1)',
    near(bg.rd[0], REF31[0], 1) && near(bg.rd[1], REF31[1], 1) && near(bg.rd[2], REF31[2], 1.5) && near(bg.rd[3], REF31[3], 1.5),
    'GPU=' + JSON.stringify(bg.rd) + ' 标定=' + JSON.stringify(REF31.map(r2)))
  check('A 默认态复现"左缘不再被漏"（x0 ≤ 0 < 3840 ≤ x1 且 y0 ≤ 0 < 2160 ≤ y1）',
    bg.rd[0] <= 0 && bg.rd[1] <= 0 && bg.rd[0] + bg.rd[2] >= W && bg.rd[1] + bg.rd[3] >= H)
}
// 位移量算式的直接断言（世界像素 vs 被 w/h 放大）
{
  const scene = lib.parseScene(JSON.parse(SCENE_TXT), null, { attachCtx: { readEntry: entry, time: 0 } })
  lib.applyRenderConfig(scene, { sceneId: SCENE, hideParticles: true, hideUI: true, log: () => {} })
  const l = scene.layers.find((x) => x.name === '背景正常')
  const camCx = 3840 / 2, camCy = 2160 / 2, amount = 0.34999999
  const offx = (l.origin[0] - camCx) * l.parallaxDepth[0] * amount
  const offy = (l.origin[1] - camCy) * l.parallaxDepth[1] * amount
  const w = l.size[0] * l.scale[0], h = l.size[1] * l.scale[1]
  check('A 世界像素位移 offx=' + r2(offx) + '（<1px，官方公式在居中满幅层上本就极小）', Math.abs(offx) < 1, 'offx=' + r2(offx))
  check('A 世界像素位移 offy=' + r2(offy) + '（<1px）', Math.abs(offy) < 1, 'offy=' + r2(offy))
  check('A 旧空间口径把它放大成 offx·w = ' + r2(offx * w) + ' ≈ +1639（真机台账 Δx0=+1638.6）', near(offx * w, 1639.4, 1.5), r2(offx * w))
  check('A 旧空间口径 offy·h = ' + r2(offy * h) + ' ≈ +2341', near(offy * h, 2341.0, 1.5), r2(offy * h))
  check('A 视差上限 |off| ≤ 40px ⇒ 不可能解释 1639px（排除"视差量级本身过大"）',
    Math.abs(0.5 * 3840 * 0.25 * l.parallaxDepth[0] * amount) + Math.abs(offx) < 40,
    'mouse 满偏上限 ' + r2(Math.abs(0.5 * 3840 * 0.25 * l.parallaxDepth[0] * amount)))
}
// alignment 偏移（问题清单第 1 条要求打印真实数字）
{
  const scene = lib.parseScene(JSON.parse(SCENE_TXT), null, {})
  lib.applyRenderConfig(scene, { sceneId: SCENE, log: () => {} })
  const hist = {}
  for (const l of scene.layers) hist[String(l.alignment)] = (hist[String(l.alignment)] || 0) + 1
  check('A 本包 43 层 alignment 全为 center（⇒ a=[0.5,0.5] ⇒ :6180 的 offset 恒 (0,0)，**不是** Δx 来源）',
    Object.keys(hist).length === 1 && hist.center === scene.layers.length, JSON.stringify(hist))
  const l = scene.layers.find((x) => x.name === '背景正常')
  const a = [0.5, 0.5]
  const w = l.size[0] * l.scale[0], h = l.size[1] * l.scale[1]
  check('A 背景正常 alignment 偏移 = (' + r2((0.5 - a[0]) * w) + ',' + r2((0.5 - a[1]) * h) + ') = (0,0)',
    (0.5 - a[0]) * w === 0 && (0.5 - a[1]) * h === 0)
  check('A 背景正常 w/h = ' + r2(w) + '×' + r2(h) + '（= 台账 rd 的 4244/2546 ⇒ 只有平移错、尺度不错）',
    near(w, 4244.28, 0.5) && near(h, 2546.57, 0.5))
}
// 只有这一层：同包 parallaxDepth 非 0 且可见的层，只有"背景正常"走四边形路径
{
  const raw = JSON.parse(SCENE_TXT)
  const scene = lib.parseScene(JSON.parse(SCENE_TXT), null, {})
  // 带上 project.json 的用户属性 ⇒ `background` combo（value "0"）选中 背景正常、关掉 背景暗色（与真机 vis=0 一致）
  lib.applyRenderConfig(scene, { sceneId: SCENE, hideParticles: true, hideUI: true, log: () => {}, properties: PROPS, propertiesSchema: PROPS_SCHEMA })
  const bgDark = scene.layers.find((l) => l.name === '背景暗色')
  check('A 用户属性 background=0 ⇒ 背景暗色 vis=0（真机 [首帧] #2 背景暗色 vis=0）', !!bgDark && bgDark.visible === false,
    bgDark ? 'visible=' + bgDark.visible : 'missing')
  const withPar = scene.layers.filter((l) => l.parallaxDepth && (l.parallaxDepth[0] || l.parallaxDepth[1]))
  const meshNames = new Set()
  for (const l of scene.layers) {
    if (!l.image) continue
    try { const mj = JSON.parse(dec.decode(entry(l.image))); if (mj && mj.puppet) meshNames.add(l.name) } catch (e) {}
  }
  const quadDrawn = withPar.filter((l) => l.visible && !meshNames.has(l.name))
  check('A 非 0 parallaxDepth 的层 ' + withPar.length + ' 个；其中"可见 + 四边形路径"仅 1 个 = 背景正常（= 为什么只有这一层）',
    quadDrawn.length === 1 && quadDrawn[0].name === '背景正常', quadDrawn.map((l) => l.name).join('/'))
  check('A 长发3（非 0 parallaxDepth）走蒙皮层 ⇒ 对象级视差对它不生效（故不受此 bug 影响）',
    meshNames.has('长发3') && withPar.some((l) => l.name === '长发3'))
  check('A 其余 15 个 parallaxDepth 层全是 "0 0" 或不可见',
    withPar.length + scene.layers.filter((l) => l.parallaxDepth && !l.parallaxDepth[0] && !l.parallaxDepth[1]).length === scene.layers.filter((l) => l.parallaxDepth).length)
  void raw
}

// ═══════════════════════ B. 眼睛：eyehack 覆写 scale ═══════════════════════
console.log('\n── B. 眼睛组合(115)：?eyehack 在蒙皮路径上覆写 layer.scale ──')
const PH = {}; installPuppet(PH)
function eyeState(cfg) {
  const scene = lib.parseScene(JSON.parse(SCENE_TXT), null, { attachCtx: { readEntry: entry, time: 0 } })
  lib.applyRenderConfig(scene, Object.assign({ sceneId: SCENE, hideParticles: true, hideUI: true, log: () => {} }, cfg))
  const eye = scene.layers.find((l) => l.name === '眼睛组合')
  const lidL = scene.layers.find((l) => l.name === '左眼皮')
  const lidR = scene.layers.find((l) => l.name === '右眼上眼睑')
  const model = JSON.parse(dec.decode(entry(eye.image)))
  const mesh = PH._parseMdl(entry(model.puppet))
  lib.meshBBox(mesh)
  const bb = mesh.__bbox
  const rectOf = (l, ySign) => {
    const w2 = l.size[0] * l.scale[0], h2 = l.size[1] * l.scale[1]
    return [l.origin[0] - Math.abs(w2) / 2, l.origin[0] + Math.abs(w2) / 2, l.origin[1] - Math.abs(h2) / 2, l.origin[1] + Math.abs(h2) / 2]
  }
  // ①(P-76) 每个 mesh 层用**自己的** bbox（勿把眼睛组合的 bbox 套到眼皮上 → 会假错 588px）
  const meshRect = (l, ySign) => {
    if (!l || !l.image) return null
    let m2 = null
    try { const mj = JSON.parse(dec.decode(entry(l.image))); if (mj && mj.puppet) m2 = PH._parseMdl(entry(mj.puppet)) } catch (e) {}
    if (!m2) return null
    const b2 = lib.meshBBox(m2)
    const xs = [l.origin[0] + l.scale[0] * b2[0], l.origin[0] + l.scale[0] * b2[2]]
    const ys = [l.origin[1] + (ySign * l.scale[1]) * b2[1], l.origin[1] + (ySign * l.scale[1]) * b2[3]]
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  }
  return { scene, eye, lidL, lidR, bbox: bb, eyeRect: meshRect(eye, -1), lidLRect: rectOf(lidL), lidRRect: meshRect(lidR, -1) }
}
const S_AFTER = eyeState({})
const S_BEFORE = eyeState({ eyeHackLegacy: true })
const S_OFF = eyeState({ eyeHack: false })
const S_PLAIN = (() => {
  const scene = lib.parseScene(JSON.parse(SCENE_TXT), null, { attachCtx: { readEntry: entry, time: 0 } })
  return scene.layers.find((l) => l.name === '眼睛组合')
})()
const cx = (r) => (r[0] + r[1]) / 2
const cy = (r) => (r[2] + r[3]) / 2

// B1 根因：scale 必等于父链解析出的世界 scale（= 同门 sibling 右眼上眼睑的 scale）
check('B1 眼睛组合 层级 scale = 0.69297（父链 115→91→475；对象无 scale 键）',
  near(S_PLAIN.scale[0], 0.69297, 1e-4), 'parseScene=' + r2(S_PLAIN.scale[0]))
check('B1 修复后 眼睛组合.scale 与 sibling 右眼上眼睑.scale 一致（同门同父，必须相等）',
  near(S_AFTER.eye.scale[0], S_AFTER.lidR.scale[0], 1e-9) && near(S_AFTER.eye.scale[1], S_AFTER.lidR.scale[1], 1e-9),
  'eye=' + r2(S_AFTER.eye.scale[0]) + ' lidR=' + r2(S_AFTER.lidR.scale[0]))
check('B1 修复前 眼睛组合.scale = 1（被 eyehack 覆写；= 真机台账 sc=[1,1]）',
  near(S_BEFORE.eye.scale[0], 1, 1e-9), 'legacy scale=' + S_BEFORE.eye.scale[0])
check('B1 放大倍数 1/0.69297 = 1.4431（真机 rd 宽 305 ⇒ 修复后 305×0.69297 = 211.4）',
  near(1 / S_PLAIN.scale[0], 1.4431, 0.001) && near(S_AFTER.eyeRect[1] - S_AFTER.eyeRect[0], 305 * 0.69297, 0.2),
  '1/s=' + r2(1 / S_PLAIN.scale[0]))

// B2 四边形路径不回归：size×scale 恒等于 405×120
check('B2 四边形路径几何不变：size×scale = 405×120（修复前 & 修复后逐位相同）',
  near(S_AFTER.eye.size[0] * S_AFTER.eye.scale[0], 405, 1e-6) && near(S_AFTER.eye.size[1] * S_AFTER.eye.scale[1], 120, 1e-6) &&
  near(S_BEFORE.eye.size[0] * S_BEFORE.eye.scale[0], 405, 1e-6) && near(S_BEFORE.eye.size[1] * S_BEFORE.eye.scale[1], 120, 1e-6),
  'after size=' + JSON.stringify(S_AFTER.eye.size.map(r2)) + ' → w/h=' + r2(S_AFTER.eye.size[0] * S_AFTER.eye.scale[0]) + '×' + r2(S_AFTER.eye.size[1] * S_AFTER.eye.scale[1]))
check('B2 uvRect（长条眼窗）仍写在层上，供四边形路径消费',
  Array.isArray(S_AFTER.eye.uvRect) && S_AFTER.eye.uvRect.length === 4, JSON.stringify(S_AFTER.eye.uvRect))

// B3 位置量化：眼珠 rect 中心 vs 眼皮（同口径 & 跨口径都给）
const dL_before = cx(S_BEFORE.eyeRect) - cx(S_BEFORE.lidLRect)
const dL_after = cx(S_AFTER.eyeRect) - cx(S_AFTER.lidLRect)
const dR_before = cx(S_BEFORE.eyeRect) - cx(S_BEFORE.lidRRect)
const dR_after = cx(S_AFTER.eyeRect) - cx(S_AFTER.lidRRect)
console.log('    [量化] 眼睛组合 bbox(设计) [-1001.18,-696.18]×[-146.28,106.96] bboxCenter=(-848.68,-19.66)')
console.log('    [量化] 眼睛组合 rect(设计) 修复前 x=[' + S_BEFORE.eyeRect.slice(0, 2).map(r2) + '] y=[' + S_BEFORE.eyeRect.slice(2).map(r2) + '] 中心=(' + r2(cx(S_BEFORE.eyeRect)) + ',' + r2(cy(S_BEFORE.eyeRect)) + ')')
console.log('    [量化] 眼睛组合 rect(设计) 修复后 x=[' + S_AFTER.eyeRect.slice(0, 2).map(r2) + '] y=[' + S_AFTER.eyeRect.slice(2).map(r2) + '] 中心=(' + r2(cx(S_AFTER.eyeRect)) + ',' + r2(cy(S_AFTER.eyeRect)) + ')')
console.log('    [量化] 左眼皮(layer)   x=[' + S_AFTER.lidLRect.slice(0, 2).map(r2) + '] 中心 x=' + r2(cx(S_AFTER.lidLRect)))
console.log('    [量化] 右眼上眼睑(mesh) x=[' + S_AFTER.lidRRect.slice(0, 2).map(r2) + '] 中心 x=' + r2(cx(S_AFTER.lidRRect)))
console.log('    [量化] Δ中心(眼珠−左眼皮) 修复前 ' + r2(dL_before) + 'px → 修复后 ' + r2(dL_after) + 'px')
console.log('    [量化] Δ中心(眼珠−右眼上眼睑) 修复前 ' + r2(dR_before) + 'px → 修复后 ' + r2(dR_after) + 'px')
// 判据依据：官方标定里"眼珠 rect 中心 − 左眼皮 rect 中心" = 2348.59 − 2371.86 = −23.3px（≤50 的来历）；
//   修复后 47.2px 属既有的 mesh-bbox vs author-size 口径分叉（门禁 layer-rect-kal 早记为"标定不可达"）。
const REF_EYE = REF ? [REF['115'][0] + REF['115'][2] / 2, REF['111'][0] + REF['111'][2] / 2] : [2348.59, 2371.86]
check('B3 官方标定：眼珠中心 x − 左眼皮中心 x = ' + r2(REF_EYE[0] - REF_EYE[1]) + 'px ⇒ 期望 |Δ| ≤ 50px（容差来历）',
  Math.abs(REF_EYE[0] - REF_EYE[1]) <= 50, 'Δ=' + r2(REF_EYE[0] - REF_EYE[1]))
check('B3 修复后 |Δ中心(眼珠−左眼皮)| = ' + r2(Math.abs(dL_after)) + 'px ≤ 50px（眼珠与眼皮同区）',
  Math.abs(dL_after) <= 50)
check('B3 修复前 |Δ中心(眼珠−左眼皮)| = ' + r2(Math.abs(dL_before)) + 'px > 300px（反证：断言能抓住 bug）',
  Math.abs(dL_before) > 300)
check('B3 修复后 x 区间与左眼皮 x 区间有 ≥100px 重叠（修复前 0 重叠）',
  Math.min(S_AFTER.eyeRect[1], S_AFTER.lidLRect[1]) - Math.max(S_AFTER.eyeRect[0], S_AFTER.lidLRect[0]) >= 100 &&
  Math.min(S_BEFORE.eyeRect[1], S_BEFORE.lidLRect[1]) - Math.max(S_BEFORE.eyeRect[0], S_BEFORE.lidLRect[0]) <= 0,
  'after 重叠=' + r2(Math.min(S_AFTER.eyeRect[1], S_AFTER.lidLRect[1]) - Math.max(S_AFTER.eyeRect[0], S_AFTER.lidLRect[0])) +
  ' before 重叠=' + r2(Math.min(S_BEFORE.eyeRect[1], S_BEFORE.lidLRect[1]) - Math.max(S_BEFORE.eyeRect[0], S_BEFORE.lidLRect[0])))
// 位移恒等式：ΔcenterX = (scale_new − scale_old) × bboxCenterX = (−0.30703) × (−848.68) = +260.57
check('B3 修复把眼珠 rect 整体右移 ' + r2(cx(S_AFTER.eyeRect) - cx(S_BEFORE.eyeRect)) + 'px（= (1−0.69297)×|bboxCenterX 848.68| = 260.57；方向朝眼皮）',
  near(cx(S_AFTER.eyeRect) - cx(S_BEFORE.eyeRect), 260.57, 0.5) && cx(S_AFTER.eyeRect) > cx(S_BEFORE.eyeRect),
  'bboxCenter=(' + r2(S_AFTER.bbox[0]) + '..' + r2(S_AFTER.bbox[2]) + ') → centerX=' + r2((S_AFTER.bbox[0] + S_AFTER.bbox[2]) / 2))
// 钉住数值（真机台账 rd=[1912,541,305,253] 与修复前公式逐位一致 ⇒ 证明"设备上画的就是 scale=1"）
check('B3 修复前公式逐位复现真机台账 rd=[1912,541,305,253]（⇒ 设备上画的就是 scale=1）',
  Math.abs(Math.round(S_BEFORE.eyeRect[0]) - 1912) <= 1 && Math.abs(Math.round(S_BEFORE.eyeRect[2]) - 541) <= 1 &&
  Math.abs(Math.round(S_BEFORE.eyeRect[1] - S_BEFORE.eyeRect[0]) - 305) <= 1,
  'got=[' + S_BEFORE.eyeRect.map((v) => Math.round(v)).join(',') + ']')
if (REF) {
  // 同口径 mesh↔mesh：官方标定里"眼珠中心 − 右眼上眼睑中心" = 2348.59 − 2553.30 = −204.71px
//   （⚠ 两者在官方画面里本来就相距 ~205px：右眼上眼睑是**右**眼的上睑，不在眼珠框内 ——
//    所以"眼珠 bbox 中心落进眼睑 bbox、误差 ≤20px"这个期望是错的，不能拿来当判据；
//    正确判据是"与官方同一差值的一致性"，见下条。）
const REF_D_R = REF ? (REF['115'][0] + REF['115'][2] / 2) - (REF['67'][0] + REF['67'][2] / 2) : -204.71
check('B3 同口径(mesh↔mesh) 修复后 Δ中心(眼珠−右眼上眼睑)=' + r2(dR_after) + ' 与官方同一差值 ' + r2(REF_D_R) + ' 相差 ' + r2(Math.abs(dR_after - REF_D_R)) + 'px ≤ 25px',
  Math.abs(dR_after - REF_D_R) <= 25)
check('B3 同口径 修复前 Δ中心(眼珠−右眼上眼睑)=' + r2(dR_before) + ' 与官方差 ' + r2(Math.abs(dR_before - REF_D_R)) + 'px > 250px（反证）',
  Math.abs(dR_before - REF_D_R) > 250)
// y 方向**不具判别力**：scale 只把 y 中心挪了 6.03px（668.03→662.00），因为 bboxCenterY=−19.66 近 0。
//   官方"眼珠 y 框含右眼上眼睑 y 框"，但我们修好后眼珠 bbox 高 175.5 < 官方框 277.9（同一 bbox/size
//   口径分叉）⇒ 只断言"y 带重叠 ≥ 40px（= 眼睑高的 84%）"，不断言包含。
check('B3 同口径 修复后眼珠 y 带与右眼上眼睑 y 带重叠 ' +
  r2(Math.min(S_AFTER.eyeRect[3], S_AFTER.lidRRect[3]) - Math.max(S_AFTER.eyeRect[2], S_AFTER.lidRRect[2])) + 'px ≥ 40px（y 不具判别力：scale 只挪 y 中心 6.03px）',
  Math.min(S_AFTER.eyeRect[3], S_AFTER.lidRRect[3]) - Math.max(S_AFTER.eyeRect[2], S_AFTER.lidRRect[2]) >= 40,
  'eyeY=[' + S_AFTER.eyeRect.slice(2).map(r2) + '] lidRY=[' + S_AFTER.lidRRect.slice(2).map(r2) + '] y中心 ' + r2(cy(S_BEFORE.eyeRect)) + '→' + r2(cy(S_AFTER.eyeRect)))
check('B3 修复后与官方标定 115 的中心差 = (' + r2(cx(S_AFTER.eyeRect) - (REF['115'][0] + REF['115'][2] / 2)) + ',' + r2(cy(S_AFTER.eyeRect) - (REF['115'][1] + REF['115'][3] / 2)) + ') —— 与 layer-rect-kal 的 Δc=(-24,76) 同源（口径分叉，非位移 bug）',
    near(cx(S_AFTER.eyeRect), REF['115'][0] + REF['115'][2] / 2, 25) && near(cy(S_AFTER.eyeRect), REF['115'][1] + REF['115'][3] / 2, 80))
  check('B3 修复前与官方标定 115 的中心差 x = ' + r2(cx(S_BEFORE.eyeRect) - (REF['115'][0] + REF['115'][2] / 2)) + 'px（|Δ|>250 ⇒ 真错位）',
    Math.abs(cx(S_BEFORE.eyeRect) - (REF['115'][0] + REF['115'][2] / 2)) > 250)
}

// B4 回退开关：?eyehack=legacy 恢复旧口径
check('B4 回退开关 ?eyehack=legacy 精确复现旧行为（scale=1、size=405×120、rect 同修复前）',
  near(S_BEFORE.eye.scale[0], 1, 1e-9) && near(S_BEFORE.eye.size[0], 405, 1e-9) && near(S_BEFORE.eye.size[1], 120, 1e-9) &&
  Math.abs(cx(S_BEFORE.eyeRect) - 2064.17) <= 0.5, 'center=' + r2(cx(S_BEFORE.eyeRect)))
check('B4 回退开关 ?eyehack=0 保持 authored scale（A/B 可用）',
  near(S_OFF.eye.scale[0], 0.69297, 1e-4) && S_OFF.eye.uvRect === undefined, 'scale=' + r2(S_OFF.eye.scale[0]))

// B5 代码级：蒙皮路径不消费 size/uvRect（⇒ hack 的"长条眼窗"在蒙皮层上本来就没生效）
{
  const src = fs.readFileSync('./core/we-scene-bundle.js', 'utf8')
  const a = src.indexOf('function renderMeshLayer(')
  const b = src.indexOf('// ①(RE-33) bloom 链程序', a)
  const body = (a >= 0 && b > a) ? src.slice(a, b) : ''
  check('B5 renderMeshLayer 源码切片可定位（' + body.length + ' 字符）', body.length > 1500)
  check('B5 renderMeshLayer 体内 **不读** layer.uvRect（长条眼窗在蒙皮路径上无消费点）', !/uvRect/.test(body))
  check('B5 renderMeshLayer 体内 **不读** layer.size（几何只来自 MDL 顶点 × u_Scale）', !/layer\.size/.test(body))
  check('B5 renderMeshLayer 体内读 layer.scale 的调用方（u_Scale 由 demo 传 layer.scale）—— 故覆写 scale 必然改变蒙皮几何',
    /uniform2f\(meshUni\.scale/.test(body))
  check('B5 uvRect 的消费点只有四边形路径（compositeLayer :6xxx）与 localQuadVertsUV',
    (src.match(/layer\.uvRect/g) || []).length >= 1 && src.indexOf('layer.uvRect') > src.indexOf('function renderMeshLayer('))
}

// ═══════════════════════ C. ?bones= 探针的 det（镜像）增强（父 agent 追加项）═══════════════════════
//   动机：`[ang,tx,ty]` 反解自 pose 矩阵，而**负行列式（镜像）解出来的角度可以看起来完全正常**
//   ⇒ "180 帧 0 次 angle flip" 只能排除"角度反号/长边插值"，排除不了"眉毛左右翻转是镜像"。
//   这里用真实 puppet 网格做载体、只改 gBones，钉住 det 通道。
console.log('\n── C. ?bones= 逐骨探针：det（镜像）与两轴 scale 符号 ──')
{
  const I16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const MIRROR_X = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]   // det = −1（x 镜像）
  const ROT180 = [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]   // det = +1（纯 180° 旋转）
  const mj = JSON.parse(dec.decode(entry('models/眼睛组合.json')))
  const bmesh = PH._parseMdl(entry(mj.puppet))
  const nb = bmesh.bones.length
  const layerStub = { id: 990976, name: 'P76镜像桩', size: [100, 100], scale: [1, 1, 1], origin: [1920, 1080, 0], angles: [0, 0, 0], alpha: 1 }
  // bindWorld（行主序），用于核对 bonds[b][0..2] 与 det 期望
  const mulRow = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]; o[r * 4 + c] = s } return o }
  // ①(P-110 2026-09-17) 与渲染器同源（子先乘修正序；旧序见 `?bindorder=legacy`）
  const bw = lib.bindWorldChain(bmesh.bones)
  const gOf = (perBone) => { const g = new Float32Array(nb * 16); for (let b = 0; b < nb; b++) g.set(perBone(b), b * 16); return g }
  // 跑一次探针：search 决定 BONES_WANT（它是 createRenderer 期读 location 的，非 import 期）
  const probe = (search, seq) => {
    const prevLoc = globalThis.location
    globalThis.location = { search, href: 'http://localhost/' + search }
    const { gl } = makeMockGL()
    const r = lib.createRenderer({ getContext: () => gl, width: W, height: H }, { onLog: () => {}, shaderResolver, trace: false })
    try { delete globalThis.__mpwBones } catch (e) {}
    for (const g of seq) r.renderMeshLayer(layerStub, bmesh, g, nb, [1920, 1080], [1, -1], [W, H], { id: 'tex#stub' })
    const got = globalThis.__mpwBones
    try { delete globalThis.__mpwBones } catch (e) {}
    globalThis.location = prevLoc
    return got
  }
  const offC = probe('', [gOf(() => I16)])
  check('C1 默认（无 ?bones=）⇒ 探针一个字段都不写（__mpwBones === undefined，契约保持）', offC === undefined)

  const gI = gOf(() => I16)
  const onI = probe('?bones=P76镜像桩', [gI])
  check('C1 ?bones= 点名 ⇒ 写出 mirror 字段且为数组', !!onI && Array.isArray(onI.mirror), onI ? 'mirror=' + JSON.stringify(onI.mirror) : 'missing')
  check('C2 正常姿势（gBones=I，bindWorld 全 det=+1）⇒ 镜像骨列表为空（不误记）',
    !!onI && onI.mirror.length === 0, onI ? JSON.stringify(onI.mirror) : 'missing')
  check('C2 正常姿势 detS=+1、sxS=+1、syS=+1（索引 3/4/5）',
    !!onI && onI.frames[0].bones.every((bb) => bb[3] === 1 && bb[4] === 1 && bb[5] === 1),
    onI ? JSON.stringify(onI.frames[0].bones[0]) : 'missing')
  check('C2 既有 [ang,tx,ty] 前缀逐位不变（== bindWorld 极坐标，maxErr<1e-4；长度 ≥6 表示只追加）',
    (() => { if (!onI) return false; const f0 = onI.frames[0].bones; if (f0[0].length < 6) return false; let e = 0; for (let b = 0; b < nb; b++) e = Math.max(e, Math.abs(f0[b][0] - Math.atan2(bw[b][1], bw[b][0])), Math.abs(f0[b][1] - bw[b][12]), Math.abs(f0[b][2] - bw[b][13])); return e < 1e-4 })(),
    onI ? 'len=' + onI.frames[0].bones[0].length : 'missing')

  // 桩姿势：只让 b0 带 x 镜像
  const gMir = gOf((b) => (b === 0 ? MIRROR_X : I16))
  const onM = probe('?bones=P76镜像桩', [gMir])
  check('C2 桩姿势（b0 的 gBones=diag(−1,1,1)，det=−1）⇒ b0 被记进"镜像骨"',
    !!onM && onM.mirror.length === 1 && onM.mirror[0] === 0, onM ? JSON.stringify(onM.mirror) : 'missing')
  check('C2 桩姿势 b0 的 detS=−1、sxS=−1、syS=+1（x 镜像的特征：det<0 但 sy 仍正 ⇒ 与纯 180° 旋转可区分）',
    !!onM && onM.frames[0].bones[0][3] === -1 && onM.frames[0].bones[0][4] === -1 && onM.frames[0].bones[0][5] === 1,
    onM ? JSON.stringify(onM.frames[0].bones[0]) : 'missing')
  check('C2 桩姿势下其它 13 根骨未被误记（只 b0 变）',
    !!onM && onM.mirror.length === 1 && onM.frames[0].bones.slice(1).every((bb) => bb[3] === 1))

  // 纯 180° 旋转（det=+1）必须**不**被记成镜像 —— 否则"左右翻转"与"镜像"就分不开了
  const gRot = gOf(() => ROT180)
  const onR = probe('?bones=P76镜像桩', [gRot])
  check('C2 纯 180° 旋转（diag(−1,−1)，det=+1）⇒ 不算镜像（mirror 空）但 sxS=syS=−1 ⇒ 两条判据正交',
    !!onR && onR.mirror.length === 0 && onR.frames[0].bones.every((bb) => bb[3] === 1 && bb[4] === -1 && bb[5] === -1),
    onR ? 'mirror=' + JSON.stringify(onR.mirror) + ' bone0=' + JSON.stringify(onR.frames[0].bones[0]) : 'missing')

  // det 跨帧翻转 = 镜像事件（角度判据看不见）
  const onFlip = probe('?bones=P76镜像桩', [gI, gMir])
  const flipsDet = onFlip ? (onFlip.frames[1].flips || []).filter((f) => f.det) : []
  const flipsAng = onFlip ? (onFlip.frames[1].flips || []).filter((f) => !f.det) : []
  check('C3 det 符号跨帧翻转（+1 → −1）被记成 flips 里的一条 {b:0, det:1}',
    flipsDet.length === 1 && flipsDet[0].b === 0 && flipsDet[0].from === 1 && flipsDet[0].to === -1,
    JSON.stringify(flipsDet))
  // ⚠ 关键 nuance（我自己一开始也写错了期望）：**x 镜像同时也会让 ang 跳 π**
  //   （diag(−1,1,1)：m00 由 +1→−1 ⇒ ang=atan2(m10,m00)=atan2(0,−1)=π）—— 这正是"角度通道分不出镜像"的原因。
  //   ⇒ 判定规则必须**两个通道一起看**：
  //      |Δang| ≈ π 且 **det 翻转**  → 镜像（本次新增通道才能判）
  //      |Δang| ≈ π 且 **det 不变**  → 真的转了 180°（不是镜像）
  check('C3 镜像事件同时给出两条：angle 跳 π **且** det(+1→−1) —— 单看角度无法区分，这就是加 det 的理由',
    flipsAng.length === 1 && Math.abs(Math.abs(flipsAng[0].d) - Math.PI) < 1e-3 && flipsDet.length === 1,
    'angle=' + JSON.stringify(flipsAng) + ' det=' + JSON.stringify(flipsDet))
  // 对照组：纯 180° 旋转 ⇒ angle 同样跳 π，但 det 不翻 ⇒ 不是镜像
  const onRot2 = probe('?bones=P76镜像桩', [gI, gRot])
  const rAng = onRot2 ? (onRot2.frames[1].flips || []).filter((f) => !f.det) : []
  const rDet = onRot2 ? (onRot2.frames[1].flips || []).filter((f) => f.det) : []
  check('C3 对照组：纯 180° 旋转同样 angle 跳 π，但 **det 不翻**（detF=0）且 mirror 空 ⇒ 与镜像正交可判',
    rAng.length === nb && Math.abs(Math.abs(rAng[0].d) - Math.PI) < 1e-3 && rDet.length === 0 && onRot2.mirror.length === 0,
    'angleFlips=' + rAng.length + '/' + nb + ' detFlips=' + rDet.length + ' mirror=' + JSON.stringify(onRot2.mirror))
  check('C3 __mpwBones.mirror 反映**本帧**（第二帧 b0 已镜像）', !!onFlip && onFlip.mirror.length === 1 && onFlip.mirror[0] === 0)
  check('C4 [bones] 摘要行包含"镜像骨(det<0)"与"det跨帧翻转"两节',
    (() => {
      const src = fs.readFileSync('./core/we-scene-bundle.js', 'utf8')
      return src.includes("' | 镜像骨(det<0): ' + mirTxt + ' | det跨帧翻转: ' + detFlipsTxt")
    })())
}

// ═══════════════════════ D. 用户属性绑定 volume / zoom（父 agent 追加项）═══════════════════════
console.log('\n── D. user-property bindings: volume / zoom ──')
{
  // D1 语料扫描：这两个键**实际出现在哪类对象上**（判据来自场景本体，不是我拍的）
  const DD = path.join(ROOT, 'allwallpaper', 'dd')
  const ids = fs.existsSync(DD) ? fs.readdirSync(DD).filter((d) => fs.existsSync(path.join(DD, d, 'scene.pkg'))) : []
  const vol = [], zm = []
  for (const id of ids) {
    let pkg2, sj2
    try { pkg2 = lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(DD, id, 'scene.pkg')))) } catch (e) { continue }
    const e2 = lib.getEntry(pkg2, 'scene.json'); if (!e2) continue
    try { sj2 = JSON.parse(dec.decode(e2).replace(/^\uFEFF/, '')) } catch (e) { continue }
    for (const o of (sj2.objects || [])) {
      if (o.volume !== undefined) vol.push({ id, oid: o.id, sound: !!o.sound, camera: typeof o.camera === 'string', image: o.image || null, v: o.volume })
      if (o.zoom !== undefined) zm.push({ id, oid: o.id, sound: !!o.sound, camera: typeof o.camera === 'string', v: o.zoom })
    }
  }
  check('D1 语料 ' + ids.length + ' 个 dd 包里 `volume` 命中 ' + vol.length + ' 处 —— **全部**在 `sound` 对象上',
    vol.length > 0 && vol.every((x) => x.sound),
    '非 sound 的: ' + JSON.stringify(vol.filter((x) => !x.sound).slice(0, 3)))
  check('D1 语料 `zoom` 命中 ' + zm.length + ' 处 —— **全部**在 `camera` 为字符串的相机对象上',
    zm.length > 0 && zm.every((x) => x.camera),
    '非 camera 的: ' + JSON.stringify(zm.filter((x) => !x.camera).slice(0, 3)))
  const volPkgs = [...new Set(vol.map((x) => x.id))], zmPkgs = [...new Set(zm.map((x) => x.id))]
  check('D1 去重后 volume ' + volPkgs.length + ' 包 / zoom ' + zmPkgs.length + ' 包', volPkgs.length >= 5 && zmPkgs.length >= 3,
    'volume=' + volPkgs.join(',') + ' zoom=' + zmPkgs.join(','))
  check('D1 volume 的值形态：要么是 0..1 的数，要么是 `{user,value}`（后者 = 面板滑块）',
    vol.every((x) => typeof x.v === 'number' || (x.v && typeof x.v === 'object' && x.v.user !== undefined)),
    JSON.stringify(vol.slice(0, 2).map((x) => x.v)))
  check('D1 zoom 的值形态：`{user:…}` 或 `{animation:…}`（后者=时间驱动运镜）',
    zm.every((x) => x.v && typeof x.v === 'object' && (x.v.user !== undefined || x.v.animation)),
    JSON.stringify(zm.slice(0, 2).map((x) => x.v)))

  // D5 `volume` 在本文件**无落点** ⇒ 明确"不接"（并证明不是漏看）
  {
    // 只统计**非注释**代码行（本补丁的注释里就写着 "volume/gain/setVolume 零命中"，不剔除会自证其反）
    const src = fs.readFileSync('./core/we-scene-bundle.js', 'utf8')
    const code = src.split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))                 // 去行尾注释
      .filter((l) => !/^\s*(\/\*|\*)/.test(l))              // 去块注释行
      .join('\n')
    const nVol = (code.match(/\bvolume\b/g) || []).length
    const nGain = (code.match(/\bgain\b|setVolume/g) || []).length
    check('D5 bundle 的**非注释代码**里 `volume`/`gain`/`setVolume` 零命中（音频链整条在宿主 ⇒ 本文件无落点）',
      nVol === 0 && nGain === 0, '非注释 volume=' + nVol + ' gain/setVolume=' + nGain)
    check('D5 `USER_BIND_KEYS` 不含 volume（不塞没人读的假字段）',
      !lib.USER_BIND_KEY_LIST.includes('volume'), JSON.stringify(lib.USER_BIND_KEY_LIST))
    check('D5 宿主侧确有落点：demo.html 的 currentAudioVolume/soundLayerVolumeBinding（只读引用，跨文件只做存在性断言）',
      (() => { try { const d = fs.readFileSync('./demo.html', 'utf8'); return d.includes('function currentAudioVolume(') && d.includes('function soundLayerVolumeBinding(') && d.includes('function updateSceneAudioVolume(') } catch (e) { return false } })())
  }

  // D2 + D3 `zoom` 在真实包上的绑定解析 + 端到端投影
  const ZPKG = '3326873240'
  const zp = path.join(DD, ZPKG, 'scene.pkg')
  const zproj = path.join(DD, ZPKG, 'project.json')
  if (!fs.existsSync(zp) || !fs.existsSync(zproj)) {
    console.log('  SKIP D2/D3（缺包 ' + ZPKG + '）')
  } else {
    const schema = JSON.parse(fs.readFileSync(zproj, 'utf8')).general.properties
    const mkScene = () => {
      const pkg2 = lib.parsePkg(new Uint8Array(fs.readFileSync(zp)))
      const e2 = (n) => { const x = lib.getEntry(pkg2, n); return x ? new Uint8Array(x) : null }
      const sj2 = JSON.parse(dec.decode(e2('scene.json')).replace(/^\uFEFF/, ''))
      return { scene: lib.parseScene(JSON.parse(JSON.stringify(sj2)), null, {}), readEntry: e2 }
    }
    check('D2 newproperty30 是面板滑块且语义就是镜头缩放（text 含"镜头大小/Lens size"、min/max 0.1~2、默认 1）',
      (() => { const s = schema.newproperty30; return s && s.type === 'slider' && /Lens size|镜头大小/.test(s.text) && s.min === 0.1 && s.max === 2 && s.value === 1 })(),
      JSON.stringify(schema.newproperty30 && { type: schema.newproperty30.type, min: schema.newproperty30.min, max: schema.newproperty30.max, value: schema.newproperty30.value }))
    // 默认（面板值=1）与"无 props"必须都不注入 pose ⇒ 逐位不变
    const s0 = mkScene(); lib.applyUserProperties(s0.scene, lib.propsDefaults(schema), { schema })
    check('D2 面板默认值 1 ⇒ zoomFromUser=1（已解析）但**不注入 camPose**（zoom===1 与今天逐位相同）',
      s0.scene.cameraNode.zoomFromUser === 1 && s0.scene.cameraNode.active === false)
    const sN = mkScene(); lib.applyUserProperties(sN.scene, null, {})
    check('D2 无属性表 ⇒ zoomFromUser=null（零副作用）', sN.scene.cameraNode.zoomFromUser === null)
    const sP = mkScene(); lib.applyUserProperties(sP.scene, Object.assign(lib.propsDefaults(schema), { newproperty30: 1.6 }), { schema })
    check('D2 ?props=newproperty30=1.6 ⇒ 相机节点 zoomFromUser 确实变成 1.6（"改属性 → 目标字段变"）',
      sP.scene.cameraNode.zoomFromUser === 1.6, String(sP.scene.cameraNode.zoomFromUser))
    const sBad = mkScene(); lib.applyUserProperties(sBad.scene, Object.assign(lib.propsDefaults(schema), { newproperty30: -3 }), { schema })
    check('D2 非法 zoom（≤0）不写入（不被面板缩到 0/负）', sBad.scene.cameraNode.zoomFromUser === null)

    // D3 端到端：mock-GL 真实 renderScene，逐层 mvp 的 m0/m5 比值必须**恰好等于** zoom 比值
    const gpuZoom = async (zoomVal) => {
      const { gl, CONST } = makeMockGL()
      const { scene, readEntry } = mkScene()
      const props = Object.assign(lib.propsDefaults(schema), zoomVal === null ? {} : { newproperty30: zoomVal })
      lib.applyRenderConfig(scene, { sceneId: ZPKG, hideParticles: true, hideUI: true, log: () => {}, properties: props, propertiesSchema: schema })
      const tex = new Map()
      for (const l of scene.layers) {
        if (!l.image) continue
        try {
          const mj = JSON.parse(dec.decode(readEntry(l.image))); const mat = lib.resolveMaterial(mj); if (!mat) continue
          const me = readEntry(mat.materialPath); if (!me) continue
          const M = JSON.parse(dec.decode(me)); const tn = M.passes && M.passes[0] && M.passes[0].textures && M.passes[0].textures[0]
          if (tn) { l.textureName = tn; if (!tex.has(tn)) tex.set(tn, { glTex: { __name: tn, id: 't' }, width: 64, height: 64 }) }
        } catch (e) {}
      }
      const out = {}
      const r = lib.createRenderer({ getContext: () => gl, width: W, height: H }, {
        onLog: () => {}, shaderResolver, onMeshLayer: () => {}, trace: false, auditFrames: 1, hideParticles: true, clearBgFx: true,
        onLayerDraw: (layer, info) => {
          if (gl.getParameter(CONST.FRAMEBUFFER_BINDING) !== null) return
          const nm = String(layer.name || layer.id).slice(0, 20); if (out[nm]) return
          out[nm] = { m0: info.mvp[0], m5: info.mvp[5] }
        },
      })
      await r.render(scene, tex, W, H, 1.0)
      return out
    }
    const gA = await gpuZoom(1), gB = await gpuZoom(1.6), gN = await gpuZoom(null)
    const kA = Object.keys(gA)
    check('D3 有台账层（' + kA.length + '）', kA.length > 0)
    let maxDev1 = 0, maxDev16 = 0
    for (const k of kA) {
      if (!gB[k]) continue
      maxDev1 = Math.max(maxDev1, Math.abs(gB[k].m0 / gA[k].m0 - 1.6), Math.abs(gB[k].m5 / gA[k].m5 - 1.6))
      if (gN[k]) maxDev16 = Math.max(maxDev16, Math.abs(gN[k].m0 - gA[k].m0), Math.abs(gN[k].m5 - gA[k].m5))
    }
    check('D3 **端到端**：?props=newproperty30=1.6 ⇒ 每层投影缩放比 = 1.6000（偏差 ' + maxDev1.toExponential(1) + ' ≤ 1e-6）',
      maxDev1 <= 1e-6)
    check('D3 默认值（1）与"无属性表"投影**逐位相同**（偏差 ' + maxDev16 + ' = 0）⇒ 默认零回归', maxDev16 === 0)
    // D4 hina 的 zoom 是**时间动画**（非用户绑定）⇒ 不受本改动影响，且那条路径仍保持未接
    const hp = path.join(DD, '3554161528', 'scene.pkg')
    if (fs.existsSync(hp)) {
      const pkg3 = lib.parsePkg(new Uint8Array(fs.readFileSync(hp)))
      const e3 = (n) => { const x = lib.getEntry(pkg3, n); return x ? new Uint8Array(x) : null }
      const sj3 = JSON.parse(dec.decode(e3('scene.json')).replace(/^\uFEFF/, ''))
      const s3 = lib.parseScene(JSON.parse(JSON.stringify(sj3)), null, {})
      lib.applyUserProperties(s3, { newproperty30: 1.6 }, {})
      check('D4 hina(3554161528) 的 `zoom` 是 animation 而非 `{user:…}` ⇒ zoomBinding=null、zoomFromUser=null（不受影响）',
        s3.cameraNode.zoomBinding === null && s3.cameraNode.zoomFromUser === null)
      check('D4 hina 相机层 active=true（origin 是关键帧）但**完整相机通路仍未接**（P-76 只接 zoom-only，见未定项）',
        s3.cameraNode.active === true)
      // 源码级：camPose 只在 zoomOnly 分支进 buildCamera —— 防止有人顺手把动画路径也接上而不更新本断言/PATCHES
      const src = fs.readFileSync('./core/we-scene-bundle.js', 'utf8')
      check('D4 源码级：`buildCamera` 的 cameraPose 只来自 `camPose.__zoomOnly` 分支（动画/fov 通路仍未接）',
        /camPose && camPose\.__zoomOnly[\s\S]{0,220}cameraPose: \{ x: 0, y: 0, zoom: camPose\.zoom \}/.test(src))
    } else { console.log('  SKIP D4（缺 hina 包）') }
  }
}

// ═══════════════════════ E. ?bones= 会话累计极值 + 眨眼事件捕获（P-80）═══════════════════════
//   真机第一轮 105 帧/3.01s：mirror 空、flips 0、全骨 maxΔty 只有 14.9px ⇒ 只能得出"这 3 秒没眨眼"，
//   不是"眨眼不走骨骼"。窗口化极值被环形缓冲冲掉 ⇒ 这次改成**会话累计** + **眨眼事件 ±5 帧片段**。
console.log('\n── E. ?bones= 会话累计极值 + 眨眼捕获 ──')
{
  const I16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const mj = JSON.parse(dec.decode(entry('models/眼睛组合.json')))
  const emesh = PH._parseMdl(entry(mj.puppet))
  const nb = emesh.bones.length
  const stub = { id: 990977, name: 'P80眨眼桩', size: [100, 100], scale: [1, 1, 1], origin: [1920, 1080, 0], angles: [0, 0, 0], alpha: 1 }
  // ty 直接来自 pose[13] = (bindWorld × g)[13]；bindWorld 平移非 0 ⇒ 用"相对平移"构造 Δty
  const gTy = (b, dy) => { const g = new Float32Array(nb * 16); for (let i = 0; i < nb; i++) { g.set(I16, i * 16) } g[b * 16 + 13] = dy; return g }
  // 序列元素 = [t, gBones]：先 render 一帧**空场景**把渲染时钟 `__bonesNowT` 推到 t，
  // 再直接调 renderMeshLayer —— 这样 summary 里的 `*At`/会话时长才是真时间（否则恒 0，断言没意义）。
  const EMPTY_SCENE = { layers: [], general: {}, camera: null, properties: null }
  const probeE = (search, seq) => {
    const prevLoc = globalThis.location
    globalThis.location = { search, href: 'http://localhost/' + search }
    const { gl } = makeMockGL()
    const r = lib.createRenderer({ getContext: () => gl, width: W, height: H }, { onLog: () => {}, shaderResolver, trace: false })
    try { delete globalThis.__mpwBones } catch (e) {}
    for (const [t, g] of seq) {
      r.__p80t = t
      // eslint-disable-next-line no-await-in-loop
      r.render(EMPTY_SCENE, new Map(), W, H, t)
      r.renderMeshLayer(stub, emesh, g, nb, [1920, 1080], [1, -1], [W, H], { id: 'tex#stub' })
    }
    const got = globalThis.__mpwBones
    try { delete globalThis.__mpwBones } catch (e) {}
    globalThis.location = prevLoc
    return got
  }
  // E3 默认关：零字段
  check('E3 默认（无 ?bones=）⇒ 仍然零字段（新字段也一个都不写）', probeE('', [[0, gTy(0, 0)], [0.1, gTy(0, 60)]]) === undefined)

  // E2 平稳序列：眨眼 0 次、无片段
  const steady = []
  for (let i = 0; i < 12; i++) steady.push([i / 30, gTy(0, i * 0.5)])   // Δty=0.5px << 25
  const onS = probeE('?bones=P80眨眼桩', steady)
  check('E2 平稳序列 ⇒ blinkCount=0 且 blinks 为空（不误报）',
    !!onS && onS.summary.blinkCount === 0 && onS.blinks.length === 0, onS ? JSON.stringify(onS.summary) : 'missing')
  check('E2 平稳序列 ⇒ 会话累计 maxΔty 记录到 0.5px（会话级记账在跑）',
    !!onS && Math.abs(onS.summary.maxDty - 0.5) < 1e-6, onS ? String(onS.summary.maxDty) : 'missing')
  // ⚠ ty 是 **绝对** 值（pose[13] = (bindWorld×g)[13]，含 bindWorld 自己的平移 −4.92）
  //   ⇒ 断言"跨度/差值"，不钉绝对值。
  check('E2 平稳序列 ⇒ ext 有 ' + nb + ' 根骨 × 6 个极值，且 b0 的 ty 跨度 = 5.5（dy 0→5.5）',
    !!onS && onS.ext.length === nb && onS.ext.every((a) => a.length === 6) &&
    Math.abs((onS.ext[0][5] - onS.ext[0][4]) - 5.5) < 0.01 && Math.abs((onS.ext[0][1] - onS.ext[0][0])) < 1e-9,
    onS ? JSON.stringify(onS.ext[0]) : 'missing')

  // E1 桩序列：某骨 ty 突降 60px（≥ 默认阈值 25）⇒ 记为眨眼事件，且片段含"前后各 5 帧"
  const seq = []
  for (let i = 0; i < 8; i++) seq.push([i / 30, gTy(0, 0)])            // 前 8 帧平稳
  seq.push([8 / 30, gTy(0, -60)])                                      // 第 9 帧：突降 60px（t=0.267s）
  for (let i = 0; i < 6; i++) seq.push([(9 + i) / 30, gTy(0, -60)])     // 之后保持（供"后 5 帧"补片）
  const onB = probeE('?bones=P80眨眼桩', seq)
  check('E1 桩序列（某骨 ty 单帧下移 60px ≥ 阈值 25）⇒ blinkCount=1 且 blinks[0] 指向该骨',
    !!onB && onB.summary.blinkCount === 1 && onB.blinks[0].bone === 0, onB ? JSON.stringify(onB.blinks[0] && { t: onB.blinks[0].t, bone: onB.blinks[0].bone, dty: onB.blinks[0].dty, from: onB.blinks[0].from, to: onB.blinks[0].to }) : 'missing')
  check('E1 事件带方向：to − from = −60、dty=60（绝对 ty 含 bindWorld 平移 −4.92，故只看差值）',
    !!onB && Math.abs((onB.blinks[0].to - onB.blinks[0].from) + 60) < 1e-6 && Math.abs(onB.blinks[0].dty - 60) < 1e-6,
    onB ? JSON.stringify({ from: onB.blinks[0].from, to: onB.blinks[0].to }) : 'missing')
  check('E1 片段 = 前 5 帧 + 当前帧 + 后 5 帧（11 条 [t,ty,ang,detS]），且段内恰好一次 −60 跳变、首尾差 = −60',
    (() => {
      if (!onB) return false
      const seg = onB.blinks[0].seg
      if (seg.length < 11 || !seg.every((r) => r.length === 4)) return false
      const ty = seg.map((r) => r[1])
      const jumps = ty.slice(1).filter((v, i) => Math.abs(v - ty[i]) > 1).length
      return jumps === 1 && Math.abs((ty[ty.length - 1] - ty[0]) + 60) < 1e-6 && ty[0] === ty[4]
    })(),
    onB ? 'seg=' + JSON.stringify(onB.blinks[0].seg.map((r) => r[1])) : 'missing')
  check('E1 片段**独立于 180 帧环形缓冲**（blinks 是单独数组；段内 ty 单调跨过跳变）',
    !!onB && Array.isArray(onB.blinks) && onB.blinks !== onB.frames)
  check('E1 summary 给出 maxDtyBone/maxDty/maxDtyAt（不用自己扫 105×32 元组），且 At = 跳变帧的真实时刻 8/30≈0.267s',
    !!onB && onB.summary.maxDtyBone === 0 && Math.abs(onB.summary.maxDty - 60) < 1e-6 &&
    Math.abs(onB.summary.maxDtyAt - 8 / 30) < 0.002,
    onB ? JSON.stringify({ b: onB.summary.maxDtyBone, d: onB.summary.maxDty, at: onB.summary.maxDtyAt }) : 'missing')
  check('E1 会话时长/帧数被记进 summary（frames=' + (onB && onB.summary.frames) + '）',
    !!onB && onB.summary.frames === seq.length && typeof onB.summary.sessionSec === 'number')
  // 阈值可调：?blinkty=80 ⇒ 同一个 60px 跳变不应计为眨眼
  const onHi = probeE('?bones=P80眨眼桩&blinkty=80', seq)
  check('E1 阈值可调 `?blinkty=80` ⇒ 同一 60px 跳变不再计为眨眼（阈值确实生效，不是写死 25）',
    !!onHi && onHi.summary.blinkCount === 0 && onHi.summary.blinkThreshold === 80,
    onHi ? 'blinkCount=' + onHi.summary.blinkCount + ' thr=' + onHi.summary.blinkThreshold : 'missing')
  // 上行眨眼（眨眼也可能向上）也要能记
  const seqUp = []
  for (let i = 0; i < 3; i++) seqUp.push([i / 30, gTy(1, 0)])
  seqUp.push([3 / 30, gTy(1, 40)])
  for (let i = 0; i < 6; i++) seqUp.push([(4 + i) / 30, gTy(1, 40)])
  const onU = probeE('?bones=P80眨眼桩', seqUp)
  check('E1 另一根骨上行 40px 同样被记（不只看下移；bone=1, dty=40）',
    !!onU && onU.summary.blinkCount === 1 && onU.blinks[0].bone === 1 && Math.abs(onU.blinks[0].dty - 40) < 1e-6,
    onU ? JSON.stringify(onU.blinks[0] && { b: onU.blinks[0].bone, d: onU.blinks[0].dty }) : 'missing')
  // E4 blinkCount 是**累计**（样本数组上限 20，但不影响"到底有没有眨眼"的判定）
  const many = []
  for (let i = 0; i < 60; i++) many.push([i / 30, gTy(i % 2 === 0 ? 0 : 2, i % 2 === 0 ? 0 : -60)])
  const onM = probeE('?bones=P80眨眼桩', many)
  // 交替序列（下移 −60 / 回弹 +60）⇒ **每一次跳变都算一条**：60 帧 30 对 ⇒ 59 次跳变（首帧无前帧）
  check('E4 交替跳变 60 帧 ⇒ blinkCount=59（**累计**，不受 20 条样本上限影响）而 blinks 样本被截到 20',
    !!onM && onM.summary.blinkCount === 59 && onM.summary.blinkCount > 20 &&
    onM.blinks.length === 20 && onM.summary.blinkSamples === 20,
    onM ? 'count=' + onM.summary.blinkCount + ' samples=' + onM.blinks.length : 'missing')
  check('E5 源码级：`[bones]` 摘要行含「会话累计」+ maxΔty + 眨眼事件三节',
    (() => { const src = fs.readFileSync('./core/we-scene-bundle.js', 'utf8'); return src.includes("' | 【会话累计】帧='") && src.includes("' 眨眼事件=' + summary.blinkCount") && src.includes("maxΔty=b' + summary.maxDtyBone") })())
}

// ═══════════════════════ 汇总 ═══════════════════════
console.log('\n' + (fail === 0 ? '全部通过 ✓  ' : '有失败 ✗  ') + pass + ' 断言通过 / ' + fail + ' 失败')
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }

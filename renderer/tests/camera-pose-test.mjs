/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // camera-pose-test.mjs — P-81：相机层姿态**完整接**（origin 关键帧动画 + zoom）与三档回退
// 复现：node camera-pose-test.mjs
//
// 背景（P-76 查出来的真问题）：`camPose` 在 P-81 之前**从来没交给 `buildCamera`** ——
//   `buildCamera` 读的是 `opts.cameraPose`，而全仓库只有 `camera-node-test.mjs` 传它（`demo.html` 不传）
//   ⇒ 相机层的 origin/zoom 关键帧动画在**真实渲染路径**里从未生效。
//   第三方参考实现所实现的语义（wer-ref `WPSceneParser.cpp`）：`:6119-6135` 相机层**无条件注册**（`camera_layer.zoom =
//   empty_obj.zoom` + `UpdateActiveCameraLayer()`，**没有"origin 必须是动画"这个条件**）；
//   `IsCameraLayerRuntimeProperty`（`:882-885`）= `visible|origin|angles|zoom|fov`；
//   `:7345-7355` 给 `zoom`/`fov` 注册 Property + Animation + Script 三种绑定。
//   用户原话：「相机层动画要完整接 **但是你要保留可以回退的按钮**」⇒ `?campose=full|legacy|off`。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16) 仓库根（根级 demo.html / bundle）

globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

// ①(2026-09-16 目录整理) 本文件原先把 MPW_WS 定义成**工作区根**（MPW_ROOT 语义），却又拿它读**根级**
//   demo.html / core/we-scene-bundle.js ⇒ 移入 tests/ 后暴雷。现按仓库口径拆分：
//   工作区根 = MPW_WS（语料/WE 资产），仓库根 = ROOT（来自 tests/_root.mjs）。
const MPW_WS = process.env.MPW_ROOT || WS
const DD = process.env.MPW_SCENE_ROOT || path.join(MPW_WS, 'allwallpaper', 'dd')
const W = 3840, H = 2160
const dec = new TextDecoder()

// ── mock GL（与 render-audit / p76 同款最小实现）──
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function makeMockGL() {
  let curUnit = 0, curFbo = null, ids = 0
  const Hd = {
    createTexture: () => ({ id: 't' + (++ids) }), createFramebuffer: () => ({ id: 'f' + (++ids) }),
    createBuffer: () => ({ id: 'b' + (++ids) }), createVertexArray: () => ({ id: 'v' + (++ids) }),
    createShader: () => ({ id: 's' + (++ids) }), createProgram: () => ({ id: 'p' + (++ids) }),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u }, bindTexture: () => {},
    bindFramebuffer: (t, f) => { curFbo = f }, useProgram: () => {}, bindBuffer: () => {},
    bufferData: () => {}, drawArrays: () => {}, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i ? 'a_TexCoord' : 'a_Position', size: i ? 2 : 3 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : 2,
    getUniformLocation: () => ({ u: 1 }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {}, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  }
  return new Proxy({}, { get(t, pr) {
    if (pr in Hd) return Hd[pr]
    if (typeof pr === 'string' && /^[A-Z0-9_]+$/.test(pr)) return CONST[pr] !== undefined ? CONST[pr] : 1
    return () => {}
  } })
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0); v_TexCoord=a_TexCoord;}'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor=texture(g_Texture0,v_TexCoord);}'

/** 用真实 renderScene 画一包，返回 { 层名: {x0,w,m0,m12} }（口径 = demo.html:3588-3626 的 x 部分） */
async function gpuRects(id, { campose, cam, charfit, t = 0 } = {}) {
  const p = path.join(DD, id, 'scene.pkg')
  if (!fs.existsSync(p)) return null
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const pj = path.join(DD, id, 'project.json')
  const schema = fs.existsSync(pj) ? (JSON.parse(fs.readFileSync(pj, 'utf8')).general || {}).properties : null
  const sc = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')), null, { attachCtx: { readEntry: entry, time: 0 } })
  lib.applyRenderConfig(sc, { sceneId: id, refrender: null, anchor: 'refcenter', hideUI: true, hideParticles: true, clearBgFx: true, log: () => {},
    properties: schema ? lib.propsDefaults(schema) : null, propertiesSchema: schema })
  const tex = new Map()
  for (const l of sc.layers) {
    if (!l.image) continue
    try {
      const mj = JSON.parse(dec.decode(entry(l.image))); const mat = lib.resolveMaterial(mj); if (!mat) continue
      const me = entry(mat.materialPath); if (!me) continue
      const M = JSON.parse(dec.decode(me)); const tn = M.passes && M.passes[0] && M.passes[0].textures && M.passes[0].textures[0]
      if (tn) { l.textureName = tn; if (!tex.has(tn)) tex.set(tn, { glTex: { __name: tn, id: 't' }, width: 64, height: 64 }) }
    } catch (e) {}
  }
  const out = {}
  const r = lib.createRenderer({ getContext: () => makeMockGL(), width: W, height: H }, {
    onLog: () => {}, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG), onMeshLayer: () => {},
    trace: false, auditFrames: 1, hideParticles: true, clearBgFx: true, campose, cam, charfit,
    onLayerDraw: (layer, info) => {
      if (info.width !== W) return
      const nm = String(layer.name || layer.id).slice(0, 18)
      if (out[nm]) return
      const m = info.mvp
      const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
      const scr = (v, n) => (v * 0.5 + 0.5) * n
      const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
      const x0 = Math.round(scr(Math.min(A[0], B[0]), W)), x1 = Math.round(scr(Math.max(A[0], B[0]), W))
      out[nm] = { x0, w: x1 - x0, m0: +m[0].toFixed(7), m12: +m[12].toFixed(6) }
    },
  })
  await r.render(sc, tex, W, H, t)
  return { out, cam: sc.cameraNode }
}
const sameRects = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length || ka.length === 0) return false
  return ka.every((k) => b[k] && a[k].x0 === b[k].x0 && a[k].w === b[k].w && a[k].m0 === b[k].m0)
}

// ───────────────────────── ① `?campose=` 真值表 ─────────────────────────
console.log('── ① `?campose=` 真值表（纯函数 camposeModeFrom，与 bundle 内 CAMPOSE_MODE 同一份）──')
check('缺省（空 search）⇒ full（= 完整接，用户批准的默认）', lib.camposeModeFrom('') === 'full')
check('`?campose=full` ⇒ full', lib.camposeModeFrom('?campose=full') === 'full')
check('`?campose=legacy` ⇒ legacy（回退到 P-76 行为）', lib.camposeModeFrom('?campose=legacy') === 'legacy')
check('`?campose=off` ⇒ off（完全不接，逐位回到 P-76 之前）', lib.camposeModeFrom('?campose=off') === 'off')
check('非法值 `=bogus` ⇒ full（回退到缺省，不静默变成 off）', lib.camposeModeFrom('?campose=bogus') === 'full')
check('空值 `?campose=` ⇒ full', lib.camposeModeFrom('?campose=') === 'full')
check('大小写 `=OFF` ⇒ full（只认精确小写，避免"看着关了其实没关"）', lib.camposeModeFrom('?campose=OFF') === 'full')
check('无关参数 ⇒ full', lib.camposeModeFrom('?id=3554161528&bones=人物') === 'full')
check('与其它参数共存 `?campose=off&t=3` ⇒ off', lib.camposeModeFrom('?campose=off&t=3') === 'off')

const HINA = '3554161528', KAL = '3719111841', SUN = '3327063360'
const haveHina = fs.existsSync(path.join(DD, HINA, 'scene.pkg'))
const haveKal = fs.existsSync(path.join(DD, KAL, 'scene.pkg'))
const haveSun = fs.existsSync(path.join(DD, SUN, 'scene.pkg'))

// ───────────────────────── ② hina：动画真的在跑 + 三档行为 ─────────────────────────
if (!haveHina) { console.log('  SKIP ②③（缺 hina 包）') } else {
  console.log('\n── ② hina 3554161528（语料里**唯一**有相机层关键帧动画的包）──')
  const f0 = await gpuRects(HINA, { campose: 'full', t: 0 })
  const f1 = await gpuRects(HINA, { campose: 'full', t: 1 })
  const l1 = await gpuRects(HINA, { campose: 'legacy', t: 1 })
  const o1 = await gpuRects(HINA, { campose: 'off', t: 1 })
  // ①(P-100) 默认档（charfit=auto）已改为"角色只吃世界变换 + 相机取景"：hina 有相机层 ⇒ **不再强制居中**。
  //   "改动前的取景"要用 `?charfit=legacy` 显式钉（下面两条断言），默认档另有断言（x0=1498 = 作者 origin 2200.5 − 702.5）。
  const o1legacy = await gpuRects(HINA, { campose: 'off', charfit: 'legacy', t: 1 })
  const f1legacy = await gpuRects(HINA, { campose: 'full', charfit: 'legacy', t: 1 })
  check('② 相机层 active=true（origin 是关键帧动画）', !!(f1.cam && f1.cam.active))
  check('② full 档 t=0 与 t=1 的实绘矩形**不同** ⇒ 关键帧动画真的在逐帧求值（不是只取静态首帧）',
    !!f0.out['人物'] && !!f1.out['人物'] && f0.out['人物'].x0 !== f1.out['人物'].x0,
    't0 人物=' + JSON.stringify(f0.out['人物']) + ' t1=' + JSON.stringify(f1.out['人物']))
  check('② 量化 t=0：人物 w=' + f0.out['人物'].w + '（= 1405 × 3.00 倍镜头）',
    Math.abs(f0.out['人物'].w / 1405 - 3.0) < 0.02, 'ratio=' + (f0.out['人物'].w / 1405).toFixed(4))
  check('② 量化 t=1：人物 w=' + f1.out['人物'].w + '（= 1405 × 2.64 倍镜头，与独立测得的 zoom=2.6374 吻合）',
    Math.abs(f1.out['人物'].w / 1405 - 2.6374) < 0.02, 'ratio=' + (f1.out['人物'].w / 1405).toFixed(4))
  check('② 背景层同样被镜头带动（full t=0 w=' + f0.out['背景'].w + '、t=1 w=' + f1.out['背景'].w + '）',
    f0.out['背景'].w !== f1.out['背景'].w && f0.out['背景'].w > 3917)
  check('② `legacy` 与 `off` 在 t=1 **逐位相同**（legacy 只接用户绑定 zoom；hina 的 zoom 是动画 ⇒ 两者一致）',
    sameRects(l1.out, o1.out))
  check('② `?charfit=legacy` + `campose=legacy/off` 逐位复现 P-81 之前的取景（含"人物钉画布中心"）：人物 x0=' +
    o1legacy.out['人物'].x0 + ' w=' + o1legacy.out['人物'].w + '（P-100 起这条旧口径只由 charfit=legacy 提供）',
    o1legacy.out['人物'].x0 === 1218 && o1legacy.out['人物'].w === 1405 && Math.abs(o1legacy.out['背景'].w - 3916) <= 1,
    JSON.stringify({ '人物': o1legacy.out['人物'], '背景': o1legacy.out['背景'] }))
  check('② ①(P-100) 默认档不再把角色钉在画布中心：人物 x0=' + o1.out['人物'].x0 + ' w=' + o1.out['人物'].w +
    '（= 作者 origin 2200.5 − 1405/2 = 1498）',
    o1.out['人物'].x0 === 1498 && o1.out['人物'].w === 1405
    && Math.abs((o1.out['人物'].x0 + o1.out['人物'].w / 2) - 2200.5) <= 1,
    '中心 x=' + (o1.out['人物'].x0 + o1.out['人物'].w / 2))
  check('② full 与 off 的**最大位移**：人物 Δx=' + (f1.out['人物'].x0 - o1.out['人物'].x0) +
    'px、背景 Δx=' + (f1.out['背景'].x0 - o1.out['背景'].x0) + 'px（t=1）',
    Math.abs(f1.out['人物'].x0 - o1.out['人物'].x0) === 1381 && Math.abs(f1.out['背景'].x0 - o1.out['背景'].x0) === 3207)
  check('② `?charfit=legacy` 下 full 档的人物位移仍是改动前的 922px（旧口径完整保留）',
    Math.abs(f1legacy.out['人物'].x0 - o1legacy.out['人物'].x0) === 922,
    'Δx=' + (f1legacy.out['人物'].x0 - o1legacy.out['人物'].x0))

  // ── ③ 正交包回归：fov 无落点 + 无相机对象的包三档逐位相同 ──
  console.log('\n── ③ 正交回归：fov 无落点 / 无相机层的包三档逐位相同 ──')
  const cam = lib.buildCamera(
    lib.parseScene(JSON.parse(dec.decode(lib.getEntry(lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(DD, HINA, 'scene.pkg')))), 'scene.json')).replace(/^\uFEFF/, '')), null, {}),
    W, H, { cameraPose: { x: 0, y: 0, zoom: 1, fov: 10 } })
  const cam2 = lib.buildCamera(
    lib.parseScene(JSON.parse(dec.decode(lib.getEntry(lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(DD, HINA, 'scene.pkg')))), 'scene.json')).replace(/^\uFEFF/, '')), null, {}),
    W, H, { cameraPose: { x: 0, y: 0, zoom: 1, fov: 120 } })
  check('③ 正交档：`buildCamera` 对**有正交矩形**的包仍只构造 mat4Ortho ⇒ pose.fov 10 vs 120 投影**逐位相同**（fov 在正交档无落点）',
    Array.from(cam.projection).every((v, i) => v === cam2.projection[i]) && cam.projection[0] === Math.fround(2 / W),
    'm0=' + cam.projection[0] + ' m5=' + cam.projection[5] + ' (Float32 存储 ⇒ 用 Math.fround 比)')
  check('③ ①(P-107 口径更新) 透视档则**必须不同**：语料 20/21 个包有正交矩形（auto 恒正交、逐位不变），'
    + '唯一无矩形的 3509243656 走透视（fov 真的改投影、且正交路径冻结对拍 0 差）⇒ 由 camera-persp-test ⑤⑥ 断言',
    true, '见 PATCHES P-107；旧断言"本渲染器无透视分支"已过期')

  if (haveKal) {
    console.log('\n── ④ 凯尔希 3719111841：无相机对象 ⇒ 三档逐位相同（保护 P-76 的两条修复）──')
    const kf = await gpuRects(KAL, { campose: 'full', t: 1 })
    const kl = await gpuRects(KAL, { campose: 'legacy', t: 1 })
    const ko = await gpuRects(KAL, { campose: 'off', t: 1 })
    check('④ 该包 scene.cameraNode === null', kf.cam === null || kf.cam === undefined, String(kf.cam))
    check('④ full / legacy / off 三档实绘矩形**逐位相同**（凯尔希完全不受相机改动影响）',
      sameRects(kf.out, kl.out) && sameRects(kl.out, ko.out), Object.keys(kf.out).length + ' 层')
    check('④ 且与 P-76 的验收值一致：背景正常 x0=' + ko.out['背景正常'].x0 + ' w=' + ko.out['背景正常'].w + '（应 −208/4244）',
      ko.out['背景正常'].x0 === -208 && Math.abs(ko.out['背景正常'].w - 4244) <= 1)
  } else { console.log('  SKIP ④（缺凯尔希包）') }
}

// ───────────────────────── ⑤ 砂狼白子：逐属性脚本 origin 的静态快照**默认不施加** ─────────────────────────
if (!haveSun) { console.log('  SKIP ⑤（缺 3327063360 包）') } else {
  console.log('\n── ⑤ 砂狼白子 3327063360：脚本驱动 origin 的静态快照默认不施加（否则整幅偏 −2434px）──')
  const sf = await gpuRects(SUN, { campose: 'full', t: 1 })
  const sl = await gpuRects(SUN, { campose: 'legacy', t: 1 })
  const so = await gpuRects(SUN, { campose: 'off', t: 1 })
  const sn = await gpuRects(SUN, { campose: 'full', cam: 'node', t: 1 })
  check('⑤ 相机层存在但不是"关键帧动画"（active=false）', !!(sf.cam && sf.cam.active === false))
  check('⑤ full / legacy / off 三档**逐位相同** ⇒ 默认不施加脚本 origin 的快照',
    sameRects(sf.out, sl.out) && sameRects(sl.out, so.out), Object.keys(sf.out).length + ' 层')
  check('⑤ 而 `?cam=node`（既有开关，语义不变）确实施加快照 ⇒ 非满幅层整体位移 **−2434px**',
    sn.out['纯色'].x0 - so.out['纯色'].x0 === -2434 && sn.out['文本1'].x0 - so.out['文本1'].x0 === -2434,
    '纯色 Δx=' + (sn.out['纯色'].x0 - so.out['纯色'].x0) + ' 文本1 Δx=' + (sn.out['文本1'].x0 - so.out['文本1'].x0))
  check('⑤ 满幅层不受平移影响（0..3840 仍满幅）⇒ 该 A/B 只影响非满幅层',
    sn.out['砂狼白子 星落之夜'].x0 === 0 && sn.out['砂狼白子 星落之夜'].w === 3840)
}

// ───────────────────────── ⑥ P-84：🎥 相机 按钮的 live 档（用户"要保留可以回退的按钮"）────────────────
//   按钮**不刷新页面**就要生效 ⇒ 档位必须每帧可读。真值表 = `resolveCamposeMode(opts, live, fallback)`：
//   `opts.campose`（测试/宿主显式传）> `window.__mpwCampose`（按钮实时写）> `?campose=`（加载时读一次）。
//   本段既测纯函数，也**用真包真渲染**证明 live 档真的到了 `buildCamera`（不是只改了个变量）。
{
  console.log('\n── ⑥ P-84 live 档真值表（resolveCamposeMode：opts > window.__mpwCampose > ?campose=）──')
  const R = lib.resolveCamposeMode
  check('⑥ 三档合法值原样返回（opts 档）', R('full', null, null) === 'full' && R('legacy', null, null) === 'legacy' && R('off', null, null) === 'off')
  check('⑥ opts 缺省 ⇒ 用 live（按钮档）', R(undefined, 'legacy', 'full') === 'legacy' && R(undefined, 'off', 'full') === 'off')
  check('⑥ live 缺省/null/空串 ⇒ 用 fallback（URL 档）', R(undefined, undefined, 'off') === 'off' && R(undefined, null, 'off') === 'off' && R(undefined, '', 'off') === 'off')
  check('⑥ **opts 优先于 live 与 URL**（测试在同进程内切三态不被页面按钮污染）',
    R('legacy', 'off', 'full') === 'legacy' && R('off', 'full', 'legacy') === 'off')
  check('⑥ live 优先于 URL', R(undefined, 'off', 'full') === 'off' && R(undefined, 'legacy', 'off') === 'legacy')
  check('⑥ 非法/未知值一律 full（不静默变 off）', R('bogus', 'bogus', 'bogus') === 'full' && R(undefined, 'OFF', 'LEGACY') === 'full')
  check('⑥ 全缺省 ⇒ full（用户批准的默认档）', R(undefined, undefined, undefined) === 'full')

  if (!haveHina) { console.log('  SKIP ⑥ 真渲染部分（缺 hina 包）') } else {
    // 带 __mpwCampose 的 window 桩：未知属性返回 undefined，常见方法返回 no-op（避免渲染路径踩空）
    const NOOP = () => {}
    const liveWin = (v) => new Proxy({ __mpwCampose: v }, {
      get: (t, p) => (p in t) ? t[p]
        : (typeof p === 'string' && /^(addEventListener|removeEventListener|requestAnimationFrame|cancelAnimationFrame|getComputedStyle|matchMedia|scrollTo|open|focus|blur)$/.test(p)) ? NOOP
          : undefined,
    })
    const prevWin = globalThis.window
    globalThis.window = liveWin('legacy')
    const lvLegacy = await gpuRects(HINA, { t: 1 })             // 不传 campose ⇒ 只能来自 live
    globalThis.window = liveWin('off')
    const lvOff = await gpuRects(HINA, { t: 1 })
    globalThis.window = liveWin('full')
    const lvFull = await gpuRects(HINA, { t: 1 })
    globalThis.window = liveWin('bogus')
    const lvBogus = await gpuRects(HINA, { t: 1 })
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin
    const refFull = await gpuRects(HINA, { campose: 'full', t: 1 })
    const refLegacy = await gpuRects(HINA, { campose: 'legacy', t: 1 })
    const refOff = await gpuRects(HINA, { campose: 'off', t: 1 })
    check('⑥ live=legacy 的真渲染矩形 == opts.campose=legacy（按钮档真的进了 buildCamera）',
      sameRects(lvLegacy.out, refLegacy.out), '人物 x0=' + lvLegacy.out['人物'].x0 + ' w=' + lvLegacy.out['人物'].w)
    check('⑥ live=off 的真渲染矩形 == opts.campose=off', sameRects(lvOff.out, refOff.out))
    check('⑥ live=full 的真渲染矩形 == opts.campose=full', sameRects(lvFull.out, refFull.out))
    check('⑥ live=legacy 与 live=full **不同**（证明按钮真的改变画面，而不是三档同图）',
      !sameRects(lvLegacy.out, lvFull.out),
      'legacy 人物 w=' + lvLegacy.out['人物'].w + ' vs full 人物 w=' + lvFull.out['人物'].w)
    check('⑥ live=非法值 ⇒ 落到 full（与 opts 非法值同口径）', sameRects(lvBogus.out, refFull.out))
  }

  // 源码守卫：按钮必须真的存在、三档齐全、写 live 全局 + 同步 URL、且不会被容器吃掉指针事件
  const HERE = MPW_WS   // ①(2026-09-16 目录整理) 根级 demo.html / core/we-scene-bundle.js 的基准 = 仓库根
  const demo = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  const seg = (() => { const a = demo.indexOf('MPW-CAMPOSE-BTN-BEGIN'); const b = demo.indexOf('MPW-CAMPOSE-BTN-END'); return (a >= 0 && b > a) ? demo.slice(a, b) : '' })()
  check('⑥ demo.html 有 🎥 相机 按钮块（MPW-CAMPOSE-BTN-BEGIN/END）', seg.length > 400, seg.length + ' 字符')
  check('⑥ 按钮 id = #mpw-campose-btn，挂在顶部工具栏 #bar', /b\.id = 'mpw-campose-btn'/.test(seg) && /getElementById\('bar'\)/.test(seg))
  check('⑥ 三档齐全且文案含"完整/旧档/关"', /'full'/.test(seg) && /'legacy'/.test(seg) && /'off'/.test(seg) && /相机 完整/.test(seg) && /相机 旧档/.test(seg) && /相机 关/.test(seg))
  check('⑥ 点击写 window.__mpwCampose（live 档来源）', /window\.__mpwCampose = v/.test(seg))
  check('⑥ 点击用 history.replaceState 把档位同步进地址栏（刷新后保持 + 上报可查）',
    /history\.replaceState/.test(seg) && /searchParams\.set\('campose', v\)/.test(seg) && /searchParams\.delete\('campose'\)/.test(seg))
  check('⑥ 4 种指针事件全 stop（与 🛰 立即上报 同款，防误触容器）',
    ['pointerdown', 'pointerup', 'mousedown', 'touchstart'].every((e) => seg.includes("'" + e + "'")))
  check('⑥ 加载时就种上 live 档（带 ?campose=legacy 打开与点按钮走同一条 live 路径）',
    /window\.__mpwCampose = MODES\[mi\]\.v/.test(seg))
  const bundle = fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'), 'utf8')
  check('⑥ bundle 渲染路径确实每帧读 live 档并走同一真值表',
    /resolveCamposeMode\(opts\.campose, live, fb\)/.test(bundle) && /window\.__mpwCampose/.test(bundle))
}

console.log('\n===== camera-pose-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }

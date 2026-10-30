/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。 */
// charfit-camera-test.mjs — P-100：**角色层只吃世界变换 + 相机取景**（用户真机实测"入场动画把人物固定在
//   屏幕中间、去移动背景 —— 应该是只移动摄像头"）的量化回归。
// 复现：node tests/charfit-camera-test.mjs
//
// 两条根因（都在 hina 3554161528 的入场镜头上显形）：
//   ① **蒙皮层不接相机**（真机默认路径 / 用户看到的那条）：`demo.html` 的 `onMeshLayer` →
//      `renderer.renderMeshLayer(..., [projW,projH], ...)` 只按**设计画布** 1:1 映射
//      （`MESH_VS` 旧式 `1 − y·2/u_Proj.y`）⇒ 相机层 origin/zoom 关键帧带不动蒙皮角色：
//      背景/钢琴/花朵都跟着镜头缩放平移，人物却钉死在同一屏幕位置（= 用户说的"摄像机锁定人物"）。
//   ② **角色层自动适配**（`?skin0` / 无蒙皮立绘那条）：`compositeLayer` 里"无父级 + animationlayers
//      且超屏 ⇒ 等比缩到赛宽内 + 把 origin 改写成画布中心"——hina 人物 k=1（只居中不缩放），
//      于是作者摆的 (2200.5,595.2) 被换成 (1920,1080) = **画面正中**。
// 修法：①`MESH_VS` 新增 u_View/u_Framed（以画布中心为缩放基准，与 compositeLayer 的 viewProj 同式）；
//      ②适配收窄为"**有相机层 ⇒ 不适配**，无相机层且真超屏才兜底"；`?charfit=legacy` 一键回到旧行为。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'
import { installPuppet } from '../elysia/we-renderer/puppet.js'

globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const MPW_WS = process.env.MPW_ROOT || WS
const DD = process.env.MPW_SCENE_ROOT || path.join(MPW_WS, 'allwallpaper', 'dd')
const W = 3840, H = 2160
const dec = new TextDecoder()
const HINA = '3554161528', KAL = '3719111841'
const haveHina = fs.existsSync(path.join(DD, HINA, 'scene.pkg'))
const haveKal = fs.existsSync(path.join(DD, KAL, 'scene.pkg'))

// ── mock GL（与 camera-pose-test 同款最小实现）──
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function makeMockGL(uniSink) {
  let curFbo = null, ids = 0
  const locNames = new Map()
  const Hd = {
    createTexture: () => ({ id: 't' + (++ids) }), createFramebuffer: () => ({ id: 'f' + (++ids) }),
    createBuffer: () => ({ id: 'b' + (++ids) }), createVertexArray: () => ({ id: 'v' + (++ids) }),
    createShader: () => ({ id: 's' + (++ids) }), createProgram: () => ({ id: 'p' + (++ids) }),
    bindVertexArray: () => {}, activeTexture: () => {}, bindTexture: () => {},
    bindFramebuffer: (t, f) => { curFbo = f }, useProgram: () => {}, bindBuffer: () => {},
    bufferData: () => {}, drawArrays: () => {}, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i ? 'a_TexCoord' : 'a_Position', size: i ? 2 : 3 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : 2,
    getUniformLocation: (p, n) => { const o = { n }; locNames.set(o, n); return o },
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
    uniform1i: () => {}, uniform1f: () => {},
    uniform2f: (loc, a, b) => { if (uniSink) { const n = locNames.get(loc); if (n) uniSink.set(n, [a, b]) } },
    uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  }
  return new Proxy({}, { get(t, pr) {
    if (pr in Hd) return Hd[pr]
    if (typeof pr === 'string' && /^[A-Z0-9_]+$/.test(pr)) return CONST[pr] !== undefined ? CONST[pr] : 1
    return () => {}
  } })
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0); v_TexCoord=a_TexCoord;}'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor=texture(g_Texture0,v_TexCoord);}'

function loadScene(id) {
  const p = path.join(DD, id, 'scene.pkg')
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const sc = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')), null, { attachCtx: { readEntry: entry, time: 0 } })
  lib.applyRenderConfig(sc, { sceneId: id, refrender: null, anchor: 'refcenter', hideUI: true, hideParticles: true, clearBgFx: true, log: () => {} })
  return { entry, sc }
}

/** 真包真渲染：抓实绘矩形（x 口径与 camera-pose-test 完全一致）+ onMeshLayer 第二实参（相机取景）
 *  wantMeshCam=true 时按 demo.html 的口径把 puppet 层标成"蒙皮就绪"（`__skinReady`）⇒ 走 mesh 回调，
 *  这样才测得到"真机默认路径"（用户看到的那条），而不是只在 quad 路径上打转。 */
async function gpuRects(id, { campose, cam, charfit, t = 0, wantMeshCam = false } = {}) {
  const { entry, sc } = loadScene(id)
  if (wantMeshCam) {
    const Hh = {}; installPuppet(Hh)
    for (const l of sc.layers) {
      try {
        if (!l.image) continue
        const mj = JSON.parse(dec.decode(entry(l.image))); if (!mj || !mj.puppet) continue
        const ru = entry(mj.puppet); if (!ru) continue
        const mesh = Hh._parseMdl(ru)
        if (!mesh || !mesh.bones || !mesh.bones.length) continue
        l.__skin = { mesh, nb: mesh.bones.length }
        l.__skinReady = true     // demo.html:4987 每帧做同一件事
      } catch (e) {}
    }
  }
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
  const meshCams = {}
  let meshCam = 'unset'
  const opts = { onLog: () => {}, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
    trace: false, auditFrames: 1, hideParticles: true, clearBgFx: true,
    onMeshLayer: (layer, camInfo) => {
      if (!wantMeshCam) return
      meshCam = camInfo === null || camInfo === undefined ? null : JSON.parse(JSON.stringify(camInfo))
      meshCams[(String(layer.name || '') || '#' + layer.id) + '#' + layer.id] = meshCam
    },
    onLayerDraw: (layer, info) => {
      if (info.width !== W) return
      const m = info.mvp
      const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
      const scr = (v, n) => (v * 0.5 + 0.5) * n
      const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
      const x0 = Math.round(scr(Math.min(A[0], B[0]), W)), x1 = Math.round(scr(Math.max(A[0], B[0]), W))
      const y0 = Math.round((1 - Math.max(A[1], B[1])) / 2 * H), y1 = Math.round((1 - Math.min(A[1], B[1])) / 2 * H)
      const nm = String(layer.name || layer.id).slice(0, 18)
      if (out[nm]) return
      out[nm] = { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, m0: +m[0].toFixed(7), m12: +m[12].toFixed(6) }
    } }
  if (campose !== undefined) opts.campose = campose
  if (cam !== undefined) opts.cam = cam
  if (charfit !== undefined) opts.charfit = charfit
  const r = lib.createRenderer({ getContext: () => makeMockGL(), width: W, height: H }, opts)
  await r.render(sc, tex, W, H, t)
  return { out, cam: sc.cameraNode, meshCam, meshCams, scene: sc, mode: r.charfitMode }
}
const sameRects = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length || ka.length === 0) return false
  return ka.every((k) => b[k] && a[k].x0 === b[k].x0 && a[k].w === b[k].w && a[k].m0 === b[k].m0)
}

// ───────────────────────── ① `?charfit=` 真值表（纯函数） ─────────────────────────
console.log('── ① `?charfit=` 真值表（纯函数 charfitModeFrom / resolveCharfitMode）──')
check('缺省（空 search）⇒ auto', lib.charfitModeFrom('') === 'auto')
check('`?charfit=auto` ⇒ auto', lib.charfitModeFrom('?charfit=auto') === 'auto')
check('`?charfit=off` ⇒ off（完全关掉适配）', lib.charfitModeFrom('?charfit=off') === 'off')
check('`?charfit=legacy` ⇒ legacy（逐位回到改动前）', lib.charfitModeFrom('?charfit=legacy') === 'legacy')
check('非法值 `=bogus` ⇒ auto（不静默变 legacy/off）', lib.charfitModeFrom('?charfit=bogus') === 'auto')
check('空值 `?charfit=` ⇒ auto', lib.charfitModeFrom('?charfit=') === 'auto')
check('大小写 `=OFF` ⇒ auto（只认精确小写）', lib.charfitModeFrom('?charfit=OFF') === 'auto')
check('与其它参数共存 `?id=…&charfit=legacy&t=3` ⇒ legacy', lib.charfitModeFrom('?id=3554161528&charfit=legacy&t=3') === 'legacy')
check('resolveCharfitMode：opts 优先于 URL 档', lib.resolveCharfitMode('off', 'legacy') === 'off' && lib.resolveCharfitMode('legacy', 'auto') === 'legacy')
check('resolveCharfitMode：opts 缺省/null/空串 ⇒ 用 URL 档', lib.resolveCharfitMode(undefined, 'off') === 'off' && lib.resolveCharfitMode(null, 'legacy') === 'legacy' && lib.resolveCharfitMode('', 'legacy') === 'legacy')
check('resolveCharfitMode：全缺省 ⇒ auto', lib.resolveCharfitMode(undefined, undefined) === 'auto')

// ───────────────────────── ② MESH_VS 与 compositeLayer 的**同一相机**配准 ─────────────────────────
console.log('\n── ② 蒙皮层（MESH_VS）与四边形层（viewProj）在相机下的配准（判据式）──')
{
  // MESH_VS 的屏幕映射（与着色器逐字同式）：以画布中心为基准、按 framed 窗口缩放、加 u_View 平移
  const meshScreen = (p, view, framed, projW, projH, W2, H2) => {
    const x = p[0] + view[0], y = p[1] + view[1]
    const ndx = (x - projW / 2) * 2 / framed[0]
    const ndy = (projH / 2 - y) * 2 / framed[1]
    return [(ndx + 1) / 2 * W2, (1 - ndy) / 2 * H2]
  }
  if (!haveHina) { console.log('  SKIP（缺 hina 包）') } else {
    const { sc } = loadScene(HINA)
    const op = sc.general.orthogonalprojection
    const PW = op.width, PH = op.height
    let worst = 0, n = 0, worstAt = null
    for (const t of [0, 0.5, 1, 2, 4, 8]) {
      const cam = lib.buildCamera(sc, W, H, { cameraPose: poseAt(sc, t) })
      const vp = lib.mat4Multiply(cam.projection, cam.view)
      const view = [cam.viewX, cam.viewY], framed = [cam.framedW, cam.framedH]
      for (const p of [[0, 0], [600, 1790], [2173, 975], [2200.53784, 595.23083], [3840, 2160], [-500, 3000]]) {
        const quad = [(vp[0] * p[0] + vp[4] * p[1] + vp[12] + 1) / 2 * W, (1 - (vp[1] * p[0] + vp[5] * p[1] + vp[13])) / 2 * H]
        const mesh = meshScreen(p, view, framed, PW, PH, W, H)
        const d = Math.hypot(quad[0] - mesh[0], quad[1] - mesh[1])
        n++
        if (d > worst) { worst = d; worstAt = { t, p, quad: quad.map((v) => +v.toFixed(2)), mesh: mesh.map((v) => +v.toFixed(2)) } }
      }
    }
    check('② hina 入场 6 个时间点 × 6 个世界点：蒙皮公式与四边形投影**同一像素**（最大偏差 ' + worst.toExponential(2) + 'px）',
      worst < 0.5, n + ' 点，最差点 ' + JSON.stringify(worstAt))
    // 无相机时必须与旧的 1:1 公式**逐位相同**（zero-regression 判据）
    let same = true
    for (const p of [[0, 0], [1234.5, 678.9], [3840, 2160]]) {
      const oldF = [p[0] * 2 / PW - 1, 1 - p[1] * 2 / PH]
      const newF = meshScreen(p, [0, 0], [PW, PH], PW, PH, W, H)
      if (Math.abs(oldF[0] - (newF[0] * 2 / W - 1)) > 1e-9 || Math.abs(oldF[1] - (1 - newF[1] * 2 / H)) > 1e-9) same = false
    }
    check('② 无相机（u_View=0 / u_Framed=u_Proj）时新式 == 旧式 `1 − y·2/u_Proj.y`（逐位）', same)
  }
}
function poseAt(sc, t) {
  const cn = sc.cameraNode
  const ov = lib.evalPropAnimation(cn.originRaw, t)
  const zv = lib.evalPropAnimation(cn.zoomRaw, t)
  return { x: ov ? ov[0] : 0, y: ov ? ov[1] : 0, zoom: zv && zv[0] > 0 ? zv[0] : 1 }
}

// ───────────────────────── ③ hina：适配口径三档 × 时间点（真包真渲染） ─────────────────────────
console.log('\n── ③ hina 3554161528：`?charfit=` 三档（真包真渲染，人物 quad + 背景）──')
if (!haveHina) { console.log('  SKIP（缺 hina 包）') } else {
  const L = {}
  for (const m of ['legacy', 'off', 'auto']) L[m] = { t0: await gpuRects(HINA, { charfit: m, t: 0 }), t1: await gpuRects(HINA, { charfit: m, t: 1 }), t8: await gpuRects(HINA, { charfit: m, t: 8 }) }
  const row = (m, t) => (L[m][t].out['人物'] || {}).x0 + '/' + (L[m][t].out['人物'] || {}).w
  // ① legacy 必须**逐位复现改动前**（P-84 证据表：t=0 x0=3771 w=4215、t=1 x0=2140 w=3705、t=8 x0=1218 w=1405）
  check('③ `charfit=legacy` t=0 复现改动前：人物 x0=3771 w=4215（×3.0000 镜头）',
    L.legacy.t0.out['人物'].x0 === 3771 && L.legacy.t0.out['人物'].w === 4215, row('legacy', 't0'))
  check('③ `charfit=legacy` t=1 复现改动前：人物 x0=2140 w=3705（×2.6374 镜头）',
    L.legacy.t1.out['人物'].x0 === 2140 && L.legacy.t1.out['人物'].w === 3705, row('legacy', 't1'))
  check('③ `charfit=legacy` t=8 复现"钉在画面正中"：人物中心=(1921,1081)（= 画布中心 1920×1080）',
    L.legacy.t8.out['人物'].x0 === 1218 && L.legacy.t8.out['人物'].w === 1405
    && Math.abs((L.legacy.t8.out['人物'].x0 + L.legacy.t8.out['人物'].x1) / 2 - 1920) <= 1
    && Math.abs((L.legacy.t8.out['人物'].y0 + L.legacy.t8.out['人物'].y1) / 2 - 1080) <= 1,
    row('legacy', 't8') + ' c=(' + (L.legacy.t8.out['人物'].x0 + L.legacy.t8.out['人物'].x1) / 2 + ',' + (L.legacy.t8.out['人物'].y0 + L.legacy.t8.out['人物'].y1) / 2 + ')')
  // ② 新默认（auto，hina 有相机层 ⇒ 不适配）：t=8 落在**作者 origin**（2200.5,595.2），不再居中
  const a8 = L.auto.t8.out['人物']
  check('③ `charfit=auto` t=8 人物中心 == 作者 origin (2200.5,595.2) ⇒ **不再钉画布中心**',
    Math.abs((a8.x0 + a8.x1) / 2 - 2200.5) <= 1 && Math.abs((a8.y0 + a8.y1) / 2 - 595.2) <= 1,
    'c=(' + ((a8.x0 + a8.x1) / 2).toFixed(1) + ',' + ((a8.y0 + a8.y1) / 2).toFixed(1) + ') vs legacy c=(1921,1081)')
  check('③ `charfit=off` 与 `auto` 在 hina（有相机层）上**逐位相同**（该包无"无相机兜底"可走）',
    sameRects(L.off.t0.out, L.auto.t0.out) && sameRects(L.off.t1.out, L.auto.t1.out) && sameRects(L.off.t8.out, L.auto.t8.out))
  check('③ auto/off 与 legacy 在 hina 上**不同**（默认确实改了画面，不是空开关）',
    !sameRects(L.auto.t0.out, L.legacy.t0.out) && !sameRects(L.auto.t8.out, L.legacy.t8.out))
  // ③ 适配只碰角色层：背景/钢琴/花朵三档逐位相同
  const others = (o) => { const c = Object.assign({}, o); delete c['人物']; return c }
  check('③ 三档下**非角色层**（背景/钢琴/花朵/…）实绘矩形逐位相同 ⇒ 适配不外溢',
    sameRects(others(L.legacy.t0.out), others(L.auto.t0.out)) && sameRects(others(L.legacy.t8.out), others(L.off.t8.out)),
    Object.keys(others(L.auto.t0.out)).length + ' 层')
  check('③ 背景层仍被镜头带动（auto t=0 w=' + L.auto.t0.out['背景'].w + ' vs t=8 w=' + L.auto.t8.out['背景'].w + '）',
    L.auto.t0.out['背景'].w > 10000 && Math.abs(L.auto.t8.out['背景'].w - 3916) <= 1)
}

// ───────────────────────── ④ 蒙皮层相机接线（真机默认路径的根因） ─────────────────────────
console.log('\n── ④ 蒙皮层相机接线：`onMeshLayer(layer, camInfo)`（真包真渲染抓第二实参）──')
if (!haveHina) { console.log('  SKIP（缺 hina 包）') } else {
  const mFull = await gpuRects(HINA, { charfit: 'auto', campose: 'full', t: 0, wantMeshCam: true })
  const mLegacy = await gpuRects(HINA, { charfit: 'legacy', campose: 'full', t: 0, wantMeshCam: true })
  const mOff = await gpuRects(HINA, { charfit: 'auto', campose: 'off', t: 0, wantMeshCam: true })
  const mNoCam = await gpuRects(HINA, { charfit: 'auto', campose: 'full', cam: 0, t: 0, wantMeshCam: true })
  check('④ 默认（charfit=auto + campose=full）t=0：camInfo = view(1319.3776,−709.49872) + framed(1280,720)（= 设计画布/zoom 3）',
    !!mFull.meshCam && Math.abs(mFull.meshCam.view[0] - 1319.3776) < 0.01 && Math.abs(mFull.meshCam.view[1] + 709.49872) < 0.01
    && Math.abs(mFull.meshCam.framed[0] - 1280) < 0.01 && Math.abs(mFull.meshCam.framed[1] - 720) < 0.01,
    JSON.stringify(mFull.meshCam))
  check('④ 相机参数确实落在**人物层**（蒙皮层）上：' + Object.keys(mFull.meshCams).join('/'),
    !!mFull.meshCams['人物#66'] && Math.abs(mFull.meshCams['人物#66'].framed[0] - 1280) < 0.01,
    JSON.stringify(Object.keys(mFull.meshCams)))
  check('④ `?charfit=legacy` ⇒ camInfo=null（逐位回到"蒙皮层不接相机"的旧行为）', mLegacy.meshCam === null, String(mLegacy.meshCam))
  check('④ `?campose=off`（无相机姿态）⇒ camInfo=null（旧的 1:1 映射，零回归）', mOff.meshCam === null, String(mOff.meshCam))
  check('④ `?cam=0`（关相机层）⇒ camInfo=null', mNoCam.meshCam === null, String(mNoCam.meshCam))
  const camFull = await gpuRects(HINA, { charfit: 'auto', campose: 'full', t: 1, wantMeshCam: true })
  check('④ t=1 camInfo 随关键帧变化（zoom 3→2.6374：framed 宽 ' + (camFull.meshCam ? camFull.meshCam.framed[0].toFixed(1) : '-') + '）',
    !!camFull.meshCam && Math.abs(camFull.meshCam.framed[0] - 3840 / 2.6374) < 1.5, JSON.stringify(camFull.meshCam))
}

// ───────────────────────── ⑤ 凯尔希（无相机层）：兜底保留 ⇒ 默认逐位不变（护 P-76） ─────────────────────────
console.log('\n── ⑤ 凯尔希 3719111841（无相机节点）：auto 与 legacy **逐位相同**（"长发3"兜底保留）──')
if (!haveKal) { console.log('  SKIP（缺凯尔希包）') } else {
  const ka = await gpuRects(KAL, { charfit: 'auto', t: 1 })
  const kl = await gpuRects(KAL, { charfit: 'legacy', t: 1 })
  const ko = await gpuRects(KAL, { charfit: 'off', t: 1 })
  check('⑤ 该包 scene.cameraNode === null', ka.cam === null || ka.cam === undefined, String(ka.cam))
  check('⑤ auto == legacy（无相机层 ⇒ 超屏兜底照旧生效）', sameRects(ka.out, kl.out), Object.keys(ka.out).length + ' 层')
  check('⑤ auto != off（off 才真的关掉兜底）⇒ 三档语义可区分', !sameRects(ka.out, ko.out),
    '长发3 auto x0=' + (ka.out['长发3'] || {}).x0 + ' off x0=' + (ko.out['长发3'] || {}).x0)
  check('⑤ P-76 验收值不变：背景正常 x0=' + (ka.out['背景正常'] || {}).x0 + ' w=' + (ka.out['背景正常'] || {}).w,
    ka.out['背景正常'].x0 === -208 && Math.abs(ka.out['背景正常'].w - 4244) <= 1)
  check('⑤ 凯尔希三档（campose）逐位相同仍成立（P-84 ④ 的回归保护）',
    sameRects((await gpuRects(KAL, { campose: 'full', t: 1 })).out, (await gpuRects(KAL, { campose: 'off', t: 1 })).out))
}

// ───────────────────────── ⑥ renderMeshLayer 的 uniform 级验证（mock 录制） ─────────────────────────
console.log('\n── ⑥ renderMeshLayer：opts2.camera ⇒ u_View/u_Framed（mock 录制）；不传 ⇒ 旧值（零回归）──')
{
  const uniVal = new Map()
  const r = lib.createRenderer({ getContext: () => makeMockGL(uniVal), width: 1280, height: 720 }, { onLog: () => {} })
  const mesh = { positions: [[-50, -25, 0], [50, 25, 0]], uvs: [[0, 0], [1, 1]], indices: [0, 1, 0],
    blendIndices: [[0, 0, 0, 0], [0, 0, 0, 0]], blendWeights: [[1, 0, 0, 0], [1, 0, 0, 0]] }
  const bones = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const layer = { id: 9101, name: 'P-100 合成网格层', origin: [1000, 500, 0], scale: [1, 1, 1], size: [200, 100], alignment: 'center' }
  lib.meshBBox(mesh)
  uniVal.clear()
  r.renderMeshLayer(layer, mesh, bones, 1, [1000, 500], [1, -1], [3840, 2160], { id: 'tex' })
  check('⑥ 不传 camera：u_View=[0,0]、u_Framed=projWH（= 改动前逐位不变）',
    JSON.stringify(uniVal.get('u_View')) === '[0,0]' && JSON.stringify(uniVal.get('u_Framed')) === '[3840,2160]'
    && JSON.stringify(uniVal.get('u_Proj')) === '[3840,2160]',
    'u_View=' + JSON.stringify(uniVal.get('u_View')) + ' u_Framed=' + JSON.stringify(uniVal.get('u_Framed')))
  uniVal.clear()
  r.renderMeshLayer(layer, mesh, bones, 1, [1000, 500], [1, -1], [3840, 2160], { id: 'tex' },
    { camera: { view: [1319.3776, -709.49872], framed: [1280, 720] } })
  check('⑥ 传 camera：u_View/u_Framed 原样进 uniform（u_Proj 仍 = 设计画布 ⇒ 缩放基准=中心）',
    JSON.stringify(uniVal.get('u_View')) === '[1319.3776,-709.49872]' && JSON.stringify(uniVal.get('u_Framed')) === '[1280,720]'
    && JSON.stringify(uniVal.get('u_Proj')) === '[3840,2160]',
    'u_View=' + JSON.stringify(uniVal.get('u_View')) + ' u_Framed=' + JSON.stringify(uniVal.get('u_Framed')))
  uniVal.clear()
  r.renderMeshLayer(layer, mesh, bones, 1, [1000, 500], [1, -1], [3840, 2160], { id: 'tex' },
    { camera: { view: [1, 2], framed: [0, 720] } })
  check('⑥ 非法 framed（0 宽）⇒ 回落旧值（不产生 NaN/除零）',
    JSON.stringify(uniVal.get('u_Framed')) === '[3840,2160]' && JSON.stringify(uniVal.get('u_View')) === '[0,0]',
    'u_Framed=' + JSON.stringify(uniVal.get('u_Framed')))
}

// ───────────────────────── ⑦ 源码守卫（接线必须在真实路径上，不能只改测试） ─────────────────────────
console.log('\n── ⑦ 源码守卫：着色器/宿主/文档三处接线 ──')
{
  const bundle = fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'), 'utf8')
  const demo = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  const vs = (() => { const a = bundle.indexOf('const MESH_VS = `'); const b = bundle.indexOf('const MESH_FS = `'); return (a >= 0 && b > a) ? bundle.slice(a, b) : '' })()
  check('⑦ MESH_VS 声明 u_View / u_Framed', /uniform vec2 u_View;/.test(vs) && /uniform vec2 u_Framed;/.test(vs))
  check('⑦ MESH_VS 平移用 u_View、窗口用 u_Framed（不再只读 u_Proj）',
    /wpos = u_Origin \+ u_Scale \* sk\.xy \+ u_View/.test(vs) && /u_Framed\.x/.test(vs) && /u_Framed\.y/.test(vs))
  check('⑦ MESH_VS 以**画布中心**为缩放基准（c = u_Proj*0.5；绕 0 缩放会和四边形层不配准）',
    /vec2 c = u_Proj \* 0\.5;/.test(vs) && /\(wpos\.x - c\.x\)/.test(vs) && /\(c\.y - wpos\.y\)/.test(vs))
  check('⑦ renderMeshLayer 上传 u_View/u_Framed（含非法值回落）',
    /uniform2f\(meshUni\.view/.test(bundle) && /uniform2f\(meshUni\.framed/.test(bundle) && /opts2\.camera/.test(bundle))
  /* ①(P-257/P-258 2026-10-07) 判据跟随：`meshCamInfo` 的构造从一行拆成"姿态信息（__meshPoseInfo）+
     3D 相机（__mesh3dCam）合并"两行（几何层的 4×4 通路要额外带 `cam3d`；2D 场景两者皆 null ⇒
     结果与改动前逐位相同）。语义不变、仍然是"legacy 档不交相机姿态"⇒ 断言换成新写法；
     `__mesh3dCam` 另受 `?sky3d=legacy` 门控（那条由 mesh3d-camera-test 的 C7 盯）。 */
  check('⑦ renderScene 通过 onMeshLayer 第二实参交相机（且 legacy 档不交姿态）',
    /opts\.onMeshLayer\(layer, meshCamInfo\)/.test(bundle) &&
    /const __meshPoseInfo = \(__charfit !== 'legacy' && cam\.cameraPose\)/.test(bundle) &&
    /const meshCamInfo = \(__meshPoseInfo \|\| __mesh3dCam\)/.test(bundle) &&
    /const __mesh3dCam = \(__cam3d && MESH3D_MODE !== 'legacy'\) \? __cam3d : null/.test(bundle) &&
    /__mesh3dCam \? \{ cam3d: __mesh3dCam \} : null/.test(bundle))
  check('⑦ demo.html 转交 camera 进 renderMeshLayer（与 ?meshsize 的 opts2 合并、不互相覆盖）',
    /onMeshLayer: \(layer, camInfo\)/.test(demo) && /meshOpts = Object\.assign\(\{\}, meshOpts, \{ camera: \{ view: camInfo\.view, framed: camInfo\.framed \} \}\)/.test(demo))
  check('⑦ demo.html 台账 rd 走同一相机换算（不再报"世界坐标"而画面已被镜头带走）',
    /const mapX = \(x\) => \(x \+ vx - projW \/ 2\) \* \(projW \/ fw\) \+ projW \/ 2/.test(demo)
    && /const mapY = \(y\) => \(y \+ vy - projH \/ 2\) \* \(projH \/ fh\) \+ projH \/ 2/.test(demo))
  check('⑦ 角色层适配分支被 charfitMode 门控（不再无条件居中）',
    /if \(charfitMode !== 'off' && layer\.animLayers && layer\.parent === undefined/.test(bundle)
    && /charfitMode === 'legacy' \|\| !cam\.hasCameraNode/.test(bundle))
  check('⑦ buildCamera 回传 viewX/viewY/framedW/framedH/hasCameraNode（相机参数只有一份）',
    /viewX: pose \? -pose\.x : 0, viewY: pose \? pose\.y : 0/.test(bundle) && /framedW, framedH, hasCameraNode: !!\(scene && scene\.cameraNode\)/.test(bundle))
  check('⑦ 模块加载期的 `?charfit=` 读取与既有开关同形（`new URLSearchParams(location.search).get(\'charfit\')`，diag-flag-check 才抓得到）',
    /const v = new URLSearchParams\(location\.search\)\.get\('charfit'\)/.test(bundle))
  check('⑦ 启动日志自报档位（进 #log → 进上报，真机复测能看出跑在哪一档）+ renderer.charfitMode 只读暴露',
    /onLog\('P-100 角色层适配档 charfit='/.test(bundle) && /get charfitMode\(\) \{ return charfitMode \}/.test(bundle))
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(fail === 0 ? 0 : 1)

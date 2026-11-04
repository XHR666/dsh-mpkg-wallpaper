// mesh3d-camera-test.mjs — P-257（2026-10-07）**3D 场景的真 4×4 通路**（官方相机 + 图层模型矩阵 + 天空盒）。
//
// 缺口（第 98 轮台账 P-255 的"下一步"）：`?modellayer=mesh` 在 3D 包上画黑/被天空球压掉。根因不是网格注册
// （P-254 已 72/73 注册成功），而是**投影**：本仓 mesh 程序是给 puppet 的 2D 映射（`u_Origin + u_Scale·v`，
// z 丢掉；P-255 只补了一个标量 `camZ = (projH/2)/tan(fov/2)`）。官方几何层走完整 4×4：`mvp = viewProj · model`。
//
// 官方口径（`staging/upstream-2.1.0/assets/renderer-n-Rw_ZVc.js` 逐函数抄录）：
//   · 相机 `Q1` 3D 分支：`eye/center/up` + `fov`（**度**）+ `near=max(nearz,.01)` + `far=max(farz,1e4)`；
//   · **相机层优先**：`runtimeCamera = 最后一个可见相机层`（`{eye: origin, angles, fov: cameraFov}`，**没有 center**
//     ⇒ 朝向由 `eb([0,0,-1], pitch, yaw)` 推）—— 用 `scene.json` 那份静态 `camera:{eye,center,up}` 快照会让
//     本包（快照 eye=(0.11,2.23,-1.48) vs 相机层 eye=(0,0,0.454)）整场跑出画面；
//   · 图层 model `Kr`/`ps`：`T(effOrigin)·Ry(angles[1])·Rx(angles[0])·Rz(−angles[2])·S(sx, +sy, sz||1)`，
//     透视档 y 取 **+scale[1]**（模型空间与相机同为 y-up）；`effOrigin`：天空盒层（官方名判据 `天空盒`）
//     取**相机 eye** —— 这就是"相机在球壳内部"的官方处理；
//   · 深度：`enable(DEPTH_TEST)+LEQUAL`、`depthMask(!skybox)`；天空盒优先排序（稳定、天空盒在前）。
//
// 本仓差异（判据要盯住）：① `parseScene` 解析期做了 `PROJ_H − y`，且 3D 场景 `PROJ_H` 默认 1080 ⇒ 3D 侧必须
// `authorY = scene.projH − layer.origin[1]` 还原；② 默认关：没有调用方传 `opts2.mvp3d` ⇒ `u_Use3D=0` ⇒ 2D 通路
// 逐位不变（`kaltsit-puppet-anchor`/`meshsize` 盯这两档）。
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { createRenderer } from '../core/we-scene-bundle.js'
import { WS, ROOT } from './_root.mjs'

const CORE_SRC = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const DEMO_SRC = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const MPW_WS = process.env.MPW_ROOT || WS
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
// 列主序 4×4 作用到点（与 GLSL 一致）
const xf = (m, v) => {
  const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]
  const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]
  const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
  const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15]
  return [x, y, z, w]
}
const ndc = (m, v) => { const q = xf(m, v); return [q[0] / q[3], q[1] / q[3], q[2] / q[3], q[3]] }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
const nearV = (a, b, tol = 1e-6) => a.length === b.length && a.every((x, i) => near(x, b[i], tol))

console.log('== A 纯函数（官方逐式）==')
{
  // A1 旋转矩阵与官方 `Pd`/`Md`/`_d` 逐项一致（手算探针；列主序）
  const h = Math.PI / 2
  const ry = lib.mat4RotateY(lib.mat4Identity(), h)
  const rx = lib.mat4RotateX(lib.mat4Identity(), h)
  const rz = lib.mat4RotateZ(lib.mat4Identity(), -h)
  check('A1a Ry(π/2)·x̂ = (0,0,−1)（官方 Pd：col0=(c,0,−r)）', nearV(xf(ry, [1, 0, 0]).slice(0, 3), [0, 0, -1]),
    JSON.stringify(xf(ry, [1, 0, 0]).slice(0, 3).map((v) => +v.toFixed(4))))
  check('A1b Rx(π/2)·ŷ = (0,0,1)（官方 Md：col1=(0,c,s)）', nearV(xf(rx, [0, 1, 0]).slice(0, 3), [0, 0, 1]),
    JSON.stringify(xf(rx, [0, 1, 0]).slice(0, 3).map((v) => +v.toFixed(4))))
  check('A1c Rz(−π/2)·x̂ = (0,−1,0)（官方 _d：col0=(cos e, sin e)）', nearV(xf(rz, [1, 0, 0]).slice(0, 3), [0, -1, 0]),
    JSON.stringify(xf(rz, [1, 0, 0]).slice(0, 3).map((v) => +v.toFixed(4))))

  // A2 官方 `eb`（角度制、先 yaw 再 pitch）
  check('A2a cameraForwardFromAngles([0,0,−1], yaw=90°) = (−1,0,0)',
    nearV(lib.cameraForwardFromAngles(0, 90), [-1, 0, 0]), JSON.stringify(lib.cameraForwardFromAngles(0, 90).map((v) => +v.toFixed(4))))
  check('A2b cameraForwardFromAngles([0,0,−1], pitch=90°) = (0,1,0)',
    nearV(lib.cameraForwardFromAngles(90, 0), [0, 1, 0]), JSON.stringify(lib.cameraForwardFromAngles(90, 0).map((v) => +v.toFixed(4))))
  check('A2c 零角度恒等（(0,0,−1)）', nearV(lib.cameraForwardFromAngles(0, 0), [0, 0, -1]))

  // A3 buildMesh3dCamera：相机层优先 + y 还原 + angles 推朝向 + near/far 钳制 + 几何性质
  const sc = {
    projH: 1080,
    general: { fov: 50, farz: 10000, nearz: 0.01 },
    camera: { eye: '0.11 2.23 -1.48', center: '0.24 2.07 -0.51', up: '0 1 0' },
    cameraLayers: [{ id: 705, camera: 'default', fov: 50 }],
    // 作者 origin = "0 0 0.454"（真包原样）⇒ parse 后 = [0, PROJ_H−0, 0.454]
    layers: [{ id: 705, name: '相机', visible: true, origin: [0, 1080, 0.454], angles: [0, 0, 0], scale: [1, 1, 1] }],
  }
  const c3 = lib.buildMesh3dCamera(sc, 1280, 720)
  check('A3a **相机层优先**：eye = 相机层 origin（y 还原 projH−y），不是 scene.camera 快照',
    nearV(c3.eye, [0, 0, 0.454]), JSON.stringify(c3.eye))
  check('A3b 官方 runtimeCamera **没有 center** ⇒ 朝向由 angles 推（(0,0,−1)·1 + eye）',
    nearV(c3.center, [0, 0, -0.546]), JSON.stringify(c3.center))
  check('A3c fov/near/far 官方取值（fov 度；near=max(nearz,1e-4)；far=max(farz,near+1)）',
    c3.fov === 50 && near(c3.near, 0.01) && c3.far === 10000, JSON.stringify({ fov: c3.fov, near: c3.near, far: c3.far }))
  const vc = xf(c3.view, c3.center)
  check('A3d 几何性质：center 在相机正前方（view·center = (0,0,−d)）',
    near(vc[0], 0) && near(vc[1], 0) && vc[2] < 0, JSON.stringify(vc.map((v) => +v.toFixed(4))))
  const pc = ndc(c3.viewProj, c3.center)
  check('A3e 几何性质：center 投到画面中心（NDC xy ≈ 0）', near(pc[0], 0, 1e-5) && near(pc[1], 0, 1e-5),
    JSON.stringify(pc.slice(0, 2).map((v) => +v.toFixed(6))))
  const scNoCamLayer = Object.assign({}, sc, { cameraLayers: [] })
  const c3b = lib.buildMesh3dCamera(scNoCamLayer, 1280, 720)
  check('A3f 无相机层 ⇒ 回退静态 camera 快照（center 存在就用它）',
    nearV(c3b.eye, [0.11, 2.23, -1.48]) && nearV(c3b.center, [0.24, 2.07, -0.51]) && c3b.cameraLayer === null,
    JSON.stringify({ eye: c3b.eye, center: c3b.center, layer: c3b.cameraLayer }))
  /* ①(P-260 2026-10-07) `cameraLayers` 缺席时的 **`cameraNode` 回退**：`originRaw` 是作者空间原文
     （`'0 0 6'` 或 `{script,value}`）⇒ 直接当 eye 用（不再做 `projH − y` 还原）；`center` 仍由 angles 推。
     判据同时被 `camera-persp` ⑦ 交叉验证（该合成场景只有 `cameraNode`，6:3:2 透视律逐位成立）。 */
  const scNode = {
    projH: 1080, general: { fov: 50, nearz: 0.01, farz: 10000 }, camera: null,
    cameraNode: { id: 443, camera: 'default', fov: 50, originRaw: '0 0 6', angles: [0, 0, 0] },
    layers: [],
  }
  const c3n = lib.buildMesh3dCamera(scNode, 1280, 720)
  check('A3h `cameraLayers` 缺席 ⇒ 用 `cameraNode` 顶上（eye = originRaw 作者空间原文、center 由 angles 推）',
    nearV(c3n.eye, [0, 0, 6]) && nearV(c3n.center, [0, 0, 5]) && c3n.fov === 50 && c3n.cameraLayer === 'default',
    JSON.stringify({ eye: c3n.eye, center: c3n.center, layer: c3n.cameraLayer }))
  const c3v = lib.buildMesh3dCamera(Object.assign({}, scNode, { cameraNode: { id: 443, fov: 40, originRaw: { value: '1 2 3' } } }), 1280, 720)
  check('A3i `originRaw` 为 `{script,value}` 形态时吃 `.value`（P-120 宿主就地求值后的结果）',
    nearV(c3v.eye, [1, 2, 3]) && c3v.fov === 40, JSON.stringify({ eye: c3v.eye, fov: c3v.fov }))
  const scUp = {
    projH: 1080, general: { fov: 40, nearz: 0.5, farz: 5 },
    camera: null, cameraLayers: [{ id: 9, camera: 'default', fov: null }],
    layers: [{ id: 9, name: 'cam', visible: true, origin: [1, 2, 3], angles: [0, 0, 0], scale: [1, 1, 1] }],
  }
  const c3c = lib.buildMesh3dCamera(scUp, 0, 0)   // 非法尺寸 ⇒ aspect 回退 16/9
  check('A3g 非法尺寸 ⇒ aspect 16/9；fov 缺省回退 general.fov；near 钳到 1e-4 以上', near(c3c.aspect, 16 / 9) && c3c.fov === 40 && c3c.near === 0.5 && c3c.far === 5,
    JSON.stringify({ aspect: c3c.aspect, fov: c3c.fov, near: c3c.near, far: c3c.far }))

  // A4 mesh3dModelMatrix：y 还原 / 缩放对角 / 旋转顺序 / 天空盒跟随相机 / mvp
  const synthCam = { eye: [7, 8, 9], viewProj: lib.mat4Identity() }
  const L = { name: '行星', origin: [1, 1080 - 2, 3], angles: [0, 0, 0], scale: [2, 3, 4] }
  const m0 = lib.mesh3dModelMatrix(L, synthCam, { projH: 1080 })
  check('A4a 平移列 = 作者 y 还原后的 origin（parse 的 PROJ_H−y 在这里被还原）',
    near(m0.model[12], 1) && near(m0.model[13], 2) && near(m0.model[14], 3), JSON.stringify([m0.model[12], m0.model[13], m0.model[14]]))
  check('A4b 缩放对角 = (scale[0], **+scale[1]**, scale[2]||1)（透视档 y 不翻符号）',
    near(m0.model[0], 2) && near(m0.model[5], 3) && near(m0.model[10], 4), JSON.stringify([m0.model[0], m0.model[5], m0.model[10]]))
  const Lr = { name: '行星', origin: [0, 1080, 0], angles: [Math.PI / 2, 0, 0], scale: [1, 1, 1] }
  const mr = lib.mesh3dModelMatrix(Lr, synthCam, { projH: 1080 })
  check('A4c Rx(angles[0])：angles[0]=π/2 时 ŷ → ẑ（作用于顶点，等价 col1=(0,c,s)）',
    nearV(xf(mr.model, [0, 1, 0]).slice(0, 3), [0, 0, 1]), JSON.stringify(xf(mr.model, [0, 1, 0]).slice(0, 3).map((v) => +v.toFixed(4))))
  const Lz = { name: '行星', origin: [0, 1080, 0], angles: [0, 0, Math.PI / 2], scale: [1, 1, 1] }
  const mz = lib.mesh3dModelMatrix(Lz, synthCam, { projH: 1080 })
  check('A4d Rz(−angles[2])：angles[2]=π/2 时 x̂ → (0,−1,0)（官方 `_d` 传 −angles[2]）',
    nearV(xf(mz.model, [1, 0, 0]).slice(0, 3), [0, -1, 0]), JSON.stringify(xf(mz.model, [1, 0, 0]).slice(0, 3).map((v) => +v.toFixed(4))))
  const mSky = lib.mesh3dModelMatrix({ name: '天空盒A', origin: [5, 1080 - 6, 7], angles: [0, 0, 0], scale: [10000, 10000, 10000] }, synthCam, { projH: 1080 })
  const mSky2 = lib.mesh3dModelMatrix({ name: 'skybox1', origin: [5, 1080 - 6, 7], angles: [0, 0, 0], scale: [10000, 10000, 10000] }, synthCam, { projH: 1080 })
  const mPlain = lib.mesh3dModelMatrix({ name: '陨石', origin: [5, 1080 - 6, 7], angles: [0, 0, 0], scale: [1, 1, 1] }, synthCam, { projH: 1080 })
  check('A4e 天空盒（官方名 `天空盒`）的平移 = 相机 eye（相机永远在球心）',
    nearV([mSky.model[12], mSky.model[13], mSky.model[14]], synthCam.eye) && mSky.skybox === true, JSON.stringify(mSky.effOrigin))
  check('A4f 天空盒扩展名 `skybox*`（本仓扩展：`3662790108` 的 skybox1/2）同样跟随相机',
    nearV([mSky2.model[12], mSky2.model[13], mSky2.model[14]], synthCam.eye) && mSky2.skybox === true, JSON.stringify(mSky2.effOrigin))
  check('A4g 普通层用自身 origin；`legacyName` 关掉扩展名判据（官方口径严格档）',
    nearV([mPlain.model[12], mPlain.model[13], mPlain.model[14]], [5, 6, 7]) && mPlain.skybox === false &&
    lib.isSkyboxLayer({ name: '天空盒A' }, { legacyName: true }) === true &&
    lib.isSkyboxLayer({ name: 'skybox1' }, { legacyName: true }) === false)
  const mVp = { eye: [0, 0, 0], viewProj: lib.mat4Translate(lib.mat4Identity(), 0, 0, -5) }
  const mvpChk = lib.mesh3dModelMatrix(L, mVp, { projH: 1080 })
  check('A4h mvp = viewProj · model（与独立乘算逐位一致）',
    nearV(Array.from(mvpChk.mvp), Array.from(lib.mat4Multiply(mVp.viewProj, mvpChk.model))))

  // A5 天空盒优先排序：稳定、只前移天空盒、不改原数组
  const arr = [{ name: 'a' }, { name: 'skybox1' }, { name: 'b' }, { name: '天空盒c' }, { name: 'd' }]
  const sorted = lib.sortSkyboxFirst(arr)
  check('A5a 天空盒整体前移，其余保持原相对顺序；原数组不被改',
    sorted.map((x) => x.name).join(',') === 'skybox1,天空盒c,a,b,d' && arr.map((x) => x.name).join(',') === 'a,skybox1,b,天空盒c,d',
    sorted.map((x) => x.name).join(','))
  check('A5b `legacyName` 档只认官方名（skybox* 不再前移）',
    lib.sortSkyboxFirst(arr, { legacyName: true }).map((x) => x.name).join(',') === '天空盒c,a,skybox1,b,d',
    lib.sortSkyboxFirst(arr, { legacyName: true }).map((x) => x.name).join(','))
}

console.log('== B 真语料 0923/3662790108（3D 太阳系：静态快照相机 vs 相机层）==')
const PKG_ID = '3662790108'
const PKG_PATH = path.join(MPW_WS, 'allwallpaper', '0923', PKG_ID, 'scene.pkg')
if (!fs.existsSync(PKG_PATH)) check('B0 语料包存在', false, '缺失: ' + PKG_PATH)
else {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG_PATH)))
  const raw = lib.getEntry(pkg, 'scene.json')
  const sceneJson = JSON.parse(Buffer.from(raw).toString('utf8'))
  const ctx = { readEntry: (n) => lib.getEntry(pkg, n), readEntryRange: (n, o, l) => lib.getEntryRange(pkg, n, o, l) }
  const parsed = lib.parseScene(sceneJson, null, { attachCtx: ctx })
  const mdl = parsed.layers.filter((l) => /\.mdl$/i.test(String(l.image || '')))
  check('B1 场景判据：无正交矩形 + fov 50 + farz 1e4 + nearz 0.01；mdl 层 73；相机层 1 个',
    !parsed.general.orthogonalprojection && parsed.general.fov === 50 && parsed.general.farz === 10000 &&
    mdl.length === 73 && parsed.cameraLayers.length === 1 && parsed.cameraLayers[0].id === 705,
    JSON.stringify({ fov: parsed.general.fov, mdl: mdl.length, camLayers: parsed.cameraLayers }))
  const cam3d = lib.buildMesh3dCamera(parsed, 1280, 720)
  check('B2 **相机取相机层 #705**（eye=(0,0,0.454)、朝 −z）—— 用 scene.camera 快照 (0.11,2.23,−1.48) 会让整场跑出画面',
    nearV(cam3d.eye, [0, 0, 0.454], 1e-6) && nearV(cam3d.center, [0, 0, -0.546], 1e-6) && cam3d.cameraLayer === '705',
    JSON.stringify({ eye: cam3d.eye, center: cam3d.center, layer: cam3d.cameraLayer }))
  // ①(P-260) 反证要把**两个相机来源都清掉**才是"只剩静态 camera 快照"（`cameraNode` 回退是 P-260 新加的：
  //   真包有 `#705` 相机节点 ⇒ 只清 `cameraLayers` 会落到相机节点、原点投影回画面中心，反证失去意义）
  const bad = lib.buildMesh3dCamera(Object.assign({}, parsed, { cameraLayers: [], cameraNode: null }), 1280, 720)
  const snapNdc = ndc(bad.viewProj, [0, 0, 0])
  check('B2b 反证：**只留静态快照**时场景原点被投到画面外（|NDC.y| > 1）—— 故"用哪台相机"是真问题',
    Math.abs(snapNdc[1]) > 1, 'snap ndc=' + JSON.stringify(snapNdc.slice(0, 3).map((v) => +v.toFixed(3))))

  let nan = 0, onScreen = 0, effOk = 0
  const detail = []
  const skyNames = []
  for (const l of mdl) {
    const md = lib.mesh3dModelMatrix(l, cam3d, { projH: parsed.projH })
    const flat = Array.from(md.mvp)
    if (flat.some((v) => !Number.isFinite(v))) nan++
    // 行星/探测器类（非天空盒）原点必须落在视锥内
    if (!md.skybox) {
      const c = ndc(md.mvp, [0, 0, 0])
      if (Number.isFinite(c[0]) && Math.abs(c[0]) <= 1 && Math.abs(c[1]) <= 1) onScreen++
      else detail.push(l.name + ':' + c.slice(0, 2).map((v) => +v.toFixed(2)).join(','))
    } else {
      skyNames.push(l.name)
      // 天空盒：model 的平移列必须等于相机 eye（相机在球心）
      if (near(md.model[12], cam3d.eye[0], 1e-6) && near(md.model[13], cam3d.eye[1], 1e-6) && near(md.model[14], cam3d.eye[2], 1e-6)) effOk++
    }
  }
  check('B3 73 层 mvp 全为有限值（无 NaN/Inf）', nan === 0, 'nan=' + nan)
  check('B4 非天空盒层（行星/探测器）原点全部落在视锥内（|NDC| ≤ 1）',
    onScreen === mdl.length - skyNames.length && onScreen > 60, onScreen + '/' + (mdl.length - skyNames.length) + ' 例外=' + detail.slice(0, 4).join(' '))
  check('B5 天空盒层（skybox1/2，扩展名判据）model 平移 = 相机 eye',
    skyNames.length === 2 && effOk === 2, skyNames.join('/') + ' ok=' + effOk)

  // B6 反证：P-255 标量档在同一批层上是退化的（所有层塌到同一点且在画面外）
  const projW = 1280, projH = 720, fov = 50
  const camZ = (projH / 2) / Math.tan(fov * Math.PI / 360)
  const p255 = (l) => {
    const t = Math.tan(fov * Math.PI / 360)
    const d = Math.max(camZ - (l.origin[2] || 0), 1)
    return [(l.origin[0] - projW / 2) / (d * t * (projW / projH)), (projH / 2 - l.origin[1]) / (d * t)]
  }
  const p255Rows = mdl.map(p255)
  const offScreen = p255Rows.filter((p) => Math.abs(p[1]) > 1).length
  check('B6 反证：P-255 标量档 73/73 层的原点都在画面外（y≈−2），新通路才有画面',
    offScreen === mdl.length, offScreen + '/' + mdl.length + ' 例=' + JSON.stringify(p255Rows[0].map((v) => +v.toFixed(2))))
}

console.log('== C 源码/接线保证（默认关 + 深度 + 排序 + 回退口）==')
{
  check('C1 MESH_VS 有 `u_MVP3D`/`u_Use3D` 与官方同式分支（`gl_Position = u_MVP3D * vec4(sk.xy, sk.z, 1.0)`、先于 2D 数学 return）',
    /uniform mat4 u_MVP3D;/.test(CORE_SRC) && /uniform float u_Use3D;/.test(CORE_SRC) &&
    /if \(u_Use3D > 0\.5\) \{\s*\n\s*gl_Position = u_MVP3D \* vec4\(sk\.xy, sk\.z, 1\.0\);/.test(CORE_SRC) &&
    CORE_SRC.indexOf('gl_Position = u_MVP3D') < CORE_SRC.indexOf('vec2 c = u_Proj * 0.5;'))
  check('C2 `renderMeshLayer` 只在 `opts2.mvp3d` 长度 16 时启用（否则 u_Use3D=0 ⇒ 2D 逐位不变），且深度状态画完复位',
    /const __m3 = \(opts2 && opts2\.mvp3d && opts2\.mvp3d\.length === 16\) \? opts2\.mvp3d : null/.test(CORE_SRC) &&
    /if \(meshUni\.use3d\) gl\.uniform1f\(meshUni\.use3d, __m3 \? 1 : 0\)/.test(CORE_SRC) &&
    /__depthTouched\) \{\s*\n\s*try \{ gl\.disable\(gl\.DEPTH_TEST\); gl\.depthMask\(true\) \}/.test(CORE_SRC))
  check('C3 天空盒 `depthMask(false)`（只测不写）+ LEQUAL（官方 `draw` 的 keepZ 分支）',
    /gl\.depthMask\(!\(opts2 && opts2\.skybox\)\)/.test(CORE_SRC) && /gl\.depthFunc\(gl\.LEQUAL\)/.test(CORE_SRC))
  check('C4 场景目标 RT 申请深度附件（`?q=` 与 HDR 两条路），且只在真透视场景',
    /__perspScene \? \{ depth: true \} : null/.test(CORE_SRC) &&
    /__perspScene \? \{ float: 'half', depth: true \} : \{ float: 'half' \}/.test(CORE_SRC) &&
    /gl\.clear\(gl\.COLOR_BUFFER_BIT \| \(__perspScene \? gl\.DEPTH_BUFFER_BIT : 0\)\)/.test(CORE_SRC))
  check('C5 `getFBO` 的 depth 选项进缓存键（同 tag 不同深度不串用）且建 DEPTH_COMPONENT24 附件',
    /\|depth' : ''/.test(CORE_SRC) && /gl\.renderbufferStorage\(gl\.RENDERBUFFER, gl\.DEPTH_COMPONENT24, w, h\)/.test(CORE_SRC))
  check('C6 天空盒优先排序只在 `__perspScene` + `?skyfirst=legacy` 回退口，且不改 `scene.layers`',
    /const __drawLayers = \(__perspScene && SKYFIRST_MODE !== 'legacy'\) \? sortSkyboxFirst\(scene\.layers\) : scene\.layers/.test(CORE_SRC) &&
    /for \(const layer of __drawLayers\) \{/.test(CORE_SRC))
  check('C7 `?sky3d=legacy` 回退口在 core（MESH3D_MODE）且 `legacy` 时**几何层**拿不到 cam3d（回 P-255 档）',
    /if \(\/\[\?&\]sky3d=legacy\/\.test/.test(CORE_SRC) &&
    /const __cam3d = \(__perspScene && \(MESH3D_MODE !== 'legacy' \|\| QUAD3D_MODE !== 'legacy'\)\)/.test(CORE_SRC) &&
    /const __mesh3dCam = \(__cam3d && MESH3D_MODE !== 'legacy'\) \? __cam3d : null/.test(CORE_SRC))
  /* ①(P-258 2026-10-07) 四边形层的 3D 通路（与几何层同一台相机 + 官方 Kr 透视分支）：
     `cam.cam3d` 只在 `?quad3d=legacy` 没关时挂上；矩阵走"作者 y 还原 + Ry/Rx/Rz + 世界单位 + y 取负"。 */
  /* ①(P-258 2026-10-07) 四边形层的 3D 通路（`?quad3d=m3d` 显式开，**缺省 legacy = 逐位回到改动前**）：
     矩阵走"作者 y 还原 + Ry/Rx/Rz + 世界单位 + y 取负（本仓 LOCAL_QUAD 把 y-down 烘进几何）"，
     视图投影必须与层变换**同档**（legacy 档不许换相机，否则是"像素层坐标 + 世界相机"的错配），
     且 3D 档的退化门限按世界单位（1e-6）而不是 2D 的 0.5px。 */
  check('C10 四边形层的 3D 通路（缺省开、`?quad3d=legacy` 回退）：相机与层变换同档、作者 y 还原、Ry/Rx 参与、y 取 −h、退化门限按世界单位',
    /if \(__quad3d\) cam\.cam3d = __quad3d/.test(CORE_SRC) &&
    /const __quad3d = \(__cam3d && QUAD3D_MODE !== 'legacy'\) \? __cam3d : null/.test(CORE_SRC) &&
    /let viewProj = __quad3d \? __quad3d\.viewProj : mat4Multiply\(cam\.projection, cam\.view\)/.test(CORE_SRC) &&
    /\[\?&\]quad3d=legacy\//.test(CORE_SRC) && /catch \(e\) \{ return 'm3d' \} \}\)\(\)/.test(CORE_SRC) &&
    /const __c3 = \(cam && cam\.cam3d && QUAD3D_MODE !== 'legacy'\) \? cam\.cam3d : null/.test(CORE_SRC) &&
    /const __ey = __sky \? __c3\.eye\[1\] : \(__ph - oy\)/.test(CORE_SRC) &&
    /if \(Number\(layer\.angles\[1\]\)\) m = mat4RotateY\(m, Number\(layer\.angles\[1\]\)\)/.test(CORE_SRC) &&
    /m = mat4Scale\(m, w, -h, 1\)/.test(CORE_SRC) &&
    /const __eps = __is3dQuad \? 1e-6 : 0\.5/.test(CORE_SRC))
  check('C8 demo 只在 `camInfo.cam3d` 存在时传 mvp3d/skybox；否则落回 P-255 标量档（两段都在）',
    /const c3 = \(camInfo && camInfo\.cam3d\) \? camInfo\.cam3d : null/.test(DEMO_SRC) &&
    /mvp3d: md3\.mvp, skybox: md3\.skybox/.test(DEMO_SRC) &&
    /persp: \(!hasOrtho && fov3d > 0\) \? \{ fov: fov3d, camZ:/.test(DEMO_SRC))
  check('C9 `mesh3dStats()`/`mesh3dNote()` 在渲染器上（真机取证用），且 `scene.cameraLayers` 由 parseScene 落库',
    /get mesh3dStats\(\) \{ return Object\.assign\(\{\}, mesh3dLedger\) \}/.test(CORE_SRC) &&
    /mesh3dNote: function \(patch\)/.test(CORE_SRC) && /cameraLayers: \(sceneJson\.objects \|\| \[\]\)\.filter/.test(CORE_SRC))
}

console.log('== D mock-GL 端到端（mvp3d 通路 / 默认关 / 天空盒深度）==')
{
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, DEPTH_TEST: 0x0B71, LEQUAL: 0x0203 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let ids = 0, curProg = null
  const uniLog = [], depthLog = [], draws = []
  const mk = (kind) => ({ id: kind + '#' + (++ids) })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'), bindVertexArray: () => {}, activeTexture: () => {}, bindTexture: () => {},
    useProgram: (p) => { curProg = p },
    uniform1f: (l, v) => { if (l && l.n) uniLog.push([l.n, +v]) },
    uniformMatrix4fv: (l, tr, v) => { if (l && l.n) uniLog.push([l.n, Array.from(v).slice(0, 4).map((x) => +x.toFixed(3)).join(','), tr]) },
    uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {}, uniform1i: () => {}, uniformMatrix3fv: () => {},
    enable: (cap) => depthLog.push('enable:' + (cap === CONST.DEPTH_TEST ? 'DEPTH' : cap)),
    disable: (cap) => depthLog.push('disable:' + (cap === CONST.DEPTH_TEST ? 'DEPTH' : cap)),
    depthFunc: (f) => depthLog.push('func:' + f), depthMask: (v) => depthLog.push('mask:' + !!v),
    drawElements: (m, c) => draws.push({ prog: curProg && curProg.id, count: c }),
    getUniformLocation: (p, n) => ({ p, n }), getProgramParameter: () => true, getShaderParameter: () => true,
    getActiveUniform: () => ({ name: 'u_Tex', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 2 }),
    getAttribLocation: () => 0, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const canvas = { getContext: () => gl }
  const shaderResolver = async () => 'void main(){}'
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  const mesh = { positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], uvs: [[0, 0], [1, 0], [0, 1]], indices: [0, 1, 2],
    blendIndices: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], blendWeights: [[1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]], bones: [] }
  const gB = new Float32Array(16); gB[0] = gB[5] = gB[10] = gB[15] = 1
  const layer = { id: 42, name: '行星', origin: [0, 1080, 0], scale: [1, 1, 1], angles: [0, 0, 0] }
  const M = new Float32Array(lib.mat4Translate(lib.mat4Identity(), 1, 2, -3))

  uniLog.length = 0; depthLog.length = 0; draws.length = 0
  r.renderMeshLayer(layer, mesh, gB, 1, [0, 0], [1, 1], [1280, 720], { __mpwId: 'tex_a' }, null)
  const use3dDefault = uniLog.find((x) => x[0] === 'u_Use3D')
  check('D1 **默认关**：不传 `opts2.mvp3d` ⇒ `u_Use3D=0`、不上传矩阵、一次 DEPTH_TEST 都不碰',
    !!use3dDefault && use3dDefault[1] === 0 && !uniLog.some((x) => x[0] === 'u_MVP3D') &&
    !depthLog.some((x) => /DEPTH_TEST/.test(x)) && draws.length === 1,
    'use3d=' + JSON.stringify(use3dDefault) + ' depth=' + JSON.stringify(depthLog))

  uniLog.length = 0; depthLog.length = 0; draws.length = 0
  r.renderMeshLayer(layer, mesh, gB, 1, [0, 0], [1, 1], [1280, 720], { __mpwId: 'tex_a' }, { mvp3d: M })
  const use3d1 = uniLog.find((x) => x[0] === 'u_Use3D')
  const mvpUp = uniLog.find((x) => x[0] === 'u_MVP3D')
  check('D2 传 `mvp3d` ⇒ `u_Use3D=1` + 原样上传矩阵 + 开深度（enable/LEQUAL/mask true）并**画完复位**',
    !!use3d1 && use3d1[1] === 1 && !!mvpUp && mvpUp[2] === false && mvpUp[1] === '1,0,0,0' &&
    depthLog.filter((x) => /DEPTH|func:|mask:/.test(x)).join('|') === ['enable:DEPTH', 'func:' + CONST.LEQUAL, 'mask:true',
      'disable:DEPTH', 'mask:true'].join('|') && draws.length === 1,
    JSON.stringify(depthLog))

  uniLog.length = 0; depthLog.length = 0; draws.length = 0
  r.renderMeshLayer(layer, mesh, gB, 1, [0, 0], [1, 1], [1280, 720], { __mpwId: 'tex_a' }, { mvp3d: M, skybox: true })
  check('D3 天空盒 ⇒ `depthMask(false)`（只测不写，后画的实心几何压得住它），仍然复位',
    depthLog.filter((x) => /DEPTH|func:|mask:/.test(x)).join('|') === ['enable:DEPTH', 'func:' + CONST.LEQUAL, 'mask:false',
      'disable:DEPTH', 'mask:true'].join('|'), JSON.stringify(depthLog))

  uniLog.length = 0; depthLog.length = 0; draws.length = 0
  r.renderMeshLayer(layer, mesh, gB, 1, [0, 0], [1, 1], [1280, 720], { __mpwId: 'tex_a' }, { mvp3d: new Float32Array(4) })
  check('D4 长度不对的 `mvp3d`（4 个元素）被拒 ⇒ 回到 `u_Use3D=0`、不碰深度（防"半截矩阵"污染）',
    (uniLog.find((x) => x[0] === 'u_Use3D') || [])[1] === 0 && !uniLog.some((x) => x[0] === 'u_MVP3D') && !depthLog.some((x) => /DEPTH_TEST/.test(x)))
}

console.log('== E 老式模型层档位（P-259：auto=3D 几何档 / off 时 `.mdl` 不进通用贴图链）==')
{
  /* ①(P-259 2026-10-07) 档位解析在**运行时**做（`resolveModellayerMode(scene)`）：
     `off|0|false` → off、`1|on|quad` → quad、`mesh` → mesh、缺省（auto）= 真 3D 场景 + ≥1 个 `.mdl` 层 ⇒ mesh。
     判据盯三件：四档解析存在且显式档优先；auto 判据只看"无正交矩形 + 有 fov + mdl 层数 > 0"；
     旧常量 `MODELLAYER_ON` / `MODELLAYER_MESH` **在所有消费点都被替换**（漏一处就会绕过档位）。 */
  check('E1 `resolveModellayerMode` 在位且四档齐备（off/quad/mesh/auto），auto 判据 = persp + mdl>0',
    /function resolveModellayerMode\(scene\)/.test(DEMO_SRC) &&
    /if \(a === '0' \|\| a === 'off' \|\| a === 'false' \|\| a === 'none'\) return 'off'/.test(DEMO_SRC) &&
    /if \(a === '1' \|\| a === 'on' \|\| a === 'quad'\) return 'quad'/.test(DEMO_SRC) &&
    /if \(a === 'mesh'\) return 'mesh'/.test(DEMO_SRC) &&
    /return \(persp && mdl > 0\) \? 'mesh' : 'off'/.test(DEMO_SRC))
  check('E2 `.mdl` 层的通用贴图链门（档位 off 时跳过）+ `?mdlquad=legacy` 回退口 + 台账 `__mpwMdlQuad`',
    /if \(MODELLAYER_MODE === 'off' && !MDLQUAD_LEGACY && \/\\.mdl\$\/i\.test\(String\(layer\.image\)\)\) \{/.test(DEMO_SRC) &&
    /\[\?&\]mdlquad=legacy\//.test(DEMO_SRC) &&
    /window\.__mpwMdlQuad = Object\.assign\(\{ skipped: 0, drawn: 0 \}, window\.__mpwMdlQuad\)/.test(DEMO_SRC) &&
    /  MODELLAYER_MODE = resolveModellayerMode\(scene\)/.test(DEMO_SRC) &&
    /window\.__mpwModellayer = \{/.test(DEMO_SRC))
  /* ①(P-259 事故复盘) 档位变量的**作用域**是硬要求：几何注册段在另一个函数里读它 ⇒ 必须模块级
     `let` + `loadScene` 内只赋值；写成 `const`（loadScene 内）会 `❌ 启动失败: MODELLAYER_MODE is not
     defined`（本轮真机四档全黑），与 P-254 的 `MODELLAYER_ON` 事故同型。 */
  check('E2b 档位变量是**模块级 let**（loadScene 内只赋值、不再声明）+ 初值按显式档解析（auto 临时 mesh）',
    /^let MODELLAYER_MODE = \(\(\) => \{/m.test(DEMO_SRC) &&
    /return 'mesh'   \/\/ 显式 'mesh' 与 auto 的临时值相同/.test(DEMO_SRC) &&
    /^  MODELLAYER_MODE = resolveModellayerMode\(scene\)/m.test(DEMO_SRC) &&
    !/^\s*const MODELLAYER_MODE\b/m.test(DEMO_SRC))
  check('E3 旧常量在所有**消费点**都被档位替换（只剩定义/注释；漏一处 = 绕过档位）',
    !/if \(MODELLAYER_ON && \/\\.mdl\$\/i\.test\(String\(layer\.image\)\)\)/.test(DEMO_SRC) &&
    !/skinEnabled && MODELLAYER_ON && MODELLAYER_MESH/.test(DEMO_SRC) &&
    /if \(MODELLAYER_MODE !== 'off' && \/\\.mdl\$\/i\.test\(String\(layer\.image\)\)\) \{/.test(DEMO_SRC) &&
    /if \(MODELLAYER_MODE === 'mesh'\) \{/.test(DEMO_SRC))
  check('E4 几何注册只在 `mesh` 档（`quad` 档不许注册网格：否则四边形档会被几何覆盖）',
    /if \(MODELLAYER_MODE === 'mesh'\) \{/.test(DEMO_SRC) &&
    /const __skinOn = !new URLSearchParams\(location\.search\)\.has\('skin0'\)/.test(DEMO_SRC) &&
    /if \(__skinOn\) \{ try \{ registerStaticModelMeshes\(scene, pkg\) \} catch/.test(DEMO_SRC))
  /* ①(P-259 第三处事故复盘) 注册**必须在加载期**执行、不能挂在场景脚本节拍之后：本包真机实测
     `applySceneScripts()` 在挂载期抛错 ⇒ `runSceneScripts` 的 `catch … return` 让后面的注册永远不跑
     （`frames` 涨到 166、`__mpwModelMesh.seen` 恒 0）。 */
  check('E4b 注册函数是**模块级**且被 `loadScene` 就地调用（不再依赖 `runSceneScripts` 的节拍）',
    /^function registerStaticModelMeshes\(scene, pkg\) \{/m.test(DEMO_SRC) &&
    /const __modelMeshStat = \{ seen: 0, drawn: 0, skipped: 0, bytes: 0, reasons: \{\} \}/.test(DEMO_SRC) &&
    /^let __modelMeshScene = null$/m.test(DEMO_SRC) &&
    /if \(!scene \|\| !Array\.isArray\(scene\.layers\) \|\| __modelMeshScene === scene\) return stat/.test(DEMO_SRC) &&
    !/const modelMeshStat = \{ seen: 0/.test(DEMO_SRC))
  // E5 离线：真包按 auto 判据各命中一次（3D 包 ⇒ mesh；2D 包 ⇒ off）
  const P3D = path.join(MPW_WS, 'allwallpaper', '0923', '3662790108', 'scene.pkg')
  const P2D = path.join(MPW_WS, 'allwallpaper', '0923', '3463520581', 'scene.pkg')
  const modeOf = (p) => {
    if (!fs.existsSync(p)) return null
    const pk = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
    const sc = JSON.parse(Buffer.from(lib.getEntry(pk, 'scene.json')).toString('utf8'))
    const persp = !!(sc.general && sc.general.fov) && !(sc.general.orthogonalprojection && Number(sc.general.orthogonalprojection.width) > 0)
    const mdl = (sc.objects || []).filter((o) => typeof o.model === 'string' && /\.mdl$/i.test(o.model)).length
    return { persp, mdl, mode: (persp && mdl > 0) ? 'mesh' : 'off' }
  }
  const m3 = modeOf(P3D), m2 = modeOf(P2D)
  check('E5 auto 判据离线复算：3D 包（3662790108）⇒ mesh、2D 包（3463520581）⇒ off',
    !!m3 && m3.persp === true && m3.mdl === 73 && m3.mode === 'mesh' && !!m2 && m2.persp === false && m2.mode === 'off',
    JSON.stringify({ '3d': m3, '2d': m2 }))
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败（P-257 3D 相机/模型矩阵/天空盒）')
process.exit(fail === 0 ? 0 : 1)

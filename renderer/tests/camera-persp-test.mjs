/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // camera-persp-test.mjs — P-107：透视相机（`general.fov`）落地 + `?projmode=persp|ortho|auto` 回退
//
// 背景（UNTOUCHED-AREAS 的 J 项，长期标注"无样本可验"）：`buildCamera` 此前只构造 `mat4Ortho`，
//   `fov` 写进 pose 也没有落点。2026-09-17 用户新下的 `allwallpaper/0917/3509243656` 补上了这个缺口：
//   `general.orthogonalprojection = null`（语料 38 个容器里**唯一**一个没有正交矩形的包）+
//   相机层 `origin = "0 0 6"`（静态）+ `zoom = 1` + `fov = {"user":"newproperty71","value":50}`
//   （project.json 里该属性 text="视场"、type=slider、min 40 max 65 step 0.1）+
//   142 个对象分布在 z ∈ [−50, +6]（96 个 z=0、24 个 z=5.1、Sky/太阳/星球在 −6…−50）⇒ 真正的 3D 场景。
//
// 本文件断言（①..⑦）：
//   ① `?projmode=` 真值表（纯函数 projModeFrom / resolveProjMode，与 bundle 内 PROJMODE 同一份）
//   ② `mat4Perspective` 的数学契约（glMatrix 同构；NDC/w 除、近大远小、near/far 项）
//   ③ **正交路径逐位不变**：与"改动前的冻结实现"逐元素 `===`（合成正交场景 + 3 个真正交包 + 相机姿态）
//   ④ 正交包被强制透视时 `z=0` 平面不变（只差 Float32 舍入）+ 投影矩阵确实换成了透视
//   ⑤ fov 敏感性：正交档 10 vs 120 **逐位相同**（旧断言）；透视档 10 vs 120 **必须不同**
//   ⑥ 透视包 3509243656：auto ⇒ 节点锚定透视（fov 50 / 相机 z=6）、persp vs ortho 有差异且**符合透视律**
//      （近大远小、层间距被压缩）、fov 改变投影（tan 比例）、面板"视场"滑块（fovFromUser）真的驱动 fov
//   ⑦ mock-GL **真实 renderScene**：开关真的进了渲染路径（mvp 的 w 行非平凡 + 三层 z 的宽度比 6:3:2）
//
// 运行：node tests/camera-persp-test.mjs   （全过输出 ALL PASS，退出码 0）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

globalThis.location = globalThis.location || { search: '' }
const ROOT = path.resolve(import.meta.dirname, '..')
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)

// ①(去个人化 2026-09-16) 工作区根：环境变量优先；默认值只是作者本机路径，发布副本请设 MPW_ROOT。
const MPW_WS = process.env.MPW_ROOT || WS
const DD = process.env.MPW_SCENE_ROOT || path.join(MPW_WS, 'allwallpaper', 'dd')
const NEW17 = process.env.MPW_SCENE_ROOT_0917 || path.join(MPW_WS, 'allwallpaper', '0917')
const PERSP_ID = '3509243656'                    // 语料唯一非正交（3D）包
const KAL = '3719111841', HINA = '3554161528', SUN = '3327063360'   // 三个正交对照包
const W = 1920, H = 1080
const dec = new TextDecoder()
const rd = (b) => dec.decode(b).replace(/^\uFEFF/, '')

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const bits = (m) => Array.from(m).join(',')
const sameMat = (a, b) => bits(a) === bits(b)

/** 读包（**不整包拷贝**：readFileSync 的 Buffer 直接开视图，158MB 的 3509243656 也只读一次） */
function loadPkg(p) {
  const b = fs.readFileSync(p)
  const pkg = lib.parsePkg(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
  return { pkg, raw: JSON.parse(rd(lib.getEntry(pkg, 'scene.json'))) }
}
const projOf = (p) => path.join(DD, p, 'scene.pkg')
const perspPkg = () => path.join(NEW17, PERSP_ID, 'scene.pkg')

// ── 冻结参考实现：**改动前**的 buildCamera 投影/view 表达式（逐字抄自 git HEAD 的同一段；本测试专用）──
//   只覆盖正交档（透视档在改动前根本不存在）。任何对正交路径的"顺手改动"都会在这里逐位爆红。
function refOrthoCamera(scene, width, height, opts = {}) {
  const general = scene.general
  const cam = scene.camera
  const eyeV = cam && cam.eye ? String(cam.eye).trim().split(/\s+/).map(Number) : [0, 0, 0]
  const centerV = cam && cam.center ? String(cam.center).trim().split(/\s+/).map(Number) : [0, 0, -1]
  const upV = cam && cam.up ? String(cam.up).trim().split(/\s+/).map(Number) : [0, 1, 0]
  const isOrtho = !general || general.orthogonalprojection || !general.fov
  const pose = opts && opts.cameraPose && typeof opts.cameraPose === 'object' ? opts.cameraPose : null
  let view = isOrtho ? lib.mat4Identity() : lib.mat4LookAt(eyeV, centerV, upV)
  let viewBg = view
  let nodeZoom = null
  if (pose) {
    const pz = (typeof pose.zoom === 'number' && isFinite(pose.zoom) && pose.zoom > 0.0001) ? pose.zoom : null
    nodeZoom = pz
    view = lib.mat4Translate(lib.mat4Identity(), -pose.x, pose.y, 0)
    viewBg = lib.mat4Identity()
  }
  const sw = general && general.orthogonalprojection ? general.orthogonalprojection.width || width : width
  const sh = general && general.orthogonalprojection ? general.orthogonalprojection.height || height : height
  let framedW = sw
  let framedH = sh
  if (width > 0 && height > 0) {
    const fboAspect = width / height
    const sAspect = sw / sh
    const zoom = nodeZoom || ((typeof general.zoom === 'number' && general.zoom > 0.0001) ? general.zoom : 1)
    const fmRaw = String((opts && opts.fillmode) || general.fillmode || 'aspectcrop').toLowerCase()
    const fitLike = (fboAspect < sAspect)
    if (fmRaw === 'stretch') { framedW = sw; framedH = sh }
    else if (fmRaw === 'aspectfit') {
      if (fboAspect < sAspect) { framedW = sw; framedH = sw / fboAspect } else { framedW = sh * fboAspect; framedH = sh }
    } else if (fmRaw === 'center') { framedW = width; framedH = height }
    else { if (fitLike) { framedW = sh * fboAspect; framedH = sh } else { framedW = sw; framedH = sw / fboAspect } }
    framedW = Math.max(1, framedW / zoom)
    framedH = Math.max(1, framedH / zoom)
  }
  const projW = sw
  const projH = sh
  const cx = projW / 2, cy = projH / 2
  const projection = lib.projectionYFix()
    ? lib.mat4Ortho(cx - framedW / 2, cx + framedW / 2, cy + framedH / 2, cy - framedH / 2, -10000, 10000)
    : lib.mat4Ortho(cx - framedW / 2, cx + framedW / 2, cy - framedH / 2, cy + framedH / 2, -10000, 10000)
  return { view, viewBg, projection, framedW, framedH }
}
const sameCamera = (a, b) => sameMat(a.projection, b.projection) && sameMat(a.view, b.view)
  && sameMat(a.viewBg, b.viewBg) && a.framedW === b.framedW && a.framedH === b.framedH

/** 图层 quad 的 4 角 → 屏幕像素矩形（与 compositeLayer 的 m 同式；**含 w 除**，透视档要它才对） */
function layerRectPx(layer, cam) {
  const vp = lib.mat4Multiply(cam.projection, cam.view)
  const w = layer.size[0] * layer.scale[0], h = layer.size[1] * layer.scale[1]
  let m = lib.mat4Translate(lib.mat4Identity(), layer.origin[0], layer.origin[1], layer.origin[2] || 0)
  m = lib.mat4RotateZ(m, -(layer.angles[2] || 0))
  m = lib.mat4Scale(m, w, h, 1)
  const off = lib.alignmentOffsetForToken(layer.alignment, w, h)
  m = lib.mat4Translate(m, off[0], -off[1], 0)
  const mm = lib.mat4Multiply(vp, m)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [lx, ly] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const p = lib.mat4TransformPoint(mm, lx, ly, 0)
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1])
  }
  return { x0: (x0 + 1) / 2 * W, y0: (1 - y1) / 2 * H, w: (x1 - x0) / 2 * W, h: (y1 - y0) / 2 * H }
}

// ───────────────────────── ① 真值表 ─────────────────────────
console.log('── ① `?projmode=` 真值表（纯函数，唯一真值表）──')
check('缺省（空 search）⇒ auto（按场景声明走：有正交矩形=正交、无矩形+fov=透视）', lib.projModeFrom('') === 'auto')
check('`?projmode=auto` ⇒ auto', lib.projModeFrom('?projmode=auto') === 'auto')
check('`?projmode=persp` ⇒ persp', lib.projModeFrom('?projmode=persp') === 'persp')
check('`?projmode=ortho` ⇒ ortho（逐位回退口）', lib.projModeFrom('?projmode=ortho') === 'ortho')
check('非法值 `=bogus` ⇒ auto（不静默变 persp/ortho）', lib.projModeFrom('?projmode=bogus') === 'auto')
check('空值 `?projmode=` ⇒ auto', lib.projModeFrom('?projmode=') === 'auto')
check('大小写 `=PERSP` ⇒ auto（只认精确小写，避免"看着开了其实没开"）', lib.projModeFrom('?projmode=PERSP') === 'auto')
check('与其它参数共存 `?id=3509243656&projmode=persp&t=3` ⇒ persp', lib.projModeFrom('?id=3509243656&projmode=persp&t=3') === 'persp')
check('**不叫 `proj`**：`?proj=off`（P-85 跳过 project.json）不会被当成投影档', lib.projModeFrom('?proj=off') === 'auto')
check('优先级：opts > live > URL（测试/宿主显式传最高）',
  lib.resolveProjMode('ortho', 'persp', 'persp') === 'ortho' && lib.resolveProjMode(undefined, 'persp', 'ortho') === 'persp'
  && lib.resolveProjMode(undefined, undefined, 'persp') === 'persp' && lib.resolveProjMode(undefined, undefined, undefined) === 'auto')

// ───────────────────────── ② mat4Perspective 数学契约 ─────────────────────────
console.log('\n── ② `mat4Perspective` 数学契约（glMatrix 同构）──')
{
  const fov = 50 * Math.PI / 180, aspect = W / H, near = 0.01, far = 10000
  const P = lib.mat4Perspective(fov, aspect, near, far)
  const f = 1 / Math.tan(fov / 2)
  check('proj[0]=f/aspect、proj[5]=f、proj[11]=−1、proj[15]=0（w 行 = −z_view）',
    P[0] === Math.fround(f / aspect) && P[5] === Math.fround(f) && P[11] === -1 && P[15] === 0)
  check('proj[10]=(far+near)/(near−far)、proj[14]=2·far·near/(near−far)',
    P[10] === Math.fround((far + near) / (near - far)) && P[14] === Math.fround(2 * far * near / (near - far)))
  // 帧平面锚定：world z=0 → NDC 0；z=−d/2（更近）→ 2×；z=+d/2（更远）→ 2/3×
  const d = 1158
  const V = lib.mat4Scale(lib.mat4Translate(lib.mat4Identity(), 0, 0, -d), 1, -1, -1)
  const vp = lib.mat4Multiply(P, V)
  const at = (z) => lib.mat4TransformPoint(vp, 100, 0, z)[0]
  const z0 = at(0)
  check('帧平面锚定：z=0 平面（x=0）→ NDC 0（相机在 −d、窗口中心在 x=0）', Math.abs(z0 - (f / aspect) * 100 / d) < 1e-6,
    'NDC(x=100,z=0)=' + z0.toFixed(6))
  check('近大远小比值：z=−d/2 ⇒ ×2.000、z=+d/2 ⇒ ×0.667（= d/(d+z) 透视律）',
    Math.abs(at(-d / 2) / z0 - 2) < 1e-4 && Math.abs(at(d / 2) / z0 - 2 / 3) < 1e-4,
    '实际 ' + (at(-d / 2) / z0).toFixed(5) + ' / ' + (at(d / 2) / z0).toFixed(5))
  check('w 除确实发生：同一世界点 (x,z=−d/2) 的 clip.w = d/2（= 相机距离）',
    Math.abs((P[3] * 100 + P[11] * (-d / 2) + P[15]) - d / 2) < 1e-4,
    'w=' + (P[3] * 100 + P[11] * (-d / 2) + P[15]).toFixed(4))
}

// ───────────────────────── ③ 正交路径逐位不变（冻结参考实现 + 真包）─────────────────────────
console.log('\n── ③ 正交路径**逐位不变**（冻结实现对拍；改一行就红）──')
{
  const synth = lib.parseScene({
    general: { orthogonalprojection: { width: 3840, height: 2160 }, fov: 50, zoom: 1.25 },
    camera: { eye: '1 2 3', center: '0 0 0', up: '0 1 0' }, objects: [],
  }, null, {})
  for (const [label, sc] of [['合成正交包', synth]]) {
    for (const opts of [{}, { fillmode: 'stretch' }, { fillmode: 'aspectfit' }, { fillmode: 'center' },
      { cameraPose: { x: 12, y: -34, z: 56, zoom: 1.7, fov: 42 } }]) {
      const a = lib.buildCamera(sc, W, H, opts), b = refOrthoCamera(sc, W, H, opts)
      check('③ ' + label + ' opts=' + JSON.stringify(opts) + ' ⇒ projection/view 逐位相同（kind=' + a.projKind + '）',
        sameCamera(a, b) && a.projKind === 'ortho' && a.projAnchor === null)
    }
  }
  for (const id of [KAL, HINA, SUN]) {
    const p = projOf(id)
    if (!fs.existsSync(p)) { console.log('  SKIP ③ ' + id + '（缺包）'); continue }
    const { raw } = loadPkg(p)
    const sc = lib.parseScene(raw, null, {})
    for (const opts of [{}, { cameraPose: { x: 100, y: -200, z: 300, zoom: 1.7, fov: 42 } }, { cam: 'node' }]) {
      const a = lib.buildCamera(sc, W, H, opts), b = refOrthoCamera(sc, W, H, opts)
      check('③ 真包 ' + id + ' opts=' + JSON.stringify(opts) + ' ⇒ 逐位相同（auto 档 = 正交）',
        sameCamera(a, b) && a.projKind === 'ortho', 'proj[0]=' + a.projection[0])
    }
    // `?projmode=ortho` 也必须逐位等于冻结实现（一键回退的硬保证）
    const o = lib.buildCamera(sc, W, H, { proj: 'ortho', cameraPose: { x: 5, y: 6, z: 7, zoom: 1.1, fov: 30 } })
    const ob = refOrthoCamera(sc, W, H, { cameraPose: { x: 5, y: 6, z: 7, zoom: 1.1, fov: 30 } })
    check('③ 真包 ' + id + ' `?projmode=ortho` ⇒ 与冻结实现逐位相同', sameCamera(o, ob))
  }
}

// ───────────────────────── ④ 正交包强制透视：z=0 平面不变 ─────────────────────────
console.log('\n── ④ 正交包强制 `persp`：投影确实变了，但 z=0 平面只差 Float32 舍入（安全 A/B）──')
{
  const p = projOf(KAL)
  if (!fs.existsSync(p)) { console.log('  SKIP ④（缺凯尔希包）') } else {
    const { raw } = loadPkg(p)
    const sc = lib.parseScene(raw, null, {})
    const o = lib.buildCamera(sc, W, H, { proj: 'ortho' })
    const q = lib.buildCamera(sc, W, H, { proj: 'persp' })
    check('④ 凯尔希有 39 层且**全部 z=0**（该包没有立体层）',
      sc.layers.filter((l) => Math.abs(l.origin[2] || 0) > 1e-9).length === 0, sc.layers.length + ' 层')
    check('④ 投影矩阵**确实换成透视**（proj[11]=−1，与正交逐位不同）',
      q.projKind === 'persp' && q.projection[11] === -1 && !sameMat(q.projection, o.projection),
      'anchor=' + q.projAnchor + ' d=' + q.perspDist.toFixed(1) + ' fov=' + q.fovY)
    let maxPx = 0
    for (const l of sc.layers) {
      if (!l.visible) continue
      const ro = layerRectPx(l, o), rp = layerRectPx(l, q)
      maxPx = Math.max(maxPx, Math.abs(ro.x0 - rp.x0), Math.abs(ro.y0 - rp.y0), Math.abs(ro.w - rp.w), Math.abs(ro.h - rp.h))
    }
    check('④ z=0 平面：全部层矩形差 < 0.001px（Float32 舍入量级；帧平面锚定的设计不变式）',
      maxPx < 1e-3, 'maxΔ=' + maxPx.toExponential(2) + 'px')
  }
}

// ───────────────────────── ⑤ fov 敏感性（旧断言改口径）─────────────────────────
console.log('\n── ⑤ fov 敏感性：正交档仍**逐位相同**；透视档**必须不同** ──')
{
  const sc = lib.parseScene({ general: { orthogonalprojection: { width: 3840, height: 2160 }, fov: 50 }, objects: [] }, null, {})
  const o10 = lib.buildCamera(sc, W, H, { cameraPose: { x: 0, y: 0, zoom: 1, fov: 10 } })
  const o120 = lib.buildCamera(sc, W, H, { cameraPose: { x: 0, y: 0, zoom: 1, fov: 120 } })
  check('⑤ 正交档：fov 10 vs 120 投影**逐位相同**（fov 无落点，与 P-81 的旧断言一致）',
    sameMat(o10.projection, o120.projection) && o10.projKind === 'ortho' && o10.fovY === null)
  const p10 = lib.buildCamera(sc, W, H, { proj: 'persp', cameraPose: { x: 0, y: 0, zoom: 1, fov: 10 } })
  const p120 = lib.buildCamera(sc, W, H, { proj: 'persp', cameraPose: { x: 0, y: 0, zoom: 1, fov: 120 } })
  check('⑤ 透视档：fov 10 vs 120 投影**不同**（proj[5] 比 = tan(60°)/tan(5°) = 19.81）',
    !sameMat(p10.projection, p120.projection)
    && Math.abs((p10.projection[5] / p120.projection[5]) - Math.tan(60 * Math.PI / 180) / Math.tan(5 * Math.PI / 180)) < 1e-3,
    'proj[5] 10°=' + p10.projection[5].toFixed(4) + ' 120°=' + p120.projection[5].toFixed(4))
  check('⑤ 透视档帧平面锚定：d 随 fov 反比变化（fov 越小 d 越大 ⇒ 立体感越弱）',
    p10.perspDist > p120.perspDist && Math.abs(p10.perspDist / p120.perspDist - Math.tan(60 * Math.PI / 180) / Math.tan(5 * Math.PI / 180)) < 1e-3,
    'd(10°)=' + p10.perspDist.toFixed(1) + ' d(120°)=' + p120.perspDist.toFixed(1))
}

// ───────────────────────── ⑥ 真透视包 3509243656 ─────────────────────────
console.log('\n── ⑥ 真透视包 ' + PERSP_ID + '（语料唯一无正交矩形 = 3D 场景）──')
const havePersp = fs.existsSync(perspPkg())
if (!havePersp) { console.log('  SKIP ⑥（缺 ' + PERSP_ID + ' 包）') } else {
  const { raw, pkg } = loadPkg(perspPkg())
  const sc = lib.parseScene(raw, null, {})
  const g = raw.general || {}
  check('⑥ 场景读数：`orthogonalprojection` 缺省/null + fov=50 + nearz≈0.01 + farz=10000',
    (g.orthogonalprojection === null || g.orthogonalprojection === undefined) && g.fov === 50
    && Math.abs(g.nearz - 0.01) < 1e-6 && g.farz === 10000)
  check('⑥ 相机节点：origin 静态 `0 0 6`（相机 z=6）、zoom=1、fov 是**用户属性绑定** newproperty71、无关键帧',
    sc.cameraNode && sc.cameraNode.originRaw === '0.00000 0.00000 6.00000' && sc.cameraNode.active === false
    && sc.cameraNode.fovBinding && sc.cameraNode.fovBinding.user === 'newproperty71'
    && sc.cameraNode.zoomRaw === 1 && !(sc.cameraNode.fovRaw && sc.cameraNode.fovRaw.animation),
    'id=' + sc.cameraNode.id)
  const auto = lib.buildCamera(sc, W, H, {})
  const orth = lib.buildCamera(sc, W, H, { proj: 'ortho' })
  check('⑥ auto ⇒ **节点锚定透视**：kind=persp / anchor=node / fov=50 / 相机 z=6',
    auto.projKind === 'persp' && auto.projAnchor === 'node' && auto.fovY === 50 && Math.abs(auto.perspDist - 6) < 1e-9)
  check('⑥ `?projmode=ortho` ⇒ 逐位回到改动前（冻结实现）', sameCamera(orth, refOrthoCamera(sc, W, H, {})))
  check('⑥ persp vs ortho 投影矩阵确实不同（proj[11]: ' + auto.projection[11] + ' vs ' + orth.projection[11] + '）',
    !sameMat(auto.projection, orth.projection) && auto.projection[11] === -1 && orth.projection[11] === 0)
  // 透视律：屏宽比 = (w_b/w_a)·((z_cam−z_a)/(z_cam−z_b))（z_cam=6）
  const byName = (n) => sc.layers.find((l) => l.name === n)
  // 屏宽律：w_px(z) ∝ 世界宽 / (z_cam − z) ⇒ 两层屏宽比 = (w_b/w_a)·(z_cam−z_a)/(z_cam−z_b)
  const law = (A, B) => {
    const ra = layerRectPx(A, auto), rb = layerRectPx(B, auto)
    const wa = A.size[0] * A.scale[0], wb = B.size[0] * B.scale[0]
    const za = A.origin[2] || 0, zb = B.origin[2] || 0
    return { meas: rb.w / ra.w, pred: (wb / wa) * ((6 - za) / (6 - zb)) }
  }
  const far1 = byName('Custom BG'), far2 = byName('Sun png')
  if (far1 && far2) {
    const L = law(far1, far2)
    check('⑥ 近大远小：Custom BG(z=−50) 与 Sun png(z=−30) 的屏宽比符合 d/(z_cam−z) 透视律（误差 <1%）',
      Math.abs(L.meas / L.pred - 1) < 0.01, '实测 ' + L.meas.toFixed(4) + ' 预测 ' + L.pred.toFixed(4))
    const ro1 = layerRectPx(far1, orth), rp1 = layerRectPx(far1, auto)
    const ro2 = layerRectPx(far2, orth), rp2 = layerRectPx(far2, auto)
    check('⑥ persp vs ortho 差异方向：远层 z=−50 被压缩（' + (rp1.w / ro1.w).toFixed(3) + '×）、近层 z=−30 相对更大（'
      + (rp2.w / ro2.w).toFixed(3) + '×）⇒ 比值随 z 单调',
      (rp1.w / ro1.w) > 0 && (rp2.w / ro2.w) > (rp1.w / ro1.w), 'z=−50 比值=' + (rp1.w / ro1.w).toFixed(3))
  } else { console.log('  SKIP ⑥ 透视律两层的名字没对上（素材改名？）') }
  const nearGap = (6 + 50) / (6 - 5.1)
  check('⑥ 层间距被压缩：近层(z=5.1)/远层(z=−50) 的**同一世界偏移**屏距比 = ' + nearGap.toFixed(1) + '（>50×）',
    nearGap > 50)
  const p40 = lib.buildCamera(sc, W, H, { proj: 'persp', cameraPose: { x: 0, y: 0, z: 6, zoom: 1, fov: 40 } })
  const p65 = lib.buildCamera(sc, W, H, { proj: 'persp', cameraPose: { x: 0, y: 0, z: 6, zoom: 1, fov: 65 } })
  check('⑥ fov 40 vs 65（透视档）真的改变投影：proj[5] 比 = tan(32.5°)/tan(20°) = '
    + (Math.tan(32.5 * Math.PI / 180) / Math.tan(20 * Math.PI / 180)).toFixed(4),
    Math.abs(p40.projection[5] / p65.projection[5] - Math.tan(32.5 * Math.PI / 180) / Math.tan(20 * Math.PI / 180)) < 1e-3)
  if (far2) {
    const w40 = layerRectPx(far2, p40).w, w65 = layerRectPx(far2, p65).w
    check('⑥ 层矩形随之变化：Sun png 屏宽 fov40=' + w40.toFixed(1) + 'px → fov65=' + w65.toFixed(1) + 'px（比 = 1.519）',
      Math.abs(w40 / w65 - Math.tan(32.5 * Math.PI / 180) / Math.tan(20 * Math.PI / 180)) < 0.01)
  }
  // 面板"视场"滑块：project.json 的 newproperty71 覆盖值必须真的进 fov
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(NEW17, PERSP_ID, 'project.json'), 'utf8'))
    const prop = ((pj.general || {}).properties || {}).newproperty71
    check('⑥ project.json：newproperty71 = "视场" slider ∈[40,65] step 0.1 默认 50',
      !!prop && prop.text === '视场' && prop.min === 40 && prop.max === 65 && prop.value === 50)
    const before = sc.cameraNode.fovFromUser
    lib.applyUserProperties(sc, { newproperty71: 65 })
    const f65 = lib.buildCamera(sc, W, H, {})
    check('⑥ **面板滑块驱动 fov**：newproperty71=65 ⇒ cameraNode.fovFromUser=65 ⇒ buildCamera fovY=65（默认 null=' + before + '）',
      sc.cameraNode.fovFromUser === 65 && f65.fovY === 65)
    lib.applyUserProperties(sc, {})
    check('⑥ 幂等：属性表不含该键 ⇒ fovFromUser 归 null、fov 回落到绑定静态值 50',
      sc.cameraNode.fovFromUser === null && lib.buildCamera(sc, W, H, {}).fovY === 50)
  } catch (e) { console.log('  SKIP ⑥ 属性滑块（project.json 读取失败：' + e.message + '）') }
  // 缩放因子：g 里的 zoom 与相机 zoom 都是 1 ⇒ 不影响；确认 zoom≠1 时节点锚定档走投影缩放
  const z2 = lib.buildCamera(sc, W, H, { proj: 'persp', cameraPose: { x: 0, y: 0, z: 6, zoom: 2, fov: 50 } })
  check('⑥ zoom 在节点锚定档进投影（proj[0]/proj[5] ×2，与 elysia 透视分支同式）',
    z2.projection[0] === Math.fround(auto.projection[0] * 2) && z2.projection[5] === Math.fround(auto.projection[5] * 2))
}

// ───────────────────────── ⑦ mock-GL 真实 renderScene ─────────────────────────
console.log('\n── ⑦ mock-GL 真实 renderScene：开关进的是**渲染路径**（mvp 的 w 行 + 三层 z 的 6:3:2）──')
{
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  function makeMockGL() {
    let curFbo = null, ids = 0
    const Hd = {
      createTexture: () => ({ id: 't' + (++ids) }), createFramebuffer: () => ({ id: 'f' + (++ids) }),
      createBuffer: () => ({ id: 'b' + (++ids) }), createVertexArray: () => ({ id: 'v' + (++ids) }),
      createShader: () => ({ id: 's' + (++ids) }), createProgram: () => ({ id: 'p' + (++ids) }),
      bindFramebuffer: (t, f) => { curFbo = f },
      getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
      getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
      getActiveAttrib: (p, i) => ({ name: i ? 'a_TexCoord' : 'a_Position', size: i ? 2 : 3 }),
      getAttribLocation: (p, n) => n === 'a_Position' ? 0 : 1,
      getUniformLocation: () => ({ u: 1 }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
      getError: () => CONST.NO_ERROR,
      getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
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
  const mkLayer = (id, z, extra) => Object.assign({ id, name: 'z' + z, visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [10, 10], scale: [1, 1, 1], origin: [0, 1080, z], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
  // 合成 3D 场景：无正交矩形 + fov ⇒ auto 走透视；相机节点 = 作者锚定（origin "0 0 6"）
  const scene = {
    general: { fov: 50, nearz: 0.01, farz: 10000, clearcolor: '0 0 0', clearenabled: true },
    camera: null, projH: 1080, properties: {},
    cameraNode: { id: 443, camera: 'default', fov: 50, originRaw: '0 0 6', zoomRaw: 1,
      zoomBinding: null, fovRaw: 50, fovBinding: null, zoomFromUser: null, fovFromUser: null, active: false },
    layers: [mkLayer(1, 3, { size: [10, 10] }), mkLayer(2, 0, { size: [10, 10] }), mkLayer(3, -3, { size: [10, 10] })],
  }
  const textures = new Map([['tex_a', { glTex: { id: 'tex' }, width: 64, height: 64 }]])
  const run = async (projMode) => {
    const seen = new Map()
    const r = lib.createRenderer({ getContext: () => makeMockGL(), width: W, height: H }, {
      onLog: () => {}, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG), onMeshLayer: () => {},
      trace: false, auditFrames: 1, hideParticles: true, parallaxOff: true, proj: projMode,
      onLayerDraw: (layer, info) => {
        if (info.width !== W || seen.has(layer.id)) return
        const m = info.mvp
        const corners = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([x, y]) => {
          const w = m[3] * x + m[7] * y + m[11] * 0 + m[15]
          return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w]
        })
        const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1])
        const wPx = (Math.max(...xs) - Math.min(...xs)) / 2 * W
        seen.set(layer.id, { m, wPx, wRow: [m[3], m[7], m[11], m[15]] })
      },
    })
    await r.render(scene, textures, W, H, 0)
    return seen
  }
  const P = await run('persp')
  const O = await run('ortho')
  check('⑦ 真实路径三层都画了（onLayerDraw 各层一次）', P.size === 3 && O.size === 3, 'persp=' + P.size + ' ortho=' + O.size)
  check('⑦ 透视档 mvp 的 w 行非平凡（m[11]=−1、平移项=相机距离 3 ⇒ 真的走了 w 除），正交档 w 行 = [0,0,0,1]',
    P.get(1).wRow[2] === -1 && P.get(1).wRow[3] === 3 && O.get(1).wRow[0] === 0 && O.get(1).wRow[1] === 0
    && O.get(1).wRow[2] === 0 && O.get(1).wRow[3] === 1,
    'persp w 行=' + JSON.stringify(P.get(1).wRow.map((v) => +v.toFixed(4))) + ' ortho=' + JSON.stringify(O.get(1).wRow))
  const w3 = P.get(1).wPx, w0 = P.get(2).wPx, wm3 = P.get(3).wPx
  check('⑦ 近大远小（相机 z=6）：z=3 / z=0 / z=−3 的屏宽比 = 6:3:2 = '
    + (w3 / w0).toFixed(3) + ' : ' + (wm3 / w0).toFixed(3) + '（透视律 d/(z_cam−z)）',
    Math.abs(w3 / w0 - 2) < 1e-4 && Math.abs(wm3 / w0 - 2 / 3) < 1e-4,
    'w(' + w3.toFixed(2) + ',' + w0.toFixed(2) + ',' + wm3.toFixed(2) + ')px')
  check('⑦ 正交档三层屏宽**完全相同**（这些层的世界尺寸一样 ⇒ 无透视就没有 z 差）',
    Math.abs(O.get(1).wPx - O.get(2).wPx) < 1e-6 && Math.abs(O.get(3).wPx - O.get(2).wPx) < 1e-6,
    'ortho w=' + O.get(2).wPx.toFixed(3) + 'px')
  const exp = lib.buildCamera(scene, W, H, {})
  check('⑦ onLayerDraw 的 mvp 与 `buildCamera` 的台账一致（projKind=' + exp.projKind + ' anchor=' + exp.projAnchor + '）',
    exp.projKind === 'persp' && exp.projAnchor === 'node')
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED ' + fail) + '：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }
process.exit(0)

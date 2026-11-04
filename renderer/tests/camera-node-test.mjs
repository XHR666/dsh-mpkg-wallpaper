/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // camera-node-test.mjs — ①D 相机节点动画验收（ZCODE-MERGED-1 第 2 项，WER-ALIGN B4/B9）
// 断言：
//   T1 (eyeX,eyeY,zoom) 逐帧（0..3s，1/30s）与 elysia 相机对象烘培值 Δ<1e-6（3554161528，语料唯一
//      origin+zoom 关键帧动画包；camera-scan.mjs 全语料 107 包：23 个相机对象、仅此包动画驱动）。
//   T2 buildCamera 接线：pose→view 平移(−x,+y)/viewBg 恒等/窗口=framed/zoom；无 pose→逐位旧行为。
//   T3 无相机节点包（3719111841 等 5 包）cameraNode=null、buildCamera 输出与旧式逐位一致。
//   T4 满幅背景层豁免判定（elysia _viewShift isBg=size≥ortho−1）：背景(3840×2260)豁免、钢琴(2239×2211)不豁免。
//   T5 语料计数（camera-scan 复算 6 回归包）：3554161528 是唯一动画相机节点包。
// 运行：node camera-node-test.mjs   （全过输出 ALL PASS，退出码 0）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
import { SceneRenderer } from '../elysia/we-renderer/core.js'
import { parseVec3, getVal } from '../elysia/we-renderer/math.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const DEC = new TextDecoder()
const rd = (b) => DEC.decode(new Uint8Array(b)).replace(/^\uFEFF/, '')
const DIR = `${MPW_WS}/allwallpaper/dd`
const IDS = ['3554161528', '3544152633', '3327063360', '3326873240', '3660962877', '3719111841']

let failed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}

function loadPkg(id) {
  const pkgBuf = new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`))
  const p = lib.parsePkg(pkgBuf)
  const readEntry = (n) => lib.getEntry(p, n)
  const raw = JSON.parse(rd(readEntry('scene.json')))
  const epkg = {
    has: (n) => !!readEntry(n), read: readEntry,
    readJson: (n) => { const b = readEntry(n); return b ? JSON.parse(rd(b)) : null },
    readText: (n) => { const b = readEntry(n); return b ? rd(b) : null }, entries: () => p.entries,
  }
  return { readEntry, raw, epkg }
}

// ── T1 相机姿态逐帧 vs elysia ──
console.log('[T1] (eyeX,eyeY,zoom) 与 elysia 相机对象烘培值逐帧比对（0..3s，1/30s）')
{
  const { raw, epkg, readEntry } = loadPkg('3554161528')
  const scene = lib.parseScene(raw, null, {})
  ok(scene.cameraNode && scene.cameraNode.active === true, 'T1a cameraNode 解析且 active（origin 有关键帧）',
    `id=${scene.cameraNode && scene.cameraNode.id}`)
  const r = new SceneRenderer(epkg, { width: 3840, height: 2160, weAssetsRead: () => null, time: 0 })
  const camObjE = (r.objects || []).find((o) => o && o.camera === 'default')
  ok(!!camObjE, 'T1b elysia 侧相机对象存在')
  // 官方/elysia 语义：scene.camera.eye 为默认 (0,0,0) 时相机对象 origin 生效（camera.js :193-200）
  const eyeV = String(raw.camera && raw.camera.eye || '0 0 0').trim().split(/\s+/).map(Number)
  const eyeDefault = eyeV.every((n) => Math.abs(n) < 1e-6)
  ok(eyeDefault, 'T1c scene.camera.eye=(0,0,0)（相机对象驱动前提）')
  let maxD = 0, maxZoomD = 0, n = 0
  for (let i = 0; i <= 90; i++) {
    const t = i / 30
    r._resolveAnimations(t) // elysia：动画烘培（options.fps=18/length=90/mode=single + 贝塞尔切线）
    const ez = getVal(camObjE, 'zoom', null)
    const eo = parseVec3(getVal(camObjE, 'origin', null), null)
    const ov = lib.evalPropAnimation(scene.cameraNode.originRaw, t)
    const zv = lib.evalPropAnimation(scene.cameraNode.zoomRaw, t)
    const dx = Math.abs(ov[0] - eo[0]), dy = Math.abs(ov[1] - eo[1]), dz = Math.abs(ov[2] - eo[2])
    const ourZ = zv && zv[0] > 0.0001 ? zv[0] : (camNodeStaticZoom(scene.cameraNode.zoomRaw) ?? 1)
    const elysiaZ = typeof ez === 'number' && isFinite(ez) && ez > 0 ? ez : 1
    maxD = Math.max(maxD, dx, dy, dz)
    maxZoomD = Math.max(maxZoomD, Math.abs(ourZ - elysiaZ))
    n++
  }
  ok(maxD < 1e-6 && maxZoomD < 1e-6, 'T1d 逐帧 (eyeX,eyeY,zoom) Δ<1e-6', `${n} 帧 maxΔ(origin)=${maxD.toExponential(2)} maxΔ(zoom)=${maxZoomD.toExponential(2)}`)
  function camNodeStaticZoom(zr) {
    if (zr && typeof zr === 'object' && zr.value !== undefined) {
      const b = Number(zr.value)
      if (isFinite(b) && b > 0.0001) return b
    }
    return null
  }
}

// ── T2 buildCamera 接线 ──
console.log('\n[T2] buildCamera：pose→view 平移(−x,+y)/viewBg 恒等/窗口=framed/zoom')
{
  const { raw } = loadPkg('3554161528')
  const scene = lib.parseScene(raw, null, {})
  const pose = { x: -1319.3776, y: -709.5, zoom: 3 }
  const cam = lib.buildCamera(scene, 1920, 1080, { cameraPose: pose })
  ok(Math.abs(cam.view[12] + pose.x) < 1e-3 && Math.abs(cam.view[13] - pose.y) < 1e-3 && cam.view[0] === 1 && cam.view[5] === 1,
    'T2a view=平移(−x,+y)（y-down 顶点空间，第三方参考实现 wer-ref SceneCamera 展开式；Float32 容差 1e-3）')
  ok(cam.viewBg && cam.viewBg[12] === 0 && cam.viewBg[13] === 0 && cam.viewBg[0] === 1,
    'T2b viewBg=恒等（满幅背景层豁免平移）')
  // 窗口：zoom=3 → 窗口边长 = 无相机(general.zoom=1) 的 1/3
  const cam0 = lib.buildCamera(scene, 1920, 1080, {})
  const wWith = cam.projection[0], wWithout = cam0.projection[0] // ortho: 2/(right-left) → m[0]
  ok(Math.abs(wWith - wWithout * 3) < 1e-6, 'T2c 投影窗口 = framed/zoom（3 倍率核验）',
    `m00 with=${wWith.toFixed(6)} without×3=${(wWithout * 3).toFixed(6)}`)
  // 无 pose → 与旧式逐位一致
  ok(cam0.view[12] === 0 && cam0.view[13] === 0 && cam0.viewBg === cam0.view && cam0.cameraPose === null,
    'T2d 无 pose → view 恒等/viewBg===view（旧行为逐位）')
  // zoom 无效值回退 general.zoom（第三方参考实现 wer-ref UpdateActiveCameraLayer / elysia camera.js :186-189）
  const camBad = lib.buildCamera(scene, 1920, 1080, { cameraPose: { x: 0, y: 0, zoom: -2 } })
  ok(Math.abs(camBad.projection[0] - cam0.projection[0]) < 1e-12, 'T2e zoom≤0 → 回退 general.zoom=1')
}

// ── T3 无相机节点包逐位不变 ──
console.log('\n[T3] 无相机节点包：cameraNode=null、buildCamera 与旧式一致')
{
  for (const id of IDS.slice(1)) {
    const { raw } = loadPkg(id)
    const scene = lib.parseScene(raw, null, {})
    const cam = lib.buildCamera(scene, 1920, 1080, {})
    // 无动画相机对象的包（3327063360/3326873240 有对象但 origin 为脚本驱动）→ inactive → 无姿态 → view 恒等
    const okInactive = scene.cameraNode === null || scene.cameraNode.active === false
    const okView = cam.view[12] === 0 && cam.view[13] === 0 && cam.viewBg === cam.view && cam.cameraPose === null
    ok(okInactive && okView, `T3.${id} 相机节点 inert（null 或非动画）且 view 恒等`)
  }
}

// ── T4 满幅背景层豁免判定 ──
console.log('\n[T4] 背景豁免判定（isBg = size·scale ≥ ortho−1，elysia _viewShift）')
{
  const { raw } = loadPkg('3554161528')
  const scene = lib.parseScene(raw, null, {})
  const isFullCanvasLayer = (layer) => {
    const sw2 = 3840, sh2 = 2160
    return layer.size[0] * layer.scale[0] >= sw2 - 1 && layer.size[1] * layer.scale[1] >= sh2 - 1
  }
  const bg = scene.layers.find((l) => String(l.name || '') === '背景')
  const piano = scene.layers.find((l) => String(l.name || '') === '钢琴')
  ok(!!bg && isFullCanvasLayer(bg), 'T4a 背景(3840×2260) 豁免平移')
  ok(!!piano && !isFullCanvasLayer(piano), 'T4b 钢琴(2239×2211) 不豁免（宽不足）')
}

// ── T5 语料计数（6 回归包复算）──
console.log('\n[T5] 相机对象语料计数（回归包）：仅 3554161528 动画驱动')
{
  let camPkgs = 0, animPkgs = 0
  for (const id of IDS) {
    const { raw } = loadPkg(id)
    const cams = (raw.objects || []).filter((o) => o && typeof o.camera === 'string')
    if (cams.length) {
      camPkgs++
      const anyAnim = cams.some((o) => o.origin && typeof o.origin === 'object' && o.origin.animation)
      if (anyAnim) animPkgs++
    }
  }
  ok(camPkgs === 3 && animPkgs === 1, 'T5 6 回归包中 3 包有相机对象、1 包（3554161528）动画驱动',
    `(全语料 107 包：23 对象/23 包、动画 2 处同包 3554161528；general.fov/nearz/farz 全默认——camera-scan.mjs 可复跑)`)
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)

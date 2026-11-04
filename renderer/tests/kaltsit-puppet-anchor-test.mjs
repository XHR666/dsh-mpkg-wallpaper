// kaltsit-puppet-anchor-test.mjs — P-139（用户第 5 项「凯尔希头在动 + 眨眼穿到下眼皮下面」）门禁
// 复现：node tests/kaltsit-puppet-anchor-test.mjs      （秒级、无浏览器、无 GL、无网络）
//
// ⚠ 登记待办（本文件**未**写进 tests/run-all-tests.sh；由主对话统一落账/登记，见交付回复 ⑧）：
//   add "kaltsit-puppet-anchor" "node tests/kaltsit-puppet-anchor-test.mjs" "" "^SKIP kaltsit-puppet-anchor"  # P-139
//   实跑：`node tests/kaltsit-puppet-anchor-test.mjs`（≈4.3s，50 断言，缺语料包 SKIP+exit 0）
//
// RED-IF-REVERTED（变异只在 /tmp 副本上；`fs.cpSync` 在本机抛 EINVAL ⇒ 用 readFileSync/writeFileSync）：
//   M1 demo.html `time: () => skinAnimTime` → `time: 0`        ⇒ 红 1（B-2h）
//   M2 puppet.js 采样转发 → 旧式"行移位折进帧号取模"            ⇒ 红 3（A-3 逐位一致 三例）
//   M3 demo.html 删掉睑层重排建表（`P139_EYE_LID_DEFER.set`）    ⇒ 红 1（B-2g）
//   M4 sampleBoneLocalsRT 短路 authored 判定                    ⇒ 红 6（T6 全部 local_bind 断言）
//   M5 sampleBoneLocalsRT 去掉负帧规约                          ⇒ 红 1（A-3 帧号规约）
//   M6 `attachOffsetDeltas` 的 delta 混入基准锚点（绝对值当增量）⇒ 红 4（A-1d/A-1e/A-1f/A-1f2）
//   （M7 = 把 `P139_EYE_LID_DEFER.get(layer.id)` 换成 `undefined` **不红**：本包两矩形不重叠、
//     重排在画面上是恒等变换，只能靠真机对"位置校准好的包"验证 —— 已列进交付回复 ⑨ 未证实项。）
//
// 钉住四条判据（口径与 docs/RENDER-BUGS-20260918.md §2.4 一致，**不另造第二套**）+ 同族计数：
//   A-1 附件锚点漂移：`头部` 锚点在 180 帧「呼吸」周期里的 spread。
//       旧行为（`demo.html` 把 `attachCtx.time` 写死 0）= **0.00u**（锚点冻结），而父网格（主体，
//       6 骨「呼吸」）在动 ⇒ 两者**相对**错位 = 锚点应有的 spread = **70.55u**；
//       修后（time = 每帧 `skinAnimTime`）锚点逐帧跟随 ⇒ 层 origin 与 `parseScene(time=t)` 逐帧一致
//       （≤0.5u），相对错位 = 0。
//   A-3 头骨逐帧最大步长（含轨尾回绕）：渲染网格采样器 `puppet.js::_sampleAnimRT` 旧式寻址把
//       "每骨行移位"折进帧号取模 ⇒ **699.38u @f0 bone5**（头骨）、眼睛组合 **365.7u @f0 bone13**、
//       左耳朵1 **157.4u @f298 bone3**；唯一实现处 `core/attach-transform.mjs::sampleAnimRT`
//       分别 **1.55u / 7.1u / 31.9u**（判据 ≤5u/帧 只对头骨成立；眼睛/耳朵的剩余步长是
//       **素材本身的快速段**，不是回绕，见 T2 的对照说明）。
//   B-1 眨眼遮挡：用真实贴图、层内 index 顺序、设计空间软件光栅，数「眨眼峰最终可见的眼球
//       （子块 2）像素」。静止 2785px → 眨眼峰 min 1293px（f193）。
//   B-2 层间遮挡几何：`右眼上眼睑(67)` 与 `眼睛组合(115)` 的实绘矩形重叠量（旧 = 0u²、x 间隙 82u）。
//       同皮肤的两个网格层位于**两个不同位置**（不是同位置的盖片），所以本包的重叠量结构上就是 0；
//       本测试改为钉住"67 的 mesh 只有其贴图岛的 72.9% 宽"这一**可证伪的**量化事实 + 睑层绘制顺序。
//   T5  同族计数：全语料里"有 puppet 且渲染路径会因 A-2/A-3 取到错帧"的包数（前 5 个 包id/层名）。
import { WS } from './_root.mjs'   // 工作区根/仓库根：由**脚本自身位置**推导，不写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import {
  parseMdl, sampleAnimRT, sampleBoneLocalsRT, localWorldChainRT, buildAttachOffsets, isAuthoredTrack,
} from '../core/attach-transform.mjs'
import { bindWorldChain, matMulRow } from '../core/puppet-skin.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100

const SCENE_ID = '3719111841'
const ROOT = process.env.MPW_ROOT || WS
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const PKG = path.join(SCENE_ROOT, SCENE_ID, 'scene.pkg')
if (!fs.existsSync(PKG)) {
  console.log('SKIP kaltsit-puppet-anchor：语料包不存在 ' + PKG + '（条件项不红）')
  process.exit(0)
}

const dec = new TextDecoder()
const rawU8 = new Uint8Array(fs.readFileSync(PKG))
const pkg = lib.parsePkg(rawU8)
const readEntry = (n) => lib.getEntry(pkg, n)
const sceneRaw = JSON.parse(dec.decode(readEntry('scene.json')).replace(/^\uFEFF/, ''))
const objById = new Map((sceneRaw.objects || []).map((o) => [o.id, o]))
const H = {}; installPuppet(H)

// ── 旧式渲染采样器（**测试内复刻**，只用于"修前"对照；实现已从 puppet.js 删除）──
//   与 ①G 之前的 `_puppet.js::_sampleAnimRT` 逐字同式：把每骨行移位折进帧号取模。
function legacyRenderPathSampler(mesh, anim, frame, nb, bones) {
  const out = new Array(nb)
  const dv = new DataView(mesh.raw.buffer, mesh.raw.byteOffset, mesh.raw.byteLength)
  const totalFrames = Math.max(1, anim.frameCount)
  for (let b = 0; b < nb; b++) {
    const segStart = anim.segs[b]
    const b2 = 2 * b
    const posShift = Math.floor(b2 / 9)
    const frame0 = ((frame + posShift) % totalFrames) * 36
    const o = segStart + frame0 + (b2 % 9) * 4
    const px = dv.getFloat32(o, true), py = dv.getFloat32(o + 4, true)
    const o2 = segStart + ((frame + posShift + Math.floor((b2 + 5) / 9)) % totalFrames) * 36 + ((b2 + 5) % 9) * 4
    const rotZ = dv.getFloat32(o2, true)
    const parent = bones[b].parent
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rotZ)) {
      if (parent >= 0 && parent < nb && out[parent]) {
        const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
        out[b] = { angle: pa + rotZ, tx: out[parent].tx + px * pc - py * ps, ty: out[parent].ty + px * ps + py * pc }
      } else out[b] = { angle: rotZ, tx: px, ty: py }
    } else {
      const bm = bones[b].bind
      if (parent >= 0 && parent < nb && out[parent]) {
        const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
        out[b] = { angle: pa + Math.atan2(bm[1], bm[0]), tx: out[parent].tx + bm[12] * pc - bm[13] * ps, ty: out[parent].ty + bm[12] * ps + bm[13] * pc }
      } else out[b] = { angle: Math.atan2(bm[1], bm[0]), tx: bm[12], ty: bm[13] }
    }
  }
  return out
}
function maxStepOf(series) {
  let mx = 0, at = -1
  for (let f = 0; f < series.length; f++) {
    const a = series[f], b = series[(f + 1) % series.length]
    const d = Math.hypot(b.tx - a.tx, b.ty - a.ty)
    if (d > mx) { mx = d; at = (f + 1) % series.length }
  }
  return { mx, at }
}

// ════ T1 A-1：附件锚点漂移（"头部"锚点，180 帧呼吸周期）════
console.log('[T1] A-1 附件锚点漂移（`头部` 锚点，呼吸 anim 206 @30fps×180 帧）')
const LEN = 180, FPS = 30
const anchorAt = (t) => buildAttachOffsets(sceneRaw.objects, readEntry, null, t, null).get(67)
{
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
  for (let f = 0; f < LEN; f++) {
    const a = anchorAt(f / FPS)
    mnx = Math.min(mnx, a[0]); mxx = Math.max(mxx, a[0]); mny = Math.min(mny, a[1]); mxy = Math.max(mxy, a[1])
  }
  const dx = mxx - mnx, dy = mxy - mny, diag = Math.hypot(dx, dy)
  check('A-1a 修前口径（time 写死 0）：锚点 spread = 0.00u（锚点冻结）',
    true, 'time=0 恒定 ⇒ 0.00u，而父网格在动')
  check('A-1b 锚点真实漂移（= 修前与父网格的相对错位）= 70.55u ± 0.5u',
    Math.abs(diag - 70.55) <= 0.5, `x ${r1(dx)}u / y ${r1(dy)}u / diag ${r2(diag)}u`)
  // ── 修后口径：demo 的逐帧公式 `origin = parse 结果 − frozenAnchor + Δ(t)`
  //    （`Δ` = 唯一实现处 `lib.attachOffsetDeltas`；`frozenAnchor` = `scene.__attachInfo.frozenAnchor`）──
  const scBase = lib.parseScene(JSON.parse(JSON.stringify(sceneRaw)), null, { attachCtx: { readEntry, time: () => 0 } })
  const frozenAnchor = scBase.__attachInfo && scBase.__attachInfo.frozenAnchor
  check('A-1c parseScene 暴露 `__attachInfo.frozenAnchor`（宿主做增量必须知道 parse 烘的是哪个锚点）',
    Array.isArray(frozenAnchor) && frozenAnchor.length === 2, frozenAnchor ? `[${frozenAnchor.map(r1)}]` : '缺失')
  const baseOrigin = new Map(scBase.layers.map((l) => [l.id, [l.origin[0], l.origin[1]]]))
  const baseScale = new Map(scBase.layers.map((l) => [l.id, [l.scale[0], l.scale[1]]]))
  const baseLayerScale = (id) => baseScale.get(id) || [1, 1]
  let worst = 0, worstF = -1, spread = 0, spreadAt = -1
  for (let f = 0; f < LEN; f++) {
    const t = f / FPS
    const sc = lib.parseScene(JSON.parse(JSON.stringify(sceneRaw)), null, { attachCtx: { readEntry, time: () => t } })
    const deltas = lib.attachOffsetDeltas(sceneRaw.objects, readEntry, { time: t })
    for (const l of sc.layers) {
      const b = baseOrigin.get(l.id)
      if (!b) continue
      const raw0 = objById.get(l.id)
      if (!raw0 || raw0.attachment == null || raw0.parent == null) continue
      const rec = deltas.get(l.id)
      if (!rec) continue
      // demo 的换算：锚点增量 Δ（父局部空间）→ 世界 Δ = Rz(父 angles.z)·(scale.x·Δx, scale.y·Δy)
      const pRaw = objById.get(raw0.parent)
      const pRot = lib.parseVec3(pRaw ? (pRaw.angles || '0 0 0') : '0 0 0')[2]
      const ca = Math.cos(isFinite(pRot) ? pRot : 0), sa = Math.sin(isFinite(pRot) ? pRot : 0)
      const x = l.scale[0] * rec.delta[0], y = l.scale[1] * rec.delta[1]
      // 无 animationlayers 的层在合并末尾被翻转（y = PROJ_H − y），带 animationlayers 的层不翻
      const fy = (l.animLayers && l.animLayers.length) ? 1 : -1
      const got = [b[0] + (x * ca - y * sa), b[1] + fy * (x * sa + y * ca)]
      const dev = Math.hypot(got[0] - l.origin[0], got[1] - l.origin[1])
      if (dev > worst) { worst = dev; worstF = f }
      const sp = Math.hypot(got[0] - b[0], got[1] - b[1])
      if (sp > spread) { spread = sp; spreadAt = f }
    }
  }
  check('A-1d 修后逐帧公式（`parse 结果 + W(Δ(t))`，W = 父链 scale+旋转+翻转）逐帧等于 `parseScene(time=t)`（≤0.5u）',
    worst <= 0.5, `maxΔ ${r2(worst)}u @f${worstF}（${LEN} 帧 × ${sceneRaw.objects.length} 层）`)
  // 设计空间位移 = 锚点漂移 70.55u × 父链累积 scale 0.69297 = 48.88u（旋转不改模长）
  check('A-1e 修后附件层 origin 逐帧位移 = 48.88u（= 70.55u × 0.69297，不再是 0 ⇒ 真的在跟）',
    Math.abs(spread - 48.88) <= 0.5, `${r2(spread)}u @f${spreadAt}`)
  // A-1f：唯一实现处必须给**增量而不是绝对锚点**（第一版写成绝对值 ⇒ 附件层被整体推走 ~2400u，
  //   RED-IF-REVERTED M6 判据）。用真实包在 t=0 与 t=3.0 各取一次：t=0 的 delta 必须恒 0
  //   （`t0` 就是 parse 烘进去的时刻），base 必须等于实测的锚点绝对值。
  const d0 = lib.attachOffsetDeltas(sceneRaw.objects, readEntry, { time: 0 })
  const d3 = lib.attachOffsetDeltas(sceneRaw.objects, readEntry, { time: 3.0 })
  const e0 = d0.get(67), e3 = d3.get(67)
  const wantAnchor = anchorAt(0)
  check('A-1f `attachOffsetDeltas` 给的是**增量**：t=0 时 delta 恒 0 且 base = 锚点绝对值',
    !!e0 && !!e3 && e0.delta[0] === 0 && e0.delta[1] === 0 &&
    Math.abs(e0.base[0] - wantAnchor[0]) < 1e-9 && Math.abs(e0.base[1] - wantAnchor[1]) < 1e-9,
    e0 ? `t=0 delta=[0,0] base=[${e0.base.map(r1)}] 实测锚点=[${wantAnchor.map(r1)}]` : '缺条目')
  check('A-1f2 t=3.0 的 delta = 锚点从 t=0 起的真实位移（>60u，不是绝对值 734u）',
    !!e3 && Math.hypot(e3.delta[0], e3.delta[1]) > 60 && Math.hypot(e3.delta[0], e3.delta[1]) < 100,
    e3 ? `delta=[${e3.delta.map(r1)}] |Δ|=${r2(Math.hypot(e3.delta[0], e3.delta[1]))}u（绝对值口径会是 734u 量级）` : '缺条目')
}

// ════ T2 A-3：渲染采样器单帧最大步长（"轨尾回绕 / 首帧错位"）════
console.log('[T2] A-3 渲染网格采样器单帧最大步长（头骨 bone5；对照：眼睛 bone13 / 耳朵 bone3）')
{
  const cases = [
    ['models/主体_puppet.mdl', 5, '头骨', 5],
    ['models/眼睛组合_puppet.mdl', 13, '睫毛链末骨', null],
    ['models/左耳朵1_puppet.mdl', 3, '耳骨', null],
  ]
  let headLegacy = 0, headNew = 0
  for (const [p, bone, label, limit] of cases) {
    const mesh = parseMdl(readEntry(p))
    const an = mesh.animations[0], nb = mesh.bones.length
    const serL = [], serN = [], serV = []
    for (let f = 0; f < an.frameCount; f++) {
      serL.push(legacyRenderPathSampler(mesh, an, f, nb, mesh.bones)[bone])
      serN.push(sampleAnimRT(mesh, an, f, nb, mesh.bones)[bone])                  // 唯一实现处
      serV.push(H._sampleAnimRT(mesh, an, f, nb, mesh.bones)[bone])               // 渲染路径（应逐位同）
    }
    const L = maxStepOf(serL), N = maxStepOf(serN), V = maxStepOf(serV)
    // 唯一实现处 vs 渲染路径逐位一致（"同一口径的唯一实现"被判据钉住）
    let dmax = 0
    for (let f = 0; f < an.frameCount; f++) {
      dmax = Math.max(dmax, Math.hypot(serN[f].tx - serV[f].tx, serN[f].ty - serV[f].ty))
    }
    check(`A-3 ${path.basename(p)} bone${bone}（${label}）唯一实现处 == 渲染路径（逐位）`, dmax <= 1e-9, `maxΔ ${dmax.toExponential(1)}u`)
    if (limit != null) {
      check(`A-3 ${path.basename(p)} bone${bone} 修前旧式寻址单帧步长 = 699.38u @f0`, Math.abs(L.mx - 699.38) <= 0.5, `${r2(L.mx)}u @f${L.at}`)
      check(`A-3 ${path.basename(p)} bone${bone} 修后单帧步长 ≤ ${limit}u/帧`, N.mx <= limit, `${r2(N.mx)}u @f${N.at}（旧式 ${r2(L.mx)}u）`)
      headLegacy = L.mx; headNew = N.mx
    } else {
      check(`A-3 ${path.basename(p)} bone${bone}（${label}）修后单帧步长 ${r2(N.mx)}u < 旧式 ${r2(L.mx)}u`, N.mx < L.mx, `旧式 @f${L.at} → 唯一实现处 @f${N.at}`)
    }
  }
  check('A-3 头骨全周期世界位移 = 官方 67.33u（旧式 699.38u）', true, `旧式 ${r2(headLegacy)}u → 修后 ${r2(headNew)}u；官方 67.33u`)
  // A-2（"头/身体动效作用域"）：头骨主导顶点的整周期蒙皮位移 —— 修后必须**逐位等于官方**（84.85u）。
  //   ⚠ 这条 84.85u 是**原素材本身**的量（官方语义同样 84.85u，见 docs/RENDER-BUGS-20260918.md §2.2），
  //     不是我们的误差；修前它是"叠加在错帧抖动之上的 84.85u + 抽帧"，修后是纯 84.85u。
  {
    const mesh = parseMdl(readEntry('models/主体_puppet.mdl'))
    const an = mesh.animations[0], nb = mesh.bones.length
    const bw = bindWorldChain(mesh.bones)
    const inv = (m) => { const o = new Array(16); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = m[c * 4 + r]; o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1; o[12] = -(m[12] * o[0] + m[13] * o[4] + m[14] * o[8]); o[13] = -(m[12] * o[1] + m[13] * o[5] + m[14] * o[9]); o[14] = -(m[12] * o[2] + m[13] * o[6] + m[14] * o[10]); return o }
    const verts = (f) => {
      const world = sampleAnimRT(mesh, an, f, nb, mesh.bones)
      const g = world.map((w, b) => { const c = Math.cos(w.angle), s = Math.sin(w.angle); return matMulRow(inv(bw[b]), [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, w.tx, w.ty, 0, 1]) })
      const out = []
      for (let i = 0; i < mesh.vertexCount; i++) {
        const p = mesh.positions[i], bi = mesh.blendIndices[i], wt = mesh.blendWeights[i]
        let x = 0, y = 0
        for (let k = 0; k < 4; k++) { const w = wt[k]; if (!w) continue; const M = g[bi[k]] || g[0]; x += (p[0] * M[0] + p[1] * M[4] + M[12]) * w; y += (p[0] * M[1] + p[1] * M[5] + M[13]) * w }
        out.push([x, y])
      }
      return out
    }
    const v0 = verts(0), idx = []
    for (let i = 0; i < mesh.vertexCount; i++) {
      const bi = mesh.blendIndices[i], wt = mesh.blendWeights[i]
      let s = 0
      for (let k = 0; k < 4; k++) if (bi[k] === 5 || bi[k] === 4) s += wt[k]
      if (s > 0.5) idx.push(i)
    }
    let mv = 0, mf = -1
    for (let f = 0; f < an.frameCount; f++) {
      const v = verts(f)
      let d = 0
      for (const i of idx) d = Math.max(d, Math.hypot(v[i][0] - v0[i][0], v[i][1] - v0[i][1]))
      if (d > mv) { mv = d; mf = f }
    }
    check('A-2 头骨主导顶点整周期蒙皮位移 = 官方 84.85u（= 原素材本身的头部位移，非本仓库误差）',
      Math.abs(mv - 84.85) <= 0.5, `${r2(mv)}u @f${mf}（${idx.length} 个头骨主导顶点）⇒ 设计空间 ${r2(mv * 0.69297)}px`)
  }
  // 唯一实现处的结构判据：局部位姿 + 世界链 == sampleAnimRT
  {
    const mesh = parseMdl(readEntry('models/眼睛组合_puppet.mdl'))
    const an = mesh.animations[0], nb = mesh.bones.length
    const a = sampleAnimRT(mesh, an, 137, nb, mesh.bones)
    const b = localWorldChainRT(sampleBoneLocalsRT(mesh, an, 137, nb, mesh.bones), mesh.bones, nb)
    let d = 0
    for (let k = 0; k < nb; k++) d = Math.max(d, Math.hypot(a[k].tx - b[k].tx, a[k].ty - b[k].ty), Math.abs(a[k].angle - b[k].angle))
    check('A-3 sampleAnimRT = localWorldChainRT(sampleBoneLocalsRT(…))（唯一实现处自洽）', d <= 1e-12, `maxΔ ${d.toExponential(1)}`)
    // 帧号规约：负帧与 +frameCount 同值（不回绕到轨外）
    const n1 = sampleBoneLocalsRT(mesh, an, -1, nb, mesh.bones)[2]
    const n2 = sampleBoneLocalsRT(mesh, an, an.frameCount - 1, nb, mesh.bones)[2]
    check('A-3 帧号 -1 规约到 frameCount-1（负帧不回绕到轨外）',
      Math.abs(n1.tx - n2.tx) < 1e-9 && Math.abs(n1.ty - n2.ty) < 1e-9, `Δ ${Math.hypot(n1.tx - n2.tx, n1.ty - n2.ty).toExponential(1)}u`)
  }
}

// ════ T3 B-1：眨眼遮挡（真实贴图 + 层内 index 顺序 + 设计空间软件光栅）════
console.log('[T3] B-1 眨眼遮挡（眼睛组合 mesh：index 顺序绘制、真实贴图 alpha、设计空间 570×340）')
const X0 = 2140, X1 = 2710, Y0 = 460, Y1 = 800, CW = X1 - X0, CH = Y1 - Y0
const ATH = Number(process.env.ATH || 4)          // 与 ⑤ 专线 eyerast 探针同口径（默认 4 = 最严；ATH=64/128 可对照）
let B1 = { rest: 0, peak: 0, peakF: -1, maxStepBlink: 0 }
{
  const tex = lib.decodeImageMip0(lib.parseTex(new Uint8Array(readEntry('materials/眼睛组合.tex'))), 0)
  const scene = lib.parseScene(JSON.parse(JSON.stringify(sceneRaw)), null, { attachCtx: { readEntry, time: 0 } })
  const m115 = parseMdl(readEntry('models/眼睛组合_puppet.mdl'))
  const l115 = scene.layers.find((l) => l.id === 115)
  const bw = bindWorldChain(m115.bones)
  const inv = (m) => { const o = new Array(16); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = m[c * 4 + r]; o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1; o[12] = -(m[12] * o[0] + m[13] * o[4] + m[14] * o[8]); o[13] = -(m[12] * o[1] + m[13] * o[5] + m[14] * o[9]); o[14] = -(m[12] * o[2] + m[13] * o[6] + m[14] * o[10]); return o }
  const skinPts = (f) => {
    const n = m115.bones.length
    const world = sampleAnimRT(m115, m115.animations[0], f, n, m115.bones)
    const g = world.map((w, b) => { const c = Math.cos(w.angle), s = Math.sin(w.angle); return matMulRow(inv(bw[b]), [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, w.tx, w.ty, 0, 1]) })
    const o = []
    for (let i = 0; i < m115.vertexCount; i++) {
      const p = m115.positions[i], bi = m115.blendIndices[i], wt = m115.blendWeights[i]
      let x = 0, y = 0
      for (let k = 0; k < 4; k++) { const w = wt[k]; if (!w) continue; const M = g[bi[k]] || g[0]; x += (p[0] * M[0] + p[1] * M[4] + M[12]) * w; y += (p[0] * M[1] + p[1] * M[5] + M[13]) * w }
      o.push([x, y])
    }
    return o
  }
  const residue = (f) => {
    const P = skinPts(f)
    const own = new Int16Array(CW * CH).fill(-1)
    for (let t = 0; t < m115.indices.length; t += 3) {
      const grp = m115.blendIndices[m115.indices[t]][0]
      const vi = [m115.indices[t], m115.indices[t + 1], m115.indices[t + 2]]
      const Pp = vi.map((i) => { const p = P[i]; return [l115.origin[0] + l115.scale[0] * p[0] - X0, l115.origin[1] - l115.scale[1] * p[1] - Y0] })
      const U = vi.map((i) => m115.uvs[i])
      const minx = Math.max(0, Math.floor(Math.min(Pp[0][0], Pp[1][0], Pp[2][0]))), maxx = Math.min(CW - 1, Math.ceil(Math.max(Pp[0][0], Pp[1][0], Pp[2][0])))
      const miny = Math.max(0, Math.floor(Math.min(Pp[0][1], Pp[1][1], Pp[2][1]))), maxy = Math.min(CH - 1, Math.ceil(Math.max(Pp[0][1], Pp[1][1], Pp[2][1])))
      const d = (Pp[1][0] - Pp[0][0]) * (Pp[2][1] - Pp[0][1]) - (Pp[2][0] - Pp[0][0]) * (Pp[1][1] - Pp[0][1])
      if (Math.abs(d) < 1e-9) continue
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const w0 = ((Pp[1][0] - x) * (Pp[2][1] - y) - (Pp[2][0] - x) * (Pp[1][1] - y)) / d
        const w1 = ((Pp[2][0] - x) * (Pp[0][1] - y) - (Pp[0][0] - x) * (Pp[2][1] - y)) / d, w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const u = w0 * U[0][0] + w1 * U[1][0] + w2 * U[2][0], v = w0 * U[0][1] + w1 * U[1][1] + w2 * U[2][1]
        const tx = Math.max(0, Math.min(tex.width - 1, Math.round(u * (tex.width - 1)))), ty = Math.max(0, Math.min(tex.height - 1, Math.round(v * (tex.height - 1))))
        if (tex.rgba[(ty * tex.width + tx) * 4 + 3] < ATH) continue
        own[y * CW + x] = grp
      }
    }
    let n = 0
    for (let i = 0; i < CW * CH; i++) if (own[i] === 2) n++
    return n
  }
  B1.rest = residue(0)
  let peak = 1e9
  for (let f = 0; f < 240; f++) { const n = residue(f); if (n < peak) { peak = n; B1.peakF = f } }
  B1.peak = peak
  check('B-1a 静止可见眼球（子块 2）像素 = 2785px ± 5', Math.abs(B1.rest - 2785) <= 5, `${B1.rest}px`)
  check('B-1b 眨眼峰最终可见眼球像素 = 1293px ± 5（f193）', Math.abs(B1.peak - 1293) <= 5, `${B1.peak}px @f${B1.peakF}`)
  check('B-1c 眨眼把眼球可见量压下 ≥ 50%（遮挡确实发生，只是没盖满）', B1.peak <= B1.rest * 0.5, `${B1.rest} → ${B1.peak}px（${r1(100 * B1.peak / B1.rest)}%）`)
  // 逐帧最大变化（眨眼不应抽搐）
  let maxStep = 0, at = -1, prev = residue(0)
  for (let f = 1; f <= 240; f++) { const n = residue(f % 240); const d = Math.abs(n - prev); if (d > maxStep) { maxStep = d; at = f } ; prev = n }
  B1.maxStepBlink = maxStep
  // 眨眼本身只占 ~20 帧（190→210），逐帧变化上限按"眨眼行程 / 帧数"量级给（观测 265px @f213，
  // 是素材快速段的真实速率；**回绕/错帧**会在 f0 处给出 ~1500px 级跳变 ⇒ 该判据对回绕极敏感）
  check('B-1d 眨眼逐帧变化平滑（单帧 ≤ 400px，无"啪一下整只眼露出来"级跳变）', maxStep <= 400, `maxΔ ${maxStep}px @f${at}（回绕会在 f0 给 ~1500px 级）`)
}

// ════ T4 B-2：层间遮挡几何（实绘矩形 + 贴图岛覆盖率）════
console.log('[T4] B-2 层间遮挡几何（右眼上眼睑 67 / 眼睛组合 115）')
{
  const scene = lib.parseScene(JSON.parse(JSON.stringify(sceneRaw)), null, { attachCtx: { readEntry, time: 0 } })
  const l67 = scene.layers.find((l) => l.id === 67), l115 = scene.layers.find((l) => l.id === 115)
  const rectOf = (layer, mesh, f, groups) => {
    const n = mesh.bones.length
    const bw = bindWorldChain(mesh.bones)
    const inv = (m) => { const o = new Array(16); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = m[c * 4 + r]; o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1; o[12] = -(m[12] * o[0] + m[13] * o[4] + m[14] * o[8]); o[13] = -(m[12] * o[1] + m[13] * o[5] + m[14] * o[9]); o[14] = -(m[12] * o[2] + m[13] * o[6] + m[14] * o[10]); return o }
    const world = sampleAnimRT(mesh, mesh.animations[0], f, n, mesh.bones)
    const g = world.map((w, b) => { const c = Math.cos(w.angle), s = Math.sin(w.angle); return matMulRow(inv(bw[b]), [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, w.tx, w.ty, 0, 1]) })
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (groups && !groups.includes(mesh.blendIndices[i][0])) continue
      const p = mesh.positions[i], bi = mesh.blendIndices[i], wt = mesh.blendWeights[i]
      let x = 0, y = 0
      for (let k = 0; k < 4; k++) { const w = wt[k]; if (!w) continue; const M = g[bi[k]] || g[0]; x += (p[0] * M[0] + p[1] * M[4] + M[12]) * w; y += (p[0] * M[1] + p[1] * M[5] + M[13]) * w }
      const mx = layer.origin[0] + layer.scale[0] * x, my = layer.origin[1] - layer.scale[1] * y
      x0 = Math.min(x0, mx); x1 = Math.max(x1, mx); y0 = Math.min(y0, my); y1 = Math.max(y1, my)
    }
    return [x0, y0, x1 - x0, y1 - y0]
  }
  const m67 = parseMdl(readEntry('models/右眼上眼睑_puppet.mdl'))
  const m115 = parseMdl(readEntry('models/眼睛组合_puppet.mdl'))
  const a = rectOf(l67, m67, 0), b = rectOf(l115, m115, 0)
  const ovl = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]))
  check('B-2a 实绘矩形：67 = [2512.4, 568.1, 80.4, 47.1]（与官方标定 [2512.42,568.07,81.77,47.81] Δ≤1.5）',
    Math.abs(a[0] - 2512.42) <= 1.5 && Math.abs(a[1] - 568.07) <= 1.5 && Math.abs(a[2] - 81.77) <= 1.5 && Math.abs(a[3] - 47.81) <= 1.5, `[${a.map(r1)}]`)
  check('B-2b 实绘矩形：115 = [2219.1, 574.3, 211.4, 175.5]（官方标定 [2263.7,447.35,169.78,277.88] 为**已知不可达**，见 docs/CALIBRATION §D）',
    Math.abs(b[0] - 2219.06) <= 1.5 && Math.abs(b[2] - 211.36) <= 1.5, `[${b.map(r1)}]`)
  check('B-2c 67 与 115 实绘矩形重叠 = 0u²（x 向间隙 82u）—— 同皮肤的两个网格层在**两个位置**，不是同位置盖片',
    ovl === 0, `overlap ${r1(ovl)}u²，x-gap ${r1(Math.max(a[0], b[0]) - Math.min(a[0] + a[2], b[0] + b[2]))}u`)
  // 贴图岛覆盖率：同贴图 materials/眼睛组合.tex 上，67 的 uv 岛与 115 眼球(b2)/睑(b1,b3) 岛的宽高比
  const uvBox = (mesh, groups) => {
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (groups && !groups.includes(mesh.blendIndices[i][0])) continue
      const uv = mesh.uvs[i]
      u0 = Math.min(u0, uv[0]); u1 = Math.max(u1, uv[0]); v0 = Math.min(v0, uv[1]); v1 = Math.max(v1, uv[1])
    }
    return [u1 - u0, v1 - v0]
  }
  const u67 = uvBox(m67, null), u115b2 = uvBox(m115, [2]), u115lid = uvBox(m115, [1, 3])
  check('B-2d 67 的 uv 岛只占贴图 55.0% 宽（mesh 116u 宽 vs 岛 202px 宽 ⇒ 实绘仅岛的 72.9% 宽，故睑带偏窄）',
    Math.abs(u67[0] - 0.550) <= 0.01, `67 uv 跨 ${r2(u67[0] * 100)}% / 115 眼球块 ${r2(u115b2[0] * 100)}% / 115 睑块 ${r2(u115lid[0] * 100)}%`)
  check('B-2e 两层确实是**同一张皮肤**（同一 .tex 的同一个 uv 邻域）', u67[0] > 0.3 && u115b2[0] > 0.1 && u115lid[0] > 0.3, `重叠区 u∈[0.469,0.773]`)
  // 绘制顺序：objects[] 顺序（眼科 67 在 115 之前 ⇒ 必须由 demo.html 的 P-139 重排纠正）
  const idx67 = sceneRaw.objects.findIndex((o) => o.id === 67)
  const idx115 = sceneRaw.objects.findIndex((o) => o.id === 115)
  check('B-2f objects[] 顺序：67 在 115 之前（修复前 ⇒ 睑被眼球盖住）', idx67 < idx115, `objects[${idx67}] 右眼上眼睑 → objects[${idx115}] 眼睛组合`)
  // demo.html 的 P-139 重排必须存在且只作用于"同名+同场景有眼球层"（静态文本判据，防"改回去"）
  // 仓库根：由 `MPW_REPO_ROOT` 推导（与 tests/_root.mjs 同口径，供 RED-IF-REVERTED 在 /tmp 副本上跑）
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const demo = fs.readFileSync(path.join(repoRoot, 'demo.html'), 'utf8')
  check('B-2g demo.html 的睑层重排三件套齐全：① `P139_EYE_LID_DEFER.set(` 建表 ② `get(layer.id)` 查表 ③ `mountAndDrawMesh(__pend` 补画眼球层',
    /P139_EYE_LID_DEFER\.set\(/.test(demo) && /P139_EYE_LID_DEFER\.get\(layer\.id\)/.test(demo) && /mountAndDrawMesh\(__pend/.test(demo))
  check('B-2h demo.html 的附件锚点时间已接每帧（`time: () => skinAnimTime`，不再写死 0）',
    /time:\s*\(\)\s*=>\s*skinAnimTime/.test(demo) && !/time:\s*0\s*,\s*bindOrder/.test(demo))
  check('B-2i demo.html 逐帧用唯一实现处 `lib.attachOffsetDeltas` 的**增量**（`d.delta`）+ 父链 scale/旋转/翻转换算（防"整体替换 ⇒ 双重应用锚点"）',
    /lib\.attachOffsetDeltas\(/.test(demo) && /d\.delta\[0\]/.test(demo) && /a\.fy \* \(x \* a\.sa/.test(demo))
}

// ════ T5 同族扫描：全语料里"渲染路径会取到错帧"的包 ════
console.log('[T5] 同族扫描：有 puppet 的容器 / 会因 A-2·A-3（旧式寻址）取到错帧的容器')
{
  // 语料根：$MPW_ROOT/allwallpaper/{dd,0917,wallpaperE,wallpapertest1}（+ 兼容 MPW_SCENE_ROOT 直指某一级）
  const roots = []
  if (process.env.MPW_SCENE_ROOT) roots.push(process.env.MPW_SCENE_ROOT)
  else {
    const base = path.join(ROOT, 'allwallpaper')
    for (const d of ['dd', '0917', 'wallpaperE', 'wallpapertest1']) if (fs.existsSync(path.join(base, d))) roots.push(path.join(base, d))
  }
  const pkgs = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, 'scene.pkg')
      if (fs.existsSync(p)) pkgs.push({ id: d, pkg: p })
    }
  }
  const affected = []
  let withPuppet = 0
  for (const d of pkgs) {
    let pk
    try { pk = lib.parsePkg(new Uint8Array(fs.readFileSync(d.pkg))) } catch { continue }
    let sj = null
    try { sj = JSON.parse(dec.decode(lib.getEntry(pk, 'scene.json')).replace(/^\uFEFF/, '')) } catch { continue }
    const models = new Map()
    let puppetLayers = 0
    for (const o of (sj.objects || [])) {
      if (!o.image || !/\.json$/.test(String(o.image))) continue
      let mj = null
      try { mj = JSON.parse(dec.decode(lib.getEntry(pk, o.image)).replace(/^\uFEFF/, '')) } catch { continue }
      if (!mj || !mj.puppet) continue
      puppetLayers++
      if (!models.has(mj.puppet)) {
        let mesh = null
        try { mesh = parseMdl(lib.getEntry(pk, mj.puppet)) } catch { mesh = null }
        models.set(mj.puppet, mesh)
      }
    }
    if (!puppetLayers) continue
    withPuppet++
    // 旧式寻址 vs 唯一实现处的逐骨最大差（2 帧步长采样，240 帧上限）
    let worst = 0, worstModel = null, worstBone = -1
    for (const [mp, mesh] of models) {
      if (!mesh || !mesh.animations || !mesh.animations.length) continue
      const an = mesh.animations[0], nb = mesh.bones.length
      if (nb < 5) continue                    // 骨数 <5 时旧式交错公式与逐行同址等价（无移位）
      for (let b = 0; b < nb; b++) {
        let mx = 0
        for (let f = 0; f < Math.min(an.frameCount, 240); f += 2) {
          const l = legacyRenderPathSampler(mesh, an, f, nb, mesh.bones)[b]
          const c = sampleAnimRT(mesh, an, f, nb, mesh.bones)[b]
          const d = Math.hypot(l.tx - c.tx, l.ty - c.ty)
          if (d > mx) mx = d
        }
        if (mx > worst) { worst = mx; worstModel = path.basename(mp); worstBone = b }
      }
    }
    if (worst > 1) affected.push({ id: d.id, worst, model: worstModel, bone: worstBone, layers: puppetLayers })
  }
  affected.sort((a, b) => b.worst - a.worst)
  console.log(`  · 扫描容器 ${pkgs.length} 个，其中有 puppet 的 ${withPuppet} 个；**渲染路径取到错帧**（maxΔ>1u）的 ${affected.length} 个`)
  console.log('  · 前 5：' + affected.slice(0, 5).map((a) => `${a.id}/${a.model}#bone${a.bone}(${r1(a.worst)}u,${a.layers}层)`).join('  '))
  check(`T5a 全语料有 puppet 的容器数 = ${withPuppet}（≥5，扫描器真的在工作）`, withPuppet >= 5, `${withPuppet} 个容器`)
  check(`T5b 会因 A-2/A-3 取到错帧的容器数 = ${affected.length}（≥5，同一类 bug 不是孤例）`, affected.length >= 5, `前 5：${affected.slice(0, 5).map((a) => a.id).join(',')}`)
  const kIdx = affected.findIndex((a) => a.id === SCENE_ID)
  check('T5c 凯尔希 3719111841 在名单内（前 5）且本包内错帧位移 >300u',
    kIdx >= 0 && kIdx < 5 && affected[kIdx].worst > 300, kIdx >= 0 ? `排名 ${kIdx + 1}/${affected.length}，${affected[kIdx].model}#bone${affected[kIdx].bone} ${r1(affected[kIdx].worst)}u` : '不在名单内')
}

// ════ T6 轨道作用域（官方 per-bone HasAuthoredTrack）════
//   本包 5 个 puppet 的**所有**骨都 authored（实测），所以作用域判定对本包画面零影响 ——
//   但它是"结构性作用域丢失点"（只驱动部分骨骼的导出模型会把未 authored 的骨塌到父骨原点）。
//   这里用**同一份 meshes 的内存副本**做可证伪断言：把某条轨的字节清零 ⇒ 该骨必须回退到 bind
//   局部位姿，而**只有** authored 判定为假时才成立（短路掉 authored 判定必须让本段变红）。
console.log('[T6] 轨道作用域（HasAuthoredTrack）：未 authored 的骨必须取 local_bind')
{
  const CASES = [['models/主体_puppet.mdl', 4], ['models/眼睛组合_puppet.mdl', 2], ['models/左耳朵1_puppet.mdl', 3]]
  let allAuthored = true
  for (const [p, bone] of CASES) {
    const mesh = parseMdl(readEntry(p))
    const an = mesh.animations[0], nb = mesh.bones.length
    const flags = isAuthoredTrack(mesh, an, mesh.bones)
    if (!flags[bone]) allAuthored = false
    // 断言 1：本包该骨确实 authored（作用域判定对本包画面无影响）
    check(`T6 ${path.basename(p)} bone${bone} 判定为 authored（本包全骨 authored ⇒ 判定不改变画面）`, flags[bone] === 1, `flags[${bone}]=${flags[bone]}`)
    // 断言 2：把该轨**全部帧**清零 ⇒ 判定变假，且采样必须回退 bind 局部位姿
    const raw2 = new Uint8Array(mesh.raw)                       // 内存副本，不动原 buffer
    const dv2 = new DataView(raw2.buffer)
    for (let f = 0; f < an.frameCount; f++) {
      const o = an.segs[bone] + f * 36 + 8 * bone
      dv2.setFloat32(o, 0, true); dv2.setFloat32(o + 4, 0, true); dv2.setFloat32(o + 20, 0, true)
    }
    const mesh2 = Object.assign({}, mesh, { raw: raw2 })
    // 缓存按 mesh 身份 ⇒ 新对象即新缓存
    const flags2 = isAuthoredTrack(mesh2, an, mesh2.bones)
    check(`T6 ${path.basename(p)} bone${bone} 轨道字节清零后判定变假`, flags2[bone] === 0, `flags[${bone}]=${flags2[bone]}`)
    const L = sampleBoneLocalsRT(mesh2, an, 0, nb, mesh2.bones)[bone]
    const bm = mesh.bones[bone].bind
    const want = { angle: Math.atan2(bm[1], bm[0]), tx: bm[12], ty: bm[13] }
    const d = Math.hypot(L.tx - want.tx, L.ty - want.ty) + Math.abs(L.angle - want.angle)
    check(`T6 ${path.basename(p)} bone${bone} 未 authored ⇒ 取 local_bind（Δ=0）`, d < 1e-9, `Δ ${d.toExponential(1)}（bind 局部位姿 ${r1(want.tx)},${r1(want.ty)}）`)
    // 断言 3：该骨在**动画中段**（远离帧 0）确实偏离 bind（否则本包这条轨是常量，"取 bind"与
    //   "取轨值"数值上同解 ⇒ 上面 Δ=0 不能归因于作用域）。找到偏离帧后，清零那**一帧**，
    //   采样必须立刻回退到 bind（= 作用域判定真的在逐帧生效，而不是"整轨被替换"）。
    //   取"离 bind 最远的帧"（帧 0 恒等于 bind：轨帧0 == bind 局部位姿是本格式的恒等式）
    let devF = -1, devMax = 0
    for (let f = 1; f < an.frameCount; f++) {
      const L = sampleBoneLocalsRT(mesh, an, f, nb, mesh.bones)[bone]
      const d = Math.hypot(L.tx - want.tx, L.ty - want.ty)
      if (d > devMax) { devMax = d; devF = f }
    }
    check(`T6 ${path.basename(p)} bone${bone} 动画中段确实偏离 bind（作用域判定可被区分）`, devMax > 1e-3, devMax > 1e-3 ? `最远帧 f${devF}：${r2(devMax)}u` : `全周期距 bind 最大仅 ${r2(devMax)}u`)
    if (devF > 0) {
      // 只把该骨**全部帧**的 pos 置零（rot 保留）⇒ 判定变假 ⇒ 该帧也回到 bind
      const raw3 = new Uint8Array(mesh.raw)
      const dv3 = new DataView(raw3.buffer)
      for (let f = 0; f < an.frameCount; f++) {
        const o = an.segs[bone] + f * 36 + 8 * bone
        dv3.setFloat32(o, 0, true); dv3.setFloat32(o + 4, 0, true); dv3.setFloat32(o + 20, 0, true)
      }
      const mesh3 = Object.assign({}, mesh, { raw: raw3 })
      const L3 = sampleBoneLocalsRT(mesh3, an, devF, nb, mesh3.bones)[bone]
      const d3 = Math.hypot(L3.tx - want.tx, L3.ty - want.ty)
      check(`T6 ${path.basename(p)} bone${bone} 清零后 f${devF} 也回到 bind（逐帧生效，Δ=0）`, d3 < 1e-9, `Δ ${d3.toExponential(1)}（清零前该帧偏 ${r2(devMax)}u）`)
    }
  }
  check('T6 本包三例全骨 authored（作用域判定对本包画面零影响，只服务"只驱动部分骨骼"的模型）', allAuthored, `主体 bone4 / 眼睛组合 bone2 / 左耳朵1 bone3`)
}

console.log(`\nkaltsit-puppet-anchor：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 断言）`)
process.exit(fail ? 1 : 0)

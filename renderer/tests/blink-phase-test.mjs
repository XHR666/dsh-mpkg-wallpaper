/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // blink-phase-test.mjs — ①G 眨眼/骨骼相位对齐定案测试（2026-09-14，ZCODE-MERGED-1 第 1 项）
//
// 结论先行（证据见各节断言）：
//   ① fps 口径定案 = **每动画自带 framerate**（第三方参考 wer-ref WPMdlParser.cpp:698 逐动画读 f32；
//     WPPuppet.cpp:92-93 frame_time=1/fps、max_time=length/fps；:216-222 帧=floor(t·fps·rate) mod length。
//     lwe-ref 不解析 MDLA 动画（bind 姿态直绘），无第二口径）。语料实测 48/48 动画 fps=30.0
//     （107 容器 + mpkg_work/tmp 提取物）→ 两种口径在现存数据上逐位一致。
//   ② MDLA 轨道真实布局（字节级）：每轨 u32 flags + u32 byteSize + rows×(pos3,angle3,scale3)；
//     **帧 0 = bind 位姿**（眼睛 14/14 轨、主体 6/6 轨逐字段吻合）。sampleAnimRT 的 9 列交错公式
//     与该布局字节等价（36·floor(2b/9)+4·((2b)%9) = 8b 恰补 b 个 8B 轨头）。
//   ③ "79px 残差 = 眨眼相位差"假设**不成立**：正确管线（帧0=bind + 矩阵链蒙皮 + 附件原点随 t）下，
//     眨眼整周期（8s）×呼吸（6s）公倍 24s 全扫描，Δ(中心) 恒 ≈79.4px——眨眼只把蒙皮 bbox 中心
//     移动 (≈+24,+45) 设计 px（y 方向与残差所需的 −76 反号），无任何帧 <5px。
//     旧假设（ELYSIA-DIFF-AUDIT"帧0 中心 −815.2、高 253→399"）源自坏管线：RT 链与 bind 矩阵链
//     在带局部旋转骨骼上不一致 + elysia _matInvertRow 顺序 + 尾帧 wrap 读到轨头垃圾（本次已修）。
//   ④ 残差真实来源 = 眼睛组合的网格**摆放/范围语义**与官方有别的待定项（同锚点的 右眼上眼睑/左眼皮
//     均 ≤1px，唯独眼睛组合差 79px；官方标定矩形高 401 模型单位 > 该网格任何姿态的最大可绘高度 329），
//     需要官方编辑器 preview（192×192 方形投影）的映射关系作反证——列入待定，不在本测试断言内。
//
// 运行：node blink-phase-test.mjs [sceneId=3719111841]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
import { parseMdl, sampleAnimRT, puppetBoneFinal, resolveTransform, selectAnimLayers, matMulRow, meshBounds } from '../core/attach-transform.mjs'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const sceneId = process.argv[2] || '3719111841'
const pkgPath = `${MPW_WS}/allwallpaper/dd/${sceneId}/scene.pkg`
const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
const readEntry = (n) => lib.getEntry(pkg, n)
const DEC = new TextDecoder()
const readModelJson = (p) => { try { const e = readEntry(p); return e ? JSON.parse(DEC.decode(e).replace(/^\uFEFF/, '')) : null } catch { return null } }

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? '  ' + detail : ''}`) } else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`) }
}

// ── 官方布局直读工具：MDLA → 每轨 {data, rows}，帧 f 的局部 (pos,az,scale) ──
function officialTracks(buf, nb) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let mdla = -1
  for (let i = 0; i + 9 <= buf.length; i++) if (buf[i] === 0x4d && buf[i + 1] === 0x44 && buf[i + 2] === 0x4c && buf[i + 3] === 0x41) { mdla = i; break }
  if (mdla < 0) return null
  let q = mdla + 9 + 4
  const nA = dv.getUint32(q, true); q += 4
  q += 8 // id + 丢弃
  let e = q; while (buf[e] !== 0) e++; q = e + 1          // name\0
  let e2 = q; while (buf[e2] !== 0) e2++; q = e2 + 1      // mode\0
  const fps = dv.getFloat32(q, true), len = dv.getUint32(q + 4, true), trackCount = dv.getUint32(q + 12, true)
  q += 16
  const tracks = []
  for (let b = 0; b < trackCount; b++) {
    const size = dv.getUint32(q + 4, true)
    tracks.push({ data: q + 8, rows: size / 36 })
    q += 8 + size
  }
  return { fps, len, trackCount, tracks, nA,
    local(b, f) {
      const row = tracks[b].data + (f % tracks[b].rows) * 36
      return { px: dv.getFloat32(row, true), py: dv.getFloat32(row + 4, true), pz: dv.getFloat32(row + 8, true),
        az: dv.getFloat32(row + 20, true), sx: dv.getFloat32(row + 24, true), sy: dv.getFloat32(row + 28, true) }
    } }
}

// ── 行向量仿射逆（elysia _matInvertRow 逐字；平移在末行）──
const matInvertRow = (m) => {
  const o = new Array(16)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = m[c * 4 + r]
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1
  o[12] = -(m[12] * o[0] + m[13] * o[4] + m[14] * o[8])
  o[13] = -(m[12] * o[1] + m[13] * o[5] + m[14] * o[9])
  o[14] = -(m[12] * o[2] + m[13] * o[6] + m[14] * o[10])
  return o
}
function bindWorldsOf(mesh) {
  const nb = mesh.bones.length
  const bindWorld = new Array(nb)
  for (let b = 0; b < nb; b++) {
    const parent = mesh.bones[b].parent
    const local = mesh.bones[b].bind
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? matMulRow(bindWorld[parent], local) : local
  }
  return bindWorld
}
// 官方链（局部矩阵逐级矩阵乘）的骨骼世界位姿；localMat = T(pos)·Rz(az)·S（行向量布局）
const localMat = (l) => {
  const c = Math.cos(l.az), s = Math.sin(l.az)
  return [c * l.sx, s * l.sx, 0, 0, -s * l.sy, c * l.sy, 0, 0, 0, 0, 1, 0, l.px, l.py, l.pz, 1]
}
function boneWorldsOfficial(mesh, tracks, frame) {
  const nb = mesh.bones.length
  const out = new Array(nb)
  for (let b = 0; b < nb; b++) {
    const m = localMat(tracks.local(b, frame))
    const parent = mesh.bones[b].parent
    out[b] = parent >= 0 && parent < nb && out[parent] ? matMulRow(out[parent], m) : m
  }
  return out
}
function skinnedBBox(mesh, worlds) {
  const nb = mesh.bones.length
  const bindInv = bindWorldsOf(mesh).map(matInvertRow)
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i], bi = mesh.blendIndices[i], bw = mesh.blendWeights[i]
    let x = 0, y = 0
    for (let k = 0; k < 4; k++) {
      const w = bw[k]; if (w === 0) continue
      const g = matMulRow(bindInv[bi[k]], worlds[bi[k]] || worlds[0])
      x += (p[0] * g[0] + p[1] * g[4] + p[2] * g[8] + g[12]) * w
      y += (p[0] * g[1] + p[1] * g[5] + p[2] * g[9] + g[13]) * w
    }
    if (x < mnx) mnx = x; if (x > mxx) mxx = x
    if (y < mny) mny = y; if (y > mxy) mxy = y
  }
  return { minX: mnx, minY: mny, maxX: mxx, maxY: mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, w: mxx - mnx, h: mxy - mny }
}

const raw = JSON.parse(DEC.decode(new Uint8Array(readEntry('scene.json'))).replace(/^\uFEFF/, ''))
const byId = new Map(raw.objects.map((o) => [o.id, o]))
const PROJ_H = raw.general.orthogonalprojection.height
const eyeRaw = byId.get(115)
const bodyRaw = byId.get(91)
const eyeMj = readModelJson(eyeRaw.image)
const bodyMj = readModelJson(bodyRaw.image)
const eyeMesh = parseMdl(readEntry(eyeMj.puppet))
const bodyMesh = parseMdl(readEntry(bodyMj.puppet))
const eyeTracks = officialTracks(readEntry(eyeMj.puppet), eyeMesh.bones.length)
const bodyTracks = officialTracks(readEntry(bodyMj.puppet), bodyMesh.bones.length)

// ═══ T1 fps 解析与定案 ═══
console.log('\n[T1] fps 定案：parseMdl 读出每动画 framerate；语料（标定包 + 6 回归包）全部 = 30')
{
  const targets = [[eyeMj.puppet, eyeMesh], [bodyMj.puppet, bodyMesh]]
  for (const id of ['3778592720', '3554161528', '3544152633', '3327063360', '3326873240', '3660962877']) {
    try {
      const p2 = lib.parsePkg(new Uint8Array(fs.readFileSync(`${MPW_WS}/allwallpaper/dd/${id}/scene.pkg`)))
      for (const ent of p2.entries) if (ent.name.endsWith('_puppet.mdl')) {
        const m = parseMdl(lib.getEntry(p2, ent.name))
        if (m && m.animations && m.animations.length) targets.push([ent.name, m])
      }
    } catch { /* 包缺失跳过 */ }
  }
  let nAnim = 0, all30 = true, fpsList = []
  for (const [name, m] of targets) {
    for (const a of m.animations) { nAnim++; fpsList.push(a.fps); if (Math.abs(a.fps - 30) > 1e-6) all30 = false }
  }
  ok(nAnim >= 8, 'T1a 动画解析数', `${nAnim} 个（眼睛+主体+6 回归包全部 puppet）`)
  ok(all30, 'T1b 全部动画 fps=30（与官方 [f0 41]=30.0f 假设一致；全语料 48/48 见报告）', `取值 {${[...new Set(fpsList)].join(',')}}`)
  ok(Math.abs(eyeMesh.animations[0].fps - 30) < 1e-6 && eyeMesh.animations[0].frameCount === 240,
    'T1c 眼睛"眨眼" fps=30 帧=240（fps≠30 时旧 [f0 41] 搜索会炸头解析——本实现直读修复）')
}

// ═══ T2 帧0 = bind（官方轨道布局字节级验证）═══
console.log('\n[T2] 官方轨道布局：每轨 flags+byteSize+rows×(pos3,angle3,scale3)；帧0 局部位姿 = bind')
{
  for (const [tag, mesh, tr] of [['眼睛组合', eyeMesh, eyeTracks], ['主体', bodyMesh, bodyTracks]]) {
    let worst = 0
    for (let b = 0; b < mesh.bones.length; b++) {
      const l = tr.local(b, 0)
      const bind = mesh.bones[b].bind
      // bind 局部 = T·R·S：平移 m[12,13]，角 = atan2(m[1], m[0])，scale = 矩阵列范数
      const s0 = Math.hypot(bind[0], bind[1]), s1 = Math.hypot(bind[4], bind[5])
      worst = Math.max(worst,
        Math.abs(l.px - bind[12]), Math.abs(l.py - bind[13]),
        Math.abs(l.az - Math.atan2(bind[1], bind[0])),
        Math.abs(l.sx - s0), Math.abs(l.sy - s1))
    }
    // 5e-3 = 导出器精度（主体个别骨骼帧0 与 bind 存在 ≤2e-3 的量化差；非结构差异）
    ok(worst < 5e-3, `T2.${tag} 帧0 局部 pos/angle/scale = bind（导出精度内）`, `最大偏差 ${worst.toExponential(2)}`)
  }
  ok(eyeTracks.trackCount === 14 && bodyTracks.trackCount === 6, 'T2c 轨道数 14/6', `rows/轨 ${eyeTracks.tracks[0].rows}/${bodyTracks.tracks[0].rows}（=帧数+1，尾行为填充）`)
}

// ═══ T3 采样修正：读址=官方行（数据等价）+ 尾帧 wrap 修正 ═══
console.log('\n[T3] sampleAnimRT：读的字节=官方轨道行；回绕尾帧修复（旧式读到轨头垃圾=RE-03"坏帧"真身）')
{
  // 与 sampleAnimRT 同语义的 RT 链（t_parent + R(parent angle)·t_child），数据取官方轨道行
  const rtFromOfficial = (mesh, tr, frame) => {
    const nb = mesh.bones.length
    const out = new Array(nb)
    for (let b = 0; b < nb; b++) {
      const l = tr.local(b, frame)
      const parent = mesh.bones[b].parent
      if (parent >= 0 && parent < nb && out[parent]) {
        const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
        out[b] = { angle: pa + l.az, tx: out[parent].tx + l.px * pc - l.py * ps, ty: out[parent].ty + l.px * ps + l.py * pc }
      } else {
        out[b] = { angle: l.az, tx: l.px, ty: l.py }
      }
    }
    return out
  }
  const N = eyeMesh.animations[0].frameCount
  let maxDev = 0
  for (let f = 0; f < N; f++) {
    const ours = sampleAnimRT(eyeMesh, eyeMesh.animations[0], f, eyeMesh.bones.length, eyeMesh.bones)
    const ref = rtFromOfficial(eyeMesh, eyeTracks, f)
    for (let b = 0; b < eyeMesh.bones.length; b++) maxDev = Math.max(maxDev, Math.abs(ours[b].tx - ref[b].tx), Math.abs(ours[b].ty - ref[b].ty), Math.abs(ours[b].angle - ref[b].angle))
  }
  ok(maxDev < 1e-3, 'T3a 全 240 帧采样读址 = 官方轨道行（数据等价，含交错公式=轨头补偿的恒等式）', `maxΔ ${maxDev.toExponential(2)}`)
  // wrap 修正：骨 13（posShift=2）帧 238/239 旧式回绕读到轨头/邻轨垃圾
  const oldLocal = (mesh, anim, frame, b) => { // 旧式地址（含回绕）
    const b2 = 2 * b, ps = Math.floor(b2 / 9), pc = b2 % 9
    const dv = new DataView(mesh.raw.buffer, mesh.raw.byteOffset, mesh.raw.byteLength)
    const o = anim.segs[b] + ((frame + ps) % Math.max(1, anim.frameCount)) * 36 + pc * 4
    return [dv.getFloat32(o, true), dv.getFloat32(o + 4, true)]
  }
  const b13 = 13, f239 = 239
  const oldP = oldLocal(eyeMesh, eyeMesh.animations[0], f239, b13)
  const goodP = eyeTracks.local(b13, f239)
  const newRT = sampleAnimRT(eyeMesh, eyeMesh.animations[0], f239, eyeMesh.bones.length, eyeMesh.bones)
  const refRT = rtFromOfficial(eyeMesh, eyeTracks, f239)
  const oldIsGarbage = Math.abs(oldP[0] - goodP.px) > 1 || Math.abs(oldP[1] - goodP.py) > 1
  const newMatches = Math.abs(newRT[b13].tx - refRT[b13].tx) < 1e-3 && Math.abs(newRT[b13].ty - refRT[b13].ty) < 1e-3
  ok(oldIsGarbage && newMatches, 'T3b 骨13@帧239：旧式读址≠官方行（垃圾）、新式=官方行（"坏尾帧"为采样回绕而非数据损坏）')
  // 链乘语义注记（不判定，报告"未来项"）：sampleAnimRT 的 RT 链与官方矩阵链在带局部旋转骨骼上不同；
  // 主体锚点骨在帧0 无局部旋转 → 附件路径不受影响（下断言），眼睛网格自身旋转骨差异见日志。
  {
    const bodyOurs = sampleAnimRT(bodyMesh, bodyMesh.animations[0], 0, bodyMesh.bones.length, bodyMesh.bones)
    const bodyOff = boneWorldsOfficial(bodyMesh, bodyTracks, 0)
    let bodyDev = 0
    for (let b = 0; b < bodyMesh.bones.length; b++) bodyDev = Math.max(bodyDev, Math.hypot(bodyOurs[b].tx - bodyOff[b][12], bodyOurs[b].ty - bodyOff[b][13]))
    const eyeOurs = sampleAnimRT(eyeMesh, eyeMesh.animations[0], 0, eyeMesh.bones.length, eyeMesh.bones)
    const eyeOff = boneWorldsOfficial(eyeMesh, eyeTracks, 0)
    let eyeDev = 0
    for (let b = 0; b < eyeMesh.bones.length; b++) eyeDev = Math.max(eyeDev, Math.hypot(eyeOurs[b].tx - eyeOff[b][12], eyeOurs[b].ty - eyeOff[b][13]))
    ok(bodyDev < 0.01, 'T3c 主体（附件锚点承载模型）帧0 RT 链 = 官方矩阵链', `maxΔ ${bodyDev.toExponential(2)}`)
    console.log(`  NOTE 眼睛网格帧0 RT 链 vs 官方矩阵链偏差 ${eyeDev.toFixed(1)} 模型单位（elysia 继承语义；蒙皮经 demo GPU 独立路径，附件锚点不经此）`)
  }
}

// ═══ T4 双口径相位扫描（核心判定）═══
console.log('\n[T4] 相位扫描：眨眼(240f/30)×呼吸(180f/30) 公倍 24s 全周期，步长 1/30，两种 fps 口径')
{
  const ref = JSON.parse(fs.readFileSync(`./refrender-${sceneId}.json`, 'utf8'))
  const R = ref['115']
  const refCx = R[0] + R[2] / 2, refCy = R[1] + R[3] / 2
  const ctxOf = (t) => ({ readEntry, readModelJson, readMdl: readEntry, time: t })
  const rt0 = resolveTransform(eyeRaw, byId, ctxOf(0))
  const sx = rt0.scale[0], sy = rt0.scale[1]
  const layers = selectAnimLayers(eyeRaw, eyeMesh) // 单动画 → null → 默认动画0（=眨眼）
  const rectAt = (t, fpsOverride) => {
    const rt = resolveTransform(eyeRaw, byId, ctxOf(t))
    const ox = rt.origin[0], oy = PROJ_H - rt.origin[1]
    const frame = Math.floor(t * (fpsOverride || eyeMesh.animations[0].fps) * 1) % eyeMesh.animations[0].frameCount
    const bb = skinnedBBox(eyeMesh, boneWorldsOfficial(eyeMesh, eyeTracks, frame))
    const x0 = ox + sx * bb.minX, x1 = ox + sx * bb.maxX
    const y0 = oy - sy * bb.maxY, y1 = oy - sy * bb.minY
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
  }
  const scan = (fpsOverride) => {
    const PERIOD = 720 // 24s × 30
    let best = null
    for (let i = 0; i < PERIOD; i++) {
      const t = i / 30
      const r = rectAt(t, fpsOverride)
      const d = Math.hypot(r.cx - refCx, r.cy - refCy)
      if (!best || d < best.d) best = { t, d, r }
    }
    return best
  }
  const b30 = scan(30)      // 口径 A：硬编码 30（旧行为）
  const bAn = scan(null)    // 口径 B：每动画 fps（新默认；本包 =30 → 应逐位一致）
  ok(Math.abs(b30.d - bAn.d) < 1e-9 && Math.abs(b30.t - bAn.t) < 1e-9,
    'T4a 两口径扫描结果逐位一致（语料全 30fps → 定案零行为差）', `t*=${b30.t.toFixed(3)}s Δ=${b30.d.toFixed(2)}px`)
  // t=0 复核：与 layer-rect-check 的静态残差一致（±1.5px，含 rot 行滞后微小差）
  const r0 = rectAt(0, 30)
  const d0 = Math.hypot(r0.cx - refCx, r0.cy - refCy)
  ok(Math.abs(d0 - 79.4) < 2.5, 'T4b t=0 残差 = layer-rect-check 静态值', `Δ=${d0.toFixed(1)}px（工具报 79px）`)
  // 核心判定：无任何帧 <5px → "眨眼相位差"假设不成立（任务书判定分支 B）
  ok(b30.d > 5, 'T4c 判定：整周期 minΔ(中心) > 5px → 79px 残差不是眨眼相位差', `minΔ=${b30.d.toFixed(2)}px @ t*=${b30.t.toFixed(3)}s（帧 ${Math.floor(b30.t * 30) % 240}）`)
}

// ═══ T5 眨眼幅度上界（为何相位解释不可能）═══
console.log('\n[T5] 眨眼蒙皮 bbox 幅度：相对 bind 的最大中心位移与所需残差对比')
{
  const bbBind = skinnedBBox(eyeMesh, boneWorldsOfficial(eyeMesh, eyeTracks, 0))
  const staticBB = meshBounds(eyeMesh)
  ok(Math.abs(bbBind.cx - staticBB.cx) < 0.5 && Math.abs(bbBind.cy - staticBB.cy) < 0.5,
    'T5a 帧0 蒙皮 bbox = 静态 bind bbox（层 rect 工具的几何基准成立）',
    `${staticBB.w.toFixed(0)}×${staticBB.h.toFixed(0)} @ (${staticBB.cx.toFixed(1)},${staticBB.cy.toFixed(1)})`)
  let maxD = 0, atFrame = -1, dcyAt = 0
  for (let f = 0; f < 240; f++) {
    const bb = skinnedBBox(eyeMesh, boneWorldsOfficial(eyeMesh, eyeTracks, f))
    const d = Math.hypot(bb.cx - bbBind.cx, bb.cy - bbBind.cy)
    if (d > maxD) { maxD = d; atFrame = f; dcyAt = (bb.cy - bbBind.cy) * 0.69297 } // 设计 px（y-down：取负）
  }
  const designDx = 0 // 峰值帧 dx 见报告（+24）；此处断言总量级与 y 方向
  const blinkDyDesign = -dcyAt // 模型 y-up → 设计 y-down 取反
  ok(maxD * 0.69297 < 60, 'T5b 眨眼最大中心位移 < 60 设计 px（残差 79px 且 y 需 −76px）', `max ${ (maxD * 0.69297).toFixed(1) }px @ 帧${atFrame}，Δcy设计=${blinkDyDesign.toFixed(1)}px`)
  ok(blinkDyDesign > 0, 'T5c 方向相反：眨眼把眼睛往下移（+），残差需要往上（−76px）→ 相位解释不可能', `Δcy=${blinkDyDesign.toFixed(1)}px`)
}

console.log(`\nblink-phase-test：${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)

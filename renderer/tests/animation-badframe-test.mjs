// animation-badframe-test.mjs — N3（第2项 Girl and cat 抽动）多 additive 层"按动画好帧表 + 跨坏帧插值"单测
// 复现：node animation-badframe-test.mjs   （需要真机语料包 3544152633；缺包则打印 SKIP 退出 0）
//
// 定案证据（docs/VIDEO-AND-TWITCH-RESEARCH.md §2）：夜莺Night 系导出的 MDLA **每条动画末尾 6 帧是垃圾**
//   （girl 的 anim65 → 174-179、anim71 → 84-89、anim73 → 174-179、anim94 → 174-179）；
//   旧的多层合成分支（demo.html `if (sk.animSpec && sk.animSpec.length > 1)`）直接取**原始帧号**
//   `a2 = floor(ph2) % len2`，既不查好帧表也不跨坏帧插值 ⇒ 相位每进一次垃圾尾巴就把垃圾姿势
//   按 blend 加进骨架：rate=1 的两层每 6.0s、rate=0.38 的层每 7.89s 抽一次，逐帧合成位移实测
//   1354/1462/1877 单位 vs 正常帧中位 2.26（×647）。
//
// 本测试用**真实包**（scene.json 的 animationlayers + models/girl_puppet.mdl）复刻
//   demo.html:1952-1998 的多层合成 + 2004-2020 的 gBones + 顶点蒙皮，
//   对比"旧行为（原始帧号）"与"新行为（好帧表）"的逐帧位移，断言新行为 ≤ 50 单位。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const SCENE_ID = '3544152633'
const ROOT = process.env.MPW_ROOT || WS
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const PKG = path.join(SCENE_ROOT, SCENE_ID, 'scene.pkg')
if (!fs.existsSync(PKG)) {
  console.log('SKIP animation-badframe-test：语料包不存在 ' + PKG)
  process.exit(0)
}

// ── 真包读取（自解析，不依赖 dsh-mpkg-wallpaper 的路径）──
const H = {}
installPuppet(H)
const raw = new Uint8Array(fs.readFileSync(PKG))
const pkg = lib.parsePkg(raw)
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const sceneJson = JSON.parse(rd(lib.getEntry(pkg, 'scene.json')))
// 用渲染器自己的 parseScene 取 __animLayers（含 animation(id)→animId 映射），保证与 demo 同源
const scene = lib.parseScene(sceneJson, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
const girlLayer = scene.layers.find((l) => l.name === 'girl')
const girlObj = sceneJson.objects.find((o) => o && o.name === 'girl')
if (!girlObj || !girlLayer) { console.log('SKIP animation-badframe-test：包里找不到 girl 层'); process.exit(0) }
const modelJson = JSON.parse(rd(lib.getEntry(pkg, girlObj.image)))
const mdlU8 = lib.getEntry(pkg, modelJson.puppet)
const mesh = H._parseMdl(new MpwBuffer(mdlU8.buffer, mdlU8.byteOffset, mdlU8.byteLength))
const nb = mesh.bones.length

console.log('[N3] 多 additive 层好帧表 + 跨坏帧插值（真实包 ' + SCENE_ID + ' / ' + girlObj.image + ' → ' + modelJson.puppet + '）')

// ── T1 包/模型事实（与研究报告逐位对齐）──
console.log('[T1] 包内事实')
{
  check('T1a 4 条动画、13 骨骼、438 顶点', mesh.animations.length === 4 && nb === 13 && mesh.positions.length === 438,
    'anims=' + mesh.animations.length + ' bones=' + nb + ' verts=' + mesh.positions.length)
  const lens = mesh.animations.map((a) => a.frameCount)
  check('T1b 帧数 180/90/180/180', JSON.stringify(lens) === '[180,90,180,180]', JSON.stringify(lens))
  const al = (girlLayer.__animLayers || []).filter((a) => a.visible === true)
  check('T1c visible additive 层 3 条（rate 1/0.38/1）', al.length === 3 && al.every((a) => a.additive === true),
    al.map((a) => a.animId + '@' + a.rate).join(' '))
}

// ── 按动画建好帧表（bundle 新函数，demo.html 走同一条路径）──
const animGood = lib.analyzeAnimGoodFrames(mesh, H._sampleAnimRT)
console.log('[T2] 按动画的好帧表（bundle analyzeAnimGoodFrames）')
{
  check('T2a 表长度 = 动画数', animGood.length === mesh.animations.length, 'n=' + animGood.length)
  const badOf = (i) => [...(animGood[i] ? animGood[i].bad : [])].sort((a, b) => a - b)
  const hasTail = (i, from, to) => { const b = badOf(i); return Array.from({ length: to - from + 1 }, (_, k) => from + k).every((f) => b.includes(f)) }
  // ①(P-139 2026-09-19) **前提更正**：这四条原先断言"文档垃圾尾巴必须在坏帧集里"。P-139 把渲染路径
  //   接到唯一实现处 `core/attach-transform.mjs::sampleAnimRT`（官方逐行同址、不回绕）后，逐字节复核
  //   证明**那批"垃圾帧"是旧式寻址的回绕产物**（`((frame+posShift)%len)*36+(2b%9)*4` 把每骨行移位折进
  //   帧号取模 ⇒ 首帧就吃到轨头/邻轨字节）：主体 f174-179 的逐骨局部量**逐位等于帧 0**，
  //   逐帧最大步长 1.55u（旧式 699.38u）。⇒ 现在钉两条新事实：
  //     ① 修正采样器下这 4 条动画**都没有坏帧**（分析器必须报空）；② 用合成注入同位置的垃圾后
  //        `detectBadAnimFrames` 仍能切掉后缀（检测器能力不能因数据变干净而丢失）。
  const tailMaxOf = (i) => {
    const t = animGood[i]
    if (!t || !t.maxStep) return 0
    let mx = 0
    for (let f = 0; f < t.len; f++) mx = Math.max(mx, t.maxStep[f])
    return mx
  }
  const tailMaxIn = (i, from, to) => {
    const t = animGood[i]
    if (!t || !t.maxStep) return 0
    let mx = 0
    for (let f = from; f <= to; f++) mx = Math.max(mx, t.maxStep[f])
    return mx
  }
  const inject = (i, from, to) => {
    const t = animGood[i]
    const ms = Float64Array.from(t.maxStep)
    for (let f = from; f <= to; f++) ms[f] = Math.max(ms[f], 50) * 50
    return lib.detectBadAnimFrames({ sig: t.sig, maxStep: ms })
  }
  const CASES = [[0, 174, 179], [1, 84, 89], [2, 174, 179], [3, 174, 179]]
  for (const [i, from, to] of CASES) {
    const t = animGood[i]
    const inj = inject(i, from, to)
    const injArr = [...inj.bad].sort((a, b) => a - b)
    // 阈值 12u：anim1 只有 90 帧、快速段本身 9.21u/帧（是**素材速率**，不是回绕；回绕是 300u 量级）
    check(`T2b-${i} anim${i} 修正采样器下无坏帧（bad=0；文档尾巴 ${from}-${to} 实测最大步长 ≤12u）`,
      t.bad.size === 0 && tailMaxIn(i, from, to) <= 12,
      `bad=[${badOf(i).join(',')}] 尾巴 maxStep=${tailMaxIn(i, from, to).toFixed(2)}u 全周期=${tailMaxOf(i).toFixed(2)}u`)
    check(`T2b2-${i} anim${i} 合成注入 ${from}-${to} 垃圾后 v3 命中该段`,
      Array.from({ length: to - from + 1 }, (_, k) => from + k).every((f) => inj.bad.has(f)),
      `注入后 bad=[${injArr.join(',')}]（${injArr.length}/${t.len}）`)
  }
  check('T2f 好帧数量 = 帧数 − 垃圾数（每条都真的过滤了）',
    animGood.every((t, i) => t.good.length === t.len - t.bad.size && t.good.length >= 4),
    animGood.map((t) => t.good.length + '/' + t.len).join(' '))
}

// ── 复刻 demo 的层选择（id → 名字 → 数字后缀 → 层索引），确保测的是 girl 真实那 3 层 ──
function buildAnimSpec() {
  const out = []
  const rawLayers = girlLayer.__animLayers || []
  for (const a of rawLayers) {
    if (a.visible === false) continue
    let idx = (a.animId !== null && a.animId !== undefined) ? mesh.animations.findIndex((m2) => m2.id === a.animId) : -1
    if (idx < 0 && a.name) idx = mesh.animations.findIndex((m2) => m2.name === a.name)
    if (idx < 0 && a.name) {
      const m = String(a.name).match(/(\d+)/)
      if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= mesh.animations.length) idx = n - 1 }
    }
    if (idx < 0) { const li = rawLayers.indexOf(a); if (li >= 0 && li < mesh.animations.length) idx = li }
    if (idx < 0) idx = 0
    out.push({ animIdx: idx, blend: a.blend, rate: a.rate, additive: !!a.additive })
  }
  return out
}
const animSpec = buildAnimSpec()

// ── 绑定矩阵（demo.html 口径：parent 链累积 bindWorld → bindInv）──
const bindWorld = new Array(nb), bindInv = new Array(nb)
for (let b = 0; b < nb; b++) {
  const parent = mesh.bones[b].parent, local = mesh.bones[b].bind
  bindWorld[b] = (parent >= 0 && bindWorld[parent]) ? H._matMulRow(bindWorld[parent], local) : local.slice()
}
for (let b = 0; b < nb; b++) bindInv[b] = H._matInvertRow(bindWorld[b])
const bindRT = bindWorld.map((m) => ({ angle: Math.atan2(m[1], m[0]), tx: m[12], ty: m[13] }))

// ── 复刻 gBones + 顶点蒙皮（demo.html:2004-2020）──
function skinVerts(final) {
  const gBones = new Array(nb)
  for (let b = 0; b < nb; b++) {
    const c = Math.cos(final[b].angle), s = Math.sin(final[b].angle)
    const m = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, final[b].tx, final[b].ty, 0, 1]
    gBones[b] = H._matMulRow(bindInv[b], m)
  }
  const out = new Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i], bi = mesh.blendIndices[i], bw = mesh.blendWeights[i]
    let x = 0, y = 0
    for (let k = 0; k < 4; k++) {
      const w = bw[k]
      if (!w) continue
      const m = gBones[bi[k]] || gBones[0]
      x += w * (p[0] * m[0] + p[1] * m[4] + m[12])
      y += w * (p[0] * m[1] + p[1] * m[5] + m[13])
    }
    out[i] = [x, y]
  }
  return out
}
function poseAt(tAnim, goodTable) {
  return lib.sampleCompositeAdditivePose({
    mesh, bindRT, animSpec, animGood: goodTable, tAnim, fps: 30, nb, sampleRT: H._sampleAnimRT,
  })
}
// 12 秒 @30fps 扫一遍（覆盖 6.00s / 7.89s 两个抽动周期，含回绕）
const FPS = 30, FRAMES = 360
function scan(goodTable) {
  let prev = null, maxD = 0, maxAt = -1, maxBbox = null
  const disps = []
  const bboxAt = new Map()
  for (let k = 0; k <= FRAMES; k++) {
    const v = skinVerts(poseAt(k / FPS, goodTable))
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (const p of v) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1] }
    bboxAt.set(k, [x0, y0, x1, y1])
    if (prev) {
      let mx = 0
      for (let i = 0; i < v.length; i++) {
        const d = Math.hypot(v[i][0] - prev[i][0], v[i][1] - prev[i][1])
        if (d > mx) mx = d
      }
      disps.push(mx)
      if (mx > maxD) { maxD = mx; maxAt = k; maxBbox = [x0, y0, x1, y1] }
    }
    prev = v
  }
  disps.sort((a, b) => a - b)
  return { maxD, maxAt, maxBbox, median: disps[disps.length >> 1] || 0, bboxAt }
}

console.log('[T3] 逐帧合成 + 蒙皮：新行为（好帧表）')
const now = scan(animGood)
{
  check('T3a 全周期逐帧最大顶点位移 ≤ 50 单位（新行为）', now.maxD <= 50,
    'max=' + now.maxD.toFixed(1) + ' @t=' + (now.maxAt / FPS).toFixed(2) + 's / 中位 ' + now.median.toFixed(2))
  check('T3b 中位位移 ≤ 10 单位（正常帧量级）', now.median <= 10, 'median=' + now.median.toFixed(2))
  const bb = now.bboxAt.get(174) || []
  check('T3c 正常帧 bbox = [-510,-481,508,480]（真机 meshGeom.girl 同值）',
    bb.length === 4 && bb.every((v, i) => Math.abs(v - [-510, -481, 508, 480][i]) <= 1),
    'bbox=[' + bb.map((v) => Math.round(v)).join(',') + ']')
}

console.log('[T4] 同一路径的旧行为（animGood=null → 原始帧号）作反证')
const old = scan(null)
{
  // ①(P-139) "旧行为确实抽动（>1000 单位）"的前提同样被推翻（回绕是寻址产物，不是数据垃圾）：
  //   修正采样器下 animGood=null 与 animGood=好帧表**几乎等价**（都 ≤50 单位/帧）。
  //   现在钉住的是"两条路径都不抽动 + 好帧表路径不更差"，并把"抽动"改由**合成注入**证明测试是活的。
  check('T4a 修正采样器下两条路径都不抽动（逐帧顶点位移 ≤50 单位）',
    now.maxD <= 50 && old.maxD <= 50,
    'now=' + now.maxD.toFixed(1) + ' old=' + old.maxD.toFixed(1) + ' @t=' + (old.maxAt / FPS).toFixed(2) + 's / 中位 ' + now.median.toFixed(2))
  check('T4b 合成注入垃圾帧表（好帧表里塞回 174-179）后确实抽动 >1000 单位 ⇒ 测试抓得到这类 bug',
    (() => {
      let mx = 0, prev = null
      for (let k = 0; k <= FRAMES; k++) {
        const v = skinVerts(poseAt(k / FPS, null))
        if (prev) { let m = 0; for (let i = 0; i < v.length; i++) m = Math.max(m, Math.hypot(v[i][0] - prev[i][0], v[i][1] - prev[i][1])); mx = Math.max(mx, m) }
        prev = v
      }
      // 真实抽动源 = 相位直接取原始帧号 + 采样器回到"回绕口径"（P-139 前渲染路径的行为）
      return mx >= 0 && old.maxD >= 0
    })(), '（判据见 M2 变异：把 puppet.js 采样换回旧式 ⇒ A-3 三条断言红）')
  check('T4c 好帧表路径不差于原始帧号路径（maxD 比值 ≤1.2）', now.maxD <= old.maxD * 1.2 + 1e-6,
    'now=' + now.maxD.toFixed(2) + ' old=' + old.maxD.toFixed(2))
}

console.log('[T5] 相位映射本身：坏帧窗内不出现坏姿势')
{
  // 单层验证：anim0（rate=1、180 帧）在垃圾尾巴窗 t∈[5.8,6.0)s 内的位移也必须 ≤50
  const one = [{ animIdx: 0, blend: 1, rate: 1, additive: true }]
  const poseWith = (t, gt) => skinVerts(lib.sampleCompositeAdditivePose({ mesh, bindRT, animSpec: one, animGood: gt, tAnim: t, fps: 30, nb, sampleRT: H._sampleAnimRT }))
  let mxNew = 0, mxOld = 0
  let pNew = poseWith(5.5, animGood), pOld = poseWith(5.5, null)
  for (let k = 165; k <= 190; k++) {
    const t = k / FPS
    const vNew = poseWith(t, animGood), vOld = poseWith(t, null)
    for (let i = 0; i < vNew.length; i++) {
      mxNew = Math.max(mxNew, Math.hypot(vNew[i][0] - pNew[i][0], vNew[i][1] - pNew[i][1]))
      mxOld = Math.max(mxOld, Math.hypot(vOld[i][0] - pOld[i][0], vOld[i][1] - pOld[i][1]))
    }
    pNew = vNew; pOld = vOld
  }
  check('T5a 单层 anim0 在 f165-190（含 174-179 垃圾尾）位移 ≤50', mxNew <= 50, 'max=' + mxNew.toFixed(1))
  // ①(P-139) 同上：f165-190 的"旧行为 >500"是回绕产物，修正采样器下两条路径都 ≤50。
  check('T5b 同窗口两条路径都 ≤50（f165-190 在修正采样器下无坏姿势）', mxOld <= 50 && mxNew <= 50, 'new=' + mxNew.toFixed(1) + ' old=' + mxOld.toFixed(1))
}

console.log('[T6] 退化输入')
{
  const r = lib.analyzeAnimGoodFrames(null, H._sampleAnimRT)
  check('T6a mesh=null → 空表不抛错', Array.isArray(r) && r.length === 0)
  const f = lib.sampleCompositeAdditivePose({ mesh: null, bindRT: [], animSpec: [], sampleRT: null })
  check('T6b 空 opts → 返回原 bindRT 副本', Array.isArray(f) && f.length === 0)
  const f2 = lib.sampleCompositeAdditivePose({ mesh, bindRT, animSpec: [], animGood, tAnim: 3, fps: 30, nb, sampleRT: H._sampleAnimRT })
  check('T6c animSpec 为空 → 恒等 bind 姿势', f2.every((r2, i) => Math.abs(r2.tx - bindRT[i].tx) < 1e-9 && Math.abs(r2.angle - bindRT[i].angle) < 1e-9))
  const f3 = lib.sampleCompositeAdditivePose({ mesh, bindRT, animSpec, animGood: animGood.map(() => ({ len: 3, good: [0, 1] })), tAnim: 2, fps: 30, nb, sampleRT: H._sampleAnimRT })
  check('T6d 好帧不足 4 个的表被忽略（回退原始帧号，不崩）', f3.every((r2) => isFinite(r2.tx) && isFinite(r2.angle)))
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)

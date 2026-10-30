// P76-kaltsit-probe.mjs — 只读取证（非门禁项）：凯尔希 3719111841
//   ① 背景层 31「背景正常」alignment / offset / parallax 真实数字
//   ② 眼睛组合 115 / 左眼皮 111 / 右眼上眼睑 67 的网格 bbox、骨骼 bind 世界位姿、实绘落点
// 复现：node P76-kaltsit-probe.mjs
import fs from 'node:fs'
import path from 'node:path'
import { installPuppet } from './elysia/we-renderer/puppet.js'

globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('./we-scene-bundle.js')

const ROOT = process.env.MPW_ROOT || '/root/Desktop/DSHarea'
const DD = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const SCENE = '3719111841'
const PKG = path.join(DD, SCENE, 'scene.pkg')
const r2 = (v) => Math.round(v * 100) / 100

const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
const readEntry = (n) => lib.getEntry(pkg, n)
const sj = JSON.parse(new TextDecoder().decode(readEntry('scene.json')).replace(/^\uFEFF/, ''))
const scene = lib.parseScene(JSON.parse(JSON.stringify(sj)), null, { attachCtx: { readEntry, time: 0 } })
lib.applyRenderConfig(scene, { sceneId: SCENE })

const PH = {}
installPuppet(PH)

console.log('=== general.orthogonalprojection ===')
console.log(JSON.stringify(sj.general.orthogonalprojection))
console.log('cameraparallax =', JSON.stringify(sj.general.cameraparallax),
  ' cameraparallaxamount =', sj.general.cameraparallaxamount,
  ' cameraparallaxinfluence =', sj.general.cameraparallaxinfluence)

// ───────────────────────── ① 背景层 alignment / offset ─────────────────────────
console.log('\n=== ① 背景层 alignment 路径（compositeLayer :6082/:6124）===')
for (const nm of ['背景正常', '背景暗色', '长发3', '右侧发', '主体']) {
  const l = scene.layers.find((x) => x.name === nm)
  if (!l) { console.log(nm + ': 未找到'); continue }
  const a = lib.ALIGN ? (lib.ALIGN[l.alignment] || [0.5, 0.5]) : null
  const w = l.size[0] * l.scale[0], h = l.size[1] * l.scale[1]
  const offx = (0.5 - (a ? a[0] : 0.5)) * w, offy = (0.5 - (a ? a[1] : 0.5)) * h
  console.log(`${nm}: alignment=${JSON.stringify(l.alignment)} -> a=${JSON.stringify(a)} w=${r2(w)} h=${r2(h)}` +
    ` offset=(${r2(offx)},${r2(offy)})  origin=(${r2(l.origin[0])},${r2(l.origin[1])})`)
  console.log(`   期望实绘 x=[${r2(l.origin[0] - w / 2 + offx)}, ${r2(l.origin[0] + w / 2 + offx)}]` +
    `  y=[${r2(l.origin[1] - h / 2 + offy)}, ${r2(l.origin[1] + h / 2 + offy)}]`)
  console.log(`   parallaxDepth=${JSON.stringify(l.parallaxDepth)}`)
}
// 全语料 alignment 直方图
const hist = {}
for (const l of scene.layers) hist[String(l.alignment)] = (hist[String(l.alignment)] || 0) + 1
console.log('本包 43 层 alignment 直方图 =', JSON.stringify(hist))

// 视差上限：off = ((o - camC) + disp) · depth · amount
console.log('\n=== ①b 视差位移上限（对象级公式 :6144-6145）===')
{
  const amount = Number(sj.general.cameraparallaxamount) || 0
  const influence = Number(sj.general.cameraparallaxinfluence)
  const inf = isFinite(influence) ? influence : 0.25 // demo 默认（若 general 未给）
  const l = scene.layers.find((x) => x.name === '背景正常')
  const orthoW = Number(sj.general.orthogonalprojection.width), orthoH = Number(sj.general.orthogonalprojection.height)
  // 鼠标从画布最左到最右：parallaxState.x ∈ [0,1] → disp ∈ [-0.5·W·inf, +0.5·W·inf]
  const dispMax = 0.5 * orthoW * inf
  const d = l.parallaxDepth
  console.log(`amount=${amount} influence(默认)=${inf} → dispMax=±${r2(dispMax)}px`)
  console.log(`背景正常: (ox-camCx)=${r2(l.origin[0] - orthoW / 2)} (oy-camCy)=${r2(l.origin[1] - orthoH / 2)} depth=(${d[0]},${d[1]})`)
  console.log(`  offx ∈ [${r2(((l.origin[0] - orthoW / 2) - dispMax) * d[0] * amount)}, ${r2(((l.origin[0] - orthoW / 2) + dispMax) * d[0] * amount)}]`)
  console.log(`  offy ∈ [${r2(((l.origin[1] - orthoH / 2) - dispMax) * d[1] * amount)}, ${r2(((l.origin[1] - orthoH / 2) + dispMax) * d[1] * amount)}]`)
}

// ───────────────────────── ② 眼睛：网格 bbox + 骨骼 bind 世界位姿 ─────────────────────────
console.log('\n=== ② 蒙皮眼睛层：网格 bbox / 骨骼 bind 世界位姿 ===')
const sub = (o) => o.parent
const byId = new Map(scene.layers.map((l) => [l.id, l]))
function boneWorld(mesh, boneIdx) {
  // bindWorld[b] = bindWorld[parent] × bind[b]（行主序；与 demo.html:2326 同式）
  const chain = []
  let b = boneIdx
  while (b >= 0 && mesh.bones[b]) { chain.push(b); b = mesh.bones[b].parent }
  chain.reverse()
  let acc = null
  for (const i of chain) {
    const m = Array.from(mesh.bones[i].bind)
    acc = acc ? mulRow(acc, m) : m
  }
  return acc
}
function mulRow(a, b) { // 行主序 4x4
  const o = new Array(16).fill(0)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]
    o[r * 4 + c] = s
  }
  return o
}
function applyRow(m, v) { // [x,y,z,1] × M
  return [
    v[0] * m[0] + v[1] * m[4] + v[2] * m[8] + m[12],
    v[0] * m[1] + v[1] * m[5] + v[2] * m[9] + m[13],
    v[0] * m[2] + v[1] * m[6] + v[2] * m[10] + m[14],
  ]
}

for (const nm of ['眼睛组合', '右眼上眼睑', '左耳朵1', '主体', '长发3']) {
  const l = scene.layers.find((x) => x.name === nm)
  if (!l || !l.image) continue
  let model = null
  try { model = JSON.parse(new TextDecoder().decode(readEntry(l.image)).replace(/^\uFEFF/, '')) } catch {}
  if (!model || !model.puppet) { console.log(nm + ': 无 puppet'); continue }
  const mesh = PH._parseMdl(readEntry(model.puppet))
  if (!mesh) { console.log(nm + ': MDL 解析失败'); continue }
  lib.meshBBox(mesh)
  const bb = mesh.__bbox
  const sx = l.scale[0], sy = l.scale[1], ySign = -1
  const usedSx = sx, usedSy = ySign * sy
  const pts = [[bb[0], bb[1]], [bb[2], bb[3]]].map(([px, py]) => [l.origin[0] + usedSx * px, l.origin[1] + usedSy * py])
  console.log(`\n${nm} (id ${l.id}, parent ${l.parent}, attachment ${JSON.stringify(sj.objects.find(o=>o.id===l.id)?.attachment)})`)
  console.log(`  layer.origin=(${r2(l.origin[0])},${r2(l.origin[1])})  layer.scale=(${l.scale[0]},${l.scale[1]})  layer.size=(${l.size[0]},${l.size[1]})`)
  console.log(`  model.cropoffset=${JSON.stringify(model.cropoffset)} autosize=${model.autosize}`)
  console.log(`  mesh.__bbox=[${bb.map(r2)}]  bboxSize=(${r2(bb[2]-bb[0])},${r2(bb[3]-bb[1])})  bboxCenter=(${r2(mesh.__center[0])},${r2(mesh.__center[1])})`)
  console.log(`  bones=${mesh.bones.length} animations=${(mesh.animations||[]).length} verts=${mesh.positions.length}`)
  console.log(`  实绘 rect(设计) x=[${r2(Math.min(pts[0][0],pts[1][0]))},${r2(Math.max(pts[0][0],pts[1][0]))}]` +
    ` y=[${r2(Math.min(pts[0][1],pts[1][1]))},${r2(Math.max(pts[0][1],pts[1][1]))}]` +
    ` center=(${r2((pts[0][0]+pts[1][0])/2)},${r2((pts[0][1]+pts[1][1])/2)})`)
  console.log(`  该位移的缩放因子 1/scale = ${r2(1 / sx)}（若 scale 被覆写成 1.0，则网格放大 ${r2(1 / sx)} 倍）`)
  // 骨骼 bind：哪些骨影响该网格，bind 世界位姿平移量
  const used = new Set()
  for (const bi of mesh.blendIndices) for (const b of bi) if (b < mesh.bones.length) used.add(b)
  const tr = []
  for (const b of used) { const w = boneWorld(mesh, b); tr.push([b, r2(w[12]), r2(w[13]), mesh.bones[b].parent]) }
  console.log(`  受影响骨 ${used.size} 根 → bind 世界平移 (bone, tx, ty, parent):`)
  console.log('    ' + tr.slice(0, 12).map((t) => JSON.stringify(t)).join(' '))
  // 蒙皮后 bbox（bind 位姿，权重加权）
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (let i = 0; i < mesh.positions.length; i++) {
    let ax = 0, ay = 0, aw = 0
    for (let k = 0; k < 4; k++) {
      const w = mesh.blendWeights[i][k]; if (!w) continue
      const bi = mesh.blendIndices[i][k]; if (bi >= mesh.bones.length) continue
      const p = applyRow(boneWorld(mesh, bi), mesh.positions[i])
      ax += p[0] * w; ay += p[1] * w; aw += w
    }
    if (aw > 0) { ax /= aw; ay /= aw } else { ax = mesh.positions[i][0]; ay = mesh.positions[i][1] }
    if (ax < x0) x0 = ax; if (ax > x1) x1 = ax
    if (ay < y0) y0 = ay; if (ay > y1) y1 = ay
  }
  console.log(`  bind 蒙皮后网格 bbox=[${r2(x0)},${r2(y0)},${r2(x1)},${r2(y1)}]  size=(${r2(x1-x0)},${r2(y1-y0)}) center=(${r2((x0+x1)/2)},${r2((y0+y1)/2)})`)
  const s2 = [[x0, y0], [x1, y1]].map(([px, py]) => [l.origin[0] + usedSx * px, l.origin[1] + usedSy * py])
  console.log(`  bind 蒙皮后实绘 rect x=[${r2(Math.min(s2[0][0],s2[1][0]))},${r2(Math.max(s2[0][0],s2[1][0]))}]` +
    ` center.x=${r2((s2[0][0]+s2[1][0])/2)}`)
}
void sub; void byId

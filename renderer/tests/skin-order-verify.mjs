// skin-order-verify.mjs — 验证蒙皮矩阵顺序（官方行向量语义）
//   正确: g_Bones[b] = bindInv[b] × W_anim[b]  → 顶点绕**骨骼枢轴**刚性旋转
//   错误: g_Bones[b] = W_anim[b] × bindInv[b]  → 不保持"到骨骼动点距离=到绑定点距离"
// 判据: 对 weight≈1 的顶点，|v' − 骨骼动点| 应等于 |v − 骨骼绑定点|（允许 1e-3 相对误差）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const id = process.argv[2] || '3719111841'
const want = process.argv[3] || '主体'
const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${MPW_WS}/allwallpaper/dd/${id}/scene.pkg`)))
const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
const dec = new TextDecoder()
const H = {}
installPuppet(H)
const scene = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')))

let mesh = null
for (const l of scene.layers) {
  if (l.name !== want || !l.image) continue
  const mj = JSON.parse(dec.decode(entry(l.image)))
  const raw = entry(mj.puppet)
  mesh = H._parseMdl(new MpwBuffer(raw.buffer, raw.byteOffset, raw.byteLength))
}
if (!mesh) { console.log('未找到 puppet 层 ' + want); process.exit(1) }
const nb = mesh.bones.length
const bindWorld = new Array(nb), bindInv = new Array(nb)
for (let b = 0; b < nb; b++) {
  const p = mesh.bones[b].parent, lo = mesh.bones[b].bind
  bindWorld[b] = (p >= 0 && bindWorld[p]) ? H._matMulRow(bindWorld[p], lo) : lo.slice()
}
for (let b = 0; b < nb; b++) bindInv[b] = H._matInvertRow(bindWorld[b])

// 顶点与权重
const pos = [], bi = [], bw = []
for (let i = 0; i < mesh.positions.length; i++) {
  pos.push(mesh.positions[i]); bi.push(mesh.blendIndices[i]); bw.push(mesh.blendWeights[i])
}
function poseMats(frame) {
  const rt = H._sampleAnimRT(mesh, mesh.animations[0], frame, nb, mesh.bones)
  return rt.map((p) => {
    const c = Math.cos(p.angle), s = Math.sin(p.angle)
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, p.tx, p.ty, 0, 1]
  })
}
const apply = (m, x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]

let n = 0, errCorrect = 0, errOld = 0, worstOld = 0
for (const frame of [0, 30, 90, 150]) {
  const W = poseMats(frame)
  for (let i = 0; i < pos.length; i += 7) {   // 抽样
    for (let k = 0; k < 4; k++) {
      const b = bi[i][k], w = bw[i][k]
      if (!(w > 0.9) || b >= nb) continue
      const v = pos[i]
      const pBind = [bindWorld[b][12], bindWorld[b][13]]
      const pAnim = [W[b][12], W[b][13]]
      const dBind = Math.hypot(v[0] - pBind[0], v[1] - pBind[1])
      // 正确：v × bindInv × W
      const lv = apply(bindInv[b], v[0], v[1])
      const vc = apply(W[b], lv[0], lv[1])
      const dC = Math.hypot(vc[0] - pAnim[0], vc[1] - pAnim[1])
      // 错误：v × W × bindInv
      const lvW = apply(W[b], v[0], v[1])
      const vw = apply(bindInv[b], lvW[0], lvW[1])
      const dW = Math.hypot(vw[0] - pAnim[0], vw[1] - pAnim[1])
      n++
      errCorrect = Math.max(errCorrect, Math.abs(dC - dBind))
      errOld = Math.max(errOld, Math.abs(dW - dBind))
      worstOld = Math.max(worstOld, dW)
    }
  }
}
console.log(`[${id}] ${want}: 骨骼=${nb} 顶点=${pos.length} 采样(weight>0.9)=${n}`)
console.log(`  正确顺序 bindInv×W : 到骨骼枢轴距离的最大误差 = ${errCorrect.toFixed(4)}  → ${errCorrect < 1e-3 ? '刚性旋转 ✓' : '异常 ✗'}`)
console.log(`  旧顺序   W×bindInv : 最大误差 = ${errOld.toFixed(1)}（错误顺序会把顶点甩到离枢轴 ${worstOld.toFixed(0)} 处）`)
process.exit(errCorrect < 1e-3 ? 0 : 1)

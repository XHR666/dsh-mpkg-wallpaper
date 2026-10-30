/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // core/puppet-skin.js —— WE puppet 骨骼蒙皮（独立实现，供 WebGL GPU 蒙皮使用）
// 语义来源：wer-ref assets/shaders/base/model_vertex_v1.h::ApplySkinningPosition
//   position' = mul(vec4(position,1), Σ w_i · g_Bones[blendIndices_i])
//   g_Bones[b] = bindInv[b] × Rz(finalWorld[b])（行主序），蒙皮后再乘 g_ModelMatrix
//   ⚠ ①(P-110 2026-09-17) **本行的顺序是判据定的，不是抄来的**：`bindInv × m` 与 `m × bindInv` 在
//   "静止帧（姿态=bind）"下**都给单位阵**（互为逆阵 ⇒ 两个顺序都满足"静止帧必须等于 bind 姿态"这条恒等式），
//   所以**静止帧恒等式不能判序**。能判序的是"绕骨骼枢轴的刚性旋转"恒等式（row-vector 语义）：
//     顶点 v 的绑定位姿在骨 b 的 bind 世界位姿 W_bind[b] 下的局部坐标 = v × bindInv[b]；再乘当前世界位姿
//     W_anim[b] 回到模型空间 ⇒ 对"该骨主导（w≈1）"的顶点必有 |v − P_bind| == |v' − P_anim|
//     （P = 各自的世界平移）。实测（tests/bind-order-test.mjs TN3 + tests/skin-order-verify.mjs）：
//     `bindInv × m` 误差 ≤1e-3（刚性）✓，`m × bindInv` 把顶点甩到离枢轴几十~几百 px 处 ✗。
//     官方着色器 `position' = position × Σw·g_Bones` 也只有在 `g_Bones = bindInv × finalWorld` 时
//     才是标准 LBS（v_bind × W_bind⁻¹ × W_anim）。elysia 移植的 `elysia/we-renderer/puppet.js:174`
//     写的是 `m × bindInv`（上游 main 的同类缺陷；本仓库 demo.html 已于 P-42 修为 `bindInv × m`）。
// 骨骼/动画还原算法对齐 /tmp/elysia-run/lib/we-renderer/puppet.js（_parseMdl/_sampleAnimRT/_skinPuppet）
export function indexOfBytes(buf, str, from = 0) {
  const n = str.length
  for (let i = from; i + n <= buf.length; i++) {
    let ok = true
    for (let k = 0; k < n; k++) if (buf[i + k] !== str.charCodeAt(k)) { ok = false; break }
    if (ok) return i
  }
  return -1
}
const str = (buf, a, b) => { let s = ''; for (let i = a; i < b; i++) s += String.fromCharCode(buf[i]); return s }
export function parseMdlStatic(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf.length < 16 || str(buf, 0, 4) !== 'MDLV') return null
  const matStart = indexOfBytes(buf, 'materials/', 8)
  if (matStart < 0) return null
  let matEnd = matStart
  while (matEnd < buf.length && buf[matEnd] !== 0) matEnd++
  const f0 = dv.getUint32(matEnd + 1, true)
  const vertBytes = dv.getUint32(matEnd + 5, true)
  const vertStart = matEnd + 9
  if (vertBytes <= 0 || vertStart + vertBytes > buf.length) return null
  const vertexCount = f0
  const stride = Math.max(1, Math.round(vertBytes / vertexCount))
  if (stride < 32 || stride > 256) return null
  // 索引段：顶点段之后（u32 索引数 + u32 索引）
  let p = vertStart + vertBytes
  let indexCount = 0, indexStart = 0, idx32 = false
  for (let k = 0; k < 6 && p + 8 <= buf.length; k++) {
    const cnt = dv.getUint32(p, true)
    if (cnt > 0 && cnt < 4_000_000) { indexCount = cnt; indexStart = p + 8; break }
    p += 4
  }
  if (!indexCount) { indexCount = dv.getUint32(p, true); indexStart = p + 4 }
  const indexU16 = dv.getUint32(indexStart, true)
  if (indexU16 > 0 && indexU16 < 4_000_000) { /* u16 索引数 */ } else idx32 = true
  // MDLS 骨骼块
  const mdls = indexOfBytes(buf, 'MDLS', 9)
  const positions = [], uvs = [], blendIndices = [], blendWeights = [], indices = []
  for (let i = 0; i < vertexCount; i++) {
    const o = vertStart + i * stride
    if (o + 12 > buf.length) break
    positions.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)])
    // uv / 骨骼索引 / 权重：按 elysia 解析结果所在偏移读取（stride=80 时 uv@+12? 由调用方覆盖）
    if (o + stride >= 20) uvs.push([dv.getFloat32(o + stride - 20, true), dv.getFloat32(o + stride - 16, true)])
    else uvs.push([0, 0])
    if (o + stride >= 16) {
      blendIndices.push([dv.getUint8(o + stride - 16), dv.getUint8(o + stride - 15), dv.getUint8(o + stride - 14), dv.getUint8(o + stride - 13)])
      blendWeights.push([dv.getFloat32(o + stride - 12, true), dv.getFloat32(o + stride - 8, true), dv.getFloat32(o + stride - 4, true), 0])
    } else { blendIndices.push([0, 0, 0, 0]); blendWeights.push([1, 0, 0, 0]) }
  }
  for (let i = 0; i < indexCount; i++) {
    const o = indexStart + i * 2
    if (o + 2 > buf.length) break
    indices.push(dv.getUint16(o, true))
  }
  return { positions, uvs, indices, blendIndices, blendWeights, vertexCount, stride, mdlsOffset: mdls, raw: buf }
}
// ── bind 世界链（①P-110 2026-09-17：**唯一实现处**，三处调用点共用）──
// 为什么需要"唯一实现处"：bind 世界链原先在 4 个地方各写了一遍（`core/attach-transform.mjs`
//   `puppetBoneFinal`、`core/we-scene-bundle.js` 的 `?bones=` 探针、`demo.html` 的 `updateSkinBones`
//   预计算、以及镜像它的若干测试），**四处都必须与 `sampleAnimRT` 的动画链同空间**，一旦有一处不同步
//   就会重现 P-109.3 的"错序基准 + 正确序增量"错配。故收敛到本函数。
// 语义（行主序 = DirectX/HLSL 行向量约定，`matMulRow(A,B)` 在数学上就是 A·B）：
//   局部量 `bones[b].bind` 是"在**父骨坐标系**里的位姿"（`sampleAnimRT` 明确按此解释：
//   子骨平移被父骨角度旋转后加到父骨世界上）⇒ 世界位姿必须**子先乘**：
//        W[b] = L_b × W[parent] = matMulRow(L_b, W[parent])
//   直觉：顶点 v（行向量）先 × L_b 进父空间，再 × W[parent] 进模型空间；等价于层级链 W = L_b·W_parent。
// legacy（①P-110 之前的写法，**只作 A/B 回退**，见 `?bindorder=legacy`）：
//        W[b] = W[parent] × L_b = matMulRow(W[parent], L_b)
//   —— 这不是"另一种画风"而是**错序**：它把局部量当"在世界坐标里绕原点后置"解释，与动画链
//   （`sampleAnimRT` 子先乘）不在同一空间。实测 hina 3554161528：与"动画帧 0"（该帧逐骨局部量
//   == `bind` 局部量 ⇒ 两个链必须给出同一世界姿势）最大差 **340.76px**、平均 122.1px；换成子先乘
//   后 32 骨 **maxΔ=0.0000px**。静止帧看不出来（`gBones = bindInv × bindRT = I` 两种序都成立），
//   一走动就把"错序基准"与"正确序增量"相加 ⇒ 眉毛整组翻转（P-109.2/P-110.2）。
// bones：`[{parent, bind:[16]}]`（`core/attach-transform.mjs` 与 `elysia/we-renderer/puppet.js`
//   两种解析器的骨对象都兼容）；假定骨数组已按父先子后排列（两个解析器都成立）。
const IDENT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export function bindWorldChain(bones, opts = {}) {
  const nb = (bones && bones.length) || 0
  const legacy = !!(opts && (opts.legacy === true || opts.bindOrder === 'legacy'))
  const out = new Array(nb)
  for (let b = 0; b < nb; b++) {
    const bone = bones[b]
    const parent = bone ? bone.parent : -1
    const local = Array.from((bone && bone.bind) || IDENT4)
    const pw = (parent >= 0 && parent < nb && out[parent]) ? out[parent] : null
    out[b] = pw ? (legacy ? matMulRow(pw, local) : matMulRow(local, pw)) : local
  }
  return out
}
// bind 世界位姿 → 逐骨 {angle, tx, ty}（additive 合成的基准；与 `sampleAnimRT` 的输出同空间）
export function bindWorldPolar(worlds) {
  return (worlds || []).map((m) => ({ angle: Math.atan2(m[1], m[0]), tx: m[12], ty: m[13] }))
}
// ①(P-110) `?bindorder=legacy` 的**唯一判定式**（与既有 `?parspace=legacy` 同形：正则字面量，
//   由 `tests/diag-flag-check.mjs` 的规则 c 抓取）。缺省/任何其它值 = 修正后的"子先乘"。
export function bindOrderLegacy(search) {
  const s = (search === undefined || search === null) ? '' : String(search)
  return /[?&]bindorder=legacy/.test(s)
}

// 行主序 4x4
export function matMulRow(a, b) {
  const o = new Array(16)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c]
  }
  return o
}
export function matInvertRow(m) {
  const inv = new Array(16)
  const a = m
  inv[0] = a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10]
  inv[4] = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10]
  inv[8] = a[4]*a[9]*a[15] - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9]
  inv[12] = -a[4]*a[9]*a[14] + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9]
  inv[1] = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10]
  inv[5] = a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10]
  inv[9] = -a[0]*a[9]*a[15] + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9]
  inv[13] = a[0]*a[9]*a[14] - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9]
  inv[2] = a[1]*a[6]*a[15] - a[1]*a[7]*a[14] - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7] - a[13]*a[3]*a[6]
  inv[6] = -a[0]*a[6]*a[15] + a[0]*a[7]*a[14] + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7] + a[12]*a[3]*a[6]
  inv[10] = a[0]*a[5]*a[15] - a[0]*a[7]*a[13] - a[4]*a[1]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7] - a[12]*a[3]*a[5]
  inv[14] = -a[0]*a[5]*a[14] + a[0]*a[6]*a[13] + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6] + a[12]*a[2]*a[5]
  inv[3] = -a[1]*a[6]*a[11] + a[1]*a[7]*a[10] + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7] + a[9]*a[3]*a[6]
  inv[7] = a[0]*a[6]*a[11] - a[0]*a[7]*a[10] - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7] - a[8]*a[3]*a[6]
  inv[11] = -a[0]*a[5]*a[11] + a[0]*a[7]*a[9] + a[4]*a[1]*a[11] - a[4]*a[3]*a[9] - a[8]*a[1]*a[7] + a[8]*a[3]*a[5]
  inv[15] = a[0]*a[5]*a[10] - a[0]*a[6]*a[9] - a[4]*a[1]*a[10] + a[4]*a[2]*a[9] + a[8]*a[1]*a[6] - a[8]*a[2]*a[5]
  const det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12]
  if (!det) return a.slice()
  for (let i = 0; i < 16; i++) inv[i] /= det
  return inv
}

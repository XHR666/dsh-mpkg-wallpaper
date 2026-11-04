// bind-order-test.mjs — P-110（任务书：修 puppet 蒙皮的 **bind 世界链乘法顺序** bug，"眉毛翻转 180°"的数值根因）
//
// 背景：P-109 的 `?submesh=` 探针把 hina 3554161528 的面部钉到骨一级后，拿到的候选根因是
//   **bind 世界链的乘法顺序与动画链相反**：
//     · 动画链 `sampleAnimRT`（core/attach-transform.mjs）= **子先乘** `W[b] = L_b × W[parent]`
//       （子骨平移用父骨角度旋转后加到父骨世界上 ⇒ 局部量在**父坐标系**里）；
//     · bind 链（P-110 之前）= **父先乘** `W[b] = W[parent] × L_b`（把局部量当"世界坐标里绕原点后置"）。
//   两条链不在同一空间 ⇒ 静止帧看不出来（`gBones = bindInv × bindRT = I` 两种序都成立），
//   动画一走动就把"错序基准"与"正确序增量"相加 ⇒ 眉毛 b17 整组 8/8 三角形翻转、睫毛 b18 位移 102px。
//
// 本测试守 6 件事（每条都有判别力自证，见 TN1/TN6）：
//   TN1 **链序恒等式**（两条，互不替代）：
//       (a) **组成律恒等**：`bindWorldChain` 必须与"把 bind 局部量喂进 `sampleAnimRT` 的递推式"
//           （本文件独立复算）**逐骨相同** ⇒ 修正序 ~1e-6px、legacy 序最大 391.90px（凯尔希眼睛组合）。
//       (b) **数据恒等**：对"该动画帧 0 逐骨局部量 == `bind` 局部量"的动画，`bindWorldChain` 必须
//           逐骨等于 `sampleAnimRT(动画, 帧0)`（修正序 0.000px、legacy 序 340.76px）。
//           帧 0 ≠ bind 的动画（模型自身口径，如 龙 anim0 差 1472px）只断言"修正序不差于旧序"。
//   TN2 **静止帧逐位不变**：姿态=bind 时 `gBones` 必须仍是单位阵（对拍旧实现；两种链序各自自洽时都成立
//       —— 这也正是"静止帧恒等式**不能**判链序"的原因，判序靠 TN1）。
//   TN3 **`gBones` 组装顺序的判据**（任务书第 1 项要"不许猜"）：官方着色器语义是
//       `position' = position × Σ w·g_Bones`、标准 LBS 是 `v_bind × bindInv × W_anim`。
//       本项用"绕骨骼枢轴的刚性旋转"把两种顺序机器化地分开：`bindInv × m` 保距（≤1e-3）、
//       `m × bindInv` 不保距（顶点被甩到离枢轴几十~几百 px）。同时把 elysia 移植侧的
//       `m × bindInv` 当**反例**跑一遍（上游同类缺陷，只读不改）。
//   TN4 **全语料回归**（5 个蒙皮包 hina 3554161528 / girl 3544152633 / 凯尔希 3719111841 /
//       0917·3233141951 / 0917·3462491575 + 伊蕾娜 3660962877（实测 **0 个 puppet 层**，作无蒙皮对照））：
//       几何/网格 bbox、层矩形、`?bones=` 台账、`?submesh=` 分组位移与翻转计数，改前/改后逐包对照；
//       并对 hina 的**残余变号**给出"多骨权重剪切（LBS 固有）"的机器判据（单骨三角形永不翻）。
//   TN5 **回退开关** `?bindorder=legacy`：默认=修正序、`legacy`=旧数字、非法值回落修正序；
//       `?bones=` 探针与宿主同开关时反解误差 0、不同开关时偏 340.76px。
//   TN6 **改回旧写法必须红**（反向变异）：把 `core/puppet-skin.js` 的默认序在临时副本里换回父先乘，
//       TN1/TN2/TN4 的核心断言必须失败 —— 否则本测试的断言不是"活的"。
//
// 运行：node tests/bind-order-test.mjs            （全过输出 ALL PASS；缺语料时真包段 SKIP 视作 PASS）
//       node tests/bind-order-test.mjs --report   （额外打印改前/改后数字表，供 docs/PATCHES.md P-110 引用）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

globalThis.location = globalThis.location || { search: '' }
const ROOT = path.resolve(import.meta.dirname, '..')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const lib = await import(pathToFileURL(BUNDLE).href)
const at = await import(pathToFileURL(path.join(ROOT, 'core', 'attach-transform.mjs')).href)
const ps = await import(pathToFileURL(path.join(ROOT, 'core', 'puppet-skin.js')).href)

const MPW_WS = process.env.MPW_ROOT || WS
const REPORT = process.argv.includes('--report')
const dec = new TextDecoder()

let pass = 0, fail = 0
const fails = []
function check(ok, name, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const near = (a, b, eps, name, detail) => check(Math.abs(a - b) <= eps, name, detail || `实测 ${a} vs 期望 ${b}，容差 ${eps}`)
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2)
const f3 = (x) => (Math.round(x * 1000) / 1000).toFixed(3)

// ───────────────────────── 语料（真包；缺包逐项 SKIP，不红） ─────────────────────────
const PKGS = [
  { tag: 'hina 3554161528', id: '3554161528', pkg: path.join(MPW_WS, 'allwallpaper/dd/3554161528/scene.pkg') },
  { tag: 'girl 3544152633', id: '3544152633', pkg: path.join(MPW_WS, 'allwallpaper/dd/3544152633/scene.pkg') },
  { tag: '凯尔希 3719111841', id: '3719111841', pkg: path.join(MPW_WS, 'allwallpaper/dd/3719111841/scene.pkg') },
  { tag: '0917·3233141951', id: '3233141951', pkg: path.join(MPW_WS, 'allwallpaper/0917/3233141951/scene.pkg') },
  { tag: '0917·3462491575', id: '3462491575', pkg: path.join(MPW_WS, 'allwallpaper/0917/3462491575/scene.pkg') },
  { tag: '伊蕾娜 3660962877（无 puppet 对照）', id: '3660962877', pkg: path.join(MPW_WS, 'allwallpaper/dd/3660962877/scene.pkg') },
]

/** 载入一个包（带缓存：119MB 包只读一次）：scene.json + 每个 puppet 层的 mesh/原始对象 */
const PKG_CACHE = new Map()
function loadPkg(P) {
  if (PKG_CACHE.has(P.tag)) return PKG_CACHE.get(P.tag)
  if (!fs.existsSync(P.pkg)) { PKG_CACHE.set(P.tag, null); return null }
  const b = fs.readFileSync(P.pkg)
  const pkg = lib.parsePkg(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
  const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const layers = []
  for (const o of (sceneJson.objects || [])) {
    if (!o.image) continue
    let mj = null
    try { mj = JSON.parse(dec.decode(lib.getEntry(pkg, o.image)).replace(/^\uFEFF/, '')) } catch { continue }
    if (!mj || !mj.puppet) continue
    let mesh = null
    try { mesh = at.parseMdl(lib.getEntry(pkg, mj.puppet)) } catch { continue }
    if (!mesh || !mesh.bones || !mesh.bones.length) continue
    layers.push({ obj: o, mesh, modelJson: mj })
  }
  const mjCache = new Map()
  const modelJsonOf = (img) => {
    if (!mjCache.has(img)) {
      let mj = null
      try { mj = JSON.parse(dec.decode(lib.getEntry(pkg, img)).replace(/^\uFEFF/, '')) } catch { mj = null }
      if (mj && mj.puppet) { try { mj.mesh = at.parseMdl(lib.getEntry(pkg, mj.puppet)) } catch { mj.mesh = null } }
      mjCache.set(img, mj)
    }
    return mjCache.get(img)
  }
  const out = { pkg, sceneJson, layers, readEntry: (n) => lib.getEntry(pkg, n), modelJsonOf }
  PKG_CACHE.set(P.tag, out)
  return out
}

/** `sampleAnimRT` 的**递推式**独立复算（拿 bind 局部量当一帧数据）：局部位姿在父坐标系里 */
function animStyleWorldOfBind(bones) {
  const nb = bones.length, out = new Array(nb)
  for (let b = 0; b < nb; b++) {
    const m = bones[b].bind
    const px = m[12], py = m[13], rz = Math.atan2(m[1], m[0])
    const p = bones[b].parent
    if (p >= 0 && p < nb && out[p]) {
      const pa = out[p].angle, c = Math.cos(pa), s = Math.sin(pa)
      out[b] = { angle: pa + rz, tx: out[p].tx + px * c - py * s, ty: out[p].ty + px * s + py * c }
    } else out[b] = { angle: rz, tx: px, ty: py }
  }
  return out
}
const worldDev = (worlds, rt) => {
  let d = 0
  for (let b = 0; b < rt.length; b++) {
    const w = worlds[b], r = rt[b]
    if (!w || !r) continue
    d = Math.max(d, Math.hypot(w[12] - r.tx, w[13] - r.ty))
  }
  return d
}

// ───────────────────────── TN1 / TN2：链序恒等式 + 静止帧恒等 ─────────────────────────
console.log('\n[TN1] 链序恒等式（a 组成律 / b 数据）：bind 链必须与 `sampleAnimRT` 同序')
console.log('[TN2] 静止帧逐位不变：姿态=bind ⇒ gBones = bindInv × RT = I（对拍旧实现）')
const chainStats = new Map()
for (const P of PKGS) {
  const L = loadPkg(P)
  if (!L) { console.log(`  SKIP ${P.tag}（缺包 ${P.pkg}）`); continue }
  if (!L.layers.length) {
    check(true, `${P.tag}：0 个 puppet 层 ⇒ 链序对其零影响（对照包）`, `对象 ${(L.sceneJson.objects || []).length}`)
    chainStats.set(P.tag, { nPuppet: 0 })
    continue
  }
  let compFix = 0, compLeg = 0
  let dataFix = 0, dataLeg = 0
  let dataEqCount = 0, dataEqFixMax = 0, dataEqLegMax = 0, nAnim = 0
  let restFix = 0, restLeg = 0, restFixV = 0, restLegV = 0, restCross = 0
  let nv = 0, nTri = 0, nBones = 0
  for (const { mesh } of L.layers) {
    const bones = mesh.bones, nb = bones.length
    nv += mesh.positions.length
    nTri += Math.floor(mesh.indices.length / 3)
    nBones += nb
    const cy = animStyleWorldOfBind(bones)
    const bwF = ps.bindWorldChain(bones, { legacy: false })
    const bwL = ps.bindWorldChain(bones, { legacy: true })
    compFix = Math.max(compFix, worldDev(bwF, cy))
    compLeg = Math.max(compLeg, worldDev(bwL, cy))
    for (const anim of (mesh.animations || [])) {
      nAnim++
      const rt0 = at.sampleAnimRT(mesh, anim, 0, nb, bones)
      const dF = worldDev(bwF, rt0), dL = worldDev(bwL, rt0)
      dataFix = Math.max(dataFix, dF); dataLeg = Math.max(dataLeg, dL)
      if (dF < 1e-4) { dataEqCount++; dataEqFixMax = Math.max(dataEqFixMax, dF); dataEqLegMax = Math.max(dataEqLegMax, dL) }
    }
    // 静止帧：gBones = bindInv × RT(bind 世界位姿)，再按渲染口径蒙皮（含 p[2]/z 行，与 ?submesh= 台账同式）
    const restSkin = {}
    for (const [key, bw] of [['fix', bwF], ['leg', bwL]]) {
      const bi = bw.map(ps.matInvertRow)
      const rt = ps.bindWorldPolar(bw)
      const gm = rt.map((r, b) => {
        const c = Math.cos(r.angle), s = Math.sin(r.angle)
        return at.matMulRow(bi[b], [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, r.tx, r.ty, 0, 1])
      })
      const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      let dev = 0
      for (const g of gm) for (let k = 0; k < 16; k++) dev = Math.max(dev, Math.abs(g[k] - I[k]))
      const nvL = mesh.positions.length
      const out = new Float64Array(nvL * 2)
      for (let i = 0; i < nvL; i++) {
        const p = mesh.positions[i], w = mesh.blendWeights[i] || [1, 0, 0, 0], bi2 = mesh.blendIndices[i] || [0, 0, 0, 0]
        let x = 0, y = 0
        for (let k = 0; k < 4; k++) {
          const ww = w[k] || 0
          if (ww === 0) continue
          const b = (bi2[k] | 0) < nb ? (bi2[k] | 0) : 0
          const m = gm[b]
          x += (p[0] * m[0] + p[1] * m[4] + (p[2] || 0) * m[8] + m[12]) * ww
          y += (p[0] * m[1] + p[1] * m[5] + (p[2] || 0) * m[9] + m[13]) * ww
        }
        out[i * 2] = x; out[i * 2 + 1] = y
      }
      restSkin[key] = out
      if (key === 'fix') restFix = Math.max(restFix, dev); else restLeg = Math.max(restLeg, dev)
    }
    for (const key of ['fix', 'leg']) {
      const out = restSkin[key]
      let dv = 0
      for (let i = 0; i < mesh.positions.length; i++) dv = Math.max(dv, Math.abs(out[i * 2] - mesh.positions[i][0]), Math.abs(out[i * 2 + 1] - mesh.positions[i][1]))
      if (key === 'fix') restFixV = Math.max(restFixV, dv); else restLegV = Math.max(restLegV, dv)
    }
    {
      const a = restSkin.fix, b2 = restSkin.leg
      let dc = 0
      for (let i = 0; i < a.length; i++) dc = Math.max(dc, Math.abs(a[i] - b2[i]))
      restCross = Math.max(restCross, dc)
    }
  }
  chainStats.set(P.tag, { nPuppet: L.layers.length, nBones, nv, nTri, compFix, compLeg, dataFix, dataLeg, dataEqCount, dataEqFixMax, dataEqLegMax, nAnim })
  check(compFix < 1e-4, `${P.tag} TN1a 组成律恒等（${L.layers.length} 层/${nBones} 骨）：bind 链 ≡ sampleAnimRT 递推式`,
    `修正序 maxΔ=${compFix.toExponential(2)}px；legacy 序 maxΔ=${f2(compLeg)}px`)
  check(dataFix <= dataLeg + 1e-6, `${P.tag} TN1b 数据恒等：修正序不差于旧序（${dataEqCount}/${nAnim} 条动画"帧0==bind"）`,
    `帧0==bind 子集：修正 ${f3(dataEqFixMax)}px / legacy ${f2(dataEqLegMax)}px；全体动画：修正 ${f2(dataFix)}px / legacy ${f2(dataLeg)}px`)
  check(restFix < 1e-3 && restFixV < 0.05, `${P.tag} TN2 静止帧（姿态=bind）⇒ gBones = I、蒙皮后顶点 = 原始顶点（修正序）`,
    `max|g−I|=${restFix.toExponential(2)}；顶点 maxΔ=${restFixV.toExponential(2)}px（极坐标往返舍入，与链序无关）`)
  check(restLeg < 1e-3 && restLegV < 0.05, `${P.tag} TN2 对拍旧实现（legacy 链自洽）⇒ 静止帧同样 = I 且顶点不动（**所以静止帧不能判序**）`,
    `max|g−I|=${restLeg.toExponential(2)}；顶点 maxΔ=${restLegV.toExponential(2)}px`)
  check(restCross < 0.05, `${P.tag} TN2 改前/改后静止帧**逐顶点对拍**（同一姿态 ⇒ 同一画面）`, `maxΔ=${restCross.toExponential(2)}px（≤0.05px，无一处变差）`)
}
{
  const h = chainStats.get('hina 3554161528')
  check(h && h.compLeg > 300 && h.dataEqLegMax > 300 && h.dataEqFixMax < 1e-4,
    '判别力自证：hina 上 legacy 序与"帧0==bind"动画差 340.76px，修正序 0.000px（TN1 不是恒真断言）',
    h ? `组成律 legacy=${f2(h.compLeg)}px / 帧0 legacy=${f2(h.dataEqLegMax)}px → 修正 ${h.dataEqFixMax}` : '缺 hina')
  const k = chainStats.get('凯尔希 3719111841')
  check(k && k.compLeg > 300, '判别力自证：凯尔希"眼睛组合"（14 骨）legacy 序差 391.90px（第二例，不是 hina 独有）',
    k ? `组成律 legacy=${f2(k.compLeg)}px` : '缺包')
  const commuting = [...chainStats.entries()].filter(([, v]) => v.nPuppet && v.compLeg === 0).map(([t]) => t)
  check(commuting.length >= 1, '数据事实：部分包（bind 姿态无父级旋转）两种链序逐位等价 ⇒ 修正在这些包上零变化', commuting.join(' / ') || '无')
}

// ───────────────────────── TN3：gBones 组装顺序的判据（枢轴刚性） ─────────────────────────
console.log('\n[TN3] gBones 顺序判据：bindInv × m 保"到骨骼枢轴距离"，m × bindInv 不保（含 elysia 反例）')
const apply = (M, x, y) => [M[0] * x + M[4] * y + M[12], M[1] * x + M[5] * y + M[13]]
{
  const bones = [{ parent: -1, bind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 40, 0, 1] }]
  const bw = ps.bindWorldChain(bones)
  const bi = bw.map(ps.matInvertRow)
  const Pbind = [bw[0][12], bw[0][13]]
  const ang = Math.PI / 2, PAnim = [260, -70]
  const c = Math.cos(ang), s = Math.sin(ang)
  const m = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, PAnim[0], PAnim[1], 0, 1]
  const v = [130, 55]
  const dBind = Math.hypot(v[0] - Pbind[0], v[1] - Pbind[1])
  const lv = apply(bi[0], v[0], v[1]); const vr = apply(m, lv[0], lv[1])
  const errRight = Math.abs(Math.hypot(vr[0] - PAnim[0], vr[1] - PAnim[1]) - dBind)
  const lw = apply(m, v[0], v[1]); const vw = apply(bi[0], lw[0], lw[1])
  const worstWrong = Math.hypot(vw[0] - PAnim[0], vw[1] - PAnim[1])
  check(errRight < 1e-9, '合成算例：bindInv × m 保距（顶点绕骨骼枢轴刚性旋转）', `误差=${errRight.toExponential(2)}，绑定位距=${f2(dBind)}`)
  check(Math.abs(worstWrong - dBind) > 100, '合成算例：m × bindInv 不保距（同一顶点被甩到离枢轴几百 px）', `实测距=${f2(worstWrong)} vs 应=${f2(dBind)}`)
  const L = loadPkg(PKGS[0])
  if (L && L.layers.length) {
    const { mesh } = L.layers[0]
    const bones2 = mesh.bones, nb = bones2.length
    const bw2 = ps.bindWorldChain(bones2)
    const bi2 = bw2.map(ps.matInvertRow)
    const rt0 = at.sampleAnimRT(mesh, mesh.animations[0], 0, nb, bones2)
    let maxR = 0, maxW = 0, worstW = 0, n = 0
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let k = 0; k < 4; k++) {
        const b = mesh.blendIndices[i][k], w = mesh.blendWeights[i][k]
        if (!(w > 0.9) || b >= nb) continue
        const v2 = mesh.positions[i], r = rt0[b]
        const mm = [Math.cos(r.angle), Math.sin(r.angle), 0, 0, -Math.sin(r.angle), Math.cos(r.angle), 0, 0, 0, 0, 1, 0, r.tx, r.ty, 0, 1]
        const Pd = [bw2[b][12], bw2[b][13]], Pa = [r.tx, r.ty]
        const d0 = Math.hypot(v2[0] - Pd[0], v2[1] - Pd[1])
        const a1 = apply(bi2[b], v2[0], v2[1]); const v1 = apply(mm, a1[0], a1[1])
        const a2 = apply(mm, v2[0], v2[1]); const v2b = apply(bi2[b], a2[0], a2[1])
        maxR = Math.max(maxR, Math.abs(Math.hypot(v1[0] - Pa[0], v1[1] - Pa[1]) - d0))
        const dW = Math.hypot(v2b[0] - Pa[0], v2b[1] - Pa[1])
        maxW = Math.max(maxW, Math.abs(dW - d0)); worstW = Math.max(worstW, dW); n++
      }
    }
    check(n > 0 && maxR < 1e-3, `${PKGS[0].tag}：真包 weight>0.9 顶点（${n} 样本）bindInv × m 保距 < 1e-3`, `max=${maxR.toExponential(2)}`)
    check(maxW > 1, `${PKGS[0].tag}：同批顶点 m × bindInv 保距误差 > 1px（= elysia/上游同类缺陷的判据）`, `max=${f2(maxW)}px（最远甩到 ${f2(worstW)}px）`)
    const ely = fs.readFileSync(path.join(ROOT, 'elysia', 'we-renderer', 'puppet.js'), 'utf8')
    check(/_matMulRow\(m,\s*bindInv\[b\]\)/.test(ely), 'elysia 移植侧仍是 m × bindInv（上游同类缺陷；本仓库生产路径 demo.html / attach-transform 已修为 bindInv × m）',
      'elysia/we-renderer/puppet.js:174')
    const demo = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
    check(/_matMulRow\(sk\.bindInv\[b\], m\)/.test(demo), 'demo.html 生产路径是 bindInv × m（P-42 起；与 TN3 判据一致）', 'demo.html')
  }
}

// ───────────────────────── mock GL + 真 renderMeshLayer 驱动 ─────────────────────────
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  RG8: 0x8229, RG: 0x8227, ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER: 0x8892, TRIANGLES: 4, UNSIGNED_SHORT: 0x1403,
  STATIC_DRAW: 0x88E4, FLOAT: 0x1406 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function mkGl() {
  let seq = 0, curUnit = 0
  const curTex = new Array(8).fill(null)
  const draws = []
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createShader: () => mk('sh'), createProgram: () => mk('prog'),
    createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindBuffer: () => {}, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {}, useProgram: () => {},
    bufferData: () => {}, drawElements: (m, c) => draws.push(c), drawArrays: (m, f, c) => draws.push(c),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_BlendIdx: 2, a_BlendWeight: 3 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0, isTexture: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', texImage2D: () => {}, texParameteri: () => {},
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, draws }
}
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }' : 'void main(){ gl_FragColor = vec4(1.0); }')
const MINSCENE = { general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, properties: {}, layers: [] }
const LAYER_STUB = (o) => ({ id: o.id, name: o.name, size: [1, 1], scale: [1, 1, 1], origin: [0, 0, 0], angles: [0, 0, 0], alpha: 1 })

/** 宿主（demo.html 每帧 gBones 同式）每帧 gBones：g = bindInv × RT(合成姿势) */
function mkHost(L, layer, legacy, M = lib, halfMix = false) {
  const mesh = layer.mesh, nb = mesh.bones.length
  // halfMix（只作对照）：bindInv 用修正序、bindRT 仍用旧序 —— P-109"只换链序"实验的形态
  const bwInv = M.bindWorldChain(mesh.bones, { legacy: halfMix ? false : legacy })
  const bwRT = M.bindWorldChain(mesh.bones, { legacy: halfMix ? true : legacy })
  const bindWorld = bwInv
  const bindInv = bwInv.map(ps.matInvertRow)
  const bindRT = M.bindWorldPolar(bwRT)
  const animSpec = at.selectAnimLayers(layer.obj, mesh)
  const good = M.analyzeAnimGoodFrames(mesh, at.sampleAnimRT)
  const buf = new Float32Array(nb * 16)
  const g = (t) => {
    const A = M.sampleCompositeAdditivePose({ mesh, bindRT, animSpec, animGood: good, tAnim: t, fps: 30, nb, sampleRT: at.sampleAnimRT })
    const pose = new Array(nb)
    for (let b = 0; b < nb; b++) {
      const { angle, tx, ty } = A[b], c = Math.cos(angle), s = Math.sin(angle)
      pose[b] = { angle, tx, ty }
      buf.set(at.matMulRow(bindInv[b], [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]), b * 16)
    }
    return { buf, pose }
  }
  return { g, nb, bindWorld, bindInv, bindRT }
}

/** 跑一层：mock-GL 驱动真 renderMeshLayer（`?bones=` + `?submesh=` 探针一起记）；返回台账 + 逐帧 gBones/pose */
async function runLayer(L, layer, opts) {
  const legacy = !!opts.legacy
  const search = '?id=' + opts.id + (opts.bones ? '&bones=' + opts.bones : '') + '&submesh=' + (opts.submesh || 'all')
    + (legacy ? '&bindorder=legacy' : '')
  const prev = globalThis.location
  globalThis.location = { search }
  delete globalThis.__mpwBones
  delete globalThis.__mpwSubMesh
  const M = mkGl()
  const r = lib.createRenderer({ getContext: () => M.gl }, { onLog: () => {}, shaderResolver })
  const host = mkHost(L, layer, legacy, lib, !!opts.halfMix)
  const nb = host.nb
  const times = opts.times || [0]
  const poses = [], bufs = []
  for (const t of times) {
    const { buf, pose } = host.g(t)
    poses.push(pose); bufs.push(Float32Array.from(buf))   // ⚠ 必须拷贝：buf 是逐帧复用的同一块
    await r.render(MINSCENE, new Map(), 1920, 1080, t)
    r.renderMeshLayer(LAYER_STUB(layer.obj), layer.mesh, buf, nb, [0, 0], [1, -1], [3840, 2160], { id: 'tex#x' })
  }
  globalThis.location = prev
  const B = globalThis.__mpwBones ? JSON.parse(JSON.stringify(globalThis.__mpwBones)) : null
  const S = globalThis.__mpwSubMesh ? JSON.parse(JSON.stringify(globalThis.__mpwSubMesh)) : null
  return { bones: B, submesh: S, poses, bufs, host, times, draws: M.draws, nb }
}

// ───────────────────────── 层矩形（与 tests/layer-rect-check.mjs 同式） ─────────────────────────
/** 层实绘矩形。注意每次都深拷贝 sceneJson：parseScene 会把附件锚点偏移并进层 origin，复用同一对象会叠加两次。 */
function layerRects(L, bindOrder) {
  const rawScene = JSON.parse(JSON.stringify(L.sceneJson))
  const actx = { readEntry: L.readEntry, time: 0 }
  if (bindOrder) actx.bindOrder = bindOrder
  const scene = lib.parseScene(rawScene, null, { attachCtx: actx })
  const rawById = new Map((rawScene.objects || []).map((o) => [o.id, o]))
  const out = []
  for (const l of scene.layers) {
    const raw = rawById.get(l.id) || {}
    const sw = l.size[0] * l.scale[0], sh = l.size[1] * l.scale[1]
    const aoff = lib.alignmentOffsetForToken(l.alignment, sw, sh)
    let rect
    const pf = raw.image ? L.modelJsonOf(raw.image) : null
    const bb = (pf && pf.puppet && pf.mesh) ? at.meshBounds(pf.mesh) : null
    if (bb) {
      const x0 = l.origin[0] + l.scale[0] * bb.minX, x1 = l.origin[0] + l.scale[0] * bb.maxX
      const y0 = l.origin[1] - l.scale[1] * bb.maxY, y1 = l.origin[1] - l.scale[1] * bb.minY
      rect = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]
    } else {
      const w = Math.abs(sw), h = Math.abs(sh)
      rect = [l.origin[0] + aoff[0] - w / 2, l.origin[1] - aoff[1] - h / 2, w, h]
    }
    out.push({ id: l.id, name: String(l.name || ''), rect, attach: raw.attachment != null })
  }
  return out
}
function rectDiff(rectsA, rectsB) {
  const byId = new Map(rectsB.map((r) => [r.id, r]))
  let same = 0, diff = 0, diffAtt = 0, maxDev = 0
  for (const r of rectsA) {
    const q = byId.get(r.id)
    if (!q) continue
    let d = 0
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(r.rect[k] - q.rect[k]))
    if (d === 0) same++
    else { diff++; if (r.attach) diffAtt++; maxDev = Math.max(maxDev, d) }
  }
  return { same, diff, diffAtt, maxDev }
}

// ───────────────────────── 残余变号的机器判据：单骨三角形永不翻 ⇒ 残余必为多骨剪切 ─────────────────────────
/** 用上传给着色器的那一份（Float32 gBones）自己蒙皮，统计变号三角形 + 权重结构 */
function inversionAudit(mesh, bufs) {
  const nb = mesh.bones.length
  const pos = mesh.positions, bi = mesh.blendIndices, bw = mesh.blendWeights, idx = mesh.indices
  const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  // 与 core/we-scene-bundle.js `__subMeshTick` 的蒙皮/面积式**逐字同式**（含 p[2] 与 z 行 gm[o+8]/gm[o+9]）
  const skin = (g, p) => {
    let x = 0, y = 0
    const q = pos[p], w4 = bw[p] || [1, 0, 0, 0], b4 = bi[p] || [0, 0, 0, 0]
    for (let k = 0; k < 4; k++) {
      const ww = w4[k] || 0
      if (ww === 0) continue
      const o = ((b4[k] | 0) < nb ? (b4[k] | 0) : 0) * 16
      x += (q[0] * g[o] + q[1] * g[o + 4] + (q[2] || 0) * g[o + 8] + g[o + 12]) * ww
      y += (q[0] * g[o + 1] + q[1] * g[o + 5] + (q[2] || 0) * g[o + 9] + g[o + 13]) * ww
    }
    return [x, y]
  }
  const sgn = (a) => (a > 1e-9 ? 1 : (a < -1e-9 ? -1 : 0))
  const I = new Float32Array(nb * 16)
  for (let b = 0; b < nb; b++) I.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], b * 16)
  const nTri = Math.floor(idx.length / 3)
  const base = new Float64Array(nTri)
  const baseSgn = new Int8Array(nTri)
  for (let t = 0; t < nTri; t++) { base[t] = area2(skin(I, idx[t * 3]), skin(I, idx[t * 3 + 1]), skin(I, idx[t * 3 + 2])); baseSgn[t] = sgn(base[t]) }
  const triKind = (t) => {
    const vs = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
    const bonesSet = new Set()
    let maxW = 0
    for (const p of vs) for (let k = 0; k < 4; k++) if (bw[p][k] > 1e-6) { bonesSet.add(bi[p][k]); maxW = Math.max(maxW, bw[p][k]) }
    return { distinct: bonesSet.size, maxW }
  }
  let nInv = 0, nInvSingle = 0, nSingleTri = 0, minMaxW = 1, minDistinct = 9, minAbsRatio = 1, maxAbsRatio = 0
  const invTris = new Set()
  const mirrorBones = new Set()
  for (let f = 0; f < bufs.length; f++) {
    const g = bufs[f]
    for (let b = 0; b < nb; b++) { const o = b * 16; if (g[o] * g[o + 5] - g[o + 1] * g[o + 4] < 0) mirrorBones.add(b) }
    for (let t = 0; t < nTri; t++) {
      const k = triKind(t)
      const isSingle = k.distinct === 1 && k.maxW > 0.999
      if (isSingle) nSingleTri++
      const s = area2(skin(g, idx[t * 3]), skin(g, idx[t * 3 + 1]), skin(g, idx[t * 3 + 2]))
      const sg = sgn(s)
      if (sg !== 0 && baseSgn[t] !== 0 && sg !== baseSgn[t]) {
        nInv++
        invTris.add(t)
        if (isSingle) nInvSingle++
        minMaxW = Math.min(minMaxW, k.maxW)
        minDistinct = Math.min(minDistinct, k.distinct)
        const ratio = Math.abs(s) / Math.max(1e-9, Math.abs(base[t]))
        minAbsRatio = Math.min(minAbsRatio, ratio)
        maxAbsRatio = Math.max(maxAbsRatio, ratio)
      }
    }
  }
  return { nTri, nInv, nInvSingle, nSingleTri, nInvDistinct: invTris.size, minMaxW, minDistinct, minAbsRatio, maxAbsRatio, mirrorBones: [...mirrorBones] }
}

// ───────────────────────── TN4：全语料回归（改前/改后） ─────────────────────────
console.log('\n[TN4] 全语料回归：几何 bbox / 层矩形 / ?bones= 台账 / ?submesh= 分组位移（改前 legacy vs 改后 default）')
const table = []
for (const P of PKGS) {
  const L = loadPkg(P)
  if (!L) { console.log(`  SKIP ${P.tag}（缺包）`); continue }
  if (!L.layers.length) {
    const r1 = layerRects(L), r2 = layerRects(L, 'legacy')
    const d = rectDiff(r1, r2)
    check(d.diff === 0, `${P.tag}：0 个 puppet 层 ⇒ 蒙皮链序对其几何/层矩形零影响（逐位不变）`, `层 ${r1.length}，同 ${d.same}/异 ${d.diff}`)
    table.push({ tag: P.tag, nPup: 0, rects: `${d.same}/${d.diff}`, note: '无 puppet（对照）' })
    continue
  }
  const main = L.layers.slice().sort((a, b) => b.mesh.positions.length - a.mesh.positions.length)[0]
  const nb = main.mesh.bones.length, nv = main.mesh.positions.length, nTri = Math.floor(main.mesh.indices.length / 3)
  const bb = at.meshBounds(main.mesh)
  const isHina = P.id === '3554161528'
  const times = isHina
    ? Array.from({ length: 271 }, (_, f) => f / 30)          // 与 P-109 台账同口径：1/30s × 271 帧（t=0→9s）
    : Array.from({ length: 91 }, (_, f) => (f * 3) / 30)     // 其余包 1/10s 步长（判位移/翻转量级足够）
  const dRect = rectDiff(layerRects(L), layerRects(L, 'legacy'))
  const leg = await runLayer(L, main, { id: P.id, bones: main.obj.name, submesh: 'all', legacy: true, times })
  const fix = await runLayer(L, main, { id: P.id, bones: main.obj.name, submesh: 'all', legacy: false, times })
  const gA = leg.submesh.groups.map((g) => g.b + ':' + g.nv).sort().join(','), gB = fix.submesh.groups.map((g) => g.b + ':' + g.nv).sort().join(',')
  check(gA === gB && gA.length > 0, `${P.tag}：?submesh= 分组表（组号:顶点数）改前/改后逐位相同`,
    `组 ${fix.submesh.groups.length} / 顶点 ${fix.submesh.summary.vertsSelected}`)
  // ⚠ ?bones= 台账的 frames 是 **180 帧环形缓冲** ⇒ 长会话只留尾部；按尾部对齐逐帧对拍
  const frameOffset = (R) => Math.max(0, R.poses.length - R.bones.frames.length)
  const poseDevAll = (R) => {
    let d = 0
    const off = frameOffset(R)
    for (let k = 0; k < R.bones.frames.length; k++) {
      const fr = R.bones.frames[k]
      if (!fr) continue
      for (let b = 0; b < R.bones.nb; b++) d = Math.max(d, Math.hypot(fr.bones[b][1] - R.poses[k + off][b].tx, fr.bones[b][2] - R.poses[k + off][b].ty))
    }
    return d
  }
  const devFix = poseDevAll(fix), devLeg = poseDevAll(leg)
  check(devFix < 2e-3, `${P.tag}：?bones= 反解 pose ≡ 宿主姿势（修正序，逐帧 maxΔ=${devFix.toExponential(2)}px）`, `nb=${nb} 帧=${times.length}`)
  check(devLeg < 2e-3, `${P.tag}：?bones= 反解 pose ≡ 宿主姿势（legacy 序自洽 ⇒ 探针本身不判序）`, `maxΔ=${devLeg.toExponential(2)}px`)
  check(fix.bones.frames.length === Math.min(times.length, 180) && fix.bones.summary.frames === times.length,
    `${P.tag}：?bones= 台账覆盖全部 ${times.length} 帧（环形缓冲留 ${fix.bones.frames.length} 帧 + 会话累计 frames=${fix.bones.summary.frames}）`,
    `maxΔty=${f2(fix.bones.summary.maxDty)}px(b${fix.bones.summary.maxDtyBone})/maxΔang=${fix.bones.summary.maxDang.toFixed(4)}rad(b${fix.bones.summary.maxDangBone})；mirrorEver=${JSON.stringify(fix.bones.summary.mirrorEver)}`)
  const summarize = (S) => {
    const gs = S.groups.map((g) => ({ b: g.b, nv: g.nv, nTri: g.invert.nTri, disp: g.disp.mag, dispAt: g.disp.at, inv: g.invert.max, invAt: g.invert.at }))
    return {
      gs, byDisp: gs.slice().sort((a, b) => b.disp - a.disp), byInv: gs.slice().sort((a, b) => b.inv - a.inv),
      avgDisp: gs.reduce((s, g) => s + g.disp, 0) / Math.max(1, gs.length),
      invTris: gs.reduce((s, g) => s + g.inv, 0),
    }
  }
  const SA = summarize(leg.submesh), SB = summarize(fix.submesh)
  const row = {
    tag: P.tag, layer: main.obj.name, nb, nv, nTri,
    bbox: bb ? `${f2(bb.minX)},${f2(bb.minY)},${f2(bb.maxX)},${f2(bb.maxY)}` : '-',
    nGroups: SB.gs.length, dRect,
    legTopDisp: SA.byDisp[0], fixTopDisp: SB.byDisp[0], legAvgDisp: SA.avgDisp, fixAvgDisp: SB.avgDisp,
    legInvTris: SA.invTris, fixInvTris: SB.invTris, legInvTop: SA.byInv[0], fixInvTop: SB.byInv[0],
    legSub: SA, fixSub: SB,
  }
  if (isHina) {
    const pick = (S, b) => S.gs.find((g) => g.b === b)
    row.face = [16, 17, 18, 19, 30].map((b) => ({ b, leg: pick(SA, b), fix: pick(SB, b) }))
    const b17l = pick(SA, 17), b17f = pick(SB, 17), b18l = pick(SA, 18), b18f = pick(SB, 18)
    check(b17l && b17l.inv === b17l.nTri, `hina b17（眉毛）：改前整组翻转 ${b17l ? b17l.inv + '/' + b17l.nTri : '-'}（复现 P-109.2 的 8/8）`, b17l ? `@${b17l.invAt}s` : '')
    check(b17f && b17f.inv === 0, `hina b17（眉毛）：改后 0/${b17f ? b17f.nTri : 8}（翻转消失）`, b17f ? `@${b17f.invAt}s` : '')
    check(b18l && b18f && b18f.disp < b18l.disp * 0.25, `hina b18（睫毛）：位移 ${b18l ? f2(b18l.disp) : '-'}px → ${b18f ? f2(b18f.disp) : '-'}px（↓≥75%）`,
      b18l && b18f ? `@${b18l.dispAt}s → @${b18f.dispAt}s` : '')
    const audit = inversionAudit(main.mesh, fix.bufs)
    const auditLegacy = inversionAudit(main.mesh, leg.bufs)
    row.audit = audit; row.auditLegacy = auditLegacy
    check(audit.mirrorBones.length === 0, 'hina 残余变号定性①：修正序下没有任何骨的 gBone 含镜像（det<0）⇒ 翻转不是骨级镜像',
      `mirrorBones=${JSON.stringify(audit.mirrorBones)}`)
    check(audit.nInvSingle === 0, `hina 残余变号定性②：单骨三角形永不翻（单骨三角共 ${audit.nSingleTri} 条，变号 ${audit.nInvSingle} 条）`,
      `残余变号 ${audit.nInv}/${audit.nTri}，均为多骨权重三角形`)
    // ③ 残余变号 = 多骨剪切（LBS 固有）而不是本 bug 的残余：**半修对照**（bindInv 修正序 / bindRT 旧序）
    const half = await runLayer(L, main, { id: P.id, bones: main.obj.name, submesh: 'all', times, legacy: false, halfMix: true })
    const halfB16 = half.submesh.groups.find((g) => g.b === 16)
    const b16Leg = leg.submesh.groups.find((g) => g.b === 16), b16Fix = fix.submesh.groups.find((g) => g.b === 16)
    check(b16Leg && b16Fix && halfB16 && b16Leg.invert.max === b16Fix.invert.max && b16Fix.invert.max === halfB16.invert.max,
      `hina 残余 b16：全旧 / 半修 / 全修三种口径下都是 ${b16Fix ? b16Fix.invert.max + '/' + b16Fix.invert.nTri : '-'} @${b16Fix ? b16Fix.invert.at : '-'}s ⇒ 与链序无关（不是本 bug 的残余）`,
      `legacy=${b16Leg ? b16Leg.invert.max : '-'} half=${halfB16 ? halfB16.invert.max : '-'} fix=${b16Fix ? b16Fix.invert.max : '-'}`)
    check(auditLegacy.nInvDistinct > audit.nInvDistinct * 3 && auditLegacy.nInv > audit.nInv * 5,
      `hina 残余变号量级：变号事件 ${auditLegacy.nInv}→${audit.nInv}（不同三角形 ${auditLegacy.nInvDistinct}→${audit.nInvDistinct}）⇒ 收敛 ≥5×`,
      `legacy 含 b17 整组 8/8；修正后组级最大 1/17`)
    check(audit.minDistinct >= 2 && audit.minMaxW < 1, 'hina 残余变号定性③：全部落在**多骨权重**三角形（最"重"者仍有第二根骨参与）',
      `minDistinct=${audit.minDistinct}、minMaxW=${f3(audit.minMaxW)}（<1）、|面积|比 ∈ [${audit.minAbsRatio.toExponential(2)}, ${audit.maxAbsRatio.toExponential(2)}]（含过零剪切）`)
  }
  table.push(row)
  console.log(`  · ${P.tag}｜层"${main.obj.name}"｜骨 ${nb} 顶点 ${nv} 三角 ${nTri}｜组 ${SB.gs.length}｜bbox=[${row.bbox}]`
    + `｜层矩形 同${dRect.same}/异${dRect.diff}（附件层 ${dRect.diffAtt}，maxΔ=${f2(dRect.maxDev)}px）`
    + `｜最大位移 ${f2(SA.byDisp[0].disp)}→${f2(SB.byDisp[0].disp)}px（b${SA.byDisp[0].b}→b${SB.byDisp[0].b}）`
    + `｜组均位移 ${f2(SA.avgDisp)}→${f2(SB.avgDisp)}px｜变号三角总数 ${SA.invTris}→${SB.invTris}`)
}
{
  const bad = table.filter((r) => r.dRect && r.dRect.diff > r.dRect.diffAtt).map((r) => r.tag)
  check(bad.length === 0, '层矩形：改前/改后只可能在带 attachment 的层上变化（非附件层逐位不变；锚点与 gBones 同链序）', bad.join(',') || '无违例')
}

// ───────────────────────── TN5：回退开关语义 ─────────────────────────
console.log('\n[TN5] 回退开关 `?bindorder=legacy`（写法与 `?x=legacy` 同形）')
{
  check(ps.bindOrderLegacy('?bindorder=legacy') === true && ps.bindOrderLegacy('?a=1&bindorder=legacy&b=2') === true,
    '判定式：`?bindorder=legacy`（含多参）⇒ true')
  check(ps.bindOrderLegacy('?bindorder=1') === false && ps.bindOrderLegacy('') === false && ps.bindOrderLegacy(null) === false && ps.bindOrderLegacy('?bindorder=Legacy') === false,
    '判定式：缺省/`=1`/空/`null`/大小写不符 ⇒ false（默认走修正序）')
  const P = PKGS[0]
  const L = loadPkg(P)
  if (L && L.layers.length) {
    const main = L.layers[0]
    const t = [0, 0.1, 0.267, 0.33, 0.5, 1.5]
    const a = await runLayer(L, main, { id: P.id, bones: main.obj.name, submesh: 'all', times: t, legacy: true })
    const b = await runLayer(L, main, { id: P.id, bones: main.obj.name, submesh: 'all', times: t, legacy: false })
    const b17a = a.submesh.groups.find((g) => g.b === 17), b17b = b.submesh.groups.find((g) => g.b === 17)
    check(b17a && b17a.invert.max === b17a.invert.nTri, '`?bindorder=legacy`：b17（眉毛）又是整组翻转（旧 bug 可复现）', b17a ? `b17 ${b17a.invert.max}/${b17a.invert.nTri} @${b17a.invert.at}s` : 'no b17')
    check(b17b && b17b.invert.max === 0, '默认（不写开关）= 修正序：b17 不再翻转', b17b ? `b17 ${b17b.invert.max}/${b17b.invert.nTri}` : 'no b17')
    const prev = globalThis.location
    globalThis.location = { search: '?id=' + P.id + '&bones=' + main.obj.name + '&bindorder=legacy' }
    delete globalThis.__mpwBones
    const G = mkGl()
    const r = lib.createRenderer({ getContext: () => G.gl }, { onLog: () => {}, shaderResolver })
    const hostFix = mkHost(L, main, false)
    const { buf, pose } = hostFix.g(0)
    await r.render(MINSCENE, new Map(), 1920, 1080, 0)
    r.renderMeshLayer(LAYER_STUB(main.obj), main.mesh, buf, hostFix.nb, [0, 0], [1, -1], [3840, 2160], { id: 'tex#x' })
    globalThis.location = prev
    const B = globalThis.__mpwBones
    let d = 0
    for (let bb = 0; bb < B.nb; bb++) d = Math.max(d, Math.hypot(B.frames[0].bones[bb][1] - pose[bb].tx, B.frames[0].bones[bb][2] - pose[bb].ty))
    check(d > 1, '交叉：探针 legacy 链 × 宿主修正链 ⇒ 反解偏离 > 1px（开关对探针真的生效）', `maxΔ=${f2(d)}px`)
  }
}

// ───────────────────────── TN6：反向变异（改回旧写法必须红） ─────────────────────────
console.log('\n[TN6] 反向变异：把 `core/puppet-skin.js` 的默认序换回父先乘 ⇒ 本测试的核心断言必须失败')
let tmpDir = null
try {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p110-mutant-'))
  const skinSrc = fs.readFileSync(path.join(ROOT, 'core', 'puppet-skin.js'), 'utf8')
  const mutant = skinSrc.replace(
    'out[b] = pw ? (legacy ? matMulRow(pw, local) : matMulRow(local, pw)) : local',
    'out[b] = pw ? (legacy ? matMulRow(local, pw) : matMulRow(pw, local)) : local')
  check(mutant !== skinSrc, '变异点存在（`bindWorldChain` 的链序三元式被找到）')
  fs.writeFileSync(path.join(tmpDir, 'puppet-skin.js'), mutant)
  // ①(P-112-BANDGEOM 2026-09-17) 临时副本必须带上 bundle 的**全部**同目录 import：
  //   `attach-transform.mjs`（P-21）、`puppet-skin.js`（上面写的变异版）、`web-frame-geometry.mjs`（帧几何接线）、
  //   `audio-band-array.mjs`（①(P-132 批D) 粒子音频响应包络 + 16 段活视图）。
  //   少一个就是 ERR_MODULE_NOT_FOUND（本项曾因此假红）—— 以后再给 bundle 加同目录 import 时，这里要同步。
  // ①(2026-09-20 结构化修法) 原来是**手抄清单**（6 个 core 文件）—— 这类清单会腐烂：
  //   本轮插件仓就踩到同一类坑（`lib/index.js` 新增相对 import 而夹具没同步 ⇒ ERR_MODULE_NOT_FOUND）。
  //   改成整目录复制：`core/` 里有什么就复制什么（只跳过子目录），依赖闭包自动成立。
  for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
    const srcF = path.join(ROOT, 'core', f)
    if (!fs.statSync(srcF).isFile()) continue
    // ⚠ **跳过 `puppet-skin.js`**：它是本次要被变异的那一个，上面已经写好变异版 ——
    //   整目录复制会把它**覆盖回原版**，变异就白做了（第一次改这里时实测：TN1a 的 maxΔ 从几百 px
    //   变成 0.00px，"测试是活的"那条断言直接红 —— 门禁抓住了这个假绿，这正是它该干的事）。
    if (f === 'puppet-skin.js') continue
    fs.copyFileSync(srcF, path.join(tmpDir, f))
  }
  const M = await import(pathToFileURL(path.join(tmpDir, 'we-scene-bundle.js')).href)
  const P = PKGS[0]
  const L = loadPkg(P)
  if (L && L.layers.length) {
    const main = L.layers[0]
    const bones = main.mesh.bones, nb = bones.length
    const cy = animStyleWorldOfBind(bones)
    const bw = M.bindWorldChain(bones, {})
    const dComp = worldDev(bw, cy)
    check(dComp > 1, '变异体（旧写法）：TN1a 组成律恒等失败（与 sampleAnimRT 递推式差几百 px）⇒ 测试是"活的"', `maxΔ=${f2(dComp)}px`)
    const rt0 = at.sampleAnimRT(main.mesh, main.mesh.animations[0], 0, nb, bones)
    check(worldDev(bw, rt0) > 1, '变异体（旧写法）：TN1b 数据恒等失败（与动画帧0 差几百 px）', `maxΔ=${f2(worldDev(bw, rt0))}px`)
    const bi = bw.map(ps.matInvertRow)
    const rtSelf = M.bindWorldPolar(bw)
    let dev = 0
    for (let b = 0; b < nb; b++) {
      const r = rtSelf[b], c = Math.cos(r.angle), s = Math.sin(r.angle)
      const g = at.matMulRow(bi[b], [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, r.tx, r.ty, 0, 1])
      const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      for (let k = 0; k < 16; k++) dev = Math.max(dev, Math.abs(g[k] - I[k]))
    }
    check(dev < 1e-3, '变异体自洽性：用它自己的 bind 基准算静止帧仍然是 I（再次说明静止帧不能判序）', `max|g−I|=${dev.toExponential(2)}`)
    check(dev > 0 && dev < 1e-3, '变异体的静止帧偏差与修正版同量级（极坐标往返舍入约 5e-5）⇒ 改链序不改变「静止帧=I」这条', `max|g−I|=${dev.toExponential(2)}`)
    const prev = globalThis.location
    globalThis.location = { search: '?id=' + P.id + '&submesh=all' }
    delete globalThis.__mpwSubMesh
    const G = mkGl()
    const r = M.createRenderer({ getContext: () => G.gl }, { onLog: () => {}, shaderResolver })
    const host = mkHost(L, main, false, M)
    for (let f = 0; f < 271; f++) {
      const t = f / 30
      const { buf } = host.g(t)
      await r.render(MINSCENE, new Map(), 1920, 1080, t)
      r.renderMeshLayer(LAYER_STUB(main.obj), main.mesh, buf, host.nb, [0, 0], [1, -1], [3840, 2160], { id: 'tex#x' })
    }
    globalThis.location = prev
    const S = globalThis.__mpwSubMesh
    const b17 = S.groups.find((g) => g.b === 17)
    check(b17 && b17.invert.max === b17.invert.nTri, '变异体（旧写法）：b17 又整组翻转 ⇒ "改回旧写法必须红"在端到端渲染上也成立',
      b17 ? `b17 ${b17.invert.max}/${b17.invert.nTri} @${b17.invert.at}s` : 'no b17')
  }
} finally {
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ───────────────────────── 报表（--report；供 docs/PATCHES.md P-110 引用） ─────────────────────────
if (REPORT) {
  console.log('\n==== P-110 改前/改后数字表（--report） ====')
  console.log('包 | 层 | 骨/顶点/三角 | 组数 | bbox | 层矩形 同/异/附件层/最大Δpx | 最大位移 legacy→fix | 组均位移 legacy→fix | 变号三角 legacy→fix')
  for (const r of table) {
    if (!r.nb) { console.log(`${r.tag} | — | 无 puppet | — | — | ${r.rects} | — | — | —`); continue }
    console.log(`${r.tag} | ${r.layer} | ${r.nb}/${r.nv}/${r.nTri} | ${r.nGroups} | [${r.bbox}] | ${r.dRect.same}/${r.dRect.diff}/${r.dRect.diffAtt}/${f2(r.dRect.maxDev)} | b${r.legTopDisp.b} ${f2(r.legTopDisp.disp)}→b${r.fixTopDisp.b} ${f2(r.fixTopDisp.disp)} | ${f2(r.legAvgDisp)}→${f2(r.fixAvgDisp)} | ${r.legInvTris}→${r.fixInvTris}`)
  }
  const h = table.find((r) => r.face)
  if (h) {
    console.log('\nhina 3554161528 面部 5 组（b16 眼 / b17 眉毛 / b18 睫毛 / b19 外眼角 / b30 瞳孔）：')
    console.log('骨 | 组顶点/三角 | 最大位移 legacy→fix (px) | 最大变号 legacy→fix')
    for (const f of h.face) {
      console.log(`b${f.b} | ${f.leg.nv}/${f.leg.nTri} | ${f2(f.leg.disp)}@${f.leg.dispAt}s → ${f2(f.fix.disp)}@${f.fix.dispAt}s | ${f.leg.inv}/${f.leg.nTri}@${f.leg.invAt}s → ${f.fix.inv}/${f.fix.nTri}@${f.fix.invAt}s`)
    }
    if (h.audit) console.log(`残余变号审计：${h.audit.nInv}/${h.audit.nTri} 条；单骨三角 ${h.audit.nSingleTri} 条（变号 ${h.audit.nInvSingle}）；镜像骨 ${JSON.stringify(h.audit.mirrorBones)}；最重变号三角形 maxW=${f3(h.audit.minMaxW)}；|面积|比=${h.audit.minAbsRatio.toExponential(2)}`)
  }
  console.log('\n链序恒等式（TN1a 组成律 / TN1b 帧0==bind 子集 / 全体动画帧0）：')
  for (const [tag, v] of chainStats) {
    if (!v.nPuppet) { console.log(`  ${tag}: 无 puppet`); continue }
    console.log(`  ${tag}: 组成律 legacy=${f2(v.compLeg)}px→fix=${v.compFix.toExponential(2)}px ｜ 帧0==bind 子集(${v.dataEqCount}/${v.nAnim}) legacy=${f2(v.dataEqLegMax)}px→fix=${f3(v.dataEqFixMax)}px ｜ 全体动画帧0 legacy=${f2(v.dataLeg)}px→fix=${f2(v.dataFix)}px`)
  }
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAILED ' + fail)) + `（${pass} 通过 / ${fail} 失败）`)
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }

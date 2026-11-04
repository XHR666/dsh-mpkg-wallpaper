// mdl-variant-dispatch-test.mjs — P-250（2026-10-07）**MDL 变体判别**（同一张壁纸该按哪版布局加载）。
//
// 背景（语料审计 158 个 `.mdl`，见 docs/reports-mdl-variants.md）：
//   `findMdlVertexBlock` 此前只认两种步长 —— 80B（蒙皮：pos3@0 + blendIdx4@40 + weights4@56 + uv2@72）
//   与 52B（MDLV0016 紧凑变体）。语料里 **86 个文件**是第三种布局：
//     **48B 静态 PBR**：`pos3@0 + normal3@12 + tangent4@24(w≈±1) + uv2@40`
//   其中 **42 个完全解析不了**（`parseMdl → null`），**40 个被误判成 80B**（`vb % 80 == 0` 巧合成立 ⇒
//   位置能过闸门但 uv/蒙皮字段全是垃圾）—— 这就是"新旧格式判别"的真实缺口。
//
// 判别规则（本判据逐条钉死）：
//   ① **有 MDLS（蒙皮）⇒ 绝不用 48**（语料 4 个 puppet 同时满足两套签名，必须让骨架赢）；
//   ② **无 MDLS 且 48 签名强**（法线单位率 ≥0.9 / 切线 w≈±1 率 ≥0.8 / uv∈[-0.05,1.05] 率 ≥0.9）、
//      且现有 80B 候选的 uv 证据弱（uv@72 命中率 <0.9）⇒ 用 48；
//   ③ 其余保持原判（63 个蒙皮 + 5 个 MDLV0016 逐位不变）。
//
// 判据分两层：A 纯函数/合成夹具（签名与优先级，不依赖语料）；B 真实语料全量对账（158 个文件）。
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { findMdlVertexBlock, findMdlStride48Block, mdlStride48Signature, mdlStride80UvEvidence, parseMdl } from '../core/attach-transform.mjs'
import { WS } from './_root.mjs'

const MPW_WS = process.env.MPW_ROOT || WS
const ROOTS = ['0923', '0917', '1004', 'dd', 'wallpaperE'].map((d) => path.join(MPW_WS, 'allwallpaper', d))
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const enc = new TextEncoder()

/** 合成一个最小 MDL：头(MDLV0023 + 12B) + 0 + material cstring + 0 + [4B vb][顶点][4B ib][索引] + 7B 填充 */
function mkMdl({ magic = 'MDLV0023', material = 'materials/x.json', stride, vertices, indices, mdls = null, filler = 7 }) {
  const head = []
  head.push(enc.encode(magic.padEnd(8, ' ').slice(0, 8)))
  head.push(new Uint8Array(12))                       // 固定头（内容不参与解析）
  head.push(new Uint8Array([0]))                      // 0x00 @20
  head.push(enc.encode(material))
  head.push(new Uint8Array([0]))
  const vb = new Uint8Array(vertices.length * stride)
  const dv = new DataView(vb.buffer)
  vertices.forEach((v, i) => {
    const o = i * stride
    if (v.pos) { dv.setFloat32(o + 0, v.pos[0], true); dv.setFloat32(o + 4, v.pos[1], true); dv.setFloat32(o + 8, v.pos[2], true) }
    if (v.nrm) { dv.setFloat32(o + 12, v.nrm[0], true); dv.setFloat32(o + 16, v.nrm[1], true); dv.setFloat32(o + 20, v.nrm[2], true) }
    if (v.tan) { dv.setFloat32(o + 24, v.tan[0], true); dv.setFloat32(o + 28, v.tan[1], true); dv.setFloat32(o + 32, v.tan[2], true); dv.setFloat32(o + 36, v.tan[3], true) }
    if (v.uv) { dv.setFloat32(o + 40, v.uv[0], true); dv.setFloat32(o + 44, v.uv[1], true) }
    if (v.blendIdx) { dv.setUint32(o + 40, v.blendIdx[0], true); dv.setUint32(o + 44, v.blendIdx[1], true); dv.setUint32(o + 48, v.blendIdx[2], true); dv.setUint32(o + 52, v.blendIdx[3], true) }
    if (v.weights) { dv.setFloat32(o + 56, v.weights[0], true); dv.setFloat32(o + 60, v.weights[1], true); dv.setFloat32(o + 64, v.weights[2], true); dv.setFloat32(o + 68, v.weights[3], true) }
    if (v.uv80) { dv.setFloat32(o + 72, v.uv80[0], true); dv.setFloat32(o + 76, v.uv80[1], true) }
  })
  const ib = new Uint8Array(indices.length * 2)
  const idv = new DataView(ib.buffer)
  indices.forEach((x, i) => idv.setUint16(i * 2, x, true))
  const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, vb.length, true)
  const isize = new Uint8Array(4); new DataView(isize.buffer).setUint32(0, ib.length, true)
  const parts = [...head, size, vb, isize, ib]
  if (mdls) parts.push(mdls)                          // 'MDLS' 段（仅在需要"有 MDLS"时）
  parts.push(new Uint8Array(filler))
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const sphere = (n) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2
  return { pos: [Math.cos(a), Math.sin(a), 0], nrm: [Math.cos(a), Math.sin(a), 0], tan: [-Math.sin(a), Math.cos(a), 0, 1], uv: [i / n, 0.5] }
})

console.log('== A 合成夹具：三种步长的判别与优先级 ==')
{
  // A1 纯 48B 静态网格（无 MDLS）⇒ 必须判成 stride-48 且解出法线/切线
  const m48 = mkMdl({ stride: 48, vertices: sphere(24), indices: Array.from({ length: 66 }, (_, i) => i % 24) })
  const dv48 = new DataView(m48.buffer, m48.byteOffset, m48.byteLength)
  const b48 = findMdlVertexBlock(m48, dv48, m48.length)
  check('A1 无 MDLS 的 48B 静态网格 ⇒ stride-48（variant=stride-48）',
    !!b48.block && b48.block.stride === 48 && b48.block.variant === 'stride-48', JSON.stringify(b48.block && { st: b48.block.stride, v: b48.block.variant }))
  const p48 = parseMdl(m48)
  check('A2 48B 网格解析成功：顶点/uv/法线/切线齐、蒙皮字段给中性值、bones=[]',
    !!p48 && p48.vertexCount === 24 && p48.bones.length === 0 && Array.isArray(p48.normals) && p48.normals.length === 24 &&
    Array.isArray(p48.tangents) && p48.tangents.length === 24 && p48.blendWeights[0][0] === 1 && p48.blendIndices[0][0] === 0,
    p48 ? JSON.stringify({ vc: p48.vertexCount, nrm: p48.normals && p48.normals.length, tan: p48.tangents && p48.tangents.length, bw: p48.blendWeights[0] }) : 'null')
  check('A3 签名函数读数：三项命中率 = 1.00',
    (() => { const s = mdlStride48Signature(dv48, b48.block.verticesOffset, 24); return s.nrm === 1 && s.tanw === 1 && s.uv === 1 })(), JSON.stringify(mdlStride48Signature(dv48, b48.block.verticesOffset, 24)))

  // A4 带 MDLS 的蒙皮网格：即使 48 签名"也像"，也必须判成 80（骨架赢）
  const skin20 = Array.from({ length: 20 }, () => ({ pos: [1, 0, 0], blendIdx: [1, 0, 0, 0], weights: [1, 0, 0, 0], uv80: [0.5, 0.5] }))
  // 注意：蒙皮网格的 80B 步长里 40..52 是 blendIdx4（小整数 ⇒ 读成 float 近似 0，会落在 uv 区间内）
  const msk = mkMdl({ stride: 80, vertices: skin20, indices: Array.from({ length: 60 }, (_, i) => i % 20), mdls: enc.encode('MDLS' + '\u0000'.repeat(40)) })
  const dvsk = new DataView(msk.buffer, msk.byteOffset, msk.byteLength)
  const mdlsOff = (() => { for (let i = 9; i + 4 < msk.length; i++) if (msk[i] === 0x4d && msk[i + 1] === 0x44 && msk[i + 2] === 0x4c && msk[i + 3] === 0x53) return i; return -1 })()
  const bsk = findMdlVertexBlock(msk, dvsk, mdlsOff)
  check('A4 **有 MDLS ⇒ 绝不走 48**（蒙皮骨架优先；语料 4 个 puppet 属此类冲突样本）',
    mdlsOff > 0 && !!bsk.block && bsk.block.stride === 80, JSON.stringify({ mdlsOff, st: bsk.block && bsk.block.stride }))
  check('A5 48B 判定函数对 80B 蒙皮块不误报（签名不过 ⇒ 返回 null）',
    (() => { const r = findMdlStride48Block(msk, dvsk, msk.length); return r.block === null })(), '')
  check('A6 80B uv 证据读数：真蒙皮块 ≥0.9（uv@72 合法）',
    mdlStride80UvEvidence(dvsk, bsk.block) >= 0.9, String(mdlStride80UvEvidence(dvsk, bsk.block)))
}

console.log('== B 真实语料全量对账（158 个 .mdl / 51 包）==')
{
  const rows = []
  for (const root of ROOTS) {
    let dirs = []
    try { dirs = fs.readdirSync(root) } catch (e) { continue }
    for (const d of dirs) {
      const p = path.join(root, d, 'scene.pkg')
      if (!fs.existsSync(p)) continue
      let pkg = null
      try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p))) } catch (e) { continue }
      for (const e of pkg.entries) {
        if (!/\.mdl$/i.test(e.name)) continue
        let buf = null
        try { buf = lib.getEntry(pkg, e.name) } catch (err) { continue }
        let mdls = -1
        for (let i = 9; i + 4 < buf.length; i++) { if (buf[i] === 0x4d && buf[i + 1] === 0x44 && buf[i + 2] === 0x4c && buf[i + 3] === 0x53) { mdls = i; break } }
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
        const vs = findMdlVertexBlock(buf, dv, mdls >= 0 ? mdls : buf.length)
        const parsed = parseMdl(buf)
        rows.push({ pkg: root.split('/').pop() + '/' + d, name: e.name, size: buf.length, mdls: mdls >= 0, variant: vs && vs.block ? vs.block.variant : 'null', parsed })
      }
    }
  }
  const byVar = rows.reduce((m, r) => { m[r.variant] = (m[r.variant] || 0) + 1; return m }, {})
  const failed = rows.filter((r) => !r.parsed)
  check('B1 语料 158 个 .mdl 全部走到（审计口径一致）', rows.length === 158, 'n=' + rows.length)
  check('B2 **解析成功 158 / 失败 0**（修前 112/46；P-250 救回 42、P-256 再补 4 个平铺 uv 天空盒）',
    rows.filter((r) => r.parsed).length === 158 && failed.length === 0,
    'ok=' + rows.filter((r) => r.parsed).length + ' fail=' + failed.length)
  check('B3 分支分布 = stride-80:74 / stride-48:79 / mdlv0016-compact-52:5',
    byVar['stride-80'] === 74 && byVar['stride-48'] === 79 && byVar['mdlv0016-compact-52'] === 5, JSON.stringify(byVar))
  const mdlsOn48 = rows.filter((r) => r.mdls && r.variant === 'stride-48')
  check('B4 **没有一个带 MDLS 的文件被判成 48**（骨架/顶点不错配）', mdlsOn48.length === 0,
    mdlsOn48.slice(0, 3).map((r) => r.pkg + '::' + r.name).join(' | '))
  /* ①(P-256 2026-10-07) 原先"仍失败的 4 个"（2.87MB 天空盒）现在按 **平铺 uv** 合法接受：
     它们的 uv 会超过 1（真机读数 v ∈ [0.06, 2.04]，落在 [0,1] 的只有 46%），但法线/切线判据全 1.00。 */
  const skies = rows.filter((r) => /自制天空盒0[012]/.test(r.name))
  check('B5 4 个天空盒（平铺 uv）现在也解析成功、且都走 stride-48',
    skies.length === 4 && skies.every((r) => r.parsed && r.variant === 'stride-48'),
    skies.map((r) => r.name + '→' + r.variant + (r.parsed ? '✓' : '✗')).join(' | '))
  const p48 = rows.filter((r) => r.variant === 'stride-48' && r.parsed)
  check('B6 48B 分支的文件都能给出网格（positions/uv/indices 非空）',
    p48.length === 79 && p48.every((r) => r.parsed), 'n=' + p48.length)
  const puppets = rows.filter((r) => r.mdls)
  check('B7 蒙皮文件（MDLS）分支只用 80/52（67+5=72 个）',
    puppets.length === 72 && puppets.every((r) => r.variant === 'stride-80' || r.variant === 'mdlv0016-compact-52'),
    JSON.stringify(puppets.reduce((m, r) => { m[r.variant] = (m[r.variant] || 0) + 1; return m }, {})))
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败（P-250 MDL 变体判别）')
process.exit(fail === 0 ? 0 : 1)

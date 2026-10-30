// mdlv0016-test.mjs — ③(P-173 2026-09-24) **`MDLV0016` 紧凑网格容器变体（顶点块签名 `0x01800009` + 顶点步长 52）**门禁
//
// 门禁名 `mdlv0016`（`tests/run-all-tests.sh`）。**无浏览器 / 无网络 / 无 X11 / 无 GPU**，单 node 进程。
//
// 病（`docs/PATCHES.md` P-172 末段点名的"未救回"项）：`0923/2887099508` 的 5 个 `.mdl` 在**顶点块扫描**
//   这一步就 `return null`（`core/attach-transform.mjs::parseMdl` 与 `elysia/we-renderer/puppet.js::_parseMdl`
//   都在解析 MDLS **之前**退出）⇒ 蒙皮/骨架整块丢失。它们的 MDLS 逐骨记录本身**合法**（A 定步读齐声明骨数、
//   0 结构错、0 逐骨错）⇒ 缺的只是"怎么读懂这个容器变体" ⇒ 顶点块一读通，骨架**当场**就出来（本门禁断言）。
//
// 本门禁锁六件事：
//   ① **逐字节取证 + 判据复算**（真语料 5/5）：文件头 / 固定头 / 材质路径锚点 / 0 填充 / 块签名 / 顶点字节数 /
//      步长 52 / 索引块 / "索引数据写到 MDLS 起点" / 顶点数与索引域互证 / 全量索引界内 / 权重和 / 混合索引 /
//      uv / `z ≡ 0` / 三角形退化数 —— 每条都当场算出来并打印读数。
//   ② **改前 / 改后全语料对拍**：把"新分支关掉"的 core 副本（= 改动前的行为）与真模块各自跑**全语料行**（漂移同步后 165），
//      逐字段流式 sha256 对拍 ⇒ **除这 5 个之外逐字段不变**（改了哪几行、变成什么，逐条打印）。
//   ③ **改后骨架 + 台账**：5/5 骨数 == 声明骨数（2/5/2/2/3）、`mdlDiag.layout = 'mdlv0016-compact'`、
//      `mesh.variant = 'mdlv0016-compact-52'`、`?mdls=legacy` 档**逐字段相同**、elysia 侧与 core **逐位相同**、
//      5/5 一行 warn 都不打；无 MDLS 的第 6 个 `MDLV0016`（`Hollow Cylinder`）**仍按既有口径 null**。
//   ④ **合成边界夹具必须仍被拒**：签名篡改 / 起点写错 / 步长不是 52 的倍数 / 索引越界 / 顶点数与索引域不符 /
//      权重和不归一 / 混合索引越界 / pos·uv 非有限 / 索引块或顶点块越出文件尾 / 索引块越过 MDLS 起点 /
//      声明骨数越界 / 材质路径锚点错位 / 伪造 magic / 截断 —— 每条都要求 `parseMdl === null`、
//      `opts.diag.mdlDiag.reason` == 期望值（或"分支根本没被触发"）。
//   ⑤ **8 组变异自证**（真跑：复制 `core/` 到临时目录做字符串变异再 import）：关掉新分支 / 去掉块签名判据 /
//      去掉索引界内判据 / 去掉混合索引判据 / 去掉"顶点数 == 索引域"判据 / 去掉"不越过 MDLS"判据 /
//      去掉权重和判据 / **把新分支的起点写错**（`+8` → `+8-52`）—— 每组打印 `MUTANT-RED-OK` 并给出
//      **期望红集 == 实际红集**（红集 = 具名判据探针的集合，逐名相等）。
//   ⑥ **门禁登记**：`tests/run-all-tests.sh` 里有本项的 `add` 行。
//
// ⚠ **诚实口径**（与 `docs/PATCHES.md` P-173 未登记项同一口径）：
//   · 本项**不新增任何 URL 开关**（新增开关要求同批登记 `docs/README-DIAGNOSTICS.md` 主表，本批禁碰 `docs/**`）；
//     回退手段 = `git revert` `findMdlVertexBlock` 里那一行调用（变异 M1 就是它的等价物）。
//   · "步长 52" 的判据来自**真语料逐字节**（5/5 精确相等）+ 同语料 81 个 stride=80 网格块上同族判据的
//     普遍成立（`全部索引 < 顶点数` 81/81、`混合索引 < 声明骨数` 81/81、`uv 有限` 81/81、`权重和 ≈ 1` 80/81）
//     —— **没有**官方规范/上游实现可对拍（`0x01800009` 这个签名的语义未被任何文档定义）。
//   · 语料里第 6 个 `MDLV0016`（无 MDLS、块签名 `0x0000000f`、步长 48：`12384/48 === maxIndex+1 === 258`）
//     **有意不接**（本分支只服务"要骨架"的网格）⇒ 本门禁**断言它仍是 null**（不许被顺手"救"成无骨网格）。
//   · **语料敏感**：①②③ 组的读数/清单随本机语料走（真语料缺失 ⇒ 本项红，**不** SKIP —— 与兄弟项
//     `mdl-bone-layout` 同口径：语料是本项判据的可信来源）。
//   · **不渲染敏感**：无浏览器 / 无 GPU / 无网络 / 无 X11；全部是纯字节解析 + 合成夹具 + 临时副本变异。
//
// 运行：node tests/mdlv0016-test.mjs        （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { readIndexHead, readEntryBytes, walkContainers } from './_pkg-index.mjs'
import { parseMdl, findMdlVertexBlock, readMdlv0016CompactVertexBlock } from '../core/attach-transform.mjs'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'

const H = {}
installPuppet(H)

let PASS = 0, FAIL = 0
const RED = {}
function check(group, name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { FAIL++; RED[group] = (RED[group] || 0) + 1; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
function capture(fn) {
  const ow = console.warn, warns = []
  console.warn = (...a) => warns.push(a.join(' '))
  try { return { r: fn(), warns } } finally { console.warn = ow }
}

// ── 逐字段流式 sha256（不拼大字符串；与 `tests/mdl-bone-layout-test.mjs::hashFields` 同口径）──
function hashFields(m) {
  const h = crypto.createHash('sha256')
  const num = (v) => { const x = +v; return Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(6)) : String(v) }
  const put = (label, arr) => { h.update(label + ':' + arr.length + ':'); for (const v of arr) h.update(num(v) + ',') }
  const putRows = (label, rows) => { h.update(label + ':' + rows.length + ':'); for (const row of rows) { h.update('['); for (const v of row) h.update(num(v) + ','); h.update(']') } }
  putRows('p', m.positions)
  putRows('u', m.uvs)
  put('i', m.indices)
  putRows('bi', m.blendIndices)
  putRows('bw', m.blendWeights)
  for (const bn of m.bones) h.update('B' + bn.index + '|' + bn.type + '|' + bn.parent + '|' + String(bn.bind) + ';')
  for (const an of m.animations) { h.update('A' + an.id + '|' + an.name + '|' + an.frameCount + '|' + an.boneCount + '|' + an.segBytes + '|' + an.fps + '|'); put('segs', an.segs) }
  // ③ 台账（`mdlDiag`）也进指纹：它同样是"改前/改后"的观测量（本项新增 `layout='mdlv0016-compact'`）
  h.update('diag=' + JSON.stringify(m.mdlDiag === undefined ? null : m.mdlDiag))
  return h.digest('hex')
}

// ── 取证用读数（**独立**于被测实现：按容器布局自己从字节里算一遍，用于"判据复算"）──
//   ⚠ 这里刻意不复用 `core/` 的读数函数：如果实现与语料同时漂移，本组仍能独立发现问题。
function readV16Geometry(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const magic = b.toString('latin1', 0, 8)
  let pe = 21
  while (pe < b.length && b[pe] !== 0) pe++
  const materialPath = b.toString('utf8', 21, pe)
  let p = pe + 1, gap = 0
  while (p < b.length && b[p] === 0) { p++; gap++ }
  const tag = dv.getUint32(p, true)
  const vertexBytes = dv.getUint32(p + 4, true)
  const verticesOffset = p + 8
  const indexLenOffset = verticesOffset + vertexBytes
  const indexBytes = dv.getUint32(indexLenOffset, true)
  const indicesOffset = indexLenOffset + 4
  const mdlsOffset = b.indexOf('MDLS', 0, 'latin1')
  const stride = vertexBytes % 52 === 0 ? 52 : (vertexBytes % 80 === 0 ? 80 : null)
  const vertexCount = stride ? vertexBytes / stride : null
  let maxIndex = -1, overRange = 0
  const indexCount = indexBytes / 2
  for (let k = 0; k < indexCount; k++) {
    const v = dv.getUint16(indicesOffset + k * 2, true)
    if (vertexCount !== null && v >= vertexCount) overRange++
    if (v > maxIndex) maxIndex = v
  }
  const declaredBones = mdlsOffset >= 0 ? dv.getUint32(mdlsOffset + 13, true) : 0
  // 52 布局：pos@0 / 混合索引@12 / 权重@28 / uv@44
  let posBad = 0, uvBad = 0, wMin = Infinity, wMax = -Infinity, maxBlend = -1, zAllZero = true
  let degen = 0, tris = 0
  const pos = []
  if (stride === 52 && vertexCount !== null) {
    for (let i = 0; i < vertexCount; i++) {
      const o = verticesOffset + i * 52
      const q = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]
      if (!q.every((v) => isFinite(v) && Math.abs(v) <= 1e6)) posBad++
      if (q[2] !== 0) zAllZero = false
      pos.push(q)
      const u = dv.getFloat32(o + 44, true), v = dv.getFloat32(o + 48, true)
      if (!isFinite(u) || !isFinite(v)) uvBad++
      const s = [0, 1, 2, 3].reduce((a, k) => a + dv.getFloat32(o + 28 + k * 4, true), 0)
      if (s < wMin) wMin = s
      if (s > wMax) wMax = s
      for (let k = 0; k < 4; k++) { const bi = dv.getUint32(o + 12 + k * 4, true); if (bi > maxBlend) maxBlend = bi }
    }
    for (let k = 0; k + 2 < indexCount; k += 3) {
      const a = dv.getUint16(indicesOffset + k * 2, true), c = dv.getUint16(indicesOffset + k * 2 + 2, true), d = dv.getUint16(indicesOffset + k * 2 + 4, true)
      if (a >= pos.length || c >= pos.length || d >= pos.length) continue
      const e1 = [pos[c][0] - pos[a][0], pos[c][1] - pos[a][1]], e2 = [pos[d][0] - pos[a][0], pos[d][1] - pos[a][1]]
      const cr = e1[0] * e2[1] - e1[1] * e2[0]
      tris++
      if (Math.abs(cr) < 1e-9) degen++
    }
  }
  return {
    magic, pathEnd: pe, materialPath, gap, blockHeaderOffset: p, tag, vertexBytes, verticesOffset,
    indexLenOffset, indexBytes, indicesOffset, mdlsOffset, stride, vertexCount, indexCount,
    maxIndexPlus1: maxIndex + 1, overRange, declaredBones, posBad, uvBad, wMin, wMax, maxBlend, zAllZero, degen, tris,
    gapToMdls: mdlsOffset >= 0 ? mdlsOffset - (indicesOffset + indexBytes) : null,
  }
}
const hex = (n, w = 8) => '0x' + (n >>> 0).toString(16).padStart(w, '0')

// ══════════════════════════════════════════════════════════════════════════════════════════
// ⓪ 语料定位（只读 entry 表 + 流式读单个 `.mdl` entry；绝不整包 readFileSync）
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('⓪ 语料定位（`$MPW_ROOT/allwallpaper` + `~/.dsh-mpkg-wallpaper`）')
const WS_ROOT = process.env.MPW_ROOT || WS
const ROOTS = [path.join(WS_ROOT, 'allwallpaper'), path.join(os.homedir(), '.dsh-mpkg-wallpaper')]
const PKGS = []
for (const r of ROOTS) { if (!fs.existsSync(r)) continue; for (const p of walkContainers(r)) PKGS.push(p) }
const ROWS = []   // { pkg, idx, entry } —— 语料里全部 `.mdl` 行（172 行）
for (const f of PKGS) {
  let idx
  try { idx = readIndexHead(f) } catch { continue }
  for (const e of idx.entries.filter((x) => /\.mdl$/i.test(x.name))) ROWS.push({ pkg: f, idx, entry: e })
}
check('⓪ 语料', '语料根存在且容器数 > 0', PKGS.length > 0, 'containers=' + PKGS.length)
check('⓪ 语料', '`.mdl` 行数 ≥ 165（自导出基线；2026-10-04 语料漂移同步：wallpapertest1_* → delete/，172→165）', ROWS.length >= 165, 'rows=' + ROWS.length)

// 5 个救回目标：`0923/2887099508` 的 `MDLV0016` + 有 MDLS
const V16 = []
for (const r of ROWS) {
  let b
  try { b = readEntryBytes(r.pkg, r.idx, r.entry) } catch { continue }
  if (b.toString('latin1', 0, 8) !== 'MDLV0016') continue
  const mo = b.indexOf('MDLS', 0, 'latin1')
  if (mo < 0) { V16.push({ pkg: r.pkg, idx: r.idx, entry: r.entry, bytes: b, noMdls: true }); continue }
  V16.push({ pkg: r.pkg, idx: r.idx, entry: r.entry, name: r.entry.name, bytes: b, noMdls: false, geo: readV16Geometry(b) })
}
const FIVE = V16.filter((v) => !v.noMdls)
const NO_MDLS_V16 = V16.filter((v) => v.noMdls)
check('⓪ 语料', '语料里 `MDLV0016` = 5 个（带 MDLS，本项目标）+ 1 个（无 MDLS，**有意不接**）',
  FIVE.length === 5 && NO_MDLS_V16.length === 1,
  'withMdls=' + FIVE.length + ' noMdls=' + NO_MDLS_V16.length + '（' + V16.map((v) => v.entry.name).join(' / ') + '）')
check('⓪ 语料', '5 个目标文件全部来自 `0923/2887099508`', FIVE.length === 5 && FIVE.every((v) => /2887099508/.test(v.pkg)),
  FIVE.map((v) => path.basename(path.dirname(v.pkg))).join(','))

// ══════════════════════════════════════════════════════════════════════════════════════════
// ① 逐字节取证 + 判据复算（5/5）—— 读数写进输出，报告直接引用
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('① 逐字节取证（5 个 `MDLV0016`；读数由本文件的独立读数器 `readV16Geometry` 算出）')
{
  const hdr13 = [...FIVE[0].bytes.subarray(8, 21)].map((x) => x.toString(16).padStart(2, '0')).join(' ')
  console.log('  · 固定头 `8..20`（5/5 逐字节相同）= ' + hdr13 + '；材质路径锚点 = 21（`materials/`）')
  const EXPECT = {
    'models/r ear1_puppet.mdl': { vb: 8684, vc: 167, ic: 891, bones: 2, mat: 'materials/r ear1.json' },
    'models/back leg body_puppet.mdl': { vb: 33488, vc: 644, ic: 3255, bones: 5, mat: 'materials/back leg body.json' },
    'models/L ear1_puppet.mdl': { vb: 8684, vc: 167, ic: 888, bones: 2, mat: 'materials/L ear1.json' },
    'models/hand book_puppet.mdl': { vb: 16900, vc: 325, ic: 1659, bones: 2, mat: 'materials/hand book.json' },
    'models/front leg_puppet.mdl': { vb: 152776, vc: 2938, ic: 17262, bones: 3, mat: 'materials/front leg.json' },
  }
  for (const v of FIVE) {
    const g = v.geo, E = EXPECT[v.entry.name] || {}
    console.log('  · ' + v.entry.name.padEnd(32) + ' size=' + String(v.bytes.length).padStart(6)
      + ' vb=' + String(g.vertexBytes).padStart(6) + '(/52=' + g.vertexBytes / 52 + ')'
      + ' vc=' + g.vertexCount + ' maxIndex+1=' + g.maxIndexPlus1
      + ' ic=' + g.indexCount + ' gapToMDLS=' + g.gapToMdls
      + ' gap=' + g.gap + ' tag=' + hex(g.tag) + ' bones=' + g.declaredBones)
    console.log('        权重和∈[' + g.wMin.toFixed(6) + ',' + g.wMax.toFixed(6) + '] maxBlendIndex=' + g.maxBlend
      + ' 越界索引=' + g.overRange + ' posBad=' + g.posBad + ' uvBad=' + g.uvBad
      + ' z≡0=' + g.zAllZero + ' 退化三角形=' + g.degen + '/' + g.tris)
    check('① 取证', '材质路径锚点（21 起 `materials/…`）：' + v.entry.name, g.pathEnd > 21 && g.materialPath === E.mat, g.materialPath)
    check('① 取证', '块签名 == `0x01800009`、cstr 后 0 填充 == 4 字节：' + v.entry.name, g.tag === 0x01800009 && g.gap === 4, hex(g.tag) + ' gap=' + g.gap)
    check('① 取证', '顶点字节数 == ' + E.vb + '（% 52 == 0 且 **% 80 ≠ 0**）：' + v.entry.name,
      g.vertexBytes === E.vb && g.vertexBytes % 52 === 0 && g.vertexBytes % 80 !== 0, 'vb=' + g.vertexBytes + ' %80=' + (g.vertexBytes % 80))
    check('① 取证', '**顶点数与索引域互证**：`vb / 52 === maxIndex + 1`：' + v.entry.name,
      g.vertexCount === E.vc && g.maxIndexPlus1 === g.vertexCount, 'vc=' + g.vertexCount + ' maxIndex+1=' + g.maxIndexPlus1)
    check('① 取证', '索引块紧接顶点数据、索引数据写到 MDLS 起点（gapToMDLS == 0）：' + v.entry.name,
      g.indexBytes === E.ic * 2 && g.gapToMdls === 0, 'ib=' + g.indexBytes + ' gap=' + g.gapToMdls)
    check('① 取证', '全量索引界内（越界数 0）+ 52 布局逐顶点判据（权重和 / 混合索引 / pos / uv / z≡0 / 退化三角形 0）：' + v.entry.name,
      g.overRange === 0 && g.posBad === 0 && g.uvBad === 0 && Math.abs(g.wMin - 1) < 1e-6 && Math.abs(g.wMax - 1) < 1e-6
      && g.maxBlend < g.declaredBones && g.zAllZero && g.degen === 0,
      'overRange=' + g.overRange + ' wSum=[' + g.wMin.toFixed(6) + ',' + g.wMax.toFixed(6) + '] maxBlend=' + g.maxBlend + '/' + g.declaredBones + ' degen=' + g.degen)
    check('① 取证', '声明骨数 == ' + E.bones + '（与 MDLS 逐骨记录一致）：' + v.entry.name, g.declaredBones === E.bones, 'declared=' + g.declaredBones)
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// ② 改前 / 改后全语料对拍（"改前" = 把新分支关掉的 core 副本，等价于 git HEAD 的行为）
//   ⚠ 内存纪律：逐行 read → 解析 → 流式 hash → **立刻丢引用**，不把 172 个 mesh 常驻（峰值实测见文件尾）。
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('② 改前 / 改后全语料对拍（逐字段流式 sha256；"改前" = 新分支关掉的副本）')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p173-mut-'))
const CORE_SRC = path.join(ROOT, 'core')
let mutN = 0
async function withMutant(label, from, to, fn) {
  const dir = path.join(TMP, 'm' + (++mutN))
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(CORE_SRC)) {
    const srcF = path.join(CORE_SRC, f)
    if (!fs.statSync(srcF).isFile()) continue
    fs.copyFileSync(srcF, path.join(dir, f))
  }
  const p = path.join(dir, 'attach-transform.mjs')
  const src = fs.readFileSync(p, 'utf8')
  if (!src.includes(from)) { check('⑤ 变异自证', label + '：变异锚点存在', false, '锚点未命中'); return null }
  fs.writeFileSync(p, src.replace(from, to))
  const mod = await import(pathToFileURL(p).href + '?v=' + mutN)
  return fn(mod)
}
const BRANCH_ENTRY = '  return readMdlv0016CompactVertexBlock(raw, dv, mdlsOffset)'
const M1 = await withMutant('M1 关掉新分支', BRANCH_ENTRY,
  '  return { block: null, diag: null } /* MUT-M1 */', (mod) => mod)
check('② 对拍', '变异 M1（关掉新分支）已构造且可 import（= 改动前行为的等价物）', !!M1 && typeof M1.parseMdl === 'function')
{
  const changed = [], newMesh = [], lostMesh = [], becameNull = []
  let rows = 0, corpusWarns = 0
  const ow = console.warn
  console.warn = () => { corpusWarns++ }   // 语料里有 3 个 P-152b 救回文件（× 两个模块）= 6 行既有 warn，不往本项输出里灌
  try {
    for (const r of ROWS) {
      let b
      try { b = readEntryBytes(r.pkg, r.idx, r.entry) } catch { continue }
      rows++
      const a = parseMdl(b)
      const hA = a ? hashFields(a) : null
      const p = M1.parseMdl(b)
      const hP = p ? hashFields(p) : null
      if (hA !== hP) {
        const key = path.basename(path.dirname(r.pkg)) + '/' + r.entry.name
        changed.push({ key, magic: b.toString('latin1', 0, 8), hA, hP, vc: a && a.vertexCount, ic: a && a.indexCount, bones: a && a.bones.length })
        if (!p && a) newMesh.push(key)
        else if (p && !a) lostMesh.push(key)
        else becameNull.push(key)
      }
    }
  } finally { console.warn = ow }
  console.log('  · 语料行数 = ' + rows + '；逐字段指纹不同的行 = ' + changed.length + '；改前 null → 改后有网格 = ' + newMesh.length + '；反向 = ' + lostMesh.length + '；两侧都不为 null 但字段不同 = ' + becameNull.length)
  console.log('  · 对拍期间两个模块共打 warn ' + corpusWarns + ' 行（既有 P-152b 救回文件 × 两份模块，与本项无关）')
  for (const c of changed) console.log('    - ' + c.key + ' [' + c.magic + '] 改前=' + (c.hP ? c.hP.slice(0, 12) : 'null') + ' 改后=' + (c.hA ? c.hA.slice(0, 12) : 'null') + ' vc=' + c.vc + ' ic=' + c.ic + ' bones=' + c.bones)
  check('② 对拍', '全语料行数 ≥ 165（2026-10-04 语料漂移同步：wallpapertest1_* → delete/）', rows >= 165, 'rows=' + rows)
  check('② 对拍', '**除这 5 个之外逐字段不变**（指纹不同的行 == 5，且全部是"改前 null → 改后有网格"）',
    changed.length === 5 && newMesh.length === 5 && lostMesh.length === 0 && becameNull.length === 0,
    'changed=' + changed.length + ' newMesh=' + newMesh.length + ' lost=' + lostMesh.length + ' sameNonNullDiff=' + becameNull.length)
  check('② 对拍', '改前 null → 改后有网格的 5 行**逐名点名**（不多不少）',
    FIVE.every((v) => newMesh.some((k) => k.endsWith('/' + v.entry.name))) && newMesh.every((k) => FIVE.some((v) => k.endsWith('/' + v.entry.name))),
    newMesh.map((k) => k.split('/').pop()).join(' / '))
  check('② 对拍', '没有一行"改前能解析、改后变 null"（零回归）', lostMesh.length === 0, 'lost=' + lostMesh.length)
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// ③ 改后骨架 + 台账 + 两侧（core ⇔ elysia）+ `?mdls=legacy` 两档
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('③ 改后骨架 / 台账 / 两侧 / 两档')
const DECLARED = { 'models/r ear1_puppet.mdl': 2, 'models/back leg body_puppet.mdl': 5, 'models/L ear1_puppet.mdl': 2, 'models/hand book_puppet.mdl': 2, 'models/front leg_puppet.mdl': 3 }
let coreWarns = 0, twoModeSame = 0, bothSidesSame = 0
{
  const ow = console.warn, warns = []
  console.warn = (...a) => warns.push(a.join(' '))
  for (const v of FIVE) {
    const declared = DECLARED[v.entry.name]
    const m = parseMdl(v.bytes)
    check('③ 骨架', '改后**给出骨架**且骨数 == 声明骨数（' + declared + '）：' + v.entry.name,
      !!m && m.bones.length === declared, m ? ('bones=' + m.bones.length + ' vc=' + m.vertexCount + ' ic=' + m.indexCount) : 'parseMdl=null')
    // 骨架逐骨合法（parent 在界内 / 材质索引有界）—— 与 P-152 同族判据
    const boneOK = !!m && m.bones.every((b, i) => b.index === i && (b.parent === -1 || (b.parent >= 0 && b.parent < declared)) && b.type >= 0 && b.type < 100000)
    check('③ 骨架', '骨架逐骨可判（index/parent/材质索引）：' + v.entry.name, boneOK)
    // 顶点块是"解析成功"还是"如实跳过"：本项是**解析成功**（顶点/索引/混合全给），台账里带计数
    const led = m && m.mdlDiag
    check('③ 骨架', '台账 = `layout:mdlv0016-compact` + `mesh.variant:mdlv0016-compact-52` + 顶点/索引计数（"解析成功"的机器可判证据）：' + v.entry.name,
      !!led && led.layout === 'mdlv0016-compact' && led.rejected === false && !!led.mesh && led.mesh.variant === 'mdlv0016-compact-52'
      && led.mesh.stride === 52 && led.mesh.vertexCount === v.geo.vertexCount && led.mesh.indexCount === v.geo.indexCount,
      led ? JSON.stringify(led.mesh) : 'null')
    check('③ 骨架', '顶点块**不是**"如实跳过"：三组顶点流长度 == 顶点数、索引数 == 索引字节/2：' + v.entry.name,
      !!m && m.positions.length === v.geo.vertexCount && m.uvs.length === v.geo.vertexCount
      && m.blendIndices.length === v.geo.vertexCount && m.blendWeights.length === v.geo.vertexCount
      && m.indices.length === v.geo.indexCount, m ? ('pos=' + m.positions.length + ' uv=' + m.uvs.length + ' bi=' + m.blendIndices.length + ' bw=' + m.blendWeights.length + ' idx=' + m.indices.length) : 'null')
    // 运行时闸门（`demo.html:4190`）：蒙皮要求 `mesh.bones.length && mesh.animations.length` —— 只有"网格解析出来"
    // 还不够，必须同时有 MDLA 动画，这一层才会真的被蒙皮渲染。
    check('③ 骨架', 'MDLA 动画在位（`demo.html` 的蒙皮闸门要求 `bones && animations` 都非空）：' + v.entry.name,
      !!m && m.animations.length >= 1 && m.animations.every((a) => a.boneCount === declared && a.frameCount >= 2 && a.segs.length === a.boneCount && a.fps >= 1 && a.fps <= 240),
      m ? m.animations.map((a) => a.name + '#' + a.id + '(frames=' + a.frameCount + ' bones=' + a.boneCount + ' fps=' + a.fps + ')').join(' / ') : 'null')
    // 两档（默认 / `?mdls=legacy`）逐字段相同：`?mdls=legacy` 的文档语义只关"骨骼布局校验"，不管网格容器变体
    const ml = parseMdl(v.bytes, { mdls: 'legacy' })
    const same = !!m && !!ml && hashFields({ ...m, mdlDiag: undefined }) === hashFields({ ...ml, mdlDiag: undefined })
    if (same) twoModeSame++
    check('③ 骨架', '两档（默认 / `?mdls=legacy`）**逐字段相同**：' + v.entry.name, same, same ? 'sha 相同' : '不同')
    // elysia 侧（`demo.html` 实际运行的那份）：必须同一份实现给出同一副骨架/网格
    const el = H._parseMdl(new MpwBuffer(v.bytes.buffer, v.bytes.byteOffset, v.bytes.byteLength))
    const ell = H._parseMdl(new MpwBuffer(v.bytes.buffer, v.bytes.byteOffset, v.bytes.byteLength), { mdls: 'legacy' })
    const sideSame = !!el && el.vertexCount === m.vertexCount && el.indexCount === m.indexCount
      && JSON.stringify(el.positions) === JSON.stringify(m.positions) && JSON.stringify(el.uvs) === JSON.stringify(m.uvs)
      && JSON.stringify(el.indices) === JSON.stringify(m.indices) && JSON.stringify(el.blendIndices) === JSON.stringify(m.blendIndices)
      && JSON.stringify(el.blendWeights) === JSON.stringify(m.blendWeights) && JSON.stringify(el.bones) === JSON.stringify(m.bones)
    if (sideSame) bothSidesSame++
    check('③ 骨架', 'elysia 侧与 core **逐位相同**（网格五组 + 骨架）：' + v.entry.name, sideSame,
      el ? ('elysia vc=' + el.vertexCount + ' bones=' + el.bones.length) : 'elysia=null')
    void ell
  }
  /* 无 MDLS 的第 6 个 `MDLV0016`（`Hollow Cylinder`，块签名 `0x0000000f`、步长 48）：
     P-173 当年**有意不接**（两侧都 null）。**P-250（2026-10-07）改为接**：它是 48B 静态 PBR 布局
     （`pos3@0+normal3@12+tangent4@24+uv2@40`），语料 86 个文件命中该签名（42 个此前完全解析不了、
     40 个被误判成 80B）⇒ 本组改为断言"两侧都给出同一份**无骨**静态网格"（本分支仍不碰它：48B 走
     `findMdlStride48Block`，而本文件是 MDLV0016 **且无 MDLS** ⇒ 只有 48 分支认它）。 */
  {
    const nv = NO_MDLS_V16[0]
    const nb = nv ? readEntryBytes(nv.pkg, nv.idx, nv.entry) : null
    const cn = nb ? parseMdl(nb) : '缺'
    const en = nb ? H._parseMdl(new MpwBuffer(nb.buffer, nb.byteOffset, nb.byteLength)) : '缺'
    const same = !!cn && !!en && cn.vertexCount === en.vertexCount && cn.indexCount === en.indexCount &&
      (cn.bones || []).length === 0 && (en.bones || []).length === 0
    check('③ 骨架', '无 MDLS 的第 6 个 `MDLV0016`（`Hollow Cylinder`）按 **P-250 的 48B 静态布局**解析：两侧同网格 + 零骨',
      same, (nv ? nv.entry.name : '(缺)') + ' core=' + (cn === '缺' ? '缺' : (cn ? 'vc=' + cn.vertexCount + ' bones=' + (cn.bones || []).length : 'null')) +
        ' elysia=' + (en === '缺' ? '缺' : (en ? 'vc=' + en.vertexCount + ' bones=' + (en.bones || []).length : 'null')))
  }
  console.warn = ow
  coreWarns = warns.length
}
check('③ 骨架', '5/5 两档逐字段相同', twoModeSame === 5, 'twoModeSame=' + twoModeSame + '/5')
check('③ 骨架', '5/5 两侧（core ⇔ elysia）逐位相同', bothSidesSame === 5, 'bothSidesSame=' + bothSidesSame + '/5')
check('③ 骨架', '解析这 5 个文件**一行 warn 都不打**（救回是正常路径，日志面不留噪声）', coreWarns === 0, 'warns=' + coreWarns)

// ══════════════════════════════════════════════════════════════════════════════════════════
// ④ 合成边界夹具（真语料字节 + 定址改写；**必须仍被拒**）+ 具名判据探针
//   探针 = 变异自证的红集单位（`run(mod) -> {ok, info}`）；`needsBranch` = "新分支不生效就该红"。
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('④ 合成边界夹具（定址改写真实字节）+ 具名判据探针')
const TPL = FIVE[0]                       // models/r ear1_puppet.mdl（20194B，最小）
const G = TPL.geo
const dview = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength)
const FIXTURES = []
{
  // 每条夹具：label / build() -> { bytes | mdlsOverride } / expectReason（null = "分支不该被触发"）
  FIXTURES.push({ label: '块签名篡改（0x01800009 → 0x0180000f）', expectReason: 'vertex-block-tag-mismatch', build: () => { const f = Buffer.from(TPL.bytes); f.writeUInt32LE(0x0180000f, G.blockHeaderOffset); return f } })
  FIXTURES.push({ label: '起点写错（cstr 后第一个 0 填充字节写 1）', expectReason: 'vertex-block-tag-mismatch', build: () => { const f = Buffer.from(TPL.bytes); f[G.pathEnd + 1] = 1; return f } })
  FIXTURES.push({ label: '顶点字节数不是 52 的倍数（+4）', expectReason: 'vertex-bytes-not-multiple-of-52', build: () => { const f = Buffer.from(TPL.bytes); f.writeUInt32LE(G.vertexBytes + 4, G.blockHeaderOffset + 4); return f } })
  FIXTURES.push({ label: '索引越界（首索引写 vertexCount）', expectReason: 'index-out-of-range', build: () => { const f = Buffer.from(TPL.bytes); f.writeUInt16LE(G.vertexCount, G.indicesOffset); return f } })
  FIXTURES.push({ label: '顶点数与索引域不符（把所有 == maxIndex 的索引降到 maxIndex-1）', expectReason: 'vertex-count-mismatch', build: () => { const f = Buffer.from(TPL.bytes); for (let k = 0; k < G.indexCount; k++) { if (f.readUInt16LE(G.indicesOffset + k * 2) === G.maxIndexPlus1 - 1) f.writeUInt16LE(G.maxIndexPlus1 - 2, G.indicesOffset + k * 2) } return f } })
  FIXTURES.push({ label: '权重和不归一（首顶点 w0 写 0.5）', expectReason: 'vertex-weights-not-normalized', build: () => { const f = Buffer.from(TPL.bytes); f.writeFloatLE(0.5, G.verticesOffset + 28); return f } })
  FIXTURES.push({ label: '混合索引越界（首顶点 bi0 写 declaredBones）', expectReason: 'blend-index-out-of-range', build: () => { const f = Buffer.from(TPL.bytes); f.writeUInt32LE(G.declaredBones, G.verticesOffset + 12); return f } })
  FIXTURES.push({ label: 'pos 非有限（首顶点 x 写 NaN）', expectReason: 'vertex-position-invalid', build: () => { const f = Buffer.from(TPL.bytes); f.writeFloatLE(NaN, G.verticesOffset); return f } })
  FIXTURES.push({ label: 'uv 非有限（首顶点 u 写 NaN）', expectReason: 'vertex-uv-not-finite', build: () => { const f = Buffer.from(TPL.bytes); f.writeFloatLE(NaN, G.verticesOffset + 44); return f } })
  FIXTURES.push({ label: '索引块越出文件尾（indexBytes → 1MiB）', expectReason: 'index-block-overruns-file', build: () => { const f = Buffer.from(TPL.bytes); f.writeUInt32LE(1 << 20, G.indexLenOffset); return f } })
  FIXTURES.push({ label: '顶点块越出文件尾（vertexBytes → 52×100000）', expectReason: 'vertex-block-overruns-file', build: () => { const f = Buffer.from(TPL.bytes); f.writeUInt32LE(52 * 100000, G.blockHeaderOffset + 4); return f } })
  FIXTURES.push({ label: '索引块越过 MDLS 起点（mdlsOffset 落在索引数据中间）', expectReason: 'mesh-overruns-mdls', direct: (mod, bytes) => mod.readMdlv0016CompactVertexBlock(bytes, dview(bytes), G.indicesOffset + 10) })
  FIXTURES.push({ label: '声明骨数越界（MDLS 骨数写 0）', expectReason: 'declared-bone-count-out-of-range', build: () => { const f = Buffer.from(TPL.bytes); f.writeUInt32LE(0, G.mdlsOffset + 13); return f } })
  FIXTURES.push({ label: '材质路径锚点错位（21 起改成 `materiaX`）', expectReason: 'material-path-not-at-21', build: () => { const f = Buffer.from(TPL.bytes); f.write('materiaX', 21, 'latin1'); return f } })
  FIXTURES.push({ label: '伪造 magic（MDLV0016 → MDLV0023）', expectReason: null, build: () => { const f = Buffer.from(TPL.bytes); f.write('MDLV0023', 0, 'latin1'); return f } })
  FIXTURES.push({ label: '截断（切在顶点块中间 ⇒ MDLS 一起没了）', expectReason: null, build: () => Buffer.from(TPL.bytes.subarray(0, G.verticesOffset + 100)) })
}
// 探针注册表：每条 `run(mod)` 返回 `{ ok, info }`；`needsBranch` = 新分支不生效时**必须**红
const PROBES = []
for (const v of FIVE) {
  const declared = DECLARED[v.entry.name]
  PROBES.push({
    name: 'five:' + v.entry.name, needsBranch: true,
    run: (mod) => {
      const m = mod.parseMdl(v.bytes)
      const ok = !!m && m.vertexCount === v.geo.vertexCount && m.indexCount === v.geo.indexCount && m.bones.length === declared
      return { ok, info: m ? ('vc=' + m.vertexCount + ' bones=' + m.bones.length) : 'null' }
    },
  })
}
for (const fx of FIXTURES) {
  PROBES.push({
    // `needsBranch` = "**关掉新分支入口**（M1）就该红"。`direct` 的判据隔离夹具直接调 finder
    //   ⇒ 它不受入口开关影响（由"去掉该条判据"的变异 M6 负责打红），故显式排除。
    name: 'fixture:' + fx.label, needsBranch: !!fx.expectReason && !fx.direct,
    run: (mod) => {
      // ③(P-173) "如实拒绝"= `null` + **恰好一行** `[P-173]` warn（内容带 reason）+ 机器可判 `mdlDiag.reason`；
      //   "分支不被触发"的夹具（伪造 magic / 截断）反过来要求 **0 行** warn、**无**台账。
      if (fx.direct) {
        const cap = capture(() => fx.direct(mod, TPL.bytes))
        const r = cap.r
        const ok = !!r && r.block === null && !!r.diag && r.diag.rejected === true && r.diag.reason === fx.expectReason && cap.warns.length === 0
        return { ok, info: 'direct reason=' + (r && r.diag && r.diag.reason) + ' warns=' + cap.warns.length }
      }
      const bytes = fx.build()
      const sink = {}
      const cap = capture(() => mod.parseMdl(bytes, { diag: sink }))
      const m = cap.r
      if (fx.expectReason === null) {
        const ok = m === null && sink.mdlDiag === undefined && cap.warns.length === 0
        return { ok, info: 'null=' + (m === null) + ' diag=' + (sink.mdlDiag === undefined ? '未触发' : sink.mdlDiag.reason) + ' warns=' + cap.warns.length }
      }
      const warnOK = cap.warns.length === 1 && cap.warns[0].includes('[P-173]') && cap.warns[0].includes('reason=' + fx.expectReason)
      const ok = m === null && !!sink.mdlDiag && sink.mdlDiag.rejected === true && sink.mdlDiag.reason === fx.expectReason && warnOK
      return { ok, info: (m === null ? 'null' : 'ACCEPTED(vc=' + m.vertexCount + ')') + ' reason=' + (sink.mdlDiag && sink.mdlDiag.reason) + ' warn=' + (warnOK ? '恰好一行且带 reason' : JSON.stringify(cap.warns)) }
    },
  })
}
PROBES.push({
  name: 'meta:无 MDLS 的第 6 个 MDLV0016 走 48B 静态布局（P-250）', needsBranch: false,
  run: () => {
    const nv = NO_MDLS_V16[0]
    if (!nv) return { ok: false, info: '缺文件' }
    const nb = readEntryBytes(nv.pkg, nv.idx, nv.entry)
    // ①(P-250 2026-10-07) 该文件现在是 **48B 静态布局**（P-173 当年"有意不接"的立场已被取代）⇒
    //   本探针改为断言：P-173 的紧凑分支**仍不碰它**（`diag=null`），而 `parseMdl` 经 48B 分支给出无骨网格。
    const r = readMdlv0016CompactVertexBlock(nb, dview(nb), nb.indexOf('MDLS', 0, 'latin1'))
    const m = parseMdl(nb)
    return {
      ok: r.block === null && r.diag === null && !!m && (m.bones || []).length === 0,
      info: 'compactBranch=' + (r.block === null ? '不接' : '接了') + ' diag=' + (r.diag === null ? '未触发' : r.diag.reason) +
        ' parseMdl=' + (m ? ('vc=' + m.vertexCount + ' bones=' + (m.bones || []).length) : 'null'),
    }
  },
})
PROBES.push({
  name: 'meta:5 个文件两档逐字段相同', needsBranch: true,
  run: (mod) => {
    let n = 0
    for (const v of FIVE) {
      const a = mod.parseMdl(v.bytes), b = mod.parseMdl(v.bytes, { mdls: 'legacy' })
      if (a && b && hashFields({ ...a, mdlDiag: undefined }) === hashFields({ ...b, mdlDiag: undefined })) n++
    }
    return { ok: n === 5, info: 'same=' + n + '/5' }
  },
})
PROBES.push({
  name: 'meta:5 个文件解析零 warn', needsBranch: false,
  run: (mod) => {
    let w = 0
    for (const v of FIVE) w += capture(() => mod.parseMdl(v.bytes)).warns.length
    return { ok: w === 0, info: 'warns=' + w }
  },
})
{
  const reds = []
  let quietWarns = 0
  const ow = console.warn
  console.warn = () => { quietWarns++ }   // 夹具/探针内部的 warn 由各探针自己 `capture` 逐条断言；这里只挡外层噪声
  try {
    for (const p of PROBES) {
      const r = p.run((await import('../core/attach-transform.mjs')))
      check('④ 夹具', p.name, r.ok, r.info)
      if (!r.ok) reds.push(p.name)
    }
  } finally { console.warn = ow }
  check('④ 夹具', '全部探针在真模块上全绿（' + PROBES.length + ' 条）', reds.length === 0, reds.join(' | '))
  console.log('  · 夹具/探针运行期间的外层 warn = ' + quietWarns + ' 行（"该拒"夹具的 warn 由探针内部 `capture` 断言为**恰好一行且带 reason**）')
  // 原样读数：抽 3 条夹具把 warn 行**逐字**打印（报告直接引用）
  for (const label of ['块签名篡改（0x01800009 → 0x0180000f）', '混合索引越界（首顶点 bi0 写 declaredBones）', '权重和不归一（首顶点 w0 写 0.5）']) {
    const fx = FIXTURES.find((f) => f.label === label)
    const sink = {}
    const cap = capture(() => parseMdl(fx.build(), { diag: sink }))
    console.log('  · warn 原样[' + label + '] = ' + JSON.stringify(cap.warns) + ' | mdlDiag=' + JSON.stringify(sink.mdlDiag))
  }
}
console.log('  · 探针总数 = ' + PROBES.length + '（其中 `needsBranch` = ' + PROBES.filter((p) => p.needsBranch).length + '）')

// ══════════════════════════════════════════════════════════════════════════════════════════
// ⑤ 变异自证：**期望红集 == 实际红集**（真跑变异副本 + 真跑探针，组名逐名相等）
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('⑤ 变异自证（MUTANT-RED-OK：期望红集 == 实际红集；红集 = ④ 的具名探针）')
const needsBranchSet = () => PROBES.filter((p) => p.needsBranch).map((p) => p.name)
const FIX_NAME = (label) => 'fixture:' + label
const MUTATIONS = [
  {
    id: 'M1', label: '关掉新分支（= 逐位回到改动前）',
    from: BRANCH_ENTRY, to: '  return { block: null, diag: null } /* MUT-M1 */',
    expect: () => needsBranchSet(),
    why: '新分支不生效 ⇒ 5 个文件全部退回 null + 每条"该拒"夹具都失去原因 ⇒ needsBranch 集合全红',
  },
  {
    id: 'M2', label: '去掉块签名判据（`!== 0x01800009` 改成只看边界）',
    from: "if (p + 8 > raw.length || dv.getUint32(p, true) !== MDLV0016_VERTEX_TAG) return refuse('vertex-block-tag-mismatch')",
    to: "if (p + 8 > raw.length) return refuse('vertex-block-tag-mismatch') /* MUT-M2 */",
    expect: () => [FIX_NAME('块签名篡改（0x01800009 → 0x0180000f）'), FIX_NAME('起点写错（cstr 后第一个 0 填充字节写 1）')],
    why: '签名篡改夹具被**误收**（其余字段本来就对）；起点写错夹具的 reason 换成别的（不再是 tag 档）',
  },
  {
    id: 'M3', label: '去掉"全部索引 < 顶点数"判据',
    from: '      if (v >= vertexCount) return refuse(\'index-out-of-range\', { at: k, index: v, vertexCount })\n',
    to: '', expect: () => [FIX_NAME('索引越界（首索引写 vertexCount）')],
    why: '索引越界夹具被**误收**（最大索引也从 166 变 167 ⇒ 顶点数判据反而"自洽"）',
  },
  {
    id: 'M4', label: '去掉"顶点数与索引域互证"判据',
    from: "    if (maxIndex + 1 !== vertexCount) return refuse('vertex-count-mismatch', { vertexCount, maxIndexPlus1: maxIndex + 1 })\n",
    to: '', expect: () => [FIX_NAME('顶点数与索引域不符（把所有 == maxIndex 的索引降到 maxIndex-1）')],
    why: '该夹具被**误收**（索引全在界内、其余判据全过）',
  },
  {
    id: 'M5', label: '去掉混合索引判据',
    from: '        if (bi >= declaredBones) return refuse(\'blend-index-out-of-range\', { at: i, blendIndex: bi, declaredBones })\n',
    to: '', expect: () => [FIX_NAME('混合索引越界（首顶点 bi0 写 declaredBones）')],
    why: '该夹具被**误收**',
  },
  {
    id: 'M6', label: '去掉"索引块不越过 MDLS 起点"判据',
    from: "    if (indicesOffset + indexBytes > mdlsOffset) return refuse('mesh-overruns-mdls', { indexBytes })\n",
    to: '', expect: () => [FIX_NAME('索引块越过 MDLS 起点（mdlsOffset 落在索引数据中间）')],
    why: '判据隔离夹具（直接调 finder）不再给 `mesh-overruns-mdls`',
  },
  {
    id: 'M7', label: '去掉权重和判据',
    from: "      if (Math.abs(sum - 1) >= MDLV0016_WEIGHT_SUM_TOL) {\n        badWeights++\n        if (badWeights > allowedBadWeights) return refuse('vertex-weights-not-normalized', { at: i, weightSum: sum })\n      }\n",
    to: '', expect: () => [FIX_NAME('权重和不归一（首顶点 w0 写 0.5）')],
    why: '该夹具被**误收**',
  },
  {
    id: 'M8', label: '把新分支的起点写错（顶点数据 `+8` → `+8-52`）',
    from: '    const verticesOffset = p + 8\n', to: '    const verticesOffset = p + 8 - 52 /* MUT-M8 */\n',
    // ⚠ 期望红集**逐条列出**（不是 `needsBranch` 全集）：起点错位只影响"读址在 verticesOffset 之后"的判据。
    expect: () => [
      ...FIVE.map((v) => 'five:' + v.entry.name),
      FIX_NAME('索引越界（首索引写 vertexCount）'),
      FIX_NAME('顶点数与索引域不符（把所有 == maxIndex 的索引降到 maxIndex-1）'),
      FIX_NAME('权重和不归一（首顶点 w0 写 0.5）'),
      FIX_NAME('混合索引越界（首顶点 bi0 写 declaredBones）'),
      FIX_NAME('pos 非有限（首顶点 x 写 NaN）'),
      FIX_NAME('uv 非有限（首顶点 u 写 NaN）'),
      FIX_NAME('索引块越过 MDLS 起点（mdlsOffset 落在索引数据中间）'),
      FIX_NAME('声明骨数越界（MDLS 骨数写 0）'),
      'meta:5 个文件两档逐字段相同',
      'meta:5 个文件解析零 warn',
    ],
    why: '起点错位 ⇒ 顶点/索引数据整体读错位：5 个文件全红 + 读址在 `verticesOffset` 之后的夹具全红 + 零 warn 探针变红（错位路径开始打 warn）。'
      + '**不在红集里的也如实登记**：① 块签名 / 0 填充起点 / `% 52` / 材质路径锚点这四条在 `verticesOffset` **之前**判，起点错位不影响它们；'
      + '② "顶点块越出文件尾"用的 `vertexBytes` 也是**错位前**读的（同因同档）；'
      + '③ "索引块越出文件尾"错位后读址仍越界（**碰巧同因**，不是判据强度，记在此处备查）。',
  },
]
for (const mut of MUTATIONS) {
  await withMutant(mut.id + ' ' + mut.label, mut.from, mut.to, (mod) => {
    const actual = []
    const ow = console.warn
    console.warn = () => {}    // 变异副本的 warn 不是本组判据（判据是红集），挡掉以免刷屏
    try {
      for (const p of PROBES) { if (!p.run(mod).ok) actual.push(p.name) }
    } finally { console.warn = ow }
    const expected = mut.expect()
    const same = expected.length === actual.length && expected.every((n) => actual.includes(n))
    check('⑤ 变异自证', mut.id + '：' + mut.label + ' ⇒ 期望红集 == 实际红集（' + expected.length + ' 条）', same,
      same ? (mut.id + ' 红集（' + actual.length + '）：' + actual.join(' | ')) : ('期望 ' + JSON.stringify(expected) + ' 实际 ' + JSON.stringify(actual)))
    if (same) console.log('MUTANT-RED-OK ' + mut.id + ' ' + mut.label + ' | 期望红集(' + expected.length + ') == 实际红集(' + actual.length + ') | ' + actual.join(' | '))
    console.log('    · 为什么这些必须红：' + mut.why)
  })
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// ⑥ 门禁登记
// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('⑥ 登记')
{
  const runAll = fs.readFileSync(path.join(ROOT, 'tests', 'run-all-tests.sh'), 'utf8')
  check('⑥ 登记', '`tests/run-all-tests.sh` 已注册本项（`add "mdlv0016" …`，追加在 add 列表末尾）',
    /add "mdlv0016"\s+"node tests\/mdlv0016-test\.mjs"/.test(runAll))
  check('⑥ 登记', '注册行**不带** SKIP 模式（语料是本项判据的可信来源 ⇒ 缺语料要红，不静默 SKIP）',
    !/add "mdlv0016"[^\n]*"\^SKIP/.test(runAll))
}

try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响判据 */ }

// ══════════════════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('语料：`MDLV0016` 带 MDLS = ' + FIVE.length + ' / 无 MDLS = ' + NO_MDLS_V16.length + '；行数 = ' + ROWS.length)
console.log('断言：PASS=' + PASS + ' FAIL=' + FAIL + (Object.keys(RED).length ? ' | 变红组：' + JSON.stringify(RED) : ''))
console.log('PeakRSS ≈ ' + (process.memoryUsage().rss / 1048576).toFixed(0) + 'MB')
console.log(FAIL === 0 ? 'ALL PASS' : 'FAILED')
process.exit(FAIL ? 1 : 0)

// layer-rect-check.mjs — 层实绘矩形工作台（定位"位置渲染错误"用）
// 用法:
//   node layer-rect-check.mjs <sceneId>             # allwallpaper/dd 下的 id
//   node layer-rect-check.mjs --pkg <pkg|mpkg 路径> # 任意容器
//   node layer-rect-check.mjs <id> --only 头部       # 只看名字含关键字的层
//   node layer-rect-check.mjs <id> --refrender      # 与 refrender-<id>.json（官方标定矩形）逐层对比
//   node layer-rect-check.mjs <id> --noattach       # 关闭附件锚点（对照 P-21-ATTACH 修复前行为）
//   node layer-rect-check.mjs <id> --t=<秒>         # 附件锚点按时刻 t 的骨骼位姿计算（默认 0=帧0，输出与旧版逐位一致）
//   node layer-rect-check.mjs --pkg <路径> --align=0 # 复现 P-21 修复前行为（origin 恒几何中心）
//   node layer-rect-check.mjs --pkg <路径> --json   # 末行追加 ##JSON## {…}（机读）
// 输出：每层 [x,y,w,h]（设计空间 y-down）+ 尺寸/中心 + 父链/对齐/attachment 标记 + 与标定矩形的 Δ
// P-21 A3：实绘矩形含 alignment 网格偏移（origin=对齐隐含枢轴，网格中心 = origin ± size/2）
// P-21-ATTACH(ELYSIA-DIFF) 2026-09-13：
//   - 默认走移植自 elysia 的附件锚点变换（parseScene opts.attachCtx；--noattach 对照修复前）；
//   - 自带 puppet 网格的层按**实绘矩形**计（官方：drawn = origin + scale·meshBBox，elysia
//     renderPuppet 同式；此前用对象 size 的框对网格层不是实绘框，眼睛组合会虚差 568px）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
import { parseMdl } from '../core/attach-transform.mjs'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'

const argv = process.argv.slice(2)
const pkgIdx = argv.indexOf('--pkg')
const onlyIdx = argv.indexOf('--only')
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null
const useRef = argv.includes('--refrender')
const alignOn = !argv.includes('--align=0')
const useJson = argv.includes('--json')
const noAttach = argv.includes('--noattach')
// ①(G 2026-09-14) --t=<秒>：附件锚点骨骼位姿取时刻 t（缺省 0 = 帧0，输出与旧版逐位一致）
const tIdx = argv.findIndex((a) => a.startsWith('--t='))
const attTime = tIdx >= 0 ? Number(argv[tIdx].slice(4)) || 0 : 0
const usedIdx = new Set()
if (pkgIdx >= 0) { usedIdx.add(pkgIdx); usedIdx.add(pkgIdx + 1) }
if (onlyIdx >= 0) { usedIdx.add(onlyIdx); usedIdx.add(onlyIdx + 1) }
const positional = argv.filter((a, i) => !usedIdx.has(i) && !a.startsWith('--'))
const DEC = new TextDecoder()

let pkgPath, sceneId = null
if (pkgIdx >= 0) pkgPath = argv[pkgIdx + 1]
else {
  sceneId = positional[0]
  pkgPath = `${MPW_WS}/allwallpaper/dd/${sceneId}/scene.pkg`
  // 也支持 .mpkg（用户包）
  if (!fs.existsSync(pkgPath) && fs.existsSync(`${MPW_PLUGIN_CACHE}/${sceneId}`)) pkgPath = `${MPW_PLUGIN_CACHE}/${sceneId}`
}
if (!pkgPath || !fs.existsSync(pkgPath)) { console.error('用法: node layer-rect-check.mjs <sceneId> | --pkg <路径> [--only 关键字] [--refrender] [--noattach] [--align=0] [--json]'); process.exit(2) }

const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
const readEntry = (n) => lib.getEntry(pkg, n)
const sceneRaw = JSON.parse(DEC.decode(new Uint8Array(readEntry('scene.json'))).replace(/^\uFEFF/, ''))
const rawById = new Map((sceneRaw.objects || []).map((o) => [o.id, o]))
const scene = lib.parseScene(sceneRaw, null, noAttach ? { uniformFlipY: true } : { attachCtx: { readEntry, time: attTime } })
const PROJ_H = (scene.general && scene.general.orthogonalprojection && scene.general.orthogonalprojection.height) || 2160

// 网格层判定 + 网格 bbox（模型空间）缓存
const modelJsonCache = new Map()
const meshCache = new Map()
const modelJsonOf = (img) => {
  if (!modelJsonCache.has(img)) {
    try { const e = readEntry(img); modelJsonCache.set(img, e ? JSON.parse(DEC.decode(e).replace(/^\uFEFF/, '')) : null) } catch { modelJsonCache.set(img, null) }
  }
  return modelJsonCache.get(img)
}
const meshOf = (puppetPath) => {
  if (!meshCache.has(puppetPath)) {
    try { const e = readEntry(puppetPath); meshCache.set(puppetPath, e ? parseMdl(e) : null) } catch { meshCache.set(puppetPath, null) }
  }
  return meshCache.get(puppetPath)
}
const meshBBoxOf = (raw) => {
  if (!raw || typeof raw.image !== 'string') return null
  const mj = modelJsonOf(raw.image)
  if (!mj || !mj.puppet) return null
  const mesh = meshOf(mj.puppet)
  if (!mesh || !mesh.positions || !mesh.positions.length) return null
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
  for (const p of mesh.positions) {
    if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]
    if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]
  }
  return { minX: mnx, minY: mny, maxX: mxx, maxY: mxy }
}

let ref = null
if (useRef && sceneId) {
  // ①(2026-09-16 目录整理) 兼容三个落点：仓库根（默认）→ 兼容旧 cwd；都找不到就静默跳过（原行为）。
  const cands = [`./refrender-${sceneId}.json`, `${MPW_WS}/we-scene-demo/refrender-${sceneId}.json`, `${MPW_WS}/we-scene-demo/archive/local/refrender-${sceneId}.json`]
  const f = cands.find((x) => fs.existsSync(x))
  if (f) ref = JSON.parse(fs.readFileSync(f, 'utf8'))
}

const rows = []
for (const l of scene.layers) {
  const raw = rawById.get(l.id) || {}
  if (only && String(l.name || '').indexOf(only) < 0) continue
  const sw = l.size[0] * l.scale[0]   // 有符号：负 scale 时偏移方向同步翻转（矩阵 T(align) 内乘 S 的语义）
  const sh = l.size[1] * l.scale[1]
  // P-21 A3：网格中心 = origin（对齐枢轴）± size/2；alignmentOffsetForToken 返回 y-up 偏移，
  // origin 已被 parseScene 翻转到 y-down → y 取反。假设层无旋转（语料非 center 层 angles 均为 0）
  const aoff = alignOn ? lib.alignmentOffsetForToken(l.alignment, sw, sh) : [0, 0]
  const bb = meshBBoxOf(raw)
  const isMesh = !!bb
  let w, h, cx, cy, rect
  if (isMesh) {
    // 实绘矩形（官方/elysia renderPuppet）：drawn = origin + scale·meshBBox（y-up → y-down 翻 y）
    const sx = l.scale[0], sy = l.scale[1]
    const x0 = l.origin[0] + sx * bb.minX, x1 = l.origin[0] + sx * bb.maxX
    const y0 = l.origin[1] - sy * bb.maxY, y1 = l.origin[1] - sy * bb.minY
    w = Math.abs(x1 - x0); h = Math.abs(y1 - y0)
    cx = (x0 + x1) / 2 + aoff[0]
    cy = (y0 + y1) / 2 - aoff[1]
    rect = [Math.min(x0, x1), Math.min(y0, y1), w, h]
  } else {
    w = Math.abs(sw)
    h = Math.abs(sh)
    cx = l.origin[0] + aoff[0]
    cy = l.origin[1] - aoff[1]
    rect = [cx - w / 2, cy - h / 2, w, h]
  }
  const owner = raw.image ? 'image' : (raw.particle ? 'particle' : (raw.text ? 'text' : (raw.sound ? 'sound' : (raw.light ? 'light' : 'container'))))
  // ①(P-30) 网格对角线（设计 px）：旋转不变上界，用于判定标定条目是否可达（见下方打印处注释）
  const diag = isMesh
    ? Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) * Math.max(Math.abs(l.scale[0]), Math.abs(l.scale[1]), 1e-6)
    : null
  rows.push({ l, raw, rect, w, h, cx, cy, owner, isMesh, diag, align: raw.alignment || 'center', parent: raw.parent, attach: raw.attachment, anim: !!l.animLayers })
}

console.log(`# ${pkgPath.split('/').slice(-1)[0]}  ${scene.layers.length} 层（显示 ${rows.length}）  设计画布 ${scene.general.orthogonalprojection ? scene.general.orthogonalprojection.width + 'x' + scene.general.orthogonalprojection.height : '?'} y-down  附件锚点=${noAttach ? '关(--noattach)' : '开(elysia移植)'}`)
console.log('id    名称            类型       对齐      实绘矩形[x,y,w,h]            中心            父/附件/动画     ' + (ref ? 'Δ中心 vs 标定    Δ尺寸' : ''))
for (const r of rows) {
  const cx = r.rect[0] + r.w / 2, cy = r.rect[1] + r.h / 2
  let line = `${String(r.l.id).padEnd(5)} ${String(r.l.name || '').slice(0, 12).padEnd(14)} ${(r.owner + (r.isMesh ? '+mesh' : '')).padEnd(9)} ${r.align.padEnd(9)} `
    + `[${r.rect.map((v) => Math.round(v)).join(',')}]`.padEnd(30)
    + `(${Math.round(cx)},${Math.round(cy)})`.padEnd(15)
    + `${r.parent !== undefined ? 'p=' + r.parent : '     '} ${r.attach ? 'att=' + r.attach : ''}${r.anim ? ' animL' : ''}`
  if (ref && ref[String(r.l.id)]) {
    const R = ref[String(r.l.id)]
    const ox = R[0] + R[2] / 2, oy = R[1] + R[3] / 2
    line += `   Δc=(${Math.round(cx - ox)},${Math.round(cy - oy)})`.padEnd(22) + ` Δs=(${Math.round(r.w - R[2])},${Math.round(r.h - R[3])})`
    // ①(P-30 2026-09-12) 标定可达性判据（旋转不变上界 = 网格对角线）：网格层做**任意刚体旋转**，
    //   其 AABB 的宽/高都不可能超过网格对角线。标定矩形若有任一边超过对角线，就说明这条标定
    //   **不是本层单帧实绘框**（多为官方预览里"可见区域"人工框 / 含其它层），拿它当判据会永远差一截。
    if (r.isMesh && r.diag) {
      const unreach = (R[2] > r.diag + 1 || R[3] > r.diag + 1)
      if (unreach) line += `  ⚠标定不可达(网格对角线 ${r.diag.toFixed(0)}px < 标定 ${Math.max(R[2], R[3]).toFixed(0)}px)`
    }
  } else if (ref) line += '   （标定表无此层）'
  console.log(line)
}

const nonCenter = rows.filter((r) => r.align !== 'center')
const parented = rows.filter((r) => r.parent !== undefined)
const attached = rows.filter((r) => r.attach)
const meshes = rows.filter((r) => r.isMesh)
console.log(`\n汇总：非 center 对齐 ${nonCenter.length} 层（P-21 A3 偏移${alignOn ? '已应用' : '已关闭(--align=0)'}：网格中心 = 枢轴 ± size/2）| 有父级 ${parented.length} 层（A4：合并用父 authored pivot，父 alignment 不下传）| attachment ${attached.length} 层 | puppet 网格 ${meshes.length} 层（按实绘 bbox 矩形计）`)
if (nonCenter.length) console.log('  非 center：' + nonCenter.slice(0, 12).map((r) => `${r.l.id}:${r.l.name}(${r.align})`).join(', '))
if (attached.length) console.log('  附件锚点：' + attached.slice(0, 12).map((r) => `${r.l.id}:${r.l.name}→${r.attach}`).join(', '))
if (ref) {
  const unreachable = rows.filter((r) => { const R = ref[String(r.l.id)]; return r.isMesh && r.diag && R && (R[2] > r.diag + 1 || R[3] > r.diag + 1) })
  if (unreachable.length) console.log(`  ⚠ 标定不可达 ${unreachable.length} 层：${unreachable.map((r) => `${r.l.id}:${r.l.name}(对角${r.diag.toFixed(0)}px)`).join(', ')} —— 这些 Δ 不是渲染误差（判据见 P-30）`)
  const ds = rows.filter((r) => ref[String(r.l.id)]).map((r) => {
    const R = ref[String(r.l.id)]
    return Math.hypot(r.rect[0] + r.w / 2 - (R[0] + R[2] / 2), r.rect[1] + r.h / 2 - (R[1] + R[3] / 2))
  })
  if (ds.length) console.log(`  与标定矩形中心距离：中位 ${ds.sort((a, b) => a - b)[Math.floor(ds.length / 2)].toFixed(0)}px，最大 ${ds[ds.length - 1].toFixed(0)}px`)
}
// P-21：机读输出（alignment-test.mjs 用；rect/center 为含 A3 偏移的精确值，未取整）
if (useJson) console.log('##JSON## ' + JSON.stringify(rows.map((r) => ({
  id: r.l.id, name: r.l.name || '', align: r.align, rect: r.rect.map((v) => +v.toFixed(6)),
  w: +r.w.toFixed(6), h: +r.h.toFixed(6), parent: r.parent,
}))))

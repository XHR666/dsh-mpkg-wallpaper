/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // alignment-test.mjs — P-21（WER-ALIGN A3/A4）验收测试
// 用法: node alignment-test.mjs
// 三层断言：
//   ① 纯数学层：9 种对齐 × 多组 size，手算期望值 vs lib.alignmentOffsetForToken（行为规格
//      docs/IMAGE-ALPHA-ALIGN-SPEC.md §2：left→+w/2、right→−w/2、top→−h/2、bottom→+h/2，组合 token 两轴各自独立），
//      外加 compositeLayer 使用的 quad 空间公式 (0.5−a)·(w,h)[y-down] 等价性、负 scale 翻转；
//   ② A4 纯数学层：合成父链场景（父 align=right 带 30° 旋转/缩放），断言子层合并 origin
//      与官方手推值一致，且与父 align=center 时逐位相同（父 alignment 不下传 = 剔除语义）；
//   ③ 语料层：3660962877（27 个非 center 层）用 `node layer-rect-check.mjs --pkg … --json`
//      修复前后(--align=0)矩形差 = 预期偏移；3719111841（全 center）任何矩形都不变；
//      3326873240 父 align=right 的子层：篡改父 alignment 重解析 → 子层合并 origin 不变。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as lib from '../core/we-scene-bundle.js'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 子进程 cwd 用仓库根
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

let pass = 0, fail = 0
const fails = []
function chk(cond, label, detail) {
  if (cond) { pass++ } else { fail++; fails.push(label + (detail !== undefined ? '  [' + detail + ']' : '')) }
}
const eq = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const eqv = (a, b, eps = 1e-6) => eq(a[0], b[0], eps) && eq(a[1], b[1], eps)

console.log('== ① 纯数学层：alignmentOffsetForToken vs 手算表（规格 §2.3） ==')
// 手算表（y-up 编辑器空间，w=4000 h=2300 → 半宽 2000 / 半高 1150）
const HAND = {
  center: [0, 0], left: [2000, 0], right: [-2000, 0], top: [0, -1150], bottom: [0, 1150],
  topleft: [2000, -1150], topright: [-2000, -1150], bottomleft: [2000, 1150], bottomright: [-2000, 1150],
}
for (const [al, exp] of Object.entries(HAND)) {
  const got = lib.alignmentOffsetForToken(al, 4000, 2300)
  chk(eqv(got, exp), `① ${al} (4000x2300)`, `got ${got} want ${exp}`)
}
// 第二/三组 size（128x128 → 半 64；700x512 → 半 350/256）
for (const [al, ex, ey] of [['left', 64, 0], ['top', 0, -64], ['bottomleft', 64, 64], ['bottomright', -64, 64]]) {
  chk(eqv(lib.alignmentOffsetForToken(al, 128, 128), [ex, ey]), `① ${al} (128x128)`)
}
for (const [al, ex, ey] of [['left', 350, 0], ['top', 0, -256], ['topleft', 350, -256], ['right', -350, 0]]) {
  chk(eqv(lib.alignmentOffsetForToken(al, 700, 512), [ex, ey]), `① ${al} (700x512)`)
}
// 缺省/未知 → 0（wer-ref 未知 token 不命中贡献项）
chk(eqv(lib.alignmentOffsetForToken(undefined, 100, 100), [0, 0]), '① undefined→(0,0)')
chk(eqv(lib.alignmentOffsetForToken(null, 100, 100), [0, 0]), '① null→(0,0)')
// 负 scale（有符号 size 传入 → 偏移方向翻转，等价矩阵 T(align) 内乘负 S）
chk(eqv(lib.alignmentOffsetForToken('left', -48.5, 12.25), [-24.25, 0]), '① left 负宽翻转')
chk(eqv(lib.alignmentOffsetForToken('top', 100, -50), [0, 25]), '① top 负高翻转')

// compositeLayer 的 quad 空间公式（本地复刻 ALIGN 表 + (0.5−a)·(w,h)，y-down）必须与
// 官方公式 helper（y-up）经 y 取反后逐项相等 —— 两条实现路径互证
const ALIGN = {
  center: [0.5, 0.5], left: [0, 0.5], right: [1, 0.5], top: [0.5, 0], bottom: [0.5, 1],
  topleft: [0, 0], topright: [1, 0], bottomleft: [0, 1], bottomright: [1, 1],
}
for (const al of Object.keys(ALIGN)) {
  for (const [w, h] of [[4000, 2300], [128, 128], [-700, 512.5]]) {
    const a = ALIGN[al]
    const quadYDown = [(0.5 - a[0]) * w, (0.5 - a[1]) * h]           // compositeLayer 实际执行式
    const helperYUp = lib.alignmentOffsetForToken(al, w, h)
    chk(eqv(quadYDown, [helperYUp[0], -helperYUp[1]]), `① quad≡helper ${al} ${w}x${h}`,
      `quad=${quadYDown} helper(ydown)=${[helperYUp[0], -helperYUp[1]]}`)
  }
}
console.log(`   ① 小计 ${pass} pass / ${fail} fail`)

console.log('== ② A4 纯数学层：父链合并（authored pivot，父 alignment 剔除） ==')
// 官方手推（y-up）：child_world = parent(S·R·T) · child(T) →
//   parent pivot(100,200) + R(π/6)·S(2,3)·(50,60)
//   = (100,200) + R(π/6)·(100,180) = (100,200) + (100c−180s, 100s+180c)
//   c=cos(π/6)=0.8660254, s=sin(π/6)=0.5 → (100,200)+(−3.39746,205.88457) = (96.60254,405.88457)
//   parseScene 最后翻转 y（PROJ_H=2160）→ y-down y = 2160−405.88457 = 1754.11543
//   ①(P-21-ATTACH 2026-09-13) scene.json 的 angles 是**弧度**（语料实测 3.14159=π、1.57080=π/2；
//     lwe CImage.cpp:1097 "already in radians from scene.json"；wer-ref Eigen AngleAxis 直收弧度）
//     → 本用例父角度由 '0 0 30'（被旧实现当 30°）改为 π/6，手推数值不变。
const SYN = (parentAlign) => ({
  general: { orthogonalprojection: { width: 3840, height: 2160 } },
  objects: [
    { id: 1, name: 'P', origin: '100 200 0', size: '400 300', scale: '2 3 1', angles: '0 0 ' + (Math.PI / 6), alignment: parentAlign },
    { id: 2, name: 'C', parent: 1, origin: '50 60 0', size: '100 80', scale: '1 1 1', angles: '0 0 0', alignment: 'center' },
  ],
})
const passBefore2 = pass, failBefore2 = fail
const sRight = lib.parseScene(SYN('right'), null, {})
const sCenter = lib.parseScene(SYN('center'), null, {})
const cR = sRight.layers.find((l) => l.id === 2)
const cC = sCenter.layers.find((l) => l.id === 2)
chk(eqv(cR.origin, [96.60254, 1754.11543], 1e-4), '② 子层合并 origin = 官方手推值', `got ${cR.origin.map((v) => +v.toFixed(5))}`)
chk(cR.origin[0] === cC.origin[0] && cR.origin[1] === cC.origin[1], '② 父 align=right 与 center → 子层 origin 逐位相同（A4 剔除）',
  `right=${cR.origin} center=${cC.origin}`)
// 两级父链：祖父/父均非 center → 孙层仍不受影响
const SYN2 = {
  general: { orthogonalprojection: { width: 3840, height: 2160 } },
  objects: [
    { id: 1, origin: '10 20 0', size: '100 100', alignment: 'bottomright' },
    { id: 2, parent: 1, origin: '30 40 0', size: '100 100', alignment: 'topleft' },
    { id: 3, parent: 2, origin: '5 6 0', size: '100 100', alignment: 'center' },
  ],
}
const g1 = lib.parseScene(structuredClone(SYN2), null, {}).layers.find((l) => l.id === 3)
const doctored = structuredClone(SYN2)
doctored.objects[0].alignment = 'center'
doctored.objects[1].alignment = 'center'
const g2 = lib.parseScene(doctored, null, {}).layers.find((l) => l.id === 3)
chk(g1.origin[0] === g2.origin[0] && g1.origin[1] === g2.origin[1], '② 两级非 center 祖先 → 孙层 origin 不变（8 轮迭代全链剔除）',
  `noncenter=${g1.origin} center=${g2.origin}`)
console.log(`   ② 小计 ${pass - passBefore2} pass / ${fail - failBefore2} fail`)

// ---------- ③ 语料层 ----------
const DD = `${MPW_WS}/allwallpaper/dd`
function runChecker(pkgPath, extra = []) {
  const out = execFileSync('node', ['tests/layer-rect-check.mjs', '--pkg', pkgPath, '--json', ...extra],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })   // ①(2026-09-16) cwd = 仓库根（子进程命令用 tests/ 前缀）
  const line = out.split('\n').find((l) => l.startsWith('##JSON##'))
  if (!line) throw new Error('layer-rect-check 未输出 ##JSON## 行')
  return JSON.parse(line.slice(8))
}
function center(r) { return [r.rect[0] + r.w / 2, r.rect[1] + r.h / 2] }

console.log('== ③ 语料层-A3：3660962877（非 center 层最多的包） ==')
{
  const pkgPath = path.join(DD, '3660962877/scene.pkg')
  const raw = JSON.parse(new TextDecoder().decode(new Uint8Array(lib.getEntry(
    lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath))), 'scene.json'))).replace(/^\uFEFF/, ''))
  const scene = lib.parseScene(raw, null, { uniformFlipY: true })
  const signed = new Map()   // id -> 有符号 (sw, sh)
  for (const l of scene.layers) signed.set(l.id, [l.size[0] * l.scale[0], l.size[1] * l.scale[1]])
  const rowsNew = runChecker(pkgPath)
  const rowsOld = runChecker(pkgPath, ['--align=0'])
  chk(rowsNew.length === rowsOld.length, '③ 两轮行数一致')
  const byIdOld = new Map(rowsOld.map((r) => [r.id, r]))
  let nonCenter = 0
  for (const r of rowsNew) {
    const o = byIdOld.get(r.id)
    if (!o) { chk(false, `③ 层 ${r.id} 缺旧轮记录`); continue }
    const dc = [center(r)[0] - center(o)[0], center(r)[1] - center(o)[1]]
    const [sw, sh] = signed.get(r.id) || [0, 0]
    const expUp = lib.alignmentOffsetForToken(r.align, sw, sh)
    const exp = [expUp[0], -expUp[1]]   // y-up → y-down
    chk(eqv(dc, exp, 1e-4), `③ 层${r.id}(${r.align}) Δ中心 = 预期偏移`, `Δ=${dc.map((v) => +v.toFixed(3))} exp=${exp.map((v) => +v.toFixed(3))}`)
    if (r.align !== 'center') nonCenter++
  }
  chk(nonCenter >= 20, `③ 非 center 层覆盖 ≥20（实际 ${nonCenter}）`)
  console.log(`   ③ 3660962877：${rowsNew.length} 层全查，非 center ${nonCenter} 层，Δ 全部命中公式`)
}

console.log('== ③ 语料层-回归：3719111841（全 center → 任何矩形都不应变化） ==')
{
  const pkgPath = path.join(DD, '3719111841/scene.pkg')
  const rowsNew = runChecker(pkgPath)
  const rowsOld = runChecker(pkgPath, ['--align=0'])
  const byIdOld = new Map(rowsOld.map((r) => [r.id, r]))
  let same = 0
  for (const r of rowsNew) {
    const o = byIdOld.get(r.id)
    if (!o) { chk(false, `③ 层 ${r.id} 缺旧轮记录`); continue }
    if (eqv(center(r), center(o), 1e-9) && eq(r.w, o.w) && eq(r.h, o.h)) same++
    else chk(false, `③ 层${r.id}(${r.align}) 全 center 包却出现矩形变化`)
  }
  chk(rowsNew.length > 0 && same === rowsNew.length, `③ 3719111841 全部 ${same}/${rowsNew.length} 层矩形零变化`)
  const nc = rowsNew.filter((r) => r.align !== 'center').length
  chk(nc === 0, `③ 3719111841 非 center 层数 = 0（实测 ${nc}，回归判据前提）`)
}

console.log('== ③ 语料层-A4：3326873240（父 align=right 带子层，剔除语义） ==')
{
  const pkgPath = path.join(DD, '3326873240/scene.pkg')
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
  const raw = JSON.parse(new TextDecoder().decode(new Uint8Array(lib.getEntry(pkg, 'scene.json'))).replace(/^\uFEFF/, ''))
  const base = lib.parseScene(structuredClone(raw), null, { uniformFlipY: true })
  // 父 155 'Progress Bar'（align=right）的子层 156/159；父 140 'Background'（align=right）→ 子 148/155
  const childIds = [148, 155, 156, 159]
  const pick = (sc) => childIds.map((id) => sc.layers.find((l) => l.id === id).origin)
  const before = pick(base)
  const doctored = structuredClone(raw)
  for (const pid of [140, 155]) { const p = doctored.objects.find((o) => o.id === pid); if (p) p.alignment = 'center' }
  const after = pick(lib.parseScene(doctored, null, { uniformFlipY: true }))
  let identical = 0
  for (let i = 0; i < childIds.length; i++) {
    if (eqv(before[i], after[i], 1e-9)) identical++
    else chk(false, `③ A4 子层 ${childIds[i]} 随父 alignment 漂移`, `before=${before[i]} after=${after[i]}`)
  }
  chk(identical === childIds.length, `③ A4 父(140/155) align right→center：${identical}/${childIds.length} 子层合并 origin 逐位不变`)
  // 子层矩形 Δ = **自身** alignment 偏移（148/155 自身也是 right；156/159 是 center → 零变化。
  // 父 140/155 的 right 偏移只作用于父自己的网格，不下传 —— A4 剔除的绘制期表现）
  const scene332 = lib.parseScene(structuredClone(raw), null, { uniformFlipY: true })
  const signed332 = new Map(scene332.layers.map((l) => [l.id, [l.size[0] * l.scale[0], l.size[1] * l.scale[1]]]))
  const rowsNew = runChecker(pkgPath)
  const rowsOld = runChecker(pkgPath, ['--align=0'])
  const byIdOld = new Map(rowsOld.map((r) => [r.id, r]))
  let childHit = 0
  for (const id of childIds) {
    const r = rowsNew.find((x) => x.id === id), o = byIdOld.get(id)
    if (!r || !o) { chk(false, `③ A4 子层 ${id} 缺矩形记录`); continue }
    const dc = [center(r)[0] - center(o)[0], center(r)[1] - center(o)[1]]
    const [sw, sh] = signed332.get(id) || [0, 0]
    const e = lib.alignmentOffsetForToken(r.align, sw, sh)
    if (eqv(dc, [e[0], -e[1]], 1e-4)) childHit++
    else chk(false, `③ A4 子层 ${id}(${r.align}) Δ=${dc.map((v) => +v.toFixed(3))} 应为自身偏移 ${[e[0], -e[1]].map((v) => +v.toFixed(3))}`)
  }
  chk(childHit === childIds.length, `③ A4 子层矩形 Δ=自身偏移（非父偏移）${childHit}/${childIds.length} 命中`)
}

console.log('\n════════════════════════════')
console.log(`alignment-test：${pass} pass / ${fail} fail`)
if (fail) { console.log('失败项：'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1) }
console.log('全部通过 ✔（A3 偏移公式 / A4 父链剔除 / 语料修复前后矩形差）')

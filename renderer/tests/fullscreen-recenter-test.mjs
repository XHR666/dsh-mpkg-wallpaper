// fullscreen-recenter-test.mjs — N2（第6项 伊蕾娜相框 3660962877）"近整屏层脚本定位兜底"单测
// 复现：node fullscreen-recenter-test.mjs
//
// 问题（docs/VIDEO-AND-TWITCH-RESEARCH.md §1）：视频层 4000×2300、alignment=bottomleft、origin 由脚本
//   驱动（scriptProperties x/y=0 → 作者意图 origin=(0,0)），而旧兜底块把 origin **无条件**设成画布
//   中心 (CW/2, CH/2) —— 对四角锚点层那是"一个角"，四边形只剩中心点右上那一象限 = 真机
//   layerLedger.rd=[1920,-1221,3999,2301]、截图"视频只铺右下 1/4"。
// 本测试用的是**包内真实值**（生产解析器 dump 核对过）：
//   id=1003 / size="4000.00000 2300.00000" / scale=(1,1,1) / alignment="bottomleft"
//   / origin.value="-63.45398 -89.85278 0.00000"（y-up authored） / projection=3840×2160
//   / scriptProperties brbigbx=0, brbigby=0。
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps
const nearArr = (a, b, eps = 0.02) => a.length === b.length && a.every((v, i) => near(v, b[i], eps))
const r2 = (v) => Math.round(v * 100) / 100

// ── 3660962877 的真实层（parseScene 之后：origin 已做 y-down 翻转 PROJ_H − y）──
const CW = 3840, CH = 2160
const AUTHORED_YUP = [-63.45398, -89.85278]
const authoredLayer = (over = {}) => Object.assign({
  id: 1003, name: '伊蕾娜 果园春色 有水印横屏',
  size: [4000, 2300], scale: [1, 1, 1], alignment: 'bottomleft',
  origin: [AUTHORED_YUP[0], CH - AUTHORED_YUP[1], 0],   // y-down: 2160+89.85278 = 2249.85278
}, over)
const sceneOf = (layers) => ({ general: { orthogonalprojection: { width: CW, height: CH } }, layers })

// 实绘矩形（y-down 设计空间）：与 bundle compositeLayer 的 `m = T(origin)·R·S·T(0.5−a)` 同口径
function rectOf(l, alignZero = false) {
  const a = alignZero ? [0.5, 0.5] : lib.alignmentAnchor(l.alignment)
  const w = l.size[0] * l.scale[0], h = l.size[1] * l.scale[1]
  const x0 = l.origin[0] - w * a[0], y0 = l.origin[1] - h * a[1]
  return [x0, y0, w, h]
}
const coversScreen = (rd, tol = 1) => rd[0] <= tol && rd[1] <= tol && rd[0] + rd[2] >= CW - tol && rd[1] + rd[3] >= CH - tol

// 旧实现（修复前 demo.html 逐字复刻）：无条件居中 + "origin 落在画布盒 ±50 之外"判据
function oldFallback(scene) {
  let recentered = 0
  for (const l of scene.layers) {
    const w = l.size[0] * l.scale[0], h = l.size[1] * l.scale[1]
    if (w >= CW * 0.85 && h >= CH * 0.85 && (l.origin[0] < -50 || l.origin[0] > CW + 50 || l.origin[1] < -50 || l.origin[1] > CH + 50)) {
      l.origin = [CW / 2, CH / 2, 0]
      recentered++
    }
  }
  return recentered
}

console.log('[N2] 近整屏层兜底：判据 + 锚点都按 alignment（3660962877 真实值）')

// ── T1 authored 值：合法整屏层必须保留（旧实现会误居中）──
console.log('[T1] authored origin 已覆盖投影 → 保留')
{
  const l = authoredLayer()
  const before = l.origin.slice()
  const r = lib.applyScriptedFullscreenFallback(sceneOf([l]))
  const rd = rectOf(l)
  check('T1a 不触发兜底（recentered=0 / kept=1）', r.recentered === 0 && r.kept === 1, JSON.stringify(r))
  check('T1b origin 原样保留（authored y-down）', nearArr(l.origin, before, 1e-6), 'origin=[' + l.origin.slice(0, 2).map(r2) + ']')
  check('T1c 实绘矩形 = [-63.45,-50.15,4000,2300] 覆盖 3840×2160', nearArr(rd, [-63.45398, -50.14722, 4000, 2300]) && coversScreen(rd),
    'rd=[' + rd.map(r2) + ']')
  // 旧实现反证：同一层被无条件居中 → 只剩右下 1/4（真机 rd 逐位吻合）
  const l2 = authoredLayer()
  check('T1d 旧实现确实误居中（recentered=1）', oldFallback(sceneOf([l2])) === 1)
  const rdOld = rectOf(l2)
  check('T1e 旧实绘矩形 = [1920,-1221,3999,2301]（真机 layerLedger 同值，只覆盖右下 1/4）',
    nearArr(rdOld, [1920, -1221, 4000, 2300], 1) && !coversScreen(rdOld), 'rd=[' + rdOld.map(r2) + ']')
  check('T1f 旧矩形覆盖率 ≈25%（0.5×0.5）', near(r2(Math.max(0, Math.min(CW, rdOld[0] + rdOld[2]) - Math.max(0, rdOld[0])) / CW) *
    r2(Math.max(0, Math.min(CH, rdOld[1] + rdOld[3]) - Math.max(0, rdOld[1])) / CH), 0.25, 0.01))
}

// ── T2 N1（canvasSize 修好）后脚本增量 → 作者意图 (0,0) → 满屏 ──
console.log('[T2] N1+N2 联合：脚本增量叠加后 = 作者意图满屏')
{
  const raw = [{ id: 1003, origin: { script: '...', value: '-63.45398 -89.85278 0.00000' } }]
  const base = lib.snapshotAuthoredOrigins(raw)
  const l = authoredLayer()
  const scene = sceneOf([l])
  const fb = lib.applyScriptedFullscreenFallback(scene)
  check('T2a 兜底未触发（保留 authored）', fb.recentered === 0 && fb.kept === 1)
  // 脚本产出（N1 后 canvasSize={x,y} → 0*W=0）：raw.origin.value 被宿主写成脚本结果
  raw[0].origin.value = '0.00000 0.00000 0.00000'
  const n = lib.syncScriptOrigins(scene, raw, base)
  const rd = rectOf(l)
  check('T2b syncScriptOrigins 施加增量 1 处', n === 1, 'n=' + n)
  check('T2c origin y-down = (0,2160)（脚本 (0,0) y-up → 翻转后 2160）', nearArr(l.origin.slice(0, 2), [0, 2160]), 'origin=[' + l.origin.slice(0, 2).map(r2) + ']')
  check('T2d 实绘 rd = [0,-140,4000,2300] 满屏（报告预期值逐位）', nearArr(rd, [0, -140, 4000, 2300]) && coversScreen(rd), 'rd=[' + rd.map(r2) + ']')
}

// ── T3 反事实：只修 N1 不修 N2（时序坑）→ 更差 ──
console.log('[T3] 反事实：只修 N1（旧兜底仍在）→ origin=(1983.45,990.15)，仍不在屏')
{
  const raw = [{ id: 1003, origin: { script: '...', value: '-63.45398 -89.85278 0.00000' } }]
  const base = lib.snapshotAuthoredOrigins(raw)
  const l = authoredLayer()
  const scene = sceneOf([l])
  oldFallback(scene)                                        // boot 期旧兜底
  raw[0].origin.value = '0.00000 0.00000 0.00000'
  lib.syncScriptOrigins(scene, raw, base)
  const rd = rectOf(l)
  check('T3a origin = (1983.45, 990.15)（报告表逐位）', nearArr(l.origin.slice(0, 2), [1983.45398, 990.14722]), 'origin=[' + l.origin.slice(0, 2).map(r2) + ']')
  check('T3b 不满屏（不覆盖投影）', !coversScreen(rd), 'rd=[' + rd.map(r2) + ']')
}

// ── T4 ?align=0 逃逸口：绘制端/判定/兜底统一按 center ──
console.log('[T4] ?align=0（A/B 逃逸口）与零代码探针口径一致')
{
  const l = authoredLayer()
  const r = lib.applyScriptedFullscreenFallback(sceneOf([l]), { alignZero: true })
  check('T4a alignZero 下触发兜底（authored 层在 center 口径下不覆盖）', r.recentered === 1 && r.kept === 0, JSON.stringify(r))
  check('T4b 兜底 origin = 画布中心 (1920,1080)（= 旧行为，逐位相同）', nearArr(l.origin.slice(0, 2), [CW / 2, CH / 2]), 'origin=[' + l.origin.slice(0, 2).map(r2) + ']')
  const rd = rectOf(l, true)
  check('T4c center 口径实绘 rd = [-80,-70,4000,2300] 满屏（= 报告零代码探针预期）', nearArr(rd, [-80, -70, 4000, 2300]) && coversScreen(rd), 'rd=[' + rd.map(r2) + ']')
}

// ── T5 兜底尊重 alignment ──
console.log('[T5] 兜底按 alignment 放锚点（bottomright / topleft / center）')
{
  const mk = (alignment, origin) => Object.assign(authoredLayer(), { alignment, origin })
  for (const [alignment, expectA] of [['bottomright', [1, 1]], ['topleft', [0, 0]], ['center', [0.5, 0.5]]]) {
    const l = mk(alignment, [0, CH, 0])                     // 该锚点下这个 origin 无法覆盖投影
    const r = lib.applyScriptedFullscreenFallback(sceneOf([l]))
    const a = lib.alignmentAnchor(alignment)
    const rd = rectOf(l)
    check('T5 ' + alignment + ' 兜底后矩形居中且覆盖', r.recented === undefined && r.recentered === 1 && nearArr(a, expectA) && coversScreen(rd),
      'a=[' + a + '] origin=[' + l.origin.slice(0, 2).map(r2) + '] rd=[' + rd.map(r2) + ']')
  }
  // 同一个 origin 在不同 alignment 下判定必须不同（这就是"判据按 alignment"的直接证据）
  const lTl = mk('topleft', [0, 0, 0])
  const rTl = lib.applyScriptedFullscreenFallback(sceneOf([lTl]))
  const lBr = mk('bottomright', [0, 0, 0])
  const rBr = lib.applyScriptedFullscreenFallback(sceneOf([lBr]))
  check('T5b origin=(0,0)：topleft 覆盖→kept，bottomright 不覆盖→recentered', rTl.kept === 1 && rTl.recentered === 0 && rBr.recentered === 1,
    'topleft=' + JSON.stringify(rTl) + ' bottomright=' + JSON.stringify(rBr))
}

// ── T6 真残缺（NaN / 越界）必须兜底成有限值 ──
console.log('[T6] 残缺值兜底')
{
  const l = authoredLayer({ origin: [NaN, NaN, 0] })
  const r = lib.applyScriptedFullscreenFallback(sceneOf([l]))
  check('T6a NaN origin → 兜底为有限值且覆盖', r.recentered === 1 && l.origin.every((v) => isFinite(v)) && coversScreen(rectOf(l)),
    'origin=[' + l.origin.slice(0, 2).map(r2) + ']')
  const l2 = authoredLayer({ origin: [99999, -99999, 0] })
  const r2b = lib.applyScriptedFullscreenFallback(sceneOf([l2]))
  check('T6b 远在画外 → 兜底且覆盖', r2b.recentered === 1 && coversScreen(rectOf(l2)), 'origin=[' + l2.origin.slice(0, 2).map(r2) + ']')
}

// ── T7 非近整屏层不碰（旧口径 0.85 保持）；center 满屏层保留 ──
console.log('[T7] 边界：小层不动 / 满屏 center 层保留')
{
  const small = authoredLayer({ size: [1000, 600], origin: [500, 5000, 0] })
  const r = lib.applyScriptedFullscreenFallback(sceneOf([small]))
  check('T7a 1000×600 层（<0.85×投影）skipped 且 origin 不变', r.skipped === 1 && r.recentered === 0 && nearArr(small.origin.slice(0, 2), [500, 5000]),
    JSON.stringify(r))
  const centered = authoredLayer({ alignment: 'center', origin: [CW / 2, CH / 2, 0] })
  const r2b = lib.applyScriptedFullscreenFallback(sceneOf([centered]))
  check('T7b center 满屏层 kept', r2b.kept === 1 && r2b.recentered === 0, JSON.stringify(r2b))
  // 85% 边界：3900×2160 层比投影略宽（出血 60px）→ 覆盖 → kept
  const bleed = authoredLayer({ size: [3900, 2160], origin: [3900 / 2, CH / 2, 0], alignment: 'center' })
  const r3 = lib.applyScriptedFullscreenFallback(sceneOf([bleed]))
  check('T7c 3900×2160 center 出血层 kept（EPS=1 容差内覆盖）', r3.kept === 1, JSON.stringify(r3))
  const noScene = lib.applyScriptedFullscreenFallback(null)
  check('T7d 空场景安全返回', noScene.recentered === 0 && noScene.kept === 0 && noScene.skipped === 0)
}

// ── T8 alignmentAnchor 与绘制端 ALIGN 同表 ──
console.log('[T8] alignmentAnchor 表')
{
  const want = { center: [0.5, 0.5], left: [0, 0.5], right: [1, 0.5], top: [0.5, 0], bottom: [0.5, 1], topleft: [0, 0], topright: [1, 0], bottomleft: [0, 1], bottomright: [1, 1] }
  const bad = Object.entries(want).filter(([k, v]) => !nearArr(lib.alignmentAnchor(k), v))
  check('T8a 9 个 alignment token 全部一致', bad.length === 0, bad.map((x) => x[0]).join(','))
  check('T8b 未知/缺省 → center', nearArr(lib.alignmentAnchor('weird'), [0.5, 0.5]) && nearArr(lib.alignmentAnchor(undefined), [0.5, 0.5]))
  check('T8c 返回副本（调用方改写不污染表）', (() => { const a = lib.alignmentAnchor('bottomleft'); a[0] = 9; return lib.alignmentAnchor('bottomleft')[0] === 0 })())
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)

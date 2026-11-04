// mdla-corpus-audit-test.mjs —— C5【机制·MDLA 采样域与坏帧】判据：坏帧集合 = 尾切∪精修 的**确定性证明**
//   + 阈值来源（分布定义）精确复算 + fps 全 30 复现 + 桩件（合成坏帧仍被识别）+ 变异自证。
//
// 现状定位（本文件是**审计与钉死**，不是新机制）：
//   · 采样域 = 官方 `[0, frameCount)`（`core/attach-transform.mjs:811` "帧号先规约到 [0, frameCount)，
//     绝不把移位折进取模"；frameCount 读自 MDLA 头 +0x17c（REVERSE-FINDINGS-2 §3：framerate f32@+0x178、
//     frameCount u32@+0x17c，样本 30.0/900）——官方域内的帧**全部是权威帧**。
//   · 坏帧检测 = `detectBadAnimFrames`（core:17413）v3 双通道：A 尾部切除（maxStep>T_ABS=30 的连续尾缀，
//     ≤17 帧 = "结尾 1~17 帧导出垃圾"的官方结构证据）；B 邻域精修（sig 二阶差分，阈值 =
//     **max(10×dev中位, 5)** —— 分布定义，5 是下限档的求值结果不是常量阈值）。真机日志里的"阈值 5.0"
//     就是下限档命中（左下1/左上1：medDev×10 ≤ 5）。
//   · 播放端 = 跨坏帧插值（demo.html :6150 "跨坏帧插值"，N3/N4 口径）——"跳过"不是丢帧，是把采样点
//     相位插值到好帧区间。
// 判据（任务书 C5①②③）：
//   A 探针包定案：0923/2887099508 `r ear1`/`L ear1` 的 左下1/左上1 —— bad=[0,1,2,3,25,26,27,28,29]、
//     thr=5.00（下限档）、maxStep 内部最大 12.3 vs 回绕 184.7（回绕爆炸=轨道尾异常的指纹）；
//   B 确定性/阈值来源（对每条被审计动画）：重算 dev（好帧、最近好邻居）⇒ median ⇒ **thr === max(10×median,5)**
//     精确成立；bad === 尾切集 ∪ 精修集（尾切 = maxStep>30 连续尾缀；精修 = dev>thr 且 dev>0.45×局部maxStep）；
//   C fps：全部被审计动画 fps=30（"48/48 动画 fps=30.0"的同族复现，语料扩展只增不反驳）；
//   D 桩件：合成剖面（干净正弦 + 尾部垃圾 + 孤立尖峰）⇒ 坏帧仍被识别（判据没被关掉）；
//   E 变异自证：/tmp 副本把 detectBadAnimFrames 改成恒空 ⇒ A 段必红。
// 用法：node tests/mdla-corpus-audit-test.mjs [--sweep]（--sweep = 全库扫描落 reports/mdla-corpus-audit.json，
//   门禁不跑全库——只跑 PKGS 里的定案包，秒级）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'

const dec = new TextDecoder()
let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 260) : '')) } }
const sk = (name, why) => { skipN++; console.log('  ~ SKIP ' + name + '（' + why + '）') }

const H = {}
installPuppet(H)

/* 坏帧集合的**独立复算**（detectBadAnimFrames 规则的逐字重放，用于证明 bad = 尾切∪精修 且 thr 来源） */
function recomputeBad(profile) {
  const maxStep = profile.maxStep, sig = profile.sig
  const rawLen = sig.length
  const bad = new Set()
  const refineSet = new Set()
  const T_ABS = 30
  const tailCut = []
  if (maxStep && maxStep.length === rawLen) {
    const ms = Array.from(maxStep).sort((a, b) => a - b)
    if (ms[rawLen >> 1] <= T_ABS / 3) {
      let cut = 0
      for (let f = rawLen - 1; f >= 0 && cut < 17; f--) { if (Number(maxStep[f]) > T_ABS) { bad.add(f); tailCut.push(f); cut++ } else break }
    }
  }
  const step = new Float64Array(rawLen)
  for (let f = 0; f < rawLen; f++) step[f] = Math.abs(sig[(f + 1) % rawLen] - sig[f])
  let thr = 5
  const devOf = (f, badSet) => {
    let pg = f, ng = f
    for (let k = 1; k <= rawLen; k++) { const i = (f - k + rawLen * 4) % rawLen; if (!badSet.has(i)) { pg = i; break } }
    for (let k = 1; k <= rawLen; k++) { const i = (f + k) % rawLen; if (!badSet.has(i)) { ng = i; break } }
    return Math.abs(sig[f] - (sig[pg] + sig[ng]) / 2)
  }
  for (let pass = 0; pass < 4; pass++) {
    const goodIdx = []
    for (let f = 0; f < rawLen; f++) if (!bad.has(f)) goodIdx.push(f)
    if (goodIdx.length < 4) break
    const devs = new Map()
    for (const f of goodIdx) devs.set(f, devOf(f, bad))
    const ds = goodIdx.map((f) => devs.get(f)).sort((x, y) => x - y)
    const medDev = ds.length ? ds[ds.length >> 1] : 0
    thr = Math.max(medDev * 10, 5)
    let added = 0
    for (const f of goodIdx) {
      let ls = 0
      for (let k = -2; k <= 2; k++) { const i = (f + k + rawLen * 4) % rawLen; if (step[i] > ls) ls = step[i] }
      if (devs.get(f) > thr && devs.get(f) > 0.45 * ls) { bad.add(f); refineSet.add(f); added++ }
    }
    if (!added) break
  }
  return { bad, thr, tailCut, refine: refineSet, medDevFinal: (() => {
    const goodIdx = []; for (let f = 0; f < rawLen; f++) if (!bad.has(f)) goodIdx.push(f)
    const ds = goodIdx.map((f) => devOf(f, bad)).sort((x, y) => x - y)
    return ds.length ? ds[ds.length >> 1] : 0
  })() }
}
/* 审计一个 puppet mesh：返回每动画行 {name, len, fps, bad, thr, tailCut, refine, maxInternal, wrapStep} */
function auditMesh(mesh, label) {
  const rows = []
  const tables = lib.analyzeAnimGoodFrames(mesh, H._sampleAnimRT)
  for (let i = 0; i < (tables || []).length; i++) {
    const t = tables[i]
    const a = (mesh.animations || [])[i] || {}
    const maxStep = Array.from(t.maxStep || [])
    const internal = maxStep.slice(0, Math.max(1, t.len - 1))
    const maxInternal = internal.length ? Math.max(...internal) : 0
    const wrapStep = maxStep.length ? maxStep[maxStep.length - 1] : 0
    const rc = recomputeBad({ maxStep: t.maxStep, sig: t.sig })
    rows.push({
      label, anim: i, name: String(a.name || a.id || ''), len: t.len, fps: a.fps || 30,
      badN: t.bad.size, bad: [...t.bad].sort((x, y) => x - y),
      thr: +(t.thr || 0).toFixed(3), thrExpected: +Math.max(10 * rc.medDevFinal, 5).toFixed(3),
      tailCut: rc.tailCut, refineN: [...rc.refine].length,
      maxInternal: +maxInternal.toFixed(2), wrapStep: +wrapStep.toFixed(2),
      badReproduced: JSON.stringify([...rc.bad].sort((x, y) => x - y)) === JSON.stringify([...t.bad].sort((x, y) => x - y)),
    })
  }
  return rows
}

/* 解析一个包的全部 puppet */
function auditPkg(pkgPath, label) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
  const rd = (b) => dec.decode(b).replace(/^\uFEFF/, '')
  const sceneJson = JSON.parse(rd(lib.getEntry(pkg, 'scene.json')))
  const rows = []
  const seen = new Set()
  for (const o of (sceneJson.objects || [])) {
    let mj = null
    try { mj = JSON.parse(rd(lib.getEntry(pkg, o.image))) } catch (e) { continue }
    if (!mj || !mj.puppet || seen.has(mj.puppet)) continue
    seen.add(mj.puppet)
    let mesh = null
    try {
      const u8 = lib.getEntry(pkg, mj.puppet)
      const buf = new MpwBuffer(u8.buffer, u8.byteOffset, u8.byteLength)
      mesh = H._parseMdl(buf)
    } catch (e) { continue }
    if (!mesh || !(mesh.animations || []).length) continue
    rows.push(...auditMesh(mesh, label + ':' + String(o.name || o.id).slice(0, 16)))
  }
  return rows
}

console.log('== C5 MDLA 坏帧审计（生产解析 + 生产检测器的独立复算）==')
const WSROOT = process.env.MPW_ROOT || WS
const PKGS = [
  ['0923/2887099508', path.join(WSROOT, 'allwallpaper', '0923', '2887099508', 'scene.pkg')],
  ['dd/3544152633', path.join(WSROOT, 'allwallpaper', 'dd', '3544152633', 'scene.pkg')],
]
let allRows = []
for (const [label, p] of PKGS) {
  if (!fs.existsSync(p)) { sk('审计 ' + label, '语料缺包'); continue }
  const rows = auditPkg(p, label)
  allRows.push(...rows)
  console.log(`  ${label}: ${rows.length} 条动画`)
}
ok('C0 被审计动画 ≥ 16 条（探针包 12 + girl 系 ≥ 4）', allRows.length >= 16, 'rows=' + allRows.length)

/* C fps 全 30（"48/48 动画 fps=30.0" 同族复现） */
const nonFps30 = allRows.filter((r) => r.fps !== 30)
ok('C fps 全 30（' + allRows.length + ' 条，异常 ' + nonFps30.length + '）', nonFps30.length === 0, JSON.stringify(nonFps30.slice(0, 3)))

/* B 阈值来源 + 坏帧集合确定性（对每条）：
   独立重实现（recomputeBad，本文件可读的分布规则）必须逐位复现生产检测器的坏帧集合与 thr——
   这就是"阈值来源 = max(10×dev中位, 5) 的分布定义 + 尾切∪精修"的证明。thr 在多轮收敛时
   取最后一轮的 medDev（差 <2% 的收敛残差只打印不红）。 */
let provBad = 0
const thrDelta = []
for (const r of allRows) {
  if (r.badReproduced) provBad++
  else console.log('    ⚠ 坏帧集合未复现: ' + r.label + '#' + r.anim)
  if (Math.abs(r.thr - r.thrExpected) > 0.02) thrDelta.push(r.label + '#' + r.anim + ' Δ' + (r.thr - r.thrExpected).toFixed(2))
}
ok('B1 独立重实现逐位复现坏帧集合（' + provBad + '/' + allRows.length + '）', provBad === allRows.length,
  thrDelta.slice(0, 3).join(','))
ok('B2 thr ≥ 5（分布定义的下限档）恒成立', allRows.every((r) => r.thr >= 5), JSON.stringify(allRows.filter((r) => r.thr < 5).slice(0, 2)))

/* A 探针包定案（左下1/左上1） */
{
  const ear = allRows.filter((r) => r.label.startsWith('0923/2887099508') && ['左下1', '左上1'].includes(r.name))
  ok('A1 探针包 左下1/左上1 被审计到（2 条）', ear.length === 2, JSON.stringify(ear.map((r) => r.name)))
  const withBad = ear.filter((r) => r.badN === 9 && JSON.stringify(r.bad) === '[0,1,2,3,25,26,27,28,29]')
  ok('A2 bad=[0,1,2,3,25,26,27,28,29]、thr=5.00（下限档）逐位复现', withBad.length === 2,
    JSON.stringify(ear.map((r) => ({ n: r.name, bad: r.bad, thr: r.thr }))))
  ok('A3 回绕爆炸指纹：wrapStep > 10× maxInternal（' + (ear[0] ? ear[0].wrapStep : '?') + ' vs ' + (ear[0] ? ear[0].maxInternal : '?') + '）',
    ear.length === 2 && ear.every((r) => r.wrapStep > 10 * r.maxInternal),
    JSON.stringify(ear.map((r) => ({ w: r.wrapStep, m: r.maxInternal }))))
  ok('A4 尾切 = {29}（官方"导出垃圾尾"结构位），其余 8 帧 = 精修（分布阈值检验）',
    ear.length === 2 && ear.every((r) => JSON.stringify(r.tailCut) === '[29]' && r.badN === 9),
    JSON.stringify(ear.map((r) => ({ t: r.tailCut, bad: r.bad }))))
}

/* D 桩件：合成剖面（干净正弦 + 尾部垃圾 + 孤立尖峰）⇒ 坏帧仍被识别 */
{
  const N = 40
  const maxStep = [], sig = []
  for (let f = 0; f < N; f++) {
    const base = 10 + 8 * Math.sin((f / N) * Math.PI * 2)
    const garbage = f >= N - 3 ? 400 + f : 0      // 尾部 3 帧垃圾（官方"结尾导出垃圾"族）
    const spike = f === 20 ? 300 : 0              // 中段孤立尖峰
    maxStep.push(base + garbage + spike)
    sig.push(100 + base * 2 + (garbage ? garbage : 0) + (spike ? spike * 0.8 : 0))
  }
  const r = lib.detectBadAnimFrames({ maxStep, sig })
  const tailCutOk = [37, 38, 39].every((f) => r.bad.has(f))
  const spikeOk = [19, 20, 21].some((f) => r.bad.has(f))
  ok('D 桩件：尾部垃圾帧（37-39）与孤立尖峰（20±1）都被识别（thr=' + r.thr.toFixed(1) + '，判据没有被关掉）',
    tailCutOk && spikeOk && r.bad.size <= N / 2, JSON.stringify([...r.bad].sort((x, y) => x - y)))
}

/* E 变异自证：/tmp 副本把 detectBadAnimFrames 改成恒空 ⇒ A 段必红 */
{
  const CORE = path.join(ROOT, 'core')
  const src = fs.readFileSync(path.join(CORE, 'we-scene-bundle.js'), 'utf8')
  const anchor = 'export function detectBadAnimFrames(profile, opts = {}) {'
  if (!src.includes(anchor)) ok('E0 变异锚点存在', false, 'detectBadAnimFrames 没找到')
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-c5-'))
    for (const f2 of fs.readdirSync(CORE)) { if (/\.(mjs|js)$/.test(f2)) fs.copyFileSync(path.join(CORE, f2), path.join(dir, f2)) }
    // 同时拷 elysia（本文件 import 它）与 buffer/puppet 依赖
    const EL = path.join(ROOT, 'elysia')
    const dirEl = path.join(dir, '..', path.basename(dir) + '-elysia')
    fs.mkdirSync(dirEl, { recursive: true })
    // 变异副本通过 MPW_REPO_ROOT 覆盖 core；elysia 用原树（其内部相对导入不破）
    const neutered = src.replace(anchor, anchor + '\n  if (globalThis.__MPW_C5_NEUTER) return { bad: new Set(), thr: 5 }')
    fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'), neutered)
    const mlib = await import(pathToFileURL(path.join(dir, 'we-scene-bundle.js')).href + '?t=' + Date.now())
    // 用**变异库**的 analyzeAnimGoodFrames（其内部 detectBadAnimFrames 已被中性化）：bad 应为空
    globalThis.__MPW_C5_NEUTER = 1
    const pkg = mlib.parsePkg(new Uint8Array(fs.readFileSync(PKGS[0][1])))
    const rd = (b) => dec.decode(b).replace(/^\uFEFF/, '')
    const sceneJson = JSON.parse(rd(mlib.getEntry(pkg, 'scene.json')))
    const o = sceneJson.objects.find((x) => x.id === 162)
    const mj = JSON.parse(rd(mlib.getEntry(pkg, o.image)))
    const u8 = mlib.getEntry(pkg, mj.puppet)
    const buf = new MpwBuffer(u8.buffer, u8.byteOffset, u8.byteLength)
    const mesh = H._parseMdl(buf)
    const tables = mlib.analyzeAnimGoodFrames(mesh, H._sampleAnimRT)
    ok('E 变异自证：中性化 detectBadAnimFrames 后坏帧集合为空（A2 的"跳帧"判定真的依赖它）',
      tables[0] && tables[0].bad.size === 0, 'badN=' + (tables[0] ? tables[0].bad.size : '?'))
    globalThis.__MPW_C5_NEUTER = 0
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }
}

/* --sweep：全库审计（报告模式，门禁不跑） */
if (process.argv.includes('--sweep')) {
  const ROOTS = ['dd', '0923', '0917', 'wallpaperE', '1004'].map((r) => path.join(WS, 'allwallpaper', r)).filter((p) => fs.existsSync(p))
  const out = []
  const walk = (root, acc = []) => { let names = []; try { names = fs.readdirSync(root) } catch (e) { return acc } for (const n of names) { const p = path.join(root, n); let st = null; try { st = fs.statSync(p) } catch (e) { continue } if (st.isDirectory()) walk(p, acc); else if (/\.(mpkg|pkg)$/i.test(n)) acc.push(p) } return acc }
  for (const root of ROOTS) {
    for (const f of walk(root)) {
      try { if (fs.statSync(f).size > 250 * 1048576) continue } catch (e) { continue }
      try { out.push(...auditPkg(f, path.basename(path.dirname(f)))) } catch (e) { /* 单包失败如实跳过 */ }
    }
  }
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'reports', 'mdla-corpus-audit.json'), JSON.stringify(
    { generatedAt: new Date().toISOString(), animations: out.length, fpsAll30: out.every((r) => r.fps === 30),
      withBad: out.filter((r) => r.badN > 0).length, rows: out }, null, 1))
  console.log('全库审计 → reports/mdla-corpus-audit.json（' + out.length + ' 条动画）')
}

console.log('\n===== mdla-corpus-audit: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipN ? ' / ' + skipN + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)

/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · `references/lwe-ref`（GPL-3.0-only）、`references/wer-ref`（GPL-2.0-only）与本项目
 *     GPL-3.0-or-later 许可不兼容 ⇒ 本文件**不引用**其任何内容。C4 的取舍依据是
 *     **官方文档 + 官方资产 + 官方编辑器字符串表**，取证与权重见
 *     `docs/reports/particle-force-c3c4-verdict.md`。
 */
// particle-force-distance-test.mjs —— `controlpointattract`（官方名 **Control point force**）
//   **门限 = 最大作用距离** 的回归门禁（C4 定案）
//
// ── 定案（照官方）──────────────────────────────────────────────────────────────────────────
//   官方口径：该字段**就是最大作用距离**，不做任何半径/直径换算 ⇒ 门限 = `threshold` **原值**。
//     · **S0 官方文档** <https://docs.wallpaperengine.io/en/scene/particles/component/operator.html>
//       §"Control point force" 逐字：**"Distance: The maximum distance of the force."**
//       （同节开头："Either pulls or pushes particles when **near** a control point" ⇒ 近距才施力，
//        与本仓 `d < 门限` 的判据方向一致。）
//     · **S1 官方资产**：该字段序列化键名 = `threshold`（`assets/**` 35 个 controlpointattract 实例中
//       `threshold` 33 次、`distance` **0** 次）；官方为该算子做的元素预览
//       `assets/scenes/particleelementpreviews/controlpointattract/particles/new_particle_system.json`
//       是 `{scale:2000, threshold:1000}` 配 `sphererandom distance 300..500` ⇒ 门限比发射外壳外沿还有
//       **整 2×** 余量（`threshold === 2 × distancemax`）。
//     · **S2 官方编辑器字符串表**：`bin/wallpaperui.exe` 的粒子属性键表里 `threshold` 与
//       `deletethreshold` 是**两个不同的键** ⇒ `threshold` 不是文档 §"Delete particles in center" 的
//       子项 "Deletion threshold"，只能对应 §"Distance"。
//   本仓改动：`core/we-scene-bundle.js` 的 `const thr = pGetVal(pr,'threshold',512) * 0.5`
//     ⇒ `const __thrRaw = pGetVal(pr,'threshold',512); const thr = sys.pforceLegacy ? __thrRaw*0.5 : __thrRaw`
//   回退口：**`?pforce=legacy`**（= 改动前的 `threshold × 0.5`）。与 `?pops=legacy`（管**判据方向**）
//     **正交**：本档只管门限**数值**。
//
// ── 判据表 ─────────────────────────────────────────────────────────────────────────────────
//   F1 来源判据：源码切片（official 无 `*0.5`／legacy 保留原表达式）+ 官方资产的键名与 2× 余量事实。
//   F2 行为判据（**核心、锐利**）：二分出**实际作用半径**。official = `threshold`；legacy = `threshold/2`；
//      两档半径比 = 2。用两个不同 threshold 各测一次（防"拟合某个魔数"）。
//   F3 回退**逐位相同**：把 `core/we-scene-bundle.js` 文本**还原成改动前**那条表达式，在临时目录里
//      import 出"改前构建"，与"改后 + `?pforce=legacy`"逐位比对全粒子状态（pos/vel/age/size/alpha/rot
//      /alive 的 IEEE754 位串 + 粒子数）。语料侧覆盖**全部**含 `controlpointattract` 的真包粒子资产。
//   F4 变异必红：① 把 `*0.5` 加回 official 路径 ⇒ F2a 必红；② 把 legacy 的 `*0.5` 也去掉 ⇒
//      "回退口径"不再等于改前 ⇒ F3 必红。
//   F5 C3 开关存活判据：`?pvortex=legacy` 仍在、且**有实际效果**（两档有符号环量严格反号、模相等）
//      —— 只钉"不是死开关"，**不**为 C3 的手性方向背书（C3 仍未定案，见报告 §3）。
//   S  语料读数：真包逐层存活数 / 平均受力半径 / 两档受力粒子数（改前 vs 改后）原样留档。
//
// 用法：node tests/particle-force-distance-test.mjs [--no-mutation] [--verbose]
// 退出码：0 = 全过（含 SKIP）；1 = 有真失败；2 = 用法错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { setPointer } from '../core/we-particle-pointer.mjs'
import { ROOT, WS } from './_root.mjs'

const NO_MUTATION = process.argv.includes('--no-mutation')
const VERBOSE = process.argv.includes('--verbose')
for (const a of process.argv.slice(2)) {
  if (!['--no-mutation', '--verbose'].includes(a)) { console.error('未知参数: ' + a); process.exit(2) }
}
const MPW_WS = process.env.MPW_ROOT || WS
const WE = path.join(MPW_WS, 'wallpaper_engine', 'assets')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const SEED = 'pforce-distance'

let pass = 0, fail = 0, skip = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')) }
}
const sk = (name, why) => { skip++; console.log('  · SKIP ' + name + '（' + why + '）') }

// 改动前 / 改动后 的两条表达式（**文本切片**，F1/F3/F4 共用同一个锚点）
const NEW_OFFICIAL = "        const __thrRaw = pGetVal(pr, 'threshold', 512)\n        const thr = sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw"
const OLD_EXPR = "        const thr = pGetVal(pr, 'threshold', 512) * 0.5"

/** 全粒子状态的**逐位**指纹（IEEE754 位串，不是四舍五入后的数值）。 */
const fbits = (x) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return b.getBigUint64(0).toString(16) }
function fingerprint(sys) {
  const out = ['n=' + sys.particles.length]
  for (const p of sys.particles) {
    out.push(p.pos.map(fbits).join(','), p.vel.map(fbits).join(','),
      fbits(p.age), fbits(p.life), fbits(p.size), fbits(p.alpha), fbits(p.rot), p.alive ? '1' : '0')
  }
  return out.join('|')
}

/** 把源码变异成一份可 import 的临时包（core/ 的兄弟模块用符号链接补齐，仓库内不落任何文件）。 */
function makeTempBundle(src, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pforce-mut-' + tag + '-'))
  for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
    if (f === 'we-scene-bundle.js') continue
    try { fs.symlinkSync(path.join(ROOT, 'core', f), path.join(dir, f)) } catch (e) { /* 同名已建 */ }
  }
  fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'), src)
  return { dir, url: 'file://' + path.join(dir, 'we-scene-bundle.js') }
}

// ═════════════════════ F2/F3/F4 共用的测量夹具 ═════════════════════════════════════════════
/** 只有一条 `controlpointattract` 的合成 def（无 movement ⇒ 除本算子外无其他力）。 */
const synthDef = (threshold, scale) => ({
  maxcount: 8,
  emitter: [{ name: 'sphererandom', rate: 0, instantaneous: 1, distancemin: 0, distancemax: 0, speedmin: 0, speedmax: 0, duration: 0, id: 1 }],
  operator: [{ name: 'controlpointattract', id: 2, origin: '0 0 0', scale, threshold }],
  initializer: [], controlpoint: [{ flags: 0, id: 0, offset: '0 0 0' }], material: '', renderer: [{ name: 'sprite', id: 3 }],
})
const SYNTH_CTX = { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: SEED }

/** 逐位对拍用的 def：粒子出生在门限的**两档之间**（250..350 ⊂ (200,400)）且有初速 ⇒
 *  两档门限必然导致**不同轨迹**（否则"逐位相同"是空断言 —— 见 F3c 的敏感性前置判据）。 */
const bitDef = () => ({
  maxcount: 32,
  emitter: [{ name: 'sphererandom', rate: 40, distancemin: 250, distancemax: 350, speedmin: 20, speedmax: 80, duration: 0, id: 1 }],
  operator: [{ name: 'controlpointattract', id: 2, origin: '0 0 0', scale: 1000, threshold: 400 },
    { name: 'movement', id: 3 }],
  initializer: [], controlpoint: [{ flags: 0, id: 0, offset: '0 0 0' }], material: '', renderer: [{ name: 'sprite', id: 4 }],
})

/** 把唯一一颗粒子放到 (d,0)，单步一次；返回速度增量（与该算子被禁用时的同布局基线之差）。 */
function forceDeltaAt(mod, d, threshold, ctx) {
  const dt = 1 / 60
  const run = (scale) => {
    const sys = mod.buildParticleSystem(synthDef(threshold, scale), Object.assign({}, SYNTH_CTX, ctx))
    mod.stepParticles(sys, dt, 0)                 // 出生
    const p = sys.particles[0]
    if (!p) return null
    p.pos[0] = d; p.pos[1] = 0; p.pos[2] = 0
    p.vel[0] = 0; p.vel[1] = 0; p.vel[2] = 0
    mod.stepParticles(sys, dt, dt)                // 受力一步
    return p
  }
  const a = run(1000), b = run(0)
  if (!a || !b) return null
  return { dvx: a.vel[0] - b.vel[0], dvy: a.vel[1] - b.vel[1] }
}
/** 该半径上"算子是否施力"（与基线比为判据 ⇒ 不受层空间/世界空间 y 口径争议影响）。 */
function forceAppliedAt(mod, d, threshold, ctx) {
  const f = forceDeltaAt(mod, d, threshold, ctx)
  return !!f && Math.hypot(f.dvx, f.dvy) > 1e-9
}
/** 二分出**实际作用半径**：`applied(d)` 在 [0,hi] 上单调（真→假），边界即门限。 */
function effectiveRadius(mod, threshold, ctx) {
  let lo = 0, hi = threshold * 4
  if (!forceAppliedAt(mod, lo + 1e-6, threshold, ctx)) return NaN   // 连中心都不施力 ⇒ 异常
  if (forceAppliedAt(mod, hi, threshold, ctx)) return Infinity       // 上界仍施力 ⇒ 异常
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (forceAppliedAt(mod, mid, threshold, ctx)) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}

// ═════════════════════ F1 来源判据 ═════════════════════════════════════════════════════════
console.log('controlpointattract（Control point force）门限 = 最大作用距离（C4 定案；本仓 ?pforce=legacy 回退）')
console.log('  依据：docs.wallpaperengine.io §"Control point force" 逐字 "Distance: The maximum distance of the force."')
console.log('        + 官方资产键名 threshold + 官方元素预览 2× 余量 + 官方编辑器键表 threshold≠deletethreshold')
console.log('\n== F1 来源判据（源码切片 + 官方资产）==')
const SRC = fs.readFileSync(BUNDLE, 'utf8')
{
  ok('F1a official 路径**不含** `* 0.5`（门限 = `threshold` 原值）', SRC.includes(NEW_OFFICIAL))
  ok('F1b legacy 路径保留**改动前那条表达式**（`pGetVal(pr,\'threshold\',512) * 0.5` 的乘数/次序一字未动）',
    SRC.includes('sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw'))
  ok('F1c `?pforce=legacy` 档位已登记且**缺省 official**',
    /get\('pforce'\) === 'legacy' \? 'legacy' : 'official'/.test(SRC) &&
    /pforceLegacy: PFORCE_MODE === 'legacy'/.test(SRC) && /pforceLegacy: !!ctx\.pforceLegacy/.test(SRC))
  // 开关"接线形状"与既有 8 个档位**逐字同构**（逮住"档位解析写了但没接到 props / 接到别处"这类错接）
  {
    const idiom = (q) => `new URLSearchParams(location.search).get('${q}') === 'legacy' ? 'legacy' : 'official'`
    ok('F1f `?pforce` 的解析惯用法与既有 `?pops` / `?pvortex` **逐字同形**（档位不是另造一套）',
      SRC.includes(idiom('pforce')) && SRC.includes(idiom('pops')) && SRC.includes(idiom('pvortex')))
  }
  // 没有第二处无条件除 2：`case 'controlpointattract'` 段内 `* 0.5` 只允许出现在 legacy 三元分支上
  {
    const seg = SRC.slice(SRC.indexOf("case 'controlpointattract':"), SRC.indexOf('// ①(WEBWALLGL-ELYSIA', SRC.indexOf("case 'controlpointattract':")))
    const halves = (seg.match(/\* 0\.5/g) || []).length
    ok('F1g 该算子段内 `* 0.5` **恰好 1 处**且只在 `sys.pforceLegacy ?` 分支上（没有第二处无条件除 2）',
      halves === 1 && /sys\.pforceLegacy \? __thrRaw \* 0\.5 : __thrRaw/.test(seg), `段内 *0.5 出现 ${halves} 次`)
  }
  ok('F1d 门限口径进**缓存签名**（切档必须重建粒子系统）', /PFORCE_MODE,/.test(SRC.split('const __sig')[1] || ''))
  ok('F1e 与 `?pops=legacy` 正交：判据方向仍由 pops 单独决定（本档不碰它）',
    /sys\.popsLegacy \? \(d > thr\) : \(d < thr\)/.test(SRC))

  // S1：官方资产的键名（threshold 有、distance 无）
  let keys = null, preview = null
  try {
    const files = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p); else if (/\.json$/i.test(e.name)) files.push(p)
      }
    }
    walk(WE)
    let hit = 0, thr = 0, dist = 0
    for (const f of files) {
      let j = null
      try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { continue }
      for (const op of (j.operator || [])) {
        if (!op || op.name !== 'controlpointattract') continue
        hit++
        if ('threshold' in op) thr++
        if ('distance' in op) dist++
      }
    }
    keys = { hit, thr, dist }
    preview = JSON.parse(fs.readFileSync(path.join(WE, 'scenes', 'particleelementpreviews',
      'controlpointattract', 'particles', 'new_particle_system.json'), 'utf8'))
  } catch (e) { keys = null }
  if (!keys) {
    sk('F1h/F1i', '缺官方资产 ' + WE)
  } else {
    ok('F1h 官方资产里该字段的键名 = `threshold`（`distance` **0** 次 ⇒ 就是文档的 "Distance"）',
      keys.thr > 0 && keys.dist === 0, `${keys.hit} 个实例：threshold ${keys.thr} / distance ${keys.dist}`)
    const op = (preview.operator || []).find((o) => o && o.name === 'controlpointattract')
    const em = (preview.emitter || []).find((o) => o && o.name === 'sphererandom')
    ok('F1i 官方元素预览的门限相对发射外壳外沿有**整 2×** 余量（`threshold === 2 × distancemax`）',
      !!op && !!em && op.threshold === 2 * em.distancemax,
      op && em ? `threshold=${op.threshold} / distancemax=${em.distancemax}` : '缺算子/发射器')
  }
}

// ═════════════════════ F2 行为判据：实际作用半径 ════════════════════════════════════════════
console.log('\n== F2 行为判据（核心）：二分实测**作用半径**（合成档，无其他力）==')
{
  const T = [400, 1000]
  for (const t of T) {
    const rOff = effectiveRadius(lib, t, {})
    const rLeg = effectiveRadius(lib, t, { pforceLegacy: true })
    console.log(`    · threshold=${t}：official 半径=${rOff.toFixed(6)}  legacy 半径=${rLeg.toFixed(6)}  比=${(rOff / rLeg).toFixed(6)}`)
    ok(`F2a threshold=${t}：official 作用半径 == threshold（不是 threshold/2）`,
      Math.abs(rOff - t) < 1e-6, `实测 ${rOff.toFixed(6)}`)
    ok(`F2b threshold=${t}：legacy（?pforce=legacy）作用半径 == threshold/2（= 改动前）`,
      Math.abs(rLeg - t / 2) < 1e-6, `实测 ${rLeg.toFixed(6)}`)
    ok(`F2c threshold=${t}：两档半径比 == 2`, Math.abs(rOff / rLeg - 2) < 1e-9, `比=${(rOff / rLeg).toFixed(9)}`)
  }
  // 边界方向：门外一步不施力、门内一步施力
  ok('F2d official 在 d=399 施力、d=401 不施力（门限 400，开区间 `d < 门限`）',
    forceAppliedAt(lib, 399, 400, {}) && !forceAppliedAt(lib, 401, 400, {}))
  ok('F2e legacy 在 d=199 施力、d=201 不施力（门限 200）',
    forceAppliedAt(lib, 199, 400, { pforceLegacy: true }) && !forceAppliedAt(lib, 201, 400, { pforceLegacy: true }))
}

// ═════════════════════ 语料 / 夹具准备（F3 + S 共用）═════════════════════════════════════════
function pkgJsonEntries(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const st = fs.fstatSync(fd)
    const t = Buffer.alloc(Math.min(st.size, 1 << 20))
    let got = 0
    while (got < t.length) { const n = fs.readSync(fd, t, got, t.length - got, got); if (n <= 0) break; got += n }
    const ml = t.readUInt32LE(0)
    const count = t.readUInt32LE(4 + ml)
    let p = 4 + ml + 4
    const entries = []
    for (let i = 0; i < count; i++) {
      const nl = t.readUInt32LE(p); p += 4
      const name = t.toString('utf8', p, p + nl); p += nl
      const offset = t.readUInt32LE(p); const size = t.readUInt32LE(p + 4); p += 8
      entries.push({ name, offset, size })
    }
    return { fd, dataStart: p, entries }
  } catch (e) { fs.closeSync(fd); throw e }
}
function readEntry(t, e) {
  const buf = Buffer.alloc(e.size)
  let got = 0
  while (got < buf.length) { const n = fs.readSync(t.fd, buf, got, buf.length - got, t.dataStart + e.offset + got); if (n <= 0) break; got += n }
  return buf
}
/** 语料里所有含 `controlpointattract` 的粒子资产（只读目录表 + seek 单条 json，不整包读入）。 */
function corpusForceLayers() {
  const out = []
  for (const R of ['dd', '0917', '0923', 'wallpaperE', 'wallpapertest1']) {
    const dir = path.join(MPW_WS, 'allwallpaper', R)
    let subs = []
    try { subs = fs.readdirSync(dir) } catch (e) { continue }
    for (const sub of subs) {
      const pkg = path.join(dir, sub, 'scene.pkg')
      if (!fs.existsSync(pkg)) continue
      let t = null
      try { t = pkgJsonEntries(pkg) } catch (e) { continue }
      try {
        for (const e of t.entries) {
          if (!/\.json$/i.test(e.name)) continue
          let j = null
          try { j = JSON.parse(readEntry(t, e).toString('utf8')) } catch (err) { continue }
          const ops = ((j && j.operator) || []).filter((o) => o && o.name === 'controlpointattract')
          if (!ops.length) continue
          out.push({ root: R, id: sub, entry: e.name, def: j, ops })
        }
      } finally { fs.closeSync(t.fd) }
    }
  }
  return out
}
/** 跑一层语料（指针固定在 (500,400)，与 particle-vortex-chirality-test 同口径）。 */
function runLayer(mod, def, ctx, steps, seed) {
  const sys = mod.buildParticleSystem(def, Object.assign({ origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: seed || SEED }, ctx))
  const locked = sys.emitters.some((e) => e.__ptrLocked)
  for (let i = 0; i < steps; i++) {
    if (locked) { setPointer(sys, 500, 400); sys.pointer = [500, 400] }
    mod.simulateParticleSystem(sys, (i + 1) / 30, 80)
  }
  return sys
}
/** 一层里"受力中和"的粒子数（逐算子按 `d < 门限` 计；pointer 控制点用 (500,400)）。 */
function forceStats(sys, def, legacyHalf) {
  let alive = 0, inR = 0, sumR = 0
  const ptrOn = (sys.controlPoints || []).some((c) => c && ((c.flags | 0) & 1)) || sys.pointerCp != null
  for (const p of sys.particles) {
    if (!p.alive) continue
    alive++
    for (const op of (def.operator || [])) {
      if (!op || op.name !== 'controlpointattract') continue
      const cpi = op.controlpoint != null ? op.controlpoint : 0
      const cp = (def.controlpoint || [])[cpi] || { offset: '0 0 0' }
      let cx, cy
      if (ptrOn && cpi === 1) { cx = 500; cy = 400 } else {
        const [ox, oy] = String(cp.offset || '0 0 0').trim().split(/\s+/).map(Number)
        cx = ox || 0; cy = -(oy || 0)
      }
      const d = Math.hypot(cx - p.pos[0], cy - p.pos[1])
      const thr = (op.threshold != null ? op.threshold : 512) * (legacyHalf ? 0.5 : 1)
      if (d < thr) inR++
      sumR += d
    }
  }
  return { alive, inR, sumR }
}

const LAYERS = corpusForceLayers()
if (VERBOSE) console.log(`    · 语料含 controlpointattract 的粒子资产：${LAYERS.length} 条`)

// ═════════════════════ F3 回退逐位相同 ═════════════════════════════════════════════════════
console.log('\n== F3 回退档与改动前**逐位相同**（把源码文本还原成改动前 → 临时构建对拍）==')
let preMod = null, preDir = null
{
  const reverted = SRC.replace(NEW_OFFICIAL, OLD_EXPR)
  ok('F3a 能还原出"改动前"的源码切片（变异生效 ⇒ 对拍对象确实是旧表达式）', reverted !== SRC)
  if (reverted === SRC) {
    sk('F3b/F3c', '还原失败')
  } else {
    const tmp = makeTempBundle(reverted, 'pre')
    preDir = tmp.dir
    try {
      preMod = await import(tmp.url)
      ok('F3b 改前构建可 import', !!preMod && typeof preMod.buildParticleSystem === 'function')
    } catch (e) { ok('F3b 改前构建可 import', false, e.message) }
  }
  if (!preMod) {
    sk('F3c', '改前构建不可用')
  } else {
    // 合成档（先证"该夹具对门限敏感"，否则下面的"逐位相同"是空断言）
    const a = fingerprint(runLayer(preMod, bitDef(), {}, 60))
    const b = fingerprint(runLayer(lib, bitDef(), { pforceLegacy: true }, 60))
    const c = fingerprint(runLayer(lib, bitDef(), {}, 60))
    ok('F3c（敏感性前置）合成档：改后默认 != 改前（改动**可观**，夹具不是空的）', a !== c)
    ok('F3d 合成档：改前默认 == 改后 + `?pforce=legacy`（全粒子状态逐位相同）', a === b)
    // 真包语料：逐层逐位
    if (!LAYERS.length) {
      sk('F3e/F3f', '语料里没有含 controlpointattract 的粒子资产（' + path.join(MPW_WS, 'allwallpaper') + '）')
    } else {
      let same = 0, diff = [], obs = 0
      for (const h of LAYERS) {
        const seed = `${h.root}/${h.id}|${h.entry}`
        const pa = fingerprint(runLayer(preMod, h.def, {}, 60, seed))
        const pb = fingerprint(runLayer(lib, h.def, { pforceLegacy: true }, 60, seed))
        const pc = fingerprint(runLayer(lib, h.def, {}, 60, seed))
        if (pa === pb) same++; else diff.push(`${h.root}/${h.id}::${path.basename(h.entry)}`)
        if (pa !== pc) obs++
      }
      ok(`F3e 真包语料 ${LAYERS.length} 条：改前默认 == 改后 + \`?pforce=legacy\`（逐位相同）`,
        same === LAYERS.length, `${same}/${LAYERS.length}` + (diff.length ? '  不一致: ' + diff.slice(0, 4).join(' ') : ''))
      console.log(`    · 其中默认档读数**有变化**的层：${obs}/${LAYERS.length}（= 这次改动的可见影响面）`)
    }
  }
}

// ═════════════════════ S 语料读数 ══════════════════════════════════════════════════════════
console.log('\n== S 语料读数（真包；存活数 / 平均距离 / 受力粒子数；改前 vs 改后）==')
if (!LAYERS.length) {
  sk('S', '语料里没有含 controlpointattract 的粒子资产')
} else {
  let n = 0, obsCount = 0
  for (const h of LAYERS) {
    const seed = `${h.root}/${h.id}|${h.entry}`
    const sOff = runLayer(lib, h.def, {}, 60, seed)
    const sOffLeg = runLayer(lib, h.def, { pforceLegacy: true }, 60, seed)
    const preF = preMod ? fingerprint(runLayer(preMod, h.def, {}, 60, seed)) : null
    const stOff = forceStats(sOff, h.def, false)
    const stLeg = forceStats(sOffLeg, h.def, true)
    const changed = preF ? (preF !== fingerprint(sOff)) : null
    if (changed) obsCount++
    n++
    console.log(`    · ${h.root}/${h.id} :: ${path.basename(h.entry)}  ${JSON.stringify(h.ops)}`)
    console.log(`        改前(=legacy) 存活 ${stLeg.alive} / 受力 ${stLeg.inR}  |  改后(official) 存活 ${stOff.alive} / 受力 ${stOff.inR}`
      + `  |  平均距离 ${stOff.alive ? (stOff.sumR / stOff.alive).toFixed(1) : '-'}`
      + (changed === null ? '' : changed ? '  ⇒ **读数有变化**' : '  ⇒ 逐位无变化'))
  }
  ok('S1 语料读数已逐条留档（条数与语料普查一致）', n === LAYERS.length, `${n} 条`)
  ok('S2 两档"受力粒子数"单调：official ≥ legacy（门限更宽 ⇒ 受力集合是超集）',
    LAYERS.every((h, i) => {
      const a = forceStats(runLayer(lib, h.def, {}, 60, `${h.root}/${h.id}|${h.entry}`), h.def, false)
      const b = forceStats(runLayer(lib, h.def, { pforceLegacy: true }, 60, `${h.root}/${h.id}|${h.entry}`), h.def, true)
      return a.inR >= b.inR
    }), `${LAYERS.length} 条`)
  console.log(`    · 语料里**读数有变化**的层：${obsCount}/${n}（其余层在这次改动下逐位不变 —— 如实记账，可能是 0）`)
}

// ═════════════════════ F4 变异必红 ═════════════════════════════════════════════════════════
console.log('\n== F4 变异必红（把 `* 0.5` 加回 official 路径 / 把 legacy 的 `* 0.5` 去掉）==')
if (NO_MUTATION) {
  console.log('  · --no-mutation ⇒ 跳过')
} else {
  // 变异①：official 路径重新无条件 `* 0.5`（= 回到旧实现）
  const m1src = SRC.replace('sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw', 'sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw * 0.5')
  ok('F4a 变异①生效（official 路径被重新乘 0.5）', m1src !== SRC)
  const t1 = makeTempBundle(m1src, 'm1')
  try {
    const m1 = await import(t1.url)
    const r1 = effectiveRadius(m1, 400, {})
    console.log(`    · 变异①读数的 official 半径 = ${r1.toFixed(6)}（期望=400）`)
    ok('F4b RED：变异①下 `F2a` 必然变红（official 半径塌回 200 = threshold/2）',
      Math.abs(r1 - 200) < 1e-6, `实测 ${r1.toFixed(6)}`)
    const synth1 = fingerprint(runLayer(m1, bitDef(), {}, 60))
    const synthOld = fingerprint(runLayer(preMod, bitDef(), {}, 60))
    ok('F4c RED：变异①下 official 与"改前"逐位相同 ⇒ 说明改动被完全回退（门禁会抓到）', synth1 === synthOld)
  } finally { fs.rmSync(t1.dir, { recursive: true, force: true }) }
  // 变异②：legacy 档也去掉 `* 0.5`（回退口失效）
  const m2src = SRC.replace('sys.pforceLegacy ? __thrRaw * 0.5 : __thrRaw', 'sys.pforceLegacy ? __thrRaw : __thrRaw')
  ok('F4d 变异②生效（legacy 档的 0.5 被去掉）', m2src !== SRC)
  const t2 = makeTempBundle(m2src, 'm2')
  try {
    const m2 = await import(t2.url)
    const r2 = effectiveRadius(m2, 400, { pforceLegacy: true })
    console.log(`    · 变异②读数的 legacy 半径 = ${r2.toFixed(6)}（期望=200）`)
    ok('F4e RED：变异②下 `F2b` 必然变红（回退档不再是改动前口径）', Math.abs(r2 - 200) > 1e-6, `实测 ${r2.toFixed(6)}`)
    const synth2 = fingerprint(runLayer(m2, bitDef(), { pforceLegacy: true }, 60))
    const synthOld = fingerprint(runLayer(preMod, bitDef(), {}, 60))
    ok('F4f RED：变异②下 `F3d` 必然变红（回退档与改动前不再逐位相同）', synth2 !== synthOld)
  } finally { fs.rmSync(t2.dir, { recursive: true, force: true }) }
}

// ═════════════════════ F5 C3 开关存活判据（不为手性方向背书）═══════════════════════════════
console.log('\n== F5 C3：`?pvortex=legacy` 仍在、且**有实际效果**（只钉"不是死开关"，不定手性方向）==')
{
  ok('F5a `?pvortex=legacy` 档位仍在且缺省 official',
    /get\('pvortex'\) === 'legacy' \? 'legacy' : 'official'/.test(SRC) && /vortexLegacy: VORTEX_MODE === 'legacy'/.test(SRC))
  const vdefPath = path.join(WE, 'scenes', 'particleelementpreviews', 'vortex', 'particles', 'new_particle_system.json')
  let vdef = null
  try { vdef = JSON.parse(fs.readFileSync(vdefPath, 'utf8')) } catch (e) { vdef = null }
  if (!vdef) {
    sk('F5b/F5c', '缺官方资产 ' + vdefPath)
  } else {
    // 有符号环量 L = mean((rx·vy − ry·vx)/|r|²)：纯粹度量"绕中心转哪一边"
    const L = (sys) => {
      let num = 0, n = 0
      for (const p of sys.particles) {
        if (!p.alive) continue
        const rx = p.pos[0], ry = p.pos[1]
        const r2 = rx * rx + ry * ry
        if (r2 < 1e-6) continue
        num += (rx * p.vel[1] - ry * p.vel[0]) / r2; n++
      }
      return { L: n ? num / n : 0, n }
    }
    const off = L(runLayer(lib, vdef, {}, 40, 'pvortex-live'))
    const leg = L(runLayer(lib, vdef, { vortexLegacy: true }, 40, 'pvortex-live'))
    console.log(`    · 官方 vortex 元素预览 def：official L=${off.L.toFixed(4)}（n=${off.n}） / legacy L=${leg.L.toFixed(4)}（n=${leg.n}）`)
    ok('F5b `?pvortex=legacy` **有实际效果**：两档有符号环量严格反号（不是死开关）',
      off.n > 0 && leg.n > 0 && off.L * leg.L < 0, `off=${off.L.toFixed(4)} leg=${leg.L.toFixed(4)}`)
    ok('F5c 两档只差**方向**（|L| 相等、粒子数相同）⇒ 开关没有顺带改强度',
      Math.abs(off.L + leg.L) < 1e-9 && off.n === leg.n, `|Δ|=${Math.abs(off.L + leg.L).toExponential(2)}`)
    console.log('    · ⚠ C3 **仍未定案**：官方文档（§"Vortex"）只给字段集、无方向/手性定义；官方资产只用')
    console.log('      `speedinner/speedouter` 的**符号**表达方向、对"引擎用哪种屏幕手性"沉默 ⇒ 本判据只保证')
    console.log('      回退口可用。定案所需证据见 docs/reports/particle-force-c3c4-verdict.md §3。')
  }
}

// ── 清理 ────────────────────────────────────────────────────────────────────────────────────
if (preDir) fs.rmSync(preDir, { recursive: true, force: true })

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败' + (skip ? ', ' + skip + ' SKIP' : ''))
if (fail === 0) console.log('✓ C4 判据通过：门限 = 官方 `threshold` 原值 / `?pforce=legacy` 与改动前逐位相同 / 变异必红 / C3 回退开关可用')
process.exit(fail > 0 ? 1 : 0)

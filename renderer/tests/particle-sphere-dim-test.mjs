/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · `references/vendor-ref/webwallgl`（oneincase/webwallgl，**MIT**）—— 本文件只把它当**行为对照**读，
 *     复制的是**本仓自己**的算式（见下"legacy 参考体"就是本仓 git 历史里的原文）；
 *   · `references/wer-ref`（GPL-2.0-only）、`references/lwe-ref`（GPL-3.0-only）与本项目
 *     GPL-3.0-or-later 不兼容，本文件不引用其任何内容。
 */
// particle-sphere-dim-test.mjs —— `sphererandom` 发射器的**方向维度 + 半径分布**回归门禁
//
// 依据：`docs/UPSTREAM-TRIAGE-20260923.md` §4 第 2 条（主表 #5/#6，上游 commit `78718843`
// 的 `renderer/vendor/we-scene/render/particles.js` `@@ -1068`）。
//
// ── 两条口径（official = 新默认；`?psph=legacy` 逐位回退）────────────────────────────────────
//   ① **方向维度由 `directions` 的激活轴数决定**：`|dir[2]| ≤ 1e-6 ⇒ pz = 0`、(nx,ny) 是**严格单位圆**。
//      ⚠ 触发条件要看 `pVec3` 的**标量广播**：`"distancemin": 256` → `[256,256,256]`（不是 `[256,0,0]`）
//      ⇒ 语料里最常见的 `distancemin/distancemax` 标量写法**本来就带非零 z 行程**，旧口径下
//      `pz = signOf(2)*zr = ±256` 白送一个 z（本文件 A 段的 legacy 读数就是 ±256）。
//   ② **半径按维度做幂次分布**：`r = (lo^d + u·(hi^d−lo^d))^(1/d)`（d=2 面积均匀、d=3 体积均匀）。
//      旧口径线性均匀 ⇒ 圆盘中心堆积：d=2 时半径中位数是 `rmax/2`，官方语义下是 `rmax/√2`。
//
// ── 断言分三类（对齐上游同款判据的形状）─────────────────────────────────────────────────────
//   A `directions "1 1 0"` + `distance 256/256` ⇒ 出生 `|pz| < 1e-6` 且 `hypot(x,y) ∈ [254,258]`；
//     并给出 **legacy 的对照读数**（同配置下 `pz = ±256`）⇒ 这条断言有分辨力。
//   B `directions "1 1 1"` + 同距离 ⇒ **允许**投影半径缩短（含接近 0 的样本），但必须仍有粒子、
//     且 z **不得恒为 0**（防"改成强制 2D"的过度修正）。
//   C 2D 面积均匀性：`distancemin 0 / distancemax 256` 时半径**中位数 ≈ 256/√2 ≈ 181.0**
//     （legacy 档 ≈ 128）。
//   D `legacy 逐位不变`：把**改动前**的那 6 行算式（本文件内联的"legacy 参考体"）用同一份源码切片
//     变异回 bundle 里，同种子同 def 逐颗粒子比 `pos` —— 必须**逐位相等**（`Object.is`）。
//
// 用法：node tests/particle-sphere-dim-test.mjs [--no-mutation] [--verbose]
//   --no-mutation  跳过 D 段的源码切片变异（不写临时模块）
// 退出码：0 = 全过；1 = 有真失败；2 = 用法错误。
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { ROOT } from './_root.mjs'

const NO_MUTATION = process.argv.includes('--no-mutation')
const VERBOSE = process.argv.includes('--verbose')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ── 夹具 ──────────────────────────────────────────────────────────────────────────────────
const SEED = 'psph-sphere-dim'
const mkDef = (em, over = {}) => Object.assign({
  maxcount: 64, starttime: 0,
  emitter: [em],
  // 无 initializer：让每次 spawn 的 RNG 消耗只有"发射器 + p.random"两项 ⇒ 参考体可逐位复算
  initializer: [],
  operator: [],
  renderer: [{ name: 'sprite' }],
}, over)
const mkSys = (def, ctx = {}) => lib.buildParticleSystem(def, Object.assign({
  origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: SEED,
}, ctx))

/** 直接连抽 n 次出生位置（不推进仿真：只测"出生期"口径，与算子/寿命无关）。 */
function births(def, ctx, n) {
  const sys = mkSys(def, ctx)
  const em = sys.emitters[0]
  const out = []
  for (let i = 0; i < n; i++) {
    const p = lib.spawnParticle(sys, em)
    if (!p) throw new Error('spawnParticle 返回 null（夹具不该触发 lockToPointer）')
    out.push([p.pos[0], p.pos[1], p.pos[2]])
  }
  return out
}
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ⚠ `distancemin/distancemax` 用**标量**：`pVec3` 广播成 `[v,v,v]`（见 bundle 的 `pVec3`），
//   所以 `256` 等价于 `"256 256 256"` —— 这正是"z 行程非零、旧口径白送 z"的现场。
const EM_2D = { name: 'sphererandom', rate: 60, distancemin: 256, distancemax: 256, directions: '1 1 0', origin: '0 0 0' }
const EM_3D = { name: 'sphererandom', rate: 60, distancemin: 256, distancemax: 256, directions: '1 1 1', origin: '0 0 0' }
const EM_DISC = { name: 'sphererandom', rate: 60, distancemin: 0, distancemax: 256, directions: '1 1 0', origin: '0 0 0' }

console.log('sphererandom 方向维度 / 半径分布（上游 commit 78718843 @@ -1068；本仓 ?psph=legacy 回退）')
console.log('  被测实现 : core/we-scene-bundle.js 的 spawnParticle（渲染路径在跑的那份）')

// ── A |pz| < 1e-6（2D 激活轴屏蔽）────────────────────────────────────────────────────────
console.log('\n== A `directions "1 1 0"` + distance 256/256：z 必须被激活轴屏蔽 ==')
{
  const N = 800
  const off = births(mkDef(EM_2D), {}, N)
  const maxAbsZ = Math.max(...off.map((p) => Math.abs(p[2])))
  const rad = off.map((p) => Math.hypot(p[0], p[1]))
  const rMin = Math.min(...rad), rMax = Math.max(...rad)
  ok('A1 official：`|pz| < 1e-6`（800 颗里最大的 |pz|）', maxAbsZ < 1e-6, 'max|pz|=' + maxAbsZ.toExponential(2))
  ok('A2 official：`hypot(x,y) ∈ [254,258]`（严格单位圆 × r=256）', rMin >= 254 && rMax <= 258,
    `r ∈ [${rMin.toFixed(3)}, ${rMax.toFixed(3)}]`)
  const leg = births(mkDef(EM_2D), { sphLegacy: true }, N)
  const legMaxZ = Math.max(...leg.map((p) => Math.abs(p[2])))
  const legMinZ = Math.min(...leg.map((p) => Math.abs(p[2])))
  console.log(`    · 对照读数（legacy ` + '`?psph=legacy`' + `）：|pz| ∈ [${legMinZ.toFixed(3)}, ${legMaxZ.toFixed(3)}]`
    + `（恒 = 256 ⇒ 旧口径白送一个 ±256 的 z）；hypot(x,y) ∈ [${Math.min(...leg.map((p) => Math.hypot(p[0], p[1]))).toFixed(3)}, ${Math.max(...leg.map((p) => Math.hypot(p[0], p[1]))).toFixed(3)}]`)
  ok('A3 分辨力：legacy 档的 |pz| 恒 = 256（⇒ A1 不是恒真断言）', Math.abs(legMinZ - 256) < 1e-9 && Math.abs(legMaxZ - 256) < 1e-9,
    `legacy |pz| ∈ [${legMinZ}, ${legMaxZ}]`)
}

// ── B 3D 激活轴：允许投影缩短，但不得被强制成 2D ───────────────────────────────────────────
console.log('\n== B `directions "1 1 1"`：投影半径可缩短，但 z 不得恒 0（防过度修正）==')
{
  const N = 800
  const p3 = births(mkDef(EM_3D), {}, N)
  const rad = p3.map((p) => Math.hypot(p[0], p[1]))
  const zAbs = p3.map((p) => Math.abs(p[2]))
  ok('B1 仍有粒子（800/800 出生成功）', p3.length === N)
  ok('B2 投影半径**确实会缩短**（3D 球面采样的必然结果；最小样本 < 128）', Math.min(...rad) < 128,
    `min hypot=${Math.min(...rad).toFixed(2)} / max=${Math.max(...rad).toFixed(2)}`)
  ok('B3 z **不得恒为 0**（否则是"强制 2D"的过度修正）', Math.max(...zAbs) > 1e-6,
    `max|z|=${Math.max(...zAbs).toFixed(2)}`)
  ok('B4 三维半径仍是球面（`hypot3 ≈ 256`）',
    p3.every((p) => Math.abs(Math.hypot(p[0], p[1], p[2]) - 256) < 1e-6),
    '样例 hypot3=' + Math.hypot(p3[0][0], p3[0][1], p3[0][2]).toFixed(4))
}

// ── C 半径分布：2D 面积均匀（中位数 rmax/√2）──────────────────────────────────────────────
console.log('\n== C 2D 半径中位数：official ≈ 256/√2 ≈ 181.0 / legacy ≈ 128 ==')
{
  const N = 6000
  const off = births(mkDef(EM_DISC), {}, N)
  const med = median(off.map((p) => Math.hypot(p[0], p[1])))
  const leg = births(mkDef(EM_DISC), { sphLegacy: true }, N)
  const legMed = median(leg.map((p) => Math.hypot(p[0], p[1])))
  const expect = 256 / Math.SQRT2
  ok('C1 official 半径中位数 ≈ 181.0（±6；n=6000 时样本中位数的标准误 ≈ 1.4）',
    Math.abs(med - expect) < 6, `实测 ${med.toFixed(2)}（期望 ${expect.toFixed(2)}）`)
  ok('C2 legacy 半径中位数 ≈ 128（线性均匀）', Math.abs(legMed - 128) < 6, `实测 ${legMed.toFixed(2)}`)
  ok('C3 两档确实不同（⇒ C1 有分辨力）', Math.abs(med - legMed) > 30, `Δ=${(med - legMed).toFixed(2)}`)
  if (VERBOSE) console.log(`    · 分位：p10=${median(off.map((p) => Math.hypot(p[0], p[1])))}`)
}

// ── D legacy 逐位不变（对"改动前的 6 行算式"做源码切片变异）────────────────────────────────
console.log('\n== D `?psph=legacy` 逐位不变（对改动前算式的源码切片变异）==')
const LEGACY_BODY = [
  "    const angle = rng() * Math.PI * 2",
  "    const minR = em.distanceMin[0], maxR = em.distanceMax[0]",
  "    const r = minR + rng() * (maxR - minR)",
  "    const zr = em.distanceMin[2] !== undefined ? (em.distanceMin[2] + rng() * Math.abs((em.distanceMax[2] || 0) - em.distanceMin[2])) : r",
  "    px = Math.cos(angle) * r * em.directions[0]",
  "    py = Math.sin(angle) * r * em.directions[1]",
  "    pz = (em.directions[2] ? signOf(2) * zr * em.directions[2] : signOf(2) * zr)",
].join('\n')
if (NO_MUTATION) {
  console.log('  · --no-mutation ⇒ 跳过（D 段是"legacy = 改动前"的唯一证明，正式门禁不要跳过）')
} else {
  const src = fs.readFileSync(BUNDLE, 'utf8')
  const re = /(if \(em\.name === 'sphererandom'\) \{\n)[\s\S]*?(\n  \} else \{\n    \/\/ boxrandom)/
  ok('D1 变异锚点在位（`sphererandom` 分支 + `// boxrandom` 后继）', re.test(src))
  const mutated = src.replace(re, '$1' + LEGACY_BODY + '$2')
  ok('D2 变异生效（切片被替换）', mutated !== src && mutated.includes(LEGACY_BODY))
  ok('D3 变异后源码不再有 `sphLegacy` 分支（= 改动前的形态）', !/if \(sys\.sphLegacy\)/.test(mutated))
  // 临时模块必须落在 core/ 里，bundle 的 6 个相对 import 才能解析
  const tmp = path.join(ROOT, 'core', '.psph-mut-' + process.pid + '.mjs')
  try {
    fs.writeFileSync(tmp, mutated)
    const oldLib = await import('file://' + tmp)
    const N = 400
    const cmp = (def, ctx, tag) => {
      const a = births(def, ctx, N)                                       // 现实现（档位）
      const sysOld = oldLib.buildParticleSystem(def, Object.assign({ origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: SEED }, ctx))
      const emOld = sysOld.emitters[0]
      let bad = 0
      let first = null
      for (let i = 0; i < N; i++) {
        const q = oldLib.spawnParticle(sysOld, emOld)
        const a3 = a[i]
        if (!Object.is(a3[0], q.pos[0]) || !Object.is(a3[1], q.pos[1]) || !Object.is(a3[2], q.pos[2])) {
          bad++
          if (!first) first = `#${i} 现[${a3}] vs 旧[${q.pos.slice(0, 3)}]`
        }
      }
      ok(tag, bad === 0, bad === 0 ? `${N}/${N} 逐位相等` : `${bad}/${N} 不等（首例 ${first}）`)
    }
    cmp(mkDef(EM_2D), { sphLegacy: true }, 'D4 `?psph=legacy` 与改动前逐位相等 · directions "1 1 0"（distance 256/256）')
    cmp(mkDef(EM_DISC), { sphLegacy: true }, 'D5 `?psph=legacy` 与改动前逐位相等 · directions "1 1 0"（distance 0/256）')
    cmp(mkDef(EM_3D), { sphLegacy: true }, 'D6 `?psph=legacy` 与改动前逐位相等 · directions "1 1 1"')
    // 反向：新默认**必须**与改动前不同（否则"翻默认"没有发生）
    const aNew = births(mkDef(EM_2D), {}, N)
    const sysOld2 = oldLib.buildParticleSystem(mkDef(EM_2D), { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: SEED })
    const emOld2 = sysOld2.emitters[0]
    let same = 0
    for (let i = 0; i < N; i++) {
      const q = oldLib.spawnParticle(sysOld2, emOld2)
      if (Object.is(aNew[i][2], q.pos[2]) && Object.is(aNew[i][0], q.pos[0])) same++
    }
    ok('D7 新默认**不再**等于改动前（z 被屏蔽 ⇒ 默认确实翻了）', same < N, `${N - same}/${N} 颗与旧不同`)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

// ── E RNG 流对齐：本档位**不得平移整条粒子 RNG 流** ─────────────────────────────────────────
console.log('\n== E RNG 流对齐（`?psph` 只改"z 屏蔽 + 半径分布"，不换掉与本档无关的随机量）==')
{
  // `p.random` 是在**发射器抽签之后**抽的（`spawnParticle` 尾部的 `random: rng()`）⇒
  // 两档的 `p.random` 逐位相同 ⟺ 发射器的抽签**次数**相同 ⟺ 整条流没有平移。
  // （本仓纪律见 `?pturb`/`?pspeed` 的"不额外抽签"注释；实测不这么做会把既有门禁
  //  `particle-render-correctness-test.mjs` ⑥D 的萤火虫 corr 统计从 0.9515 扰动到 0.9957 ⇒ 变红。）
  const N = 200
  const draw = (def, ctx) => {
    const sys = mkSys(def, ctx)
    const em = sys.emitters[0]
    const out = []
    for (let i = 0; i < N; i++) out.push(lib.spawnParticle(sys, em).random)
    return out
  }
  const a = draw(mkDef(EM_2D), {})
  const b = draw(mkDef(EM_2D), { sphLegacy: true })
  ok('E1 `directions "1 1 0"`：逐粒子 `random` 与 legacy 逐位相同（抽签次数未变 ⇒ 流未平移）',
    a.every((v, i) => Object.is(v, b[i])), `${N}/${N} 颗`)
  const c = draw(mkDef(EM_3D), {})
  const d = draw(mkDef(EM_3D), { sphLegacy: true })
  ok('E2 `directions "1 1 1"`：逐粒子 `random` 与 legacy 逐位相同', c.every((v, i) => Object.is(v, d[i])), `${N}/${N} 颗`)
  // 反证：位置必须**不同**，否则 E1 只是因为"两档等价"才成立（断言没有信息量）
  const pA = births(mkDef(EM_2D), {}, 8)
  const pB = births(mkDef(EM_2D), { sphLegacy: true }, 8)
  ok('E3 反证：同种子下两档**位置**确实不同（⇒ E1 有信息量，不是"两档等价"）',
    pA.some((p, i) => !Object.is(p[2], pB[i][2])), `z: ${pA[0][2]} vs ${pB[0][2]}`)
}

// ── 结果 ──────────────────────────────────────────────────────────────────────────────────
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败' + (NO_MUTATION ? '（D 段变异已跳过）' : ''))
if (fail === 0) console.log('✓ sphererandom 维度/半径判据通过：z 按激活轴屏蔽 / 2D 面积均匀 / 3D 不被强制成 2D / legacy 逐位不变')
process.exit(fail > 0 ? 1 : 0)

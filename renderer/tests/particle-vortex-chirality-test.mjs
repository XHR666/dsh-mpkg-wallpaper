/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · `references/vendor-ref/webwallgl`（oneincase/webwallgl，**MIT**）—— `core/we-particle-pointer.mjs`
 *     的 `vortexSwirl` 是 P-136 照抄来的（见该文件文件头与 `THIRD-PARTY.md`），本文件只**读**它做行为对照；
 *   · `references/wer-ref`（GPL-2.0-only）、`references/lwe-ref`（GPL-3.0-only）、
 *     `references/reference/open-wallpaper-engine`（若在）与本项目 GPL-3.0-or-later 许可不兼容，
 *     本文件不引用其任何内容 —— 方向取值的取证与权重见 `docs/VORTEX-CHIRALITY-RE-20260923.md`。
 */
// particle-vortex-chirality-test.mjs —— `vortex` 算子**切向手性**的回归门禁
//
// 依据：`docs/VORTEX-CHIRALITY-RE-20260923.md`（取证报告）+ `docs/UPSTREAM-TRIAGE-20260923.md` §4 第 3 条。
//
// ── 结论与**必须如实声明的前提**──────────────────────────────────────────────────────────────
//   official（**本批新默认**）= `(dy, −dx)` = `radial × axis` = `−axis × radial`（`axis=(0,0,1)`）；
//   `?pvortex=legacy` = 改动前的 `(−dy, +dx)` = `axis × radial`。
//   ⚠ **本机没有任何 WE 官方反编译产物，官方资产里也没有方向定义**（`magic_vortex*` 预设与官方
//     元素预览场景只锁字段集）。`(dy,−dx)` 的依据是**第三方参考实现的多实现共识**：
//       · `references/wer-ref`（`relative.cross(axis)`）与 `open-wallpaper-engine`
//         （`-axis.cross(radial)`）**同源**（共享 `contropoint` 误拼）⇒ 只算**一条**口径；
//       · 上游 `oneincase/webwallgl` 在 commit `78718843`（v1.4.1，2026-09-22）**带理由单向翻转**
//         到 `(dy,−dx)`（自述为对齐官方观测）—— 最强的一条"过程性"证据；
//       · `references/lwe-ref`（`cross(axis, radial)`）用老符号，但它在 `vortex_v2` 语义上
//         **可验证地偏离官方数据**（把 `flags&2` 当环形，而官方 `magic_vortex_orb.json` 是
//         `flags:2` **且**带 `ringradius/ringwidth/ringpulldistance`）⇒ 权重最低。
//   ⇒ 这是"**证据更强的一方**"，不是"已证实的一方"。**不要把这次改动写成"对齐官方"**。
//     官方级结论需要真机录 WE 出帧对拍（本机拿不到）。
//
// ── 语料核对（离线几何判据，读数原样留档）───────────────────────────────────────────────────
//   判据 = 存活粒子绕涡旋圆心的**有符号角速度均值** `L = mean((rx·vy − ry·vx)/|r|²)`。
//   `official (dy,−dx)` 驱动 L < 0；`legacy (−dy,+dx)` 驱动 L > 0。90 步 @30fps、固定种子。
//   全语料（`$MPW_ROOT/allwallpaper/**` 的 21 个 `scene.pkg`，逐包只 seek 读单个 json 入口）里
//   带 `vortex` 算子的粒子资产共 **5 处 / 4 个包**（`dd` 3 个：3544152633 / 3554161528 / 3660962877；
//   `0917` 2 个：3195212886 / 3233141951）。每行都是本文件 V3 段**实测打印**的读数
//   （90 步 @30fps、种子 = `<root>/<id>|<entry>`、指针固定在 (500,400)）：
//
//   | 包 :: 粒子资产 | vortex 参数 | L(official) | L(legacy) | 判定 |
//   |---|---|---|---|---|
//   | `dd/3544152633 :: Stars_copy1.json` | `{audioprocessingmode:3}`（无 speed 字段 ⇒ 强度缺省 1） | **−0.0052** | **+0.0052** | ✅ 干净反向（n=134）——**唯一**能判向的一处 |
//   | `dd/3554161528 :: Cherry_Blossoms_2.json` | `{distanceinner:0,distanceouter:50,speedinner:300,speedouter:0}` | +0.0010 | +0.0140 | ❌ 分不清（同号） |
//   | `dd/3660962877 :: Cherry_Blossoms_2.json` | 同上 | −0.0018 | +0.0129 | ⚠ 符号相反但 official 侧 \|L\|≈0.002（噪声量级）⇒ 不足以判向 |
//   | `0917/3195212886 :: Cherry_Blossoms_2.json` | 同上 | +0.0025 | +0.0123 | ❌ 分不清（同号） |
//   | `0917/3233141951 :: Cherry_Blossoms_2.json` | 同上 + `axis:"0 0 1"` | +0.0094 | +0.0093 | ❌ **完全**分不清（\|ΔL\|=1e−4） |
//
//   ⇒ **语料判据不能仲裁方向**：5 处里只有 1 处干净可分辨。原因是这 4 处 `Cherry_Blossoms_2`
//   的涡旋参数是 `distanceouter:50 / speedouter:0` —— **50px 之外施加的切向速度恰好为 0**，
//   而该层被 `mapsequencearoundcontrolpoint`（initializer 直接摆位/给速）主导 ⇒ 涡旋的贡献
//   被盖住。**唯一干净的那处**（Stars_copy1）反而说明判据本身是对的：两档严格只差符号。
//   （对照：官方元素预览场景的 vortex def `{speedinner:100}` 无 `distanceouter` ⇒ 全域施力，
//    两档读数 L = ∓0.3218，见 V2 —— 判据在"涡旋主导"的层上是锐利的。）
//
//   ⇒ 按取证报告的**更强证据**（第三方共识 + 上游带理由翻转）**仍然翻默认**；本判据的定位是
//     **佐证 + 回归**（钉住"两档确实相反、接线不是死开关"），**不是**方向仲裁。这一结论与
//     `docs/VORTEX-CHIRALITY-RE-20260923.md` §6 第 6 条（"本机拿不到官方级结论"）一致。
//
//   ⚠ 另一条语料事实（供台账）：官方预设 `magic_vortex_orb.json` 用的算子是 **`vortex_v2`**
//     （+ ring 字段）与独立的 `maintaindistancetocontrolpoint`，而且**它不在任何 `.pkg` 里**
//     （只在 `wallpaper_engine/assets/presets/magic/…`，是 WE 安装目录自带的预设）。
//     本仓 `core/` 与 `demo/assets/*.js` 里 `vortex_v2` **0 命中**，算子 switch **没有 `default:`**
//     ⇒ 真吃到它只会静默少一个力。**本轮不实现**，建议单开一条。
//
// ── 判据（V1/V2 是断言；V3 是语料读数留档；V4 是"改回去必红"）────────────────────────────────
//   V1 纯函数：圆心 (0,0)、粒子在 (r,0) ⇒ official 切向 `(0, −speed·dt)`、legacy `(0, +speed·dt)`。
//   V2 端到端：官方元素预览场景 `assets/scenes/particleelementpreviews/vortex/particles/
//      new_particle_system.json`（**官方资产**，vortex 在该层是主导力）⇒ L(official) < 0 且
//      L(legacy) > 0，且两档**数值只差符号**。
//   V3 语料读数（上表）逐条打印；`dd` 的两处参与断言（一处符号翻转、一处**只断言"两档不同"**）。
//   V4 源码切片变异：把调用点的 `sys.vortexLegacy ? -1 : 1` 翻回去 ⇒ V1/V2 的判定必须翻转。
//
// 用法：node tests/particle-vortex-chirality-test.mjs [--no-mutation] [--verbose]
// 退出码：0 = 全过（含 SKIP）；1 = 有真失败；2 = 用法错误。
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { vortexSwirl, setPointer } from '../core/we-particle-pointer.mjs'
import { ROOT, WS } from './_root.mjs'

const NO_MUTATION = process.argv.includes('--no-mutation')
const VERBOSE = process.argv.includes('--verbose')
const MPW_WS = process.env.MPW_ROOT || WS
const WE = path.join(MPW_WS, 'wallpaper_engine', 'assets')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const SEED = 'pvortex-chirality'

let pass = 0, fail = 0, skip = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')) }
}
const sk = (name, why) => { skip++; console.log('  · SKIP ' + name + '（' + why + '）') }

// ───────────────────────── V1 纯函数 ─────────────────────────────────────────────────────
console.log('vortex 切向手性（取证：docs/VORTEX-CHIRALITY-RE-20260923.md；本仓 ?pvortex=legacy 回退）')
console.log('  ⚠ 本机无 WE 官方反编译/官方方向定义 ⇒ 这是"证据更强的一方"，不是"对齐官方"')
console.log('\n== V1 纯函数：圆心 (0,0)、粒子在 (r,0)、axis=(0,0,1) ==')
{
  const v = { offset: [0, 0, 0], distanceInner: 0, distanceOuter: 1e9, speedInner: 200, speedOuter: 200 }
  const dt = 1 / 60
  const r = 100
  const off = vortexSwirl(r, 0, [0, 0, 0], v, dt)                 // 缺省 = official
  const off1 = vortexSwirl(r, 0, [0, 0, 0], v, dt, 1)             // 显式 +1
  const leg = vortexSwirl(r, 0, [0, 0, 0], v, dt, -1)             // legacy
  const expect = 200 * dt
  ok('V1a official 切向 = `(0, −speed·dt)`（屏幕 y-down 下右侧点向上 = 屏幕顺时针）',
    Math.abs(off[0]) < 1e-12 && Math.abs(off[1] + expect) < 1e-12, `dv=(${off[0]}, ${off[1].toFixed(6)})`)
  ok('V1b 缺省参数 = official（`tangentSign` 不传就是新默认）',
    off[0] === off1[0] && off[1] === off1[1])
  ok('V1c legacy（`?pvortex=legacy`）切向 = `(0, +speed·dt)`（符号严格相反）',
    leg[0] === -off[0] && leg[1] === -off[1], `dv=(${leg[0]}, ${leg[1].toFixed(6)})`)
  // 一般位置：切向必须 ⟂ 半径、且 |dv| = speed·dt
  const q = vortexSwirl(30, 40, [0, 0, 0], v, dt)                 // r = 50
  ok('V1d 一般位置：切向 ⟂ 半径（`t·r = 0`）', Math.abs(q[0] * 30 + q[1] * 40) < 1e-9)
  ok('V1e 一般位置：`|dv| = speed·dt`', Math.abs(Math.hypot(q[0], q[1]) - expect) < 1e-9,
    `|dv|=${Math.hypot(q[0], q[1]).toFixed(6)}`)
  ok('V1f 圆心处（dist < 1e-3）返回 null（上游 `continue`）', vortexSwirl(0, 0, [0, 0, 0], v, dt) === null)
}

// ───────────────────────── 环形/轨迹判据工具 ───────────────────────────────────────────────
/** 绕圆心的**有符号角速度均值**（= 轨迹手性符号）。official ⇒ <0，legacy ⇒ >0。 */
function chirality(sys, ccx, ccy) {
  let num = 0, n = 0, rsum = 0
  for (const p of sys.particles) {
    if (!p.alive) continue
    const rx = p.pos[0] - ccx, ry = p.pos[1] - ccy
    const r2 = rx * rx + ry * ry
    if (r2 < 1e-6) continue
    num += (rx * p.vel[1] - ry * p.vel[0]) / r2
    rsum += Math.hypot(rx, ry)
    n++
  }
  return { L: n ? num / n : 0, n, rmean: n ? rsum / n : 0 }
}
function runDef(def, ctx, steps, ptr, seed) {
  const sys = lib.buildParticleSystem(def, Object.assign({ origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: seed || SEED }, ctx))
  const locked = sys.emitters.some((e) => e.__ptrLocked)
  for (let i = 0; i < steps; i++) {
    if (locked && ptr) { setPointer(sys, ptr[0], ptr[1]); sys.pointer = ptr }
    lib.simulateParticleSystem(sys, (i + 1) / 30, 80)
  }
  return { sys, locked }
}

// ───────────────────────── V2 端到端（官方元素预览场景的 vortex def）────────────────────────
console.log('\n== V2 端到端：官方元素预览场景的 `vortex` def（该层涡旋是主导力）==')
const OFFICIAL_VORTEX_DEF = path.join(WE, 'scenes', 'particleelementpreviews', 'vortex', 'particles', 'new_particle_system.json')
let officialDef = null
try { officialDef = JSON.parse(fs.readFileSync(OFFICIAL_VORTEX_DEF, 'utf8')) } catch (e) { officialDef = null }
let v2off = null, v2leg = null
if (!officialDef) {
  sk('V2', '缺官方资产 ' + OFFICIAL_VORTEX_DEF)
} else {
  const steps = 90
  v2off = chirality(runDef(officialDef, {}, steps).sys, 0, 0)
  v2leg = chirality(runDef(officialDef, { vortexLegacy: true }, steps).sys, 0, 0)
  console.log(`    · 读数（${steps} 步 @30fps，种子 ${SEED}）：official L=${v2off.L.toFixed(4)}（n=${v2off.n}, r̄=${v2off.rmean.toFixed(1)}）`
    + ` / legacy L=${v2leg.L.toFixed(4)}（n=${v2leg.n}, r̄=${v2leg.rmean.toFixed(1)}）`)
  ok('V2a official 的轨迹手性符号为负（`(dy,−dx)` 驱动顺时针/负环量）', v2off.L < -0.1, 'L=' + v2off.L.toFixed(4))
  ok('V2b legacy 的轨迹手性符号为正', v2leg.L > 0.1, 'L=' + v2leg.L.toFixed(4))
  ok('V2c 两档只差符号（同一 RNG 流、同一初值 ⇒ 说明唯一的差别就是切向手性）',
    Math.abs(v2off.L + v2leg.L) < 1e-9 && v2off.n === v2leg.n, `|Δ|=${Math.abs(v2off.L + v2leg.L).toExponential(2)}`)
  // 顺带：官方 def 的 sphererandom distance 250..500 在 2D 面积均匀下 r̄ ≈ 389（E[r]=(2/3)(r₂³−r₁³)/(r₂²−r₁²)）；
  // 实测略大是因为切向加速不做向心约束 ⇒ 粒子边转边向外漂。只断言"落在发射行程内"。
  ok('V2d 顺带核对 sphererandom 2D 半径落在官方 def 的行程 250..500 内（面积均匀，略向外漂）',
    v2off.rmean > 350 && v2off.rmean < 500, 'r̄=' + v2off.rmean.toFixed(1) + '（理论 E[r]≈389）')
}

// ───────────────────────── V3 语料读数（离线几何判据）──────────────────────────────────────
console.log('\n== V3 语料读数（真包 vortex 层；两档都跑，读数原样留档）==')
// 只读包目录表 + seek 单条 json 入口（内存安全：不整包读入）
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
const ROOTS = ['dd', '0917', 'wallpaperE', 'wallpapertest1']
const hits = []
for (const R of ROOTS) {
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
        const ops = ((j && j.operator) || []).filter((o) => o && o.name === 'vortex')
        if (!ops.length) continue
        hits.push({ root: R, id: sub, entry: e.name, def: j, op: ops[0] })
      }
    } finally { fs.closeSync(t.fd) }
  }
}
if (!hits.length) {
  sk('V3', '语料里没有带 `vortex` 的粒子资产（`' + path.join(MPW_WS, 'allwallpaper') + '`）')
} else {
  const V3 = []
  for (const h of hits) {
    const cpIdx = h.op.controlpoint != null ? h.op.controlpoint : 0
    const cp = (h.def.controlpoint || [])[cpIdx] || { offset: '0 0 0' }
    const [ox, oy] = String(cp.offset || '0 0 0').trim().split(/\s+/).map(Number)
    const ccx = ox, ccy = -oy
    const ptr = [500, 400]
    const seed = `${h.root}/${h.id}|${h.entry}`
    const o = chirality(runDef(h.def, {}, 90, ptr, seed).sys, ccx, ccy)
    const l = chirality(runDef(h.def, { vortexLegacy: true }, 90, ptr, seed).sys, ccx, ccy)
    V3.push({ ...h, o, l })
    console.log(`    · ${h.root}/${h.id} :: ${path.basename(h.entry)}  ${JSON.stringify(h.op)}`)
    console.log(`        official L=${o.L.toFixed(4)} (n=${o.n})  /  legacy L=${l.L.toFixed(4)} (n=${l.n})`
      + (o.n === 0 ? '  ⇒ 0 颗粒子（判据无信息量）' : ''))
  }
  ok('V3a 语料 vortex 命中数与 triage 记录一致（5 处算子；`dd` **3** 个包 / `0917` 2 个）',
    V3.length === 5 && V3.filter((x) => x.root === 'dd').length === 3,
    `${V3.length} 处 / dd ${V3.filter((x) => x.root === 'dd').length} 处`)
  const clean = V3.filter((x) => x.o.n > 0 && x.l.n > 0)
  const flipped = clean.filter((x) => x.o.L * x.l.L < 0)
  console.log(`    · 分得清方向的：${flipped.length}/${clean.length}（其余被该层的主导力盖住 —— 见文件头读数表）`)
  ok('V3b `dd/3544152633`（Stars_copy1）两档符号干净相反（判据在该层有分辨力）',
    (() => { const x = V3.find((y) => y.id === '3544152633'); return !!x && x.o.L * x.l.L < 0 })(),
    (() => { const x = V3.find((y) => y.id === '3544152633'); return x ? `off=${x.o.L.toFixed(4)} leg=${x.l.L.toFixed(4)}` : '缺失' })())
  ok('V3c 每个有粒子的语料层：两档**读数必须不同**（手性确实接线了，不是死开关）',
    clean.every((x) => x.o.L !== x.l.L || x.o.n === 0), `${clean.length} 层`)
  ok('V3d 官方 `magic_vortex_orb` **不在任何 .pkg 里**（它用的算子是 `vortex_v2`，见文件头）',
    !V3.some((x) => /magic_vortex_orb/i.test(x.entry)),
    '语料里 0 处（本仓 core/ 与 demo/assets/*.js 的 `vortex_v2` 也 0 命中）')
  if (VERBOSE) for (const x of V3) console.log(`      verbose ${x.id}: |ΔL|=${Math.abs(x.o.L - x.l.L).toExponential(2)}`)
}

// ───────────────────────── V4 源码切片变异（改回去必红）────────────────────────────────────
console.log('\n== V4 改回去必红：把调用点的档位切片翻回旧手性 ==')
if (NO_MUTATION) {
  console.log('  · --no-mutation ⇒ 跳过')
} else {
  const src = fs.readFileSync(BUNDLE, 'utf8')
  ok('V4a 调用点在位（`vortexSwirl(…)` 的第 6 参读 `sys.vortexLegacy`）',
    /vortexSwirl\(p\.pos\[0\], p\.pos\[1\], \[ccx, ccy, 0\],\s*\n?[\s\S]{0,400}?sys\.vortexLegacy \? -1 : 1\)/.test(src))
  ok('V4b 档位常量默认 official（`?pvortex=legacy` 才回退）',
    /get\('pvortex'\) === 'legacy' \? 'legacy' : 'official'/.test(src))
  const mutated = src.replace('sys.vortexLegacy ? -1 : 1)', 'sys.vortexLegacy ? 1 : -1)')
  ok('V4c 变异生效（调用点符号被翻转 = 回到旧默认）', mutated !== src)
  const tmp = path.join(ROOT, 'core', '.pvortex-mut-' + process.pid + '.mjs')
  try {
    fs.writeFileSync(tmp, mutated)
    const m = await import('file://' + tmp)
    if (officialDef) {
      const sys = m.buildParticleSystem(officialDef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: SEED })
      for (let i = 0; i < 90; i++) m.simulateParticleSystem(sys, (i + 1) / 30, 80)
      const c = chirality(sys, 0, 0)
      ok('V4d RED：变异后的默认手性把 L 变正 ⇒ V2a 会变红', c.L > 0.1, 'L=' + c.L.toFixed(4))
    } else sk('V4d', '缺官方资产')
  } finally { fs.rmSync(tmp, { force: true }) }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败' + (skip ? ', ' + skip + ' SKIP' : ''))
if (fail === 0) console.log('✓ vortex 手性判据通过：默认 `(dy,−dx)` / `?pvortex=legacy` 回退 / 端到端轨迹符号可分辨 / 语料读数已留档')
process.exit(fail > 0 ? 1 : 0)

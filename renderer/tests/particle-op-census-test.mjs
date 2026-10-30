// particle-op-census-test.mjs —— ①(WEBWALLGL-ELYSIA 2026-09-23) 粒子算子普查：
//   `vortex_v2` / `maintaindistancetocontrolpoint` 两个**官方算子**的补齐 + "未知算子如实出声"门禁。
//
// ── 为什么需要（缺口与取证）──────────────────────────────────────────────────────────────
//   官方 `wallpaper_engine/assets/scenes/particleelementpreviews/**`（每个算子一个目录，**官方一产物**）
//   共 **25** 个算子名；本渲染器 `applyOperator` 的 `switch` 只有 12 个 `case` 且**没有 `default:`**
//   ⇒ 官方 `magic_vortex_orb.json` 用的 `vortex_v2`（本仓 `grep` 0 命中）吃到时**静默少一个力**
//   （画面不对、且日志/台账里一个字都没有）。本档把四件事钉住：
//     A **普查**：官方 25 名字表 ↔ `PARTICLE_OP_IMPLEMENTED` ↔ 源码里的 `case` 三向一致；
//     B `vortex_v2`：环形由**参数存在性**触发（不是 flag 位）、三段式速度曲线、手性档位；
//     C `maintaindistancetocontrolpoint`：径向衰减 + 距离回归、`variablestrength` 缺省 = **逐位空操作**；
//     D **未知算子台账**：不静默（零粒子也要记）、不抛错；
//     E 变异自证：把上面每条改回"旧写法" ⇒ 对应断言必须变红。
//
// ── 官方语义的依据强度（**如实声明**）────────────────────────────────────────────────────
//   · 25 名字表 + `vortex_v2` 的存在 + `maintaindistancetocontrolpoint` 是**独立算子**：
//     **官方资产原文（强）**（元素预览场景 + `assets/presets/magic/particles/presets/magic_vortex_orb.json`）。
//   · 环形触发口径（参数存在性，不是 `flags&4`）：官方两张夹具**互证** —— `magic_vortex_orb` 是
//     `flags:2` + 带 ring 三件套；`vortex_v2/new_particle_system.json` 是 `flags:3` + **无** ring 字段。
//     若按 `references/lwe-ref` 的 `flags&4` 口径，`flags:2` 的官方 orb **不进环形**（与它自己的
//     字段命名矛盾）⇒ lwe-ref 的 flags 解码判为**偏离**（取证：`docs/VORTEX-CHIRALITY-RE-20260923.md`
//     §5-#10/#11/#12）。
//   · 三段式速度曲线（hollow / 环带线性 / 环外 pull 带宽）：`references/lwe-ref .../CParticle.cpp:1378-1432`
//     的 ring 分支（**第三方参考实现，未反汇编官方二进制**）。
//   · `maintaindistancetocontrolpoint` 的**力模型本是推断**（lwe-ref / wer-ref / 上游 oneincase
//     三处都**没有**它的实现）⇒ 本档只钉"可辩护的性质"（径向衰减、距离守常、强度缺省 = 空操作、
//     官方字段名被消费），**不**钉任何"与官方逐位一致"的说法。
//
// 口径：零依赖、不启浏览器、不连网络（WE 资产缺失 ⇒ A1 小节 SKIP，字面量名字表仍参与其余断言）。
// 用法: node tests/particle-op-census-test.mjs [--no-mutation] [--verbose]
// 退出码：0 全绿（含 SKIP）/ 1 有断言失败 / 2 用法错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
if (argv.some((a) => !['--no-mutation', '--verbose', '--help'].includes(a))) { console.error('未知参数（用法见文件头）'); process.exit(2) }
if (argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 30).join('\n')); process.exit(0) }
const NO_MUT = argv.includes('--no-mutation')
const VERBOSE = argv.includes('--verbose')

// 模块级 location 在 import 时求值（档位常量）⇒ 先钉成空查询，保证测的是**缺省档**
globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')

let passN = 0, failN = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const V = (o) => JSON.stringify(o)

// ── 官方资产根（缺 ⇒ A1 SKIP）─────────────────────────────────────────────────────────
const WE = process.env.MPW_WE_ROOT || path.join(WS, 'wallpaper_engine', 'assets')
const PREVIEWS = path.join(WE, 'scenes', 'particleelementpreviews')
/** 官方 25 个算子名（**字面量副本**：资产缺失时仍能查"实现的 ⊂ 官方的"这条不变量；
    来源 = 逐个读 `assets/scenes/particleelementpreviews/<算子>/particles/<文件>.json` 的 `operator[].name`）。 */
const OFFICIAL_OPS = ['alphachange', 'alphafade', 'angularmovement', 'boids', 'capvelocity',
  'collisionbounds', 'collisionmodel', 'collisionplane', 'collisionquad', 'collisionsphere',
  'colorchange', 'controlpointattract', 'inheritvaluefromevent',
  'maintaindistancebetweencontrolpoints', 'maintaindistancetocontrolpoint', 'movement',
  'oscillatealpha', 'oscillateposition', 'oscillatesize', 'reducemovementnearcontrolpoint',
  'remapvalue', 'sizechange', 'turbulence', 'vortex', 'vortex_v2']

const SRC_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const SRC = fs.readFileSync(SRC_FILE, 'utf8')
/** 源码里真的写了 `case '<name>':` 的名字集合（**只看 applyOperator 那一段**，避免撞上别处的 case）。 */
const CASE_NAMES = (() => {
  const a = SRC.indexOf('export function applyOperator(')
  const b = SRC.indexOf('// ===== src/render/hlsl2glsl.js =====')
  const seg = (a >= 0 && b > a) ? SRC.slice(a, b) : SRC
  const set = new Set()
  const re = /case '([a-z0-9_]+)':/g
  let m
  while ((m = re.exec(seg)) !== null) set.add(m[1])
  return set
})()

// ═════════════════════════ A 普查（官方 25 ↔ 实现表 ↔ 源码 case）═════════════════════════
console.log('[A] 官方算子普查（三向一致）')
{
  const files = []
  if (fs.existsSync(PREVIEWS)) {
    for (const d of fs.readdirSync(PREVIEWS)) {
      const p = path.join(PREVIEWS, d, 'particles')
      if (!fs.existsSync(p)) continue
      for (const f of fs.readdirSync(p)) files.push(path.join(p, f))
    }
  }
  if (!files.length) console.log('  SKIP A1 无官方元素预览场景（' + PREVIEWS + '）—— 字面量名字表仍参与其余断言')
  else {
    const live = new Set()
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'))
        for (const o of (j.operator || [])) if (o && o.name) live.add(String(o.name))
      } catch (e) { /* 单个夹具坏不影响其余 */ }
    }
    ok('A1 官方元素预览场景实测算子名 == 本档字面量副本（' + OFFICIAL_OPS.length + ' 个）',
      live.size === OFFICIAL_OPS.length && [...live].every((n) => OFFICIAL_OPS.includes(n)),
      'live=' + live.size + ' 只在字面量=' + V(OFFICIAL_OPS.filter((n) => !live.has(n))) +
      ' 只在资产=' + V([...live].filter((n) => !OFFICIAL_OPS.includes(n))))
  }
  const IMPL = lib.PARTICLE_OP_IMPLEMENTED
  const NOT_IMPL = lib.PARTICLE_OP_UNIMPLEMENTED_OFFICIAL
  ok('A2 实现表里的每个名字在源码里都有真的 `case`（表/实现不许漂移）',
    [...IMPL].every((n) => CASE_NAMES.has(n)),
    '表中无 case 的：' + V([...IMPL].filter((n) => !CASE_NAMES.has(n))))
  ok('A3 未实现清单里的名字**一个都不许**有 `case`（清单必须如实）',
    NOT_IMPL.every((n) => !CASE_NAMES.has(n)),
    '清单里其实已实现却仍列在未实现：' + V(NOT_IMPL.filter((n) => CASE_NAMES.has(n))))
  ok('A4 实现表 ∩ 未实现清单 = ∅', [...IMPL].every((n) => !NOT_IMPL.includes(n)))
  ok('A5 实现表 ∪ 未实现清单 == 官方 25 名字表（不多不少）',
    [...IMPL, ...NOT_IMPL].length === OFFICIAL_OPS.length &&
    [...new Set([...IMPL, ...NOT_IMPL])].sort().join(',') === OFFICIAL_OPS.slice().sort().join(','),
    '并集=' + [...new Set([...IMPL, ...NOT_IMPL])].length + ' vs 官方=' + OFFICIAL_OPS.length +
    '；缺=' + V(OFFICIAL_OPS.filter((n) => !IMPL.has(n) && !NOT_IMPL.includes(n))) +
    '；多=' + V([...IMPL, ...NOT_IMPL].filter((n) => !OFFICIAL_OPS.includes(n))))
  ok('A6 本批补齐的两个算子确实在实现表里（`vortex_v2` / `maintaindistancetocontrolpoint`）',
    IMPL.has('vortex_v2') && IMPL.has('maintaindistancetocontrolpoint'))
  ok('A7 `switch` 有 `default:` 分支且走同一个记账口（改前没有 default = 静默忽略）',
    /default: \{\s*\n\s*noteUnknownParticleOp\(sys, op\.name\)/.test(SRC))
}

// ═════════════════════════ 夹具（官方原文的**字面量副本**）════════════════════════════════
// 来源：`assets/presets/magic/particles/presets/magic_vortex_orb.json` 的 operator[2]（逐字）
const ORB_VORTEX = { controlpoint: 1, distanceinner: 0, distanceouter: 1, flags: 2, id: 9,
  name: 'vortex_v2', ringpulldistance: 250, ringradius: 256, ringwidth: 5, speedinner: 0, speedouter: 2500 }
// 来源：`assets/scenes/particleelementpreviews/vortex_v2/particles/new_particle_system.json` 的 operator[2]（逐字）
const PREVIEW_VORTEX_V2 = { flags: 3, id: 11, name: 'vortex_v2' }
// 来源：`assets/presets/magic/.../magic_vortex_orb.json` 的 operator[3]（逐字）
const ORB_MDCP = { id: 12, name: 'maintaindistancetocontrolpoint', variablestrength: 5 }
// 来源：`assets/scenes/particleelementpreviews/maintaindistancetocontrolpoint/particles/new_particle_system.json` 的 operator[2]（逐字）
const PREVIEW_MDCP = { id: 9, name: 'maintaindistancetocontrolpoint', variablestrength: 5 }

const mkP = (x, y) => ({ pos: [x, y, 0], vel: [0, 0, 0], age: 0, life: 5, scenePos: null,
  color: [1, 1, 1], size: 10 })
/** 建一个最小系统（官方 magic_vortex_orb 的 controlpoint 形态：cp0 无 flag、cp1/2 有）。 */
function mkSys(mm, ops, pts, o = {}) {
  const sys = mm.buildParticleSystem({ maxcount: 64, operator: [], emitter: [], initializer: [] }, {})
  sys.controlPoints = [{ id: 0 }, { flags: 16, id: 1 }, { flags: 1, id: 2 }]
  sys.pointerCp = -1
  sys.origin = [0, 0, 0]
  if (o.vortexLegacy) sys.vortexLegacy = true
  sys.operators = mm.parseParticleOperators(ops)
  sys.particles = pts
  return sys
}
/** 跑一个算子一帧（dt=1/60），返回 {p, sys}。 */
const runOp = (opJson, x, y, o = {}) => {
  const p = mkP(x, y)
  if (o.vel) p.vel = o.vel.slice()
  const sys = mkSys(lib, [opJson], [p], o.sys || {})
  lib.applyOperator(sys, sys.operators[0], o.dt === undefined ? 1 / 60 : o.dt, 0)
  return { p, sys }
}

// ═════════════════════════ B `vortex_v2` ════════════════════════════════════════════════
console.log('[B] vortex_v2（官方 magic_vortex_orb / 元素预览两张夹具）')
{
  ok('B0 官方夹具可解析（`parseParticleOperators` 不改名、不丢字段）',
    lib.parseParticleOperators([ORB_VORTEX])[0].name === 'vortex_v2' &&
    lib.parseParticleOperators([ORB_VORTEX])[0].params.ringradius === 256)
  // 三段式曲线（rIn = 256−2.5 = 253.5、rOut = 258.5、pull 带宽 = 250 ⇒ 508.5）
  const vAt = (r, o = {}) => runOp(ORB_VORTEX, r, 0, o).p.vel
  const vHollow = vAt(240), vIn = vAt(256), vOut = vAt(258.5), vPull = vAt(300), vFar = vAt(600)
  const speed = (v) => Math.hypot(v[0], v[1]) * 60      // dv/dt ⇒ px/s²
  ok('B1 环形空心区（r < ringradius−ringwidth/2 = 253.5）**不受切向力**（官方 ring 语义：hollow center 不旋转）',
    vHollow[0] === 0 && vHollow[1] === 0, V(vHollow))
  ok('B2 环带内速度 = lerp(speedinner, speedouter, (r−rIn)/width)：r=256 ⇒ 1250px/s² ⇒ dv=20.833',
    Math.abs(speed(vIn) - 1250) < 1e-9, 'speed=' + speed(vIn).toFixed(6))
  ok('B3 环外沿 r=rOut ⇒ speedouter = 2500px/s²（dv = 41.667）',
    Math.abs(speed(vOut) - 2500) < 1e-9, 'speed=' + speed(vOut).toFixed(6))
  ok('B4 环外 pull 带宽内按 (1−pullT) 线性衰减：r=300 ⇒ 2500×(1−41.5/250) = 2085px/s²',
    Math.abs(speed(vPull) - 2085) < 1e-9, 'speed=' + speed(vPull).toFixed(6))
  ok('B5 超出 rOut+ringpulldistance（508.5）**完全无力**',
    vFar[0] === 0 && vFar[1] === 0, V(vFar))
  // ★ 环形由**参数存在性**触发，不是 flag 位：官方预览那张 flags:3 且无 ring 字段 ⇒ 普通涡旋
  const plain = runOp(PREVIEW_VORTEX_V2, 256, 0).p.vel
  ok('B6 ★环形触发 = **参数存在性**：官方 `vortex_v2` 夹具 `flags:3` + **无** ring 字段 ⇒ 走普通涡旋（非零）',
    Math.hypot(plain[0], plain[1]) > 0.01, 'vel=' + V(plain) + '（`flags` 的 bit0/bit1 都置位却仍不是环形）')
  // 只去掉 ringpulldistance（保留 flags:2）⇒ 仍不是环形 ⇒ 三个参数缺一不可
  const partial = runOp({ ...ORB_VORTEX, ringpulldistance: undefined }, 240, 0).p.vel
  ok('B7 ★三件套缺一不可：只缺 `ringpulldistance`（`flags:2` 不变）⇒ 回到普通涡旋（240 处非零）',
    Math.hypot(partial[0], partial[1]) > 0.01, 'vel=' + V(partial))
  // 手性：`?pvortex=legacy` 翻符号（环带内）
  const leg = runOp(ORB_VORTEX, 256, 0, { sys: { vortexLegacy: true } }).p.vel
  ok('B8 手性档位对 ring 档同样生效：`sys.vortexLegacy` ⇒ 切向逐位取反',
    Math.abs(vIn[0] + leg[0]) < 1e-15 && Math.abs(vIn[1] + leg[1]) < 1e-15 && vIn[1] !== 0,
    'official=' + V(vIn) + ' legacy=' + V(leg))
  // 老名字 `vortex` 逐位不变（给 `vortex` 也塞 ring 字段 ⇒ 仍走普通档）
  const legacyName = runOp({ ...ORB_VORTEX, name: 'vortex' }, 240, 0).p.vel
  const std240 = runOp({ name: 'vortex', distanceinner: 0, distanceouter: 1, speedinner: 0, speedouter: 2500 }, 240, 0).p.vel
  ok('B9 老名字 `vortex` **逐位不变**：即使塞进 ring 字段也走普通档（`__isV2` 门控）',
    legacyName[0] === std240[0] && legacyName[1] === std240[1], V(legacyName) + ' vs ' + V(std240))
  ok('B10 反向自证：`vortex_v2` 在**同一位置**确实拿到了力（否则 B9 的"逐位相同"可能只是两边都恒 0）',
    Math.hypot(plain[0], plain[1]) > 0 && Math.hypot(std240[0], std240[1]) > 0)
}

// ═════════════════════════ C `maintaindistancetocontrolpoint` ═══════════════════════════
console.log('[C] maintaindistancetocontrolpoint（官方独立算子；力模型 = 推断，见文件头强度声明）')
{
  // C1 径向速度被衰减、切向速度不动
  const away = runOp(ORB_MDCP, 300, 0, { vel: [60, 40, 0] })
  ok('C1 径向分量被衰减、切向分量**逐位不动**（`variablestrength=5`, dt=1/60 ⇒ k=1/12）',
    Math.abs(away.p.vel[0] - 60 * (1 - 5 / 60)) < 1e-12 && away.p.vel[1] === 40,
    'vel=' + V(away.p.vel) + ' 期望 x=' + (60 * (1 - 5 / 60)))
  // C2 缺字段 ⇒ 逐位空操作（= 与"没有这个算子"完全一致：算子在场但强度 0）
  const withOp = runOp({ id: 9, name: 'maintaindistancetocontrolpoint' }, 300, 0, { vel: [60, 40, 0] })
  const strength0 = runOp({ id: 9, name: 'maintaindistancetocontrolpoint', variablestrength: 0 }, 300, 0, { vel: [60, 40, 0] })
  ok('C2 `variablestrength` 缺省 = **逐位空操作**（保守口径：不许发明一个会改画面的缺省力）',
    withOp.p.vel[0] === 60 && withOp.p.vel[1] === 40 &&
    withOp.p.vel[0] === strength0.p.vel[0] && withOp.p.vel[1] === strength0.p.vel[1],
    'vel=' + V(withOp.p.vel) + '（显式 0 时 ' + V(strength0.p.vel) + '）')
  // C3 距离守常：连续 60 步后 |d − refDist| 明显小于"无算子"的对照
  //   算子序列照**官方夹具的顺序**（`movement` 在前 ⇒ 先把速度积进位置，再由本算子压回距离）
  const drift = (useOp) => {
    const p = mkP(300, 0); p.vel = [120, 0, 0]
    const sys = mkSys(lib, [{ name: 'movement' }, ...(useOp ? [ORB_MDCP] : [])], [p])
    for (let i = 0; i < 60; i++) lib.stepParticles(sys, 1 / 60, i / 60)
    return Math.abs(Math.hypot(p.pos[0], p.pos[1]) - 300)
  }
  const dOn = drift(true), dOff = drift(false)
  ok('C3 距离守常：60 步后 |d−300| 在有算子时**小于**无算子对照的 1/3（径向速度被持续压掉）',
    dOff > 1 && dOn < dOff / 3, 'with=' + dOn.toFixed(3) + 'px  without=' + dOff.toFixed(3) + 'px')
  // C4 官方元素预览夹具同参数形态（无 controlpoint ⇒ cp0）
  const pv = runOp(PREVIEW_MDCP, 300, 0, { vel: [60, 0, 0] })
  ok('C4 官方元素预览夹具（`{id:9,name, variablestrength:5}`，**无** controlpoint ⇒ cp0）同样生效',
    Math.abs(pv.p.vel[0] - 60 * (1 - 5 / 60)) < 1e-12, 'vel=' + V(pv.p.vel))
}

// ═════════════════════════ D 未知算子台账（不许静默）═════════════════════════════════════
console.log('[D] 未知/未实现算子：如实记账（改前 `switch` 无 default ⇒ 静默）')
{
  const u = runOp({ id: 3, name: 'boids' }, 10, 0)
  ok('D1 `boids`（官方但未实现）被记进台账、且**不抛错**',
    !!u.sys.unknownOps && u.sys.unknownOps.boids === 1 && u.sys.unknownOpNames.indexOf('boids') === 0,
    V(u.sys.unknownOps))
  const z = mkSys(lib, [{ name: 'capvelocity' }], [])
  lib.applyOperator(z, z.operators[0], 1 / 60, 0)
  ok('D2 **零粒子也要记**（记账在粒子循环之前 ⇒ "这一层只有一个没实现的力"不会看不见）',
    z.unknownOps.capvelocity === 1, V(z.unknownOps))
  const all = mkSys(lib, lib.PARTICLE_OP_UNIMPLEMENTED_OFFICIAL.map((n) => ({ name: n })), [mkP(0, 0)])
  for (const op of all.operators) lib.applyOperator(all, op, 1 / 60, 0)
  ok('D3 官方未实现的 ' + lib.PARTICLE_OP_UNIMPLEMENTED_OFFICIAL.length + ' 个名字逐个都记上、去重名字表长度相同',
    all.unknownOpNames.length === lib.PARTICLE_OP_UNIMPLEMENTED_OFFICIAL.length &&
    lib.PARTICLE_OP_UNIMPLEMENTED_OFFICIAL.every((n) => all.unknownOps[n] === 1),
    'names=' + all.unknownOpNames.length + ' hits=' + all.unknownOpHits)
  ok('D4 补齐后**官方两张 vortex_v2 夹具 + 两张 maintaindistance 夹具都不进未知台账**',
    runOp(ORB_VORTEX, 256, 0).sys.unknownOpHits === 0 &&
    runOp(PREVIEW_VORTEX_V2, 256, 0).sys.unknownOpHits === 0 &&
    runOp(ORB_MDCP, 300, 0, { vel: [1, 0, 0] }).sys.unknownOpHits === 0 &&
    runOp(PREVIEW_MDCP, 300, 0, { vel: [1, 0, 0] }).sys.unknownOpHits === 0)
}

// ═════════════════════════ E 变异自证（RED-IF-REVERTED）══════════════════════════════════
if (NO_MUT) console.log('[E] SKIP（--no-mutation）')
else {
  console.log('[E] RED-IF-REVERTED：把真源码逐条改回旧写法（副本落 /tmp，真树只读）')
  const CORE = path.dirname(SRC_FILE)
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  /** 每个变异体：`pairs` = 字面替换；`probe(mm)` = 在**变异体**上重跑本档的关键量，返回 {red, detail}。 */
  const mutants = [
    {
      label: 'M1(未知算子回到静默：预检 + default 一起拿掉)',
      pairs: [
        ['  if (!PARTICLE_OP_IMPLEMENTED.has(String(op.name))) {\n    noteUnknownParticleOp(sys, op.name)\n    return\n  }',
          '  if (false) {\n    noteUnknownParticleOp(sys, op.name)\n    return\n  }'],
        ['      default: {\n        noteUnknownParticleOp(sys, op.name)\n        break\n      }', '      default: { break }'],
      ],
      probe: (mm) => {
        const p = mkP(10, 0)
        const sys = mkSys(mm, [{ name: 'boids' }], [p])
        mm.applyOperator(sys, sys.operators[0], 1 / 60, 0)
        const n = (sys.unknownOpNames || []).length
        return { red: n === 0, detail: '变异体里 `boids` 记账条数=' + n + '（0 = 已回到静默，D1/D2/D3 会红）' }
      },
    },
    {
      label: 'M2(环形改回 flag 位：lwe-ref 的 `flags&4` 口径)',
      pairs: [['        const __ringOn = __isV2 && __ringR > 0 && __ringW > 0 && __ringP > 0',
        "        const __ringOn = __isV2 && (Number(pGetVal(pr, 'flags', 0)) & 4) !== 0"]],
      probe: (mm) => {
        const p = mkP(240, 0)
        const sys = mkSys(mm, [ORB_VORTEX], [p])
        mm.applyOperator(sys, sys.operators[0], 1 / 60, 0)
        const nz = p.vel[0] !== 0 || p.vel[1] !== 0
        return { red: nz, detail: '变异体里 `flags:2` 的官方 orb 在 r=240 拿到 vel=' +
          V([+p.vel[0].toFixed(4), +p.vel[1].toFixed(4)]) + '（非零 = 不再按参数存在性触发环形 ⇒ B1/B2 会红）' }
      },
    },
    {
      label: 'M3(maintaindistance 缺省强度改成 5 ⇒ 缺字段也施力)',
      pairs: [["        const strength = Number(pGetVal(pr, 'variablestrength', 0)) || 0",
        "        const strength = Number(pGetVal(pr, 'variablestrength', 5)) || 5"]],
      probe: (mm) => {
        const p = mkP(300, 0); p.vel = [60, 0, 0]
        const sys = mkSys(mm, [{ id: 9, name: 'maintaindistancetocontrolpoint' }], [p])
        mm.applyOperator(sys, sys.operators[0], 1 / 60, 0)
        return { red: p.vel[0] !== 60, detail: '变异体里缺字段仍施力 ⇒ vx=' + p.vel[0].toFixed(4) + '（真值 60）' }
      },
    },
  ]
  for (const mu of mutants) {
    let body = SRC, missing = null
    for (const [from, to] of mu.pairs) {
      if (!body.includes(from)) { missing = from; break }
      body = body.replace(from, to)
    }
    if (missing) { failN++; console.log('  ✗ ' + mu.label + ' 变异锚点不在源码里：' + V(missing.slice(0, 60))); continue }
    const tmp = path.join(os.tmpdir(), 'opcensus-mut-' + mu.label.replace(/[^A-Za-z0-9]/g, '') + '.mjs')
    fs.rmSync(tmp, { force: true })
    fs.writeFileSync(tmp, body.replace(/from '\.\//g, `from '${CORE}/`))
    let red = false, detail = ''
    try {
      const mm = await import('file://' + tmp + '?v=' + Date.now() + Math.random())
      const r = mu.probe(mm)
      red = !!r.red; detail = r.detail
    } catch (e) { detail = '变异体抛错：' + String(e && e.message).slice(0, 140) }
    finally { fs.rmSync(tmp, { force: true }) }
    console.log('  ' + (red ? 'RED' : 'RED-MISS') + '｜' + mu.label + '：' + detail)
    if (red) { passN++; console.log('  ✓ E ' + mu.label + ' ⇒ 对应断言变红（RED-IF-REVERTED）') }
    else { failN++; console.log('  ✗ E ' + mu.label + ' ⇒ 断言没红') }
  }
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^opcensus-mut-.*\.mjs$/.test(f))
  const same = shaOf(SRC_FILE) === srcSha && leftovers.length === 0
  if (same) { passN++; console.log('  ✓ E 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（副本落 /tmp 且已 unlink）') }
  else { failN++; console.log('  ✗ E 真树被改动或 /tmp 有残留：sha=' + (shaOf(SRC_FILE) === srcSha) + ' 残留=' + leftovers.length) }
}

if (VERBOSE) console.log('  实现表=' + V([...lib.PARTICLE_OP_IMPLEMENTED]) + '\n  未实现=' + V(lib.PARTICLE_OP_UNIMPLEMENTED_OFFICIAL))
console.log('\n===== particle-op-census: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

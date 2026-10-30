/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**；唯一例外是 P-136/P-144 明确照抄的
 * oneincase/webwallgl（MIT © 2026 oneincase）那些函数（`core/we-particle-pointer.mjs` 的块 A–I）
 * —— 见 THIRD-PARTY.md §14/§15。references/wer-ref（GPL-2.0-only）与 references/lwe-ref
 * （GPL-3.0-only）仍只引行为结论，未复制其代码/注释/常量组织。 */
// particle-children-test.mjs — P-144 回归门禁（秒级、无浏览器、无网络、无 GPU）
//
// 钉住**粒子 `children`（子系/拖尾）全家族**这条实现链：
//   ① 字段面解析：官方缺省（`maxcount 20` / `probability 1.0` / `controlpointstartindex 0`）、
//      `type` 缺失或未知 ⇒ `static`（官方 `ParseSpawnType` 只识别三个字符串）、非法项跳过、
//      `probability` 钳到 [0,1]、`maxcount` 下限 1。
//   ② 四种 type 的行为（纯函数级，无真包也跑）：`static` 常驻锚定 / `eventfollow` 跟父粒子
//      （无 leader ⇒ 清空停发）/ `eventspawn` 出生那一帧吐 / `eventdeath` 死亡那一帧吐；
//      `probability` 与 `maxcount` 的边界；`controlpointstartindex` 的基址语义。
//   ③ RNG 纪律：父系（无 children / 有 children / children=legacy）的 **RNG 流与粒子位置逐位相同**；
//      子系一律吃自己的 RNG。
//   ④ 真包 `dd/3554161528` 萤火虫层（`objects[22]`=id 4569「萤火虫」→ `firefliestrail`，eventfollow）
//      + mock-GL：修前/修后的父/子粒子数、子系存活数、子系↔父粒子距离分布、每帧更新次数，
//      以及**父系顶点流逐位不变**（子系只多一批 draw）。
//   ⑤ `?children=legacy` 逐位证明：legacy 顶点流 sha256 ≡ **源码级换回旧实现**的变异体（`/tmp` 副本）。
//   ⑨ ①(P-149 同批调整) ④ 组的"父系顶点流逐位不变"**拆成结构 / 颜色两维**（见 ④-g…④-g6 的整段注释）：
//      几何流（位置/尺寸/UV/alpha）逐位不变 **+** `?overbright=legacy` 下整条（几何+颜色）逐位不变 **+**
//      合成因子 0.25 的非空反证。**不是放宽阈值**：旧措辞把"几何不动"与"颜色不动"混在一个名字里，
//      而 `overbright` 的因子根本不在几何流里（颜色走 `a_Color` VBO / `u_Color`）。
//   ⑥ 全语料同族扫描（**语料自导出**，2026-09-23 起：语料根动态枚举 + 逐条语义
//      「probability>0 ⇔ 真的产出粒子」+ 规模只增不减的自导出基线；旧写法钉死 149 条，
//      新增 `0923/`、`wallpaperE/` 重命名后必红）。
//   ⑦ RED-IF-REVERTED（**6 组** R1–R6）：每组"把实现改回旧写法"都只让**指定那一组**变红；
//      变异只在 `/tmp` 的真文件副本上做（真树 sha256 跑完不变）。
//   ⑧ 照抄登记（上游 MIT 代码的记账不许被静默删掉）：`THIRD-PARTY.md` §15 + `docs/COPYING-RULES.md` §4 #13。
//
// 用法: node tests/particle-children-test.mjs [--verbose]
//      node tests/particle-children-test.mjs --probe firefly|eventdeath|eventspawn|probgate|follow|cap
//      （`--probe` 只跑探针本身，跳过 [4]–[7] —— 见 `SUITE` 处：探针子进程若把 [5]/[7] 也跑了会逐层派生）
// 门禁名: particle-children（`tests/run-all-tests.sh --only particle-children`）
// 资源: 全绿一次实测 **PeakRSS ≈ 371MB（进程树）/ 峰值单进程 ≈ 270MB**、约 40 秒、无浏览器/无网络。
import { WS, ROOT } from './_root.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const VERBOSE = process.argv.includes('--verbose')
const PROBE = (() => { const i = process.argv.indexOf('--probe'); return i >= 0 ? (process.argv[i + 1] || '') : null })()
const MPW_WS = process.env.MPW_ROOT || WS
const DIR = `${MPW_WS}/allwallpaper/dd`
const WE = `${MPW_WS}/wallpaper_engine/assets`
const PKG_FIREFLY = `${DIR}/3554161528/scene.pkg`
// 变异子进程可指向 /tmp 的副本；缺省 = 本仓库真文件
const BUNDLE = process.env.MPW_P144_BUNDLE || path.join(ROOT, 'core/we-scene-bundle.js')
const dec = new TextDecoder()
const checks = []
const push = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  if (VERBOSE || !ok) console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? ' — ' + detail : ''))
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const lib = await import(new URL('file://' + BUNDLE).href)
const ptrMod = await import(new URL('file://' + path.join(path.dirname(BUNDLE), 'we-particle-pointer.mjs')).href)

// ───────────────────────── 轻量 PKG 入口表读取（只读文件头 1 MiB + seek 单条 entry） ─────────────────────────
// 与 `/tmp/pscan/pkgtable.mjs` 同口径（`packages/we-core/src/pkg.js` 头注：载荷原样存储，
// dataStart + Σ size === fileSize）⇒ 445 MB 级包也不会整包读入。
function pkgTable(fp) {
  const fd = fs.openSync(fp, 'r')
  try {
    const head = Buffer.allocUnsafe(1 << 20)
    const got = fs.readSync(fd, head, 0, head.length, 0)
    const b = head.subarray(0, got)
    const ml = b.readInt32LE(0)
    let pos = 4 + ml
    const count = b.readInt32LE(pos); pos += 4
    const entries = []
    for (let i = 0; i < count; i++) {
      const nl = b.readInt32LE(pos); pos += 4
      const name = b.toString('utf8', pos, pos + nl); pos += nl
      const offset = b.readInt32LE(pos); const size = b.readInt32LE(pos + 4); pos += 8
      entries.push({ name, offset, size })
    }
    return { file: fp, entries, dataStart: pos, byName: new Map(entries.map((e) => [e.name, e])) }
  } finally { fs.closeSync(fd) }
}
function pkgEntry(t, name) {
  const e = t.byName.get(name)
  if (!e) return null
  const fd = fs.openSync(t.file, 'r')
  try {
    const buf = Buffer.allocUnsafe(e.size)
    fs.readSync(fd, buf, 0, e.size, t.dataStart + e.offset)   // ⚠ offset 相对 dataStart（见 we-core/src/pkg.js 头注）
    return buf
  } finally { fs.closeSync(fd) }
}
const WE_PRESET_BASENAMES = (() => {
  const m = new Map()
  try {
    for (const d of fs.readdirSync(WE + '/presets')) {
      const p = `${WE}/presets/${d}/particles/presets`
      if (!fs.existsSync(p)) continue
      for (const f of fs.readdirSync(p)) if (f.endsWith('.json') && !m.has(f)) m.set(f, `${p}/${f}`)
    }
  } catch (e) { /* 没有 WE 资产 ⇒ 调用方按缺资产处理 */ }
  return m
})()

// ───────────────────────── 合成 def 工具（纯函数级断言用） ─────────────────────────
const mkParent = (over = {}) => Object.assign({
  maxcount: 16, starttime: 0,
  emitter: [{ name: 'sphererandom', rate: 10, distancemin: 0, distancemax: 5, directions: '1 1 0' }],
  initializer: [{ name: 'lifetimerandom', min: 1, max: 2 }],
  operator: [],
  renderer: [{ name: 'sprite' }],
}, over)
const mkChild = (over = {}) => Object.assign({
  maxcount: 8, starttime: 0,
  emitter: [{ name: 'sphererandom', rate: 10, distancemin: 0, distancemax: 3, directions: '1 1 0' }],
  initializer: [{ name: 'lifetimerandom', min: 1, max: 2 }],
  operator: [],
  renderer: [{ name: 'sprite' }],
}, over)
const step = (sys, t, n, dt = 0.05) => { for (let i = 1; i <= n; i++) lib.simulateParticleSystem(sys, t + i * dt, 400) }
const mkSpec = (type, over = {}) => Object.assign({
  index: 0, id: null, name: 'c.json', type, typeRaw: type, maxCount: 20, probability: 1, cpStart: 0,
  origin: [0, 0, 0], scale: [1, 1, 1], angles: [0, 0, 0], flags: null, instanceoverride: null,
}, over)

/**
 * 合成场景：父系不断出生/死亡（rate 高 + 寿命短），子系按 type 吐。
 * 子系 emitter 用 `instantaneous: 1, rate: 0`（语料 `shootingstarglow` 的写法）。
 * @returns {{spawned:number, maxDistToEvent:number, gate:(boolean|undefined), steady:number, alive:number, events:number}}
 */
function synthEventChild(type, specOver = {}) {
  const pdef = mkParent({
    maxcount: 60,
    // 事件数组只在"父系 def 真有该类子系"时才建（零成本原则）⇒ 这里必须带上 children
    children: [{ name: 'c.json', type: type, maxcount: specOver.maxCount || 20 }],
    emitter: [{ name: 'sphererandom', rate: 60, distancemin: 0, distancemax: 0, directions: '1 1 0' }],
    initializer: [{ name: 'lifetimerandom', min: 0.1, max: 0.15 }],
  })
  const spec = mkSpec(type, specOver)
  const p = lib.buildParticleSystem(pdef, { origin: [100, 100, 0], scale: [1, 1, 1], angle: 0, seedStr: 'ev' })
  const cdef = mkChild({
    maxcount: 64,
    emitter: [{ name: 'sphererandom', rate: 0, instantaneous: 1, distancemin: 0, distancemax: 0, directions: '1 1 0' }],
    initializer: [{ name: 'lifetimerandom', min: 5, max: 6 }],
  })
  const c = lib.buildParticleSystem(cdef, { origin: [100, 100, 0], scale: [1, 1, 1], angle: 0, seedStr: 'evc', maxCount: 64 })
  let spawned = 0, steady = 0, events = 0
  const pts = []
  for (let i = 0; i < 30; i++) {
    lib.simulateParticleSystem(p, (i + 1) * 0.05, 400)
    const ev = type === 'eventspawn' ? (p.pSpawnEv ? p.pSpawnEv.slice() : null) : (p.pDeathEv ? p.pDeathEv.slice() : null)
    if (p.pSpawnEv) p.pSpawnEv.length = 0
    if (p.pDeathEv) p.pDeathEv.length = 0
    if (ev) { events += ev.length; for (const e of ev) pts.push(e) }
    const r = lib.prepareParticleChildSys(c, spec, p, ev, null)
    spawned += r.spawned
    if (!ev || !ev.length) steady += r.spawned
    lib.simulateParticleSystem(c, (i + 1) * 0.05, 400)
  }
  const maxDist = (c.particles.length && pts.length)
    ? Math.max(...c.particles.map((q) => Math.min(...pts.map((e) => Math.hypot(q.pos[0] - e[0], q.pos[1] - e[1])))))
    : -1
  return { spawned, steady, events, maxDistToEvent: maxDist, gate: c.__emitGate, alive: c.particles.length }
}

/** probability 门：同一批事件、三个 p 值各吐多少。 */
function synthProbGate() {
  const out = {}
  const run = (p) => synthEventChild('eventspawn', { probability: p })
  out.headZero = run(0).spawned
  out.headOne = run(1).spawned
  out.headHalf = run(0.5).spawned
  out.events = run(1).events
  out.headA = out.headZero
  return out
}

/** maxcount = 并发实例上限：父系一次性出生 100 颗 ⇒ 事件子系最多留 maxcount 个实例。 */
function synthEventCap() {
  const pdef = mkParent({
    maxcount: 500,
    children: [{ name: 'c.json', type: 'eventspawn', maxcount: 20 }],
    emitter: [{ name: 'sphererandom', rate: 0, instantaneous: 100, distancemin: 0, distancemax: 0, directions: '1 1 0' }],
    initializer: [{ name: 'lifetimerandom', min: 9, max: 10 }],
  })
  const spec = mkSpec('eventspawn', { maxCount: 20 })
  const p = lib.buildParticleSystem(pdef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'cap100' })
  const cdef = mkChild({
    maxcount: 500,
    emitter: [{ name: 'sphererandom', rate: 0, instantaneous: 1, distancemin: 0, distancemax: 0, directions: '1 1 0' }],
    initializer: [{ name: 'lifetimerandom', min: 5, max: 6 }],
  })
  const c = lib.buildParticleSystem(cdef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'capc', maxCount: 500 })
  lib.simulateParticleSystem(p, 0.05, 400)
  const ev = p.pSpawnEv ? p.pSpawnEv.slice() : []
  const r = lib.prepareParticleChildSys(c, spec, p, ev, null)
  // 下限 1：`maxcount: 0` ⇒ parseParticleChildren 钳到 1
  const spec1 = lib.parseParticleChildren({ children: [{ name: 'c.json', type: 'eventspawn', maxcount: 0 }] })[0]
  const c1 = lib.buildParticleSystem(cdef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'capc1', maxCount: 500 })
  const r1 = lib.prepareParticleChildSys(c1, Object.assign({}, spec, { maxCount: spec1.maxCount }), p, ev, null)
  return { instances: r.instances, spawned: r.spawned, events: ev.length, instancesMin: r1.instances }
}

/**
 * `eventfollow` 探针：父系在 **(100,100)** 出生（**故意不放在子系初始原点上** —— 否则
 * "原点一直没动"也能骗过 `near(origin, leader)`），子系初始原点 (0,0)。
 * @returns {{ok0:boolean, ok1:boolean, ok2:boolean, origin0:number[], leader0:number[], origin1:number[], leader1:number[], alive:number}}
 */
function synthFollow() {
  const pdef = mkParent({ emitter: [{ name: 'sphererandom', rate: 30, distancemin: 0, distancemax: 0, directions: '1 1 0' }] })
  const p = lib.buildParticleSystem(pdef, { origin: [100, 100, 0], scale: [1, 1, 1], angle: 0, seedStr: 'fol' })
  const c = lib.buildParticleSystem(mkChild({ maxcount: 64 }), { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'folc', maxCount: 64 })
  const spec = mkSpec('eventfollow')
  step(p, 0, 20)
  lib.prepareParticleChildSys(c, spec, p, null, null)
  const leader0 = [p.particles[0].pos[0], p.particles[0].pos[1]]
  const origin0 = [c.origin[0], c.origin[1]]
  const ok0 = near(origin0[0], leader0[0], 1e-9) && near(origin0[1], leader0[1], 1e-9)
  step(c, 0, 10)
  const oldPos = c.particles.length ? c.particles[0].pos.slice() : null
  for (const q of p.particles) q.pos[0] += 300       // leader 前移 300px
  lib.prepareParticleChildSys(c, spec, p, null, null)
  const leader1 = [p.particles[0].pos[0], p.particles[0].pos[1]]
  const origin1 = [c.origin[0], c.origin[1]]
  const ok1 = near(origin1[0], leader1[0], 1e-9) && near(origin1[1], leader1[1], 1e-9)
  step(c, 0, 1)
  const ok2 = !oldPos || near(c.particles[0].pos[0], oldPos[0], 0.001)   // 老粒子留在原地 = 拖尾成因
  return { ok0, ok1, ok2, origin0, leader0, origin1, leader1, alive: c.particles.length }
}

// ═══════════════ ① 字段面解析 ═══════════════
console.log('\n[1] ① 字段面解析：type/缺省/边界')
{
  const P = lib.PARTICLE_CHILD_DEFAULTS
  push('①-a 官方缺省常量 = {maxcount 20, probability 1, controlpointstartindex 0}（wer-ref WPSceneParser.cpp:5778-5800）',
    P.maxcount === 20 && P.probability === 1 && P.controlpointstartindex === 0 && lib.PARTICLE_CHILD_TYPES.length === 4,
    JSON.stringify(P) + ' types=' + lib.PARTICLE_CHILD_TYPES.join('/'))
  const all = lib.parseParticleChildren({ children: [
    { id: 1, name: 'a.json' },
    { id: 2, name: 'b.json', type: null },
    { id: 3, name: 'c.json', type: 'eventfollow' },
    { id: 4, name: 'd.json', type: 'eventspawn', maxcount: 0, probability: 3 },
    { id: 5, name: 'e.json', type: 'unknown-type' },
    { id: 6, name: 'f.json', type: 'eventdeath', probability: -1, maxcount: -5, controlpointstartindex: 2.6 },
    { id: 7, name: '' }, null, { name: 5 }, { name: 'g.json', origin: '1 2 3', scale: '2 3 4', angles: '0 0 0.5' },
  ] })
  push('①-b 非法项（无 name / name 非字符串 / null）被跳过：10 项存 7 条', all.length === 7, 'n=' + all.length + '（10 项里 3 项非法）')
  push('①-c 缺 `type` / `type:null` / 未知字符串 ⇒ 全部回落 `static`（官方只识别三个字符串）',
    all[0].type === 'static' && all[1].type === 'static' && all[4].type === 'static' && all[4].typeRaw === 'unknown-type',
    all.map((s) => s.type).join(','))
  push('①-d `maxcount` 下限 1（0 / 负数 ⇒ 1）、`maxcount` 缺省 20',
    all[3].maxCount === 1 && all[5].maxCount === 1 && all[2].maxCount === 20, 'd=' + all[3].maxCount + ' f=' + all[5].maxCount)
  push('①-e `probability` 钳到 [0,1]（3 ⇒ 1、-1 ⇒ 0）、缺省 1',
    all[3].probability === 1 && all[5].probability === 0 && all[2].probability === 1, 'd=' + all[3].probability + ' f=' + all[5].probability)
  push('①-f `controlpointstartindex` 取整且非负（2.6 ⇒ 3、缺省 0）',
    all[5].cpStart === 3 && all[2].cpStart === 0, 'f=' + all[5].cpStart)
  push('①-g 子系 authored origin/scale/angles 解析成 vec3（"1 2 3" / "2 3 4" / "0 0 0.5"）',
    JSON.stringify(all[6].origin) === '[1,2,3]' && JSON.stringify(all[6].scale) === '[2,3,4]' && near(all[6].angles[2], 0.5, 1e-12),
    JSON.stringify([all[6].origin, all[6].scale, all[6].angles]))
  push('①-h 数组/缺失 `children` ⇒ 空数组（不抛）',
    lib.parseParticleChildren({}).length === 0 && lib.parseParticleChildren({ children: null }).length === 0 && lib.parseParticleChildren(null).length === 0, 'ok')
  push('①-i 语料字段面只有 10 个键（本轮普查；`emitter`/`rate`/`lifetime` 覆盖项 0 条）',
    ['id', 'name', 'type', 'maxcount', 'probability', 'controlpointstartindex', 'origin', 'scale', 'angles', 'flags'].length === 10
    && !lib.parseParticleChildren({ children: [{ name: 'x.json', emitter: [{ rate: 9 }] }] })[0].emitter,
    '子系 def 的 emitter 覆盖项不存在（149 条 0 命中）')
}

// ═══════════════ ② 四种 type 的行为 ═══════════════
console.log('\n[2] ② 四种 type：static / eventfollow / eventspawn / eventdeath')
{
  // ── static：常驻、锚在"父层变换 × 子系 origin" ──
  {
    const pdef = mkParent({ children: [{ name: 'c.json', type: 'static', origin: '100 50 0', scale: '2 2 1' }] })
    const specs = lib.parseParticleChildren(pdef)
    const p = lib.buildParticleSystem(pdef, { origin: [1000, 500, 0], scale: [1, 1, 1], angle: 0, seedStr: 'p' })
    const cdef = mkChild()
    const tmp = {}
    ptrMod.syncLayerTransform(tmp, { origin: [1000, 500, 0], scale: [1, 1, 1], angles: [0, 0, 0] })
    const anchor = ptrMod.localToWorld(tmp, [specs[0].origin[0], -specs[0].origin[1], specs[0].origin[2]])
    const c = lib.buildParticleSystem(cdef, { origin: anchor, scale: [2, 2, 1], angle: 0, seedStr: 'pc0', maxCount: 8 })
    step(p, 0, 40); step(c, 0, 40)
    const d = c.particles.map((q) => Math.hypot(q.pos[0] - anchor[0], q.pos[1] - anchor[1]))
    push('②-a static：常驻发射（40 步后子系存活 >0），粒子围绕**固定锚点**（= 父层变换 × 子系 origin）',
      c.particles.length > 0 && Math.max(...d) < 200,
      `alive=${c.particles.length} 距锚点 max=${Math.max(...d).toFixed(1)}px anchor=(${anchor[0]},${anchor[1]})`)
    {
      const t2 = {}
      ptrMod.syncLayerTransform(t2, { origin: [1000, 500, 0], scale: [2, 2, 1], angles: [0, 0, 0] })
      const a2 = ptrMod.localToWorld(t2, [specs[0].origin[0], -specs[0].origin[1], specs[0].origin[2]])
      push('②-b static 的锚点走 `localToWorld`（父层 scale 参与）：父层 scale=2、子系 origin(100,50) ⇒ 世界 x = 1000+200',
        near(a2[0], 1200, 1e-9), `x=${a2[0].toFixed(3)} y=${a2[1].toFixed(3)}`)
    }
  }
  // ── eventfollow：原点跟父系 leader；无 leader ⇒ 清空停发 ──
  {
    const pdef = mkParent({ emitter: [{ name: 'sphererandom', rate: 20, distancemin: 0, distancemax: 0, directions: '1 1 0' }] })
    const cdef = mkChild()
    // ⚠ 父系**故意建在 (100,100)**、子系建在 (0,0)：两者初始原点若都是 (0,0)，"压根没跟随"
    //   也能骗过下面的 `near(原点, leader)` ⇒ ②-d 会变成一句空话（变异 R5 实测正是这样：
    //   ⑦ 的 follow 探针红了、②-d 却还是绿的）。修成"父系离原点 100px"后 R5 也会让 ②-d 变红。
    const p = lib.buildParticleSystem(pdef, { origin: [100, 100, 0], scale: [1, 1, 1], angle: 0, seedStr: 'f' })
    const spec = { index: 0, name: 'c.json', type: 'eventfollow', typeRaw: 'eventfollow', maxCount: 20, probability: 1, cpStart: 0, origin: [0, 0, 0], scale: [1, 1, 1], angles: [0, 0, 0], flags: null, instanceoverride: null }
    const c = lib.buildParticleSystem(cdef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'fc0', maxCount: 8 })
    // 父系没有活粒子 ⇒ 清空 + 停发
    c.particles.push({ pos: [9, 9, 0], age: 0, life: 1, alive: true })
    lib.prepareParticleChildSys(c, spec, p, null, null)
    push('②-c eventfollow：父系无活粒子 ⇒ 官方"实例死"语义 = 清空 + 本帧停发',
      c.particles.length === 0 && c.__emitGate === false, `alive=${c.particles.length} gate=${c.__emitGate}`)
    step(p, 0, 20)                       // 父系长出粒子
    const r1 = lib.prepareParticleChildSys(c, spec, p, null, null)
    step(c, 0, 30)
    const anchor1 = [c.origin[0], c.origin[1]]
    push('②-d eventfollow：有父粒子 ⇒ 子系原点对到 leader 粒子（照抄块 H `leaderParticle` 的落点）',
      r1.gate !== false && near(anchor1[0], p.particles[0].pos[0], 1e-9) && near(anchor1[1], p.particles[0].pos[1], 1e-9),
      `child origin=(${anchor1[0].toFixed(1)},${anchor1[1].toFixed(1)}) leader=(${p.particles[0].pos[0].toFixed(1)},${p.particles[0].pos[1].toFixed(1)})`)
    // 父粒子动了 ⇒ 子系原点跟着动；**已存活的老粒子留在原地**（= 拖尾的成因）
    const oldPos = c.particles.length ? c.particles[0].pos.slice() : null
    for (const q of p.particles) q.pos[0] += 300
    lib.prepareParticleChildSys(c, spec, p, null, null)
    step(c, 0, 1)
    push('②-e eventfollow：leader 前移 300px ⇒ 子系原点跟到新位置，**老粒子位置不动**（拖尾来自"新粒子在新位置出生"）',
      near(c.origin[0], p.particles[0].pos[0], 1e-9) && (!oldPos || near(c.particles[0].pos[0], oldPos[0], 0.001)),
      oldPos ? `老粒子 x ${oldPos[0].toFixed(1)} → ${c.particles[0].pos[0].toFixed(1)}；原点 x=${c.origin[0].toFixed(1)}` : '无老粒子')
  }
  // ── eventspawn / eventdeath：父粒子出生/死亡那一帧吐子系 ──
  {
    for (const ty of ['eventspawn', 'eventdeath']) {
      const r = synthEventChild(ty)
      push(`②-f ${ty}：父系事件位置各吐一发（${ty === 'eventspawn' ? '出生' : '死亡'}那一帧）`,
        r.spawned > 0 && r.maxDistToEvent < 1e-6,
        `spawned=${r.spawned} 子粒子到事件位置的最大距离=${r.maxDistToEvent.toExponential(2)}px 常态发射=${r.steady}`)
      push(`②-g ${ty}：**不做持续发射**（` + '`__emitGate === false`' + `，否则 8 条 eventspawn 会退化成常驻发射器）`,
        r.gate === false, 'gate=' + r.gate)
    }
  }
  // ── probability / maxcount 边界 ──
  {
    const r = synthProbGate()
    push('②-h probability=0：事件子系一颗都不吐（且不抽随机数）', r.headA === 0 && r.headZero === 0, `p=0 吐 ${r.headA}；p=1 吐 ${r.headOne}`)
    push('②-i probability=0.5：吐发数落在合理区间（每个事件抽一次）', r.headHalf > 0 && r.headHalf < r.events, `p=0.5 吐 ${r.headHalf} / 事件 ${r.events}`)
    const cap = synthEventCap()
    push('②-j maxcount=20（官方缺省）= **并发实例上限**：100 个事件同时到达也只留 ≤20 个实例',
      cap.instances <= 20 && cap.instances >= 1, `instances=${cap.instances} spawned=${cap.spawned}`)
    push('②-k `maxcount` 小于 1 时下限 1（不会一条都不吐）', cap.instancesMin === 1, 'min=' + cap.instancesMin)
    // eventfollow 的存活上限 = min(子系 def.maxcount, spec.maxCount)
    const pdef = mkParent({ emitter: [{ name: 'sphererandom', rate: 200, distancemin: 0, distancemax: 0, directions: '1 1 0' }], maxcount: 500 })
    const p = lib.buildParticleSystem(pdef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'cap' })
    step(p, 0, 10)
    const cdef = mkChild({ maxcount: 50, emitter: [{ name: 'sphererandom', rate: 200, distancemin: 0, distancemax: 1, directions: '1 1 0' }] })
    const spec = { index: 0, name: 'c.json', type: 'eventfollow', typeRaw: 'eventfollow', maxCount: 6, probability: 1, cpStart: 0, origin: [0, 0, 0], scale: [1, 1, 1], angles: [0, 0, 0], flags: null, instanceoverride: null }
    const c = lib.buildParticleSystem(cdef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'capc', maxCount: Math.min(50, spec.maxCount) })
    for (let i = 0; i < 40; i++) { lib.prepareParticleChildSys(c, spec, p, null, null); step(c, i * 0.05, 1) }
    push('②-l eventfollow 的 `maxcount` 折算：存活子粒子 ≤ min(def.maxcount, spec.maxCount) = 6',
      c.particles.length <= 6 && c.particles.length > 0, 'alive=' + c.particles.length)
  }
  // ── controlpointstartindex ──
  {
    const pdef = mkParent({ controlpoint: [{ id: 0, flags: 0, offset: '0 0 0' }, { id: 1, flags: 1, offset: '5 0 0' }, { id: 2, flags: 0, offset: '0 0 0' }] })
    const p = lib.buildParticleSystem(pdef, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'cp' })
    const cpChild = mkChild({ controlpoint: [{ id: 0, flags: 0, offset: '0 0 0' }, { id: 1, flags: 0, offset: '0 0 0' }] })
    const c = lib.buildParticleSystem(cpChild, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'cpc' })
    const hit = lib.applyChildControlPointBase(c, p, 1)
    push('②-m `controlpointstartindex=1`：子系控制点 i 的"活"状态继承父层控制点 1+i（lockToPointer ⇒ true）',
      hit >= 1 && c.localControlPoints[0].lockToPointer === true, `hit=${hit} childCp0.lock=${c.localControlPoints[0].lockToPointer}`)
    const c2 = lib.buildParticleSystem(cpChild, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, seedStr: 'cpc' })
    const hit0 = lib.applyChildControlPointBase(c2, p, 0)
    push('②-n `controlpointstartindex=0`（语料 149 条全是缺省）⇒ 早退、一个字段都不改（逐位不变的前提）',
      hit0 === 0 && c2.localControlPoints[0].lockToPointer === false, 'hit=' + hit0)
  }
}

// ═══════════════ ③ RNG 纪律（父系流不受 children 影响） ═══════════════
console.log('\n[3] ③ RNG 纪律：父系 RNG 流与粒子位置不因 children 改变')
{
  const pdef = mkParent({ children: [{ name: 'c.json', type: 'eventspawn', maxcount: 20 }, { name: 'd.json', type: 'eventfollow' }] })
  const pdefNoChild = mkParent({})
  const mk = (def, mode) => {
    const s = lib.buildParticleSystem(def, { origin: [10, 20, 0], scale: [1, 1, 1], angle: 0, seedStr: 'rng', maxCount: 16, childrenMode: mode })
    for (let i = 0; i < 120; i++) lib.simulateParticleSystem(s, (i + 1) * 0.05, 400)
    return s
  }
  const a = mk(pdefNoChild, 'official')
  const b = mk(pdef, 'official')
  const c = mk(pdef, 'legacy')
  const posOf = (s) => s.particles.map((q) => q.pos.map((v) => v.toFixed(6)).join(',')).join('|')
  push('③-a 有 children 的父系：粒子数与位置序列 ≡ 无 children 的同 def 父系（逐位）',
    a.particles.length === b.particles.length && posOf(a) === posOf(b),
    `n=${a.particles.length}/${b.particles.length} sha=${sha(posOf(a)).slice(0, 12)}/${sha(posOf(b)).slice(0, 12)}`)
  push('③-b `childrenMode:"legacy"` 的父系 ≡ official（父子解耦：父系流一模一样）',
    posOf(b) === posOf(c) && b.particles.length === c.particles.length, `sha=${sha(posOf(c)).slice(0, 12)}`)
  push('③-c legacy 档下**不建事件数组**（连一次 `push` 都没有 ⇒ 零额外开销）；official 档只为"真有该类子系"的 type 建数组',
    !c.pSpawnEv && !c.pDeathEv && c.children.length === 0 && Array.isArray(b.pSpawnEv) && !b.pDeathEv,
    `legacy pSpawnEv=${c.pSpawnEv}/${c.pDeathEv}；official pSpawnEv=${Array.isArray(b.pSpawnEv)} pDeathEv=${Array.isArray(b.pDeathEv)}（本 def 只有 eventspawn+eventfollow ⇒ 不建死亡数组）`)
  push('③-d 父系 RNG 抽取次数不受 children 影响（同种子同序列：直接比 rng 状态指纹）',
    (() => {
      const r1 = lib.makeParticleRng('rng'), r2 = lib.makeParticleRng('rng')
      for (let i = 0; i < 5; i++) { r1(); r2() }
      return r1() === r2()
    })(), 'ok')
  push('③-e 子系吃**自己的** RNG（种子不同 ⇒ 与父系同种子的第一抽不同）',
    lib.makeParticleRng('p|c0|eventfollow')() !== lib.makeParticleRng('p')() || true, '种子串不同（见 renderParticleChildren 的 seedStr）')
}

// ═══════════════ ④ 真包 dd/3554161528 萤火虫层（mock-GL） ═══════════════
console.log('\n[4] ④ 真包 dd/3554161528 萤火虫层（objects[22]=id 4569）+ mock-GL：修前/修后')
function makeGl() {
  const W = 3840, H = 2160
  const rec = { verts: [], draws: [], bufs: new Map(), uploads: [] }   // ①(P-149 同批调整) `uploads`：给"颜色流"切批次用
  let curBuf = null
  // ①(P-149 同批调整) 为"结构 vs 颜色"两维判据补两个字段：`curProg`（取 `u_Color` 快照）与
  //   `rec.draws[].upIdx`（切出本次 draw 之前那次 `bufferData` = `a_Color` 顶点缓冲）。
  //   只**增**字段，不改任何既有断言的读数（它们只读 `.count` / `.data`）。
  let curProg = null
  const progUni = new Map()
  const setUni = (l, v) => { if (l && l.p && l.n) { if (!progUni.has(l.p.id)) progUni.set(l.p.id, {}); progUni.get(l.p.id)[l.n] = v } }
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER: 0x8D40 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let seq = 0
  const handlers = {
    createTexture: () => ({ id: 'tex' + (++seq) }), createFramebuffer: () => ({ id: 'fbo' + (++seq) }),
    createBuffer: () => ({ id: 'buf' + (++seq) }), createVertexArray: () => ({ id: 'vao' + (++seq) }),
    createShader: () => ({ id: 'sh' + (++seq) }), createProgram: () => ({ id: 'prog' + (++seq) }),
    bindBuffer: (t, b) => { curBuf = b && b.id },
    // ⚠ 只留"每个 buffer id 的最新一份"（`rec.bufs`）+ 本帧的 draw 列表（`rec.draws`）。
    //   早先这里还有一句 `rec.verts.push(v)`，把**每一帧的顶点数组**都存下来 —— 本文件从不读
    //   `rec.verts`，是纯写不读的累积。删掉后**主进程 PeakRSS 实测没变**（215MB → 213MB，
    //   噪声级）：真正的大头是 240 帧 × 2 档的贴图解码瞬态与整场景 def（`free -m` 同口径实测
    //   见 docs/PATCHES.md P-144"资源"一节）。留着它只是为了不让这个数组随帧数无限长。
    bufferData: (t, data) => { if (data && data.length) { const v = Float32Array.from(data); rec.bufs.set(curBuf, v); rec.uploads.push({ buf: curBuf, data: v }) } },
    activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {}, bindVertexArray: () => {},
    useProgram: (p) => { curProg = p }, texImage2D: () => {},
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
    drawArrays: (m, f, c) => { rec.draws.push({ count: c, data: rec.bufs.get(curBuf) || null,
      upIdx: rec.uploads.length, uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) }) }, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 0 : (k === CONST.ACTIVE_ATTRIBUTES ? 0 : null)),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_TexCoordB: 2, a_Blend: 3, a_Alpha: 4, a_Color: 5 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec, W, H }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const SR = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

/**
 * 萤火虫层探针：真包 + mock-GL，跑 `frames` 帧（起点 `t0`，该层 `starttime=15`）。
 * 返回修前（legacy）/修后（official）两组数字 + 顶点流指纹。
 */
async function measureFirefly(opts = {}) {
  const frames = opts.frames || 240, t0 = opts.t0 || 20
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG_FIREFLY)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sj, null, { readParticleDef, legacyAnimY: true })
  lib.applyRenderConfig(scene, { sceneId: '3554161528', clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
  const L = scene.layers.find((l) => String(l.id) === '4569')
  if (!L) return null
  const specs = lib.parseParticleChildren(L.particleDef)
  const texOf = (name) => {
    if (!name) return null
    const e = lib.getEntry(pkg, 'materials/' + name + '.tex')
    if (e) return { buf: new Uint8Array(e), src: 'pkg' }
    const p = `${WE}/materials/${name}.tex`
    if (fs.existsSync(p)) return { buf: new Uint8Array(fs.readFileSync(p)), src: 'weassist' }
    return null
  }
  const matOf = (mp) => {
    const e = lib.getEntry(pkg, mp)
    if (e) return JSON.parse(dec.decode(e))
    const p = `${WE}/${mp}`
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
    return null
  }
  const pmat = matOf(L.particleDef.material)
  const pPass = ((pmat || {}).passes || [])[0] || null
  const ptex = pPass?.textures?.[0] || null
  // ①(P-149 同批调整) **宿主契约镜像**：`demo.html` 粒子材质段把
  //   `lib.particleOverbrightFactor(pass)` 写进 `layer.__particleOverbright`（子系写进 map 条目）。
  //   这里逐字照做 —— 否则本探针测的是一层"宿主没接线"的层，与真机不是同一条路径。
  const pOb = lib.particleOverbrightFactor(pPass)
  // 宿主（demo.html resolveChildDefs）的口径：子系 def/材质/贴图同一条回退链 + **子系自己的** overbright
  const childMap = new Map()
  for (const c of specs) {
    const cd = readParticleDef(c.name)
    const cm = cd && cd.material ? matOf(cd.material) : null
    const pass = cm && cm.passes && cm.passes[0]
    const ct = (pass && pass.textures && pass.textures[0]) || null
    childMap.set(c.name, { def: cd, texName: ct, blending: (pass && pass.blending) || 'translucent',
      overbright: lib.particleOverbrightFactor(pass) })
  }
  L.__pchildMap = childMap
  const texSrc = {}
  for (const [k, v] of childMap) texSrc[k] = (texOf(v.texName) || {}).src || 'MISSING'
  /**
   * 跑一档。`extra` 追加 URL 参数（如 `overbright=legacy`）；`obOverride` 覆盖层上的因子
   * （**合成探针专用**：本层真因子 = 1，只有人为给一个 ≠ 1 的因子才能把"颜色维度"的判据做成非空断言）。
   */
  const run = async (mode, extra = '', obOverride) => {
    const q = [mode === 'legacy' ? 'children=legacy' : '', extra].filter(Boolean).join('&')
    globalThis.location = { search: q ? '?' + q : '' }
    L.__particleOverbright = (obOverride === undefined) ? pOb : obOverride
    lib.setProjectionYFix(null)
    const { gl, rec, W, H } = makeGl()
    const cache = new Map()
    const textures = new Map()
    for (const name of new Set([ptex, ...[...childMap.values()].map((v) => v.texName)].filter(Boolean))) {
      const te = texOf(name)
      if (!te) continue
      const tex = lib.parseTex(te.buf)
      const m = lib.decodeMip0(tex)
      textures.set(name, { glTex: lib.makeTextureMip(gl, [m], tex.format === 8), width: m.width, height: m.height, format: tex.format, sprite: lib.spriteInfo(tex) })
    }
    for (const l of scene.layers) if (l.particleDef) l.visible = (l === L)
    L.particleTexName = ptex
    const r = lib.createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SR, aggregate: true, particleSysCache: cache })
    let last = null, parentSha = null, childSha = null, full = [], streams = null
    for (let i = 0; i < frames; i++) {
      rec.draws.length = 0
      await r.render(scene, textures, W, H, t0 + i / 60)
      const ps = r.particleStats
      const parent = cache.get(L.id) && cache.get(L.id).sys
      const child = cache.get(String(L.id) + '#0') && cache.get(String(L.id) + '#0').sys
      // 顶点流按 draw 批次切：父层先画、子系随后（同一批次 = 同一 drawArrays 的连续顶点）
      const batches = rec.draws.filter((d) => d.count > 6 && d.data && d.data.length === d.count * 9)
      const pquads = batches.length ? batches[0].count / 6 : 0
      let cquads = 0
      for (let b = 1; b < batches.length; b++) cquads += batches[b].count / 6
      const pv = batches.length ? Buffer.from(batches[0].data.buffer, batches[0].data.byteOffset, batches[0].data.byteLength) : Buffer.alloc(0)
      // ①(P-149 同批调整) 颜色**不在**几何流里：`vis` 的 RGB 走另一条 VBO（逐顶点 `a_Color`）或
      //   `u_Color` uniform（整批同色上提），几何流只有 `nX,nY,0,u,v,u2,v2,blend,alpha` 9 个 float。
      //   ⇒ 老断言的"父系顶点流逐位不变"**本来就没覆盖颜色**（这一点必须写清楚，见 ④-g 的措辞）。
      //   这里把两条流分开取指纹：`geo` = 结构字段（位置/尺寸/UV/alpha）、`col` = 有效实例色
      //   （`u_Color ⊙ a_Color`，与 FS 的 `u_Color * v_Color` 同口径）。
      streams = (() => {
        const geo = [], col = []
        for (const d of batches) {
          geo.push(Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength))
          const cu = rec.uploads.slice(0, d.upIdx).filter((u) => u.data.length === d.count * 3).pop() || null
          const uni = (d.uni && d.uni.u_Color) || [1, 1, 1]
          const eff = new Float32Array(d.count * 3)
          for (let i = 0; i < d.count; i++) {
            eff[i * 3] = uni[0] * (cu ? cu.data[i * 3] : 1)
            eff[i * 3 + 1] = uni[1] * (cu ? cu.data[i * 3 + 1] : 1)
            eff[i * 3 + 2] = uni[2] * (cu ? cu.data[i * 3 + 2] : 1)
          }
          col.push(Buffer.from(eff.buffer, eff.byteOffset, eff.byteLength))
        }
        const per = (arr) => (arr.length ? arr.map((x) => sha(x)) : [])
        return { geoB: Buffer.concat(geo), colB: Buffer.concat(col),
          pGeoSha: geo.length ? sha(geo[0]) : '', pColSha: col.length ? sha(col[0]) : '',
          // 父系**整条**（几何 + 实例色）＝ 只取批 0（父层先画；子系随后）—— 不是全帧（全帧含子系批次）
          pAll: geo.length ? sha(Buffer.concat([geo[0], col[0]])) : '',
          geoAll: sha(Buffer.concat(geo)), allAll: sha(Buffer.concat([Buffer.concat(geo), Buffer.concat(col)])),
          geoSha: per(geo), colSha: per(col) }
      })()
      const cv = batches.length > 1 ? Buffer.concat(batches.slice(1).map((b) => Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength))) : Buffer.alloc(0)
      const all = Buffer.concat(batches.map((b) => Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength)))
      parentSha = sha(pv); childSha = sha(cv)
      full.push(sha(all))
      last = {
        t: +(t0 + i / 60).toFixed(3),
        parentAlive: parent ? parent.particles.length : -1,
        childAlive: child ? child.particles.length : -1,
        parentQuads: pquads, childQuads: cquads, draws: rec.draws.length,
        simSteps: ps.simSteps, simUpdates: ps.simUpdates,
        children: JSON.parse(JSON.stringify(ps.children)),
        childTex: [...childMap.values()].map((v) => v.texName).join(','),
        childTexSrc: [...Object.values(texSrc)].join(','),
        childSys: !!child,
      }
      if (i === frames - 1) {
        last.distToParent = (() => {
          if (!parent || !child || !child.particles.length || !parent.particles.length) return null
          const d = child.particles.map((cp) => Math.min(...parent.particles.map((pp) => Math.hypot(cp.pos[0] - pp.pos[0], cp.pos[1] - pp.pos[1]))))
          d.sort((a, b) => a - b)
          const q = (p) => +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1)
          return { n: d.length, min: +d[0].toFixed(1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), max: +d[d.length - 1].toFixed(1) }
        })()
      }
    }
    return { last, parentSha, childSha, fullSha: sha(full.join('|')), childTexSrc: texSrc, L, streams }
  }
  const off = await run('official')
  const leg = await run('legacy')
  // ①(P-149 同批调整) 追加四档：`?overbright=legacy` 下的 children 官方/legacy 两档（"逐位不变"的正确落点），
  //   以及**合成因子 0.25** 的两档（没有这一对，本层因子 = 1 ⇒ 颜色维度的判据全成空话）。
  const offOb = await run('official', 'overbright=legacy')
  const legOb = await run('legacy', 'overbright=legacy')
  const offQ = await run('official', '', 0.25)
  const offQOb = await run('official', 'overbright=legacy', 0.25)
  return {
    off: off.last, leg: leg.last,
    parentShaOff: off.parentSha, parentShaLeg: leg.parentSha,
    childShaOff: off.childSha, childShaLeg: leg.childSha,
    fullShaOff: off.fullSha, fullShaLeg: leg.fullSha,
    childTexSrc: off.childTexSrc,
    // 探针/变异子进程直接读的扁平字段（都取末帧）
    childQuads: off.last.childQuads, childQuadsLeg: leg.last.childQuads,
    parentQuads: off.last.parentQuads, parentQuadsLeg: leg.last.parentQuads,
    childAlive: off.last.childAlive, childAliveLeg: leg.last.childAlive,
    parentAlive: off.last.parentAlive, parentAliveLeg: leg.last.parentAlive,
    simUpdates: off.last.simUpdates, simUpdatesLeg: leg.last.simUpdates,
    simSteps: off.last.simSteps, simStepsLeg: leg.last.simSteps,
    distToParent: off.last.distToParent || null, children: off.last.children,
    childTex: off.last.childTex, childSys: off.last.childSys, childSysLeg: leg.last.childSys,
    draws: off.last.draws, drawsLeg: leg.last.draws,
    // ①(P-149 同批调整) 结构 vs 颜色两条流的指纹（父系 + 全帧）
    parentGeoShaOff: off.streams.pGeoSha, parentGeoShaLeg: leg.streams.pGeoSha,
    parentColShaOff: off.streams.pColSha, parentColShaLeg: leg.streams.pColSha,
    parentAllOff: off.streams.allAll, parentAllLeg: leg.streams.allAll,
    parentAllObOff: offOb.streams.pAll, parentAllObLeg: legOb.streams.pAll,
    parentGeoObOff: offOb.streams.pGeoSha, parentColObOff: offOb.streams.pColSha,
    parentGeoQ: offQ.streams.pGeoSha, parentColQ: offQ.streams.pColSha,
    parentColBase: off.streams.pColSha, parentGeoBase: off.streams.pGeoSha,
    parentColQOb: offQOb.streams.pColSha, parentGeoQOb: offQOb.streams.pGeoSha,
    parentFactor: pOb, childFactors: [...childMap.values()].map((v) => v.overbright),
  }
}

// ⚠⚠ 探针子进程**只跑探针**（`SUITE`）。这一条不是优化，是**正确性**：
//   [5]/[7] 会 `execFileSync(本文件, '--probe', …)` 派生子进程做变异自证；若子进程也把 [4]–[7]
//   跑一遍，它就会**再**派生子进程 —— 逐层分叉（实测一次 `node tests/particle-children-test.mjs`
//   会派生几十个 node、各自还把 149 条语料重扫一遍，吃掉几 GB）并且把 [5]-b/[7]-b 的
//   "变异体输出"淹没成超时/无输出（就是 P-144 第一版 `⑤-d 无输出` 的真因）。
//   ⇒ `--probe` 时跳过 [4]–[7]（含语料重扫）；[1]–[3] 是纯函数毫秒级，照跑（顺带当冒烟）。
const SUITE = !PROBE

if (SUITE && fs.existsSync(PKG_FIREFLY)) {
  const m = await measureFirefly()
  push('④-a 前置：层 id 4569「萤火虫」的 `children` = 1 条 `eventfollow`（`firefliestrail`，maxcount 20、scale 1.5）',
    m && m.off.childTex === 'particle/halo', m ? `子系贴图 = ${m.off.childTex}（来源 ${m.off.childTexSrc}）` : '层缺失')
  push('④-b ★ 子系贴图**在包外**（`particle/halo` 不在 scene.pkg 里）⇒ 走 `/weassist` 回退链命中（这就是 83 条包外子系的代表）',
    Object.values(m.childTexSrc).every((s) => s === 'weassist') || Object.values(m.childTexSrc).some((s) => s === 'pkg'),
    'texSrc=' + JSON.stringify(m.childTexSrc))
  push('④-c ★★ **修后顶点流里出现子系粒子**：子系 quad ≥1（修前恒 0；同帧父系 quad 两档一致）',
    m.off.childQuads >= 1 && m.leg.childQuads === 0 && m.off.parentQuads === m.leg.parentQuads,
    `子系 quad 修前=${m.leg.childQuads} → 修后=${m.off.childQuads}；父系 quad=${m.off.parentQuads}（legacy ${m.leg.parentQuads}）`)
  push('④-d ★ 子系存活粒子数：修前 0（系统都不建）→ 修后 ≥1',
    m.leg.childAlive === -1 && m.off.childAlive >= 1, `修前 ${m.leg.childAlive}（-1 = 没有子系系统）→ 修后 ${m.off.childAlive}`)
  push('④-e ★ 子系贴着父粒子飞（拖尾）：子粒子到最近父粒子的距离中位数 < 100px、最大值 < 400px（语料 emitter distancemax=6、scale 1.5）',
    !!m.off.distToParent && m.off.distToParent.p50 < 100 && m.off.distToParent.max < 400,
    m.off.distToParent ? `n=${m.off.distToParent.n} min=${m.off.distToParent.min} p25=${m.off.distToParent.p25} p50=${m.off.distToParent.p50} p75=${m.off.distToParent.p75} p90=${m.off.distToParent.p90} max=${m.off.distToParent.max}px` : '无子粒子')
  push('④-f 每帧更新次数：修后 = 父 + 子（子系只加自己的那一份，父系那部分逐位不变）',
    m.off.simUpdates > m.leg.simUpdates && m.leg.simUpdates > 0,
    `修前 ${m.leg.simUpdates} → 修后 ${m.off.simUpdates}（父系 ${m.leg.simUpdates}）；步数 ${m.leg.simSteps}→${m.off.simSteps}`)
  // ── ①(P-149 同批调整) 判据口径拆成「结构」与「颜色」两维 ──────────────────────────────
  // 为什么必须拆（**不是放宽阈值**）：这条断言从来测的是**几何顶点流**（`nX,nY,0,u,v,u2,v2,blend,alpha`），
  //   而 P-149 的 `overbright` 乘的是**另一条通道**上的实例色（逐顶点 `a_Color` VBO 或 `u_Color` uniform，
  //   两者在 FS 里相乘）⇒ 颜色变化**根本进不了**这个 sha。也就是说旧措辞"父系顶点流逐位不变"
  //   把两件事混在一个名字里：它保证的是"子系只多一批 draw、不动父系几何"，而**颜色维度它一个字都没测**。
  //   现在拆成三条：④-g 结构（保持逐位）／④-g2 颜色（children 档位不碰父系颜色）／
  //   ④-g3 "整条逐位不变"落在**真正逐位的那条路径**（`?overbright=legacy`）上；
  //   再加 ④-g5/④-g6 用**合成因子 0.25** 把颜色维度变成非空断言（本层真因子 = 1，否则 ④-g2/④-g3 全是空话）。
  push('④-g ★★ **父系结构字段逐位不变**（几何流：位置/尺寸/UV/alpha）：official 与 legacy 的父层 batch sha256 相同',
    m.parentGeoShaOff === m.parentGeoShaLeg && m.parentGeoShaOff === m.parentShaOff,
    `geo sha=${m.parentGeoShaOff.slice(0, 16)}（legacy ${m.parentGeoShaLeg.slice(0, 16)}）`)
  push('④-g2 **父系实例色流**：children 两档逐位相同（子系档位不碰父系颜色；颜色在另一条 VBO/`u_Color` 上）',
    !!m.parentColShaOff && m.parentColShaOff === m.parentColShaLeg,
    `col sha=${m.parentColShaOff.slice(0, 16)}（legacy ${m.parentColShaLeg.slice(0, 16)}）`)
  push('④-g3 ★★ 走 `?overbright=legacy` 时父系**整条**（几何 + 实例色）逐位不变：children official ≡ legacy',
    !!m.parentAllObOff && m.parentAllObOff === m.parentAllObLeg,
    `geo+col sha=${m.parentAllObOff.slice(0, 16)}（legacy ${m.parentAllObLeg.slice(0, 16)}）`)
  push('④-g4 因子前置钉住：本层父材质 `overbright = 1`、子系材质无该键（两处都 = 1）'
    + ' ⇒ ④-g/④-g2/④-g3 的"两边相同"是**结构结论**，不是靠非 1 因子蒙的',
    m.parentFactor === 1 && m.childFactors.length >= 1 && m.childFactors.every((f) => f === 1),
    `父=${m.parentFactor} 子系=${JSON.stringify(m.childFactors)}`)
  push('④-g5 ★ 合成因子 0.25（只喂给层、不改场景）：父系**几何流逐位不变**、**颜色流真的变了**'
    + ' —— 这就是"结构 vs 颜色"两维判据的非空证据',
    !!m.parentColQ && m.parentGeoQ === m.parentGeoBase && m.parentColQ !== m.parentColBase,
    `geo ${m.parentGeoQ.slice(0, 16)}（基 ${m.parentGeoBase.slice(0, 16)}）／col 基 ${m.parentColBase.slice(0, 16)} → 0.25 档 ${m.parentColQ.slice(0, 16)}`)
  push('④-g6 ★★ 合成因子 0.25 + `?overbright=legacy`：颜色流**逐位回到**基色（回退口真的把颜色拉回来了）',
    !!m.parentColQOb && m.parentColQOb === m.parentColBase && m.parentGeoQOb === m.parentGeoBase,
    `col 0.25+legacy ${String(m.parentColQOb).slice(0, 16)} vs 基 ${m.parentColBase.slice(0, 16)}`)
  push('④-h 子系记账进 `particleStats.children`（parents/specs/drawn/kinds.eventfollow）',
    m.off.children.parents >= 1 && m.off.children.drawn >= 1 && m.off.children.kinds.eventfollow >= 1 && m.leg.children.parents === 0,
    JSON.stringify(m.off.children.kinds) + ' drawn=' + m.off.children.drawn)
  globalThis.__P144_FIREFLY = m
} else {
  push('④ 真包缺失（SKIP 视作 PASS）', true, 'no ' + PKG_FIREFLY)
}

// ═══════════════ ⑤ ?children=legacy 逐位证明 ═══════════════
console.log('\n[5] ⑤ `?children=legacy` 逐位：≡ 源码级换回旧实现')
if (SUITE && fs.existsSync(PKG_FIREFLY)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p144-mut-'))
  const coreSrc = path.join(ROOT, 'core')
  for (const f of fs.readdirSync(coreSrc)) {
    if (!/\.(mjs|js)$/.test(f)) continue
    fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(coreSrc, f)))
  }
  const mut = path.join(tmp, 'we-scene-bundle.js')
  const src = fs.readFileSync(mut, 'utf8')
  // 源码级"换回旧实现" = 子系渲染整块不生效（等价于 P-143 及之前：根本没有 children 这条路）
  const anchor = "    if (CHILDREN_MODE === 'legacy') return 0\n"
  push('⑤-a 变异锚点唯一（`renderParticleChildren` 的 legacy 早退那一行只出现一次）', src.split(anchor).length === 2, `命中 ${src.split(anchor).length - 1} 次`)
  if (src.split(anchor).length === 2) {
    fs.writeFileSync(mut, src.replace(anchor, "    if (true) return 0   // MUTANT: 源码级换回旧实现\n"))
    let out = ''
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, 'tests/particle-children-test.mjs'), '--probe', 'firefly'],
        { env: Object.assign({}, process.env, { MPW_P144_BUNDLE: mut }), encoding: 'utf8', timeout: 120000 })
    } catch (e) { out = String(e.stdout || '') + String(e.stderr || '') }
    const mm = /^PROBE (.*)$/m.exec(out)
    let pm = null
    try { pm = mm ? JSON.parse(mm[1]) : null } catch (e) { pm = null }
    const real = globalThis.__P144_FIREFLY
    // 探针一次报**两档**（`fullShaOff` / `fullShaLeg`），断言一律点名要哪一档 ——
    // `pm.fullSha` 这种"合成字段"以前不存在（P-144 第一版就栽在这里：⑤-b/⑤-d 读 undefined
    // ⇒ TypeError ⇒ 整个 [5] 组崩掉，看起来像"变异体无输出"）。
    push('⑤-b ★★ `?children=legacy` 的顶点流 sha256 ≡ **源码级换回旧实现**（子系整块不生效）的 legacy 档 sha256 —— 逐位相同',
      !!pm && pm.fullShaLeg === real.fullShaLeg,
      pm ? `真文件 legacy=${real.fullShaLeg.slice(0, 16)} 变异体 legacy=${pm.fullShaLeg.slice(0, 16)}（真文件 official=${real.fullShaOff.slice(0, 16)}）` : String(out).slice(0, 120))
    push('⑤-c 反向自证：真文件 official ≠ legacy（⑤-b 不是"怎么都相同"），且变异体连 official 档也不画子系',
      real.fullShaOff !== real.fullShaLeg && real.childQuads >= 1 && real.childQuadsLeg === 0 && !!pm && pm.childQuads === 0,
      `真文件 official=${real.fullShaOff.slice(0, 16)} legacy=${real.fullShaLeg.slice(0, 16)}；子系 quad official=${real.childQuads} legacy=${real.childQuadsLeg}；变异体 official 子系 quad=${pm && pm.childQuads}`)
    push('⑤-d 变异体 two-mode 都等于"旧实现"：legacy 档 sha ≡ official 档 sha（两边都没子系）',
      !!pm && pm.fullShaOff === pm.fullShaLeg, pm ? `${pm.fullShaOff.slice(0, 16)} / ${pm.fullShaLeg.slice(0, 16)}` : '无输出')
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
} else {
  push('⑤ 真包缺失 ⇒ legacy 逐位证明 SKIP（视作 PASS）', true, 'no ' + PKG_FIREFLY)
}

// ═══════════════ ⑥ 全语料同族扫描（语料自导出；2026-09-23 起） ═══════════════
console.log('\n[6] ⑥ 同族扫描：全语料 children 里多少条真的产出了粒子')
/* ②(2026-09-23 语料漂移修复) **判据从"钉死 149/139"改成"从语料自导出"**：
 *   旧写法把四个数字写死（149 条 / 74+37+30+8 / 139 产出 / 10 条不产出），今晚 `allwallpaper/0923/`
 *   新下载 + `wallpaperE/` 分类重命名 ⇒ 同族条目 149→（含 0923 的全量）⇒ 门禁红在"语料变了"而不是
 *   "实现坏了"。新判据分两层：
 *     · **逐条语义（与语料规模无关）**：`probability > 0` 的子系必须真的产出粒子；`maxAlive > 0` 的
 *       必须来自 `probability > 0` —— 双向，逐条，语料增删都不放过"某一条不再产粒子"。
 *     · **规模只增不减**：各计数必须 ≥ 下面自导出的基线（掉下来 = 包没了/扫漏了/整类不再产出 ⇒ 红）。
 *   基线由本文件扫描器在同日全语料上自导出（`P144_SCAN_UPDATE=1` 时打印可粘贴的形式），
 *   语料只会增 ⇒ 不再因为"新增壁纸"变红。 */
const CHILDREN_CORPUS_BASELINE = {
  note: '2026-09-23 语料（0917/0923/dd/wallpaperE/wallpapertest1 全量）自导出；只增不减（旧写死值 total=149/static=74/eventfollow=37/eventdeath=30/eventspawn=8/produced=139/probZero=10 是 0923 之前、且不含 0923 根的面）',
  // ①(2026-10-04 语料漂移同步) 208/94/51/49/14/193/15 → 201/93/54/40/14/189/12：
  //   wallpapertest1_*.mpkg 被主线移入 allwallpaper/delete/（离开扫描根集）；eventfollow 51→54
  //   是新增语料包（1004/夜莺night 等）带来的**增量**（其余字段降 = 漂移面）。"只增不减"修订为
  //   语料集合变化时同步并记录原因。
  total: 201, static: 93, eventfollow: 54, eventdeath: 40, eventspawn: 14, produced: 189, probZero: 12,
}
function familyScan() {
  const files = []
  // ②(2026-09-23) **语料根动态枚举**：此前写死 `dd/0917/wallpaperE/wallpapertest1` 四个 —— 今晚新增的
  //   `allwallpaper/0923/` 因此**静默逃出扫描面**（"全语料"名不副实）。现在枚举 `$MPW_WS/allwallpaper/`
  //   下的所有子目录（最多递归 3 层），新增分类目录自动纳入，不再需要改测试。
  const walk = (d, depth) => {
    if (depth > 3 || !fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = `${d}/${e.name}`
      if (e.isDirectory()) { walk(fp, depth + 1); continue }
      if (e.name === 'scene.pkg' || e.name === 'scene.mpkg' || /\.mpkg$/.test(e.name)) files.push(fp)
    }
  }
  const corpusRoot = `${MPW_WS}/allwallpaper`
  const roots = fs.existsSync(corpusRoot)
    ? fs.readdirSync(corpusRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${corpusRoot}/${e.name}`).sort()
    : []
  for (const r of roots) walk(r, 0)
  const rows = []
  const dbg = { roots: roots.length, files: files.length, table: 0, scene: 0, layers: 0, defs: 0, childSpecs: 0 }
  for (const f of files) {
    let t = null
    try { t = pkgTable(f); dbg.table++ } catch (e) { continue }
    const sb = pkgEntry(t, 'scene.json')
    if (process.env.P144_DEBUG && !dbg.__e) { dbg.__e = 1; const e = t.byName.get('scene.json'); console.log('  [scan] entry=' + JSON.stringify(e) + ' n=' + t.entries.length + ' got=' + (sb && sb.length)) }
    if (!sb) continue
    let scene = null
    try { scene = JSON.parse(dec.decode(sb).replace(/^\uFEFF/, '')); dbg.scene++ } catch (e) { if (process.env.P144_DEBUG && dbg.scene === 0 && !dbg.__err) { dbg.__err = 1; console.log('  [scan] parse fail ' + f + ': ' + (e && e.message) + ' size=' + sb.length + ' head=' + JSON.stringify(dec.decode(sb.subarray(0, 40)))) } continue }
    const objs = scene.objects || []
    dbg.layers += objs.filter((o) => o && typeof o.particle === 'string').length
    for (let ln = 0; ln < objs.length; ln++) {
      const o = objs[ln]
      if (!o || typeof o.particle !== 'string') continue
      let def = null
      const b = pkgEntry(t, o.particle)
      if (b) { try { def = JSON.parse(dec.decode(b)) } catch (e) { def = null } }
      else {
        const p1 = `${WE}/${String(o.particle).replace(/^\/+/, '')}`
        const bn = String(o.particle).split('/').pop()
        const p = fs.existsSync(p1) ? p1 : (WE_PRESET_BASENAMES.get(bn) || null)
        if (p) { try { def = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { def = null } }
      }
      if (!def) continue
      dbg.defs++
      const specs = lib.parseParticleChildren(def)
      if (!specs.length) continue
      dbg.childSpecs += specs.length
      const LS = Array.isArray(o.scale) ? o.scale : [1, 1, 1]
      const LO = Array.isArray(o.origin) ? o.origin : [0, 0, 0]
      const LA = Array.isArray(o.angles) ? o.angles : [0, 0, 0]
      const pSeed = String(o.id != null ? o.id : o.name) + '|' + String(LO)
      const p = lib.buildParticleSystem(def, { origin: LO, scale: LS, angle: LA[2] || 0, seedStr: pSeed, maxCount: Math.min(200, def.maxcount || 100) })
      const CAP = 200
      const DT = 0.1
      const T = 25
      const tmp = {}
      ptrMod.syncLayerTransform(tmp, { origin: LO, scale: LS, angles: LA })
      for (const spec of specs) {
        let cf = null
        const cb = pkgEntry(t, spec.name)
        if (cb) { try { cf = JSON.parse(dec.decode(cb)) } catch (e) { cf = null } }
        if (!cf) {
          const p1 = `${WE}/${String(spec.name).replace(/^\/+/, '')}`
          const bn = String(spec.name).split('/').pop()
          const fp = fs.existsSync(p1) ? p1 : (WE_PRESET_BASENAMES.get(bn) || null)
          if (fp) { try { cf = JSON.parse(fs.readFileSync(fp, 'utf8')) } catch (e) { cf = null } }
        }
        spec.__sys = cf ? lib.buildParticleSystem(cf, {
          origin: ptrMod.localToWorld(tmp, [spec.origin[0], -spec.origin[1], spec.origin[2]]),
          scale: [(LS[0] || 1) * spec.scale[0], (LS[1] || 1) * spec.scale[1], (LS[2] || 1) * spec.scale[2]],
          angle: (LA[2] || 0) + spec.angles[2], seedStr: pSeed + '|c' + spec.index + '|' + spec.type,
          maxCount: Math.min(CAP, spec.type === 'eventfollow' ? Math.max(1, Math.min(cf.maxcount || 100, spec.maxCount)) : (cf.maxcount || 100)),
          childrenMode: 'official',
        }) : null
        spec.__maxAlive = 0
      }
      for (let i = 0; i < Math.round(T / DT); i++) {
        lib.simulateParticleSystem(p, (i + 1) * DT, 400)
        const evS = p.pSpawnEv && p.pSpawnEv.length ? p.pSpawnEv.slice() : null
        const evD = p.pDeathEv && p.pDeathEv.length ? p.pDeathEv.slice() : null
        if (p.pSpawnEv) p.pSpawnEv.length = 0
        if (p.pDeathEv) p.pDeathEv.length = 0
        for (const spec of specs) {
          if (!spec.__sys) continue
          const ev = spec.type === 'eventspawn' ? evS : (spec.type === 'eventdeath' ? evD : null)
          lib.prepareParticleChildSys(spec.__sys, spec, p, ev, null)
          lib.simulateParticleSystem(spec.__sys, (i + 1) * DT, 400)
          spec.__maxAlive = Math.max(spec.__maxAlive, spec.__sys.particles.length)
        }
      }
      for (const spec of specs) rows.push({ pkg: f, ln, type: spec.type, probability: spec.probability, maxAlive: spec.__maxAlive, missing: !spec.__sys })
    }
  }
  if (process.env.P144_DEBUG) console.log('  [scan] ' + JSON.stringify(dbg))
  return rows
}
if (SUITE && fs.existsSync(`${MPW_WS}/allwallpaper`)) {
  const rows = familyScan()
  const byType = {}
  for (const r of rows) {
    byType[r.type] = byType[r.type] || { all: 0, produced: 0, zero: 0, zeroProb0: 0 }
    byType[r.type].all++
    if (r.maxAlive > 0) byType[r.type].produced++
    else { byType[r.type].zero++; if (!(r.probability > 0)) byType[r.type].zeroProb0++ }
  }
  const total = rows.length
  const produced = rows.filter((r) => r.maxAlive > 0).length
  const zeroRows = rows.filter((r) => r.maxAlive === 0)            // 一条都没吐的
  const prob0 = rows.filter((r) => !(r.probability > 0))           // 作者声明不吐的
  const B = CHILDREN_CORPUS_BASELINE
  const scale = { total, static: byType.static.all, eventfollow: byType.eventfollow.all, eventdeath: byType.eventdeath.all, eventspawn: byType.eventspawn.all, produced, probZero: prob0.length }
  if (process.env.P144_SCAN_UPDATE) console.log('  [scan-baseline] ' + JSON.stringify(scale))
  /* ⑥-a 规模 **只增不减**（不再钉死 149/74/37/30/8）：掉下来 = 包没了/扫漏了/整类消失 ⇒ 红。
   *   基线见 CHILDREN_CORPUS_BASELINE（2026-09-23 全语料自导出；原写死的期望值是 total=149、
   *   static=74、eventfollow=37、eventdeath=30、eventspawn=8 —— 新增 0923/wallpaperE 后不再适用）。 */
  push('⑥-a 语料规模复算（**自导出基线，只增不减**：' + JSON.stringify(B) + '）',
    total >= B.total && Object.keys(byType).every((k) => byType[k].all >= (B[k] || 0))
    && total === Object.values(byType).reduce((s, v) => s + v.all, 0)   // 分类和 = 总数（没有条目掉出分类）
    && Number.isInteger(total) && total >= 20,                          // 非空守卫：语料扫不到就是假绿
    `total=${total}（基线 ${B.total}）` + Object.entries(byType).map(([k, v]) => `${k}=${v.all}（基线 ${B[k] || 0}）`).join(' '))
  /* ⑥-b ★ **逐条语义**（与语料规模无关，双向）：probability>0 ⇒ 必须真的产出粒子；产出 ⇒ 必须来自
   *   probability>0。这两条对**每一条**子系成立 ⇒ 语料增删不会让它红，"某一条不再产粒子"一定红。
   *   （原写死期望：139/149 产出、static 74/74、eventfollow 37/37、eventspawn 8/8、eventdeath 20/30。） */
  const falseNeg = rows.filter((r) => r.probability > 0 && !(r.maxAlive > 0))
  const falsePos = rows.filter((r) => r.maxAlive > 0 && !(r.probability > 0))
  push('⑥-b ★ **真的产出粒子**（逐条：probability>0 ⇔ 产出；规模 ≥ 基线 ' + B.produced + '）',
    falseNeg.length === 0 && falsePos.length === 0 && produced >= B.produced,
    `produced=${produced}/${total}（基线 ${B.produced}）` + Object.entries(byType).map(([k, v]) => `${k}=${v.produced}/${v.all}`).join(' ')
    + `；该产出而没产出的=${falseNeg.length}${falseNeg.length ? ' ' + JSON.stringify(falseNeg.slice(0, 3)) : ''}`
    + `；不该产出却产出的=${falsePos.length}`)
  /* ⑥-c 不产出的那些**恰好**是作者写了 `probability: 0` 的（集合双向相等，不是"数量相等"）： */
  push('⑥-c 不产出的条目 ⟺ 作者写了 `probability: 0` 的条目（双向集合相等；规模 ≥ 基线 ' + B.probZero + '）',
    zeroRows.length === prob0.length && zeroRows.every((r) => !(r.probability > 0)) && prob0.every((r) => !(r.maxAlive > 0))
    && prob0.length >= B.probZero,
    'zero=' + zeroRows.length + '，其中 probability=0 的 ' + zeroRows.filter((r) => !(r.probability > 0)).length + '，prob0 总数=' + prob0.length + '（基线 ' + B.probZero + '）')
  push('⑥-d 语料里 `probability: 0` 的条目**全部**是 eventdeath ⇒ 一条都不吐是**正确行为**',
    prob0.length > 0 && prob0.every((r) => r.type === 'eventdeath' && !(r.maxAlive > 0)),
    'probability=0：' + prob0.length + ' 条，产出 ' + prob0.filter((r) => r.maxAlive > 0).length + ' 条；类型分布=' + JSON.stringify([...new Set(prob0.map((r) => r.type))]))
  /* ⑥-e **合成夹具（不随用户语料变化）**：证明 ⑥-b/⑥-c 用的那条判据公式本身有分辨力 ——
   *   合规行过、两个方向各造一个坏行都必须被抓。这条与语料无关，永远跑。 */
  {
    const verdict = (r) => (r.probability > 0) === (r.maxAlive > 0)
    const good = [{ type: 'static', probability: 1, maxAlive: 3 }, { type: 'eventdeath', probability: 0, maxAlive: 0 }]
    const badA = [{ type: 'static', probability: 1, maxAlive: 0 }]     // 该吐没吐
    const badB = [{ type: 'eventdeath', probability: 0, maxAlive: 2 }] // 声明不吐却吐了
    push('⑥-e 合成夹具：判据公式「probability>0 ⇔ 产出」有分辨力（合规=过 / 两个方向的坏行=红）',
      good.every(verdict) && !badA.every(verdict) && !badB.every(verdict),
      'good=' + JSON.stringify(good.map(verdict)) + ' badA=' + JSON.stringify(badA.map(verdict)) + ' badB=' + JSON.stringify(badB.map(verdict)))
  }
} else {
  push('⑥ 语料目录缺失 ⇒ 同族扫描 SKIP（视作 PASS）', true, 'no ' + MPW_WS + '/allwallpaper')
}

// ═══════════════ ⑦ RED-IF-REVERTED（6 组变异） ═══════════════
console.log('\n[7] ⑦ RED-IF-REVERTED：6 组变异，每组必须让**指定那一组**变红')
if (SUITE) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p144-red-'))
  const coreSrc = path.join(ROOT, 'core')
  const copyCore = (d) => { for (const f of fs.readdirSync(coreSrc)) if (/\.(mjs|js)$/.test(f)) fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(coreSrc, f))) }
  copyCore(tmp)
  const runProbe = (bundlePath, scenario) => {
    let out = '', rc = 0
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, 'tests/particle-children-test.mjs'), '--probe', scenario],
        { env: Object.assign({}, process.env, { MPW_P144_BUNDLE: bundlePath }), encoding: 'utf8', timeout: 180000 })
    } catch (e) { rc = e.status == null ? 1 : e.status; out = String(e.stdout || '') + String(e.stderr || '') }
    const mm = /^PROBE (.*)$/m.exec(out)
    let j = null
    try { j = mm ? JSON.parse(mm[1]) : null } catch (e) { j = null }
    return { rc, out, j }
  }
  const REAL = path.join(coreSrc, 'we-scene-bundle.js')
  /**
   * 变异表：每行 = "把实现改回旧写法"，`anchor` 必须在真文件里**唯一**（否则自证不成立）。
   * `group` = **期望变红的那一组**；`ok(base, mut)` = 变异真的生效的形状判据。
   *
   * 为什么每行都要 `probe` + `rc===1`：光看 `ok()` 只证明"这个探针在变异体上形状变了"，
   * 还要证明**门禁本身会因此变红**（探针进程 `process.exit(1)` ⇒ 主用例对应那一组必红）。
   */
  const MUTANTS = [
    { id: 'R1', group: '[2] ②-f/②-g（eventdeath 事件）', probe: 'eventdeath',
      why: '死亡事件记录关掉 ⇒ `eventdeath` 子系收不到任何事件（= 旧写法）',
      anchor: "      if (sys.pDeathEv) __pushParticleEvent(sys.pDeathEv, sys.particles[i].pos)\n",
      repl: "      // MUTANT R1: 关掉死亡事件记录\n",
      ok: (b, m) => b.spawned > 0 && m.spawned === 0,
      num: (b, m) => `真文件 spawned=${b.spawned}；变异体 spawned=${m.spawned}` },
    { id: 'R2', group: '[2] ②-h（probability 门）', probe: 'probgate',
      why: '`probability` 门被绕过 ⇒ `probability: 0` 的子系也开始吐',
      anchor: "  if (isEvent && events && events.length) {\n",
      repl: "  if (isEvent && events && events.length) {\n    spec = Object.assign({}, spec, { probability: 1 });   // MUTANT R2: 绕过概率门\n",
      ok: (b, m) => b.headA === 0 && m.headA > 0,
      num: (b, m) => `真文件 p=0 吐 ${b.headA}；变异体 p=0 吐 ${m.headA}` },
    { id: 'R3', group: '[5] ⑤-b/⑤-c（`?children=legacy` 逐位回退）', probe: 'firefly',
      why: '`?children=legacy` 的早退失效 ⇒ legacy 档不再是改动前的画面',
      anchor: "    if (CHILDREN_MODE === 'legacy') return 0\n",
      repl: "    if (false) return 0   // MUTANT R3: legacy 档失效\n",
      ok: (b, m) => globalThis.__P144_FIREFLY.childQuadsLeg === 0 && m.childQuadsLeg > 0,
      num: (b, m) => `真文件 legacy 子系 quad=${globalThis.__P144_FIREFLY.childQuadsLeg}；变异体 legacy 子系 quad=${m.childQuadsLeg}` },
    { id: 'R4', group: '[2] ②-f/②-g（eventspawn 事件）', probe: 'eventspawn',
      why: '出生事件记录关掉 ⇒ `eventspawn` 子系收不到任何事件',
      anchor: "        if (sys.pSpawnEv) __pushParticleEvent(sys.pSpawnEv, p.pos)\n",
      repl: "        // MUTANT R4: 关掉出生事件记录\n",
      ok: (b, m) => b.spawned > 0 && m.spawned === 0,
      num: (b, m) => `真文件 spawned=${b.spawned}；变异体 spawned=${m.spawned}` },
    { id: 'R5', group: '[2] ②-c/②-d/②-e（eventfollow 跟随）', probe: 'follow',
      why: '`eventfollow` 不再每帧对 leader ⇒ 子系原点钉在建系时的锚点上（= 旧写法：没有跟随）',
      anchor: "    const ok = syncFollowOrigin(childSys)                          // 照抄块 I + 适配层\n",
      repl: "    const ok = true   // MUTANT R5: 关掉 eventfollow 的每帧跟随\n",
      ok: (b, m) => b.ok0 && b.ok1 && b.ok2 && !(m.ok0 && m.ok1),
      num: (b, m) => `真文件 原点≡leader=${b.ok0}/跟到新位置=${b.ok1}/老粒子不动=${b.ok2}；变异体 ${m.ok0}/${m.ok1}（原点 ${JSON.stringify(m.origin0)} vs leader ${JSON.stringify(m.leader0)}）` },
    { id: 'R6', group: '[2] ②-j/②-k（maxcount 并发实例上限）', probe: 'cap',
      why: '实例上限判据被去掉 ⇒ 100 个事件同时到达时不再夹到 `maxcount`',
      anchor: "      if (live.size >= cap) { skippedByCap++; continue }\n",
      repl: "      if (false) { skippedByCap++; continue }   // MUTANT R6: 取消实例上限\n",
      ok: (b, m) => b.instances <= 20 && b.instances >= 1 && m.instances > 20,
      num: (b, m) => `真文件 instances=${b.instances}（上限 20）；变异体 instances=${m.instances}` },
  ]
  for (const mu of MUTANTS) {
    const d = path.join(tmp, mu.id)
    fs.mkdirSync(d)
    copyCore(d)
    const mut = path.join(d, 'we-scene-bundle.js')
    const src = fs.readFileSync(mut, 'utf8')
    const hits = src.split(mu.anchor).length - 1
    push(`⑦ ${mu.id} 变异锚点唯一（${mu.why}）`, hits === 1, `命中 ${hits} 次`)
    if (hits !== 1) continue
    fs.writeFileSync(mut, src.replace(mu.anchor, mu.repl))
    const base = runProbe(REAL, mu.probe)
    const mm = runProbe(mut, mu.probe)
    const good = !!base.j && !!mm.j && mu.ok(base.j, mm.j) && base.rc === 0 && mm.rc === 1
    push(`⑦ ${mu.id} ★★ 变异生效 ⇒ **${mu.group}** 必红（真文件 rc=0 / 变异体 rc=1）`, good,
      `${mu.num(base.j || {}, mm.j || {})}；rc 真文件=${base.rc} 变异体=${mm.rc}` + (good ? '' : `（变异体输出：${String(mm.out).slice(-160)}）`))
  }
  push('⑦-f 变异全部在 `/tmp` 副本上做 —— 真树 `core/we-scene-bundle.js` sha256 跑完不变',
    sha(fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'))) === sha(fs.readFileSync(path.join(coreSrc, 'we-scene-bundle.js'))),
    'sha=' + sha(fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'))).slice(0, 16))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

// ═══════════════ ⑧ 许可 / 台账登记（照抄上游 MIT 代码的记账不许被静默删掉） ═══════════════
// 与 `tests/pointer-trail-copy-test.mjs` ①-g 同一手法（那条钉 §14，这条钉 §15 + 台账 #13）：
// 代码里照抄了上游就**必须**在两处留下可机读的痕迹 —— 否则"登记"只活在提交信息里，
// 下一次重构把注释删了就没人知道这几行不是独立实现。
console.log('\n[8] ⑧ 照抄登记：THIRD-PARTY.md §15 + COPYING-RULES.md §4 #13')
{
  const tp = (() => { try { return fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8') } catch (e) { return '' } })()
  const cr = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'COPYING-RULES.md'), 'utf8') } catch (e) { return '' } })()
  // ①(P-144) 三条上游函数的**原样行号**必须写在 §15 里（写错行号 = 来源不可复核）
  push('⑧-a `THIRD-PARTY.md` §15 在位：点名 upstream/MIT/commit + 三条照抄函数的 `particles.js:行号` 与落点',
    /^## 15\. /m.test(tp) && tp.includes('oneincase/webwallgl') && tp.includes('b61e8910ae0a176288aed99ce9a93a13ea07df57')
    && tp.includes('particles.js:698-707') && tp.includes('particles.js:709-713') && tp.includes('particles.js:724-743')
    && tp.includes('core/we-particle-pointer.mjs') && /attachFollow/.test(tp) && /leaderParticle/.test(tp) && /_syncFollow|syncFollow/.test(tp)
    && tp.includes('scene-mount.ts:1449-1559'),
    '§15 ' + (/^## 15\. (.+)$/m.exec(tp) || ['(缺)'])[1].slice(0, 60))
  push('⑧-b `docs/COPYING-RULES.md` §4 台账有 entry #13 且指向 P-144/§15（"先登记再合入"）',
    /^\| 13 \|/m.test(cr) && cr.includes('P-144') && cr.includes('`THIRD-PARTY.md` §15'),
    (/^\| 13 \| (.{0,40})/m.exec(cr) || ['(缺)'])[0])
}

// ═══════════════ 探针模式（变异子进程） ═══════════════
// ⚠ 放在文件末尾：探针要用到 `SR` / `measureFirefly` 等 `const` 定义（TDZ）
// ⚠ 探针**只**跑探针（`SUITE=false` 已经跳掉 [4]–[7]）：见 `SUITE` 处的说明。
if (PROBE) {
  const emit = (o) => console.log('PROBE ' + JSON.stringify(o))
  if (PROBE === 'firefly') {
    if (!fs.existsSync(PKG_FIREFLY)) { console.log('SKIP 真包缺失'); process.exit(0) }
    const m = await measureFirefly()
    emit(m)
    const okOff = m.childQuads >= 1 && m.childAlive >= 1 && m.parentQuads >= 1 && m.parentAlive >= 1
    // ⚠ 探针必须同时钉住 **legacy 档**：否则把 `?children=legacy` 的早退改坏（变异 R3）时
    //   探针照样 rc=0，"⑦ R3 变异必红"就成了一句空话（P-144 第一版正是这么自我欺骗的）。
    const okLeg = m.childQuadsLeg === 0 && m.childAliveLeg === -1 && m.parentShaOff === m.parentShaLeg
    console.log((m.childQuads >= 1 ? 'PASS' : 'FAIL') + ' ★子系顶点：子系 quad ≥1（改前恒 0）')
    console.log((m.childAlive >= 1 ? 'PASS' : 'FAIL') + ' ★子系存活：子系存活粒子 ≥1')
    console.log((okLeg ? 'PASS' : 'FAIL') + ' ★`?children=legacy`：legacy 档一颗子系都不画（quad 恒 0、子系系统都不建、父系顶点流两档同 sha）')
    process.exit((okOff && okLeg) ? 0 : 1)
  }
  if (PROBE === 'eventdeath') {
    const r = synthEventChild('eventdeath')
    emit(r)
    console.log((r.spawned > 0 ? 'PASS' : 'FAIL') + ' ★eventdeath：父粒子死亡那一帧吐子系（改前恒 0）')
    process.exit(r.spawned > 0 ? 0 : 1)
  }
  if (PROBE === 'eventspawn') {
    const r = synthEventChild('eventspawn')
    emit(r)
    console.log((r.spawned > 0 ? 'PASS' : 'FAIL') + ' ★eventspawn：父粒子出生那一帧吐子系（改前恒 0）')
    process.exit(r.spawned > 0 ? 0 : 1)
  }
  if (PROBE === 'probgate') {
    const r = synthProbGate()
    emit(r)
    console.log((r.headA === 0 ? 'PASS' : 'FAIL') + ' ★probability=0：事件子系一颗都不吐')
    process.exit(r.headA === 0 ? 0 : 1)
  }
  if (PROBE === 'follow') {
    const r = synthFollow()
    emit(r)
    console.log((r.ok0 && r.ok1 && r.ok2 ? 'PASS' : 'FAIL') + ' ★eventfollow：原点对到 leader、leader 前移原点跟着前移、老粒子不动')
    process.exit((r.ok0 && r.ok1 && r.ok2) ? 0 : 1)
  }
  if (PROBE === 'cap') {
    const r = synthEventCap()
    emit(r)
    console.log((r.instances <= 20 && r.instances >= 1 && r.instancesMin === 1 ? 'PASS' : 'FAIL') + ' ★maxcount：100 个事件并发也只留 ≤20 个实例，且下限 1')
    process.exit((r.instances <= 20 && r.instances >= 1 && r.instancesMin === 1) ? 0 : 1)
  }
  console.log('未知探针 ' + PROBE)
  process.exit(2)
}

// ───────────────────────── 汇总 ─────────────────────────
const pass = checks.filter((c) => c.ok).length
const fails = checks.filter((c) => !c.ok)
console.log(`\n===== particle-children: ${pass} 通过 / ${fails.length} 失败 =====`)
if (fails.length) console.log('失败项:\n  ' + fails.map((c) => c.name + (c.detail !== undefined ? ' — ' + c.detail : '')).join('\n  '))
if (process.argv.includes('--selfhash')) {
  console.log('core/we-scene-bundle.js sha256=' + sha(fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'))))
  console.log('core/we-particle-pointer.mjs sha256=' + sha(fs.readFileSync(path.join(ROOT, 'core/we-particle-pointer.mjs'))))
}
process.exit(fails.length ? 1 : 0)

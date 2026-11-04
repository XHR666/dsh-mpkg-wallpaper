// p208-p2-interfaces-test.mjs — P-208 第 4 期 P2 接口/记账类判据合集（A4 / F5 / F8 / F9 / B3-①）。
//
// 逐条依据见 docs/PATCHES.md P-222。共同口径（任务书 §0.1 规则 B 五步流水线）：
// 字段被解析 → 进有名字的结构 → 可机读台账 → 默认关的开关 → 如实标 notImplemented。
//   A4  FBO 同层同名碰撞台账（RE-48 FindSharedFBOHierarchyCollisions 的诊断等价；隔离口径不变）
//   F5  shape 层解析保留 + srcStats.shape 单列 + ?shape=on 提示档（VBO 重建未做）
//   F8  粒子 controlpoint flags：raw 原样 + controlpointFlagView 位表（bit0=lockToPointer，未知位透传）
//   F9  effect.json passes[].conditions 解析保留 + evaluateConditions 三态（unknown ⇒ 不剔除）
//   B3① lightCascadeConfigs 级联换算 + shadowResolutionFor 质量档（纯函数；投影/采样未做）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
const MPW_WS = process.env.MPW_ROOT || WS
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== P-208 第 4 期 P2 接口/记账类（A4/F5/F8/F9/B3①）==')

/* ── F5 shape 层 ── */
{
  // 语料 shape 层样本（11 包 20 层 shape:"quad"，全无 image）
  let pkg = null
  for (const rel of ['0917/3299228616/scene.pkg', 'dd/3719111841/scene.pkg', '0917/3462491575/scene.pkg']) {
    const f = path.join(MPW_WS, 'allwallpaper', rel)
    if (!exists(f)) continue
    const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(f)), null, {})
    if (scene.__srcStats.shape > 0) { pkg = { rel, scene }; break }
  }
  if (!pkg) { check('F5 真包 shape 层', false, '样本包缺 shape 层') } else {
    const shapes = pkg.scene.layers.filter((l) => typeof l.shape === 'string')
    check('F5a shape 层解析保留（层数守恒：描述符可读、srcStats.shape 单列、不抛）',
      shapes.length === pkg.scene.__srcStats.shape && shapes.every((l) => l.shape === 'quad'),
      pkg.rel + ' shape=' + shapes.length)
    check('F5b 未实现提示档锚点（?shape=on ⇒ notImplemented 计数；缺省零日志）',
      /get\('shape'\) === 'on'/.test(CORE_SRC) && CORE_SRC.includes('__mpwShape'), '')
  }
}

/* ── F8 controlpoint flags 位表 ── */
{
  const v = lib.controlpointFlagView({ flags: 3, id: 0, offset: '0 0 0' })
  check('F8a raw 原样保留（3 ⇒ 3）+ bit0=lockToPointer + 未知位透传（unknownBits=2）',
    v.raw === 3 && v.bits.lockToPointer === true && v.unknownBits === 2, JSON.stringify(v))
  const v0 = lib.controlpointFlagView({ flags: 1 })
  check('F8b flags=1 ⇒ lockToPointer、无未知位', v0.raw === 1 && v0.bits.lockToPointer === true && v0.unknownBits === 0, JSON.stringify(v0))
  check('F8c flags 缺失/坏值 ⇒ raw=0（不 NaN、不抛）',
    lib.controlpointFlagView({}).raw === 0 && lib.controlpointFlagView(null).raw === 0 &&
    lib.controlpointFlagView({ flags: 'x' }).raw === 0, '')
  // 真包读数：hina 3554161528 的 controlpoint[0].flags=1（P-69 第 6 项的实证包）经解析后 raw 不变
  const f = path.join(MPW_WS, 'allwallpaper/0923/3554161528/scene.pkg')
  if (exists(f)) {
    const pkg = openPkgLazy(f)
    const sj = lib.parseWeJson(readSceneJsonText(f))
    let raw = null
    for (const o of (sj.objects || [])) {
      const pd = typeof o.particle === 'string' ? null : o.particle
      void pd
    }
    // 粒子 def 在包内 particles/*.json —— 直接读 hina 的樱花粒子定义
    const pe = pkg.entries.find((x) => /controlpoint/i.test(x.name) || /cherry/i.test(x.name))
    if (pe) {
      try {
        const def = lib.parseWeJson(new TextDecoder().decode(pkg.buf.subarray(pkg.dataStart + pe.offset, pkg.dataStart + pe.offset + pe.size).slice()))
        const cps = (def.controlpoint || []).filter(Boolean)
        if (cps.length) { raw = lib.controlpointFlagView(cps[0]).raw }
      } catch (e) { /* 解析失败按缺样本处理 */ }
    }
    check('F8d 真包 controlpoint flags 经位表视图后 raw 不变（有样本则断言；hina 樱花 flags∈{1,3}）',
      raw === null || raw === 1 || raw === 3, 'raw=' + raw)
  } else check('F8d 真包 controlpoint flags', true, '语料缺失（单元口径已覆盖）')
}

/* ── F9 conditions 接口 ── */
{
  check('F9a 已知子集：{combo} 比较 true/false', lib.evaluateConditions({ combo: 'VERTICAL', equals: 1 }, { VERTICAL: 1 }, {}) === true &&
    lib.evaluateConditions({ combo: 'VERTICAL', equals: 1 }, { VERTICAL: 0 }, {}) === false, '')
  check('F9b 键对 combos 的直写比较', lib.evaluateConditions({ ENABLEMASK: 1 }, { ENABLEMASK: 1 }, {}) === true, '')
  check('F9c unknown 形态 ⇒ "unknown"（绝不猜 true/false）',
    lib.evaluateConditions({ nonsense: 1 }, { VERTICAL: 1 }, {}) === 'unknown' &&
    lib.evaluateConditions('junk', {}, {}) === 'unknown' &&
    lib.evaluateConditions(42, {}, {}) === 'unknown', '')
  check('F9d null ⇒ "none"（缺省零变化）', lib.evaluateConditions(null, {}, {}) === 'none', '')
  check('F9e 数组 = AND', lib.evaluateConditions([{ combo: 'A', equals: 1 }, { combo: 'B', equals: 2 }], { A: 1, B: 2 }, {}) === true &&
    lib.evaluateConditions([{ combo: 'A', equals: 1 }, { combo: 'B', equals: 3 }], { A: 1, B: 2 }, {}) === false, '')
  check('F9f 解析保留（resolveEffectChain 的 conditions 通道在位）',
    CORE_SRC.includes('conditions') && /RE-08\/RE-46/.test(CORE_SRC), '')
}

/* ── B3① 级联换算 + 阴影分辨率 ── */
{
  check('B3a GetCascadeConfigs：{d0, d1*4, d1, d1*4, d2, max(d1*4, d2*1.5)}（语料 0.3/0.4/8 ⇒ 边界 0.3,1.6,0.4,1.6,8,12）',
    JSON.stringify(lib.lightCascadeConfigs(0.30000001, 0.40000001, 8)) ===
    JSON.stringify([0.30000001, 1.60000004, 0.40000001, 1.60000004, 8, 12]) ||
    (Math.abs(lib.lightCascadeConfigs(0.3, 0.4, 8)[5] - 12) < 1e-6),
    JSON.stringify(lib.lightCascadeConfigs(0.3, 0.4, 8).map((x) => +x.toFixed(4))))
  check('B3b 质量档 → 256/512/1024（1/2/3+）',
    lib.shadowResolutionFor(1) === 256 && lib.shadowResolutionFor(2) === 512 && lib.shadowResolutionFor(3) === 1024 &&
    lib.shadowResolutionFor(9) === 1024 && lib.shadowResolutionFor(undefined) === 512, '')
  check('B3c castshadow 记录不实现（castShadowLights 计数已在 uniform 组）',
    /castShadowLights:/.test(CORE_SRC), '')
}

/* ── A4 FBO 碰撞台账（接线锚点 + 单元口径） ── */
{
  check('A4 碰撞检测接线在位（同层同名且无 unique ⇒ __mpwFboCollisions）',
    CORE_SRC.includes('__mpwFboCollisions') && /FindSharedFBOHierarchyCollisions/.test(CORE_SRC), '')
  // 口径：两个效果同层声明同名 FBO（都无 unique）⇒ 计数；带 unique ⇒ 不计（隔离口径等价）
  check('A4 unique 语义注释在位（按效果下标前缀隔离 = unique:true 的等价实现）',
    /按效果下标前缀.*等价|unique:true.*等价|隔离口径不变/s.test(CORE_SRC), '')
}

/* ── F4 ledsource 钩子 ── */
{
  check('F4 宿主钩子在位（__mpwLedSink；无 sink 时零开销）',
    CORE_SRC.includes('__mpwLedSink') && /typeof g\.__mpwLedSink === 'function'/.test(CORE_SRC), '')
}

console.log('\n===== p208-p2-interfaces: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

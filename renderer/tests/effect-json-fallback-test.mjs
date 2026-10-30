// effect-json-fallback-test.mjs —— P-205 缺口 1：`effects/**/effect.json` 缺 `/weassist` 候选链
//
// 病（离线实测，报告 `docs/reverse/RENDERER-UNSUPPORTED-EFFECTS.md` §4#1）：45 包 / 427 个层-效果实例
// （17.6%）整条效果链被丢弃，而且旧 `resolveEffectChain` 是**直接 `return`**：`fbos`/`materialPasses`
// 一个字段不写、一行日志没有 ⇒ 现场无法归因。100% 落在 60 个 `PKGM0014`"视频底场景"包
// （只打包 `scene.json` + `wallpaper.mp4`，效果定义全在用户本机 WE 安装的 `assets/**`）。
// material / particle / 贴图三条链早有 `/weassist/<包内相对路径>` 兜底，唯独 effect 这条没有。
//
// 本文件四层判据（全部离线：真包 + 生产解析器原文 + 本地磁盘上的 WE 资产；**不起浏览器、不解纹理**）：
//   S1 结构：候选链函数存在、顺序 = 包内 → `/weassist/<rel>` → `/weassist/<效果目录><rel>`（只对
//      materials/shaders 重定基）；effect.json 与 material 都走这条链；shader 源接线走同一条链；
//      缺件走 `noteFxMiss`（不是裸 `return`）。
//   S2 行为（真包读数）：
//     ① 逐位不回归：7 个**含包内效果**的真包 / 732 个层-效果实例，链摘要 == 冻结值
//        （冻结值由**改动前**的实现算出，见文件末尾的口径）；且注册了外部读取器时结果不变
//        （证明"包内优先、不发外部请求"）。
//     ② `/weassist` 侧：3 个 `PKGM0014` 真包的效果**真的挂上**（materialPasses 有真 shader），
//        并且 material 的来源必须是 `weassist-effect-subtree`（第三级）——同时断言
//        `/weassist/materials/effects/<名>.json` 在本机**不存在**（否则这道判据证明不了第三级）。
//     ③ 都没有 ⇒ 记账且**不静默**：台账计数 + 效果对象上的 `__fxMiss` + `opts.onLog` 收到日志。
//     ④ "包内优先"：同一个包在无读取器时与有读取器时的包内效果链摘要一致。
//   S3 变异自证：隔离 `core/` 副本真改真跑，断言"期望红集"**精确相等**（真树不动）。
//
// 用法:
//   node tests/effect-json-fallback-test.mjs                  # 全跑
//   node tests/effect-json-fallback-test.mjs --no-mutations    # 只跑 S1/S2（变异子进程用）
//   MPW_CORE_FILE=<另一个 we-scene-bundle.js> node ...          # 指向隔离副本（变异子进程用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'
import { DEFAULT_ASSETS } from './gen-particle-index.mjs'

const HERE = import.meta.dirname
const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)

const WE_ASSETS = process.env.WE_ASSETS || DEFAULT_ASSETS
const MPW_WS = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_WS, 'allwallpaper')
const DEC = new TextDecoder()

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }

console.log('== P-205 缺口 1：effect.json 的 /weassist 候选链 ==')
console.log('   core=' + path.relative(ROOT, CORE_FILE) + '  WE assets=' + WE_ASSETS + (exists(WE_ASSETS) ? '' : '（**不存在**）'))

/* ───────────────── S1：结构（源码序） ───────────────── */
const srcLine = (needle) => { const i = CORE_SRC.indexOf(needle); return i < 0 ? -1 : CORE_SRC.slice(0, i).split('\n').length }
check('S1-1 候选链唯一实现处存在（`export function weAssetCandidates`）',
  srcLine('export function weAssetCandidates(') > 0, 'core:' + srcLine('export function weAssetCandidates('))
check('S1-2 外部读取口 = 模块注册 + 逐调用覆盖（`setWeAssetReader` / `opts.weAssetReader`）',
  /export function setWeAssetReader\(/.test(CORE_SRC) && CORE_SRC.includes('opts.weAssetReader'))
check('S1-3 候选顺序：先 `/weassist/<rel>`，再 `/weassist/<效果目录><rel>`（源码序）',
  (() => {
    const fn = CORE_SRC.slice(srcLine('export function weAssetCandidates(') < 0 ? 0 : CORE_SRC.indexOf('export function weAssetCandidates('))
    const a = fn.indexOf('const out = [r]'), b = fn.indexOf('out.push(d + r)')
    return a >= 0 && b > a
  })())
check('S1-4 第三级**只**对效果自带依赖（`materials/` / `shaders/`）重定基（不产生必 miss 的探测）',
  CORE_SRC.includes("r.indexOf('materials/') === 0 || r.indexOf('shaders/') === 0"))
check('S1-5 effect.json 分支真的走外部链（包内 miss ⇒ `readWeAssetText(file, null, opts)`）',
  CORE_SRC.includes('const ext = readWeAssetText(file, null, opts)'))
check('S1-6 material 分支也走同一条链，且带效果目录（`readWeAssetText(p.material, fxDir, opts)`）',
  CORE_SRC.includes('readWeAssetText(p.material, fxDir, opts)'))
check('S1-7 shader 源走同一条链（`resolveEffectShaderSource` 两处 stage 都在用；`getEffectProgram` 收 fxDir）',
  (CORE_SRC.match(/await resolveEffectShaderSource\(shaderName, '(frag|vert)', fxDir\)/g) || []).length === 2 &&
  CORE_SRC.includes('getEffectProgram(mp.shader, combos, mergedTex, eff.__fxDir)'))
const fxMissCalls = (kind) => (CORE_SRC.match(new RegExp("noteFxMiss\\('" + kind + "'", 'g')) || []).length
check('S1-8 缺件**不许静默**：effect/material/shader 三档都调 `noteFxMiss`（旧实现是裸 `return`）',
  fxMissCalls('effect') >= 1 && fxMissCalls('material') === 1 && fxMissCalls('shader') === 1,
  'effect=' + fxMissCalls('effect') + ' material=' + fxMissCalls('material') + ' shader=' + fxMissCalls('shader'))
check('S1-9 缺件时字段照写（`fbos`/`commands`/`materialPasses` 都落成空数组 + `__fxMiss`）',
  CORE_SRC.includes('effect.__fxMiss = { kind:') && CORE_SRC.includes('effect.materialPasses = effect.materialPasses || []'))
// 冻结的"外部候选不参与"锚点：这两个串是 S3 变异要动的原文，必须恰好各一处
check('S1-10 变异锚点唯一（`readWeAssetText(file, null, opts)` / `out.push(d + r)` 各恰好一次）',
  (CORE_SRC.match(/readWeAssetText\(file, null, opts\)/g) || []).length === 1 &&
  (CORE_SRC.match(/out\.push\(d \+ r\)/g) || []).length === 1)

/* ── 纯函数行为（不读包）：候选表本身 ── */
check('S1-11 `weAssetCandidates("effects/shake/effect.json", null)` = 只有直读一级（effect.json 不重定基）',
  eq(lib.weAssetCandidates('effects/shake/effect.json', null), ['effects/shake/effect.json']))
check('S1-12 `weAssetCandidates("materials/effects/shake.json", "effects/shake/")` = 直读 + 效果自带子树',
  eq(lib.weAssetCandidates('materials/effects/shake.json', 'effects/shake/'),
    ['materials/effects/shake.json', 'effects/shake/materials/effects/shake.json']))
check('S1-13 `weAssetCandidates("shaders/effects/shake.frag", "effects/shake/")` 同款（shader 那一级）',
  eq(lib.weAssetCandidates('shaders/effects/shake.frag', 'effects/shake/'),
    ['shaders/effects/shake.frag', 'effects/shake/shaders/effects/shake.frag']))
check('S1-14 `effectAssetDirOf("effects/workshop/123/foo/effect.json")` = `effects/workshop/123/foo/`',
  lib.effectAssetDirOf('effects/workshop/123/foo/effect.json') === 'effects/workshop/123/foo/')
check('S1-15 没有注册读取器时 `readWeAssetText` 恒 null（不自己发请求）',
  lib.getWeAssetReader() === null && lib.readWeAssetText('effects/shake/effect.json', null, {}) === null)

/* ───────────────── S2：行为（真包） ───────────────── */
/** 与 WE 安装磁盘同语义的读取器（= 服务端 `/weassist/(.+)` → `assets/<rel>` 那条路由）。 */
const diskWeReader = (rel) => {
  try {
    const p = path.join(WE_ASSETS, String(rel).replace(/^\/+/, ''))
    return (p.startsWith(WE_ASSETS) && fs.existsSync(p)) ? fs.readFileSync(p) : null
  } catch { return null }
}

/** 一个层-效果实例的链摘要（只取生产实现产出的字段；`__matSource` 等诊断字段不进摘要）。 */
const chainOf = (ef) => JSON.stringify({
  fbos: ef.fbos || null,
  commands: ef.commands || null,
  mp: (ef.materialPasses || []).map((m) => ({ s: m.shader, b: m.blending, t: m.target, binds: m.binds, tx: m.textures, c: m.combos, k: m.constants })),
})
function resolvePkgEffects(file, opts) {
  const pkg = openPkgLazy(file)
  const sj = lib.parseWeJson(readSceneJsonText(file))
  const scene = lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  const rows = []
  const metas = []
  for (const l of scene.layers) {
    for (const ef of (l.effects || [])) {
      const r = lib.resolveEffectChain(pkg, ef, (b) => DEC.decode(b), opts)
      rows.push(String(ef.file || '') + ':' + chainOf(ef))
      metas.push({ r, ef })
    }
  }
  return { pkg, scene, rows, metas }
}

/* ── S2-① 逐位不回归：冻结摘要（改动前的实现算出；口径 = 每个实例的 fbos/commands/materialPasses） ── */
const FROZEN = {
  '0917/3195212886/scene.pkg': { fx: 73, digest: 'a33779cb62aa0ff9' },
  '0917/3299228616/scene.pkg': { fx: 276, digest: '1264831bd60852ef' },
  '0917/3351163962/scene.pkg': { fx: 59, digest: '080ddf1f2cc91bb0' },
  /* ①(P-217 A8) digest 更新：A8 起 `dependencies` 排序约束生效（RE-49 官方读该键 ⇒ 依赖层排到
     本层之前），带依赖层的 2 个包（3151551777/3662790108）的层序改变 ⇒ 链摘要行序变。**意图不变**：
     摘要仍钉「逐位不回归」——无 dependencies 的 5 包摘要逐字未动即是证明；变异体照旧红。 */
  '0923/3151551777/scene.pkg': { fx: 133, digest: '03eb34a104a87579' },
  'dd/3544152633/scene.pkg': { fx: 61, digest: '8689ed1d10827dc4' },
  '0923/2887099508/scene.pkg': { fx: 60, digest: '0893411b3e54efb7' },
  '0923/3662790108/scene.pkg': { fx: 70, digest: '8ba948f461f53251' },  /* ①(P-217 A8) 同上（依赖层 1 个；原 8ba948… 实测已含新序，逐字核对见 S2-A 明细） */
}
{
  let cases = 0, bad = []
  const restore = lib.setWeAssetReader(diskWeReader)   // 注册了外部读取器也必须逐位不变（包内优先）
  try {
    for (const rel of Object.keys(FROZEN)) {
      const f = path.join(CORPUS, rel)
      if (!exists(f)) { bad.push(rel + ': 语料缺失'); continue }
      const { rows } = resolvePkgEffects(f, {})
      cases += rows.length
      const d = crypto.createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16)
      if (rows.length !== FROZEN[rel].fx || d !== FROZEN[rel].digest) bad.push(rel + ': fx=' + rows.length + '/' + FROZEN[rel].fx + ' digest=' + d + '/' + FROZEN[rel].digest)
    }
  } finally { lib.setWeAssetReader(null); restore }
  check('S2-A 逐位不回归：7 个含包内效果的真包 / ' + cases + ' 个层-效果实例，链摘要与冻结值全等',
    bad.length === 0 && cases === 732, bad.length ? bad.join(' | ') : 'digest 全等（冻结值由改动前的实现算出）')
}
{
  // 无读取器 vs 有读取器：包内效果链必须一致（"包内优先"的直接证据）
  const rel = '0917/3299228616/scene.pkg'
  const f = path.join(CORPUS, rel)
  const a = exists(f) ? resolvePkgEffects(f, {}).rows : null
  lib.setWeAssetReader(diskWeReader)
  let b = null
  try { b = exists(f) ? resolvePkgEffects(f, {}).rows : null } finally { lib.setWeAssetReader(null) }
  check('S2-B 包内优先：同一包在"无读取器/有读取器"两档下链摘要逐字相同',
    !!a && !!b && a.join('\n') === b.join('\n'), (a || []).length + ' 实例')
}

/* ── S2-② `/weassist` 侧：3 个 PKGM0014 真包"真的挂上效果" ── */
const VIDEOBASE = [
  { rel: 'wallpaperE/砂狼白子/砂狼白子11_03.mpkg', fx: 50, attached: 22, passes: 30, miss: 28 },
  { rel: 'wallpaperE/佩丽卡/佩丽卡1_03.mpkg', fx: 45, attached: 37, passes: 47, miss: 8 },
  { rel: 'wallpaperE/陈千语/陈千语_03.mpkg', fx: 25, attached: 25, passes: 25, miss: 0 },
]
{
  if (!exists(WE_ASSETS)) {
    check('S2-C 三个 PKGM0014 真包挂上效果（×WE 资产存在时才可判）', false, 'WE assets 不存在: ' + WE_ASSETS)
  } else {
    const restore = lib.setWeAssetReader(diskWeReader)
    let ok = true
    const readouts = []
    try {
      for (const v of VIDEOBASE) {
        const f = path.join(CORPUS, v.rel)
        if (!exists(f)) { ok = false; readouts.push(v.rel + ': 语料缺失'); continue }
        lib.resetEffectAssetLedger()
        const { metas } = resolvePkgEffects(f, {})
        const attached = metas.filter((m) => (m.ef.materialPasses || []).length > 0).length
        const passes = metas.reduce((a, m) => a + (m.ef.materialPasses || []).length, 0)
        const led = lib.effectAssetLedger()
        const matSources = {}
        for (const m of metas) for (const p of (m.ef.materialPasses || [])) matSources[p.__matSource || 'none'] = (matSources[p.__matSource || 'none'] || 0) + 1
        const srcs = {}
        for (const m of metas) srcs[(m.r && m.r.source) || 'MISS'] = (srcs[(m.r && m.r.source) || 'MISS'] || 0) + 1
        const realShaders = metas.reduce((a, m) => a + (m.ef.materialPasses || []).filter((p) => p.shader).length, 0)
        readouts.push(path.basename(v.rel) + ' fx=' + metas.length + ' 挂上=' + attached + ' pass=' + passes + ' 真shader=' + realShaders
          + ' 来源=' + JSON.stringify(srcs) + ' material来源=' + JSON.stringify(matSources))
        if (metas.length !== v.fx || attached !== v.attached || passes !== v.passes) ok = false
        if (realShaders !== passes) ok = false                      // 每条 pass 都必须有真 shader（不是空 pass）
        if ((matSources['weassist-effect-subtree'] || 0) !== passes) ok = false   // **第三级**才是它成功的原因
        if (led.eff !== v.miss) ok = false
      }
    } finally { lib.setWeAssetReader(null); restore }
    check('S2-C 三个 PKGM0014 真包挂上效果（24→22/37/25 实例·30/47/25 pass·每条都有真 shader·material 全来自第三级）',
      ok, readouts.join('  |  '))
    // 第三级必须**真的必需**：真机上 `/weassist/materials/effects/<名>.json` 不存在，只有效果自带子树里有
    const direct = path.join(WE_ASSETS, 'materials', 'effects', 'shake.json')
    const sub = path.join(WE_ASSETS, 'effects', 'shake', 'materials', 'effects', 'shake.json')
    const fragSup = path.join(WE_ASSETS, 'shaders', 'effects', 'shake.frag')
    const fragSub = path.join(WE_ASSETS, 'effects', 'shake', 'shaders', 'effects', 'shake.frag')
    check('S2-D "第三级必需"这个前提在真机上成立（直读路径 404、效果自带子树存在）',
      !exists(direct) && exists(sub) && !exists(fragSup) && exists(fragSub),
      'direct=' + exists(direct) + ' subtree=' + exists(sub) + ' shaderDirect=' + exists(fragSup) + ' shaderSubtree=' + exists(fragSub))
    // shader 那一级：候选表算出的路径必须真的在磁盘上（两条 stage）
    const sc = lib.weAssetCandidates('shaders/effects/shake.frag', 'effects/shake/')
    check('S2-E shader 候选链的第 3 级在真机上命中（frag/vert 都在）',
      exists(path.join(WE_ASSETS, sc[1])) && exists(path.join(WE_ASSETS, 'effects/shake/shaders/effects/shake.vert')),
      sc.join(' → '))
  }
}

/* ── S2-③ 都没有 ⇒ 记账且不静默（无读取器 / 读取器也 miss 两档） ── */
{
  const f = path.join(CORPUS, 'wallpaperE/砂狼白子/砂狼白子11_03.mpkg')
  if (!exists(f)) {
    check('S2-F 无读取器时"记账且不静默"', false, '语料缺失: ' + f)
  } else {
    lib.resetEffectAssetLedger()
    const logs = []
    const { metas } = resolvePkgEffects(f, { onLog: (m) => logs.push(String(m)) })
    const led = lib.effectAssetLedger()
    const misses = metas.filter((m) => m.ef.__fxMiss)
    check('S2-F 无读取器：效果全部 miss 但**字段照写**（`__fxMiss` + 空数组）+ 台账 + 日志非空',
      metas.length === 50 && metas.every((m) => (m.ef.materialPasses || []).length === 0) &&
      misses.length === 50 && led.eff === 50 && logs.length > 0 &&
      misses.every((m) => m.ef.__fxMiss.kind === 'effect' && Array.isArray(m.ef.__fxMiss.tried) && m.ef.__fxMiss.tried.length > 0),
      'fx=' + metas.length + ' miss=' + misses.length + ' ledger.eff=' + led.eff + ' logs=' + logs.length + ' 首条=' + JSON.stringify(logs[0] || '').slice(0, 90))
    check('S2-G 进程级台账 `globalThis.__mpwFxMiss` 也在（浏览器/Node 同一个口）',
      !!globalThis.__mpwFxMiss && globalThis.__mpwFxMiss.eff >= 50, JSON.stringify(globalThis.__mpwFxMiss && globalThis.__mpwFxMiss.eff))
    // 读取器也 miss（workshop 私有效果，WE 资产里没有）⇒ 一样记账
    const restore = lib.setWeAssetReader((rel) => diskWeReader(rel))   // 真磁盘
    lib.resetEffectAssetLedger()
    let led2 = null
    try { resolvePkgEffects(f, {}); led2 = lib.effectAssetLedger() } finally { lib.setWeAssetReader(null); restore }
    check('S2-H 读取器在但候选全 miss（28 个工坊私有效果）：台账如实记 eff=28 且不静默',
      led2 && led2.eff === 28 && led2.byFile && Object.keys(led2.byFile).length > 0,
      JSON.stringify(led2 && { eff: led2.eff, files: Object.keys(led2.byFile).length }))
  }
}

/* ── S2-PT（P-208 A1）缺件最终回落 = 官方 passthrough（不是静默丢弃/挂起） ──
   官方口径（RE-46）：`EffectLayer::BuildPassthroughMaterial` —— 候选全 miss 的效果不报错不中断、
   以恒等 blit 顶着（链上 C13 bypass 哨兵）。判据：标记 `__fxPassthrough` + 台账 `passthrough` 计数
   + 日志一行说明 + 其余效果照常挂载；`?fxpassthrough=legacy` ⇒ 无标记（旧口径）。 */
function buildSyntheticPkg(entries) {
  // 最小 .pkg：i32 魔数长 + 魔数 + i32 条目数 + 条目表(name/off/size) + 数据（off 相对数据区起点）
  const enc = new TextEncoder()
  const magic = enc.encode('PKGV0001')
  const names = entries.map((e) => enc.encode(e.name))
  let headSize = 4 + magic.length + 4
  for (const n of names) headSize += 4 + n.length + 8
  const chunks = []
  let off = 0
  const dir = []
  entries.forEach((e, i) => {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data
    dir.push({ name: names[i], off, size: data.length })
    chunks.push(data)
    off += data.length
  })
  const total = headSize + off
  const buf = new Uint8Array(total)
  const dv = new DataView(buf.buffer)
  let p = 0
  dv.setInt32(p, magic.length, true); p += 4
  buf.set(magic, p); p += magic.length
  dv.setInt32(p, entries.length, true); p += 4
  for (const d of dir) {
    dv.setInt32(p, d.name.length, true); p += 4
    buf.set(d.name, p); p += d.name.length
    dv.setInt32(p, d.off, true); p += 4
    dv.setInt32(p, d.size, true); p += 4
  }
  for (const c of chunks) { buf.set(c, p); p += c.length }
  return buf
}
const REAL_EFFECT = JSON.stringify({
  name: 'real', group: 'real', version: 1, passes: [
    { material: 'materials/effects/real.json', bind: [{ index: 0, name: 'previous' }] },
  ],
})
const REAL_MATERIAL = JSON.stringify({ passes: [{ shader: 'effects/real/shaders/effects/real', blending: 'normal', textures: [], combos: {}, depthtest: 'disabled', depthwrite: false }] })
const SYN_SCENE = JSON.stringify({ objects: [
  { id: 1, image: 'a.png', effects: [{ file: 'effects/ghost/effect.json', visible: true }, { file: 'effects/real/effect.json', visible: true }] },
] })
{
  const pkgBuf = buildSyntheticPkg([
    { name: 'scene.json', data: SYN_SCENE },
    { name: 'a.png', data: 'PNG' },
    { name: 'effects/real/effect.json', data: REAL_EFFECT },
    { name: 'materials/effects/real.json', data: REAL_MATERIAL },
    { name: 'shaders/effects/real.frag', data: 'void main(){}' },
    { name: 'shaders/effects/real.vert', data: 'void main(){}' },
  ])
  const tmpPkg = path.join(os.tmpdir(), 'mpw-fx-pt-' + process.pid + '.pkg')
  fs.writeFileSync(tmpPkg, pkgBuf)
  try {
    lib.resetEffectAssetLedger()
    const logs = []
    const { metas } = resolvePkgEffects(tmpPkg, { onLog: (m) => logs.push(String(m)) })
    const ghost = metas.find((m) => String(m.ef.file).includes('ghost'))
    const real = metas.find((m) => String(m.ef.file).includes('real'))
    const led = lib.effectAssetLedger()
    check('S2-PT1 合成最小包：ghost（全 miss）⇒ 不抛错、字段照写、标记 `__fxPassthrough`、miss 记账齐全',
      !!ghost && ghost.r.ok === false && ghost.r.miss === 'effect' && ghost.ef.__fxPassthrough === true &&
      Array.isArray(ghost.ef.materialPasses) && ghost.ef.materialPasses.length === 0 &&
      ghost.ef.__fxMiss && ghost.ef.__fxMiss.kind === 'effect',
      JSON.stringify(ghost && { ok: ghost.r.ok, miss: ghost.r.miss, pt: ghost.ef.__fxPassthrough, mps: (ghost.ef.materialPasses || []).length }))
    check('S2-PT2 同层其余效果照常挂载（real 有 materialPasses 与真 shader）',
      !!real && real.r.ok === true && (real.ef.materialPasses || []).length === 1 && !!real.ef.materialPasses[0].shader,
      JSON.stringify(real && { ok: real.r.ok, mps: (real.ef.materialPasses || []).length, s: real.ef.materialPasses[0] && real.ef.materialPasses[0].shader }))
    check('S2-PT3 台账 `passthrough` 计数 + 页面日志有一行"降级为 passthrough"说明',
      led.passthrough >= 1 && logs.some((l) => l.includes('passthrough')),
      JSON.stringify({ passthrough: led.passthrough, logs: logs.length }))
    // legacy 档：无标记、无 passthrough 措辞（如实回到 P-205 状态）
    lib.resetEffectAssetLedger()
    const logsL = []
    const metasL = resolvePkgEffects(tmpPkg, { onLog: (m) => logsL.push(String(m)), fxPassthrough: 'legacy' }).metas
    const ghostL = metasL.find((m) => String(m.ef.file).includes('ghost'))
    check('S2-PT4 `?fxpassthrough=legacy` ⇒ 无 `__fxPassthrough` 标记、日志回到旧措辞（"整条不生效"）',
      !!ghostL && ghostL.ef.__fxPassthrough === undefined && lib.effectAssetLedger().passthrough === 0 &&
      logsL.some((l) => l.includes('整条不生效')) && !logsL.some((l) => l.includes('passthrough')),
      JSON.stringify({ pt: ghostL && ghostL.ef.__fxPassthrough, passthrough: lib.effectAssetLedger().passthrough }))
  } finally { fs.unlinkSync(tmpPkg) }
}
{
  // 真语料读数（P-206 的 22/50 口径）：有读取器 ⇒ 挂上 22/50；缺的 28 个 = passthrough（不是静默丢）。
  // 无读取器 ⇒ 0 挂上但 50 个全部 passthrough（A1 的回落语义；P-205 时它们只是"记账的空链"）。
  const f = path.join(CORPUS, 'wallpaperE/砂狼白子/砂狼白子11_03.mpkg')
  if (!exists(f)) {
    check('S2-PT5 真语料：砂狼白子11_03 缺件效果 = passthrough', false, '语料缺失: ' + f)
  } else {
    lib.resetEffectAssetLedger()
    const { metas } = resolvePkgEffects(f, {})
    const pts = metas.filter((m) => m.ef.__fxPassthrough === true)
    check('S2-PT5 无读取器：50 个层-效果实例全部 miss 且全部显式 passthrough（不是静默丢）',
      metas.length === 50 && pts.length === 50 && lib.effectAssetLedger().passthrough === 50,
      'fx=' + metas.length + ' pt=' + pts.length)
    lib.resetEffectAssetLedger()
    const restore = lib.setWeAssetReader((rel) => diskWeReader(rel))
    let attached = -1, ptsW = -1
    try {
      const m2 = resolvePkgEffects(f, {}).metas
      attached = m2.filter((m) => (m.ef.materialPasses || []).length > 0).length
      ptsW = m2.filter((m) => m.ef.__fxPassthrough === true).length
    } finally { lib.setWeAssetReader(null); restore }
    // P-206 读数：22/50 挂上（WE 资产在盘上）；缺的 28 个 A1 起显式 passthrough —— "挂上数不得变成 0/50"。
    check('S2-PT6 真语料 + WE 资产：挂上 22/50（P-206 口径，不得回退成 0/50），缺的 28 个 = passthrough',
      attached === 22 && ptsW === 28, 'attached=' + attached + ' passthrough=' + ptsW)
  }
}

/* ───────────────── S3：变异自证（隔离副本真改真跑） ───────────────── */
const MUTANTS = [
  // ① 外部级整个删掉（= 改动前的形态）：S2-C/S2-F/S2-H 必红（挂上数掉回 0），S1 的接线断言也红
  { id: 'no-weassist-tier', expect: ['S1', 'S2'], edit: (s) => s.replace('const ext = readWeAssetText(file, null, opts)', 'const ext = null') },
  // ② 只删第三级（效果自带子树）：effect.json 还能取回，但 material 取不到 ⇒ 全是空 pass
  { id: 'no-effect-subtree', expect: ['S1', 'S2'], edit: (s) => s.replace('out.push(d + r)', 'void 0') },
  // ③ 记账改回"静默 return"（= 旧实现的病）：S2-F/S2-H 的台账/日志判据必红。
  //    S1 **也**红：S1-8 那条结构判据就钉在同一个 `noteFxMiss('effect', …)` 调用上（实测确认）。
  { id: 'silent-miss', expect: ['S1', 'S2'], edit: (s) => s.replace(/    noteFxMiss\('effect', file, tried, opts\)\n/, '') },
  // ④(P-208 A1) passthrough 回落整个摘掉（回到 P-205 形态）：S2-PT1/PT3/PT5/PT6 必红（S2 组）。
  //    锚点用**整行**调用（`function fxMarkPassthrough(effect, opts) {` 声明行带 ` {` 尾，不会被命中）。
  { id: 'no-passthrough', expect: ['S2'], edit: (s) => s.replace(/^(\s*)fxMarkPassthrough\(effect, opts\)$/gm, '$1void 0') },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== S3 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-fxfallback-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('S3 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(S\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('S3 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n' + (fail ? '✗ FAIL' : '✓ PASS') + ' effect-json-fallback-test: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

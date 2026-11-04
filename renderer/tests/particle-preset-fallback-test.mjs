// particle-preset-fallback-test.mjs — Q5（用户第 17 项）"粒子默认开 + 官方预设兜底"回归
//
// 覆盖四件事（全部无浏览器、无 GL、默认 <2s）：
//   ① demo.html 内联的「官方粒子预设 basename 索引」与磁盘 `wallpaper_engine/assets/presets/**/particles/presets/*.json` 同步
//      （生成器 gen-particle-index.mjs 的 --check 逻辑，这里直接 import 复用）。
//   ② 语料里**真实存在**的 25 个"包内没有定义"的 ref（32 层，见 docs/PARTICLE-RESEARCH.md §1）逐个走
//      `particleDefCandidates()`：15 个 ref（22 层）必须命中官方预设且文件真的在磁盘上；剩下 10 个必须**恰好**
//      等于已知不可解清单（工坊私有 + 只在 assets/scenes 下的 new_particle_system）——不多不少，防"猜错路径"。
//   ③ 命中得到的 def 必须能被真实 bundle 建系 + 模拟出粒子（`buildParticleSystem` + `simulateParticleSystem`，alive>0）。
//   ④ `hideParticles` 默认值：从 demo.html 抽出两处表达式求值（不带参数 = 粒子开；`?noparticles` / `?np` = 关），
//      并用真实 bundle 的 `applyRenderConfig` 断言 hideParticles=false 时粒子层保持可见（真包 3544152633，16 个粒子层）。
//
// 用法:
//   node particle-preset-fallback-test.mjs              # 快跑（用下面冻结的 25 ref 清单）
//   node particle-preset-fallback-test.mjs --scan-corpus  # 重新全语料扫描（~25s，读 ~4GB mpkg）自证清单未过期
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { buildIndex, parseInlineIndex, DEFAULT_ASSETS } from './gen-particle-index.mjs'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'

const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
const WE_ASSETS = process.env.WE_ASSETS || DEFAULT_ASSETS
const checks = []
const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── ② 冻结清单：25 个 defMissing ref → 层数（来源：docs/PARTICLE-RESEARCH.md §1；扫描脚本见 --scan-corpus） ──
const MISSING_REFS = {
  'particles/new_particle_system.json': 1,
  'particles/presets/ash.json': 1,
  'particles/presets/dust_motes_0.json': 1,
  'particles/presets/ember.json': 3,
  'particles/presets/ember_beams.json': 1,
  'particles/presets/fireflies.json': 1,
  'particles/presets/fog1.json': 3,
  'particles/presets/fog2.json': 1,
  'particles/presets/leaves1.json': 1,
  'particles/presets/leaves5.json': 3,
  'particles/presets/rain_screen.json': 1,
  'particles/presets/rainperspective.json': 1,
  'particles/presets/snowflat.json': 1,
  'particles/presets/trail_1.json': 2,
  'particles/workshop/2093672045/Cherry_Blossoms_2.json': 1,
  'particles/workshop/2097513175/Stars.json': 1,
  'particles/workshop/2491377235/presets/dust_motes_0.json': 1,
  'particles/workshop/2562725207/Shooting_Star_01.json': 1,
  'particles/workshop/2562725207/Star_01.json': 1,
  'particles/workshop/2562725207/Star_02.json': 1,
  'particles/workshop/2562725207/Star_03.json': 1,
  'particles/workshop/2562725207/Star_04.json': 1,
  'particles/workshop/2562725207/Star_05.json': 1,
  'particles/workshop/2562725207/Star_06.json': 1,
  'particles/workshop/3550583533/presets/trail_1.json': 1,
}
// 官方资产里确实没有（工坊私有 id；new_particle_system 只在 assets/scenes/particleelementpreviews/** 下有 40+ 份
// 互不相同的编辑器预览副本 → basename 歧义，按"宁缺勿错"不收录）
const KNOWN_UNRESOLVED = [
  'particles/new_particle_system.json',
  'particles/workshop/2093672045/Cherry_Blossoms_2.json',
  'particles/workshop/2097513175/Stars.json',
  'particles/workshop/2562725207/Shooting_Star_01.json',
  'particles/workshop/2562725207/Star_01.json',
  'particles/workshop/2562725207/Star_02.json',
  'particles/workshop/2562725207/Star_03.json',
  'particles/workshop/2562725207/Star_04.json',
  'particles/workshop/2562725207/Star_05.json',
  'particles/workshop/2562725207/Star_06.json',
]

// ── 被 demo.html 直接引用的两个纯函数（切片运行，改坏即红）──────────────
function sliceFn(src, header) {
  const i = src.indexOf(header)
  if (i < 0) throw new Error('切片起点未找到（demo.html 结构变了？）：' + header)
  let j = src.indexOf('{', i), depth = 0
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(i, j + 1)
}
const IDX_DECL_SRC = (() => {
  const i = HTML.indexOf('const PARTICLE_PRESET_INDEX = {')
  const j = HTML.indexOf('/* PARTICLE-INDEX-END */')
  if (i < 0 || j < i) throw new Error('demo.html 里找不到 PARTICLE_PRESET_INDEX 块')
  return HTML.slice(i, HTML.indexOf('}', j) + 1)
})()
const IDX_OBJ_SRC = IDX_DECL_SRC.replace(/^const PARTICLE_PRESET_INDEX = /, '')
const CAND_SRC = sliceFn(HTML, 'const particleDefCandidates = (path) =>')
const RESOLVE_SRC = sliceFn(HTML, 'async function resolveParticleDefs() {')
// 真实源码切片：候选链（注入索引对象）
const cands = new Function('PARTICLE_PRESET_INDEX', 'path', CAND_SRC + '\nreturn particleDefCandidates(path)')

console.log('[T1] demo.html 内联索引 ↔ 磁盘 `assets/presets/**/particles/presets/*.json`')
{
  const { index, skipped, stats } = buildIndex(WE_ASSETS)
  const inline = parseInlineIndex(HTML)
  push('T1a 索引块可解析（' + Object.keys(inline).length + ' 条）', inline && Object.keys(inline).length > 0, String(Object.keys(inline || {}).length))
  push('T1b 与磁盘逐条一致（' + stats.entries + ' 条：直接层 ' + stats.direct + ' + 嵌套唯一 ' + stats.nested + '；放弃 ' + skipped.length + '）',
    eq(Object.keys(index).sort(), Object.keys(inline).sort()) && Object.keys(index).every((k) => index[k] === inline[k]) && skipped.length === 0,
    'added=' + Object.keys(index).filter((k) => !(k in inline)).join(',') + ' removed=' + Object.keys(inline).filter((k) => !(k in index)).join(','))
  push('T1c 每条映射的文件都真实存在', Object.keys(index).every((k) => fs.existsSync(path.join(WE_ASSETS, index[k]))), 'n=' + stats.entries)
  push('T1d 重名且有歧义的 basename 不收录（当前语料 0 条）', skipped.every((s) => /不一致|歧义/.test(s.reason)), JSON.stringify(skipped.slice(0, 3)))
}

console.log('\n[T2] 真实语料的 25 个 defMissing ref（32 层）逐个走候选链')
let hitRefs = 0, hitLayers = 0, missRefs = []
{
  const inlineIdx = parseInlineIndex(HTML)
  const uniq = Object.keys(MISSING_REFS).sort()
  push('T2a 冻结清单 25 个 ref / ' + Object.values(MISSING_REFS).reduce((a, b) => a + b, 0) + ' 层',
    uniq.length === 25 && Object.values(MISSING_REFS).reduce((a, b) => a + b, 0) === 32, uniq.length + ' refs')
  const probe = new Function('return ' + IDX_OBJ_SRC) // 语法自检：对象字面量可独立求值
  push('T2b 索引切片可独立运行（对象字面量闭合）', Object.keys(probe()).length === 118, 'n=' + Object.keys(probe()).length)
  for (const ref of uniq) {
    const list = cands(inlineIdx, ref)
    push('T2c ' + ref + ' → 候选 ' + list.length, list.length === 1 || list.length === 2, JSON.stringify(list))
    if (list.length === 2) {
      const fp = path.join(WE_ASSETS, list[1].replace(/^\/weassist\//, ''))
      if (!fs.existsSync(fp)) { push('T2d ' + ref + ' 索引目标存在', false, fp); continue }
      hitRefs++; hitLayers += MISSING_REFS[ref]
    } else missRefs.push(ref)
  }
  push('T2e 官方预设兜底命中 ' + hitRefs + '/25 ref（' + hitLayers + '/32 层）', hitRefs === 15 && hitLayers === 22, hitRefs + ' refs / ' + hitLayers + ' layers')
  push('T2f 未命中清单 == 已知不可解（工坊私有 + 歧义）', eq(missRefs.sort(), [...KNOWN_UNRESOLVED].sort()),
    'miss=' + missRefs.length + ' ' + JSON.stringify(missRefs.slice(0, 3)))
}

console.log('\n[T3] 命中 def 能被真实 bundle 建系并模拟出粒子（alive>0；官方预设 starttime 最大 15s → 模拟到 t=20s）')
{
  const inline = parseInlineIndex(HTML)
  let okN = 0, zeroN = 0, bad = []
  const evidence = []
  for (const ref of Object.keys(MISSING_REFS)) {
    const base = ref.split('/').pop()
    const rel = inline[base]
    if (!rel) continue
    let def
    try { def = JSON.parse(fs.readFileSync(path.join(WE_ASSETS, rel), 'utf8')) } catch (e) { bad.push(ref + ':read ' + e.message); continue }
    try {
      const sys = lib.buildParticleSystem(def, { origin: [0, 0, 0], scale: [1, 1, 1], angle: 0, alphaMul: 1, seedStr: base })
      lib.simulateParticleSystem(sys, 20)
      const alive = sys.count || 0                       // bundle 的活粒子计数（死亡的粒子会 splice 掉）
      evidence.push(base + '=' + alive + '(start' + (def.starttime || 0) + 's)')
      if (alive > 0) okN++; else { zeroN++; bad.push(ref + ':alive=0') }
    } catch (e) { bad.push(ref + ':sim ' + e.message) }
  }
  push('T3a 15 个命中预设全部 alive>0（模拟 t=20s）', okN === 15 && zeroN === 0, 'alive>0: ' + okN + ' zero: ' + zeroN + (bad.length ? ' bad=' + JSON.stringify(bad.slice(0, 3)) : ''))
  // 逐条列出（人读证据：这些就是"恢复出来的层" + 模拟出的活粒子数）
  console.log('    ' + evidence.join('  '))
  console.log('    ' + Object.keys(MISSING_REFS).filter((r) => inline[r.split('/').pop()]).map((r) => r.split('/').pop() + '→' + inline[r.split('/').pop()]).join('\n    '))
}

console.log('\n[T4] resolveParticleDefs 异步兜底（切片运行 + 桩 fetch / 桩 scene）')
{
  const api = new Function('scene', 'logf', 'window', 'fetch',
    IDX_DECL_SRC + '\n' + CAND_SRC + '\n' + RESOLVE_SRC + '\nreturn resolveParticleDefs()')
  const mkScene = () => ({ layers: [
    { id: 1, name: 'ok-index', particle: 'particles/presets/trail_1.json', particleDef: null },
    { id: 2, name: 'ok-path', particle: 'particles/known/special.json', particleDef: null },
    { id: 3, name: 'gone', particle: 'particles/workshop/999/Star_01.json', particleDef: null },
    { id: 4, name: 'inline', particle: { emitter: [] }, particleDef: { emitter: [] } },
  ] })
  const served = { '/weassist/particles/known/special.json': { emitter: [{ name: 'sphererandom' }] } }
  const inline = parseInlineIndex(HTML)
  const fetchStub = async (u) => {
    if (served[u]) return { ok: true, json: async () => served[u] }
    if (/^\/weassist\/presets\/interactive\/particles\/presets\/trail_1\.json$/.test(u)) {
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(WE_ASSETS, inline['trail_1.json']), 'utf8')) }
    }
    return { ok: false, json: async () => null }
  }
  const logs = []
  const sc = mkScene()
  const stat = await api(sc, (m) => logs.push(m), {}, fetchStub)
  push('T4a 索引命中层拿到 def（source=preset-index）', !!sc.layers[0].particleDef && sc.layers[0].particleDefSource === 'preset-index', sc.layers[0].particleDefSource)
  push('T4b /weassist 直读层拿到 def（source=weassist）', !!sc.layers[1].particleDef && sc.layers[1].particleDefSource === 'weassist', sc.layers[1].particleDefSource)
  push('T4c 真·缺失层保持 null（不抛）', sc.layers[2].particleDef === null, String(sc.layers[2].particleDef))
  push('T4d 内联对象层不被触碰', sc.layers[3].particleDefSource === undefined)
  push('T4e 统计 = miss 3 / viaPath 1 / viaIndex 1', stat.miss === 3 && stat.viaPath === 1 && stat.viaIndex === 1, JSON.stringify(stat))
  push('T4f 日志给出"包内缺失 N 层 → 补回 M 层"', logs.some((l) => /Q5 粒子定义兜底：包内缺失 3 层 → 官方资产补回 2 层/.test(l)), logs[0])
  push("T4g 候选链含 /weassist 直读 + 索引两级", JSON.stringify(cands(inline, "particles/presets/fog1.json")) === JSON.stringify(['/weassist/particles/presets/fog1.json', '/weassist/presets/fog/particles/presets/fog1.json']),
    JSON.stringify(cands(inline, 'particles/presets/fog1.json')))
  push('T4h 无索引命中的 ref → 只有一级候选', JSON.stringify(cands(inline, 'particles/workshop/999/x.json')) === JSON.stringify(['/weassist/particles/workshop/999/x.json']))
  push('T4i 空/非法输入 → 空候选（不抛）', eq(cands(inline, ''), []) && eq(cands(inline, null), []))

  // ── 材质兜底（没有它 = 有 def 无贴图 = renderParticleLayer 静默 return，粒子照样不出现）──
  const MAT_SRC = sliceFn(HTML, 'function particleMaterialCandidates(layer) {')
  const matCands = new Function('layer', MAT_SRC + '\nreturn particleMaterialCandidates(layer)')
  const lIdx = sc.layers[0]                                             // 索引命中层（T4a 已断言有 def）
  push('T4j 索引命中层记下 particleDefRel', lIdx.particleDefRel === 'presets/interactive/particles/presets/trail_1.json', String(lIdx.particleDefRel))
  const matList = matCands(lIdx)
  push('T4k 材质候选 = /weassist 直读 + 官方预设同主题路径', eq(matList, ['/weassist/materials/presets/trail_1.json', '/weassist/presets/interactive/materials/presets/trail_1.json']), JSON.stringify(matList))
  push('T4l 无 particleDefRel 的层只有旧口径一级', eq(matCands({ particleDef: { material: 'materials/particle/halo.json' } }), ['/weassist/materials/particle/halo.json']))
  push('T4m 无 material → 空候选（不抛）', eq(matCands({ particleDef: {} }), []) && eq(matCands(null), []))
  // 15 个命中预设：材质 json 与贴图 .tex 都必须真实存在（否则"有 def"不等于"画得出来"）
  let matOk = 0, texOk = 0, matBad = []
  for (const ref of Object.keys(MISSING_REFS)) {
    const base = ref.split('/').pop()
    const rel = inline[base]
    if (!rel) continue
    const def = JSON.parse(fs.readFileSync(path.join(WE_ASSETS, rel), 'utf8'))
    const cands2 = matCands({ particleDef: def, particleDefRel: rel }).map((u) => u.replace(/^\/weassist\//, ''))
    const hit = cands2.find((c) => fs.existsSync(path.join(WE_ASSETS, c)))
    if (hit) matOk++; else { matBad.push(base); continue }
    const mj = JSON.parse(fs.readFileSync(path.join(WE_ASSETS, hit), 'utf8'))
    const tex = mj.passes && mj.passes[0] && mj.passes[0].textures && mj.passes[0].textures[0]
    const tf = tex ? path.join(WE_ASSETS, 'materials', String(tex).replace(/^materials\//, '') + '.tex') : null
    if (tf && fs.existsSync(tf)) texOk++; else matBad.push(base + ':tex')
  }
  push('T4n 15/15 材质 json 在官方预设同主题目录命中', matOk === 15, 'mat=' + matOk + ' bad=' + JSON.stringify(matBad.slice(0, 3)))
  push('T4o 15/15 材质贴图在 assets/materials/** 命中（loadTex 的 /weassist 兜底可达）', texOk === 15, 'tex=' + texOk)
}

console.log('\n[T5] 粒子默认开（第 17 项根因①）：demo.html 两处 hideParticles 表达式真值表')
{
  const exprs = [...HTML.matchAll(/hideParticles:\s*([^,\n]+),/g)].map((m) => m[1])
  push('T5a demo.html 有 2 处 hideParticles（applyRenderConfig + createRenderer 死键同口径）', exprs.length === 2, exprs.length + ' 处')
  const evalOne = (expr, search) => new Function('location', 'URLSearchParams', 'return (' + expr + ')')({ search }, URLSearchParams)
  for (const [label, q, want] of [['不带参数', '', false], ['?noparticles', '?noparticles', true], ['?np（历史别名）', '?np', true], ['?showui', '?showui', false], ['?noparticles&showui', '?noparticles&showui', true]]) {
    const vals = exprs.map((e) => evalOne(e, q))
    push('T5b ' + label + ' → 隐藏粒子 = ' + want, vals.every((v) => v === want), JSON.stringify(vals))
  }
  // 真实 bundle 契约：hideParticles=false → 粒子层保持可见（真包 3544152633，16 个粒子层）
  const PKG = `${MPW_WS}/allwallpaper/dd/3544152633/scene.pkg`
  if (!fs.existsSync(PKG)) console.log('SKIP T5c 语料包不在：' + PKG)
  else {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
    const sceneJson = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    const rdD = (p) => { const e = lib.getEntry(pkg, p); return e ? JSON.parse(new TextDecoder().decode(e)) : null }
    const on = lib.parseScene(sceneJson, null, { readParticleDef: rdD })
    lib.applyRenderConfig(on, { sceneId: '3544152633', anchor: 'refcenter', hideParticles: false, hideUI: true, clearBgFx: true, log: () => {} })
    const withDef = on.layers.filter((l) => l.particleDef).length
    const visOn = on.layers.filter((l) => l.particle && l.visible !== false).length
    const off = lib.parseScene(sceneJson, null, { readParticleDef: rdD })
    lib.applyRenderConfig(off, { sceneId: '3544152633', anchor: 'refcenter', hideParticles: true, hideUI: true, clearBgFx: true, log: () => {} })
    const visOff = off.layers.filter((l) => l.particle && l.visible !== false).length
    push('T5c hideParticles=false → ' + visOn + '/16 粒子层可见（旧默认全 0）', withDef === 16 && visOn === 16, 'defs=' + withDef + ' visible=' + visOn)
    push('T5d hideParticles=true → 0/16 可见（?noparticles 仍能全关）', visOff === 0, 'visible=' + visOff)
  }
}

// ── 可选：全语料重扫（--scan-corpus，~25s；自证上面冻结清单没过期）────────────
if (process.argv.includes('--scan-corpus')) {
  console.log('\n[SCAN] 全语料重扫（--scan-corpus）：25 ref / 32 层是否仍然成立')
  const dec = new TextDecoder()
  const pkgs = []
  const walk = (d, depth) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) { if (depth < 3) walk(fp, depth + 1) }
      else if (/\.(pkg|mpkg)$/.test(e.name)) pkgs.push(fp)
    }
  }
  walk(`${MPW_WS}/allwallpaper`, 0)
  walk(MPW_PLUGIN_CACHE, 0)
  const found = {}
  let layers = 0
  for (const fp of pkgs) {
    let pkg
    try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(fp))) } catch { continue }
    const e = lib.getEntry(pkg, 'scene.json')
    if (!e) continue
    let obj
    try { obj = JSON.parse(dec.decode(e).replace(/^\uFEFF/, '')) } catch { continue }
    for (const o of (obj.objects || [])) {
      if (!o.particle || typeof o.particle !== 'string') continue
      layers++
      if (lib.getEntry(pkg, o.particle)) continue
      found[o.particle] = (found[o.particle] || 0) + 1
    }
  }
  const norm = (m) => JSON.stringify(Object.fromEntries(Object.entries(m).filter(([, v]) => v > 0).sort()))
  push('SCAN 粒子层总数 153 / defMissing 32 层', layers === 153 && Object.values(found).reduce((a, b) => a + b, 0) === 32, layers + ' layers')
  push('SCAN defMissing ref 集合与冻结清单一致', norm(found) === norm(MISSING_REFS),
    'refs=' + Object.keys(found).length + ' diff=' + JSON.stringify(Object.keys(found).filter((k) => !(k in MISSING_REFS))))
  console.log('    包裹的 ' + pkgs.length + ' 个容器已扫（' + layers + ' 粒子层）')
}

let pass = 0
for (const c of checks) { console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail !== undefined ? '  — ' + c.detail : ''}`); if (c.ok) pass++ }
console.log(`\n${pass}/${checks.length} 通过（Q5 粒子默认开 + 官方预设兜底）`)
process.exit(pass === checks.length ? 0 : 1)

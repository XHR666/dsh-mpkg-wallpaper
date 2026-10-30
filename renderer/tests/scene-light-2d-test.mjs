// scene-light-2d-test.mjs — P-208 B1（P-213 号）2D 光照模型（RE-43 路径A）+ light 层 schema 判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-43）：
//   · 判别键 `"light":"lpoint"|"ldirectional"`（`lighttype` 官方 0 命中）；字段 color/intensity/radius/
//     origin/angles(+density/exponent/volumetricsexponent/castshadow/cascadedistance0..2)；
//   · 路径A（2D generic 四灯模型）：`g_LightsColorRadius[4]`(vec4: rgb+radius) / `g_LightsPosition[4]`(vec3) /
//     `g_LightAmbientColor` / `g_LightSkylightColor` / `g_Light`；衰减 attn=saturate((radius−dist)/radius)
//     **应用时平方**；intensity **平方**进入（RE-43 路径B/C "intensity² 进 color.w"）；至多 4 盏。
//   · light 层不参与 draw（官方 = 光源不计 draw）。
// 语料影响面（本轮实测）：3 包 4 个 light 层 / 2 包 3 层 castshadow:true / 11 包 20 层 shape:"quad"。
//
// 判据分层（全部离线）：
//   L1 schema：真包 0923/3589454154（lpoint+ldirectional 全字段）+ 官方 modeleditor/scene.json
//     （2 个 lpoint，intensity 6/5、radius 150/50）逐项断言；light 层进 `scene.lights` 且 **solid 口径排除**。
//   L2 分支表（纯函数）：距离 0⁺/半径处/超半径、g_Light=0/0.5/1、法线朝向（背向仍有 rim）、
//     intensity²（线性 ⇒ 红）、ambientMix 两极。
//   L3 不产生 draw：light 层无 image/particle/text/sound ⇒ 宿主链没有可画来源；solid=false ⇒
//     renderLayer 在 `!layer.solid && !texObj` 处提前 return（源码锚点）。
//   L4 uniform 组装：可见灯取前 4、invisible 跳过、无灯场景全 0（零视觉差）、?lights=legacy ⇒ null。
//   L5 变异自证：衰减去平方 / intensity 改线性 ⇒ L2 红（隔离副本真改真跑）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
const MPW_WS = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_WS, 'allwallpaper')
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

console.log('== B1 2D 光照模型（RE-43 路径A）+ light 层 schema ==')

/* ── L1 schema（真包 + 官方样例） ── */
{
  const f = path.join(CORPUS, '0923/3589454154/scene.pkg')
  if (!exists(f)) { check('L1 真包 schema', false, '语料缺失: ' + f) }
  else {
    const pkg = openPkgLazy(f)
    const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(f)), null, {})
    const li = scene.lights
    check('L1a 3589454154：2 个 light 层进 scene.lights（lpoint + ldirectional）',
      li.length === 2 && li.some((x) => x.type === 'lpoint') && li.some((x) => x.type === 'ldirectional'),
      JSON.stringify(li.map((x) => x.type)))
    const lp = li.find((x) => x.type === 'lpoint')
    const ld = li.find((x) => x.type === 'ldirectional')
    check('L1b lpoint 字段逐项（intensity=6 radius=100 density=2 exponent=2 castshadow=true volumetricsexponent=1）',
      lp && lp.intensity === 6 && lp.radius === 100 && lp.density === 2 && lp.exponent === 2 &&
      lp.castshadow === true && lp.volumetricsexponent === 1 && lp.visible === false, JSON.stringify(lp))
    check('L1c ldirectional 字段逐项（cascadedistance0/1/2 = 0.3/0.4/8、intensity=5 radius=200 exponent=0.1）',
      ld && near(ld.cascadedistance0, 0.30000001) && near(ld.cascadedistance1, 0.40000001) && ld.cascadedistance2 === 8 &&
      ld.intensity === 5 && ld.radius === 200 && near(ld.exponent, 0.1), JSON.stringify(ld && { cd: [ld.cascadedistance0, ld.cascadedistance1, ld.cascadedistance2] }))
    const layerOf = scene.layers.find((l) => l.id === lp.id)
    check('L1d light 层描述符：layer.light=类型、solid=false（不再算纯色层）、无 image/particle/text',
      layerOf && layerOf.light === 'lpoint' && layerOf.solid === false && layerOf.image === null &&
      layerOf.particle === null && !layerOf.__text, JSON.stringify({ light: layerOf.light, solid: layerOf.solid }))
    check('L1e srcStats.light 计数（solid 口径排除 light 层）',
      scene.__srcStats.light === 2, JSON.stringify({ light: scene.__srcStats.light, solid: scene.__srcStats.solid }))
  }
  const of_ = path.join(WS, 'wallpaper_engine/assets/scenes/modeleditor/scene.json')
  if (!exists(of_)) { check('L1f 官方 modeleditor 样例', false, '资产缺失: ' + of_) }
  else {
    const scene = lib.parseScene(JSON.parse(fs.readFileSync(of_, 'utf8')), null, {})
    check('L1f 官方 modeleditor：2 个 lpoint（intensity 6/5、radius 150/50）+ ambient/skylight 进 uniform 组',
      scene.lights.length === 2 && scene.lights.every((x) => x.type === 'lpoint') &&
      scene.lights[0].intensity === 6 && scene.lights[0].radius === 150 &&
      scene.lights[1].intensity === 5 && scene.lights[1].radius === 50,
      JSON.stringify(scene.lights.map((x) => [x.intensity, x.radius])))
    const u = lib.computeLight2DUniforms(scene.lights, scene.general)
    check('L1g 官方样例 uniform 组：ambient=(0.4,0.4,0.4) skylight=(0.3,0.3,0.3)、count=2、intensity² 预乘（color 0.63137 × 6² = 22.729）',
      u.count === 2 && near(u.ambientColor[0], 0.4) && near(u.skylightColor[0], 0.3) &&
      near(u.colorRadius[0], 0.63137 * 36, 1e-4) && u.colorRadius[3] === 150,
      JSON.stringify({ count: u.count, ambient: u.ambientColor, c0: u.colorRadius[0] }))
  }
}

/* ── L2 分支表（纯函数） ── */
{
  const C = [1, 0.5, 0.25]
  // 距离 0⁺ / 半径处 / 超半径（gLight=0、metallic=0、specular 关）
  const p = (dist) => lib.computeLightSpecular2D([0, 1, 0], [0, dist, 0], C, 100, [0, 0, 1], 2, 0, 0, 0)
  check('L2a dist→0⁺ ⇒ attn→1（全强度）', near(p(1e-6).light[0], C[0], 1e-6), JSON.stringify(p(1e-6).light))
  check('L2b dist=radius ⇒ attn=0 ⇒ 零贡献', p(100).light.every((x) => x === 0) && p(100).specular.every((x) => x === 0), '')
  check('L2c dist>radius ⇒ 零贡献（负 attn 被 saturate 钳 0）', p(150).light.every((x) => x === 0), '')
  // g_Light 混合：0=真 Lambert、1=Half Lambert（光从背面斜照 ⇒ lightDotRaw<0 时三档分开）
  const g = (gl) => lib.computeLightSpecular2D([0, 1, 0], [0, -10, 50], C, 100, [0, 0, 1], 2, 0, gl, 0).light[0]
  check('L2d g_Light=0 ⇒ 真 Lambert（背光侧漫反射 = 0，metallic=0 ⇒ rim=0）', g(0) === 0, 'v=' + g(0))
  check('L2e g_Light=1 ⇒ Half Lambert（背光侧仍有漫反射贡献）', g(1) > 0, 'v=' + g(1).toFixed(4))
  check('L2f g_Light=0.5 ⇒ 介于两者之间', g(0.5) > g(0) && g(0.5) < g(1), 'v=' + g(0.5).toFixed(4))
  // 法线朝向：背向视线的面上 rim 仍可 > 0（metallic>0）
  const rimOn = lib.computeLightSpecular2D([0, 1, 0], [0, 50, 0], C, 100, [0, 0, 1], 2, 0, 0, 1)
  const rimOff = lib.computeLightSpecular2D([0, 1, 0], [0, 50, 0], C, 100, [0, 0, 1], 2, 0, 0, 0)
  check('L2g 背向视线的面：metallic=1 的 rim 贡献 > metallic=0', rimOn.light[0] > rimOff.light[0],
    JSON.stringify([rimOn.light[0].toFixed(4), rimOff.light[0].toFixed(4)]))
  // intensity²（判据钉死：线性 intensity ⇒ L2h 红）
  const mk = (it) => lib.computeLight2DUniforms([{ visible: true, intensity: it, radius: 100, origin: [0, 0, 0], color: [1, 0, 0] }], {}).colorRadius[0]
  check('L2h intensity² 语义：intensity=2 ⇒ 预乘 4（线性会是 2）', mk(2) === 4, 'v=' + mk(2))
  // 简版模型 + 环境光
  const cl = lib.computeLight2D([0, 50, 0], [0, 1, 0], C, 100)
  check('L2i ComputeLight 简版：对齐光 50/100 ⇒ attn=(0.5)²=0.25', near(cl[0], C[0] * 0.25, 1e-9), 'v=' + cl[0])
  // 衰减平方的**绝对值**判据（线性衰减会给出 0.5 ⇒ 红；这是"去平方"变异的主钉子）
  const sq = lib.computeLightSpecular2D([0, 1, 0], [0, 50, 0], C, 100, [0, 0, 1], 2, 0, 1, 0).light[0]
  check('L2k dist=radius/2 ⇒ 贡献 = (lightDot+rim)·attn² = 1·0.25（衰减平方，不是线性 0.5）', near(sq, C[0] * 0.25, 1e-9), 'v=' + sq)
  const am = lib.ambientMix2D([0, 0, 0], [1, 1, 1], 1)
  const am2 = lib.ambientMix2D([0, 0, 0], [1, 1, 1], -1)
  const am3 = lib.ambientMix2D([1, 0, 0], [0, 1, 0], 0)
  check('L2j ambientMix：ny=1 ⇒ ambient、ny=-1 ⇒ skylight、ny=0 ⇒ 各半',
    am[0] === 1 && am2[0] === 0 && near(am3[0], 0.5) && near(am3[1], 0.5), JSON.stringify([am[0], am2[0], am3[0]]))
}

/* ── L3 不产生 draw（源码锚点 + 描述符） ── */
{
  check('L3a renderLayer 对非 solid 且无纹理的层提前 return（light 层命中这条路）',
    /if \(!layer\.solid && !texObj\) return/.test(CORE_SRC), '')
  check('L3b light 层显式排除出 solid 口径（`!__lightType &&`）',
    /!__lightType && \/\/ ①\(P-213 B1\)/.test(CORE_SRC) || /!__lightType && \/\* ①\(P-213 B1\)|!__lightType &&/.test(CORE_SRC), '')
  check('L3c bindSystemUniforms 里声明才上传（setVal g_LightsColorRadius / g_LightsPosition）',
    CORE_SRC.includes("setVal(uni, 'g_LightsColorRadius'") && CORE_SRC.includes("setVal(uni, 'g_LightsPosition'"), '')
  check('L3d 洁净室 shader 头带 2D 光照函数（common_fragment.h；与官方 md5 不同是本仓红线）',
    fs.existsSync(path.join(ROOT, 'shaders', 'common_fragment.h')) &&
    fs.readFileSync(path.join(ROOT, 'shaders', 'common_fragment.h'), 'utf8').includes('ComputeLightSpecular2D'), '')
}

/* ── L4 uniform 组装（可见灯/上限/无灯/legacy） ── */
{
  const ls = [
    { visible: false, intensity: 9, radius: 50, origin: [1, 2, 3], color: [1, 1, 1] },
    { visible: true, intensity: 1, radius: 10, origin: [4, 5, 6], color: [1, 0, 0] },
    { visible: true, intensity: 1, radius: 20, origin: [7, 8, 9], color: [0, 1, 0] },
  ]
  const u = lib.computeLight2DUniforms(ls, {})
  check('L4a invisible 灯跳过、可见灯按序填槽', u.count === 2 && u.colorRadius[3] === 10 && u.colorRadius[7] === 20 &&
    u.position[0] === 4 && u.position[3] === 7, JSON.stringify({ count: u.count }))
  const many = []
  for (let i = 0; i < 6; i++) many.push({ visible: true, intensity: 1, radius: i + 1, origin: [0, 0, 0], color: [1, 1, 1] })
  check('L4b 4 盏上限（官方路径A数组=4）', lib.computeLight2DUniforms(many, {}).count === 4 &&
    lib.computeLight2DUniforms(many, {}).colorRadius[15] === 4, '')
  const none = lib.computeLight2DUniforms([], {})
  check('L4c 无灯场景全 0（= GL uniform 缺省 ⇒ 零视觉差）', none.count === 0 &&
    none.colorRadius.every((x) => x === 0) && none.position.every((x) => x === 0) &&
    none.ambientColor.every((x) => x === 0) && none.skylightColor.every((x) => x === 0), '')
  check('L4d ambient/skylight 缺省 (0,0,0)；写了按官方 3 分量解析',
    lib.computeLight2DUniforms([], { ambientcolor: '0.4 0.4 0.4', skylightcolor: '0.3 0.3 0.3' }).ambientColor[0] === 0.4, '')
  check('L4e ?lights=legacy ⇒ null（整条关闭）', lib.computeLight2DUniforms(ls, {}) !== null &&
    lib.lightsLegacy('?lights=legacy') === true && lib.lightsLegacy('') === false, '')
  check('L4f castshadow 只记录不实现（castShadowLights 计数 + castvolumetrics/lightsourcesize 字段保留）',
    lib.computeLight2DUniforms([{ visible: true, castshadow: true, castvolumetrics: false, lightsourcesize: null }], {}).castShadowLights === 1, '')
}

/* ── L5 变异自证（隔离 core/ 副本真改真跑） ── */
const MUTANTS = [
  // ① 衰减改线性（去掉平方）：L2a/L2b/L2i 红（L2 组）
  { id: 'linear-attn', expect: ['L2'], edit: (s) => s.replace('const k = (__lsat(lightDot) + rim) * attn * attn', 'const k = (__lsat(lightDot) + rim) * attn') },
  // ② intensity 改线性（预乘 it 而不是 it²）：L2h 红（L2 组）
  { id: 'linear-intensity', expect: ['L1', 'L2'], edit: (s) => s.replace('const it2 = it * it   // intensity²（线性 ⇒ 判据红）', 'const it2 = it') },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== L5 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-light2d-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('L5 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(L\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('L5 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  check('L5 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== scene-light-2d: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
// shadow-interface-test.mjs — S4 B3② 阴影矩阵接口判据（RE-43 (3)；规则 B：接口先行、行为默认关）。
//
// 官方依据：`shadowcaster.vert:9,104`（gl_InstanceID 索引 g_ViewportViewProjectionMatrices[6]）、
// 点光 cube 6 面（_rt_shadowAtlas 2×3）、方向光 3 级级联（GetCascadeConfigs = lightCascadeConfigs）、
// GetShadowResolution 256/512/1024。**投影/采样未做**（缺真机帧）——只建通路 + 台账。
//
// 判据：①真包 0923/3589454154 的 light 层（lpoint+ldirectional 都 castshadow）⇒ 点光 6 矩阵 /
// 方向 3 矩阵 + cascade 换算 + uniform 名表 + RT 名；②默认 legacy ⇒ null（零变化快照）；
// ③notImplemented 计数在台账；④变异：默认翻成开 ⇒ ②必红。
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
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== S4 阴影矩阵接口（B3②）==')

/* S1 真包 light 层 → 接口形状 */
{
  const f = path.join(MPW_WS, 'allwallpaper/0923/3589454154/scene.pkg')
  if (!fs.existsSync(f)) { check('S1 真包', false, '语料缺失: ' + f) }
  else {
    const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(f)), null, {})
    const iface = lib.buildShadowInterface(scene.lights, '?shadows=force')
    check('S1a force ⇒ 接口非 null、RT=_rt_shadowAtlas、统一名表含 g_ViewportViewProjectionMatrices',
      !!iface && iface.rt === '_rt_shadowAtlas' && iface.uniformNames.includes('g_ViewportViewProjectionMatrices'),
      JSON.stringify(iface && { n: iface.lights.length, mpl: iface.matricesPerLight }))
    const lp = iface && iface.lights.find((x) => x.type === 'lpoint')
    const ld = iface && iface.lights.find((x) => x.type === 'ldirectional')
    check('S1b 点光 6 矩阵 / 方向光 3 矩阵（官方 cube/级联口径）',
      lp && lp.matrixCount === 6 && ld && ld.matrixCount === 3,
      JSON.stringify(iface && iface.lights.map((x) => [x.type, x.matrixCount])))
    check('S1c 矩阵为 4×4 数组（16 元素；占位单位阵——投影未做）',
      lp && lp.matrices.every((m) => m.length === 16), '')
    check('S1d 方向光带级联换算（0.3/0.4/8 ⇒ 末位 12）',
      ld && ld.cascade && Math.abs(ld.cascade[5] - 12) < 1e-6, JSON.stringify(ld && ld.cascade))
    check('S1e 分辨率档 512（质量档 2）', lp && lp.resolution === 512, '')
    check('S1f 点光/方向光各自的 uniform 名表',
      lp && lp.uniformNames.includes('g_LFeature_ShadowPointProjection') &&
      ld && ld.uniformNames.includes('g_LFeature_ShadowProjection'), '')
  }
}

/* S2 默认 legacy ⇒ null（零变化）+ 台账 */
{
  const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(path.join(MPW_WS, 'allwallpaper/0923/3589454154/scene.pkg'))), null, {})
  check('S2a 默认（legacy）⇒ null（不生成不上传）', lib.buildShadowInterface(scene.lights) === null, '')
  check('S2b legacy 判定可显式喂（?shadows=force 才开）',
    lib.shadowsLegacy('?shadows=force') === false && lib.shadowsLegacy('') === true && lib.shadowsLegacy(undefined) === true, '')
  check('S2c 台账 `__mpwShadows.notImplemented` 在位', /__mpwShadows/.test(CORE_SRC) && /notImplemented: true/.test(CORE_SRC), '')
  const noShadow = lib.parseScene({ objects: [{ id: 1, image: 'models/util/solidlayer.json' }] }, null, {})
  check('S2d 无 castshadow 层 ⇒ force 也 null', lib.buildShadowInterface(noShadow.lights, '?shadows=force') === null, '')
}

/* S3 变异自证：默认翻成开 ⇒ S2a 必红 */
const MUTANTS = [
  { id: 'default-on', expect: ['S1', 'S2'],  /* 默认翻成开 ⇒ force 分支在真包上非 null ⇒ S1 也红（实测） */ edit: (s) => s.replace("return new URLSearchParams(String(search)).get('shadows') !== 'force'", "return new URLSearchParams(String(search)).get('shadows') !== 'legacy'") },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== S3 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-shadow-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('S3 ' + m.id + ' 变异真的改到了', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', maxBuffer: 32 << 20, input: '', env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT } })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(S\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('S3 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want), '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id)
  }
  check('S3 真树未触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('\n===== shadow-interface: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

// scene-fog-test.mjs — P-208 B2（P-214 号）雾：10 个 scene 字段 → 2×vec4 + 2×vec3 + 宏门控判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-51）：
//   · 场景字段键（exe strings:16371-16384）：fogdistancestart/end/startdensity/enddensity、
//     fogheightstart/end/startdensity/enddensity、fogdistancecolor、fogheightcolor（10 个）；
//   · uniform 分量语义：g_FogDistanceParams = (x:起始, y:范围=end−start, z:基础强度=startdensity,
//     w:二次系数=enddensity)，g_FogHeightParams 同构；CalculateFogPixelState = ((dist−x)/y, (h−x)/y)；
//     ApplyFog：先 HEIGHT 后 DIST 各自 mix(color, fogColor, z + w·t²)；ApplyFogAlpha = alpha·(1−factor²)，
//     factor = saturate(max(dist, height))；
//   · 宏门控：combo `FOG`（材质键 ui_editor_properties_fog，default=1）与 FOG_DIST/FOG_HEIGHT/FOG_COMPUTED；
//   · 官方样例 0 个写雾参数；本轮语料实测（121 容器）也是 0 ⇒ 缺省行为必须与改动前逐位一致。
//
// 判据分层（全部离线）：
//   F1 纯函数：10 字段 ⇒ 两组 vec4 逐分量（z/w 对调 ⇒ 红——变异主钉子）+ ApplyFog/ApplyFogAlpha 数值。
//   F2 门控与组装：无雾字段 ⇒ computeFogUniforms=null（不上传 = GL 缺省 0）；写了 ⇒ 4 uniform 齐；
//      ?fog=legacy ⇒ null；shaders/common_fog.h 洁净室头存在且含三函数；bindSystemUniforms 接线锚点。
//   F3 语料/官方读数：语料 0 场景写雾 ⇒ 缺省路径零视觉差（结构锚点 + 读数）。
//   F4 变异自证：z/w 分量对调 ⇒ F1 红；hasFog 恒 false ⇒ F2 红（隔离副本真改真跑）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const eq4 = (a, b, eps = 1e-9) => a.length === 4 && a.every((x, i) => near(x, b[i], eps))

console.log('== B2 雾：10 个 scene 字段 → 2×vec4 + 2×vec3（RE-51）==')

/* ── F1 纯函数 ── */
{
  const g = {
    fogdistancestart: 10, fogdistanceend: 60, fogdistancestartdensity: 0.2, fogdistanceenddensity: 0.8,
    fogheightstart: 5, fogheightend: 25, fogheightstartdensity: 0.1, fogheightenddensity: 0.9,
    fogdistancecolor: '0.7 0.8 0.9', fogheightcolor: '0.1 0.2 0.3',
  }
  const f = lib.parseFogFields(g)
  check('F1a 距离分量逐项：(start=10, 范围=50, 基础强度=0.2, 二次=0.8)',
    eq4(lib.fogDistanceParams(f), [10, 50, 0.2, 0.8]), JSON.stringify(lib.fogDistanceParams(f)))
  check('F1b 高度分量逐项：(5, 20, 0.1, 0.9)', eq4(lib.fogHeightParams(f), [5, 20, 0.1, 0.9]), JSON.stringify(lib.fogHeightParams(f)))
  check('F1c 颜色 3 分量解析（字符串 "r g b"）',
    near(f.distanceColor[0], 0.7) && near(f.heightColor[2], 0.3), JSON.stringify([f.distanceColor, f.heightColor]))
  const st = lib.calculateFogPixelState(35, 15, lib.fogDistanceParams(f), lib.fogHeightParams(f))
  check('F1d 像素状态：dist=35 ⇒ (35−10)/50=0.5；height=15 ⇒ (15−5)/20=0.5',
    near(st[0], 0.5) && near(st[1], 0.5), JSON.stringify(st))
  // ApplyFog：HEIGHT 先、DIST 后（t=0.5：dist 因子 = 0.2+0.8·0.25 = 0.4；height 因子 = 0.1+0.9·0.25 = 0.325）
  const rgb = lib.applyFog([0, 0, 0], st, lib.fogDistanceParams(f), f.distanceColor, lib.fogHeightParams(f), f.heightColor)
  const hK = 0.1 + 0.9 * 0.25, dK = 0.2 + 0.8 * 0.25
  const exp = [0, 0, 0].map((_, i) => {
    const a = 0 + (0.1 + 0 * (0.2 + 0)) // 占位（真实期望下面手算）
    return a
  })
  // 手算：HEIGHT 先：c1 = 0 + hColor·hK = (0.0325, 0.065, 0.0975)；DIST 后：c2 = c1 + (dColor−c1)·dK
  const c1 = [0.1 * hK, 0.2 * hK, 0.3 * hK]
  const c2 = c1.map((v, i) => v + (f.distanceColor[i] - v) * dK)
  check('F1e ApplyFog：先 HEIGHT 后 DIST（官方顺序）逐分量', rgb.every((x, i) => near(x, c2[i], 1e-9)),
    JSON.stringify({ got: rgb.map((x) => +x.toFixed(6)), want: c2.map((x) => +x.toFixed(6)) }))
  // ApplyFogAlpha：factor = max(0.4, 0.325) = 0.4 ⇒ alpha·(1−0.16)
  const al = lib.applyFogAlpha(1, st, lib.fogDistanceParams(f), lib.fogHeightParams(f))
  check('F1f ApplyFogAlpha：factor=max(0.4,0.325)=0.4 ⇒ alpha·(1−0.16)=0.84', near(al, 0.84, 1e-9), 'v=' + al)
  check('F1g 缺字段 ⇒ 0（部分声明的场景不 NaN）',
    eq4(lib.fogDistanceParams(lib.parseFogFields({ fogdistancestart: 5 })), [5, -5, 0, 0]), '')
}

/* ── F2 门控与组装 ── */
{
  const g = { fogdistancestart: 10, fogdistanceend: 60, fogdistancestartdensity: 0.2, fogdistanceenddensity: 0.8, fogdistancecolor: '0.7 0.8 0.9' }
  const u = lib.computeFogUniforms(g)
  check('F2a 写了雾字段 ⇒ 4 uniform 组齐且**逐分量**到值（10/50/0.2/0.8 —— z/w 对调 ⇒ 红）',
    !!u && u.distanceParams.length === 4 && u.heightParams.length === 4 && u.distanceColor.length === 3 && u.heightColor.length === 3 &&
    u.distanceParams[0] === 10 && u.distanceParams[1] === 50 && u.distanceParams[2] === 0.2 && u.distanceParams[3] === 0.8,
    JSON.stringify(u && u.distanceParams))
  check('F2b 高度组没写 ⇒ 全 0（不是 NaN/undefined）', u.heightParams.every((x) => x === 0) && u.heightColor.every((x) => x === 0), '')
  check('F2c 无雾字段 ⇒ null（不上传 = GL uniform 缺省 0 ⇒ 与改动前逐位一致）',
    lib.computeFogUniforms({}) === null && lib.computeFogUniforms(null) === null, '')
  check('F2d ?fog=legacy ⇒ null（整条关闭）', lib.fogLegacy('?fog=legacy') === true && lib.computeFogUniforms(g, '?fog=legacy') === null && lib.computeFogUniforms(g, '') !== null && lib.fogLegacy('') === false, '')
  check('F2e bindSystemUniforms 接线（g_FogDistanceParams/Color + g_FogHeightParams/Color 四个 setVal）',
    CORE_SRC.includes("setVal(uni, 'g_FogDistanceParams'") && CORE_SRC.includes("setVal(uni, 'g_FogDistanceColor'") &&
    CORE_SRC.includes("setVal(uni, 'g_FogHeightParams'") && CORE_SRC.includes("setVal(uni, 'g_FogHeightColor'"), '')
  const fogH = path.join(ROOT, 'shaders', 'common_fog.h')
  check('F2f 洁净室 shaders/common_fog.h 存在（CalculateFogPixelState/ApplyFog/ApplyFogAlpha 三函数齐）',
    fs.existsSync(fogH) && ['CalculateFogPixelState', 'ApplyFog', 'ApplyFogAlpha'].every((fn) => fs.readFileSync(fogH, 'utf8').includes(fn)), '')
}

/* ── F3 语料/官方读数 ── */
{
  check('F3a parseScene 把 general 原样带出（雾字段的解析走 parseFogFields，不动 general 本体）',
    CORE_SRC.includes('export function parseFogFields('), '')
  // 语料读数在文件头注明（121 容器 0 命中）；这里验证"无雾场景走缺省路径"的结构保证
  check('F3b renderScene 每帧组装雾 uniform（__fogUniforms 缓存在位）',
    CORE_SRC.includes('__fogUniforms = computeFogUniforms(scene.general)'), '')
}

/* ── F4 变异自证（隔离 core/ 副本真改真跑） ── */
const MUTANTS = [
  // ① z/w 分量对调（startdensity 与 enddensity 互换）：F1a/F1b 红（F1 组）
  { id: 'zw-swap', expect: ['F1', 'F2'],  /* F2a 逐分量钉着同一组 vec4 ⇒ 连带红 */ edit: (s) => s.replace('return [__fogNum(f && f.fogdistancestart), __fogNum(f && f.fogdistanceend) - __fogNum(f && f.fogdistancestart),\n    __fogNum(f && f.fogdistancestartdensity), __fogNum(f && f.fogdistanceenddensity)]',
    'return [__fogNum(f && f.fogdistancestart), __fogNum(f && f.fogdistanceend) - __fogNum(f && f.fogdistancestart),\n    __fogNum(f && f.fogdistanceenddensity), __fogNum(f && f.fogdistancestartdensity)]') },
  // ② hasFog 恒 false（雾通道整个被丢弃）：F2a 红（F2 组）。锚点 = 整条赋值（只杀 || 前半段不够：
  //   g 里写了 fogdistancecolor 时 hasFog 仍为 true ⇒ 判据漏红，第一版实测过）。
  { id: 'fog-dropped', expect: ['F2'], edit: (s) => s.replace("f.hasFog = ['fogdistancestart', 'fogdistanceend', 'fogdistancestartdensity', 'fogdistanceenddensity',\n    'fogheightstart', 'fogheightend', 'fogheightstartdensity', 'fogheightenddensity'].some((k) => g[k] !== undefined) ||\n    f.distanceColor !== null || f.heightColor !== null", "false") },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== F4 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-fog-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('F4 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(F\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('F4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  check('F4 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== scene-fog: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

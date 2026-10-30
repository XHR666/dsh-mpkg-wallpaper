#!/usr/bin/env node
// tex-json-sidecar-test.mjs — S3 `.tex-json` 侧车字段支持判据（RE-47；规则 A）。
//
// 官方依据：`assets/materials/util/noise.tex-json:2` 等 14 份侧车带
//   {clampuvs, format, nointerpolation, nomip, forcerawcompression}；declarations.json imageshaders config 同形。
// 优先级（S3 定案）：层字段 > 侧车 > .tex 头缺省；`?texjson=legacy` 整条忽略；
//   nomip/forcerawcompression/format 只解析 + 台账（行为未定案按规则 B 留接口）。
//
// 判据：T1 官方侧车逐份解析（14 份，缺资产 SKIP）；T2 优先级三组 case（层>侧车>缺省）；
// T3 format 词表（已知/unknown 记账）；T4 legacy 开关 + 默认路径零变化（无侧车 ⇒ 全 null）；
// T5 变异：优先级反过来（侧车盖层字段）⇒ T2 必红。
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
let pass = 0, fail = 0, skipped = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== S3 .tex-json 侧车字段（RE-47）==')
const SIDE = path.join(WS, 'wallpaper_engine', 'assets', 'materials')
const sideFiles = []
if (fs.existsSync(SIDE)) {
  for (const sub of ['util', 'pattern', 'cookie']) {
    const d = path.join(SIDE, sub)
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) if (f.endsWith('.tex-json')) sideFiles.push(path.join(d, f))
  }
}
/* T1 官方侧车逐份解析 */
if (!sideFiles.length) { skipped++; console.log('  ⚠ SKIP T1：官方侧车不在本地（' + SIDE + '）') }
else {
  let ok = 0, fields = { clampuvs: 0, nointerpolation: 0, nomip: 0, forcerawcompression: 0, format: 0 }
  for (const f of sideFiles) {
    try {
      const sc = lib.parseTexJsonSidecar(JSON.parse(fs.readFileSync(f, 'utf8')))
      if (!sc) continue
      ok++
      for (const k of Object.keys(fields)) if (sc[k] !== null && sc[k] !== undefined) fields[k]++
    } catch (e) { /* 坏 JSON 按缺 */ }
  }
  check('T1a ' + sideFiles.length + ' 份官方侧车解析成功 ' + ok + ' 份（全为对象）', ok === sideFiles.length, '')
  check('T1b 字段面覆盖（clampuvs/format/nointerpolation 全出现；nomip/forcerawcompression 至少 1）',
    fields.clampuvs > 0 && fields.format > 0 && fields.nointerpolation > 0 && fields.nomip > 0 && fields.forcerawcompression > 0,
    JSON.stringify(fields))
  // flashlight1/3 的 clampuvs:true（RE-47 的 CLAMP 侧车实例）
  const fl = lib.parseTexJsonSidecar(JSON.parse(fs.readFileSync(path.join(SIDE, 'cookie', 'flashlight1.tex-json'), 'utf8')))
  check('T1c flashlight1.tex-json：clampuvs=true + format=rgb888（官方 CLAMP 侧车实例）',
    fl.clampuvs === true && fl.format === 'rgb888', JSON.stringify(fl))
}

/* T2 优先级三组 case */
{
  const sc = { clampuvs: true, nointerpolation: true, nomip: true, forcerawcompression: true, format: 'r8' }
  const a = lib.texSamplePriority(true, null, sc)    // 层 true > 侧车 true
  const b = lib.texSamplePriority(false, null, sc)   // 层 false > 侧车 true（层赢）
  const c = lib.texSamplePriority(null, null, sc)    // 无层字段 ⇒ 侧车接管
  const d = lib.texSamplePriority(null, null, null)  // 全缺 ⇒ default
  check('T2a 层 clampuvs:true ⇒ wrap=clamp（src=layer，即便侧车也是 true）', a.wrap === 'clamp' && a.src === 'layer', JSON.stringify(a))
  check('T2b 层 clampuvs:false ⇒ wrap=repeat（层赢过侧车 true）', b.wrap === 'repeat' && b.src === 'layer', JSON.stringify(b))
  check('T2c 无层字段 ⇒ 侧车接管（wrap=clamp/filter=nearest，src=sidecar）',
    c.wrap === 'clamp' && c.filter === 'nearest' && c.src === 'sidecar', JSON.stringify(c))
  check('T2d 全缺 ⇒ default（null 不猜）', d.wrap === null && d.filter === null && d.src === 'default', JSON.stringify(d))
  check('T2e nointerpolation 层 false ⇒ filter=linear（侧车 true 被层压住）',
    lib.texSamplePriority(null, false, sc).filter === 'linear', '')
}

/* T3 format 词表 */
{
  check('T3a 已知词（rgba8888/rgb888/dxt5n/r8/rg88/bc7）⇒ true',
    ['rgba8888', 'rgb888', 'dxt5n', 'r8', 'rg88', 'bc7'].every((f) => lib.texJsonFormatKnown(f)), '')
  check('T3b 未知词 ⇒ false（台账 unknownFormat 记账）', !lib.texJsonFormatKnown('made_up_fmt'), '')
}

/* T4 legacy + 默认零变化 */
{
  check('T4a `?texjson=legacy` 回退口在位', /get\('texjson'\) === 'legacy'/.test(CORE_SRC), '')
  check('T4b 无侧车 ⇒ texSamplePriority 全 null（与改动前逐位一致）',
    JSON.stringify(lib.texSamplePriority(null, null, null)) === JSON.stringify({ wrap: null, filter: null, src: 'default' }), '')
  check('T4c 接线锚点：compositeLayer 的侧车接管块（`__mpwTexJson` + texjsonLegacy 门）',
    /inputTex\.__mpwTexJson && !texjsonLegacy\(\)/.test(CORE_SRC), '')
  check('T4d demo 登记锚点（__attachTexJson + 包内条目/weassist 两路）',
    DEMO_HAS_ATTACH(), '')
  function DEMO_HAS_ATTACH() {
    const demo = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
    return demo.includes('__attachTexJson') && demo.includes('.tex-json') && demo.includes('/weassist/materials/')
  }
}

/* T5 变异自证：优先级反过来（侧车盖层字段）⇒ T2b 必红 */
const MUTANTS = [
  { id: 'sidecar-wins', expect: ['T2'], edit: (s) => s.replace(
    "if (layerClampuvs === true || layerClampuvs === false) { out.wrap = layerClampuvs ? 'clamp' : 'repeat'; out.src = 'layer' }\n  else if (sc.clampuvs === true || sc.clampuvs === false) { out.wrap = sc.clampuvs ? 'clamp' : 'repeat'; out.src = 'sidecar' }",
    "if (sc.clampuvs === true || sc.clampuvs === false) { out.wrap = sc.clampuvs ? 'clamp' : 'repeat'; out.src = 'sidecar' }\n  else if (layerClampuvs === true || layerClampuvs === false) { out.wrap = layerClampuvs ? 'clamp' : 'repeat'; out.src = 'layer' }") },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== T5 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-texjson-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('T5 ' + m.id + ' 变异真的改到了', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', maxBuffer: 32 << 20, input: '', env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT } })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(T\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('T5 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want), '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id)
  }
  check('T5 真树未触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('\n===== tex-json-sidecar: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipped ? ' / SKIP段 ' + skipped : '') + ' =====')
process.exit(fail ? 1 : 0)

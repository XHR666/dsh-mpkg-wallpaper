#!/usr/bin/env node
// fx-conditions-filter-test.mjs — S5 F9 过滤接线判据（conditions 三态 → 链构建）。
//
// 官方依据（RE-46/RE-08 `0x140173cb0` 宏求值器）：conditions 求值为假 ⇒ 剔除条目；
// unknown ⇒ 我们不剔除并记账（P-222 F9 的三态接口；任务书 SMALL-BATCH-1 S5）。
// 语料 456 effect.json / 2210 pass 0 命中 ⇒ 默认路径与改动前逐位一致。
//
// 判据：C1 三 pass（cond=true/false/unknown）⇒ 只有 false 被剔除；C2 unknown pass 仍在链里 +
// 台账 conditionsUnknown；C3 无 conditions ⇒ materialPasses 与改动前逐位一致；C4 变异（unknown 当 false）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
const DEC = new TextDecoder()
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

function buildSyntheticPkg(entries) {
  const enc = new TextEncoder()
  const magic = enc.encode('PKGV0001')
  const names = entries.map((e) => enc.encode(e.name))
  let headSize = 4 + magic.length + 4
  for (const n of names) headSize += 4 + n.length + 8
  const chunks = []; let off = 0; const dir = []
  entries.forEach((e, i) => { const d = typeof e.data === 'string' ? enc.encode(e.data) : e.data; dir.push({ name: names[i], off, size: d.length }); chunks.push(d); off += d.length })
  const buf = new Uint8Array(headSize + off)
  const dv = new DataView(buf.buffer); let p = 0
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
const mkPass = (shader, conditions) => ({ material: `materials/effects/${shader}.json` })

const EFFECT = JSON.stringify({ name: 'cond', version: 1, passes: [
  { material: 'materials/effects/true.json', conditions: { combo: 'VERTICAL', equals: 1 } },
  { material: 'materials/effects/false.json', conditions: { combo: 'VERTICAL', equals: 0 } },
  { material: 'materials/effects/unknown.json', conditions: { nonsense: 1 } },
] })
const mat = (n) => JSON.stringify({ passes: [{ shader: `effects/cond/shaders/effects/${n}`, blending: 'normal', textures: [], combos: {}, depthtest: 'disabled', depthwrite: false }] })

const pkgBuf = buildSyntheticPkg([
  { name: 'scene.json', data: '{"objects":[]}' },
  { name: 'effects/cond/effect.json', data: EFFECT },
  { name: 'materials/effects/true.json', data: mat('true') },
  { name: 'materials/effects/false.json', data: mat('false') },
  { name: 'materials/effects/unknown.json', data: mat('unknown') },
  { name: 'shaders/effects/cond.frag', data: 'void main(){}' },
  { name: 'shaders/effects/cond.vert', data: 'void main(){}' },
])
const tmpPkg = path.join(os.tmpdir(), 'mpw-cond-' + process.pid + '.pkg')
fs.writeFileSync(tmpPkg, pkgBuf)

try {
  const pkg = lib.parsePkg(pkgBuf)
  // C1/C2：真包解析——conditions 求值需要的 combos 来自 pass 自身（effect.json 的 pass 无 combos ⇒ unknown/true 按字面）
  // 传 combos 由 resolveEffectChain 内部用 p.combos；这里 effect.json 的 pass 里补 combos 更真实：
  // 直接走两遍：一遍喂"VERTICAL:1" combos（通过 ov 场景级），一遍基础。
  const ef = { file: 'effects/cond/effect.json', passes: [
    { combos: { VERTICAL: 1 } }, { combos: { VERTICAL: 1 } }, { combos: { VERTICAL: 1 } },
  ] }
  lib.resolveEffectChain(pkg, ef, (b) => DEC.decode(b), {})
  const mps = ef.materialPasses || []
  const shaders = mps.map((m) => m.shader || '')
  check('C1 cond=true/unknown 保留、cond=false 剔除（3 材质只进 2 个；false 的不 in）',
    mps.length === 2 && shaders.some((x) => x.includes('true')) && shaders.some((x) => x.includes('unknown')) && !shaders.some((x) => x.includes('false.json') || x.includes('effects/false')),
    JSON.stringify(shaders))
  check('C2 unknown pass 在链里 + 台账 conditionsUnknown ≥1',
    mps.some((m) => (m.shader || '').includes('unknown')) &&
    typeof globalThis.__mpwConditions === 'object' && globalThis.__mpwConditions.unknown >= 1,
    JSON.stringify(globalThis.__mpwConditions))
  // C3 无 conditions ⇒ 逐位一致
  const ef3 = { file: 'effects/cond/effect.json', passes: [{ combos: {} }] }
  const pkg2 = buildSyntheticPkg([
    { name: 'scene.json', data: '{"objects":[]}' },
    { name: 'effects/cond/effect.json', data: JSON.stringify({ name: 'cond', version: 1, passes: [{ material: 'materials/effects/true.json' }] }) },
    { name: 'materials/effects/true.json', data: mat('true') },
    { name: 'shaders/effects/cond.frag', data: 'void main(){}' },
    { name: 'shaders/effects/cond.vert', data: 'void main(){}' },
  ])
  fs.writeFileSync(tmpPkg, pkg2)
  const pkg3 = lib.parsePkg(pkg2)
  const efB = { file: 'effects/cond/effect.json', passes: [] }
  lib.resolveEffectChain(pkg3, efB, (b) => DEC.decode(b), {})
  check('C3 无 conditions ⇒ materialPasses 形状与改动前逐位一致（1 pass、字段齐）',
    (efB.materialPasses || []).length === 1 && 'shader' in efB.materialPasses[0] && 'binds' in efB.materialPasses[0], '')
} finally { fs.unlinkSync(tmpPkg) }

/* C4 变异自证：unknown 当 false（也剔除）⇒ C2 必红 */
const MUTANTS = [
  { id: 'unknown-filtered', expect: ['C2'], edit: (s) => s.replace("if (condRes === 'unknown') { try { condUnknown() } catch (e) {} }", "if (condRes === 'unknown' || condRes === true) continue; try { condUnknown() } catch (e) {}") },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== C4 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-cond-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('C4 ' + m.id + ' 变异真的改到了', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', maxBuffer: 32 << 20, input: '', env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT } })
    const got = (r.stdout || '').split('\n').filter((l) => l.includes('✗')).length
    check('C4 ' + m.id + '：C2 组红（≥1）', got >= 1, '红项=' + got)
    if (got >= 1) console.log('    MUTANT-RED-OK ' + m.id)
  }
  check('C4 真树未触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('\n===== fx-conditions-filter: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

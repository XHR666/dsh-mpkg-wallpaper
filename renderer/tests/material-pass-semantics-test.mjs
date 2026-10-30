// material-pass-semantics-test.mjs —— 材质/效果 pass 语义的**只读基线**（§A #7 改判的证据，2026-10-10）
//
// 核实结论：本仓**遍历 effect 自己的 `passes[]`**（逐 pass 构造运行期 pass），只有它引用的**材质 JSON
// 内部**取 `passes[0]`。参考实现（`ref/lwe/.../CImage.cpp:628`）的官方口径是"逐 material pass 执行"，
// 但可及语料实测：effect 级多段 1 个（已执行 ✓）、**material 级多段 0 个** ⇒ `passes[0]` 截断从不触发，
// 故**保持现状**（见台账 §A #7 改判）。本判据只钉语义，防止将来被静默改动；要改必须先改判据与台账。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')

ok('A1', 'effect 的每个 pass 都会构造一个运行期 pass（`effect.materialPasses.push(` 存在）',
  /effect\.materialPasses\.push\(\{/.test(src), 'effect.materialPasses.push 存在')
ok('A2', '构造时读的是该 pass 的字段（push 之前出现 `p.material`，同一个循环里还用到 p.target/p.bind）',
  (() => {
    const i = src.indexOf('effect.materialPasses.push({')
    if (i < 0) return false
    const seg = src.slice(Math.max(0, i - 3000), i)
    return seg.includes('p.material') && (seg.includes('p.target') || seg.includes('p.bind'))
  })(), 'push 前 3000 字符内含 p.material 与 p.target/p.bind')
ok('A3', 'material 级仍取首个 pass：`const mp = (mj.passes && mj.passes[0]) || {}`',
  /const mp = \(mj\.passes && mj\.passes\[0\]\) \|\| \{\}/.test(src), 'passes[0] 语义保持')
ok('A4', '材质 miss 时**如实记账**（noteFxMiss）而不是静默塞空 pass',
  /noteFxMiss\('material'/.test(src), 'noteFxMiss(material) 存在')

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== material-pass-semantics: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

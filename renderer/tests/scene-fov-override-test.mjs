// scene-fov-override-test.mjs —— 场景级 `general.perspectiveoverridefov`（官方 assets 对照）判据
//
// 依据：官方 `wallpaper_engine/assets/**` 里 `perspectiveoverridefov` 出现 69 处；真实 `scene.json` 的
// `/general/` 下确有该字段（妃咲包 = `95.0`），而本仓源码里**完全不出现** ⇒ 语义缺口。官方语义 =
// 覆盖相机层 fov（透视档）。修法：置入 `fovPick` 链**最高优先级**，带 `?fovoverride=legacy` 回退口。
// 该值在渲染期的投影计算里消费（不在 parseScene 的输出里）⇒ 判据为源码级 + 文档级。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8')

ok('A1', '开关读取：`fovoverride` 只认字符串 `legacy`', /get\('fovoverride'\) === 'legacy'/.test(src), 'legacy only')
ok('A2', '消费点：`general.perspectiveoverridefov` 被读入 fov 取值链',
  /Number\.isFinite\(Number\(general\.perspectiveoverridefov\)\)/.test(src), 'in fovPick')
ok('A3', '优先级：它出现在 `fovPick` 数组的**第一项**（官方=覆盖相机层）',
  /const fovPick = \[[\s\S]{0,600}?general\.perspectiveoverridefov[\s\S]{0,200}?pose\.fov/.test(src), 'head of fovPick')
ok('A4', '回退语义：legacy 时该项短路为 null（`!FOVOVERRIDE_LEGACY && …`）',
  /\(!FOVOVERRIDE_LEGACY && Number\.isFinite/.test(src), 'legacy short-circuit')
ok('A5', '诊断开关主表已登记 `fovoverride`', /^\| `fovoverride` \|/m.test(doc), 'docs 行存在')

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== scene-fov-override: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

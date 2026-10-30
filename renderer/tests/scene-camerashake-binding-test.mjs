// scene-camerashake-binding-test.mjs —— `camerashake*` 的**属性绑定形态**解析判据（2026-10-11）
//
// 由来：索引核对（durable teammate `index-verifier` 批次 1）实测 **205 容器**里 `camerashake` 有 **8 处 enabled**
// （6 处写成属性绑定对象 `{user:…, value:true}` + 2 处字面 true），且已有包把 `camerashakeamplitude` 也写成对象 ✗，
// 而旧解析 `typeof general.camerashakeX === 'number' ? … : 默认` **只认 number** ⇒ 这类档的 speed/amplitude/roughness
// 会**静默退化**为默认值 ✗。修法：统一取绑定对象的 `value`（非 number 且非对象 ⇒ 回默认，语义与旧实现一致 ✓）。
//
// 性质：**结构判据**（在源码里钉住"三处都走同一取值助手 + 助手同时接受 number 与 {value:number}"），
// 行为面由场景解析既有判据族覆盖；不新增步骤，挂在本文件所在的 tests 目录，由 run-all-tests.sh 调用 ✓。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

ok('存在取值助手 csNum（同时接受 number 与 {value:number}）',
  /const csNum = \(v, dflt\) => \(typeof v === 'number' \? v : \(v !== null && typeof v === 'object' && typeof v\.value === 'number' \? v\.value : dflt\)\)/.test(src))
ok('speed 走 csNum', /cameraShake\.speed = csNum\(general\.camerashakespeed, csDefSpeed\)/.test(src))
ok('amplitude 走 csNum', /cameraShake\.amplitude = csNum\(general\.camerashakeamplitude, csDefAmplitude\)/.test(src))
ok('roughness 走 csNum', /cameraShake\.roughness = csNum\(general\.camerashakeroughness, 1\)/.test(src))
ok('不再残留"只认 number"的旧写法（反回归 ✗）',
  !/cameraShake\.(speed|amplitude|roughness) = typeof general\.camerashake/.test(src))
ok('enabled 仍认字面 true 与绑定对象 value===true（语义不变 ✓）',
  /const enabledRaw = csRaw === true \|\| \(csRaw !== null && typeof csRaw === 'object' && csRaw\.value === true\)/.test(src))
ok('默认关的语义未被改动（`?camerashake` 缺省 off ✓）',
  /get\('camerashake'\) \|\| 'off'/.test(src))
ok('缺省值对齐**官方**（166/166 官方工程实测：amplitude=0.5 · roughness=1 · speed=3）',
  /csDefSpeed = csLegacyDef \? 0 : 3/.test(src) && /csDefAmplitude = csLegacyDef \? 0 : 0\.5/.test(src)
  && /csNum\(general\.camerashakeroughness, 1\)/.test(src))
ok('回退位 `?camerashake=legacy` ⇒ 逐位回旧缺省 0/0（本仓防御，非官方）', /get\('camerashake'\) === 'legacy'/.test(src))
ok('不再把 speed/amplitude 缺省写死为 0（反回归 ✗）',
  !/cameraShake\.(speed|amplitude) = csNum\(general\.camerashake[a-z]*, 0\)/.test(src))

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.why)
console.log(`===== scene-camerashake-binding: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

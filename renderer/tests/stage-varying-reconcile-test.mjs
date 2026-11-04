// stage-varying-reconcile-test.mjs —— §A #8 跨阶段 varying 对账的专属判据（2026-10-10 新增）
//
// 台账 §A #8 更正：`reconcileStageVaryings()` 已在 core 实现（`core/we-scene-bundle.js:8564`，导出）
// 并在生产路径 `assembleEffectShaderSources()` 里被调用（`:7303-7304`），带回退口 `?varyinglink=legacy`
// （`:8561`）。此前"`vertConflicts` 只在 vendor、core 0 命中"的记录已陈旧；§A #13 的四个效果 pass
// （`color_grading`×2 / `Simple_Audio_Bars` / `glitter_prepare`）正是随它修好的（见 `docs/PATCHES.md`）。
// 本判据把这能力钉住：普通档必须让两阶段 varying 宽度一致（否则链接失败、整条 pass 被跳过）；
// legacy 档必须**保持不一致**（逐位回到改动前的报文），以防将来"优化"悄悄改掉回退口语义。
import { reconcileStageVaryings } from '../core/we-scene-bundle.js'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const VERT = '#version 300 es\nin vec3 a_Position;\nout vec4 v_TexCoord;\nvoid main(){ v_TexCoord=vec4(1.0); gl_Position=vec4(a_Position,1.0); }'
const FRAG = '#version 300 es\nprecision highp float;\nin vec2 v_TexCoord;\nout vec4 o;\nvoid main(){ o=vec4(v_TexCoord,0.0,1.0); }'
const width = (s, dir) => ((String(s).match(new RegExp(dir + ' (vec[234]) v_TexCoord')) || [])[1]) || null

const norm = reconcileStageVaryings(VERT, FRAG, null)
ok('A1', '普通档：两阶段 v_TexCoord 宽度被对账为一致', width(norm.vert, 'out') === width(norm.frag, 'in') && width(norm.vert, 'out') !== null,
  `vert=${width(norm.vert, 'out')} frag=${width(norm.frag, 'in')}`)
ok('A2', '普通档：以**宽**的一侧为准（vec4 胜出，不丢数据）', width(norm.frag, 'in') === 'vec4', 'frag → ' + width(norm.frag, 'in'))

const leg = reconcileStageVaryings(VERT, FRAG, '?varyinglink=legacy')
ok('A3', 'legacy 档：保持不一致（逐位回到改动前的链接失败报文）',
  width(leg.vert, 'out') === 'vec4' && width(leg.frag, 'in') === 'vec2', `vert=${width(leg.vert, 'out')} frag=${width(leg.frag, 'in')}`)
ok('A4', 'legacy 档与普通档**必须不同**（回退口有效，不是空开关）',
  !(leg.vert === norm.vert && leg.frag === norm.frag), 'legacy 与普通档产物不同')

/* 已一致的一对：frag 也用 vec4（注意别用 replace 去改 VERT —— 它是 `in vec3 a_Position`，
   上一版夹具就是这么写错的，A5 因此假红） */
const FRAG4 = FRAG.replace('in vec2 v_TexCoord', 'in vec4 v_TexCoord')
const same = reconcileStageVaryings(VERT, FRAG4, null)
ok('A5', '宽度已一致的输入：不报错、仍产出两侧宽度一致的 GLSL',
  width(same.vert, 'out') === width(same.frag, 'in'), `vert=${width(same.vert, 'out')} frag=${width(same.frag, 'in')}`)

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== stage-varying-reconcile: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

// parallax-clamp-test.mjs —— §B #15「指针归一化的夹取时机」判据（2026-10-10 新增）
//
// 官方口径（reports/parallax-official-align-20260924.md §5.3 第 11 行原文）：
//   鼠标归一化 = 桌面 `GetCursorPos → ScreenToClient → x/宽, y/高 → [0,1]²`，中心 0.5，**采样时不夹**。
// 本仓原先在视差链 `attachParallaxListener()` 里"立即 clamp(0,1)"⇒ 指针移出画布后视差被冻在边缘。
// 修法：缺省**不夹**（对齐官方）；`?parclamp=legacy` 逐位回到改动前的 clamp。
// 注意：`core/we-pointer-source.mjs` 的 `applyMove()` 本就不夹（已核实），本条只针对视差链。
//
// 本判据为**源码级 + 文档级**（该监听需要 DOM，纯 Node 起不来）：
//   A1 开关读取存在且只认 `legacy`；A2 缺省档是**除法不夹**；A3 legacy 档保留 clamp；
//   A4 诊断开关主表已登记 `parclamp`（diag-flag-check 双向比对的另一半）。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8')

ok('A1', '开关读取：`parclamp` 只认字符串 `legacy`',
  /get\('parclamp'\) === 'legacy'/.test(src), "new URLSearchParams(location.search).get('parclamp') === 'legacy'")
ok('A2', '缺省档：视差链**不夹**（直接 `ev.clientX / w`）',
  /parallaxState\.x = PARCLAMP_LEGACY \? Math\.max\(0, Math\.min\(1, ev\.clientX \/ w\)\) : \(ev\.clientX \/ w\)/.test(src)
  && /parallaxState\.y = PARCLAMP_LEGACY \? Math\.max\(0, Math\.min\(1, ev\.clientY \/ h\)\) : \(ev\.clientY \/ h\)/.test(src), '两轴都是两档表达式')
ok('A3', 'legacy 档：保留改动前的 `Math.max(0, Math.min(1, …))`（逐位回旧行为）',
  (src.match(/Math\.max\(0, Math\.min\(1, ev\.client[XY] \/ [wh]\)\)/g) || []).length >= 2, '两处 clamp 仍在（legacy 分支）')
ok('A4', '诊断开关主表已登记 `parclamp`（与 diag-flag-check 的"代码开关数==主表行数"互为半边）',
  /^\| `parclamp` \|/m.test(doc), 'docs/README-DIAGNOSTICS.md 有该行')
ok('A5', '官方依据写进代码注释（§5.3"采样时不夹"）',
  /采样时不夹/.test(src) && /parallax-official-align-20260924\.md/.test(src), '注释含官方出处')

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== parallax-clamp: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

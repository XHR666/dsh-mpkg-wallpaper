// autoreport-toggle-test.mjs —— 台账 §1.1 第 19 项判据：`?report=auto` 的**面板开关**（2026-10-11）
// 语义不变：自动上报 = 首帧 700ms 一次 + 之后每 10s 一次（自动路径 4 次上限）；缺省**结构上不建定时器**。
// 新增：运行时启停（顶部工具栏「🛰 自动上报」按钮）+ 读数 window.__mpwAutoReport。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
const src = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const seg = (() => { const a = src.indexOf('const __autoReportTimeouts = []'); const b = src.indexOf('// ═══ MPW-REPORT-BTN-BEGIN'); return (a >= 0 && b > a) ? src.slice(a, b) : '' })()
ok('F1', '抽成可启停的 start/stop 两个函数', /function startAutoReport\(/.test(seg) && /function stopAutoReport\(/.test(seg), '')
ok('F2', 'URL 开法不变：`?report=auto` ⇒ `startAutoReport(\'?report=auto\')`', /if \(autoReport\) \{\s*\n\s*startAutoReport\('\?report=auto'\)/.test(seg), '')
ok('F3', '缺省**结构上不建定时器**：`setTimeout(doReport, 700)` 只出现在 startAutoReport 内',
  (src.match(/setTimeout\(doReport, 700\)/g) || []).length === 1 && /setTimeout\(doReport, 700\)/.test(seg), '')
ok('F4', '停止时真清定时器（clearInterval(reportTimer) + clearTimeout 全部挂起项）',
  /clearInterval\(reportTimer\)/.test(seg) && /clearTimeout\(t\)/.test(seg) && /__autoReportTimeouts\.splice\(0\)/.test(seg), '')
ok('F5', '面板开关按钮存在且挂到 `#bar`、点击走 start/stop', /id = 'mpw-autoreport-btn'/.test(src)
  && /bar\.appendChild\(b\)/.test(src) && /startAutoReport\('面板开关'\)/.test(src) && /stopAutoReport\('面板开关'\)/.test(src), '')
ok('F6', '读数暴露 `window.__mpwAutoReport = { on, start, stop }`',
  /window\.__mpwAutoReport = \{ get on\(\)/.test(seg) && /start: \(\) => startAutoReport\('API'\)/.test(seg), '')
ok('F7', '手动「🛰 立即上报」未受影响（按钮仍在，且与自动路径解耦）', /mpw-report-btn/.test(src) && !/stopAutoReport\(\)[\s\S]{0,200}mpw-report-btn/.test(seg), '')
const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== autoreport-toggle: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

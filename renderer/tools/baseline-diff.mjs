#!/usr/bin/env node
// baseline-diff.mjs —— ①(§5-⑨ 真机基线快照 2026-09-17) 两份基线快照的**逐指标差异表 + 回归闸门**。
//
// 为什么有这个脚本：采集器（demo.html `?baseline=`）只负责"把真机现状记下来"；"变慢了"要靠
// **同一台机器、同一个包、同一档位**的两份快照逐指标对拍才能判定。本脚本就是那条判据，
// 以后可以像其它门禁一样进 CI/本地回归（退化超阈值 → 非零退出码）。
//
// 用法：
//   node tools/baseline-diff.mjs <基线.json> <当前.json>            # 人读表；退化 → 退出码 1
//   node tools/baseline-diff.mjs <基线.json> <当前.json> --json     # 机读（CI 消费）
//   node tools/baseline-diff.mjs <基线.json> <当前.json> --quiet    # 只在有退化时打印明细
//   选项：--require-same-id（两侧 id 必须相同，否则退出码 2；默认只告警）
//
// **退出码语义（唯一口径）**：
//   0 = 无退化（含"两份逐字段相同"与"差异都在阈值/噪声地板内"）
//   1 = 至少一项**退化超阈值**（哪几项见表格「判定」列）
//   2 = 用法/输入错误（文件缺失、JSON 坏、快照字段残缺、schema 不符、--require-same-id 不满足）
//
// **退化判据（唯一实现 `compareSnapshots`；阈值集中在 `THRESHOLDS`，env 可覆盖）**：
//   ① 绝对噪声地板：`|cur − base|` 必须**严格大于**生效地板，否则记「噪声内」不判退化。
//      **生效地板 = min(配置地板, |基线|)**（毫秒 0.5ms、帧率 0.5fps、字节 1MB、计数 1 个）——
//      配置地板是"这点抖动不算数"，但它绝不能大于基线本身，否则小量纲指标会被地板整段吞掉；
//   ② 相对变化：`pct = (cur − base) / |base| × 100`；基线为 0 时：两侧都是 0 → 0%，
//      base=0 且 cur>0 → `Infinity`（"从无到有"必须报，不能靠除零静默放过）；
//   ③ 方向：`dir: 'lower'`（越小越好，如耗时/显存/计数）→ `pct > 阈值` 判退化；
//      `dir: 'higher'`（越大越好，如 FPS）→ `pct < −阈值` 判退化。
//   阈值分组（都在 `THRESHOLDS` 里，一组一处）：
//     framePct 10%（帧间隔分位）/ fpsPct 5%（帧率）/ startupPct 20%（启动耗时）/
//     vramPct 15%（代理显存与计数）/ switchPct 15%（壁纸切换耗时）
//   env 覆盖：`MPW_BASELINE_TH_<键名的下划线大写>`，例如
//     `MPW_BASELINE_TH_FRAME_PCT=5 MPW_BASELINE_TH_STARTUP_PCT=30 node tools/baseline-diff.mjs a.json b.json`
//
// ⚠ 口径提醒（**不是**本脚本能替你判断的）：两侧必须是**同一台机器 + 同一个包 + 同一 URL 档位**
//   （分辨率 `?res=`、质量 `?q=` / `?aa=`、`?perf=`、画布尺寸、DPR 都会改数字）。右侧 id 不同时
//   本脚本只告警（`--require-same-id` 可升级为错误）。
//
// ⚠ VRAM 的诚实说明：快照里的 `vramProxy.*` **全是代理估算**（浏览器拿不到真实显存读数），
//   阈值只对"同一设备、同一包、同一档位"的**趋势**有意义，**不能**当"显存占用 = X MB"引用。

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { BASELINE_SCHEMA, mpwValidateSnapshot } from '../core/baseline-metrics.mjs'

/** 阈值唯一来源（分组一处一行；env 覆盖见 `ENV_OF`）。 */
export const THRESHOLDS = {
  framePct: 10,        // 帧间隔 p50/p95/p99/max
  fpsPct: 5,           // FPS 中位 / 1% low / min
  startupPct: 20,      // 启动耗时（导航→首帧、首帧→就绪、总）
  vramPct: 15,         // 代理显存 / 活纹理·FBO 计数 / 上传带宽
  switchPct: 15,       // 壁纸切换（换包导航）耗时
  msFloor: 0.5,        // 绝对噪声地板：毫秒
  fpsFloor: 0.5,       // 绝对噪声地板：帧率
  bytesFloor: 1048576, // 绝对噪声地板：字节（1MB）
  countFloor: 1,       // 绝对噪声地板：计数（个）
}
/** THRESHOLDS 键 → 环境变量名（集中一处，文档与本脚本同源）。 */
export const ENV_OF = {
  framePct: 'MPW_BASELINE_TH_FRAME_PCT',
  fpsPct: 'MPW_BASELINE_TH_FPS_PCT',
  startupPct: 'MPW_BASELINE_TH_STARTUP_PCT',
  vramPct: 'MPW_BASELINE_TH_VRAM_PCT',
  switchPct: 'MPW_BASELINE_TH_SWITCH_PCT',
  msFloor: 'MPW_BASELINE_TH_MS_FLOOR',
  fpsFloor: 'MPW_BASELINE_TH_FPS_FLOOR',
  bytesFloor: 'MPW_BASELINE_TH_BYTES_FLOOR',
  countFloor: 'MPW_BASELINE_TH_COUNT_FLOOR',
}

/** 参与对拍的指标表：路径 → 显示名/单位/方向/阈值组。**这里是唯一清单**。 */
export const METRICS = [
  { path: 'fps.median', label: 'FPS 中位（500ms 窗）', unit: 'fps', dir: 'higher', group: 'fps' },
  { path: 'fps.p1Low', label: 'FPS 1% low', unit: 'fps', dir: 'higher', group: 'fps' },
  { path: 'fps.min', label: 'FPS 最差窗', unit: 'fps', dir: 'higher', group: 'fps' },
  { path: 'frames.p50', label: '帧间隔 p50', unit: 'ms', dir: 'lower', group: 'frame' },
  { path: 'frames.p95', label: '帧间隔 p95', unit: 'ms', dir: 'lower', group: 'frame' },
  { path: 'frames.p99', label: '帧间隔 p99', unit: 'ms', dir: 'lower', group: 'frame' },
  { path: 'frames.max', label: '帧间隔 max', unit: 'ms', dir: 'lower', group: 'frame' },
  { path: 'render.p50', label: '渲染主体 p50（需 ?perf=1）', unit: 'ms', dir: 'lower', group: 'frame' },
  { path: 'render.p95', label: '渲染主体 p95（需 ?perf=1）', unit: 'ms', dir: 'lower', group: 'frame' },
  { path: 'startup.navToFirstFrameMs', label: '启动：导航→首帧', unit: 'ms', dir: 'lower', group: 'startup' },
  { path: 'startup.firstFrameToReadyMs', label: '启动：首帧→就绪', unit: 'ms', dir: 'lower', group: 'startup' },
  { path: 'startup.totalMs', label: '启动：导航→就绪（主指标）', unit: 'ms', dir: 'lower', group: 'startup' },
  { path: 'vramProxy.textureBytesEst', label: '纹理字节估算（代理）', unit: 'bytes', dir: 'lower', group: 'vram' },
  { path: 'vramProxy.jsHeapUsedBytes', label: 'JS 堆 usedJSHeapSize（代理，非显存）', unit: 'bytes', dir: 'lower', group: 'vram' },
  { path: 'counts.glFbosLive', label: '活 FBO 数', unit: 'count', dir: 'lower', group: 'vram' },
  { path: 'counts.glTexturesLive', label: '活纹理数', unit: 'count', dir: 'lower', group: 'vram' },
  { path: 'counts.drawsPerFrame', label: '每帧 draw 数', unit: 'count', dir: 'lower', group: 'vram' },
  { path: 'counts.uploadBytes', label: '窗口内上传字节（带宽代理）', unit: 'bytes', dir: 'lower', group: 'vram' },
  { path: 'switch.swapTo.ms', label: '切换耗时：切到另一包', unit: 'ms', dir: 'lower', group: 'switch' },
  { path: 'switch.swapBack.ms', label: '切换耗时：切回原包', unit: 'ms', dir: 'lower', group: 'switch' },
]

/** env 覆盖阈值（非法/负数一律忽略并回落默认 —— **绝不出现"配错阈值 = 关掉闸门"**）。 */
export function resolveThresholds(env) {
  const e = env || {}
  const out = Object.assign({}, THRESHOLDS)
  const from = {}
  for (const k of Object.keys(THRESHOLDS)) {
    const name = ENV_OF[k]
    const raw = name ? e[name] : undefined
    if (raw === undefined || raw === null || raw === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) continue
    out[k] = n
    from[k] = { env: name, value: n }
  }
  return { values: out, from }
}

const dig = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, o)

function floorFor(unit, th) {
  if (unit === 'ms') return th.msFloor
  if (unit === 'fps') return th.fpsFloor
  if (unit === 'bytes') return th.bytesFloor
  return th.countFloor
}
function pctThresholdFor(group, th) {
  if (group === 'fps') return th.fpsPct
  if (group === 'startup') return th.startupPct
  if (group === 'vram') return th.vramPct
  if (group === 'switch') return th.switchPct
  return th.framePct
}

/**
 * 逐指标对拍（纯函数，测试直接调）。
 * @returns {{rows:Array, regressions:Array, skipped:Array, improved:Array}}
 */
export function compareSnapshots(base, cur, thresholds) {
  const th = thresholds || THRESHOLDS
  const rows = [], regressions = [], skipped = [], improved = []
  for (const m of METRICS) {
    const b = dig(base, m.path), c = dig(cur, m.path)
    const row = { path: m.path, label: m.label, unit: m.unit, dir: m.dir, group: m.group, base: null, cur: null, delta: null, pct: null, threshold: pctThresholdFor(m.group, th), floor: floorFor(m.unit, th), verdict: 'skip', why: '' }
    if (!Number.isFinite(Number(b)) || b === null || b === undefined) { row.why = '基线侧未采集（null/缺字段）'; skipped.push(row); rows.push(row); continue }
    if (!Number.isFinite(Number(c)) || c === null || c === undefined) { row.why = '当前侧未采集（null/缺字段）'; skipped.push(row); rows.push(row); continue }
    const bv = Number(b), cv = Number(c)
    row.base = bv; row.cur = cv; row.delta = cv - bv
    row.pct = (bv === 0) ? (cv === 0 ? 0 : Infinity) : (cv - bv) / Math.abs(bv) * 100
    // 生效地板 = min(配置地板, |基线|)：配置地板是"这点抖动不算数"，但它**绝不能大于基线本身** ——
    // 否则小量纲指标（例如纹理估算只有 2KB 的场景）会被地板整段吞掉，+877% 也判"噪声内"。
    row.floorCfg = row.floor
    row.floor = Math.min(row.floor, Math.abs(bv))
    if (Math.abs(row.delta) <= row.floor) { row.verdict = 'floor'; row.why = '|Δ| ≤ 噪声地板 ' + row.floor; rows.push(row); continue }
    const worse = (m.dir === 'lower') ? (row.pct > row.threshold) : (row.pct < -row.threshold)
    if (worse) { row.verdict = 'regression'; row.why = '退化超阈值 ' + row.threshold + '%'; regressions.push(row) }
    else if ((m.dir === 'lower' && row.pct < -row.threshold) || (m.dir === 'higher' && row.pct > row.threshold)) { row.verdict = 'better'; row.why = '变好超阈值'; improved.push(row) }
    else { row.verdict = 'ok'; row.why = '阈值内' }
    rows.push(row)
  }
  return { rows, regressions, skipped, improved }
}

// ─────────────────────────── CLI ───────────────────────────
// ⚠ 整段包在 `main()` 里、且只在**直接执行**时调用：`tests/baseline-test.mjs` 会 import 本文件的
//   纯函数（THRESHOLDS/compareSnapshots…）—— 若 import 就跑去读 argv/process.exit，测试直接死。

function main() {
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const args = argv.filter((a) => !a.startsWith('--'))
const JSON_OUT = flags.has('--json')
const QUIET = flags.has('--quiet')
const REQ_SAME_ID = flags.has('--require-same-id')

const usage = () => {
  console.error('用法: node tools/baseline-diff.mjs <基线.json> <当前.json> [--json] [--quiet] [--require-same-id]')
  console.error('  退出码：0=无退化 / 1=有指标退化超阈值 / 2=用法或输入错误')
  console.error('  阈值可用 env 覆盖（例：MPW_BASELINE_TH_FRAME_PCT=5），键名见文件头 ENV_OF。')
}
const die = (msg) => { console.error('✗ ' + msg); usage(); process.exit(2) }
if (flags.size && [...flags].some((f) => !['--json', '--quiet', '--require-same-id'].includes(f))) die('未知选项 ' + [...flags].join(' '))
if (args.length !== 2) die('需要两个快照文件（基线 当前），收到 ' + args.length + ' 个')

const readSnap = (p) => {
  let text = ''
  try { text = fs.readFileSync(p, 'utf8') } catch (e) { die('读不到文件 ' + p + '（' + e.code + '）') }
  let obj = null
  try { obj = JSON.parse(text) } catch (e) { die('不是合法 JSON：' + p + '（' + e.message + '）') }
  const v = mpwValidateSnapshot(obj)
  if (!v.ok) die(p + ' 不是完整快照（' + v.errors.slice(0, 6).join('；') + (v.errors.length > 6 ? ' …共 ' + v.errors.length + ' 项' : '') + '）')
  if (Number(obj.schema) !== BASELINE_SCHEMA) die(p + ' 的 schema=' + obj.schema + ' ≠ 本工具支持的 ' + BASELINE_SCHEMA)
  return obj
}

const fileA = args[0], fileB = args[1]
const base = readSnap(fileA)
const cur = readSnap(fileB)
const { values: TH, from: TH_FROM } = resolveThresholds(process.env)

const sameId = String(base.id) === String(cur.id)
if (!sameId) {
  const msg = '两侧 id 不同（基线 ' + base.id + ' vs 当前 ' + cur.id + '）—— 趋势对比必须同包同档位'
  if (REQ_SAME_ID) die(msg)
  if (!JSON_OUT) console.error('⚠ ' + msg)
}
const durA = Number(dig(base, 'window.actualSec')), durB = Number(dig(cur, 'window.actualSec'))
if (Number.isFinite(durA) && Number.isFinite(durB) && durA > 0 && Math.abs(durB - durA) / durA > 0.05 && !JSON_OUT) {
  console.error('⚠ 两侧采集时长差 >5%（' + durA + 's vs ' + durB + 's）—— 累计类指标（上传字节/draw 总数）可比性下降')
}

const cmp = compareSnapshots(base, cur, TH)
const fmt = (v, unit) => {
  if (v === null || v === undefined) return '—'
  if (v === Infinity || v === -Infinity) return (v > 0 ? '+' : '−') + '∞'
  const n = Number(v)
  if (unit === 'bytes') return (n / 1048576).toFixed(2) + 'MB'
  if (unit === 'fps') return n.toFixed(2)
  if (unit === 'count') return String(Math.round(n * 100) / 100)
  return n.toFixed(2) + 'ms'
}
const fmtPct = (p) => (p === null || p === undefined) ? '—' : (p === Infinity ? '+∞' : (p === -Infinity ? '−∞' : (p > 0 ? '+' : '') + p.toFixed(1) + '%'))
const VERDICT_TAG = { regression: '⚠ 退化', better: '✓ 变好', ok: '· 阈值内', floor: '· 噪声内', skip: '– 未采集' }

if (!JSON_OUT) {
  const envNote = Object.keys(TH_FROM).length ? '；env 覆盖：' + Object.keys(TH_FROM).map((k) => ENV_OF[k] + '=' + TH_FROM[k].value).join(', ') : ''
  console.log('基线快照对比（schema ' + BASELINE_SCHEMA + '；阈值：帧 ' + TH.framePct + '% / 帧率 ' + TH.fpsPct + '% / 启动 ' + TH.startupPct + '% / 代理 ' + TH.vramPct + '% / 切换 ' + TH.switchPct + '%' + envNote + '）')
  console.log('  基线：' + fileA + '（id=' + base.id + '，' + (base.at || '?') + '）')
  console.log('  当前：' + fileB + '（id=' + cur.id + '，' + (cur.at || '?') + '）')
  const W = [34, 12, 12, 12, 9, 8]
  const head = ['指标', '基线', '当前', '差值', '相对%', '判定']
  const pad = (s, n) => { let w = 0; for (const ch of String(s)) w += (ch.charCodeAt(0) > 255 ? 2 : 1); return String(s) + ' '.repeat(Math.max(0, n - w)) }
  const line = (cells) => '  ' + cells.map((c, i) => pad(c, W[i])).join(' ')
  console.log(line(head))
  console.log('  ' + '─'.repeat(W.reduce((a, b) => a + b + 1, 0)))
  for (const r of cmp.rows) {
    if (QUIET && r.verdict !== 'regression') continue
    console.log(line([r.label, fmt(r.base, r.unit), fmt(r.cur, r.unit), fmt(r.delta, r.unit), fmtPct(r.pct), VERDICT_TAG[r.verdict] || r.verdict]))
  }
  if (!QUIET) {
    for (const r of cmp.skipped) console.log('  – ' + r.label + '：' + r.why)
  }
  const n = cmp.rows.length
  if (cmp.regressions.length) {
    console.error('✗ **退化 ' + cmp.regressions.length + ' 项**（共对拍 ' + n + ' 项）：' + cmp.regressions.map((r) => r.label + ' ' + fmtPct(r.pct)).join('；'))
  } else {
    console.log('✓ 无退化（对拍 ' + n + ' 项：变好 ' + cmp.improved.length + ' / 噪声内 ' + cmp.rows.filter((r) => r.verdict === 'floor').length + ' / 未采集 ' + cmp.skipped.length + '）')
  }
} else {
  console.log(JSON.stringify({
    ok: cmp.regressions.length === 0,
    schema: BASELINE_SCHEMA,
    ids: { base: base.id, cur: cur.id, same: sameId },
    thresholds: TH,
    thresholdsFromEnv: TH_FROM,
    counts: { compared: cmp.rows.length, regressions: cmp.regressions.length, improved: cmp.improved.length, skipped: cmp.skipped.length },
    regressions: cmp.regressions.map((r) => ({ path: r.path, label: r.label, base: r.base, cur: r.cur, delta: r.delta, pct: (r.pct === Infinity ? 'Infinity' : r.pct), threshold: r.threshold })),
    skipped: cmp.skipped.map((r) => ({ path: r.path, why: r.why })),
    rows: cmp.rows,
  }, null, 1))
}

process.exit(cmp.regressions.length ? 1 : 0)
}

// 直接执行才跑 CLI（被 import 时只导出纯函数）
const __isMain = (() => {
  try { return !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url } catch (e) { return false }
})()
if (__isMain) main()

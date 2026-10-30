#!/usr/bin/env node
// baseline-trend.mjs —— ①(§5-⑨ 真机基线快照 · 趋势视图 2026-09-17)
//
// 为什么有这个脚本：`?baseline=1` 的采集器 + `POST /baseline` 只负责"把真机现状一份份记下来"（落盘
// `reports/baselines/<epochms>.json`，schema 见 `core/baseline-metrics.mjs`）；`tools/baseline-diff.mjs`
// 负责**两份**对拍。但"趋势"要的是**多份连起来看**（docs/BASELINE.md §7 未定项 2 原话：
// "趋势图/汇总脚本未做……要画多份趋势线需要再写一个小脚本"）—— 就是本脚本。
//
// 数据源（两份都吃，**分组时不混**）：
//   · `reports/baselines/*.json`      —— 真机 `?baseline=1` 采集（kind=baseline，有 GPU 的机器才有）
//   · `reports/real-machine/*.json`   —— `tests/real-machine-check.mjs` 的面板冒烟报告（kind=real-machine，
//     字段路径与基线快照**同源**：startup.totalMs / fps.median / switch.swapTo.ms / vramProxy.textureBytesEst）
//
// 打印：每个 (kind, id) 一组，按时间排序的一行一份快照 + **与上一份的差值/百分比/判定**。
//   判定**不另造口径**：直接调 `tools/baseline-diff.mjs` 的 `compareSnapshots()`，
//   阈值也用它导出的 `THRESHOLDS`（帧 10% / 帧率 5% / 启动 20% / 代理 15% / 切换 15% + 噪声地板），
//   env 覆盖规则同样是 `MPW_BASELINE_TH_*`（见该文件头）—— 一处改，两条线同时生效。
//
// 用法：
//   node tests/baseline-trend.mjs                 # 人读趋势表；只在"最新一对退化"时打 ⚠（退出码仍 0）
//   node tests/baseline-trend.mjs --strict        # 最新一对有退化 ⇒ 退出码 1（发版前/回归时用）
//   node tests/baseline-trend.mjs --json          # 机读（趋势行 + 每对判定）
//   node tests/baseline-trend.mjs --limit=5       # 每组只打最近 5 份（默认 10）
//   node tests/baseline-trend.mjs --dir=reports   # 换一个 reports 根（默认 <仓库根>/reports）
// 退出码：0 = 正常（含"一份都没有"以外的所有情况）；1 = 有快照**不合 schema**，或 --strict 下最新一对退化；
//   2 = 用法错误。
// 条件项约定：两份来源都为空 ⇒ 第一行打印 `SKIP baseline-trend …` 并退出 0（门禁不红）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'baseline-trend'
const argv = process.argv.slice(2)
const opt = (n, d) => { const h = argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d }
const badArg = argv.find((a) => !/^--(dir|limit)=/.test(a) && !/^--(strict|json|help)$/.test(a))
if (badArg) { console.error('未知参数：' + badArg + '（用法见 tests/baseline-trend.mjs 文件头）'); process.exit(2) }
if (argv.includes('--help')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 34).join('\n')); process.exit(0) }
const REPORTS = path.resolve(opt('dir', path.join(ROOT, 'reports')))
const STRICT = argv.includes('--strict')
const JSON_OUT = argv.includes('--json')
const LIMIT = Math.max(1, Number(opt('limit', 10)) || 10)

// 阈值/判定/校验的唯一来源（不复制常量、不另写一份 pct 逻辑）
const { THRESHOLDS, resolveThresholds, compareSnapshots, ENV_OF } = await import(pathToFileURL(path.join(ROOT, 'tools', 'baseline-diff.mjs')).href)
const { BASELINE_SCHEMA, mpwValidateSnapshot } = await import(pathToFileURL(path.join(ROOT, 'core', 'baseline-metrics.mjs')).href)
const { values: TH, from: TH_FROM } = resolveThresholds(process.env)

const dig = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, o)
const fmtMs = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : (Number(v) >= 10000 ? (Number(v) / 1000).toFixed(1) + 's' : Number(v).toFixed(0) + 'ms')
const fmtFps = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(1)
const fmtMB = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : (Number(v) / 1048576).toFixed(2) + 'MB'
const fmtPct = (p) => (p === null || p === undefined) ? '' : (p === Infinity ? '+∞' : p === -Infinity ? '−∞' : (p > 0 ? '+' : '') + p.toFixed(1) + '%')
const stamp = (o) => { const t = Date.parse(o.at); return Number.isFinite(t) ? t : Number(String(o.file).replace(/\.json$/, '')) || 0 }
/** 指标路径 → 表里用的短名（判定列窄，别把 `switch.swapTo.ms` 挤成 "ms"）。 */
const SHORT = {
  'startup.totalMs': '启动', 'startup.navToFirstFrameMs': '首帧', 'fps.median': 'FPS',
  'switch.swapTo.ms': '切换', 'vramProxy.textureBytesEst': 'VRAM',
}
const short = (r) => SHORT[r.path] || r.label || r.path
const pad = (s, n) => { let w = 0; for (const ch of String(s)) w += (ch.charCodeAt(0) > 255 ? 2 : 1); return String(s) + ' '.repeat(Math.max(0, n - w)) }

// ── 读盘：两份来源各自校验（**不合 schema 的是红**，不是静默跳过）────────────────
const invalid = []
const snaps = []
function ingest(dir, kind) {
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch (e) { return 0 }
  let n = 0
  for (const f of files.sort()) {
    const file = path.join(dir, f)
    let o = null
    try { o = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { invalid.push({ file: rel(file), why: 'JSON 解析失败：' + e.message }); continue }
    // 顶层**必须是 JSON 对象**：`null`/数字/字符串/数组都过得了 `JSON.parse`，但下面 `o.file = …` 会当场
    // TypeError 把整个脚本炸掉（2026-09-18 真发生过：一次被中断的采集留下 5 字节的半截文件，内容恰好是
    // `null`，趋势脚本于是以 `Cannot set properties of null` 红掉，掩盖了真正的数据问题）。
    // 这类文件是**坏输入**，该报成"不合 schema"（退出码 1）并指名文件，而不是崩在赋值行上。
    if (o === null || typeof o !== 'object' || Array.isArray(o)) {
      const peek = fs.readFileSync(file, 'utf8').slice(0, 40).replace(/\s+/g, ' ')
      /*  ⓪(2026-10-13 task-19) **点名生产者、改掉错误归因**（判据不变：坏输入仍然是红，不许豁免换绿）。
          原文写"多半是采集被**中断**留下的半截文件"——2026-10-13 实测**不是**中断：
          `SIGKILL` 不会产生 5 字节的 `null`，那是 `JSON.stringify(null)` 的**完整**产物（连换行都写全了）。
          真因在**生产者自己的写盘路径**：报告对象在 try 内构建，异常发生在它之前时 `report` 仍是 `null`，
          而写盘那一段没检查类型 ⇒ 先落一个 `null`，下一行 `report.file = …` 当场 TypeError 崩掉
          （于是生产者自己的汇总/真因都打不出来）。已修：`tests/real-machine-check.mjs` 写盘前判类型，
          非对象**绝不落盘**；这份判据留着就是为了**继续抓**同类回归。 */
      const producer = kind === 'real-machine'
        ? 'tests/real-machine-check.mjs（`node tests/real-machine-check.mjs` → reports/real-machine/<epochms>.json）'
        : '真机 `?baseline=1` 的 POST /baseline（server/we-scene-demo-server.mjs → reports/baselines/<epochms>.json）'
      invalid.push({ file: rel(file), why: '顶层不是 JSON 对象（' + (o === null ? 'null' : Array.isArray(o) ? 'array' : typeof o) + '）'
        + '—— 生产者：' + producer
        + '；5 字节的 `null` 是"写盘前没检查报告对象是不是对象"留下的（**不是**"采集中断"：SIGKILL 不会写出完整的 5B null）'
        + '—— 原文前 40 字符：' + JSON.stringify(peek) })
      continue
    }
    o.file = rel(file)
    if (kind === 'baseline') {
      const v = mpwValidateSnapshot(o)
      if (!v.ok) { invalid.push({ file: rel(file), why: '不是完整快照：' + v.errors.slice(0, 4).join('；') }); continue }
      if (Number(o.schema) !== BASELINE_SCHEMA) { invalid.push({ file: rel(file), why: 'schema=' + o.schema + ' ≠ ' + BASELINE_SCHEMA }); continue }
      if (o.kind !== 'baseline') { invalid.push({ file: rel(file), why: 'kind=' + JSON.stringify(o.kind) + ' ≠ "baseline"' }); continue }
    } else {
      // real-machine：字段路径与基线快照同源，但**没有 GPU 帧**（fps.* 全 null）⇒ 不走 mpwValidateSnapshot
      const miss = ['at', 'id', 'startup.totalMs'].filter((p) => dig(o, p) === undefined)
      if (o.kind !== 'real-machine' || Number(o.schema) !== 1 || miss.length) {
        invalid.push({ file: rel(file), why: 'real-machine 报告残缺（kind=' + JSON.stringify(o.kind) + ', schema=' + o.schema + ', 缺 ' + miss.join('/') + '）' })
        continue
      }
    }
    snaps.push({ kind, o, t: stamp(o) })
    n++
  }
  return n
}
function rel(p) { return path.relative(ROOT, p) }
const nBase = ingest(path.join(REPORTS, 'baselines'), 'baseline')
const nReal = ingest(path.join(REPORTS, 'real-machine'), 'real-machine')

if (!snaps.length) {
  console.log('SKIP ' + NAME + '（' + rel(REPORTS) + '/baselines 与 ' + rel(REPORTS) + '/real-machine 里一份快照都没有）')
  console.log('怎么产出：真机（有 GPU）开 `?baseline=1` → POST /baseline 落 reports/baselines/<epochms>.json；')
  console.log('本机（无 GPU）跑 `node tests/real-machine-check.mjs` 落 reports/real-machine/<epochms>.json。')
  console.log('两份来源不同**不混组**：baseline=真机帧率/显存代理，real-machine=无 GPU 的结构冒烟（fps 恒 null）。')
  if (invalid.length) { for (const b of invalid) console.log('   ✗ ' + b.file + '：' + b.why); process.exit(1) }
  process.exit(0)
}

// ── 分组：kind + id（**不同 kind / 不同包不许混**：阈值只对"同机同包同档位"的趋势有意义）──
const groups = new Map()
for (const s of snaps) {
  const key = s.kind + ' :: ' + String(s.o.id)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(s)
}
const trends = []
for (const [key, arr] of [...groups.entries()].sort()) {
  arr.sort((a, b) => a.t - b.t)
  const rows = []
  let prev = null
  for (const s of arr) {
    const o = s.o
    const row = {
      file: o.file, at: o.at, id: o.id, kind: s.kind,
      startupMs: num(dig(o, 'startup.totalMs')), firstFrameMs: num(dig(o, 'startup.navToFirstFrameMs')),
      fpsMedian: num(dig(o, 'fps.median')), switchMs: num(dig(o, 'switch.swapTo.ms')),
      vramBytes: num(dig(o, 'vramProxy.textureBytesEst')),
      verdict: null, regressions: [], deltas: {},
    }
    if (prev) {
      const cmp = compareSnapshots(prev.o, o, TH)          // ← 与 baseline-diff 同一实现/同一阈值
      for (const m of ['startup.totalMs', 'startup.navToFirstFrameMs', 'fps.median', 'switch.swapTo.ms', 'vramProxy.textureBytesEst']) {
        const r = cmp.rows.find((x) => x.path === m)
        if (r && r.verdict !== 'skip') row.deltas[m] = { base: r.base, cur: r.cur, delta: r.delta, pct: r.pct, verdict: r.verdict, why: r.why, threshold: r.threshold }
      }
      row.regressions = cmp.regressions.map((r) => ({ path: r.path, label: r.label, base: r.base, cur: r.cur, pct: (r.pct === Infinity ? 'Infinity' : r.pct), threshold: r.threshold }))
      row.verdict = row.regressions.length ? 'regression' : 'ok'
    }
    rows.push(row); prev = s
  }
  trends.push({ key, kind: arr[0].kind, id: arr[0].o.id, n: arr.length, rows })
}
const newestPairRegressions = trends.flatMap((g) => {
  const last = g.rows[g.rows.length - 1]
  return last && last.regressions.length ? [{ group: g.key, file: last.file, regressions: last.regressions }] : []
})

// ── 打印 ─────────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: invalid.length === 0, sources: { baselines: nBase, realMachine: nReal },
    thresholds: TH, thresholdsFromEnv: TH_FROM, invalid,
    newestPairRegressions, trends,
  }, null, 1))
} else {
  const envNote = Object.keys(TH_FROM).length ? '；env 覆盖 ' + Object.keys(TH_FROM).map((k) => ENV_OF[k] + '=' + TH_FROM[k].value).join(', ') : ''
  console.log('趋势表（阈值 ' + NAME + '：帧 ' + TH.framePct + '% / 帧率 ' + TH.fpsPct + '% / 启动 ' + TH.startupPct
    + '% / 代理 ' + TH.vramPct + '% / 切换 ' + TH.switchPct + '% + 噪声地板 ' + TH.msFloor + 'ms·' + TH.fpsFloor + 'fps·'
    + (TH.bytesFloor / 1048576) + 'MB·' + TH.countFloor + '个' + envNote + '）')
  console.log('来源：reports/baselines 快照 ' + nBase + ' 份（真机 ?baseline=1） / reports/real-machine 报告 ' + nReal + ' 份（无 GPU 结构冒烟）')
  console.log('⚠ 口径：只比"同一组（同 kind + 同包）"的相邻两份；跨组/跨机的数字不可比（VRAM 是**代理估算**，不是显存占用）')
  for (const g of trends) {
    const rows = g.rows.slice(-LIMIT)
    console.log('')
    console.log('── ' + g.key + '（' + g.n + ' 份' + (g.n > rows.length ? '，只显示最近 ' + rows.length : '') + '）')
    const W = [20, 11, 11, 8, 11, 11, 12, 12]
    const line = (c) => '  ' + c.map((x, i) => pad(x, W[i])).join(' ')
    console.log(line(['时间', '启动总(ms)', '首帧(ms)', 'FPS 中位', '切换(ms)', 'VRAM 代理', 'Δ启动', '判定']))
    console.log('  ' + '─'.repeat(W.reduce((a, b) => a + b + 1, 0)))
    for (const r of rows) {
      const d = r.deltas['startup.totalMs']
      const tag = !r.verdict ? '（首份=基线）' : (r.regressions.length ? '⚠ 退化 ' + r.regressions.map((x) => short(x) + ' ' + fmtPct(x.pct)).join(' / ') : '· 阈值内')
      console.log(line([
        String(r.at || '?').replace('T', ' ').slice(0, 19), fmtMs(r.startupMs), fmtMs(r.firstFrameMs), fmtFps(r.fpsMedian),
        fmtMs(r.switchMs), fmtMB(r.vramBytes), d ? fmtPct(d.pct) : '', tag,
      ]))
    }
    const last = rows[rows.length - 1]
    for (const k of ['startup.totalMs', 'startup.navToFirstFrameMs', 'fps.median', 'switch.swapTo.ms', 'vramProxy.textureBytesEst']) {
      const d = last && last.deltas[k]
      if (d) console.log('  Δ ' + k + '：' + JSON.stringify(d.base) + ' → ' + JSON.stringify(d.cur) + '（' + fmtPct(d.pct) + '，阈值 ' + d.threshold + '%，' + d.why + '）')
    }
    if (last && last.verdict === null) console.log('  （只有一份 ⇒ 没有差值；再采一份才有趋势）')
  }
  for (const b of invalid) console.log('✗ 不合 schema：' + b.file + ' — ' + b.why)
  console.log('')
  if (newestPairRegressions.length) {
    console.error('⚠ 最新一对存在退化（共 ' + newestPairRegressions.length + ' 组）：' + newestPairRegressions.map((x) => x.group + ' → ' + x.regressions.map((r) => short(r) + '(' + r.path + ') ' + fmtPct(r.pct)).join('/')).join('；'))
    console.error('  说明：本脚本**默认只告警**（历史趋势里的旧退化不该让门禁永远红）；要当硬闸门用 `--strict`。')
  } else if (!invalid.length) {
    console.log('✓ 没有超阈值的退化（含"只有一份、无从比较"的情况）')
  }
}

// ── 退出码：schema 不合 = 红（真问题）；趋势退化只有 --strict 才红（避免历史数据把门禁钉死）──
if (invalid.length) process.exit(1)
if (STRICT && newestPairRegressions.length) process.exit(1)
process.exit(0)

function num(v) { return (v === null || v === undefined || !Number.isFinite(Number(v))) ? null : Number(v) }

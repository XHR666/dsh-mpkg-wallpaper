// layer-attribution-matrix.mjs —— B1【跨包】层归因矩阵：四个语料根 × 每层"是否出像素/归因类/实绘矩形"
//
// 与 renderer-gap-matrix（真机双档）的分工：本文件走 **C0 的离线归因**（tests/layer-attribution.mjs
//   的 attributeScene：真 parseScene + mock GL + 真 renderScene，无 `__lnHidden`、无真机兜底分支），
//   可以全库扫、按**机制类**聚合（skipReason / bind / copybg 路径），真机一致性已由
//   layer-attribution-consistency.mjs 在 3 包上钉死（12/0）。
// 分批纪律（照 renderer-gap-matrix）：`--offset/--limit` 每批独立跑、读数按 rel 增量合并进
//   `--out`（分多批 = 一份完整 JSON）；`--max-mb`（默认 250）跳过超大包；每包前查可用内存
//   （`--min-free-mb` 默认 900，低于即停批——15GB 机器 OOM 两次的教训）。
// 聚合口径（人读表 docs/reports-layer-attribution-matrix.md 引用）：
//   机制类 = skipReason 枚举（invisible/invisible-config/invisible-anim/container/logical-helper/
//   particle-*/degenerate-geometry/draw-failed/not-drawn）+ bind 枚举（texture/rtcopy/solidcolor/
//   transparent/particle/white/mesh）；每类给包/层数 + 样例。
// copybg 点验（B2 的全量面）：每包 `copybg:{n, withTex, noTexNoFx, noTexFx, rtcopy}` ——
//   P-230 语义下 noTexNoFx=画自己的内容（纯色卡/透明）、noTexFx=换入（rtcopy）。
// 用法：
//   node tests/layer-attribution-matrix.mjs --offset 0 --limit 60
//   node tests/layer-attribution-matrix.mjs --summary          # 只重算聚合（不扫）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { attributeScene } from './layer-attribution.mjs'
import * as lib from '../core/we-scene-bundle.js'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const has = (k) => argv.includes(k)
const OUT = argVal('--out') || path.join(ROOT, 'reports', 'layer-attribution-matrix.json')
const OFFSET = Number(argVal('--offset') || 0)
const LIMIT = Number(argVal('--limit') || 0)
const MAX_MB = Number(argVal('--max-mb') || 250)
const MIN_FREE_MB = Number(argVal('--min-free-mb') || 900)
const ROOTS = (argVal('--roots') || 'dd,0923,0917,wallpaperE,1004').split(',').map((s) => s.trim()).filter(Boolean)
  .map((r) => path.join(WS, 'allwallpaper', r)).filter((p) => fs.existsSync(p))
const dec = new TextDecoder()

function walkContainers(root, out = []) {
  let names = []
  try { names = fs.readdirSync(root) } catch (e) { return out }
  for (const n of names) {
    const p = path.join(root, n)
    let st = null
    try { st = fs.statSync(p) } catch (e) { continue }
    if (st.isDirectory()) walkContainers(p, out)
    else if (/\.(mpkg|pkg)$/i.test(n)) out.push(p)
  }
  return out
}
const freeMB = () => {
  try { const l = fs.readFileSync('/proc/meminfo', 'utf8'); const m = /MemAvailable:\s+(\d+) kB/.exec(l); return m ? Math.round(Number(m[1]) / 1024) : 4096 } catch (e) { return 4096 }
}

async function sweepPackage(pkgPath) {
  const rel = path.relative(WS, pkgPath)
  const id = path.basename(path.dirname(pkgPath))
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const se = ['scene.json', 'Scene.json'].map(entry).find(Boolean)
  if (!se) return { id, rel, skipped: 'no-scene-json' }
  const sceneObj = JSON.parse(dec.decode(se).replace(/^\uFEFF/, ''))
  let propsMap = null, schema = null
  try {
    const pj = entry('project.json') || (fs.existsSync(path.join(path.dirname(pkgPath), 'project.json')) ? fs.readFileSync(path.join(path.dirname(pkgPath), 'project.json')) : null)
    const pr = pj ? JSON.parse(dec.decode(pj)) : null
    if (pr && pr.general && pr.general.properties) { schema = pr.general.properties; propsMap = lib.propsDefaults ? lib.propsDefaults(schema) : null }
  } catch (e) {}
  const out = await attributeScene(sceneObj, { id, propsMap, propertiesSchema: schema, pkg, readEntry: entry,
    readParticleDef: (p) => { try { const e = entry(p); return e ? JSON.parse(dec.decode(e)) : null } catch (e2) { return null } } },
    { time: 20, campose: 'legacy' })
  // copybg 点验（B2 全量面）
  const copybg = { n: 0, withTex: 0, noTexNoFx: 0, noTexFx: 0, rtcopy: 0 }
  for (const l of out.layers) {
    if (!l.copybg) continue
    copybg.n++
    if (l.texture) copybg.withTex++
    else if (l.passes > 0) copybg.noTexFx++
    else copybg.noTexNoFx++
    if (l.bind === 'rtcopy') copybg.rtcopy++
  }
  // not-drawn 逐层明细（B1 遗留：137 层逐条查清）——按 type/粒子标记分族
  const notDrawn = out.layers.filter((l) => l.skipReason === 'not-drawn')
    .map((l) => ({ name: l.name.slice(0, 24), type: l.type, particle: !!l.particle, tex: l.texture ? 1 : 0, fx: l.passes }))
  return {
    id, rel,
    layers: out.summary.layers, drawn: out.summary.drawn, skipped: out.summary.skipped,
    skipReasons: out.summary.skipReasons, binds: out.summary.binds, copybg,
    ...(notDrawn.length ? { notDrawn } : {}),
    renderErr: out.summary.renderErr || null,
  }
}

function aggregate(rows) {
  const skip = {}, binds = {}, copybg = { pkgs: 0, n: 0, withTex: 0, noTexNoFx: 0, noTexFx: 0, rtcopy: 0 }
  const samples = {}
  const sample = (k, it) => { if (!samples[k]) samples[k] = []; if (samples[k].length < 2) samples[k].push(it) }
  for (const r of rows) {
    // 成功行的 `skipped` 是**数字**（未上屏层数），错误行的 `skipped` 是字符串原因 ⇒ 只对有 binds 的成功行聚合
    if (!r.binds) continue
    for (const [k, n] of Object.entries(r.skipReasons || {})) { skip[k] = (skip[k] || 0) + n; sample('skip:' + k, { pkg: r.id, n }) }
    for (const [k, n] of Object.entries(r.binds || {})) { binds[k] = (binds[k] || 0) + n; sample('bind:' + k, { pkg: r.id, n }) }
    if (r.copybg && r.copybg.n) {
      copybg.pkgs++; copybg.n += r.copybg.n; copybg.withTex += r.copybg.withTex
      copybg.noTexNoFx += r.copybg.noTexNoFx; copybg.noTexFx += r.copybg.noTexFx; copybg.rtcopy += r.copybg.rtcopy
    }
  }
  return { skipReasons: skip, binds, copybg, samples }
}

async function main() {
  const files = ROOTS.flatMap((r) => walkContainers(r)).sort()
    .filter((f) => { try { return fs.statSync(f).size <= MAX_MB * 1048576 } catch (e) { return false } })
  let base = { generatedAt: new Date().toISOString(), note: '离线层归因矩阵（C0 工具全库扫；真机一致性见 layer-attribution-consistency 12/0）', roots: ROOTS.map((r) => path.relative(WS, r)), corpus: { containers: files.length, maxMB: MAX_MB }, runs: [], rows: {} }
  try { base = JSON.parse(fs.readFileSync(OUT, 'utf8')); base.corpus = { containers: files.length, maxMB: MAX_MB } } catch (e) {}
  const slice = LIMIT > 0 ? files.slice(OFFSET, OFFSET + LIMIT) : files.slice(OFFSET)
  const run = { offset: OFFSET, limit: LIMIT, startedAt: new Date().toISOString(), done: 0, skipped: [], lowMem: 0 }
  for (const f of slice) {
    const rel = path.relative(WS, f)
    if (base.rows[rel]) { run.done++; continue } // 增量：已有读数跳过
    const free = freeMB()
    if (free < MIN_FREE_MB) { run.lowMem++; run.skipped.push(rel + '（lowMem ' + free + 'MB）'); continue }
    try {
      const r = await sweepPackage(f)
      base.rows[rel] = r
      run.done++
      process.stdout.write('  [' + run.done + '/' + slice.length + '] ' + rel + ' layers=' + (r.layers != null ? r.layers : r.skipped) + '\r')
    } catch (e) {
      base.rows[rel] = { id: path.basename(path.dirname(f)), rel, skipped: 'err: ' + String(e.message).slice(0, 120) }
      run.done++
    }
  }
  run.finishedAt = new Date().toISOString()
  base.runs.push(run)
  const rows = Object.values(base.rows)
  base.aggregates = aggregate(rows)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(base, null, 1))
  console.log('\n批完成：done=' + run.done + ' lowMem=' + run.lowMem + ' 总行=' + rows.length + ' → ' + path.relative(ROOT, OUT))
  const a = base.aggregates
  console.log('聚合：skipReasons=' + JSON.stringify(a.skipReasons))
  console.log('      binds=' + JSON.stringify(a.binds))
  console.log('      copybg=' + JSON.stringify(a.copybg))
}
if (has('--summary')) {
  const base = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  base.aggregates = aggregate(Object.values(base.rows))
  fs.writeFileSync(OUT, JSON.stringify(base, null, 1))
  console.log(JSON.stringify(base.aggregates, null, 1))
} else await main()

#!/usr/bin/env node
/**
 * scene-video-verdict-audit.mjs —— 「scene 内嵌视频」两条判定路径的等价性审计（只读，不改任何仓库/缓存）
 *
 * 背景：`lib/pkg-extract.js` 的**快路径**（索引先行 + 前缀判定）与**legacy 口径**
 *   （整包 `parsePkg` + 全量 TEX 解析）是两套独立实现 —— 前者替代后者跑在"应用壁纸"的关键路径上。
 *   两套实现必须**判定一致**（has video / 选中哪一条 / 提取字节 sha256 相同），否则会出现
 *   "清单说没有视频、提取路径说有"这类幽灵 bug（参照上游 issue #136 的"不允许判定分叉"）。
 *
 * 本工具就是那条审计：对每个容器分别跑两条路径并逐项对拍，读数落 JSON。
 * **只读语料**；默认不写缓存（`cache:false`），不触碰插件的数据目录。
 *
 * 用法：
 *   node tools/scene-video-verdict-audit.mjs                 # 扫默认库（环境变量 MPW_SCENE_ROOT / 工作区 allwallpaper）
 *   node tools/scene-video-verdict-audit.mjs --all           # 全量（默认就是全量；--sample N 才是抽样）
 *   node tools/scene-video-verdict-audit.mjs --sample 12     # 抽样 12 个（含大/中/小与已知有视频的）
 *   node tools/scene-video-verdict-audit.mjs --json out.json # 指定读数落盘（默认 /tmp/scene-video-verdict-audit.json）
 *   node tools/scene-video-verdict-audit.mjs --roots 0923,1004
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import {
  parsePkg, readPkgEntry, collectSceneVideoFiles, scanSceneVideo,
} from '../lib/pkg-extract.js'

const WS = process.env.MPW_WS || '/root/Desktop/DSHarea'
const argv = process.argv.slice(2)
const argVal = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const ROOTS = (argVal('--roots', '0917,0923,dd,wallpaperE,1004')).split(',').map((s) => s.trim()).filter(Boolean)
const SAMPLE = Number(argVal('--sample', '0')) || 0
const OUT = argVal('--json', '/tmp/scene-video-verdict-audit.json')
const sha = (b) => (b && b.length ? createHash('sha256').update(b).digest('hex').slice(0, 32) : null)

/* legacy 口径的选择规则（照 lib/index.js findSceneVideoInPkg，一字不差） */
function legacyPick(videos) {
  if (!videos.length) return null
  const standalone = videos.filter((v) => !v.isTexEmbedded)
  if (standalone.length) { standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0)); return standalone[0] }
  if (videos.length === 1) return videos[0]
  return null
}
function verdictOf(v) {
  return v ? { has: true, ref: v.ref, tex: !!v.isTexEmbedded, bytes: v.bytes ? v.bytes.length : null, sha256: sha(v.bytes) } : { has: false, ref: null, tex: null, bytes: null, sha256: null }
}

/* ── 枚举容器 ─────────────────────────────────────────────────────────── */
const targets = []
const walk = (dir, depth) => {
  if (depth > 3) return
  let names = []
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    const p = join(dir, n)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      const sp = join(p, 'scene.pkg')
      if (existsSync(sp)) targets.push({ kind: 'dir', pkg: sp, label: p.slice(WS.length + 1), size: statSync(sp).size })
      else walk(p, depth + 1)
    } else if (/\.mpkg$/i.test(n)) {
      targets.push({ kind: 'mpkg', pkg: p, label: p.slice(WS.length + 1), size: st.size })
    }
  }
}
for (const r of ROOTS) { const abs = join(WS, 'allwallpaper', r); if (existsSync(abs)) walk(abs, 0) }
targets.sort((a, b) => a.size - b.size)

let picked = targets
if (SAMPLE > 0) {
  // 抽样：小 1/3、中 1/3、大 1/3，且尽量带上"已知有视频"的（妃咲/孤独の少女 等按名字命中）
  const n = targets.length
  const third = Math.max(1, Math.floor(SAMPLE / 3))
  const small = targets.slice(0, third)
  const mid = targets.slice(Math.floor(n / 2) - Math.floor(third / 2), Math.floor(n / 2) - Math.floor(third / 2) + third)
  const big = targets.slice(-(SAMPLE - small.length - mid.length))
  const byName = targets.filter((t) => /妃咲|孤独|1004\//.test(t.label)).slice(0, 2)
  const set = new Map()
  for (const t of [...small, ...mid, ...big, ...byName]) set.set(t.label, t)
  picked = [...set.values()]
}

console.log(`容器 ${targets.length} 个；本次审计 ${picked.length} 个（roots=${ROOTS.join(',')}${SAMPLE ? `，--sample ${SAMPLE}` : '，全量'}）`)

/* ── 逐容器对拍 ───────────────────────────────────────────────────────── */
const rows = []
let mismatches = 0
for (const t of picked) {
  const row = { label: t.label, kind: t.kind, mb: +(t.size / 1048576).toFixed(2) }
  try {
    // legacy：整包读 + 全量解析（这就是"改前"的成本口径）
    const tb0 = process.hrtime.bigint()
    const data = new Uint8Array(readFileSync(t.pkg))
    const entries = parsePkg(data)
    const videos = collectSceneVideoFiles({ list: () => entries.map((e) => ({ path: e.path, read: () => readPkgEntry(data, e) })) })
    const legacy = legacyPick(videos)
    row.legacy = verdictOf(legacy)
    row.legacy.texCandidates = videos.length
    row.legacyMs = +(Number(process.hrtime.bigint() - tb0) / 1e6).toFixed(1)
    row.legacyBytesRead = t.size
  } catch (e) { row.legacyErr = String((e && e.message) || e).slice(0, 120); row.legacy = { has: null } }
  try {
    // 快路径：索引先行（不写缓存）
    const tf0 = process.hrtime.bigint()
    const res = scanSceneVideo(t.pkg, { cache: false })
    row.fast = verdictOf(res.video)
    row.fastMs = +(Number(process.hrtime.bigint() - tf0) / 1e6).toFixed(1)
    row.fastBytesRead = res.bytesRead
    row.fastIndexEntries = res.indexEntries
  } catch (e) { row.fastErr = String((e && e.message) || e).slice(0, 120); row.fast = { has: null } }

  const same = row.legacy.has === row.fast.has
    && (row.legacy.ref || null) === (row.fast.ref || null)
    && (row.legacy.sha256 || null) === (row.fast.sha256 || null)
  row.same = same
  if (!same) mismatches++
  rows.push(row)
  if (!same && mismatches <= 8) {
    console.log(`  ✗ ${row.label}\n      legacy ${JSON.stringify(row.legacy)}\n      fast   ${JSON.stringify(row.fast)}${row.legacyErr ? ' legacyErr=' + row.legacyErr : ''}${row.fastErr ? ' fastErr=' + row.fastErr : ''}`)
  } else if (row.legacy.has && mismatches === 0 && rows.length % 25 === 0) {
    console.log(`  … ${rows.length}/${picked.length} 已审计（最近：${row.label}，一致）`)
  }
}

const withVideo = rows.filter((r) => r.legacy.has).length
const legacyBytes = rows.reduce((a, r) => a + (r.legacyBytesRead || 0), 0)
const fastBytes = rows.reduce((a, r) => a + (r.fastBytesRead || 0), 0)
const summary = {
  at: new Date().toISOString(), roots: ROOTS, audited: rows.length, containers: targets.length,
  mismatches, withVideo,
  legacyBytesRead: legacyBytes, fastBytesRead: fastBytes,
  readRatio: legacyBytes ? +(fastBytes / legacyBytes).toFixed(5) : null,
  legacyMsSum: +rows.reduce((a, r) => a + (r.legacyMs || 0), 0).toFixed(0),
  fastMsSum: +rows.reduce((a, r) => a + (r.fastMs || 0), 0).toFixed(0),
}
writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1))
console.log(`\n审计完成：${rows.length} 个容器 · 判定不一致 ${mismatches} 个 · 含视频 ${withVideo} 个`)
console.log(`读量：legacy ${(legacyBytes / 1048576).toFixed(1)} MB → 快路径 ${(fastBytes / 1048576).toFixed(2)} MB（${(100 * fastBytes / Math.max(1, legacyBytes)).toFixed(2)}%）`)
console.log(`耗时合计：legacy ${summary.legacyMsSum} ms → 快路径 ${summary.fastMsSum} ms`)
console.log(`读数：${OUT}`)
process.exit(mismatches ? 1 : 0)

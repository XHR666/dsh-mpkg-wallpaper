// report-audit.mjs — 读渲染器自动上报（reports/r*.json），逐层对账定位"坐标/可见性"问题
//
// 为什么要有它：上报是设备（Android WebView）唯一的现场。历史上定位慢，是因为每次都在手搓脚本、
// 而且把"层 origin"当成"层画在哪"（origin 是枢轴，长发这类 12% 不透明的层枢轴常落在透明像素上 → 误判）。
// 本工具把四类证据一次对齐（任务书 C5.3 增强后为六段）：
//   ① layers[]：设备端 origin/size  ↔  本地 parseScene(attachCtx) 期望值
//   ② 【DIAG】行：设备端逐层像素采样  ↔  CPU 预览（正确渲染）同点颜色
//   ③ layerLedger[]（P-32）：该层**实际绘制的设计坐标矩形** + 矩形中心像素 + 纹理种类/alpha
//   ④ texStats[]（P-32）：每张纹理的解码尺寸/RGB 均值/alpha 均值/全透明占比
//   ⑤ 层健康表（C5.3 新增）：优先读 A 会话约定的 `layerHealth[]`
//      （{name,drawn,rect,px,tex,alpha,fx,glErr,skipReason}，TASK-A §4）；无该字段时**回退**
//      由 layers[]/layerLedger[] 推导（drawn/v/tex/px），并输出一句话汇总。
//   ⑥ 跨报告趋势（C5.3 新增，--trend）：同一场景多份上报的逐层矩形对比——
//      "稳定错"（各份一致但偏离期望）vs "抽动"（各份之间矩形在变）。
//
// 用法:
//   node report-audit.mjs                 # 最新一份上报
//   node report-audit.mjs reports/rXXX.json
//   node report-audit.mjs --all           # 最近 5 份都看
//   node report-audit.mjs --trend [N]     # 每个场景取最近 N 份（默认 5）做跨报告趋势
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.MPW_ROOT || WS; // ①(去个人化) 可覆盖
const REPORTS = path.join(DIR, 'reports')

const args = process.argv.slice(2)
const TREND = args.includes('--trend')
const TREND_N = (() => { const i = args.indexOf('--trend'); const v = Number(args[i + 1]); return v >= 2 ? v : 5 })()
const all = args.includes('--all')
let files = fs.readdirSync(REPORTS).filter((f) => /^r\d+\.json$/.test(f))
  .map((f) => [f, fs.statSync(path.join(REPORTS, f)).mtimeMs]).sort((a, b) => a[1] - b[1]).map((x) => x[0])
if (TREND) {
  // 按场景分组取最近 N 份
  const byScene = new Map()
  const byFile = new Map()
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8'))
      const id = String(d.id || '').replace(/[?&].*$/, '')
      if (!id) continue
      byFile.set(f, d)
      if (!byScene.has(id)) byScene.set(id, [])
      byScene.get(id).push(f)
    } catch {}
  }
  const picked = []
  for (const [id, fs_] of byScene) picked.push(...fs_.slice(-TREND_N))
  files = picked
} else if (!all && args[0] && !args[0].startsWith('--')) files = [path.basename(args[0])]
else if (!all) files = files.slice(-1)
else files = files.slice(-5)

// 期望值按"上报里的 id"动态构建（同一份脚本可按 id 逐个场景对账）
const lib = await import(process.env.MPW_BUNDLE || (DIR + '/we-scene-demo/core/we-scene-bundle.js'))
const DEC = new TextDecoder()
const expCache = new Map()
function expectedFor(sceneId) {
  if (expCache.has(sceneId)) return expCache.get(sceneId)
  const out = new Map()
  const pkgPath = path.join(DIR, 'allwallpaper', 'dd', sceneId, 'scene.pkg')
  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
      const readEntry = (n) => lib.getEntry(pkg, n)
      const sj = JSON.parse(DEC.decode(readEntry('scene.json')).replace(/^\uFEFF/, ''))
      const scene = lib.parseScene(JSON.parse(JSON.stringify(sj)), null, { attachCtx: { readEntry, time: 0 } })
      scene.layers.forEach((l, i) => out.set(i, { name: l.name, x: l.origin[0], y: l.origin[1] }))
    }
  } catch (e) { /* 无本地包（mpkg 类）→ 跳过 origin 对账 */ }
  expCache.set(sceneId, out)
  return out
}
let expected = new Map()

const pad = (s, n) => String(s).padEnd(n)
const num = (v) => (typeof v === 'number' ? Math.round(v) : v)

// —— ⑤ 层健康表（C5.3）：优先 layerHealth[]，回退 layers[]/layerLedger 推导 ——
function healthRows(d) {
  if (Array.isArray(d.layerHealth) && d.layerHealth.length) {
    return { src: 'layerHealth', rows: d.layerHealth }
  }
  const meta = new Map()
  for (const L of d.layers || []) { if (!meta.has(L.n)) meta.set(L.n, L) }
  const rows = []
  for (const e of d.layerLedger || []) {
    const m = meta.get(e.n) || {}
    rows.push({
      name: e.n, drawn: 1, rect: e.rd, px: e.px,
      tex: e.t, alpha: e.a, fx: m.fx, glErr: null,
      skipReason: (m.v === 0) ? 'invisible(本帧)' : (e.t === 'white' || e.t === 'transp') ? `fallback-tex(${e.t})` : null,
    })
  }
  // 可见但从未进台账的层（drawn=0）
  for (const L of d.layers || []) {
    if (L.v === 1 && L.drawn === 0 && !(d.layerLedger || []).some((e) => e.n === L.n)) {
      rows.push({ name: L.n, drawn: 0, rect: null, px: null, tex: L.tn ? 'missing' : 'none', alpha: L.a, fx: L.fx, glErr: null, skipReason: L.skin === 1 ? 'mesh(不走台账)' : 'not-in-ledger' })
    }
  }
  return { src: 'derived(layers+ledger)', rows }
}
function printHealth(d) {
  const { src, rows } = healthRows(d)
  const drawn = rows.filter((r) => r.drawn === 1)
  const skipped = rows.filter((r) => r.drawn !== 1 && r.skipReason)
  const glErrs = rows.filter((r) => r.glErr)
  const clearMiss = rows.filter((r) => r.px && Math.abs(r.px[0] - 178) <= 3 && Math.abs(r.px[1] - 178) <= 3 && Math.abs(r.px[2] - 178) <= 3)
  console.log(`  ⑤ 层健康（${src}）：本帧 ${rows.length} 层 → 正常 ${drawn.length} / 跳过 ${skipped.length} / GPU错 ${glErrs.length} / 中心=清屏灰 ${clearMiss.length}`)
  for (const r of skipped.slice(0, 8)) console.log(`     ↳ ${pad(r.name, 12)} skipReason=${r.skipReason || '-'} tex=${r.tex ?? '-'} fx=${r.fx ?? '-'}`)
  for (const r of glErrs.slice(0, 5)) console.log(`     ↳ ${pad(r.name, 12)} glErr=${r.glErr}`)
}

// —— ⑥ 跨报告趋势（C5.3，--trend）——
function printTrend(fileGroups, expect) {
  // fileGroups: [{file, d}] 按时间升序，同一场景
  if (fileGroups.length < 2) return
  const perReport = new Map()   // name -> [rectCenter...]（按报告序）
  for (const { d } of fileGroups) {
    for (const e of d.layerLedger || []) {
      if (!perReport.has(e.n)) perReport.set(e.n, [])
      perReport.get(e.n).push(e.rd ? [e.rd[0] + e.rd[2] / 2, e.rd[1] + e.rd[3] / 2] : null)
    }
  }
  const stable = [], jitter = [], appear = []
  for (const [name, centers] of perReport) {
    const present = centers.filter(Boolean)
    if (present.length < fileGroups.length) { appear.push(`${name}(${present.length}/${fileGroups.length})`); continue }
    let maxD = 0
    for (const c of present) for (const c2 of present) maxD = Math.max(maxD, Math.hypot(c[0] - c2[0], c[1] - c2[1]))
    // 与期望（锚点后 parseScene）比：判定"稳定错"
    let dExp = null
    const e0 = [...expected.values()].find((v) => v.name === name)
    if (e0) dExp = Math.hypot(present[0][0] - e0.x, present[0][1] - e0.y)
    if (maxD > 2) jitter.push(`${name}(Δ${Math.round(maxD)}px${dExp !== null ? `,距期望${Math.round(dExp)}px` : ''})`)
    else if (dExp !== null && dExp > 2) stable.push(`${name}(距期望${Math.round(dExp)}px)`)
  }
  console.log(`  ⑥ 跨报告趋势（${fileGroups.length} 份，${fileGroups.map((g) => g.file.replace(/^r|\.json$/g, '')).join('→')}）：`)
  console.log(`     稳定错（各份一致但偏离期望，改渲染语义可修）：${stable.length ? stable.slice(0, 8).join('、') : '无'}`)
  console.log(`     抽动（各份之间矩形在变，查脚本/动画/坏帧）：${jitter.length ? jitter.slice(0, 8).join('、') : '无'}`)
  console.log(`     时有时无（部分报告缺席，查可见性/加载）：${appear.length ? appear.slice(0, 8).join('、') : '无'}`)
}

if (TREND) {
  // 趋势模式：按场景分组输出精简对账 + 趋势
  const byScene = new Map()
  for (const f of files) {
    const d = byFileGet(f)
    if (!d) continue
    const id = String(d.id || '').replace(/[?&].*$/, '')
    if (!byScene.has(id)) byScene.set(id, [])
    byScene.get(id).push({ file: f, d })
  }
  for (const [id, group] of byScene) {
    console.log('\n' + '='.repeat(100))
    console.log(`场景 ${id}  跨报告趋势 × ${group.length}`)
    expected = expectedFor(id)
    const last = group[group.length - 1]
    const rows = last.d.layers || []
    let bad = 0; const badList = []
    rows.forEach((L, i) => {
      const e = expected.get(i)
      if (!e || !L.origin) return
      const [x, y] = String(L.origin).split(',').map(Number)
      const dist = Math.hypot(x - e.x, y - e.y)
      if (dist > 2) { bad++; badList.push(`${L.n}(Δ${Math.round(dist)})`) }
    })
    console.log(`  ① 最新一份 origin 对账：${rows.length - bad}/${rows.length} 层 ≤2px` + (bad ? `  ❌ ${badList.slice(0, 8).join(' ')}` : '  ✓'))
    printTrend(group, expected)
  }
} else {
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8'))
    console.log('\n' + '='.repeat(100))
    console.log(`上报 ${f}  at=${d.at}  url=${String(d.url || '').slice(0, 70)}`)
    console.log(`  纹理 ${d.texLoaded} 张 | 缺纹理可见层 ${(d.texMissing || []).length}${(d.texMissing || []).length ? ' (' + d.texMissing.slice(0, 6).join(',') + ')' : ''} | mesh 绘制 ${(d.meshDraws || []).length} | canvas ${(d.flags || {}).canvas}`)
    const errs = (d.subsystems || {}).scriptErrs || []
    if (errs.length) console.log('  脚本错误: ' + errs.slice(0, 3).join(' | '))

    // ① 层 origin 对账（按层序，避免同名层错配）
    const sid = String(d.id || '').replace(/[?&].*$/, '')
    expected = expectedFor(sid)
    const rows = d.layers || []
    let bad = 0
    const badList = []
    rows.forEach((L, i) => {
      const e = expected.get(i)
      if (!e || !L.origin) return
      const [x, y] = String(L.origin).split(',').map(Number)
      const dist = Math.hypot(x - e.x, y - e.y)
      if (dist > 2) { bad++; badList.push(`${L.n}(Δ${Math.round(dist)})`) }
    })
    console.log(`  ① origin 对账：${rows.length - bad}/${rows.length} 层 ≤2px` + (bad ? `  ❌ ${badList.slice(0, 8).join(' ')}` : '  ✓'))

    // ② DIAG 采样（设备） vs CPU 预览（正确）
    const diagLine = (d.log || '').split('\n').filter((l) => l.startsWith('【DIAG】')).pop()
    if (diagLine) {
      const items = diagLine.replace('【DIAG】', '').split('|').map((x) => x.trim())
      const gray = items.filter((it) => /\)178,178,178$/.test(it))
      console.log(`  ② DIAG 采样 ${items.length} 点，其中 ${gray.length} 点为清屏灰(178)：`)
      for (const g of gray.slice(0, 12)) console.log('       ' + g)
    } else console.log('  ② DIAG：无')

    // ③ 绘制台账（P-32）
    const led = d.layerLedger || []
    if (!led.length) console.log('  ③ layerLedger：本份上报没有（旧版页面 / 未刷新）')
    else {
      console.log(`  ③ layerLedger ${led.length} 层（设计坐标矩形 / 中心像素 / 纹理）：`)
      for (const e of led) {
        const px = e.px ? e.px.join(',') : '-'
        const isGray = e.px && Math.abs(e.px[0] - 178) <= 3 && Math.abs(e.px[1] - 178) <= 3 && Math.abs(e.px[2] - 178) <= 3
        const badTex = (e.t === 'white' || e.t === 'transp') ? '  ← 纹理兜底(' + e.t + ')' : ''
        console.log(`     ${pad(e.n, 12)} rd=${pad(JSON.stringify(e.rd), 26)} px=${pad(px, 13)} tex=${pad(e.t, 7)} size=${pad(e.s, 12)} a=${e.a}${isGray ? '  ← 中心=清屏灰' : ''}${badTex}`)
      }
    }

    // ④ 纹理统计（P-32）
    const ts = d.texStats || []
    if (!ts.length) console.log('  ④ texStats：本份上报没有（旧版页面 / 未刷新）')
    else {
      const susp = ts.filter((t) => t.a !== undefined && (t.a < 8 || (t.rgb && t.rgb[0] + t.rgb[1] + t.rgb[2] < 12)) )
      console.log(`  ④ texStats ${ts.length} 张，可疑（alpha≈0 或 RGB≈0）${susp.length} 张：`)
      for (const t of susp.slice(0, 12)) console.log(`     ${pad(t.n, 15)} ${pad(t.d, 11)} fmt=${t.f} rgb=${JSON.stringify(t.rgb)} alpha=${t.a} 全透明${t.a0}%`)
      if (!susp.length) for (const t of ts.slice(0, 8)) console.log(`     ${pad(t.n, 15)} ${pad(t.d, 11)} fmt=${t.f} rgb=${JSON.stringify(t.rgb)} alpha=${t.a} 全透明${t.a0}%`)
    }

    // ⑤ 层健康表（C5.3）
    printHealth(d)
  }
}

function byFileGet(f) {
  try { return JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8')) } catch { return null }
}

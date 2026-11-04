// report-latest.mjs — 读渲染器自动上报（:8899 服务器落在 $MPW_ROOT/reports/r*.json）的速查器。
//
// 用途（用户第 14 项）：用户在 :8899 里逐个看壁纸时，渲染器会把**日志 + 截图 + 逐层台账**自动上报到后台；
// 这个脚本把"最新几份"压成一张表给 AI/人看，并把内嵌截图落成文件（否则只能看 base64）。
//
// 用法:
//   node report-latest.mjs                 # 最新 1 份的详细摘要
//   node report-latest.mjs --n 5           # 最新 5 份的对比表
//   node report-latest.mjs --id 3554161528 # 只看某个包（取它最新一份）
//   node report-latest.mjs --shot          # 把内嵌截图写到 /tmp/mpw-shot-<id>-<ts>.jpg 并打印路径
//   node report-latest.mjs --json          # 机读输出
//
// 只读：不修改任何上报文件。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const DIR = `${MPW_WS}/reports`
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /^r\d+\.json$/.test(f)).map((f) => ({ f, p: path.join(DIR, f), t: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t)
  : []
if (!files.length) { console.error('没有找到上报文件（' + DIR + '/r*.json）——确认插件里「场景渲染上报」开着，且在壁纸/页面里看过场景'); process.exit(2) }

const idWant = val('--id', null)
const pick = idWant
  ? files.filter((x) => { try { return String(JSON.parse(fs.readFileSync(x.p, 'utf8')).url || '').includes(idWant) } catch { return false } }).slice(0, 1)
  : files.slice(0, Number(val('--n', has('--n') ? 5 : 1)))

const load = (x) => { try { return JSON.parse(fs.readFileSync(x.p, 'utf8')) } catch { return null } }

/** 汇总一份上报：谁、几层、画了几层、跳过原因分布、纹理/上下文/报错、日志尾。 */
function summarize(d) {
  const id = (String(d.url || '').match(/[?&]id=(\d+)/) || [, '?'])[1]
  const lh = d.layerHealth || []
  const reasons = {}
  for (const l of lh) { const r = l && l.skipReason; if (r) reasons[r] = (reasons[r] || 0) + 1 }
  return {
    id, at: d.at, url: d.url,
    layers: lh.length || (d.layers || []).length,
    drawn: lh.filter((l) => l && l.drawn).length,
    ledger: (d.layerLedger || []).length,
    skipReasons: reasons,
    texMissing: d.texMissing || 0, texLoaded: d.texLoaded || 0,
    ctxLost: d.ctxLost || null, hdrFallback: d.hdrFallback || null,
    textLayers: Array.isArray(d.textLayers) ? d.textLayers.length : (d.textLayers || 0),
    meshDraws: Array.isArray(d.meshDraws) ? d.meshDraws.length : d.meshDraws,
    meshSkip: Array.isArray(d.meshSkip) ? d.meshSkip.length : d.meshSkip,
    hasShot: !!d.shot, logLines: Array.isArray(d.log) ? d.log.length : 0,
  }
}

const rows = pick.map((x) => ({ file: x.f, s: summarize(load(x) || {}) })).filter((r) => r.s.id)
if (has('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0) }

for (const { file, s } of rows) {
  console.log(`\n── ${file}  包=${s.id}  at=${s.at}`)
  console.log(`   层 ${s.layers} / 有绘制 ${s.drawn} / 台账 ${s.ledger} | 纹理 载入 ${s.texLoaded} 缺失 ${s.texMissing} | 文本层 ${s.textLayers} | mesh ${s.meshDraws ?? '-'}/${s.meshSkip ?? '-'}`)
  if (s.ctxLost) console.log('   ⚠ ctxLost:', JSON.stringify(s.ctxLost))
  if (s.hdrFallback) console.log('   ⚠ hdrFallback:', JSON.stringify(s.hdrFallback))
  const rs = Object.entries(s.skipReasons)
  if (rs.length) console.log('   跳过原因:', rs.map(([k, v]) => `${k}×${v}`).join(', '))
  if (has('--shot') && load({ p: path.join(DIR, file) })?.shot) {
    const d = load({ p: path.join(DIR, file) })
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(d.shot)
    if (m) {
      const out = `/tmp/mpw-shot-${s.id}-${Date.parse(s.at) || Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
      fs.writeFileSync(out, Buffer.from(m[2], 'base64'))
      console.log('   截图:', out, `(${fs.statSync(out).size} B)`)
    }
  }
  const rawLog = load({ p: path.join(DIR, file) })?.log
  const lg = Array.isArray(rawLog) ? rawLog : (typeof rawLog === 'string' && rawLog ? rawLog.split('\n') : [])
  if (lg.length) console.log('   日志尾:', lg.slice(-3).map((x) => String(x).slice(0, 110)).join(' | '))
}
console.log(`\n共 ${files.length} 份上报；用 --n N / --id <包id> / --shot / --json 细化。`)

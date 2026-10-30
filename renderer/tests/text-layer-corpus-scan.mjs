// text-layer-corpus-scan.mjs —— C8①：全库文本层扫描表（**parse 口径**：真 parseScene，不是正则——
//   正则版曾产出 textLayers=0 的坏数据并按纪律丢弃）。
//
// 报告工具（不注册门禁；语料变化时重跑）。输出 reports/text-layer-scan.json：
//   { packages, textLayers, scriptText, userCondition, emptyText, degenerateSize, rows(逐包) }
// 口径：
//   textLayers   = parseScene 后 `l.__text` 的层数
//   scriptText   = 原文 `o.text.text` 是 `{script:…}`（脚本驱动文本）
//   userCondition= 原文含 `{user:{condition…}}`（组合互斥门控；Clock 三选一族的形态）
//   emptyText    = `o.text.text === ''`（空文本：不可见是正确行为，ensureTextTexture `!t.text` 早退）
//   degenerateSize = o.size 两分量都 ≤4（退化尺寸；RE-32③ 文本框回填覆盖它，但 Node 侧无光栅器）
// 用法：node tests/text-layer-corpus-scan.mjs [--max-mb 250]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import * as lib from '../core/we-scene-bundle.js'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const MAX_MB = Number(argVal('--max-mb') || 250)
const OUT = path.join(ROOT, 'reports', 'text-layer-scan.json')
const dec = new TextDecoder()

function walk(root, acc = []) {
  let names = []
  try { names = fs.readdirSync(root) } catch (e) { return acc }
  for (const n of names) {
    const p = path.join(root, n)
    let st = null
    try { st = fs.statSync(p) } catch (e) { continue }
    if (st.isDirectory()) walk(p, acc)
    else if (/\.(mpkg|pkg)$/i.test(n)) acc.push(p)
  }
  return acc
}
const isStr = (v) => typeof v === 'string'
const textInfo = (raw) => {
  const t = raw && raw.text
  if (t == null) return null
  const inner = (t && typeof t === 'object' && t.text !== undefined) ? t.text : t
  return {
    script: !!(inner && typeof inner === 'object' && isStr(inner.script)),
    userCondition: !!(t && typeof t === 'object' && JSON.stringify(t).includes('"condition"')),
    empty: isStr(inner) && inner === '',
    raw: isStr(inner) ? inner.slice(0, 30) : (inner && inner.script ? '{script}' : typeof inner),
  }
}

const ROOTS = ['dd', '0923', '0917', 'wallpaperE', '1004'].map((r) => path.join(WS, 'allwallpaper', r)).filter((p) => fs.existsSync(p))
const files = ROOTS.flatMap((r) => walk(r)).sort()
  .filter((f) => { try { return fs.statSync(f).size <= MAX_MB * 1048576 } catch (e) { return false } })

const rows = []
let textLayers = 0, scriptText = 0, userCondition = 0, emptyText = 0, degenerateSize = 0
for (const f of files) {
  const rel = path.relative(WS, f)
  try {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(f)))
    const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
    const se = ['scene.json', 'Scene.json'].map(entry).find(Boolean)
    if (!se) { rows.push({ rel, skipped: 'no-scene-json' }); continue }
    const sceneObj = JSON.parse(dec.decode(se).replace(/^\uFEFF/, ''))
    const scene = lib.parseScene(JSON.parse(JSON.stringify(sceneObj)), null, { attachCtx: { readEntry: entry, time: 0 } })
    const stat = { rel, pkg: path.basename(path.dirname(f)), textLayers: 0, scriptText: 0, userCondition: 0, emptyText: 0, degenerateSize: 0 }
    const rawById = new Map((sceneObj.objects || []).map((o) => [o.id, o]))
    for (const l of scene.layers) {
      if (!l.__text) continue
      const o = rawById.get(l.id) || {}
      const info = textInfo(o)
      stat.textLayers++
      if (info) {
        if (info.script) stat.scriptText++
        if (info.userCondition) stat.userCondition++
        if (info.empty) stat.emptyText++
      }
      if (l.size && Number(l.size[0]) <= 4 && Number(l.size[1]) <= 4) stat.degenerateSize++
    }
    textLayers += stat.textLayers; scriptText += stat.scriptText; userCondition += stat.userCondition
    emptyText += stat.emptyText; degenerateSize += stat.degenerateSize
    rows.push(stat)
  } catch (e) { rows.push({ rel, skipped: 'err: ' + String(e.message).slice(0, 100) }) }
  process.stdout.write('  [' + rows.length + '/' + files.length + '] ' + rel + '\r')
}
const out = { generatedAt: new Date().toISOString(), packages: files.length, textLayers, scriptText, userCondition, emptyText, degenerateSize, note: 'parse 口径（真 parseScene）；正则版坏数据已废弃', rows }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
console.log('\n文本层 ' + textLayers + '（脚本驱动 ' + scriptText + ' / 条件互斥 ' + userCondition + ' / 空文本 ' + emptyText + ' / 退化尺寸 ' + degenerateSize + '）→ ' + path.relative(ROOT, OUT))

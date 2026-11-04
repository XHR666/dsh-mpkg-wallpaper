#!/usr/bin/env node
// library-manifest.mjs — 全语料清单（任务书 C4）：扫全部容器，输出类型/规模/构成，识别视频壁纸
//
// 解决什么事故：把**视频壁纸**当场景渲染（砂狼白子02_08：mpkg 里 project.json 写 type=scene，
//   实际是 wallpaper.mp4 + 一份 scene.json——按场景渲染=黑屏/只有文本；P-33 定案按视频播）。
//   本工具把每个容器的"实际内容构成"列成一张表，给 A/B 的回归集选样与"哪些是视频壁纸"提供依据。
//
// 怎么用（Node only）：
//   node library-manifest.mjs              # 表格输出（默认全语料）
//   node library-manifest.mjs --json       # 机读 JSON（同时写 we-scene-demo/library-manifest.json）
//   node library-manifest.mjs --only video # 只看某类型（scene|video|scene+video）
//
// 口径（诚实说明）：
//   type 判定看**内容**不看 project.json 声明（P-33 教训）：有 scene.json=scene 能力，
//   有 .mp4 条目或 project.json.file 指向 mp4=video；两者皆有=scene+video（叠加链路当前不存在，P-33）。
//   mesh 层数用 .mdl 条目数代理（每个 MDL=一个 puppet 网格模型）。
//   脚本段数 = scene.json/project.json 深遍历中带 `script` 字符串属性的对象数（与 script-corpus-audit 同口径）。
// 退出码：0 = 扫描完成（无论发现什么）；2 = 语料目录缺失。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.MPW_ROOT || WS
const lib = await import(path.join(ROOT, 'we-scene-demo', 'core/we-scene-bundle.js'))
const DEC = new TextDecoder()

// ---- 容器发现（与 script-corpus-audit 同源）----
const packs = []
const ddDir = path.join(ROOT, 'allwallpaper', 'dd')
if (fs.existsSync(ddDir)) {
  for (const d of fs.readdirSync(ddDir)) {
    const p = path.join(ddDir, d, 'scene.pkg')
    if (fs.existsSync(p)) packs.push({ id: d, source: 'dd', p })
  }
} else { console.error('缺语料目录 allwallpaper/dd'); process.exit(2) }
for (const dir of ['wallpaperE', 'wallpapertest1']) {
  const base = path.join(ROOT, 'allwallpaper', dir)
  if (!fs.existsSync(base)) continue
  for (const sub of fs.readdirSync(base)) {
    const sd = path.join(base, sub)
    if (!fs.statSync(sd).isDirectory()) { if (sd.endsWith('.mpkg')) packs.push({ id: sub.replace(/\.mpkg$/, ''), source: dir, p: sd }); continue }
    for (const f of fs.readdirSync(sd)) if (f.endsWith('.mpkg')) packs.push({ id: f.replace(/\.mpkg$/, ''), source: dir + '/' + sub, p: path.join(sd, f) })
  }
}

// ---- 单容器分析 ----
function countScripts(json) {
  let n = 0
  const walk = (o) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (typeof o.script === 'string' && o.script.trim()) n++
    for (const k of Object.keys(o)) walk(o[k])
  }
  walk(json)
  return n
}
function analyze(pk) {
  const out = { id: pk.id, source: pk.source, file: path.basename(pk.p) }
  try {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pk.p)))
    const names = pkg.entries.map((e) => e.name)
    out.entries = names.length
    out.textures = names.filter((n) => n.endsWith('.tex')).length
    out.mesh = names.filter((n) => n.endsWith('.mdl')).length
    out.hasSceneJson = names.includes('scene.json')
    const mp4 = names.filter((n) => /\.mp4$/i.test(n))
    out.videoFiles = mp4
    // project.json：视频声明（file 字段）与预览
    let pj = null
    try { const e = lib.getEntry(pkg, 'project.json'); if (e) pj = JSON.parse(DEC.decode(e).replace(/^\uFEFF/, '')) } catch {}
    out.projectType = pj && pj.general && pj.general.type || null
    if (pj && pj.general && typeof pj.general.file === 'string' && /\.mp4$/i.test(pj.general.file)) out.videoFiles.push(pj.general.file + '(project.json)')
    out.scripts = 0
    for (const jn of ['scene.json', 'project.json']) {
      try { const e = lib.getEntry(pkg, jn); if (e) out.scripts += countScripts(JSON.parse(DEC.decode(e).replace(/^\uFEFF/, ''))) } catch {}
    }
    out.preview = names.find((n) => /preview\.(gif|jpg|jpeg|png)$/i.test(n)) || null
    out.type = (out.hasSceneJson ? 'scene' : '') + (out.videoFiles.length ? (out.hasSceneJson ? '+video' : 'video') : '')
    if (!out.type) out.type = 'other'
    out.error = null
  } catch (e) {
    out.error = e.message
    out.type = 'parse-error'
  }
  return out
}

const only = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? process.argv[i + 1] : null })()
const rows = packs.map(analyze)
  .sort((a, b) => (a.source + a.id).localeCompare(b.source + b.id))
  .filter((r) => !only || r.type === only || (only === 'video' && r.type.includes('video')))

if (process.argv.includes('--json')) {
  const summary = {}
  for (const r of rows) summary[r.type] = (summary[r.type] || 0) + 1
  const payload = { generated: new Date().toISOString(), total: rows.length, summary, containers: rows }
  fs.writeFileSync(path.join(ROOT, 'we-scene-demo', 'library-manifest.json'), JSON.stringify(payload, null, 1))
  console.log(JSON.stringify(payload, null, 1))
} else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`${pad('id', 34)}${pad('来源', 20)}${pad('类型', 12)}${pad('条目', 6)}${pad('纹理', 6)}${pad('脚本', 6)}${pad('MDL', 5)}${pad('视频', 4)} 预览`)
  for (const r of rows) {
    console.log(`${pad(r.id.slice(0, 33), 34)}${pad(r.source, 20)}${pad(r.type, 12)}${pad(r.entries ?? '-', 6)}${pad(r.textures ?? '-', 6)}${pad(r.scripts ?? '-', 6)}${pad(r.mesh ?? '-', 5)}${pad(r.videoFiles.length ? '✓' : '', 4)} ${r.preview || ''}${r.error ? '  ✗ ' + r.error : ''}`)
  }
  const byType = {}
  for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1
  console.log(`\n合计 ${rows.length} 容器：` + Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(' · '))
}

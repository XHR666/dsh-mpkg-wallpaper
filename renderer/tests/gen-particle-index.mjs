// gen-particle-index.mjs — 生成/校验 demo.html 里的「官方粒子预设 basename 索引」（Q5 用户第 17 项）
//
// 为什么需要：
//   语料里 32 个粒子层（14 个包）的 `particles/*.json` **不在包内**——它们全是"视频壁纸 + scene.json 叠加"型
//   mpkg（容器只有 project.json/scene.json/mp4/preview），引用的是 WE 官方预设路径
//   `particles/presets/<name>.json`。服务端 `/weassist/` 只映射 `wallpaper_engine/assets`，
//   而官方预设定义不在 `assets/particles/**`（那里只有 6 个 example*.json），
//   实际在 `assets/presets/<主题>/particles/presets/<name>.json`（另有 `preview<名>/` 下的编辑器预览副本）。
//   → 渲染器需要一个 basename → assets 相对路径的索引来做最后一级兜底。
//
// 收录策略（宁缺勿错，重名不猜）：
//   ① 直接层 `presets/<主题>/particles/presets/<名>.json`：basename 唯一 → 收录（官方预设本体）。
//   ② 只有嵌套副本（`presets/<主题>/preview*/particles/presets/<名>.json`）时：所有副本内容 sha1 一致 → 收录最短路径；
//      内容不一致 → 放弃（歧义）。
//   磁盘内容变化后重跑 `--write`；`--check` 用于门禁（demo.html 与磁盘不同步即非零退出）。
//
// 用法:
//   node gen-particle-index.mjs            # = --check：比对 demo.html 内联索引 ↔ 磁盘
//   node gen-particle-index.mjs --check
//   node gen-particle-index.mjs --write    # 改写 demo.html 的 BI 区间
//   node gen-particle-index.mjs --list     # 打印索引 + 放弃项
// 环境变量 WE_ASSETS 可覆盖 `wallpaper_engine/assets` 根。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 根文件（demo.html / bundle / icons）在仓库根
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

export const DEFAULT_ASSETS = `${MPW_WS}/wallpaper_engine/assets`
export const BEGIN = '/* PARTICLE-INDEX-BEGIN */'
export const END = '/* PARTICLE-INDEX-END */'

const sha1 = (fp) => crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex')

/** 递归找 `assets/presets/<主题>/…/particles/presets/*.json`，按 basename 分组 */
export function collectCandidates(assetsRoot = DEFAULT_ASSETS) {
  const root = path.join(assetsRoot, 'presets')
  const byBase = new Map()
  const walk = (dir) => {
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) walk(fp)
      else if (e.name.endsWith('.json') && /[/\\]particles[/\\]presets[/\\][^/\\]+\.json$/.test(fp)) {
        if (!byBase.has(e.name)) byBase.set(e.name, [])
        byBase.get(e.name).push(fp)
      }
    }
  }
  walk(root)
  return byBase
}

/** 构建索引：basename → assets 相对路径（posix 分隔符） */
export function buildIndex(assetsRoot = DEFAULT_ASSETS) {
  const byBase = collectCandidates(assetsRoot)
  const rel = (fp) => path.relative(assetsRoot, fp).replace(/\\/g, '/')
  const isDirect = (fp) => /[/\\]presets[/\\][^/\\]+[/\\]particles[/\\]presets[/\\][^/\\]+\.json$/.test(fp)
  const index = {}
  const skipped = []
  let direct = 0, nested = 0
  for (const base of [...byBase.keys()].sort()) {
    const all = byBase.get(base)
    const dirs = all.filter(isDirect)
    if (dirs.length === 1) { index[base] = rel(dirs[0]); direct++; continue }
    if (dirs.length > 1) {                       // 直接层重名（当前语料没有）：内容一致才收
      const hs = new Set(dirs.map(sha1))
      if (hs.size === 1) { index[base] = rel(dirs.sort()[0]); direct++; continue }
      skipped.push({ base, reason: '直接层重名且内容不一致', paths: dirs.map(rel) })
      continue
    }
    const hs = new Set(all.map(sha1))
    if (hs.size === 1) { index[base] = rel(all.sort()[0]); nested++; continue }
    skipped.push({ base, reason: '仅嵌套副本且内容不一致（歧义）', paths: all.map(rel) })
  }
  return { index, skipped, stats: { basenames: byBase.size, entries: Object.keys(index).length, direct, nested } }
}

export function renderBlock(index) {
  const lines = Object.keys(index).sort().map((k) => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(index[k]) + ',')
  return BEGIN + '\n' + lines.join('\n') + '\n  ' + END
}

export function readBlock(html) {
  const i = html.indexOf(BEGIN)
  const j = html.indexOf(END)
  if (i < 0 || j < i) return null
  return html.slice(i + BEGIN.length, j)
}

/** 解析 demo.html 内联索引块 → 对象（测试复用） */
export function parseInlineIndex(html) {
  const body = readBlock(html)
  if (body == null) return null
  const obj = {}
  for (const m of body.matchAll(/"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)+)"/g)) obj[JSON.parse('"' + m[1] + '"')] = JSON.parse('"' + m[2] + '"')
  return obj
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const demoPath = path.join(ROOT, 'demo.html')
  const assetsRoot = process.env.WE_ASSETS || DEFAULT_ASSETS
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const list = argv.includes('--list')
  const { index, skipped, stats } = buildIndex(assetsRoot)
  const html = fs.readFileSync(demoPath, 'utf8')
  const inline = parseInlineIndex(html)
  if (list) {
    for (const k of Object.keys(index).sort()) console.log('  ' + k.padEnd(44) + index[k])
    console.log('放弃（' + skipped.length + '）：' + skipped.map((s) => s.base + '(' + s.reason + ')').join(', '))
  }
  console.log('磁盘索引：' + stats.entries + ' 条 / ' + stats.basenames + ' 个 basename（直接层 ' + stats.direct + ' + 嵌套唯一 ' + stats.nested + '；放弃 ' + skipped.length + '）')
  if (!inline) { console.error('✗ demo.html 里找不到 ' + BEGIN + ' … ' + END + ' 块'); process.exit(1) }
  const keys = Object.keys(index).sort(), inKeys = Object.keys(inline).sort()
  const added = keys.filter((k) => !(k in inline))
  const removed = inKeys.filter((k) => !(k in index))
  const changed = keys.filter((k) => (k in inline) && inline[k] !== index[k])
  console.log('demo.html 内联索引：' + inKeys.length + ' 条；差异 = 新增 ' + added.length + ' / 删除 ' + removed.length + ' / 变更 ' + changed.length)
  for (const k of added) console.log('  + ' + k + ' → ' + index[k])
  for (const k of removed) console.log('  - ' + k + '（磁盘已无）')
  for (const k of changed) console.log('  ~ ' + k + '：' + inline[k] + ' → ' + index[k])
  if (write) {
    const body = readBlock(html)
    const out = html.slice(0, html.indexOf(BEGIN)) + renderBlock(index) + html.slice(html.indexOf(END) + END.length)
    fs.writeFileSync(demoPath, out)
    console.log('✓ 已改写 demo.html 内联索引（' + keys.length + ' 条）')
    process.exit(0)
  }
  const ok = !added.length && !removed.length && !changed.length
  console.log(ok ? '✓ 内联索引与磁盘一致（' + keys.length + ' 条）' : '✗ 内联索引与磁盘不同步 → 跑 node gen-particle-index.mjs --write')
  process.exit(ok ? 0 : 1)
}

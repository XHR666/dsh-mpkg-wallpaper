/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // alignment-scan.mjs — A3 取证：全语料 alignment 取值分布（P-21 第 1 步，先有数字再写码）
// 用法: node alignment-scan.mjs [目录或 .pkg/.mpkg ...]   默认 allwallpaper/** + ~/.dsh-mpkg-wallpaper/*.mpkg
// 输出: 各取值的全局计数 + 出现该取值的壁纸清单（basename 去重）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'

const dec = new TextDecoder()

function findPkgs() {
  const out = []
  const roots = process.argv.slice(2)
  const scan = (p) => {
    let st
    try { st = fs.statSync(p) } catch { return }
    if (st.isFile()) { if (/\.(pkg|mpkg)$/i.test(p)) out.push(p); return }
    for (const f of fs.readdirSync(p)) scan(path.join(p, f))
  }
  if (roots.length) roots.forEach(scan)
  else [`${MPW_WS}/allwallpaper`, MPW_PLUGIN_CACHE].forEach(scan)
  return [...new Set(out)]
}

// scene.json objects 里的 alignment 字段（缺省 = center，按 wer-ref WPImageObject.cpp:85 语义）
const dist = new Map()   // value -> { count, pkgs:Set }
function bump(v, tag) {
  const key = v === undefined ? '(缺省=center)' : String(v)
  if (!dist.has(key)) dist.set(key, { count: 0, pkgs: new Set() })
  const d = dist.get(key)
  d.count++
  if (d.pkgs.size < 40) d.pkgs.add(tag)   // 清单封顶避免刷屏，计数不受影响
}

const files = findPkgs()
let pkgsWithScene = 0, objTotal = 0, errTotal = 0
const nonCenterPkgs = []
for (const f of files) {
  let pkg
  try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(f))) } catch { errTotal++; continue }
  let scene = null
  for (const n of ['scene.json', 'Scene.json']) {
    const e = lib.getEntry(pkg, n)
    if (e) { try { scene = JSON.parse(dec.decode(new Uint8Array(e)).replace(/^\uFEFF/, '')) } catch {} ; break }
  }
  if (!scene) { errTotal++; continue }
  pkgsWithScene++
  const tag = (path.basename(path.dirname(f)) !== '' && !/\.(pkg|mpkg)$/i.test(path.basename(path.dirname(f))))
    ? path.basename(path.dirname(f)) + '/' + path.basename(f)
    : path.basename(f)
  let nonCenter = 0
  for (const o of (scene.objects || [])) {
    objTotal++
    bump(o.alignment, tag)
    if (o.alignment !== undefined && o.alignment !== 'center') nonCenter++
  }
  if (nonCenter) nonCenterPkgs.push({ tag, nonCenter })
}

console.log(`扫描 ${files.length} 个包（${pkgsWithScene} 有 scene.json，${errTotal} 跳过），objects 总数 ${objTotal}`)
console.log('\n== alignment 取值分布 ==')
const rows = [...dist.entries()].sort((a, b) => b[1].count - a[1].count)
for (const [v, d] of rows) {
  console.log(`${v.padEnd(18)} ${String(d.count).padStart(5)} 层   出现于 ${d.pkgs.size}+ 包`)
  if (v !== '(缺省=center)' && v !== 'center') console.log('    例: ' + [...d.pkgs].slice(0, 8).join(' | '))
}
console.log(`\n== 含非 center 对齐的包：${nonCenterPkgs.length} 个 ==`)
for (const p of nonCenterPkgs.slice(0, 30)) console.log(`  ${p.tag}  非 center 层 ${p.nonCenter}`)

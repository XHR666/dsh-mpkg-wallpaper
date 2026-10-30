// 用 elysia 的 SceneRenderer（CPU 路径）解析同一场景，逐层对比 refrender 标定矩形。
// 目的：判定 elysia 的父链/附件变换是否比我们的更接近官方（若是 → 移植它的数学）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
import { SceneRenderer } from '../elysia/we-renderer/core.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
// 用法: node elysia-transform-check.mjs [sceneId] [--pkg 路径]
const ARGV = process.argv.slice(2)
const PKGI = ARGV.indexOf('--pkg')
const SCENE_ID = PKGI >= 0 ? null : (ARGV[0] || '3719111841')
const pkgPath = PKGI >= 0 ? ARGV[PKGI + 1] : `${MPW_WS}/allwallpaper/dd/${SCENE_ID}/scene.pkg`
const pkgOurs = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
const pkg = {
  has: (n) => !!lib.getEntry(pkgOurs, n),
  read: (n) => lib.getEntry(pkgOurs, n),
  readJson: (n) => { const b = lib.getEntry(pkgOurs, n); return b ? JSON.parse(rd(b)) : null },
  readText: (n) => { const b = lib.getEntry(pkgOurs, n); return b ? rd(b) : null },
  entries: () => pkgOurs.entries,
}
const scene = pkg.readJson('scene.json')
const r = new SceneRenderer(pkg, { width: 3840, height: 2160, weAssetsRead: () => null, time: 0 })
try { r.setScene(scene) } catch (e) { console.log('setScene err', e.message) }
console.log('objects', r.objects ? r.objects.length : 0)
const REF = SCENE_ID ? JSON.parse(fs.readFileSync(`${MPW_WS}/we-scene-demo/refrender-` + SCENE_ID + '.json', 'utf8')) : {}
let rows = []
let perfect = 0, near = 0, far = 0
for (const o of (r.objects || [])) {
  if (!REF[String(o.id)]) continue
  let tr = null
  try { tr = r.resolveTransform(o) } catch (e) { tr = null }
  if (!tr) { rows.push([o.id, o.name, 'no-transform']); continue }
  const sz = String(o.size || '0 0').trim().split(/\s+/).map(Number)
  const w = Math.abs((sz[0] || 0) * tr.scale[0]), h = Math.abs((sz[1] || 0) * tr.scale[1])
  const R = REF[String(o.id)]
  const cx = tr.origin[0], cyE = tr.origin[1]           // elysia: y-up 世界
  const oyE = R[1] + R[3] / 2
  // 我们侧约定 y-down（2160 - y_up）后再比较
  // 标定表 y = y-down；elysia 世界 = y-up → 统一到 y-down 再比
  const cyDown = 2160 - cyE
  const d = Math.hypot(cx - (R[0] + R[2] / 2), cyDown - (R[1] + R[3] / 2))
  if (d < 5) perfect++; else if (d < 100) near++; else far++
  rows.push([o.id, String(o.name).slice(0, 12), `elysia(y-down)=(${cx.toFixed(0)},${cyDown.toFixed(0)})  标定=(${(R[0] + R[2] / 2).toFixed(0)},${(R[1] + R[3] / 2).toFixed(0)})  Δ=${d.toFixed(0)}px  Δsize=(${(w - R[2]).toFixed(0)},${(h - R[3]).toFixed(0)})`])
}
rows.sort((a, b) => parseFloat(String(b[2]).match(/Δ=([\d.]+)/)?.[1] || 9999) - parseFloat(String(a[2]).match(/Δ=([\d.]+)/)?.[1] || 9999))
for (const row of rows.slice(0, 30)) console.log(String(row[0]).padEnd(5), row[1].padEnd(14), row[2])
console.log(`\n结论：与标定矩形中心 Δ<5px 的层 ${perfect}/${rows.length}（其余 ${near} 层 <100px、${far} 层 ≥100px）`)
console.log('注：标定矩形 = 早前按官方预览逐层标出的实绘矩形；eltysia=elysia SceneRenderer.resolveTransform')

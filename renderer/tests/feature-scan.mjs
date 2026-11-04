// feature-scan.mjs — 全量壁纸特性扫描：决定哪些"官方语义项"真正需要实现（不再只针对单一样品）
// 用法: node feature-scan.mjs [目录或 .mpkg ...]   默认扫描 allwallpaper/**.pkg + ~/.dsh-mpkg-wallpaper/*.mpkg
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
// ①(去个人化 2026-09-16) 插件下载缓存 / 备用语料根：环境变量优先；默认值只是作者本机路径。
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'
const MPW_SD_ROOT = process.env.MPW_SD_ROOT || '/mnt/sdcard/wallpapertest1'

const H = {}
installPuppet(H)
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
  else [`${MPW_WS}/allwallpaper`, MPW_PLUGIN_CACHE, MPW_SD_ROOT].forEach(scan)
  return [...new Set(out)]
}

const KEYS = ['"command"', '"compose"', '"copybackground"', '"unique"', '"fit"', '"colorBlendMode"',
  '"animationlayers"', '"particle"', '"cropoffset"', '"alignment"', '"visible"', '"fbos"', '"binds"',
  '"format"', '"scale"', '"perspective"', '"text"', '"sound"', '"angles"']

function analyse(file) {
  let pkg
  try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file))) } catch (e) { return { file, err: 'parsePkg: ' + e.message } }
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  let scene = null
  for (const n of ['scene.json', 'Scene.json']) { const e = entry(n); if (e) { try { scene = JSON.parse(dec.decode(e).replace(/^\uFEFF/, '')) } catch {} ; break } }
  if (!scene) return { file, err: 'no scene.json' }
  const objs = scene.objects || []
  const r = { file, layers: objs.length, puppet: 0, animMulti: 0, animIdMismatch: 0, effects: 0, effLayers: 0, particles: 0,
    alignNonCenter: 0, parented: 0, rotated: 0, scaledParent: 0, visibleCond: 0, cropoffset: 0, video: 0, text: 0, keys: {} }
  const byId = new Map(objs.map((o) => [o.id, o]))
  for (const o of objs) {
    if (o.puppet) r.puppet++
    if (o.animationlayers && o.animationlayers.length) { if (o.animationlayers.length > 1) r.animMulti++ }
    if (o.effects && o.effects.length) { r.effects += o.effects.length; r.effLayers++ }
    if (o.particle) r.particles++
    if (o.alignment && o.alignment !== 'center') r.alignNonCenter++
    if (o.parent !== undefined && o.parent !== null) r.parented++
    const ang = String(o.angles || '').split(/\s+/).map(Number)
    if (ang.some((v) => Math.abs(v) > 1e-4)) r.rotated++
    if (o.visible && typeof o.visible === 'object') r.visibleCond++
    if (o.image && /\.(mp4|webm)$/i.test(o.image)) r.video++
  }
  // 父层非 1 缩放
  for (const o of objs) if (o.parent !== undefined && o.parent !== null) {
    const p = byId.get(o.parent)
    if (p) { const sc = String(p.scale || '').split(/\s+/).map(Number); if (sc.some((v) => Math.abs(v - 1) > 1e-4)) r.scaledParent++ }
  }
  // 全包 JSON 键扫描（效果链/材质/fbo 等）
  let joined = ''
  for (const e of pkg.entries) {
    if (!/\.(json|effect)$/i.test(e.name)) continue
    try { const b = entry(e.name); if (b && b.length < 400000) joined += dec.decode(b) } catch {}
  }
  for (const k of KEYS) { const c = joined.split(k).length - 1; if (c) r.keys[k.replace(/"/g, '')] = c }
  if (/cropoffset/.test(joined)) r.cropoffset = joined.split('cropoffset').length - 1
  if (/"text"\s*:/.test(joined)) r.text = joined.split(/"text"\s*:/).length - 1
  // 蒙皮动画数 & animationlayers id 匹配（判定 RE-11 是否真的需要）
  for (const o of objs) {
    if (!o.puppet || !o.image) continue
    try {
      const mj = JSON.parse(dec.decode(entry(o.image)))
      const ru = entry(mj.puppet); if (!ru) continue
      const mesh = H._parseMdl(new MpwBuffer(ru.buffer, ru.byteOffset, ru.byteLength))
      if (!mesh || !mesh.animations) continue
      if (mesh.animations.length > 1) r.animMulti += 0
      const al = (o.animationlayers || [])[0]
      if (al && mesh.animations.length) {
        const idx = mesh.animations.findIndex((a) => a.id === al.animation)
        if (idx > 0) r.animIdMismatch++
        if (mesh.animations.length > 1) r.multiAnimMeshes = (r.multiAnimMeshes || 0) + 1
      }
    } catch {}
  }
  return r
}

const files = findPkgs()
console.log(`扫描 ${files.length} 个包\n`)
const rows = []
for (const f of files) rows.push(analyse(f))
const agg = {}
for (const r of rows) {
  if (r.err) { console.log(`✗ ${path.basename(path.dirname(r.file))}/${path.basename(r.file)}: ${r.err}`); continue }
  const tag = path.basename(path.dirname(r.file)) || path.basename(r.file)
  const feat = Object.entries(r.keys).filter(([, c]) => c > 0).map(([k, c]) => k + ':' + c).join(' ')
  console.log(`${tag.padEnd(22)} 层${String(r.layers).padStart(3)} 傀儡${r.puppet} 多动画${r.multiAnimMeshes || 0} 效果${r.effects}(${r.effLayers}层) 粒子${r.particles} 非中${r.alignNonCenter} 父链${r.parented} 旋转${r.rotated} 父缩放${r.scaledParent} 条件${r.visibleCond} 视频${r.video} 文本${r.text}`)
  if (feat) console.log('   键: ' + feat)
  for (const [k, c] of Object.entries(r.keys)) agg[k] = (agg[k] || 0) + c
}
console.log('\n══ 全局键使用合计（>0 表示有壁纸用到，就必须实现）')
console.log(Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}=${c}`).join('  '))

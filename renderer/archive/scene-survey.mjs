// dd 全场景摸底：为"更多可测壁纸"候选提供概况
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ①(2026-11-03 可移植性修正) 本机绝对路径不许进 tracked 文件（cross-platform / integrity 判据）。
//   默认按"仓库 = <DSHAREA>/dsh-mpkg-wallpaper"推导工作区根，可用 MPW_ROOT / MPW_BUNDLE / MPW_SCENES 覆盖。
const WORKSPACE = path.resolve(process.env.MPW_ROOT || path.join(path.resolve('.'), '..'), '')
const BUNDLE = process.env.MPW_BUNDLE || path.join(WORKSPACE, 'we-scene-demo', 'we-scene-bundle.js')
const SCENE_ROOT = process.env.MPW_SCENES || path.join(WORKSPACE, 'allwallpaper', 'dd')
const lib = await import(pathToFileURL(BUNDLE).href)
const { parsePkg, getEntry, parseScene, resolveEffectChain } = lib
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')

const rows = []
for (const d of fs.readdirSync(SCENE_ROOT).filter((x) => /^\d+$/.test(x)).sort()) {
  const p = path.join(SCENE_ROOT, d, 'scene.pkg')
  if (!fs.existsSync(p)) continue
  let pkg
  try { pkg = parsePkg(new Uint8Array(fs.readFileSync(p))) } catch { continue }
  const se = pkg.entries.find((x) => x.name === 'scene.json')
  const seData = se ? getEntry(pkg, se.name) : null
  if (!seData) continue
  const scene = parseScene(JSON.parse(rd(seData)), null)
  let rendered = 0, withTex = 0, fxLayers = 0, fxCount = 0
  const names = []
  const texNameOf = (image) => {
    if (!image) return null
    let model = null
    const bi = lib.resolveBuiltin(image)
    if (bi && bi.kind === 'model') model = bi.value
    else {
      const me = getEntry(pkg, image)
      if (!me) return null
      try { model = JSON.parse(rd(me)) } catch { return null }
    }
    if (!model || typeof model.material !== 'string') return null
    const bi2 = lib.resolveBuiltin(model.material)
    let material = bi2 && bi2.kind === 'material' ? bi2.value : null
    if (!material) {
      const matE = getEntry(pkg, model.material)
      if (!matE) return null
      try { material = JSON.parse(rd(matE)) } catch { return null }
    }
    const pass = material.passes && material.passes[0]
    return (pass && pass.textures && pass.textures[0]) || null
  }
  for (const layer of scene.layers) {
    if (!layer.visible || layer.particle || layer.isContainer) continue
    rendered++
    const tn = texNameOf(layer.image)
    if (tn && typeof tn === 'string' && tn !== '' && (getEntry(pkg, 'materials/' + tn + '.tex') || tn.startsWith('util/'))) withTex++
    const effs = (layer.effects || []).filter((e) => e.visible)
    if (effs.length) fxLayers++
    fxCount += effs.length
    if (layer.name && /^(背景|前景|人物|Character|Background|Girl|少女)/.test(layer.name)) names.push(layer.name.slice(0, 16))
  }
  // 视频纹理层（scene-anim 判断：pkg 里 materials/*.tex 是否含 mp4）
  let hasVideo = false
  for (const e of pkg.entries) {
    if (e.name.startsWith('materials/') && e.name.endsWith('.tex')) {
      try {
        const ed = getEntry(pkg, e.name)
        if (!ed) continue
        const tx = lib.parseTex(ed)
        if (tx && tx.format === lib.FIF.MP4) { hasVideo = true; break }
      } catch {}
    }
  }
  rows.push({ id: d, layers: scene.layers.length, rendered, withTex, fxLayers, fxCount, video: hasVideo, names: [...new Set(names)].slice(0, 3).join('|') })
}
rows.sort((a, b) => b.rendered - a.rendered)
console.log('ID          层数 渲染 绑定纹理 特效层 特效数 视频 代表层名')
for (const r of rows) {
  console.log(`${r.id}  ${String(r.layers).padStart(3)}  ${String(r.rendered).padStart(3)}   ${String(r.withTex).padStart(3)}     ${String(r.fxLayers).padStart(3)}   ${String(r.fxCount).padStart(3)}   ${r.video ? '✓' : '-'}  ${r.names}`)
}

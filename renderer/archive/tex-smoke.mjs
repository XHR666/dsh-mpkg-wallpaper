// 纹理解码冒烟测试：找出"解码后透明/全黑/异常"的纹理（看不见且不报错的原因之一）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BUNDLE = '/root/Desktop/DSHarea/we-scene-demo/we-scene-bundle.js'
const SCENE_ROOT = '/root/Desktop/DSHarea/allwallpaper/dd'
const lib = await import(pathToFileURL(BUNDLE).href)
const { parsePkg, getEntry, parseScene, resolveBuiltin } = lib
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const TARGETS = [['3554161528', 'Hina'], ['3544152633', 'GirlCat'], ['3327063360', 'Shiroko']]

function texStats(rgba, w, h) {
  const n = w * h
  let sa = 0, sr = 0, sg = 0, sb = 0, zeroAlpha = 0, fullAlpha = 0, dark = 0
  const step = Math.max(1, Math.floor(n / 200000))
  let cnt = 0
  for (let i = 0; i < n; i += step) {
    const a = rgba[i * 4 + 3]
    sa += a
    if (a === 0) zeroAlpha++
    else if (a === 255) fullAlpha++
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]
    sr += r; sg += g; sb += b
    if (r < 8 && g < 8 && b < 8) dark++
    cnt++
  }
  return {
    w, h,
    avgA: (sa / cnt).toFixed(0),
    zeroA: ((zeroAlpha / cnt) * 100).toFixed(0) + '%',
    fullA: ((fullAlpha / cnt) * 100).toFixed(0) + '%',
    avgRGB: [sr, sg, sb].map((v) => Math.round(v / cnt)).join(','),
    darkPct: ((dark / cnt) * 100).toFixed(0) + '%',
  }
}

for (const [sid, label] of TARGETS) {
  const p = path.join(SCENE_ROOT, sid, 'scene.pkg')
  const pkg = parsePkg(new Uint8Array(fs.readFileSync(p)))
  const scene = parseScene(JSON.parse(rd(getEntry(pkg, pkg.entries.find((x) => x.name === 'scene.json').name))), null)
  const seenTex = new Map()
  console.log(`\n######## ${label} (${sid}) 层 → 纹理解码状态`)
  for (const layer of scene.layers) {
    if (!layer.visible || layer.particle || layer.isContainer || !layer.image) continue
    // 解析 texName（与 demo loadScene 相同链路）
    let model = null
    const bi = resolveBuiltin(layer.image)
    if (bi && bi.kind === 'model') model = bi.value
    else {
      const me = getEntry(pkg, layer.image)
      if (!me) continue
      try { model = JSON.parse(rd(me)) } catch { continue }
    }
    if (!model || typeof model.material !== 'string') continue
    let material = null
    const bi2 = resolveBuiltin(model.material)
    if (bi2 && bi2.kind === 'material') material = bi2.value
    else {
      const matE = getEntry(pkg, model.material)
      if (!matE) continue
      try { material = JSON.parse(rd(matE)) } catch { continue }
    }
    const pass = material.passes && material.passes[0]
    const tn = pass && pass.textures && pass.textures[0]
    if (typeof tn !== 'string' || !tn || tn.startsWith('util/')) continue
    if (seenTex.has(tn)) continue // 同一纹理多个层只统计一次
    const te = getEntry(pkg, 'materials/' + tn + '.tex')
    if (!te) { seenTex.set(tn, '缺文件'); console.log(`  ${tn}  缺 .tex 文件`); continue }
    let info = '?'
    try {
      const tex = lib.parseTex(te)
      const m0 = lib.decodeMip0(tex)
      if (m0.video !== undefined) info = 'video'
      else if (m0.png !== undefined || m0.image !== undefined) info = 'image/' + (m0.png ? 'png' : 'jpeg')
      else {
        const st = texStats(m0.rgba, m0.width, m0.height)
        info = `fmt=${tex.format} ${m0.width}x${m0.height} avgA=${st.avgA} zeroA=${st.zeroA} fullA=${st.fullA} avgRGB=${st.avgRGB} dark=${st.darkPct}`
      }
    } catch (e) {
      info = 'DECODE-FAIL: ' + e.message
    }
    seenTex.set(tn, info)
    console.log(`  ${tn.padEnd(34)} ${info}`)
  }
}

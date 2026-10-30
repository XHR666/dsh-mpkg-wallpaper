// 几何预演：按渲染器当前数学与"修正数学"分别计算每个纹理层的屏幕 AABB
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ①(2026-11-03 可移植性修正) 本机绝对路径不许进 tracked 文件（cross-platform / integrity 判据）。
//   默认按"仓库 = <DSHAREA>/dsh-mpkg-wallpaper"推导工作区根，可用 MPW_ROOT / MPW_BUNDLE / MPW_SCENES 覆盖。
const WORKSPACE = path.resolve(process.env.MPW_ROOT || path.join(path.resolve('.'), '..'), '')
const BUNDLE = process.env.MPW_BUNDLE || path.join(WORKSPACE, 'we-scene-demo', 'we-scene-bundle.js')
const SCENE_ROOT = process.env.MPW_SCENES || path.join(WORKSPACE, 'allwallpaper', 'dd')
const lib = await import(pathToFileURL(BUNDLE).href)
const { parsePkg, getEntry, parseScene, resolveBuiltin, mat4Multiply, mat4Translate, mat4Scale, mat4RotateZ } = lib
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')

// 与 renderer 相同的 ortho（y-down）：NDC y: design 0 → +1
function orthoDesign(cw, ch) {
  const o = new Float32Array(16)
  o[0] = 2 / cw; o[5] = -2 / ch; o[10] = -2 / 20000; o[12] = -1; o[13] = 1; o[14] = 0; o[15] = 1
  return o
}

function quadAABB(layer, cw, ch, flipY) {
  // local ±0.5 顶点 → model → NDC → 像素
  const w = layer.size[0] * layer.scale[0]
  const h = layer.size[1] * layer.scale[1]
  let m = new Float32Array(16); m[0]=1;m[5]=1;m[10]=1;m[15]=1
  const oy = flipY ? ch - layer.origin[1] : layer.origin[1]
  m = mat4Translate(m, layer.origin[0], oy, layer.origin[2] || 0)
  m = mat4RotateZ(m, -layer.angles[2])
  m = mat4Scale(m, w, h, 1)
  const vp = orthoDesign(cw, ch)
  const mvp = mat4Multiply(vp, m)
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
  for (const [lx, ly] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const p = [lx, ly, 0, 1]
    // mvp 列主序
    const x = mvp[0]*p[0]+mvp[4]*p[1]+mvp[8]*p[2]+mvp[12]*p[3]
    const y = mvp[1]*p[0]+mvp[5]*p[1]+mvp[9]*p[2]+mvp[13]*p[3]
    const ndx = x / p[3], ndy = y / p[3]
    const px = (ndx + 1) / 2 * 1280, py = (1 - ndy) / 2 * 720
    minX = Math.min(minX, px); maxX = Math.max(maxX, px)
    minY = Math.min(minY, py); maxY = Math.max(maxY, py)
  }
  return { minX: Math.round(minX), maxX: Math.round(maxX), minY: Math.round(minY), maxY: Math.round(maxY) }
}

function texDimsOf(pkg, tn) {
  if (!tn) return null
  const te = getEntry(pkg, 'materials/' + tn + '.tex')
  if (!te) return null
  try {
    const tex = lib.parseTex(te)
    const m0 = lib.decodeMip0(tex)
    if (m0.width && m0.height) return [m0.width, m0.height]
  } catch {}
  return null
}
function texNameOf(pkg, image) {
  let model = null
  const bi = resolveBuiltin(image)
  if (bi && bi.kind === 'model') model = bi.value
  else {
    const me = getEntry(pkg, image)
    if (!me) return null
    try { model = JSON.parse(rd(me)) } catch { return null }
  }
  if (!model || typeof model.material !== 'string') return null
  const bi2 = resolveBuiltin(model.material)
  let material = bi2 && bi2.kind === 'material' ? bi2.value : null
  if (!material) {
    const matE = getEntry(pkg, model.material)
    if (!matE) return null
    try { material = JSON.parse(rd(matE)) } catch { return null }
  }
  const pass = material.passes && material.passes[0]
  return (pass && pass.textures && pass.textures[0]) || null
}

const TARGETS = [['3554161528', 'Hina'], ['3544152633', 'GirlCat'], ['3327063360', 'Shiroko']]
for (const [sid, label] of TARGETS) {
  const pkg = parsePkg(new Uint8Array(fs.readFileSync(path.join(SCENE_ROOT, sid, 'scene.pkg'))))
  const scene = parseScene(JSON.parse(rd(getEntry(pkg, pkg.entries.find((x) => x.name === 'scene.json').name))), null)
  const g = scene.general || {}
  const cw = g.orthogonalprojection ? g.orthogonalprojection.width : 1280
  const ch = g.orthogonalprojection ? g.orthogonalprojection.height : 720
  console.log(`\n### ${label} (${sid}) 投影 ${cw}x${ch}  屏幕 1280x720`)
  for (const layer of scene.layers) {
    if (!layer.visible || layer.particle || layer.isContainer || !layer.image) continue
    const tn = texNameOf(pkg, layer.image)
    // 模拟渲染器 size 回退
    const dims = texDimsOf(pkg, tn)
    if ((layer.size[0] === 0 || layer.size[1] === 0)) {
      if (dims) layer.size = [layer.size[0] === 0 ? dims[0] : layer.size[0], layer.size[1] === 0 ? dims[1] : layer.size[1]]
      else if (layer.solid) layer.size = [cw, ch]
    }
    const name = (layer.name || ('#' + layer.id)).slice(0, 14)
    const cur = quadAABB(layer, cw, ch, true)   // 当前实现（flip）
    const fix = quadAABB(layer, cw, ch, false)  // 修正（不 flip）
    const vis = (a) => (a.maxX > 0 && a.minX < 1280 && a.maxY > 0 && a.minY < 720) ? 'ON' : 'OFF'
    const size = layer.size
    console.log(
      `${(tn || '').padEnd(16).slice(0,16)} ${name.padEnd(14)} size=${String(Math.round(size[0]*layer.scale[0])).padStart(4)}x${String(Math.round(size[1]*layer.scale[1])).padStart(4)} ${vis(fix)} [${fix.minX},${fix.maxX}]x[${fix.minY},${fix.maxY}]`,
    )
  }
}

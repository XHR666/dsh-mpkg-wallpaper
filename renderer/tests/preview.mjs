// CPU 软光栅预览器：复用渲染器的矩阵/UV 语义把场景光栅成 PNG（无 WebGL 也能“看”画面）
// 用法: node preview.mjs <sceneId> <out.png> [w] [h]
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const BUNDLE = process.env.MPW_BUNDLE || path.join(ROOT, 'core', 'we-scene-bundle.js'); // ①(去个人化) 可覆盖
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd'); // ①(去个人化) 可覆盖
const lib = await import(pathToFileURL(BUNDLE).href)
const { parsePkg, getEntry, parseScene, resolveBuiltin, applyRenderConfig } = lib
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')

const sceneId = process.argv[2]
const outFile = process.argv[3] || path.join(os.tmpdir(), 'preview.png')
const W = Number(process.argv[4] || 960)
const H = Number(process.argv[5] || 540)
const showBars = process.argv[6] === 'bars' || process.argv[7] === 'bars'

const pkg = parsePkg(new Uint8Array(fs.readFileSync(path.join(SCENE_ROOT, sceneId, 'scene.pkg'))))
const sceneJson = JSON.parse(rd(getEntry(pkg, pkg.entries.find((x) => x.name === 'scene.json').name)))
// ①(P-21-ATTACH 2026-09-13) 附件锚点走 elysia 移植实现（REFR=0 父链模式必须有锚点，否则发片/衣袖全偏）
const readEntry = (n) => getEntry(pkg, n)
const scene = parseScene(sceneJson, null, { attachCtx: { readEntry, time: 0 }, uniformFlipY: process.env.FLIPY === '1' })
// 应用渲染配置固化（与 demo.html WebGL 默认路径一致）：refrender 实绘定位 + 长条眼窗
// + 背景直绘 + 粒子关 + 隐藏 UI/音频层 + 隐藏父组纯色遮罩条。
const REFR = path.join(path.dirname(BUNDLE), 'refrender-' + sceneId + '.json')
// ①(2026-09-13) REFR=0 → 停用 refrender 绝对定位（与浏览器默认的官方父链合成一致，用于对照官方截图）
if (fs.existsSync(REFR) && process.env.REFR !== '0') {
  const es = process.env.EYESIZE
  const eyeSize = es ? es.split('x').map(Number) : undefined
  applyRenderConfig(scene, { sceneId, refrender: JSON.parse(fs.readFileSync(REFR, "utf8")), anchor: "refcenter", eyeSize, log: (m) => console.log(m) })
}
const g = scene.general || {}
const cw = g.orthogonalprojection ? g.orthogonalprojection.width : W
const ch = g.orthogonalprojection ? g.orthogonalprojection.height : H
// ①(P-107) `PROJ=persp|ortho|auto`：CPU 预览也走渲染器同一份相机（`buildCamera`）。
//   不设该环境变量 = 老式子 `orthoYDown(cw,ch)`（**逐位不变**，parity-check/projection-y 等既有用法不受影响）。
//   为什么要有：语料唯一 3D 包 3509243656 在正交下所有层都挤到左缘（世界坐标 ±50 vs 设计画布 1920），
//   只有透视档才把它投影成官方预览那种"星空 + HUD"画面 ⇒ 出图对照必须有这条通路。
const PROJ_ENV = String(process.env.PROJ || '').toLowerCase()
const PROJ_CAM = (PROJ_ENV === 'persp' || PROJ_ENV === 'auto')
  ? lib.buildCamera(scene, W, H, { proj: PROJ_ENV === 'auto' ? 'auto' : 'persp' })
  : null
if (PROJ_CAM) {
  console.log('camera[P-107]: projmode=' + PROJ_CAM.projMode + ' kind=' + PROJ_CAM.projKind
    + ' anchor=' + PROJ_CAM.projAnchor + ' fov=' + PROJ_CAM.fovY + ' dist=' + (PROJ_CAM.perspDist || 0).toFixed(3)
    + ' framed=' + PROJ_CAM.framedW.toFixed(1) + 'x' + PROJ_CAM.framedH.toFixed(1))
}
const CAM_VP = PROJ_CAM ? mul(PROJ_CAM.projection, PROJ_CAM.view) : null

// 简易 PNG 解码（8bit RGB/RGBA/灰度，支持 5 种 filter）——仅供本地预览
function decodePNG(buf) {
  const b = Buffer.from(buf)
  const idat = []
  let w = 0, h = 0, bd = 0, ct = 0
  let off = 8
  while (off < b.length) {
    const len = b.readUInt32BE(off)
    const type = b.toString('latin1', off + 4, off + 8)
    const data = b.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bd !== 8) throw new Error('bit depth ' + bd)
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0
  if (!ch) throw new Error('color type ' + ct)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch + 1
  const rgba = Buffer.alloc(w * h * 4)
  let prev = Buffer.alloc(w * ch)
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride]
    const cur = Buffer.alloc(w * ch)
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * ch
      for (let k = 0; k < ch; k++) {
        let v = raw[i + k]
        if (f === 1) v = (v + (x > 0 ? cur[(x - 1) * ch + k] : 0)) & 255
        else if (f === 2) v = (v + prev[x * ch + k]) & 255
        else if (f === 3) v = (v + (((x > 0 ? cur[(x - 1) * ch + k] : 0) + prev[x * ch + k]) >> 1)) & 255
        else if (f === 4) {
          const a = x > 0 ? cur[(x - 1) * ch + k] : 0, c = prev[x * ch + k], b2 = x > 0 ? prev[(x - 1) * ch + k] : 0
          const p = a + c - b2
          const pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c)) & 255
        }
        cur[x * ch + k] = v & 255
      }
    }
    // 写 rgba（ct6 直接；ct2 补 a=255；ct0 灰度；ct4 灰+alpha）
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (ct === 6) { for (let k = 0; k < 4; k++) rgba[o + k] = cur[x * 4 + k] }
      else if (ct === 2) { rgba[o] = cur[x*3]; rgba[o+1] = cur[x*3+1]; rgba[o+2] = cur[x*3+2]; rgba[o+3] = 255 }
      else if (ct === 0) { rgba[o] = rgba[o+1] = rgba[o+2] = cur[x]; rgba[o+3] = 255 }
      else if (ct === 4) { rgba[o] = rgba[o+1] = rgba[o+2] = cur[x*2]; rgba[o+3] = cur[x*2+1] }
    }
    prev = cur
  }
  return { rgba, w, h }
}

// ---- 纹理缓存：fmt=0/4 RGBA 直接解；PNG/JPEG 需浏览器解码，这里跳过（返回 null）----
const texCache = new Map()
function loadTexRGBA(tn) {
  if (texCache.has(tn)) return texCache.get(tn)
  let val = null
  try {
    const te = getEntry(pkg, 'materials/' + tn + '.tex')
    if (te) {
      const tex = lib.parseTex(te)
      const m0 = lib.decodeMip0(tex)
      if (m0.video !== undefined) val = { video: true, w: m0.width, h: m0.height }
      else if (m0.png !== undefined || m0.image !== undefined) {
        // 本地解码 PNG：JS 解码对隔行/调色板 PNG 不可靠，走 PIL（真实解码）
        const blob = m0.png || m0.image
        try {
          const tmp = path.join(os.tmpdir(), 'pngdec_' + randomUUID() + '.png')
          fs.writeFileSync(tmp, Buffer.from(blob))
          const dims = String(execFileSync('python3', ['-c', `from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert("RGBA")
print(im.size[0], im.size[1])`, tmp])).trim().split(' ').map(Number)
          const raw = execFileSync('python3', ['-c', `from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert("RGBA")
sys.stdout.buffer.write(im.tobytes())`, tmp], { maxBuffer: 256 * 1024 * 1024 })
          val = { rgba: Buffer.from(raw), w: dims[0], h: dims[1] }
          fs.unlinkSync(tmp)
        } catch (e) { val = { png: true, w: m0.width, h: m0.height } }
      }
      else if (m0.rgba) val = { rgba: m0.rgba, w: m0.width, h: m0.height }
    }
  } catch (e) {
    val = null
  }
  texCache.set(tn, val)
  return val
}

function texNameOf(image) {
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

// ---- 矩阵（与 bundle math 同语义：列主序）----
function mul(a, b) {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}
function ident() { const m = new Float64Array(16); m[0]=1;m[5]=1;m[10]=1;m[15]=1; return m }
function orthoYDown(cw, ch) { const m = ident(); m[0]=2/cw; m[5]=-2/ch; m[12]=-1; m[13]=1; return m }
function translate(m, x, y, z) {
  const t = ident(); t[12]=x; t[13]=y; t[14]=z; return mul(m, t)
}
function scale(m, x, y, z) {
  const s = ident(); s[0]=x; s[5]=y; s[10]=z; return mul(m, s)
}
function rotZ(m, rad) {
  const c = Math.cos(rad), sn = Math.sin(rad)
  const r = ident(); r[0]=c; r[1]=sn; r[4]=-sn; r[5]=c; return mul(m, r)
}

// ---- 图层几何（与 renderer compositeLayer 一致：origin=设计中心 y-down，无 flip）----
function layerMVP(layer, lw, lh) {
  let m = ident()
  m = translate(m, layer.origin[0], layer.origin[1], layer.origin[2] || 0)
  m = rotZ(m, -layer.angles[2])
  m = scale(m, lw, lh, 1)
  // P-21 A3：alignment 网格偏移（行为规格 docs/IMAGE-ALPHA-ALIGN-SPEC.md §2：left→+w/2、top→−h/2[y-up]）。
  // alignmentOffsetForToken 返回 y-up 偏移 → y-down 空间取反 y（与 compositeLayer 的 (0.5−a)·(w,h) 同式）。
  // ALIGN=0 环境变量复现旧行为（origin 恒几何中心）。
  if (process.env.ALIGN !== '0') {
    const off = lib.alignmentOffsetForToken(layer.alignment, lw, lh)
    m = translate(m, off[0], -off[1], 0)
  }
  return mul(CAM_VP || orthoYDown(cw, ch), m)
}

// ①(P-107) 齐次（透视）逆：H = [[m0,m4,m12],[m1,m5,m13],[m3,m7,m15]] 把 local(3) 映到 NDC(2)。
//   透视档没有仿射逆可用（同一层的上下边缘缩放不同）⇒ 逐像素解 3x3 线性方程再除第三分量。
function projInv(m) {
  const a = m[0], b = m[4], c = m[12], d = m[1], e = m[5], f = m[13], gg = m[3], h = m[7], i = m[15]
  const A = e * i - f * h, B = -(d * i - f * gg), C = d * h - e * gg
  const det = a * A + b * B + c * C
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null
  const ia = A / det, ib = -(b * i - c * h) / det, ic = (b * f - c * e) / det
  const id = B / det, ie = (a * i - c * gg) / det, if2 = -(a * f - c * d) / det
  const ig = C / det, ih = -(a * h - b * gg) / det, ii = (a * e - b * d) / det
  return { p: true, ia, ib, ic, id, ie, if: if2, ig, ih, ii }
}
// 四角 → 屏幕 bbox（含 w 除；透视档 quad 的包围盒不能只靠仿射项）
function quadBBox(mvp) {
  let minX = W, maxX = -1, minY = H, maxY = -1, behind = 0
  for (const [lx, ly] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const wq = mvp[3] * lx + mvp[7] * ly + mvp[15]
    const ndx = (mvp[0] * lx + mvp[4] * ly + mvp[12]) / wq
    const ndy = (mvp[1] * lx + mvp[5] * ly + mvp[13]) / wq
    if (!(wq > 0)) behind++
    if (!isFinite(ndx) || !isFinite(ndy)) continue
    const sx = Math.floor((ndx + 1) / 2 * W), sy = Math.floor((1 - ndy) / 2 * H)
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy)
  }
  return { minX, maxX, minY, maxY, behind }
}
// 仿射 2x3 逆（MVP 只含正交+缩放+旋转+平移，无透视）
function affineInv(m) {
  const a = m[0], b = m[4], c = m[1], d = m[5], tx = m[12], ty = m[13]
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return null
  return { ia: d / det, ib: -b / det, ic: -c / det, id: a / det, itx: (b * ty - d * tx) / det, ity: (c * tx - a * ty) / det }
}

// ---- 输出缓冲 ----
const buf = new Float64Array(W * H * 4)
// 清屏色
let cc = [0, 0, 0]
if (g.clearenabled !== false) {
  const p = String(g.clearcolor || '0 0 0').trim().split(/\s+/).map(Number)
  cc = [p[0] || 0, p[1] || 0, p[2] || 0]
}
for (let i = 0; i < W * H; i++) { buf[i*4]=cc[0]; buf[i*4+1]=cc[1]; buf[i*4+2]=cc[2]; buf[i*4+3]=1 }

function parseColorStr(s) {
  const p = String(s || '1 1 1').trim().split(/\s+/).map(Number)
  return [p[0] !== undefined ? p[0] : 1, p[1] !== undefined ? p[1] : 1, p[2] !== undefined ? p[2] : 1]
}

// 双线性采样（v 向下：y 0=顶行）
function sample(rgba, tw, th, u, v) {
  const x = u * tw - 0.5, y = v * th - 0.5
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const px = [x0, x0 + 1, x0, x0 + 1].map((q) => Math.max(0, Math.min(tw - 1, q)))
  const py = [y0, y0, y0 + 1, y0 + 1].map((q) => Math.max(0, Math.min(th - 1, q)))
  const at = (xi, yi) => (yi * tw + xi) * 4
  const c0 = at(px[0], py[0]), c1 = at(px[1], py[1]), c2 = at(px[2], py[2]), c3 = at(px[3], py[3])
  const out = []
  for (let k = 0; k < 4; k++) {
    out[k] = rgba[c0 + k] * (1 - fx) * (1 - fy) + rgba[c1 + k] * fx * (1 - fy) + rgba[c2 + k] * (1 - fx) * fy + rgba[c3 + k] * fx * fy
  }
  return out
}

// 画一个带 alpha 的四边形纹理层（屏幕像素循环 + 逆仿射）
function drawQuad(mvp, tex, tw, th, alphaMul, colorMul, uvRect) {
  const projective = mvp[3] !== 0 || mvp[7] !== 0 || mvp[11] !== 0 || mvp[15] !== 1
  const inv = projective ? projInv(mvp) : affineInv(mvp)
  if (!inv) return
  // 屏幕包围盒（透视档同样有效：四角含 w 除）
  const bb = quadBBox(mvp)
  let minX = bb.minX, maxX = bb.maxX, minY = bb.minY, maxY = bb.maxY
  if (bb.behind) { console.log('    [persp 裁剪] 该层有 ' + bb.behind + '/4 角在相机后（预览不做视锥裁剪，按可见部分画）') }
  minX = Math.max(0, minX); maxX = Math.min(W - 1, maxX); minY = Math.max(0, minY); maxY = Math.min(H - 1, maxY)
  for (let sy = minY; sy <= maxY; sy++) {
    const ndy = 1 - (2 * sy + 1) / H
    for (let sx = minX; sx <= maxX; sx++) {
      const ndx = (2 * sx + 1) / W - 1
      // 逆变换到 local（透视档先解齐次方程再除 w）
      let lx, ly
      if (inv.p) {
        const w3 = inv.ig * ndx + inv.ih * ndy + inv.ii
        if (!(Math.abs(w3) > 1e-12)) continue
        lx = (inv.ia * ndx + inv.ib * ndy + inv.ic) / w3
        ly = (inv.id * ndx + inv.ie * ndy + inv.if) / w3
      } else {
        lx = inv.ia * ndx + inv.ib * ndy + inv.itx
        ly = inv.ic * ndx + inv.id * ndy + inv.ity
      }
      if (lx < -0.5 || lx > 0.5 || ly < -0.5 || ly > 0.5) continue
      // local quad uv（顶点 -0.5→uv0，与 LOCAL_QUAD 一致）；uvRect 时映射纹理子窗铺满 quad
      const u = (uvRect ? uvRect[0] : 0) + (lx + 0.5) * ((uvRect ? uvRect[2] : 1) - (uvRect ? uvRect[0] : 0))
      const v = (uvRect ? uvRect[1] : 0) + (ly + 0.5) * ((uvRect ? uvRect[3] : 1) - (uvRect ? uvRect[1] : 0))
      const s = sample(tex, tw, th, u, v)
      const a = s[3] / 255 * alphaMul
      if (a <= 0.003) continue
      const i = (sy * W + sx) * 4
      const r = s[0] / 255 * colorMul[0], gg = s[1] / 255 * colorMul[1], b = s[2] / 255 * colorMul[2]
      buf[i] = r * a + buf[i] * (1 - a)
      buf[i + 1] = gg * a + buf[i + 1] * (1 - a)
      buf[i + 2] = b * a + buf[i + 2] * (1 - a)
      buf[i + 3] = 1
    }
  }
}

let solidPix = 0
function drawSolid(mvp, color, alpha) {
  const inv = (mvp[3] !== 0 || mvp[7] !== 0 || mvp[11] !== 0 || mvp[15] !== 1) ? projInv(mvp) : affineInv(mvp)
  if (!inv) return
  solidPix = 0
  const bbS = quadBBox(mvp)
  let minX = bbS.minX, maxX = bbS.maxX, minY = bbS.minY, maxY = bbS.maxY
  minX = Math.max(0, minX); maxX = Math.min(W - 1, maxX); minY = Math.max(0, minY); maxY = Math.min(H - 1, maxY)
  if (color[0] === 0 && alpha === 1) console.log('    [solid bbox]', minX, maxX, minY, maxY)
  let outside = 0
  for (let sy = minY; sy <= maxY; sy++) {
    const ndy = 1 - (2 * sy + 1) / H
    for (let sx = minX; sx <= maxX; sx++) {
      const ndx = (2 * sx + 1) / W - 1
      let lx, ly
      if (inv.p) {
        const w3 = inv.ig * ndx + inv.ih * ndy + inv.ii
        if (!(Math.abs(w3) > 1e-12)) { outside++; continue }
        lx = (inv.ia * ndx + inv.ib * ndy + inv.ic) / w3
        ly = (inv.id * ndx + inv.ie * ndy + inv.if) / w3
      } else {
        lx = inv.ia * ndx + inv.ib * ndy + inv.itx
        ly = inv.ic * ndx + inv.id * ndy + inv.ity
      }
      if (lx < -0.5 || lx > 0.5 || ly < -0.5 || ly > 0.5) { outside++; continue }
      const i = (sy * W + sx) * 4
      const a = alpha
      buf[i] = color[0] * a + buf[i] * (1 - a)
      buf[i + 1] = color[1] * a + buf[i + 1] * (1 - a)
      buf[i + 2] = color[2] * a + buf[i + 2] * (1 - a)
      buf[i + 3] = 1
      solidPix++
    }
  }
  if (color[0] === 0 && alpha === 1) console.log('    [solid 写入/界外]', solidPix, outside)
  if (solidPix) console.log('    [solid 写入像素]', solidPix)
}

// ---- 按渲染顺序绘制（无效果链近似）----
// ?/env W_WHITE=1：逐层统计"新引入的近白不透明像素"（定位白块来源层）
const WHITE_SCAN = !!process.env.W_WHITE
const nearWhite = (i) => buf[i] > 0.94 && buf[i + 1] > 0.94 && buf[i + 2] > 0.94 && buf[i + 3] > 0.9
let drawn = 0
let before = null
const whiteReport = (layer) => {
  if (!before) return
  let added = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    if (!before[i] && nearWhite(p)) {
      added++
      const x = i % W, y = (i / W) | 0
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  if (added > W * H * 0.002) console.log(`  [白块] ${layer.name || layer.id}: 新增 ${added}px (${(added / (W * H) * 100).toFixed(1)}%) 区域 x${minX}-${maxX} y${minY}-${maxY}`)
}
for (const layer of scene.layers) {
  if (!layer.visible || layer.particle || layer.isContainer) continue
  if (!showBars && layer.parent !== undefined && layer.solid && layer.image && layer.image.indexOf('models/util/solidlayer') === 0) continue
  if (WHITE_SCAN) { before = new Uint8Array(W * H); for (let i = 0, p = 0; i < before.length; i++, p += 4) before[i] = nearWhite(p) ? 1 : 0 }
  const tn = texNameOf(layer.image)
  const tex = tn ? loadTexRGBA(tn) : null
  let lw = layer.size[0] * layer.scale[0]
  let lh = layer.size[1] * layer.scale[1]
  if ((lw === 0 || lh === 0)) {
    if (tex && tex.w && tex.h) { lw = lw === 0 ? tex.w : lw; lh = lh === 0 ? tex.h : lh }
    else if (layer.solid) { lw = cw; lh = ch }
  }
  if (lw <= 0 || lh <= 0) continue
  const mvp = layerMVP(layer, lw, lh)
  const alpha = typeof layer.alpha === 'number' ? layer.alpha : 1
  // parseScene 的 layer.color 已是数组；无 color 时默认白
  const color = Array.isArray(layer.color) ? [layer.color[0], layer.color[1], layer.color[2]] : [1, 1, 1]
  if (layer.solid || (!tex && !tn)) {
    // 纯色层
    if (/纯色|Solide/.test(layer.name || '')) {
      const inv2 = affineInv(mvp)
      console.log('  [solid]', (layer.name || layer.id), 'size', Math.round(lw) + 'x' + Math.round(lh), 'origin', layer.origin.map((v) => Math.round(v)).join(','), 'angle', layer.angles ? layer.angles[2] : 0, 'mvp', Array.from(mvp).map((v) => +v.toFixed(3)).slice(0, 6).join(','), 't', +mvp[12].toFixed(3), +mvp[13].toFixed(3))
    }
    drawSolid(mvp, color, alpha)
    drawn++
    if (WHITE_SCAN) whiteReport(layer)
    continue
  }
  if (!tex) continue
  if (tex.video) { console.log('  [skip 视频]', layer.name || layer.id, tn); continue }
  drawQuad(mvp, tex.rgba, tex.w, tex.h, alpha, [1, 1, 1], layer.uvRect || null)
  drawn++
  if (WHITE_SCAN) whiteReport(layer)
}
console.log('drawn layers:', drawn)
if (WHITE_SCAN) console.log('（逐层白块统计见下）')

// ---- 写 PNG ----
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = y * (1 + w * 4) + 1 + x * 4
      raw[o] = Math.max(0, Math.min(255, Math.round(rgba[i] * 255)))
      raw[o + 1] = Math.max(0, Math.min(255, Math.round(rgba[i + 1] * 255)))
      raw[o + 2] = Math.max(0, Math.min(255, Math.round(rgba[i + 2] * 255)))
      raw[o + 3] = Math.max(0, Math.min(255, Math.round(rgba[i + 3] * 255)))
    }
  }
  const idat = zlib.deflateSync(raw)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
  fs.writeFileSync(file, png)
}
writePNG(outFile, W, H, buf)
console.log('written', outFile, W + 'x' + H)

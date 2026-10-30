// orient-check.mjs <sceneId> <layerNameFragment> —— 肤色带位置对比判定朝向
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

const BUNDLE = '/root/Desktop/DSHarea/we-scene-demo/we-scene-bundle.js'
const SCENE_ROOT = '/root/Desktop/DSHarea/allwallpaper/dd'
const lib = await import(pathToFileURL(BUNDLE).href)
const { parsePkg, getEntry, parseScene, resolveBuiltin } = lib
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')

const sceneId = process.argv[2]
const frag = process.argv[3]
const pkg = parsePkg(new Uint8Array(fs.readFileSync(path.join(SCENE_ROOT, sceneId, 'scene.pkg'))))
const sceneJson = JSON.parse(rd(getEntry(pkg, pkg.entries.find((x) => x.name === 'scene.json').name)))
const scene = parseScene(sceneJson, null)
const g = scene.general || {}
const cw = g.orthogonalprojection ? g.orthogonalprojection.width : 1280
const ch = g.orthogonalprojection ? g.orthogonalprojection.height : 720

function decodePNG(buf) {
  const b = Buffer.from(buf)
  const idat = []
  let w = 0, h = 0, ct = 0
  let off = 8
  while (off < b.length) {
    const len = b.readUInt32BE(off)
    const type = b.toString('latin1', off + 4, off + 8)
    const data = b.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const chn = ct === 6 ? 4 : ct === 2 ? 3 : 1
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * chn + 1
  const rgba = Buffer.alloc(w * h * 4)
  let prev = Buffer.alloc(w * chn)
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride]
    const cur = Buffer.alloc(w * chn)
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * chn
      for (let k = 0; k < chn; k++) {
        let v = raw[i + k]
        if (f === 1) v = (v + (x > 0 ? cur[(x - 1) * chn + k] : 0)) & 255
        else if (f === 2) v = (v + prev[x * chn + k]) & 255
        else if (f === 3) v = (v + (((x > 0 ? cur[(x - 1) * chn + k] : 0) + prev[x * chn + k]) >> 1)) & 255
        else if (f === 4) {
          const a = x > 0 ? cur[(x - 1) * chn + k] : 0, c = prev[x * chn + k], b2 = x > 0 ? prev[(x - 1) * chn + k] : 0
          const p = a + c - b2
          const pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c)) & 255
        }
        cur[x * chn + k] = v & 255
      }
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (ct === 6) for (let k = 0; k < 4; k++) rgba[o + k] = cur[x * 4 + k]
      else if (ct === 2) { rgba[o] = cur[x * 3]; rgba[o + 1] = cur[x * 3 + 1]; rgba[o + 2] = cur[x * 3 + 2]; rgba[o + 3] = 255 }
      else { rgba[o] = rgba[o + 1] = rgba[o + 2] = cur[x]; rgba[o + 3] = 255 }
    }
    prev = cur
  }
  return { rgba, w, h }
}

function loadTex(tn) {
  const te = getEntry(pkg, 'materials/' + tn + '.tex')
  if (!te) return null
  try {
    const tex = lib.parseTex(te)
    const m0 = lib.decodeMip0(tex)
    if (m0.png !== undefined || m0.image !== undefined) {
      const dec = decodePNG(m0.png || m0.image)
      return { rgba: dec.rgba, w: dec.w, h: dec.h }
    }
    if (m0.rgba) return { rgba: m0.rgba, w: m0.width, h: m0.height }
  } catch {}
  return null
}

const isSkin = (r, gg, b) => r > 90 && gg > 60 && b > 50 && r - gg > 12 && r - b > 20 && r < 250

// 纹理肤色带（垂直分布）
function skinProfile(tex) {
  const { rgba, w, h } = tex
  const bands = 12
  const prof = new Array(bands).fill(0)
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4
      const a = rgba[i + 3]
      if (a < 40) continue
      if (isSkin(rgba[i], rgba[i + 1], rgba[i + 2])) prof[Math.min(bands - 1, Math.floor((y / h) * bands))]++
    }
  }
  const tot = prof.reduce((a, b) => a + b, 0)
  if (!tot) return null
  // 带权质心
  let num = 0
  prof.forEach((v, i2) => { num += v * (i2 + 0.5) / bands })
  return { tot, centroid: num / tot, prof: prof.map((v) => Math.round(v / Math.max(1, tot) * 100)) }
}

// 找目标层并计算 quad 几何
for (const layer of scene.layers) {
  if (!layer.visible || layer.particle || layer.isContainer) continue
  if (!(layer.name || '').includes(frag)) continue
  let model = null
  const bi = resolveBuiltin(layer.image)
  if (bi && bi.kind === 'model') model = bi.value
  else {
    const me = getEntry(pkg, layer.image)
    if (!me) continue
    try { model = JSON.parse(rd(me)) } catch { continue }
  }
  if (!model || typeof model.material !== 'string') continue
  const bi2 = resolveBuiltin(model.material)
  let material = bi2 && bi2.kind === 'material' ? bi2.value : null
  if (!material) {
    const matE = getEntry(pkg, model.material)
    if (!matE) continue
    try { material = JSON.parse(rd(matE)) } catch { continue }
  }
  const pass = material.passes && material.passes[0]
  const tn = pass && pass.textures && pass.textures[0]
  if (!tn) continue
  const tex = loadTex(tn)
  if (!tex) { console.log(layer.name, '纹理无法本地解码'); continue }
  const sp = skinProfile(tex)
  console.log(`\n层 "${layer.name}" 纹理 ${tn} ${tex.w}x${tex.h}`)
  console.log('  纹理肤色质心(0=顶,1=底):', sp ? sp.centroid.toFixed(2) : '无肤色', sp ? JSON.stringify(sp.prof) : '')
  // 隔离光栅该层到 640x360，统计屏幕上肤色落在 quad 内归一化 v 的位置
  {
    const W2 = 640, H2 = 360
    const lw = layer.size[0] * layer.scale[0] || tex.w
    const lh = layer.size[1] * layer.scale[1] || tex.h
    // MVP（与渲染器一致，列主序，y-down 设计空间→NDC）
    const ident = () => { const m = new Float64Array(16); m[0]=1;m[5]=1;m[10]=1;m[15]=1; return m }
    const mulM = (a, b) => { const o = new Float64Array(16); for (let c=0;c<4;c++) for (let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k]; o[c*4+r]=s } return o }
    const T = (m,x,y,z)=>{ const t=ident(); t[12]=x;t[13]=y;t[14]=z; return mulM(m,t) }
    const R = (m,rad)=>{ const c=Math.cos(rad),sn=Math.sin(rad); const r=ident(); r[0]=c;r[1]=sn;r[4]=-sn;r[5]=c; return mulM(m,r) }
    const S = (m,x,y,z)=>{ const t=ident(); t[0]=x;t[5]=y;t[10]=z; return mulM(m,t) }
    const P = ident(); P[0]=2/cw; P[5]=-2/ch; P[12]=-1; P[13]=1
    let m = ident()
    m = T(m, layer.origin[0], layer.origin[1], layer.origin[2] || 0)
    m = R(m, -layer.angles[2])
    m = S(m, lw, lh, 1)
    const mvp = mulM(P, m)
    const a = mvp[0], b = mvp[4], c = mvp[1], d = mvp[5], tx = mvp[12], ty = mvp[13]
    const det = a * d - b * c
    if (Math.abs(det) > 1e-9) {
      const ia = d / det, ib = -b / det, ic = -c / det, id = a / det, itx = (b * ty - d * tx) / det, ity = (c * tx - a * ty) / det
      const bins = new Array(12).fill(0)
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
      for (const [lx, ly] of [[-0.5,-0.5],[0.5,-0.5],[-0.5,0.5],[0.5,0.5]]) {
        const ndx = mvp[0]*lx + mvp[4]*ly + mvp[12]
        const ndy = mvp[1]*lx + mvp[5]*ly + mvp[13]
        minX = Math.min(minX, Math.floor((ndx+1)/2*W2)); maxX = Math.max(maxX, Math.floor((ndx+1)/2*W2))
        minY = Math.min(minY, Math.floor((1-ndy)/2*H2)); maxY = Math.max(maxY, Math.floor((1-ndy)/2*H2))
      }
      minX = Math.max(0,minX); maxX = Math.min(W2-1,maxX); minY = Math.max(0,minY); maxY = Math.min(H2-1,maxY)
      for (let sy = minY; sy <= maxY; sy++) {
        const ndy = 1 - (2*sy+1)/H2
        for (let sx = minX; sx <= maxX; sx++) {
          const ndx = (2*sx+1)/W2 - 1
          const lx = ia*ndx + ib*ndy + itx
          const ly = ic*ndx + id*ndy + ity
          if (lx < -0.5 || lx > 0.5 || ly < -0.5 || ly > 0.5) continue
          // 采样纹理（v = ly+0.5）
          const u = (lx + 0.5) * tex.w, v = (ly + 0.5) * tex.h
          const px = Math.max(0, Math.min(tex.w - 1, Math.floor(u)))
          const py = Math.max(0, Math.min(tex.h - 1, Math.floor(v)))
          const i = (py * tex.w + px) * 4
          if (tex.rgba[i + 3] < 40) continue
          if (isSkin(tex.rgba[i], tex.rgba[i + 1], tex.rgba[i + 2])) {
            bins[Math.min(11, Math.floor(((ly + 0.5) * 12)))]++
          }
        }
      }
      const tot = bins.reduce((x, y) => x + y, 0)
      if (tot) {
        let num = 0
        bins.forEach((v2, i2) => { num += v2 * (i2 + 0.5) / 12 })
        const cpv = num / tot
        const agree = sp && Math.abs(cpv - sp.centroid) < 0.15 ? '一致(直立)' : sp ? '不一致(疑似颠倒!)' : '?'
        console.log('  屏幕肤色质心(quad 内 0=顶,1=底):', cpv.toFixed(2), '→', agree)
      } else {
        console.log('  屏幕该层区域内未检出肤色（可能被 alpha/叠层影响或该层肤色少）')
      }
    }
  }
  // 屏幕 quad
  let lw = layer.size[0] * layer.scale[0]
  let lh = layer.size[1] * layer.scale[1]
  if ((lw === 0 || lh === 0)) { if (tex.w) { lw = lw === 0 ? tex.w : lw; lh = lh === 0 ? tex.h : lh } }
  const halfW = lw / 2 * (cw > 0 ? 1 : 1)
  const x1 = (layer.origin[0] - lw / 2) / cw * 2 - 1
  const x2 = (layer.origin[0] + lw / 2) / cw * 2 - 1
  const y1 = 1 - (2 * (layer.origin[1] - lh / 2)) / ch * 0 - (layer.origin[1] - lh / 2) / ch * 2 // ndc top
  const ndyTop = 1 - (2 * (layer.origin[1] - lh / 2)) / ch
  const ndyBot = 1 - (2 * (layer.origin[1] + lh / 2)) / ch
  console.log(`  quad(设计px) x:${Math.round(layer.origin[0] - lw / 2)}..${Math.round(layer.origin[0] + lw / 2)} y:${Math.round(layer.origin[1] - lh / 2)}..${Math.round(layer.origin[1] + lh / 2)}`)
  console.log(`  屏幕 NDC y 顶=${ndyTop.toFixed(2)} 底=${ndyBot.toFixed(2)} (设计 y 小=顶)`)
  console.log(`  → 纹理顶行(肤色带0) 应落在屏幕 ${((1 - ndyTop) / 2).toFixed(2)} 高度处(0=屏幕顶)`)
}

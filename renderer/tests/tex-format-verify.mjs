// tex-format-verify.mjs — RE-40 验证：全语料 .tex 格式分布 + format 5（半分辨率 DXT5）尺寸假设的字节级证据
// 用法: node tex-format-verify.mjs [目录或 .pkg/.mpkg ...] [--dump <outDir>]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
// ①(去个人化 2026-09-16) 插件下载缓存 / 备用语料根：环境变量优先；默认值只是作者本机路径。
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'
const MPW_SD_ROOT = process.env.MPW_SD_ROOT || '/mnt/sdcard/wallpapertest1'

const argv = process.argv.slice(2)
const dumpIdx = argv.indexOf('--dump')
const dumpDir = dumpIdx >= 0 ? argv[dumpIdx + 1] : null
const roots = argv.filter((a, i) => i !== dumpIdx && i !== dumpIdx + 1)
if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true })

function findPkgs() {
  const out = []
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

function writePNG(file, rgba, w, h) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = y * (1 + w * 4) + 1 + x * 4
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3]
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

function toSprite(rgba, w, h, tw) {
  const th = Math.max(1, Math.round(tw * h / w))
  const out = Buffer.alloc(tw * th * 4)
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const si = (Math.floor(y * h / th) * w + Math.floor(x * w / tw)) * 4, di = (y * tw + x) * 4
    out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3]
  }
  return { out, tw, th }
}

const fmtCount = {}
const fmtShape = {}   // format → { mipEqDeclared, mipHalfDeclared, bc3ExactForMip, rawExactForMip, cropMismatch }
const problems = []
const fmt5Samples = []
const pkgs = findPkgs()
const decodeFail = []
let texTotal = 0, noMip = 0, dumped = 0

const bc3Size = (w, h) => Math.ceil(w / 4) * Math.ceil(h / 4) * 16

for (const file of pkgs) {
  let pkg
  try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file))) } catch (e) { problems.push(`${path.basename(file)}: parsePkg ${e.message}`); continue }
  for (const e of pkg.entries) {
    const name = e.name
    let buf
    try { buf = new Uint8Array(e.data !== undefined ? e.data : lib.getEntry(pkg, name)) } catch { continue }
    if (!buf || buf.length < 20) continue
    if (!(buf[0] === 0x54 && buf[1] === 0x45 && buf[2] === 0x58)) continue // "TEX"
    let tex
    try { tex = lib.parseTex(buf) } catch (err) { problems.push(`${path.basename(file)}:${name}: parseTex ${err.message}`); continue }
    texTotal++
    const f = tex.format
    fmtCount[f] = (fmtCount[f] || 0) + 1
    const s = fmtShape[f] || (fmtShape[f] = { n: 0, mipEqDeclared: 0, mipHalfDeclared: 0, mipOtherRel: 0, bc3ExactForMip: 0, rawExactForMip: 0, rawExactForDeclared: 0 })
    s.n++
    const mip = tex.images[0] && tex.images[0][0]
    if (!mip) { noMip++; continue }
    const dLen = mip.data.length
    if (mip.width === tex.width && mip.height === tex.height) s.mipEqDeclared++
    else if (mip.width * 2 === tex.width || mip.width * 2 + 1 === tex.width || (mip.height * 2 === tex.height || mip.height * 2 + 1 === tex.height)) s.mipHalfDeclared++
    else s.mipOtherRel++
    if (dLen === bc3Size(mip.width, mip.height)) s.bc3ExactForMip++
    if (dLen === mip.width * mip.height * 4) s.rawExactForMip++
    if (dLen === tex.width * tex.height * 4) s.rawExactForDeclared++
    if (f === 5 && fmt5Samples.length < 40) fmt5Samples.push({ file: path.basename(file), name, dw: tex.width, dh: tex.height, mw: mip.width, mh: mip.height, dLen, bc3Mip: bc3Size(mip.width, mip.height), bc3Decl: bc3Size(tex.width, tex.height) })
    // 全格式解码门禁：任何格式解码抛错都要计数（RE-40 验收：失败数应为 0）
    if (!mip.__decoded) {
      mip.__decoded = 1
      try { lib.decodeMip0(tex) } catch (err) { decodeFail.push(`${path.basename(file)}:${name} fmt=${f} ${mip.width}x${mip.height} dLen=${dLen}: ${err.message}`) }
    }
    // 解码检查
    if (dumpDir && (f === 5 || f === 0) && dumped < 60) {
      try {
        const rgba = lib.decodePixels(f, mip.data, mip.width, mip.height)
const sp = toSprite(rgba, mip.width, mip.height, 320)
        const base = `${f}_${path.basename(file, path.extname(file))}_${path.basename(name, '.tex')}`.replace(/[^\w.-]+/g, '_')
        writePNG(path.join(dumpDir, base + '.png'), sp.out, sp.tw, sp.th)
        dumped++
      } catch (err) { decodeFail.push(`${path.basename(file)}:${name} fmt=${f} ${mip.width}x${mip.height} dLen=${dLen}: ${err.message}`) }
    }
  }
}

const out = {
  files: pkgs.length,
  texTotal,
  noMip,
  formatCounts: Object.fromEntries(Object.entries(fmtCount).sort((a, b) => b[1] - a[1])),
  formatShape: fmtShape,
  fmt5Samples,
  decodeFail,
  problems: problems.slice(0, 20),
}
console.log(JSON.stringify(out, null, 2))

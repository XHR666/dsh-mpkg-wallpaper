// tex-dump.mjs <sceneId> <outDir> [名字正则] —— 把场景纹理导出为 PNG 缩略图
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

// ①(2026-11-03 可移植性修正) 本机绝对路径不许进 tracked 文件（cross-platform / integrity 判据）。
//   默认按"仓库 = <DSHAREA>/dsh-mpkg-wallpaper"推导工作区根，可用 MPW_ROOT / MPW_BUNDLE / MPW_SCENES 覆盖。
const WORKSPACE = path.resolve(process.env.MPW_ROOT || path.join(path.resolve('.'), '..'), '')
const BUNDLE = process.env.MPW_BUNDLE || path.join(WORKSPACE, 'we-scene-demo', 'we-scene-bundle.js')
const SCENE_ROOT = process.env.MPW_SCENES || path.join(WORKSPACE, 'allwallpaper', 'dd')
const lib = await import(pathToFileURL(BUNDLE).href)
const { parsePkg, getEntry } = lib
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')

const sceneId = process.argv[2]
const outDir = process.argv[3] || '/tmp/texdump'
const nameRe = process.argv[4] ? new RegExp(process.argv[4]) : null
fs.mkdirSync(outDir, { recursive: true })

const pkg = parsePkg(new Uint8Array(fs.readFileSync(path.join(SCENE_ROOT, sceneId, 'scene.pkg'))))

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

function writePNG(file, rgba, w, h) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = y * (1 + w * 4) + 1 + x * 4
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3]
    }
  }
  const idat = zlib.deflateSync(raw)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]))
}

function downsample(rgba, w, h, tw) {
  const th = Math.max(1, Math.round(tw * h / w))
  const out = Buffer.alloc(tw * th * 4)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = Math.floor(x * w / tw), sy = Math.floor(y * h / th)
      const si = (sy * w + sx) * 4, di = (y * tw + x) * 4
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3]
    }
  }
  return { out, tw, th }
}

const seen = new Set()
for (const e of pkg.entries.filter((x) => x.name.startsWith('materials/') && x.name.endsWith('.tex'))) {
  const tname = e.name.slice('materials/'.length, -'.tex'.length)
  if (nameRe && !nameRe.test(tname)) continue
  if (seen.has(tname)) continue
  seen.add(tname)
  let info
  try {
    const tex = lib.parseTex(getEntry(pkg, e.name))
    const m0 = lib.decodeMip0(tex)
    if (m0.video !== undefined) { console.log('  [video]', tname); continue }
    let rgba, w, h
    if (m0.png !== undefined || m0.image !== undefined) {
      const dec = decodePNG(m0.png || m0.image)
      rgba = dec.rgba; w = dec.w; h = dec.h
    } else if (m0.rgba) {
      rgba = m0.rgba; w = m0.width; h = m0.height
    } else { console.log('  [skip]', tname); continue }
    const tw = Math.min(360, w)
    const { out, tw: ow, th: oh } = downsample(rgba, w, h, tw)
    const safe = tname.replace(/[^\w\u4e00-\u9fa5()-]/g, '_').slice(0, 60)
    writePNG(path.join(outDir, safe + '.png'), out, ow, oh)
    console.log(`  ${tname}  ${w}x${h} → ${ow}x${oh}`)
  } catch (err) {
    console.log('  [ERR]', tname, err.message)
  }
}

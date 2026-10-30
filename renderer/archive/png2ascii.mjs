// png2ascii.mjs <file> — 把 PNG 输出成 ASCII 亮度图（终端可读构图）
import fs from 'node:fs'
import zlib from 'node:zlib'

function loadPNG(file) {
  const b = fs.readFileSync(file)
  const idat = []
  let w = 0, h = 0
  let off = 8
  while (off < b.length) {
    const len = b.readUInt32BE(off)
    const type = b.toString('latin1', off + 4, off + 8)
    const data = b.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * 4 + 1
  const out = Buffer.alloc(w * h * 4)
  let prev = Buffer.alloc(w * 4)
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride]
    const cur = Buffer.alloc(w * 4)
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * 4
      for (let k = 0; k < 4; k++) {
        let v = raw[i + k]
        if (f === 1) v = (v + (x > 0 ? cur[(x - 1) * 4 + k] : 0)) & 255
        else if (f === 2) v = (v + prev[x * 4 + k]) & 255
        else if (f === 3) v = (v + (((x > 0 ? cur[(x - 1) * 4 + k] : 0) + prev[x * 4 + k]) >> 1)) & 255
        else if (f === 4) {
          const a = x > 0 ? cur[(x - 1) * 4 + k] : 0, c = prev[x * 4 + k], b2 = x > 0 ? prev[(x - 1) * 4 + k] : 0
          const p = a + c - b2
          const pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c)) & 255
        }
        cur[x * 4 + k] = v & 255
        out[(y * w + x) * 4 + k] = v
      }
    }
    prev = cur
  }
  return { w, h, out }
}

const img = loadPNG(process.argv[2])
const cols = Number(process.argv[3] || 110)
const rows = Math.max(20, Math.floor((cols * img.h) / img.w * 0.46))
const cw = img.w / cols, chh = img.h / rows
const chars = ' .:-=+*#%@'
let art = ''
for (let ry = 0; ry < rows; ry++) {
  let line = ''
  for (let rx = 0; rx < cols; rx++) {
    let r = 0, g = 0, b = 0, n = 0
    for (let y = Math.floor(ry * chh); y < Math.min(img.h, Math.ceil((ry + 1) * chh)); y += 2) {
      for (let x = Math.floor(rx * cw); x < Math.min(img.w, Math.ceil((rx + 1) * cw)); x += 2) {
        const i = (y * img.w + x) * 4
        r += img.out[i]; g += img.out[i + 1]; b += img.out[i + 2]; n++
      }
    }
    if (!n) { line += ' '; continue }
    r /= n; g /= n; b /= n
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    line += chars[Math.min(9, Math.floor((lum / 256) * 10))]
  }
  art += line + '\n'
}
console.log(art)
console.log('size ' + img.w + 'x' + img.h)

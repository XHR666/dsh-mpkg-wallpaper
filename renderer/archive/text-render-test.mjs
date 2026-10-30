// text-render-test.mjs — 用真实包内字体验证 RE-19 文本光栅化（纯 JS，无浏览器）
import fs from 'node:fs'
import zlib from 'node:zlib'
import * as lib from './we-scene-bundle.js'
import { loadFont, renderTextBlock, wrapText, measureLine } from './text-render.mjs'

const dec = new TextDecoder()
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = y * (1 + w * 4) + 1 + x * 4
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3]
    }
  }
  const idat = zlib.deflateSync(raw)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]))
}

const cases = [
  { id: '3326873240', name: '文本1', text: 'Bilibili 夜莺Night' },
  { id: '3326873240', name: 'Clock', text: '12:34' },
  { id: '3554161528', name: '', text: 'Mirtazapine' },
]
const tiles = []
for (const c of cases) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`~/DSHarea/allwallpaper/dd/${c.id}/scene.pkg`)))
  const scene = lib.parseScene(JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, '')))
  const layer = scene.layers.find((l) => l.__text && (l.name === c.name || !c.name) && l.__text.text)
  if (!layer) { console.log(`✗ ${c.id}/${c.name}: 找不到文本层`); continue }
  const fp = layer.__text.font
  const bytes = lib.getEntry(pkg, fp)
  if (!bytes) { console.log(`✗ ${c.id}: 字体缺失 ${fp}`); continue }
  const t0 = Date.now()
  const fontKey = c.id + '/' + fp
  const font = loadFont(fontKey, new Uint8Array(bytes))
  if (!font) { console.log(`✗ ${c.id}: 字体解析失败 ${fp.split('/').pop()}`); continue }
  const size = Math.max(8, layer.__text.pointsize)
  const maxW = layer.__text.limitwidth && layer.__text.maxwidth > 0 ? layer.__text.maxwidth : 0
  const lines = wrapText(fontKey, font, c.text, size, maxW)
  const img = renderTextBlock(fontKey, font, lines, size, { horizontalalign: layer.__text.horizontalalign })
  console.log(`✓ ${c.id} ${String(c.name).padEnd(10)} font=${fp.split('/').pop().padEnd(22)} 文本=${img.width}x${img.height} 行=${lines.length} 用时=${Date.now() - t0}ms text="${c.text}"`)
  tiles.push(img)
}
if (tiles.length) {
  const W = Math.max(...tiles.map((t) => t.width)) + 20
  const H = tiles.reduce((a, t) => a + t.height + 10, 10)
  const buf = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) { buf[i * 4] = 16; buf[i * 4 + 1] = 18; buf[i * 4 + 2] = 24; buf[i * 4 + 3] = 255 }
  let y0 = 10
  for (const t of tiles) {
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
      const si = (y * t.width + x) * 4, di = ((y0 + y) * W + (x + 10)) * 4
      const a = t.rgba[si + 3] / 255
      buf[di] = Math.round(buf[di] * (1 - a) + t.rgba[si] * a)
      buf[di + 1] = Math.round(buf[di + 1] * (1 - a) + t.rgba[si + 1] * a)
      buf[di + 2] = Math.round(buf[di + 2] * (1 - a) + t.rgba[si + 2] * a)
    }
    y0 += t.height + 10
  }
  writePNG('/tmp/text-render.png', W, H, buf)
  console.log('\n拼图输出: /tmp/text-render.png')
}

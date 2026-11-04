// text-render.mjs — RE-19 文本光栅化（纯 JS，设备与 node 共用，可测）
// 官方语义（RE-19）：位图只含 coverage(alpha)，颜色由层材质 uniform 提供；
// 本模块输出 **白色文字 + alpha**（color=[1,1,1]），由渲染器的层 color×brightness 上色。
// 排版：逐字取字形位图（elysia font-render 提供轮廓光栅化），pen 位置由本模块累加
//       （elysia 的 renderText 组合存在 advance 叠加错误 → 出现叠字，这里自己算）。
import { parseCffFont, renderText } from '../elysia/font-render.js'

const fontCache = new Map()   // key: pkgEntryName → font 对象
const glyphCache = new Map()  // key: fontKey|char|size → { rgba, width, height, advancePx }

/** 从字体字节解析（带缓存）。失败返回 null。 */
export function loadFont(fontKey, bytes) {
  if (fontCache.has(fontKey)) return fontCache.get(fontKey)
  let f = null
  try { f = parseCffFont(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch (e) { f = null }
  fontCache.set(fontKey, f)
  return f
}

/** 单字形位图（白色，alpha=coverage）。 */
function glyphOf(fontKey, font, ch, size) {
  const key = fontKey + '|' + ch + '|' + size
  if (glyphCache.has(key)) return glyphCache.get(key)
  let g = null
  try {
    const r = renderText(font, ch, size, [1, 1, 1])
    // 字形在 renderText 里的墨迹上边缘 = 基线 - height（renderText 已裁剪空白）
    g = { rgba: r.rgba, width: r.width, height: r.height, advancePx: r.advancePx || r.width }
  } catch (e) { g = null }
  glyphCache.set(key, g)
  return g
}

/** 测量一行宽度（px）。 */
export function measureLine(fontKey, font, text, size) {
  let w = 0
  for (const ch of String(text)) {
    const g = glyphOf(fontKey, font, ch, size)
    w += g ? (g.advancePx || g.width) : size * 0.5
  }
  return w
}

/**
 * 渲染多行文本为 RGBA（白色 coverage）。
 * @returns {{width:number,height:number,rgba:Uint8Array,lineHeight:number,lines:string[]}|null}
 */
export function renderTextBlock(fontKey, font, lines, size, opts = {}) {
  const pad = opts.padding || [0, 0, 0, 0]   // [top,right,bottom,left]
  const lineH = Math.round(size * (opts.lineHeightRatio || 1.2))
  const widths = lines.map((l) => measureLine(fontKey, font, l, size))
  const textW = Math.max(0, ...widths)
  const w = Math.max(2, Math.ceil(textW + pad[1] + pad[3]))
  const h = Math.max(2, Math.ceil(lines.length * lineH + pad[0] + pad[2]))
  const out = new Uint8Array(w * h * 4)
  if (opts.background) {
    const [r, g, b] = opts.background
    for (let i = 0; i < w * h; i++) {
      out[i * 4] = Math.round(Math.max(0, Math.min(1, r)) * 255)
      out[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255)
      out[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255)
      out[i * 4 + 3] = 255
    }
  }
  const ha = opts.horizontalalign === 'center' ? 'center' : (opts.horizontalalign === 'right' ? 'right' : 'left')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const lw = widths[li]
    let penX = ha === 'center' ? (pad[3] + (w - pad[1] - pad[3] - lw) / 2)
      : ha === 'right' ? (w - pad[3] - lw)
        : pad[3]
    const baseline = Math.round(pad[0] + li * lineH + size * 0.98)
    for (const ch of line) {
      const g = glyphOf(fontKey, font, ch, size)
      if (g && g.width > 0) {
        // 逐像素 alpha 合成（白色）
        for (let y = 0; y < g.height; y++) {
          const dy = baseline - g.height + y
          if (dy < 0 || dy >= h) continue
          for (let x = 0; x < g.width; x++) {
            const dx = Math.round(penX) + x
            if (dx < 0 || dx >= w) continue
            const sa = g.rgba[(y * g.width + x) * 4 + 3] / 255
            if (sa <= 0) continue
            const di = (dy * w + dx) * 4
            const da = out[di + 3] / 255
            const oa = sa + da * (1 - sa)
            const mix = (sc, dc) => Math.round((sc * sa + dc * da * (1 - sa)) / (oa || 1))
            out[di] = mix(255, out[di])
            out[di + 1] = mix(255, out[di + 1])
            out[di + 2] = mix(255, out[di + 2])
            out[di + 3] = Math.round(oa * 255)
          }
        }
      }
      penX += g ? (g.advancePx || g.width) : size * 0.5
    }
  }
  return { width: w, height: h, rgba: out, lineHeight: lineH, lines }
}

/** 按 maxwidth 换行（等价 PANGO_WRAP_WORD_CHAR）。 */
export function wrapText(fontKey, font, text, size, maxWidth) {
  const raw = String(text).split(/\r?\n/)
  if (!maxWidth || maxWidth <= 0) return raw
  const out = []
  for (const line of raw) {
    let cur = ''
    for (const word of line.split(/(\s+)/)) {
      const test = cur + word
      if (measureLine(fontKey, font, test, size) <= maxWidth || !cur) {
        if (measureLine(fontKey, font, test, size) <= maxWidth) { cur = test; continue }
        let piece = cur
        for (const ch of word) {
          if (piece && measureLine(fontKey, font, piece + ch, size) > maxWidth) { out.push(piece); piece = ch }
          else piece += ch
        }
        cur = piece
      } else { out.push(cur.replace(/\s+$/, '')); cur = word.replace(/^\s+/, '') }
    }
    out.push(cur)
  }
  return out
}

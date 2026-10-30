// pixels.js — decompress a mip payload into 8-bit RGBA.
//
// Independent implementation from the *public* definitions of each pixel format:
//   · uncompressed layouts (ARGB8888/RGB888/RGB565/RG88/R8) — straight byte layout,
//   · BC1/BC2/BC3 (DXT1/DXT3/DXT5) — public block-compression definitions: 4×4 blocks,
//     16-bit RGB565 endpoints, 2-bit (BC1) / 3-bit (BC2) / 8-bit (BC3) index or alpha data.
//
// Scope: payload -> RGBA only. No mip selection, no resize/crop, no premultiply, no
// upload. Block-compressed textures decode at the *mip descriptor's* dimensions; TEX
// format 5 (ETC2_RGBA8_EAC) is stored at half the declared texture size, so the mip
// descriptor carries 1920x1080 for a 3840x2160 texture and callers that want display-size
// pixels must scale — this module deliberately does not.

import { BLOCK_BYTES, BYTES_PER_PIXEL, TEXTURE_FORMATS } from './format.js'
import { toBytes } from './lz4.js'
import { decodeEtc2Rgba8 } from './etc2.js'

/** Formats `decodePixels` can decode. */
export const DECODABLE_FORMATS = Object.freeze([0, 1, 2, 4, 5, 6, 7, 8, 9])
const DXT_LIKE = new Set([4, 6, 7])

/**
 * Decode one mip payload to RGBA bytes (4 bytes per pixel, row-major, top-left origin).
 *
 * @param {number} format  TEX pixel format id
 * @param {number} width   mip width in pixels
 * @param {number} height  mip height in pixels
 * @param {Uint8Array|ArrayBuffer|DataView} payload
 * @returns {Uint8Array} width*height*4 bytes
 */
export function decodePixels(format, width, height, payload) {
  const src = toBytes(payload)
  const w = width | 0
  const h = height | 0
  if (w < 0 || h < 0) throw new RangeError('decodePixels: negative dimensions')
  const out = new Uint8Array(w * h * 4)
  const need = expectedPayloadSize(format, w, h)
  if (src.length < need) throw new RangeError(`decodePixels: format ${format} needs ${need} bytes for ${w}x${h}, got ${src.length}`)
  switch (format) {
    case 0: return decodeArgb8888(src, out, w * h)
    case 1: return decodeRgb888(src, out, w * h)
    case 2: return decodeRgb565(src, out, w * h)
    case 8: return decodeRg88(src, out, w * h)
    case 9: return decodeR8(src, out, w * h)
    case 4: return decodeBc3(src, out, w, h)
    case 5: return decodeEtc2Rgba8(w, h, src)
    case 6: return decodeBc2(src, out, w, h)
    case 7: return decodeBc1(src, out, w, h)
    default:
      throw new RangeError(`decodePixels: format ${format} (${TEXTURE_FORMATS[format] || 'unknown'}) is not decodable`)
  }
}

/** Payload size in bytes for a format/dimension pair (0 for unknown formats). */
export function expectedPayloadSize(format, width, height) {
  const w = width | 0
  const h = height | 0
  if (BYTES_PER_PIXEL[format]) return w * h * BYTES_PER_PIXEL[format]
  if (BLOCK_BYTES[format]) return Math.ceil(w / 4) * Math.ceil(h / 4) * BLOCK_BYTES[format]
  return 0
}

/** `true` when the payload length matches the format's natural size. */
export function payloadSizeMatches(format, width, height, byteLength) {
  const need = expectedPayloadSize(format, width, height)
  return need > 0 && byteLength === need
}

function decodeArgb8888(src, out, pixels) {
  // 4 bytes per pixel, copied verbatim: this module preserves the container's own byte
  // order instead of guessing a swizzle. Whether the stored order is RGBA or BGRA is not
  // verified against a renderer (PROVENANCE.md §4); payload-level parity is what is
  // asserted, so the bytes themselves are trustworthy.
  out.set(src.subarray(0, pixels * 4))
  return out
}

function decodeRgb888(src, out, pixels) {
  for (let i = 0, o = 0; i < pixels; i++, o += 4) {
    const s = i * 3
    out[o] = src[s]
    out[o + 1] = src[s + 1]
    out[o + 2] = src[s + 2]
    out[o + 3] = 255
  }
  return out
}

function decodeRgb565(src, out, pixels) {
  for (let i = 0, o = 0; i < pixels; i++, o += 4) {
    const s = i * 2
    const v = src[s] | (src[s + 1] << 8)
    const r5 = (v >> 11) & 0x1f
    const g6 = (v >> 5) & 0x3f
    const b5 = v & 0x1f
    out[o] = (r5 << 3) | (r5 >> 2)
    out[o + 1] = (g6 << 2) | (g6 >> 4)
    out[o + 2] = (b5 << 3) | (b5 >> 2)
    out[o + 3] = 255
  }
  return out
}

function decodeRg88(src, out, pixels) {
  for (let i = 0, o = 0; i < pixels; i++, o += 4) {
    const s = i * 2
    out[o] = src[s]
    out[o + 1] = src[s + 1]
    out[o + 2] = 0
    out[o + 3] = 255
  }
  return out
}

function decodeR8(src, out, pixels) {
  for (let i = 0, o = 0; i < pixels; i++, o += 4) {
    const v = src[i]
    out[o] = v
    out[o + 1] = v
    out[o + 2] = v
    out[o + 3] = 255
  }
  return out
}

// ---- BC1 / BC2 / BC3 ----

const expand5 = new Uint8Array(32)
const expand6 = new Uint8Array(64)
for (let i = 0; i < 32; i++) expand5[i] = (i << 3) | (i >> 2)
for (let i = 0; i < 64; i++) expand6[i] = (i << 2) | (i >> 4)

function decodeBc1(src, out, w, h) {
  const bw = Math.ceil(w / 4)
  const bh = Math.ceil(h / 4)
  const color = new Uint8Array(16) // 4 colours × RGBA
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const block = (by * bw + bx) * 8
      const c0 = src[block] | (src[block + 1] << 8)
      const c1 = src[block + 2] | (src[block + 3] << 8)
      buildBc1Palette(c0, c1, color)
      for (let py = 0; py < 4; py++) {
        const bits = src[block + 4 + py]
        for (let px = 0; px < 4; px++) {
          const idx = (bits >> (px * 2)) & 0x03
          const x = bx * 4 + px
          const y = by * 4 + py
          if (x >= w || y >= h) continue
          const o = (y * w + x) * 4
          const c = idx * 4
          out[o] = color[c]
          out[o + 1] = color[c + 1]
          out[o + 2] = color[c + 2]
          out[o + 3] = color[c + 3]
        }
      }
    }
  }
  return out
}

function buildBc1Palette(c0, c1, color) {
  const a = rgb565(c0)
  const b = rgb565(c1)
  color[0] = a[0]; color[1] = a[1]; color[2] = a[2]; color[3] = 255
  color[4] = b[0]; color[5] = b[1]; color[6] = b[2]; color[7] = 255
  if (c0 > c1) {
    color[8] = (2 * a[0] + b[0]) / 3 | 0; color[9] = (2 * a[1] + b[1]) / 3 | 0; color[10] = (2 * a[2] + b[2]) / 3 | 0; color[11] = 255
    color[12] = (a[0] + 2 * b[0]) / 3 | 0; color[13] = (a[1] + 2 * b[1]) / 3 | 0; color[14] = (a[2] + 2 * b[2]) / 3 | 0; color[15] = 255
  } else {
    color[8] = (a[0] + b[0]) >> 1; color[9] = (a[1] + b[1]) >> 1; color[10] = (a[2] + b[2]) >> 1; color[11] = 255
    color[12] = 0; color[13] = 0; color[14] = 0; color[15] = 0 // transparent black
  }
}

function decodeBc2(src, out, w, h) {
  return decodeBc23(src, out, w, h, false)
}

function decodeBc3(src, out, w, h) {
  return decodeBc23(src, out, w, h, true)
}

function decodeBc23(src, out, w, h, interpolatedAlpha) {
  const bw = Math.ceil(w / 4)
  const bh = Math.ceil(h / 4)
  const color = new Uint8Array(16)
  const alpha = new Uint8Array(16)
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const block = (by * bw + bx) * 16
      if (interpolatedAlpha) buildBc3Alpha(src, block, alpha)
      else buildBc2Alpha(src, block, alpha)
      const c0 = src[block + 8] | (src[block + 9] << 8)
      const c1 = src[block + 10] | (src[block + 11] << 8)
      buildBc1Palette(c0, c1, color)
      for (let py = 0; py < 4; py++) {
        const bits = src[block + 12 + py]
        for (let px = 0; px < 4; px++) {
          const idx = (bits >> (px * 2)) & 0x03
          const x = bx * 4 + px
          const y = by * 4 + py
          if (x >= w || y >= h) continue
          const o = (y * w + x) * 4
          const c = idx * 4
          out[o] = color[c]
          out[o + 1] = color[c + 1]
          out[o + 2] = color[c + 2]
          out[o + 3] = alpha[py * 4 + px]
        }
      }
    }
  }
  return out
}

function buildBc2Alpha(src, block, alpha) {
  // BC2: 16 × 4-bit values, 8 bytes; pixel i uses the low nibble of byte i>>1 when i is
  // even and the high nibble when i is odd (row-major over the 4×4 block).
  for (let i = 0; i < 16; i++) {
    const b = src[block + (i >> 1)]
    alpha[i] = ((i & 1) === 0 ? b & 0x0f : b >> 4) * 17
  }
}

function buildBc3Alpha(src, block, alpha) {
  // BC3: two 8-bit endpoints + 16 × 3-bit indices (48 bits, little-endian).
  const a0 = src[block]
  const a1 = src[block + 1]
  const table = new Uint8Array(8)
  table[0] = a0
  table[1] = a1
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) table[i + 1] = ((7 - i) * a0 + i * a1) / 7 | 0
  } else {
    for (let i = 1; i <= 4; i++) table[i + 1] = ((5 - i) * a0 + i * a1) / 5 | 0
    table[6] = 0
    table[7] = 255
  }
  let bits = 0n
  for (let i = 5; i >= 2; i--) bits = (bits << 8n) | BigInt(src[block + i])
  for (let i = 0; i < 16; i++) {
    alpha[i] = table[Number((bits >> BigInt(i * 3)) & 7n)]
  }
}

function rgb565(v) {
  return [expand5[(v >> 11) & 0x1f], expand6[(v >> 5) & 0x3f], expand5[v & 0x1f]]
}

// etc2.js — ETC2 / EAC decoder for TEX `format 5` (ETC2_RGBA8_EAC).
//
// Why this file exists: Wallpaper Engine's mobile/Android pipeline re-encodes wallpaper
// textures to ETC2 instead of DXT5, and marks them with container `format 5`. The official
// renderer uploads them with GL internal format 0x9278 (GL_COMPRESSED_RGBA8_ETC2_EAC) — see
// docs/reverse/RE-40 evidence in the parent workspace; the PC corpus never contains format 5
// (only 0/4/6/7/8/9), the Android `.mpkg` corpus is dominated by 0/5/9.
//
// Layout of one 16-byte block (4x4 pixels):
//   bytes 0..7   EAC alpha block   (base, multiplier, 16 x 3-bit indices)
//   bytes 8..15  ETC2 colour block (individual / differential / T / H / planar)
//
// Algorithm: ETC1/ETC2/EAC as defined by the public OpenGL ES 3.0 / KHR Data Format
// specification. Ported from the MIT-licensed reference decoder in
// `texture2ddecoder` 1.0.6 (src/Texture2DDecoder/etc.cpp, Copyright (c) 2020 K0lb3, MIT);
// the tables and bit wiring are spec constants. Verified byte-exact against that reference
// on the real corpus texture (129,600 blocks, 0 mismatches).
//
// Scope: one mip payload -> RGBA8. No mip selection, no resize, no premultiply.

/** ETC pixel write order: the i-th index group belongs to this raster pixel. */
const WRITE_ORDER = new Uint8Array([0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15])
/** Reverse order, used by the EAC alpha block. */
const WRITE_ORDER_REV = new Uint8Array([15, 11, 7, 3, 14, 10, 6, 2, 13, 9, 5, 1, 12, 8, 4, 0])
/** ETC1 modifier magnitudes (sign comes from an index bit). */
const ETC1_MOD = new Uint8Array([2, 8, 5, 17, 9, 29, 13, 42, 18, 60, 24, 80, 33, 106, 47, 183])
/** Subblock per pixel slot, indexed by the flip bit. */
const SUBBLOCK = [
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]),
  new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]),
]
/** ETC2 T/H distance table. */
const ETC2_DISTANCE = new Uint8Array([3, 6, 11, 16, 23, 32, 41, 64])
/** EAC alpha modifier table (16 multipliers x 8 indices). */
const EAC_MOD = [
  [-3, -6, -9, -15, 2, 5, 8, 14], [-3, -7, -10, -13, 2, 6, 9, 12], [-2, -5, -8, -13, 1, 4, 7, 12],
  [-2, -4, -6, -13, 1, 3, 5, 12], [-3, -6, -8, -12, 2, 5, 7, 11], [-3, -7, -9, -11, 2, 6, 8, 10],
  [-4, -7, -8, -11, 3, 6, 7, 10], [-3, -5, -8, -11, 2, 4, 7, 10], [-2, -6, -8, -10, 1, 5, 7, 9],
  [-2, -5, -8, -10, 1, 4, 7, 9], [-2, -4, -8, -10, 1, 3, 7, 9], [-2, -5, -7, -10, 1, 4, 6, 9],
  [-3, -4, -7, -10, 2, 3, 6, 9], [-1, -2, -3, -10, 0, 1, 2, 9], [-4, -6, -8, -9, 3, 5, 7, 8],
  [-3, -5, -7, -9, 2, 4, 6, 8],
]

const clamp8 = n => n < 0 ? 0 : n > 255 ? 255 : n

/**
 * Decode one ETC2 colour block (8 bytes) into 16 RGBA quads (r,g,b,a per pixel, raster order).
 * `out` must hold 64 bytes.
 */
function decodeEtc2ColourBlock(s, o, out) {
  const j0 = (s[o + 6] << 8) | s[o + 7] // index LSBs, consumed LSB-first
  const k0 = (s[o + 4] << 8) | s[o + 5] // index MSBs, consumed LSB-first
  const b3 = s[o + 3]
  const code0 = b3 >> 5, code1 = (b3 >> 2) & 7
  const sub = SUBBLOCK[b3 & 1]
  const r0 = s[o] & 0xf8, g0 = s[o + 1] & 0xf8, bl0 = s[o + 2] & 0xf8
  const dr = ((s[o] << 3) & 0x18) - ((s[o] << 3) & 0x20)
  const dg = ((s[o + 1] << 3) & 0x18) - ((s[o + 1] << 3) & 0x20)
  const db = ((s[o + 2] << 3) & 0x18) - ((s[o + 2] << 3) & 0x20)

  if ((b3 & 2) === 0) { // individual
    const c0 = [(s[o] & 0xf0) | (s[o] >> 4), (s[o + 1] & 0xf0) | (s[o + 1] >> 4), (s[o + 2] & 0xf0) | (s[o + 2] >> 4)]
    const c1 = [(s[o] & 0x0f) | (s[o] << 4) & 0xff, (s[o + 1] & 0x0f) | (s[o + 1] << 4) & 0xff, (s[o + 2] & 0x0f) | (s[o + 2] << 4) & 0xff]
    let j = j0, k = k0
    for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
      const c = sub[i] === 0 ? c0 : c1
      const m = ETC1_MOD[(sub[i] === 0 ? code0 : code1) * 2 + (j & 1)]
      const mm = (k & 1) ? -m : m
      const p = WRITE_ORDER[i] * 4
      out[p] = clamp8(c[0] + mm); out[p + 1] = clamp8(c[1] + mm); out[p + 2] = clamp8(c[2] + mm); out[p + 3] = 255
    }
    return
  }
  // differential family — which flavour depends on which channel leaves [0,255]
  if (r0 + dr < 0 || r0 + dr > 255) { // T mode
    const c0 = [(s[o] << 3 & 0xc0) | (s[o] << 4 & 0x30) | (s[o] >> 1 & 0x0c) | (s[o] & 3),
      (s[o + 1] & 0xf0) | (s[o + 1] >> 4), (s[o + 1] & 0x0f) | ((s[o + 1] << 4) & 0xf0)]
    const c1 = [(s[o + 2] & 0xf0) | (s[o + 2] >> 4), (s[o + 2] & 0x0f) | ((s[o + 2] << 4) & 0xf0),
      (b3 & 0xf0) | (b3 >> 4)]
    const d = ETC2_DISTANCE[((b3 >> 1) & 6) | (b3 & 1)]
    let j = j0, k = k0 << 1
    for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
      const idx = (k & 2) | (j & 1)
      let r, g, b
      if (idx === 0) { r = c0[0]; g = c0[1]; b = c0[2] }
      else if (idx === 2) { r = c1[0]; g = c1[1]; b = c1[2] }
      else { const m = idx === 1 ? d : -d; r = clamp8(c1[0] + m); g = clamp8(c1[1] + m); b = clamp8(c1[2] + m) }
      const p = WRITE_ORDER[i] * 4
      out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255
    }
    return
  }
  if (g0 + dg < 0 || g0 + dg > 255) { // H mode
    const c0 = [(s[o] << 1 & 0xf0) | (s[o] >> 3 & 0x0f), 0, 0]
    c0[1] = ((s[o] << 5 & 0xe0) | (s[o + 1] & 0x10)) & 0xff
    c0[1] |= c0[1] >> 4
    c0[2] = ((s[o + 1] & 8) | (s[o + 1] << 1 & 6) | (s[o + 2] >> 7)) & 0xff
    c0[2] |= c0[2] << 4
    const c1 = [(s[o + 2] << 1 & 0xf0) | (s[o + 2] >> 3 & 0x0f), 0, 0]
    c1[1] = ((s[o + 2] << 5 & 0xe0) | (s[o + 3] >> 3 & 0x10)) & 0xff
    c1[1] |= c1[1] >> 4
    c1[2] = ((s[o + 3] << 1 & 0xf0) | (s[o + 3] >> 3 & 0x0f)) & 0xff
    let di = (b3 & 4) | (b3 << 1 & 2)
    if (c0[0] > c1[0] || (c0[0] === c1[0] && (c0[1] > c1[1] || (c0[1] === c1[1] && c0[2] >= c1[2])))) di++
    const d = ETC2_DISTANCE[di]
    let j = j0, k = k0 << 1
    for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
      const idx = (k & 2) | (j & 1)
      const c = idx < 2 ? c0 : c1
      const m = (idx & 1) === 0 ? d : -d
      const p = WRITE_ORDER[i] * 4
      out[p] = clamp8(c[0] + m); out[p + 1] = clamp8(c[1] + m); out[p + 2] = clamp8(c[2] + m); out[p + 3] = 255
    }
    return
  }
  if (bl0 + db < 0 || bl0 + db > 255) { // planar
    const c0 = [
      ((s[o] << 1 & 0xfc) | (s[o] >> 5 & 3)) & 0xff,
      (((s[o] << 7 & 0x80) | (s[o + 1] & 0x7e) | (s[o] & 1))) & 0xff,
      0,
    ]
    c0[2] = ((s[o + 1] << 7 & 0x80) | (s[o + 2] << 2 & 0x60) | (s[o + 2] << 3 & 0x18) | (s[o + 3] >> 5 & 4)) & 0xff
    c0[2] |= c0[2] >> 6
    const c1 = [
      ((s[o + 3] << 1 & 0xf8) | (s[o + 3] << 2 & 4) | (s[o + 3] >> 5 & 3)) & 0xff,
      ((s[o + 4] & 0xfe) | (s[o + 4] >> 7)) & 0xff,
      0,
    ]
    c1[2] = ((s[o + 4] << 7 & 0x80) | (s[o + 5] >> 1 & 0x7c)) & 0xff
    c1[2] |= c1[2] >> 6
    const c2 = [
      ((s[o + 5] << 5 & 0xe0) | (s[o + 6] >> 3 & 0x1c) | (s[o + 5] >> 1 & 3)) & 0xff,
      ((s[o + 6] << 3 & 0xf8) | (s[o + 7] >> 5 & 6) | (s[o + 6] >> 4 & 1)) & 0xff,
      (((s[o + 7] << 2) | (s[o + 7] >> 4 & 3))) & 0xff,
    ]
    for (let y = 0, i = 0; y < 4; y++) for (let x = 0; x < 4; x++, i++) {
      const p = i * 4
      out[p] = clamp8((x * (c1[0] - c0[0]) + y * (c2[0] - c0[0]) + 4 * c0[0] + 2) >> 2)
      out[p + 1] = clamp8((x * (c1[1] - c0[1]) + y * (c2[1] - c0[1]) + 4 * c0[1] + 2) >> 2)
      out[p + 2] = clamp8((x * (c1[2] - c0[2]) + y * (c2[2] - c0[2]) + 4 * c0[2] + 2) >> 2)
      out[p + 3] = 255
    }
    return
  }
  // plain differential
  const c0 = [r0 | r0 >> 5, g0 | g0 >> 5, bl0 | bl0 >> 5]
  const rr = r0 + dr, gg = g0 + dg, bb = bl0 + db
  const c1 = [rr | rr >> 5, gg | gg >> 5, bb | bb >> 5]
  let j = j0, k = k0
  for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
    const c = sub[i] === 0 ? c0 : c1
    const m = ETC1_MOD[(sub[i] === 0 ? code0 : code1) * 2 + (j & 1)]
    const mm = (k & 1) ? -m : m
    const p = WRITE_ORDER[i] * 4
    out[p] = clamp8(c[0] + mm); out[p + 1] = clamp8(c[1] + mm); out[p + 2] = clamp8(c[2] + mm); out[p + 3] = 255
  }
}

/**
 * Read the 3-bit EAC index group `g` (0..15) out of the block's big-endian 64-bit value,
 * where group 0 is the *least* significant 3 bits (i.e. the low bits of byte 7) and groups
 * are consumed upwards.
 */
function eacGroup(s, o, g) {
  const bit = 3 * g
  const bi = 7 - (bit >> 3) // block byte holding the group's first bit
  const sh = bit & 7
  let v = s[o + bi] >>> sh
  if (sh > 5) v |= s[o + bi - 1] << (8 - sh) // group straddles two bytes
  return v & 7
}

/** Decode one EAC alpha block (8 bytes) into 16 alpha bytes (raster order). */
function decodeEacAlphaBlock(s, o, out) {
  let multiplier = (s[o + 1] >> 1) & 0x78
  if (multiplier === 0) multiplier = 1
  const table = EAC_MOD[s[o + 1] & 0x0f]
  const base = s[o]
  for (let i = 0; i < 16; i++) {
    const val = base * 8 + multiplier * table[eacGroup(s, o, i)] + 4
    out[WRITE_ORDER_REV[i]] = val < 0 ? 0 : val >= 2048 ? 255 : val >> 3
  }
}

/**
 * Decode an ETC2_RGBA8_EAC payload (16 bytes per 4x4 block) to RGBA8.
 *
 * @param {number} width   mip width in pixels
 * @param {number} height  mip height in pixels
 * @param {Uint8Array} src payload
 * @returns {Uint8Array} width*height*4 bytes
 */
export function decodeEtc2Rgba8(width, height, src) {
  const w = width | 0, h = height | 0
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4)
  const need = bw * bh * 16
  if (src.length < need) throw new RangeError(`decodeEtc2Rgba8: needs ${need} bytes for ${w}x${h}, got ${src.length}`)
  const out = new Uint8Array(w * h * 4)
  const block = new Uint8Array(64)
  const alpha = new Uint8Array(16)
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * 16
    decodeEtc2ColourBlock(src, o + 8, block)
    decodeEacAlphaBlock(src, o, alpha)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = bx * 4 + x, py = by * 4 + y
      if (px >= w || py >= h) continue
      const q = (py * w + px) * 4, s = (y * 4 + x) * 4
      out[q] = block[s]; out[q + 1] = block[s + 1]; out[q + 2] = block[s + 2]
      out[q + 3] = alpha[y * 4 + x]
    }
  }
  return out
}

/** Payload size in bytes for an ETC2_RGBA8_EAC mip. */
export function etc2Rgba8Size(width, height) {
  return Math.ceil((width | 0) / 4) * Math.ceil((height | 0) / 4) * 16
}

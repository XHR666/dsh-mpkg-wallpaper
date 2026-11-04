// format.js — Wallpaper Engine binary-format constants (PKG family, TEX family, pixel formats).
//
// Independent implementation. Format numbers and magic strings are public, factual format
// knowledge (see PROVENANCE.md §2 for the written spec sources). No code was copied from
// any implementation; this file only names constants and does no I/O.

/** Container magics of the PKG family. `PKGV####` = scene package, `PKGM####` = .mpkg bundle. */
export const PKG_MAGIC_RE = /^PKG[VM]\d{4}$/
/** Narrower magic of plain scene packages (`PKGV####`). */
export const SCENE_PKG_MAGIC_RE = /^PKGV\d{4}$/

/** `TEXV` file magic (version 5 is the only version seen in the corpus). */
export const TEX_MAGIC = 'TEXV0005'
/** `TEXI` image-info sub-container magic. */
export const TEX_IMAGE_MAGIC = 'TEXI0001'
/** `TEXB` image-data sub-container magic (container version = last digit, 1..4). */
export const TEX_CONTAINER_MAGIC_RE = /^TEXB000([1-4])$/
/** `TEXS` sprite / GIF-tile trailer magic. */
export const TEX_SPRITE_MAGIC_RE = /^TEXS000\d$/
/** `TEXB` versions this module understands. */
export const TEX_CONTAINER_VERSIONS = [1, 2, 3, 4]

/** `flags` bit that marks a texture whose payload is a video container (MP4). */
export const TEX_FLAG_IS_VIDEO = 0x20

/**
 * `freeImageFormat` values (embedded-image / media format of a mip payload).
 * `-1` = raw pixel data in the container's own `format`.
 */
export const FIF = {
  UNKNOWN: -1,
  JPEG: 2,
  PNG: 13,
  GIF: 25,
  MP4: 35,
}

/**
 * Pixel formats of the TEX container (format id -> name).
 * Names are the ones the ecosystem uses; ids come from the container header.
 */
export const TEXTURE_FORMATS = {
  0: 'ARGB8888',
  1: 'RGB888',
  2: 'RGB565',
  4: 'DXT5',
  5: 'ETC2_RGBA8_EAC（半分辨率，Android 管线）',
  6: 'DXT3',
  7: 'DXT1',
  8: 'RG88',
  9: 'R8',
  10: 'RG1616f',
  11: 'R16f',
  12: 'BC7',
  13: 'RGBa1010102',
  14: 'RGBA16161616f',
  15: 'RGB161616f',
}

/** Bytes per pixel for the uncompressed formats, or 0 for block-compressed formats. */
export const BYTES_PER_PIXEL = {
  0: 4, // ARGB8888 / RGBA byte order, 4 B/px
  1: 3, // RGB888
  2: 2, // RGB565
  8: 2, // RG88
  9: 1, // R8
}

/** Block size in bytes for the block-compressed formats this module can decode. */
export const BLOCK_BYTES = {
  4: 16, // DXT5 / BC3
  5: 16, // ETC2_RGBA8_EAC (EAC alpha + ETC2 colour), stored at half the declared size
  6: 16, // DXT3 / BC2
  7: 8, // DXT1 / BC1
}

/**
 * Human-readable name of a pixel format. Unknown ids are stringified, matching the
 * reference renderer's observable behaviour (`formatName` is `String(format)` when unknown).
 */
export function texFormatName(format) {
  const name = TEXTURE_FORMATS[format]
  return name === undefined ? String(format) : name
}

/** `true` when a TEX `flags`/`freeImageFormat` pair denotes a video (MP4) texture. */
export function isVideoTex(flags, freeImageFormat) {
  return ((flags | 0) & TEX_FLAG_IS_VIDEO) !== 0 || (freeImageFormat | 0) === FIF.MP4
}

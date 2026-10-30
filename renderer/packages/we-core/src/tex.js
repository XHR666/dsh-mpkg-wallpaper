// tex.js — TEX container reader (header, image/mip descriptors, LZ4 mip payloads, TEXS
// sprite trailer). Independent implementation from the written container spec plus
// byte-level confirmation against real corpus files (see PROVENANCE.md §3).
//
// Layout (offsets are absolute inside the entry; all integers little-endian):
//
//   0   "TEXV0005" + NUL                 file magic
//   9   "TEXI0001" + NUL                 image-info sub-container
//   18  int32 format                     pixel format id (see format.js TEXTURE_FORMATS)
//   22  int32 flags                      bit 0x20 = video payload
//   26  int32 textureWidth               texture storage size
//   30  int32 textureHeight
//   34  int32 width                      declared (display) width
//   38  int32 height                     declared (display) height
//   42  int32 reserved
//   46  "TEXB000x" + NUL                 image-data sub-container, x = layout version 1..4
//   55  int32 imageCount
//       per image:
//         [x >= 3] int32 freeImageFormat   (FIF; -1 = raw pixels in `format`)
//         [x >= 4] int32 reserved2         (0 in every observed file)
//         int32 mipCount
//         per mip:
//           [x >= 2] int32 width, height, compression, uncompressedSize, dataSize
//           [x == 1] int32 width, height, dataSize
//           bytes payload                  (LZ4 block when compression === 1, else raw)
//   optional trailer: "TEXS000y" + NUL, int32 frameCount, int32 gifWidth, int32 gifHeight,
//                     frameCount × { int32 imageId, float32 frametime, float32 x, float32 y,
//                                    float32 xAxis[2], float32 yAxis[2] }
//
// `containerVersion` mirrors the reference renderer's observable mapping: a `TEXB0004`
// container counts as version 3 unless `freeImageFormat === MP4(35)`, while the *layout*
// always follows the version digit in the magic.
//
// Caveat (see PROVENANCE.md §4): containers whose `freeImageFormat` is MP4(35) never occur
// in the workspace corpus (646 TEX entries scanned; only -1 / 2 / 13 appear). They are
// parsed here with the standard descriptor layout; the reference renderer's offset for that
// legacy case was observed to differ and is not reproduced.

import { FIF, TEXTURE_FORMATS, TEX_FLAG_IS_VIDEO, TEX_MAGIC, TEX_IMAGE_MAGIC, TEX_CONTAINER_MAGIC_RE, TEX_SPRITE_MAGIC_RE, isVideoTex, texFormatName } from './format.js'
import { toBytes } from './lz4.js'
import { lz4Decompress } from './lz4.js'

const MAX_IMAGES = 1024
const MAX_MIPS = 64
const HEADER_END = 55 // first byte after the "TEXB000x\0" magic

/** Header (TEXI) fields only. `containerMagic` is the 8-character TEXB magic, or `null`. */
export function parseTexHeader(data) {
  const bytes = toBytes(data)
  if (bytes.length < HEADER_END) throw new RangeError('parseTex: data too small for a TEX header')
  if (str(bytes, 0, 8) !== TEX_MAGIC) throw new TypeError(`parseTex: not a ${TEX_MAGIC} container (got "${str(bytes, 0, 8)}")`)
  if (str(bytes, 9, 8) !== TEX_IMAGE_MAGIC) throw new TypeError(`parseTex: unsupported image sub-container "${str(bytes, 9, 8)}"`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const format = view.getInt32(18, true)
  const flags = view.getInt32(22, true)
  const textureWidth = view.getInt32(26, true)
  const textureHeight = view.getInt32(30, true)
  const width = view.getInt32(34, true)
  const height = view.getInt32(38, true)
  const containerMagic = str(bytes, 46, 8)
  const m = TEX_CONTAINER_MAGIC_RE.exec(containerMagic)
  if (!m) throw new TypeError(`parseTex: unsupported image container "${containerMagic}"`)
  return {
    format,
    formatName: texFormatName(format),
    flags,
    textureWidth,
    textureHeight,
    width,
    height,
    reserved: view.getInt32(42, true),
    containerMagic,
    layoutVersion: Number(m[1]),
  }
}

/**
 * Parse a full TEX entry, decoding every mip payload (LZ4 when `compression === 1`).
 *
 * @param {Uint8Array|ArrayBuffer|DataView} data
 * @returns {{format:number, formatName:string, flags:number, textureWidth:number,
 *            textureHeight:number, width:number, height:number, freeImageFormat:number,
 *            containerMagic:string, containerVersion:number, isVideo:boolean,
 *            images:Array<Array<{width:number,height:number,compression:number,
 *                                 uncompressedSize:number,data:Uint8Array}>>,
 *            sprite:null|{magic:string,frameCount:number,gifWidth:number,gifHeight:number,
 *                          frames:Array<{imageId:number,frametime:number,x:number,y:number,
 *                                        xAxis:number[],yAxis:number[]}>}}}
 */
export function parseTex(data) {
  const bytes = toBytes(data)
  const head = parseTexHeader(bytes)
  const version = head.layoutVersion
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = HEADER_END
  let freeImageFormat = FIF.UNKNOWN
  const images = []

  const imageCount = view.getInt32(pos, true)
  pos += 4
  if (imageCount < 0 || imageCount > MAX_IMAGES) throw new RangeError(`parseTex: implausible image count ${imageCount}`)
  for (let image = 0; image < imageCount; image++) {
    if (version >= 3) {
      const fif = view.getInt32(pos, true)
      // The container reports one freeImageFormat for all images; the reference renderer
      // keeps the **first** image's value (black-box verified with a 2-image container).
      if (image === 0) freeImageFormat = fif
      pos += 4
    }
    if (version >= 4) pos += 4 // reserved2
    const mipCount = view.getInt32(pos, true)
    pos += 4
    if (mipCount < 0 || mipCount > MAX_MIPS) throw new RangeError(`parseTex: implausible mip count ${mipCount} in image ${image}`)
    const mips = []
    for (let mip = 0; mip < mipCount; mip++) {
      const descriptorBytes = version >= 2 ? 20 : 12
      if (pos + descriptorBytes > bytes.length) throw new RangeError(`parseTex: truncated mip descriptor ${image}/${mip}`)
      const mipWidth = view.getInt32(pos, true)
      const mipHeight = view.getInt32(pos + 4, true)
      const compression = version >= 2 ? view.getInt32(pos + 8, true) : 0
      const uncompressedSize = version >= 2 ? view.getInt32(pos + 12, true) : 0
      const dataSize = view.getInt32(pos + (version >= 2 ? 16 : 8), true)
      pos += descriptorBytes
      if (dataSize < 0 || pos + dataSize > bytes.length) {
        throw new RangeError(`parseTex: mip ${image}/${mip} declares ${dataSize} bytes but only ${bytes.length - pos} remain`)
      }
      const raw = bytes.subarray(pos, pos + dataSize)
      pos += dataSize
      const payload = compression === 1 ? lz4Decompress(raw, Math.max(0, uncompressedSize)) : raw
      mips.push({
        width: mipWidth,
        height: mipHeight,
        compression,
        uncompressedSize,
        dataSize,
        data: payload,
      })
    }
    images.push(mips)
  }

  const rest = bytes.subarray(pos)
  const sprite = TEX_SPRITE_MAGIC_RE.test(str(rest, 0, 8)) ? parseSprite(rest) : null
  const isVideo = isVideoTex(head.flags, freeImageFormat)

  return {
    format: head.format,
    formatName: TEXTURE_FORMATS[head.format] === undefined ? String(head.format) : texFormatName(head.format),
    flags: head.flags,
    textureWidth: head.textureWidth,
    textureHeight: head.textureHeight,
    width: head.width,
    height: head.height,
    freeImageFormat,
    containerMagic: head.containerMagic + '\0',
    containerVersion: version === 4 && freeImageFormat !== FIF.MP4 ? 3 : version,
    isVideo,
    images,
    sprite,
  }
}

/** First mip of the first image (`null` when the container stores no image). */
export function firstMipmap(data) {
  const tex = parseTex(data)
  return tex.images.length && tex.images[0].length ? tex.images[0][0] : null
}

/** `freeImageFormat` without materialising the mips. */
export function freeImageFormatOf(data) {
  const bytes = toBytes(data)
  const head = parseTexHeader(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = HEADER_END
  const imageCount = view.getInt32(pos, true)
  pos += 4
  if (imageCount <= 0 || head.layoutVersion < 3) return FIF.UNKNOWN
  return view.getInt32(pos, true)
}

/** Parse a `TEXS` sprite trailer (GIF tile table). */
export function parseSprite(data) {
  const bytes = toBytes(data)
  const magic = str(bytes, 0, 8)
  if (!TEX_SPRITE_MAGIC_RE.test(magic)) throw new TypeError(`parseSprite: not a TEXS trailer (got "${magic}")`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frameCount = view.getInt32(9, true)
  const gifWidth = view.getInt32(13, true)
  const gifHeight = view.getInt32(17, true)
  if (frameCount < 0 || 21 + frameCount * 32 > bytes.length) throw new RangeError(`parseSprite: implausible frame count ${frameCount}`)
  const frames = []
  for (let i = 0; i < frameCount; i++) {
    const o = 21 + i * 32
    frames.push({
      imageId: view.getInt32(o, true),
      frametime: view.getFloat32(o + 4, true),
      x: view.getFloat32(o + 8, true),
      y: view.getFloat32(o + 12, true),
      xAxis: [view.getFloat32(o + 16, true), view.getFloat32(o + 20, true)],
      yAxis: [view.getFloat32(o + 24, true), view.getFloat32(o + 28, true)],
    })
  }
  return { magic: magic + '\0', gifWidth, gifHeight, frames }
}

/** Flags-only convenience (mirrors `format.js TEX_FLAG_IS_VIDEO`). */
export function isVideoFlags(flags) {
  return ((flags | 0) & TEX_FLAG_IS_VIDEO) !== 0
}

function str(bytes, start, length) {
  if (start + length > bytes.length) return ''
  let s = ''
  for (let i = 0; i < length; i++) {
    const c = bytes[start + i]
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

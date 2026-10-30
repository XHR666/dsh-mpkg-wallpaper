// @xferoni66/we-core — Wallpaper Engine binary-format core.
//
// Layer boundary (see README.md §Scope): this package reads *files* and does *math*.
// It never renders: no WebGL/GL calls, no shaders, no DOM/window, no canvas, no wallpaper
// semantics (layers, cameras, properties, effects, audio/video routing) — those stay in the
// consuming projects.

export {
  PKG_MAGIC_RE,
  SCENE_PKG_MAGIC_RE,
  TEX_MAGIC,
  TEX_IMAGE_MAGIC,
  TEX_CONTAINER_MAGIC_RE,
  TEX_SPRITE_MAGIC_RE,
  TEX_CONTAINER_VERSIONS,
  TEX_FLAG_IS_VIDEO,
  FIF,
  TEXTURE_FORMATS,
  BYTES_PER_PIXEL,
  BLOCK_BYTES,
  texFormatName,
  isVideoTex,
} from './format.js'

export { parsePkg, readPkgEntry, findEntry, hasEntry, getEntry, entryNames } from './pkg.js'
export { parseTex, parseTexHeader, parseSprite, firstMipmap, freeImageFormatOf, isVideoFlags } from './tex.js'
export { decodePixels, expectedPayloadSize, payloadSizeMatches, DECODABLE_FORMATS } from './pixels.js'
export { decodeEtc2Rgba8, etc2Rgba8Size } from './etc2.js'
export { lz4Decompress, toBytes } from './lz4.js'
export {
  mat4Identity,
  mat4Multiply,
  mat4Translate,
  mat4Scale,
  mat4RotateZ,
  mat4Ortho,
  mat4Perspective,
  mat4LookAt,
  mat4TransformPoint,
  bindInvTimesM,
} from './mat4.js'

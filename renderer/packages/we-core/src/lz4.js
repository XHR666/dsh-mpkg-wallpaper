// lz4.js — LZ4 *block* decompression (public block-format description: token byte with
// 4-bit literal/match length nibbles, 15 = extended length, 2-byte little-endian match
// offset, overlapping match copy). Independent implementation.
//
// Scope: the raw block codec only — no frame format, no checksums, no dictionary, no
// compression. Callers always know the decompressed size (the TEX mip descriptor carries
// it), which is why the output length must be supplied.

/**
 * Decompress one LZ4 block.
 *
 * @param {Uint8Array|ArrayBuffer|DataView} src  raw block bytes
 * @param {number} dstSize                       expected decompressed size (>= 0)
 * @returns {Uint8Array} exactly `dstSize` bytes (zero-filled tail when the block ends early)
 */
export function lz4Decompress(src, dstSize) {
  const input = toBytes(src)
  const size = dstSize | 0
  if (size < 0) throw new RangeError('lz4Decompress: dstSize must be >= 0')
  const out = new Uint8Array(size)
  let ip = 0
  let op = 0
  while (ip < input.length) {
    const token = input[ip++]
    // ---- literals ----
    let literalLength = token >>> 4
    if (literalLength === 15) {
      let extra = 255
      while (extra === 255) {
        if (ip >= input.length) throw new RangeError('lz4Decompress: truncated literal length')
        extra = input[ip++]
        literalLength += extra
      }
    }
    if (literalLength > 0) {
      if (ip + literalLength > input.length) throw new RangeError('lz4Decompress: truncated literals')
      if (op + literalLength > size) throw new RangeError('lz4Decompress: output overflow (literals)')
      out.set(input.subarray(ip, ip + literalLength), op)
      ip += literalLength
      op += literalLength
    }
    if (ip >= input.length) break // last sequence: literals only
    // ---- match ----
    if (ip + 2 > input.length) throw new RangeError('lz4Decompress: truncated match offset')
    const offset = input[ip] | (input[ip + 1] << 8)
    ip += 2
    if (offset === 0) throw new RangeError('lz4Decompress: zero match offset')
    if (offset > op) throw new RangeError('lz4Decompress: match offset before output start')
    let matchLength = token & 0x0f
    if (matchLength === 15) {
      let extra = 255
      while (extra === 255) {
        if (ip >= input.length) throw new RangeError('lz4Decompress: truncated match length')
        extra = input[ip++]
        matchLength += extra
      }
    }
    matchLength += 4
    if (op + matchLength > size) throw new RangeError('lz4Decompress: output overflow (match)')
    let match = op - offset
    for (let i = 0; i < matchLength; i++) out[op++] = out[match++]
  }
  return out
}

/** View any binary input as bytes without copying. */
export function toBytes(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new TypeError('expected Uint8Array / ArrayBuffer / DataView')
}

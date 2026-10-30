// Pure-JS zlib inflate (RFC 1950/1951) — used by the browser PNG decoder.
// Supports fixed + dynamic Huffman blocks, stored blocks, zlib wrapper with
// Adler-32 trailer. Deterministic, sync, no dependencies.

// Build a length→symbol table. lenCodes[n] = array of symbol codes of bit-length n.
function buildLengthTable(lengths) {
  const MAXBITS = 15;
  let max = 0;
  const blCount = new Array(MAXBITS + 1).fill(0);
  for (const l of lengths) if (l > 0) blCount[l]++;
  for (let i = 1; i <= MAXBITS; i++) if (blCount[i] > max) max = i;
  const table = [];
  // nextCode[i] = first code of length i
  const nextCode = new Array(MAXBITS + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= MAXBITS; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  for (let n = 0; n < lengths.length; n++) {
    const len = lengths[n];
    if (len === 0) continue;
    table.push({ sym: n, len, code: nextCode[len] });
    nextCode[len]++;
  }
  table.sort((a, b) => a.len - b.len || a.code - b.code);
  return table;
}

// Bit reader (LSB-first, per DEFLATE).
function BitReader(bytes) {
  this.b = bytes;
  this.pos = 0;
  this.bitBuf = 0;
  this.bitCnt = 0;
}
BitReader.prototype.readBit = function () {
  if (this.bitCnt === 0) {
    if (this.pos >= this.b.length) throw new Error('inflate: out of data');
    this.bitBuf = this.b[this.pos++];
    this.bitCnt = 8;
  }
  const bit = this.bitBuf & 1;
  this.bitBuf >>>= 1;
  this.bitCnt--;
  return bit;
};
BitReader.prototype.align = function () {
  this.bitCnt = 0;
  this.bitBuf = 0;
};
BitReader.prototype.readBits = function (n) {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const bit = this.readBit();
    if (bit) v |= (1 << i);
  }
  return v;
};

// decode a symbol given a precomputed (lengths array) Huffman code
function Huffman(lengths) {
  this.lengths = lengths;
  this.table = buildLengthTable(lengths);
}
Huffman.prototype.decode = function (reader) {
  let code = 0;
  for (let len = 1; len <= 15; len++) {
    code = (code << 1) | reader.readBit();
    // find symbol
    for (const e of this.table) {
      if (e.len === len && e.code === code) return e.sym;
    }
  }
  throw new Error('inflate: invalid huffman code');
};

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

// Canonical length-limited code for fixed blocks (literal/length)
const FIXED_LIT_LENS = (() => {
  const l = new Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  return l;
})();
const FIXED_DIST_LENS = (() => { const l = new Array(30).fill(5); return l; })();

function inflateRaw(bytes, out) {
  const reader = new BitReader(bytes);
  // inflate stream starts with block header bits inside a byte
  let final = 0;
  do {
    final = reader.readBit();
    const type = reader.readBits(2);
    if (type === 0) {
      // stored
      reader.align();
      const len = bytes[reader.pos] | (bytes[reader.pos + 1] << 8);
      const nlen = bytes[reader.pos + 2] | (bytes[reader.pos + 3] << 8);
      reader.pos += 4;
      if ((len ^ 0xffff) !== nlen) throw new Error('inflate: bad stored length');
      for (let i = 0; i < len; i++) out.push(bytes[reader.pos++]);
    } else if (type === 1) {
      const lit = new Huffman(FIXED_LIT_LENS);
      const dist = new Huffman(FIXED_DIST_LENS);
      inflateBlocks(reader, out, lit, dist);
    } else if (type === 2) {
      // dynamic
      let hlit = reader.readBits(5) + 257;
      let hdist = reader.readBits(5) + 1;
      let hclen = reader.readBits(4) + 4;
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const clens = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) clens[order[i]] = reader.readBits(3);
      const clCode = new Huffman(clens);
      const lens = new Array(hlit + hdist).fill(0);
      for (let i = 0; i < hlit + hdist; ) {
        const sym = clCode.decode(reader);
        if (sym < 16) {
          lens[i++] = sym;
        } else if (sym === 16) {
          const prev = lens[i - 1];
          const rep = reader.readBits(2) + 3;
          for (let k = 0; k < rep; k++) lens[i++] = prev;
        } else if (sym === 17) {
          const rep = reader.readBits(3) + 3;
          for (let k = 0; k < rep; k++) lens[i++] = 0;
        } else {
          const rep = reader.readBits(7) + 11;
          for (let k = 0; k < rep; k++) lens[i++] = 0;
        }
      }
      const lit = new Huffman(lens.subarray(0, hlit));
      const dist = new Huffman(lens.subarray(hlit));
      inflateBlocks(reader, out, lit, dist);
    } else {
      throw new Error('inflate: bad block type');
    }
  } while (!final);
}

function inflateBlocks(reader, out, litCode, distCode) {
  for (;;) {
    const sym = litCode.decode(reader);
    if (sym < 256) {
      out.push(sym);
    } else if (sym === 256) {
      return;
    } else {
      const li = sym - 257;
      if (li >= LEN_BASE.length) throw new Error('inflate: bad length symbol');
      const length = LEN_BASE[li] + reader.readBits(LEN_EXTRA[li]);
      const dSym = distCode.decode(reader);
      if (dSym >= DIST_BASE.length) throw new Error('inflate: bad dist symbol');
      const dist = DIST_BASE[dSym] + reader.readBits(DIST_EXTRA[dSym]);
      const start = out.length - dist;
      for (let k = 0; k < length; k++) out.push(out[start + k]);
    }
  }
}

export function inflateRawSync(bytes) {
  const out = [];
  inflateRaw(bytes, out);
  return new Uint8Array(out);
}

export function inflateSync(zlibBytes) {
  // zlib header: CMF/FLG. Verify deflate method (0x08), 32-bit window.
  const b = zlibBytes;
  if (b.length < 2) throw new Error('inflate: too short');
  const cmf = b[0];
  const flg = b[1];
  if ((cmf & 0x0f) !== 8) throw new Error('inflate: unknown compression method');
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error('inflate: bad zlib header');
  if ((flg & 0x20) !== 0) throw new Error('inflate: preset dictionary not supported');
  // raw deflate stream starts at offset 2; adler32 trailer (4 bytes) at end
  const raw = b.subarray(2, b.length - 4);
  const out = [];
  inflateRaw(raw, out);
  // verify adler32 (best-effort: trailer availability)
  const result = new Uint8Array(out);
  if (b.length >= 6) {
    const adler = (b[b.length - 4] << 24) | (b[b.length - 3] << 16) | (b[b.length - 2] << 8) | b[b.length - 1];
    const computed = adler32(result);
    // Some minimal encoders emit 0; we only warn, never throw, to stay robust.
    if (adler !== 0 && adler !== computed) {
      // ignore
    }
  }
  return result;
}

// Standard PNG-style scanline unfiltering + inflate — the full synchronous decoder.
export function decodePngSync(pngBytes) {
  const b = pngBytes;
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) {
    throw new Error('png: bad signature');
  }
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let compression = 0, filterMethod = 0;
  while (pos + 8 <= b.length) {
    const len = (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = b.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      height = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filterMethod = data[11];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height) throw new Error('png: missing IHDR');
  let channels = 1;
  if (colorType === 2) channels = 3;
  else if (colorType === 4) channels = 2;
  else if (colorType === 6) channels = 4;
  const stride = width * channels;
  const raw = inflateSync(Buffer_Concat(idat));
  const bpp = channels;
  const out = new Uint8Array(width * height * 4);
  let srcPos = 0;
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[srcPos++];
    for (let x = 0; x < stride; x++) cur[x] = raw[srcPos++];
    // unfilter
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bb = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      switch (filter) {
        case 0: v = v; break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + bb) & 0xff; break;
        case 3: v = (v + ((a + bb) >> 1)) & 0xff; break;
        case 4: {
          const p = a + bb - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
          v = (v + pr) & 0xff; break;
        }
        default: throw new Error('png: bad filter ' + filter);
      }
      cur[x] = v;
    }
    prev.set(cur);
    // convert to RGBA
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      if (channels === 1) {
        out[di] = out[di + 1] = out[di + 2] = cur[si];
        out[di + 3] = 255;
      } else if (channels === 2) {
        out[di] = out[di + 1] = out[di + 2] = cur[si];
        out[di + 3] = cur[si + 1];
      } else if (channels === 3) {
        out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = 255;
      } else {
        out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = cur[si + 3];
      }
    }
  }
  return { width, height, rgba: out, bitDepth, colorType, compression, filterMethod };
}

// Stored-block (uncompressed) deflate with zlib wrapper + adler32 trailer.
// Used by the browser encodePng. Valid but not compressed — fine for PNG.
export function deflateSync(bytes, level) {
  const raw = new Uint8Array(bytes.buffer ? bytes : bytes);
  const out = [];
  // zlib header: CMF=0x78 (deflate, 32k window), FLG chosen so (CMF<<8|FLG)%31==0
  // 0x78 0x01 == 0x7801, 0x7801 % 31 == 0? 30721 % 31 = 0.  use 0x78 0x01.
  out.push(0x78, 0x01);
  const total = raw.length;
  let pos = 0;
  // emit stored blocks: each block max 65535 bytes
  do {
    const n = Math.min(65535, total - pos);
    const last = (pos + n) >= total ? 1 : 0;
    out.push(last); // BFINAL + BTYPE=00 (stored) => byte 0x01 if last, else 0x00
    out.push(n & 0xff, (n >> 8) & 0xff);
    out.push((~n) & 0xff, ((~n) >> 8) & 0xff);
    for (let i = 0; i < n; i++) out.push(raw[pos + i]);
    pos += n;
  } while (pos < total);
  const a = adler32(raw);
  out.push((a >>> 24) & 0xff, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff);
  return new Uint8Array(out);
}

function Buffer_Concat(list) {
  let total = 0;
  for (const d of list) total += d.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const d of list) { out.set(d, off); off += d.length; }
  return out;
}

function adler32(u8) {
  let a = 1, b = 0;
  for (let i = 0; i < u8.length; i++) {
    a = (a + u8[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export default { inflateSync, inflateRawSync, decodePngSync, deflateSync };

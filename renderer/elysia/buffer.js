// Browser Buffer polyfill (the tiny subset the elysia CPU renderer uses).
// Special note: this is a *view* over the underlying ArrayBuffer where possible,
// so texture blits avoid an extra copy.
const enc = new TextEncoder();
const dec = new TextDecoder();

function makeView(ab, byteOffset, byteLength) {
  return new Uint8Array(ab, byteOffset, byteLength);
}

class Buffer extends Uint8Array {
  toString(encoding, start, end) {
    const s = start == null ? 0 : start;
    const e = end == null ? this.length : end;
    const sub = this.subarray(s, e);
    if (!encoding || encoding === 'utf8' || encoding === 'utf-8') {
      return new TextDecoder('utf-8', { fatal: false }).decode(sub);
    }
    // 'ascii'/'latin1': byte -> char (latin1 = low 8 bits, ascii is subset)
    let out = '';
    for (let i = 0; i < sub.length; i++) out += String.fromCharCode(sub[i] & 0xff);
    return out;
  }

  subarray(start, end) {
    const s = start == null ? 0 : start;
    const e = end == null ? this.length : end;
    return new Buffer(this.buffer, this.byteOffset + s, e - s);
  }

  slice(start, end) {
    const s = start == null ? 0 : start;
    const e = end == null ? this.length : end;
    return new Buffer(this.buffer, this.byteOffset + s, e - s);
  }

  indexOf(needle, fromIndex) {
    const start = fromIndex == null ? 0 : Math.max(0, fromIndex);
    let n;
    if (typeof needle === 'string') {
      n = Buffer.from(needle, 'latin1');
    } else if (needle instanceof Uint8Array) {
      n = needle;
    } else {
      n = new Uint8Array([needle]);
    }
    const nlen = n.length;
    if (nlen === 0) return start;
    for (let i = start; i + nlen <= this.length; i++) {
      let ok = true;
      for (let j = 0; j < nlen; j++) {
        if (this[i + j] !== n[j]) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }

  readUInt32BE(offset = 0) {
    return ((this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]) >>> 0;
  }
  readUInt32LE(offset = 0) {
    return (this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24)) >>> 0;
  }
  readUInt16LE(offset = 0) {
    return this[offset] | (this[offset + 1] << 8);
  }
  readUInt16BE(offset = 0) {
    return (this[offset] << 8) | this[offset + 1];
  }
  readInt32LE(offset = 0) {
    const v = this.readUInt32LE(offset);
    return v > 0x7fffffff ? v - 0x100000000 : v;
  }
  readFloatLE(offset = 0) {
    const dv = new DataView(this.buffer, this.byteOffset + offset, 4);
    return dv.getFloat32(0, true);
  }
  writeUInt32BE(value, offset = 0) {
    this[offset] = (value >>> 24) & 0xff;
    this[offset + 1] = (value >>> 16) & 0xff;
    this[offset + 2] = (value >>> 8) & 0xff;
    this[offset + 3] = value & 0xff;
    return offset + 4;
  }
  writeUInt32LE(value, offset = 0) {
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    this[offset + 2] = (value >>> 16) & 0xff;
    this[offset + 3] = (value >>> 24) & 0xff;
    return offset + 4;
  }
  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const t = targetStart;
    const src = this.subarray(sourceStart, sourceEnd);
    for (let i = 0; i < src.length; i++) target[t + i] = src[i];
    return src.length;
  }

  static from(a, b, c) {
    if (typeof a === 'string') {
      const encName = (b || 'utf8').toLowerCase();
      if (encName === 'ascii' || encName === 'latin1') {
        const buf = new Buffer(a.length);
        for (let i = 0; i < a.length; i++) buf[i] = a.charCodeAt(i) & 0xff;
        return buf;
      }
      return new Buffer(enc.encode(a));
    }
    if (a instanceof ArrayBuffer) {
      if (b == null) return new Buffer(a);
      // view (no copy) — matches Node Buffer.from(arrayBuffer, off, len)
      return new Buffer(a, b, c);
    }
    if (ArrayBuffer.isView(a)) {
      // View over the same backing store (no copy) — like Node when given a Buffer/Uint8Array view
      return new Buffer(a.buffer, a.byteOffset, a.byteLength);
    }
    if (Array.isArray(a)) return new Buffer(a);
    return new Buffer(a);
  }

  static alloc(size, fill = 0) {
    const buf = new Buffer(size);
    if (fill !== 0) buf.fill(fill);
    return buf;
  }

  static concat(list, totalLength) {
    if (list.length === 0) return new Buffer(0);
    let total = totalLength;
    if (total == null) {
      total = 0;
      for (const b of list) total += b.length;
    }
    const out = new Buffer(total);
    let off = 0;
    for (const b of list) {
      out.set(b, off);
      off += b.length;
    }
    return out;
  }
}

export { Buffer };
export default Buffer;

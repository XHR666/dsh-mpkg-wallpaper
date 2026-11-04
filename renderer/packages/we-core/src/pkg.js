// pkg.js — PKG container (scene `.pkg` / bundle `.mpkg`) reader.
//
// Independent implementation. Entry-table layout was derived from the written spec in
// docs/WE-CORE-PLAN.md §1.3 / docs/FIELD-ANALYSIS.md and confirmed byte-by-byte against
// real corpus files (see PROVENANCE.md §3): the table is self-describing, so
// `dataStart + Σ entry.size === fileSize` holds for every well-formed package.
//
//   int32  magicLength            (8 in every observed file)
//   bytes  magic                  "PKGV0023" / "PKGM0018" / …
//   int32  entryCount
//   repeat entryCount times:
//     int32 nameLength            (bytes, UTF-8, no NUL)
//     bytes name
//     int32 offset                (relative to dataStart)
//     int32 size                  (payload bytes, stored uncompressed)
//   bytes  payloads…              (dataStart + offset)
//
// Deliberately absent: decompression of entry payloads. Every package observed in the
// corpus stores payloads raw (the identity above is exact); the LZ4 codec in this package
// is used for TEX mip payloads. See README.md §Scope.

import { PKG_MAGIC_RE } from './format.js'
import { toBytes } from './lz4.js'

const MAX_ENTRIES = 1 << 20
const MAX_NAME_BYTES = 1 << 16

/**
 * Parse the entry table of a PKG-family container.
 *
 * @param {Uint8Array|ArrayBuffer|DataView} data
 * @returns {{magic: string, version: string, count: number,
 *            entries: Array<{name: string, offset: number, size: number}>,
 *            dataStart: number, fileSize: number, data: Uint8Array}}
 */
export function parsePkg(data) {
  const bytes = toBytes(data)
  const fileSize = bytes.length
  if (fileSize < 12) throw new RangeError('parsePkg: file too small for a PKG header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magicLength = view.getInt32(0, true)
  if (magicLength < 4 || magicLength > 64 || 4 + magicLength + 4 > fileSize) {
    throw new RangeError(`parsePkg: implausible magic length ${magicLength}`)
  }
  const magic = latin1(bytes, 4, magicLength)
  if (!PKG_MAGIC_RE.test(magic)) throw new TypeError(`parsePkg: not a PKG-family container (magic "${magic}")`)
  let pos = 4 + magicLength
  const count = view.getInt32(pos, true)
  pos += 4
  if (count < 0 || count > MAX_ENTRIES) throw new RangeError(`parsePkg: implausible entry count ${count}`)
  const entries = []
  for (let i = 0; i < count; i++) {
    if (pos + 4 > fileSize) throw new RangeError(`parsePkg: truncated entry table at entry ${i}`)
    const nameLength = view.getInt32(pos, true)
    pos += 4
    if (nameLength < 0 || nameLength > MAX_NAME_BYTES || pos + nameLength + 8 > fileSize) {
      throw new RangeError(`parsePkg: implausible name length ${nameLength} at entry ${i}`)
    }
    const name = utf8(bytes, pos, nameLength)
    pos += nameLength
    const offset = view.getInt32(pos, true)
    const size = view.getInt32(pos + 4, true)
    pos += 8
    if (offset < 0 || size < 0 || pos + offset + size > fileSize) {
      throw new RangeError(`parsePkg: entry "${name}" (offset ${offset}, size ${size}) exceeds the file`)
    }
    entries.push({ name, offset, size })
  }
  return { magic, version: magic.slice(4), count, entries, dataStart: pos, fileSize, data: bytes }
}

/** Payload bytes of one entry (a view — no copy). */
export function readPkgEntry(pkg, entry) {
  if (!pkg || !pkg.data) throw new TypeError('readPkgEntry: first argument must be a parsePkg() result')
  if (!entry) throw new TypeError('readPkgEntry: missing entry')
  const start = pkg.dataStart + entry.offset
  return pkg.data.subarray(start, start + entry.size)
}

/** Entry record by exact name, or `null`. */
export function findEntry(pkg, name) {
  if (!pkg || !Array.isArray(pkg.entries)) throw new TypeError('findEntry: first argument must be a parsePkg() result')
  for (const entry of pkg.entries) if (entry.name === name) return entry
  return null
}

/** `true` when the container holds an entry with that exact name. */
export function hasEntry(pkg, name) {
  return findEntry(pkg, name) !== null
}

/** Payload bytes by entry name; throws when the name is absent. */
export function getEntry(pkg, name) {
  const entry = findEntry(pkg, name)
  if (!entry) throw new Error(`getEntry: no such entry "${name}"`)
  return readPkgEntry(pkg, entry)
}

/** All entry names, in table order. */
export function entryNames(pkg) {
  if (!pkg || !Array.isArray(pkg.entries)) throw new TypeError('entryNames: first argument must be a parsePkg() result')
  return pkg.entries.map((e) => e.name)
}

function latin1(bytes, start, length) {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[start + i])
  return s
}

const utf8Decoder = new TextDecoder('utf-8')
function utf8(bytes, start, length) {
  return utf8Decoder.decode(bytes.subarray(start, start + length))
}

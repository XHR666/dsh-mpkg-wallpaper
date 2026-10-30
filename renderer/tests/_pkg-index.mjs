// _pkg-index.mjs —— 测试用的 **只读** WE 容器目录表读取（`.pkg` / `.mpkg`）
//
// 口径（与 `dsh-mpkg-wallpaper/lib/pkg-extract.js` 的 `parsePkg` 同族，这里是自带的**最小**实现，
// 不 import 另一个仓库）：`sizedString(magic)` + `i32 count` + `count × (sizedString name, i32 off, i32 size)`，
// 条目数据从 `dataStart` 起算。**只解析目录表**；要哪条就按偏移读哪条（测试只取 `scene.json`）。
//
// 为什么单列一个文件：`script-wevector-module-test.mjs` 与 `font-gap-audit-test.mjs` 都要扫语料，
// 复制两份容器解析口径会在下一次格式微调时变成"两个真相"。本文件**不含**任何真包数据、不落盘、
// 不解压纹理（98 个容器实扫 ≈1 s）。
import fs from 'node:fs'
import path from 'node:path'

/** 解析容器目录表。headBytes 不够时抛错（调用方给大一点即可）。 */
export function readIndexHead(file, headBytes = 4 << 20) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(headBytes)
    const n = fs.readSync(fd, buf, 0, headBytes, 0)
    const b = buf.subarray(0, n)
    const mlen = b.readInt32LE(0)
    if (mlen <= 0 || mlen > 32) throw new Error('魔数长度异常 ' + mlen)
    const magic = b.toString('utf8', 4, 4 + mlen)
    let p = 4 + mlen
    const count = b.readInt32LE(p); p += 4
    if (count < 0 || count > 8192) throw new Error('条目数异常 ' + count)
    const entries = []
    for (let i = 0; i < count; i++) {
      const nl = b.readInt32LE(p); p += 4
      if (nl < 0 || nl > 8192 || p + nl + 8 > n) throw new Error('索引超出已读头（需增大 headBytes）')
      const name = b.toString('utf8', p, p + nl); p += nl
      const off = b.readInt32LE(p); p += 4
      const size = b.readInt32LE(p); p += 4
      entries.push({ name, off, size })
    }
    return { magic, count, entries, dataStart: p }
  } finally { fs.closeSync(fd) }
}

/** 按目录表条目读一条的字节。 */
export function readEntryBytes(file, idx, entry) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(entry.size)
    fs.readSync(fd, buf, 0, entry.size, idx.dataStart + entry.off)
    return buf
  } finally { fs.closeSync(fd) }
}

/** 递归收集容器文件（`.pkg` / `.mpkg`）。 */
export function walkContainers(root, out = []) {
  let names = []
  try { names = fs.readdirSync(root) } catch { return out }
  for (const n of names) {
    const p = path.join(root, n)
    let st = null
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walkContainers(p, out)
    else if (/\.(mpkg|pkg)$/i.test(n)) out.push(p)
  }
  return out
}

/** 该容器里的 scene.json 文本（没有则 null）。 */
export function readSceneJsonText(file) {
  const idx = readIndexHead(file)
  const e = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
  if (!e) return null
  return readEntryBytes(file, idx, e).toString('utf8')
}

/** 按绝对偏移读一段字节（`openPkgLazy` 用）。 */
export function readSlice(file, off, len) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, off)
    return buf
  } finally { fs.closeSync(fd) }
}

/**
 * 造一个**惰性 `pkg`**：形状与 `core/we-scene-bundle.js::getEntry` 需要的完全一致，但**不把整包读进内存**。
 *
 * 为什么要有它：真包最大 543MB，而判据只需要 `scene.json` + 少量 JSON/`effect.json`。
 * `getEntry(pkg, name)` 的实现是 `pkg.buf.subarray(start, end).slice()` ⇒ 这里给一个同形状的惰性
 * `buf`，要哪一段才从文件读哪一段。于是判据可以走**生产解析器原文**
 * （`parseScene` / `resolveEffectChain` / `parseWeJson`）而不付整包内存/时间的代价。
 *
 * ⚠ 只实现 `getEntry` 用到的成员（`entries` / `dataStart` / `fileSize` / `buf.subarray(...).slice()`）；
 *   需要整包字节的路径（`parsePkg`、纹理上传）**不要**用这个对象。
 */
export function openPkgLazy(file) {
  const idx = readIndexHead(file)
  return {
    magic: idx.magic,
    count: idx.count,
    entries: idx.entries.map((e) => ({ name: e.name, offset: e.off, size: e.size })),
    dataStart: idx.dataStart,
    fileSize: fs.statSync(file).size,
    buf: { subarray: (s, e) => ({ slice: () => readSlice(file, s, e - s) }) },
  }
}

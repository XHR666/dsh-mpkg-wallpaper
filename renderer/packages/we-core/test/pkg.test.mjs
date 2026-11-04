// pkg.test.mjs — PKG container reader: synthetic round-trips + malformed-input guards +
// structural checks on the real corpus (only when MPW_ROOT points at the workspace).
//
// 说明（中文）：合成包由本测试自己按格式写字节，因而不依赖任何外部实现；真语料检查只断言
// 格式自洽性（表长与文件长度一致、条目都在界内），不 import 宿主仓库的任何代码。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { entryNames, findEntry, getEntry, hasEntry, parsePkg, readPkgEntry } from '../src/pkg.js'

const i32 = (v) => {
  const b = Buffer.alloc(4)
  b.writeInt32LE(v, 0)
  return b
}

/** Build a well-formed PKG container from {name: bytes} pairs. */
export function buildPkg(entries, magic = 'PKGV0023') {
  const parts = [i32(magic.length), Buffer.from(magic, 'latin1'), i32(entries.length)]
  const body = []
  let offset = 0
  for (const [name, payload] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    parts.push(i32(nameBytes.length), nameBytes, i32(offset), i32(payload.length))
    body.push(Buffer.from(payload))
    offset += payload.length
  }
  return Buffer.concat([...parts, ...body])
}

test('合成包：表字段、dataStart、条目视图与查找', () => {
  const payloads = {
    'scene.json': Buffer.from('{"a":1}', 'utf8'),
    'materials/凯尔希.tex': Buffer.from([1, 2, 3, 4, 5]),
    'empty.bin': Buffer.alloc(0),
  }
  const buf = buildPkg(Object.entries(payloads))
  const pkg = parsePkg(buf)
  assert.equal(pkg.magic, 'PKGV0023')
  assert.equal(pkg.version, '0023')
  assert.equal(pkg.count, 3)
  assert.equal(pkg.fileSize, buf.length)
  assert.deepEqual(pkg.entries.map((e) => e.name), Object.keys(payloads))
  assert.equal(pkg.dataStart + pkg.entries.reduce((s, e) => s + e.size, 0), buf.length)
  assert.deepEqual([...getEntry(pkg, 'scene.json')], [...payloads['scene.json']])
  assert.deepEqual([...getEntry(pkg, 'materials/凯尔希.tex')], [1, 2, 3, 4, 5])
  assert.equal(getEntry(pkg, 'empty.bin').length, 0)
  assert.ok(hasEntry(pkg, 'empty.bin'))
  assert.equal(hasEntry(pkg, 'nope'), false)
  assert.equal(findEntry(pkg, 'nope'), null)
  assert.deepEqual(entryNames(pkg), Object.keys(payloads))
  // 视图语义：不清空、不复制 —— 原地读到的就是文件里的字节
  assert.deepEqual([...readPkgEntry(pkg, pkg.entries[1])], [1, 2, 3, 4, 5])
  assert.throws(() => getEntry(pkg, 'nope'), /no such entry/)
})

test('合成包：接受 PKGM（.mpkg 同布局），拒绝陌生魔数', () => {
  const buf = buildPkg([['scene.json', Buffer.from('{}')]], 'PKGM0018')
  const pkg = parsePkg(buf)
  assert.equal(pkg.magic, 'PKGM0018')
  assert.equal(pkg.version, '0018')
  assert.throws(() => parsePkg(buildPkg([['a', Buffer.from([0])]], 'XXXX0001')), /not a PKG-family/)
  assert.throws(() => parsePkg(Buffer.alloc(4)), /too small/)
})

test('畸形输入：截断表 / 越界条目 / 荒谬计数都抛错，不分配巨量内存', () => {
  const good = buildPkg([['a.bin', Buffer.from([1, 2, 3])], ['b.bin', Buffer.from([4])]])
  assert.throws(() => parsePkg(good.subarray(0, good.length - 5)), /truncated|exceeds|implausible/)
  assert.throws(() => parsePkg(good.subarray(0, 10)), /magic length|truncated|too small/)
  // 条目 offset 越界：'a.bin' 条目的 offset 字段（= 表内第 16+4+5 字节）
  const badOffset = Buffer.from(good)
  badOffset.writeInt32LE(1 << 28, 16 + 4 + 5)
  assert.throws(() => parsePkg(badOffset), /exceeds the file/)
  // 条目 size 越界：'b.bin'（最后一条）的 size 字段 = 表尾前 4 字节
  const tableEnd = 4 + 8 + 4 + (4 + 5 + 8) * 2
  const badSize = Buffer.from(good)
  badSize.writeInt32LE(1 << 28, tableEnd - 4)
  assert.throws(() => parsePkg(badSize), /exceeds the file/)
  // 荒谬 entryCount：魔数之后的 int32 改成 2^30
  const huge = Buffer.from(good)
  huge.writeInt32LE(1 << 30, 12)
  assert.throws(() => parsePkg(huge), /implausible entry count/)
})

test('真语料（可选）：表长与文件长度一致，条目全部在界内', (t) => {
  const ws = process.env.MPW_ROOT
  if (!ws) return t.skip('未设 MPW_ROOT（真语料检查按仓库惯例 SKIP）')
  const files = [
    path.join(ws, 'allwallpaper', 'dd', '3715743282', 'scene.pkg'),
    path.join(ws, 'allwallpaper', '0917', '3250755486', 'scene.pkg'),
  ].filter((f) => fs.existsSync(f))
  if (!files.length) return t.skip('未找到小语料包')
  for (const file of files) {
    const buf = fs.readFileSync(file)
    const pkg = parsePkg(buf)
    assert.match(pkg.magic, /^PKG[VM]\d{4}$/)
    const sum = pkg.entries.reduce((s, e) => s + e.size, 0)
    assert.equal(pkg.dataStart + sum, buf.length, `${file}: dataStart+Σsize 必须等于文件长度`)
    for (const e of pkg.entries) {
      assert.ok(e.offset >= 0 && e.size >= 0 && pkg.dataStart + e.offset + e.size <= buf.length, `${e.name} 越界`)
      assert.equal(getEntry(pkg, e.name).length, e.size)
    }
    assert.ok(pkg.entries.length > 0)
    buf.fill(0)
  }
})

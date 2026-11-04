// tex.test.mjs — TEX container reader: synthetic containers for every layout version,
// LZ4 mip payloads, TEXS sprite trailer, pixel-format decode vectors, malformed-input
// guards, plus geometry self-consistency checks on the real corpus (when MPW_ROOT is set).
//
// 说明（中文）：合成容器由本测试自己写字节（不依赖任何外部实现）；像素解码用**手算的格式
// 向量**（BC1/BC2/BC3 的端点到颜色的算式在注释里写死），不用"跑一遍看结果"当断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { lz4Decompress } from '../src/lz4.js'
import { decodePixels, expectedPayloadSize, payloadSizeMatches } from '../src/pixels.js'
import { firstMipmap, parseSprite, parseTex, parseTexHeader } from '../src/tex.js'
import { parsePkg, getEntry } from '../src/pkg.js'

const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b }
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b }
const magic = (s) => Buffer.from(s + '\0', 'latin1')

/**
 * Build a synthetic TEX container.
 * `images` = [{ fif, mips: [{ width, height, compression, uncompressedSize, data }] }]
 * `sprite` = { frames: [...], gifWidth, gifHeight } | null
 */
export function buildTex({ version = 3, format = 0, flags = 0, textureWidth = 4, textureHeight = 4, width = 4, height = 4, images = [{ fif: -1, mips: [{ width: 4, height: 4, data: Buffer.alloc(16, 7) }] }], sprite = null }) {
  assert.ok(version >= 1 && version <= 4)
  const parts = [Buffer.from('TEXV0005\0TEXI0001\0', 'latin1')]
  parts.push(i32(format), i32(flags), i32(textureWidth), i32(textureHeight), i32(width), i32(height), i32(0))
  parts.push(magic('TEXB000' + version))
  parts.push(i32(images.length))
  for (const image of images) {
    if (version >= 3) parts.push(i32(image.fif ?? -1))
    if (version >= 4) parts.push(i32(0))
    parts.push(i32(image.mips.length))
    for (const mip of image.mips) {
      const data = Buffer.from(mip.data)
      const compression = mip.compression ?? 0
      const uncompressedSize = mip.uncompressedSize ?? 0
      if (version >= 2) parts.push(i32(mip.width), i32(mip.height), i32(compression), i32(uncompressedSize), i32(data.length))
      else parts.push(i32(mip.width), i32(mip.height), i32(data.length))
      parts.push(data)
    }
  }
  if (sprite) {
    parts.push(magic('TEXS0003'), i32(sprite.frames.length), i32(sprite.gifWidth), i32(sprite.gifHeight))
    for (const f of sprite.frames) {
      parts.push(i32(f.imageId), f32(f.frametime), f32(f.x), f32(f.y), f32(f.xAxis[0]), f32(f.xAxis[1]), f32(f.yAxis[0]), f32(f.yAxis[1]))
    }
  }
  return Buffer.concat(parts)
}

/** A well-formed LZ4 block: `literalCount` literals of `value` followed by nothing. */
function lz4Literals(literalCount, value) {
  const out = []
  let remaining = literalCount
  if (remaining < 15) out.push(remaining << 4)
  else {
    out.push(0xf0)
    remaining -= 15
    while (remaining >= 255) { out.push(255); remaining -= 255 }
    out.push(remaining)
  }
  for (let i = 0; i < literalCount; i++) out.push(value)
  return Buffer.from(out)
}

test('布局版本 1/2/3/4：头字段与描述符位置都按版本走', () => {
  for (const version of [1, 2, 3, 4]) {
    const tex = parseTex(buildTex({ version, format: 9, textureWidth: 8, textureHeight: 4, width: 8, height: 4, images: [{ fif: version >= 3 ? -1 : undefined, mips: [{ width: 8, height: 4, data: Buffer.alloc(32, 3) }] }] }))
    assert.equal(tex.format, 9)
    assert.equal(tex.formatName, 'R8')
    assert.equal(tex.textureWidth, 8)
    assert.equal(tex.height, 4)
    assert.equal(tex.images.length, 1)
    assert.equal(tex.images[0].length, 1)
    assert.deepEqual([...tex.images[0][0].data], new Array(32).fill(3))
    // TEXB0004 且 fif 非 MP4 ⇒ 报 3（与参考实现的可观测映射一致）
    assert.equal(tex.containerVersion, version === 4 ? 3 : version)
    assert.equal(tex.containerMagic, 'TEXB000' + version + '\0')
    assert.equal(tex.freeImageFormat, version >= 3 ? -1 : -1)
    assert.equal(tex.isVideo, false)
  }
})

test('多 image / 多 mip：顺序与尺寸保持', () => {
  const tex = parseTex(buildTex({
    version: 4,
    images: [
      { fif: -1, mips: [{ width: 4, height: 4, data: Buffer.alloc(16, 1) }, { width: 2, height: 2, data: Buffer.alloc(4, 2) }] },
      { fif: 13, mips: [{ width: 4, height: 4, data: Buffer.alloc(8, 9) }] },
    ],
  }))
  assert.equal(tex.images.length, 2)
  assert.equal(tex.images[0].length, 2)
  assert.deepEqual(tex.images[0].map((m) => [m.width, m.height]), [[4, 4], [2, 2]])
  assert.deepEqual([...tex.images[0][1].data], [2, 2, 2, 2])
  assert.deepEqual([...tex.images[1][0].data], new Array(8).fill(9))
  // 容器只有**一个** freeImageFormat 字段；多 image 时取**第一个** image 的值
  // （黑盒实测：2-image 容器 fif=[-1,13] ⇒ 参考实现报 -1）
  assert.equal(tex.freeImageFormat, -1)
})

test('flags 0x20 / freeImageFormat 35 ⇒ isVideo（含 TEXB0004 报 4）', () => {
  const byFlags = parseTex(buildTex({ version: 4, flags: 0x22, images: [{ fif: -1, mips: [{ width: 4, height: 4, data: Buffer.alloc(16) }] }] }))
  assert.equal(byFlags.isVideo, true)
  assert.equal(byFlags.containerVersion, 3)
  const byFif = parseTex(buildTex({ version: 4, images: [{ fif: 35, mips: [{ width: 4, height: 4, data: Buffer.alloc(16) }] }] }))
  assert.equal(byFif.isVideo, true)
  assert.equal(byFif.containerVersion, 4)
  assert.equal(byFif.freeImageFormat, 35)
})

test('LZ4 mip：compression=1 时按 uncompressedSize 解压', () => {
  const raw = Buffer.from('WE-CORE-LZ4-PAYLOAD', 'utf8') // 19 字节
  const block = lz4Literals(19, 0x41)
  const tex = parseTex(buildTex({ version: 3, images: [{ fif: -1, mips: [{ width: 19, height: 1, compression: 1, uncompressedSize: 19, data: block }] }] }))
  assert.equal(tex.images[0][0].compression, 1)
  assert.deepEqual([...tex.images[0][0].data], new Array(19).fill(0x41))
  assert.equal(tex.images[0][0].dataSize, block.length)
  assert.equal(tex.images[0][0].uncompressedSize, 19)
  assert.ok(raw.length === tex.images[0][0].data.length)
  // compression=2（语料里未见）按原样返回，和参考实现一致
  const raw2 = parseTex(buildTex({ version: 3, images: [{ fif: -1, mips: [{ width: 4, height: 4, compression: 2, uncompressedSize: 0, data: Buffer.alloc(16, 5) }] }] }))
  assert.deepEqual([...raw2.images[0][0].data], new Array(16).fill(5))
})

test('LZ4 解码器：字面量 + 回引匹配 + 畸形块', () => {
  // token 0x22 = 2 字面量 + 匹配长度 2（+4=6），offset=2 ⇒ "AB" + "ABABAB" = ABABABAB
  const block = Buffer.from([0x22, 0x41, 0x42, 0x02, 0x00])
  assert.equal(Buffer.from(lz4Decompress(block, 8)).toString('latin1'), 'ABABABAB')
  const short = lz4Decompress(Buffer.from([0x10, 0x7a]), 16) // 1 字面量、目标 16 ⇒ 尾部补零
  assert.equal(short.length, 16)
  assert.deepEqual([...short.subarray(0, 3)], [0x7a, 0, 0])
  assert.throws(() => lz4Decompress(Buffer.from([0x10, 0x00, 0x00, 0x00]), 4), /zero match offset/)
  assert.throws(() => lz4Decompress(Buffer.from([0x50, 0x01, 0x02]), 4), /truncated literals/)
  assert.throws(() => lz4Decompress(Buffer.from([0x00, 0x05, 0x00]), 4), /match offset before output start/)
  assert.throws(() => lz4Decompress(Buffer.alloc(0), -1), /dstSize/)
})

test('TEXS 精灵表：帧字段逐项还原', () => {
  const frames = [
    { imageId: 0, frametime: 0.1, x: 0, y: 0, xAxis: [220, 0], yAxis: [0, 220] },
    { imageId: 1, frametime: 0.25, x: 220, y: -1.5, xAxis: [220, 0], yAxis: [0, 220] },
  ]
  const tex = parseTex(buildTex({ version: 3, images: [{ fif: -1, mips: [{ width: 4, height: 4, data: Buffer.alloc(16) }] }], sprite: { frames, gifWidth: 220, gifHeight: 440 } }))
  assert.equal(tex.sprite.magic, 'TEXS0003\0')
  assert.equal(tex.sprite.gifWidth, 220)
  assert.equal(tex.sprite.gifHeight, 440)
  assert.equal(tex.sprite.frames.length, 2)
  assert.deepEqual(tex.sprite.frames[1], { imageId: 1, frametime: 0.25, x: 220, y: -1.5, xAxis: [220, 0], yAxis: [0, 220] })
  assert.equal(tex.sprite.frames[0].frametime, Math.fround(0.1))
  assert.throws(() => parseSprite(Buffer.from('NOPE\0', 'latin1')), /not a TEXS/)
})

test('头部/边界：魔数、截断、荒谬计数、未知容器都抛错', () => {
  assert.throws(() => parseTex(Buffer.concat([Buffer.from('not a tex at all', 'latin1'), Buffer.alloc(64)])), /not a TEXV0005/)
  assert.throws(() => parseTex(Buffer.alloc(20)), /too small/)
  const ok = buildTex({ version: 3, images: [{ fif: -1, mips: [{ width: 4, height: 4, data: Buffer.alloc(16) }] }] })
  assert.throws(() => parseTex(ok.subarray(0, ok.length - 8)), /declares/)
  const badVersion = Buffer.from(ok)
  badVersion.write('TEXB0009', 46, 'latin1')
  assert.throws(() => parseTex(badVersion), /unsupported image container/)
  const hugeImages = Buffer.from(ok)
  hugeImages.writeInt32LE(1 << 20, 55)
  assert.throws(() => parseTex(hugeImages), /implausible image count/)
  assert.deepEqual(Object.keys(parseTexHeader(ok)).sort(), ['containerMagic', 'flags', 'format', 'formatName', 'height', 'layoutVersion', 'reserved', 'textureHeight', 'textureWidth', 'width'])
  assert.equal(firstMipmap(ok).width, 4)
})

test('像素解码：手算格式向量（raw / RGB565 / BC1 / BC2 / BC3）', () => {
  // ARGB8888：原样复制
  assert.deepEqual([...decodePixels(0, 2, 1, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))], [1, 2, 3, 4, 5, 6, 7, 8])
  // RGB888：补 255 alpha
  assert.deepEqual([...decodePixels(1, 2, 1, Buffer.from([1, 2, 3, 250, 251, 252]))], [1, 2, 3, 255, 250, 251, 252, 255])
  // R8 / RG88
  assert.deepEqual([...decodePixels(9, 2, 1, Buffer.from([0, 128]))], [0, 0, 0, 255, 128, 128, 128, 255])
  assert.deepEqual([...decodePixels(8, 1, 1, Buffer.from([10, 20]))], [10, 20, 0, 255])
  // RGB565：0xF800 = 红、0x07E0 = 绿、0x001F = 蓝、0xFFFF = 白
  assert.deepEqual([...decodePixels(2, 4, 1, Buffer.from([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff]))], [
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ])
  // BC1：c0=红(0xF800) > c1=蓝(0x001F)，四种调色板
  const bc1 = Buffer.alloc(8)
  bc1.writeUInt16LE(0xf800, 0)
  bc1.writeUInt16LE(0x001f, 2)
  bc1[4] = 0b11100100 // 行 0：像素 0=0(红) 1=1(蓝) 2=2 3=3
  assert.deepEqual([...decodePixels(7, 4, 4, bc1).subarray(0, 16)], [
    255, 0, 0, 255, // 调色板 0 = c0
    0, 0, 255, 255, // 调色板 1 = c1
    170, 0, 85, 255, // 调色板 2 = (2c0+c1)/3
    85, 0, 170, 255, // 调色板 3 = (c0+2c1)/3
  ])
  // BC1：c0 <= c1 时调色板 3 = 透明黑
  const bc1t = Buffer.alloc(8)
  bc1t.writeUInt16LE(0x001f, 0) // c0 = 蓝
  bc1t.writeUInt16LE(0xf800, 2) // c1 = 红，c0 <= c1 ⇒ 调色板 3 = 透明黑
  bc1t[4] = 0b00000011 // 像素 0 索引 3（透明），像素 1 索引 0（蓝）
  const px = [...decodePixels(7, 4, 4, bc1t).subarray(0, 8)]
  assert.deepEqual(px, [0, 0, 0, 0, 0, 0, 255, 255])
  // BC3：alpha 端点 255/0（a0>a1）⇒ 表 [255,0,218,182,145,109,72,36]
  const bc3 = Buffer.alloc(16)
  bc3[0] = 255; bc3[1] = 0
  bc3[2] = 0b01010000 // 像素 0 索引 0 → 255，像素 1 索引 2 → 218，像素 2 索引 1 → 0
  bc3.writeUInt16LE(0xffff, 8); bc3.writeUInt16LE(0x0000, 10)
  const a = decodePixels(4, 4, 4, bc3)
  assert.deepEqual([a[3], a[7], a[11], a[15]], [255, 218, 0, 255])
  // BC2：4bit alpha × 17
  const bc2 = Buffer.alloc(16)
  bc2[0] = 0x0f // 像素 0 = 15 → 255，像素 1 = 0 → 0
  bc2.writeUInt16LE(0xffff, 8); bc2.writeUInt16LE(0x0000, 10)
  const b = decodePixels(6, 4, 4, bc2)
  assert.deepEqual([b[3], b[7]], [255, 0])
  // 不支持/未实现格式：明确抛错
  assert.throws(() => decodePixels(12, 4, 4, Buffer.alloc(16)), /not decodable/)
  assert.throws(() => decodePixels(3, 4, 4, Buffer.alloc(16)), /not decodable/)
  assert.throws(() => decodePixels(9, 8, 8, Buffer.alloc(4)), /needs 64 bytes/)
})

test('载荷尺寸模型：raw 与块压缩格式的字节数', () => {
  assert.equal(expectedPayloadSize(0, 32, 32), 4096)
  assert.equal(expectedPayloadSize(1, 4, 4), 48)
  assert.equal(expectedPayloadSize(2, 4, 4), 32)
  assert.equal(expectedPayloadSize(8, 4, 4), 32)
  assert.equal(expectedPayloadSize(9, 4, 4), 16)
  assert.equal(expectedPayloadSize(4, 16, 16), 256) // BC3：ceil(16/4)^2 × 16
  assert.equal(expectedPayloadSize(7, 5, 3), 16)    // BC1：ceil(5/4)×ceil(3/4)=2×1 块 × 8
  assert.equal(expectedPayloadSize(12, 4, 4), 0)    // BC7 未实现
  assert.ok(payloadSizeMatches(9, 8, 4, 32))
  assert.ok(!payloadSizeMatches(9, 8, 4, 31))
})

test('真语料（可选）：mip 载荷长度与格式自洽（fif=-1 且未压缩）', (t) => {
  const ws = process.env.MPW_ROOT
  if (!ws) return t.skip('未设 MPW_ROOT（真语料检查按仓库惯例 SKIP）')
  const files = [
    path.join(ws, 'allwallpaper', 'dd', '3715743282', 'scene.pkg'),
    path.join(ws, 'allwallpaper', '0917', '3250755486', 'scene.pkg'),
  ].filter((f) => fs.existsSync(f))
  if (!files.length) return t.skip('未找到小语料包')
  let checked = 0
  for (const file of files) {
    const buf = fs.readFileSync(file)
    const pkg = parsePkg(buf)
    for (const e of pkg.entries.filter((x) => /\.tex$/i.test(x.name))) {
      const tex = parseTex(getEntry(pkg, e.name))
      if (tex.freeImageFormat !== -1) continue
      for (const image of tex.images) {
        for (const mip of image) {
          if (mip.compression !== 0) continue
          assert.ok(payloadSizeMatches(tex.format, mip.width, mip.height, mip.data.length), `${e.name}: fmt ${tex.format} ${mip.width}x${mip.height} 载荷 ${mip.data.length} 与格式不符`)
          checked++
        }
      }
    }
    buf.fill(0)
  }
  assert.ok(checked > 0, '至少要校验到一个 mip')
})

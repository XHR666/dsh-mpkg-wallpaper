// tex-format5-etc2-test.mjs —— TEX `format 5` = ETC2_RGBA8_EAC（不是"DXT5 半分辨率"）
//
// 背景（用户症状：打开 MPKG 后**满屏彩色乱点**）：
//   · `format 4` = DXT5（BC3，16B/4×4 块），PC 的 `scene.pkg` 语料里全是 0/4/6/7/8/9；
//   · `format 5` 只出现在 Android 管线产出的 `.mpkg` 里，块尺寸**同样是 16B/4×4**，
//     所以按 BC3 解**长度刚好对得上**（480×270×16 = 2073600 = 1920×1080×1）⇒ 状态码看不出错，
//     但像素是**彩色噪声**（平滑度 164 vs 真图 ~13）。
//   · 官方 arm64 `libscenejni.so` 的 `GLTexture::Init` 对 format 5 调 `glCompressedTexImage2D`
//     且 internalFormat = **0x9278 = GL_COMPRESSED_RGBA8_ETC2_EAC**（同函数里 4→0x83f3 DXT5、
//     6→0x83f2 DXT3、7→0x83f1 DXT1、3→0x8d64 ETC1）⇒ format 5 是 **ETC2+EAC**，
//     块内布局 = `[8B EAC alpha][8B ETC2 颜色]`。**是格式语义错，不是解析偏移错**。
//
// 本文件覆盖：
//   A 组：纯函数金标 —— ETC2 五种模式（individual / differential / T / H / planar）+ EAC alpha
//         每块 8 字节，期望值取自独立实现 `texture2ddecoder` 1.0.6（MIT）的 `decode_etc2a8`，
//         两者在真实语料 2,073,600 像素上**逐像素一致（0 处不同）**。
//   B 组：真实语料 —— 有 `../allwallpaper/1004/丛雨.mpkg` 时解主纹理并断言
//         「mip 尺寸 == 声明尺寸/2」「载荷长度 == 期望」「平滑度 < 40」「FNV-1a 摘要相符」，
//         并带**分辨力自证**：同一份载荷按 format 4（BC3）解必须**平滑度 > 60**（旧行为=噪声）。
//
// 回退位：若某台机器上 ETC2 结果异常，可用 `?tex5=legacy`（渲染器侧）把 format 5 退回旧的
//   「按 BC3 解 + 用 mip 尺寸上传」路径，便于对比定位；本模块本身不读 URL。
//
// 运行：node tests/tex-format5-etc2-test.mjs   （全过 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'
import { decodePixels, expectedPayloadSize } from '../packages/we-core/src/pixels.js'
import { decodeEtc2Rgba8 } from '../packages/we-core/src/etc2.js'
import { parseTex } from '../packages/we-core/src/tex.js'
import { parsePkg, readPkgEntry } from '../pkg-parse.mjs'

let pass = 0, fail = 0, skip = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.log('  ✗ ' + n + (d ? '  [' + d + ']' : '')) } }
const skipped = (n, why) => { skip++; console.log('  ~ ' + n + '  [跳过：' + why + ']') }

/** 相邻像素平均差（三通道求和 / 像素对）——越小越像真图；纯噪声 ≈ 100+。 */
function smoothness(rgba, w, h) {
  let s = 0, n = 0
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
    const q = (y * w + x) * 4, p = q - 4
    s += Math.abs(rgba[q] - rgba[p]) + Math.abs(rgba[q + 1] - rgba[p + 1]) + Math.abs(rgba[q + 2] - rgba[p + 2])
    n++
  }
  return n ? s / n : 0
}
const fnv1a = (bytes) => {
  let h = 0xcbf29ce484222325n
  for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn }
  return '0x' + h.toString(16).padStart(16, '0')
}

// ---------------------------------------------------------------- A 组：纯函数金标
// 每项 = 16 字节块（8B EAC alpha + 8B ETC2 颜色）的十六进制，附独立实现给出的前 8 个像素 RGBA。
const GOLDEN = [
  ['A individual 模式', 'ff00000000000000f3814e0001234567', [247, 128, 60, 255, 255, 138, 70, 255, 43, 9, 230, 255, 53, 19, 240, 255]],
  ['B differential 模式', 'ff000000000000008a3cf15689abcdef', [111, 28, 218, 255, 149, 66, 255, 255, 76, 0, 175, 255, 180, 48, 255, 255]],
  ['C T 模式（R 越界触发）', 'ff00000000000000f9f8065611223344', [221, 255, 136, 255, 221, 255, 136, 255, 0, 91, 74, 255, 0, 91, 74, 255]],
  ['D H 模式（G 越界触发）', 'ff0000000000000000f9065611223344', [23, 40, 193, 255, 23, 40, 193, 255, 0, 181, 147, 255, 0, 181, 147, 255]],
  ['E planar 模式（B 越界触发）', 'ff000000000000000000f95611223344', [0, 0, 105, 255, 43, 4, 115, 255, 85, 8, 126, 255, 128, 12, 136, 255]],
  ['F EAC alpha（非不透明）', '804f7fff01020304f3814e0001234567', [247, 128, 60, 92, 255, 138, 70, 160, 43, 9, 230, 116, 53, 19, 240, 108]],
]
console.log('== A 组：ETC2/EAC 五种模式 + alpha 金标（对照独立实现 texture2ddecoder 1.0.6）==')
for (const [name, hex, want] of GOLDEN) {
  const payload = Uint8Array.from(Buffer.from(hex, 'hex'))
  const got = [...decodeEtc2Rgba8(4, 4, payload).slice(0, want.length)]
  ok('A ' + name + '：前 ' + (want.length / 4) + ' 像素 RGBA 相符', JSON.stringify(got) === JSON.stringify(want),
    got.join(',') === want.join(',') ? '' : `got ${got.join(',')} want ${want.join(',')}`)
}
{
  // 载荷长度：16 B / 4×4 块（与 DXT5 相同 ⇒ 长度校验抓不到格式错的坑）
  ok('A 载荷长度 = ceil(w/4)·ceil(h/4)·16', expectedPayloadSize(5, 1920, 1080) === 2073600, String(expectedPayloadSize(5, 1920, 1080)))
  let threw = false
  try { decodeEtc2Rgba8(8, 8, new Uint8Array(16)) } catch { threw = true }
  ok('A 载荷不足时抛 RangeError（不静默出图）', threw)
  // 分辨力自证：全 0 块（EAC base=0,mult=0 → alpha=0；ETC2 全 0 → individual 黑）不能与金标相同
  const zeros = [...decodeEtc2Rgba8(4, 4, new Uint8Array(16)).slice(0, 16)]
  ok('A 自证：全零块输出 ≠ 金标（金标有分辨力）', JSON.stringify(zeros) !== JSON.stringify(GOLDEN[0][2]), zeros.slice(0, 4).join(','))
}

// ---------------------------------------------------------------- B 组：真实语料
console.log('== B 组：真实语料 丛雨.mpkg 主纹理（format 5）==')
const CANDIDATES = [
  process.env.WE_TEX5_SAMPLE,
  path.join(process.env.MPW_ROOT || WS, 'allwallpaper', '1004', '丛雨.mpkg'),
  path.join(ROOT, 'allwallpaper', '1004', '丛雨.mpkg'),
].filter(Boolean)
const sample = CANDIDATES.find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!sample) {
  skipped('B 全部（找不到语料包）', CANDIDATES[0] || '(未给出路径)')
} else {
  const pkg = parsePkg(new Uint8Array(fs.readFileSync(sample)))
  const entry = pkg.entries.find((e) => /\.tex$/i.test(e.name) && /noise_scale/.test(e.name))
  ok('B 找到主纹理条目', !!entry, entry && entry.name.slice(-46))
  const tex = parseTex(readPkgEntry(pkg, entry))
  const mip = tex.images[0][0]
  ok('B format == 5', tex.format === 5, 'format=' + tex.format)
  ok('B mip 尺寸 == 声明尺寸 / 2（半分辨率存储）',
    mip.width === tex.textureWidth / 2 && mip.height === tex.textureHeight / 2,
    `declared ${tex.textureWidth}x${tex.textureHeight} → mip ${mip.width}x${mip.height}`)
  ok('B 载荷长度 == ceil(w/4)·ceil(h/4)·16', mip.data.length === expectedPayloadSize(5, mip.width, mip.height),
    `${mip.data.length} vs ${expectedPayloadSize(5, mip.width, mip.height)}`)
  const rgba = decodePixels(5, mip.width, mip.height, mip.data)
  const sm = smoothness(rgba, mip.width, mip.height)
  ok('B 平滑度 < 40（真图 ≈ 13.4；噪声 ≈ 164）', sm < 40, sm.toFixed(2))
  ok('B alpha 全不透明（该图层无透明区）', rgba[3] === 255 && rgba[(mip.width * mip.height - 1) * 4 + 3] === 255)
  ok('B FNV-1a 摘要相符（0x3c482b7b28a5808b）', fnv1a(rgba) === '0x3c482b7b28a5808b', fnv1a(rgba))
  // 分辨力自证：同一份载荷按 format 4（旧行为：BC3）解 ⇒ 必须是噪声
  const asBc3 = decodePixels(4, mip.width, mip.height, mip.data)
  const smBc3 = smoothness(asBc3, mip.width, mip.height)
  ok('B 自证：按 format 4 解 = 噪声（平滑度 > 60）⇒ 断言抓得住旧 bug', smBc3 > 60, smBc3.toFixed(2))
  // 同包 format 0 纹理不能回归（lightshaft，128×512 每像素 4B）
  const other = pkg.entries.find((e) => /lightshaft\.tex$/i.test(e.name))
  if (other) {
    const t2 = parseTex(readPkgEntry(pkg, other))
    const m2 = t2.images[0][0]
    const r2 = decodePixels(t2.format, m2.width, m2.height, m2.data)
    ok('B 同包 format 0（ARGB8888）无回归：平滑度 < 40', smoothness(r2, m2.width, m2.height) < 40,
      `${t2.format} ${m2.width}x${m2.height} sm=${smoothness(r2, m2.width, m2.height).toFixed(2)}`)
  } else skipped('B 同包 format 0 回归检查', '包内没有 lightshaft.tex')
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  pass=${pass} fail=${fail} skip=${skip}`)
process.exit(fail === 0 ? 0 : 1)

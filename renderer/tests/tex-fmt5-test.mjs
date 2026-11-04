// tex-fmt5-test.mjs — RE-40 回归测试：format 5（半分辨率 DXT5）解码
// 断言：1) 载荷长度 == BC3(mip 头尺寸)；2) decodeMip0/decodeMips 返回 mip 尺寸且 rgba 长度正确；
//       3) 声明尺寸 ≈ 2× 载荷尺寸（不再裁剪成空白图）；4) 抽样导出 PNG 供目视
// 用法: node tex-fmt5-test.mjs [--dump <dir>] [若干 .pkg/.mpkg 或目录]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
// ①(去个人化 2026-09-16) 插件下载缓存 / 备用语料根：环境变量优先；默认值只是作者本机路径。
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'
const MPW_SD_ROOT = process.env.MPW_SD_ROOT || '/mnt/sdcard/wallpapertest1'

const argv = process.argv.slice(2)
const di = argv.indexOf('--dump')
const dumpDir = di >= 0 ? argv[di + 1] : null
const roots = argv.filter((_, i) => i !== di && i !== di + 1)
if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true })

function findPkgs() {
  const out = []
  const scan = (p) => {
    let st
    try { st = fs.statSync(p) } catch { return }
    if (st.isFile()) { if (/\.(pkg|mpkg)$/i.test(p)) out.push(p); return }
    for (const f of fs.readdirSync(p)) scan(path.join(p, f))
  }
  if (roots.length) roots.forEach(scan)
  else [`${MPW_WS}/allwallpaper`, MPW_PLUGIN_CACHE, MPW_SD_ROOT].forEach(scan)
  return [...new Set(out)]
}

function writePNG(file, rgba, w, h) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, o = y * (1 + w * 4) + 1 + x * 4
    raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3]
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

const bc3 = (w, h) => Math.ceil(w / 4) * Math.ceil(h / 4) * 16
const checks = []
const push = (name, cond, detail) => checks.push({ name, ok: !!cond, detail })

let files = 0, fmt5 = 0, decoded = 0, dumped = 0
const ratioBuckets = {}
const fails = []
let alphaNonZero = 0

for (const file of findPkgs()) {
  let pkg
  try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file))) } catch { continue }
  files++
  for (const e of pkg.entries) {
    let buf
    try { buf = new Uint8Array(e.data !== undefined ? e.data : lib.getEntry(pkg, e.name)) } catch { continue }
    if (buf.length < 20 || buf[0] !== 0x54 || buf[1] !== 0x45 || buf[2] !== 0x58) continue
    let tex
    try { tex = lib.parseTex(buf) } catch { continue }
    if (tex.format !== 5) continue
    fmt5++
    const m = tex.images[0] && tex.images[0][0]
    if (!m) { fails.push(`${path.basename(file)}:${e.name} 无 mip0`); continue }
    const tag = `${path.basename(file)}:${e.name} 声明${tex.width}x${tex.height} 载荷${m.width}x${m.height}`
    if (m.data.length !== bc3(m.width, m.height)) fails.push(`${tag} 载荷长度 ${m.data.length} != BC3 ${bc3(m.width, m.height)}`)
    // 声明/载荷尺寸关系，三个**合法族**（2026-10-04 扩：前两族是既有实测，新增两族来自语料
    //   1004/夜莺night 与 藤田ことね/逆流茶会 的逐字节证据——载荷长度严格等于 BC3(载荷尺寸)，
    //   解码成功且内容非空 ⇒ 合法存法，不是损坏）：
    //   ① 降分辨率：载荷 = 声明的 2× 或 4×（编辑器半分辨率存法，formatName "DXT5（半分辨率）"）；
    //   ② 1:1：载荷 == 声明（两轴都是 4 的倍数 ⇒ 无 padding）；
    //   ③ 块对齐：载荷 = ceil(声明/4)×4（BC3 按 4×4 块存储，非整块尺寸向上补齐；如 15×15→16×16）。
    const ceil4 = (v) => Math.ceil(v / 4) * 4
    const rw = tex.width / m.width, rh = tex.height / m.height
    ratioBuckets[Math.round(rw) + 'x' + Math.round(rh)] = (ratioBuckets[Math.round(rw) + 'x' + Math.round(rh)] || 0) + 1
    const downscaled = rw > 1.5 && rh > 1.5 && rw < 4.6 && rh < 4.6 && Math.abs(rw - rh) < 0.25
    const one2one = m.width === tex.width && m.height === tex.height
    const blockPadded = m.width === ceil4(tex.width) && m.height === ceil4(tex.height)
    if (!(downscaled || one2one || blockPadded)) fails.push(`${tag} 声明/载荷比例异常 ${rw.toFixed(2)}x${rh.toFixed(2)}`)
    if (tex.formatName !== 'DXT5（半分辨率）') push('formatName', false, `format5 name=${tex.formatName}`)
    let d0, dm
    try {
      d0 = lib.decodeMip0(tex)
      dm = lib.decodeMips(tex)
    } catch (err) { fails.push(`${tag} 解码异常: ${err.message}`); continue }
    decoded++
    // decodeMip0 的合法尺寸 = min(声明, 载荷)：降分辨率族取载荷（半分辨率）、1:1 族两者相等、
    //   块对齐族取声明（15×15 内容装在 16×16 块载荷里，解码后裁回声明尺寸）
    const cw = Math.min(tex.width, m.width), ch = Math.min(tex.height, m.height)
    if (d0.width !== cw || d0.height !== ch) fails.push(`${tag} decodeMip0 尺寸 ${d0.width}x${d0.height} 应为内容尺寸 ${cw}x${ch}（min(声明,载荷)）`)
    if (!d0.rgba || d0.rgba.length !== d0.width * d0.height * 4) fails.push(`${tag} decodeMip0 rgba 长度异常`)
    if (dm[0].width !== cw || dm[0].height !== ch) fails.push(`${tag} decodeMips[0] 尺寸 ${dm[0].width}x${dm[0].height} 应为内容尺寸 ${cw}x${ch}`)
    // 图像非空白：统计非零像素比例
    let nz = 0
    const px = d0.rgba.length / 4
    // 采样步长取奇数且不等于宽度，避免只扫到某一列（曾因此误报"全部透明"）
    const step = Math.max(1, Math.floor(px / 5000)) | 1
    for (let p = 0; p < px; p += step) if (d0.rgba[p * 4 + 3] > 0) nz++
    if (nz === 0) fails.push(`${tag} 解码后全部透明`)
    else alphaNonZero++
    if (dumpDir && dumped < 12 && m.width <= 1600 && m.height <= 1600) {
      const tw = Math.min(360, m.width)
      const th = Math.max(1, Math.round(tw * m.height / m.width))
      const sp = new Uint8Array(tw * th * 4)
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const si = (Math.floor(y * m.height / th) * m.width + Math.floor(x * m.width / tw)) * 4, o = (y * tw + x) * 4
        sp[o] = d0.rgba[si]; sp[o + 1] = d0.rgba[si + 1]; sp[o + 2] = d0.rgba[si + 2]; sp[o + 3] = d0.rgba[si + 3]
      }
      writePNG(path.join(dumpDir, `fmt5_${String(dumped).padStart(2, '0')}_${m.width}x${m.height}.png`), sp, tw, th)
      dumped++
    }
    if (d0.rgba) d0.rgba = null
  }
}

push('语料中存在 format 5 纹理', fmt5 > 0, `fmt5=${fmt5}`)
push('format 5 全部解码成功', decoded === fmt5, `decoded=${decoded}/${fmt5}`)
push('无逐项失败', fails.length === 0, fails.slice(0, 8).join(' | '))
push('已导出目视样本', !dumpDir || dumped > 0, `dumped=${dumped}`)

let pass = 0
for (const c of checks) { console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`); if (c.ok) pass++ }
console.log(`\n${pass}/${checks.length} 通过 | 包 ${files} | format5 ${fmt5} | 解码 ${decoded} | 非空 ${alphaNonZero} | 导出 ${dumped}`)
console.log('声明/载荷比例分布:', JSON.stringify(ratioBuckets))
if (fails.length) { console.log('失败明细:'); fails.slice(0, 20).forEach((f) => console.log('  - ' + f)) }
process.exit(pass === checks.length ? 0 : 1)

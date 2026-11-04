// tools/make-icons.mjs —— P-92：PWA 图标的**程序化生成器**（确定性、无第三方素材）
//
// 复现：node tools/make-icons.mjs            # 重新生成 icons/*.png（同参数同 sha256）
//       node tools/make-icons.mjs --check    # 只校验"产物与生成器一致"（门禁用；不一致退出 1）
//
// 为什么不用现成图标文件：本仓库有**同一条已验证过的纪律**（P-86/P-87）——随仓库分发的资源
// 必须能自证来源。图标要么来自第三方（要署名、要许可、要 sha256 台账），要么**自己生成**。
// 这里选后者：`samples/sample-synthetic` 也是同一处置（程序化生成，`tools/make-sample.mjs`）。
//
// 图形（无字体、无外部素材）：深底 + 同心"场景框" + 一条地平线 + 一枚发光圆点。
// 只用整数/浮点算术，跨机器逐字节可复现（zlib 压缩级别固定）。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
// ①(P-101 2026-09-16 目录再整理) 本脚本在 `tools/`，但**根口径仍取自单一事实源** `tests/_root.mjs`
//   （`ROOT` = 仓库根）；图标产物落在 `web/icons/`（站点外壳资源，随 PWA 一起发布）。
import { ROOT } from '../tests/_root.mjs'

const OUT = path.join(ROOT, 'web', 'icons')
const BG = [0x0b, 0x0e, 0x14, 0xff]
const FRAME = [0x5c, 0xc8, 0xff, 0xff]
const HORIZON = [0x2a, 0x6b, 0x8f, 0xff]
const ORB = [0xff, 0xd0, 0x6a, 0xff]

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}
/** @param {Uint8Array} rgba w*h*4 */
function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0                                   // filter: none（确定性优先）
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))))

/**
 * 画一张图标。
 * @param {number} S 边长
 * @param {boolean} maskable true = 全出血（安全区 ≤80%，给系统裁切留量）
 */
function draw(S, maskable) {
  const px = new Uint8Array(S * S * 4)
  const cx = (S - 1) / 2, cy = (S - 1) / 2
  const safe = maskable ? 0.40 : 0.46                    // 半边长占全图比例（maskable 更内收）
  const R = S * safe
  const bw = Math.max(1, Math.round(S * 0.028))           // 线宽
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let c = BG.slice()
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy)
      // 圆角正方形：非 maskable 时四角透明（iOS/桌面的常规图标观感）
      if (!maskable) {
        const rr = S * 0.22, ex = dx - (S / 2 - rr), ey = dy - (S / 2 - rr)
        if (ex > 0 && ey > 0 && Math.hypot(ex, ey) > rr) { px.set([0, 0, 0, 0], (y * S + x) * 4); continue }
      }
      // 竖向渐变底（上略亮）
      c = mix(BG, [0x16, 0x1d, 0x2b, 0xff], (y / S) * 0.9)
      // 场景框（正方形描边，圆角）
      const fR = S * 0.30, fr = S * 0.06
      const fx = dx - (fR - fr), fy = dy - (fR - fr)
      const outside = Math.max(fx, fy)
      const inCorner = fx > 0 && fy > 0 && Math.hypot(fx, fy) > fr
      const onFrame = !inCorner && outside <= 0 && outside > -bw
      if (onFrame) c = FRAME
      // 地平线（框内下 1/3）
      const hy = cy + R * 0.34
      if (dx <= fR - fr * 1.6 && Math.abs(y - hy) <= bw / 2) c = HORIZON
      // 发光圆点（地平线上方、随距离衰减）
      const ox = cx, oy = cy - R * 0.16, orad = S * 0.075
      const d = Math.hypot(x - ox, y - oy)
      if (d <= orad) c = mix(ORB, c, d / orad * 0.55)
      else if (d <= orad * 2.2) c = mix(c, ORB, (1 - (d - orad) / (orad * 1.2)) * 0.18)
      px.set(c, (y * S + x) * 4)
    }
  }
  return encodePng(px, S, S)
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
]

const CHECK = process.argv.includes('--check')
if (!CHECK) fs.mkdirSync(OUT, { recursive: true })
let bad = 0
const rows = []
for (const t of TARGETS) {
  const buf = draw(t.size, t.maskable)
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const fp = path.join(OUT, t.file)
  if (CHECK) {
    const cur = fs.existsSync(fp) ? fs.readFileSync(fp) : null
    const ok = !!cur && cur.equals(buf)
    if (!ok) bad++
    rows.push({ file: t.file, ok, sha256: sha, bytes: buf.length })
    console.log(`${ok ? '✓' : '✗'} ${t.file}  ${buf.length} 字节  sha256=${sha.slice(0, 16)}…`)
  } else {
    fs.writeFileSync(fp, buf)
    rows.push({ file: t.file, ok: true, sha256: sha, bytes: buf.length })
    console.log(`✓ 写出 ${t.file}  ${buf.length} 字节  sha256=${sha}`)
  }
}
fs.writeFileSync(path.join(OUT, 'icons.json'), JSON.stringify({
  generator: 'node tools/make-icons.mjs（确定性；勿手改 PNG）',
  note: '程序化生成，无第三方素材；sha256 用于门禁核对',
  icons: rows,
}, null, 1) + '\n')
if (CHECK && bad) { console.error(`✗ ${bad} 个图标与生成器不一致（重跑 node tools/make-icons.mjs）`); process.exit(1) }
console.log(CHECK ? '✓ 图标与生成器逐字节一致' : '✓ 图标已生成')

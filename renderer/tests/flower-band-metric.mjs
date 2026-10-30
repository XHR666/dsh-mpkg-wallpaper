// flower-band-metric.mjs — 官方/我们/CPU 三方"白色花朵带位置"定量比对工具（P-69）
//
// 用法: node flower-band-metric.mjs <图片...>
//   输出：① 10 个等高带的"白/淡色低饱和像素"占比（从上到下，%）
//        ② 花朵主色（白/淡色低饱和）像素的外接框 y 范围（占画面高度 %，y 向下）
//        ③ 该外接框中心的 y（%）
//
// 判据（与用户口径一致）：高亮 + 低饱和 = 近似白/淡色花瓣。
//   lum = 0.299R+0.587G+0.114B ≥ LUM_MIN   且   max(R,G,B) − min(R,G,B) ≤ SAT_MAX
// 用 ffmpeg 解码任意图片 → rawvideo rgb24（仓库自带 jpeg.js 有 bug，见 P-67）。
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

// 口径标定（P-69）：用 (lumMin,satMax) 在官方 W1.jpg 上做网格搜索，最小化与用户给出向量的 RMSE。
// 实测最优 = (170,76) → RMSE 0.76（官方 [2.66,16.02,…] → 我们测 [2.55,16.98,…]）。
// 换成这两条判据后三方数字可直接与用户口径对照，不再各自一套。
export const LUM_MIN = 170
export const SAT_MAX = 76
const BANDS = 10

export function measureRaw(buf, W, H, { lumMin = LUM_MIN, satMax = SAT_MAX } = {}) {
  const bands = new Array(BANDS).fill(0)
  const bandTot = new Array(BANDS).fill(0)
  let n = 0, minY = H, maxY = -1, minX = W, maxX = -1
  const bandW = W / BANDS
  for (let y = 0; y < H; y++) {
    const b = Math.min(BANDS - 1, Math.floor(y / (H / BANDS)))
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3
      const R = buf[i], G = buf[i + 1], B = buf[i + 2]
      bandTot[b]++
      const lum = 0.299 * R + 0.587 * G + 0.114 * B
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B)
      if (lum >= lumMin && mx - mn <= satMax) {
        bands[b]++; n++
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  void bandW
  const pct = bands.map((c, i) => (bandTot[i] ? (100 * c) / bandTot[i] : 0))
  return {
    W, H, n,
    bandsPct: pct.map((v) => Math.round(v * 100) / 100),
    bbox: n ? {
      x0: minX, x1: maxX, y0: minY, y1: maxY,
      y0Pct: Math.round((100 * minY) / H * 100) / 100,
      y1Pct: Math.round((100 * maxY) / H * 100) / 100,
      ycPct: Math.round((100 * (minY + maxY)) / (2 * H) * 100) / 100,
    } : null,
  }
}

// 把"设计坐标 y"换算成"画面高度百分比"（设计 3840x2160，等比填充/裁切不改变纵向构图比例）
export const designYToPct = (y) => Math.round((100 * y) / 2160 * 100) / 100
export const pctToDesignY = (p, H = 2160) => Math.round((p / 100) * H * 100) / 100

export function measureFile(file) {
  const dim = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], { encoding: 'utf8' }).trim()
  const [W, H] = dim.split('x').map(Number)
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 30 })
  return measureRaw(raw, W, H)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('用法: node flower-band-metric.mjs <图片...>'); process.exit(2) }
  for (const f of files) {
    if (!fs.existsSync(f)) { console.log(`✗ ${f} 不存在`); continue }
    const m = measureFile(f)
    console.log(`\n=== ${f}  (${m.W}x${m.H}, 命中 ${m.n} px) ===`)
    console.log('band%(上→下):', JSON.stringify(m.bandsPct))
    if (m.bbox) {
      console.log(`bbox y: ${m.bbox.y0}–${m.bbox.y1} px = 画面 ${m.bbox.y0Pct}%–${m.bbox.y1Pct}%` +
        `  (中心 ${m.bbox.ycPct}%),  x: ${m.bbox.x0}–${m.bbox.x1}`)
      console.log(`  ↳ 换算设计坐标 y: ${pctToDesignY(m.bbox.y0Pct)} – ${pctToDesignY(m.bbox.y1Pct)}（y 向下，共 2160）`)
    } else console.log('bbox: 无命中')
  }
}

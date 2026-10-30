// visual-diff.mjs — 视觉回归：当前渲染 vs 官方/用户参照，SSIM+MAE+差异热图（MERGED-2 第 3 项 A）
//
// 用法:
//   node visual-diff.mjs --id 3719111841 --out /tmp/vd/              # 出分数+热图+JSON
//   node visual-diff.mjs --id 3719111841 --ab "?att=legacy"          # 两开关各渲一次，分数并排
//   node visual-diff.mjs --id 3719111841 --check                     # 与 visual-baseline.json 比对，退化非零退出
//   node visual-diff.mjs --id 3719111841 --ref <图片路径>            # 显式指定参照
//   node visual-diff.mjs --id 3719111841 --skip-render               # 复用 <out>/current.png（调参时省时间）
//
// 参照优先级：① allwallpaper/dd/<id>/preview.gif（官方缩略图 192×192，取中段帧）
//            ② Testphoto/TP*/ 用户截图（TP↔id 映射见 TP_MAP，先探黑边再 cover-fit）
//            ③ refrender-<id>.json（几何判据：跑 layer-rect-check --refrender，中位偏差 px 作分数）
//
// 对齐：当前渲染 960×540 → 按参照 aspect 居中 cover 裁剪 → 灰度互相关 ±8px 微调 → 统一缩到参照尺寸。
// 指标：SSIM（8×8 窗，自实现）+ MAE；差异热图 PNG（ffmpeg rawvideo 编码，无 npm 依赖）。
// 局限：官方 preview.gif 的方形投影映射未定（P-24 待定项）→ 与它的分数是"同基线相对值"，
//       不是绝对相似度；基线=当前版本分数（visual-baseline.json），用于检测**回归**。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const ARGS = process.argv.slice(2)
const argVal = (k) => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : null }
const HAS = (k) => ARGS.includes(k)
const DEMO = 'http://127.0.0.1:8899'
const DD = `${MPW_WS}/allwallpaper/dd`
const TESTPHOTO = `${MPW_WS}/Testphoto`
const TP_MAP = { '3719111841': 'TP8' } // 用户截图目录映射（有新对照时在此登记）
const OUT = argVal('--out') || (path.join(os.tmpdir(), 'vd') + '/')
const RENDER_W = 960, RENDER_H = 540

const id = argVal('--id')
if (!id) { console.error('用法: node visual-diff.mjs --id <id> [--out 目录] [--ab 查询串] [--check] [--ref 图片] [--skip-render]'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

// ── ffmpeg 助手（解码/编码，无 npm 依赖）──
function ffprobeSize(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  const [w, h] = out.trim().split(',').map(Number)
  return { w, h }
}
function decodeRgba(file) {
  const { w, h } = ffprobeSize(file)
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 })
  if (buf.length < w * h * 4) throw new Error('解码不足: ' + file + ' ' + buf.length + '<' + w * h * 4)
  return { data: new Uint8Array(buf.buffer, buf.byteOffset, w * h * 4), w, h }
}
function encodePng(data, w, h, file) {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', w + 'x' + h, '-r', '1', '-i', '-', '-frames:v', '1', '-y', file], { input: Buffer.from(data.buffer, data.byteOffset, w * h * 4) })
}

// ── 图像基元 ──
const toGray = (img) => { const g = new Float64Array(img.w * img.h); for (let i = 0; i < g.length; i++) { const o = i * 4; g[i] = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2] } return g }
function resizeGray(g, w, h, nw, nh) {
  const out = new Float64Array(nw * nh)
  for (let y = 0; y < nh; y++) { const sy = Math.min(h - 1, Math.floor(y * h / nh)); for (let x = 0; x < nw; x++) { const sx = Math.min(w - 1, Math.floor(x * w / nw)); out[y * nw + x] = g[sy * w + sx] } }
  return out
}
function cropGray(g, w, h, cx, cy, cw, ch) {
  const out = new Float64Array(cw * ch)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = Math.max(0, Math.min(w - 1, cx + x)), sy = Math.max(0, Math.min(h - 1, cy + y))
    out[y * cw + x] = g[sy * w + sx]
  }
  return out
}
const maeOf = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / (a.length * 255) }
function ssimOf(a, b, w, h) { // 8×8 窗全局均值 SSIM（C1=0.01², C2=0.03²，动态范围 255）
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2
  const win = 8
  let ss = 0, n = 0
  for (let wy = 0; wy + win <= h; wy += win) for (let wx = 0; wx + win <= w; wx += win) {
    let s1 = 0, s2 = 0, s11 = 0, s22 = 0, s12 = 0
    for (let y = wy; y < wy + win; y++) for (let x = wx; x < wx + win; x++) {
      const va = a[y * w + x], vb = b[y * w + x]
      s1 += va; s2 += vb; s11 += va * va; s22 += vb * vb; s12 += va * vb
    }
    const N = win * win
    const m1 = s1 / N, m2 = s2 / N
    const v1 = s11 / N - m1 * m1, v2 = s22 / N - m2 * m2, cov = s12 / N - m1 * m2
    ss += ((2 * m1 * m2 + C1) * (2 * cov + C2)) / ((m1 * m1 + m2 * m2 + C1) * (v1 + v2 + C2))
    n++
  }
  return n ? ss / n : 0
}

// ── 参照加载 ──
function loadReference(id, explicitRef) {
  if (explicitRef) {
    const img = decodeRgba(explicitRef)
    return { source: 'explicit:' + path.basename(explicitRef), img, note: '用户指定参照' }
  }
  const gif = path.join(DD, id, 'preview.gif')
  if (fs.existsSync(gif)) {
    const midPng = path.join(OUT, 'ref-mid.png')
    // 取中段帧（官方 48 帧 @192×192；用 -ss 0.5s 取稳定帧）
    execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', gif, '-frames:v', '1', '-y', midPng])
    const img = decodeRgba(midPng)
    return { source: 'preview.gif（官方缩略图中段帧）', img, note: '方形投影映射未定（P-24 待定项）→ 分数为同基线相对值' }
  }
  const tp = TP_MAP[id]
  if (tp && fs.existsSync(path.join(TESTPHOTO, tp))) {
    // 用户截图：挑最大的一张（信息量最高）
    const files = fs.readdirSync(path.join(TESTPHOTO, tp)).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
    if (files.length) {
      const best = files.map((f) => path.join(TESTPHOTO, tp, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
      const img = decodeRgba(best)
      const cropped = probeBorders(img)
      return { source: `Testphoto/${tp}/${path.basename(best)}`, img: cropped, note: '已探黑边+cover-fit（含手机状态栏裁剪）' }
    }
  }
  return null
}
function probeBorders(img) { // 逐边探测近黑均匀边条（状态栏/黑边），裁到内容区
  const g = toGray(img)
  const isRowDark = (y) => { let s = 0; for (let x = 0; x < img.w; x++) s += g[y * img.w + x]; return s / img.w < 12 }
  const isColDark = (x) => { let s = 0; for (let y = 0; y < img.h; y++) s += g[y * img.w + x]; return s / img.h < 12 }
  let top = 0, bottom = img.h - 1, left = 0, right = img.w - 1
  while (top < bottom && isRowDark(top)) top++
  while (bottom > top && isRowDark(bottom)) bottom--
  while (left < right && isColDark(left)) left++
  while (right > left && isColDark(right)) right--
  if (top === 0 && bottom === img.h - 1 && left === 0 && right === img.w - 1) return img
  const cw = right - left + 1, ch = bottom - top + 1
  const data = new Uint8Array(cw * ch * 4)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const so = ((top + y) * img.w + (left + x)) * 4, doo = (y * cw + x) * 4
    data[doo] = img.data[so]; data[doo + 1] = img.data[so + 1]; data[doo + 2] = img.data[so + 2]; data[doo + 3] = 255
  }
  return { data, w: cw, h: ch }
}

// ── 当前渲染（headless-shot，含 CPU 兜底；本机默认 SHOT_MODE=cpu 直通——完整降级链跑 SHOT_MODE=chain）──
async function renderCurrent(query, outFile) {
  const url = DEMO + '/?id=' + id + (query ? (query.startsWith('?') ? '&' + query.slice(1) : '&' + query) : '')
  console.log(`渲染: ${url}`)
  execFileSync('node', ['tests/headless-shot.mjs', url, outFile, '8000', String(RENDER_W), String(RENDER_H)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, REFR: '0', SHOT_MODE: process.env.SHOT_MODE || 'cpu' } })
  return decodeRgba(outFile)
}

// ── 对齐 + 评分 ──
function score(curImg, refImg) {
  const curG = toGray(curImg), refG = toGray(refImg)
  // cover 裁剪当前渲染到参照 aspect（居中）
  const refAspect = refImg.w / refImg.h
  let cw = curImg.w, ch = Math.round(cw / refAspect)
  if (ch > curImg.h) { ch = curImg.h; cw = Math.round(ch * refAspect) }
  const cx = Math.floor((curImg.w - cw) / 2), cy = Math.floor((curImg.h - ch) / 2)
  // 统一工作尺寸（参照原生尺寸太小时限制上限，控制计算量）
  const ww = Math.min(refImg.w, 512), wh = Math.min(refImg.h, 512)
  const curCrop = resizeGray(cropGray(curG, curImg.w, curImg.h, cx, cy, cw, ch), cw, ch, ww, wh)
  const refRs = resizeGray(refG, refImg.w, refImg.h, ww, wh)
  // ±8px 互相关微调（粗分辨率 1/4 上搜，命中后全分辨率复检 ±1）
  let best = { dx: 0, dy: 0, mae: maeOf(curCrop, refRs) }
  const step = 4, rng = 8
  for (let dy = -rng; dy <= rng; dy += step) for (let dx = -rng; dx <= rng; dx += step) {
    if (!dx && !dy) continue
    const shifted = cropGray(curCrop, ww, wh, dx, dy, ww, wh)
    const m = maeOf(shifted, refRs)
    if (m < best.mae) best = { dx, dy, mae: m }
  }
  const fine = cropGray(curCrop, ww, wh, best.dx, best.dy, ww, wh)
  for (let dy = best.dy - 1; dy <= best.dy + 1; dy++) for (let dx = best.dx - 1; dx <= best.dx + 1; dx++) {
    if (dx === best.dx && dy === best.dy) continue
    const shifted = cropGray(curCrop, ww, wh, dx, dy, ww, wh)
    const m = maeOf(shifted, refRs)
    if (m < best.mae) best = { dx, dy, mae: m }
  }
  const aligned = cropGray(curCrop, ww, wh, best.dx, best.dy, ww, wh)
  const ssim = ssimOf(aligned, refRs, ww, wh)
  const mae = maeOf(aligned, refRs)
  // 差异热图（|Δ| → 红-黄渐变，Alpha 255）
  const heat = new Uint8Array(ww * wh * 4)
  for (let i = 0; i < ww * wh; i++) {
    const d = Math.min(1, Math.abs(aligned[i] - refRs[i]) / 96)
    const o = i * 4
    heat[o] = 40 + Math.round(215 * d); heat[o + 1] = Math.round(230 * (1 - d)); heat[o + 2] = Math.round(60 * (1 - d)); heat[o + 3] = 255
  }
  return { ssim: +ssim.toFixed(4), mae: +mae.toFixed(4), align: { dx: best.dx, dy: best.dy, workW: ww, workH: wh }, heat, ww, wh }
}

// ── 几何判据兜底（refrender 存在但无图像参照时）──
function geometricScore(id) {
  const rr = path.join(ROOT, 'refrender-' + id + '.json')
  if (!fs.existsSync(rr)) return null
  try {
    const out = execFileSync('node', ['tests/layer-rect-check.mjs', id, '--refrender'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
    const med = /中位[^\d]*(\d+(?:\.\d+)?)/.exec(out)
    const score = med ? Math.max(0, 1 - Number(med[1]) / 100) : null
    return { source: 'refrender 几何判据', medianPx: med ? Number(med[1]) : null, score, log: out.split('\n').slice(-6).join('\n') }
  } catch (e) { return { source: 'refrender 几何判据', err: String(e.message).slice(0, 200) } }
}

// ── 主流程 ──
const currentPng = path.join(OUT, `current-${id}.png`) // 按 id 命名，避免多包共用 /tmp/vd/ 时互相覆盖
const runVariant = async (query, tag) => {
  const cur = HAS('--skip-render') && fs.existsSync(currentPng) && !query
    ? decodeRgba(currentPng)
    : await renderCurrent(query, query ? path.join(OUT, 'current' + (tag || 'ab') + '.png') : currentPng)
  const ref = loadReference(id, argVal('--ref'))
  if (ref) {
    const s = score(cur, ref.img)
    encodePng(s.heat, s.ww, s.wh, path.join(OUT, `heat-${id}${tag || ''}.png`))
    return { refSource: ref.source, refNote: ref.note, ssim: s.ssim, mae: s.mae, align: s.align }
  }
  const geo = geometricScore(id)
  if (geo) return { refSource: geo.source, refNote: '无图像参照，几何判据', ssim: geo.score, mae: geo.medianPx != null ? +(geo.medianPx / 100).toFixed(4) : null, geo }
  return { refSource: null, error: '无 preview.gif、无 TP 映射、无 refrender —— 无法对比（可用 --ref 显式指定）' }
}

const base = await runVariant('', '')
console.log('\n══ visual-diff: ' + id)
if (base.error) { console.error('✗ ' + base.error); process.exit(2) }
console.log(`参照: ${base.refSource}${base.refNote ? '（' + base.refNote + '）' : ''}`)
console.log(`SSIM=${base.ssim}  MAE=${base.mae}${base.align ? '  对齐offset=(' + base.align.dx + ',' + base.align.dy + ')' : ''}`)
console.log(`热图: ${path.join(OUT, 'heat-' + id + '.png')}`)

let abResult = null
if (argVal('--ab')) {
  const q = argVal('--ab')
  abResult = await runVariant(q, '-ab')
  if (!abResult.error) {
    console.log(`A/B ${q}: SSIM=${abResult.ssim}  MAE=${abResult.mae}`)
    console.log(`Δ SSIM=${(base.ssim - abResult.ssim).toFixed(4)}  Δ MAE=${(base.mae - abResult.mae).toFixed(4)}（正=默认更好）`)
  } else console.error('A/B 渲染失败: ' + abResult.error)
}

const result = { id, at: new Date().toISOString(), base, ab: abResult }
fs.writeFileSync(path.join(OUT, `visual-${id}.json`), JSON.stringify(result, null, 1))

// ── 基线 ──
const BASELINE = path.join(import.meta.dirname, 'visual-baseline.json')   // ①(2026-09-16) 基线与本脚本同在 tests/
function loadBaseline() { try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')) } catch { return { generatedAt: null, rows: {} } } }
const bl = loadBaseline()
if (HAS('--check')) {
  const b = bl.rows[id]
  if (!b) { console.error('✗ visual-baseline.json 无该包基线，先跑一次不带 --check'); process.exit(2) }
  const ssimDrop = b.ssim - base.ssim
  if (b.ssim != null && ssimDrop > 0.02) {
    console.error(`✗ SSIM 回归：基线 ${b.ssim} → 现在 ${base.ssim}（-0.02 阈值）`)
    process.exit(1)
  }
  if (b.mae != null && base.mae != null && base.mae > b.mae * 1.15) {
    console.error(`✗ MAE 回归：基线 ${b.mae} → 现在 ${base.mae}（+15% 阈值）`)
    process.exit(1)
  }
  console.log(`✓ --check：与基线一致（SSIM ${b.ssim} → ${base.ssim}）`)
} else if (!bl.rows[id] || HAS('--write-baseline')) {
  bl.generatedAt = new Date().toISOString()
  bl.rows[id] = { refSource: base.refSource, ssim: base.ssim, mae: base.mae, at: result.at, note: base.refNote }
  fs.writeFileSync(BASELINE, JSON.stringify(bl, null, 1))
  console.log(`基线已写入 ${path.basename(BASELINE)}`)
}
process.exit(0)

// video-downscale-flicker-probe.mjs — 视频**非全屏（缩小显示）时黑线闪烁**的可量读数。
//
// 症状（`3588989102` = 2558×1438@60fps / 35Mbps H.264）：非全屏播放时细黑线（描边/发丝）闪烁
// —— 典型成因是**缩小显示时的下采样混叠**：缩放器只做低阶插值，高频细节在相邻帧间落到不同
// 相位 ⇒ 逐帧"闪"。
//
// 怎么量（**用浏览器自己的缩放器**，不是 ffmpeg 的滤镜）：
//   ① 先用 ffmpeg 把原生帧抽成 PNG 序列（命令见文件末尾）；
//   ② 页内 `drawImage(img, 0, 0, W, H)` 把每帧画进目标尺寸画布（走的正是浏览器缩放图像那套
//      代码），`getImageData` 读回；
//   ③ 判据 = **高频带的时间方差**：每帧先 Laplacian 高通（细节层），再逐对相邻帧求
//      `mean|L_t − L_{t−1}|`。同一场景下这个数越大 = 细节闪得越厉害。同时报空间细节能量
//      `mean|L|` —— 只有"闪得少**且**没把细节糊没"才算真的更好（把它糊掉也能让闪烁变小，
//      那是拿画质换稳定，必须两个数一起看）。
//   ④ 对照档 = 原生尺寸 1:1；被测档 = 非全屏尺寸 × {direct（一次 drawImage，浏览器缺省路径）,
//      mip（逐级减半再落目标 = mip 式低通）, direct/low（imageSmoothingQuality 降档）}。
//
// **内存纪律（本探针的设计约束）**：这台机器 15GB / 可用 ~4GB，曾因 OOM 自动重启。
//   · 帧**不进 Node 内存**（route 拦包时才从磁盘读一张，发完即还）；
//   · 页内**同一时刻只解一张图**（画完立刻 `img.src=''` 释放），不保留帧序列；
//   · 指标**边算边累加**，只留"上一帧的高通层"（双缓冲复用）⇒ 峰值 ≈ 2×W×H×8B + 一张位图。
//
// 诚实边界：
//   · 量的是**图像缩放器**这条链，不是浏览器合成 `<video>` 元素的 GPU 路径（不可注入）；
//     两者在"缩小倍数大时丢不丢高频"上同族，读数**不是** `<video>` 的逐像素真值。
//   · 帧由 ffmpeg 解出（解码器可能与浏览器不同）⇒ 结论只用于**同序列内比较**。
//   · 缺帧目录 / 缺 playwright ⇒ SKIP（**不假装通过**）。
//
// 用法：
//   node tests/video-downscale-flicker-probe.mjs --selftest
//   node tests/video-downscale-flicker-probe.mjs --frames /tmp/vid19 [--limit 16] [--sizes 1280x720,900x506,624x351]
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const FRAMES = (() => { const i = argv.indexOf('--frames'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '' })()
const SIZES = (() => { const i = argv.indexOf('--sizes'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '1280x720,900x506,624x351' })()
const LIMIT = (() => { const i = argv.indexOf('--limit'); const v = i >= 0 ? Number(argv[i + 1]) : 16; return Number.isFinite(v) && v >= 4 ? Math.min(40, v) : 16 })()
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/** Laplacian 高通后的均值（= 细节能量）。 */
export function highFreqEnergy(gray, w, h) {
  let s = 0, n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      s += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w])
      n++
    }
  }
  return n ? s / n : 0
}

/**
 * 时间闪烁 = 相邻帧**高通层**之差的均值（越大越闪）。
 * `frames` = 灰度数组（同尺寸）；`w/h` 为尺寸。返回 `{flicker, sharp, pairs}`；帧数 < 2 ⇒ null。
 */
export function temporalFlicker(frames, w, h) {
  if (!Array.isArray(frames) || frames.length < 2) return { flicker: null, sharp: null, pairs: 0 }
  const hp = frames.map((g) => {
    const out = new Float64Array(w * h)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        out[i] = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]
      }
    }
    return out
  })
  let flick = 0, n = 0
  for (let t = 1; t < hp.length; t++) {
    let s = 0
    for (let i = 0; i < w * h; i++) s += Math.abs(hp[t][i] - hp[t - 1][i])
    flick += s / (w * h); n++
  }
  let sharp = 0
  for (const g of frames) sharp += highFreqEnergy(g, w, h)
  return { flicker: +(flick / n).toFixed(4), sharp: +(sharp / frames.length).toFixed(4), pairs: n }
}

/** 两次读数的比值（`null` 安全）：闪烁比与细节比一起给，避免"糊掉换稳定"被当成改进。 */
export function compareReadings(a, b) {
  if (!a || !b || !Number.isFinite(a.flicker) || !Number.isFinite(b.flicker)) return null
  const fr = b.flicker === 0 ? (a.flicker === 0 ? 1 : Infinity) : a.flicker / b.flicker
  const sr = b.sharp === 0 ? (a.sharp === 0 ? 1 : Infinity) : a.sharp / b.sharp
  return { flickerRatio: +fr.toFixed(4), sharpRatio: +sr.toFixed(4) }
}

if (SELFTEST) {
  console.log('[S] 纯判据自证（不起浏览器）')
  const W = 16, H = 16
  const flat = () => new Float64Array(W * H).fill(100)
  ok(temporalFlicker([flat(), flat(), flat()], W, H).flicker === 0, 'S1 完全静止的序列 ⇒ flicker=0')
  const stripe = (phase) => {
    const g = flat()
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + phase) % 2 === 0) g[y * W + x] = 0
    return g
  }
  const flip = temporalFlicker([stripe(0), stripe(1), stripe(0), stripe(1)], W, H)
  ok(flip.flicker > 50 && flip.sharp > 50, 'S2 1px 条纹逐帧反相（= 闪烁）⇒ flicker 与 sharp 都高', JSON.stringify(flip))
  const blurred = temporalFlicker([flat(), flat(), flat()], W, H)
  ok(blurred.flicker === 0 && blurred.sharp === 0, 'S3 糊掉能消闪烁但 sharp 归零 ⇒ 单看 flicker 会误判"更好"', JSON.stringify(blurred))
  ok(temporalFlicker([flat()], W, H).flicker === null, 'S4 少于两帧 ⇒ null（不许当 0）')
  ok(highFreqEnergy(flat(), W, H) === 0, 'S5 平坦图的细节能量 = 0')
  const cmp = compareReadings({ flicker: 10, sharp: 20 }, { flicker: 5, sharp: 20 })
  ok(cmp && cmp.flickerRatio === 2 && cmp.sharpRatio === 1, 'S6 比较函数：闪烁减半=2×、细节不变=1×', JSON.stringify(cmp))
  ok(compareReadings({ flicker: 0, sharp: 1 }, { flicker: 0, sharp: 1 }).flickerRatio === 1, 'S7 两者都为 0 时比值 = 1（不是 NaN/Infinity）')
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器）')
  process.exit(fail > 0 ? 1 : 0)
}

const files = (() => {
  try { return fs.readdirSync(FRAMES).filter((f) => /\.png$/i.test(f)).sort().slice(0, LIMIT).map((f) => path.join(FRAMES, f)) } catch (e) { return [] }
})()
if (files.length < 4) { skip('video-downscale-flicker', '帧目录不可用或帧数 < 4（--frames <dir>；抽取命令见文件末尾）'); process.exit(0) }
const native = (() => {
  try { const b = fs.readFileSync(files[0]); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } } catch (e) { return null }
})()
if (!native) { skip('video-downscale-flicker', '读不出帧尺寸'); process.exit(0) }
const pwPath = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
  path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js')]
  .filter((p) => { try { return !!p && fs.existsSync(p) } catch (e) { return false } })[0]
if (!pwPath) { skip('video-downscale-flicker', '找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { skip('video-downscale-flicker', 'playwright 没有 firefox 导出'); process.exit(0) }

const targets = SIZES.split(',').map((s) => { const m = /^(\d{2,5})x(\d{2,5})$/.exec(s.trim()); return m ? { w: +m[1], h: +m[2] } : null }).filter(Boolean)
console.log(`帧：${files.length} 张（上限 ${LIMIT}）${native.w}x${native.h}；被测尺寸：${targets.map((t) => t.w + 'x' + t.h).join(' / ')}`)

const browser = await firefox.launch({ headless: true, firefoxUserPrefs: { ...AUDIO_MUTE_PREFS, 'webgl.force-enabled': true, 'gfx.webrender.software': true, 'webgl.out-of-process': false } })
try {
  const page = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage()
  // 帧按需从磁盘读（不进 Node 内存）；页内只解一张图。ACAO 让画布可读回。
  await page.route('**/frame-*.png', (route) => {
    const i = Number(/frame-(\d+)\.png/.exec(route.request().url())[1])
    let body = null
    try { body = fs.readFileSync(files[i]) } catch (e) { body = null }
    if (!body) return route.fulfill({ status: 404, body: 'no frame' })
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body })
  })
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 30000 })
  const out = await page.evaluate(async (M) => {
    const load = async (i) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('frame ' + i)); img.src = 'http://127.0.0.1:8901/frame-' + i + '.png' })
      return img
    }
    /** 边画边算：只保留"上一帧高通层"，双缓冲复用（内存 ≈ 2×W×H×8B + 一张解码位图）。 */
    const measure = async (W, H, mode, quality) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H
      const g = c.getContext('2d', { willReadFrequently: true })
      g.imageSmoothingEnabled = quality !== 'off'
      if (quality !== 'off') { try { g.imageSmoothingQuality = quality } catch (e) {} }
      let cur = new Float64Array(W * H), prev = new Float64Array(W * H)
      let hasPrev = false, flickSum = 0, pairs = 0, sharpSum = 0, frames = 0
      const gray = new Float64Array(W * H)
      // ① 乒乓双缓冲：**不能**拿同一张画布既当源又当目标（`tmp.width=…` 会先清空它 ⇒ 从空白再画）。
      //   实测踩过：624×351 的 mip 链要走 3 级，单张 tmp 在第 2 级就自绘成空白（读数 0/0）。
      const t1 = document.createElement('canvas'), t2 = document.createElement('canvas')
      for (let i = 0; i < M.n; i++) {
        const img = await load(i)
        if (mode === 'mip') {
          let cw = img.naturalWidth, ch = img.naturalHeight, src = img, dst = t1
          // 每步 ≤ ~0.63×（`> 1.6`），保证"逐级减半"真的发生（2× 缩小时也要走一步）
          while (cw > W * 1.6 && ch > H * 1.6) {
            const nw = Math.max(1, Math.floor(cw / 2)), nh = Math.max(1, Math.floor(ch / 2))
            dst.width = nw; dst.height = nh
            const tg = dst.getContext('2d')
            tg.imageSmoothingEnabled = true
            try { tg.imageSmoothingQuality = 'high' } catch (e) {}
            tg.drawImage(src, 0, 0, nw, nh)
            src = dst; cw = nw; ch = nh
            dst = (dst === t1) ? t2 : t1        // 换另一张当目标（乒乓）
          }
          g.drawImage(src, 0, 0, W, H)
        } else {
          g.drawImage(img, 0, 0, W, H)
        }
        try { img.src = '' } catch (e) {}      // 立刻释放这张位图
        const d = g.getImageData(0, 0, W, H).data
        for (let p = 0; p < W * H; p++) gray[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]
        let hs = 0
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const p = y * W + x
            const v = 4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - W] - gray[p + W]
            cur[p] = v; hs += Math.abs(v)
          }
        }
        sharpSum += hs / ((W - 2) * (H - 2)); frames++
        if (hasPrev) {
          let s = 0
          for (let p = 0; p < W * H; p++) s += Math.abs(cur[p] - prev[p])
          flickSum += s / (W * H); pairs++
        }
        const sw = cur; cur = prev; prev = sw; hasPrev = true
      }
      return {
        label: W + 'x' + H + ' ' + mode + '/' + quality,
        flicker: pairs ? +(flickSum / pairs).toFixed(4) : null,
        sharp: frames ? +(sharpSum / frames).toFixed(4) : null,
        pairs,
      }
    }
    const res = []
    res.push(await measure(M.nativeW, M.nativeH, 'direct', 'high'))   // 对照：1:1
    for (const t of M.targets) {
      res.push(await measure(t.w, t.h, 'direct', 'high'))
      res.push(await measure(t.w, t.h, 'mip', 'high'))
      res.push(await measure(t.w, t.h, 'direct', 'low'))
    }
    return res
  }, { n: files.length, nativeW: native.w, nativeH: native.h, targets })

  for (const r of out) console.log(`  ${r.label.padEnd(26)} 闪烁=${String(r.flicker).padStart(9)}  细节=${String(r.sharp).padStart(9)}  对数=${r.pairs}`)
  const base = out[0]
  console.log(`\n对照（原生 1:1 ${native.w}x${native.h}）：闪烁=${base.flicker} 细节=${base.sharp}`)
  // 判据分成两问，别混成一句：
  //   ① 闪烁是否显著更低（`flickerRatio > 1.15`）—— 这是"用户看到的那件事有没有被改善"；
  //   ② 细节是否被牺牲（`sharpRatio > 1.2` = mip 档明显更软）—— 这决定它是"纯改进"还是"取舍"。
  let steadier = 0, pureWin = 0
  const cls = []
  for (const t of targets) {
    const d = out.find((r) => r.label.indexOf(`${t.w}x${t.h} direct/high`) === 0)
    const m = out.find((r) => r.label.indexOf(`${t.w}x${t.h} mip/high`) === 0)
    if (!d || !m) continue
    const c = compareReadings(d, m)
    const isSteadier = !!(c && c.flickerRatio > 1.15)
    const softer = !!(c && c.sharpRatio > 1.2)
    if (isSteadier) steadier++
    if (isSteadier && !softer) pureWin++
    cls.push(`${t.w}x${t.h} ${isSteadier ? '更稳' : '无显著差'}${softer ? '(更软)' : '(细节相当)'} 闪烁比=${c ? c.flickerRatio : '?'} 细节比=${c ? c.sharpRatio : '?'}`)
    ok(d.flicker !== null && m.flicker !== null, `${t.w}x${t.h} 两档都有可读读数`, `direct=${d.flicker} mip=${m.flicker}`)
  }
  console.log('  逐尺寸判定：' + cls.join(' ｜ '))
  const verdict = steadier
  // ⚠ **跨尺寸不可比**：原生 2558×1438 与 624×351 是不同的采样网格，逐像素高通能量/帧间差
  //   不在同一尺度上（原生每像素覆盖的景物面积小得多）⇒ 只报原生那行的绝对值作背景，
  //   **不给跨尺寸比值**（第一版给过，是误导，已删）。
  for (const r of out) {
    ok(r.flicker !== null && r.sharp !== null && r.sharp > 0 && r.flicker > 0,
      `${r.label} 读数非退化（不是空白/全平）`, `闪烁=${r.flicker} 细节=${r.sharp}`)
  }
  const lowVsHigh = targets.map((t) => {
    const d = out.find((r) => r.label.indexOf(`${t.w}x${t.h} direct/high`) === 0)
    const l = out.find((r) => r.label.indexOf(`${t.w}x${t.h} direct/low`) === 0)
    return d && l ? { size: `${t.w}x${t.h}`, same: d.flicker === l.flicker && d.sharp === l.sharp } : null
  }).filter(Boolean)
  if (lowVsHigh.length && lowVsHigh.every((x) => x.same)) {
    console.log('  ⚠ imageSmoothingQuality 在本浏览器上**无效果**（low 与 high 读数逐位相同）' +
      ' ⇒ 渲染器里那条 `imageSmoothingQuality=high` 在本机等于空操作')
  }
  console.log(verdict
    ? `\n⇒ 结论（**仅同尺寸内可比**）：${verdict} 个尺寸上"逐级减半"比"一次直降"闪烁显著更低` +
      (pureWin ? `，其中 ${pureWin} 个尺寸细节没有被牺牲（纯改进）` : '，但细节也一并降低 ⇒ 是**取舍**不是纯赢。要不要默认开，取决于"要清晰还是要稳"')
    : '\n⇒ 结论（仅同尺寸内可比）：本次读数未显示"直降 vs 逐级减半"的显著差异（如实报告，不编结论）')
} finally { await browser.close().catch(() => {}) }

console.log(fail === 0 ? `ALL PASS (${pass} 项)` : `${pass} PASS / ${fail} FAIL`)
console.log('\n抽帧命令（2558x1438@60 的源，取 25s 起 40 帧）：')
console.log('  mkdir -p /tmp/vid19 && ffmpeg -v error -ss 25 -i <视频> -frames:v 40 -vsync 0 -compression_level 3 /tmp/vid19/f%03d.png')
console.log('  然后：node tests/video-downscale-flicker-probe.mjs --frames /tmp/vid19 --limit 16')
process.exit(fail === 0 ? 0 : 1)

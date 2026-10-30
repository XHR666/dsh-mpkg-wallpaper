// minification-quality-probe.mjs —— 缩采样（minification）质量读数：小画布渲染 vs 大画布渲染的高质量降采样
// 2026-09-23 第 18/19 条取证用（"有的 scene 壁纸画质非常低 / 视频非全屏黑线闪烁"）。
//
// 为什么要这样量：肉眼说"糊/闪"没法回归，而 **同一场景在两种画布尺寸下的渲染**是可比的 ——
//   参照 = 大画布渲染（每像素一个样本，细节最全）用浏览器的高质量滤波降到小尺寸；
//   被测 = 同场景直接在小画布上渲染（GPU 只采 level 0 时，缩小倍数越大、走样越重）。
//   两者之差（MAE，0..255）就是"缩采样路径丢掉了多少"。差越小 = 缩采样越接近理想低通。
//
// 诚实边界：
//   · 这不是"画质好坏"的绝对分数（构图/纹理本身的分辨率不在此列），只量**同场景下**缩采样的保真度；
//   · 两档渲染之间场景是**动态**的（粒子/时钟在走）⇒ 用 `--static` 时取同一 `?time=` 冻结场景，
//     否则差异里会混进时间差（探针会如实报 `timePinned`）；
//   · 缺 playwright / 服务不在 ⇒ SKIP（**不假装通过**）。
//
// 用法：
//   node tests/minification-quality-probe.mjs --selftest
//   node tests/minification-quality-probe.mjs --id 3544152633 --big 1280x720 --small 320x180
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, WS } from './_root.mjs'
/* ①(2026-09-23 全仓清扫) 「有头优先 + 能力前置探针 + 无 GL 打 SKIP」这套口径的**唯一实现**
   （照抄 `tests/bench-renderer-source-test.mjs` 的 D 段；见 `tests/_gl-browser.mjs` 的文件头）。 */
import { launchGLBrowser, glCapability, logGLSkip, glSkipWhy } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const WANT_ID = (() => { const i = argv.indexOf('--id'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '3544152633' })()
const BIG = (() => { const i = argv.indexOf('--big'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '1280x720' })()
const SMALL = (() => { const i = argv.indexOf('--small'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '320x180' })()
const AUTHORITY = (() => { const i = argv.indexOf('--authority'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '127.0.0.1:8902' })()
const EXTRA = (() => { const i = argv.indexOf('--q'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '' })()
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/**
 * 纯判据：两张同尺寸灰度图的平均绝对误差（0..255）与最差 1% 的均值。
 * `null` = 尺寸不等/数据缺失（**不许当 0**：读不出来不等于"没差异"）。
 */
export function imageDiff(a, b, w, h) {
  if (!a || !b || !(w > 0) || !(h > 0) || a.length < w * h * 4 || b.length < w * h * 4) return null
  let sum = 0
  const row = new Float64Array(w * h)
  for (let i = 0, n = w * h; i < n; i++) {
    const lum = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]
    const d = Math.abs(lum(a, i * 4) - lum(b, i * 4))
    row[i] = d
    sum += d
  }
  const sorted = Array.from(row).sort((x, y) => y - x)
  const k = Math.max(1, Math.floor(sorted.length * 0.01))
  let worst = 0
  for (let i = 0; i < k; i++) worst += sorted[i]
  return { mae: +(sum / (w * h)).toFixed(3), worst1pct: +(worst / k).toFixed(3), pixels: w * h }
}

if (SELFTEST) {
  console.log('== S 纯判据自证 ==')
  const mk = (v, n) => { const d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255 } return d }
  ok(imageDiff(mk(10, 4), mk(10, 4), 2, 2).mae === 0, 'S1 两张完全一样 ⇒ MAE 0')
  ok(imageDiff(mk(10, 4), mk(20, 4), 2, 2).mae === 10, 'S2 全图差 10 灰阶 ⇒ MAE 10')
  ok(imageDiff(mk(0, 4), mk(255, 4), 2, 2).worst1pct === 255, 'S3 最差 1% 均值取到极值')
  ok(imageDiff(mk(0, 4), null, 2, 2) === null && imageDiff(mk(0, 4), mk(0, 4), 0, 0) === null, 'S4 缺数据/零尺寸 ⇒ null（不许当 0）')
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器）')
  process.exit(fail > 0 ? 1 : 0)
}

const pwPath = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
  path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js')]
  .filter((p) => { try { return !!p && fs.existsSync(p) } catch (e) { return false } })[0]
if (!pwPath) { skip('minification-quality', '找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { skip('minification-quality', 'playwright 没有 firefox 导出'); process.exit(0) }

const parseWH = (s) => { const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(s)); return m ? { w: Number(m[1]), h: Number(m[2]) } : null }
const small = parseWH(SMALL), big = parseWH(BIG)
if (!small || !big) { skip('minification-quality', '尺寸参数不合法（--big/--small 要 WxH）'); process.exit(0) }

/* 同一时刻冻结场景（`?time=`）+ 固定小分辨率档，避免把"时间差"算进差异里。 */
const urlFor = (wh) => 'http://' + AUTHORITY + '/webloader/?id=' + encodeURIComponent(WANT_ID)
  + '&res=' + wh.w + 'x' + wh.h + '&time=06:30:00&nopanel' + (EXTRA ? '&' + EXTRA.replace(/^&/, '') : '')

/* ⚠ 前置不是"有没有浏览器"，而是"这台浏览器能不能建 WebGL2"（2026-09-23 归因，口径照抄
   `tests/bench-renderer-source-test.mjs` 的 D 段，见 `tests/_gl-browser.mjs`）：本机（Android/PRoot，无
   `/dev/dri`）**无头 Firefox 连 WebGL1 都建不了** ⇒ 两边截到的都是同一张空画布（300×150），
   `mae` 读到 **0** —— 那个数字看着像"缩采样质量完美"，其实是**没渲染**（本探针默认只报读数 ⇒ 会变成
   **静默假绿**，比假红更坏）。所以：**有头优先**（`DISPLAY=:0`，`MPW_X11_DISPLAY` 可换），有头起不来才回落
   无头；`MPW_BENCH_HEADLESS=1` 强制无头。拿不到 WebGL2 ⇒ 读数打 **SKIP + 原样读数**（读数照采作证据）。 */
const { browser, launchNote } = await launchGLBrowser(firefox)
try {
  /* 能力前置探针（读一次，不猜）：webgl2/webgl1 到底能不能建 —— 读数是否可判由它决定。 */
  const gl = await glCapability(browser)
  if (!gl.webgl2) { logGLSkip('缩采样质量读数（画布像素 mae）', launchNote, gl, '下面两张图仍照采，用来证明"空画布 ⇒ mae=0"的假绿签名'); glSkipWhy() }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const shot = async (wh) => {
    const page = await ctx.newPage()
    await page.goto(urlFor(wh), { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(11000)
    /* 只截画布本身：把本页外壳藏掉，再按画布盒裁图（画布是 fixed inset:0，尺寸 = 画布盒）。 */
    await page.evaluate(() => {
      for (const el of [...document.body.children]) {
        if (el.tagName === 'CANVAS') continue
        if (el.querySelector && el.querySelector('canvas')) continue
        el.style.display = 'none'
      }
    })
    await page.waitForTimeout(400)
    const st = await page.evaluate(() => {
      const c = document.getElementById('sc')
      const r = c.getBoundingClientRect()
      return { canvas: c.width + 'x' + c.height, box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }, live: window.__mpwLiveRes || null }
    })
    const buf = await page.screenshot({ clip: st.box })
    await page.close()
    return { st, buf }
  }
  const { st: bigSt, buf: bigBuf } = await shot(big)
  const { st: smallSt, buf: smallBuf } = await shot(small)
  console.log('大画布:', JSON.stringify(bigSt.canvas), '小画布:', JSON.stringify(smallSt.canvas))

  /* 在页面里解码两张 PNG：把大图用浏览器高质量滤波降到小尺寸，再逐像素比。 */
  const probe = await ctx.newPage()
  await probe.goto('about:blank')
  const out = await probe.evaluate(async ([bigB64, smallB64, sw, sh]) => {
    const load = async (b64) => { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = 'data:image/png;base64,' + b64 }); return img }
    const bigImg = await load(bigB64), smallImg = await load(smallB64)
    const c = document.createElement('canvas'); c.width = sw; c.height = sh
    const g = c.getContext('2d')
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'
    g.drawImage(bigImg, 0, 0, sw, sh)
    const ref = g.getImageData(0, 0, sw, sh).data
    const c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh
    const g2 = c2.getContext('2d'); g2.drawImage(smallImg, 0, 0, sw, sh)
    const got = g2.getImageData(0, 0, sw, sh).data
    return { ref: Array.from(ref), got: Array.from(got) }
  }, [bigBuf.toString('base64'), smallBuf.toString('base64'), small.w, small.h])
  const diff = imageDiff(Uint8Array.from(out.got), Uint8Array.from(out.ref), small.w, small.h)
  await probe.close()
  if (!diff) { skip('缩采样质量读数', '有一侧解码/尺寸不匹配'); }
  else {
    console.log('缩采样读数：' + JSON.stringify(Object.assign({}, diff, { id: WANT_ID, big: BIG, small: SMALL, extra: EXTRA || null })))
    console.log('  （mae = 小画布渲染 vs 大画布渲染的高质量降采样的平均差；worst1pct = 最差 1% 像素）')
    /* 有 WebGL2 ⇒ 照旧「读数已取得」（本探针默认只报读数，不放阈值）；拿不到 ⇒ **SKIP + 原样读数**：
       空画布两张 ⇒ mae=0，那个 0 **不能**当成"缩采样质量完美"（这就是本条要防的静默假绿）。 */
    if (!gl.webgl2) logGLSkip('缩采样质量读数已取得', launchNote, gl,
      '原样读数 ' + JSON.stringify({ big: bigSt.canvas, small: smallSt.canvas, mae: diff.mae, worst1pct: diff.worst1pct, live: bigSt.live || null }))
    else ok(true, '读数已取得（本探针默认只报读数；阈值在拿到多张基线后写死）', 'mae=' + diff.mae)
  }
} finally {
  await browser.close().catch(() => {})
  console.log('\nminification-quality-probe：PASS=' + pass + ' FAIL=' + fail)
  process.exit(fail > 0 ? 1 : 0)
}

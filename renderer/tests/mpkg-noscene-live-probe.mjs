// mpkg-noscene-live-probe.mjs —— 「没有 `scene.json` 的容器」在**真页面**里的出路取证（离线判据见
// `tests/mpkg-noscene-test.mjs`）。
//
// 背景：全库 155 个 `.mpkg` 里 85 个没有 `scene.json`（85 个都有可播视频）。此前一律落到
// `rd(undefined)` ⇒ `❌ 启动失败: TextDecoder.decode: Argument 1 could not be converted to any of:
// ArrayBufferView, ArrayBuffer`（扫面读数见 docs/MPKG-SWEEP-20260923.md §2/§4，样本就是本探针默认的那个包）。
// 现在应当：`window.__mpwNoScene.path === 'video'`、日志两行、`<video>` 经看门狗后 `rs≥2` 并真的在放，
// 画布上出现视频（截图亮度统计）。
//
// 口径：有头优先 + GL 能力前置（真页面要 WebGL2 才算走完启动）、一次只起一个浏览器、单包有界、只读。
// 用法：node tests/mpkg-noscene-live-probe.mjs [--pkg <abs.mpkg>] [--res 720p] [--wait 30000] [--json <out>]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { WS } from './_root.mjs'
import { launchGLBrowser, glCapability, glReading, skipGL, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/卡提希娅/卡提希娅_09.mpkg')
const RES = argVal('--res') || '720p'
const WAIT = +(argVal('--wait') || 30000)
const JSON_OUT = argVal('--json')
const ORIGIN = argVal('--origin') || 'http://127.0.0.1:8899'

const require = createRequire(import.meta.url)
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP mpkg-noscene-live  —— 找不到 playwright'); process.exit(0) }
const { firefox } = require(pwPath)

const READ = () => {
  const v = document.querySelector('video')
  return {
    noScene: (() => { try { return window.__mpwNoScene || null } catch { return null } })(),
    firstFrame: !!window.__mpwFirstFrame,
    layers: (() => { try { return Array.isArray(window.__sceneLayers) ? window.__sceneLayers.length : null } catch { return null } })(),
    video: v ? { rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight,
      dur: Number.isFinite(v.duration) ? +v.duration.toFixed(2) : null, paused: v.paused, ct: +v.currentTime.toFixed(2),
      src: String(v.src || '').slice(0, 30), err: v.error ? { code: v.error.code, msg: String(v.error.message || '').slice(0, 90) } : null } : null,
    hook: (() => { try { return window.__mpwBlobMediaRetry || null } catch { return null } })(),
  }
}
const pixels = async (page, probe) => {
  let box = null
  try { box = await page.locator('#sc').first().boundingBox() } catch { box = null }
  if (!box || box.width < 2 || box.height < 2) return { err: '没有可截的画布盒' }
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.floor(box.width), height: Math.floor(box.height) } })
  return await probe.evaluate(async (dataUrl) => {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = dataUrl })
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const g2 = c.getContext('2d'); g2.drawImage(img, 0, 0)
    const d = g2.getImageData(0, 0, c.width, c.height).data
    let sum = 0, sum2 = 0, lit = 0, n = 0
    for (let i = 0; i < d.length; i += 4) { const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += L; sum2 += L * L; if (L > 16) lit++; n++ }
    const mean = sum / n
    return { w: c.width, h: c.height, meanL: +mean.toFixed(3), stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3), litFrac: +(lit / n).toFixed(4) }
  }, 'data:image/png;base64,' + buf.toString('base64')).catch((e) => ({ err: String((e && e.message) || e).slice(0, 120) }))
}

const { browser, launchNote } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
if (!gl.webgl2) await skipGL(browser, 'mpkg-noscene-live', launchNote, gl)
console.log('== 没有 scene.json 的容器：真页面出路 ==')
console.log('· 包：' + path.relative(WS, PKG) + ' · res=' + RES + ' · ' + glReading(launchNote, gl))

const result = { pkg: PKG, res: RES, launchNote }
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 788 } })
  const page = await ctx.newPage()
  const probe = await ctx.newPage()
  await probe.goto('about:blank')
  const logs = [], errs = []
  page.on('console', (m) => { if (logs.length < 300) logs.push(m.text().slice(0, 220)) })
  page.on('pageerror', (e) => errs.push(String((e && e.message) || e).slice(0, 200)))
  await page.goto(ORIGIN + '/?pkgpath=' + encodeURIComponent(PKG) + '&res=' + RES, { waitUntil: 'domcontentloaded' })
  const t0 = Date.now()
  let st = await page.evaluate(READ)
  while (!st.noScene && Date.now() - t0 < WAIT) { await page.waitForTimeout(1000); st = await page.evaluate(READ) }
  result.reachMs = Date.now() - t0
  result.state = st
  await page.waitForTimeout(4000)                       /* 等看门狗（≤2×1.5s）与解码 */
  const after = await page.evaluate(READ)
  result.after = after
  result.pixels = await pixels(page, probe)
  result.logs = logs.filter((t) => /scene\.json|纯视频|视频已加载|视频加载失败|🔁|__mpwNoScene/.test(t)).slice(0, 8)
  result.pageErrors = errs.slice(0, 3)
  console.log('· 到达用时 ' + result.reachMs + 'ms · __mpwNoScene=' + JSON.stringify(st.noScene))
  console.log('· 视频：' + JSON.stringify(after.video))
  console.log('· 看门狗钩子：' + JSON.stringify(after.hook))
  console.log('· 画布：' + JSON.stringify(result.pixels))
  console.log('· 日志命中：' + JSON.stringify(result.logs))
  if (result.pageErrors.length) console.log('· pageerror：' + JSON.stringify(result.pageErrors))
  const v = after.video
  console.log('· 定性：' + (!st.noScene ? '**没走到那条分支**（看日志）'
    : st.noScene.path !== 'video' ? '走到了 error 档：' + JSON.stringify(st.noScene)
      : (v && v.rs >= 2 ? '**按纯视频壁纸播出来了**（rs=' + v.rs + ' ' + v.w + 'x' + v.h + ' dur=' + v.dur + ' paused=' + v.paused + '）'
        : '**记账是 video，但元素没出数据**（rs=' + (v && v.rs) + '）—— 见钩子/日志')))
  await ctx.close()
} finally { await closeQuiet(browser) }
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 1)); console.log('· 读数已落盘：' + JSON_OUT) }
console.log('DONE mpkg-noscene-live')

// mpkg-videoblack-probe.mjs —— 扫面里 `FAIL 挂上了但画布空/纯黑 · video rs=4`（PKGM0014 有 scene.json 的包）定性：
// 是**采样太早**（视频帧还没上传成纹理 / 首帧本身是黑的），还是**视频底层真的画成黑**。
//
// 背景：`tests/mpkg-sweep-test.mjs`（`?type=scene&id=mpkg-sweep&res=dpr&pkgpath=…`，viewport 960×540）在
// "等到 `<video>` rs≥2 + 摘外壳 + 700ms" 之后截图，得到 `meanL≈0 / maxL=0`；而
// `tests/mpkg-videobase-recovery-probe.mjs`（`:8899/?pkgpath=…&res=720p`，viewport 1400×788）在"看门狗补一次
// load() + 2s"之后量到的是**有结构的暗画面**（`meanL=8.9 / stdL=36`）。两者对同一个包结论相反 ⇒ 必须分开量：
//   ① 同一个 URL 形状下**逐时间点**采样（画布 + `<video>` 的 rs/paused/currentTime）⇒ 看黑是不是会自己过去；
//   ② 顺带量 `?res=` 档位与 `type=scene` 各自的影响（同一包、同一浏览器、同一时刻口径）。
//
// 口径：有头优先 + GL 能力前置（真页面要 WebGL2）、一次只起一个浏览器、单包有界、只读。
// 用法：node tests/mpkg-videoblack-probe.mjs [--pkg <abs.mpkg>] [--url <完整 URL>] [--json <out>]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { WS } from './_root.mjs'
import { launchGLBrowser, glCapability, glReading, skipGL, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/蔚蓝档案/蔚蓝档案_04.mpkg')
const URL_ARG = argVal('--url')
const JSON_OUT = argVal('--json')
const MARKS = (argVal('--marks') || '2000,5000,9000,14000').split(',').map((x) => +x)

const require = createRequire(import.meta.url)
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP mpkg-videoblack  —— 找不到 playwright'); process.exit(0) }
const { firefox } = require(pwPath)

const READ = () => {
  const v = document.querySelector('video')
  const c = document.querySelector('canvas')
  return {
    video: v ? { rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight,
      dur: Number.isFinite(v.duration) ? +v.duration.toFixed(2) : null, paused: v.paused, ct: +v.currentTime.toFixed(2),
      err: v.error ? v.error.code : null } : null,
    canvas: c ? { w: c.width, h: c.height } : null,
    layers: (() => { try { return Array.isArray(window.__sceneLayers) ? window.__sceneLayers.length : null } catch { return null } })(),
    firstFrame: !!window.__mpwFirstFrame,
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
    let sum = 0, sum2 = 0, max = 0, lit = 0, n = 0
    for (let i = 0; i < d.length; i += 4) { const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += L; sum2 += L * L; if (L > max) max = L; if (L > 16) lit++; n++ }
    const mean = sum / n
    return { w: c.width, h: c.height, meanL: +mean.toFixed(3), maxL: +max.toFixed(1), stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3), litFrac: +(lit / n).toFixed(4) }
  }, 'data:image/png;base64,' + buf.toString('base64')).catch((e) => ({ err: String((e && e.message) || e).slice(0, 120) }))
}

/* 第三档专门复现扫面的**采样次序**：先 `HIDE_SHELL`（摘掉压画布的外壳）再截 —— 用来判定
   "扫面读到纯黑"是产品问题还是采样口径造成的假读数。 */
const HIDE_SHELL = () => { for (const el of [...document.body.children]) { if (el.tagName === 'CANVAS' || el.tagName === 'VIDEO') continue; if (el.querySelector && el.querySelector('canvas')) continue; el.style.display = 'none' } return true }
const VARIANTS = URL_ARG ? [{ name: '给定 URL', url: URL_ARG }] : [
  { name: '扫面同形(type=scene/res=dpr)', url: 'http://127.0.0.1:8902/webloader/?type=scene&id=mpkg-sweep&res=dpr&pkgpath=' + encodeURIComponent(PKG) },
  { name: '探针同形(无 type/res=720p)', url: 'http://127.0.0.1:8899/?pkgpath=' + encodeURIComponent(PKG) + '&res=720p' },
  { name: '扫面次序(先摘外壳再截)', url: 'http://127.0.0.1:8902/webloader/?type=scene&id=mpkg-sweep&res=dpr&pkgpath=' + encodeURIComponent(PKG), hideShell: true },
]

const { browser, launchNote } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
if (!gl.webgl2) await skipGL(browser, 'mpkg-videoblack', launchNote, gl)
console.log('== 视频底层"画布纯黑"定性（逐时间点采样）==')
console.log('· 包：' + path.relative(WS, PKG) + ' · ' + glReading(launchNote, gl))

const result = { pkg: PKG, launchNote, variants: [] }
try {
  for (const v of VARIANTS) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } })
    const page = await ctx.newPage()
    const probe = await ctx.newPage(); await probe.goto('about:blank')
    const logs = []
    page.on('console', (m) => { if (logs.length < 200) logs.push(m.text().slice(0, 200)) })
    await page.goto(v.url, { waitUntil: 'domcontentloaded' })
    const t0 = Date.now()
    const samples = []
    let hidden = false
    for (const mark of MARKS) {
      const wait = mark - (Date.now() - t0)
      if (wait > 0) await page.waitForTimeout(wait)
      if (v.hideShell && !hidden) { await page.evaluate(HIDE_SHELL); hidden = true; await page.waitForTimeout(700) }
      const st = await page.evaluate(READ)
      const px = await pixels(page, probe)
      samples.push({ atMs: Date.now() - t0, video: st.video, canvas: st.canvas, layers: st.layers, firstFrame: st.firstFrame, pixels: px })
      console.log('  · [' + v.name + '] t=' + samples[samples.length - 1].atMs + 'ms  video rs=' + (st.video && st.video.rs) +
        ' paused=' + (st.video && st.video.paused) + ' ct=' + (st.video && st.video.ct) + ' ' + (st.video && st.video.w) + 'x' + (st.video && st.video.h) +
        '  画布 meanL=' + px.meanL + ' maxL=' + px.maxL + ' stdL=' + px.stdL + ' lit=' + px.litFrac)
    }
    const rec = { name: v.name, url: v.url, samples, hook: await page.evaluate(() => { try { return window.__mpwBlobMediaRetry || null } catch { return null } }),
      logs: logs.filter((t) => /视频|__videoBase|scene\.json 解析|首帧/.test(t)).slice(0, 8) }
    result.variants.push(rec)
    console.log('  · [' + v.name + '] 钩子 ' + JSON.stringify(rec.hook) + ' · 日志 ' + JSON.stringify(rec.logs.slice(0, 4)))
    await ctx.close()
  }
  const last = (x) => x.samples[x.samples.length - 1]
  console.log('· 定性：' + result.variants.map((v) => v.name + ' 末次 meanL=' + last(v).pixels.meanL + '/maxL=' + last(v).pixels.maxL).join(' · ') +
    ' ⇒ ' + (result.variants.every((v) => (last(v).pixels.maxL || 0) > 4) ? '**各档最终都出画**（黑是采样时机/首帧）' : '**至少一档最终仍是纯黑**（要按那一档继续查）'))
} finally { await closeQuiet(browser) }
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 1)); console.log('· 读数已落盘：' + JSON_OUT) }
console.log('DONE mpkg-videoblack')

// mpkg-videobase-recovery-probe.mjs —— 任务④ 第二因的**收尾**：真页面上 `<video>` 卡在 `rs=0` 之后，
// 有没有**页内**就能救回来的动作？（有 ⇒ 一行改动即可让"视频作最底层"在受影响的 Firefox 上恢复；
// 没有 ⇒ 只能靠服务端按条目供流，登记为单开项。）
//
// 依据（前一条探针的实测，不是推断）：
//   · `tests/mpkg-videobase-live-probe.mjs` 在**同一个真页面**里读到：
//       原元素（新建 blob + 首次 load）  = `rs=0 ns=1 err=null`（久等不动）
//       同 URL 换新元素（在 A 段 fetch 过那个 blob 之后）= **`rs=4` 1636x1156 dur=30**
//       原元素**再 load() 一次**（同样在 fetch 之后）    = **`rs=4`**
//   · 上游缺陷单 Bug 2056444 的机制说明：blob 数据 >1MB 走 IPC，`CloneableWithRangeMediaResource`
//     在异步 IPC 流上做同步读 ⇒ **首次元数据读（MP4 的 moov 在尾部，等于远端 seek）可能挂住**。
//   ⇒ 本探针把"再 load 一次"和"先 fetch 一次再 load"**分开量**，判定哪种是必需条件。
//
// 口径：有头优先 + GL 能力前置；一次只起一个浏览器；单包有界；读数不足则只打印读数不下结论。
// 用法：node tests/mpkg-videobase-recovery-probe.mjs [--pkg <abs.mpkg>] [--res 720p] [--json <out>]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { WS } from './_root.mjs'
import { launchGLBrowser, glCapability, glReading, skipGL, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/白洲梓/白洲梓1_10.mpkg')
const RES = argVal('--res') || '720p'
const JSON_OUT = argVal('--json')
const ORIGIN = argVal('--origin') || 'http://127.0.0.1:8899'

const require = createRequire(import.meta.url)
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP mpkg-videobase-recovery  —— 找不到 playwright'); process.exit(0) }
const { firefox } = require(pwPath)

/** 画布读数：截 `#sc` 的像素，再在另一个页面的 2D canvas 上算亮度统计（口径同 mpkg-sweep-test）。 */
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
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      sum += L; sum2 += L * L; if (L > max) max = L; if (L > 16) lit++; n++
    }
    const mean = sum / n
    return { w: c.width, h: c.height, meanL: +mean.toFixed(3), maxL: +max.toFixed(1), stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3), litFrac: +(lit / n).toFixed(4) }
  }, 'data:image/png;base64,' + buf.toString('base64')).catch((e) => ({ err: String((e && e.message) || e).slice(0, 120) }))
}

const READ_V = () => {
  const v = document.querySelector('video')
  if (!v) return null
  return { rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight,
    dur: Number.isFinite(v.duration) ? +v.duration.toFixed(2) : null, paused: v.paused,
    ct: +v.currentTime.toFixed(2), buffered: (() => { try { return v.buffered.length ? +v.buffered.end(0).toFixed(2) : 0 } catch { return null } })(),
    err: v.error ? { code: v.error.code, msg: String(v.error.message || '').slice(0, 90) } : null }
}

const { browser, launchNote } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
if (!gl.webgl2) await skipGL(browser, 'mpkg-videobase-recovery', launchNote, gl)
console.log('== 真页面 `rs=0` 之后能不能页内救回 ==')
console.log('· 包：' + path.relative(WS, PKG) + ' · res=' + RES + ' · ' + glReading(launchNote, gl))

const result = { pkg: PKG, res: RES, launchNote }
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 788 } })
  const page = await ctx.newPage()
  const probe = await ctx.newPage()
  await probe.goto('about:blank')
  const logs = []
  page.on('console', (m) => { if (logs.length < 300) logs.push(m.text().slice(0, 200)) })
  await page.goto(ORIGIN + '/?pkgpath=' + encodeURIComponent(PKG) + '&res=' + RES, { waitUntil: 'domcontentloaded' })
  const t0 = Date.now()
  let ff = false
  while (!ff && Date.now() - t0 < 30000) { await page.waitForTimeout(1000); ff = await page.evaluate(() => !!window.__mpwFirstFrame) }
  result.firstFrameMs = Date.now() - t0
  await page.waitForTimeout(2500)                       /* 给"首次 load 挂住"留够窗口（上游是挂住，不是慢） */
  const s0 = await page.evaluate(READ_V)
  result.stalled = s0
  result.pixelsStalled = await pixels(page, probe)
  console.log('· 首帧 ' + result.firstFrameMs + 'ms · 视频（首次 load，等了 2.5s）：' + JSON.stringify(s0))
  console.log('· 卡住时画布：' + JSON.stringify(result.pixelsStalled))

  /* `--auto`：**不手动干预**，只等页内那条看门狗（`MPW-BLOBRETRY` / `mpwBlobMediaRetry`，≤2 次 × 1.5s）自己把
     `rs` 救回来 ⇒ 这是"落地的兜底代码真的在真页面里生效"的端到端读数（不是手工补 load 的等价物）。 */
  if (process.argv.includes('--auto')) {
    const t = Date.now()
    let s = s0
    while (Date.now() - t < 12000) { await page.waitForTimeout(600); s = await page.evaluate(READ_V); if (s && s.rs >= 2) break }
    result.auto = { waitedMs: Date.now() - t, video: s, hook: await page.evaluate(() => { try { return window.__mpwBlobMediaRetry || null } catch { return null } }) }
    result.auto.pixels = await pixels(page, probe)
    result.auto.logs = logs.filter((x) => /🔁|⚠ 视频底层|BlobMediaRetry|2056444/.test(x)).slice(0, 8)
    console.log('· AUTO（不干预，等页内看门狗，' + result.auto.waitedMs + 'ms）：rs=' + (s && s.rs) + ' ' + (s && s.w) + 'x' + (s && s.h) + ' dur=' + (s && s.dur))
    console.log('· AUTO 画布：' + JSON.stringify(result.auto.pixels) + '（卡住时 meanL=' + (result.pixelsStalled && result.pixelsStalled.meanL) + '）')
    console.log('· AUTO 钩子：' + JSON.stringify(result.auto.hook))
    console.log('· AUTO 日志：' + JSON.stringify(result.auto.logs))
    await ctx.close()
    if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 1)); console.log('· 读数已落盘：' + JSON_OUT) }
    console.log('DONE mpkg-videobase-recovery --auto')
    process.exit(0)
  }

  /* D：**只再 load() 一次**（不碰 blob）⇒ 若 D 就能出数据，"再 load" 是充分条件。 */
  const d = await page.evaluate(async () => {
    const v = document.querySelector('video'); const ev = []
    for (const n of ['loadstart', 'progress', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'error', 'stalled']) v.addEventListener(n, () => ev.push(n))
    v.load()
    const t = performance.now()
    while (performance.now() - t < 8000) { await new Promise((r) => setTimeout(r, 400)); if (v.readyState >= 2 || v.error) break }
    return { rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight, ev }
  })
  result.retryLoadOnly = d
  console.log('· D 只再 load 一次：rs=' + d.rs + ' ns=' + d.ns + ' ' + (d.w || '?') + 'x' + (d.h || '?') + ' 事件=' + JSON.stringify(d.ev))

  /* E：先 `fetch(blobUrl)` 读一遍（把 blob 数据"焐热"/落到本进程），再 load ⇒ 量"fetch 是不是必需"。 */
  let e = null
  if (d.rs < 2) {
    e = await page.evaluate(async () => {
      const v = document.querySelector('video')
      const t0 = performance.now()
      const buf = await (await fetch(v.src)).arrayBuffer()
      const fetchedMs = Math.round(performance.now() - t0)
      v.load()
      const t = performance.now()
      while (performance.now() - t < 8000) { await new Promise((r) => setTimeout(r, 400)); if (v.readyState >= 2 || v.error) break }
      return { fetchedBytes: buf.byteLength, fetchedMs, rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight }
    })
    result.fetchThenLoad = e
    console.log('· E 先 fetch（' + (e.fetchedBytes / 1048576).toFixed(1) + 'MB / ' + e.fetchedMs + 'ms）再 load：rs=' + e.rs + ' ns=' + e.ns + ' ' + (e.w || '?') + 'x' + (e.h || '?'))
  } else result.fetchThenLoad = { skipped: 'D 已经出数据 ⇒ 不需要 E' }

  const got = (d.rs >= 2) ? 'D' : (e && e.rs >= 2 ? 'E' : null)
  result.recoveredBy = got
  if (got) {
    /* 端到端：等渲染器把视频帧传成纹理并画出来，再量画布。 */
    await page.waitForTimeout(2000)
    result.videoAfter = await page.evaluate(READ_V)
    result.pixelsAfter = await pixels(page, probe)
    result.uploadLog = logs.filter((t) => /__videoBase|视频/.test(t)).slice(0, 8)
    console.log('· 恢复后视频：' + JSON.stringify(result.videoAfter))
    console.log('· 恢复后画布：' + JSON.stringify(result.pixelsAfter) + '（卡住时 meanL=' + (result.pixelsStalled && result.pixelsStalled.meanL) + '）')
    const up = logs.filter((t) => /__videoBase/.test(t)).slice(0, 4)
    if (up.length) console.log('· 相关日志：' + JSON.stringify(up))
  }
  console.log('· 定性：' + (got === 'D' ? '**只再 `load()` 一次就够**（页内可救，改动最小）'
    : got === 'E' ? '**必须先 `fetch(blobUrl)` 把数据焐热，再 `load()`**（页内可救，改动仍小）'
      : '两种页内动作都救不回 ⇒ 要恢复只能改"视频从哪来"（服务端按条目供流）'))
  await ctx.close()
} finally { await closeQuiet(browser) }
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 1)); console.log('· 读数已落盘：' + JSON_OUT) }
console.log('DONE mpkg-videobase-recovery')

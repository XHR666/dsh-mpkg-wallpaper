// mpkg-videobase-live-probe.mjs —— 任务④ 第二因的**真页面**取证：同一个包同一段字节，在最小页面里能解
// （`tests/mpkg-video-decode-probe.mjs`：2×2/不可见/不 play/HTTP 直供 全部 `rs=4`），但在真页面里扫面读到
// `rs=0 ns=1 err=null`（等了 6~8s，无错误）。本探针把真页面里的`<video>`**逐字段摊开**，并做两个原地对照：
//
//   A. **字节是否真的进了 blob**：真页面里那个元素挂着 `blob:` URL ⇒ 在页面内 `fetch(src)` 读字节数。
//      读不到 / 0 字节 ⇒ 根因在"页面取字节/建 blob"；读到≈条目大小 ⇒ 字节没问题，问题在元素这条路径上。
//   B. **同字节换一个新元素**：用同一段字节在**同一个真页面**里另建一个 `<video>` ⇒ 它若 `rs≥2`，
//      则"字节 + 浏览器 + 页面环境"都没问题，问题**只**在页面那条既有路径（时序/被覆盖/被回收）。
//
// 口径：有头优先 + GL 能力前置（真页面要 WebGL2 才能启动；拿不到 ⇒ SKIP + 原样读数）、一次只起一个浏览器、
//      单包有界（不整包入内存）。**只读**：不改仓库文件、不改页面。
// 用法：node tests/mpkg-videobase-live-probe.mjs [--pkg <abs.mpkg>] [--res 720p] [--wait 30000] [--json <out>]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, WS } from './_root.mjs'
import { launchGLBrowser, glCapability, glReading, skipGL, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/白洲梓/白洲梓1_10.mpkg')
const RES = argVal('--res') || '720p'
const WAIT = +(argVal('--wait') || 30000)
const JSON_OUT = argVal('--json')
const ORIGIN = argVal('--origin') || 'http://127.0.0.1:8899'   /* 渲染器页就在 8899 的根路径（`/demo.html` 是 404） */

const require = createRequire(import.meta.url)
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP mpkg-videobase-live  —— 找不到 playwright'); process.exit(0) }
const { firefox } = require(pwPath)

const READ = () => {
  const pick = (v) => ({
    css: String(v.style.cssText || '').slice(0, 120), src: String(v.src || '').slice(0, 60),
    currentSrc: String(v.currentSrc || '').slice(0, 60), rs: v.readyState, ns: v.networkState,
    w: v.videoWidth, h: v.videoHeight, dur: Number.isFinite(v.duration) ? +v.duration.toFixed(2) : null,
    ct: +v.currentTime.toFixed(2), paused: v.paused, preload: v.preload, muted: v.muted, loop: v.loop,
    connected: v.isConnected, parent: v.parentElement ? v.parentElement.tagName : null,
    rect: (() => { const r = v.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })(),
    err: v.error ? { code: v.error.code, msg: String(v.error.message || '').slice(0, 120) } : null,
    buffered: (() => { try { return v.buffered.length ? [+v.buffered.start(0).toFixed(2), +v.buffered.end(0).toFixed(2)] : [] } catch { return null } })(),
  })
  const vids = [...document.querySelectorAll('video')]
  const ls = (() => { try { return Array.isArray(window.__sceneLayers) ? window.__sceneLayers.map((l) => l && l.name) : null } catch { return null } })()
  return {
    firstFrame: !!window.__mpwFirstFrame, videos: vids.map(pick),
    layers: ls ? ls.length : null, layerNames: ls ? ls.slice(0, 6) : null,
  }
}

const { browser, launchNote } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
if (!gl.webgl2) await skipGL(browser, 'mpkg-videobase-live', launchNote, gl)
console.log('== 真页面 `<video>` 逐字段取证 ==')
console.log('· 包：' + path.relative(WS, PKG) + ' · 档位 res=' + RES + ' · 读数 ' + glReading(launchNote, gl))

const result = { pkg: PKG, res: RES, launchNote, gl: gl.webgl2 }
const logs = [], errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 788 } })
  const page = await ctx.newPage()
  page.on('console', (m) => { const t = m.text(); if (logs.length < 200) logs.push(t.slice(0, 220)) })
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e).slice(0, 200)))
  const u = ORIGIN + '/?pkgpath=' + encodeURIComponent(PKG) + '&res=' + RES
  await page.goto(u, { waitUntil: 'domcontentloaded' })
  const t0 = Date.now()
  let st = await page.evaluate(READ)
  while (!st.firstFrame && Date.now() - t0 < WAIT) { await page.waitForTimeout(1200); st = await page.evaluate(READ) }
  result.settleMs = Date.now() - t0
  result.state = st
  console.log('· 首帧=' + st.firstFrame + '（等待 ' + result.settleMs + 'ms）· 层数=' + st.layers + ' · 层名=' + JSON.stringify(st.layerNames))
  result.logHits = logs.filter((t) => /视频底层|首帧|启动失败|页面错误|video/i.test(t)).slice(0, 12)
  console.log('· 日志命中：' + JSON.stringify(result.logHits))
  if (errors.length) console.log('· pageerror：' + JSON.stringify(errors.slice(0, 3)))
  for (const [i, v] of st.videos.entries()) {
    console.log('  <video>#' + i + ' rs=' + v.rs + ' ns=' + v.ns + ' ' + (v.w || '?') + 'x' + (v.h || '?') + ' dur=' + v.dur
      + ' muted=' + v.muted + ' paused=' + v.paused + ' preload=' + JSON.stringify(v.preload) + ' connected=' + v.connected
      + ' rect=' + v.rect.w + 'x' + v.rect.h + ' buffered=' + JSON.stringify(v.buffered) + ' err=' + (v.err ? v.err.code + '/' + v.err.msg : 'null'))
    console.log('      css=' + JSON.stringify(v.css))
    console.log('      src=' + v.src + (v.currentSrc && v.currentSrc !== v.src ? '  currentSrc=' + v.currentSrc : ''))
  }

  /* A. 字节是否真的进了 blob：页面内 fetch(blob URL) 读长度（有界：只读长度与头 16 字节，不整段留在页面里）。 */
  const A = await page.evaluate(async () => {
    const v = document.querySelector('video')
    if (!v || !v.src) return { skipped: '页面里没有带 src 的 <video>' }
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000)
      const r = await fetch(v.src, { signal: ctl.signal }); clearTimeout(to)
      const b = await r.arrayBuffer(); const u8 = new Uint8Array(b.slice(0, 16))
      const hex = Array.from(u8).map((x) => x.toString(16).padStart(2, '0')).join('')
      const ascii = Array.from(u8).map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('')
      return { ok: r.ok, status: r.status, bytes: b.byteLength, headHex: hex, headAscii: ascii }
    } catch (e) { return { err: String((e && e.name) || '') + ': ' + String((e && e.message) || e).slice(0, 120) } }
  })
  result.blobBytes = A
  console.log('· A 真页面那个 blob 的字节数：' + JSON.stringify(A))

  /* B. 同字节换一个新元素（原地对照）+ B2 同 URL 换新元素（分清"元素"还是"blob"）。
     ⚠ **不 await `play()`**：本探针第一版就是在这里挂死 70s+ —— 拿不到数据时 `play()` 的 promise
     可以**永不 settle**（见 `mpkg-video-decode-probe.mjs` 的同款读数：play=pending）。 */
  const B = await page.evaluate(async () => {
    const src0 = document.querySelector('video') && document.querySelector('video').src
    if (!src0) return { skipped: '无 src' }
    const mk = (url, css) => {
      const v = document.createElement('video')
      v.style.cssText = css
      v.setAttribute('playsinline', ''); v.muted = true; v.loop = true; v.playsInline = true
      document.body.appendChild(v)
      const ev = []
      for (const n of ['loadstart', 'progress', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'error', 'suspend', 'stalled']) v.addEventListener(n, () => ev.push(n))
      v.src = url; v.load()
      let playState = 'pending'
      try { const p = v.play(); if (p && p.then) p.then(() => { playState = 'ok' }, (e) => { playState = 'rejected:' + String((e && e.name) || '') }); else playState = 'ok' } catch (e) { playState = 'threw' }
      return { v, ev, get playState() { return playState } }
    }
    const wait = async (h, css) => {
      const t = performance.now()
      while (performance.now() - t < 9000) { await new Promise((r) => setTimeout(r, 400)); if (h.v.readyState >= 4 || h.v.error) break }
      const out = { rs: h.v.readyState, ns: h.v.networkState, w: h.v.videoWidth, h: h.v.videoHeight,
        dur: Number.isFinite(h.v.duration) ? +h.v.duration.toFixed(2) : null, events: h.ev, playState: h.playState }
      h.v.remove()
      return out
    }
    const CSS = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1'
    /* B2：**同一个 blob URL**，只换元素 ⇒ 若 B2 也不出数据，问题不在"那一个元素"上。 */
    const b2 = await wait(mk(src0, CSS))
    /* B：**同一段字节的新 blob**，也换元素 ⇒ 与 B2 一起把"元素/blob/路径"三者分开。 */
    const buf = await (await fetch(src0)).arrayBuffer()
    const url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }))
    const b1 = await wait(mk(url, CSS))
    /* C：对**原来那个元素**再 `load()` 一次 ⇒ 排除"只在首次 load 时踩到"这类时序解释。 */
    const v0 = document.querySelector('video')
    const c = { before: { rs: v0.readyState, ns: v0.networkState } }
    v0.load()
    const t = performance.now()
    while (performance.now() - t < 9000) { await new Promise((r) => setTimeout(r, 400)); if (v0.readyState >= 4 || v0.error) break }
    c.after = { rs: v0.readyState, ns: v0.networkState, w: v0.videoWidth, h: v0.videoHeight,
      dur: Number.isFinite(v0.duration) ? +v0.duration.toFixed(2) : null, err: v0.error ? v0.error.code : null }
    return { sameUrlNewElement: b2, sameBytesNewBlob: b1, reloadOriginal: c, bytes: buf.byteLength }
  })
  result.freshElement = B
  const fmt = (o) => o && !o.skipped ? ('rs=' + o.rs + ' ns=' + o.ns + ' ' + (o.w || '?') + 'x' + (o.h || '?') + ' dur=' + o.dur + ' play=' + o.playState + ' 事件=' + JSON.stringify(o.events)) : JSON.stringify(o)
  console.log('· B2 同 URL 换新元素：' + fmt(B.sameUrlNewElement))
  console.log('· B  同字节新 blob 新元素：' + fmt(B.sameBytesNewBlob))
  console.log('· C  原元素再 load 一次：' + JSON.stringify(B.reloadOriginal))

  /* 结论行：只在读数足以定性时下结论。 */
  const v0 = st.videos[0] || null
  console.log('· 定性：')
  if (!v0) console.log('  · 页面里没有 `<video>` ⇒ 视频底层块根本没走到建元素那一步（看日志命中）')
  else if (A.bytes > 1024) console.log('  · 那个元素的 blob **有 ' + (A.bytes / 1048576).toFixed(1) + 'MB 真实字节**（头 ' + A.headAscii + '）⇒ 字节/取字节没问题')
  else console.log('  · 那个元素的 blob **只有 ' + JSON.stringify(A.bytes) + ' 字节**（' + JSON.stringify(A.err || '') + '）⇒ 根因在"页面取字节/建 blob"这一步')
  const anyOk = [B.sameUrlNewElement, B.sameBytesNewBlob, B.reloadOriginal && B.reloadOriginal.after].some((o) => o && o.rs >= 2)
  if (anyOk) console.log('  · 三个对照里至少一个出数据 ⇒ 不是"那条路整体不通"，按出数据的那一档定位')
  else console.log('  · 同 URL 换元素 / 同字节换 blob / 原元素再 load —— **三档全 rs=' + (B.sameUrlNewElement && B.sameUrlNewElement.rs) + '** ⇒ 不是"那一个元素"也不是"那一次 load"的问题：这条 blob 路在本浏览器上整体不通')
  console.log('  · 本机 Chromium 跑不起来（PRoot：newPage 超时/浏览器被关）⇒ **没有第二个浏览器做同机对照**（`mpkg-video-decode-probe.mjs --browser chromium` 会如实失败）；对照只能靠上游 Firefox 缺陷单（见 docs）')
  await ctx.close()
} finally { await closeQuiet(browser) }
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 1)); console.log('· 读数已落盘：' + JSON_OUT) }
console.log('DONE mpkg-videobase-live')

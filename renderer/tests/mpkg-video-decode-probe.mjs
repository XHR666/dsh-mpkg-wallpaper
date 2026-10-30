// mpkg-video-decode-probe.mjs —— 任务④ 的**第二因**定性：容器里的 `wallpaper.mp4` 到底是"能解但页面没让它解"，
// 还是"这台浏览器的媒体栈根本解不了"。
//
// 背景（已定性的第一因）：`__videoBase` 块原本在 `scene===null` 时执行 ⇒ 恒抛 ⇒ 视频底层从未加入（已修）。
// 但扫面读数仍是 `rs=0 ns=1 err=null w=0 h=0`（等了 6~8s）——注意 `ns=1`（NETWORK_IDLE）且**无错误**，
// 这与"编解码器不支持"（应当是 `ns=3` + `MEDIA_ERR_SRC_NOT_SUPPORTED`）**不是同一形状**。
// 离线取证（`tests/mpkg-video-codec-probe.mjs`）已排除"编解码器罕见"：那批 FKGM0014 全是
// **h264 / Constrained Baseline / yuv420p / 30s**，只是分辨率是 4K（3840×2160 一族）。
//
// 本探针用一个**不需要 WebGL** 的最小页面（Playwright 路由拦截提供 HTML 与视频字节，不碰仓库服务器），
// 把"页面那条路"与"浏览器能力"分开量：
//   V0 能力读数：`canPlayType('video/mp4; codecs="avc1.42E01E"')` / `MediaSource.isTypeSupported` / UA。
//   V1 页面原样：2×2 + opacity .01 + muted + loop + playsinline + Blob(type='video/mp4') + load() + play()。
//   V2 放大可见：同 V1 但 320×180 且 opacity 1 —— 区分"太小/不可见 ⇒ 不解码"这条假设。
//   V3 不 play()：只 load() —— 区分"自动播放被拦 ⇒ 连数据都不取"这条假设。
//   V4 参照物：ffmpeg 现场生成的 320×240 2s h264（同一 blob 路径）—— 它若也 rs=0，就是浏览器能力问题；
//      它若 rs=4，则问题只在"这个包的那段字节/那条路径"上。
//   V5 preload=auto：显式要求预载。
// 每个变体都记录**事件时间线**（loadstart/progress/suspend/stalled/loadedmetadata/error/…）与最终读数。
//
// 口径：一次只起一个浏览器（本仓库纪律）、有头优先（与扫面同口径）、内存有界（单条目字节，不整包入内存）、
//      临时文件写仓库 `reports/.tmp-video/`（`/tmp` 是 tmpfs 会吃内存）。读数不足 ⇒ 只打印读数，不下结论。
// 用法：node tests/mpkg-video-decode-probe.mjs [--pkg <abs.mpkg>] [--entry wallpaper.mp4] [--wait 12000] [--json <out>]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { ROOT, WS, TESTS } from './_root.mjs'
import { readIndexHead, readEntryBytes } from './_pkg-index.mjs'
import { launchGLBrowser, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/白洲梓/白洲梓1_10.mpkg')
const ENTRY_ARG = argVal('--entry')
const WAIT = +(argVal('--wait') || 12000)
const JSON_OUT = argVal('--json')
/* `--mozlog <file>`：把 Gecko 的媒体栈日志（MediaResource/MediaDecoder/MediaCache）落到文件。
   blob 档"没有错误、也没有数据"这种形状只能由浏览器自己说清楚（见本文件 §定性）。 */
const MOZLOG = argVal('--mozlog')

const require = createRequire(import.meta.url)
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP mpkg-video-decode  —— 找不到 playwright（tests/ 既有候选顺序：MPW_PLAYWRIGHT → 本仓 → 插件仓 → 全局）'); process.exit(0) }
const pw = require(pwPath)
const { firefox, chromium } = pw
/* `--browser chromium`：本探针**不需要 WebGL**（只量 `<video>`），所以可以换一个浏览器做**同机对照**：
   同一个 blob、同一段字节，若 Chromium 能解而 Firefox 不能 ⇒ 这是**那个 Firefox 构建**的问题，
   既不是我们的代码、也不是这台机器的文件/内存（这一对照是本探针结论的**必要条件**）。 */
const BROWSER = (argVal('--browser') || 'firefox').toLowerCase()

/* ── 取容器里的视频条目：**只读目录表 + 只读那一条**（内存有界），项目 json 的 file 优先 ── */
const idx = readIndexHead(PKG)
const pje = idx.entries.find((e) => e.name === 'project.json')
let vfile = ENTRY_ARG || ''
if (!vfile && pje) {
  try { const pj = JSON.parse(readEntryBytes(PKG, idx, pje).toString('utf8').replace(/^\uFEFF/, '')); vfile = pj.file || (pj.general && pj.general.file) || '' } catch {}
}
if (!vfile) vfile = (idx.entries.find((e) => /\.(mp4|webm|mov)$/i.test(e.name)) || {}).name || ''
const vent = idx.entries.find((e) => e.name === vfile)
if (!vent) { console.log('SKIP mpkg-video-decode  —— 容器内找不到视频条目（project.json.file=' + JSON.stringify(vfile) + '，条目=' + idx.entries.map((e) => e.name).join(',') + '）'); process.exit(0) }
const bytes = readEntryBytes(PKG, idx, vent)
console.log('== `<video>` 解码取证 ==')
console.log('· 包：' + path.relative(WS, PKG) + '  (' + (fs.statSync(PKG).size / 1048576).toFixed(1) + 'MB, ' + idx.entries.length + ' 条目)')
console.log('· 条目：' + vent.name + '  ' + (vent.size / 1048576).toFixed(1) + 'MB  · scene.json=' + idx.entries.some((e) => e.name === 'scene.json'))

/* ── 参照物：现场生成 320×240 2s h264（有界、~50KB）；ffmpeg 不可用就如实说"无参照物" ── */
const TMP = path.join(ROOT, 'reports', '.tmp-video')
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true })
let tiny = null
try {
  const ref = path.join(TMP, 'ref.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2',
    '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', ref], { timeout: 60000 })
  tiny = fs.readFileSync(ref)
  console.log('· 参照物：ffmpeg 生成的 320x240/2s/h264/baseline（' + (tiny.length / 1024).toFixed(0) + 'KB）')
} catch (e) { console.log('· 参照物：**不可用**（' + String((e && e.message) || e).slice(0, 80) + '）⇒ V4 会 SKIP') }

const HTML = `<!doctype html><meta charset="utf-8"><title>vidprobe</title><body style="margin:0;background:#222">
<div id="log" style="font:12px monospace;color:#ddd;white-space:pre-wrap"></div></body>`

const extra = MOZLOG ? { env: { MOZ_LOG: 'MediaResource:5,MediaDecoder:5,MediaCache:5,MediaChannel:5', MOZ_LOG_FILE: MOZLOG } } : {}
let browser = null, launchNote = ''
if (BROWSER === 'chromium') {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
  launchNote = 'chromium ' + String(pw.chromium.name ? '' : '') + (browser.version ? 'v' + browser.version() : '') + '（无头）'
} else {
  const r = await launchGLBrowser(firefox, extra)
  browser = r.browser; launchNote = r.launchNote
}
if (MOZLOG) { try { fs.rmSync(MOZLOG, { force: true }) } catch {} }
console.log('· 浏览器：' + launchNote)

const result = { pkg: PKG, entry: vent.name, entryBytes: vent.size, browser: BROWSER, launchNote, variants: [] }
try {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } })
  const page = await ctx.newPage()
  page.on('console', (m) => { const t = m.text(); if (/media|Media|decode|Decode/.test(t)) console.log('   [page] ' + t.slice(0, 160)) })
  await page.route('**/__vidprobe', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML }))
  await page.route('**/__vidbytes', (r) => r.fulfill({ contentType: 'video/mp4', body: bytes }))
  if (tiny) await page.route('**/__vidtiny', (r) => r.fulfill({ contentType: 'video/mp4', body: tiny }))
  await page.goto('http://127.0.0.1:8899/__vidprobe', { waitUntil: 'domcontentloaded' })

  const caps = await page.evaluate(() => ({
    ua: navigator.userAgent, engine: (typeof InstallTrigger !== 'undefined') ? 'firefox' : 'other',
    canPlayMp4: document.createElement('video').canPlayType('video/mp4'),
    canPlayAvc1: document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'),
    canPlayAvc1High: document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'),
    canPlayWebm: document.createElement('video').canPlayType('video/webm; codecs="vp9"'),
    mseAvc1: (typeof MediaSource !== 'undefined') ? MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"') : null,
  }))
  result.caps = caps
  console.log('· 能力位：canPlayType(mp4)=' + JSON.stringify(caps.canPlayMp4) + ' avc1.42E01E=' + JSON.stringify(caps.canPlayAvc1)
    + ' avc1.640028=' + JSON.stringify(caps.canPlayAvc1High) + ' webm/vp9=' + JSON.stringify(caps.canPlayWebm) + ' MSE=' + caps.mseAvc1)
  console.log('· UA：' + caps.ua.slice(0, 110))

  /**
   * 一个变体：建元素 → 挂 src → load(+play) → 轮询到稳定/超时 → 返回**原样读数**。
   * @param {string} name 变体名
   * @param {{url:string, css:string, opacity:number, play:boolean, preload:string, asBlob?:boolean}} o
   */
  const runVariant = async (name, o) => {
    const out = await page.evaluate(async ({ url, css, opacity, doPlay, preload, wait, asBlob }) => {
      const t0 = performance.now()
      /* 页面那条路：先 fetch 字节 → `new Blob([bytes], {type:'video/mp4'})` → `createObjectURL`。
         最小页面里 HTTP 直供能解（V1/V2/V3/V5 全 rs=4）⇒ 本变体专门量 **blob 这一层**。 */
      let blobNote = null
      if (asBlob) {
        try {
          const r = await fetch(url); const buf = await r.arrayBuffer()
          if (asBlob === 'response') {
            /* 上游缺陷单给的**可用**写法：`Response.blob()`（blob 由响应体流构造，而不是 `new Blob([buffer])`）。 */
            url = URL.createObjectURL(await new Response(buf, { headers: { 'Content-Type': 'video/mp4' } }).blob())
            blobNote = { via: 'new Response(buf).blob()', bytes: buf.byteLength }
          } else if (asBlob === 'dataurl') {
            /* `data:` 是**真 URL**（走 nsDataChannel，不经过 blob 的 IPC 流）⇒ 上游缺陷单的"换 URL"路线里
               唯一**不需要服务端配合**的那条。22MB → 约 30MB base64 字符串，内存有界但很重（读数里带耗时）。 */
            const u8 = new Uint8Array(buf); let bin = ''
            for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
            url = 'data:video/mp4;base64,' + btoa(bin)
            blobNote = { via: 'data:base64', bytes: buf.byteLength }
          } else if (asBlob === 'file') {
            url = URL.createObjectURL(new File([buf], 'v.mp4', { type: 'video/mp4' }))
            blobNote = { via: 'new File([buf])', bytes: buf.byteLength }
          } else {
            url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }))
            blobNote = { via: 'new Blob([buf])', bytes: buf.byteLength }
          }
        } catch (e) { blobNote = { err: String((e && e.message) || e).slice(0, 90) } }
      }
      const ev = []
      const v = document.createElement('video')
      v.style.cssText = css + ';opacity:' + opacity
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '')
      v.muted = true; v.loop = true; v.playsInline = true
      if (preload) v.preload = preload
      document.body.appendChild(v)
      const names = ['loadstart', 'progress', 'suspend', 'stalled', 'loadedmetadata', 'loadeddata', 'canplay',
        'canplaythrough', 'playing', 'waiting', 'error', 'emptied', 'abort', 'durationchange', 'resize']
      for (const n of names) v.addEventListener(n, () => ev.push([n, Math.round(performance.now() - t0)]))
      let playErr = null, playState = doPlay ? 'pending' : 'not-called'
      v.src = url
      v.load()
      /* **不 await**：真页面里 `play()` 的 promise 在"永远拿不到数据"时可以**永不 settle**（本探针踩过：
         `await v.play()` 把整个探针挂死 70s+）。改成记录三态：pending / ok / rejected。 */
      if (doPlay) {
        try { const p = v.play()
          if (p && typeof p.then === 'function') p.then(() => { playState = 'ok' }, (e) => { playState = 'rejected'; playErr = String((e && e.name) || '') + ': ' + String((e && e.message) || e).slice(0, 90) })
          else playState = 'ok'
        } catch (e) { playState = 'threw'; playErr = String((e && e.name) || '') + ': ' + String((e && e.message) || e).slice(0, 90) }
      }
      const snap = () => ({ rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight,
        dur: Number.isFinite(v.duration) ? +v.duration.toFixed(2) : null, ct: +v.currentTime.toFixed(2),
        err: v.error ? { code: v.error.code, msg: String(v.error.message || '').slice(0, 120) } : null })
      const ticks = []
      const tStart = performance.now()
      let firstNonZero = null
      while (performance.now() - tStart < wait) {
        await new Promise((r) => setTimeout(r, 400))
        const s = snap(); ticks.push([Math.round(performance.now() - tStart), s.rs, s.ns])
        if (firstNonZero === null && (s.rs > 0 || s.ns !== 1 || s.err)) firstNonZero = { at: Math.round(performance.now() - tStart), ...s }
        if (s.rs >= 4 || s.err) break
      }
      const final = snap()
      try { v.pause(); v.removeAttribute('src'); v.load() } catch {}
      v.remove()
      return { playErr, playState, blobNote, events: ev, firstNonZero, final, ticks: ticks.slice(0, 30),
        srcPrefix: String(url).slice(0, 24), endedAfterMs: Math.round(performance.now() - tStart) }
    }, { url: o.url, css: o.css, opacity: o.opacity, doPlay: o.play, preload: o.preload, wait: WAIT, asBlob: !!o.asBlob })
    const tag = 'rs=' + out.final.rs + ' ns=' + out.final.ns + ' ' + (out.final.w || '?') + 'x' + (out.final.h || '?')
      + ' dur=' + out.final.dur + ' err=' + (out.final.err ? (out.final.err.code + '/' + out.final.err.msg) : 'null')
    const evs = out.events.map(([n, t]) => n + '@' + t).join(',')
    console.log('  · ' + name.padEnd(22) + ' ⇒ **' + tag + '**' + '  play=' + out.playState + (out.playErr ? '(' + out.playErr + ')' : '')
      + (out.blobNote ? '  blob=' + JSON.stringify(out.blobNote) : ''))
    console.log('     事件：' + (evs || '（一个事件都没触发）') + (out.firstNonZero ? '  · 首次变化@' + out.firstNonZero.at + 'ms' : '  · 全程无变化'))
    result.variants.push({ name, ...out })
    return out
  }

  await runVariant('V1-HTTP直供(2x2)', { url: '/__vidbytes', css: 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;z-index:-1', opacity: 0.01, play: true, preload: '' })
  await runVariant('V6-blob页面原样(2x2)', { url: '/__vidbytes', css: 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;z-index:-1', opacity: 0.01, play: true, preload: '', asBlob: true })
  await runVariant('V7-blob放大(320x180)', { url: '/__vidbytes', css: 'width:320px;height:180px', opacity: 1, play: true, preload: '', asBlob: true })
  await runVariant('V2-HTTP放大(320x180)', { url: '/__vidbytes', css: 'width:320px;height:180px', opacity: 1, play: true, preload: '' })
  await runVariant('V3-HTTP只load不play', { url: '/__vidbytes', css: 'width:320px;height:180px', opacity: 1, play: false, preload: '' })
  await runVariant('V5-HTTP preload=auto', { url: '/__vidbytes', css: 'width:320px;height:180px', opacity: 1, play: true, preload: 'auto' })
  if (tiny) await runVariant('V4-HTTP参照物(小h264)', { url: '/__vidtiny', css: 'width:320px;height:240px', opacity: 1, play: true, preload: '' })
  if (tiny) await runVariant('V8-blob参照物(小h264)', { url: '/__vidtiny', css: 'width:320px;height:240px', opacity: 1, play: true, preload: '', asBlob: true })
  /* V9/V10：上游缺陷单（Bug 2056444）里"能用的两种写法"里，哪一种在我们这条路（字节来自容器、不是网络响应）也成立？
     能成立 ⇒ 一行改动就能绕开这个 Firefox 回归。 */
  await runVariant('V9-Response.blob(2x2)', { url: '/__vidbytes', css: 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;z-index:-1', opacity: 0.01, play: true, preload: '', asBlob: 'response' })
  await runVariant('V11-data URL(2x2)', { url: '/__vidbytes', css: 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;z-index:-1', opacity: 0.01, play: true, preload: '', asBlob: 'dataurl' })
  await runVariant('V10-File构造(2x2)', { url: '/__vidbytes', css: 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;z-index:-1', opacity: 0.01, play: true, preload: '', asBlob: 'file' })
  if (!tiny) result.variants.push({ name: 'V4-参照物(小h264)', skipped: 'ffmpeg 不可用' })

  /* 结论行：只在读数**足以定性**时才下结论（对照成立/不成立都写清楚）。 */
  const v1 = result.variants.find((v) => v.name.startsWith('V1'))
  const v6 = result.variants.find((v) => v.name.startsWith('V6'))
  const v7 = result.variants.find((v) => v.name.startsWith('V7'))
  const v2 = result.variants.find((v) => v.name.startsWith('V2'))
  const v4 = result.variants.find((v) => v.name.startsWith('V4'))
  const v8 = result.variants.find((v) => v.name.startsWith('V8'))
  const v9 = result.variants.find((v) => v.name.startsWith('V9'))
  const v10 = result.variants.find((v) => v.name.startsWith('V10'))
  const v11 = result.variants.find((v) => v.name.startsWith('V11'))
  const ok = (v) => v && v.final && v.final.rs >= 2
  console.log('· 定性：')
  console.log('  · 能力位 avc1：' + (caps.canPlayAvc1 ? '支持（' + caps.canPlayAvc1 + '）' : '**不支持**') + ' ⇒ ' + (caps.canPlayAvc1 ? '这不是"编解码器不支持"' : '**这就是根因：媒体栈不支持 H.264**'))
  if (v4 && v4.final) console.log('  · 参照物小 h264：' + (ok(v4) ? 'rs=' + v4.final.rs + ' ⇒ 浏览器**能**解 H.264（所以问题不在能力位）' : 'rs=' + v4.final.rs + ' ⇒ 连参照物都解不了 ⇒ 本机媒体栈/环境问题'))
  console.log('  · blob 这一层：2×2=' + (ok(v6) ? 'rs' + v6.final.rs : 'rs' + (v6 && v6.final.rs)) + ' / 320×180=' + (ok(v7) ? 'rs' + v7.final.rs : 'rs' + (v7 && v7.final.rs))
    + ' ⇒ ' + (ok(v6) || ok(v7) ? 'blob 路也能解（与 HTTP 直供无差别）' : '**blob 路解不出来**（HTTP 直供能解）⇒ 根因就在 `new Blob([...])`/`createObjectURL` 这一步或它的下游'))
  if (v8) console.log('  · 小参照物（14KB）走 blob：rs=' + v8.final.rs + ' ⇒ ' + (v8.final.rs >= 2 ? '**小 blob 能解、大 blob 不能 ⇒ 与体积相关**' : '**连 14KB 的 blob 也解不了 ⇒ blob 这条路整体不通（与体积无关）**'))
  console.log('  · 绕开写法：`Response.blob()`=' + (v9 ? 'rs' + v9.final.rs : 'n/a') + ' / `new File([buf])`=' + (v10 ? 'rs' + v10.final.rs : 'n/a')
    + ' / data URL=' + (v11 ? 'rs' + v11.final.rs + '（' + (v11.endedAfterMs / 1000).toFixed(1) + 's）' : 'n/a')
    + ' ⇒ ' + ((v9 && v9.final.rs >= 2) ? '**`Response.blob()` 在本条路也成立（一行可绕开）**' : ((v10 && v10.final.rs >= 2) ? '**`new File([buf])` 成立（一行可绕开）**' : ((v11 && v11.final.rs >= 2) ? '**只有 `data:` URL 成立 ⇒ 可在 `rs` 久等不到时回落到 data URL（不需要服务端改）**' : '三种写法都不成立 ⇒ 要绕开只能改"视频从哪来"（服务端按条目供流）'))))
  console.log('  · 同一个包同一段字节：2×2 不可见=' + (ok(v1) ? 'rs' + v1.final.rs : 'rs' + (v1 && v1.final.rs)) + ' / 320×180 可见=' + (ok(v2) ? 'rs' + v2.final.rs : 'rs' + (v2 && v2.final.rs))
    + ' ⇒ ' + (ok(v2) && !ok(v1) ? '**"太小/不可见 ⇒ 不解码"成立**' : (ok(v1) && ok(v2) ? '两个都出数据 ⇒ 与可见性无关' : '两个都不出数据 ⇒ 与可见性无关（另有原因）')))
  await ctx.close()
} finally {
  await closeQuiet(browser)
  fs.rmSync(TMP, { recursive: true, force: true })
}
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(result, null, 1)); console.log('· 读数已落盘：' + JSON_OUT) }
console.log('DONE mpkg-video-decode（本探针不下"修好了"的结论，只给原样读数与定性；事件时间线在上）')

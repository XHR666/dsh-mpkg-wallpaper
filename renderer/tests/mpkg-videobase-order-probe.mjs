// mpkg-videobase-order-probe.mjs —— 任务④ 挖出的**产品级缺陷**取证：`__videoBase`（"视频作最底层 + 场景层叠加"）
// 块在 `scene` 还是 `null` 的时候执行 ⇒ 恒抛 `TypeError: can't access property "general", scene is null`
// ⇒ 被 `catch` 吞成一行 `⚠ 视频底层失败: …` ⇒ **视频底层从来没被加上过**（60 个 PKGM0014 全中）。
//
// 事实链（全部可复算，不靠推断）：
//   · `demo.html:1751`  `let renderer = null, scene = null, pkg = null, textures = new Map(), …`
//   · `demo.html:2843-2869`  视频底层块：`const g0 = scene.general || {}` / `scene.layers.unshift({…'__videoBase'…})`
//   · `demo.html:3442-3443`  `scene = lib.parseScene(sceneObj, …)` ← **在这块之后 ~580 行**
//   ⇒ 该块必然抛（`scene` 仍是 null），只会写一行 `⚠ 视频底层失败: …`，页面对此**没有任何门禁**。
//
// 本探针做两件事（HIDE_SHELL 后量画布，避免外壳污染读数 —— 口径同 `mpkg-sweep-test.mjs`）：
//   A. **原样**：跑一次，抓那行真错误文本 + `<video>` 读数（rs=0/ns=1）+ 画布读数（应当只剩清屏色）；
//   B. **搬到 parseScene 之后**：用 Playwright 的 `page.route()` 在**内存里**改写页面（**不碰仓库文件**），
//      把同一段块搬到 `scene = lib.parseScene(...)` 之后 ⇒ 应当出现 `🎬 视频底层已加入`、`<video>` rs≥2、
//      `__sceneLayers.length` +1、画布出现视频画面。
//      B 成立即证明：**最小修法 = 把这段块下移到 parseScene 之后**（一行位置问题，不是解码/容器/内存问题）。
//
// 口径：有头优先 + 能力前置 + 无 GL ⇒ SKIP（`tests/_gl-browser.mjs`）。
// 用法：node tests/mpkg-videobase-order-probe.mjs [--pkg <abs.mpkg>] [--res 720p] [--out <file>]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { WS, TESTS } from './_root.mjs'
import { launchGLBrowser, glCapability, glReading, logGLSkip, glSkipWhy, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const AUTHORITY = argVal('--authority') || process.env.MPW_SWEEP_AUTHORITY || '127.0.0.1:8902'
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/佩丽卡/佩丽卡1_10.mpkg')
const RES = argVal('--res') || '720p'   /* 视频档位：画布/上传都压住，别让 1080p 白烧内存 */
const OUT = argVal('--out') || path.join(TESTS, 'mpkg-videobase-order.json')

const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP videobase-order —— 找不到 playwright'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP videobase-order —— playwright 没有 firefox 导出'); process.exit(0) }

const READ = () => {
  const log = (() => { try { return String(document.getElementById('log').textContent || '') } catch (e) { return '' } })()
  const v = document.querySelector('video')
  const ls = (() => { try { return Array.isArray(window.__sceneLayers) ? window.__sceneLayers.length : null } catch (e) { return null } })()
  return {
    firstFrame: !!window.__mpwFirstFrame,
    layers: ls,
    video: v ? { rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight, err: v.error ? v.error.code : null, ct: +v.currentTime.toFixed(2) } : null,
    logHits: (log.match(/(🎬[^\n]*|⚠ 视频底层失败[^\n]*|✅ 首帧完成[^\n]*|scene\.json 解析: [^\n]*)/g) || []).slice(0, 6).map((s) => s.slice(0, 160)),
  }
}
const HIDE_SHELL = () => { for (const el of [...document.body.children]) { if (el.tagName === 'CANVAS' || el.tagName === 'VIDEO') continue; if (el.querySelector && el.querySelector('canvas')) continue; el.style.display = 'none' } return true }

/** 把视频底层块搬到 `scene = lib.parseScene(...)` 之后（纯字符串搬移；只对**内存里的响应体**生效）。 */
function moveVideoBaseBlock(html) {
  const endMark = "  } catch (e) { logf('⚠ 视频底层失败: ' + e.message) }"
  const startMark = '//   名字 `__videoBase` 不命中任何隐藏规则（UI/提示框/纯色条），层序 0 = 最先绘制。'
  const anchor = '  // ①(2026-09-21 宿主调试面) 把图层数组发布到 `window.__sceneLayers`'
  const eIdx = html.indexOf(endMark), sIdx = html.indexOf(startMark)
  if (eIdx < 0 || sIdx < 0) return { ok: false, why: '找不到块边界（endMark=' + (eIdx >= 0) + ' startMark=' + (sIdx >= 0) + '）' }
  const tIdx = html.indexOf('  try {', sIdx)
  if (tIdx < 0) return { ok: false, why: '找不到 try {' }
  const block = html.slice(tIdx, eIdx + endMark.length)
  const rest = html.slice(0, tIdx) + html.slice(eIdx + endMark.length)
  const aIdx = rest.indexOf(anchor)
  if (aIdx < 0) return { ok: false, why: '找不到插入锚点（__sceneLayers 发布处）' }
  return { ok: true, html: rest.slice(0, aIdx) + block + '\n' + rest.slice(aIdx), blockBytes: block.length }
}

const PIXELS = async (page, probe) => {
  let box = null
  try { box = await page.locator('#sc').first().boundingBox() } catch (e) { box = null }
  if (!box || box.width < 2) return { err: '没有可截的画布盒' }
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
    return { w: c.width, h: c.height, meanL: +mean.toFixed(3), maxL: +max.toFixed(1), stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3), litFrac: +(lit / n).toFixed(5) }
  }, 'data:image/png;base64,' + buf.toString('base64')).catch((e) => ({ err: String((e && e.message) || e).slice(0, 140) }))
}

const { browser, launchNote } = await launchGLBrowser(firefox)
const results = []
try {
  const gl = await glCapability(browser)
  if (!gl.webgl2) { logGLSkip('videobase 顺序取证', launchNote, gl); glSkipWhy(); await closeQuiet(browser); process.exit(0) }
  console.log('== __videoBase 顺序取证 ==')
  console.log('   包 : ' + PKG)
  console.log('   GL : ' + glReading(launchNote, gl))
  const probeCtx = await browser.newContext({ viewport: { width: 400, height: 300 } })
  const probe = await probeCtx.newPage(); await probe.goto('about:blank')

  for (const variant of ['as-is', 'moved']) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)))
    let patchInfo = { applied: false }
    if (variant === 'moved') {
      await page.route('**/webloader/**', async (route) => {
        try {
          const resp = await route.fetch()
          const body = await resp.text()
          const p = moveVideoBaseBlock(body)
          patchInfo = { applied: !!p.ok, why: p.why || null, blockBytes: p.blockBytes || 0 }
          if (!p.ok) return route.fulfill({ response: resp, body })
          return route.fulfill({ response: resp, body: p.html })
        } catch (e) { patchInfo = { applied: false, why: String((e && e.message) || e).slice(0, 160) }; return route.continue() }
      })
    }
    const url = 'http://' + AUTHORITY + '/webloader/?type=scene&id=videobase-probe&res=' + RES + '&_t=' + Date.now() + '&pkgpath=' + encodeURIComponent(PKG)
    let st = null, px = null
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      /* 首帧 → 再等 `<video>` 拿到数据（最多 25s，有界） */
      for (let i = 0; i < 10; i++) { await page.waitForTimeout(1500); st = await page.evaluate(READ); if (st.firstFrame) break }
      const tv = Date.now()
      for (;;) {
        await page.waitForTimeout(1500)
        st = await page.evaluate(READ)
        if ((st.video && (st.video.rs >= 2 || st.video.err)) || Date.now() - tv > 25000) break
      }
      await page.evaluate(HIDE_SHELL)
      await page.waitForTimeout(700)
      px = await PIXELS(page, probe)
    } catch (e) { pageErrors.push('探针级异常: ' + String((e && e.message) || e).slice(0, 160)) }
    await ctx.close().catch(() => {})
    results.push({ variant, patchInfo, state: st, pixel: px, pageErrors })
    console.log('\n── ' + variant + (variant === 'moved' ? '（内存内搬移：' + JSON.stringify(patchInfo) + '）' : '') + '')
    console.log('   读数: ' + JSON.stringify({ layers: st && st.layers, video: st && st.video, pixel: px }))
    console.log('   日志: ' + JSON.stringify((st && st.logHits) || []))
    if (pageErrors.length) console.log('   pageerror: ' + JSON.stringify(pageErrors.slice(0, 2)))
  }
  await probeCtx.close().catch(() => {})
} finally { await closeQuiet(browser) }

console.log('\n== 判据 ==')
const a = results.find((r) => r.variant === 'as-is') || {}, b = results.find((r) => r.variant === 'moved') || {}
const av = (a.state && a.state.video) || {}, bv = (b.state && b.state.video) || {}
console.log('· A 原样   ：video rs=' + av.rs + ' ns=' + av.ns + ' 层=' + (a.state && a.state.layers) + ' 画布 meanL=' + (a.pixel && a.pixel.meanL) + ' stdL=' + (a.pixel && a.pixel.stdL))
console.log('· B 搬移后 ：video rs=' + bv.rs + ' ns=' + bv.ns + ' ' + (bv.w || '?') + 'x' + (bv.h || '?') + ' 层=' + (b.state && b.state.layers) + ' 画布 meanL=' + (b.pixel && b.pixel.meanL) + ' stdL=' + (b.pixel && b.pixel.stdL))
const hitA = ((a.state && a.state.logHits) || []).some((s) => /视频底层失败/.test(s))
const hitB = ((b.state && b.state.logHits) || []).some((s) => /视频底层已加入/.test(s))
console.log('· A 里出现 `⚠ 视频底层失败` = ' + hitA + '；B 里出现 `🎬 视频底层已加入` = ' + hitB + '；B 的视频 rs≥2 = ' + (bv.rs >= 2))
console.log(hitA && hitB && bv.rs >= 2
  ? '⇒ 定性：**真缺陷（顺序错）**，最小修法 = 把该 try 块移到 `scene = lib.parseScene(...)` 之后（B 已实证可修）'
  : '⇒ 读数不足以定性（见上面原始读数；不要据此改产品）')
try { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), pkg: PKG, res: RES, launchNote, results }, null, 1)); console.log('读数已落盘: ' + OUT) } catch (e) { console.log('⚠ 落盘失败: ' + e.message) }
process.exit(0)

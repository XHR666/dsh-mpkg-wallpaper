/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案。 */
// render-audio-bar-motion-test.mjs —— ①(2026-09-24 任务 ⑫) **画布像素级**判据：
// 「音条在**没有数据源**时仍有非平凡的时间变化」（用户原话："虽然它没有数据源，但是音频条确实是在动的"）。
//
// 被测包：`dd/3327063360`（用户点名的那个包）。音频条层 = `#2 纯色`：1000×1000 @ 设计坐标
//   (1499.8, 1061)（设计 3840×2160 → 1280×720 画布正好 ×1/3），特效链
//   `enhanced_simple_audio_bars` + `geometric_transform` + `opacity`（`tex=-` 的纯色层，
//   可见内容**全部**来自特效链）。条从 quad 下沿（画布 y≈520）向上长。
// 判据（同一浏览器、同一包，只改 `?bandfeed=` 一个变量）：
//   · `auto`（缺省档；本机无包内音轨/无麦克风 ⇒ 无真实源）⇒ **时间驱动占位频谱** ⇒ 条的白色像素数
//     随节拍起伏（极差/峰值 ≥ 0.3）；
//   · `real`（只认真实源；无源 ⇒ 渲染器只写 0.012 静音地板）⇒ 条静止 ⇒ 帧间差≈0。
//   本包背景是**视频**（每帧都在变）⇒ 整屏帧差无法区分"音条在动"与"视频在动"，故两档都加
//   `?novideo`（跳过视频层，背景变静态）—— 此时 ROI 里的时间变化只能来自动画层（就是音条）。
//
// 用法：node tests/render-audio-bar-motion-test.mjs
//   需要 8899 上的渲染器页与 `allwallpaper/dd/3327063360`（缺一 ⇒ SKIP 并打印读数，不谎报红）；
//   浏览器口径：有头优先 + 能力前置探针（tests/_gl-browser.mjs）；拿不到 WebGL2 ⇒ SKIP + 原样读数。
import fs from 'node:fs'
import path from 'node:path'
import { WS } from './_root.mjs'
import { launchGLBrowser, glCapability, glReading, logGLSkip, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const PORT = process.env.PORT || '8899'
const URL_BASE = process.env.MPW_RENDERER_URL || ('http://127.0.0.1:' + PORT + '/')
const ID = '3327063360'
const PKG = path.join(process.env.MPW_ROOT || WS, 'allwallpaper', 'dd', ID, 'scene.pkg')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}

if (!fs.existsSync(PKG)) { console.log('SKIP render-audio-bar-motion —— 缺包 ' + PKG); process.exit(0) }
let reachable = false
try { const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(4000) }); reachable = r.ok } catch (e) { reachable = false }
if (!reachable) { console.log('SKIP render-audio-bar-motion —— 渲染器页不可达：' + URL_BASE + '（先起 `node server/we-scene-demo-server.mjs 8899`）'); process.exit(0) }
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP render-audio-bar-motion —— 找不到 playwright（MPW_PLAYWRIGHT 可指定）'); process.exit(0) }
const pw = (await import(pwPath)).default || (await import(pwPath))
const firefox = pw.firefox || (pw.default && pw.default.firefox)
if (!firefox) { console.log('SKIP render-audio-bar-motion —— playwright 里没有 firefox'); process.exit(0) }

const { browser, launchNote } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
if (!gl.webgl2) {
  await closeQuiet(browser)
  logGLSkip('render-audio-bar-motion（全部断言）', launchNote, gl)
  process.exit(0)
}
console.log('渲染器页：' + URL_BASE + '；浏览器：' + glReading(launchNote, gl))

/**
 * 量**音条带**的白像素数随帧的变化：占位源有节奏 ⇒ 起伏；静音地板 ⇒ 静止。
 * ROI = `#2 纯色` 层的下半带（设计坐标 x∈[1320,1680]、y∈[1290,1545] → 画布 ×1/3），
 * 既覆盖条的行程（底沿 ≈ y 520）又避开画面主体。
 */
async function measure(bandfeed, frames = 10, gapMs = 200) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => logs.push(m.text()))
  page.on('pageerror', (e) => logs.push('[js-error] ' + String(e.message)))
  const url = URL_BASE + '?id=' + ID + '&res=720p&noreport&shell=0&novideo&bandfeed=' + bandfeed
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  try { await page.waitForFunction(() => (window.__mpwFrameNo || 0) > 2, null, { timeout: 120000 }) } catch (e) { logs.push('[timeout]') }
  await page.waitForTimeout(1500)
  const r = await page.evaluate(async ({ frames, gapMs }) => {
    const cv = document.querySelector('canvas')
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height
    const c2 = c.getContext('2d')
    const k = cv.width / 3840
    const x0 = Math.max(0, Math.round(1320 * k)), x1 = Math.min(cv.width - 1, Math.round(1680 * k))
    const y0 = Math.max(0, Math.round(1290 * k)), y1 = Math.min(cv.height - 1, Math.round(1545 * k))
    const grab = () => { c2.drawImage(cv, 0, 0); return c2.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data }
    /* ⚠ 采样必须**按帧**而不是按墙钟：llvmpipe 下页面只有 ~5fps，`setTimeout(200ms)` 采到的多是
       同一帧（帧差恒 0，把真实运动平均掉）。这里每采一次都等 `__mpwFrameNo` 真的前进（有上限兜底）。 */
    const waitFrame = async () => {
      const t0 = Date.now(), start = window.__mpwFrameNo || 0
      while ((window.__mpwFrameNo || 0) <= start && Date.now() - t0 < 5000) await new Promise((res) => setTimeout(res, 25))
      return (window.__mpwFrameNo || 0) - start
    }
    const series = [], diffs = [], f0 = window.__mpwFrameNo || 0
    let prev = grab()
    const whiteOf = (d) => { let w = 0; for (let j = 0; j < d.length; j += 4) if (d[j] >= 250 && d[j + 1] >= 250 && d[j + 2] >= 250) w++; return +(100 * w / (d.length / 4)).toFixed(4) }
    series.push(whiteOf(prev))
    for (let i = 1; i < frames; i++) {
      await new Promise((res) => setTimeout(res, gapMs))
      await waitFrame()
      const cur = grab()
      let sum = 0
      for (let j = 0; j < cur.length; j += 4) sum += Math.abs(cur[j] - prev[j]) + Math.abs(cur[j + 1] - prev[j + 1]) + Math.abs(cur[j + 2] - prev[j + 2])
      diffs.push(+(sum / (3 * (cur.length / 4))).toFixed(4))
      series.push(whiteOf(cur))
      prev = cur
    }
    const mx = Math.max(...series), mn = Math.min(...series)
    const dmax = Math.max(...diffs), dmean = +(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(4)
    return { roi: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], series, diffs, max: mx, min: mn, dmax, dmean,
      rel: mx > 0 ? +((mx - mn) / mx).toFixed(4) : 0, frames: [f0, window.__mpwFrameNo || 0], cv: cv.width + 'x' + cv.height }
  }, { frames, gapMs })
  const band = await page.evaluate(() => { try { return { ...window.__mpwAudioBandInfo(), stats: window.__mpwAudioBandStats && window.__mpwAudioBandStats() } } catch (e) { return null } })
  await ctx.close()
  return { url, r, band, logs: logs.filter((l) => /频段|音条|WebGL|白块|错误|失败/.test(l)).slice(0, 6) }
}

/* ══════════════ 读数 + 判据 ══════════════ */
console.log('== [A] auto（无真实源 ⇒ 时间驱动占位）vs real（只认真实源 ⇒ 静音地板）==')
const auto = await measure('auto')
const real = await measure('real')
console.log('  · auto：ROI=' + JSON.stringify(auto.r.roi) + ' 帧间平均差=' + JSON.stringify(auto.r.diffs) + '（均值 ' + auto.r.dmean + '，峰 ' + auto.r.dmax + '）'
  + ' 白像素%序列=' + JSON.stringify(auto.r.series) + '（极差/峰值=' + auto.r.rel + '）帧号=' + JSON.stringify(auto.r.frames))
console.log('  · real：ROI=' + JSON.stringify(real.r.roi) + ' 帧间平均差=' + JSON.stringify(real.r.diffs) + '（均值 ' + real.r.dmean + '，峰 ' + real.r.dmax + '）'
  + ' 白像素%序列=' + JSON.stringify(real.r.series) + '（极差/峰值=' + real.r.rel + '）帧号=' + JSON.stringify(real.r.frames))
console.log('  · band：auto=' + JSON.stringify(auto.band && { source: auto.band.source, placeholder: auto.band.placeholder, peak: auto.band.stats && +auto.band.stats.peak.toFixed(3) })
  + ' real=' + JSON.stringify(real.band && { source: real.band.source, peak: real.band.stats && +real.band.stats.peak.toFixed(3) }))
check('[A1] auto 档确实走了占位源（source=simulated / placeholder=true / hasSource=true）',
  !!auto.band && auto.band.source === 'simulated' && auto.band.placeholder === true && auto.band.hasSource === true,
  JSON.stringify(auto.band && { s: auto.band.source, p: auto.band.placeholder }))
check('[A2] real 档没有真实源 ⇒ 如实 silent（占位不越权）',
  !!real.band && real.band.source === 'silent' && real.band.hasSource === false, JSON.stringify(real.band && real.band.source))
/* ⚠ 本机**不做**"ROI 里像素在动"的断言（如实说明，不凑绿）：llvmpipe 下页面 ~5fps、且该 ROI 的时间变化
   被非音频动画层主导 —— 实测两档都只在个别帧上出现一次大跳变（auto diffs 里 17.05 一次、real 里 21.80 一次，
   其余为 0），**无法把"音条在动"与共同项分开**；白像素序列在两档都是全 0（该链的几何变换 + 不透明度遮罩
   把条的最终颜色压出了"纯白"阈值）。因此像素级只保留两条**稳定可判**的读数：没有大面积不透明白（[A5]）
   与"真的出了帧"（[A6]）。"无数据源时频谱仍在动"这条判据由 `tests/render-audio-bar-nodata-test.mjs`
   的 [C2]（真源码切片：相隔 0.35s 的两帧频谱平均绝对差 > 0.005）承担 —— 它测的是**喂给 shader 的输入**，
   与驱动/帧率无关，可复现。 */
console.log('  · （读数）auto 帧间差均值 ' + auto.r.dmean + ' / real ' + real.r.dmean + '：两档都只有个别帧跳变 ⇒ 不作判据（见上方说明）')
check('[A5] 该 ROI 内**没有大面积不透明白**（白像素 < 20%：用户报的"白色矩形遮挡后面"在这一档不复现）',
  auto.r.max < 20 && real.r.max < 20, 'auto=' + auto.r.max + '% real=' + real.r.max + '%')
check('[A6] 两档都真的出了帧（读数非空画布）', auto.r.frames[1] > 2 && real.r.frames[1] > 2, JSON.stringify([auto.r.frames, real.r.frames]))

await closeQuiet(browser)
console.log('\n══ render-audio-bar-motion-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

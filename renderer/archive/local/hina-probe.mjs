// hina-probe.mjs — 单页渲染取证探针（Playwright/Chromium SwiftShader）
//   用法: node hina-probe.mjs "<url>" [outPng] [waitMs] [w] [h]
//   输出: JSON（日志尾部、layerLedger、layerHealth、frames 探针、像素统计）
//   用途: 复现 hina 3554161528 "整屏白/灰" 与逐层跳过取证（P-55）。只读，不改任何渲染代码。
import fs from 'node:fs'

const url = process.argv[2] || 'http://127.0.0.1:8899/?id=3554161528'
const out = process.argv[3] || '/tmp/hina-probe.png'
const waitMs = Number(process.argv[4] || 8000)
const W = Number(process.argv[5] || 640)
const H = Number(process.argv[6] || 360)
const PW = '/root/Desktop/DSHarea/dsh-mpkg-wallpaper/node_modules/playwright/index.mjs'

const { chromium } = await import(PW)
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-process-crash-limit', '--js-flags=--max-old-space-size=768']
const browser = await chromium.launch({ args, timeout: 60_000 })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const logs = []
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()))
page.on('pageerror', (e) => logs.push('[js-error] ' + e.message))
page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url().slice(0, 120) + ' ' + (r.failure() && r.failure().errorText)))

await page.goto(url, { waitUntil: 'commit', timeout: 120_000 }).catch((e) => logs.push('[goto] ' + e.message))
await page.waitForTimeout(waitMs)

let data = {}
try {
  data = await page.evaluate(() => {
  const cv = document.getElementById('sc')
  let stats = null
  try {
    const gl = cv.getContext('webgl2')
    const px = new Uint8Array(cv.width * cv.height * 4)
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let white = 0, black = 0, grey = 0, opaque = 0
    const hist = {}
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3]
      if (a > 16) opaque++
      if (r > 245 && g > 245 && b > 245) white++
      if (r < 10 && g < 10 && b < 10) black++
      if (Math.abs(r - 128) < 12 && Math.abs(g - 128) < 12 && Math.abs(b - 128) < 12) grey++
      const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4)
      hist[k] = (hist[k] || 0) + 1
    }
    const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 5)
    stats = { w: cv.width, h: cv.height, whitePct: +(white / (cv.width * cv.height) * 100).toFixed(1),
      blackPct: +(black / (cv.width * cv.height) * 100).toFixed(1), greyPct: +(grey / (cv.width * cv.height) * 100).toFixed(1),
      opaquePct: +(opaque / (cv.width * cv.height) * 100).toFixed(1), topBuckets: top }
  } catch (e) { stats = { err: String(e && e.message) } }
  return {
    stats,
    ledger: window.__mpwLayerLedger || null,
    frames: (window.__mpwFrames || []).slice(-3),
    meshSkip: window.__mpwMeshSkip || null,
    glErrs: window.__mpwGlErrs || null,
    ctx: window.__mpwCtx || null,
    cap: (window.__mpwCap && window.__mpwCap()) || null,
    log: (document.getElementById('log') || {}).textContent || '',
    readyState: document.readyState,
    hasCanvas: !!document.getElementById('sc'),
    canvasSize: document.getElementById('sc') ? document.getElementById('sc').width + 'x' + document.getElementById('sc').height : null,
    hasCap: !!window.__mpwCap,
  }
  })
} catch (e) { logs.push('[evaluate] ' + e.message) }
await page.screenshot({ path: out }).catch((e) => logs.push('[shot] ' + e.message))
await browser.close()

const log = String(data.log || '')
const pick = (re) => (log.match(re) || [])
const out2 = {
  url, ok: true,
  stats: data.stats,
  ctx: data.ctx,
  glErrs: data.glErrs,
  meshSkip: data.meshSkip,
  frames: data.frames,
  hdrLines: pick(/\[hdr\][^\n]*/g),
  skipLines: pick(/跳过[^\n]*/g).slice(0, 45),
  fx0Lines: pick(/\[fx0\][^\n]*/g).slice(0, 20),
  layerCountLine: pick(/首帧\] 层循环结束[^\n]*/g),
  firstFrame: pick(/✅ 首帧完成[^\n]*/g),
  ledger: data.ledger,
  pageErrors: logs.filter((l) => /js-error|reqfail|error/i.test(l)).slice(0, 20),
  logTail: log.split('\n').slice(-40),
  readyState: data.readyState, hasCanvas: data.hasCanvas, canvasSize: data.canvasSize, hasCap: data.hasCap,
  consoleLogs: logs.slice(-40),
}
fs.writeFileSync(out.replace(/\.png$/, '') + '.json', JSON.stringify(out2, null, 1))
console.log(JSON.stringify(out2, null, 1))

// mpkg-solidlayer-fallback-probe.mjs —— 任务⑤：定性 `wallpapertest1_…alone_孤独の少女…mpkg` 的
// `[TRANSPARENT_FALLBACK] 纯色`（`package-matrix --write-baseline` 重定基时标出来的那条）
//
// 背景（口径来自 `tests/package-matrix.mjs` 的 `auditPkg`，**不是猜的**）：
//   `TRANSPARENT_FALLBACK` 的 detail **是层名**，不是"整屏纯色"。mock GL 只做一件事：`texImage2D` 时若上传的是
//   1×1 且四通道全 0 ⇒ 给那张纹理打 `__solid='transparent'`（全 255 ⇒ `'white'`）；`drawArrays` 时看当前 tex0
//   的标记 ⇒ 落到 `transparentDrawn` ⇒ 报 `[TRANSPARENT_FALLBACK] 纯色`。所以"纯色"这三个字 = 场景里那个**名叫
//   「纯色」的层**在 Node mock GL 下画的时候绑的是 `transparentTex`。
//
// 本探针要回答的两问（任务书原文）：
//   ① 画布是否**真的**纯色？（真机：`?ln=<该层下标>` 只留这一层 + 整场景各抓一帧，量 `meanL/maxL/stdL/litFrac`）
//   ② 它是否落在**既有的透明/纯色兜底设计路径**上？（`?whitefallback=1` A/B + `core` 里的判据原文）
//
// 口径：照抄 `tests/_gl-browser.mjs`（**有头优先** + 能力前置 + 无 GL ⇒ SKIP + 原样读数，不假红/不假绿）。
// 用法：
//   node tests/mpkg-solidlayer-fallback-probe.mjs                 # 默认包 = wallpaperE/other 的 alone 副本
//   node tests/mpkg-solidlayer-fallback-probe.mjs --pkg <abs.mpkg> --layer 纯色
//   --authority 127.0.0.1:8902 · --out tests/mpkg-solidlayer-fallback.json
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { WS, TESTS } from './_root.mjs'
import { launchGLBrowser, glCapability, glReading, logGLSkip, glSkipWhy, closeQuiet, findPlaywright } from './_gl-browser.mjs'
import { readIndexHead, readSceneJsonText } from './_pkg-index.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const AUTHORITY = argVal('--authority') || process.env.MPW_SWEEP_AUTHORITY || '127.0.0.1:8902'
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/other/夜莺night——【time_variation_时间变化】alone_孤独の少女【原画：rella].mpkg')
const LAYER = argVal('--layer') || '纯色'
const OUT = argVal('--out') || path.join(TESTS, 'mpkg-solidlayer-fallback.json')

/* ── 离线结构读数（不占内存：目录表 + 那一条 scene.json）──────────────────────────────────── */
const offline = () => {
  const o = { pkg: PKG, exists: fs.existsSync(PKG), mb: null, magic: null, entries: null, hasScene: false, sceneLayers: null, layer: null, layerIdx: null }
  try { o.mb = +(fs.statSync(PKG).size / 1048576).toFixed(1) } catch (e) { return o }
  try {
    const idx = readIndexHead(PKG)
    o.magic = idx.magic; o.entries = idx.count
    o.hasScene = idx.entries.some((x) => /(^|\/)scene\.json$/i.test(x.name))
    o.hasVideoEntry = idx.entries.some((x) => /\.(mp4|webm|mov)$/i.test(x.name))
    o.hasSolidLayerModel = idx.entries.some((x) => /solidlayer/i.test(x.name))
    o.hasUtilModel = idx.entries.some((x) => /^models\/util\//.test(x.name))
  } catch (e) { o.err = String(e.message).slice(0, 120) }
  if (o.hasScene) {
    try {
      const j = JSON.parse(readSceneJsonText(PKG))
      const objs = j.objects || []
      o.sceneLayers = objs.length
      const i = objs.findIndex((x) => String(x.name || '') === LAYER)
      o.layerIdx = i
      if (i >= 0) {
        const L = objs[i]
        o.layer = {
          name: L.name, image: L.image, hasColorField: Object.prototype.hasOwnProperty.call(L, 'color'),
          color: L.color === undefined ? '(无 color 字段 ⇒ WE 语义 = 白 1 1 1)' : L.color,
          colorBlendMode: L.colorBlendMode, size: L.size, scale: L.scale, origin: L.origin,
          visible: L.visible, effects: (L.effects || []).map((e) => e.file),
          particle: typeof L.particle === 'object' ? '(inline def)' : (L.particle || null),
          hasParent: Object.prototype.hasOwnProperty.call(L, 'parent'),
        }
      }
      /* 同场景里还有几层用 `models/util/solidlayer.json`（对照：别的纯色层有没有也被标） */
      o.solidLayerNames = objs.filter((x) => typeof x.image === 'string' && x.image.indexOf('models/util/solidlayer') === 0).map((x) => x.name)
      o.clearColor = (j.general && j.general.clearcolor) || null
      o.clearenabled = j.general && j.general.clearenabled
    } catch (e) { o.err = (o.err ? o.err + ' · ' : '') + 'scene.json: ' + String(e.message).slice(0, 120) }
  }
  return o
}
const off = offline()

console.log('== 任务⑤ 定性 `[TRANSPARENT_FALLBACK] ' + LAYER + '` · 离线结构 ==')
console.log(JSON.stringify(off, null, 1))

/* ── 真机阶段 ─────────────────────────────────────────────────────────────────────────────── */
const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP mpkg-solidlayer-fallback —— 找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP mpkg-solidlayer-fallback —— playwright 没有 firefox 导出'); process.exit(0) }

const READ_STATE = (layerName) => {
  const g = (k) => { try { return window[k] } catch (e) { return null } }
  const ls = g('__sceneLayers')
  const cv = document.getElementById('sc') || document.querySelector('canvas')
  const logTxt = (() => { try { const el = document.getElementById('log'); return el ? String(el.textContent || '') : '' } catch (e) { return '' } })()
  const idx = Array.isArray(ls) ? ls.findIndex((l) => String((l && l.name) || '') === layerName) : -1
  const L = (idx >= 0 && ls[idx]) || null
  const ts = Array.isArray(g('__mpwTexStats')) ? g('__mpwTexStats') : null
  return {
    canvas: cv ? { w: cv.width, h: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight } : null,
    layers: Array.isArray(ls) ? ls.length : null,
    layerIdx: idx,
    layer: L ? {
      name: L.name, image: L.image, solid: L.solid, isContainer: L.isContainer,
      color: L.color, textureName: L.textureName || null, visible: L.visible,
      size: L.size, scale: L.scale, origin: L.origin, effects: (L.effects || []).length,
    } : null,
    texStats: ts ? ts.length : null,
    texStatsSolid: ts ? ts.filter((e) => /solid/i.test(String(e.n || ''))) : null,
    bootError: g('__mpwBootError') || null,
    firstFrame: !!g('__mpwFirstFrame'),
    logFatal: (logTxt.match(/❌/g) || []).length,
    logWarn: (logTxt.match(/⚠/g) || []).length,
    logTail: logTxt.trim().split('\n').slice(-10).map((s) => s.slice(0, 220)),
  }
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
    const hist = new Map()
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      sum += L; sum2 += L * L; if (L > max) max = L; if (L > 16) lit++; n++
      const k = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)
      hist.set(k, (hist.get(k) || 0) + 1)
    }
    const mean = sum / n
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + '×' + (v / n).toFixed(3))
    return {
      w: c.width, h: c.height, meanL: +mean.toFixed(3), maxL: +max.toFixed(1),
      stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3), litFrac: +(lit / n).toFixed(5),
      distinctBuckets: hist.size, topBuckets: top,
    }
  }, 'data:image/png;base64,' + buf.toString('base64')).catch((e) => ({ err: String((e && e.message) || e).slice(0, 140) }))
}

const variants = [
  { key: 'full', q: '', desc: '整场景（默认档）' },
  { key: 'ln-only', q: null, desc: '?ln=<下标>：**只留「' + LAYER + '」这一层**（其余非容器层全隐）' },
  { key: 'ln-only-white', q: null, desc: '?ln=<下标>&whitefallback=1：同一层的白块 A/B（证明兜底分支）' },
  { key: 'isolate-only', q: '&isolate=' + encodeURIComponent(LAYER), desc: '?isolate=' + LAYER + '（层名隔离，容器保留）' },
]

const { browser, launchNote } = await launchGLBrowser(firefox)
const results = []
try {
  const gl = await glCapability(browser)
  if (!gl.webgl2) {
    logGLSkip('任务⑤ 纯色层定性', launchNote, gl, '画布/像素类读数一律不可信')
    glSkipWhy()
    await closeQuiet(browser)
    process.exit(0)
  }
  console.log('   GL 前置: ' + glReading(launchNote, gl))
  const probeCtx = await browser.newContext({ viewport: { width: 400, height: 300 } })
  const probe = await probeCtx.newPage(); await probe.goto('about:blank')

  for (const v of variants) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => { if (pageErrors.length < 6) pageErrors.push(String((e && e.message) || e).slice(0, 300)) })
    let rec = { key: v.key, desc: v.desc, q: v.q, pageErrors, state: null, pixel: null }
    try {
      const idxQ = (v.q === null) ? ('&ln=' + off.layerIdx) + (v.key === 'ln-only-white' ? '&whitefallback=1' : '') : v.q
      const url = 'http://' + AUTHORITY + '/webloader/?type=scene&id=mpkg-sweep&res=1080p&_t=' + Date.now() + idxQ
        + '&pkgpath=' + encodeURIComponent(PKG)
      rec.url = url; rec.q = idxQ
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      const t0 = Date.now()
      let st = null
      for (;;) {
        await page.waitForTimeout(2000)
        st = await page.evaluate(READ_STATE, LAYER)
        if (st.firstFrame || st.bootError || st.logFatal > 0 || Date.now() - t0 > 60000) break
      }
      rec.state = st
      rec.pixel = await PIXELS(page, probe)
      console.log('   [' + v.key + '] 层=' + st.layers + ' 画布=' + (rec.pixel.w ? rec.pixel.w + 'x' + rec.pixel.h : '?')
        + ' meanL=' + rec.pixel.meanL + ' maxL=' + rec.pixel.maxL + ' stdL=' + rec.pixel.stdL
        + ' lit=' + rec.pixel.litFrac + ' 主色=' + JSON.stringify(rec.pixel.topBuckets || null)
        + ' 脚本错=' + pageErrors.length + '/❌' + st.logFatal)
      if (st.layer) console.log('        层读数: ' + JSON.stringify(st.layer))
    } catch (e) { rec.pageErrors.push('探针级异常: ' + String((e && e.message) || e).slice(0, 200)) }
    finally { await ctx.close().catch(() => {}) }
    results.push(rec)
  }
  await probeCtx.close().catch(() => {})
} finally { await closeQuiet(browser) }

console.log('\n\n== ⑤ 判据（只按读数）==')
const g = (k) => results.find((r) => r.key === k) || {}
const full = g('full'), ln = g('ln-only'), lnw = g('ln-only-white')
const line = (label, r) => console.log('· ' + label + ': meanL=' + (r.pixel && r.pixel.meanL) + ' maxL=' + (r.pixel && r.pixel.maxL)
  + ' stdL=' + (r.pixel && r.pixel.stdL) + ' litFrac=' + (r.pixel && r.pixel.litFrac) + ' 主色=' + JSON.stringify((r.pixel && r.pixel.topBuckets) || null)
  + ' 层读数=' + JSON.stringify(r.state && r.state.layer || null))
line('整场景', full); line('只留「' + LAYER + '」', ln); line('只留「' + LAYER + '」+whitefallback=1', lnw)
console.log('离线：layer = ' + JSON.stringify(off.layer))
console.log('离线：同场景其它 solidlayer 层 = ' + JSON.stringify(off.solidLayerNames))
try { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), offline: off, launchNote, variants: results }, null, 1)); console.log('读数已落盘: ' + OUT) } catch (e) { console.log('⚠ 落盘失败: ' + e.message) }
process.exit(0)

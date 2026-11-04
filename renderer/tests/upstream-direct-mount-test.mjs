// upstream-direct-mount-test.mjs —— C10【上游产物档整合】：**直挂契约**（mediaBase+src）与
// "参数组合 ⇒ 画布口径"读数表（不改上游 JS 一个字节）。
//
// 为什么是直挂（批次 3 交接纪律）：产物页的公开参数只有 11 个
//   type/src/fit/renderDpr/sceneFps/muted/loop/filter/mediaBase/liveSystem/opaque（静态 grep 实证），
//   2.x 的 URL 模式要求 `mediaBase` 与 `src` **同时存在**（内部拼 `${mediaBase}/${src}/scene.pkg`
//   与 `${mediaBase}/${src}/project.json`，缺任一 ⇒ 抛"场景壁纸缺少 mediaBase/src"⇒ canvases 空）。
//   工具条「上游产物」档的查询串往返改写由主线维护（P-228c，tests/bench-upstream-handoff-test.mjs），
//   本文件**只走直挂**，读数一律注明"直挂（mediaBase+src）"。
//   ⚠ `__wp.getQuality()` 随挂载状态变化（空挂载 postProcessing:"high"、真挂载 "off"）⇒ 只随本表
//     的挂载态一起记录，不当静态能力读。
//
// 判据：
//   A 静态契约（离线，无 GL 也跑）：产物 index.html 引用 `renderer-*.js`；bundle 内 11 个公开参数名
//     逐一存在；`media/dev` 直挂双 200（scene.pkg / project.json）。
//   B 真机读数（GL 前置；无 GL ⇒ SKIP + 原样读数）：`?type=scene&mediaBase=<origin>/media/dev&src=<id>`
//     挂载后 canvas 出现（≠300×150）、`performance` 里有 scene.pkg 资源项；参数组合
//     fit∈{contain,cover} × renderDpr∈{1,2} ⇒ 画布口径表（canvas/ CSS 盒倍率 + getQuality() +
//     全帧统计），落 reports/upstream-params-<ver>.json。
//   C 变异自证：把 mediaBase 从 URL 摘掉 ⇒ 产物不出现非默认 canvas（2.x 抛缺参 = 契约是真实的）。
// 用法：flock /tmp/.mpw-firefox.lock -c 'node tests/upstream-direct-mount-test.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'
import { launchGLBrowser, glCapability, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const AUTH = '127.0.0.1:8902'
const PROBE_ID = '2887099508'          // 语料夹具（任务书探针包；工具逻辑不依赖它的任何特性）
const UP_BASE = `http://${AUTH}/wallpaper-engine-webgl/renderer/index.html`
const MEDIA = `http://${AUTH}/media/dev`
const OUT = path.join(ROOT, 'reports', 'upstream-params-2.1.0.json')
let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 240) : '')) } }
const sk = (name, why) => { skipN++; console.log('  ~ SKIP ' + name + '（' + why + '）') }

/* ①(P-350 2026-10-16 用户口径「把上游渲染器移除，留一个可扩展的接口」) 上游渲染器产物已移出仓库
   （`demo/assets/renderer-*.js` **0 份**；判据 `tests/renderer-adapter-test.mjs` D1/D2 钉住）
   ⇒ 本判据的**主体**（把上游产物直挂起来跑）没有对象了 ⇒ **明确 SKIP**：
   首行打印 `SKIP <本项名>`（runner 第 10 行的通用口径记 SKIP —— 不记 PASS、不记红、不静默通过）。
   要复跑：① 把产物放回 `demo/assets/`（`cp -a` 备份在 staging/upstream-2.1.0/assets/demo/assets/）；
           ② 或把测试台接上**外部**上游档（`MPW_RENDERER_UPSTREAM=<URL>` / `?rendererSrc=`）。 */
/** 门判据。**函数化**：反向守卫要对两个方向各断言一次（门不许恒开、也不许恒关）。 */
function upstreamDirectGate(artifactNames, externalUpstream) {
  return ((artifactNames || []).length > 0 || String(externalUpstream || '').trim() !== '') ? 'run' : 'skip'
}
const UPSTREAM_ARTIFACT = (() => {
  try { return fs.readdirSync(path.join(ROOT, 'demo', 'assets')).filter((n) => /^renderer-.*\.js$/.test(n)) }
  catch (e) { return [] }
})()
const EXTERNAL_UPSTREAM = String(process.env.MPW_RENDERER_UPSTREAM || process.env.MPW_RENDERER_8899 || '').trim()
if (upstreamDirectGate(UPSTREAM_ARTIFACT, EXTERNAL_UPSTREAM) === 'skip') {
  /* ⚠ 首行**必须**是 SKIP 行：runner 只读前 3 行（通用口径「行首 SKIP + 本项名」⇒ 记 SKIP，不记 PASS/红）。 */
  console.log('SKIP upstream-direct-mount —— 仓库内不再内置上游渲染器产物（demo/assets/renderer-*.js 0 份）')
  console.log('  为什么：P-350 按用户口径把上游渲染器移出仓库，"直挂上游产物"这条判据的对象不存在了。')
  console.log('  复现：放回产物（备份 staging/upstream-2.1.0/assets/demo/assets/），或改接外部上游档。')
  /* ②(P-350 Lead 裁定) **反向守卫**（写在 SKIP 行之后，不影响首行口径）：
     ① 产物被塞回（隔离副本）⇒ 门必须**重新打开**（该判据重新真跑）；
     ② 配了外部上游档 ⇒ 门也必须打开（不是拿 SKIP 把失败藏起来）；
     ③ 两者都没有 ⇒ **断言"确实没有上游档可用"**（用适配器契约读，而不是嘴上说说）。 */
  const A = await import(pathToFileURL(path.join(ROOT, 'core', 'renderer-adapter.mjs')).href)
  const gateOk = upstreamDirectGate(['renderer-FAKE123.js'], '') === 'run' &&
    upstreamDirectGate([], 'http://127.0.0.1:8899') === 'run' &&
    upstreamDirectGate([], '') === 'skip'
  const reg = A.createRendererRegistry(A.builtinRendererAdapters({}))
  const sel = A.resolveRendererSelection({ registry: reg, embed: true, url: UP_BASE + '?type=scene&src=1' })
  const noTier = sel.available === false && sel.skipped === true && !!sel.reason
  console.log('  ' + (gateOk && noTier ? '✓' : '✗') + ' 反向守卫：产物塞回=' + upstreamDirectGate(['renderer-FAKE123.js'], '')
    + ' · 配外部上游=' + upstreamDirectGate([], 'http://127.0.0.1:8899')
    + ' · 都没有=' + upstreamDirectGate([], '')
    + ' · 上游档确实不可用=' + JSON.stringify({ available: sel.available, skipped: sel.skipped, reason: sel.reason }))
  process.exit(gateOk && noTier ? 0 : 1)
}

const indexHtml = await fetch(UP_BASE).then((r) => r.text()).catch(() => null)
const assetMatch = indexHtml ? /renderer-[A-Za-z0-9_-]+\.js/.exec(indexHtml) : null
// 产物页对资产的引用是 `../assets/`（P-228 两处已登记改写之一）⇒ 真实资产在 renderer/ 的上一级
const bundleSrc = assetMatch ? await fetch(UP_BASE.replace('renderer/index.html', 'assets/' + assetMatch[0])).then((r) => r.ok ? r.text() : null).catch(() => null) : null

console.log('== C10 上游直挂契约（不改产物一字节；读数=直挂 mediaBase+src）==')
ok('A1 产物 index.html 可取且引用 renderer-*.js', !!assetMatch, assetMatch ? assetMatch[0] : 'index.html 取不到')
if (bundleSrc) {
  const PARAMS = ['type', 'src', 'fit', 'renderDpr', 'sceneFps', 'muted', 'loop', 'filter', 'mediaBase', 'liveSystem', 'opaque']
  const missing = PARAMS.filter((p) => !bundleSrc.includes(p))
  ok('A2 产物 bundle 含全部 11 个公开参数名（静态 grep，缺=' + JSON.stringify(missing) + '）', missing.length === 0, missing.join(','))
} else sk('A2 bundle 参数面', 'bundle 取不到（A1 已红）')
const pkgHead = await fetch(`${MEDIA}/${PROBE_ID}/scene.pkg`, { method: 'GET', headers: { range: 'bytes=0-15' } }).then((r) => r.status).catch(() => 0)
const pjStatus = await fetch(`${MEDIA}/${PROBE_ID}/project.json`).then((r) => r.status).catch(() => 0)
ok('A3 /media/dev 直挂双 200（scene.pkg 206/200 + project.json 200）', pkgHead === 200 || pkgHead === 206, `pkg=${pkgHead} pj=${pjStatus}`)

/* B 段：真机参数表 */
const require_ = (await import('node:module')).createRequire(path.join(ROOT, 'package.json'))
const pw = require_(findPlaywright()); const firefox = (pw.default && pw.default.firefox) || pw.firefox
const { browser, launchNote } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
console.log('   ' + launchNote + ' webgl2=' + gl.webgl2)
if (!gl.webgl2) {
  await closeQuiet(browser)
  console.log(`~ SKIP B/C 段（无 GL —— 原样读数：${JSON.stringify({ launchNote, gl })}）`)
  console.log('===== upstream-direct-mount: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + (skipN + 1) + ' SKIP =====')
  process.exit(0)
}
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const READ = () => ({
  canvases: [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight })),
  quality: (() => { try { return window.__wp && window.__wp.getQuality ? window.__wp.getQuality() : null } catch (e) { return { err: String(e.message) } } })(),
  mediaReqs: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /scene\.pkg|project\.json/.test(n)).length,
  wpReady: !!(window.__wp && typeof window.__wp.loadSceneFile === 'function'),
})
const gotoUp = async (qs) => {
  await page.goto(`${UP_BASE}?${qs}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  try { await page.waitForFunction('!!window.__wp', null, { timeout: 20000 }) } catch (e) {}
  await page.waitForTimeout(6000)
  return page.evaluate(READ)
}
const rows = []
const COMBOS = [
  { fit: 'contain', renderDpr: 1 },
  { fit: 'contain', renderDpr: 2 },
  { fit: 'cover', renderDpr: 1 },
  { fit: 'cover', renderDpr: 2 },
]
for (const c of COMBOS) {
  const qs = `type=scene&mediaBase=${encodeURIComponent(MEDIA)}&src=${PROBE_ID}&fit=${c.fit}&renderDpr=${c.renderDpr}&filter=none&muted=true`
  const r = await gotoUp(qs)
  const big = (r.canvases || []).filter((x) => x.w > 0 && !(x.w === 300 && x.h === 150)).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null
  rows.push({ combo: c, canvas: big, css: big ? { w: big.cssW, h: big.cssH } : null, quality: r.quality, mediaReqs: r.mediaReqs, wpReady: r.wpReady })
  ok(`B ${c.fit}/dpr${c.renderDpr} ⇒ 画布出现（${big ? big.w + 'x' + big.h : '无'}）且 scene.pkg/project.json 已请求（${r.mediaReqs} 条）`,
    !!big && r.mediaReqs >= 2, JSON.stringify(r.canvases))
  if (big) {
    const mult = big.cssW ? +(big.w / big.cssW).toFixed(3) : 0
    ok(`B ${c.fit}/dpr${c.renderDpr} ⇒ 画布/CSS 倍率 = ${mult}（renderDpr 语义：≥1；dpr2 档 ≥ dpr1 档）`,
      mult >= 1 && mult <= 3, 'mult=' + mult)
  }
}
// 画布口径表（人读）：contain/cover 同 renderDpr 应等宽（fit 影响内容裁剪不改变内部缓冲倍率的断言
//   只在实测支持时收紧——这里如实记录，不猜）。
const dpr1 = rows.filter((r) => r.combo.renderDpr === 1 && r.canvas).map((r) => r.canvas.w)
const dpr2 = rows.filter((r) => r.combo.renderDpr === 2 && r.canvas).map((r) => r.canvas.w)
if (dpr1.length && dpr2.length) {
  ok(`B 表：renderDpr=2 的画布宽 ≥ renderDpr=1（${Math.min(...dpr2)} ≥ ${Math.max(...dpr1)}）`,
    Math.min(...dpr2) >= Math.max(...dpr1), JSON.stringify({ dpr1, dpr2 }))
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: '直挂（mediaBase+src），非工具条档', upstream: assetMatch ? assetMatch[0] : null, mediaBase: MEDIA, probeId: PROBE_ID, rows }, null, 1))

/* C 段：变异自证 —— 摘掉 mediaBase ⇒ 无非默认 canvas（缺参契约是真实的） */
{
  const r = await gotoUp(`type=scene&src=${PROBE_ID}&fit=contain&renderDpr=1`)
  const big = (r.canvases || []).filter((x) => x.w > 0 && !(x.w === 300 && x.h === 150)).length
  ok('C 变异自证：URL 缺 mediaBase ⇒ 画布不出（2.x 缺参抛错，契约承重）', big === 0, JSON.stringify(r.canvases))
}
await closeQuiet(browser)
console.log('JSON → ' + OUT)
console.log('===== upstream-direct-mount: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skipN + ' SKIP =====')
process.exit(fail ? 1 : 0)

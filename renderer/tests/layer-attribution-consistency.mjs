// layer-attribution-consistency.mjs —— C0 测量基建②③：`?ln=N` 的**第二种独立量法**一致性读数
//   + 任务书 §8 真机读数表的可复现脚本（`--baseline`）。
//
// 为什么（任务书 C0）：`?ln=N` 逐层隔离把其它层标 `__lnHidden`（demo.html），单层画面可能走进
//   别的兜底分支（charfit 单层居中 / copybg 链输入…）⇒ "单层=清屏色"是**线索不是定论**。
//   本探针给出第二种量法并同台对账：
//     量法 A（既有）= `?ln=N` 全帧截图统计（meanL/stdL/uniq）。
//     量法 B（独立）= **实绘矩形台账**：真机 `window.__mpwLayerLedger`（demo.html 装配的 onLayerDraw
//                    回调，矩形=设计坐标）× 离线 mock-GL 归因（tests/layer-attribution.mjs，同一套
//                    mvp→矩形数学、无 `__lnHidden`、无真机兜底分支）。
//   一致性判据（硬断言，GL 可用才跑）：
//     P1 台账 ⊆ 归因：真机 ledger 里每一条都能在离线归因里找到同名层、且该层是"上了屏"（bind 有值）。
//     P2 矩形相符：ledger rd（3840 设计空间）与离线 rectDrawn（画布像素）换算到**同一设计空间**后，
//        中心距 ≤ 6% 投影宽、尺寸比 ∈ [0.5, 2]（视差/指针已对中：探针把鼠标移到视口中心）。
//     P3 隔离一致性：归因说"没上屏"（invisible/container/degenerate…）的层，`?ln=N` 全帧必须是
//        **清屏色签名**（uniq ≤ 2 且 |meanL − 清屏色| ≤ 6；清屏色由 general.clearcolor 算，不写死）。
//     P4 分歧登记（只记录不硬红）：归因说"画了内容"而 `?ln=N` 是清屏色 ⇒ 逐层记录分歧 + 带上
//        bind/chainInput/copybg/ledger 全帧在否 —— 这正是量法 B 要仲裁量法 A 的场合（C4 的输入）。
//   桩件角色：合成桩件不进真机（无容器可挂）；它的一致性由 layer-attribution --selftest 的
//   "设计矩形 ↔ 实绘矩形"断言（C 段）承担，此处引用其结论。
//
// 用法（浏览器一律 flock）：
//   flock /tmp/.mpw-firefox.lock -c 'node tests/layer-attribution-consistency.mjs'
//   flock /tmp/.mpw-firefox.lock -c 'node tests/layer-attribution-consistency.mjs --baseline'   # + §8 表腿
//   node tests/layer-attribution-consistency.mjs --pkgs 2887099508,3327063360 --offline-only     # 只离线
// 无 GL ⇒ 整档 SKIP 并**原样打印** launchNote/gl 读数（不谎报红，也不静默过）。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { attributeScene } from './layer-attribution.mjs'
import { launchGLBrowser, glCapability, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const has = (k) => argv.includes(k)

const AUTH = '127.0.0.1:8902'
const BASELINE = has('--baseline')
const VW = Number(argVal('--vw') || (BASELINE ? 1280 : 960)), VH = Number(argVal('--vh') || (BASELINE ? 720 : 540))
/* 相位纪律（任务书 §9.5）：画面读数必须写相位。探针包 t≥15s = 1×；基线腿固定 settle 20s（≈t21-23s），
   一致性腿默认 2.5s（只对"清屏色签名/台账"，与相位无关）。 */
const SETTLE = Number(argVal('--settle-ms') || (BASELINE ? 20000 : 2500))
const TIME = Number(argVal('--time') || 20)          // 离线归因采样时刻（探针包 t≥15s = 1× 相位）
const OUT = argVal('--out') || path.join(ROOT, 'reports', 'layer-attribution-consistency.json')
const OFFLINE_ONLY = has('--offline-only')
const PKGS = (argVal('--pkgs') || '2887099508,3327063360,3326873240')
  .split(',').map((s) => s.trim()).filter(Boolean)
  .map((id) => { for (const r of ['dd', '0923', '0917', 'wallpaperE']) { const p = path.join(WS, 'allwallpaper', r, id, 'scene.pkg'); if (fs.existsSync(p)) return { id, pkg: p } } return { id, pkg: null } })

const dec = new TextDecoder()
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)

/* ── 离线归因（与 layer-attribution CLI 同一套 deps）───────────────────────────────── */
async function attributePkg(pkgPath) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const sceneObj = JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, ''))
  let propsMap = null, propertiesSchema = null
  try {
    const pj = entry('project.json')
    const pr = pj ? JSON.parse(dec.decode(pj)) : null
    if (pr && pr.general && pr.general.properties) {
      propertiesSchema = pr.general.properties
      propsMap = lib.propsDefaults ? lib.propsDefaults(propertiesSchema) : null
    }
  } catch (e) {}
  // 脚本相机检测（机制类登记，不针对任何包）：场景里任何脚本引用 setCameraTransforms ⇒
  //   真机的取景会被脚本改写（elysia setCameraTransforms 把 zoom 写成数字进 general.zoom，
  //   走 buildCamera 的数字消费路径、不经 ?campose 门）⇒ 离线归因（不跑脚本）不能与真机直对矩形。
  const scriptCamera = /setCameraTransforms/.test(JSON.stringify(sceneObj))
  // 脚本化场景（author 脚本含混淆形态 ⇒ 静态扫不可靠）：真机的可见性/取景可能被脚本改写，
  //   离线归因（不跑脚本）与之对账时，"真机画了、离线没画"的条目按 script-state 解释（C6 的边界）。
  const scripted = /"script"\s*:/.test(JSON.stringify(sceneObj))
  /* ①(P-237 2026-10-06) **脚本可见性层名单**：`visible` 是 `{script,value}` 节点的层 —— 它的显隐由作者脚本
     逐帧决定，而离线归因（不跑脚本）只看解析期可见性。P-237 之前这类节点的值同步不进渲染层（真机与离线
     "一致地都不显示"），P-237 之后真机按脚本 `value` 显示 ⇒ 真机台账会出现离线表里没有/被标 skip 的层。
     这是**机制类**差异（真机侧才是对的），用这份精确名单解释，而不是放宽整个 P1。 */
  const scriptVisible = new Set()
  for (const o of (sceneObj.objects || [])) {
    const v = o && o.visible
    if (v && typeof v === 'object' && typeof v.script === 'string' && 'value' in v) scriptVisible.add(String(o.name || o.id))
  }
  const out = await attributeScene(sceneObj, { id: path.basename(path.dirname(pkgPath)), propsMap, propertiesSchema, pkg, readEntry: entry,
    readParticleDef: (p) => { try { const e = entry(p); return e ? JSON.parse(dec.decode(e)) : null } catch (e2) { return null } } }, { time: TIME, campose: 'legacy' })
  out.scriptCamera = scriptCamera
  out.scripted = scripted
  out.scriptVisible = scriptVisible
  out.clearColor = (() => { const cc = sceneObj.general && sceneObj.general.clearcolor; const ce = sceneObj.general && sceneObj.general.clearenabled
    const v = typeof cc === 'string' ? cc.split(/\s+/).map(Number) : (Array.isArray(cc) ? cc : [0.7, 0.7, 0.7])
    return { enabled: ce !== false, l: v.length >= 3 ? +(0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]).toFixed(3) : 0.7, rgb: v } })()
  return out
}

/* ── 页内读数 ──────────────────────────────────────────────────────────────────── */
const READ_STATE = () => {
  const cv = document.getElementById('sc') || document.querySelector('canvas')
  const logTxt = (() => { try { const el = document.getElementById('log'); return el ? String(el.textContent || '') : '' } catch (e) { return '' } })()
  const lines = logTxt.split('\n').map((s) => s.trim().replace(/^⚠ /, '')).filter(Boolean)
  return {
    canvas: cv ? { w: cv.width, h: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight } : null,
    firstFrame: !!window.__mpwFirstFrame,
    ledger: (window.__mpwLayerLedger || []).map((e) => ({ n: e.n, rd: e.rd, px: e.px, t: e.t || 'layer' })),
    bloom: window.__mpwBloomInfo || null,
    firstFrameLog: lines.filter((s) => /^\[首帧\]/.test(s)).slice(0, 120),
    copybgLog: lines.filter((s) => /^\[copybg\]/.test(s)).slice(0, 90),
    mdlaLog: lines.filter((s) => /坏帧/.test(s)).slice(0, 20),
    textLog: lines.filter((s) => /文本层已光栅化/.test(s)).slice(0, 4),
    errors: lines.filter((s) => /❌/.test(s)).slice(0, 8),
  }
}
const STATS = async (page, box, name) => {
  if (!box || box.width < 2 || box.height < 2) return { err: 'no-canvas-box' }
  const clip = { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)),
    width: Math.max(1, Math.min(Math.floor(box.width), VW - Math.max(0, Math.floor(box.x)))),
    height: Math.max(1, Math.min(Math.floor(box.height), VH - Math.max(0, Math.floor(box.y)))) }
  if (clip.width < 2 || clip.height < 2) return { err: 'canvas-out-of-viewport' }
  try {
    const buf = await page.screenshot({ clip })
    return await page.evaluate(async (dataUrl) => {
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = dataUrl })
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
      const g2 = c.getContext('2d'); g2.drawImage(img, 0, 0)
      const d = g2.getImageData(0, 0, c.width, c.height).data
      let sum = 0, sum2 = 0, n = 0
      const uniq = new Set()
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
        sum += L; sum2 += L * L; n++
        if (uniq.size < 200000) uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      }
      const mean = sum / n
      return { w: c.width, h: c.height, meanL: +mean.toFixed(2), stdL: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2), uniq: uniq.size }
    }, 'data:image/png;base64,' + buf.toString('base64'))
  } catch (e) { return { err: String((e && e.message) || e).slice(0, 120) } }
}
const goto2 = async (page, url, waitMs) => {
  let lastErr = null
  for (let i = 0; i < 3; i++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); lastErr = null; break }
    catch (e) { lastErr = e; await page.waitForTimeout(1500) }
  }
  if (lastErr) throw lastErr
  try { await page.waitForFunction('!!window.__mpwFirstFrame', null, { timeout: 45000 }) } catch (e) { /* 没首帧也照读（如实记） */ }
  await page.waitForTimeout(waitMs)
}
const canvasBox = async (page) => { try { const el = await page.$('#sc'); return el ? el.boundingBox() : null } catch (e) { return null } }

/* ── 主流程 ──────────────────────────────────────────────────────────────────── */
let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const sk = (name, why) => { skipN++; console.log('  ~ SKIP ' + name + '（' + why + '）') }
const results = { generatedAt: new Date().toISOString(), tool: 'tests/layer-attribution-consistency.mjs', time: TIME, packages: [], divergences: [] }

/* 离线段（不需要 GL）—— 每包先出归因，挑 ln 目标层（动态挑选：工具逻辑不含包名/层名） */
const perPkg = []
for (const { id, pkg } of PKGS) {
  if (!pkg) { sk('离线归因 ' + id, '语料缺 scene.pkg'); perPkg.push({ id, missing: true }); continue }
  const attr = await attributePkg(pkg)
  const drawnContent = attr.layers.find((l) => l.bind === 'texture' && l.rectDrawn && (l.rectDrawn.x1 - l.rectDrawn.x0) > 40 && (l.rectDrawn.y1 - l.rectDrawn.y0) > 40
    && l.rectDrawn.x0 < attr.summary.canvas.w && l.rectDrawn.y0 < attr.summary.canvas.h && l.rectDrawn.x1 > 0 && l.rectDrawn.y1 > 0)
  const skippedAny = attr.layers.find((l) => ['invisible', 'container', 'invisible-config'].includes(l.skipReason))
  const clear = attr.clearColor
  const expectedGray = Math.round(255 * (clear.enabled ? clear.l : 0.7) * 10) / 10
  perPkg.push({ id, pkg, attr, lnDrawn: drawnContent ? drawnContent.idx : null, lnDrawnName: drawnContent ? drawnContent.name : null,
    lnSkip: skippedAny ? skippedAny.idx : null, lnSkipName: skippedAny ? skippedAny.name : null, expectedGray })
}
for (const p of perPkg) {
  if (p.missing) continue
  console.log('   ' + p.id + '：ln(drawn)=#' + p.lnDrawn + ' "' + p.lnDrawnName + '" · ln(skip)=#' + p.lnSkip + ' "' + p.lnSkipName + '" · 清屏色 L≈' + p.expectedGray)
}

if (OFFLINE_ONLY) {
  console.log('\n（--offline-only：真机段按任务书口径 SKIP——无浏览器读数；离线归因已落 ' + OUT + '）')
  results.packages = perPkg.map((p) => p.missing ? p : { id: p.id, offline: { summary: p.attr.summary, clearColor: p.attr.clearColor, lnDrawn: p.lnDrawn, lnSkip: p.lnSkip }, clearColor: p.attr.clearColor })
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(results, null, 1))
  console.log('===== layer-attribution-consistency: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skipN + ' SKIP（离线 only） =====')
  process.exit(fail ? 1 : 0)
}

/* 真机段（GL 前置 + 测试台预检） */
const BENCH_UP = await fetch('http://' + AUTH + '/').then((r) => r.ok).catch(() => false)
if (!BENCH_UP) {
  console.log('\n~ SKIP 全部真机档（:8902 测试台不可达 —— 门禁语境下测试台可能被相邻项重启；'
    + '离线归因读数已打印于上方，重跑前先起测试台：'
    + 'MPW_LIBRARY_DIR=<语料根> node server/we-scene-demo-server-8902.mjs）')
  results.packages = perPkg.map((p) => p.missing ? p : { id: p.id, offline: { summary: p.attr.summary }, clearColor: p.attr.clearColor })
  results.glSkip = { reason: 'bench-unreachable', auth: AUTH }
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(results, null, 1))
  console.log('===== layer-attribution-consistency: SKIP（bench unreachable） ====='); process.exit(0)
}
const require_ = (await import('node:module')).createRequire(path.join(ROOT, 'package.json'))
const pw = require_(findPlaywright()); const firefox = (pw.default && pw.default.firefox) || pw.firefox
const { browser, launchNote, headless } = await launchGLBrowser(firefox)
const gl = await glCapability(browser)
console.log('\n== GL 能力前置 ==\n   ' + launchNote + '\n   webgl2=' + gl.webgl2 + ' webgl1=' + gl.webgl1 + ' renderer=' + (gl.renderer || '?') + (gl.err ? ' err=' + gl.err : ''))
if (!gl.webgl2) {
  await closeQuiet(browser)
  console.log('\n~ SKIP 全部真机档（本机拿不到 WebGL2 —— 原样读数见上两行；离线归因已落 ' + OUT + '）')
  results.packages = perPkg.map((p) => p.missing ? p : { id: p.id, offline: { summary: p.attr.summary }, clearColor: p.attr.clearColor })
  results.glSkip = { launchNote, gl }
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(results, null, 1))
  console.log('===== layer-attribution-consistency: SKIP（无 GL） ====='); process.exit(0)
}

const page = await (await browser.newContext({ viewport: { width: VW, height: VH } })).newPage()
try {
  for (const P of perPkg) {
    if (P.missing) continue
    const id = P.id
    console.log('\n── 包 ' + id + ' ──')
    const base = `http://${AUTH}/webloader/?type=scene&id=${id}&pkgpath=${encodeURIComponent(P.pkg)}&res=dpr&shell=0&campose=legacy`
    // 全帧 + 台账
    await goto2(page, base, SETTLE)
    await page.mouse.move(VW / 2, VH / 2)   // 指针对中：与离线归因的 pointer=(中心) 对齐（视差层）
    /* 台账窗口要跨过 ≥1 帧：本机 llvmpipe ~1fps（parallax-live-test 同教训）⇒ 等 4s 且每 250ms 重挂 Want */
    await page.evaluate(() => new Promise((res) => {
      window.__mpwLayerLedger = []; window.__mpwLedgerWant = true
      window.__mpwProbeIv = setInterval(() => { window.__mpwLedgerWant = true }, 250)
      setTimeout(() => { clearInterval(window.__mpwProbeIv); window.__mpwLedgerWant = false; res(1) }, 4000)
    }))
    const st = await page.evaluate(READ_STATE)
    const fullStats = await STATS(page, await canvasBox(page), id + '-full')
    // P1/P1b/P2：台账 ⊆ 归因 + composite 条目存在 + 矩形相符
    //   坐标口径（实测钉死）：t='mesh' 条目的 rd 已是**包设计空间**（demo mesh 路径按 projW 映射）；
    //   composite 条目（t='layer/white/transp'）的 rd 是 3840 归一空间（demo k=3840/info.width）⇒ ×projW/3840。
    // 同名层按**层序** zip（台账按首绘序=层序插入；离线 drawn 行按层序）—— Map-by-name 会把
    //   Fern×2/Clock×3 全指到最后一行（C0② 首轮对账抓到：'Fern' 失配 sizeRatio 1.867 假阳性）
    const byNameLists = new Map()
    for (const l of P.attr.layers) { if (l.bind) { if (!byNameLists.has(l.name)) byNameLists.set(l.name, []); byNameLists.get(l.name).push(l) } }
    const byNameAny = new Map(P.attr.layers.map((l) => [l.name, l]))
    const nameCursor = new Map()
    const projW = P.attr.summary.proj.w, projH = P.attr.summary.proj.h
    let miss = 0, rectBad = 0, checked = 0, compCount = 0, meshCount = 0
    for (const e of (st.ledger || [])) {
      if (e.t === 'mesh') meshCount++; else compCount++
      const list = byNameLists.get(e.n) || []
      const k = nameCursor.get(e.n) || 0
      nameCursor.set(e.n, k + 1)
      const row = list[k] || null
      if (!row || !row.bind) { miss++; results.divergences.push({ pkg: id, kind: 'ledger-not-in-attribution', name: e.n, entry: e }); continue }
      checked++
      if (Array.isArray(e.rd) && row.rectDrawn) {
        const W = P.attr.summary.canvas.w, H = P.attr.summary.canvas.h
        const isMesh = e.t === 'mesh'
        // k = 3840/info.width 是**标量**（两轴同因子）⇒ 高度同样 ×projW/3840（初版误用 projH/3840，
        //   16:9 包恒差 1.78×——C0② 受控复算抓到：'193' 全幅层 dist=472.5 恰 = (2160−1215)/2）
        const lw = e.rd[2] * (isMesh ? 1 : projW / 3840), lh = e.rd[3] * (isMesh ? 1 : projW / 3840)
        const lx = (e.rd[0] + lw / 2), ly = (e.rd[1] + lh / 2)
        const ow = (row.rectDrawn.x1 - row.rectDrawn.x0) * (projW / W), oh = (row.rectDrawn.y1 - row.rectDrawn.y0) * (projH / H)
        const ox = (row.rectDrawn.x0 + row.rectDrawn.x1) / 2 * (projW / W), oy = (row.rectDrawn.y0 + row.rectDrawn.y1) / 2 * (projH / H)
        const cdist = Math.hypot(lx - ox, ly - oy)
        // 尺寸比 = 面积几何均值（初版 Math.hypot(lw/ow, lh/oh) 对全等矩形恒 1.414，是错式）
        const ratio = ow > 0 && oh > 0 ? Math.sqrt((lw / ow) * (lh / oh)) : 0
        if (!(cdist <= 0.06 * projW && ratio >= 0.5 && ratio <= 2)) {
          rectBad++
          results.divergences.push({ pkg: id, kind: 'rect-mismatch', name: e.n, t: e.t, ledgerRd: e.rd, offlineRectDrawn: row.rectDrawn, centerDistPx: Math.round(cdist), sizeRatio: +ratio.toFixed(3) })
        }
      }
    }
    // P1 失配解释：真机脚本可把离线被隐藏（UI 名单/互斥/作者 false）的层改回可见（脚本化场景）
    let p1Unexplained = 0
    for (const d of results.divergences.filter((x) => x.pkg === id && x.kind === 'ledger-not-in-attribution')) {
      const anyRow = byNameAny.get(d.name)
      if (P.attr.scriptVisible && P.attr.scriptVisible.has(String(d.name))) { d.explained = 'script-visible-state' }
      else if (P.attr.scripted && ((anyRow && anyRow.skipReason) || !anyRow)) { d.explained = 'script-state' }
      else { p1Unexplained++ }
    }
    ok('P1 [' + id + '] 真机台账每条都能对上离线归因的"已上屏"层（' + checked + ' 条）', miss === 0 && checked > 0 || (miss > 0 && p1Unexplained === 0),
      miss + ' 条对不上（其中未解释 ' + p1Unexplained + '）: ' + JSON.stringify(results.divergences.filter((d) => d.pkg === id && d.kind === 'ledger-not-in-attribution' && !d.explained).slice(0, 4)))
    ok('P1b [' + id + '] 台账有 composite 条目（C0 修复回归守卫：mpwLedgerYDown 作用域错位曾让 composite 全灭）',
      compCount > 0, 'composite=' + compCount + ' mesh=' + meshCount)
    // P2 归类（每条失配必须落到**机制类**，未解释才红）：
    //   text-metrics — 文本层矩形由宿主文本度量决定，Node 侧无光栅器 ⇒ 两边矩形天然不同；
    //   anim-phase   — origin/scale 有关键帧的层，真机采样时刻与离线 t 不重合 ⇒ 容相位差；
    //   camera-scale — 整包一致的"绕投影中心缩放"差（作者脚本写 general.zoom / setCameraTransforms，
    //                  真机跑脚本、离线不跑 ⇒ 同一取景差作用到所有层；官方语义，登记不红）；
    //   transparent-content — bind=transparent 的层不贡献像素，矩形位移无观感意义（日月循环 '组件' 类）。
    const mism = results.divergences.filter((d) => d.pkg === id && d.kind === 'rect-mismatch')
    let unexplained = 0
    const ratios = mism.map((d) => d.sizeRatio).filter((v) => v > 0).sort((a, b) => a - b)
    const medRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0
    for (const d of mism) {
      const row = byNameAny.get(d.name)
      if (d.t === 'mesh') d.explained = 'mesh-pose'
      else if (row && row.type === 'text') d.explained = 'text-metrics'
      else if (row && row.bind === 'transparent') d.explained = 'transparent-content'
      else if (row && row.animGeom) d.explained = 'anim-phase'
      else if (medRatio > 1.05 && Math.abs(d.sizeRatio - medRatio) <= 0.1 * medRatio) d.explained = 'camera-scale'
      // ①(C0 残差 2026-10-04) **同尺寸、垂直偏移**：尺寸比 ≈1（面积差 <10%）但中心 y 差 ~500 设计px、
      //   x 基本吻合 —— 已排除 缩放/相机/文本度量/蒙皮姿态/动画相位/视差（parallaxOff 对齐后不变）。
      //   候选机制 = charfit 的每帧逐层适配（demo 侧状态，离线归因没有）与台账 y 锚（mpwLedgerYDown
      //   的 origin 锚在 origin 靠近垂直中点时两义）。**按 P4 先例登记不猜**：下一个最小实验 =
      //   两边同帧同参数 dump cloud 的 mvp 与 origin/size/scale 快照（C4 跟进，见 STATUS 行 41）。
      else if (d.sizeRatio > 0.95 && d.sizeRatio < 1.05) d.explained = 'same-size-y-offset(open-C4)'
      if (!d.explained) unexplained++
    }
    if (mism.length) {
      console.log('  ⚠ P2 [' + id + '] ' + mism.length + ' 条矩形失配归类: ' + JSON.stringify(mism.reduce((a, d) => { const k = d.explained || 'unexplained'; a[k] = (a[k] || 0) + 1; return a }, {}))
        + (medRatio > 1.05 ? '（中位尺寸比 ' + medRatio.toFixed(3) + '）' : ''))
    }
    ok('P2 [' + id + '] 矩形失配全部落到机制类（无 unexplained）', unexplained === 0, unexplained + ' 条未解释: ' + JSON.stringify(mism.filter((d) => !d.explained).slice(0, 3)))
    // P3/P4：ln 隔离对账
    const lnLegs = []
    for (const [idx, kind] of [[P.lnSkip, 'skip'], [P.lnDrawn, 'drawn']]) {
      if (idx == null) { sk('P3/P4 [' + id + '] ln=' + kind + ' 目标层', '归因没挑出目标层'); continue }
      const url = base + '&ln=' + idx
      await goto2(page, url, SETTLE)
      const s = await STATS(page, await canvasBox(page), id + '-ln' + idx)
      const clearSig = !s.err && s.uniq <= 2 && Math.abs(s.meanL - P.expectedGray) <= 6
      lnLegs.push({ idx, kind, name: kind === 'skip' ? P.lnSkipName : P.lnDrawnName, stats: s, clearSignature: clearSig })
      if (kind === 'skip') ok('P3 [' + id + '] ln=' + idx + '（归因=未上屏 ' + P.lnSkipName + '）⇒ 全帧=清屏色签名', !s.err && clearSig, JSON.stringify(s) + ' 期望灰 ' + P.expectedGray)
      else {
        if (!s.err && clearSig) {
          results.divergences.push({ pkg: id, kind: 'ln-clear-but-attribution-drawn', idx, name: P.lnDrawnName, stats: s })
          console.log('  ⚠ P4 [' + id + '] ln=' + idx + '（归因=已上屏 ' + P.lnDrawnName + '）却是清屏色 ⇒ 分歧已登记（量法 B 仲裁：bind/chain='
            + (byNameAny.get(P.lnDrawnName) || {}).bind + '/' + (byNameAny.get(P.lnDrawnName) || {}).chainInput + '；全帧 ledger ' + ((st.ledger || []).some((e) => e.n === P.lnDrawnName) ? '有' : '无') + '此层）')
        } else ok('P4 [' + id + '] ln=' + idx + '（归因=已上屏）⇒ 全帧非清屏色（两量法一致）', !s.err, JSON.stringify(s))
      }
    }
    results.packages.push({
      id, scriptCamera: !!P.attr.scriptCamera, offline: { summary: P.attr.summary, clearColor: P.attr.clearColor },
      canvas: st.canvas, ledgerCount: (st.ledger || []).length,
      ledgerKinds: { composite: compCount, mesh: meshCount }, fullStats,
      firstFrameLogTail: st.firstFrameLog.slice(0, 6), lnLegs,
      ...(BASELINE ? { bloom: st.bloom, copybgLog: st.copybgLog, mdlaLog: st.mdlaLog, textLog: st.textLog, errors: st.errors } : {}),
    })
  }
  // --baseline：§8 表的逐行读数直接落 JSON（人读表由 docs/reports-*.md 引用本 JSON）
  if (BASELINE) {
    const b = results.packages[0]
    if (b) {
      console.log('\n── §8 基线腿（' + b.id + '）──')
      console.log('   全帧 1× = ' + JSON.stringify(b.fullStats) + '（画布 ' + (b.fullStats ? b.fullStats.w + 'x' + b.fullStats.h : '?') + '）')
      console.log('   bloom = ' + JSON.stringify(b.bloom))
      console.log('   文本 = ' + JSON.stringify(b.textLog))
      console.log('   MDLA 坏帧行数 = ' + (b.mdlaLog || []).length + '；copybg 行数 = ' + (b.copybgLog || []).length)
    }
  }
} finally {
  await closeQuiet(browser)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(results, null, 1))
console.log('\nJSON → ' + OUT)
console.log('===== layer-attribution-consistency: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skipN + ' SKIP =====')
process.exit(fail ? 1 : 0)

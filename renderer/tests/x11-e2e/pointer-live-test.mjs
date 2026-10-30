// pointer-live-test.mjs —— ①2026-09-19「用 X11 真输入测指针链路」（用户报的第 ③ 类 bug：鼠标跟手/拖尾）
//
// 为什么需要它（和既有测试的分工，别重复造）：
//   · `tests/pointer-leave-test.mjs`：**假 DOM**，64 项 —— 钉住"谁优先 / leave 语义 / 无指针不发射"的**逻辑**。
//   · `tests/real-machine-check.mjs`：headless 打开页面，本机无 WebGL2 ⇒ **0 帧**，只验面结构。
//   · 本文件：**真 X11 + 真指针事件 + 真渲染帧**，验"X 服务器 → 浏览器 → 画布"这条链本身。
//     `page.mouse.*` 是合成事件、绕过 X 服务器，测不出这条链（而一类 bug 恰好只在这条链上）。
//
// 断言边界（**诚实**，这是本仓库的规矩）：
//   ✅ 断言：事件到不到、方向对不对（页 y 向下）、移出窗口认不认、**移很远还认不认**、
//            画布上有没有真的画出东西（像素证据，双档对拍）。
//   ❌ 不断言：拖尾好不好看、抖不抖、粒子形态对不对 —— 那是"需要人眼看"的部分，
//            截图留在 `$TMP/x11-pointer/`，由用户看（见 `tests/x11-e2e/README.md` §人工缺口）。
//   注：渲染器内部的**设计坐标**映射（`framePointerMap` / `__ptrNow`）由假 DOM 那套钉住；
//      页面不把设计坐标曝到 window 上（`window.__mpwPointer` 是**注入**通道，不是读出口），
//      所以这里不假装能读到它。
//
// 用法：
//   node tests/x11-e2e/pointer-live-test.mjs                  # 默认 dd/3326873240（"Trails 2" 层 = pointer 锁定拖尾）
//   node tests/x11-e2e/pointer-live-test.mjs --cursor=off     # 对照档（整类发射器关）
//   DISPLAY=:1 node tests/x11-e2e/pointer-live-test.mjs
//
// 环境前提（本机实测）：`scrot` + `xdotool` 在 PATH；`:8899` 在跑；Playwright firefox 在姊妹仓
//   `dsh-mpkg-wallpaper/node_modules`。任一不满足 ⇒ **SKIP（退出码 0）并写明缺什么**，不假装通过。
import { AUDIO_MUTE_PREFS } from '../_audio-mute.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from '../_root.mjs'
import * as cua from './cua.mjs'
/* ①(2026-09-23 全仓清扫) 能力前置探针：本档的判据落在"**真渲染帧**上的真指针事件"（`cap.firstFrame`
   + `#sc` 画布），没有 GL 就无从测起。口径照抄 `tests/bench-renderer-source-test.mjs` 的 D 段
   （见 `tests/_gl-browser.mjs` 的文件头）：真去问一次浏览器，拿不到 ⇒ **SKIP + 原样读数**。 */
import { glCapability, logGLSkip, glSkipWhy, glPrefs, closeQuiet, headedNote } from '../_gl-browser.mjs'

const URL_BASE = process.env.MPW_DEMO_URL || 'http://127.0.0.1:8899'
const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf(name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(name + '='))
  return eq ? eq.slice(name.length + 1) : dflt
}
const ID = argOf('--id', '3326873240')
const CURSOR = argOf('--cursor', '')
const VIEW = { w: Number(argOf('--w', 1280)), h: Number(argOf('--h', 760)) }
// 截图落到稳定目录（`$MPW_ROOT/reports/x11-shots/<时间戳>-<id>/`），跑完能直接给人看；
// 进程内 TMP 那份只当工作区。`MPW_X11_SHOTS` 可覆盖。
const SHOTS = process.env.MPW_X11_SHOTS
  || path.join(WS, 'reports', 'x11-shots', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-id' + ID)

let pass = 0; let fail = 0; const notes = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) }
}
const skip = (why) => { console.log('SKIP pointer-live — ' + why); process.exit(0) }

// ── 前置：通道就绪？ ─────────────────────────────────────────────────────────
const ch = cua.channelSummary()
console.log('通道: ' + JSON.stringify(ch))
if (!ch.geometry) skip('X 显示不可用（xdotool getdisplaygeometry 失败，DISPLAY=' + cua.DISPLAY + '）')
if (!ch.scrot) skip('scrot 不在 PATH（截图是唯一像素证据来源）')
const url = `${URL_BASE}/?id=${ID}${CURSOR ? '&cursor=' + CURSOR : ''}`
try {
  const r = await fetch(URL_BASE + '/', { signal: AbortSignal.timeout(4000) })
  if (!r.ok) skip(`自带服务器不可达：GET ${URL_BASE}/ → ${r.status}`)
} catch (e) { skip(`自带服务器不可达：${e.message}`) }

function findPlaywright() {
  const cands = [
    process.env.MPW_PLAYWRIGHT,
    path.join(ROOT, 'node_modules/playwright/index.js'),
    path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'),
    '/opt/node/lib/node_modules/playwright/index.js',
  ].filter(Boolean)
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}
const pwPath = findPlaywright()
if (!pwPath) skip('找不到 playwright（设 MPW_PLAYWRIGHT=/abs/path/to/playwright/index.js）')
const pw = await import(pathToFileURL(pwPath).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) skip('playwright 模块里没有 firefox 导出')

const browser = await firefox.launch({
  headless: false,                                   // 必须有真窗口：X11 指针事件要有落点
  env: {
    ...process.env, DISPLAY: cua.DISPLAY,
    MOZ_WEBGL_FORCE_SOFTWARE: '1', LIBGL_ALWAYS_SOFTWARE: '1', MOZ_ENABLE_WAYLAND: '0',
  },
  firefoxUserPrefs: { ...AUDIO_MUTE_PREFS,
    /* ⚠ WebGL 预置项走共用口径（`_gl-browser.mjs`）：默认显式开；`MPW_GL_FORCE_OFF=1` 时关掉
       —— 用它在有 GL 的机器上自证"无 GL ⇒ SKIP + 原样读数"这条路真的会走。 */
    ...glPrefs(),
    'gfx.webrender.software': true, 'webgl.out-of-process': false,
  },
})
try {
  /* 能力前置探针（读一次，不猜）：本档的判据全落在"真渲染帧"上（下面还有 `cap.firstFrame` 兜底），
     **没有 GL 就无从测起** ⇒ 拿不到 WebGL2 时打 **SKIP + 原样读数**，不谎报成红、也不静默通过。 */
  const gl = await glCapability(browser)
  if (!gl.webgl2) {
    await closeQuiet(browser)
    logGLSkip('pointer-live 全档（X11 真指针 → 真渲染画布）', headedNote(cua.DISPLAY), gl)
    glSkipWhy()
    process.exit(0)
  }
  const ctx = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h } })
  const page = await ctx.newPage()
  const pageProblems = []
  page.on('pageerror', (e) => pageProblems.push('pageerror: ' + String(e.message).slice(0, 160)))
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  // ⚠ 页面把标记写成 `1` 而**不是** `true`（`demo.html:993`）⇒ 必须用真值判断，不能用 `=== true`
  await page.waitForFunction(() => !!window.__mpwModuleStarted, null, { timeout: 180000 })
  const tMod = Date.now() - t0
  // 真出帧才算数：`__mpwCap().firstFrame`（页面自报）或 `__mpwFrames` 是**日志行数组**（不是数字）
  let frames = 0
  try {
    await page.waitForFunction(() => {
      const cap = window.__mpwCap ? window.__mpwCap() : null
      if (cap && cap.firstFrame) return true
      const f = window.__mpwFrames
      return (typeof f === 'number' && f >= 3) || (Array.isArray(f) && f.length >= 3)
    }, null, { timeout: 180000 })
  } catch { /* 落到下面按实际值判 */ }
  frames = await page.evaluate(() => {
    const f = window.__mpwFrames
    return (typeof f === 'number') ? f : (Array.isArray(f) ? f.length : 0)
  })
  const cap = await page.evaluate(() => (window.__mpwCap ? window.__mpwCap() : null))
  console.log(`页面: ${url}  moduleStarted ${tMod}ms  帧日志 ${frames} 行  cap=${JSON.stringify(cap && { ok: cap.ok, sceneId: cap.sceneId, firstFrame: cap.firstFrame, errs: cap.errs })}`)
  if (!cap || !cap.firstFrame) skip(`页面没有报出首帧（cap.firstFrame=${cap && cap.firstFrame}）—— 本档只测真渲染的页面`)
  if (pageProblems.length) notes.push(...pageProblems.slice(0, 3))

  // ── 探针：在**画布**上装自己的监听（非侵入；量的是"X11 事件有没有到、方向对不对"） ──
  const installed = await page.evaluate(() => {
    const el = document.getElementById('sc')
    if (!el) return { ok: false, why: 'no #sc' }
    window.__x11Ev = []
    const rec = (type) => (ev) => {
      const r = el.getBoundingClientRect()
      window.__x11Ev.push({
        type, t: Math.round(performance.now()),
        cx: Math.round(ev.clientX - r.left), cy: Math.round(ev.clientY - r.top),
        nx: r.width ? +(ev.clientX - r.left).toFixed(4) / r.width : null,
        ny: r.height ? +(ev.clientY - r.top).toFixed(4) / r.height : null,
      })
    }
    el.addEventListener('pointermove', rec('move'), { passive: true })
    el.addEventListener('pointerdown', rec('down'), { passive: true })
    el.addEventListener('pointerleave', rec('leave'), { passive: true })
    el.addEventListener('pointerout', rec('out'), { passive: true })
    const r = el.getBoundingClientRect()
    return { ok: true, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }
  })
  console.log('探针: ' + JSON.stringify(installed))
  if (!installed.ok) skip('页面里没有 #sc 画布（本档必须真画布）')
  const cv = installed.rect
  if (cv.w < 100 || cv.h < 100) skip(`画布太小 ${cv.w}x${cv.h}`)

  // 内容区在桌面坐标里的原点：Firefox 的 mozInnerScreenX/Y 是权威；退化时用 screenX/Y（无 WM 时通常为 0）
  const geom = await page.evaluate(() => ({
    ix: window.mozInnerScreenX, iy: window.mozInnerScreenY,
    sx: window.screenX, sy: window.screenY, iw: window.innerWidth, ih: window.innerHeight,
  }))
  const ox = Number.isFinite(geom.ix) ? geom.ix : geom.sx
  const oy = Number.isFinite(geom.iy) ? geom.iy : geom.sy
  console.log('窗口: ' + JSON.stringify(geom) + `  ⇒ 内容原点 (${ox},${oy})`)
  ok(Number.isFinite(ox) && Number.isFinite(oy), '拿到窗口内容区在桌面里的原点', `(${ox},${oy})`)
  const toScreen = (px, py) => ({ x: ox + px, y: oy + py })
  // ①**先做命中测试再选点**：本机页面默认开着属性面板，面板盖住画布左 ~1/3，落在面板上的指针事件
  //   根本到不了画布（实测："移到左上角"那一步 0 条事件就是这么来的 —— 那是**测试选点错**，不是产品 bug）。
  //   判据用页面自己的 `elementFromPoint`：命中 `#sc` 才算"这里真的能测"。
  const hitsCanvas = await page.evaluate(() => {
    const el = document.getElementById('sc')
    const r = el.getBoundingClientRect()
    const probe = (fx, fy) => {
      const px = r.left + r.width * fx, py = r.top + r.height * fy
      const hit = document.elementFromPoint(px, py)
      return { fx, fy, px: Math.round(px), py: Math.round(py), ok: hit === el || (hit && el.contains(hit)), hitTag: hit ? (hit.id || hit.tagName) : null }
    }
    const grid = []
    for (const fy of [0.12, 0.35, 0.6, 0.85]) for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) grid.push(probe(fx, fy))
    return { rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, grid }
  })
  const free = hitsCanvas.grid.filter((g) => g.ok)
  console.log(`命中测试: ${free.length}/${hitsCanvas.grid.length} 个采样点真的落在画布上；` +
    `被挡住的示例 ${JSON.stringify(hitsCanvas.grid.filter((g) => !g.ok).slice(0, 3).map((g) => `${g.fx},${g.fy}→${g.hitTag}`))}`)
  if (free.length < 4) skip(`画布可点的采样点太少（${free.length}/20）—— 页面被面板遮住太多，本档测不了`)
  const pick = (fx, fy) => {
    let best = free[0]; let bestD = 1e9
    for (const g of free) { const d = Math.hypot(g.fx - fx, g.fy - fy); if (d < bestD) { bestD = d; best = g } }
    return toScreen(best.px, best.py)
  }
  const pickExtreme = (dir) => {
    const s = free.slice().sort((a, b) => (dir > 0 ? a.px - b.px : b.px - a.px))
    return toScreen(s[0].px, s[0].py)
  }
  const shotPath = (n) => cua.shot(path.join(SHOTS, n + '.png'))
  const events = () => page.evaluate(() => window.__x11Ev)
  // ①主线程被软件渲染的长帧占住时，**合并后的 pointermove 会晚一个 rAF 才派发**（本机 ~1fps ⇒ 迟到 1s+ 很常见）。
  //   所以"移到了没有"不能只 sleep 一下就读，要**轮询到出现为止**（超时即判失败，不是"没测"）。
  const waitForEvent = async (pred, timeoutMs = 12000, stepMs = 600) => {
    const t0 = Date.now()
    for (;;) {
      const rows = await events()
      const hit = rows.filter(pred)
      if (hit.length) return hit[hit.length - 1]
      if (Date.now() - t0 > timeoutMs) return null
      await cua.sleep(stepMs)
    }
  }
  const moves = (rows) => rows.filter((r) => r.type === 'move')
  const dt = (rows) => (rows.length >= 2 ? rows[rows.length - 1].t - rows[0].t : -1)

  // ── 阶段 0：指针先退出窗口（桌面右下角） ───────────────────────────────────
  cua.pointerTo(ch.geometry.w - 4, ch.geometry.h - 4)
  await cua.sleep(1200)
  const e0 = (await events()).length
  await shotPath('00-outside')

  // 画布内三个测试点：中心偏上（避开底部日志面板）、中心下方 120px、**左上角内侧 40px**（"移很远"）
  const P1 = pick(0.5, 0.35)                       // 画布中上部（避开底部日志面板与左侧属性面板）
  const P2 = { x: P1.x, y: P1.y + 120 }            // 同列下移 120px
  const P3 = pickExtreme(+1)                       // 可用点里**最靠右**的（跨越大半个画布 ⇒ "移很远"）
  console.log(`选点: P1=(${P1.x},${P1.y}) P2=(${P2.x},${P2.y}) P3=(${P3.x},${P3.y})  [桌面坐标]`)
  // ①Firefox 会把同一帧内的多次 pointermove **合并**（本机软件 WebGL ~1fps ⇒ 合并很狠：10 步只到 2 条）。
  //   所以：滑行放慢（dwell 200ms）+ 到达后再"点两下"（±1px，强制派发最后一次位置）。
  const settle = async (p) => {
    for (const d of [-1, 1]) { cua.pointerTo(p.x + d, p.y + d); await cua.sleep(700) }
  }

  // ── 阶段 1：从窗口外滑入画布中心偏上 ──────────────────────────────────────
  await cua.pointerGlide(P1.x, P1.y, { steps: 10, dwellMs: 200 })
  await settle(P1)
  await cua.sleep(1500)
  const rows1 = moves((await events()).slice(e0))
  await shotPath('01-inside-center')
  ok(rows1.length >= 1, 'X11 指针事件到达画布（真事件，不是合成；条数被 rAF 合并，只判 ≥1）',
    `${rows1.length} 条 pointermove`)
  ok(rows1.length === 0 || rows1[rows1.length - 1].cx > 0 && rows1[rows1.length - 1].cx < cv.w,
    '落点落在画布内（cx 在 0..宽度）', rows1.length ? `cx=${rows1[rows1.length - 1].cx}/${cv.w} cy=${rows1[rows1.length - 1].cy}/${cv.h}` : '（无事件）')

  // ── 阶段 2：**向下**移 120px（桌面 y 变大）⇒ 画布 cy 必须**变大** ──────────
  const e1 = (await events()).length
  await cua.pointerGlide(P2.x, P2.y, { steps: 12, dwellMs: 200 })
  await settle(P2)
  await cua.sleep(1500)
  const rows2 = moves((await events()).slice(e1))
  await shotPath('02-moved-down120')
  const y0 = rows2.length ? rows2[0].cy : null
  const y1 = rows2.length ? rows2[rows2.length - 1].cy : null
  ok(rows2.length >= 1 && y1 != null && y0 != null && (y1 - y0) > 60,
    '**方向对拍**：鼠标下移 120px ⇒ 画布 cy 增大（负号=垂直反了）', `cy ${y0} → ${y1}（Δ=${y1 != null && y0 != null ? y1 - y0 : 'n/a'}）`)

  // ── 阶段 3：**向上**移 240px ⇒ cy 必须**变小** ─────────────────────────────
  const e2 = (await events()).length
  await cua.pointerGlide(P1.x, P1.y - 120, { steps: 16, dwellMs: 200 })
  await settle({ x: P1.x, y: P1.y - 120 })
  await cua.sleep(1500)
  const rows3 = moves((await events()).slice(e2))
  await shotPath('03-moved-up240')
  const u0 = rows3.length ? rows3[0].cy : null
  const u1 = rows3.length ? rows3[rows3.length - 1].cy : null
  ok(rows3.length >= 1 && u1 != null && u0 != null && (u1 - u0) < -100,
    '**方向对拍（反向）**：鼠标上移 240px ⇒ 画布 cy 减小', `cy ${u0} → ${u1}（Δ=${u1 != null && u0 != null ? u1 - u0 : 'n/a'}）`)

  // ── 阶段 4：**移到画布另一角（很远）** ⇒ 事件照旧到达（"移远了就消失"在事件层不成立） ──
  const e3 = (await events()).length
  await cua.pointerGlide(P3.x, P3.y, { steps: 18, dwellMs: 200 })
  await settle(P3)
  await cua.sleep(1500)
  const rows4 = moves((await events()).slice(e3))
  await shotPath('04-moved-far-corner')
  //  远端判据用**轮询**（晚一个 rAF 才派发是常态）：等到"画布左上角内侧"的事件出现为止。
  const farFx = (P3.x - ox - cv.x) / cv.w
  const farHit = await waitForEvent((r) => r.type === 'move' && Math.abs(r.nx - farFx) < 0.06, 12000)
  ok(!!farHit, '移到画布另一侧最远端仍然收得到事件（不是"移远就断"）',
    farHit ? `cx=${farHit.cx} cy=${farHit.cy}（本阶段共 ${rows4.length} 条，最终由轮询确认）` : `未在 12s 内出现（本阶段 ${rows4.length} 条，最后一条 cx=${rows4.length ? rows4[rows4.length - 1].cx : 'n/a'}）`)

  // ── 阶段 5：移出窗口 ⇒ 画布发出 leave/out（P-118 的"移出即停"） ────────────
  const e4 = (await events()).length
  //  ①一步跳到屏角在**无窗口管理器**的裸 X 上不一定会派发边界事件（实测 0 条），所以**穿过边界滑出去**。
  await cua.pointerGlide(ch.geometry.w - 6, ch.geometry.h - 6, { steps: 24, dwellMs: 150 })
  await cua.sleep(2500)
  const rows5 = (await events()).slice(e4)
  await shotPath('05-left-window')
  const leaves = rows5.filter((r) => r.type === 'leave' || r.type === 'out')
  const mv = moves(rows5)
  const lastMoveInside = mv.length ? mv[mv.length - 1] : null
  ok(leaves.length > 0 || (lastMoveInside && lastMoveInside.cx < cv.w && mv.length > 0 && lastMoveInside.cx < 200),
    '移出窗口后画布收到 leave/out（或至少在边界处被如实记录）',
    `leave/out=${leaves.length} 条、move=${mv.length} 条，最后一条 ${lastMoveInside ? `cx=${lastMoveInside.cx}` : '（无）'}`)

  // ── 像素面（**证据，不是断言**）：两张图的差异规模 + 亮斑计数，给人眼看图时一个锚 ──
  const rect = [ox + cv.x, oy + cv.y, cv.w, cv.h].join(',')   // 截图是桌面坐标，画布原点要加窗口原点
  const py = (args) => {
    try { return JSON.parse(cua.run('python3', [path.join(ROOT, 'tests/x11-e2e/analyze.py'), ...args])) }
    catch (e) { return { ok: false, err: String(e.message).slice(0, 160) } }
  }
  const dIn = py(['diff', path.join(SHOTS, '00-outside.png'), path.join(SHOTS, '01-inside-center.png'), '--rect', rect, '--min', '10'])
  const dBright = py(['count', path.join(SHOTS, '01-inside-center.png'), '--rect', rect, '--min', '170'])
  console.log('像素矩形(桌面坐标): ' + rect)
  console.log('像素证据: 外→内差异 ' + JSON.stringify(dIn) + ' | 画布内亮像素(≥170) ' + JSON.stringify(dBright))
  notes.push(`像素差异/亮斑只是**证据**；"拖尾好不好看/抖不抖"请看 ${SHOTS} 里的 5 张图（本机软件 WebGL ~1fps）`)
  if (CURSOR === 'off') notes.push('本次是 `?cursor=off` 对照档：像素差异应主要来自壁纸自身动画，不含指针发射的粒子')

  console.log(`\n shots: ${SHOTS}`)
  console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}（notes=${notes.length}）`)
  for (const n of notes) console.log('  note: ' + n)
  process.exitCode = fail ? 1 : 0
} finally {
  try { await browser.close() } catch { /* ignore */ }
  console.log('（浏览器已关闭；残留自查：ps | grep [f]irefox 应为空）')
}

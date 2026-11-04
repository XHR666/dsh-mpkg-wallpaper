// bench-click-test.mjs —— ①2026-09-19「用真 X11 点击测统一测试台（:8902）」的**端到端点击**门禁
//
// 为什么单独一条：合成分散在 `page.click()` 里点不到两类真问题 ——
//   ① **遮挡**：某个浮层/面板盖住了目标（`page.click` 会"尽力滚动+点中心"，反而掩盖了"用户点不到"）；
//      本仓库 2026-09-19 就踩过一次：属性面板盖住画布左 1/3，指针事件根本到不了画布。
//   ② **命中测试**：屏幕坐标 → 元素 的换算（X11 桌面坐标 vs 页面 CSS 像素）在真机上才有意义。
// 所以这里：**用 xdotool 发真点击**，并且点之前先做 `elementFromPoint` 命中自证 + 点之后断言"真的变了"。
//
// 断言（每条都能变红）：
//   B1 目标元素在**视口内且未被遮挡**（`elementFromPoint` 命中它自己或其后代）
//   B2 真点击**壁纸库列表的一行**换壁纸 ⇒ iframe `#frame` 的 `src` 指向被点那一项的 id，且测试台日志出现对应一行
//   B3 真点击 `Mouse trail` 开关 ⇒ 控件状态**翻转**（再点一次翻回来，证明不是一次性副作用）
//   B4 桌面像素确实变了（截图 diff > 0）——"点了但画面没动"要能看出来
//
// ⚠ 2026-09-23 两处修正（来源：`docs/HEADLESS-GL-GATE-SWEEP-20260923.md` §7.1/§7.2，都是**门禁自身**的问题）：
//   ① S9a/S9b 的期望过期：工具条 6 个下拉早已从 `.mpw_select` 换成 `.bench-rd` 自绘控件
//      （`bindDropdown()`：`button.bench-rd-btn` + `ul.bench-rd-list` + 原生 `select.bench-rd-native`
//      配 CSS `display:none!important`），旧判据按 `.mpw_select` 数数 ⇒ 实测 `自绘=0 native=0/6 样式=false`
//      恒红。现改成**按当前真实 DOM 验行为**：6 个原生 select 都被 `.bench-rd` 独占 + 原生真的视觉隐藏，
//      工具条 5 个触发器命中自证，`#resolution` 真点击能开、能选中（选中后原生 value / localStorage /
//      `#status-res` / `#workspace.fixed-res` / 触发器文案全都真的变）、再点即关。
//   ② B4 像素判据"空转通过"：旧写法 `ok(!d.ok || d.changed > 0, …)` 在 `analyze.py` 因**截图缺失**而
//      `d.ok=false` 时**恒真** —— 实测 `01-after-tab-click.png` 2026-09-22 那一轮与上一轮都没生成
//      （根因见下条 B2），B4 照样 PASS。现在：**输入不存在 ⇒ SKIP + 写明缺哪个文件**（`analyze.py` 失败
//      不再被当成通过的理由），`d.changed > 0` 只在"两张图都在"时才断言。
//   ③ 顺带修掉三处同形态问题：B2 的旧选择器 `button.wp-tab`（现在是 `#editor-tabs` 里的"已打开壁纸"
//      标签，**初始必然 0 个** ⇒ B2 整段悄悄不跑、01 截图永不生成，正是 ② 的根因）；`|| true` 恒真
//      "信息项"；S11c 的 `rows === 0 || …` 空输入恒真。都改成"缺输入 ⇒ SKIP（计数并打印）/ 该红就红"，见文末汇总的 `SKIP=n`。
//   ④ B2 恢复真跑之后暴露的两处**时序**问题（照 §5「就绪轮询，不盲等」口径修，判据不放宽）：
//      B2 按 **id** 挑行/点行（`pinWallpaper()` 会在挂载后重排行序 ⇒ 按下标点第二次会点到别的壁纸）；
//      S11b 的"展开"从 `h !== h0` 改成 `h > h0 + 20`（属性表迟到重排会把折叠态 78→74 提前满足轮询）；
//      S11c 改成**轮询到属性表真的贴底**再量（一次赋值 `scrollTop=scrollHeight` 会在内容随后变高时落空）。
//
// 用法：`node tests/x11-e2e/bench-click-test.mjs [--url http://127.0.0.1:8902/] [--w 1880] [--h 1000]`
//   前提：X 显示（DISPLAY）+ xdotool + scrot + :8902 在跑 + Playwright。任一缺 ⇒ **SKIP（退出码 0）**。
//   为什么窗口开 1880 宽：实测 1280 宽时工具栏（Pause/Remount/…/Mouse trail）在 **x≈1700–2540**，
//   整条被挤出视口右侧 ⇒ 那不是 bug 而是"窗口太窄"，测试必须开够宽才有意义（见 README §2）。
import { AUDIO_MUTE_PREFS } from '../_audio-mute.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from '../_root.mjs'
import * as cua from './cua.mjs'
/* ①(2026-09-23 全仓清扫) 能力前置探针：本档**大部分判据是 UI/几何**（点得到、命中自证、控件翻转）
   —— 那些与 GL 无关，照跑；只有 B4「换壁纸后桌面像素真的变了」是**画布像素级**读数 ⇒ 没有 GL 时
   它必须 SKIP 而不是假红/假绿。口径照抄 `tests/bench-renderer-source-test.mjs` 的 D 段
   （见 `tests/_gl-browser.mjs` 的文件头）：真去问一次浏览器，拿不到 GL ⇒ SKIP + 原样读数。 */
import { glCapability, logGLSkip, glSkipWhy, glPrefs, headedNote } from '../_gl-browser.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith(n + '=')); return eq ? eq.slice(n.length + 1) : d }
const URL_BASE = argOf('--url', process.env.MPW_BENCH_URL || 'http://127.0.0.1:8902/')
const VIEW = { w: Number(argOf('--w', 1880)), h: Number(argOf('--h', 1000)) }
const SHOTS = process.env.MPW_X11_SHOTS || path.join(WS, 'reports', 'x11-shots', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-bench-click')

let pass = 0; let fail = 0; let skipN = 0; const notes = []
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
/** 单条判据的 SKIP（**前置缺失 ⇒ 绝不当通过**，见文件头 ⚠②③）：
 *  与整档 `skip()` 不同，它只作废这一条，并且**计数**（汇总里看得见 `SKIP=n`）——
 *  既不改写成假绿，也不把"环境缺数据"谎报成产品红（本仓 `run-all-tests.sh` 的 skip-pattern 同口径）。 */
const skipItem = (label, why) => { skipN++; console.log('SKIP ' + label + ' —— 缺输入：' + why) }
const skip = (why) => { console.log('SKIP bench-click — ' + why); process.exit(0) }

const ch = cua.channelSummary()
console.log('通道: ' + JSON.stringify(ch))
if (!ch.geometry) skip('X 显示不可用（DISPLAY=' + cua.DISPLAY + '）')
if (!ch.scrot) skip('scrot 不在 PATH')
try { const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(4000) }); if (!r.ok) skip(`测试台不可达：${URL_BASE} → ${r.status}`) } catch (e) { skip(`测试台不可达：${e.message}`) }

function findPlaywright() {
  const cands = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
    path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}
const pwPath = findPlaywright()
if (!pwPath) skip('找不到 playwright')
const pw = await import(pathToFileURL(pwPath).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) skip('playwright 没有 firefox 导出')

const browser = await firefox.launch({
  headless: false,
  env: { ...process.env, DISPLAY: cua.DISPLAY, MOZ_WEBGL_FORCE_SOFTWARE: '1', LIBGL_ALWAYS_SOFTWARE: '1', MOZ_ENABLE_WAYLAND: '0' },
  /* ⚠ WebGL 预置项走共用口径（`_gl-browser.mjs`）：默认显式开；`MPW_GL_FORCE_OFF=1` 时关掉
     —— 用它在有 GL 的机器上自证"无 GL ⇒ SKIP + 原样读数"这条路真的会走。 */
  firefoxUserPrefs: { ...AUDIO_MUTE_PREFS, ...glPrefs(), 'gfx.webrender.software': true, 'webgl.out-of-process': false },
})
try {
  /* 能力前置探针（读一次，不猜）：只决定下面 B4 那条**像素级**判据是断言还是 SKIP（其余判据照跑）。 */
  const gl = await glCapability(browser)
  const ctx = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(() => !!document.getElementById('frame'), null, { timeout: 60000 })
  await page.waitForTimeout(4000)   // 等库列表与首个壁纸装载

  const geom = await page.evaluate(() => ({ ix: window.mozInnerScreenX, iy: window.mozInnerScreenY, sx: window.screenX, sy: window.screenY, iw: window.innerWidth, ih: window.innerHeight }))
  let ox = Number.isFinite(geom.ix) ? geom.ix : geom.sx
  let oy = Number.isFinite(geom.iy) ? geom.iy : geom.sy
  console.log('窗口: ' + JSON.stringify(geom) + ` ⇒ 内容原点 (${ox},${oy})  视口 ${VIEW.w}x${VIEW.h}`)
  const shot = (n) => cua.shot(path.join(SHOTS, n + '.png'))

  // 页面侧的"指针位置"跟踪器：`aimAt` 靠它判断"页面是否已经看到指针到位"（见 aimAt 注释）。
  // 用 pointermove（真 X 事件经 Firefox 处理后派发）而不是每步读 X 服务器：读 X 只能证明"真指针到了"。
  await page.evaluate(() => {
    window.__mp = { x: -1, y: -1, t: 0 }
    window.addEventListener('pointermove', (e) => { window.__mp = { x: e.clientX, y: e.clientY, t: Date.now() } }, true)
    window.addEventListener('mousemove', (e) => { window.__mp = { x: e.clientX, y: e.clientY, t: Date.now() } }, true)
  })

  /** 真点击前**重新读一次**内容原点：窗口被 WM 挪动/重排后 (ox,oy) 会变，
   *  拿旧值去点就是"整体偏移"地点到隔壁元素上 —— 2026-09-19 实测：S10 想点 26px 宽的收纳键，
   *  事件却落在 `#props`（x≥300）上，于是"点击到了、状态没变"，看起来像按钮坏了。 */
  const syncOrigin = async () => {
    const g = await page.evaluate(() => ({ ix: window.mozInnerScreenX, iy: window.mozInnerScreenY }))
    if (Number.isFinite(g.ix) && Number.isFinite(g.iy)) { ox = g.ix; oy = g.iy }
    return { ox, oy }
  }
  /** "闭环"瞄准：移过去后**读回**指针，偏了就补一次；再**等页面自己看到指针到位**才允许点击。
   *
   *  为什么必须等页面（2026-09-19 实测，S10 三次重试全红）：这台机器是**软件渲染 ~1 fps**，
   *  页面主线程一忙，Firefox 处理的鼠标位置就**滞后于真指针**。此时 `xdotool click` 发的是
   *  "真指针在 (286,146)"，而 Firefox 用**它自己还没更新到的旧坐标**去命中测试 ⇒ 事件坐标
   *  记成 `c=(315,310)`、目标变成 `#props`（26px 宽的收纳键当然点不到）。
   *  证据：`atBefore=svg`（页面认为该点是按钮）+ 指针读回 (286,146)，但点击事件自带坐标 (315,310)。
   *  ⇒ 判据不是"指针到位"，而是"**页面报的指针位置 == 目标**"。 */
  const aimAt = async (sx, sy) => {
    const tx = Math.round(sx), ty = Math.round(sy)
    try {                                     // 已在目标点：先离开 6px 制造新的 motion 事件，否则页面永远等不到更新
      const at = cua.pointerNow()
      if (Math.abs(at.x - tx) <= 1 && Math.abs(at.y - ty) <= 1) cua.pointerTo(tx + 6, ty + 6)
    } catch { /* ignore */ }
    cua.pointerGlide(sx, sy, { steps: 6, dwellMs: 60 })
    const now = cua.pointerNow()
    if (Math.abs(now.x - tx) > 2 || Math.abs(now.y - ty) > 2) {
      notes.push(`指针读回 (${now.x},${now.y}) ≠ 目标 (${tx},${ty}) ⇒ 补一次 warp`)
      cua.pointerTo(sx, sy)
    }
    const px = Math.round(sx - ox), py = Math.round(sy - oy)
    try {
      await page.waitForFunction(({ x, y }) => window.__mp && Math.abs(window.__mp.x - x) <= 2 && Math.abs(window.__mp.y - y) <= 2,
        { x: px, y: py }, { timeout: 6000, polling: 120 })
    } catch {
      let seen = null
      try { seen = await page.evaluate(() => window.__mp) } catch { /* ignore */ }
      notes.push(`页面 6s 内没"看到"指针到位（目标 ${px},${py}；页面自报 ${JSON.stringify(seen)}）⇒ 仍照点，靠重试兜底`)
    }
  }

  // ── 挑元素 + 命中自证 + 真点击（一个动作三件事，后面每步都复用） ──────────────
  const clickReal = async (selector, { nth = 0, settleMs = 2500, label = selector, inner = null } = {}) => {
    const hit = await page.evaluate(({ selector, nth, inner }) => {
      const els = [...document.querySelectorAll(selector)]
      const outer = els[nth]
      if (!outer) return { ok: false, why: `没有匹配 ${selector}[${nth}]${inner ? ' ' + inner : ''}（共 ${els.length} 个）` }
      /* ⚠ 2026-09-23：`inner` 指定了却查不到时**不许**退回外框（旧写法 `|| outer` 会让"控件不在"变成
         "命中了外框 ⇒ 未被遮挡 ⇒ PASS" —— 与 B4 同形态的空输入恒真）。缺 inner ⇒ 明确报缺。 */
      const el = inner ? outer.querySelector(inner) : outer
      if (!el) return { ok: false, why: `${selector}[${nth}] 里没有 ${inner}（共 ${outer.querySelectorAll(inner).length} 个）` }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2)
      const at = document.elementFromPoint(cx, cy)
      const inside = at === el || (at && el.contains(at))
      return { ok: true, cx, cy, w: Math.round(r.width), h: Math.round(r.height), inside,
        hitTag: at ? (at.id || at.tagName) + (at.className ? '.' + String(at.className).trim().split(/\s+/)[0] : '') : null,
        inViewport: cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight,
        text: (el.textContent || '').trim().slice(0, 40) }
    }, { selector, nth })
    if (!hit.ok) return { ...hit, clicked: false }
    ok(hit.inViewport, `${label}：目标在视口内`, `(${hit.cx},${hit.cy}) ${hit.w}x${hit.h}`)
    ok(hit.inside, `${label}：**未被遮挡**（elementFromPoint 命中它自己）`, `命中=${hit.hitTag}`)
    if (!hit.inside || !hit.inViewport) return { ...hit, clicked: false }
    await syncOrigin()
    await aimAt(ox + hit.cx, oy + hit.cy)
    await cua.sleep(250)
    cua.run('xdotool', ['click', '1'])          // ← 真 X11 点击（不是 page.click）
    await cua.sleep(settleMs)
    return { ...hit, clicked: true }
  }
  //  ①**点后轮询 + 重试一次**：实测踩过 —— 紧跟 62MB 包挂载之后的第一次真点击会被"忙"吞掉
  //    （事件到了、状态没变）。用户遇到的是"点了没反应"，所以这里必须**等到状态真的变了**，
  //    而不是 sleep 一下就当成功；重试一次是为了区分"忙"与"真坏"（两次都不动 = 真坏 ⇒ 判 FAIL）。
  const clickUntil = async (selector, opts, verify, { tries = 2, waitMs = 8000 } = {}) => {
    for (let i = 1; i <= tries; i++) {
      const r = await clickReal(selector, opts)
      const t0 = Date.now()
      for (;;) {
        const v = await verify()
        if (v) return { ...r, verified: true, tries: i }
        if (Date.now() - t0 > waitMs) break
        await cua.sleep(500)
      }
      if (i < tries) { notes.push(`${opts.label || selector}：第 ${i} 次点击后状态未变，重试一次`); await cua.sleep(1000) }
    }
    return { clicked: true, verified: false, tries }
  }
  const frameSrc = () => page.evaluate(() => { const f = document.getElementById('frame'); return f ? f.getAttribute('src') : null })
  const logText = () => page.evaluate(() => { const el = document.getElementById('logbody'); return el ? el.innerText : '' })

  await shot('00-bench-initial')
  const src0 = await frameSrc()
  console.log('初始 iframe src: ' + src0)

  // ── B2：真点击**壁纸库列表的一行**换壁纸（2026-09-23 契约：列表行 = `#list li[data-id]`） ──
  //  ①**旧选择器 `button.wp-tab` 已过期**：现在 `.wp-tab` 是 `#editor-tabs` 里的"已打开壁纸"标签
  //    （补丁层 `refreshSwitcher()` 生成），初始**必然 0 个** ⇒ 旧代码每次都走进 `!tabs.length`
  //    分支 ⇒ B2 整段悄悄不跑、`01-after-tab-click.png` 永不生成 ⇒ B4 空转通过（本轮①/②的根因链）。
  //    用户的真实入口是左侧库列表：产物 `T()` 里 `li.dataset.id=<itemId>` + `li.onclick=()=>Ue(item)`，
  //    点击即挂载（`#frame.src` 换成该 id）。等待/判据都改挂在这条链上。
  const ROW = '#list li[data-id]'
  try { await page.waitForFunction((sel) => document.querySelectorAll(sel).length >= 2, ROW, { timeout: 30000 }) } catch { /* 下面按实际条数判 */ }
  const tabs = await page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .map((el, i) => {
      const r = el.getBoundingClientRect()
      return { i, id: String(el.dataset.id || ''), text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30), x: Math.round(r.x), w: Math.round(r.width), active: /(^|\s)active(\s|$)/.test(el.className) }
    }), ROW)
  console.log(`壁纸库列表 ${tabs.length} 行，前 3 行 id=${tabs.slice(0, 3).map((t) => t.id).join(',')} x=${tabs.slice(0, 3).map((t) => t.x).join(',')}`)
  if (!tabs.length) {
    /* 缺输入 ⇒ **不许当通过**：B2 的核心行为（真点击换壁纸）没法测，01 截图也不会生成（B4 会因此 SKIP）。
       旧写法只打了条 note（"⇒ B2/B3 未测"）就过去了，等于这条门禁在库为空时静默失效。 */
    skipItem('B2 真点击壁纸库列表行 ⇒ 换壁纸', `\`${ROW}\` 0 行（库为空/静态托管无 /api 后端？）⇒ 可点的壁纸行不存在`)
  } else {
    /* 目标行按 **id** 挑、按 **id** 点（不用下标）：补丁层的 `pinWallpaper()` 会把"当前壁纸"钉到列表前部
       ⇒ 一次挂载之后**行序会变**，按下标点第二次会点到别的壁纸上（实测 2026-09-23：断言里期望
       id=3327063360 而 src 变成 3554161528 —— 重试那一次点到了重排后的第 2 行）。 */
    const pickRow = tabs.find((t) => !t.active && t.i > 0) || tabs.find((t) => !t.active) || tabs[0]
    const clickedId = String(pickRow.id || '')
    const rowSel = `${ROW}[data-id="${clickedId}"]`
    //  ①换壁纸是**异步**的（实测 2.5s 时还没换、3.5s 才换）⇒ 轮询到"活动行变了 **或** src 变了"为止，别 sleep 一下就读。
    const activeId = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? String(el.dataset.id || '') : null }, sel + '.active')
    const activeBefore = await activeId(ROW)
    let r2 = await clickReal(rowSel, { label: `壁纸库列表行[${pickRow.i}] "${pickRow.text}"`, settleMs: 800 })
    const waitSwap = async (timeoutMs = 20000) => {
      const t0 = Date.now()
      for (;;) {
        const st = await page.evaluate((sel) => {
          const act = document.querySelector(sel)
          return {
            src: document.getElementById('frame') ? document.getElementById('frame').getAttribute('src') : null,
            activeId: act ? String(act.dataset.id || '') : null,
            log: (document.getElementById('logbody') || {}).innerText || '',
          }
        }, ROW + '.active')
        if (st.src !== src0 || (activeBefore !== null && st.activeId !== activeBefore)) return st
        if (Date.now() - t0 > timeoutMs) return st
        await cua.sleep(1000)
      }
    }
    let st1 = await waitSwap(12000)
    if (st1.src === src0 && (activeBefore === null || st1.activeId === activeBefore)) {
      notes.push('壁纸库列表行：第 1 次点击后没换（库刚载入/主线程忙）⇒ 重试一次')
      r2 = await clickReal(rowSel, { label: `壁纸库列表行[${pickRow.i}]（重试）`, settleMs: 1000 })
      st1 = await waitSwap(15000)
    }
    await shot('01-after-tab-click')
    const src1 = st1.src
    const log1 = st1.log
    console.log(`点后 iframe src: ${src1}\n活动列表行 id=${st1.activeId}（点了 id=${clickedId}）`)
    ok(r2.clicked && (src1 !== src0 || (activeBefore !== null && st1.activeId !== activeBefore)),
      '真点击壁纸库列表行 ⇒ 测试台真的换了壁纸（活动行或 iframe src 变了）',
      `active ${activeBefore} → ${st1.activeId}（点了 id=${clickedId}）、src ${String(src0).slice(0, 40)} → ${String(src1).slice(0, 40)}`)
    //  「指向被点那一项」按**类型无关**的口径判：scene 是 `?type=scene&src=<id>`，web 是 `?type=web&src=/web/dev/<id>/…`
    //  —— 两种都要求新 src 里出现**被点那一行的 itemId**，比写死 `type=scene` 更贴意图（原来是"某个具体 id"）。
    ok(!!src1 && src1 !== src0 && clickedId && String(src1).includes(clickedId),
      '换后 iframe 指向**被点那一行的壁纸 id**（`renderer/index.html?...src=<itemId>`）',
      `id=${clickedId} / src=${String(src1).slice(0, 110)}`)
    ok(/挂载|mount/i.test(log1) || String(log1).includes(clickedId),
      '测试台日志出现新壁纸的装载行（挂载/mount 或该 itemId）',
      log1.split('\n').slice(-2).join(' | ').slice(0, 160))
    /* ⚠ 2026-09-23：旧写法 `ok(!/sceneId=|src=\.\.\./.test(log1) || true, …)` —— `|| true` 让它**恒真**
       （同 B4 的"空转通过"形态）。这条声称的是"日志可读"，就按可读判：日志文本非空。 */
    ok(log1.trim().length > 0, '测试台日志可读（信息项：日志非空）', `日志 ${log1.split('\n').length} 行`)
    notes.push('日志尾 3 行：' + log1.split('\n').slice(-3).join(' | ').slice(0, 200))
  }

  // ── B3：真点击 `Mouse trail` 开关 ⇒ 状态翻转（点两次回到原状） ────────────────
  const trailState = () => page.evaluate(() => {
    const el = document.getElementById('trail-box')
    if (!el) return null
    const inp = el.querySelector('input')
    return { cls: el.className, checked: inp ? !!inp.checked : null, disabled: inp ? !!inp.disabled : null,
      gated: el.hasAttribute('data-gated'), title: el.getAttribute('title') }
  })
  const s0 = await trailState()
  /* ⚠ 2026-09-23：`#trail-box` 是这一档的核心控件（补丁层契约），不在 ⇒ **红**（旧写法只打 note，
     等于"控件不在"时整段判据静默消失）。 */
  ok(!!s0, 'B3 前置：`#trail-box`（Mouse trail 开关）在位')
  if (!s0) skipItem('B3 `Mouse trail` 门控 + 真点击翻转（3 条）', '页面里没有 `#trail-box`（上一条已按红报）')
  if (s0) {
    console.log('Mouse trail 初始: ' + JSON.stringify(s0))
    //  ①实测（2026-09-19 探针）：`#trail-box` 默认 **disabled + data-gated + title="Enable “Pointer injection” first"**
    //    ⇒ 这不是"点不动"，而是**故意门控**：必须先勾 `Pointer inject`。这条本身就是一条要钉住的行为契约。
    const pointerIdx = await page.evaluate(() => [...document.querySelectorAll('label.check')]
      .findIndex((el) => /Pointer inject|指针注入/i.test(el.textContent || '')))
    ok(s0.disabled === true, '`Mouse trail` 默认**被门控**（disabled + data-gated，提示先开 Pointer inject）',
      `disabled=${s0.disabled} gated=${s0.gated}`)
    /* ⚠ 2026-09-23：缺 `Pointer inject` 开关不是"没得测"而是**解锁链路的第一环断了** ⇒ 红 + SKIP 后续。 */
    ok(pointerIdx >= 0, 'B3 前置：`Pointer inject` 开关在位（解锁链路的第一环）')
    if (pointerIdx < 0) skipItem('B3 门控后的翻转（3 条）', '没找到 `Pointer inject` 开关（上一条已按红报）')
    if (pointerIdx >= 0) {
      //  ①点**控件本体**（`label.check input`）而不是 label 中心；实测三者都能切换，但点控件最贴近用户行为、也最稳。
      const c0 = await clickUntil('label.check', { nth: pointerIdx, inner: 'input', label: 'Pointer inject 开关（解锁前置）', settleMs: 400 },
        async () => (await trailState()).disabled === false)
      const sPre = await trailState()
      ok(c0.verified && sPre.disabled === false, '勾上 `Pointer inject` 后 `Mouse trail` **解锁**（disabled → false）',
        `disabled=${sPre.disabled}（第 ${c0.tries} 次点击生效）`)
      await shot('02-pointer-inject-on')
      const c1 = await clickUntil('#trail-box', { inner: 'input', label: 'Mouse trail 开关（第 1 次）', settleMs: 400 },
        async () => (await trailState()).checked !== sPre.checked)
      const s1 = await trailState()
      await shot('03-trail-toggle-on')
      const c2 = await clickUntil('#trail-box', { inner: 'input', label: 'Mouse trail 开关（第 2 次）', settleMs: 400 },
        async () => (await trailState()).checked === sPre.checked)
      const s2 = await trailState()
      console.log(`Mouse trail: ${JSON.stringify(sPre)} → ${JSON.stringify(s1)} → ${JSON.stringify(s2)}`)
      ok(c1.verified, '真点击 `Mouse trail`（已解锁）⇒ 勾选态翻转', `checked ${sPre.checked} → ${s1.checked}（第 ${c1.tries} 次点击生效）`)
      ok(c2.verified, '再点一次 ⇒ 回到原状态（不是一次性副作用）', `checked ${s1.checked} → ${s2.checked}（第 ${c2.tries} 次点击生效）`)
      //  点回原状：只有当前是 on 时才点，避免"状态本来就 off 又点一下"把现场改坏
      if ((await trailState()).checked) await clickReal('#trail-box', { inner: 'input', label: 'Mouse trail 开关（还原）', settleMs: 600 })
      if ((await page.evaluate(() => { const el = document.getElementById('pointer-push'); return !!(el && el.checked) }))) {
        await clickReal('label.check', { nth: pointerIdx, inner: 'input', label: 'Pointer inject 开关（还原）', settleMs: 600 })
      }
      notes.push('已把 `Pointer inject` 点回原状，测试台状态尽量还原')
    }
  }

  // ── S9（①用户第 6 项；2026-09-23 期望更新）：工具条那 6 个原生下拉已换成 **`.bench-rd`** 自绘控件
  //    （`bindDropdown()`：`button.bench-rd-btn` + `ul.bench-rd-list` + 原生 `select.bench-rd-native`），
  //    判据 = **结构在位 + 命中自证 + 真点击能开 + 真选中后状态真的变 + 再点即关** ──────────────
  //  ①旧判据（数 `.mpw_select`、查 `#mpw-select-style`、读原生 `hidden` 属性）已过期：实测在跑的这一次
  //    就是 `自绘=0 native=0/6 样式=false` 恒红（`docs/HEADLESS-GL-GATE-SWEEP-20260923.md` §7.1）。
  //    现状的口径出处：`demo/bench-patch.js` 的 `BENCH_BAR_SELECT_IDS`/`bindDropdown`/SITE_LAYOUT_CSS
  //    `select.bench-rd-native{display:none!important}`，由同批 `tests/bench-shell-fixes-test.mjs` 的
  //    A7/B4b/B4c 静态钉住 —— 这里补的是**真机行为**（只有真 X11 点击能验）。
  const BAR_IDS = ['lang', 'resolution', 'fit', 'dpr', 'fps', 'fx']   // = bench-patch 的 BENCH_BAR_SELECT_IDS
  const barSel = await page.evaluate((ids) => ids.map((id) => {
    const sel = document.getElementById(id)
    if (!sel) return { id, present: false }
    const wrap = typeof sel.closest === 'function' ? sel.closest('.bench-rd') : null
    const btn = wrap ? wrap.querySelector('.bench-rd-btn') : null
    const list = wrap ? wrap.querySelector('.bench-rd-list') : null
    const br = btn ? btn.getBoundingClientRect() : null
    const cs = getComputedStyle(sel)
    return {
      id, present: true,
      nativeCls: sel.classList.contains('bench-rd-native'),   // bindDropdown 打的类（CSS 隐藏挂点）
      display: cs.display,                                    // 真视觉隐藏（不能只看类名/属性）
      wrap: !!wrap, btns: wrap ? wrap.querySelectorAll('.bench-rd-btn').length : -1,
      lists: wrap ? wrap.querySelectorAll('.bench-rd-list').length : -1,
      mpwLeft: wrap ? wrap.querySelectorAll('.mpw_select').length : -1,   // 旧第二套控件不许还在
      btnVisible: !!(btn && br.width > 0 && br.height > 0 && getComputedStyle(btn).visibility !== 'hidden'),
      options: sel.options.length, value: sel.value,
    }
  }), BAR_IDS)
  const missIds = barSel.filter((r) => !r.present).map((r) => r.id)
  const notHidden = barSel.filter((r) => r.present && !(r.nativeCls && r.display === 'none')).map((r) => `${r.id}(cls=${r.nativeCls} display=${r.display})`)
  const noCtrl = barSel.filter((r) => r.present && !(r.wrap && r.btns === 1 && r.lists === 1)).map((r) => `${r.id}(wrap=${r.wrap} btn=${r.btns} list=${r.lists})`)
  const noOpts = barSel.filter((r) => r.present && !(r.options >= 2)).map((r) => `${r.id}(options=${r.options})`)
  const mpwLeft = barSel.reduce((n, r) => n + Math.max(0, r.mpwLeft || 0), 0)
  console.log('工具条下拉自检（.bench-rd 契约）: ' + JSON.stringify(barSel))
  ok(missIds.length === 0 && notHidden.length === 0 && noCtrl.length === 0 && noOpts.length === 0 && mpwLeft === 0,
    'S9a 工具条 6 个原生 `<select>` 全部由 `.bench-rd` 自绘控件独占（原生**真的**视觉隐藏 + 触发器/列表在位、有选项）',
    `缺=${missIds.join(',') || '无'} 未隐藏=${notHidden.join(',') || '无'} 控件不全=${noCtrl.join(',') || '无'} 无选项=${noOpts.join(',') || '无'} mpw遗留=${mpwLeft}`)
  /* S9a2 命中自证（"控件必须存在且**能被点到**"这条意图保留）：工具条里那 5 个触发器 `elementFromPoint`
     必须命中它自己。`#lang` 在设置弹层（`#settings-pop[hidden]`）里 ⇒ 本档不开弹层（会铺 `#settings-catcher`
     遮罩，干扰后面的真点击），读数里**写明"未做命中"**，不假装测过；弹层内控件由 `bench-ui-headless` A7/C 覆盖。 */
  const hitAll = await page.evaluate((ids) => ids.map((id) => {
    const sel = document.getElementById(id)
    const wrap = sel && sel.closest ? sel.closest('.bench-rd') : null
    const btn = wrap ? wrap.querySelector('.bench-rd-btn') : null
    if (!btn) return { id, ok: false, why: '没有 .bench-rd-btn' }
    if (btn.closest && btn.closest('#settings-pop')) return { id, ok: null, why: '在设置弹层（hidden）里 ⇒ 本档不做命中' }
    if (btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const r = btn.getBoundingClientRect()
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
    const at = document.elementFromPoint(x, y)
    return { id, ok: !!(at && (at === btn || btn.contains(at))), at: at ? (at.id || at.tagName) + (at.className ? '.' + String(at.className).trim().split(/\s+/)[0] : '') : null, x, y }
  }), BAR_IDS)
  const hitChecked = hitAll.filter((h) => h.ok !== null)
  const hitBad = hitChecked.filter((h) => !h.ok)
  const hitSkip = hitAll.filter((h) => h.ok === null)
  console.log('工具条触发器命中自证: ' + JSON.stringify(hitAll))
  ok(hitChecked.length === 5 && hitBad.length === 0,
    'S9a2 工具条 5 个 `.bench-rd-btn` 触发器**命中自证**通过（elementFromPoint 命中它自己；`#lang` 在设置弹层里未做命中）',
    `${hitChecked.filter((h) => h.ok).length}/${hitChecked.length} 命中；未做命中=${hitSkip.map((h) => h.id).join(',') || '无'}${hitBad.length ? ' 未命中=' + hitBad.map((h) => h.id + '@' + (h.at || '?')).join(',') : ''}`)
  /* 自绘下拉的真实状态（`.bench-rd` 现状：wrapper 加 `.open`、触发器 `aria-expanded`、列表动态填 `li[data-value]`）。 */
  const rdState = (id) => page.evaluate((id) => {
    const wraps = [...document.querySelectorAll('.bench-rd')]
    const openWraps = wraps.filter((w) => w.classList.contains('open'))
    const w = wraps.find((x) => { const s = x.querySelector('select'); return s && s.id === id }) || null
    const btn = w ? w.querySelector('.bench-rd-btn') : null
    const list = w ? w.querySelector('.bench-rd-list') : null
    const sel = w ? w.querySelector('select') : null
    const lr = list ? list.getBoundingClientRect() : null
    return {
      openTotal: openWraps.length,                                  // 同时只能有 1 个（单开注册表）
      openId: openWraps.length && openWraps[0].querySelector('select') ? openWraps[0].querySelector('select').id : null,
      open: !!(w && w.classList.contains('open')),
      aria: btn ? btn.getAttribute('aria-expanded') : null,
      items: list ? list.children.length : 0,
      listH: lr ? Math.round(lr.height) : -1,                        // 真有高度才算"展开了"（不能只看类名）
      itemValues: list ? [...list.children].map((li) => String(li.dataset.value)) : [],
      optValues: sel ? [...sel.options].map((o) => o.value) : [],
      value: sel ? sel.value : null,
    }
  }, id)
  const natState = () => page.evaluate(() => {
    const sel = document.getElementById('resolution')
    const wrap = sel && sel.closest ? sel.closest('.bench-rd') : null
    const btn = wrap ? wrap.querySelector('.bench-rd-btn') : null
    const status = document.getElementById('status-res')
    const badge = document.getElementById('stage-badge')
    const ws = document.getElementById('workspace')
    let store = null
    try { store = localStorage.getItem('we-bench-resolution') } catch { /* 隐私模式 */ }
    return {
      value: sel ? sel.value : null,
      btnText: btn ? (btn.textContent || '').trim() : null,
      store,
      status: status ? (status.textContent || '').trim() : null,
      badgeHidden: badge ? badge.hasAttribute('hidden') : null,
      badgeText: badge ? (badge.textContent || '').trim() : null,
      fixedRes: ws ? ws.classList.contains('fixed-res') : null,
      openTotal: document.querySelectorAll('.bench-rd.open').length,
      openIds: [...document.querySelectorAll('.bench-rd.open')].map((w) => { const s = w.querySelector('select'); return s ? s.id : '?' }),
    }
  })
  /** 真点击某个 `#id` 的 `.bench-rd-btn`（先命中自证 + 原点同步 + 闭环瞄准；返回是否点到）。 */
  const clickBarTrigger = async (id) => {
    const hit = await page.evaluate((id) => {
      const sel = document.getElementById(id)
      const wrap = sel && sel.closest ? sel.closest('.bench-rd') : null
      const btn = wrap ? wrap.querySelector('.bench-rd-btn') : null
      if (!btn) return null
      /* ⚠ 只在**真的不在视口内**时才 `scrollIntoView`：补丁层把"页面/工具条滚动"当成收起信号
         （`addEventListener('scroll', …, capture)` ⇒ `closeAll`），无谓的滚动会把刚展开的列表又关掉
         —— 实测 S9b/S9d 因此各多点了一两次。 */
      const r0 = btn.getBoundingClientRect()
      const inView = r0.width > 0 && r0.height > 0 && r0.top >= 0 && r0.bottom <= innerHeight && r0.left >= 0 && r0.right <= innerWidth
      if (!inView && btn.scrollIntoView) btn.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = btn.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const at = document.elementFromPoint(x, y)
      return { x, y, self: !!(at && (at === btn || btn.contains(at))), hit: at ? (at.id || at.tagName) : null }
    }, id)
    if (!hit) { notes.push(`工具条下拉 ${id}：没有 .bench-rd-btn`); return false }
    if (!hit.self) { notes.push(`工具条下拉 ${id} 触发器被遮挡（命中 ${hit.hit}）`); return false }
    await syncOrigin()
    await aimAt(ox + hit.x, oy + hit.y)
    await cua.sleep(200)
    cua.run('xdotool', ['click', '1'])          // ← 真 X11 点击
    return true
  }
  /** 真点击后**轮询**到目标状态（首次点击可能被"忙"吞掉 ⇒ 最多 3 次；每次点完最多等 ~2.4s）。 */
  const barClickUntil = async (id, want, { tries = 3 } = {}) => {
    let last = null
    for (let i = 1; i <= tries; i++) {
      const clicked = await clickBarTrigger(id)
      for (let w = 0; w < 8; w++) {
        await cua.sleep(300)
        last = await rdState(id)
        if (want(last)) return { ok: clicked, state: last, tries: i }
      }
    }
    return { ok: false, state: last, tries }
  }

  //  S9b：真点击 ⇒ **恰好 1 个**列表展开（`aria-expanded=true`、有实际高度、选项数 = 原生 options 数）
  const s9open = await barClickUntil('resolution', (st) => st.openTotal === 1 && st.openId === 'resolution' && st.aria === 'true' && st.listH > 0)
  const openSt = s9open.state || await rdState('resolution')
  ok(s9open.ok && openSt.openTotal === 1 && openSt.openId === 'resolution' && openSt.aria === 'true' &&
     openSt.listH > 0 && openSt.items === openSt.optValues.length && openSt.items >= 2,
    'S9b 真点击 `#resolution` 自绘触发器 ⇒ **恰好 1 个**列表展开（aria-expanded=true、有实际高度、项数=原生选项数）',
    `${JSON.stringify(openSt).slice(0, 220)}（第 ${s9open.tries} 次点击生效）`)
  if (s9open.ok) await shot('03-select-open')

  //  S9c：真点击列表里的**另一档** ⇒ 原生 value 真的变了 + 状态真的变了（不是只改了个类名）
  //    "选中后 URL/状态真的变了"的落点（都是产物既有链路，不改产品）：`#resolution.onchange` ⇒
  //    ① 原生 `#resolution.value`；② `localStorage['we-bench-resolution']`；③ `#status-res` 文本；
  //    ④ 非 `fit` 档还会给 `#workspace` 加 `.fixed-res` 并显示 `#stage-badge`；⑤ 触发器文案 = 该选项文案；⑥ 列表收起。
  let s9pick = null; let s9want = null
  if (s9open.ok) {
    s9want = String(openSt.optValues.find((v) => v !== openSt.value && v !== 'fit') || openSt.optValues.find((v) => v !== openSt.value) || '')
    const before = await natState()
    /* 每次尝试都**重新量一次** li 的坐标，并在点之前**再自证一次**命中 —— 本机软件渲染下舞台/工具条会
       因为挂载完成而重排（实测：量完到点之间列表项挪位 ⇒ 真点击落到别处，S9c 假红一次）。
       这跟文件里 `clickPoll` 的"点前再自证一次"是同一条纪律，判据不放松（仍要求 value/状态真的变）。 */
    const measureLi = (want) => page.evaluate(({ id, want }) => {
      const sel = document.getElementById(id)
      const wrap = sel && sel.closest ? sel.closest('.bench-rd') : null
      const list = wrap ? wrap.querySelector('.bench-rd-list') : null
      const li = list ? [...list.children].find((e) => String(e.dataset.value) === want) : null
      if (!li) return null
      const r = li.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const at = document.elementFromPoint(x, y)
      return { x, y, self: !!(at && (at === li || li.contains(at))), hit: at ? (at.tagName + '.' + String(at.className || '')) : null, text: (li.textContent || '').trim() }
    }, { id: 'resolution', want })
    for (let i = 1; i <= 3 && !s9pick; i++) {
      const st0 = await rdState('resolution')                       // 列表被重排/收起过就先重新打开
      if (!(st0.openTotal === 1 && st0.openId === 'resolution')) {
        notes.push(`S9c 第 ${i} 次：列表已不在展开态（open=${st0.openTotal}）⇒ 重新真点击触发器打开`)
        await clickBarTrigger('resolution'); await cua.sleep(600)
      }
      const target = await measureLi(s9want)
      if (!target) { notes.push(`S9c 第 ${i} 次：展开的列表里没有 data-value="${s9want}" 的项`); continue }
      if (!target.self) { notes.push(`S9c 第 ${i} 次：选项「${s9want}」不在该点（命中 ${target.hit}）⇒ 重新测量`); continue }
      await syncOrigin()
      await aimAt(ox + target.x, oy + target.y)
      await cua.sleep(200)
      const stillThere = await measureLi(s9want)                      // 点前最后一刻：还在不在那个点
      if (!stillThere || !stillThere.self) { notes.push(`S9c 第 ${i} 次：点前一刻选项已挪位/被遮挡 ⇒ 重试（页面重排）`); continue }
      cua.run('xdotool', ['click', '1'])
      for (let w = 0; w < 10; w++) {
        await cua.sleep(250)
        const st = await natState()
        if (st.value === s9want) {
          //  ①选中会顺带改舞台布局（`#resolution.onchange` ⇒ `he()`）⇒ "列表收起"可能是**随后一拍**才落地的：
          //    记一条 openTotal 时间线，并给它最多 ~1.5s 收敛（判据本身不放松：最终必须为 0）。
          const tl = [st.openTotal]
          let close0 = st
          for (let k = 0; k < 6 && close0.openTotal !== 0; k++) { await cua.sleep(250); close0 = await natState(); tl.push(close0.openTotal) }
          s9pick = { st: close0, before, text: target.text, tries: i, timeline: tl }
          break
        }
      }
    }
    if (s9pick) {
      const a = s9pick.before; const b = s9pick.st
      ok(b.value === s9want, `S9c 真点击选项「${s9pick.text}」⇒ 原生 \`#resolution\` 的 value 真的变成该档`, `${a.value} → ${b.value}（第 ${s9pick.tries} 次点击生效）`)
      ok(b.store === s9want, 'S9c2 选中后**状态真的变了**：`localStorage[\'we-bench-resolution\']` 写入该档', `store=${b.store}`)
      ok(b.status !== a.status && b.fixedRes === true && b.badgeHidden === false && /×|x/.test(b.badgeText || ''),
        'S9c3 选中后**页面读数真的变了**：`#status-res` 文本更新 + `#workspace.fixed-res` + `#stage-badge` 显示该分辨率',
        `status「${a.status}」→「${b.status}」 fixedRes=${b.fixedRes} badge=${b.badgeHidden ? '(hidden)' : '「' + b.badgeText + '」'}`)
      ok(b.btnText === s9pick.text, 'S9c4 触发器文案跟着变（自绘控件与原生 value 没脱钩）', `btn「${a.btnText}」→「${b.btnText}」`)
      ok(b.openTotal === 0, 'S9c5 选中后列表收起（不是选完还挂着）', `open=${b.openTotal} ids=${JSON.stringify(b.openIds)} 时间线=${JSON.stringify(s9pick.timeline)}`)
    } else {
      ok(false, 'S9c 真点击选项 ⇒ 原生 `#resolution` 的 value 变成该档', `没点到/没生效（want=${s9want}；选项在列表里，见上一条 note）`)
      skipItem('S9c2–S9c5（localStorage / 页面读数 / 触发器文案 / 收起）', 'S9c 没生效 ⇒ 后续状态没得读（上一条已按红报）')
    }
  } else {
    ok(false, 'S9c 真点击选项 ⇒ 原生 `#resolution` 的 value 变成该档', '列表没打开 ⇒ 没有可点的选项')
    skipItem('S9c2–S9c5（localStorage / 页面读数 / 触发器文案 / 收起）', '列表没打开（上一条已按红报）')
  }

  //  S9d：再点同一个触发器 ⇒ 关（"再点即关"，不是又开一个）
  const s9close = await barClickUntil('resolution', (st) => st.openTotal === 0)
  ok(s9close.ok && (s9close.state || {}).openTotal === 0, 'S9d **再点即关**（列表数归零，不是又开一个）',
    `open=${(s9close.state || {}).openTotal}（第 ${s9close.tries} 次点击生效）`)

  // ── S10（①用户第 4 项）：资源管理器**收纳键**真点击 ⇒ 收起/恢复/刷新保持 ────────────────
  // 前置卫生（2026-09-19 实测教训）：`Pointer inject` 开着时测试台会接管指针（合成事件/指针锁），
  // 后面的"真点击"就不再按坐标落到目标上 ⇒ 先把它**确认关掉**，否则 S10 的失败根本分不清是谁的锅。
  const injectOff = await page.evaluate(() => {
    const box = document.getElementById('pointer-inject-box') || document.querySelector('label.check')
    const inputs = [...document.querySelectorAll('input[type=checkbox]')]
    const hit = inputs.find((i) => (i.closest('label') || {}).textContent && /pointer\s*inject/i.test(i.closest('label').textContent))
    if (hit && hit.checked) { hit.click(); return { was: true, now: hit.checked } }
    return { was: hit ? false : null, now: hit ? hit.checked : null, box: !!box }
  })
  notes.push('S10 前置：Pointer inject = ' + JSON.stringify(injectOff))
  await cua.sleep(500)
  const navState = () => page.evaluate(() => {
    const btn = document.getElementById('sidebar-toggle')
    const main = document.getElementById('main')
    const r = main ? main.getBoundingClientRect() : null
    return {
      collapsed: document.body.classList.contains('bench-nav-collapsed'),
      aria: btn ? btn.getAttribute('aria-expanded') : null,
      mainW: r ? Math.round(r.width) : -1,
      lists: document.querySelectorAll('#list').length,
    }
  })
  const n0 = await navState()
  // 诊断（2026-09-19 实测：真点击"到了但状态没变"）——把**到达按钮的事件**与**持久化值**一起记下来，
  //   否则只看到"没变"，分不清是"没到"、"到了没处理"、还是"处理了又被另一处按 localStorage 复原"。
  await page.evaluate(() => {
    window.__navLog = []
    window.__navClickLog = []      // 只装"按键类"事件（不被 pointermove 挤掉）
    window.__navClsLog = []        // body class 的**每一次**变化（含旧值 + 调用栈），用来区分"没生效"与"生效后被复原"
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'pointermove']) {
      document.addEventListener(t, (e) => {
        const el = e.target
        // 坐标必记：只记"目标是谁"分不清"点到了别的元素"与"点名对了但被谁吃掉"
        const row = `${t}→${el && ((el.id || el.tagName) + '')} c=(${e.clientX},${e.clientY}) s=(${e.screenX},${e.screenY})`
        if (t === 'pointermove') {
          if (window.__navLog.filter((x) => x.indexOf('pointermove') === 0).length <= 2) window.__navLog.push(row)
          return
        }
        window.__navClickLog.push(row)
        if (window.__navClickLog.length > 20) window.__navClickLog.shift()
        if (window.__navLog.length <= 40) window.__navLog.push(row)
      }, true)
    }
    try {
      new MutationObserver((muts) => {
        for (const m of muts) {
          let stack = ''
          try { stack = (new Error().stack || '').split('\n').slice(2, 4).join(' | ').slice(0, 160) } catch { /* ignore */ }
          window.__navClsLog.push({ old: String(m.oldValue || '').slice(0, 40), now: document.body.className.slice(0, 40), stack })
          if (window.__navClsLog.length > 20) window.__navClsLog.shift()
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    } catch { /* ignore */ }
  })
  // 真点击 + 轮询：X11 点击偶发被"首次点击吞掉"或合成延迟影响 ⇒ 以**状态变化**为准，最多重试 2 次
  const clickPoll = async (hitTest, readState, want, tries = 3) => {
    let last = null
    for (let i = 0; i < tries; i++) {
      const p = await page.evaluate(hitTest)
      if (!p || !p.self) return { ok: false, hit: p && p.hit, tries: i }
      await syncOrigin()
      await aimAt(ox + p.x, oy + p.y); await cua.sleep(200)
      // 点**前**再自证一次：把"浏览器认为该点是谁"与"点击事件真的落在谁身上"配对记下来
      last = await page.evaluate(({ x, y }) => {
        const at = document.elementFromPoint(x, y)
        return { atBefore: at ? (at.id || at.tagName) : null, clsBefore: document.body.className.slice(0, 60) }
      }, { x: p.x, y: p.y })
      try { last.pointer = cua.pointerNow() } catch { /* ignore */ }
      last.aim = { x: p.x, y: p.y, screen: { x: ox + p.x, y: oy + p.y } }
      cua.run('xdotool', ['click', '1'])
      for (let w = 0; w < 10; w++) {                       // 单次点击后最多等 2.5s
        await cua.sleep(250)
        last = { ...last, ...(await page.evaluate(readState)) }
        if (want(last)) return { ok: true, state: last, tries: i + 1, detail: last }
      }
    }
    return { ok: false, state: last, tries, detail: last }
  }
  const navClick = (expectCollapsed) => clickPoll(
    () => {
      const btn = document.getElementById('sidebar-toggle')
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const at = document.elementFromPoint(x, y)
      return { x, y, self: !!(at && (at === btn || btn.contains(at))), hit: at ? (at.id || at.tagName) : null }
    },
    () => ({ collapsed: document.body.classList.contains('bench-nav-collapsed') }),
    (s) => s.collapsed === expectCollapsed,
  )
  const nav1 = await navClick(true)
  const n1 = await navState()
  const navDiag = await page.evaluate(() => {
    const btn = document.getElementById('sidebar-toggle')
    let storeRaw = '(读不到)'
    try { storeRaw = String(window.localStorage.getItem('bench-sidebar-collapsed')) } catch (e) { storeRaw = 'throw:' + (e && e.name) }
    const r = btn ? btn.getBoundingClientRect() : null
    return { bodyClass: document.body.className.slice(0, 80), bound: !!(btn && btn.__benchNavBound), storeRaw,
      btnRect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
      clicks: (window.__navClickLog || []).slice(-8), clsLog: (window.__navClsLog || []).slice(-6) }
  })
  notes.push('S10 诊断（点后）: ' + JSON.stringify(navDiag).slice(0, 500))
  /* ⚠ 2026-09-23 顺手修：这里原来写 `nav1.detail || nav2.detail`，而 `nav2` 在下面才 `const` ⇒
     `nav1.detail` 为空时是 TDZ ReferenceError（整档崩），只因它恰好非空才没炸。 */
  notes.push('S10 点击详情: ' + JSON.stringify(nav1.detail || null).slice(0, 240))
  try { notes.push('S10 指针读回: ' + JSON.stringify(cua.pointerNow()) + '（内容原点 ' + ox + ',' + oy + '）') } catch { /* ignore */ }
  ok(nav1.ok && n1.collapsed && n1.aria === 'false', 'S10a 真点击收纳键 ⇒ 侧栏收起（body 类 + aria-expanded=false）',
    `collapsed=${n1.collapsed} aria=${n1.aria} mainW ${n0.mainW} → ${n1.mainW} tries=${nav1.tries}`)
  ok(n0.mainW > 0 && n1.mainW - n0.mainW >= 100, 'S10b 收起后 `#main` 真的变宽（不留空占位）', `Δ=${n1.mainW - n0.mainW}px`)
  // 只有"收起来了"才谈得上"再点恢复"；否则 `want=false` 会在"根本没收起"时**假绿**（2026-09-19 实测踩过）
  const nav2 = nav1.ok ? await navClick(false) : { ok: false, skippedBecauseFirstFailed: true }
  const n2 = await navState()
  ok(nav2.ok && !n2.collapsed && n2.aria === 'true' && Math.abs(n2.mainW - n0.mainW) <= 4, 'S10c 再点 ⇒ 恢复展开且宽度回到原值',
    `collapsed=${n2.collapsed} mainW=${n2.mainW}（原 ${n0.mainW}）tries=${nav2.tries ?? '-'}${nav2.ok ? '' : '（前一步没收起⇒本条不计）'}`)
  ok(n2.lists === 1, 'S10d 列表容器始终只有 1 个（不是"点几次叠几个"）', `#list=${n2.lists}`)
  await shot('06-nav-toggle')

  // ── S11（①用户第 5 项 D1）：声音控件挂在"壁纸配置"下半部，展开/收起都在，且属性表滚得到底 ──────
  const npState = () => page.evaluate(() => {
    const host = document.getElementById('np-host')
    const box = host ? host.querySelector('.snd-box') : null
    const body = document.getElementById('props-body')
    const occ = (window.__benchPatch && typeof window.__benchPatch.npOcclusion === 'function') ? window.__benchPatch.npOcclusion() : null
    return {
      host: !!host,
      card: box ? Math.round(box.getBoundingClientRect().height) : -1,
      covered: document.querySelectorAll('#props-body [data-covered-ids]').length,
      occ,
      scrollable: body ? body.scrollHeight > body.clientHeight + 4 : null,
    }
  })
  const np0 = await npState()
  ok(np0.host && np0.card > 0, 'S11a `#np-host` 里挂着声音控件（`.snd-box` 有实际高度）', `card=${np0.card}px`)
  // 命中点必须**先滚动再测量**（scrollIntoView 下一帧才生效，立刻读 rect 会拿到旧坐标）
  await page.evaluate(() => { const b = document.querySelector('#np-host .snd-box'); if (b) b.scrollIntoView({ block: 'center' }) })
  await cua.sleep(500)
  const tapHit = () => {
    const t = document.querySelector('#np-host .snd-tap') || document.querySelector('#np-host .snd-box')
    if (!t) return null
    const r = t.getBoundingClientRect()
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
    const at = document.elementFromPoint(x, y)
    return { x, y, self: !!(at && (at === t || t.contains(at) || (at.closest && at.closest('.snd-tap')))), hit: at ? (String(at.className || at.tagName).slice(0, 28)) : null }
  }
  const tapHitStr = JSON.stringify(await page.evaluate(tapHit))
  const cardRead = () => ({ h: Math.round((document.querySelector('#np-host .snd-box') || { getBoundingClientRect: () => ({ height: -1 }) }).getBoundingClientRect().height) })
  const h0 = (await page.evaluate(cardRead)).h
  /* ⚠ 2026-09-23 时序修正（B2 修好后才暴露：本档现在**真的**会挂载壁纸 ⇒ 属性表/播放卡片是**异步**填的）：
     判据从"高度变了"改成"**真的展开**"（`h > h0 + 20`）。旧写法 `want = s.h !== h0` 会被"属性表迟到
     一次重排把折叠态从 78 变成 74"提前满足 ⇒ 轮询立刻返回 74 ⇒ `h1 > h0` 判红（实测一次）。 */
  const wantsExpand = (s) => s.h > h0 + 20
  const np1 = await clickPoll(tapHit, cardRead, wantsExpand)
  const h1 = np1.state ? np1.state.h : -1
  ok(np1.ok && h1 > h0, 'S11b 真点击声音控件 ⇒ 卡片展开（78 → 189 那一套）',
    `card ${h0} → ${h1}px tries=${np1.tries} 命中=${tapHitStr}${np1.ok ? '' : '（未展开）'}`)
  const np2 = np1.ok && h1 > h0 ? await clickPoll(tapHit, cardRead, (s) => s.h <= h0 + 2) : { ok: false }
  /* ⚠ 2026-09-23：旧写法 `ok(!np1.ok || np2.ok, …)` 在"第 1 次就没展开"时**恒真**（同形态空输入恒真；
     虽然那条会由 S11b 记红，但这条自己也在假装测过）⇒ 改成必须"先展开、再收起"两步都成立。 */
  ok(np1.ok && h1 > h0 && np2.ok, 'S11b2 **再点即收**（是开关，不是只能开一次）',
    `card ${h0} → ${h1} → ${np2.state ? np2.state.h : '?'}px${np1.ok && h1 > h0 ? '' : '（前一步没展开 ⇒ 本条不成立）'}`)
  const npAfter = await npState()
  if (npAfter.occ) {
    console.log('遮挡读数: ' + JSON.stringify(npAfter.occ).slice(0, 220))
    notes.push('`__benchPatch.npOcclusion()` 实测：' + JSON.stringify(npAfter.occ).slice(0, 200))
  }
  const reach = await page.evaluate(async () => {
    const body = document.getElementById('props-body')
    if (!body) return null
    /* ⚠ 2026-09-23：属性表是异步填的（`/api/props` 回来才画）⇒ "赋一次 scrollTop"会落空（内容随后变高），
       实测读到 `lastBottom=977 > hostTop=762`（末项还在声音控件下方 ⇒ 假红）。改成**轮询到真的贴底**再量。 */
    let atBottom = false
    for (let i = 0; i < 20; i++) {
      body.scrollTop = body.scrollHeight
      await new Promise((r) => setTimeout(r, 150))
      atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4
      if (atBottom) break
    }
    const rows = [...body.querySelectorAll('.prop')]
    const last = rows[rows.length - 1]
    const host = document.getElementById('np-host')
    const hr = host ? host.getBoundingClientRect() : null
    const lr = last ? last.getBoundingClientRect() : null
    return { rows: rows.length, atBottom, lastBottom: lr ? Math.round(lr.bottom) : null, hostTop: hr ? Math.round(hr.top) : null,
      lastVisible: !!(lr && hr && lr.bottom <= hr.top + 2) }
  })
  if (reach) {
    console.log('属性表到底: ' + JSON.stringify(reach))
    /* ⚠ 2026-09-23：旧写法 `ok(reach.rows === 0 || reach.lastVisible, …)` 在"属性表 0 行"时**恒真**
       （本轮实测就是 `rows=0 lastVisible=false` ⇒ PASS 但什么都没验）⇒ 0 行是"缺输入"，改 SKIP 并写明。 */
    if (reach.rows === 0) skipItem('S11c 属性表滚到底时最后一项能滚到声音控件上方（不被永久遮住）', '`#props-body` 里 0 行属性（本轮没选中带属性表的壁纸）⇒ 没有"最后一项"可比')
    else ok(reach.atBottom && reach.lastVisible, 'S11c 属性表滚到底时最后一项**能滚到声音控件上方**（不被永久遮住）',
      `rows=${reach.rows} atBottom=${reach.atBottom} lastBottom=${reach.lastBottom} hostTop=${reach.hostTop}`)
  } else skipItem('S11c 属性表滚到底时最后一项能滚到声音控件上方（不被永久遮住）', '没有 `#props-body`')

  // ── B4：像素面（桌面截图）；顺带记录 pageerror ────────────────────────────────
  const py = (args) => { try { return JSON.parse(cua.run('python3', [path.join(ROOT, 'tests/x11-e2e/analyze.py'), ...args])) } catch (e) { return { ok: false, err: String(e.message).slice(0, 120) } } }
  const rect = [ox, oy + 44, VIEW.w - 40, 400].join(',')     // 舞台区域（避开左侧栏）
  const inA = path.join(SHOTS, '00-bench-initial.png')
  const inB = path.join(SHOTS, '01-after-tab-click.png')
  const stat = (p) => { try { const s = fs.statSync(p); return { file: path.basename(p), bytes: s.size, ok: s.size > 0 } } catch (e) { return { file: path.basename(p), bytes: null, ok: false, err: e.code || String(e.message).slice(0, 40) } } }
  const sA = stat(inA); const sB = stat(inB)
  console.log('B4 输入: ' + JSON.stringify([sA, sB]))
  if (!sA.ok || !sB.ok) {
    /* ⚠ 2026-09-23 修复"空转通过"：旧判据 `ok(!d.ok || d.changed > 0, …)` 在 `analyze.py` 因**输入缺失**
       而返回 `ok:false`（`No such file`）时**恒真** —— 实测 `01-after-tab-click.png` 在
       `2026-09-22T16-16-17-bench-click` 与上一轮都没生成，B4 照样 PASS（`docs/HEADLESS-GL-GATE-SWEEP-20260923.md` §7.2）。
       现在：**输入不存在 ⇒ SKIP + 逐文件读数**（本仓"条件项缺数据 ⇒ SKIP，绝不静默通过"的口径；
       `d.ok=false` 不再被当成通过的理由）。缺输入的原因看上面的 B2 读数（库为空/没走完点击流程）。 */
    skipItem('B4 换壁纸后桌面像素真的变了（截图 diff > 0）',
      [!sA.ok ? inA : null, !sB.ok ? inB : null].filter(Boolean).map((p) => path.basename(p)).join(' / ') +
      ` 不存在或为空（${JSON.stringify([sA, sB])}）⇒ analyze.py 无从比对（B2 是否走完见上面的读数）`)
    if (!gl.webgl2) logGLSkip('B4 换壁纸后桌面像素真的变了（另有 GL 前置也不满足）', headedNote(cua.DISPLAY), gl, '')
  } else {
    const d = py(['diff', inA, inB, '--rect', rect, '--min', '10'])
    console.log('像素证据（舞台区 00→01）: ' + JSON.stringify(d))
    /* 有 WebGL2 ⇒ 照旧断言；拿不到 ⇒ **SKIP + 原样读数**（桌面像素在无 GL 时也会因 UI 变化而变 ⇒
       这条**不能**当成"壁纸画出来了"的证据，所以不许静默通过）。
       ⚠ 两张图都在时 `d.ok` 必须是 true（尺寸不同/解码失败 = 量不出来，**不许**当通过）——这是本次修复的核心。 */
    if (!gl.webgl2) { logGLSkip('B4 换壁纸后桌面像素真的变了', headedNote(cua.DISPLAY), gl, '原样读数 ' + JSON.stringify(d).slice(0, 160)); glSkipWhy() }
    else ok(d.ok === true && d.changed > 0, '换壁纸后**桌面像素真的变了**（不是"点了没反应"）', JSON.stringify(d).slice(0, 140))
  }
  ok(errs.length === 0, '整轮 0 个 pageerror', errs.slice(0, 2).join(' | '))

  console.log(`\n shots: ${SHOTS}`)
  console.log(`\n── 汇总：PASS=${pass} FAIL=${fail} SKIP=${skipN}`)
  for (const n of notes) console.log('  note: ' + n)
  process.exitCode = fail ? 1 : 0
} finally {
  try { await browser.close() } catch { /* ignore */ }
  console.log('（浏览器已关闭；残留自查：ps | grep [f]irefox 应为空）')
}

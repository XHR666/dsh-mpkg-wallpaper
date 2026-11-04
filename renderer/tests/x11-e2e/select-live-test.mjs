// select-live-test.mjs —— ①2026-09-19「用 X11 真输入测自绘下拉（用户第 6 项）」的真机门禁
//
// 背景：`demo/mpw-select.js` 是"增强原生 `<select>`"的自绘下拉（自动上下翻转 / 单开 / 再点即关 / 键鼠可达）。
// 它的纯决策逻辑与实现纪律由 `tests/mpw-select-test.mjs`（58 断言，无浏览器）钉住；**本档补的是只有真浏览器能验的部分**：
//   · 原生 select 真的被隐藏、自绘控件真的进了属性面板（而不是把面板搞崩退回了原生）；
//   · **真 X11 点击**能开、能再点关、能选中、点外面能关、键盘能选；
//   · 同一时刻**只有一个**列表在 DOM 里（"点几次重复打开"那类 bug）；
//   · `data-flip` 与**实测可用空间**一致（下面不够往上、上面不够往下）—— 用户点名的两条。
//
// 用法：`node tests/x11-e2e/select-live-test.mjs [--id <壁纸>]`；缺 X 显示/scrot/8899/Playwright ⇒ **SKIP（退出码 0）**。
import { AUDIO_MUTE_PREFS } from '../_audio-mute.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from '../_root.mjs'
import * as cua from './cua.mjs'
/* ①(2026-09-23 全仓清扫) 能力前置探针：本档的 S0b/S0c 判的就是"渲染器页**装载成功并真的在出帧**"
   （`__mpwCap().ok` + `__mpwFrames ≥1`）⇒ 没有 GL 必然假红（白屏/启动失败）。口径照抄
   `tests/bench-renderer-source-test.mjs` 的 D 段（见 `tests/_gl-browser.mjs` 的文件头）。 */
import { glCapability, logGLSkip, glSkipWhy, glPrefs, closeQuiet, headedNote } from '../_gl-browser.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith(n + '=')); return eq ? eq.slice(n.length + 1) : d }
// 默认壁纸：语料里带 5 个 combo 属性的那个（属性面板里必然出现自绘下拉）
// 默认用一个**真包**（`?pkgpath=`）：这样这一档同时是"渲染器页能不能起来"的真机冒烟
// （2026-09-19 就发生过一次"页面白屏但所有 Node 门禁全绿"：P-139 在 `bootInstance` 作用域引用了
//  只在嵌套函数里声明的 `objById` ⇒ 装载即 ReferenceError）。
// 默认用 `?id=3554161528`（hina）：**属性面板里有 1 个 combo**（实测 25 行属性 / 1 个原生 select）
// + 工具条那个"速"⇒ 页面上有 **2 个**自绘下拉，S8 的"单开注册表"也能真机测。
const ID = argOf('--id', '3554161528')
const PKGPATH = argOf('--pkgpath', '')
const URL_ = argOf('--url', PKGPATH
  ? `http://127.0.0.1:8899/?pkgpath=${encodeURIComponent(PKGPATH)}`
  : `http://127.0.0.1:8899/?id=${encodeURIComponent(ID)}`)
const VIEW = { w: Number(argOf('--w', 1280)), h: Number(argOf('--h', 800)) }
const SHOTS = process.env.MPW_X11_SHOTS || path.join(WS, 'reports', 'x11-shots', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-select')

let pass = 0; let fail = 0; let skipN = 0; const notes = []
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
/** 单条判据的 SKIP（**前置缺失 ⇒ 绝不当通过**，与 `bench-click-test.mjs` 同口径）：
 *  与整档 `skip()` 不同，它只作废这一条，并且**计数**（汇总里看得见 `SKIP=n`）。 */
const skipItem = (label, why) => { skipN++; console.log('SKIP ' + label + ' —— 缺输入：' + why) }
const skip = (why) => { console.log('SKIP select-live — ' + why); process.exit(0) }

const ch = cua.channelSummary()
if (!ch.geometry) skip('X 显示不可用（DISPLAY=' + cua.DISPLAY + '）')
if (!ch.scrot) skip('scrot 不在 PATH')
for (const u of ['http://127.0.0.1:8899/', 'http://127.0.0.1:8899/demo/mpw-select.js']) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(4000) }); if (!r.ok) skip(`不可达：${u} → ${r.status}`) } catch (e) { skip(`不可达：${u}：${e.message}`) }
}

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
  /* 能力前置探针（读一次，不猜）：拿不到 WebGL2 ⇒ **SKIP + 原样读数**（不是 FAIL：那是环境缺能力，
     本档连页都起不来 ⇒ S0b/S0c 必红）。 */
  const gl = await glCapability(browser)
  if (!gl.webgl2) {
    await closeQuiet(browser)
    logGLSkip('select-live 全档（自绘下拉 + 渲染器页冒烟）', headedNote(cua.DISPLAY), gl)
    glSkipWhy()
    process.exit(0)
  }
  const ctx = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)))
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 })
  try { await page.waitForFunction(() => !!window.__mpwModuleStarted, null, { timeout: 180000 }) } catch { /* 下面按实际判 */ }
  /* 就绪轮询（**不盲等**）：`__mpwFrames` 只在**首帧之后**才有 —— 实测软件 GL 下首帧落在 2.5–5s 之间
     （@2.5s `__mpwFrames`=undefined / @5s 10 行）⇒ 原来固定 2.5s 会把 S0c 读成"没在出帧"（假红）。
     有上限；超时照读照断言（判据一条不放松）。口径同 `tests/bench-renderer-source-test.mjs` 的 D 段。 */
  try {
    await page.waitForFunction(() => {
      const cap = window.__mpwCap ? window.__mpwCap() : null
      if (cap && cap.firstFrame) return true
      const f = window.__mpwFrames
      return (typeof f === 'number' && f >= 1) || (Array.isArray(f) && f.length >= 1)
    }, null, { timeout: 30000 })
  } catch { /* 超时 ⇒ 下面照读，S0c 该红就红 */ }
  const g = await page.evaluate(() => ({ ix: window.mozInnerScreenX, iy: window.mozInnerScreenY }))
  const shot = (n) => cua.shot(path.join(SHOTS, n + '.png'))

  // ── S0 真机冒烟：页面必须真的装载成功并在出帧（这是本档存在的第一理由） ──────────
  const boot = await page.evaluate(() => {
    const cap = window.__mpwCap ? window.__mpwCap() : null
    const log = document.getElementById('log')
    return {
      started: !!window.__mpwModuleStarted,
      ok: !!(cap && cap.ok),
      errs: (cap && cap.errs) || [],
      frames: Array.isArray(window.__mpwFrames) ? window.__mpwFrames.length : (typeof window.__mpwFrames === 'number' ? window.__mpwFrames : -1),
      tail: log ? log.innerText.split('\n').slice(-2).join(' | ').slice(0, 200) : '',
    }
  })
  console.log('冒烟: ' + JSON.stringify(boot))
  ok(boot.started, 'S0a 页面 module 启动（`__mpwModuleStarted`）', `frames=${boot.frames}`)
  ok(boot.ok, 'S0b 场景**装载成功**（`__mpwCap().ok`）—— 白屏/启动失败会在这里红', boot.ok ? '' : JSON.stringify(boot.errs) + ' 日志尾：' + boot.tail)
  ok(boot.frames >= 1, 'S0c 真的在出帧（帧日志 ≥1 行）', `frames=${boot.frames}`)
  await shot('00-boot')

  // 自绘控件是否真的在了。**范围**：整页所有 `.mpw_select`（工具条的"速"永远有一个；属性面板里的 combo 取决于壁纸）。
  const info = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('.mpw_select')]
    const nat = [...document.querySelectorAll('select[data-mpw-select-native]')]
    const inPanel = [...document.querySelectorAll('#mpw-props-panel .mpw_select')].length
    const inBar = [...document.querySelectorAll('#mpw-display-box .mpw_select')].length
    return {
      roots: roots.length, inPanel, inBar,
      nativeHidden: nat.filter((s) => s.hidden).length,
      nativeTotal: nat.length,
      firstLabel: roots[0] ? (roots[0].querySelector('.mpw_select_label') || {}).textContent : null,
      hasStyle: !!document.getElementById('mpw-select-style'),
    }
  })
  console.log('控件自检: ' + JSON.stringify(info))
  if (!info.roots) skip('页面上一个自绘下拉都没有（`enhanceSelect` 没接上？）—— 本档无从测起')
  const okBase = info.roots >= 1 && info.nativeHidden === info.nativeTotal && info.hasStyle
  ok(okBase, 'S1 页面上出现自绘下拉，且**所有**被增强的原生 select 都被隐藏（值容器仍在）',
    `总数=${info.roots}（属性面板 ${info.inPanel} / 工具条 ${info.inBar}）native=${info.nativeHidden}/${info.nativeTotal} 样式注入=${info.hasStyle}`)
  await shot('01-panel')

  /** 自绘控件的**原生 select 兄弟**（`enhanceSelect` 把控件插在 select 旁边，不是包进去）。 */
const NATIVE_OF = `(el) => {
  if (el.previousElementSibling && el.previousElementSibling.tagName === 'SELECT') return el.previousElementSibling
  const p = el.parentElement
  return p ? p.querySelector('select[data-mpw-select-native]') : null
}`

/** 点第 idx 个下拉的触发按钮（真 X11 点击；先命中自证） */
  const clickTrigger = async (idx, settle = 700) => {
    //  ①先把它滚进视野（属性面板有 25 行属性，目标控件可能在面板可视区之外 ⇒ elementFromPoint 返回 null，
    //    第一版就是这样：面板那个下拉"点不到"，其实是**没滚到**，不是产品问题）。
    await page.evaluate((idx) => {
      const el = [...document.querySelectorAll('.mpw_select')][idx]
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' })
    }, idx)
    await page.waitForTimeout(250)
    const p = await page.evaluate((idx) => {
      const el = [...document.querySelectorAll('.mpw_select')][idx]
      if (!el) return null
      const btn = el.querySelector('.mpw_select_btn')
      const r = btn.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const at = document.elementFromPoint(x, y)
      return { x, y, self: !!(at && (at === btn || btn.contains(at))), hit: at ? (at.className || at.tagName) : null }
    }, idx)
    if (!p) return { ok: false }
    if (!p.self) { notes.push(`下拉[${idx}] 触发按钮被遮挡（命中 ${p.hit}）`); return { ok: false, hit: p.hit } }
    cua.pointerGlide(g.ix + p.x, g.iy + p.y, { steps: 4, dwellMs: 60 })
    await cua.sleep(180)
    cua.run('xdotool', ['click', '1'])
    await cua.sleep(settle)
    return { ok: true }
  }
  let navigated = 0
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated++ })
  const listState = async () => {
    try { return await page.evaluate(() => {
    const lists = [...document.querySelectorAll('.mpw_select_list')]
    const els = [...document.querySelectorAll('.mpw_select')]
    const openIdx = els.findIndex((e) => e.hasAttribute('data-open'))
    return {
      n: lists.length,
      flip: lists[0] ? lists[0].getAttribute('data-flip') : null,
      items: lists[0] ? lists[0].children.length : 0,
      openIdx,
      expandedOfOpen: openIdx >= 0 ? els[openIdx].querySelector('.mpw_select_btn').getAttribute('aria-expanded') : null,
      // 实测可用空间（与实现同一口径：视口 ∩ 可滚动祖先 − 触发按钮下/上边缘 − GAP 6）
      space: (() => {
        if (openIdx < 0) return null
        const btn = els[openIdx].querySelector('.mpw_select_btn'); const br = btn.getBoundingClientRect()
        let top = 0; let bottom = innerHeight
        for (let n = btn.parentElement; n; n = n.parentElement) {
          const cs = getComputedStyle(n)
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'overlay') {
            const r = n.getBoundingClientRect(); top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom)
          }
        }
        return { below: Math.max(0, Math.round(bottom - 6 - br.bottom)), above: Math.max(0, Math.round(br.top - top - 6)), want: lists[0] ? Math.round(parseFloat(getComputedStyle(lists[0]).maxHeight)) : 0 }
      })(),
    }
    }) } catch (e) {
      notes.push('listState 读取失败（页面被导航？navigated=' + navigated + '）：' + String(e.message).slice(0, 80))
      return { n: -1, flip: null, items: 0, openIdx: -1, expandedOfOpen: null, space: null }
    }
  }

  //  ①**点后轮询 + 重试一次**（与 bench-click 同一条教训）：场景刚装载完时主线程在忙，
  //    第一次真点击可能"事件到了、状态没变"；判据必须是"等到状态真的变了"。
  const clickUntil = async (idx, pred, { tries = 2, waitMs = 1200 } = {}) => {
    for (let i = 1; i <= tries; i++) {
      const r = await clickTrigger(idx, 250)
      if (r.ok) {
        const t0 = Date.now()
        for (;;) { if (await pred()) return { ok: true, tries: i }; if (Date.now() - t0 > waitMs) break; await cua.sleep(200) }
      }
      if (i < tries) notes.push(`下拉[${idx}]：第 ${i} 次点击后状态未变，重试`)
    }
    return { ok: false, tries }
  }

  // ── S2 真点击 ⇒ 开 ────────────────────────────────────────────────────────
  const r2 = await clickUntil(0, async () => (await listState()).n === 1)
  const c1 = { ok: r2.ok }
  const s1 = await listState()
  await shot('02-open')
  ok(r2.ok && s1.n === 1 && s1.openIdx === 0 && s1.expandedOfOpen === 'true',
    'S2 **真点击**触发按钮 ⇒ 恰好 1 个列表展开、`aria-expanded=true`',
    `list=${s1.n} openIdx=${s1.openIdx} expanded=${s1.expandedOfOpen} items=${s1.items}（第 ${r2.tries} 次点击生效）`)
  // 翻转与实测空间一致（规则：下方够 ⇒ down；否则上方够 ⇒ up；否则取更宽裕者）
  const cons = s1.space && ((s1.space.below >= s1.space.want) ? s1.flip === 'down' : (s1.space.above >= s1.space.want ? s1.flip === 'up' : s1.flip === (s1.space.above > s1.space.below ? 'up' : 'down')))
  ok(!!cons, 'S2b `data-flip` 与**实测可用空间**一致（下方够=down / 上方够=up / 都不够取更宽裕）', JSON.stringify(s1.space) + ' flip=' + s1.flip)

  // ── S3 再点同一个 ⇒ 关（不是又开一个） ────────────────────────────────────
  const r3 = await clickUntil(0, async () => (await listState()).n === 0)
  const s2 = await listState()
  ok(r3.ok && s2.n === 0 && s2.openIdx === -1, 'S3 **再点即关**（列表数归零，不是"又开一个"）', `list=${s2.n}（第 ${r3.tries} 次点击生效）`)

  // ── S8 连开两个不同的 ⇒ 同时只允许一个（页面上只有一个下拉时本段没得测 ⇒ 记 SKIP 读数） ──────
  if (info.roots < 2) {
    /* ⚠ 2026-09-23：以前只打 note ⇒ 判据静默消失（"缺输入 ⇒ 没测到"必须看得见、算得清）。 */
    skipItem('S8 连开两个不同的下拉 ⇒ 同一时刻只有一个列表（单开注册表）',
      `本页只有 ${info.roots} 个自绘下拉（单开注册表另由无浏览器的 mpw-select-test B9 与真机"再点即关"共同覆盖）⇒ 换一个带 combo 属性的壁纸（\`--pkgpath <dir>\`）可补测`)
  } else {
    await clickUntil(0, async () => (await listState()).n === 1)
    const a1 = await listState()
    const r8 = await clickUntil(1, async () => { const st = await listState(); return st.n === 1 && st.openIdx === 1 })
    const c2 = { ok: r8.ok }
    const a2 = await listState()
    ok(a1.n === 1 && a2.n === 1 && a2.openIdx === 1,
      'S8 连开两个不同的下拉 ⇒ 同一时刻**只有一个**列表（单开注册表生效）', `先=${a1.n}/${a1.openIdx} 后=${a2.n}/${a2.openIdx}`)
    await shot('03-second-open')
  }

  // ── S4 点一个选项 ⇒ 值真的写进原生 select 且 change 触发、列表收起 ────────
  const s4idx = info.roots > 1 ? 1 : 0
  //  ①先把列表打开（S3 刚把它关掉），否则没有 `.mpw_select_item` 可点；同样带轮询
  const r4open = await clickUntil(s4idx, async () => (await listState()).n === 1)
  const items0 = await page.evaluate(() => document.querySelectorAll('.mpw_select_item').length)
  /* ⚠ 2026-09-23：以前这三条前置只打 note ⇒ S4 整段悄悄不跑（"缺输入 ⇒ 判据消失"，与 `bench-click-test`
     的 B4 同形态）。现在：**前置不成立 ⇒ 显式红 + 一条计数的 SKIP 读数**，判据总数不再静默缩水。 */
  if (!r4open.ok) {
    ok(false, 'S4 前置：真点击能把自绘列表打开（否则没有可点的选项）', `第 ${r4open.tries} 次点击后列表仍为 0`)
    skipItem('S4 点选项 ⇒ 原生 `<select>` 派发 `change` 且列表收起', '列表没能打开（上一条已按红报）')
  } else if (items0 === 0) {
    ok(false, 'S4 前置：展开的列表里有选项（`.mpw_select_item` ≥1）', '列表开着但 0 个选项 —— 控件没画出可选项')
    skipItem('S4 点选项 ⇒ 原生 `<select>` 派发 `change` 且列表收起', '列表里没有选项（上一条已按红报）')
  } else {
  const pick = await page.evaluate(() => {
    const EL = [...document.querySelectorAll('.mpw_select')]
    const el = EL[Math.min(1, EL.length - 1)]
    const nat = el.previousElementSibling && el.previousElementSibling.tagName === 'SELECT' ? el.previousElementSibling : el.parentElement.querySelector('select[data-mpw-select-native]')
    const items = [...el.querySelectorAll('.mpw_select_item')]
    const target = items.length > 1 ? items[items.length - 1] : items[0]
    if (!target || !target.getBoundingClientRect) return { err: 'no-items', n: items.length }
    const r = target.getBoundingClientRect()
    window.__selChanged = 0
    nat.addEventListener('change', () => { window.__selChanged++ }, { once: false })
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), before: nat.value, want: target.textContent, n: items.length }
  })
  if (pick.err) {
    ok(false, 'S4 前置：列表里有可点的项（拿到 rect 的 `.mpw_select_item`）', 'pick.err=' + pick.err)
    skipItem('S4 点选项 ⇒ 原生 `<select>` 派发 `change` 且列表收起', '打开后列表里没有可点的项（上一条已按红报）')
  } else {
  cua.pointerGlide(g.ix + pick.x, g.iy + pick.y, { steps: 4, dwellMs: 60 }); await cua.sleep(180)
  cua.run('xdotool', ['click', '1']); await cua.sleep(800)
  const after = await page.evaluate(() => {
    const EL = [...document.querySelectorAll('.mpw_select')]
    const el = EL[Math.min(1, EL.length - 1)]
    const nat = el.previousElementSibling && el.previousElementSibling.tagName === 'SELECT' ? el.previousElementSibling : el.parentElement.querySelector('select[data-mpw-select-native]')
    return { value: nat.value, changed: window.__selChanged, lists: document.querySelectorAll('.mpw_select_list').length, label: el.querySelector('.mpw_select_label').textContent }
  })
  await shot('04-picked')
  ok(after.changed >= 1 && after.lists === 0, 'S4 点选项 ⇒ 原生 `<select>` 派发 `change` 且列表收起',
    `value ${pick.before} → ${after.value}（选项「${pick.want}」/ 按钮显示「${after.label}」）change=${after.changed} list=${after.lists}`)
  }
  }

  // ── S5 点外面 ⇒ 关 ───────────────────────────────────────────────────────
  const s5idx = info.roots > 1 ? 1 : 0
  const r5open = await clickUntil(s5idx, async () => (await listState()).n === 1)
  const o1 = await listState()
  //  ①打不开不是"未测"：下面的 S5 断言会如实变红（`o1.n === 1` 不成立）—— 这里只留一条读数。
  if (!r5open.ok) notes.push(`S5：列表没能打开（第 ${r5open.tries} 次点击后仍为 0）⇒ 下面的断言会红，不是"未测"`)
  //  ①"点外面"要点在**画布中央**（那里没有任何面板/链接）。第一版点左下角，命中了工具栏里一个链接
  //    ⇒ 整页导航 ⇒ `Execution context was destroyed`（测试自己崩，不是产品问题）。
  cua.pointerTo(g.ix + Math.round(VIEW.w * 0.6), g.iy + Math.round(VIEW.h * 0.35)); await cua.sleep(150)
  cua.run('xdotool', ['click', '1']); await cua.sleep(700)
  const o2 = await listState()
  ok(o1.n === 1 && o2.n === 0, 'S5 点页面空白 ⇒ 关闭', `${o1.n} → ${o2.n}`)

  // ── S6 键盘：ArrowDown + Enter ⇒ 选中下一项 ──────────────────────────────
  const kb = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.mpw_select')][0]
    const nat = el.previousElementSibling && el.previousElementSibling.tagName === 'SELECT' ? el.previousElementSibling : el.parentElement.querySelector('select[data-mpw-select-native]')
    el.querySelector('.mpw_select_btn').focus()
    return { value: nat.value, n: nat.options.length }
  })
  //  ①`ArrowDown` 在**关着**的时候只负责"打开"（与原生 select 一致：一次按键不该同时开+跳），
  //    所以这里发两次：第一次开、第二次移动高亮；然后 Enter 才提交。
  cua.run('xdotool', ['key', 'Down']); await cua.sleep(500)
  const kbOpen = await listState()
  cua.run('xdotool', ['key', 'Down']); await cua.sleep(400)
  cua.run('xdotool', ['key', 'Return']); await cua.sleep(800)
  const kb2 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.mpw_select')][0]
    const nat = el.previousElementSibling && el.previousElementSibling.tagName === 'SELECT' ? el.previousElementSibling : el.parentElement.querySelector('select[data-mpw-select-native]')
    return { value: nat.value, lists: document.querySelectorAll('.mpw_select_list').length }
  })
  ok(kbOpen.n === 1 && kb2.lists === 0 && kb2.value !== kb.value, 'S6 键盘 ArrowDown + Enter ⇒ 选中下一项并收起',
    `值 ${kb.value} → ${kb2.value}（ArrowDown 后列表 ${kbOpen.n} 个）`)

  // ── S7 翻转：把下拉分别滚到"视口底部"和"视口顶部"再开，至少各见一次 up / down ──
  const probeFlip = async (idx, block) => {
    await page.evaluate(({ idx, block }) => {
      const el = [...document.querySelectorAll('.mpw_select')][idx]
      if (el && el.scrollIntoView) el.scrollIntoView({ block, inline: 'nearest' })
    }, { idx, block })
    await page.waitForTimeout(300)
    const c = await clickUntil(idx, async () => (await listState()).n === 1)   // ①轮询打开（首次真点击可能被吞）
    const st = await listState()
    if (st.n === 1) await clickUntil(idx, async () => (await listState()).n === 0)   // 收起来（同样轮询）
    return { c, st }
  }
  //  ①只探前两个下拉（真机开合很贵：每次都要滚+点+等；本段的目的只是"真 DOM 里也见过 up/down 两种"，
  //    边界值由无浏览器的 `mpw-select-test` A 段 16 条钉住）。整段包 try/catch：Firefox 在本机偶发自己关掉，
  //    那是环境问题，不该把已经拿到的 S0–S6/S8 结论一起带崩。
  const flips = []
  const DO_FLIPS = argv.includes('--flips')          // ①默认跳过（整档从 ~4.5min 压到 ~2min；`--flips` 才跑）
  const nRoots = DO_FLIPS ? Math.min(info.roots, 2) : 0
  try {
    for (let i = 0; i < nRoots; i++) {
      const d = await probeFlip(i, 'start'); if (d.c.ok && d.st.n === 1) flips.push({ i, block: 'start', flip: d.st.flip, space: d.st.space })
      const u = await probeFlip(i, 'end'); if (u.c.ok && u.st.n === 1) flips.push({ i, block: 'end', flip: u.st.flip, space: u.st.space })
    }
  } catch (e) { notes.push('S7 探测中断（' + String(e.message).slice(0, 60) + '）⇒ 已拿到的 ' + flips.length + ' 次读数仍参与断言') }
  if (!DO_FLIPS) notes.push('S7 跳过（默认；加 `--flips` 才做真机翻转探测 —— 边界值由无浏览器的 mpw-select-test A 段 16 条钉住）')
  const sawUp = flips.filter((f) => f.flip === 'up').length
  const sawDown = flips.filter((f) => f.flip === 'down').length
  const allConsistent = flips.every((f) => !f.space || ((f.space.below >= f.space.want) ? f.flip === 'down' : (f.space.above >= f.space.want ? f.flip === 'up' : f.flip === (f.space.above > f.space.below ? 'up' : 'down'))))
  console.log('翻转实测: ' + JSON.stringify(flips.slice(0, 8)))
  if (DO_FLIPS) {
    ok(allConsistent, `S7 ${flips.length} 次"开"里每一次的 data-flip 都与可用空间一致`, `up=${sawUp} down=${sawDown}`)
    ok(sawDown >= 1, 'S7b 至少见过一次 **down**（默认方向）', `down=${sawDown}`)
  } else {
    /* ⚠ 2026-09-23：默认不跑是**显式取舍**（`--flips` 才做），但"没测到"要看得见 ⇒ 计数的 SKIP 读数。 */
    skipItem('S7b 至少见过一次 **down**（贴底自动上翻的探测）', '本轮未加 `--flips`（默认跳过；16 个边界值由无浏览器的 mpw-select-test A 段钉住）')
  }
  notes.push(sawUp >= 1 ? `S7c 见过 ${sawUp} 次 **up**（贴底自动上翻）` : 'S7c 本轮没构造出"下方不够"的位置 ⇒ 上翻只由无浏览器的 mpw-select-test A 段钉住（16 个边界值）')

  await shot('05-final')
  ok(errs.length === 0, '整轮 0 个 pageerror', errs.slice(0, 2).join(' | '))
  console.log(`\n shots: ${SHOTS}`)
  console.log(`\n── 汇总：PASS=${pass} FAIL=${fail} SKIP=${skipN}`)
  for (const n of notes) console.log('  note: ' + n)
  process.exitCode = fail ? 1 : 0
} finally {
  try { await browser.close() } catch { /* ignore */ }
  console.log('（浏览器已关闭；残留自查：ps -eo args | grep [f]irefox 应为空）')
}

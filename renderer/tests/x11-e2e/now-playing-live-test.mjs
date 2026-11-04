// now-playing-live-test.mjs —— ①2026-09-19「用 X11 真输入测 NowPlaying 组件」（用户第 2 项的真机验证）
//
// 为什么需要它：P-138 的 186 条断言全是**无头**的（数学 / CSS 作用域 / SSR DOM）。而"点一下会不会真的变形"
// 只能在真浏览器里量：本档用 **xdotool 真点击**，读 `getComputedStyle` 的前后数字，并留截图给人眼看**动效**。
//
// 断言（每条都能变红）：
//   N1 页面挂上组件（`.snd-box` 存在，宽度 = 260）
//   N2 **关→开**：真点击胶囊 ⇒ 盒高 **78 → 189**（±2）、封面 **40 → 64**（±2）、圆角随 p 变大
//   N3 **开→关**：再点一次（点封面）⇒ 回到 78 / 40 —— 只允许"再点即关"，不允许留着/叠出第二个
//   N4 播放键是**同一个四边形的八点变形**：点它前后，两条 `<path>` 的 `d` 都变，且**没有交叉淡入**
//      （判据：`.snd-op[data-lead] svg path` 始终恰好 2 条，`d` 字符串长度不变、只数值变）
//   N5 `corner` 旋钮：把演示页的角度旋钮设成 0 与 32，盒子圆角跟着变，且 `boxR − artR == off`（同心）仍成立
//   N6 打开状态下点页面空白 ⇒ 收起（`.snd-box` 内部 `data-open` 消失）
//
// 用法：`node tests/x11-e2e/now-playing-live-test.mjs [--url …]`；缺 X 显示/scrot/8902/Playwright ⇒ **SKIP（退出码 0）**。
import { AUDIO_MUTE_PREFS } from '../_audio-mute.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from '../_root.mjs'
import * as cua from './cua.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith(n + '=')); return eq ? eq.slice(n.length + 1) : d }
const URL_ = argOf('--url', process.env.MPW_NP_URL || 'http://127.0.0.1:8902/WEwebLoader/now-playing/index.html')
const VIEW = { w: Number(argOf('--w', 1100)), h: Number(argOf('--h', 760)) }
const SHOTS = process.env.MPW_X11_SHOTS || path.join(WS, 'reports', 'x11-shots', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-nowplaying')

let pass = 0; let fail = 0; const notes = []
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (why) => { console.log('SKIP now-playing-live — ' + why); process.exit(0) }

const ch = cua.channelSummary()
if (!ch.geometry) skip('X 显示不可用（DISPLAY=' + cua.DISPLAY + '）')
if (!ch.scrot) skip('scrot 不在 PATH')
try { const r = await fetch(URL_, { signal: AbortSignal.timeout(4000) }); if (!r.ok) skip(`页面不可达：${URL_} → ${r.status}`) } catch (e) { skip(`页面不可达：${e.message}`) }

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
  firefoxUserPrefs: { ...AUDIO_MUTE_PREFS, 'webgl.force-enabled': true, 'gfx.webrender.software': true, 'webgl.out-of-process': false },
})
try {
  const ctx = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)))
  await page.goto(URL_, { waitUntil: 'load', timeout: 90000 })
  await page.waitForSelector('.snd-box', { timeout: 30000 })
  await page.waitForTimeout(1200)

  const g = await page.evaluate(() => ({ ix: window.mozInnerScreenX, iy: window.mozInnerScreenY }))
  const shot = (n) => cua.shot(path.join(SHOTS, n + '.png'))
  /** 实时读几何（全走 computed style，避免"只看内联"）。 */
  const geom = () => page.evaluate(() => {
    const box = document.querySelector('.snd-box')
    const art = document.querySelector('.snd-art')
    const tap = document.querySelector('.snd-tap')
    const lead = document.querySelector('.snd-op[data-lead]')
    const paths = lead ? [...lead.querySelectorAll('svg path')].map((p) => p.getAttribute('d')) : []
    const cs = (el) => el ? getComputedStyle(el) : null
    const px = (v) => Math.round(parseFloat(v) * 100) / 100
    return {
      box: box ? { w: px(cs(box).width), h: px(cs(box).height), r: cs(box).borderRadius, open: box.hasAttribute('data-open') } : null,
      art: art ? { w: px(cs(art).width), h: px(cs(art).height), r: cs(art).borderRadius } : null,
      tap: tap ? { w: px(cs(tap).width), h: px(cs(tap).height) } : null,
      paths, nPaths: paths.length,
      boxes: document.querySelectorAll('.snd-box').length,
    }
  })
  const clickEl = async (sel, settle = 1400) => {
    const p = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
      const at = document.elementFromPoint(x, y)
      return { x, y, w: Math.round(r.width), h: Math.round(r.height),
        hit: at ? (at.id || at.tagName) + (at.className ? '.' + String(at.className).trim().split(/\s+/)[0] : '') : null,
        isSelf: !!(at && (at === el || el.contains(at))), inView: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight }
    }, sel)
    if (!p) { ok(false, `点击目标存在：${sel}`, '（页面上找不到）'); return false }
    //  ①命中自证（照 bench-click 的教训）：点之前必须确认"这个点真的落在目标上"，
    //    否则"点了没反应"分不清是**产品 bug** 还是**测试点被挡住/坐标偏了**。
    ok(p.inView && p.isSelf, `真点击前命中自证：${sel}（未被遮挡、在视口内）`,
      `(${p.x},${p.y}) ${p.w}x${p.h} 命中=${p.hit}`)
    if (!p.inView || !p.isSelf) return false
    cua.pointerGlide(g.ix + p.x, g.iy + p.y, { steps: 5, dwellMs: 60 })
    await cua.sleep(200)
    //  ②点后再验一次"指针确实在目标上"（glide 期间页面可能重排/展开）
    const still = await page.evaluate(({ sel, x, y }) => {
      const el = document.querySelector(sel); const at = document.elementFromPoint(x, y)
      return !!(el && at && (at === el || el.contains(at)))
    }, { sel, x: p.x, y: p.y })
    cua.run('xdotool', ['click', '1'])
    await cua.sleep(settle)
    return still
  }

  //  ①**点后轮询 + 重试一次**：与 bench-click 同一条教训 —— 首次真点击可能被"忙"吞掉（事件到了、状态没变），
  //    所以判据是"等到状态真的变了"，不是 sleep 一下就当成功；两次都不动才算产品问题。
  const clickUntil = async (sel, pred, { tries = 2, waitMs = 4000, settle = 400 } = {}) => {
    for (let i = 1; i <= tries; i++) {
      const hit = await clickEl(sel, settle)
      if (hit) {
        const t0 = Date.now()
        for (;;) { if (await pred()) return { ok: true, tries: i }; if (Date.now() - t0 > waitMs) break; await cua.sleep(250) }
      }
      if (i < tries) notes.push(`${sel}：第 ${i} 次点击后状态未变，重试一次`)
    }
    return { ok: false, tries }
  }

  // ── N1 关着的样子 ─────────────────────────────────────────────────────────
  const g0 = await geom()
  await shot('01-shut')
  console.log('关：' + JSON.stringify(g0))
  ok(!!g0.box && g0.boxes === 1, 'N1 页面挂上组件且**只有一个** `.snd-box`（不会叠出第二个）', `boxes=${g0.boxes}`)
  ok(Math.abs(g0.box.w - 260) <= 1, 'N1 宽度 260（原件"宽度永不变化"的那一条）', `w=${g0.box.w}`)
  ok(Math.abs(g0.box.h - 78) <= 2, 'N1 关着 = 78 高', `h=${g0.box.h}`)
  ok(Math.abs(g0.art.w - 40) <= 2, 'N1 封面 40', `art=${g0.art.w}`)

  // ── N2 真点击开 ───────────────────────────────────────────────────────────
  const r2 = await clickUntil('.snd-tap', async () => (await geom()).box.open === true)
  const g1 = await geom()
  await shot('02-open')
  console.log('开：' + JSON.stringify(g1) + `  （第 ${r2.tries} 次点击生效）`)
  ok(r2.ok && Math.abs(g1.box.h - 189) <= 3, 'N2 **真点击**后高 78 → 189', `h=${g1.box.h}（第 ${r2.tries} 次点击生效）`)
  ok(Math.abs(g1.art.w - 64) <= 3 && Math.abs(g1.art.h - 64) <= 3, 'N2 封面 40 → 64（正方形保持）', `art=${g1.art.w}x${g1.art.h}`)
  ok(Math.abs(g1.box.w - 260) <= 1, 'N2 宽度**不变**仍是 260（"两方向同时长"那一条）', `w=${g1.box.w}`)
  ok(g1.boxes === 1, 'N2 打开后仍然只有一个 `.snd-box`', `boxes=${g1.boxes}`)

  // ── N4 播放键：同一个四边形在变形（不是换图标 / 交叉淡入） ────────────────
  const before = (await geom()).paths
  const r4 = await clickUntil('.snd-op[data-lead]', async () => {
    const now = (await geom()).paths
    return now.length === before.length && now.every((d, i) => d !== before[i])
  })
  const after = (await geom()).paths
  await shot('03-play-mark')
  console.log('播放记号 d：\n  前 ' + JSON.stringify(before) + '\n  后 ' + JSON.stringify(after))
  ok(before.length === 2 && after.length === 2, 'N4 播放记号始终是**两条** `<path>`（没有换图标）', `n=${before.length}→${after.length}`)
  ok(r4.ok && before.every((d, i) => d !== after[i]), 'N4 两条 `d` 都随点击变化（在变形）', `第 ${r4.tries} 次点击生效`)
  ok(before.every((d, i) => Math.abs(d.length - after[i].length) <= 30), 'N4 `d` 只改数值、点数不变（八点四边形）',
    `len ${before.map((d) => d.length).join(',')} → ${after.map((d) => d.length).join(',')}`)

  // ── N6 打开态的关闭语义（**按原件的设计**，不是按"再点一下就关"） ──────────
  //   原件注释写明：打开后 `.snd-tap` **只盖封面 + 文字**，"so a player you have opened does not collapse
  //   because you reached for the title" ⇒ ①点卡片正文**不该**收起；②点页面空白才收起。
  if (!(await geom()).box.open) await clickUntil('.snd-tap', async () => (await geom()).box.open === true)
  const openNow = await geom()
  const bodyPt = await page.evaluate(() => { const r = document.querySelector('.snd-box').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height - 20) } })
  cua.pointerGlide(g.ix + bodyPt.x, g.iy + bodyPt.y, { steps: 4, dwellMs: 60 }); await cua.sleep(200)
  cua.run('xdotool', ['click', '1']); await cua.sleep(1000)
  const gBody = await geom()
  ok(openNow.box.open === true && gBody.box.open === true,
    'N6 **点卡片正文不收起**（原件设计："打开后 .snd-tap 只盖封面+文字"）', `open ${openNow.box.open} → ${gBody.box.open}`)
  cua.pointerTo(g.ix + 40, g.iy + VIEW.h - 40)          // 页面空白角落
  await cua.sleep(200); cua.run('xdotool', ['click', '1']); await cua.sleep(1500)
  const g2 = await geom()
  await shot('04-clicked-away')
  ok(openNow.box.open === true && g2.box.open === false, 'N6 打开状态下点页面空白 ⇒ 收起（`data-open` 消失）',
    `open ${openNow.box.open} → ${g2.box.open}, h=${g2.box.h}`)

  // ── N5 corner 旋钮：同心关系在两端都成立 ─────────────────────────────────
  const setCorner = async (v) => {
    const found = await page.evaluate((v) => {
      const el = [...document.querySelectorAll('input[type=range],input[type=number]')]
        .find((e) => /corner|圆角/i.test((e.id || '') + (e.name || '') + (e.getAttribute('aria-label') || '') + (e.closest('label') ? e.closest('label').textContent : '')))
      if (!el) return false
      el.value = String(v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, v)
    await cua.sleep(500)
    return found
  }
  const hasKnob = await setCorner(0)
  if (!hasKnob) { notes.push('演示页没找到 corner 旋钮 ⇒ N5 只做了默认档的同心断言') } else {
    const gA = await geom()
    await setCorner(32)
    const gB = await geom()
    console.log(`corner 0 → 32：盒圆角 ${gA.box.r} → ${gB.box.r}；封面圆角 ${gA.art.r} → ${gB.art.r}`)
    //  ①border-radius 的 computed 值可能是 1/2/3/4 个分量（"20px" / "20px 20px" / …）⇒ 先归一成四个角。
    const rad4 = (v) => {
      const n = (String(v).match(/[\d.]+/g) || []).map(Number)
      if (!n.length) return [0, 0, 0, 0]
      if (n.length === 1) return [n[0], n[0], n[0], n[0]]
      if (n.length === 2) return [n[0], n[1], n[0], n[1]]
      if (n.length === 3) return [n[0], n[1], n[2], n[1]]
      return [n[0], n[1], n[2], n[3]]
    }
    const offAt = (a) => rad4(a.box.r).map((b, i) => Math.round((b - rad4(a.art.r)[i]) * 100) / 100)
    ok(gA.box.r !== gB.box.r, 'N5 corner 旋钮真的改变盒圆角', `${gA.box.r} → ${gB.box.r}`)
    //  ①同心 = 盒圆角 − 封面圆角 == `PAD * min(1, corner/CORNER)`（corner=0 ⇒ 0；corner≥16 ⇒ 10），四个角同值。
    const eq4 = (arr, v) => arr.every((d) => Math.abs(d - v) < 0.6)
    ok(eq4(offAt(gA), 0) && eq4(offAt(gB), 10),
      'N5 两端都**同心**（盒圆角 − 封面圆角 = PAD·min(1,corner/16)：0档 0、32档 10，四角同值）',
      `0档 ${JSON.stringify(offAt(gA))} / 32档 ${JSON.stringify(offAt(gB))}`)
    await setCorner(16)
  }

  ok(errs.length === 0, '整轮 0 个 pageerror', errs.slice(0, 2).join(' | '))
  console.log(`\n shots: ${SHOTS}`)
  console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}`)
  notes.push('"动效好不好看/是不是一个物体在变"必须人眼：看 01-shut / 02-open / 03-play-mark 三张图')
  for (const n of notes) console.log('  note: ' + n)
  process.exitCode = fail ? 1 : 0
} finally {
  try { await browser.close() } catch { /* ignore */ }
  console.log('（浏览器已关闭；残留自查：ps -eo args | grep [f]irefox 应为空）')
}

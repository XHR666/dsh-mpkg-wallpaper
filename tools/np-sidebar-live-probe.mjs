#!/usr/bin/env node
/**
 * np-sidebar-live-probe.mjs —— **真机（:3080 用户 DSH）**验证 NP-1「Now playing 挂到左侧栏「设置」上方」
 *
 * 为什么需要它（而不是只靠 `tools/now-playing-test.mjs`）：
 *   那条门禁是**无浏览器**的（桩 DOM + 真 client.js），它能证"零注入/单实例/文档序"，
 *   但证不了"**真的挂在你的 DSH 里**"：宿主 slot 是否渲染、真 DOM 里的文档序、
 *   侧栏收起时宿主自己的状态（`data-sidebar-collapsed` / `wide` / 栏宽 56px）是否真能让组件隐藏。
 *   这三件事只有对**真实的 `dsh web`（:3080）**跑一次才算数 —— 本工具就是那次跑的固化版本。
 *
 * 做法：自签一枚 DSH 鉴权 Cookie（`tools/hdr-probe-mint-cookie.mjs`，只读密钥、只写 Cookie 文件），
 *   用 **headless** Firefox 打开 `:3080`，走**真 GUI 路径**：
 *     侧栏「设置」→ 设置页左边「壁纸引擎背景」→ 面板内「壁纸设置」tab → 找到 Now playing 那一行 → 点它的开关。
 *   然后判定 12 条（任一不满足 ⇒ 退出码 1）：
 *     L0 宿主锚点在位（`[data-slot="sidebar.footer.action"]`）
 *     L1 能进插件分区、L2 能找到 Now playing 那一行（**最内层行**匹配，避免命中外层容器）
 *     L3 找到 Now playing 那一行
 *     L4 打开开关 ⇒ **恰好 1 个** `[data-mpw-now-playing]`（不是 0、不是 2）
 *     L5 该节点在**文档序**上位于「设置」入口之前（`compareDocumentPosition` FOLLOWING）
 *     L5b 宿主 slot 出口**真的**渲染出来了（组件重锚进 slot；等最多 10s）—— L6 说的是**那之后**的状态
 *     L6 重锚进 slot 之后仍然不带 `data-mpw-np-hidden`
 *     L6b **时间线判据**：展开态（栏宽 ≥96 且宿主没有 collapsed 标记）的**任何一拍**都不许带 hidden
 *     L6c 再抽 3 拍（1.5s）确认 hidden 不会"过一会儿自己冒出来"（隐藏粘住 = ①(NP-2) 修掉的那条）
 *     L7 点宿主的「收起侧边栏」⇒ 节点带上 `data-mpw-np-hidden`（栏宽 56px）
 *     L8 整轮 0 个 pageerror
 *   两态各存一张截图（`--out`，默认 `/tmp/np-live/`）供人眼复核。
 *
 * ①(NP-2 2026-09-19 真机复核)：L5b/L6b/L6c 是**上一轮真机跑出来的 bug**固化成的判据 ——
 *   第二次加载（开关已开）时宿主 slot 出口在 t≈8s 才渲染，组件重锚进 slot 的那一刻，
 *   宿主交下来的 `wide=false` 把 256px 展开的侧栏判成收起 ⇒ 组件自己写上 hidden 且**粘住**
 *   （用户视角 = 刷新后控件自己消失）。根因/修法/时间线见 docs/NOW-PLAYING-DSH.md §7.6。
 *
 * 用法：
 *   node tools/np-sidebar-live-probe.mjs                 # 需要 :3080 在跑 + 已装本插件（update-plugin.sh 同步过）
 *   node tools/np-sidebar-live-probe.mjs --keep-off      # 验完把开关**关回去**（默认保持打开，便于用户直接看到）
 *   node tools/np-sidebar-live-probe.mjs --out <dir>
 *
 * ⚠ 副作用（如实写明）：①会**写**用户的插件设置一次（开关从关到开；`--keep-off` 会再关回去）；
 *   ②会自签 Cookie 到 `--out` 目录；③headless Firefox，峰值内存 ~600MB，跑前请看一眼 `free -m`。
 * ⚠ 这是**真机探针**，不进默认门禁（`tests/run-all-tests.sh` 那种秒级判据不该依赖用户 DSH 在不在）。
 *   **但判据本身**有无浏览器自证：`--selftest`（合成时间线，秒级、零副作用、不起 Firefox）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const OUT = arg('out', '/tmp/np-live')
const KEEP_OFF = argv.includes('--keep-off')
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const PLUGIN = path.resolve(import.meta.dirname, '..')

/** ①(NP-2) L6b 的判据：**展开态**（有我们的节点 + 栏宽 ≥96 + 宿主没有 collapsed 标记）却带 hidden 的拍子。 */
function expandedHiddenViolations(tl) {
  return (tl || []).filter((s) => s.np === 1 && s.colW >= 96 && !s.frameCollapsed && s.hidden > 0)
}

/* ①(NP-2) `--selftest`：**不起浏览器、不写设置、不签 Cookie**，只验上面这条判据有没有分辨力
   （合成两条时间线：一条是上一轮真机 bug 的形状、一条是修好后的形状、一条是真收起）。
   为什么要它：探针平时要 :3080 + Firefox，而"判据写错了/永远为真"必须能在秒级查到。 */
if (argv.includes('--selftest')) {
  let p = 0, f = 0
  const ck = (c, label, extra = '') => { if (c) { p++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { f++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
  const buggy = [
    { t: 2000, np: 1, hidden: 0, colW: 256, frameCollapsed: false, slotWide: '-', anchor: 'settings-slot' },
    { t: 8000, np: 1, hidden: 1, colW: 256, frameCollapsed: false, slotWide: '0', anchor: 'slot' },  /* ← 真机 bug 那一拍 */
    { t: 10000, np: 1, hidden: 1, colW: 256, frameCollapsed: false, slotWide: '0', anchor: 'slot' },
  ]
  const fixed = buggy.map((s) => Object.assign({}, s, { hidden: 0 }))
  const reallyCollapsed = [
    { t: 12000, np: 1, hidden: 1, colW: 56, frameCollapsed: true, slotWide: '0', anchor: 'slot' },   /* 真收起 ⇒ 隐藏是对的 */
  ]
  ck(expandedHiddenViolations(buggy).length === 2, 'S1 上一轮真机 bug 的时间线必须被判据抓到', '违规 ' + expandedHiddenViolations(buggy).length + ' 拍')
  ck(expandedHiddenViolations(fixed).length === 0, 'S2 修好后的时间线必须 0 违规')
  ck(expandedHiddenViolations(reallyCollapsed).length === 0, 'S3 真收起（56px + 宿主 collapsed 标记）不算违规 —— 判据不许把"该隐藏"也判红')
  ck(expandedHiddenViolations([{ np: 0, hidden: 0, colW: 256, frameCollapsed: false }]).length === 0, 'S4 开关关着（np=0）时不算违规')
  console.log('\n── selftest 汇总：PASS=' + p + ' FAIL=' + f + '（未起浏览器、未写设置）')
  process.exit(f > 0 ? 1 : 0)
}

fs.mkdirSync(OUT, { recursive: true })
const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP np-sidebar-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP np-sidebar-live-probe — playwright 没有 firefox 导出'); process.exit(0) }

const NP = '[data-mpw-now-playing]'
const SLOT = '[data-slot="sidebar.footer.action"]'
const SETTINGS = '[data-slot="sidebar.settings"]'
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

const browser = await firefox.launch({ headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)))
  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector(SETTINGS, { timeout: 60000 })

  const state = () => page.evaluate(({ NP, SLOT, SETTINGS }) => {
    const nodes = [...document.querySelectorAll(NP)]
    const set = document.querySelector(SETTINGS)
    const root = document.querySelector('[data-mpw-sidebar-root]')
    const col = document.querySelector('[class*="sidebarCol"]')
    const slotDiv = document.querySelector('[data-mpw-np-slot]')
    return {
      np: nodes.length,
      hidden: nodes.filter((n) => n.hasAttribute('data-mpw-np-hidden')).length,
      inSlot: !!(nodes[0] && nodes[0].closest(SLOT)),
      slot: !!document.querySelector(SLOT),
      beforeSettings: nodes[0] && set ? !!(nodes[0].compareDocumentPosition(set) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
      anchor: nodes[0] ? nodes[0].getAttribute('data-mpw-np-anchor') : null,
      /* ①(NP-2) 诊断三件套：宿主交下来的 wide（我们那个 slot div 上自己写的 data-mpw-np-wide）、
         AppFrame 的 collapsed 标记、侧栏根上有没有 collapsed 类。bug 就出在这三者的组合上。 */
      slotWide: slotDiv ? (slotDiv.getAttribute('data-mpw-np-wide') === null ? '-' : slotDiv.getAttribute('data-mpw-np-wide')) : 'n/a',
      frameCollapsed: !!document.querySelector('[data-sidebar-collapsed]'),
      rootCollapsed: !!(root && /collapsed/.test(String(root.className || ''))),
      colW: col ? Math.round(col.getBoundingClientRect().width) : -1,
      rootW: root ? Math.round(root.getBoundingClientRect().width) : -1,
    }
  }, { NP, SLOT, SETTINGS })

  /* ①(NP-2) 时间线采样：宿主 slot 出口是**晚一步**才渲染出来的（真机实测 t≈8s），
     而 bug 恰好发生在"重锚进 slot 的那一刻"。所以这里先按 250ms 采样，
     把那一帧抓在手里 —— 既当诊断输出，也是 L6b 的判据（展开态任何一拍都不许 hidden）。 */
  const t0 = Date.now()
  const timeline = []
  const push = async () => { const s = await state(); s.t = Date.now() - t0; timeline.push(s); return s }
  await push()
  let slotAt = -1
  for (let i = 0; i < 44; i++) {
    await page.waitForTimeout(250)
    const s = await push()
    if (slotAt < 0 && s.anchor === 'slot') slotAt = timeline.length - 1
    if (slotAt >= 0 && timeline.length - 1 - slotAt >= 8) break   /* slot 到位后再看 2s */
  }
  {
    let prev = null
    const lines = []
    for (const s of timeline) {
      const key = [s.np, s.hidden, s.anchor, s.inSlot, s.colW, s.slotWide, s.frameCollapsed, s.rootCollapsed].join('|')
      if (key === prev) continue
      prev = key
      lines.push('  t≈' + String(s.t).padStart(5) + 'ms  np=' + s.np + ' hidden=' + s.hidden
        + ' anchor=' + String(s.anchor) + ' inSlot=' + s.inSlot + ' colW=' + s.colW
        + ' slotWide=' + s.slotWide + ' frameCollapsed=' + s.frameCollapsed + ' rootCollapsed=' + s.rootCollapsed)
    }
    console.log('时间线（250ms/拍，只打印变化行，共 ' + timeline.length + ' 拍）:\n' + lines.join('\n'))
  }

  const s0 = timeline[timeline.length - 1]
  console.log('初始: ' + JSON.stringify(s0))
  ok(s0.slot, 'L0 宿主 slot 在位（' + SLOT + '）')

  // ① 侧栏「设置」→ 设置页左边「壁纸引擎背景」（**精确文本**，取最内层元素，避免命中外层容器）
  await page.evaluate((sel) => { const b = document.querySelector(sel + ' button') || document.querySelector(sel); if (b) b.click() }, SETTINGS)
  await page.waitForTimeout(3000)
  const nav = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === '壁纸引擎背景' && e.getBoundingClientRect().width > 0)
    const el = all[all.length - 1]
    if (!el) return { found: false }
    ;(el.closest('button,[role="tab"],[role="button"],li') || el).click()
    return { found: true, tag: (el.closest('button,[role="tab"],[role="button"],li') || el).tagName }
  })
  ok(nav.found, 'L1 设置页找到并点进插件分区「壁纸引擎背景」', JSON.stringify(nav))
  await page.waitForTimeout(2500)

  // ② 面板内「壁纸设置」tab（Now playing 那一行在这个 tab 里）
  const tab = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === '壁纸设置' && b.getBoundingClientRect().width > 0)
    if (!bs.length) return { found: false }
    bs[0].click()
    return { found: true, n: bs.length }
  })
  ok(tab.found, 'L2 面板内找到并点开「壁纸设置」tab', JSON.stringify(tab))
  await page.waitForTimeout(2500)

  // ③ Now playing 那一行：**最内层** `.mpw_row/.mpw_field`（它自己不再含同类行）
  let found = false
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.mpw_row,.mpw_field')].some((r) => /Now playing/i.test(r.textContent || '') && !r.querySelector('.mpw_row,.mpw_field')), null, { timeout: 15000, polling: 300 })
    found = true
  } catch { /* 下面用 row=null 判定 */ }
  const row = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.mpw_row,.mpw_field')].filter((r) => /Now playing/i.test(r.textContent || '') && !r.querySelector('.mpw_row,.mpw_field'))
    const r = rows[0]
    if (!r) return null
    const inp = r.querySelector('input[type=checkbox],[role=switch],button')
    return { text: (r.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 72), inpTag: inp ? inp.tagName + (inp.type ? ':' + inp.type : '') : null }
  })
  ok(found && !!row, 'L3 找到 Now playing 那一行（最内层行匹配）', JSON.stringify(row))

  const before = await state()
  if (before.np === 0 && row) {
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.mpw_row,.mpw_field')].filter((r) => /Now playing/i.test(r.textContent || '') && !r.querySelector('.mpw_row,.mpw_field'))
      const inp = rows[0] && rows[0].querySelector('input[type=checkbox],[role=switch],button')
      if (inp) inp.click()
    })
    await page.waitForTimeout(2500)
  } else {
    console.log('note: 开关本来就是开的（NP 节点 ' + before.np + ' 个）⇒ 跳过"打开"动作')
  }
  const s1 = await state()
  console.log('开档: ' + JSON.stringify(s1))
  ok(s1.np === 1, 'L4 打开开关 ⇒ **恰好 1 个** `' + NP + '`（不是 0 也不是 2）', 'np=' + s1.np + ' anchor=' + s1.anchor)
  ok(s1.inSlot === true || s1.beforeSettings === true, 'L5 挂载点在「设置」入口**上方**（文档序在前；落在宿主 slot 内最佳）', 'inSlot=' + s1.inSlot + ' beforeSettings=' + s1.beforeSettings)
  /* ①(NP-2) L6 说的是"重锚进 slot **之后**"的状态 ⇒ 先等宿主 slot 出口真的渲染出来（最多 10s）。
     上一轮真机 bug 就发生在这一步：等到 slot 的同时 wide=false 到了，组件把自己藏了。 */
  let sSlot = null
  for (let i = 0; i < 40; i++) {
    const s = await state()
    if (s.anchor === 'slot') { sSlot = s; break }
    await page.waitForTimeout(250)
  }
  ok(!!sSlot, 'L5b 宿主 slot 出口真的渲染出来了（组件重锚进 slot；最多等 10s）',
    sSlot ? ('anchor=' + sSlot.anchor + ' inSlot=' + sSlot.inSlot + ' slotWide=' + sSlot.slotWide) : '10s 内没等到')
  const s6 = sSlot || s1
  ok(s6.hidden === 0, 'L6 重锚进 slot 之后**仍然**不带 `data-mpw-np-hidden`（展开态）',
    'hidden=' + s6.hidden + ' colW=' + s6.colW + ' slotWide=' + s6.slotWide + ' frameCollapsed=' + s6.frameCollapsed)
  /* L6b：时间线判据 —— 展开态（栏宽 ≥96 且宿主没有 collapsed 标记）的任何一拍都不许 hidden。
     这条比 L6 严：它不看"最后一眼"，而是看**整个过程**（粘住型 bug 只有在过程里才看得见）。 */
  {
    const expanded = timeline.filter((s) => s.np === 1 && s.colW >= 96 && !s.frameCollapsed)
    const bad = expandedHiddenViolations(timeline)
    ok(bad.length === 0, 'L6b 展开态的**任何一拍**都不许带 hidden（看整个过程，不只看最后一眼）',
      '展开态样本 ' + expanded.length + ' 拍 / 违规 ' + bad.length + ' 拍'
      + (bad.length ? '：' + bad.slice(0, 3).map((s) => 't≈' + s.t + 'ms(hidden=' + s.hidden + ',slotWide=' + s.slotWide + ')').join(' ') : ''))
    /* L6c：再抽 3 拍（1.5s）确认 hidden 不会"过一会儿自己冒出来" */
    const later = []
    for (let i = 0; i < 3; i++) { await page.waitForTimeout(500); later.push(await state()) }
    const lateBad = later.filter((s) => s.hidden > 0)
    ok(lateBad.length === 0, 'L6c 之后 1.5s 内 hidden 不会自己冒出来（"过一会儿消失"就是这条抓）',
      later.map((s) => 'hidden=' + s.hidden + '/colW=' + s.colW).join(' '))
  }
  await page.screenshot({ path: path.join(OUT, '01-mounted.png') })

  // ④ 收起侧栏（点宿主自己的「收起侧边栏」）⇒ 必须隐藏
  const col = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button,[role=button]')]
    const el = cands.find((e) => /收起|折叠|collapse/i.test((e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '')) && e.getBoundingClientRect().width > 0)
    if (!el) return { via: 'none' }
    ;(el.querySelector('button') || el).click()
    return { via: 'button', label: (el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 24) }
  })
  await page.waitForTimeout(1800)
  let s2 = await state()
  if (s2.hidden === 0 && s2.colW > 96) {          // 找不到收起控件时退到窄视口（宿主自己会收起）
    await page.setViewportSize({ width: 620, height: 900 })
    await page.waitForTimeout(2000)
    s2 = await state()
    col.via += '+viewport'
  }
  console.log('收起档: ' + JSON.stringify(s2) + '  触发=' + JSON.stringify(col))
  await page.screenshot({ path: path.join(OUT, '02-collapsed.png') })
  ok(s2.hidden === 1, 'L7 侧栏收起 ⇒ NP 节点带 `data-mpw-np-hidden`', 'hidden=' + s2.hidden + ' colW=' + s2.colW + ' 触发=' + col.via)
  ok(errs.length === 0, 'L8 整轮 0 个 pageerror', errs.slice(0, 2).join(' | '))

  // 可选：把开关关回去（默认**保持打开**，让用户刷新就能看到）
  if (KEEP_OFF) {
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.mpw_row,.mpw_field')].filter((r) => /Now playing/i.test(r.textContent || '') && !r.querySelector('.mpw_row,.mpw_field'))
      const inp = rows[0] && rows[0].querySelector('input[type=checkbox],[role=switch],button')
      if (inp) inp.click()
    })
    await page.waitForTimeout(2000)
    const s3 = await state()
    ok(s3.np === 0, 'L9 `--keep-off` ⇒ 关回去后 **0 个** NP 节点（零注入）', 'np=' + s3.np)
  }

  console.log('\n── 汇总：PASS=' + pass + ' FAIL=' + fail + '  截图 ' + path.join(OUT, '01-mounted.png') + ' / ' + path.join(OUT, '02-collapsed.png'))
  process.exitCode = fail > 0 ? 1 : 0
} finally {
  try { await browser.close() } catch { /* ignore */ }
}

#!/usr/bin/env node
/**
 * dir-picker-probe.mjs —— 选择器（选择文件夹）真机探针：无头 Firefox 打开**真实 DSH GUI**，
 * 打开选择器弹窗，注入 scrollTop/焦点/节点重建钩子，然后做「改前 ↔ 改后」A/B。
 *
 * 为什么需要它（用户第 13 条「长期没修好」的 bug）：
 *   假 DOM 断言能证明机制，但真机上"到底有没有人写 scrollTop / 节点有没有被重建"必须实测。
 *   本脚本在**同一次浏览器启动内**跑完 A/B：
 *     before = 当前 profile 里已安装的副本（旧代码）
 *     → 脚本自己执行**工作区根**的 update-plugin.sh（同步新代码 + 触发 patch 热重载）
 *     → page.reload() → after = 新代码
 *
 * 证据（落盘 tools/probe-out/）：
 *   dirpick-before.json / dirpick-after.json —— 每次 scrollTop 写入（含调用栈）、焦点变化、
 *                                              列表节点重建、滚轮串联宿主、各阶段 scrollTop 采样
 *   dirpick-probe.txt                        —— 人读结论 + 断言
 *
 * 内存纪律：**一次启动、跑完立刻 close**；失败（没走到弹窗）也要落盘诊断，便于下一轮直接改选择器。
 *
 * 用法: node tools/dir-picker-probe.mjs [--headed] [--no-ab] [--url http://127.0.0.1:3080/]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')

// ①(2026-09-19 敏感信息加固) 工作区根 = **仓库的上一级**（语料/WE 资产在它下面）：
// 由**脚本自身位置**推导，兜底默认不再写作者本机绝对路径。优先级不变：参数 > env > 这里。
const WS = path.resolve(ROOT, '..');
const OUT = path.join(ROOT, 'tools', 'probe-out')
fs.mkdirSync(OUT, { recursive: true })
const argv = process.argv.slice(2)
const HEADED = argv.includes('--headed')
const NO_AB = argv.includes('--no-ab')
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const URL0 = arg('url', 'http://127.0.0.1:3080/')
const COOKIE = '/tmp/ffprobe/cookie.json'

const log = []
const say = (s) => { console.log(s); log.push(s) }

// ---------- 注入到页面里的钩子（每次导航前安装）----------
const INIT_HOOK = () => {
  const P = { writes: [], focus: [], rebuilds: [], wheel: [], uid: 0, t0: Date.now() }
  window.__mpwDirPickProbe = P
  const ids = new WeakMap()
  const uidOf = (el) => { let u = ids.get(el); if (!u) { u = ++P.uid; ids.set(el, u) } return u }
  const isList = (el) => !!(el && el.classList && (el.classList.contains('mpw_dirList') || el.classList.contains('mpw_props')))
  // 子树根也要算：React 重挂弹窗时 observer 报的是外层 .mpw_mask 被 remove/add
  const touchesList = (el) => {
    try { return !!(el && el.querySelector && (isList(el) || el.querySelector('.mpw_dirList, .mpw_props'))) } catch (e) { return false }
  }
  try {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() { return d.get.call(this) },
      set(v) {
        try {
          if (isList(this)) P.writes.push({ uid: uidOf(this), cls: String(this.className || '').slice(0, 40), requested: Number(v), before: d.get.call(this), stack: String((new Error().stack) || '').split('\n').slice(1, 4).join(' | ').slice(0, 300), at: Date.now() - P.t0 })
        } catch (e) {}
        return d.set.call(this, v)
      }
    })
  } catch (e) { P.hookErr = String(e && e.message || e) }
  document.addEventListener('focusin', (e) => {
    try {
      const t = e.target
      const inList = !!(t && t.closest && t.closest('.mpw_dirList, .mpw_mask .mpw_props'))
      P.focus.push({ tag: t.tagName, cls: String(t.className || '').slice(0, 50), inList, row: !!(t.closest && t.closest('[data-mpw-diridx]')), at: Date.now() - P.t0 })
    } catch (e) {}
  }, true)
  // 列表节点整体被换掉 = 滚动位置天然丢失（本 bug 的核心机制），单独盯
  const watch = () => {
    try {
      const obs = new MutationObserver((recs) => {
        for (const r of recs) {
          for (const n of r.removedNodes) { if (touchesList(n)) P.rebuilds.push({ kind: 'removed', at: Date.now() - P.t0, uid: uidOf(n), cls: String(n.className || '').slice(0, 40) }) }
          for (const n of r.addedNodes) { if (touchesList(n)) P.rebuilds.push({ kind: 'added', at: Date.now() - P.t0, uid: uidOf(n), cls: String(n.className || '').slice(0, 40) }) }
        }
      })
      obs.observe(document.documentElement || document.body, { childList: true, subtree: true })
    } catch (e) {}
  }
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch)
}

const listSel = '.mpw_dirList, .mpw_mask .mpw_props'

async function findList(page) { return page.evaluate((sel) => { const el = document.querySelector(sel); return !!el }, listSel).catch(() => false) }

/** 点一个"可见且文本/aria-label/标题命中"的元素（自底向上找最内层可点元素）。 */
async function clickByText(page, patterns, opts) {
  const o = opts || {}
  return page.evaluate(({ pats, tagFilter }) => {
    const rx = pats.map((p) => new RegExp(p))
    const all = Array.from(document.querySelectorAll(tagFilter || 'button,[role="button"],a,li,div,span'))
    const vis = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
    const hit = vis.filter((e) => {
      const s = ((e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title'))) || '') + ' ' + (e.textContent || '').trim()
      return rx.some((r) => r.test(s))
    })
    if (!hit.length) return { ok: false, why: 'no-match' }
    hit.sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length)
    const el = hit[0]
    try { el.scrollIntoView({ block: 'nearest' }) } catch (e) {}
    try { el.click() } catch (e) { return { ok: false, why: 'click-threw:' + String(e && e.message || e) } }
    return { ok: true, text: (el.textContent || '').trim().slice(0, 40), cls: String(el.className || '').slice(0, 60) }
  }, { pats: patterns, tagFilter: o.tagFilter }).catch((e) => ({ ok: false, why: 'eval-threw:' + String(e && e.message || e) }))
}

/** 打开"设置 → 壁纸引擎背景 → 浏览…"直到选择器弹窗出现；返回 {reached, steps}。 */
async function openPicker(page) {
  const steps = []
  // ① 打开设置面板（齿轮/设置入口；文本与 aria-label 都试）
  for (const pats of [['^\\s*设置\\s*$', 'Settings'], ['设置', 'Setting'], ['⚙']]) {
    if (await findList(page)) break
    const r = await clickByText(page, pats)
    steps.push({ step: 'open-settings', pats, r })
    if (r.ok) { await page.waitForTimeout(1200); break }
  }
  // ② 设置左侧导航 → 我们的分区（zh: 壁纸引擎背景 / en: MPKG Wallpaper）
  const r2 = await clickByText(page, ['壁纸引擎背景', 'MPKG Wallpaper', '壁纸引擎'])
  steps.push({ step: 'nav-section', r: r2 })
  if (r2.ok) await page.waitForTimeout(1500)
  // ③ 面板里点「浏览…」（背景来源 tab 是默认 tab）
  const r3 = await clickByText(page, ['^\\s*浏览', 'Browse'])
  steps.push({ step: 'browse', r: r3 })
  if (r3.ok) {
    for (let i = 0; i < 20; i++) { await page.waitForTimeout(250); if (await findList(page)) break }
  }
  return { reached: await findList(page), steps }
}

async function measure(page, label) {
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { found: false }
    const r = el.getBoundingClientRect()
    const st = el.scrollTop
    // 最近的可滚动祖先（用于测"滚轮串联"）
    let anc = el.parentElement
    while (anc && !(anc.scrollHeight > anc.clientHeight + 4)) anc = anc.parentElement
    return {
      found: true, cls: String(el.className || ''), st, sh: el.scrollHeight, ch: el.clientHeight,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      overflowAnchor: getComputedStyle(el).overflowAnchor, overscroll: getComputedStyle(el).overscrollBehavior,
      anc: anc ? { cls: String(anc.className || '').slice(0, 60), st: anc.scrollTop, sh: anc.scrollHeight, ch: anc.clientHeight } : null,
      active: document.activeElement ? { tag: document.activeElement.tagName, cls: String(document.activeElement.className || '').slice(0, 50), isList: document.activeElement === el } : null,
      activedescendant: el.getAttribute('aria-activedescendant'),
      rowTabIdx: Array.from(el.querySelectorAll('button')).slice(0, 3).map((b) => b.getAttribute('tabindex')),
      dirs: Array.from(el.querySelectorAll('[data-mpw-dir]')).slice(0, 4).map((d) => d.getAttribute('data-mpw-dir')),
      rows: el.children.length,
    }
  }, listSel).catch((e) => ({ found: false, err: String(e && e.message || e) }))
  say(`  [${label}] ${JSON.stringify(info)}`)
  return info
}

async function wheelScroll(page, info, times) {
  if (!info.found) return []
  const cx = info.rect.x + Math.max(10, Math.floor(info.rect.w / 2))
  const cy = info.rect.y + Math.max(10, Math.floor(info.rect.h / 2))
  await page.mouse.move(cx, cy)
  const samples = []
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, 200)
    await page.waitForTimeout(160)
    samples.push(await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.scrollTop : null }, listSel))
  }
  say(`  滚轮 ${times} 次后的 scrollTop 序列: ${JSON.stringify(samples)}`)
  return samples
}

async function phase(page, label) {
  say(`\n=== 阶段 ${label} ===`)
  const open0 = await openPicker(page)
  say(`  到达选择器: ${open0.reached}` + (open0.reached ? '' : `（步骤: ${JSON.stringify(open0.steps)}）`))
  if (!open0.reached) {
    const cands = await page.evaluate(() => Array.from(document.querySelectorAll('button,[role="button"],a'))
      .map((e) => (((e.getAttribute('aria-label') || e.getAttribute('title') || '') + '|' + (e.textContent || '').trim()).slice(0, 40)))
      .filter((s) => s.replace('|', '').trim()).slice(0, 40)).catch(() => [])
    say('  可见入口候选（供下一轮改选择器）: ' + JSON.stringify(cands))
    await page.screenshot({ path: path.join(OUT, `dirpick-${label}-unreached.png`) }).catch(() => {})
    return { reached: false, steps: open0.steps, cands }
  }
  await page.evaluate(() => { const P = window.__mpwDirPickProbe; if (P) { P.writes.length = 0; P.focus.length = 0; P.rebuilds.length = 0 } })
  let m0 = await measure(page, 'opened')
  if (m0.found && m0.sh <= m0.ch + 4) {   // 不可滚动 ⇒ 换一个"子目录很多"的路径，否则滚轮断言是空跑
    const fat = arg('fat-path', WS)
    const r = await page.evaluate((p) => {
      const inp = document.querySelector('.mpw_dialog input.mpw_input, .mpw_mask input.mpw_input, input.mpw_input[type="text"], input.mpw_input')
      if (!inp) return { ok: false, why: 'no-input' }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, p)
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => /浏览|Browse/.test(b.textContent || ''))
      if (!btns.length) return { ok: false, why: 'no-browse' }
      btns[0].click()
      return { ok: true }
    }, fat).catch((e) => ({ ok: false, why: String(e && e.message || e) }))
    await page.waitForTimeout(1600)
    const m0b = await measure(page, 'opened-fat-path(' + fat + ')')
    say('  换胖目录: ' + JSON.stringify(r))
    if (m0b.found) m0 = m0b
  }
  say('  列表可滚动: ' + (m0.found ? (m0.sh > m0.ch + 4) : false) + ` (scrollHeight=${m0.sh} clientHeight=${m0.ch} rows=${m0.rows})`)
  const wheels = await wheelScroll(page, m0, 5)
  const m1 = await measure(page, 'after-wheel')
  // 主动制造一次"面板重渲染"（等价于用户滚轮期间宿主/面板因异步状态重渲染）：合成 input 事件
  const forced = await page.evaluate(() => {
    const inp = document.querySelector('.mpw_input[type="text"], input.mpw_input')
    if (!inp) return { ok: false }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, String(inp.value || '') + 'x')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  }).catch((e) => ({ ok: false, err: String(e && e.message || e) }))
  await page.waitForTimeout(500)
  const m2 = await measure(page, 'after-forced-rerender')
  // 再滚一次：列表到边界后继续滚 → 宿主祖先是否被带动（滚轮串联）
  // 真机键盘：↓↓ 两次（活动行应下移、焦点应仍在容器上、位置不应跳顶）
  const mBeforeKeys = await measure(page, 'before-keys')
  for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150) }
  const mKeys = await measure(page, 'after-2xArrowDown')
  await page.keyboard.press('Enter').catch(() => {})
  await page.waitForTimeout(900)
  const mAfterEnter = await measure(page, 'after-Enter')
  const ancBefore = m2.anc ? m2.anc.st : null
  await wheelScroll(page, m2, 4)
  const m3 = await measure(page, 'after-overscroll-wheel')
  const P = await page.evaluate(() => { const P = window.__mpwDirPickProbe || {}; return { writes: P.writes || [], focus: P.focus || [], rebuilds: P.rebuilds || [], hookErr: P.hookErr || null } })
  const out = {
    label, reached: true, rows: m0.rows, opened: m0, afterWheel: m1, forcedRerender: forced, afterForced: m2, afterOverscroll: m3,
    afterKeys: mKeys, afterEnter: mAfterEnter, stBeforeKeys: mBeforeKeys.st,
    wheels, ancBefore, ancAfter: m3.anc ? m3.anc.st : null,
    writes: P.writes, focus: P.focus, rebuilds: P.rebuilds, hookErr: P.hookErr,
  }
  fs.writeFileSync(path.join(OUT, `dirpick-${label}.json`), JSON.stringify(out, null, 2))
  say(`  证据已写 tools/probe-out/dirpick-${label}.json`)
  return out
}

// ---------- 主流程 ----------
if (!fs.existsSync(COOKIE)) {
  say('✗ 缺少 Cookie（先跑 node tools/hdr-probe-mint-cookie.mjs）')
  process.exit(2)
}
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))
const { firefox } = await import('playwright')
const browser = await firefox.launch({ headless: !HEADED, firefoxUserPrefs: { 'gfx.webrender.all': true, 'general.smoothScroll': false } })
let result = { before: null, after: null }
try {
  // ① 先把旧实现装回 profile（**必须在任何 goto 之前**）：
  //    宿主对客户端模块是有 HTTP 缓存的，若先加载新代码再换文件 + reload，浏览器会直接用缓存
  //    ⇒ before 阶段实际测的还是新代码（第一轮实测踩到的坑，证据见 probe-out/*.json 的 cls 字段）。
  const beforeClient = arg('before-client', '/tmp/dirpick-before-client.js')
  const PROFILE_CLIENT = '/root/.dsh/profiles/web/node_modules/dsh-mpkg-wallpaper/lib/client.js'
  const HAVE_BEFORE = !NO_AB && fs.existsSync(beforeClient)
  if (HAVE_BEFORE) {
    try {
      fs.copyFileSync(beforeClient, PROFILE_CLIENT)
      fs.utimesSync('/root/.dsh/profiles/web/cordis.patch.yml', new Date(), new Date())
      say('before 阶段：已把旧实现装回 profile（md5 ' + execFileSync('md5sum', [beforeClient], { encoding: 'utf8' }).split(' ')[0] + '）')
    } catch (e) { say('  ⚠ before 装回失败: ' + String(e && e.message || e)) }
  }
  const openPage = async (tag) => {
    // 每个阶段一个**全新 context**（空缓存）+ 关缓存头 ⇒ 一定从服务器取当前代码
    // ① 不要加 cache-control/pragma 头：那会让 `??模块1,模块2,…` 这条多模块 URL 加载卡在
    //   "HARNESS / Loading plugins…"（实测：整个应用起不来 ⇒ 三级文本选择器全 no-match）。
    //   每个阶段用**全新 context**（空缓存）已经足够保证"取到当前代码"。
    const ctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
    await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
    const p = await ctx.newPage()
    await p.addInitScript(INIT_HOOK)
    p.on('pageerror', (e) => say('  [pageerror] ' + String(e && e.message || e).slice(0, 160)))
    await p.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 45000 })
    // 等应用外壳就绪（"Loading plugins…" 阶段没有可点入口）——最多等 25s
    for (let i = 0; i < 25; i++) {
      await p.waitForTimeout(1000)
      const ready = await p.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button,[role="button"]'))
        return btns.some((b) => { const r = b.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
      }).catch(() => false)
      if (ready) break
    }
    await p.waitForTimeout(1500)
    // 自证：报告这一阶段页面里到底加载的是哪一版（旧版没有 .mpw_dirList 这个类）
    const ver = await p.evaluate(async () => {
      try {
        const rs = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /client|mpkg|wallpaper/i.test(n))
        for (const u of rs) {
          const t = await (await fetch(u, { cache: 'no-store' })).text()
          if (t.indexOf('mpw_dirList') >= 0 || t.indexOf('MPW-DIRPICK') >= 0) return { url: u, newCode: true, len: t.length }
        }
        return { urls: rs.slice(0, 6), newCode: null }
      } catch (e) { return { err: String(e && e.message || e) } }
    }).catch((e) => ({ err: String(e && e.message || e) }))
    say(`  [${tag}] 页面已加载；代码版本自证: ` + JSON.stringify(ver))
    return { ctx, page: p, ver }
  }
  const P1 = await openPage('before')
  result.before = await phase(P1.page, 'before')
  result.before.ver = P1.ver
  if (!NO_AB && (result.before && result.before.reached || HAVE_BEFORE)) {
    say('\n=== 同步新代码（update-plugin.sh）→ 新 context → after ===')
    try { say(execFileSync('bash', [path.join(WS, 'update-plugin.sh')], { encoding: 'utf8' }).trim()) } catch (e) { say('  update-plugin 失败: ' + String(e && e.message || e)) }
    const P2 = await openPage('after')
    result.after = await phase(P2.page, 'after')
    result.after.ver = P2.ver
  } else if (!result.before || !result.before.reached) {
    say('\n未到达选择器 ⇒ 跳过 after（诊断已落盘，下一轮按候选选择器改进）')
  }
} catch (e) {
  say('✗ 探针异常: ' + String(e && e.stack || e).slice(0, 600))
} finally {
  try { await browser.close() } catch {}
}

// ---------- 断言 ----------
say('\n=== 断言 ===')
let fail = 0
const B = result.before, A = result.after
const check = (name, cond, extra) => { say((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  —— ' + extra : '')); if (!cond) fail++ }
const inconclusive = []
if (!B || !B.reached) { say('  ⚠ before 未到达选择器 ⇒ 真机断言未执行（自动化受限），见 unreached 诊断'); fail++ }
else if (B.ver && B.ver.newCode === true) inconclusive.push('before 阶段页面实际加载的是**新代码**（宿主 HTTP 缓存/服务端缓存）⇒ 真机 A/B 的 before 半边不可判定，改前证据以假 DOM 对照为准')
else {
  check('before：容器无 overscroll-behavior:contain（滚轮会串联宿主）', String(B.opened.overscroll).indexOf('contain') < 0, 'overscroll=' + B.opened.overscroll)
  const bRebuild = (B.rebuilds || []).filter((r) => String(r.cls || '').indexOf('mask') >= 0)
  check('before：宿主重渲染会把选择器弹窗整棵子树重挂（.mpw_mask removed/added）', bRebuild.length >= 2, JSON.stringify(bRebuild.slice(0, 3)))
  check('before：**面板重渲染后列表 scrollTop 归零 = 用户报的"跳回最顶"（真机复现）**',
    B.afterWheel.st > 0 && B.afterForced.st === 0, `afterWheel=${B.afterWheel.st} → afterForced=${B.afterForced.st}`)
}
if (A && A.reached) {
  const z = (A.writes || []).filter((w) => w.requested === 0 && w.before !== 0)
  check('after：无任何"写回 0"的 scrollTop 写入', z.length === 0, JSON.stringify(z.slice(0, 2)))
  check('after：容器带 overscroll-behavior:contain', String(A.opened.overscroll).indexOf('contain') >= 0, 'overscroll=' + A.opened.overscroll)
  check('after：带 overflow-anchor:none', String(A.opened.overflowAnchor) === 'none', 'anchor=' + A.opened.overflowAnchor)
  const scrollable = A.opened.sh > A.opened.ch + 4
  if (!scrollable) inconclusive.push('after：列表在真机上不可滚动（该目录子目录太少，scrollHeight==clientHeight）⇒ 滚轮断言无分辨力')
  check('after：列表可滚动（滚轮断言的前提）', scrollable, `sh=${A.opened.sh} ch=${A.opened.ch} rows=${A.opened.rows}`)
  check('after：滚轮期间列表位置单调向下（无跳顶）', (A.wheels || []).every((v, i, arr) => i === 0 || v === null || arr[i - 1] === null || v >= arr[i - 1]), JSON.stringify(A.wheels))
  check('after：滚轮真的滚动了（不是空跑）', scrollable ? (A.wheels || []).some((v) => v > 0) : true, JSON.stringify(A.wheels))
  check('after：主动制造面板重渲染后列表位置保持', A.afterForced.st === A.afterWheel.st, `afterWheel=${A.afterWheel.st} afterForced=${A.afterForced.st}`)
  check('after：**即使弹窗子树被宿主重挂（mask removed/added），位置仍保持**',
    A.afterForced.st === A.afterWheel.st && A.afterWheel.st > 0,
    `afterWheel=${A.afterWheel.st} → afterForced=${A.afterForced.st}; 重挂事件=${(A.rebuilds || []).length}`)
  check('after：打开后 activeElement = 列表容器自身（不是行）', !!(A.opened.active && A.opened.active.isList), JSON.stringify(A.opened.active))
  const rowFocus = (A.focus || []).filter((f) => f.row)
  const containerFocus = (A.focus || []).filter((f) => f.inList && !f.row)
  check('after：全程没有任何"行"获得焦点（行 tabindex=-1 + mousedown 阻止聚焦）', rowFocus.length === 0, JSON.stringify(rowFocus.slice(0, 3)))
  say(`  · 容器自身 focus 次数 = ${containerFocus.length}（= 该阶段弹窗被挂载的次数 ⇒ 宿主确实会重挂弹窗）`)
  check('after：行内按钮 tabindex 全为 -1（Tab 跳过、点行不聚焦）', (A.opened.rowTabIdx || []).every((v) => String(v) === '-1'), JSON.stringify(A.opened.rowTabIdx))
  check('after：↓↓ 后活动行下移且不跳顶（键盘契约）', !!(A.afterKeys && A.afterKeys.activedescendant) && A.afterKeys.st === A.stBeforeKeys, `before=${A.stBeforeKeys} after=${A.afterKeys && A.afterKeys.st} aria=${A.afterKeys && A.afterKeys.activedescendant}`)
  check('after：列表到边界后宿主祖先未被带动', A.ancBefore === null || A.ancAfter === A.ancBefore, `ancBefore=${A.ancBefore} ancAfter=${A.ancAfter}`)
} else say('  ⚠ after 未执行（AB 未跑或未到达）')

fs.writeFileSync(path.join(OUT, 'dirpick-probe.txt'), log.join('\n') + '\n')
if (inconclusive.length) { say('\n=== 不可判定（环境限制，已如实记录，不计失败）==='); inconclusive.forEach((x) => say('  ⚠ ' + x)) }
say('\n证据: tools/probe-out/dirpick-before.json / dirpick-after.json / dirpick-probe.txt')
say(fail ? `真机探针：${fail} 项未通过/未执行` : '真机探针：全部通过 ✓')
process.exit(fail ? 1 : 0)

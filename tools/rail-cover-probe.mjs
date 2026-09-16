#!/usr/bin/env node
/**
 * rail-cover-probe.mjs —— 「右侧轮次时间线条看不见但能点」的**真机测量器**
 *
 * 为什么必须单独写它（第四轮定案的教训）：
 *   上一轮 header-rail-collect.mjs 在真页面上**没找到宿主 rail**（页面停在"新会话"，轮次 < 2
 *   ⇒ TurnNavigator 不渲染），于是插了一个**合成 rail**（`rail=synthetic`），结论建立在假节点上
 *   ⇒ 合成节点没有 `.eGxaPq_fadeTop/fadeBottom` 类、祖先里也没有 `[data-slot="conversation.session"]`，
 *     真实根因（被我们自己的"隐藏 fade"清扫内联 display:none）永远量不到。
 *   本工具：
 *     ① 真 cookie 打开真 DSH 页面，必要时**点进一个 ≥2 轮的历史会话**（TurnNavigator 才会渲染）；
 *     ② 只在 **rail=host** 上测量；采不到就明确 `rail=absent`，**不合成、不推断**；
 *     ③ 命中点判据：elementFromPoint/elementsFromPoint 整条链 —— 顶上是不是我们注入的层；
 *     ④ 祖先链逐级 display/opacity/filter/visibility/transform/clip-path/overflow/z-index/contain/
 *        isolation/pointer-events（找"被透明化/被裁/被 display:none"）；
 *     ⑤ **因果定位**：内联 style / hidden 属性 → 逐张样式表禁用 → 表内逐规则摘 display，
 *        每步都读 computed 并立即还原（"关掉它就变回来"才算数，语法命中不算）；
 *     ⑥ 挂钩 CSSStyleDeclaration/Element/Attr 的写入口 + MutationObserver，记录**谁写了内联
 *        display:none** 与调用栈；
 *     ⑦ "能点"证据：真鼠标点 frame 中心，量会话滚动位置是否真的跳了；
 *     ⑧ "看不见"证据：rail 区域截图 + 像素采样（条位置 vs 旁边背景的 RGB 差）。
 *
 * 用法：
 *   node tools/rail-cover-probe.mjs --label before [--out tools/probe-out]
 *     --switches "railink=off"   URL 开关（A/B 用）
 *     --wall <png> | --wall none 壁纸（默认本机固定素材，A/B 才有可比性）
 *     --stay                     不自动进历史会话（只测当前页面状态）
 *     --full                     额外落盘整屏截图
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)
const LABEL = arg('label', 'probe')
const OUT = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const SWITCHES = arg('switches', '')
const WALL = arg('wall', 'auto')
const STAY = has('stay')
const FULL = has('full')
fs.mkdirSync(OUT, { recursive: true })

const { firefox } = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright', 'index.mjs')).href)
// 入力纪律（2026-09-17）：Cookie 是**外部输入**（真机凭据，由 tools/hdr-probe-mint-cookie.mjs 生成），
// 不是夹具；本脚本自己**不写任何 /tmp 临时物**、也不依赖任何历史残留目录。
// 缺文件时优雅退出并给出生成命令，而不是抛 ENOENT 栈。
const COOKIE_FILE = arg('cookie', process.env.MPW_COOKIE || '/tmp/ffprobe/cookie.json')
if (!fs.existsSync(COOKIE_FILE)) {
  console.error('[rail-cover-probe] 缺少真机 Cookie 入力: ' + COOKIE_FILE +
    '\n  生成: node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:3080 --out ' + COOKIE_FILE +
    '\n  （本工具不依赖任何 /tmp 历史夹具；临时物一律 mkdtemp + 退出即删）')
  process.exit(2)
}
const cookie = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))

/** 固定本机素材（A/B 必须同一张图，否则像素没有可比性）。 */
function findWall () {
  if (WALL === 'none') return null
  if (WALL !== 'auto') return fs.existsSync(WALL) ? path.resolve(WALL) : null
  for (const c of ['/root/Desktop/DSHarea/mpkg_work/头_渲染v4a.png', '/root/Desktop/DSHarea/mpkg_work/Rella_渲染_final.png']) if (fs.existsSync(c)) return c
  return null
}

/** PNG → RGB24 裸像素（只用 ffmpeg，不引第三方图像库）。 */
function pngToRgb (file) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 })
  const png = fs.readFileSync(file)
  const w = png.readUInt32BE(16); const h = png.readUInt32BE(20)
  return { w, h, buf }
}
const px = (img, x, y) => {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return null
  const i = (y * img.w + x) * 3
  return [img.buf[i], img.buf[i + 1], img.buf[i + 2]]
}
const diff = (a, b) => (a && b ? Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) : null)

const url = 'http://127.0.0.1:3080/' + (SWITCHES ? '?' + SWITCHES : '')
const browser = await firefox.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])

const wallPath = findWall()
if (wallPath) {
  const key = (() => { try { const m = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8').match(/STORE_KEY\s*=\s*["'`]([^"'`]+)["'`]/); return m ? m[1] : 'dsh-mpkg-wallpaper.settings' } catch { return 'dsh-mpkg-wallpaper.settings' } })()
  const b64 = fs.readFileSync(wallPath).toString('base64')
  const val = { enabled: true, image: 'data:image/png;base64,' + b64, converted: 'png', opacity: 100, blur: 0, zoom: 100, sharp: true,
    unifyTint: true, unifyAmount: 30, sidebarAlpha: 38, chatFollow: false, headerBg: true, headerBlur: false, headerBlurAmount: 41,
    headerFrostUserSet: true, float: true, roundCompat: false, fpsCap: 0, resMax: 0 }
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }, [key, val])
}

// ⓪ 抓"谁给宿主元素写内联 display:none"：在应用脚本之前挂钩所有写入口 + MutationObserver 兜底。
await ctx.addInitScript(() => {
  try {
    window.__mpwDispSets = []
    const proto = CSSStyleDeclaration.prototype
    const EL = Element.prototype
    const cls = (el) => { try { return el && el.tagName ? el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 60) : String(el) } catch { return '?' } }
    const rec = (kind, who) => {
      try {
        const st = (new Error().stack || '').split('\n').slice(2, 10).join(' | ')
        if (window.__mpwDispSets.length < 300) window.__mpwDispSets.push({ kind, who: who || '', t: Math.round(performance.now()), stack: st.slice(0, 900) })
      } catch {}
    }
    const d = Object.getOwnPropertyDescriptor(proto, 'display')
    if (d && d.set) Object.defineProperty(proto, 'display', { configurable: true, get: d.get, set (v) { if (v === 'none') rec('style.display=none'); return d.set.call(this, v) } })
    const sp = proto.setProperty
    proto.setProperty = function (n, v, p) { if (String(n).toLowerCase() === 'display' && v === 'none') rec('setProperty(display,none)'); return sp.call(this, n, v, p) }
    const ct = Object.getOwnPropertyDescriptor(proto, 'cssText')
    if (ct && ct.set) Object.defineProperty(proto, 'cssText', { configurable: true, get: ct.get, set (v) { if (/display\s*:\s*none/i.test(String(v))) rec('style.cssText', String(v).slice(0, 60)); return ct.set.call(this, v) } })
    const sa = EL.setAttribute
    EL.setAttribute = function (n, v) { if (String(n).toLowerCase() === 'style' && /display\s*:\s*none/i.test(String(v))) rec('setAttribute(style)', cls(this) + ' :: ' + String(v).slice(0, 60)); return sa.call(this, n, v) }
    const san = EL.setAttributeNS
    if (san) EL.setAttributeNS = function (ns, n, v) { if (String(n).toLowerCase() === 'style' && /display\s*:\s*none/i.test(String(v))) rec('setAttributeNS(style)', cls(this) + ' :: ' + String(v).slice(0, 60)); return san.call(this, ns, n, v) }
    const av = Object.getOwnPropertyDescriptor(Attr.prototype, 'value')
    if (av && av.set) Object.defineProperty(Attr.prototype, 'value', { configurable: true, get: av.get, set (v) { if (String(this.name).toLowerCase() === 'style' && /display\s*:\s*none/i.test(String(v))) rec('Attr.value(style)', String(v).slice(0, 60)); return av.set.call(this, v) } })
    try {
      const mo = new MutationObserver((ms) => {
        for (const m of ms) {
          const el = m.target
          if (el && el.classList && el.classList.contains('eGxaPq_scroller') && window.__mpwDispSets.length < 300) {
            window.__mpwDispSets.push({ kind: 'MO:eGxaPq_scroller', who: cls(el), t: Math.round(performance.now()),
              stack: 'style="' + String(el.getAttribute('style')).slice(0, 80) + '" old="' + String(m.oldValue).slice(0, 60) + '"' })
          }
        }
      })
      const start = () => { try { mo.observe(document.documentElement || document, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true }) } catch {} }
      if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true })
    } catch {}
    const t = document.createElement('div'); t.style.display = 'none'; rec('SELFTEST(应恰好1条)', cls(t))
  } catch {}
})

const page = await ctx.newPage()
const errs = []
const logs = []
page.on('pageerror', (e) => errs.push(String((e && e.message) || e).slice(0, 200)))
page.on('console', (m) => { const t = (m.text() || '').slice(0, 200); if (/mpkg-wallpaper|mpw/i.test(t)) logs.push(m.type() + ': ' + t) })

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2500)
// 侧边栏会话列表是异步拉的；内存紧张时首帧更慢 ⇒ 轮询等待（最多 ~45s，三次机会）
for (let i = 0; i < 3; i++) {
  await page.waitForSelector('[class*="sessionRow"]', { timeout: 15000 }).catch(() => {})
  const n = await page.evaluate(() => document.querySelectorAll('[class*="sessionRow"]').length).catch(() => 0)
  if (n > 0) break
  await page.waitForTimeout(1500)
}
await page.waitForTimeout(1000)

// —— 进入 ≥2 轮的历史会话（TurnNavigator 需要 ≥2 轮才渲染；只做"点击 + 等待"，不合成节点）——
const marksNow = async () => await page.evaluate(() => document.querySelectorAll('.eGxaPq_mark').length)
const railState = async () => await page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length
  return { slot: q('.eGxaPq_slot'), frame: q('.eGxaPq_frame'), marks: q('.eGxaPq_mark'), turns: q('[data-chat-turn]') }
})
const s1 = await railState()
let sessionInfo = null
if (!STAY && s1.marks === 0) {
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[class*="sessionRow"]'))
    .map((e, i) => ({ i, text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), h: e.getBoundingClientRect().height }))
    .filter(r => r.h > 8))
  sessionInfo = { rows, clicked: [] }
  for (const r of rows) {
    if (r.text === '新会话') continue
    await page.evaluate(({ i }) => { const el = Array.from(document.querySelectorAll('[class*="sessionRow"]')).filter(e => e.getBoundingClientRect().height > 8)[i]; if (el) el.click() }, { i: r.i }).catch(() => {})
    await page.waitForTimeout(3000)
    const n = await marksNow()
    sessionInfo.clicked.push({ i: r.i, text: r.text, marks: n })
    if (n > 0) { sessionInfo.winner = r; break }
  }
}
const st = await railState()
const forced = st.marks > 0 ? 'rail=host' : 'rail=absent'

// ══════════════════ 页面内测量 ══════════════════
const COLLECT = (switches) => {
  const out = { at: new Date().toISOString(), url: location.href, switches }
  const cs = (el, ps) => (el ? getComputedStyle(el, ps || null) : null)
  const rect = (el) => { try { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) } } catch { return null } }
  const ident = (el) => {
    if (!el) return null
    if (el === document.documentElement) return 'html'
    if (el === document.body) return 'body'
    const a = []
    for (const at of el.attributes) if (/^(id|class|data-mpw.*|data-dsh.*|data-slot|data-plugin)$/.test(at.name)) a.push(at.name + '=' + String(at.value).slice(0, 70))
    return el.tagName.toLowerCase() + (a.length ? '[' + a.join('][') + ']' : '')
  }
  const isOurs = (el) => {
    if (!el || !el.tagName) return false
    const cls = String(el.className || '')
    if (/(^|\s)mpw[-_]/.test(cls)) return true
    if (el.id && /^mpw-/.test(el.id)) return true
    for (const at of el.attributes || []) if (/^data-mpw/.test(at.name)) return true
    if (el.closest && el.closest('.mpw-bgWrap,#mpw-aqua-mask,#mpw-lg-svg,.mpw-hdrFrost,.mpw_mask')) return true
    return false
  }
  const paint = (el) => {
    const c = cs(el)
    return { display: c.display, opacity: c.opacity, filter: c.filter, visibility: c.visibility, transform: c.transform,
      clipPath: c.clipPath, maskImage: c.maskImage === 'none' ? 'none' : 'set', overflow: c.overflow, zIndex: c.zIndex, position: c.position,
      contain: c.contain, containerType: c.containerType, isolation: c.isolation, pointerEvents: c.pointerEvents,
      mixBlendMode: c.mixBlendMode, background: c.backgroundColor, contentVisibility: c.contentVisibility }
  }
  const frame = document.querySelector('.eGxaPq_frame')
  const slot = document.querySelector('.eGxaPq_slot')
  const scroller = document.querySelector('.eGxaPq_scroller')
  const marksV = Array.from(document.querySelectorAll('.eGxaPq_mark'))
  out.railState = { slot: !!slot, frame: !!frame, scroller: !!scroller, marks: marksV.length, turns: document.querySelectorAll('[data-chat-turn]').length }
  out.markCounts = { total: marksV.length, laidOut: marksV.filter(m => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).length }
  out.wallpaper = (() => { const w = document.querySelector('.mpw-bgWrap'); if (!w) return null; const c = cs(w); const i = w.querySelector('img'); return { cls: String(w.className), display: c.display, zIndex: c.zIndex, filter: c.filter, imgLen: i ? String(i.src).length : 0, nw: i ? i.naturalWidth : 0 } })()
  out.ls = (() => { try { const raw = localStorage.getItem('dsh.mpkg-wallpaper.v2'); if (!raw) return { present: false }; const o = JSON.parse(raw); return { present: true, len: raw.length, enabled: o.enabled, imageLen: typeof o.image === 'string' ? o.image.length : 0 } } catch (e) { return { err: String(e).slice(0, 120) } } })()
  out.bodyAttrs = document.body ? Array.from(document.body.attributes).map(a => a.name + '=' + String(a.value).slice(0, 40)) : []
  out.slots = (() => { const m = {}; for (const e of document.querySelectorAll('[data-slot]')) { const v = e.getAttribute('data-slot'); m[v] = (m[v] || 0) + 1 } return m })()
  out.dispSets = (() => { try { return (window.__mpwDispSets || []).slice(-30) } catch { return [] } })()
  if (!frame) { out.reason = 'host rail absent (marks=0) — 不合成、不推断'; return out }

  const fCS = cs(frame)
  out.frame = { ident: ident(frame), rect: rect(frame), paint: paint(frame), inline: (frame.getAttribute('style') || '').slice(0, 300),
    vars: { '--turn-natural-height': fCS.getPropertyValue('--turn-natural-height').trim(), '--turn-rail-band': fCS.getPropertyValue('--turn-rail-band').trim() },
    inViewport: (() => { const r = frame.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight })() }
  if (slot) out.slot = { ident: ident(slot), rect: rect(slot), paint: paint(slot) }
  if (scroller) out.scroller = { ident: ident(scroller), className: String(scroller.className), rect: rect(scroller), paint: paint(scroller),
    inlineStyle: scroller.getAttribute('style') || '', hiddenAttr: scroller.hasAttribute('hidden'),
    matchesRailFade: (() => { try { return scroller.matches('[class*="fade"]') } catch { return null } })(),
    matchesSessionFade: (() => { try { return scroller.matches('[data-slot*="session"] [class*="fade"]') } catch { return null } })(),
    closestSession: (() => { try { const p = scroller.closest('[data-slot*="session"], [data-slot*="workspaces"], [class*="regionArea"], [class*="sidebarCol"]'); return p ? ident(p) : null } catch { return null } })() }

  // ① 命中点（整条链）
  const fr = frame.getBoundingClientRect()
  const ys = []; for (let i = 0; i < 5; i++) ys.push(Math.round(fr.top + fr.height * (i + 0.5) / 5))
  const xs = [Math.round(fr.left + 2), Math.round(fr.left + fr.width / 2), Math.round(fr.right - 2)]
  out.hitPoints = []
  for (const y of ys) for (const x of xs) {
    if (y < 0 || y > innerHeight - 1 || x < 0 || x > innerWidth - 1) { out.hitPoints.push({ x, y, skipped: 'outside-viewport' }); continue }
    const chain = document.elementsFromPoint(x, y).slice(0, 8).map(ident)
    out.hitPoints.push({ x, y, top: ident(document.elementFromPoint(x, y)), chain, ours: chain.filter(c => /mpw[-_]|data-mpw/.test(String(c))) })
  }
  // ② 条元素（优先视口内有尺寸的）与其祖先链
  const inVp = marksV.filter(m => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight })
  const probeMark = inVp[0] || marksV[0]
  out.markCounts.inViewport = inVp.length
  if (probeMark) {
    const cb = cs(probeMark, '::before')
    out.mark = { cls: String(probeMark.className).slice(0, 70), rect: rect(probeMark), paint: paint(probeMark),
      before: cb ? { content: cb.content, background: cb.backgroundColor, backgroundSrc: cb.getPropertyValue('background'), w: cb.width, h: cb.height, opacity: cb.opacity, display: cb.display, top: cb.top, right: cb.right, transform: cb.transform, boxShadow: cb.boxShadow } : null }
    out.markChain = []
    for (let n = probeMark, i = 0; n && i < 14; n = n.parentElement, i++) out.markChain.push({ ident: ident(n), ours: isOurs(n), rect: rect(n), paint: paint(n) })
  }
  // ③ 我们注入的层
  out.ourLayers = []
  for (const el of document.querySelectorAll('.mpw-bgWrap,#mpw-aqua-mask,#mpw-lg-svg,.mpw-hdrFrost,[class^="mpw-"],[class*=" mpw-"]')) {
    const r = el.getBoundingClientRect()
    out.ourLayers.push({ ident: ident(el), rect: rect(el), big: r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5, paint: paint(el) })
  }
  // ④ 语法上命中 rail 元素的规则（线索；因果看 whyDisplay）
  const RULE_ATTRS = ['display', 'visibility', 'opacity', 'pointer-events', 'overflow', 'overflow-y', 'z-index', 'content-visibility', 'height', 'inset', 'position']
  const ownerOf = (sh) => { const n = sh.ownerNode; if (!n) return 'inline?'; return (n.dataset && (n.dataset.pluginCss || n.dataset.plugin)) ? `plugin:${n.dataset.pluginCss || n.dataset.plugin}` : (n.id ? '#' + n.id : n.tagName.toLowerCase()) }
  out.ruleHits = []
  const targets = [['scroller', scroller], ['frame', frame], ['marks', document.querySelector('.eGxaPq_marks')], ['mark', marksV[0]], ['slot', slot]]
  const walk = (rules, sheet, ctx) => {
    for (const r of rules) {
      try {
        if (r.cssRules && r.conditionText !== undefined) { walk(r.cssRules, sheet, ctx + ' @' + r.constructor.name + '(' + r.conditionText + ')'); continue }
        if (!r.selectorText || !r.style) continue
        const decls = []
        for (const a of RULE_ATTRS) if (r.style.getPropertyValue(a)) decls.push(a + ':' + r.style.getPropertyValue(a) + (r.style.getPropertyPriority(a) ? ' !important' : ''))
        if (!decls.length) continue
        for (const [name, el] of targets) {
          if (!el) continue
          let m = false; try { m = el.matches(r.selectorText) } catch { m = false }
          if (m) out.ruleHits.push({ target: name, sel: r.selectorText.slice(0, 130), decls, owner: ownerOf(sheet), ctx, ours: /mpw/i.test((sheet.ownerNode && sheet.ownerNode.textContent) || '') })
        }
      } catch {}
    }
  }
  for (const sheet of Array.from(document.styleSheets)) { try { if (sheet.cssRules) walk(sheet.cssRules, sheet, '') } catch {} }

  // ⑤ 因果定位：内联/hidden → 逐表禁用 → 表内逐规则摘 display（读后立即还原）
  const disp = (el) => { try { return getComputedStyle(el).display } catch { return '?' } }
  out.whyDisplay = (() => {
    if (!scroller) return { err: 'no scroller' }
    const base = disp(scroller)
    const res = { base, inlineStyle: scroller.getAttribute('style') || '', hasHiddenAttr: scroller.hasAttribute('hidden'),
      attrs: Array.from(scroller.attributes).map(a => a.name + '=' + String(a.value).slice(0, 60)), sheets: [], rules: [] }
    if (base === 'none' && scroller.hasAttribute('hidden')) { scroller.removeAttribute('hidden'); res.afterRemoveHidden = disp(scroller); scroller.setAttribute('hidden', '') }
    if (scroller.style.display) { const v = scroller.style.display; scroller.style.display = ''; res.afterClearInline = disp(scroller); scroller.style.display = v }
    for (const sh of Array.from(document.styleSheets)) {
      const was = sh.disabled; let now = base
      try { sh.disabled = true; now = disp(scroller) } catch {}
      try { sh.disabled = was } catch {}
      if (now !== base) res.sheets.push({ owner: ownerOf(sh), becomes: now })
    }
    for (const sh of Array.from(document.styleSheets)) {
      let rules; try { rules = sh.cssRules } catch { continue }
      const flat = []
      const collect = (list, ctx) => { for (const r of list) { try { if (r.cssRules && r.conditionText !== undefined) { collect(r.cssRules, ctx + '/' + r.constructor.name + (r.conditionText ? '(' + r.conditionText + ')' : '')); continue } } catch {} ; flat.push([r, ctx]) } }
      collect(rules, '')
      for (const [r, ctx] of flat) {
        try {
          if (!r.style || !r.style.getPropertyValue('display')) continue
          let m = false; try { m = scroller.matches(r.selectorText) } catch { m = false }
          if (!m) continue
          const val = r.style.getPropertyValue('display'); const pri = r.style.getPropertyPriority('display')
          r.style.removeProperty('display'); const now = disp(scroller); r.style.setProperty('display', val, pri)
          res.rules.push({ owner: ownerOf(sh), sel: r.selectorText.slice(0, 130), decl: 'display:' + val + (pri ? ' !important' : ''), ctx, becomesWhenRemoved: now })
        } catch {}
      }
    }
    return res
  })()
  return out
}

const data = await page.evaluate(COLLECT, SWITCHES)
data.forced = forced
data.sessionInfo = sessionInfo
data.consoleErrs = errs
data.consoleLogs = logs.slice(-20)
data.wallPath = wallPath

// ══════════════════ ⑦ "能点"证据：真鼠标点 frame 中心 ══════════════════
data.clickTest = await (async () => {
  const r = await page.evaluate(() => { const f = document.querySelector('.eGxaPq_frame'); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height * 0.3 } })
  if (!r) return { err: 'no frame' }
  const read = () => page.evaluate(() => { const s = document.querySelector('.wSkVaW_scrollBody, .EvIC1a_scroll'); return s ? s.scrollTop : null })
  const before = await read()
  await page.mouse.click(Math.round(r.x), Math.round(r.y))
  await page.waitForTimeout(900)
  const after = await read()
  return { clickAt: [Math.round(r.x), Math.round(r.y)], scrollTopBefore: before, scrollTopAfter: after, changed: before !== after, delta: (typeof before === 'number' && typeof after === 'number') ? after - before : null }
})()

// ══════════════════ ⑧ 截图 + 像素（A=现状；摘掉内联 display:none 后再来一次 B） ══════════════════
const shotAndSample = async (tag) => {
  const geo = await page.evaluate(() => {
    const f = document.querySelector('.eGxaPq_frame'); const sc = document.querySelector('.eGxaPq_scroller')
    if (!f) return null
    const b = f.getBoundingClientRect()
    const x0 = Math.max(0, Math.round(b.x - 30)); const y0 = Math.max(0, Math.round(b.y)); const x1 = Math.min(innerWidth, Math.round(b.right + 6)); const y1 = Math.min(innerHeight, Math.round(b.bottom))
    const marks = Array.from(document.querySelectorAll('.eGxaPq_mark')).map(m => { const r = m.getBoundingClientRect(); const cb = getComputedStyle(m, '::before'); return { cls: String(m.className).slice(0, 50), right: r.right, top: r.top, w: r.width, h: r.height, bw: parseFloat(cb.width) || 0, bg: cb.backgroundColor } })
      .filter(m => m.w > 0 && m.h > 0 && m.top >= y0 && m.top < y1)
    return { x0, y0, x1, y1, marks, inline: sc ? (sc.getAttribute('style') || '') : null, computed: sc ? getComputedStyle(sc).display : null }
  })
  if (!geo || geo.x1 - geo.x0 < 4 || geo.y1 - geo.y0 < 4) return { tag, err: 'no area' }
  const file = path.join(OUT, `${LABEL}.${tag}.rail.png`)
  await page.screenshot({ path: file, clip: { x: geo.x0, y: geo.y0, width: geo.x1 - geo.x0, height: geo.y1 - geo.y0 } })
  const img = pngToRgb(file)
  const samples = []
  for (const m of geo.marks.slice(0, 24)) {
    const cx = Math.round(m.right - (m.bw || 12) / 2)
    const cy = Math.round(m.top + m.h / 2)
    const bar = px(img, cx - geo.x0, cy - geo.y0)
    const ref = px(img, Math.round(m.right - (m.bw || 12) - 14) - geo.x0, cy - geo.y0)
    const above = px(img, cx - geo.x0, Math.max(0, cy - 6 - geo.y0))
    samples.push({ cls: m.cls, barCss: m.bg, bar, ref, above, dBarRef: diff(bar, ref), dBarAbove: diff(bar, above) })
  }
  const drawn = samples.filter(s => (s.dBarRef || 0) >= 8 || (s.dBarAbove || 0) >= 8).length
  return { tag, file, area: [geo.x0, geo.y0, geo.x1 - geo.x0, geo.y1 - geo.y0], scrollerInline: geo.inline, scrollerComputed: geo.computed,
    markSamples: samples.length, drawnSamples: drawn, samples }
}
data.pixelsA = await shotAndSample('A-wounded')
data.unwound = await page.evaluate(() => {
  const sc = document.querySelector('.eGxaPq_scroller'); if (!sc) return { err: 'no scroller' }
  const laid = () => Array.from(document.querySelectorAll('.eGxaPq_mark')).filter(m => m.getBoundingClientRect().width > 0).length
  const before = { inline: sc.getAttribute('style') || '', computed: getComputedStyle(sc).display, marksLaidOut: laid() }
  sc.style.display = ''
  const after = { inline: sc.getAttribute('style') || '', computed: getComputedStyle(sc).display, marksLaidOut: laid() }
  return { before, after }
})
await page.waitForTimeout(400)
data.pixelsB = await shotAndSample('B-unwound')
// 补上宿主 fade 类 → 检验 **CSS 规则** 是否也会单独把 rail 藏掉（第二条独立机制）
data.cssFadeRule = await page.evaluate(() => {
  const sc = document.querySelector('.eGxaPq_scroller'); if (!sc) return { err: 'no scroller' }
  const hadTop = sc.classList.contains('eGxaPq_fadeTop'); const hadBottom = sc.classList.contains('eGxaPq_fadeBottom')
  sc.classList.add('eGxaPq_fadeTop', 'eGxaPq_fadeBottom')
  const withFades = getComputedStyle(sc).display
  const matches = (() => { try { return sc.matches('[data-slot*="session"] [class*="fade"]') } catch { return null } })()
  if (!hadTop) sc.classList.remove('eGxaPq_fadeTop'); if (!hadBottom) sc.classList.remove('eGxaPq_fadeBottom')
  return { computedWithFades: withFades, matchesSessionFadeSelector: matches, computedRestored: getComputedStyle(sc).display }
})
if (FULL) await page.screenshot({ path: path.join(OUT, LABEL + '.full.png'), fullPage: false })
await browser.close()

fs.writeFileSync(path.join(OUT, LABEL + '.probe.json'), JSON.stringify(data, null, 1))

// ══════════════════ 人读摘要 ══════════════════
const L = []
const P = (p) => p ? `disp=${p.display} op=${p.opacity} vis=${p.visibility} filter=${p.filter} tf=${p.transform} clip=${p.clipPath} ovf=${p.overflow} z=${p.zIndex} pos=${p.position} contain=${p.contain} ctype=${p.containerType} iso=${p.isolation} pe=${p.pointerEvents} bg=${p.background}` : '(null)'
L.push(`=== rail-cover-probe [${LABEL}] ${data.at} ===`)
L.push(`URL ${data.url}   switches=${JSON.stringify(SWITCHES)}   forced=${forced}   wall=${wallPath || '(none)'}`)
L.push(`railState ${JSON.stringify(data.railState)}   turns/marks=${JSON.stringify(data.markCounts)}`)
L.push(`sessionInfo=${JSON.stringify(sessionInfo)}   consoleErrs=${JSON.stringify(errs)}`)
L.push(`body attrs: ${(data.bodyAttrs || []).join(' ')}`)
L.push(`wallpaper: ${JSON.stringify(data.wallpaper)}   持久化: ${JSON.stringify(data.ls)}`)
L.push(`data-slot 清单: ${JSON.stringify(data.slots)}`)
if (data.reason) L.push(`!! ${data.reason}`)
if (data.frame) { L.push(`[frame] ${data.frame.ident} rect=${JSON.stringify(data.frame.rect)} inViewport=${data.frame.inViewport}`); L.push(`   vars=${JSON.stringify(data.frame.vars)}  inline=${data.frame.inline}`); L.push(`   paint=${P(data.frame.paint)}`) }
if (data.slot) L.push(`[slot] ${data.slot.ident} rect=${JSON.stringify(data.slot.rect)} paint=${P(data.slot.paint)}`)
if (data.scroller) { L.push(`[scroller] ${data.scroller.ident} className="${data.scroller.className}" rect=${JSON.stringify(data.scroller.rect)}`); L.push(`   inlineStyle="${data.scroller.inlineStyle}" hiddenAttr=${data.scroller.hiddenAttr} matches[class*=fade]=${data.scroller.matchesRailFade} matches[data-slot*=session]+fade=${data.scroller.matchesSessionFade}`); L.push(`   closest会话/侧栏容器=${data.scroller.closestSession}`); L.push(`   paint=${P(data.scroller.paint)}`) }
if (data.mark) { L.push(`[最靠前的条] ${data.mark.cls} rect=${JSON.stringify(data.mark.rect)}`); L.push(`   ::before ${JSON.stringify(data.mark.before)}`); L.push(`   paint=${P(data.mark.paint)}`) }
L.push(`[命中点（elementFromPoint/elementsFromPoint 整条链）]`)
for (const p of (data.hitPoints || [])) { L.push(`  (${p.x},${p.y}) ${p.skipped ? p.skipped : 'top=' + p.top}`); if (p.chain) L.push(`     ${p.chain.join('  <  ')}`); if (p.ours && p.ours.length) L.push(`     ★链上我们的节点: ${p.ours.join(' | ')}`) }
L.push(`[条元素祖先链（自上而下）]`)
for (const c of (data.markChain || [])) L.push(`  ${c.ours ? '★我们 ' : '      '}${c.ident} rect=${JSON.stringify(c.rect)} ${P(c.paint)}`)
L.push(`[我们的注入层]`)
for (const l of (data.ourLayers || [])) L.push(`  ${l.big ? '大层 ' : '    '}${l.ident} rect=${JSON.stringify(l.rect)} ${P(l.paint)}`)
L.push(`[语法上命中 rail 元素的规则]`)
for (const r of (data.ruleHits || [])) L.push(`  ${r.target.padEnd(10)} ${r.ours ? '★我们' : ' 宿主/他方'} ${r.sel}\n      { ${r.decls.join('; ')} }  ← ${r.owner}${r.ctx}`)
L.push(`[scroller display 因果定位] ${JSON.stringify(data.whyDisplay, null, 1)}`)
L.push(`[谁写了内联 display:none（挂钩记录）]`)
for (const d of (data.dispSets || [])) L.push(`  t=${d.t}ms ${d.kind} ${d.who}\n     ${d.stack}`)
L.push(`[能点吗（真鼠标点 frame 中心）] ${JSON.stringify(data.clickTest)}`)
L.push(`[像素 A（现状）] 区域=${JSON.stringify(data.pixelsA && data.pixelsA.area)} scroller=${data.pixelsA && data.pixelsA.scrollerComputed} 采样=${data.pixelsA && data.pixelsA.markSamples} 真正画出的样本=${data.pixelsA && data.pixelsA.drawnSamples} 图=${data.pixelsA && data.pixelsA.file}`)
for (const s of ((data.pixelsA && data.pixelsA.samples) || []).slice(0, 6)) L.push(`   ${s.cls} bar=${JSON.stringify(s.bar)} ref=${JSON.stringify(s.ref)} Δbar-ref=${s.dBarRef}`)
L.push(`[摘掉内联 display:none 后] ${JSON.stringify(data.unwound)}`)
L.push(`[像素 B（摘掉后）] scroller=${data.pixelsB && data.pixelsB.scrollerComputed} 采样=${data.pixelsB && data.pixelsB.markSamples} 真正画出的样本=${data.pixelsB && data.pixelsB.drawnSamples} 图=${data.pixelsB && data.pixelsB.file}`)
for (const s of ((data.pixelsB && data.pixelsB.samples) || []).slice(0, 6)) L.push(`   ${s.cls} bar=${JSON.stringify(s.bar)} ref=${JSON.stringify(s.ref)} Δbar-ref=${s.dBarRef}`)
L.push(`[CSS 规则单独检验（补 fade 类）] ${JSON.stringify(data.cssFadeRule)}`)
L.push(`[插件日志] ${JSON.stringify(data.consoleLogs || [])}`)

const txt = L.join('\n')
fs.writeFileSync(path.join(OUT, LABEL + '.probe.txt'), txt + '\n')
console.log(txt)
console.log('\n证据: ' + path.join(OUT, LABEL + '.probe.json'))

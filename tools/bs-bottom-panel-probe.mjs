#!/usr/bin/env node
/**
 * bs-bottom-panel-probe.mjs —— better-sidebar **底部工作台面板**悬浮适配的真机 computed 探针
 *
 * 为什么需要它（2026-09-17 用户第 2 项：「对 better sidebar 插件的底部面板做悬浮适配，
 *   不要再犯之前那些边被切掉 / 有些边重复显示的 bug，尽量一次性做好」）：
 *   `bsFloat` 的底部面板规则（圆角 / 外边距 / 内层透明）全部是"看着像对"的静态 CSS，
 *   而 0.19.1 的面板是**自己的 ResizeObserver 实时对齐 DSH 中心列**的绝对定位元素，
 *   还有独立的 resize strip / 折叠按钮 / tabBar / pane 多层背景。到底哪条边被裁、
 *   哪条边重复、内层有没有直角实色矩形，只有真机 computed + 几何能回答。
 *   本脚本把真实 DSH 页面加载进无头 Firefox，点开会话头右侧的底部面板开关
 *   （`[data-dsh-bottom-toggle]`），逐元素取 computed 与 rect，落盘证据。
 *
 * 用法（可复跑）：
 *   node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:3080 --out /tmp/ffprobe/cookie.json
 *   node tools/bs-bottom-panel-probe.mjs --label before                 # 复刻用户设置：bsCompat+bsFloat
 *   node tools/bs-bottom-panel-probe.mjs --label off --variant off      # 对照：bsFloat 关（= 原样）
 *   node tools/bs-bottom-panel-probe.mjs --label notours --variant none # 对照：bsCompat 关（= 我们零规则）
 *
 * 参数：
 *   --url <u>      目标 URL（默认 http://127.0.0.1:3080/）
 *   --cookie <f>   Cookie JSON（默认 /tmp/ffprobe/cookie.json）
 *   --out <dir>    证据目录（默认 tools/probe-out/）
 *   --label <s>    证据标签（默认 before）
 *   --variant <v>  ours（默认：bsCompat+bsFloat）/ off（bsCompat 开、bsFloat 关）/ none（bsCompat 关）
 *   --headed       非无头（调试用）
 *
 * 输出：<out>/bs-bottom-<label>.json + <out>/bs-bottom-<label>.txt（人读一屏）
 * 纪律：只读页面（不改任何 DOM）；每次只开一个无头浏览器，跑完立刻关闭；
 *       预置设置只写探针自己这个临时浏览器上下文的 localStorage（不动用户数据）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const URL0 = arg('url', 'http://127.0.0.1:3080/')
const COOKIE_FILE = arg('cookie', '/tmp/ffprobe/cookie.json')
const OUT_DIR = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const LABEL = arg('label', 'before')
const VARIANT = arg('variant', 'ours')
const HEADED = argv.includes('--headed')
const DARK = argv.includes('--dark')
const WAIT_MS = Number(arg('wait', '8000'))
fs.mkdirSync(OUT_DIR, { recursive: true })

// 探针上下文里的插件设置（只在无头浏览器自己的 localStorage 里）：复刻用户真机
// （bsCompat + bsFloat 开、其余子开关关；见 /root/.dsh-mpkg-wallpaper/settings.json）。
const SETTINGS = (() => {
  const base = {
    enabled: true, image: true, unifyTint: true, unifyAmount: 30, float: true, headerBg: true,
    headerBlur: false, headerFrostUserSet: true, bsCompat: false, bsFloat: false,
    bsFont: false, bsReveal: false, bsAlpha: false, bsAqua: false, bsBottomAvoid: false,
  }
  if (VARIANT === 'ours') return Object.assign(base, { bsCompat: true, bsFloat: true })
  if (VARIANT === 'off') return Object.assign(base, { bsCompat: true, bsFloat: false })
  // all：所有 bs 子开关全开（验证"后写优先"：bsReveal < bsAlpha < bsAqua 依次覆盖面板底色）
  if (VARIANT === 'all') return Object.assign(base, { bsCompat: true, bsFloat: true, bsReveal: true, bsRevealAlpha: 62, bsAlpha: true, bsAqua: true, bsFont: true })
  return base // none：bsCompat=false ⇒ 我们一条 bs 规则都不进页面
})()

async function loadPlaywright() {
  const cands = [
    path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'),
    path.join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'),
  ]
  for (const c of cands) if (fs.existsSync(c)) return await import(pathToFileURL(c).href)
  throw new Error('找不到 playwright（试过 ' + cands.join(' / ') + '）')
}
function readCookie() {
  if (!fs.existsSync(COOKIE_FILE)) throw new Error('缺少鉴权 Cookie 文件 ' + COOKIE_FILE + '（先按 tools/hdr-probe-mint-cookie.mjs 生成）')
  const j = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
  if (!j.name || !j.value) throw new Error(COOKIE_FILE + ' 缺 name/value')
  return j
}

/* ---------- 页内采集（纯读） ---------- */
function pageCollector() {
  const cs = (el, pseudo) => { try { return el ? getComputedStyle(el, pseudo || undefined) : null } catch { return null } }
  const alphaOf = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(String(c || ''))
    if (!m) return String(c || '') === 'transparent' ? 0 : 1
    const p = m[1].split(',').map((x) => parseFloat(x))
    return p.length >= 4 ? p[3] : 1
  }
  const rectOf = (el) => { try { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) } } catch { return null } }
  const snap = (el, name) => {
    if (!el) return { name, missing: true }
    const c = cs(el)
    const r = rectOf(el)
    return {
      name,
      cls: String(el.className || '').slice(0, 70),
      rect: r,
      position: c.position, zIndex: c.zIndex, overflow: c.overflow,
      display: c.display, visibility: c.visibility, opacity: c.opacity,
      margin: [c.marginTop, c.marginRight, c.marginBottom, c.marginLeft].join(' '),
      inset: [c.top, c.right, c.bottom, c.left].join(' '),
      width: c.width, height: c.height,
      radius: [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius],
      radiusUniform: (() => { const v = [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius]; return v.every((x) => x === v[0]) ? v[0] : 'MIXED(' + v.join(',') + ')' })(),
      borders: {
        top: [c.borderTopWidth, c.borderTopStyle, c.borderTopColor],
        right: [c.borderRightWidth, c.borderRightStyle, c.borderRightColor],
        bottom: [c.borderBottomWidth, c.borderBottomStyle, c.borderBottomColor],
        left: [c.borderLeftWidth, c.borderLeftStyle, c.borderLeftColor],
      },
      bg: c.backgroundColor, bgAlpha: alphaOf(c.backgroundColor), bgImage: String(c.backgroundImage || 'none').slice(0, 40),
      boxShadow: String(c.boxShadow || 'none').slice(0, 80),
      backdropFilter: String(c.backdropFilter || 'none').slice(0, 40),
      transform: c.transform === 'none' ? 'none' : 'set',
    }
  }
  const q = (s) => { try { return document.querySelector(s) } catch { return null } }
  const qa = (s) => { try { return [...document.querySelectorAll(s)] } catch { return [] } }
  const panel = q('[data-dsh-bottom-panel]') || q('[class*="_bottomPanel"]')
  if (!panel) return { ok: false, reason: '页面里找不到 [data-dsh-bottom-panel]（面板未渲染？需要先打开一个会话并展开底部面板）', toggle: !!q('[data-dsh-bottom-toggle]') }
  const panelRect = rectOf(panel)
  const inside = (r) => !!(r && panelRect && r.x >= panelRect.x - 0.5 && r.y >= panelRect.y - 0.5 && r.right <= panelRect.right + 0.5 && r.bottom <= panelRect.bottom + 0.5)
  const strip = qa('[class*="bottomResize"]')[0] || null
  const closeBtn = qa('[class*="bottomClose"]')[0] || null
  const tabBar = panel.querySelector('[class*="_tabBar"]')
  const panelBody = panel.querySelector('[class*="_panelBody"]')
  const paneBody = panel.querySelector('[class*="_paneBody"]')
  const panes = qa('[data-dsh-pane]')
  const paneContent = panel.querySelector('[class*="_paneContent"]')
  const terminalWrap = panel.querySelector('[class*="_terminalWrap"]')
  const workbench = panel.querySelector('[class*="_workbench"]')
  const centerCol = q('[data-dsh-center-col]') || q('.pI_x6G_centerCol') || q('[class*="centerCol"]')
  const composer = q('[data-composer-card]') || q('[class*="composer"]')
  // 我们的规则到底进没进页面（按选择器文本在 <style> 里找）
  const styles = [...document.querySelectorAll('style')].map((s) => s.textContent || '')
  const ours = styles.find((t) => t.indexOf('data-dsh-bottom-panel') >= 0) || ''
  const rulesOfOurs = (ours.match(/[^{}]*\[data-dsh-bottom-panel\][^{}]*\{[^}]*\}/g) || []).map((x) => x.replace(/\s+/g, ' ').slice(0, 200))
  const pickPanelRules = [...ours.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /_panelBody|_panel\b|_bottomPanel|bottomResize/.test(m[1]))
    .map((m) => (m[1].trim().replace(/\s+/g, ' ') + ' { ' + m[2].trim().replace(/\s+/g, ' ') + ' }').slice(0, 220))
  // 每条边"谁画的"：panel / strip / tabBar 三层的可见边
  const edgeOwner = (el, name) => {
    const c = cs(el); if (!c) return null
    const out = {}
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const key = 'border' + side[0].toUpperCase() + side.slice(1)
      const w = parseFloat(c[key + 'Width']) || 0
      const st = c[key + 'Style']
      const col = c[key + 'Color']
      out[side] = (w > 0 && st !== 'none' && alphaOf(col) > 0) ? { w, style: st, color: col, alpha: alphaOf(col), owner: name } : null
    }
    return out
  }
  return {
    ok: true,
    bodyVersion: document.body.getAttribute('data-mpw-bs-version'),
    hasToggleActive: (() => { const t = q('[data-dsh-bottom-toggle]'); return t ? t.getAttribute('data-active') : null })(),
    panel: snap(panel, 'panelRoot([data-dsh-bottom-panel])'),
    strip: snap(strip, 'resizeStrip'),
    closeBtn: snap(closeBtn, 'collapseBtn'),
    tabBar: snap(tabBar, 'tabBar'),
    panelBody: snap(panelBody, 'panelBody'),
    paneBody: snap(paneBody, 'paneBody'),
    pane0: snap(panes[0], 'pane0([data-dsh-pane])'),
    paneContent: snap(paneContent, 'paneContent'),
    terminalWrap: snap(terminalWrap, 'terminalWrap'),
    workbench: snap(workbench, 'workbench'),
    centerCol: snap(centerCol, 'dshCenterCol'),
    composer: snap(composer, 'dshComposer'),
    containment: {
      stripInsidePanel: inside(rectOf(strip)),
      closeBtnInsidePanel: inside(rectOf(closeBtn)),
      tabBarInsidePanel: inside(rectOf(tabBar)),
      panelBodyInsidePanel: inside(rectOf(panelBody)),
      pane0InsidePanel: inside(rectOf(panes[0])),
      workbenchInsidePanel: inside(rectOf(workbench)),
      panelEdgeVsViewport: panelRect ? { bottomGap: +(innerHeight - panelRect.bottom).toFixed(2), rightGap: +(innerWidth - panelRect.right).toFixed(2), leftGap: panelRect.x } : null,
    },
    align: (() => {
      const cc = rectOf(centerCol); const pr = panelRect; const cp = rectOf(composer)
      return {
        centerCol: cc, panel: pr, composer: cp,
        panelLeftVsCenterColLeft: (cc && pr) ? +(pr.x - cc.x).toFixed(2) : null,
        panelRightVsCenterColRight: (cc && pr) ? +(pr.right - cc.right).toFixed(2) : null,
        panelLeftVsComposerLeft: (cp && pr) ? +(pr.x - cp.x).toFixed(2) : null,
        panelRightVsComposerRight: (cp && pr) ? +(pr.right - cp.right).toFixed(2) : null,
      }
    })(),
    edges: { panel: edgeOwner(panel, 'panel'), strip: edgeOwner(strip, 'strip'), tabBar: edgeOwner(tabBar, 'tabBar'), panelBody: edgeOwner(panelBody, 'panelBody') },
    /* 判据 3 的**通用**判据（不靠枚举类名）：面板子树里凡是"非透明 / 有背景图"的后代都列出来，
       并判断它是否覆盖到外壳圆角区域（自身圆角=0 ⇒ 会在圆角外露出直角）。
       内层背景全透明 ⇒ 外壳圆角单层显示，不会出现"圆角里套直角矩形"。 */
    innerOpaque: (() => {
      const r = panelRect
      const rad = parseFloat((cs(panel) || {}).borderTopLeftRadius) || 14
      const corners = [
        { n: 'tl', x: r.x, y: r.y }, { n: 'tr', x: r.right - rad, y: r.y },
        { n: 'bl', x: r.x, y: r.bottom - rad }, { n: 'br', x: r.right - rad, y: r.bottom - rad },
      ]
      const out = []
      for (const el of [panel, ...panel.querySelectorAll('*')]) {
        const c = cs(el); if (!c) continue
        const a = alphaOf(c.backgroundColor)
        const hasImg = String(c.backgroundImage || 'none') !== 'none'
        if (a <= 0.02 && !hasImg) continue
        const rr = rectOf(el)
        if (!rr || rr.w <= 0 || rr.h <= 0) continue
        const radius = parseFloat(c.borderTopLeftRadius) || 0
        const hitCorner = radius < 2 ? corners.filter((k) => rr.x <= k.x + rad && rr.right >= k.x && rr.y <= k.y + rad && rr.bottom >= k.y).map((k) => k.n) : []
        const areaPct = Math.round((rr.w * rr.h) / Math.max(1, r.w * r.h) * 100)
        out.push({ cls: String(el.className || el.tagName).slice(0, 52), self: el === panel, radius, bg: c.backgroundColor, bgAlpha: a, bgImage: hasImg, rect: [rr.x, rr.y, rr.w, rr.h], areaPct, cornerHit: hitCorner })
      }
      return out.filter((x) => x.self || x.areaPct >= 5 || x.cornerHit.length).sort((a, b) => b.areaPct - a.areaPct).slice(0, 14)
    })(),
    /* 判据 1 的**浏览器自证**：圆角是"画出来"还是"真的被裁"？在四个角点（外壳圆角之外
       2px 处）做 elementFromPoint：命中点若落在面板子树内 ⇒ 有内层直角从圆角外露出来
       （"四角没真的圆"/"边被切掉"的同一类问题）；命中后台内容 ⇒ 圆角成立、无外露。 */
    cornerHitTest: (() => {
      const r = panelRect
      const pts = [
        { n: 'tl', x: r.x + 2, y: r.y + 2 }, { n: 'tr', x: r.right - 2, y: r.y + 2 },
        { n: 'bl', x: r.x + 2, y: r.bottom - 2 }, { n: 'br', x: r.right - 2, y: r.bottom - 2 },
      ]
      const out = {}
      for (const p of pts) {
        const el = document.elementFromPoint(p.x, p.y)
        const inPanel = !!(el && panel.contains(el))
        out[p.n] = { hit: el ? String(el.className || el.tagName).slice(0, 44) : null, inPanel, self: el === panel }
      }
      return out
    })(),
    cornerRisk: (() => {
      const r = panelRect
      const rad = parseFloat((cs(panel) || {}).borderTopLeftRadius) || 14
      const bad = []
      for (const el of panel.querySelectorAll('*')) {
        const c = cs(el); if (!c) continue
        if (alphaOf(c.backgroundColor) <= 0.02) continue
        const rr = rectOf(el); if (!rr) continue
        if ((parseFloat(c.borderTopLeftRadius) || 0) >= 2) continue
        const cover = rr.x <= r.x + 1 && rr.y <= r.y + 1 && rr.right >= r.right - 1 && rr.bottom >= r.bottom - 1
        const nearCorner = rr.x <= r.x + rad && rr.y <= r.y + rad && rr.right >= r.right - rad && rr.bottom >= r.bottom - rad
        if (cover || nearCorner) bad.push(String(el.className || el.tagName).slice(0, 48) + ' bg=' + c.backgroundColor + ' radius=0')
      }
      return bad.slice(0, 8)
    })(),
    oursRules: { anyOfOurs: !!ours, panelRules: rulesOfOurs, panelBodyRules: pickPanelRules },
    inlineStyle: String(panel.getAttribute('style') || '').slice(0, 200),
  }
}

/* ---------- 主流程 ---------- */
const { firefox } = await loadPlaywright()
const cookie = readCookie()
const browser = await firefox.launch({ headless: !HEADED })
const ctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)))

// 预置插件设置（探针自己的 localStorage；host /settings 合并时本地点胜）
await page.addInitScript((s) => { try { localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(s)) } catch {} }, SETTINGS)

let err = null
let data = null
try {
  await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 30000 })
  try { await page.waitForFunction(() => !!globalThis.__mpwClientLoaded, null, { timeout: 20000 }) } catch {}
  // 等侧栏会话列表（host 异步拉；隔离实例/重启后更慢）
  for (let k = 0; k < 20; k++) {
    const n = await page.evaluate(() => document.querySelectorAll('.YDXeBa_sessionRow').length)
    if (n > 0) break
    await page.waitForTimeout(1500)
  }
  // 打开一个**真实**会话：底栏开关只在有会话的会话头里渲染（"新会话"占位行不算）
  const opened = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('.YDXeBa_sessionRow')]
    const target = rows.find((r) => !r.classList.contains('YDXeBa_selected')) || rows[0]
    if (target) target.click()
    return { rows: rows.length, clicked: target ? (target.textContent || '').trim().slice(0, 20) : null }
  })
  try { await page.waitForFunction(() => !!document.querySelector('[data-dsh-bottom-toggle]'), null, { timeout: WAIT_MS }) } catch {}
  await page.waitForTimeout(800)
  // 折叠态快照（判据 5：折叠时我们不该留下可见残留）
  if (DARK) await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', ''); try { globalThis.__mpwHdrFrostTest && globalThis.__mpwHdrFrostTest.sync && globalThis.__mpwHdrFrostTest.sync() } catch {} })
  await page.waitForTimeout(DARK ? 600 : 0)
  const hiddenSnap = await page.evaluate(pageCollector)
  // 点开底部面板
  const clicked = await page.evaluate(async () => {
    const t = document.querySelector('[data-dsh-bottom-toggle]')
    if (!t) return { clicked: false, why: 'no toggle' }
    const active0 = t.getAttribute('data-active')
    if (active0 !== 'true') { t.click(); await new Promise((r) => setTimeout(r, 1200)) }
    return { clicked: true, activeBefore: active0, activeAfter: t.getAttribute('data-active') }
  })
  try { await page.waitForFunction(() => { const p = document.querySelector('[data-dsh-bottom-panel]'); return !!p && !p.className.includes('Hidden') }, null, { timeout: 8000 }) } catch {}
  await page.waitForTimeout(1000)
  data = { opened, clicked, hidden: hiddenSnap, ...(await page.evaluate(pageCollector)) }
} catch (e) {
  err = String((e && e.message) || e)
}
await browser.close()

const out = { label: LABEL, variant: VARIANT, url: URL0, at: new Date().toISOString(), settings: SETTINGS, error: err, pageErrors, data }
const jf = path.join(OUT_DIR, 'bs-bottom-' + LABEL + '.json')
fs.writeFileSync(jf, JSON.stringify(out, null, 1))
// 人读一屏
const L = []
L.push('== bs 底部面板悬浮适配探针 == label=' + LABEL + ' variant=' + VARIANT)
L.push('url=' + URL0 + '  body[data-mpw-bs-version]=' + (data && data.bodyVersion) + '  toggle=' + JSON.stringify(data && data.clicked))
if (err) L.push('!! error: ' + err)
if (data && data.ok) {
  const row = (k, s) => L.push('  ' + k.padEnd(26) + ' rect=' + (s.rect ? [s.rect.x, s.rect.y, s.rect.w, s.rect.h].join(',') : '-') +
    ' margin=[' + (s.margin || '-') + '] overflow=' + s.overflow + ' radius=' + s.radiusUniform + ' bg=' + s.bg + '(a=' + s.bgAlpha + ')')
  for (const k of ['panel', 'strip', 'closeBtn', 'tabBar', 'panelBody', 'paneBody', 'pane0', 'paneContent', 'terminalWrap', 'workbench', 'centerCol', 'composer']) row(k, data[k] || {})
  L.push('  包含关系: ' + JSON.stringify(data.containment))
  L.push('  对齐: ' + JSON.stringify(data.align))
  L.push('  可见边（谁画的）:')
  for (const [k, e] of Object.entries(data.edges)) if (e) L.push('    ' + k.padEnd(11) + JSON.stringify(e))
  L.push('  我们的规则命中 [data-dsh-bottom-panel] 的条数 = ' + (data.oursRules.panelRules || []).length)
  for (const r of (data.oursRules.panelBodyRules || []).slice(0, 8)) L.push('    · ' + r)
  L.push('  面板 inline style = ' + (data.inlineStyle || '(空)'))
  L.push('  内层非透明层（判据3：内层应全透明）: ' + JSON.stringify((data.innerOpaque || []).map((x) => ({ cls: x.cls, a: x.bgAlpha, area: x.areaPct + '%', r: x.rect, hit: x.cornerHit }))))
  L.push('  圆角区直角风险（判据3）: ' + JSON.stringify(data.cornerRisk || []))
  L.push('  四角命中测试（判据1：角点不应命中面板内层）: ' + JSON.stringify(data.cornerHitTest || {}))
  const hs = data.hidden || {}
  L.push('  折叠态: panel.rect=' + (hs.panel && hs.panel.rect ? [hs.panel.rect.x, hs.panel.rect.y, hs.panel.rect.w, hs.panel.rect.h].join(',') : '-') +
    ' 面板完全在视口外(判据5无残留)=' + (hs.panel && hs.panel.rect ? (hs.panel.rect.y >= 810 || hs.panel.rect.bottom <= 0) : 'n/a') +
    ' 折叠态可见边=' + JSON.stringify(hs.edges ? Object.fromEntries(Object.entries(hs.edges).map(([k, v]) => [k, v ? Object.keys(v).filter((s2) => v[s2]) : []])) : null))
} else if (data) L.push('  采集失败: ' + data.reason)
fs.writeFileSync(path.join(OUT_DIR, 'bs-bottom-' + LABEL + '.txt'), L.join('\n') + '\n')
console.log(L.join('\n'))
console.log('\n证据: ' + jf)
process.exit(err || (data && data.ok) ? 0 : 1)

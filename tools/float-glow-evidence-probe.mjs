#!/usr/bin/env node
/**
 * float-glow-evidence-probe.mjs —— 真机只读取证（2026-10-30 任务书 §1/§2/§3）
 *
 * 为什么需要：三件事都不能再"读代码猜"——
 *   §1 标题栏悬浮缺失：规则在场（glow-fixed-safety-test A3 已断言）但真机不生效。
 *      本探针把"规则 → 桥补类 → 命中 → computed"整条链路逐环取证：
 *      body[data-mpw-float] 在不在 / 插件样式表里 float 规则在不在 / wide 桥的几何门槛
 *      实测值（rect vs 60vw·200px）/ 标题栏元素最终有没有 wSkVaW_header 类 / computed 差异表。
 *   §2 光晕形态：现实现是 body 级 fixed 层（z-index:-1）⇒ 被内容挡住 = 看不见。
 *      取证其存在性与形态（cssText/parent），作为"重做为面内光晕"的改前证据。
 *   §3 左右栏圆角：展开/收起两态 computed border-radius 对照（收起通过真实收起按钮切换，
 *      读完恢复原状，见 --no-collapse）。
 *
 * 纪律：只读 + 一次可还原的 UI 切换；不改设置（localStorage 注入只在无头档案内生效）；
 *   不杀进程、不启停服务。浏览器静音三件套（tools/_audio-mute.mjs，判据 audio-mute-discipline-test）。
 *
 * 用法:
 *   node tools/hdr-probe-mint-cookie.mjs            # 先生成 /tmp/ffprobe/cookie.json
 *   node tools/float-glow-evidence-probe.mjs --label before
 *   node tools/float-glow-evidence-probe.mjs --label before --no-collapse   # 不做收起切换
 *
 * 输出: tools/probe-out/<label>.float-glow.json + .txt
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { withAudioMute } from './_audio-mute.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const LABEL = arg('label', 'before')
const TARGET = arg('url', 'http://127.0.0.1:3080/')
const OUT_DIR = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const COOKIE_FILE = arg('cookie', process.env.MPW_COOKIE || '/tmp/ffprobe/cookie.json')
const WAIT_MS = Number(arg('wait', '15000'))
const DO_COLLAPSE = !argv.includes('--no-collapse')
const WALL_PNG = arg('wall', '')

async function loadPlaywright() {
  const cands = [
    path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'),
    path.join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'),
  ]
  for (const c of cands) if (fs.existsSync(c)) return await import(pathToFileURL(c).href)
  throw new Error('找不到 playwright（试过 ' + cands.join(' / ') + '）')
}
function readCookie() {
  if (!fs.existsSync(COOKIE_FILE)) throw new Error('缺 Cookie ' + COOKIE_FILE + '（先跑 tools/hdr-probe-mint-cookie.mjs）')
  const j = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
  if (!j.name || !j.value) throw new Error(COOKIE_FILE + ' 缺 name/value')
  return j
}

/* ---------- 页内采集（纯读） ---------- */
function collectMain() {
  const cs = (el) => { try { return el ? getComputedStyle(el) : null } catch { return null } }
  const g = (c, p) => { try { return c ? String(c.getPropertyValue(p) || '') : '' } catch { return '' } }
  const snap = (el) => {
    const c = cs(el)
    if (!c) return null
    let rect = null
    try { const b = el.getBoundingClientRect(); rect = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] } catch {}
    return {
      tag: el.tagName, cls: String(el.className || '').slice(0, 200), id: el.id || '',
      rect,
      margin: c.margin, padding: c.padding, borderRadius: c.borderRadius,
      border: c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor,
      boxShadow: String(c.boxShadow || 'none').slice(0, 120),
      background: String(c.backgroundColor) + ' | ' + String(c.backgroundImage || 'none').slice(0, 100),
      position: c.position, top: c.top, zIndex: c.zIndex, overflow: c.overflow,
      transform: c.transform, filter: c.filter, backdropFilter: c.backdropFilter,
      varSideRadius: g(c, '--mpw-side-radius'), varAliasL2: g(c, '--dsw-alias-radius-l2'),
      varFloatShadow: g(c, '--mpw-float-shadow'),
    }
  }
  const out = { url: String(location.href), innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio }
  const b = document.body
  out.bodyAttrs = {}
  for (const a of ['data-mpw-float', 'data-mpw-float-off', 'data-ds-dark-theme', 'data-mpw-rightbar-parked', 'data-mpw-sidebar-collapsed', 'data-sidebar-collapsed']) {
    if (b.hasAttribute(a)) out.bodyAttrs[a] = b.getAttribute(a) || ''
  }
  // 悬浮判定元素（按锚点查找，找到的是"当前生效的那个"）
  const q = (s) => { try { return Array.from(document.querySelectorAll(s)) } catch { return [] } }
  const headerEl = document.querySelector('body[data-mpw-float] .wSkVaW_header')
    || document.querySelector('.wSkVaW_header')
    || document.querySelector('header[class*="_header_"]')
    || document.querySelector('header')
  out.header = headerEl ? Object.assign(snap(headerEl), {
    hasBridgedClass: (() => { try { return headerEl.classList.contains('wSkVaW_header') } catch { return false } })(),
    isCodeBanner: (() => { try { return headerEl.hasAttribute('data-code-block-banner') } catch { return false } })(),
    // wide 桥门槛实测：width >= 60vw && height > 0 && height <= 200
    wideGate: (() => { const r = headerEl.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), need60vw: Math.round(window.innerWidth * 0.6), pass: r.width >= window.innerWidth * 0.6 && r.height > 0 && r.height <= 200 } })(),
  }) : null
  const sideEl = document.querySelector('body[data-mpw-float] [class*="sidebarCol"]')
    || document.querySelector('[class*="sidebarCol"]')
  out.leftSidebar = sideEl ? Object.assign(snap(sideEl), {
    hasBridgedClass: (() => { try { return sideEl.classList.contains('sidebarCol') || sideEl.classList.contains('pI_x6G_sidebarCol') } catch { return false } })(),
  }) : null
  const rsPush = document.querySelector('[data-sidebar-right-panel="push"]')
  const rsAny = document.querySelector('[data-sidebar-right-panel]') || document.querySelector('[data-dockkit-pane]')
  out.rightSidebar = rsPush ? snap(rsPush) : (rsAny ? snap(rsAny) : null)
  const composer = document.querySelector('[data-composer-card]') || document.querySelector('[class*="composer"]')
  out.composer = composer ? snap(composer) : null
  // 插件样式表里 float 规则在场性（按 selectorText 扫）
  const floatRules = []
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = null
      try { rules = sheet.cssRules } catch { continue }
      if (!rules) continue
      const walk = (list) => {
        for (const r of Array.from(list)) {
          if (r.cssRules) { walk(r.cssRules); continue }
          const st = String(r.selectorText || '')
          if (st.indexOf('data-mpw-float') >= 0) floatRules.push({ sel: st.slice(0, 220), css: String(r.style ? r.cssText : '').slice(0, 300) })
        }
      }
      walk(rules)
    }
  } catch (e) { out.floatRulesErr = String(e) }
  out.floatRuleCount = floatRules.length
  out.floatHeaderRule = floatRules.find((r) => /wSkVaW_header/.test(r.sel) && /margin/.test(r.css)) || null
  out.floatSideRule = floatRules.find((r) => /sidebarCol/.test(r.sel) && /margin/.test(r.css) && !/collapsed/.test(r.sel)) || null
  out.floatSideCollapsedRule = floatRules.find((r) => /sidebarCol/.test(r.sel) && /collapsed/.test(r.sel)) || null
  out.floatRsRule = floatRules.find((r) => /sidebar-right-panel="push"/.test(r.sel) && /border-radius/.test(r.css)) || null
  out.floatTokenRule = floatRules.find((r) => /^body\[data-mpw-float\]$/.test(r.sel.replace(/\s+/g, ''))) || null
  // 现有光晕层（body 级 fixed）形态取证
  const glow = document.querySelector('[data-mpw-glow]')
  out.glow = glow ? { parent: glow.parentElement === document.body ? 'body' : String(glow.parentElement && glow.parentElement.tagName), cssText: String(glow.style.cssText || '').slice(0, 400) } : null
  return out
}

/* ---------- 收起态采集（§3 两态对照） ---------- */
function collectCollapsed() {
  const snap = (el) => {
    if (!el) return null
    const c = getComputedStyle(el)
    let rect = null
    try { const b = el.getBoundingClientRect(); rect = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] } catch {}
    return { cls: String(el.className || '').slice(0, 200), rect, borderRadius: c.borderRadius, margin: c.margin, border: c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor, varSideRadius: String(c.getPropertyValue('--mpw-side-radius') || '') }
  }
  const sideEl = document.querySelector('body[data-mpw-float] [class*="sidebarCol"]') || document.querySelector('[class*="sidebarCol"]')
  const rsPush = document.querySelector('[data-sidebar-right-panel="push"]')
  const rsAny = document.querySelector('[data-sidebar-right-panel]') || document.querySelector('[data-dockkit-pane]')
  return {
    bodyAttrs: Object.keys(document.body.hasAttribute('data-mpw-float') ? { f: 1 } : {}).length ? 'float' : '',
    leftSidebar: snap(sideEl),
    rightSidebar: rsPush ? snap(rsPush) : (rsAny ? snap(rsAny) : null),
  }
}

// ---------- 主流程 ----------
const { firefox } = await loadPlaywright()
const cookie = readCookie()
const browser = await firefox.launch({ headless: true, firefoxUserPrefs: withAudioMute({ 'gfx.webrender.all': true }) })
const ctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
const page = await ctx.newPage()
const consoleErrs = []
page.on('pageerror', (e) => consoleErrs.push(String(e && e.message || e).slice(0, 300)))

// 壁纸前提：无头档案 localStorage 注入设置（float:true + 小图），让悬浮/光晕链路的前提成立
const WALL_STORE_KEY = 'dsh.mpkg-wallpaper.v2'
let wallSetting = null
if (WALL_PNG) {
  const abs = path.resolve(WALL_PNG)
  if (!fs.existsSync(abs)) throw new Error('--wall 不存在: ' + abs)
  wallSetting = {
    enabled: true, image: 'data:image/png;base64,' + fs.readFileSync(abs).toString('base64'),
    converted: 'png', source: path.basename(abs),
    opacity: 100, blur: 0, zoom: 100, sharp: true,
    unifyTint: true, unifyAmount: 30, sidebarAlpha: 38, chatFollow: false,
    headerBg: true, headerBlur: false, headerBlurAmount: 41, headerFrostUserSet: true,
    float: true, roundCompat: false, fpsCap: 0, resMax: 0,
  }
} else {
  wallSetting = { enabled: true, float: true, headerBg: true, headerFrostUserSet: true }
}
await page.addInitScript(([key, val]) => { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }, [WALL_STORE_KEY, wallSetting])

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 })
let wallReady = true
try {
  await page.waitForFunction(() => {
    const w = document.querySelector('.mpw-bgWrap')
    if (!w || getComputedStyle(w).display === 'none') return false
    const m = w.querySelector('img, video, iframe, canvas')
    if (!m) return false
    return !!(m.currentSrc || m.getAttribute('src'))
  }, null, { timeout: WAIT_MS })
} catch { wallReady = false }
await page.waitForTimeout(1500)

const result = { label: LABEL, url: TARGET, wallReady, consoleErrs: consoleErrs.slice(0, 5) }
result.main = await page.evaluate(collectMain)

// §3 收起态（真实收起按钮；读完还原）
if (DO_COLLAPSE) {
  const found = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('button, [role="button"]'))
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const hit = cands.filter(vis).find((el) => {
      const lab = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
      return /收起|折叠|collapse/i.test(lab) && /侧栏|侧边栏|sidebar|边栏/i.test(lab + ' ' + String(el.getAttribute('aria-label') || ''))
    }) || cands.filter(vis).find((el) => /收起|折叠|collapse/i.test(String(el.getAttribute('aria-label') || el.getAttribute('title') || '')))
    if (!hit) return { ok: false }
    hit.scrollIntoView({ block: 'center' })
    return { ok: true, label: String(hit.getAttribute('aria-label') || hit.getAttribute('title') || '') }
  })
  result.collapseButton = found
  if (found.ok) {
    await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('button, [role="button"]'))
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const hit = cands.filter(vis).find((el) => {
        const lab = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
        return /收起|折叠|collapse/i.test(lab) && /侧栏|侧边栏|sidebar|边栏/i.test(lab + ' ' + String(el.getAttribute('aria-label') || ''))
      }) || cands.filter(vis).find((el) => /收起|折叠|collapse/i.test(String(el.getAttribute('aria-label') || el.getAttribute('title') || '')))
      if (hit) hit.click()
    })
    await page.waitForTimeout(900)
    result.collapsed = await page.evaluate(collectCollapsed)
    // 还原（再点一次）
    await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('button, [role="button"]'))
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const hit = cands.filter(vis).find((el) => /展开|expand/i.test(String(el.getAttribute('aria-label') || el.getAttribute('title') || '')))
        || cands.filter(vis).find((el) => /收起|折叠|collapse/i.test(String(el.getAttribute('aria-label') || el.getAttribute('title') || '')))
      if (hit) hit.click()
    })
    await page.waitForTimeout(900)
    result.restored = await page.evaluate(collectCollapsed)
  }
}

await browser.close()

// ---------- 人读摘要 ----------
const L = []
const p = (s) => L.push(s)
p('== float-glow 真机取证 label=' + LABEL + '  wallReady=' + wallReady + ' ==')
p('body: ' + JSON.stringify(result.main.bodyAttrs) + '  viewport=' + result.main.innerW + 'x' + result.main.innerH)
p('')
p('-- §1 标题栏 --')
if (result.main.header) {
  const h = result.main.header
  p('  cls=' + h.cls.slice(0, 120))
  p('  桥补类 wSkVaW_header 在元素上? ' + h.hasBridgedClass + '  代码横幅标记? ' + h.isCodeBanner)
  p('  wide 桥门槛: ' + JSON.stringify(h.wideGate))
  p('  computed: margin=' + h.margin + ' | radius=' + h.borderRadius + ' | shadow=' + h.boxShadow.slice(0, 60))
  p('  rect=' + JSON.stringify(h.rect) + ' pos=' + h.position + ' top=' + h.top)
} else p('  （页面上没找到 header 元素）')
p('  float 标题栏规则在场? ' + (result.main.floatHeaderRule ? '✓ ' + result.main.floatHeaderRule.sel.slice(0, 80) : '✗ 不在'))
p('  令牌规则 body[data-mpw-float]{--mpw-side-radius…} 在场? ' + (result.main.floatTokenRule ? '✓ ' + result.main.floatTokenRule.css.slice(0, 120) : '✗'))
p('  float 规则总数=' + result.main.floatRuleCount)
p('')
p('-- 左栏 --')
if (result.main.leftSidebar) {
  const s = result.main.leftSidebar
  p('  cls=' + s.cls.slice(0, 120))
  p('  桥补类 sidebarCol/pI_x6G_sidebarCol? ' + s.hasBridgedClass)
  p('  computed: margin=' + s.margin + ' | radius=' + s.borderRadius + ' | shadow=' + s.boxShadow.slice(0, 60))
  p('  --mpw-side-radius=' + s.varSideRadius + '  --dsw-alias-radius-l2=' + s.varAliasL2)
} else p('  （没找到 sidebarCol）')
p('-- 右栏 --')
if (result.main.rightSidebar) {
  const s = result.main.rightSidebar
  p('  cls=' + s.cls.slice(0, 120))
  p('  computed: margin=' + s.margin + ' | radius=' + s.borderRadius + ' | shadow=' + s.boxShadow.slice(0, 60))
  p('  rect=' + JSON.stringify(s.rect) + ' pos=' + s.position)
} else p('  （没找到右栏面板）')
p('')
p('-- §2 现有光晕层 --')
p('  ' + (result.main.glow ? '存在: parent=' + result.main.glow.parent + ' cssText=' + result.main.glow.cssText.slice(0, 200) : '不存在（未触发 pointermove 属正常）'))
p('')
if (result.collapsed) {
  p('-- §3 收起态对照 --')
  p('  收起左栏: radius=' + (result.collapsed.leftSidebar ? result.collapsed.leftSidebar.borderRadius : '∅') + '  margin=' + (result.collapsed.leftSidebar ? result.collapsed.leftSidebar.margin : '∅'))
  p('  收起右栏: radius=' + (result.collapsed.rightSidebar ? result.collapsed.rightSidebar.borderRadius : '∅'))
  p('  还原左栏: radius=' + (result.restored && result.restored.leftSidebar ? result.restored.leftSidebar.borderRadius : '∅'))
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const base = path.join(OUT_DIR, LABEL + '.float-glow')
fs.writeFileSync(base + '.json', JSON.stringify(result, null, 1) + '\n')
fs.writeFileSync(base + '.txt', L.join('\n') + '\n')
console.log(L.join('\n'))
console.log('\n✓ 证据已写 ' + base + '.{json,txt}')

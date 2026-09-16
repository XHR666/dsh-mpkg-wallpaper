#!/usr/bin/env node
/**
 * header-rail-collect.mjs —— 真机页面的「顶栏磨砂 / 顶栏描边 / 右侧时间线条」computed 值采集器
 *
 * 为什么单独写它（而不是直接用 hdr-probe.mjs）：
 *   hdr-probe 的 F 断言依赖**截图像素差**判"磨砂真的看得见"。但本机（无 GPU 的容器）里
 *   **无头 Firefox 不合成 backdrop-filter**：tools/probe-out 的对照实验（见 docs/HEADER-FROST.md
 *   「像素判据的边界」）显示 blur(0/10/30px) 三种情况的截图**逐像素完全相同**。
 *   也就是说像素差在这个环境里是**假阴性**，不能用来判"磨砂可见与否"。
 *   本采集器改用**结构性判据**（全部是可离线复算的 computed/几何值）：
 *     H1 磨砂层存在，且父节点是宿主标题栏；
 *     H2 层 backdrop-filter 含 blur(Npx)（N>0）+ 内联样式里确实写了；
 *     H3 层的 z-index 与它在同级中的绘制位置（z<0 ⇒ 被父背景遮住，见 H6 的合成判据）；
 *     H4 宿主标题栏底是否半透明（alpha<1）；
 *     H5 宿主标题栏**下描边**是否可见（我们自己把它改成 transparent 就是回归）；
 *     H6 层是否**被父背景整体盖住**：父底 alpha 与层 z 的组合判定（z<0 且父底 alpha>0 ⇒ 盖住）；
 *     R1 rail 的 mark::before 最终 background 与 alpha；
 *     R2 rail 节点/伪元素的可见性（rect/opacity/visibility/display/clip）；
 *     R3 宿主 token `--dsw-alias-border-l4` 在 body 上的实际解析值；
 *     R4 我们是否在补偿（body[data-mpw-rail-ink]）以及 --mpw-rail-ink 的值。
 *
 * 用法：
 *   node tools/header-rail-collect.mjs --label before [--wall <png>] [--out tools/probe-out]
 *
 * 说明：与 hdr-probe 一样复用 /tmp/ffprobe/cookie.json（只读，不落盘密钥）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const LABEL = arg('label', 'before')
const OUT = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const WALL = arg('wall', '')
// 入力纪律（2026-09-17）：Cookie 是**外部输入**（真机凭据，由 tools/hdr-probe-mint-cookie.mjs 生成），
// 不是夹具；本脚本自己**不写任何 /tmp 临时物**、也不依赖任何历史残留目录。
// 缺文件时优雅退出并给出生成命令，而不是抛 ENOENT 栈。
const COOKIE_FILE = arg('cookie', process.env.MPW_COOKIE || '/tmp/ffprobe/cookie.json')
fs.mkdirSync(OUT, { recursive: true })

const { firefox } = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright', 'index.mjs')).href)
if (!fs.existsSync(COOKIE_FILE)) {
  console.error('[header-rail-collect] 缺少真机 Cookie 入力: ' + COOKIE_FILE + '（生成: node tools/hdr-probe-mint-cookie.mjs）')
  process.exit(2)
}
const cookie = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))

// —— 页面内采集（自包含函数体：会被序列化后在页面里执行）——
const COLLECT = () => {
  const out = { at: new Date().toISOString(), url: location.href }
  const cs = (el, pseudo) => (el ? getComputedStyle(el, pseudo || null) : null)
  const alphaOf = (c) => {
    const t = String(c || '')
    if (t === 'transparent') return 0
    // 现代形态：color(srgb 1 1 1 / 0.38)（DSH 0.1.5 的产物就用它）
    const cm = /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)/.exec(t)
    if (cm) return cm[4] === undefined ? 1 : Number(cm[4])
    const m = /rgba?\(([^)]+)\)/.exec(t)
    if (!m) return null
    const p = m[1].split(',').map(Number)
    return p.length > 3 ? p[3] : 1
  }
  const rectOf = (el) => { try { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] } catch { return null } }
  const pickEl = (el) => {
    if (!el) return null
    const c = cs(el)
    return { tag: el.tagName, cls: String(el.className || '').slice(0, 90), attrs: Array.from(el.attributes).map(a => a.name + '=' + String(a.value).slice(0, 60)),
      rect: rectOf(el), position: c.position, zIndex: c.zIndex, overflow: c.overflow, display: c.display,
      opacity: c.opacity, visibility: c.visibility, transform: c.transform, filter: c.filter,
      backdropFilter: c.backdropFilter, background: c.backgroundColor, inlineBg: el.style.backgroundColor || '', inlineBdf: el.style.backdropFilter || '' }
  }
  // ① 宿主标题栏
  const hdr = document.querySelector('.wSkVaW_header') || document.querySelector('header[class*="_header_"]') || document.querySelector('header')
  out.header = pickEl(hdr)
  if (hdr) {
    const c = cs(hdr)
    out.header.borderTop = c.borderTop; out.header.borderBottom = c.borderBottom
    out.header.borderBottomWidth = c.borderBottomWidth; out.header.borderBottomStyle = c.borderBottomStyle; out.header.borderBottomColor = c.borderBottomColor
    out.header.bgAlpha = alphaOf(c.backgroundColor)
    out.header.hasTranslucentAttr = hdr.hasAttribute('data-mpw-hdr-translucent')
    for (const p of ['::before', '::after']) {
      const cp = cs(hdr, p)
      out.header[p] = cp ? { content: cp.content, bg: cp.backgroundColor, bdf: cp.backdropFilter, borderBottom: cp.borderBottom, height: cp.height, display: cp.display } : null
    }
    // 祖先链：谁可能裁掉/盖住注入层
    out.headerAncestors = []
    for (let n = hdr.parentElement, i = 0; n && i < 6; n = n.parentElement, i++) {
      const c2 = cs(n)
      out.headerAncestors.push({ tag: n.tagName, cls: String(n.className || '').slice(0, 60), position: c2.position, overflow: c2.overflow, zIndex: c2.zIndex, filter: c2.filter, backdropFilter: c2.backdropFilter, transform: c2.transform, bg: c2.backgroundColor })
    }
  }
  // ② 我们的磨砂层
  const fe = hdr ? hdr.querySelector(':scope > .mpw-hdrFrost') : document.querySelector('.mpw-hdrFrost')
  out.frostEl = pickEl(fe)
  if (fe) {
    const c = cs(fe)
    out.frostEl.inlineCss = fe.getAttribute('style') || ''
    out.frostEl.parentIsHeader = fe.parentElement === hdr
    out.frostEl.bgAlpha = alphaOf(c.backgroundColor)
    out.frostEl.rect = rectOf(fe)
    out.frostEl.headerRect = rectOf(hdr)
    out.frostEl.covers = (() => { const a = rectOf(fe), b = rectOf(hdr); if (!a || !b) return null; return a[2] > 0 && a[3] > 0 && a[0] <= b[0] + 1 && a[1] <= b[1] + 1 && a[0] + a[2] >= b[0] + b[2] - 1 && a[1] + a[3] >= b[1] + b[3] - 1 })()
    // 宿主子节点在层之上还是之下（抽样首个子元素）
    const firstKid = Array.from(hdr.children).find(x => !x.classList.contains('mpw-hdrFrost'))
    out.frostEl.firstHostKid = firstKid ? { cls: String(firstKid.className || '').slice(0, 60), position: cs(firstKid).position, zIndex: cs(firstKid).zIndex } : null
  }
  out.bodyAttrs = document.body ? Array.from(document.body.attributes).map(a => a.name + '=' + String(a.value).slice(0, 60)) : []
  // ③ 右侧时间线条
  const marks = Array.from(document.querySelectorAll('.eGxaPq_mark, [class*="eGxaPq_mark"]'))
  const frame = document.querySelector('.eGxaPq_frame') || document.querySelector('[class*="eGxaPq_frame"]')
  const scroller = frame ? frame.querySelector('.eGxaPq_scroller') : null
  out.rail = {
    frameFound: !!frame, frameRect: rectOf(frame), scrollerRect: rectOf(scroller),
    frameRect2: frame ? (() => { try { const r = frame.getBoundingClientRect(); const c = cs(frame); return { x: r.x, y: r.y, w: r.width, h: r.height, right: c.right, top: c.top, position: c.position, opacity: c.opacity, visibility: c.visibility, display: c.display, zIndex: c.zIndex } } catch { return null } })() : null,
    markCount: marks.length, marks: [],
    ours: !!(document.body && document.body.hasAttribute('data-mpw-rail-ink')),
    tokens: {
      borderL4_body: (() => { try { return cs(document.body).getPropertyValue('--dsw-alias-border-l4').trim() } catch { return '' } })(),
      borderL4_root: (() => { try { return cs(document.documentElement).getPropertyValue('--dsw-alias-border-l4').trim() } catch { return '' } })(),
      labelPrimary: (() => { try { return cs(document.body).getPropertyValue('--dsw-alias-label-primary').trim() } catch { return '' } })(),
      mpwRailInk_root: (() => { try { return cs(document.documentElement).getPropertyValue('--mpw-rail-ink').trim() } catch { return '' } })(),
    },
  }
  for (const m of marks.slice(0, 4)) {
    const c = cs(m), cb = cs(m, '::before'), ca = cs(m, '::after')
    const r = m.getBoundingClientRect()
    out.rail.marks.push({
      cls: String(m.className || '').slice(0, 70),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      self: { bg: c.backgroundColor, opacity: c.opacity, visibility: c.visibility, display: c.display, transform: c.transform, overflow: c.overflow },
      before: cb ? { content: cb.content, bg: cb.backgroundColor, src: cb.getPropertyValue('background'), alpha: alphaOf(cb.backgroundColor), w: cb.width, h: cb.height, opacity: cb.opacity, visibility: cb.visibility, display: cb.display, transform: cb.transform, pos: cb.position, top: cb.top, left: cb.left,
        boxShadow: cb.boxShadow,   // ③(2026-09-16) 反色晕是否生效（none = 没写上）
        border: cb.border, borderRadius: cb.borderRadius } : null,
      after: ca ? { bg: ca.backgroundColor, w: ca.width, h: ca.height, display: ca.display } : null,
      // 祖先里有没有 overflow 裁切
      clippedBy: (() => { const res = []; for (let n = m.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) { const cc = cs(n); if (cc.overflow !== 'visible') res.push({ tag: n.tagName, cls: String(n.className || '').slice(0, 40), overflow: cc.overflow }) } return res })(),
      inViewport: r.y + r.height > 0 && r.y < innerHeight && r.x + r.width > 0 && r.x < innerWidth,
    })
  }
  out.viewport = { w: innerWidth, h: innerHeight }
  out.pluginCss = (() => {
    let len = 0, ours = 0
    for (const s of document.querySelectorAll('style')) { const t = s.textContent || ''; len += t.length; if (t.includes('mpw')) ours += t.length }
    return { totalStyleLen: len, oursLen: ours, styleTags: document.querySelectorAll('style').length }
  })()
  out.supportsBackdrop = (() => { try { return CSS.supports('backdrop-filter', 'blur(1px)') } catch { return null } })()
  return out
}

// —— 跑页面 ——
const browser = await firefox.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String((e && e.message) || e).slice(0, 200)))

if (WALL) {
  const abs = path.resolve(WALL)
  const b64 = fs.readFileSync(abs).toString('base64')
  const key = (() => { try { const m = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8').match(/STORE_KEY\s*=\s*["'`]([^"'`]+)["'`]/); return m ? m[1] : 'dsh-mpkg-wallpaper.settings' } catch { return 'dsh-mpkg-wallpaper.settings' } })()
  const val = { enabled: true, image: 'data:image/png;base64,' + b64, converted: 'png', opacity: 100, blur: 0, zoom: 100, sharp: true,
    unifyTint: true, unifyAmount: 30, sidebarAlpha: 38, chatFollow: false, headerBg: true, headerBlur: false, headerBlurAmount: 41,
    headerFrostUserSet: true, float: true, roundCompat: false, fpsCap: 0, resMax: 0 }
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }, [key, val])
}
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2500)
// 兜底：显示顶栏 + 复刻 rail（与 hdr-probe 同款、可审计：只做"显示"和"插入真类名节点"）
const forced = await page.evaluate(() => {
  const st = document.createElement('style'); st.id = 'mpw-collect-force'
  st.textContent = '.wSkVaW_headerHidden{visibility:visible !important;opacity:1 !important;display:flex !important;height:56px !important;min-height:56px !important;width:100% !important}'
  document.head.appendChild(st)
  const h = document.querySelector('.wSkVaW_header'); if (h) { try { h.classList.remove('wSkVaW_headerHidden') } catch {} }
  if (!document.querySelector('.eGxaPq_mark')) {
    const fx = document.createElement('div'); fx.className = 'eGxaPq_frame'
    fx.style.cssText = 'position:fixed;right:12px;top:150px;height:420px;width:28px;z-index:60'
    const rl = document.createElement('div'); rl.className = 'eGxaPq_rail'
    for (const cls of ['eGxaPq_mark', 'eGxaPq_markUnloaded', 'eGxaPq_markPreview', 'eGxaPq_markActive']) { const m = document.createElement('div'); m.className = cls; m.style.height = '24px'; rl.appendChild(m) }
    fx.appendChild(rl); document.body.appendChild(fx)
    return 'rail=synthetic'
  }
  return 'rail=host'
})
await page.waitForTimeout(600)
const data = await page.evaluate(COLLECT)
data.forced = forced
data.consoleErrs = errs
await browser.close()

const file = path.join(OUT, LABEL + '.collect.json')
fs.writeFileSync(file, JSON.stringify(data, null, 1))

// —— 人读摘要 ——
const A = (c) => { const m = /rgba?\(([^)]+)\)/.exec(String(c || '')); if (!m) return String(c || '') === 'transparent' ? 0 : 1; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1 }
const h = data.header || {}, f = data.frostEl, r = data.rail
const L = []
L.push(`=== header-rail-collect [${LABEL}] ${data.at} ===`)
L.push(`URL ${data.url}`)
L.push(`body attrs: ${(data.bodyAttrs || []).join(' ')}`)
L.push(`CSS.supports(backdrop-filter)=${data.supportsBackdrop}`)
L.push(`[顶栏] ${h.cls || '(none)'} rect=${JSON.stringify(h.rect)} position=${h.position}`)
L.push(`  backgroundColor ${h.background}  alpha=${h.bgAlpha}   translucentAttr=${h.hasTranslucentAttr}`)
L.push(`  backdropFilter ${h.backdropFilter}`)
L.push(`  border-bottom ${h.borderBottom}`)
L.push(`  ::after content=${h['::after'] && h['::after'].content} borderBottom=${h['::after'] && h['::after'].borderBottom}`)
L.push(`  ::before bdf=${h['::before'] && h['::before'].bdf} bg=${h['::before'] && h['::before'].bg}`)
L.push(`[磨砂层] found=${!!f} parentIsHeader=${f && f.parentIsHeader} rect=${f && JSON.stringify(f.rect)} covers=${f && f.covers}`)
if (f) {
  L.push(`  z-index=${f.zIndex} position=${f.position} bdf=${f.backdropFilter} bg=${f.background}(alpha ${f.bgAlpha})`)
  L.push(`  inline: ${f.inlineCss}`)
  L.push(`  宿主首个子节点: ${JSON.stringify(f.firstHostKid)}`)
  L.push(`  ○ 遮蔽判定: z<0 且父底 alpha>0 ⇒ ${(Number(f.zIndex) < 0 && (h.bgAlpha || 0) > 0) ? '★ 被父背景整体盖住（磨砂不可见）' : '未被父背景盖住'}`)
}
L.push(`[顶栏祖先链]`)
for (const a of (data.headerAncestors || [])) L.push(`  ${a.tag}.${a.cls} pos=${a.position} overflow=${a.overflow} filter=${a.filter} bdf=${a.backdropFilter} transform=${a.transform} bg=${a.bg}`)
L.push(`[时间线条] frameFound=${r.frameFound} markCount=${r.markCount} rect=${JSON.stringify(r.frameRect)} ours(data-mpw-rail-ink)=${r.ours}`)
L.push(`  tokens: border-l4(body)=${JSON.stringify(r.tokens.borderL4_body)} border-l4(root)=${JSON.stringify(r.tokens.borderL4_root)} mpw-rail-ink=${JSON.stringify(r.tokens.mpwRailInk_root)}`)
for (const m of r.marks) {
  L.push(`  · ${m.cls} rect=${JSON.stringify(m.rect)} inViewport=${m.inViewport} opacity=${m.self.opacity} visibility=${m.self.visibility} display=${m.self.display}`)
  L.push(`    ::before bg=${m.before && m.before.bg} src=${m.before && m.before.src} alpha=${m.before && m.before.alpha} w=${m.before && m.before.w} h=${m.before && m.before.h} disp=${m.before && m.before.display} op=${m.before && m.before.opacity}`)
  L.push(`    ::before box-shadow=${m.before && m.before.boxShadow}（③ 反色晕；none = 未生效）`)
  L.push(`    clippedBy=${JSON.stringify(m.clippedBy)}`)
}
L.push(`[CSS 产物] ${JSON.stringify(data.pluginCss)}`)
L.push(`[页面错误] ${JSON.stringify(data.consoleErrs || [])}`)

const txt = L.join('\n')
fs.writeFileSync(path.join(OUT, LABEL + '.collect.txt'), txt + '\n')
console.log(txt)
console.log('\n证据: ' + file)

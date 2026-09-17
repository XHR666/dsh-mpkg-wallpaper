#!/usr/bin/env node
/**
 * bgwrap-display-probe.mjs —— `.mpw-bgWrap`（壁纸层容器）**为什么 computed display:none** 的判据测量器
 *
 * 背景（2026-09-17 顶栏磨砂那条线顺带发现）：
 *   无头 Firefox 里多次量到 `.mpw-bgWrap` computed `display:none`，被记为"注入式 localStorage 与宿主
 *   /settings 合并时序"疑点。本工具只做**判据**，不改任何源码：
 *     ① **时间采样**：从 document start 起每 50ms 采一次 (wrap.display, wrap.class, img.src 长度,
 *        img.naturalWidth, 持久化里的 image/enabled/opacity)，只记**变化点** ⇒ 能区分
 *        "一开始就 none"（语义）与"先 block 后 none"（竞态/异步覆盖）。
 *     ② **CSS 分支判据**：挂钩 <style> textContent 写入，按两段产物特征分类——
 *        · `no-source` 分支（buildCss 的 `if (!hasImage)`）：文本含 `html, body { background: transparent`
 *        · `hideBg` 分支（`panel >= 100`）：不含上面那句，但含 `.mpw-bgWrap { display: none`
 *        两者都会输出 `.mpw-bgWrap { display: none !important; }`，**只有看上下文才能分清**。
 *     ③ **谁把 img.src 清掉了**：挂钩 `Element.prototype.removeAttribute('src')` 与
 *        `HTMLImageElement.prototype.src` 写入，记调用栈（本地探针，不写进插件）。
 *     ④ **谁写了持久化**：挂钩 `localStorage.setItem(STORE_KEY)`，记长度/关键字段/调用栈。
 *     ⑤ **A/B 单变量**：同一张壁纸、同一套字段，**只改 opacity**（82 vs 100）⇒ 若 display 跟着变，
 *        说明"隐藏"是面板不透明度语义（`hideBg`），不是合并时序。
 *
 * 用法：
 *   node tools/bgwrap-display-probe.mjs                     # 跑全部场景（一个 Firefox 进程，串行 context）
 *   node tools/bgwrap-display-probe.mjs --only op82,op100   # 只跑指定场景
 *   node tools/bgwrap-display-probe.mjs --secs 8            # 每场景采样时长
 * 产出：tools/probe-out/bgwrap-<label>.{json,txt}
 * 依赖：真机 Cookie（同 hdr-probe：node tools/hdr-probe-mint-cookie.mjs --out /tmp/ffprobe/cookie.json）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const OUT = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const SECS = Number(arg('secs', '8'))
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean)
const LABEL = arg('label', 'bgwrap')
fs.mkdirSync(OUT, { recursive: true })

const COOKIE_FILE = arg('cookie', process.env.MPW_COOKIE || '/tmp/ffprobe/cookie.json')
if (!fs.existsSync(COOKIE_FILE)) {
  console.error('[bgwrap-display-probe] 缺少真机 Cookie: ' + COOKIE_FILE +
    '\n  生成: node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:3080 --out ' + COOKIE_FILE)
  process.exit(2)
}
const cookie = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
const { firefox } = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'playwright', 'index.mjs')).href)

const STORE_KEY = (() => {
  try { const m = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8').match(/STORE_KEY\s*=\s*["'`]([^"'`]+)["'`]/); return m ? m[1] : 'dsh.mpkg-wallpaper.v2' } catch { return 'dsh.mpkg-wallpaper.v2' }
})()

/** 固定素材（A/B 必须同一张；本机已有 mpkg 渲染图）。 */
function findWall () {
  for (const c of ['/root/Desktop/DSHarea/mpkg_work/头_渲染v4a.png', '/root/Desktop/DSHarea/mpkg_work/Rella_渲染_final.png']) if (fs.existsSync(c)) return c
  return null
}
const WALL = findWall()
const WALL_SETTING = (opacity) => (WALL ? {
  enabled: true, image: 'data:image/png;base64,' + fs.readFileSync(WALL).toString('base64'),
  converted: 'png', source: path.basename(WALL), opacity, blur: 0, zoom: 100, sharp: true,
} : null)

/** 场景表：每个场景 = 一个全新 context（独立 localStorage）+ 可选的 host /settings 处理。 */
const SCENARIOS = [
  { name: 'op82',        note: 'A：有壁纸 + 面板不透明度 82（默认档）→ 期望 block', wall: 82,  host: 'real' },
  { name: 'op100',       note: 'B：同壁纸，**只把 opacity 改成 100** → 若 none 则是 hideBg 语义（单变量 A/B）', wall: 100, host: 'real' },
  { name: 'op99',        note: 'B2：opacity 99（边界）→ 期望 block（证明阈值恰好是 100）', wall: 99, host: 'real' },
  { name: 'op82-hostfail', note: 'C：有壁纸 + 宿主 /settings **请求失败**（abort）→ 期望 block（localStorage 兜底）', wall: 82, host: 'abort' },
  { name: 'op82-hostempty', note: 'D：有壁纸 + 宿主 /settings 返回 settings:null → 期望 block（不为空值隐藏）', wall: 82, host: 'empty' },
  { name: 'op82-localonly', note: 'E：有壁纸 + 宿主 /settings **慢响应**（4s）→ 期望 4s 前后都 block（合并时序不得先亮后灭）', wall: 82, host: 'slow' },
  { name: 'nofix',       note: 'F：无壁纸夹具（纯宿主设置，宿主无 image）→ none 属"无壁纸源"语义，作对照', wall: null, host: 'real' },
]

/** 页面侧仪表：在**页面任何脚本之前**装好（addInitScript）。 */
const INSTRUMENT = ([storeKey, wallSetting]) => {
  const P = { samples: [], css: [], lsSets: [], srcWrites: [], applied: null, boot: Math.round(performance.now()) }
  window.__mpwProbe = P
  const now = () => Math.round(performance.now())
  const stack = (n) => { try { return (new Error().stack || '').split('\n').slice(2, 2 + (n || 6)).join(' | ').slice(0, 700) } catch { return '' } }
  if (wallSetting) { try { localStorage.setItem(storeKey, JSON.stringify(wallSetting)) } catch {} }

  // ① 时间采样（只记变化点）
  let prev = ''
  const snap = () => {
    try {
      const w = document.querySelector('.mpw-bgWrap')
      const i = w ? w.querySelector('img') : null
      let ls = null
      try { const raw = localStorage.getItem(storeKey); ls = raw ? JSON.parse(raw) : null } catch {}
      const s = {
        t: now(),
        disp: w ? getComputedStyle(w).display : '(no-wrap)',
        cls: w ? String(w.className) : '',
        srcLen: i ? String(i.getAttribute('src') || '').length : -1,
        nw: i ? i.naturalWidth : -1,
        complete: i ? i.complete : null,
        lsEnabled: ls ? ls.enabled : null,
        lsOpacity: ls ? ls.opacity : null,
        lsImageLen: ls && typeof ls.image === 'string' ? ls.image.length : 0,
      }
      const key = JSON.stringify([s.disp, s.cls, s.srcLen, s.nw, s.lsEnabled, s.lsOpacity, s.lsImageLen])
      if (key !== prev) { prev = key; if (P.samples.length < 400) P.samples.push(s) }
    } catch (e) { if (P.samples.length < 400) P.samples.push({ t: now(), err: String(e).slice(0, 120) }) }
  }
  try { setInterval(snap, 50) } catch {}
  try { document.addEventListener('DOMContentLoaded', snap) } catch {}

  // ② CSS 分支判据：<style> 的 textContent 写入
  //  ①(修正) `html, body { background: transparent !important; }` 这句**两个分支都有**（buildCss 的
  //  公共块），不能拿它当"无源分支"的判据（旧口径会恒真 ⇒ 误导）。真正只在 `if (!hasImage)` 里出现的
  //  是 `.pI_x6G_sidebarCol,.hHd-Xa_root{background-color:var(--dsw-specific-sidebar-fill)}` 与
  //  `.ydkMvW_root` 那一对（见 docs/BGWRAP-VISIBILITY.md §1 的"判据锚点"）。
  const NO_SRC_ANCHOR = /\.pI_x6G_sidebarCol,\s*\n\.hHd-Xa_root\s*\{\s*background-color:\s*var\(--dsw-specific-sidebar-fill\)[\s\S]{0,200}?\.ydkMvW_root/
  const classify = (txt) => ({
    len: txt.length,
    none: /\.mpw-bgWrap\s*\{\s*display:\s*none/.test(txt),
    noSourceAnchor: NO_SRC_ANCHOR.test(txt),
    hideBgBranch: /\.mpw-bgWrap\s*\{\s*display:\s*none\s*!important;\s*\}\s*\n\.pI_x6G_frame/.test(txt),
    hasImageMarker: /\.mpw-bgWrap\s*img,\s*\n\.mpw-bgWrap\s*video\s*\{/.test(txt),
  })
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')
  if (desc && desc.set) {
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: true, get: desc.get,
      set (v) {
        try {
          if (this && this.nodeType === 1 && String(this.tagName).toLowerCase() === 'style' && typeof v === 'string' && v.indexOf('mpw-bgWrap') >= 0) {
            if (P.css.length < 60) P.css.push(Object.assign({ t: now(), styleId: this.id || '', stack: stack(5) }, classify(v)))
          }
        } catch {}
        return desc.set.call(this, v)
      },
    })
  }

  // ③ 谁清了 img.src / 谁写了 img.src
  const ra = Element.prototype.removeAttribute
  Element.prototype.removeAttribute = function (n) {
    try {
      if (String(n).toLowerCase() === 'src' && this && String(this.tagName).toLowerCase() === 'img') {
        if (P.srcWrites.length < 80) P.srcWrites.push({ t: now(), op: 'removeAttribute(src)', srcLen: String(this.getAttribute('src') || '').length, stack: stack(6) })
      }
    } catch {}
    return ra.call(this, n)
  }
  try {
    const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    if (d && d.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true, get: d.get,
        set (v) {
          try { if (P.srcWrites.length < 80) P.srcWrites.push({ t: now(), op: 'img.src=', srcLen: String(v || '').length, stack: stack(5) }) } catch {}
          return d.set.call(this, v)
        },
      })
    }
  } catch {}

  // ④ 谁写了持久化
  const si = localStorage.setItem.bind(localStorage)
  localStorage.setItem = function (k, v) {
    try {
      if (k === storeKey) {
        let f = {}
        try { const o = JSON.parse(String(v)); f = { len: String(v).length, enabled: o.enabled, opacity: o.opacity, imageLen: typeof o.image === 'string' ? o.image.length : 0, forceEnabled: o.forceEnabled } } catch {}
        if (P.lsSets.length < 60) P.lsSets.push(Object.assign({ t: now(), stack: stack(5) }, f))
      }
    } catch {}
    return si(k, v)
  }
}

/** 采一次终局快照 + 分类。 */
const COLLECT = ([storeKey]) => {
  const cs = (el) => getComputedStyle(el)
  const w = document.querySelector('.mpw-bgWrap')
  const i = w ? w.querySelector('img') : null
  const styleTxt = (() => {
    let best = ''
    for (const s of document.querySelectorAll('style')) { const t = s.textContent || ''; if (t.includes('.mpw-bgWrap') && t.length > best.length) best = t }
    return best
  })()
  let ls = null
  try { const raw = localStorage.getItem(storeKey); ls = raw ? JSON.parse(raw) : null } catch {}
  let ctxCss = null
  try { ctxCss = typeof window.__mpwBuildCss === 'function' ? window.__mpwBuildCss() : null } catch (e) { ctxCss = 'ERR ' + String(e).slice(0, 80) }
  return {
    wrap: w ? { display: cs(w).display, cls: String(w.className), zIndex: cs(w).zIndex, rect: (() => { const r = w.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })() } : null,
    img: i ? { attrLen: String(i.getAttribute('src') || '').length, propLen: String(i.src || '').length, nw: i.naturalWidth, complete: i.complete, display: cs(i).display } : null,
    cssText: { len: styleTxt.length, none: /\.mpw-bgWrap\s*\{\s*display:\s*none/.test(styleTxt), noSourceAnchor: /\.pI_x6G_sidebarCol,\s*\n\.hHd-Xa_root\s*\{\s*background-color:\s*var\(--dsw-specific-sidebar-fill\)[\s\S]{0,200}?\.ydkMvW_root/.test(styleTxt) },
    ctxCss: typeof ctxCss === 'string' ? { len: ctxCss.length, none: /\.mpw-bgWrap\s*\{\s*display:\s*none/.test(ctxCss), noSourceAnchor: /\.pI_x6G_sidebarCol,\s*\n\.hHd-Xa_root\s*\{\s*background-color:\s*var\(--dsw-specific-sidebar-fill\)[\s\S]{0,200}?\.ydkMvW_root/.test(ctxCss) } : null,
    persisted: ls ? { enabled: ls.enabled, opacity: ls.opacity, imageLen: typeof ls.image === 'string' ? ls.image.length : 0, forceEnabled: ls.forceEnabled, converted: ls.converted } : null,
    probe: window.__mpwProbe || null,
    errors: (() => { try { return (window.__mpwErrRing && window.__mpwErrRing() || []).map((e) => e.where + ': ' + e.msg).slice(0, 12) } catch { return [] } })(),
  }
}

const browser = await firefox.launch({ headless: true })
const results = []
for (const sc of SCENARIOS) {
  if (ONLY.length && !ONLY.includes(sc.name)) continue
  const ctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  const pageErrs = []
  page.on('pageerror', (e) => pageErrs.push(String((e && e.message) || e).slice(0, 200)))
  // 宿主 /settings 的三种处理（real=放行真实宿主；abort/empty/slow=注入同一路由的桩）
  if (sc.host !== 'real') {
    await page.route('**/api/mpkg-wallpaper/settings', async (route) => {
      const m = route.request().method().toUpperCase()
      if (m === 'GET') {
        if (sc.host === 'abort') return route.abort('failed')
        if (sc.host === 'slow') { await new Promise((r) => setTimeout(r, 4000)) }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings: sc.host === 'slow' ? { enabled: true, opacity: 82, unifyTint: true, forceEnabled: true } : null }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
  }
  // ①(修正) `wall: null` 的场景必须**真的不注入壁纸夹具**（原来写成 WALL_SETTING(null)，
  //   仍带着 image ⇒ "无源对照"名不副实）。
  await ctx.addInitScript(INSTRUMENT, [STORE_KEY, sc.wall ? WALL_SETTING(sc.wall) : null])
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(SECS * 1000)
  const data = await page.evaluate(COLLECT, [STORE_KEY])
  data.scenario = sc.name
  data.note = sc.note
  data.wall = WALL ? path.basename(WALL) : null
  data.host = sc.host
  data.pageErrors = pageErrs
  results.push(data)
  console.log(`[${sc.name}] disp=${data.wrap ? data.wrap.display : '(no-wrap)'} cssNone=${data.cssText.none} noSrcAnchor=${data.cssText.noSourceAnchor} imgAttrLen=${data.img ? data.img.attrLen : '-'} nw=${data.img ? data.img.nw : '-'} ls(image=${data.persisted ? data.persisted.imageLen : '-'},op=${data.persisted ? data.persisted.opacity : '-'})`)
  await ctx.close()
}
await browser.close()

// ── 判据 ──
const lines = []
lines.push('# `.mpw-bgWrap` display 判据（tools/bgwrap-display-probe.mjs）')
lines.push('')
lines.push(`时间：${new Date().toISOString()}  壁纸素材：${WALL || '(无)'}  每场景采样 ${SECS}s（50ms/次，只记变化点）`)
lines.push('')
lines.push('| 场景 | host /settings | 终局 display | CSS 含 display:none | 分支=无源锚点 | img.src 长度 | naturalWidth | 持久化 image/opacity |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const r of results) {
  lines.push(`| ${r.scenario} | ${r.host} | **${r.wrap ? r.wrap.display : '(no-wrap)'}** | ${r.cssText.none} | ${r.cssText.noSourceAnchor} | ${r.img ? r.img.attrLen : '-'} | ${r.img ? r.img.nw : '-'} | ${r.persisted ? r.persisted.imageLen + '/' + r.persisted.opacity : '-'} |`)
}
lines.push('')
for (const r of results) {
  lines.push(`## ${r.scenario} —— ${r.note}`)
  lines.push('```')
  lines.push('终局: ' + JSON.stringify({ wrap: r.wrap, img: r.img, cssText: r.cssText, ctxCss: r.ctxCss, persisted: r.persisted }))
  lines.push('')
  lines.push('display/src 变化点（时间序）:')
  for (const s of (r.probe && r.probe.samples) || []) lines.push('  ' + JSON.stringify(s))
  lines.push('')
  lines.push('<style> 写入历史（谁写的 buildCss，含分支分类）:')
  for (const c of (r.probe && r.probe.css) || []) lines.push('  ' + JSON.stringify(c))
  lines.push('')
  lines.push('img.src 写入/清除历史（含调用栈）:')
  for (const c of (r.probe && r.probe.srcWrites) || []) lines.push('  ' + JSON.stringify(c))
  lines.push('')
  lines.push(`localStorage[${STORE_KEY}] 写入历史:`)
  for (const c of (r.probe && r.probe.lsSets) || []) lines.push('  ' + JSON.stringify(c))
  lines.push('')
  lines.push('插件错误环: ' + JSON.stringify(r.errors))
  lines.push('pageerror: ' + JSON.stringify(r.pageErrors))
  lines.push('```')
  lines.push('')
}
const txt = lines.join('\n')
fs.writeFileSync(path.join(OUT, `${LABEL}.txt`), txt)
fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 2))
console.log('\n→ ' + path.join(OUT, LABEL + '.txt'))
console.log('→ ' + path.join(OUT, LABEL + '.json'))

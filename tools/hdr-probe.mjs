#!/usr/bin/env node
/**
 * hdr-probe.mjs —— 真机 computed 值探针（无头 Firefox + 复用 DSH 会话 Cookie）
 *
 * 为什么需要它（2026-09-16 第 N 轮"顶栏磨砂 / 顶栏描边 / 右侧时间线条"三个视觉 bug）：
 *   前几轮都在"读代码猜根因"，用户原话「这个问题已经处理过好几轮了」。
 *   本脚本把**真实 DSH 页面**（http://127.0.0.1:3080/）加载进无头 Firefox，直接取
 *   `getComputedStyle` 的实测值：这是唯一能定案的证据来源（不是推断）。
 *   同一脚本在"改前 / 改后"各跑一次，逐项对照即为自证。
 *
 * 用法（可复跑）：
 *   # ① 先准备鉴权（DSH web 用签名 Cookie；探针从文件读，脚本里不存任何密钥）
 *   mkdir -p /tmp/ffprobe
 *   node -e '…' # 或直接复用 tools/hdr-probe-mint-cookie.mjs（本仓库只读 /root/.dsh/.credentials.yaml，不落盘密钥）
 *   # ② 跑探针
 *   node tools/hdr-probe.mjs --label before [--url 'http://127.0.0.1:3080/?railink=off']
 *
 * 参数：
 *   --label <s>     证据标签（写进输出 JSON，默认 before）
 *   --url <u>       目标 URL（默认 http://127.0.0.1:3080/）
 *   --out <dir>     证据目录（默认 tools/probe-out/）
 *   --cookie <f>    Cookie JSON 文件（默认 /tmp/ffprobe/cookie.json，格式 {name,value}）
 *   --headed        非无头（调试用）
 *
 * 输出：
 *   <out>/<label>.json   —— 逐项 computed 证据表 + 断言结果
 *   <out>/<label>.txt    —— 人读结论（一屏）
 *   <out>/<label>-a.png  —— 顶栏区域截图（磨砂链原样）
 *   <out>/<label>-b.png  —— 同一区域，?hdrfrost=off 对照
 *
 * 断言（缺一不可；退出码非 0 表示有硬失败）：
 *   A. 磨砂层存在（.mpw-hdrFrost 在 DOM）
 *   B. 磨砂层 backdrop-filter 非 none 且含 blur(Npx)
 *   C. 顶栏底是半透明（computed backgroundColor alpha < 1）
 *   D. 顶栏描边存在（border-bottom 或 ::after/::before 里至少一条可见的描边，且不是我们搞成 transparent）
 *   E. 右侧时间线条（.eGxaPq_mark::before）background 非透明
 *   F. 磨砂"真的看得见"的可判据差异：hdrfrost=off 对照截图的顶栏带像素差（见 --diff 说明）
 *
 * 开销纪律（用户要求）：本脚本是**离线探针**，只在手动运行时开浏览器；
 *   插件运行时侧不新增任何轮询/监听（状态变化时同步一次 + ≥3s 低频保险，见 docs/HEADER-FROST.md）。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const LABEL = arg('label', 'before')
const TARGET0 = arg('url', 'http://127.0.0.1:3080/')
const withExtra = (u) => { if (!EXTRA) return u; return u + (u.includes('?') ? '&' : '?') + EXTRA }
const OUT_DIR = path.resolve(ROOT, arg('out', 'tools/probe-out'))
// 入力纪律（2026-09-17）：Cookie 是**外部输入**（真机凭据，由 tools/hdr-probe-mint-cookie.mjs 生成），
// 不是夹具；本脚本自己**不写任何 /tmp 临时物**、也不依赖任何历史残留目录。
// 缺文件时优雅退出并给出生成命令，而不是抛 ENOENT 栈。
const COOKIE_FILE = arg('cookie', process.env.MPW_COOKIE || '/tmp/ffprobe/cookie.json')
const HEADED = argv.includes('--headed')
// --wall png     用一张本机 PNG 当壁纸（页面加载前注入插件设置，让"有壁纸"这个前提成立）
// --extra 'a=b'  追加到目标 URL 的 query（A/B 对照用）
const WALL_PNG = arg('wall', '')
const EXTRA = arg('extra', '')
const TARGET = withExtra(TARGET0)
// --force-wall  探针侧兜底：把壁纸层显式显示出来（见下方注释）。
//   为什么需要：真实页面里插件的 `hasImage` 门控会把 `.mpw-bgWrap{display:none}` 写进产物
//   （本机无头环境 localStorage 是空的、mpkg 视频要宿主 token）⇒ 顶栏背后没有内容，
//   "磨砂看不看得见"根本无从测量。探针只做**显示**（不动任何颜色/边框/token），
//   用来把"背后有内容"这个前提补齐；它同时会打印它自己用了什么手段（可审计）。
const FORCE_WALL = argv.includes('--force-wall')
// --force-chrome 探针侧兜底（可审计）：
//   ① 无会话时宿主给 header 加 wSkVaW_headerHidden（rect=0）⇒ 磨砂/描边没有尺寸可测；
//      这里只**显示**它（不动任何颜色/边框/token）。
//   ② 本机无会话 ⇒ 宿主不渲染右侧 TurnNavigator rail（.eGxaPq_*）⇒ 用**真实类名复刻节点**
//      插进页面，让宿主 CSS 自己命中它（"条看不见"到底是不是我们弄的，只能这样量）。
const FORCE_CHROME = argv.includes('--force-chrome')

const WAIT_MS = Number(arg('wait', '12000'))
fs.mkdirSync(OUT_DIR, { recursive: true })

// ---------- playwright（插件 node_modules 里已有；找不到就报清楚） ----------
async function loadPlaywright() {
  const cands = [
    path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'),
    path.join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'),
    path.join(ROOT, '..', 'node_modules', 'playwright', 'index.mjs'),
  ]
  for (const c of cands) if (fs.existsSync(c)) return await import(pathToFileURL(c).href)
  throw new Error('找不到 playwright（试过 ' + cands.join(' / ') + '）')
}

function readCookie() {
  if (!fs.existsSync(COOKIE_FILE)) throw new Error('缺少鉴权 Cookie 文件 ' + COOKIE_FILE + '（DSH web 401）——先按 tools/hdr-probe-mint-cookie.mjs 生成')
  const j = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
  if (!j.name || !j.value) throw new Error(COOKIE_FILE + ' 缺 name/value')
  return j
}

// ---------- 页内采集脚本（在浏览器里跑；纯读，不改页面） ----------
function pageCollector() {
  const cs = (el, pseudo) => { try { return el ? getComputedStyle(el, pseudo || undefined) : null } catch { return null } }
  const g = (c, p) => { try { return c ? String(c.getPropertyValue(p) || '') : '' } catch { return '' } }
  const alphaOf = (bg) => {
    const m = /rgba?\(([^)]+)\)/.exec(bg || '')
    if (!m) return bg === 'transparent' ? 0 : 1
    const parts = m[1].split(',').map((x) => parseFloat(x))
    return parts.length >= 4 ? parts[3] : 1
  }
  const snap = (el, pseudo) => {
    const c = cs(el, pseudo)
    if (!c) return null
    let rect = null
    try { const b = el.getBoundingClientRect(); rect = [Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100, Math.round(b.width * 100) / 100, Math.round(b.height * 100) / 100] } catch {}
    return {
      bdf: c.backdropFilter || c.webkitBackdropFilter || 'none',
      wk: c.webkitBackdropFilter || '',
      bg: c.backgroundColor,
      bgAlpha: alphaOf(c.backgroundColor),
      bgImage: String(c.backgroundImage || 'none').slice(0, 80),
      borderTop: c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor,
      borderBottom: c.borderBottomWidth + ' ' + c.borderBottomStyle + ' ' + c.borderBottomColor,
      borderBottomAlpha: alphaOf(c.borderBottomColor),
      borderLeft: c.borderLeftWidth + ' ' + c.borderLeftStyle + ' ' + c.borderLeftColor,
      position: c.position, zIndex: c.zIndex, display: c.display, overflow: c.overflow,
      opacity: c.opacity, visibility: c.visibility,
      inset: [c.top, c.right, c.bottom, c.left].join(' '),
      boxShadow: String(c.boxShadow || 'none').slice(0, 80),
      content: pseudo ? String(c.content || '') : '',
      rect,
    }
  }
  const header = document.querySelector('.wSkVaW_header') || document.querySelector('header[class*="_header_"]') || document.querySelector('header')
  const frostEl = document.querySelector('.mpw-hdrFrost')
  const hdrCs = cs(header)
  // 右侧时间线条：宿主 TurnNavigator rail（.eGxaPq_*）
  const box = document.querySelector('.eGxaPq_frame') || document.querySelector('[class*="eGxaPq_frame"]')
  const marks = Array.from(document.querySelectorAll('.eGxaPq_mark, [class*="eGxaPq_mark"]'))
  const inBox = (el) => {
    try { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right > innerWidth * 0.7 } catch { return false }
  }
  const mark = marks.find(inBox) || marks[0] || null
  const markBefore = mark && cs(mark, '::before')
  const railAfter = mark && cs(mark, '::after')
  const railTokens = (() => {
    const c = cs(document.body)
    const names = ['--dsw-alias-border-l4', '--dsw-alias-label-primary', '--dsw-alias-label-tertiary', '--mpw-rail-ink', '--mpw-rail-ink-strong', '--mpw-hdr-frost-bg']
    const out = {}
    for (const n of names) out[n] = { body: g(c, n), html: g(cs(document.documentElement), n) }
    return out
  })()
  const wall = (() => {
    const w = document.querySelector('.mpw-bgWrap')
    const m = document.querySelector('.mpw-bgWrap img, .mpw-bgWrap video, .mpw-bgWrap iframe, .mpw-bgWrap canvas')
    return {
      wrap: w ? { display: getComputedStyle(w).display, filter: getComputedStyle(w).filter, opacity: getComputedStyle(w).opacity, class: w.className } : null,
      media: m ? { tag: m.tagName, cls: m.className, src: String(m.currentSrc || m.src || '').slice(0, 60), ready: m.readyState === undefined ? null : m.readyState, complete: m.complete === undefined ? null : m.complete } : null,
    }
  })()
  const railRect = (() => { try { const b = box && box.getBoundingClientRect(); return box ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null } catch { return null } })()
  const markRect = (() => { try { const b = mark && mark.getBoundingClientRect(); return mark ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null } catch { return null } })()
  return {
    url: location.href,
    viewport: [innerWidth, innerHeight],
    bodyAttrs: Array.from(document.body.attributes).map((a) => a.name + '=' + a.value),
    header: { found: !!header, cls: header ? header.className : '', snap: snap(header), before: snap(header, '::before'), after: snap(header, '::after') },
    frostEl: { found: !!frostEl, cls: frostEl ? frostEl.className : '', parentIsHeader: !!(frostEl && header && frostEl.parentElement === header), inlineStyle: frostEl ? String(frostEl.getAttribute('style') || '') : '', snap: snap(frostEl) },
    rail: {
      boxFound: !!box, boxCls: box ? box.className : '', boxRect: railRect, boxOverflowX: box ? cs(box).overflowX : null,
      markCount: marks.length, markCls: mark ? mark.className : '', markRect,
      markSelf: snap(mark),
      markBefore: snap(mark, '::before'),
      markBeforeRaw: {
        backgroundColor: markBefore ? markBefore.backgroundColor : '',
        background: markBefore ? String(getComputedStyle(mark, '::before').background || '') : '',
        opacity: markBefore ? markBefore.opacity : '',
        visibility: markBefore ? markBefore.visibility : '',
        display: markBefore ? markBefore.display : '',
        width: markBefore ? markBefore.width : '',
        height: markBefore ? markBefore.height : '',
        content: markBefore ? markBefore.content : '',
        transform: markBefore ? markBefore.transform : '',
      },
      markAfterRaw: railAfter ? { backgroundColor: railAfter.backgroundColor, opacity: railAfter.opacity } : null,
      tokens: railTokens,
      ours: document.body.hasAttribute('data-mpw-rail-ink'),
    },
    wallpaper: wall,
    diag: (() => { try { return typeof window.__mpwHdrFrostDiag === 'function' ? window.__mpwHdrFrostDiag() : null } catch (e) { return { err: String(e && e.message || e) } } })(),
    styleTagCount: document.querySelectorAll('style').length,
    // 宿主自己的 CSS 里跟这三个 bug 相关的规则原文（证据：判据来自宿主，不是我们猜的）
    hostCss: (() => {
      try {
        let all = ''
        for (const ss of Array.from(document.styleSheets)) {
          try { for (const r of Array.from(ss.cssRules)) all += r.cssText + '\n' } catch {}
        }
        const pick = (re, n) => { const out = []; const rx = new RegExp(re, 'g'); let m; while ((m = rx.exec(all)) && out.length < (n || 6)) out.push(m[0].replace(/\s+/g, ' ').slice(0, 220)); return out }
        return {
          totalRulesText: all.length,
          railRules: pick('\.eGxaPq_[^{]*\\{[^}]*\\}', 8),
          borderL4Defs: pick('--dsw-alias-border-l4:[^;}]*', 4),
          headerRules: pick('\.wSkVaW_header[^{,]*\\{[^}]*\\}', 6),
          hiddenHeader: pick('\.wSkVaW_headerHidden[^{]*\\{[^}]*\\}', 2),
        }
      } catch (e) { return { err: String(e && e.message || e) } }
    })(),
    // 注入层"到底有没有真的在模糊"对照：分别读 backdrop-filter=blur(30px) 与 none 后的像素差
    frostToggle: (() => { const el = document.querySelector('.mpw-hdrFrost'); return el ? { hasEl: true, bdf: getComputedStyle(el).backdropFilter } : { hasEl: false } })(),
    settings: (() => {
      try {
        const raw = localStorage.getItem('dsh-mpkg-wallpaper.settings') || ''
        const o = raw ? JSON.parse(raw) : null
        if (!o) return { raw: raw.slice(0, 80) }
        const short = {}
        for (const [k, v] of Object.entries(o)) short[k] = (typeof v === 'string' && v.length > 60) ? (v.slice(0, 40) + '…len' + v.length) : v
        return short
      } catch (e) { return { err: String(e && e.message || e) } }
    })(),
    // 插件自己那份 <style> 的关键判据：是否把壁纸层藏了（.mpw-bgWrap{display:none}）、
    // 是否含 .mpw-img 显示规则、以及我们注入的层/半透明底规则是否在产物里。
    cssProbe: (() => {
      try {
        const tags = Array.from(document.querySelectorAll('style'))
        const t = tags.map((x) => x.textContent || '').find((x) => x.includes('dsh-mpkg-wallpaper') || x.includes('mpw-bgWrap')) || ''
        const pick = (re) => { const m = t.match(re); return m ? m[0].slice(0, 90) : null }
        return {
          len: t.length,
          bgWrapNone: /\.mpw-bgWrap\s*\{\s*display:\s*none/.test(t),
          imgShow: pick(/\.mpw-bgWrap\.mpw-img[^{]*\{[^}]*\}/),
          hdrFrostRule: pick(/\.mpw-hdrFrost[^{]*\{[^}]*\}/),
          hdrTranslucentRule: pick(/\[data-mpw-hdr-translucent\][^{]*\{[^}]*\}/),
          railRule: pick(/\[data-mpw-rail-ink\][^{]*\{[^}]*\}/),
          headerBorderRule: pick(/\.wSkVaW_header\s*\{[^}]*border-bottom[^;]*;/),
          hasImageMarker: t.includes('.mpw-bgWrap.mpw-img'),
        }
      } catch (e) { return { err: String(e && e.message || e) } }
    })(),
  }
}

// ---------- 像素对比（用 python3 PIL；本机已有） ----------
function diffStats(pngA, pngB, box) {
  const py = `
import json,sys
from PIL import Image, ImageChops, ImageStat
a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB')
x,y,w,h=[int(float(v)) for v in sys.argv[3].split(',')]
box=(max(0,x),max(0,y),min(a.width,x+w),min(a.height,y+h))
ca,cb=a.crop(box),b.crop(box)
d=ImageChops.difference(ca,cb); st=ImageStat.Stat(d)
mean=sum(st.mean)/3.0
mx=max(st.extrema[i][1] for i in range(3))
nz=sum(1 for p in d.convert('L').getdata() if p>2)
tot=ca.width*ca.height
print(json.dumps({"box":list(box),"meanAbsDiff":round(mean,3),"maxDiff":mx,"changedPct":round(100.0*nz/max(1,tot),2),
 "aMean":[round(v,1) for v in ImageStat.Stat(ca).mean],"bMean":[round(v,1) for v in ImageStat.Stat(cb).mean]}))
`
  try {
    const out = execFileSync('python3', ['-c', py, pngA, pngB, box], { encoding: 'utf8' })
    return JSON.parse(out)
  } catch (e) {
    return { err: String((e && e.message) || e).slice(0, 200) }
  }
}

// ---------- 主流程 ----------
const { firefox } = await loadPlaywright()
const cookie = readCookie()
const browser = await firefox.launch({ headless: !HEADED, firefoxUserPrefs: { 'gfx.webrender.all': true } })
const ctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
const page = await ctx.newPage()
const consoleErrs = []
page.on('pageerror', (e) => consoleErrs.push(String(e && e.message || e).slice(0, 200)))

// 壁纸前提：把一张本机 PNG 以 data URL 写进插件设置（**所有键都在**：enabled/unifyTint/unifyAmount/
// headerBg/headerBlur/headerFrostUserSet…）。这样无头环境不必依赖 IndexedDB/mpkg 解包就能有"壁纸在显示"。
const WALL_STORE_KEY = (() => {
  try {
    const m = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8').match(/STORE_KEY\s*=\s*["'`]([^"'`]+)["'`]/)
    return m ? m[1] : 'dsh-mpkg-wallpaper.settings'
  } catch { return 'dsh-mpkg-wallpaper.settings' }
})()
const wallSetting = (() => {
  if (!WALL_PNG) return null
  const abs = path.resolve(WALL_PNG)
  if (!fs.existsSync(abs)) throw new Error('--wall 文件不存在: ' + abs)
  const b64 = fs.readFileSync(abs).toString('base64')
  return {
    enabled: true, image: 'data:image/png;base64,' + b64, converted: 'png', source: path.basename(abs),
    opacity: 100, blur: 0, zoom: 100, sharp: true,
    unifyTint: true, unifyAmount: 30, sidebarAlpha: 38, chatFollow: false,
    headerBg: true, headerBlur: false, headerBlurAmount: 41, headerFrostUserSet: true,
    float: true, roundCompat: false, fpsCap: 0, resMax: 0,
  }
})()
if (wallSetting) {
  await page.addInitScript(([key, val]) => { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }, [WALL_STORE_KEY, wallSetting])
}

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 })
// 等**壁纸真的在显示**再采：本机壁纸是 mpkg 里的 mp4，插件要异步解包（可能几十秒）。
// 判据 = .mpw-bgWrap 可见 + 里面 img/video 有 src/currentSrc。出现后才算稳定。
const WALL_READY = () => {
  const w = document.querySelector('.mpw-bgWrap')
  if (!w || getComputedStyle(w).display === 'none') return false
  const m = w.querySelector('img, video, iframe, canvas')
  if (!m) return false
  if (m.tagName === 'IMG') return !!(m.currentSrc || m.getAttribute('src'))
  if (m.tagName === 'VIDEO') return !!(m.currentSrc || m.getAttribute('src'))
  return true
}
let wallReady = true
try { await page.waitForFunction(WALL_READY, null, { timeout: WAIT_MS }) } catch { wallReady = false }
await page.waitForTimeout(1500)

// 探针兜底：显示顶栏 + 合成 rail 复刻节点（只在 --force-chrome 时）
let forceChromeApplied = null
if (FORCE_CHROME) {
  forceChromeApplied = await page.evaluate(() => {
    const out = {}
    const st = document.createElement('style'); st.id = 'mpw-probe-forcechrome'
    st.textContent = '.wSkVaW_headerHidden{visibility:visible !important;opacity:1 !important;display:flex !important;height:56px !important;min-height:56px !important;width:100% !important}'
    document.head.appendChild(st)
    const h = document.querySelector('.wSkVaW_header') || document.querySelector('header')
    if (h) { try { h.classList.remove('wSkVaW_headerHidden') } catch {} }
    out.header = h ? JSON.stringify(h.getBoundingClientRect()) : 'no header'
    // rail 复刻：类名与层级按真机 diag（.eGxaPq_frame > .eGxaPq_rail > .eGxaPq_mark/markUnloaded/markPreview/markActive）
    if (!document.querySelector('.eGxaPq_mark')) {
      const fx = document.createElement('div'); fx.className = 'eGxaPq_frame'
      fx.style.cssText = 'position:fixed;right:0;top:150px;height:420px;width:28px;z-index:60'
      const rl = document.createElement('div'); rl.className = 'eGxaPq_rail'
      for (const cls of ['eGxaPq_mark', 'eGxaPq_markUnloaded', 'eGxaPq_markPreview', 'eGxaPq_markActive']) {
        const m = document.createElement('div'); m.className = cls; m.style.height = '24px'; rl.appendChild(m)
      }
      fx.appendChild(rl); document.body.appendChild(fx)
      out.rail = 'synthetic(4 marks)'
    } else out.rail = 'host-rendered'
    return out
  })
  await page.waitForTimeout(400)
}

// 探针兜底：显式让壁纸层可见（只在 --force-wall 时；细节见参数说明）
let forceWallApplied = null
if (FORCE_WALL && wallSetting) {
  forceWallApplied = await page.evaluate((src) => {
    const w = document.getElementById('mpw-bgWrap') || document.querySelector('.mpw-bgWrap')
    if (!w) return 'no .mpw-bgWrap'
    w.classList.remove('mpw-video', 'mpw-web', 'mpw-scene'); w.classList.add('mpw-img')
    const im = w.querySelector('img.mpw-bgImg') || w.querySelector('img')
    if (!im) return 'no img'
    im.setAttribute('src', src); im.style.display = 'block'
    const st = document.createElement('style'); st.id = 'mpw-probe-forcewall'
    // 只压插件自己那条 no-image 兜底（.mpw-bgWrap{display:none !important}），不碰任何宿主 token/边框
    st.textContent = '.mpw-bgWrap{display:block !important}'
    document.head.appendChild(st)
    return 'ok: display:' + getComputedStyle(w).display + ' srcLen:' + String(im.getAttribute('src') || '').length
  }, wallSetting.image)
  await page.waitForTimeout(1200)
}

const data = await page.evaluate(pageCollector)

// 顶栏区域截图（探针用：证明"磨砂真的改变了顶栏像素"）
// 顶栏 rect 取自**可见**的 header：宿主在无会话时是 wSkVaW_headerHidden（rect=0）——
// 这种情况退到"页面顶部一条带"（磨砂层/描边都在这一带），并在报告里写明 clipSource。
const hb = (data.header.snap && data.header.snap.rect) || [0, 0, 0, 0]
const hbUsable = hb[2] > 20 && hb[3] > 8
const clip = hbUsable
  ? { x: Math.max(0, Math.round(hb[0]) + 2), y: Math.max(0, Math.round(hb[1]) + 2), width: Math.max(8, Math.round(hb[2]) - 4), height: Math.max(8, Math.round(hb[3]) - 4) }
  : { x: 0, y: 0, width: data.viewport[0], height: Math.min(140, data.viewport[1]) }
const clipSource = hbUsable ? 'header-rect' : 'top-band-fallback(header rect=' + JSON.stringify(hb) + ')'
const shotA = path.join(OUT_DIR, LABEL + '-a.png')
await page.screenshot({ path: shotA, clip, animations: 'disabled' })

// 对照：同页加 ?hdrfrost=off（关掉整条磨砂链）后再截同一区域
const offUrl = TARGET + (TARGET.includes('?') ? '&' : '?') + 'hdrfrost=off'
let shotB = path.join(OUT_DIR, LABEL + '-b.png')
let offData = null
try {
  await page.goto(offUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  try { await page.waitForFunction(WALL_READY, null, { timeout: WAIT_MS }) } catch {}
  if (FORCE_CHROME) {
    await page.evaluate(() => {
      const st = document.createElement('style'); st.id = 'mpw-probe-forcechrome'
      st.textContent = '.wSkVaW_headerHidden{visibility:visible !important;opacity:1 !important;display:flex !important;height:56px !important;min-height:56px !important;width:100% !important}'
      document.head.appendChild(st)
      const h = document.querySelector('.wSkVaW_header') || document.querySelector('header')
      if (h) { try { h.classList.remove('wSkVaW_headerHidden') } catch {} }
      if (!document.querySelector('.eGxaPq_mark')) {
        const fx = document.createElement('div'); fx.className = 'eGxaPq_frame'
        fx.style.cssText = 'position:fixed;right:0;top:150px;height:420px;width:28px;z-index:60'
        const rl = document.createElement('div'); rl.className = 'eGxaPq_rail'
        for (const cls of ['eGxaPq_mark', 'eGxaPq_markUnloaded', 'eGxaPq_markPreview', 'eGxaPq_markActive']) {
          const m = document.createElement('div'); m.className = cls; m.style.height = '24px'; rl.appendChild(m)
        }
        fx.appendChild(rl); document.body.appendChild(fx)
      }
    })
    await page.waitForTimeout(400)
  }
  if (FORCE_WALL && wallSetting) {
    await page.evaluate((src) => {
      const w = document.getElementById('mpw-bgWrap') || document.querySelector('.mpw-bgWrap')
      if (!w) return
      w.classList.remove('mpw-video', 'mpw-web', 'mpw-scene'); w.classList.add('mpw-img')
      const im = w.querySelector('img.mpw-bgImg') || w.querySelector('img')
      if (im) { im.setAttribute('src', src); im.style.display = 'block' }
      const st = document.createElement('style'); st.id = 'mpw-probe-forcewall'
      st.textContent = '.mpw-bgWrap{display:block !important}'
      document.head.appendChild(st)
    }, wallSetting.image)
  }
  await page.waitForTimeout(1500)
  offData = await page.evaluate(pageCollector)
  await page.screenshot({ path: shotB, clip, animations: 'disabled' })
} catch (e) {
  shotB = null
  offData = { err: String((e && e.message) || e).slice(0, 200) }
}
await browser.close()

const diff = shotB ? diffStats(shotA, shotB, [0, 0, clip.width, clip.height]) : { err: 'no b-shot' }

// ---------- 断言 ----------
const h = data.header.snap || {}
const fe = data.frostEl.snap || {}
const mb = data.rail.markBeforeRaw || {}
const borderVisible = (b) => !!b && !/^(0px|0)\b/.test(b) && /rgb/.test(b) && !/rgba\([^)]*,\s*0\)$/.test(b)
const hasStroke = borderVisible(h.borderBottom) || borderVisible(h.borderTop)
  || (data.header.after && borderVisible(data.header.after.borderBottom))
  || (data.header.before && borderVisible(data.header.before.borderBottom))
const railBgAlpha = (() => {
  const m = /rgba?\(([^)]+)\)/.exec(mb.backgroundColor || '')
  if (!m) return mb.backgroundColor === 'transparent' ? 0 : (mb.backgroundColor ? 1 : null)
  const p = m[1].split(',').map(Number)
  return p.length >= 4 ? p[3] : 1
})()
const checks = {
  A_frostLayerExists: { ok: data.frostEl.found, detail: 'found=' + data.frostEl.found + ' parentIsHeader=' + data.frostEl.parentIsHeader },
  B_frostLayerBlur: { ok: /blur\(/.test(String(fe.bdf || '')) , detail: 'backdrop-filter=' + (fe.bdf || '(no element)') },
  C_headerTranslucent: { ok: h.bgAlpha !== undefined && h.bgAlpha < 1, detail: 'header background=' + h.bg + ' alpha=' + h.bgAlpha },
  D_headerStroke: { ok: hasStroke, detail: 'header border-bottom=' + h.borderBottom + ' ::after=' + JSON.stringify(data.header.after && data.header.after.borderBottom) },
  E_railVisible: { ok: railBgAlpha !== null && railBgAlpha > 0 && (mb.opacity === undefined || parseFloat(mb.opacity) > 0) && mb.visibility !== 'hidden' && mb.display !== 'none', detail: 'mark::before bg=' + mb.backgroundColor + ' alpha=' + railBgAlpha + ' opacity=' + mb.opacity + ' display=' + mb.display },
  F_frostPixelDiff: { ok: !!(diff && !diff.err && diff.meanAbsDiff > 0.5), detail: JSON.stringify(diff) },
}

const report = { label: LABEL, wallReady, forceWallApplied, forceChromeApplied, clip, clipSource, at: new Date().toISOString(), target: TARGET, checks, data, off: offData ? { url: offData.url, header: offData.header.snap, frostEl: { found: offData.frostEl.found, snap: offData.frostEl.snap } } : offData, diff, consoleErrs }
const jsonPath = path.join(OUT_DIR, LABEL + '.json')
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))

const pad = (s, n) => String(s).padEnd(n)
const lines = []
lines.push('=== hdr-probe [' + LABEL + '] ' + new Date().toISOString() + ' ===')
lines.push('URL  ' + data.url)
lines.push('body ' + data.bodyAttrs.join(' '))
lines.push('')
lines.push('【顶栏 header】' + (data.header.cls || '(none)'))
lines.push('  backdropFilter  ' + h.bdf)
lines.push('  backgroundColor ' + h.bg + '   (alpha ' + h.bgAlpha + ')')
lines.push('  borderTop       ' + h.borderTop)
lines.push('  borderBottom    ' + h.borderBottom + '   (alpha ' + h.borderBottomAlpha + ')')
lines.push('  ::after         bg=' + (data.header.after ? data.header.after.bg : '(none)') + ' borderBottom=' + (data.header.after ? data.header.after.borderBottom : '(none)') + ' content=' + (data.header.after ? data.header.after.content : ''))
lines.push('  ::before        bdf=' + (data.header.before ? data.header.before.bdf : '(none)') + ' bg=' + (data.header.before ? data.header.before.bg : '(none)'))
lines.push('  rect            ' + JSON.stringify(h.rect))
lines.push('')
lines.push('【注入层 .mpw-hdrFrost】found=' + data.frostEl.found + ' parentIsHeader=' + data.frostEl.parentIsHeader)
lines.push('  inline  ' + data.frostEl.inlineStyle)
lines.push('  bdf     ' + fe.bdf + '   bg=' + fe.bg + '   z=' + fe.zIndex + ' pos=' + fe.position)
lines.push('  rect    ' + JSON.stringify(fe.rect) + '  inset=' + fe.inset + ' display=' + fe.display + ' visibility=' + fe.visibility + ' opacity=' + fe.opacity)
lines.push('  overflow=' + fe.overflow + '  boxShadow=' + fe.boxShadow)
lines.push('')
lines.push('【右侧时间线条】boxFound=' + data.rail.boxFound + ' ' + data.rail.boxCls + ' rect=' + JSON.stringify(data.rail.boxRect) + ' overflowX=' + data.rail.boxOverflowX)
lines.push('  markCount=' + data.rail.markCount + ' markCls=' + data.rail.markCls + ' rect=' + JSON.stringify(data.rail.markRect))
lines.push('  markSelf   bg=' + (data.rail.markSelf ? data.rail.markSelf.bg : '') + ' opacity=' + (data.rail.markSelf ? data.rail.markSelf.opacity : '') + ' visibility=' + (data.rail.markSelf ? data.rail.markSelf.visibility : ''))
lines.push('  mark::before bg=' + mb.backgroundColor + ' opacity=' + mb.opacity + ' visibility=' + mb.visibility + ' display=' + mb.display + ' w=' + mb.width + ' h=' + mb.height + ' content=' + mb.content)
lines.push('  mark::after  ' + JSON.stringify(data.rail.markAfterRaw))
lines.push('  tokens(body/html):')
for (const [k, v] of Object.entries(data.rail.tokens)) lines.push('    ' + pad(k, 26) + ' body=' + pad(v.body || '(empty)', 22) + ' html=' + (v.html || '(empty)'))
lines.push('  ours(data-mpw-rail-ink)=' + data.rail.ours)
lines.push('')
lines.push('【壁纸层】' + JSON.stringify(data.wallpaper))
lines.push('【插件设置(页面内 localStorage)】' + JSON.stringify(data.settings).slice(0, 900))
lines.push('【插件 CSS 产物】' + JSON.stringify(data.cssProbe))
lines.push('【宿主 CSS 证据】' + JSON.stringify(data.hostCss, null, 1).slice(0, 1800))
lines.push('')
lines.push('【磨砂诊断 __mpwHdrFrostDiag()】' + JSON.stringify(data.diag))
lines.push('')
lines.push('【像素对照】a=原样  b=?hdrfrost=off   clip=' + JSON.stringify(clip) + '  (' + clipSource + ')')
lines.push('  ' + JSON.stringify(diff))
lines.push('')
lines.push('【断言】')
let fail = 0
for (const [k, v] of Object.entries(checks)) { if (!v.ok) fail++; lines.push('  ' + (v.ok ? '✓' : '✗') + ' ' + pad(k, 22) + v.detail) }
lines.push('')
lines.push(fail ? ('✗ 硬失败 ' + fail + ' 项') : '✓ 6/6 通过')
if (consoleErrs.length) lines.push('pageerror: ' + consoleErrs.slice(0, 4).join(' | '))
const txt = lines.join('\n')
fs.writeFileSync(path.join(OUT_DIR, LABEL + '.txt'), txt + '\n')
console.log(txt)
console.log('\n证据: ' + jsonPath + '\n截图: ' + shotA + (shotB ? ' / ' + shotB : ''))
process.exit(fail ? 1 : 0)

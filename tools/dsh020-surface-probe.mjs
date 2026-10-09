// tools/dsh020-surface-probe.mjs —— **DSH 0.2.0-rc.2 真机只读探针**：把改版后的宿主表面 DOM 事实 dump 出来
//
// 为什么需要它（2026-10-09 用户报 5 处观感回归）：DSH 0.2.0 的前端把**全部哈希类名换掉了**
//   （`pI_x6G_*` / `wSkVaW_*` / `hHd-Xa_*` / `VOzbGW_*` / `P3OORG_*` / `uV2eYG_*` 在 0.2.0 产物里 0 命中），
//   于是本插件按类名锚定的宿主表面规则（侧栏玻璃 / 顶栏磨砂 / 弹层去截断 / dockkit 分层…）大面积落空：
//     · 右侧边栏**收纳态**仍画一层模糊底（右半屏被糊）
//     · Sub Agent 展开面板失去模糊（变成不透明）
//     · 输入框「+」按钮底变透明（只剩白模糊）
//     · 模型 / 推理等级 / 权限选择器的底变白色不透明
//     · 上下文占用圈挪到输入框下方「性能与用量」条 ⇒ 会话统计 / Token 用量弹窗没被我们的弹层玻璃接管
//   这些只能拿真页面读数说话（类名、data-*、rect、computed background/backdrop-filter），
//   所以本探针**不改宿主 DOM**，只：①按语义（文本/role）找到目标区域 → ②dump 祖先链与子树事实
//   → ③点开各弹层再 dump 一遍。产物：tools/probe-out/surface-map-020.json
//
// ⚠ 只读纪律：
//   · 对宿主 DOM 只读（只点开弹层、只读样式；不写宿主 DOM、不发消息）
//   · 拦掉插件→宿主 settings 的写回（`--allow-host-writes` 才放行）
//   · 串行：自带 flock（`MPW_FIREFOX_LOCK` 可覆盖）；静音三件套走 `_audio-mute.mjs`
// 用法：
//   flock /tmp/.mpw-firefox.lock -c 'node tools/dsh020-surface-probe.mjs'
//   node tools/dsh020-surface-probe.mjs --headed --width 1440 --height 900
// 退出码：0 采到 / 2 blocked（页面/插件拿不到）/ 3 采到了但有组失败
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { withAudioMute } from './_audio-mute.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const has = (k) => argv.includes('--' + k)
const HEADED = has('headed')
const ONLY_INNER = has('only-inner')          // 只跑弹框内层复核（第四批真机用）
const BROWSER = arg('browser', 'firefox')          // 只支持 firefox：本机（proot）Chromium 起得来但一建页就崩
                                                   // （browserType.launch 后 newPage 即 closed，已实测三种 flag 组合），
                                                   // 用户 Via/Chromium 的差异只能靠"结构 + 计算样式"推断，见 tools/probe-out 说明
const ALLOW_HOST_WRITES = has('allow-host-writes')
const WIDTH = Number(arg('width', '1440'))
const HEIGHT = Number(arg('height', '900'))
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const URL0 = arg('url', 'http://' + AUTHORITY + '/')
const OUTDIR = path.join(PLUGIN, 'tools', 'probe-out')
const OUT = path.join(OUTDIR, 'surface-map-020.json')
const COOKIE = path.join(os.tmpdir(), 'mpw-dsh020-probe-cookie.json')

/* ── 0 串行锁（与其它真机探针同一把） ──────────────────────────────────────── */
const LOCK = process.env.MPW_FIREFOX_LOCK || path.join(os.tmpdir(), '.mpw-firefox.lock')
if (process.env.MPW_PROBE_LOCKED !== '1' && process.env.MPW_PROBE_NO_FLOCK !== '1') {
  if (spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0) {
    const r = spawnSync('flock', ['-w', String(Number(arg('lock-wait', '900'))), LOCK, process.execPath, fileURLToPath(import.meta.url), ...argv], {
      stdio: 'inherit', env: Object.assign({}, process.env, { MPW_PROBE_LOCKED: '1' }),
    })
    process.exit(r.status === null ? 1 : r.status)
  }
  console.log('⚠ 本机没有 flock ⇒ 本次没加串行锁（只影响并发安全）')
}

const result = { at: new Date().toISOString(), url: URL0, viewport: [WIDTH, HEIGHT], hostWritesBlocked: 0, pageErrors: [], console: [] }
const dump = () => { try { fs.mkdirSync(OUTDIR, { recursive: true }) } catch { /* 忽略 */ } fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n') }
const blocked = (why, detail) => {
  result.blocked = { why, detail: detail === undefined ? null : String(detail).slice(0, 400), at: new Date().toISOString() }
  dump(); console.log('✗ blocked:' + why + (detail ? '  — ' + String(detail).slice(0, 300) : '')); process.exit(2)
}

/* ── 1 页面侧公共工具（addInitScript 注入成 globalThis.__sp） ───────────────── */
const INIT_HELPERS = () => {
  const P = {}
  P.txt = (e, n) => String((e && e.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, n || 40)
  /** 语义文本：textContent + placeholder + aria-label + title（0.2.0 把提示语挪进了属性，只读 textContent 会漏） */
  P.txtOf = (e, n) => [e && e.textContent, e && e.getAttribute && e.getAttribute('placeholder'),
    e && e.getAttribute && e.getAttribute('data-placeholder'), e && e.getAttribute && e.getAttribute('data-composer-placeholder'),
    e && e.getAttribute && e.getAttribute('aria-label'), e && e.getAttribute && e.getAttribute('title')]
    .filter(Boolean).map((x) => String(x).replace(/\s+/g, ' ').trim()).join(' | ').slice(0, n || 60)
  P.attrs = (e) => { const o = {}; for (const a of (e && e.attributes) || []) o[a.name] = String(a.value).slice(0, 60); return o }
  P.rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  P.pathOf = (el) => {
    const out = []
    let n = el, k = 0
    while (n && n.nodeType === 1 && k++ < 6) {
      let s = n.tagName.toLowerCase()
      const id = n.getAttribute && n.getAttribute('id')
      if (id) s += '#' + id
      const cls = String((n.className && n.className.baseVal !== void 0 ? n.className.baseVal : n.className) || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
      if (cls.length) s += '.' + cls.join('.')
      const mpw = n.getAttribute && Array.from(n.attributes).filter((a) => a.name.startsWith('data-mpw')).map((a) => '[' + a.name + ']').join('')
      out.unshift(s + mpw)
      n = n.parentElement
    }
    return out.join(' > ')
  }
  P.vis = (e) => { try { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0.01 && r.width > 1 && r.height > 1 } catch (err) { return false } }
  P.facts = (e) => {
    const c = getComputedStyle(e), r = e.getBoundingClientRect()
    const pre = (p) => { try { const x = getComputedStyle(e, p); return { bf: x.backdropFilter, bg: x.backgroundColor } } catch (err) { return null } }
    const dsw = {}
    try { for (const [k, v] of (e.computedStyleMap ? e.computedStyleMap() : [])) if (/^--(dsw|mpw)-/.test(k) && /bg|surface|fill|pop|fog|mask/.test(k)) dsw[k] = String(v).slice(0, 40) } catch (err) { /* 忽略 */ }
    return {
      tag: e.tagName, path: P.pathOf(e), cls: String((e.className && e.className.baseVal !== void 0 ? e.className.baseVal : e.className) || '').slice(0, 90),
      attrs: P.attrs(e), role: e.getAttribute && e.getAttribute('role'), text: P.txt(e, 30), rect: P.rect(e),
      position: c.position, z: c.zIndex, bg: c.backgroundColor, bgImage: String(c.backgroundImage).slice(0, 50),
      bf: c.backdropFilter, filter: String(c.filter).slice(0, 40), opacity: c.opacity, mixBlend: c.mixBlendMode,
      isolation: c.isolation, contain: c.contain, transform: c.transform === 'none' ? 'none' : 'set', overflow: c.overflow,
      border: c.border, radius: c.borderRadius, shadow: String(c.boxShadow).slice(0, 70), pointerEvents: c.pointerEvents,
      before: pre('::before'), after: pre('::after'), dswTokens: dsw,
    }
  }
  P.chain = (e, up) => { const out = []; let n = e, k = 0; while (n && n.nodeType === 1 && k++ < (up || 6)) { out.push(P.facts(n)); n = n.parentElement } return out }
  /** 画了"底"或"模糊"的元素（全文档，限量） */
  P.painters = (limit) => {
    const out = []
    for (const e of document.querySelectorAll('*')) {
      if (out.length >= (limit || 80)) break
      let c; try { c = getComputedStyle(e) } catch (err) { continue }
      const bf = c.backdropFilter && c.backdropFilter !== 'none'
      const bgA = /rgba?\(/.test(c.backgroundColor) && !/,\s*0\)$/.test(c.backgroundColor)
      const hasImg = c.backgroundImage && c.backgroundImage !== 'none'
      if (!bf && !bgA && !hasImg) continue
      if (!P.vis(e)) continue
      const r = e.getBoundingClientRect()
      if (r.width < 40 || r.height < 20) continue
      out.push(Object.assign(P.facts(e), { why: [bf ? 'bf' : '', bgA ? 'bg' : '', hasImg ? 'bgimg' : ''].filter(Boolean).join('+') }))
    }
    return out
  }
  /** 与某矩形相交的"画了东西"的元素（用来找"谁把右半屏糊了"） */
  P.paintersIn = (x0, y0, x1, y1, limit) => {
    const out = []
    for (const e of document.querySelectorAll('*')) {
      if (out.length >= (limit || 40)) break
      let c; try { c = getComputedStyle(e) } catch (err) { continue }
      const bf = c.backdropFilter && c.backdropFilter !== 'none'
      const bgA = /rgba?\(/.test(c.backgroundColor) && !/,\s*0\)$/.test(c.backgroundColor)
      if (!bf && !bgA) continue
      const r = e.getBoundingClientRect()
      if (r.width < 20 || r.height < 20) continue
      if (r.right < x0 || r.left > x1 || r.bottom < y0 || r.top > y1) continue
      out.push(Object.assign(P.facts(e), { why: [bf ? 'bf' : '', bgA ? 'bg' : ''].filter(Boolean).join('+') }))
    }
    return out
  }
  /** 含某段文本的**最内层**可见元素（用于语义定位，不依赖类名） */
  P.byText = (re, root) => {
    const rx = new RegExp(re, 'i')
    const all = Array.from((root || document).querySelectorAll('*')).filter((e) => P.vis(e) && rx.test(P.txtOf(e, 80)))
    if (!all.length) return null
    return all[all.length - 1]
  }
  P.allByText = (re) => {
    const rx = new RegExp(re, 'i')
    return Array.from(document.querySelectorAll('*')).filter((e) => P.vis(e) && rx.test(P.txtOf(e, 80))).slice(0, 6).map((e) => P.facts(e))
  }
  P.overview = () => ({
    dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight,
    mpwAttrs: (() => { const o = {}; for (const e of document.querySelectorAll('*')) for (const a of e.attributes) if (a.name.startsWith('data-mpw')) o[a.name] = (o[a.name] || 0) + 1; return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])) })(),
    dataAttrs: (() => { const o = {}; for (const e of document.querySelectorAll('*')) for (const a of e.attributes) if (a.name.startsWith('data-') && !a.name.startsWith('data-mpw')) o[a.name] = (o[a.name] || 0) + 1; return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 40)) })(),
    mpwStyleTags: document.querySelectorAll('style[data-plugin="dsh-mpkg-wallpaper"],style[data-mpw]').length,
    bgWrap: (() => { const w = document.getElementById('mpw-bgWrap'); return w ? P.facts(w) : null })(),
    layers: (() => { const w = document.getElementById('mpw-layers'); return w ? P.facts(w) : null })(),
    hasSectionTest: !!globalThis.__mpwSectionTest, hasPersist: !!globalThis.__mpwPersist,
    bgWrapParent: (() => { const w = document.getElementById('mpw-bgWrap'); return w && w.parentElement ? P.pathOf(w.parentElement) : null })(),
  })
  /** 伪元素读数：宿主经常把真正的底/模糊画在 ::before / ::after 上
   *  （真机案例：.VoX2oq_panel::before 画 var(--dsw-specific-menu) + backdrop-filter），
   *  只读元素自身会得出"我们明明改了却没效果"的错误结论。 */
  P.pseudo = (el, which) => {
    try {
      const c = getComputedStyle(el, which || '::before')
      return {
        content: c.content, bg: c.backgroundColor, bf: c.backdropFilter,
        inset: [c.top, c.right, c.bottom, c.left].join(' '), z: c.zIndex,
        pos: c.position, radius: c.borderRadius, display: c.display,
      }
    } catch (e) { return { err: String((e && e.message) || e).slice(0, 80) } }
  }
  globalThis.__sp = P
}

/* ── 内层复核（第四批真机）：挑有用量数据的会话 → 开用量弹框 → 开团队面板 → 开子代理树 ── */
const STEP_CLICK_SESSION = (i) => {
  const rows = Array.from(document.querySelectorAll('[data-row-key^="session:"]')).filter((r) => !/新会话/.test(r.textContent || ''))
  const r = rows[i]
  if (!r) return { missing: true, total: rows.length }
  try { r.click() } catch (e) { return { err: String((e && e.message) || e).slice(0, 80) } }
  return { total: rows.length, key: r.getAttribute('data-row-key') }
}
const STEP_USAGE_PILL = () => {
  const P = globalThis.__sp
  const p = document.querySelector('[class*="bOPqQW_pill"]')
  return p ? { found: true, text: P.txt(p, 60), facts: P.facts(p) } : { found: false }
}
const STEP_CAPTURE_DEEP = (sel) => {
  const P = globalThis.__sp
  const el = document.querySelector(sel)
  if (!el) return { sel, missing: true }
  const chain = []
  let n = el, k = 0
  while (n && n.nodeType === 1 && k++ < 5) { chain.push(Object.assign(P.facts(n), { depth: k, pseudoBefore: P.pseudo(n, '::before'), pseudoAfter: P.pseudo(n, '::after') })); n = n.parentElement }
  return { sel, self: Object.assign(P.facts(el), { pseudoBefore: P.pseudo(el, '::before'), pseudoAfter: P.pseudo(el, '::after') }), chain }
}

/* ── 2 页面侧采集步骤（每个都是独立 page.evaluate 函数） ───────────────────── */
const STEP_OVERVIEW = () => globalThis.__sp.overview()

const STEP_BY_TEXT_MAP = (spec) => {
  const P = globalThis.__sp
  const out = {}
  for (const [key, re] of Object.entries(spec)) {
    const e = P.byText(re)
    out[key] = e ? { facts: P.facts(e), chain: P.chain(e, 7) } : null
  }
  return out
}

const STEP_RIGHT = () => {
  const P = globalThis.__sp
  const vw = innerWidth, vh = innerHeight
  const dock = Array.from(document.querySelectorAll('[data-dockkit-pane],[data-dockkit-strip],[data-dockkit-surface],[data-dockkit-float],[data-sidebar-right-panel],[class*="rightbar"],[class*="rightBar"]'))
  return {
    paintersRight: P.paintersIn(vw * 0.55, 0, vw, vh, 40),
    dockkit: dock.slice(0, 12).map((e) => Object.assign(P.facts(e), { subtreePainters: P.paintersIn(...P.rect(e).map(Number), 12) })),
    fixedFull: Array.from(document.querySelectorAll('*')).filter((e) => { try { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return (c.position === 'fixed' || c.position === 'absolute') && r.width > vw * 0.25 && r.height > vh * 0.3 && P.vis(e) } catch (err) { return false } }).slice(0, 25).map((e) => P.facts(e)),
  }
}

const STEP_OPEN_SESSION = () => {
  const P = globalThis.__sp
  const hasConv = () => !!document.querySelector('[data-conversation-content],[data-conversation-scroll],[data-conversation-header-leading]')
  if (hasConv()) return { already: true }
  const cand = Array.from(document.querySelectorAll('[data-row-key],[class*="sessionRow"],[class*="session_row"],a[href*="session"],aside button,[class*="sidebarCol"] button,[class*="sidebarCol"] a')).filter(P.vis)
  const out = { tried: [], candidates: cand.slice(0, 10).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 40), href: e.getAttribute && e.getAttribute('href'), rowKey: e.getAttribute && e.getAttribute('data-row-key'), text: P.txtOf(e, 30) })) }
  for (const r of cand.slice(0, 16)) {
    const t = P.txtOf(r, 40)
    if (!t || /新会话|插件|设置|工作区|展开|收起/.test(t)) continue
    out.tried.push(t)
    try { r.click() } catch (err) { continue }
    return Object.assign(out, { clicked: t, path: P.pathOf(r), clicked_facts: P.facts(r) })
  }
  return Object.assign(out, { none: true })
}

/** 左栏结构（0.2.0 的会话行/导航锚点都变了，先 dump 出来再决定选择器） */
const STEP_LEFT = () => {
  const P = globalThis.__sp
  const root = document.querySelector('[data-mpw-sidebar-root]') || document.querySelector('[class*="sidebarCol"]')
  if (!root) return null
  const clickable = Array.from(root.querySelectorAll('button,a,[role="button"],[data-row-key],[tabindex]')).filter(P.vis)
  return {
    root: P.facts(root), chain: P.chain(root, 5),
    items: clickable.slice(0, 26).map((e) => Object.assign(P.facts(e), { href: e.getAttribute('href'), rowKey: e.getAttribute('data-row-key'), aria: e.getAttribute('aria-label') })),
    painters: P.paintersIn(...P.rect(root).map(Number), 20),
  }
}

/** 右栏折叠/展开开关（0.2.0 的新锚点：data-rightbar-col / data-rightbar-collapsed） */
const STEP_TOGGLE_RIGHT = () => {
  const P = globalThis.__sp
  const col = document.querySelector('[data-rightbar-col]')
  const before = col ? { collapsed: col.getAttribute('data-rightbar-collapsed'), rect: P.rect(col), attrs: P.attrs(col) } : null
  const cand = []
  if (col) cand.push(...Array.from(col.querySelectorAll('button,[role="button"]')).filter(P.vis))
  cand.push(...Array.from(document.querySelectorAll('[aria-label]')).filter((e) => P.vis(e) && /侧栏|边栏|右侧|right|展开|收起|全屏|expand|collapse/i.test(e.getAttribute('aria-label') || '')).slice(0, 6))
  for (const c of cand) {
    try { c.click() } catch (err) { continue }
    return { before, clicked: P.facts(c), aria: c.getAttribute('aria-label') }
  }
  return { before, clicked: null, cand: cand.slice(0, 6).map((e) => P.facts(e)) }
}

/** 命中某组选择器的 **CSS 规则**，按"我们的注入样式 / 宿主样式"分类（判"谁画的"最硬的一条证据） */
const STEP_RULES = (pats) => {
  const ours = [], host = []
  const rx = new RegExp(pats.join('|'))
  for (const ss of Array.from(document.styleSheets)) {
    let owner = null
    try { owner = ss.ownerNode } catch (e) { owner = null }
    const isOurs = !!(owner && owner.getAttribute && (owner.getAttribute('data-plugin') === 'dsh-mpkg-wallpaper' || owner.hasAttribute('data-mpw')))
    let rules = null
    try { rules = ss.cssRules } catch (e) { rules = null }
    if (!rules) { (isOurs ? ours : host).push({ sel: '(跨源/读不到)', href: (() => { try { return ss.href } catch (e) { return null } })() }); continue }
    for (const r of Array.from(rules)) {
      const sel = r.selectorText || ''
      if (!sel || !rx.test(sel)) continue
      const css = String(r.style && r.style.cssText || '').slice(0, 260)
      if (!/backdrop-filter|background|opacity|z-index|filter|isolation|mix-blend/.test(css)) continue
      ;(isOurs ? ours : host).push({ sel: sel.slice(0, 150), css, href: (() => { try { return ss.href } catch (e) { return null } })() })
    }
  }
  return { ours: ours.slice(0, 40), host: host.slice(0, 40), counts: { ours: ours.length, host: host.length } }
}

/** 一次抓齐"用户报的五处"的全部事实（A/B 两次调用，用来分清是我们画的还是宿主画的） */
const STEP_SNAPSHOT = () => {
  const P = globalThis.__sp
  const vw = innerWidth, vh = innerHeight
  const q = (sel) => { try { return document.querySelector(sel) } catch (e) { return null } }
  const topAt = (x, y) => { const e = document.elementFromPoint(Math.round(x), Math.round(y)); return e ? { facts: P.facts(e), chain: P.chain(e, 5) } : null }
  const rightEdgeControls = Array.from(document.querySelectorAll('button,[role="button"]')).filter(P.vis)
    .map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.left > vw - 90).map((x) => Object.assign(P.facts(x.e), { aria: x.e.getAttribute('aria-label') }))
  const wrap = (sel, up) => { const e = q(sel); return e ? { facts: P.facts(e), chain: P.chain(e, up || 4) } : null }
  const usageAnchor = P.byText('tok/s|缓存命中|性能与用量')
  let usageRoot = usageAnchor
  for (let i = 0; usageRoot && i < 6 && usageRoot.parentElement; i++) {
    usageRoot = usageRoot.parentElement
    const b = usageRoot.getBoundingClientRect()
    if (b.width > 300 && b.height > 16 && b.height < 90) break
  }
  return {
    enabled: (() => { try { return globalThis.__mpwPersist.read().enabled } catch (e) { return null } })(),
    vw, vh,
    mpwCount: document.querySelectorAll('[data-mpw],[data-mpw-bg-wrap]').length,
    bgWrap: !!document.getElementById('mpw-bgWrap'),
    layers: (() => { const w = document.getElementById('mpw-layers'); return w ? P.rect(w) : null })(),
    rightTop: { p75_35: topAt(vw * 0.75, vh * 0.35), p90_50: topAt(vw * 0.9, vh * 0.5), p60_20: topAt(vw * 0.6, vh * 0.2) },
    rightStack: [[0.6, 0.3], [0.75, 0.5], [0.9, 0.35], [0.8, 0.8]].map(([fx, fy]) => ({
      at: [Math.round(vw * fx), Math.round(vh * fy)],
      els: (() => { try { return document.elementsFromPoint(Math.round(vw * fx), Math.round(vh * fy)).slice(0, 6).map((e) => P.facts(e)) } catch (e) { return 'err:' + String(e && e.message || e) } })(),
    })),
    panelDetail: (() => {
      const e = q('[data-sidebar-right-panel],[class*="P3OORG_panel"]')
      if (!e) return null
      const c = getComputedStyle(e)
      return {
        facts: P.facts(e), chain: P.chain(e, 6),
        ariaHidden: e.getAttribute('aria-hidden'), inert: e.hasAttribute('inert'),
        display: c.display, visibility: c.visibility, opacity: c.opacity, clipPath: c.clipPath,
        clientRects: e.getClientRects().length,
        ancestorsOverflow: (() => { const out = []; let n = e.parentElement, k = 0; while (n && k++ < 6) { const cc = getComputedStyle(n); out.push({ sel: P.pathOf(n).slice(-60), rect: P.rect(n), overflow: cc.overflow, transform: cc.transform === 'none' ? 'none' : 'set', clip: cc.clipPath, z: cc.zIndex, bf: cc.backdropFilter }); n = n.parentElement } return out })(),
      }
    })(),
    rules: globalThis.__spRules ? globalThis.__spRules : null,
    rightCol: wrap('[data-rightbar-col]', 3),
    rightCollapsed: wrap('[data-rightbar-collapsed]', 4),
    rightPanel: wrap('[data-sidebar-right-panel],[class*="P3OORG_panel"]', 5),
    dockkitSurface: wrap('[data-dockkit-surface]', 4),
    rightPainters: P.paintersIn(vw * 0.55, 0, vw, vh, 14),
    rightEdgeControls,
    composer: (() => { const c = q('[data-composer-card]'); return c ? Object.assign(P.facts(c), { buttons: Array.from(c.querySelectorAll('button')).filter(P.vis).map((e) => Object.assign(P.facts(e), { aria: e.getAttribute('aria-label') })) }) : null })(),
    addBtn: wrap('[class*="_add"]', 3),
    permissionBtn: wrap('[class*="iWlSmW_trigger"]', 3),
    modelBtn: wrap('[class*="_7KE1Ra_trigger"]', 3),
    usage: usageRoot ? Object.assign(P.facts(usageRoot), { texts: P.allByText('tok/s|缓存命中|性能与用量|会话统计|Token') }) : null,
    cards: Array.from(document.querySelectorAll('[data-conversation-content] [class*="card"],[data-conversation-content] [class*="Card"],[class*="subagent"],[class*="subAgent"],[class*="Subagent"]')).filter(P.vis).slice(0, 10).map((e) => Object.assign(P.facts(e), { text: P.txt(e, 40) })),
    dshwvRoot: (() => { const c = q('[class*="dshwv-root"]'); return c ? Object.assign(P.facts(c), { html: String(c.innerHTML || '').replace(/\s+/g, ' ').slice(0, 260) }) : null })(),
  }
}

/** 当前是不是"有内容的会话"（空会话里用量条/权限/子智能体入口都不渲染） */
const STEP_CONV_STATE = () => {
  const P = globalThis.__sp
  const c = document.querySelector('[data-conversation-content]')
  return {
    selected: (() => { const e = document.querySelector('[data-row-key][class*="selected"]'); return e ? e.getAttribute('data-row-key') : null })(),
    conv: c ? { len: String(c.textContent || '').length, h: c.scrollHeight } : null,
    composer: !!document.querySelector('[data-composer-card],[data-composer-input]'),
    usage: !!P.byText('tok/s|缓存命中|性能与用量'),
    permission: !!P.byText('完全权限|权限'),
    subagents: !!P.byText('个子智能体|子智能体|智能体团队'),
    rows: Array.from(document.querySelectorAll('[data-row-key^="session:"]')).slice(0, 12).map((e) => ({ key: e.getAttribute('data-row-key'), text: P.txtOf(e, 30), rect: P.rect(e) })),
  }
}

/** 折叠态的停靠面板：到底有没有被画出来（Chromium 与 Firefox 不一致的取证） */
const STEP_PARK = () => {
  const P = globalThis.__sp
  const el = document.querySelector('[data-sidebar-right-panel],[class*="P3OORG_panel"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cx = Math.round(Math.min(innerWidth - 2, Math.max(1, r.left + r.width * 0.55)))
  const cy = Math.round(Math.min(innerHeight - 2, Math.max(1, r.top + r.height * 0.5)))
  return {
    facts: P.facts(el),
    ariaHidden: el.getAttribute('aria-hidden'),
    checkVisibility: (() => { try { return el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }) : 'n/a' } catch (e) { return 'err' } })(),
    rects: el.getClientRects().length,
    hitAtPanel: (() => { try { const e = document.elementFromPoint(cx, cy); return e ? P.pathOf(e) : null } catch (e) { return 'err' } })(),
    hitIsInsidePanel: (() => { try { const e = document.elementFromPoint(cx, cy); return !!(e && (e === el || el.contains(e))) } catch (e) { return 'err' } })(),
    at: [cx, cy],
    frameCollapsed: (() => { const f = document.querySelector('[data-rightbar-collapsed]'); return f ? f.getAttribute('data-rightbar-collapsed') : null })(),
    colRect: (() => { const c = document.querySelector('[data-rightbar-col]'); return c ? P.rect(c) : null })(),
    stylesOfAncestors: (() => { const out = []; let n = el, k = 0; while (n && k++ < 5) { const c = getComputedStyle(n); out.push({ sel: P.pathOf(n).slice(-70), vis: c.visibility, disp: c.display, op: c.opacity, cv: c.contentVisibility || 'n/a', overflow: c.overflow, contain: c.contain, clip: c.clipPath, transform: c.transform === 'none' ? 'none' : 'set', w: Math.round(n.getBoundingClientRect().width) }); n = n.parentElement } return out })(),
  }
}

/** 展开态右栏：2~3 层子树里谁在画底（找"Sub Agent 面板不透明"的那一层） */
/** 展开右栏（稳定锚点：宿主 0.2.0 的 `button[data-sidebar-right-expand="true"]`） */
/** 打开"+"展开的触发候选菜单（slash menu）：聚焦输入框打一个 "/" */
const STEP_OPEN_TRIGGER = () => {
  const P = globalThis.__sp
  const box = document.querySelector('[data-composer-input], [data-composer-card] textarea, [data-composer-card] [contenteditable="true"], textarea')
  if (!box) return { none: true }
  try { box.focus() } catch (e) { /* 忽略 */ }
  try {
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') { box.value = '/'; box.dispatchEvent(new Event('input', { bubbles: true })) }
    else { box.textContent = '/'; box.dispatchEvent(new InputEvent('input', { bubbles: true })) }
  } catch (e) { return { err: String((e && e.message) || e).slice(0, 120) } }
  return { typed: true, tag: box.tagName }
}

const STEP_EXPAND_RIGHT = () => {
  const P = globalThis.__sp
  if (!document.querySelector('[data-rightbar-collapsed]')) return { already: true }
  const cand = [document.querySelector('[data-sidebar-right-expand="true"]')].concat(
    Array.from(document.querySelectorAll('button')).filter((e) => /打开右侧边栏|展开右侧|Open right/i.test(e.getAttribute && (e.getAttribute('aria-label') || ''))))
  for (const t of cand) {
    if (!t || !P.vis(t)) continue
    try { t.click() } catch (e) { continue }
    return { clicked: P.facts(t), aria: t.getAttribute('aria-label') }
  }
  return { none: true, cand: cand.map((e) => (e ? P.facts(e) : null)).slice(0, 4) }
}

/** 打开 Sub Agent 面板（表头里的"个子智能体/智能体团队"入口） */
const STEP_OPEN_SUBAGENT = () => {
  const P = globalThis.__sp
  const e = P.byText('个子智能体|子智能体|智能体团队|Sub-?agents')
  if (!e) return { none: true }
  let t = e
  for (let i = 0; i < 3 && t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'button'; i++) t = t.parentElement
  try { (t || e).click() } catch (err) { return { err: String(err && err.message || err) } }
  return { clicked: P.facts(t || e) }
}

/** 面包屑可见性（bug F）：命中测试打到的是不是面包屑自己 */
/** 模糊为什么是死的：从目标表面往上走，找出**第一个 backdrop root**（backdrop-filter / isolation /
 *  filter / opacity<1 / mask / contain:paint / mix-blend-mode）以及它是不是我们的规则画的。
 *  目的：0.2.0 里宿主把菜单外壳写成 `isolation:isolate`，子层 `._material_*` 的 blur(40px)
 *  只能采样外壳内部 ⇒ 看起来"完全没模糊"；我们要知道每一处到底卡在哪一层。 */
/** 内层容器取证：某元素 + 它的子节点（≤2 层）各自画了什么底/模糊，以及我们有没有命中它 */
const STEP_INNER = (sel) => {
  const P = globalThis.__sp
  const el = document.querySelector(sel)
  if (!el) return { sel, missing: true }
  const rows = []
  const walk = (e, d) => {
    if (d > 2 || rows.length > 24) return
    rows.push(Object.assign(P.facts(e), { depth: d }))
    for (const c of Array.from(e.children)) walk(c, d + 1)
  }
  walk(el, 0)
  return { sel, self: P.facts(el), rows }
}

const STEP_BD_CHAIN = (sel) => {
  const P = globalThis.__sp
  const el = document.querySelector(sel)
  if (!el) return { sel, missing: true }
  const rows = []
  let n = el, k = 0
  while (n && n.nodeType === 1 && k++ < 14) {
    const c = getComputedStyle(n)
    const ours = !!(n.hasAttribute && (n.hasAttribute('data-mpw-rs-surface') || n.hasAttribute('data-mpw-holds-layer') || n.hasAttribute('data-mpw-pop-bg') || n.hasAttribute('data-mpw-pop-untrunc') || n.hasAttribute('data-mpw-pop-frost')))
    rows.push({
      path: P.pathOf(n).slice(-58),
      attr: ['data-mpw-rs-surface', 'data-mpw-holds-layer', 'data-mpw-pop-bg', 'data-mpw-pop-untrunc', 'data-menu-material', 'data-trigger-menu', 'data-team-panel'].filter((a) => n.hasAttribute && n.hasAttribute(a)),
      bf: c.backdropFilter, iso: c.isolation, filter: c.filter === 'none' ? 'none' : 'set', op: c.opacity,
      mask: (c.maskImage && c.maskImage !== 'none') || (c.webkitMaskImage && c.webkitMaskImage !== 'none') ? 'set' : 'none',
      contain: c.contain, blend: c.mixBlendMode, z: c.zIndex, pos: c.position, ours,
    })
    n = n.parentElement
  }
  const firstRoot = rows.findIndex((r, i) => i > 0 && (r.bf !== 'none' || r.iso === 'isolate' || r.filter === 'set' || Number(r.op) < 1 || r.mask === 'set' || /paint/.test(r.contain) || (r.blend && r.blend !== 'normal')))
  return { sel, self: P.facts(el), firstRoot: firstRoot < 0 ? null : rows[firstRoot], chain: rows }
}

const STEP_CRUMB = () => {
  const P = globalThis.__sp
  const el = document.querySelector('[class*="crumbCurrent"], [class*="crumb"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const hit = (() => { try { return document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) } catch (e) { return null } })()
  const c = getComputedStyle(el)
  return {
    facts: P.facts(el), text: P.txt(el, 40),
    hitTag: hit ? hit.tagName + '.' + String(hit.className).slice(0, 40) : null,
    hitIsCrumb: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))),
    color: c.color, opacity: c.opacity, visibility: c.visibility, zIndex: c.zIndex, position: c.position,
    underFrost: (() => { const f = document.querySelector('.mpw-hdrFrost'); if (!f) return null; const fr = f.getBoundingClientRect(); return !(r.bottom < fr.top || r.top > fr.bottom || r.right < fr.left || r.left > fr.right) })(),
  }
}

/** 空标题栏（bug G）：空白态有没有被我们画上底色/磨砂 */
const STEP_HEADERBOX = () => {
  const P = globalThis.__sp
  const h = document.querySelector('.wSkVaW_header, [class*="wSkVaW_header"]')
  if (!h) return null
  const c = getComputedStyle(h)
  const f = h.querySelector(':scope > .mpw-hdrFrost')
  return {
    cls: String(h.className), rect: P.rect(h),
    blankAttr: document.body.hasAttribute('data-mpw-hdr-blank'),
    frostEl: !!f, frostBf: f ? getComputedStyle(f).backdropFilter : null,
    bg: c.backgroundColor, bf: c.backdropFilter, shadow: String(c.boxShadow).slice(0, 60),
    titleRowText: (() => { const t = h.querySelector('[class*="titleRow"], [class*="crumb"]'); return t ? P.txt(t, 40) : null })(),
  }
}

const STEP_PANE_TREE = () => {
  const P = globalThis.__sp
  const pane = document.querySelector('[data-dockkit-pane]') || document.querySelector('[data-dockkit-surface]') || document.querySelector('[data-sidebar-right-panel]')
  if (!pane) return null
  const out = []
  const walk = (e, depth) => {
    if (depth > 3 || out.length > 40) return
    out.push(Object.assign(P.facts(e), { depth }))
    for (const c of Array.from(e.children)) walk(c, depth + 1)
  }
  walk(pane, 0)
  return { root: P.facts(pane), nodes: out }
}

const STEP_COMPOSER = () => {
  const P = globalThis.__sp
  const anchor = P.byText('发消息或创建任务|Send a message|输入消息|Orchestrate')
  if (!anchor) return null
  /* 往父级找到"包含输入区 + 至少两个按钮"的那一层，作为 composer 根 */
  let root = anchor
  for (let i = 0; i < 8 && root.parentElement; i++) {
    root = root.parentElement
    const r = root.getBoundingClientRect()
    if (r.height > 90 && root.querySelectorAll('button,[role="button"]').length >= 2) break
  }
  const btns = Array.from(root.querySelectorAll('button,[role="button"],[role="combobox"],[aria-haspopup]')).filter(P.vis)
  return {
    root: P.facts(root), chain: P.chain(root, 7),
    buttons: btns.slice(0, 24).map((e) => Object.assign(P.facts(e), { aria: e.getAttribute('aria-label'), expanded: e.getAttribute('aria-expanded') })),
    painters: P.paintersIn(...P.rect(root).map(Number), 25),
  }
}

const STEP_USAGE_BAR = () => {
  const P = globalThis.__sp
  const a = P.byText('tok/s|缓存命中|性能与用量|Token\\s*用量|会话统计|轮\\s*/')
  if (!a) return null
  let root = a
  for (let i = 0; i < 6 && root.parentElement; i++) {
    root = root.parentElement
    const r = root.getBoundingClientRect()
    if (r.width > innerWidth * 0.4 && r.height > 14 && r.height < 120) break
  }
  return { anchor: P.facts(a), root: P.facts(root), chain: P.chain(root, 6), subtree: P.paintersIn(...P.rect(root).map(Number), 25), texts: P.allByText('tok/s|缓存命中|性能与用量|Token\\s*用量|会话统计') }
}

const STEP_HEADER = () => {
  const P = globalThis.__sp
  const out = {}
  for (const [k, re] of Object.entries({ subagents: '个子智能体|子智能体|Sub-?agents', team: '智能体团队|Agent Team', tabs: '^对话$|轨迹' })) {
    const e = P.byText(re)
    out[k] = e ? { facts: P.facts(e), chain: P.chain(e, 7) } : null
  }
  out.headerPainters = P.paintersIn(0, 0, innerWidth, Math.min(140, innerHeight * 0.2), 25)
  return out
}

const STEP_POPOVERS = () => {
  const P = globalThis.__sp
  /* 顶层浮层：body 下、fixed/absolute、可见、面积够大 */
  const roots = Array.from(document.querySelectorAll('body > *, [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"], [role="tooltip"]'))
    .filter(P.vis)
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 30 })
  return roots.slice(0, 14).map((e) => Object.assign(P.facts(e), {
    subtree: P.paintersIn(...P.rect(e).map(Number), 18),
    items: Array.from(e.querySelectorAll('[role="menuitem"],[role="option"],button')).filter(P.vis).slice(0, 10).map((x) => Object.assign(P.facts(x), { aria: x.getAttribute('aria-label') })),
  }))
}

const STEP_CLICK_OPENER = (plan) => {
  const P = globalThis.__sp
  const tryOne = (step) => {
    let els = []
    if (step.sel) { try { els = Array.from(document.querySelectorAll(step.sel)) } catch (err) { els = [] } }
    if (step.text) { const e = P.byText(step.text); if (e) els = [e] }
    if (step.aria) { try { els = Array.from(document.querySelectorAll('[aria-label]')).filter((e) => new RegExp(step.aria, 'i').test(e.getAttribute('aria-label') || '')) } catch (err) { els = [] } }
    for (const e of els) {
      if (!P.vis(e)) continue
      let t = e
      for (let i = 0; i < 3 && t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'button' && !t.getAttribute('aria-haspopup'); i++) t = t.parentElement
      const target = t || e
      try { target.scrollIntoView({ block: 'center' }) } catch (err) { /* 忽略 */ }
      try { target.click() } catch (err) { continue }
      return { via: step.sel ? 'sel:' + step.sel : (step.aria ? 'aria:' + step.aria : 'text:' + step.text), target: P.facts(target) }
    }
    return null
  }
  for (const step of plan) { const r = tryOne(step); if (r) return r }
  return null
}

/** 确定性抓取：点开某个入口 → 等目标元素出现 → 抓它和内层（≤2 层）的背景/模糊 */
const STEP_OPEN_AND_CAPTURE = async (plan) => {
  const P = globalThis.__sp
  const out = { plan, steps: [] }
  for (const step of plan) {
    if (step.click) {
      const el = step.click.aria ? document.querySelector('[aria-label="' + step.click.aria + '"]') : P.byText(step.click.text)
      if (!el) { out.steps.push({ click: step.click, missing: true }); continue }
      let t = el
      for (let i = 0; i < 3 && t && t.tagName !== 'BUTTON' && t.getAttribute('role') !== 'button'; i++) t = t.parentElement
      try { (t || el).click() } catch (e) { out.steps.push({ click: step.click, err: String(e && e.message || e).slice(0, 80) }); continue }
      out.steps.push({ click: step.click, clicked: true })
    }
    if (step.wait) {
      const t0 = Date.now()
      let ok = false
      while (Date.now() - t0 < (step.timeout || 6000)) {
        if (document.querySelector(step.wait)) { ok = true; break }
        await new Promise((r) => setTimeout(r, 120))
      }
      out.steps.push({ wait: step.wait, ok, ms: Date.now() - t0 })
      if (!ok) continue
    }
    if (step.capture) {
      const el = document.querySelector(step.capture)
      out.steps.push({ capture: step.capture, found: !!el, data: el ? (function () {
        const rows = []
        const walk = (e, d) => { if (d > 2 || rows.length > 26) return; rows.push(Object.assign(P.facts(e), { depth: d })); for (const c of Array.from(e.children)) walk(c, d + 1) }
        walk(el, 0)
        return { self: P.facts(el), rows }
      })() : null })
    }
    if (step.escape) { try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) } catch (e) { /* 忽略 */ } await new Promise((r) => setTimeout(r, 400)) }
  }
  return out
}

const STEP_CSS_REV = () => {
  let text = ''
  try { for (const st of Array.from(document.styleSheets)) { try { for (const r of Array.from(st.cssRules || [])) text += r.cssText } catch (e) { /* 跨域表跳过 */ } } } catch (e) { /* 忽略 */ }
  const has = (n) => text.indexOf(n) >= 0
  return {
    bytes: text.length,
    sessionStatsUsage: has('data-session-stats-usage'),
    sessionStatsDetails: has('data-session-stats-details'),
    teamPanel: has('data-team-panel'),
    rightbarParked: has('data-mpw-rightbar-parked'),
    hdrBlank: has('data-mpw-hdr-blank'),
  }
}

const STEP_NEW_POPOVERS = () => globalThis.__sp.overview() && (() => {
  const P = globalThis.__sp
  const roots = Array.from(document.querySelectorAll('body > *')).filter(P.vis).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 80 && r.height > 40 })
  return { overview: P.overview(), popovers: roots.slice(-6).map((e) => Object.assign(P.facts(e), { subtree: P.paintersIn(...P.rect(e).map(Number), 20) })) }
})()

/* ── 3 主流程 ─────────────────────────────────────────────────────────────── */
const OPENERS = {
  plusMenu: [
    { aria: '更多|添加|附加|加号|More|Attach' },
    { sel: 'button:has(svg)' },
    { text: '^\\+$' },
  ],
  modelPicker: [
    { text: 'DeepSeek|V4|模型' },
    { aria: '模型|model' },
  ],
  permissionPicker: [
    { text: '完全权限|权限|access|permission' },
  ],
  reasoning: [
    { text: 'Max|推理|reasoning|effort' },
  ],
  usageBar: [
    { text: 'tok/s|缓存命中|性能与用量' },
  ],
  subagentPanel: [
    { text: '个子智能体|子智能体|智能体团队' },
  ],
}
const PLAN = Object.assign({}, OPENERS, {
  plusMenu: [{ aria: '更多|添加|附加|More|Attach' }, { sel: '[aria-haspopup="menu"]' }, { text: '^\\+$' }],
})

let browser = null
try {
  try { execFileSync(process.execPath, [path.join(HERE, 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { cwd: PLUGIN, stdio: ['ignore', 'pipe', 'inherit'] }) } catch (e) { blocked('cookie-mint-failed', String((e && e.stderr) || (e && e.message) || e)) }
  if (!fs.existsSync(COOKIE)) blocked('cookie-missing', COOKIE)
  const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

  let pw = null
  try { pw = await import('playwright') } catch (e) { pw = null }
  const engine = pw && ((pw.default && pw.default[BROWSER]) || pw[BROWSER])
  if (!engine) { result.note = 'playwright/没有 ' + BROWSER; dump(); console.log('SKIP dsh020-surface-probe — 本机没有 playwright ' + BROWSER); process.exit(0) }
  result.browser = BROWSER

  browser = await engine.launch(Object.assign({ headless: !HEADED },
    BROWSER === 'firefox' ? { firefoxUserPrefs: withAudioMute() } : { args: ['--no-sandbox', '--disable-dev-shm-usage'] }))
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, locale: 'zh-CN' })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: AUTHORITY.split(':')[0], path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  if (!ALLOW_HOST_WRITES) {
    await page.route('**/api/mpkg-wallpaper/settings*', (route) => {
      if (route.request().method() === 'GET' || route.request().method() === 'HEAD') return route.continue()
      result.hostWritesBlocked++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, blockedByProbe: 'dsh020-surface-probe' }) })
    })
  }
  page.on('pageerror', (e) => result.pageErrors.push(String((e && e.message) || e).slice(0, 240)))
  page.on('console', (m) => { if (m.type() === 'error') result.console.push(String(m.text()).slice(0, 200)) })
  await page.addInitScript(INIT_HELPERS)

  const resp = await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (resp && (resp.status() === 401 || resp.status() === 403)) blocked('http-' + resp.status(), '首页要鉴权 Cookie')
  if (!resp || !resp.ok()) blocked('http-' + (resp ? resp.status() : 'none'), '首页不可用')

  /* 等页面 + 插件都起来（插件在 = 我们的样式/层都在，读数才是用户看到的那个状态） */
  try { await page.waitForFunction(() => !!(globalThis.__mpwSectionTest && globalThis.__mpwPersist), null, { timeout: 45000 }) } catch (e) { result.pluginMissing = true }
  await page.waitForTimeout(3000)
  result.page = { title: await page.title(), status: resp.status(), pluginLoaded: !result.pluginMissing }

  /* ①(2026-10-09) 必须落到**有内容的会话**：0.2.0 的用量条 / 权限选择器 / 子智能体入口只在有内容的会话里渲染
     （空会话里 `[data-composer-card]` 也在 ⇒ 只按 composer 判断会误判成"已就绪"） */
  result.cssRev = await page.evaluate(STEP_CSS_REV)
  console.log('· 运行中的 CSS 是否含最新规则：' + JSON.stringify(result.cssRev))
  result.convStates = []
  try { await page.waitForSelector('[data-row-key^="session:"]', { timeout: 25000 }) } catch (e) { result.rowsMissing = true }
  await page.waitForTimeout(800)
  let state = await page.evaluate(STEP_CONV_STATE)
  result.convStates.push({ step: 'initial', state })
  if (!(state.conv && state.conv.len > 200)) {
    for (const row of state.rows) {
      if (/新会话/.test(row.text)) continue
      try { await page.click('[data-row-key="' + row.key + '"]', { timeout: 5000 }) } catch (e) { result.convStates.push({ step: 'click-fail ' + row.key, err: String((e && e.message) || e).slice(0, 120) }); continue }
      for (let i = 0; i < 8; i++) { await page.waitForTimeout(700); state = await page.evaluate(STEP_CONV_STATE); if (state.conv && state.conv.len > 200) break }
      result.convStates.push({ step: 'clicked ' + row.key + ' (' + row.text + ')', state })
      if (state.conv && state.conv.len > 200) break
    }
  }
  result.openSession = { final: state }
  await page.waitForTimeout(1500)
  if (ONLY_INNER) {
    const shot = async (n) => { try { await page.screenshot({ path: path.join(OUTDIR, 'shot-020-' + n + '.png') }) } catch (e) { /* 忽略 */ } }
    const show = (label, v) => {
      if (!v || v.missing) { console.log('· ' + label + ' 未定位'); return }
      const sf = v.self || {}
      console.log('· ' + label + ' → bg=' + String(sf.bg).slice(0, 34) + ' bf=' + String(sf.bf).slice(0, 22)
        + ' | ::before bg=' + String((sf.pseudoBefore || {}).bg).slice(0, 30) + ' bf=' + String((sf.pseudoBefore || {}).bf).slice(0, 18))
    }
    result.inner = {}
    let pill = await page.evaluate(STEP_USAGE_PILL)
    for (let i = 0; i < 8 && !pill.found; i++) {
      const click = await page.evaluate(STEP_CLICK_SESSION, i)
      if (click.missing) break
      await page.waitForTimeout(1400)
      pill = await page.evaluate(STEP_USAGE_PILL)
      result.inner['pick' + i] = { click, found: pill.found }
    }
    result.inner.pill = pill
    console.log('· 用量 pill：' + (pill.found ? ('找到 ' + String(pill.text).slice(0, 40)) : '未找到（该会话没有用量数据）'))
    if (pill.found) {
      try {
        await page.evaluate(() => { const p = document.querySelector('[class*="bOPqQW_pill"]'); if (p) p.click() })
        try { await page.waitForSelector('[class*="bRhRbq_panel"], dl[data-session-stats-usage], dl[data-session-stats-details]', { timeout: 7000 }) } catch (e) { result.inner.statsWaitTimeout = true }
        await page.waitForTimeout(700)
        result.inner.statsUsage = await page.evaluate(STEP_CAPTURE_DEEP, 'dl[data-session-stats-usage]')
        result.inner.statsDetails = await page.evaluate(STEP_CAPTURE_DEEP, 'dl[data-session-stats-details]')
        result.inner.statsPanel = await page.evaluate(STEP_CAPTURE_DEEP, '[class*="bRhRbq_panel"]')
        await shot('statsdialog')
        show('statsUsage', result.inner.statsUsage); show('statsDetails', result.inner.statsDetails); show('statsPanel', result.inner.statsPanel)
        try { await page.keyboard.press('Escape') } catch (e) { /* 忽略 */ }
        await page.waitForTimeout(600)
      } catch (e) { result.inner.statsErr = String((e && e.message) || e).slice(0, 140) }
    }
    try {
      const teamRect = await page.evaluate(() => {
        const t = document.querySelector('[data-team-action], [class*="VoX2oq_trigger"], [class*="VoX2oq_root"]')
        if (!t) return null
        const r = t.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, path: globalThis.__sp.pathOf(t) }
      })
      result.inner.teamRect = teamRect
      if (teamRect) { try { await page.mouse.click(teamRect.x, teamRect.y) } catch (e) { result.inner.teamMouseErr = String((e && e.message) || e).slice(0, 80) } }
      try { await page.waitForSelector('[data-team-panel]', { timeout: 6000 }) } catch (e) { result.inner.teamWaitTimeout = true }
      await page.waitForTimeout(600)
      result.inner.teamPanel = await page.evaluate(STEP_CAPTURE_DEEP, '[data-team-panel]')
      result.inner.teamBody = await page.evaluate(STEP_CAPTURE_DEEP, '[class*="VoX2oq_body"]')
      await shot('teampanel')
      show('teamPanel', result.inner.teamPanel); show('teamBody', result.inner.teamBody)
      try { await page.keyboard.press('Escape') } catch (e) { /* 忽略 */ }
      await page.waitForTimeout(500)
    } catch (e) { result.inner.teamErr = String((e && e.message) || e).slice(0, 140) }
    try {
      const clicked = await page.evaluate(() => {
        const P = globalThis.__sp
        const e = P.byText('个子智能体|子智能体|智能体团队', document.querySelector('.wSkVaW_header, header') || document)
        if (!e) return null
        let n = e
        for (let i = 0; i < 3 && n && n.tagName !== 'BUTTON'; i++) n = n.parentElement
        try { (n || e).click() } catch (err) { return 'err' }
        return P.pathOf(n || e)
      })
      result.inner.treeClick = clicked
      try { await page.waitForSelector('[class*="ZKlsPq_menu"]', { timeout: 6000 }) } catch (e) { result.inner.treeWaitTimeout = true }
      await page.waitForTimeout(700)
      result.inner.treeMenu = await page.evaluate(STEP_CAPTURE_DEEP, '[class*="ZKlsPq_menu"]')
      result.inner.treeBody = await page.evaluate(STEP_CAPTURE_DEEP, '[class*="ZKlsPq_menuBody"]')
      result.inner.treeRow = await page.evaluate(STEP_CAPTURE_DEEP, '[class*="ZKlsPq_row"]')
      await shot('subagenttree')
      show('treeMenu', result.inner.treeMenu); show('treeBody', result.inner.treeBody); show('treeRow', result.inner.treeRow)
    } catch (e) { result.inner.treeErr = String((e && e.message) || e).slice(0, 140) }
    dump()
    console.log('✎ --only-inner 产物：tools/probe-out/surface-map-020.json + shot-020-statsdialog/teampanel/subagenttree.png')
    try { await browser.close() } catch (e) { /* 忽略 */ }
    process.exit(0)
  }
  result.left = await page.evaluate(STEP_LEFT)
  result.overview = await page.evaluate(STEP_OVERVIEW)

  /* ②(2026-10-09) A/B：插件开 ↔ 关（同一页面、同一会话）——分清"谁画的"。
     关闭只走本地 `__mpwSectionTest.write` + `__mpwPersist.apply()`，且宿主 settings 写回被 route 拦掉。 */
  const setEnabled = (v) => page.evaluate((val) => {
    try { globalThis.__mpwSectionTest.write({ enabled: val }); globalThis.__mpwPersist.apply(); return { ok: true, now: globalThis.__mpwPersist.read().enabled } } catch (e) { return { err: String((e && e.message) || e) } }
  }, v)
  result.rules = await page.evaluate(STEP_RULES, ['P3OORG_panel', 'uV2eYG_card', 'uV2eYG_add', 'iWlSmW_trigger', '_7KE1Ra_trigger', 'bRhRbq_panel', '_surface_ri079', '_pane_6nhg2', '_surface_6nhg2', 'pI_x6G', 'rightbar', 'dockkit', '_emptyTabHost'])
  console.log('· 规则命中：我们的 ' + result.rules.counts.ours + ' 条 / 宿主的 ' + result.rules.counts.host + ' 条')
  result.snapOn = await page.evaluate(STEP_SNAPSHOT)
  result.toggleOff = await setEnabled(false)
  await page.waitForTimeout(2000)
  result.snapOff = await page.evaluate(STEP_SNAPSHOT)
  result.toggleOn = await setEnabled(true)
  await page.waitForTimeout(2000)
  result.snapOn2 = await page.evaluate(STEP_SNAPSHOT)
  dump()
  console.log('· A/B：on(元素 ' + (result.snapOn && result.snapOn.mpwCount) + ' mpw / bgWrap=' + (result.snapOn && result.snapOn.bgWrap) + ') vs off(元素 ' + (result.snapOff && result.snapOff.mpwCount) + ' mpw / bgWrap=' + (result.snapOff && result.snapOff.bgWrap) + ')；右半屏画底 on=' + ((result.snapOn && result.snapOn.rightPainters) || []).length + ' off=' + ((result.snapOff && result.snapOff.rightPainters) || []).length)

  /* ③ 右栏折叠开关：把右边缘那排控件逐个点一遍，找"收纳/展开"这两个状态 */
  result.rightToggleTries = []
  const edgePlan = ((result.snapOn && result.snapOn.rightEdgeControls) || []).filter((c) => /侧|栏|right|expand|collapse|展开|收起|全屏/i.test(c.aria || '') || true).slice(0, 5)
  for (const c of edgePlan) {
    try {
      await page.keyboard.press('Escape').catch(() => {})
      const before = await page.evaluate(() => { const e = document.querySelector('[data-rightbar-col]'); return { rect: e ? [Math.round(e.getBoundingClientRect().x), Math.round(e.getBoundingClientRect().width)] : null, collapsedAttr: !!document.querySelector('[data-rightbar-collapsed]') } })
      const clicked = await page.evaluate((aria) => {
        const P = globalThis.__sp
        const all = Array.from(document.querySelectorAll('button,[role="button"]')).filter(P.vis)
        const t = all.find((e) => (e.getAttribute('aria-label') || '') === aria) || all.find((e) => { const r = e.getBoundingClientRect(); return r.left > innerWidth - 90 && (e.getAttribute('aria-label') || '') === aria })
        if (!t) return null
        try { t.click() } catch (e) { return { err: String(e && e.message || e) } }
        return P.facts(t)
      }, c.aria)
      await page.waitForTimeout(1300)
      const after = await page.evaluate(STEP_SNAPSHOT)
      result.rightToggleTries.push({ aria: c.aria, clicked, before, afterCol: after.rightCol, afterCollapsed: after.rightCollapsed, painters: (after.rightPainters || []).length, top: after.rightTop && after.rightTop.p90_50 && after.rightTop.p90_50.facts })
      console.log('· 右栏开关 try aria=' + JSON.stringify(c.aria) + ' → 右栏 x/宽=' + JSON.stringify(after.rightCol && after.rightCol.facts.rect) + ' 折叠标记=' + !!(after.rightCollapsed) + ' 右半屏画底=' + (after.rightPainters || []).length)
      dump()
    } catch (e) { result.rightToggleTries.push({ aria: c.aria, err: String((e && e.message) || e).slice(0, 160) }) }
  }
  result.byText = await page.evaluate(STEP_BY_TEXT_MAP, {
    leftNewSession: '新会话', leftSettings: '设置', leftPlugins: '插件',
    rightCollapsedHint: '展开|收起|全屏|Expand|Collapse',
    composerPlaceholder: '发消息或创建任务',
    permission: '完全权限|权限',
    model: 'DeepSeek|模型',
    reasoning: 'Max|推理',
    usageBar: 'tok/s|缓存命中|性能与用量',
    subagents: '个子智能体|子智能体|智能体团队',
  })
  result.right = await page.evaluate(STEP_RIGHT)
  result.parkCollapsed = await page.evaluate(STEP_PARK)
  result.paneCollapsed = await page.evaluate(STEP_PANE_TREE)
  result.expandRight = await page.evaluate(STEP_EXPAND_RIGHT)
  await page.waitForTimeout(1400)
  try { await page.waitForFunction(() => !document.querySelector('[data-rightbar-collapsed]'), null, { timeout: 8000 }) } catch (e) { result.expandTimeout = true }
  result.openTrigger = await page.evaluate(STEP_OPEN_TRIGGER)
  await page.waitForTimeout(1200)
  result.triggerMenu = await page.evaluate(STEP_BD_CHAIN, '[data-trigger-menu], [data-menu-material]')
  try { await page.screenshot({ path: path.join(OUTDIR, 'shot-020-triggermenu.png') }) } catch (e) { /* 忽略 */ }
  if (result.triggerMenu && !result.triggerMenu.missing) {
    const sf = result.triggerMenu.self || {}
    console.log('· 触发候选菜单：bg=' + String(sf.bg).slice(0, 30) + ' bf=' + sf.bf + ' | 第一个 root=' + (result.triggerMenu.firstRoot ? result.triggerMenu.firstRoot.path : '无'))
  } else console.log('· 触发候选菜单：未定位')
  try { await page.keyboard.press('Escape') } catch (e) { /* 忽略 */ }
  result.openSubagent = await page.evaluate(STEP_OPEN_SUBAGENT)
  await page.waitForTimeout(1600)
  result.rightAfterToggle = await page.evaluate(STEP_RIGHT)
  result.parkExpanded = await page.evaluate(STEP_PARK)
  result.paneExpanded = await page.evaluate(STEP_PANE_TREE)
  try { await page.screenshot({ path: path.join(OUTDIR, 'shot-020-expanded.png') }) } catch (e) { /* 忽略 */ }
  result.toggleOffReload = null
  /* 收纳态截图（回到收起） */
  await page.evaluate(() => { const b = document.querySelector('[data-sidebar-right-collapse="true"]') || Array.from(document.querySelectorAll('button')).find((e) => /收起右侧|关闭右侧/i.test(e.getAttribute('aria-label') || '')); if (b) b.click() })
  await page.waitForTimeout(1500)
  try { await page.screenshot({ path: path.join(OUTDIR, 'shot-020-collapsed.png') }) } catch (e) { /* 忽略 */ }
  result.parkCollapsed2 = await page.evaluate(STEP_PARK)
  result.paneCollapsed2 = await page.evaluate(STEP_PANE_TREE)
  result.crumb = await page.evaluate(STEP_CRUMB)
  result.headerInSession = await page.evaluate(STEP_HEADERBOX)
  /* 点「新会话」→ 空白标题栏态（bug G 的现场），截图取证 */
  try {
    await page.evaluate(() => { const P = globalThis.__sp; const e = P.byText('新会话'); if (e) { const b = e.closest('button') || e.parentElement; try { b.click() } catch (err) {} } })
    await page.waitForTimeout(2500)
    result.headerBlank = await page.evaluate(STEP_HEADERBOX)
    try { await page.screenshot({ path: path.join(OUTDIR, 'shot-020-newsession.png') }) } catch (e) { /* 忽略 */ }
    console.log('· 新会话标题栏：blankAttr=' + (result.headerBlank && result.headerBlank.blankAttr) + ' frostEl=' + (result.headerBlank && result.headerBlank.frostEl) + ' bg=' + (result.headerBlank && result.headerBlank.bg) + ' bf=' + (result.headerBlank && result.headerBlank.bf))
  } catch (e) { result.newSessionErr = String((e && e.message) || e).slice(0, 160) }
  /* ①(2026-10-10 第四批真机) 确定性抓取：智能体团队 / 会话统计 / Token 用量 / 模型选择器内层 */
  try {
    result.innerCapture = await page.evaluate(STEP_OPEN_AND_CAPTURE, [
      { click: { aria: '智能体团队' }, wait: '[data-team-panel]', capture: '[data-team-panel]', escape: true },
      { click: { text: 'tok/s|缓存命中|性能与用量' }, wait: '[data-session-stats-usage], [data-session-stats-details], [class*="bRhRbq_panel"]', capture: 'dl[data-session-stats-usage]', escape: true },
      { click: { text: 'tok/s|缓存命中|性能与用量' }, wait: '[data-session-stats-details], [class*="bRhRbq_panel"]', capture: 'dl[data-session-stats-details]', escape: true },
      { click: { text: 'DeepSeek|V4|模型' }, wait: '[data-menu-material]', capture: '[data-menu-material]', escape: true },
    ])
    for (const st of (result.innerCapture.steps || [])) {
      if (st.capture && st.data) {
        const sf = st.data.self || {}
        console.log('· capture ' + st.capture + ' → bg=' + String(sf.bg).slice(0, 30) + ' bf=' + sf.bf)
        for (const r of (st.data.rows || []).slice(1, 6)) console.log('     d' + r.depth + ' ' + r.tag + '.' + String(r.cls).slice(0, 28) + ' bg=' + String(r.bg).slice(0, 28) + ' bf=' + String(r.bf).slice(0, 18))
      } else console.log('· capture ' + (st.capture || JSON.stringify(st)) + ' 未成功')
    }
  } catch (e) { result.innerCaptureErr = String((e && e.message) || e).slice(0, 160) }
  /* ①(2026-10-09 第三批真机) 模糊死因：逐表面看"第一个 backdrop root 是谁" */
  result.bdChains = {}
  result.bdChains.triggerMenu = await page.evaluate(STEP_BD_CHAIN, '[data-trigger-menu], [class*="_3e4SsG_menu"]')
  result.bdChains.materialMenu = await page.evaluate(STEP_BD_CHAIN, '[data-menu-material]')
  result.bdChains.tokenPanel = await page.evaluate(STEP_BD_CHAIN, '[class*="bRhRbq_panel"], [data-session-stats-usage], [data-session-stats-details]')
  result.bdChains.teamPanel = await page.evaluate(STEP_BD_CHAIN, '[data-team-panel], [class*="VoX2oq_panel"]')
  result.bdChains.subagentPane = await page.evaluate(STEP_BD_CHAIN, '[data-dockkit-pane]')
  result.bdChains.rightPanel = await page.evaluate(STEP_BD_CHAIN, '[data-sidebar-right-panel], [class*="P3OORG_panel"]')
  result.bdChains.rightSurface = await page.evaluate(STEP_BD_CHAIN, '[data-dockkit-surface]')
  for (const [k, v] of Object.entries(result.bdChains)) {
    if (!v || v.missing) { console.log('· bd:' + k + ' 未定位'); continue }
    console.log('· bd:' + k + ' 自身 bf=' + (v.self && v.self.bf) + ' bg=' + (v.self && String(v.self.bg).slice(0, 26)) + ' | 第一个 root = ' + (v.firstRoot ? (v.firstRoot.path + ' [bf=' + v.firstRoot.bf + ' iso=' + v.firstRoot.iso + ' filter=' + v.firstRoot.filter + ' op=' + v.firstRoot.op + ' ours=' + v.firstRoot.ours + ']') : '无'))
  }
  console.log('· 面包屑：' + JSON.stringify(result.crumb && { text: result.crumb.text, hitIsCrumb: result.crumb.hitIsCrumb, underFrost: result.crumb.underFrost }))
  result.composer = await page.evaluate(STEP_COMPOSER)
  result.usageBar = await page.evaluate(STEP_USAGE_BAR)
  result.header = await page.evaluate(STEP_HEADER)
  dump()
  console.log('· 概览：' + JSON.stringify({ vw: result.overview && result.overview.vw, vh: result.overview && result.overview.vh, mpwAttrs: Object.keys((result.overview && result.overview.mpwAttrs) || {}).length, bgWrap: !!(result.overview && result.overview.bgWrap), styleTags: result.overview && result.overview.mpwStyleTags, pluginLoaded: result.page.pluginLoaded }))
  console.log('· 右半屏画底/模糊的元素 ' + (result.right && result.right.paintersRight ? result.right.paintersRight.length : 0) + ' 个；dockkit 元素 ' + (result.right && result.right.dockkit ? result.right.dockkit.length : 0) + ' 个')
  console.log('· composer ' + (result.composer ? ('按钮 ' + result.composer.buttons.length + ' 个') : '未定位') + '；用量条 ' + (result.usageBar ? '已定位' : '未定位') + '；子智能体入口 ' + (result.header && result.header.subagents ? '已定位' : '未定位'))

  /* 逐个点开弹层并 dump（点不开就跳过，不算失败） */
  result.opened = {}
  for (const [name, plan] of Object.entries(PLAN)) {
    try {
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(300)
      const clicked = await page.evaluate(STEP_CLICK_OPENER, plan)
      await page.waitForTimeout(900)
      const after = await page.evaluate(STEP_NEW_POPOVERS)
      /* 弹层**还开着**的时候立刻量它的 backdrop 链（关掉后再量就定位不到了） */
      try {
        after.bd = {
          materialMenu: await page.evaluate(STEP_BD_CHAIN, '[data-menu-material]'),
          triggerMenu: await page.evaluate(STEP_BD_CHAIN, '[data-trigger-menu]'),
          tokenPanel: await page.evaluate(STEP_BD_CHAIN, '[class*="bRhRbq_panel"]'),
        }
      } catch (e) { after.bdErr = String((e && e.message) || e).slice(0, 120) }
      try {
        after.inner = {
          statsUsage: await page.evaluate(STEP_INNER, 'dl[data-session-stats-usage], [data-session-stats-usage]'),
          statsDetails: await page.evaluate(STEP_INNER, 'dl[data-session-stats-details], [data-session-stats-details]'),
          teamPanel: await page.evaluate(STEP_INNER, '[data-team-panel]'),
          teamBody: await page.evaluate(STEP_INNER, '[class*="VoX2oq_body"]'),
          popoverSurface: await page.evaluate(STEP_INNER, '[data-menu-material], [data-trigger-menu], [role="menu"], [class*="_menu_"]'),
        }
      } catch (e) { after.innerErr = String((e && e.message) || e).slice(0, 120) }
      result.opened[name] = { clicked, after }
      console.log('· ' + name + '：' + (clicked ? ('点了 ' + clicked.via) : '没找到可点的入口') + (after && after.popovers ? ('；浮层 ' + after.popovers.length + ' 个') : ''))
    } catch (e) { result.opened[name] = { err: String((e && e.message) || e).slice(0, 200) } }
  }
  dump()
  console.log('\n✎ 产物：' + path.relative(PLUGIN, OUT) + (result.hostWritesBlocked ? '（拦下宿主设置写回 ' + result.hostWritesBlocked + ' 次）' : ''))
  const failed = result.pageErrors.length > 0
  process.exit(failed ? 3 : 0)
} catch (e) {
  blocked('probe-error', (e && e.stack) || (e && e.message) || e)
} finally {
  try { if (browser) await browser.close() } catch { /* 忽略 */ }
}

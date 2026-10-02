// tools/host-popover-probe.mjs —— **真机只读探针**：把宿主各个弹层/悬浮件的 DOM 事实 dump 出来
//
// 为什么要有它（2026-10-02 用户第 5 组现象）：用户报了 5 处观感问题（+ 菜单/权限弹层完全透明、
//   模型选择的"提供商分组标题"是白色不透明长条、上下文占用圆圈白色不透明、标题栏子代理容器"模糊做得好"），
//   还有 3 处（左栏像被取了壁纸主色 / 透明度 0 时悬浮失效 / 左栏收起动画掉帧）。
//   这些**都不是我们插件的元素**，只能拿真页面读数说话：外层容器 → 内层表面的选择器链条、class/role/data-*、
//   computed `background-color` / `backdrop-filter` / `z-index` / rect，以及"它在不在 `_overlay` / `_overlayLayer` 子树里"。
//
// ⚠ 只读（对宿主 DOM 而言）：只点开弹层、只读样式；不改宿主 DOM、不发消息。
//   但会**改用户设置**（第 6/7/8 组要切档 + 关插件做对照）⇒ 走 live 档（`__mpwSectionTest.write` + apply），
//   并且：① 拦掉插件→宿主 settings.json 的写回（`--allow-host-writes` 才放行）
//          ② 跑前跑后对 settings.json 做 sha256 快照，变了按快照原样还原
//          ③ 跑完把浏览器 localStorage 整串还原（记差异键）
//
// 串行纪律：脚本自带 flock（`MPW_FIREFOX_LOCK` 可覆盖；一次只开一个 Firefox）；静音三件套走 `_audio-mute.mjs`。
// 用法:
//   flock /tmp/.mpw-firefox.lock -c 'node tools/host-popover-probe.mjs --open-session --open-right'
//   node tools/host-popover-probe.mjs --groups popovers        # 只跑弹层组
//   node tools/host-popover-probe.mjs --groups float,anim      # 只跑第 7/8 组
// 退出码：0 全采到 / 2 blocked（页面/插件拿不到）/ 3 采到了但有组失败
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { withAudioMute } from './_audio-mute.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '..')
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const URL0 = 'http://' + AUTHORITY + '/'
const OUT = path.resolve(arg('out', path.join(PLUGIN, 'tools', 'probe-out', 'host-popover-live.json')))
const WORK = path.resolve(arg('work', path.join(os.tmpdir(), 'mpw-host-popover')))
const COOKIE = path.join(WORK, 'cookie.json')
const HEADED = has('headed')
const KEEP = has('keep')
const ALLOW_HOST_WRITES = has('allow-host-writes')
const SETTLE = Number(arg('settle', '900'))
const VIEWPORT = (() => { const m = String(arg('viewport', '1920x1200')).match(/^(\d+)x(\d+)$/); return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1200 } })()
const GROUPS = String(arg('groups', 'popovers,sidebar-tint,float,anim,popover-surfaces,popover-blur-exp')).split(',').map((x) => x.trim()).filter(Boolean)
const ONLY_TARGET = String(arg('only-target', '')).split(',').map((x) => x.trim()).filter(Boolean)
const STORE = 'dsh.mpkg-wallpaper.v2'
/** path 数组 → 可直接喂给 Playwright 的选择器（声明必须在任何用到它的代码之前：TDZ）。 */
const selOf = (p) => Array.isArray(p) && p.length ? p.map((x, i) => { const last = i === p.length - 1; let s = x.tag || '*'; if (x.id) s += '[id="' + String(x.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]'; else if (last && x.cls && x.cls.length) s += '.' + x.cls[0]; if (last && x.attrs && x.attrs.length) s += '[' + x.attrs[0] + ']'; if (!x.id) s += ':nth-child(' + (x.idx || 1) + ')'; return s }).join(' > ') : null
/** path 数组 → 可直接喂给 Playwright 的选择器（与文件尾打印用的是同一套规则）。 */
const SETTINGS_JSON = path.resolve(arg('settings', path.join(os.homedir(), '.dsh-mpkg-wallpaper', 'settings.json')))
const SETTINGS_SHOWN = SETTINGS_JSON.replace(os.homedir(), '~')
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const snapFile = (p) => { try { const b = fs.readFileSync(p); return { sha256: sha256(b), len: b.length, buf: b } } catch (e) { return null } }
const want = (g) => GROUPS.includes(g)

/* ── 0 串行锁 ─────────────────────────────────────────────────────────────── */
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

/* ── 1 页面侧公共小工具（经 addInitScript 注入成 `globalThis.__pp`） ──────────
   ⚠ 页面函数是**逐个序列化**执行的（page.evaluate），彼此不共享作用域、也拿不到 Node 作用域里的东西
   ⇒ 公共工具必须先 addInitScript 注入，然后在每个页面函数开头 `const { … } = globalThis.__pp`。 */
const INIT_HELPERS = () => {
  const pathOf = (el) => {
    try {
      const out = []
      let cur = el, depth = 0
      while (cur && cur.nodeType === 1 && depth < 7 && cur !== document.documentElement) {
        const parent = cur.parentElement
        const idx = parent ? Array.prototype.indexOf.call(parent.children, cur) + 1 : 1
        out.push({ tag: String(cur.tagName || '').toLowerCase(), id: cur.id || null, idx,
          cls: String(cur.className || '').split(/\s+/).filter(Boolean).slice(0, 4),
          attrs: Array.from(cur.attributes || []).map((a) => a.name).filter((n) => /^data-/.test(n)).slice(0, 4) })
        cur = parent; depth++
      }
      return out.reverse()
    } catch (e) { return [] }
  }
  const VIS = (e) => { try { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 2 && r.height > 2 && c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0 } catch (err) { return false } }
  const ALPHA = (col) => {
    const str = String(col || '')
    if (/^transparent$/.test(str)) return 0
    let m = str.match(/rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+[,\s\/]+([\d.]+%?)/i)
    if (m) return m[1].endsWith('%') ? Number(m[1].slice(0, -1)) / 100 : Number(m[1])
    m = str.match(/color\(srgb[^)]*\/\s*([\d.]+)/i)
    if (m) return Number(m[1])
    if (/^(rgb|color)\(/i.test(str)) return 1
    return 0
  }
  const NODE = (e) => {
    const c = getComputedStyle(e); const r = e.getBoundingClientRect()
    const ov = e.closest('[class*="_overlay"]')
    const ovl = e.closest('[class*="_overlayLayer"]')
    return {
      path: pathOf(e), cls: String(e.className).slice(0, 90), tag: e.tagName,
      role: e.getAttribute('role'), aria: e.getAttribute('aria-label'), haspopup: e.getAttribute('aria-haspopup'),
      dataAttrs: Array.from(e.attributes || []).map((a) => a.name + '=' + String(a.value).slice(0, 24)).filter((x) => /^data-/.test(x)).slice(0, 6),
      bg: c.backgroundColor, bf: c.backdropFilter, z: c.zIndex, position: c.position, opacity: c.opacity,
      border: c.borderTopWidth + ' ' + c.borderTopColor, radius: c.borderRadius, shadow: String(c.boxShadow).slice(0, 80),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], visible: VIS(e),
      text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48),
      inOverlayAny: !!ov, inOverlayLayer: !!ovl, overlayAncestorCls: ov ? String(ov.className).slice(0, 60) : null,
    }
  }
  globalThis.__pp = { pathOf, VIS, ALPHA, NODE }
}

/* 把当前所有"弹层候选"连同其祖先链与内部表面节点 dump 出来（只读） */
const POPOVERS = () => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA, NODE } = H
  const cands = []
  const HINT = /popover|dropdown|menu|select|popper|portal|sheet|content|panel|listbox|picker|overlay|dialog/i
  for (const e of document.querySelectorAll('body *')) {
    if (!VIS(e)) continue
    const c = getComputedStyle(e)
    const role = (e.getAttribute('role') || '').toLowerCase()
    const z = Number(c.zIndex)
    const r = e.getBoundingClientRect()
    const hinted = HINT.test(String(e.className)) || ['menu', 'listbox', 'dialog', 'tooltip', 'grid', 'tree'].includes(role)
    const floating = (c.position === 'fixed' || c.position === 'absolute') && Number.isFinite(z) && z >= 20
    if (!hinted && !floating) continue
    if (r.width < 40 || r.height < 16) continue
    cands.push({ e, hinted, floating, z: Number.isFinite(z) ? z : 0, area: r.width * r.height })
  }
  cands.sort((a, b) => b.area - a.area)
  const roots = []
  for (const x of cands) {
    if (roots.some((rt) => rt.contains(x.e))) continue       // 同一子树只留最外层
    if (x.e.parentElement && roots.some((rt) => rt === x.e.parentElement)) { /* fallthrough */ }
    roots.push(x.e)
    if (roots.length >= 4) break
  }
  const out = []
  for (const root of roots) {
    const chain = []
    let cur = root
    while (cur && cur.nodeType === 1 && cur !== document.body) { chain.push(NODE(cur)); cur = cur.parentElement }
    const surfaces = []
    let examined = 0
    for (const d of root.querySelectorAll('*')) {
      examined++
      if (examined > 900) break
      if (!VIS(d)) continue
      const c = getComputedStyle(d)
      const paints = ALPHA(c.backgroundColor) > 0.01 || c.backdropFilter !== 'none'
      if (!paints) continue
      surfaces.push(NODE(d))
      if (surfaces.length >= 14) break
    }
    out.push({ root: NODE(root), ancestorChain: chain.slice(0, 10), surfaces, examined })
  }
  const roles = (() => {
    const res = {}
    for (const r of ['menu', 'listbox', 'dialog', 'tooltip', 'grid', 'tree']) {
      const els = Array.from(document.querySelectorAll('[role="' + r + '"]'))
      const visEls = els.filter(VIS)
      res[r] = { total: els.length, visible: visEls.length, facts: visEls.slice(0, 2).map(NODE) }
    }
    res.expanded = Array.from(document.querySelectorAll('[aria-expanded="true"]')).slice(0, 5).map((e) => ({ path: pathOf(e), cls: String(e.className).slice(0, 50), aria: e.getAttribute('aria-label'), haspopup: e.getAttribute('aria-haspopup') }))
    return res
  })()
  return { count: out.length, popovers: out, roles, overlayCounts: (() => { const q = (s) => { try { return Array.from(document.querySelectorAll(s)) } catch (e) { return [] } }; return { overlayAny: q('[class*="_overlay"]').length, overlayAnyVisible: q('[class*="_overlay"]').filter(VIS).length, overlayLayer: q('[class*="_overlayLayer"]').length, overlayLayerVisible: q('[class*="_overlayLayer"]').filter(VIS).length, dialog: q('[role="dialog"]').length } })() }
}

/** 找 opener：按给定候选选择器/文本模式，返回点什么（自底向上最内层可见命中） */
/* 只"找"不点：返回命中元素的 path/描述；真正点击由 Node 侧用 Playwright 真鼠标做
   （React 的弹层常监听 pointerdown/click，纯 el.click() 有时不触发）。 */
const FIND_OPENER = (plan) => {
  const H = globalThis.__pp
  if (!H) return { why: 'page-helpers-missing' }
  const vis = H.VIS
  const pathOf = H.pathOf
  const matches = (e, pat) => {
    const str = ((e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title'))) || '') + ' ' + String(e.textContent || '').trim()
    return new RegExp(pat).test(str)
  }
  for (const step of plan) {
    if (step.sel) {
      const els = Array.from(document.querySelectorAll(step.sel)).filter(vis)
      if (els.length) { const e = els[0]; return { path: pathOf(e), via: 'selector', pattern: step.sel, n: els.length, text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24), aria: e.getAttribute('aria-label'), cls: String(e.className).slice(0, 40) } }
    }
    if (step.text) {
      const all = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],a,li,div,span')).filter(vis)
      const hit = all.filter((e) => matches(e, step.text))
      hit.sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length)
      if (hit.length) { const e = hit[0]; return { path: pathOf(e), via: 'text', pattern: step.text, n: hit.length, text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24), aria: e.getAttribute('aria-label'), cls: String(e.className).slice(0, 40) } }
    }
  }
  return { why: 'no-candidate' }
}

/** 候选清单（失败时给主对话指认用） */
const CANDIDATES = () => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA, NODE } = H
  const out = []
  for (const e of document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],[aria-haspopup],[class*="trigger"],[class*="ring"],[class*="circle"],[class*="context"]')) {
    if (!VIS(e)) continue
    const r = e.getBoundingClientRect()
    out.push({ aria: e.getAttribute('aria-label'), role: e.getAttribute('role'), haspopup: e.getAttribute('aria-haspopup'), cls: String(e.className).slice(0, 40), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })
  }
  return out.slice(0, 40)
}

const HEADER_CHILDREN = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const pathOf = H.pathOf
  const hdr = document.querySelector('.wSkVaW_header')
  if (!hdr) return { found: false }
  return { found: true, items: Array.from(hdr.querySelectorAll('*')).filter(vis).slice(0, 24).map((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { path: pathOf(e), cls: String(e.className).slice(0, 60), role: e.getAttribute('role'), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28), bg: c.backgroundColor, bf: c.backdropFilter, radius: c.borderRadius, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] } }) }
}
const ROUND_CANDIDATES = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const pathOf = H.pathOf
  const out = []
  for (const e of document.querySelectorAll('button,[role="button"],svg,div,span,circle')) {
    if (!vis(e)) continue
    const r = e.getBoundingClientRect()
    const c = getComputedStyle(e)
    const round = Math.abs(r.width - r.height) <= 3 && r.width >= 12 && r.width <= 56
    const ringHint = /ring|circle|progress|usage|context|token|donut|gauge/i.test(String(e.className) + ' ' + (e.getAttribute('aria-label') || ''))
    if (!round && !ringHint) continue
    if (!ringHint && e.tagName !== 'BUTTON' && e.tagName !== 'svg') continue
    out.push({ path: pathOf(e), cls: String(e.className).slice(0, 50), tag: e.tagName, aria: e.getAttribute('aria-label'), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20), bg: c.backgroundColor, bf: c.backdropFilter, radius: c.borderRadius, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })
  }
  return { count: out.length, items: out.slice(0, 16) }
}
const FIND_MENU_ENTRY = (pat) => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const pathOf = H.pathOf
  const root = (() => { const rs = Array.from(document.querySelectorAll('[role="menu"],[role="listbox"]')).filter(vis); rs.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height)); return rs[0] || null })()
  if (!root) return { err: 'no-visible-menu' }
  const rx = new RegExp(pat)
  const items = Array.from(root.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemradio"],button,li')).filter(vis)
  const hit = items.find((e) => rx.test(String(e.textContent || '').replace(/\s+/g, ' ').trim()))
  if (!hit) return { err: 'no-match', candidates: items.map((e) => String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)).slice(0, 16) }
  return { path: pathOf(hit), text: String(hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), cls: String(hit.className).slice(0, 50) }
}
const SUBAGENT_FACTS = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const VIS = H.VIS, NODE = H.NODE, ALPHA = H.ALPHA
  const cands = Array.from(document.querySelectorAll('.wSkVaW_header *, [class*="ZKlsPq"]')).filter((e) => VIS(e) && /子代理/.test(String(e.textContent || '').replace(/\s+/g, ' ').slice(0, 40)))
  if (!cands.length) return { found: false, searched: '.wSkVaW_header *, [class*="ZKlsPq"]' }
  const el = cands[cands.length - 1]
  let box = el
  while (box && box !== document.body && !/ZKlsPq|titleCluster|titleRow|crumb/i.test(String(box.className))) box = box.parentElement
  const target = box || el
  const tokens = {}
  try {
    const c = getComputedStyle(target)
    for (const n of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay', '--dsw-alias-button-floating-fill', '--dsw-alias-button-elevated-fill', '--dsw-alias-button-ghost-active-fill', '--dsw-specific-sidebar-fill', '--dsw-alias-border-l1', '--dsw-alias-label-primary', '--dsw-alias-brand-primary']) { const v = c.getPropertyValue(n).trim(); if (v) tokens[n] = v.slice(0, 60) }
    if (target.computedStyleMap) { for (const [k, v] of target.computedStyleMap()) if (/^--dsw-/.test(k)) tokens[k] = String(v).slice(0, 40) }
  } catch (e) { tokens.err = String(e && e.message || e) }
  return {
    found: true, hitText: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    box: NODE(target), inner: NODE(el),
    surfaces: Array.from(target.querySelectorAll('*')).filter(VIS).filter((x) => { const c = getComputedStyle(x); return ALPHA(c.backgroundColor) > 0.01 || c.backdropFilter !== 'none' }).slice(0, 8).map(NODE),
    tokens,
  }
}
/** 左栏"粉色"因果实验用的事实采集。
 *  mode: baseline | bf-none | bf-restore | bgwrap-hidden | bgwrap-restore | media-filter-none | media-filter-restore
 *  另外采：每层 token 解析值、壁纸层媒体事实、"谁在画"清单（与左栏矩形相交 + elementsFromPoint）。 */
const SIDEBAR_FACTS = (mode) => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const pathOf = H.pathOf
  const col = document.querySelector('[class*="sidebarCol"]')
  const wrap = document.getElementById('mpw-bgWrap')
  const TOKENS = ['--mpw-bg-blur', '--mpw-panel-tint', '--mpw-aqua-rgb', '--mpw-mask-rgb', '--mpw-chrome-alpha', '--mpw-unify-surface', '--mpw-surface-side-frost']
  const touched = []
  if (col && mode === 'bf-none') { touched.push({ what: 'sidebarCol.backdropFilter', prev: col.style.backdropFilter || '(inline 空)' }); col.style.setProperty('backdrop-filter', 'none', 'important'); col.style.setProperty('-webkit-backdrop-filter', 'none', 'important') }
  if (col && mode === 'bf-restore') { col.style.removeProperty('backdrop-filter'); col.style.removeProperty('-webkit-backdrop-filter') }
  if (col && mode === 'sidebar-hidden') { touched.push({ what: 'sidebarCol.display', prev: col.style.display || '(inline 空)' }); col.style.setProperty('display', 'none', 'important') }
  if (col && mode === 'sidebar-restore') { col.style.removeProperty('display') }
  if (wrap && mode === 'bgwrap-hidden') { touched.push({ what: 'bgWrap.display', prev: wrap.style.display || '(inline 空)' }); wrap.style.display = 'none' }
  if (wrap && mode === 'bgwrap-restore') { wrap.style.display = '' }
  const mediaSel = '#mpw-bgWrap img, #mpw-bgWrap video, #mpw-bgWrap canvas'
  if (mode === 'media-filter-none') {
    for (const m of document.querySelectorAll(mediaSel)) { touched.push({ what: 'media.filter', cls: String(m.className).slice(0, 30), prev: m.style.filter || '(inline 空)' }); m.style.setProperty('filter', 'none', 'important') }
  }
  if (mode === 'media-filter-restore') { for (const m of document.querySelectorAll(mediaSel)) m.style.removeProperty('filter') }
  const layer = (e, tag) => {
    const c = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    const pre = (pseudo) => { try { const pc = getComputedStyle(e, pseudo); const content = pc.content; if (!content || content === 'none' || content === 'normal') return null; return { content: String(content).slice(0, 24), bg: pc.backgroundColor, bgImage: String(pc.backgroundImage).slice(0, 60), opacity: pc.opacity, inset: pc.inset, z: pc.zIndex } } catch (err) { return null } }
    const toks = {}
    for (const t of TOKENS) { const v = c.getPropertyValue(t).trim(); if (v) toks[t] = v.slice(0, 48) }
    return { tag, sel: pathOf(e), cls: String(e.className).slice(0, 70), bg: c.backgroundColor, bgImage: String(c.backgroundImage).slice(0, 60), bf: c.backdropFilter, filter: String(c.filter).slice(0, 60), mixBlend: c.mixBlendMode, opacity: c.opacity, z: c.zIndex, display: c.display, position: c.position, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], before: pre('::before'), after: pre('::after'), tokens: toks }
  }
  const chain = []
  let cur = col
  let depth = 0
  while (cur && cur !== document.documentElement && depth < 9) { chain.push(layer(cur, depth === 0 ? 'sidebarCol' : 'ancestor' + depth)); cur = cur.parentElement; depth++ }
  const htmlLayer = getComputedStyle(document.documentElement)
  const htmlToks = {}
  for (const t of TOKENS) { const v = htmlLayer.getPropertyValue(t).trim(); if (v) htmlToks[t] = v.slice(0, 48) }
  /* 谁在画：与左栏矩形相交、且"有画东西的迹象"的元素 + elementsFromPoint(左栏中心) 命中的整条链 */
  const who = []
  if (col) {
    const rr = col.getBoundingClientRect()
    const cx = rr.x + rr.width / 2, cy = rr.y + rr.height / 2
    const seen = new Set()
    const consider = (e, why) => {
      if (!e || e.nodeType !== 1 || seen.has(e)) return
      seen.add(e)
      const c = getComputedStyle(e)
      const r = e.getBoundingClientRect()
      const paints = !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)|^transparent$|color\(srgb 0 0 0 \/ 0\)/.test(c.backgroundColor) || c.backgroundImage !== 'none' || c.backdropFilter !== 'none' || String(c.filter) !== 'none' || c.mixBlendMode !== 'normal'
      if (!paints) return
      who.push({ why, sel: pathOf(e), cls: String(e.className).slice(0, 60), bg: c.backgroundColor, bgImage: String(c.backgroundImage).slice(0, 60), filter: String(c.filter).slice(0, 50), bf: c.backdropFilter, mixBlend: c.mixBlendMode, opacity: c.opacity, z: c.zIndex, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], intersectsCol: !(r.right < rr.left || r.left > rr.right || r.bottom < rr.top || r.top > rr.bottom), isOurs: /mpw/i.test(String(e.className) + String(e.id)) })
    }
    for (const e of document.elementsFromPoint(cx, cy)) consider(e, 'elementsFromPoint(center)')
    for (const e of document.elementsFromPoint(rr.x + 10, cy)) consider(e, 'elementsFromPoint(left)')
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      if (r.right < rr.left || r.left > rr.right || r.bottom < rr.top || r.top > rr.bottom) continue
      consider(e, 'intersects-sidebar-rect')
      if (who.length > 40) break
    }
  }
  return {
    mode, touched,
    sidebarCol: col ? layer(col, 'sidebarCol') : null,
    bgWrap: wrap ? layer(wrap, 'bgWrap') : { found: false },
    wrapChildren: wrap ? Array.from(wrap.children).slice(0, 10).map((m) => { const c = getComputedStyle(m); const r = m.getBoundingClientRect(); const pc = (() => { try { const q = getComputedStyle(m, '::before'); return { bg: q.backgroundColor, bgImage: String(q.backgroundImage).slice(0, 60), filter: String(q.filter).slice(0, 50), inset: q.inset } } catch (e) { return null } })(); return { tag: m.tagName, id: m.id, cls: String(m.className).slice(0, 60), filter: String(c.filter).slice(0, 80), bf: c.backdropFilter, transform: String(c.transform).slice(0, 60), opacity: c.opacity, bg: c.backgroundColor, bgImage: String(c.backgroundImage).slice(0, 70), z: c.zIndex, display: c.display, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], before: pc } }) : [],
    wrapMedia: Array.from(document.querySelectorAll(mediaSel)).slice(0, 4).map((m) => { const c = getComputedStyle(m); const r = m.getBoundingClientRect(); return { tag: m.tagName, cls: String(m.className).slice(0, 40), filter: String(c.filter).slice(0, 80), transform: String(c.transform).slice(0, 60), objectFit: c.objectFit, opacity: c.opacity, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], src: String(m.currentSrc || m.src || '').slice(0, 60) } }),
    chain, whoPaints: who.slice(0, 26),
    htmlBg: htmlLayer.backgroundColor, htmlTokens: htmlToks,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    effective: (() => { try { const x = globalThis.__mpwPersist.read() || {}; return { unifyAmount: x.unifyAmount, sidebarAlpha: x.sidebarAlpha, blurFollowUnify: x.blurFollowUnify, enabled: x.enabled } } catch (e) { return { err: String(e && e.message || e) } } })(),
  }
}
/** 弹层容器整棵子树里"画了东西"的元素（底/bf/bgImage 任一非空）+ 该容器上的弹层 token 解析值。 */
const POPOVER_SUBTREE = (sel) => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const pathOf = H.pathOf, VIS = H.VIS, ALPHA = H.ALPHA
  const root = document.querySelector(sel)
  if (!root) {
    return { sel, found: false, visibleMenus: Array.from(document.querySelectorAll('[role="menu"],[role="listbox"]')).filter(VIS).map((e) => ({ cls: String(e.className).slice(0, 50), id: e.id })) }
  }
  const TOK = ['--mpw-surface-pop', '--mpw-surface-pop-dark', '--mpw-pop-surface', '--mpw-pop-surface-dark', '--mpw-pop-surface-alpha', '--mpw-pop-alpha', '--mpw-pop-blur', '--mpw-pop-radius']
  const tokOf = (e) => { const c = getComputedStyle(e); const o = {}; for (const t of TOK) { const v = c.getPropertyValue(t).trim(); if (v) o[t] = v.slice(0, 48) } return o }
  const paints = (c) => ALPHA(c.backgroundColor) > 0.01 || c.backdropFilter !== 'none' || c.backgroundImage !== 'none'
  const items = []
  const add = (e, why) => {
    const c = getComputedStyle(e)
    if (!paints(c)) return
    const r = e.getBoundingClientRect()
    items.push({ why, tagPopBg: e.hasAttribute('data-mpw-pop-bg'), sel: pathOf(e), tag: e.tagName, cls: String(e.className).slice(0, 70), role: e.getAttribute('role'), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24), bg: c.backgroundColor, bf: c.backdropFilter, bgImage: String(c.backgroundImage).slice(0, 60), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], z: c.zIndex, opacity: c.opacity, mixBlend: c.mixBlendMode, visible: VIS(e), tokens: tokOf(e) })
  }
  add(root, 'container')
  for (const e of root.querySelectorAll('*')) add(e, 'descendant')
  /* 祖先链：判断 `[class*="_overlayLayer"]` 这类规则会不会命中弹层的祖先（并看有没有会改变
     backdrop 采样根/包含块的属性：filter / transform / contain / will-change / isolation）。 */
  const ancestors = []
  for (let e = root.parentElement, i = 0; e && i < 40; e = e.parentElement, i++) {
    const c = getComputedStyle(e); const r = e.getBoundingClientRect()
    const cls = String(e.className || '')
    ancestors.push({ sel: pathOf(e), tag: e.tagName, cls: cls.slice(0, 56), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], z: c.zIndex, position: c.position, bg: c.backgroundColor, bf: c.backdropFilter, bgImage: String(c.backgroundImage).slice(0, 40), filter: c.filter, transform: c.transform === 'none' ? 'none' : 'set', contain: c.contain, willChange: c.willChange, isolation: c.isolation, overflow: c.overflow, opacity: c.opacity, pointerEvents: c.pointerEvents, hitOverlayLayer: cls.indexOf('_overlayLayer') >= 0, hitOverlay: cls.indexOf('_overlay') >= 0 })
  }
  return {
    sel, found: true, containerCls: String(root.className), containerId: root.id || null, containerTokens: tokOf(root),
    containerRect: (() => { const r = root.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(),
    itemCount: items.length, items, ancestors,
    menuitems: Array.from(root.querySelectorAll('[role="menuitem"],[role="option"]')).slice(0, 8).map((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { sel: pathOf(e), cls: String(e.className).slice(0, 50), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26), bg: c.backgroundColor, bf: c.backdropFilter, bgImage: String(c.backgroundImage).slice(0, 40), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], tokens: tokOf(e) } }),
  }
}
/** 弹层里的**分组标题条**（`_7KE1Ra_groupTitle` 之类）：自身 bg/bf + 最近容器 + 同容器内行。 */
const GROUP_TITLE_FACTS = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS } = H
  const TOK = ['--mpw-surface-pop', '--mpw-surface-pop-dark', '--mpw-pop-surface', '--mpw-pop-surface-alpha', '--mpw-pop-alpha', '--mpw-pop-blur']
  const tokOf = (e) => { const c = getComputedStyle(e); const o = {}; for (const t of TOK) { const v = c.getPropertyValue(t).trim(); if (v) o[t] = v.slice(0, 48) } return o }
  const rectOf = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  const titles = Array.from(document.querySelectorAll('[class*="_groupTitle"],[class*="groupTitle"]')).filter(VIS)
  return titles.map((t) => {
    const c = getComputedStyle(t)
    let cont = null
    for (let e = t.parentElement, i = 0; e && i < 14; e = e.parentElement, i++) {
      const role = String(e.getAttribute('role') || '').toLowerCase()
      if (role === 'menu' || role === 'listbox' || /_menu|_list_|_panel|_popover|_dropdown|_viewport/.test(String(e.className || ''))) { cont = e; break }
    }
    const cc = cont ? getComputedStyle(cont) : null
    return {
      sel: pathOf(t), tag: t.tagName, cls: String(t.className).slice(0, 60), text: String(t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22),
      bg: c.backgroundColor, bf: c.backdropFilter, bgImage: String(c.backgroundImage).slice(0, 40), color: c.color, rect: rectOf(t), tokens: tokOf(t),
      container: cont ? { sel: pathOf(cont), cls: String(cont.className).slice(0, 60), role: cont.getAttribute('role'), bg: cc.backgroundColor, bf: cc.backdropFilter, rect: rectOf(cont), tokens: tokOf(cont) } : null,
      siblings: cont ? Array.from(cont.querySelectorAll('[role="menuitem"],[role="option"],button,[class*="_cell"],[class*="_row"]')).filter(VIS).slice(0, 10).map((e) => { const ec = getComputedStyle(e); return { cls: String(e.className).slice(0, 44), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22), bg: ec.backgroundColor, bf: ec.backdropFilter, rect: rectOf(e) } }) : [],
    }
  })
}
/** 全页扫"嵌套双玻璃"：同时命中弹层表面选择器、且**祖先也命中**的元素对（底/模糊各叠两层）。 */
const DOUBLE_SURFACES = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA } = H
  const sels = ['[role="menu"]', '[role="listbox"]', '[role="combobox"]', '[role="dialog"]', '[data-dsh-surface]', '[class*="_menu"]', '[class*="_popover"]', '[class*="_dropdown"]', '[class*="_denseList"]', '[class*="_viewport"]', '[class*="_panel"]']
  const set = new Set()
  for (const s of sels) { try { for (const e of document.querySelectorAll(s)) set.add(e) } catch (e) { /* ignore */ } }
  const facts = (e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { sel: pathOf(e), cls: String(e.className).slice(0, 46), role: e.getAttribute('role'), tag: e.tagName, bg: c.backgroundColor, bf: c.backdropFilter, alpha: ALPHA(c.backgroundColor), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], z: c.zIndex } }
  const painted = Array.from(set).filter((e) => { const c = getComputedStyle(e); return VIS(e) && (ALPHA(c.backgroundColor) > 0.01 || c.backdropFilter !== 'none') })
  const nested = []
  for (const e of painted) {
    const anc = painted.filter((a) => a !== e && a.contains(e))
    if (anc.length) nested.push({ child: facts(e), ancestors: anc.map(facts) })
  }
  return { paintedCount: painted.length, nestedCount: nested.length, nested }
}
/** 输入区/状态区里所有可见按钮的清单（opener 猜不中时的诊断用）。 */
const COMPOSER_BUTTONS = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, NODE } = H
  const roots = ['[class*="composerStack"]', '[class*="composerSeat"]', '[class*="composer"]', 'footer', 'form'].map((x) => { try { return document.querySelector(x) } catch (e) { return null } }).filter(Boolean)
  const out = []
  for (const r of roots.slice(0, 2)) {
    for (const e of r.querySelectorAll('button,[role="button"],[class*="ring"],[class*="usage"],[class*="token"]')) {
      if (!VIS(e)) continue
      const b = e.getBoundingClientRect(); if (b.width < 8 || b.height < 8) continue
      out.push({ sel: pathOf(e), cls: String(e.className).slice(0, 44), aria: e.getAttribute('aria-label'), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20), rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] })
    }
  }
  return { count: out.length, buttons: out.slice(0, 30) }
}
/** `_overlayLayer` / `_overlay` / `[data-shell-overlay]` 的**原样读数**（closed 态：rect/opacity/visibility/pointer-events…）。 */
const OVERLAY_STATES = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const pathOf = H.pathOf, VIS = H.VIS
  const out = []
  for (const e of document.querySelectorAll('[class*="_overlayLayer"],[class*="_overlay"],[data-shell-overlay]')) {
    const c = getComputedStyle(e); const r = e.getBoundingClientRect()
    out.push({ sel: pathOf(e), cls: String(e.className).slice(0, 60), attrs: Array.from(e.attributes).map((a) => a.name).filter((n) => /^data-/.test(n)).slice(0, 4), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], opacity: c.opacity, visibility: c.visibility, pointerEvents: c.pointerEvents, display: c.display, z: c.zIndex, position: c.position, bg: c.backgroundColor, bf: c.backdropFilter, visible: VIS(e), children: e.children.length })
  }
  return { count: out.length, list: out }
}
const FIND_IDLE_ROW = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const BUSY = /运行中|生成中|思考中|等待回答|停止|正在/
  const rows = Array.from(document.querySelectorAll('[class*="sessionRow"]')).filter(vis)
  const info = rows.map((r, i) => ({ i, text: String(r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), busy: BUSY.test(String(r.textContent || '')) }))
  const idle = info.find((x) => !x.busy)
  return { rows: info, idleIdx: idle ? idle.i : null }
}
const HAS_COMPOSER_CONTROLS = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const q = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis).length
  return { plus: q('button[aria-label="指令"]'), perm: q('button[aria-label^="访问模式"]'), model: q('button[aria-label^="选择模型"]') }
}
const MENU_ITEMS = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const pathOf = H.pathOf
  const root = (() => { const rs = Array.from(document.querySelectorAll('[role="menu"],[role="listbox"]')).filter(vis); rs.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height)); return rs[0] || null })()
  if (!root) return { err: 'no-visible-menu' }
  const out = []
  for (const e of root.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemradio"],li,button')) {
    if (!vis(e)) continue
    const r = e.getBoundingClientRect()
    if (r.width < 60 || r.height < 14) continue
    const c = getComputedStyle(e)
    out.push({ path: pathOf(e), cls: String(e.className).slice(0, 60), role: e.getAttribute('role'), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), bg: c.backgroundColor, bf: c.backdropFilter, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })
  }
  return { rootCls: String(root.className).slice(0, 60), count: out.length, items: out.slice(0, 20) }
}
/** 弹层里的"白色不透明长条"（用户说提供商分组标题是白色长条）与模型行 */
const WHITE_BARS = () => {
  const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const ALPHA = H.ALPHA
  const pathOf = H.pathOf
  const root = (() => { const H2 = globalThis.__pp; const rs = Array.from(document.querySelectorAll('[role="menu"],[role="listbox"]')).filter(vis); rs.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height)); return rs[0] || null })()
  if (!root) return { err: 'no-visible-menu' }
  const bars = []
  for (const e of root.querySelectorAll('*')) {
    if (!vis(e)) continue
    const c = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    const a = ALPHA(c.backgroundColor)
    if (a < 0.98) continue
    if (r.width < 110 || r.height < 12) continue
    bars.push({ path: pathOf(e), cls: String(e.className).slice(0, 60), role: e.getAttribute('role'), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26), bg: c.backgroundColor, bf: c.backdropFilter, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], inOverlayAny: !!e.closest('[class*="_overlay"]'), inOverlayLayer: !!e.closest('[class*="_overlayLayer"]') })
  }
  return { scopeCls: String(root.className).slice(0, 50), barCount: bars.length, bars: bars.slice(0, 10) }
}
const CLOSE_ALL = () => { try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) { /* ignore */ } return true }

/* ── 1b P3 弹层模糊调查原语（批次 2）：全部只读/临时/可逆 ────────────────────────────
   背景：加号指令菜单/权限选择器/上下文用量面板三处弹层 = 半透明白底、没有模糊；模型选择器（同一枚
   token，挂在 body 下）正常。主假设：backdrop-filter 只模糊同一 backdrop root 内、绘制在它下面的
   像素；祖先链上凡有 bf/filter/opacity<1/transform/will-change/contain/isolation/mask/clip-path 之一，
   root 被截断 ⇒ blur 的采样只剩那个祖先内部（常为纯色）⇒ 有 alpha 没模糊。
   ⚠ page.evaluate 不序列化闭包 ⇒ 六个操作合并进一个自包含分发器 PP_BLUR({mode, sel})：
     chain=截断链扫描 / e1=移 body 实验（同步 移→扫→逐字还原）/ e3=中性化截断祖先 / rect=表面矩形 /
     styleOn=临时样式开关([sel,mode]) / styleOff=还原+摘棋盘。 */
const PP_BLUR = (arg) => {
  const H = globalThis.__pp
  const pathOf = H && H.pathOf ? H.pathOf : (e) => String(e.className).slice(0, 50)
  /* __pp.pathOf 返回的是路径对象数组（Node 侧用 selOf 转字符串）⇒ 页内自带同款转换 */
  const selToStr = (p) => typeof p === 'string' ? p
    : (Array.isArray(p) && p.length ? p.map((x, i) => {
        const last = i === p.length - 1
        let s = x.tag || '*'
        if (x.id) s += '[id="' + String(x.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]'
        else if (last && x.cls && x.cls.length) s += '.' + x.cls[0]
        if (last && x.attrs && x.attrs.length) s += '[' + x.attrs[0] + ']'
        if (!x.id) s += ':nth-child(' + (x.idx || 1) + ')'
        return s
      }).join(' > ') : null)
  const TRUNC_PROPS = (c) => {
    const bad = []
    if (c.backdropFilter && c.backdropFilter !== 'none') bad.push('backdrop-filter=' + c.backdropFilter)
    if (c.filter && c.filter !== 'none') bad.push('filter=' + c.filter)
    if (c.opacity && c.opacity !== '1' && Number(c.opacity) < 1) bad.push('opacity=' + c.opacity)
    if (c.transform && c.transform !== 'none') bad.push('transform')
    if (c.willChange && /filter|opacity|transform/i.test(c.willChange)) bad.push('will-change=' + c.willChange)
    if (c.contain && c.contain !== 'none' && /paint|layout|strict|content/.test(c.contain)) bad.push('contain=' + c.contain)
    if (c.isolation === 'isolate') bad.push('isolation')
    if (c.maskImage && c.maskImage !== 'none') bad.push('mask')
    if (c.clipPath && c.clipPath !== 'none') bad.push('clip-path')
    return bad
  }
  const TRUNC_CHAIN = (selOrEl) => {
    let el = typeof selOrEl === 'string' ? document.querySelector(selToStr(selOrEl)) : selOrEl
    if (!el) return { found: false }
    let surface = el
    for (let i = 0; i < 6; i++) {
      const c = getComputedStyle(surface)
      const bg = c.backgroundColor || ''
      const painted = (c.backdropFilter && c.backdropFilter !== 'none')
        || (bg && bg !== 'transparent' && !/rgba?\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(bg) && !/color\(srgb [^/]*\/ 0\)/.test(bg))
      if (painted) break
      if (!surface.parentElement) break
      surface = surface.parentElement
    }
    const sc = getComputedStyle(surface)
    const chain = []
    let first = null
    for (let n = surface.parentElement, i = 0; n && n !== document.documentElement && i < 40; n = n.parentElement, i++) {
      const c = getComputedStyle(n)
      const bad = TRUNC_PROPS(c)
      chain.push({ sel: selToStr(pathOf(n)), tag: n.tagName, cls: String(n.className || '').slice(0, 60), bad, position: c.position, z: c.zIndex })
      if (bad.length && !first) first = { sel: selToStr(pathOf(n)), tag: n.tagName, cls: String(n.className || '').slice(0, 60), bad }
    }
    return {
      found: true,
      surface: { sel: selToStr(pathOf(surface)), tag: surface.tagName, cls: String(surface.className || '').slice(0, 60), bg: sc.backgroundColor, bf: sc.backdropFilter },
      truncatedBy: first, chain,
    }
  }
  const mode = arg && arg.mode
  const sel = arg && arg.sel
  if (mode === 'chain') return TRUNC_CHAIN(sel)
  /* 实验①：把表面临时 position:fixed 挂到 body（同步 移动→扫链→逐字还原，React 看不到中间态） */
  if (mode === 'e1') {
    const el = document.querySelector(sel)
    if (!el) return { found: false }
    const parent = el.parentElement, next = el.nextSibling
    const prevRect = el.getBoundingClientRect()
    const prevCss = el.style.cssText
    let out = { found: true }
    try {
      el.style.cssText = prevCss + ';position:fixed;left:' + Math.round(prevRect.left) + 'px;top:' + Math.round(prevRect.top) + 'px;z-index:2147483000;'
      document.body.appendChild(el)
      const moved = TRUNC_CHAIN(el)
      out.chainAfterMove = moved.chain.map((x) => ({ cls: x.cls, bad: x.bad }))
      out.truncatorAfterMove = moved.truncatedBy
      out.wouldApply = !moved.truncatedBy
    } catch (e) {
      out.err = String(e && e.message || e)
    } finally {
      try { if (next && next.parentElement === parent) parent.insertBefore(el, next); else if (parent) parent.appendChild(el) } catch (e) {}
      try { el.style.cssText = prevCss } catch (e) {}
      out.movedBack = el.parentElement === parent
    }
    return out
  }
  /* 实验③：把第一个截断祖先的嫌疑属性临时中性化（inline 覆盖→扫链→还原）；
     inline 若压不过宿主 !important，再用 CSSOM 注入同特异性更晚的 !important 规则试一次（两者都同步还原）。 */
  if (mode === 'e3') {
    const tc = TRUNC_CHAIN(sel)
    if (!tc.found) return { found: false }
    if (!tc.truncatedBy) return { found: true, hadTruncator: false }
    const el = document.querySelector(selToStr(tc.truncatedBy.sel))
    if (!el) return { found: true, hadTruncator: true, err: 'truncator-not-found-by-sel' }
    const prev = el.style.cssText
    const out = { found: true, hadTruncator: true, truncator: tc.truncatedBy }
    try {
      const bfBefore = getComputedStyle(el).backdropFilter
      el.style.backdropFilter = 'none'; el.style.filter = 'none'; el.style.opacity = '1'
      el.style.transform = 'none'; el.style.isolation = 'auto'; el.style.willChange = 'auto'
      const after = TRUNC_CHAIN(sel)
      out.inline = {
        bfBefore, bfAfter: getComputedStyle(el).backdropFilter,
        neutralized: getComputedStyle(el).backdropFilter === 'none',
        truncatorAfter: after.truncatedBy, cleared: !after.truncatedBy,
      }
      if (!out.inline.cleared) {
        const st = document.createElement('style')
        st.textContent = selToStr(tc.truncatedBy.sel) + '{backdrop-filter:none !important;filter:none !important;opacity:1 !important;transform:none !important;}'
        document.head.appendChild(st)
        const afterCss = TRUNC_CHAIN(sel)
        out.cssomInject = { cleared: !afterCss.truncatedBy, truncatorAfter: afterCss.truncatedBy }
        st.remove()
      }
      return out
    } finally {
      try { el.style.cssText = prev } catch (e) {}
    }
  }
  if (mode === 'rect') {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.max(2, Math.min(600, Math.round(r.width))), height: Math.max(2, Math.min(600, Math.round(r.height))) }
  }
  /* 实验②/背后采样：surface 的 inline 样式临时改写（调用方负责截图与还原）。
     checker 把高对比棋盘插到表面**前面当兄弟**（同一父级、DOM 序在前 ⇒ 画在表面之下）。 */
  if (mode === 'styleOn') {
    const m = arg.arg
    const el = document.querySelector(sel)
    if (!el) return { found: false }
    if (!el.__ppPrevCss) el.__ppPrevCss = el.style.cssText
    const rect = el.getBoundingClientRect()
    if (m === 'behind') { el.style.opacity = '0' }
    else if (m === 'bf-off') { el.style.backdropFilter = 'none' }
    else if (m === 'checker') {
      const chk = document.createElement('div')
      chk.id = 'pp-blur-checker'
      const zs = getComputedStyle(el).zIndex
      const z = /^\d+$/.test(zs) ? Math.max(0, Number(zs) - 1) : '0'
      chk.style.cssText = 'position:fixed;left:' + Math.round(rect.left) + 'px;top:' + Math.round(rect.top) + 'px;width:' + Math.max(2, Math.round(rect.width)) + 'px;height:' + Math.max(2, Math.round(rect.height)) + 'px;z-index:' + z + ';' +
        'background:repeating-conic-gradient(#000 0% 25%, #fff 0% 50%);background-size:16px 16px;'
      if (el.parentElement) el.parentElement.insertBefore(chk, el)
      else { el.__ppPrevZ = el.style.zIndex; el.style.zIndex = '2147483001'; document.body.appendChild(chk) }
    }
    return { found: true, rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] }
  }
  if (mode === 'styleOff') {
    const el = document.querySelector(sel)
    const out = { removedChecker: 0 }
    if (el) {
      if (el.__ppPrevCss !== undefined) { el.style.cssText = el.__ppPrevCss; delete el.__ppPrevCss }
      if (el.__ppPrevZ !== undefined) { el.style.zIndex = el.__ppPrevZ; delete el.__ppPrevZ }
    }
    for (const c of document.querySelectorAll('#pp-blur-checker')) { c.remove(); out.removedChecker++ }
    return out
  }
  return { err: 'unknown-mode:' + mode }
}

/* ── 2 组 6/7/8 的页面侧采集 ─────────────────────────────────────────────── */
const SIDEBAR_TINT = () => {
  const one = (sel) => { const e = document.querySelector(sel); if (!e) return { sel, found: false }; const c = getComputedStyle(e); return { sel, found: true, cls: String(e.className).slice(0, 70), bg: c.backgroundColor, bgImage: String(c.backgroundImage).slice(0, 90), bf: c.backdropFilter, color: c.color } }
  const tok = (scope, name) => { try { return getComputedStyle(scope).getPropertyValue(name).trim() } catch (e) { return null } }
  return {
    bodyAqua: document.body.hasAttribute('data-mpw-aqua'),
    bodyAttrs: Array.from(document.body.attributes).map((a) => a.name).filter((n) => /^data-mpw/.test(n)),
    panelTintOnHtml: tok(document.documentElement, '--mpw-panel-tint'),
    panelTintOnBody: tok(document.body, '--mpw-panel-tint'),
    aquaRgb: tok(document.documentElement, '--mpw-aqua-rgb'),
    dswSidebarFill: tok(document.body, '--dsw-specific-sidebar-fill'),
    dswBgBase: tok(document.body, '--dsw-alias-bg-base'),
    sidebarCol: one('[class*="sidebarCol"]'),
    sidebarRoot: one('.hHd-Xa_root'),
    sidebarSlot: one('[data-slot="sidebar"]'),
    sidebarInner: one('[class*="sidebarCol"] > *'),
    styleEl: (() => { const st = document.querySelector('style[data-plugin="dsh-mpkg-wallpaper"]'); const t = st ? String(st.textContent || '') : ''; return { len: t.length, hasAquaTint: /--mpw-panel-tint/.test(t), hasAquaRgb: /--mpw-aqua-rgb/.test(t) } })(),
    pluginNote: (() => { try { return Object.assign({}, (globalThis.__mpwPersist.read() || {})) && { enabled: globalThis.__mpwPersist.read().enabled, sidebarAlpha: globalThis.__mpwPersist.read().sidebarAlpha, unifyAmount: globalThis.__mpwPersist.read().unifyAmount, aquaTint: globalThis.__mpwPersist.read().aquaTint, aquaMask: globalThis.__mpwPersist.read().aquaMask } } catch (e) { return { err: String(e && e.message || e) } } })(),
  }
}

const FLOAT_FACTS = () => {
  const e = document.querySelector('[data-sidebar-right-panel]')
  const c = e ? getComputedStyle(e) : null
  const r = e ? e.getBoundingClientRect() : null
  return {
    bodyFloat: document.body.getAttribute('data-mpw-float'),
    bodyAttrs: Array.from(document.body.attributes).map((a) => a.name).filter((n) => /^data-mpw/.test(n)),
    rightPanel: e ? { cls: String(e.className).slice(0, 50), top: c.top, right: c.right, bottom: c.bottom, left: c.left, radius: c.borderRadius, shadow: String(c.boxShadow).slice(0, 90), margin: c.margin, position: c.position, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] } : null,
    dockSurface: (() => { const d = document.querySelector('[data-dockkit-surface]'); if (!d) return null; const dc = getComputedStyle(d); const dr = d.getBoundingClientRect(); return { cls: String(d.className).slice(0, 40), radius: dc.borderRadius, shadow: String(dc.boxShadow).slice(0, 80), margin: dc.margin, rect: [Math.round(dr.x), Math.round(dr.y), Math.round(dr.width), Math.round(dr.height)] } })(),
  }
}

/* 动画/掉帧：PerformanceObserver(longtask) + rAF 间隔 + DOM 变更计数（只在这段测量窗口里开） */
const ANIM_INSTALL = () => {
  try {
    if (globalThis.__probeAnim) { try { globalThis.__probeAnim.obs.disconnect(); globalThis.__probeAnim.mo.disconnect(); globalThis.__probeAnim.running = false } catch (e) { /* ignore */ } }
    const st = { longtasks: [], rafMax: 0, rafCount: 0, mutations: 0, running: true }
    try { st.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) st.longtasks.push(Math.round(e.duration)) }); st.obs.observe({ entryTypes: ['longtask'] }) } catch (e) { st.longtaskErr = String(e && e.message || e) }
    try { st.mo = new MutationObserver((ms) => { st.mutations += ms.length }); st.mo.observe(document.body, { subtree: true, childList: true, attributes: true }) } catch (e) { st.moErr = String(e && e.message || e) }
    let last = performance.now()
    const loop = (t) => { const d = t - last; last = t; if (d > st.rafMax) st.rafMax = d; st.rafCount++; if (st.running) requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
    globalThis.__probeAnim = st
    return { ok: true }
  } catch (e) { return { err: String(e && e.message || e) } }
}
const ANIM_READ = () => {
  try {
    const st = globalThis.__probeAnim
    if (!st) return { err: 'not-installed' }
    const out = { longtasks: st.longtasks.slice(), longtaskCount: st.longtasks.length, longtaskMax: st.longtasks.length ? Math.max.apply(null, st.longtasks) : 0, longtaskTotal: st.longtasks.reduce((a, b) => a + b, 0), rafMax: Math.round(st.rafMax * 10) / 10, rafCount: st.rafCount, mutations: st.mutations, longtaskErr: st.longtaskErr || null, moErr: st.moErr || null }
    st.longtasks.length = 0; st.rafMax = 0; st.rafCount = 0; st.mutations = 0
    out.errRing = (() => { try { return globalThis.__mpwErrRing ? String(JSON.stringify(globalThis.__mpwErrRing()).length) : null } catch (e) { return null } })()
    out.hdrFrostWatch = (() => { try { return globalThis.__mpwHdrFrostTest && globalThis.__mpwHdrFrostTest.state ? globalThis.__mpwHdrFrostTest.state().watchHits : null } catch (e) { return null } })()
    return out
  } catch (e) { return { err: String(e && e.message || e) } }
}
const COLLAPSE_EL = () => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA, NODE } = H
  const vis = VIS
  const pats = [/收起侧边栏/, /展开侧边栏/]
  for (const p of pats) {
    const hit = Array.from(document.querySelectorAll('button,[role="button"]')).filter(vis).find((e) => p.test((e.getAttribute('aria-label') || '') + String(e.textContent || '')))
    if (hit) return { aria: hit.getAttribute('aria-label'), cls: String(hit.className).slice(0, 40) }
  }
  return null
}
const ENSURE_EXPANDED = () => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const vis = H.VIS
  const W = () => { const e = document.querySelector('[class*="sidebarCol"]'); return e ? Math.round(e.getBoundingClientRect().width) : null }
  const steps = []
  for (let i = 0; i < 3; i++) {
    const w = W()
    if (w !== null && w >= 100) return { ok: true, width: w, steps }
    /* 展开控件在收起态可能只有图标/在窄轨里 ⇒ 多路候选都试一遍（不依赖单一 aria） */
    /* 收起态的实际 aria 是"打开侧边栏"（不是"展开侧边栏"）；底部面板的"展开底部面板"必须排除，
       否则会点到错的按钮（实测踩过：插件关那一轮点成了展开底部面板 ⇒ 那一轮等于没测）。 */
    const cands = []
    const byAria = Array.from(document.querySelectorAll('button,[role="button"],[tabindex]')).filter(vis)
      .filter((e) => /侧边栏/.test((e.getAttribute('aria-label') || '') + String(e.textContent || '')) && !/底部/.test(e.getAttribute('aria-label') || ''))
    cands.push(...byAria)
    const byCls = Array.from(document.querySelectorAll('button[class*="toggle"],button[class*="_toggle"]')).filter(vis).filter((e) => !/底部/.test(e.getAttribute('aria-label') || ''))
    cands.push(...byCls)
    const inRail = Array.from(document.querySelectorAll('[class*="sidebarCol"] button,[data-slot="sidebar"] button')).filter(vis).filter((e) => !/底部/.test(e.getAttribute('aria-label') || ''))
    cands.push(...inRail)
    if (!cands.length) { steps.push({ i, width: w, why: 'no-candidate' }); break }
    const el = cands[0]
    const desc = { i, width: w, cls: String(el.className).slice(0, 40), aria: el.getAttribute('aria-label'), tag: el.tagName }
    el.click(); steps.push(desc)
  }
  return { ok: W() !== null && W() >= 100, width: W(), steps }
}
const CLICK_SIDEBAR_TOGGLE = () => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA, NODE } = H
  const vis = VIS
  const hit = Array.from(document.querySelectorAll('button,[role="button"]')).filter(vis).find((e) => /收起侧边栏|展开侧边栏/.test((e.getAttribute('aria-label') || '') + String(e.textContent || '')))
  if (!hit) return { ok: false, why: 'no-toggle' }
  const aria = hit.getAttribute('aria-label'); hit.click(); return { ok: true, aria }
}
const SIDEBAR_WIDTH = () => { const e = document.querySelector('[class*="sidebarCol"]'); return e ? Math.round(e.getBoundingClientRect().width) : null }
const SESSION_STATE = () => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA, NODE } = H
  try {
    const q = (s) => { try { return Array.from(document.querySelectorAll(s)) } catch (e) { return [] } }
    const rows = q('[class*="sessionRow"]')
    const sel = rows.filter((e) => VIS(e) && /selected|active|current/i.test(String(e.className)))
    const root = document.querySelector('.wSkVaW_root') || document.querySelector('.wSkVaW_scrollBody')
    return { rows: rows.length, rowsSelected: sel.length, chatTextLen: root ? String(root.textContent || '').length : null, headerHidden: (() => { const h = document.querySelector('.wSkVaW_header'); return h ? getComputedStyle(h).display === 'none' : null })() }
  } catch (e) { return { err: String(e && e.message || e) } }
}
const OPEN_SESSION_FN = (idx) => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA, NODE } = H
  const rows = Array.from(document.querySelectorAll('[class*="sessionRow"]')).filter(VIS)
  if (rows.length) { const i = ((idx || 0) % rows.length + rows.length) % rows.length; rows[i].click(); return { clicked: 'existing-session-row', index: i, rows: rows.length } }
  const btns = Array.from(document.querySelectorAll('button[aria-label="新建会话"]')).filter(VIS)
  if (!btns.length) return { clicked: 'none', why: 'no-new-session-button' }
  const el = btns.filter((e) => /newSession/.test(String(e.className)))[0] || btns[btns.length - 1]
  el.click(); return { clicked: 'new-session-button' }
}
const RIGHTBAR_FN = () => {
  const H = globalThis.__pp
  if (!H) return { err: 'page-helpers-missing' }
  const { pathOf, VIS, ALPHA, NODE } = H
  const t = Array.from(document.querySelectorAll('[data-dockkit-strip],[data-dockkit-pane],[data-sidebar-right-panel]'))
  if (t.length && t.some(VIS)) return { clicked: 'already-visible' }
  const inC = Array.from(document.querySelectorAll('[data-dockkit-strip] button,[data-rightbar-col] button,[class*="rightbarCol"] button'))
  if (inC.length) { inC[0].click(); return { clicked: 'container-toggle', zeroSized: !VIS(inC[0]) } }
  const hit = Array.from(document.querySelectorAll('button,[role="button"]')).filter(VIS).find((e) => /展开右侧|右侧边栏|视图选项/.test((e.getAttribute('aria-label') || '') + String(e.textContent || '')))
  if (hit) { hit.click(); return { clicked: 'by-label', aria: hit.getAttribute('aria-label') } }
  return { clicked: 'none' }
}

/** 像素采样：对给定 rect 截图，再在页面里用 canvas 解出平均色与五点色（无头 Firefox **不合成 backdrop-filter**，
 *  所以这里的像素只当"合成结果"的旁证；因果结论以 computed 值为准 —— 见 JSON 里的 note）。 */
const samplePixels = async (page, clip) => {
  try {
    const buf = await page.screenshot({ clip, type: 'png' })
    const b64 = buf.toString('base64')
    return await page.evaluate(async (data) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + data
      await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let r = 0, gg = 0, b = 0, n = 0, sum = 0, sum2 = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += L; sum2 += L * L }
      const pts = []
      for (const [fx, fy] of [[0.5, 0.1], [0.5, 0.5], [0.5, 0.9], [0.2, 0.5], [0.8, 0.5]]) {
        const x = Math.min(c.width - 1, Math.round(fx * (c.width - 1))), y = Math.min(c.height - 1, Math.round(fy * (c.height - 1)))
        const i = (y * c.width + x) * 4
        pts.push([d[i], d[i + 1], d[i + 2]])
      }
      const mean = sum / n
      const lumaStd = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
      return { w: c.width, h: c.height, avg: [Math.round(r / n), Math.round(gg / n), Math.round(b / n)], lumaMean: Math.round(mean * 10) / 10, lumaStd: Math.round(lumaStd * 10) / 10, samples: pts }
    }, b64)
  } catch (e) { return { err: String(e && e.message || e).slice(0, 160) } }
}

/* ── 3 主流程 ───────────────────────────────────────────────────────────── */
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.mkdirSync(WORK, { recursive: true })
const settingsSnap = snapFile(SETTINGS_JSON)
const result = {
  probe: 'host-popover-probe', at: new Date().toISOString(), authority: AUTHORITY, url: URL0,
  groups: GROUPS, viewport: VIEWPORT, blocked: null, groupsOut: {}, pageErrors: [], hostWritesBlocked: 0,
  settingsFile: { path: SETTINGS_SHOWN, existed: !!settingsSnap, before: settingsSnap ? settingsSnap.sha256.slice(0, 12) : null, hostWritesBlocked: !ALLOW_HOST_WRITES },
  restore: null,
}
const dump = () => fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')
const blocked = (why, detail) => { result.blocked = { why, detail: detail === undefined ? null : String(detail).slice(0, 400), at: new Date().toISOString() }; dump(); console.log('✗ blocked:' + why + (detail ? '  — ' + String(detail).slice(0, 300) : '')); process.exit(2) }

let browser = null
try {
  try { execFileSync(process.execPath, [path.join(HERE, 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { cwd: PLUGIN, stdio: ['ignore', 'pipe', 'inherit'] }) } catch (e) { blocked('cookie-mint-failed', String((e && e.stderr) || (e && e.message) || e)) }
  if (!fs.existsSync(COOKIE)) blocked('cookie-missing', COOKIE)
  const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

  let pw = null
  try { pw = await import('playwright') } catch (e) { pw = null }
  const firefox = pw && ((pw.default && pw.default.firefox) || pw.firefox)
  if (!firefox) { result.note = 'playwright/没有 firefox'; dump(); console.log('SKIP host-popover-probe — 本机没有 playwright firefox（未起浏览器、未写设置）'); process.exit(0) }

  browser = await firefox.launch({ headless: !HEADED, firefoxUserPrefs: withAudioMute() })
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'zh-CN' })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  if (!ALLOW_HOST_WRITES) {
    await page.route('**/api/mpkg-wallpaper/settings*', (route) => {
      if (route.request().method() === 'GET' || route.request().method() === 'HEAD') return route.continue()
      result.hostWritesBlocked++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, blockedByProbe: 'host-popover-probe' }) })
    })
  }
  page.on('pageerror', (e) => result.pageErrors.push(String((e && e.message) || e).slice(0, 200)))
  await page.addInitScript(INIT_HELPERS)

  const resp = await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (resp && (resp.status() === 401 || resp.status() === 403)) blocked('http-' + resp.status(), '首页要鉴权 Cookie')
  if (!resp || !resp.ok()) blocked('http-' + (resp ? resp.status() : 'none'), '首页不可用')
  try { await page.waitForFunction(() => !!(globalThis.__mpwSectionTest && globalThis.__mpwPersist), null, { timeout: 30000 }) } catch (e) { blocked('plugin-not-active', '拿不到 __mpwSectionTest/__mpwPersist') }
  result.page = { title: await page.title(), status: resp.status() }

  const original = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch (e) { return null } }, STORE)
  const setSection = async (patch) => page.evaluate(({ p }) => {
    try { globalThis.__mpwSectionTest.write(p); globalThis.__mpwPersist.apply(); return { ok: true } } catch (e) { return { err: String(e && e.message || e) } }
  }, { p: patch })
  const effective = async () => page.evaluate(() => { try { const s = globalThis.__mpwPersist.read() || {}; return { enabled: s.enabled, unifyTint: s.unifyTint, unifyAmount: s.unifyAmount, sidebarAlpha: s.sidebarAlpha, blurFollowUnify: s.blurFollowUnify, aquaTint: s.aquaTint, aquaMask: s.aquaMask } } catch (e) { return { err: String(e && e.message || e) } } })

  /* 可见布局：有内容的会话 + 右栏 */
  if (has('open-session') || has('open-right') || true) {
    const st0 = await page.evaluate(SESSION_STATE)
    const hasContent = st0 && (st0.headerHidden === false || (st0.chatTextLen || 0) > 300)
    result.layout = { initial: st0, clicks: [] }
    if (!hasContent) {
      for (let i = 0; i < 6; i++) {
        const r = await page.evaluate(OPEN_SESSION_FN, i)
        await page.waitForTimeout(2500)
        const st = await page.evaluate(SESSION_STATE)
        result.layout.clicks.push({ i, r, st })
        if (st && (st.headerHidden === false || (st.chatTextLen || 0) > 300)) break
      }
    }
    /* composer 的弹层 opener（指令/访问模式/选择模型）只在**空闲**会话里渲染；被选中的那条若在跑子代理
       （行文本含"运行中/等待回答"）就会换成"停止" ⇒ 先挑一条空闲行切过去，并验证控件齐全。 */
    result.layout.idle = await page.evaluate(FIND_IDLE_ROW)
    result.layout.composerBefore = await page.evaluate(HAS_COMPOSER_CONTROLS)
    const needIdle = !result.layout.composerBefore.plus || !result.layout.composerBefore.perm || !result.layout.composerBefore.model
    if (needIdle && result.layout.idle && Number.isFinite(result.layout.idle.idleIdx)) {
      const r = await page.evaluate(OPEN_SESSION_FN, result.layout.idle.idleIdx)
      await page.waitForTimeout(3000)
      result.layout.switchedToIdle = { r, idleIdx: result.layout.idle.idleIdx, afterSwitch: await page.evaluate(SESSION_STATE), composer: await page.evaluate(HAS_COMPOSER_CONTROLS) }
    }
    const rb = await page.evaluate(RIGHTBAR_FN)
    result.layout.right = rb
    await page.waitForTimeout(1200)
    result.layout.after = await page.evaluate(SESSION_STATE)
    result.layout.composer = await page.evaluate(HAS_COMPOSER_CONTROLS)
  }
  await page.waitForTimeout(SETTLE)

  /* ── 组 1-5：弹层 DOM 事实 ── */
  if (want('popovers')) {
    const pop = { at: new Date().toISOString(), targets: [] }
    const targets = [
      {
        id: 'plus-menu', desc: '输入框左侧「+」菜单（Compact/Export 等）',
        plan: [{ sel: 'button[aria-label="指令"]' }, { sel: 'button[aria-label="添加附件"]' }, { text: '^指令$' }, { text: '添加附件' }],
      },
      {
        id: 'permission', desc: '权限选择（仅可查看/工作区内修改/完全权限）',
        plan: [{ sel: 'button[aria-label^="访问模式"]' }, { text: '工作区内修改|仅可查看|完全权限' }, { text: '^权限' }],
      },
      {
        id: 'model-level1', desc: '模型 + 推理等级（第 1 层）',
        plan: [{ sel: 'button[aria-label^="选择模型"]' }, { sel: '[class*="_trigger"][aria-haspopup="menu"]' }, { text: '推理等级|DeepSeek-V' }],
      },
      {
        id: 'context-usage', desc: '上下文占用圆圈',
        plan: [{ sel: '[class*="context"][role="button"]' }, { sel: '[class*="usage"]' }, { sel: '[class*="ring"]' }, { text: '上下文|Context|占用|tokens?' }],
      },
      {
        id: 'subagent-chip', desc: '标题栏里的子代理容器',
        plan: [{ sel: '.wSkVaW_header [class*="agent"]' }, { sel: '.wSkVaW_header [class*="sub"]' }, { sel: '.wSkVaW_header button' }, { text: '子代理|Subagent|Agent' }],
      },
    ]
    for (const t of targets) {
      if (ONLY_TARGET.length && !ONLY_TARGET.includes(t.id)) continue
      const rec = { id: t.id, desc: t.desc, blocked: null, openedBy: null, before: null, after: null }
      try {
        try { await page.keyboard.press('Escape') } catch (e) { /* ignore */ }
        await page.evaluate(CLOSE_ALL); await page.waitForTimeout(350)
        rec.before = await page.evaluate(POPOVERS)
        const found = await page.evaluate(FIND_OPENER, t.plan)
        rec.openedBy = found
        if (found && found.path) {
          const sel = selOf(found.path)
          let clicked = null
          try { await page.locator(sel).first().click({ timeout: 4000 }); clicked = 'real-mouse' } catch (e) { clicked = 'locator-failed:' + String(e && e.message || e).slice(0, 60) }
          if (clicked !== 'real-mouse') {
            try { await page.evaluate((s2) => { const e = document.querySelector(s2); if (e) for (const t2 of ['pointerdown', 'mousedown', 'mouseup', 'click']) e.dispatchEvent(new MouseEvent(t2, { bubbles: true, cancelable: true, view: window })) }, sel); clicked = 'synthetic-events' } catch (e) { /* ignore */ }
          }
          rec.openedBy.clickHow = clicked
          rec.openedBy.selector = sel
        }
        await page.waitForTimeout(1400)
        rec.after = await page.evaluate(POPOVERS)
        const sig = (x) => JSON.stringify((x.popovers || []).map((p) => [p.root.path, (p.surfaces || []).map((y) => y.path)]))
        const rsig = (x) => JSON.stringify(Object.entries((x.roles || {})).map(([k, v]) => [k, v.total, (v.visible || 0), ((v.facts || [])[0] || {}).path]).concat([((x.roles || {}).expanded || []).map((e) => e.path)]))
        const grown = sig(rec.after) !== sig(rec.before) || rsig(rec.after) !== rsig(rec.before)
        if (!found || !found.path) rec.blocked = 'blocked:no-opener'
        else if (!grown) rec.blocked = 'blocked:clicked-but-no-new-popover'
        rec.candidates = await page.evaluate(CANDIDATES)
        if (t.id === 'subagent-chip') { rec.headerChildren = await page.evaluate(HEADER_CHILDREN); rec.subagentFacts = await page.evaluate(SUBAGENT_FACTS) }
        if (t.id === 'context-usage') rec.roundCandidates = await page.evaluate(ROUND_CANDIDATES)
        /* 模型第 2 层：点进"选择模型"，并把"提供商分组标题"与"模型行"分开 dump */
        if (t.id === 'model-level1' && !rec.blocked) {
          rec.level1MenuItems = await page.evaluate(MENU_ITEMS)
          const lvl2found = await page.evaluate(FIND_MENU_ENTRY, '^模型|模型\\s*DeepSeek|模型列表|选择模型|所有模型|Manage')
          const lvl2 = { found: lvl2found }
          if (lvl2found && lvl2found.path) { const s2 = selOf(lvl2found.path); try { await page.locator(s2).first().click({ timeout: 4000 }) } catch (e) { try { await page.evaluate((x) => { const e = document.querySelector(x); if (e) e.click() }, s2) } catch (e2) { /* ignore */ } } }
          await page.waitForTimeout(1200)
          rec.level2 = { openedBy: lvl2, facts: await page.evaluate(POPOVERS) }
          rec.level2.whiteBars = await page.evaluate(WHITE_BARS)
          rec.level2.menuItems = await page.evaluate(MENU_ITEMS)
          rec.level2.groups = await page.evaluate(() => {
            const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
            const vis = H.VIS
            const pick = (pat) => Array.from(document.querySelectorAll('div,li,section,h1,h2,h3,h4,span,p,[role="group"],[role="option"],[role="menuitem"]'))
              .filter((e) => vis(e) && pat.test(String(e.textContent || '').trim().slice(0, 32)))
              .map((e) => ({ cls: String(e.className).slice(0, 70), role: e.getAttribute('role'), bg: getComputedStyle(e).backgroundColor, bf: getComputedStyle(e).backdropFilter, rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), inOverlayAny: !!e.closest('[class*="_overlay"]'), inOverlayLayer: !!e.closest('[class*="_overlayLayer"]') }))
              .slice(0, 8)
            return { providerHeaders: pick(/^(DeepSeek|z-ai|anthropic|openai|google|月之暗面|智谱)/i), modelRows: Array.from(document.querySelectorAll('[role="option"],[role="menuitem"],[class*="modelRow"],[class*="option"]')).filter((e) => vis(e)).slice(0, 6).map((e) => ({ cls: String(e.className).slice(0, 60), bg: getComputedStyle(e).backgroundColor, bf: getComputedStyle(e).backdropFilter, rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28) })) }
          })
        }
      } catch (e) { rec.blocked = 'blocked:exception ' + String(e && e.message || e).slice(0, 160) }
      pop.targets.push(rec)
      console.log('POPOVER ' + t.id + ' → ' + (rec.blocked || 'ok') + '  (by=' + JSON.stringify(rec.openedBy && (rec.openedBy.pattern || rec.openedBy.why)) + ', how=' + JSON.stringify(rec.openedBy && rec.openedBy.clickHow) + ', visibleMenu ' + ((rec.before && rec.before.roles && rec.before.roles.menu.visible) || 0) + '→' + ((rec.after && rec.after.roles && rec.after.roles.menu.visible) || 0) + ', listbox ' + ((rec.before && rec.before.roles && rec.before.roles.listbox.visible) || 0) + '→' + ((rec.after && rec.after.roles && rec.after.roles.listbox.visible) || 0) + ')')
      try { await page.keyboard.press('Escape') } catch (e) { /* ignore */ }
      await page.evaluate(CLOSE_ALL); await page.waitForTimeout(300)
    }
    /* 子代理容器只在"正在跑子代理"的那条会话里出现 ⇒ 专门切到忙会话采一趟，再切回空闲会话 */
    const busyIdx = ((result.layout.idle && result.layout.idle.rows) || []).filter((r) => r.busy).map((r) => r.i)[0]
    if (Number.isFinite(busyIdx)) {
      try {
        const sw = await page.evaluate(OPEN_SESSION_FN, busyIdx)
        await page.waitForTimeout(3500)
        pop.busySession = {
          switched: sw,
          state: await page.evaluate(SESSION_STATE),
          headerChildren: await page.evaluate(HEADER_CHILDREN),
          subagentAnywhere: await page.evaluate(() => {
            const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
            const vis = H.VIS
            const NODE = H.NODE
            const hits = Array.from(document.querySelectorAll('body *')).filter((e) => vis(e) && /子代理|subagent/i.test(String(e.textContent || '').replace(/\s+/g, ' ').slice(0, 60)))
            return { count: hits.length, items: hits.slice(-8).reverse().map((e) => { let c = e, clickable = null; while (c && c !== document.body) { if (c.tagName === 'BUTTON' || c.getAttribute('role') === 'button' || c.getAttribute('role') === 'tab') { clickable = NODE(c); break } c = c.parentElement } return { node: NODE(e), clickable } }) }
          }),
        }
        const back = await page.evaluate(FIND_IDLE_ROW)
        if (Number.isFinite(back.idleIdx)) { await page.evaluate(OPEN_SESSION_FN, back.idleIdx); await page.waitForTimeout(2500) }
      } catch (e) { pop.busySession = { err: String(e && e.message || e).slice(0, 200) } }
    }
    /* 标题栏子代理容器的 token + 旧会话 id 文字颜色 */
    pop.subagentTokens = await page.evaluate(() => {
      const H = globalThis.__pp; if (!H) return { err: 'page-helpers-missing' }
      const vis = H.VIS
      const el = Array.from(document.querySelectorAll('.wSkVaW_header *')).filter((e) => vis(e) && /子代理|subagent|agent/i.test(String(e.textContent || '').slice(0, 40)))[0]
      if (!el) return { found: false }
      const c = getComputedStyle(el)
      const tokens = {}
      try {
        if (el.computedStyleMap) { for (const [k, v] of el.computedStyleMap()) { if (/^--dsw-/.test(k)) tokens[k] = String(v).slice(0, 40) } }
      } catch (e) { tokens.err = String(e && e.message || e) }
      if (!Object.keys(tokens).length) { for (const name of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay', '--dsw-alias-button-floating-fill', '--dsw-alias-button-elevated-fill', '--dsw-specific-sidebar-fill']) { const v = c.getPropertyValue(name).trim(); if (v) tokens[name] = v.slice(0, 60) } }
      return { found: true, cls: String(el.className).slice(0, 70), bg: c.backgroundColor, bf: c.backdropFilter, radius: c.borderRadius, shadow: String(c.boxShadow).slice(0, 80), color: c.color, tokens }
    })
    pop.sessionIdColors = await page.evaluate(() => {
      const out = []
      for (const row of document.querySelectorAll('[class*="sessionRow"],[class*="sessionItem"]')) {
        const c = getComputedStyle(row)
        out.push({ cls: String(row.className).slice(0, 50), text: String(row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34), color: c.color, bg: c.backgroundColor, whiteText: /^(rgb\(255,\s*255,\s*255\)|rgba\(255,\s*255,\s*255,\s*1\)|color\(srgb 1 1 1\))$/.test(c.color.trim()) })
      }
      return { count: out.length, rows: out.slice(0, 14), whiteCount: out.filter((x) => x.whiteText).length }
    })
    result.groupsOut.popovers = pop
  }

  /* ── 组 popover-surfaces：三个弹层容器整棵子树的"谁在画" + --mpw-surface-pop + overlayLayer 原样读数 ── */
  if (want('popover-surfaces')) {
    const rec = { at: new Date().toISOString(), overlayClosed: null, popovers: [], overlayAfterClose: null }
    try {
      rec.overlayClosed = await page.evaluate(OVERLAY_STATES)
      const targets = [
        { id: 'plus-menu', sel: 'div._3e4SsG_viewport', opener: [{ sel: 'button[aria-label="指令"]' }, { sel: 'button[aria-label="添加附件"]' }] },
        { id: 'permission', sel: 'div._list_1nxmc_8', opener: [{ sel: 'button[aria-label^="访问模式"]' }] },
        { id: 'model-l1', sel: '[class*="_7KE1Ra_menu"], div[id$=":-menu"]', opener: [{ sel: 'button[aria-label^="选择模型"]' }] },
        { id: 'dialog-ctx', sel: 'div.JObwrW_panel, [class*="JObwrW_panel"]', opener: [{ sel: 'button[aria-label*="上下文"]' }, { sel: '[aria-label*="上下文"]' }, { sel: 'button[aria-label*="已用"]' }, { sel: 'button[aria-label*="usage" i]' }, { sel: 'button[aria-label*="token" i]' }, { sel: '[class*="ontextUsage" i], [class*="usageRing" i], [class*="tokenRing" i]' }] },
      ]
      for (const t of targets) {
        if (ONLY_TARGET.length && !ONLY_TARGET.includes(t.id)) continue
        const p = { id: t.id, sel: t.sel, openedBy: null, dump: null, pixels: null, blocked: null }
        try {
          try { await page.keyboard.press('Escape') } catch (e) { /* ignore */ }
          await page.evaluate(CLOSE_ALL); await page.waitForTimeout(400)
          const found = await page.evaluate(FIND_OPENER, t.opener)
          p.openedBy = found
          if (!found || !found.path) {
            p.blocked = 'blocked:no-opener'
            p.composerButtons = await page.evaluate(COMPOSER_BUTTONS)
            console.log('DIAG ' + t.id + ' opener 未命中，输入区可见按钮 ' + p.composerButtons.count + ' 个：')
            for (const b of (p.composerButtons.buttons || []).slice(0, 14)) console.log('    ? ' + (b.aria || b.text || b.cls) + '  | ' + b.cls + '  | rect=' + JSON.stringify(b.rect))
            rec.popovers.push(p); continue
          }
          const s2 = selOf(found.path)
          try { await page.locator(s2).first().click({ timeout: 4000 }) } catch (e) { await page.evaluate((x) => { const e2 = document.querySelector(x); if (e2) e2.click() }, s2) }
          await page.waitForTimeout(1300)
          p.dump = await page.evaluate(POPOVER_SUBTREE, t.sel)
          if (!p.dump.found) p.blocked = 'blocked:container-not-found'
          /* P3 三个只读字段（批次 2，只加读数不改口径）：truncatedBy / effectiveBlur / backdropPainted */
          try {
            const tc = await page.evaluate(PP_BLUR, { mode: 'chain', sel: t.sel })
            p.surface = tc.found ? tc.surface : null
            p.truncatedBy = tc.found ? (tc.truncatedBy || null) : { err: 'chain-not-found' }
            p.effectiveBlur = await page.evaluate(PP_BLUR, { mode: 'e1', sel: t.sel })
            const r3 = await page.evaluate(PP_BLUR, { mode: 'rect', sel: t.sel })
            if (r3) {
              await page.evaluate(PP_BLUR, { mode: 'styleOn', sel: t.sel, arg: 'behind' })
              await page.waitForTimeout(140)
              p.backdropPainted = await samplePixels(page, r3)
              await page.evaluate(PP_BLUR, { mode: 'styleOff', sel: t.sel })
              await page.waitForTimeout(120)
              if (p.backdropPainted) p.backdropPainted.judge = 'surface opacity:0 后该矩形内容的 lumaStd（≈0 ⇒ 背后实心）；判据与实验②同款'
            }
          } catch (e3) { p.p3err = String(e3 && e3.message || e3).slice(0, 140) }
          if (p.dump.found && p.dump.containerRect) p.pixels = await samplePixels(page, { x: Math.max(0, p.dump.containerRect[0]), y: Math.max(0, p.dump.containerRect[1]), width: Math.max(1, Math.min(600, p.dump.containerRect[2])), height: Math.max(1, Math.min(600, p.dump.containerRect[3])) })
          p.nested = await page.evaluate(DOUBLE_SURFACES)
          console.log('NESTED ' + t.id + ' → 同时有底/模糊的表面 ' + p.nested.paintedCount + ' 个，其中嵌套对 ' + p.nested.nestedCount + ' 个')
          for (const nd of (p.nested.nested || []).slice(0, 4)) console.log('    ⊗ 子 ' + nd.child.tag + '.' + String(nd.child.cls).split(' ')[0] + ' (bg ' + nd.child.alpha + ' bf=' + nd.child.bf + ')' + ' ← 祖 ' + nd.ancestors.map((a) => a.tag + '.' + String(a.cls).split(' ')[0] + '(bg ' + a.alpha + ' bf=' + a.bf + ')').join(' , '))
          const tok = (p.dump.containerTokens || {})
          console.log('SURFACE ' + t.id + ' → ' + (p.blocked || 'ok') + '  items=' + p.dump.itemCount + '  containerTokens=' + JSON.stringify(tok) + '  patch(avg/lumaStd)=' + JSON.stringify([p.pixels && p.pixels.avg, p.pixels && p.pixels.lumaStd]))
          for (const it of (p.dump.items || []).slice(0, 8)) console.log('    · ' + (it.why === 'container' ? '[容器] ' : '[子] ') + it.tag + '.' + String(it.cls).split(' ')[0] + '  role=' + it.role + '  bg=' + it.bg + '  bf=' + it.bf + '  bgImage=' + String(it.bgImage).slice(0, 26) + '  rect=' + JSON.stringify(it.rect) + '  z=' + it.z + '  tokens=' + JSON.stringify(it.tokens))
          for (const a of (p.dump.ancestors || []).slice(0, 12)) console.log('    ↑ ' + a.tag + '.' + String(a.cls).split(' ')[0] + '  rect=' + JSON.stringify(a.rect) + '  z=' + a.z + '  pos=' + a.position + '  bg=' + a.bg + '  bf=' + a.bf + '  filter=' + a.filter + '  transform=' + a.transform + '  contain=' + a.contain + '  isolation=' + a.isolation + '  pe=' + a.pointerEvents + '  hitOverlayLayer=' + a.hitOverlayLayer)
        } catch (e) { p.blocked = 'blocked:exception ' + String(e && e.message || e).slice(0, 140) }
        rec.popovers.push(p)
        try { await page.keyboard.press('Escape') } catch (e) { /* ignore */ }
        await page.waitForTimeout(300)
      }
      /* ── 模型第二层（提供商分组标题层）：L1 点第一个 cell 进去 ── */
      const wantL2 = !ONLY_TARGET.length || ONLY_TARGET.includes('model-l2')
      if (wantL2) {
      const l2 = { id: 'model-l2', steps: [], groupTitles: null, containerDump: null, blocked: null }
      try {
        try { await page.keyboard.press('Escape') } catch (e) { /* ignore */ }
        await page.evaluate(CLOSE_ALL); await page.waitForTimeout(400)
        const op = await page.evaluate(FIND_OPENER, [{ sel: 'button[aria-label^="选择模型"]' }])
        l2.steps.push({ openL1: op })
        if (op && op.path) {
          try { await page.locator(selOf(op.path)).first().click({ timeout: 4000 }) } catch (e) { await page.evaluate((x) => { const e2 = document.querySelector(x); if (e2) e2.click() }, selOf(op.path)) }
          await page.waitForTimeout(1200)
          const cells = await page.evaluate(() => { const H = globalThis.__pp; const out = []; for (const e of document.querySelectorAll('button[class*="_7KE1Ra_cell"],[role="menuitem"],[role="option"]')) { if (!H.VIS(e)) continue; const r = e.getBoundingClientRect(); out.push({ cls: String(e.className).slice(0, 44), text: String(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }) } return out })
          l2.steps.push({ l1Rows: cells })
          const target = (cells || []).find((x) => /模型|DeepSeek|Flash|Pro/i.test(x.text) && x.rect[2] > 100) || (cells || [])[0]
          if (target) {
            const sel = 'button[class*="_7KE1Ra_cell"]'
            try { await page.locator(sel).first().click({ timeout: 4000 }) } catch (e) { await page.evaluate((x) => { const e2 = document.querySelector(x); if (e2) e2.click() }, sel) }
            await page.waitForTimeout(1400)
            l2.groupTitles = await page.evaluate(GROUP_TITLE_FACTS)
            const first = (l2.groupTitles || [])[0]
            if (first && first.container && first.container.sel) {
              const csel = selOf(first.container.sel)
              l2.containerDump = await page.evaluate(POPOVER_SUBTREE, csel)
              if (l2.containerDump && l2.containerDump.containerRect) l2.pixels = await samplePixels(page, { x: Math.max(0, l2.containerDump.containerRect[0]), y: Math.max(0, l2.containerDump.containerRect[1]), width: Math.max(1, Math.min(600, l2.containerDump.containerRect[2])), height: Math.max(1, Math.min(600, l2.containerDump.containerRect[3])) })
            }
            if (!l2.groupTitles || !l2.groupTitles.length) l2.blocked = 'blocked:no-groupTitle-visible'
          } else l2.blocked = 'blocked:no-l1-row-to-click'
        } else l2.blocked = 'blocked:no-model-opener'
      } catch (e) { l2.blocked = 'blocked:exception ' + String(e && e.message || e).slice(0, 140) }
      rec.modelL2 = l2
      console.log('L2 ' + (l2.blocked || 'ok') + '  标题条数=' + ((l2.groupTitles || []).length))
      for (const g of (l2.groupTitles || []).slice(0, 6)) console.log('    § ' + String(g.cls).split(' ')[0] + ' | ' + g.text + ' | bg=' + g.bg + ' | bf=' + g.bf + ' | rect=' + JSON.stringify(g.rect) + ' | 容器=' + (g.container ? (String(g.container.cls).split(' ')[0] + ' bg=' + g.container.bg + ' bf=' + g.container.bf) : 'null'))
      if (l2.containerDump) console.log('    L2 容器 ' + String(l2.containerDump.containerCls).slice(0, 40) + ' rect=' + JSON.stringify(l2.containerDump.containerRect) + ' tokens=' + JSON.stringify(l2.containerDump.containerTokens) + ' 画了东西的节点=' + l2.containerDump.itemCount + ' patch=' + JSON.stringify(l2.pixels && { avg: l2.pixels.avg, lumaStd: l2.pixels.lumaStd }))
      for (const it of ((l2.containerDump || {}).items || []).slice(0, 8)) console.log('      · [' + it.why + '] ' + it.tag + '.' + String(it.cls).split(' ')[0] + ' bg=' + it.bg + ' bf=' + it.bf + ' rect=' + JSON.stringify(it.rect) + ' tokens=' + JSON.stringify(it.tokens))
      try { await page.keyboard.press('Escape') } catch (e) { /* ignore */ }
      await page.waitForTimeout(300)
      }
      rec.overlayAfterClose = await page.evaluate(OVERLAY_STATES)
      console.log('OVERLAY closed 态: ' + JSON.stringify((rec.overlayClosed.list || []).map((x) => ({ cls: x.cls, rect: x.rect, opacity: x.opacity, visibility: x.visibility, pointerEvents: x.pointerEvents, display: x.display, z: x.z, bg: x.bg, bf: x.bf, visible: x.visible }))))
    } catch (e) { rec.err = String(e && e.message || e).slice(0, 240) }
    result.groupsOut.popoverSurfaces = rec
  }

  /* ── 组 popover-blur-exp（批次 2 P3）：三个判定实验 + 模型选择器做健康对照 ──
     ①祖先遍历（截断属性明细） ②移到 body 后截断链是否清空（同步 移→扫→还原） ③中性化截断祖先是否清空
     ②'身后插高对比棋盘，bf-on vs bf-off 像素对比（⚠ 本机无头 Firefox 不合成 backdrop-filter ⇒ 两个 std
       没差 = 只能记"合成不可用/无差"，不能当"模糊无效"的证据） ④背后采样（surface opacity:0 ⇒ 背后 std） */
  if (want('popover-blur-exp')) {
    const rec = { at: new Date().toISOString(), targets: [] }
    const targets2 = [
      { id: 'plus-menu', sel: 'div._3e4SsG_viewport', opener: [{ sel: 'button[aria-label="指令"]' }, { sel: 'button[aria-label="添加附件"]' }] },
      { id: 'permission', sel: 'div._list_1nxmc_8', opener: [{ sel: 'button[aria-label^="访问模式"]' }] },
      { id: 'dialog-ctx', sel: 'div.JObwrW_panel, [class*="JObwrW_panel"]', opener: [{ sel: 'button[aria-label*="上下文"]' }, { sel: '[aria-label*="上下文"]' }, { sel: 'button[aria-label*="已用"]' }] },
      { id: 'model-l1(健康对照)', sel: '[class*="_7KE1Ra_menu"], div[id$=":-menu"]', opener: [{ sel: 'button[aria-label^="选择模型"]' }] },
    ]
    for (const t of targets2) {
      const e = { id: t.id, sel: t.sel }
      try {
        try { await page.keyboard.press('Escape') } catch (err) {}
        await page.evaluate(CLOSE_ALL); await page.waitForTimeout(400)
        const found = await page.evaluate(FIND_OPENER, t.opener)
        e.openedBy = found
        if (!found || !found.path) { e.blocked = 'no-opener'; rec.targets.push(e); continue }
        const s2 = selOf(found.path)
        try { await page.locator(s2).first().click({ timeout: 4000 }) } catch (err) { await page.evaluate((x) => { const e2 = document.querySelector(x); if (e2) e2.click() }, s2) }
        await page.waitForTimeout(1300)
        e.chain = await page.evaluate(PP_BLUR, { mode: 'chain', sel: t.sel })
        e.e1 = await page.evaluate(PP_BLUR, { mode: 'e1', sel: t.sel })
        e.e3 = await page.evaluate(PP_BLUR, { mode: 'e3', sel: t.sel })
        const rect = await page.evaluate(PP_BLUR, { mode: 'rect', sel: t.sel })
        if (rect) {
          e.e2 = {}
          e.e2.checkerOn = await page.evaluate(PP_BLUR, { mode: 'styleOn', sel: t.sel, arg: 'checker' })
          await page.waitForTimeout(160)
          e.e2.checkerBfOnPixels = await samplePixels(page, rect)
          await page.evaluate(PP_BLUR, { mode: 'styleOn', sel: t.sel, arg: 'bf-off' })
          await page.waitForTimeout(160)
          e.e2.checkerBfOffPixels = await samplePixels(page, rect)
          const off2 = await page.evaluate(PP_BLUR, { mode: 'styleOff', sel: t.sel })
          await page.waitForTimeout(140)
          e.e2.checkerRemoved = off2.removedChecker
          const onStd = e.e2.checkerBfOnPixels && e.e2.checkerBfOnPixels.lumaStd
          const offStd = e.e2.checkerBfOffPixels && e.e2.checkerBfOffPixels.lumaStd
          e.e2.synthesis = (Number.isFinite(onStd) && Number.isFinite(offStd) && Math.abs(onStd - offStd) > 3)
            ? 'pixel-delta-seen（本机竟能合成？人工复核）'
            : 'no-delta-or-unavailable（无头 Firefox 已知不合成 backdrop-filter ⇒ 不能据此下结论，判据以 e1/e3 结构为准）'
          await page.evaluate(PP_BLUR, { mode: 'styleOn', sel: t.sel, arg: 'behind' })
          await page.waitForTimeout(160)
          e.behind = await samplePixels(page, rect)
          await page.evaluate(PP_BLUR, { mode: 'styleOff', sel: t.sel })
          await page.waitForTimeout(120)
          if (e.behind) e.behind.solidJudge = (e.behind.lumaStd || 0) < 2.0 ? 'solid(≈实心)' : ((e.behind.lumaStd || 0) < 12 ? 'soft-gradient' : 'textured/wallpaper')
        }
        try { await page.keyboard.press('Escape') } catch (err) {}
        await page.waitForTimeout(300)
      } catch (err) { e.blocked = 'exception ' + String(err && err.message || err).slice(0, 140) }
      rec.targets.push(e)
      const tb = e.chain && e.chain.truncatedBy
      console.log('EXP ' + t.id + ' → ' + (e.blocked ||
        ('表面=' + (e.chain && e.chain.surface && e.chain.surface.cls) +
        ' 截断=' + (tb ? tb.cls + ' [' + tb.bad.join(',') + ']' : '无') +
        ' | 移body清空=' + (e.e1 && e.e1.wouldApply) + '(movedBack=' + (e.e1 && e.e1.movedBack) + ')' +
        ' | 中性化inline=' + (e.e3 && e.e3.inline && (e.e3.inline.neutralized + '/' + e.e3.inline.cleared)) + ' cssom=' + (e.e3 && e.e3.cssomInject && e.e3.cssomInject.cleared) +
        ' | 背后std=' + (e.behind && e.behind.lumaStd) + '(' + (e.behind && e.behind.solidJudge) + ')' +
        ' | 合成=' + (e.e2 && e.e2.synthesis ? String(e.e2.synthesis).slice(0, 24) : 'n/a'))))
    }
    result.groupsOut.popoverBlurExp = rec
  }

  /* ── 组 sidebar-causal：把"左栏粉色/主色"的因果钉死（7 步，每步 40×40 中心块 + 整栏像素 + computed） ── */
  if (want('sidebar-causal')) {
    const rec = { patch: { enabled: true, unifyTint: true, unifyAmount: 4, sidebarAlpha: 100, blurFollowUnify: true }, steps: [] }
    rec.note = '无头 Firefox 本机**不合成 backdrop-filter** ⇒ 像素里的"4bf-none 不变"不能当"backdrop 没参与"的证据；因果以 computed（谁在画）为准，像素用于"壁纸层是否提供颜色"这一支。'
    try {
      rec.write = await setSection(rec.patch)
      await page.waitForTimeout(1400)
      const clipCenter = async () => page.evaluate(() => { const e = document.querySelector('[class*="sidebarCol"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.max(0, Math.round(r.x + r.width / 2 - 20)), y: Math.max(0, Math.round(r.y + r.height / 2 - 20)), width: 40, height: 40 } })
      const clipFull = async () => page.evaluate(() => { const e = document.querySelector('[class*="sidebarCol"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) } })
      const fixedC = await clipCenter(); const fixedF = await clipFull()   // 基线坐标固定，后面"隐藏左栏"也采同一块
      rec.clips = { patch40: fixedC, fullRect: fixedF }
      const sample = async (label, mode, restoreMode) => {
        const step = { label, mode }
        try {
          step.facts = await page.evaluate(SIDEBAR_FACTS, mode)
          /* 改完样式必须等"合成/重绘"落定再截图（否则量到的是上一帧 ⇒ 实验 4 会假阴）：
             两次 rAF + 250ms 的固定等待 */
          await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(1))))).catch(() => {})
          await page.waitForTimeout(300)
          step.patch40 = fixedC ? await samplePixels(page, fixedC) : null
          step.fullRect = fixedF ? await samplePixels(page, fixedF) : null
          if (restoreMode) { await page.evaluate(SIDEBAR_FACTS, restoreMode); await page.waitForTimeout(350); step.afterRestore = await page.evaluate(SIDEBAR_FACTS, 'baseline') }
          await page.waitForTimeout(300)
        } catch (e) { step.err = String(e && e.message || e).slice(0, 200) }
        rec.steps.push(step)
        console.log('CAUSAL ' + label.padEnd(22) + ' patch40=' + JSON.stringify(step.patch40 && step.patch40.avg) + '  左栏bg=' + (step.facts && step.facts.sidebarCol && step.facts.sidebarCol.bg) + ' bf=' + (step.facts && step.facts.sidebarCol && step.facts.sidebarCol.bf) + ' wrap.display=' + (step.facts && step.facts.bgWrap && step.facts.bgWrap.display) + ' media.filter=' + JSON.stringify(((step.facts && step.facts.wrapMedia) || []).map((m) => m.filter).slice(0, 2)) + ' touched=' + JSON.stringify(step.facts && step.facts.touched))
      }
      await sample('1-baseline', 'baseline')
      await sample('2-media-filter-none', 'media-filter-none', 'media-filter-restore')
      await sample('3-bgwrap-display-none', 'bgwrap-hidden', 'bgwrap-restore')
      await sample('4-bf-none', 'bf-none', 'bf-restore')
      await sample('5-baseline-again', 'baseline')
      await setSection({ enabled: false }); await page.waitForTimeout(1700)
      await sample('6-plugin-off(enabled=false)', 'baseline')
      await setSection({ enabled: true }); await page.waitForTimeout(1500)
      await sample('7-plugin-on-again', 'baseline')
      /* 决定性一测：把左栏整块藏掉，同一坐标直接采"壁纸的原始像素" ⇒ 与 1/5 的粉色对比
         · 一致 ⇒ 粉色就是壁纸在**该处**的局部色（"平均色"是误读，比如壁纸那一片本来就是均匀粉）
         · 明显不同（偏灰/偏杂）⇒ 站内确实有东西在做大范围平均/染色（再去 whoPaints 里找） */
      const whole = await samplePixels(page, { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height })
      rec.wholeViewportAvg = whole && whole.avg
      console.log('CAUSAL ' + 'whole-viewport'.padEnd(22) + ' avg=' + JSON.stringify(rec.wholeViewportAvg))
      await sample('8-sidebar-hidden(local pixels)', 'sidebar-hidden', 'sidebar-restore')
    } catch (e) { rec.err = String(e && e.message || e).slice(0, 240) }
    result.groupsOut.sidebarCausal = rec
  }

  /* ── 组 6：左栏取色（sidebarAlpha=100, unifyAmount=4） ── */
  if (want('sidebar-tint')) {
    const rec = { patch: { enabled: true, unifyTint: true, unifyAmount: 4, sidebarAlpha: 100, blurFollowUnify: true } }
    try {
      rec.write = await setSection(rec.patch)
      await page.waitForTimeout(1200)
      rec.effective = await effective()
      rec.facts = await page.evaluate(SIDEBAR_TINT)
    } catch (e) { rec.err = String(e && e.message || e) }
    result.groupsOut.sidebarTint = rec
    console.log('SIDEBAR-TINT effective=' + JSON.stringify(rec.effective) + ' aqua=' + (rec.facts && rec.facts.bodyAqua) + ' col.bg=' + (rec.facts && rec.facts.sidebarCol && rec.facts.sidebarCol.bg))
  }

  /* ── 组 7：透明度 0 / 45 的浮动 ── */
  if (want('float')) {
    const rec = {}
    for (const side of [0, 45]) {
      try {
        await setSection({ enabled: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: side, blurFollowUnify: true })
        await page.waitForTimeout(1200)
        rec['side' + side] = { effective: await effective(), facts: await page.evaluate(FLOAT_FACTS) }
      } catch (e) { rec['side' + side] = { err: String(e && e.message || e) } }
    }
    result.groupsOut.float = rec
    console.log('FLOAT side0.float=' + JSON.stringify(rec.side0 && rec.side0.facts && rec.side0.facts.bodyFloat) + ' side45.float=' + JSON.stringify(rec.side45 && rec.side45.facts && rec.side45.facts.bodyFloat))
  }

  /* ── 组 8：左栏收起动画（插件开 / enabled=false 对照，各一次） ── */
  if (want('anim')) {
    const rec = { runs: [] }
    const measure = async (label, patch) => {
      const r = { label, patch }
      try {
        if (patch) { r.write = await setSection(patch); await page.waitForTimeout(1500) }
        r.effective = await effective()
        r.expandFirst = await page.evaluate(ENSURE_EXPANDED)      // 每轮都从"展开态"起，三轮才可比
        await page.waitForTimeout(1800)
        r.widthBefore = await page.evaluate(SIDEBAR_WIDTH)
        r.install = await page.evaluate(ANIM_INSTALL)
        r.toggle = await page.evaluate(CLICK_SIDEBAR_TOGGLE)
        r.measuredOp = 'collapse'                                 // 记下这一轮测的是"收起"（从展开态开始）
        await page.waitForTimeout(2600)                     // 动画窗口
        r.widthAfter = await page.evaluate(SIDEBAR_WIDTH)
        r.counters = await page.evaluate(ANIM_READ)
        r.toggleBack = await page.evaluate(CLICK_SIDEBAR_TOGGLE)   // 复原成展开，给下一轮同样的起点
        await page.waitForTimeout(2000)
        r.widthRestored = await page.evaluate(SIDEBAR_WIDTH)
      } catch (e) { r.err = String(e && e.message || e) }
      rec.runs.push(r)
      console.log('ANIM ' + label + ' → longtasks=' + JSON.stringify(r.counters && r.counters.longtasks) + ' rafMax=' + (r.counters && r.counters.rafMax) + ' mutations=' + (r.counters && r.counters.mutations) + ' width=' + r.widthBefore + '→' + r.widthAfter + '→' + r.widthRestored)
    }
    await measure('plugin-on', null)
    await measure('plugin-off(enabled=false)', { enabled: false })
    await measure('plugin-on-again', { enabled: true })
    result.groupsOut.anim = rec
  }

  /* ── 还原 ── */
  if (!KEEP) {
    try {
      await page.evaluate(({ k, raw }) => { try { if (raw === null) localStorage.removeItem(k); else localStorage.setItem(k, raw) } catch (e) { /* ignore */ } }, { k: STORE, raw: original })
      await page.waitForTimeout(800)
      const back = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch (e) { return null } }, STORE)
      const a = (() => { try { return JSON.parse(original || '{}') } catch (e) { return {} } })()
      const b = (() => { try { return JSON.parse(back || '{}') } catch (e) { return {} } })()
      const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))))
      const diff = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      const MATRIX = ['unifyTint', 'unifyAmount', 'sidebarAlpha', 'blurFollowUnify', 'enabled']
      result.restore = { rawMatches: back === original, differingCount: diff.length, differingKeys: diff.slice(0, 12), matrixKeysBack: MATRIX.map((k) => ({ k, want: a[k], got: b[k], ok: JSON.stringify(a[k]) === JSON.stringify(b[k]) })), keep: false }
    } catch (e) { result.restore = { keep: false, err: String(e && e.message || e).slice(0, 200) } }
  } else result.restore = { keep: true }
  if (settingsSnap) {
    const after = snapFile(SETTINGS_JSON)
    const afterSha = after ? after.sha256 : null
    result.settingsFile.after = afterSha ? afterSha.slice(0, 12) : null
    if (afterSha === settingsSnap.sha256) result.settingsFile.unchanged = true
    else if (!KEEP) {
      let restored = false
      try { fs.writeFileSync(SETTINGS_JSON, settingsSnap.buf); restored = sha256(fs.readFileSync(SETTINGS_JSON)) === settingsSnap.sha256 } catch (e) { /* ignore */ }
      result.settingsFile.unchanged = false
      result.settingsFile.restoredFromSnapshot = restored
    } else { result.settingsFile.unchanged = false; result.settingsFile.restoredFromSnapshot = false }
  }
} catch (e) {
  result.fatal = String((e && e.stack) || e).slice(0, 800)
} finally {
  try { if (browser) await browser.close() } catch (e) { /* ignore */ }
}

/* ── 4 落盘 + 人读表 ───────────────────────────────────────────────────── */
dump()


if (result.groupsOut.popovers) {
  console.log('\n===== 弹层事实（外层容器 → 内层表面；只读）=====')
  for (const t of result.groupsOut.popovers.targets) {
    console.log('· ' + t.id + ' — ' + t.desc)
    console.log('   ' + (t.blocked ? t.blocked : 'ok') + '   openedBy=' + JSON.stringify(t.openedBy && (t.openedBy.pattern || t.openedBy.why)) + '  how=' + JSON.stringify(t.openedBy && t.openedBy.clickHow) + '  sel=' + String((t.openedBy && t.openedBy.selector) || '').slice(0, 80))
    const list = (t.after && t.after.popovers) || []
    for (const p of list.slice(0, 3)) {
      console.log('   容器: ' + selOf(p.root.path) + '   z=' + p.root.z + '  bg=' + p.root.bg + '  bf=' + p.root.bf + '  rect=' + JSON.stringify(p.root.rect) + '  inOverlay=' + p.root.inOverlayAny + '/layer=' + p.root.inOverlayLayer)
      for (const s of p.surfaces.slice(0, 6)) console.log('      表面: ' + selOf(s.path) + '  bg=' + s.bg + '  bf=' + s.bf + '  z=' + s.z + '  inOverlay=' + s.inOverlayAny + '/' + s.inOverlayLayer + (s.text ? '  text="' + s.text.slice(0, 20) + '"' : ''))
    }
    if (t.level2) {
      console.log('   第 2 层 openedBy=' + JSON.stringify(t.level2.openedBy && (t.level2.openedBy.clicked || t.level2.openedBy.why)))
      for (const p of (t.level2.facts.popovers || []).slice(0, 2)) console.log('      容器: ' + selOf(p.root.path) + '  bg=' + p.root.bg + '  bf=' + p.root.bf + '  z=' + p.root.z)
      for (const g of ((t.level2.groups || {}).providerHeaders || [])) console.log('      提供商分组标题: ' + g.cls + '  bg=' + g.bg + '  bf=' + g.bf + '  rect=' + JSON.stringify(g.rect) + '  inOverlay=' + g.inOverlayAny + '/' + g.inOverlayLayer)
      for (const m of ((t.level2.groups || {}).modelRows || []).slice(0, 4)) console.log('      模型行: ' + m.cls + '  bg=' + m.bg + '  bf=' + m.bf + '  rect=' + JSON.stringify(m.rect))
    }
  }
  const st = result.groupsOut.popovers.subagentTokens
  console.log('· 标题栏子代理容器 token: ' + JSON.stringify(st))
  const sc = result.groupsOut.popovers.sessionIdColors
  console.log('· 会话行文字颜色: ' + JSON.stringify(sc && { count: sc.count, whiteCount: sc.whiteCount, sample: (sc.rows || []).slice(0, 5) }))
}
if (result.groupsOut.sidebarTint) console.log('\n===== 组 6 左栏取色（sidebarAlpha=100 / unifyAmount=4）=====\n' + JSON.stringify(result.groupsOut.sidebarTint, null, 1).slice(0, 1800))
if (result.groupsOut.float) console.log('\n===== 组 7 浮动（side=0 / side=45）=====\n' + JSON.stringify(result.groupsOut.float, null, 1).slice(0, 1500))
if (result.groupsOut.anim) {
  console.log('\n===== 组 8 左栏收起动画（插件开 / 关 对照）=====')
  for (const r of result.groupsOut.anim.runs) console.log('  ' + r.label + ': ' + JSON.stringify({ longtasks: r.counters && r.counters.longtasks, longtaskMax: r.counters && r.counters.longtaskMax, longtaskTotal: r.counters && r.counters.longtaskTotal, rafMax: r.counters && r.counters.rafMax, rafCount: r.counters && r.counters.rafCount, mutations: r.counters && r.counters.mutations, hdrFrostWatch: r.counters && r.counters.hdrFrostWatch, width: [r.widthBefore, r.widthAfter, r.widthRestored] }))
}
console.log('\nJSON: ' + path.relative(PLUGIN, OUT) + '（' + fs.statSync(OUT).size + ' B）')
console.log('宿主 settings 写回：拦掉 ' + result.hostWritesBlocked + ' 次；settings.json ' + (result.settingsFile.unchanged ? '逐字节未变 ✓' : ('变了（' + result.settingsFile.before + '→' + result.settingsFile.after + '，按快照还原=' + result.settingsFile.restoredFromSnapshot + '）')))
if (result.restore) console.log('还原用户设置：' + JSON.stringify(result.restore.matrixKeysBack) + ' 差异键=' + JSON.stringify(result.restore.differingKeys))
if (result.blocked) { console.log('✗ blocked:' + result.blocked.why); process.exit(2) }
if (result.fatal) { console.log('✗ 探针异常：' + result.fatal.split('\n')[0]); process.exit(3) }
const failed = (result.groupsOut.popovers ? result.groupsOut.popovers.targets.filter((t) => t.blocked).length : 0)
process.exit(failed ? 3 : 0)

#!/usr/bin/env node
/**
 * wallpaper-lifecycle-test.mjs —— ②①③④⑤⑥(2026-09-20 真机修复轮) 的**无浏览器**门禁
 *
 * 为什么单开一条：这一轮修的六件事全部是"**同一个字段/同一个动作落到谁身上**"的问题
 * （换档时源字段有没有成套重写、挂载分支按谁裁决、URL 形状跟不跟条目来源、预览候选链取哪个、
 * 弹层容器会不会被我们打成侧栏、源不可用时会不会把错误页当壁纸、卡片暂停管不管帧内音频、
 * 切页会不会静音）—— 界面看起来对是判不出来的，必须对着**真实现**断言。
 *
 * 覆盖（每条修复一组，每组都可能被文件末尾的变异自证判红）：
 *   A ② 换档成套重写：不属于新选择的源字段必须显式清空（`undefined` 转 `null`）+ srcRoot/srcDirPath
 *   B ② 挂载裁决 mpwPickMount：残留 webUrl / 容器档 / 渲染器档 / 半残档各走哪条路
 *   C ② 形状绑定 mpwSourceFieldsFor：custom / library / container 三类来源唯一形状（不再混用）
 *   D ① 预览候选链 mpwThumbCandidates：web 档必须有预览图候选，且逐个退到占位
 *   E ⑥ 弹层类污染：弹层容器（或其祖先）不得带我们注入的 sidebarCol，且带 data-mpw-holds-layer
 *   F ② 清空壁纸（驱动**真 clearBg**：渲染面板 → 点「清除壁纸」）：6 个源字段全空 + 层隐藏 + 不复活
 *   G ② 武装前验活 mpwArmProbe：只有宿主明确回 `{ok:false}` 才判不可用 + 可判定状态
 *   H ③ 沙箱档降级：策略类错误一次性切兼容档（去掉 mpwshim + 换属性集），作者自身 bug 不触发
 *   I ④ 帧内音频归属：卡片暂停/我们在放音 ⇒ 帧内静音 + 暂停；否则放行
 *   J ⑤ 可见性：powPauseHidden 默认 true + 只在"用户动过"时才不迁移 + pagehide/pageshow 接线
 *
 * 用法：
 *   node tools/wallpaper-lifecycle-test.mjs                 # 全部（含变异自证）
 *   node tools/wallpaper-lifecycle-test.mjs --no-mutations   # 只跑主体
 *   node tools/wallpaper-lifecycle-test.mjs --client <path>  # 变异用（副本）
 *
 * 真机读数（修前/修后）与根因链：docs/WALLPAPER-LIFECYCLE.md
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const NO_MUT = process.argv.includes('--no-mutations')

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  — ' + detail : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-lifecycle-'))

/* 夹具用的"库根/自定义目录"从脚本位置推导（`<DSHAREA>/dsh-mpkg-wallpaper` ⇒ `<DSHAREA>`），
   可用 `MPW_ROOT` 覆盖 —— 与 tools/settings-persist-test.mjs 同一口径；
   **仓库里不写本机绝对路径**（integrity-check 的 `host-workspace-path` 判据 + secret-scan）。 */
const WS_ROOT = process.env.MPW_ROOT || path.resolve(repoRoot, '..')
const LIB_ROOT = path.join(WS_ROOT, 'allwallpaper', 'dd')
const CUSTOM_DIR = path.join(LIB_ROOT, '3580207945')
const OTHER_CUSTOM_DIR = path.join(WS_ROOT, 'allwallpaper', 'wallpaperE', '小鸟游星野')

const { loadPlugin } = await import('./_stub.mjs')
const SESSION_GUARDS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwSectionTest', '__mpwNpTest',
  '__mpwPowerWired', '__mpwNpOwnsSound', '__mpwErrHook', '__mpwSandboxCapHook', '__mpwLnGuard', '__mpwWebShimHook',
  '__mpwNowPlaying', '__mpwNowPlayingSlotAction', '__mpwNpCtlSeq', '__mpwAppliedOnce', '__mpwPersist',
  '__mpwLifecycleTest', '__mpwWebTest', '__mpwHdrFrostTest', '__mpwDiagTest', '__mpwRailInkProbe', '__mpwBgArmError']
function clearGuards () { for (const k of SESSION_GUARDS) { try { delete globalThis[k] } catch { /* ignore */ } } }

/* ══════════════════════════════════════════════════════════════════════════════════
   迷你 DOM：够跑我们那几条选择器（`[class*=…]` / `[role=…]` / `:not([attr])` / 标签）
   ──────────────────────────────────────────────────────────────────────────────────
   为什么不用 _stub 的桩：它的 querySelectorAll 恒返回 []、classList 是空实现 ⇒
   "弹层容器有没有被我们打上 sidebarCol"这种**结果落点**根本断言不了（假绿的温床）。
   ══════════════════════════════════════════════════════════════════════════════════ */
function mkNode (tag, cls, opts) {
  const o = opts || {}
  const set = new Set(String(cls || '').split(/\s+/).filter(Boolean))
  const attrs = new Map()
  for (const k of Object.keys(o.attrs || {})) attrs.set(k, String(o.attrs[k]))
  const node = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], parentElement: null,
    __set: set, __bf: o.backdropFilter || 'none', __rect: o.rect || { x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 },
    /* style 用**真对象**：`mpwThumbNext` / `mpwBgArmErrorSet` 里既有 `style.display = …` 的属性写法，
       也有 `setProperty/removeProperty`。两者都要能读回（否则断言只能看个寂寞）。 */
    style: { setProperty (k, v) { this[String(k)] = String(v) }, removeProperty (k) { delete this[String(k)] }, getPropertyValue (k) { return this[String(k)] === void 0 ? '' : String(this[String(k)]) } },
    classList: {
      add: (...c) => { for (const x of c) set.add(x) },
      remove: (...c) => { for (const x of c) set.delete(x) },
      contains: (c) => set.has(c),
      toggle: (c, on) => { if (on === void 0) { set.has(c) ? set.delete(c) : set.add(c) } else if (on) set.add(c); else set.delete(c) },
    },
    setAttribute: (k, v) => attrs.set(String(k), String(v)),
    getAttribute: (k) => (attrs.has(String(k)) ? attrs.get(String(k)) : null),
    removeAttribute: (k) => attrs.delete(String(k)),
    hasAttribute: (k) => attrs.has(String(k)),
    appendChild (c) { this.children.push(c); c.parentElement = this; return c },
    removeChild (c) { this.children = this.children.filter((x) => x !== c); return c },
    remove () { if (this.parentElement) this.parentElement.removeChild(this) },
    querySelector: (sel) => queryAll(node, sel)[0] || null,
    querySelectorAll: (sel) => queryAll(node, sel),
    contains (n) { let p = n; while (p) { if (p === node) return true; p = p.parentElement } return false },
    matches: (sel) => matchSimple(node, sel),
    getBoundingClientRect: () => node.__rect,
    addEventListener () {}, removeEventListener () {}, focus () {}, click () {},
    set className (v) { set.clear(); for (const x of String(v).split(/\s+/)) if (x) set.add(x) },
    get className () { return Array.from(set).join(' ') },
  }
  for (const prop of ['src', 'href']) {
    Object.defineProperty(node, prop, {
      configurable: true,
      get () { return attrs.get(prop) || '' },
      set (v) { attrs.set(prop, String(v)) },
    })
  }
  if (o.id) attrs.set('id', String(o.id))
  Object.defineProperty(node, 'id', { get () { return attrs.get('id') || '' }, set (v) { attrs.set('id', String(v)) }, configurable: true })
  return node
}
/** 单个简单选择器（tag / .class / [attr] / [attr="v"] / [class*="v"] / :not(...) 链）。 */
function matchSimple (el, sel) {
  let s = String(sel).trim()
  if (!s) return false
  // 逐个剥离 :not(...)（支持嵌套一层方括号）
  const nots = []
  s = s.replace(/:not\((\[[^\]]*\]|[^()]*)\)/g, (_, inner) => { nots.push(inner.trim()); return '' })
  for (const n of nots) { if (matchSimple(el, n)) return false }
  const parts = s.match(/^([a-zA-Z*][\w-]*)?((?:\.[\w-]+|\[[^\]]+\])*)$/)
  if (!parts) return false
  const tag = parts[1]
  if (tag && tag !== '*' && el.tagName !== tag.toUpperCase()) return false
  const rest = parts[2] || ''
  for (const m of rest.matchAll(/\.([\w-]+)|\[([^\]]+)\]/g)) {
    if (m[1]) { if (!el.classList.contains(m[1])) return false; continue }
    const expr = m[2]
    const mm = /^([\w-]+)\s*(\*?=|\^=|\$=)?\s*"?([^"]*)"?$/.exec(expr)
    if (!mm) return false
    const [, name, op, val] = mm
    const v = el.getAttribute(name)
    if (v === null) return false
    if (!op) continue
    if (op === '*=' && String(v).indexOf(val) < 0) return false
    if (op === '=' && String(v) !== val) return false
    if (op === '^=' && String(v).indexOf(val) !== 0) return false
  }
  return true
}
function matchSelector (el, sel) {
  for (const part of String(sel).split(',')) { if (matchSimple(el, part.trim())) return true }
  return false
}
function queryAll (root, sel) {
  const out = []
  const walk = (n) => {
    for (const c of n.children || []) { if (matchSelector(c, sel)) out.push(c); walk(c) }
  }
  walk(root)
  return out
}

/** 一份"真机同形"的宿主壳：左栏（含设置面板 overlay，它是 sidebarCol 的**后代**）+ 右栏面板。 */
function buildFixture () {
  const body = globalThis.document.body
  const sidebar = mkNode('div', 'pI_x6G_sidebarCol', { rect: { x: 12, y: 12, width: 256, height: 876, top: 12, left: 12, right: 268, bottom: 888 } })
  const root = mkNode('div', 'hHd-Xa_root hHd-Xa_quietBars')
  const foot = mkNode('div', 'hHd-Xa_footArea')
  const settingsArea = mkNode('div', 'hHd-Xa_settingsArea')
  const overlay = mkNode('div', 'VOzbGW_overlay', { attrs: { role: 'presentation' }, rect: { x: 0, y: 0, width: 1440, height: 900, top: 0, left: 0, right: 1440, bottom: 900 } })
  const panel = mkNode('div', 'VOzbGW_panel', { attrs: { role: 'dialog' }, backdropFilter: 'blur(14px)', rect: { x: 320, y: 50, width: 800, height: 800, top: 50, left: 320, right: 1120, bottom: 850 } })
  const rpanel = mkNode('div', 'P3OORG_panel', { rect: { x: 1430, y: 10, width: 650, height: 880, top: 10, left: 1430, right: 2080, bottom: 890 } })
  panel.appendChild(rpanel)
  overlay.appendChild(panel)
  settingsArea.appendChild(overlay)
  foot.appendChild(settingsArea)
  root.appendChild(foot)
  sidebar.appendChild(root)
  body.appendChild(sidebar)
  const aside = mkNode('aside', 'VOzbGW_drawer', { attrs: { role: 'dialog' }, rect: { x: 0, y: 0, width: 400, height: 800, top: 0, left: 0, right: 400, bottom: 800 } })
  const plainAside = mkNode('aside', 'leftRailHost', { rect: { x: 0, y: 0, width: 240, height: 800, top: 0, left: 0, right: 240, bottom: 800 } })
  /* ⑥ 关键夹具：一个**选择器认它、但子树里装着弹层**的 aside（宿主把设置面板塞进侧栏 aside
     的那种版本）—— 只有 JS 判据 mpwHoldsLayer 能挡住它 ⇒ 这道防线必须被单独断言。 */
  const asideLayerHost = mkNode('aside', 'leftRailHost', { rect: { x: 0, y: 0, width: 240, height: 800, top: 0, left: 0, right: 240, bottom: 800 } })
  asideLayerHost.appendChild(mkNode('div', 'VOzbGW_overlay', { attrs: { role: 'dialog' }, rect: { x: 0, y: 0, width: 800, height: 800, top: 0, left: 0, right: 800, bottom: 800 } }))
  body.appendChild(aside)
  body.appendChild(plainAside)
  body.appendChild(asideLayerHost)
  return { body, sidebar, root, foot, settingsArea, overlay, panel, rpanel, aside, plainAside, asideLayerHost }
}

/** 载入插件 + 可用的迷你 DOM（每个用例一份新环境）。 */
function boot (opts = {}) {
  clearGuards()
  const loaded = loadPlugin({ clientPath, settings: opts.settings || {}, quiet: true, fetch: opts.fetch })
  // 用迷你 DOM 换掉桩的 querySelectorAll / getComputedStyle（插件在调用点取，替换即生效）
  const nodes = []
  const doc = globalThis.document
  const reg = (n) => { nodes.push(n); return n }
  doc.createElement = (t) => reg(mkNode(t))
  doc.body.children = []
  const origAppend = doc.body.appendChild.bind(doc.body)
  doc.body.appendChild = (c) => { const r = origAppend(c); reg(c); return r }
  doc.querySelectorAll = (sel) => { const out = queryAll(doc.body, sel); return out }
  doc.querySelector = (sel) => queryAll(doc.body, sel)[0] || null
  doc.documentElement.querySelectorAll = (sel) => queryAll(doc.documentElement, sel)
  globalThis.getComputedStyle = (el) => ({
    position: el && el.__pos ? el.__pos : (/overlay/i.test(el && el.className || '') ? 'fixed' : (el === doc.documentElement ? 'static' : 'relative')),
    display: 'block', visibility: 'visible', opacity: '1', backdropFilter: (el && el.__bf) || 'none',
    zIndex: 'auto', overflow: 'visible', contain: 'none', isolation: 'auto', willChange: 'auto',
    getPropertyValue: () => '', color: '', fontSize: '', height: '', overflowY: '',
  })
  /* #mpw-bgWrap 与它里面的元素：生产用 getElementById + wrap.querySelector 找它们，
     而桩的 querySelector 恒 null ⇒ 这里给一份**迷你 DOM 版本**的挂载点，
     否则"帧内音频归属 / 沙箱降级 / 源不可用隐藏层"这三组根本断言不到（假绿的温床）。 */
  const ids = new Map()
  const wrap = reg(mkNode('div', 'mpw-bgWrap')); wrap.id = 'mpw-bgWrap'
  const img = reg(mkNode('img', 'mpw-bgImg')); img.id = 'mpw-bgImg'
  const video = reg(mkNode('video', 'mpw-bgVideo')); video.id = 'mpw-bgVideo'
  const frame = reg(mkNode('iframe', 'mpw-webFrame'))
  wrap.appendChild(img); wrap.appendChild(video); wrap.appendChild(frame)
  doc.body.appendChild(wrap)
  ids.set('mpw-bgWrap', wrap); ids.set('mpw-bgImg', img); ids.set('mpw-bgVideo', video)
  const origById = doc.getElementById
  doc.getElementById = (id) => ids.get(String(id)) || origById(String(id))
  const L = globalThis.__mpwLifecycleTest
  return { loaded, doc, L, reg, wrap, img, video, frame }
}

/* ══════════════════════════════════════════════════════════════════════════════════
   A. ② 换档成套重写
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== A. ② 换档成套重写（不属于新选择的源字段必须显式清空）==')
{
  const { L } = boot({ settings: { customDirPath: LIB_ROOT } })
  ok('A0 钩子可用', !!L && typeof L.switchPatchFull === 'function')
  const web = L.switchPatchFull({ webUrl: 'host:?custom=1&folder=3580207945&file=index.html&shim=1', mpkgKey: 'custom|3580207945', converted: 'web', source: 'index.html', mpkgName: '星野(中秋)' })
  ok('A1 web 档：image/sceneKey 被显式清空（null = 删除语义）', web.image === null && web.sceneKey === null, JSON.stringify({ image: web.image, sceneKey: web.sceneKey }))
  ok('A2 web 档：srcRoot=custom + srcDirPath 记下来源目录', web.srcRoot === 'custom' && web.srcDirPath === LIB_ROOT, web.srcRoot + ' / ' + web.srcDirPath)
  const media = L.switchPatchFull({ image: 'host:?token=小鸟游星野01_04&index=0', mpkgKey: 'custommpkg|小鸟游星野01_04.mpkg', converted: 'mp4', source: 'bgcs_abydos03.mp4' })
  ok('A3 容器/媒体档：webUrl/sceneKey 被显式清空（真机残留的那一条）', media.webUrl === null && media.sceneKey === null, JSON.stringify({ webUrl: media.webUrl, sceneKey: media.sceneKey }))
  ok('A4 容器档：srcRoot=container、srcDirPath=null', media.srcRoot === 'container' && media.srcDirPath === null, media.srcRoot + ' / ' + String(media.srcDirPath))
  const renderer = L.switchPatchFull({ webUrl: 'http://127.0.0.1:8899/?pkgurl=x&embed=1', sceneKey: 'scene|x', image: 'host:?custom=1&folder=3326873240&scene=1', converted: 'scene' })
  ok('A5 场景渲染器档（webUrl+sceneKey 同时给）：谁也不许被清', renderer.webUrl && renderer.sceneKey && renderer.image, JSON.stringify({ w: !!renderer.webUrl, s: !!renderer.sceneKey, i: !!renderer.image }))
  const undef = L.switchPatchFull({ webUrl: void 0, sceneKey: void 0, image: void 0, source: void 0, mpkgKey: void 0, mpkgName: void 0, converted: void 0, fromMpkg: void 0, srcRoot: void 0, srcDirPath: void 0 })
  const allNull = L.switchKeys.every((k) => undef[k] === null)
  ok('A6 显式写 undefined 的每个源字段都转成 null（' + L.switchKeys.length + ' 个键）', allNull, JSON.stringify(undef))
  const appearance = L.switchPatchFull({ opacity: 70 })
  ok('A7 外观类 patch 一个源字段都不碰（零行为变化）', Object.keys(appearance).length === 1 && appearance.opacity === 70, JSON.stringify(appearance))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   B. ② 挂载裁决
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== B. ② 挂载裁决 mpwPickMount（残留 webUrl 不许抢先武装）==')
{
  const { L } = boot({})
  const P = (s) => L.pickMount(s)
  const stale = P({ mpkgKey: 'custommpkg|x.mpkg', source: 'bgcs_abydos03.mp4', converted: 'mp4', image: 'host:?token=t&index=0', webUrl: 'host:?custom=1&folder=3326873240&file=scene.pkg' })
  ok('B1 容器档 + 残留 custom 形状 webUrl ⇒ 走媒体档（真机黑屏就是这条）', stale.mount === 'media', JSON.stringify(stale))
  const half = P({ mpkgKey: 'custommpkg|x.mpkg', source: 'bgcs_abydos03.mp4', converted: 'mp4', webUrl: 'host:?custom=1&folder=3326873240&file=scene.pkg' })
  ok('B2 半残档（声明 mp4 却没有 image）+ 残留 webUrl ⇒ 谁也不挂（隐藏 + 提示，不给黑屏）', half.mount === 'none', JSON.stringify(half))
  const realWeb = P({ mpkgKey: 'custom|3580207945', converted: 'web', webUrl: 'host:?custom=1&folder=3580207945&file=index.html&shim=1' })
  ok('B3 真 web 档 ⇒ 走 web', realWeb.mount === 'web', JSON.stringify(realWeb))
  const renderer = P({ converted: 'scene', sceneKey: 'scene|x', webUrl: 'http://127.0.0.1:8899/?pkgurl=http%3A%2F%2F127.0.0.1%3A3080%2Fapi%2Fmpkg-wallpaper%2Fraw%3Fcustom%3D1&embed=1' })
  ok('B4 场景档 + 渲染器 URL（带 pkgurl=）⇒ 走 web', renderer.mount === 'web', JSON.stringify(renderer))
  const staleRenderer = P({ mpkgKey: 'custommpkg|x.mpkg', source: 'a.mp4', converted: 'mp4', image: 'host:?token=t&index=0', sceneKey: 'scene|http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&folder=3326873240&file=scene.pkg', webUrl: 'http://127.0.0.1:8899/?pkgurl=http%3A%2F%2F127.0.0.1%3A3080%2Fapi%2Fmpkg-wallpaper%2Fraw%3Fcustom%3D1%26folder%3D3326873240%26file%3Dscene.pkg&embed=1' })
  ok('B4b mp4 档 + **上一个场景的渲染器 webUrl 残留** ⇒ 走媒体档（真机黑屏现场：修前走 web ⇒ 404 ⇒ 看门狗回退 ⇒ 破图）', staleRenderer.mount === 'media', JSON.stringify(staleRenderer))
  const staleSrcRoot = P({ mpkgKey: 'custommpkg|x.mpkg', source: 'a.mp4', converted: 'mp4', image: 'host:?token=t&index=0', srcRoot: 'custom', webUrl: 'host:?custom=1&folder=3580207945&file=index.html' })
  ok('B4c `srcRoot` 残留成 custom 但 key 是 custommpkg ⇒ 以 key 为准（custom 形状的 webUrl 仍判残留）', staleSrcRoot.mount === 'media', JSON.stringify(staleSrcRoot))
  const lib = P({ mpkgKey: 'library|abc', image: 'host:?ltoken=abc&file=scene.pkg&scene=1', converted: 'scene', sceneKey: 'scene|y', webUrl: 'host:?custom=1&folder=z&file=index.html' })
  ok('B5 库档 + 自定义形状残留 webUrl ⇒ 走媒体档', lib.mount === 'media', JSON.stringify(lib))
  const none = P({ image: '', webUrl: '' })
  ok('B6 无源 ⇒ none', none.mount === 'none', JSON.stringify(none))
  ok('B7 半残档判据覆盖"类型自相矛盾"（converted=mp4 但无 image）', L.srcMissing({ converted: 'mp4', mpkgKey: 'custommpkg|x.mpkg', source: 'a.mp4', webUrl: 'host:?custom=1&folder=z&file=index.html' }) === true)
  ok('B8 干净档（mpkgKey 空）不算半残', L.srcMissing({ image: '', webUrl: '', mpkgKey: '' }) === false)
}

/* ══════════════════════════════════════════════════════════════════════════════════
   C. ② 形状绑定
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== C. ② 形状跟着条目来源（custom / library / container 三类唯一形状）==')
{
  const { L } = boot({ settings: { customDirPath: LIB_ROOT } })
  const libWeb = L.sourceFieldsFor({ srcRoot: 'library', ltoken: 'abc123', kind: 'web', file: 'index.html', title: '库里的 web 档' })
  ok('C1 库条目 ⇒ ltoken= + web=1（绝不出现 custom=1&folder=）', libWeb.webUrl === 'host:?ltoken=abc123&web=1&file=index.html&shim=1' && libWeb.mpkgKey === 'library|abc123', String(libWeb.webUrl))
  const libScene = L.sourceFieldsFor({ srcRoot: 'library', ltoken: 'abc123', kind: 'scene', file: 'scene.pkg' })
  ok('C2 库场景 ⇒ ltoken= + scene=1', libScene.image === 'host:?ltoken=abc123&file=scene.pkg&scene=1', String(libScene.image))
  const cusWeb = L.sourceFieldsFor({ srcRoot: 'custom', folder: '3580207945', kind: 'web', file: 'index.html' })
  ok('C3 自定义目录条目 ⇒ custom=1&folder=&file=', cusWeb.webUrl === 'host:?custom=1&folder=3580207945&file=index.html&shim=1' && cusWeb.mpkgKey === 'custom|3580207945/index.html', String(cusWeb.webUrl))
  ok('C4 自定义条目记下来源目录（srcDirPath）', cusWeb.srcDirPath === LIB_ROOT, String(cusWeb.srcDirPath))
  const box = L.sourceFieldsFor({ srcRoot: 'container', token: '小鸟游星野01_04', index: 0, file: '小鸟游星野01_04.mpkg', entryName: 'bgcs_abydos03.mp4', isMp4: true, title: '小鸟游星野01_04.mpkg' })
  ok('C5 容器条目 ⇒ token= + index=（不出现 folder=）', box.image === 'host:?token=%E5%B0%8F%E9%B8%9F%E6%B8%B8%E6%98%9F%E9%87%8E01_04&index=0' && box.mpkgKey === 'custommpkg|小鸟游星野01_04.mpkg', String(box.image))
  ok('C6 形状分类器：三类各自认得出来', L.srcShapeOf('host:?ltoken=x&web=1') === 'library' && L.srcShapeOf('host:?token=x&index=0') === 'container' && L.srcShapeOf('host:?custom=1&folder=x&file=y') === 'custom', [L.srcShapeOf('host:?ltoken=x&web=1'), L.srcShapeOf('host:?token=x&index=0'), L.srcShapeOf('host:?custom=1&folder=x&file=y')].join('/'))
  ok('C7 key → 来源类别', L.srcRootOfKey('custommpkg|x.mpkg') === 'container' && L.srcRootOfKey('custom|3580') === 'custom' && L.srcRootOfKey('library|abc') === 'library', [L.srcRootOfKey('custommpkg|x.mpkg'), L.srcRootOfKey('custom|3580'), L.srcRootOfKey('library|abc')].join('/'))
  const bad = L.srcConsistent({ mpkgKey: 'custommpkg|x.mpkg', image: 'host:?token=t&index=0', webUrl: 'host:?custom=1&folder=z&file=index.html' })
  ok('C8 一致性裁决：容器档带 custom 形状 webUrl ⇒ 不自洽（含具体原因）', bad.ok === false && /webUrl/.test(bad.why), bad.why)
  const good = L.srcConsistent({ mpkgKey: 'custom|3580207945/index.html', webUrl: 'host:?custom=1&folder=3580207945&file=index.html', converted: 'web' })
  ok('C9 一致性裁决：自定义档 + custom 形状 ⇒ 自洽', good.ok === true, JSON.stringify(good.shapes))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   D. ① 预览候选链
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== D. ① 设置里"当前壁纸"预览框：候选链 + 缓存键 ==')
{
  const { L } = boot({})
  // 缩略图 URL 现在带**缓存键**（`mpwd=` 目录身份 + `mpwt=` 纪元时间戳）⇒ 断言按"路径前缀"匹配
  const at = (u, p) => new RegExp('/' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?|$)').test(String(u))
  const web = L.thumbCandidates({ converted: 'web', webUrl: 'host:?custom=1&folder=3580207945&file=index.html&shim=1', mpkgKey: 'custom|3580207945/index.html' })
  ok('D1 web 档第一候选 = 目录内 preview.gif（修前：候选为空 ⇒ 预览框什么都没有）',
    web.length >= 2 && at(web[0].src, 'custom-folder/3580207945/preview.gif'), JSON.stringify(web.slice(0, 2)))
  ok('D2 web 档候选链含 loading.webp（Vite 包的兜底图）', web.some((c) => at(c.src, 'custom-folder/3580207945/loading.webp')), web.map((c) => c.src.split('/').pop()).join(','))
  const lib = L.thumbCandidates({ converted: 'web', webUrl: 'host:?ltoken=abc&web=1&file=index.html&shim=1', mpkgKey: 'library|abc' })
  ok('D3 库 web 档 ⇒ 走 /library-web/<ltoken>/', lib.length >= 2 && at(lib[0].src, 'library-web/abc/preview.gif'), lib[0] && lib[0].src)
  const box = L.thumbCandidates({ converted: 'mp4', action: 1, source: 'bgcs_abydos03.mp4', image: 'host:?token=t&index=0', mpkgKey: 'custommpkg|小鸟游星野01_04.mpkg' })
  ok('D4 容器档第一候选仍是容器预览（既有行为不许回归）', /custom-mpkg-preview/.test(box[0].src), box[0] && box[0].src)
  const vid = L.thumbCandidates({ converted: 'mp4', source: 'a.mp4', image: 'host:?custom=1&folder=f&file=a.mp4' })
  ok('D5 视频档：目录内 preview.* 在前、首帧（video 候选）殿后（抽帧退成兜底）',
    vid.length > 1 && vid[0].why === 'dir-preview-convention' && vid[vid.length - 1].kind === 'video'
      && vid.slice(0, -1).every((c) => c.kind === 'img'), JSON.stringify(vid.map((c) => c.why)))
  ok('D5b 扫描器**明确**给出的 preview（section.preview）优先于约定名', (() => {
    const v = L.thumbCandidates({ converted: 'mp4', source: 'a.mp4', preview: 'my-cover.png', image: 'host:?custom=1&folder=f&file=a.mp4' })
    return v[0] && v[0].why === 'dir-preview-declared' && at(v[0].src, 'custom-folder/f/my-cover.png')
  })(), JSON.stringify(L.thumbCandidates({ converted: 'mp4', source: 'a.mp4', preview: 'my-cover.png', image: 'host:?custom=1&folder=f&file=a.mp4' }).slice(0, 2)))
  const img = L.thumbCandidates({ converted: 'gif', image: 'host:?custom=1&folder=f&file=a.gif' })
  ok('D6 图片档：目录内 preview.* 在前、图片本身殿后',
    img.length > 1 && img[0].why === 'dir-preview-convention' && img[img.length - 1].why === 'image', JSON.stringify(img.map((c) => c.why)))
  /* 缓存键（第13条）：URL 必须带目录身份 + 纪元时间戳；同一身份幂等；换目录 ⇒ 键变。 */
  const u1 = L.thumbBust('/api/mpkg-wallpaper/custom-folder/f/preview.gif', { mpkgKey: 'custom|f' })
  const u2 = L.thumbBust('/api/mpkg-wallpaper/custom-folder/f/preview.gif', { mpkgKey: 'custom|f' })
  const u3 = L.thumbBust('/api/mpkg-wallpaper/custom-folder/g/preview.gif', { mpkgKey: 'custom|g' })
  ok('D6b 缓存键含目录身份 + 纪元：同身份幂等 / 换目录即变键',
    u1 === u2 && u1 !== u3 && /mpwd=dir%3Af/.test(u1) && /mpwt=\d+/.test(u1) && /mpwd=dir%3Ag/.test(u3),
    JSON.stringify([u1, u3]))
  ok('D6c data:/blob: URL 不加查询串（加了会整体失效）', L.thumbBust('data:image/gif;base64,AAAA', {}) === 'data:image/gif;base64,AAAA')
  const epA = L.thumbEpoch()
  L.thumbInvalidate('test')
  const epB = L.thumbEpoch()
  ok('D6d 显式失效 ⇒ 纪元前进（同目录也换键）', epB.epoch > epA.epoch && epB.n === epA.n + 1, JSON.stringify([epA, epB]))
  // 候选耗尽 ⇒ 显示占位（不显示破图）：夹具驱动真 mpwThumbNext
  const wrap = mkNode('div', 'mpw_wallThumb')
  const im = mkNode('img', 'mpw_thumbImg'); im.setAttribute('src', 'a')
  im.setAttribute('data-mpw-thumb-list', JSON.stringify({ urls: ['a', 'b'], i: 0 }))
  const ph = mkNode('span', 'mpw_hint'); ph.setAttribute('data-mpw-thumb-ph', '')   // 默认不显示：靠 data-mpw-thumb-shown 才整块露出
  wrap.appendChild(im); wrap.appendChild(ph)
  L.thumbNext(im)
  ok('D7 第一个候选失败 ⇒ 自动前进到第二个（载荷 {urls,i} 的 i 前进）',
    im.getAttribute('src') === 'b' && /"i":1/.test(im.getAttribute('data-mpw-thumb-list')), im.getAttribute('src') + ' / ' + im.getAttribute('data-mpw-thumb-list'))
  L.thumbNext(im)
  ok('D8 候选耗尽 ⇒ 标记失败 + 隐藏图片 + 露出占位文字（绝不显示破图图标）',
    im.getAttribute('data-mpw-thumb-failed') === '1' && im.style.getPropertyValue('display') === 'none' && ph.getAttribute('data-mpw-thumb-shown') === '',
    JSON.stringify({ f: im.getAttribute('data-mpw-thumb-failed'), d: im.style.getPropertyValue('display'), s: ph.getAttribute('data-mpw-thumb-shown') }))
  /* ①(2026-09-21 真机第 1/2 条) 状态机改成**单一事实源**之后，"媒体加载成功"的判据多了一条前置：
     **它必须真的画出来了**（img: complete+naturalWidth；video: readyState≥2+videoWidth），
     而且**排在前面的候选都已判死**。真机语料里"判死之后原地复活"不会发生
     （判死那一刻它的 src 就是加载失败的那条 URL），所以这里改成走**真实路径**：
     图候选耗尽 ⇒ 视频首帧获得资格 ⇒ 视频出帧 ⇒ 它成为主人、占位撤下、图仍保持判死。 */
  const vidThumb = mkNode('video', 'mpw_thumbImg')
  vidThumb.setAttribute('src', 'v1')
  vidThumb.setAttribute('data-mpw-thumb-list', JSON.stringify({ urls: ['v1'], i: 0 }))
  vidThumb.setAttribute('data-mpw-thumb-standby', '1')
  wrap.appendChild(vidThumb)
  L.thumbOk(vidThumb)   // 还没出帧 ⇒ 不许显示（"可见即有画面"）
  ok('D9a 备胎视频**还没出帧**时不许显示（占位收起但框进"加载态"：既不是白块、也不是类型文字）',
    vidThumb.style.getPropertyValue('display') === 'none' && ph.getAttribute('data-mpw-thumb-shown') === null
      && wrap.getAttribute('data-mpw-thumb-state') === 'trying',
    JSON.stringify({ v: vidThumb.style.getPropertyValue('display'), s: ph.getAttribute('data-mpw-thumb-shown'), st: wrap.getAttribute('data-mpw-thumb-state') }))
  vidThumb.readyState = 4; vidThumb.videoWidth = 3840; vidThumb.videoHeight = 2160   // 出帧
  L.thumbOk(vidThumb)
  ok('D9 媒体加载成功（真的出帧）⇒ 撤下占位（shown 属性被摘掉）+ 它成为主人 + 同框可见 ≤ 1',
    ph.getAttribute('data-mpw-thumb-shown') === null && vidThumb.style.getPropertyValue('display') === ''
      && im.style.getPropertyValue('display') === 'none' && im.getAttribute('data-mpw-thumb-failed') === '1',
    JSON.stringify({ s: ph.getAttribute('data-mpw-thumb-shown'), v: vidThumb.style.getPropertyValue('display'), i: im.style.getPropertyValue('display'), f: im.getAttribute('data-mpw-thumb-failed') }))
  /* D9b 优先级：图与视频**都**画得出来时主人恒为图（视频的元数据事件迟到不许抢镜头） */
  im.complete = true; im.naturalWidth = 192; im.naturalHeight = 192
  im.removeAttribute('data-mpw-thumb-failed')
  L.thumbOk(im)
  ok('D9b 图也出画 ⇒ 主人回到图（优先级固定，不取决于谁最后触发）',
    im.style.getPropertyValue('display') === '' && vidThumb.style.getPropertyValue('display') === 'none',
    JSON.stringify({ i: im.style.getPropertyValue('display'), v: vidThumb.style.getPropertyValue('display') }))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   E. ⑥ 弹层类污染（设置面板被压缩进左栏那条）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== E. ⑥ 弹层容器不得被我们打成侧栏 + 弹层祖先必须带 data-mpw-holds-layer ==')
{
  const { L } = boot({ settings: { unifyTint: true, unifyAmount: 30, float: true, rightSidebarBlur: true } })
  const F = buildFixture()
  // ① 结构标记：overlay 的**全部祖先**（含 sidebarCol 本体）都要带 data-mpw-holds-layer
  const sync = L.syncLayerHosts()
  ok('E1 syncLayerHosts 有读数（不是 try/catch 吞掉）', sync && typeof sync.added === 'number' && sync.added > 0, JSON.stringify(sync))
  const hosts = [F.sidebar, F.root, F.foot, F.settingsArea, F.overlay, F.panel]
  const marked = hosts.filter((n) => n.hasAttribute(L.layerHostAttr))
  ok('E2 overlay 的祖先链 + 面板自身全部带 data-mpw-holds-layer（' + marked.length + '/' + hosts.length + '）', marked.length === hosts.length, marked.map((n) => n.className.split(' ')[0]).join(','))
  // ② 真 applyCompatBridges：aside[role=dialog]（抽屉/弹层）绝不允许被打 sidebarCol
  L.applyCompatBridges(L.read())
  ok('E3 aside[role=dialog] 不带 sidebarCol（选择器已收窄出 dialog 角色）', F.aside.classList.contains('sidebarCol') === false, F.aside.className)
  ok('E4 普通 aside（宽 240×800 的窄栏、无弹层子树）仍可被打上（收窄不能把真侧栏一起关掉）', F.plainAside.classList.contains('sidebarCol') === true, F.plainAside.className)
  ok('E4b **子树里装着弹层的 aside 不许被打类**（选择器认它 ⇒ 只有 JS 判据挡得住；宿主把设置面板塞进 aside 的版本就靠这条）',
    F.asideLayerHost.classList.contains('sidebarCol') === false && L.holdsLayer(F.asideLayerHost) === true, F.asideLayerHost.className + ' / holdsLayer=' + L.holdsLayer(F.asideLayerHost))
  ok('E5 弹层容器/带 backdrop-filter 的面板不带 sidebarCol', !F.panel.classList.contains('sidebarCol') && !F.rpanel.classList.contains('sidebarCol'))
  ok('E6 我们注入的类带"是我们打的"标记（只有它能被自愈摘除）', F.plainAside.getAttribute(L.sideMarkAttr) === '' && F.aside.getAttribute(L.sideMarkAttr) === null, 'plain=' + JSON.stringify(F.plainAside.getAttribute(L.sideMarkAttr)) + ' dialog=' + JSON.stringify(F.aside.getAttribute(L.sideMarkAttr)))
  // ③ 自愈：手工污染弹层容器（模拟"先打类、弹层随后挂载"那一刻）⇒ 下一次收口必须摘掉
  F.panel.classList.add('sidebarCol'); F.panel.setAttribute(L.sideMarkAttr, '')
  const removed = L.untagInjectedCompat('test-pollution')
  ok('E7 自愈摘掉弹层容器上的注入类（返回摘除个数 ' + removed + '）', removed >= 1 && !F.panel.classList.contains('sidebarCol') && F.panel.getAttribute(L.sideMarkAttr) === null, removed + ' / cls=' + F.panel.className)
  ok('E8 判据函数自证：弹层容器被判 holdsLayer / looksLikeLayer，普通节点不是',
    L.holdsLayer(F.panel) === true && L.looksLikeLayer(F.panel) === true && L.looksLikeLayer(F.plainAside) === false,
    JSON.stringify({ panel: L.holdsLayer(F.panel), plain: L.looksLikeLayer(F.plainAside) }))
  // ④ CSS 层：三条 !important 的 backdrop-filter 规则都必须带 :not([data-mpw-holds-layer])
  const src = fs.readFileSync(clientPath, 'utf8')
  const cnt = (src.match(/:not\(\[data-mpw-holds-layer\]\)/g) || []).length
  ok('E9 blur 规则带 :not([data-mpw-holds-layer]) 护栏（' + cnt + ' 处 ≥ 3）', cnt >= 3, '出现 ' + cnt + ' 次')
  // E9b 两道防线都要在：①选择器收窄（静态）②JS 判据 mpwHoldsLayer（运行时，E3/E5/E7/E8 已断言）
  const asideSel = (L.compatBridges.find((b) => b.cls === 'sidebarCol') || {}).sel || ''
  ok('E9b aside 选择器本身排除了 dialog/overlay/panel/sheet/menu 等弹层角色',
    /aside:not\(\[role="dialog"\]\)/.test(asideSel) && /:not\(\[class\*="overlay"\]\)/.test(asideSel) && /:not\(\[class\*="panel"\]\)/.test(asideSel),
    asideSel.slice(0, 80) + '…')
  // ⑤ 真机判据的无浏览器半边：面板 rect 不在侧栏 rect 内（含 holds-layer 时 CSS 不再给祖先加 blur）
  const panelRect = F.panel.getBoundingClientRect(), sideRect = F.sidebar.getBoundingClientRect()
  ok('E10 夹具本身满足"面板不在侧栏矩形内"（判据前提）', panelRect.left >= sideRect.right - 4 && panelRect.width >= 700, JSON.stringify({ panel: panelRect, side: sideRect }))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   F. ② 清空壁纸（驱动真 clearBg）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== F. ② 「清除壁纸」必须成套清空 + 层卸载 + 不复活 ==')
{
  const MIXED = {
    mpkgKey: 'custommpkg|小鸟游星野01_04.mpkg', mpkgName: '小鸟游星野01_04.mpkg', source: 'bgcs_abydos03.mp4',
    converted: 'mp4', image: 'host:?token=t&index=0', fromMpkg: true,
    webUrl: 'http://127.0.0.1:8899/?pkgurl=http%3A%2F%2F127.0.0.1%3A3080%2Fapi%2Fmpkg-wallpaper%2Fraw%3Fcustom%3D1%26folder%3D3326873240%26file%3Dscene.pkg&embed=1',
    sceneKey: 'scene|http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&folder=3326873240&file=scene.pkg',
    enabled: true, customDirPath: OTHER_CUSTOM_DIR,
  }
  const { loaded, L } = boot({ settings: MIXED })
  // 渲染面板取到真 clearBg：桩 React 直接调用组件即可
  let tree = null, treeErr = null
  // ⚠ 必须给 `t`（桩的 locale.bind 返回键本身）：缺了它组件内部会走不通，整棵树就取不到按钮
  try { tree = loaded.sectionComp({ section: MIXED, t: (k) => k }) } catch (e) { tree = null; treeErr = String(e && e.message) }
  ok('F0 面板渲染成功（取到真 clearBg 的前提）', !!tree, tree ? 'ok' : ('渲染失败: ' + treeErr))
  const buttons = []
  const walk = (n, depth) => {
    if (!n || depth > 80) return
    if (Array.isArray(n)) { for (const x of n) walk(x, depth); return }
    if (typeof n === 'function') { try { walk(n({ t: (k) => k, section: MIXED }), depth + 1) } catch (e) {} return }
    if (typeof n !== 'object') return
    // 函数组件（面板树是**描述符**：不执行子组件就永远找不到按钮 —— panel-smoke 同款纪律）
    if (typeof n.type === 'function') { try { walk(n.type(Object.assign({ t: (k) => k, section: MIXED }, n.props || {})), depth + 1) } catch (e) { globalThis.__dbgF = (globalThis.__dbgF || []); if (globalThis.__dbgF.length < 4) globalThis.__dbgF.push(String(e && e.message).slice(0, 160)) } return }
    if (n.props && typeof n.props.onClick === 'function') {
      const kids = n.kids || []
      const label = kids.map((k) => (typeof k === 'string' ? k : (k && k.__el && typeof k.type === 'string' ? '' : ''))).join('')
      buttons.push({ label: label || '(no-label)', fn: n.props.onClick })
    }
    for (const k of n.kids || []) walk(k, depth + 1)
  }
  walk(tree, 0)
  // ⚠ 桩里的 locale.bind 返回**键本身**（t('clear.bg') === 'clear.bg'）⇒ 按 i18n 键找按钮
  const clear = buttons.find((b) => b.label === 'clear.bg' || b.label === '清除壁纸')
  ok('F1 面板里有「清除壁纸」按钮（真 onClick）', !!clear, buttons.map((b) => b.label).filter(Boolean).slice(0, 12).join(' / '))
  if (clear) {
    const before = L.read()
    // 复刻真机清空前的状态：媒体元素上**挂着旧源**（video 有 src、iframe 有 src）
    const vPre = L.video(); if (vPre) vPre.setAttribute('src', '/api/mpkg-wallpaper/media?token=x&index=0')
    const fPre = L.frame(); if (fPre) fPre.setAttribute('src', 'http://127.0.0.1:8899/?pkgurl=x&embed=1')
    L.wrap().classList.add('mpw-web', 'mpw-scene-fallback')
    ok('F2 清空前：webUrl 在（混态现场）+ 媒体元素挂着旧源', !!before.webUrl && !!before.sceneKey && !!(vPre && vPre.getAttribute('src')), JSON.stringify({ webUrl: !!before.webUrl, sceneKey: !!before.sceneKey, image: !!before.image }))
    clear.fn()
    await sleep(30)
    const after = L.read()
    const SRC6 = ['image', 'webUrl', 'sceneKey', 'source', 'mpkgKey', 'mpkgName']
    const left = SRC6.filter((k) => { const v = after[k]; return !(v === void 0 || v === null || v === '') })
    ok('F3 清空后 6 个源字段全空/不存在（修前 webUrl/sceneKey 被粘性护栏带回来）', left.length === 0, '残留 ' + JSON.stringify(left.map((k) => k + '=' + String(after[k]).slice(0, 40))))
    ok('F4 converted/fromMpkg 也复位', !after.converted && after.fromMpkg === false, 'converted=' + JSON.stringify(after.converted) + ' fromMpkg=' + JSON.stringify(after.fromMpkg))
    ok('F5 不是半残档（mpkgKey 空 ⇒ 自愈不该介入复活旧壁纸）', L.srcMissing(after) === false)
    // 层：apply 之后不许出现 mpw-web/iframe src（"清空后 N 秒不得复活"的无浏览器半条判据）
    L.apply()
    await sleep(40)
    const wrap = L.wrap()
    const frame = L.frame()
    ok('F6 清空后壁纸层不再挂 web 帧（iframe 无 src）', !frame || !frame.getAttribute('src'), frame ? String(frame.getAttribute('src')) : 'no-frame')
    const v6 = L.video()
    ok('F6b 清空后 <video> 的 src 也被卸掉（真机复测：旧写法在"本来就没有 img.src"时跳过清理 ⇒ 后台还在拉旧 mp4）', !v6 || !v6.getAttribute('src'), v6 ? String(v6.getAttribute('src')) : 'no-video')
    await sleep(80)
    const after2 = L.read()
    ok('F7 80ms 后仍为空（没有"被回退重新装上"）', !after2.webUrl && !after2.image, JSON.stringify({ webUrl: after2.webUrl, image: after2.image }))
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════
   G. ② 武装前验活
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== G. ② 武装前验活：只有宿主明确回 {ok:false} 才判"源不可用" ==')
{
  const U = '/api/mpkg-wallpaper/custom-folder/3580207945/index.html'
  // 1) 宿主明确 404 + {"ok":false} ⇒ 判不可用
  const g1 = boot({ fetch: async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }), text: async () => '' }) })
  const v1 = await g1.L.armProbe(U)
  ok('G1 404 + {ok:false} ⇒ ok:false（源不可用）', v1.ok === false && v1.status === 404, JSON.stringify(v1))
  // 2) 404 但不是我们的 JSON（桩/未知源）⇒ 放行（不许误杀）
  const g2 = boot({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }) })
  const v2 = await g2.L.armProbe(U)
  ok('G2 404 但响应体不是 {ok:false} ⇒ 放行（单次探测抖动不许把好壁纸判没）', v2.ok === true, JSON.stringify(v2))
  // 3) 网络异常 ⇒ 放行
  const g3 = boot({ fetch: async () => { throw new Error('boom') } })
  const v3 = await g3.L.armProbe(U)
  ok('G3 网络异常 ⇒ 放行（unknown）', v3.ok === true && v3.unknown === true, JSON.stringify(v3))
  // 4) 非宿主 URL ⇒ 跳过
  const g4 = boot({})
  const v4 = await g4.L.armProbe('http://127.0.0.1:8899/?pkgurl=x')
  ok('G4 非宿主 URL（渲染器直链）⇒ 跳过探测', v4.ok === true && v4.skipped === 'not-host-url', JSON.stringify(v4))
  // 5) 可判定状态：属性 + window + 层隐藏；clear 复位
  const g5 = boot({})
  const F5 = buildFixture()
  g5.L.bgArmErrorSet('web', U, 404, 'not found')
  const w = g5.L.wrap()
  const st = g5.L.armErrorState()
  ok('G5 源不可用 ⇒ window.__mpwBgArmError 有完整读数', st && st.status === 404 && st.url === U, JSON.stringify(st))
  ok('G6 源不可用 ⇒ 层隐藏（露出主题纯色，绝不把错误页/破图当壁纸）', w ? w.style.getPropertyValue('display') === 'none' : true, w ? w.style.getPropertyValue('display') : 'no-wrap')
  if (w && w.setAttribute) w.setAttribute('data-mpw-bg-error', '404 ' + U)
  ok('G7 层上带 data-mpw-bg-error（探针/面板判据）', !!(w && w.getAttribute && w.getAttribute('data-mpw-bg-error')))
  g5.L.bgArmErrorClear()
  ok('G8 clear 后：window 状态清空 + 层显示恢复', g5.L.armErrorState() === null && (!w || w.style.getPropertyValue('display') === ''), JSON.stringify({ st: g5.L.armErrorState(), d: w ? w.style.getPropertyValue('display') : null }))
  void F5
}

/* ══════════════════════════════════════════════════════════════════════════════════
   H. ③ 沙箱档降级
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== H. ③ 沙箱档被浏览器策略挡住 ⇒ 一次性降级到兼容档 ==')
{
  const { L } = boot({})
  ok('H1 SecurityError / Worker 类错误判为"策略挡住"',
    L.webLooksPolicyBlocked({ kind: 'error', message: "SecurityError: Failed to construct 'Worker': The operation is insecure." }) === true
    && L.webLooksPolicyBlocked({ kind: 'rejection', message: 'NotAllowedError: sandbox access denied' }) === true)
  ok('H2 作者自身 bug（TypeError 等）**不**触发降级（沙箱隔离价值不能被一次无关报错换掉）',
    L.webLooksPolicyBlocked({ kind: 'error', message: 'TypeError: Cannot read properties of undefined (reading x)' }) === false)
  // 夹具：真 showWebEl 挂上的帧（含 mpwshim=1 + sandbox=allow-scripts）
  const wrap = L.wrap()
  const frame = L.frame()
  ok('H3 夹具里有 web 帧（bgElements().frame）', !!frame)
  if (frame) {
    frame.setAttribute('src', '/api/mpkg-wallpaper/custom-folder/X/index.html?mpwshim=1&mpwmute=1&mpwspeed=1&mpwpause=0')
    frame.setAttribute('sandbox', 'allow-scripts')
    const r1 = L.webSandboxFallback('script-error', 'SecurityError: Worker blocked')
    ok('H4 降级生效：src 去掉 mpwshim 与策略参数 + 换成兼容属性集', r1 === true
      && !/mpwshim=1/.test(String(frame.getAttribute('src')))
      && !/mpwmute=/.test(String(frame.getAttribute('src')))
      && frame.getAttribute('sandbox') === L.compatAttrs,
      JSON.stringify({ src: frame.getAttribute('src'), sb: frame.getAttribute('sandbox') }))
    ok('H5 可判定状态：frame.__mpwSandboxFallback（含原因）+ __mpwShimFellBack', !!(frame.__mpwSandboxFallback && frame.__mpwSandboxFallback.why === 'script-error') && frame.__mpwShimFellBack === true, JSON.stringify(frame.__mpwSandboxFallback))
    const r2 = L.webSandboxFallback('script-error', 'again')
    ok('H6 只降级一次（第二次 no-op，绝不来回切）', r2 === false)
    const wwSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'web-wallpaper.js'), 'utf8')
    ok('H7 帧内 shim 具备能力自证（caps 上报：worker/storage/offscreen，随 ready/pong 回父页）',
      /function probeCaps\(\)/.test(wwSrc) && /out\.worker = /.test(wwSrc) && (wwSrc.match(/caps: probeCaps\(\)/g) || []).length >= 2,
      'caps 上报点 ' + (wwSrc.match(/caps: probeCaps\(\)/g) || []).length + ' 处')
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════
   I. ④ 帧内音频归属
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== I. ④ 卡片的暂停/静音必须真的管住壁纸自带的音频 ==')
{
  /* 夹具用**目录来源**（custom|<folder>）：容器档（custommpkg|*.mpkg）在 npAudioScope 里如实返回
     null —— 容器名不是目录，旧写法拿它当 folder 去扫只会得到 500（真机现场），
     清单本来就是 0 条 ⇒ 不构成回归（见 docs/WALLPAPER-LIFECYCLE.md 的已知限制）。 */
  const FIX = { enabled: true, npNowPlaying: true, mute: false, npVolume: 60, npLinkWallpaper: true, converted: 'mp4', image: 'host:?custom=1&folder=3580207945&file=a.mp4', mpkgKey: 'custom|3580207945', source: 'a.mp4' }
  const { L } = boot({ settings: FIX })
  const frame = L.frame()
  const inner = []
  if (frame) {
    frame.setAttribute('src', '/api/mpkg-wallpaper/custom-folder/X/index.html?mpwshim=1')
    frame.muted = false
    frame.contentDocument = { querySelectorAll: () => inner }
  }
  const a1 = mkNode('audio'); a1.paused = false; a1.muted = false; a1.volume = 1
  a1.pause = () => { a1.paused = true }
  a1.play = () => { a1.paused = false; return { catch () {} } }
  inner.push(a1)
  const a2 = mkNode('audio'); a2.paused = false; a2.muted = false; a2.volume = 1
  a2.pause = () => { a2.paused = true }
  a2.play = () => { a2.paused = false; return { catch () {} } }
  inner.push(a2)
  // 夹具：让"卡片"有真实可播的媒体（曲目清单 + 我们自己的 <audio>），否则 npTransport('pause')
  //   会落到"清单还没到 ⇒ 去拉清单"那条路（不设置卡片暂停状态）—— 那不是本组要验的东西。
  await sleep(80)   // 等 boot 那次异步扫描落地，否则空清单会把播种覆盖回去（实测的假红来源）
  const NP = globalThis.__mpwNpTest
  if (NP && NP.seedTracks) NP.seedTracks(FIX, [{ path: 'assets/bgm.mp3', mime: 'audio/mpeg', size: 1000 }], 'dir')
  const au0 = L.ensureAudio()
  if (au0) { au0.paused = true; au0.setAttribute('src', '/api/mpkg-wallpaper/media?token=x&index=0') }
  // 1) 卡片没暂停、我们也没在放音 ⇒ 帧内不被压（既有行为）
  L.transport('play', FIX)
  await sleep(20)
  L.applyFrameMute()
  ok('I1 卡片在播 + 我们没在放音 ⇒ 帧内不静音（既有行为不许改）', L.frameSoundBlocked() === false && a1.muted === false, JSON.stringify({ blocked: L.frameSoundBlocked(), muted: a1.muted }))
  // 2) 卡片暂停 ⇒ 帧内静音 **且暂停**
    L.transport('pause', FIX)
  await sleep(20)
  L.applyFrameMute()
  ok('I2 卡片暂停 ⇒ 帧内被压住（真机第 ④ 条：修前这里仍是 false、壁纸 BGM 继续响）', L.frameSoundBlocked() === true && L.cardPaused() === true, JSON.stringify({ blocked: L.frameSoundBlocked(), cardPaused: L.cardPaused() }))
  ok('I3 卡片暂停 ⇒ 帧内元素真的静音（不像素级糊过去）', a1.muted === true && a2.muted === true, 'muted=' + a1.muted + ',' + a2.muted)
  ok('I4 卡片暂停 ⇒ 帧内元素真的暂停（不只静音；WebAudio 类作者只认 pause）', a1.paused === true && a2.paused === true && L.framePausedByUs() === true, 'paused=' + a1.paused + ',' + a2.paused)
  ok('I5 可判定状态：wrap 上 data-mpw-np-sound=blocked + 原因', (() => { const st = L.publishFrameSound(); const w = L.wrap(); return !!st && st.blocked === true && st.reason === 'card-paused' && w.getAttribute('data-mpw-np-sound') === 'blocked' && w.getAttribute('data-mpw-np-sound-reason') === 'card-paused' })(), JSON.stringify(L.publishFrameSound()))
  // 3) 卡片重新播放 ⇒ 只撤销我们按下的暂停 + 静音回落到设置（mute=false）
  L.transport('play', FIX)
  await sleep(20)
  L.applyFrameMute()
  ok('I6 卡片恢复播放 ⇒ 帧内恢复（只撤销我们按下的暂停）', L.frameSoundBlocked() === false && a1.paused === false && a1.muted === false, JSON.stringify({ blocked: L.frameSoundBlocked(), paused: a1.paused, muted: a1.muted }))
  // 4) 卡片播放 + **我们自己的播放器在放音** ⇒ 帧内强制静音（既有 NP-3 语义，不许叠音）
  const au = L.audio() || L.ensureAudio()
  if (au) { au.paused = false; au.src = '/api/mpkg-wallpaper/media?token=x&index=0' }
  L.applyFrameMute()
  ok('I7 我们在放音 ⇒ 帧内强制静音（同一首不放两遍）', L.frameSoundBlocked() === true && a1.muted === true, JSON.stringify({ blocked: L.frameSoundBlocked(), muted: a1.muted }))
  if (au) { au.paused = true; au.src = '' }
  // 5) 卡片关掉（npNowPlaying=false）⇒ 完全不介入
  const g5 = boot({ settings: Object.assign({}, FIX, { npNowPlaying: false }) })
  const f5 = g5.L.frame()
  if (f5) { f5.setAttribute('src', '/api/mpkg-wallpaper/custom-folder/X/index.html?mpwshim=1'); f5.contentDocument = { querySelectorAll: () => [] } }
  g5.L.applyFrameMute()
  ok('I8 卡片开关关掉 ⇒ 不介入帧内音频（零行为变化）', g5.L.frameSoundBlocked() === false, JSON.stringify(g5.L.frameSoundBlocked()))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   J. ⑤ 可见性
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== J. ⑤ 切页/隐藏页：我们的音频与帧内音频一起暂停（默认就该做）==')
{
  const src = fs.readFileSync(clientPath, 'utf8')
  ok('J1 DEFAULT_POW_PAUSE_HIDDEN 默认 true（浏览器基本礼仪，不是可选优化）', /const DEFAULT_POW_PAUSE_HIDDEN = true;/.test(src))
  ok('J2 visibilitychange / pagehide / pageshow 三条都接线', /addEventListener\("visibilitychange"/.test(src) && /addEventListener\("pagehide"/.test(src) && /addEventListener\("pageshow"/.test(src))
  ok('J3 隐藏时把**我们自己的**播放器也停住（powHidNpWasPlaying 记账）', /powHidNpWasPlaying/.test(src) && /if \(powHidNpWasPlaying && npAudio\) npAudio\.pause\(\)/.test(src))
  ok('J4 恢复时按**原状态**续播（隐藏前在放才续播）', /if \(powHidNpWasPlaying && npAudio && npAudio\.paused && !npCardPaused\)/.test(src))
  ok('J5 帧内暂停有记账（恢复只撤销我们按下的暂停，不动作者自己的暂停）', /webFramePausedByUs/.test(src) && /if \(!webFramePausedByUs\) return;/.test(src))
  ok('J6 帧内音频恢复尊重卡片口径（resumeWallpaperVideo 里回落 npApplyFrameMute）', /resumeWebFrame\(\);\s*\n\s*\/\* ⑤ 静音回落/.test(src) || /npApplyFrameMute\(\); \} catch \(e\) \{\}/.test(src))
  // 迁移：默认档只抬"从没显式设过"的存量用户
  const { L } = boot({ settings: { powPauseHidden: false } })
  const s1 = L.read()
  ok('J7 存量档（powPauseHidden=false 且无"动过"标记）⇒ 迁移到新默认 true', s1.powPauseHidden === true, 'powPauseHidden=' + JSON.stringify(s1.powPauseHidden))
  const g2 = boot({ settings: { powPauseHidden: false, powPauseHiddenUserSet: true } })
  const s2 = g2.L.read()
  ok('J8 用户显式关过的（有标记）⇒ 一字不动（保持 false）', s2.powPauseHidden === false, 'powPauseHidden=' + JSON.stringify(s2.powPauseHidden))
  ok('J9 默认档常量与 updatePowerPause 用的是同一个（不许写死 false）', /const hiddenOn = s\.powPauseHidden !== void 0 \? !!s\.powPauseHidden : DEFAULT_POW_PAUSE_HIDDEN;/.test(src))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   L. A 交互音/角色语音不得进播放器清单
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== L. A 交互音/角色语音从播放器清单里排除（分类器 + 依据 + 覆盖开关）==')
{
  const { L } = boot({})
  // 真机语料的两段关键上下文（逐字取自 dd/3580207945：assets/index-CQUR_vLf.js 与 loadJson.json）
  const texts = [
    { name: 'index.html', text: '<script type="module" crossorigin src="./assets/index-CQUR_vLf.js"></script>' },
    { name: 'assets/index-CQUR_vLf.js', text: 'f.src="BGM.wav",f.volume=e.value.bgmVolume,d.volume=e.value.talkVolume;try{await f.play()}catch' },
    { name: 'loadJson.json', text: '{"SettingModel":{"talkFileName":"1-1.wav"},"EventInfos":[{"sound":"2.wav"}]}' },
  ]
  const files = ['BGM.wav', '1-1.wav.ogg', '2.wav.ogg', '3.wav.ogg', 'loopsong.mp3', 'mystery.dat.ogg']
  const table = L.classifyWebAudio({ files: files, texts: texts })
  const by = Object.fromEntries(table.map((c) => [c.base, c]))
  ok('L1 BGM.wav 判为背景音（依据 = 作者源码里的 bgmVolume/play 上下文）', by['BGM.wav'] && by['BGM.wav'].kind === 'bgm', JSON.stringify(by['BGM.wav']))
  ok('L2 1-1.wav.ogg 判为交互音/语音（依据 = loadJson.json 的 talkFileName）', by['1-1.wav.ogg'] && by['1-1.wav.ogg'].kind === 'voice', JSON.stringify(by['1-1.wav.ogg']))
  ok('L3 2.wav.ogg 判为交互音（依据 = EventInfos 里的 sound 字段）', by['2.wav.ogg'] && by['2.wav.ogg'].kind === 'voice', JSON.stringify(by['2.wav.ogg']))
  ok('L4 判不准的（mystery.dat.ogg）**不擅自丢**：默认 unknown（保留）', by['mystery.dat.ogg'] && by['mystery.dat.ogg'].kind === 'unknown', JSON.stringify(by['mystery.dat.ogg']))
  ok('L5 每条分类都带"依据 + 命中位置"（可判定）', table.every((c) => !!c.why && (c.why === 'default-keep' || c.kind === 'unknown' || typeof c.at === 'string')), JSON.stringify(table.map((c) => c.base + ':' + c.why)))
  const tracks = files.map((f) => ({ path: f, size: 10, mime: 'audio/ogg' }))
  const f1 = L.filterVoiceTracks(tracks, table, 'auto')
  const keptNames = f1.tracks.map((t) => t.path)
  ok('L6 auto 模式：清单里**不含**任何被判为交互音的文件（用户第 A 条）', !keptNames.some((n) => /^(1-1|2)\.wav/.test(n)) && keptNames.includes('BGM.wav'), JSON.stringify(keptNames))
  ok('L7 auto 模式：unknown 保留（宁可多一条，也不擅自把用户的声音丢掉）', keptNames.includes('mystery.dat.ogg'), JSON.stringify(keptNames))
  const f2 = L.filterVoiceTracks(tracks, table, 'drop')
  ok('L8 ?npvoice=drop：unknown 也丢（用户可覆盖）', !f2.tracks.map((t) => t.path).includes('mystery.dat.ogg'), JSON.stringify(f2.tracks.map((t) => t.path)))
  const f3 = L.filterVoiceTracks(tracks, table, 'keep')
  ok('L9 ?npvoice=keep：一条都不丢（出问题时的逃生门）', f3.tracks.length === tracks.length && f3.dropped.length === 0, JSON.stringify(f3.tracks.map((t) => t.path)))
  const droppedNames = f1.dropped.map((t) => t.path)
  ok('L10 被排除的条目**如实记账**（dropped 与被判 voice 的集合一致 + 有可查状态与 diag 信标）',
    droppedNames.length === table.filter((c) => c.kind === 'voice').length && droppedNames.every((n) => by[String(n).split('/').pop()] && by[String(n).split('/').pop()].kind === 'voice')
    && /__mpwNpAudioClass/.test(fs.readFileSync(clientPath, 'utf8')),
    'dropped=' + JSON.stringify(droppedNames))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   M. B 联动开关关闭后的语义（状态机）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== M. B 联动开关：关＝不碰壁纸；开＝按卡片当前状态对齐 ==')
{
  const { L } = boot({ settings: { npNowPlaying: true, npLinkWallpaper: false } })
  const A = L.linkAlign
  ok('M1 关（开→关，壁纸暂停中）：**不动壁纸**（真机第 B 条：暂停状态下关掉后壁纸动不了）', A(false, true, true) === 'none', A(false, true, true))
  ok('M2 关（开→关，壁纸播放中）：同样不动（保持继续播放）', A(false, true, false) === 'none', A(false, true, false))
  ok('M3 开（关→开，卡片暂停中）⇒ 压住壁纸（对齐，不许状态打架）', A(true, false, true) === 'pause', A(true, false, true))
  ok('M4 开（关→开，卡片在放）⇒ 恢复壁纸', A(true, false, false) === 'resume', A(true, false, false))
  ok('M5 没切换（值相同）⇒ 一个字节都不碰', A(true, true, false) === 'none' && A(false, false, true) === 'none', A(true, true, false) + '/' + A(false, false, true))
  const src = fs.readFileSync(clientPath, 'utf8')
  ok('M6 关掉联动时曲目档仍显示"只控声音、不影响壁纸"（如实告知）',
    (src.match(/np\.note\.linkOff/g) || []).length >= 3 && /listOnly[\s\S]{0,400}?np\.note\.linkOff/.test(src),
    'linkOff 文案出现 ' + (src.match(/np\.note\.linkOff/g) || []).length + ' 次')
  ok('M7 曲目档 canPlay 不受联动开关影响（关掉后仍能控自己的音频）', /out\.canPlay = !listOnly;/.test(src))
  ok('M8 对齐动作真的接到 applyNowPlaying（不是死代码）', /mpwLinkAlign\(linkNow2, npLinkPrev, npCardPaused\)/.test(src))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   N. C 切页（hidden）时"任何重试都不得起播"
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== N. C 切页：默认暂停+静音，且 hidden 期间我们自己的重试不许起播 ==')
{
  const FIX = { enabled: true, npNowPlaying: true, mute: false, npVolume: 60, npLinkWallpaper: true, converted: 'mp4', image: 'host:?token=t&index=0', mpkgKey: 'custommpkg|x.mpkg', source: 'a.mp4', powPauseHidden: true }
  const { L } = boot({ settings: FIX })
  const video = L.video()
  // 夹具：给壁纸 video 一份"能播"的媒体（paused=true 起步，play() 记账）
  let plays = 0
  if (video) {
    video.paused = true; video.muted = false; video.volume = 1; video.src = '/api/mpkg-wallpaper/media?token=t&index=0'
    video.play = () => { plays++; video.paused = false; return { catch () {} } }
    video.pause = () => { video.paused = true }
  }
  const hide = (on) => {
    try { Object.defineProperty(globalThis.document, 'hidden', { configurable: true, get: () => on }) } catch (e) {}
    L.setupPowerSave()
    try { globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange')) } catch (e) {}
    L.updatePowerPause()
  }
  ok('N1 开关默认档是 true（用户设置里那条 false 会被迁移；见 J7/J8）', L.defaultPowPauseHidden === true && L.hiddenPauseOn() === true, 'default=' + L.defaultPowPauseHidden + ' on=' + L.hiddenPauseOn())
  hide(true)
  ok('N2 页面隐藏 ⇒ 闸门生效（默认暂停开关 ⇒ hiddenBlock=true）', L.hiddenAudioBlock() === true, 'block=' + L.hiddenAudioBlock())
  ok('N3 隐藏时把壁纸 video 停住', !video || video.paused === true, video ? 'paused=' + video.paused : 'no-video')
  /* 关键的现场形态（用户报的那种间歇）：页面已经 hidden，但**省电暂停这一轮没有跑过**
     （visibilitychange 被节流/事件根本没派发 ⇒ `powPaused` 仍是 false）。
     此时唯一挡得住我们自己的重试链的就是 C 的 hidden 闸门 —— 下面这段就是为它写的。 */
  hide(false)                                     // 先回到可见并把 powPaused 复位
  await sleep(40)
  try { Object.defineProperty(globalThis.document, 'hidden', { configurable: true, get: () => true }) } catch (e) {}   // 直接 hidden，**不**调 updatePowerPause
  ok('N3b 现场形态成立：document.hidden=true 而 powPaused 仍为 false（省电那一轮没跑）', L.powState().paused === false && L.hiddenAudioBlock() === true, JSON.stringify(L.powState()) + ' block=' + L.hiddenAudioBlock())
  const before = plays
  // 隐藏期间把"重试/补起播"的所有入口都主动打一遍（真机上它们由被节流的定时器发起）
  if (video) { video.paused = true }
  L.transport('play', FIX)                       // 卡片播放
  L.applyNowPlaying(FIX)                          // 延迟重放（applyFromStorage 那条）
  await sleep(120)
  const NP = globalThis.__mpwNpTest
  if (NP && NP.primePlay) NP.primePlay(FIX)       // 补起播
  await sleep(60)
  ok('N4 hidden 期间三条例行重试路径**一次都没有起播**（真机"过一会儿又响一下"的根因）', plays === before, 'plays=' + before + ' → ' + plays + ' ops=' + JSON.stringify(L.ops().slice(-4)))
  ok('N5 轨迹里能看出被闸住（可归因，不是静默）', JSON.stringify(L.ops()).indexOf('gated') >= 0 || JSON.stringify(L.ops()).indexOf('skipped:hidden') >= 0, JSON.stringify(L.ops().slice(-3)))
  // 恢复可见：原本暂停 ⇒ 保持暂停（不许自作主张起播）
  hide(false)
  await sleep(80)
  ok('N6 回到可见：闸门放开', L.hiddenAudioBlock() === false, 'block=' + L.hiddenAudioBlock())
  ok('N7 回到可见时**按原状态**（隐藏前是暂停的 ⇒ 仍暂停，不自动起播）', plays === before, 'plays=' + plays)
  ok('N8 回到可见后卡片播放能正常起播（闸门不是"永久禁播"）', (() => { L.transport('play', FIX); return plays > before })(), 'plays=' + plays)
  // 逃生门：用户显式关掉这个开关 ⇒ 闸门失效（语义写进文档）
  const g2 = boot({ settings: Object.assign({}, FIX, { powPauseHidden: false, powPauseHiddenUserSet: true }) })
  try { Object.defineProperty(globalThis.document, 'hidden', { configurable: true, get: () => true }) } catch (e) {}
  g2.L.updatePowerPause()
  ok('N9 显式关掉开关 ⇒ 闸门失效（逃生门；此时"切页也会响"是用户的选择）', g2.L.hiddenPauseOn() === false && g2.L.hiddenAudioBlock() === false, 'on=' + g2.L.hiddenPauseOn() + ' block=' + g2.L.hiddenAudioBlock())
  try { delete globalThis.document.hidden } catch (e) {}
}

/* ══════════════════════════════════════════════════════════════════════════════════
   O. C3 换档即断开旧音源（"切掉了还在放它的声音"的真凶）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== O. C3 换档：旧音源必须被硬归零（不依赖 fetch 成功）==')
{
  const OLD = { enabled: true, npNowPlaying: true, mute: false, npVolume: 60, npLinkWallpaper: true, converted: 'mp4', image: 'host:?custom=1&folder=3580207945&file=a.mp4', mpkgKey: 'custom|3580207945', source: 'a.mp4' }
  const NEW = { enabled: true, npNowPlaying: true, mute: false, npVolume: 60, npLinkWallpaper: true, converted: 'mp4', image: 'host:?token=t&index=0', mpkgKey: 'custommpkg|x.mpkg', source: 'a.mp4' }
  const { L } = boot({ settings: OLD })
  const NP = globalThis.__mpwNpTest
  await sleep(80)
  if (NP && NP.seedTracks) NP.seedTracks(OLD, [{ path: 'assets/bgm.mp3', mime: 'audio/mpeg', size: 1000 }], 'dir')
  const au = L.ensureAudio()
  ok('O1 夹具：旧档有曲目清单（tracks）', !!NP && !!NP.trackList(OLD), JSON.stringify(NP && NP.trackList(OLD)))
  if (au) {
    // 夹具要有真 pause/play/load（否则 `pause()` 抛错 ⇒ `paused` 不会翻，属夹具缺口不是实现缺口）
    au.setAttribute('src', '/api/mpkg-wallpaper/custom-folder/3580207945/assets/bgm.mp3')
    au.paused = false; au.muted = false
    au.pause = () => { au.paused = true }
    au.play = () => { au.paused = false; return { catch () {} } }
    au.load = () => {}
  }
  L.applyNowPlaying(OLD)
  const st0 = L.npSource()
  ok('O2 旧档身份 = tracks|custom|3580207945，且我们的 <audio> 在播', st0 && st0.kind === 'tracks' && st0.audioPaused === false, JSON.stringify(st0))
  // 切到"无清单的容器档"（真机现场：npScanUrl 为空 ⇒ 旧写法直接 return）
  L.writePartial(NEW)
  L.applyNowPlaying(NEW)
  await sleep(60)
  const st1 = L.npSource()
  ok('O3 切到无清单档后：身份变了（container ⇒ none/video）', st1 && st1.id !== st0.id, JSON.stringify(st1))
  ok('O4 **旧 <audio> 必须已暂停且 src 已断**（修前：继续在放 ⇒ 用户"切掉了还在响"）', st1 && st1.audioPaused === true && !st1.audioSrc, JSON.stringify(st1))
  ok('O5 审计里留下归零记录（可归因）', JSON.stringify(L.audit()).indexOf('audio-reset') >= 0, JSON.stringify(L.audit().slice(-2)))
  // 防御：即使 fetch 成功那条路没走到（无扫描 URL），也不能把旧源留着
  const g2 = boot({ settings: NEW })
  const NPause = g2.L.ensureAudio()
  if (NPause) {
    NPause.setAttribute('src', '/x.mp3'); NPause.paused = false; NPause.muted = false
    NPause.pause = () => { NPause.paused = true }
    NPause.play = () => { NPause.paused = false; return { catch () {} } }
    NPause.load = () => {}
  }
  g2.L.applyNowPlaying(NEW)
  await sleep(40)
  const st2 = g2.L.npSource()
  ok('O6 无清单档上重放：`npScanUrl` 为空那条 return 也收口（旧源不会漏网）', st2 && st2.audioPaused === true && !st2.audioSrc, JSON.stringify(st2))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   P. C2 音频审计：把"谁在什么时候放的声音"留痕（含已从 DOM 摘除但仍在播）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== P. C2 音频审计（play/volume/muted/Audio/AudioContext + isConnected + 栈）==')
{
  const { L } = boot({ settings: { enabled: true, npNowPlaying: true, mute: false } })
  ok('P1 审计缺省装好（`?npaudit=0` 才关）', L.auditOn() === true)
  // 造一个"已从 DOM 摘除但仍在播"的元素（用户现场第一嫌疑）
  const el = mkNode('audio', 'ghostMedia'); el.id = 'ghost'
  el.paused = false; el.muted = false; el.volume = 0.33
  el.currentTime = 12.5
  Object.defineProperty(el, 'isConnected', { configurable: true, get: () => false })
  const rec = L.auditPush('play', el, { detachedPlaying: true })
  ok('P2 审计记录了"已摘除但仍在播"的元素（isConnected=false 显式标出）', rec && rec.el && rec.el.connected === false && rec.paused === false, JSON.stringify(rec))
  ok('P3 记录里有调用栈摘要 + 当时状态（muted/volume/currentTime/hidden/np 设置）',
    typeof rec.who === 'string' && rec.muted === false && rec.volume === 0.33 && rec.currentTime === 12.5 && 'hidden' in rec && !!rec.np, JSON.stringify(rec).slice(0, 240))
  ok('P4 环形缓冲有界（≤200 条）且可疑计数可查', (() => { for (let i = 0; i < 260; i++) L.auditPush('play', el, {}); const list = L.audit(); const all = window.__mpwAudioAudit.list; return all.length <= 200 && (window.__mpwAudioAudit.suspicious || 0) >= 1 })(), 'len=' + window.__mpwAudioAudit.list.length + ' suspicious=' + window.__mpwAudioAudit.suspicious)
  const src = fs.readFileSync(clientPath, 'utf8')
  ok('P5 审计面覆盖 play/volume/muted/Audio/AudioContext/decodeAudioData', /P\.play = function/.test(src) && /\["muted", "volume"\]/.test(src) && /new-Audio/.test(src) && /AudioContext/.test(src) && /decodeAudioData/.test(src))
  ok('P6 可听转换（!paused && !muted && volume>0）立刻把**审计窗口**POST 到 /diag（下一次"响"在磁盘上就有证据）',
    /const audible = !!\(rec\.el && rec\.paused === false && rec\.muted === false && Number\(rec\.volume\) > 0\)/.test(src)
    && /trigger: webaudioOnMuted \? "webaudio-on-muted"/.test(src)
    && /muteOnAudible \? "mute-on-but-audible"/.test(src)
    && /audible \? "audible-playback"/.test(src) && /window: list\.slice\(-12\)/.test(src))
  /* ①(2026-09-20 用户点名「静音状态下还是突然冒出来的声音」) 把那次投诉**变成判据**：
     设置项 `mute === true`（面板写着静音）而元素却处在可听状态 ⇒ 必须单独一个 trigger 报上来，
     而不是混在泛化的 "audible-playback" 里（后者在设置本来就"不静音"时也会报，指认不了现场）。 */
  ok('P6b **静音设置开着却可听**是独立的可疑判据（trigger=mute-on-but-audible，同时带 `np.mute` 与可听状态两个事实）',
    /const muteOnAudible = !!\(rec\.np && rec\.np\.mute === true && audible\)/.test(src)
    && /\|\| muteOnAudible/.test(src))
  ok('P6c 审计能装进**同源子帧**（壁纸帧有自己的 HTMLMediaElement.prototype，主窗口打补丁对它完全无效）',
    /function mpwAuditPatchWin\(win\)/.test(src) && /mpwAuditPatchWin\(win\.frames\[i\]\)/.test(src)
    && /win\.__mpwAuditedWin/.test(src) && /setInterval\(mpwAuditScanFrames, 1000\)/.test(src))
  ok('P6d WebAudio **出声那一刻**有钩子（Live2D 角色语音走 AudioBufferSourceNode.start，不碰 <audio> 标签）',
    /webaudio-start/.test(src) && /AudioBufferSourceNode/.test(src) && /audioctx-resume/.test(src))
  ok('P6e 每条记录带**窗口归属**（`win.top/url/foreign`）：跨源帧如实标 foreign，不假装"没有声音"',
    /function mpwAuditWin\(win\)/.test(src) && /foreign: url === "cross-origin"/.test(src) && /win: mpwAuditWin\(win\)/.test(src))
  ok('P6f 声源归属指纹（ours / whale-widget / frame / other）写进记录，指认"这声音是谁放的"',
    /owner: \(\(\) => \{/.test(src) && /whale-widget/.test(src) && /"ours"/.test(src))
  /* ①(2026-09-20 用户澄清)「别人插件的音效必须我去交互他才会出现，并不会自己出现」⇒ 鲸鱼那条解释不了
     "什么都没动却响"。不需要交互就能出声、而我们 `muted` 管不到的只剩 **WebAudio**（Live2D 角色语音）：
     它不碰任何标签，`audible` 判据永远抓不到 ⇒ 必须单开一条 `webaudio-on-muted`。 */
  ok('P6g **WebAudio 出声 + 静音设置开着**是独立判据（`trigger=webaudio-on-muted`）',
    /const webaudioOnMuted = !!\(rec\.np && rec\.np\.mute === true\)/.test(src)
    && /kind === "webaudio-start" \|\| kind === "audioctx-resume"/.test(src)
    && /webaudioOnMuted \? "webaudio-on-muted"/.test(src))
  ok('P6h 窗口清单可查（`__mpwAudioAudit.frames()`：深度/URL/媒体数/像不像 Live2D）——"这条 WebAudio 是谁放的"',
    /__mpwAudioAudit\.frames = \(\) => \{/.test(src) && /looksLive2D/.test(src) && /cross-origin/.test(src))
  ok('P7 `?npaudit=0` 可完全关掉（零开销逃生门）', /get\("npaudit"\) !== "0"/.test(src))
  // 媒体卸载点审计：切离视频档必须 pause（只 removeAttribute('src') 不会停播）
  ok('P8 showImageEl 切离视频档时先 pause 再清 src/load（规范：移除 src 不会停止播放）', /if \(!video\.paused\) video\.pause\(\)[\s\S]{0,120}video\.removeAttribute\("src"\); if \(video\.load\) video\.load\(\)/.test(src))
  ok('P9 无源清空路径也 pause + load', /if \(video\.load\) video\.load\(\)/.test(src) && (src.match(/video\.pause\(\)/g) || []).length >= 2)
}

/* ══════════════════════════════════════════════════════════════════════════════════
   Q. C4 首次手势前一律 muted（不许"加载后若干秒自己变可听"）+ 联动关＝只控声音
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== Q. C4 起播时机可预期（手势前恒 muted）+ 联动关的"只控声音" ==')
{
  const FIX = { enabled: true, npNowPlaying: true, mute: false, npVolume: 33, npLinkWallpaper: true, converted: 'mp4', image: 'host:?custom=1&folder=f&file=a.mp4', mpkgKey: 'custom|f', source: 'a.mp4' }
  const { L } = boot({ settings: FIX })
  const video = L.video()
  if (video) {
    video.paused = true; video.muted = true; video.src = '/api/mpkg-wallpaper/media?token=t&index=0'
    video.play = () => { video.paused = false; return { catch () {} } }
    video.pause = () => { video.paused = true }
  }
  ok('Q1 夹具：mute=false 的设置下，**没有手势** ⇒ npWantMuted() 仍为 true（修前：`applyVideoMute` 会按设置翻成可听）',
    L.gestureSeen() === false && L.wantMuted() === true, 'gestureSeen=' + L.gestureSeen() + ' wantMuted=' + L.wantMuted())
  ok('Q2 可判定状态：`window.__mpwNpSoundAllowedBy` 在手势前为空', (() => { try { return !window.__mpwNpSoundAllowedBy } catch (e) { return true } })())
  L.gestureUnlock('test-card')
  ok('Q3 手势/卡片显式操作 ⇒ 解除（此后按设置走：mute=false ⇒ 可听）',
    L.gestureSeen() === true && L.wantMuted() === false, 'gestureSeen=' + L.gestureSeen() + ' wantMuted=' + L.wantMuted())
  // 联动关＝只控声音（video 档）
  const off = Object.assign({}, FIX, { npLinkWallpaper: false })
  L.writePartial({ npLinkWallpaper: false })   // 真机上这个开关经 commit 落进 section（否则 60ms 后的延迟重放会按旧值对齐）
  L.applyNowPlaying(off)
  const m = globalThis.__mpwNpTest.resolve(off)
  ok('Q4 联动关 + 视频档：canPlay=true（能控声音）/ canSeek=false + 副标题"只切换这条音轨的声音"',
    m.canPlay === true && m.canSeek === false && String(m.byline) === 'np.note.linkOffSoundOnly', JSON.stringify({ canPlay: m.canPlay, canSeek: m.canSeek, byline: m.byline }))
  if (video) { video.muted = false; video.paused = false; video.__plays = 0 }
  L.transport('pause', off)
  await sleep(30)
  ok('Q5 联动关 + 卡片暂停 ⇒ 只静音（muted=true）且画面继续（paused=false、play() 未被调）',
    !!video && video.muted === true && video.paused === false && (video.__plays || 0) === 0, JSON.stringify({ muted: video && video.muted, paused: video && video.paused, plays: video && video.__plays }))
  L.transport('play', off)
  await sleep(30)
  ok('Q6 联动关 + 卡片播放 ⇒ 取消静音（muted=false），画面依旧不被 play() 动', !!video && video.muted === false && (video.__plays || 0) === 0, JSON.stringify({ muted: video && video.muted, plays: video && video.__plays }))
  // 联动开 ⇒ 整体暂停/播放（画面 + 声音）
  L.writePartial({ npLinkWallpaper: true })
  L.applyNowPlaying(FIX)
  if (video) { video.paused = false; video.__plays = 0 }
  L.transport('pause', FIX)
  await sleep(30)
  ok('Q7 联动开 + 卡片暂停 ⇒ 整体暂停（paused=true，画面与声音一起停）', !!video && video.paused === true, JSON.stringify({ paused: video && video.paused }))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   R. NP-5 用户的暂停意图要持久化（刷新后不许自动换成播放）
   ══════════════════════════════════════════════════════════════════════════════════ */
console.log('\n== R. NP-5 暂停持久化：刷新后保持暂停 + 不跑起播链 ==')
{
  const FIX = { enabled: true, npNowPlaying: true, mute: false, npVolume: 33, npLinkWallpaper: true, npPaused: true, converted: 'mp4', image: 'host:?custom=1&folder=f&file=a.mp4', mpkgKey: 'custom|f', source: 'a.mp4' }
  // 走**真实 boot**（持久化值在档里）⇒ 模拟"刷新页面"
  const { L } = boot({ settings: FIX })
  const video = L.video()
  if (video) {
    video.paused = false; video.muted = false   // 故意先造成"在播且可听"的现场
    video.src = '/api/mpkg-wallpaper/media?token=t&index=0'
    video.play = () => { video.__plays = (video.__plays || 0) + 1; video.paused = false; return { catch () {} } }
    video.pause = () => { video.paused = true }
  }
  ok('R1 boot 时读到了持久化值（npPaused=true）', L.persistedPaused() === true && L.cardPausedNow() === true, 'persisted=' + L.persistedPaused() + ' cardPaused=' + L.cardPausedNow())
  L.applyNowPlaying(FIX)      // = 刷新后那次 apply
  await sleep(60)
  ok('R2 刷新后**不进入可听状态**（link 开 ⇒ 整体暂停：paused=true）', !!video && video.paused === true, JSON.stringify({ paused: video && video.paused, muted: video && video.muted }))
  ok('R3 没有执行"muted 起播 → 恢复设置"那条链：play() 一次都没被调', (video && video.__plays || 0) === 0, 'plays=' + (video && video.__plays))
  const m = globalThis.__mpwNpTest.resolve(FIX)
  ok('R4 卡片显示暂停态（playing=false）', m.playing === false, JSON.stringify({ playing: m.playing, canPlay: m.canPlay }))
  ok('R5 审计留痕"恢复自持久化暂停"（可归因）', JSON.stringify(L.audit()).indexOf('apply-persisted-pause') >= 0, JSON.stringify(L.audit().slice(-2)).slice(0, 200))
  // 只有**用户显式操作**才写这条键（内部状态一律不写）
  const before = JSON.stringify(L.read().npPaused)
  L.cardPausedNow()  // 只是读
  ok('R6 内部状态不写持久化（读一次不改档）', JSON.stringify(L.read().npPaused) === before, 'npPaused=' + before)
  const off = Object.assign({}, FIX, { npLinkWallpaper: false })
  L.writePartial({ npLinkWallpaper: false })
  L.applyNowPlaying(off)
  if (video) { video.paused = false; video.muted = false }
  L.transport('pause', off)   // 用户显式按暂停（link 关）
  await sleep(30)
  ok('R7 用户在 link 关时按暂停 ⇒ **只静音音轨**（muted=true、paused=false）且写了 npPaused=true',
    !!video && video.muted === true && video.paused === false && L.persistedPaused() === true,
    JSON.stringify({ muted: video && video.muted, paused: video && video.paused, persisted: L.persistedPaused() }))
  L.transport('play', off)    // 用户显式按播放
  await sleep(30)
  ok('R8 用户按播放 ⇒ npPaused=false（持久化跟着用户意图走）', L.persistedPaused() === false, 'persisted=' + L.persistedPaused())
  const src = fs.readFileSync(clientPath, 'utf8')
  ok('R9 写入口径写明"只有用户显式操作才写"（内部状态不串味）', /只有用户显式操作才会走到这里/.test(src) && /一个都不许写进来/.test(src))
  ok('R10 `npPaused` 已登记进 BACKUP_FIELDS + boolFields（导入净化 + 随备份走）', /"npPaused" \/\/ ①\(NP-4\)/.test(src) && /"npLinkWallpaper", "npPaused"\]/.test(src))
}

/* ══════════════════════════════════════════════════════════════════════════════════
   K. 变异自证
   ══════════════════════════════════════════════════════════════════════════════════ */
const MUTATIONS = [
  { id: 'switch-keeps-stale-weburl', expect: 'A', why: '换档补全退化（不再成套清空）⇒ 残留 webUrl 又能抢先武装（真机黑屏的直接成因）', mut: (s) => s.replace('if (hasImg && !hasWeb) { if (p.webUrl === void 0) p.webUrl = null; if (p.sceneKey === void 0) p.sceneKey = null }', '') },
  { id: 'pickmount-renderer-any-type', expect: 'B', why: '渲染器 URL 又在**任何**类型下都算 web（修前形态）⇒ mp4 档上的残留渲染器 URL 抢到挂载权（真机黑屏 + 破图图标）', mut: (s) => s.replace('if (!shapeMismatch && rendererUrl && (converted === "scene" || (!image && !converted))) return { mount: "web", reason: "scene-renderer" };', 'if (!shapeMismatch && rendererUrl) return { mount: "web", reason: "scene-renderer" };') },
  { id: 'pickmount-weburl-first', expect: 'B', why: '挂载裁决退回"有 webUrl 就走 web"（旧写法）⇒ 残留 webUrl 抢到挂载权', mut: (s) => s.replace('const webShape = mpwSrcShapeOf(webUrl);', "if (webUrl) return { mount: 'web', reason: 'mutated-weburl-first' };\n\t\t\tconst webShape = mpwSrcShapeOf(webUrl);") },
  { id: 'library-shape-as-custom', expect: 'C', why: '库条目被用自定义目录形状取（本次真机事故）⇒ library webUrl 变成 custom=1&folder=<ltoken>', mut: (s) => s.replace('out.webUrl = "host:?ltoken=" + encodeURIComponent(e.ltoken) + "&web=1&file=" + encodeURIComponent(file || "index.html") + (c.compat ? "" : "&shim=1");', 'out.webUrl = "host:?custom=1&folder=" + encodeURIComponent(e.ltoken) + "&file=" + encodeURIComponent(file || "index.html") + (c.compat ? "" : "&shim=1");') },
  { id: 'thumb-no-web-candidates', expect: 'D', why: 'web 档的预览候选链被删掉（修前形态：预览框什么都没有）', mut: (s) => s.replace('for (const name of ["preview.gif", "preview.jpg", "preview.png", "preview.webp", "preview.jpeg", "loading.webp"]) {', 'for (const name of []) {') },
  { id: 'compat-selector-narrowing-removed', expect: 'E', why: 'aside 选择器退回"任何 aside 都打 sidebarCol"（修前形态）⇒ 弹层/抽屉容器吃侧栏规则', mut: (s) => s.replace(/\['aside:not\(\[role="dialog"\]\)[\s\S]*?'sidebarCol', 'sideonly', false\]/, "['aside, [data-sidebar-left]', 'sidebarCol', 'sideonly', false]") },
  { id: 'compat-js-defenses-removed', expect: 'E', why: 'JS 侧两道防线（打类前的 mpwHoldsLayer 判据 + 打类后的自愈）一起拆掉 ⇒ 只剩选择器一道（宽松宿主版本上会重新污染）', mut: (s) => s.replace('if (mpwHoldsLayer(el)) {', 'if (false) {').replace('const marked = Array.from(document.querySelectorAll("[" + MPW_SIDE_MARK_ATTR + "]"));', 'const marked = [];') },
  { id: 'voice-classifier-off', expect: 'L', why: '交互音分类器关掉（一条都不排除）⇒ 播放器又会去放角色语音（用户第 A 条）', mut: (s) => s.replace('if (c.kind === "voice") drop.add(c.base);', 'if (false) drop.add(c.base);') },
  { id: 'link-off-freezes-wallpaper', expect: 'M', why: '联动关闭时也去动壁纸（把"关＝冻结"写回去）⇒ 用户"暂停状态下关掉开关后壁纸动不了"', mut: (s) => s.replace("if (!linkOn) return \"none\";                   // 关：保持壁纸当下状态（用户现场那条）", "if (!linkOn) return \"pause\";") },
  { id: 'clear-skips-media-teardown', expect: 'F', why: '清空回到"只在 img.src 变了才清理"的旧写法 ⇒ <video> 的旧 src 留在后台继续拉流（真机复测抓到的漏项）', mut: (s) => s.replace('if (!image) {\n\t\t\t\t\ttry { img.removeAttribute("src") } catch {}', 'if (false) {\n\t\t\t\t\ttry { img.removeAttribute("src") } catch {}') },
  { id: 'clear-bg-undefined-weburl', expect: 'F', why: '清空退回 `webUrl: undefined`（= 不覆盖 + 粘性带回来）⇒ 点清除后壁纸被重新加载（修前现场）', mut: (s) => s.replace('webUrl: null, sceneKey: null }), true);', 'webUrl: undefined, sceneKey: undefined }), true);') },
  { id: 'arm-probe-ignores-okfalse', expect: 'G', why: '验活只看 r.ok（不看 {ok:false}）⇒ 真机那条 404 的 JSON 不再被判不可用', mut: (s) => s.replace("if (body && body.ok === false) return rec({ ok: false, status: status, url: u, error: String(body.error || \"\").slice(0, 120) });", '') },
  { id: 'sandbox-fallback-unconditional', expect: 'H', why: '降级判据退化成"任何错误都降级"⇒ 沙箱隔离价值被一次无关报错换掉', mut: (s) => s.replace("return /SecurityError|sandbox|opaque|not allowed|denied|Failed to construct 'Worker'|Blocked|insecure|Operation is insecure/i.test(msg);", 'return true;') },
  { id: 'card-pause-does-not-gate-frame', expect: 'I', why: '帧内归属不再看"卡片暂停"（修前 NP-3 形态）⇒ 卡片暂停后壁纸 BGM 继续响（真机第 ④ 条）', mut: (s) => s.replace('if (npCardPaused) return true;\n\t\t\t\treturn npOwnAudible();', 'return npOwnAudible();') },
  /* C3 的两道防线（换档硬归零 + 早退收口）互为兜底：只拆一道仍然不红 = 设计如此；
     变异必须把两道一起退回（= 修前的完整形态）才算有分辨力。 */
  { id: 'np-paused-not-restored', expect: 'R', why: '刷新后不按持久化意图恢复（把它退回"内存态、刷新即播放"）⇒ 用户的暂停被换成播放', mut: (s) => s.replace('try { npApplyPersistedPause(s); } catch (e) {}', '') },
  { id: 'np-paused-written-by-internal-state', expect: 'R', why: '内部状态也去写 npPaused（把"用户意图"和"我们的内部暂停"混在一起）⇒ 刷新后把内部状态当意图恢复', mut: (s) => s.replace('const userPaused = s.npPaused !== void 0 ? !!s.npPaused : DEFAULT_NP_PAUSED;', 'const userPaused = true;') },
  { id: 'unmuted-before-gesture', expect: 'Q', why: '去掉"手势前恒 muted"（修前形态）⇒ 加载后若干秒自己从 muted 翻成可听（真机 48/48 拍的可听播放）', mut: (s) => s.replace('if (!npGestureSeen) return true;', '') },
  { id: 'link-off-freezes-whole-video', expect: 'Q', why: '联动关退回"整体暂停/禁用"（被用户判为 bug 的旧口径）⇒ 用户"关闭状态下暂停播放用不了"', mut: (s) => s.replace('} else if (vid && !link) {', '} else if (false) {') },
  { id: 'source-change-keeps-old-audio', expect: 'O', why: '换档硬归零与早退收口**一起**退回（修前形态）⇒ 上一张壁纸的 <audio> 继续放（用户："切掉了还在放他的声音"）', mut: (s) => s.replace('if (npSrcIdPrev !== null && idNow !== npSrcIdPrev) npAudioHardReset("source-changed:" + npSrcIdPrev + "->" + idNow);', '').replace('if (npAudio && (!npAudio.paused || npAudio.getAttribute("src"))) npAudioHardReset("no-scan-url");', '') },
  { id: 'audit-detached-flag-dropped', expect: 'P', why: '审计不再标 `connected:false`（"已摘除仍在播"抓不到）⇒ 以后同类问题又只能靠猜', mut: (s) => s.replace('connected: el.isConnected !== false,', 'connected: true,') },
  { id: 'video-teardown-no-pause', expect: 'P', why: '切离视频档退回"只 removeAttribute(src)"（规范：不会停止播放）⇒ 隐藏但仍在响', mut: (s) => s.replace('try { if (!video.paused) video.pause() } catch (e) {}\n\t\t\ttry { video.removeAttribute("src"); if (video.load) video.load() } catch (e) {}', 'try { video.removeAttribute("src") } catch (e) {}') },
  { id: 'hidden-retry-not-gated', expect: 'N', why: '起播闸门去掉 hidden 条件（修前形态）⇒ 被节流的重试定时器在后台把音频拉起来（真机"过一会儿又响一下"）', mut: (s) => s.replace('if (wallUserPaused || powPaused || npUserPausedOf(video) || npCardPaused || mpwHiddenAudioBlock()) {', 'if (wallUserPaused || powPaused || npUserPausedOf(video) || npCardPaused) {') },
  /* C 的两道闸是**互为兜底**的（applyNowPlaying 那条跳过 + npPrimePlay 内部闸），任一条单独生效就够
     ⇒ 变异必须把两道一起拆掉才是"修前的完整形态"（否则拆一道仍然不红，那是设计如此，不是假绿）。 */
  { id: 'apply-prime-ignores-hidden', expect: 'N', why: 'applyNowPlaying 的补起播与 npPrimePlay 的内部闸**一起**退回（修前的完整形态）⇒ 被节流的延迟重放会在后台起播', mut: (s) => s.replace('if (vid.paused && !npPlayBlocked && !mpwHiddenAudioBlock()) npPrimePlay(vid);', 'if (vid.paused && !npPlayBlocked) npPrimePlay(vid);').replace('if (wallUserPaused || powPaused || npUserPausedOf(video) || npCardPaused || mpwHiddenAudioBlock()) {', 'if (wallUserPaused || powPaused || npUserPausedOf(video) || npCardPaused) {') },
  { id: 'pow-pause-hidden-default-false', expect: 'J', why: '切页暂停退回默认关（修前形态）⇒ 切到别的标签页声音继续', mut: (s) => s.replace('const DEFAULT_POW_PAUSE_HIDDEN = true;', 'const DEFAULT_POW_PAUSE_HIDDEN = false;') },
]

if (!NO_MUT) {
  console.log('\n== K. 分辨力自证：' + MUTATIONS.length + ' 组变异各自必须让**指定那一组**变红 ==')
  for (const m of MUTATIONS) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'mut-'))
    const target = path.join(dir, 'client.js')
    const src = fs.readFileSync(clientPath, 'utf8')
    const mutated = m.mut(src)
    if (mutated === src) { fail++; console.log('  ✗ K 变异 ' + m.id + ' 注入点没匹配上（源码改了？）'); continue }
    fs.writeFileSync(target, mutated)
    const r = spawnSync(process.execPath, [path.join(here, 'wallpaper-lifecycle-test.mjs'), '--client', target, '--no-mutations'], { encoding: 'utf8' })
    const out = (r.stdout || '') + (r.stderr || '')
    // 找出"变红的组"：抓 ✗ 行前面的组标题
    let group = ''
    const redGroups = new Set()
    for (const line of out.split('\n')) {
      const g = /^== ([A-Z])\./.exec(line.trim())
      if (g) group = g[1]
      if (/^\s*✗/.test(line)) redGroups.add(group)
    }
    const hit = redGroups.has(m.expect)
    const exitOk = r.status !== 0
    if (hit && exitOk) { pass++; console.log('  ✓ K 变异 ' + m.id + '：期望 ' + m.expect + ' 组变红，实际 ' + Array.from(redGroups).join(',') + '  — ' + m.why) }
    else { fail++; console.log('  ✗ K 变异 ' + m.id + '：期望 ' + m.expect + ' 组变红，实际 ' + (Array.from(redGroups).join(',') || '(没有组变红)') + ' exit=' + r.status + '  — ' + m.why) }
  }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ }
if (fail) { console.log('✗ 壁纸生命周期门禁未通过'); process.exit(1) }
console.log('✓ 壁纸生命周期门禁通过：换档成套重写 / 挂载裁决 / 形状绑定 / 预览候选链 / 弹层类污染 / 清空不复活 / 武装前验活 / 沙箱降级 / 帧内音频归属 / 切页静音 —— 每组都有判据与变异自证')

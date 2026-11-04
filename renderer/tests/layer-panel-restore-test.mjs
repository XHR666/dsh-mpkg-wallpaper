#!/usr/bin/env node
/**
 * layer-panel-restore-test.mjs —— ⑦(2026-10-12 用户 :8902 实测第 4 / 第 6 条) 的**纯 Node 门禁**
 *
 * 用户原话（两条，都在 `:8902` 页面 = `demo/index.html` + `demo/bench-patch.js`）：
 *   ④ 「壁纸标签的第 1 位的壁纸的叉号会超出它的框；如果有第 2 个壁纸，第 1 位那个叉号的大框会串到
 *      第 2 个壁纸里」⇒ 第 2/3… 位正常、**任何壁纸排到第 1 位就复现**；
 *   ⑥ 「在图层开关里面加一个『恢复默认』的功能」⇒ 语义 = 回到**壁纸文件默认态**（本仓既有唯一口径：
 *      默认勾选 = 文件语义），点完**立即生效**且与**刷新页面**结果一致。
 *
 * 覆盖（A~E 段）：
 *   A 结构：面板切片标记（`MPW-LSW-PANEL-BEGIN/END`）里有 `#layer-reset`、文案键三处齐全（zh/en）、
 *     补丁侧 `MPW-LSW-RESET-BEGIN/END` 切片定义并接线了 `lswResetDefaults`、原有四个键没被顶掉；
 *   B **行为**（真切片跑真实代码：把补丁里的 reset 切片 + 画布的**假 DOM 桩**放进沙箱，点的是
 *     切片自己注册的 click 处理器）：先改若干层（隐藏 fileVisible 层 + 强制显示 visible:false 层 +
 *     URL 里带 `?hide=`）⇒ 点「恢复默认」⇒ ① 勾选态 == `layerSwitchState(L,[],[])` 的文件默认、
 *     ② `__lnHidden/__lnShown` 逐层回到文件默认计划、③ URL 里 `?hide=` 被删掉且"重新加载"得到同一
 *     状态（这两条一起才叫"刷新一致"）、④ 接线不是空函数、⑤ 幂等、⑥ 调试隔离期间只记账不落层；
 *   C ④ 的回归：① 静态表与 `SITE_LAYOUT_CSS` **两处同文**的预留/负外边距规则（并校验数值自洽：
 *     `left == -pad`、`right == pad - 22` ⇒ 外边距盒宽度 0 ⇒ 不给后续标签新增占位）；
 *     ② `wp-cur-has-x` 与 `.wp-x-cur` **同生共死**（在同一个分支里加、没有 × 时摘掉）；
 *     ③ **真浏览器几何**（无头 Firefox + 无服务夹具，CSS 全部从真源装配）：修后 `×` 必须 ⊆ `#current`
 *     的边框盒、**不压住标题文字**、右缘留 ≥4px、第 2 个标签与 `×` 右缘留 ≥4px；并当场跑两个
 *     "修前形态"夹具（去掉预留规则 / 去掉负外边距）⇒ **必须判红**（否则这条判据就是恒真的假判据）；
 *   D 变异自证：对 8 个变异各做一次"改坏"，用**同一套判据函数**重跑 ⇒ **期望红集 == 实际红集**（不等就红）；
 *   E 变异只落 /tmp 副本：跑前跑后真源哈希不变。
 *
 * 运行：node tests/layer-panel-restore-test.mjs   （全过 ALL PASS，退出码 0）
 * 纪律：真树只读（只有 /tmp 副本会被改写）；无网络、不启任何服务；`:8902` 不动（浏览器段用 `setContent`
 *       装**离线夹具**，一次都不访问 :8902）。
 */
import fs from 'node:fs'
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const readRel = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const P = await import(pathToFileURL(path.join(ROOT, 'demo/bench-patch.js')).href)

/* ═══════════════════════════ 0 源文本工具 ═══════════════════════════ */
/** `BEGIN…END` 之间的切片（**整行**：JS 侧标记住在块注释里 ⇒ 必须从行首取，否则切出来的是裸注释文本）。
 *  找不到 ⇒ null，判据据此报红而不是静默。 */
function sliceBetween(text, begin, end) {
  const i = text.indexOf(begin)
  if (i < 0) return null
  const j = text.indexOf(end, i + begin.length)
  if (j < 0) return null
  const start = text.lastIndexOf('\n', i) + 1
  const eol = text.indexOf('\n', j)
  return text.slice(start, eol < 0 ? text.length : eol)
}
/** CSS 注释剥掉再按行切（静态表里有跨行注释，注释行里的 `{` 会骗过朴素的按行提取）。 */
function stripCssComments(css) { return String(css).replace(/\/\*[\s\S]*?\*\//g, '') }
function staticCssOf(indexHtml) {
  const m = String(indexHtml).match(/<style id="bench-shell-static">([\s\S]*?)<\/style>/)
  return m ? stripCssComments(m[1]) : null
}
/** `SITE_LAYOUT_CSS` 的条目数组（单引号字符串；与 demo-check D8 同一读法）。 */
function siteLayoutCssItems(patchText) {
  const m = String(patchText).match(/const SITE_LAYOUT_CSS = \[([\s\S]*?)\]\.join\(''\)/)
  if (!m) return null
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"))
}
const normCss = (t) => String(t).replace(/\s+/g, ' ').trim()

/* ═══════════════════════════ 0b 沙箱：真切片 + 假 DOM ═══════════════════════════ */
/** 夹具层表（覆盖四种情况：可显示且文件可见 / 可显示但文件 `visible:false` / 无绘制源 / 容器）。 */
const FIXTURE_LAYERS = [
  { name: '背景', image: 'a.png' },                    // #0 文件可见 + 可显示
  { name: '人物', particle: {} },                      // #1 文件可见 + 可显示
  { name: '光效', image: 'c.png', visible: false },     // #2 文件 visible:false + 可显示
  { name: '音效.mp3' },                                // #3 无绘制源（语料里的 sound 层）
  { name: '容器', isContainer: true },                  // #4 容器层
  { name: '前景', __text: {}, visible: false },         // #5 文件 visible:false + 可显示
]
const LAYERS = () => FIXTURE_LAYERS.map((l) => Object.assign({}, l))

/** 沙箱前置：把 `lswResetDefaults` 用到的闭包**逐个**用桩补上（名字与真源逐字一致，缺一个就抛 ⇒ 红）。
 *  `layerSwitchState` / `formatHideParam` 用的是**真模块导出**，沙箱里不重写这两套口径。 */
const PRELUDE = `
  const L = INIT.layers
  let lswHidden = new Set(INIT.hidden), lswNames = new Map(INIT.names)
  let lswShown = new Set(INIT.shown), lswShownNames = new Map(INIT.shownNames)
  const calls = []
  const el = { id: 'layer-reset', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn } }
  const $ = (sel) => (sel === '#layer-reset' ? el : null)
  const sceneLayerList = () => L
  const lswStateNow = (l) => layerSwitchState(l || sceneLayerList() || [], lswHidden, lswShown)
  function lswSyncUrl() {
    calls.push('syncUrl')
    const v = formatHideParam([...lswHidden])
    const u = new URL(location.href)
    if (v) u.searchParams.set('hide', v); else u.searchParams.delete('hide')
    location.href = String(u.href)
    return true
  }
  function lswApply(list) {
    calls.push('apply')
    const LL = list || sceneLayerList(); if (!LL) return 0
    let n = 0
    for (const { i, hidden, shown } of layerSwitchState(LL, lswHidden, lswShown).plan) {
      LL[i].__lnHidden = hidden; LL[i].__lnShown = shown; if (hidden) n++
    }
    return n
  }
  const lswPaintChrome = () => { calls.push('chrome') }
  const lswPaintRows = () => { calls.push('rows') }
  const logLine = (s) => { calls.push('log:' + String(s)) }
`
const EPILOGUE = `
  return {
    registered: !!el.handlers.click,
    click: () => { if (!el.handlers.click) return false; el.handlers.click(); return true },
    state: () => ({
      hidden: [...lswHidden].sort((a, b) => a - b), shown: [...lswShown].sort((a, b) => a - b),
      names: [...lswNames.keys()].sort((a, b) => a - b), shownNames: [...lswShownNames.keys()].sort((a, b) => a - b),
      ln: L.map((l, i) => ({
        i,
        /* ⚠「写了 false」与「压根没写」必须能分开：真源 lswApply() 的契约就是**每层都显式赋值**
           （不适用时写 false，**不 delete**）⇒ 只比 === true 会把"没落层"误判成通过（假绿）。 */
        hasH: Object.prototype.hasOwnProperty.call(l, '__lnHidden'),
        hasS: Object.prototype.hasOwnProperty.call(l, '__lnShown'),
        hidden: l.__lnHidden === true, shown: l.__lnShown === true,
      })),
      checked: layerSwitchState(L, lswHidden, lswShown).rows.map((r) => (r.checked ? 1 : 0)).join(''),
      forced: layerSwitchState(L, lswHidden, lswShown).rows.filter((r) => r.forced).map((r) => r.i),
      hiddenCount: layerSwitchState(L, lswHidden, lswShown).hiddenCount,
    }),
    calls: () => calls.slice(),
    href: () => location.href,
  }
`
/** 建沙箱（传进真源切片；缺名字/语法坏 ⇒ 抛，判据红）。 */
function makeSandbox(patchText, init, opts = {}) {
  const slice = sliceBetween(patchText, 'MPW-LSW-RESET-BEGIN', 'MPW-LSW-RESET-END')
  if (!slice) throw new Error('切片缺失：MPW-LSW-RESET-BEGIN/END')
  const loc = { href: init.href || 'http://127.0.0.1:8902/' }
  const fn = new Function('INIT', 'location', 'URL', 'layerSwitchState', 'formatHideParam', 't', 'curLang', 'dbgActive',
    PRELUDE + '\n' + slice + '\n' + EPILOGUE)
  const api = fn({ layers: init.layers, hidden: init.hidden || [], shown: init.shown || [], names: [], shownNames: [] },
    loc, URL, P.layerSwitchState, P.formatHideParam, P.t, opts.lang || 'zh', !!opts.dbgActive)
  return Object.assign(api, { loc, slice })
}
/** "重新加载页面"：新沙箱，隐藏集**只**从 URL 的 `?hide=` 重建（= 真源 `lswUrlHide` 那条读点），
 *  强制显示集不进 URL ⇒ 天然为空（这正是"删掉 ?hide= 才叫刷新一致"的原因）。 */
function reloadSandbox(patchText, api, opts = {}) {
  const hide = new URL(api.loc.href).searchParams.get('hide')
  return makeSandbox(patchText, {
    layers: LAYERS(), hidden: P.parseHideParam(hide), shown: [], href: api.loc.href,
  }, opts)
}
/** 逐层标记的读数串：`i:` + 隐藏位（`H` 隐藏 / `h` 显式 false / `·` 没写）+ 强制显示位（`S`/`s`/`·`）。
 *  两种"没写"和"写了 false"必须长得不一样 —— 否则 B2 抓不住"只改 UI 不落层"。 */
const lnMap = (ln) => ln.map((x) => x.i + ':' + (x.hasH ? (x.hidden ? 'H' : 'h') : '·') + (x.hasS ? (x.shown ? 'S' : 's') : '·')).join(' ')
const lnWant = (plan) => plan.map((p) => p.i + ':' + (p.hidden ? 'H' : 'h') + (p.shown ? 'S' : 's')).join(' ')
const fixed = (n) => Number(n).toFixed(2)

/* ═══════════════════════════ 0c ④ 的真浏览器几何（可选：无 playwright/firefox 则 SKIP） ═══════════════════════════ */
function findPlaywright() {
  const cands = [process.env.MPW_PLAYWRIGHT,
    path.join(ROOT, 'node_modules/playwright/index.js'),
    path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js')].filter(Boolean)
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}
let _pw = undefined
async function playwright() {
  if (_pw !== undefined) return _pw
  const p = findPlaywright()
  if (!p) { _pw = null; return null }
  try {
    const m = await import(pathToFileURL(p).href)
    const firefox = (m.default && m.default.firefox) || m.firefox
    _pw = firefox ? { firefox } : null
  } catch { _pw = null }
  return _pw
}
let _browser = null
async function browserOnce() {
  if (_browser !== null) return _browser
  const pw = await playwright()
  if (!pw) { _browser = false; return false }
  try { _browser = await pw.firefox.launch({ firefoxUserPrefs: { ...AUDIO_MUTE_PREFS }, headless: true }) } catch { _browser = false }
  return _browser
}
/** 产品 CSS 里的三条布局规则（`demo/assets/bench-*.css`，文件名带哈希 ⇒ 运行期查）。 */
function productTabCss() {
  const dir = path.join(ROOT, 'demo/assets')
  const f = fs.readdirSync(dir).filter((n) => /^bench-.*\.css$/.test(n)).sort()[0]
  if (!f) return null
  const css = fs.readFileSync(path.join(dir, f), 'utf8')
  const one = (sel) => {
    const i = css.indexOf(sel + '{')
    if (i < 0) return null
    return css.slice(i, css.indexOf('}', i) + 1)
  }
  const parts = [one('#editor-tabs'), one('.tab'), one('.tab.active'), one('html[data-theme=light]')]
  return parts.every(Boolean) ? parts.join('\n') : null
}
/** 夹具：产品规则 + **静态表里与本条相关的真实规则**，DOM 用 JS 建（嵌套 `<button>` 走 HTML 解析器会被拆掉）。
 *  `title` 可给长标题：真页面上 `#current` 的标题常常超过 180px 上限 ⇒ 走"省略号截断"那条路
 *  （修前它是匿名 flex item、省略号**不生效**，长标题会画到 `×` 底下 —— 这条路径必须也被判据覆盖）。 */
function fixtureHtml(indexHtml, title = '未选择壁纸') {
  const staticCss = staticCssOf(indexHtml)
  const product = productTabCss()
  if (!staticCss || !product) return null
  const bench = staticCss.split('\n').map((l) => l.trim())
    .filter((l) => l.includes('{') && /#wp-switch|#editor-tabs|\.wp-tab|\.wp-x|#current/.test(l)).join('\n')
  return `<!doctype html><html class="bench-shell"><head><meta charset="utf-8"><style>
:root{--fg:#ccc;--fg-dim:#9d9d9d;--accent:#0078d4;--hover:#2a2a2a;--sidebar:#181818;--editor:#1f1f1f;--border:#2b2b2b;--tab-active-fg:#fff;--list-active-fg:#fff}
*{box-sizing:border-box}body{margin:0;font:13px/1.4 sans-serif;background:var(--editor)}
${product}
${bench}
</style></head><body>
<div id="wp-switch"><div id="editor-tabs">
  <div class="tab active wp-cur-has-x" id="current"></div>
  <button type="button" class="wp-x wp-x-cur">×</button>
</div><button type="button" id="wp-add">＋</button></div>
<script>
document.querySelector('#current').textContent = ${JSON.stringify(title)}
for (const name of ['第二个壁纸名字很长很长很长', '第三个']) {
  const b = document.createElement('button'); b.type='button'; b.className='wp-tab'
  const n = document.createElement('span'); n.className='wp-name'; n.textContent=name
  const x = document.createElement('button'); x.type='button'; x.className='wp-x'; x.textContent='×'
  b.appendChild(n); b.appendChild(x); document.querySelector('#editor-tabs').appendChild(b)
}
<\/script></body></html>`
}
/** 量第 1 位/第 2 位的几何。判据：× ⊆ 自己的框、不压标题、右缘 ≥4px、与第 2 格 ≥4px（第 2 格自己也得在框内）。 */
async function measureTabs(html) {
  const b = await browserOnce()
  if (!b) return null
  const page = await b.newPage({ viewport: { width: 1000, height: 300 } })
  try {
    await page.setContent(html, { waitUntil: 'load' })
    return await page.evaluate(() => {
      const R = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) } }
      const cur = document.querySelector('#current'), cx = document.querySelector('.wp-x-cur')
      const t2 = document.querySelectorAll('.wp-tab')[0], t2x = t2.querySelector('.wp-x')
      // 标题文字的实际右缘（Range 量文本，不用 padding 猜）
      const rg = document.createRange(); rg.selectNodeContents(cur)
      const textLayoutRight = +rg.getBoundingClientRect().right.toFixed(2)
      const curR = R(cur), cxR = R(cx), t2R = R(t2), t2xR = R(t2x)
      const cs = getComputedStyle(cur)
      const pad = parseFloat(cs.paddingRight) || 0
      const contentRight = +(curR.right - pad).toFixed(2)
      /* 「标题能不能一路画到 `×` 底下」= **省略号有没有真的生效**：
         ① `overflow:hidden` 把**画**裁在**内边距盒**（= 格子右缘），所以只靠它 ⇒ 长标题会盖住 `×`；
         ② 要裁在**内容盒右缘**（= `×` 左缘 − 6px）就必须让 `text-overflow:ellipsis` 作用在**块容器**上：
            修前 `#current` 是 `display:flex`，而它里面是**裸文本** ⇒ 匿名 flex item 不吃 ellipsis（实测真页面
            长标题布局右缘 796 画进 `×` 盒 [774,796]）；修后宿主态是 `display:block` ⇒ ellipsis 生效。
         判据两种实现都认：块容器自身，或 flex 容器里**第一个子元素**是带 ellipsis 的文本持有者。 */
      const flexy = /^(inline-)?(flex|grid)$/.test(cs.display)
      const firstKid = cur.firstElementChild
      const kidEllipsis = !!firstKid && (() => {
        const k = getComputedStyle(firstKid)
        return k.overflow === 'hidden' && k.textOverflow === 'ellipsis' && k.whiteSpace === 'nowrap'
      })()
      const ellipsisOk = cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' && (!flexy || kidEllipsis)
      const truncated = textLayoutRight > contentRight + 0.5
      return {
        cur: curR, curX: cxR, tab2: t2R, tab2X: t2xR, textLayoutRight, contentRight,
        display: cs.display, overflow: cs.overflow, textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace,
        padRight: cs.paddingRight, xMargin: getComputedStyle(cx).margin, truncated, ellipsisOk,
        curXInsideCur: cxR.x >= curR.x && cxR.right <= curR.right && cxR.y >= curR.y && cxR.bottom <= curR.bottom,
        textGap: +(cxR.x - Math.min(textLayoutRight, ellipsisOk ? contentRight : curR.right)).toFixed(2),
        rightInset: +(curR.right - cxR.right).toFixed(2),
        gapToTab2: +(t2R.x - cxR.right).toFixed(2),
        tab2XInsideTab2: t2xR.x >= t2R.x && t2xR.right <= t2R.right,
      }
    })
  } finally { await page.close() }
}
/** 几何判据本体（修后必须全真；三个"修前形态"夹具必须至少一条假 —— 见 C3 的自证部分）：
 *  `×` 在自己的框内 + 省略号**真生效**（不然长标题会画到 `×` 底下） + 标题↔`×` 留 ≥4px（真值 6px，
 *  与 `.wp-tab{gap:6px}` 同） + `×` 右缘距格子右边 ≥4px（真值 4px） + 第 2 个格子与 `×` 右缘 ≥4px
 *  + 第 2 格自己的 `×` 也在框内（对照）。 */
const geoOk = (m) => !!m && m.curXInsideCur && m.ellipsisOk && m.textGap >= 4 && m.rightInset >= 4 && m.gapToTab2 >= 4 && m.tab2XInsideTab2

/* ═══════════════════════════ 1 判据集（同一套函数用于真源与变异副本） ═══════════════════════════ */
/**
 * @returns {Promise<{res: Map<string,{ok:boolean,label:string,extra:string}>, geo: any, geoLong: any, geoSelfProof: any}>}
 */
async function runChecks(src) {
  const res = new Map()
  const add = (id, ok, label, extra = '') => res.set(id, { ok: !!ok, label, extra })
  const indexHtml = src.indexHtml
  const patchText = src.patchText

  /* ── A 结构 ── */
  const panelSlice = sliceBetween(indexHtml, 'MPW-LSW-PANEL-BEGIN', 'MPW-LSW-PANEL-END')
  const barSlice = panelSlice ? sliceBetween(panelSlice, '<div class="lsw-bar">', '</div>') : null
  const btnLine = panelSlice ? (panelSlice.split('\n').find((l) => l.includes('id="layer-reset"')) || '') : ''
  add('A1', !!panelSlice && /id="layer-reset"/.test(barSlice || '') && /data-i18n="layers\.reset"/.test(btnLine) && /data-i18n-title="layers\.resetTip"/.test(btnLine),
    'A1 `#layer-reset` 在面板切片内、位于 `.lsw-bar` 里、带 `data-i18n`/`data-i18n-title`',
    btnLine ? normCss(btnLine).slice(0, 96) : '未找到按钮行')
  const zh = P.DICT.zh || {}, en = P.DICT.en || {}
  add('A2', ['layers.reset', 'layers.resetTip', 'log.lswReset'].every((k) => String(zh[k] || '').trim() && String(en[k] || '').trim()) && zh['layers.reset'] === '恢复默认',
    'A2 文案三键 zh/en 齐全非空，且 `layers.reset` 的中文就是「恢复默认」',
    `zh.layers.reset=${zh['layers.reset']} / en=${en['layers.reset']}`)
  const resetSlice = sliceBetween(patchText, 'MPW-LSW-RESET-BEGIN', 'MPW-LSW-RESET-END')
  const definesFn = !!resetSlice && /function lswResetDefaults\s*\(/.test(resetSlice)
  const wired = !!resetSlice && /lswResetBtn\.addEventListener\('click'[\s\S]*?lswResetDefaults\(\)/.test(resetSlice)
  const idAgrees = !!resetSlice && resetSlice.includes("$('#layer-reset')") && !!panelSlice && panelSlice.includes('id="layer-reset"')
  add('A3', definesFn && wired && idAgrees,
    'A3 补丁切片：定义 `lswResetDefaults()` + 把 `#layer-reset` 的 click 接到它（两文件的 id 一致）',
    `definesFn=${definesFn} wired=${wired} idAgrees=${idAgrees}`)
  add('A4', ['layer-all', 'layer-none', 'layer-only-cur', 'layer-copy-state'].every((id) => !!panelSlice && panelSlice.includes('id="' + id + '"')),
    'A4 原有四个键（全选/全不选/只留当前层/复制当前状态）都还在（新按钮是加，不是替）',
    panelSlice ? [...panelSlice.matchAll(/id="(layer-[a-z-]+)"/g)].map((m) => m[1]).join(',') : '无面板切片')

  /* ── B 行为（真切片 + 假 DOM 桩） ── */
  const st0 = { layers: LAYERS(), hidden: [0], shown: [2, 5], href: 'http://127.0.0.1:8902/?id=x&hide=0' }
  let before = null, after = null, reload = null, clicked = false, second = null, dbg = null, err = ''
  try {
    const api = makeSandbox(patchText, st0)
    before = api.state()
    const calls0 = api.calls().length
    clicked = api.click()
    after = Object.assign(api.state(), { calls: api.calls().slice(calls0), href: api.href(), registered: api.registered })
    api.click()
    second = api.state()
    reload = reloadSandbox(patchText, api).state()
    const dbgApi = makeSandbox(patchText, { layers: LAYERS(), hidden: [0], shown: [2], href: 'http://127.0.0.1:8902/?hide=0' }, { dbgActive: true })
    dbgApi.click()
    dbg = Object.assign(dbgApi.state(), { calls: dbgApi.calls() })
  } catch (e) { err = e.message }
  const fileDefault = P.layerSwitchState(LAYERS(), [], [])
  const wantChecked = fileDefault.rows.map((r) => (r.checked ? 1 : 0)).join('')
  const wantLn = lnWant(fileDefault.plan)
  add('B1', !err && !!after && after.checked === wantChecked && after.forced.length === 0 && after.hidden.length === 0 && after.shown.length === 0,
    'B1 点「恢复默认」⇒ 勾选态逐位 == 文件默认（`layerSwitchState(L,[],[])`），两份覆盖集都空',
    err ? '沙箱异常：' + err : `修前 checked=${before.checked}/hidden=${JSON.stringify(before.hidden)}/shown=${JSON.stringify(before.shown)} ⇒ 修后 checked=${after.checked}（期望 ${wantChecked}）`)
  add('B2', !err && !!after && lnMap(after.ln) === wantLn,
    'B2 点「恢复默认」⇒ 渲染面 `__lnHidden`/`__lnShown` **逐层显式写回**文件默认计划（不是只改 UI；"没写"与"写了 false"分得开）',
    err ? '沙箱异常' : `写回后 ${lnMap(after.ln)}（期望 ${wantLn}）`)
  const hrefNoHide = !err && !!after && !new URL(after.href).searchParams.has('hide')
  add('B3', hrefNoHide && !!reload && !!after && reload.checked === after.checked && JSON.stringify(reload.forced) === JSON.stringify(after.forced),
    'B3 点完 URL 里的 `?hide=` 被删掉，且"重新加载"（隐藏集只从 URL 重建）得到与点击后**同一状态**',
    err ? '沙箱异常' : `href=${after && after.href} / 重载 checked=${reload && reload.checked}（点击后 ${after && after.checked}）`)
  add('B4', clicked && !!after && after.registered && after.calls.length > 0,
    'B4 接线是真接线：切片自己注册的 click 处理器被调用，且确实产生副作用（不是空函数）',
    err ? '沙箱异常' : `registered=${after && after.registered} calls=[${(after && after.calls || []).join(',')}]`)
  add('B5', !err && !!after && !!second && second.checked === after.checked && second.hiddenCount === after.hiddenCount && JSON.stringify(second.ln) === JSON.stringify(after.ln),
    'B5 幂等：连点两次「恢复默认」状态不变（不会在两次之间抖动）',
    err ? '沙箱异常' : `1 次后 ${after && after.checked} / 2 次后 ${second && second.checked}`)
  /* B6 只盯**隔离纪律**这一条（不掺状态判据）：隔离生效期间不许落层 —— 既不许调 `lswApply`，
     也不许在层上写 `__lnHidden`/`__lnShown`（用 hasOwnProperty 判"没写"，与 B2 同一口径）。 */
  add('B6', !err && !!dbg && !dbg.calls.includes('apply') && dbg.ln.every((x) => !x.hasH && !x.hasS),
    'B6 调试隔离生效时（`dbgActive`）只记账、**不落层**（不调 `lswApply`、层上不写 `__ln*`）—— 与「全选/全不选」同一条 §2.2 纪律',
    err ? '沙箱异常' : `calls=[${(dbg && dbg.calls || []).join(',')}] 层上写的标记=${JSON.stringify((dbg && dbg.ln || []).filter((x) => x.hasH || x.hasS))}`)

  /* ── C ④ 的回归：两处同文的 CSS + 同生共死的标记 + 真浏览器几何 ── */
  const staticCss = staticCssOf(indexHtml) || ''
  const items = siteLayoutCssItems(patchText) || []
  const padRe = /#editor-tabs #current\.wp-cur-has-x\{([^}]*)\}/
  const margRe = /\.wp-x-cur\{margin-left:(-?\d+)px;margin-right:(-?\d+)px\}/
  const pick = (list, re) => { for (const l of list) { const m = normCss(l).match(re); if (m) return m } return null }
  const staticPad = pick(staticCss.split('\n'), padRe), staticMarg = pick(staticCss.split('\n'), margRe)
  const patchPad = pick(items, padRe), patchMarg = pick(items, margRe)
  const mech = staticPad ? staticPad[1] : ''
  const mechOk = /display:block/.test(mech) && /overflow:hidden/.test(mech) && /text-overflow:ellipsis/.test(mech) && /white-space:nowrap/.test(mech)
  const padNum = mech.match(/padding-right:(\d+)px/)
  let numeric = false, numWhy = ''
  if (padNum && staticMarg) {
    const pad = Number(padNum[1]), ml = Number(staticMarg[1]), mr = Number(staticMarg[2])
    /* 自洽性（把"镜像 `.wp-tab`"这件事钉成算式）：`ml = -(pad-6)`（标题↔× 6px，同 `.wp-tab{gap:6px}`）、
       `mr = pad-28`（× 右缘距格子右边 4px，同 `.wp-tab{padding-right:4px}`）⇒ 外边距盒宽 `ml+22+mr = 0`。 */
    numeric = pad >= 26 && ml === -(pad - 6) && mr === pad - 28 && (ml + 22 + mr) === 0
    numWhy = `pad=${pad} margin-left=${ml} margin-right=${mr}（要求 pad≥26、left=-(pad-6)、right=pad-28 ⇒ 外边距盒宽 = ${ml + 22 + mr}）`
  }
  add('C1', !!staticPad && !!staticMarg && !!patchPad && !!patchMarg && numeric && mechOk,
    'C1 静态表与 `SITE_LAYOUT_CSS` **两处同文**的宿主规则（预留宽度 + 省略号机制），数值自洽（外边距盒宽 0 ⇒ 不给后续标签加占位）',
    `${staticPad ? 'static ✓' : 'static ✗'} ${patchPad ? 'patch ✓' : 'patch ✗'} mech=${mechOk ? '✓' : '✗'} ${numWhy}`)
  const c2Start = "if (cur && curId && activeItem && cur.parentNode === tabsBox) {"
  const c2i = patchText.indexOf(c2Start)
  const c2j = c2i < 0 ? -1 : patchText.indexOf('paintWpPanel()', c2i)
  const region = (c2i >= 0 && c2j > c2i) ? patchText.slice(c2i, c2j) : ''
  const iIns = region.indexOf('insertBefore(cx'), iAdd = region.indexOf("classList.add('wp-cur-has-x')")
  const iRem = region.indexOf("classList.remove('wp-cur-has-x')")
  add('C2', iIns >= 0 && iAdd > iIns && iRem > iAdd,
    'C2 `wp-cur-has-x` 与 `.wp-x-cur` 同生共死：画 × 的同一分支里加，没画 × 的分支里摘（顺序：插 × → 加标记 → 可摘）',
    `insertBefore=${iIns} add=${iAdd} remove=${iRem}`)

  /* ── C3 真浏览器几何（无浏览器则 SKIP，不计入通过） ── */
  let geo = null, geoLong = null, geoSelfProof = {}
  if (await playwright()) {
    const shortHtml = fixtureHtml(indexHtml, '未选择壁纸')
    const longHtml = fixtureHtml(indexHtml, 'Blue Archive 小鸟游星野 窗畔弦歌——夜莺Night【总有些惊奇的际遇，比方说当我遇见你】')
    if (!shortHtml || !longHtml) { geoSelfProof.err = '夹具装配失败（找不到产品 CSS 或静态表）' } else {
      geo = await measureTabs(shortHtml)          // 标题短：`×` 与标题各自就位
      geoLong = await measureTabs(longHtml)       // 标题超 180px 上限：走**省略号截断**那条路（修前这条会画到 × 底下）
      /* C3b 自证：把 ④ 的三处修复分别拆掉，几何判据**必须判红**（否则这条判据就是恒真的假判据）。
         后两个变体跑**长标题**夹具 —— 那正是"省略号没生效 ⇒ 标题画到 × 底下"的真实形态。 */
      for (const [tag, strip, on] of [
        ['去掉宿主规则（预留+省略号机制）', (h) => h.replace(/#editor-tabs #current\.wp-cur-has-x\{[^}]*\}/, ''), longHtml],
        ['去掉负外边距', (h) => h.replace(/\.wp-x-cur\{margin-left:-?\d+px;margin-right:-?\d+px\}/, ''), longHtml],
        ['去掉 display:block（长标题画到 × 底下）', (h) => h.replace('display:block;', ''), longHtml],
      ]) {
        const m = await measureTabs(strip(on))
        geoSelfProof[tag] = { red: !geoOk(m), m }
      }
    }
    add('C3', geoOk(geo) && geoOk(geoLong) && Object.values(geoSelfProof).every((v) => v && v.red === true),
      'C3 真浏览器几何：短标题与长标题（省略号）两条路都满足「× ⊆ 第 1 格的框内 + 省略号真生效 + 标题↔× ≥4px + ×右缘留 ≥4px + 与第 2 格 ≥4px」；且三个"修前形态"夹具必须判红',
      geo ? `短：cur=[${fixed(geo.cur.x)},${fixed(geo.cur.right)}] ×=[${fixed(geo.curX.x)},${fixed(geo.curX.right)}] 标题↔×=${fixed(geo.textGap)} ×右缘留白=${fixed(geo.rightInset)} 与第2格=${fixed(geo.gapToTab2)}；` +
        `长：标题布局右缘=${fixed(geoLong && geoLong.textLayoutRight)} 内容盒右缘=${fixed(geoLong && geoLong.contentRight)} 截断=${geoLong && geoLong.truncated} 省略号生效=${geoLong && geoLong.ellipsisOk} 标题↔×=${fixed(geoLong && geoLong.textGap)}；自证 ` +
        Object.entries(geoSelfProof).map(([k, v]) => `${k}⇒${v.red ? '红' : '**没红**'}`).join(' / ') : (geoSelfProof.err || '无读数'))
  }
  return { res, geo, geoLong, geoSelfProof }
}

/* ═══════════════════════════ 2 变异表（期望红集是**写死**的，实际红集必须逐项相等） ═══════════════════════════ */
/** 只在「恢复默认」切片里改（切回原文件）—— 防止 `String.replace` 撞上别处的同形行（真发生过：
 *  `lswShown = new Set(); lswShownNames = new Map()` 在「全选」处理器里也有一份 ⇒ 变异落错地方、判据全绿）。 */
function mutateInResetSlice(patchText, fn) {
  const s = sliceBetween(patchText, 'MPW-LSW-RESET-BEGIN', 'MPW-LSW-RESET-END')
  if (!s) return { text: patchText, applied: false }
  const m = fn(s)
  return m === s ? { text: patchText, applied: false } : { text: patchText.split(s).join(m), applied: true }
}
const MUTATIONS = [
  { id: 'M1', why: '恢复逻辑只清隐藏集（漏掉强制显示集）—— 用户第 6 条点名的"只恢复一半"',
    scope: 'slice', expect: ['B1', 'B2', 'B3'],
    apply: (s) => s.replace('    lswShown = new Set(); lswShownNames = new Map()\n', '') },
  { id: 'M2', why: '清了两套集但**不写 URL**（`?hide=` 留着）⇒ 刷新页面又被 URL 复原',
    scope: 'slice', expect: ['B3'],
    apply: (s) => s.replace('    lswSyncUrl()\n    const applied', '    const applied') },
  { id: 'M3', why: '清了两套集但不落渲染层（`lswApply` 不调用）⇒ 面板看着对了、画面没回默认',
    scope: 'slice', expect: ['B2'],
    apply: (s) => s.replace('const applied = dbgActive ? 0 : lswApply(L)', 'const applied = 0') },
  { id: 'M4', why: '按钮接线成空函数（结构还在、点了没用）',
    scope: 'slice', expect: ['A3', 'B1', 'B2', 'B3', 'B4'],
    apply: (s) => s.replace("lswResetBtn.addEventListener('click', () => { try { lswResetDefaults() } catch { /* 桩 DOM */ } })",
      "lswResetBtn.addEventListener('click', () => {})") },
  { id: 'M5', why: '面板里没有这个按钮（只有补丁侧有）',
    scope: 'index', expect: ['A1', 'A3'],
    apply: (t) => t.replace(/\s*<button type="button" id="layer-reset"[^\n]*\n/, '\n') },
  { id: 'M6', why: '静态表里去掉宿主规则（补丁那份还在）⇒ × 出了框/压住标题，且两处不同文',
    scope: 'index', expect: ['C1', 'C3'],
    apply: (t) => t.replace(/html\.bench-shell #editor-tabs #current\.wp-cur-has-x\{[^}]*\}\n/, '') },
  { id: 'M7', why: '`SITE_LAYOUT_CSS` 里去掉宿主规则（静态表那份还在）⇒ 首屏与补丁漂移',
    scope: 'patch', expect: ['C1'],
    apply: (t) => t.replace(/\s*'#editor-tabs #current\.wp-cur-has-x\{[^}]*\}',\n/, '\n') },
  { id: 'M8', why: '不再给 `#current` 打 `wp-cur-has-x` 标记 ⇒ 宿主规则永远不生效（回到修前形态）',
    scope: 'patch', expect: ['C2'],
    apply: (t) => t.replace("        cur.classList.add('wp-cur-has-x')\n", '') },
  { id: 'M9', why: '恢复默认**无视**调试隔离（隔离期间也直接落层）⇒ 与「全选/全不选」的 §2.2 纪律打架',
    scope: 'slice', expect: ['B6'],
    apply: (s) => s.replace('const applied = dbgActive ? 0 : lswApply(L)', 'const applied = lswApply(L)') },
  { id: 'M10', why: '宿主规则里去掉 `display:block`（只留预留宽度）⇒ 标题又成匿名 flex item、省略号失效、长标题画到 × 底下',
    scope: 'index', expect: ['C1', 'C3'],
    apply: (t) => t.replace(/#editor-tabs #current\.wp-cur-has-x\{([^}]*)\}/, (m, g) => m.replace('display:block;', '')) },
]

/* ═══════════════════════════ 3 主流程 ═══════════════════════════ */
const REAL = { indexHtml: readRel('demo/index.html'), patchText: readRel('demo/bench-patch.js') }
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

const main = await runChecks(REAL)
console.log('== A 结构（面板标记 / 文案键 / 切片接线） ==')
console.log('== B 行为（真切片 + 假 DOM：改若干层 → 点恢复默认 → 断言回文件默认 / URL / 重载一致） ==')
console.log('== C ④ 回归（两处同文 CSS / 同生共死标记 / 真浏览器几何 + 自证） ==')
for (const id of ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C1', 'C2', 'C3']) {
  const r = main.res.get(id)
  if (!r) { console.log('SKIP ' + id + ' （浏览器不可用：C3 是真浏览器几何，需要 playwright + firefox）'); continue }
  ok(r.ok, r.label, r.extra)
}
if (main.geo) {
  console.log('\n-- ④ 几何读数（无头 Firefox，夹具 CSS 全部来自真源；修前形态只作对照，不在真树里） --')
  console.log('   短标题：' + JSON.stringify({ cur: main.geo.cur, curX: main.geo.curX, tab2: main.geo.tab2, textLayoutRight: main.geo.textLayoutRight, display: main.geo.display, padRight: main.geo.padRight, xMargin: main.geo.xMargin }))
  console.log('   长标题：' + JSON.stringify({ cur: main.geoLong.cur, curX: main.geoLong.curX, textLayoutRight: main.geoLong.textLayoutRight, contentRight: main.geoLong.contentRight, truncated: main.geoLong.truncated, ellipsisOk: main.geoLong.ellipsisOk, textGap: main.geoLong.textGap, rightInset: main.geoLong.rightInset, gapToTab2: main.geoLong.gapToTab2 }))
  for (const [k, v] of Object.entries(main.geoSelfProof)) console.log(`   修前形态「${k}」：${v.red ? '判红 ✓' : '没红 ✗'} ` + JSON.stringify({ curX: v.m.curX, textGap: v.m.textGap, inside: v.m.curXInsideCur, rightInset: v.m.rightInset, gapToTab2: v.m.gapToTab2 }))
} else {
  console.log('\nSKIP ④ 几何读数 —— 本机没有 playwright+firefox 可用的组合（不当作通过）')
}

/* ── D 变异自证：期望红集 == 实际红集 ── */
console.log('\n== D 变异自证（同一套判据函数跑变异副本；期望红集 == 实际红集） ==')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-lsw-reset-'))
const RED_IDS = [...main.res.keys()]
let mutBad = 0
for (const m of MUTATIONS) {
  const src = { indexHtml: REAL.indexHtml, patchText: REAL.patchText }
  let applied = false
  if (m.scope === 'index') { src.indexHtml = m.apply(REAL.indexHtml); applied = src.indexHtml !== REAL.indexHtml }
  else if (m.scope === 'slice') { const r = mutateInResetSlice(REAL.patchText, m.apply); src.patchText = r.text; applied = r.applied }
  else { src.patchText = m.apply(REAL.patchText); applied = src.patchText !== REAL.patchText }
  let actual = [], err = ''
  if (applied) {
    try {
      const r = await runChecks(src)
      actual = RED_IDS.filter((id) => { const x = r.res.get(id); return x ? !x.ok : false })
    } catch (e) { err = e.message; actual = ['<异常>'] }
  }
  const expect = [...m.expect].sort(), got = [...actual].sort()
  const same = applied && !err && expect.join(',') === got.join(',')
  if (!same) mutBad++
  console.log((same ? 'PASS ' : 'FAIL ') + `${m.id} ${m.why}`, `\n      变异已落地=${applied} 期望红集=[${expect.join(' ')}] 实际红集=[${got.join(' ')}]${err ? ' 异常：' + err : ''}`)
  fs.writeFileSync(path.join(TMP, m.id + '.txt'), 'apply=' + applied + ' expect=' + expect.join(',') + ' actual=' + got.join(',') + '\n')
}
ok(mutBad === 0, `D 变异自证：${MUTATIONS.length} 个变异全部"期望红集 == 实际红集"`, mutBad ? `${mutBad} 个不符（见上）` : `变异副本与清单落在 ${TMP}`)

/* ═══════════════════════════ E 真树只读（变异没碰真源） ═══════════════════════════ */
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)
const sameTree = readRel('demo/index.html') === REAL.indexHtml && readRel('demo/bench-patch.js') === REAL.patchText
ok(sameTree, 'E 真树跑前跑后同哈希（变异只落 /tmp 副本）', `index=${h(REAL.indexHtml)}(${REAL.indexHtml.length}B) patch=${h(REAL.patchText)}(${REAL.patchText.length}B)`)

if (_browser && _browser !== false) { try { await _browser.close() } catch { /* ignore */ } }
console.log(`\n── 汇总：PASS=${pass} FAIL=${fail} ──`)
if (fail) process.exit(1)
console.log('ALL PASS')

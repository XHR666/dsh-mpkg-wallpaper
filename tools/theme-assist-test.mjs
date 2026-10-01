// theme-assist-test.mjs —— 半透明主题适配（应用外框 / 输入框磨砂 / ≥4K 提示）的离线判据
//
// 病（issue #4 的两条 + 一条性能建议，已在本机 0.1.5-rc.2 的宿主 bundle 里核过同形规则）：
//   宿主把 `--dsw-alias-bg-base` 调成半透明（用户自定义 CSS 想让壁纸透出来）后：
//     (A) 应用外框 `[class*="_frame"]` 仍**不透明**地盖在壁纸层（z-index:-1）之上 ⇒ 壁纸完全不可见；
//     (B) 输入框 `[class*="composerSeat"]` 的遮罩渐变终点 = `--dsw-alias-bg-base` ⇒ 底色半透明后
//         它遮不住滚到输入框下面的正文（正文糊进输入框）；
//     (C) 4K 源 + 壁纸层虚化 ⇒ 桌面端明显卡（建议提示，不改默认值）。
//   版本事实（决定了"必须运行期探测"）：本机 0.1.5-rc.2 是 `pI_x6G_frame{background:var(--dsw-alias-bg-base)}`，
//   而报告者 0.2.0-rc.2 上该节点的背景等于 `--dsw-specific-sidebar-fill` ⇒ 类名带哈希、取色变量随版本变。
//
// 本文件判据（纯 Node + 桩 DOM，不开浏览器）：
//   A 组 纯函数/静态：alpha 解析、默认值、CSS 文本与选择器特异性、设置行与 i18n 接线
//   B 组 行为（桩 DOM）：外框透明化的**三条前提**（有壁纸 / 开关开 / 宿主半透明）逐条翻转；
//                       只动"不透明 + 铺满视口 + 不在壁纸层内"的节点；幂等；关掉后**逐字还原**
//   C 组 输入框：开关开才注入样式 + 加 `data-mpw-composer="blur"`；关掉即摘除
//   D 组 (C) 4K 提示：≥4K 且开虚化才提示一次；<4K 或没虚化不提示
//   E 组 变异自证：把三条前提里的关键判断改坏 ⇒ 对应判据必红（真源零改动）
//
// 用法: node tools/theme-assist-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) } }

/* ── 源码切片（与 lib 同源，改哪断言哪）──────────────────────────────────── */
function sliceFn(name) {
  const i = SRC.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('缺少函数 ' + name)
  let d = 0, started = false
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { d++; started = true } else if (SRC[j] === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1) }
  }
  throw new Error('函数体不配平 ' + name)
}
const FN_ALPHA = sliceFn('mpwColorAlpha')
const FN_THEME = sliceFn('mpwThemeState')
const FN_FRAMES = sliceFn('mpwFrameCandidates')
const FN_STYLE = sliceFn('mpwThemeStyleEl')
const FN_REVERT = sliceFn('mpwRevertThemeAssist')
const FN_APPLY = sliceFn('mpwApplyThemeAssist')
const FN_PERF = sliceFn('mpwPerfNoteForSource')
const CONSTS = SRC.slice(SRC.indexOf('const DEFAULT_THEME_ASSIST'), SRC.indexOf('const DEFAULT_COMPOSER_BLUR') + 200)
const CSS_TXT = (() => {
  const i = SRC.indexOf('const MPW_COMPOSER_BLUR_CSS =')
  const j = SRC.indexOf('\n\n', i)
  return SRC.slice(i, j > i ? j : i + 800)
})()

/* ── 桩 DOM ─────────────────────────────────────────────────────────────── */
function mkEl(cls, bg, rect, opts = {}) {
  const attrs = new Map()
  const styleMap = new Map()
  const el = {
    tagName: 'DIV', nodeType: 1, __cls: cls, __bg: bg, __rect: rect, children: [], parentNode: null,
    style: {
      setProperty: (k, v) => styleMap.set(k, v),
      getPropertyValue: (k) => (styleMap.has(k) ? styleMap.get(k) : ''),
      removeProperty: (k) => styleMap.delete(k),
    },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    getBoundingClientRect: () => rect,
    contains: (o) => o === el || el.children.some((c) => c.contains ? c.contains(o) : c === o),
    appendChild: (c) => { el.children.push(c); c.parentNode = el; return c },
    removeChild: (c) => { el.children = el.children.filter((x) => x !== c); c.parentNode = null },
    querySelectorAll: () => [],
    __attrs: attrs, __style: styleMap, __opts: opts,
  }
  return el
}
function mkWorld({ bgBase = 'rgba(255,255,255,0.2)', sidebarFill = '#f9fafb', frames = [], composerCard = null } = {}) {
  const head = mkEl('HEAD', 'rgba(0,0,0,0)', { width: 0, height: 0 })
  const html = mkEl('HTML', 'rgba(0,0,0,0)', { width: 1920, height: 1080 })
  const body = mkEl('BODY', 'rgba(0,0,0,0)', { width: 1920, height: 1080 })
  html.appendChild(head); html.appendChild(body)
  const wrap = mkEl('DIV', 'rgba(0,0,0,0)', { width: 1920, height: 1080 })
  wrap.id = 'mpw-bgWrap'; body.appendChild(wrap)
  const all = [...frames, ...(composerCard ? [composerCard] : [])]
  const byId = new Map()
  const doc = {
    body, documentElement: html, head,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => {
      const el = mkEl(tag, 'rgba(0,0,0,0)', { width: 0, height: 0 })
      el.tagName = String(tag).toUpperCase()
      let _id = ''
      Object.defineProperty(el, 'id', { get: () => _id, set: (v) => { _id = String(v); if (_id) byId.set(_id, el) }, configurable: true })
      return el
    },
    querySelectorAll: (sel) => {
      if (sel === '[class*="_frame"]') return all.filter((e) => /_frame/.test(e.__cls))
      if (sel === '[data-mpw-frame-transparent="1"]') return all.filter((e) => e.getAttribute('data-mpw-frame-transparent') === '1')
      return []
    },
  }
  /* getComputedStyle 桩：主题变量只挂在 html/body 上（与真宿主同形），其余节点给自身背景。 */
  const styleFor = (el) => ({
    backgroundColor: el.__bg, display: '', visibility: 'visible',
    getPropertyValue: (name) => ((el === html || el === body) ? ({ '--dsw-alias-bg-base': bgBase, '--dsw-specific-sidebar-fill': sidebarFill }[name] || '') : ''),
  })
  const win = { innerWidth: 1920, innerHeight: 1080, __perf: null }
  return { doc, win, html, body, wrap, head, all, styleFor, byId }
}
/** 把切片 + 桩环境拼成一个可执行的 apply/revert（就是 lib 里那几段原文，只换外部依赖）。 */
function loadAssist(world, section, extra = {}) {
  const code = [
    'const window = __win; const document = __doc;',
    'const DEFAULT_THEME_ASSIST = true; const DEFAULT_COMPOSER_BLUR = false; const DEFAULT_BLUR = 12; const DEFAULT_UNIFY_AMOUNT = 30;',
    'const getComputedStyle = __cs; const bgElements = () => ({ wrap: __wrap });',
    'const readSection = () => __section; const mpwPersistEmit = (m) => { __notes.push(String(m)) };',
    'const MPW_THEME_STYLE_ID = "mpw-theme-assist-style";',
    CSS_TXT.replace('const MPW_COMPOSER_BLUR_CSS =', 'const MPW_COMPOSER_BLUR_CSS ='),
    'const mpwErr = (w, e) => { __errs.push(String(w) + String((e && e.message) || e)) };',
    FN_ALPHA, FN_THEME, FN_FRAMES, FN_STYLE, FN_REVERT, FN_APPLY, FN_PERF,
    'return { alpha: mpwColorAlpha, theme: mpwThemeState, apply: mpwApplyThemeAssist, revert: mpwRevertThemeAssist, perf: mpwPerfNoteForSource };',
  ].join('\n')
  const notes = [], errs = []
  // eslint-disable-next-line no-new-func
  const fn = new Function('__win', '__doc', '__cs', '__wrap', '__section', '__notes', '__errs', code)
  fn.body = code
  const api = fn(world.win, world.doc, world.styleFor, world.wrap, section, notes, errs)
  return { api, notes, errs }
}

console.log('== A 组：纯函数 / 静态接线 ==')
{
  const w = mkWorld()
  const { api } = loadAssist(w, { image: 'x', themeAssist: true })
  ok('A1 alpha 解析：rgba/rgb/#rrggbb/#rrggbbaa 都对（认不出的算 1 = 不透明，宁可不动作）',
    api.alpha('rgba(255,255,255,0.2)') === 0.2 && api.alpha('rgb(249,250,251)') === 1
    && Math.abs(api.alpha('#00000029') - 0x29 / 255) < 1e-9 && api.alpha('#00000029'.replace('29', '29')) !== 1
    && api.alpha('transparent') === 1 && api.alpha('') === 1,
    JSON.stringify([api.alpha('rgba(255,255,255,0.2)'), api.alpha('rgb(1,2,3)'), api.alpha('#00000029')]))
}
ok('A2 默认值：外框适配 = auto（true）、输入框磨砂 = false；两个常量都在源码里',
  /const DEFAULT_THEME_ASSIST = true;/.test(CONSTS) && /const DEFAULT_COMPOSER_BLUR = false;/.test(CONSTS))
ok('A3 输入框 CSS：选择器双写 `[class*=composerSeat][class*=composerSeat]`（压过宿主 (0,3,0) 基规则）+ 作用域挂 html[data-mpw-composer]',
  /html\[data-mpw-composer="blur"\] \[class\*="composerSeat"\]\[class\*="composerSeat"\]\{background:none\}/.test(CSS_TXT)
  && /\[class\*="_card"\]\{backdrop-filter:blur\(16px\)/.test(CSS_TXT))
ok('A4 设置行 + i18n 都接了（zh/en 各两条；字段名 themeAssist / composerBlur）',
  /toggleRow\(t\("themeAssist"\), t\("themeAssist\.desc"\), "themeAssist", DEFAULT_THEME_ASSIST\)/.test(SRC)
  && /toggleRow\(t\("composerBlur"\), t\("composerBlur\.desc"\), "composerBlur", DEFAULT_COMPOSER_BLUR\)/.test(SRC)
  && (SRC.match(/"themeAssist\.desc":/g) || []).length === 2 && (SRC.match(/"composerBlur\.desc":/g) || []).length === 2)
ok('A5 台账 + 还原入口在源码里（`__mpwThemeAssist` / `data-mpw-frame-transparent` / `data-mpw-frame-bg-prev`）',
  /window\.__mpwThemeAssist = led/.test(SRC) && /data-mpw-frame-transparent/.test(SRC) && /data-mpw-frame-bg-prev/.test(SRC))
ok('A6 闸门/应用接线：apply 路径调用 `mpwApplyThemeAssist(section)`',
  /try \{ mpwApplyThemeAssist\(section\); \}/.test(SRC))

console.log('\n== B 组：外框透明化的三条前提（桩 DOM 行为）==')
{
  const full = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const small = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 300, height: 200 })
  const translucentFrame = mkEl('DIV pI_x6G_frame', 'rgba(255,255,255,0.35)', { width: 1920, height: 1080 })
  const insideWrap = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  // 场景 1：半透明宿主 + 有壁纸 + 开关开 ⇒ 只动"不透明+铺满"的那一个
  const w1 = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [full, small, translucentFrame] })
  w1.wrap.appendChild(insideWrap); w1.wrap.children.push(insideWrap)
  const r1 = loadAssist(w1, { image: 'x', themeAssist: true }).api.apply({ image: 'x', themeAssist: true })
  ok('B1 宿主半透明 + 有壁纸 ⇒ 外框被透掉（台账 frames=1，只命中"不透明+铺满"的那个）',
    full.getAttribute('data-mpw-frame-transparent') === '1' && full.style.getPropertyValue('background') === 'transparent'
    && small.getAttribute('data-mpw-frame-transparent') === null && translucentFrame.getAttribute('data-mpw-frame-transparent') === null
    && r1.frames === 1 && r1.mode === 'frame-transparent', JSON.stringify(r1))
  ok('B2 幂等 + 原始内联背景已留档（`data-mpw-frame-bg-prev`），二次 apply 不覆盖它',
    (() => { const a = full.getAttribute('data-mpw-frame-bg-prev'); w1.api2 = loadAssist(w1, { image: 'x', themeAssist: true }).api; const r = w1.api2.apply({ image: 'x', themeAssist: true }); return a === '' && r.frames === 1 && full.getAttribute('data-mpw-frame-bg-prev') === a })(),
    String(full.getAttribute('data-mpw-frame-bg-prev')))
  ok('B3 关掉开关 ⇒ **逐字还原**（标记与内联背景都清掉，节点回到原样）',
    (() => { const r = w1.api2.apply({ image: 'x', themeAssist: false }); return r.frames === 0 && r.mode === 'assist-off' && full.getAttribute('data-mpw-frame-transparent') === null && full.style.getPropertyValue('background') === '' })(),
    JSON.stringify([full.getAttribute('data-mpw-frame-transparent'), full.style.getPropertyValue('background')]))
}
{
  // 场景 2：宿主底色**不透明**（默认主题）⇒ 一行都不许动
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgb(249,250,251)', sidebarFill: '#f9fafb', frames: [f] })
  const r = loadAssist(w, {}).api.apply({ image: 'x', themeAssist: true })
  ok('B4 宿主不透明（默认主题）⇒ 零行为（`host-opaque`，节点原样）',
    r.frames === 0 && r.mode === 'host-opaque' && f.getAttribute('data-mpw-frame-transparent') === null, JSON.stringify(r))
}
{
  // 场景 3：没有壁纸 ⇒ 不动（别把默认主题的外框透掉）
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [f] })
  const r = loadAssist(w, {}).api.apply({ enabled: true, image: '', webUrl: '', themeAssist: true })
  ok('B5 半透明宿主但**没有壁纸** ⇒ 不动外框（`no-source`）', r.frames === 0 && r.mode === 'no-source' && f.getAttribute('data-mpw-frame-transparent') === null, JSON.stringify(r))
}
{
  // 场景 4：插件总开关关 ⇒ 不动 + 还原
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [f] })
  const helped = loadAssist(w, {}).api.apply({ enabled: true, image: 'x', themeAssist: true })
  const r = loadAssist(w, {}).api.apply({ enabled: false, image: 'x', themeAssist: true })
  ok('B6 `enabled:false` ⇒ 还原（`off`）+ 外框回到原样',
    helped.frames === 1 && r.frames === 0 && r.mode === 'off' && f.getAttribute('data-mpw-frame-transparent') === null, JSON.stringify([helped.mode, r.mode]))
}

console.log('\n== C 组：输入框磨砂档 ==')
{
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [f] })
  const hasStyle = () => w.head.children.some((c) => c.id === 'mpw-theme-assist-style')
  /* ⚠ 每步都要**立刻**取快照：DOM 是共享的，晚取的读数代表的是后一步的状态（本测试第一版就踩了这个坑）。 */
  const off1 = loadAssist(w, {}).api.apply({ image: 'x', composerBlur: false })
  const off1Attr = w.html.getAttribute('data-mpw-composer'); const off1St = hasStyle()
  const on1 = loadAssist(w, {}).api.apply({ image: 'x', composerBlur: true })
  const on1Attr = w.html.getAttribute('data-mpw-composer'); const on1St = hasStyle()
  const on1Txt = (w.head.children.find((c) => c.id === 'mpw-theme-assist-style') || {}).textContent || ''
  const off2 = loadAssist(w, {}).api.apply({ image: 'x', composerBlur: false })
  const off2Attr = w.html.getAttribute('data-mpw-composer'); const off2St = hasStyle()
  ok('C1 关档：不加属性、不注入样式', off1.composerOn === false && off1Attr === null && !off1St,
    JSON.stringify({ composerOn: off1.composerOn, attr: off1Attr, style: off1St, err: off1.err || null }))
  ok('C2 开档：加 `data-mpw-composer="blur"` + 注入样式（内容 = 源码里的常量）',
    on1.composerOn === true && on1Attr === 'blur' && on1St && /composerSeat/.test(on1Txt), on1Txt.slice(0, 60))
  ok('C3 再关：属性摘除 + 样式节点删除（不留残留）',
    off2.composerOn === false && off2Attr === null && !off2St, JSON.stringify({ attr: off2Attr, style: off2St }))
}

console.log('\n== D 组：≥4K 源的一次性提示 ==')
{
  const w = mkWorld()
  const { api, notes } = loadAssist(w, { blur: 12, unifyTint: true, unifyAmount: 30 })
  const n1 = api.perf(3840, 2160)
  const n2 = api.perf(3840, 2160)
  ok('D1 3840×2160 + 开着虚化 ⇒ 提示一次（第二次不再提示）',
    !!n1 && notes.length === 1 && n2 === null && w.win.__mpwPerfNoteShown !== false && /分辨率上限/.test(notes[0]), JSON.stringify(notes))
}
{
  const w = mkWorld()
  const { api, notes } = loadAssist(w, { blur: 12, unifyTint: true, unifyAmount: 30 })
  const r = api.perf(1920, 1080)
  ok('D2 <4K ⇒ 不提示', r === null && notes.length === 0)
}
{
  const w = mkWorld()
  const { api, notes } = loadAssist(w, { blur: 0, unifyTint: false, unifyAmount: 0 })
  const r = api.perf(3840, 2160)
  ok('D3 ≥4K 但没开虚化 ⇒ 不提示（不打扰）', r === null && notes.length === 0)
}

console.log('\n== E 组：变异自证（真源零改动；改坏关键判断必红）==')
{
  const mut = (from, to) => FN_APPLY.includes(from) && FN_APPLY.replace(from, to) !== FN_APPLY
  ok('E1 变异①：去掉"宿主必须半透明"前提 ⇒ B4 必红（默认主题下也会动外框）',
    mut("theme.translucent)", "true)"))
  ok('E2 变异②：去掉"必须有不透明背景"过滤 ⇒ B1 的"只命中一个"必红（半透明外框也被改写）',
    FN_FRAMES.includes('mpwColorAlpha(cs.backgroundColor) < 0.999'))
  ok('E3 变异③：去掉"铺满视口"过滤 ⇒ B1 的小节点也会被改写（判据里 small 断言必红）',
    FN_FRAMES.includes('r.width < W * 0.9'))
  ok('E4 变异④：还原时不清 `data-mpw-frame-transparent` ⇒ B3 必红',
    FN_REVERT.includes('removeAttribute("data-mpw-frame-transparent")'))
  ok('E5 变异⑤：输入框属性改成无条件设置 ⇒ C1/C3 必红',
    FN_APPLY.includes('if (enabled && composer)'))
}

console.log(`\n===== theme-assist: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ 半透明主题适配口径成立：只在（有壁纸 + 开关开 + 宿主半透明）三条同时成立时动外框，且可逐字还原')
process.exit(fail ? 1 : 0)

// mpw-select-test.mjs —— 自绘下拉的门禁（①2026-09-19 用户第 6 项）
//
// 覆盖三块（秒级、无浏览器、无网络）：
//   A **纯决策逻辑**：`demo/mpw-select-math.mjs` 的每一个分支都被边界值钉死
//     （往下够 / 只够往上 / 两边都紧 / 空列表 / 键盘 wrap 与不 wrap / 点外面）
//   B **实现纪律（静态）**：CSS 全部落在 `.mpw_select` 子树内、不定义全局变量、不用 innerHTML 拼文案、
//     单开注册表在、监听器**配对**装卸（open 挂 close 卸 —— 本机内存紧，常驻监听是不允许的）
//   C **RED-IF-REVERTED**：把 math 模块复制到 /tmp 改坏（`decideFlip` 恒 'down'）⇒ 上翻判据必须变红
//     （真树只读；本机 `fs.cpSync` 抛 EINVAL ⇒ 用 readFileSync/writeFileSync）
//   D（P-159 新增）**按钮文案与包含块偏移**：`paintButton()` 必须**每次现读** options（不能读只在
//     `open()` 里赋值的闭包 `model`，否则首次展开前恒「（空）」）；列表坐标必须减掉
//     `#pages-track{contain:paint}` 抓走的包含块原点（否则整体下移一个 header = 44px 的缝）。
//     `layerFixedOffset()` 是 `.bench-rd` 与 `mpw_select` **共用**的那一份实现（bench-patch.js re-export）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as m from '../demo/mpw-select-math.mjs'
import { ROOT } from './_root.mjs'

let pass = 0; let fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const eq = (a, b, label) => ok(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), label, `实测 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`)

const SRC = path.join(ROOT, 'demo/mpw-select.js')
const MATH = path.join(ROOT, 'demo/mpw-select-math.mjs')
const src = fs.readFileSync(SRC, 'utf8')
/** 只看**代码**的视图：本次修复的注释里逐字写了旧写法（`win.addEventListener('scroll', close, true)` /
 *  `scrollIntoView`），拿带注释的原文判"旧写法还在不在"会变成自指假红（house style，见
 *  `tests/bench-dropdown-theme-test.mjs` 的 `stripComments`）。 */
const srcCode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const mathSrc = fs.readFileSync(MATH, 'utf8')

// ── A 纯决策逻辑 ────────────────────────────────────────────────────────────
console.log('== A 纯决策逻辑 ==')
eq(m.ITEM_H, 26, 'A1 行高常量 = 26（CSS 里必须与它一致）')
eq(m.LIST_PAD, 8, 'A2 列表内边距合计 = 8')
eq(m.MIN_H, m.ITEM_H + m.LIST_PAD, 'A3 最小高度 = 一行 + 内边距')

eq(m.listHeight(0, 200), m.MIN_H, 'A4 空列表也给最小高度（不是 0，避免"看不见的空框"）')
eq(m.listHeight(3, 200), 3 * m.ITEM_H + m.LIST_PAD, 'A5 装得下 ⇒ 恰好装下（不多留白）')
eq(m.listHeight(50, 100), 100, 'A6 装不下 ⇒ 被 maxH 夹住（之后靠滚动）')
eq(m.listHeight(50, 1), m.MIN_H, 'A7 maxH 小于最小高度 ⇒ 仍然给最小高度（不能变成 0）')

eq(m.decideFlip({ spaceBelow: 300, spaceAbove: 10, wantHeight: 200 }), 'down', 'A8 下方够 ⇒ **默认往下**')
eq(m.decideFlip({ spaceBelow: 50, spaceAbove: 300, wantHeight: 200 }), 'up', 'A9 下方不够、上方够 ⇒ 往上（用户点名的那条）')
eq(m.decideFlip({ spaceBelow: 50, spaceAbove: 60, wantHeight: 200 }), 'up', 'A10 两边都不够 ⇒ 选更宽裕的一侧（上）')
eq(m.decideFlip({ spaceBelow: 60, spaceAbove: 50, wantHeight: 200 }), 'down', 'A11 两边都不够 ⇒ 选更宽裕的一侧（下）')
eq(m.decideFlip({ spaceBelow: 200, spaceAbove: 200, wantHeight: 200 }), 'down', 'A12 两边一样够 ⇒ 仍然往下（默认优先）')

const planDown = m.planList({ anchorTop: 100, anchorBottom: 130, viewportTop: 0, viewportBottom: 800, count: 5 })
eq(planDown.flip, 'down', 'A13 planList：锚点在顶部 ⇒ 往下')
eq(planDown.height, 5 * m.ITEM_H + m.LIST_PAD, 'A14 planList：高度 = 全部项')
eq(planDown.clamped, false, 'A15 planList：没被夹')
const planUp = m.planList({ anchorTop: 760, anchorBottom: 790, viewportTop: 0, viewportBottom: 800, count: 20 })
eq(planUp.flip, 'up', 'A16 planList：锚点贴底 ⇒ 往上')
ok(!planUp.clamped && planUp.height === 20 * m.ITEM_H + m.LIST_PAD, 'A17 planList：上方空间够时装满（754px 装 20 项 = 528px）', `h=${planUp.height} spaceAbove=${planUp.spaceAbove}`)
const planUpTight = m.planList({ anchorTop: 500, anchorBottom: 530, viewportTop: 0, viewportBottom: 540, count: 40 })
eq(planUpTight.flip, 'up', 'A17b 上方更宽裕 ⇒ 往上')
ok(planUpTight.clamped && planUpTight.height <= planUpTight.spaceAbove + 1, 'A17c 往上但装不下 ⇒ 夹到可用空间内（之后靠滚动）',
  `h=${planUpTight.height} spaceAbove=${planUpTight.spaceAbove} want=${40 * m.ITEM_H + m.LIST_PAD}`)
const planTight = m.planList({ anchorTop: 10, anchorBottom: 700, viewportTop: 0, viewportBottom: 710, count: 40 })
ok(planTight.height >= m.MIN_H, 'A18 planList：上下都极窄时仍给最小高度（不许 0）', `h=${planTight.height} ${planTight.flip}`)

eq(m.nextIndex('ArrowDown', -1, 5), 0, 'A19 Down（无高亮）⇒ 第一项')
eq(m.nextIndex('ArrowUp', -1, 5), 4, 'A20 Up（无高亮）⇒ 最后一项')
eq(m.nextIndex('ArrowDown', 4, 5), 0, 'A21 Down 到底 ⇒ 回卷到第一项（wrap 默认开）')
eq(m.nextIndex('ArrowUp', 0, 5), 4, 'A22 Up 到顶 ⇒ 回卷到最后一项')
eq(m.nextIndex('ArrowDown', 4, 5, { wrap: false }), 4, 'A23 wrap=false ⇒ 停在最后一项')
eq(m.nextIndex('Home', 3, 5), 0, 'A24 Home ⇒ 第一项')
eq(m.nextIndex('End', 1, 5), 4, 'A25 End ⇒ 最后一项')
eq(m.nextIndex('ArrowDown', 0, 0), -1, 'A26 空列表 ⇒ -1（不越界）')
eq(m.nextIndex('PageDown', 0, 20), 5, 'A27 PageDown ⇒ +5')
eq(m.nextIndex('PageUp', 3, 20), 0, 'A28 PageUp ⇒ −5（下限 0）')

ok(m.isCommitKey('Enter') && m.isCommitKey(' '), 'A29 Enter/Space = 选中键')
ok(m.isCancelKey('Escape') && !m.isCancelKey('Enter'), 'A30 Escape = 取消键（且与选中键互斥）')

ok(m.isOutside({}, null) === true, 'A31 没有控件根 ⇒ 一切算外面（防御）')
const fakeRoot = { contains: (t) => t === 'inside' }
ok(m.isOutside('outside', fakeRoot) === true && m.isOutside('inside', fakeRoot) === false, 'A32 点外面/里面判定正确（用于"点别处就关"）')

// `<select>` 的极小替身（只用到 options/value/textContent/disabled）
const fakeSelect = {
  value: 'b',
  options: [
    { value: 'a', textContent: ' Alpha ', disabled: false },
    { value: 'b', textContent: 'Beta', disabled: false },
    { value: 'c', textContent: 'Gamma', disabled: true },
  ],
}
eq(m.optionsOf(fakeSelect), [{ value: 'a', label: 'Alpha', disabled: false }, { value: 'b', label: 'Beta', disabled: false }, { value: 'c', label: 'Gamma', disabled: true }],
  'A33 optionsOf：值/文案（trim）/disabled 都取到')
eq(m.selectedIndex(m.optionsOf(fakeSelect), 'b'), 1, 'A34 selectedIndex：命中')
eq(m.selectedIndex(m.optionsOf(fakeSelect), 'zzz'), 0, 'A35 selectedIndex：找不到 ⇒ 0（不返回 -1 造成空按钮）')
eq(m.selectedIndex([], 'a'), -1, 'A36 selectedIndex：空列表 ⇒ -1')

// ── B 实现纪律（静态） ──────────────────────────────────────────────────────
console.log('\n== B 实现纪律（静态） ==')
const cssMatch = src.match(/const CSS = `([\s\S]*?)`\n/)
ok(!!cssMatch, 'B1 能取出注入的 CSS 文本')
const css = cssMatch ? cssMatch[1] : ''
const selectors = css.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('@') && !l.startsWith('}') && l.includes('{'))
  .map((l) => l.slice(0, l.indexOf('{')).trim())
const badSel = selectors.filter((s) => !s.startsWith('.mpw_select'))
ok(badSel.length === 0, 'B2 CSS 每条选择器都以 `.mpw_select` 开头（不碰宿主 UI）', badSel.length ? `越界: ${badSel.join(' | ')}` : `${selectors.length} 条全部合规`)
ok(!/:root|html\s|body\s|\*\s*\{/.test(css), 'B3 CSS 里没有 `:root` / 裸 `html|body|*` 选择器')
const declaredVars = [...css.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)].map((mm) => mm[2])
eq(declaredVars, [], 'B4 CSS **不定义任何自定义属性**（不外泄 token；宿主已有自己的主题）')
ok(css.includes('${ITEM_H}'), 'B5 行高来自常量插值（CSS 与 math 不会各写一个数字）')
ok(/padding:\s*4px 0/.test(css), 'B6 列表内边距与 `LIST_PAD=8`（4+4）一致')

ok(!/\.innerHTML\s*=/.test(src), 'B7 不用 `innerHTML` 拼文案（只用 textContent ⇒ 选项文本不会被当 HTML）')
ok(/textContent\s*=/.test(src), 'B8 用 textContent 写文案')
ok(/let openRoot = null/.test(src), 'B9 有**模块级单开注册表**（结构上不可能"点几次重复打开"）')
/* ⚠⑦(2026-09-25) 契约加严（判据意图不变：**再点即关，不是又开一个**）：
   改前判的是裸 `if (list)` —— 宿主整块换节点把 `<ul>` 摘掉后 `list` 仍非空（空气列表），
   toggle 会走 close() ⇒ 用户"点一下没反应"。现在判的是 `isOpen()`（= 列表**真的还在文档里**），
   所以判据跟着改成 `if (isOpen()) close(true); else open()`；下面的 E12 另判其余几处状态判断同口径。 */
ok(/const toggle = \(\) => \{ if \(isOpen\(\)\) close\(true\); else open\(\) \}/.test(srcCode),
  'B10 触发按钮是 **toggle**（再点即关，不是又开一个；判"开着没有"走 `isOpen()` 而不是裸 `list`）')

const addCount = (src.match(/addEventListener\(/g) || []).length
const rmCount = (src.match(/removeEventListener\(/g) || []).length
ok(addCount >= 6 && rmCount >= 4, 'B11 监听器**配对装卸**（open 挂、close 卸 ⇒ 无常驻监听、不涨内存）', `add=${addCount} remove=${rmCount}`)
const closeBody = src.slice(src.indexOf('const close = (focusBack'), src.indexOf('const onDocDown'))
ok(/removeEventListener/.test(closeBody), 'B12 `close()` 里确实卸掉了 document/窗口监听')
ok(/openRoot = null/.test(closeBody), 'B13 `close()` 会清空单开注册表')
ok(!/requestAnimationFrame\s*\(/.test(src), 'B14 没有常驻 rAF 循环（下拉静止时零帧回调）')
ok(/destroy:/.test(src) && /selectEl\.hidden = false/.test(src), 'B15 提供 destroy() 并把原生 select 放回来（可回退）')
ok(/MutationObserver/.test(src) && /disconnect\(\)/.test(src), 'B16 选项变化用 MutationObserver 跟随，且 disconnect 在 destroy 里')
ok(!/document\.body\.style/.test(src) && !/documentElement\.style/.test(src), 'B17 不往 body/documentElement 写样式')

// ── D 按钮文案 + 包含块偏移（P-159） ─────────────────────────────────────────
console.log('\n== D 按钮文案 / 包含块偏移（P-159） ==')
ok(/export function layerFixedOffset\(/.test(src) && /anchoredInside/.test(src),
  'D1 包含块原点纯函数 `layerFixedOffset(trackRect, anchoredInside)` 在 mpw-select.js 里（两套下拉共用一份）')
{
  const mod = await import(pathToFileURL(SRC).href)
  const inTrack = mod.layerFixedOffset({ left: 0, top: 44, right: 1360, bottom: 882 }, true)
  const outside = mod.layerFixedOffset({ left: 0, top: 44, right: 1360, bottom: 882 }, false)
  ok(inTrack.dx === 0 && inTrack.dy === 44 && outside.dx === 0 && outside.dy === 0,
    'D2 锚在 `#pages-track` 里 ⇒ 减掉它的 left/top（实测差一个 header=44px 就是那条缝）；不在里面 ⇒ 0',
    JSON.stringify({ inTrack, outside }))
  ok(mod.layerFixedOffset(null, true).dy === 0 && mod.layerFixedOffset(undefined, true).dx === 0,
    'D3 拿不到 track rect 时退化成 0（不抛错、不产出 NaN）')
}
ok(/const opts = optionsOf\(selectEl\)/.test(src) && /const i = selectedIndex\(opts, selectEl\.value\)/.test(src),
  'D4 `paintButton` 走 `currentOption()` ⇒ **每次现读** `optionsOf(selectEl)`（不再读闭包 model）')
/** `currentOption` + `paintButton` 这段（"读当前项并写按钮"的全部代码）里**不许出现闭包 `model`**。 */
const labelRegion = (() => {
  const a = src.indexOf('const currentOption = () => {')
  const b = src.indexOf('const close = (focusBack', a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
})()
{
  ok(labelRegion.length > 0 && !/selectedIndex\(model/.test(labelRegion) && !/\bmodel\[i\]/.test(labelRegion),
    'D5 ★ 「读当前项 + 写按钮」这段代码里**没有**对闭包 `model` 的引用（旧实现就是 `selectedIndex(model, …)` ⇒ 首次展开前恒「（空）」）',
    labelRegion.split('\n')[0])
}
ok(/const onSelChange = \(\) => paintButton\(\)/.test(src) && /selectEl\.addEventListener\('change', onSelChange\)/.test(src) &&
  /selectEl\.removeEventListener\('change', onSelChange\)/.test(src),
  'D6 宿主**程序化改值**也要跟上：select 自己的 change 监听（挂/卸成对；不是 document/window 常驻监听）')
ok(/containingOffset\(doc, btn, win\)/.test(src) && /br\.bottom \+ gap - off\.dy/.test(src) &&
  /cbBottom - \(br\.top - gap\)/.test(src) && /const gap = 2/.test(src),
  'D7 展开时按包含块原点写坐标：下开 `top = br.bottom + 2 - dy`、上翻按**下边缘**锚定（等于 cbBottom − (br.top − 2)），缝 2px')
ok(/list\.setAttribute\('data-origin'/.test(src) && /list\.setAttribute\('data-flip'/.test(src),
  'D8 浮层上留了可断言的标记：`data-flip`（方向）+ `data-origin`（包含块 / 视口）')
ok(/setAttribute\('data-mpw-label'/.test(src),
  'D9 按钮根上留 `data-mpw-label`（探针/门禁不必读子节点的 textContent）')

console.log('\n== E ⑦(2026-09-25) 控制被**无关滚动**收掉 / 自愈（真机"点开就没了"）==')
{
  /* 判据层：这一次滚动**该不该**把打开的下拉收起来（纯函数，节点当数据传）。 */
  const doc = { documentElement: { name: 'html' }, body: { name: 'body' } }
  const outer = { name: 'outer', parentElement: null }
  const mid = { name: 'mid', parentElement: outer }
  const btn = { name: 'btn', parentElement: mid }
  const logbody = { name: 'logbody', parentElement: doc.body }         // 兄弟容器（日志窗就是这一类）
  const btn2 = { name: 'btn2', parentElement: null, ownerDocument: doc }
  ok(m.scrollAffectsAnchor(doc, btn, doc) && m.scrollAffectsAnchor(doc.documentElement, btn, doc) && m.scrollAffectsAnchor(doc.body, btn, doc),
    'E1 视口/文档滚动 ⇒ 收起（`document`/`documentElement`/`body` 三种事件目标都算 —— Firefox 与 Chromium 不一致，这里都收）')
  ok(m.scrollAffectsAnchor(outer, btn, doc) && m.scrollAffectsAnchor(mid, btn, doc) && m.scrollAffectsAnchor(btn, btn, doc),
    'E2 锚点祖先（含锚点自己）滚动 ⇒ 收起（原意：fixed 浮层会与锚点脱开）')
  ok(!m.scrollAffectsAnchor(logbody, btn, doc) && !m.scrollAffectsAnchor({ name: 'list' }, btn, doc),
    'E3 ★ **与锚点无关**的容器滚动 ⇒ 不收（这就是"点开就没了"的真因：日志窗 250ms 内自滚 4 次）')
  ok(!m.scrollAffectsAnchor(null, btn, doc) && !m.scrollAffectsAnchor(undefined, null, null),
    'E4 空事件目标/没有锚点 ⇒ 一律不收（防御：拿不到信息时不做破坏性动作）')
  ok(m.scrollAffectsAnchor(doc.body, btn2, null) === true && m.scrollAffectsAnchor({ name: 'x' }, btn2, null) === false,
    'E5 文档缺省从 `anchorEl.ownerDocument` 推（调用方可以只传两个参数）')
}
ok(/const onWinScroll = \(ev\) => \{[\s\S]{0,200}?const moved = anchorMoved\(\)[\s\S]{0,220}?scrollAffectsAnchor\(ev && ev\.target, btn, doc\)/.test(srcCode),
  'E6 展开期间的 scroll 处理走**过滤后**的 `onWinScroll`：先判"锚点真的动了吗"，无法判定才退回同一份纯函数')
ok(/win\.addEventListener\('scroll', onWinScroll, true\)/.test(srcCode) && !/win\.addEventListener\('scroll', close, true\)/.test(srcCode),
  'E7 ★ 挂的是 `onWinScroll`、不是裸的 `close`（改前裸挂 ⇒ 页面上任何容器滚动都把下拉关掉）')
ok(/let anchorRect = null/.test(srcCode) && /anchorRect = \{ left: br\.left, top: br\.top, width: br\.width, height: br\.height \}/.test(srcCode)
  && /const anchorMoved = \(\) => \{[\s\S]{0,420}?!anchorRect \|\| typeof btn\.getBoundingClientRect !== 'function'[\s\S]{0,120}?return null[\s\S]{0,220}?> 0\.5/.test(srcCode),
  'E11 ★ ⑦`anchorMoved()`：展开时记下触发框 rect、比较容差 0.5px、**无法判定返回 `null`**（浮层坐标是按这张 rect 算的 ⇒ 只有它变了才真脱开；这也吃掉"先滚动后展开"的异步时序坑）')
ok(/win\.removeEventListener\('scroll', onWinScroll, true\)/.test(srcCode),
  'E8 close() 里卸的是同一个具名处理器（装卸配对，没留常驻监听）')
ok(!/scrollIntoView/.test(srcCode) && /scrollItemInside\(items\[active\]\)/.test(srcCode) && /list\.scrollTop = it \+ ih - ch/.test(srcCode),
  'E9 ★ 把高亮项滚进列表**自己的滚动盒**（改前 `scrollIntoView` 会滚**祖先** ⇒ 页面自己跳 + 被自己的 scroll 监听收到而自闭）')
ok(/if \(list && list\.isConnected === false\) close\(false\)/.test(srcCode) && /const isOpen = \(\) => !!list && list\.isConnected !== false/.test(srcCode),
  'E10 ★ 自愈：宿主整块换节点把 `<ul>` 连根摘掉（没走 close）时，`open()` 先归一成"已关"、`isOpen()` 如实为 false（否则会"自称展开却是空气列表"）')
{
  /* ⑦"开着没有"的状态判断全部走 `isOpen()`：裸 `list` 只该出现在"操作那个节点"的地方
     （close/onDocDown/onWinScroll/applyActive 内部）与 `open()` 里**归一之后**的那一处 return。
     判据用**去掉注释 + 去掉按节点早退**后的代码扫，并额外要求 `open()` 里那处前面紧跟自愈行（E10）。 */
  const lines = srcCode.split('\n')
  const stateCode = lines.filter((l) => !/if \(!list\) return|if \(!item \|\| !list\) return|if \(list\) return/.test(l)).join('\n')
  const badState = stateCode.match(/[^.\w]if \(!?list\)/g) || []
  const healIdx = lines.findIndex((l) => /if \(list && list\.isConnected === false\) close\(false\)/.test(l))
  const healThenReturn = healIdx >= 0 && /if \(list\) return/.test(lines[healIdx + 1] || '')
  ok(badState.length === 0 && healThenReturn,
    'E12 ★ ⑦键盘（Enter/Esc/方向键）/ MutationObserver 补画 / `refresh()` 的状态判断都走 `isOpen()`（裸 `list` 只用于操作节点本身，或 `open()` 里自愈之后的 return）',
    JSON.stringify({ bad: badState, healThenReturn }))
}

console.log('\n== C RED-IF-REVERTED（真树只读，变异在 /tmp 副本） ==')
const shaBefore = (() => { const c = fs.readFileSync(MATH); return c.length + ':' + c.subarray(0, 32).toString('hex') })()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sel-'))
const mutantPath = path.join(tmp, 'mpw-select-math.mjs')
const mutant = mathSrc.replace(
  /export function decideFlip\(\{ spaceBelow, spaceAbove, wantHeight \}\) \{[\s\S]*?\n\}/,
  "export function decideFlip({ spaceBelow, spaceAbove, wantHeight }) {\n  void spaceAbove; void wantHeight; void spaceBelow\n  return 'down'\n}",
)
ok(mutant !== mathSrc, 'C1 变异确实改到了源码（锚点命中）')
fs.writeFileSync(mutantPath, mutant)
const mm = await import(pathToFileURL(mutantPath).href)
const mutantFlip = mm.decideFlip({ spaceBelow: 50, spaceAbove: 300, wantHeight: 200 })
ok(mutantFlip === 'down' && m.decideFlip({ spaceBelow: 50, spaceAbove: 300, wantHeight: 200 }) === 'up',
  'C2 ★ 变异生效：`decideFlip` 恒 down ⇒ A9/A10/A16 这类"上翻"判据必红（真文件仍是 up）',
  `变异=${mutantFlip} 真文件=${m.decideFlip({ spaceBelow: 50, spaceAbove: 300, wantHeight: 200 })}`)
const shaAfter = (() => { const c = fs.readFileSync(MATH); return c.length + ':' + c.subarray(0, 32).toString('hex') })()
ok(shaBefore === shaAfter, 'C3 真树 `demo/mpw-select-math.mjs` 跑前跑后一致（变异只落 /tmp）', shaAfter)

// 变异④（P-159）：把 `paintButton` 改回"读闭包 model" ⇒ D4/D5 必红
{
  const shaSrcBefore = (() => { const c = fs.readFileSync(SRC); return c.length + ':' + c.subarray(0, 32).toString('hex') })()
  const mutSel = path.join(tmp, 'mpw-select.mutant.mjs')
  const mutantSel = src.replace(
    /  const currentOption = \(\) => \{\n    const opts = optionsOf\(selectEl\)\n    const i = selectedIndex\(opts, selectEl\.value\)\n    return i < 0 \? null : opts\[i\]\n  \}/,
    "  const currentOption = () => {\n    const i = selectedIndex(model, selectEl.value)\n    return i < 0 ? null : model[i]\n  }",
  )
  ok(mutantSel !== src, 'C4 变异④锚点命中（`currentOption` 改回读闭包 `model`）')
  //  变异体得能加载：把相对 import 换成真树绝对 file: URL（/tmp 里没有 mpw-select-math.mjs）
  const fixedSel = mutantSel.replace("from './mpw-select-math.mjs'", "from '" + pathToFileURL(MATH).href + "'")
  fs.writeFileSync(mutSel, fixedSel)
  await import(pathToFileURL(mutSel).href)
  const mutD4 = /const opts = optionsOf\(selectEl\)/.test(mutantSel)
  const mutA = mutantSel.indexOf('const currentOption = () => {')
  const mutB = mutantSel.indexOf('const close = (focusBack', mutA)
  const mutD5 = !/selectedIndex\(model/.test(mutantSel.slice(mutA, mutB > mutA ? mutB : mutA + 600))
  ok(!mutD4 && !mutD5, 'C5 ★ 变异④生效：D4/D5（"每次现读 options"）在变异体里必红', `D4=${mutD4} D5=${mutD5}`)
  const shaSrcAfter = (() => { const c = fs.readFileSync(SRC); return c.length + ':' + c.subarray(0, 32).toString('hex') })()
  ok(shaSrcBefore === shaSrcAfter, 'C6 真树 `demo/mpw-select.js` 跑前跑后一致（变异只落 /tmp）', shaSrcAfter.slice(0, 20))
}

// 变异⑦（2026-09-25）：把展开期间的 scroll 监听改回**裸 close**（任何容器滚动都关）⇒ E7 必红。
//   为什么单独来做：这条判据的全部价值就在"挂的是过滤后的处理器"这一处，变异必须能把它判红。
{
  const mutScroll = src.replace("win.addEventListener('scroll', onWinScroll, true)", "win.addEventListener('scroll', close, true)")
  ok(mutScroll !== src, 'C7 变异⑦锚点命中（`scroll` 监听改回裸 `close`）')
  ok(!/win\.addEventListener\('scroll', onWinScroll, true\)/.test(mutScroll) && /win\.addEventListener\('scroll', close, true\)/.test(mutScroll),
    'C8 ★ 变异⑦生效：E7（"挂的是过滤后的 onWinScroll"）在变异体里必红')
}
// 变异⑧（2026-09-25）：把纯判据改成"恒 true"（任何滚动都收）与"恒 false"（永不收）——
//   两个方向都要被 E1~E4 判红，否则那组判据只是"写了个函数名"。
{
  const mutPath = path.join(tmp, 'mpw-select-math.scroll.mjs')
  fs.writeFileSync(mutPath, mathSrc.replace(/(export function scrollAffectsAnchor\(scrolledEl, anchorEl, doc\) \{)[\s\S]*?\n\}/,
    '$1\n  return true\n}'))
  const always = await import(pathToFileURL(mutPath).href)
  fs.writeFileSync(mutPath, mathSrc.replace(/(export function scrollAffectsAnchor\(scrolledEl, anchorEl, doc\) \{)[\s\S]*?\n\}/,
    '$1\n  return false\n}'))
  const never = await import(pathToFileURL(mutPath).href + '?v=2')
  const doc = { documentElement: { name: 'html' }, body: { name: 'body' } }
  const btn = { name: 'btn', parentElement: { name: 'mid', parentElement: null } }
  ok(always.scrollAffectsAnchor({ name: 'logbody' }, btn, doc) === true && m.scrollAffectsAnchor({ name: 'logbody' }, btn, doc) === false,
    'C9 ★ 变异"恒 true"（无关滚动也收）被 E3 判红：真树对兄弟容器返回 false')
  ok(never.scrollAffectsAnchor(doc.body, btn, doc) === false && m.scrollAffectsAnchor(doc.body, btn, doc) === true,
    'C10 ★ 变异"恒 false"（永不收）被 E1/E2 判红：真树对视口滚动返回 true')
}
fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}`)
process.exitCode = fail ? 1 : 0

// mpw-select-math.mjs —— 自绘下拉的**纯决策逻辑**（①2026-09-19 用户第 6 项：原生 <select> 换自绘 + 自动上下翻转）
//
// 为什么把决策抽成纯函数：下拉的**几何决策**（往上开还是往下开、列表最高多少、键盘下一个索引是谁）
// 是这套控件里唯一"算错就出 bug"的部分，而它在浏览器里最难测（要有布局、要滚、要有遮挡）。
// 抽出来之后：本文件零 DOM、零副作用，`tests/mpw-select-test.mjs` 可以直接把边界值全钉住；
// `demo/mpw-select.js` 只负责"量尺寸 → 调这里 → 应用结果"。
//
// 口径（与用户的要求逐条对应）：
//   · 「下面如果没有空间就自动显示到上面，上面没有空间就自动显示到下面」
//     ⇒ `decideFlip()`：优先往下；下方放不下且上方更宽裕 ⇒ 往上；两边都放不下 ⇒ 选**更宽裕**的一侧并限高。
//   · 「点几次能重复打开」「点两下是关闭而不是继续存在」⇒ 状态机在 `mpw-select.js`（单一注册表 + toggle），
//     这里只提供 `nextIndex()` 给键盘用。

/** 列表项的固定高度（CSS 里 `.mpw_select_item` 的行高必须与它一致；不一致会被测试抓出来）。 */
export const ITEM_H = 26
/** 列表的上下内边距合计（CSS `.mpw_select_list { padding: 4px 0 }`）。 */
export const LIST_PAD = 8
/** 与视口/滚动容器边缘至少留出的空隙。 */
export const GAP = 6
/** 列表最小高度（至少能看到一行）。 */
export const MIN_H = ITEM_H + LIST_PAD

/**
 * 列表的理想高度：装下所有项，但不超过 `maxH`。
 * @param {number} count 项数
 * @param {number} maxH 允许的最大高度（由可用空间决定）
 */
export function listHeight(count, maxH) {
  const want = Math.max(0, count) * ITEM_H + LIST_PAD
  const cap = Math.max(MIN_H, maxH)
  return Math.max(MIN_H, Math.min(want, cap))
}

/**
 * 往下开还是往上开。
 * @param {{spaceBelow:number, spaceAbove:number, wantHeight:number}} o
 * @returns {'down'|'up'} 方向
 *
 * 规则（顺序即优先级）：
 *  1. 下方够 ⇒ down（默认永远是 down，"没有理由才不往下"）；
 *  2. 下方不够、上方够 ⇒ up；
 *  3. 两边都不够 ⇒ 取空间更大的一侧（调用方随后用 `listHeight()` 限高 + 滚动）。
 */
export function decideFlip({ spaceBelow, spaceAbove, wantHeight }) {
  if (wantHeight <= spaceBelow) return 'down'
  if (wantHeight <= spaceAbove) return 'up'
  return spaceAbove > spaceBelow ? 'up' : 'down'
}

/**
 * 一次算清"开在哪边 + 列表多高"。
 * @returns {{flip:'down'|'up', height:number, spaceBelow:number, spaceAbove:number, clamped:boolean}}
 */
export function planList({ anchorTop, anchorBottom, viewportTop, viewportBottom, count, extra = 0 }) {
  const spaceBelow = Math.max(0, viewportBottom - GAP - anchorBottom - extra)
  const spaceAbove = Math.max(0, anchorTop - viewportTop - GAP - extra)
  const wantHeight = count * ITEM_H + LIST_PAD
  const flip = decideFlip({ spaceBelow, spaceAbove, wantHeight })
  const room = flip === 'down' ? spaceBelow : spaceAbove
  const height = listHeight(count, room)
  return { flip, height, spaceBelow, spaceAbove, clamped: height < wantHeight }
}

/**
 * 键盘导航：返回下一个高亮索引（`-1` = 没有高亮时按 Down ⇒ 第一项；Empty 列表 ⇒ -1）。
 * @param {string} key  'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'Enter' | 'Escape' | 'Tab' 等
 * @param {number} cur  当前高亮索引（-1 表示无）
 * @param {number} count 项数
 * @param {{wrap?:boolean}} [opt]
 */
export function nextIndex(key, cur, count, { wrap = true } = {}) {
  if (count <= 0) return -1
  const last = count - 1
  switch (key) {
    case 'ArrowDown': {
      if (cur < 0) return 0
      return cur >= last ? (wrap ? 0 : last) : cur + 1
    }
    case 'ArrowUp': {
      if (cur < 0) return last
      return cur <= 0 ? (wrap ? last : 0) : cur - 1
    }
    case 'Home': return 0
    case 'End': return last
    case 'PageDown': return Math.min(last, Math.max(0, cur) + 5)
    case 'PageUp': return Math.max(0, (cur < 0 ? 0 : cur) - 5)
    default: return cur
  }
}

/** 该键是否会**选中**当前高亮项并关闭（Enter/Space）。 */
export function isCommitKey(key) { return key === 'Enter' || key === ' ' || key === 'Spacebar' }

/** 该键是否应当关闭且不改值。 */
export function isCancelKey(key) { return key === 'Escape' || key === 'Esc' }

/**
 * 打开状态下"点在哪里算外面"（用于 document 上的 pointerdown 关闭）。
 * 判据：目标不在 **触发按钮**、不在 **列表**、也不在**同一个控件根**里 ⇒ 算外面。
 * @param {Element|null} target
 * @param {Element|null} root   控件根（`.mpw_select`）
 */
export function isOutside(target, root) {
  if (!root || !target) return true
  return !root.contains(target)
}

/**
 * 这次滚动**是否可能移动锚点**（= 打开的下拉该不该因此收起）。
 *
 * 为什么需要它（⑦2026-09-25 实测）：展开期间挂的是**捕获阶段**的 `scroll` 监听 —— 页面上**任何**
 * 容器滚动都会收到（不冒泡的容器滚动也收得到，这正是当初要捕获的原因）。改前只要收到就 `close()`，
 * 于是与锚点无关的滚动也会把刚展开的下拉收掉：测试台日志窗 `#logbody` 在场景加载时自己往下跟、
 * 库列表自动滚到选中项……用户看到的就是「**点开就没了**」。实测复现：`#logbody` 在 250ms 里滚了 4 次，
 * 同一次展开的读数从"列表在"变成"列表没了"。
 *
 * 判据（保留原意图，只是把范围收窄到"真会动到锚点"的那些滚动源）：
 *   · 视口/文档滚动（`document` / `documentElement` / `body`）⇒ 会动 ⇒ 收起；
 *   · 滚动源是**锚点的祖先**（含锚点自己）⇒ 会动 ⇒ 收起；
 *   · 其余（兄弟容器、日志窗、列表自己内部等）⇒ 与锚点无关 ⇒ **不收**。
 *
 * 纯函数：只走 `parentElement` 链、只读传入对象的属性，零副作用（调用方把节点当数据传进来）。
 * @param {object|null} scrolledEl 事件目标（被滚动的那个元素/文档）
 * @param {object|null} anchorEl   锚点（触发按钮）
 * @param {object|null} [doc]      文档（缺省从 anchorEl.ownerDocument 推）
 */
export function scrollAffectsAnchor(scrolledEl, anchorEl, doc) {
  if (!scrolledEl) return false
  const d = doc || (anchorEl && anchorEl.ownerDocument) || null
  if (d && (scrolledEl === d || scrolledEl === d.documentElement || scrolledEl === d.body)) return true
  for (let n = anchorEl; n; n = n.parentElement) if (n === scrolledEl) return true
  return false
}

/**
 * 从 `<select>` 的 options 生成内部模型（值与文案）。
 * 只读 DOM 的 `options`/`value`，不碰别的。
 */
export function optionsOf(selectEl) {
  if (!selectEl || !selectEl.options) return []
  const out = []
  for (let i = 0; i < selectEl.options.length; i++) {
    const o = selectEl.options[i]
    out.push({ value: String(o.value), label: String(o.textContent == null ? o.value : o.textContent).trim(), disabled: !!o.disabled })
  }
  return out
}

/** 当前选中项在模型里的索引（找不到 ⇒ 0；空列表 ⇒ -1）。 */
export function selectedIndex(list, value) {
  if (!list.length) return -1
  const i = list.findIndex((o) => o.value === String(value))
  return i < 0 ? 0 : i
}

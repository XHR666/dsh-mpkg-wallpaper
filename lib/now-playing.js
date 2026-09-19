/* ══════════════════════════════════════════════════════════════════════════════
   lib/now-playing.js —— "Now playing" 组件（挂到 DSH 左侧栏「设置」入口**上方**）

   ①(NP-1 2026-09-19 用户第 1 条「now playing 挂载到 dsh 设置上面 有一个开关启用是否挂载
   左边栏收起就隐藏」) 本文件是**唯一实现**；`lib/client.js` 里有一段由
   `tools/build-now-playing.mjs` 生成的**内联区**（`MPW-NP-GEN-START/END`），
   `tools/now-playing-test.mjs` 断言"生成区 == 本文件 + lib/now-playing-math.js 逐字节"。

   ── 许可（必须保留） ────────────────────────────────────────────────────────
   组件本体（几何/形变/那套"一个数就是全部状态"的设计）来自 **Bencho** 的 "Now playing"
   （上游文件 `Sound.tsx` + 随附样式表），上游作者 Bencho，许可 **MIT**（bencho.dev/licence）。
   移植方式：**逐行移植、注释原文保留**（用户原话："它们解释了这些数字为什么是这个值，
   也是这份代码值得照抄而不是重写的主要原因"）。归属见 `THIRD-PARTY.md` §13；
   跨仓台账见 `../docs/COPYING-RULES.md` §4。
   ⚠ **本文件不含任何 GPL 代码**：`we-scene-demo/demo/now-playing/**`（GPL-3.0-or-later）
   只被**读来核对数学**，一行都没有拷进来（`../docs/COPYING-RULES.md` §2.2 "GPL 永不进插件"）。

   ── 与上游的差异（逐项，供复核） ─────────────────────────────────────────────
   1. **图标自绘**：上游 `import { Heart, SkipBack, SkipForward } from "lucide-react"`。
      本插件不引新依赖，形状按几何自绘（SKIP_*_D / VOL_*_D）。播放/暂停**不是**图标：
      它是上游那对八点四边形（`M.quad`），原样移植。
   2. **不渲染心形**：`.mpw_np_like` 的样式与 `LIKE` 的几何**照移植**（它还决定文字块宽度
      sayWidth），但**不渲染那个按钮** —— 本插件没有"喜欢的歌"这个可落库的概念，
      留一个"点了只改自己颜色"的按钮就是本轮明令禁止的**假动作**。理由见 docs/NOW-PLAYING-DSH.md §4.5。
   3. **第三个传输键换成音量/静音**：上游是 `SkipForward`（下一首）。本插件没有播放队列，
      "下一首"没有语义；换成**真实存在**的音量/静音开关（走既有 mute 设置 + 宿主 media-audio 契约）。
   4. **封面 COVER**：上游的图片不随许可同行（上游自己也是 `const COVER = ""` 占位）。
      这里填**当前壁纸的缩略图**（真实数据，不伪造）。
   5. **类名前缀** `snd-` → `mpw_np_`，全部落在我们自己的锚点 `[data-mpw-now-playing]` 下。
   6. **14 个 Bencho token** 在组件根上**本地定义**为 `--mpw-np-*`（有宿主等价物的映射到只读
      `--dsw-*`），不新增全局变量、不覆盖任何宿主 token。
   7. **形变的走法**：上游用 rAF 跑 `useTween`；这里保留"一个数就是全部状态"，但把那条
      0→1 的补间放在**控制器**里（`tweenTo`），且**自停**（到站就 cancel，不常驻 rAF）。
   8. **加装**：`ResizeObserver` 判"左侧栏收起 ⇒ 隐藏"（上游没有这个概念，它在画布上）。
   9. **不加**：上游的 Sound-board / 曲库页区块（`.snd-wake/.snd-grid/.snd-key/.snd-num/
      .snd-name/.sfx-wall`）**未移植** —— 它们不是这个组件。

   ── 加载方式（重要，防止"静默空导出"） ───────────────────────────────────────
   本仓 `package.json` 是 `"type": "module"` ⇒ `lib/*.js` 在 Node 里被当作 **ESM**，
   而本文件是 **CJS 风格**（与 `lib/client.js` 同族：它要被内联进 client.js，那里只有
   `require / module / exports` 可用，写 `export` 会直接 SyntaxError —— 见
   `docs/CLIENT-JS-SPLIT-ASSESSMENT.md` §1）。
   ⇒ 用 Node 直接 require 本文件会**静默得到空对象 `{}`**，不是报错。
   正确加载方式（与 `tools/_stub.mjs` 载入 client.js 完全相同）：
       const m = { exports: {} };
       new Function("module", "exports", "require", src)(m, m.exports, require);
   见 `tools/now-playing-test.mjs` 的 `loadCjsSource()`（它断言导出非空，空即抛错）。
   ⚠ **本文件里不许出现任何相对模块说明符**（哪怕在注释里也不行）：`tools/integrity-check.mjs`
   第 ⑩ 节对 `lib/client.js` 的判据是"0 处相对 import/require"，本文件生成区内联后同样受它管；
   注释里的示例同样会被正则命中 ⇒ 这里连示例都写成文字描述，不写实际的调用形态。
   所以本模块**不引用数学文件**：`createNowPlaying({ math })` 由调用方注入。
   ══════════════════════════════════════════════════════════════════════════════ */
"use strict";

/* ── DOM 契约（与 lib/client.js:4412 同一套，不另造第二套选择器） ────────────────
   `[class*="sidebarCol"] [class*="root"]` = 宿主 AppFrame 的左栏列 + SidebarRoot 根；
   `[class*="footArea"]` = 侧栏底部那一组；`[class*="settingsArea"]` = 「设置」入口所在的格子。
   出处（逐行读过宿主源码，不是猜的）：
     · @deepseek-ai/dsh-client-ui-layout  AppFrame：`div.pI_x6G_sidebarCol` 包裹侧栏 slot，
       框架根上带 `data-sidebar-collapsed`（折叠时存在）；
     · @deepseek-ai/dsh-client-ui-sidebar SidebarRoot：
       `div.hHd-Xa_root > … > div.hHd-Xa_footArea > [ div.hHd-Xa_footerActions , div.hHd-Xa_settingsArea ]`
       ⇒ `settingsArea` 是 footArea 的**最后一个**孩子，"插在设置入口上面" = 插在它前面。
   宿主换版找不到锚点时**不静默**：退回"侧栏底部那一组的第一个位置"并打一行 console.warn。 */
const NP_ATTR = "data-mpw-now-playing";
const NP_HIDDEN_ATTR = "data-mpw-np-hidden";
const NP_ANCHOR_ATTR = "data-mpw-np-anchor";
const NP_NOTE_ATTR = "data-mpw-np-note";
const NP_SIDEBAR_ROOT_SEL = '[class*="sidebarCol"] [class*="root"]';
const NP_SIDEBAR_ROOT_ATTR = "data-mpw-sidebar-root";
const NP_SIDEBAR_COL_SEL = '[class*="sidebarCol"]';
const NP_FOOT_SEL = '[class*="footArea"]';
const NP_SETTINGS_SEL = '[class*="settingsArea"]';
/* 宿主自己的折叠状态标记（在 AppFrame 框架根上；style-scope-guard 已登记 host:state-attrs）。
   我们只**读**它当快速通道；样式的门控属性始终是我们自己的 data-mpw-np-hidden。 */
const NP_FRAME_COLLAPSED_ATTR = "data-sidebar-collapsed";
/* 宿主侧栏根在"收起"时带的 CSS-modules 局部名（`hHd-Xa_collapsed`，本地名稳定、hash 会变）
   —— 与 `[class*="sidebarCol"]` 同一种子串匹配口径。 */
const NP_ROOT_COLLAPSED_TOKEN = "collapsed";

/* ── 宿主**官方 slot**：`sidebar.footer.action` 就是我们想要的位置 ──────────────
   ①(NP-1) 证据（宿主源码 + 真机 DOM 双向核对过，不是猜的）：
     · @deepseek-ai/dsh-client-ui-sidebar `SidebarRoot`：
         `div.footArea > [ div.footerActions , div.settingsArea ]`
       而 `footerActions` 渲染的正是 slot `sidebar.footer.action`
       ⇒ 它的出口 `div[data-slot="sidebar.footer.action"]` 结构上**就在「设置」入口正前方**。
     · 该 slot 声明为 `{ kind: "list", scope: "root", replaceRisk: "none" }`（同一个包 :399-402），
       宿主自带的插件开发 skill 明确写：小的侧栏动作**优先用 `sidebar.footer.action` 这类附加 slot，
       不要去操作宿主的硬编码 DOM 选择器**。所以我们**优先走 slot**。
   我们自己在 slot 里渲染的那个 div 带 `data-mpw-np-slot`（自有锚点）⇒ 控制器按选择器找到它，
   把自己的容器放进去；slot 没被宿主渲染（老版本/注册失败）时才退回 DOM 插入。
   这一层是**降级链**而不是两套实现：容器只有一个，位置只有一个来源，谁先可用就用谁。 */
const NP_SLOT_ATTR = "data-mpw-np-slot";
const NP_SLOT_SEL = "[data-mpw-np-slot]";
/* ── 宿主**机器生成**的设置入口锚点 ────────────────────────────────────────────
   渲染器给每个 slot 出口都盖 `data-slot="<slotKey>"`（`SlotOutlet`，`display:contents`），
   所以 `[data-slot="sidebar.settings"]` 是**非本地化、非哈希**的稳定锚点（真机核对过）。
   为什么不用 aria-label：它是**本地化字符串**（这台机器上是「设置」，en 是 "Settings"）。
   为什么仍保留 `[class*="settingsArea"]` 作为下一级：那是 CSS-modules 的**本地名**子串，
   前缀哈希会变但本地名相对稳，且它已是本仓 style-scope-guard 登记过的锚点。 */
const NP_SETTINGS_SLOT_SEL = '[data-slot="sidebar.settings"]';
/* 宿主侧栏根的内边距（`--dsh-sidebar-inline-padding: 12px`）。
   用来算"可用宽度"，好把 260px 宽的组件等比缩到侧栏里放得下（见 fitScale）。 */
const NP_SIDEBAR_INLINE_PAD = 12;

/* ── 阈值：多宽算"侧栏收起" ────────────────────────────────────────────────────
   96px，理由是**量出来的宿主常量**而不是手感：
     · @deepseek-ai/dsh-client-ui-layout `computeColumns()`：
         `const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);`
       ⇒ 收起时栏宽**恰好 56px**（常数），展开时被夹在 **[264, 420]**。
     · 96 = 56 + 40：给 0.15s 的 grid-template-columns 过渡、次像素/DPI 取整、
       以及宿主将来把 rail 加宽留余量；同时距最小展开宽 264 还差 168px
       ⇒ **任何展开态都不可能被误判成收起**（这是阈值的硬半边）。
   判据是 `width < 阈值`（严格小于），所以 96 本身算展开。 */
const NP_COLLAPSE_MAX_W = 96;

/* ── 自绘图标（见文件头差异 1）：只画几何，不引 lucide -------------------------- */
const SKIP_BACK_D = "M19 5.2v13.6L9.2 12z M6.2 5.2h2.1v13.6H6.2z";
const SKIP_FORWARD_D = "M5 5.2v13.6L14.8 12z M15.7 5.2h2.1v13.6h-2.1z";
const HEART_D = "M12 20.4c-4.9-3.2-7.6-6.2-7.6-9.5A4.15 4.15 0 0 1 12 8.1a4.15 4.15 0 0 1 7.6 2.8c0 3.3-2.7 6.3-7.6 9.5z";
const VOL_MUTE_D = "M4 9.4h3.1L11.4 6v12L7.1 14.6H4z M15.2 9.6l4 4.8 M19.2 9.6l-4 4.8";
const VOL_ON_D = "M4 9.4h3.1L11.4 6v12L7.1 14.6H4z M14.6 9.2a3.9 3.9 0 0 1 0 5.6 M17 6.8a7.4 7.4 0 0 1 0 10.4";

/* ── 样式：全部落在 [data-mpw-now-playing] / .mpw_np* -------------------------
   上游那张样式表的原文注释保留在对应规则上。这里**故意不出现** sidebarCol / footArea /
   settingsArea / .hHd-Xa_* 任何一个名字：style-scope-guard 的 SURFACES 里"侧栏"的
   scopeRe 匹配它们，一旦出现，整条规则会被当成"侧栏表面"，进而被要求只读
   --mpw-surface-* 共享 token —— 那条通道是"改宿主表面底色/磨砂"，本条只是
   "往宿主里放我们自己的一个控件"，不该走它。 */
const NP_CSS = `/* ══ ①(NP-1) Now playing（DSH 左侧栏「设置」入口上方） ══
   14 个 Bencho token 的**本地映射**（组件根上定义，不是全局；只读宿主 --dsw-*，不覆盖）。
   --mpw-np-font-num / --mpw-np-slab / --mpw-np-on-slab 三项目前**未被引用**：它们属于上游
   同一文件里我们**未移植**的 Sound-board / 曲库页区块（.snd-wake/.snd-num/.snd-key）。
   按 14 项登记是为了"映射表完整"，不是为了现在就用上。 */
[data-mpw-now-playing] {
	--mpw-np-card: var(--dsw-alias-bg-base, #ffffff);
	--mpw-np-font-num: var(--dsw-font-mono, ui-monospace, SFMono-Regular, monospace);
	--mpw-np-font-ui: var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
	--mpw-np-ink: var(--dsw-alias-label-primary, #132d53);
	--mpw-np-ink-3: var(--dsw-alias-label-secondary, #4a5f80);
	--mpw-np-ink-4: var(--dsw-alias-label-tertiary, #6b7d99);
	/* 三个**裸数字**（上游要求：它的 CSS 用 rgba(var(--ink-rgb), .12) 拼半透明墨色）。
	   宿主没有等价 token（--dsw-* 全是整色），所以本地取本插件已有的墨色 19,45,83
	   —— 与 body[data-mpw-float] 的 rgba(19,45,83,.26) 同源。 */
	--mpw-np-ink-rgb: 19, 45, 83;
	--mpw-np-on-ink: var(--dsw-alias-label-primary-inverted, #ffffff);
	--mpw-np-on-slab: var(--dsw-alias-label-primary-inverted, #ffffff);
	--mpw-np-pane: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.86));
	--mpw-np-pane-edge: var(--dsw-alias-border-l2, rgba(19,45,83,0.16));
	--mpw-np-slab: var(--dsw-alias-bg-layer-3, rgba(19,45,83,0.08));
	--mpw-np-surface-2: var(--dsw-alias-bg-layer-2, #eef1f6);
	--mpw-np-surface-3: var(--dsw-alias-bg-layer-3, #e2e7ef);
}
body[data-ds-dark-theme] [data-mpw-now-playing] {
	/* 暗色：宿主 token 自己会翻，只有"裸数字"那一项非翻不可（它是给 rgba() 用的） */
	--mpw-np-ink-rgb: 214, 226, 245;
}
/* ══ 上游原文（保留）：There is almost nothing here, and that is deliberate: every position,
   size and radius in this component is written by the tween and arrives as an inline style.
   A transition on any of these rules would be a SECOND opinion about where a thing is,
   fighting the first one every frame. What is left is the material — the surfaces, the type
   and the two hover states — which never animates with the shape and so has nothing to fight. */
[data-mpw-now-playing] {
	position: relative;
	display: grid;
	place-items: center;
	font-family: var(--mpw-np-font-ui);
	/* ①(NP-1) 挂在宿主侧栏底部那一组里：上下留一点气口，别贴着「设置」入口 */
	padding: 6px 0 8px;
	min-width: 0;
	transition: opacity 160ms ease;
}
/* 左侧栏收起 ⇒ 隐藏自己（判据见 NP_COLLAPSE_MAX_W；属性由 JS 写） */
[data-mpw-now-playing][data-mpw-np-hidden] { display: none; }
/* ①(NP-1) 我们在宿主人事 slot 里自己渲染的那个 div：
   它是 footerActions（display:flex 行）的 flex 项，所以自己也要能屈能伸。 */
.mpw_np_slot {
	flex: 1 1 auto;
	min-width: 0;
	display: block;
}
/* ①(NP-1) 贴合缩放：侧栏最小 264px（宿主 clampWidth 下限），减掉两侧 12px 内边距只剩 240px，
   而组件是照 260px 画的（上游的 W，宽度在两个状态之间**刻意不变** —— 见 math 文件顶上那段）。
   把整体 scale 成一个数，而不是去改内部几何：内部比例是这个组件唯一不能动的东西。
   --mpw-np-fit 由 JS 按实测宽度写（拿不到就 1 = 不缩）。 */
[data-mpw-now-playing] .mpw_np {
	transform: scale(var(--mpw-np-fit, 1));
	transform-origin: 50% 0;
}
/* The object. It is the only thing on the card, so it is the quietest surface that still
   reads as one: the pane the rest of the bench uses, and a hairline. */
.mpw_np_box {
	position: relative;
	background: var(--mpw-np-pane);
	-webkit-backdrop-filter: blur(2px) saturate(150%);
	backdrop-filter: blur(2px) saturate(150%);
	overflow: hidden;
	/* 上游：NO BORDER of its own —— 用 spread shadow 而不是 border，
	   因为盒子有 overflow:hidden，border 会让形变每帧多带一样东西。 */
	box-shadow: 0 0 0 1px var(--mpw-np-pane-edge);
}
/* ── the cover ── 上游用 background-size:cover 而非 contain：正方形是固定的那个东西，
   图片被裁到它上面，所以封面在形变两端都不会出现信箱边。 */
.mpw_np_art {
	position: absolute;
	background-color: var(--mpw-np-surface-2);
	background-image: linear-gradient(148deg, var(--mpw-np-surface-3), var(--mpw-np-surface-2));
	background-size: cover;
	background-position: center;
	background-repeat: no-repeat;
	transition: scale 130ms cubic-bezier(0.3, 0.9, 0.4, 1);
}
/* ── the words ── 居中由盒子给：给它封面自己的高度并让它内部居中，
   所以两端都跟封面齐平 —— 上游为此删掉两个魔法数字。 */
.mpw_np_say {
	position: absolute;
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 2px;
	min-width: 0;
	pointer-events: none;
}
.mpw_np_title {
	color: var(--mpw-np-ink);
	font-weight: 500;
	letter-spacing: -0.01em;
	line-height: 1.25;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.mpw_np_by {
	color: var(--mpw-np-ink-4);
	line-height: 1.25;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
/* ── the track ── 轨道与游标；两端的时间只属于卡片，随 late 淡入 */
.mpw_np_bar {
	position: absolute;
	display: flex;
	flex-direction: column;
	gap: 8px;
	pointer-events: none;
}
.mpw_np_rail {
	display: block;
	height: 3px;
	border-radius: 999px;
	background: rgba(var(--mpw-np-ink-rgb), 0.12);
	overflow: hidden;
}
.mpw_np_run {
	display: block;
	height: 100%;
	border-radius: 999px;
	background: var(--mpw-np-ink);
}
/* ── the clock ── 上游：用界面字体的**等宽数字**（tabular-nums）而不是 mono 栈，
   因为按比例排的 1 比 0 窄，计数器会自己每秒抖一下。 */
.mpw_np_clock {
	display: flex;
	justify-content: space-between;
	font-family: var(--mpw-np-font-ui);
	font-variant-numeric: tabular-nums;
	font-size: 10.5px;
	line-height: 1;
	letter-spacing: 0.04em;
	color: var(--mpw-np-ink-4);
}
/* ── the transport ── 按**行的中心**定位（行自己的宽度在两态之间会变，
   用边定位的话，即使中点没动，边也会动）。 */
.mpw_np_ops {
	position: absolute;
	display: flex;
	align-items: center;
	translate: -50% -50%;
}
.mpw_np_op {
	flex: none;
	display: grid;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 999px;
	background: transparent;
	color: var(--mpw-np-ink-3);
	cursor: pointer;
	overflow: hidden;
	transition: color 160ms ease, background 160ms ease, scale 130ms cubic-bezier(0.3, 0.9, 0.4, 1);
}
.mpw_np_op:hover { color: var(--mpw-np-ink); background: rgba(var(--mpw-np-ink-rgb), 0.07); }
/* ── the press ── 它先让步再动作：只变状态的控件读起来是"被触发"，先让一下再动才是
   "被按下"，差别就是 40ms 与百分之四。scale 单独成属性而不是塞进 transform 简写：
   行是用 translate 定位的，播放键的尺寸又由补间逐帧写，任何共用 transform 简写的
   写法都会被每帧覆盖。 */
.mpw_np_op:active { scale: 0.9; }
/* the one you press most, and the only one that is filled --
   1(NP-1) hooks are our own class names (.mpw_np_lead / .mpw_np_on), not bare attribute
   selectors ([data-lead] / [data-on]): style-scope-guard only sanctions .mpw* / [data-mpw*] /
   #mpw-* anchors, and a bare attribute atom is a REVIEW. */
.mpw_np_op.mpw_np_lead { background: var(--mpw-np-ink); color: var(--mpw-np-on-ink); }
.mpw_np_op.mpw_np_lead:hover { background: var(--mpw-np-ink); opacity: 0.88; }
.mpw_np_op:focus-visible,
.mpw_np_like:focus-visible,
.mpw_np_tap:focus-visible {
	outline: none;
	box-shadow: 0 0 0 2px var(--mpw-np-card), 0 0 0 4px rgba(var(--mpw-np-ink-rgb), 0.35);
}
/* ①(NP-1) 做不到的事按钮**明确禁用**，而不是点了没反应（诚实：能做才让按） */
.mpw_np_op:disabled { opacity: 0.4; cursor: not-allowed; }
.mpw_np_op:disabled:hover { color: var(--mpw-np-ink-3); background: transparent; }
/* ── the heart ── ①(NP-1) 规则**照移植**（上游 .snd-like），但本插件**不渲染**这个按钮：
   没有"喜欢的歌"这个可落库的概念，留一个点了只改自己颜色的按钮就是假动作。
   保留规则是因为两端几何（LIKE=30）仍然决定文字块宽度 sayWidth。
   上游原文：built off .snd-op rather than sharing it: same size, same give, but it is not in
   the transport row and it is the only control here that stays on after you let go. */
.mpw_np_like {
	position: absolute;
	display: grid;
	place-items: center;
	padding: 0;
	border: 0;
	border-radius: 999px;
	background: transparent;
	color: var(--mpw-np-ink-3);
	cursor: pointer;
	transition: color 160ms ease, background 160ms ease, scale 130ms cubic-bezier(0.3, 0.9, 0.4, 1);
}
.mpw_np_like:hover { color: var(--mpw-np-ink); background: rgba(var(--mpw-np-ink-rgb), 0.07); }
.mpw_np_like:active { scale: 0.9; }
.mpw_np_like.mpw_np_on { color: var(--mpw-np-ink); }
/* ── the beat ── 只在"点亮"那一下：取消喜欢不值得一段花活，两边都放会读成
   "一个按钮在动"而不是"一样东西被喜欢了"。过冲就是全部效果 —— 1.34 再回来。 */
.mpw_np_like.mpw_np_on .mpw_np_ic { animation: mpw_np_beat 340ms cubic-bezier(0.3, 1.4, 0.5, 1); }
/* the hit area, and nothing else */
.mpw_np_tap {
	position: absolute;
	padding: 0;
	border: 0;
	background: none;
	cursor: pointer;
}
/* the cover gives too —— 它就是那个"按下去换形状"的东西，所以它该和传输键同样应答。
   作用在封面上而不是命中区上：命中区是看不见的，缩放看不见的东西等于没有。 */
.mpw_np_box:has(.mpw_np_tap:active) .mpw_np_art { scale: 0.96; }
/* ①(NP-1) 面板上的**可观测说明**（诚实清单的落点之一）：
   点了做不到的事 → 这里出一行字 + console 一行；不是静默。 */
.mpw_np_note {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 2px;
	margin: 0 auto;
	max-width: 236px;
	padding: 2px 8px;
	border-radius: 999px;
	background: rgba(var(--mpw-np-ink-rgb), 0.08);
	color: var(--mpw-np-ink-3);
	font-size: 10.5px;
	line-height: 1.4;
	text-align: center;
	opacity: 0;
	transition: opacity 160ms ease;
	pointer-events: none;
}
[data-mpw-now-playing][data-mpw-np-note] .mpw_np_note { opacity: 1; }
@keyframes mpw_np_beat {
	0% { scale: 1; }
	38% { scale: 1.34; }
	100% { scale: 1; }
}
@media (prefers-reduced-motion: reduce) {
	.mpw_np_op, .mpw_np_art, .mpw_np_like { transition-duration: 1ms; }
	.mpw_np_like.mpw_np_on .mpw_np_ic { animation: none; }
}
`;

/* ══════════════════════════════════════════════════════════════════════════════
   组件
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 造一份 Now playing（React 组件 + 侧栏挂载控制器）。
 *
 * @param {object} deps
 *   · math       —— `lib/now-playing-math.js` 的导出（**注入**，不做相对 require，见文件头）
 *   · react      —— 宿主注入的 react（只用到 createElement）
 *   · createRoot —— `react-dom/client` 的 createRoot（宿主注入；测试可传桩）
 *   · t          —— i18n 取词函数（本仓 `ctx.locale.bind(NS)` 或面板 props.t）
 *   · doc / win  —— document / window（注入是为了能在假 DOM 里跑；生产传全局）
 *   · log        —— 日志口（默认 console）
 *   · onTransport(op) —— 传输动作的真实落点（控制器只判"能不能"，动作交给 client.js 接线）
 */
function createNowPlaying(deps) {
  const M = deps.math;
  const react = deps.react;
  const t = typeof deps.t === "function" ? deps.t : ((k) => k);
  const doc = deps.doc;
  const win = deps.win || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
  const log = deps.log || (typeof console !== "undefined" ? console : { info() {}, warn() {}, error() {} });
  const h = react.createElement;
  const TAG = "[dsh-mpkg-wallpaper] np:";

  /* ── 纯判据（可单独测）：这一帧该不该把组件藏起来 ──────────────────────────
     宿主自己的状态优先（AppFrame 的 data-sidebar-collapsed / 侧栏根上的 collapsed 类），
     它是权威；宽度阈值是**兜底**：宿主改名/改结构时判据还在。
     量不到宽度（NaN）时**不隐藏** —— 宁可露出来，也不要因为一次量不到就永久消失。 */
  function shouldHide(width, hostCollapsed) {
    if (hostCollapsed) return true;
    if (typeof width !== "number" || !isFinite(width)) return false;
    return width < NP_COLLAPSE_MAX_W;
  }

  /* 宿主 slot 交来的容器（控制器 setSlotNode 写；null = 还没渲染/已卸载）。 */
  let explicitSlot = null;

  function classHas(el, token) {
    try { return String((el && el.className) || "").indexOf(token) >= 0; } catch (e) { return false; }
  }
  function query(root, sel) {
    try { return root && root.querySelector ? root.querySelector(sel) : null; } catch (e) { return null; }
  }
  function queryAll(root, sel) {
    try { return root && root.querySelectorAll ? root.querySelectorAll(sel) : []; } catch (e) { return []; }
  }
  function closest(el, sel) {
    try { return el && el.closest ? el.closest(sel) : null; } catch (e) { return null; }
  }

  /** 取侧栏根：先认我们自己的标记，再用**同一个** `[class*="sidebarCol"] [class*="root"]` 契约补打。 */
  function sidebarRoot() {
    const marked = query(doc, "[" + NP_SIDEBAR_ROOT_ATTR + "]");
    if (marked) return marked;
    const sr = query(doc, NP_SIDEBAR_ROOT_SEL);
    if (sr) { try { sr.setAttribute(NP_SIDEBAR_ROOT_ATTR, ""); } catch (e) {} }
    return sr;
  }
  /** 侧栏**列**（宿主 grid 轨道所在的那个盒子）：宽度判据量它，因为它就是轨道本身。 */
  function sidebarCol() {
    const root = sidebarRoot();
    const c = root ? closest(root, NP_SIDEBAR_COL_SEL) : null;
    return c || query(doc, NP_SIDEBAR_COL_SEL) || root;
  }
  /**
   * 找到"插在哪"。
   * @returns {{container:Element|null, before:Element|null, mode:string}}
   *   mode='settings'   命中「设置」入口所在格子 ⇒ 插在它**前面**（正常路径）
   *   mode='foot-first' 找不到设置格子 ⇒ 退回"侧栏底部那一组的第一个位置"（留日志）
   *   mode='none'       连底部组都没有（宿主换版太狠）⇒ 不注入 + 留日志
   */
  function resolveAnchor() {
    /* ① 宿主官方 slot 里我们自己渲染的那个 div（首选：位置由宿主给，不碰它的 DOM 结构）。
       我们的容器进它**内部**，所以 before=null（插成第一个孩子）。 */
    if (explicitSlot) {
      const alive = explicitSlot.isConnected === void 0 ? true : !!explicitSlot.isConnected;
      if (alive) return { container: explicitSlot, before: null, mode: "slot" };
      explicitSlot = null;
    }
    const slotNode = query(doc, NP_SLOT_SEL);
    if (slotNode) return { container: slotNode, before: null, mode: "slot" };
    /* ② 宿主机器生成的设置入口锚点：插在它**前面**（`display:contents`，父节点就是设置格子）。 */
    const settingsSlot = query(doc, NP_SETTINGS_SLOT_SEL);
    if (settingsSlot && settingsSlot.parentNode) {
      return { container: settingsSlot.parentNode, before: settingsSlot, mode: "settings-slot" };
    }
    /* ③ CSS-modules 本地名子串（本仓已登记的锚点）：插在设置格子前面。 */
    const root = sidebarRoot();
    const foot = (root ? query(root, NP_FOOT_SEL) : null) || query(doc, NP_FOOT_SEL);
    const settings = (foot ? query(foot, NP_SETTINGS_SEL) : null) || query(doc, NP_SETTINGS_SEL);
    if (settings && settings.parentNode) {
      return { container: settings.parentNode, before: settings, mode: "settings-area" };
    }
    /* ④ 兜底：侧栏底部那一组的第一个位置（**会留一行 warn**，不静默）。 */
    if (!foot) return { container: null, before: null, mode: "none" };
    return { container: foot, before: null, mode: "foot-first" };
  }

  /* ── 图标 ─────────────────────────────────────────────────────────────────── */
  function iconNode(d, size) {
  /* panel-smoke 静态判据：任何用了 h() 的函数体都必须自己声明 h（本仓既有写法）。 */
  const h = react.createElement;
    return h("svg", {
      className: "mpw_np_ic", width: size, height: size, viewBox: "0 0 24 24",
      "aria-hidden": "true", fill: "currentColor", stroke: "currentColor",
      strokeWidth: 1.6, strokeLinejoin: "round", strokeLinecap: "round", focusable: "false",
    }, h("path", { d: d }));
  }

  /* ── the play mark is DRAWN, not swapped（上游原文见 lib/now-playing-math.js） ──
     两个标记是**同一对四边形**，差别只在八个点在哪；暂停是两根竖条，
     播放是把内边缘拉到中点收成尖。绕向两边一致（左上→右上→右下→左下），
     否则两半在途中会翻面。 */
  function PlayMark(props) {
  /* panel-smoke 静态判据：任何用了 h() 的函数体都必须自己声明 h（本仓既有写法）。 */
  const h = react.createElement;
    const playing = !!props.playing;
    const size = props.size || 16;
    const p = M.clamp(Number(props.p) || 0, 0, 1);
    /* 0 是暂停、1 是播放；`p` 就是那条 0→1 的补间（控制器给），所以标记随盒子一起过弯。
       goo 零在两端、一在中途：按两次落回起点，它是"路上的鼓包"而不是两个状态的差别。 */
    const tq = 1 - p;                       /* 打开（p→1）时从暂停走向播放 */
    const goo = M.gooOf(p);
    const pull = M.gooPull(goo);
    const tip = M.gooTip(playing, goo);
    const sc = M.gooScale(goo);
    return h("svg", {
      className: "mpw_np_ic", width: size, height: size, viewBox: "0 0 24 24",
      "aria-hidden": "true", fill: "currentColor", stroke: "currentColor",
      strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round", focusable: "false",
      /* per cent, not pixels: this is the element's own box and the box is whatever size
         the morph is at. */
      style: { transformOrigin: "50% 50%", transform: "rotate(" + tip + "deg) scale(" + sc[0] + ", " + sc[1] + ")" },
    },
      h("path", { d: M.quad(M.PAUSE_L, M.PLAY_L, tq), transform: "translate(" + pull + " 0)" }),
      h("path", { d: M.quad(M.PAUSE_R, M.PLAY_R, tq), transform: "translate(" + (-pull) + " 0)" }));
  }

  /**
   * 组件。全部状态由控制器通过 props 送进来（"一个数就是全部状态"这条设计本来就把状态压到极少）。
   * props: p(0..1 形变进度) / open / playing / at / media / note / 四个事件
   */
  function NowPlaying(props) {
  /* panel-smoke 静态判据：任何用了 h() 的函数体都必须自己声明 h（本仓既有写法）。 */
  const h = react.createElement;
    const q = props || {};
    const p = M.clamp(Number(q.p) || 0, 0, 1);
    const open = !!q.open;
    const going = !!q.playing;
    const media = q.media || {};
    const known = typeof media.total === "number" && media.total > 0;
    const at = Math.max(0, Math.min(known ? media.total : M.TOTAL, Number(q.at) || 0));

    const art = M.artSize(p);
    const artR = M.artRadius(M.CORNER);
    const boxR = M.boxRadius(M.CORNER);
    const late = M.lateOf(p);
    const side = M.transportSide(p);
    const lead = M.transportLead(p);

    const artStyle = {
      left: M.artX(), top: M.artY(), width: art, height: art,
      borderRadius: M.mix(artR[0], artR[1], p),
    };
    if (media.cover) artStyle.backgroundImage = "url(" + String(media.cover) + ")";

    return h("div", { className: "mpw_np" },
      h("div", {
        className: "mpw_np_box",
        "data-open": open || void 0,
        style: {
          width: M.W, height: M.boxHeight(p),
          borderRadius: M.mix(boxR[0], boxR[1], p),
          scale: open ? 1 : 1 - 0.035 * M.swellOf(p),
        },
      },
        h("span", { className: "mpw_np_art", "aria-hidden": "true", style: artStyle }),
        h("span", {
          className: "mpw_np_say",
          style: { left: M.sayLeft(p), top: M.artY(), height: art, width: M.sayWidth(p) },
        },
          h("span", { className: "mpw_np_title", style: { fontSize: M.titleSize(p) } },
            String(media.title || t("np.idle"))),
          h("span", { className: "mpw_np_by", style: { fontSize: M.bylineSize(p) } },
            String(media.byline || ""))),
        h("span", {
          className: "mpw_np_bar",
          style: { top: M.barTop(p), left: M.barLeft(), width: M.barWidth() },
        },
          h("span", { className: "mpw_np_rail" },
            h("span", {
              className: "mpw_np_run",
              style: { width: (known ? M.runPct(at) : 0) + "%" },
            })),
          h("span", { className: "mpw_np_clock", style: { opacity: late } },
            h("span", null, M.clock(at)),
            /* 数据源没有时长时**不假装**：显示 --:--（见 docs/NOW-PLAYING-DSH.md §4 情形②） */
            h("span", null, known ? ("−" + M.clock(M.remain(at))) : "--:--"))),
        h("button", {
          className: "mpw_np_tap", type: "button",
          onClick: () => { if (q.onToggle) q.onToggle(); },
          "aria-expanded": open,
          "aria-label": open ? t("np.collapse") : t("np.open"),
          style: {
            left: M.tapLeft(p), top: M.tapTop(p),
            width: M.tapWidth(p), height: M.tapHeight(p),
            borderRadius: M.tapRadius(p, M.CORNER),
          },
        }),
        h("span", {
          className: "mpw_np_ops",
          style: { left: M.opsX(p), top: M.opsY(p), gap: M.transportGap(p) },
        },
          h("button", {
            className: "mpw_np_op", type: "button",
            style: { width: side, height: side },
            onClick: () => { if (q.onRestart) q.onRestart(); },
            "aria-label": t("np.restart"), disabled: !media.canPlay,
          }, iconNode(SKIP_BACK_D, M.opIconSize(p))),
          h("button", {
            className: "mpw_np_op mpw_np_lead", type: "button",
            style: { width: lead, height: lead },
            onClick: () => { if (q.onPlayPause) q.onPlayPause(); },
            "aria-label": going ? t("np.pause") : t("np.play"),
            "aria-pressed": going, disabled: !media.canPlay,
          }, h(PlayMark, { playing: going, size: M.markSize(p), p })),
          h("button", {
            className: "mpw_np_op", type: "button",
            style: { width: side, height: side },
            onClick: () => { if (q.onVolume) q.onVolume(); },
            "aria-label": media.muted ? t("np.unmute") : t("np.mute"),
            "aria-pressed": !media.muted, disabled: !media.canVolume,
          }, iconNode(media.muted ? VOL_MUTE_D : VOL_ON_D, M.opIconSize(p)))),
        h("span", { className: "mpw_np_note" }, String(q.note || ""))));
  }

  /* ── 侧栏挂载控制器 ───────────────────────────────────────────────────────── */
  const IDLE_MEDIA = {
    kind: "none", title: "", byline: "", cover: "",
    total: null, playing: false, muted: true, volume: 1,
    canPlay: false, canVolume: false,
  };

  function createController() {
  /* panel-smoke 静态判据：任何用了 h() 的函数体都必须自己声明 h（本仓既有写法）。 */
  const h = react.createElement;
    let enabled = false;
    let container = null;
    let root = null;
    let resizeObs = null;
    let mutObs = null;
    let hidden = false;
    let anchorMode = "none";
    let note = "";
    let noteTimer = 0;
    let rafId = 0;
    let pCur = 0;
    /* 宿主**自己的**"宽/收起"信号（来自 slot 的 ownerProps.wide）。null = 这版宿主没给，
       那就只剩宽度判据（见 hostSaysCollapsed）。 */
    let hostWide = null;
    const counts = { resize: 0, mutation: 0, raf: 0 };
    const state = { open: false, playing: false, at: 0, media: Object.assign({}, IDLE_MEDIA) };

    function raf(fn) {
      if (win && typeof win.requestAnimationFrame === "function") return win.requestAnimationFrame(fn);
      return 0;
    }
    function cancelRaf(id) {
      if (!id) return;
      try { if (win && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(id); } catch (e) {}
    }
    /** 自停补间：0→1 走上游那条 QUART（quart-out），到站即 cancel —— 不是常驻 rAF。 */
    function tweenTo(target) {
      cancelRaf(rafId); rafId = 0;
      const from = pCur;
      if (from === target) { render(); return; }
      const dur = M.durationOf(50);
      const now = () => (win && win.performance && win.performance.now ? win.performance.now() : Date.now());
      const t0 = now();
      counts.raf++;
      const step = () => {
        const tt = Math.min(1, (now() - t0) / dur);
        pCur = from + (target - from) * M.QUART(tt);
        if (tt < 1) { render(); rafId = raf(step); }
        else { pCur = target; rafId = 0; render(); }
      };
      rafId = raf(step);
    }

    function render() {
    /* panel-smoke 静态判据：同 createController（回调里也用 h()）。 */
    const h = react.createElement;
      if (!root) return;
      try {
        root.render(h(NowPlaying, {
          p: pCur, open: state.open, playing: state.playing, at: state.at,
          media: state.media, note: note,
          onToggle: () => {
            state.open = !state.open;
            tweenTo(state.open ? 1 : 0);
          },
          onRestart: () => {
            if (!state.media.canPlay) { refuse("np.note.nosource"); return; }
            state.at = 0;
            if (deps.onTransport) deps.onTransport("restart");
            render();
          },
          onPlayPause: () => {
            if (!state.media.canPlay) { refuse("np.note.nosource"); return; }
            if (deps.onTransport) deps.onTransport(state.playing ? "pause" : "play");
          },
          onVolume: () => {
            if (!state.media.canVolume) { refuse("np.note.novolume"); return; }
            if (deps.onTransport) deps.onTransport("mute");
          },
        }));
      } catch (err) { log.error(TAG + "render failed:", err); }
    }

    /** 做不到的事：**不假装**。console 一行 + 面板上一行（用户能看到），4 秒后自己收。 */
    function refuse(key) {
      note = t(key);
      try { log.info(TAG + "refused (no fake action): " + note); } catch (e) {}
      if (container) { try { container.setAttribute(NP_NOTE_ATTR, ""); } catch (e) {} }
      render();
      if (noteTimer) { try { win.clearTimeout(noteTimer); } catch (e) {} }
      try {
        noteTimer = win.setTimeout(() => {
          noteTimer = 0; note = "";
          if (container) { try { container.removeAttribute(NP_NOTE_ATTR); } catch (e) {} }
          render();
        }, 4000);
      } catch (e) {}
      return false;
    }

    /** 读宿主**自己的**收起状态（优先）——AppFrame 的属性，或侧栏根上的 collapsed 类。 */
    function hostSaysCollapsed() {
      /* ① 宿主发下来的 `wide`（slot ownerProps）——最权威：它**就是** SidebarRoot 算出的
         `wide = !collapsed || !settled`，不需要我们去猜。 */
      if (hostWide !== null) return !hostWide;
      /* ② AppFrame 框架根上的 data-sidebar-collapsed（宿主自己的折叠标记）。 */
      const col = sidebarCol();
      if (col && closest(col, "[" + NP_FRAME_COLLAPSED_ATTR + "]")) return true;
      const r = sidebarRoot();
      if (r && r.hasAttribute && r.hasAttribute(NP_FRAME_COLLAPSED_ATTR)) return true;
      /* ③ 侧栏根上的 CSS-modules 本地名 `collapsed`（子串匹配，前缀哈希会变）。 */
      return classHas(r, NP_ROOT_COLLAPSED_TOKEN);
    }
    function measureWidth() {
      const col = sidebarCol();
      const rect = col && col.getBoundingClientRect ? col.getBoundingClientRect() : null;
      return rect ? Number(rect.width) : NaN;
    }
    /** 260px 的组件放进（可能更窄的）侧栏：整体等比缩，内部几何一个数都不改。 */
    function fitScale(width) {
      if (typeof width !== "number" || !isFinite(width)) return 1;
      const avail = width - NP_SIDEBAR_INLINE_PAD * 2;
      if (!(avail > 0)) return 1;
      return Math.max(0.5, Math.min(1, avail / M.W));
    }
    /** 一帧判据：写/撤 data-mpw-np-hidden。 */
    function evaluate() {
      if (!container) { hidden = false; return hidden; }
      const next = shouldHide(measureWidth(), hostSaysCollapsed());
      if (next !== hidden) {
        hidden = next;
        try {
          if (next) container.setAttribute(NP_HIDDEN_ATTR, "");
          else container.removeAttribute(NP_HIDDEN_ATTR);
        } catch (e) {}
      }
      try { container.style.setProperty("--mpw-np-fit", String(Math.round(fitScale(measureWidth()) * 1000) / 1000)); } catch (e) {}
      return hidden;
    }

    /** 宿主 React 重渲染会把我们挤掉/挪走 ⇒ 重新插回同一个位置（幂等，不新建节点）。 */
    function ensureAnchored() {
      if (!container) return false;
      const a = resolveAnchor();
      anchorMode = a.mode;
      if (a.mode === "none" || !a.container) return false;
      const parent = container.parentNode || container.parentElement || null;
      const next = container.nextSibling || null;
      const placed = parent === a.container && (a.before ? next === a.before : true);
      if (placed) return false;
      return insertInto(a, false);
    }

    function insertInto(a, logFallback) {
      if (!container) return false;
      try {
        if (a.before) a.container.insertBefore(container, a.before);
        else a.container.insertBefore(container, a.container.firstChild);
        try { container.setAttribute(NP_ANCHOR_ATTR, a.mode); } catch (e) {}
        if (a.mode === "foot-first" && logFallback) {
          log.warn(TAG + 'anchor fallback: no [class*="settingsArea"] inside the sidebar footer — '
            + 'inserted at the first position of [class*="footArea"] instead '
            + "(host sidebar DOM changed; criteria in docs/NOW-PLAYING-DSH.md §3)");
        }
        return true;
      } catch (e) { log.warn(TAG + "re-anchor failed:", e); return false; }
    }

    function startObservers() {
      const col = sidebarCol();
      try {
        if (win && typeof win.ResizeObserver === "function" && col) {
          resizeObs = new win.ResizeObserver(() => { evaluate(); ensureAnchored(); });
          resizeObs.observe(col);
          counts.resize++;
          /* ①(NP-1) 这里**不是**常驻 rAF：ResizeObserver 只在盒子尺寸真的变了时回调。
             收起/展开是 grid-template-columns 的过渡 ⇒ 过渡期间回调若干次，停下就没有回调。 */
        }
      } catch (e) { log.warn(TAG + "ResizeObserver unavailable:", e); }
      try {
        const r = sidebarRoot();
        if (win && typeof win.MutationObserver === "function" && r) {
          mutObs = new win.MutationObserver(() => { ensureAnchored(); evaluate(); });
          mutObs.observe(r, { childList: true });
          counts.mutation++;
        }
      } catch (e) {}
      evaluate();
    }
    function stopObservers() {
      if (resizeObs) { try { resizeObs.disconnect(); } catch (e) {} resizeObs = null; counts.resize = 0; }
      if (mutObs) { try { mutObs.disconnect(); } catch (e) {} mutObs = null; counts.mutation = 0; }
      cancelRaf(rafId); rafId = 0;
    }

    /** 开关的落点。on=false ⇒ 一个节点都不留、一个观察者都不留。 */
    function setEnabled(on) {
      on = !!on;
      if (!on) {
        stopObservers();
        if (root) { try { root.unmount(); } catch (e) {} root = null; }
        /* ①(NP-1) 单实例/清理守卫：先按**它自己**摘，再用选择器兜底扫一遍
           （假 DOM / 旧浏览器 / 上一轮 destroy 没走完 ⇒ 都可能留下游离节点）。 */
        const el = container;
        container = null;
        try { if (el && el.parentNode) el.parentNode.removeChild(el); else if (el && el.remove) el.remove(); } catch (e) {}
        for (const s of queryAll(doc, "[" + NP_ATTR + "]")) {
          try { if (s.parentNode) s.parentNode.removeChild(s); else if (s.remove) s.remove(); } catch (e) {}
        }
        enabled = false; hidden = false; anchorMode = "none"; note = "";
        pCur = 0; state.open = false;
        return api;
      }
      if (enabled) { ensureAnchored(); evaluate(); return api; }   /* 重复开 = 只重新锚定，不叠节点 */
      const a = resolveAnchor();
      anchorMode = a.mode;
      if (a.mode === "none" || !a.container) {
        log.warn(TAG + 'sidebar anchors not found ([class*="footArea"] / [class*="settingsArea"]) — '
          + "not mounted (host sidebar DOM changed; criteria in docs/NOW-PLAYING-DSH.md §3)");
        return api;
      }
      try {
        container = doc.createElement("div");
        container.setAttribute(NP_ATTR, "");
        insertInto(a, true);
        enabled = true;
        root = (typeof deps.createRoot === "function") ? deps.createRoot(container) : null;
        if (!root) log.warn(TAG + "no createRoot injected — DOM mounted, content not rendered");
        render();
        startObservers();
      } catch (err) {
        log.error(TAG + "mount failed:", err);
        try { if (container && container.parentNode) container.parentNode.removeChild(container); } catch (e) {}
        container = null; enabled = false;
      }
      return api;
    }

    const api = {
      setEnabled,
      isEnabled: () => enabled,
      shouldHide,
      /** 换数据源快照（见 docs/NOW-PLAYING-DSH.md §4）。 */
      setMedia(next) {
        state.media = Object.assign({}, state.media, next || {});
        if (!(typeof state.media.total === "number" && state.media.total > 0)) state.at = 0;
        render();
        return api;
      },
      setPlaying(on) { state.playing = !!on; render(); return api; },
      setProgress(at) { state.at = Number(at) || 0; render(); return api; },
      /** 给测试/排障看的一眼状态（不参与渲染）。 */
      inspect: () => ({
        enabled, hidden, anchorMode, note,
        hasContainer: !!container,
        containerParentClass: container && container.parentNode ? String(container.parentNode.className || "") : "",
        containerIndex: (container && container.parentNode)
          ? Array.prototype.indexOf.call(container.parentNode.childNodes || container.parentNode.children || [], container)
          : -1,
        nextSiblingClass: container && container.nextSibling ? String(container.nextSibling.className || "") : "",
        observers: { resize: counts.resize, mutation: counts.mutation, rafStarts: counts.raf, rafLive: rafId ? 1 : 0 },
        media: state.media, open: state.open, playing: state.playing, at: state.at, p: pCur,
      }),
      /** 宿主 slot 交来的容器（我们自己的 div）；null = slot 卸载了 ⇒ 回到降级链。 */
      setSlotNode(node) {
        explicitSlot = node || null;
        if (enabled) { ensureAnchored(); evaluate(); }
        return api;
      },
      /** 宿主 slot 的 ownerProps.wide（宿主自己的"宽/收起"状态）；null = 这版没给。 */
      setHostCollapsed(collapsed) {
        hostWide = (collapsed === null || collapsed === void 0) ? null : !collapsed;
        evaluate();
        return api;
      },
      inspectCollapse: () => ({ hostWide, hidden, fit: fitScale(measureWidth()), width: measureWidth(), hostCollapsed: hostSaysCollapsed() }),
      evaluate, ensureAnchored,
      destroy() { return setEnabled(false); },
    };
    return api;
  }

  /**
   * 宿主 slot `sidebar.footer.action` 的占用组件：**只负责把一个自有 div 交出去**。
   * 真正的挂载/隐藏/数据由控制器做（见 setSlotNode / setHostCollapsed）。
   *
   * 为什么用 ref 回调而不是 useEffect：ref 回调在**每次提交**都会以新节点被调用，
   * 所以 `wide` 变化时会自然再来一次 —— 不需要 hooks 运行时，于是本组件在
   * tools/_stub.mjs 那套桩 React 里也是可执行的（本仓的桩 useEffect 是空实现）。
   */
  function createSlotAction(ctl) {
    const h = react.createElement;   /* panel-smoke 静态判据（同 createController）。 */
    function MpwNowPlayingAction(props) {
    /* panel-smoke 静态判据：任何用了 h() 的函数体都必须自己声明 h（本仓既有写法）。 */
    const h = react.createElement;
      const pr = props || {};
      const hasWide = pr.wide !== void 0 && pr.wide !== null;
      return h("div", {
        className: "mpw_np_slot",
        "data-mpw-np-slot": "",
        "data-mpw-np-wide": hasWide ? (pr.wide ? "1" : "0") : void 0,
        ref: (node) => {
          try {
            if (node) {
              ctl.setSlotNode(node);
              ctl.setHostCollapsed(hasWide ? !!pr.wide : null);
            } else {
              ctl.setSlotNode(null);
            }
          } catch (e) { log.warn(TAG + "slot ref failed:", e); }
        },
      });
    }
    return MpwNowPlayingAction;
  }

  return { NowPlaying, PlayMark, createController, createSlotAction, shouldHide, resolveAnchor, sidebarRoot, sidebarCol };
}

module.exports = {
  NP_ATTR,
  NP_HIDDEN_ATTR,
  NP_ANCHOR_ATTR,
  NP_NOTE_ATTR,
  NP_COLLAPSE_MAX_W,
  NP_CSS,
  NP_SIDEBAR_ROOT_SEL,
  NP_SIDEBAR_ROOT_ATTR,
  NP_SIDEBAR_COL_SEL,
  NP_FOOT_SEL,
  NP_SETTINGS_SEL,
  NP_FRAME_COLLAPSED_ATTR,
  NP_ROOT_COLLAPSED_TOKEN,
  NP_SLOT_ATTR,
  NP_SLOT_SEL,
  NP_SETTINGS_SLOT_SEL,
  NP_SIDEBAR_INLINE_PAD,
  SKIP_BACK_D,
  SKIP_FORWARD_D,
  HEART_D,
  VOL_MUTE_D,
  VOL_ON_D,
  createNowPlaying,
};

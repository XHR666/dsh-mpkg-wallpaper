# 右侧「轮次导航条 / 时间线」变透明 —— token 判据与修法

> 适用版本：DSH `0.1.5-rc.2`（前端产物 `/opt/node/lib/node_modules/@deepseek-ai/dsh/`）。
> 回归：`node tools/frost-rail-test.mjs`（PART 1）。相关代码：`lib/client.js` → `refreshRailInk()`、
> `buildUiCss()` 的 rail 白名单规则、`buildCss()` 里收窄后的 `--dsw-specific-sidebar-fill` 覆盖。

## 1. 组件与 token（判据）

用户说的"屏幕右边、上下几个条、点一下切到哪一轮"= **TurnNavigator rail**：

| 项 | 值 | 证据 |
| --- | --- | --- |
| 组件 | `TurnNavigatorRail`（`TurnNavigator.module.css`） | `dsh-client-ui-chat/lib/client.js`（`const css$10`，`//#region dsh-css:…/chat/TurnNavigator.module.css.mjs`） |
| 容器 | `.eGxaPq_frame` / `.eGxaPq_marks` / `.eGxaPq_markPosition` | 同上 |
| 条本体 | `.eGxaPq_mark::before`（12×2px，`border-radius:2px`） | 同上 |
| 默认态颜色 | `background: var(--dsw-alias-border-l4)` | 同上 |
| hover/preview | `var(--dsw-alias-label-tertiary)` | `.eGxaPq_markPreview:before` |
| 激活态 | `var(--dsw-alias-label-primary)` | `.eGxaPq_markActive:before` |
| focus | `var(--dsw-alias-state-business-primary)` | `.eGxaPq_mark:focus-visible:before` |
| 宿主 token 定义 | 选择器 **`body`** / `body[data-ds-dark-theme]`（**不是** `:root`/`html`） | `dsh-client-ui-theme/lib/client.js`：`--dsw-alias-border-l4:#00000029`（亮）/ `#fff3`（暗） |

> 关键：`--dsw-alias-border-l4` 本身是 **16% / 20% alpha 的极淡色** —— 它的设计前提是"条背后是
> **不透明表面**"（`--dsw-alias-bg-layer-*` / `--dsw-specific-sidebar-fill` 那一层）。

## 2. 我们把它变透明的两条机制（判据式）

**机制 A（无效值 ⇒ 计算期 unset ⇒ 透明）**
DSH 把 `--dsw-alias-label-*` 定义在 **body** 上（html 上没有）。插件曾这样覆盖：

```css
/* lib/client.js（旧，已修） */
body[data-mpw-aqua]      { --dsw-alias-label-primary: var(--mpw-aqua-ink, inherit); … }
body[data-mpw-aqua-text] { --dsw-alias-label-primary: var(--mpw-text-ink, var(--dsw-alias-label-primary)) !important; … }
```

- `var(--mpw-aqua-ink, inherit)`：当 `--mpw-aqua-ink` 未写入时值 = `inherit` 关键字 →
  在 **body** 上继承 html，而 html 没有该属性 ⇒ 该自定义属性成为 **guaranteed-invalid**。
- `var(--mpw-text-ink, var(--dsw-alias-label-primary))` 在**同一元素**上定义 `--dsw-alias-label-primary`
  ⇒ **循环引用** ⇒ 同样 guaranteed-invalid。

两者的后果一致：所有 `background: var(--dsw-alias-label-*)` 的声明在 computed-value time 变 **unset**
= `transparent` ⇒ `.eGxaPq_markActive::before` / `.eGxaPq_markPreview::before` 的条**真的透明**。

**机制 B（对比底被我们拿掉 ⇒ 观感透明）**

```css
/* lib/client.js（旧，已收窄） */
html body { --dsw-specific-sidebar-fill: transparent !important; }   /* sidebar 分支，全局 */
.wSkVaW_root { background-color: transparent !important; }            /* 聊天区根 */
```

- 全局 token 覆盖会命中**宿主所有**用该 token 的表面（例如 trajectory 面板表头
  `Y0dWHa_table th{background:var(--dsw-specific-sidebar-fill)}`）；
- 聊天区根透明后，rail 的 16%/20% alpha 条直接画在**壁纸**上 ⇒ 与壁纸混色 ⇒ 用户观感"条变透明"。

判据：`--dsw-specific-sidebar-fill` 的官方描述就是 *"Sidebar column and title-row background."*
（`dsh-client-ui-theme/lib/client.js` 的 token 元数据），它**不该**被当成全局画布色来改。

## 3. 修法（收窄作用域 + 只用 `--mpw-*`）

| # | 修法 | 位置 |
| --- | --- | --- |
| A1 | `--dsw-specific-sidebar-fill` 的透明/不透明覆盖从裸 `html body` **收窄到明确白名单容器**：`.pI_x6G_sidebarCol`、`[class*="sidebarCol"]:not([class*="_tab"])`、`.hHd-Xa_root`、`[data-slot="sidebar"]`（token 会被后代继承，侧栏效果不变） | `buildCss()` 的 `sidebar` / `!sidebar` 两个分支 |
| A2 | aqua / 自适应文字 的 token 覆盖改为**门控 + 去 inherit/去自引用**：`body[data-mpw-aqua][data-mpw-aqua-ink]`、`body[data-mpw-aqua-text][data-mpw-text-ink]`，值为纯 `var(--mpw-aqua-ink)` / `var(--mpw-text-ink)`；门控属性由 `refreshAqua()` / `applyAquaTint()` 在**变量确实写入时**打上、清理时移除 | `refreshAqua()` / `applyAquaTint()` / 两个 CSS 块 |
| B | 给 rail 条一个**我们命名空间**的对比色：JS 按主题写 `--mpw-rail-ink` / `--mpw-rail-ink-strong`，CSS 只在 `body[data-mpw-rail-ink]` 门控下、只对白名单 `.eGxaPq_*` 节点生效，**不重定义宿主 token、不用 `!important`**（`html body[attr]` 前缀提供稳定特异性） | `refreshRailInk()` + `buildUiCss()` |
| B2 | **（2026-09-16 第三轮）反色描边晕**：再写一个 `--mpw-rail-halo`（亮主题 `rgba(255,255,255,.55)` / 暗主题 `rgba(0,0,0,.55)`），CSS 给条加 `box-shadow: 0 0 0 1px var(--mpw-rail-halo)`。**几何（宽/高/圆角/transform）一律不动**，仍由宿主决定 | `refreshRailInk()` + `buildUiCss()` |
| B3 | **（2026-09-16 第三轮）判据对齐**：`hasWall` 不再只看持久化字段（`section.image` 经 `normalizeSection` 可能是空串/布尔），追加与磨砂链同款的 DOM 兜底（`.mpw-bgWrap` 在显示 / 壁纸 `<img>` 有 src）。原来同一页面上会出现"顶栏有磨砂、rail 却被判成无壁纸"的自相矛盾 | `refreshRailInk()` |

A2 的语义：覆盖只发生在"值确实可用"时 ⇒ **永远不会**注入 guaranteed-invalid。
B 的语义：不再指望宿主的淡色 token 在壁纸上可见，而是给它一个按主题选定的、与壁纸无关的对比色。
B2 的语义：**光有对比色还不够** —— 2px 高、42% alpha 的细条压在深浅不定的壁纸上，
同色系时会再次糊掉；一圈反色边保证"无论壁纸深浅都有一条可辨认的线"。

## 3b. 第三轮定案：**不是**我们把条删掉了（真机取证）

用户第四次反馈"条还是看不见"后，本轮不再靠推断，直接量：

| 手段 | 结果 |
| --- | --- |
| `tools/header-rail-collect.mjs`（无头 Firefox + 真 DSH 页面 + 真插件产物） | `.eGxaPq_mark::before` computed `background = rgba(0,0,0,0.42)`（= 我们的 `--mpw-rail-ink` **生效**）、alpha 0.42、`12px×2px`、`opacity=1`、`display=block`；宿主 token `--dsw-alias-border-l4` 在 **body** 上解析为 `#00000029`（16%）；`body[data-mpw-rail-ink]` 存在 |
| `tools/header-rail-replica.mjs --both`（真宿主 CSS + 真产物） | 改前/改后 `::before` background 都是 `rgba(0,0,0,0.42)`；改后多出晕 `rgba(255,255,255,0.55) 0 0 0 1px` |

⇒ **结论：条的颜色与几何一直都在，我们那条覆盖没有被删、也不是 guaranteed-invalid。**
看不见的是**对比度**：宿主的 16% alpha 条假定"背后是不透明表面"，而壁纸模式下
（`--dsw-specific-sidebar-fill` 被收窄到侧栏白名单、聊天区透明）它直接压在壁纸上。
所以本轮**没有删掉覆盖**（删掉只会更看不见），而是按用户要求的"一定能实现"方向加强：
B2 的反色晕 + B3 的判据对齐。同时把这些判据一次采全进诊断（见 §4b），
真机再反馈时**一轮就能定位**，不用再来回猜。

> 用户当时的口径是"若确认被我们覆盖 ⇒ 直接把那条覆盖删掉"。实测**未确认**（覆盖生效且颜色比宿主更深），
> 因此保留覆盖并记录本节的取证过程；`?railink=off` 仍是一键回到宿主原样的逃生口。

## 3c. 第四轮定案：**是我们把它藏了**（真机 rail 上的显示机制，不是对比度）

上一轮（§3b）的结论"颜色/几何都在，看不见只是对比度"**不完整**，原因是它采到的 rail 是
**合成节点**：`header-rail-collect.mjs` 打开真页面时停在新会话（轮次 < 2 ⇒ TurnNavigator 不渲染），
于是它插入 `.eGxaPq_*` 假节点再下结论（`forced=rail=synthetic`）。假节点**没有**宿主的
`.eGxaPq_fadeTop/.eGxaPq_fadeBottom` 类，祖先里也**没有** `[data-slot="conversation.session"]`
⇒ 真正的机制永远量不到。

本轮换 `tools/rail-cover-probe.mjs`：真 cookie 打开真页面 → **点进一个 ≥2 轮的历史会话**
（本轮：77 轮 / 839 个 mark，`forced=rail=host`）→ 只在真节点上量。

### 判据（全部可从 `tools/probe-out/{before,after}.probe.{txt,json}` 复算）

| 判据 | 改前 | 改后 |
| --- | --- | --- |
| 条容器 `.eGxaPq_scroller` 内联样式 | **`display: none;`** | ``（空） |
| 条容器 computed `display` | `none` | `block` |
| 条容器 class（宿主 mask 类） | `eGxaPq_scroller` | `eGxaPq_scroller eGxaPq_fadeTop`（**带 fade 类也不被藏**） |
| `.eGxaPq_mark` 有布局 / 视口内 | **0 / 0** | 839 / 58 |
| rail 区域像素（条位置 vs 旁边背景） | 采样 0 个（区域**全白**，什么都没画） | 采样 24 个，**24 个都画出条**（`bar=197~220` vs `ref=255`，Δ=35~58） |
| `elementFromPoint`（frame 内 15 个采样点） | 顶层 = `nav.eGxaPq_frame`（宿主），链上 `ours=[]` | 顶层 = 宿主节点，链上 `ours=[]` |
| 真鼠标点 frame 中心 | 会话 `scrollTop 18782 → 51997`（**能点**） | 同（能点） |
| 祖先链异常项 | `.eGxaPq_scroller` **`display:none`**；其余 opacity/filter/visibility/transform/clip-path/overflow/z-index/contain/isolation 全部正常 | 无异常 |
| 谁写的内联 | 挂钩 + MutationObserver 记录：**`t=9823ms` 宿主刚挂上 `.eGxaPq_fadeBottom` 的那一帧被写 `style="display: none;"`** | 无该记录 |

因果定位（同级判据）：内联 `display:none` 是**唯一**成因 —— 逐张样式表禁用不改变结论；
`scroller.style.display=''` 后 computed 立刻 `block`、839 个 mark 立刻有布局。

### 根因（两条独立机制，都在我们这边）

1. **JS（主因）**：`applyDialogInline()` 的"隐藏列表 fade"清扫
   `document.querySelectorAll('[class*="fade"]')` —— 宿主 rail 的 mask 类
   `.eGxaPq_fadeTop/.eGxaPq_fadeBottom` 也含 `fade`；滚动状态一变宿主就会挂上它们。
   白名单里的 **`[data-slot*="session"]`** 又命中了会话区容器
   `[data-slot="conversation.session"]` ⇒ `isListFade=true` ⇒ 内联 `display:none`。
   清扫每 ~120ms 随 MutationObserver 重跑，所以一旦藏了就**永远是藏着的**
   （`el.style.display === "none"` 还会让后续扫描直接跳过它）。
2. **CSS（孪生规则）**：`buildCss()` 两个分支里的
   `.hHd-Xa_regionArea [class*="fade"], [data-slot*="workspaces"] [class*="fade"], [data-slot*="session"] [class*="fade"] { display: none !important; }`
   —— 同一条过宽白名单，单独就能把 rail 藏掉（改后实测：补上 fade 类后 computed 仍是 `block`）。

> 为什么"看不见但能点"：`.eGxaPq_frame`（`pointer-events:auto`、28×420）**不受影响**，
> 它才是命中点上被点到的元素；被藏掉的只是它内部画条的那棵子树（`scroller → marks → mark::before`）。

### 修法（收窄作用域，不压宿主）

| # | 修法 | 位置 |
| --- | --- | --- |
| C1 | 清扫**先整片排除会话区/rail**：`if (el.closest('[class*="eGxaPq_"], [data-slot^="conversation"]')) return;` | `applyDialogInline()` |
| C2 | 白名单 `[data-slot*="session"]` → 精确的 **`[data-slot="sidebar"]`**（保留"侧栏列表底部 fade 隐藏"原功能） | `applyDialogInline()` |
| C3 | CSS 孪生规则同款收窄（两个分支各一处） | `buildCss()` |
| C4 | 新增回归探针 `__mpwFadeSweepProbe`（假 DOM 上真跑一次清扫） | `lib/client.js` |

**没有**新增 `!important`、**没有**覆盖任何 `--dsw-*` token、**没有**裸 `html body{}`、
**没有**动 rail 的几何/颜色（§3 的 B/B2 保持原样）。C1/C2 是正确性修复，不设开关
（`?railink=off` 仍然只回退"对比补偿"那一层）。

## 4. 回退开关

| 开关 | 作用 |
| --- | --- |
| `?railink=off` | 关闭 rail 对比补偿（B）→ 宿主样式原样（条恢复为宿主的 16%/20% alpha） |
| `?sbfill=wide` | 侧栏底色 token 覆盖恢复**旧的全局 `html body` 写法**（A1 回退） |

## 4b. 诊断字段（下次上报即可定案）

`mpwDiagCollect()`（用户按「诊断/上报」走的就是它）新增 `rail` 段：

| 字段 | 含义 |
| --- | --- |
| `rail.found` | 页面上是否存在宿主 rail（`.eGxaPq_mark`）——`false` 说明当前 DSH 版本类名变了或 rail 未渲染（本版本 rail 需要 ≥2 轮对话） |
| `rail.ours` | 我们是否在补偿（`body[data-mpw-rail-ink]`） |
| `rail.markBeforeBg` | 条 `::before` 的 computed 背景色（**`rgba(0,0,0,0)` = 真的透明**） |
| `rail.markBeforeBgRaw` | `background` **简写**的最终值（区分"被删掉"与"被算成透明"） |
| `rail.markBoxShadow` | 反色晕是否生效（`none` = 晕没写上） |
| `rail.markW` / `markH` / `markOpacity` / `markDisplay` / `markVisibility` | 条的几何与可见性（宿主决定，我们不动） |
| `rail.markCls` / `markRect` / `inViewport` / `clip` | 命中的是哪个 mark、条在屏幕上的位置、**是否在视口内**、有没有被祖先裁切 |
| `rail.tokens` | 现场解析的 `--dsw-alias-border-l4` / `--dsw-alias-label-primary` / `--mpw-rail-ink` / `--mpw-rail-halo`（空串 = 该 token 未定义 ⇒ guaranteed-invalid 类问题） |
| `rail.boxRect` / `rail.boxOverflowX` | rail 容器位置尺寸 / `overflow-x`（判"被裁掉"还是"没颜色"） |

> `markRect` / `inViewport` 是第三轮新增的关键判据：rail 的 marks 在**滚动容器**里，
> 未渲染/未定位时可能整条落在视口外（本机复刻里就采到过 `y=-60`）——那属于**宿主布局**问题，
> 与颜色无关；有这两个字段就不会再把它误判成"我们的颜色被弄透明"。

## 5. 验收（可判据）

`node tools/frost-rail-test.mjs` PART 1（7 组设置 × 4 类断言）+ **PART 1b（第三轮新增）**：

1. 我们的 CSS **不命中**宿主时间线选择器（`.eGxaPq_*` / `Y0dWHa_*` / `qBU-ya` / `_1p9O6q_` / `turn-rail-*`），
   白名单只有两处：`body[data-mpw-rail-ink]` 下的 rail 对比补偿；`data-mpw-traject-clip` 门控下**仅几何属性**的溢出裁剪；
2. rail 依赖的 4 个 token 若被覆盖，值不得是 `inherit`/`transparent`/空；值来自 `--mpw-*` 时必须带 `data-mpw-*` 门控；
3. 自定义属性定义里不得出现 `var(..., inherit)` 或自引用；
4. `--dsw-specific-sidebar-fill` 不得被裸 `html body` 覆盖，且必须落在白名单容器上；
5. **（新）** rail 补偿规则必须带反色晕 `box-shadow … var(--mpw-rail-halo)`、
   **不得含 `!important`**、**不得引用/重定义任何 `--dsw-*`**；
6. **（新）** 假 DOM 跑一遍 `refreshRailInk()`，断言门控属性 + 三个值（`--mpw-rail-ink` /
   `--mpw-rail-ink-strong` / `--mpw-rail-halo`）真的落到 `documentElement` 上（`__mpwRailInkProbe` 钩子）。

**PART 1c / PART 2 新增场景（第四轮，只增不减）**：

7. **PART 1c（选择器级）**：所有设置下，"隐藏列表 fade"的规则只允许落在**侧栏**白名单
   （`sidebar` / `workspaces` / `regionArea` / `sidebarCol`），**不得**出现
   `[data-slot*="session"]` 这类会命中会话区的写法；且我们注入的全屏层必须
   `pointer-events:none` 且 `z-index < 7`（宿主 rail 的 `.eGxaPq_slot` 是 `z-index:7`）
   ⇒ 结构上不可能成为 rail 命中点上的顶层；
8. **PART 2 `fade-sweep`（假 DOM 结构级）**：按真机 DOM 形状搭
   `div.eGxaPq_scroller.eGxaPq_fadeTop.eGxaPq_fadeBottom ← nav.eGxaPq_frame ← div.eGxaPq_slot
   ← div[data-slot="conversation.session"]`，用 `__mpwFadeSweepProbe` **真跑一次清扫**，断言
   ① 它**没有**被内联 `display:none`；② 侧栏 `[data-slot="workspaces"]` 内的 fade **仍被隐藏**
   （原功能未回退）；
9. **PART 2 `fade-sweep-before`（反向对照，防假绿）**：把源码临时改回**修复前**写法
   （去掉 C1 守卫 + 白名单恢复 `[data-slot*="session"]`）后，同一条断言必须**变红** ——
   证明这组断言真的有分辨力。

`node tools/header-rail-replica.mjs --both` 另有 3 条 rail 断言（after 必须有晕、alpha 高于宿主 16%、
几何仍是宿主的 2px）。证据：`tools/probe-out/replica-ab.txt`、`tools/probe-out/before.collect.txt`。

`node tools/rail-cover-probe.mjs --label before|after`（第四轮新增的真机测量器）：
落在 `tools/probe-out/<label>.probe.{txt,json}` 的判据 = 条容器内联/computed display、
mark 有布局数、`elementFromPoint` 整条链、祖先链 paint 全量、**是谁写了内联 display:none**（写入口挂钩 + MO）、
真鼠标点 frame 中心后的 `scrollTop` 变化、rail 区域**像素采样**（条位置 vs 背景 RGB 差）、
以及"补上宿主 fade 类后 computed 仍是 block"的 CSS 单测。

> **仍需真机确认**：本机无 GPU（`backdrop-filter` 不合成）且是 headless Firefox，自动化能证明
> "条子树不再被我们 `display:none`、839 个 mark 有布局、条位置的像素确实比背景深 Δ35~58"，
> 但"条在你那张壁纸上的观感够不够显眼"仍只能人眼定；真机可 `?railink=off` 一秒对照。
> 另外：本轮测量环境里 `.mpw-bgWrap` 一直 computed `display:none`（注入式设置的 host/local
> 合并时序，属另一条线，见 `docs/WEB-WALLPAPER.md` 的持久化小节），所以像素判据是在**白色底**上取的；
> 壁纸上（有背景色）的对比度仍需真机看一眼。

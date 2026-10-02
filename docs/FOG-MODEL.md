# 雾模型：统一虚化 / 界面虚化 的厚度、半径与归属（2026-10-02 重做）

> 这份文档回答一个问题：**「哪一层该多厚、该多模糊、谁说了算」**。
> 2026-10-02 用户拍板后，语义与旧版**方向相反**，并新增了"单独动过就独立"的归属规则 ——
> 旧版本（≤3.14.0）把这条滑条当"白雾厚度"用，并且给标题栏写死了白底，所以出现
> "透明度拉到 0 却透出壁纸 / 标题栏颜色固定 / 四块各走一套"的观感。

## 0. 三条用户拍板的语义（判据钉死）

| 滑条 / 开关 | 语义 | 判据 |
|---|---|---|
| 「**界面透明度**」`sidebarAlpha` | **0 = 完全不透明（正常界面）**、100 = 完全透明（看到壁纸）；生效不透明度 = 100 − 透明度。**与模糊解耦**（模糊 0 也照样按它透出） | `fog-model-test` A2e/A2f |
| 「整屏虚化程度」`unifyAmount` | 模糊半径（壁纸层 + 各表面 backdrop）；0 = 不虚化、且接管规则写 `backdrop-filter: none` | A2/B1c |
| 「跟随统一虚化」`blurFollowUnify` | 开：未单独动过的表面与统一值**逐字一致**；任何一项**被用户单独动过后即独立**（`*UserSet` 标记）；关：全部独立。重新打开 = 清空标记 | F1–F6 |

### 0.1 存量档的**语义搬值**（一次性，2026-10-03 真机定案）

语义翻转只搬了**默认值**（新 65 ≡ 旧 35），**存量档里的用户值**在 3.15.0/3.15.1/3.15.2 里没搬：
用户当年为"求实心"把旧滑条拖到 `100`（旧语义 = 全不透明），翻转后同一个 `100` 变成"全透明"
⇒ 左栏整块透出壁纸、跟随档下右栏一起透，真机观感就是**"侧边栏被注入了壁纸的粉色"**
（探针三次读数都证明那层就是壁纸本身：隐藏壁纸层 ⇒ 该处变白、隐藏侧栏 ⇒ 该处就是壁纸像素，
链路里没有任何采样色 token）。

处置（`mpwNormalizeSection` 内，一次性）：档里**真的有** `sidebarAlpha` / `rightSidebarAlpha`
且**没有**记账键 `alphaSemantics = 2` 时，按 `新 = 100 − 旧` 搬值并写下标记：

* `sidebarAlpha 100 → 0`（全不透明）、`rightSidebarAlpha 45 → 55`（45% 不透明，观感同旧版）；
* 记账键登记在 `MPW_BOOK_KEYS`：**只随档持久化**，`readSection()` 的用户档视图（面板/导出/
  字段集合比较）看不到它；
* 幂等：已带标记的档一字不动（用户在新语义下**刻意**拖到 100 = 要全透明，也一字不动）；
* 从没设过这两个字段的档保持新默认（不透明 35% / 右栏 55% 透明度）；
* 判据 `fog-model-test` G 组（含 G8 变异：搬值公式改回 `n` ⇒ G1/G2 必红）。

**基色 = 宿主自己的表面 token**（左栏/右栏/dock = `--dsw-specific-sidebar-fill`，标题栏 =
`--dsw-alias-bg-base`）—— 0% 透明时逐像素等于"没装插件"。旧实现刷我们自己的纯白，
正是用户报的"变成白色不透明"与"标题栏固定白底"。

**透明度 = 0 ⇒ 完全不覆盖宿主**（`chromeInert`）：不写背景 / 不写 backdrop-filter /
不透明化宿主的 sidebar-fill token；标题栏（聊天区顶栏 `.wSkVaW_header`）不注入 `.mpw-hdrFrost`；
`body[data-mpw-unify]` 也不打。依据是真机读数：宿主在**打开设置面板**时会把左栏换成自己的
深色导航（`color(srgb 0.082 0.082 0.090)`），我们的 `!important` 会把它钉回旧 token ⇒
用户看到"设置一开左栏就变黑"；交还宿主后那层黑是宿主自己的行为。

## 1. 唯一源：`mpwSurfacePlan(section)`（`lib/client.js`）

返回四表面（左栏 / 标题栏 / 右栏·dock / 聊天区）的 `{ blur, t, opacityPct, base, indep }`，
所有颜色、不透明度、半径、归属**只从这里取**；`mpwFogModel()` 是它的薄包装（保留旧字段名给诊断与门禁用）。

| 表面 | 基色 | 归属判据（独立标记） |
|---|---|---|
| 左栏 | `var(--dsw-specific-sidebar-fill)` | `sidebarBlurUserSet` |
| 标题栏（聊天区顶栏） | `var(--dsw-alias-bg-base)` | `headerFrostUserSet` |
| 右栏 / dock | `var(--dsw-specific-sidebar-fill)` | `rightSidebarBlurUserSet` |
| 聊天区 | `var(--dsw-alias-bg-base)`（仍走面板不透明度 + 磨砂条/`chatFollow`，不在本模型） | `chatFollow` |

标记的唯一落点是 `commit()` 里的 `mpwMarkUserSet()`：动过某条滑条/开关 ⇒ 打标记；
`patch.blurFollowUnify === true` ⇒ 清空三个标记。面板上被接管的滑条**不再禁用**（动一下即独立），
就地显示"已改为独立"并给「恢复跟随」按钮。

## 1.1 两条真机定案（3.15.1）

* **抑制规则必须用 JS 门控**（`body[data-mpw-sblur-off]`），**不能用 `body:has([class*="_overlay"])`**：
  宿主聊天输入区的 `uV2eYG_overlayAnchor` **常驻 DOM** ⇒ `:has()` 版本永久为真，会把右栏 / dock /
  标题栏的 `backdrop-filter` 一直撤掉（真机读数：`follow` 档右栏 `bf=none` 而左栏 `blur(30px)`）。
* **「独立」= 有 `*UserSet` 标记 **且** 该项自己的开关是开的**：只按标记会把"历史上动过、但现在开关关着"
  的项判成独立 ⇒ 标题栏永远 0px（真机 `reason` 原文 `用户显式配置｜半透明底已设｜独立档 0px`，而有效档是
  `follow=true / amt=30 / side=45`）。用户口径原话："如果是关闭的，那就还是跟随去调整"。

## 2. 谁被谁接管（`body[data-mpw-unify]`）

`unifyOn` 为真时 JS 给 `body` 打 `data-mpw-unify`，产物里出现"共同表面"规则：
右栏 / dock / dockkit（面板、标签条、表面、浮层）与左栏**读同一套 token**

```
--mpw-unify-blur      = amountPx px
--mpw-unify-surface   = rgba(255,255,255, sidePct%)      （亮色）
--mpw-unify-surface-dark = rgba(18,22,30, sidePct%)      （暗色）
```

* 半径 0 时规则写 `backdrop-filter: none`（**不是** `blur(0px)`：后者仍会建 containing block）。
* better-sidebar 的面板 / 底部工作台：**只跟底色与厚度，不给 backdrop-filter**
  （面板带 backdrop-filter 会困住内部 fixed 内容），且整段受 `bsCompat` 总闸门控
  —— 用户手动关掉适配时产物里不许出现 `[data-dsh-better-sidebar]` 选择器。
* 弹窗/设置面板打开（`:has([class*="_overlay"]/_modal)`）时，这些表面的 backdrop-filter 一律摘除
  （含 backdrop-filter 的节点是 fixed 弹层的 containing block ⇒ 面板尺寸会被压缩）。

`followUnify` 为假（关了「界面虚化跟随统一虚化」）时：

* **不产出**上面那套接管规则（`--mpw-unify-*` 在产物里 0 处）；
* 左侧边栏磨砂回到自己那条（`sidebarBlur` + `sidebarBlurAmount`，`body[data-mpw-sblur]` 规则）；
* 标题栏半径回到 `headerFrostOwn > headerBlurAmount > 统一虚化` 的优先链；
* 右栏/dock 回到自己的开关与两条滑条（`--mpw-rs-blur` / `--mpw-rs-alpha`）；
* 统一虚化仍然只管它自己的两件事：壁纸层模糊 + 各表面白雾厚度。

## 3. 设置界面上的落点

* 「界面统一」页：`unifyTint`（开关）→ `unifyAmount`（整屏虚化程度）→ `sidebarAlpha`
  （左侧边栏/标题栏透明度）→ `chatFollow` → `sessionFollow`；`sec.unify.desc` 写明接管关系。
* 「界面虚化」页：**tab 栏下面第一行**是说明 `blur.follow.hint` + 开关 `blurFollowUnify`
  （统一虚化关着时开关置灰），其后才是各分组：对话框 / 设置面板 / 下载确认 / 弹层 / 遮罩 /
  **右侧边栏 · Dock**（从「外观」页迁来，它属于本页）。
* 被接管的行就地变灰 + 给接管说明（`*.overridden`），并指明"在界面虚化页关掉跟随开关即可恢复可调"。

## 4. 判据

* `tools/fog-model-test.mjs`（**85/0**，含 8 组变异自证）：
  A 口径与接线（含"说明行+开关必须夹在 tab 栏与标题之间"的位置判据、zh/en 键一一对应）、
  B CSS 落点（0 厚度 / 0 半径 / 跟随与不跟随 / 无壁纸 / better-sidebar 门控）、
  C 行为落点（`__mpwHdrFrostTest` 真跑 `syncHeaderFrost`：0 ⇒ 0px、跟随 ⇒ unifyAmount、
  不跟随 ⇒ 自己的条）、
  D 取色厚度（切片执行真 `aquaTokenOverrides`：厚度 0 ⇒ alpha 0%）、
  F 独立性/归属（`*UserSet` 只让那一项独立）、F7 透明度 0 ⇒ 完全不覆盖宿主、
  F8 静默被丢弃的 CSS 值（`rgba(var(颜色 token))`）、
  G **透明度语义搬值**（旧档 `100` = 全不透明 ⇒ 新档 `0`；一次性、幂等标记、不进用户档视图）、
  E 变异自证（把半径下限 / 取色 alpha / 跟随判断 / bsCompat 门控 / `chromeInert` 判据 / 搬值公式
  改坏 ⇒ 对应判据必红）。
* 相关既有门禁：`switch-wiring-test`（新开关真的改变 CSS）、`bs-compat-default-test`
  （bsCompat 门控与迁移）、`theme-assist-test`（半透明主题外框）、`token-namespace-test`（表面 token SSOT）。

## 4.1 已知残留（记账，不在本批改）

* `amountPx == 0` 时，H 块给左侧栏/标题栏的那条 `backdrop-filter: blur(var(--mpw-chrome-blur))`
  仍会以 `blur(0px)` 形式存在（**视觉等价于 none**，但技术上仍会建立 containing block）。
  历史上"侧栏变 containing block ⇒ 设置面板被压进侧栏"的坑由 `:not([data-mpw-holds-layer])`
  与弹层抑制规则兜住，且本轮不打算在收口批次里再动这条规则（改动面 > 收益）。
  真要收：把该规则的 filter 值也按 `chromeBlur > 0 ? blur(...) : none` 插值。

## 5. 主画布与弹层的边界（不在本模型内）

`chatFollow`（聊天区是否跟随整屏虚化）与 `opacity` 一起决定**主画布**厚度；
弹层（菜单/下拉/提示）走 `popoverBlur` + `aquaMask` 的 token 覆盖，**不受 `blurFollowUnify` 影响**
（本模型只覆盖"界面外壳 + 被点名的区域虚化项"）。改这一块前先看
`docs/TRANSLUCENT-THEME.md` 与 `tools/theme-assist-test.mjs`，别把两条语义搅在一起。

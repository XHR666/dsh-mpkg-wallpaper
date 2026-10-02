# 雾模型：统一虚化 / 界面虚化 的厚度、半径与归属（2026-10-02）

> 这份文档回答一个问题：**「哪一层该多厚、该多模糊、谁说了算」**。
> 之前厚度与颜色各写各的（表面底色读滑条、面板取色的 token 把 alpha 写死），
> 于是出现"透明度拉到 0 却还盖着一层壁纸采样粉"这种自相矛盾的观感。现在只有一个源。

## 1. 唯一源：`mpwFogModel(section)`（`lib/client.js`）

| 字段 | 取值 | 含义 |
|---|---|---|
| `followUnify` | `blurFollowUnify`（默认 **true**） | 「界面虚化」是否跟随统一虚化（新开关） |
| `unifyOn` | `unifyTint && followUnify` | 一个厚度管全部（左栏/标题栏/右栏/dock/聊天区） |
| `amountPx` | `unifyAmount` 钳到 0–40 | 整屏模糊半径（壁纸层 + 各栏 backdrop） |
| `sidePct` | `sidebarAlpha` 钳到 0–100 | 用户那条滑条的原始值：**取色 alpha 用它**（0 = 采样色一个像素都不刷） |
| `shellPct` | `amountPx > 0 ? sidePct : 100` | chrome 表面的**有效**厚度：不虚化 ⇒ 实心（见铁律 4） |
| `chatPct` | `opacity` 钳到 50–100 | 聊天区/主画布厚度（历史下限 50） |

三条铁律（都有判据钉住，见 §4）：

1. **厚度 0 ⇒ 一个像素都不刷**。取色（面板取色）/ 统一雾只决定**色相**，
   可见程度一律 = `sidePct`；写成 `color-mix(..., 0%, transparent)` 而不是"alpha 0.85 写死"。
2. **半径 0 ⇒ 真 0**。可见下限只在值 > 0 时兜（1–11px 抬到 12px 保证看得见）；
   显式 0 会走 `cleanup` 分支：注入层移除、半透明底撤掉。
   （旧写法 `Math.max(12, unAmt || 0)` 把"整屏虚化程度 = 0"也算成 12px ⇒ 标题栏还在模糊。）
3. **厚度/半径归滑条，色相归取色**。两者不再互相覆盖。
4. **不虚化 ⇒ 外壳实心**（`amountPx == 0`，2026-10-02 第 1 项真机补齐）：
   没有模糊时再把**原始（未模糊）壁纸**透出来，观感就是"两个条都拉到 0，界面反而变成半透明、
   还带壁纸自己的颜色"。所以 `amountPx == 0` 时 chrome 的有效厚度钉到 100（实心，无 backdrop-filter）；
   只有 `amountPx > 0` 时「左侧边栏/标题栏透明度」才决定"透出多少**模糊**壁纸"。
   ⚠ 取色 alpha 不看这条钳制（它按 `sidePct` 给），所以厚度 0 时不会有任何采样色层。
   两处实现必须一致：`buildCss` 的 `uAlpha`（左栏/标题栏）与 `mpwFogModel().shellPct`（右栏/dock/better-sidebar）。

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

* `tools/fog-model-test.mjs`（**48/0**，含 6 组变异自证）：
  A 口径与接线（含"说明行+开关必须夹在 tab 栏与标题之间"的位置判据、zh/en 键一一对应）、
  B CSS 落点（0 厚度 / 0 半径 / 跟随与不跟随 / 无壁纸 / better-sidebar 门控）、
  C 行为落点（`__mpwHdrFrostTest` 真跑 `syncHeaderFrost`：0 ⇒ 0px、跟随 ⇒ unifyAmount、
  不跟随 ⇒ 自己的条）、
  D 取色厚度（切片执行真 `aquaTokenOverrides`：厚度 0 ⇒ alpha 0%）、
  E 变异自证（把半径下限 / 取色 alpha / 跟随判断 / bsCompat 门控改坏 ⇒ 对应判据必红）。
* 相关既有门禁：`switch-wiring-test`（新开关真的改变 CSS）、`bs-compat-default-test`
  （bsCompat 门控与迁移）、`theme-assist-test`（半透明主题外框）、`token-namespace-test`（表面 token SSOT）。

## 5. 主画布与弹层的边界（不在本模型内）

`chatFollow`（聊天区是否跟随整屏虚化）与 `opacity` 一起决定**主画布**厚度；
弹层（菜单/下拉/提示）走 `popoverBlur` + `aquaMask` 的 token 覆盖，**不受 `blurFollowUnify` 影响**
（本模型只覆盖"界面外壳 + 被点名的区域虚化项"）。改这一块前先看
`docs/TRANSLUCENT-THEME.md` 与 `tools/theme-assist-test.mjs`，别把两条语义搅在一起。

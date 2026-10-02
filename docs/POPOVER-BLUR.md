# POPOVER-BLUR —— 弹层「同 token 两种结果」调查：有半透明、没模糊（批次 2 P3，2026-10-03）

> 症状：输入框加号打开的**指令菜单**、**权限选择器**、**上下文用量面板**三处弹层 = 半透明白底、**没有模糊**；
> 旁边的**模型选择器**（用同一枚 `--mpw-pop-surface` / `--mpw-pop-blur` token）正常有模糊。
> 本档只做**调查与文档**（任务书 §2 文件归属：`lib/client.js` 在 3.15.5 发布前冻结）⇒ 修复留给 B 档（§6）。
> 证据：`tools/host-popover-probe.mjs` 新增 `popover-blur-exp` 组 + `popover-surfaces` 组的三字段
> （`truncatedBy` / `backdropPainted` / `effectiveBlur`），原始读数 `tools/probe-out/host-popover-live.json`（gitignore 不入库）。

## 1. 结论（先说答案）

**结论 A（backdrop root 被祖先截断）成立，结论 B（背后本来就是实心）被否证。**

- 三处失败弹层的截断祖先**逐字一致**：宿主输入框卡片 **`uV2eYG_card`，`backdrop-filter: blur(14px)`**（computed，`position: relative`）。
  三处的表面 `backdrop-filter: blur(11px)`、`--mpw-pop-surface`（α 0.58）/`--mpw-pop-blur` 解析到位 ⇒ token 侧没问题（此前真机探针已测到，本轮未重复）。
- 机制：`backdrop-filter` 只模糊**同一 backdrop root 内、绘制在它下面的像素**。祖先链上凡有
  `backdrop-filter` / `filter` / `opacity<1` / `transform` / `will-change(filter|opacity|transform)` / `contain(paint|layout|strict|content)` / `isolation:isolate` / `mask` / `clip-path` 之一，
  该祖先就成为新的 backdrop root ⇒ 弹层的 blur 只能采样「`uV2eYG_card` 内部」的内容（一张近白卡片）⇒ **有 alpha、看不出模糊**。
- 模型选择器（`_7KE1Ra_menu`）是原生 popover **挂在 body 下**，祖先链无截断者 ⇒ root 是整页 ⇒ 正常。
- 「背后实心」被否证：把表面 `opacity:0` 后直接采样该矩形，背后内容 lumaStd = **23.9 / 33.5 / 26.4**（三处失败弹层）——背后是聊天区文本/壁纸（有内容可采），不是实心色。

## 2. 读数表（真页 :3080，`--groups popover-blur-exp` + `popover-surfaces`，2026-10-03）

| 弹层 | 表面 | computed bf | 截断祖先（第一个） | 背后 lumaStd（opacity:0 采样） | 实验① 移 body 清空 | 实验③ 中性化 |
|---|---|---|---|---|---|---|
| 指令菜单（加号） | `_3e4SsG_menu` | `blur(11px)` | `uV2eYG_card` `[backdrop-filter=blur(14px)]` | 23.9（有内容） | ✅ `wouldApply=true`（movedBack=true） | inline ✗ / CSSOM ✅ |
| 权限选择器 | `_list_1nxmc_8`（表面挂 `_sideTop_…`） | `blur(11px)` | `uV2eYG_card` 同上 | 33.5（有内容） | ✅ 同上 | inline ✗ / CSSOM ✅ |
| 上下文用量面板 | `JObwrW_panel` | `blur(11px)` | `uV2eYG_card` 同上 | 26.4（有内容） | ✅ 同上 | inline ✗ / CSSOM ✅ |
| 模型选择器（健康对照） | `_7KE1Ra_menu`（body 下） | `blur(11px)` | **无** | 32.3（有内容） | —（无截断者） | — |

四者 computed `background-color` = `color(srgb 0.976471 0.980392 0.984314 / 0.58)`、token 全部一致（此前读数，本轮复认）。

## 3. 三个判定实验（原始结果）

1. **实验①：表面临时 `position:fixed` 挂到 body（同步 移→扫→逐字还原，React 看不到中间态）**
   三处失败弹层移出后祖先链截断者 = **无**（`wouldApply=true`），即 root 变成整页、`blur(11px)` 将正常作用；
   `movedBack=true`（逐字还原）。这是「root 被截断」的直接因果证据。
2. **实验②：身后插高对比棋盘，bf-on vs bf-off 像素对比**
   两个 std **无差** ⇒ 本机**无头 Firefox 不合成 backdrop-filter**（已知边界，`docs/HEADER-FROST.md` 同款），
   该实验在本机**给不出像素证据**，判据以实验①/③的结构读数为准。⚠ 不能把「无差」读成「模糊无效」。
3. **实验③：临时摘掉截断祖先的嫌疑属性**
   - **inline 覆盖无效**：对 `uV2eYG_card` 写 `el.style.backdropFilter='none'`（连同 filter/opacity/transform/isolation/will-change）后，
     computed 仍是 `blur(14px)` ⇒ 宿主规则带 **`!important`**（inline 级别压不过）。
   - **CSSOM 注入有效**：向 head 追加同选择器、更晚、带 `!important` 的规则（`backdrop-filter:none !important;…`）后
     截断链**清空**（`cleared=true`）；移除注入后恢复。同步注入/扫描/移除，页面不留痕迹。

## 4. 为什么模型选择器没事（同 token 不同结果）

它挂在 `body` 下（原生 popover，`div[id=":r3:-menu"]`），祖先链上没有任何截断属性 ⇒ backdrop root = 整页；
三处失败弹层挂在输入框卡片（`uV2eYG_card`）子树内 ⇒ root 被那张卡截断。**token 一样，root 不一样**，仅此而已。

## 5. 与既有修复的关系

3.15.1 把弹层抑制从 `body:has([class*="_overlay"])` 改成 JS 门控 `body[data-mpw-sblur-off]`，治理的是
**我们自己的**侧栏磨砂层（`sblurObserver` 只摘 sidebarCol 内的近全屏弹窗）。`uV2eYG_card` 的 `blur(14px)` 是**宿主自己的规则**，
一直都在——之前没人往「弹层自己的 blur 被它截断」这个方向量过。

## 6. B 档修复方向（等 3.15.5 之后再动 `lib/client.js`；按结论 A 执行，理由如上）

- **候选 1（推荐）**：弹层打开期间，向 head **临时注入**一条带 `!important` 的规则把 `uV2eYG_card`（及其同族卡片的 bf）中性化，
  弹层关闭/移动到 body 外即移除（实验③已验证该路径有效且可逆）。必须：只在弹层打开期间、逐字还原、
  有回归判据（`host-popover-probe` 的 `truncatedBy`/`effectiveBlur` 读数 + 变异自证），并复用既有抑制链的登记习惯（先例：`data-mpw-sblur-off` / `data-mpw-holds-layer`）。
  **不要 reparent 宿主节点**（React 管的 DOM；实验①只允许作为测量手段）。
- **候选 2**：把「模糊」提到造成 root 的那一层（卡片本身）做——风险高（改的是宿主视觉栈），不推荐。
- 结论 B（背后实心 → 改实心表面）**不成立**，无需考虑。
- 判据落点：`host-popover-probe` 新读数 + 一条纯函数/桩判据挂进 `tools/check.sh` 既有步骤（不新增步骤号）+ 变异自证。

## 7. 未验证边界

- 本机无头 Firefox 不合成 backdrop-filter ⇒ 「模糊恢复后像素上真的变模糊」缺像素证据（实验②给不出），
  真机复核 = 用户侧确认修后弹层有磨砂。
- `!important` 的**出处规则**未定位：`uV2eYG_card` 不在本机安装的 `dsh-web-frontend` dist CSS 里（运行页面版本更新），
  CSSOM 扫描需在会话视图内做（本轮调试页未进会话）。修复实现时以运行期 CSSOM 为准。
- 实验③只对**第一个**截断者做了中性化；若卡片族里另有截断者（本轮三处的链上没有），修复要按链上全集处理。
- 背后 lumaStd 的阈值判定（<2 实心 / <12 渐变 / 其余有内容）是本轮约定的经验口径，不是官方定义。

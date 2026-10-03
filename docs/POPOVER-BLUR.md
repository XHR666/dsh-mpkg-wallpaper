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

## 6. B 档修复 v1（✅ 已实现，3.15.6；按结论 A 执行，理由如上）

> ⚠ 历史：v1（摘祖先 blur）→ v2（根级模糊层）→ **v3（去截断 + 补霜，见 §8）**，本节只作沿革留存。

- **候选 1（推荐）**：弹层打开期间，向 head **临时注入**一条带 `!important` 的规则把 `uV2eYG_card`（及其同族卡片的 bf）中性化，
  弹层关闭/移动到 body 外即移除（实验③已验证该路径有效且可逆）。必须：只在弹层打开期间、逐字还原、
  有回归判据（`host-popover-probe` 的 `truncatedBy`/`effectiveBlur` 读数 + 变异自证），并复用既有抑制链的登记习惯（先例：`data-mpw-sblur-off` / `data-mpw-holds-layer`）。
  **不要 reparent 宿主节点**（React 管的 DOM；实验①只允许作为测量手段）。
- **候选 2**：把「模糊」提到造成 root 的那一层（卡片本身）做——风险高（改的是宿主视觉栈），不推荐。
- 结论 B（背后实心 → 改实心表面）**不成立**，无需考虑。
- **已落地**：`mpwPopUntruncSync()`（`lib/client.js`）——只扫已打 `data-mpw-pop-bg` 的表面，
  沿祖先链找第一个带 blur 的截断祖先打 `data-mpw-pop-untrunc` 属性 + 静态 `!important` 规则
  （候选 1 的属性标记变体：比注入逐案选择器更抗类名漂移）；挂在 prun（rAF 合并 + mpwHeavyGate
  闸门）随突变重算，弹层关即摘属性撤规则。**没有 reparent 宿主节点**（实验①只作测量手段）。
- 判据：`tools/popover-untrunc-test.mjs`（11 条，挂 check.sh 第 5 步：打标/幂等/关闭还原/
  硬前提/健康弹层不标/多层只标第一个/变异自证）+ `host-popover-probe` 的 `truncatedBy` 等读数。

## 7. 未验证边界

- 本机无头 Firefox 不合成 backdrop-filter ⇒ 「模糊恢复后像素上真的变模糊」缺像素证据（实验②给不出），
  真机复核 = 用户侧确认修后弹层有磨砂。
- `!important` 的**出处规则**未定位：`uV2eYG_card` 不在本机安装的 `dsh-web-frontend` dist CSS 里（运行页面版本更新），
  CSSOM 扫描需在会话视图内做（本轮调试页未进会话）。修复实现时以运行期 CSSOM 为准。
- 实验③只对**第一个**截断者做了中性化；若卡片族里另有截断者（本轮三处的链上没有），修复要按链上全集处理。
- 背后 lumaStd 的阈值判定（<2 实心 / <12 渐变 / 其余有内容）是本轮约定的经验口径，不是官方定义。

## 8. v3 定案（2026-10-05，3.16.3）：去截断 + 补霜（取代 v2「根级模糊层」）

用户复报（3.16.2 之后）：**"指令菜单 / 权限 / 上下文占用只剩一层白色半透明，模糊没了"**。
真机矩阵 `tools/host-popover-probe.mjs --groups glass-placement`（**结构性判据**，不用像素：本机无头
Firefox 不合成 backdrop-filter，§3 实验②已证）把 v2 的两条落点都堵死了：

| 玻璃层落点 | 层自己的 backdrop root | 绘制次序（`elementsFromPoint` 命中栈） |
|---|---|---|
| 卡片子树里（v2 最终版：插在弹层父节点、紧挨弹层之前、`z = 弹层z − 1`） | **被 `uV2eYG_card[bf=blur(14px)]` 截断**（采样到的只是卡片内部已经糊过的底色 ⇒ 观感 = "白色半透明、没模糊"） | 层在弹层之下 ✓ |
| body 下（z = 4 / 8 / 50 / 2000 / 2999 全试过） | 干净（root = 整页） | **层压在整个弹层之上**（弹层在卡片的层叠上下文里 ⇒ body 级定位元素整体画在它上面），弹层 5/5 采样点被盖 |

⇒ 只剩一条路：**把截断源头摘掉**。`--groups glass-fix` 的真机实验（全部同步可逆）：

- 对 `uV2eYG_card` 摘 `backdrop-filter` + 补 `z-index:0`（它本来就是 `position:relative`）后：
  弹层（`_list_1nxmc_8`）的**截断链清空**、弹层矩形**一字不动**（`矩形未变=true`）、
  在卡片内补的霜层与卡片矩形**逐像素重合**（`sameRect=true`）、弹层中心命中仍是弹层自己（`inside-surface`）；
- 只用 `isolation:isolate` 造层叠上下文时，链里仍留着 `isolation`（本机判据把它算作截断成因之一）
  ⇒ 采用「定位元素 + `z-index:0`」（`auto` 与 `0` 的绘制次序一致，不会挪动它与其他元素的上下关系）；
- **静态祖先不碰**：变体实验里给它 `position:relative` 会把宿主弹层带跑（`矩形未变=false`）⇒ 这类退回 C 类实底。

落地（`lib/client.js`，宿主元素一个都不碰语义，只"摘一个属性 + 垫一层自己的霜层"）：

- `mpwPopClassifySync()` 三分类不变；B 类现在收集**待去截断祖先**：我们自己的弹层装饰
  （`p.matches(MPW_POP_TAG_SEL) && !p.hasAttribute("data-mpw-pop-bg")`）或已知包装容器
  （`_card|composer|overlayAnchor|_seat|_stack`），且必须是定位元素；
- `mpwPopUntruncApply(need)` 幂等地打/摘 `data-mpw-pop-untrunc` 与容器内的 `data-mpw-pop-frost`
  （`inset:0` + `z-index:-1` + 沿用容器原 `backdrop-filter`）⇒ 容器磨砂一点没少、弹层自己的 blur
  采样整页（**含被弹层压住的目标条**）；
- 静态规则 `html body [data-mpw-pop-untrunc][data-mpw-pop-untrunc] { backdrop-filter:none !important }`；
  我们自己的弹层表面规则统一追加 `:not([data-mpw-pop-untrunc])` —— 否则我们给菜单容器刷的那层 blur
  特异性太高、根本摘不掉（真机 `_3e4SsG_menu` 就是这种：它是加号菜单的**外层容器**，blur 是我们给的）；
- **旧「根级模糊层」整体删除**（含滚动/缩放重贴监听、层账本、包含块偏移校正）。

真机复测（3.16.3，`--groups glass-fix,tip-flicker`）：

- 权限菜单：`untrunc=1 frost=1 glass=1 trunc=0 旧根级层=0`；卡片 `bf=none / inline z="0"`；
  霜层 `bf=blur(14px) z=-1 rect=卡片 rect`；弹层表面 `bf=blur(11px) 截断链=[]`；
- 加号菜单：外层 `_3e4SsG_menu` 同样拿到干净的 root（`bf=blur(11px) 截断链=[]`）；
- **关掉弹层后**：`untrunc=0 frost=0 glass=0 trunc=0`、无残留、卡片 `bf` 与 inline `z-index` 还原。

## 9. v3 的未验证边界

- 「像素上真的变模糊了」依旧拿不到本机证据（同上）⇒ 需用户真机确认；
- 霜层用 `z-index:-1` 画在**容器背景之上、内容之下**，前提是容器是层叠上下文（定位元素即可）；
  静态祖先一律退回 C 类（实底），不硬来；
- 多截断祖先（真机加号菜单链上有 `_3e4SsG_menu` + `uV2eYG_card`）按"逐个收集、逐层去截断"处理，
  每个都配一层霜层；链长上限沿用分类时的 12 层。

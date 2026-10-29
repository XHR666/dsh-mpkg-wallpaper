# ZCode 进度台账 · 插件 UI 四项（2026-11-02 任务单）

> 执行者：Z Code。工作位置：`dsh-mpkg-wallpaper/`（真实仓库，HEAD 起点 `ea3e29b`）。
> 对应任务单：工作区级 `docs/ZCODE-UI-TWEAKS-TASK-ORDER.md`（本仓 docs/ 的上一级；必读三件已读：ENGINEERING-RULES / AGENT-NOTES / UI-TWEAKS-ROUND-20261102）。
> 执行顺序按 UI-TWEAKS-ROUND 文档 §执行顺序：①悬浮回归 → ④左移根治 → ②③圆角。

---

## 任务①（A）侧栏收起态悬浮效果消失（回归）—— ✅ 完成

**取证（改前）**
- `grep -n "sidebar-collapsed" lib/client.js` 命中 4 处规则群；回归源 = `c1a55a6`（2026-11-01"切设置页后界面左移"）加的两条：
  - `html body:has([data-sidebar-collapsed]) [class*="sidebarCol"] { margin:0!important; border-radius:0!important; box-shadow:none!important }`
  - `html body:has([data-sidebar-collapsed]) [class*="sidebarCol"]:not([data-sidebar-right-panel]) { padding:0!important }`
- **根因定位**（读宿主包源码取证，非猜）：
  - 宿主 `dsh-client-ui-layout`：`data-sidebar-collapsed` 只改 `[data-platform=darwin] centerCol` 边线与 frame `--dsh-frame-leading-clearance`；**不给 sidebarCol 任何 margin/radius/shadow**。
  - 宿主 `dsh-client-ui-sidebar`：收起态只改 root padding / iconButton 尺寸 / rail 显隐。
  - ⇒ 收起态悬浮观感**本来就是我们自己的** `body[data-mpw-float] [data-sidebar-collapsed] [class*="sidebarCol"]` 外壳规则（margin 12px -12px 12px 12px + `--mpw-side-radius` 令牌圆角 + 边框 + `--mpw-float-shadow`）在画；c1a55a6 用 `!important` 把这三件套连同 padding 清零 = 用户看到的"悬浮效果消失"，且右栏面板（同命中 sidebarCol 子串）在左栏收起期间被误清。
  - 该规则当时针对的"-76px 左移"已由 2026-11-02 探针定案为任务④的 tab 行超宽（frame.scrollLeft=156），归因不再成立。

**修法（根治）**
- 整类清零规则**整体撤销**（连同其注释改写为撤销理由 ⑨a，含三条证据）；收起态几何交还：float 开 = 我们的悬浮外壳规则（专属门控 `body[data-mpw-float]`，悬浮关 ⇒ 我们的壳零命中——这就是"专属外壳"的判定锚，不引入第二套壳标记）；float 关 = 宿主原生收起几何。
- 未用 `!important` 兜底、未动宿主、展开态零变化（判据 A2 逐键断言）。

**门禁读数（改后）**
- `node --check lib/client.js` ✓
- 新判据 `node tools/sidebar-collapsed-float-test.mjs` ⇒ **9 通过 / 0 失败**（A1a/A1b/A1c 收起态三件套、A2 展开态零变化、A3/A3b 清零模式禁止、A4 专属门控；M1=写回清零规则⇒A3 红、M2=壳三件套被清⇒A1 红，期望红集==实际红集逐条相等）
- 关联：`sidebar-collapse-geo` 20/0 · `float-family-geo` 24/24 · `glow-fixed-safety` 16/0 · `sidebar-frost-team-panel` 17/0 · `style-scope-guard` 0 RED · `panel-smoke` 5/5
- 已登记 `tools/check.sh` 第 6 步。

**判据演进**：无删除断言（新判据文件）。

**未验（真机待用户）**：展开/收起各看一次悬浮效果；收起 rail 图标行完整性；左栏收起时右栏悬浮不受影响。

---

## 任务④（D）设置页 tab 行超宽 → 界面整体左移（根治）—— ✅ 完成

**实现（结构性根治，去掉"超宽行"前提）**
- `.mpw_tabRow`：`display:flex` + `translateX(-index×100%)` 翻页 ⇒ **`display:grid` 同格堆叠**：
  - `.mpw_tabBody > .mpw_tabRow > * { grid-area: 1 / 1; visibility: hidden; min-width: 0; }`
  - `.mpw_tabBody > .mpw_tabRow > [data-mpw-tabactive] { visibility: visible; }`
  - 任一时刻只有激活面板参与可见布局 ⇒ 行宽恒等于容器宽；切换只改激活标记，**不再写 transform**（祖先链零 transform，fixed 后代定位基准不变）。
- 8 个面板行内样式 `flex:"0 0 100%" / minWidth:"100%"` 删除，加 `data-mpw-tabactive`（React 对 undefined 值省略属性）。
- **选 grid 而非任务书草案的 position:absolute**（任务书 §高度"二选一选简单可靠者"的后者）：absolute 面板不给父容器高度需另补；grid 同格天然取最大高度、无定位基准问题。两条不变量相同（行宽恒等容器宽 + 激活项唯一可见）。已写入判据文件头留痕。
- 高度自适应 JS effect 保留（每帧量激活面板 offsetHeight）；`align-items: start` 防 grid stretch 干扰测量。
- **看门狗 `c5fbc94` 降级为纯监控**：不再 `scrollLeft=0` 拉回（避免掩盖新问题），命中只打一次性日志；`496f54e` overflow 裁剪兜底保留。

**判据演进（留痕）**
- `tools/bs-tab-test.mjs` 文件头新增"契约沿革（2026-11-02）"：D3 由"translateX(-0%) 位移为 0"演进为"激活标记恰好一个且在 scan 面板上"；删掉的只有 transform 值断言；index/顺序/数量/默认激活项/滚动位置语义（面板始终挂载）断言全部保留。
- 新增 D8a-d（产物堆叠规则 / 激活面板可见 / tabRow 无 transform 残留 / 源码零 translateX·flex 超宽残留）+ M6/M7 变异。

**门禁读数**：`bs-tab-test` **50/0**（44→50：+D8a-d、+M6/M7）· `bs-scan-test` 36/0 · `preset-test` 57/0 · `style-scope-guard` 0 RED · `panel-smoke` 5/5 · `css-matrix` 1115 组 ✓ · `token-namespace` 12/0

**未验（真机待用户）**：切设置页各 tab 后 `frame.scrollLeft===0`、界面不再整体左移。

---

## 任务②（B）Apple 连续圆角（squircle）+ 半径 token 化 —— ✅ 完成

**实现**
- token 块（buildUiCss 顶部，body 单点）：`--mpw-r-lg:16px / --mpw-r-md:10px / --mpw-r-sm:6px / --mpw-corner-shape:squircle`（scope-guard 放行纯 `--mpw-*` 的 body 块；不并入 emitSurfaceTokens 的 tok() 表——那张表被 token-namespace 按"四表面"枚举）。
- `@supports (corner-shape: squircle) { … }` 应用面：29 个我们自己的圆角矩形类（面板控件/缩略图/网格/预设 chip/对话框等）+ 悬浮外壳三面（header / sidebarCol / 右栏 push·dockkit）。**不支持的环境整块不生成 = 观感维持现状**；目标运行时支持（宿主自身 CSS 已用 `corner-shape:round`，dsh-client-ui-sidebar 收起态 toggle 实证）。
- **不做 clip-path/mask SVG 回退层**（红线：fixed 后代容器禁裁剪；且目标环境已支持，回退层无收益纯风险）。判据 D1/D2 钉产物零 `clip-path:`/`mask:` 声明。
- **token 化 17 处**（逐值等于旧字面量 ⇒ 观感零变化）：busy/section/scanSel/input/selectMenu(经 outer)/button/fileBtn/reset/updBadge/thumb/tag/liquidGroup(经 outer)/dialog/roundCompat + tabBar/tab + liquidSlider 走任务③的 outer/gap。胶囊与正圆（999px/50%/开关轨道）不套 token、不应用 squircle（会把正圆改形）。
- **例外具名登记**（值级账本，判据 C1/C2 双向防腐）：2px(tab 下划线) / 3px(进度条) / 4px(微图) / 8px(现役次高频档 19 处，介于 sm/md 之间防观感变化) / 11px、16px(开关轨道胶囊) / 14px(玻璃容器+bs 面板) / 15px(预设 chip) / 999px(胶囊圆)。
- 已知小限制（写入注释）：`border-radius:inherit` 的磨砂伪元素继承半径但不继承 corner-shape（该属性不被继承），两种曲线都在同一角方块内，肉眼不可辨。

**门禁读数**：新判据 `node tools/corner-continuity-test.mjs` ⇒ **20 通过 / 0 失败**（A1 token 单点、A2 @supports 包裹全覆盖、A3 token 化逐选择器、B1-B6 任务③契约、C1/C2 例外账本、D1/D2 红线、D3 应用面；M1-M4 变异红集逐条相等）· `style-scope-guard` 0 RED · `panel-smoke` 5/5 · `bs-tab` 50/0 · `preset` 57/0 · `css-matrix` 1115 组 ✓ · `token-namespace` 12/0
- 已登记 `tools/check.sh` 第 12 步（token-namespace 之后）。

**未验（真机待用户）**：转角连续曲率观感（支持的浏览器生效、不支持的零变化）。

---

## 任务③（C）内外圆角同心（内 = 外 − 间距）—— ✅ 完成（并入 corner-continuity-test）

**落地三处**（容器定义 `--mpw-r-outer` / `--mpw-gap`，**padding 同样读 gap** ⇒ padding 变动内半径自动跟随；内层一律 `max(0px, calc(var(--mpw-r-outer) - var(--mpw-gap)))`，禁止硬编码）：
| 容器 → 内层 | outer/gap | 内半径 | 旧值 |
|---|---|---|---|
| `.mpw_tabBar` → `.mpw_tab` | 12px / 4px | 8px | 8px（逐等，零变化） |
| `.mpw_selectMenu` → `.mpw_selectOpt` | `--mpw-r-md`(10px) / 4px | 6px | 8px（同心化 −2px） |
| `.mpw_liquidGroup` → `.mpw_liquidSlider` | `--mpw-r-lg`(16px) / 6px | 10px（inset/width 同步读 gap：`inset:var(--mpw-gap)`、`width:calc((100% - 2*gap)/6)`） | 12px（同心化 −2px） |

**例外（登记）**：`.mpw_scanSel` 内缩 10px ≥ 外半径 10px ⇒ 同心公式退化为 0，保留 8px 观感不套公式（`.mpw_scanSelThumb`）。其余"外层+内缩"组合盘点后不满足"圆角相邻"前提（行内元素/间距≥半径/已有 inherit 继承），不强行套用。

**判据**：`corner-continuity-test` B1-B6（容器 outer/gap 定义 + padding 读 gap + 内层 calc 形式逐条断言）+ M3（tab 内半径改回硬编码 8px ⇒ B2 红）。契约写明：**padding/margin 变动时内半径自动跟随（padding 与 gap 同源）**。

**未验（真机待用户）**：tab 栏/下拉菜单/倍速滑块的内外同心观感。

---

## 全量门禁（四项全部完成后）

- 命令：`bash tools/check.sh --full`（12 步逐条真跑）
- **第一轮**：PASS 11 / FAIL 1 —— 唯一真红 = `fog-model-test` **F7b**（透明度 0 ⇒ 左栏规则 ≤2 条白名单）：任务②给悬浮外壳三面加的 corner-shape 规则（`@supports` 包裹、`body[data-mpw-float]` 门控）成为第 3 条 sidebarCol 规则。日志里 props-panel 的 B1/B2/A1c 等 ✗ 行经逐条核对全部是**变异自证的红集打印**（汇总行"✓ M… 必红"在远处），非真失败（该测试 96/0）。
- **F7b 判据演进（留痕）**：上限 2→3、白名单加入 `data-mpw-float` 门控族（corner-shape 外壳规则与既有白名单里的 `[data-sidebar-collapsed]` 收起规则同属悬浮特性）。语义保持：透明度模型自身仍零注入，白名单仍只枚举用户显式特性的门控选择器，第 4 条即红。演进写进 `tools/fog-model-test.mjs` 文件头与 F7b 注释；演进后 `fog-model` **96/0**。
- **第二轮（最终）**：**PASS 12 / FAIL 0 / SKIP-CACHED 0**（12 步全真跑）
  - 各步：1) 0.8s · 2) 430.4s · 3) 12.2s · 4) 0.4s · 5) 97.5s · 6) 41.9s · 7) 3.2s · 8) 11.0s · 9) 24.6s · 10) 32.8s · 11) 20.5s · 12) 374.1s
  - 总耗时 1052.5s（≈17.5 分钟）；峰值内存 ≈1679 MiB（进程组 RSS 每 2s 采样，上界）；输入指纹 b03cd3351803

## 真机待验清单（判据管不到、交用户验）
1. 任务①：悬浮开 → 侧栏展开/收起各看一次：展开悬浮卡片不变；**收起 rail 悬浮卡片回归**（圆角/边框/阴影），rail 图标行完整；左栏收起时右栏面板悬浮不受影响。
2. 任务④：切设置页各内部 tab ⇒ 界面不再整体左移（此前真机读数 frame.scrollLeft=156；看门狗已降级纯监控，若位移复现会在 console 留一次性日志，请回报）。
3. 任务②：设置面板/按钮/输入框/缩略图/悬浮卡片转角 = 连续曲率（squircle）；用不支持 corner-shape 的浏览器对照应零变化。
4. 任务③：tab 栏内 tab 与外框、下拉选项与菜单框、倍速滑块圆角同心。

## TODO / 悬着的事
- 无遗留代码项。版本号按任务单要求未动（等全部优化做完由用户定）。
- 判据文件头均已写明语义与演进原因；新判据已登记 `tools/check.sh`（第 6 步 sidebar-collapsed-float-test、第 12 步 corner-continuity-test）。

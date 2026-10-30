# 任务书 A 执行台账（main 分支 · 插件 UI/文案/功能批次）

> 执行：Z Code（新会话）· 日期：2026-11-03 · 基线：HEAD `6e5ef63`（工作树干净，`check.sh --list` 全部 12 步"脏"= 下次全量真跑）。
> 本文件按任务书 §3.1 要求记录：改动文件 / 门禁读数 / 判据演进留痕 / 未验项 / TODO。

---

## 已证明（可复跑命令 + 读数）

### A1 文案与命名（#5/#6/#8/#9/#10）
- `lib/client.js`（i18n 双词典 + 外观 tab；设置页与右侧栏共用同一 MpkgSection 实现，天然双端同步）：
  - **#9/#10**：`title`→「DSH壁纸引擎」、`nav`→「DSH壁纸引擎」（en 同步 "DSH Wallpaper Engine"）。
  - **#5**：外观 tab 配色组新增组标题 `sec.color`「主题与配色」（覆盖 主题颜色/面板颜色匹配/配色 accent/遮罩自定义色/自定义灰字颜色；悬浮与光晕不划入）。
  - **#8**：说明段改写为指定文案；6 个整体链接（两项目名 / MIT LICENSE / GPL-3.0 LICENSE / 给颗 Star / 提交反馈），样式复用 `.mpw_repoLink`（无默认蓝、无按钮）。链接目标全部 curl 200 实测可达。
  - **#6**：zh 用户可见字符串 9 处 `**` 符号清除；壁纸设置 tab 优先精简（webframe.hint / autoCompat.desc / web.modeHint / lib.customHint / npNowPlaying.desc / npLinkWallpaper.desc 等 13 键），en 同键同步；测试项 tab 的诊断长文案保留（技术参考性质）。
- 门禁：bs-tab **50/0** · preset **57/0** · style-scope-guard **0 RED** · panel-smoke **5/5** · np-control 106/0 · fog-model 96/0（A1 当时的读数；最终全量见文末）。

### A2 bug 家族（Bug1/2/3/5 + #11）
- **backdrop-filter 家族迁移**（同修 Bug 2/3/5；根因 = 宿主容器**本体**的 backdrop-filter 成为 fixed 后代包含块）：
  - 迁移到 `::before`（inset:0 / z-index:-1 / pointer-events:none / border-radius:inherit / 本体 backdrop-filter:none + position:relative 锚定）：E 块侧栏磨砂、G 块菜单玻璃（保留 z-index:900）、弹层表面块（popTip/popTree/popSurface，本体改 none + 伪元素承载 var(--mpw-pop-blur)）、H 块左栏与右栏 rs-surface、全屏右栏、统一虚化右栏、aqua 弹层补玻璃、composer 卡（MPW_COMPOSER_BLUR_CSS）。
  - 抑制规则（sblur-off / dragging / parked / :has(_overlay)）全部补 `::before` 变体。
  - 形态与标题栏磨砂既有范式同源（header 2026-09-13 已定案：本体禁 backdrop + ::before + relative）。
  - **判定保留（本体仍带 blur，逐条判定记录）**：`[data-menu-material]/[data-trigger-menu]`（宿主 isolation 外壳，本体 blur 是唯一能采样整页的层）、`[data-team-panel]/bRhRbq_panel`（叶子浮层面板）、dialog/settings/confirm（顶层覆盖层）、`.mpw_np_box`/todo 卡（自有叶子元素）、tooltip（本身就是 fixed 叶子）。
  - F 块 `html body[data-mpw-rs-surface]` 与 unify-chrome 侧栏两条为**复合选择器死规则**（属性打在面板不在 body；body 不可能带 sidebarCol 类）——保持死态只做范式统一，未擅自"修活"。
- **Bug 4（unclip 降级）**：tooltip-unclip 整条机制**默认关闭**；兜底开关 = `window.__mpwTipUnclip === true` 或 `?mpwtipunclip=1`。打开后三道护栏：body/html/[class*="frame"] 永不碰；滚动容器不碰（既有）；放开前后 scrollHeight/clientHeight 变化 ≥1px ⇒ 下一帧回滚 + 拉黑。MPW_TIP_SHELL_SEL 随"外壳限定打标"退役（护栏统一收进 mpwTipUnclipMark）。
- **Bug 1（resize 手柄补偿）**：`mpwFloatHandleSync()`——每个 col-resize/ew-resize 手柄按"视觉边缘 − 布局中心（剔除当前补偿量，防反馈回吃）"算 dx，`handle.style.transform = translateX(dx)`；悬浮关清空；切换/窗口 resize 时 kick + ~420ms rAF 跟随 margin 过渡。补偿对象实测锚点：左栏 margin 12px（探针读数 280→268）。
- **#11**：icon.svg + 内联 NAV_ICON_SVG 的 stroke 1.5→2.5（加粗不是放大；16px 渲染线宽 ≈1.7px 不糊）。
- **判据演进（全部留痕，未删断言换绿）**：
  - `tools/glow-fixed-safety-test.mjs` 新增 **C 组**（家族本体零 backdrop-filter，三档产物扫描；::before 不计）+ **D 组**（手柄补偿 ±1px，左右各一条 + 悬浮关清空）+ 变异 M4/M5/M6。读数 **26/0**。
  - 新增 `tools/tip-no-layout-shift-test.mjs`（默认关/兜底开/永不碰名单/位移即回滚+拉黑/无位移对照；M1–M3）**13/0**。
  - `tools/css-matrix.mjs` ①2026-11-03 演进：第 4 条回归放行 `::before/::after` 伪元素规则（守的回归是"浮层**本体**被拉进普通流"；伪元素定位不影响本体）。读数 1115 组全过。
  - `tools/token-namespace-test.mjs` ①2026-11-03 演进：`specificity()` 不再把 `::before/::after` 当伪类计 +100（CSS 规范：伪元素不计类权重）；否则"同位置的本体→伪元素迁移"会凭空压过本体规则被误判为生效值漂移。变异自证不变。读数 **12/0**。
  - `tools/theme-assist-test.mjs` A3 断言随 composer 磨砂形态更新（本体 relative+none、磨砂在 ::before，同半径 16px）。读数 **61/0**。
  - `tools/sidebar-collapse-geo-test.mjs`：A1/A7 半径口径从"18px 字面量"演进为"跟随宿主 --dsw-radius-panel（回落 26px）"（对应 2026-11-02 提交 e99fabb/6e5ef63）；B 组按 #Bug4 默认关演进（新增 B0b 默认关断言；B1/B2 打标断言在兜底开关下跑）。读数 **21/0**。

### A3 功能与数据（#4/#2/#1/#7）
- **#4 光晕亮度+颜色**：新键 `glowBright`（numFields，50–200%，滑条）+ `glowColor`（strFields，#rrggbb，6 预设 + 取色板 + 「默认」）；CSS 峰值链加 `var(--mpw-glow-peak-scale, 1)`（默认 1 = 行为不变）；JS 按档写 body 内联 `--mpw-glow-rgb` / `--mpw-glow-peak-scale`；UI 在外观 tab 光晕开关开启时显示（双端共用组件）；进 MPW_PRESET_FIELDS。判据：panel-glow-face **23/23**（A3/J2/MV3 公式随演进更新，留痕）。
- **#2 better-sidebar 适配退役**（先调查后删除）：
  - 调查结论：适配选择器 `[data-dsh-better-sidebar]` 只命中第三方插件 DOM；DSH 原生右栏已接管（用户实证 + 宿主 0.2.0）；「壁纸」页签注册（mpwBsTab*）走**宿主 betterSidebar 服务**（ctx.get/reflect），与适配块无关 → 删除不影响页签。
  - 删除范围：bsCompat/bsFloat/bsFont/bsReveal/bsRevealAlpha/bsAlpha/bsAqua/bsBottomAvoid/bsCompatUserSet 设置键 + 默认值迁移 + 备份导入标记 + 预设快照白名单 + numFields/boolFields 条目 + reset 默认 + UI 块 + zh/en i18n + buildCss 适配模板块（175 行）+ bsTakeoverSurface 插值 + data-mpw-bs-version 版本门控链（client）+ host /ping 的 betterSidebar/betterSidebarVersion 字段与安装/版本检测（lib/index.js，任务书授权范围）。
  - 旧判据删除：better-sidebar-compat-test / bs-compat-default-test / bs-compat-probe / bs-bottom-panel-probe；新墓碑判据 `tools/bs-compat-removed-test.mjs`（零残留 + 页签注册健在守护 + M1/M2）**7/0**；check.sh 第 10 步改挂。
  - 连带判据演进（留痕）：fog-model B5/B5b/E4 块退役（对象不存在，93/0）；style-scope-guard 删 host:better-sidebar / host:bs-bottom-resize 锚点、新增 host:dsh-popover / host:dsh-surface 独立登记（原被 bs 锚点顺带匹配）+ 账本行更新 + 指针校准，--selftest 全过；settings-persist 夹具键移除（112/0）；cross-platform 台账行随探针删除（63/0）。
- **#1 背景来源 → 扫描壁纸回填**：新增模块级纯函数 `mpwScanAppliedMatch(w, section, scanAppliedKey)`——扫描页 apply 记忆**或** `section.mpkgKey`（身份与 mpwScanItemSection 同源：视频=w.key、steam=library|ltoken、custom web=custom|name）；网格 cell 高亮 `.mpw_scanCellApplied`（描边 + ✓ 角标）+ 详情按钮「已应用」。
  - 同类扫描：背景来源页自身的"当前壁纸"显示本就 section 驱动（2026-11-01 `__mpwSettingsRefresh` 已通）；来源页 steam 列表与应用身份同源（推断，未真机复验）。
  - 判据：bs-scan-test 新增 **K 组**（K1 恰好一 cell 高亮 / K2 按钮文案 / K3 不匹配零高亮 / K3b / K4 steam 身份）+ 变异 M-applied，读数 **42/0**。
- **#7 更新检测模拟路径**：`checkUpdate()` 在真请求前拦 `?updcheck=fake`（或 `window.__mpwUpdCheckFake = true`）⇒ 本地造 `{ok, fake:true, hasUpdate:true, remoteVersion:"9.9.9", contentDiff:true}`（红点徽标 + 确认弹窗可稳定复现）；带 fake 标记不会走进 update-apply；/update-check 逻辑本身**未改**。新判据 `tools/update-fake-test.mjs`（A1–A4 + M1/M2）**8/0**，登记 check.sh 第 6 步。下一步建议（写明不改逻辑）：真正改功能时再动 /update-check 的版本比较与市场只读路径。
- **A3 分门禁**：props-panel-wiring ✓（见全量）· preset 57/0 · bs-scan 42/0 · settings-persist 112/0。

### A4 #13 左移回归（条件任务）
- **未复现（未真机）**：本环境无 DSH 会话 UI 可探（用户偏好：不跑浏览器/端到端门禁；:3080 为用户环境只读不动）。已做的静态核验：
  1. ⑩a 根治在位：`.mpw_tabRow{display:grid}` + 子面板 `grid-area:1/1; visibility:hidden` + 激活面板 visible —— 无 translateX/超宽行；
  2. `switchTab` 只 `setSettingsTab`（无 style 写入）；
  3. 横向看门狗为纯监控（只日志，不自动拉回）；
  4. 裁剪兜底规则在（[data-mpw-bs-tab] overflow-x:hidden + contain:inline-size）。
- **回归判据已锁死**：bs-tab-test D8 组（D8a–D8d 既有）+ 本轮新增 **D8e**（switchTab 本体零 style/transform 写入）+ 变异 **M8**（注回 translateX ⇒ 必红）。读数 **52/0**。若真机再复现：跑任务书附录探针（frameScrollLeft/docScrollLeft/wide），按读数定位。

### 基线就红的修复（R8 归因：stash 对照在 HEAD 上同样红 ⇒ 既有缺陷，非本次引入）
- `renderer/archive/*.mjs`（9 个）写死本机工作区绝对路径 → 环境推导（MPW_ROOT/MPW_BUNDLE/MPW_SCENES/MPW_PW/MPW_WE_ASSETS 可覆盖）。
- `renderer/**` 245 个 tracked 文件含 CRLF 或本机路径前缀 → 报告快照类规范化（CRLF→LF、本机工作区前缀改 `~/DSHarea` 口径），内容相对含义不变；`renderer/reports/submesh-3554161528/ledger-17*.json`（Windows 非法文件名字符 `*`）改名 `ledger-17-star.json`。renderer 代码零改动。

## 推断（有证据但非直接观测）
- 伪元素磨砂在真机上的观感与本体 blur 等价：由层叠模型推得（uniform 底色与 blur 可交换：blur(tint⊕page) = tint⊕blur(page)），且标题栏磨砂同范式真机已验证数周。强度：中-强（需要真机最终目验）。
- 迁移后 tooltip 不再被裁（Bug 2/3 消失）：包含块链已按探针证据切断；等真机悬停验证。
- resize 手柄补偿在真机上 ±1px：判据用探针读数构造的几何夹具；真机拖拽手感待用户确认。

## 未验（如实列出）
- 真机目验清单：①展开态「收起侧边栏」tooltip 完整显示；②收起态「展开左侧边栏」tooltip 不再黑块；③三点菜单「下载 session 日志」热区正常、悬停不闪；④发送/暂停键悬停不再上下震荡；⑤侧栏/右栏磨砂观感与改前一致；⑥悬浮拖拽线贴卡片边缘（左 −12px / 右反向）；⑦光晕亮度/颜色两行 UI + 生效；⑧设置页/侧栏两处新文案与「主题与配色」组标题；⑨图标加粗后小尺寸清晰度；⑩切 tab 无左移（A4 静态已锁，真机复验一次）。
- `?updcheck=fake` 只做了静态+表达式级判据，未在真浏览器走一遍徽标/弹窗链路。
- 全量门禁 12 步（见下）。

## 判据演进汇总（不许静默，全部留痕）
| 文件 | 演进 | 理由 |
|---|---|---|
| css-matrix | 规则 4 放行 ::before/::after | 守的是"浮层本体位置"；伪元素磨砂是本轮家族修复形态 |
| token-namespace | specificity 不计伪元素 | CSS 规范；否则机制迁移被误判为取值漂移 |
| panel-glow-face | A3/J2/MV3 公式加 peak-scale | #4 亮度因子（默认 1 行为不变） |
| theme-assist | A3 随 composer 磨砂形态更新 | #Bug5 家族迁移 |
| sidebar-collapse-geo | A1/A7 半径口径 + B0b 默认关 | 对应 6e5ef63 半径演进 + #Bug4 unclip 降级 |
| bs-scan-test | 新增 K 组 + M-applied | #1 回填功能的判据先行 |
| bs-tab-test | 新增 D8e + M8 | A4 #13 回归锁 |
| glow-fixed-safety | 新增 C/D 组 + M4/M5/M6 | A2 家族判据（本体禁令 + 手柄 ±1px） |
| style-scope-guard | 锚点登记增删 + 账本行 | #2 退役 + dsh-popover/dsh-surface 独立登记 |
| fog-model / settings-persist / cross-platform | 随适配删除演进 | 判据对象不存在 |

### 全量门禁过程中的修复（留痕）
- 第 1/2 次 `--full` 第 2 步红，共 5 处（全部独立复跑修绿后再上全量）：
  ① `np-media-test` G 组变异 `web-path-skips-float-attr` 注入点漂移 —— A2 的 resize 手柄 kick 插进了它锚定的 web 分支原文块内 ⇒ kick 移到块外（语义不变），**117/0**；
  ② `wallpaper-lifecycle` R10 锚点（`"npPaused" // ①(NP-4)`）被 #4 的快照键插入挤散 ⇒ 注释序复原，**214/0**；
  ③ `we-json-tolerance` S1-7b 台账 `index-other-plugin-meta` 条目指向已删的 /ping bs 字段 ⇒ 条目随 #2 退役退场（S3 变异期望集同步），**50/0**；
  ④ `transcode-prescale` C8 第三子句锚定 numFields 的 bsRevealAlpha 尾部 ⇒ 演进为三元组，**39/0**；
  ⑤ `secret-scan` 自指：K3 夹具键 `some-other-wallpaper`（20 字符）撞 `assigned-credential-ext` 的"key + ≥20 引号串"启发式 ⇒ 换 13 字符夹具值，**0 命中**。
  ⑥ integrity `host-workspace-path`：本台账自身的行文含该字面量 ⇒ 改描述性写法。
  ⑦ `bundle-equivalence` payload 变异锚定旧 /ping 应答形状 ⇒ 随 #2 演进为"ok 翻假"（38/0）。
  教训：**改判据锚定的源码段时，先 grep 全部判据里的锚点字符串**（R2 的镜像面）；长跑必须落全量日志（`/tmp/fullgate*.log`）；门禁运行中绝不改 tracked 文件（第 4 次跑撞上我自己的并发编辑 + 第 3 次跑被并发编辑污染，都靠锁与重跑兜住）。
- 第 1 次跑 `| tail -40` 管道把逐段输出截掉，失败步定位靠重跑补齐 —— 长跑必须落全量日志（本次以 `/tmp/fullgate*.log` 留档）。

## 全量门禁（收尾必跑）
`bash tools/check.sh --full` ⇒ 读数见文末追加段落（PASS 12 / FAIL 0 方允许提交）。

## TODO / 下一轮
- 真机目验清单（上）逐条确认；Bug 1 的左右手柄 dx 若与探针不符，以 `mpwFloatHandleSync` 的实测 dx 为准回填判据。
- #7 更新检测真改功能时：/update-check 版本比较、市场只读路径、releaseAt 提示一起梳理。
- 表面质感 A/B/C（挂起，用户未选）；`feat/renderer-embedded` 分支的 2 红门禁 + 全量门禁（挂起，属任务书 B）。

---

# 第二轮：真机回归逐条处置（2026-11-03 晚，分支 feat/ui-copy-and-family-fixes）

> 背景：上一轮未提交改动经软链生效到真机后出现 §2 十二类回归（用户实测，有壁纸才出现）。
> 本轮在复刻 DOM + 无头 Firefox 探针（`~/Desktop/DSHarea/probes/ui-regr-20261103/`）里复现并定位。

## 根因（一条解释八类）

**弹层伪元素选择器列表拼接错误**：上一轮把弹层磨砂迁 `::before` 时写成
`${逗号选择器列表}::before` —— 只有最后一项带伪元素，**前面所有项变成"本体选择器"却继承
伪元素规则体**。产物里该规则体 = `position:absolute !important; inset:0 !important;
z-index:-1 !important`，落在菜单/tooltip 的**本体**上。该块仅在 hasImage（弹层虚化）时
输出 ⇒ 与用户"无壁纸一切正常"的观测完全一致。

| §2 | 现象 | 与根因的对应 | 处置 |
|---|---|---|---|
| 2.7 | 弹框巨大化+点击无效 | `inset:0` 把菜单本体钉满包含块；`z-index:-1` 沉底 | ✅ 同根因 |
| 2.5 | tooltip 拉成长黑竖条 | tooltip 本体被 absolute+inset 钉满、深色底被拉伸 | ✅ 同根因 |
| 2.2 | 子智能体面板/"+"菜单 20px 白条 | 菜单本体被钉进小父级再被宿主 overflow 裁掉 | ✅ 同根因 |
| 2.8 | 三点菜单错位/反馈被切 | 同 2.7（role=menu 家族） | ✅ 同根因 |
| 2.6/2.9 | 悬停发送/上下文占用页面跳动 | tooltip 几何被改 ⇒ 热区反复丢失 | ✅ 同根因 |
| 2.4 | 右栏裁切/滚动失效 | 右栏内 `_menu_`/`_popover_` 族元素本体被 absolute 化 | ✅ 同根因 |
| 2.1 | 左栏磨砂消失（右栏展开恢复） | **未定案**：离线三假设全被证伪（z 序涂色法两态伪元素都在壁纸上方 / 宿主无 sidebarCol 伪位占用 / composer 定位带 relative）。损坏形态引发的布局坍塌是最大嫌疑；真机复验 | ⏳ 真机 |
| 2.3/2.11 | 打开设置整屏左移 | 设置界面内弹层族被 absolute 化 ⇒ 布局坍缩 + frame 过渡动画；无壁纸时该块不输出（与"无壁纸仅偶发"一致） | ⏳ 真机（高置信） |
| 2.10 | 对照组功能正常 | 会话统计/Token 用量等面板不在损坏家族的命中面 | ✅ 无需改 |

修复：`lib/client.js` 弹层伪元素规则改为 `popTipSel/popSurfaceSel.split(",").map(...逐项追加...)`。
判据：`tools/popover-glass-test` 新增 **J1/J2**（产物文本级：凡 content:"" 规则的每个逗号项
都以 :before/::after 结尾；捕获上限 30000 字符覆盖 POP_NOT 巨型选择器——桩环境的 matches()
判不出这种损坏，必须文本级断言）+ **J-MUT** 变异（把损坏形态注回 ⇒ J1 必红）。读数 **36/0**。

## 探针方法与限制（诚实边界）
- 无头 Firefox **截图不合成 backdrop-filter**（最小用例证实：CSS.supports=true 但视觉不糊）
  ⇒ 磨砂**可见性**无法离线判定；几何/层叠/计算值可以。
- 复刻探针读数（修复后）：jobs 菜单 rect 500×80（内容自适应，不再巨大）、fixed 菜单
  position:fixed + 本体 none + ::before blur ✓、tooltip 79×26 fixed ✓、侧栏伪元素
  blur(30px)/absolute/z:-1 ✓、涂色法两树序伪元素均在壁纸上方 ✓。

## 分门禁读数（第二轮修复后）
popover-glass **36/0**（含 J 组）· plus-menu-frost 10/0 · np-media **117/0** ·
np-control 106/0 · wallpaper-lifecycle **214/0** · preset 57/0 · settings-persist 112/0 ·
bs-scan 42/0 · bs-tab 52/0 · tip-no-layout-shift 13/0 · update-fake 8/0 ·
bs-compat-removed 7/0 · we-json-tolerance 50/0 · transcode-prescale 39/0 ·
glow-fixed-safety 26/0 · token-namespace ✓ · css-matrix ✓ · style-scope-guard 0 RED ·
panel-smoke 5/5 · market-topbar 9/0 · sidebar-frost-team-panel 17/0 · fog-model 93/0

## 全量门禁（交付）
`bash tools/check.sh --full` ⇒ **PASS 12 / FAIL 0**（真跑 12 步，1101.7s，峰值 ≈1993 MiB，
指纹 01870b1ed70c，日志 /tmp/branch-fullgate.log）。

## 真机待验清单（刷新页面即可生效）
1. §2.7 弹框（工作区/Agent 预设/权限/模型/VSCode）恢复为内容尺寸、可点击
2. §2.5 tooltip 恢复小气泡（复制/好的回答/收起侧边栏等）
3. §2.2 子智能体面板与"+"菜单恢复正常展开
4. §2.8 三点菜单两项完整显示
5. §2.6/2.9 悬停发送/上下文占用不再跳动
6. §2.4 右栏滚动恢复
7. §2.1 左栏磨砂恢复（**若仍消失**：请跑 `docs/UI-TASKS-BACKLOG.md` 探针 #3 的祖先链
   Console 片段，读 sidebarCol 的 computed backdropFilter 与 ::before）
8. §2.3 打开壁纸设置不再整屏左移
9. A1 新文案（DSH壁纸引擎/主题与配色/说明段链接）与 #4 光晕亮度颜色两行

# STYLE-SCOPE-GUARD —— 「我们注入的 CSS 只准命中自己的标记」自动护栏

> 对应门禁：`tools/check.sh` 第 12 步（`node tools/style-scope-guard.mjs`，全量模式）。
> 判据产物：`tools/probe-out/style-scope.json`（`.gitignore` 已忽略）。
> 该护栏的由来是两次真实事故：**右侧轮次导航条被弄透明**（`TIMELINE-RAIL-TOKEN.md`）与
> **顶栏下描边被抹掉**（`HEADER-FROST.md` §0b）。两次都不是"某一行写错"，而是**选择器作用域没人管**。

---

## 1. 判据（四类，逐条会给 `lib/client.js:<行号>`）

| 分类 | 含义 | 处理 |
|---|---|---|
| **OK** | 选择器命中我们自己的标记：`.mpw*` / `[data-mpw*]` / `#mpw-*` / `[data-plugin="dsh-mpkg-wallpaper"]` | 放行 |
| **ALLOWLISTED** | 命中**已登记**的宿主/第三方作用域（§2 账本，每条带 reason + `docs/*.md:行号` 指针） | 放行 |
| **REVIEW** | 未登记、判不了（新宿主类名 / 新作用域 / 未登记的宿主 token） | **判红**：必须先登记 |
| **RED** | 明确违规（见 §3） | 判红 |

判红的硬规则（`ALLOWLIST` 洗不白）：

1. **裸元素 / 裸 `*` / 无锚点**：`button{…}`、`div{…}`、`*{…}`，或整条选择器既没有我们的标记、也没有已登记的宿主作用域
   （例：`[class*="_dhs-unknown"]{…}`）⇒ RED。元素选择器（`button`/`header`/`svg`…）与通用类名子串
   （`card`/`row`/`panel`/`fade`…）**只能作为已锚定选择器里的细化**，裸出现即红。
2. **`:root` 上出现非 `--mpw-*` 声明** ⇒ RED（宿主 token 定义在 `body` 上，从 `:root` 覆盖属于越界改宿主主题）。
   裸 `html`/`body` 只允许 `background*` 与§4 登记表里的宿主 token，其它属性（含未登记 token）⇒ RED。
3. **宿主 token**：
   * 把宿主 token 设成 `transparent`/`inherit`/`unset`/`none`/空 ⇒ RED（这是"整块界面变透明/失色"的机制）。
     唯一白名单：`--dsw-specific-sidebar-fill` 落在文档点名的**侧栏白名单容器**上（`TIMELINE-RAIL-TOKEN.md:63`）。
   * 覆盖 rail 依赖的 `--dsw-alias-border-l4` / `--dsw-alias-label-primary`：必须门控在 `[data-mpw*]` 上且值非 degenerate ⇒ 否则 RED。
   * 对**未登记**的宿主 token 加 `!important` ⇒ RED。
4. **禁止锚点**：
   * rail 家族（`.eGxaPq_*` / `.Y0dWHa_*` / `qBU-ya` / `_1p9O6q_` / `turn-rail`）：只有两处白名单——
     `body[data-mpw-rail-ink]` 下的对比补偿（**不得含 `!important`、不得引用/重定义任何 `--dsw-*`**）、
     `data-mpw-traject-clip` 门控下**仅几何属性**（`overflow*`/`max-width`/`box-sizing`…）的裁剪 ⇒ 其余一律 RED。
   * 会话区容器（`[data-slot*="session"]` 等）：历史事故是把对话流整条 `display:none` ⇒ 只有带我们自有门控
     （`[data-mpw*]`，例：`body[data-mpw-aqua-text] [data-slot*="conversation"] …` 的文字可读性补偿）才放行，未门控一律 RED。
   * `[data-dsh-panel-host]`（宿主 fixed 全屏层）⇒ RED（文档明确"不要碰"）。
5. **顶栏描边**：选择器命中 `wSkVaW_header` / `_header_` 且写 `border*: …transparent !important` ⇒ RED。

---

## 2. 允许清单账本（`ALLOWLIST`，35 条）

`docKind=existing` = 仓内既有文档本来就写了这件事；`docKind=ledger` = 既有文档没写，**在本表首次登记**（理由是代码注释里的功能语义 + 该作用域在真机 DOM 契约里的位置）。

| id | 层 | 作用域 | 理由 | 依据 |
|---|---|---|---|---|
| `ours:class` | anchor | `.mpw*` | 插件自有 UI 类名（面板控件 / 壁纸层 / 磨砂层） | 本表 |
| `ours:data-mpw` | anchor | `[data-mpw*]` | 插件自有状态标记（门控用；宿主永不带 `data-mpw-*`） | 本表 |
| `ours:id` | anchor | `#mpw-*` | 插件自有 id（`#mpw-bgWrap` 等） | 本表 |
| `ours:data-plugin` | anchor | `[data-plugin=…]` | 插件注入的 `<style>`/节点标记 | 本表 |
| `root:html-body` | anchor | `html` / `body` | 根背景透明化才能看到壁纸层（声明受 §1.2 限制） | `BGWRAP-VISIBILITY.md:20`（existing） |
| `host:wSkVaW` | anchor | `.wSkVaW_*` | 宿主顶栏/输入区类家族：磨砂层、描边回归都锚在它上面 | `HEADER-FROST.md:34`（existing） |
| `host:pI_x6G` | anchor | `.pI_x6G_*` | 宿主框架/左栏/右栏面板：无源恢复不透明 + sidebar-fill 白名单容器 | `BGWRAP-VISIBILITY.md:20`（existing） |
| `host:hHd-Xa` | anchor | `.hHd-Xa_*` | 宿主左栏根/新建会话/区域（`.hHd-Xa_root` 是白名单容器） | `TIMELINE-RAIL-TOKEN.md:63`（existing） |
| `host:ydkMvW` | anchor | `.ydkMvW_*` | 宿主内容根/正文容器：无源不透明恢复锚点 | `BGWRAP-VISIBILITY.md:25`（existing） |
| `host:VOzbGW` | refine | `.VOzbGW_*` | 宿主左栏导航列表：只用于给我们自己的 `.mpw_navIconImg` 让位（同一条里必带我们的标记） | 本表 |
| `host:dark-theme` | anchor | `[data-ds-dark-theme]` | 宿主暗色主题标记：亮/暗两套补偿值必须由此门控 | 本表 |
| `host:better-sidebar` | anchor | `[data-dsh-*]` | better-sidebar 稳定属性锚点（类名前缀 0.16→0.19 换过一次） | `BETTER-SIDEBAR-COMPAT.md:204`（existing） |
| `host:bs-panel-host` | anchor | `[data-dsh-panel-host]` | 登记只为让违规信息指得到文档；真实判定走 §3（禁止加背景/模糊） | `BETTER-SIDEBAR-COMPAT.md:196`（existing） |
| `host:dockkit` | anchor | `[data-dockkit-*]` / `[data-sidebar-right-*]` / `[data-rightbar-fullscreen]` | 宿主右栏/dockkit 浮层：透出/磨砂/悬浮只打这些容器 | `BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md:37`（existing） |
| `host:slot` | anchor | `[data-slot=…]` | 宿主 slot 标记（sidebar/workspaces/composer） | `TIMELINE-RAIL-TOKEN.md:63`（existing） |
| `host:composer-card` | anchor | `[data-composer-card]` | 宿主输入卡片：发送键配色 / 输入区磨砂作用域 | 本表 |
| `host:cordis-panel` | anchor | `[data-cordis-panel]` | 宿主插件面板容器（我们的设置面板挂在这里）：面板底色不能跟着壁纸透 | 本表 |
| `host:data-plugin-any` | refine | `[data-plugin]` | 宿主插件槽位标记：只作为 `[data-slot="sidebar"]` 下的细化 | 本表 |
| `host:think-variant` | anchor | `[data-variant="think"]` | 宿主 Deep-diving 方框变体：`thinkBg` 只改它的底色/文字 | 本表 |
| `host:radix-popper` | anchor | `[data-radix-popper-content-wrapper]` | 宿主浮层定位壳：下拉/菜单都挂在它下面 | 本表 |
| `host:state-attrs` | refine | `[data-dragging]` / `[data-sidebar-collapsed]` / `[data-phase=…]` / `[data-dsh-sidebar-dragging]` | 宿主瞬时状态：只用于**抑制我们自己的规则**（"拖拽时别磨砂"） | 本表 |
| `host:aria-roles` | anchor | `[role="dialog"\|alertdialog\|menu\|listbox\|combobox\|tooltip\|alert\|status"]` | 宿主弹层/菜单/提示的 ARIA 语义角色：弹窗虚化/菜单半透明的唯一稳定锚点（只改背景与模糊，不改布局） | 本表 |
| `host:aria-refine` | refine | `[role="menuitem"\|"option"]` | 只在 `:not(…)` 里排除"菜单项/选项"，避免给交互项误加背景 | 本表 |
| `host:substr-anchor` | anchor | `[class*="_panel"\|"_bottomPanel"\|"_pane"\|"_tabBar"\|"_tabStrip"\|"_editorHeader"\|"_browserBar"\|"_terminal*"\|"_addBar"\|"_addButton"\|"_mask"\|"_overlay*"\|"_modal"\|"_portal"\|"settingsArea"\|"sidebarCol"\|"wSkVaW_header"\|"_header_"]` | 宿主/better-sidebar 类名子串锚点：0.16→0.19 换过前缀，子串匹配是当前唯一可行解 | `BETTER-SIDEBAR-COMPAT.md:207`（existing） |
| `host:substr-component` | anchor | `[class*="P3OORG_panel"\|"QsffPG*"\|"composerSeat"\|"composerStack"\|"newSession"\|"thinkBody"]` | 宿主具体组件 hash 子串：只在这些组件内部细化 | 本表 |
| `host:substr-menu` | anchor | `[class*="_menu*"\|"_dropdown"\|"_popover*"\|"_floatHeader_"\|"_selectMenu"\|"_denseList"\|"_expand"]` | 宿主弹层/菜单/下拉/顶栏展开面板：菜单半透明与"半透明又无模糊"抑制的作用域 | 本表 |
| `host:substr-refine` | refine | `[class*="card"\|"row"\|"button"\|"fade"\|"primary"\|"message"\|"overlay"\|…]` 等通用子串 | 宿主结构通用类名：**只允许**作为已锚定选择器里的后代细化（裸出现即红） | 本表 |
| `host:bs-bottom-resize` | anchor | `[class*="bottomResize"]` | better-sidebar 底部面板的宿主 resize strip（8px 拖拽带）：`bsFloat` 的 14px 圆角外壳会把它上沿切掉，故挪进面板内（`top:-4px` → `0`）；只改位置，不动尺寸/交互 | `BETTER-SIDEBAR-COMPAT.md:332`（existing） |
| `host:substr-radius-compat` | anchor（整条选择器） | `:where([class*="wrap"], [class*="panel"], [class*="box"], [class*="section"], [class*="container"])` | 第三方插件 UI 圆角兼容（`roundCompat`，默认关）：**故意**匹配任意插件容器子串，但零优先级 `:where` + 只写 `border-radius` ⇒ 不覆盖任何既有样式 | 本表 |
| `rail:marks` | anchor（**必须带门控**） | `.eGxaPq_*` / `.Y0dWHa_*` / `.qBU-ya*` | 只在 `body[data-mpw-rail-ink]`（对比补偿）/ `data-mpw-traject-clip`（仅几何裁剪）门控下成立 | `TIMELINE-RAIL-TOKEN.md:181`（existing） |
| `rail:mark-attrs` | anchor（**必须带门控**） | `[class*="qBU-ya"]` / `[class*="_overview"]` | 同上（轨迹总览几何裁剪） | `TIMELINE-RAIL-TOKEN.md:181`（existing） |
| `host:todo-card` | anchor（**必须带门控**） | `[class*="lXshSW_root"]` / `[data-tool="todo_write"]` | 宿主任务列表卡片：`todoBlur` 只打它，门控在 `body[data-mpw-todo-blur]` | 本表 |
| `host:substr-root-refine` | refine | `[class$="_root"]` | 复合写法 `[class$="_root"][class*="qBU-ya"]` 的细化 | 本表 |
| `type:any` | refine | 任意元素选择器 | 只允许作为已锚定选择器里的元素细化（`button`/`header`/`svg`/`img`…） | 本表 |
| `universal:any` | refine | `*` | 只允许作为已锚定宿主作用域下的后代细化（如 `[class*="sidebarCol"] *`） | 本表 |

> `requiresGate` 的含义：该登记项**只在选择器里同时含 `[data-mpw…]` 门控**时才充当锚点；
> 未门控时上面的禁令先判红（rail）或回落成"无锚点"判红。

---

## 3. 宿主 token 覆盖登记表（`TOKEN_POLICY`）

**已登记在案的全局宿主 token 覆盖**（`fontColorGray`「自定义灰字颜色」功能，17 个 token 打在 `body` 上；
这类全局覆盖是 `MASTER-TODO.md` P0-2 的同类风险，登记 ≠ 认可，收窄工作属该条）：

`--dsw-alias-label-secondary` / `-tertiary` / `-caption` / `-dimmed` / `-quaternary` /
`-primary-bluish` / `-primary-dimmed` / `-primary-foreground` / `-inverse` / `-primary-inverted` / `-error`、
`--dsw-alias-line-secondary`、`--dsw-alias-separator-primary`、`--dsw-alias-border-secondary`、
`--dsw-alias-border-l2`、`--dsw-alias-border-l3`、`--dsw-alias-state-warn-label`。

**允许"值 = `transparent !important`"的唯一位置**：`--dsw-specific-sidebar-fill` 落在侧栏白名单容器上
（`.pI_x6G_sidebarCol` / `[class*="sidebarCol"]` / `.hHd-Xa_root` / `[data-slot="sidebar"]`，`TIMELINE-RAIL-TOKEN.md:63`）。

**新增覆盖要怎么做**：先在 `REVIEW` 里看到它 → 判断是否真的必要 → 在 `tools/style-scope-guard.mjs` 的
`TOKEN_POLICY.registeredGlobalTokens` 里登记（并在本表补一行），否则一律红。

---

## 4. 加一条允许清单（步骤）

1. 跑 `node tools/style-scope-guard.mjs --audit`，看 `未登记原子` 与 `非 OK/ALLOWLISTED 选择器`。
2. 判断该作用域是不是**我们本来就要打**的宿主 DOM：
   * 是 → 在 `tools/style-scope-guard.mjs` 的 `ALLOWLIST` 加一条：`id` / `kind` / `tier`（`anchor` 或 `refine`）/
     `match`（正则）/ **`reason`（为什么必须打它、以及约束）** / **`doc`（`docs/*.md:行号`）** / `docKind`。
     若它只在自有门控下才成立，加 `requiresGate: true`。
   * 不是 → 说明这是一条**越界规则**，应该改 `lib/client.js` 让它锚到我们自己的标记上（禁止用允许清单"洗白"）。
3. **必须**在本文件 §2 账本补一行（`doc` 指向本文件时，护栏会校验该行确实含这个 id）。
4. 重跑护栏：`node tools/style-scope-guard.mjs`；指针漂了会直接报 `账本指针校验失败`。

---

## 5. 复现与证据（命令清单）

```sh
cd /root/Desktop/DSHarea/dsh-mpkg-wallpaper
node tools/style-scope-guard.mjs              # 全量：600+ 组设置（按源码 boolFields/numFields 自动枚举，实跑会打印条数；本轮 615） → 一屏表格 + tools/probe-out/style-scope.json
node tools/style-scope-guard.mjs --audit      # 只看未登记原子/未放行选择器
node tools/style-scope-guard.mjs --selftest   # 变异自证（见 §6）
node tools/style-scope-guard.mjs --quick      # 少量组合（调试护栏本身）
bash tools/check.sh                           # 门禁第 11 步就是全量模式
```

产物 JSON 字段：`counts`（四类计数）、`allowlist`（每条登记项 + 命中数 + doc 指针）、
`violations`（每条含 `selector` / `line`（`lib/client.js:行号`）/ `cases`（哪些设置组合命中）/ `reasons`）、
`stats`（规则数 / 唯一选择器数 / 耗时）、`selftest`（`--selftest` 时）。

---

## 6. 自证（有分辨力，且不误杀）

`--selftest` 会把 `lib/client.js` 复制到 `mkdtemp` 临时目录，用**函数改名 + 尾部追加 CSS** 的方式注入变异
（**不动仓库里的 `lib/client.js`**，临时目录在进程退出时删除），再对副本跑一遍护栏，断言：

| 变异 | 期望 | 为什么 |
|---|---|---|
| `button{color:red}` | RED | 裸元素选择器（本护栏的头号目标） |
| `:root{--dsw-alias-bg-base:red}` | RED | `:root` 上覆盖宿主 token |
| `.eGxaPq_mark{border-color:transparent !important}` | RED | 未门控碰宿主轮次导航条 |
| `body{--dsw-alias-label-primary:transparent !important}` | RED | rail 依赖 token 被设成 transparent |
| `*{letter-spacing:.01em}` | RED | 裸通配选择器 |
| `[data-dsh-panel-host]{backdrop-filter:blur(4px)}` | RED | 文档点名"不要碰"的宿主层 |
| `body{--dsw-alias-bg-base:#fff !important}` | RED | 未登记宿主 token + `!important` |
| `.someOtherPlugin_root{opacity:.5}` | RED | 裸的、未登记的第三方作用域（连锚点都没有） |
| `[data-dsh-better-sidebar] .someOtherPlugin_root{opacity:.5}` | REVIEW | 有锚点但含未登记原子 ⇒ 必须先登记 |
| `.mpw-guardProbe{color:red}` | **PASS** | 阴性对照：我们自己的标记必须仍然放行（防"假红"） |
| `.mpw-guardProbeHost{--dsw-alias-bg-base:#fff !important}` | RED | ★未登记的宿主 token 覆盖（§5 第1项："永不覆盖宿主 token"） |
| `.mpw-bgWrap{}.wSkVaW_header{background-color:var(--dsw-static-neutral-bluish-950) !important}` | RED | ★顶栏表面直接消费宿主 token（四表面必须只读共享 `--mpw-*`） |
| `body{padding:0}` | RED | ★登记了 `body` 上的 `--mpw-*` 例外之后，裸 body 的非自定义属性必须仍判红 |
| `body{--dsw-alias-bg-base:red}` | RED | ★同上，`body` 上覆盖宿主 token 必须仍判红 |
| `.mpw-guardProbeHost{--mpw-surface-panel:#123456}` | RED | ★共享表面 token 在 SSOT 之外被二次定义（会退化成"四处各写一套"） |

（共 **15 条**变异；上面的 token 命名空间相关条目里，"登记项必须真的生成"这条由
`--selftest` 之外的单点验证给出：把 `accent` 的门控改回 `aquaOn` 后 `--client <副本> --quick`
报 `token:override-missing-cases`，见 `docs/TOKEN-NAMESPACE.md` §3b。）

---

## 6b. token 命名空间（2026-09-18 增补，MASTER-TODO §5 第 1 项 / P0-3）

除了"选择器作用域"，本护栏现在还判"**自定义属性作用域**"。四类判据 + 唯一的根作用域例外：

1. **宿主 token 覆盖登记表**（`HOST_OVERRIDE_REGISTRY`，6 条）：产物里每一处把 `--dsw-*` 当**属性名**写的
   声明，都必须命中一条登记项（token + 选择器 + 值形态 + `feature()` 生效条件 + reason + docs 指针，
   指针运行时校验）。未命中 ⇒ RED（`token:unregistered-host-override`）。
   当前实测：**39 处声明，39 处命中**。
2. **登记项不许漏进默认档**：`feature(effectivePatch(patch))` 为假的**所有组合**里，该声明必须一次都不出现，
   否则 RED（`token:override-leaked`）。`effectivePatch()` 与 `lib/client.js` 的 lgTest 归一化逐项对齐。
2b. **对称判据（2026-09-18 增补）**：生效条件为真的组合里，该声明**必须真的出现**，否则 RED
   （`token:override-missing` / `token:override-missing-cases`）。只判"漏进默认档"是不够的——
   「整段被别的开关包住 ⇒ 开关能点、没效果、不报错」正是漏检的另一半，`accent` 与
   `aquaTextEnhance` 被 `aquaOn` 吞掉就是这么漏过去的（现已修，见 `docs/TOKEN-NAMESPACE.md` §3）。
3. **四个表面只读共享 `--mpw-*`**（`SURFACES`，见 `docs/TOKEN-NAMESPACE.md` §2）：
   表面**容器本身**的 `background*` / `backdrop-filter` 声明里出现 `var(--dsw-*)` ⇒ RED
   （`token:surface-reads-host`）。口径写明：交互态（`:hover` 等）与容器内的具体控件
   （button/input/icon/badge…）不算"表面底色"——那些是宿主交互色消费。
4. **共享 token 只有一个定义点**，且必须是 `body`（`token:multiple-defs` / `token:surface-not-wired`）。
   四表面各自必须至少引用一枚共享 token（清单显式列出，防"接了线又被摘掉"）。

**唯一的根作用域例外**（`ROOT_POLICY.registeredRootTokenRules`，1 条，id `root:surface-token-ssot`）：
选择器**恰好是 `body`** 且声明**全部**是 `--mpw-*` 时才放行。为什么必须开这个口子：DSH 把
`--dsw-static-*` / `--dsw-alias-*` 定义在 **`body`**（`html` 上没有），而自定义属性里的 `var()` 在
**声明所在元素**上求值 ⇒ SSOT 写 `:root` 会 guaranteed-invalid 并继承给所有后代（消费者全部透明）。
这不是放宽：裸 `body` 上的非自定义属性、`body` 上的 `--dsw-*` 覆盖都仍然判红（§6 表里两条变异盯着）。
详见 [`docs/TOKEN-NAMESPACE.md`](TOKEN-NAMESPACE.md) §1。

配套的第二个工具（第 12 步同时跑）：`node tools/token-namespace-test.mjs` —— 用 `git HEAD` 的
`lib/client.js` 当 before，606 组设置 × 亮/暗 × 默认/门控两态比对四表面**生效值**（极小层叠模型 +
`var()` 递归代换），并自带 3 条变异自证（改 SSOT 取值 / 把 SSOT 挪回 `:root` / 表面换字面量）。

---

## 7. 覆盖边界（如实写明）

* 护栏只看 `__mpwBuildCss()` 的产物（`buildCss` + `buildUiCss`），**不看** JS 内联样式
  （`element.style.*`、`style.cssText`）与 SVG/`document.createElement('style')` 之外的注入路径。
  例：`lib/client.js:1297` 的时钟 `clockEl.style.cssText`、`lib/client.js:4413` 的 token 读取都不在选择器层面。
* 组件组合是**枚举**（默认段 / 每个布尔开关单独开 / 核心 9 开关全 512 组合 / bsCompat 家族 / 数值 0 与 100 /
  无壁纸 / lgTest），不是穷举全集；派生自源码里的 `boolFields`/`numFields` 列表，新增开关会自动进入枚举。
* 需要"真机 computed 值"的判断（例如 rail 条是否真的可见）不属本护栏，见 `tools/frost-rail-test.mjs`
  与 `tools/header-rail-replica.mjs`（第 9 步）。
* 生成产物里有 `//` 行注释被带进 CSS（`lib/client.js` 的 aqua 文字块），浏览器会丢弃这些行——
  本护栏只做注释剥离，不把它算作作用域问题。

# BENCH-PAGE-MAP — `we-scene-demo/demo/` 结构地图（重构用，只读侦察）

> ⚠ **侦察期间 `index.html` 与 `bench-patch.js` 被就地改写过两次**（本文件如实描述**当前**状态，并给出改前/改后差异与已经撞红的门禁）。
> 若你手里是 312 行的 `index.html` / 2886 行的 `bench-patch.js`，那份结构已不存在。

## 0. 版本快照 / 引用别名 / 阅读须知

| 别名 | 路径 | 快照 | 是否稳定 |
|---|---|---|---|
| `idx:` | `we-scene-demo/demo/index.html` | **508 行 / 41 910 B，sha256 `c9e2f567b9c35b6b6301…`**，mtime 09-17 23:09 | 移动中（本地重构目标） |
| `patch:` | `we-scene-demo/demo/bench-patch.js` | **3290 行，sha256 `c3a7ee34068906a571f4…`**（侦察期间 2801 → 2886 → 3270 → 3290，**仍在增长**） | 移动中（本地重构目标） |
| `css:` | `we-scene-demo/demo/assets/bench-HtRiuWm6.css` | 320 行 / 33 329 B，sha256 `3e2bf2f98c33d3cf…`，**未改动** | 稳定 |
| `bundle:` | `we-scene-demo/demo/assets/bench-DSKWIqmS.js` | 210 行，**未改动**（minified，**不可重建**） | 稳定 |
| `gate:` | `$MPW_ROOT/references/vendor-ref/ww-pages/bench-patch.test.mjs` | 1644 行，T1–T31 / 约 323 断言 | 稳定 |
| `demo-check:` | `we-scene-demo/tests/demo-check.mjs` | 247 行，D1–D7 | 稳定 |

**引用纪律**：`gate:` / `demo-check:` / `css:` / `bundle:` 的 `file:line` 是精确且稳定的；`patch:` 的行号是 3290 行快照，**重构时请按锚点（id / 选择器 / 函数名 / 断言文本）定位，不要按行号**。

**前提更正（任务书里两条不成立）**：
1. **`tests/bench-patch.test.mjs` 不存在。** 本页真正的深度门禁是 `gate:`（`vendor-ref/ww-pages/bench-patch.test.mjs`，`import * as P from './wallpaper-engine-webgl/bench-patch.js'`，gate:16；那两个目录名都是软链 → `we-scene-demo/demo`；
①P-127 起规范挂载点是 `WEwebLoader/`，旧名软链**有意保留**（门禁仍按旧名读，两边同一 inode）。
2. **`tests/` 里只有 `demo-check.mjs` 针对本页**（demo-check:133 / :237 读 `demo/index.html`）。任务书点名的其它测试全部指向**另一个页面** `we-scene-demo/demo.html`（409 KB）：`tests/log-panel-collapse-test.mjs:14`（它测的是 `#log/#logbar/#logarrow` + `mpw-log-h`，与本页 `#logs/#toggle-logs` 无关）、`props-panel-test.mjs:65`、`baseline-test.mjs:39`、`data-limits-test.mjs:31`、`diag-flag-check.mjs:108`、`mdla-walk-test.mjs:139`、`text-font-fallback-test.mjs:55`、`bind-order-test.mjs:277`。`tests/fullscreen-recenter-test.mjs` 是渲染器 fullscreen **效果层**，与本页全屏按钮无关。

### 0.1 这次改写已经撞红的门禁（**已实测，不是推测**）

我按门禁里的正则逐条对当前 `index.html` 跑了一遍，结果如下（PASS/FAIL 为实测）：

| 门禁断言 | 位置 | 现状 | 原因 |
|---|---|---|---|
| `#credit-link` 精确标签（attr 顺序固定） | gate:1147-1148、T20 gate:778 | **FAIL** | `id="credit-link"` 已被删除（`idx` 0 命中） |
| `#credit-title` | T20 gate:778、T31 gate:1640 | **FAIL** | 已删除 |
| 归属 id 计数各 =1（`credit-title`/`credit-link`/`*-footer`） | T31 gate:1633-1634、demo-check D7 :240-242 | **FAIL** | 前两个计数为 0 |
| `id="bench-online-notice"` + `在线演示版` + `Online demo` | T28 gate:1235、demo-check D5 :137-138 | **FAIL** | 静态横幅整块被删（`bundle`/`patch` 只在 `demoEnv.online` 为真时才**运行期创建**它，patch `paintOnlineNotice`） |
| `#credit-link` 相对标签 | demo-check D5 :139-141 | **FAIL** | 同上 |
| `#bench-legacy-anchors` 及 4 个空节点逐字节 | T20 gate:763-766 | PASS | 已随 `#site-header` 迁移，标记未变 |
| `#ico-logs-up` / `#ico-logs-down` / `#toggle-logs aria-expanded="true"` | T10 gate:252-254 | PASS | 原样保留（`idx:253-255`） |
| `<option value="1000" … data-i18n="fps.uncapped">`、`<label id="lab-dpr">DPR`、`<label id="lab-fps"…>FPS` | T21 gate:797-800 | PASS | 原样 |
| `#pick-lib`/`#pick-file` + `data-i18n-title` 唯一 | T29-C gate:1390-1393、T31 gate:1632、D7 :239 | PASS | 原样 |
| `<base href="./" />` + `./assets/bench-DSKWIqmS.js` + `./bench-patch.js` | T28 gate:1231-1233、D5 :134-136 | PASS | 原样 |
| `class="stage-tools"` / `#fs-enter` / `#fs-exit` | T11 gate:265 | PASS | 原样 |
| `offline-tag` / `bench-rd-btn` / `trail-canvas` / `data-i18n="status.dpr"` | T8 gate:167 | PASS | 原样 |
| 两份 LICENSE 文件链接 | demo-check D5 :141-143、T20 gate:782 | PASS | 已迁到 `#settings-pop .pop-credit`（`idx:72`） |
| LABEL_SPEC ⊆ index.html ∪ dynamicIds | T18 gate:594 | PASS | 改写时**同步**把 `#credit-title`/`#credit-link` 从 LABEL_SPEC 删了，只剩 `*-footer`（patch:2990-2991） |

**结论**：这次改写的"归属/在线横幅"部分把 T20/T27/T28/T31 + demo-check D5/D7 一共 6 处断言撞红。要恢复绿色，最小改动是**把 `#credit-title`/`#credit-link` 这对 id 和 `#bench-online-notice` 区块重新放回 DOM**（形状必须与 gate 的正则逐字一致），或者同步修改上述 6 处门禁以外的所有引用点（不推荐：T27 还要求 `references/vendor-ref/webwallgl/index.html` 三处一致）。

---

## 1. DOM inventory（按新外壳区域；`R`=读，`W`=写）

### 1.1 产物（bundle）必需 id —— 缺一即整页死

`bundle` 在模块顶层用 `document.querySelector` 取 **60 个 id**（`bundle:209` 一段 + `bundle:210` 尾部），并对其中大多数直接 `X.onclick=` / `X.textContent=`；id 缺失 ⇒ 模块求值抛 TypeError ⇒ 主题/列表/工具条/日志全部失效（`idx:36-43` 是上一版对此的实测记录，**新外壳已把这条注释删掉，但约束没变**）。

```
#list #filter #type-filter #libpath #lib-count #current #frame #empty #logbody #workspace #main
#logs #toggle-logs #pick-lib #open-pkg #pkg-file #fit #dpr #fps #volume #live-system #pointer-push
#pointer-veil #resolution #stage-frame #stage-scale #stage #stage-badge #status-lib #status-count
#status-item #status-res #status-dpr #status-fps #status-live-fps #toggle-props #fx #props #props-body
#props-state #props-filter #props-all #lang #act-docs #docs-view #editor-chrome #app-version #sponsor-btn
#docs-body #stage-slot #theme-toggle #act-explorer #sidebar #clear-logs #pause #release #reload #open
#props-close #props-reset
```

当前 `idx` 里 **60/60 全部存在**（`#act-docs`/`#act-explorer` 已从活动栏移进 `#bench-legacy-anchors`，`idx:82-83`，仍满足"存在"要求，但**不再可见**）。

### 1.2 新外壳区域表

| 区域 | id | 是什么 | R | W | 契约 / 门禁 |
|---|---|---|---|---|---|
| 错误条 | `#bench-errorbar` `#bench-error-title` `#bench-error-msg` `#bench-error-note` `#bench-error-close` | 全局兜底条，默认 `hidden`（`idx:22-27`） | — | patch `showError` | T16（gate:384-386 默认 hidden、:613 出错可见且 msg 相符）；T18 文案（gate:589, :600）；LABEL_SPEC patch:2588-2590 附近的 `#bench-error-*` 条目 |
| 站点头 | `#site-header`（`idx:28-85`，**新增**） | 44px 顶栏（新样式 patch:1828） | — | — | **无门禁**（CSS 只在 `SITE_LAYOUT_CSS` 里） |
| | `#site-brand` `.brand-dot` `.brand-name` `#app-version` `#offline-tag` | 品牌 + 版本 + 离线徽标 | — | `bundle` 写 `#app-version`；patch `paintDiag` 写 `#offline-tag` | T8（gate:167 `offline-tag` 子串）；LABEL_SPEC `#offline-tag` |
| | ↑ ⑧(2026-09-18 品牌改名) **品牌名是运行期覆盖的**：patch `applySiteBrandNow()` 把 `.brand-name`（选择器 `[data-i18n="app.title"]`）与 `document.title` 写成产品现名 **WEwebLoader**，版本号 `#app-version` 不碰；`?appname=upstream` / `?brand=upstream` 还原上游名 `wallpaper-engine-webgl`。静态 `<title>`/DICT/minified 产物**不动**（分别是 gate T8 / T1 / 许可口径的钉子） | — | gate **T5b**（纯函数 + 假 DOM 冷启动 + 语言切换后重放） |
| | `#site-tabs` `#tab-console` `#tab-docs` `#tab-wpset` `#site-tab-ink` | **新三页 tablist**（`idx:36-41`） | patch `initSiteShell` | patch `setPage`/`paintInk` | **无门禁**；`#tab-*` 在 patch 里按 `'#tab-'+name` 拼（patch:1035） |
| | `#site-actions` `#settings-btn` `#settings-pop` `#theme-state` `#backend-state` `.pop-credit` | 设置弹层 + 主题/后端状态（`idx:43-75`） | patch `popOpen`/`paintStatus` | patch | **无门禁** |
| | `#lang` | 语言下拉，**从标题栏移进设置弹层**（`idx:61-64`） | `bundle` `ye.onchange`、patch `change` | — | 硬 id 列表（T18 gate:527-533, :591-593）；`data-i18n-title="lang.title"` 在 `label` 上（`idx:59`） |
| | `#theme-toggle` + 3 个 `.ic` SVG | 主题三态按钮（`idx:45-57`，现挂在 `#site-actions` 下） | 见 §2 | `bundle` 主控 + patch 兜底 | T19（gate:674-681, :700-701） |
| | `#bench-legacy-anchors`（`idx:77-84`） | **兼容锚点**，`hidden aria-hidden="true"`；含 `#open-pkg` `#pkg-file` `#type-filter` `#sponsor-btn` **+ 新增两个空按钮 `#act-docs` `#act-explorer`** | — | patch 摘处理器 | T20 逐字节（gate:763-766，四个老节点标记未变）；**注意**：把 `#act-docs`/`#act-explorer` 塞进 `hidden` 容器 ⇒ 产物 `O('docs')`/`O('explorer')` 从此**无法被用户触发**（见 §4） |
| 页轨道 | `#pages-track` `#page-console` `#page-docs` `#page-wpset` `.page` | **新三页滑动轨道**（`idx:87-88, :271, :381`）；切页 = `#pages-track.style.transform = translateX(-100*i%)`（patch:1057, patch:1850-1851） | patch | patch | **无门禁**；`.page{flex:0 0 100%}` 让三页并排、`overflow:hidden` 裁切 |
| 侧栏 | `#sidebar`（`idx:90`，`grid-column:1`） | 壁纸库 | `bundle` | `bundle` | 新样式 patch:1856 覆盖为 `width:auto!important` |
| | `#lib-count` `#pick-lib` `#pick-file` `#clear-local` `#libpath` `#bench-backend-note` `#filter` `#list` `#bench-local` | 同上一版语义 | 见 §7 | 见 §7 | `#pick-lib`/`#pick-file` 唯一性 T29-C/T31/D7；`#bench-backend-note` 可见性 T23（gate:925-926）；`#filter` title T23（gate:927-929） |
| 参数栏 | `#props`（`idx:107`，**已从 `#workspace` 移到 `#workbench`**） | 壁纸参数列，新样式让它**常驻**（patch:1857-1858 覆盖 `#props[hidden]{display:flex!important}`） | `bundle` `ue()` | `bundle` + patch `paintPropsEmpty` | 见 §9 |
| | `#props-state` `#props-filter` `#props-all` `#props-body` `#props-reset` `#props-close` `#props-empty` | 同上一版 + 新增 `#props-empty`（patch 运行期创建，patch:1171-1183） | — | `bundle`/patch | T18（gate:543）、T14（gate:334-336） |
| 右侧主列 | `#main`（`idx:125`，`grid-column:3`） | 4 行网格：`#editor-chrome` / `#workspace` / `#logs-splitter` / `#logs`（新样式 patch:1861-1867） | `bundle` 切 `hidden` | — | **CSS 文本契约**：`#main > #editor-chrome{grid-row:1}` 等仍写在 `BENCH_PICK_CSS`（patch:1804-1807）；但新样式用 `!important` 重排（patch:1861-1867）⇒ `.bench-view-docs` 那条（无 `!important`）**已失效** |
| | `#editor-chrome` `#wp-switch` `#editor-tabs` `#current` `#wp-add` `#toolbar` | 切换栏 + 工具条（`idx:126-133`） | — | `bundle` 写 `#current`；patch `refreshSwitcher` 写 tab 与 `#wp-add` | `#current`（gate:888 清空后回 `未选择壁纸`）；T4 字面量 |
| | `#resolution` `#bench-rd-btn` `#bench-rd-list` `#fit` `#dpr` `#lab-dpr` `#fps` `#lab-fps` `#volume` `#live-system` `#pointer-push` `#trail-box` `#trail-on` `#trail-len` `#trail-w` `#trail-color` `#pause` `#reload` `#release` `#open` `#toggle-props` `#fx` | 工具条全部控件（`idx:133-219`） | 见 §8 | 见 §8 | 硬 id 列表 T18；T21；T23 |
| 舞台 | `#stage-slot` `#stage-frame` `#stage-scale` `#stage` `#frame` `#empty` `#pointer-veil` `#trail-canvas` `.stage-tools` `#fs-enter` `#fs-exit` `#stage-badge` | 同上一版（`idx:222-244`） | — | `bundle` `he()`；patch 全屏与尾迹 | §6 |
| 文档视图 | `#docs-view` `#docs-body` `#bench-readme` | **仍在 DOM 但已不可达**（`idx:245-247`） | `bundle` `qe()` | `bundle` 清空重建；patch `injectReadme` 前插 | 无门禁；`#sponsor-card`/`#credit-title`/`#credit-link` **已从此处删除**（见 §0.1 红表） |
| 日志 | `#logs-splitter`（`idx:250`，**新增**） | 拖动分隔条，`role="separator"` | patch | patch `setLogsHeight` | **无门禁** |
| | `#logs` `#toggle-logs` `#ico-logs-up` `#ico-logs-down` `#clear-logs` `#copy-logs` `#diag-offline` `#logbody` | 控制台（`idx:251-265`） | `bundle` | `bundle` + patch | §5 |
| 状态栏 | `#statusbar` 及 8 个 `#status-*`（`idx:494-504`） | 底部状态栏，**仍是 body 直接子元素** | `bundle` | `bundle` + patch 二次覆盖 | T18/T21（见 §8） |
| 静态文档 | `#page-docs`（`idx:271-378`）、`#page-wpset`（`idx:381-491`） | **新增**：双语静态说明页（`.doc-wrap.lang-zh` / `.doc-wrap.lang-en`），语言靠 `html[lang]` 切换（patch:1901-1902） | — | — | **无门禁**；表格是裸 `<table>`，样式来自 `.doc-wrap table`（patch:1889-1890） |

---

## 2. Layout & CSS

**三份样式，按注入顺序（后者胜）**：

| # | 来源 | 内容 | 位置 |
|---|---|---|---|
| 1 | `<link rel="stylesheet" href="./assets/bench-HtRiuWm6.css">`（`idx:18`） | 产物压缩 CSS（`css:1`，17 695 字符 / 176 条规则）+ 补丁追加段（`css:2-320`） | 静态 |
| 2 | `<style id="bench-pick-style">` | `BENCH_PICK_CSS`：目录选择器全部样式 + 4 条老布局钉桩 | patch:1765-1808；注入 patch:1809-1819 |
| 3 | `<style id="bench-site-style">` | `SITE_LAYOUT_CSS`：**新外壳全部样式**（顶栏 / 三页轨道 / 三列工作台 / 切换栏 / 控制台拖高 / 全屏按钮配色 / 文档排版 / reduced-motion） | patch:1825-1904；注入 patch:1905-1914 |

### 2.1 层级归属（现状）

| 容器 | 规则 | 谁写的 |
|---|---|---|
| `body` | 产物 `body{display:grid;grid-template-rows:35px minmax(0,1fr) 22px}`（`css:1@1018`）被 patch:1827 **覆盖**为 `display:flex!important;flex-direction:column;grid-template-rows:none!important` | patch(3) 胜 |
| `#site-header` | `flex:none;height:44px;display:flex;align-items:center;gap:14px;background:var(--titlebar);z-index:30`（patch:1828） | patch(3) |
| `#pages-track` | `flex:1;display:flex;min-height:0;overflow:hidden;transition:transform .28s`（patch:1850）；`.page{flex:0 0 100%;display:flex;flex-direction:column;overflow:hidden}`（patch:1851）；`#page-docs,#page-wpset{overflow-y:auto}`（patch:1852） | patch(3) |
| `#workbench` | 产物 `#workbench{display:grid;grid-template-columns:48px auto minmax(0,1fr)}`（`css:1@1788`）被 patch:1854 **覆盖**为 `flex:1;grid-template-columns:var(--mpw-lib-w,300px) auto minmax(0,1fr)!important`；`#activitybar{display:none!important}`（patch:1855，元素已不存在）；`#sidebar{grid-column:1;width:auto!important;resize:none!important}`（patch:1856）；`#props{grid-column:2;width:var(--mpw-props-w,320px)}`（patch:1857）；`#main{grid-column:3}` | patch(3) |
| `#main` | patch:1861 `grid-template-rows:auto minmax(0,1fr) 6px var(--mpw-logs-h,220px)!important`；`#main.logs-collapsed{… 6px 34px!important}`（patch:1862）；`#editor-chrome{grid-row:1}` `#workspace{grid-row:2}` `#logs-splitter{grid-row:3}` `#logs{grid-row:4}`（patch:1863-1867） | patch(3) 覆盖产物+patch(2) |
| `#workspace` | 产物 `#workspace{display:grid;grid-template-columns:minmax(0,1fr)}`、`#workspace.props-open{grid-template-columns:minmax(0,1fr) 360px}`（`css:1`）—— **`#props` 已移出，这条 `props-open` 规则现在只会在 `#workspace` 里留空 360px 列**（`.props-open` 仍由产物 `ue()` 切换） | 产物 |
| `#stage-slot`/`#stage-frame`/`#stage-scale`/`#stage` | 未改：`#stage-frame{flex:1;display:grid;place-items:center;position:relative;padding:16px;container-type:size}`（`css:1@7281`）⇒ `cqi/cqb` 单尺寸源；`.stage-tools`/`#stage-badge` 的定位祖先 | 产物 |
| `#logs` | 产物 `#logs{display:flex;flex-direction:column;border-top:1px solid var(--border)}`（`css:1@12216`）+ 折叠隐藏清单 `#main.logs-collapsed …{display:none}`（`css:1@12677`，**不含 `#copy-logs`**） | 产物 |
| `#statusbar` | 产物 `#statusbar{display:flex;align-items:center;gap:12px;padding:0 10px}`（`css:1@13101`）；现在是 flex 列的第 4 个子元素 | 产物 |

### 2.2 主题

- **机制不变**：`:root` 变量（`css:1@0`）+ `html[data-theme=light]` 覆盖（产物在 `css:1@15886`，补丁重复一份在 `css:95-128`）；**属性必须在 `<html>` 上**，值只有 `light` 有规则（`dark` == 默认）。没有 `body.dark`、没有 `prefers-color-scheme` 媒体查询。
- `#theme-toggle`：三态 `auto→dark→light→auto`；**主控是产物**（`bundle:209` `ae.onclick` → 写 `localStorage['webwallgl-theme']` → `document.documentElement.dataset.theme` → `themeBtn.dataset.mode` → `title` → 按 `.ic-<mode>` 显隐）；patch `ensureThemeFallback()`（patch:1338 区）只在 `<html>` 无 `data-theme` 时接管。
- 新外壳把主题状态**镜像**到 `#theme-state`：patch `paintStatus()`（patch:1099-1106）读 `#theme-toggle.dataset.mode` 写 `t('theme.'+mode)`，并用 `MutationObserver` 盯 `data-mode`（patch:1107-1110）。
- 新样式里主题相关的新规则：`#site-header{background:var(--titlebar)}`、`#settings-pop{background:var(--panel)}`、`.pop-credit a{color:var(--link,…)}`、`.doc-wrap code{background:color-mix(in srgb,var(--fg) 10%,transparent)}`、`.stage-tools button{background:color-mix(in srgb,var(--panel) 86%,transparent)}`。

---

## 3. i18n

机制与上一版**完全一致**，只有键集与 `tr()` 入口扩展：

| 机制 | 位置 | 说明 |
|---|---|---|
| 静态属性 | `data-i18n`→textContent、`data-i18n-ph`→placeholder、`data-i18n-title`→title | 两套实现：产物 `He()`（`bundle:2`，用**烘死**词典）+ patch `applyStaticI18n`（patch:182） |
| 补丁词典 | `export const DICT`（patch:39，单行）+ `LANGS`（patch:42）+ `t()`（patch:45） | 机械生成自 `references/vendor-ref/webwallgl/bench/i18n.ts`；gate T1 零漂移（gate:24-45） |
| **新键（本次改写新增）** | `nav.console/nav.docs/nav.wpset/nav.settings/nav.settingsTip/nav.lang/nav.theme/nav.backend/nav.backendUnknown/nav.backendNote`、`wp.add`、`wp.addTitle`、`logs.expandTip`、`logs.collapseTip`、`props.emptyState`、`props.emptyHint` | 全部在 `patch:39` 的 zh/en 两侧 | ⚠ `act.docs`（原 `#act-docs` 的 title 键）现在**没有任何宿主节点**（`#act-docs` 已无 `data-i18n-title`）——T1 只比对 DICT↔i18n.ts，所以不会红；但它已成孤儿键 |
| 反向翻译 | `buildValueIndex` patch:59 / `translateRendered` patch:92 / `collectSlots` patch:134 / `sweepRendered` patch:158 / `hasResidualLang` patch:116 | 同上一版 |
| `#lang` 切换 | 产物 `ye.onchange` → 写 `webwallgl-lang` + 设 `<html lang>`；patch `change` 监听 → `applyLang(next)`（patch:2943 区） | 顺序硬要求：① `sweepRendered` → ② `applyStaticI18n`+`applyTitle`+各 repaint → ③ `syncAllLabels` → ④ 文档/本地库/横幅 |
| 新外壳里的语言 | `initSiteShell(ctx)` 用注入的 `ctx.t`（patch:1026 `tr`）与 `ctx.lang`；`#page-docs`/`#page-wpset` 的双语**不用词典**，靠 `html[lang="en"] .lang-zh{display:none}` / `html:not([lang="en"]) .lang-en{display:none}`（patch:1901-1902） | — |
| `LABEL_SPEC` / `syncAllLabels` | patch:2964 区 / patch:2995 区 | 本次改写的净变化：**删掉** `['#credit-title',…]`/`['#credit-link',…]`，保留 `['#credit-title-footer','text','credit.title']`/`['#credit-link-footer','text','credit.link']`（patch:2990-2991）⇒ T31 的"两条 `*-footer` 在 LABEL_SPEC 里逐字节"（gate:1633-1638）仍 PASS，T18 containment（gate:594）也 PASS |

**新增 UI 文案的规则（未变）**：① 键必须同时进 `DICT.zh`/`DICT.en` **和** `references/vendor-ref/webwallgl/bench/i18n.ts`（否则 T1 红，gate:38-45）；② 静态节点里 `data-i18n*` 必须写在 **`id` 之后**（gate:538 的采集正则），否则 T18 假 DOM 拿不到该标签；③ **产物词典没有的键绝不能挂 `data-i18n`** —— 产物每次切语言都会把它写成键名原文；`credit.*` 就是为此才走 LABEL_SPEC（gate:1151 `!/data-i18n="credit\./`）。

---

## 4. Views / tabs today（**这一块已被重写，务必看**）

### 4.1 两条并存的"视图"链路

| 链路 | 归属 | 现状 |
|---|---|---|
| **旧：产物 `O(view)`**（`bundle:209`） | `#act-docs`→`O('docs')`、`#act-explorer`/`#current`→`O('explorer')`、`#sponsor-btn`→`O('docs')`+滚到 `#sponsor-card` | **已不可达**：`#act-docs`/`#act-explorer`/`#sponsor-btn` 全在 `#bench-legacy-anchors`（`hidden`）里；`#sponsor-card` 已删除。`O()` 仍会切 `#sidebar/#logs/#editor-chrome/#docs-view/#stage-slot` 的 `hidden`，但没人能触发 ⇒ `#docs-view` 永久 `hidden`，`mainViewPlan().docsOnly` 永不成立 |
| **新：patch `initSiteShell()`**（patch:1025-1269） | `#tab-console/#tab-docs/#tab-wpset` → `setPage('console'\|'docs'\|'wpset')` → `#pages-track.style.transform=translateX(-100i%)` + `.active`/`aria-selected` + `#site-tab-ink` 滑块（patch:1046-1066, patch:1069-1081 还支持 ←/→ 键） | 生效；持久化键 **`bench-site-page`**（patch:1031），缺省 `console` |

### 4.2 `#docs-body` 的内容来源（与上一版不同了）

- 产物那份**仍在**：`qe(el,lang)`（`bundle:209`）清空 `#docs-body` 后从内嵌数据集 `jt`（`bundle:2`）重建 —— 但 `#docs-view` 不可达，所以看不到。
- **现在用户看到的"说明"是静态 HTML**：`#page-docs`（`idx:271-378`，`h1/h2/p/table/ol/ul`，中英两份 `.doc-wrap`），内容自写，**不经词典**。`#page-wpset`（`idx:381-491`）是一张"WE 自带选项 ↔ 本页 API"对照表。
- patch 的 `injectReadme()`（patch:1500 区）+ `#bench-readme` 仍然对 `#docs-body` 生效（`#act-docs` 的 click 监听仍在 patch:1517 绑定），但同样不可见。

### 4.3 归属块：**已被删除** —— "删除渲染核心归属块及其以下" 的实际后果

改写前该块是 `#docs-view` 内的 `#sponsor-card`（含 `#credit-title`/`#credit-link`），页脚另有 `#bench-credit`（含 `*-footer`）。**现在**：

| 对象 | 现状 | 影响 |
|---|---|---|
| `#sponsor-card` / `#credit-title` / `#credit-link` | **已从 DOM 删除** | **6 处门禁红**（见 §0.1）：gate:1147-1148（T27，三入口逐字）、gate:778（T20）、gate:1640+gate:1633-1634（T31 计数/精确标签）、demo-check:139-141（D5）、demo-check:240-242（D7） |
| `#bench-credit`（页脚条） | **已删除**；`#credit-title-footer` / `#credit-link-footer` + 许可句**迁到** `#settings-pop .pop-credit`（`idx:69-73`），`← 返回项目落地页` 链接**消失** | `*-footer` 相关门禁 PASS；`.bench-credit` 那套 class 样式（`css:304-320`）只剩 `.bench-credit-license` 仍匹配（写在 `idx:72`） |
| `#bench-online-notice` | **已删除静态块**；patch 仍会在 `demoEnv.online` 为真时**运行期创建**并插到 `#statusbar` 之前（patch `paintOnlineNotice`） | **T28（gate:1235）+ D5（demo-check:137-138）红**；本机 `:8901`/`:8899` 下 `demoEnv.online===false` ⇒ 即使运行期也 `hidden` |
| 两份 LICENSE 文件 + 链接 | 文件在；链接在 `idx:72` + `#page-docs`/`#page-wpset` 正文（`idx:320`、`idx:374`） | D5（demo-check:141-143）、T20（gate:782）PASS |

**恢复绿色的最小改法**：把 `<strong id="credit-title" …>` + `<a id="credit-link" href="https://github.com/oneincase/webwallgl" target="_blank" rel="noopener noreferrer">`（**attr 顺序不能变**）与 `id="bench-online-notice"`（含 `在线演示版` / `Online demo` / `api/*` 字面量）放回 DOM —— 可以藏在 `#bench-legacy-anchors` 或 `#settings-pop` 里，门禁只做**同页存在性 + 逐字**检查。另需把 `#credit-title`/`#credit-link` 重新登记进 `LABEL_SPEC`（否则它们不会随语言切换；T18 只查"登记项必须存在"，不查"存在项必须登记"）。

---

## 5. Logs / diagnostics

### 5.1 数据流（端点）

| 通道 | 谁 | 端点 | 现状 |
|---|---|---|---|
| 诊断流 | `bundle` `new EventSource("/api/diag-stream")`（`bundle:210`，`Jt()`），`onerror` 写 `err.diagStream` | `/api/diag-stream`（SSE） | **两个服务器都没有这个路由**（`server/we-scene-demo-server.mjs` 只有 `/diag` GET/POST 自检报告，**无任何 `/api/*`**）⇒ 必然 404 |
| 诊断探活 | patch `fetchAbortable('/api/diag-stream',{Accept:'text/event-stream'})`（patch:2558 区）→ `diagOfflineState(status)` | 同上 | 404/0 ⇒ offline |
| 后端探活 | patch `probeStatus('/api/library',…)`（patch:2579 区）→ `apiStatus` | `/api/library` | 404 ⇒ `backendMode()==='static'` |
| **`/api/log`** | — | **不存在**（全仓 0 命中；"输出"面板全部是**客户端本地**日志） | — |
| 其它后端 | `bundle`：`/api/library-dir`、`/api/props?item=`、`/api/props-dir`、`/api/props-file`、`/api/delete`、`/api/reveal` | — | 静态托管下全 404 |

行写入者：`bundle` 的 `b()`（`bundle:210`，`<span class="err?">HH:MM:SS  msg\n`）与 patch 的 `logLine()`（patch:1608 区，`<div class="err?">`），都 append 到 `#logbody` 并滚底。`#clear-logs` **只由产物绑定**（`l("#clear-logs").onclick=()=>{X.textContent=""}`，`bundle:210`）。

### 5.2 折叠状态机 + 新的"拖高"

| 机制 | 谁 | 细节 |
|---|---|---|
| 产物折叠 | `pt(collapsed)`（`bundle:210`） | `#logs.classList.toggle('collapsed')`（**该 class 在 CSS 里没有规则**）+ `#main.classList.toggle('logs-collapsed')` + `Q.textContent = collapsed?'▸':'▾'` + `Q.title` + `Q.setAttribute('aria-expanded', …)` + `localStorage['we-bench-logs-collapsed']`；启动时若为 `'1'` 则 `pt(true)`。`Q.onclick` 按 `#logs.classList.contains('collapsed')` 翻转 |
| **新增拖高** | patch `#logs-splitter` + `setLogsHeight()`（patch:1201-1211） | 写 `#main.style.setProperty('--mpw-logs-h', v+'px')` → 被 `#main{grid-template-rows:auto minmax(0,1fr) 6px var(--mpw-logs-h,220px)!important}`（patch:1861）消费；`clampLogsHeight(px, innerHeight, 80, 0.72)`（patch:1015-1022），`<24px ⇒ 0`；持久化键 **`bench-logs-h`**（patch:1032，值 `collapsed` 或像素数）；双击 `#logs-splitter` 复位 220（patch:1247）；同时给 `#logs` 加 `.bench-logs-collapsed-tag` 并调 `paintLogsArrow()`（patch:1207-1209） |
| 新箭头逻辑 | patch `paintLogsArrow(collapsed)`（patch:1214-1224） | 折叠 ⇒ 显示 `#ico-logs-up`；展开 ⇒ 显示 `#ico-logs-down`；并写 `#toggle-logs.dataset.tag`（由 `#logs.bench-logs-collapsed-tag #toggle-logs::after{content:attr(data-tag)}` 渲染成"展开/收起"文字，patch:1879-1880）。重画时机：`setLogsHeight` + `MutationObserver(#main,[class])`（patch:1249-1255） |

### 5.3 "折叠后显示右箭头"的确切来源（用户报的问题）

- **没有旋转、没有 transform、没有第三个图标**：`css` 里 `rotate` 0 命中、`#ico-logs-up`/`#ico-logs-down` **没有任何 CSS 规则**（全靠 `[hidden]{display:none!important}`，`css:1@940`）。
- 真凶是产物的 `Q.textContent = collapsed ? '▸' : '▾'`（`bundle:210`）：写 `textContent` 会**删掉 `#toggle-logs` 的全部子节点**（`idx:254-255` 的两个 SVG），换成单个文本节点 `▸`（右三角）/`▾`（下三角）。所以折叠后那个"右箭头"就是产物写的 `▸`。
- patch 的 `paintLogsArrow()` 只在**节点已脱离 DOM 之后**改它们的 `hidden` 属性 ⇒ 对字形是**空操作**；新加的 `::after{content:attr(data-tag)}`（patch:1880）只在 `#logs.bench-logs-collapsed-tag` 时出现文字，**展开态没有任何可见文字**，折叠态也只是补一个"展开"标签，**不会把 `▸` 变回 `▲`**。
- 修法（任一）：① 在 patch 里挂 capture 阶段 `click` 或对 `#toggle-logs` 挂 `MutationObserver`，在产物写完 `textContent` 后改写为 `▴`(折叠)/`▾`(展开)——`▴` 与同仓 `demo.html` 的既有口径一致（`tests/log-panel-collapse-test.mjs:79`）；② 每次 `pt()` 之后重新注入两个 SVG。**约束**：`#ico-logs-up`/`#ico-logs-down`/`#toggle-logs aria-expanded="true"` 的静态标记（gate:252-254）与补丁那行 `if (open) { downIco.removeAttribute('hidden'); upIco.setAttribute('hidden', '') }`（gate:257-258）都不能删改。顺带：`#logs.collapsed` 是**死 class**，真正生效的是 `#main.logs-collapsed`（老规则 `css:1@12677`）+ 新 `!important` 规则（patch:1862）。

---

## 6. Fullscreen

- DOM：`#stage-slot` 内的 `#stage-frame` 内的 `.stage-tools`（absolute）含 `#fs-enter`（常驻）+ `#fs-exit`（默认 `display:none`，仅 `:fullscreen` 显示）——`idx:222-244`，与上一版相同。
- API（全在 patch）：`fsSupported = !!stageSlot.requestFullscreen`；不支持 ⇒ `fsEnter.disabled=true` + `title=t('fs.unsupported')`；进入 `Promise.resolve(stageSlot.requestFullscreen()).catch(...)`；退出 `if (doc.fullscreenElement) doc.exitFullscreen()`；`fullscreenchange` → `paintFs()` 重写两个按钮文案并 `dispatchEvent(new Event('resize'))`（patch:1410 区）。
- **产物侧 CSS（未改动，`css:139-159`）**：`#stage-slot:fullscreen{background:var(--editor)}`、`#stage-slot:fullscreen #stage-frame{padding:0}`、`#stage-slot:fullscreen #stage-scale{box-shadow:none;max-width:100vw;max-height:100vh}`、`.stage-tools{position:absolute;right:10px;top:10px;z-index:7}`、`.stage-tools button{…background:rgba(24,24,24,.78);color:var(--fg,#ccc);…}`（`css:151-152`）、`.stage-tools button:hover{background:var(--accent,#0078d4);color:#fff}`（`css:156`）、`#fs-exit{display:none}`、`#stage-slot:fullscreen #fs-exit{display:inline-flex;align-items:center}`、`#stage-slot:fullscreen .stage-tools{right:14px;top:14px}`。**`#fs-enter` 自己没有规则**（只吃 `.stage-tools button`）。
- **"浅色下看不清（黑）"的根因**：`css:151` 把背景**硬编码**为深色半透明 `rgba(24,24,24,.78)`，而 `css:152` 取主题变量 `var(--fg,#ccc)`；浅色下 `--fg=#3b3b3b`（`css:97`/`css:1@15886`）⇒ 深字压深底，对比度约 1.4:1；唯一可读状态是 `:hover`（`css:156` 同时换底色与字色）。**新样式已修**：`SITE_LAYOUT_CSS` 里 `.stage-tools button{color:var(--fg)!important;background:color-mix(in srgb,var(--panel) 86%,transparent);border:1px solid var(--border);…}` + `:hover{background:var(--accent)!important;color:#fff!important}`（patch:1882-1883）—— 若你要重排这段，注意它靠 `!important` 压产物规则，且 `#fs-exit` 必须仍是 `#stage-slot` 的后代（gate:266-267 在 CSS 文本上匹配 `#stage-slot:fullscreen #fs-exit{display:inline-flex`，**当前 PASS**）。

---

## 7. 壁纸切换（含**已实现的**横向切换栏 + ＋）

### 7.1 数据来源

| 来源 | 数据 | 载体 |
|---|---|---|
| 本机后端 | `GET /api/library` → items `{itemId,title,type,hasScene,preview,properties,file}` | 产物数组 `ne`（`bundle:209`）；patch 只缓存 `hostLibrary()` |
| 纯前端扫描 | `localItems`（patch 闭包；元素 `{dir,id,title,kind,pkg,proj,preview,properties}`，由 `loadLocalEntries()` 生成） | 渲染进 `#bench-local`（patch 运行期创建，插在 `#list` 之后） |
| 合成样例 | `samples/sample-synthetic/scene.pkg` | `loadDefaultSample()`（patch:3124 区），`HOST_BLOCKED_HERE‖online` 时 1200 ms 后自动载入 |

### 7.2 选择 / 应用路径（**新切换栏走的是产物 `#list` 的 DOM 桥**）

| 动作 | 实现 |
|---|---|
| 产物选壁纸 | `Ue(item)`（`bundle:210`，`li.onclick`）：`w=item → 状态栏 → 重建 #list → Ae() 挂载 → O('explorer') → 若参数面板开着则 yt(itemId)` |
| **挂载到舞台** | `Ae()`（`bundle:210`）：拼查询串（`type/src/fit/renderDpr/sceneFps/filter/muted/loop/mediaBase/liveSystem`）→ 写 `#current`、`#empty`、`#frame.on`、`#frame.src=/wallpaper-engine-webgl/renderer/index.html?…`（minified 产物里的**旧站点路径**，不可重建）、复位暂停、记 `log.mount`。patch 包了 `HTMLIFrameElement.prototype.src` 的 setter 做前缀改写（patch 的 P-93 段；①P-127 起**旧名与新名两个前缀都认**，线上改写为相对本页） |
| 本地项 | patch `previewLocal(it)`（patch:1565 区）→ `ensureRendererFrame(#frame)` → `__wp.loadSceneFile(it.pkg)` → `onWallpaperOpened(id)` |
| **新切换栏读数据** | `listItems()`（patch:1119-1127）：扫 `#list li[data-id]`，取 `{id, title: li.querySelector('.title').textContent, active: li.classList.contains('active'), el: li}` ⇒ **完全依赖产物渲染出的 `li[data-id]` + `.title` + `.active` 三个 DOM 契约** |
| **新切换栏渲染** | `switcherPlan(items, currentId, 12)`（纯函数，patch:1001-1012：当前项置前、按库序、去重、上限 12）→ `refreshSwitcher()`（patch:1128-1147）重建 `.wp-tab` 按钮，插进 `#editor-tabs`；点击执行 `it.el.click()`（**转交产物 `li.onclick`**，patch:1141） |
| 刷新时机 | `MutationObserver(#list, childList)` + 60 ms 去抖（patch:1148-1154）；语言切换后由 `__benchShellRefresh`（patch:3187-3189）重跑 |
| **＋按钮** | `#wp-add`（`idx:131`）→ patch:1156-1163：`setPage('console')` + 清空 `#filter` 并派发 `input` + `#list.scrollTop=0` + 给非当前项加 `.wp-cur` + 把第一张非当前项 `scrollIntoView` |
| 清空 | patch `clearLocalLibrary()`（patch:1581 区） |

**持久化**：产物 9 个键（`webwallgl-lang/theme/fx`、`we-bench-logs-collapsed/library-dir/resolution/type-filter/view/pointer-push`）+ 新外壳 2 个键（`bench-site-page`、`bench-logs-h`）。**"当前壁纸"仍然不持久化**。

**做新切换条要注意**：`.wp-tab` 的 `.active` 来自 `switcherPlan`（比对 `currentId`，而 `currentId` 只在 `listItems()` 里从 `.active` 反推）⇒ 若你改 `#list li` 的结构（去掉 `data-id` / `.title` / `.active`），切换栏会**静默变空**（`refreshSwitcher` 返回 `{tabs:0}`）。另外 `#wp-add` 只是"引导用户去左边点"，**不是**"直接切下一张"；`window.__benchPatch.switcher()`（patch:3275）可拿到 `{plan,items}` 做断言。

---

## 8. 工具条（用户口中的"设置1"）

| id | 控件 | 行为 | 持久化 | 门禁 |
|---|---|---|---|---|
| `#resolution` | select 15 项 | 产物 `H.onchange`：写 key + `he()`（`fit` ⇒ 去 `#workspace.fixed-res`、清 inline 尺寸、`#stage-badge` 隐藏、`#status-res=status.adaptive`；否则加 `.fixed-res`、算 `s`、写 `#stage` 宽高+`transform:scale`、`#stage-scale` 缩放盒、`#stage-badge='W × H · n%'`、`#status-res='W × H'`）；另有 `ResizeObserver` 盯 `#stage-frame` | `we-bench-resolution` | 硬 id 列表 T18（gate:527-533, :591-593） |
| `#bench-rd-btn` / `#bench-rd-list` | 自绘下拉触发器/弹层（`idx:136-137`） | patch `bindDropdown` **复用静态节点**，点选项写 `sel.value` 并派发 `change` | — | T9（gate:231-246）；`max-height:280px`（gate:170） |
| `#fit` | cover/contain/stretch | 产物 `ge.onchange → __wp.setFit(v)` | 无 | 硬 id 列表 |
| `#dpr` | 1–5 | 产物 `ie.onchange → de()`（状态栏）+ `__wp.setRenderDpr(n)` | 无 | `#lab-dpr` 文本（gate:799-800） |
| `#fps` | 30/60/120/1000 | 产物 `V.onchange → de()+__wp.setSceneFps(n)`；patch `paintFps` 在 `change` 与 `setTimeout(0)` 里**二次覆盖** `#status-fps`（产物 `de()` 硬编码 `status.cap`） | 无 | T21（gate:797-798, :812-818） |
| `#volume` | range | 产物 `be.oninput → __wp.setVolume`；并进挂载串 `muted=(v<=0)` | 无 | 硬 id 列表 |
| `#live-system` | checkbox | 产物 `ve.onchange` → 重挂载 + 日志；进串 `liveSystem=1` | 无 | 硬 id 列表 |
| `#pointer-push` | checkbox | 产物 `R.onchange → vt()`：`#pointer-veil.hidden=!checked`、写 key、日志；遮罩推 `__wp.pushPointer/pushWheel`；patch 另挂 `change→trailGate` | **`we-bench-pointer-push`**（启动回填） | T26（gate:1081 不得给 `#pointer-veil` 加 `draggable`） |
| `#trail-on/#trail-len/#trail-w/#trail-color/#trail-box/#trail-canvas` | patch 独占尾迹 | `trailGate()`：未开注入 ⇒ `#trail-on.disabled`；两者都开 ⇒ 三个输入可用 + 画布显示 + `#trail-box` 去 `data-gated`；绘制 `trailSegments`+`drawTrail`，事件源 `#pointer-veil` pointermove | 无 | T18（gate:533 必须是 INPUT）、T14（gate:334）、T17（gate:562） |
| `#pause` | 按钮 | 产物 `U.onclick`：按 `dataset.i18n` 判态 → `pause()/resume()` 并改写自己的 `dataset.i18n`+文案；重挂载复位 | 无 | T4 字面量 |
| `#reload` | 按钮 | 产物 → `Ae()`（重挂载当前） | 无 | — |
| `#release` | 按钮 | 产物 → `E()?.release()` | 无 | — |
| `#open` | 按钮 | 产物 `window.open('/wallpaper-engine-webgl/renderer/index.html?'+wt(w))` —— 绝对路径。**①P-129 已修**：补丁包 `window.open`（`installOpenRemap`，与 iframe 同口径 —— 同一个前缀真源表 + 只在线上形态改写）⇒ Pages 上打开的是 `…/WEwebLoader/renderer/index.html?…`（`?openrewrite=off` 回退到上游原行为）；`:8901` 仍走旧名软链（守卫只看线上形态）。历史：P-93~P-127 期间 patch **只改写 `#frame.src`**、没包 `window.open` ⇒ 子路径部署下这条绝对路径指到域名根 ⇒ Pages 404（旧路径的重定向页救不了它：重定向页的跳转目标也是相对的） | 无 | T33（gate:1846） |
| `#toggle-props` | 按钮 | 产物 `Qe.onclick`：无当前项 ⇒ `err.selectFirst`；否则切 `#props.hidden`/`#workspace.props-open`/自身 `.checked`（新样式让 `#props` 常驻，`props-open` 已无实际作用）；patch 写后端不可用 title | 无 | T23（gate:928） |
| `#fx` | select 11 项 | 产物 `_.value=getItem('webwallgl-fx')??'none'`；`onchange` 写 key + `__wp.setFilter`；进串 `filter=` | **`webwallgl-fx`** | 硬 id 列表 |
| `#wp-add` | **新** ＋按钮 | 见 §7.2 | 无 | 无 |
| `#toggle-logs` | 折叠按钮 | 见 §5 | `we-bench-logs-collapsed`；新外壳另有 `bench-logs-h` | T10（gate:252-254, :257-258） |

工具条容器 `#toolbar`：`display:flex;flex-wrap:wrap`（`css:1@6093`）—— 唯一的自适应手段。`#editor-chrome` 内现在多了 `#wp-switch`（新样式 patch:1869-1877）。

---

## 9. 壁纸参数面板（`#props`）

- **位置已变**：`#props` 从 `#workspace` 移到 `#workbench`（`idx:107`），新样式让它成为**常驻第 2 列**：`#props{grid-column:2;width:var(--mpw-props-w,320px);border-left/right:1px solid var(--border)}` + `#props[hidden]{display:flex!important}`（patch:1857-1858）⇒ 产物的 `hidden` 不再能隐藏它。
- patch 的空态：`paintPropsEmpty()`（patch:1167-1184）在 `#props-body` 为空时插入 `#props-empty`（`props.emptyState` + `props.emptyHint`），`MutationObserver(#props, childList+subtree+attributes[hidden])` + 60 ms 去抖（patch:1185-1191）。
- 读取：产物 `yt(itemId)`：`GET /api/props?item=<id>` → 属性描述数组 `z` + 当前值 `y`；`#props-state` 显示 `props.reading/none/count/countOverridden/readFail`。
- 渲染：产物 `q()` 按 `#props-filter`（`Ze.value`）与 `#props-all`（`et.checked`）过滤后重建 `#props-body`（分组 `<details class="prop-group">`，类型 bool/range/select/text/file/directory/scenetexture）。
- 写入：控件 → `x(name,value)` → `q()`+`zt()` → **400 ms 去抖** → `kt()`：`POST /api/props?item=<id>`（覆盖表）→ 成功后 `__wp.updateWebProps({name:{value}})` 热更新 + 日志 `props.logSaved`。
- `#props-reset`：把所有非 null 项设为默认值后再 `q(); zt()`（`bundle:210`）。
- patch 两处接管：① 6 个后端专用控件 title（`BACKEND_ONLY_CONTROLS`）；② `#props-body` 内 `input[type=color]` 自绘取色器 + `.prop-pick` 文件/目录按钮（`DataTransfer` 塞回产物隐藏 input 并派发 `change`）。
- 门禁：T14（gate:334-336）、T18（gate:543）。`#workspace.props-open{…360px}` 现在只会在 `#workspace` 里**留一条空列**（`#props` 已不在其中）—— 这是当前最明显的布局残留。

---

## 10. 重构风险清单

### 10.1 当前**已经红**的（改回去或改门禁，二选一；详见 §0.1）

| # | 项 | 抓住它的测试 |
|---|---|---|
| R1 | `#credit-title` / `#credit-link` 被删 | gate:778（T20）、gate:1147-1148（T27）、gate:1640 + gate:1633-1634（T31）、demo-check:139-141（D5）、demo-check:240-242（D7） |
| R2 | `#bench-online-notice` 静态块被删（缺 `在线演示版`/`Online demo`/`api/*` 字面量） | gate:1235（T28）、demo-check:137-138（D5） |
| R3 | 回归风险：`#sponsor-card` 删除本身**安全**（产物用 `?.`），但它是 `#credit-title`/`#credit-link` 的宿主 ⇒ 恢复 R1 时要么放回原处，要么另找宿主并**同步改 LABEL_SPEC** | — |

### 10.2 结构性风险（Top 15）

| # | 风险 | 抓住它的测试 |
|---|---|---|
| 1 | 删/改 60 个产物必需 id 中任意一个 ⇒ 模块求值抛 TypeError ⇒ 整页逻辑死（`#act-docs`/`#act-explorer` 现在"仅存在于 hidden 容器"就是踩线状态：**只保证存在、不保证可用**） | T18 冷启动 no-throw（gate:585）、T22/T23/T26/T30 真 `init()` 段 |
| 2 | `#toggle-logs` / `#ico-logs-up` / `#ico-logs-down` 的起始标签被改（属性顺序、空格） | T10（gate:252-254） |
| 3 | 补丁那行 `if (open) { downIco.removeAttribute('hidden'); upIco.setAttribute('hidden', '') }` 被删/改格式 | T10（gate:257-258） |
| 4 | `#main` 的三个老子元素不再是**直接子元素**或顺序变了（现在多了 `#logs-splitter`，靠 `grid-row` 钉桩才没乱） | T29-D（gate:1411-1413） |
| 5 | `#credit-link` 标签属性顺序（`href` 必须紧跟 `id`） | T27（gate:1148）、D5（demo-check:140） |
| 6 | `#credit-title` 的 `<strong id="credit-title" style="color:inherit">` 形状 | T31（gate:1640）、T20（gate:778） |
| 7 | LABEL_SPEC 里登记的 id 在 HTML 里消失（或反之） | T18 `labelIds ⊆ index.html ∪ dynamicIds`（gate:594） |
| 8 | `data-i18n` 被挪到 `id` **之前**，或 id 挪到外层包裹元素 | T18 采集正则（gate:538）→ 后续标签/零残留断言（gate:585-600） |
| 9 | 动 `#bench-legacy-anchors` 的四个老节点（`#open-pkg`/`#pkg-file`/`#type-filter`/`#sponsor-btn`）标记 | T20 逐字节（gate:763-766） |
| 10 | `#pick-lib`/`#pick-file` 数量或 `data-i18n-title` 键变了 | T29-C（gate:1390-1393）、T31（gate:1632）、D7（demo-check:239） |
| 11 | `#fs-exit` 不再是 `#stage-slot` 后代 / `.stage-tools` 被挪出 `#stage-frame`（丢定位祖先） | T11 CSS 文本契约（gate:266-267） |
| 12 | `#list li` 结构变化（丢 `data-id`/`.title`/`.active`）⇒ **新切换栏静默变空** | 无门禁（自检入口 `__benchPatch.switcher()`，patch:3275） |
| 13 | `.bench-kind` 数量/顺序（本地列表恰好 2 个且 join==`scene,web`） | T22（gate:874-877） |
| 14 | 6 个 `<select>`（`#lang/#resolution/#fit/#dpr/#fps/#fx`）不再是 select / 丢 options / 不再被 `bindDropdown` 接管；`#lab-dpr`/`#lab-fps` 文本变形；`#fps` 的 1000 选项变形 | T18（gate:527-533, :591-593）、T21（gate:797-800） |
| 15 | 资产哈希文件名 / `<base href="./" />` / 相对 `src` 被改 | T19 404 审计（gate:704-746）、T8/T12/T24、D5（demo-check:134-136） |
| 附 | 重命名 `applyLang/syncAllLabels/trailGate/setTrailAttached/drawTrail/sizeCanvas`、`previewLocal/logLine/dirPaintRows`；改掉被当作切片锚点的中文注释（`// ── 第五批 ①~④`、`// ── ③ 语言切换`、`独立的中止槽`、`第六批（**P-96 在线 demo**`） | T17（gate:556-562）、T29-B（gate:1359-1384）、T26（gate:1130-1132）、T23（gate:920）、T28（gate:1271） |
| 附 | `#main.bench-view-docs` 机制被新样式 `!important` 压掉（patch:1861 vs patch:1807）—— 若还想用它，需要给 `.bench-view-docs` 也加 `!important` 或让新样式包含该分支 | T29-D 只查 CSS/JS 文本（gate:1413-1415），不会发现行为失效 |

### 10.3 必须逐字保留的 id（新增/变化部分已标注）

```
#list #filter #libpath #lib-count #pick-lib #pick-file #clear-local #current
#editor-chrome #editor-tabs #toolbar #resolution #bench-rd-btn #bench-rd-list #fit #dpr #lab-dpr
#fps #lab-fps #volume #live-system #pointer-push #trail-on #trail-len #trail-w #trail-color #trail-box
#trail-canvas #pause #reload #release #open #toggle-props #fx #workspace #stage-slot #stage-frame
#stage-scale #stage #stage-badge #frame #empty #pointer-veil #fs-enter #fs-exit #props #props-body
#props-state #props-filter #props-all #props-reset #props-close #docs-view #docs-body #act-docs(*) #act-explorer(*)
#theme-toggle #lang #app-version #offline-tag #bench-errorbar #bench-error-title #bench-error-msg
#bench-error-note #bench-error-close #logs #logbody #toggle-logs #ico-logs-up #ico-logs-down
#clear-logs #copy-logs #diag-offline #main #sidebar #statusbar #status-lib #status-count #status-item
#status-res #status-dpr #status-fps #status-live-fps #bench-backend-note
#bench-legacy-anchors #open-pkg #pkg-file #type-filter #sponsor-btn
#credit-title(†) #credit-link(†) #credit-title-footer #credit-link-footer #bench-online-notice(†)
#sponsor-card(‡)
```
`*` = 必须存在但当前被放在 `hidden` 容器里（产物需要它们；语义已废）；`†` = **当前缺失，必须补回**（否则 §0.1 的 6 处红）；`‡` = 可删（产物用 `?.`），但它原是 `†` 的宿主。

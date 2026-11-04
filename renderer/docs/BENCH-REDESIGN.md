# 测试台页面改造（新样式）· 设计说明与微调指引

> **这一篇是干什么的**：2026-09-17 用户给了新样式稿（工作区 `docs/newstyle.md` 的 ASCII 图）与 9 条细则，
> 我在**本机静态页**（http://127.0.0.1:8901/wallpaper-engine-webgl/ ，真源 `demo/`）落地了第一版，
> 目的是让用户先"看着真实页面微调"，**微调确认后再同步到在线 Pages**（本轮没有动 Pages 产物）。
> 逐条证据 / 复现命令都在下面；页面结构地图见 `docs/BENCH-PAGE-MAP.md`。

---

## 1. 新布局（与 `docs/newstyle.md` 逐块对应）

```
┌ site header（#site-header，44px）───────────────────────────────────────────────┐
│ ● wallpaper-engine-webgl v… 离线 │ 控制台 │ 说明 │ 壁纸设置 │      设置 ▾  ☀/🌙 │
├ 三页滑动轨道（#pages-track，宽 300% = 3 × 视口，只 transform 平移）─────────────┤
│ 页①控制台（#page-console）：                                                    │
│   ┌ 选择壁纸(#sidebar 300px) ┬ 壁纸参数(#props 320px) ┬ 右列(#main 余下)──────┐ │
│   │ 壁纸库 / 选择文件夹 /   │ 当前壁纸 project.json  │ ④壁纸切换栏 + ＋        │ │
│   │ 选择文件 / 清空 / 过滤  │ 的可调项（空态提示）    │ ───────────────────── │ │
│   │                        │                        │ 设置1（分辨率 fit DPR  │ │
│   │                        │                        │ FPS 音量 实况 指针注入 │ │
│   │                        │                        │ 尾迹 暂停/重挂/释放 …）│ │
│   │                        │                        │ ───────────────────── │ │
│   │                        │                        │ 壁纸（stage + 全屏）    │ │
│   │                        │                        │ ══ 可拖动分隔条 ══      │ │
│   │                        │                        │ 控制台（输出/诊断流）   │ │
│   └────────────────────────┴────────────────────────┴────────────────────────┘ │
│ 页②说明（#page-docs）：自写 README（中/英，随语言切换）                          │
│ 页③壁纸设置（#page-wpset）：WE 自带选项 ↔ 本页 API 对照表（30 行）                │
├ #statusbar（保留）──────────────────────────────────────────────────────────────┤
```

* 切页 = `#pages-track` 的 `translateX(-(100/3)·i %)`，0.28s 缓动（**⑨ tab 切换动画**）；
  动画结束后把非当前页 `visibility:hidden`（否则控制台页里那个 iframe 会盖在其它页上）。
* 回退开关：`?shell=off` —— 不注入新样式 CSS、不初始化外壳（回到改造前行为）。

## 2. 用户 9 条细则的落地位置

| # | 要求 | 落地 | 状态 / 证据 |
| --- | --- | --- | --- |
| ① | tab 栏第 1 项 = 现在的控制台页面 | `#tab-console` → `#page-console`（含三列工作台）；默认页 | 截图 `/tmp/pg-console.png` |
| ② | 第 2 页 = README 页，且**不是**原作者的文档 | `#page-docs`：**自写**中/英说明（界面怎么读 / 三步开始 / 切换栏 / 壁纸设置页 / 在线版会少什么 / 许可与归属） | 原 `#docs-view`（产物渲染的原作者 README）在外壳模式下强制 `hidden`；产物源码与上游许可文件仍随页分发 |
| ③ | 第 3 页 = 壁纸设置（WE 自带参数 ↔ 对应 API） | `#page-wpset`：4 张表 30 行 —— ①WE 自带选项（翻转/对齐缩放/播放速度/颜色选项总开关/亮度对比度饱和度色调偏移/音量/对动作反应=不做/录音=WE 自带）②壁纸自身 `project.json → general.properties` ③运行参数 ④控制台示例代码；每行标 `已实现 / 需实现 / WE 自带 / 不做` | 截图 `/tmp/pg-wpset.png`；WE 侧名称取自本机 `wallpaper_engine/locale/ui_zh-chs.json` 的 `ui_browse_properties_*` |
| ④ | 设置1 上方加壁纸切换栏 + 跟随当前项的加号；＋进入"选另一张" | `#wp-switch` 包住 `#editor-tabs`；`.wp-tab` 由补丁扫 `#list li[data-id]` 生成（当前项在前），点击转交产物自己的 `li.onclick`；`#wp-add` **插在当前 tab 右边**；点 ＋ = 回控制台页 + 清过滤 + 列表滚到第一张非当前项 | 探针实测 `addNext: "current"`；`switcherPlan()` 纯函数可测 |
| ⑤ | 删掉渲染核心原作者卡片与其下全部（含"返回项目落地页"） | 删除 `#docs-view > #sponsor-card`（渲染核心原作者卡片）与页脚两块 `#bench-online-notice` / `#bench-credit`（含 `← 返回项目落地页`） | `demo-check` D5/D7 已按新位置改判（旧 id 计数必须为 0）；**最小归属保留**：设置弹层里一行 `渲染核心原作者 WebWallGL · oneincase（MIT）` + 两份 MIT 许可文件链接（MIT 要求随副本保留声明） |
| ⑥ | 渲染器诊断页 = 8899 页底部那块日志 | 控制台 = `#logs`（产物既有的输出 + `/diag` 诊断流），新增**可拖动上沿**（`#logs-splitter`，双击复位，高度记 localStorage）与折叠态文字标签，手感与 8899 `demo.html` 的日志条一致 | 探针实测拖动 220→346px；折叠 220→34px |
| ⑦ | 输出按钮：收起后箭头应朝上（原来显示向右的 ▸） | 真因：产物 minified `pt()` 用 `textContent = collapsed ? '▸' : '▾'` 覆盖按钮内容（把我们的两个 svg 删掉）⇒ 收起时是**朝右**三角。补丁按状态统一改写：收起 `▴` / 展开 `▾`，并给按钮加 `data-tag`（收起时旁边显示"展开"） | 探针：`initial ▾ / after-collapse ▴ + title "Expand the output" / after-expand ▾` |
| ⑧ | 浅色模式下全屏按钮看不见（黑底黑字，只有 hover 变蓝） | `.stage-tools button{color:var(--fg)!important;background:color-mix(in srgb,var(--panel) 86%,transparent);border:1px solid var(--border)}` + hover 品牌色 | 探针 computed：浅色 `color rgb(59,59,59)` on `srgb(0.95…/0.86)`；深色 `rgb(204,204,204)` on `srgb(0.094…/0.86)` |
| ⑨ | site header 的 tab 左右切换要有动画 | 见 §1（track transform + ink 下划线同步滑动 + `prefers-reduced-motion` 时关闭） | 探针：`--tab-docs` → `matrix(1,0,0,1,-1440,0)`；`--tab-wpset` → `-2880`；`--tab-console` → `0` |

## 3. 过程中挖出并修掉的两个**真 bug**（都不是新样式本身引入的）

1. **`paintMainView` 自激 MutationObserver 死循环**（补丁既有代码）：观察者同时盯 `#main`（写入目标）与它的输入节点，
   `paintMainView()` 又去改 `#main` 的 class ⇒ 每次写入重新触发自己；当 `docsOnly` 判定来回翻转时（新布局里 `#main`
   有 4 个子元素、0px 轨道的映射不同），循环以微任务速度跑满主线程 —— **页面 load 永不完成**（无头探针 45s 超时）。
   证据：instrument 后 `MutationObserver on DIV#main.bench-view-docs attr=class` 6 秒内被调用 **10000+ 次**。
   修法：写入幂等（状态没变不碰 DOM）+ **不观察写入目标**（只看 `#editor-chrome/#workspace/#logs`）+ 外壳模式下本机制整体让位。
2. **滑动轨道的裁剪窗口跟着轨道一起被移出屏幕**：轨道只有一页宽时，`translateX(-100%·i)` 会把
   `overflow:hidden`/`contain:paint` 的裁剪框一起移走 ⇒ 第 2/3 页整页被裁掉（真机表现：切到「说明/壁纸设置」只看到空白；
   截图与原文件字节数完全相同 = 没画出任何东西）。修法：轨道 `width:300%`、每页 `flex:0 0 33.3333%`、
   平移量 `-(100/3)·i %`（`sitePagePlan()` 里写清了为什么）。

## 4. 怎么微调（给用户/下一个 agent）

* **改文案**：页②③的正文就是 `demo/index.html` 里的静态 HTML（`.doc-wrap.lang-zh` / `.doc-wrap.lang-en` 两块），直接改字符串即可（不用碰 JS）。
* **改布局/配色**：都在 `demo/bench-patch.js` 的 `SITE_LAYOUT_CSS`（一个字符串数组，按注释分段：外壳 / 轨道 / 三列 / 切换栏 / 全屏按钮 / 文档排版）。
* **改列宽**：`--mpw-lib-w`（选择壁纸，默认 300px）、`--mpw-props-w`（壁纸参数，默认 320px）、`--mpw-logs-h`（控制台高度，默认 220px，拖动会写 localStorage）。
* **改标签文字**：新 UI 的字符串在两个词典里（`demo/bench-patch.js` 的 `DICT` 与参考检出 `references/vendor-ref/webwallgl/bench/i18n.ts`）——
  两者**必须逐键相等**，否则门禁 `bench-patch.test.mjs` 的 T1 变红。键名：`nav.*` / `wp.add*` / `logs.expandTip` / `logs.collapseTip` / `props.emptyState` / `props.emptyHint`。
* **回退**：URL 加 `?shell=off`；或 `git checkout -- demo/index.html demo/bench-patch.js`。

## 5. 验证与门禁（本轮实测）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 测试台深度门禁（T1–T31） | `cd references/vendor-ref/ww-pages && node bench-patch.test.mjs` | **355 通过 / 0 失败**（本次按新设计改判了 T20/T27/T28/T31 的归属与横幅断言；新增"新外壳在位"一条） |
| 发布形态门禁 | `cd we-scene-demo && node tests/demo-check.mjs` | **32 通过 / 0 失败**（D5/D7 改判：在线说明在「说明」页、归属只剩 `*-footer`） |
| 产物内联脚本语法 | `node tests/demo-syntax-check.mjs` | 8/8 通过 |
| 真机 DOM 探针 | 无头 Firefox 加载 `http://127.0.0.1:8901/wallpaper-engine-webgl/` | 0 page error；三列几何 300/320/820；切页 transform 三态正确；箭头三态正确；拖动 220→346；折叠 220→34；全屏按钮浅/深两套颜色可读 |

> 探针脚本是临时的（`/tmp/site-probe.mjs`、`/tmp/shot3.mjs`、`/tmp/arrow-test.mjs`），未入库；
> 若要长期保留，建议按 `tests/` 的既有风格固化成 `tests/bench-shell-test.mjs`（纯函数 `sitePagePlan` / `switcherPlan` / `clampLogsHeight` 已经 export，可直接单测）。

## 6. 已知缺口 / 待确认（微调时可一起定）

1. **页③里标「需实现」的 4 项还没有真做**：`__wp.setDisplay({flipH})`、`__wp.setPlaybackRate()`、
   `__wp.setDisplay({brightness,contrast,saturation,hue,colorOptions})`（按 DSH 插件的 CSS filter 做法）。
   本轮只把**契约定下来**（键名/查询参数/状态标签），实现排在渲染器侧（属用户第 7 条"把插件里的能力借鉴进渲染器"）。
2. **切换栏数据源**：靠扫产物渲染的 `#list li[data-id]`；本机静态台（无 `/api/library`）里库是空的，所以只有当前壁纸那一个 tab。
   有本机后端或"选择文件夹"扫出壁纸后才会出现多个 tab（`.wp-tab`）。该契约目前**没有门禁覆盖**，改 `#list` 结构会静默变空。
3. **设置弹层**：语言选择从标题栏挪进了「设置」（原 `#lang` 仍在，只是藏起来了）；主题按钮移到头部右侧。
   若希望"语言"直接露在头部，改动点在 `demo/index.html` 的 `#site-actions`。
4. **在线 Pages 未同步**：按用户"先静态页微调、最后再同步"的要求，本轮**没有**跑 `build-pages.mjs`、没有动线上产物。
5. 本机无 GPU：以上都是 DOM/computed 判据；**壁纸实际观感**（颜色/缩放/拖动手感）需用户在有 GPU 的机器上看。

## 7. 真机事故记录：**新 HTML + 旧补丁** 的缓存混合体（2026-09-17 用户报"整个布局完全有问题"）

**现象**（用户原话）：打开 8901 直接是 README、左上角出现"nav 点什么"的按钮、控制台没加载、整页布局错乱。

**根因（两层缓存，都不是布局 bug）**：
1. `python3 -m http.server` **只发 `Last-Modified`、不发 `Cache-Control`** ⇒ 浏览器按启发式新鲜度直接复用 HTTP 缓存里的
   `bench-patch.js`（无内容哈希，218KB 的老版本），**不回来校验**；
2. 产物自带 Service Worker（`demo/sw.js`）对 `*.js` 一律 **cache-first**（把不带哈希的 `bench-patch.js` 也钉住了）。

⇒ 结果：HTML 是新的（导航 network-first，拿到最新），补丁是旧的 —— 旧补丁里没有外壳代码、也没有 `nav.*` 词典键，
于是 ①没有站点 CSS/切页逻辑，布局按产物旧 CSS 渲染成错乱；②`data-i18n="nav.console"` 被产物写成**键名原文**
（用户看到的"nav 点什么"）；③默认落在产物的 docs 视图（README）；④控制台因为 `#main` 轨道规则缺失被挤没。

**修法（已落地）**：
* `demo/sw.js` → `VERSION = webwallgl-bench-v2`（①2026-09-23 第二轮品牌清理：缓存名现为 `wewebloader-bench-v1`，见 `docs/PATCHES.md` P-127.5；下面的 network-first 策略一字未变）；**不带哈希的文件（`bench-patch.js`/`sw.js`/`manifest`/HTML）改 network-first**
  （离线回落缓存），带哈希的 `assets/*.<hash>.js|css` 与 `icons/` 仍 cache-first。浏览器每次导航都会字节校验 `sw.js`，
  所以老客户端**一次硬刷新**之后就会拿到 v2 并从此自愈。
* 本地 :8901 换成 **显式 `Cache-Control: no-store`** 的静态服务器：`references/vendor-ref/ww-pages/serve-8901.mjs`
  （`node serve-8901.mjs 8901`；比 python 版还顺带修了 `.pkg` 的 MIME）。**不再用 `python3 -m http.server` 开这个页面**。

**验证**（持久化 profile，让 SW 与 HTTP 缓存都生效）：
`load#1/load#2 shell=object, page=console, tabs=[Console,Guide,Wallpaper settings], styleTag=true, sw=true`；
改一次 `bench-patch.js` 后 reload：页面**看到了新内容**（`cache-probe marker=true`）—— 修前这正是会失败的那一步。

**教训（写进纪律）**：以后验证页面**不能只用全新 profile 的无头浏览器**（那等于缓存全空），必须至少跑一次
"带持久 profile + SW 已激活"的复查；页面这类"无哈希入口文件"的任何改动，都要先确认 SW/HTTP 缓存策略不会把它钉住。

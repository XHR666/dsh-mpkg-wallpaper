# issue #0924a · A 线（`:8902` 测试台 UI）实现报告

- 仓库：渲染器仓 `we-scene-demo/`（GPL-3.0-or-later；工作区根 = 仓库的上一级）；本报告 = `docs/reports-issue0924a-line-A.md`
- 线别：A 线 = 测试台 UI（`demo/index.html` 静态外壳 + `demo/bench-patch.js` 运行期补丁 + `server/*-8902.mjs` 的 `fsRoots()`）
- 本轮改动的文件（全部在写权范围内）：
  - `server/we-scene-demo-server-8902.mjs`（**只**动 `fsRoots()` 一块：候选表 + 上限）
  - `demo/bench-patch.js`、`demo/index.html`
  - **新增** `tests/bench-issue0924a-line-A-test.mjs`（纯 Node 判据 64 条）、
    `tests/bench-ia-group.mjs`（IA 组共享实现）、`tests/bench-issue0924a-ia-browser-test.mjs`（浏览器窄入口）
  - `tests/bench-ui-headless-test.mjs`（插 IA 组 + 取数加固）、`tests/bench-dsh-libroot-test.mjs`（加 A1j/B5b*）、
    `tests/bench-props-text-test.mjs`（第 3 条**契约更新**）
  - `demo/mpw-select.js`：**未改动**（复核后确认第 17 条只需在补丁层扩大增强面 + 加读数）
- 未触碰：`core/**`、`demo.html`、`server/we-scene-demo-server.mjs`、`package.json`、`README*`、`docs/PATCHES.md`、
  `../dsh-mpkg-wallpaper/**`。没有 `git add -A`、没有 commit/push。
- 纪律：两条浏览器档串行跑在 `flock /tmp/.mpw-firefox.lock` 里；跑之前把常驻 `:8902` 用新代码重启
  （`fsRoots()` 在进程内，不重启读不到第 1 条的改后读数；新进程日志 `/tmp/mpw-8902.log`）。

---

## 0 结论

**12 条 + 收尾第 20 条全部落地**，每条都有"源码级/纯函数判据 + `__benchPatch` 探针"两道可机读证据，
并且给了**改前/改后成对读数**（能复现的都做了"同尺子复现"）。**9 项验收命令全绿**（§2）。
过程中另抓到两处**属于本线、但不在 12 条清单里**的真问题并一并修掉（§5：产物 `#release.onclick` 抛错、
窄屏 resize 下面板被裁），以及一处**别的线**的接口缺口（§6）。

---

## 1 逐条：现象 → 落点 → 判据 → 改前/改后读数

> 判据名前缀：`A*` = `tests/bench-issue0924a-line-A-test.mjs`（纯 Node）；`IA*` = `tests/bench-ui-headless-test.mjs`
> 的 **IA 组**（实现共享在 `tests/bench-ia-group.mjs`，另有窄入口 `tests/bench-issue0924a-ia-browser-test.mjs`）；
> `B5b*/A1j` = `tests/bench-dsh-libroot-test.mjs` 新增断言；`5v/5x/…` = `tests/bench-props-text-test.mjs`（契约更新）。

### ① 快捷根太多 ⇒ 溢出、"当前库目录"竖排成一字一行、后几条看不见

- 根因：服务端候选 **7 条**（含同义的"配置库根 / 配置库根的上一级"）；对话框里那一行 `display:flex` **不换行**、
  chip 又不禁止折行 ⇒ flex 收缩把"当前库目录"压成竖排；`.bench-dirbox-win{overflow:hidden}` 再把后面的 chip 裁掉。
- 落点：`server/we-scene-demo-server-8902.mjs:504`（`MAX_FS_ROOTS = 6`）、`:506`–`:529`（候选表减项 + 去重后 `break`）；
  `demo/bench-patch.js:6787`–`6788`（`.bench-dirbox-roots{flex-wrap:wrap;…;max-height:112px;overflow:auto}` +
  chip `white-space:nowrap;text-overflow:ellipsis`）、`:7891`（容器带上该类名）。
- 判据：`A1a`–`A1i`、`A1j`（上限 6 条 + 冗余 kind 消失；与既有 `A1`（≥5 条）**同时**成立）、
  `IA1a`–`IA1c`、`IA2a`–`IA2c`。
- 改前 → 改后：
  - `GET /api/fs/roots`：**7 → 6 条**（`library / library-parent / home / cwd / workspace / mount`；`/mnt` 被上限挡掉，
    `library-configured` 不再出现）
  - `dirboxGeometry()`（真机）：`{open:true, count:6, overflow:false, lineChars:[], wrapped:true(minW:88, maxH:24)}`
  - **改前复现**（同一入口，注入旧规则 + 300px 窄窗）：`{count:6, lineChars:6, minW:26}` ⇒ 6 块全被压成一字一行；
    撤掉注入立刻回 `{lineChars:0, minW:88}`（`IA2c`）。

### ② "调整音量"搬进 NP 条；壁纸配置最下面不再显示

- 落点：`demo/index.html:661`–`676`（新增 `#np-volbar`：NP 卡片正下方那一行，图标 + 「音量」+ 百分数；`#np-volume`
  从 `#np-audio` 移出）、`demo/index.html:286`–`291` 与 `demo/bench-patch.js:6826`–`6832`（两表同款样式）、
  `--mpw-np-vol:26px` 参与 `--mpw-np-cover`；读数 `demo/bench-patch.js:3331`–`3334`、`#np-volnum` 呈现层在 `:2877`。
- 判据：`A2a`–`A2e`；`bench-dsh-libroot` **B5b / B5b1 / B5b2**（新增）；既有 `A9/A9b/B5/B5a`（不越容器）**逐字保留**。
- 改前 → 改后：`npGeometry()` = `{volumeInNpBar:true, volumeInStrip:false, stripHasVolume:false, volbarOverflow:false}`；
  `volbar.top=1449.6 ≥ card.bottom=1394.1`（卡片收起态 78px）；`#np-audio` 里已无 `#np-volume`；
  200px 窄容器下滑条仍有 81.1px 宽（同一容器里注入旧规则复现 = 64px）。

### ③ 图片去重默认"全部都去重"；下拉栏连同描述文字删掉

- 落点：面板可见开关整块删除（`buildImgModeControl` / `#bench-imgmode-note` / `change` 处理 / `IMG_MODE_PREF_LS`），
  只留两层：URL 档 `?propimg=` > **缺省 `once`（整面板去重）**；`paintImgModeControl()` 变只读档位入口；
  5 条 `#bench-imgmode*` 样式从 `BENCH_PICK_CSS` 删除（`demo/bench-patch.js:4653` 附近有完整说明）。
- 判据：`A3a`–`A3f`；`bench-dsh-libroot` 的 `B7/B7a`（真语料，**既有断言一条没改**）。
- 改前 → 改后：`planRichImageMode({})` = `{mode:'once', source:'default'}`（缺省不变）；
  运行期新增事实：源码 0 处 `#bench-imgmode`、0 处 `bench-props-imgmode` 读写、DOM 0 个该节点、
  陈旧偏好不再能压过缺省；真语料 `once` = `rendered:6 / duplicatesSkipped:7`，`?propimg=all` = `rendered:13 / duplicatesSkipped:0`。
- 契约变更理由见 §3.1。

### ④ 通用自检："有范围的显示"都要检测是否溢出

- 落点：`demo/bench-patch.js:301`–`304`（20 个容器选择器）、`:306`–`:322`（纯函数 `overflowVerdict`）、
  `:7660`–`:7716`（`overflowRows()` / `panelOverflowProbe()`）、`:10079`（挂 `__benchPatch`）。
- 判据：`A4a`–`A4g`；`IA2a/IA2b`（1360px 与 760px 两档）。
- 改前 → 改后：改前**没有**这个自检面；改后两档 `{ok:true, checked:20, bad:[]}`。
  口径经实测收口两次（`A4f`/`A4g`）：`overflow:visible` 的溢出 = `spill`（画在外面但看得见，不红）；
  绝对/固定定位子节点是浮层（`#np-host`），不计入越界 —— 只有 **hidden/clip 真裁掉**才红。

### ⑤ 选完文件夹后预览不实时刷新（列表仍是上一次选择的内容、缩略图加载不出来）

- 根因：侧栏 `#list` 由**产物**渲染，产物只在它自己的 `#pick-lib.onclick` 链尾（`ht(); await Te()`）重拉重画；
  该入口被本补丁按早先要求接管（F0 判据）⇒ 再没人调 `Te()`，于是 `GET /api/library` 虽被我们重拉，**侧栏 DOM 还是旧库的行**
  （旧 itemId 的 `/api/thumb` 404 = 用户说的"缩略图加载不出来"）。
- 落点：`demo/bench-patch.js:7777`–`7819`（`refreshLibrarySoft()` 末尾 `await refreshSidebarList()`）、
  `:7819`–`7900`（借产物重载链 + 一次性 fetch 垫片拦 `POST /api/library-dir {pick:true}` + 按 id 复原 + 稳定态取数）、
  `:5638`–`5639`（`initSiteShell` 导出 `switchToWallpaper/currentId`）、`:10082`（探针）。
- 判据：`A5a`–`A5e`；**端到端** `IA9a`–`IA9c`（临时夹具服务上真的换一次库）。
- 改前 → 改后（端到端读数）：`libRefreshProbe()` =
  `{ran:true, reason:'lib-dir', rootDir:'<夹具>/libB', rowsBefore:1, rows:2, error:''}`，
  DOM：换库前 `['iaA1']` → 换库后 `['iaB1','iaB2']`，输出区留下 `Sidebar re-rendered after the library switch: 2 items`。
- 契约说明见 §3.2。

### ⑦ 调试模式被选中时没有灰色选中框

- 落点：`demo/bench-patch.js:5751`–`5757`（`paintLogsTabs()` 的选中态循环补上 `tabDebugBtn`）、
  `demo/index.html:234` + `demo/bench-patch.js:7090`（选中态加灰框 `inset 0 0 0 1px var(--border)`）。
- 判据：`A7a/A7b`；`IA3b`。
- 改前 → 改后：改前调试页签只有 `aria-selected` 变、**没有** `.active` ⇒ 没有灰底/灰框；
  改后 `dbgTabState()` = `{aria:'true', cls:'logs-tab panel-tab active', boxGray:true, boxShadow:'rgb(43,43,43) 0px 0px 0px 1px inset'}`。

### ⑧ 调试 tab 文案随勾选 `调试模式·ON / OFF`（ON 绿 / OFF 红，正常色）

- 落点：`demo/bench-patch.js:5922`（`dbgPaint()` 每次补写）、`:5933`–`5958`（`paintDbgTab()` +
  **只盯这个按钮的 MutationObserver**：产物那趟 i18n 会把文案写回去，实测抓到过）、`:3341`–`:3358`（探针）、`:10093`（出口）；
  样式 `:7092`–`:7093` + `demo/index.html:236`–`237`（ON `#3fb950` / OFF `#e5534b`）；
  i18n 新键 `logs.debugOn`/`logs.debugOff` 中英各一份。
- 判据：`A8a`–`A8d`、`A20d`；`IA3a`（OFF→ON→OFF 三态）、`IA3c/IA3d`（G 通道最大 / R 通道最大）。
- 改前 → 改后：改前恒为 `调试模式`（无状态无颜色）；改后 `off='Debug mode·OFF' / on='Debug mode·ON' / back='Debug mode·OFF'`，
  颜色 `rgb(229,83,75)` / `rgb(63,185,80)`。

### ⑨ "输出"面板里的字淡灰看不清

- 根因：产物 CSS 把 `#logbody` 颜色写死 `#ccc`；浅色主题（面板 `#f3f3f3`）下几乎不可见；诊断栏 `#diag-body` 一直继承 `var(--fg)`。
- 落点：`demo/index.html:182` + `demo/bench-patch.js:7097`（`#logbody{color:var(--fg)}`，特异性压过产物那条 id 规则）。
- 判据：`A9a/A9b`；`IA4a`（与诊断栏逐字同色，两主题各一次）、`IA4b`（对比度）。
- 改前 → 改后：浅色 `#ccc` on `#f3f3f3` ≈ **1.45:1** → `rgb(59,59,59)` on `rgb(243,243,243)` = **10.10:1**；
  暗色 `rgb(204,204,204)` on `rgb(24,24,24)` = **11.06:1**。

### ⑪ 说明 / 壁纸设置中英同时显示；API 列表不全、中英不同步

- 落点：① `demo/index.html:168` + `demo/bench-patch.js:7140` 把死选择器 `html.bench-shell html:not([lang="en"]) .lang-en`
  换成 `html[lang]:not([lang="en"]) .lang-en`；② `demo/index.html` 的 `#page-wpset` 两表补齐（"运行参数"表 **5 → 13 行**，
  英文表补回亮度/对比度那行的 WE 内部键）；③ `fixWpsetDoc` 的 4 条"已实现"注记改成**中英双份**（`match` 同时认两语标签、
  注记按语言取），幂等标记带语言；④ 探针 `demo/bench-patch.js:6355`–`6455`、`:10097`。
- 判据：`A11a`–`A11e`；`IA6a`（两个方向的语言过滤）、`IA6b`（`sameRows`）。
- 改前 → 改后：`langFilterOk` false→true；`wpset.sameRows` false→**true**（`zhRows=enRows=25`，`firstDiff:null`）；
  运行期两语的"已实现（…）"注记现在都写（`rawSample` 两语都出现 `#mpw-flip-h`）。

### ⑯ "输出"来新消息时不要自动切到页面底部

- 落点：`demo/bench-patch.js:6549`–`6575`（`LOG_STICK_PX=24` + `logScrollNow()` + `logScrollState()` + 跟随式 `logLine()`）、
  `:10080`（`logScrollState()` / `logAppend()` 出口）。
- 判据：`A16a`–`A16c`；`IA5a`（用户在上面 ⇒ 位置不动）、`IA5b`（贴底 ⇒ 仍跟随）。
- 改前 → 改后：改前无条件 `scrollTop = scrollHeight`；改后读数 `clientH=164 / scrollH=7795`，
  滚到顶（`scrollTop=0`，距底 7631px）后来一条 ⇒ **仍为 0**；贴底后来一条 ⇒ `slack=0`。

### ⑰ 壁纸配置里凡原生 `select` 一律自绘

- 落点：`demo/bench-patch.js:2672`–`2703`（`watchBenchPropsSelects()` 观察根 `#props-body` → **`#props` 整棵子树**，
  面板头部 `.props-row` 也在内；新增 `panelSelectProbe()`）、`:5639` / `:10095`（两个出口）；面板里唯一那条自造原生 select
  （`#bench-imgmode`）按第 3 条删除。
- 判据：`A17a`–`A17c`；`IA7`。
- 改前 → 改后：改前观察面漏掉 `#props` 头部那一行（`#bench-imgmode` 就是漏增强的那一条）；
  改后 `propsSelectProbe()` = `{panel:true, total:8, native:0, enhanced:8, mpw:8, leaked:[]}`。

### ⑲ 清空全部壁纸后点「释放」⇒ 日志仍在跑、一直刷"无 web GL2"

- 根因（真机读数就是这条链）：产物 `#release.onclick = () => E()?.release()`，而默认档（本仓渲染器 `/webloader/`）
  的 `__wp` **没有 `release`** ⇒ 每次点击抛 `TypeError: E().release is not a function`：
  ① 这一下等于什么都没做（渲染器没停、日志继续刷 —— 用户报的现象）；② 未捕获异常弹出全局错误条
  `#bench-errorbar`（glass 层）**盖住页签条**，连"关标签的 ×"都点不到（实测把整条浏览器门禁挡在半路）。
- 落点：`demo/bench-patch.js:9272`–`9320`（`releaseQuietNow()`：停渲染器 + 清 iframe `about:blank` + `clearInterval` + 门闩）、
  `:9119`–`:9127`（轮询体首行门闩）、`:9203`–`:9218`（探针）、`:9322`–`:9360`（**摘掉产物那条会抛错的处理器** + 自己的入口 +
  `releaseResume()` + `window.__benchRelease`）、`:9400` 附近（`installRendererApiFallbacks()`：给"产物无条件调用而当前档缺失"
  的 `release` / `pointerLeave` 装**如实登记**的降级实现，写 `__benchApiFallbacks`，探针 `apiFallbacks()` 可读）、
  `:9971`（合成样例自动挂载的 `released-quiet` 守卫 + `switchToWallpaper` 里的 `resume()`）。
- 判据：`A19a`–`A19h`；`IA8a`（释放后 1.2s 输出区一行都没多）、`IA8b`（三件套读数）、`IA8c`（产物处理器已摘）。
- 改前 → 改后：改前"释放"后 `grewAfterRelease > 0`、`pollRunning=true`、`frameBlank=false`，并弹出错误条；
  改后 `lines: 360 → 361 → 361`（只有那一条"已释放"日志，之后零增长），
  `{quiet:true, pollRunning:false, frameBlank:true, artifactChainDetached:true, apiCalled:true}`。

### ⑳ 收尾：文案里不再把 `:8899` 当"渲染器页"

- 落点：词典三条中英各一份（`bandfeed.noReport` / `toolbar.rendererSrcTip` / `rendererSrc.unreachable`）：
  旧说法（"渲染器页在 :8899"/"本机 :8899 没在跑"/"runs on :8899"/"is :8899 running"）清零，改成
  "由 :8902 **自己直供** `/webloader/`，**不需要 :8899**"这种否定式事实。
- 判据：`A20a`（含 `8899` 的键恰好 6 个、**零**旧说法）、`A20a2`（每处都在否定语境）、`A20b`、`A20c`（中英键数对称 368/368）。
- 改前 → 改后：6/6 处旧说法 → 0 处旧说法 + 6 处否定式。

---

## 2 我跑过的命令与最终汇总行（全部重跑于最后一版代码）

| # | 命令 | 结果 |
|---|------|------|
| 1 | `node tests/demo-syntax-check.mjs` | ✅ `demo 内联脚本语法：11/11 通过` |
| 2 | `node tests/demo-check.mjs` | ✅ `demo-check: 132 通过 / 0 失败`（含 D8 逐条 CSS 等价、D9 窄屏安全网零漂移、D11 ⑬ 下拉浮层、D12 全套） |
| 3 | `node tests/docs-check.mjs` | ✅ `文档一致性全部通过`（17 个文档 / 786 个文件引用 / P-编号 / diag-flags） |
| 4 | `node tests/secret-scan-test.mjs` | ✅ `凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目`（扫 488 个 tracked 文件） |
| 5 | `node tests/bench-issue0924a-line-A-test.mjs` | ✅ `PASS=64 FAIL=0`（**新增门禁**：本报告 12 条 + 第 20 条的纯 Node 判据） |
| 6 | `node tests/bench-props-text-test.mjs` | ✅ `48 通过, 0 失败`（第 3 条契约更新后；含 10 组变异自证） |
| 7 | `flock /tmp/.mpw-firefox.lock -c 'node tests/bench-dsh-libroot-test.mjs --no-mutant'` | ✅ `PASS=69 FAIL=0`（含新增 A1j / B5b / B5b1 / B5b2） |
| 8 | `flock /tmp/.mpw-firefox.lock -c 'node tests/bench-ui-headless-test.mjs'` | ✅ `PASS=174 FAIL=0` |
| 9 | `flock /tmp/.mpw-firefox.lock -c 'node tests/bench-issue0924a-ia-browser-test.mjs'` | ✅ `PASS=23 FAIL=0`（**新增窄入口**：IA 组 20 条 + IA9 换库即刷新 3 条） |

### 2.1 浏览器档探针原始读数（改后，取自第 8/9 条命令）

- **① 快捷根**：`/api/fs/roots` **6 条**；`dirboxGeometry()` = `{open:true, count:6, overflow:false, lineChars:[], wrapped:true}`
  （chip：`当前库目录 89×24`、`库根的上一级（allwallpaper）186×24`、`宿主 home 88×24(disabled)`、
  `当前工作目录（we-scene-demo）204×24`、`工作区根（DSHarea）145×24`、`挂载点 /media 106×24(disabled)`；
  两行：top 213 / 243）。改前复现 = `{lineChars:6, minW:26}`。
- **①+④ 溢出自检**：1360px `{ok:true, checked:20, bad:[]}`；760px `{ok:true, checked:20, bad:[]}`（`spill` 空）。
- **② 音量条**：`{volumeInNpBar:true, volumeInStrip:false, stripHasVolume:false, volbarOverflow:false}`。
- **③ 图片去重**：`once` = `rendered:6 / duplicatesSkipped:7`；`?propimg=all` = `rendered:13 / duplicatesSkipped:0`。
- **⑤ 换库即刷新**：`IA9` = `{before:['iaA1'], after:['iaB1','iaB2'], probe:{ran:true, rootDir:'…/libB', rowsBefore:1, rows:2}}`。
- **⑦⑧ 调试页签**：`off='Debug mode·OFF'`（灰底 + `inset` 灰框）/ `on='Debug mode·ON'`（绿）/ `back='…·OFF'`（红）。
- **⑨ 输出配色**：暗色 11.06:1、浅色 10.10:1，与 `#diag-body` 逐字同色。
- **⑪ 中英**：`langFilterOk=true`（两方向）、`wpset={zhRows:25, enRows:25, sameRows:true, firstDiff:null}`。
- **⑯ 滚动**：`clientH=164/scrollH=7795`；在上面来消息 `scrollTop` 不动；贴底仍跟随。
- **⑰ 面板下拉**：`{total:8, native:0, enhanced:8, mpw:8}`。
- **⑲ 释放**：`lines 360→361→361`（零增长）；`{quiet:true, pollRunning:false, frameBlank:true, artifactChainDetached:true}`。

---

## 3 契约变更（显式更新判据 + 理由，未放宽任何语义无关的断言）

### 3.1 第 3 条：删掉 `#bench-imgmode` ⇒ `bench-props-text-test.mjs` 的 5v/5v2/5w/5x/5z 与 S2/S4/S5 更新

用户明令"把下拉栏连同描述文字一起删掉" ⇒ 旧判据盯的"第二层可见开关"整层不存在了，继续断言它存在 =
让门禁守住一个被用户删掉的东西。更新后的判据**更严**：源码（去注释后）0 处 `bench-imgmode`、0 处 `IMG_MODE_PREF_LS`；
`buildImgModeControl` 不存在；`paintImgModeControl()` 只读化；**不允许**再出现 `planRichImageMode({url, stored})` 调用面；
5 条样式从 `BENCH_PICK_CSS` 删除。变异自证 `S2` → "开关不许回来"、`S5` → "删掉的样式不许回来（也不许搬进 `SITE_LAYOUT_CSS`）"、
`S4` → "原地重画仍接线"。纯函数本身保留 `stored` 形参（历史调用面不破）。

### 3.2 第 5 条：换库后重画侧栏 = 借产物自己的重载链（`ht()` ⇒ 释放 + 按 id 复原）

`libDirCommitPlan()`（`reloadPage=false / closeDialogOnSuccess=true / closeDialogOnFailure=false / touchSelection=false`）
**一条没改**。新增的是"侧栏 DOM 也要跟着换库"这条事实：产物唯一那条"重拉 + 重画"链是 `#pick-lib` 的原处理器
（`artifactPickChain`），链尾 `ht(); await Te()`；`ht()` 会释放舞台（产物写法，改不了）⇒ 刷新完成后**按 id 复原**：
新库里还有同 id 就重新挂它，没有就写 `log.listRefreshDropped` 并留在"未选择壁纸"。**目标选中项不变**。

### 3.3 第 17 条：观察面扩大（加严）

`watchBenchPropsSelects()` 的观察根 `#props-body` → `#props`：多覆盖面板头部那一行，既有 S3a/S3c 判据不受影响。

### 3.4 取数加固（不是判据）

`bench-ui-headless` 的 M 组 `measure()` 原来在拿不到列表时**直接抛异常中止整轮**（后面所有组一条读数都没有）；
现在改成如实返回 `err` 读数（M2/M3/M4 判据不变，数据缺失就是 FAIL），并对**夹具**加一次重插重测
（`M2 夹具重插读数：first={err:…} retry={flip:'down', gap:2, firstItem:'Alpha', count:3}` 两份都打印）。
另外把 M 组夹具的偶发故障如实记在这里：整页门禁长链里偶发拿不到列表（隔离复现三次都正常：新开页 / 挂壁纸后 /
渲染器来源来回后），**不是**第 17 条引入的（观察面扩大只多覆盖面板头部，不碰夹具那条路径）。

---

## 4 未验证项 / 风险（如实说）

1. **Windows 分支未实测**：盘符候选与 `C:\` 标签只有源码级判据（本机是 Linux）。
2. **"无 web GL2"那句原文未钉**：那句话来自渲染器页/上游产物（不在本线写权范围）；本线按用户口径做的是
   "释放要真的停干净"，判据只断言"释放后输出区不再增长"，不去匹配那句文案（避免把别人的文案写进本线门禁）。
3. **常驻 `:8902` 被我重启过一次**（旧 pid 26176 → 新进程，端口不变，日志 `/tmp/mpw-8902.log`）：
   `fsRoots()` 在进程内，不重启读不到第 1 条的改后读数。`core/**`、`demo.html` 未触碰。
4. **浏览器档在长链里出现过偶发**（都重跑为绿，且都有原始读数）：
   - `bench-ui-headless` **M2/M4**（mpw 夹具首次 `open()` 拿不到惰性列表）：加一次夹具重插后稳定通过；
   - `bench-ui-headless` **P2**（收起期间切壁纸，"reading"窗口里还留着上一张的 `schemecolor` 行）：
     第 8/9 两次红、第 10 次绿（同一份代码），判为**时序偶发**，与本线 12 条无交集（未改该路径）；
   - 自己的 `IA9b` 曾因断言写错（拿"对话框关闭后的空路径"去比）假红一次，已改成比"新库根 `/libB$` + 行数"。
5. **未跑全量套件**（内存纪律：本机 15GB 且曾 OOM）；浏览器档一律 `flock` 串行，同机同一时刻只有一个 Firefox。
6. 被改动断言的既有门禁只有一个：`tests/bench-props-text-test.mjs`（§3.1，契约变更）；其余既有门禁**只增不减**。

---

## 5 顺手修掉的两处（属于本线、但不在 12 条清单里）

1. **产物 `#release.onclick` 抛错**（`E().release is not a function`）：摘链 + 自己接管 + `__wp` 缺方法的**如实降级**
   （`release`/`pointerLeave`）。这一条同时解掉了 ⑲ 的核心症状与"错误条盖住页签条"引发的连锁门禁超时。
2. **窄屏 resize 下面板被裁**：`#sidebar/#props` 的"限高 + 自身可滚"原来只在 `.bench-narrow` 类块里（首屏同步加的类），
   安全网没搬 ⇒ **加载后把窗口拉窄**时吃产物 `overflow:hidden`，`#sidebar` 实测 `clientH=55 / scrollH=195`、
   三个子节点全在框外。已把那条逐字搬进 `@media (max-width:1180px)` 安全网（类块里仍有同款，D9 零漂移照旧成立）。

## 6 需要编排者知道的一件事（别的线的接口缺口）

`demo.html`（渲染器 page，**渲染器线的文件**）的 `__wp` 目前**没有** `release` / `pointerLeave` 两个方法，
而产物页（minified、不可改）会无条件调用它们。我在补丁层做了**如实登记**的降级（见 §5.1），
但真正的实现应当在渲染器页补上；渲染器线一旦补上，我那段降级会自动失效（只在 `typeof !== 'function'` 时安装）。

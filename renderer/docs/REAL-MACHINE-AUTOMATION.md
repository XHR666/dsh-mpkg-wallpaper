# REAL-MACHINE-AUTOMATION.md —— 真机验证里"能自动化的部分"：自动化边界、命令、SKIP 条件、人工缺口清单

> ①(§5-⑧ 2026-09-17「回归自动化：把真机验证里"能自动化的部分"全自动化，目标 = 不再靠你人肉点」)
> 本文是这条线的唯一说明书。相关文件：
> `tests/real-machine-check.mjs`（门禁项 `real-machine-check`）、
> `tests/baseline-trend.mjs`（门禁项 `baseline-trend`，§5-⑨ 趋势视图）、
> 采集器/落盘/对拍见 `docs/BASELINE.md`（`?baseline=1` + `tools/baseline-diff.mjs`）。
> 注册位置：`tests/run-all-tests.sh` **`add` 列表末尾**（既有 82 行一字未动，只在末尾顺延 2 行）。

---

## 0. 先纠正一处任务书里的 URL（实测）

任务书写被测对象是 `http://127.0.0.1:8899/demo.html`。**实测这条路径是 404**：

```
$ curl -s -o /dev/null -w '/ => %{http_code}\n'          http://127.0.0.1:8899/
/ => 200
$ curl -s -o /dev/null -w '/demo.html => %{http_code}\n' http://127.0.0.1:8899/demo.html
/demo.html => 404
$ curl -s -o /dev/null -w '/index.html => %{http_code}\n' http://127.0.0.1:8899/index.html
/index.html => 200
```

根因在 `server/we-scene-demo-server.mjs:366-371`：只登记了 `p === '/' || p === '/index.html'`，
而**两者都读仓库根的 `demo.html` 字节流**（仓库根那个 `index.html` 不被这个服务使用）。
⇒ 8899 的"落地页"与"渲染器 demo 页"是**同一个字节流、两个 URL**，本工具统一打 `/`，
并在报告 `notes` 里如实记一行 `GET /demo.html → 404`（**不当断言**：免得以后真加了路由反而变红）。

---

## 1. 现在自动化了什么（逐面 + 复用了哪条既有契约）

`tests/real-machine-check.mjs` —— **52 条断言 / ~15s**，三个靶子：

| 靶子 | URL | 覆盖 |
|---|---|---|
| A 落地页 | `/` | 服务 200、**服务字节 = 仓库 `demo.html` 字节**（逐字节，含落盘夹具复核）、module 图完整、无报错、日志区收纳全流程 |
| B 自带合成样例 | `/?id=sample-synthetic` | 建档（`scene.json 解析: N layers`）、属性面板、**属性变更**、面板开合 + 刷新保持、工具栏按钮真改 URL |
| C 第二份包（有语料才切） | `/?id=<corpus id>` | **壁纸切换耗时**（整页导航口径） |

| # | 面 | 断言（摘要） | 复用的既有契约（**不另造口径**） |
|---|---|---|---|
| 1 | 服务/落地页 | `/` 200；`text/html`；**字节 = `demo.html`**（服务字节写进 `mkdtemp` 夹具再逐字节 `equals`） | `server/we-scene-demo-server.mjs:366-371`（`/` 与 `/index.html` 都发 `demo.html`） |
| 2 | **模块图完整性** | `window.__mpwModuleStarted === true` | 该句柄是页面自己的启动标记（`demo.html` 看门狗段用它判 `module-not-started`）。**这条就是"真的打开一次页面"的断言**：P-110 的 `/puppet-skin.js` 缺路由（§2）会让它永远 false |
| 3 | 无报错 | 0 `pageerror` / 0 console error / **0 条未放行的失败请求**（逐条列出 + 计数）；白名单 §3.2 | 与 `tests/baseline-test.mjs` 的"默认关时零行为变化"同精神：**不许静默** |
| 4 | 工具栏 | `#bar` 存在（≥6 链接 + ≥2 按钮）；`#mpw-skin-toggle` 点击后 URL 变 `?skiny=0`、`#mpw-skin-state` 文案翻成 `+y` | `demo.html:78-91` 的 `skiny` 文案与跳转契约；按钮 id `mpw-skin-toggle`/`mpw-skin-state` 是源码固定值 |
| 5 | 画布/FPS | `#sc` 存在、`position:fixed`、`display:block`；`#fps` 存在 | `demo.html:259-270` 的 `fitCanvas()`；**只断言存在，不断言 `#fps` 数值**（无 GPU 恒 `--`） |
| 6 | 日志区（诊断） | `#log` 存在、`overflow:auto`、加载后**非空**（行数记账） | `log-panel-collapse-test.mjs` **Q8e**（`#log{…overflow:auto…}`） |
| 7 | **日志区收纳** | 默认 35vh（800px 视口 → 280px）/ 手柄 `bottom` 跟随 / 点箭头 → `height:0`+`display:none`+右下角药丸(`collapsed`)+`bottom:0` / **箭头 ▾→▴** / `localStorage['mpw-log-h']='collapsed'` / 再点 → 展开、箭头回 ▾ / `End` 收起 + `Enter` 展开 / 上拖 100px 变高 + 比例落盘 | `log-panel-collapse-test.mjs` 的 **Q8b/Q8c/Q8d/Q8f/Q8g/Q8h/Q8i/Q8j/Q8k/Q8l/Q8m/Q8s/Q8t**（同一批判据，这次在**真 DOM + 真指针/键盘**上再钉一遍） |
| 8 | 属性面板 | `#mpw-props-btn` 装进 `#bar`；`div#mpw-props-panel` 存在且**渲染出行/分组**；默认 `open`（localStorage 无记录）；`window.__mpwProps.panel` 有值 | `props-panel-test.mjs`（真包 35 条属性 → 控件/分组计数）；`demo.html:3744-3762` 的 `mpw-props-open` 持久化 |
| 9 | **属性变更** | 点 `label.mpw_cb`（Uiverse 勾选框）→ 勾选态翻转 → `localStorage['mpw-props:<id>']` 记下新值 → `window.__mpwProps.values` 里该键真的变了 → `__mpwProps.stored` 含该键 | `props-panel-test.mjs` **T6**（持久化）+ `__mpwProps` 诊断表（`docs/README-DIAGNOSTICS.md`） |
| 10 | 面板开合 | 连点两次 `#mpw-props-btn`：`class`/`display`/`aria-expanded`/`localStorage['mpw-props-open']` **四处同口径**翻转；再重载 → 保持开 | `demo.html:3752-3762` 的 `setOpen()`（class/aria/localStorage 三写在同一个函数里） |
| 11 | **壁纸切换** | 切到语料里的第二个包（`/pkg/<id>` 200 才切）→ 新页 `scene.json 解析: N layers`，记录 **导航→建档 ms** | 与 `docs/BASELINE.md` §3.3 的**整页导航口径**同义（`switch.swapTo.ms`） |
| 12 | 能力上报 | `window.__mpwCap()` 存在、`v=1`、`sceneId` = 请求的 `?id`、`ok=false` 时 `errs` 非空 | `demo.html` 的 `mpw-cap` 契约（宿主插件按它判成败）；**无 GPU 必须如实报错，不许静默 `ok:true`** |
| 13 | 全屏 / 主题 | **如实记录"页面没有"**：`fullscreenCtl=false`、`themeCtl=false` | `grep -c requestFullscreen demo.html` = **0**；全文件无 theme 控件。⚠ 任务书点名的 `tests/fullscreen-recenter-test.mjs` **不是全屏按钮测试**，是"近整屏层 origin 兜底"的纯函数测试（该文件第 1-12 行的自述） |

### 1.1 报告长什么样

`reports/real-machine/<epochms>.json`（**~4KB**，机读；目录上限 **50 份**、超限删最旧，只动这一个子目录，
绝不碰 `reports/baselines/`）。字段路径**与基线快照同源**（`core/baseline-metrics.mjs`）：

```json
{ "kind": "real-machine", "schema": 1, "at": "...", "id": "sample-synthetic",
  "startup": { "navToModuleStartedMs": 774, "totalMs": 455, "navToFirstFrameMs": null,
               "readyReason": "scene-parsed(no-webgl2)" },
  "fps": { "median": null, "note": "无 WebGL2 ⇒ 0 帧；不编造数字" },
  "counts": { "layers": 5, "propsRows": 4, "propsGroups": 0 },
  "switch": { "swapTo": { "ms": 1297, "toId": "3554161528" }, "swapBack": null },
  "vramProxy": { "textureBytesEst": null },
  "checks": { "total": 52, "passed": 52, "failed": [] },
  "pageErrors": [], "consoleErrors": [], "failedRequests": [],
  "allowlistedRequests": [ { "url": "/refrender/sample-synthetic", "status": 404, "count": 4, "kind": "benign-404", "why": "…" } ],
  "surfaces": { … }, "surfacesB": { … }, "skipped": [], "notes": [ … ] }
```

⚠ **诚实说明**：本机（无 GPU）拿不到帧 ⇒ `fps.*`/`frames.*`/`render.*`/`vramProxy.*` 一律 `null`，
**不是 0、不是估算**。真机的这些数字只有 `?baseline=1` 采集器（`docs/BASELINE.md`）才产得出来；
本报告在趋势表里因此**只对"启动/切换耗时 + 面结构"负责**。

---

## 2. 这条线第一次跑就抓到的真回归（留着当"为什么需要它"的证据）

P-110（bind 世界链）给 `core/we-scene-bundle.js:6` 加了 `import { bindWorldChain, … } from './puppet-skin.js'`，
新文件、产物根映射（`build-pages.mjs:60` 的 `['core/puppet-skin.js','puppet-skin.js']`）与 PWA 预缓存
（`web/sw.js:24` 的 `'/puppet-skin.js'`）**都登记了**，**唯独 8899 缺这条路由**。浏览器收到 404 会把
"模块 MIME 类型不合法"当加载失败 ⇒ 整条 module 图断在这里：日志永远停在 `loading…`、
`window.__mpwModuleStarted` 永远 `false`、`__mpwCapErr('module-not-started')` 7s 后兜底报错。
而当时 **80 项门禁全绿** —— 因为没有任何一项真的用浏览器加载过这个页面。

本工具用**故意回退**证明了它会红（`RED-IF-REVERTED`，2026-09-17 实测）：

```
# 把 server/we-scene-demo-server.mjs 里那条路由去掉、重启 8899（/puppet-skin.js → 404）后：
══ real-machine-check：35/49 通过，1 条件项跳过，14 失败
   ✗ pageA / module-started  — __mpwModuleStarted=true（…实测 P-110 的 /puppet-skin.js 就是这样断的）
   ✗ errors / no-console-error  — 6 条：[{"url":"/","message":"…Loading module from “http://127.0.0.1:8899/puppet-skin.js” was blocked because of a disallowed MIME type (“”）…"}]
   ✗ errors / no-unallowlisted-request-failure  — 2 条未放行：[{"url":"/puppet-skin.js","reason":"HTTP 404","count":6}, …]
# 恢复路由、重启后：52/52 通过（去掉一条恒真断言后为 52；当时为 53）
```

修复是 `server/we-scene-demo-server.mjs` 里**新增**一条与 `/attach-transform.mjs`、`/baseline-metrics.mjs`、
`/web-frame-geometry.mjs`、`/audio-band-array.mjs` **同形**的路由（`p === '/puppet-skin.js'` → 发 `core/puppet-skin.js`），
属纯增量、不改既有分支。

---

## 3. 命令 / SKIP 条件 / 退出码

```bash
# 面板冒烟 + 属性变更 + 壁纸切换（默认打 8899；需要服务在跑 + Playwright Firefox 可用）
node tests/real-machine-check.mjs
node tests/real-machine-check.mjs --json          # 末尾追加机读汇总
node tests/real-machine-check.mjs --no-report     # 不写 reports/real-machine/*.json（调试用）
node tests/real-machine-check.mjs --require       # 「无服务/无浏览器」也判 FAIL（CI 里想硬要时用）

# 趋势表（纯 Node，不开浏览器）
node tests/baseline-trend.mjs                     # 默认只告警；最新一对退化时打 ⚠，退出码仍 0
node tests/baseline-trend.mjs --strict            # 最新一对退化 ⇒ 退出码 1（发版前/回归时用）
node tests/baseline-trend.mjs --json --limit=20
node tests/baseline-trend.mjs --dir=<另一个 reports 根>   # 自测用（别写进仓库 reports/）

# 门禁里两项（末尾注册；条件项属性见下）
bash tests/run-all-tests.sh --only real-machine-check baseline-trend
```

**退出码**：`real-machine-check` 0 = 全绿（含条件项 SKIP）/ 1 = 有断言失败 / 2 = 用法错误；
`baseline-trend` 0 = 正常（含"只有一份、无从比较"）/ 1 = 有快照**不合 schema**，或 `--strict` 下最新一对退化 / 2 = 用法错误。

**SKIP 条件（按 `jpeg-decode` 的条件项约定：第一行 `SKIP <name>` + 退出 0，门禁不红）**：

| 工具 | 条件 | 打印（门禁按 `^SKIP <name>` 认） |
|---|---|---|
| real-machine-check | `GET /` 拿不到 200（服务没起/端口不对）→ 打印 `SKIP real-machine-check（服务不可用：…）` | 服务起法：`cd <仓库根> && node server/we-scene-demo-server.mjs 8899` |
| real-machine-check | Playwright 模块找不到（可用 `MPW_PLAYWRIGHT=<playwright/index.mjs 绝对路径>` 指定） | `SKIP real-machine-check（找不到 Playwright…）` |
| real-machine-check | Firefox 启动失败（没装浏览器 / `PLAYWRIGHT_BROWSERS_PATH` 指向空目录） | `SKIP real-machine-check（Firefox 启动失败：…）` |
| baseline-trend | `reports/baselines/` 与 `reports/real-machine/` **都没有**快照 | `SKIP baseline-trend（…一份快照都没有）` |

⚠ `baseline-trend` 的"没数据"与"数据坏了"是两回事：**一份都快照都没有 = SKIP**（门禁不红）；
**有文件但缺字段/JSON 坏/schema 不对 = 退出码 1**（这是真问题，不静默）。

**时间预算（实测）**：`real-machine-check` 全绿 **~15s**（4 次页面加载：`/`、样例包、重载、切包）。
判红路径 ~47s（实测 `MPW_RM_SAMPLE_ID=0000000000`：7 条断言失败 ⇒ 退出码 1）。
模块图断掉时每页先等 `MPW_RM_MODULE_WAIT`（默认 12s）再逐项报错、点击类断言各带 5s 上限 ⇒ 分钟级但**有界**；
`MPW_RM_TIMEOUT` / `MPW_RM_MODULE_WAIT` 两个 env 可调（后者调小 = 更早判红）。

---

## 3.1 已知良性 404 白名单（每条都必须有"为什么良性 + 证据"）

断言 3 的失败请求**不是**一刀切放过，而是逐条过 `classifyFailure(pathname, logText)`：

| 模式 | 为什么良性 | 证据 |
|---|---|---|
| `^/refrender/<id>$` | 官方标定 refrender 采样：**可选**诊断产物，取不到只是"没有对照数据"，页面继续建档 | 本机实测 `/` 与 `/?id=sample-synthetic` 都 404 这一条，而日志继续走到 `scene.json 解析: N layers`、0 pageerror/0 console error；仓内对照件是**离线文件** `ref-render-3719111841.json`，不经该 URL |
| `^/favicon\.ico$` | 浏览器自动请求站点图标；`demo.html` 没有 `<link rel=icon>`，页面不依赖它 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8899/favicon.ico` → 404；本次运行**未观测到**该请求（防御性条目） |
| `^/weassist/` | 包外资产三级回退链的第二级（本机 WE 安装目录 `/weassist/<basename>`）：命中不到就落第三级（sans-serif / 内置材质），是**契约内**的失败 | `tests/text-font-fallback-test.mjs`：「404·reject·空体都不抛异常且落第三级」 |
| `^/pkg/<id>$` | **只在页面自己已报**「`pkg HTTP 404（id=<id>`」时才放行 —— 语料缺失是**环境事实**，不是渲染器回归 | 判据绑在页面日志上（不是"看着像 404 就放行"）：包里存在但服务 500/404 时**照样红** |

---

## 4. 还需要人（诚实缺口清单，逐条给"点哪里 / 看什么"）

下面这些**故意没自动化**，因为在本机做只能是假绿或假红：

| # | 需要人的事 | 具体动作 | 看什么 | 为什么不能自动化 |
|---|---|---|---|---|
| 1 | **画面本身对不对**（第一眼） | 真机浏览器打开 `http://<本机IP>:8899/?id=<包id>` | 是否满屏、不是黑屏/白屏、人物不变形、没有明显错位 | 无头浏览器在本机**没有 WebGL2**（`❌ 启动失败: 当前浏览器不支持 WebGL2`，本工具报告里 `webgl2:false`）⇒ 像素/帧率类断言在无头路径上必假红；`?baseline=1` 也一个数字都产不出来（`docs/BASELINE.md` §1 已写明）。<br>①(2026-09-19) **有头 + 软件 WebGL2 这条例外已经打通**：`:0` 上的 headed Firefox（`MOZ_WEBGL_FORCE_SOFTWARE=1` + `webgl.force-enabled`）能拿到真 WebGL2 并出帧（~1 fps），已经用它做了**真指针链路**门禁 `x11-pointer`（见 `tests/x11-e2e/README.md`）⇒ **"像不像原版"仍需人眼，但"事件/方向/开关/像素计数"这类数字已经能自动判** |
| 2 | **磨砂注入**（`backdrop-filter`） | 真机打开带磨砂面板的包，鼠标移到面板后面看壁纸 | 面板后面的壁纸**是否真的被模糊**（不是纯色/透明块） | 无 GPU 的无头浏览器**不合成 `backdrop-filter`**；且 `grep -c backdrop-filter demo.html` = **0** ⇒ 这个面**根本不在渲染器 demo 页里**（属插件/`demo/` 测试台，另一个工作流） |
| 3 | **时间线可见性**（`?hour=` 日月循环） | 真机打开 `http://<本机IP>:8899/?id=3326873240&hour=3` 与 `&hour=15`（两次只改这一个变量） | 两次的**可见层不同**：看日志 `━━ 图层清单 ━━` 块的层数/`#i` 列表，以及画面对应变化 | 那个清单块**只在渲染循环启动后**才打印（`demo.html:5354` 的 `▶ 开始渲染…` 之后）⇒ 无 WebGL2 时根本走不到；且"哪一层该可见"是作者意图，机器判不了 |
| 4 | **真机 FPS / 启动 / 切换 / 显存代理数字** | 真机打开 `http://<本机IP>:8899/?id=<包id>&baseline=1`（10s，等右下角摘要），把 `reports/baselines/*.json` 留档；再跑 `node tests/baseline-trend.mjs` | 趋势表里启动/首帧/FPS/切换/VRAM 代理列的**趋势与 Δ** | 采集器要 WebGL2 才跑；本机只能验**工具链**（`tests/baseline-test.mjs`）与**趋势视图**（`baseline-trend`） |
| 5 | **🔊 音频面板**（它只在渲染启动之后才装） | 真机打开 `http://<本机IP>:8899/?id=3719111841`，点顶栏 `🔊 音频` | 列出 4 条音轨、点 ▶ 真的出声、下载可存 | 本机无 GPU ⇒ 启动在装音频面板之前就收尾（报告 `surfaces.audioBtn=false`，**如实记录不当失败**）；纯 DOM/枚举那一半已由 `tests/audio-panel-test.mjs` / `audio-panel-real-test.mjs` 覆盖 |
| 6 | **全屏按钮 / 主题切换** | —— | —— | **页面里没有这两个控件**：`grep -c requestFullscreen demo.html` = 0、全文件无 theme 控件（本工具如实记 `fullscreenCtl=false` / `themeCtl=false`）。要"验证"得先有实现，或它们在 `demo/` 测试台/插件侧（不属本工作流） |
| 7 | **脚本驱动的观感**（呼吸动画是否自然、眨眼相位、粒子密度） | 真机打开 `?mode=elysia&id=3719111841` 等，**看 10 秒** | 动作是否连续自然、有没有抖/跳/闪 | 主观 + 需真渲染；仓库里对应的**数值**部分已有 mock-GL 纯函数测试（如 `blink-phase-test.mjs`） |
| 8 | **多实例格子（`?ids=`）** | 真机打开 `http://<本机IP>:8899/?ids=<id1>,<id2>` | 两个格子各自渲染、只有一个是 active | 需要真 GL 上下文；纯逻辑部分已由 `tests/multi-instance-test.mjs` 覆盖 |

---

## 5. 怎么加一条新断言（照抄这个流程）

1. **选面**：先想清楚"这条断言在**没有 GPU** 的机器上也能判"。能判的形态只有四种：
   DOM 结构 / computed style / `localStorage` / 页面自己的句柄（`window.__mpwLogPanel`、`__mpwProps`、`__mpwCap`）。
2. **找既有契约**：先在 `tests/` 里搜有没有现成的纯函数契约（Q8 那批、`props-panel-test` 的 T6、`baseline-metrics` 的字段路径…），
   **照它的口径写**；本文件 §1 的表就是"面 → 契约"的对照，新面请顺手补一行。
3. **写断言**：在 `tests/real-machine-check.mjs` 里对应段落加一行
   `push('<group>', '<kebab-name>', <条件>, '<人读细节：把实测值打出来>')`；要开新页面就用 `open(url)`
   （它已按 `MPW_RM_MODULE_WAIT` 等 `__mpwModuleStarted`，并接好 pageerror/console/失败请求三类监听）。
4. **抗噪写法**（血泪教训，都实测过）：
   - `#mpw-props-panel` **有两个节点**：`<script id="mpw-props-panel">`（源码块）和真正的
     `<div id="mpw-props-panel">` ⇒ 一律写 `div#mpw-props-panel`，否则 `querySelector` 拿到的是 script 标签
     （实测：`querySelectorAll('#mpw-props-panel').length === 2`）。
   - 属性面板的布尔控件是 **Uiverse 口径**：真 `input[type=checkbox]` 被 `opacity:0 / 0×0 / absolute` 藏起来，
     可见的是父 `<label class="mpw_cb">` ⇒ **点 label**，直接 `click()` input 会卡在 "element is not visible"。
   - 视口用 `1280x800`：窄窗口（如 900px）下 `#bar` 折行后 ⚙ 按钮会落进属性面板的覆盖区（`fixed top:38px left:8px`）
     ⇒ 点不到（实测 900px 下 `page.click('#mpw-props-btn')` 因"被 `div#mpw-props-panel` 拦住"超时）。
   - 面板/句柄都是 `loadScene` **之后**才装的：等 `__mpwModuleStarted` 不够，要用 `waitForSelector('div#mpw-props-panel')`。
5. **自证会红**（`RED-IF-REVERTED`）：把你要断言的东西**故意弄坏**（改一行真源码/临时去掉一条服务路由/换个不存在的 `?id`），
   跑一遍确认它变红且退出码 1，再恢复。本文件 §2 就是这条纪律的样板；`MPW_RM_SAMPLE_ID=0000000000` 是个便宜的通用红法。
6. **要进趋势**：新指标请**复用基线快照的字段路径**（`startup.*` / `fps.*` / `frames.*` / `counts.*` /
   `switch.swapTo.ms` / `vramProxy.*`，见 `core/baseline-metrics.mjs` 的 `BASELINE_REQUIRED` 与
   `tools/baseline-diff.mjs` 的 `METRICS`）。路径已在 `METRICS` 里 ⇒ `tests/baseline-trend.mjs` **自动**给 Δ 与阈值判定；
   新路径则要在 `tools/baseline-diff.mjs` 的 `METRICS` 里加一行（阈值也集中在那里，**不要另写一份**）。
7. **加白名单**：只有当一条失败请求**真的良性**时才往 `BENIGN_404` 里加，且必须同时写 `why`（为什么良性）
   与 `evidence`（命令/测试出处）；工具会断言"每条都有理由 + 证据"。

---

## 6. 未证实 / 未做（本节不关闭）

1. **真机数字一个都没有**：本机无 GPU，`reports/baselines/` 至今为空 ⇒ 趋势表的 baseline 分组
   在本机从未被真实数据驱动过（只用**合成夹具**自测过：两份伪造快照 +25% 启动 ⇒ 打 `⚠ 退化`、`--strict` ⇒ rc=1，
   6/6 自检通过，夹具 `mkdtemp` 后已删）。**未证实**：真实 `?baseline=1` 快照在趋势表里的表现（字段名按
   `BASELINE_REQUIRED` 对齐，理论上直接可用）。
2. **音频面板 / 时间线可见性 / 磨砂注入**三条只到"如实记录缺席"，没有真断言（§4 #2/#3/#5 已说明原因）。
3. **`#fps` 数值**没断言（无 GPU 恒 `--`）；真机上它该等于 `?baseline=1` 的 `fps.median` 量级 —— **未证实**。
4. **Firefox 以外的浏览器**没验：脚本固定用 Playwright 的 `firefox`（本机只装了 firefox；`chromium-*` 目录存在但**未验证**可用）。
5. **`/demo.html` 的 404 只记录不断言**：如果哪天有人给 8899 加了这条路由，报告里的 `notes` 会变，
   但不会有断言失败（这是有意的：任务书里的 URL 不是契约）。

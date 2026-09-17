# 壁纸插件 × dsh-better-sidebar 适配（0.19.1 核查 · 2026-09-17）

> **这一篇解决什么**：`bsCompat`（「其他」tab 里的 better-sidebar 适配分类）靠两组锚点工作——
> ① 作用域属性 `[data-dsh-better-sidebar]`、② CSS Modules 类名**子串**（`[class*="_bottomPanel"]` …）。
> 类名前缀是构建期哈希、DOM 结构随版本变（0.19.0 起右列交还 DSH **原生**侧栏、旧浮窗整套删除），
> 所以"还匹配得到吗"必须**按版本**核查，而不是靠 0.16 时代的记忆。
> 本篇给出 0.19.1 的逐条锚点结论 + **两个静默失效真因**（都已在真机复现并修掉）+ 复现命令。

---

## 0. 结论摘要

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| 0.19.1 是不是最新 | 是（npm `dist-tags.latest=0.19.1`；GitHub 最高 tag `v0.19.1`，2026-09-11 发布） | §1.1 |
| 与本机 DSH 是否兼容 | 兼容：peer 下限 `@deepseek-ai/dsh-*: ^0.1.5-rc.1`，本机 `0.1.5-rc.2`；README 自述「v0.19.1 已在 0.1.5-rc.2 上完成真机挂载验证」 | §1.2 |
| 作用域锚点 `[data-dsh-better-sidebar]` 还在吗 | **还在**：0.19.1 把它设在 body 下那个挂载 host `div` 上（`src/client/index.tsx:308`），底部工作台/面板宿主层都在其子树内 ⇒ 我们所有后代选择器继续命中 | 真机 `bsRoot=1`（§2.4） |
| 面板类名子串还命中吗 | 命中：`_panel`/`_bottomPanel`/`_pane`/`_tabBar`/`_terminalWrap`/`_editorHeader`/`_browserBar` 在 0.19.1 产物里都存在（前缀换成 `nArs4W_`，子串匹配与前缀无关） | §4 |
| 有没有更稳的锚点 | 面板根新增 **`data-dsh-panel` / `data-dsh-bottom-panel`**、pane 新增 **`data-dsh-pane`** ⇒ 已改成"类名子串 + 稳定属性"**双锚点**；`tabBar/editorHeader/browserBar/terminalWrap` **没有**稳定属性（只有哈希类名），只能继续子串匹配 | §4、§5 |
| 0.19 删掉了什么 | 浮窗整套：`data-dsh-float-window`、`_floatWindow`、`_addBar`、`_addButton` 全部 0 命中（我们自己绘制的右侧面板也随之不存在） ⇒ 浮窗规则保持 `[data-mpw-bs-version^="0.16"]` 门控，0.19 自动不生效 | §4.2 |
| 发现了什么真 bug | **两个**，都是"看起来在适配、实际没适配"：① `/ping` 的 `betterSidebarVersion` **恒为 null**（局部变量遮蔽同名函数）；② 版本探测只在**设置页组件**的 effect 里跑 ⇒ 不打开插件设置页时 `body[data-mpw-bs-version]` 永远缺失 ⇒ 版本门控 CSS 一条都不生效 | §2、§3 |

**一句话**：0.19.1 上我们的 bsCompat **能**工作，但此前**两处链路都是断的**——修完这两处后，
版本门控第一次真正生效；同时把面板级规则加了 0.19 的稳定属性锚点，下次类名再换也不会静默失配。

---

## 1. 版本与安装（本次实际执行的命令与输出）

### 1.1 「最新版」的定义（两条独立证据）

```sh
npm view dsh-better-sidebar dist-tags --registry=https://registry.npmjs.org
# { beta: '0.12.0-beta.1', alpha: '0.19.0-alpha.1', latest: '0.19.1' }
git ls-remote --tags --refs https://github.com/omdsh-dev/DSH-better-sidebar   # 最高 tag：v0.19.1
```

tarball 完整性：`npm pack dsh-better-sidebar@0.19.1` 后本地算 sha512 =
`sha512-Jr0tPJoDKUVkq+fioL6Td+YwXZ+PULx3CnBJ4iktaQGNP5y9hgpz6V7o7f4Yh2czheVKZsewurqCaiN10GQYeQ==`
（3,484,248 B），与 registry 的 `dist.integrity` **逐字符相同**。

### 1.2 静态兼容性（装之前先证明"不会像 0.16.1 那样把 DSH 启动搞崩"）

| 检查 | 结果 |
| --- | --- |
| 它 import 哪些 `@deepseek-ai/*` | 只有 `dsh-settings`（`SettingsConflictError`）、`dsh-tools`、`dsh-llm`、`dsh-session`、`dsh-subagent` —— 全部在 `~/.dsh/profiles/node_modules/@deepseek-ai/` 里，版本 `0.1.5-rc.2` |
| 关键 API 是否存在 | `dsh-settings@0.1.5-rc.2` 导出 `SettingsConflictError`（`lib/index.js`），并提供 `register/describe/update/section/installSection`；插件只用 `register/describe/update`（`lib/index.js:4890/4892/4908`） |
| 可选 peer | `@huanlin/dsh-plugin-better-locale`、`@deepseek-ai/dsh-client-ui-sidebar-right` 在 `peerDependenciesMeta` 里标了 `optional: true` ⇒ 不装也能跑 |
| 模块解析 | 在 profile 目录 `import('dsh-better-sidebar/lib/index.js')` → OK（449 ms），导出 `Config/apply/inject/name`，`inject=["webServer","sessions","webRuntime","tools"]` |
| bundle 补丁合并 | `dsh --profile web --dump-config` exit 0，且相对装前**只多出** `better-sidebar` 一行（带 `!!js` 双挂载守卫） |
| 隔离真机启动 | `DSH_HOME=/tmp/dsh-probe dsh --profile web --port 36311`：启动成功（日志 0 error），`/sidebar/api` 返回 **405 method-error**（路由已挂载；未挂载会是 404） |

> ⚠️ **绝对不能顺手把 `dshmarket` 放进 bundles**：`dshmarket@1.15.0` 用了
> `installSettingsSection` / `settingsNamespace`，而 `dsh-settings@0.1.5-rc.2` **没有**这两个导出
> ⇒ 一旦进 bundles，DSH 启动即崩（2026-09-11 已踩过）。本次安装**没有**用 `dsh plugin add`
> （它会按 dependencies 重写 bundles、把 dshmarket 一起塞回去），而是手工改 `package.json` + `pnpm add`。

### 1.3 本次落地的安装形态

```jsonc
// ~/.dsh/profiles/web/package.json
"dependencies": { "dsh-better-sidebar": "0.19.1", /* …其余不变… */ },
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@openviking/dsh-memory-plugin",
  "dsh-whale-widget", "dsh-mpkg-wallpaper", "dsh-better-sidebar"   // ← 新增（追加在末尾）
] } }
```

安装命令：`pnpm add dsh-better-sidebar@0.19.1 --save-exact --registry=https://registry.npmjs.org`
（profile 全局 registry 是 npmmirror，必须显式指定 npmjs；`pnpm-workspace.yaml` 已放行 `node-pty` 构建）。

---

## 2. 真因 ①：`/ping` 的 `betterSidebarVersion` **恒为 null**（变量遮蔽）

### 2.1 现场（真机，改前）

```
GET /api/mpkg-wallpaper/ping
{"ok":true,"version":"3.7.2","betterSidebar":true,"betterSidebarVersion":null}
```

而磁盘上装的就是 0.19.1（`~/.dsh/profiles/web/node_modules/dsh-better-sidebar/package.json`）。
`betterSidebar:true` 却 `version:null` —— 说明"检测到装了"是好的，"版本"这条链路断了。

### 2.2 真因（`lib/index.js`）

```js
let betterSidebarVersion = null;
try { betterSidebarVersion = betterSidebarVersion(); } catch { /* 忽略 */ }   // ← 左侧局部变量把右侧同名函数遮蔽
```

`let` 声明的局部变量与模块级函数同名 ⇒ 右侧调用的是**局部变量 `null`** ⇒ `TypeError` 被空 `catch` 吞掉
⇒ 字段恒为 `null`。**误导性**在于：外层还有 `try/catch`（"扫描不到返回 null，不报错"是设计意图），
所以 null 看起来像"没扫到"，而不是"代码写错了"。

> 同一症状（`betterSidebarVersion` 恒 null ⇒ 版本门控 CSS 全失效）在 2026-09-14 修过一次，
> 那次真因是 `dshHomeDir()` 少一层 `.dsh`（`lib/index.js:52-56` 注释保留）。本次是**第二个**真因，
> 所以这次不再满足于"改对"，而是补了会**变红**的回归用例。

### 2.3 修法

函数改名 `detectBetterSidebarVersion()`（`lib/index.js:80`），局部变量保持与 JSON 字段同名
⇒ 二者不可能再撞名；两处都留了"曾经这么错过"的注释，防止后来者改回去。

### 2.4 验证（改后，同一实例）

```
GET /api/mpkg-wallpaper/ping
{"ok":true,"version":"3.7.2","betterSidebar":true,"betterSidebarVersion":"0.19.1"}
```

回归门禁 `tools/better-sidebar-compat-test.mjs`（已接入 `tools/check.sh` 第 10 步）：

* A 组：起一个"装了 0.19.1 的假 DSH_HOME"→ 真 `apply()` → 调 `/ping` ⇒ 必须 `=== 0.19.1`；
  另起一个"没装"的 DSH_HOME ⇒ 必须 `null`（不臆造版本）。
* **B 组（变异用例）**：把函数名改回与局部变量同名（复活真因）再跑同一断言 ⇒ 必须回到 `null`。
  这条保证用例**有分辨力**，而不是"碰巧绿"。

---

## 3. 真因 ②：版本探测只在**设置页**跑 ⇒ 页面加载期没有版本属性

### 3.1 现场（真机，改前）

无头 Firefox 加载真实页面（探针实例，装的就是 0.19.1）：

```
body[data-mpw-bs-version] = null      (body 上的 mpw 属性: data-mpw-rail-ink data-mpw-rsblur)
我们的 <style>: 1 / 共 116  | bsCompat 作用域写法=false 版本门控=false _bottomPanel 规则=false
```

`data-mpw-bs-version` 缺失 ⇒ **所有** `[data-mpw-bs-version^="…"]` 门控规则一条都不生效。

### 3.2 真因（`lib/client.js`）

版本探测的 `/ping` 调用写在 `settings.section`（设置页组件）的 `useEffect` 里（原 `:8329` 起）——
用户不打开插件设置页，这个 effect 就永远不跑。也就是说："按版本自适应适配"这个能力，
**只在用户恰好打开过插件设置页之后**才存在。

**可见影响（诚实说明）**：目前版本门控只用在 0.16+ 浮窗规则上，所以此 bug 的实际后果是
"在 0.16/0.17/0.18 上，没打开过设置页时浮窗透出规则不生效"；0.19 浮窗已删除，因此 0.19 上无可见差异。
**但它让"版本自适应"这个机制形同虚设**——任何未来新增的版本门控都会静默失效，所以必须修。

### 3.3 修法

新增 `refreshBetterSidebarVersion()`（`lib/client.js:242-270`）：`/ping` → `applyBetterSidebarVersion()`
（写/删 `body[data-mpw-bs-version]`），并把它接到 **apply 启动路径**（与 `initHostSettings()` 同批，
`lib/client.js:12619` 附近）；自带 5 s 去抖（apply 在 RTC 重连/热重注入时会重跑，避免重复请求）。
设置页里原来那次保留（打开设置页时刷新版本号显示）。

### 3.4 验证（改后，同一实例）

```
body[data-mpw-bs-version] = "0.19.1"   (body 上的 mpw 属性: data-mpw-bs-version data-mpw-rail-ink data-mpw-rsblur)
宿主 /ping = {"ok":true,…, "betterSidebarVersion":"0.19.1"}
我们的 <style>: 1 / 共 116  | bsCompat 作用域写法=true 版本门控=true _bottomPanel 规则=true
```

桩 DOM 侧也进了门禁（`_stub.mjs` 的属性表从"空实现"改成真语义）：
`loadPlugin()` 跑完 `apply()` 后 `body[data-mpw-bs-version]` 必须等于 `/ping` 报的版本；`betterSidebar:false` 时必须缺失。

---

## 4. 0.19.1 的 DOM 契约（逐条证据）

> 完整逐行报告（`file:line` 逐条）：`docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md`（子代理审计产出，138 行）。
> 基准路径：解包后的 `/tmp/dsb-0191/package/`（npm tarball，sha512 已校验，见 §1.1）。

### 4.1 我们依赖的锚点（0.19.1 仍存在）

| 锚点 | 0.19.1 上的位置 | 证据 |
| --- | --- | --- |
| `[data-dsh-better-sidebar]` | body 下的**挂载 host** `div`（整个 `Sidebar` React 树挂在里面） | `src/client/index.tsx:307-309`；产物 `lib/client.js` 里 `setAttribute("data-dsh-better-sidebar","")` |
| `[data-dsh-panel]` + `[data-dsh-bottom-panel]` | 底部工作台**面板根** `div`（与类名 `nArs4W_bottomPanel` 同一个元素） | `Sidebar.tsx:726-746`（`:729`/`:730`） |
| `[data-dsh-pane]`（值 = pane id） | split-pane 叶子根 `div`（与类名 `nArs4W_pane` 同一个元素） | `split-pane.tsx:174-176` |
| `[class*="_bottomPanel"]` | 同上（CSS Modules 前缀 0.19 为 `nArs4W_`，子串匹配不受前缀影响） | 产物内联样式表 + 类名映射表 |
| `[class*="_tabBar"]` / `_pane` / `_editorHeader` / `_browserBar` / `_terminalWrap` | 各自组件根（**没有** data-* 属性，只有哈希类名） | `TabBar.tsx:164-165`、`EditorHost.tsx:412`、`BrowserView.tsx:166`、`TerminalView.tsx:410` |
| `.xterm` | 终端内部（`:global(.xterm)`，编译成 `.nArs4W_terminal .xterm`） | `sidebar.module.css:1885` |

产物里各锚点的原始命中数（`lib/*.js` 全文计数）：`data-dsh-better-sidebar` ×8、`_bottomPanel` ×50、
`_pane` ×114、`_tabBar` ×55、`_terminalWrap` ×10、`_editorHeader` ×10、`_browserBar` ×10。
（数字偏大是因为：每个类名至少出现两次——类名映射表 + 内联样式表；且 5 个客户端 chunk 各自内联一份 CSS。）

### 4.2 0.19.0 删除的东西（我们**不能**再依赖）

`data-dsh-float-window` ×0、`_floatWindow` ×0、`_addBar` ×0、`_addButton` ×0；
旧右侧面板类 `css.panel` 在产物里已无任何 JS 访问（只剩一条死选择器）。
删除记录：插件 README `README.md:325`（v0.19.0-alpha.0「删除自绘右侧面板 + 浮窗 API」）、摘要 `README.md:4`。

⇒ 我们的浮窗规则（`[data-mpw-bs-version^="0.16"] … [data-dsh-float-window]`）在 0.19 上**匹配不到任何元素**，
这是**正确**行为（旧版本仍需要它）；`_addBar/_addButton` 规则同样只是为 ≤0.18 保留，无害。

### 4.3 一个**不要碰**的锚点

`[data-dsh-panel-host]` 是一个 **fixed + 全屏**的宿主层（真机实测：`position:fixed`、`z-index:25`、
`1292×810` 铺满视口、背景透明）。**不要给它加背景/模糊规则**——那会整屏染色。
它内部还有 `data-dsh-panel-host-degraded`（degraded 模式标记）与一个 rAF 变换校正循环（`index.tsx:276-300`）。

---

## 5. 锚点策略：为什么"类名子串 + 稳定属性"双锚点

* 面板级规则（圆角/边距/背景透明/透出/Aqua/深色主题）：**同时**挂 `[class*="_bottomPanel"]` 与
  `[data-dsh-bottom-panel]`；pane 级同时挂 `[class*="_pane"]:not([class*="_panel"])` 与 `[data-dsh-pane]`。
  今天两者命中同一元素（无行为变化），但类名前缀 0.16→0.19 已经换过一次 ⇒ 属性锚点是"下次换名不失效"的保险。
* tab 栏 / 编辑头 / 浏览器栏 / 终端壳：**该版本没有稳定属性**，只能继续子串匹配（这是唯一可行解，不是偷懒）。
* 门禁 `tools/better-sidebar-compat-test.mjs` E 组会在**已装版本**上做锚点金丝雀：任何一个必需锚点
  在该版本产物里消失 ⇒ 直接判红，并提示更新本文档与选择器（未安装则打印 SKIP，不算失败）。

---

## 6. 复现与证据（命令清单）

```sh
# 0) 前提：一个跑着 better-sidebar 的 DSH 页面（本机 3080，或探针实例见下）
cd /root/Desktop/DSHarea/dsh-mpkg-wallpaper

# 1) 真机 DOM 探针（无头 Firefox；只读页面 + 可选合成锚点）
node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:3080 --out /tmp/ffprobe/cookie.json
node tools/bs-compat-probe.mjs --label after --cookie /tmp/ffprobe/cookie.json \
  --settings '{"enabled":true,"bsCompat":true,"bsFloat":true,"bsReveal":true,"bsAlpha":true}' --synthetic
#   → tools/probe-out/bs-compat-<label>.{json,txt}

# 2) 隔离探针实例（不碰用户正在用的 3080；独立 DSH_HOME）
cp -r ~/.dsh/profiles/web /tmp/dsh-probe/profiles/web    # 或按 §1.3 造一个最小 profile
DSH_HOME=/tmp/dsh-probe dsh --profile web --port 36311 --no-open

# 3) 门禁里的自动化那一半
node tools/better-sidebar-compat-test.mjs      # 28 断言（含变异 + 金丝雀）
```

**本次实测的合成锚点绑定结果**（0.19.1 真页面，`--synthetic`；插入后即删）：

| 合成元素 | 用到的锚点 | 我们规则算出的 computed 值 |
| --- | --- | --- |
| 面板（类名） `nArs4W_bottomPanel` | `[class*="_bottomPanel"]` | `radius 14px`、`margin 0 8px 8px`、`overflow hidden`、`bg color(srgb 1 1 1 / 0.68)` |
| 面板（纯属性）`data-dsh-bottom-panel` | `[data-dsh-bottom-panel]` | 同上（**加固锚点确实生效**） |
| tabBar（类名）`nArs4W_tabBar` | `[class*="_tabBar"]` | `bg color(srgb 1 1 1 / 0.52)` |
| pane（类名）`nArs4W_paneBody` | `[class*="_pane"]` | `bg color(srgb 1 1 1 / 0.52)` |
| pane（纯属性）`data-dsh-pane` | `[data-dsh-pane]` | 同上 |

**边界（说清楚没测到什么）**：探针 profile 里没有会话/没打开底部工作台，所以**真实**的
`[data-dsh-bottom-panel]` 元素不在 DOM 里（探针计数 `bottomPanel=0`）——上表用的是"0.19.1 真实类名/属性 +
真实宿主 CSS + 真实我们的 CSS"的合成元素。真实面板打开后的像素级观感仍需要在**有 GPU 的机器**上由用户确认。

---

## 7. 相关文件

| 文件 | 作用 |
| --- | --- |
| `lib/index.js:80` | `detectBetterSidebarVersion()`（改名后；`/ping` 的版本来源） |
| `lib/client.js:242-270` | `applyBetterSidebarVersion` + `refreshBetterSidebarVersion`（页面加载期探测） |
| `lib/client.js:7519-7660` | bsCompat CSS 块（作用域 + 双锚点 + 版本门控） |
| `tools/better-sidebar-compat-test.mjs` | 门禁第 10 步：28 断言（含变异用例与锚点金丝雀） |
| `tools/bs-compat-probe.mjs` | 真机 DOM 探针（计数 + 合成锚点绑定 + `/ping` 应答） |
| `tools/_stub.mjs` | 桩 DOM 属性表（真语义 set/get/remove/has，支撑"结果落点"断言） |
| `docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md` | 0.19.1 的逐行 DOM 契约审计（附录） |

# WE 自带壁纸选项面板（user properties）—— 修复与边界登记

> 用户 bug（2026-09-24）原话：「壁纸配置里面 we 自带的选项，它是打不开的……他这里只显示了有一项，
> 而且展不开。这个 bug 赶紧修一下，他那个自带的一些设置，是针对每一个壁纸都有的」
> 判据：`tools/props-panel-wiring-test.mjs`（已登记进 `tools/check.sh` 第 2 步）。

## 1. 根因（file:line + 证据）

| 现象 | 代码位置 | 事实 |
|---|---|---|
| 「只显示了有一项」 | `lib/client.js` 旧 `propsToShow = propsExpanded ? propsShown : []`（④(重做) 注释块） | 参数区**默认折叠** ⇒ 折叠态整个列表不渲染，只剩**一个**「展开全部（N）」按钮 |
| 「展不开 / 打不开」 | 旧渲染分支（`mpw_prop` 行只给 `span.mpw_propValue`） | 展开后也只是**只读文本行**；标题恒为「可调参数（暂不可用）」，`props.desc` 明说"修改参数不会改变画面" |
| 每张壁纸自带的选项应逐项可调 | 旧 `setProp()`（定义在 `propEdits` 之后） | **0 处调用的死代码** —— 写 `propEdits` + 下发 shim 的通道早就写好，从未接线 |
| 分组丢失 | 旧 `extractProjectInfo` 字段表 | 只留 `{key,label,value,type,options,displayOnly,important}`：`group` 被当普通行、无分组头/无折叠 |
| 条件显示丢失 | 同上 | `condition` **完全没有提取**（真包语料 `3509243656` 有 4 条带字段、2 条非空；`3195212886` 也有） |
| 控件量程丢失 | 同上 | `min/max/step/precision` 未提取 ⇒ 想渲染滑杆也没有量程 |

真包语料统计（`<DSHAREA>/allwallpaper/**`，70 个 `project.json`；本机工作区根按脚本自身位置推导，
仓库里不写绝对路径 —— 与 `docs/SETTINGS-PERSIST.md` 同一口径）：
`slider 890 / bool 825 / color 410 / text 222 / combo 177 / group 124 / textinput 99 / scenetexture 86 /
usershortcut 61 / 无 type 102`。渲染器侧同名面板（`we-scene-demo` 的 MPW-PROPS-PANEL + `propsPanelModel`，
**只读参考行为口径、未复制代码**）这些能力都有；插件侧一条都没有 ⇒ 两边口径差 = 本 bug。

## 2. 修法（`lib/client.js`）

1. `extractProjectInfo`：**逐字段保留** `group / condition / min / max / step / precision / order / index`；
   不再丢弃"没有 text 的条目"（旧 `if (!label) continue` 会把分组头一起吞掉 ⇒ 子项失去归属）。
2. 新增 `MPW-PROPS-MODEL` 纯函数块（无 DOM，Node 可跑）：
   `mpwPropSorted` / `mpwPropKind` / `mpwPropCondEval`（白名单递归下降，**绝不 eval**）/ `mpwPropsModel` /
   `mpwPropColorToHex` / `mpwPropHexToColor`。
   - 分组头 = `type:"group"`；子项 = 其后（官方 `order` 排序）直到下一个分组，`group` 字段显式指认优先；
   - `condition` 支持 `x.value` / `!x.value` / `==` `!=` / `&&` `||` / 括号 / 字面量，含**传递闭包**
     （condition 引用的属性本身被门控 ⇒ 本项一并隐藏）；
   - 白名单外或引用缺失 ⇒ **未知**：一律照显示（宁多显示不误藏）并计入 `counts.condUnknown`；
   - `schemecolor`（属性名，编辑器配色）/ `usershortcut` / 无 type 且无文案 ⇒ **不渲染但逐条记账**（`kindWhy`）。
3. 面板渲染：**默认展开**；分组头是可折叠按钮（`data-mpw-propgroup`，带子项数）；每项渲染真控件 ——
   bool→`Toggle`、slider→`input[type=range]`（用包内 `min/max/step`，拖动即时显示 + 350ms 防抖落盘，与
   插件既有滑杆同一口径）、combo→`SelectBox`、color→取色器（官方是线性 `"r g b"` 0..1，取色器用 #rrggbb 中转）、
   textinput→文本框（失焦/回车落盘）；`file/directory/scenetexture` **只读 + 写明原因**（见 §3）。
   `onChange` 一律走 `setProp()` ⇒ 写 `propEdits`（localStorage + 宿主）+ 下发给**已挂载的帧**：
   网页壁纸走 shim 的 `{op:"props"}`（同源），**场景渲染器帧走 `{type:"mpw-user-props"}`**（跨源，
   见 §3 第 1 条 / 渲染器仓 `docs/PATCHES.md` P-203）。
4. `props.desc` 文案改成如实描述（原文案说"请在壁纸引擎 App 中调整"，与可调控件矛盾）。
5. 「重置壁纸参数」顺带清空控件本地草稿（否则重置后滑杆仍显示旧值）。

## 3. 接线边界（如实登记，不静默）

| 条目 | 能否接 | 原因 / 需要的前置 |
|---|---|---|
| 场景渲染器（`webloader`）的 **props 下发通道** | **✅ 已接线（P-203，2026-09-25）** | 协议：宿主 → 帧 `postMessage({type:"mpw-user-props", props:{名:{value}\|名:裸值}, why})`；帧 → 宿主**回执** `{type:"mpw-props-applied", keys,count,ok,dest,via,why}`。渲染器侧（`we-scene-demo/demo.html` 的 P-203 块）收到就写 `window.__mpwUserProps` 并走**面板同一条应用链**（`applyUserProperties` + `applyScriptProps` + 脚本缓存复位 + 时段重算），只认父页/自己，空表**零改动但照样回执**。插件侧 `sendRendererSceneProps(frame, props, why, force)`（`lib/client.js`，与 `sendRendererAudioPolicy` 同款）：跨源唯一可达、**幂等**（同帧同载荷不重发）、**帧重载后即使值没变也重发**；触发点 = `setProp()` / 场景帧 `onload` 与同 URL 重入（挂载·重载·刷新·应用壁纸，`mpwScenePropsAfterMount` 推 `propEdits` 整表）/「重置壁纸参数」（把作者默认值推回去）。回执 `ok:false`（渲染器面板还没装载 / 包没有属性表）⇒ 保留待发 + 退避重试（1.5s × 上限 10），上限到了记 `exhausted`，**不假装成功**；帧不在/没改动 ⇒ 记 `window.__mpwRendererPropsPush.skipped` + 原因。**回退口**：设置项 `sceneDebugParams` 里写 `proppush=legacy`（该键已进 `MPW_SCENE_DEBUG_KEYS` ⇒ 同一旗标也会被带进渲染器帧 URL，**两端一起关**）。判据 `tools/scene-props-push-test.mjs`（见 §4）。⚠ **未验证**：真机两端实挂（3080 真页面 + 8902 真帧 + 真 mpkg 包）的端到端画面变化**没量过** —— 判据全是离线切片 |
| 渲染器侧的**会话内 vs 落盘**归属 | 已定 | 插件推的是**改动表（增量）**，不推作者默认整表 ⇒ 不会顶掉渲染器面板自己写在 `localStorage['mpw-props:<id>']` 的改动；两边都改同一个键时**后到者生效**（未做真机 A/B） |
| `file` / `directory` / `scenetexture` 类属性 | **暂不能接（只读展示）** | 需要渲染器侧资源通道（把用户选的文件送进场景），官方语义未在插件侧实现 ⇒ **不猜**，行上写明"插件侧未接线" |
| `usershortcut` | **不接** | 官方语义未实现（快捷键注册），与"不猜"口径一致，逐条登记 |
| `schemecolor` | **不渲染** | 编辑器配色，官方用户面板不显示（记账保留） |

真机现状备注：用户当前生效壁纸 `小鸟游星野01_04.mpkg`（`~/.dsh-mpkg-wallpaper/settings.json`，只读）
是 **video 类**包，包内 `project.json` 只有 `{file,preview,title,type:"video"}`、**没有 `general`** ⇒
`allProps.length === 0`，插件侧参数区**整块不渲染**（无可显示项，属如实行为）。用户看到的「WE 自带选项」
若来自该壁纸，则对应的是 WE 客户端的通用视频选项，而不是包内 user properties（包里确实没有）。

## 4. 判据读数

### 4.1 面板本身（`tools/props-panel-wiring-test.mjs`）

`node tools/props-panel-wiring-test.mjs`（离线 / 桩 React / 真包语料 `3509243656`）：

- **基线 18 / 18 通过**，总计 `通过 96 / 失败 0`（含 5 组变异自证）；
  代表性读数：真包 233 条属性全量提取、21 个分组头、`A2b` 模型 `controls=181 / notes=29 / readonly=1 /
  skipped=1 / hidden=1`；面板**默认展开 10 行**（合成表，期望 10）、点分组头 `10 → 1`、
  控件 `开关1 / range3 / color1 / text1 / combo1`、点开关落盘 `{"b1":true}`、滑杆落盘 `s1=7`、
  端到端联动（关掉 controller ⇒ 被门控项消失）。
- **变异必红（改回去必红）**：
  | 变异 | 改法 | 必红判据 |
  |---|---|---|
  | M1 | `propsExpanded` 初值改回 `false` | B1/B2/B2b |
  | M2 | bool 控件改回 `span.mpw_propValue` 只读行 | B3/B4 |
  | M3 | `extractProjectInfo` 丢掉 `group`/`condition` | A1c/A4b/A2b |
  | M4 | `setProp` 换成空实现（不写 propEdits） | B4/B4b |
  | M5 | 分组头退化成普通行（去掉 `data-mpw-propgroup`） | B2/B2b/B5 |

### 4.2 场景帧下发通道（`tools/scene-props-push-test.mjs`，P-203）

`node tools/scene-props-push-test.mjs` —— **73 通过 / 0 失败**（离线桩，真源码切片 + `new Function` 驱动）：

- A 源码口径 15 条：op/回执名、`setProp` 场景帧分支（且 web-shim 那条**没被动过**）、`frame.onload`
  （`mpwScenePropsAfterMount(frame, true)`）与同 URL 重入（不带 `fresh`）两个挂载点、恢复默认推作者默认、
  回执监听只装一次且只认自己那个帧、回退口两处（`sceneDebugParams` + `MPW_SCENE_DEBUG_KEYS`）、
  重试有上限、台账字段齐。
- B 行为：`setProp` 形状 ⇒ 发出 op 且载荷形状 `{名:{value}}`（裸值/`{value}` 归一一致）；帧元素被换
  （`contentWindow` 换了）⇒ 值没变也重发；**`onload`（`force:"fresh"`）⇒ 同帧同值也无条件重发**
  ——"刷新"必须靠 `load` 事件判：帧元素上的 expando 跨导航保留，而 WindowProxy 的身份在导航前后
  **可能是同一个**；同 URL 重入（没有新文档）⇒ 依旧幂等；同帧同值 ⇒ 不重发（含"已确认"与"未生效要补发"两档）；
  退避重试到上限 ⇒ 停发 + `exhausted` + **不留常驻定时器**；回执只认自己那个帧/那个 type；
  `proppush=legacy` ⇒ 零 postMessage；帧不在 / 空表 ⇒ `posted:false` + `reason`。
- C 挂载路径：`propEdits` 整表推一次 / 没有改动**一个字节都不发** / 网页壁纸帧不发 / 按 `mpkgKey` 取当前壁纸。
- **D 变异必红（8 组）**：D1 删 `setProp` 场景帧调用（A2 红）/ D2 `stale` 不看 `contentWindow`（B2 红）/
  D2b `fresh` 失效 ⇒ 刷新后同值不重发（B2b 红）/ D3 去幂等（B3 红）/ D4 回退口失效（B6 红）/
  D5 回执没生效不保留待发（B3d 红）/ D6 删 `frame.onload` 触发点（A3 红）/ D7 删"回执没生效 ⇒ 排重试"（B4 红）。
  每个变异锚点还断言**唯一**（`const stale = …` 在音频策略通道里也有一份 ⇒ 锚点不唯一就会打在别处、判据假绿，实测踩过）。
- **未验证**：真机（3080 真页面 + 8902 真渲染器帧 + 真 mpkg 包）端到端"改一项 ⇒ 画面当帧变"**没有量过**；
  回执驱动的重试窗口（1.5s × 10 ≈ 15s）也没在真机慢装载包上标定过。

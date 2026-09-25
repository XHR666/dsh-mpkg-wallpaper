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
   `onChange` 一律走 `setProp()` ⇒ 写 `propEdits`（localStorage + 宿主）+ 下发给已挂载的 web-shim 帧。
4. `props.desc` 文案改成如实描述（原文案说"请在壁纸引擎 App 中调整"，与可调控件矛盾）。
5. 「重置壁纸参数」顺带清空控件本地草稿（否则重置后滑杆仍显示旧值）。

## 3. 未接线边界（如实登记，不静默）

| 条目 | 能否接 | 原因 / 需要的前置 |
|---|---|---|
| 场景渲染器（`webloader`）的 **props 下发通道** | **暂不能接** | 插件侧目前只有 web-shim 帧的 `{op:"props"}` 通道；渲染器 URL 构造（`sceneRendererUrl` 一带）**没有任何 `props=` 参数**，也没有场景级 postMessage 契约。⇒ 场景/预渲染壁纸的 `propEdits` 目前**只持久化**，画面要等下次应用（或由渲染器侧面板自行应用）。前置：渲染器提供"挂载时接收属性表 / 运行期增量"的通道（URL `?props=` 或 postMessage op），并给出契约测试 |
| `file` / `directory` / `scenetexture` 类属性 | **暂不能接（只读展示）** | 需要渲染器侧资源通道（把用户选的文件送进场景），官方语义未在插件侧实现 ⇒ **不猜**，行上写明"插件侧未接线" |
| `usershortcut` | **不接** | 官方语义未实现（快捷键注册），与"不猜"口径一致，逐条登记 |
| `schemecolor` | **不渲染** | 编辑器配色，官方用户面板不显示（记账保留） |

真机现状备注：用户当前生效壁纸 `小鸟游星野01_04.mpkg`（`~/.dsh-mpkg-wallpaper/settings.json`，只读）
是 **video 类**包，包内 `project.json` 只有 `{file,preview,title,type:"video"}`、**没有 `general`** ⇒
`allProps.length === 0`，插件侧参数区**整块不渲染**（无可显示项，属如实行为）。用户看到的「WE 自带选项」
若来自该壁纸，则对应的是 WE 客户端的通用视频选项，而不是包内 user properties（包里确实没有）。

## 4. 判据读数

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

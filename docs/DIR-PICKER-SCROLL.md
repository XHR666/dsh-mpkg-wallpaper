# DIR-PICKER-SCROLL —— 选择文件夹 / 选择文件「自动跳顶 / 锁定在最顶」的根因、修法与行为契约

> 适用范围：`dsh-mpkg-wallpaper`（MIT）的设置面板选择器（「背景来源 → 自定义目录 → 浏览…」弹窗、
> 本地壁纸库列表、轮播勾选网格、下拉列表）。撰写日期：**2026-09-17**。
> 对应回归门禁：`tools/dir-picker-test.mjs`（已并入 `tools/check.sh` 第 2 步）。
> 测试台（`vendor-ref/ww-pages/` 的 8901/8902 页面）线的对齐口径见 §5。

---

## 0. 用户原话（第 13 条）

> 「在这个静态页面（8901），包括我说的 8902，这两个页面，壁纸库的选择文件夹的功能，去引用我的上游的
> DSH 插件那样同款的选择文件夹的功能，包括选择文件也是的。但是我这里提醒一个 bug，在 DSH 的插件里
> 一直没修好的一个 bug：**就是在选择文件夹的这个功能里面，鼠标上下滑动的时候，画面有时候会自动弹跳到
> 最顶上，包括有时候会自动锁定到最顶上**。这个 bug 你一直没有修好……」

---

## 1. 结论（一屏先看）

**根因不是某一行的笔误，而是「滚动位置没有任何人负责」+ 三次补救式补偿的叠加。**
逐条判据如下（全部可在本机复跑）：

| # | 结论 | 判据 / 证据 | 与用户症状的对应 |
|---|---|---|---|
| **RC-1** | **旧代码里那段"事后补偿"是死代码，一行都没执行过** | `git show HEAD:lib/client.js`：`6447` 声明 `dirScrollRef`（注释写明是 `{anchorIdx, anchorOff}`）；**唯一**赋值点在 `6877`：`dirScrollRef.current = { anchorIdx, anchorOff, rows: rows.length }` —— **从不写 `ratio`**；而 `6906-6907` 是 `const ratio = dirScrollRef.current && dirScrollRef.current.ratio; if (ratio === void 0 \|\| ratio === null) return;` ⇒ **恒真早退** ⇒ 其后的锚点补偿（`6919 el.scrollTop += …`）与按比例恢复（`6923 el.scrollTop = Math.round(ratio*max)`）**永不可达** | 「滚动位置没人管」⇒ 只要列表被重建一次，位置就丢（跳到最顶）；用户报的"一直没修好"正是因为修的是死代码 |
| **RC-2** | **列表容器会被 React 重建 ⇒ 新节点 `scrollTop` 天然 = 0** | ① 目录行的 key 是**裸目录名**（`HEAD:10258 key: sd`），内容变化时行会被错位复用；② 选择器弹窗元素在宿主侧那个**无 key 的巨型 children 数组**里（`HEAD:10197 dirPick ? h(MaskPortal …)`），兄弟条件项增删会让 React 按**下标**重新对齐；任何一处让该节点被换掉，新 `div` 的 `scrollTop` 就是 0 ⇒ 用户看到「弹跳到最顶上」；③ 实测对照见 §3-B（同一模型下旧写法 `178 → 0`，新写法保持 178） | 「有时候会自动弹跳到最顶上」（"有时候"= 取决于那一刻有没有兄弟节点/内容变化） |
| **RC-3** | **补救式补偿与用户滚动互相打架 ⇒ 表现为「锁定在最顶」** | 旧实现给补偿包了两道时间窗：`HEAD:6898`（用户 600ms 内滚过就放弃恢复）+ `HEAD:6900-6901`（同路径只恢复一次）；还监听 `wheel/touchmove/scroll` 打时间戳。这类"猜用户在不在滚"的补丁本身就是打架的证据：一旦它真的执行（例如 `ratio` 将来被写上），`el.scrollTop += …` 会在用户滚动中途把位置**写回**旧锚点 | 「有时候会自动锁定到最顶上」（补偿把位置写回 / 与滚动手势抢同一个滚动容器） |
| **RC-4** | **列表没有 `overscroll-behavior: contain` ⇒ 滚轮到边界串联给宿主设置面板** | 旧实现内联样式只有 `{ maxHeight: 240, overflowY: "auto" }`（`HEAD:10264`），整个文件里只有一处 `overscroll-behavior-x: contain`（且是聊天总览区）。列表滑到底后剩余滚轮量交给宿主面板 ⇒「画面」（面板）跟着跳 | 「画面会自动弹跳」的第二个来源（列表本身没动，动的是它背后的面板） |

| **RC-5** | **宿主重渲染会把选择器弹窗整棵子树重新挂载 ⇒ 位置归零**（2026-09-17 真机探针定案） | 真机探针（`tools/dir-picker-probe.mjs`，真实 GUI + 真实无头 Firefox）实测：一次普通面板状态变化（给面板输入框派发 `input`）就会在**同一毫秒**产生 `.mpw_mask` 的 `removed` + `added` —— 弹窗（含列表容器）被整棵重建；旧实现下 `scrollTop 1000 → 0`（正是用户报的"跳回最顶"）。**只把补偿逻辑修好还不够**：滚动记忆若存在"组件实例内"，重挂时实例被卸载 ⇒ 记忆一起丢 ⇒ 恢复逻辑拿到空记忆只能认领 0。**修法：记忆放模块级（活得比 React 树长）** | 「鼠标上下滑动的时候，画面有时候会自动弹跳到最顶上」——"有时候"= 那一刻恰好有面板状态变化（异步探测/提示/进度等都会触发重挂）；"锁定在最顶上"= 每次重渲染都把它按回 0 |

**已排除 / 已按契约显式规避**（用户列的候选里，这两条在本插件不成立，门禁里仍然断言住，防将来回归）：

| 候选 | 判定 | 证据 |
|---|---|---|
| 新节点 `focus()` / `autoFocus` 把容器滚到该节点 | **旧实现不成立、新实现按契约显式规避** | 旧实现：注释剥离后**没有任何 `.focus(` / `autoFocus`**（A5）。新实现按测试台 §10.5：打开时**只**聚焦列表容器一次且 `focus({preventScroll:true})`（A9/B3b），行 `tabindex="-1"` + 行容器 `mousedown` 阻止默认聚焦（A8/B3f）⇒ 任何行都不会成为 `activeElement`，键盘移动也不聚焦行（B3d），因此**不存在**"焦点把某行滚进视野"这条路径 |
| 滚动事件里自己写了 `scrollTop = 0` | **不成立** | 旧实现里唯一写 `scrollTop` 的是死代码 RC-1 那两行；新实现**滚动路径只写 ref**（B6：滚动不产生 setState；B8c：不存在把列表写回 0 的写入） |
| 注入样式改变了滚动容器（`overflow`/`contain`/`position`） | **部分成立，已纳入修法** | `.mpw_props` 原本已有 `overflow-anchor: none`（2026-09 那条"锚定跳顶"补丁），但**缺** `overscroll-behavior`；`.mpw_tabRow` 的 `transform/will-change` 只影响 fixed 包含块（弹窗已 portal 到 `body`，不受影响） |

---

## 2. 候选根因逐条验证过程（怎么判的）

1. **重建整个列表 ⇒ 滚动位置丢失**：成立。目录列表每次 `setDirSubs(新数组)` 都会让 React 重跑
   `.mpw_props` 的子树；行 key 是裸目录名 ⇒ 目录改名/内容变化时按 key 错位复用；容器本身在被
   宿主数组下标顺移换掉时是**新节点**。新节点的 `scrollTop` 天然是 0，且旧实现**没有任何机制**把它补回来（RC-1）。
2. **新节点 `focus()` ⇒ 浏览器把容器滚到该节点**：不成立（无 focus 调用；见 §1 排除表）。
3. **滚动事件里 `scrollTop = 0` / 回收顶部**：不成立（无该写入）；但**存在同类**：`el.scrollTop += …`
   的"锚点补偿"（死代码）与"按 ratio 恢复"（死代码）——修法是**整段删除**，而不是修好它。
4. **虚拟列表 / 过滤后 key 变化导致行复用错位**：成立（key = 裸目录名）。修法：行 key 改为
   **完整路径 + `\u0000` + 目录名**，并在门禁里断言"刷新后行节点 uid 不变"（增量更新）。
5. **注入样式改变滚动容器**：部分成立。修法：容器自带 `overscroll-behavior: contain` +
   `overflow-anchor: none`（两者都在**内联样式**上，不依赖注入的 `<style>` 是否生效）。

---

## 3. 改前 / 改后实测（判据式）

### A 组：源码级断言（同一套断言跑两个版本）

```
node tools/dir-picker-test.mjs                              # 当前实现 ⇒ 57 通过 / 0 失败（rc=0）
node tools/dir-picker-test.mjs --client /tmp/head-client.js  # git HEAD 旧实现 ⇒ 4 通过 / 10 失败（rc=1）
```

旧实现变红的 9 条 A 组断言（**这就是"改回旧写法要变红"的证明**）：

```
✗ 滚动位置有人负责（按 key 记忆 + useLayoutEffect 绘制前同步写回）      [A1]
✗ 旧的补救式补偿已删除（锚点补偿 scrollTop += / ratio 恢复 / 600ms 时间窗） [A2]
✗ 滚动主权容器三件套（onScroll 只写 ref + overscroll-behavior:contain + overflow-anchor:none）[A3]
✗ 键盘导航（listbox + tabIndex + aria-activedescendant + ↑↓/Home/End/Enter/Esc）[A4]
✗ 行 tabindex=-1 + 行容器 mousedown 阻止默认聚焦（§10.5）              [A8]
✗ 弹窗打开时聚焦容器一次（preventScroll:true）                          [A9]
✗ 锚点值只认"有限 number"（null/""/NaN ⇒ 无锚点、夹住不回 0）           [A10]
✗ 弹窗元素有稳定 key（防宿主无 key 兄弟数组下标顺移重建节点）           [A6]
✗ 目录行 key = 完整路径 + 目录名（不是裸目录名）                        [A7]
✗ B 组可运行（lib/client.js 里有 MPW-DIRPICK 切片标记）                —— 整块选择器不存在
```

### B 组：假 DOM + 迷你 React（跑生产实现的切片）关键三条

| 断言 | 旧写法 | 新写法 |
|---|---|---|
| 容器被 React 重建（新节点）后位置 | **178 → 0**（"弹跳到最顶上"） | **保持 178**（绘制前同步写回） |
| 列表滑到底后滚轮是否带动宿主面板 | 会（无 `overscroll-behavior`） | 不会（`contain`） |
| 刷新后行是否整表重建 | 行 key 错位复用 | 逐行 uid 不变（增量更新） |

### C 组：真机无头 Firefox A/B（`tools/dir-picker-probe.mjs`，2026-09-17 实跑，一次启动内完成）

真实 GUI（`http://127.0.0.1:3080/`）→ 设置 → 壁纸引擎背景 → 浏览…，把自定义目录切到
`/root/Desktop/DSHarea`（30 个子目录、`scrollHeight 1510 / clientHeight 256`），注入
`Element.prototype.scrollTop` setter 钩子 + `.mpw_mask/.mpw_props` MutationObserver + `focusin` 监听：

| 观测量 | 旧实现（before，profile 里已安装副本 md5 `6177a538…`） | 新实现（after，`update-plugin.sh` 同步后） |
|---|---|---|
| 列表容器 class | `mpw_props` | `mpw_props mpw_dirList` |
| `overscroll-behavior`（computed） | **`auto`**（滚轮会串联宿主面板） | **`contain`** |
| `overflow-anchor`（computed） | `none` | `none` |
| 滚轮 5 次后的 `scrollTop` | `200 → 400 → 600 → 800 → 1000` | `0 → 400 → 600 → 600 → 600` |
| **面板重渲染后 `scrollTop`** | **`1000 → 0`（"跳回最顶"，真机复现）** | **`800 → 800`（保持）** |
| 重挂事件（MutationObserver） | `.mpw_mask` `removed`+`added`（同一毫秒，×2） | 同样发生 `removed`+`added`，但位置保持 |
| `activeElement`（打开后） | （旧实现无该契约） | **列表容器自身**（`isList=true`，不是行） |
| 行内按钮 `tabindex` | `null`（可被 Tab 聚焦） | **`-1`** |
| ↓↓ 后 | — | 活动行=`mpwdir-1`（↓ 下移）、`scrollTop` 不变（不跳顶）、焦点仍在容器 |
| 列表内部/行的 `focusin` | — | **0 次行焦点**（容器自身 8 次 = 弹窗被重挂 8 次，正是 RC-5 的独立佐证） |
| End/Enter/Esc 等键盘 | — | Enter 进入活动行目录（实测从 `/root/Desktop/DSHarea` 进到子目录，列表 `rows 30→9`） |

证据文件：`tools/probe-out/dirpick-before.json`、`dirpick-after.json`、`dirpick-probe.txt`、
`dirpick-{before,after}-unreached.png`（早期一次"没走到弹窗"的诊断截图，保留以示过程）。

> 假 DOM 的滚动语义按浏览器事实建模（新节点 `scrollTop=0`、钳位、`scrollIntoView` 滚最近可滚动祖先、
> 只有显式 `focus()` 才改 `activeElement`、`overscroll-behavior:contain` ⇒ 不串联）。
> **真机 A/B 已跑**（上表）；结论同时由源码级 + 假 DOM 行为 + 真机三类证据支撑。

---

## 4. 修法与取舍

### 4.1 修法（唯一实现 = `lib/client.js` 的 `MPW-DIRPICK` 块）

```
┌─ useMpwListScroll(ref, key, active) ───────────────────────────────────────┐
│ 契约：① 容器自己记住用户的 scrollTop（按 key 分桶：dir:<路径> / lib / rot:<过滤>）
│      ② 滚动事件**只写 ref**，绝不 setState（不在滚动路径上制造重渲染）
│      ③ 无依赖 useLayoutEffect：每次渲染在**绘制之前**同步把记忆值写回
│         ⇒ 无论 React 重建节点、内容变长变短、宿主重渲染，用户看到的下一帧都在原位
│      ④ 写回的是"用户最后一次的位置" ⇒ 幂等，永不与用户滚动打架（时间窗 hack 全删）
└───────────────────────────────────────────────────────────────────────────┘
┌─ MpwDirList ──────────────────────────────────────────────────────────────┐
│ · 行 key = 完整路径 + \u0000 + 目录名（内容变化不错位复用；刷新=增量更新）
│ · role=listbox / tabIndex=0 / aria-activedescendant；**没有任何 focus()/autoFocus**
│ · 键盘：↑↓ 活动行、Home/End 首末、Enter 进入（未选行 = 选择此文件夹）、
│        Backspace / Alt+↑ 上一级、Esc 关闭；活动行只在**按键时**做 block:"nearest" 最小位移
│ · 样式：overscroll-behavior:contain + overflow-anchor:none（内联，和注入 CSS 解耦）
└───────────────────────────────────────────────────────────────────────────┘
另外：选择器弹窗元素加稳定 key（`key:"mpw-dirpick"`）；面板里另外 3 个滚动容器
（本地壁纸库 / Steam 库 / 轮播勾选网格）复用同一钩子；旧的 rotScrollRef + 事后恢复 effect 一并删除。
```

### 4.2 为什么不直接引入第三方选择器（取舍理由）

用户明确允许"直接引用成熟开源选择器"。**结论：不引入 `npm` 依赖，只对齐其行为契约**，原因三条：

1. **加载方式不允许**：客户端插件是宿主 `window.__ModuleLoader__.load({id, factory})` 注入的，
   `factory(require)` 里的 `require` 只解析**宿主导出表里的模块 id**（如 `react`/`react-dom`），
   相对路径 `require("./xxx.js")` 与子依赖都不可靠；塞整包（chonky / react-aria）会连带
   react-window、styled-components 之类的传递依赖 ⇒ 体积与失败面都不可控。
2. **问题域不同**：现成"文件浏览器"组件（Chonky 等）解决的是虚拟滚动 + 缩略图 + 多选 + 拖拽；
   我们的选择器只有"一层目录列表 + 上/下钻"，真正的 bug 是**滚动主权**与**焦点**，
   一个 30 行的钩子就能根治，引入几千行是负收益。
3. **可测性**：本仓库的门禁是"零依赖 Node 断言 + 切片跑生产实现"；引依赖会把选择器变成
   "只能靠真机看"的黑盒，与本次要求的判据式验证冲突。

### 4.3 与测试台 `PATCH-NOTES.md` §10.5 的对齐 + `Number(null)` 坑的**交叉核对**

测试台线在真机上实锤了**他们那侧**的根因：锚点函数 `dirAnchorContentTop()` 在锚点行被过滤掉时返回
`null`，而恢复逻辑写 `Number(p.anchorContentTop)` ⇒ **`Number(null) === 0` 且 `isFinite(0)` 为真**
⇒ 被当成"有效锚点 0" ⇒ 实测 `scrollTop 300 → 0`。

**插件侧核对结论：不是同源写法，不存在这个坑**（三处逐条核对）：

| 位置 | 旧实现（`git show HEAD:lib/client.js`） | 新实现（`MPW-DIRPICK` 块） |
|---|---|---|
| 取值 | `const ratio = dirScrollRef.current && dirScrollRef.current.ratio;` | `const raw = memRef.current[k];` |
| 判据 | `if (ratio === void 0 \|\| ratio === null) return;`（**严格 null/undefined 判断，没有 Number 强转**） | `(typeof raw === "number" && isFinite(raw)) ? raw : el.scrollTop`（**只认有限 number**） |
| 缺失时行为 | 直接 `return`（不做任何恢复）——注意：因为 `ratio` 从未被赋值，这一段**永久 return = 死代码**（§1 RC-1） | **认领容器当前位置**（`mpwScrollTarget`，见下） |

修后把"锚点语义"抽成纯函数并直接单测（`tools/dir-picker-test.mjs` B10a–B10h）：

```js
const mpwScrollTarget = (raw, cur, max) => {
  const curV = (typeof cur  === "number" && isFinite(cur))  ? cur  : 0;
  const want = (typeof raw  === "number" && isFinite(raw))  ? raw  : curV;   // ← 无锚点 = 认领当前位置
  const m    = (typeof max  === "number" && isFinite(max) && max > 0) ? max : 0;
  return Math.max(0, Math.min(want, m));                                     // ← 只夹住，绝不回 0
};
```

实测数字（假 DOM，`cur=300, max=1000`）：`T(null)=300`、`T(undefined)=300`、`T("")=300`、`T(NaN)=300`、
`T(Infinity)=300`、`T(600,300,400)=400`（夹住）；而测试台实锤的旧写法 `Math.max(0, Math.min(Number(null) || 0, 1000))` = **0**。
即：**同一个坑在插件侧不存在，但插件侧现在用显式"有限 number"闸门把这类坑永久关掉**。

其余三条契约（滚动保持=只增删差集 + 锚点缺失夹住、行 `tabindex=-1` + `mousedown` 阻止聚焦 +
弹窗 `focus({preventScroll:true})`、键盘 ↑↓ 到头停/不绕圈 + 方向键与 Enter `preventDefault`）已逐条落到实现里，
对应断言见 §5 的 C1/C3/C4/C12。

**参考了什么（仅参考、未复制代码）**：见 `THIRD-PARTY.md` §4 与
`../we-scene-demo/docs/COPYING-RULES.md` §4 台账（两条：react-window 的"滚动偏移由容器自己
持有 + layout effect 同步恢复"契约；react-aria 的 listbox 键盘/`aria-activedescendant` 契约）。

---

## 5. 行为契约（给测试台 8901 / 8902 线对齐用）

> 接口名与本插件保持一致即可"同款"；类名可不同，但**行为必须逐条对齐**（测试台自有断言，两边互不 import）。

| # | 契约 | 本插件实现 | 对应断言 |
|---|---|---|---|
| C1 | **滚动位置在重渲染后保持**（含：刷新同内容、过滤后条目变少、500 项大目录、宿主重渲染） | `useMpwListScroll`：按 key 记忆 + `useLayoutEffect` 绘制前写回 | B1 / B1b / B8a |
| C2 | **容器被重建（新节点）后位置仍在**（不允许出现"跳到最顶"的一帧） | 同上（写回的是用户最后一次的位置，幂等） | B2 |
| C3 | **不抢焦点**：打开时焦点给**列表容器自己**（`focus({preventScroll:true})`，只做一次）；行一律不参与焦点；重渲染/按键都不移动焦点 | `focusedOnceRef` + `preventScroll:true`；行 `tabIndex:-1` + 行容器 `onMouseDown` 阻止默认聚焦 | A8/A9、B3a–B3g |
| C4 | **键盘导航**：点一下列表或用 Tab 进入后 ↑↓ 活动行、Home/End 首末、Enter 进入（未选行 = 选择当前文件夹）、Backspace 或 Alt+↑ 上一级、Esc 关闭 | `onKeyDown`（容器级，事件冒泡即可生效） | B4a–B4m |
| C5 | **键盘移动才做最小位移**：`scrollIntoView({block:"nearest"})`，重渲染绝不产生任何 `scrollIntoView` | `reveal()` 只在按键分支调用 | B4l / B4m |
| C6 | **滚轮不串联宿主**：列表到边界后不带动背后的面板/页面 | 内联 `overscroll-behavior: contain` | B5a / B5c |
| C7 | **不受浏览器滚动锚定搬动**：内容高度变化不把 `scrollTop` 锚走 | 内联 `overflow-anchor: none` | B5b |
| C8 | **滚动路径不重渲染**：`scroll` 处理只写内存，不触发 setState | `onScroll` 只写 ref | B6 |
| C9 | **行级增量更新**：刷新/过滤后同一行的 DOM 节点被复用（不是整表重建） | 行 key = 完整路径 + `\u0000` + 目录名 | B7 |
| C10 | **每个目录各自记住位置**：A 目录滚到 60、B 目录滚到 20，来回切换互不串位 | 记忆按 `dir:<路径>` 分桶 | B9a / B9b |
| C11 | **快捷键提示**：弹窗内有可见提示（`↑↓ 选择 · Enter 进入 · Esc 关闭`） | i18n `lib.kbdHint`（zh/en 两套齐全） | panel-fixes（键集合一致） |
| C12 | **锚点缺失不回 0**：记忆位置超出新范围 ⇒ 夹到新范围；记忆值缺失/非法（`null`/`undefined`/`""`/`NaN`/`Infinity`）⇒ 当"无锚点"，认领当前位置 | 纯函数 `mpwScrollTarget(raw, cur, max)` 是唯一真值表 | A10、B1b、B10a–B10h |

**已按测试台 §10.5 对齐**：本插件选择器打开时会 `focus({ preventScroll: true })` 聚焦**列表容器**
（不是第 0 行）⇒ 打开即可用键盘，且**不会**因焦点把容器/行滚进视野（这正是"跳顶"的经典成因）。
两侧现为同款契约：行 `tabindex=-1`、键盘移动不 `focus()` 行、↑↓ 到头停不绕圈、方向键与 Enter `preventDefault`。

---

## 6. 回归门禁

```bash
node tools/dir-picker-test.mjs                                # 57 断言；旧实现必须红（A 组 9/10）
node tools/dir-picker-test.mjs --client /tmp/head-client.js   # 分辨力自证（rc=1）
bash tools/check.sh                                           # 第 2 步已并入本测试
```

有分辨力的三条硬要求（缺一不可）：
1. **改回旧写法要变红**：A 组 10 条断言直接对 `git show HEAD:lib/client.js` 跑，旧实现 **9/10 红**；
2. **行为断言要跑生产代码**：B 组切 `MPW-DIRPICK` 块（不复制实现），容器重建/大目录/键盘都真跑；
3. **不能"假绿"**：B2 断言显式要求 `容器 uid 变了`（即真的重建过）**且**位置仍在，
   B8c 断言"不存在把列表写回 0 的写入"，B3 断言"焦点只在容器上、行永不被 focus"，
   B10 断言 `null/undefined/""/NaN` 一律被当成"无锚点"⇒ 夹住当前位置（不回 0）。

---

## 7. 未定项 / 真机状态

| 项 | 状态 |
|---|---|
| 真机无头 Firefox A/B | **已跑（2026-09-17）**：见 §3-C。数字：旧实现"面板重渲染 `1000 → 0`"、新实现"`800 → 800`"；机制（`.mpw_mask` 被重挂）由 MutationObserver 同毫秒 removed+added 实锤。脚本 `tools/dir-picker-probe.mjs` 可复跑（`--no-ab` 只测当前安装版本；`--before-client` 指定旧副本） |
| 旧实现"跳顶"的**首次触发时刻**（哪个兄弟节点变化把弹窗挤重建） | **已定案（RC-5）**：不是"某个特定兄弟"，而是**面板任何一次重渲染**（宿主 children 数组无 key ⇒ 下标顺移）都会重挂 `.mpw_mask`；探针里一次合成 `input` 事件即可 100% 复现 `scrollTop → 0` |
| 触摸设备（Termux X11 + 触摸）下的滑动误选 | 保留了 `pointerdown` 锁定（1.5s 过期；本轮把"过期"改成**不阻止点击**——过期锁不再让"按住一会儿再松手"静默失效）；未在真机复核 |
| `scrollbar-gutter` / 滚动条宽度变化导致的 1px 位移 | 未处理（不影响"跳顶"判据） |

### 7.1 真机探针（脚本 `tools/dir-picker-probe.mjs`，随时可跑）

```bash
node tools/dir-picker-probe.mjs            # 一次 Firefox 启动内 before → 同步 → reload → after
node tools/dir-picker-probe.mjs --no-ab    # 只测当前装的那份（不做 A/B）
```

1. 用 `tools/hdr-probe-mint-cookie.mjs` 造的 Cookie（复用 `/tmp/ffprobe/cookie.json`）→ 无头 Firefox 打开 `http://127.0.0.1:3080/`；
2. `addInitScript` 注入：`Element.prototype.scrollTop` 的 setter 钩子（记录 JS 侧写入 + 调用栈）、
   `.mpw_dirList` 的 MutationObserver（记录节点被 added/removed = 重建）、`focusin` 监听；
3. 打开设置 → 壁纸引擎背景 → 浏览…（文本选择器三级降级；到不了就落盘"可见入口候选"+截图，供下一轮改选择器）；
4. 用 `mouse.wheel` 连续滚动采样 `scrollTop`，再**合成一次面板重渲染**（给 `.mpw_input` 派发 `input` 事件）验证"重渲染后位置保持"；
5. 断言：无任何 `scrollTop=0` 的 JS 写入、无列表节点被换掉、滚轮期间无 `focusin`、到边界后宿主祖先未被带动、
   容器带 `overscroll-behavior:contain` + `overflow-anchor:none`。

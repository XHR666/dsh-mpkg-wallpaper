# 3448290956「interactions 多种互动」——触发条件总表与本仓支持状态

（2026-10-06/07，HEAD `fc2f13b`；离线 `tools/script-deobfuscate.mjs` + 真机注入指针；§5 为第 84 轮补充取证）

## 0. 包结构

40 层（27 层有父级、1 层带附件、1 层粒子、10 层带效果、2 层 sound 类、**0 个用户属性**）。
脚本驱动字段 **14 个 / 14 层**（无 `scene.pkg` 外的依赖）。

## 1. 触发条件总表（逐字段）

| # | 层.字段 | 脚本读什么（去混淆逐字） | 触发条件 | 本仓状态 | 证据 |
|---|---|---|---|---|---|
| 1 | `头位置.origin` | `value.x = scriptProperties.x * engine.canvasSize.x` | 脚本属性（作者常量，不随指针） | ✅ 工作（`syncScriptOrigins`） | 真机位移 0.0 = 预期 |
| 2 | `头.angles` | 读指针（与 `头位置` 联合摆头） | **指针位置** | ✅（P-242 载体 + P-243 输入） | Δ5.9625（修前 0.0037） |
| 3 | `可调整组合层.angles` | 同上 | **指针位置** | ✅（P-242） | 见第 2 条同批 |
| 4 | `左眼球.origin` | `input.cursorWorldPosition.subtract(value)` → 归一化 × `min(maxDistance, dist·distanceScale)` | **指针位置**（距中心越远眼球偏得越多，有上限） | ✅（P-243） | 位移 **99.7**（修前 0.0） |
| 5 | `右眼球.origin` | 同上 | **指针位置** | ✅（P-243） | 位移 **100.2** |
| 6 | `嘴巴.scale` | `dist = input.cursorWorldPosition.subtract(thisLayer.origin).length()` → `value.y = minY + clamp(dist·ratio·0.01, 0, maxY)` | **指针距离**，但 `thisLayer.origin` 是**局部原点** ⇒ `dist` 恒 ≥1264 ⇒ 值域只有 `1.198…1.25`（**官方同口径，见 §5.1**） | ✅ 忠实（P-242+P-243） | 三档反解与局部 origin **逐位吻合**（§5.1） |
| 7–8 | `主发.visible` ×2 | **双击（≤500 ms）触发器**：`cursorClick` → `getLayer('左眼白').getAnimation('点击动画').play()` / `getLayer('戳头').getAnimation('chuo').play()`（两动画**不在包里** ⇒ 死分支） | **双击**（脚本自带 `Date.now()` 判定；本身不改 `visible`） | ✅ 派发链通（P-233 管线） | 真机 `clicks=2, hits` 含 `主发`、两脚本都 export `cursorClick`（§5.2） |
| 9 | `左眼白2.origin` | 读指针（与眼球同族） | **指针位置** | ✅（P-243） | 同第 4 条 |
| 10 | `闹钟.origin` | `value.x = scriptProperties.x * engine.canvasSize.x`（两个滑块） | **脚本属性**（与指针无关） | ✅ 工作（`syncScriptOrigins`） | 真机位移 0.0 = 正确行为（§5.3） |
| 11–13 | `时间.text` / `Date.text` / `D a y.text` | `new Date()` + `addCombo/addCheckbox/addText` 三类脚本属性 | **时间**（每帧） | ✅（既有文本同步 + 对象级 `scriptproperties`） | 与系统时钟逐字对上（§5.3） |
| 14 | `.origin`（匿名层） | 未命名层，字段与 `头位置` 同族（781 字符同长度） | **脚本属性** | 机制在位 | — |

**机制面小结**：`origin`（`syncScriptOrigins`）、`visible`/`alpha`（P-237）、`scale`/`angles`（P-242）、
**指针输入 `input.cursorWorldPosition`**（P-243）、`text`（既有）——五类载体**全部到位**。

## 2. 真机验证

- **层级**：注入指针 (900,500)→(3000,1500)：`左眼球` 位移 **99.7**、`右眼球` **100.2**、`头.angles` Δ**5.9625**
  （修前分别为 0.0 / 0.0 / 0.0037）。
- **像素级**（同一次挂载，两次注入 + 整帧比对）：差异像素 **27 984（3.04%）**、
  包围盒 **477×307 @(418,370)**（正是面部区域）、平均差 **51.7**、最大差 **214** ⇒ **互动真的上了屏**。
  截图：`/tmp/ip-left.png`（指针左上）vs `/tmp/ip-right.png`（指针右下）。

## 3. 与 P-242/P-243 的关系（可复用面）

这两个改动是**通用机制**，不只服务本包：`scale`/`angles` 载体覆盖语料所有这两类脚本字段；
`input.cursorWorldPosition` 覆盖所有"跟随鼠标"的作者脚本（眼睛/头/嘴/拖拽库/NSL Dock…）。

## 4. 未验证边界（下一步）

1. `嘴巴.scale`：把指针**靠近嘴部**再测一次（远离时按脚本逻辑已饱和到上限）；
2. `主发.visible` 的两个脚本：读正文确认"什么条件下换发"（点击？属性？时间？），再验一次显隐切换；
3. `闹钟.origin`、匿名层 `.origin`：读正文确认入口（引擎时间/指针/属性）；
4. 三个时钟文本（`时间/Date/D a y`）：与系统时间逐字对一次；
5. 观感验收建议用测试台新增的**图层开关**（zcode 阶段 1）逐层开关配合，避免被其它层遮挡误判。

## 5. 第 84 轮：§4 四个"未验证边界"逐条落地（三条判为**忠实**、一条判为**死分支**、一条判为**正确**）

### 5.1 `嘴巴.scale` —— 作者把**世界指针**和**局部 origin** 相减；官方同样如此（⇒ 不是本仓缺陷）

真机读数（`__mpwRawObjects` 里 `嘴巴.scale.value` 原文，指针经 `window.__mpwPointer` 注入）：

| 指针（设计坐标） | `raw.scale.value` | 反解出的 `dist` |
|---|---|---|
| 压在嘴中心 (1922,1819) | `1.000000 1.198582 1.000000` | **1264.78** |
| 远离 (3122,2719) | `1.000000 1.250000 1.000000` | ≥1333.3（钳到 `maxY`） |
| 嘴正上方 (1922,100) | `1.000000 0.590719 1.000000` | **454.29** |

公式反解用 `value.y = minY + clamp(dist·ratio·0.01, 0, maxY)`，其中**场景对象级** `scriptproperties = {maxY:1, minY:0.25, ratio:0.075}`（**不是**脚本默认 `1/0.2/1`）⇒ 这同时**实证了对象级 `scriptproperties` 覆盖在本包生效**（P-236 那条链）。

两种 origin 口径对照（`scene.json`：`嘴巴.origin = "1915.24500 554.24158"`，父链 `嘴巴→mouth→可调整组合层→头→左眼白→头位置`；合成后的设计原点 ≈ (1921.7,1819.4)）：

* **局部（authored）origin (1915.245,554.242)**：`|(1922,1819)−(1915.245,554.242)| = 1264.78` ✅、`|(1922,100)−(1915.245,554.242)| = 454.29` ✅ —— 与两条读数**逐位吻合**；
* **世界（合成）origin (1921.7,1819.4)**：会得到 `dist = 0.35`（压在嘴上）与 `1719`（正上方）⇒ **与读数不符**。

⇒ 脚本看到的 `thisLayer.origin` 是**局部原点**。**这不是本仓偏差**，上游官方网页产物的脚本门面写得很直白
（`demo/assets/renderer-n-Rw_ZVc.js`）：`const c={origin:"localOrigin",scale:"localScale"}` +
`Object.defineProperty(a,"origin",{get(){…Array.isArray(t[u])?t[u]…}})`（读 `localOrigin`），
而 `input.cursorWorldPosition` 由 `Xv()` 用**世界坐标**填：`t.cursorWorldPosition.x=e.wx, t.cursorWorldPosition.y=e.originY??e.wy`。
官方 `We.subtract(e){… return new We(…)}` 也是**返回新对象**（不就地改），与本仓 `elysia/scene-script-apis.js` 的实现一致。

⇒ **结论**：`嘴巴` 的实际值域是 `1.198…1.25`（`dist` 恒在 ~1264 以上，靠近饱和区），屏上几乎不动 —— **官方亦然**，
这是作者脚本自己混用了两个坐标空间（"随指针远近张嘴"没写对）；本仓按 `0.00075/px` 如实求值，实测增量与解析式逐位一致。
**不需要改渲染器**（改了就与官方分叉）。

### 5.2 `主发.visible`（两处）＝ 双击触发器；动画**在包里不存在** ⇒ 死分支（点击链路本身是通的）

去混淆正文：`scriptProperties.addCheckbox({name:'kaiguan'})` + `cursorClick(event)` 里用 `Date.now()` 做 **500 ms 双击判定**，
命中后 `thisScene.getLayer('左眼白').getAnimation('点击动画').play()` 与 `thisScene.getLayer('戳头').getAnimation('chuo').play()`。

真机（在 `主发` 中心 = 设计 (1989,1395) 连点两次、间隔 180 ms）：

* `window.__mpwCursorDispatch = {down:2, up:2, clicks:2, hits:['纯色','手','主发','脸','背景'], last:{name:'cursorClick', wx:1989, wy:1395}}`；
* `主发` 的两个脚本条目都 `exports = ['init','cursorClick','update']`、`__mpwScriptErrs = null` ⇒ **事件确实投进了作者脚本**。

但两个动画名**在包里不存在**（逐 `.mdl` 动画名表）：`models/左眼白_puppet.mdl` = `"摇头"(120f)` / `""(60f)`、`models/脸_puppet.mdl` = `"动画 1"`、
`models/左眼皮_puppet.mdl` = `"普通眨眼"/""`、`models/右眼皮_puppet.mdl` = `"右眼普通眨眼"`、`models/呆毛_puppet.mdl` = 0 条；
全包无 `chuo`；`models/戳头.json` 无任何动画段。官方口径与此同构：门面 `getAnimation(name)` **查不到时返回 `Fs()`**
（`{play:()=>t, pause:()=>t, stop:()=>t, setFrame:()=>t, …}` 的中性桩，**不是 `undefined`**）——
即官方也会"调用成功但什么都不播"，与本仓"永远给真值桩"的既有口径一致（作者自己在脚本里写了 `console.error('未能找到动画')` 兜底）。

⇒ **结论**：本包"点击互动"是作者留下的**死分支**；点击**派发链路**由 `tests/cursor-dispatch-test.mjs` 与本次真机台账共同判定为通。

### 5.3 `闹钟.origin` 与三个时钟文本

* `闹钟.origin` 正文 = `value.x = scriptProperties.x × engine.canvasSize.x`（两个滑块，与指针无关）⇒ §2 里"移动指针位移 0.0"**正是正确行为**。
* `时间 / Date / D a y .text` 都基于 `new Date()`（`Date` 已在 vm 沙箱里，`elysia/scene-scripts.js:2273`）+ 对象级 `scriptproperties`。真机同一时刻读数
  （页面时钟 `03:30:56`，系统 `2026-10-07 星期三`）：

| 层 | 文本读数 | 对象级 `scriptproperties` | 与真实时钟比对 |
|---|---|---|---|
| `时间` | `03:30` | `{delimiter:":", showSeconds:false, use24hFormat:true}` | ✅ 时:分一致（不显示秒） |
| `Date` | `7 OCT 2026` | `{monthFormat:"2"(缩写), dayFormat:"2", showDay:false, useDelimiter:true, addDelimiter:""}` | ✅ 日 7 / 月 OCT / 年 2026 |
| `D a y` | `W E D N E S D A Y` | `{monthFormat:"1", dayFormat:"2", showDay:true, useDelimiter:true, addDelimiter:"/"}` | ✅ 星期三 |

⇒ 文本载体（含 `addCombo`/`addCheckbox`/`addText` 三类 scriptProperties 与对象级覆盖）在本包全部生效，`__mpwScriptErrs = null`。

### 5.4 对 §2 总表的两处更正

* `主发.visible`×2 的"触发条件"一栏由"条件显隐（待读正文）"更正为 **双击（≤500 ms）触发器，本身不改 `visible`**；
* `闹钟.origin`、匿名层 `.origin` 一栏由"待读正文"更正为 **脚本属性滑块 × 画布尺寸（与指针无关）**。

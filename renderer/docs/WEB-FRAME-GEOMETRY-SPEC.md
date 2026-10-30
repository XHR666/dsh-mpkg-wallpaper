# WEB-FRAME-GEOMETRY-SPEC —— 帧内坐标契约与覆盖式视口（规格先行）

> 适用仓库：`we-scene-demo`（渲染器，**GPL-3.0-or-later**）。
> 本文件**只写公开契约与算法事实**（输入/输出/不变量/边界），不复制任何实现代码。
> 实现落点：`core/web-frame-geometry.mjs`；回归：`tests/web-frame-geometry-test.mjs`。
> 参照来源与台账：`THIRD-PARTY.md` §11、`docs/COPYING-RULES.md` §4 台账 #9。
> 引入日期：2026-09-16（P-102）。引入人：本仓库（渲染器侧）。

---

## 0. 为什么渲染器需要这两个纯函数

渲染器不只被自己的 `demo.html` 使用：它也会被**宿主**用 iframe 嵌进别的页面（三方托管形态、
插件/测试台、桌面 underlay 形态）。这时会出现两个**只有父页知道**的几何问题：

1. **指针坐标落在哪个帧内像素**：宿主拿到的鼠标坐标是"窗口坐标"，而作者/渲染器关心的是
   "帧内 client 像素"。iframe 的盒子未必与窗口原点对齐，祖先 CSS `transform` 还可能整体缩放
   （`getBoundingClientRect()` 含缩放、帧内部视口不含）。换算错了**不会报错**，只会"鼠标位置整体偏"，
   肉眼很难量 —— 所以它必须是一个**能被真值表钉死的纯函数**。
2. **内容比例与舞台比例不一致时，"覆盖式视口"要给多大**：网页/视频内容有自己的宽高比
   （`videoWidth/videoHeight`、`naturalWidth/naturalHeight`），舞台（容器）是另一个比例。
   `cover` 语义 = 视口取内容比例、把溢出的一边**居中裁掉**；这样内容坐标系不被拉伸
   （作者按视口百分比定位的元素不会与内容脱钩），也不露黑边。

本仓库此前**没有**这两块能力：`buildCamera` 只做场景的取景窗口（`fillmode` 四档，语义是
"场景单位 → 输出像素"），对象级视差/指针注入走的是 `window.__mpwPointer`（**设计坐标**，
由注入方自己保证口径）。两者都不是"宿主 iframe 几何"，因此本模块是**新增能力**，不改动任何既有路径。

---

## 1. `frameClientPoint(ev, frameRect, frameViewport)`

### 1.1 输入

| 参数 | 形态 | 含义 |
|---|---|---|
| `ev` | `{clientX, clientY}` | **视口坐标**（不是 `pageX/pageY`；page 坐标含滚动量，与 `getBoundingClientRect()` 不同空间，混用会整体偏一个滚动量） |
| `frameRect` | `{left, top, width, height}` | iframe 的**显示盒**（`getBoundingClientRect()`，可能被祖先 transform 缩放，也可能带负偏移） |
| `frameViewport` | `{width, height}` | iframe 的**内部视口**（`clientWidth/clientHeight`，不受祖先缩放影响） |

### 1.2 输出

`{x, y, inside, scaleX, scaleY}`；**无法计算时返回 `null`**（调用方必须丢弃，不许退化成一个假坐标）。

### 1.3 算法（规格，逐步）

```
若 clientX/clientY 不是有限数                      → null
若 frameRect.width 或 height ≤ 0                   → null
若 frameViewport.width 或 height ≤ 0（尚未布局）    → null
scaleX = frameRect.width  / frameViewport.width     （祖先缩放系数）
scaleY = frameRect.height / frameViewport.height
x = (clientX − frameRect.left) / scaleX
y = (clientY − frameRect.top)  / scaleY
inside = (0 ≤ x ≤ frameViewport.width) 且 (0 ≤ y ≤ frameViewport.height)
```

### 1.4 不变量（测试必须覆盖）

1. **1:1 情形**：帧与窗口对齐且无缩放时，`x = clientX − left`、`y = clientY − top`。
2. **只看 client 坐标**：事件对象里同时带 `pageX/pageY` 时，结果**不受**它们影响。
3. **祖先缩放补偿**：帧显示 400px 宽、内部视口 800px 时，`scaleX = 0.5`，`x` 放大一倍。
4. **负偏移**：帧左移（`left = −50`）时窗口原点映射到帧内 `+50`，且 `inside = true`。
5. **越界仍返回数值**（`inside = false`）：调用方用它维护 hover 状态，不能因为越界就丢事件。
6. **非有限值/零尺寸一律 `null`**：`NaN` 进 `clientX` 会让命中测试返回 null、作者的位移积分
   一次性污染成 `NaN` 且没有任何报错 —— 丢弃是唯一安全行为。

---

## 2. `coverViewport(stageW, stageH, contentAspect)` → `{width, height, left, top}` | `null`

### 2.1 语义

把宽高比为 `contentAspect` 的内容铺满 `stageW × stageH`，**溢出的一边居中裁掉**。
返回的是**给 iframe 用的 CSS 尺寸与居中偏移**（相对舞台左上角）。**不用 transform 缩放**：
视口本身就取内容比例，于是 1 CSS px 仍是 1 舞台 px，文字/视频不重采样。

### 2.2 算法（规格）

```
若 stageW ≤ 0 或 stageH ≤ 0 或 contentAspect ≤ 0                → null
stageAspect = stageW / stageH
若 |stageAspect − contentAspect| ≤ EPS                          → null（差异在容差内 = 已贴合，不必处理）
若 stageAspect < contentAspect（舞台更"高"）:
    width = stageH × contentAspect ; height = stageH
    left = (stageW − width) / 2    ; top = 0
否则（舞台更"宽"）:
    width = stageW ; height = stageW / contentAspect
    left = 0       ; top = (stageH − height) / 2
```

| 常量 | 值 | 理由 |
|---|---|---|
| `EPS` | `0.005` | 比例差 ≤0.5% 视为已贴合：躲开 DPR 取整误差，避免把"已经铺满"的页面再裁一刀 |

### 2.3 不变量

1. 结果恒满足 `width ≥ stageW` 或 `height ≥ stageH`（覆盖），且**另一边恰好等于**舞台对应边。
2. `left ≤ 0`、`top ≤ 0`（只有当对应方向溢出时才为负），居中：溢出量的两半相等。
3. 比例差在容差内 → `null`（"不需要动"，而不是"给一个几乎相同的盒子"）。
4. 舞台比例与内容比例互换时结果互为镜像（`width/height` 对调、`left/top` 对调）。
5. 非法输入（`≤0`、非有限）→ `null`。

---

## 3. `contentAspectOf(box, natural)`（内容比例的取值口径）

内容比例**只认内在尺寸**（`videoWidth/videoHeight`、`naturalWidth/naturalHeight`），
**不认渲染盒**：媒体元数据未到时渲染盒常是 `300×150` 之类的占位，用它当设计比例会算出
荒谬视口（实测到过一次 `15360×1200` 的误判）。

```
若 natural.width/height 都是有限正数 → 用内在比例
否则若 box.width/height 都是有限正数 → 用盒子比例（兜底：图片/视频无内在尺寸时）
否则 → null
结果被限制在 [0.2, 6] 之外时返回 null（视为量错，而不是"极端比例"）
```

## 4. `normalizeFrameFit(mode)`（取值归一）

| 输入 | 归一结果 | 语义 |
|---|---|---|
| `cover`（缺省/未知值） | `cover` | 覆盖：视口取内容比例、居中裁切（本模块的主路径） |
| `contain` / `fit` | `contain` | 完整可见：视口 100%×100%，露出的边由页面底色承担 |
| `stretch` / `fill` | `stretch` | 拉伸：视口 100%×100%，内容按舞台比例拉伸 |

未知值一律回落 `cover`（与既有 `fillmode` 缺省 `aspectcrop` 的"宁裁不留边"口径一致）。

---

## 5. 回退开关（`?frame=legacy`）

调用方（宿主/测试台接线）必须支持 `?frame=legacy`：该档下**不调用本模块**，回到"iframe 100%×100%"。
判据由 `frameGeomModeFromQuery(search)` 给出（`legacy`/`off` → `legacy`，其余 → `cover`），
使回退开关本身也可被测试断言（不需要真起浏览器）。

**现状（2026-09-17 / P-112-BANDGEOM 更新）**：本模块**已接线**（接线说明与实测数字见 `docs/AUDIO-BAND-WIRING.md`）：

- **指针口径**（`frameClientPoint`）接在 `core/we-scene-bundle.js`：DOM `pointermove` 路径
  （画布归一化）与 `window.__mpwPointer.space==='css'` 注入路径。开关 `?framegeom=cover`，缺省 legacy
  ⇒ 逐位等于改动前的内联算式（含 NaN 透传）。**消费方**=场景粒子 `lockToPointer` 发射器的基准点。
  ⚠ `space:'css'` 是"窗口坐标"还是"帧内 CSS 像素"在本仓库**没有生产者可证**（grep 0 命中）⇒ 本次按
  窗口坐标解释，标为**未定**（接线文档 §4 第 4 条）。
- **覆盖式视口**（`coverViewport`/`contentAspectOf`/`frameVisibleRect`）接在 `demo.html` 的 **video 壁纸**
  帧盒（`?framegeom=cover|contain|stretch`，缺省 legacy = 不碰元素样式）。
- **web 壁纸 iframe 的尺寸路径仍未接**（**缺证据**）：那个帧由三方 minified 渲染器自建自算
  （`demo/assets/renderer-BOSoB05I.js` 的 `nw()`/`Y1()` 是模块内私有函数，公开面 `window.__wp` 无几何 setter；
  改产物违反本仓库纪律），另一个宿主在插件树里（本任务禁改）⇒ 要接需先有一个可注入的宿主契约（未定）。
- **主表登记**：`framegeom` 已进 `docs/README-DIAGNOSTICS.md`（代码里真实解析）。模块自带的 `?frame=legacy|off|0`
  由 `frameGeomModeFromQuery` 在**模块内**解析（`diag-flag-check.mjs` 的四个扫描源不含独立模块 ⇒ 不登记，
  口径见本文 §5 原文）；它仍是**优先级最高**的回退（`?framegeom=cover&frame=legacy` ⇒ legacy）。
- 回归：模块契约 `tests/web-frame-geometry-test.mjs`；接线（含反向变异必红）
  `tests/web-frame-geometry-wiring-test.mjs`。

---

## 6. 与参照来源的差异（洁净室判据，测试逐条断言）

对照 `oneincase/webwallgl`（MIT）的 `renderer/src/web.ts`（其 `webPointerToClient` / `webCoverViewport` /
`measureWebLetterbox`）与本模块：

| 维度 | 参照实现 | 本实现 |
|---|---|---|
| 命名 | `webPointerToClient` / `webCoverViewport` / `measureWebLetterbox` | `frameClientPoint` / `coverViewport` / `contentAspectOf` |
| 参数形态 | 三个位置参数（stage 盒 / frame 盒 / client 尺寸） | 事件对象 + 两个盒；三者都是**普通对象**（可传 `DOMRect`，也可传字面量） |
| 适配模式 | 只有 cover 一种（非 cover 直接 100%×100%） | `normalizeFrameFit` 显式三态（cover/contain/stretch）+ 未知值回落 |
| 容差与限幅 | 模块内散落的常量 | 汇总为具名常量表 `FRAME_ASPECT_EPS` / `FRAME_ASPECT_MIN` / `FRAME_ASPECT_MAX` 并在文档 §2.2/§3 列表 |
| 命中测试 | 在 `web-shim.js`（帧内） | **不在本模块**（渲染器不派发 DOM 事件；宿主侧各写各的） |
| 回退开关 | 无 | `?frame=legacy`（`frameGeomModeFromQuery`） |

以上差异（命名/参数形态/常量组织/边界处理/回退开关）即洁净室判据：

- 本模块是**按本规格重写**的实现，不是逐行翻译；
- 参照仅 MIT，可借，但仍按"规格先行 + 逐条差异"落地（`docs/COPYING-RULES.md` §4 台账 #9）。

# DISPLAY-OPTIONS — 壁纸显示选项（P-113）：水平翻转 / 播放速度 / 颜色选项

> 本文是**对外契约**（插件 `dsh-mpkg-wallpaper` 的"壁纸设置"显示项 ↔ 渲染器 `:8899` 的实现口径）。
> 实现落点：纯逻辑 = `core/we-scene-bundle.js` 的「显示选项」节（唯一实现处，Node 侧可直测）；
> 接线 = `demo.html` 的 `MPW-DISPLAY` 块（解析 → 持久化 → 应用 CSS → 工具条 → `window.__wp`）。
> 断言 = `tests/display-options-test.mjs`（门禁项 `display-options`，71 断言 / 12 组）。
> 诊断开关表：`docs/README-DIAGNOSTICS.md` §⑦。

## §0 契约来源

测试台「壁纸设置」页（`demo/index.html` 的对照表）与插件侧的壁纸显示选项：

| 选项 | API | query | 备注 |
|---|---|---|---|
| 水平翻转 | `__wp.setDisplay({ flipH: true })` | `?fliph=1` | 渲染输出整体 `transform: scaleX(-1)`；指针坐标只镜像一次 |
| 播放速度 0.5–2× | `__wp.setPlaybackRate(1.5)` | `?rate=1.5` | 全局时间倍率：动画 dt + 所有 `<video>.playbackRate`；越界钳位、非法 ⇒ 1 |
| 颜色选项总开关 | `__wp.setDisplay({ colorOptions: false })` | `?coloropts=0` | 关掉时四项**完全不进** filter 串 |
| 亮度/对比度/饱和度/色调偏移 | `__wp.setDisplay({ brightness: 1.1, contrast: 1.05, saturation: 1.2, hue: 15 })` | `?bright=1.1&contrast=1.05&satur=1.2&hue=15` | 一条 `brightness(b) contrast(c) saturate(s) hue-rotate(hdeg)` |
| 总回退 | — | `?display=legacy` | 忽略本组全部开关（连 API 也只读） |

## §1 机制与落点（CSS `filter` / `transform`，与 `?fx=` 同一套）

- **写在哪**：**拥有渲染输出的那个元素**上 —— 单实例 = canvas `#sc`，多实例（`?ids=`）= 每个格子自己的画布
  （在 `bootInstance` 里逐个注册；`mpw-display-box` 工具条本身**不在**翻转/滤镜范围内）。
- **不做什么**：不重挂载场景、不进 GL 管线、不改 `renderer.render()` 的任何入参 ⇒ 与效果链/后处理档
  （`?pp=` / `?q=` / `?aa=` / bloom）正交。
- **与既有 `?fx=` 滤镜的合成**（唯一 filter 写入点，`composeFilterCss`）：
  `filter = <既有串> ' ' <颜色串>`（既有在前）。CSS filter 从左到右依次作用 ⇒ **颜色项看到的是既有滤镜
  的输出**。关掉颜色项时**逐字还原**既有串（不会把自己的空串写上去，也不会覆盖别人的 filter）。
  本仓库 `demo.html` 目前**没有** `?fx=` 白名单滤镜（`#fx` 下拉/`toolbar.filterTip` 属测试台页面
  `demo/index.html`，是另一条工作流）；本模块按"任何既有写入者"设计，宿主/测试台先写了 `filter`
  也一样合成。多实例下每个画布各记一份**注册时的原始串**，反复开关不会把颜色串套娃叠加。
- **`transform` 的唯一写入者**：本组（`?fliph=1` / `flipH: true` ⇒ `scaleX(-1)`）；
  `demo.html` 里对输出元素**没有**别的 `transform` 写入者（grep 0 命中）。
  若将来有人写，`composeTransformCss` 把镜像放在**最外层**（`scaleX(-1) <既有>`）。

## §2 选项、区间与取值语义（代码里同一份：`DISPLAY_LIMITS`）

| 键 | query | 默认 | 区间 | 越界 | 非法/空 | 解析函数 |
|---|---|---|---|---|---|---|
| `flipH` | `fliph` | `false` | 布尔 | — | 只写名字/`1`/`on`/`yes` ⇒ 开；`0`/`off`/`no`/`false` ⇒ 关 | `displayFlagOn` |
| `colorOptions` | `coloropts` | **`true`** | 布尔 | — | 同上（默认是"开"，与其余布尔项相反） | `displayFlagOn` |
| `brightness` | `bright` | `1` | `[0, 2]` | **钳位** | ⇒ `1` | `clampDisplayNumber` |
| `contrast` | `contrast` | `1` | `[0, 2]` | 钳位 | ⇒ `1` | 同上 |
| `saturation` | `satur` | `1` | `[0, 2]` | 钳位 | ⇒ `1` | 同上 |
| `hue` | `hue` | `0` | `[-180, 180]`（度） | 钳位 | ⇒ `0` | 同上 |
| `playbackRate` | `rate` | `1` | `[0.5, 2]` | 钳位 | ⇒ `1` | `parsePlaybackRate` |

- **为什么钳位而不是拒绝**：CSS `brightness(-1)` 这类值会让**整条 filter 串失效**（浏览器静默丢弃整个声明），
  钳位是唯一能保证"写进去的串一定合法"的做法。
- **四项全中性（1/1/1/0）⇒ `buildDisplayFilter` 返回空串**，页面**不写** `style.filter`
  （不是写 `brightness(1) contrast(1) saturate(1) hue-rotate(0deg)`）：后者视觉等价但会凭空多一个合成层，
  与"缺省零行为变化"的红线冲突。
- `?coloropts=0` ⇒ 四项**完全排除**在 filter 链之外（哪怕 URL 里写了 `?bright=1.4`）；四项的值仍被记住
  （工具条/持久化），总开关再打开即恢复。

## §3 翻转下的指针行为（只镜像一次）

`transform: scaleX(-1)` 把输出关于**元素中心**水平镜像 ⇒ 屏幕上 `x` 处看到的是未翻转内容的 `1 − x`。
指针路径因此必须**镜像一次**（`framePointerMap(ev, el, mode, flipX)` 的第四个参数，两种模式都支持）：

- `mode='legacy'`（缺省）：`nx' = 1 − nx`（`x' = width − x`）；
- `mode='cover'`（`?framegeom=cover`）：帧内 client 像素同样镜像 `x' = clientWidth − x`，
  `inside` / `scaleX` 不变；
- **第四参数缺省 = `false` ⇒ 与改动前逐位同值**（老调用点零影响）。

**为什么注入通道不镜像**（"不是镜像两次"）：`window.__mpwPointer = {x, y, inside}` 是**设计坐标**
（0..projW / 0..projH，y 向下，与场景空间同量纲），由宿主/测试台算好后注入，CSS transform 完全不改变它；
`core/we-scene-bundle.js` 的 `__pointerDesign` 对它**原样透传** `return [inj.x, inj.y]`。
只有 `space:'css'`（窗口坐标）那条注入路径与 DOM `pointermove` 一样是"窗口坐标输入"，才走同一个镜像换算。

优先级链（`displayFlipH`，与 `resolveProjMode` 同形）：`opts.displayFlipH`（测试/宿主显式传）
→ `window.__mpwDisplay.flipH`（页面实时写）→ `?fliph=`（加载时读一次）。

**测试**（`tests/display-options-test.mjs` T5）：1000×500 画布上 `clientX=300`（归一 0.2）⇒
不开翻转 `nx=0.2` / 开翻转 `nx=0.8`；端到端映射到设计坐标 = `768 → 3072`（左右互为镜像）；
`?framegeom=cover` 档同口径；**RED-IF-REVERTED**：把镜像支删掉 ⇒ T5c/T5e 必红。

## §4 播放速度语义（0.5–2×）

- **场景时钟**：`createSceneClock()` 把"墙上时间"换成"场景时间" ——
  `tSec = 锚定场景时间 + (now − 锚定墙上时间) / 1000 × rate`。
  页面把**改动前的原式** `(now − last0) / 1000` 作为 legacy 值传进去：没被 `setPlaybackRate` 碰过时
  **原样返回**（逐位不变）；被碰过（含 `?rate=`）才启用锚定推进，切回 1 也不跳变。
- **动画 dt**：`tSec` 驱动 `renderer.render(...)`、蒙皮骨、MDLA 附件动画、场景脚本、精灵图帧 ——
  即"动画时间"整体乘倍率；传给场景脚本的 `engine.frametime` 同步乘倍率（`scaleSceneDt`，rate=1 ⇒ 逐位原值）。
- **视频**：`syncVideoPlaybackRate(document, rate, force)` 把所有 `<video>` 的 `playbackRate` 设成同一值
  （帧循环每 90 帧跟随一次；两条纯视频壁纸路径在 `loadeddata` 时同步一次）。
  `rate === 1 && !force` ⇒ **一个属性都不写**；从非 1 倍切回 1 时 `force` 生效、写回 1（双向）。
- **多实例**（`?ids=`）：时钟是**页面级单例**（倍率是全局的），场景时间在所有格子间共享；倍率=1 时各格子
  仍各用自己的 `(now − last0) / 1000`（与改动前逐位一致）。
- **测试**（T6）：同一批 16 帧时间戳（15.625ms/帧，二进制精确）下，rate=2 的场景时间推进
  `===` 2 × rate=1 的推进（**逐帧**成立）；用 `evalPropAnimation` 求值的层属性值等于"时间翻倍处"的独立求值
  （rate=1 时 75 / rate=2 时 100，可区分）；**RED-IF-REVERTED**：把时钟倍率写死 1 ⇒ T6b/T6c/T6e 必红。

## §5 优先级与持久化

逐键优先级：**`?display=legacy`（总回退，全忽略）> URL 里真正出现的开关（逐键覆盖）
> `localStorage['mpw-display']`（工具条上次的状态）> 内置中性默认**。

- URL 是**逐键**覆盖：`?bright=0.5` 只改亮度，存储里的 `hue`/翻转照旧生效（不是整表复位）。
- 持久化：单键 `mpw-display`（`mpw-*` 命名，与 `mpw-log-h` / `mpw-props:<id>` / `mpw-audio-open` 同一套），
  JSON = 七个可设置键；单值上限 **512 B**，超限**拒写并写日志**（P-104 纪律：不静默截断）。
  不透明源 / 隐私模式下 `try/catch` 静默降级为"无持久化"。
- 因此：**参数全缺省 + 空存储**（等价一次全新会话）= 与改动前**完全一致**；
  用户自己动过工具条属于"用户主动使用该功能"，要硬回退用 `?display=legacy`。

## §6 公共 API（`window.__wp`）

```js
// 幂等：同一个 patch 反复调用 ⇒ 状态、DOM、存储都不变；返回**生效后的完整状态**（只读副本语义）
const st = __wp.setDisplay({ flipH: true, brightness: 1.1 })   // 只写你要改的键
__wp.setPlaybackRate(1.5)                                      // 越界钳到 2、非法 ⇒ 1
__wp.displayState()                                            // 只读快照（含派生字段）
```

`displayState()` 的字段：`legacy, flipH, colorOptions, brightness, contrast, saturation, hue, playbackRate,
filter, transform`（**真的写进输出元素**的那两个串）、`filterPending, transformPending`（按当前状态**应当**写、
但还没有画布时）、`canvases`（登记的画布数）、`clockTouched`（场景时钟是否被倍率碰过）。
`__wp` 上**已存在**的字段不会被覆盖（宿主/测试台先放的键原样保留）；`?display=legacy` 下
`setDisplay`/`setPlaybackRate` **只读**（返回中性状态、不写属性）。

## §7 "缺省零行为变化"的判据（可机器复核）

参数全缺省且无持久化状态时：`parseDisplayOptions('').present` 为空；`buildDisplayFilter/Transform` 为空串；
切真源码跑一遍（含画布注册）后画布 `style.filter === '' && style.transform === ''`（连既有的内联值也不动）；
场景时钟 `at()` 原样返回传入的 legacy 值、`scaleSceneDt` 逐位原值；`syncVideoPlaybackRate` 返回 0 且不写
`playbackRate`；不产生任何日志。`tests/display-options-test.mjs` T4 逐条断言。

## §8 边界与未证实（不猜）

- **像素级效果未经真机验证**：本机无 GPU/WebGL2，所有结论都是 DOM/数值级（`style` 属性、纯函数、
  被求值的动画值）。"翻转/滤镜在屏幕上看起来对不对"需要真机复看一眼。
- `hue-rotate` 对纯灰阶像素无视觉变化（CSS 语义，不是 bug）。
- 网页壁纸（`sandbox` iframe 内的三方渲染器）**不在**本机制范围内：它的输出元素在另一个文档里，
  本仓库没有注入点（同 `docs/AUDIO-BAND-WIRING.md` §4 的未定清单）。
- `?mode=elysia`（CPU 对照路径）：本块注册的画布仍是 `#sc`，CSS 层**照样生效**；但 elysia 路径没有
  本仓库的帧循环时钟 ⇒ **播放速度对 elysia 的 CPU 动画不生效**（未接线，未证实是否有人需要）。
- 上游 `oneincase/webwallgl`（MIT）的 `?fx=` 白名单滤镜（`blur/grayscale/sepia/…`）**没有**移植到
  `demo.html`：本组只提供"与任何既有 filter 串合成"的机制，不新增预设滤镜 id。

## §9 复现

```bash
cd we-scene-demo
node tests/display-options-test.mjs                 # 71 断言（含 3 条 RED-IF-REVERTED）
node tests/diag-flag-check.mjs                      # 147 == 147（本组 8 个开关）
bash tests/run-all-tests.sh --only display-options  # 门禁单项
# 浏览器（有 GPU 的机器）：http://127.0.0.1:8899/?id=3554161528&fliph=1&bright=1.2&hue=15&rate=1.5
#   控制台：__wp.displayState() / __wp.setDisplay({flipH:false}) / __wp.setPlaybackRate(2)
#   一键回退：http://127.0.0.1:8899/?id=3554161528&display=legacy
```

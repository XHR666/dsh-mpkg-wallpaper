# AUDIO-BAND-SPEC —— 128 元频段数组契约（规格先行）

> 适用仓库：`we-scene-demo`（渲染器，**GPL-3.0-or-later**）。
> 本文件**只写公开契约与算法事实**（输入/输出/不变量/边界），不复制任何实现代码。
> 实现落点：`core/audio-band-array.mjs`；回归：`tests/audio-band-array-test.mjs`。
> 参照来源与台账：`THIRD-PARTY.md` §12、`docs/COPYING-RULES.md` §4 台账 #10。
> 引入日期：2026-09-16（P-103）。引入人：本仓库（渲染器侧）。

---

## 0. 为什么渲染器需要这个契约

WE 生态里"频谱"只有一种对外形态：**128 元数组**（左 0..63、右 64..127），网页 API
`wallpaperRegisterAudioListener(bands)` 与场景里的音频响应效果都按这个口径消费。

本仓库此前**没有**这一形态：`docs/AUDIO-TRACK-SPEC.md`（P-89）解决的是"**有哪些音轨文件**"
（包内扫描/去重），不是"**当前这一帧的频谱长什么样**"。缺这一层会出现两类问题：

1. **接线口径无处可写**：宿主（或未来的实时采集源）拿到左右声道频谱后，要往哪个槽位放、
   越界值怎么处理、长度是 64 还是 128 —— 没有规格就只能各写各的，最后"有的壁纸有反应、有的没有"。
2. **没有源就无法验证**：没有真实音频源时，依赖频谱的功能**一个都测不了**（既不能断言"有数据"，
   也不能断言"全零时安静"）。确定性模拟源把这件事变成可自动化的。

---

## 1. 长度契约

| 常量 | 值 | 含义 |
|---|---|---|
| `AUDIO_BAND_HALF` | `64` | 单侧频段数 |
| `AUDIO_BAND_LEN` | `128` | 数组总长：左 `0..63`、右 `64..127` |

**不变量**：输出**恒**为 128 元 `Float32Array` —— 输入短则补 0、长则截断。
调用方**不需要**再判长度（判长度的地方就有漏判的地方）。

## 2. `packBands(left, right, out?, opts?)`

### 2.1 输入

| 参数 | 形态 | 说明 |
|---|---|---|
| `left` / `right` | `ArrayLike<number>`（可空） | 单侧频段；长度可以不是 64 |
| `out` | `Float32Array`（可选） | 复用缓冲；**长度必须正好 128**，否则忽略并新建 |
| `opts.clampOnly` | `boolean` | `true` = 只做 `0..1` 钳位（真实频谱已是归一化值） |
| `opts.gamma` / `opts.gain` | `number` | 覆盖默认曲线（`gamma=1, gain=1` = 恒等，供测试/对拍） |

### 2.2 逐项步骤

```
x = 输入值 → 非有限数按 0
x = clamp(x, 0, 1)                    ← 入口就钳（脏值不进 pow）
若 clampOnly          → 输出 x
若 x ≤ 0              → 输出 0
否则                  → 输出 min(1, pow(x, gamma) × gain)
```

### 2.3 默认曲线

| 常量 | 值 | 理由 |
|---|---|---|
| `AUDIO_BAND_GAMMA` | `1.8` | 对比扩展：真实音乐 FFT 是**尖**的（底鼓瞬时近 1、间隙约 0.05）；平缓的合成波形不扩展就是"一团平泥"，阈值判定（`band > 0.5` 之类）永不成立 |
| `AUDIO_BAND_GAIN` | `1.8` | 扩展后把峰值顶回 1 附近；**与 γ 是配对常量**，改一个必须重标另一个 |

曲线性质（测试逐条断言）：端点 `0→0`、`1→1`；在 `(0,1)` 上**单调不减**；
`shape(0.2) < 0.2`（小值压深）且 `shape(0.9) > 0.9`（大值抬高）。

## 3. 确定性模拟源

`simulatedBands(t, {seed})` → `{left, right, preL, preR}`：

- **无随机数**：同一 `(t, seed)` 永远给出同一组值（自动化测试可逐位对拍；真机不会每帧抖成噪点）。
- **像音乐**：低频段（底鼓/贝斯）权重高且有**强节拍**（每秒 2.2 拍的尖峰，指数 6 压窄），
  高频段（镲片/空气声）弱而快；通道间有相位差（不互为复制）。
- **两种口径同时给**：`pre*` = 未整形的 `0..1` 原始值；`left/right` = 已按 §2.3 曲线整形。
  原因：阈值判定型消费方要峰值、积分型消费方要均值，只给一种必然顾此失彼。
- `t` 非有限 → 按 0 处理（不得产生 NaN）。

`simulatedBandArray(t, {seed})` 是便捷入口（直接给 128 元数组）。

## 4. `bandStats(arr)`（诊断）

返回 `{length, mean, peak, peakAt, nonzero, silent}`；`silent = (nonzero === 0)`。
用途：日志/diag 里一眼区分"**没有数据源**（全零）"与"**有数据但很安静**"——
这两种情况在真机上表现一样（音条不动），但处置完全不同。

## 5. 与参照来源的差异（洁净室判据）

对照 `oneincase/webwallgl`（MIT）的 `renderer/src/web.ts`：

| 维度 | 参照实现 | 本实现 |
|---|---|---|
| 命名 | `packWebAudioArray` / `packWebAudioArrayInto` / `shapeWebAudioBand` / `WEB_SIM_AUDIO_*` | `packBands` / `shapeBand` / `simulatedBands` / `bandStats` / `AUDIO_BAND_*` |
| 打包形态 | 两个函数（公共版每次新分配 + 泵内部版复用模块级单例缓冲） | **单函数 + 可选 `out` 参数**（复用与否由调用方决定，模块不留隐藏单例） |
| 曲线常量 | γ=1.8 / gain=1.8 是**导出常量 + 函数内直接引用** | 同样是具名常量，但**可经 `opts` 覆盖**（测试用恒等曲线对拍），默认值写在规格 §2.3 |
| 真实源口径 | 宿主注入的频谱**不套 γ**（在 web.ts 里靠另一个 driver 分支实现） | 同一入口的 `clampOnly` 开关表达（口径写在规格里，不靠"哪个 driver"区分） |
| 模拟源 | 复用场景侧的 `createSimulatedAudio()`（有内部状态、按 dt 推进） | **纯函数**（只依赖 `t`/`seed`，无内部状态、无 dt）⇒ 可对拍、可并行、可在测试里任意取 t |
| 诊断 | 无 | `bandStats`（silent/peak/peakAt/mean/nonzero） |

以上差异（命名/打包形态/常量覆盖方式/真实源口径表达/模拟源状态模型/新增诊断）即洁净室判据：

- 本模块按本规格重写，不是逐行翻译；`pre*` 与"未钳位"的**动机**（阈值型 vs 积分型）是公开行为事实；
- 参照仅 MIT，可借，仍按"规格先行 + 逐条差异"落地（`docs/COPYING-RULES.md` §4 台账 #10）。

## 6. 现状（**已接线**：`?bandfeed=`，2026-09-17 / P-112-BANDGEOM）

> 本节原写于 P-103（"未接线"）。2026-09-17 起本模块已接进渲染器，**接线说明与实测数字**见
> `docs/AUDIO-BAND-WIRING.md`（本文只讲契约，接线细节不在这里重复）。当前状态：

- **开关**：`?bandfeed=1|sim|real`（缺省 **关** ⇒ 一行行为都不变）。主表已登记
  （`docs/README-DIAGNOSTICS.md` 的 `bandfeed` 行）；解析点在 `demo.html` 的 `MPW-BANDFEED` 块。
- **消费点两处**：① 场景层脚本路径 —— `demo.html` 的 `audioBuffers(n)`（喂给
  `elysia/scene-scripts.js` 的官方 `registerAudioBuffers`）改为从 128 元数组重采样；
  ② 宿主路径 —— 被 iframe 嵌入时按 20Hz 节流 `postMessage` 128 元数组（**契约未确认**，
  只是"缺的那一半"的提案，见接线文档 §4 第 2 条）。
- **真实源**：渲染器自己的 `AnalyserNode`（包内 sound 层，`?audio=1` 且真的在播）⇒ `clampOnly:true`
  （不套 γ）；**没有**真实源时用本文 §3 的确定性模拟源（套 §2.3 的 γ/gain 曲线）。
  本机**没有系统声卡环回**（`docs/AUDIO-TRACK-SPEC.md`）⇒ 默认档的"真实源"指包内音频，不是系统音乐。
- **`bandStats.silent` 仍是"到底接上没有"的第一手证据**：`window.__mpwAudioBandStats()`（诊断读数）
  与 `window.__mpwAudioBandSource`（`analyser` / `simulated` / `silent`）一起给。
- **回归**：模块契约 `tests/audio-band-array-test.mjs`；接线（含反向变异必红）
  `tests/audio-band-wiring-test.mjs`。

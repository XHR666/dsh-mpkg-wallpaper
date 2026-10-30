# BASELINE.md —— 真机基线快照：抓什么、怎么跑、怎么看、阈值怎么设

> ①(§5-⑨ 2026-09-17) 本文是"**真机基线快照**"这条线的唯一说明书（采集器 / 落盘 / 对照闸门 / 阈值）。
> 相关编号：`docs/PATCHES.md` **P-109-BASELINE**；测试 `tests/baseline-test.mjs`（门禁项名 `baseline`）；
> 开关登记在 `docs/README-DIAGNOSTICS.md` 主表（`baseline` / `baselinedur` / `baselineswap` 三行）。

---

## 1. 为什么做这件事

极致清单第 ⑨ 项的原话是"**定期抓 FPS / VRAM / 启动耗时 / 壁纸切换耗时，形成趋势**"，
目的只有一个：**让"变慢了"这件事以后有数据可查，而不是凭感觉**。

★ **说清楚本仓库这台机器能做什么、不能做什么**：本机**没有 GPU、没有 WebGL2** ⇒
渲染器在本机根本跑不起来（`demo.html` 会打 `❌ 无 WebGL2！`），所以**这里一个真实数字都产不出来**。
能交付、也必须交付的是**工具链**：

| 交付件 | 位置 | 作用 |
|---|---|---|
| 采集器（浏览器侧） | `demo.html` 的 `MPW-BASELINE-BEGIN/END` 段 + `core/baseline-metrics.mjs` | 在**用户真机**上跑，按固定口径记账 |
| 落盘端点 | `server/we-scene-demo-server.mjs` 的 `POST /baseline` | 把快照写进 `reports/baselines/<时间戳>.json` |
| 对照闸门 | `tools/baseline-diff.mjs` | 两份快照逐指标对比；退化超阈值 → 非零退出码 |
| 趋势视图（多份） | `tests/baseline-trend.mjs` | ①(§5-⑧ 2026-09-17) 把 `reports/baselines/*.json` **与** `reports/real-machine/*.json` 按 (kind,id) 分组打趋势表（启动/首帧/FPS/切换/VRAM 代理 + Δ）；判定**直接调** `tools/baseline-diff.mjs` 的 `compareSnapshots()`（阈值不复制）；默认只告警，`--strict` 才退出码 1。说明书 `docs/REAL-MACHINE-AUTOMATION.md` |
| 验收 | `tests/baseline-test.mjs` | 口径/字段/代理计数/开关/退出码/默认关零行为变化 |

---

## 2. 采集什么（指标清单与**口径**）

一次采集 = 一段固定时长（默认 10s）的**只读**记账。所有算术在 `core/baseline-metrics.mjs` 里只有一份。

| 指标 | 字段 | 口径（精确到能复算） |
|---|---|---|
| FPS（滚动 500ms 窗，**中位**） | `fps.median` | 帧时间戳切成长度 500ms 的**完整**窗口，每窗 `fps = 窗内帧数 × 1000 / 500`；取这些窗的中位（**最近秩分位**，见 §4） |
| FPS 1% low | `fps.p1Low` | 最慢 **1%** 帧（至少 1 帧）的帧时间取平均 → `1000 / 平均`。看"卡顿最狠的那 1%" |
| FPS 最差/最好窗 | `fps.min` / `fps.max` | 只在完整窗上取（残窗不参与，避免虚报低帧率） |
| 每帧耗时 ms 分位 | `frames.p50/p95/p99/max/mean` | `n` = 相邻两帧 rAF 时间戳之差。⚠**这是"帧间隔"，不是"渲染开销"**（受 vsync/合成节流影响）；真正的渲染主体耗时见 `render.*`（需同时 `?perf=1`） |
| 渲染主体耗时 | `render.p50/p95/p99/max` | 仅当同时开 `?perf=1`：取 bundle stats 钩子的 `frameMs`（包住 render 调用）。未开 ⇒ `available:false` + `null`（**不编造**） |
| 启动耗时 | `startup.navToFirstFrameMs` / `firstFrameToReadyMs` / `totalMs` | 全部相对**导航起点**（`performance.now()` 的时间原点就是它）。"就绪" = **纹理齐全**或**第 90 帧**，谁先到算谁（`readyReason` = `tex-complete` / `frame-target` / `timeout`）。`totalMs` = 导航 → 就绪，是趋势主指标 |
| 导航细节 | `startup.nav` | `responseEnd` / `domContentLoadedEventEnd` / `loadEventEnd`（有导航计时条目时才有） |
| 层数/纹理/FBO | `counts.layers` / `layersVisible` / `textures` / `texMissing` / `glTexturesLive` / `glFbosLive` / `drawsPerFrame` / `uploads` / `uploadBytes` | `layers*` 来自 `scene.layers`（与 `/report` 同源）；`glTexturesLive`/`glFbosLive` = **真计数**（包装 `createTexture/deleteTexture`、`createFramebuffer/deleteFramebuffer` 的 created − deleted）；`texMissing` 与 `/report` 同判据（可见 + 非容器 + 有纹理名 + 纹理还没进来） |
| 壁纸切换耗时 | `switch.swapTo.ms` / `switch.swapBack.ms` | **整页导航口径**（见 §3.3）：换包 = 重新导航 + 建档 + 首帧 + 就绪 ⇒ 取那一页的 `startup.totalMs` |
| 设备信息 | `device.*` | `canvas` / `dpr` / `hardwareConcurrency` / `deviceMemoryGB` / `maxTextureSize` / `glVendor` / `glRenderer`（**这些是真读数**，用于判断"两份快照能不能比"） |

### 2.1 ⚠ VRAM：只有**代理**，没有真值（这一节请务必读完）

**WebGL 没有任何查询显存占用的 API**，浏览器也不暴露进程/GPU 内存 ⇒ **"显存占用 = X MB"这种话本工具永远不说**。
快照里所有内存类字段都是**代理估算**，字段名一律带 `Est`/`Proxy`，并附一段 `vramProxy.note` 写明局限：

| 代理字段 | 是什么 | 已知偏差（**别当精确值用**） |
|---|---|---|
| `vramProxy.textureBytesEst` | Σ（每张**活**纹理 level-0 的 `w×h×bpp`），bpp 按 `internalformat` 查表（RGBA=4 / RGBA16F=8 / RGBA32F=16 / RGB=3 / R8=1…认不出按 4 计并记 `unknownFormats`） | **漏 mip 链**；漏驱动的对齐/平铺/压缩；**包含 FBO 的颜色附件纹理**（它们也是 `texImage2D` 上传的，所以它更像"GPU 内存总量代理"而不是"贴图总量"）；按 `createTexture` 后的首次上传归属，**视频逐帧重传只计入 `uploadBytes` 不改活字节**（设计如此，见下） |
| `vramProxy.uploadBytes`（在 `counts` 里） | 窗口内累计上传字节 = **带宽代理**（视频纹理逐帧重传会很大） | 与采集时长相关：**只有时长相近的两份快照才能比**（`baseline-diff` 会在时长差 >5% 时告警） |
| `vramProxy.jsHeapUsedBytes` / `Total` / `Limit` | `performance.memory`（**JS 堆**，不是显存） | **只有 Chromium 系有**；Firefox/Safari 下是 `null`（快照里 `jsHeapSource` 会写明）。JS 堆大 ≠ 显存大，只能当"CPU 侧内存趋势" |
| `counts.glFbosLive` / `glTexturesLive` | 活 FBO / 活纹理**个数**（真计数） | 个数不等于字节；FBO 的字节在 `textureBytesEst` 里（附件纹理） |
| `device.deviceMemoryGB` | `navigator.deviceMemory`（粗粒度、可被指纹防护伪造） | 只能说明"大概是什么档的机器" |

**结论**：`vramProxy.*` 只对"**同一台设备 + 同一个包 + 同一档位**"的**趋势**有意义；
**不要**把它当成绝对值引用，也不要在文档/汇报里写成"显存占用"。

---

## 3. 用户真机怎么跑（照抄即可）

前置：本机起一个服务（在渲染器仓库根执行）：

```bash
node server/we-scene-demo-server.mjs 8899        # 手机与电脑同网，访问 http://<电脑IP>:8899/
```

### 3.1 一个包跑一次（最短路径）

```bash
# 真机上打开（把 <IP> 换成本机内网地址；<id> 换成你的壁纸 id）：
#   http://<IP>:8899/?id=<id>&baseline=1
```

- `?baseline=1` ⇒ 采集 **10 秒**（默认），结束后自动 `POST /baseline`，页面右下角出一行摘要。
- 想要别的时长：`?baseline=1&baselinedur=30`（2..120 秒，越界钳制并记一行警告）。
- 也可以把时长直接写在开关上：`?baseline=30`（等价于上面那条）。
- 想在**同一趟**里同时拿到"渲染主体耗时"：再加 `?perf=1`（此时 `render.*` 有值；不加就只有帧间隔分位）。

**跑哪几个包、每包跑多久**（口径建议，别一次抓太多）：

| 场景 | 建议 |
|---|---|
| 日常趋势（每包一份） | 你最常用的 **3–5 个包**，每个包 `?baseline=1`（10s）⇒ 约 1 分钟 |
| 排查"最近变慢了" | 挑**出问题的那一个包**，同一档位跑两份（改前/改后各一份），时长都用 **30s**（样本多、抖动小） |
| 换档/换包对比 | **一次只改一个变量**（`?res=` / `?q=` / `?aa=` / `?perf=` / 画布 DPR），其余照抄；两份快照的设备/画布/档位不同时，差异不能归因到代码 |
| 移动端（手机） | 建议 `?baseline=1&baselinedur=30`，**同一姿势、同一亮度、别边充电边跑**（温度降频会污染数据） |

### 3.2 结果去哪看

- **服务端**：`reports/baselines/<epoch ms>.json`（在 `MPW_REPORTS_DIR` 下，默认=工作区根的 `reports/`）。
  上限 **200 份 / 32MB**，超限"最旧先删"（上限集中在 `server/we-scene-demo-server.mjs` 的 `MPW_LIMITS`，
  可用 `MPW_LIMIT_BASELINE_MAX` / `MPW_LIMIT_BASELINE_BYTES` 现场调；对照表见 `docs/DATA-LIMITS.md`）。
- **页面上**：一行摘要 + 一条 `📊 基线采集完成 …` 日志；完整快照在 `window.__mpwBaselineSnapshot`。
- **回传失败**（没起服务/被防火墙挡）：日志会写明失败并提示从 `window.__mpwBaselineSnapshot` 手工取：
  控制台 `copy(JSON.stringify(__mpwBaselineSnapshot))` 存成 `.json`，照样能跑 `baseline-diff`（见 §5）。
- 落盘目录用的是**独立子目录 + 独立上限**：`/report` 的"60 份滚动"**不会**把基线快照删掉（趋势数据必须留得住）。

### 3.3 壁纸切换耗时（`?baselineswap=`，可选）

```bash
# 切到 <id2> 再切回 <id>，两趟各记一次（整页导航口径 ≈ 用户点插件换壁纸的真实代价）
#   http://<IP>:8899/?id=<id>&baseline=1&baselineswap=<id2>
```

流程（`mpwBaselineNextStage` 是唯一判据，测试把四档都钉住了）：**三段导航、用 `sessionStorage` 交接**——

1. 第 1 段测 `<id>`（role=primary）→ 存交接 → 跳 `<id2>`；
2. 第 2 段测 `<id2>`（role=swapTo，它的 `startup.totalMs` = **切过去**的耗时）→ 跳回 `<id>`；
3. 第 3 段测 `<id>`（role=swapBack = **切回来**的耗时）→ 合并成**一份**快照 → `POST /baseline`。

- 因此总耗时 ≈ **3 × `baselinedur`**（`?baselineswap` 时页面会打日志说明）。
- 指标取**第 1 段**（最干净）；`switch.swapTo.ms` / `switch.swapBack.ms` 分别取第 2/3 段的启动总耗时。
- 隐私/无痕模式下 `sessionStorage` 不可用 ⇒ 自动跳过切换测量、只上报单段（日志会说明，不会静默）。
- `?baselineswap=<当前包>` 会被识别为"自我导航"并直接按单段处理（防死循环）。

---

## 4. 算法口径（复算用；实现只有一份）

- **最近秩（nearest-rank）分位**：`idx = ceil(q × n) − 1`，钳到 `[0, n−1]`。
  **不做线性插值**（分位要保守，插值会把慢帧抹平）；偶数样本的 `q=0.5` 取**下中位**（不取两数平均）。
  这也是"中位"和"p50"用**同一个函数**的原因（口径唯一）。
- **1% low**：`take = max(1, ceil(n × 0.01))`，取最慢的 `take` 帧，`fps = 1000 / mean(这些帧)`。
- **滚动窗 FPS**：只统计**完整覆盖**的窗口；总时长不足一窗时给**一个** `partial:true` 的窗
  （`fps = (n−1) × 1000 / span`），这样 `?baselinedur=2` 也有数而不是空表。
- **"纹理齐全"探测**：每 250ms 一次（不是逐帧扫层，避免给真机加负担）⇒ **时间**是上界、`readyFrame` 在
  `frame-target` 档是精确的 90；`tex-complete` 档的 `readyFrame` 是探测时刻的近似值。
- **采集器不做任何 IO**：`core/baseline-metrics.mjs` 只算；落盘/摘要/跳转由 `demo.html` 的接线段做。

---

## 5. 对照与趋势：`tools/baseline-diff.mjs`

```bash
node tools/baseline-diff.mjs <基线.json> <当前.json>            # 人读表；退化 → 退出码 1
node tools/baseline-diff.mjs a.json b.json --json               # 机读（CI 用）
node tools/baseline-diff.mjs a.json b.json --quiet              # 只在有退化时打印明细
node tools/baseline-diff.mjs a.json b.json --require-same-id    # 两侧必须是同一个包，否则退出码 2
```

**退出码（唯一语义）**：`0` = 无退化（含"两份逐字段相同"）；`1` = 至少一项**退化超阈值**；
`2` = 用法/输入错误（文件缺失、JSON 坏、快照残缺、schema 不符、`--require-same-id` 不满足）。
⇒ 可以直接当回归闸门：`node tools/baseline-diff.mjs base.json new.json || echo "退化，看上面的表"`。

**判据（阈值集中在 `tools/baseline-diff.mjs` 的 `THRESHOLDS` 一处）**：

| 组 | 阈值键 | 默认 | 覆盖哪些指标 |
|---|---|---|---|
| 帧耗时 | `framePct` | **10%** | `frames.p50/p95/p99/max`、`render.p50/p95` |
| 帧率 | `fpsPct` | **5%** | `fps.median` / `fps.p1Low` / `fps.min`（**越高越好**，下降才判退化） |
| 启动耗时 | `startupPct` | **20%** | `startup.navToFirstFrameMs` / `firstFrameToReadyMs` / `totalMs` |
| 代理显存与计数 | `vramPct` | **15%** | `vramProxy.textureBytesEst` / `jsHeapUsedBytes`、`counts.glFbosLive` / `glTexturesLive` / `drawsPerFrame` / `uploadBytes` |
| 壁纸切换 | `switchPct` | **15%** | `switch.swapTo.ms` / `switch.swapBack.ms` |
| 噪声地板 | `msFloor` / `fpsFloor` / `bytesFloor` / `countFloor` | 0.5ms / 0.5fps / 1MB / 1 个 | 生效地板 = `min(配置地板, 基线绝对值)`；绝对差 ≤ 地板 ⇒ 记「噪声内」不判退化 |

- 方向：耗时/字节/计数是"**越小越好**"（涨超阈值 = 退化）；FPS 是"**越大越好**"（跌超阈值 = 退化）。
- 基线为 0 时：两侧都是 0 → 0%；`base=0 && cur>0` → `+∞`（**必须报**，不能靠除零静默放过）。
- 一侧没采集（例如未开 `?baselineswap` 时 `switch.*` 是 `null`）⇒ 记「未采集」跳过，**不当 0 比**。
- env 覆盖（键名 = `MPW_BASELINE_TH_` + 阈值键的大写下划线）：

```bash
# 例：把帧耗时阈值收紧到 5%、启动放宽到 30%
MPW_BASELINE_TH_FRAME_PCT=5 MPW_BASELINE_TH_STARTUP_PCT=30 node tools/baseline-diff.mjs a.json b.json
```

  非法 env（非数字/负数）一律**忽略并回落默认** —— 配错阈值 ≠ 关掉闸门。

### 5.1 怎么解读一份表

1. 先看**表头两侧的 id / at**：`id` 不同（或画布/档位不同）⇒ 差异**不能**归因到代码（脚本会告警，`--require-same-id` 可升级为错误）。
2. 再看 `fps.median` 与 `fps.p1Low` 的**组合**：只掉 1% low ⇒ "偶尔卡一下"（多为 GC/上传抖动/换档）；
   两个一起掉 ⇒ "整体变慢"（渲染或预算真的退化）。
3. `frames.p50` 涨而 `render.p50` 不涨（或后者没有）⇒ 大概率是**帧循环外**的因素（vsync/浏览器合成/系统负载）。
4. `startup.totalMs` 涨 ⇒ 看 `readyReason`：`tex-complete` 慢 = 纹理解码/上传慢；
   `frame-target` = 首帧后仍在等 90 帧（帧率低）；两者都涨再看 `startup.nav.*`（网络/建档）。
5. `vramProxy.textureBytesEst` 涨 ⇒ 增量在**纹理/分辨率/档位**上（`counts.glTexturesLive`、`device.canvas` 一起看）；
   单张巨图可用 `vramProxy.texBytesMaxSingle` 定位。

### 5.2 设阈值的建议

- **先攒 3–5 份"正常"快照再定阈值**：同一包同一档位连跑几次，看**自然抖动**有多大；
  阈值取"自然抖动上限的 1.5–2 倍"，否则闸门会天天红（真机噪声比抖动的绝对值大得多）。
- 阈值**按组**区分（默认已经这么做）：启动耗时（20%）天然比帧率（5%）抖得多。
- 想当**硬闸门**（例如发版前回归）：先跑基线 → 改代码 → 再跑 → `--quiet` 只看退化项；
  对"必须不许退化"的指标（如 `startup.totalMs`）可以把对应组阈值收到 10%。
- ⚠ **别用本机（无 GPU）跑出来的数字当基线**：本机没有 WebGL2 ⇒ 采集器根本不会产生快照；
  基线必须来自**用户真机**（或至少一台有 GPU/WebGL2 的机器）。

---

## 6. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 页面没反应、也没有摘要 | 开关写错了（只认 `1/on/yes/true` 或 ≥2 的秒数）；日志会打一行 `📊 基线采集=关（…）` 说明 |
| 摘要出现但服务端没文件 | 回传失败（服务没起/跨网被挡）；日志与红色徽标会写明，从 `window.__mpwBaselineSnapshot` 手工取 |
| `switch` 一直是 `null` | 没写 `?baselineswap=`；或 `sessionStorage` 不可用（无痕/不透明源）——日志会说明 |
| `render.*` 全是 `null` | 没同时开 `?perf=1`（帧间隔 ≠ 渲染开销，两者别混用） |
| `jsHeapUsedBytes` 是 `null` | 浏览器不给 `performance.memory`（Firefox/Safari）——**不是 bug**，见 §2.1 |
| 两份快照差异巨大但代码没改 | 档位/画布/DPR/后台标签页/温度降频不同；`baseline-diff` 会对 id 与时长差告警 |

---

## 7. 未定项（本节不关闭）

1. **真实 VRAM 仍然拿不到**：只能靠代理（§2.1）。若将来要更准，只有两条路：`WEBGL_debug_renderer_info`
   之外的厂商扩展（不可移植）或换平台（如 Electron + 厂商工具）——**不在本仓库范围内**。
2. **趋势图/汇总脚本**：①(§5-⑧ 2026-09-17) **汇总已做** = `tests/baseline-trend.mjs`（多份快照按
   (kind,id) 分组打趋势表 + 相邻两份 Δ/阈值判定，门禁项名 `baseline-trend`；口径与用法见
   `docs/REAL-MACHINE-AUTOMATION.md` §3）。**仍然没做的是"画图"**（现在是文本表；`reports/baselines/*.json`
   是稳定 schema，要画折线随时可加）。
3. **多实例（`?ids=`）只测 primary 实例**：其余格子的帧不进快照（避免把 N 个实例的数字混在一起）。
4. **切换测量是整页导航口径**：不是"热切换"（本渲染器没有 `?id=` 热切换路径）；
   如果将来加了热切换，需要另定一个口径字段（不能和现在的数字混在一列比）。
5. **CI 里没有真机**：本仓库门禁只验工具链（`tests/baseline-test.mjs`），
   "真机趋势"要靠用户按 §3 定期跑（跑完把 `reports/baselines/*.json` 留档即可）。

---

> **参照来源许可声明**：本文档不引用任何第三方参考实现的代码/注释/常量组织；
> 若提及 `wer-ref/`（`Aromatic05/wallpaper-engine-renderer`，**GPL-2.0-only**，非 WE 官方代码、非"真值源"），
> 仅用于**行为对照**，与本项目（GPL-3.0-or-later）许可不兼容 —— 不得复制、改写、逐行翻译其代码。

# 渲染器线 B 报告（issue0924a）—— ⑫ / ⑬ / ⑭ / ⑮ / ⑱

- 仓库：渲染器仓 `we-scene-demo/`（GPL-3.0-or-later；工作区根 = 仓库的上一级）
- 本线写权范围：`core/**`、`demo.html`、`tests/*`（渲染类新增/修改）、本报告。
- **"改前"一律指钉死提交 `151ce0a`**（本线开工时的 HEAD）：引用旧行为时同时给 `git show 151ce0a:<path>` 的路径，
  不用 `HEAD:`（本仓踩过"提交一落地 HEAD 就变成改后"的坑）。
- 我的改动在共享文件里以 `①(2026-09-24 任务 ⑬/⑫/⑭/⑮/⑱)` 注释标记；`core/we-scene-bundle.js` 与 `demo.html`
  同时含有**其它线**的未提交改动（本线没有 `git add`/commit，也没有覆盖别人的段）。
- 本机浏览器读数口径：**有头 Firefox + X `:0` + llvmpipe（软件 WebGL2）**，`renderer=llvmpipe, or similar`。
  ⚠ **这不是用户的 Adreno 830**：所有"驱动相关"的结论本报告都显式标注了"本机等价读数 / 未在 Adreno 上验证"。

## 0. 汇总（逐条状态）

| 条 | 状态 | 一句话 |
|---|---|---|
| ⑬ `videoStats` 太吵 | **已修 + 已判** | 改动前每 5s 无条件一条（真机 11:56:30/11:56:35 即此）；现"首条 + 有意义异常 + 60s 心跳"，异常 1s 地板限流但不吞；另修好"失败路径根本不打日志"。判据 21 断言 |
| ⑫ 音频条白块 / 不渲染 | **已修 + 已判（白块机制部分如实降级为"未能复现"）** | 无数据源 ⇒ 改动前该层**什么都不画**（算术模型覆盖 = 0，本机像素 0 白点）；现按上游 oneincase 语义用**时间驱动占位频谱**；渲染器侧另加"绝不喂全 0 频谱"静音地板。白色实心矩形**本机任何档都没复现**，首版"除零铺白"假设被自己的算术模型**否证**（见 §⑫.5） |
| ⑭ 真机 0x502 + 合成样例误报无 WebGL2 | **已修 + 已判（根因实锤）** | 0x502 = **格式 8(RG8) 奇数宽 + UNPACK_ALIGNMENT=4**（不是"太大"）；样例的"无 WebGL2"= **瞬时/资源性失败被报成能力缺失**（同 canvas getContext 之争已实测排除）。判据 26 + 12 断言 |
| ⑮ HDR 黑屏 | **已加"不静默黑屏"判据 + 已判（本机未复现黑屏）** | HDR 帧呈现后 3×3 采样；全黑 ⇒ 当场按 LDR 重渲对照：LDR 非黑 ⇒ 本会话退 LDR 并记账；LDR 也黑 ⇒ 判定"场景本身黑"并**恢复 HDR**。判据 16 断言；包 2902406982 本机 HDR 档 **meanLum 105.7 / 黑像素 0.16%**（非黑） |
| ⑱ 偶发漏音 | **定位到两条可复现机制 + 已判** | ①帧内 `<audio>` 是**游离元素** ⇒ 插件 `applyWebMute` 的 `querySelectorAll('video,audio')` 永远扫不到它；②`dispose()` 旧实现**不回收音频链**（元素/blob/MediaElementSource/AudioContext 全留着）⇒ 释放后照响、重挂载接不上。判据 15 断言（含"重复挂载计数不增长""muted 幂等""音量写入台账"） |

## ⑬ `[we-scene][P-68] videoStats` 是什么 + 降噪

### 现象
真机连续两条 `[we-scene][P-68] videoStats {"res":"dpr",…,"MBps":154.7,…}`（11:56:30 / 11:56:35），字段几乎全同照打。

### 它是什么（**逐字段口径**，29 项 + 2 个子对象；本次上报实测 33 个顶层字段）
改动前的产生点：`core/we-scene-bundle.js` 的 `maybeLogVideoStats()`（改前 = `git show 151ce0a:core/we-scene-bundle.js` 的
`if (now - __vstatLogAt < 5000) return`），每秒上传记账里被调用一次。**它是一条"视频帧上传台账"快照**，
不是错误行；`/report` payload 里另有同一对象的 `videoStats` 字段（`demo.html:7163`）。

| 字段 | 含义 |
|---|---|
| `res` / `tier` | `?res=` 的原始值 / 归一化档位名（`720p/1080p/1440p/2160p/auto/dpr/custom`） |
| `legacy` | 1 = 逐位兼容档（`?res=720p\|legacy`：33ms 节流、不写 `imageSmoothingQuality`、超限必走 2D 中转） |
| `canvas` / `cap` | 画布尺寸 / 视频纹理上传上限（两者同源同值） |
| `throttleMs` / `throttleFps` / `throttleSrc` | 上传节流（毫秒 / 目标 fps / 来源：档位默认、`?vthrottle=`、`url-invalid:*`） |
| `smoothing` | `imageSmoothingQuality`（legacy 档为 `low` 且**不写**该属性） |
| `mip` | 视频纹理 mip 链标记（**恒 0**：视频纹理走 `makeTexture`，不建 mip —— 大 NPOT `generateMipmap` 在部分 Adreno 静默失败） |
| `fboAutoLow` | `?fbocap=low` 是否把效果链降采样恢复成旧阶梯 |
| `src` / `up` | 视频源尺寸 / **实际上传**尺寸（`upFps` 让"源 4K、上屏 720p"这类问题一眼可读） |
| `direct` | 1 = 直传 `<video>`（源 ≤ 上限）；0 = 经 2D canvas 中转 |
| `bytesPerFrame` / `MBps` | 每帧纹理字节（`up.w*up.h*4`）/ 实测上传带宽（`bytesPerFrame × upFps / 1e6`） |
| `uploads` / `upFps` | 累计上传帧数 / 最近 1s 滑窗实测上传 fps |
| `frames` | 逐帧"视频已就绪"计数（含被节流跳过的帧） |
| `skipThrottle` / `skipNotReady` | 被节流跳过的次数 / 视频未就绪跳过的次数 |
| `viaCanvas` | 走 2D 中转的累计次数 |
| `err` | **JS 异常**次数（`texImage2D` 抛异常/catch 到的失败） |
| `upErr` / `lastUpErr` | `texImage2D` 之后 `getError()` 非 0 的**次数** / 末次错误码（0x502 等；审计 A-5 表 #6 加的） |
| `firstAt` / `lastAt` | 首次 / 末次成功上传的时间戳（`performance.now()`，ms） |
| `perfMode` / `perfLevel` / `perfFboCap` / `perfSuppressed` | `?perf=auto` 自动降级状态：模式、当前档位、效果链 FBO 倍率、被抑制次数 |
| `play{seen,play,pause,seek,rate,src}` | 脚本侧播放控制读取点计数（`__videoPlay/__videoSeek/__videoRate` 被脚本写了多少次、哪个层） |
| `tex[]` | 每个视频纹理一条：`{n 名, src 源尺寸, up 实际上传尺寸, tier, cap, direct, uploads, upFps, viaCanvas, err, lastErr}` |

> 文档漂移（**既有问题，本轮未改文档**）：`docs/README-DIAGNOSTICS.md` 的字段表写"29 个顶层字段"，
> 实测 33 个：多出的 `upErr`/`lastUpErr`（2026-09-23 审计 A-5 表 #6）与 `play`/`tex` 两个子对象。
> 本轮**刻意没有**往 `videoStats` 里加字段（避免再加深漂移）：日志台账另开 getter。

### 根因
1. 触发条件是**时间**（每 5s）而不是**有无变化** ⇒ 稳态下 120 条/10 分钟，把上报 log 环里真正有用的行挤掉；
2. 更糟的一条（本轮发现）：`maybeLogVideoStats()` 只在**成功分支**被调用（`git show 151ce0a:core/we-scene-bundle.js` 的
   视频上传 `else` 分支内）⇒ **持续失败时一行 `videoStats` 都不打**，"降噪"会把真异常一起吞掉。

### 改法（`core/we-scene-bundle.js:8471` 起，含 12357 / 12402 两处调用点）
- 触发条件改为：`first`（首条，**总是**打，`tests/video-quality-test.mjs` C4 的既有判据不变）/ `anomaly`
  （`upErr/err` 增长、`tier`、`up` 尺寸、`direct↔viaCanvas`、`upFps→0` 或腰斩、`MBps` 相对 2 倍且绝对 ≥2、
  `perfLevel` 变化）/ `heartbeat`（缺省 **60s**，`opts.vstatLogMs` 可覆盖；0 = 只打首条+异常）；
- 连续异常之间 1s 地板限流（**第一条异常永远可见**），被限流的原因累计进 `pending`，在下一条真行里
  以 `（why=…；累计 lines=…；限流期异常 N 次：…）` 一并报出；
- **失败路径也走同一判定**（`upErr` 分支与 catch 分支各加一次调用）；
- 台账 `renderer.videoStatsLog = {lines, first, heartbeat, anomaly, suppressedAnomaly, suppressedHeartbeat, lastWhy, lastAt, everyMs}`；
- `videoStats` 的字段集**冻结不动**（判据 [A7] 逐项对拍）。

### 判据
`tests/render-vstats-log-noise-test.mjs`（新，21 断言）：`[A1]` 稳态 600s ≤12 条、`[A2]` **反例**：把节奏拨回改动前的
5000ms ⇒ ≥100 条（这条让"改回去必红"）、`[A3]` 首条 `why=first`、`[A6]` 稳态 `anomaly=0`、`[A7]` 33 字段集冻结、
`[B1]` 心跳未到 + 上传报错 ⇒ 立刻一条 `why=anomaly:upErr+1`、`[B3]/[B4]/[B5]` 200 帧洪峰 ≤4 条且 `suppressedAnomaly>0`
且原因在下一条行里、`[C0..C4]` 尺寸/直传变化触发、稳态不触发、`vstatLogMs=0` 只打首条。

### 读数
- 真机（任务书）：11:56:30 与 11:56:35 两条 ≈ 每 5s 一条；本机探针同样复现"两条连续 5s 行"（`?id=3327063360`）。
- 改后：600s 稳态 **11 条**（首条 + 9~11 条心跳）；同场景按 5000ms ⇒ **121 条**（反例断言实测）。
- 配套既有门禁：`video-quality-test` 144/0、`tex-upload-guard-test` 69/0（其 ④ 段依赖"失败时不打首帧行"仍成立）。

### 未验证/边界
- `MBps`/`upFps` 的"突变"阈值（2 倍 + 2 MB/s）是本机合成读数下标定的，真机长跑可能仍偏多或偏少；
  台账里的 `suppressedHeartbeat` 可以直接回答"降噪是不是过头了"。
- 文档字段表（29 vs 33）**没动**：`docs/README-DIAGNOSTICS.md` 不在本线写权范围内。

## ⑫ 音频条：无数据源时"不渲染"与"白色实心块"

### 现象（用户原话）
「屏幕大概居中偏左出现一个白色矩形把后面完全遮挡 … 原本的渲染是可以将音频条渲染出来的，**虽然它没有数据源，
但是音频条确实是在动的** 你去看一下 oneincase 当时是怎么实现的」。

### 现场（真包 `dd/3327063360`，逐字段取证）
- `#2 纯色`（id 230）：`image=models/util/solidlayer.json`、1000×1000 @ 设计 (1499.8, 1061)（3840×2160 ⇒ 画面中央偏左）、
  特效链 `enhanced_simple_audio_bars` + `geometric_transform` + `opacity`（`fx=3`，`tex=-`）；
- `#17 Audio Bars`（id 2089）：512×512、`tint` + `simple_audio_bars_modified`（本机首帧审计 `vis=0` 跳过）；
- 两个特效**共用同一张 shader** `shaders/workshop/3082978660/effects/Simple_Audio_Bars.frag`；
  `纯色` 的 pass 常量 `Bar Color="1 1 1"`（白）、`Bounds="0 0.49"`、`Minimum Height=0`、`Anti-alias="0.05, 0.00"`。
- **关键结构事实**：`solidlayer` 纯色层的内容 = `1×1 白兜底 × layer.color`（`core/we-scene-bundle.js:12404` 的
  `__solidColored/WHITE_FALLBACK` 判据）⇒ **这一层的可见内容 100% 来自特效链**。

### 根因（两条，分开说清）
1. **"音频条没有渲染出来"（可复现，直接对应用户那句）**：没有数据源时 demo 侧送的是**全 0 频谱**
   （改前 `git show 151ce0a:demo.html` 的 `bandArrayNow` 末支：`packBands(null,null,…)` + `source='silent'`），
   而 `enhanced_simple_audio_bars` 在 `barVolume=0` 时算得 `barHeight = mix(max(Bounds.x, minBarHeight), Bounds.y, 0) = 0`
   ⇒ 圆角条 SDF 的 `Size.y=0`（零尺寸盒）⇒ `d ≥ 0` ⇒ `bar = 1 - smoothstep(e0<0, e1=0, d) = 0` ⇒ **整层透明**。
   算术模型（`tests/render-audio-bar-nodata-test.mjs` 的 `[A]` 段，480×480 采样）：覆盖 = **0.0000**。
   本机像素读数（`?id=3327063360`，包 1280×720 画布）：`?bandfeed=off` / 改前 `auto` 在该层区域 **0 个纯白像素**。
2. **白色实心矩形（本机未复现；首版假设已被否证）**：首版假设是"`smoothstep(0,0,·)` 除零 ⇒ 有的驱动判 1 ⇒ 整层铺白"，
   **被算术模型否证**：AA 两条边是 `-u_rAASmoothness.x(0.05)·k` 与 `u_rAASmoothness.y(0.00)·k = 0`，
   `e1-e0 = 0.05k > 0`，**没有 0/0**。模型下"全 0 频谱"在任何 clamp 语义下覆盖率都是 0（不画）。
   仍与"白色矩形遮挡后面"自洽的机制只剩一条：**该层是纯白内容层，特效链一旦没跑/没产出，合成就是整块白**
   （对应 `onLayerDraw.isWhite === true`；`effects-degenerate-fbo-test` 的 ①g 就是钉这个的）。
   本轮为此加了一条**具名一次性告警**（`core/we-scene-bundle.js:10863`）："层 X 的效果链没有产出内容 ⇒ 以 1×1 白兜底
   内容整块合成（尺寸/坐标/pass 数）"，此前这种情况**零日志**（用户只能看到白块、无从判断是哪层为什么）。
   边界：`materialPasses: []` 这种"链被抽空"的情形会走 copy-only 的 FBO（`outKind='fbo'`、`passes=0`），
   **不**命中这条告警 —— 只在"raw 白兜底直绘"时命中（实测三种夹具行为见报告末的探针读数）。

### 改法
- `demo.html`（`bandArrayNow` 末支，`demo.html:4651`）：缺省档 `auto` 且**无真实源** ⇒ 用**时间驱动的占位频谱**
  （`simulatedBandArray(t)`，与本仓既有 `?bandfeed=sim` 同源同曲线），标记 `source='simulated'` + `placeholder=true`
  + `reason='placeholder-no-source（…不是真实音频）'` + 一条一次性说明日志。这正是上游 oneincase/webwallgl（MIT，
  本仓 vendored 参考 `references/vendor-ref/webwallgl/renderer/vendor/we-scene/render/audio.js` 的 `createSimulatedAudio`）
  的做法：没有系统音频时纯时间驱动合成一段仿音乐频谱，静音段还留 0.012 底噪。
  **契约变更（钉死）**：`auto` 无源的语义由 `151ce0a` 的"全 0 + `silent`"改为"时间驱动占位"；
  **`?bandfeed=real|mic`（只认真实源）仍是全 0 + `silent`**，`?bandfeed=off` 仍**一次都不注入**（逐位保留）。
- `core/we-scene-bundle.js`（`bindAudioSpectrum`，`:10454`；常量 `AUDIO_SILENCE_FLOOR = 0.012` 在 `:3758`）：
  **绝不把全 0 频谱喂给作者 shader** —— 无活视图 / `hasSource=false` / 真实源**恰好全 0**（音乐暂停）⇒ 写 0.012 静音地板；
  真实源非零（哪怕 1e-4）⇒ **原样**上传（低音量是作者的合法输入，不夹取）。0.012 来自上游静音段底噪（同上文件注释）。
  台账 `audioBandsInfo().floor = {writes, floorBands, lastAt, floor}`。回退：`opts.audioFloor = 0` ⇒ 逐位回到
  "没有活视图就一个 uniform 都不写"的旧行为（旧行为**没被删**，有专门断言）。
- 为什么两层都做：占位源解决"用户看到的档（auto）不画/不动"；地板解决"任何宿主/任何档下作者 shader 都不该收到退化输入"
  （`?bandfeed=off`、宿主完全不注入、真实音频暂停这三种路径同样会命中零频谱）。

### 判据
- `tests/render-audio-bar-nodata-test.mjs`（新，20 断言）：`[A1]` 全 0 频谱 ⇒ 覆盖 = 0（**"没渲染出来"的算术复现**）、
  `[A2]/[A3]` 地板/音量 ⇒ 覆盖单调增且都很小、`[A5]` **反例：否证"两边相等除零"**、`[B1..B4]` 渲染器不变量
  （无源/静音/真实源全 0 ⇒ 地板；极小非零 ⇒ 原样；`opts.audioFloor=0` ⇒ 旧契约）、`[B6]` 地板台账、
  `[C1..C8]` demo 切片：auto 无源 ⇒ 占位且**相隔 0.35s 的两帧频谱平均绝对差 > 0.005**（"仍在动"）、
  `real|mic` 无源 ⇒ 仍全 0、`off` ⇒ 不注入、占位是 t 的确定性函数。
- `tests/render-audio-bar-motion-test.mjs`（新，浏览器 4 断言）：包 3327063360，`auto` 档确实走占位、`real` 档如实 silent、
  该层 ROI **没有大面积不透明白**（白像素 < 20%）、两档都真的出帧。
- `tests/effects-degenerate-fbo-test.mjs` 的 ③ 段**显式更新**（旧语义：③f/③g"一个都不写"；新语义：写地板），
  并保留 `③f-legacy`（`audioFloor=0`）继续钉旧行为；M2 变异（删掉 `bindAudioSpectrum` 调用）现在让 **10 条**断言变红。
- 语义变更同步更新的既有判据：`tests/audio-band-wiring-test.mjs`（T3h/T5d/T6d → 新语义 + 新增 T3h2/T5d2/T6d2 保留旧语义）、
  `tests/bench-bandfeed-switch-test.mjs`（A1 → 新语义 + 新增 A1b `?bandfeed=real` 仍全 0）。

### 读数
| 档 | 改前（`151ce0a`，本机） | 改后（本机） |
|---|---|---|
| `auto`（无源） | 层区域 0 白像素；`bandArrayNow().source='silent'`、峰值 0 | `source='simulated'`/`placeholder=true`、峰值 0.22~1.0；频谱帧间平均差 0.35s ≈ 0.02（>0.005 判据）；像素：ROI 无大面积白（<20%） |
| `sim` | 有细白条（同源） | 同（未改） |
| `real`（无源） | 全 0 + silent | **不变**（全 0 + silent） |
| `off` | 不注入 | **不变**（不注入；渲染器侧另有 0.012 地板） |

### 未验证/边界
- **白色实心矩形没有在本机复现**（任何档、任何采样都没出现"整层不透明白"）；用户手机上的具体成因**未证实**，
  本报告只把"纯白兜底内容层 + 链没产出 ⇒ 整块白"这条唯一自洽机制写成代码级判据（具名告警 + `isWhite` 台账），
  并明确**没有**把它说成已确认的真因。
- 占位频谱与真实频谱的**幅度标定**没有真机对照（`simulatedBands` 的 γ=1.8/gain=1.8 是既有值，未动）。
- 该包 `Audio Bars` 层在本机恒 `vis=0`（作者用户属性），所以"两个音频条层"只验证了 `纯色` 那一条。

## ⑭ 真机纹理上传 0x502 + 合成样例误报"无 WebGL2"

### 现象
```
⚠ [we-scene] 纹理上传报错 0x502 materials/masks/waterflow_mask_ddad9b3a.tex 1245x433（…累计 __mpwTexUploadErrs=1）
⚠ 纹理上传降档 masks/shake_mask_557be9a9 1169x726 → 1024x636（1169x726(0x502) → 1024x636）
（shake_mask 多条：263x124 / 365x251 / 767x786 / 1169x726；0x502 = GL_INVALID_OPERATION）
同一页面里合成样例：❌ 无 WebGL2！ / ❌ 启动失败: 当前浏览器不支持 WebGL2
```

### 根因（0x502，实锤）
格式 8（RG88）纹理走 `makeTextureMip` 的 **RG8/RG** 上传分支：缓冲是 `w*h*2` 的**紧密行距**，
而 WebGL 的缺省 `UNPACK_ALIGNMENT = 4` 要求每行补齐到 4 的倍数。**宽为奇数**时 `2w ≡ 2 (mod 4)`：
驱动按对齐算出的需求比提供的缓冲**每行多 2 字节** ⇒ `texImage2D` 抛 `INVALID_OPERATION`。
**"降到 1024x636 就好了"只是副作用**：1024 是偶数、行距自然 4 对齐 —— 尺寸根本没超限。
逐张对账（本仓语料 `allwallpaper/0923/2887099508`，`tests/render-tex-align-odd-test.mjs` 的 [D] 段现场重算）：
- 该包 67 张 mask 里，**"格式 8 ∧ 宽为奇数"恰好 15 张**；真机报错的 `waterflow_mask_ddad9b3a 1245x433`、
  `shake_mask_557be9a9 1169x726` 与 263x124 / 365x251 / 767x786 **全部**是它的子集；
- 同尺寸的格式 9（走 RGBA 路径，`4w` 恒 4 对齐）与**偶数宽**的格式 8（316x133 / 500x143…）全部上传正常。
活体读数（本机唯一 WebGL2：有头 Firefox + llvmpipe，探针 `/tmp/dshB/probe-align.mjs`）：
`1169x726 RG8 @align4 ⇒ 0x502`；`@align1 ⇒ 0x0`；`1168x726 RG8 @align4 ⇒ 0x0`；`1245x433 RGBA @align4 ⇒ 0x0`。
⚠ 这台是 llvmpipe（Mesa）不是 Adreno 830；但规则来自 WebGL 规范的 pixel-store 语义（行距必须是 alignment 的倍数），
**与具体驱动无关**，且"哪些尺寸/哪些格式失败"与语料逐张吻合 ⇒ 归因成立。

### 改法（0x502）
`core/we-scene-bundle.js:14412`：仅当**行距真的不 4 对齐**（`2w % 4 !== 0`，即奇数宽）时，
上传前 `pixelStorei(UNPACK_ALIGNMENT, 1)`、上传后恢复 4。偶数宽**一次 pixelStorei 都不发** ⇒
零错路径的 GL 调用序列与改动前**逐位相同**（`tests/tex-upload-guard-test.mjs` 的冻结基线不受影响）。
效果：这 15 张 mask 上传**零错且保持原尺寸**（不再掉到 1024x636，画质不再被无谓降档）。

### 根因（样例"无 WebGL2"，实测排除 + 归因缺陷）
- **排除"同 canvas 上第二次 getContext 之争"**（本机实测，`/tmp/dshB/probe-ctxfight.mjs`）：
  `webgl2` 之后再 `getContext('2d')` 恒 **null**（旧代码 `demo.html` 丢上下文处理器里那行本来就是死代码），
  `webgl2` 再取返回**同一个**上下文；只有"**先 2d 再 webgl2**"才会永久 null（本仓没有这条路径）。
  与 `docs/CANVAS-CONTEXT-AUDIT-20260925.md`（今天另一条线的只读审计）结论一致：渲染器/服务端注入面没有 A 类抢跑点。
- **排除"上下文数上限"**：本机 Firefox 连建 **24 个** WebGL2 上下文全部成功（`/tmp/dshB/probe-ctxlimit.mjs`）
  ⇒ 该机制本机无法复现。
- **真缺陷是归因**：`demo.html` 改前**一次 `getContext` 定生死**，返回 null 就直接宣称"无 WebGL2/浏览器不支持"；
  `core/we-scene-bundle.js` 拿到 null 时抛的也是 `'当前浏览器不支持 WebGL2'`（旧文案，被审计文档点名为"归因错误"）。
  规范只保证返回 null，**原因要自己问**。真机上"主包已出画、切合成样例才报"的最可能机制是
  **瞬时/资源性失败**（上一个文档的上下文尚未释放、GPU 进程复位等）被说成了能力缺失 —— 本机无法复现该时序，
  所以只把**我们自己的错报机制**钉死。

### 改法（样例）
- `demo.html:1926` 新增 `mpwAcquireWebGL2(cv, attrs)`：挂 `webglcontextcreationerror` 收 `statusMessage` +
  150/400/900ms 退避重试（共 4 次；**首次尝试与改动前逐字相同** ⇒ 成功路径零变化）；仍失败时用**新 canvas**
  探一次 webgl2/webgl1 做**三分归因**：`no-webgl2`（真不支持）/ `no-webgl2-but-webgl1`（支持 1 不给 2）/
  `canvas-context-failed`（新 canvas 能建、本画布建不出 ⇒ **不是**能力缺失）。台账 `window.__mpwCtxAcquire`
  （attempts/nullReturns/creationErrors/lastStatus/probe/reason）。
- `demo.html:1991` 归因分支逐字不同（只有 `no-webgl2` 才允许出现"确实不支持"）；
  `core/we-scene-bundle.js:8280` 的抛错文案改为如实"本画布拿不到 WebGL2 上下文 + 调用方契约"，
  **删掉**"当前浏览器不支持 WebGL2"这句误归因。
- `demo.html:2007`：`pagehide` 时对本页上下文 `WEBGL_lose_context.loseContext()`（反复挂载不再遗留上下文，
  与上面的重试是一对）。
- `demo.html:7027`：丢上下文处理器里那行**同 canvas `getContext('2d')`** 拆掉（实测恒 null，本来就是死代码；
  反过来"先 2d 再 webgl2"会永久锁死画布），改成独立浮层画提示 + `window.__mpwCtxLostHint` 读数。
- **刻意没做** `docs/CANVAS-CONTEXT-AUDIT-20260925.md` §⑤-5 建议的"`core/we-scene.mjs` 入口探针"：
  任何 `getContext` 探测都会成为该 canvas 的**第一次调用** ⇒ 要么用默认属性把 `glCanvasAttrs()`
  （alpha:false / premultipliedAlpha:false / preserveDrawingBuffer:true）静默顶掉，要么先建 2d 把画布永久锁死。
  两个后果都比"一句如实的错误信息"严重，故只在渲染器侧把误归因文案改对，探针/重试放在**宿主**（demo.html）。

### 判据
- `tests/render-tex-align-odd-test.mjs`（新，26 断言）：`[A1..A3]` 五组真机报错尺寸零错/原尺寸/未降档 + 对齐置位与恢复、
  `[B1..B4]` **反例（改回去必红）**：夹具把 `pixelStorei` 变成无效（= 改动前根本不发）⇒ 同一 mock 判 0x502 且进
  `__mpwTexUploadErrs`/`__mpwTexUploadErrLast`；偶数宽对照零错（证明判据跟奇偶走不是跟大小走）、
  `[C1]/[C2]` 偶数宽 RG8 与 RGBA 路径**一次 pixelStorei 都不发**、`[D1..D3]` **真包对账**：语料里"格式 8 ∧ 宽奇数"= 15 张、
  真机报错那两张在集合里且尺寸逐位相同、真纹理解码后走修后路径零错且保持原尺寸。
- `tests/render-ctx-acquire-test.mjs`（新，浏览器 12 断言）：注入"前 2 次 `getContext('webgl2')` 返回 null +
  `webglcontextcreationerror(statusMessage)`"⇒ 页面**仍然出帧**（`[A1]`，这条就是"改回一次定生死必红"）、
  台账 `nullReturns=2/attempts=3/reason=ok`、日志**不含**能力断言、重试行点明"瞬时/资源性"；
  `[B]` 本画布恒失败 + 新 canvas 正常 ⇒ `canvas-context-failed` 且日志说"不是浏览器不支持"；
  `[C]` 连新 canvas 都建不出 ⇒ 才允许"确实不支持"，且核心的旧归因文案已被抹掉。

### 读数
- 0x502：改前（真机日志）这 15 张 mask 全部报 0x502 并降档到 1024x636；改后（mock 规则 + 真纹理解码 + 活体规则读数）
  **0 条 0x502、保持原尺寸**。`__mpwTexUploadErrs` 不再增长（判据 [A1] 逐张钉住）。
- 样例：改前注入前 2 次失败 ⇒ 0 帧 + `❌ 无 WebGL2！`；改后同样注入 ⇒ **出帧**（`frames>0`）且日志无能力断言。

### 未验证/边界
- Adreno 830 上的真实上传行为**未直接验证**（本机是 llvmpipe）；结论依据是 WebGL 规范语义 + 语料逐张吻合 + 活体规则读数。
- 样例"无 WebGL2"的**真机时序**（上一个文档上下文未释放 / GPU 进程复位）**未复现**；
  本档只保证"不再把瞬时失败说成能力缺失，并且会重试"。
- 其它格式（10/11）与位图路径没有同类问题（`4w` 恒 4 对齐），未逐一加判据。

## ⑮ HDR 路径黑屏（包 2902406982）

### 现象
首帧审计：`前景`(vis=1 fx=1) / `单前景`(vis=0 跳过) / **`前景效果`(vis=1 fx=4)** / `----------------` /
`三角模块1..5`(跳过)，并打出 `⚠ [hdr] 场景渲进 RGBA16F FBO 1540x866（合成直绘无 gamma）` ——
**HDR 路径是开着的**（该包 `general.hdr=true` + `bloom={user:hdr,value:true}` ⇒ 自动档必然走 HDR），画面全黑。

### 本机复现（等价环境，非 Adreno）
`?id=2902406982&res=720p`（服务器 `MPW_SCENE_ROOT=<ws>/allwallpaper/0923`，端口 8896）：
- 首帧审计与本机**逐行吻合**（`前景 fx=1` / `单前景 vis=0 跳过` / **`前景效果 fx=4`** / `----------------` / 三角模块跳过），
  日志同样打出 `[hdr] 场景渲进 RGBA16F FBO 1280x720`；
- 画布像素：**meanLum 105.74 / 黑像素 0.16%**（1280×720）⇒ **不是黑屏**；`?hdr=0` 对照 meanLum 105.76。
⇒ 本机（llvmpipe 支持 `EXT_color_buffer_float/half_float`）**无法复现**黑屏，故不能给出"真因"（不猜）。

### 渲染器侧能确定的事实
`前景效果` 是 `models/util/projectlayer.json` 的**整屏合成层**（3840×2160）+ 4 条效果
（`waterwaves` / `chromatic_aberration`（`AUDIOPROCESSING=3` + 音频常量）/ `tint` / `blur`，共 6 个 pass）⇒
**它一旦输出黑，就是整屏黑**。HDR 路径已有的防线（`getFBO` 16F→32F→RGBA8→1×1 逐级完整性回退、
逐层 `getError` 前后对照的会话熔断、`[hdr] 呈现失败` 日志）**都不覆盖"GL 无错但画布全黑"**这种形态
（用户日志里也没有熔断行、没有呈现失败行）⇒ 改动前这是**静默黑屏**。

### 改法（不静默黑屏 + 如实降级记账）
`core/we-scene-bundle.js:9530`（采样器 `hdrSampleCanvas`）+ `:12037`（HDR 帧判定）+ `:12077`（LDR 对照帧收尾）：
- HDR 帧呈现之后，对当前帧目标做 **3×3 `readPixels` 采样**（只读、不改 GL 状态、**每帧一次**）；
- 全黑 ⇒ 记 `hdrBlack.seen` + 一条 ⚠ 日志，并**当场按 LDR 重渲同一帧**做对照（复用既有熔断的重渲机制）；
- LDR 对照帧**非黑** ⇒ 确认 HDR 管线在本设备不可用 ⇒ 本会话退回 LDR，`renderer.hdrFallback = {path:'black-first-frame', reason, at}` 留台账；
- LDR 对照帧**也全黑** ⇒ 判定"**场景本身就是黑的**"（夜间壁纸/黑场）⇒ **恢复 HDR**，不误伤；
- `?hdr=1` 显式强制档：全黑也**不**自动退回（与既有"逐层错误熔断"的诊断口径一致），但**大声记账**（日志 + `renderer.hdrBlack`）。
- 新增只读台账 `renderer.hdrBlack = {seen, probe:{probes,last,retried}}`。

### 判据
`tests/render-hdr-black-guard-test.mjs`（新，16 断言）：`[0]` 夹具前提（`general.hdr=true`+`bloom=true` ⇒ 自动档要 HDR，
与 2902406982 一致）、`[A1..A6]` HDR 全黑 + LDR 非黑 ⇒ 台账 `path='black-first-frame'`、两条日志、
**真的重渲了本帧**（clear ≥2、采样 18 点）、只采样两次（不是每帧回读）、台账可查、
`[B1..B3]` 两帧都黑 ⇒ `hdrFallback` 回到 null + "场景本身就是黑的"HDR 已恢复、`seen` 仍留证、
`[C1..C3]` HDR 非黑 ⇒ 不降级、只采样 9 点、无日志（无假阳性、零额外开销）、
`[D1..D3]` `?hdr=1` + 全黑 ⇒ 不退回但记账 + ⚠ 日志。

### 读数
- 改前（本机）：包 2902406982 HDR 档 meanLum 105.74 / 黑像素 0.16%（非黑；无黑屏可降级）。真机：整幅黑 + 零日志。
- 改后（合成夹具）：HDR 帧全黑 ⇒ 一次 LDR 对照 ⇒ 台账 + 两条日志 + 本会话 LDR（16 断言全绿）。
- 既有 HDR 门禁：`hdr-predicate-test` 21/0、`hdr-bloom-test` ALL PASS、`canvas-capture-test` 50/0。

### 未验证/边界
- **真因未定**（本机复现不出黑屏）：`EXT_color_buffer_float` 在但半浮点 RT 实际不可用 / 呈现 pass 未落画布 /
  效果链真输出黑，这三种在渲染器侧**无法互相区分**；本档的贡献是"不再静默"+"按对照结果如实降级/恢复"。
- 采样成本：每帧一次 9 点 `readPixels` 只在 **HDR 激活**时发生（`?hdr=0`/LDR 路径零开销）；本机 llvmpipe
  未量到可测帧率差（~2fps 环境，分辨不出来）。
- `前景效果` 的 6 个 pass 在真机上到底哪个失败，**没有证据**（用户日志没给 GL 错误码）。

## ⑱ 偶发漏音（渲染器侧）

### 定位到的两条**可复现机制**
1. **帧内 `<audio>` 是游离元素 ⇒ 宿主静音看不到它**。插件 `../dsh-mpkg-wallpaper/lib/client.js:4296 applyWebMute`
   的帧内静音口径是 `frame.contentDocument.querySelectorAll('video,audio')` 逐元素写 `muted`；
   而本页**视频**路径一直 `document.body.appendChild(videoEl)`，**音频**路径是 `new Audio()`（不在文档树里）
   ⇒ 那趟扫描**永远扫不到它** ⇒ 宿主静音了、BGM 照响。"偶发"取决于宿主静音趟（800ms/2s）与音频元素
   创建/播放（首帧之后）的先后。
2. **释放/重挂不回收音频链**。`mpwHandle.dispose()`（测试台/宿主的显式释放路径）改前只暂停/撤销**视频**元素与清纹理
   （`git show 151ce0a:demo.html` 的 dispose 段），`sceneAudio` 的 `<audio>`、blob URL、MediaElementSource
   与 AudioContext **一个都不动** ⇒ `__wp.release()` 之后声音继续放；同一文档里再挂载时 `sceneAudio.started`
   仍是 true ⇒ 新实例接不上音频、旧元素继续响（"漏音 + 声音对不上画面"）。

### 改法（`demo.html`）
- `:4380` `makeSoundElement`：把 `<audio>` **挂进文档树**（与视频元素同款 2×2/透明/不挡指针），
  并记 `el.__mpwBlobUrl` 供释放撤销；建元素时**跟随宿主静音位**（同源 `window.frameElement.muted`，
  `:4339 hostEmbedMuted`）⇒ 关掉"先出声、下一趟静音才轮到"的窗口。
- `:4473` 新增 `mpwReleaseSceneAudio()`（dispose 调用，`demo.html:8659`）：pause 每个元素 → 撤销 blob URL →
  移出文档 → `MediaElementSource.disconnect()` → `analyser.disconnect()` → `AudioContext.close()` →
  清引用并 `started=false`（幂等）。
- `:4511` `updateSceneAudioVolume`：**幂等写**（值没变不写 —— 对正在播放的音频，一次"没变的重写"在某些实现上
  就是一次可听见的打断），且**绝不写 `muted`**（宿主静音位不被音量路径后写覆盖）。
- `:4334` 台账 `window.__mpwAudioLedger = {elsCreated, elsReleased, ctxCreated, ctxClosed, volumeWrites, muteWrites, attaches, lastAt}`
  —— 判据读它（"计数不增长""muted 幂等""音量写入有台账"三条都能量化）。

### 判据
- `tests/render-audio-leak-test.mjs`（新，15 断言）：`[A2]` **元素在文档树里**（游离 = 机制①复现点）、
  `[A4]` 宿主静音扫描（等价动作：对扫到的元素写 `muted`）**真的生效**、`[B1]/[B2]` 音量幂等写、
  `[B3]` `muted` 由音量路径写 0 次、`[C1..C7]` 释放后不留在页面上/pause 过/blob 撤销/上下文配平
  （`ctxCreated === ctxClosed === 轮数`）/**4 轮挂载-释放后"活着元素数"恒为 1 不增长**/建放配平/`started=false`、
  `[C8]` 台账可机读。
- `tests/audio-semantics-test.mjs`（既有，新增 4 条 ⑱ 断言：挂树计数、建挂一一对应、音量幂等、`muted` 写入 = 0；
  既有的 21 条一条没动，现 25/25）。
- 活体读数（本机，`?id=3327063360&audio=1&shell=0&noreport`）：改后 `document.querySelectorAll('audio').length = 1`
  （改前 = 0，游离），宿主静音等价动作后 `muted = true` 且保持，台账 `{elsCreated:1, attaches:1, ctxCreated:1, volumeWrites:0, muteWrites:0}`。

### 未验证/边界
- 插件侧 `applyWebMute` **一行没改**（写权范围外）；本线的修法是"让渲染器建的元素**可被**那趟扫描看到"，
  真机端到端（插件静音开关 ↔ 帧内 BGM 真的停）**未在手机上验证**。
- `?audio=1` 路径才有 `<audio>`（默认不开音轨）；`mpwHandle.dispose()` 的调用方是宿主/测试台，
  "重复挂载"在**同一文档**内才走这条清理（换文档自然重来）。
- 音频面板（另一模块）自己的 `<audio>`/AudioContext 生命周期**不在本线范围**（`demo.html` 的 `__mpwAudio` 面板独立）。

## 附：本轮跑过的命令与最终读数

Node（无需锁）：
```
node tests/demo-syntax-check.mjs                     → demo 内联脚本语法 11/11 通过
node tests/render-vstats-log-noise-test.mjs          → PASS=21 FAIL=0
node tests/render-tex-align-odd-test.mjs             → PASS=26 FAIL=0
node tests/render-audio-bar-nodata-test.mjs          → PASS=20 FAIL=0
node tests/render-hdr-black-guard-test.mjs           → PASS=16 FAIL=0
node tests/render-audio-leak-test.mjs                → PASS=15 FAIL=0
node tests/video-quality-test.mjs                    → PASS=144 FAIL=0
node tests/tex-upload-guard-test.mjs                 → 69 通过 / 0 失败
node tests/effects-degenerate-fbo-test.mjs           → 40 通过 / 0 失败（含 M1/M2/M3 变异自证）
node tests/audio-semantics-test.mjs                  → 25/25（含新增 4 条 ⑱ 断言）
node tests/audio-band-wiring-test.mjs                → ALL PASS（含 T3h/T5d/T6d 语义更新 + 旧语义保留项）
node tests/bench-bandfeed-switch-test.mjs            → ALL PASS（55 项）
node tests/hdr-predicate-test.mjs                    → 21 通过 / 0 失败
node tests/hdr-bloom-test.mjs                        → ALL PASS
node tests/canvas-capture-test.mjs                   → ALL PASS (50 项)
node tests/quality-tiers-test.mjs                    → 42 通过 / 0 失败（getContext 来源判据**收紧**后）
node tests/issue-fluidsim-3840-test.mjs              → 25 通过 / 0 失败
node tests/clock-combo-visible-test.mjs              → 28 通过 / 0 失败
node tests/mock-gl-test.mjs                          → 60 / 0
node tests/script-runtime-errors-test.mjs            → ALL PASS (24)
node tests/script-phase-order-test.mjs               → ALL PASS (37)
node tests/script-tick-test.mjs                      → 16 / 0
node tests/particle-render-correctness-test.mjs      → 120 / 0
node tests/particle-children-test.mjs                → 67 / 0
node tests/baseline-test.mjs                         → ALL PASS (130)
node tests/tex-container-variant-test.mjs / tex-fmt5-test.mjs / solidlayer-fallback-test.mjs → 通过
```
浏览器（`flock /tmp/.mpw-firefox.lock -c …`，同一时刻一个 Firefox）：
```
flock … 'node tests/render-ctx-acquire-test.mjs'         → PASS=12 FAIL=0
flock … 'node tests/render-audio-bar-motion-test.mjs'    → PASS=4  FAIL=0
```
**最终汇总行**：`⑬ 21/0 · ⑭ 26/0 + 12/0 · ⑫ 20/0 + 4/0 · ⑮ 16/0 · ⑱ 15/0；相关既有门禁 25 个文件全绿（0 失败）`

## 附：本轮新增/修改的判据清单（含"改回去必红"反例）

| 判据文件 | 断言数 | 反例/变异断言 |
|---|---|---|
| `tests/render-vstats-log-noise-test.mjs` | 21 | `[A2]` 把节奏拨回 5000ms ⇒ ≥100 条（旧行为必红）；`[B1..B5]` 异常不吞 |
| `tests/render-tex-align-odd-test.mjs` | 26 | `[B1]` 夹具退回"不发 pixelStorei" ⇒ 同一 mock 必判 0x502 |
| `tests/render-audio-bar-nodata-test.mjs` | 20 | `[A1]` 全 0 ⇒ 覆盖 0（旧行为=不画）；`[B5]` `audioFloor=0` 保留旧契约；`[A5]` 否证除零假设 |
| `tests/render-audio-bar-motion-test.mjs` | 4 | —（像素级只留稳定判据，"在动"由上一个文件的 `[C2]` 承担） |
| `tests/render-ctx-acquire-test.mjs` | 12 | `[A1]` 注入前 2 次失败若仍出帧 ⇒ 一次定生死的旧实现必红 |
| `tests/render-hdr-black-guard-test.mjs` | 16 | `[C1]` 正常 HDR 不许降级（假阳性防线）；`[B1]` 场景本身黑必须恢复 HDR |
| `tests/render-audio-leak-test.mjs` | 15 | `[A2]` 游离元素⇒扫描扫不到（机制①的复现点）；`[C5]` 4 轮挂载不增长 |
| `tests/effects-degenerate-fbo-test.mjs`（改） | 40 | M2 变异（删 `bindAudioSpectrum`）⇒ 10 条变红（含地板三条） |
| `tests/quality-tiers-test.mjs`（改） | 42 | getContext 来源判据收紧：写死属性 0 + helper 形参唯一 + 唯一调用点带 `glCanvasAttrs` |
| `tests/audio-semantics-test.mjs`（改） | 25 | 新增 ⑱a–⑱d 四条（挂树/一一对应/幂等/不写 muted） |
| `tests/audio-band-wiring-test.mjs`（改） | ALL | T3h/T5d/T6d 新语义 + T3h2/T5d2/T6d2 旧语义保留 |
| `tests/bench-bandfeed-switch-test.mjs`（改） | 55 | A1 新语义 + A1b `?bandfeed=real` 仍全 0 |

## 附：语义变更台账（**旧语义 = 钉死提交 `151ce0a`**）

| 变更 | 旧（`git show 151ce0a:<path>`） | 新 | 迁移的既有判据 |
|---|---|---|---|
| `?bandfeed=auto` 无源 | 全 0 + `source='silent'`（`demo.html` 的 `bandArrayNow` 末支） | 时间驱动占位（`source='simulated'` + `placeholder=true`） | `audio-band-wiring-test` T3h/T5d/T6d、`bench-bandfeed-switch-test` A1 |
| 无活视图/静音频谱 | `bindAudioSpectrum` 一个 uniform 都不写（`core/we-scene-bundle.js`） | 写 0.012 静音地板（`opts.audioFloor=0` 可回退） | `effects-degenerate-fbo-test` ③f/③g（保留 ③f-legacy） |
| `videoStats` 日志节奏 | 每 5s 无条件一条、失败路径不打（`maybeLogVideoStats`） | 首条 + 异常 + 60s 心跳（异常不吞） | `video-quality-test` C4 前缀不变；新增降噪档 |
| 渲染器拿不到上下文 | `throw new Error('当前浏览器不支持 WebGL2')` | 如实"本画布拿不到 WebGL2 上下文 + 调用方契约" | `render-ctx-acquire-test` C2b |
| `getContext('webgl2')` 来源 | 两处直接调用（`demo.html`） | 直接 1 处 + `mpwAcquireWebGL2` 形参 1 处（唯一调用点仍传 `glCanvasAttrs`） | `quality-tiers-test` 收紧后的判据 |

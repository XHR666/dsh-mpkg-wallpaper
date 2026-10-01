# 转码生命周期（H1「半完成状态」/ H2「关档不回退 + 过曝」）

> 触发：用户 2026-09-28 原话（两段，逐条对应本文件）——
> ①「我把壁纸设置里面的**视频预缩档**从按屏幕物理尺寸点了一下（我本来是关的状态）。点了一下之后
>   （**把我的壁纸清除掉了**，但是我又直接点了关），我又切回到关的状态 —— 也就是说，**按屏幕物理
>   尺寸还没加载出来，我就点击了关闭**。这时候**壁纸就加载不出来了**（包括刷新和清除了，重新再
>   使用就加载不出来），**但是过一会儿又能加载出来了**。但是我点了一下刷新壁纸，又是过一会儿才
>   能加载出来的。」
> ②「现在我不清楚，虽然我把那个关掉了，它现在**可能跑的还是 FFMpeg 转译后的状态**，因为我感觉
>   这个壁纸**相比之前有点过曝了**。……这 FFMpeg 引起一堆 bug。」
>
> 结论先行：**H1 证实**（两层根因，已修 + 判据）；**H2 部分证伪**（8bit 源不丢色彩、关档确实回退
> 原文件；真问题是 **>8bit/HDR 源被原样转成 10bit**，已修 + 记账）。读数与未验证边界都在 §4/§7。

## 0. TL;DR

| 判定 | 结论 | 关键读数 |
|---|---|---|
| H1 半完成状态 | **证实**（两层） | 切档断开后验活请求收 `502 {ok:false,error:'cancelled'}`；客户端把"被取消"读成"源不可用" ⇒ 撤 src + 隐藏壁纸层；否定答案被缓存 20s ⇒ 20s 内每次 apply 复发，过期后自愈 = 用户说的"过一会儿又能加载出来" |
| H2 关档不回退 | **证伪**（默认档） | `preScale=0 且 fpsCap=0 且 resMax=0` ⇒ `useTranscode=false`、`playUrl=原文件`；缓存键带档位（`maxW`+`scale`）⇒ 开/关档是两份产物，不互相顶替 |
| H2 过曝 / 色彩丢失 | **证伪（8bit 源）** / **证实（>8bit·HDR）** | 8bit tv·bt709 / 未标注 / 全范围 pc 三种源：标签逐字保留，YAVG Δ = **−0.05 / +0.21 / 0.21**（阈值 1.0/255）；10bit HDR 源：旧命令产物 **仍是 `High 10 / yuv420p10le`**（浏览器多数无 High10 解码器 ⇒ 黑屏），已改显式降 8bit |

## 1. 链路图（一行一步；符号为准，行号会漂）

1. 设置面板点档 → `setPreScale(v)` → `commit({preScale:v}, true)` + `applyFromStorage()`（`lib/client.js` 面板段）
2. `applyFromStorageInner()` → `mpwPhysicalWidth` → `mpwPrescaleTargetW` → **`mpwTranscodeSpec(preScaleW,resMaxN,fpsCapN,image,isSceneVideo,hostUrl)`**（`lib/client.js:427`，**唯一规格判据**）⇒ `{useTranscode, fps, maxW, scale, playUrl}`
3. `playUrl = hostBustTick ? bustUrl(playUrl0, hostBustTick) : playUrl0`（`lib/client.js:7828`）
4. `showVideoEl(playUrl)`（`lib/client.js:3630`）→ 换源即 `mpwArmAbortAll` + `mpwArmProbeCache.clear()` → `video.src = playUrl`
5. `mpwVerifyArm("video", u, onBad, onOk)`（`lib/client.js:1840`）→ `mpwArmProbeUrl(u)`（转码档追加 **`&player=verify`**，`lib/client.js:1738`）→ `Range: bytes=0-0` 轻量验活
6. 宿主 `/transcode` 路由（`lib/index.js`，`if (player === 'verify')` @4782）：
   · 有效产物 ⇒ 206 直出；· 无产物/正在转 ⇒ **202 `{ok:true,pending}`（绝不为此起/续 ffmpeg）**
7. 播放请求（同一 URL，无 `player`）→ `acquireTranscodeRef(cachePath)` 登记引用 → `transcodeToFps`（`lib/index.js:2136`）
8. `transcodeProductPath`（`lib/index.js:918`，**唯一产物路径构造点**）→ 缓存命中判据 `isValidTranscodeProduct`（`lib/index.js:901`：**最终名 + ≥1024B + ISO-BMFF `ftyp` 魔数**）
9. `TRANSCODE_INFLIGHT`（`lib/index.js:1085`）= `cachePath → {p, refs:Set<token>, gen, procs}`；`gen = ++TRANSCODE_GEN`（**代际**）
10. `transcodeColorPlan(getVideoProbe(src))`（`lib/index.js:875`）⇒ 8bit ⇒ `args=[]`；>8bit/HDR ⇒ `-pix_fmt yuv420p -colorspace/-color_primaries/-color_trc bt709 -color_range tv`
11. `materializeSource`（mpkg 条目 → 临时文件）→ `runTranscode`（`lib/index.js:2044`）→ `spawnFfmpeg(ff, args, cachePath)`（`ACTIVE_FFMPEG: proc→cachePath`）
12. 写 `<cachePath>.tmp<pid>` → 退出 0 且**产物有效** → `renameSync` 发布 → 台账 `phase:'done'` + `gen`
13. 请求断开/切档 ⇒ `onAbort` → `releaseTranscodeRef` → **只有 `refs.size===0` 才** `killTranscodeProcs(cachePath)` → `cancelled` 进台账（`phase:'cancelled'`）
14. 客户端失败/超时/探测判定可直读 ⇒ **唯一回退落点** `mpwFallbackToDirect(vid, hostUrl, why)`（`lib/client.js:1864`：清"源不可用"状态 + 重置管线 + 给原片挂新验活）
15. 判据：`tools/prescale-switch-race-test.mjs`（H1）、`tools/transcode-color-fidelity-test.mjs`（H2）

## 2. H1 根因（证实）+ 修法 + 回退口

### 根因 A（宿主，`lib/index.js`）：验活请求与播放请求**共享同一个转码任务**，取消语义被"归属"污染

* 一次 `/transcode` 实际来**两个**请求：`<video>` 播放请求 + 客户端 `Range: bytes=0-0` 验活请求。
* 旧实现两者都进 `TRANSCODE_INFLIGHT`（`cachePath → Promise`）去重；`onAbort` 按"本请求之后启动的
  全部 ffmpeg"过滤后 `kill` ⇒ **播放请求一断开（用户切档）就杀掉共享任务**，验活请求随即收到
  `502 {ok:false,error:'cancelled'}`。
* 修法：`TRANSCODE_INFLIGHT` 升级为**引用计数 + 代际**条目（`acquireTranscodeRef`/`releaseTranscodeRef`
  /`killTranscodeProcs`，`lib/index.js:932-958`）；ffmpeg 子进程打上 `cachePath` 标记 ⇒ **只杀本任务**；
  验活请求走**独立分支**（`player=verify`，`lib/index.js:4782`）：**绝不为它起/续 ffmpeg**。
* 台账：`cancelled` 是**独立终态**（不是 `error`），`/transcode-progress` 回 `{phase:'cancelled', gen, error}`。
* 顺带堵掉同步探测窗口：`/probe` 用 `execFileSync('ffprobe')`（视频+音频两次、各 15s 上限）**阻塞**
  事件循环；客户端若在阻塞里断开，`'close'` 早于监听器挂上 ⇒ 补一次 `res.destroyed/req.destroyed/
  req.aborted` 判定（`lib/index.js` 路由 onAbort 之后）。

### 根因 B（客户端，`lib/client.js`）：验活裁决**没有代际**，否定答案被缓存 20s

* 旧 `mpwVerifyArm` 的 `onBad` 闭包只认"元素"，不认"验证的是哪个 URL / 哪一次挂载" ⇒ 预缩档的验活
  要等宿主转码（几十秒~分钟），期间用户切回关（新源=原片已挂好）⇒ **迟到的 `{ok:false}` 撤掉新源 +
  把壁纸层 `display:none`**（`mpwBgArmErrorSet`）＝ 用户说的"壁纸就加载不出来了"。
* 旧 `mpwArmProbeCache` 对否定答案一视同仁缓存 **20s** ⇒ 期间每次 apply（**刷新壁纸 / 清空重选 /
  无关设置落点**）都复用它 ⇒ 反复复发；20s 过期后第一次 apply 就恢复 ＝"过一会儿又能加载出来"。
* 还有一条让"刷新壁纸"像没反应的：`refreshBg` 只给**直读 URL** 加 `&_t=`，转码档 URL 逐字不变，
  而 `showVideoEl` 有"src 相同就不重设"的守卫 ⇒ 转码档上刷新**完全没动作**。
* 修法：
  · `mpwArmVerdictApplies(verdictUrl, mountedUrl, armSig, curSig)`（`lib/client.js:1746`，纯函数）——
    裁决**只对"它验证的那一次挂载"有效**，否则丢弃并留一行日志，**不动 DOM**；
  · 缓存口径：可用 20s / **不可用 3s**（`mpwArmCacheUsable`，`MPW_ARM_NEG_TTL_MS=3000`）+ 换源 `clear()`；
  · 验活请求：转码档带 `player=verify`（`mpwArmProbeUrl`）+ `AbortController` 可中断（`mpwArmAbortAll`）；
  · 验活**成功**即 `mpwBgArmErrorClear()`（确定性恢复，不必等下一次 apply）；
  · **回退落点唯一**：`mpwFallbackToDirect`（`lib/client.js:1864`）内含 `mpwBgArmErrorClear()` + 给原片挂
    新验活（旧实现只换 src ⇒ 层还是 `display:none`，换回来的原片照样看不见）；
  · `refreshBg` 的 `&_t=` 现在也击穿**转码档** URL；
  · `pollTranscodeProgress` / 10s 超时轮询把 `cancelled` 当终态（不再空转 20min / 3min）。

### 回退口（现场可一键回到旧行为）

| 口 | 作用 |
|---|---|
| `?mpwtranscode=legacy` | （既有）不看 `/probe`，一律按设置转码 |
| `?mpwtranscode=aggressive` | （既有）连用户设置的上限也先探测，可直读就直读 |
| `?bgwrapfix=legacy` | （既有）关掉"有源没挂上"的补挂校验 |
| `DSH_WE_TRANSCODE_COLOR=legacy` | **新** 色彩参数一个都不加（完全回到改动前的 argv） |
| `DSH_WE_TRANSCODE_COLOR=force8` | **新** 恒加 `-pix_fmt yuv420p` + bt709（现场"过曝"对照实验用） |
| `DSH_WE_TRANSCODE_MIN_PRODUCT_BYTES` | **新** 产物有效性阈值（默认 1024B），调到 1 可关掉大小闸门（魔数仍在） |

## 3. H2 根因 / 判定 + 修法

* **关档不回退**：证伪。`mpwTranscodeSpec` 在 `preScaleW=0 且 fpsCap=0 且 resMax=0` 时 `useTranscode=false`、
  `playUrl=hostUrl`（原文件）；`transcodeKey` 含 `maxW` 与 `|s:<flag>` ⇒ 开/关档是**两份**产物。
  判据：race-test A6（切真实现）、B1j（`/custom-media` 200 且**字节一致**）。
* **过曝 / 色彩丢失**：8bit 源证伪（读数见 §4）；真问题在 **>8bit / HDR**：
  旧 argv 不带 `-pix_fmt` ⇒ ffmpeg 跟着源走 ⇒ 产物仍是 `High 10 / yuv420p10le`，而这条路的**存在理由**
  正是"浏览器吃不下才转"（`browserPlayable` 判 HEVC Main10 为 not playable）。
  另外 `browserCodecGap` 此前只认 HEVC Main10 ⇒ **H.264 High 10/4:2:2/4:4:4 会被判"可直读"、根本不转码**
  （黑屏且无救），本轮一并补上（`lib/index.js:993`）。
* 修法：`transcodeColorPlan`（`lib/index.js:875`）+ `runTranscode` 的 `colorArgs` 注入点。
  **8bit 源一个参数都不加**（既有产物继续命中、与改动前逐字节相同）；>8bit/HDR ⇒ 显式
  `-pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`，
  并把 `colorPlan/colorFrom/colorTo/colorDowngrade/colorReason` 写进台账 + 启动日志（**不许静默降级**）。
  ⚠ 诚实边界：**没有 tonemap**（ffmpeg-static b6.0 不带 libzimg/zscale，`tonemap` 滤镜不可用）——
  "能播 vs 好看"之间明确选**能播**。

## 4. 实测读数（真 ffmpeg 4.4.2 / 合成源，命令 = runTranscode 的逐字 argv）

| 源 | 产物（旧命令） | 产物（本策略） | YAVG 源→产物 | 判定 |
|---|---|---|---|---|
| 8bit `yuv420p` tv·bt709·bt709·bt709 | 标签逐字保留 | 同（无参数） | 103.78 → 103.73（**Δ −0.049**） | 忠实 |
| 8bit 全范围 `yuvj420p` pc | 仍 `pc` | 同（无参数） | 102.28 → 102.49（**Δ +0.209**） | 忠实（pc 直通） |
| 8bit `yuv420p` 未标注（工作区语料 `wallpaper.mp4` 3840×2160@60，4K→1920） | 仍未标注 | — | 158.876 → 158.897（**Δ +0.021**） | 忠实 |
| 8bit tv·bt709（工作区语料 `夜莺_透明4.mp4` 960×1008，→640） | `tv/bt709/bt709/bt709` 全保留 | — | 95.19 → 95.19 | 忠实 |
| **HEVC Main10 + bt2020nc + smpte2084(PQ)**（10bit） | **`High 10 / yuv420p10le`**（多数浏览器黑屏） | `yuv420p` / bt709 / tv（8bit） | 103.84 → 103.87（**量程归一后 Δ +0.03**：只做位深重标定，无 tonemap） | 旧=不可播；新=可播 |

* 阈值：同尺寸/同内容下 **|ΔYAVG| ≤ 1.0/255**（C1b/C2b 断言）。
* 尺寸断言：源 128×96 + `maxW=64` ⇒ 产物 64×48（保持宽高比）。
* ⚠ 未验证边界：HDR 夹具是"**打了** PQ/BT.2020 标签"的合成片段（lavfi 不产真 PQ 编码数据）
  ⇒ "缺 tonemap 在**真** HDR 素材上的观感偏暗"这条**测不到**（本机无真 HDR 语料）。
* 另注：用户机器上 8 份真实转码产物里 7 份是 `yuvj420p/pc/bt470bg`（= 源为全范围、pc 直通），
  1 份是 `yuv420p/tv/bt709`。这属于**忠实直通**，不是"过曝"来源；但我**无法把它们与源配对**
  （缓存键含源 mtime，源文件已被重传/移动；暴力枚举 286 个候选 × 全部 fps/maxW/scale 组合 0 命中）
  ⇒ 这一条的溯源如实记为**未完成**。

## 5. 判据与变异读数

`node tools/prescale-switch-race-test.mjs` ⇒ **44 通过 / 0 失败**（A 客户端真切片 12 条 + B 宿主真路由 17 条 + C 变异 7 组 + 磁盘卫生 3 条；夹具 ≤ 2MB、不真跑 ffmpeg）：

| 项 | 读数 |
|---|---|
| B1b 切档时验活请求 | **202 `{ok:true,pending}`**（旧实现：共享任务被 kill ⇒ 502 `{ok:false}`） |
| B1d/B1e 断开 | 只 kill 本任务 ×1；被取消的播放请求 **status=0**（不写 502） |
| B1f/B1h 半成品 | 无 `tc_*.mp4`、无 `.tmp` 残留；条目 `refs=0` |
| B1g/B1i 台账 | `phase:'cancelled'` + `gen:1`（`/transcode-progress` 可读） |
| B1j 关档回到可用源 | `/custom-media` **200，65552/65552 字节一致** |
| B2 归属 | A 断开 ⇒ 日志"仍有 1 个在飞请求要这份产物 → 不 kill"；B **200 + 4096B** |
| B3 无效产物 | 0B / 无 `ftyp` 的 4096B 垃圾 ⇒ 删除 + **重转**，第二次命中新产物 |
| B4 验活角色 | 无产物 **202 verify-miss，starts=0**；有产物 206 直出且不起 ffmpeg |
| 变异 | M1 去代际 ⇒ 迟到裁决撤掉原片 + 隐藏层（src=null/display=none）；M2 否定 TTL 回 20s ⇒ A3 红；M3 去魔数 ⇒ 垃圾被当缓存流出（starts=0）；M4 去引用计数 ⇒ A 断开误杀 B（killed=1，B 非 200）；M5 拆验活角色 ⇒ 一次验活真起 ffmpeg（starts=1）；M6 取消写成 error ⇒ 台账 phase=error；M7 关档判成转码 ⇒ playUrl 指回 `/transcode` |

`node tools/transcode-color-fidelity-test.mjs` ⇒ **24 通过 / 0 失败 / 0 SKIP**（本机有 ffmpeg）：

| 项 | 读数 |
|---|---|
| A2/A3 计划 | 8bit ⇒ `passthrough args=[]`；10bit/HDR ⇒ `downgrade` + 5 组参数齐 |
| A5/A5b 回退口 | `legacy` ⇒ 连 >8bit 也不加参数；`force8` ⇒ 8bit 源也强制 |
| B1 8bit argv | 无 `-pix_fmt`/`-colorspace`（与改动前逐字节相同） |
| B2b 10bit argv | `-pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` |
| B2c 台账 | `colorDowngrade=true`、`colorFrom=yuv420p10le/bt2020nc/smpte2084`、`colorTo=yuv420p/bt709/tv` |
| C3 vs C3b | 本策略 ⇒ `yuv420p`（8bit）；旧命令 ⇒ `yuv420p10le` / `High 10`（**这就是修复前的现场**） |
| 变异 | M1 去 colorArgs 注入 / M2 去 deep 判定 / M3 8bit 也强制 / M4 去台账字段 ⇒ 各自红 |

既有判据未退化：`transcode-limit-test` **43/0**、`transcode-prescale-test` **39/0**（其中 C4/C6/D5 因规格
判据抽成 `mpwTranscodeSpec` 而**升级成切片跑真实现**，语义不变并加强；新增 D5b 变异）。

## 6. ffmpeg 相关路径逐条排查（五类问题：①异步任务  ②切档不取消  ③半成品当成品  ④关档不回退  ⑤色彩/范围丢失）

| 路径（入口 → 落点） | ① | ② | ③ | ④ | ⑤ | 证据 / 处置 |
|---|---|---|---|---|---|---|
| `/transcode` 播放档 → `transcodeToFps` → `runTranscode` → `tc_*.mp4` | 有 | **修前有** | **修前有**（最终名 0 字节/垃圾也算命中） | 无（`mpwTranscodeSpec` 关档即原文件） | **修前有**（10bit 原样） | 本轮主修：引用计数+代际、`player=verify` 解耦、`isValidTranscodeProduct`（大小+`ftyp`）、`transcodeColorPlan`；race-test B1..B5 + color-test B/C |
| `/transcode?player=verify`（客户端验活） | **旧：会 drive 转码** | 旧：会持有/续命别人的任务 | 无（只看最终名+有效性） | — | — | 新分支：有产物给产物、否则 202，**不起 ffmpeg**；race-test B1b/B1c/B4a/B4b + M5 |
| `/probe` + `getVideoProbe`（`ffprobeSourceMeta`，`execFileSync`×2） | **同步阻塞**（≤15s×2，按 `srcId|mtime` 缓存） | **无取消**（同步，切档无法插入） | 不适用（只读元数据） | 不适用 | 读 `pix_fmt/color_*`（本轮新增），是色彩策略的输入 | 本轮补"探测窗口内已断开 ⇒ 立即取消"判定；**未改**为异步（改动面大，如实记为待办） |
| `browserPlayable` 闸门（/probe verdict、/transcode 直读判据） | 无 | — | — | — | — | 本轮补 H.264 高位深（High 10/4:2:2/4:4:4）判据；color-test B2a 依赖它把 10bit 路由到转码 |
| ffmpeg 供给链：`/ffmpeg-download`、`/ffmpeg-check`、`DATA_DIR/ffmpeg/` | 单飞 promise（既有，无取消） | 无（下载与档位无关） | 下载临时文件 + 魔数/sha256 校验（既有） | 不适用 | 不适用 | 未改：与"切档"无因果关系；边角：下载中关页仍会跑完（有单飞与进度，可接受） |
| `ffmpeg-err-*.log`（stderr 落盘 + LRU ≤50） | 无 | 无 | 每次尝试新文件（既有） | 不适用 | 记录 stderr（含色彩相关报错） | 未改；新增"取消/失败"台账日志行 |
| `pruneTranscodeCache`（数量+字节双上限、`src_*.bin`/`.tmp` 残留） | 无 | 无 | **本轮加强**：`tc_*.mp4` 只要大小或魔数不合格 ⇒ 当场删（`invalid` 计数入 `/probe`） | 不适用 | 不适用 | `transcode-limit-test` C 段仍绿（43/0） |
| `scene-videos/**`（scene 内嵌视频落盘） | 无 | 无 | 既有 `tmp+rename`（本仓既有实现） | 不适用（不走 `/transcode`） | 不适用 | **不经过 ffmpeg**：按容器字节 carve（`findSceneVideoInPkg`）；`scene-video-*-test` 既有判据覆盖 |
| 缩略图 / 预览（`/custom-mpkg-preview` 等） | 无 | 无 | 不适用 | 不适用 | 不适用 | **不经过 ffmpeg**（读容器内嵌图片字节） |
| 音频提取 / 音频来源扫描（media-session、audio-*） | 无 | 无 | 不适用 | 不适用 | 不适用 | **不经过 ffmpeg**（`grep ffmpeg lib/*.js`：只有 `index.js`(136) 与 `client.js`(94)，其余 lib 文件 0 处） |
| 客户端：`pollTranscodeProgress` / `mpwProbeTranscodeCache` / 10s 超时轮询 | 轮询有上限（既有） | 本轮回退后**不再空转**（`cancelled` 终态） | 不适用 | 关档即 `useTranscode=false` | 不适用 | race-test A6/B1i |
| 客户端：`refreshBg`（刷新壁纸） | — | — | — | — | — | **本轮修**：转码档 URL 也加 `&_t=`（旧实现转码档刷新无动作）；race-test A5 |

## 7. 未验证边界（不许当成"已验证"）

1. **真机（Android/proot）未跑**：本文件全部读数来自本机 Node + ffmpeg 4.4.2 + 桩；真机 futex 单线程降级、
   浏览器实际解码表现未复测。
2. **真 HDR 素材**没有：HDR 夹具只是"打了 PQ/BT.2020 标签"，缺 tonemap 的观感偏暗**测不到**。
3. **ffmpeg-static b6.0（用户实际用的静态二进制）未跑**：本机用的是系统 ffmpeg 4.4.2；静态版滤镜集
   更少（无 zscale/tonemap 这一条已在代码注释里按 ffmpeg-static 的能力写明）。
4. **代际守卫的"过期 done 不覆盖新账目"**只有单调 gen 的读数（race-test B5），没有为它单独造一个
   "旧任务迟到写回"的变异（`setTranscodeJob` 的 gen 守卫属防御性代码）。
5. **用户现场的那次转码产物溯源未完成**：无法把 `~/.dsh-mpkg-wallpaper/transcodes/tc_*.mp4` 与源配对
   （缓存键含源 mtime；暴力枚举 0 命中）。
6. **并列线（已由父层修掉，不再是红）**：`tools/wallpaper-lifecycle-test.mjs` 的 H4/H5（沙箱档自动降级）
   原来按旧契约断言"策略挡住 ⇒ **自动**降 compat"；而另一条线（安全审计 F5）已把 `webFrameAutoCompat`
   默认改成"关"、auto 档**不再自动升同源**。父层把 H 组**契约收窄并两档都测**：默认档新增 H4/H5/H6
   （返回 false、`src`/`sandbox` 一字不改、层上写出"不自动升同源"的原因、无降级痕迹），
   旧 H4/H5 的判据**逐字保留**在"回退口打开"那一档（H8/H9，另加 H10 标出回退口是开着的、H11 只降一次），
   并顺手修掉降级 URL 的 `…index.html?&` 尾巴（`replace(/[?&]$/)` → `[?&]+$`，判据 H8b）。
   现状：`node tools/wallpaper-lifecycle-test.mjs` **192 通过 / 0 失败**（含变异自证），
   变异 `sandbox-fallback-unconditional` 仍然期望 H 组变红（H1/H2 那条判据没动）。
7. `~/.dsh-mpkg-wallpaper/settings.json` 全程**只读**：本轮所有实测都在临时 `DSH_HOME`。
   父层核对结论（**基线不一致的原因已查明，不是损坏**）：`e0796a31…` 那份是**压测期间的中途快照**
   （压测探针开过 `:3080`，插件启动会正常 PUT `/settings`），之后用户在界面上自己换过壁纸/开关
   （含"视频预缩档"来回切）。当前盘上这份 `719f570e…` 97 键、`preScale: 0`、`source: bgcs_abydos03.mp4`、
   `srcRoot: container`，与用户描述的最终状态一致；本会话内字节与 mtime 均未变（没有任何线去写它）。
   见 `<工作区>/docs/STATUS-ALL-ITEMS.md` 附录 B.3 的同一条结论。

## 8. 本轮改动文件

* `lib/index.js`：`browserCodecGap`(+H.264 高位深)、`pixFmtBitDepth`/`transcodeColorPlan`(+常量与回退口)、
  `PROBE_V_ENTRIES`/`buildProbeInfo`/`probeVideoInfo`(+色彩字段)、`transcodeProductPath`、
  `isValidTranscodeProduct`、`acquire/releaseTranscodeRef`、`killTranscodeProcs`、`isCancelError`、
  `TRANSCODE_INFLIGHT`/`ACTIVE_FFMPEG` 结构、`setTranscodeJob(gen)`、`transcodeToFps`(产物校验/取消台账/色彩)、
  `runTranscode(colorArgs,jobKey)`、`spawnFfmpeg(jobKey)`、`pruneTranscodeCache`/`transcodeCacheStat`(invalid)、
  `/transcode` 路由（verify 分支 + 引用计数 + `cancelled` 响应头 + 同步探测窗口补判）、`/transcode-progress`(+gen/error/color)、
  `/probe` limits(+3 项)、`__mpwTest` 出口。
* `lib/client.js`：`MPW_ARM_POS/NEG_TTL_MS`、`mpwArmCacheUsable`、`mpwArmProbeUrl`、`mpwArmVerdictApplies`、
  `mpwArmMountedUrl`、`mpwArmSigNow`、`mpwArmAbortAll`、`mpwArmProbe`(+verify 角色/可中断/202 放行)、
  `mpwVerifyArm`(+onOk/代际闸门)、`mpwFallbackToDirect`（回退唯一落点）、`mpwTranscodeSpec`（规格判据唯一落点）、
  `showVideoEl`/`showImageEl`（换源作废+成功清错+clear 缓存）、`refreshBg` 的转码档击穿、
  `pollTranscodeProgress`/10s 轮询（`cancelled` 终态）。
* `tools/prescale-switch-race-test.mjs`（新，44/0）、`tools/transcode-color-fidelity-test.mjs`（新，24/0）、
  `tools/transcode-prescale-test.mjs`（C4/C5/C6/D5 升级为切片真实现 + D5b）、`tools/check.sh`（登记两条，不新增 step）。

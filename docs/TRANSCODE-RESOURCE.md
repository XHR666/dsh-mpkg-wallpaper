# TRANSCODE-RESOURCE.md —— 视频壁纸转码的「必要性 / 资源上限 / 可观测」

> 起因（用户第 1 条，2026-09-17）：
> 「我现在并没有使用视频转码，我用的是 **video 类的 mpkg**，然后**解码帧率无上限**，
> **分辨率也是原始分辨率**，什么都没调。你看一下这是不是 bug。」
> 实测现场：一个 `ffmpeg -threads 1 -filter_threads 1 … -i ~/.dsh-mpkg-wallpaper/transcodes/src_1789….bin`
> **常驻、RSS ≈ 690MB** —— 插件在后台转用户**正在播放**的壁纸。

## 1. 判定：这次转码是**误判（bug）**，且顺带查出 3 个真 bug

| # | 结论 | 判据（文件:行 / 命令） |
|---|---|---|
| 1 | **源本来就浏览器可直读** | `ffprobe` 那条 `src_1789….bin`：`codec_name=h264 profile=High level=52 3840x2160 60/1`、音频 `aac LC`、容器 `mov,mp4,m4a,3gp,3g2,mj2`、`ftyp isom/iso2/avc1/mp41` ⇒ 任何现代浏览器都能直接播 |
| 2 | **用户确实没开转码** | `~/.dsh-mpkg-wallpaper/settings.json` 里 `"fpsCap":0,"resMax":0` ⇒ 走转码的**唯一**入口不是用户设置 |
| 3 | 触发者是**客户端"解码失败自动降级"** | `lib/client.js` 的 `video.error` 监听：`errCode===3||4` → `"/transcode?src=…&fps=24"`（旧实现）。`code 3/4` 只表示"这一帧解不出来"，**不等于"浏览器不支持该编码"**（4K60 硬解被回收/内存压力/GPU 解码器忙都会给 3/4）⇒ 对 H.264 源做这个降级纯属误判 |
| 4 | 旧宿主判据同样不看编码 | `index.js` 旧口径「`fps >= 源fps` 且 `maxW >= 源宽` ⇒ 直读」，**不看编解码**：HEVC/MKV 只要 fps/宽度没超限也会被直读 ⇒ 浏览器黑屏（实测：hevc 320x240@30 + maxW=1920 ⇒ `x-mpw-transcode: direct-spec`） |
| 5 | 字节上限的淘汰方向写反了 | `pruneTranscodeCache` v1 的字节淘汰循环**从最新开始**遍历 ⇒ **刚转好的产物第一个被删**，该源下次请求必 cache miss、每次从头再转一遍（实测复现：6×128MB 旧产物 + 1 个新产物 → 新产物被删） |
| 6 | 取消后仍在重试 | 客户端断开时路由 kill 的是"当前那个 ffmpeg"，而 `runTranscode` 的 `for` 循环还有 libsvtav1 / 单线程两个后续 attempt ⇒ 实测日志出现"kill 掉第 1 个之后紧接着又起第 2 个"（用户在切壁纸，后台又拉起新 ffmpeg） |

同时，**探测链路本身是坏的**（所以"先探测再决定"这类修法在旧代码里根本救不了）：
`ffprobe -select_streams v:0,a:0` **不是合法语法**（ffprobe 4.4.2 直接
`Invalid stream specifier: v:0,a:0` 退出 1），而旧 `probeVideoInfo` 用 `-of csv=p=0` 按
**位置**取字段（实测输出 `h264,High,3840,2160,yuvj420p,52,60/1,60/1`，与注释里写的
"width 在前"完全不符）⇒ 探测常年返回 null / 错值。现已改为 `-select_streams v`
+ `-of default=noprint_wrappers=1` 的 `key=value` 解析（见 `splitProbeSections`）。

## 2. 可播性闸门（探测方法）

**只读元数据、不解码画面、不起 ffmpeg**：

```
ffprobe -v error -select_streams v -show_entries stream=codec_name,profile,width,height,r_frame_rate,avg_frame_rate \
        -show_entries format=format_name,duration,size,bit_rate -of default=noprint_wrappers=1 <file>
ffprobe -v error -select_streams a -show_entries stream=codec_name,profile,channels,sample_rate -of default=noprint_wrappers=1 <file>
```

判据（`lib/index.js` → `browserPlayable()`，纯函数、可单测）：

| 维度 | 可直读白名单 | 说明 |
|---|---|---|
| 视频编码 | `h264` / `vp8` / `vp9` / `av1` | 不在表里 ⇒ `playable:false` |
| 音频编码 | `aac` / `mp3` / `opus` / `vorbis` / `flac` | 无音轨不算问题 |
| 容器 | `mov`/`mp4`/`m4a`/`3gp`/`3g2`/`mj2`/`matroska`/`webm` | 其它 ⇒ `false` |
| 确定性缺口 | MP4 里的 `h264+opus`、`HEVC Main10(10bit)` | 命中 ⇒ `false` |

**探测不出来（无 ffprobe / 未知编码 / 字段缺失）⇒ 返回 `playable:null` = 不知道**，
一律**保留旧行为**，绝不因为闸门本身误伤能播的源。

宿主新增只读路由 `GET /api/mpkg-wallpaper/probe?src=<client 的 image 串>`：

```json
{ "ok": true,
  "info": { "container": "mov,mp4,…", "video": "h264", "videoProfile": "High",
            "audio": "aac", "width": 3840, "height": 2160, "fps": 60, "duration": 100.05, "size": 130883105,
            "browserPlayable": { "playable": true, "reason": "h264+aac / mov,mp4,…（浏览器可直读）" } },
  "verdict": { "playable": true, "reason": "…" },
  "limits": { "cacheKeep": 12, "cacheMaxBytes": 536870912, "maxActive": 1, "defaultMaxW": 1920, "minAvailMb": 1024, "timeoutMs": 900000 },
  "cache": { "count": 3, "bytes": 12961906, "residue": 0, "errlog": 1 } }
```

### 三条播放路径的取舍

| 场景 | 行为 |
|---|---|
| 用户**没设** fpsCap/resMax（本次现场） | 判得出可直读 ⇒ **直读原片**（转码只会更差：抽帧降质 + 656MB 内存 + 数分钟 CPU） |
| 解码失败自动降级（客户端 error 路径） | 先问 `/probe`：可直读 ⇒ **不转码**，原片重试一次 + 明确告知；`playable:false` ⇒ 才转码；探测不出来 ⇒ 保留旧的自动转码 |
| 用户**显式设了** resMax（带 `maxW`） | 尊重用户设置、照旧转码（可直读也转），但受 §3 的降采样/上限约束 |

## 3. 资源上限（上限值**集中一处**：`lib/index.js` 顶部 const，env 可覆盖）

| 上限 | 默认值 | env | 说明 |
|---|---|---|---|
| 产物数量 | 12 个 | `DSH_WE_TRANSCODE_CACHE_KEEP` | 按 mtime 最旧先删 |
| **产物合计字节** | **512 MB** | `DSH_WE_TRANSCODE_MAX_BYTES` | 旧实现只有数量上限 ⇒ 12×130MB 能堆 1.5GB |
| 并发 ffmpeg | **1** | `DSH_WE_TRANSCODE_MAX_ACTIVE` | 超出排队；排队超 30s 直接失败让客户端回退原片 |
| 单任务硬超时 | 15 min | `DSH_WE_TRANSCODE_TIMEOUT_MS` | 超时 kill |
| **转码默认降采样宽** | **1920** | `DSH_WE_TRANSCODE_DEFAULT_MAXW` | 0=不限；用户显式给更小的 maxW 时以用户为准 |
| **内存准入阈值** | **1024 MB** | `DSH_WE_TRANSCODE_MIN_AVAIL_MB` | 可用内存低于此值 ⇒ **拒绝本次转码**（抛错让客户端直读原片），而不是起一个必 OOM 的进程把整机拖进 swap |
| ffmpeg 错误日志 | 50 个 | `DSH_WE_FFMPEG_ERR_KEEP` | 0 字节的空日志直接删 |
| src/`.tmp` 残留 | mtime>1h 即删 | — | 崩溃残留清理 |

**缓存命中判据**（可复用、不含时间戳）：
`tc_<sha256(srcId | round(mtime_ms) | fps | maxW)[:20]>.mp4`
—— `srcId` = 绝对路径（file）或 `mpkg:<包路径>:<条目 index>`。
**只含影响播放的字段**：改设置（fps/maxW）会正确失效，重放同一规格会命中。
清理时**受保护**：本轮刚转好的产物用 `pruneTranscodeCache(cachePath)` 排除，绝不被自己删掉。

**取消**：`/transcode` 在响应 `close`（切壁纸/退出/换源）时 kill **本请求启动的** ffmpeg
（`ACTIVE_FFMPEG` diff，不误杀别的壁纸），并且 `runTranscode` 每个 attempt 前都查取消
⇒ 取消后不再换编码器/换线程模式重试。`serving` 标记保证"转码已完成、正在写响应"时不会误判取消。

**启动清理**：`apply()` 一进来就清一次 transcodes/，并打一行带上限值的日志：

```
[dsh-mpkg-wallpaper][limits] transcodes 启动清理完成：产物 6→4 个 / 853.3→341.3 MB（本次删除 产物 2 / 错误日志 0 / 残留 1 个）；上限：12 个 / 512 MB；并发 1；默认降采样宽 1920；内存准入 1024MB
```

## 4. 内存实测（为什么"降采样默认 1920"）

同一 4K60 源、`-threads 1`、libx264 crf23 veryfast，取 `/proc/<pid>/VmHWM` 峰值：

| 口径 | 峰值 RSS | 耗时（6s 片段） | 产物 |
|---|---|---|---|
| 4K + fps24（**旧口径**，无降采样） | **656 MB** | 23.8 s | 5.7 MB |
| 1080p + fps24（**新默认**） | **275 MB** | 11.3 s | 1.6 MB |
| 1080p + `-tune zerolatency` | 171 MB | 11.4 s | 3.3 MB（码率翻倍） |

**实测排除的做法**（别重走）：

* `-max_muxing_queue_size 128`：245.8 vs 276.1 MB ⇒ 在噪声内，**无效**；
* x264 `rc-lookahead=0:sync-lookahead=0:ref=1:bframes=0`：178MB 但产物 1.6→3.4MB（**拿磁盘换内存**，默认不开，留 `DSH_WE_TRANSCODE_X264_PARAMS` 给极端场景）；
* OS 级 `ulimit -v` 包壳：ffmpeg 的**虚拟地址空间**远大于 RSS，512MB 上限**直接起不来**；且 `sh -c` 包壳会让 `proc.kill()` 只杀 sh、ffmpeg 变孤儿 ⇒ 与"切壁纸要能 kill"冲突，**不能用**。

⇒ 内存侧的正确做法是"**准入 + 降采样**"：内存紧张时**别做**这件可选重活，而不是做一半。

## 5. 可观测（不再静默占 690MB）

| 状态 | 落点 |
|---|---|
| `direct` 直读 | `[dsh-mpkg-wallpaper] 壁纸状态 = direct（…）`、`window.__mpwWallpaperState`、`<video data-mpw-wp-state="direct">` |
| `transcode` 转码中（含原因/规格） | 同上，`state=transcode`，detail = "用户设置：解码帧率上限 24 / 分辨率上限 无限制 → 转码到 24fps"，并照常走进度条 |
| `cached` 命中已转码产物 | `state=cached`（`/transcode-progress` 返回 `done` 时） |
| 探测判定需要转码 | `/probe` 的 `verdict.reason` 会写进日志，并在 502 的 JSON 里回给客户端 |

宿主侧响应头 `x-mpw-transcode: direct-playable｜direct-forced｜direct-spec` 让"直读"与
"转码失败悄悄回退原片"可区分（旧实现两者都是原片，无法分辨）。

## 6. 回退开关

| 开关 | 取值 | 默认 | 作用 |
|---|---|---|---|
| `?mpwtranscode=` | `probe` / `legacy` / `aggressive` | `probe` | `probe` = 可直读就不起 ffmpeg；`legacy` = **完全回到旧行为**（不看探测、一律自动转码）；`aggressive` = 连用户设的 fpsCap/resMax 也先探测，可直读就不转码 |

已登记在 `we-scene-demo/docs/README-DIAGNOSTICS.md` 主表（`diag-flag-check` 双向一致校验）。

## 7. 回归与门禁

```
node tools/transcode-limit-test.mjs      # 43 断言：闸门/缓存复用/并发/上限/取消/内存准入/客户端接线/磁盘卫生
```

已接入 `tools/check.sh`（第 5/11 步）。

**磁盘卫生（硬要求）**：本测试曾因"为了验 512MB 上限而造 6×128MB 假产物"把盘写满。
现在：①夹具全部 ≤1MB（产物桩只写 4KB，上限用 `DSH_WE_TRANSCODE_MAX_BYTES` 压到 **KB 级**验证）；
②`mkdtemp` 后立刻注册清理（正常路径 + `exit/SIGINT/SIGTERM` 兜底）；
③硬断言 E1（临时目录 ≤50MB）/ E3（单夹具 ≤1MB）/ E2+E5（跑完 `/tmp` 无 `mpw-tc-*` 残留）。
实测：跑前/跑后 `df` 均为 `81G 可用`，夹具峰值 **0.08 MB**。

# 音频 / 场景视频扫描提速 —— 量到的瓶颈、插件侧改动、渲染器侧待接的 3 处

> 2026-09-15，用户第 1 条反馈：「扫描音频的速度能否快些？…hina `3554161528` 的音频要过个两三秒才能扫出来」。
> 本文是**证据 + 交接单**。计时台 `tools/audio-scan-bench.mjs`（音频）、`tools/scene-video-bench.mjs`（场景视频）；
> 门禁 `tools/audio-scan-test.mjs` / `tools/scene-audio-route-test.mjs` / `tools/scene-video-test.mjs`
> （已接入 `tools/check.sh` 第 7、8 步）。

## 0. 路径归属（先看这条，别绕弯）

| 用户看到的功能 | 代码位置 | 由谁服务 | 本轮改动是否直接影响它 |
|---|---|---|---|
| `:8899` 渲染器顶栏 🔊 音频面板（"2–3 秒才扫出来"的**就是它**） | `we-scene-demo/demo.html`（`collectPackageAudioTracks` / `installAudioPanel`） | `we-scene-demo-server.mjs` 的 `/pkg/<id>`、`/pkgpath`、`/pkgurl` | **否**——`:8899` **不经过插件的 `/raw`**；它的体感改善只能来自渲染器侧排期（§3 三步） |
| DSH 插件里"使用"某张本地 scene 壁纸 → 画面多久出来 | `lib/client.js` `applySceneWallpaper` → `checkSceneVideo` → 宿主 `/custom-scene-video-check` → `ensureSceneVideo` | **DSH 插件宿主**（本轮改的就是这里） | **是**（§5）：探测 2894ms → 532ms（冷）/ 7ms（热）；"无内嵌视频"那 7 个包 1772ms → 18ms |
| DSH 插件里场景壁纸的容器字节流（渲染器 iframe 拉包） | `lib/index.js` `/raw` | 插件宿主 | 是（新增 Range/206：整包 → 64KB 即可取目录表） |
| 将来渲染器接宿主路径（本地壁纸的音轨清单） | `lib/index.js` `/custom-scene-audio` / `/library-scene-audio` | 插件宿主 | 是（新路由；**目前无消费者**） |

**一句话**：本轮的**音频**体感改善来自**渲染器侧排期**；插件侧的 `/raw` Range 与两个音频探测路由是
**宿主路径的基础设施**（为 DSH GUI 的壁纸 iframe 路径、以及将来渲染器接宿主铺路）。
**别以为"渲染器接上插件路由就快了"**——`:8899` 的音轨清单来自它自己已经整包加载的 `pkg.buf`，
接路由只在"本地壁纸、包还没下完"时才有意义。

## 1. 先量：音频慢在哪（真包，11 个 scene.pkg，每个 3 次取中位数，单位 ms）

| 阶段 | hina 3554161528 | 3719111841 凯尔希 | 3326873240 夜莺 | 3715743282 无音频 | 说明 |
|---|---|---|---|---|---|
| 包大小 / 条目 / 音轨 | 22.5MB / 134 / 1 | 69.5MB / 147 / 4 | 235.4MB / 104 / 1 | 3.7MB / 26 / 0 | 语料 `allwallpaper/dd` |
| A 整包 `readFileSync` | 34.5 | 121.5 | 315.2 | 1.7 | 旧路径第一刀（= 渲染器整包 fetch） |
| B `parsePkg` 目录表 | 0.17 | 0.14 | 0.34 | 0.03 | 便宜 |
| C **音频枚举本身** | **0.01** | **0.03** | **0.04** | **0.00** | 遍历条目 + 12 字节头 → **不是瓶颈** |
| D 逐条读满（`collectSceneVideoFiles` 口径） | 1.43 | 4.08 | 169.03 | 0.42 | 插件 scene 视频探测走的路径（TEX 全读） |
| E `parseTex` 全部 .tex（`loadScene` 代理量） | 314 | 914 | 161 | 30 | **大头**：音轨列表被排在它之后 |
| F 新：只读目录表 + 候选头（冷） | **2.25** | **1.97** | **6.90** | **1.28** | 读 107KB / 109KB / 255KB / 79KB |
| G 新：第二次（缓存命中） | 0.53 | 0.41 | 0.53 | 0.43 | 读 0 字节 / 0 次头 |

**一句话根因**：音频枚举只要 0.01–0.06ms，**"2–3 秒"不在这条扫描里**——旧路径必须先把
**整包读进内存**（22.5MB→320MB）才能解析目录表，而渲染器还要等 `await loadScene()`
（hina 的 32 个 TEX 解析量 ≈ 314ms，浏览器侧还有 canvas 解码/上传）之后才建面板：
`installAudioPanel()` 在 demo.html **:4595**，`await loadScene()` 在 **:3703**，
整包 fetch 在 **:1367-1379**。所以"扫得快的壁纸"= 包小 / 纹理少。

## 2. 插件侧已改（本仓库）

| 文件:行 | 改动 | 量化收益 |
|---|---|---|
| `lib/pkg-extract.js`（`AUDIO_SUFFIX_MIME` / `AUDIO_CONTAINER_RULES` … `scanSceneAudio`，见 `①(2026-09-15 …) 惰性音频索引`） | 新增：`parsePkgIndex`（可容忍只读到目录表的切片）/ `readPkgIndexFromFile`（64KB 起倍增读头，不读条目）/ `enumerateAudioTracks`（注入式核心：后缀筛 + ≤16 字节容器判定）/ `collectDirAudioTracks` / `scanSceneAudio`（含 mtime+size 缓存、LZ4 块链 size 修正） | 整包读 → **索引读**：hina 34.5ms/22.5MB ⇒ 2.25ms/107KB（读字节 **-99.5%**），缓存命中 0.53ms |
| `lib/index.js:1906`（`/raw`） | 补 **Range/206/416 + `accept-ranges` + OPTIONS 预检 + `access-control-expose-headers`**（此前永远 200 + 整包） | 232MB 包：带 Range 的请求由 **246,875,625 字节 → 65,536 字节**（-99.97%）；越界 416 |
| `lib/index.js:1978`（新 `/custom-scene-audio`、`/library-scene-audio`） | "先问清单再取字节"（同 `/custom-scene-video-check` 惯例）：JSON `{count,tracks:[{path,size,mime,refs}],stats}` | 清单 **565 字节 / 2–7ms**，不占整包带宽；同包第二次 `cacheHit:true` |

MIME 口径**未动** `lib/index.js:1392` / `:1796-1799`（web 分支的 `AUDIO_MAGIC_MIME`/`FOLDER_MIME` 原样），
新函数只服务新路径；FLAC/`.m4a`/OggS/ID3/ftyp/ADTS 与"扩展名说谎"都有断言。

> **2026-09-16 洁净室重写（P-89）**：上表里的音轨判定/收集实现**已按 `docs/AUDIO-TRACK-SPEC.md` 重写**
> （后缀 Map + 容器规则表 R1–R7；标识符由 `PKG_AUDIO_EXT_RE` / `audioMimeFromHead` /
> `audioMimeFromExt` / `collectPkgAudioTracks` 换成 `AUDIO_SUFFIX_MIME` / `AUDIO_CONTAINER_RULES` /
> `sniffAudioMime` / `suffixAudioMime` / `enumerateAudioTracks`）。上表数据是重写前测的；
> 重写后 `tools/audio-scan-bench.mjs` 复测仍 11/11 逐项一致（`tools/audio-scan-test.mjs` 61 断言全过）。
> 有意的判据差异：`0xFFF1`（ADTS）现在归 `audio/aac`（规格 §3.4），旧判定顺序把它误判成 `audio/mpeg`。
> 来历与处置见 `THIRD-PARTY.md`；`tools/audio-scan-test.mjs` 已不再读取渲染器文件。

## 3. 渲染器侧（`we-scene-demo/`）待接 —— 体感真正的来源

1. `pkg = lib.parsePkg(buf)`（demo.html:1379）之后、`await loadScene()`（:3703）**之前**
   调 `installAudioPanel()`：音轨列表由"纹理加载完"提前到"包一到就有"。
2. 枚举改成**只读目录表 + 候选头**（`pkg.buf` 已整包在内存时，可直接沿用现有
   `collectPackageAudioTracks`；若走下面的索引预取，则用新契约）。
3. 整包下载与音轨列表解耦：先 `GET /custom-scene-audio?folder=…`（或 `/library-scene-audio?ltoken=…`）
   拿清单（565 字节），再/同时下整包；此时 `/raw` 已支持 Range，想只取目录表也可以
   `Range: bytes=0-65535`。
   —— 三条做完，hina 的列表从"≥ 整包 + 纹理（秒级）"变成"**2.3ms + 一个 565 字节请求**"。

## 4. 插件侧已改（⑥c）：`ensureSceneVideo` 索引先行（**应用壁纸关键路径**）

改前（`findSceneVideoInPkg`）：`readFileSync` 整包 → `collectSceneVideoFiles` 把**每个 `.tex` 整条读出并全量解析**
（`parseTexInternal` 连每张图每个 mipmap 的 LZ4 都解压）→ 再挑。它在 `applySceneWallpaper` 的
`await checkSceneVideo(key)` 里，**探测完才决定静态帧还是视频**（客户端给这一步挂了 4s 超时）。

改后（`lib/pkg-extract.js` `scanSceneVideo`）：只读**目录表** + 只读候选条目**前缀**
（独立视频条目优先且只读那几条；`.tex` 只走"头部 + 首图首 mipmap 记录"再读载荷前 12 字节判 ftyp，
mip0 为 LZ4 时只解压第一个 sequence；已确认 2 条内嵌即停）。**任何不确定一律回退整条读**，
索引读取异常则由 `ensureSceneVideo` 回退到旧函数。缓存键 `path|mtime|size`。

| 类别（真包） | 包数 | 改前 | 改后（冷 / 热） | 读字节 |
|---|---|---|---|---|
| 无内嵌视频 | 7 | 1772ms | **18.2ms / 4.5ms** | 281.9MB → 9.8MB |
| 多 TEX 视频（时间变化 → null） | 2 | 830.5ms | 366.8ms / 1.3ms | 556.0MB → 273.4MB |
| 唯一 TEX 内嵌（必须取出该 mp4） | 2 | 291.5ms | 147.4ms / 1.4ms | 173.1MB → 117.8MB |
| 全部 11 个包 | 11 | 2894ms | 532.4ms / 7.1ms | — |

单包极值：凯尔希 3719111841 **770.8ms → 4.0ms**（读 69.5MB → 3.4MB）、hina 259.6ms → 2.3ms。
正确性：`tools/scene-video-test.mjs` 26 项断言全绿 —— 四类 + mip0 LZ4 + 条目级 LZ4 + 前缀不可判定，
与**旧实现**逐项比 `ref` 与 `sha256(bytes)`（真包 11/11）；语料 **213 个 `.tex` 的前缀判定零谎**
（video=12 / none=201，其中 mip0 LZ4=173、裸=40）；落盘缓存**文件名（hash 公式）与内容 sha256 与改前一致**
（升级不重抽）；二次探测读 0 字节。

**未定**：真机（Android/proot）磁盘冷启动、浏览器侧解码不在本文口径内；`multi` 类仍需整条读 2 个视频
纹理来"确认 ≥2"（若要更快只能接受"前缀判定即视频"的假设，会带来"损坏包误判"的语义风险，本轮未做）。

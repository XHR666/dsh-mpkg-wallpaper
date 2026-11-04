# 视频底层（`__videoBase`）第二因定性：Firefox 152–153.0.2 的 blob 媒体回归（上游 Bug 2056444）

日期：2026-09-24 · 仓库：`we-scene-demo` · 口径：**先离线取证，再最小页面，最后真页面**（每步都能单独复算）

---

## 0. 一句话结论

丢掉的画面有**两个因**，必须分开算：

| | 因 | 性质 | 状态 |
|---|---|---|---|
| **第一因** | `__videoBase` 块写在 `scene = lib.parseScene(...)` **之前**（`scene` 恒 `null`）⇒ 必抛 TypeError、被 `catch` 吞成一行 ⇒ **视频底层从来没被加入过**（60 个 PKGM0014 只出叠加层/清屏色） | **本项目缺陷** | 已修（整块下移到 `parseScene` 之后）＋离线判据＋变异自证 |
| **第二因** | 层已加入后，`blob:` 喂 `<video>` 在**受影响的 Firefox** 上**首次加载静默挂住**（`rs=0 ns=1 err=null`，无 error、`play()` 永不 settle）⇒ 视频纹理永远上不去 | **上游浏览器回归**（Firefox 152 起，官方已在 153.0.3+/154/155/ESR153 修） | 上游已修；本项目加**有界重试**兜底 |

第二因**不是**编解码器、不是容器格式、不是内存、不是时序、不是"元素太小不可见"——下面每条都有同机同字节的对照读数。

---

## 1. 先排除"编解码器/容器"这条最容易被误认的路（离线，不开浏览器）

`node tests/mpkg-video-codec-probe.mjs --n 8 --json reports/mpkg-video-codec.json`
（只读目录表 + 只把**单个视频条目**分块落盘给 ffprobe，绝不整包入内存）

8 个样本（含 6 个"视频 + `scene.json`"的 PKGM0014）读数：

| 结论项 | 读数 |
|---|---|
| 容器 | 全部 `iso-bmff(mp4) brand=mp42/isom`，`project.json.file` 指向的条目都能取到 |
| 编解码器 | **h264**（Constrained Baseline / Main / High），`yuv420p`，`30s`（一个 240s） |
| 分辨率 | 1636×1156 / 1920×1080 / 2268×3932 / 2530×1080 / **3840×2108 / 3840×2160 / 3840×2176** |
| 每包视频体积 | 0.1MB ~ 295MB（PKGM0014 那批 21~58MB） |

浏览器能力位（真页面里读的）：`canPlayType('video/mp4')="maybe"`、`codecs="avc1.42E01E"="probably"`、`MSE=true`。
⇒ **"编解码器罕见所以解不了"不成立**（`avc1` 是浏览器自己说 probably 的）。

---

## 2. 最小页面：同一段字节，只换"怎么给"（`tests/mpkg-video-decode-probe.mjs`）

样本：`allwallpaper/wallpaperE/白洲梓/白洲梓1_10.mpkg` 的 `wallpaper.mp4`（**22,256,547 字节**，1636×1156，30s）。
页面只做一件事：把这段字节交给一个 `<video>`，轮询 `readyState`（每档最多等 7~9s）。**不涉及 WebGL、不涉及我们的渲染器**。

| 档 | 怎么给 | 读数 | 事件时间线 |
|---|---|---|---|
| V1 | **HTTP 直供** `/__vidbytes` | **`rs=4` 1636×1156 dur=30**（首次变化 0.40s） | `loadstart→progress→loadedmetadata→loadeddata→canplay→playing` |
| V2 | HTTP 直供 + 320×180 可见 | **`rs=4`**（同上） | 同上 |
| V3 | HTTP 直供、**不 play()** | **`rs=4`** | 同上（少 `playing`） |
| V5 | HTTP 直供 + `preload=auto` | **`rs=4`** | 同上 |
| V6 | **`new Blob([buf])` → objectURL**（页面原样：2×2、`opacity .01`） | **`rs=0 ns=1 err=null`**，`play=pending` | 只到 `loadstart→progress→suspend` 就**永远不动** |
| V7 | 同上但 320×180 可见 | **`rs=0`** | 同上 |
| V8 | 同一 blob 写法，但换成 **14KB 的小 h264** | **`rs=4`** | 同上（正常） |
| V9 | `new Response(buf).blob()` → objectURL | **`rs=0`** | 只到 `suspend` |
| V10 | `new File([buf], 'v.mp4')` → objectURL | **`rs=0`** | 只到 `stalled` |
| V11 | **`data:video/mp4;base64,…`（30MB 字符串）** | **`rs=0`** | 只到 `suspend` |
| V4 | ffmpeg 现场生成 320×240/2s（HTTP） | **`rs=4`** | 正常 |

UA / 能力：`Firefox/153.0`（`rv:153.0`）、`avc1.42E01E="probably"`、`MSE=true`。

**这张表把范围锁死到两点**：① 与"是不是 blob"强相关（HTTP 全绿、blob 全红）；② 与体积相关（**14KB 绿、22MB 红**）。

---

## 3. 真页面：层、字节、元素三者分别量（`tests/mpkg-videobase-live-probe.mjs`）

`http://127.0.0.1:8899/?pkgpath=…白洲梓1_10.mpkg&res=720p`（有头 Firefox + `DISPLAY=:0`，`WebGL 2.0 / llvmpipe`）：

```
首帧=true（1.4~2.6s）· 层数=3 · 层名=["__videoBase","90524298_p0","Sakura"]
日志：🎬 视频底层已加入（最底层叠加）：wallpaper.mp4
     #0 __videoBase tex=__videoBase px=[0,1280]x[0,720]   ← 层序 0 = 最先绘制
     ✅ 首帧完成 298ms
<video>#0 rs=0 ns=1 ?x? dur=null muted=true paused=false preload="auto"
           connected=true rect=2x2 buffered=[] err=null
      src=blob:http://127.0.0.1:8899/481c2d01-…
A 真页面那个 blob 的字节数：{"ok":true,"status":200,"bytes":22256547,
      headHex":"00000018667479706d70343200000000","headAscii":"....ftypmp42...."}
B2 同 URL 换新元素：rs=4 ns=1 1636x1156 dur=30 play=ok
B  同字节新 blob 新元素：rs=0 ns=1 ?x? dur=null play=pending
C  原元素再 load 一次：{"before":{"rs":0,"ns":1},"after":{"rs":4,"w":1636,"h":1156,"dur":30,"err":null}}
```

⇒ ① **顺序修复生效**（层表第 0 位、日志、首帧绘制序都在）；② 元素拿到的 blob **有 2,225 万真实字节且头是 `ftypmp42`** ⇒ 取字节这一步没问题；③ 失败只发生在"**新 blob 的首次 load**"上——**同一个 URL 换元素、或原元素再 `load()` 一次，都能出数据**。

### 收尾：补一次 `load()` 就够了，而且画面真的出来了（`tests/mpkg-videobase-recovery-probe.mjs`）

```
卡住时（等了 2.5s）：rs=0 ns=1 buffered=0 err=null
                     画布 meanL=94.408 maxL=255 stdL=68.935 litFrac=0.9453
D 只再 load 一次：rs=4 ns=1 1636x1156 事件=[loadstart,progress,loadedmetadata,loadeddata,canplay]
恢复后视频：rs=4 1636x1156 dur=30 paused=false ct=1.74 buffered=30
恢复后画布：meanL=8.901 maxL=255 stdL=36.278 litFrac=0.0784
```

**这才是"视频作最底层"的端到端证据**：补一次 `load()` 之后纹理上去，整块背景从"叠加层 + 底色"变成视频画面（`meanL 94.4 → 8.9`）。


### 3.1 补充读数：这个回归是**竞态**，不是每次都挂（2026-09-24 追加）

同一个受影响的 Firefox（rv:153.0）上换一个包走**测试台的反代路径**（`:8902/webloader/?pkgpath=…`，
`佩丽卡1_01.mpkg`，视频 3624×4832 / 10.0MB / 6.67s）：

```
__mpwNoScene={"path":"video","entry":"32.mp4"}     ← 无 scene.json 的容器走纯视频壁纸（P-172.6）
看门狗钩子：{"calls":1,"retries":0,"gaveUp":0}      ← **一次都没补 load()**
视频：rs=4 / 3624x4832 / dur=6.67 / paused=false / ct=3.96
画布：meanL=128.767 / stdL=86.91
```

⇒ 与上游缺陷单的描述一致（"the first metadata read **can** hang"、另一位报告者说"约 50% 概率"）：
**它是竞态**，不是"每次都挂"。这也说明看门狗是**只在真挂住时才动**的兜底，而不是"每次都要补一发"的常规路径。

---

## 4. 上游缺陷（这不是我们编的解释，是 Mozilla 的定案）

**Bug 2056444 — "MP4 video remains stuck loading when a Blob URL is created from a fetched ArrayBuffer"**
（`Core::Audio/Video: Playback`，P1/S2，VERIFIED FIXED）· https://bugzilla.mozilla.org/show_bug.cgi?id=2056444

官方给的机制（alwu 的注释，与本机读数逐条对得上）：

1. `BaseMediaResource::Create` 按"blob 的输入流能不能**同步**报长度"挑资源类：能 ⇒ `FileMediaResource`（能用）；不能 ⇒ `CloneableWithRangeMediaResource`。
2. Bug 2005247（Firefox 152 起）把 blob 数据改成**内容进程经 IPC 读**（`RemoteLazyInputStream`），流不再同步报长度 ⇒ 落到 `CloneableWithRangeMediaResource`。
3. 那个资源类在**异步 IPC 流上做同步读**，**首次元数据读会挂住** ⇒ 元素停在 `networkState=1 / readyState=0`，**且不触发 error**。
4. 触发体积：blob 数据超过 **1MB 的 IPC 内联序列化上限**（官方回归测试的注释原话：`exceeds the 1MB IPC inline serialization limit`）。

修复去向：155 nightly → beta 154 → release 153（官方 QE 在 Ubuntu 24.04 + macOS 复验 **153.0.3 / 153.1.0 ESR / 154.0b6** 已修）；ESR153 亦有 uplift。

**本机浏览器 `rv:153.0` 正好落在受影响区间**（Playwright `firefox-1538` 构建），所以第二因在这台机器上**必然**复现。

> 缺陷单里报告者说"`Response.blob()` 这条路能用"——那是**网络响应**造的 blob。我们这条路的字节来自容器（`lib.getEntry`），`new Response(buf).blob()` 实测**同样挂住**（V9），`new File([buf])`（V10）与 `data:` URL（V11）也一样。**页内四种写法都不成立**，只有"给媒体一个真 URL（HTTP）"才成立。

---

## 5. 结论、影响与已做的兜底

1. **第一因是本项目缺陷，已修且判据独立**（`tests/demo-videobase-order-test.mjs`：源码序 + 按源码序执行原文 + mock-GL 首帧绘制序；变异：把块搬回原处 ⇒ 6 条断言精确变红）。
2. **第二因是上游回归**：受影响版本（Firefox 152 ~ 153.0.2）上，"视频作最底层/视频纹理"这类**blob 喂媒体**的观感就是"视频没出来"（正是扫面看到的"只剩清屏色/叠加层"）。用户升级到 153.0.3+ 即恢复；我们不做"改浏览器"的事。
3. **兜底（本项目侧，便宜且可自证）**：`demo.html` 里**每一处** blob 喂媒体的地方接一个**有界重试看门狗** —— 最多重试 2 次、间隔 1500ms、`readyState≥1` 或 `error` 立即停、健康浏览器上永不触发（`rs≥1` 早在 1.5s 内到达）。同一族在插件仓（`dsh-mpkg-wallpaper/lib/client.js` 的视频壁纸/音轨/包内媒体）也在同一批处理。判据：`tests/blob-media-retry-test.mjs`（结构自推导 + 行为 + 变异自证）。
4. **`decodeAudioData` 同族**：上游注释明确它也会挂（CacheStorage blob 场景）。本仓调用点为 0 处（见插件仓报告的核查结果）。

---

## 6. 复算命令（三条，全部可独立跑）

```bash
# 在渲染器仓库根下跑（路径不写死：仓库可克隆到任何位置）
node tests/mpkg-video-codec-probe.mjs --n 8 --json reports/mpkg-video-codec.json      # 编解码器/容器（离线）
node tests/mpkg-video-decode-probe.mjs --json reports/mpkg-video-decode.json          # 最小页面：HTTP vs blob（起一次 Firefox）
node tests/mpkg-videobase-recovery-probe.mjs --json reports/mpkg-videobase-recovery.json  # 真页面：补一次 load() 的端到端读数
```

期望读数：第 1 条 `h264×7 + 1 个非视频条目`；第 2 条 `HTTP 全 rs=4 / blob 大 rs=0 / blob 小 rs=4`；第 3 条 `D 只再 load 一次 ⇒ rs=4`，画布 `meanL` 明显下降（视频盖住背景）。

---

## 7. 仍未做到 / 边界（如实）

1. **没有第二个浏览器的同机对照**：本机 Chromium 在 PRoot 下跑不起来（`newPage` 超时 / 浏览器被关，`--no-sandbox` 与 `--single-process` 都试过）⇒ 对照只能靠上游缺陷单（含官方 QE 复验记录），不是我在本机另跑一个浏览器量出来的。
2. **没在"已修"的 Firefox 上复验**：本机只有 153.0（受影响）。"升级即恢复"是引用上游结论，不是我实测。
3. §3 的"恢复后画布"是在**手动补一次 `load()`** 之后量的；兜底看门狗是它的产品化形式，逻辑等价但**在真页面里由代码自动重试**的那一版要在落地后按第 6 条重跑确认。
4. 上游缺陷单另说 `decodeAudioData` 同族会挂；本仓未做该路径的实测（调用点为 0）。

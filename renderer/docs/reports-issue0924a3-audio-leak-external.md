# 音频泄漏判定材料（ISSUE0924A-3）——交给外部 AI 的完整现场

> 目的：用户要把「静音开着仍然有声音 / 声音不是当前壁纸的音频」这件事交给**另一个 AI 判定**。
> 本文是**自包含**的：先给系统拓扑与真机证据，再列**全部**候选机制（不预设"上一个壁纸的音频"这一条），
> 每条都写清"支持证据 / 反证 / 判别实验 / 现状"。**未验证的地方一律标"未验证"**。
>
> 撰写者：本仓维护代理。时间基：2026-09-24（本机时区 +08:00）。
> 相关仓：`dsh-mpkg-wallpaper`（MIT，DSH 壁纸插件）、`we-scene-demo`（GPL-3.0-or-later，WebGL2 场景渲染器）。
> 姐妹文档：`we-scene-demo/docs/reports-issue0924a3-audio-leak.md`（修法细节与成对读数）。

---

## 0. 判定结论（**外部 AI 已判，本节按判定意见改写**）

外部判定（逐字要点，已全部采纳进本文）：

1. **09-24 现场不是单一机制，是 H3（探针污染档）+ H2（跨源静音不可达）+ H1（隐藏帧仍放）的复合**；
   **H4（第三方鲸鱼挂件）解释的是 09-20 及长期偶发的"响几声"**。
   用户实际是把"壁纸侧的探针事故"和"第三方挂件的常态漏音"**合并成了一句抱怨** —— 不要用单条机制解释全部原话。
2. **出口表 E1–E9 方向完备**，但 **E8 在 Android 上不应标"未验证"**（Android `WallpaperService` 是独立进程；
   Via 自身也可能有多窗口/后台播放）⇒ 已升级为**"用户设备上高概率存在、本机无法闭环"**；
   并补 **E10/E11/E12** 三条（系统 TTS、MediaSession 触发的系统级恢复、蓝牙 A2DP 路由瞬态）。
3. **修法要分层**：对壁纸插件**自身**产生的音频是**治本**；对用户"按下静音整机不该响"的诉求是**治标**
   ⇒ 必须在 **DSH 宿主层**做全局音频总线 + 全局策略契约（见 §10），否则 H4/E5/E6/E8/E10 永远漏。
4. **两条方法论要求**（已落进本文）：① 把"审计的跨源帧/跨进程盲区"写明 —— 它解释了**为什么 H3 在现场"无信标却有声"**；
   ② **时间线对齐**：用户 09-24 19:0x 的现场跑的是**旧客户端 + 污染档**，**不构成对本次修法的反证**。

> 下面 §1–§9 是判定所依据的原始材料（保留未删）；§10 是判定意见的落地清单与仍缺的部分。

### 原始待答问题（保留，便于复核判定是否答全）

1. 哪一条机制最能解释用户的三句原话（§1）？特别是"声音不是当前壁纸的音频"这句的**字面**解释。
2. 有没有我们漏掉的出口（§2 的表是否完备）？尤其跨进程/跨 WebView、"另一个浏览器标签页"、系统级媒体会话。
3. 我们的修法是不是治标（§6）？该不该在**宿主全局**层（而不是壁纸帧内）做静音。

---

## 1. 用户原话（逐字，按时间）

| 时间 | 原话 | 备注 |
|---|---|---|
| 09-20（历史同题） | 「莫名其妙播放音频又出现了，我刚才什么都没动，他又开始播放了……有时候可能响几声，有时候就没有了，听起来和非常卡顿一样（因为它不是连续播放的）」 | "响几声/不连续"是关键词 |
| 09-24 本轮 | 「刷新之后壁纸没自动播放、NP 暂停、壁纸设置里静音已打开，**仍然有声音**；点 NP 播放后壁纸才重新加载并播放」 | 三个状态同时成立 |
| 09-24 追加 | 「这个音频**并不是我当前壁纸的音频**（没动音频、也没刷新）」 | 用户主动排除了"当前壁纸的音轨" |
| 09-24 复现提示 | 「可能是**随机切换壁纸**，或者是**上一个壁纸放完之后下一个壁纸**开始播放」 | 用户提示不要只盯一条路 |
| 09-24 19:0x（同一事件链） | 「DSH 的背景直接变成原来的 8899 了，各种功能也都在这个背后的」 | 见 §3.3：这是**同一次事故**的另一面 |

---

## 2. 系统拓扑：声音可能从哪些出口出来

链路：Android Via/Chromium（用户设备，Adreno 830）→ DSH 宿主页 `http://127.0.0.1:3080/`
→ 壁纸插件（MIT）→ 可能的子帧：场景渲染器 `http://127.0.0.1:8902/webloader/`（本仓）、
网页壁纸帧（`?mpwshim=1`）、以及**第三方插件自己的音效**。

| # | 出口 | 谁创建 | 现有静音落点 | 备注 |
|---|---|---|---|---|
| E1 | 场景渲染器帧内的 BGM（`<audio>` × N → `MediaElementSource` → destination） | 渲染器 `we-scene-demo/demo.html`，仅 `?audio=1` 时接图 | **本轮新增** master GainNode 总闸 + `postMessage{mpw-audio-policy}` + `mpwAudioPark()` | 跨源：宿主 `contentDocument`=null |
| E2 | 网页壁纸帧内的音频（作者脚本 `new Audio()`/`AudioContext`） | 网页壁纸自己的 JS | shim policy（仅 `?mpwshim=1` 帧）+ 逐元素 `muted` | 跨源帧同样不可达 |
| E3 | 视频壁纸 `#mpw-bgVideo`（mp4 自带音轨） | 插件 `lib/client.js`（所有档位下该元素都在 DOM 里） | `video.muted` / `video.pause()`；切离档位已 `pause()+load()` | 真机读数见 §3.1 |
| E4 | NP（NowPlaying）播放器 | 插件 `lib/client.js`（`npAudio` / link 到 `#mpw-bgVideo`） | `npApplyMute` / `npPaused` | 用户报"NP 暂停" |
| E5 | **第三方插件音效**（鲸鱼挂件 `dsh-whale-widget` 的 `press.mp3`/`release.mp3`） | 第三方插件 `lib/index.js:976/979`，`play()` 在 `:1001/:1010` | **没有任何宿主级落点**：壁纸插件的静音只管壁纸帧 | 真机 4 条信标全是它（§3.2） |
| E6 | 其它 DSH 插件/宿主 UI 的音效 | 各自插件 | 同上 | 未逐一排查（未验证） |
| E7 | 缩略图/预览用的 `<video preload=metadata muted>` | 插件 `lib/client.js`（列表缩略图） | 建元素即 `muted:true` | 预览弹窗是否有"点开即播"的带声音路径**未验证** |
| E8 | 独立 WebView / 系统壁纸服务 / 上一个页面残留（跨进程） | 操作系统或浏览器进程 | 本机**观测不到** | **用户设备上高概率已知出口**（Android `WallpaperService` 独立进程；Via 也可能多窗口/后台播放）；本机无法闭环 |
| E9 | 另一个浏览器标签页 / 另一个 DSH 会话 | 用户操作 | 同上 | 未验证 |
| E10 | **Android 系统 TTS**（`speechSynthesis`，角色/场景语音） | 页面或系统 | `speechSynthesis.cancel()` **不保证**立即停（部分 ROM 上起播后不受页面完全控制） | 判定者补充；未验证 |
| E11 | **MediaSession 触发的系统级恢复**（系统媒体控件 / 耳机按键） | 系统 UI | MediaSession 本身不出声，但可能让某个 app/页面**恢复播放** | 判定者补充；未验证 |
| E12 | **蓝牙/A2DP 重连、采样率切换的路由瞬态** | 系统音频栈 | 无（不在页面内） | 判定者补充；Adreno 830 类设备常见短促声响，易误判成"网页漏音" |

**判定者注意**：E5 与 E6 在"静音已开"的场景下**天然不受壁纸插件控制** —— 这是"静音开着仍有声音"的
一个**平凡解释**，必须先排除（判别实验见 §8 第 1 步）。

---

## 3. 真机证据（**不是**本机推测）

### 3.1 插件自带的音频审计（真机 8 条信标）

插件 `lib/client.js` 里有一个常驻审计（`window.__mpwAudioAudit`）：包装
`HTMLMediaElement.prototype.play`、`volume`/`muted` setter、`Audio`/`AudioContext` 构造，
每条记录都带**调用栈摘要**、元素状态（`tag/id/cls/connected/src`）、
**归属指纹 `owner`**（`ours` / `whale-widget` / `frame` / `other`）与当时 NP/静音状态；
命中可疑特征（隐藏期间出声 / 元素已脱离 DOM 仍 play）时**自动 POST `/diag`**。
信标落在宿主数据目录（`~/.dsh/.dsh-mpkg-wallpaper/diag-*.json`）。全部 8 条：

| 时间（+08:00） | 触发 | 事件 | 元素 | owner | muted/volume/paused | src |
|---|---|---|---|---|---|---|
| 09-21 21:58:19 | audible-playback | unmute | VIDEO `#mpw-bgVideo` | ours | false / 0.33 / false | `/api/mpkg-wallpaper/media?token=…&index=0` |
| 09-21 21:58:29 | audible-playback | np-apply-mute | 同上 | ours | false / 0.33 / false | 同上 |
| 09-21 21:58:36 | audible-playback | np-apply-mute | 同上 | ours | false / 0.33 / false | 同上 |
| 09-23 21:45:11 | **mute-on-but-audible** | play | AUDIO（无 id/class，`connected:false`） | **whale-widget** | false / 1 / false | `/dsh-whale/sound/press.mp3?set=fx1` |
| 09-23 22:16:19 | **mute-on-but-audible** | play | 同上 | **whale-widget** | false / 1 / false | 同上（`set=fx1`） |
| 09-23 23:43:38 | hidden-transition | play | VIDEO `#mpw-bgVideo` | ours | true / 0.33 / **true** | 同上 |
| 09-24 16:40:04 | **mute-on-but-audible** | play | AUDIO `connected:false` | **whale-widget** | false / 1 / false | `press.mp3?set=fx1` |
| 09-24 18:51:13 | **mute-on-but-audible** | volume | 同上 | **whale-widget** | false / 1 / false | `press.mp3?set=**duck**` |

**读法**：`trigger=mute-on-but-audible` = "壁纸插件的静音是开的，却有一个媒体元素在出声"。
4 条这样的信标**全部**指向**第三方鲸鱼挂件**，没有一条指向壁纸。
另外 3 条 `audible-playback` 是**用户自己的视频壁纸**在放（`muted:false, volume:0.33`，属正常行为）。

#### 3.1a 这份审计的**三个盲区**（判定者补充；第 ① 条同时解释了"为什么 H3 在现场无信标"）

1. **跨源帧内的音源看不见**：审计（`__mpwAudioAudit`）装在宿主页（`:3080`），
   而探针场景的 BGM 在**跨源帧**（`:8902`）里 —— 帧内的 `new Audio()` / `AudioContext` 它**抓不到**。
   ⇒ §3.1"8 条信标里没有一条指向场景 BGM"**不是反证、恰是正证**：H3 的声源正是靠这个盲区"隐身"的。
2. **跨进程音源看不见**：Android 系统壁纸服务、独立 WebView、其它 App 的音源，任何页面内钩子都够不到（= E8）。
3. **`MediaElementAudioSourceNode` 的下游语义**：元素一旦被 `createMediaElementSource` 接管，
   **`el.muted` 只影响输入源、输出在图里** —— 本仓自己的代码注释就是这么写的
   （`dsh-mpkg-wallpaper/lib/audio-bus.js:19`）。因此审计记录里的 `muted/volume/paused` 三字段，
   对"被接管"的元素**两个方向都不能直接当证据**（既不能证"它在出声"，也不能证"它没在出声"）。
   - **本机补充实测**：在被接管的元素上，桌面 Firefox 里 `el.muted=true` **确实**把 destination 抽头压到 **0**
     （改前 A/B 0.0093 → 0）⇒ 该语义**依引擎/版本而异**，**不可跨引擎类推**（判定者在结论 3 里要求的正是这层保留）。
   - **既有实践**：宿主页里插件自己的 `__mpwAudioBus` 已经是**图级**收口（原型级 `connect` 拦截 + 懒建 `masterGain`
     + `setMuted` 把 master gain 置 0，见 `lib/audio-bus.js:11-16 / 311-320 / 941`），且对"被接管的元素"
     **刻意不 `pause`**（analyser 要数据，`:221` / `:792`）⇒ "图级优先、元素级次之"这条正是本仓既定口径。

### 3.2 鲸鱼挂件（第三方 DSH 插件）为什么能造成"响几声"

`~/.dsh/profiles/web/node_modules/dsh-whale-widget/lib/index.js`：

- `:976` `pressAudio = new Audio('/dsh-whale/sound/press.mp3?set=' + soundSet)`（`:979` 同理 `release.mp3`）；
- `:1001` `pressAudio.play()`（按下时）、`:1010` `releaseAudio.play()`（松开时）；
- `:1002-1005` `pressAudio.onended` 里**自动续播** `release.mp3` ⇒ 一次交互 = **两段声音**；
- `:953-958` `soundOn = soundVol > 0`、音量来自它自己的滑杆（真机读数 `volume:1`）；
- `applySoundSet()` **每次换音效都新建 Audio 对象**，旧的既不 `pause()` 也不清引用
  ⇒ 审计里出现"`connected:false` 的元素仍在 play"这一形态完全吻合。

⇒ **"响几声、不连续"（用户 09-20 原话）与"静音开着仍有声"（09-24 原话）都能由它单独解释**，
且它与"当前壁纸是什么"**无关** —— 这正是用户说的"不是当前壁纸的音频"。

### 3.3 ★本次事故的真因：**我们自己的探针把用户的壁纸档写坏了**

用户 09-24 19:0x 说"背景变成原来的 8899、各种功能都在背景里"。查宿主档
（`~/.dsh-mpkg-wallpaper/settings.json`，插件的宿主端设置，跨端口/清浏览器数据都不丢）发现：

```
mpkgName  = "探针场景（凯尔希 4 音轨）"          ← 探针自报的名字
sceneKey  = "scene|probe|…/allwallpaper/dd/3719111841/scene.pkg"   ← "probe" 标记
webUrl    = "http://127.0.0.1:8902/webloader/?pkgurl=…&embed=1&audio=1"   ← 带 audio=1
converted = "scene"    mpkgKey = ""    source = "scene.pkg"
```

- `&audio=1` 是渲染器**唯一**会播放场景内嵌 BGM 的开关（`AUDIO_ENABLED = /[?&]audio=1/`）。
- 与用户真实档（`settings-backup-before-mute.json`，09-20）逐键 diff：**只有 6 个源字段**不同
  （`converted/mpkgKey/mpkgName/source/sceneKey/webUrl`）+ 两个后的新增键（`npPaused=true`、`srcRoot`）。
- 机制：音频探针（`tools/audio-leak-frame-probe.mjs --mount-scene`）为了走**真实挂载路径**，
  把"场景档 + `audio=1`"写进浏览器 localStorage；插件随即把整档 **PUT 到宿主端**
  （`lib/client.js` 的 `mpwPersistSection`："去重后写 host"）。
  **探针只复原了 localStorage**（旧写法），宿主那份的 `__mpwHostAt` 更新
  ⇒ 下一次加载按"谁新用谁"裁决时**宿主（探针档）赢** ⇒ 用户的壁纸被探针场景顶掉。
- 用户侧表现完全对得上：画面是**探针场景的静态帧/兜底**（"壁纸没有自动播放"），
  声音是**那个场景的 4 条 BGM 音轨**（"不是当前壁纸的音频"），
  点 NP 播放 ⇒ 插件换 `src` ⇒ 旧文档销毁/新文档加载（"才开始重新加载刚才的壁纸"），
  而"静音"到不了那个跨源帧（见 H2）。

**已处置（19:36:31）**：向宿主 API PUT 回用户真档并逐键复核 ——
`converted=mp4`、`mpkgKey=custommpkg|小鸟游星野01_04.mpkg`、`source=bgcs_abydos03.mp4`、
`webUrl=""`、`sceneKey` 删除、`image`（用户媒体 token）保持不变、`mute=true`、`npPaused=true`。
复核输出：无 `probe` 残留、`webUrl` 里无 `audio=1`。

**已加固（防复发）**：探针改为**两处都存档**（localStorage + 宿主档 GET）、结束时
**两处都写回 + 逐键复核**，不一致就判红并打印差异（`dsh-mpkg-wallpaper/tools/audio-leak-frame-probe.mjs`：
存档在 `:222`、复原与复核在 `:401-418`）。

### 3.4 其它落盘状态

- `~/.dsh-mpkg-wallpaper/media-audio.json`（18:51:14）：
  `{"muted":true,"volume":0.33,"playing":true,"explicit":true,"hasAudio":null,"source":"web"}`
  —— 媒体音量档记的是"web 档在放、已静音、音量 0.33"。
- 插件面板的"静音"（`mute`）与 NP（`npNowPlaying/npPaused/npVolume=33`）都是独立项。

---

## 4. 机制清单（H1–H9）

> 每条给：**机制 / 支持证据 / 反证或未知 / 判别实验 / 现状**。
> 其中 H1、H2、H3 是本轮**已实测复现**并已修的；H4 是**真机证据最硬**的；其余为未闭环。

### H1 被"藏起来"的渲染器帧仍在放（看门狗兜底 / 省电暂停 / 切走）

- **机制**：场景看门狗兜底 `sceneFallbackActivate()`（`dsh-mpkg-wallpaper/lib/client.js:3992`）
  把渲染器 iframe **隐藏但保留元素与 src**（等迟到首帧恢复；CSS
  `lib/client.js:14599`：`.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame{display:none!important}`）。
  **隐藏的 iframe 不会停媒体**。同类"隐藏但不卸载"落点还有：总开关关掉（只 `display:none`）、
  省电/切后台 `pauseWebFrame()`（跨源帧下旧两条通道等于没停，返回值还是 0）、`teardownWebFrame()`。
- **支持证据（本机实测）**：加类命中 `display:none` 后，帧内
  `ctx:running / masterGain:1 / parked:false`、destination 抽头峰值 **0.027（在放）**；
  修复后同一步读数 `{parked:true, parkReason:"raf-stall", ctx:"suspended", masterGain:0}`、元素全 `paused`。
- **判别实验**：帧内控制台 `({policy:__mpwAudioPolicy, graph:__mpwAudioGraph()})`；
  或宿主页看 `#mpw-bgWrap` 是否带 `mpw-scene-fallback` 类而声音仍在。
- **现状**：已修（渲染器 `mpwAudioPark()`＝收起就停源；插件在每个隐藏/切走落点下发 `park:true`）。
- **它解释用户哪句话**：画面静态 + 声音来自"旧的、被藏起来的帧" ⇒ "不是当前壁纸的音频"、
  "点 NP 播放后壁纸才重新加载"。

### H2 静音信号根本到不了跨源帧（通道缺口）

- **机制**：场景帧在 `127.0.0.1:8902`、插件页在 `127.0.0.1:3080` ⇒ **跨源**。
  旧的三条落点全失效：`frame.contentDocument`（null）、`window.frameElement`（null ⇒ 宿主写的
  `frame.muted` expando 读不到）、shim policy（只对 `?mpwshim=1` 帧发）。
- **支持证据（改前实测）**：静音=开 + 场景档 + 刷新后，帧内 4 条 `<audio>` 全是
  `muted:false / volume:0.25 / paused:false`，`AudioContext: running`，
  接 destination 那条边的抽头 **0.0134 → 0.0189**，帧内 `msgs: []`（**一条静音消息都没到过**）。
- **反证/推翻**：初始猜测"`muted` 属性对 `MediaElementSource` 无效"**被实测推翻** ——
  桌面 Firefox 上逐个 `el.muted=true` ⇒ 抽头峰值 **0**。缺的是**图级落点**与**可达通道**，不是 `muted` 本身。
- **判别实验**：帧内 `__mpwAudioGraph().masterGain`（0/1）；宿主 `window.__mpwRendererAudioPush.last`
  （`{muted, posted, sameOrigin, stale}`）。
- **现状**：已修（master GainNode 总闸 + `postMessage` 通道 + `?embed=1` 帧"宿主未表态先静音"的 fail-safe
  + 同源 `__wp` 通道）。

### H3 探针残留档（§3.3）——**本次用户现场的直因**

- **支持证据**：宿主档内容 + 与 09-20 备份的逐键 diff + 探针代码路径（写 localStorage → 插件 PUT 宿主）。
- **判别实验**：宿主 API `GET /api/mpkg-wallpaper/settings`，看
  `mpkgName/sceneKey/webUrl` 是否含 `probe` 或 `audio=1`。
- **现状**：已复原 + 探针已加固（两处存档/复原/复核）。

### H4 第三方鲸鱼挂件的 UI 音效（E5）

- **支持证据**：§3.1 的 4 条 `mute-on-but-audible` 信标 + §3.2 的源码路径。
- **反证**：它只在**交互**（按下/松开挂件）时响 ⇒ 与用户"什么都没动"不完全吻合；
  但 `onended` 自动续播 + "播完即弃"的元素可能造成"响几声"的错觉；也可能命中缓存的交互（未验证）。
- **判别实验**：听声时执行
  `__mpwAudioAudit.list.slice(-10)`（宿主页控制台）——看 `owner` 是 `whale-widget` 还是 `ours`；
  或把鲸鱼挂件音量滑杆拉到 0（`setVol(0)` ⇒ `soundOn=false`）再复现。
- **现状**：**未修**（不在壁纸插件写权内）。建议方向：宿主级"静音所有插件音效"总开关，或让该插件自己尊重
  一个全局静音标志 —— 请判定者给意见。

### H5 视频档 `#mpw-bgVideo` 的"取消静音瞬态"

- **机制**：该元素在所有档位下都存在（不用时 `display:none`、无 src）。历史上确实出现过
  "切离视频档后仍在放"的写法（只 `removeAttribute("src")`，而**移除 src 不会停止正在播放的媒体**），
  已修为 `pause()+load()`；但"起播/转码/电平重放"等任何一次**取消静音**都可能让它响几声。
- **支持证据**：09-21 三条信标显示它 `muted:false/volume:0.33/paused:false`（当时是用户自己的壁纸，正常）。
- **判别实验**：切到非视频档后，宿主页连采样
  `getComputedStyle`/`video.paused/muted/currentTime`（或读 `__mpwAudioAudit`）。
- **现状**：切离路径已修；瞬态未专门闭环（未验证）。

### H6 轮换 / 随机切换（用户提示）

- **机制**：插件有壁纸轮换（`DEFAULT_ROTATE=false` 默认关；开启后 `window.__mpwGoNext` 每
  **钳制到 [1,120] 分钟**切一次；`rotGroups[].order === "random"` 走随机分支，
  `lib/client.js` 约 `:18257-18330`）。切换 = `applyWallFromList` → `applyFromStorage` 全量重建。
- **支持证据**：用户自己提到"可能是随机切换壁纸"。真机档里 `rotate=false`、`rotGroups=[]`
  ⇒ **事故当时轮换是关的**（这一点很重要：H6 不是本次直因）。
- **判别实验**：`readSection().rotate/rotateMin/rotGroups`；或看 `window.__mpwRotTimer` 是否为 null。
- **现状**：未发现"交叉类型切换（scene→video / web→scene）漏停源"的新证据；但 H1 的每条隐藏路径都已加 park。

### H7 "上一个壁纸放完后下一个壁纸开始播放"（用户提示）

- **机制审查结果**：本仓**没有**"播完自动续播下一个壁纸"的实现 —— 无播放列表/曲目队列；
  轮换是**定时器**（H6）不是"播完触发"；NP 的 `npStepTrack` 只在用户点"下一首"时走。
  壁纸元素上**没有** `ended` → 切换壁纸的监听（未找到）。
- **因此**：若用户确实听到"顺序播放"，更可能是 H1/H3（同一帧里多条音轨按序或 loop）
  或 H4（press→release 两段）或 E8/E9（本机观测不到）。
- **现状**：无改动；请判定者用它当"反证项"。

### H8 NP 播放器

- **机制**：`npAudio`（或 link 到 `#mpw-bgVideo`）。真机档 `npPaused=true`、`mute=true`。
- **已修口径**：`npFrameSoundBlocked()` 从"看 `npAudio.paused`"改为"**真的在出声**"
  （`paused ∧ !muted ∧ volume>0`，`lib/client.js` 约 `:8322-8331`、`:8378`），
  并在它成立时**向帧下发 park**（`:4366`）。
- **判别实验**：`window.__mpwNp*` 自证字段 + `__mpwAudioAudit`。

### H9 本机观测不到的出口

跨进程（系统壁纸服务/独立 WebView）、另一个标签页/会话、系统媒体会话。**未验证**；
若判定者认为需覆盖，需要用户在真机上做的动作（§8 第 4 步）。

---

## 5. 已被推翻 / 已排除

| 说法 | 状态 | 依据 |
|---|---|---|
| "`muted` 属性压不住 `MediaElementSource`" | **推翻** | 改前 A/B：`el.muted=true` ⇒ destination 抽头峰值 0.0093→0 |
| "静音没生效 ⇒ 是 muted 的实现问题" | **推翻** | 真因是**通道不可达**（H2）+ **图级无落点** |
| "`IntersectionObserver` 能判隐藏帧" | **推翻** | 对 `display:none` 的 iframe 不报 false（帧内容器是帧自己的视口）⇒ 已删该防线，改用帧内 rAF 停摆 |
| "`ctx.suspend()` 后抽头读数可用于判声" | **修正** | suspend 后抽头停在最后一帧缓冲 ⇒ 判"有没有声"要以 `parked/ctx/masterGain/元素 paused` 为准 |
| "轮换（H6）是本次直因" | **排除** | 真机档 `rotate=false` |
| "声音来自当前壁纸的音轨" | **用户已排除**，且 §3.1/§3.2 有真机反证 | — |

---

## 6. 已实施的修法（含"改回去必红"的判据）

| 层 | 改动 | 判据（本机实跑） |
|---|---|---|
| 渲染器 | `we-scene-demo/demo.html`：master GainNode 总闸（`mpwAudioSilent/mpwAudioApply/mpwAudioConnectMaster`，`:4590/:4657`）、`mpwAudioPark(on,reason)`（`:4696`，pause 元素 + `ctx.suspend()`）、三条通道（URL 复用已登记 `audio=0` / `postMessage:mpw-audio-policy` / 同源 `__wp`）、释放回收（`:4541`） | `tests/render-audio-leak-test.mjs` **47/0**；变异：删 `mg.value=want` ⇒ [E3] 必红；声源退回直连 ⇒ [E1] 必红；删 park 的 pause 循环 ⇒ [G1] 必红；删探测 ⇒ [G6] 必红 |
| 插件 | `lib/client.js`：`sendRendererAudioPolicy(frame, mute, park, why)`（`:4315`，跨源唯一可达；幂等 + **帧重载即使值没变也重发**）、每个隐藏/切走落点下发 park（`:3165/:4366/:9292`）、`npFrameSoundBlocked()` 口径对齐"真的在出声" | `tools/np-media-test.mjs` **117/0**（21 组变异，含 `scene-fallback-does-not-park-frame-audio`、`cross-origin-frame-pause-does-nothing`）；`bash tools/check.sh` 12 步全绿 |
| 取证工具 | 渲染器 `tests/audio-leak-graph-probe.mjs`（量"接 destination 那条边"的电平，6 次采样取峰值防假绿）、插件 `tools/audio-leak-frame-probe.mjs`（**新增**两处存储存档/复原/复核） | 探针**不判红**（取证）；但复原复核失败**会**判红 |

**关键语义**（渲染器侧）：

```
silent = (muted === true) ∨ (宿主停渲染) ∨ (音量 == 0)
         ∨ (muted === null ∧ 带 ?embed=1 的嵌入帧 ∧ 没有手势)
masterGain = silent ? 0 : 1          // 全页只有这一条边进 destination
parked = 宿主说"这一页被收起来了"      // 隐藏/兜底/省电 ⇒ 逐个 pause + ctx.suspend()
```

---

## 7. 未验证边界（如实）

1. **平台不同**：本机是桌面 Firefox + llvmpipe；用户是 **Android Via/Chromium + Adreno 830**。
   本机量的是"到达 destination 那条边的电平"，**不是"声卡真的响了"**。
2. **自动播放策略**：桌面缺省策略下不给手势就不出声 ⇒ 用
   `media.autoplay.default=0 + blocking_policy=2 + block-webaudio=false` 复刻 WebView 的免手势口径。
   真机上"免手势就能出声"这一点需单独复核。
3. **插件客户端在 DSH 里是加载期缓存**：实测服务端返回的内容哈希与本地文件哈希不一致 ⇒
   **本轮修法要等插件重载 / 宿主重启才会进用户的浏览器**；因此路径 A 的"插件发送那一半"
   由离线判据（D5–D11 + 5 组变异）钉住，渲染器收口那一半是真机路径实测的。
4. **E8/E9（跨进程/其它页面）本机观测不到**。
5. H4（鲸鱼挂件）**未修**，只在审计里留痕。
6. 预览弹窗是否有带声音的播放路径（E7）**未验证**。

---

## 8. 给判定者 / 用户的最小实验（按顺序做，能一刀切开）

1. **先分清"哪一层的声"**（30 秒）：在 DSH 宿主页控制台执行
   ```js
   // 宿主页所有媒体元素：谁在放、音量多少
   [...document.querySelectorAll('audio,video')].map(e => ({ id: e.id, src: (e.currentSrc||'').slice(-40), paused: e.paused, muted: e.muted, vol: e.volume }))
   // 本插件自己的音频审计（带调用栈与归属）
   window.__mpwAudioAudit && window.__mpwAudioAudit.list.slice(-10)
   ```
   - `owner: "whale-widget"` ⇒ 是**第三方挂件音效**（H4），与壁纸无关；
   - `owner: "ours"` + `paused:false` ⇒ 看 H5/H8；
   - **两者都没有** ⇒ 声源在帧里或进程外（H1/H2/H3/H9）→ 下一步。
2. **再把宿主页所有媒体元素全静音**（`el.muted = true` 逐个）：
   若**仍然有声** ⇒ 声源在**帧内**（H1/H2/H3）或**进程外**（H9）。
3. **帧内自证**（渲染器帧的 devtools 上下文）：
   ```js
   ({ policy: window.__mpwAudioPolicy, graph: window.__mpwAudioGraph() })
   // 期望（静音时）：graph.masterGain === 0；若 parked:true ⇒ ctx 应为 suspended
   ```
   宿主侧（插件页控制台）：`window.__mpwRendererAudioPush.last`
   （期望跨源时 `{posted:true, sameOrigin:false}`，刷新后那一次 `stale:true`）。
4. **进程外排查**：真机上关掉其它浏览器标签页/其它 App，再复现一次；仍响 ⇒ E8/E9。
5. **回看宿主档有没有被写坏**：
   ```bash
   curl -s http://127.0.0.1:3080/api/mpkg-wallpaper/settings | python3 -m json.tool | grep -E 'mpkgName|sceneKey|webUrl|converted'
   ```
   `sceneKey/mpkgName` 里出现 `probe` 或 `webUrl` 里出现 `audio=1` ⇒ 就是 H3 那类污染。

---

## 9. 时间线（本轮，便于判定者对齐）

| 时刻 | 事件 |
|---|---|
| 09-24 17:48–18:38 | 音频探针多轮跑（含 `--mount-scene --policy-push --fallback --frame-play`），逐轮留下读数与信标 |
| 09-24 18:51:13 | 真机最后一条审计信标（鲸鱼挂件 `press.mp3?set=duck`，触发 `mute-on-but-audible`）；同一秒插件把"探针档"PUT 到宿主端 |
| 09-24 19:0x | 用户报：背景变成"原来的 8899"、各种功能都在背景里；此前已报"静音开着仍有声、不是当前壁纸的音频" |
| 09-24 19:36:31 | 发现宿主档被探针污染 → **PUT 回用户真档并逐键复核**（`converted=mp4`、`mpkgKey=custommpkg\|小鸟游星野01_04.mpkg`、`webUrl=""`、`sceneKey` 删除） |
| 09-24 19:4x | 探针加固：两处存储存档 + 复原 + 复核（不一致判红）；C4/C3 报告从被 gitignore 的 `docs/reports/` 迁到 `docs/reports-particle-force-c3c4-verdict.md` |
| 09-24 20:0x | 外部 AI 判定回来：**分层结论**（09-24 = H3+H2+H1；长期偶发 = H4）、E8 升级 + 补 E10–E12、三处审计盲区、修法需分层到宿主、时间线对齐 —— 已按 §10 落进本文 |

---

## 10. 判定意见的落地清单（本文已改什么 / 还缺什么）

### 10.1 已落进本文

| 判定意见 | 落地位置 |
|---|---|
| 分层结论：09-24 = H3+H2+H1；长期偶发 = H4；**不要用单条机制解释全部原话** | §0 结论 1、§4 各条现状、§5 |
| 逐段映射（B 段 → H3 直因 / H2 条件 / H1 画面；C 段 → 跟随 B 段；A 段 → H4 独立） | §0 结论 1 + §3.3 |
| **E8 升级**为"用户设备高概率已知出口"；补 **E10/E11/E12** | §2 表 |
| **审计盲区三条**（跨源帧 / 跨进程 / `MediaElementAudioSourceNode` 下游语义） | §3.1a |
| 修法分层（插件层 = 治本于自身；宿主层 = 治本于整机） | §10.2 |
| 时间线对齐（19:0x 现场 = 旧客户端 + 污染档 ⇒ 不是对新修法的反证） | §10.3 |

### 10.2 宿主层要做的三件事（**不在本仓写权内**，需要 DSH 宿主 / 各插件配合）

1. **宿主级全局音频总线**：在 DSH 宿主页统一拦截 `AudioNode.prototype.connect`、
   `HTMLMediaElement.prototype.play`、`Audio` / `AudioContext` 构造，**对所有插件生效**。
   —— 落地形态可**直接复用**壁纸插件已有的 `dsh-mpkg-wallpaper/lib/audio-bus.js`
   （原型级 connect 拦截 + 懒建 `masterGain` + `setMuted`，`:11-16 / :311-320 / :941`），
   把它从"壁纸插件私有"提升为"宿主级模块"，并**补上纯元素音频**（未接进 WebAudio 的 `<audio>/<video>`：
   目前只有 `el.muted`/`pause` 一条杠杆 ⇒ 要在 `play()` 层做策略拦截）。
2. **宿主级静音契约**：暴露一个全局标志（如 `window.__dshAudioPolicy = { muted, park }`）
   + 文档化事件，所有插件**必须**尊重。没有这个契约，鲸鱼挂件这类第三方**永远漏**（= H4 无法闭环）。
3. **跨进程路径**：若 DSH 在 Android 上使用系统壁纸服务/独立 WebView，必须在**那些进程内**装同样的钩子，
   或由宿主统一管理音频策略；否则 E8/E10 永远在壁纸插件的写权之外。

### 10.3 判定"修法是否有效"时的口径（重要，避免误判）

- 用户 09-24 19:0x 的现场跑的是 **DSH 加载期缓存的旧客户端 + 被探针污染的档**
  （见 §7 第 3 条）⇒ **该现场不构成对本次修法的反证**（它压根没跑到新代码）。
- 有效性的最小验证顺序：① 插件重载/宿主重启后，宿主档里**不再有** `probe`/`audio=1`（§8 第 5 步）；
  ② 帧内 `__mpwAudioGraph().masterGain === 0`（静音档）；③ 隐藏帧场景下 `parked:true` 且 `ctx:"suspended"`。
- 若 ①②③ 全绿而**仍有声** ⇒ 声源在 **E5/E6/E8/E10/E11/E12**，属于 §10.2 的宿主层范围，不是壁纸插件回归。

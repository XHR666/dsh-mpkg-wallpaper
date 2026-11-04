# ISSUE0924A-3「刷新后仍在漏音」收口报告（**静音 = 真的没声**：元素路径 + WebAudio 图路径）

- 线：**刷新后仍在漏音**（用户复现：刷新之后壁纸没自动播放、NP 暂停、壁纸设置里静音已打开，**仍然有声音**；
  点 NP 播放后壁纸才重新加载并播放）。
- 两仓写权内改动：渲染器仓 `we-scene-demo`（GPL-3.0-or-later）`demo.html` + `tests/*`；
  插件仓 `dsh-mpkg-wallpaper`（MIT）`lib/client.js` + `tools/*`。**未 commit、未 `git add`**。
- 基线（**钉死提交哈希**，非 `HEAD:` 代称）：

  | 仓 | 提交 | 改前文件 sha256 | 改后文件 sha256 |
  |---|---|---|---|
  | we-scene-demo | `a3bb009d2b567dcbd080c67f516432c783e196f3` | `demo.html` `c005cc10…43c37c` | `demo.html` `22e32c79…5a90d7` |
  | we-scene-demo | 同上 | `tests/render-audio-leak-test.mjs` `24d2c71e…1b1b54` | 同名（47 断言，最新哈希见下） |
  | dsh-mpkg-wallpaper | `5544f5574f24d15a94ef828abbf38e302c0dcec9` | `lib/client.js` `3265785a…00f44e` | `lib/client.js` `b94ff6f6…75c493` |
  | dsh-mpkg-wallpaper | 同上 | `tools/np-media-test.mjs`（未改前） | `19ca864a…b1c37a` |

  （渲染器工作区里另有 D/E/G 三条线的未提交改动 —— 本轮的渲染器改动**只有 9 处音频点**，
  逐条列在 §3，未触碰 `fetchHeader` 等任何无关区域。）

---

## 0. 结论（先给会被引用的一句）

> **追加（用户最新线索）**："又开始播放音频了，这个音频**并不是我当前壁纸的音频**（没动音频、也没刷新页面）"
> ⇒ 真因不止"当前这张没被静音"，还有一条**"上一个（被藏起来的）渲染器帧没被停"**：
> 场景看门狗兜底（`sceneFallbackActivate`）把渲染器 iframe **藏起来但保留 src**（等迟到首帧恢复，
> `.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame{display:none!important}`，`lib/client.js:14595`），
> **而隐藏的 iframe 里音频照样在放**（实测：`display:none` 后帧内 ctx `running`、masterGain 1、峰值 0.027）。
> 用户看到的画面是**静态帧**（"壁纸没有自动播放"），听到的是**那个被藏起来的帧**里的 BGM —— 也就是
> "不是当前壁纸的音频"。这一条已按"**收起来 = 停源**"修掉，并且**渲染器侧自带探测**（不依赖宿主通道）。

**初始定性里有一半被实测推翻了**：桌面 Firefox 上 `muted` **能**压住 `MediaElementSource` 的图输出
（改前 A/B：`el.muted=true` ⇒ destination 抽头 rms 0）。所以"漏音"**不是**"`muted` 属性对 WebAudio 无效"。

真因是三条叠加：

0. **被"隐藏但保留"的旧帧继续出声**（用户最新线索指向的那条；见 §2 R0 与 §5.3）。
1. **渲染器侧根本没有"图级静音"这条落点** —— 声源（`<audio>` 经 `createMediaElementSource`）直连
   `ctx.destination`，宿主的静音只能写**元素**属性；而 `setVolume` 也只乘进元素 `volume`。
2. **插件的静音信号一条都到不了那个帧** —— 场景渲染器 iframe 在 `127.0.0.1:8902`、插件页在
   `127.0.0.1:3080` ⇒ **跨源**：`frame.contentDocument` 为 null（逐元素写 `muted` 的扫描扫不到）、
   `window.frameElement` 为 null（宿主写的 `frame.muted` expando 读不到）、shim policy 只对
   `?mpwshim=1` 的网页壁纸帧生效。

实测（插件档 + 场景渲染器档 + **静音=开** + 刷新 + 不点任何东西）：帧内 4 条 `<audio>` 全是
`muted:false / volume:0.25 / paused:false`，`AudioContext` running，**接 destination 那条边的抽头
rms≈0.0134 → 0.0189（在出声）**，帧内 `msgs:[]`（**没有任何静音消息到过**）。

修法：渲染器加**一个** master GainNode 总闸（静音 ⇒ 图级 0 增益）＋**收起来就停源**（`pause` 元素 +
`ctx.suspend`，宿主 `park` 通道 + 帧内 **rAF 停摆**自证），并把"宿主表态"做成三条可达通道
（URL / **postMessage** / 同源 `__wp`）；嵌入帧里**宿主还没表态就先静音**（fail-safe ⇒ 宿主通道再坏也不漏音）；
插件侧把静音/音量/停源经**跨源唯一可达的 postMessage** 下发，且**帧重载（刷新）后即使值没变也重发一次**。

---

## 1. 复现（本机两条宿主路径）

### 1.1 环境与量法（先说清"量的是什么"）

- 本机：桌面 **Firefox 有头 + X `:0` + llvmpipe（软件渲染）**，不是用户的 Android WebView/Adreno。
- 自动播放策略：`--permissive` = `media.autoplay.default=0` + `media.autoplay.blocking_policy=2`
  + `media.autoplay.block-webaudio=false`（**等价于 Android WebView 的
  `setMediaPlaybackRequiresUserGesture(false)`**：不给任何手势也允许出声）。
  **桌面缺省策略下不点一下根本不出声 ⇒ 漏音本身量不到**（见 §1.4 的"策略基线"读数）。
- 区分"元素在放"与"**图**在放"的手法（探针核心，10 行）：在页面任何脚本之前包一层
  `AudioNode.prototype.connect`，凡是 `node.connect(ctx.destination)` 一律改接**探针 AnalyserNode**
  （探针再连 destination）。于是 `getByteTimeDomainData` 的 RMS = **真的会到达 destination 的那份信号**：
  `rms>0` ⇒ 在出声；`rms==0` ⇒ 元素即便 `paused:false` 也一个字节都没出去。
  辅助读数：`window.__mpwAudioLedger`（建/放/写次数台账）、`window.__mpwAudioPolicy`（当前策略）、
  `window.__mpwAudioGraph()`（master 值/节点数/声源数/ctx 状态）。
- **峰值保持**：单次 `getByteTimeDomainData` 只是 ~46ms 的一窗，音轨的静音段、blob 兜底看门狗补
  `load()` 的瞬间都会读到 0 ⇒ 两条探针都改成 **6 次采样取最大**（`rmsPeak` / `峰值`）。
  本轮实测踩到过一次"单窗 0、峰值 0.0192"的假绿，所以这条不是洁癖。

### 1.2 路径 B：测试台 `:8902` 预览（`?shell=0`）

```
node tests/audio-leak-graph-probe.mjs --permissive \
  --url "http://127.0.0.1:8902/webloader/?pkgpath=<语料>/dd/3719111841/scene.pkg&audio=1&shell=0"
```

改前（`/tmp/probeB-before-permissive2.txt`，语料 `3719111841`（凯尔希，4 条 MP3，首条 volume 0.5））：

| 读数 | ctx | 4 条 `<audio>` | destination 抽头 rms | 判决 |
|---|---|---|---|---|
| R2 基线（无静音动作） | running | `paused:false muted:false volume:0.25` | **0.0093** | 在出声 |
| R3 元素通道：逐个 `muted=true` | running | `muted:true` `volume` 未动 | **0** | `muted` **压得住**（⇒ 推翻"muted 对图无效"） |
| R4 宿主音量：`__wp.setVolume(0)` | running | `volume:0` | **0** | 元素 volume 路径也压得住 |
| R5 图级通道：`postMessage{mpw-audio-policy,muted:true}` | running | — | **0.0167** | **修前没有任何图级通道**（消息被忽略） |

### 1.3 路径 A：插件（DSH profile / `scnRender` iframe），**用户序列**

`tools/audio-leak-frame-probe.mjs --mount-scene --refresh`：
把"场景渲染器档"写进插件档案（`converted:"scene"` + `sceneKey` + `webUrl=…/webloader/?pkgurl=…&embed=1&audio=1`，
与 `applySceneViaRenderer` 写的是**同一批字段**），随后 `page.reload()` = 用户说的"刷新"；
包源用渲染器自己的 `/pkgpath`（避免改用户的库目录设置）；结束时**复原**探针进入时的设置。

改前（`/tmp/probeA-scene-before3.txt`，设置 `mute=true`）：

| 读数 | 值 |
|---|---|
| 帧可达性（宿主侧） | `same:false`（`contentDocument`=null）· `hasBus:false`（跨源 patch 不到）· `shim:false` · `mutedExpando:true`（宿主写了 expando） |
| 帧内 `window.frameElement` | `null` ⇒ 渲染器 `hostEmbedMuted()` 恒 false（**宿主写的 expando 读不到**） |
| 帧内媒体元素 | 4 × `AUDIO paused:false muted:false volume:0.25 inTree:true hasSrcNode:true` |
| AudioContext | `running`，`currentTime` 递进，**零手势**（`gesture:0`） |
| destination 抽头 rms | **0.0134 → 0.0189（在出声）** |
| 帧内收到的静音消息 | `msgs: []`（**一条都没有**） |
| 帧内 `play()` 裁决 | `["ok","ok","ok","ok"]`（真机上这四首就直接放出去了） |

### 1.4 策略基线（诚实边界，不是漏音证据）

同一条 URL、**桌面缺省**自动播放策略（`/tmp/probeB-before-default.txt`）：点一下之前 rms 恒 0、
元素 `paused:false` 但 `currentTime` 不推进 ⇒ 桌面缺省策略本身挡住了出声。**这就是为什么必须用
`--permissive` 才有现场**（详见 §6）。

---

## 2. 根因（file:line + 证据）

### R0 ★「响的不是当前壁纸的音频」= **被藏起来的旧渲染器帧还在放**（用户最新线索）

- `lib/client.js:3988 sceneFallbackActivate()`：注释自己写着"**兜底激活：隐藏 iframe（保留元素与 src）**、
  显示静态帧" —— 只加类名 + 换静态帧图，**不动帧**；`lib/client.js:14595` 的 CSS 把它 `display:none !important`。
- 隐藏的 iframe **不会**停媒体：实测（`tools/audio-leak-frame-probe.mjs --fallback`）加类命中
  `display:none` 之后，帧内 `ctx: running / masterGain: 1 / parked: false`、峰值 **0.027**（在放）。
- 同一类"隐藏但不卸载"的路径还有：总开关关掉（web 分支 `f.style.display="none"`）、省电/切后台
  （`pauseWebFrame()` —— 跨源帧 `shimOk` 只是"postMessage 投出去了"，`contentDocument` 又是 null
  ⇒ 两条老通道都等于没停、返回值还是 0）、切走时 `teardownWebFrame()`。
- 与 R1+R2 叠加：帧被藏起来 ⇒ 用户看到静态帧（"壁纸没有自动播放"）＋ 听到旧帧的 BGM（"不是当前壁纸的音频"）；
  点 NP 播放触发重挂（`showWebEl` 换 src）⇒ 旧文档销毁、新文档加载 = "才开始重新加载刚才的壁纸"。

### R1 渲染器没有"图级静音"落点（声源直连 destination）

- 改前 `demo.html:4484`：`if (!analyser._mpwDest) { analyser.connect(sceneAudio.ctx.destination); analyser._mpwDest = true }`
  —— 唯一的出口边是 `analyser → destination`，**宿主没有任何引用能改它**。
- 改前 `demo.html:4522 updateSceneAudioVolume()`：只写 `v.el.volume`（元素音量）。
- 改前 `demo.html:2343-2349 setVolume`：注释自己写着"宿主音量乘进 sound 层算式；`?audio=1` 之外没有音轨元素
  ⇒ 只是记档" ⇒ 宿主 API 面里**没有静音**这一项。
- 证据：§1.2 R5（`postMessage` 被忽略，rms 仍 0.0167）、§1.3（静音=开、帧内 rms 0.0134+）。

### R2 插件 → 场景帧的三条通道**全部不可达**（跨源）

`lib/client.js applyWebMute`（改前 `:4296-4329`）只有三条落点，对 `127.0.0.1:8902` 的场景帧全失效：

| 落点 | 改前位置 | 为什么到不了 |
|---|---|---|
| `frame.contentDocument.querySelectorAll("video,audio")` 逐元素写 `muted` | `lib/client.js:4321-4327` | 跨源 ⇒ `contentDocument` 为 null（§1.3 读数 `same:false`） |
| `frame.muted = mute`（expando，给帧内读） | `lib/client.js:4309` | 渲染器 `window.frameElement` 跨源恒 `null` ⇒ 读不到（§1.3） |
| shim policy（`webShimCallChecked`） | `lib/client.js:4311-4320` | 只对 `mpwWebShimUrl(src)`（`?mpwshim=1`）的网页壁纸帧发；场景渲染器 URL 没有这个标记 |

⇒ 用户"设置里静音已打开"，而那个帧**收不到任何静音信号**。

### R3 帧内 BGM 为什么会接进图（`?audio=1` 的来路）

- 渲染器：`AUDIO_ENABLED = /[?&]audio=1/`（`demo.html:4348`）⇒ `startSceneAudio()` 才接图。
- 插件：`MPW_SCENE_DEBUG_KEYS` 白名单里**没有 `audio`** ⇒ 面板的"渲染器调试参数"透传不会带上它；
  但**面板文案本身**教用户把诊断旗标拼在渲染器地址后面（`http://127.0.0.1:8902/webloader/?id=…&audit=3`），
  且渲染器地址可由用户配置（`sceneRendererUrl`）⇒ 地址里带 `&audio=1` 时，帧内 4 条 BGM 就接进 WebAudio 图，
  而 R1+R2 让它们**压不住**。

### R4 `npFrameSoundBlocked()` 的口径（次要，已对齐）

改前 `lib/client.js:8370-8378` 用 `npAudioOwns()`（只看 `npAudio.paused` 与有没有 src）判"我们是否占用帧内声音"。
元素在放但被 `muted` / `volume=0` 时**并不出声**，却仍把帧内压住 ⇒ 口径与"真的在放音"不一致。
（**注意**：用户报的"静音开着仍有声音"**不靠这条** —— 设置项 `mute` 是独立的一项，改前也照样生效。）

---

## 3. 改法

### 3.1 渲染器 `demo.html`（9 处，全部音频相关；D 线的 `fetchHeader` 等区域未触碰）

| 位置（改后行号） | 内容 |
|---|---|
| `demo.html:4570-4720` **新增音频总闸块** | `audioGate` + `mpwAudioSilent()`（静音判据）+ `mpwAudioApply()`（幂等写图/写元素）+ `mpwAudioConnectMaster()`（懒建 master，`声源 → master → destination` 全页唯一出口边）+ `mpwAudioSetPolicy()` + `mpwAudioGesture()` + 三条通道接线（URL / `postMessage` / 同源 `frameElement.muted`）+ `window.__mpwAudioPolicy`、`window.__mpwAudioGraph()` |
| `:4506` `startSceneAudio()` | 声源不直连 destination ⇒ 经 `mpwAudioConnectMaster(analyser)`；`kick` 里补手势解闸 |
| `:4468` `makeSoundElement()` | 总闸静音时**不自动起播**（台账 `playSkips`）⇒ "元素没在放"与"图级 0"读数可分 |
| `:4725` `updateSceneAudioVolume()` | 宿主音量档同时进总闸（**只用于"音量 0 = 静音"这一档**，避免乘两次） |
| `:4541` `mpwReleaseSceneAudio()` | 释放时一并 `master.disconnect()` + 清引用（谁建谁释放） |
| `:2353-2365` 宿主 API | 新增 `__wp.setMuted(bool)` / `__wp.setAudioPolicy({muted,volume})` / `__wp.audioPolicy()`（图读数） |
| `:2301` `__wp.pause()/resume()` | 画面被宿主停住 ⇒ 图级静音（"没画面却在响"） |
| `:8469` `ensureAudioCtx()`（音频面板） | 分析器经总闸（旧写法直连 ⇒ 面板播放绕开图级静音） |
| `:8599` 面板播放键 | 点播放 = 用户手势 ⇒ 解"宿主还没表态"那一档（**不覆盖**宿主显式静音） |
| `:4695` **新增 `mpwAudioPark(on, reason)`** | **收起来 = 停源**：逐个 `pause()` 元素 + `ctx.suspend()`（图里别人建的节点也停）+ 台账 `parks/resumes`；放回去按**当前策略**（静音中不出声） |
| `:4749` postMessage 通道扩展 | 接受 `park`/`stop`/`type:"mpw-audio-stop"` ⇒ 宿主说"收起来"就停源（插件 `sendRendererAudioPolicy(frame, mute, park)` 发这条） |
| `:4755-4790` **新增 rAF 停摆自证** | 帧自己的 `requestAnimationFrame` 停摆 >2.5s ⇒ `park(true,"raf-stall")`；恢复 ⇒ 按策略 `park(false,"raf-resumed")`（**只在 `?embed=1` 壁纸帧生效**）。**实测否定过 IntersectionObserver**（对 `display:none` 的 iframe 照旧报 intersecting ⇒ 已删除，不留死防线） |

**关键语义**：

```
silent = (muted === true) ∨ (宿主停渲染) ∨ (音量 == 0)
         ∨ (muted === null ∧ 带 ?embed=1 的嵌入帧 ∧ 没有手势)
masterGain = silent ? 0 : 1          // 只有这一条边进 destination
```

- **fail-safe**：`?embed=1`（插件挂场景渲染器时**恒带**）+ iframe + 宿主没表态 ⇒ **先静音**。
  宿主通道再坏也不会漏音；宿主/用户表态（`muted:false` 或帧内手势）即可出声。
- **不新增诊断旗标名**：URL 通道复用已登记的 `audio`（`?audio=0/off/false` = 显式静音）；
  上一版草稿里的 `mpwmute/mpwaudio/audioallow/audiogate` 已删（`tests/diag-flag-check.mjs` 会判红 ⇒ 已改成 0 差异）。
- 顶层页（测试台预览 `?shell=0`）**不套 fail-safe** ⇒ `?audio=1` 的既有可听行为逐位不变。

### 3.2 插件 `lib/client.js`（6 处，全部"隐藏/切走 ⇒ 停源"）

| 位置（改后行号） | 内容 |
|---|---|
| `:4305-4336` 新增 `sendRendererAudioPolicy(frame, mute)` | 跨源唯一可达通道：`{type:"mpw-audio-policy", muted, volume}`；同源时再走一遍 `cw.__wp.setAudioPolicy`；台账 `window.__mpwRendererAudioPush{n,last,log}` |
| `:4350` `applyWebMute()` 里调用 | **每次 applyWebMute 都尝试下发**（含帧 `load`、800ms/2s 周期、刷新后第一次）；幂等：同一 `contentWindow` 值没变不重发；**`contentWindow` 换了 ⇒ 即使值相同也重发**（刷新那条缝） |
| `:8322-8331` 新增 `npOwnAudible()`；`:8378` | `npFrameSoundBlocked()` 口径对齐"**真的在出声**"（`paused` ∧ `!muted` ∧ `volume>0`） |
| `:3994` `sceneFallbackActivate()` | ★ **看门狗兜底隐藏 iframe 时下发 `park:true` + 留痕 `__mpwSceneFallbackPark`**（用户最新线索那条缝） |
| `:3983` `mpwSceneWdConfirm()` | 迟到首帧恢复 ⇒ `park:false` + `applyWebMute(frame)` 重下发当前策略 |
| `:9271` `pauseWebFrame()` | 按"**这个帧是不是 shim 帧**"分流：非 shim/跨源帧（场景渲染器）⇒ `park:true`（旧写法 `shimOk` 只是"postMessage 投出去了"，跨源帧上等于什么都没停） |
| `:9290` `resumeWebFrame()` / `:3174` `teardownWebFrame()` / 总开关关掉分支 | 恢复 ⇒ `park:false`；切走/关总开关 ⇒ 先 `park:true` 再撤 src/隐藏 |

---

## 4. 判据（"改回去必红"）

| 判据 | 文件 | 覆盖 | 变异自证 |
|---|---|---|---|
| 图级静音 + 收起来/切走 **47 断言**（[E1]–[E15] + **[G0]–[G8]** + [F0]–[F6]） | `tests/render-audio-leak-test.mjs` | ①接 destination 的边**只有一条且来自 master**；②静音 ⇒ `master.gain=0`（并先 `cancelScheduledValues`）；③元素 muted 双保险；④幂等（`gateWrites` 不增长）；⑤静音中不自动起播；⑥解除只撤自己按下的；⑦宿主音量 0 ⇒ 图级归零；⑧宿主停渲染 ⇒ 静音；⑨`?embed=1` 嵌入帧未表态 ⇒ fail-safe；⑩无 `embed` 的 iframe（测试台预览）不套 fail-safe；⑪三条通道在源码里真的接上；**⑫收起来 ⇒ 元素全 `pause` + `ctx.suspend()` + 台账 `parks`（幂等）；⑬静音中"放回去" ⇒ ctx 恢复但 masterGain 仍 0；⑭帧内 **rAF 停摆**探测在源码里（且**不**留 IO 死防线）；⑮切走（释放）后旧源零残留、再挂载只多一套** | **[F1]** 删掉 `mg.value = want`（= 只写元素 muted 的旧写法）⇒ [E3] 必红；**[F3]** 声源退回直连 destination ⇒ [E1] 必红；**[F5]** 删掉 park 的 `pause` 循环（= "隐藏了但还在放"）⇒ [G1] 必红；**[F6]** 拆掉 rAF 停摆探测 ⇒ [G6] 必红 |
| 插件静音/停源落点 **D1–D11** | `tools/np-media-test.mjs`（`check.sh` 步 2/12） | D5 静音=开 ⇒ 下发 `muted:true`；D5b 同源 `__wp.setAudioPolicy` 也走；D6 静音=关 ⇒ `muted:false`；**D7 帧刷新（`contentWindow` 换）⇒ 重新下发一次**；D8 同文档同值再 apply 3 次 ⇒ **一条都不多发**；D8b 台账可机读；D9 `npFrameSoundBlocked()` = 真的在出声；**D10 看门狗兜底（隐藏 iframe）⇒ 下发 `park:true`（停源）；D10b 兜底留痕；D11 跨源帧暂停（shim/contentDocument 两条都到不了）⇒ 走 `park:true`；D11b 恢复 ⇒ `park:false` 且不无条件 play 帧内媒体** | G 组 **21 组**变异新增 5 条：`renderer-audio-policy-not-sent` / `renderer-audio-policy-not-resent-after-reload` / `np-frame-sound-blocked-uses-paused-only` / **`scene-fallback-does-not-park-frame-audio`** / **`cross-origin-frame-pause-does-nothing`** ⇒ 各自让 D 组变红 |
| 真机取证（不判红，读数为准） | `tests/audio-leak-graph-probe.mjs`（渲染器）· `tools/audio-leak-frame-probe.mjs`（插件，`--mount-scene --policy-push --fallback --frame-play`） | 见 §5；两条都是"元素路径 vs 图路径"分开量，并且**把"隐藏"这一步也复刻出来** | — |

---

## 5. 改前 / 改后成对读数（两条宿主路径）

### 5.1 路径 B：测试台 `:8902` 预览（`?shell=0`，`--permissive`）

> 读数是**峰值保持**（6 次采样取最大，见 §1.1）：单窗 RMS 会被音轨静音段/兜底 `load()` 的瞬间读成 0，
> 拿它下"静音生效"的结论就是假绿 —— 本轮实测里 R6 就出现过一次单窗 0（峰值 0.0192，其实在响）。

| 步骤 | 改前 rms | 改后 rms（峰值） | 改后 `__mpwAudioGraph()` |
|---|---|---|---|
| 基线（无静音动作） | 0.0093 | **0.0159** | `masterGain:1, nodes:2, sources:4` |
| `postMessage{mpw-audio-policy,muted:true}` | **0.0167（在出声）** | **0** | **`masterGain:0`** |
| 解除（`__wp.setMuted(false)`） | —（该 API 不存在） | **0.0192** | `masterGain:1` |
| 再静音（`__wp.setMuted(true)`） | — | **0** | `masterGain:0`，节点数 2→2（幂等） |

改前另两条读数（证明"元素路径"本身是好的、缺的只是**图级**落点）：
逐个 `el.muted=true` ⇒ 峰值 **0**；`__wp.setVolume(0)` ⇒ 峰值 **0**。

### 5.2 路径 A：插件 + `scnRender` 场景帧（`mute=true`，**刷新之后，不点任何东西**）

> 同样峰值保持（6 次采样 / ~1.1s）。改前日志：`/tmp/probeA-scene-before3.txt`；
> 改后日志：`/tmp/probeA-final.txt`（探针最后仍会**复原**设置）。

| 步骤 | 改前 | 改后 |
|---|---|---|
| 刷新后（宿主**尚未**下发策略） | 帧内 **rms 0.0134–0.0189**（在出声）；`policy:null`；`msgs:0` | 帧内 **rms 0 / 峰值 0**；`policy={muted:null, silent:true, src:"startSceneAudio", msgs:0}`；`graph={hasMaster:true, masterGain:0, nodes:2, sources:4}` ⇒ **fail-safe**（宿主通道全坏也不漏音） |
| 宿主下发 `muted:true`（修复后插件发的就是这条） | —（无通道） | `rms 0 / 峰值 0`，`masterGain:0`，`msgs:1` |
| 宿主下发 `muted:false`（**对照**：证明上面的 0 不是"本来就没在放"） | — | **`rms 0.0189 / 峰值 0.0424`**，`masterGain:1` |
| 再下发 `muted:true` | — | `rms 0 / 峰值 0`，`masterGain:0`，`msgs:3` |
| 帧内自己 `play()`（4 条全 `ok`）**之后** | — | **`rms 0 / 峰值 0`** ⇒ 压住的是**图**，不是靠暂停元素 |

### 5.3 路径 A 追加：**「被藏起来的帧」**（用户最新线索，`--fallback` 步骤）

复刻插件兜底隐藏（`#mpw-bgWrap` 加 `mpw-scene-fallback`，实测命中
`iframe.mpw-webFrame { display: none }`），三次读数同一会话、不刷新：

| 步骤 | 图读数 | 峰值 | 判决 |
|---|---|---|---|
| S10 帧**可见** + 宿主放行 | `parked:false, ctx:running, masterGain:1` | 0.0166 | 在放（对照） |
| S11 帧**被藏起来**（修复后：帧内 rAF 停摆探测生效） | **`parked:true, parkReason:"raf-stall", ctx:"suspended", masterGain:0`**，元素全 `paused:true` | 0.0166（**残留缓冲**，见下） | **已停源** |
| S12 ☆**改前等价**（把帧内探测拆掉 = 修前行为 + 在线插件是旧 bundle、没有 park 通道） | `parked:false, ctx:running, masterGain:1` | **0.0268** | **隐藏的帧照样在放 = 用户听到的那段声音** |

> ⚠ **读数口径（本轮实测踩到的坑）**：`ctx.suspend()` 之后，destination 抽头的
> `getByteTimeDomainData` **停留在最后一帧缓冲**（S11 那个 0.0166 就是这么来的，不是"还在出声"）。
> 所以"有没有声"要以 `parked / ctx==='suspended' / masterGain===0 / 元素 paused` 为准，
> 抽头只在"图在跑"时才是权威读数 —— 这条已写进探针的判决逻辑（`audibleOf()`）。

### 5.4 路径 B 追加：桌面缺省策略下的"没声"是策略挡的，不是修好的

见 §1.4：不给手势时 rms 恒 0、`currentTime` 不推进 ⇒ 与"静音生效"是两件事，报告里不混用。

> 同样峰值保持（6 次采样 / ~1.1s）。改前日志：`/tmp/probeA-scene-before3.txt`；
> 改后日志：`/tmp/probeA-final.txt`（探针最后仍会**复原**设置）。

| 步骤 | 改前 | 改后 |
|---|---|---|
| 刷新后（宿主**尚未**下发策略） | 帧内 **rms 0.0134–0.0189**（在出声）；`policy:null`；`msgs:0` | 帧内 **rms 0 / 峰值 0**；`policy={muted:null, silent:true, src:"startSceneAudio", msgs:0}`；`graph={hasMaster:true, masterGain:0, nodes:2, sources:4}` ⇒ **fail-safe**（宿主通道全坏也不漏音） |
| 宿主下发 `muted:true`（修复后插件发的就是这条） | —（无通道） | `rms 0 / 峰值 0`，`masterGain:0`，`msgs:1` |
| 宿主下发 `muted:false`（**对照**：证明上面的 0 不是"本来就没在放"） | — | **`rms 0.0189 / 峰值 0.0424`**，`masterGain:1` |
| 再下发 `muted:true` | — | `rms 0 / 峰值 0`，`masterGain:0`，`msgs:3` |
| 帧内自己 `play()`（4 条全 `ok`）**之后** | — | **`rms 0 / 峰值 0`** ⇒ 压住的是**图**，不是靠暂停元素 |

原始日志：`/tmp/probeB-before-permissive2.txt`、`/tmp/probeA-scene-before3.txt`、`/tmp/probeB-after.txt`、
`/tmp/probeA-scene-after2.txt`（本机 `/tmp`，报告里给的是逐条读数）。

---

## 6. 未验证边界（如实）＋ 真机复核步骤

1. **平台不同**：本机是桌面 Firefox + llvmpipe，用户现场是 Android WebView + Adreno。
   本机**量不到"声卡真的响了没有"**——量的是"接进 destination 那条边上的电平"（信号等价物，不说成"我听到了"）。
2. **自动播放策略不同**（最关键的一条）：桌面缺省策略下**不给手势就不出声**（§1.4），漏音现象本身量不到；
   本轮用 `media.autoplay.default=0 + blocking_policy=2 + block-webaudio=false` 复刻
   WebView 的"免手势"口径。**⇒ 真机上"免手势就能出声"这一点本身要单独复核**（下面第 4 步）。
3. **插件客户端在本机是加载期缓存**：DSH 在插件加载时就把 client bundle 缓存在进程里 ——
   实测服务端返回的 `rev=2cb504b3262b` ≠ 改后本地内容哈希 `40950d9ad5c3`，且返回内容里没有
   `sendRendererAudioPolicy`。**⇒ 本轮没有重启 DSH（会打断用户当前会话）**，所以路径 A 的
   "**插件发送那一半**"在现场只由**离线判据**（D5–D9 + 3 组变异）钉住；
   "**渲染器收口那一半**"是**真机路径实测**的（§5.2 的"宿主下发"两步是探针按修复后插件的载荷逐字下发）。
4. **真机复核（一条可复制的检查步骤）**：插件重载 / 宿主重启后，在壁纸为场景档、设置里静音=开、
   刷新一次页面，然后在**浏览器控制台**（渲染器帧的 devtools 上下文里）执行：

   ```js
   // 帧内自证：图级静音有没有生效（0 = 没声；msgs>0 = 宿主策略到过）
   ({ policy: window.__mpwAudioPolicy, graph: window.__mpwAudioGraph() })
   // 期望：policy.muted === true（或 null 且 silent === true）、graph.masterGain === 0
   // 宿主侧自证（插件页控制台）：策略下发的次数/最后一次/是否跨源
   window.__mpwRendererAudioPush.last     // 期望 { muted:true, posted:true, sameOrigin:false, stale:true(刷新后那一次) }
   ```
   若 `graph.masterGain` 恒 1 ⇒ 宿主策略没到（查 `__mpwRendererAudioPush`）；若 `masterGain=0` 而仍有声
   ⇒ 声源不在本页（**另一个出口**：视频壁纸元素 / NP 播放器 / 独立 WebView——本报告未覆盖）。
5. **"隐藏"这一步是本机复刻的**：§5.3 的隐藏动作由探针加 `mpw-scene-fallback` 类复刻（在线插件是加载期
   旧 bundle，见第 3 条，所以没法调它的 `sceneFallback()` 钩子）；类名/CSS 与 `lib/client.js:14595` 一致，
   实测命中 `iframe.mpw-webFrame{display:none}`。
6. **IntersectionObserver 那条路走不通（已实测否定、代码里已删）**：把 iframe `display:none` 之后，
   帧内 IO 照旧报 `isIntersecting:true`（帧内 documentElement 的交叉对象是**帧自己的视口**）
   ⇒ 能用的只有"帧自己的 rAF 停摆"（§5.3 S11 实测 `parked:true, parkReason:"raf-stall"`）。
7. **suspend 后抽头不可信**：`ctx.suspend()` 之后 `getByteTimeDomainData` 停在最后一帧缓冲（S11 那个
   0.0166 是残留值）⇒ 判"有没有声"要用 `parked/ctx/masterGain/元素 paused`（§5.3 的口径说明）。
8. **本机未覆盖的其它音频出口**：本机当前壁纸是**视频档**（`#mpw-bgVideo` 带 aac 音轨），
   实测它的静音落点是**对的**（`muted:true`，读数见发现阶段）；
   本轮没有改视频/`<audio>` 元素路径的既有逻辑，也没有验证"独立 WebView（系统壁纸服务）里的旧页面"这种
   跨进程残留（用户的 Android 现场可能存在，本机无法复刻）。
6. **`?audio=1` 的来路未定**：本机复现时是**显式**加在渲染器 URL 上（面板文案教用户这么拼）。
   用户的现场是否确实带了这个参数，本机无法证实 —— 但即使**不带**，R2 那条通道缺口对任何帧内 WebAudio
   声源都成立（网页壁纸作者脚本自己 `new AudioContext()` 也一样）。

---

## 7. 命令与汇总行

### 渲染器仓（`we-scene-demo`）

```
node tests/render-audio-leak-test.mjs      → ══ render-audio-leak-test：PASS=34 FAIL=0
node tests/audio-semantics-test.mjs        → 25/25 通过（RE-34 音频语义 + getVideoTexture）
node tests/audio-panel-test.mjs            → 全部通过：47 通过 / 0 失败
node tests/audio-band-array-test.mjs       → OK
node tests/audio-band-wiring-test.mjs      → OK
node tests/p142-nav-sound-test.mjs         → 93/93 通过（P-142 收纳 + 声音控件 + video 声音）
node tests/blob-media-retry-test.mjs       → 47 通过 / 0 失败
node tests/demo-syntax-check.mjs           → demo 内联脚本语法：11/11 通过
node tests/diag-flag-check.mjs             → 代码 183 个开关 == README 主表 183 行，0 差异（diag-flags.json 未变）
node tests/demo-check.mjs                  → 132 通过 / 0 失败
node tests/props-panel-test.mjs            → 278 通过 / 0 失败
node tests/bench-renderer-source-test.mjs  → PASS=37 FAIL=0
node tests/bench-issue0924a-line-A-test.mjs→ PASS=86 FAIL=0
node tests/display-options-test.mjs        → OK
node tests/feature-scan.mjs / parity-check.mjs / secret-scan-test.mjs / docs-check.mjs /
     cross-platform-gate-test.mjs / portability-audit-fix-test.mjs → 全部 OK
```

（全量套件在本轮改动**之前**跑过一次：`PASS=162 FAIL=3 SKIP=2`，失败项 `package-matrix` /
`bench-ui-headless` / `load-timeout` —— 与本轮改动无关的既有红灯，日志 `/tmp/full-suite-059.log`。
本轮**没有**重跑渲染器全量套件（它会与父线的 0.5.9 发布批次抢浏览器锁）；上表是按"音频面 + 宿主 API 面"
逐个挑的相关档，全绿。）

⚠ `tests/diag-flag-check.mjs` 现在报 `代码有·文档无（漏写 1 个）: pforce` —— **不是本轮的旗标**：
`pforce` 来自同工作区另一条线的 `core/we-scene-bundle.js`（C4 controlpointattract 门限口径），
本轮的静音相关**没有新增任何旗标名**（URL 通道复用已登记的 `audio`）；该档在另一条线补文档后自然转绿。

### 插件仓（`dsh-mpkg-wallpaper`）

```
node tools/np-media-test.mjs             → 结果: 117 通过, 0 失败（含 **21 组**变异自证）
node tools/wallpaper-lifecycle-test.mjs   → 结果: 186 通过, 0 失败
node tools/silent-failure-guards-test.mjs → 结果: 34 通过, 0 失败
node tools/integrity-check.mjs            → 结果: 72 通过, 0 失败
node tools/secret-scan-test.mjs           → 凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂
bash tools/check.sh                       → **全部通过 ✓（12 步全量，0 失败项）**
```

**两条"别人的判据被我的源码改动带红、已按最小改动修回"**（都发生在 `tools/` 内的变异锚点上，语义不变；
如实记在这里，因为它们是共享工作区里的真实代价）：

1. `tools/silent-failure-guards-test.mjs:307` 的变异锚点钉的是 `webFramePausedByUs = !!(shimOk || n > 0);`
   这一行的**字面量** ⇒ 我把 `park` 记账并进同一行会让它"注入点没匹配上"。改法：那一行**原样保留**，
   `park` 的记账另起一行（`if (parked) webFramePausedByUs = true;`）。
2. `tools/wallpaper-lifecycle-test.mjs:960` 的变异锚点钉的是
   `if (npCardPaused) return true;` + `return npAudioOwns();` **两行紧邻**的字面量 ⇒ 我的
   `npOwnAudible()` 口径改动 + 中间加注释都会让它失配。改法：锚点里的 `npAudioOwns()` 跟着改成
   `npOwnAudible()`（**意图不变**：把"卡片暂停"那道闸删掉 ⇒ I 组必红），并把注释挪到两行之上、保持紧邻。

### 取证探针（改前/改后成对读数，两个仓各一条）

```
# 路径 B（测试台预览）
node tests/audio-leak-graph-probe.mjs --permissive --steps=rolling,mute-ab,host-volume,policy-mute \
  --url "http://127.0.0.1:8902/webloader/?pkgpath=<语料>/dd/3719111841/scene.pkg&audio=1&shell=0"
# 路径 A（插件 + scnRender 场景帧；结束时自动复原设置）
node tools/audio-leak-frame-probe.mjs --mount-scene --policy-push --frame-play
# 路径 A 追加：被藏起来的帧（用户最新线索）——隐藏 → 停源？再把帧内探测拆掉 = 改前等价
node tools/audio-leak-frame-probe.mjs --mount-scene --policy-push --fallback
```

两条探针都**不判红**（取证工具）：读数在 stdout；`SKIP/exit=2` 表示环境不满足（:8902 不可达 / 无 WebGL /
无 Playwright），绝不把"没测到"说成"通过"。

### 文件清单（本轮新建/修改；未 commit、未 add）

  最终哈希（收口时）：`demo.html` `ac76881c…ef37dc` · `tests/render-audio-leak-test.mjs` `6685e023…e39cb2` ·
  `tests/audio-leak-graph-probe.mjs` `7d7c4317…259f66` · 插件 `lib/client.js` `87bd3703…d2275e` ·
  `tools/np-media-test.mjs` `4fd8e7f2…eb7f2f` · `tools/audio-leak-frame-probe.mjs` `c2b45193…99b6bf`。
- 渲染器：`demo.html`（**13 处音频点**：总闸/静音/park/rAF 自证/三条通道 + 5 个调用点）·
  `tests/render-audio-leak-test.mjs`（34 → **47 断言**，含 6 组变异自证）·
  **新增** `tests/audio-leak-graph-probe.mjs` · **新增** 本报告 `docs/reports-issue0924a3-audio-leak.md`
- 插件：`lib/client.js`（跨源策略通道 + park 通道 + 6 个"隐藏/切走"落点 + `npOwnAudible`）·
  `tools/np-media-test.mjs`（93 → **97 断言**，变异 18 → **21 组**）· **新增** `tools/audio-leak-frame-probe.mjs`
- **未触碰**：`demo/bench-patch.js`、`demo/index.html`、`server/**`、`docs/PATCHES.md`、`package.json`、
  `README*`（两仓）、插件的 `package.json`/`README*`、以及别人的 `web/diag-flags.json`（跑
  `diag-flag-check` 后实测**未变**：`3236f1fc…973fa` 两次运行同哈希）。

---

## 8. 追加（编排者，同日 19:5x）：**用户现场的真因是"探针把宿主档写坏了"**，以及外部判定材料

本节只补三件事，上面的机制分析**一字不改**：

1. **真因（我方事故，已处置）**：音频探针 `tools/audio-leak-frame-probe.mjs --mount-scene` 把
   "探针场景 + `webUrl…&audio=1`"写进 localStorage，插件随即把整档 **PUT 到宿主端**
   （`mpwPersistSection`"去重后写 host"）；而**探针只复原了 localStorage**
   ⇒ 宿主那份的 `__mpwHostAt` 更新 ⇒ 用户下次加载按"谁新用谁"裁决时**宿主（探针档）赢**
   ⇒ 用户的壁纸被探针场景顶掉（宿主档实测 `mpkgName="探针场景（凯尔希 4 音轨）"`、
   `sceneKey="scene|probe|…"`、`webUrl` 带 `&audio=1`；与用户 09-20 备份逐键 diff **只差 6 个源字段**
   + 后的 `npPaused/srcRoot`）。**用户那三句原话逐条对上**：画面是静态帧（"壁纸没自动播放"）+
   声音是那个场景的 4 条 BGM（"不是当前壁纸的音频"）+ 点 NP 换 src ⇒ 旧文档销毁/新文档加载
   （"才开始重新加载"）+ 静音到不了跨源帧（§2 的 R1/R2）。⇒ §6 第 6 条"`?audio=1` 的来路未定"**已定**：
   就是本探针写进去的。
   **处置**：向宿主 API PUT 回用户真档并**逐键复核**（`converted=mp4`、`mpkgKey` 回到用户那个 mpkg、
   `source=bgcs_abydos03.mp4`、`webUrl=""`、删 `sceneKey`、`image` 保持、`mute=true`、`npPaused=true`）；
   复核读数：无 `probe` 残留、`webUrl` 里无 `audio=1`。
   **防复发**：探针改为两处存储**都存档 / 都复原 / 逐键复核**，不一致判红
   （存档 `tools/audio-leak-frame-probe.mjs:222`、复原复核 `:401-418`）。
2. **真机第三方出口（别误判成壁纸）**：插件自带的音频审计（`window.__mpwAudioAudit`）在真机留下
   8 条信标，其中 **4 条 `trigger=mute-on-but-audible` 全部**指向**第三方鲸鱼挂件**的 UI 音效
   （`owner=whale-widget`、`src=/dsh-whale/sound/press.mp3?set=fx1|duck`、元素已脱离 DOM 仍在 `play`；
   该挂件 `onended` 自动续播 `release.mp3` ⇒ 一次交互两段声 = 用户 09-20 说的"响几声"）。
   **未修**（不在本仓写权内）。
3. **交给外部 AI 判定的材料**：`docs/reports-issue0924a3-audio-leak-external.md`
   —— 自包含（系统拓扑 + 全部候选机制 H1–H9 + 真机信标 + 已推翻项 + 判别实验清单 + 未验证边界）。

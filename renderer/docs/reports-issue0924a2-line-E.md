# issue #0924a2 · E 线（`:8902` 测试台 UI 第二轮：用户复测后重做的 4 条）实现报告

- 仓库：`we-scene-demo`（GPL-3.0-or-later）；本报告 = `docs/reports-issue0924a2-line-E.md`
- 线别：E 线 = 测试台 UI（`demo/index.html` 静态外壳 + `demo/bench-patch.js` 运行期补丁 + `demo/now-playing/**` 组件）
- 本轮改动的文件（**全部**在写权范围内）：
  - `demo/bench-patch.js`（① 输出面板滚动守卫 · ② 图片强制去重 + 台账提示 · ③ 音量控件接线/探针 · ⑦ 换档不凭空挂壁纸 · 词典 4 条文案）
  - `demo/index.html`（③ 撤掉卡片下面那条独立 `#np-volbar`／`#np-volnum`／`--mpw-np-vol`，`--mpw-np-cover` 回到 `card + strip`）
  - `demo/now-playing/NowPlaying.tsx`、`demo/now-playing/now-playing.css`、`demo/now-playing/icons.tsx`、
    **重建** `demo/now-playing/dist/now-playing.js`（③ 音量轨进卡片内部 + 静音第四键）
  - `tests/bench-issue0924a-line-A-test.mjs`（64 → **86** 断言：②③⑦ 的新判据 + ① 的新滚动契约）
  - `tests/bench-ia-group.mjs`（IA5c–IA5g / IA10 / IA11 共 **16** 条新浏览器判据 + 5 条按新契约更新）
  - `tests/bench-dsh-libroot-test.mjs`（A9/A9a/A9b、B5/B5b/B5b1/B5b2、B7/B7b/B7a **按新契约显式更新**）
  - `tests/bench-props-text-test.mjs`（5o/5p 契约翻转 + 5y/5za/D3/D4/D5 更新 + 4 组变异体重排）
  - `tests/p142-nav-sound-test.mjs`（A12/A28/B13–B21/C5/C10/E1 几何契约更新 + 新增 C5b）
  - `tests/bench-ui-headless-test.mjs`（P5c 两来源口径更新 + T5b/T5c 新增 + T 组夹具按新契约打开卡片）
- 未触碰：`core/**`、`demo.html`、`server/we-scene-demo-server.mjs`、`server/we-scene-demo-server-8902.mjs`（**这轮一条都没改**）、
  `package.json`、`README*`、`docs/PATCHES.md`、`docs/reports-issue0924a-line-A.md`、`docs/reports-issue0924a-line-B.md`、插件仓。
  没有 `git add -A`、没有 commit、没有 push。

---

## 0 结论（先说要紧的）

**用户点名的 4 条全部落地**，每条都有"源码级根因（file:line，含 minified 产物里的确切位置）+ `__benchPatch` 探针 + 改前/改后成对读数"。
**9 项验收命令里 8 项全绿**；`secret-scan-test` 是**在我这轮之前就红**的（红在另外两条线上一轮的报告文件第 3 行，
见 §4.1，修它要动别的线的文件 = 不在我的写权范围，我没有碰）。

一句话根因/改法（详见 §1）：

| # | 用户原话要点 | 真根因（一行） | 改法（一行） |
|---|---|---|---|
| ① | "我鼠标滚轮滑到哪里，它就停到哪里" | `#logbody` 有**两个写入者**：产物自己的 `X.appendChild(a),X.scrollTop=X.scrollHeight`（minified，挂 `/api/diag-stream`）**无条件跳底**；上一轮只改了补丁那一条 | 在 `#logbody` 上装**影子 `scrollTop`** + 追加钩子：非用户意图的"追加后跳底"直接丢弃并计数；容差 24px → **2px** |
| ② | "强制只显示一次""把链接也去掉" | 面板里的图有**两个来源**，旧账本只去了一个：产物 `.prop-media > img`（真机同一张画面 33 遍）**完全不进账**；变体（重传/换参数）旧规则要"尺寸完全相同"才归并 | 改成**按 DOM 顺序扫一遍全部 `<img>`（两来源共用一本账）** + 身份键相等**无条件归并**；空壳/重复链接一并藏掉；面板末尾写台账提示 |
| ③ | "把音量的按钮集成到 NP 的卡片里面" | 上一轮做成了卡片**下面**一条独立 `#np-volbar`（不是"卡片里面"） | 组件自己在卡片**内部**画音量轨（时钟行中间，与 DSH 插件 `showVolume = late > 0` 同构）+ 传输行**静音第四键**；独立那条整块撤掉 |
| ⑦ | "切渲染器会突然加载出来壁纸" | 产物的"当前项"是它模块作用域的 `w`：`Ae(){if(!w)return;…k.src=…}` 读它重挂载，而产物自己的「释放」`E()?.release()` **只释放舞台、不动 `w`** | 借产物自己的清空入口 `ht()` 把 `w` 清成 null（`window` 桥跨作用域）+ 换档前先判"是不是真的没选"，没选就一个字都不写 |

---

## 1 逐条：现象 → 根因 → 改法 → 判据 → 改前/改后读数 → 未验证边界

### ① 输出面板："我滚到哪就停在哪"（新消息不许改变 `scrollTop`）

**现象（用户复测原话）**：
> 「我说的输出里面输出新消息的时候，不要把我默认跳到最新的消息的地方，这个还是没有实现。下面如果有新消息，还是会把我往下面跳。我需要的是**我鼠标滚轮滑到哪里，它就停到哪里**……而不是出现一条新消息就往最下面跳。」

**真根因（机制证据，不是推测）**：`#logbody` 有**两个写入者**。
1. 本补丁的 `logLine()`（上一轮已改成"贴底才跟随"）；
2. **产物自己**那条日志函数：`demo/assets/bench-DSKWIqmS.js`（单行 minified，偏移 **87276**）里
   `X.appendChild(a),X.scrollTop=X.scrollHeight` —— 它挂在产物自己的 `/api/diag-stream`（EventSource）上，
   **每一行都无条件跳到最底**。渲染器挂载/诊断日志全走这条路 ⇒ 上一轮只改 (1)，用户看到的"还是会往下跳"就是 (2)。
   改前真机读数（`POST /diag` 走**真实路径**：服务端 SSE → 产物 `b()` → `#logbody`）：
   `scrollTop 0 → 2955`（slack 2459 → 0），行数 131 → 156。

**改法**（`demo/bench-patch.js`）
- `:5792` `LOG_STICK_PX = 2`（**从 24px 收紧**：24px 容差内仍会把用户往下拽）；
  `:5798` `LOG_AUTO_WRITE_MS = 50`（"追加完紧接着的那一下跳到底"才算自动跟随）；
- `:5800`–`:5945` `makeScrollKeeper()`：在容器实例上 `Object.defineProperty(el,'scrollTop',…)` 装**影子访问器**
  （只有本补丁自己的写与"用户意图"的写能落到原生 setter；追加后同一拍内的跳底 ⇒ `dropped-auto-bottom` **丢弃并计数**），
  外加影子 `appendChild`（记追加序号/时刻，并给 ⑦ 留一个"这一行要不要写进去"的过滤器）；
  手势（wheel/mousedown/touch/keydown）+ `scroll` 事件判定"位置归谁"；
- `:5946` `logKeeper()` / `:5969` `logScrollGuardSet(on)`（**A/B 用**，关掉守卫必须留住这个状态，否则探针下一次读数就把它装回来 —— 真机踩过）
  / `:5986` `logScrollProbe()`；`:5990` `logLine()` 追加后走 `k.followNow()`；
- 同一条口径也套到 `#diag-body`（`:6040`）与 `#dbg-log`（`:6022`/`:6119`）；
- 清空输出时跟随复位（`resetFollow()`，`:8830` 一带）：不然"清空那一刻的不跟随"会一直留着。

**判据**：`A16a`–`A16f`（纯 Node，含"产物那条无条件写"的**根因证据**）、`IA5a`/`IA5b`、**`IA5c`–`IA5g`**（浏览器真路径 + A/B）。

**改前 → 改后（成对，同一把尺子）**

| 读数 | 改前 | 改后 |
|---|---|---|
| 用户在顶部（`scrollTop=0`, slack 5508）→ `POST /diag` 来新行 | `top 5526`、slack **0**（被拽到底） | `top 0`、slack **5712**（一个像素没动），`droppedWrites +1`、`lastReason='dropped-auto-bottom'` |
| 同一条路径，守卫关掉（= 改前行为，`logScrollGuardSet(false)`） | —— | 复刻产物那一拍 ⇒ `slack 3725 → 0`（**当场复现那一跳**，证明判据不恒真） |
| 用户自己滚回底部后 | —— | 继续跟随（`slack 0`，`lastReason='scroll-bottom'`） |
| `logScrollState().stickThreshold` | `24` | `2` |

**未验证边界（如实写）**：
- 影子只挡**通过 `scrollTop` 属性**的写。如果哪天有代码用 `innerHTML`/`replaceChildren` 整块重写 `#logbody` 的**内容**，
  浏览器会把 `scrollTop` 复位 ⇒ 那种路径不在守卫里（当前产物只有 `X.appendChild` 与 `X.textContent=''`（清空），
  两者都被覆盖或无害）。`A16c` 把"产物那一行的确切写法"钉成根因证据：**上游一变，这条判据会红，提醒重估**。
- 贴底容差固定 2px；设备像素比极大时的亚像素取整未单独实测（本机 DPR=1/2 下都落在 2px 内）。

### ② 壁纸配置："重复的图片强制只显示一次 + 把链接也去掉"

**现象（用户复测原话）**：
> 「我说的壁纸配置里面重复的图片只显示一次，你把它**强制**成为只显示一次的，你现在还是没有弄好，现在还是有重复的图片。（我之前让你把没显示出来图片的链接显示出来，然而那个链接其实已经显示出来过一遍了，再显示一次是重复的，所以说不用再把那个链接展示出来了，**把链接也去掉**）」

**真根因（两条，都是真机读数）**
1. **面板里的图有两个来源，旧账本只去了一个**：
   ① 产物自己渲染的 `div.prop-media > img`（`demo/assets/bench-DSKWIqmS.js` 的 `St()`：按渲染器解析出的 media 列表建 `<img>`，
   可带 `<a href>` 包裹）；② 本补丁从**属性文案** tokenize 出来的 `img.bench-prop-img`。
   改前真机读数（`/allwallpaper/dd/3660962877`）：**同一张画面 `ours 6 + media 38 = 44 张`全部可见**，
   而旧账本 `report.images` 只数我们的 token（38）⇒ 界面一直"显示去重成功"。
2. **变体不归并**：同一张画面的不同参数/尺寸/重传（`?w=`、`_1600x1200`、`http`↔`https`/`www.`）旧规则要
   "两张都 load 成功且 `naturalWidth/Height` 完全相同"才归并 ⇒ 尺寸不同或拿不到证据（远程图被墙/无网）就画两张。

**改法**（`demo/bench-patch.js`）
- 规则层 `richImageKey()`（`:1508` 一带）：处理类参数白名单**扩容**（`w/h/width/height/quality/format/resize/…`）+
  文件名尺寸标记（`_800x600`、`-thumb`、`!800x600`）+ 协议归一（`http`↔`https`）+ `www.` 前缀；
  **无名段/图片 id 段仍然逐字节保留**（反例护栏不变）。
- 账本 `makeRichImagePass()`（`:1582`）：`once` 档下**身份键相等 ⇒ 无条件归并**（`reason:'variant-key-equal'`）；
  尺寸证据降级为**只进台账**（`report().variants.evidence = {equal,different,unknown}` + 逐条明细）。
- DOM 层：`:4695` **`sweepPanelImages()`** —— 按 **DOM 顺序**扫面板里**全部** `<img>`（两个来源一起算），
  每张画面只留第一份，其余藏掉（`data-bench-img-dup="1"`）；**幂等**（先把上一趟藏掉的恢复、再重算），
  账本每次**从 DOM 重建**（`:4695` 内 `newRichImagePassFor(richImageMode(), …)`）⇒ 台账永远 == DOM。
  这一步是被真机逼出来的：产物会**局部重画**面板，早期"边渲染边判"的写法会出现
  "留第一份的节点随旧行消失、其余副本又被当重复藏掉 ⇒ 面板一张图都没有"（`bench-ui-headless` P5c 抓到的 `imgs: [] / dupSuppressed: 13`）。
  隐藏行**不参与**账本（`rowVisible()`，`:4677`），且隐藏判定排在图片账**之前**（`:5115` 一带）。
- 链接：目标就是"已画成图的那张画面"的链接 ⇒ 藏掉（`data-bench-link-dup`）；
  图片被压掉后**锚内没有别的可见内容** ⇒ 整条空壳链接也不画（`data-bench-link-empty`）——
  这就是"把链接也去掉"（改前那条"图没显示出来就把它的链接显示出来"的兜底删除）。
- 台账提示行 `:5031` `paintImgDedupNote()`：面板末尾一行
  「已压掉 N 张重复图（其中 M 张是靠「同一张画面」的身份键**强制归并**的：尺寸不同 x 张 / 尺寸未知 y 张）」；
  词典新增 `props.imgDedupForcedNote`（中英各一份），并把 `props.imgDedupTip` 里
  "候选要两张都载入成功且原始宽高完全相同才归并"那条**旧说法删掉**（文案与实现同源，`A3m` 钉住）。

**判据**：`A3g`–`A3n`（纯 Node，含强制定量/台账/两来源/空壳链接/探针字段）、`5o`/`5p`（契约翻转）、`5y`/`5za`/`D3`/`D4`/`D5`、
`B7`/`B7b`/`B7a`（真语料 + 对照档）、`P5c`（两来源口径）。

**改前 → 改后（成对读数）**

| 包 | 口径 | 改前 | 改后 |
|---|---|---|---|
| `dd/3660962877` | 面板里可见的 `<img>` | **44**（ours 6 + media 38，`hidden 0`；同一张画面 33 遍） | **6**（每个身份一条；`hiddenDup 70`，`ours 0`/`media 6`） |
| `dd/3326873240` | 同上 | 19 全可见 | **6**（`hiddenDup 20`） |
| `dd/3544152633` | 同上 | 11 全可见 | **4**（`hiddenDup 10`） |
| 账本不变式 | `rendered == groups.length` | 6 == 6（但只数我们的 token，媒体那份**不在账上**） | 6 == 6（**两个来源都在账上**：`report.images 76 = rendered 6 + dup 70`） |
| `?propimg=all` 对照档 | 同一张壁纸 | 26 全可见 | **26**（不变 —— 对照档仍然是"完全不去重"，证明 `once` 的绿灯不是恒绿） |
| 夹具 `variantfix/variantdup`（同一张画面的 4 种 URL 形态 + 另一张图 + 一条同 URL 链接） | 可见 `<img>` / 强制定量 | **10 张可见**（同一张画面 **8 遍**）；`links 0`，无台账提示 | **2 张可见**；`variants.merged 6`、`evidence.unknown 6`、`linksHiddenDup 1`；面板提示原文：`8 duplicate image(s) suppressed (6 of them were **force-merged** by picture identity: 0 with a different size, 6 with unknown size …)` |

**未验证边界（如实写）**
- 现场能拿到的真语料里，重复都是**逐字节相同 URL**（`dupExact == dupKey`）⇒ 真语料上"强制归并"这一档计数为 **0**；
  "只差参数/尺寸/重传"这一档用**夹具库**验的（`tools` 之外临时造的两张 project.json，见上表最后一行），
  且因为离线拿不到远程图，台账里的证据是 `unknown` 而**不是** `different`。
  "尺寸确实不同也照样归并"这一支只有**纯函数判据**（`A3g`/`5o`，用注入尺寸证据）覆盖 —— 不拿它冒充真机读数。
- 身份键的放宽是**有意**的：两幅真正不同的画如果只差 `?w=`/`_800x600` 会被归并成一张。反例护栏（`m.qpic.cn/psc` 一个 path 下 4 张真图）
  在 `5c`/`5r`/`C9` 上继续全绿；但"作者故意用两张只差尺寸参数的**不同**图"这种极端语料本地没有，未实测。

### ③ 音量控件进 NP 卡片内部

**现象（用户复测原话）**：
> 「我说的把音量的按钮集成到 NP 的卡片里面，你还是没有做好」

**真根因**：上一轮的落点是卡片**下面**那条独立的 `#np-volbar`（`#np-host` 的第 2 个子节点，夹在卡片与传输条之间）——
它在"壁纸配置"这一栏里、在 NP 块里，但**不在卡片内部**。真机读数（改前）：卡片 `.snd-box` = `top 693 / bottom 771`，
滑条 `top 838 / bottom 842`、宽 96px ⇒ **`inCard=false`**。

**改法**（照下游 DSH 插件 `dsh-mpkg-wallpaper/lib/now-playing.js` 的同一套做法）
- `demo/now-playing/NowPlaying.tsx:563` `const showVolume = controlled && late > 0`（与插件逐字同款：**受控档 + 卡片展开**才存在）；
  `:724`–`:745` 音量轨 = `.snd-clock` 行中间那个 `<input id="np-volume" data-mpw-np-vol-range>`（左时刻 / 音量 / 百分数 / 右剩余）；
  `:881` 传输行**第四键** `<button class="snd-op" data-mpw-np-mute>`（点它静音/取消静音，图标 `Volume2`/`VolumeX`）。
- 组件 CSS 只给**既有类 + 属性选择器**（`demo/now-playing/now-playing.css` 的
  `.snd-clock input[type="range"][data-mpw-np-vol-range]` / `.snd-clock [data-mpw-np-volnum]`）：
  **不新增 `.snd-*` 类** ⇒ 组件那条"CSS 类名与渲染出来的 DOM 一一对应"判据在**装饰档** SSR 上仍然成立
  （音量行只在受控档展开时存在，`now-playing-test` **一行没改**，219/0 继续全绿）；`icons.tsx` 补 `Volume2`/`VolumeX` 兜底图标（两条 build 路都能 build）。
- `demo/index.html:288`：撤掉 `#np-volbar` / `#np-volnum` / `#np-volcap` 与 `--mpw-np-vol`，
  `--mpw-np-cover: calc(var(--mpw-np-card) + var(--mpw-np-strip))`（音量行在卡片内部，**不额外占高**）；
  补丁表逐字同款，并放行音量轨的 `pointer-events`。
- `demo/bench-patch.js:2910` `applyAudio()`：**不再直接写滑条**（React 受控；直接写会被下一次 render 覆盖），
  改成 `pumpNp()` 把 `data.volume` 推给组件；滑条自己的 `onChange` → `send('volume')` → `npTransport('volume')` ⇒ 一个环、一个真源。
- 探针 `:3308`–`:3360`：`volumeInCard / volumeInCardX / volumeOverflow / volumeInStrip / stripHasVolume / muteInCard / volKeyPresent`
  （`volumeInNpBar` 随那条独立行一起删除）；`:2893` `volumeSlider()` / `muteKey()` 两个读数出口。

**判据**：`A2a`–`A2j`（纯 Node，含"那条独立条整块撤掉""唯一渲染者是组件""dist 已重建"）、
`IA10a`–`IA10e`、`B5`/`B5b`/`B5b1`/`B5b2`（三种宽度 + 200px 窄容器 + **撑到 400px 的对照**）、
`T5b`/`T5c`（真媒体上拖它/点静音）、`A9`/`A9a`/`A9b`、`A12`/`B13`–`B21`/`C5`/`C5b`/`C10`/`E1`（p142 几何契约）。

**改前 → 改后（成对读数）**

| 读数（`npGeometry()`，卡片展开态） | 改前 | 改后 |
|---|---|---|
| `#np-volbar` / `#np-volnum` 是否存在 | `true` / `true` | **`false` / `false`** |
| 滑条矩形 vs 卡片矩形 | 卡 693–771、滑条 838–842（**下方 67px**）⇒ `volumeInCard=false` | 卡 663–852、滑条 770–774（**卡片内部**）⇒ `volumeInCard=true`、`volumeInCardX=true`、`volumeOverflow=false` |
| 静音第四键在卡片里 | 不存在 | `muteInCard=true`、`volKeyPresent=true` |
| `volumeInStrip` / `stripHasVolume` | `false` / `false` | `false` / `false`（第 2 条的要求继续成立） |
| 1280 / 390 / 320 三种视口 | `overflow=false`（传输条） | `overflow=false` **且** `volumeInCard=true`（三种都量到，滑条宽 166px） |
| 对照（把滑条强行撑到 400px，同一入口） | —— | `volumeOverflow=true`、`sliderW=400`（**判据有分辨力**）；撤掉立刻回 `false` |
| 收起态（胶囊） | 滑条是页面元素、常在 | 组件**不渲染**它（`hasVolume=false`）⇒ 胶囊几何一个像素不多 |
| 真媒体上拖它（`bench-ui-headless` T5b/T5c） | 旧入口是页面上的 `<input>` | 拖到 0.35 ⇒ `video.volume=0.35`（走组件 `onChange` 那条链）；静音第四键 ⇒ `muted=true` 且音量值保住 0.35 |
| p142 遮挡模型（假 DOM） | `cover`: 收起 190 / 展开 **245**；展开被遮挡项 **5** | 收起 **164** / 展开 **219**（= `card + strip`）；展开被遮挡项 **4** |
| 补丁表里的 `#np-volume{…}` 规则 | `flex:1 1 48px;…`（页面上那个 input） | **一条都没有**（元素归组件，样式归组件 CSS —— 有规则没人穿就是孤儿规则） |

**未验证边界（如实写）**
- 窄到 200px 的「壁纸配置」栏下，**卡片自身**（组件固定 260px 宽）会横向溢出面板 —— 这是**改动前就存在**的
  （旧实现里卡片也是 260px，只是那时判据量的是能缩到 200px 的 `#np-volbar`，不是卡片）。
  本轮判据量的是"滑条 vs 卡片"：`volumeInCard=true` / `volumeOverflow=false` / 滑条仍有 166px 实际宽度（真机读数在报告 §2）。
- 没有媒体时（未挂载/无音源）滑条与第四键按 `data.canVolume` **明确置灰**（`disabled`，不假装可点）——IA10d 读到
  `disabled=true`；**能用**的那条路由 T5b/T5c（web 档、带 `<video>`）覆盖。
- 键盘可达性（range 的原生键盘行为）未单独实测；滑块 `step=0.05`，写 `0.31` 会被浏览器吸附到 `0.30`（真机踩到，测试里改成 0.35）。

### ⑦ 切渲染器档不再凭空加载"最后挂载过的那张壁纸"

**现象（用户原话）**：
> 「渲染器使用我的渲染器的时候（这时候我已经把上面选过的所有壁纸都叉掉了，是未选择壁纸的状态）我把渲染器切成上游产物，它就加载了一个我最后加载的一个壁纸……而且他这个新窗口还不能叉掉，包括下面的渲染器诊断也没有多少他的内容，只有24条。这个 bug 你修一下，为什么切渲染器会突然加载出来壁纸。」

**真根因（minified 产物三处，逐处给位置）**：产物的"当前壁纸"是它模块作用域里的 `w` ——
- `demo/assets/bench-DSKWIqmS.js`（单行 minified）偏移 **94129** `function Ue(e){w=e,…}` 写它；
- 偏移 **94186** `function Ae(){if(!w)return;…k.src='/wallpaper-engine-webgl/renderer/index.html?…'}` 读它**重挂载**；
- 偏移 **88075** `function ht(){w=null,…}` 是**唯一**会清它的入口；
- 而产物自己的「释放」是偏移 **95493** `l("#release").onclick=()=>E()?.release()` —— **只释放舞台，不动 `w`**。

⇒ 用户叉掉壁纸之后（补丁的关闭链也点了 `#release`），`w` 仍指着最后挂载的那张；切档会点产物的「重挂载」(`#reload` → `Ae()`)
⇒ `if(!w)` 判真 ⇒ **又挂回来**。**改前真机读数**：`#frame.src` 从 `about:blank` 变回
`…/renderer/index.html?…&src=2887099508…`，`#current` 从"未选择壁纸"变回那张壁纸的**标题**，`#empty` 又被藏起来，
预览里出现 `canvas 529×297`；「新窗口」(`#open` = `w && window.open(…)`) 也打开同一张。

**改法**（`demo/bench-patch.js`）
- `:8292` `clearArtifactSelection()`：借**产物自己的**清理入口（`#pick-lib` 原处理器链里的 `ut()` → `ht()`，A5「换库后重画侧栏」已经在用同一条链）
  把 `w` 清成 null；一次性 fetch 垫片把"开原生对话框"那一问就地答掉；清完**不复原**任何壁纸（目标就是"未选择"态）。
  **跨作用域走显式 `window.__benchClearArtifactSelection` 桥**（关闭链在模块级 `initSiteShell()` 里，够不着 `init()` 内部的函数 ——
  裸引用会被 `try/catch` 吞掉，第一版实现就是这么"看起来改了但没生效"的，本轮真机踩到后改了）；
- `:9991` `nothingSelectedNow()`：**唯一判据** = 列表无 `.active` + 外壳 `curId` 空 + `#frame` 无 src **或**停在 `about:blank`
  （`about:blank` 也算"没挂" —— 释放链会把 iframe 导航到那里，只判空串会漏）；
- `:10005` `remountRendererForBandFeed()`：没选壁纸 ⇒ **一次都不点**产物的「重挂载」（从源头不触发）；
- `:10132` 换档回调：空选择时**不写任何 URL、不谎报"已按新档位重写"**，改写真话
  `log.rendererSrcEmpty`（中英各一份）：「只切档位、预览保持空态、不挂载任何壁纸，档位下次挂载生效」。
- 探针：`artifactClearProbe()`（`ran/cleared/srcBefore/srcAfter/curAfter/emptyShown`）+ `nothingSelected()`。

**判据**：`A21a`–`A21e`（纯 Node，含三处 minified 根因证据 + 跨作用域桥 + 新文案中英）、`IA11a`–`IA11f`（浏览器端到端）。

**改前 → 改后（成对读数，同一操作序列：选一张 → 叉空 → 切「上游产物」）**

| 读数 | 改前 | 改后 |
|---|---|---|
| 叉空之后 `artifactClearProbe()` | 不存在（`w` 没清） | `{ran:true, cleared:true, srcBefore:'about:blank', srcAfter:'', curAfter:'未选择壁纸', emptyShown:true}` |
| 切档后 `#frame.src` | `…/renderer/index.html?…&src=<最后那张>&bandfeed=auto`（**又挂回来**） | `''`（**保持空**） |
| 切档后 `#current` / `.active` / `#empty` | 变回标题 / `1` / `none`（看起来"又选中了"） | 仍是"未选择壁纸" / `0` / 可见 |
| 切档后预览里的 canvas | `1`（真的在渲染） | `0`（`about:blank`） |
| 产物自己的「重挂载」按钮 | 再挂一次那张 | 什么都不做（`w` 已 null） |
| 「新窗口」 | 打开 `…&src=<最后那张>…` | **什么都不打开**（`opened: []`） |
| 守卫不误伤 | —— | 切回本仓档再选一张 ⇒ `#frame` 有 src、`.active=1`、预览正常 |

**同源排查：三件事不是同一个根因**（按用户要求给读数）
- **"新窗口不能叉掉"**：我这里的读数是两条独立的事：① 上面那条"凭空挂回来"（已修）；
  ② 预览里出现了壁纸而标签栏是"未选择"⇒ 补丁那个 `×`（只在 `curId` + `.active` 同时存在时才画）**没有落点**，
  所以用户"叉不掉"它。修完 ①（`w` 清空、档位不再挂载）之后 ② 不再出现（IA11c/IA11d 读数：`#frame` 无 src、0 个 `.active`）。
  「新窗口」这一下现在在未选择态**什么都不打开**（IA11e）。
- **"渲染器诊断只有 24 条"**：**不是我们截断**。面板环形上限 400 行，`#diag-body[data-count]` 就是真实条数；
  服务端 `/api/diag-stream` 在**新连接时回放最近 50 条**（`diagBuffer.slice(-50)`，环形缓冲 200）。
  同一会话实测：**上游产物档 50 条**（`dataCount=50`，正好是回放上限）/ **本仓档 80–104 条** ——
  也就是"上游产物这一档本来就报得少"，用户看到的 24 条是那一刻缓冲里真有那么多。
  本轮**没有改**服务端回放条数（改它会把每次开页的诊断一次灌进输出区，见 §4 的取舍说明）。

---

## 2 我跑过的命令与最终汇总行（全部重跑于最后一版代码）

| # | 命令 | 结果 |
|---|------|------|
| 1 | `node tests/demo-syntax-check.mjs` | ✅ `demo 内联脚本语法：11/11 通过` |
| 2 | `node tests/demo-check.mjs` | ✅ `demo-check: 132 通过 / 0 失败` |
| 3 | `node tests/docs-check.mjs` | ✅ `检查 17 个文档 · 794 个文件引用 · P-编号健康 ✓ · diag-flags ✓` |
| 4 | `node tests/secret-scan-test.mjs` | ❌ `本机绝对路径 2 处`（**改前就红**，红在另外两条线的报告文件，见 §4.1；我的改动文件 0 命中） |
| 5 | `node tests/bench-issue0924a-line-A-test.mjs` | ✅ `PASS=86 FAIL=0`（64 → 86） |
| 6 | `node tests/bench-props-text-test.mjs` | ✅ `48 通过 / 0 失败`（含 5 组纯函数变异 + 5 组源码级变异） |
| 7 | `node tests/p142-nav-sound-test.mjs` | ✅ `93/93 通过`（A 静态 28 / B-C 假 DOM 45 / E 读数 1 / D 变异 19） |
| 8 | `node tests/now-playing-test.mjs` | ✅ `219 通过 / 0 失败`（**本文件一行没改**） |
| 9 | `flock /tmp/.mpw-firefox.lock -c 'node tests/bench-ui-headless-test.mjs'` | ✅ `PASS=192 FAIL=0`（174 → 192） |
| 10 | `flock /tmp/.mpw-firefox.lock -c 'node tests/bench-dsh-libroot-test.mjs --no-mutant'` | ✅ `PASS=69 FAIL=0` |
| 11 | `flock /tmp/.mpw-firefox.lock -c 'node tests/bench-issue0924a-ia-browser-test.mjs'` | ✅ `PASS=39 FAIL=0`（23 → 39） |

**回归自查**（我改动容易波及、但不在验收清单里的既有门禁，也一并跑了）：

| 命令 | 结果 |
|---|---|
| `node tests/bench-shell-fixes-test.mjs` | ✅ `PASS=277 FAIL=0` |
| `node tests/bench-bandfeed-switch-test.mjs` | ✅ `ALL PASS（55 项）` |
| `node tests/bench-mpkg-items-test.mjs` | ✅ `{"pass":54,"failed":[]}` |
| `node tests/bench-server-test.mjs` | ✅ `全绿` |
| `node tests/bench-dropdown-theme-test.mjs` | ✅ 通过 |
| `flock … 'node tests/bench-renderer-source-test.mjs'` | ✅ `PASS=37 FAIL=0`（**换档那条回调我改过**，所以专门跑了它） |

### 2.1 关键浏览器档原始读数（改后）

- **① 滚动**：`IA5c`（真路径）：`before {top 0, slack 3595} → after {top 0, slack 3613, droppedWrites 0→1, lastReason 'dropped-auto-bottom'}`；
  `IA5b`：`slack 0 / atBottom true`；`IA5f`（守卫关）：`offBefore slack 3725 → offAfter slack 0`；`IA5g`（再开）：`top 仍是 0`。
- **② 图片**：`B7`：`once = {rendered 6, ours 0, media 6, hiddenDup 20, dupSkipped 20, groups 6}`；
  `B7a`：`all = {rendered 26, hiddenDup 0}`（对照档更大 ⇒ 成对）；`B7b`：`media + ours == rendered`。
- **③ 音量**：`IA10`：`{volumeVisible true, volumeInCard true, volumeInCardX true, volumeOverflow false, muteInCard true, volKeyPresent true, volumeInStrip false, stripHasVolume false}`，
  滑条 `x 365.6–532.1`（在卡 `330–590` 里）、`#np-volbar` 不存在、收起态 `hasVolume false`；
  `B5`：1280/390/320 三档都 `volumeInCard true / overflow false / sliderW 166`；`B5b`：强撑 400px ⇒ `volumeOverflow true`；
  `T5b/T5c`：拖到 0.35 ⇒ `video.volume 0.35`；静音键 ⇒ `muted true / volKept 0.35`。
- **⑦ 换档**：`IA11`：`afterClose {src '', active 0, clear.cleared true}` → `afterSwitch {src '', cur 未选择壁纸, canvas 0}` →
  `afterArtifactReload {src '', active 0}` → `opened []` → `afterReselect {src '/webloader/?…', active 1}`。
- **⑦ 诊断条数**：同一会话 `onUpstream {lines 50, dataCount '50'}` / `onRepo {lines 80, dataCount '80'}`。

---

## 3 契约变更台账（**显式**更新判据 + 理由，没有为绿放宽语义）

| 判据 | 旧契约 | 新契约 | 为什么必须改（语义理由） |
|---|---|---|---|
| `bench-props-text` **5o** | "尺寸不同 ⇒ **一定不归并**"（真阴性） | "尺寸不同 ⇒ **仍然只画一遍**，台账写 `different`" | 用户第 2 条要"**强制**只显示一次"；旧规则正是他复测看到的重复来源（同一张画面的重传尺寸就是不同） |
| `bench-props-text` **5p** | "证据缺失 ⇒ 不归并（保守）" | "证据缺失 ⇒ **仍然只画一遍**，台账写 `unknown`" | 同上；远程图在无网/被墙时**永远**拿不到尺寸 |
| `bench-props-text` **5y/5za/D3** | 盯"变体探针藏起来 + 超时兜底" | 盯"sweep 一次 DOM 顺序扫 + 账本从 DOM 重建 + 两个来源合并" | 探针机制整块删除（强制档不需要证据）；且真机证明"边渲染边判"会在产物**局部重画**时与 DOM 失配 |
| `bench-props-text` **D4/D5 变异体** | M1"去掉尺寸护栏"= 变异；S3 盯探针 | M1 换成"只按逐字节 URL 归并"、M5"只按 host 归并"；S3 盯 `sweepPanelImages()` **调用点** | 旧 M1 现在**就是实现**，不再是变异；期望红集按新 claim 重算（逐条打印，期望 == 实际） |
| `bench-dsh-libroot` **A9/A9b** | 盯补丁表里 `#np-volume{flex:1 1 48px…}` | 盯**组件 CSS** 那条 `flex:1 1 auto;min-width:0` + 传输条仍可压 + 补丁表里**不再有**任何 `#np-volume{…}` | 元素搬家了：页面里没有它 ⇒ 补丁里留形状规则就是孤儿规则（判据反而更严） |
| `bench-dsh-libroot` **B5/B5a** | 注入旧固定宽规则复现"传输条溢出" | 传输条三档 `overflow=false` + 卡片滑条三档 `volumeInCard=true`；对照换成"把滑条撑到 400px ⇒ `volumeOverflow=true`" | 滑条不在传输条里了，量它等于量一条不存在的路径；对照仍证明判据有分辨力 |
| `bench-dsh-libroot` **B5b/B5b1/B5b2** | "音量条挂在 `#np-volbar`（`volbar.top ≥ card.bottom`）" | "音量控件在**卡片内部**（`volumeInCard/volumeInCardX/muteInCard`）、`volumeOverflow=false`、传输条里没有它" | 用户第 3 条的落点换了：判据跟着换成"卡内几何"（口径更严：还要求第四键也在卡里） |
| `bench-dsh-libroot` **B7/B7a** | `rendered == 唯一 URL 数`（只数我们的 token） | `rendered == 身份组数`（**两个来源一起数**）+ 新增 B7b（`media + ours == rendered` 且 `hiddenDup > 0`） | 旧口径漏了产物那份（真机 44 张），新口径才对应"面板上真的画出几张" |
| `p142` **A12/A28/B13–B21/C5/C10/E1** | 卡片下面有 26px 音量条（cover = card+vol+strip = 245；A28 名单含 `np-volume`；C5 驱动页面滑条） | 无 `--mpw-np-vol`（cover = card+strip = 219；A28 名单去掉 `np-volume`；C5 驱动**落点** `setVideoVolume`，C5b 断言页面里没有滑条） | ③ 把那条独立行撤了；页面元素不再存在 ⇒ 夹具/模型/期望值同步（数字差正是那 26px 与它多吃的一项） |
| `bench-ui-headless` **P5c** | 只数 `.bench-prop-img` | 数**两个来源**的可见图（+ 记录被压掉的重复张数） | ② 之后"第一份"往往落在产物的 `.prop-media` 上；只数我们那份会假红 |
| `bench-ui-headless` **IA5b** | 贴底容差 `≤24px` | `≤2px` | 24px 内仍会把用户往下拽（用户要的是"停在哪就是哪"） |

**新增判据**（不是改旧）：`A16a`–`A16f`、`A3g`–`A3n`、`A2a`–`A2j`、`A21a`–`A21e`、
`IA5c`–`IA5g`、`IA10a`–`IA10e`、`IA11a`–`IA11f`、`B7b`、`T5b`/`T5c`、`C5b`。

---

## 4 未验证项 / 风险（如实说，不藏）

### 4.1 `secret-scan-test` 是**改前就红**的（不在我的写权范围）
```
✗ 本机绝对路径 2 处：
  ✗ docs/reports-issue0924a-line-A.md:3 [本机工作区绝对路径]
  ✗ docs/reports-issue0924a-line-B.md:3 [本机工作区绝对路径]
```
两份文件是**上一轮 A/B 线的交付报告**，被 `a3bb009` 提交进 tracked（本轮之前就是 tracked 状态），第 3 行那句"仓库：<本机绝对路径>"
撞上 `tests/secret-scan-test.mjs` 的 B 段门禁。**与我这轮的改动无关**（我改动的 12 个文件里 0 命中；我自己的报告刻意不写本机绝对路径）。
我没有去改那两份文件（属于别的线的交付物 + 不在写权范围）。
**最小修法**（供编排者）：把那两行的工作区路径换成相对/占位写法（例如"仓库：`we-scene-demo`（工作区根下的同名目录）"），
改完 `node tests/secret-scan-test.mjs` 即绿；不要往 WHITELIST 里加"整文件/整目录"条目（那正是该门禁明令禁止的遮羞布）。

### 4.2 其余未验证 / 只能到这一步的
1. **"尺寸确实不同也照样归并"**（`different` 分支）只有纯函数判据（注入尺寸证据）覆盖；真机语料里没有"重传的不同尺寸"样本，
   现场夹具又因为离线拿不到远程图 ⇒ 台账证据是 `unknown`（§1② 表里已逐格注明）。
2. **诊断条数**：本轮**没有**改服务端回放上限（仍是"新连接回放最近 50 条"）。理由：上游产物档实测就是 50 条出头（本仓档 80–104 条），
   而回放上限一旦提到 200，每次开页都会往输出区多灌 150 行（用户对输出区的要求恰好相反）。**如实留给编排者决定**：
   要"诊断页签开出来就有更多历史"，动 `server/we-scene-demo-server-8902.mjs:2490` 的 `slice(-50)` 即可（我的写权内有这个文件，但本轮没动）。
3. **`#logbody` 守卫的边界**：只挡"通过 `scrollTop` 属性"的写；`innerHTML`/`replaceChildren` 整块重写绕过它（`A16c` 把产物那一行的写法钉成根因证据，上游一变即红）。
4. **常驻 `:8902` 我没有重启过**（本轮 `server/**` 一条没改，补丁与页面是静态文件）。这轮期间**别的线**在切它的库根，
   所以我没在被共享的常驻实例上做 A/B，而是**另起两份隔离服务**做改前/改后对照：
   - 改前 = `git archive HEAD` 出来的干净副本（**= 用户实测的那一版**）跑在 `:18902`；
   - 改后 = 工作树跑在 `:18903`；两者都用同一个库根。
   两份进程**已停**；常驻 `:8902` 的库根在本轮结束时已 `POST /api/library-dir {"reset":true}` 复原
   （读数：`dir=/…/allwallpaper/dd`、`22 items`、`source=default`）。
5. **`web/diag-flags.json` 被 `docs-check` 重新生成过**（时间戳 + 行号随工作树里别的线改过的 `core/we-scene-bundle.js`/`demo.html` 漂移）。
   这是跑验收命令的副产物，不是我的内容改动；编排者全量跑时也会同样生成。
6. **偶发**：`bench-ui-headless` 的 `S2a/S2b`（自绘下拉浮层贴合，与本轮 4 条无关的代码路径）在其中一次运行里红过，
   同一份代码重跑即绿（另跑 `bench-dropdown-theme-test` 也绿）⇒ 判为**既有偶发**，本轮未改那部分。
7. **未跑全量套件**（编排者统一跑）；浏览器档一律 `flock /tmp/.mpw-firefox.lock` 串行、同一时刻只有一个 Firefox。
8. **`now-playing-test.mjs` 与 `docs/PATCHES.md` 我没有改**：③ 的组件改动刻意只用"既有类 + 属性选择器"，
   所以那份（不在我写权范围内的）组件门禁 **219/0 一行没动**；`PATCHES.md` 的台账请由编排者按本报告补（我不碰该文件）。

---

## 5 需要编排者知道的两件事

1. **`bench-ui-headless` 的 T 组现在会点开 NP 卡片**（T5b/T5c 要量卡片内部那条音量轨）：它结束时会把卡片留在展开态、
   并把音量恢复到 0.35（随后 T6 的联动链自己收尾）。后续组（W/M/X/Y/G/Z/P）在这之后跑，实测全绿（192/0）。
2. **`docs/reports-issue0924a-line-A.md` / `-B.md` 的 `secret-scan` 红**（§4.1）会在编排者的全量套件里同样出现 ——
   与本轮 4 条无关，修法见 §4.1，需要有人去动那两个文件（我按写权范围没动）。

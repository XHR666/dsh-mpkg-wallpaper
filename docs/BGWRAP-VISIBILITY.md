# `.mpw-bgWrap`（壁纸层容器）可见性判据 —— "壁纸层被隐藏"到底是语义还是竞态

> 2026-09-17 判据轮。线索来自顶栏磨砂那条线：无头 Firefox 里多次量到 `.mpw-bgWrap` computed
> `display:none`，当时记为"注入式 localStorage 与宿主 `/settings` 合并时序（属另一条持久化线）"。
> 本轮把这件事**量完**：结论分两半 ——
> **① `display:none` 不是竞态，是两种正常语义之一**（且无头里的那次是**测量夹具自己**造成的）；
> **② 但同一条线索背后查出一个真机真 bug**：`showImageEl()` 会把调用方刚设好的 `img.src` 立刻清掉
> ⇒ "**图层可见、里面没有画面**"（用户观感同样是"壁纸不显示"，刷新图片/GIF 壁纸时必现），已修。

---

## 1. 控制点清单：所有能让 `.mpw-bgWrap` 变成 `display:none` 的路径

行号基于 `lib/client.js`（2026-09-17 修复后工作区）。

### A. 把**容器本身**设成 `display:none`（只有两处，都是 CSS，都在 buildCss 内）

| # | 位置 | 规则 | 触发条件 | 语义 |
|---|---|---|---|---|
| A1 | `lib/client.js:5281-5285` | `html, body { background: transparent !important }` + `.mpw-bgWrap { display: none !important }` + `.pI_x6G_sidebarCol/.hHd-Xa_root/.wSkVaW_root/.ydkMvW_root` 恢复不透明 | `hasImage === false`（`hasImage = !!(section.image \|\| section.webUrl)`，**5191**）：既没有 `image` 也没有 `webUrl` | **正常语义**："没有可用壁纸源 ⇒ 不显示壁纸层、面板恢复不透明"。命中它的真实情形：从没选过壁纸；清空背景；**总开关关闭**（调用点把 `image` 换空：`3368` 与样式自愈 `12278`）；`detectConflicts()` 判定与其他全屏背景插件冲突后自动 `enabled:false`（这是既有产品行为，`forceEnabled:true` 可豁免） |
| A2 | `lib/client.js:5737-5740` | `.mpw-bgWrap { display: none !important }` + `.pI_x6G_frame { background-color: var(--dsw-alias-bg-base) !important }` | `hideBg === true`，即 `hasImage && panel >= 100`（**5228**；`panel = clamp(50,100,opacity)`，**5226**） | **正常语义**："面板 100% 不透明 ⇒ 壁纸反正一层都透不出来，索性不画（顺带避免中缝透色）"。判据：面板 `opacity` **正好 100** 才触发（99 仍显示） |

> **判据锚点**（本文件后续与测试都用它）：A1 会**额外**输出
> `.pI_x6G_sidebarCol,\n.hHd-Xa_root { background-color: var(--dsw-specific-sidebar-fill) !important; }`
> 与 `.ydkMvW_root { background-color: var(--dsw-alias-bg-base) !important; }`，**A2 不会**。
> 于是"隐藏"的来源可以机器判别：`none ∧ anchor` = 无源语义；`none ∧ ¬anchor` = 不透明语义。

### B. 不动容器、只控制"层里哪一个媒体可见"（层本身仍 `block`）

| # | 位置 | 内容 |
|---|---|---|
| B1 | `5348-5376` | 类门控互斥：`.mpw-img video{display:none}`、`.mpw-video img{display:none}`、`.mpw-web img/video{display:none}`、`.mpw-web iframe.mpw-webFrame{display:none→block}`、`.mpw-scene img/video/iframe{display:none}`、`canvas.mpw-bgCanvas{display:none→block（.mpw-scene/.mpw-video）}`、`.mpw-scene-fallback iframe{display:none!important}` + `.mpw-scene-fallback img.mpw-bgImg{display:block!important}`（看门狗兜底帧） |
| B2 | `5329-5336` | 网页壁纸交互舞台：`.mpw-webInteract{display:none→block（.mpw-webInteract-on）}`、`Exit/Btn` 默认 `none`（`html[data-mpw-interact=on]` / `.mpw-web` 时 `block`） |
| B3 | `872/888/924/952` | `ensureBgDom()` 四个媒体元素的**内联初值** `display:none`（img/video/iframe/canvas） |
| B4 | `1282-1340`（`showImageEl/showVideoEl/showWebEl/showSceneEl`、`2910-2914`、`3380`） | 切换壁纸类型时的内联 `display` 互斥（谁被选中谁 `""`，其余 `none`） |

### C. 其它 `display:none` 写入口 —— 都**不会**命中壁纸层（已核）

| 位置 | 写谁 | 为什么不会命中 |
|---|---|---|
| `5039` | 宿主列表底部 fade 清扫（`[class*="fade"]`） | 壁纸层及其子节点没有 `fade` 类；且清扫已排除会话区/rail |
| `4624` / `4653` | `#mpw-aqua-mask`（Aqua 全屏遮罩自己的元素） | 不同元素 |
| `1076` | 时钟元素 | 不同元素 |
| `9097` | 「清除背景」写 `image:""` | 走 A1（无源语义），不是 display 直写 |
| 省电/遮挡 `powPaused`（`4377-4436`） | 只 `pause()/play()` 视频 | **不改 display**（层仍在，画面停在最后一帧） |

### D. 不是 `display` 但用户观感相同的一类：**层可见、里面没画面**

| # | 位置 | 触发 | 状态 |
|---|---|---|---|
| D1 | 旧 `showImageEl()` → `disarmSceneWatchdog(true)` → `mpwSceneClearFallback()` **无条件** `img.removeAttribute("src")` | 每次 apply 图片/GIF 壁纸（`applyFromStorageInner` 图片分支：先 `img.src = image`，紧接着 `showImageEl()` 又把它清掉） | **已修**（本轮；`keepSrc=true` + 兜底复核） |
| D2 | host 媒体 404 → `img.onerror` 重试链（`3625-3636` 一带） | 宿主端 media 拿不到（token 失效等） | 既有行为：重试 5 次并打日志（不静默） |

---

## 2. 时序判定：**不是**"注入式 localStorage × 宿主 `/settings` 合并"竞态

代码路径（`initHostSettings()`，`lib/client.js:257-277`）：

1. 启动时 `applyFromStorage()` 先按 **localStorage**（`dsh.mpkg-wallpaper.v2`）落地一次；
2. 同时异步 `GET /api/mpkg-wallpaper/settings`（宿主 `DATA_DIR/settings.json`）；返回后
   `merged = Object.assign({}, d.settings, local)` → **本地优先**，且 `image/info/propEdits/webUrl`
   **强制以本地为准**（宿主端本来就不存 `image`，见 `HOST_SKIP_KEYS`）；
3. 若期间用户已改过设置（`sectionDirty`）→ 宿主旧数据整体作废（不覆盖）；
4. 合并后 `applyFromStorage()` 重放一次；GET 失败/非 200/`settings:null` → 什么都不做（localStorage 兜底）。

**测量判据**（`node tools/bgwrap-display-probe.mjs`，无头 Firefox 真机页面 + 真 Cookie；
每个场景全新 context = 全新 localStorage；从 document start 起每 50ms 采一次 `wrap.display`，
只记变化点；同一次运行里**只改一个变量**）：

| 场景 | 宿主 `/settings` | 终局 display | CSS 含 `display:none` | 判据锚点=无源分支 | img.src 长度 | naturalWidth |
|---|---|---|---|---|---|---|
| op82（有壁纸，不透明度 82） | 真实宿主 | **block** | 否 | 否 | **156630** | **1400** |
| op100（同壁纸，**只把 opacity 改 100**） | 真实宿主 | **none** | 是 | 否（= **A2 不透明语义**） | 156630 | 1400 |
| op99（边界） | 真实宿主 | **block** | 否 | 否 | 156630 | 1400 |
| op82-hostfail（宿主请求 **abort**） | 失败 | **block** | 否 | 否 | 156630 | 1400 |
| op82-hostempty（宿主 `settings:null`） | 空 | **block** | 否 | 否 | 156630 | 1400 |
| op82-localonly（宿主 **慢 4s** 响应） | 慢 | **block** | 否 | 否 | 156630 | 1400 |
| nofix（**无**壁纸夹具，作对照） | 真实宿主 | **none** | 是 | **是（= A1 无源语义）** | 0 | 0 |

（表为**修复后**读数；修复前同一套场景的 `display` 列完全相同，只有 `img.src 长度/naturalWidth` 是
`0 / 0` —— 也就是说：**`display:none` 与合并时序无关，而"层空着"才是被修掉的那条**。
两次原始输出：`tools/probe-out/bgwrap-before.{txt,json}`、`tools/probe-out/bgwrap-after.{txt,json}`。）

> 口径提示：`bgwrap-after.*` 里的 `noSourceAnchor` 是**修正后**的判据字段。`bgwrap-before.*` 跑在修工具
> 之前，里面的 `noSourceBranch` 判的是 `html, body { background: transparent !important }`——那句
> **两个分支都有**（buildCss 公共块）⇒ 恒真、不可用；before 文件里可用的是 `display` / `img.src` 长度 /
> 时间线三列（本轮结论正是靠它们）。回归测试 `bgwrap-visible-test.mjs` 用的是修正后的锚点。

时间线证据（`bgwrap-after.txt` 的 `display 变化点` 段）：壁纸层在插件 apply 的那一刻就是终局取值
（`(no-wrap) → block`，或 op100 直接 `→ none`），**从未出现"先 block 后 none"**；宿主慢响应场景
在响应落地前后都是 `block`。⇒ 没有"先亮后灭"的覆盖窗口，也就没有"合并把有源状态覆盖成无源"的竞态。

### 那么无头里"恒为 none"是怎么来的？

是**夹具自己**造成的：顶栏磨砂/rail 那几条线的测量器（`tools/hdr-probe.mjs:297`、
`tools/header-rail-collect.mjs:165`、`tools/rail-cover-probe.mjs:92`）为了拿到"面板不透明"的对比背景，
夹具里写的是 **`opacity: 100`** ⇒ 正好命中 **A2（面板 100% ⇒ 隐藏壁纸层）**。
那几次测量因此是在**白底**上取像素的（`docs/TIMELINE-RAIL-TOKEN.md` 文末已经如实记了这一点）。
这与真机一致：**用户把「不透明度」拉到 100% 时，壁纸层本来就该隐藏**（拉回 99 立刻显示）。

---

## 3. 真机会不会命中"壁纸层不显示"？会 —— 但原因不是合并时序，是 D1

`showImageEl()` 的最后会把"场景首帧看门狗"的兜底视觉清掉：
`disarmSceneWatchdog(true)` → `mpwSceneClearFallback()` → `img.removeAttribute("src")`。
而这个调用发生在 `applyFromStorageInner()` 的图片分支**刚刚**设完 `img.src` **之后**（相差 3ms）：

```
t=3310  img.src= 长度 156630   ← applyFromStorageInner（设置壁纸源）
t=3313  removeAttribute(src)   ← mpwSceneClearFallback  ← disarmSceneWatchdog(true) ← showImageEl()
⇒ naturalWidth 恒 0：层 display:block，但一个像素都没有
```

**真机命中面**：图片/GIF 壁纸（`data:` dataURL、`idb:img`、`host:` 图片都走这条 else 分支）。
表现为"刷新页面后壁纸不显示"；而**从面板重新选一次壁纸**会走 `mpwAutoRefreshAfterApply()`（120ms 后
补一次 `img.src`）把它救回来 —— 这正是这类 bug 很难被抓到的原因（"再点一下就正常了"）。
视频壁纸（`converted:"mp4"`）不受影响（画面在 `<video>` 上，`userData` 的 img 清掉无所谓），
所以主要用视频壁纸的用户不会立刻发现。

---

## 4. 修了什么

1. **`mpwSceneClearFallback(keepSrc)`**（`lib/client.js:1750`；回退开关 `mpwBgWrapFixOn()` 在 `1739`）：`keepSrc=true` 时**只撤兜底视觉
   （`mpw-scene-fallback` 类 + `onerror`），不清 `img.src`**。
2. **`showImageEl()` 以 `keepSrc=true` 调用**（`1295`；`disarmSceneWatchdog(clearVisual, keepSrc)` 在 `1761`）：它是"即将显示这张图"的路径，清 src 没有意义。
   看门狗自己的路径（超时兜底 / 迟到首帧恢复 / 重建 iframe，`1771/1754/1812/1845` 一带）**照旧清**，
   场景兜底语义不变（测试 PART 2 有反向断言）。
3. **"有源就必须挂上"的有界兜底**（`lib/client.js:3007` 排程 → `3032/3042` 复核/补挂；`mpwBgArmedNow` 在 `3020`）：每次 `applyFromStorage()` 之后
   1.2s 复核一次（`mpwBgArmedNow()` 按 `webUrl / scene / mp4 / 图片` 分派），若"有源但媒体没挂上" →
   **补挂一次** + 一行 `console.warn` + 计数 `window.__mpwBgSrcHeal`（同一内容签名最多补一次，绝不循环；
   第二次还失败只报一次不再重试）。这就是"失败/超时要有明确兜底与日志"。
4. **回退开关 `?bgwrapfix=legacy`**：一键回到改动前（无条件清 src、不复核）。诊断口径：
   `window.__mpwBgWrapState()` → `{ fixOn, heal, last }`。开关登记
   `we-scene-demo/docs/README-DIAGNOSTICS.md` 主表（`diag-flag-check` 数字一致）。

## 5. 怎么复测（一条命令 / 一次浏览器）

```bash
# 判据测量（真机页面 + 真 Cookie；一个 Firefox 进程内串行 7 个场景，每场景 12s）
node tools/bgwrap-display-probe.mjs --secs 12 --label bgwrap-after
#   → 期望：op82/op99/hostfail/hostempty/localonly = block 且 img.src 有长度、naturalWidth>0；
#           op100 = none 且"无源锚点"为假（不透明语义）；nofix = none 且"无源锚点"为真（无源语义）

# 回归门禁（无浏览器，0 失败才过）
node tools/bgwrap-visible-test.mjs
node tools/bgwrap-visible-test.mjs --client <改动前的 client.js>   # 必须红（7 条）⇒ 证明用例有分辨力
```

`tools/bgwrap-visible-test.mjs` 共 23 条断言：PART 1 有源不得 none + 两种 none 来源可判别 +
宿主失败/null/慢响应/合并都不得把"有源"误判成"无源"；PART 2 切真源码块跑真 `showImageEl`，
断言 `img.src` 留下、兜底清理照旧、`?bgwrapfix=legacy` 真的接线；PART 3 变异回旧写法必须变红 +
源码守卫；PART 4 诊断接口一致。

## 6. 未定项 / 边界

- **无 GPU + 无头**：本轮只做**结构/属性级**判据（`computed display`、`img.src` 长度、`naturalWidth`、
  CSS 分支锚点），没有做像素级断言（本机 `backdrop-filter` 不合成，像素判据是假阴性）。
  真机上"观感上壁纸够不够清楚/磨砂够不够"仍需人眼。
- **面板不透明度 100% 到底该不该隐藏壁纸层**：本轮判为"既有正常语义"（不改），因为它同时承担
  "避免中缝透色"的作用；若将来用户希望 100% 时仍显示（例如把窗口拖到只露聊天区），
  改 `hideBg` 一处即可，`bgwrap-visible-test` PART 1 的 ③ 会立刻提醒。
- **`mpwBgSrcHealCheck` 的判定口径**：场景壁纸（`converted:"scene"`）用 `sceneComposite.key` 作代理，
  若场景合成改走别的缓存键需要同步（测试 PART 3 的源码守卫会盯 `mpwBgSrcHealSchedule` 是否仍在）。
- 另有一条**独立**的持久化风险（不属本轮）：`image` 为 dataURL 且 JSON > 256KB 时
  `mpwLsSafeSet()` 会**拒绝写 localStorage**（只保留旧值，宿主端也不存 `image`）⇒ 刷新后可能丢壁纸选择。
  这是"大图应走 IndexedDB"分支的阈值问题（`storeImage` 的 2MB 与 256KB 上限不一致），**未修**，
  留待持久化线单独处置。

## 追加（2026-09-25 P-184）：慢判（12s）的判据从 `canvas.width>0` 换成**画过戳**

**缺陷**：慢判「有 src 但**一直没有画面** ⇒ 强制重挂一次」对 section 档（canvas 合成）原判据是
`!!(canvas && (canvas.width || 0) > 0)`，而 `showSceneEl()` 的 `draw()` **一开始**就按视口给 canvas
设宽高、`clearRect` 之后才逐层 `drawImage` ⇒ **所有图层都加载失败时**（真机形态：图层 URL 404 /
宿主 token 失效 / 清单里全是坏 url）宽高照样被设上，判据退化成"元素存在"：
慢判恒为"画出来了" ⇒ **12s 自愈永不触发**，表现是永久空白且一行告警都没有。
反向也会错：canvas 还没参与/被宿主重建（width=0）时会把"正常"误判成坏。

**改法**（`lib/client.js`）：
* 新增两个只用 canvas 普通字段的小函数（便于门禁单独切出来跑真实现）：
  * `mpwScenePaintStamp(canvas, key, drawn)` —— 落"画过戳"：`__mpwBgDrawnLayers`（真的 `drawImage` 了几层）+
    `__mpwBgDrawnKey`（画的是哪份清单）+ `__mpwBgDrawnAt`；
  * `mpwScenePainted(canvas, key)` —— 判据：层数 > 0 **且** key 与当前 `section.sceneKey` 相同。
* `draw()` 逐层计数（`drawn++`）并在画完后落戳；**清单里一层都没有**时也落一次 0 层戳
  （否则会留着上一份同 key 清单的旧戳，把"这份清单没画面"误读成"画出来了"）。
* `mpwBgPaintedNow()` 的 scene 分支改读 `mpwScenePainted(canvas, section.sceneKey)`；
  图片档（`complete && naturalWidth>0`）、视频档（`readyState>=2 && videoWidth>0`）、
  web 档（不越权判死）与 `wrap`/`canvas` 缺失时的口径**逐条不变**（见下面的改前/改后矩阵）。
* 取证接口 `window.__mpwBgWrapState()` 增加 `drawn:{layers,key,at}`（真机可读同一处口径）。

**判据**（`tools/bgpaint-heal-test.mjs`，已进 `tools/check.sh`；13 断言）：从源码按括号配平切出三个真函数，
在假 `bgElements` 上断言五档 —— ① 有宽高但一层没画成 ⇒ **false**（缺陷本体）② 画成 3 层且 key 相同 ⇒ true
③ 旧 key 的戳 ⇒ false ④ 0 层戳 ⇒ false ⑤ `wrap` 在而 canvas 不在 ⇒ false（与改前一致）、`wrap` 不在 ⇒ true；
外加其它三档判据不变 + 四条源码级钉子（逐层计数、0 层落戳、慢判仍经 `mpwBgPaintedNow`、探针读同一处口径）。

**改前/改后逐条矩阵**（真源码切片；改前 = 钉死 `5b1a1ea` 的 `lib/client.js`，不能用 `HEAD` —— 一提交
`HEAD` 就变成"改后"，自证会恒绿）：

| 档位 | 改前 | 改后 |
|---|---|---|
| 有宽高但**一层都没画成** | `true`（缺陷本体） | `false` |
| 真画了 3 层、key 与当前 sceneKey 相同 | `true` | `true` |
| 戳是**异 key**（上一份清单留下） | `true`（吃旧戳） | `false` |
| 显式 **0 层**戳 | `true`（不敏感） | `false` |
| `wrap` 在、canvas 不在 | `false` | `false` |
| `wrap` 不在 | `true` | `true` |

**诚实边界**：① 戳落在 canvas 元素上 ⇒ 宿主把 canvas 整个重建后戳会丢，慢判会**多补一次 + 一行告警**
（有界，同签名只做一次）；② "清单一层都没有"从此会被判成"没画出来"并触发一次补画 + 告警 —— 这是**有意**
如实报出（有源却没有画面），但如果将来确认存在"合法空清单"的壁纸，应当在清单层就把它标成"无可画内容"
而不是放宽这里；③ 本测试是**源码切片 + 假 DOM**，没有跑真浏览器的像素级验证（真机像素判据在本机
`llvmpipe` 下不可信，与本文档原有口径一致）。

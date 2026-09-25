# WALLPAPER-LIFECYCLE.md — 壁纸流水线真机 bug 批次（2026-09-20）

> 现场：用户真机 `:3080`，素材 = 库根 `allwallpaper/dd/3580207945`
> （`project.json`: `type:"web"` / `file:"index.html"` / `preview:"preview.gif"`，Vite 构建：
> `index.html` + `assets/(index-*.js,index-*.css,font.ttf)` + `loadJson.json` + `BGM.wav` + `1-1.wav.ogg`…`5.wav.ogg`）
> 与容器档 `custommpkg|小鸟游星野01_04.mpkg`（`converted:"mp4"`、内嵌 `bgcs_abydos03.mp4`）。
> 归属口径：**服务端不可达（`:8899/:8901/:8902` 看门狗死过）与插件自身 bug 分开记** ——
> 本文件只记插件/宿主代码的缺陷；"服务端当时挂了"导致的 8899 connection refused 与黑屏已由主对话重启三服务解决，不计入本批。

**最终读数**（提交 `84c6ffc` 之后、`update-plugin.sh` 同步完）：

* `bash tools/check.sh` ⇒ **12/12 全绿**（`全部通过 ✓ 下一步：bash update-plugin.sh`）；
* `node tools/wallpaper-lifecycle-test.mjs` ⇒ **133 通过 / 0 失败**（含 **15 组变异自证**，每组按期望变红）；
* `node tools/wallpaper-lifecycle-live-probe.mjs`（真机 `:3080`）⇒ **31 PASS / 0 FAIL / 1 SKIP**；
  `--selftest` ⇒ 13/13；跑前跑后 `settings.json` / `custom-dir.json` **逐字节一致=true**。
  SKIP = ③-2c（帧内能力自证）：宿主进程里的 `lib/web-wallpaper.js` 还是改动前那一份
  （ESM 模块缓存；`dsh` 重启后该项会变 PASS，见 §10.1）。
* 探针的**已知抖动**（工具侧，不是被测行为）：宿主设置弹窗 + 我们那一节是懒渲染，
  headless 下偶发"等不到 `.mpw_wallThumb`/`.mpw_reset`" ⇒ 已加轮询 + 兜底再点标签；
  若某次跑出现该类 FAIL，先看探针日志里的"警告：等不到 …"再判。

判据全部常驻门禁：

| 门禁 | 位置 | 覆盖 |
| --- | --- | --- |
| `tools/wallpaper-lifecycle-test.mjs` | `tools/check.sh` 第 2 步 | A–N 十四组判据 + **15 组变异自证**（每条修复一组） |
| `tools/wallpaper-lifecycle-live-probe.mjs` | 真机（`--selftest` 无浏览器） | 真机读数：面板 rect / 清空 / 源不可用 / 沙箱对照 / 预览 / 分类 / 音频归属 / 联动 / 切页 |

---

## 0. 一句话结论表

| 条 | 根因（`文件:行` 均为修前） | 修法 | 真机读数（修前 → 修后） |
| --- | --- | --- | --- |
| ⑥ 设置面板被压进左栏 | `lib/client.js:11011` 给 `[class*="sidebarCol"]` 的 `backdrop-filter !important` 落在**设置 overlay 的祖先**上（overlay 在侧栏子树内，靠 fixed 逃出） | 结构判据 `data-mpw-holds-layer`（祖先链标记）+ 三条 blur 规则加 `:not([data-mpw-holds-layer])` + `:has()` 之外的延迟重算 | 面板 `{x:320,w:800}`（守卫在）→ **守卫失效时 `{x:13,w:254}`** ⇒ 修后任意时刻都 `{x:320,w:800}` |
| ② 清除壁纸后壁纸被重新加载 | `mpwStickySource`（`lib/client.js:878`）把 `undefined` 当"没改到"⇒ `clearBg` 写的 `webUrl: undefined/sceneKey: undefined` 被**从旧档带回来** | `clearBg` 改用 `null`（唯一删除语义）；换档走 `mpwSwitchPatchFull`（成套重写） | 清空后 `webUrl/sceneKey` **仍在** → 清空后 6 个源字段全空、层 `display:none`、iframe/video 无 src、6s 未复活 |
| ② 残留 `webUrl` 抢先武装（黑屏级联） | `applyFromStorage` 旧写法"有 webUrl 就走 web"（`lib/client.js:4752`） | 挂载裁决纯函数 `mpwPickMount` + `hasImage` 同口径 + 卸载残留帧 | 混态档：`mpw-bgWrap mpw-web mpw-scene-fallback`（黑屏）→ **`mpw-bgWrap mpw-video mpw-sharp`**（正常播放） |
| ① 预览框空白 | 预览分支只认 mpkg/视频/`image`，web 档 `image` 为空 ⇒ 全落空（`lib/client.js:15300` 附近） | 候选链 `mpwThumbCandidates`（`preview.gif/jpg/png/webp/jpeg`、`loading.webp`）+ `mpwThumbNext` 逐个退，耗尽落占位 | 预览框无候选 → `preview.gif` 真加载出像素（`naturalWidth=150`） |
| ③ 沙箱档加载不了 | 沙箱帧是不透明源；作者脚本用 blob-URL Worker 时被策略挡（`SecurityError`），父页只看到"shim 已握手"所以毫不知情 | shim 侧能力自证（`probeCaps`→`caps`）+ 父页按**策略类错误**一次性降级兼容档（可判定状态 + 面板人话） | 沙箱档：`sandbox="allow-scripts"`、`shimOk=true`、作者脚本报 `Error`；降级路径见下 |
| ④ 卡片暂停管不住帧内音频 | `applyWebMute` 只看 `npAudioOwns()`（我们**正在放**）⇒ 按下暂停那一刻帧内立刻解除静音 | `npFrameSoundBlocked()`（卡片暂停 ∨ 我们在放音）+ 暂停那一半 `pauseWebFrame` + 可判定状态 | 卡片暂停后帧内 `muted=false` 继续响 → `blocked=true reason=card-paused`、帧内 muted+paused |
| ⑤ 切页不静音 | `powPauseHidden` 默认 `false`（`lib/client.js:6708`）+ 只 pause 壁纸 video | 默认改 `true`（只迁移"从没设过"的存量档）+ 覆盖我们自己的 `<audio>` + `pagehide/pageshow` | 切页后仍出声 → 隐藏时 video/帧内/我们 audio 全停，回到可见按原状态续播 |
| A 角色语音混进播放器清单 | 清单只看得见文件名，不知道哪个是交互音 | 纯分类器 `mpwClassifyWebAudio`（引用上下文**就近**判 + 名字模式 + Live2D 对话表）+ `?npvoice=keep\|drop` | 清单含 `1-1…5.wav.ogg` → 清单只剩 `["BGM.wav"]` |
| B 联动关闭语义坏 | `npTransport` 在 link off 时"跳过壁纸"但没有任何"开→关/关→开"的对齐 | 纯状态机 `mpwLinkAlign`（关＝不碰；开＝按卡片状态对齐）+ 曲目档副标题如实写"只控声音" | 暂停状态下关掉后壁纸动不了 → 关＝`none`、开＝`resume/pause`，真机 `before=true after=true` |
| C 切页"过一会儿又响一下" | 我们自己的补起播/重试链（`npPrimePlay`、`applyNowPlaying` 补起播、手势重试、被节流的 60ms/1.2s/10s 定时重放）在 hidden 后仍会跑 | `mpwHiddenAudioBlock()` 唯一闸门（开关开 且 hidden）+ 所有起播入口过闸 + 恢复按原状态 | hidden 期间重试仍起播 → 三条重试路径 `plays 0→0`，轨迹 `gated: … hiddenBlock=true` |

---

## 1. ⑥ 设置窗口被压缩进左侧边栏（最高优先级）

### 1.1 根因（真机实锤，不是推断）

```
VOzbGW_overlay(fixed,1440×900) → … → hHd-Xa_footArea → … → pI_x6G_sidebarCol
```
设置 overlay 是**侧栏子树的后代**（靠 `position:fixed` 逃出侧栏）。而 `lib/client.js` 里
`html body:not([data-mpw-sblur-off])[class*="sidebarCol"]:not(…) { backdrop-filter: … !important }`
（第 11011 行；§H 块/E 块同款共三处）会让**包含块**变成侧栏 ⇒ `position:fixed` 的 overlay 被按侧栏
尺寸解析 ⇒ 里面的 800×800 面板被 flex 压缩进左栏。

真机前后对照（1440×900，同一次会话内可逆）：

| 状态 | `pI_x6G_sidebarCol.backdropFilter` | `VOzbGW_panel` rect |
| --- | --- | --- |
| 基线（`body[data-mpw-sblur-off]` 在） | `none` | `{x:320,y:50,w:800,h:800}` |
| **摘掉 `data-mpw-sblur-off`**（守卫失效的那一刻） | `blur(30px) saturate(1.4)` | **`{x:13,y:50,w:254,h:800}`** ← 用户看到的现象 |
| 恢复守卫 | `none` | `{x:320,y:50,w:800,h:800}` |

旧写法唯一的防线就是这个 body 属性，而它由 MutationObserver + "看得见的弹层"判定驱动：
入场动画（`opacity:0`/高度未达标）或一次重渲染就会把它摘掉；`:has()` 兜底在 Firefox 上对
`backdrop-filter` 的层叠不可靠（源码 §E 注释自己写了）。**同一读数在源码注释里早有"panel 宽 254"的记录**。

### 1.2 修法（三层，缺一层就还剩一半）

1. **结构判据**：`mpwSyncLayerHosts()` 给每个"开着的弹层"的**全部祖先**打
   `data-mpw-holds-layer`（含 `sidebarCol` 本体），并摘掉不再成立的标记；与"弹层可见性/动画进度"无关，
   不依赖 `:has()`。由 sblur 观察器 + `resize` + 300ms 延迟重算驱动（合并去重，不堆定时器）。
2. **CSS**：三条会加 `backdrop-filter` 的 `!important` 规则一律
   `:not([data-mpw-holds-layer])`（E9：出现 7 处）。
3. **注入类自愈**：`COMPAT_BRIDGES` 的 `aside` 选择器收窄（排除
   `role=dialog/alertdialog/presentation/menu/tooltip`、`aria-modal` 与 `overlay|modal|panel|sheet|drawer|popover|dialog|menu` 类名），
   我们打的类带 `data-mpw-side-mark`，`mpwUntagInjectedCompat()` 每次收口把"弹层容器 / 含弹层的祖先"
   上的注入类摘掉。**顺带修掉一个既有误判**：`isRight` 原来用选择器文本猜
   （`/sidebar-right|dockkit/`），而 aside 桥的选择器里带着 `:not([class*="_sidebar-right_"])`
   ⇒ 左栏桥被当成右栏桥（`rightSidebarBlur` 关时会把真侧栏的 `sidebarCol` 摘掉、且永不打标记）。

### 1.3 判据

* 无浏览器（E 组）：弹层容器不得带 `sidebarCol`；`data-mpw-holds-layer` 落在 overlay 每个祖先上；
  **子树里装着弹层的 aside** 不许被打类（选择器认它 ⇒ 只有 JS 判据挡得住）；带 `backdrop-filter` 的
  面板内不得有我们的布局类；aside 选择器文本本身已收窄。
* 变异：`compat-selector-narrowing-removed` / `compat-js-defenses-removed` 各自必红。
* 真机：面板 rect 必须 `panel.left >= sidebar.right - 4` 且宽 ≥ 700；打开/关闭 + 切 3 个 tab 后复测
  （⑥-1/⑥-3 PASS，`holds-layer` 13 个节点，含侧栏本体）。

---

## 2. ② 清除壁纸 / 换档：源字段必须"成套重写"

### 2.1 根因（两条独立的洞，叠在一起就是真机黑屏级联）

```
① clearBg (lib/client.js:14175) 写 webUrl: undefined / sceneKey: undefined
   + mpwStickySource (lib/client.js:878) 的语义是"undefined = 本次没改到 ⇒ 从旧档带回来"
   ⇒ 点"清除壁纸"：名字/类型显示"无"，但 webUrl 还在 ⇒ applyFromStorage 又走 web 分支
     ⇒ 壁纸**被重新加载了一遍**（用户原话）。
② applyFromStorage (lib/client.js:4752) "有 webUrl 就走 web"（不看类型/形状）
   + 所有换档调用点都用 undefined 表达"清掉旧字段" ⇒ 每次换档都留残留 webUrl
   ⇒ 切到 mp4 档：先挂 web 帧（旧目录 `/raw` 404）→ 场景看门狗打 mpw-scene-fallback
     → 回退也拿不到首帧 ⇒ 黑屏 + 左上角破图图标 + 日志框闪一下（用户看到的级联）。
```

### 2.2 修法

1. **换档成套重写**：`mpwSwitchPatchFull()`（`commit()` 唯一入口自动补全）+ `clearBg` 显式写 `null`：
   * 本次只给 `webUrl` ⇒ `image/sceneKey` 一并清空；
   * 本次只给 `image` ⇒ `webUrl/sceneKey` 一并清空（渲染器档两个都给 ⇒ 不会被误清）；
   * 写 `undefined` 的 10 个壁纸身份键（含新增 `srcRoot/srcDirPath`）一律转 `null`（唯一删除语义）。
2. **挂载裁决**：`mpwPickMount()`（纯函数）—— 类型/形状不符的残留 `webUrl` 不参与挂载；
   `hasImage` 与它同口径（残留 webUrl 不再让层"看起来有壁纸"）；走非 web 分支时**把 web 帧真的卸掉**。
   渲染器 URL（带 `pkgurl=`）只在 `converted==="scene"`（或没有 image 且没写 converted）时才算身份。
3. **清空 = 真的卸干净**：无源时 `img/video` 的 `src` 一并卸载（修前"本来就没有 img.src"时走 else
   分支跳过清理 ⇒ 后台还在拉旧 mp4；真机复测抓到）。
4. **半残档判据扩到"类型自相矛盾"**（`converted` 声明了类型却没有对应字段 ⇒ 也算半残档），
   自愈去重口径从"同一把 key 只试一次"改成"**同一 key + 同一源字段状态**只试一次"
   （真机：清掉 webUrl 并不改 mpkgKey ⇒ 旧口径把唯一一次能成功的自愈挡掉了）。

### 2.3 真机读数

```
清空前（混态档）：mpw-bgWrap mpw-web mpw-scene-fallback, display:block, iframe src=:8899/?pkgurl=…（404）
清空后 1.5s   ：display:none，iframe/video 无 src，image/webUrl/sceneKey/source/mpkgKey/mpkgName 全空
清空后 7.5s   ：仍全空、仍未复活（无 mpw-web / 无 -fallback 中间态）
换档（容器 mp4 档 + 残留渲染器 webUrl）：修前 mpw-web/-fallback 黑屏 → 修后 mpw-bgWrap mpw-video mpw-sharp
```

---

## 3. ② 源不可用：不许把宿主错误 JSON 当壁纸渲染

真机现场：`/custom-folder/<x>/index.html` 回 `{"ok":false,"error":"not found"}` ⇒ 浏览器把这段 **JSON
原样渲染进 iframe**（用户看到的"壁纸"就是一坨 JSON）；`<img>` 那条路则是破图图标。

两层修法：

* **服务端**（`lib/index.js`）：文档类请求（`.html/.htm` 或 `Sec-Fetch-Dest: iframe/document/frame/embed/object`）
  的 404/403 改回**极小的空 HTML**（子资源请求仍回 JSON，诊断不变）；
* **客户端**：`mpwArmProbe()` 挂载后轻量验活（`Range: bytes=0-0`），**只有宿主明确回 `{ok:false}`**
  才判"源不可用"（网络异常/无应答一律放行 ⇒ 不许一次抖动把好壁纸判没）；不可用 ⇒
  `#mpw-bgWrap[data-mpw-bg-error="<status> <url>"]` + `window.__mpwBgArmError` + **层隐藏**（露出主题纯色）
  + 面板一行人话（含"该壁纸记录来自哪个目录"）。

真机：②-5/②-6 PASS（正文无 `"ok":false`，`bg-error=404 /api/…/index.html?mpwshim=1…`，层 `visible=false`）。

> ⚠ 服务端那半（`lib/index.js` 的 404 HTML + 音轨路由 404 化）**要等 dsh 进程重启才生效**：
> 插件模块是 ESM，patch 热重载不会重新 import（实测：探针跑时 `/custom-scene-audio?...&folder=<不存在>`
> 仍回 500 ENOENT、`nope.html` 仍回 `application/json`）。客户端那半已生效并撑住了判据
> （探针 ②-5/②-6 就是客户端那半在起作用）。

---

## 4. ① 预览框：web 档必须有预览图

根因：预览分支只认 mpkg 容器预览 / 视频首帧 / `section.image`；web 档 `image` 是空串、`mpkgKey` 不是
`.mpkg` ⇒ 三个分支全落空 ⇒ 落到最后那句"无"提示（框里什么都没有）。**与"兼容/沙箱档"无关**（预览框
在设置里，不参与渲染模式）。

修法：`mpwThumbCandidates()` 候选链（纯函数）+ `mpwThumbNext()`（状态存在元素自己身上
`data-mpw-thumb-idx`，与 React 重渲染无冲突）：
① mpkg 容器预览（既有）；② web 档目录内 `preview.gif/jpg/png/webp/jpeg`、`loading.webp`
（目录 id 从 `mpkgKey`/`webUrl`/`image` 推）；③ 视频首帧 / image。耗尽 ⇒ 显示**类型占位文字**，
绝不显示破图图标。诚实边界：`project.json.preview` 写了非常规名（不含上面 6 个）的包取不到预览图。

真机：`img.src=…/custom-folder/3580207945/preview.gif`、`naturalWidth=150`（真加载出像素）。

---

## 5. ③ 沙箱档 vs 兼容档：差在哪、修到什么程度

同一张 web 档（`dd/3580207945`）真机对照：

| 档 | `sandbox` 属性 | shim 握手 | 作者脚本 | 结论 |
| --- | --- | --- | --- | --- |
| 沙箱（`?mpwshim=1`） | `allow-scripts` | `__mpwShimOk=true` | 起跑后报错（`Error`；Live2D/Pixi 类作者脚本依赖 blob-URL Worker / OffscreenCanvas，不透明源下被策略挡） | 注入链本身没问题；**差在帧内能力** |
| 兼容（无标记） | `allow-scripts allow-same-origin allow-pointer-lock` | 不适用（同源直控） | 同样报 `Error`（本机 headless Firefox **没有 WebGL** ⇒ Live2D 无法出画，两档都无法像素级验证） | 入口加载与属性集符合规格 |

修法（可判定的降级）：shim 侧新增**能力自证** `probeCaps()`（`worker/storage/blobUrl/offscreen/module`），
随 `ready`/`pong` 上报 ⇒ 父页存 `frame.__mpwShimCaps` + `window.__mpwShimCaps` + diag；父页在收到
**策略类**错误（`SecurityError|sandbox|opaque|denied|Failed to construct 'Worker'|insecure|Blocked`）时
一次性降级兼容档：去掉 `mpwshim=1` 与策略参数、换兼容属性集、重载一次，并留下
`frame.__mpwSandboxFallback{why,detail}` + `window.__mpwWebSandboxFallback` + `/diag` 的
`sandbox-fallback` 信标 + 面板人话提示。**普通作者 bug（TypeError 等）不触发降级**（沙箱的隔离价值
不能被一次无关报错换掉）。

诚实清单：本机 headless Firefox 无 WebGL ⇒ ③ 只能判定"入口/shim/属性/能力/错误类别"，**不能判定
画面是否出画**；`caps` 上报要等 dsh 重启（服务端 shim 是 ESM 模块，见 §3 的说明）。

---

## 6. ④ 音频归属 / ⑤ 切页静音 / C 切页"过一会儿又响一下"

### 6.1 ④ 卡片必须真的管住帧内音频

真机原话：「把音乐卡片**暂停**掉，它**还是会播放音频**；把卡片**打开**，它会优先播卡片里的音频
（壁纸自带的背景音乐会因卡片开启而关掉）」。后半句 NP-3 已实现（`npAudioOwns()` ⇒ 强制静音帧内），
缺的是**前半句**：`applyWebMute` 的静音口径只有"设置项静音 ∨ 我们在放音" ⇒ 按下暂停那一刻
`npAudioOwns()` 变假、帧内立刻解除静音。

修法：`npFrameSoundBlocked() = 卡片开着 ∧（用户按过暂停 ∨ 我们的播放器在放音）`；
* 静音：`applyWebMute` 用它；
* **暂停那一半**：卡片暂停 ⇒ `pauseWebFrame()`（`pause()` 对所有形态都成立，静音对 WebAudio 无效）；
  恢复时**只撤销我们按下的暂停**（`npFramePausedByUs` 记账，绝不去 play() 作者自己停着的媒体）；
* 可判定状态：`#mpw-bgWrap[data-mpw-np-sound="blocked|open"]` + `data-mpw-np-sound-reason`
  + `window.__mpwNpFrameSound{blocked,reason,cardPaused,owns,pausedByUs}` + diag。
* 换壁纸即清零卡片暂停状态（否则上一张档的暂停会把新档永久压住）。

真机：`{"blocked":true,"reason":"card-paused","pausedByUs":true}`（暂停）→ 恢复播放后
`reason=np-audio-owns`（我们在放音 ⇒ 只留一路，不叠音）。

### 6.2 ⑤ 切页静音：复用同一条开关 + 换成"默认就该做"

`powPauseHidden`（既有条目「省电·页面隐藏/切页暂停」）默认从 `false` 改成 **`true`**，
并只迁移"从没显式设过"的存量档（`powPauseHiddenUserSet` 标记，口径与 `bsCompat` 迁移完全一致）；
用户显式关过的一字不动。同时补齐旧写法漏掉的三处：我们自己的 `<audio>`（曲目档）、
帧内暂停记账（恢复只撤销我们按下的暂停）、`pagehide/pageshow`（bfcache 切页不一定派发
`visibilitychange`）；恢复按**原状态**续播（隐藏前在放才续播）——为此新增
`powHidWallWasPlaying / powHidNpWasPlaying` 记账，用户显式点"播放壁纸"走 `force=true` 不受限制。

真机：⑤-1 隐藏 ⇒ `powState.paused=true`（我们与帧内一起停）；⑤-2 回到可见 ⇒ `paused=false`。

### 6.3 C 切页"有时候响一下、过一会儿又响一下"（**我们的 bug**，非壁纸行为）

用户更正：这条发生在**非 web 档**（容器 mp4 → `/media?token=…` 的 `<video>`）上。

根因链（全部是**我们自己的重试/补起播链**在 hidden 之后仍然跑）：

```
npPrimePlay 是唯一起播入口，它的闸门只有 wallUserPaused / powPaused / npUserPausedOf(video)；
而 powPaused 只在"省电·页面隐藏"开关打开时为真（用户档是 false）
⇒ 后台标签里 setTimeout 被节流但**仍会触发**：applyFromStorage→applyNowPlaying 的补起播
  （48ms/60ms 延迟重放、源补挂 1.2s 复核、转码轮询 10s、mpw:wallpaused 驱动的重放…）
⇒ 起播一次（响一下）、被下一轮暂停、再起播一次 ⇒ 听感 = 间歇性响一下
（hidden 后 visibilitychange 还可能根本没派发 ⇒ powPaused 永远是 false，闸门等于不存在）。
```

修法（三层）：① `mpwHiddenAudioBlock()`（唯一判据：`powPauseHidden` 有效值 ∧ (`powHiddenNow` ∨ `document.hidden`)）；
② 所有起播入口过闸（`npPrimePlay`、手势重试、`applyNowPlaying` 的补起播），并在 `__mpwNpOps` 留痕
（`gated: … hiddenBlock=true` / `prime … skipped:hidden`）——**可归因，不静默**；
③ 隐藏时能控的都停住（video/帧内/我们的 audio）+ 帧内静音意图（跨源只能发意图）。

判据（N 组，含现场形态）：hidden 且 `powPaused=false`（模拟 visibilitychange 未派发）时，
三条重试路径 `plays 0→0`、轨迹含 `gated`；回到可见：闸门放开、**原状态**保持（原本暂停不自动起播）、
卡片播放仍能起播；显式关掉开关 ⇒ 闸门失效（逃生门，语义写进本文件）。
变异：`hidden-retry-not-gated`（闸门去掉 hidden 条件，两道一起退回）必红。

**与 web 档的关系（一句话）**：同一条通道也覆盖 web 帧 —— 能直控就直控（同源档），
跨源只能发 `policy/pause` 意图（沙箱档），并保留"交互音由壁纸自己播"的能力（我们只压背景音）。

### 6.4 H 后台挂载期起播（2026-09-25：Android 冻结→丢弃→**在后台重新加载**）

用户现场（与 6.3 那次**不是**同一件事）：

> 「手机后台只有 Termux + Via 在跑；在哔哩哔哩 App 里看视频时**突然冒出声音**，而且与 B 站音频
> 叠加（B 站没有被暂停）。回到 Via，发现 **DSH 页面需要重新加载**（= 页面此前被 Android
> 冻结/丢弃/静默重载过）。」

#### 6.4.1 首要假设的证实与证伪（先定性，再改代码）

假设：「页面在后台被恢复/重载 ⇒ 壁纸挂载路径在 `document.hidden === true` 时仍然起播」。

| 判断 | 结论 | 依据 |
| --- | --- | --- |
| **机制** | ✅ **证实** | C 那轮只收口了 3 条"补起播"入口（`npPrimePlay` / 手势重试 / `applyNowPlaying` 的补起播），**其余 14 处 `play()` 只查 `!(wallUserPaused \|\| powPaused)`，一处都没查 `document.hidden`**；而 `powPaused` 是"上一轮省电跑过"的**快照**，冻结/丢弃/后台重载这条路上它从来没被置真 ⇒ C 的闸门在这条路径上等于没有。真机信标已实锤这条链**真的会跑**：`diag-1790178218326.json`（09-23 23:43）`hidden-transition / kind=play / hidden=true / owner=ours / #mpw-bgVideo`。 |
| **这次的可听性** | ❌ **证伪**（本档） | 用户档 `mute=true` ⇒ `npWantMuted()` 在"没有用户手势"（后台重载必然是）时**恒为 true**，`#mpw-bgVideo` / 我们的 `<audio>` 全程 muted。09-23 那条 hidden play 的真机读数正是 `muted=true` ⇒ 不发声。 |
| **外部旁证** | ✅ 同页确有**不受我们 `mute` 管辖**的声源 | 信标全量盘点（9 条）：`mute-on-but-audible` 5 条**全部** `owner=whale-widget`（`/dsh-whale/sound/press.mp3`，`muted=false vol=1`，且 `np.mute=true`）—— 第三方插件的 `<audio>` 元素不在我们的静音面内（总线只管 WebAudio）。详见 [`AUDIO-SOURCES.md`](AUDIO-SOURCES.md) §7。 |

**"谁起的"最终判定**：见 [`AUDIO-SOURCES.md`](AUDIO-SOURCES.md) §7（本轮把"信标全量盘点 + 归属表"补齐）。
一句话：**本次的可听漏音没有一条信标指向我们自己的面**；我们的隐藏闸门有真实缺口（已修），
但在 `mute=true` 这一档上它只造成"隐藏期间有人调 `play()`"（audit 里 `hidden:true muted=true` 那种），
**不产生声音**。

#### 6.4.2 逐点表：谁在什么条件下会起播（修前 → 修后）

`lib/client.js` 的全量 `play()` 落点（22 处，含注释里 2 处引用）：

| 落点（符号名，行号随版本漂移） | 修前门控 | 修后门控 |
| --- | --- | --- |
| `npPrimePlay`（唯一"正式"起播入口） | `wallUserPaused / powPaused / npUserPausedOf / npCardPaused / mpwHiddenAudioBlock` | 同上（不变） |
| `npPlayRetryMuted`（被拒后 muted 重试一次） | **无** | `mpwPlayBlockedBy("prime-retry-muted")` |
| `showVideoEl` 尾部 prime | `mpwHiddenAudioBlock`（在 npPrimePlay 内） | **+ 挂载期 `mpwHiddenBootGate`**（在它之前） |
| `mpwAutoRefreshAfterApply`（120ms 延迟重放里的 `video.load()+play()`） | **无** | `mpwPlayBlockedBy("auto-refresh")` |
| `mpwBlobMediaRetry` 的 tick（blob 元数据挂起兜底） | **无** | `mpwPlayBlockedBy("blob-retry")`（`typeof` 守卫保持该块可独立求值） |
| `applyFromStorageInner` 的转码/直读/404/超时/aggressive 共 **7 处** `vid.play()` | `!(wallUserPaused \|\| powPaused)` | `!mpwMediaPlayBlocked()`（= 加 hidden） |
| `npWatchVideo` 的 `pause` 事件补播（audio-blocked 兜底） | **无**（只查 pow/wallUserPaused） | `mpwPlayBlockedBy("pause-replay")`（**在置 `npSoundBlocked` 之前**，否则回可见时没人再装手势重试） |
| `npEnsureAudio` 的 `ended` 单曲循环 | **无** | `mpwPlayBlockedBy("audio-loop")` |
| `npAudioError` 的 blob 兜底起播 | **无** | `mpwPlayBlockedBy("audio-blob-retry")` |
| `npLoadTrack(play=true)`（换曲/next） | **无** | `mpwPlayBlockedBy("npLoadTrack")` |
| `npTransport` 的 `play`（卡片 / 系统媒体键） | **无** | `mpwPlayBlockedBy("transport:play")` |
| `applyNowPlaying` 的 link-align `npAudio.play()` | **无** | `mpwPlayBlockedBy("link-align")` |
| `resumeWebFrame`（帧内元素 play） | 只查 `webFramePausedByUs` | **+ `mpwHiddenAudioBlock()` 早退** |
| `resumeWallpaperVideo` 的 video / npAudio 两行 | video 有 hidden 闸；**audio 没有** | 两行都 `+ !mpwHiddenAudioBlock()` |
| web 帧 / 场景帧内**作者自己**起播（`?audio=1` 的音轨、网页壁纸 BGM） | 只有 `applyWebMute` 的 muted，**没有 park** | **+ hidden ⇒ `sendRendererAudioPolicy(frame,true,true)` park**（挂载后立即下发；见 `showWebEl`） |
| 第三方插件（鲸鱼挂件等）的 `<audio>` | 不归我们管 | 仍不归我们管 —— 但 hidden 期间照**如实记一条**（owner/src/栈 + 独立台账 + 进 `/diag`） |

#### 6.4.3 修法（五层，缺一层就还剩一半）

1. **唯一判据实时化**：`mpwHiddenAudioBlock()` = `?hiddengate=legacy` 短路 ∧ `powPauseHidden` ∧
   `mpwHiddenLive()`；`mpwHiddenLive()` = `mpwHiddenFrozen ∨ powHiddenNow ∨ document.hidden`（**实时读
   `document.hidden`**，不再依赖"上一轮省电跑过"这个快照）。
2. **统一闸门**：`mpwPlayBlockedBy(where)`（拦住 = true，并记一条带 `where` 的台账）；
   `mpwMediaPlayBlocked()` 是 C 那轮 7 处旧写法的等价加强版。上面表里所有"无门控"的落点全部收口。
3. **启动期状态机**（本次现场的正面回答）：
   - `mpwHiddenBootGate(where)`：挂在 `showVideoEl` / `showWebEl` / `showSceneEl` 三个**真挂载点**上；
     hidden ⇒ **一律不起播**，只记**一条** `boot-hidden-no-autoplay`（含 `where` 与 `state`）；
   - 两种状态**必须可区分**：`never-started`（`mpwHiddenBootBlocked`，从没起播过）与
     `paused-by-hidden`（`mpwHiddenPausedByUs`，隐藏前在播、被我们停的）；
   - 恢复口两个：第一次 `visibilitychange → visible`（`updatePowerPause` 里调 `mpwHiddenBootResume`）
     或用户手势（`npArmGestureRetry` 的 once 里）；恢复**按当时策略**（用户暂停 / 卡片暂停 / 被策略拒 ⇒ 不动）。
4. **隐藏/冻结/丢弃时的停手**：`visibilitychange`(hidden) / `pagehide` / **`freeze`（新增，Android 冻结）**
   ⇒ `updatePowerPause()` → `pauseWallpaperVideo()`（video.pause + web 帧 park/shim pause + 我们自己的
   audio.pause + 强制 muted）；`freeze/resume` 走**同一条状态机**（单独 pause 会让画面永久冻在冻结那一刻）。
   `AudioContext.suspend()`：我们自己的面里没有 AudioContext（唯一的 WebAudio 是帧内作者的，跨源只能靠
   `park` 让渲染器自己 suspend），**不碰别人的 ctx**，只如实记账。
5. **可归因**：`window.__mpwHiddenLedger`（有界 64：`boot-hidden-no-autoplay` / `pause` / `freeze` /
   `frame-park` / `hidden-play` / `play-blocked(where)` / `boot-visible-resume` / `frame-mute-unreachable`…）、
   `window.__mpwHiddenPlays`（hidden 期间的起播，**owner 是谁都记**）、
   `window.__mpwUnreachableFrames`（不透明源且无 shim ⇒ 我们**一个通道都到不了**的帧，绝不假装静音）；
   前两份随 `/diag` 的 `audio-audit` 信标落盘（页面在后台被丢弃/重载也丢不掉）。

#### 6.4.4 判据与变异（`node tools/hidden-gate-test.mjs`，接入 `tools/check.sh` 第 2 步）

| 组 | 钉什么 | 读数 |
| --- | --- | --- |
| A | hidden **挂载** ⇒ 挂载路径 `play()` **零调用** + 只记一条台账 + `where=showVideoEl` + `never-started` | **63 通过 / 0 失败**（含变异） |
| B | 可见挂载 ⇒ 正常起播（闸门不是"永久禁播"） | 同上 |
| C | `visibilitychange → hidden` ⇒ 真的 `pause()` + `paused-by-hidden` + 台账 | 同上 |
| D | 回可见 **按原状态**：在播才续播；原本暂停的一个字节都不放 | 同上 |
| E | `never-started` ⇒ 第一次可见**补上**（与 D 是两条独立状态）；`npPaused=true` ⇒ 不补 | 同上 |
| F | `freeze` ⇒ 与 hidden 同待遇；`resume` ⇒ 闸门放开且**画面没有永久冻住** | 同上 |
| G | 逃生门两条：`?hiddengate=legacy` / `powPauseHidden=false` | 同上 |
| H | hidden ⇒ 对已挂载的帧下发 **park**（`posted=true`）+ 可见时不 park + 够不着的帧如实记账 | 同上 |
| I / I2 | hidden 期间起播**无论 owner** 都留一条；我们自己的 BGM（换曲 / link-align）在 hidden 时零起播 + 可见正对照 | 同上 |
| J | 源码锚点：旧写法 `!(wallUserPaused \|\| powPaused)` 代码里 0 残留、三个挂载点都有闸门、无"裸 `play()`" | 同上 |
| K | **8 组变异各自必红**：`gate-reads-live-hidden-dropped`(A,E,F,H,I)、`boot-gate-removed`(A,E,J)、`play-gate-hidden-branch-removed`(I)、`frame-park-removed`(H)、`freeze-listeners-removed`(F)、`boot-resume-removed`(E)、`hidden-plays-ledger-removed`(I)、`npaudio-regate-removed`(I,J) | 8/8 红 |

**真浏览器档**（不入常驻门禁；与其它真机探针同规矩，必须串行 —— 跑前先 `pgrep -af 'run-all-tests|check.sh'`）：

```sh
flock /tmp/.mpw-firefox.lock -c 'node tools/hidden-gate-browser-probe.mjs'
# ⇒ 17 通过 / 0 失败（真 Firefox + 真 <video> + 真 visibilitychange 事件）
```

它把"node 桩里 `document.hidden` 是 `defineProperty` 出来的假值"这条质疑堵掉：B0 hidden 可控、
B1 插件在真 Firefox 里装载并 apply、B2 真 DOM 里壁纸层与 `<video>` 都在、**B4 hidden 挂载 ⇒ 真媒体
元素 `play()` 零调用**、B5 状态是 `never-started`、B7 真 `visibilitychange` 回可见才补起播、
B10 转 hidden ⇒ 真 `pause()`、B12 回可见按原状态续播、B13 帧 park 报文逐字段正确、
B14 正对照（可见时重挂载真的 `play()`）、B15 零 pageerror。
**不碰任何在跑的服务**：页面由 `page.route` 本地 fulfil（中性源 `127.0.0.1:3199`）、`window.fetch`
换成桩、`localStorage` 预置本档设置 ⇒ 全程不出网、不写 `~/.dsh-mpkg-wallpaper/settings.json`。

#### 6.4.5 未验证边界（如实）

- **真机 Adreno / Via / Android WebView 的实际冻结-丢弃-重载时序无法在本机复刻**：本机只有
  node 桩（无浏览器）。本轮能证明的是"**代码路径**在 `document.hidden === true` 的挂载期不再调
  `play()`"与"可见/隐藏两个方向的落点都对"，**不能**证明"Via 的后台重载一定会派发/不派发哪些事件"
  （那正是本闸门不去依赖事件、改读实时 `document.hidden` 的原因）。
- **`freeze` / `resume` 事件在目标浏览器上是否真的派发**：Chromium 系（Via/Chrome Android）支持，
  但本机无法验证；不支持时只是挂了两个永不触发的监听（无害，不抛错），闸门仍由
  `visibilitychange` + 实时 `document.hidden` 承担。
- **不透明源（无 shim 的 strict sandbox）帧的音频**：我们**没有**任何通道能静音/暂停它
  （`frame.muted` 对 iframe 不是标准语义、`contentDocument` 为 null、shim 不存在）；本轮只做到
  **如实记账**（`__mpwUnreachableFrames` + `frame-mute-unreachable`）。要真管住它，需要宿主在
  渲染器侧实现 `mpw-audio-policy` 的接收（场景渲染器已有；普通网页壁纸没有）。
- **第三方插件（鲸鱼挂件）的 `<audio>`**：明确**不控制**（用户要求的边界）；只记录。

---

## 7. A 交互音/角色语音不进播放器清单

用户原话：「交互里面的角色会播放特定的声音 …… 把这个声音文件从音频播放里排除掉，不然我音频播放
放的是角色的语音，而不是背景音」。

### 7.1 分类器（`mpwClassifyWebAudio`，纯函数，逐条给依据）

| 规则 | 判据 | 依据字段 |
| --- | --- | --- |
| ①② 引用上下文（**就近**） | 名字在某个文本语料里出现位置的 ±120 字符内，`bgm/background/music/loop/autoplay` 比 `voice/talk/event/click/touch/pointer/dialog/se` **更近** ⇒ bgm，否则 voice | `why=ref-in-background-context` / `ref-in-interaction-context`，`at=<语料名>:<行号>` |
| ③ 名字模式 | `bgm/background/music` ⇒ bgm；`voice/talk/se_/click/touch/dialog` ⇒ voice | `name-pattern-*` |
| ④ Live2D 对话表 | 数字对话式命名（`1-1.wav`、`2.wav`）且出现在 `loadJson.json`（`SettingModel/EventInfos`） | `live2d-talk-table` |
| ⑤ 其余 | **unknown（默认保留为背景音）** | `default-keep` |

引用匹配用"候选写法"（`x.wav.ogg` → `x.wav` → stem），因为作者源码里写的是**短名**
（真机语料：目录是 `1-1.wav.ogg`，`loadJson.json` 里写 `1-1.wav`）。

**判不准时的口径**：默认**保留**（丢错的代价是"壁纸没声音"，留下的代价只是清单里多一条）；
`?npvoice=drop`（unknown 也丢）/ `?npvoice=keep`（一条都不丢）可覆盖。

### 7.2 语料实测（逐文件分类表，`node` 走真实现）

`3580207945`（用户测的那张，语料 = `index.html` + `assets/index-CQUR_vLf.js` + `loadJson.json` + `project.json`）：

| 文件 | 判为 | 依据 | 位置 |
| --- | --- | --- | --- |
| `BGM.wav` | **bgm** | 作者源码 `f.src="BGM.wav",f.volume=e.value.bgmVolume … await f.play()` | `assets/index-CQUR_vLf.js:916427`（就近判定：`bgmVolume` 比同段 `talkVolume` 更近） |
| `1-1.wav.ogg` | voice | 引用上下文（交互语义） | `assets/index-CQUR_vLf.js:17` |
| `2/3/4.wav.ogg` | voice | Live2D 对话表 | `loadJson.json`（`SettingModel/EventInfos`） |
| `5.wav.ogg` | voice | 引用上下文 | `loadJson.json:59` |

另外两张（同一批语料）：

| 目录 | 文件 | 判为 | 依据 |
| --- | --- | --- | --- |
| `3644069061`（星穹铁道 昔涟 4K） | `atmos_loop.wav` / `bgm.mp3` / `intro.wav` / `loop.wav` | bgm | `index.html:35/36`（`loop/autoplay` 上下文） |
| `3646392375`（原神 Columbina） | `backgroundmuisc.mp3` | bgm | `js/WELLPAPER ENGINE/audio.js:1` |
| `3752477634`（碧蓝档案 瞬(泳装)） | `BGM.wav` = bgm；`CH0355_…_1_1…3_2` = voice；`4_x/5_x` = unknown（保留） | 引用上下文 / 对话表 / 默认 | `loadJson.json:38/78-82` |

### 7.3 真机读数

`window.__mpwNpAudioClass`：`voice=["1-1.wav.ogg","2.wav.ogg","3.wav.ogg","4.wav.ogg","5.wav.ogg"]`、
`dropped=` 同一集合；**播放器实际清单 = `["BGM.wav"]`**（A-1…A-4 全 PASS）。
实现细节：只在 web 档上做（`npFetchTracks` 里拉入口 HTML + 它引用的 js/json ≤6 个 + `loadJson.json`/
`project.json`，各截断 200KB），分类表随 `/diag` 的 `np-audio-class` 上报。

---

## 8. B 联动开关（`npLinkWallpaper`）关闭后的语义

用户原话：「关闭状态下它的暂停播放用不了 —— 如果我在**暂停状态下**把开关关闭，那这个壁纸就不能
动起来；如果我在**播放状态下**把开关关闭，那它还是可以继续播放，就是**不能暂停**了」。

规格 + 落点：`mpwLinkAlign(linkOn, prevLinkOn, cardPaused)`（纯状态机）
* **关**（`linkOn=false` 且发生了切换）⇒ `"none"`：**不许改变壁纸当前播放状态**（暂停就保持暂停、
  播放就继续播放）—— 这正是用户现场报坏的那条；
* **开**（`false→true`）⇒ 按卡片当前状态对齐：卡片暂停 ⇒ `"pause"`、卡片在放 ⇒ `"resume"`
  （绝不出现"卡片显示在放、壁纸停着"两个状态打架）；
* 值没变 ⇒ `"none"`（一个字节都不碰）。

关掉之后卡片仍**只能控自己的音频**：曲目档 `out.canPlay = !listOnly`（不受联动开关影响），
副标题如实追加「「播放/暂停同时控制壁纸」已关：控件只驱动本插件自己的播放器，壁纸本身的播放不受影响」；
视频档照旧 `canPlay=false` + 同样的说明（"不假装按得动"）。

真机：`B-1 关时不改变壁纸播放状态 before=true after=true`；`B-2 状态机 alignNone=none / alignResume=resume`。

---

## 8.5 C2/C3 音频审计 + 「换档即断开旧音源」（用户 00:14 现场）

### C3 换档硬归零（**先落这条**：它是"切掉了还在放它的声音"的真凶级漏洞）

修前代码链：

```
npFetchTracks:7206  const url = npScanUrl(scope);
npFetchTracks:7207  if (!url) return;                       // 容器档/无目录档：直接 return
npFetchTracks:7210  if (npMediaCache.key === key && npMediaCache.data) return   // 缓存命中：也 return
npFetchTracks:7243  try { if (npAudio) { npAudio.pause(); npAudio.removeAttribute("src"); } } catch {}
                    // ↑ 只在 fetch **成功**的 .then 里
npDropAudio()      只在"NP 开关被关掉"那一条路上被调用
⇒ 从"有曲目清单且在播"的档切到"无清单的档"（容器视频档）时，上一张壁纸的 `<audio>` **继续在放**
```

修法：单一事实源 + 切换即归零（**不依赖任何 fetch 成功**）

* `npSourceKind(s)` ⇒ `video | tracks | frame | none`（当前音源的唯一口径）；
* `npSourceId(s)` = 类别 + 清单作用域键；`applyNowPlaying` **入口**比对上一轮，身份变了就先
  `npAudioHardReset()`（`pause()` + 去掉 `src` + `muted=true` + `load()`）；
* `npFetchTracks` 的两条"直接 return"（无扫描 URL / 缓存命中）也各自收口（第二道防线）；
* 判据（O 组）：夹具"上一源 tracks 且在播" ⇒ 切到无清单档 ⇒ 断言 `npAudio.paused===true && src 已断`；
  变异把**两道防线一起**退回 ⇒ O 组必红（两道互为兜底，只拆一道仍不红是设计如此）。

### C2 音频审计（`?npaudit=0` 关；默认常开）

Hook 面：`HTMLMediaElement.prototype.play`、`volume`/`muted` setter、`Audio` 构造、
`AudioContext/webkitAudioContext` 构造与 `decodeAudioData`，以及我们自己的
`npPrimePlay` / `npApplyMute` / `npApplyVolume` / `npEnsureAudio` / `npDropAudio` / `npAudioHardReset`。
每条记录：`{t, kind, who(栈前 3 帧), el{tag,id,cls,connected,src摘要,hasSrcAttr}, muted, volume, paused,
currentTime, hidden, np{on,link,mute}}`，写进**有界环形**（≤200 条，`window.__mpwAudioAudit`）。

**自动上报（用户"什么都没动又响了"的下一次，磁盘上就有证据）**：命中"可疑"即 POST `/diag`
一条 `audio-audit`（含 `trigger` + **审计窗口最近 12 条** + `visibility`）；"可疑"的定义 =
**可听播放转变**（`!paused && !muted && volume>0`）∨ 元素已从 DOM 摘除却仍在播
（`isConnected=false` 显式标出）∨ hidden 期间的 play/取消静音。节流 5s/条。
诊断落点由宿主 `/diag` 决定（本机 `/root/.dsh-mpkg-wallpaper/diag-<ts>.json`）。

**哪些声源不受 `mute` 管**（家长要求的清单，本轮已核对）：

| 声源 | 受 `mute` 管？ | 说明 |
| --- | --- | --- |
| 壁纸 `<video>`（容器/库/自定义视频档） | ✅ | `applyVideoMute()`（NP-4 接线） |
| 我们自己的 `<audio>`（目录曲目档） | ✅ | `npApplyMute()` |
| 同源 web 帧内的 `<video>/<audio>` | ✅ | `applyWebMute()` 直控元素 |
| **跨源 web 帧**（`:8899/?pkgurl=…` 渲染器 / 不透明源沙箱） | ⚠️ 只能发意图 | `frame.muted` + shim `policy{muted}` / `op:pause`；作者用 **WebAudio** 或自绘播放器时**压不住**（已如实记 `data-mpw-np-sound`） |
| **已从 DOM 摘除但仍在播的元素** | ❌ 修前完全不在覆盖面 | 规范：`remove()`/`removeChild()` **不会**停止播放；本轮已修 `showImageEl`（切离视频档先 `pause()`+`load()`）并加了 `isConnected` 审计 |
| `AudioContext`/`Audio` 直出（作者自己 new 的） | ❌ | 审计已 hook 构造与 `decodeAudioData`（能抓来源），但**没有**静音它们的通用手段（浏览器不提供"全局静音"）⇒ 只能靠"换档即断开 + hidden 闸门 + 审计定位" |
| 隐藏但仍在播的壁纸 `<video>` | 修前 ❌ | 现在 hidden 时强制 `muted=true` + `pause()`（C 条） |

### 长窗口观测（判据口径，家长更正后）

**不做**"刷新后 10s"的专项断言（用户已说明"刷新即响"只是碰巧）。
正确口径：**在用户没有任何操作的时间窗内，任何一拍出现"在播且 `muted=false && volume>0`"都算红**，
窗口 ≥ 3–5 分钟（后台节流/定时器周期量级）；另加"**切档后 30s**"窗口（对应 C3 的早退嫌疑）。
探针里对应 `--watch <秒>`（每 5s 一拍，记录 `visibilityState`/元素身份/`isConnected`/`muted`/`volume`/`currentTime`）。

---

## 8.6 NP-5 卡片的播放/暂停意图持久化（刷新后不许自动换成播放）

* **键**：`npPaused`（布尔，默认 `false` = 播放）。
* **唯一写入口**：`npPersistPaused(v)`，只被 `npTransport` 的**用户显式操作**调用
  （video 档 link 开：pause/play；link 关：静音/取消静音；曲目档：pause/play）。
  `npPrimedMuted`（muted 起播兜底）、`npSoundBlocked`（浏览器策略）、hidden/省电暂停、联动对齐
  **一个都不写**（否则刷新后会把内部状态当成用户意图恢复）。
* **恢复**：`applyNowPlaying` 入口调 `npApplyPersistedPause(s)`，按当时的 `npLinkWallpaper` 翻译意图 ——
  开 ⇒ 整体 `pause()`（画面也停）；关 ⇒ **只静音音轨**（画面继续）。`npPrimePlay` 的闸门加了
  `npCardPaused`（持久化暂停时不起播）；卡片显示 `playing = npCardPaused ? false : !vid.paused`。
* **换档清零口径变更**：`npCardPausedKey` 变化时**不再无条件清零** `npCardPaused`，而是重新读持久化值
  （旧写法在这里把"用户按过暂停"抹成 false —— 那正是"刷新后暂停被换成播放"的最后一环）。
* **恢复默认**：`npPaused = false`（回到播放），与"恢复默认后壁纸照常动"一致；键同时进了
  `BACKUP_FIELDS` 与导入的 `boolFields`（白名单净化），并在开关接线审计里登记为**仅运行时**开关。
* **判据**：R 组 10 条（boot 读到持久化值 / 不进入可听状态 / `play()` 一次都没被调 / 卡片显示暂停态 /
  审计留痕 / 内部状态不写档 / link 关时"只静音" + 写了意图 / 反向（播放）/ 写入口径 / 登记表）；
  变异 `np-paused-not-restored`（去掉恢复）与 `np-paused-written-by-internal-state`（把内部状态当意图）必红。

---

## 9. 同类审计（用户要求："查这类 bug 会不会衍生出其他 bug"）

每条给"是否有 / 在哪 / 判据"。**结论：这一类（源字段残留 + 形状错配 + 错误页被当素材）在本轮
全部收口；下表是逐项的现状与护栏。**

| # | 审计项 | 结论 | 位置 / 判据 |
| --- | --- | --- | --- |
| 1 | 所有"源字段"写点与清点（选档/清除/换目录/换库/容器/时间变化/恢复默认/导入备份） | **有（已修）**：选档/清除/换库/容器全部走 `commit → mpwSwitchPatchFull`（成套重写）+ `clearBg` 显式 `null` | `mpwSwitchPatchFull` / A 组 7 条断言 |
| 2 | 恢复默认会不会把壁纸一起清掉 | **无**（`resetSettings` 有 keep 列表；既有门禁 D9） | `tools/settings-persist-test.mjs` D9 |
| 3 | 导入备份会不会留下旧源字段 | **无**（`BACKUP_FIELDS` 白名单 + 类型净化；本轮未改） | 同上 §backup 组 |
| 4 | "URL 形状"构造点（`custom`/`custommpkg`/`library` 三类 + slot/fromMpkg/timeVideos） | **有（已修 + 已绑定）**：`mpwSourceFieldsFor` 让形状只由 `srcRoot` 决定；`mpwSrcShapeOf`/`mpwSrcConsistent` 做一致性裁决 | C1–C9；`mpkgKey` 为权威身份（`srcRoot` 只在无 key 的旧档上兜底） |
| 5 | 是否有别处把 ltoken 当 folder（或反之） | **有（已修）**：库条目必须 `ltoken=` + `/library-web/`；`custom=` 只对当前 customDir 有效 | C1/C3/C5 + 真机 ②-5 |
| 6 | 会返回 JSON 错误的 URL 是否可能被交给 iframe/`<video>`/CSS `background` | **有（已修两层）**：服务端文档类 404/403 改 HTML；客户端 `mpwArmProbe` 明确 `{ok:false}` ⇒ 不武装 + 层隐藏 | G 组 8 条 + 真机 ②-5/②-6 |
| 7 | `?mpw*` 诊断开关与回退链（`mpw-web`/`-scene-fallback`/`-video`）是否带原因 | **部分有（已补）**：新增 `mpwTrace("mount:ignore-stale-webUrl"|"compat-skip-layer"|"compat-untag"|"layer-host:sync"|"bg-arm-error"|"link-align"|"prime … gated:…hiddenBlock")` + `/diag` 信标（`stale-webUrl`/`bg-arm-error`/`np-audio-class`/`sandbox-fallback`）；`mpw-scene-fallback` 本身仍只有"结果"（原因要看 `scene-wd` 诊断块） | `mpwTrace`/`mpwWebDiag` 调用点；`__mpwNpOps` 轨迹 |
| 8 | 路由解析的**根来源**（`customDir` vs 库根 vs `MPW_ROOT`）在服务端是否唯一 | **不唯一（已修一处 + 已报告）**：`/custom-scene-audio`、`/custom-scene-frame`、`/custom-scene-video` 的 `folder=` 一律相对 `customDir`（真机 500 的成因是客户端 `customDirPath` 与宿主侧 `customDir` 失同步）；客户端改"失败即同步目录并重试一次"（happy path 零额外请求） | ②(根因 B) 注释块 + `mpwHostJsonRetryDir`/`mpwSyncCustomDir`；服务端 404 化见 §3 的"未生效"说明 |
| 9 | `custom-scene-frame`/`-thumb` 的 `folder=` 语义 | **已确认**：只接受"当前 customDir 下的**一级子目录名**"（含 `/` 即 403）；`file=` 可选（thumb 用于指定容器内条目）。调用方不得把 `ltoken` 或文件名塞进 `folder` | `lib/index.js` 路由注释 + `npAudioScope` 的 `isDirName()` 判据（挡住 `*.mpkg` 这类"以文件当目录"的请求） |
| 10 | 清单条目 ↔ URL ↔ 能否取到 的一致性 | **已加判据**：`mpwSourceFieldsFor`（形状）+ `mpwArmProbe`（可用性）+ `mpwThumbCandidates`（预览）三处同源；真机探针逐档断言"入口 200 / 预览 `naturalWidth>0` / 源字段与来源自洽" | C/D/G 组 + 真机 ①-1/①-2/③-2/③-4 |

---

## 10. 诚实清单（做不到 / 只能这样）

1. **服务端两处改动要等 dsh 重启才生效**（ESM 模块缓存，patch 热重载不重新 import）：
   `lib/index.js` 的"文档类 404 用 HTML"与三条 scene 路由的 `404 化`、`lib/web-wallpaper.js` 的
   `probeCaps`（帧内能力自证）。本轮真机读数是**客户端那半**在生效；服务端那半由无浏览器门禁
   （H7 断言注入体里有 `probeCaps`）+ 路由契约断言覆盖。重启后 `③-2c` 的那条 SKIP 会变成 PASS。
2. **headless Firefox 没有 WebGL**（本机实测 `getContext('webgl')` 恒 false，两档都一样）
   ⇒ Live2D/Pixi 类 web 档**无法做像素级验证**：③ 只能判"入口/shim/属性/能力/错误类别"，
   画面是否出画只能人眼看。作者脚本的 `Error` 两档都会出现（`console.errors=["Error"]`）。
3. **沙箱档能否出画取决于浏览器策略与作者实现**（blob-URL Worker / OffscreenCanvas 在不透明源下
   被挡）。本轮给的是**可判定的降级**（策略类错误 ⇒ 一次性切兼容档 + 人话提示 + 可查状态），
   不是"让沙箱档一定能跑"。
4. **交互音分类判不准时默认保留**（宁可清单里多一条，也不擅自丢用户的声音）；非常规预览名的包
   取不到预览图（显示类型占位，不显示破图）。
5. **`mpw-scene-fallback` 只有"结果"没有"原因"**（审计第 7 条）：本轮补的是我们新加路径的
   `mpwTrace`/diag 留痕；回退链自身的原因仍要看 `scene-wd` 诊断块（未改）。
6. **真机"切页时间歇出声"只做了机制级复现**：探针用"`document.hidden=true` 且 `powPaused=false`"
   这一现场形态 + 三条重试路径采样（`plays 0→0`）+ `__mpwNpOps` 轨迹判定；
   真实浏览器节流时序（1s/1min 级）无法在 headless 里 1:1 复刻 ⇒ 未做"长时间切页挂机"的采样。
7. **`powPauseHidden` 的迁移**对"改动前就显式关过、但没有标记"的存量用户会改成 `true`
   （历史标记缺失，无法区分"用户关的"与"旧默认带下来的"）—— 与 `bsCompat` 迁移同一取舍；
   用户可在面板里显式关掉，之后不再迁移。
8. **容器档（`custommpkg|*.mpkg`）的音轨清单**：容器名不是目录，`npAudioScope` 如实返回 `null`
   （旧写法拿它当 `folder` 去扫只会得到 500，清单本来就是 0 条 ⇒ 不构成回归）。
   容器内音频要接上需要一条"按容器扫音轨"的宿主路由（本轮未加，属新增路由）。

---

## 11. 开关与覆盖一览（用户可操作的）

| 开关 / 参数 | 默认 | 作用 |
| --- | --- | --- |
| 「省电·页面隐藏/切页暂停」（`powPauseHidden`） | **true**（本轮改；未设过的存量档自动迁移） | hidden 时暂停+静音我们与帧内能控的音频；**并拦住我们自己的起播/重试**；回到可见按原状态续播 |
| `?hiddengate=legacy` | 不写 = 闸门生效 | **整族隐藏闸门回旧行为**（后台挂载/冻结/切页时不再拦我们的起播与重试）；A/B 与线上救急；判据见 §6.4.4 G 组 |
| 「播放/暂停同时控制壁纸」（`npLinkWallpaper`） | true | 关＝卡片只控自己的音频（副标题如实说明）；**关的那一刻不碰壁纸**；再开按卡片状态对齐 |
| `?npvoice=keep \| drop` | 不写 = auto | auto：判为交互音的排除、判不准的保留；`drop`：判不准的也排除；`keep`：一条都不排除 |
| 无声源时的行为 | — | 层隐藏 + 面板人话 + `data-mpw-bg-error` / `window.__mpwBgArmError`（绝不把错误页当壁纸） |

---

## 12. 门禁自身：`check.sh` 第 2 步 `exit=1` 的根因 —— 无浏览器桩的「世界隔离」（2026-09-25）

### 12.1 症状：同一个脚本、同一个 cwd，单独跑绿、进门禁红

`bash tools/check.sh` 当时 `exit=1`（日志 `/tmp/plugin-check-3139.log`，末行「存在失败项 ✗」）。两个读数：

| 跑法 | 读数 |
| --- | --- |
| `node tools/np-control-test.mjs`（单独） | `结果: 106 通过, 0 失败` |
| 同一文件在 `check.sh` 第 2 步里 | `结果: 105 通过, 1 失败` —— `V4 曲目档 prev 两次 ⇒ 从 2/6 回到 6/6（环形）…且壁纸媒体零变化  — idx=5 video.src=null plays=0→1 pauses=0→0` |

> **先纠一条读日志的坑**：`/tmp/plugin-check-3139.log:86-92` 那七行 `✗ B1/B2/B2b/B3/B3b/B4/B4b`
> （`[行数=0 期望=10]`、`[分组按钮=0]`、`[开关=0 range=0 color=0 text=0 combo=0]`、`[propEdits={}]`）
> **不是基线**，是 `props-panel-wiring-test.mjs` 的 **M1 变异**（"把默认展开改回旧行为"）**预期要红**的读数：
> 紧跟其后的 `:94 ✓ M1 必红（期望 B1）` 就是这条变异的记分；基线在 `:44-64`，`:66 基线：18/18 通过`。
> 真正让门禁红的只有一处：`:1306 ✗ V4`（`:1373 结果: 105 通过, 1 失败`）。**怀疑对象（props）是假线索，
> 真凶在 np-control-test 的 V 组。**

### 12.2 根因：桩的"世界模型"缺了 teardown —— 旧世界的定时器打到新世界的 DOM 上

`tools/_stub.mjs` 的一次 `loadPlugin()` = 一个**世界**：新 `document`、新 `localStorage`、一份独立求值的
`lib/client.js`（各自一套模块级状态）。真浏览器里"换页/重载"会连旧页的定时器一起带走；桩里只换全局对象，
**旧世界的 setTimeout 回调还活着**，触发时读到的是**新世界**的全局：

| 通道 | 位置 | 后果 |
| --- | --- | --- |
| `bgElements()` 走全局 `document` | `lib/client.js:3103-3111` | 旧世界拿到的是**新世界**的 `#mpw-bgWrap` / `#mpw-bgVideo` |
| `readSection()` 是**模块级** `sectionCache` | `lib/client.js:673-685` | 旧世界仍按**自己**的 `image/mpkgKey` 判定（不会读到新世界的档位） |
| `mpwBgArmedNow()` mp4 档 = "有 src 才算挂上" | `lib/client.js:6374-6385`（mp4 在 `:6382`） | 新世界那枚刚建好、还没 src 的 `<video>` ⇒ 判成"有源但没挂上" |
| 补挂校验：快判 1.2s / 慢判 12s | `lib/client.js:6444-6462`，判定 `:6464-6497` | 到点就 `applyFromStorageInner()`（**旧档位**）⇒ `showVideoEl` ⇒ `video.play()` |

**门禁日志里的现场（`:1300-1306`，逐行对得上）**：

```
:1302  [dsh-mpkg-wallpaper] 检测到有壁纸源但媒体未挂上 → 补一次: host:?custom=1&folder=3582362359&file=Mid-Autumn%20Hoshino.mp4|custom|3582362359   ← 旧世界那条 1.2s 快判，签名还是**旧档位**
:1303  [dsh-mpkg-wallpaper] hybrid 背景: mp4 /api/mpkg-wallpaper/custom-folder/3582362359/Mid-Autumn%20Hoshino.mp4                                  ← 旧档位被挂到新世界上
:1304  [dsh-mpkg-wallpaper] 壁纸状态 = direct（未设帧率/分辨率上限 → 直读原片）
:1305    ✓ V3 曲目档 next ⇒ …
:1306    ✗ V4 曲目档 prev 两次 ⇒ …  — idx=5 video.src=null plays=0→1 pauses=0→0                                              ← "零变化"被旧世界的补挂打破
```

`V4` 的两条主判据（下标环形到 6/6、`getAttribute("src")` 仍为空）**过了**，红的只有"play 次数零变化"——
正是旧世界补挂时那一次 `play()`。

**为什么"顺序/负载敏感"**：1.2s 的期限到点时，**当前是哪个世界**完全由墙钟决定。单独跑时 E→V 那几组
的 25ms `settle()` 加起来不到 1.2s（期限落在 V 之后）；门禁里机器更热/更慢，同样的代码路径就把期限落进了
V3/V4 之间。用诊断钩子（排程时记下 `globalThis.document`、触发时比对）把这条泄漏整个照了出来 ——
同一个进程里跨世界触发的定时器不止一条：

```
[PROBE] STALE TIMER: document changed since scheduling; ms=1200
    at mpwBgSrcHealSchedule (eval at loadPlugin (…/_stub.mjs), <anonymous>:6451:25)   ← §12.2 那条快判
    at applyFromStorage (…:6362) → applyInner (…:22810)
[PROBE] STALE TIMER … ms=249   at npReportAudio (…:5147) ← npApplyVolume (…:5115)
[PROBE] STALE TIMER … ms=2000  at npSysTimerSet (…:9489) ← npSystemMediaStart (…:9561)
[PROBE] STALE TIMER … ms=3500  ← mpwBootTimer（lib/client.js:615）
[PROBE] STALE TIMER … ms=0     at raf (…:14136) ← rAF 链（requestAnimationFrame → setTimeout(…,0) 自我续期）
```

把前奏按 6× 拉长（同一钩子，只放慢用例自己的 25ms `settle()`）后，**同一条泄漏**在
`node tools/np-control-test.mjs --no-mutations` 上一次打出 3 条红：`A13`（帧内 policy 少了 volume）、
`D4` / `D5c`（`plays=1`，联动关掉后画面仍被 play）—— 与 `V4` 同一根因，只是落点随墙钟漂移。
**这就是"环境/顺序依赖"的全貌：不是 env、不是 cwd、不是 `tools/probe-out/`、不是别人留下的磁盘状态，
而是同一个 node 进程里上一个"世界"没被关掉。**

### 12.3 修法：定时器按世界分表，换代即取消（生产代码零改动）

`tools/_stub.mjs`：

* 插件里这六个标识符**全是裸用法**（`setTimeout` 54 处 / `clearTimeout` 37 / `setInterval` 14 /
  `clearInterval` 18 / `requestAnimationFrame` 6 / `cancelAnimationFrame` 6；`window.` 前缀 **0** 处）
  ⇒ 把它们作为**参数**注入被求值的源码：`new Function('require','module','exports','setTimeout',…,src)`，
  每个世界一张表（`createWorldTimers()`）。
* `installStubs()` 在新世界开始时把上一世界**还没触发**的定时器全部 `clearTimeout`（= 旧页面随文档消失），
  并把取消条数记在 `world.retiredFromPrev` / `worldIsolationStats()` 上（判据可读）。
* **用例自己的** `sleep()`/`wait()` 走全局 `setTimeout`，不在表里、不会被取消 ⇒ 不会把等待挂死。
* `setInterval` 注入的仍是桩里那个恒不触发的实现（语义与改动前一字不差）。
* 逃生口 `loadPlugin({ isolateWorlds: false })`：只为对照/变异自证保留。

为什么这让它对顺序/环境不敏感：泄漏的**唯一通道**（旧世界的异步回调 → 新世界的全局 DOM）被切断；
剩下的差异只有墙钟，而墙钟不再能改变任何断言的结果。生产代码（`lib/client.js`）一行未改 ——
浏览器里"换页 ⇒ 旧页定时器消失"本来就是免费的，缺这一环的只有桩。

### 12.4 判据 + 变异自证

`tools/world-isolation-test.mjs`（已进 `check.sh` 第 2 步的**第一条**：先证明桩环境在位，再跑靠它的用例）：

| 判据 | 内容 | 隔离在位读数 |
| --- | --- | --- |
| L1 | 换代取消了上一世界未触发的定时器（不是"恰好还没到点"） | `retired=5`（快判 1.2s / 慢判 12s / boot / np 台账 / 系统媒体…） |
| L2 | 新世界的壁纸媒体零动作（play 0 次 / src 仍空 / 没被 pause） | `plays=0 pauses=0 src=null` |
| L3 | 没有**旧档位签名**（`3582362359` / `Mid-Autumn`）的补挂告警 | `旧签名告警=0` |
| L4 | 控制项：新世界**自己**的定时器照常触发（隔离 ≠ 停掉一切） | `ownTick=1 fired=3` |
| M | 变异 `--no-isolate`（= 把守卫去掉）子进程必红且**定点** | `exit=1 红=[L1,L2,L3] 绿=[L4]`，读数 `play=1` + `旧签名告警 1 条` |

**"去掉守卫 ⇒ 门禁必红"的实测**（把 `_stub.mjs:70` 的取消那一句短路成 `false &&`）：

```
$ node tools/world-isolation-test.mjs        # 守卫被去掉
  · 换代读数：取消上一世界定时器 0 条；新世界壁纸 play=1 src=null        ← V4 的同一条症状
  ✗ L1 retired=0   ✗ L2 plays=1   ✗ L3 旧签名告警=1   ✓ L4 ownTick=1
✗ 世界隔离判据失败：通过 3 / 失败 3      ⇒ check.sh 的 `|| fail=1` ⇒ 门禁红
```

### 12.5 `check.sh` 第 2 步的执行顺序结论（`hidden-gate-test.mjs` ↔ `props-panel-wiring-test.mjs`）

* 第 2 步的每个脚本都是**独立 node 进程**（`node tools/x.mjs || fail=1`）⇒ 进程之间**不共享**任何 JS
  全局/桩状态；`document.hidden`、`__mpwHiddenPlays`、`__mpwSectionTest` 这类桩只活在各自进程里。
* 跨进程唯一可能的耦合是磁盘。实测两者都不写共享目录：`props-panel-wiring-test.mjs` 只**读**语料
  `<ws>/allwallpaper/0917/*/project.json`，临时文件写在 `os.tmpdir()` 下且名字带 pid+随机
  （`mpw-props-test-<pid>-<rand>.js`）；`hidden-gate-test.mjs` 的变异只写自己 `mkdtemp` 出来的目录
  （`mut-<name>.js`）。**都不写 `tools/probe-out/`，都不碰 `~/.dsh*`。**
* 位置上也隔得最远：`hidden-gate-test.mjs` 是第 2 步的**最后一条**，`props-panel-wiring-test.mjs` 在**最前**
  （前面只多一条 `world-isolation-test.mjs`）。⇒ **顺序无关**，不需要为它们调整次序。
* 真正的"顺序依赖"不在进程之间，而在**进程内部的世界之间**（§12.2）；修在 `_stub.mjs` 里，
  所有用这个桩的用例一起受益。

### 12.6 诚实边界

1. 隔离覆盖的是**注入的那六个定时器标识符**（`setTimeout` / `clearTimeout` / `setInterval` /
   `clearInterval` / `requestAnimationFrame` / `cancelAnimationFrame` 的**裸用法**）。**没**覆盖
   `win.requestAnimationFrame(...)` 这条：`lib/client.js:14133-14136` 的 `raf()` 走的是
   `win.requestAnimationFrame`，而桩里 `globalThis.window === globalThis`（一个对象，只有属性被换代），
   所以旧世界的补间链会继续按**当前**世界的 rAF 续期（诊断钩子实测仍有 `ms=0` 的 STALE TIMER，
   栈为 `raf (…:14136) → step (…:14175)`）。它在两轮门禁里都**没有**造成任何红（形态是"卡片补间多跑几拍"），
   但属于同一类通道；要彻底关掉得给每个世界一个自己的 `window`（Proxy），代价与风险另算 —— 本轮未做。
2. 还没覆盖**微任务/Promise 链**（如 `fetch().then(...)`）：桩的 `fetch` 立即 resolve，实测无跨世界残留；
   真浏览器里也不存在"旧页面的 Promise 改新页面 DOM"这种形态。
3. `setInterval` 在桩里**本来就不触发**（全局被换成 `() => 0`），所以世界隔离对它没有额外作用，
   也没改这个既有语义。
4. 与本次修复**无关**的一条残留（写明，免得下次误判）：把**用例自身**的节奏人为拖慢到每拍 >60ms 时，
   D 组仍会红 —— `✗ D4 / D5c … plays=1`。它的栈是
   `npPrimePlay (…:5180) ← applyNowPlaying (…:9685) ← setTimeout(…,60) (…:9460) ← 世界表`：
   `npTransport` 打完一次传输键后**自己**排的 60ms 重放会在窗口里起播一次（插件自己的起播预演），
   与"旧世界的定时器打到新世界"不是一回事 —— 这条在**修前**的同一实验里也是红的（当时是
   `A13 + D4 + D5c`，修后只剩 `D4 + D5c`）。正常节奏与两轮门禁实测都绿；本轮**没有**去动 D 组的断言。
5. 这条判据证明的是"旧世界的定时器不会落到新世界上"。它**不**证明断言的数值本身正确 ——
   各组的业务判据（V1..V4、B1..B5…）一条没放宽，仍是原来的口径。

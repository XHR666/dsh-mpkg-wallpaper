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
| 「播放/暂停同时控制壁纸」（`npLinkWallpaper`） | true | 关＝卡片只控自己的音频（副标题如实说明）；**关的那一刻不碰壁纸**；再开按卡片状态对齐 |
| `?npvoice=keep \| drop` | 不写 = auto | auto：判为交互音的排除、判不准的保留；`drop`：判不准的也排除；`keep`：一条都不排除 |
| 无声源时的行为 | — | 层隐藏 + 面板人话 + `data-mpw-bg-error` / `window.__mpwBgArmError`（绝不把错误页当壁纸） |

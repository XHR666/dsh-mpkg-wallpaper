# WEB-WALLPAPER —— 网页（web）类壁纸：类型判定、沙箱策略与 WE API shim

> 适用范围：`dsh-mpkg-wallpaper`（MIT，插件侧）对 Wallpaper Engine **web 类壁纸**的支持。
> 相关代码：`lib/web-wallpaper.js`（宿主侧：判定 + shim 源码 + HTML 注入 + 跨源策略 + **帧内合成事件派发** + 存储 facade + 主音量）、
> `lib/web-interaction.js`（父页侧：坐标换算 + 事件整形 + 交互模式状态机 + **触摸代理**；**交互语义的唯一源**）、
> `lib/index.js`（`/custom-folder`、`/library-web` 两条资源路由 + `/custom-dir` 扫描 + `/web-store`、`/media-audio` 两条状态路由）、
> `lib/client.js`（沙箱 iframe 挂载 + postMessage 控制通道 + 交互舞台 + 兜底）。
> 回归：`node tools/web-wallpaper-test.mjs`（已并入 `tools/check.sh` 第 5 步；含**宿主路由端到端**：真注入 / 无标记零回归 / CORS / `__mpw-list.json` / `/custom-dir` 内容优先扫描 / **`/web-store` + `/media-audio` + CSP 跳过 + 源级 URL 改写**）。
> 与交互注入的帧内合成（E13）、`node tools/web-interaction-test.mjs`（坐标换算 / 事件整形 / 开关状态机 / 沙箱边界 / 舞台契约 / 两侧源码对拍）。
> 本项**渲染器零改动**：`we-scene-demo/` 一行未动，网页壁纸不经过 WebGL/渲染器。
>
> **分工（①WP-1 / WP-2，2026-09-19，避免重复踩同一块地）**：
> **帧内**（`WEB_SHIM_SOURCE`，在 `lib/web-wallpaper.js`）负责"消息 → 合成 DOM 事件"的实际派发与帧内策略执行；
> **父页**（`lib/web-interaction.js`）负责坐标换算、事件整形、交互模式状态机与舞台；
> 触摸/点击代理（`op:'touch'` + `WEB_TOUCH_FRAME_SOURCE`）由 **WP-2** 负责，注入点是 `rewriteWebEntryHtml` 的注入串
> （shim → 种子 → 作者脚本，触摸源码插在 shim 之后）。
> **触摸是自研**：上游 `oneincase/webwallgl` 的 `web-shim.js`/`web.ts` 里 **0 处** touch 处理（只有 pointer/wheel），
> 所以没有可对照的上游语义，触摸协议由本仓库自定义（详见 `lib/web-interaction.js` 与 `docs/` 交互节）。

---

## 1. 为什么需要这一层

WE 的 web 类壁纸**不走 WebGL**：它就是一张网页，作者脚本在加载时调用 WE 的宿主 API：

```js
window.wallpaperPropertyListener = { applyUserProperties(p) { … }, setPaused(v) { … } };
window.wallpaperRegisterAudioListener((bands) => { … });      // 音频频谱
window.wallpaperRequestRandomFileForProperty('file', (n, p) => { … });  // slideshow
```

官方 CEF 宿主在**作者脚本之前**就把这些函数做成原生实现。插件此前只是把入口 HTML 塞进裸
iframe（`lib/client.js` 的 `showWebEl`）——没有任何 WE API，于是所有依赖属性/音频/媒体回调的
网页壁纸只能显示静态外壳。本层补的就是：**沙箱 iframe + 在作者脚本之前注入 shim + 控制通道**。

---

## 2. 类型判定（内容优先，声明只作线索）

判定实现在 `lib/web-wallpaper.js` 的 `detectWebWallpaperKind` / `detectWallpaperDir`；
`lib/index.js` 的 `/custom-dir` 扫描直接调用它（**不再**先信 `project.json` 的 `general.type`）。

四态：`web` / `scene` / `video` / `unknown`。判定顺序（首个命中即返回，顺序本身即规格）：

| # | 条件（按内容） | 结果 | `reason` |
|---|---|---|---|
| 1 | 声明 `application` / `exe` / `app` | `unknown`（**绝不放行**） | `excluded-application` |
| 2 | 有 `scene.pkg` / `scene.json` / `*.pkg` / `*.mpkg` | `scene` | `scene-container` / `scene-json` |
| 3 | 声明 `video` 且目录里真有视频文件 | `video` | `declared-video` |
| 4 | 有 HTML 入口：`general.file` 指向的 html > 根 `index.html`/`index.htm`/`index.xhtml` > 最浅的 html | `web` | `declared-html` / `html-entry` |
| 5 | 有视频文件（`mp4/webm/mov/m4v/mkv`；多个候选取体积最大） | `video` | `video-file` |
| 6 | 只剩声明、内容一条都对不上 | `unknown` | `declared-unmatched` |
| 7 | 什么都没有 | `unknown` | `no-files` / `no-content` |

**「声明与内容不符」是这套判定的主要目的**（既有教训：只信 `project.json` 会被骗）：

| 用例 | 声明 | 目录内容 | 判定 | `mismatch` |
|---|---|---|---|---|
| 谎报 web 的场景包 | `type: "web"` | `scene.pkg` + `preview.jpg` | `scene` | ✅ true |
| 谎报 scene 的网页 | `type: "scene"`，`file: "scene.pkg"` | 只有 `index.html` | `web` | ✅ true |
| 谎报 video | `type: "video"`，`file` 缺失 | 只有 `index.html` | `web` | ✅ true |
| 声明 web 但空壳 | `type: "web"` | 无 html/scene/视频 | `unknown` | ✅ true |
| html + mp4 并存 | `type: "video"` | `index.html` + `bg.mp4` | `video`（信声明） | false |
| html + mp4 并存 | 无 `project.json` | 同上 | `web`（html 是入口） | false |

`mismatch` 只作诊断/日志用（`/custom-dir` 返回项的 `kindReason`、`declaredType` 字段），
不改变挂载行为——挂载永远按 `kind` 走。

---

## 3. iframe 与 sandbox 策略

| 通道 | 何时使用 | `sandbox` 属性 | 帧的源 | 后果 |
|---|---|---|---|---|
| **网页 shim（默认）** | 入口 URL 带 `?mpwshim=1`（插件对网页壁纸默认加） | `allow-scripts` | **不透明源**（opaque origin） | 作者脚本读不到宿主 DOM / `localStorage`；父页也读不到帧内 DOM（静音/倍速/暂停由 shim 在帧内执行）。**①(WP-1)** 帧内 `localStorage`/`sessionStorage` 由 shim 给 facade（内存 + 宿主 `/web-store` 持久化，见 §5.4）——**这不是放宽 sandbox**：facade 读写的是"这张壁纸自己的键值"，宿主按 wallId 隔离 |
| **兼容模式** | 用户在确认弹窗选「兼容模式（同源）」 | `allow-scripts allow-same-origin allow-pointer-lock` | 与宿主同源（等价于改动前的裸 iframe） | Live2D 类壁纸的「网页壁纸选项」（写 iframe 同源 `localStorage`）可用；代价是作者脚本与 DSH 界面同源。**此档不注入 shim** ⇒ 作者直接用浏览器真 storage（facade 只在真 storage 不可用时才装，见 §5.4） |
| 场景渲染器（不在本项范围） | 渲染器 `:8899` URL（`sandbox=strict` 与否） | `allow-scripts allow-pointer-lock` / 旧档 | 渲染器自己的源 | 见 `../docs/COPYING-RULES.md` 与 B6 契约 |

### 3.1 为什么 `allow-scripts` 必须保留、`allow-same-origin` 必须去掉

- **`allow-scripts` 必须保留**：网页壁纸的全部内容都是 JS 驱动的（`<script>`、`requestAnimationFrame`、
  动态创建 `<video>`）。去掉它页面只剩静态 HTML，等于不支持这类壁纸。它是「最小必要集」里唯一的必需项。
- **`allow-same-origin` 必须去掉**：入口 HTML 由**插件宿主自己的路由**提供（`/api/mpkg-wallpaper/custom-folder/…`），
  与 DSH 界面**同源同端口**。`allow-scripts + allow-same-origin` 的组合等于让壁纸脚本拿到宿主页面的
  完整权限：读 DSH 的 DOM（聊天内容、输入框）、读写同源 `localStorage`、并且可以**摘掉自己的
  sandbox 属性**（规范明确警告该组合不安全）。没有 `allow-same-origin` 时文档处于不透明源：
  `parent.document`、`frame.contentDocument`、`localStorage`、`indexedDB`、`document.cookie` 一律不可达。
- 其余项一律不给：`allow-popups` / `allow-top-navigation` / `allow-forms` / `allow-modals` /
  `allow-downloads` / `allow-storage-access-by-user-activation` 都不需要（回归里有逐项断言）。
- 源码守卫：`tools/web-wallpaper-test.mjs` 断言 `WEB_SANDBOX_ATTR === "allow-scripts"`、
  不含 `allow-same-origin` 及任何额外放行项，且 `lib/client.js` 里的字面量与宿主模块一致。

### 3.2 不透明源带来的两个技术后果（都已处理）

1. **父页读不到帧内 DOM**：改动前靠 `frame.contentDocument` 做的静音/倍速/暂停/隐藏面板全部失效。
   静音、倍速、暂停改为**在帧内执行**（shim 扫 `audio,video` + `MutationObserver` + `play` 捕获监听），
   父页只下达策略（`postMessage`，见 §5）。`hideWebPanel` / `webMediaObserve` 在不透明源下静默跳过
   （各有 `doc` 守卫），不会报错。
2. **帧内 `fetch()` 变成跨源**：不透明源发出的请求 `Origin: null`，同源策略下响应会被拒绝。
   宿主对**恰好是 `Origin: null`** 的壁纸资源请求回 `access-control-allow-origin: null`（`webAssetCorsHeaders`）；
   真实站点（任何带自己 Origin 的网页）拿不到该响应头，因此读不到本机壁纸文件。普通
   `<script>/<img>/<video>` 子资源不需要 CORS，照旧可用。

### 3.3 跨源 / 协议限制（写清楚，免得当成 bug）

- 沙箱帧**不能**发同源带凭据请求（DSH 会话 cookie 不会被带上，这是有意的）。
- 沙箱帧**不能**读宿主 `localStorage`，宿主也**不能**读帧内 `localStorage`（→ 兼容模式存在的原因）。
- 沙箱帧与父页只走 `postMessage`（协议见 §5），`window.parent` 之外无任何桥。
- 帧内导航到壁纸目录之外（外链页面）仍是允许的（作者可能引外网 SDK，`webExternal` 预检会提示），
  但那样就脱离了本插件的 shim 覆盖范围（新文档由对方站点提供，shim 不会二次注入）。

---

## 4. shim 注入：位置与顺序

宿主在 `/custom-folder/<目录>/<文件>` 与 `/library-web/<ltoken>/<文件>` 两条路由上，对
**`.html/.htm/.xhtml` 且带 `?mpwshim=1`** 的请求改写响应体：

```
<head>                                  ← 插到 <head> 开始标签之后
  <script data-mpw-we-shim="1"> …shim… </script>        ← ① 先
  <script data-mpw-we-shim-seed="1"> window.__mpwWebSeed=… </script>   ← ② 再（策略/入口信息）
  …作者原有的 <meta>/<link>/<script>…    ← ③ 最后（作者脚本一定在 shim 之后）
```

- **幂等**：HTML 里已含 `data-mpw-we-shim` 则原样返回（重复请求不会叠两份）。
- **无 `<head>`**：在 `<html>` 后自造 `<head>`；**残缺 HTML**（无 `<html>`）：整段包裹。
- **转义**：shim / 种子脚本里的 `</script>` 一律转义成 `<\/script>`，不会提前闭合宿主标签。
- **不做 `<base>` 注入**：入口用**路径式** URL（`/custom-folder/<目录>/index.html`），
  相对资源（`./assets/a.js`）天然按同目录解析；查询串只挂在入口请求上。
- **超限跳过**：入口 HTML > 8MB 时原样返回（不把大文件读进内存；这类入口极罕见）。
- **失败回退**：注入过程抛错只记 `console.warn` 并原样返回文件，绝不 500（壁纸不能白屏）。
- 无标记（旧 URL / 兼容模式）的请求**一个字节都不变** ⇒ 旧行为零回归。

---

## 5. shim API 表（`window.*`）与控制协议

### 5.1 对作者脚本暴露的 WE API

| API | 形态 | 说明 / 与官方的差异 |
|---|---|---|
| `wallpaperPropertyListener` | getter/setter | 赋值只登记，回调**延后到微任务**再发（官方不在赋值当下回调；同步回调会重入作者渲染函数，React 类壁纸会熔断成白屏）。重复赋值不重放，避免「赋值→回调→再赋值」自激 |
| `wallpaperRegisterAudioListener` | `(cb)=>void` | 父页推来的频谱数组；**暂停期间不下发**（对齐官方"冻结渲染进程"语义） |
| `wallpaperRegisterMediaPropertiesListener` | `(cb)=>void` | 曲目信息；**晚注册回放最近一帧** |
| `wallpaperRegisterMediaThumbnailListener` | `(cb)=>void` | 封面缩略图 + 主色调 |
| `wallpaperRegisterMediaPlaybackListener` | `(cb)=>void` | 播放状态（0/1/2，见 `wallpaperMediaIntegration`） |
| `wallpaperRegisterMediaTimelineListener` | `(cb)=>void` | 进度（position/duration） |
| `wallpaperRegisterMediaStatusListener` | `(cb)=>void` | 媒体会话是否可用 |
| `wallpaperRequestRandomFileForProperty` | `(prop, cb)=>void` | slideshow 随机文件；**池为空时回调空串**（作者侧普遍 `if (p)` 守卫） |
| `wallpaperMediaIntegration` | 对象 | `PLAYBACK_STOPPED=0 / PLAYBACK_PLAYING=1 / PLAYBACK_PAUSED=2`（缺省会让 `PLAYING \|\| 0` 把"播放"误判成 0） |
| `wallpaperPluginListener` | 对象 | `{ onPluginLoaded(){} }` 空实现（iCUE 类硬件灯效；避免作者 `if` 判断崩） |
| `localStorage` / `sessionStorage`（**宿主提供的 facade**） | 对象 | **①(WP-1)** 不透明源下浏览器对这两个属性的**访问**就抛 `SecurityError`（不是返回 null）⇒ 作者脚本一句 `localStorage.getItem()` 就把初始化打断。真 storage 可用时**一个字节都不动**；不可用时才装 facade：同步内存语义 + 宿主 `/web-store` 异步落盘（§5.4）、条数/单值/总字节三重上限（超限抛 `QuotaExceededError`，与真 Storage 同形）。`?mpwstore=0` 关（退回"访问即抛"的旧行为），`?mpwstore=mem` 只内存不落盘 |

另外实现两个**非 WE 官方**的内部钩子：`window.__mpwRewriteFileUrl`（文件 URL 改写，见 §6）、
`window.__mpwWebControl`（控制面入口，与 `postMessage` 同一条处理路径）、
`window.__mpwWebStore`（**①WP-1**：存储 facade 的诊断面 `{installed, persist, session, disabled, snapshot(), flush()}`）、
`window.__mpwWebAudio`（**①WP-1**：主音量诊断面 `{master(), set(v), hooked()}`）。

**不提供 `$media*`**：`$mediaThumbnail` / `$mediaProperties` 等是**场景脚本**（scene 的 `script.js`）
的接口；网页壁纸没有这套全局对象，官方 web 宿主也只给上面的 `wallpaperRegisterMedia*Listener` 回调形态。

### 5.2 父页 → 帧内控制协议（`postMessage`，`{ mpw: "mpw:web", op }`）

| `op` | 载荷 | 作用 |
|---|---|---|
| `props` | `props: {name:{value}}` | 合并进属性表并回调 `applyUserProperties`（全量快照） |
| `general` | `general: {fps}` | 回调 `applyGeneralProperties` |
| `pause` | `value: boolean` | 回调 `setPaused` + 冻结/解冻帧内 media |
| `policy` | `muted, speed`（**①WP-1 新增** `volume`） | 帧内静音 / 倍速 / **主音量**（沙箱下父页读不到帧内 DOM，只能这样下达）。`volume` **不传 = 完全不接管**作者音量（连原型钩子都不装，默认路径零回归） |
| `audio` | `bands: number[]` | 转交 `wallpaperRegisterAudioListener`（暂停期间丢弃） |
| `media` | `payload: {op,…}` | 转交对应媒体监听器 |
| `directory` / `directory-remove` | `prop, files[]` | 维护 slideshow 文件池并回调 `userDirectoryFilesAddedOrChanged` / `…Removed` |
| `ping` | — | 握手：回 `pong` |
| `pointer` | `x,y,inside,buttons,mods` | 交互注入：按命中元素合成 pointer/mouse 事件（`button:-1` 哨兵） |
| `wheel` | `x,y,dx,dy,mode,mods` | 交互注入：同时发现代 `wheel` 与 legacy `mousewheel`（wheelDelta 与 deltaY 反号） |
| `key` | `down,key,code,keyCode,mods,text,repeat,composing` | 交互注入：键盘 +（可输入元素上）文本输入 |
| `blur` | — | 失焦/离开：补一次 up + 完整 leave 链（作者 hover/按下态复位） |
| `interact` | `on` | 交互模式开关（诊断/复位用；事件是否注入由父页决定） |

帧内 → 父页：`ready`（shim 装好即报到）、`pong`、`load`、`error`（作者脚本异常：`kind` + `message` + `stack`）。
父页只接受 `ev.source === frame.contentWindow` 的消息（任意页面不能控制壁纸）；帧内只接受父窗口消息。

### 5.3 与既有插件能力的接线（复用，未新造轮子）

| 插件已有能力 | 接到 shim 的方式 |
|---|---|
| 「静音」开关 / 「视频倍速」 | URL 查询串（`mpwmute` / `mpwspeed`）→ 首帧即生效；改动经 `policy` 下发 |
| 「暂停壁纸」/ 省电三档 | `pause`（`pauseWebFrame`/`resumeWebFrame` 同时保留同源路径的旧行为） |
| 「可调参数」（`propEdits`） | 挂载时下发 `project.json` 的 `general.properties` 全量默认值 + 该壁纸已保存的编辑；编辑时增量下发（`setProp`） |
| 本地库/自定义目录扫描 | 条目仍带 `type: "web"`，但类型由 `detectWallpaperDir` 按内容给出；`webHeavy` / `webExternal` 预检保留 |
| 目录清单（新增虚拟文件） | `__mpw-list.json`：该壁纸目录内的媒体文件表 → slideshow 池 |

音频频谱（`audio`）目前**没有数据源**：插件没有"把当前壁纸音频解码成频谱"的能力（场景侧只有音轨
扫描，不是实时频谱）。shim 通道已打通，接上真实频谱源即可用；当前作者调用
`wallpaperRegisterAudioListener` 不会收到数据（不报错、不崩）。

### 5.4 ①(WP-1) 帧内存储 facade + 宿主 `/web-store` 契约

```
作者脚本         帧内 facade（shim）                     宿主路由
localStorage.getItem(k)   ← 同步读内存（首帧由种子回灌）
localStorage.setItem(k,v) → 内存立即生效 → 400ms debounce → POST /api/mpkg-wallpaper/web-store
                                                            body: {w:<wallId>, k, v} 或 {w, del:k}
                                                            正文 text/plain（CORS 简单请求，不触发预检）
```

| 项 | 契约 |
|---|---|
| 谁提供 | **shim 装 facade** 只在"真 `localStorage` 不可用"（不透明源 ⇒ 访问抛 `SecurityError`）时；真能用就一个字节都不动（同源测试台/兼容模式） |
| 隔离 | `w` = `sha1(label + 目录键 + 入口相对路径)` 前 12 位（`webWallId`）；**不含绝对路径**，不同壁纸互不可见（K8 断言） |
| 上限 | 单值 ≤ 4096 字符、单壁纸 ≤ 64 键 / 64 KiB、宿主最多保留 64 张壁纸（最旧淘汰）。超限时帧内抛 `QuotaExceededError`（与真 Storage 同形），宿主再拒一次（`{ok:false,error:"too large"}`） |
| 持久化时机 | 写入 400ms debounce 后异步落盘到 `DATA_DIR/web-store.json`；**内存是权威**（落盘失败只 warn，不回灌作者） |
| 首帧可用 | 宿主服务入口 HTML 时把该 wallId 的已存快照塞进种子脚本 `store.snap` ⇒ 作者首帧 `getItem` 就能命中（K9 断言） |
| 关闭 | `?mpwstore=0`：种子写 `store:false`、**不带 wall**、帧内不装 facade（= 改动前"访问即抛"的行为）；`?mpwstore=mem`：装 facade 但不落盘 |
| 安全边界 | 不放宽 sandbox（仍 `allow-scripts`）；facade 读写的是壁纸自己的键值，够不到宿主 `localStorage`/DSH 界面；键名不含宿主路径 |

---

## 6. 文件 URL 改写

官方 CEF 以文件系统为源，作者常写 `'file:///' + value`（`file:///files/x.png`）。在 HTTP 路由下
这些 URL 必然 404，所以 shim 在以下位置改写：

- `Element.prototype.setAttribute`（`src` / `href` / `poster`）
- `HTMLImageElement` / `HTMLMediaElement` / `HTMLSourceElement` / `HTMLScriptElement` 的 `src` setter
- `CSSStyleDeclaration.prototype.setProperty` 与 `HTMLElement.prototype.style`（`background*` 走 Proxy）

**①(WP-1) 宿主的源级改写**（补运行时钩子够不到的形态）：`rewriteWebEntryHtml` 在注入前对 HTML 文本做一次
`rewriteWebFileUrlsInHtml` —— 只改 `src|href|poster="file:///…"` 与 `url(file:///…)` 两类（**不碰 `<script>` 文本**，
作者 `'file:///'+v` 的合成仍由运行时钩子在赋值处完成），解析出的路径是**路由前缀 + 相对段**（绝对路径比相对路径稳，
不怕作者自带的 `<base>`）。无 `mpwshim` 标记的请求这一步不发生（K12 断言逐字节原样）。

规则：`file:///相对段` → 按文档 URL 解析成同目录 HTTP URL；**绝对系统路径**
（形如 `Users/`、`home/`、`tmp/`、`storage/`、`sdcard/` 开头，或 `C:` 盘符）无法映射 → 运行时钩子返回**空串**、
源级改写**保留原值**（作者侧通常有守卫，胜过给出一个必然 404 的地址）；非 `file:` URL 一律原样放行。

**①(WP-1) 解析基准改用 `location.href` 优先、`baseURI` 兜底**：作者若写了 `<base href="file:///C:/…">`，
`baseURI` 就是 `file:` 协议，用它解析出来的还是 `file:` URL（必然加载失败）；`location.href` 在两条壁纸路由下
都是 `http(s)`，稳（作者自带 `file:` base 同时还会被源级改写纠正）。

---

## 7. 作者脚本抛错不许拖垮插件（错误边界）

| 位置 | 行为 |
|---|---|
| 作者的 listener/timeline 回调抛错 | shim `try/catch` 吞掉 → `postMessage {op:"error", kind:"listener"}`（**不向作者栈外再抛**） |
| 作者脚本全局未捕获异常 | shim 以捕获阶段监听 `error`，上报 `{op:"error", kind:"error"}`；**资源加载失败不报**（否则刷屏） |
| 未捕获 Promise 拒绝 | 上报 `{op:"error", kind:"rejection"}` |
| 错误上报洪泛 | 帧内预算 50 条，超出静默（不把父页日志/网络打爆） |
| 父页侧处理 | `console.warn` + `POST /diag {kind:"web-wallpaper", why:"script-error"}`；**不弹错误框、不改壁纸状态** |
| shim 自身安装失败 | 整个 IIFE 体在 `try` 之外的最小逻辑里运行，安装标记幂等；最坏情况退化为"没有 WE API 的裸页面"，插件主流程不受影响 |
| shim 未按时报到（2.5s） | 记 `shim-missing` 诊断 + **一次性**去掉 `mpwshim` 重载为兼容模式（旧宿主 / 页面 CSP 挡 inline script 的兜底），绝不白屏 |
| **①(WP-1)** 入口自带 CSP 挡 inline script | 宿主**先判、不注入**（`hasBlockingCsp`，判定照抄上游，见 `THIRD-PARTY.md` §5）→ 原样返回 + 响应头 `x-mpw-shim-skipped: csp` 留痕。避免"注入了但被浏览器拒绝"这种半吊子状态；客户端 2.5s 兜底照旧接管 |

---

## 8. 与渲染器（GPL-3.0-or-later）的边界关系

- 本项**全部在 MIT 插件侧**：`lib/web-wallpaper.js` + `lib/index.js` 路由 + `lib/client.js` 挂载，
  **没有** import / 内嵌 / 转译渲染器任何代码，也没有改 `we-scene-demo/` 一个文件。
- 两侧交互仍只走 HTTP 协议（本项只用到插件宿主自己的 `/custom-folder`、`/library-web`、`/diag`，
  渲染器完全不参与网页壁纸）。协议形状不受版权保护、实现各写各的（`../docs/COPYING-RULES.md` §3）。
- 网页壁纸不占 WebGL 上下文，与场景壁纸不会互相抢 GPU；两者共用一个 `<iframe>` 元素，
  切换时按 URL 重设 `sandbox` 属性（浏览器在**导航时**读取）。

## 9. 参考实现与许可

- 参考：`oneincase/webwallgl`（**MIT**，commit `b61e8910ae0a176288aed99ce9a93a13ea07df57`），
  仅研读其 `renderer/src/web-shim.js`、`renderer/src/web.ts`、`renderer/src/web-rewrite.ts` 的
  **API 名单与语义**（web 壁纸走 sandbox iframe + 作者脚本前注入 WE shim + 音频/属性泵）。
- **①(WP-1) 例外：一处照抄**（用户明确许可“协议是允许的，你要借鉴多少就自己想吧”，上游 MIT）：
  `renderer/src/web-rewrite.ts:26-43` 的 `hasBlockingCsp` 逐行照抄（页面自带 CSP 是否挡 inline shim
  的判定），落点 = `lib/web-wallpaper.js` 的同名导出；**未 vendored**（不是整文件副本，是一个函数）。
  其余仍为本仓库自写：状态机、时序策略、URL 改写、控制协议、存储 facade、主音量实现与错误边界，
  差异见 §10。逐行出处 / 许可正文 / “这份代码是照抄”的免责声明 = `THIRD-PARTY.md` §5。
- API 名称属接口（不受版权保护），API 语义来自 WE 官方文档与公开行为。
- 台账：`../docs/COPYING-RULES.md` §4 第 7 条（研读对照）+ **第 11 条（照抄 `hasBlockingCsp`）/ 第 12 条（音量契约对齐）**；
  包内声明：`THIRD-PARTY.md` §2（研读）与 §5（照抄）。
- 明确未借用任何 GPL-2.0-only 项目（`Aromatic05/wallpaper-engine-renderer`、
  `waywallen/open-wallpaper-engine`、`catsout/wallpaper-scene-renderer`）；
  `tools/web-wallpaper-test.mjs` 有机器断言（注释剥离后 grep 派生标识符 + 无 GPL 许可文本）。

## 10. 与参考实现的差异清单（机器断言，见测试 D4/D5）

**参考覆盖、本实现也覆盖**：上表 §5.1 的 10 项 API 全部覆盖。

**①(WP-1) 照抄的部分（MIT 允许，已登记）**：

| 照抄项 | 上游出处 | 我们的落点 |
|---|---|---|
| `hasBlockingCsp`（页面 CSP 是否挡 inline shim 的判定） | `renderer/src/web-rewrite.ts:26-43` | `lib/web-wallpaper.js` 的同名导出 |
| 逐行出处、许可正文与“这份代码是照抄”的免责声明 | —— | `THIRD-PARTY.md` §5；台账 `../docs/COPYING-RULES.md` §4 第 11 条（照抄）/ 第 12 条（音量契约对齐） |

**参考实现有、本实现已对齐语义的非 API 能力**（逐项对照见 §11 与 §14）：

- 合成指针/滚轮/键盘事件注入（按命中元素派发 + click 边缘合成 + button:-1 哨兵）
- 指针离开补 out/leave 链 + 补一次 up（作者 hover/按下态复位）
- 滚轮同时发现代 wheel 与 legacy mousewheel（wheelDelta 与 deltaY 反号）
- **①(WP-1) 媒体音量覆写**：`volume`/`muted` 原型钩子 + 主音量，实机口径 = 作者值 × 宿主音量
  （上游 `web-shim.js:493-583` 的 `applyMediaVolume`/`__weSetVolume`；我们把“宿主音量”接到 §13 的 `/media-audio`）
- **①(WP-1) CSP 阻塞检测与退回**：命中 ⇒ 不注入 + 留痕（上游是 fetch 后判 CSP 再退回裸 src）

**仍不做**：合成事件点亮 CSS :hover / :active（合成事件固有边界，非实现缺陷）——
`:hover` 由浏览器自己的 hit-test 驱动，任何合成事件都不会点亮它；需要 hover 视觉的壁纸
在交互模式下依然会“指针到了但样式不变”，这是本方案的已知边界（见 §11.4）。

**参考有、本实现有意不做**（每条都有理由，不是漏做）：

| 差异项 | 为什么不做的 |
|---|---|
| `setTimeout/setInterval 冻结（暂停语义）` | 插件暂停语义只需“停住画面”：`pause` 已冻结帧内 media 与作者 `setPaused` 回调；改写 `window.setTimeout` 会污染作者计时器语义与我们的错误面 |
| `rAF 挂起与恢复（自递归主循环补跑）` | 同上；网页壁纸的 rAF 由浏览器按帧率节流，插件不接管（接管需精确补跑，风险大于收益） |
| `<base href>` 注入（上游走 blob URL 才需要；我们入口是路径式 URL，作者自带 file: base 由源级改写纠正） | 本实现入口是**路径式** URL（`/custom-folder/<名>/index.html`），相对资源天然按同目录解析，不需要 base；作者自带的 `file:` base 由**源级改写**纠正（§6） |
| `wallpaperPropertyListener 的 whenPageReady 时序` | 本实现改为“属性表 + 首赋值后微任务 flush”，语义更简单（晚挂 listener 也能拿到全量快照），不需要等 `load` |

**本实现独有**（架构不同导致）：`__mpwWebSeed 种子脚本`（首帧策略，免等 postMessage）、
`postMessage 控制通道（op 白名单）`（沙箱帧下父页唯一可达路径）、
`作者脚本错误上报（error/unhandledrejection）`（带 50 条预算的帧内错误边界）、
**①(WP-1)** `帧内 localStorage/sessionStorage facade（不透明源下真 storage 抛 SecurityError；宿主 /web-store 持久化）`、
**①(WP-1)** `宿主 /media-audio 音量·静音·播放控制 + audible 上报（网页壁纸帧与 video 壁纸共用一套口径）`、
**①(WP-1)** `HTML 源级 file:/// 改写（解析器直接产出的属性，运行时钩子覆盖不到的形态）`。

---

## 11. 交互操作（第 11 条）：让作者的交互脚本真正工作

### 11.1 问题真因（不是"沙箱拦住了"，也不是"缺 API"）

三件事同时成立，缺一件都不会有反应（都有代码/实验证据）：

1. **壁纸层不吃指针**：`.mpw-bgWrap` 是 `inset:0; z-index:-1; pointer-events:none` 的背景层
   （`lib/client.js` 的 CSS），指针事件**穿过它**落到 DSH 界面上 → 作者的 `pointermove` 永远不来。
2. **帧是不透明源**：shim 通道的 `sandbox="allow-scripts"`（§3）⇒ 父页 `frame.contentDocument`
   不可达，**没有**任何"父页代派事件"的可能（只能靠 `postMessage` 让帧内自己派发）。
3. **事件不是"状态"**：场景侧可以用"写一个指针状态、渲染器每帧读"（`window.__mpwPointer`），
   网页壁纸的作者代码是**监听 DOM 事件**的 → 必须把父页事件还原成一串**合成 DOM 事件**，
   而且必须按 `elementFromPoint` 的命中元素派发（作者有挂 `canvas` 读 `offsetX` 的、
   有挂 `document` 靠冒泡的、有靠 `mouseenter` 启动动画的）。

### 11.2 方案

```
宿主舞台（.mpw-webInteract，仅交互模式显示）
  pointermove/down/up/cancel、touchstart/move/end/cancel、wheel、keydown/up、blur  →  lib/web-interaction.js 整形
  →  窗口坐标 → iframe 内 client 像素（含祖先缩放，见 clientPointInFrame；指针与触摸**同一口径**）
  →  frame.contentWindow.postMessage({mpw:"mpw:web", op:"pointer"|"touch"|"wheel"|"key"|"blur"})
  →  帧内 shim：elementFromPoint 命中派发 + over/out/enter/leave 链 + click 由 down/up 边缘合成
               +（①WP-2）op:"touch" → 帧内触摸代理 W.__mpwTouchPush 派发**真 TouchEvent**
               + 文本输入（原生 value setter + input 事件）+ 暂停期间丢弃
```

**①(WP-2 2026-09-19) 触摸链（用户点名「带触控功能 / 点特定区域触发动作」）**：

| 环节 | 做法 | 落点 |
|---|---|---|
| 父页采集 | `touchstart/move/end/cancel`（capture+passive）与 `pointercancel`；舞台加 `touch-action:none;user-select:none`（不写就被浏览器手势接管 ⇒ 半途 `pointercancel`、作者卡在按下态） | `lib/client.js`（`onTouch`/`onCancel`/舞台 CSS 块） |
| 协议 | 新 op `'touch'`：`{phase:'start'\|'move'\|'end'\|'cancel', x, y, inside, touches[], changed[], count, mods}`；`touches`=屏上全部触点、`changed`=本条消息涉及的触点（DOM 语义），每点带 `id/x/y/inside/rx/ry/force`；坐标逐点换算、坏坐标整点丢弃、列表有上限 | `lib/web-interaction.js` 的 `touchMsg()` / `touchPointInFrame()` |
| 帧内派发 | 触摸代理（自执行 IIFE，挂 `window.__mpwTouchPush`，**与 shim 同一次求值**装入）：隐式捕获（move/end 发给 touchstart 命中的元素）、三个列表类数组化（可索引 + `.length` + `.item(i)`）、`cancelable:true`；**三级构造阶梯** —— ① `new TouchEvent` ② `document.createEvent("TouchEvent")`+`initTouchEvent`（位置签名→字典签名） ③ 普通 `Event` + 自有属性补三个列表 | `lib/web-interaction.js` 的 `WEB_TOUCH_FRAME_SOURCE`；接线在 `lib/web-wallpaper.js`（`op === "touch"` 一行 + 模板内 `${WEB_TOUCH_FRAME_SOURCE}`） |
| 点按等效 | 真机上浏览器对同一根手指**同时**发 `pointer*`（喂 click/drag）与 `touch*`（喂 TouchEvent），两条通道各喂各自的监听器、互不重复（我们从不监听 compat `mouse*`） | `lib/client.js` 的 `send()` |
| 拖拽修复 | 指针消息**每次都带 `buttons` 位掩码**：旧实现移动消息不带掩码 ⇒ 帧内看到「1→0 跳变」⇒ 拖拽第一帧就派发 `pointerup`+`click`（真机表现为「拖不动 / 一拖就点」，静默无报错） | `lib/web-interaction.js` 的 `pointerMsg()`；回归 G4 + 变异 `move-buttons-dropped` |
| 右键/中键 | 协议已通（`buttons` 位掩码 1/2/4 + `button` 序号 0/1/2 原样下发，**不伪造成左键**）；帧内旧 shim 只消费 bit0（照抄上游口径）⇒ 右键的帧内合成仍是**待接线**项 | `pointerMsg()`；回归 G3 |

- **入口**：右下角常驻小按钮「交互」（只在 web 壁纸时出现）；`?mpwinteract=1|full|off` 可强制；
  设置项 `webInteraction`（`localStorage` 的 `dsh.mpkg-wallpaper.v2`）可选 `off|pointer|full`。
- **两档**：`pointer`（缺省；指针 + 滚轮 + 触摸，**不注入键盘**）与 `full`（+ 键盘与文本输入）。
  默认 pointer 的理由：键盘注入会吞掉用户的方向键/输入，而"只是看看壁纸动画"是绝大多数场景。
- **坐标**：窗口 `clientX/clientY`（视口坐标，**不是** pageX/pageY）→ 帧内像素；
  祖先 CSS transform 的缩放用 `帧显示宽/帧内部视口宽` 补偿（与参考实现同款处理）。
  换算口径里**不出现** `devicePixelRatio`（DPR 只影响位图，不影响事件坐标；断言 G9/G13）。
- **滚轮**：delta 原样透传（与视口尺寸无关，不做缩放换算）；同时发现代 `wheel` 与 legacy
  `mousewheel`（`wheelDelta = -deltaY*1.2`，与真实 Chromium 同号）——只发一路会有真实壁纸完全无反应。
- **键盘**：只发 `keydown/keyup`（+可输入元素上的文本注入）；`button:-1` 哨兵、修饰键掩码同指针通道。
- **真语料依据（本机 `allwallpaper/`，8 张 web）**：`touchstart/move/end/cancel` **5/8**（与 `mousedown/mouseup` 同频）、
  `click` 4/8、`pointerdown/up/move` 3/8、`contextmenu` 3/8、`mouseover/out` 3/8、`keydown` 3/8。
  读者的两种写法都要支持：`changedTouches.item(0)`（spine-webgl 运行时）与 `changedTouches[i]`+`.length`（pixi）。

### 11.3 安全边界（必须写清 + 有断言）

| 边界 | 做法 | 断言位置 |
|---|---|---|
| **只在交互模式生效** | 舞台 CSS 默认 `display:none`（`.mpw-webInteract`）；未开交互时一个事件都不接 | `tools/web-interaction-test.mjs` E1/E5、C 段（关闭时 0 消息） |
| **不干扰宿主 DSH 界面** | 开启时给 `html` 打 `data-mpw-interact="on"`，`body{pointer-events:none}` 且**显式把舞台排除**；关闭即移除标记 | E3；`mpwWebIxPaint` 只在开/关时增删 |
| **一定能退出** | 60s 无注入（idle）/180s 总时长（maxAge）/`Esc`/右上角退出按钮/切壁纸（`teardownWebFrame`）/`window blur` 六条路径 | C 段（超时/幂等）、E4（退出按钮在位）、client 侧 `mpwWebIxDisarm("teardown")` |
| **不放宽 sandbox** | 交互**不改** `sandbox` 属性：仍只要 `allow-scripts`；不加 `allow-same-origin`（不透明源不变）、不加 `allow-pointer-lock`（合成事件不需要指针锁） | D 段（D1/D3 + 实现块里不出现 `setAttribute("sandbox")`） |
| **不读帧内 DOM** | 父页实现块**不出现** `contentDocument`；一切经 `postMessage` | D 段 |
| **只认当前壁纸帧** | 帧内只接受父窗口消息（`ev.source !== parentWin` 丢弃）；父页只发给当前 `frame.contentWindow` | `web-wallpaper-test.mjs` E10/E13-11 |
| **浏览器级快捷键不落到宿主** | `Ctrl/Cmd+R/W/T/N/Q/L/P`、`F5/F11/F12`、`Backspace`、`Tab` 一律 `preventDefault`；**其余键不拦**（作者没消费时方向键仍能滚宿主） | B6 段逐条 |
| **暂停语义** | 暂停期间指针/滚轮/键盘消息全部丢弃（官方暂停 = 冻结渲染进程） | E13-9 |

### 11.4 做不到的（不做静默降级，代价写在这里）

1. **CSS `:hover` / `:active` 点不亮**：由浏览器 hit-test 驱动，合成事件无法触发。
   代价：纯 CSS hover 动画的壁纸在交互模式下样式不变。可行的替代是作者用 JS hover 分支
   （`mouseenter` 等已被我们合成），但改不了作者的 CSS。
   **①(WP-2) 结论（把三条路都走完再下判断，不是没试）**：
   ① **注入帧内小脚本也没用**：`:hover`/`:active` 不是 DOM 属性，是**浏览器自己的命中测试结果**；
      脚本能改 class/内联样式，但改不了"指针是否真的停在这个元素上"这个事实。
   ② **`elementFromPoint` + 直接调作者 handler 更不行**：绕过了事件语义（`pointer-events:none`、
      `disabled`、冒泡/取消、作者按 `event.target` 分支的逻辑全失效），且 `:active` 连"调用"的对象都没有。
   ③ **唯一真解 = 原生透传（未实现，设计如下）**：交互模式下把壁纸层临时抬到宿主界面之上
      （`.mpw-bgWrap` 提 z-index）并给 `iframe` 开 `pointer-events:auto`，让**真指针**落进帧内 ——
      这样 `:hover`/`:active`/`isTrusted`/触摸/拖拽/滑块全部原生可用。
      **为什么这一轮不做**：① 无浏览器/无触屏环境**无法验证**（用户明令不要开浏览器），
      不做"没验证就宣称能用"的功能；② 它会改变安全边界 —— 帧拿到**真键盘焦点**后父页看不到按键，
      现有的"拦下 Ctrl+R/F5/Tab"这条保护会失效，退出只能靠按钮 + idle/maxAge 超时。
      要做的话必须同时给出：真机验证清单（hover 生效、Esc 退出仍可靠、焦点是否进帧）、
      失败回退开关（`?mpwinteract=native|inject`）、以及"帧获得焦点后父页快捷键保护失效"的显式告知。
2. **`allow-same-origin` 不会为交互放开**：需要"帧内 localStorage / 同源 fetch 带凭据 / 读宿主 DOM"
   的交互（Live2D 类设置面板）仍走**兼容模式**（同源，等价改动前行为），代价写在 §3 与 §12.1。
3. **指针锁 / 全屏 / 下载 / 弹窗**：需要 `allow-pointer-lock`={`allow-popups`} 等额外沙箱位的交互
   一律不做（多一个放行位就多一类越权面，而合成事件 + 舞台已覆盖绝大多数作者写法）。
4. **真·键盘焦点**：我们派发的是合成事件，作者若依赖浏览器原生焦点（`document.activeElement`
   由用户点击产生、`:focus-visible` 样式）只能拿到部分语义 —— 合成事件会让 `activeElement` 变成
   被点击的元素（浏览器自己做的），但 `:focus-visible` 仍可能不亮。
5. **`isTrusted` 恒为 `false`**（①WP-2 明确口径）：合成的 Pointer/Mouse/Touch 事件都不是用户代理产生的
   ⇒ 判 `event.isTrusted` 的作者脚本分支拿不到"真"分支。口径：**不去伪造**（`isTrusted` 是只读的
   浏览器事实，`Object.defineProperty` 硬盖成 `true` 只会骗过作者脚本、把"合成"这件事藏起来，
   反而让作者更难排查）；代价是极少数按 `isTrusted` 过滤的库（如某些手势库的"可信输入"校验）
   在交互模式下不响应 —— 需要它们就得上第 1 条的"原生透传"。
6. **帧内 `contextmenu`（右键菜单）暂不可达**（①WP-2）：交互模式下父页会吞掉右键菜单（防宿主菜单盖在壁纸上），
   而帧内旧指针机制只合成左键（bit0）⇒ 自定义右键菜单的作者在交互模式下收不到 `contextmenu`。
   协议侧已把 `buttons` 位掩码（1 左 / 2 右 / 4 中）与 `button` 序号原样送进帧内（断言 G3），
   帧内消费属于 WP-1 的指针机制，登记为**待接线**。

### 11.5 与参考实现的差异（同一件事的不同做法）

| 项 | oneincase/webwallgl | 本实现 |
|---|---|---|
| 事件进入帧内的方式 | 父页**同源**直接 `frame.contentWindow.__wePushPointer(...)` 调用 | `postMessage({op:"pointer"…})`（不透明源下唯一可行） |
| 帧沙箱 | `allow-scripts allow-same-origin`（测试台同源） | 只要 `allow-scripts`（不透明源） |
| 键盘注入 | 无（只做指针/滚轮） | 有（`full` 档，含文本输入 + 快捷键白名单） |
| 指针锁 | 兼容集里有 `allow-pointer-lock` | 不给（合成事件不需要） |
| **触摸注入** | **完全没有**（`renderer/src/web.ts` 与 `renderer/src/web-shim.js` 全文 0 处 `touch*`；`webPointerToClient` 只处理指针/滚轮） | `op:'touch'` + 帧内真 TouchEvent（隐式捕获 / 三列表类数组 / 三级构造阶梯）。**上游无照抄对象 ⇒ 本块全部自研**（MIT 允许照抄，此处无对象可抄） |
| 指针按键 | 只消费 `buttons` bit0（左键） | 父页送完整 DOM 位掩码（1/2/4）+ `button` 序号 + `pointerType/pointerId/isPrimary/pressure`（帧内旧机制仍只消费 bit0，高位是加法） |
| 拖拽语义 | 父页每次推送都带当前掩码 ⇒ 拖拽正常 | 本轮修复：移动消息也带掩码（此前会"1→0 跳变"⇒ 拖拽第一帧派发 `pointerup`+`click`） |

## 12. 已知限制

1. **Live2D / Spine 类壁纸的建议**：这类壁纸常用 `loadJson.json` 的 `SettingModel` 存设置
   （写 `localStorage`）。**①(WP-1) 起**沙箱模式下由帧内 facade 接管（同步内存 + 宿主 `/web-store`
   持久化，§5.4）⇒ 多数设置在刷新后不丢；仍**不**等同于浏览器同源 storage 的语义（跨设备/跨插件实例
   不共享、单值 4 KiB/单壁纸 64 KiB 上限、`indexedDB` 仍不可用）。需要真·同源存储的（例如依赖
   `indexedDB` 或跨壁纸共享）仍请用确认弹窗里的「兼容模式（同源）」重新应用该壁纸。
2. **音频频谱为空**：`wallpaperRegisterAudioListener` 通道已通但没有数据源（见 §5.3）；
   依赖音频反应的网页壁纸只会收到空白（不崩）。**①(WP-1) 说明**：本项**不伪造**频谱——
   帧内虽然能对壁纸自己的音频做 FFT（`AudioContext` 在语料里 1 张命中），但 WE 的音频监听语义是
   **系统音频**（用户正在放的音乐），把壁纸自身声音当作"系统频谱"喂给作者是**语义造假**
   （可视化类壁纸会对着自己的 BGM 抖动，看起来"能用"但结论是错的）⇒ 宁可留空并在 UI/文档说明。
3. **媒体（曲目/封面/进度）通道**：协议与回放已实现，但插件尚未接入系统媒体会话（SMTC / MPRIS）数据源，
   当前只有作者自己触发的事件才会到达；不能显示"正在播放"的网页壁纸属预期。
4. **指针 / 触摸交互**：已由第 11 条的交互模式解决（默认关闭；开启后指针/滚轮/触摸/键盘可达帧内；
   触屏上单指拖动与多指序列都能到作者脚本，且舞台 `touch-action:none` 保证手势不被浏览器抢走）。
   仍不可达的是 CSS `:hover`/`:active` 与 `isTrusted:true`（合成事件固有边界；唯一真解是"原生透传"，
   设计与代价见 §11.4 第 1/5 条）、帧内 `contextmenu`（协议已通、帧内待接线，§11.4 第 6 条）、
   以及"不点交互按钮就想直接操作"的用法（默认关闭是有意的安全边界）。
5. **`file:///` 改写覆盖不到的地方**（**①WP-1 后已收窄**）：静态 HTML 里写死的 `src|href|poster="file:///…"`
   与 `url(file:///…)` 现在由**宿主源级改写**覆盖（§6，K12 断言），`el.src`/`style.background`/`setAttribute`
   由运行时钩子覆盖。**仍未覆盖**：① `innerHTML`/`insertAdjacentHTML` 里拼出来的 `file:///` 字符串
   （不经过任何钩子，也不在源级改写范围内——本机语料 0 命中，故不实现，见 §16）；
   ② `url()` 里带引号+空格+转义的极端写法；③ 绝对系统路径（`Users/…`/`C:`）一律映射不了，属设计如此。
6. **`__mpw-list.json` 的池子来源**：插件没有"用户为该 file/directory 属性选目录"的交互，
   slideshow 池退化为**壁纸自有目录内的媒体文件**（最多 2000 个）。
7. **外链页面**：帧内导航到外网页面后，对方文档不会带 shim（注入只发生在本插件路由上）。
8. **兼容模式 = 同源**：此时作者脚本与 DSH 界面同源（可读 DOM/localStorage），
   仅建议对可信来源（本地库/自己下载的壁纸）使用；沙箱模式是默认值。

## 13. ①(WP-1) 宿主媒体音频控制（用户第 6 项）：契约与“默认仍静音”

**问题**：插件对 **video 类壁纸**默认静音（`lib/client.js` 的 `<video muted>`），网页壁纸帧也默认 `muted:true`；
用户要求“把视频声音交给宿主的音量/播放控制”，但**默认行为不变**。

**做法**：宿主提供一套**音频控制接口**（不是 UI；UI 归测试台线），宿主是状态的唯一权威：

| 语义名 | HTTP（宿主路由） | 请求体 | 效果 |
|---|---|---|---|
| `getMediaAudio()` | `GET /api/mpkg-wallpaper/media-audio` | — | `{ok, muted, volume, playing, audible, explicit, hasAudio, source, updatedAt}` |
| `setMuted(bool)` | `POST` 同上 | `{"muted":false}` | 显式打开/关闭声音 |
| `setMediaVolume(v)` | `POST` 同上 | `{"volume":0.4}` | 音量夹到 `[0,1]`（`7` ⇒ `1`，`-3` ⇒ `0`） |
| `play()` / `pause()` | `POST` 同上 | `{"play":true}` / `{"pause":true}` | 播放控制（`playing` 位） |
| `resetMediaAudio()` | `POST` 同上 | `{"reset":true}` | 回默认档（`muted:true`、`explicit:false`） |
| 上报音轨存在性（可选） | `POST` 同上 | `{"hasAudio":true}` | 客户端探测结果由宿主**如实回报**（宿主不猜） |

**“当前是否有声”的上报** = 响应里的 `audible`：`audible = (!muted) && volume > 0 && playing`。
**默认档 `muted:true` ⇒ `audible:false`**（K1 断言）；只有显式写过（写入即置 `explicit:true`）才可能为 true。

**落到渲染上**：

- **网页壁纸帧**：`explicit:true` 时宿主把 `{muted, volume}` 写进**入口种子脚本**（首帧生效；**不往客户端 URL
  加参数** ⇒ 不改变客户端“同一张壁纸”的身份判定），帧内按“作者值 × 宿主音量”合成（§5.2 的 `policy.volume`）；
  `explicit:false` 时**一个字段都不下发**（K7 断言：种子 JSON 里连 `volume` 键都不出现）。
- **video 类壁纸**（插件自己的 `<video>`）：宿主只做**状态权威 + 契约**，实际 mute/volume 由客户端半边施加
  （`lib/client.js` 既有 `muted` 默认**未改动**；UI 线接入后调上面的 POST 即可）。本轮**不动 `lib/client.js`**，
  所以“默认仍静音”两端都成立：宿主默认 `audible:false` + 客户端 `<video>` 默认 `muted`。

**持久化**：状态落在 `DATA_DIR/media-audio.json`（与 settings/custom-dir 同目录），重启后口径不变（K5 断言）。

---

## 14. ①(WP-1) 与上游 `oneincase/webwallgl` 的能力对照表（逐项）

基准：上游 `renderer/src/web-shim.js`（1416 行）、`web.ts`（1110 行）、`web-rewrite.ts`（95 行），
commit `b61e8910ae0a176288aed99ce9a93a13ea07df57`（MIT）。语义口径与逐条证据见 §10/§11。

| 能力（上游 → 我们） | 上游 | 我们 | 备注 |
|---|---|---|---|
| WE API 10 项（§5.1） | ✅ | ✅ | 名单一致（D1/D2 断言） |
| 作者脚本前注入 shim（`<head>` 最前） | ✅ | ✅ | 我们额外有种子脚本（首帧策略） |
| HTML 改写（`<base href>` 注入） | ✅ 注入 | ❌ 有意不做 | 入口是路径式 URL；作者自带 `file:` base 由源级改写纠正（§6/§10） |
| CSP 阻塞检测 → 退回 | ✅ `hasBlockingCsp` + 退回裸 src | ✅ **照抄判定** + 不注入 + `x-mpw-shim-skipped` 头 | 本机语料 0 命中（防御性；判定逐行照抄已登记） |
| `file:///` → 同源（运行时钩子） | ✅ | ✅ | setAttribute / src setter / style Proxy |
| `file:///` → 同源（**HTML 源级**） | ❌（上游只做运行时） | ✅ | 解析器直接产出的属性；语料 3/8 张有 `file:///` |
| `localStorage` 持久化 | ❌（上游同源，直接用浏览器 storage） | ✅ facade + 宿主 `/web-store` | **本实现独有**；语料 4/8 张读 localStorage（不透明源下会抛） |
| 媒体音量覆写（作者值 × 主音量） | ✅ `__weSetVolume` | ✅ `policy.volume` + `/media-audio` | 主音量接成**宿主权威**（§13） |
| `new Audio()` 不进 DOM 也覆盖 | ✅ WeakRef 登记 | ✅ 同款（WeakRef 优先，退化有界数组） | |
| 定时器冻结（暂停） | ✅ | ❌ 有意不做 | 理由见 §10（暂停只需停画面） |
| rAF 挂起/恢复 | ✅ | ❌ 有意不做 | 同上 |
| 音频泵 `__wePushAudio(arr128)` | ✅（宿主推频谱） | ⚠️ 通道有、**无数据源** | 不伪造频谱（§12.2）；`op:'audio'` 已在协议里 |
| 媒体泵 `__wePushMedia` | ✅ | ✅（`op:'media'`，晚注册回放） | 数据源（SMTC/MPRIS）仍未接（§12.3） |
| 目录文件泵 | ✅ | ✅（`op:'directory'` + `__mpw-list.json`） | |
| 指针注入 | ✅ 同源直调 `__wePushPointer` | ✅ `postMessage`（不透明源下唯一可行） | 语义对齐（§11） |
| 滚轮注入（含 legacy mousewheel） | ✅ | ✅ | 反号口径一致 |
| 键盘注入 | ❌ | ✅ `full` 档 + 文本输入 | 本实现独有 |
| **触摸/点击代理** | ❌（上游 **0 处** touch） | ✅ **自研（WP-2）** | 上游无可对照语义 ⇒ 协议自定（页首分工说明） |
| 属性 `whenPageReady` 时序 | ✅ 等 load | ❌ 改成微任务 flush | 语义更简单（§10） |
| 沙箱 | `allow-scripts allow-same-origin`（测试台同源） | 只要 `allow-scripts`（不透明源）+ 兼容模式可选 | §3 |

---

## 15. ①(WP-1) 真语料计数：本机 8 张 web 壁纸 → “我们必须实现哪些 API”

量法（可复跑）：`node tools/web-wallpaper-test.mjs --corpus-json`（同一份扫描逻辑也用于 L 段断言）。
语料 = `$MPW_ROOT/allwallpaper`（本机含 `0917/`、`dd/`、`wallpaperE/`、`wallpapertest1/`，34 个含
`project.json` 的目录中按**内容**判定为 web 类 **8 张**；判定用生产实现 `detectWallpaperDir`，不重写第二套规则）。
另有插件缓存 `~/.dsh-mpkg-wallpaper` 的 5 个 mpkg 容器（241 条目）——**web 条目 0**（`html=0`）⇒ 缓存语料对本项无输入。

| API / 回调 | 本机命中次数 | 命中壁纸数 | 上游 42 张语料注释 | 我们有 | 结论 |
|---|---|---|---|---|---|
| `wallpaperPropertyListener` | 17 | 5/8 | 29 张 | ✅ 有 | 语料命中 ⇒ 必须实现（已实现；上游 42 张语料同样命中） |
| `wallpaperRegisterAudioListener` | 4 | 1/8 | 22 张 | ✅ 有 | 语料命中 ⇒ 必须实现（已实现；上游 42 张语料同样命中） |
| `wallpaperRegisterMediaPropertiesListener` | 0 | 0/8 | 2 张 | ✅ 有 | 本机 0 命中，但**上游 42 张语料命中 2 张** ⇒ 必须保留实现（删了就是看本机语料下菜） |
| `wallpaperRegisterMediaThumbnailListener` | 0 | 0/8 | 未单列（0） | ✅ 有 | 本机 0 命中、上游 0 ⇒ 仍保留（官方 API 名，属“接口面完整”，删掉会让将来语料里的壁纸静默失效） |
| `wallpaperRegisterMediaPlaybackListener` | 0 | 0/8 | 未单列（0） | ✅ 有 | 本机 0 命中、上游 0 ⇒ 仍保留（官方 API 名，属“接口面完整”，删掉会让将来语料里的壁纸静默失效） |
| `wallpaperRegisterMediaTimelineListener` | 0 | 0/8 | 未单列（0） | ✅ 有 | 本机 0 命中、上游 0 ⇒ 仍保留（官方 API 名，属“接口面完整”，删掉会让将来语料里的壁纸静默失效） |
| `wallpaperRegisterMediaStatusListener` | 0 | 0/8 | 未单列（0） | ✅ 有 | 本机 0 命中、上游 0 ⇒ 仍保留（官方 API 名，属“接口面完整”，删掉会让将来语料里的壁纸静默失效） |
| `wallpaperRequestRandomFileForProperty` | 0 | 0/8 | 8 张 | ✅ 有 | 本机 0 命中，但**上游 42 张语料命中 8 张** ⇒ 必须保留实现（删了就是看本机语料下菜） |
| `wallpaperMediaIntegration` | 0 | 0/8 | 未单列（0） | ✅ 有 | 本机 0 命中、上游 0 ⇒ 仍保留（官方 API 名，属“接口面完整”，删掉会让将来语料里的壁纸静默失效） |
| `wallpaperPluginListener` | 1 | 1/8 | 2 张 | ✅ 有 | 语料命中 ⇒ 必须实现（已实现；上游 42 张语料同样命中） |
| `applyUserProperties`（回调名，非全局 API） | 9 | 5/8 | 未单列 | ✅ 有 | 属性监听对象里的回调；shim 按名调用（§5.1） |
| `applyGeneralProperties`（回调名，非全局 API） | 0 | 0/8 | 未单列 | ✅ 有 | 属性监听对象里的回调；shim 按名调用（§5.1） |
| `setPaused`（回调名，非全局 API） | 9 | 5/8 | 未单列 | ✅ 有 | 属性监听对象里的回调；shim 按名调用（§5.1） |
| `userDirectoryFilesAddedOrChanged`（回调名，非全局 API） | 1 | 1/8 | 未单列 | ✅ 有 | 属性监听对象里的回调；shim 按名调用（§5.1） |
| `userDirectoryFilesRemoved`（回调名，非全局 API） | 1 | 1/8 | 未单列 | ✅ 有 | 属性监听对象里的回调；shim 按名调用（§5.1） |

**语料给出的“为什么需要新能力”证据**：

| 信号 | 命中次数 | 命中壁纸数 | 支撑的能力 |
|---|---|---|---|
| `localStorage` | 27 | 4/8 | 帧内存储 facade（§5.4）——不透明源下**访问即抛** SecurityError，作者初始化会被打断 |
| `file:///` | 26 | 3/8 | 文件 URL 改写（§6）——静态属性靠**源级改写**，动态赋值靠运行时钩子 |
| `new Audio(` | 9 | 2/8 | 主音量（§13 / §5.2）——不进 DOM 的元素 querySelectorAll 找不到，必须包构造器 |
| `AudioContext` | 3 | 1/8 | 同上（WebAudio 路径；策略只保证不误伤 audio/video 元素） |

**与上游 42 张语料的交叉验证**：上游注释（`web-shim.js:1-18`，2026-09 自测库）为
`wallpaperPropertyListener 29 / RegisterAudioListener 22 / RequestRandomFileForProperty 8 /
userDirectoryFiles* 9 / Media*Listener 2 / PluginListener 2`（42 张）。本机语料只有 8 张，命中集合是它的
**子集**：`PropertyListener`、`RegisterAudioListener`、`userDirectoryFiles*`、`PluginListener` 都命中；
本机 **0** 命中而上游有命中的是 `RequestRandomFileForProperty` 与 `Media*Listener` ⇒ 这两族**必须保留实现**
（不能因为本机语料没有就删）。反向：本机命中的 `setPaused` / `applyUserProperties`（属性对象回调）上游注释未单列，
但显然必需。⇒ **结论：10 项官方 API 一个都不删；新增能力按“本机语料证据 + 上游有”两条腿决定**（§14）。

**真语料指纹（sha256，入口 HTML）**——L5 断言逐行比对（不一致通常意味着“语料变了”，不是代码 bug）：

| 壁纸（语料内相对路径） | 入口 | sha256 |
|---|---|---|
| `0917/884307090` | `index.html` | `a31c4c88f48b025876faca0780b6dca8ff1f02db680f8a0d875f41e67e4b81ea` |
| `dd/3580207945` | `index.html` | `7b8df325d08e73b082dcba3168471c33f5b0ba0902621b289d3910f180b04632` |
| `dd/3644069061` | `index.html` | `ef707d2b8c017e04648ab5921d99a3edba6f9a8d94131cf8736f43b90fd62495` |
| `dd/3646392375` | `index.html` | `48ffadc012a98cdbcc4e0f6f9c56d7fcb5e3c71b704e71dd00ababec98eb579d` |
| `dd/3650880224` | `index.html` | `86d5f7477f720f772bf111b5d438217342ea2caacb724aaff19f25d5ed3308a2` |
| `dd/3656000453` | `index.html` | `7b8df325d08e73b082dcba3168471c33f5b0ba0902621b289d3910f180b04632` |
| `dd/3744579963` | `index.html` | `86d5f7477f720f772bf111b5d438217342ea2caacb724aaff19f25d5ed3308a2` |
| `dd/3752477634` | `index.html` | `7b8df325d08e73b082dcba3168471c33f5b0ba0902621b289d3910f180b04632` |

<!-- MPW-CORPUS-COUNTS:BEGIN -->
机器可读的语料计数（**L5 断言逐项比对**；更新方法：`node tools/web-wallpaper-test.mjs --corpus-json`，
把输出整段替换下面这块）：

```json
{
  "corpus": {
    "root": "allwallpaper",
    "walls": 8,
    "apis": {
      "wallpaperPropertyListener": {
        "hits": 17,
        "walls": 5
      },
      "applyUserProperties": {
        "hits": 9,
        "walls": 5
      },
      "setPaused": {
        "hits": 9,
        "walls": 5
      },
      "wallpaperRegisterAudioListener": {
        "hits": 4,
        "walls": 1
      },
      "userDirectoryFilesAddedOrChanged": {
        "hits": 1,
        "walls": 1
      },
      "userDirectoryFilesRemoved": {
        "hits": 1,
        "walls": 1
      },
      "wallpaperPluginListener": {
        "hits": 1,
        "walls": 1
      }
    },
    "signals": {
      "localStorage": {
        "hits": 27,
        "walls": 4
      },
      "file:///": {
        "hits": 26,
        "walls": 3
      },
      "new Audio(": {
        "hits": 9,
        "walls": 2
      },
      "AudioContext": {
        "hits": 3,
        "walls": 1
      }
    },
    "nonApi": {
      "__weh": {
        "hits": 6,
        "walls": 3
      },
      "wallpaperAudioListener": {
        "hits": 4,
        "walls": 1
      },
      "wallpaperSettings": {
        "hits": 4,
        "walls": 1
      }
    },
    "entries": [
      {
        "id": "0917/884307090",
        "entry": "index.html",
        "sha256": "a31c4c88f48b025876faca0780b6dca8ff1f02db680f8a0d875f41e67e4b81ea"
      },
      {
        "id": "dd/3580207945",
        "entry": "index.html",
        "sha256": "fac7aae69aab3b7fe982b3cfdde2f3dd74adbdb80db1ac158259bb319fbc1987"
      },
      {
        "id": "dd/3644069061",
        "entry": "index.html",
        "sha256": "ef707d2b8c017e04648ab5921d99a3edba6f9a8d94131cf8736f43b90fd62495"
      },
      {
        "id": "dd/3646392375",
        "entry": "index.html",
        "sha256": "48ffadc012a98cdbcc4e0f6f9c56d7fcb5e3c71b704e71dd00ababec98eb579d"
      },
      {
        "id": "dd/3650880224",
        "entry": "index.html",
        "sha256": "86d5f7477f720f772bf111b5d438217342ea2caacb724aaff19f25d5ed3308a2"
      },
      {
        "id": "dd/3656000453",
        "entry": "index.html",
        "sha256": "7b8df325d08e73b082dcba3168471c33f5b0ba0902621b289d3910f180b04632"
      },
      {
        "id": "dd/3744579963",
        "entry": "index.html",
        "sha256": "86d5f7477f720f772bf111b5d438217342ea2caacb724aaff19f25d5ed3308a2"
      },
      {
        "id": "dd/3752477634",
        "entry": "index.html",
        "sha256": "7b8df325d08e73b082dcba3168471c33f5b0ba0902621b289d3910f180b04632"
      }
    ]
  },
  "mpkgCache": {
    "files": 5,
    "entries": 241,
    "html": 0,
    "js": 0
  }
}
```
<!-- MPW-CORPUS-COUNTS:END -->

---

## 16. ①(WP-1) 未实现 / 不需要（0 命中且上游也没实现 ⇒ 不写代码）

判据（用户第 4 条硬要求）：**本机语料 0 命中 且 上游也没实现** 的东西，不写实现代码，只登记在这里。

| 项 | 本机语料 | 上游 | 为什么不实现 |
|---|---|---|---|
| `$mediaThumbnail` / `$mediaProperties` / `$media*` | 0 | 0（上游同样只给 `wallpaperRegisterMedia*Listener` 回调形态） | 那是**场景脚本**（scene 的 `script.js`）的全局对象；官方 web 宿主也不给网页壁纸这套接口（§5.1 已注明） |
| `indexedDB` / `caches` / Service Worker | 0 | 0（上游同源直接用浏览器 API，从未适配） | 不透明源下不可用；补一套要另写事务/版本语义，语料 0 命中 ⇒ 收益为 0 |
| `wallpaperRegisterMediaListener`（**不存在的** API 名） | 0 | 0 | 语料没有、WE 官方文档也没有 ⇒ 不实现（作者若写了属“API 名都不对”，静默失败与官方 CEF 一致） |
| `wallpaperRequestFileForProperty` / `…AllFilesForProperty` | 0 | 0 | 官方只有 `wallpaperRequestRandomFileForProperty`（已实现）；其余名字是编造的 |
| `wallpaperRegisterAudioListener2` 等名字变体 | 0 | 0 | 同上（名字不存在） |
| `innerHTML` 里拼 `file:///` 的源级改写 | 0 | 0（上游只做运行时钩子） | 需要 HTML 解析器级别改写；语料 0 命中（§12.5 已如实写明覆盖边界） |
| 给 `AudioContext` 图强塞主音量 | 3 次 / 1 张 | 0（上游只 hook 媒体元素 volume） | 会改作者音频图语义；该张是米哈游 SDK 内部音效 ⇒ 不动（我们只保证不误伤 `audio/video`） |
| `sessionStorage` 独立实现 | 0 | 0 | 已用同一份 facade 兜住（会话语义由 `?mpwstore=mem` 覆盖），不另写一套 |
| `setTimeout/setInterval` 冻结、rAF 挂起/恢复 | ——（非 API） | ✅ 上游有 | **不属本表**：这是“有意不做”，理由在 §10 |

**作者自有符号（语料里有，但**不是** WE API ⇒ 不进 API 名单；L6 断言）**：
`wallpaperAudioListener`（4 次 / 1 张：作者自己的回调函数名，写作
`window.wallpaperRegisterAudioListener(wallpaperAudioListener)`）、
`wallpaperSettings`（4 次 / 1 张：作者自建配置对象）、`__weh`（6 次 / 3 张：Vite/React 打包产物内部符号）。

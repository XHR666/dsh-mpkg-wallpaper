# WEB-WALLPAPER —— 网页（web）类壁纸：类型判定、沙箱策略与 WE API shim

> 适用范围：`dsh-mpkg-wallpaper`（MIT，插件侧）对 Wallpaper Engine **web 类壁纸**的支持。
> 相关代码：`lib/web-wallpaper.js`（宿主侧：判定 + shim 源码 + HTML 注入 + 跨源策略 + 帧内交互合成）、
> `lib/web-interaction.js`（父页侧：坐标换算 + 事件整形 + 交互模式状态机；**交互语义的唯一源**）、
> `lib/index.js`（`/custom-folder`、`/library-web` 两条资源路由 + `/custom-dir` 扫描）、
> `lib/client.js`（沙箱 iframe 挂载 + postMessage 控制通道 + 交互舞台 + 兜底）。
> 回归：`node tools/web-wallpaper-test.mjs`（已并入 `tools/check.sh` 第 5 步；含**宿主路由端到端**：真注入 / 无标记零回归 / CORS / `__mpw-list.json` / `/custom-dir` 内容优先扫描）
> 与交互注入的帧内合成（E13）、`node tools/web-interaction-test.mjs`（坐标换算 / 事件整形 / 开关状态机 / 沙箱边界 / 舞台契约 / 两侧源码对拍）。
> 本项**渲染器零改动**：`we-scene-demo/` 一行未动，网页壁纸不经过 WebGL/渲染器。

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
| **网页 shim（默认）** | 入口 URL 带 `?mpwshim=1`（插件对网页壁纸默认加） | `allow-scripts` | **不透明源**（opaque origin） | 作者脚本读不到宿主 DOM / `localStorage`；父页也读不到帧内 DOM（静音/倍速/暂停由 shim 在帧内执行） |
| **兼容模式** | 用户在确认弹窗选「兼容模式（同源）」 | `allow-scripts allow-same-origin allow-pointer-lock` | 与宿主同源（等价于改动前的裸 iframe） | Live2D 类壁纸的「网页壁纸选项」（写 iframe 同源 `localStorage`）可用；代价是作者脚本与 DSH 界面同源 |
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

另外实现两个**非 WE 官方**的内部钩子：`window.__mpwRewriteFileUrl`（文件 URL 改写，见 §6）、
`window.__mpwWebControl`（控制面入口，与 `postMessage` 同一条处理路径）。

**不提供 `$media*`**：`$mediaThumbnail` / `$mediaProperties` 等是**场景脚本**（scene 的 `script.js`）
的接口；网页壁纸没有这套全局对象，官方 web 宿主也只给上面的 `wallpaperRegisterMedia*Listener` 回调形态。

### 5.2 父页 → 帧内控制协议（`postMessage`，`{ mpw: "mpw:web", op }`）

| `op` | 载荷 | 作用 |
|---|---|---|
| `props` | `props: {name:{value}}` | 合并进属性表并回调 `applyUserProperties`（全量快照） |
| `general` | `general: {fps}` | 回调 `applyGeneralProperties` |
| `pause` | `value: boolean` | 回调 `setPaused` + 冻结/解冻帧内 media |
| `policy` | `muted, speed` | 帧内静音 / 倍速（沙箱下父页读不到帧内 DOM，只能这样下达） |
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

---

## 6. 文件 URL 改写

官方 CEF 以文件系统为源，作者常写 `'file:///' + value`（`file:///files/x.png`）。在 HTTP 路由下
这些 URL 必然 404，所以 shim 在以下位置改写：

- `Element.prototype.setAttribute`（`src` / `href` / `poster`）
- `HTMLImageElement` / `HTMLMediaElement` / `HTMLSourceElement` / `HTMLScriptElement` 的 `src` setter
- `CSSStyleDeclaration.prototype.setProperty` 与 `HTMLElement.prototype.style`（`background*` 走 Proxy）

规则：`file:///相对段` → 按文档 `baseURI` 解析成同目录 HTTP URL；**绝对系统路径**
（形如 `Users/`、`tmp/` 开头，或 `C:` 盘符）无法映射 → 返回**空串**（作者侧通常有守卫，
胜过给出一个必然 404 的地址）；非 `file:` URL 一律原样放行。

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
- **未复制其代码**（未 vendored、无逐行翻译）：本实现的状态机、时序策略、URL 改写、
  控制协议与错误边界均为本仓库自写，差异见 §10。API 名称属接口（不受版权保护），
  API 语义来自 WE 官方文档与公开行为。
- 台账：`../docs/COPYING-RULES.md` §4 第 7 条；包内声明：`THIRD-PARTY.md` §2。
- 明确未借用任何 GPL-2.0-only 项目（`Aromatic05/wallpaper-engine-renderer`、
  `waywallen/open-wallpaper-engine`、`catsout/wallpaper-scene-renderer`）；
  `tools/web-wallpaper-test.mjs` 有机器断言（注释剥离后 grep 派生标识符 + 无 GPL 许可文本）。

## 10. 与参考实现的差异清单（机器断言，见测试 D4/D5）

**参考覆盖、本实现也覆盖**：上表 §5.1 的 10 项 API 全部覆盖。

**参考实现有、本实现第 11 条起已对齐语义的非 API 能力**（逐项对照见 §11）：

- 合成指针/滚轮/键盘事件注入（按命中元素派发 + click 边缘合成 + button:-1 哨兵）
- 指针离开补 out/leave 链 + 补一次 up（作者 hover/按下态复位）
- 滚轮同时发现代 wheel 与 legacy mousewheel（wheelDelta 与 deltaY 反号）

**仍不做**：合成事件点亮 CSS :hover / :active（合成事件固有边界，非实现缺陷）——
`:hover` 由浏览器自己的 hit-test 驱动，任何合成事件都不会点亮它；需要 hover 视觉的壁纸
在交互模式下依然会"指针到了但样式不变"，这是本方案的已知边界（见 §11.4）。

**参考有、本实现有意不做**（每条都有理由，不是漏做）：

| 差异项 | 为什么不做的 |
|---|---|
| `setTimeout/setInterval 冻结（暂停语义）` | 插件暂停语义只需"停住画面"：`pause` 已冻结帧内 media 与作者 `setPaused` 回调；改写 `window.setTimeout` 会污染作者计时器语义与我们的错误面 |
| `rAF 挂起与恢复（自递归主循环补跑）` | 同上；网页壁纸的 rAF 由浏览器按帧率节流，插件不接管（接管需精确补跑，风险大于收益） |
| `合成指针/滚轮事件注入` | 插件的壁纸层是 `pointer-events:none` 的底层背景，桌面指针事件不由网页壁纸消费（该能力属桌面 underlay 形态，与 DSH 页面内嵌形态不同） |
| `媒体音量覆写（volume/muted 原型钩子）` | 插件只有"静音"开关，没有主音量滑条；音量留给作者与壁纸自带设置（L2D 音量滑条走其 `localStorage`） |
| `wallpaperPropertyListener 的 whenPageReady 时序` | 本实现改为"属性表 + 首赋值后微任务 flush"，语义更简单（晚挂 listener 也能拿到全量快照），不需要等 `load` |

**本实现独有**（架构不同导致）：`__mpwWebSeed 种子脚本`（首帧策略，免等 postMessage）、
`postMessage 控制通道（op 白名单）`（沙箱帧下父页唯一可达路径）、
`作者脚本错误上报（error/unhandledrejection）`（带 50 条预算的帧内错误边界）。

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
  pointermove/down/up、wheel、keydown/up、blur  →  lib/web-interaction.js 整形
  →  窗口坐标 → iframe 内 client 像素（含祖先缩放，见 clientPointInFrame）
  →  frame.contentWindow.postMessage({mpw:"mpw:web", op:"pointer"|"wheel"|"key"|"blur"})
  →  帧内 shim：elementFromPoint 命中派发 + over/out/enter/leave 链 + click 由 down/up 边缘合成
               + 文本输入（原生 value setter + input 事件）+ 暂停期间丢弃
```

- **入口**：右下角常驻小按钮「交互」（只在 web 壁纸时出现）；`?mpwinteract=1|full|off` 可强制；
  设置项 `webInteraction`（`localStorage` 的 `dsh.mpkg-wallpaper.v2`）可选 `off|pointer|full`。
- **两档**：`pointer`（缺省；指针 + 滚轮，**不注入键盘**）与 `full`（+ 键盘与文本输入）。
  默认 pointer 的理由：键盘注入会吞掉用户的方向键/输入，而"只是看看壁纸动画"是绝大多数场景。
- **坐标**：窗口 `clientX/clientY`（视口坐标，**不是** pageX/pageY）→ 帧内像素；
  祖先 CSS transform 的缩放用 `帧显示宽/帧内部视口宽` 补偿（与参考实现同款处理）。
- **滚轮**：delta 原样透传（与视口尺寸无关，不做缩放换算）；同时发现代 `wheel` 与 legacy
  `mousewheel`（`wheelDelta = -deltaY*1.2`，与真实 Chromium 同号）——只发一路会有真实壁纸完全无反应。
- **键盘**：只发 `keydown/keyup`（+可输入元素上的文本注入）；`button:-1` 哨兵、修饰键掩码同指针通道。

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
2. **`allow-same-origin` 不会为交互放开**：需要"帧内 localStorage / 同源 fetch 带凭据 / 读宿主 DOM"
   的交互（Live2D 类设置面板）仍走**兼容模式**（同源，等价改动前行为），代价写在 §3 与 §12.1。
3. **指针锁 / 全屏 / 下载 / 弹窗**：需要 `allow-pointer-lock`={`allow-popups`} 等额外沙箱位的交互
   一律不做（多一个放行位就多一类越权面，而合成事件 + 舞台已覆盖绝大多数作者写法）。
4. **真·键盘焦点**：我们派发的是合成事件，作者若依赖浏览器原生焦点（`document.activeElement`
   由用户点击产生、`:focus-visible` 样式）只能拿到部分语义 —— 合成事件会让 `activeElement` 变成
   被点击的元素（浏览器自己做的），但 `:focus-visible` 仍可能不亮。

### 11.5 与参考实现的差异（同一件事的不同做法）

| 项 | oneincase/webwallgl | 本实现 |
|---|---|---|
| 事件进入帧内的方式 | 父页**同源**直接 `frame.contentWindow.__wePushPointer(...)` 调用 | `postMessage({op:"pointer"…})`（不透明源下唯一可行） |
| 帧沙箱 | `allow-scripts allow-same-origin`（测试台同源） | 只要 `allow-scripts`（不透明源） |
| 键盘注入 | 无（只做指针/滚轮） | 有（`full` 档，含文本输入 + 快捷键白名单） |
| 指针锁 | 兼容集里有 `allow-pointer-lock` | 不给（合成事件不需要） |

## 12. 已知限制

1. **Live2D / Spine 类壁纸的建议**：这类壁纸常用 `loadJson.json` 的 `SettingModel` 存设置
   （写 iframe 同源 `localStorage`）。沙箱模式下不可达 → 设置页会给出明确提示，
   请用确认弹窗里的「兼容模式（同源）」重新应用该壁纸（`webHeavy` 预检也会标黄提示）。
2. **音频频谱为空**：`wallpaperRegisterAudioListener` 通道已通但没有数据源（见 §5.3）；
   依赖音频反应的网页壁纸只会收到空白（不崩）。
3. **媒体（曲目/封面/进度）通道**：协议与回放已实现，但插件尚未接入系统媒体会话（SMTC / MPRIS）数据源，
   当前只有作者自己触发的事件才会到达；不能显示"正在播放"的网页壁纸属预期。
4. **指针交互**：已由第 11 条的交互模式解决（默认关闭；开启后指针/滚轮/键盘可达帧内）。
   仍不可达的是 CSS `:hover`/`:active`（合成事件固有边界）与"不点交互按钮就想直接操作"的用法。
5. **`file:///` 改写覆盖不到的地方**：由 HTML 解析器直接产出的属性（`innerHTML` 里写的
   `src="file:///…"`）不经过 `setAttribute`/setter，不会被改写；`url()` 里带引号+空格的极端写法也只覆盖常见形态。
6. **`__mpw-list.json` 的池子来源**：插件没有"用户为该 file/directory 属性选目录"的交互，
   slideshow 池退化为**壁纸自有目录内的媒体文件**（最多 2000 个）。
7. **外链页面**：帧内导航到外网页面后，对方文档不会带 shim（注入只发生在本插件路由上）。
8. **兼容模式 = 同源**：此时作者脚本与 DSH 界面同源（可读 DOM/localStorage），
   仅建议对可信来源（本地库/自己下载的壁纸）使用；沙箱模式是默认值。

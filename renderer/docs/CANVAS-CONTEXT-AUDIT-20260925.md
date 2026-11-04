# CANVAS-CONTEXT-AUDIT-20260925 —— 「同一个 canvas 只有第一次 `getContext` 生效」缺陷类全仓审计

> 触发事件：`:8902` 的 `?shell=0` 无外壳 shim（`server/we-scene-demo-server.mjs` → `shellShimScript()`，script id `mpw-noshell-frame`）
> 旧写法在 t≈141ms 对 `#sc` 裸调 `getContext('webgl2')` 抢在渲染器前面，把 `glCanvasAttrs()` 要的
> `alpha:false / premultipliedAlpha:false / antialias:false / preserveDrawingBuffer:true` 静默顶成浏览器默认；
> 并且它把「canvas 取得到上下文」当首帧判据，t≈151ms 就置了 `data-mpw-frame=1`（真首帧在 12s 之后）。该 shim 已修（只读被动信号）。
>
> 本文任务：把**同一缺陷类的其余落点**在全工作区（`we-scene-demo/` + `dsh-mpkg-wallpaper/`）找干净，并审同类假信号
> （「context 存在 / 画布有尺寸 = 已出帧」）。
>
> 方法：**只读静态审计**（source + docs + 归档），未改任何代码、未跑测试套件、未起浏览器、未动 git。
> 活体读数只**描述方法**（§⑤），不执行。每条分类都附**原文引用**；"没找到"按"没找到"写。
> 覆盖口径：`find \( -type f -o -type l \)` + GNU grep（本机文件系统把 `web/diag.html`、`web/probe.html`、`core/we-scene.mjs`、
> `core/we-web-shim.mjs`、`elysia/media-lyrics.js` 等条目的 dirent 报成 symlink 型，`find -type f` 会**静默漏掉**它们 ⇒ 已用 `-type l` 与直接点名补齐）。

## ① 一句话结论

**渲染器、服务器注入面、宿主插件里已经没有第二处能抢跑 `#sc` 的 `getContext`：A 类缺陷只剩 2 处，都在"取证/测试"侧**
（`tests/headless-shot.mjs:66-68` 在 `SHOT_URL` 指向 `?mode=elysia` 时能抢在 elysia 的 2d 之前；
`archive/local/hina-probe.mjs:31-35` 是同一写法的归档件）；
**`demo.html` 的全部经典 `<script>` 块安全**（全文件 11 处 `getContext` 命中 = 10 次真实调用 + 1 处注释，经典块内 0 次）；
`?shell=0` shim 已修且不再碰 `getContext`，两个服务器入口共用同一份实现；
**但还有 1 处"必须点名"的 B 类脆弱点：`elysia/demo-elysia.js:118` 的 `getContext('2d')` 前有两个 `await`（`:79` / `:88`），
那几秒里 `#sc` 没有任何上下文、也没有守卫**；
假信号方面有 **1 处真缺陷**（插件 `dsh-mpkg-wallpaper/lib/client.js:5866` 用 `canvas.width > 0` 当"画出来了"，
使 12s 慢补挂永不触发）、**9 处取证侧假判据**（§④.2 的 F2–F10）与 **1 处反向缺口**（elysia 真出帧但不发首帧信号，§④.3 的 F11）。

## ② 判据

### ②.1 规范面（本缺陷类的物理根据）

- 一个 `HTMLCanvasElement` 的上下文**只创建一次**：第一次 `getContext(type, attrs)` 成功后，后续任何
  `getContext(type, attrs2)` 都返回**同一个对象**，`attrs2` **被静默忽略**；请求另一种 type 返回 `null`。
- 因此"抢跑"有两种后果：① 抢跑者**无 attrs** ⇒ 所有者的 `alpha/premultipliedAlpha/antialias/preserveDrawingBuffer`
  全部落空（透明语义与 MSAA 变化、"截图/readPixels 读空"）；② 抢跑者用了**另一种 context type**
  （webgl2 ↔ 2d）⇒ 所有者拿到 `null`，整条路径死亡。
- 反之，如果所有者**已经**建过上下文，之后任何 `getContext` 都只是"再取一次同一个对象"，**不构成缺陷**（这正是
  B 桶与 A 桶的分界：A 桶必须能证明它**可能**是第一个调用者）。

### ②.2 本仓的契约锚点（唯一来源）

- 属性唯一来源：`core/we-scene-bundle.js:14372` `export function glCanvasAttrs(search)` →
  `{ premultipliedAlpha:false, antialias: AA_MSAA_SAMPLES[tier.aa] > 0, alpha:false, preserveDrawingBuffer:true, depth:true, stencil:false }`
  （注释 `:14359-14366` 明确写了"先 getContext 的那次决定全部属性，后面再请求别的属性会被静默忽略"）。
- 渲染器内部创建点：`core/we-scene-bundle.js:8044`
  `const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: AA_WANT_NATIVE, alpha: false, preserveDrawingBuffer: true })`。
- 页面侧唯一 `#sc` 创建点：`demo.html:1935`（单实例）与 `demo.html:8511`（多实例每格），两处都走 `lib.glCanvasAttrs(location.search)`。
- 真机证据（历史）：`server/we-scene-demo-server.mjs:544-548` 记录了 t≈141ms 抢跑 + t≈151ms 假首帧 + t≈544ms 属性落空；
  `tests/bench-dsh-libroot-test.mjs:753-778` 已有**端到端运行时钉子**（B2d）——用透传记录器读 `#sc` 上第一次 `getContext` 的实参。
- 诚实首帧信号（本仓已存在）：`window.__mpwFirstFrame`（`demo.html:7879`，视频路径 `demo.html:2141`）、
  `window.__mpwFrameNo`（`demo.html:7930`）、`window.__mpwWebFrame.ready`（web 帧）、
  `document.documentElement[data-mpw-frame]`（`server/we-scene-demo-server.mjs:563-577` 只读上面三个后置位）。

### ②.3 分类口径

| 桶 | 含义 |
|---|---|
| **A** | **缺陷**：能抢在画布所有者之前成为第一个 `getContext` 调用者（含"所有者会晚点再取用同一画布"）。 |
| **B** | **安全但脆弱**：同一个 canvas，但只可能在所有者已建上下文之后运行（必须写明是什么保证了顺序）；另用 **B(OWNER)** 标注"所有者自己的那一次调用"（它按定义就是第一次，是属性的定义者，不是抢跑者）。 |
| **C** | **不是同一个 canvas**：自建/离屏/2d 专用画布、另一份文档/iframe/WebView、mock 桩对象。 |
| **D** | **只读探针**：只读上下文状态（如 `getContextAttributes()` / `gl.getParameter`）、或在一次性画布上做能力探针、或**只记录不改行为**的透传包装。 |

### ②.4 测试方法（摘要，命令见 §⑤）

判据不是"读代码觉得没问题"，而是**在页面加载前**给 `HTMLCanvasElement.prototype.getContext` 套一层
**只记录 + 原样 `call through`** 的包装（探针自己**绝不**创建上下文），开页后读 `#sc` 上**第一条**记录的实参，
与 `lib.glCanvasAttrs(location.search)` 逐字段比对。仓内已有参考实现：`tests/bench-dsh-libroot-test.mjs:651-674`（记录器）
与 `:771-777`（断言 `{alpha:false, premultipliedAlpha:false, antialias:false, preserveDrawingBuffer:true}`）。

## ③ 逐条表格

### ③.1 渲染器自身（`demo.html` / `core/**` / `elysia/**`）

| 位置 | 桶 | 证据（原文引用） | 后果 / 为什么越不了界 |
|---|---|---|---|
| `demo.html:1047` → `:1935` | —（结构性结论） | `<script type="module">`（`:1047`）内 `const gl = MPW_MULTI_IDS ? null : cv.getContext('webgl2', lib.glCanvasAttrs(location.search));` | **模块脚本是 defer 的**：`demo.html` 里所有经典 `<script>`（`:89-104`、`:131`、`:132-365`、`:366`、`:370-381`、`:384-503`、`:504-1046`）都先执行，但它们**没有一处调用 `getContext`**（全文件 11 处命中见下），因此不可能抢跑。 |
| `demo.html:89-104`、`:131`、`:132-365`、`:366`、`:370-381`、`:384-503`、`:504-1046`（全部经典块） | **无 A（已核对）** | 经典块里与 canvas 唯一的接触是 `function fitCanvas() { const c = document.getElementById('sc'); … c.style.width = w + 'px'; c.style.height = h + 'px'; }`（`:371-377`，**只写 CSS**）、`function shot(ev){…const d=(window.__mpwSafeDataURL?window.__mpwSafeDataURL(c,'image/png'):null);…}`（`:366`，点击时才读回）、以及 B6 兼容层对 `img/video/audio` 的 `crossOrigin` 修补（`:185-229`）。 | 三个证据：① 全文件 `getContext` 命中仅 `:1932`（注释）`:1935` `:2762` `:2778` `:5085` `:5166` `:6859` `:7045` `:7393` `:7894` `:8511`；② `fitCanvas()` 不碰 drawing buffer（不写 `c.width/height`）；③ `mpw-cap` 首帧兜底只是 250ms 轮询**读** `window.__mpwFirstFrame`（`:270-274`），无副作用。 |
| `demo.html:1935` | **B(OWNER)** | `const gl = MPW_MULTI_IDS ? null : cv.getContext('webgl2', lib.glCanvasAttrs(location.search));` | 单实例首次调用者，属性=唯一来源。脆弱点：保护它的只有"上面那些块都没有 `getContext`"这条**枚举事实**，没有任何运行期守卫。 |
| `demo.html:8511` | **B(OWNER)** | `const glI = rec.canvas.getContext('webgl2', lib.glCanvasAttrs(location.search));   // ①(第 24 条) 同一来源` | 多实例每格首次调用者。顺序受控：`rec.canvas` 由宿主裸建（`elysia/multi-instance.js:251-254` `const cv = el('canvas','mpw-inst-cv'); … r.canvas = cv;`），该模块自述"**不碰 WebGL、不碰 bundle**"（`elysia/multi-instance.js:8-9`），无预热探针。 |
| `demo.html:6422` / `demo.html:6313` | **B（同一画布的第二调用者）** | `renderer = lib.createRenderer(cv, {`（两处，均在 `bootInstance` 内）→ 落到 `core/we-scene-bundle.js:8044` | 第二次 `getContext('webgl2', {…})` 拿到的是 1935/8511 已建的对象，实参被忽略但**效果一致**；注意两处实参字典并不逐字相同（`8044` 没写 `depth/stencil`，`14380-14387` 写了 `depth:true, stencil:false`——都是 WebGL 默认值，无害）。 |
| `demo.html:6852-6861` | **B（同画布、必在 owner 之后；且是死代码）** | `const cvEl = cv` → `cvEl.addEventListener('webglcontextlost', (e) => {… try { const c2 = cvEl.getContext('2d')` | `webglcontextlost` 只能在**已有** WebGL 上下文之后派发 ⇒ 不可能抢跑；但同一画布已有 webgl2 时 `getContext('2d')` **按规范恒返回 `null`** ⇒ 「渲染上下文丢失（显存不足），正在恢复…」这句提示**永远画不出来**（`c2` 为 null，`if (c2)` 直接跳过）。这是"提前一句就变成抢跑"的活陷阱。 |
| `elysia/demo-elysia.js:118` | **B(OWNER)，但脆弱窗口最大** | `canvas.width = W; canvas.height = H;` / `const ctx = canvas.getContext('2d');` / `if (!ctx) { logf('❌ 无法获取 2d 上下文'); return; }` | 结构性保证只有 `demo.html:1923 if (MODE === 'elysia') {` … `:1928 } else {`（`?mode=elysia` 时 1935 不可达，意图见 `demo.html:1730`）。**脆弱的具体读数**：`bootElysia` 到这一行前有两个真实 `await`——`:79 const pkgRes = await fetch('/pkg/' + id);` 与 `:88 await prefetchWeAssets(logf);` ⇒ 这几秒里 `#sc` 没有上下文、无人看守；任何抢跑者会让 2d 返回 null、elysia 路径在第 119 行死掉。 |
| `elysia/demo-elysia.js:143` | —（反向缺口，见 §④.3） | `ctx.putImageData(imgData, 0, 0);` | 这是 elysia 路径的**真出帧**点，但它不写 `window.__mpwFirstFrame`/`__mpwFrameNo`/`__mpwCapMarkFrame`（`elysia/**` 里 `firstFrame` 只出现在 `multi-instance.js:184/378`）⇒ 诚实信号在 elysia 路径上是缺的。 |
| `core/we-scene-bundle.js:8044` | **B(OWNER / 第二调用者)** | `const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: AA_WANT_NATIVE, alpha: false, preserveDrawingBuffer: true })` / `if (!gl) throw new Error('当前浏览器不支持 WebGL2')` | 自建画布时它是 owner；宿主传画布时它是第二调用者。若画布已被抢跑，这里只会抛"**当前浏览器不支持 WebGL2**"——**归因错误**（真因是属性/类型已被别人定死）。 |
| `core/we-scene.mjs:62` / `:71` | **B（对外可达入口）** | `let canvas = opts.canvas || null` … `canvas = doc.createElement('canvas')`（`:62`）→ `const renderer = create(canvas, opts)`（`:71`） | `opts.canvas`（注释 `:57` "接管既有画布（多实例/嵌入场景）"）**不校验画布是否已有上下文、也不比对 `getContextAttributes()`**；这是本缺陷类对外的可达形态（`core/we-scene.mjs` 是包的 main，`build-pages.mjs:63` 会把它复制到 Pages）。 |
| `core/we-scene-bundle.js:11876` + `:11884`、`:11949` | **C** | `texObj.canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null` → `const ctx = texObj.canvas.getContext('2d')` / `texObj.canvas.getContext('2d').getImageData(…)` | 渲染器**自建**的视频中转画布；同一元素两次请求都是 `'2d'` 无 attrs，不存在被顶掉的属性。 |
| `demo.html:2761-2762`、`:2777-2778` | **C** | `const c = document.createElement('canvas'); c.width = nw; c.height = nh` → `c.getContext('2d').drawImage(bmp, 0, 0, nw, nh)` | 位图降采样自建画布。 |
| `demo.html:5085` | **C** | `const probe = document.createElement('canvas').getContext('2d')` | 字体度量一次性画布。 |
| `demo.html:5164-5166` | **C（同时是 grep 陷阱）** | `const cv = document.createElement('canvas')` / `cv.width = cw; cv.height = ch` / `const ctx = cv.getContext('2d')` | **局部 `const cv` 遮蔽了 `#sc` 的模块级 `cv`**（`demo.html:1114`）⇒ 看到 `cv.getContext('2d')` 不能直接判成"在 #sc 上取 2d"。 |
| `demo.html:7043-7045`、`:7391-7393`、`:7892-7894` | **C** | `const shot = document.createElement('canvas')` … `const sc = shot.getContext('2d')` / `const tc = document.createElement('canvas')` … `const cx = tc.getContext('2d')`（×2） | 上报缩略图 / 连拍 / `?thumbpost=` 的读回中转画布，都是自建。 |
| `elysia/multi-instance.js:251-254` | **C（宿主建 canvas，不取上下文）** | `const cv = el('canvas', 'mpw-inst-cv');` / `cv.style.cssText = 'width:100%;height:100%;display:block';` / `tile.appendChild(cv);` / `r.canvas = cv;` | 网格画布由宿主创建后交给注入的 `boot(rec)`；`getContext` 在 `demo.html:8511`，顺序受控。 |

### ③.2 服务器与站点注入面（谁是"往渲染器文档里塞脚本"的人）

| 位置 | 桶 | 证据（原文引用） | 后果 / 越界说明 |
|---|---|---|---|
| `server/we-scene-demo-server.mjs:556-577`（`shellShimScript()`，已修） | **无 A（正面样本）** | `'<script id="mpw-noshell-frame">(function(){'` … `'var honest=function(){try{if(window.__mpwFirstFrame)return true;'` / `'if((window.__mpwFrameNo||0)>0)return true;'` / `'var w=window.__mpwWebFrame;if(w&&(w.ready||w.readyMs>0))return true;'` | 全函数**没有一次 `getContext`**（`grep -c getContext` 在 `server/we-scene-demo-server.mjs` 只命中 `:545` 的注释）；首帧判据改成只读三个渲染器自写的被动信号，等不到就**不置位**（父页 12s 兜底）。`tests/bench-dsh-libroot-test.mjs:352-358` 已用 `!/getContext/.test(shimScript)` 钉住。 |
| `server/we-scene-demo-server.mjs:613-617` | **B（顺序：`</body>` 前追加）** | `if (url.searchParams.get('shell') === '0') { buf = Buffer.from(injectShellShim(buf.toString('utf8')), 'utf8'); }` → `:581-587` 把样式+脚本插到 `</body>` 前 | 注入物本身不取上下文；且只有显式 `?shell=0` 才注入（不带 ⇒ 响应逐字节不变）。 |
| `server/we-scene-demo-server-8902.mjs:2803` + `:1794-1804` | **B（同一份实现、路径改写）** | `if (p === '/webloader' || p.startsWith('/webloader/')) return done(() => serveRenderer(req, res, url))` / `const rel = … url.pathname.replace(/^\/webloader\/?/, '')` / `req.url = mountPath + (url.search \|\| '')` / `return rendererRequestHandler(req, res)` | 这解释了活体证据 URL `http://127.0.0.1:8902/webloader/?shell=0&id=<id>`：`/webloader/` 被改写成 `/` 后交给**同一个** `rendererRequestHandler` ⇒ 用的是**同一份已修的 shim**，`?shell=0` 在 8902 上同样生效。8902 自己**没有**第二份 HTML 注入器。 |
| `core/we-web-shim.mjs`（全文件） | **C** | `grep -n "getContext\|canvas\|HTMLCanvas"` = **0 命中** | 这是给**网页壁纸** iframe 文档注入的 WE API shim（另一份文档，与 `#sc` 无关），且完全不碰 canvas。 |
| `web/pwa-inject.mjs:27-33` | **C** | `'<script type="module">'` … `"if ('serviceWorker' in navigator) {"` / `"  navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' })"` | 注入到 `</head>` 前的 PWA 片段只有 SW 注册；不碰 canvas。（默认关：`?pwa=1` 或 `MPW_PWA=1`。） |
| `web/diag.html:6,9` | **C** | `lines.push('webgl2: ' + !!(document.createElement('canvas').getContext('webgl2')));` / `try { const gl = document.createElement('canvas').getContext('webgl2'); if (gl) {` | 独立诊断页（`/diag`），一次性画布，不引用 `#sc`。 |
| `web/probe.html:12,13,134-135` | **C** | `const c=document.createElement('canvas'); const g=c.getContext('webgl2'); return g? 'OK':'NO';` / `const gl = document.createElement('canvas').getContext('webgl2', { antialias: false });` / `const cv = document.createElement('canvas'); cv.width=1280; cv.height=720;` → `cv.getContext('2d')` | 独立探针页（`/probe`），全部自建画布。 |
| `server/we-scene-demo-server.mjs:790-812` | **C** | `/diag` 与 `/probe` 只是 `fs.readFileSync` 上面两个静态页 | 与渲染器文档不同源文档，无 `#sc`。 |

### ③.3 宿主插件 `dsh-mpkg-wallpaper`

结论：**0 处 A、0 处 B**。插件从不碰 `#sc`，也从不往渲染器文档注入脚本；唯一的注入物（网页壁纸 shim）不含任何上下文创建。

| 位置 | 桶 | 证据（原文引用） | 后果 / 越界说明 |
|---|---|---|---|
| `lib/client.js:1405-1409` | **C** | `const c = document.createElement("canvas"); c.width = 32; c.height = 18;` / `const ctx = c.getContext && c.getContext("2d");` | 插件自建 32×18 缩略底色画布。 |
| `lib/client.js:3114-3115`、`lib/client.js:5724-5725` | **C** | `const g = canvas.getContext("2d");` / `const c2 = canvas.getContext("2d");` | 都是插件自己的 `canvas.mpw-bgCanvas`（`lib/client.js:2819-2822` 创建 + `:2834` 取出）；两次请求参数相同（`'2d'` 无 attrs），不构成覆盖。 |
| `lib/client.js:9554-9556` | **C** | `const canvas = document.createElement("canvas");` … `const ctx = canvas.getContext("2d", { willReadFrequently: true });` | 取色一次性画布。 |
| `lib/client.js.bak-20260907:942`、`:1364`、`:2200` | **C（备份件）** | `const g = canvas.getContext("2d");` 等 | 陈旧备份（`package.json` `files` 里 `"!lib/**/*.bak*"` 排除），2d-only、死代码。 |
| `lib/liquid-glass/renderer.js:56-63`（内联副本 `lib/liquid-glass-bundle.js:1494-1499`） | **C（潜在 A，当前不可达）** | `constructor(canvas, options = {})` / `const gl = canvas.getContext('webgl2', {` / `alpha: Boolean(options.alpha), antialias: false, premultipliedAlpha: true,` / `preserveDrawingBuffer: Boolean(options.preserveDrawingBuffer),` | 全仓唯一一处**带属性**的 webgl2 创建，作用在**调用方传进来的**画布上。可达性核实：`lgModule` 只有声明没有赋值（`lib/client.js:7015 let lgModule = null;`），`applyLiquidGlass` 现已改为 **CSS 版**（`lib/client.js:7854-7858` 注释明说"液态玻璃改为 **CSS 版**（方案1：稳定可靠，不崩）。之前用 WebGL 库 … bug"），`lib/liquid-glass/**` 与 `liquid-glass-bundle.js` 被 `package.json files` 排除 ⇒ 当前无活调用点。**若哪天把 `#sc` 传进来就是真 A**：它要 `premultipliedAlpha:true` 且 `alpha` 默认为真，与渲染器要求的 `alpha:false / premultipliedAlpha:false` 直接冲突。 |
| `lib/liquid-glass/index.js:104-115`、`lib/liquid-glass/v2.js:98-110`（内联 `liquid-glass-bundle.js:2174-2184`） | **D** | `const probe = document.createElement('canvas');` / `const gl = probe.getContext('webgl2');` / `gl.getExtension('WEBGL_lose_context')?.loseContext();` | 一次性能力探针，自带画布、随即 lose，影响不到任何所有者的画布。 |
| `lib/liquid-glass/v2.js:364-368`、`liquid-glass-bundle.js:2440-2444` | **C** | `if (!this.lightCanvas) this.lightCanvas = document.createElement('canvas');` / `const context = this.lightCanvas.getContext('2d', { willReadFrequently: true });` | 库私有 2d 画布。 |
| `lib/web-wallpaper.js:603-610`（内联 `dist/dsh-mpkg-wallpaper.bundle.mjs:3944`） | **C（唯一的插件注入脚本）** | `const inject =` / `'<script ' + SHIM_ATTR + '="' + SHIM_VERSION + '">\n' + escapeScriptClose(shim) + '\n</script>'` | 注入目标是**网页壁纸 iframe 文档**，不是渲染器文档；shim 全文 `getContext` = 0、`createElement('canvas')` = 0，能力探针只做 `typeof W.OffscreenCanvas === "function"` 类型判断（`lib/web-wallpaper.js:788`）。 |
| `lib/client.js:2790`、`:5611-5619`、`:3675`、`:7074` | **C（通道只有 URL 参数 + postMessage）** | `frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");` / `+ "pkgurl=" + encodeURIComponent(rawUrlEff) + "&embed=1" …` / `frame.contentWindow.postMessage(Object.assign({ mpw: MPW_WEB_SHIM_MSG }, msg \|\| {}), "*");` / `if (f && f.contentWindow) f.contentWindow.postMessage({ type: "mpw-ln-key", key: ev.key }, "*");` | 渲染器文档是**另一来源**（DSH GUI 端口 vs 渲染服务端口），strict 沙箱下还是不透明源（`:3838`、`:4174` 的守卫注释）；插件既无 `document.write`/`srcdoc`/`createElement('script')`（全仓 0 命中），也没有 WebView 注入面。 |
| `lib/audio-bus.js`（全文件） | **C** | `installAudioBus(cw, {…})`（`lib/audio-bus.js:908-916`，只对 `sameOrigin` 帧生效）；全文 `getContext\|canvas` = **0 命中** | 即便渲染器 iframe 恰好同源，被装进去的也只是 WebAudio 原型补丁，不碰 canvas。 |
| `lib/client.js.bak-*`、`dist/dsh-mpkg-wallpaper.bundle.mjs` | **C** | `dist/dsh-mpkg-wallpaper.bundle.mjs` 中 `getContext` = **0 命中** | 发布产物里没有上下文创建。 |

### ③.4 测试 / 工具 / 归档 / 独立页

| 位置 | 桶 | 证据（原文引用） | 后果 / 越界说明 |
|---|---|---|---|
| `tests/headless-shot.mjs:66-68`（+ `:71` `readPixels`） | **A（条件性）** | `const cv = document.getElementById('sc')` / `if (!cv) return null` / `const gl = cv.getContext('webgl2')` / `gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)` | 通用取证 CLI：URL 来自 `process.argv[2]`（`:26 const url = process.argv[2] || 'http://127.0.0.1:8899/?id=3719111841'`），等待时长来自 `argv[4]`（`:28`，默认 6000ms）。默认 WebGL 页无害（owner 在模块求值期已建）；**但指向 `?mode=elysia` 且等待设短时，它会在 `elysia/demo-elysia.js:118` 之前拿到 `#sc` 的 webgl2（那边前面有两个 `await`）⇒ elysia 的 `getContext('2d')` 返回 null，路径在第 119 行死掉**；此时它自己的 `readPixels` 还会因抢来的上下文 `preserveDrawingBuffer:false` 读到空缓冲。 |
| `archive/local/hina-probe.mjs:31-35` | **A（归档）** | `const cv = document.getElementById('sc')` / `const gl = cv.getContext('webgl2')` / `const px = new Uint8Array(cv.width * cv.height * 4)` / `gl.readPixels(…)` | 就是本次事件的历史写法（同一文件族）。不可达性证据：`.gitignore:42 archive/`（`archive/` 整目录排除），无测试 import 它（`tests/layer-rect-check.mjs:91` 只从 `archive/local` 读 `refrender-*.json` 数据）。 |
| `tests/real-machine-check.mjs:245` | **B** | `webgl2 = await p.evaluate(() => { try { return !!document.getElementById('sc').getContext('webgl2') } catch (e) { return false } })` | 顺序保证：同一段前面已经 `await p.goto(url, { waitUntil: 'load' })`（`:226`）→ 等 `__mpwModuleStarted`（`:227-228`）→ 等终态日志（`:232`），而 module 顶层从 `:1728 __mpwModuleStarted=1` 到 `:1935` 是**同步**执行 ⇒ 轮询返回时 1935 必然已跑过。残余：若 module 在 1935 前抛错，这条探针就成为首次调用者（此时渲染器已放弃该画布，无属性可被顶掉），但它的 `webgl2` 读数不再是纯能力读数。 |
| `tests/x11-e2e/pointer-live-test.mjs:138,150,175`、`tests/parallax-live-test.mjs:374-375,425`、`tests/mpkg-*.mjs` 的 `boundingBox`/尺寸读（`mpkg-sweep-test.mjs:204`、`mpkg-videoblack-probe.mjs:46`、`mpkg-noscene-live-probe.mjs:45`、`mpkg-videobase-order-probe.mjs:70`、`mpkg-videobase-live-probe.mjs:46`、`mpkg-videobase-recovery-probe.mjs:37`、`mpkg-solidlayer-fallback-probe.mjs:86,112`）、`bloom-ldr-black-probe.mjs:120`、`minification-quality-probe.mjs:111`、`cover-ab-probe.mjs:231,304`、`bench-renderer-source-test.mjs:313,363`、`bench-dsh-libroot-test.mjs:689`、6 处 `HIDE_SHELL` 里的 `el.querySelector('canvas')` | **B（只读 DOM/截图）** | 例：`const el = document.getElementById('sc')` / `el.addEventListener('pointermove', rec('move'), { passive: true })`；`const r = c ? c.getBoundingClientRect() : null`；`await page.waitForFunction(() => !!window.__mpwFirstFrame, null, { timeout: 180000 })`；`const buf = await page.locator('#sc').screenshot()` | 这些只读元素/盒子/截图，**没有一处 `getContext`**；且多数被页面自报的首帧门控（`cap.firstFrame` / `__mpwFirstFrame` / `__mpwLiveRes`）。 |
| `tests/mock-gl-test.mjs:50`、`tests/meshsize-test.mjs:244`、`tests/multi-instance-test.mjs:47`、`tests/video-quality-test.mjs:90`、`tests/text-layout-test.mjs:59`、`tests/quality-tiers-test.mjs:150` 等 | **C（84 处 mock）** | `const canvas = { getContext: () => gl }` / `getContext(kind) { this._ctx = this._ctx \|\| { kind, getExtension: () => null, getParameter: () => 4096 }; return this._ctx },` / `const c = { __fakeCanvas: true, width: 0, height: 0, getContext: (t) => (t === '2d' ? ctx : null), __ctx: ctx }` | 普通 JS 对象桩，不是 DOM 元素，永远不参与真画布竞争。**但见 §③.6 的"掩盖"一条**：它们全部忽略 attrs。 |
| 测试自建 2d/离屏画布（21 处：`mpkg-sweep-test.mjs:211-212`、`mpkg-videoblack-probe.mjs:52-53`、`mpkg-noscene-live-probe.mjs:52`、`mpkg-videobase-recovery-probe.mjs:43-44`、`mpkg-videobase-order-probe.mjs:76-77`、`mpkg-solidlayer-fallback-probe.mjs:118-119`、`cover-ab-probe.mjs:223-224,320-321`、`minification-quality-probe.mjs:129-130,135`、`bloom-ldr-black-probe.mjs:130-131`、`parallax-live-test.mjs:401`、`video-downscale-flicker-probe.mjs:157-158,166,175`、`bench-renderer-source-test.mjs:322`、`bench-ui-headless-test.mjs:1714-1716`） | **C** | `const c = document.createElement('canvas'); c.width = img.naturalWidth; … const g2 = c.getContext('2d'); g2.drawImage(img, 0, 0)`；`const oc = new w.OffscreenCanvas(bmp.width, bmp.height); const cx = oc.getContext('2d')`；`const c = document.getElementById('trail-canvas'); const g = c.getContext('2d')` | 解码/分析用自建画布；`#trail-canvas` 是测试台页面自己的画布（`demo/index.html:830 <canvas id="trail-canvas" class="trail-canvas" hidden></canvas>`，`demo/bench-patch.js:8287 const …, cv = $('#trail-canvas')`）。 |
| `tests/_gl-browser.mjs:88-104`、`tests/bench-renderer-source-test.mjs:274-281`、`tests/submesh-evidence.mjs:82` | **D** | `const c = document.createElement('canvas')` / `const gl = c.getContext('webgl2')` / `out.ver2 = gl ? String(gl.getParameter(gl.VERSION)) : null` | 能力前置探针，全部在**自建画布**上（前两处在 `about:blank`）；只读 `VERSION`/`UNMASKED_RENDERER_WEBGL`。 |
| `tests/bench-dsh-libroot-test.mjs:655-673` | **D（关键：这是正确做法本身）** | `const orig = HTMLCanvasElement.prototype.getContext` / `HTMLCanvasElement.prototype.getContext = function (type, attrs) { … return orig.call(this, type, attrs) }` | 只对 `this.id === 'sc'` 记录参数后**原样透传**；探针自己绝不建上下文（注释 `:653-654`）。B2d 的断言在 `:771-777`。 |
| `demo/index.html`（全文件）与 `demo/bench-patch.js:8287,8297` | **C** | `const pushEl = $('#pointer-push'), trailOn = $('#trail-on'), veil = $('#pointer-veil'), cv = $('#trail-canvas')` / `trailCtx = cv.getContext('2d')` | 测试台自己的尾迹画布；测试台对渲染器 iframe 只读元素/属性（`:8422 frameEl.contentDocument.documentElement.getAttribute('data-mpw-frame')`、`:8451`）与 postMessage（`:8434`），**不取 iframe 内画布的上下文**。`?shell=0` 的预览黑幕只在 URL 形如 `/(^|\/)webloader\//` 且带 `shell=0` 时武装（`:8400`），揭幕只认 `data-mpw-frame`/`mpw-first-frame`（`:8412`、`:8434`、`:8451`），12s 兜底如实记 `timeouts`（`:8466`）。 |
| `demo/assets/renderer-BOSoB05I.js:607`、`:717`、`:904` | **C（另一份文档的 owner）** | `const n=t.getContext("webgl2",{premultipliedAlpha:!1,antialias:!1,alpha:!1,preserveDrawingBuffer:!0})` / `if(!a.getContext("webgl2",{premultipliedAlpha:!1,antialias:!1,alpha:!1,preserveDrawingBuffer:!0})){…}` / `if(!n.getContext("webgl2",{premultipliedAlpha:!1,antialias:!1,alpha:!1,preserveDrawingBuffer:!0}))throw new Error("WEBGL2_UNAVAILABLE");` | 上游产物页（`demo/renderer/index.html`，`<body></body>` 里**没有** canvas 元素，`<canvas>` 由该 bundle 自建）自己的上下文创建，实参= 本仓要求的四项（硬编码，未走 `glCanvasAttrs`；对 `?aa=msaa` 档不敏感，属另一份文档的一致性问题，不是抢跑）。 |
| `demo/assets/renderer-BOSoB05I.js:2325`（`iw()`） | **C** | `const n=document.createElement("canvas");n.width=n.height=64;const r=n.getContext("2d");` | 自建 64×64 占位缩略图。 |
| `demo/assets/bench-DSKWIqmS.js:209` | **非命中（grep 陷阱）** | `…per spec a subsequent getContext("webgl2") on that same canvas returns the very same lost context object…`（另一条英文同文） | 该文件里 2 处 `getContext("webgl2")` 全在**变更说明字符串**里，不是可执行代码；不要把它当成抢跑点。 |
| `archive/local/demo.html.bak-mdla:62`、`bak-skin:62`、`bak-weralign:62`、`bak-p77-prep:904` | **C（历史物证）** | `const gl = cv.getContext('webgl2', { antialias: true, alpha: true, preserveDrawingBuffer: true });` | 这正是本次缺陷类的**历史版本**（页面写死的 `alpha:true/antialias:true` 顶掉渲染器要求）；`.gitignore:42 archive/` 排除，无活引用。 |
| `tests/quality-tiers-test.mjs:713-717`、`tests/multi-instance-test.mjs:119-120` | **D（静态契约钉子）** | `const hard = html.match(/getContext\('webgl2', \{/g) \|\| []` / `const viaHelper = html.match(/getContext\('webgl2', lib\.glCanvasAttrs\(location\.search\)\)/g) \|\| []`；`/const gl = MPW_MULTI_IDS \? null : cv\.getContext\('webgl2'/.test(HTML)` | 只扫源码文本，**看不见运行期首调用者**（正是 A 桶那两条能溜过去的原因）。 |
| `tools/**`、`packages/**`、`build-pages.mjs`、`check.sh`、`vendor/hlsl2glsl/**`、`elysia/we-renderer/**`、`core/*.mjs`（除上述）、`web/sw*.js`、`demo/now-playing/**`、`demo/default-wallpaper/index.html`、`demo/renderer/index.html` | **未命中（0 处）** | `grep -c "getContext\|canvas"` 在 `vendor/hlsl2glsl/*.js`、`demo/default-wallpaper/index.html`、`demo/renderer/index.html`、`demo/index.html` 均为 **0**；`elysia/we-renderer/canvas.js` 是软件光栅器（`constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8Array(w * h * 4); …`），全 38 个文件无 DOM/GL | 无 A/B 可言。 |

### ③.5 假信号（另见 §④）

| 位置 | 桶 | 证据（原文引用） | 说明 |
|---|---|---|---|
| `dsh-mpkg-wallpaper/lib/client.js:5866` | **假信号缺陷** | `if (section.converted === "scene" && section.sceneKey) return !!(canvas && (canvas.width \|\| 0) > 0);` | 见 §④.1。 |
| `demo.html:7220`、`:7043-7046`、`:2270-2272`、`:7389-7390`、`:7958` | **假信号（弱→强）** | `setTimeout(doReport, 700)` / `sc.drawImage(cv, 0, 0, 480, 270)` / `return window.__mpwSafeDataURL ? window.__mpwSafeDataURL(cv, 'image/jpeg', …) : null` / `const sc = shotScale(cv.width, cv.height, MAXW)` / `if (MPW_BASELINE) MPW_BASELINE.onFrame(now, window.__mpwFrameNo \|\| 0)` | 见 §④.2 / §④.4。 |
| `demo/assets/renderer-BOSoB05I.js:2325`（`capture()`） | **假信号** | `capture(t){const e=ue.canvas??document.querySelector("canvas");if(!e\|\|!e.width\|\|!e.height)return null;…` | 见 §④.2。 |
| `tests/mpkg-sweep-test.mjs:367,372-374`、`tests/mpkg-videoblack-probe.mjs:108`、`tests/cover-ab-probe.mjs:236,260`、`tests/bench-dbg-dpr-probe.mjs:239`、`tests/bench-ui-headless-test.mjs:1690-1691`、`tests/minification-quality-probe.mjs:141-149`、`tests/bench-renderer-source-test.mjs:375`、`tests/mpkg-sweep-test.mjs:326` | **假信号/陈旧前提** | 见 §④.2。 |

### ③.6 计数与"测试面掩盖"

**计数（按"位置"计：同一处多行算一处；mock / 测试自建 / 归档物证这类同形项成组单列）**

| 桶 | 数量 | 明细 |
|---|---|---|
| **A** | **2** | `tests/headless-shot.mjs:66-68`（条件性：`SHOT_URL=?mode=elysia` + 短等待）；`archive/local/hina-probe.mjs:31-35`（归档、`.gitignore` 排除） |
| **B** | **8（file:line）/ 7 处** | `demo.html:1935`、`demo.html:8511`、`demo.html:6859`、`elysia/demo-elysia.js:118`、`core/we-scene-bundle.js:8044`、`core/we-scene.mjs:62`+`:71`（同一处）、`tests/real-machine-check.mjs:245` |
| **C** | **34 处显式 + 84 处 mock + 21 处测试自建 + 7 处归档物证** | 显式 34 = `demo.html` 7 + `core/we-scene-bundle.js` 2 + `web/diag.html` 2 + `web/probe.html` 4 + `demo/assets/renderer-BOSoB05I.js` 4 + `demo/bench-patch.js` 1 + 插件 13（`client.js` 4、`bak` 3、`liquid-glass/renderer.js` 1、`liquid-glass/v2.js` 1、`liquid-glass-bundle.js` 2、`tools/liquid-demo/index.html` 2）+ `web/pwa-inject.mjs` 1 |
| **D** | **12 处** | `demo.html:1939-1941`、`demo.html:181-183`、`demo.html:366`、`core/we-scene-bundle.js:8048`、`:8119`、`elysia/multi-instance.js:140`、`extensions/_example-hook.mjs:9-10`、`tests/_gl-browser.mjs:92,99`、`tests/bench-renderer-source-test.mjs:277`、`tests/submesh-evidence.mjs:82`、`tests/bench-dsh-libroot-test.mjs:659-673`、插件 liquid-glass 探针 3 组 + 3 个 tools 桩（同形，成组） |

> 计数说明：`we-scene-demo/we-scene-bundle.js` 是 `core/we-scene-bundle.js` 的符号链接（`ls -l` 实测），同一份实现不重复计数；
> `demo.html` 的 11 处 `getContext` 命中 = 10 次真实调用 + `:1932` 一处注释。
> `dsh-mpkg-wallpaper` 的 `dist/dsh-mpkg-wallpaper.bundle.mjs` 中 `getContext` = 0。

**测试面：钉子与掩盖（必须一起看，否则 A/B 桶的"当前安全"只是假象）**

- 现有钉子：`tests/quality-tiers-test.mjs:713-717`（源码文本：`getContext('webgl2', {` 必须 0 命中、`glCanvasAttrs` 至少 2 处）、
  `tests/multi-instance-test.mjs:119-120`（源码文本）、`tests/bench-dsh-libroot-test.mjs:352-358`（shim 不许含 `getContext`）、
  `tests/bench-dsh-libroot-test.mjs:771-777`（**唯一运行期端到端**：比对 `#sc` 首调实参四字段）。
- 掩盖：84 处 mock 的 `getContext` **全部忽略实参**（`getContext: () => gl` / `getContext: () => makeMockGL(L, …)`），
  全仓**没有一处** mock 记录 `attrs` ⇒ 属性回归在单测层**不可能**被发现；
  唯一运行期钉子自己又被 GL 能力门控（`tests/bench-dsh-libroot-test.mjs:646 if (!gl.webgl2) { logGLSkip('B 段（预览外壳/首帧）', launchNote, gl); return }`）⇒ 没有 WebGL2 的机器上它静默变绿。

## ④ 「context 存在 / 画布有尺寸 = 已出帧」假信号清单

### ④.1 真缺陷（会导致实际行为错误）

**F1（A 级假信号）`dsh-mpkg-wallpaper/lib/client.js:5866`**

```js
function mpwBgPaintedNow(section) {
    const { img, video, canvas, wrap } = bgElements();
    if (!wrap) return true;
    if (section.webUrl) return true;                       // 帧内画面看不见，不越权判死
    if (section.converted === "scene" && section.sceneKey) return !!(canvas && (canvas.width || 0) > 0);
```

为什么假：这里的 `canvas` 是插件自己的 `canvas.mpw-bgCanvas`（`lib/client.js:2834`），创建时**不写宽高**
（`lib/client.js:2819-2822 const canvas = document.createElement("canvas"); … canvas.style.display = "none";`）⇒
`canvas.width` 是 HTML 默认 **300**，任何"元素存在"都让它为真；而唯一的写入者 `lib/client.js:5734
if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }` 在**所有图层都加载失败**时
照样执行（`lib/client.js:5752-5756 im.onerror = () => { pending--; if (pending === 0) draw(); };`，而 `:5744 if (!im || !im.width || !im.height) continue;`
把绘制全跳过）。⇒ 该判据退化成"元素在不在"。
具体后果：12s 慢判补挂永不触发（`lib/client.js:5898-5902` → `:5913 const bad = fast ? !mpwBgArmedNow(s) : !mpwBgPaintedNow(s);` → `:5928-5938` 强制重挂），
图层 404/失效的场景合成会永久黑屏且无自愈；同一函数里视频档用的是真证据（`:5879 return rs >= 2 && vw > 0;`、`:5883 return !!(img.complete && (img.naturalWidth || 0) > 0);`）。
诚实信号：在**真的执行过 `drawImage` 之后**落一个绘制戳（如 `drawnAt` / `sceneImgs.some(im => im && im.naturalWidth > 0)`），而不是读 backing store 尺寸。

### ④.2 取证侧假信号（测试/探针把非证据当证据）

| # | 位置 | 假在哪 | 诚实信号 |
|---|---|---|---|
| F2 | `tests/mpkg-sweep-test.mjs:367` + `:372-374` | `const nonEmpty = !!(px && !px.err && px.maxL > 0 && px.litFrac > 0.0005)` → `else rec.verdict = 'PASS 出画'`：判据是**按 `#sc` 盒裁剪的截图非黑**，而默认**不摘外壳**（`:329-333`）；同文件 `:186-187` 自己记着"第一版实测 6 个 PKGM0014 的 meanL 全在 92.9~93.9 … 那是外壳，不是画面" | 同一次读数里已经采到 `:174 firstFrame: !!g('__mpwFirstFrame')`（`:379` 打印）——把它纳入 verdict |
| F3 | `tests/mpkg-videoblack-probe.mjs:108` | `' ⇒ ' + (result.variants.every((v) => (last(v).pixels.maxL \|\| 0) > 4) ? '**各档最终都出画**（黑是采样时机/首帧）' : …)`：只看像素 `maxL`；`firstFrame: !!window.__mpwFirstFrame` 在 `:95` 采了却不用 | `__mpwFirstFrame` / 渲染器 `首帧` 日志行（它自己 `:101` 已在过滤 `首帧`） |
| F4 | `tests/cover-ab-probe.mjs:236,260` | `blank: !bbox \|\| bbox.cover < 0.05` → `ok(!dRepo.blank && !dUp.blank, 'W2 两档都画出了内容（背景占比 <95%）', …)`：整视口内容包围盒，而外壳只在 repo 档被藏（`:202-209`）⇒ 上游档的产品 UI 本身就能满足 | 同文件 `:308 live: … w.__mpwLiveRes ? (…) : null`（已采未用）；`__mpwFirstFrame` 从未读 |
| F5 | `tests/bench-dbg-dpr-probe.mjs:239` | `ok(b.frameW > 0 && b.frameH > 0, 'P1b 切换后 iframe 仍有内容尺寸（不是白屏/塌成 0）', …)`：iframe 的 CSS 盒非零与画布是否画过毫无关系（同文件 `:248-249` 自认不做像素级断言） | `__mpwFirstFrame`；P1/P2 已在用的 `__mpwLiveRes`（`:233/:237`） |
| F6 | `tests/bench-ui-headless-test.mjs:1690-1691` | `z.shot.bytes > 1000` ⇒ "有场景时给出 JPEG"：`bytes` 来自 `__wp.capture(0)` 的 data URL 长度（`demo/bench-patch.js` `return { name, bytes: data.length }`），**空画布的 JPEG 也有几 KB** | 同 evaluate 里的 `layers: P.dbgLayers()` / `cap.firstFrame` |
| F7 | `tests/minification-quality-probe.mjs:141-149` | `else ok(true, '读数已取得…', 'mae=' + diff.mae)`：只被 `if (!gl.webgl2)` 门控；同文件 `:87-88` 自己写明"两边截到的都是同一张空画布（300×150），`mae` 读到 **0** —— 那个数字看着像'缩采样质量完美'，其实是**没渲染**" | 已在 `:113` 采到的 `live: window.__mpwLiveRes \|\| null`（把它作为 `ok()` 前提） |
| F8 | `tests/bench-renderer-source-test.mjs:375` | 上游档就绪判据 `out.ok = !!cv && cv.width > 0`：`cv.width > 0` 由 300×150 默认值即满足；同文件 `:342` 自己记着"repo0 因此读到过 300×150 空画布" | 本仓档已用了 `out.ok = !!cv && cv.width > 0 && !!w.__mpwLiveRes`（`:370`）；上游档该加等价信号 |
| F9 | `demo/assets/renderer-BOSoB05I.js:2325`（`capture()`） | `capture(t){const e=ue.canvas??document.querySelector("canvas");if(!e\|\|!e.width\|\|!e.height)return null;…}`：① `!e.width` 被 300×150 默认值满足；② `querySelector("canvas")` 取"文档里第一块画布"而不是渲染器那块 ⇒ 宿主页有别的画布时会把**别人的/空白的**画布当渲染结果导出 | 渲染器自写的首帧标记 / `mpw-first-frame` 消息 |
| F10 | `tests/mpkg-sweep-test.mjs:326` | 前提句 `"重新绘制"路径，而 WebGL 画布是 preserveDrawingBuffer:false（默认）⇒ 重绘拿到的是已被清空的缓冲。`——**与本仓契约矛盾**：`#sc` 走 `lib.glCanvasAttrs()`（`preserveDrawingBuffer:true`），上游产物页也是 `preserveDrawingBuffer:!0`（`demo/assets/renderer-BOSoB05I.js:607/:717/:904`） | 该机制只在"第一次 `getContext` 没带所有者 attrs"时成立 ⇒ 这句注释会把**属性被抢跑**的症状误归因成"浏览器默认行为"；应改为引用 `glCanvasAttrs()` 的实参 |

### ④.3 反向缺口：真出帧，但没有诚实信号

**F11 `elysia/demo-elysia.js:143`** —— `ctx.putImageData(imgData, 0, 0);` 是 elysia 路径的真出帧点，
但该路径不写 `window.__mpwFirstFrame` / `window.__mpwFrameNo` / 不调 `__mpwCapMarkFrame`（`elysia/**` 内 `firstFrame` 只出现在 `multi-instance.js:184/:378`）。后果：
`demo.html:242 firstFrame: CAP_FRAME || !!window.__mpwFirstFrame` 在 elysia 档恒为 false，`:270-274` 的 8s 轮询永不成功，
而修好的 shim 的 `honest()`（`server/we-scene-demo-server.mjs:565-567`）同样永远不会命中 ⇒ `?shell=0` 预览黑幕只能等父页 12s 兜底。
诚实修法方向：在 elysia 首帧 `putImageData` 之后置同一位（或让 shim 额外读一个 elysia 自写标记）。

### ④.4 不构成假信号（对照，避免误伤）

- `demo.html:7389-7390` `const sc = shotScale(cv.width, cv.height, MAXW)` / `if (!sc.w || !sc.h) { … 画布尺寸为 0 … }`：
  尺寸本身不是帧证据，但唯一调用者是帧末钩子 `demo.html:7953 if (window.__mpwShotFrameTick) window.__mpwShotFrameTick(tSec, window.__mpwFrameNo || 0, cv)`（在 `renderer.render(...).then(...)` 续体里）⇒ 被调用方真帧门控。
- `demo.html:181-183` `window.__mpwSafeDataURL = function (canvas, type, quality) { try { return canvas.toDataURL(type, quality) } catch (e) { markTainted(); return null } }`：
  它只判"跨源污染"，**不是**帧判据；消费者（`:366` 截图、`:2272 __wp.capture`、`:7103/:7398/:7899` 上报）把它当"拿到了帧"是**用错了**（见 §④.2 F5 同类），但函数本身诚实。
- `demo.html:7958` `if (MPW_BASELINE) MPW_BASELINE.onFrame(now, window.__mpwFrameNo || 0)`：
  语义偏差而非假绿——它在 rAF 帧里、`render()` **派发**的那一拍被调用，而 `window.__mpwFrameNo` 的自增在 `render(...).then(...)` 续体里（`:7930`）⇒ 首次 `noteFrame` 的 `frameNo` 是 0；
  `core/baseline-metrics.mjs:405 if (firstTs === null) { firstTs = t; probeState(t) }` 把它当 `navToFirstFrameMs`（`:427`），而文档口径是"导航 → **首帧画完**"（`:166`）⇒ 这是"首次派发"而非"首次出画"。
- `demo.html:7879`（`window.__mpwFirstFrame = 1` 只在 `__first` 且 primary 时写）、`:7930`（`__mpwFrameNo` 自增）、
  `server/we-scene-demo-server.mjs:563-577`（shim 三个只读信号）：**诚实信号的正样本**。
- `tests/x11-e2e/pointer-live-test.mjs:117,133`、`tests/x11-e2e/select-live-test.mjs:86-108`、`tests/parallax-live-test.mjs:425`、
  `tests/mpkg-videobase-recovery-probe.mjs:82`、`tests/bench-renderer-source-test.mjs:370`：已按真帧信号门控的正样本。

## ⑤ 复现 / 取证命令（只记录、原样透传，绝不自己创建上下文）

> 服务面：`http://127.0.0.1:8902`。渲染器页在 `/webloader/**`（`server/we-scene-demo-server-8902.mjs:2803`
> 把 `/webloader/` 改写成 `/` 后交给 `rendererRequestHandler`，所以 `?shell=0` 注入与 `:8899` 完全同一份实现）。
> 下列命令**本次审计未执行**（任务要求静态只读），仅描述。

### ⑤.1 纯文本面（不起浏览器，先排除"注入物自己碰画布"）

```bash
# ① shim 全文不许出现 getContext（0 命中才过）
node -e "const s=require('node:fs').readFileSync('server/we-scene-demo-server.mjs','utf8');const m=s.match(/export function shellShimScript\(\)[\s\S]*?\n}/);console.log('getContext hits =', (m[0].match(/getContext/g)||[]).length)"
# ② 活体响应里 shim 存在、且响应体不含 getContext（不带 ?shell=0 时响应逐字节不变）
curl -s 'http://127.0.0.1:8902/webloader/?id=<真实壁纸 id>&shell=0' | grep -c 'mpw-noshell-frame'
curl -s 'http://127.0.0.1:8902/webloader/?id=<真实壁纸 id>&shell=0' | grep -c 'getContext'
```

### ⑤.2 活体：开页**之前**装透传记录器（唯一正确姿势）

要点：**只记录 + 原样 `call through`**；探针自己**不调用** `getContext`、不改 `attrs`、不写 `canvas.width/height`；
`addInitScript` 对页面本身**与后续每个 iframe** 都生效（这正是跨到预览 iframe 里的原因）。
仓内参考实现：`tests/bench-dsh-libroot-test.mjs:651-674`（记录器）与 `:771-777`（断言）。

```js
// 伪代码（Playwright；仓库里已有同款实现）
await page.addInitScript(() => {
  const rec = []
  const orig = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    try {
      if (this && this.id === 'sc') {
        rec.push({ t: Math.round(performance.now()), type, hasAttrs: !!attrs,
          alpha: attrs ? attrs.alpha : null,
          premultipliedAlpha: attrs ? attrs.premultipliedAlpha : null,
          antialias: attrs ? attrs.antialias : null,
          preserveDrawingBuffer: attrs ? attrs.preserveDrawingBuffer : null })
      }
    } catch (e) { /* 只记录，失败不影响页面 */ }
    return orig.call(this, type, attrs)          // ← 必须原样透传，绝不自己建上下文
  }
  window.__ctxSc = rec
})
await page.goto('http://127.0.0.1:8902/webloader/?id=<真实壁纸 id>&shell=0', { waitUntil: 'domcontentloaded' })
// 预览场景：真正开页的是测试台 iframe（#frame）；直接开 /webloader/ 时用 window
const read = await page.evaluate(() => {
  const fr = document.querySelector('#frame')
  const w = fr ? fr.contentWindow : window
  return { rec: w.__ctxSc, url: w.location.href,
    frameFlag: w.document.documentElement.getAttribute('data-mpw-frame'),
    firstFrame: !!w.__mpwFirstFrame, frameNo: w.__mpwFrameNo || 0,
    webFrame: w.__mpwWebFrame ? (w.__mpwWebFrame.ready || w.__mpwWebFrame.readyMs > 0) : null }
})
```

### ⑤.3 读数怎么判（三条硬判据 + 一条附带判据）

1. `rec[0]`（`#sc` 上**第一次**调用）必须逐字段等于 `lib.glCanvasAttrs(location.search)` 的期望：
   `alpha:false`、`premultipliedAlpha:false`、`preserveDrawingBuffer:true`、`antialias` 随 `?aa=` 档
   （`off`/`fxaa` ⇒ false；`msaa2/msaa4` ⇒ true）。
   **缺陷指纹**：`rec[0].hasAttrs === false`（旧 shim 的读数是 `attrs:null` ⇒ `alpha:true / premultipliedAlpha:true / antialias:true / preserveDrawingBuffer:false`）。
2. 单实例（不带 `?ids=`）`#sc` 应只有 **1** 条记录；带 `?ids=` 时 `#sc` **0** 条、每个 `.mpw-inst-cv` 各 1 条
   （对应 `demo.html:1935` 的 `MPW_MULTI_IDS ? null : …` 与 `:8511`）。
3. `data-mpw-frame` 只允许在 `firstFrame === true` 或 `frameNo > 0` 或 `webFrame === true` **之后**出现；
   仅凭"context 存在"或 `canvas.width > 0` 就置位 = 假首帧（这正是本次事件）。
4. 附带（只读、不算 A/D 之外的副作用）：对**已存在**的 gl 读 `gl.getContextAttributes()` 与 `glCanvasAttrs()` 比对；
   `getContextAttributes` 全仓目前**没有任何调用点**（只在 `core/we-scene-bundle.js:8065` 注释里出现），是现成的、可加的启动自检。

## ⑥ 建议的修法（方向，不改代码）

1. **取用口唯一化 + 抢跑可观测**：在 `core/we-scene-bundle.js` 提供唯一取用函数（内部 `getContext('webgl2', glCanvasAttrs(search))`，
   已存在上下文时改读 `getContextAttributes()` 做一致性比对），并让任何想碰 `#sc` 的代码只能走它；
   启动时把比对结果写进 `window.__mpwCap`/启动日志（宿主与插件都能看到"属性是否被顶掉"）。
   诊断面可加一个**只记录、只透传**的 `?ctxprobe=1`（就是 §⑤.2 那层包装），但它必须在任何页面脚本之前安装、且永不创建上下文。
2. **elysia 路径补齐诚实信号**：在 `elysia/demo-elysia.js:143` 首次 `putImageData` 之后置 `window.__mpwFirstFrame` / 自增 `window.__mpwFrameNo`（并调 `__mpwCapMarkFrame`），
   让 `?shell=0`、`mpw-cap`、7s 看门狗在 CPU 路径上也有真判据（当前 F11）。
3. **测试/取证纪律（把 A 桶变成不可能）**：任何探针在碰 `#sc` 前先等 `__mpwFirstFrame`/`__mpwFrameNo>0`/`mpw-cap.firstFrame` 之一；
   读像素用**元素截图**或从既有上下文 `readPixels`；确实需要"能力"读数时只在**自建画布**上建；
   `tests/headless-shot.mjs` 应显式拒绝/等待 `?mode=elysia`（或先等首帧日志），`archive/local/hina-probe.mjs` 保持归档、不得回流。
4. **`demo.html:6859` 的死代码**：不要在已有 webgl2 的画布上要 2d；上下文丢失提示改用 DOM 覆盖层（或 GL 里画），并加注释说明"这一句提前一句就是抢跑"。
5. **库入口防线**：`core/we-scene.mjs` 接管 `opts.canvas` 时校验"无上下文 或 `getContextAttributes()` 与 `glCanvasAttrs()` 一致"，不一致就**明确报错**（现在的表现是 `core/we-scene-bundle.js:8045` 误报"当前浏览器不支持 WebGL2"）。
6. **假信号全面替换**：插件 `lib/client.js:5866` 换成绘制戳；`demo.html` 的 `capture()/shot()/上报截图` 在 `__mpwFrameNo === 0` 时返回明确失败而不是空图；
   `core/baseline-metrics.mjs` 的 `navToFirstFrameMs` 要么把 `onFrame` 移进 `render(...).then(...)`（`:7958` → `:7879` 那一拍），要么按"首次派发"改名；
   上游产物页 `capture()` 别用 `querySelector("canvas")` 猜身份。
7. **把"注入物不许碰 getContext"做成通用门禁**：现在只钉了 `shellShimScript()`（`tests/bench-dsh-libroot-test.mjs:352`）。
   建议把扫描面扩到**所有**注入/改写源（`server/we-scene-demo-server.mjs`、`core/we-web-shim.mjs`、`web/pwa-inject.mjs`、
   插件的 `lib/web-wallpaper.js` 注入片段、`demo/bench-patch.js` 对预览页的注入），断言其中 `getContext` = 0。
8. **单测层面的属性契约**：mock canvas 的 `getContext(type, attrs)` 应记录 `attrs`，并对 `glCanvasAttrs()` 做断言；
   `tests/bench-dsh-libroot-test.mjs` 的 B2d 在无 WebGL2 时不要静默 SKIP 成绿（应记"未验证"）。

## 附录 A：本次未覆盖 / 诚实边界

- **未执行**：测试套件、Playwright/Firefox/Chromium、任何浏览器活体读数、任何 `curl` 对 8902 的请求、git 命令。
  所有"真机读数"均引自仓库内的既有证据（`server/we-scene-demo-server.mjs:544-548`、`tests/bench-dsh-libroot-test.mjs:345-350`、`docs/PATCHES.md:13384`）。
- **文件系统怪癖**：本机 `find -type f` 会漏掉 dirent 被报成 symlink 型的条目（已确认至少 `web/diag.html`、`web/probe.html`、`core/we-scene.mjs`、
  `core/we-web-shim.mjs`、`elysia/media-lyrics.js`、`dsh-mpkg-wallpaper/lib/liquid-glass/**`、`tools/*.mjs` 的一部分）。
  本文所有 grep 结论都用 `-type f -o -type l` 或直接点名复核过。
- **未验证项（明确列出，不当结论）**：各测试文件在**当前 CI 真机上**是否真的会跑到 A 桶那两条（取决于调用参数）；
  `tests/headless-shot.mjs` 的实际 `SHOT_URL` 取值（默认值已核：`:26`）；插件在该机上的 `lgComposer/lgSidebar/lgHeader` 开关状态（液态玻璃现为 CSS 版，与画布无关）。
- **没有发现但值得记住**：`getContextAttributes()` 全仓 0 调用点；`evaluateOnNewDocument` 0 命中；`tools/**`、`packages/**`、`build-pages.mjs`、`check.sh` 中 canvas/getContext 代码 0 行。

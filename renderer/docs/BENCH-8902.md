# BENCH-8902 —— 一站式测试台服务（`server/we-scene-demo-server-8902.mjs`）

> 用户原话：「我现在打开的离线页面是这样的，**怎么去进入一个在线的页面**」。
> 他看到的 `:8901` 是**纯静态**：`/api/*` 与 `/diag` **全 404** ⇒ 壁纸库列表、属性保存、删除、打开所在文件夹、
> 渲染器诊断流**一个都用不了**（页面左侧栏自己会写「静态托管（无 /api 后端）」，诊断区置灰）。
> 本文件交付的就是那个"带后端的页面"：**一个 origin 同时提供 静态测试台 + `/api/*` + 渲染器 iframe 页 + 壁纸媒体面 + 诊断流**。

* 服务文件：`server/we-scene-demo-server-8902.mjs`（零依赖，与既有 `server/we-scene-demo-server.mjs` 同风格）
* 自证测试：`tests/bench-server-test.mjs`（秒级；含变异 RED）
* 端口：默认 **8902**（`:8899` 渲染器页 / `:8901` 纯静态台**都不动**，本服务是**新增**）

---

## 1. 为什么要有第三个端口（与 `:8899` / `:8901` 的关系）

| 服务 | 是什么 | 有 `/api/*` 吗 | 有测试台页面吗 | 有渲染器 iframe 页吗 | 有诊断流吗 |
|---|---|---|---|---|---|
| `:8899` `server/we-scene-demo-server.mjs` | **渲染器**演示页（`/`、`/bundle.js`、`/elysia/**`、`/shaders/**`、`/diag`、`/baseline`、`/ext`、`/noise`） | ✗ | ✗ | ✗（它自己就是渲染器页，但不是产物写死的那条 URL） | ✓（它自己的 `/diag`） |
| `:8901` 纯静态台 | 把 `demo/` 的**产物**按 Pages 布局静态托管（`/`、`/demo/`、`/WEwebLoader/`、`/wallpaper-engine-webgl/`） | ✗（**404**） | ✓ | ✓（同布局下 `/wallpaper-engine-webgl/renderer/index.html` 200） | ✗（404） |
| **`:8902`（本服务）** | 上面两半的**合成**：静态面照抄 `:8901` 口径 + 测试台要的 8 个 `/api/*` + 媒体面 + 诊断流 | ✓ | ✓ | ✓（**同一条写死的 URL**） | ✓（本服务自己的环形缓冲） |

**为什么不能"直接在 `:8901` 上加 API"**：`:8901` 是"线上静态托管形态"的**真访问口径**（`docs/ONLINE-DEMO.md` §1 明确它要能代表 GitHub Pages：
没有本机后端时页面该显示什么）。给它塞 `/api/*` 会让"静态托管的降级形态"没法再被验证。
**为什么不加在 `:8899` 上**：`:8899` 的 URL 契约（`/bundle.js`、`/elysia/**`、`/baseline`…）被 60+ 个测试当**判据**用，
增删路由会污染那些判据；且 `:8899` 的 `/` 是渲染器页而不是测试台。⇒ **新增第三个端口**，互不影响。

### 1.1 一个必须写下来的发现：测试台 iframe 的渲染器 URL 是**写死的绝对旧路径**

产物里（`demo/assets/bench-DSKWIqmS.js` @83849、@93800）：

```js
const Ye="dev",re=`${location.origin}/media/${Ye}`,It=`${location.origin}/web/${Ye}`   // ← 媒体面基址
…
k.src=`/wallpaper-engine-webgl/renderer/index.html?${e}&_t=${Date.now()}`              // ← 3 处，绝对路径
```

⇒ **`:8902` 必须**让 `/wallpaper-engine-webgl/renderer/index.html` 指向 `demo/renderer/index.html`，否则"列表点得动、画面永远出不来"。
本服务把 `demo/` 同时挂在 **`/`、`/demo/`、`/WEwebLoader/`、`/wallpaper-engine-webgl/`** 四个挂载点下（最后一个就是为这条写死路径）。
另外 `demo/index.html` 是 `<base href="./">` + `./assets/…` ⇒ 挂在 `/` 时资源在 `/assets/**`，本服务也照此服务（即"根挂载点"）。

---

## 2. 8 个 `/api/*` 的**真实契约**（逐条给产物里的证据片段）

> 下面每条的"调用方"都是**预构建产物**（不可重建的 minified 包）：`demo/assets/bench-DSKWIqmS.js`（下称 **bundle**）
> 与 `demo/bench-patch.js`（下称 **patch**）。`@<字节偏移>` 是指令 `node -e '…s.indexOf(…)'` 在文件里的偏移，便于复核。
> **形状以调用方为准**，本服务只做"它读什么就给什么"，不发明字段。

### 2.1 `GET /api/library` —— 列表

```js
// bundle @89060（加载列表）
const t=await(await fetch("/api/library")).json();
if(B.textContent=t.dir,B.title=t.dir,le.textContent=t.dir,t.error){b(t.error,!0);return}
ne=t.items;const n=a=>ne.filter(o=>rt(o)===a).length
// bundle @89726（启动探测：200 + JSON ⇒ "本机 Node 后端在"，否则静态托管）
const e=await fetch("/api/library",{headers:{accept:"application/json"}});
return e.ok&&(e.headers.get("content-type")??"").includes("application/json")
```

| 事实 | 证据 |
|---|---|
| 方法 `GET`，`Accept: application/json` | @89726 |
| 200 时 body `{dir:string, items:[]}`（`dir` 显示在左侧栏/标题） | @89060 |
| `error` 字段存在并被显示 ⇒ **库根不存在时给 `items:[]` + `error`**，且**仍是 200**（探测靠 `e.ok` 判"后端在"，用 5xx 会让页面误判成静态托管） | @89060/@89726 |
| 列表项筛选：`rt(o)` = `o.hasScene ? "scene" : o.type.toLowerCase()`，只有 `web`/`video`/`gif` 三类能上屏 | @86703 |
| 列表项字段：`n.itemId`、`n.title`、`n.preview` ⇒ `img.src = \`${re}/${n.itemId}/${n.preview}\``（`re` = `/media/dev`） | @91239/@83849 |
| 打开壁纸：`e.hasScene?"scene":e.type.toLowerCase()`；scene ⇒ `src=e.itemId`；web ⇒ `src=\`${It}/${e.itemId}/${e.file??"index.html"}\``；video ⇒ `src=\`${re}/${e.itemId}/${e.file}\`` | @93620 |
| patch 侧：`hostLibrary()` 读 `j.items`；`brandingForItemId()` 用 **`it.itemId` / `it.preview` / `it.title`**；`propertiesForItemId()` 直接把 **`it.properties`** 交给 `dragPropsToDisable()`（它读 `v.type`/`v.text`）⇒ **`properties` 必须是 project.json 里的原始 map** | patch @192363/@192516/@192681 |

**本服务的响应**（`items[]` 每项）：

```json
{ "itemId": "3554161528", "dir": "3554161528", "title": "Blue Archive-Sorasaki Hina 空崎日奈[4K]",
  "type": "Scene", "hasScene": true, "file": "scene.json", "preview": "preview.gif",
  "scenePkg": "scene.pkg", "kind": "scene", "workshopid": "3554161528",
  "properties": { "clock": { "type": "bool", "text": "时钟", "value": false, … } } }
```

* `hasScene`：按 **renderer bundle 的候选表**逐字判定 `scene.pkg` / `scenes/scene.pkg` / `gifscene.pkg`（`c1`，见 §2.9）。
* `type`：`project.json.type` 原样（真实语料是 `scene/Scene/web/Web/video/…` 大小写混写）；缺失时按文件嗅探。
* `preview`：`project.json.preview` 或 `preview.gif|jpg|jpeg|png|webp` 里的第一个（**只给文件名**：调用方自己拼 `/media/dev/<id>/<preview>`）。
* `properties`：`project.json.general.properties` 的**原始 map**（不是 §2.3 的描述子数组；patch 的 `dragPropsToDisable()` 要原始 `{type,text}`）。
* `dir`：相对库根（列表里不铺绝对路径；顶层绝对根在 `library.dir`）。
* 逃出库根的符号链接条目**直接跳过**（不列出来，也不让整表报错）。

### 2.2 `POST /api/library-dir` —— "选择文件夹"

```js
// bundle @88253（用户手输/回退路径都被接受）
const t=await fetch("/api/library-dir",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({dir:e})});
const n=await t.json(); if(!t.ok||n.error)throw new Error(n.error||`HTTP ${t.status}`); localStorage.setItem(Me, n.dir??e)
// bundle @88546（点「选择文件夹」按钮）
const e=await fetch("/api/library-dir",{method:"POST",…,body:JSON.stringify({pick:!0})}),t=await e.json();
if(!e.ok||t.error) throw new Error(t.error||`HTTP ${e.status}`);
if(t.cancelled){ if(!t.unsupported) return; const n=window.prompt(p("prompt.libDir"),…); … await ut(n.trim()) }   // ← 回退到"手输"
else if(t.dir) localStorage.setItem(Me,t.dir)
```

| 事实 | 证据 |
|---|---|
| `POST` + JSON body | @88253 |
| `{dir:"…"}` ⇒ `{dir:"<生效的库根>"}`；**非 2xx 或 `error` ⇒ 前端抛错** | @88253 |
| `{pick:true}` ⇒ 宿主对话框；**本服务没有宿主**，要触发前端自己的 `window.prompt` 回退 **必须**回 `200 + {cancelled:true, unsupported:true}`：`if(!e.ok||t.error) throw` **在** `if(t.cancelled)` **之前** | @88546 |

**本服务的实现（`/__health.degraded[]` 里如实登记）**：

* `{pick:true}` → **200** + `{cancelled:true, unsupported:true, degraded:true, degradedStatus:501, picker:"unsupported", reason, hint}`
  —— 能力状态**就是 501（没有宿主对话框）**，但 HTTP 状态**故意用 200**：调用方把非 2xx 当硬失败（上面那行 `throw`），
  回 501 会**掐掉它自己的 prompt 回退**。所以"降级"用 body 说清楚（`cancelled` 已经表示"没选成"），**不假装成功**。
* `{dir:"…"}` → **真能力**：把**活动库根收窄到配置库根内的子目录**（词法 + 真身双校验）；`{reset:true}` 还原。
  越根 ⇒ 403，相对 `..` ⇒ 400。响应回生效的 `dir`，前端存进 localStorage 后重新 `GET /api/library`。
* `GET /api/library-dir?dir=…` → **只读枚举**库根内子目录（本服务自加的脚本化能力，前端不用；逃逸符号链接不列出）。

### 2.3 `GET /api/props` / `POST /api/props` —— 用户属性读/写

```js
// bundle @99446（读）
const n=await(await fetch(`/api/props?item=${encodeURIComponent(e)}`)).json();
if(n.error)throw new Error(n.error);
z=n.props??[], y=Object.fromEntries(z.filter(o=>o.value!==null).map(o=>[o.name,o.value]));
const a=z.filter(o=>o.overridden).length
// bundle @100008（写：**body 就是"属性名→值"的覆盖表**，只发与默认不同的项）
const n=await(await fetch(`/api/props?item=${encodeURIComponent(S)}`,{method:"POST",…,body:JSON.stringify(e)})).json();
if(n.error)throw new Error(n.error)
```

描述子（`props[]` 的元素）**被读到的字段**（渲染分支 @103903–@105900）：

| 字段 | 读它的地方 | 说明 |
|---|---|---|
| `name` | `y[e.name]`、`x(e.name,…)`、过滤 `${s.name} ${s.text}` | 属性名（WE 作者自定：`clock`、`newproperty1`…） |
| `text` | `se(e)` → 标题；`Be()` 判"这串 HTML 像不像图片地址" | 原始文案（可含 HTML） |
| `ptype` | `s.ptype==="group"/"text"/"bool"/"color"/"slider"/"combo"/"file"/"directory"/"scenetexture"`，默认 ⇒ 文本框 | **就是 WE 的 `type`**（无 `type` ⇒ `"text"`） |
| `value` | `y[e.name]`；`value===null` 的项**不进覆盖表** | 生效值（有覆盖用覆盖，否则用 `default`） |
| `default` | `!xe(y[e.name],e.default)` ⇒ `overridden` 样式；`↺` 恢复默认 | project.json 里的值 |
| `overridden` | `z.filter(o=>o.overridden).length`（"已改 N 项"） | 覆盖文件里有没有这个键 |
| `condition` | `me(s.condition, y)` 客户端求值 | 原样透传（表达式引擎在页面里） |
| `media` | `St(e)` → `{src,href}`，相对 src 用 `${re}/${itemId}/${src}` | 本服务从 `text` 的 `<img>/<a href>` 里**抽出来**（宿主职责） |
| `min`/`max`/`precision`/`step` | slider 分支 | 原样透传 |
| `options` | combo 分支：`d.label` 显示、`d.value` 回写 | 原样透传（`{label,value,condition?}`） |
| `fileType` | `dn(e.fileType)` → `input.accept` | 原样透传 |

**本服务的实现**：

* 读：`<库根>/<itemId>/project.json` → `general.properties`（**真实 WE 是 map**：`{属性名: {type,value,text,condition,order,…}}`，
  实测 3554161528 的 35 项 `{bool:15,color:4,slider:7,group:5,combo:1,无type:3}`）⇒ 按 `order ?? 100+index` 稳定排序输出**扁平数组**，
  `group` 作为分隔项（调用方自己把其后的项归到该组）。`text` 里的 `<img>` 抽成 `media`。
* 写：`POST` body（覆盖表）落 **`<MPW_REPORTS_DIR>/bench-props/<itemId>.json`**（原子写：临时文件 + rename），
  **绝不写进壁纸包**（测试 D7 用"目录 名字+大小 指纹前后逐字相同"钉死这一条）。
* 校验：属性名必须单段（`/^[A-Za-z0-9_][A-Za-z0-9._-]*$/`），值只允许 `string|number|boolean|null`（`null` = 删除该项覆盖）。

### 2.4 `POST /api/props-dir` —— 目录型属性的"选择目录"

```js
// bundle @102037
const n=await fetch("/api/props-dir",{method:"POST"}), a=await n.json();
if(!n.ok||a.error) throw new Error(a.error||`HTTP ${n.status}`);
if(a.cancelled){ if(!a.unsupported) return; const o=window.prompt(p("props.dirPh"), String(y[e]??"")); … x(e,o.trim()); return }
a.value && x(e,a.value)
```

⇒ 与 §2.2 同构：`{pick}`（无 body）要宿主对话框；**本服务回 200 + `{cancelled:true, unsupported:true, degraded:true, degradedStatus:501}`**，
前端回退到 `window.prompt` 让用户手输绝对路径（用户输入的值只写进"属性覆盖文件"，服务侧**不读**这个路径）。
本服务另给脚本化能力：`GET /api/props-dir?item=` 枚举库根内目录；`POST {dir:"库根内的路径"}` 回该目录的绝对路径 `value`。

### 2.5 `POST /api/props-file` —— 文件型属性导入

```js
// bundle @101630
const o=await fetch(`/api/props-file?item=${encodeURIComponent(S)}&name=${encodeURIComponent(e)}`,
  {method:"POST",headers:{"X-Filename":encodeURIComponent(t.name)},body:t});     // body = File 本体（原始字节）
const r=await o.json(); if(!o.ok||r.error||!r.value) throw new Error(r.error||`HTTP ${o.status}`); x(e,r.value)
```

* 文件名走 **`X-Filename` 头**（`encodeURIComponent` 后的），**不在 query 里**；query 只有 `item` 与 `name`。
* 响应必须有 **`value`**（调用方 `!r.value` 就抛），并被写进属性覆盖。
* **本服务**：字节落 `<reports>/bench-props/files/<itemId>/<name>/<filename>`（**不进壁纸包**），
  `value` 回**同源可回读的 URL** `/api/props-file/<itemId>/<name>/<filename>`（`GET` 原样回字节），另附 `filePath` 绝对路径。
  文件名必须单段（`..`/分隔符 ⇒ 400）。**未证实**：renderer 的贴图解析会不会认这个 URL（见 §6）。

### 2.6 `POST /api/delete` —— 删除（**默认 dryRun**）

```js
// bundle @93296
if(window.confirm(p("confirm.delete",{title:e.title,id:e.itemId})))
  { const t=await fetch("/api/delete",{method:"POST",…,body:JSON.stringify({itemId:e.itemId})}),n=await t.json();
    if(!t.ok||n.error) throw new Error(n.error||`HTTP ${t.status}`); … await Te() }        // Te() = 重新 GET /api/library
```

* 请求只有 `{itemId}`，**没有** confirm/dryRun 字段 ⇒ **默认行为由服务定**：本服务**默认 dryRun**（只回计划，一个文件都不动），
  真删要显式 `POST /api/delete?confirm=1`（query 是服务侧扩展：调用方不会拼它，所以"页面点删除"永远是安全的 dryRun）。
* 真删 = **移到** `<MPW_ROOT>/Delete/bench-trash/<ISO 时间戳>/<itemId>/`（先 `rename`，跨设备 `EXDEV` 时才 `cp+rm`），
  响应回 `to` 与 `rollback`（一条 `mv` 命令）⇒ **可回滚**。
* 页面表现：dryRun 时调用方仍显示"已删除：<id>"（它只看 `error`）⇒ 本服务**同时往诊断流写一条**
  `bench: 删除为 dryRun（未移动任何文件）…真要删请用 ?confirm=1`，让用户在页面的日志区看见真相。

### 2.7 `POST /api/reveal` —— 打开所在文件夹

```js
// bundle @91972
const t=await fetch("/api/reveal",{method:"POST",…,body:JSON.stringify({itemId:e})}),n=await t.json();
if(!t.ok||n.error) throw new Error(n.error||`HTTP ${t.status}`); b(p("ok.reveal",{id:e}))
```

* 只接受**库根内**的 `{itemId}` 或 `{path}`（先做路径校验，**再看打开器**：逃逸 ⇒ 403，不是 501）。
* 打开器按 `MPW_OPEN_CMD` → `termux-open` → `xdg-open` → `open` → `explorer` 找（四个平台各一条：Termux / Linux / macOS / Windows）；**找不到 ⇒ 501 + `{unsupported:true, error, reason, hint}`**
  （绝不 500、绝不假装成功）；启动失败同样 501。本服务**不会**替你启动浏览器（测试里用 `MPW_OPEN_CMD=/bin/true` 验证成功分支，
  用 `PATH=""` 验证 501 分支，全程零 X11/零浏览器）。

### 2.8 `GET /api/diag-stream` —— SSE 诊断流

```js
// bundle @87359
function Jt(){const e=new EventSource("/api/diag-stream");
  e.onmessage=t=>{try{const{msg:n}=JSON.parse(t.data);b(n,/fail|error|ERROR/.test(n))}catch{}},
  e.onerror=()=>b(p("err.diagStream"),!0)}
```

* 事件必须是**默认 message 类型**（`onmessage` 只收默认/`message`），`data` 是 JSON，**字段名 `msg`**。
* 页面还会探一次 `/api/diag-stream` 的**状态码**决定诊断区是否置灰（patch 的 `diagOfflineState(httpStatus)`：非 2xx ⇒ offline）⇒ 本服务必须 200。

**数据源选择（写清）**：**本服务自己维护环形缓冲**（上限 200 条，内存，不落盘），**不代理 `:8899/diag`**。理由是产物里的上报路径是
**同源**：renderer bundle 的 `ce()`：

```js
const r=e.mediaBase?new URL(e.mediaBase,window.location.href).origin:"";
if(r){const i=new Image;i.src=`${r}/diag?msg=${encodeURIComponent(`scene ${e.src??"?"}: ${n.slice(0,500)}`)}`}
```

⇒ 本服务接 **`GET /diag?msg=…`**（回 1×1 GIF：`new Image()` 不报错、控制台不刷错误）与 **`POST /diag`**（JSON body 或纯文本），
写环形缓冲并广播给所有 SSE 订阅者（连上先回放最近 50 条），15s 一次 `: ping` 心跳。

### 2.9 媒体面（不是 `/api/*`，但**没有它测试台就是"能点不能用"**）

```js
// renderer bundle：场景源 = `${mediaBase}/${src}`，依次试这三个文件名 + project.json
const c1=["scene.pkg","scenes/scene.pkg","gifscene.pkg"];
function l1(t,e){const n=t.replace(/\/+$/,"");return{key:n,async scenePkg(r){for(const o of c1){…fetch(`${n}/${o}`)…}}, async project(r){…}}}
const p=e.source??l1(`${e.mediaBase}/${e.src}`)
```

⇒ 本服务提供 **`/media/dev/<itemId>/<rel…>`**（scene.pkg/preview/视频/音频…）与 **`/web/dev/<itemId>/<rel…>`**（web 壁纸 iframe 的 src），
都**只读、库根内、支持 Range**（`206 + Content-Range`；视频拖动进度必需）。

---

## 3. 能力清单与**降级为 501 的端点**

`GET /__health` 是自述的唯一入口（启动日志同内容）。`capabilities` 里 `true/false`，`degraded[]` 逐条给"哪个端点、什么条件、能力状态、HTTP 用几、为什么"。

| 端点 | 状态 | 说明 |
|---|---|---|
| `GET /`、`/demo/**`、`/WEwebLoader/**`、`/wallpaper-engine-webgl/**` | ✅ | 静态测试台（`demo/`），**no-store**（`Cache-Control: no-store, must-revalidate`，与 `:8901` 逐字同口径） |
| `GET /assets/**`、`/icons/**`、`/bench-patch.js`、`/renderer/**`、`/samples/**` | ✅ | 同上（`<base href="./">` ⇒ 根挂载点也必须服务） |
| `GET /media/dev/**`、`/web/dev/**` | ✅ | 库根内只读 + Range |
| `GET /api/library` | ✅ | 列表（只读） |
| `POST /api/library-dir {dir}` / `GET /api/library-dir` | ✅ | 库根内**收窄** / 枚举 |
| `POST /api/library-dir {pick:true}` | ⚠️ **能力 501** | 没有宿主对话框；HTTP 回 **200** + `cancelled/unsupported/degradedStatus:501`（理由见 §2.2） |
| `GET/POST /api/props` | ✅ | 读 project.json / 覆盖写 reports（不写壁纸包） |
| `POST /api/props-dir {pick:true}` | ⚠️ **能力 501** | 同上（前端回退到 `window.prompt` 手输绝对路径） |
| `GET /api/props-dir`、`POST {dir}` | ✅ | 库根内枚举 / 取绝对目录 |
| `POST /api/props-file`、`GET /api/props-file/<id>/<name>/<file>` | ✅ | 导入到 reports + 回读（**不写壁纸包**） |
| `POST /api/delete` | ✅ | **默认 dryRun**；`?confirm=1` 移到 `Delete/bench-trash/<ts>/`（可回滚） |
| `POST /api/reveal` | ✅ / ⚠️ | 有打开器 ⇒ 200；**没有 ⇒ 501 + 说明**（能力 501，HTTP 也真是 501） |
| `GET /api/diag-stream`、`GET /diag?msg=`、`POST /diag` | ✅ | 本服务环形缓冲（**不代理 `:8899`**） |
| `GET /__health` | ✅ | 端口/库根/能力/降级/上限/诊断缓冲 |
| **没有的能力（不存在，也不假装）** | ❌ | 任意路径读/写、真实文件系统对话框、宿主转码（video 转码）、HTTP 代理 |

**"降级为 501"的三条**（`/__health.degraded[]` 逐条）：

1. `POST /api/library-dir {pick:true}` ⇒ 能力 501（native-folder-picker）。**HTTP 用 200**：调用方 `if(!e.ok||t.error) throw` 在 `if(t.cancelled)` 之前，501 会掐掉它自己的 `window.prompt` 回退 ⇒ 用 body 的 `unsupported/degraded/degradedStatus` 如实说明"没选成、因为没对话框"。
2. `POST /api/props-dir {pick:true}` ⇒ 同上（目录型用户属性）。
3. `POST /api/reveal`（找不到/起不动打开器）⇒ 能力 501，**HTTP 也 501**（调用方本来就把它当错误显示）+ `error/reason/hint/tried`。

---

## 4. 安全模型（红线逐条 + 对应用例）

| 措施 | 实现 | 对应用例 |
|---|---|---|
| 规范化后**前缀校验** | `safeJoin()`：`path.resolve` 后 `path.relative(root,p)` 必须在根内，否则 **403**；相对路径里出现 `..` 直接 **400** | `F5`（`../outside`、`/etc`）、`G2`、`C5` |
| **拒绝 `..`（URL 层）** | `new URL()` 会把 `..` 规范化掉 ⇒ 先用**原始** `req.url`（`%2e%2e` 解码后）按段判 `..` ⇒ **400** | `A7`、`A8`、`G7` |
| **符号链接逃逸** | 真身二次校验：`realpathSync` 逐级回溯（缺失尾段也校验最长存在前缀）⇒ 越根 **403** | `F6`、`G1`、`G3`、`G6`（外部文件 `TOP-SECRET-OUTSIDE` 读不到） |
| `itemId` 只允许**单段** | `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` ⇒ `../`、绝对路径、`a/b`、`.`、`..` 全 **400** | `F5`、`G3` |
| 上传文件名只允许**单段** | `X-Filename` 解码后禁分隔符/`..`/绝对路径 ⇒ **400**；落点复核仍在 `reports` 内 | `E5`、`E6` |
| **没有**任意路径读/写 | 库根内的读只有列表/`project.json`/`media,web`；写只有 `reports/bench-props/**`（属性覆盖）与 `Delete/bench-trash/**`（删除） | `D6`/`D7`（写不进壁纸包）、`H8` |
| **默认不删真文件** | `POST /api/delete` 默认 dryRun：只回 `{dryRun:true, from, to, files[], fileCount, bytes}`，**一个文件都不移** | `F1`、`F2` |
| 真删 = 移进回收站（**可回滚**） | `?confirm=1` ⇒ `rename(库项 → <MPW_ROOT>/Delete/bench-trash/<ts>/<itemId>)`（`EXDEV` 才 `cp+rm`），响应回 `to` 与 `rollback` | `F3`、`F4` |
| 不启动浏览器/X11 | `reveal` 只 `spawn(opener)`；测试用 `MPW_OPEN_CMD=/bin/true` 与 `PATH=""` 两条路，全程零浏览器 | `G8`、`I1`、`I2` |
| 落盘/内存上限 | 上传单文件 ≤64MB、JSON body ≤2MB、列表 ≤5000 项、诊断环形缓冲 200 条 × 2000 字符 | `/__health.limits` |
| 一个坏请求不许打崩服务 | 处理函数**同步 throw 也被接住**（`done()` 里 try 包住 `fn()`）⇒ 404/400 之后 `/__health` 仍 200 | `H7`（这是实测踩到的真 bug，已修） |

---

## 5. 怎么用

```bash
# 1) 起服务（默认 8902；默认库根 = <仓库上一级>/allwallpaper/dd，默认 no-store）
node server/we-scene-demo-server-8902.mjs

# 2) 换端口/库根/静态根（环境变量优先于 CLI，与既有服务同风格）
PORT=8902 MPW_LIBRARY_DIR=/path/to/allwallpaper/dd node server/we-scene-demo-server-8902.mjs
node server/we-scene-demo-server-8902.mjs 8902 --library=/path/to/allwallpaper/dd --no-store

# 3) 打开（**带后端**的测试台：列表/属性/删除/诊断流都活）
xdg-open http://127.0.0.1:8902/          # 或者浏览器里直接输这个地址
curl -s http://127.0.0.1:8902/__health | head -40     # 自述：库根 + 能力 + 降级 + 上限
curl -s http://127.0.0.1:8902/api/library | head -40   # 列表
```

页面里应当看到：左侧栏"壁纸库"有项、点一下 iframe 里出画面（`/wallpaper-engine-webgl/renderer/index.html`）、
右侧"壁纸配置"能读写、右键"删除壁纸"是 dryRun（日志区会写"未移动任何文件"）、日志区有渲染器诊断。

**相关环境变量**：`MPW_ROOT`（工作区根，决定库根/回收站/reports 默认落点）、`MPW_LIBRARY_DIR`（库根，**只读**）、
`MPW_REPORTS_DIR`（属性覆盖落点）、`MPW_BENCH_STATIC_DIR`（静态面根，测试的变异副本靠它指回真树）、
`MPW_BENCH_STORE=1`（关掉 no-store）、`MPW_OPEN_CMD`（reveal 打开器）、`MPW_LIMIT_*` **不由本服务读取**（本服务只写属性覆盖，见 §3 上限表）。

**自证**：`node tests/bench-server-test.mjs`（63 断言 + 2 个变异 RED；秒级；不启浏览器、不碰真库、不连 `:8899/:8901`）。
**登记待办**：`tests/run-all-tests.sh` 的 `add` 列表由主对话加 `add "bench-8902" "node tests/bench-server-test.mjs"`（本批**不改**该文件）。

---

## 6. 未证实项（**需要主对话用有头浏览器确认**）

| # | URL + 操作 | 期望 |
|---|---|---|
| U1 | 打开 `http://127.0.0.1:8902/` | 左侧栏"壁纸库"**真的列出**真实库项（`curl /api/library` 已证 200+items；页面渲染未用浏览器验） |
| U2 | 点列表里一个 **scene** 项 | iframe 加载 `/wallpaper-engine-webgl/renderer/index.html?type=scene&src=<id>…` ⇒ `/media/dev/<id>/scene.pkg` 被取；画面出现（scene.pkg 解析在浏览器里，本批只验到"字节可服务"） |
| U3 | 点一个 **web** 项 | `/web/dev/<id>/index.html` 在 iframe 里加载（同源、无 CSP 头，理论可行；**未在浏览器里跑过**） |
| U4 | 点一个 **video** 项 | `/media/dev/<id>/<file>.mp4` 走 Range 播放（206 已用 curl 验；`<video>` 真实拖动未验） |
| U5 | 属性面板改一个值 → 保存 → **刷新页面** | 值还在（覆盖在 `reports/bench-props/<id>.json`；curl 已证读写往返） |
| U6 | 属性面板里"选择文件/选择目录" | 弹 `window.prompt`（手输）而不是报错；输入后值写进覆盖文件。**注意**：`选择文件夹`（左侧栏）与属性里的目录选择在 `bench-patch.js` 下走的是**纯前端选择器**（patch 在捕获阶段抢走点击），`/api/library-dir {pick:true}` 的降级分支只在**未加载 patch** 时才走到 ⇒ 浏览器里可能看不到那条降级提示，这是预期的 |
| U7 | 日志区/控制台 | `/api/diag-stream` 建立（SSE 200）、日志区出现渲染器诊断行；`curl` 侧已证"`POST /diag` → SSE 收到"。另：页面顶部/侧栏**不应**再出现"静态托管（无 /api 后端）"的字样（那是 `/api/library` 404 时的分支） |
| U8 | 右键"删除壁纸" | 日志区出现 `bench: 删除为 dryRun（未移动任何文件）…` 且**列表项仍在**（安全默认）；真删需 `curl -X POST 'http://127.0.0.1:8902/api/delete?confirm=1' -H 'content-type: application/json' -d '{"itemId":"<id>"}'` |
| U9 | 视频/网页壁纸以外的窄屏（手机/Pad "桌面版网站"） | 本批未涉及布局改动；`:8902` 与 `:8901` 是同一份产物 ⇒ 布局行为应当一致 |
| U10 | `/api/props-file` 导入的贴图 | `value` 是**同源 URL**（`/api/props-file/<id>/<name>/<file>`）；**未证实** renderer 的贴图解析是否接受 URL（若只认包内相对路径，需要宿主侧把文件拷进壁纸包 —— 本批**故意不写进壁纸包**，安全优先） |

**本批已用 curl/node 证实的**（不依赖浏览器）：静态面 200 + no-store（含**产物写死的** `/wallpaper-engine-webgl/renderer/index.html`）、
8 个 `/api/*` 的状态码与 JSON 形状、全部逃逸用例 400/403、dryRun 不移动 / `confirm=1` 进回收站、属性读写往返且不写壁纸包、
SSE 收到 `{msg}`、`/__health` 自述、404 不打崩服务；变异 A/B 必红（RED 原文见 §5 测试输出与 `docs/PATCHES.md` 的 P-131 节）。

---

## 7. 测试台外壳一批 UI/交互修复（P-158/P-159，2026-09-19；只动 `demo/index.html` + `demo/bench-patch.js`）

> 本节补的是**页面外壳**（工具条 / 预览 / 输出 / 切换栏 / 类型过滤 / 库来源 / 归属）的一次性修复。
> 服务端一行未动；上面 §1–§6 的接口契约不变。台账全文见 `docs/PATCHES.md` 的 **P-158** 节。

### 7.1 三条结构性根因（一句话版）

1. **`#main` 的内层网格列被内容撑爆**：产物 `#main{display:grid}` 的单列是 `auto` ⇒ 被 `#editor-tabs` 的
   11 个 tab 撑到 **2279px**（`#main` 真实宽 740），再往下派生：工具条 17 个控件只有 3 个在视口内、
   `#stage-scale` 2255×1268 塞进 508px 高的槽（"只看得见左上角"）、输出栏右侧的清空/复制跑到视口外。
   修法 = `#main{grid-template-columns:minmax(0,1fr)!important}`（+ 工具条 `flex-wrap:wrap` 与纵向滚动兜底）。
2. **`#pages-track{contain:paint}` 是 `position:fixed` 后代的包含块** ⇒ 自绘下拉按"视口坐标"算出的
   `left/top` 会被整体下移一个 header（44px）—— 这就是"下拉与触发框之间露一条缝"（实测 48px）的真因。
   修法 = 写内联坐标时减掉包含块原点（新增纯函数 `layerFixedOffset`），缝宽收到 2px 并按实测几何校正。
3. **一个 `<select>` 被两套自绘控件同时增强** + **类型过滤宿主被当"已删功能"处理**：
   前者让每个选项后面多出一个「（空）」的下拉框（分辨率处甚至有两个"自适应 16:9"）；
   后者把 `#type-filter` 的 `onclick` 摘掉并 `hidden`，产物 `Pe` 恒 `'scene'` ⇒ 明明 `/api/library`
   返回 scene 11 / web 7 / video 4，页面却只有 11 项。修法 = 工具条归 `.bench-rd` 独占（mpw 只留给属性面板）、
   `#type-filter` 搬到左侧可见处并由补丁生成四档（全部/场景/Web/视频，默认「全部」= 三档合并）。

### 7.2 本机 `:8902` 复现与验证（headless Firefox）

```bash
bash tests/run-all-tests.sh --only bench-shell-fixes bench-ui-headless bench-8902
# 期望：三项全 PASS（无浏览器断言 70 条 + 浏览器几何 39 条 + 服务端 116 条）
node tests/bench-ui-headless-test.mjs --url http://127.0.0.1:8902/ --w 1360 --h 900
```

页面里现在应当看到（都已由 `bench-ui-headless` 的 S 组断言钉住）：

| 位置 | 修后 |
|---|---|
| 工具条 | 宽 = `#main` 宽（740@1360），17 个控件**全部在视口内**（换行，超出 30vh 才纵向滚） |
| 分辨率下拉 | 与触发框**贴合 2px**，下方不够时自动上翻也贴合 |
| 每个下拉 | **一个**自绘控件（工具条里 `.bench-rd`×5、`.mpw_select`×0；全页无「（空）」label） |
| 预览 | `#frame` 恒 16:9 且完整落在 `#stage-slot` 内（收起/展开输出都一样）；选 1920×1080 也完整可见 |
| 输出栏 | 行尾「清空 / 复制输出」**两态常驻**；「渲染器诊断（/diag）」是**真页签**，显示 `/api/diag-stream` 的渲染器消息 |
| 切换栏 | 只放已选/常用（当前 + ★ 固定项，位置固定）；`＋` 固定在最右端，点它**显式展开**库列表面板 |
| 左侧库 | 类型四档（全部=22 项：scene 11 / web 7 / video 4），每行有真实类型徽标 |
| 库来源 | `#lib-source` 写明四态之一：无后端 / **本机默认目录（你还没有选择）** / 你选的 / 空 |
| 设置弹层 | **双方共同署名**（本仓库作者 + 上游 oneincase/webwallgl MIT）+ 上游许可全文两个入口 |

### 7.3 仍然是"未证实项/待别的线"的

* **服务端进程已重启，`/api/fs/*` / `/api/library-source` 实测 200**（2026-09-19 复跑；前端两档都断言）：
  * `GET /api/fs/roots` ⇒ 200，4 个快捷根（当前库目录 / 宿主 home `listable:false` / 工作区 / 壁纸总目录）；
  * `GET /api/fs/list?path=…` ⇒ 200，库根 22 个目录；单击进子目录后路径与 `parent` 都更新；
  * `GET /api/library-source` ⇒ 200 `{source:"default", selected:false}` ⇒ 侧栏「库来源」渲染成
    "本机默认目录（你还没有选择）"（**没有假装已选**）。
  * 「选择文件夹」实测：应用内对话框列出 22 项 + 「就选这个目录」+ 4 个快捷根；服务端标 `listable:false`
    的根**灰显**（home，`MPW_PICK_ROOT` 可放宽）；两个兜底按钮（纯前端扫描 / **显式标注**的系统选择器）都在。
  * 路由 404 那一档（静态托管或服务端未落地）仍会明确写出"服务端还没有 /api/fs/* 这条路由" —— 门禁按
    实测状态**两档都判**（`bench-ui-headless` 的 F 组 F3a–F3d / F4a）。
* **旧产物的 `rt()` 只认 `hasScene`**：`kind: 'wallpaper'|'other'` 的条目在左侧列表里永远不出现（需要产物重建，
  或前端自建面板并自行拼 iframe URL —— 后者会绕开 `#current`/属性面板链路，需单独一批）。
* **web 类壁纸的 WE shim**：入口 HTML 挂上了，但渲染器打印「网页壁纸：同源入口未检测到 WE shim（host 未注入？）」
  ⇒ 属 `core/**`/宿主注入面（不是本批）。
* **不点「就选这个目录」**：门禁只断言按钮存在与浏览可用，**不 POST** `/api/library-dir`（那会真的换掉用户的库目录）。
* **真 X11 指针判定**（"用户拿鼠标点得到"）留给主对话的 `tests/x11-e2e/bench-click-test.mjs`；
  本节的可点性用 `elementFromPoint` + 合成事件证明。

---

## 8. web 类壁纸"真的能用"：把渲染器自带的 WE shim 注入同源 web 入口（P-160，2026-09-19）

> 只动 `demo/bench-patch.js`（+ 测试/台账/文档）。服务端与产物一行未改。

### 8.1 症状与真因（逐行可查）

挂 web 档（本机 3580207945）时渲染器自己打印：

```
scene http://127.0.0.1:8902/web/dev/3580207945/index.html:
  网页壁纸：同源入口未检测到 WE shim（host 未注入？）；Spine 类壁纸请确认 /web/ HTML 改写
```

minified 渲染器（`demo/assets/renderer-BOSoB05I.js`）里 web 档有两条路：

* `cw(src)` 为真（**同源**）⇒ `bo(..., {injected:true})` 直接 `<iframe src=入口>`，`load` 时检查
  `typeof frameWindow.__weSetPaused === 'function'` —— **期望宿主注入 shim**。测试台从不注入 ⇒ 告警 + 作者脚本拿不到 API。
* `cw(src)` 为假（跨源）⇒ 渲染器自己 `fetch(入口)` → `L1(html, N1, {baseHref, seedScript})` 把**它自带的 shim**
  （模块内 44.8 KB 常量 `N1`）插到 `<head>` 之后，再用 blob 文档加载。

### 8.2 修法（不抄第三方代码）

1. 纯函数 `shimFromRendererSource(assetText)`：在产物文本里按注释头定位那段模板字符串，按模板字符串规则
   **还原转义**（`decodeTemplateLiteral`，不用 `eval`），并校验契约（必须含 `__weSetPaused` +
   `wallpaperPropertyListener`）⇒ 拿到的就是渲染器自己会注入的**同一份字节**（44 811 B）。
2. 在**渲染器窗口**里包 `HTMLIFrameElement.prototype.src`（幂等）：命中同源 web 入口时先不导航，
   `fetch` 入口 HTML → `injectShimIntoHtml()`（插 `<base href>` + shim 脚本，幂等、非 HTML 拒绝）→
   `Blob` → 一次性导航到 blob 文档。
3. 跨源 / 取不回 / 非 HTML ⇒ 记 `reason` + 日志 + **回退裸 iframe**；blob URL 在 `load` 后 revoke。

### 8.3 判据（`bash tests/run-all-tests.sh --only bench-shell-fixes bench-ui-headless`）

* 真机（`bench-ui-headless` W 组 7 条）：
  * 渲染器日志里**没有**「未检测到 WE shim」、也没有「shim 注入失败」；
  * 壁纸 iframe = `blob:` 文档，含 `data-we-shim-src` 标记与 `<base href="…/web/dev/<id>/">`；
  * 壁纸窗口里 `__weSetPaused/__weSetFps/__weSetVolume` + `wallpaperPropertyListener` + `wallpaperRegisterAudioListener`
    + `wallpaperRequestRandomFileForProperty` + `__wePushPointer/__wePushWheel` 全部就位；
  * 在壁纸文档里挂监听后用真鼠标事件走一遍 ⇒ `{move:2, down:1}`（事件真的进到壁纸页）；
  * `window.__benchWebShim()` 读数：`{installed:true, injected:1, failed:0, shimBytes:44811, shimFrom:<产物URL>, reason:""}`。
* 无浏览器（`bench-shell-fixes` E 组 20 条 + B22–B25 + 变异⑤/⑥）：转义还原、真产物取 shim、注入决策（含
  `cross-origin` 如实拒绝）、注入形态（head/html/裸片段/幂等/`</script` 转义/非 HTML 拒绝）、运行期接线静态钉子。

### 8.4 仍然是"未证实项"

* 跨源 web 入口**做不到**（如实记 `cross-origin`，不假装成功）。
* 只验了 1 张 web 档；其它 web 档只做 API 名单级对齐（shim 自带的兼容层）。
* 画面正确性未做像素判定（只到 API 就位 + 文档加载 + 事件可达）。
* 鼠标可达 = 浏览器原生投递；与 WE 客户端的指针注入语义逐字一致属 `core/**`。

---

## 9. 播放卡片（Now playing）适配：从"装饰"到"真控件"（P-161，2026-09-19）

> 只动 `demo/now-playing/**`（本仓自己的 GPL 组件）+ `demo/bench-patch.js` + 测试/台账/文档。服务端与产物一行未改。

### 9.1 症状与真因

右侧「壁纸配置」下半部的卡片来自 `demo/now-playing/`（P-138 从 Bencho 移植，本仓 GPL），
`mountNowPlaying(el, opts)` 只接受 `morph/corner/stroke` 三个旋钮，**没有任何数据/传输入口** ⇒
卡片上的标题（"Cabra Field"）、副标题（"Side B"）、进度与时间（52s / 214s）都是**装饰值**，
进度条不可点；只有"点播放键 → 组件 aria 变 → 补丁读 aria 再驱动媒体"这条兜底桥（P-142 加的）在动。

### 9.2 修法（为什么扩本仓组件而不是复用插件那份 MIT 组件）

* 本仓组件是 **GPL**、插件那份是 **MIT**：复用要 vendoring 99 KB MIT 源码 + 运行期 CJS 求值（`eval`），
  且会打破既有几何/遮挡门禁的 DOM 契约；扩本仓组件零新增第三方代码、零求值、既有门禁语义不变。
  两组件的 **op 词汇与快照字段保持一致**（`play|pause|prev|next|restart|mute|seek|volume|link`、
  `kind/title/byline/progress/total/playing/muted/volume/can*/link/source`），互不依赖。
* 组件新增两个**可选**入口 `data` / `onTransport`（不传 = 原件装饰态，SSR 产物逐字不变）；
  进度条经纯函数 `seekRatio()` 换算（按住才拖）；心形 = 联动开关（沿用同一个类，不新增 CSS 类）；
  DOM 标记与插件仓同口径（`data-mpw-now-playing` / `data-mpw-np-scrub|noseek` / `data-mpw-np-link`）。
* 补丁侧：`npSnapshotPlan()`（纯函数）算快照；媒体扫描**再下一层**到 web 档入口 iframe 里的
  `<video>/<audio>`；`pumpNp()` ≤5Hz **尾随**节流推 `update({data})`（不 remount）；`npTransport()` 落回
  `applyPlayPause/seekStage/setVideoVolume/…`；受控模式下旧的"读 aria 猜意图"兜底让位（同一个 Next 不做两次）。

### 9.3 真机判据（`bash tests/run-all-tests.sh --only bench-ui-headless now-playing bench-shell-fixes`）

web 档 `3644069061`（本机 7 张 web 档里唯一带 2×`<video>` + 3×`<audio>` 的）：

| 口径 | 读数 |
|---|---|
| 接线 | `{videos:2, audios:3}`、`source=stage-video`、`canPlay/canSeek=true`、`controlled=true` |
| 显示 | 标题 = 壁纸真实标题、副标题 `web · ×5 · muted`、`total=9.713s`（不再是 Cabra Field / 52s） |
| 播放/暂停 | 点卡片那颗键：`aria-pressed` `true→false`、`video.paused` `false→true`；再点回来 |
| 进度 | rail 75% 处按下 ⇒ `currentTime 7.285 / duration 9.713 = 0.75` |
| 音量 | `npTransport('volume',0.42)` ⇒ 元素 `volume=0.42`、`muted=false` |
| 联动 | 关：`canPlay=false` + 按键 `disabled` + 点播放 paused 不变；开：恢复 |
| 不打架 | 卡片操作全程 `#frame` 的 src 一字未动；换壁纸后卡片重绑（标题/媒体数变）、`.snd-box` 仍在 |

### 9.4 做不到（诚实清单）

* **video / scene 档没有 seek 与进度读数**：这两类走 WebCodecs 逐帧（无 `<video>` 元素），`__wp` 公开面里
  没有 seek/setTime/currentTime ⇒ 卡片如实 `canSeek=false`、`total=0`（不假装能拖），播放/暂停与音量照常。
* 上一首/下一首 = **切库列表里相邻壁纸**（不是壁纸内部换段）；相邻项认不出时按键置灰。
* **跨源** web 帧拿不到媒体元素 ⇒ 只能经 shim 的 `__weSetVolume` 发"设音量/静音"意图（同源帧可直接读写）。
* 只验了 1 张带媒体 + 1 张只有 `<audio>` 的 web 档；画面观感（悬浮放大手感、长标题省略）只能人眼。
* `demo/now-playing/dist/now-playing.js` 是**入库产物**：改源码必须 `cd demo/now-playing && node build.mjs` 重建。

---

## 10. 可关闭的壁纸条 + 「调试模式」页签 + 幂等切换 + 移动即转发（P-164，2026-09-19）

> 只动 `demo/index.html`、`demo/bench-patch.js`、`demo/manifest.webmanifest`、`demo/assets/brand/**`（新图）、
> `demo/now-playing/NowPlaying.tsx` + 其入库产物 `demo/now-playing/dist/now-playing.js`（封面路径一行）与
> 本批测试/台账/文档。**服务端、`core/**`、`web/**` 一行未改。**

### 10.1 五条的修法与真机读数

| # | 条目 | 修法 | 真机读数（headless Firefox 1360×900） |
|---|---|---|---|
| ① | 壁纸条可关闭 + 长标题不把 `×` 顶远 | `demo/index.html` 里给 `#editor-tabs .tab` 上限 200px、`.wp-tab .wp-name` 走 CSS 省略号；`demo/bench-patch.js` 在每个固定标签右端内侧加 `.wp-x`，当前壁纸那一格加**兄弟**按钮 `.wp-x-cur`（`#current` 的文本由产物写，写子节点会被冲掉）；关闭决策走纯函数 `closeTabPlan()` | 标签宽 `200px`（= `max-width`）、`.wp-name` `overflow:hidden` + `text-overflow:ellipsis`；当前格 180px、`×` 紧贴右缘 **gap 0px**、`elementFromPoint` 命中它自己 |
| ② | 新「调试模式」页签 | `#tab-debug` + `#debug-body`（按钮行 / `#dbg-state` / `#dbg-layer` / `#dbg-log`）；←/→=±1 层、↑/↓=±10 层、Ctrl=全部恢复、Alt=退出；**只在本页签激活期间**装 capture keydown，退出立刻卸掉 | 未激活时 ←/→/Alt 默认行为照旧（不吞）；激活后 `view=debug`、`active=true`、`keys=true`、日志 **129 行**；激活期间 ←/→/Ctrl 被吞、`a` 不被吞；Alt 退出后视图回 `logs`、监听卸掉、默认行为恢复 |
| ② | 「立即上报」 | `debugReportPlan()` 组一份 `bench-debug/1` 载荷（时间/当前壁纸/UA/图层/媒体数/诊断文本 ≤100 行），依次 POST `/report` → `/baseline` → `/diag`，并把**实际落点**写进日志；本地另留一份 `localStorage['bench-debug-report']` | 载荷 **11 935 B**、`schema=bench-debug/1`、`diagLines=64`、实际落点 **`/report`**（P-166 之前是 `/diag`——那时服务端只有环形缓冲这条；现在第一条就成功）、本地副本 11 935 B |
| ② | 「截图」 | 走渲染器自己的 `__wp.capture(0)`（JPEG data URL）⇒ `a[download]`；拿不到就**写明原因**（渲染器未就绪 / capture 返回空） | 本机当前无场景 ⇒ 返回 `null` 并写日志（不假装成功）；有场景时 Z5 的口径是 `bytes > 1KB` |
| ③ | 重复点"已选中"的壁纸必须幂等 | 决策抽成纯函数 `switchDecision()`（目标已经是当前项 ⇒ 不 `click()`）；`#list` 上再加一道**捕获阶段**拦截并计数（`#np-host[data-np-idem]`） | 连点 3 次：`#frame` src 不变、`Mount` 日志 **8→8**、列表节点身份不变、拦截计数 **3** |
| ④ | 鼠标尾迹不按键也出（与 `:8899` 对齐） | 舞台内的 `pointermove` 经 `forwardPointerMove()` 走 `__wp.pushPointer(u,v,buttons=0,mods)`；是否转发由纯函数 `pointerForwardPlan()` 定（开关 / 入口 / **舞台上是 web 档则不转发**，避免原生+注入双投递） | 注入遮罩 + 尾迹开启下**不按键**移动：转发计数 **1→9**；尾迹画布墨迹 **0→332** 像素（`:8899` 同口径） |
| ⑤ | 渲染器图标换成本仓所有者的图 | `demo/index.html` 的 favicon/apple-touch、`demo/manifest.webmanifest` 三个图标、播放卡片封面全部指向 `demo/assets/brand/**`（4 张：512/192/64/32 PNG） | `link[rel*=icon]` 全部 `assets/brand/*` 且 200 + `image/png`；manifest 三个图标 200（30 032 / 107 355 / 5 589 B）；卡片封面 = `brand-512.png` |

### 10.2 关闭壁纸条的回落口径（①的"明确"部分）

* **关非当前项**：只从固定集合里去掉它，预览 `#frame` 的 src **一字未动**，当前那一格的字也不动。
* **关当前项、还有别的打开项**：回落到"离它最近的下一个"（没有下一个就取最后一个，位置稳定），
  并**立刻**把当前那一格换成回落项的标题 —— 回落标题取数走纯函数 `titleForId()`（**列表 → 缓存 → id**）：
  回落那一刻 `#list` 可能正好因为切类型档在重渲染，只查现列表会把 id 当标题写进去。
* **关最后一个**：当前格写回"未选择壁纸"、点产物自己的 `#release`（与用户手点同一个落点）、显示 `#empty`、
  清空固定集合，**并且撤掉 `#list li.active`** —— 不撤的话 `refreshSwitcher` 会立刻把"列表里选中的那一项"重新固定回去
  （自证 Y0/Y8 抓到的"空态了但 `bench-pinned-wallpapers` 还有一条"）。
* 一个已释放的舞台旁边不再挂 `×`（那一格没有可关的东西）。

### 10.3 上报存哪儿（②的"写清楚"部分）

| 落点 | 现状（**P-166 已补齐两条**） | 存到哪 |
|---|---|---|
| `POST /report` | ✅ **有**（`7c3a137` P-166 补；与 `:8899` 同形） | `<MPW_REPORTS_DIR>/r<ts>.json`（默认 `<MPW_ROOT>/reports/`），服务端 stdout 打印一行落点；上限 60 份 / 64 MB，最旧先删 |
| `POST /baseline` | ✅ **有**（同批补） | `<MPW_REPORTS_DIR>/baselines/<ts>.json`；body ≤1 MB 且必须过 `core/baseline-metrics.mjs` 校验（不完整 ⇒ **400 且不落盘**）；上限 200 份 / 32 MB |
| `POST /diag` | 有（渲染器诊断流的同一入口） | 进 **服务端 `/diag` 环形缓冲**（`GET /api/diag-stream` 能看到），不落成单独文件（内存，重启即失——前两条都不可用时的兜底） |
| `localStorage['bench-debug-report']` | 有 | 浏览器本地副本（最近一次上报的完整 JSON），刷新后仍在 |
| 「截图」 | 有 | 浏览器下载目录（文件名 `bench-shot-<ts>.jpg`），不经过服务端 |

⇒ 「立即上报」现在**按顺序**打到 `/report`（现场快照）⇒ 成功即止；`/report` 不可用才退 `/baseline`，再退 `/diag`。
上限、环境变量（`MPW_LIMIT_REPORTS_MAX` / `MPW_LIMIT_REPORTS_BYTES` / `MPW_LIMIT_BASELINE_MAX` /
`MPW_LIMIT_BASELINE_BYTES`，与 `:8899` 同名同义）与滚动白名单（`<reports>/parity-*.json` 等别条线产物一个都不动）
都在 `/__health.report` 里自述 —— 读的人不用翻代码。判据：`tests/bench-server-test.mjs` **M1–M11**（含"路由整段消失"与
"基线校验放行"两组变异自证）。

### 10.4 判据（`bash tests/run-all-tests.sh --only bench-shell-fixes bench-ui-headless`）

* `tests/bench-shell-fixes-test.mjs`：**183 通过 / 0 失败**（156 → 183：新增 I30–I44 共 15 条纯函数/静态钉子、
  H1 由 1 条汇总拆成 4 条逐图、**变异 ⑩–⑬** 四个新变异组 ⇒ 变异组 **9 → 13**）。
* `tests/bench-ui-headless-test.mjs`：**92 通过 / 0 失败**（67 → 92：新增 X/Y/Z 三组 25 条，逐条对应 §10.1 的读数）。
  顺带把 T1/T2 的**时序**做稳：媒体读到 metadata 之前 `canSeek/total` 本来就是假（同机两次跑一次真一次假），
  现在等它有界就绪——判据没放松（等不到照旧失败）。
* 未回归：`demo-syntax` 11/11、`bench-8902`、`mpw-select` 70/0、`p142-nav-sound` 92/92、`now-playing` 216/0、
  `secret-scan` 干净、`docs-check` 见 P-164 台账行。

### 10.5 做不到 / 只能这样的（诚实清单）

1. **逐层查看只对"能拿到 `__sceneLayers` 的场景档"成立**：`:8902` 的 iframe 跑的是 minified 上游产物，
   它**没有** `:8899` core 那套 `__lnOnly/__subMeshOnly` 约定，本批改用 `scene.layers[i].visible` 做隔离
   （写它会触发产物自己的 `recomputeVisibility()`），退出时全部恢复可见。本机 WebGL 常常不可用 ⇒
   面板如实写"没有可逐层查看的场景（未挂载 / 场景加载中 / WebGL 不可用）"，**不编造层号**。
2. **键盘只在页签激活期间被接管**：这是刻意纪律（←/→ 在工具条其它地方有原生用途）。Alt 退出、点其它页签、
   或调 `setDebugMode(false)` 都会立刻卸监听并恢复全部图层可见。
3. ~~**上报不落文件**（§10.3）~~ ⇒ **已收口**（P-166 补齐 `POST /report` 与 `POST /baseline`；见 §10.3 表）。
4. **图标只换了测试台这一页（`demo/**`）的引用**：站点根 PWA 那一套（`web/manifest.webmanifest`、
   `web/pwa-inject.mjs`、`web/sw.js`、`web/icons/**`）仍指旧的 `icons/icon-*.png` —— 这些文件不在本批授权范围内
   （`web/icons/**` 由 `tools/make-icons.mjs` 生成、`web/icons/icons.json` 的 sha256 钉着）。
   旧图**当时没有删**（`web/icons/**` 全在；`demo/icons/` 原有 3 张，其中零引用的
   `pwa-maskable-512.png` 已于 2026-09-23 品牌清理删除，`pwa-192.png` / `pwa-512.png`
   因仍然出现在文档历史记录里而保留；`server/we-scene-demo-server-8902.mjs` 的 `/favicon.ico`
   也已在同一天从 `icons/pwa-192.png` 改成品牌图 `assets/brand/favicon-32.png`）。
5. **图的来源**：`demo/assets/brand/**` 是本仓所有者提供的图（原图在**工作区根**的 `assets/brand/`），
   **不登记为上游第三方素材**（`THIRD-PARTY.md` / `docs/COPYING-RULES.md` §4 一行都不加）。
6. **观感类**（省略号的观感、`×` 的手感、尾迹粗细/颜色）只能人眼；探针只判几何、状态与像素计数。

---

## 11. 「渲染器来源」两档 + 画布活档位（P-171，2026-09-21）

> 只动 `demo/index.html`、`demo/bench-patch.js`、`demo.html`、`core/we-scene-bundle.js`、
> `elysia/scene-scripts.js`、`server/we-scene-demo-server-8902.mjs` + 测试/台账/文档。
> 服务端只**新增**一条反代路由（渲染器页自己的根绝对路由），既有八条 `/api/*` 契约一行未动。

### 11.1 工具条第 7 个控件

| 控件 | 取值 | 缺省 | 行为 |
|---|---|---|---|
| `#renderer-src` 「渲染器」 | `repo`（本仓渲染器）/ `upstream`（上游产物·对照档） | **`repo`** | 换档时改写 `#frame` 的 src；有已挂载壁纸就走产物自己的「重挂载」`#reload`，没有（例如预览停在合成样例上）就把**当前 URL 按新档位重写一次**（同一条改写链） |
| `#status-renderer-src` | 只读状态行 | — | 写三件事：跑的是哪条路径、**画布/DPR 真读数**（`__mpwLiveRes`）、**哪些宿主能力明确降级**（`__mpwHostCaps` 里 `false` 的键） |

* `upstream`档 = 逐字不改（"上游 = 现在的行为"）。
* `repo`档 = 同源 `/webloader/?…`（反代到 `:8899` 的 `demo.html` + 本仓 core），**原有 query 一个不丢**，
  按需补 `id=<itemId>` 与 `res=dpr`（URL 里已有 `res=` 则不覆盖）。
* **默认 = 本仓渲染器**（用户 2026-09-21 拍板："把两个整合成一个"）。上游产物降为**对照/排障档**，
  可显式切回（判据 `bench-ui-headless` R1/R2/R4）。翻转默认时把"上游当默认"写死的那 14 条断言**逐条改成
  描述新契约**（旧契约 → 新契约清单见 `docs/PATCHES.md` P-171.5；没有删断言、没有放宽容差、没有跳过）。

### 11.2 `/webloader/` 现在真的能挂载了（一条实测缺口）

`/webloader/**` 是**路径前缀**反代，而渲染器页取包用的是**根绝对**路径（`demo.html` 的 `/pkg/<id>`）
⇒ 实测 `/webloader/?id=3544152633`：日志 `❌ 启动失败: pkg HTTP 404（id=3544152633）`、画布停在 300×150 空画布。
现新增 `RENDERER_ROOT_ROUTES`（渲染器页自己的只读路由，穷尽集）：`/pkg/ /type/ /ddlist/ /ddvideo/ /videolib/
/project/ /refrender/ /weassist/ /noise /pkgpath /pkgurl` 按前缀转发到同一上游；**静态面优先**
（`demo/` 里真有同名文件就不代理），越根/坏 URL 仍走本服务 400/403 口径。
**刻意不转**：`/diag`（诊断流进测试台自己的环形缓冲 —— 转走的话「渲染器诊断」页签就哑了）、
`/report` + `/baseline`（本服务自己落盘）、`/media/dev/**` + `/web/dev/**`（库根只读面 + Range）、`/api/**`。

### 11.3 判据

```bash
node tests/bench-renderer-source-test.mjs     # 34 断言（末段真机读数；无服务/无浏览器时只有 D 段 SKIP）
node tests/scene-texanim-api-test.mjs         # 19 断言（官方 ITextureAnimation 面，纯 Node）
```

真机读数（`deviceScaleFactor:2`，面板 528×297，包 `3544152633`）：

| 路径 | 画布 | 生效 DPR |
|---|---|---|
| 上游产物 | 529×297 | 1（`renderDpr` 档缺省 1 的上限） |
| 本仓渲染器 | **1056×594** | **2 = 设备 DPR** |

### 11.4 本仓渲染器档下已知的能力差异（状态行会原样写出来）

真机读数（`bench-ui-headless` 一轮，默认档 = 本仓渲染器）：

| `:8902` 能力 | 本仓渲染器档 | 证据 |
|---|---|---|
| 预览画质（画布 = 显示尺寸 × 设备 DPR） | ✅ | `bench-renderer-source` D 段：面板 528×297 ⇒ 画布 **1056×594 @DPR2**（上游对照档 529×297 = 1×CSS） |
| 「调试模式」逐层走 + 隔离 | ✅（本批接通） | `Z4` = `图层 1/62 · myLayer · 已隐…`；做法：`demo.html` 发布 `window.__sceneLayers`（测试台只认这个全局），core 渲染循环逐帧读 `layer.visible` |
| 截图 | ✅ | `Z5`：`bench-shot-*.jpg` 1046 B（取自本仓画布） |
| 「立即上报」 | ✅ | `Z6`/`Z6b`：落点第一条 `/report` |
| 渲染器诊断页签 | ✅（本批接通） | `G8a/G8b`：诊断流 315 行、其中 `[renderer]` 314 行；做法：`logf` 在被嵌入时镜像到同源 `/diag?msg=`（限速 20 行/秒） |
| 指针注入 / 鼠标尾迹 | ✅ | `Z9`：`{enabled:true, forwarded:1, why:'ok'}`（`__wp.pushPointer` / `pointerLeave` 真实现） |
| 音条源四档 | ✅ | 本仓渲染器原生实现 `?bandfeed=`（MPW-BANDBFEED 块）+ 回报 `__mpwAudioBandInfo` |
| 属性面板 | ✅（UI/保存链） | `P` 组全绿（面板读 `/api/props`、写覆盖；`updateWebProps` 那条"拖动禁用"推送在本仓档下是明确降级，见下行） |
| `setFit` / `setSceneFps` / `updateWebProps` / `loadSceneFile` / `pushWheel` / `restore` / `setWallpaper` | ⚠️ **明确降级** | `window.__mpwHostCaps` 里为 `false`；调用会往输出区写"不生效 + 为什么"（状态行也把名单列出来） |
| web 类壁纸（入口 HTML + WE shim + 入口里的 `<video>/<audio>`） | ❌ **不支持** | 本仓渲染器页只认 scene / video（`/web/` 零命中）⇒ `bench-ui-headless` 的 T/W 两组**显式切上游档**做夹具，并由新增的 `R3` 把这条边界钉成判据（shim 注入 0 次、媒体元素 0 个） |
| 播放卡片（NP） | ⚠️ 部分 | scene/video 档没有 `<video>` 元素（走 WebCodecs 逐帧）⇒ 卡片如实写 `canSeek=false`/无媒体；web 档要媒体元素 ⇒ 当前只能在上游对照档上看 |
| 合成样例自动挂载 | ✅ | 本仓档下按 `?id=sample-synthetic` **导航预览**（同一个样例、同一份字节，取包走本仓 `/pkg/<id>`） |
| 「新窗口」按钮 | ⚠️ 仍指上游产物页 | `installOpenRemap` 在本机形态下按 `local-bench` 原样放行（`demo-check` D12 钉住这条链不许绕开）——本批不动，见 PATCHES P-171.6 的诚实清单 |

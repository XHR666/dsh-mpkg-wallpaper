# `.mpkg` 成为测试台**一等库项**（用户"壁纸都启动失败 / PKG HTTP404"的根因那一半）—— 2026-09-24

工作目录 `/root/Desktop/DSHarea/we-scene-demo`（渲染器仓库根）。基线 = `HEAD` `6b90af1`（`git status` 动手前干净）。

本轮**只碰**这五个文件：

| 文件 | 动作 | 任务 |
|---|---|---|
| `server/we-scene-demo-server-8902.mjs` | 扫描器逐文件成项（嵌套 `itemId`）+ 全部按 itemId 解析的路由改走同一条路径解析（`assertItemPath`/`itemLocate`/`splitItemRel`） | 2a / 2b |
| `server/we-scene-demo-server.mjs`（8899 渲染器处理器，8902 本地直供的**同一份实现**） | `/pkg/<嵌套 id>` 支持 `.mpkg`（流式 + 413 门槛），`/project`·`/ddlist`·`/type` 吃嵌套 id | 2b |
| `tests/bench-mpkg-items-test.mjs` | **新增**：扫描器 / 路由 / 越界 / 413 / 真语料条件项 + 4 组变异自证（纯 Node，~16s） | 判据 |
| `tests/bench-server-test.mjs` | 受口径变化影响的 **3 条**既有期望重算（L2/L3）+ L6 改成更严的嵌套项断言 + 新增 L6b（"目录条不重复计数"） | 判据 |
| `tests/run-all-tests.sh` | **+8 行注释 + 1 行 `add`**（`bench-mpkg-items`） | 门禁注册 |
| `reports/bench-mpkg-items-20260924.md` | 本报告 | — |

没有 commit / push / publish。**没碰** `core/**`、`demo.html`、`demo/bench-patch.js`、`elysia/**`、插件仓、`docs/**`（含 `DISPATCH`/`README`）。
`git status`：

```
 M server/we-scene-demo-server-8902.mjs
 M server/we-scene-demo-server.mjs
 M tests/bench-server-test.mjs
 M tests/run-all-tests.sh
?? tests/bench-mpkg-items-test.mjs
```

---

## 0. 结论（先说结果）

| # | 项 | 结论 |
|---|---|---|
| 1 | **根因取证** | 旧口径"**一个目录 = 一个条目**"：`listLibrary()` 只遍历库根**一层目录**（`HEAD:server/we-scene-demo-server-8902.mjs:1060-1094`），目录里第 2 个及以后的 `.mpkg` **在列表里根本不存在**（`file` 取 `MPKG_COLLECTION_RE` 命中的**第一个**，`HEAD:896-898` + `HEAD:965-972`）。所以"155 张壁纸只剩 20 条"是**列表层**的事，与路由无关。 |
| 2 | **`/pkg` 404 的两个独立原因** | ①`ID_PAT`/`reIdRoute` 只认**单段 ASCII**（`HEAD:server/we-scene-demo-server.mjs:311-312`）⇒ `GET /pkg/卡提希娅` **连路由都进不去**，落到 `not found:`（实测 404/52B）；②`findScene()` 只找 `<root>/<id>/scene.pkg`（`HEAD:382-389`）⇒ `GET /pkg/other` 走进去但 404/8B `no scene`。二者都不是"路由坏了"。 |
| 3 | **(a) 逐文件成项** | 库根 = `wallpaperE` 时 `GET /api/library` **items: 20 → 151**（`file=150` 逐文件条 + `dir=1` 空目录条；`mpkg=148` + 松散 `mp4=2`），`kinds={scene:65, video:85, unknown:1}`；`itemId` = **相对库根的嵌套路径**（`角色/文件.mpkg`）。`dd`（老布局）**仍是 22 条目录条、0 条文件条**（零回归）。 |
| 4 | **(b) `/pkg/<id>` 吃 `.mpkg`** | `GET /pkg/卡提希娅/卡提希娅_01.mpkg` ⇒ **200 / 294 222 180 B == `stat`**，`cmp` **逐字节相同**；HEAD 的 `Content-Length` = stat、`Range: bytes=0-1023` ⇒ **206/1024**（流式，不整包入内存）；超门槛 ⇒ **如实 413 + 正文说明不截断**（`MPW_LIMIT_PKG_BYTES` 可调，默认 768MB）。老口径 `/pkg/<目录 id>`（`scene.pkg`）**逐字不变**（200 等长；没有 `scene.pkg` 时仍 404/8B `no scene`）。 |
| 5 | **越界一处没放宽** | `assertItemPath()`（段校验）+ **原有唯一判据** `safeJoin()`（`..`⇒400 / 越根⇒403 / 真身⇒403）全部沿用；8899 侧加了等价的三道（`libItemRel`/`libItemResolve`）。读数：`..%2F..%2Fetc%2Fpasswd` ⇒ **400**、`/etc/passwd` ⇒ **400**、软链逃逸 ⇒ **403** 且回不出靶子字节。判据 7 组 + 软链 2 组。 |
| 6 | **真机预览** | 按**渲染器页自己的契约**（`?type=scene&id=<嵌套 id>`）挂 `.mpkg` **真出画**：`容器: PKGM0018 条目 149 个`，画布 `meanL=128.247 / maxL=254.4 / litFrac=0.9997`；纯视频容器 ⇒ `__mpwNoScene={path:"video"}` + `<video 1920x1080>` 真在放（`currentTime=2.08`、`paused=false`）。**但**：在测试台里**点**这个 `.mpkg` 项时，预览挂的是**合成样例**（`meanL=41.7`）—— 原因是 `demo/bench-patch.js` 的 `itemIdOf()` 把嵌套 id 丢了（`scene` 档要求 `src` 里**没有斜杠**），`id=` 没写进 URL ⇒ `demo.html` 用默认 id 404 后退到样例。**这一处不在本轮允许改动的文件里**（见 §6 G1，含 1 行修法）。 |
| 7 | **门禁** | `bench-mpkg-items`（新）**54 PASS / 0 FAIL**，4 组变异**全部变红且红的正是被变异掉的那条**；`bench-dsh-libroot` 绿、`bench-8902` **141/141 绿**、`docs-check` 绿（尾部见 §5）。 |

---

## 1. 取证（改前读数 + `file:line`）

### 1.1 服务端把 `.mpkg` 当成什么

| 位置（HEAD 行号） | 改前的事实 |
|---|---|
| `server/we-scene-demo-server-8902.mjs:668` | `SCENE_CANDIDATES = ['scene.pkg','scenes/scene.pkg','gifscene.pkg']` —— **只有**这三条白名单算"场景入口"，`.mpkg` 不在其中 |
| `:675-677` | `MPKG_EXT_RE=/\.(mpkg\|pkg)$/i`（容器族）、`MPKG_COLLECTION_RE=/\.mpkg$/i`（**只有** `.mpkg` 算合集容器）、`PKG_ONLY_RE=/\.pkg$/i`（`scene.pkg` 这类单场景包**不算**合集） |
| `:760-772` `classifyPkgEntries()` | 容器内条目**只按路径名**判类型，顺序 `scene.pkg\|gifscene.pkg\|scene.json > index.html > 视频 > 嵌套 .mpkg > unknown`；返回 `{kind, scene, html, video, …}` |
| `:896-898` `dirSignals()` | `const mpkgNames = names.filter(MPKG_COLLECTION_RE).slice(0,12)` ⇒ 一个目录里**最多认 12 个**容器，且**只作为"目录条目"的属性**；`:898` 只对**每一个**容器调 `mpkgSummary()` 读目录表（**只读表，不解包**） |
| `:922-934` `decideKind()` | `if (sig.containers.length) return { kind: 'mpkg', … }` ⇒ 目录里**有 `.mpkg` 就整条判成 `mpkg`**（17/20 个角色目录命中），内层类型只落在 `containerKind` |
| `:952-1031` `libraryItemFromDir()` | `:965-972` 的 `file` 取值：`project.file → scene → html → video → isContainerItem ? container.name : null` ⇒ **`.mpkg` 目录的 `file` = 第一个容器**（`sig.containers[0]`，即 `mpkgNames[0]`，字典序第一个） |
| `:1024-1027` | `container:true` / `containerKind` / `containerEntry` / `mpkgFiles[]`（只是一个**目录**的属性袋） |
| `:1041-1110` `listLibrary()` | `:1060` `for (const name of listDirNames(activeRoot))` ⇒ **只扫库根一层**；`:1065-1070` 顶层**散文件**（含顶层 `.mpkg`）**不进列表**，只在 `scan.looseFiles/looseMpkgFiles` 里计数 |
| `:390-404` `assertItemId()` | itemId = **单个路径段**（ASCII `[A-Za-z0-9][A-Za-z0-9._-]*`，或"含非 ASCII 的单段名"）⇒ `角色/文件.mpkg` 这种**嵌套路径连第一关都过不去** |
| `:371-388` `safeJoin()` | **本文件唯一的路径判据**：`..`⇒400、越根⇒403、真身（realpath）越根⇒403 |
| `:539` | `const itemDirReal = (id) => path.join(activeRoot, assertItemId(id))` —— 所有按 itemId 解析的路由都从这里取根 |
| `:2748` `mediaServe()` / `:1980` `/api/mpkg` / `:1476` `thumbPlan()` / `:2033` `/api/props` / `:2193` `/api/reveal` / `:2155` `/api/delete` | 全部 `assertItemId()` + `isDirectory()` ⇒ **只认"库根的直接子目录"这一种条目** |
| `:1528` `RENDERER_ROOT_ROUTES` | `/pkg/`、`/project/`… 这批渲染器页自己的根路由要**本地直供/反代**（名单本身不改） |

**改前真机读数**（库根 `POST /api/library-dir {wallpaperE}`，`GET /api/library`）：

```jsonc
{ "count": 20, "source": "user",
  "kinds": { "scene": 0, "video": 2, "web": 0, "mpkg": 17, "unknown": 1 },
  "containerKinds": { "scene": 7, "video": 10, "web": 0, "mpkg": 0, "unknown": 0 },
  "signals": { "withScene": 0, "withHtml": 0, "withVideo": 2, "withMpkg": 19, "withPreview": 0, "withProject": 0,
               "noPreview": 20, "renderable": 2, "mismatch": 0 },
  "items[0]": { "itemId": "卡提希娅", "type": "mpkg", "file": "卡提希娅_01.mpkg", "hasScene": false, "scenePkg": null, "container": true } }
```

磁盘上其实是 **148 个 `.mpkg` + 2 个 `.mp4`**（`find … -name '*.mpkg' | wc -l` = 148；`PKGM0018×5 / PKGM0014×143`，**全部**含 `preview.*`；
抽样：`PKGM0014+scene.json+preview ×60`、`PKGM0014+video+preview ×83`、`PKGM0018+scene.json+preview ×5`）。
⇒ **列表里能看见的只有 20 条（每角色 1 条），另外 130 张壁纸"不存在"**。

> ⚠ 与任务书里"155 个 `.mpkg`"的差异（**如实记，不圆场**）：本机**当前**是 **148** 个。
> `tests/mpkg-sweep-test.mjs:3` 那句"全库 155 个（`PKGM0014`×145 / `PKGM0018`×10）"是**当时**的读数，
> 之后语料有过增删/改名（该文件自己的候选表里还引用着已不存在的 `wallpapertest1_*`、`delete/**`）。
> 所以验收口径里的"≈155+"在本机取到的是 **151 条**（150 文件条 + 1 空目录条）—— 差的 4 个是**语料本身不在**，
> 不是扫描器漏项：`A3a` 判据是"**磁盘上有几个 `.mpkg` 就必须成几条**"，实测 148 ⇒ 148。

**容器字节本来是能取到的**（改前就成立，用来排除"路由坏了"）：

```
GET /media/dev/卡提希娅/卡提希娅_01.mpkg   → 200 / 294 222 180 B (application/octet-stream)
GET /pkg/卡提希娅                          → 404 / 52 B  body="not found: /pkg/%E5%8D%A1%E6%8F%90%E5%B8%8C%E5%A8%85"
GET /pkg/佩丽卡                            → 404 / 43 B
GET /pkg/other                             → 404 /  8 B  body="no scene"
GET /pkg/sample-synthetic                  → 200 / 33 299 B（对照：目录型 sample 一直是对的）
GET /api/mpkg?item=卡提希娅                → 200 / 1 226 B（容器目录表可读）
```

### 1.2 渲染器页用 `?id=` 挂载时走哪条路由、它能不能吃 PKGM

| 位置 | 事实 |
|---|---|
| `demo.html:3390`（HEAD） | `const url = '/pkg/' + id` —— 取包用的是**根绝对路径**，`id` 来自 `?id=`（`demo.html:1948` `new URL(location.href).searchParams.get('id') \|\| '3554161528'`） |
| `demo.html:3413` | `pkg = lib.parsePkg(buf)` ⇒ **容器字节整体进内存**后解析 |
| `demo.html:3414` | `logf('容器: ' + pkg.magic + ' 条目 ' + pkg.entries.length + ' 个')` —— 判"有没有真吃下这个容器"的**现成读数** |
| `demo.html:3425-3483`（MPW-NOSCENE） | **能不能吃 PKGM：能**。有 `scene.json` ⇒ 走场景；**没有** `scene.json` 但有视频 ⇒ 按"纯视频壁纸"播（blob + `<video>`）；两者都没有 ⇒ 如实报错并列出条目名 |
| `core/we-scene-bundle.js` 的 `parsePkg` | 认 `PKGV####` **与** `PKGM####`（`:8902` 的 `parsePkgTable` 注释 `:721-723` 与它同口径） |

⇒ **渲染器页不需要改**（任务书第 5 条的前提不成立：它确实支持 PKGM）。本轮**一个字节都没碰** `demo.html`。

但渲染器页的取包契约是 `?id=`，而**产物测试台**写进 iframe 的是 `?type=…&src=…`：
`demo/assets/bench-DSKWIqmS.js` 的 `wt(e)`：`t==="scene" ? n.set("src", e.itemId) : …`（`URLSearchParams` 会把 `/` 编成 `%2F`）；
`demo/bench-patch.js`（repo 档）在 `rendererSourceUrl()` 里补 `id=`：`bench-patch.js:1739-1745` 的 `itemIdOf()` 对 `scene` 档要求
`src && !/[\/\\]/.test(src)` ⇒ **嵌套 id 直接被丢掉**（`get('id')` 也没有）⇒ 预览 URL 里**没有 `id=`**。
这正是 §3.3 里"点了 `.mpkg` 项却挂着合成样例"的原因（**不在本轮可改文件清单内**，见 §6 G1）。

---

## 2. 改法

### 2.1 (a) 逐文件成项（`server/we-scene-demo-server-8902.mjs`）

1. **容器摘要多两个细分字段**：`classifyPkgEntries()` 除聚合的 `scene`（= `scene.pkg|gifscene.pkg|scene.json`）外，另回
   `sceneJson` / `scenePkg`。**聚合字段与顺序一字未改**（`decideKind`/`containerKinds` 的既有读数不受影响），
   新增的两个字段专给"**渲染器页到底吃不吃**"用（它的场景路只认 `scene.json`）。
2. **`libraryItemFromFile(id, loc)`**：单个文件型条目，形状与 `libraryItemFromDir()` **同字段**（老消费方只认老字段也能用）：

   | 字段 | 文件型条目的口径 |
   |---|---|
   | `itemId` | **相对库根的嵌套路径** `<目录>/<文件名>`（例如 `卡提希娅/卡提希娅_01.mpkg`） |
   | `file` / `entryFile` | 文件名本身 |
   | `dir` / `parentDir` | 所在目录（相对库根）；`itemRole:"file"` |
   | `type` / `kind` | **容器内条目判定**：`scene.json`⇒`scene`、视频⇒`video`、`index.html`⇒`web`、只有嵌套 `.pkg`⇒`scene`（容器套容器）、都没有⇒`unknown` |
   | `hasScene` | 该容器**能按场景挂载**（= 有 `scene.json`）—— 产物页 `wt()` 用 `hasScene ? 'scene' : type` 选 `?type=`，必须与"渲染器真能吃"一致 |
   | `preview` | **恒 `null`**（容器里的 `preview.*` 不是磁盘同级文件，给 `/media/dev/<itemId>/<preview>` 会 404）；`previewInContainer` 另字段给条目名 |
   | `thumbUrl` | `/api/thumb?item=<嵌套 id>`（服务端只读容器内**未压缩**的 `preview.*` 那一段字节） |
   | `renderable` | **渲染器页真能吃**才算 true：`scene.json`⇒true、无 `scene.json` 但有视频⇒true（NOSCENE 纯视频路）、只有 `index.html`⇒**false**（网页档要磁盘上的入口 URL）、只有 `scene.pkg`⇒**false**（场景路只认 `scene.json`）；两者都带 `renderReason` |
   | `container*` / `mpkgFiles` | 与目录型同形（`container`/`containerKind`/`containerEntry`/`containerPreview`/`mpkgFiles[1]`），另加 `containerMagic`/`containerEntries` |
3. **`libraryEntriesForDir(id, dir, budget)`**（一个目录 → 条目数组）—— 本轮**唯一**的口径变化，**避免重复计数**的三条规则：

   | 规则 | 说明 |
   |---|---|
   | ① 目录顶层**有 `.mpkg`** ⇒ **逐文件成项**：每个 `.mpkg` 一条，**并且同一目录里的松散视频也各成一条**（实测 `伊蕾娜/`=5 `.mpkg`+1 `.mp4`、`流萤/`=4+1；不这么做"换个目录就少几张壁纸"还是同一类毛病） |
   | ② 逐文件成项的目录**不再产出"目录那一条"**：目录条与文件条是**同一批壁纸的两种表示**，两条都给 = 重复计数（148 文件 + 20 目录 = 168，而库里只有 148 张） |
   | ③ 目录顶层**没有 `.mpkg`** ⇒ 维持旧口径"目录本身一条"（`dd/<id>/scene.pkg`、网页档、只含一个 mp4 的视频档、空目录、`<目录>/<子目录>` **逐字不变**） |
   | ④ 一个容器都没 `stat` 成功（权限/断链/**软链逃逸**）⇒ 退回"目录那一条"并把该文件写进 `scan.skippedList`（不静默丢、不把库外文件的 title/size 泄进列表） |

4. **`scan` 多一块可核对读数**：`scan.itemRoles = {fileItems, dirItems, mpkgFiles, videoFiles, failedFiles, note}`，
   恒有 `fileItems + dirItems === count`（判据 `A1g`/L6b 就钉这一条）。

### 2.2 嵌套 `itemId` 的路由面（**全部走同一条路径判据**）

新增（8902，紧跟原有 `assertItemId` 之后）：

```js
const ITEM_PATH_MAX_SEGS = 8
function assertItemPath(id)      // 每段：非空、不以 "." 开头、无 / \ 控制符、≤120 字符、≤8 段
const itemAbsPath = (id, label) => safeJoin(activeRoot, assertItemPath(id), label || 'itemId')   // ← 原有唯一判据
function itemLocate(id)          // → { id, abs, real, isDir, isFile, dir, base, st }（目录项 / 单文件项）
function splitItemRel(rawPath)   // /media|web/dev/** 的 itemId/rel 切分：**最长的"目录前缀"** = itemId
```

`itemLocate()` 一次收口"目录型"与"文件型"两种条目，**没有第二条路径判据**（`..`/越根/真身三道全在 `safeJoin()` 里，一处没放宽）。
改动的路由（每条都保持老状态码/老文本可判）：

| 路由 | 改动 |
|---|---|
| `/media/dev/**`、`/web/dev/**` | `splitItemRel()`：`/media/dev/<角色>/<文件>.mpkg` 的**两种读法**（`item=<角色>`+`rel=<文件>` 与 `item=<角色>/<文件>`）都成立且字节相同；找不到目录前缀时整条按单文件项；rel 段**保持百分号编码原样**（`safeJoin` 内部解码一次 —— 与老行为逐字一致） |
| `GET /api/mpkg?item=` | 目录型（`item=<目录>&file=<容器名>`，老形状）/ **单文件型**（`item=<嵌套 id>`）都吃 |
| `GET /api/thumb?item=` | `itemLocate()` + 文件型走容器内 preview；缓存名 `<itemId>` 的 `/` 换 `__`（单段 id 与改前**逐字相同**） |
| `GET/POST /api/props` | 属性表来自"**条目所在的目录**"的 `project.json`（文件型退一层到它的目录），回字段多 `itemRole`/`propsSourceDir` |
| `POST /api/props-file` | 回读 URL 由写入侧 `encodeURIComponent(item)` 拼（`/`⇒`%2F` 仍是**一段**）⇒ 形状判据（3 段）不用改；POST 用 `itemLocate()` |
| `GET /api/props-dir` | 文件型 ⇒ 枚举它**所在的目录** |
| `POST /api/delete` | 目录型 ⇒ 移整个目录（老口径不变）；**文件型 ⇒ 只移那个文件**（不连坐同目录的其它容器）；默认仍 dryRun、仍移回收站可 `mv` 回滚 |
| `POST /api/reveal` | 文件型 ⇒ 落点是**它所在的目录**（调用方文案就是"打开所在文件夹"） |

`server/we-scene-demo-server.mjs`（8899，**同一份**被 8902 本地直供的处理器）同样收口：

```js
function libItemRel(id)                 // 段校验（".."、".x"、控制符、>8 段 ⇒ null）
function libItemResolve(root, id)       // 词法前缀 + 真身（realpath）两道；400=id 非法 / 403=越根或软链逃逸 / 404=不存在
```

`/pkg`、`/project`、`/ddlist`、`/type` 四条从 `reIdRoute(prefix)`（单段 ASCII）改成 `^\/<name>\/(.+)$` + 解码 + `libItemRel()`
（`reIdRoute` 因此**没有调用点了，已删**；`ID_PAT` 仍在用 —— `/shot/<id>` 的过滤口径，没动）。
`/project`、`/type` 对**文件型** id 退一层到它所在的目录找包旁 `project.json`；`/ddlist` 对文件型 id **如实回空表**
（视频在容器里，`/ddvideo` 只服务磁盘上的松散文件 —— 不编一个取不到的假名字）。

### 2.3 (b) `/pkg/<id>` 支持 `.mpkg`（`server/we-scene-demo-server.mjs`）

路由匹配放宽成 `^\/pkg\/(.+)$` + `decodeURIComponent` + `libItemRel()`（**解出来的 id 一律过三道校验**）。分支顺序：

1. **老口径优先**：`findScene(id)` ⇒ `<root>/<id>/scene.pkg` **逐字不变**（200 + `application/octet-stream`）；
2. **新增文件型**：`<root>/<id>` 本身是 `.mpkg`/`.pkg` **文件** ⇒ 回**容器字节**；
3. 都没有 ⇒ 404 + **老文本 `no scene`**（既有客户端按这段文本判断，一个字没换）；`..`/绝对路径 ⇒ **400**、软链逃逸 ⇒ **403**。

**409/413 + 流式**：`PKG_MAX_BYTES`（默认 **768MB**，`MPW_LIMIT_PKG_BYTES` 可调；与 8902 的 `/api/fs/file` 同一把尺子）
以上 ⇒ **如实 413** + 正文写明"本路由**不截断**包体"；门槛内一律 `sendFileStream()`（`fs.createReadStream` + Range），
**不再 `fs.readFileSync(整个包)`**（老实现对 294MB/331MB 的包每次请求都在单线程里放一份完整副本）。

### 2.4 安全口径（一处没放宽）

| 防线 | 位置 | 判据 |
|---|---|---|
| 段校验 | `assertItemPath()`（8902）/ `libItemRel()`（8899） | `A2f` 里 7 组 `/api/**`、`/media/**`、`/pkg/**` 越界串全 **400** |
| 原有唯一判据 | `safeJoin()`（8902，**未改一行**） | 词法 `..`⇒400、越根⇒403、真身越根⇒403 |
| 等价三道 | `libItemResolve()`（8899） | 软链逃逸 ⇒ **403**（`forbidden id: 经符号链接越出库根：…`），且**回不出靶子字节** |
| 扫描侧 | `libraryEntriesForDir()` 的 `add()` | 软链出去的 `.mpkg` **不成条**，写 `scan.skippedList`（否则"列表里看得见、取不到" + 库外 title/size 泄漏） |
| 变异自证 | `M3`（**同时**拆五处：段校验 + `safeJoin` 三道 + `itemLocate` 真身） | 该组变异下 `A2f`/`A2h` **必须变红**（实测红）—— 证明这些防线是**纵深**的，只拆一层不够 |

### 2.5 受口径变化影响的既有判据（`tests/bench-server-test.mjs`，改前工作树干净）

`types/mpkg-scene/` 里只有一个 `.mpkg` ⇒ 该目录从"目录一条（`kind=mpkg`）"变成"**嵌套路径一条**（`kind` 按容器内容判）"。
3 条期望重算（**都是口径变化的必然后果，不是把判据改宽**）：

| 判据 | 改前 | 改后 | 为什么 |
|---|---|---|---|
| L2 `kinds` | `{scene:3, video:2, web:1, mpkg:1, unknown:1}` | `{scene:4, video:2, web:1, mpkg:0, unknown:1}` | 那条从"mpkg 容器档"变成按内容判的 `scene`；`count` 仍 **8**（8 目录 ⇒ 7 目录条 + 1 文件条） |
| L3 `signals` | `withScene:3, withPreview:5` | `withScene:4, withPreview:6` | 文件条也有 scene 信号与容器内预览 |
| L6 | `itemId=mpkg-scene`、`kind=mpkg`、`type=mpkg` | `itemId=mpkg-scene/夹具容器_01.mpkg`、`itemRole=file`、`kind/type=scene`（容器里只有 `scene.pkg` ⇒ `renderable=false` + 理由）、`thumbUrl=/api/thumb?item=…` | 断言**更严**（多了 itemId 形态 / itemRole / 容器内容派生 type / 不可渲染的理由） |
| L6b（**新增**） | — | `!it('mpkg-scene')` 且 `fileItems + dirItems === count` | 把"目录条不重复计数"这条口径也钉进老门禁 |

`/api/mpkg`、缩略图、`/media/dev/**` 的**老形状断言（L11-L19）一条没改，全绿** —— 老读法仍然成立。

---

## 3. 端到端读数（真跑，读数原样）

### 3.1 库根切到 `wallpaperE`（`:8902`，新代码）

```
POST /api/library-dir {"dir":"/root/Desktop/DSHarea/allwallpaper/wallpaperE"}
→ {ok:true, dir:…/wallpaperE, source:"user", selected:true}

GET /api/library
→ count = 151        （= 150 逐文件条 + 1 空目录条；`未分类/` 是空目录 ⇒ 维持旧的"目录一条"）
  scan.kinds           = {"scene":65,"video":85,"web":0,"mpkg":0,"unknown":1}
  scan.containerKinds  = {"scene":65,"video":83,"web":0,"mpkg":0,"unknown":0}
  scan.dirs            = 20    looseFiles = 0    skipped = 0    opsUsed = 180    durationMs = 332
  scan.itemRoles       = {"fileItems":150,"dirItems":1,"mpkgFiles":148,"videoFiles":2,"failedFiles":0,
                          "note":"目录顶层有 .mpkg ⇒ 逐文件成项（每个 .mpkg 一条 + 同目录视频各一条），不再产出\"目录那一条\"…"}

抽样 5 条（itemId / type / file）
  1) other/夜莺night——【time_variation_时间变化】alone_孤独の少女【原画：rella].mpkg   type=scene  file=夜莺night——…mpkg
  2) other/红鸾樱落.mpkg                                                              type=scene  file=红鸾樱落.mpkg
  3) 伊蕾娜/伊蕾娜1_8.mpkg                                                            type=video  file=伊蕾娜1_8.mpkg
  4) 伊蕾娜/伊蕾娜_04.mpkg                                                            type=video  file=伊蕾娜_04.mpkg
  5) 伊蕾娜/伊蕾娜_05.mpkg                                                            type=video  file=伊蕾娜_05.mpkg

一个 scene 档样本（容器内有 scene.json）
  {itemId:"佩丽卡/zmd_08.mpkg", type:"scene", file:"zmd_08.mpkg", hasScene:true,
   magic:"PKGM0014", entries:4, size:61441009, renderable:true}

改前对照（同一条命令、旧代码）：items = 20（20 个角色目录，file=各目录第一个 .mpkg），kinds={"mpkg":17,"video":2,"unknown":1}
```

⚠ 逐条核对 `scan.kinds.scene=65 / video=85`：**65 = 60 + 5**（`PKGM0014+scene.json` 60 个 + `PKGM0018+scene.json` 5 个），
**85 = 83 + 2**（83 个 `PKGM0014+video` 容器 + 2 个松散 `.mp4`）—— 与 §1.1 里对 148 个容器目录表的离线普查**逐类吻合**。

### 3.2 `/pkg/<id>` 等长、流式、413

```
GET /pkg/卡提希娅/卡提希娅_01.mpkg
→ 200  bytes=294 222 180  ct=application/octet-stream  time=1.339s
  stat=294 222 180  …/wallpaperE/卡提希娅/卡提希娅_01.mpkg
  cmp /tmp/pkg-294.bin <该文件>  →  逐字节相同

HEAD /pkg/卡提希娅/卡提希娅_01.mpkg
→ 200  X-Bench-Served: local   content-type: application/octet-stream   （content-length = stat）
GET  + Range: bytes=0-1023  →  206  bytes=1024
（⇒ 整包与分块都走流式路径；读者可自行加 `time -v` 看峰值 RSS，本报告只给协议读数）

老口径对照
  /pkg/<目录 id>（有 scene.pkg）  → 200 等长（夹具 28 B；真语料 dd/<id> 逐字不变）
  /pkg/卡提希娅（目录、无 scene.pkg）→ 404 / 8 B  body="no scene"   ← **与改前逐字相同**
  /pkg/不存在的包                  → 404 / 8 B  body="no scene"
  /pkg/..%2F..%2Fetc%2Fpasswd      → 400（8902 的 URL 级 `..` 拒绝）
  /pkg/%2Fetc%2Fpasswd             → 400 bad id（`libItemRel` 段校验）
  /pkg/角色乙/逃逸.mpkg（软链到库外）→ 403 forbidden id: 经符号链接越出库根：角色乙/逃逸.mpkg

其它路由（真语料：卡提希娅/卡提希娅_01.mpkg）
  /project/<nested> → 404（wallpaperE 里**没有** project.json，如实 404）
  /type/<nested>    → 200 {"ok":true,"type":"unknown"}
  /ddlist/<nested>  → 200 {"ok":true,"files":[],"itemRole":"file","note":"容器型条目：视频在容器内…"}
  /api/mpkg?item=<nested> → 200（PKGM0014 / kind=scene / entries=4）
  /api/thumb?item=<nested> → 200 image/jpeg  X-Bench-Thumb: container-preview  X-Bench-Entry: preview.gif  709 460 B
```

**413 门槛实测**（独立实例 `MPW_LIMIT_PKG_BYTES=1`，夹具）：

```
GET  /pkg/角色甲/甲_01.mpkg → 413  "package too large: 223 bytes > limit 1 (MPW_LIMIT_PKG_BYTES) — 请求被拒绝；本路由**不截断**包体"
GET  /pkg/场景丙（老口径）  → 413（同一把尺子）
HEAD /pkg/角色甲/甲_01.mpkg → 413（不是"HEAD 放行、GET 拒绝"）
```

### 3.3 真机预览（浏览器；同一时刻**只有一只 Firefox**，跑完立刻关）

口径 = `tests/_gl-browser.mjs` 的 `launchGLBrowser`（有头优先 + GL 能力前置 + 无 GL 打 SKIP）。
本轮读数（三段，同一只浏览器，`GL 前置: {"launch":"有头 DISPLAY=:0","webgl2":true,"ver2":"WebGL 2.0","renderer":"llvmpipe, or similar"}`）：

**① 在测试台里真的去"点一个 `.mpkg` 项"**（`other/红鸾樱落.mpkg`，9.8MB，容器内有 `scene.json`）：

```
点击后 iframe src =
  /webloader/?type=scene&src=other%2F%E7%BA%A2%E9%B8%BE%E6%A8%B1%E8%90%BD.mpkg&fit=cover&renderDpr=1&sceneFps=60
            &filter=none&muted=true&loop=true&mediaBase=http%3A%2F%2F127.0.0.1%3A8902%2Fmedia%2Fdev
            &_t=1790203429556&res=dpr&shell=0                     ← ⚠ 没有 `id=` 这一段
渲染器页日志（iframe 内 #log）：
  "⚠ 默认包 3554161528 不可用（HTTP 404）—— 本仓库不分发真实壁纸 → 改用自带合成样例 sample-synthetic"
  "容器: PKGV0022 条目 8 个"                                       ← 8 个条目 = 合成样例（不是 149 个的 .mpkg）
画布读数：canvas 382x214   meanL=41.689  maxL=247  stdL=39.406  litFrac=0.9992   （= **合成样例**的画面）
pageerror：0 条
```

⇒ **没有出现 `PKG HTTP404` / `pkg HTTP 404` 字样**（改前的用户原话症状），**但**预览挂的不是刚点的那个 `.mpkg`，
而是"打开就有画面"的合成样例 —— 根因在 `demo/bench-patch.js:1739-1745` 的 `itemIdOf()`（`scene` 档要求 `src` 里没有 `/`），
**该文件不在本轮允许改动的清单里**（§6 G1 给了 1 行修法 + 用本段读数做的验证）。

**② 按渲染器页**自己的**契约把同一项挂上**（`?type=scene&id=<嵌套 id>`，= G1 修好后测试台应当产生的 URL）：

```
url = /webloader/?type=scene&src=<nested>&id=other%2F%E7%BA%A2%E9%B8%BE%E6%A8%B1%E8%90%BD.mpkg&…&res=dpr&shell=0
渲染器页日志： "容器: PKGM0018 条目 149 个"                          ← **真吃下了这个 .mpkg**
画布读数：    canvas 382x214   meanL=128.247  maxL=254.4  stdL=43.938  litFrac=0.9997   ← 真出画（非空、非黑）
bootError：   null
```

**③ 纯视频容器**（`洛茜/洛茜_13.mpkg`，4.2MB，PKGM0014 三条目 = `preview.gif`+`project.json`+mp4）：

```
url = /webloader/?type=video&src=<nested>&id=<nested>&…&res=dpr&shell=0
渲染器页日志： "容器: PKGM0014 条目 3 个"
              "⚠ 容器里没有 scene.json（不是场景包）⇒ 按**纯视频壁纸**播放：[Arknights Endfield] Rossi relax pose (1920x1080).mp4（3.1MB）"
              "视频已加载 1920x1080"
window.__mpwNoScene = {"path":"video","entry":"[Arknights Endfield] Rossi relax pose (1920x1080).mp4", …}
<video> 读数：      blob:http://127.0.0.1:8902/…  1920x1080  currentTime=2.08  paused=false  error=null
画布：      300x150（空，符合预期 —— 视频是 DOM 覆盖层，不走画布）
```

⇒ 83 个"纯视频容器"这条路的 `renderable=true` 分类**被真机验证**（`__mpwNoScene.path="video"` + 视频真的在放）。

**④ 点击时序的坑（如实记）**：第一版探针在页面 ready 后**立刻**点列表，读到的 iframe src 仍是 `sample-synthetic` ——
原因是 `demo/bench-patch.js` 在 load 后 **1.2s** 会把预览**导航**到"打开就有画面"的样例（`loadRepoDefaultSample`），
晚于点击就**覆盖**了点击结果。第二版探针**先等 7s** 再点，才拿到 ① 的读数。
（这不改变结论，但会影响任何"点了没反应"的现场判断：**点击必须晚于 1.2s 的默认样例导航**。）

### 3.4 复原读数

```
✅ POST /api/library-dir {"reset":true} → {ok:true, dir:"/root/Desktop/DSHarea/allwallpaper/dd", reset:true, source:"default", selected:false}
GET /api/library-source →
  {"dir":"/root/Desktop/DSHarea/allwallpaper/dd","source":"default","selected":false,"explicit":false,
   "configuredDir":"/root/Desktop/DSHarea/allwallpaper/dd","exists":true,
   "reason":"**没有人选过**：按候选顺序探测后采用 …/allwallpaper/dd（工作区语料布局 <MPW_ROOT>/allwallpaper/dd（不是产品默认，只是第一条候选））…"}
GET /api/library → count=22  source=default  kinds={"scene":11,"video":4,"web":7,"mpkg":0,"unknown":0}
                  itemRoles={file:0, dir:22}      ← 老布局**一条文件条都不多**（零回归）
```

`:8902` 仍是**重启后的新代码**、库根 = **默认**（`source=default`），Firefox 已关（无残留进程）。

---

## 4. 判据与变异读数（`tests/bench-mpkg-items-test.mjs`，纯 Node，~16s）

A 段 = 临时夹具（三层布局 `库根/<角色>/<文件>.mpkg` + 目录里混视频 + 容器内 scene/video/web/scene.pkg-only 四档
+ 没有 `.mpkg` 的目录三种 + 顶层软链逃逸目录 + 软链逃逸容器 + 超门槛大包）+ **真起一份 8902**；
A2o = 独立实例（`MPW_LIMIT_PKG_BYTES=1`）；A3 = 真语料条件项（`wallpaperE` / `dd` 不存在则 SKIP 并打印读数）。

```
PASS 54 / FAIL 0（A 段 45 = A1 扫描 13 + A2 路由 23 + A2o 413 门槛 3 + A3 真语料 6；变异自证 9 = 4 变异 × 2 + 真树逐字相同 1）

A3 真语料读数：磁盘 148 个 .mpkg（20 个目录）/ 列表 items=151（file=150 mpkg=148 dir=1）
              kinds={"scene":65,"video":85,"web":0,"mpkg":0,"unknown":1}
  A3a 磁盘上每个 .mpkg 都在列表里成条（148 个 ⇒ 148 条）        disk=148 items=148 count=151
  A3b 每条 itemId = 相对库根的嵌套路径 <目录>/<文件名>            ["other/夜莺night——…mpkg","other/红鸾樱落.mpkg","伊蕾娜/伊蕾娜1_8.mpkg"]
  A3d ★真语料 /pkg/<嵌套 id> ⇒ 200 且与 stat 等长               200 9 830 296 B vs stat 9 830 296 B（取最小的一份）
  A3e 最大的那份（315.9MB）走流式：HEAD 的 Content-Length = stat，Range 1KB ⇒ 206
                                                                HEAD 200 len=331 194 792 vs 331 194 792 · Range 206 1024B
  A3f 零回归：dd 仍然只有"目录条"                                dirs=22 items=22 fileItems=0
```

**变异自证（MUTANT-RED-OK：改回旧口径 ⇒ 判据必须变红，且红的正是被变异掉的那条）** —— 镜像里改，真树一字不动（跑前跑后两个服务文件内容相同，判据 `ok`）：

| 变异 | 载荷 | 期望红 | 实际 |
|---|---|---|---|
| **M1** 把"逐文件成项"退回"目录一条" | `libraryEntriesForDir` 的早退分支改成恒 `return [libraryItemFromDir(...)]` | `A1a`/`A1g`/`A1h` | 退出码 1、**12 条 FAIL**，命中 `A1a,A1g,A1h` ✅ |
| **M2** 去掉 `/pkg` 的 `.mpkg` 分支 | `if (r.ok) { if (false) { hit = … } }` | `A2a`/`A2b`/`A2e` | 退出码 1、7 条 FAIL，命中 `A2a,A2b,A2e`（+`A2o`） ✅ |
| **M3** 放宽越界校验（**同时**拆段校验 `..` + `safeJoin` 三道 + `itemLocate` 真身 = 纵深防御五处） | 见文件内 `MUTATIONS[2]` | `A2f`/`A2h` | 退出码 1、5 条 FAIL，命中 `A2f,A2h` ✅ |
| **M4** 嵌套 itemId 从查询参数路由里退回 | `itemLocate` 改用单段 `assertItemId` | `A2i`/`A2j`/`A2k` | 退出码 1、5 条 FAIL，命中 `A2i,A2j,A2k`（+`A2m`） ✅ |

`MUTANT-RED-OK "（本轮全部变异都已变红，见上）"`；末尾机读行 `BENCH-MPKG-ITEMS-JSON {"pass":54,"failed":[]}`。

> 变异 1 第一版曾把子进程**弄崩**（`undefined.kind` 的 TypeError）而不是让它变红 —— 那是**假红**（变异体崩 ≠ 判据在干活）。
> 已把取条目的地方统一成"取不到给空对象"，现在变异体是**老老实实产出 FAIL 行**，退出码 1、机读 `failed[]` 里能查到名字。

---

## 5. 门禁尾部

命令：`bash tests/run-all-tests.sh --only bench-dsh-libroot bench-mpkg-items bench-8902 docs-check`
（`--list` 先查名：`bench-mpkg-items` 在册；另外单独跑过 `node tests/docs-check.mjs`）

```
[gate] MPW_PERF_PKG = /root/.dsh-mpkg-wallpaper/5a85a54b12b64bc882d1e7bab0f8e837.mpkg（扫描 …/*.mpkg 取最大者：331194792 B）
PASS bench-dsh-libroot (27729ms)      ← 含它的浏览器 B 段（GL 前置：有头 DISPLAY=:0）
PASS bench-mpkg-items (16268ms)       ← 本轮新增项（54 断言 + 4 组变异自证）
PASS bench-8902 (101124ms)            ← 断言 141 项：通过 141 / 失败 0 / SKIP 0
PASS docs-check (845ms)
══ 汇总：PASS=4 FAIL=0 SKIP=0 / 总 4 项
（本次运行产物：/tmp/mpw-gate-20677-1790203770 ；日志副本：…/last.log）
EXIT=0
```

> 这是**收尾定稿后**（只改了两处注释：把 8899 里"最大 294MB"改成实测的 **331.2MB**、"软链逃逸 ⇒ 400/404"改成 **403**）重跑的读数，
> 与 §3/§4 里引用的那次（`PASS=4 FAIL=0`）逐项一致。

单独跑文档门禁（任务书点名的那条）：

```
$ node tests/docs-check.mjs
检查 17 个文档 · 782 个文件引用 · P-编号健康 ✓ · diag-flags ✓   diag-flags.json 未变（保持旧时间戳，不落盘）（common=11 个常用）
✓ 文档一致性全部通过                     （exit 0）
```

单独跑本轮新增项（人读读数 + 机读行）：

```
$ node tests/bench-mpkg-items-test.mjs
  …（A1/A2/A2o/A3 各段读数见 §4）…
═══ 汇总：PASS=54 FAIL=0 ═══
MUTANT-RED-OK "（本轮全部变异都已变红，见上）"
BENCH-MPKG-ITEMS-JSON {"pass":54,"failed":[]}          （exit 0）
```

`bench-8902` 那一项也**单独跑过一次**（40 次断言前的完整读数）：`断言 141 项：通过 141 / 失败 0 / SKIP 0` —— 其中
L2/L3/L6/L6b 就是 §2.5 里重算/新加的四条，L11-L19（`.mpkg` 的老形状：`/api/mpkg?item=<dir>&file=`、缩略图、`/media/dev/**`）**一条没改、全绿**。

**额外回归面**（本轮改到的是**共享路由**：`/pkg`、`/project`、`/ddlist`、`/type`、`/api/props`、`/api/thumb`、
`/media/dev/**`、`/api/delete`、`/api/reveal`）⇒ 另外单独跑了四个受影响的既有门禁项，全绿：

```
$ bash tests/run-all-tests.sh --only mpkg-noscene bench-props-text bench-shell-fixes pack-closure
PASS mpkg-noscene (381ms)   PASS bench-props-text (149ms)   PASS bench-shell-fixes (433ms)   PASS pack-closure (21407ms)
══ 汇总：PASS=4 FAIL=0 SKIP=0 / 总 4 项
EXIT=0
```

---

## 6. 没能验证的 / 边界 / 已知缺口

### G1（**最重要**）测试台"点 `.mpkg` 项"这最后一跳，测试台侧丢嵌套 id —— 不在本轮允许改的文件里

* **现象（§3.3 ①，原样读数）**：点 `other/红鸾樱落.mpkg` 后 iframe src 里 **只有 `src=` 没有 `id=`**，
  渲染器页按默认 id `3554161528` 取包 → 404 → 退到合成样例（`容器: PKGV0022 条目 8 个`、`meanL=41.7`）。
  日志里那句是 `⚠ 默认包 3554161528 不可用（HTTP 404）…`，**不是** `pkg HTTP 404` —— 症状换了，但"点了不出我要的那张"仍在。
* **根因（file:line）**：`demo/bench-patch.js:1739-1745`
  `if (type === 'scene' && src && !/[\/\\]/.test(src)) return src` —— 嵌套 id 带 `/` ⇒ 返回 `''` ⇒ `1781-1782` 的
  `const itemId = get('id') || itemIdOf(...)` 拿到空 ⇒ `if (itemId) upsert('id', …)` 不执行。
* **最小修法（1 行，属于 `demo/bench-patch.js`，本轮**未**动）**：把那条斜杠判据放宽为"**相对路径**（不以 `/` 开头、不含 `..`、不是绝对 URL）"即可，例如
  `if (type === 'scene' && src && !/^[\/\\]/.test(src) && !src.includes('..') && !/^[a-z]+:\/\//i.test(src)) return src`。
  产物侧 `wt()` 对 scene 档写的就是 `src = e.itemId`（`URLSearchParams` 把 `/` 编成 `%2F`，`get()` 会解回来），
  所以这一行足以让 `id=<嵌套 id>` 出现在 URL 里。
* **验证方式（本轮已做，§3.3 ②）**：手工把 URL 补成 `?type=scene&id=<嵌套 id>` ⇒ `容器: PKGM0018 条目 149 个` + `meanL=128.247`。
  也就是说：**服务端 + 渲染器页这一整条已经通了，缺的只是测试台那一行**。
* **建议**：主线决定谁改（`demo/bench-patch.js` 在本轮禁改清单里）—— 改完把 §3.3 ① 的探针重跑一遍即可闭环。

### G2 其它**如实**边界（不是 bug，写下来免得被当成"修好了"）

| # | 边界 | 读数/依据 |
|---|---|---|
| G2a | **顶层散落的 `.mpkg` 仍不成条**（列表只收"库根的直接子目录"下的容器） | `scan.looseFiles/looseMpkgFiles` + `looseFileNote` 如实计数；`/__health.degraded` 里有 `loose-container-item` 一条说明。真语料顶层没有散 `.mpkg` |
| G2b | **扫描只下探一层**：`库根/<目录>/<文件>.mpkg` 成条；`库根/<目录>/<子目录>/<文件>.mpkg` **不成条**，但**路由能吃**（`itemLocate`/`splitItemRel` 支持 ≤8 段，夹具 A2 与真语料无关） | 夹具 `角色B/sub/B_01.mpkg`：列表里是 `角色B` 目录条；`GET /pkg/角色B/sub/B_01.mpkg` ⇒ 200 |
| G2c | **容器里的 `index.html`（容器内网页档）标 `renderable=false`** | 网页档要磁盘上的入口 URL（`/web/dev/<id>/index.html`），容器内条目取不到 ⇒ 走解包路径；真语料 0 例 |
| G2d | **容器内 `project.json` 不进列表字段** | 列表的 `properties` 对文件型条目恒 `null`（避免 148 个属性表进 `/api/library`）；`/api/props?item=<嵌套>` 读的是**条目所在目录**的包旁 `project.json`（wallpaperE 没有 ⇒ `props: []`，如实） |
| G2e | `/ddlist/<文件型 id>` **回空表**（不编假名字）；`/ddvideo` 因此对容器型条目无效 | §3.2 读数；视频这条路由由渲染器页的 MPW-NOSCENE 分支接管（§3.3 ③ 真机验证） |
| G2f | `/type/<文件型 id>` 只答"**磁盘上**声明了什么"，不读容器内 `project.json` | 真语料 ⇒ `{"ok":true,"type":"unknown"}`（wallpaperE 无 project.json）。容器内类型由 `/api/library` 的 `type` + `/api/mpkg` 的 `kind` 给 |
| G2g | **上游产物页档**（`rendererSrc=upstream`）预览 `.mpkg` 项**仍不行**：产物页按 `<mediaBase>/<itemId>/<file>` 取包，那是 WE `scene.pkg` 布局的契约 | 本轮只保证**本仓渲染器档**（默认档）那条链 |
| G2h | 413 门槛的**默认值**（768MB）只在本轮用 `MPW_LIMIT_PKG_BYTES=1` 验证了"超限如实 413"这条**分支**；没验证"294MB/331MB 恰好不触发"以外的边界值 | 真语料 331.2MB < 768MB ⇒ 200（A3e） |
| G2i | 没测**并行/并发**下大包的内存与事件循环表现（流式已改，但没有 RSS/延迟曲线读数） | 只给了协议读数（200/206/长度/耗时） |
| G2j | `bench-mpkg-items` **不带浏览器段**（纯 Node，~16s）：真机预览那三段是**一次性探针**（§3.3），没有进常驻门禁 | 理由：① 点 `.mpkg` 项这条链当前被 G1 挡着，做成常驻断言会**长期红**；② 浏览器门禁在 CI 上会因无 GL 变 SKIP（`bench-dsh-libroot` 的 B 段就是这种条件项）。主线修完 G1 后建议把 ②的挂载断言（`容器: PKGM…` + `meanL>0`）加成 `bench-mpkg-items` 的 `--browser` 段 |
| G2k | 任务书里的"**155** 个 `.mpkg`"与磁盘现状（**148**）不一致（§1.1 注）；验收里"items ≈155+"取到 **151** | `find … \| wc -l` = 148 + 2 个松散 `.mp4` + 1 个空目录条 = 151 |

### G3 现场状态提醒（`:8899` 那个进程还是**改前**启动的）

`ps` 里有 `node server/we-scene-demo-server.mjs 8899`（pid 26945，**我动手前就在跑**）—— 它加载的是**旧代码**，
所以直接打它会看到改前读数（实测 `GET :8899/pkg/卡提希娅` ⇒ 404）：

```
$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8899/pkg/卡提希娅          → 404   （旧进程）
$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8899/pkg/sample-synthetic  → 200
```

**我刻意没有重启它**（不是我起的进程，重启可能打断别的工作线）。本轮所有端到端读数都走 **`:8902`**（新代码 ——
它 import 的就是 `server/we-scene-demo-server.mjs` 的**同一份实现**，本地直供，`:8902` 全程不需要上游）。
要让 `:8899` 吃到本轮改动，重启一次即可：`kill 26945 && node server/we-scene-demo-server.mjs 8899 &`。

---

## 7. 一句话给主线

`.mpkg` 现在是**一等库项**：列表里 148 个容器逐条可见（`itemId` = 嵌套路径）、`/pkg/<嵌套 id>` 200 等长且流式、
越界一处没放宽、`dd` 零回归、4 组变异全红。
**唯一还差的一跳**是 G1 —— `demo/bench-patch.js:1739` 那一行斜杠判据（不在本轮可改文件清单），改完"点 `.mpkg` 项即出画"闭环。

# BENCH-LIBRARY-SOURCES —— `:8902` 测试台的「库来源 / 目录选择器 / 全类型扫描」契约

> 适用范围：`server/we-scene-demo-server-8902.mjs`（一站式测试台服务，git HEAD `3bf9976` 起的分支）。
> 回归门禁：`tests/bench-server-test.mjs`（门禁名 **`bench-8902`**，`tests/run-all-tests.sh:323`）。
> 撰写：2026-09-19（壁纸库 / 选择文件夹 / 类型扫描轮）。
> 相关：插件侧同款选择器的交互契约见 `dsh-mpkg-wallpaper/docs/DIR-PICKER-SCROLL.md` §5（行为对齐，两边互不 import）。

本文只写**契约 + 判据 + 诚实清单**。所有路径一律用占位符（`<MPW_ROOT>`、`<DSHAREA>`、`<reports>`…），
**不写任何本机绝对路径**（`tests/publish-check.mjs` / `tests/secret-scan-test.mjs` 会红）。

---

## 0. 一屏结论

| 症状 | 根因（`文件:行`） | 修法 | 判据 |
|---|---|---|---|
| 「选文件夹」直接弹 Android 系统选择器，选不到环境内目录 | `:8902` **没有**服务端目录浏览路由（只有 `POST /api/library-dir`，且绝对路径被限制在**配置库根之内**） | 新增服务端**只读**目录浏览：`/api/fs/roots` · `/api/fs/list` · `/api/fs/pick`（前端钉死的形状）+ `/api/dir-list` · `/api/dir-parent` · `/api/dir-pick` · 插件同形 `/list-dirs` | `J1`–`J18`；变异 C |
| 没选目录却默认在 `<MPW_ROOT>/allwallpaper/dd` | 硬编码**仓库约定**回退：`LIBRARY_SOURCE_INFO`（`server/we-scene-demo-server-8902.mjs:105-111`，`raw: path.join(MPW_ROOT,'allwallpaper','dd')`），而 `MPW_ROOT` 默认 = 本仓库上一级（同文件 `:99`）。运行中的 `:8902` 进程环境里**没有** `MPW_ROOT`/`MPW_LIBRARY_DIR`（`/proc/<pid>/environ` 实证） | 不取消回退，但**显式化**：`source: env\|cli\|user\|default\|none` + `selected` + 实际路径 + 人读 `reason` | `K1`–`K6`；变异 D |
| 只能扫出 scene 壁纸 | 类型判定**只认 project.json 声明 + scene 容器**：`kind` 原本是 `hasScene ? 'scene' : …`，网页入口只在 `project.type==='web'` 时才算；`.mpkg`/无 `project.json` 的目录一律进不了任何一栏 | 内容优先的**全类型**判定（scene/web/video/mpkg/unknown）+ 逐类计数 + 跳过原因 + mpkg 容器目录表分类 | `L1`–`L22`；变异 E |

---

## 1. 库来源：**显式**状态（不假装已选）

### 1.1 来源优先级（启动期）

| `source` | 触发条件 | 说明 |
|---|---|---|
| `env` | 环境变量 `MPW_LIBRARY_DIR` 非空 | 优先级最高（与既有服务同风格 `process.env.X \|\| argv`） |
| `cli` | 命令行 `--library=DIR` | 参数位（`--library DIR` 不支持，只认 `=` 形式） |
| `default` | 两者都没给 | **仓库约定** `<MPW_ROOT>/allwallpaper/dd`；`MPW_ROOT` 默认 = 本仓库的上一级 |
| `user` | 运行期 `POST /api/library-dir {dir}`（或 `?path=`）或 `POST /api/fs/pick` | **只有这条**才算"用户选过"；`{pick:true}` 也会写它 |
| `none` | 没有 `env`/`cli`/`user`，且默认路径**不存在** | 连"回退到仓库约定目录"都不成立 |

> `MPW_ROOT` 覆盖：`MPW_ROOT=/path/to/workspace`；库根覆盖：`MPW_LIBRARY_DIR=/path/lib` 或 `--library=DIR`。

### 1.2 状态字段（同一份对象出现在三处）

`GET /api/library-source`（顶层 + `library` 子对象）、`GET /api/library`（顶层 4 个字段 + `librarySource`）、
`GET /__health`（`library` / `librarySource` / `librarySelected` / `libraryExplicit`）：

```jsonc
{
  "source": "default",          // env | cli | user | default | none
  "selected": false,            // 用户**显式**选过没有（env/cli 只是"有配置"，不算"用户选的"）
  "explicit": false,            // source ∈ {env, cli, user}
  "dir": "<绝对路径>",           // 当前生效的库根
  "configuredDir": "<绝对路径>",  // 配置来源解析出来的库根（未收窄/改选前的）
  "configuredSource": "default",
  "configuredFrom": "仓库约定 <MPW_ROOT>/allwallpaper/dd",
  "configuredExists": true,
  "defaultDir": "<MPW_ROOT>/allwallpaper/dd",
  "narrowed": false,            // dir !== configuredDir
  "withinConfiguredRoot": true,
  "withinBrowseRoot": true,
  "exists": true,
  "readable": true,
  "env": { "MPW_ROOT": null, "MPW_LIBRARY_DIR": null, "MPW_PICK_ROOT": null },
  "roots": { "mpwRoot": "…", "mpwRootFrom": "…", "browseRoot": "…", "browseRootFrom": "…" },
  "reason": "**没有人选过**：回退到仓库约定 …（来源 仓库约定 <MPW_ROOT>/allwallpaper/dd）；要换库根请在页面里用选择器选，或设 MPW_LIBRARY_DIR / --library=DIR"
}
```

**口径**：`dir` 只回答"现在用哪个目录"，`source/selected` 回答"这是谁定的"。页面应在 `selected===false`
时显示"未选择（当前回退到 <来源>）"，**不得**把它画成用户已选。

### 1.3 提交库根（两种等价写法）

```
POST /api/library-dir          body {"dir":"<绝对路径>"}      # 绝对路径 = 浏览根内任意目录（新能力）
POST /api/library-dir?path=<绝对路径>                          # query 形式（前端契约指定）
POST /api/library-dir          body {"dir":"<库根内相对路径>"}  # 老语义：在配置库根内收窄
POST /api/library-dir          body {"reset":true}             # 还原到配置来源（selected 回到 false）
POST /api/fs/pick              body {"path":"<绝对路径>"}       # 选择器"就选这个目录"的提交形态
```

响应一律带 `source:"user"` / `selected:true` / `library:{…}`；`reset` 后回到 `configuredSource`。

---

## 2. 目录选择器：路由表 + 防逃逸

### 2.1 浏览边界（信任边界）

* `MPW_PICK_ROOT`（默认 = `MPW_ROOT`）—— **只读**浏览的边界；与库根**分开**：库根常常只是边界内的一个子目录。
* 默认边界**不含整个 home**（home 里通常有 `~/.ssh`、`~/.dsh` 等）。
  `GET /api/fs/roots` 仍会把 home 列出来，但标 `listable:false` + `reason` + `enableHint`（放宽办法：`MPW_PICK_ROOT=<home>`）。
* 选择器**必须**能进 `<MPW_ROOT>/allwallpaper/**` 这类"库根之外、浏览根之内"的目录（这正是原来的缺口）。

### 2.2 路由表

| 方法 | 路径 | 入参 | 返回（要点） | 错误码 |
|---|---|---|---|---|
| GET | `/api/fs/roots` | — | `{ok, roots:[{label,labels[],path(绝对),kind,exists,listable,reason,enableHint}], browseRoot, home, library:{dir,source,selected}}`（同路径只出一条，标签合并进 `labels[]`：库根恰好就是 allwallpaper 时 `label="当前库目录"`、`labels=["当前库目录","壁纸总目录 allwallpaper"]`） | — |
| GET | `/api/fs/list` | `path`（**必须绝对**；省略 = 浏览根） | `{ok, path, parent, entries:[{name,type:'dir'\|'file',size,kind,path,entryKind,signal}] , count, atRoot, roots, counts, kindLegend}` | 400 相对路径/非法 · 403 越界 · 404 不存在 |
| POST | `/api/fs/pick` | `{path, scan?}` | `{ok, picked, path, source:"user", library, scan}`（**只读校验 + 设为库根**，不写用户目录） | 400/403/404 · 405 |
| GET | `/api/dir-list` | `path`（绝对或相对浏览根）、`files=0` | 同 `fs/list` 的超集：`dirs[]`（含 `looksLikeWallpaper`/`entryKind`/`signal`）、`files[]`、`parent`、`atRoot`、`roots[]`、`pickHint` | 400/403/404 |
| GET | `/api/dir-parent` | `path` | `dir-list` 形状 + `from`（从哪上来）、`moved:'up'\|'stayed'`、`stayedAtRoot` | 400/403/404 |
| POST | `/api/dir-pick` | `{path, asLibrary?, scan?}` | `{ok, picked, dir, scan:{dirs,count,kinds,sample,escaped,unclassified,looseFiles,looseExt,looseContainers,looseContainerKinds}}`；`asLibrary:true` 才改库根（默认 false） | 400/403/404 · 405 |
| GET | `/list-dirs` | `path` | **插件同形**：`{ok, dir, subdirs:[名字], home, platform}`（另附 `parent/atRoot/browseRoot/dirs/counts`） | 400/403/404 |
| GET | `/api/library-dir` | `dir`（可选） | 库根内子目录枚举（老语义）+ `picker:'server'`、`browseRoot`、`routes`、`source` | 400/403/404 |
| GET | `/api/library-source` | — | 库来源状态 + `picker.routes`（能力自述，供前端发现） | — |

`kind` 枚举（前端契约）：目录 `'wallpaper'`（目录本身像壁纸）/`'other'`；文件 `'scene'`（`.pkg`/`.mpkg` 容器族）/
`'video'`（mp4/webm/mov/mkv/avi/m4v）/`'web'`（html/htm/xhtml）/`'other'`。
更细的一层在 `entryKind`（`scene|video|web|mpkg|other`）与 `signal`（命中的入口文件名）。

`dir-pick` 摘要里的三个"如实计数"字段：`escaped`（逃逸符号链接：**不算**条目）、
`unclassified`（预算用尽没数到的目录）、`looseFiles`（顶层散文件，其中 `looseContainers[]` 给出容器内类型）。
`count` = 每个子目录都判过类之后的真计数（**不是**样例条数）；`sample` 最多 8 条，只作预览。

### 2.3 防逃逸判据（唯一入口 `resolveBrowsePath()`）

| 攻击形态 | 判据 | 码 |
|---|---|---|
| 相对路径含 `..`（`%2e%2e` 解码后同样命中） | `dec.split(/[\\/]+/).includes('..')` | **400** |
| 绝对路径越界（`/etc`、`%2Fetc`、`<根>/../..`） | 词法规范化后必须落在 `PICK_ROOT_REAL` 内 | **403** |
| 符号链接逃逸（链接指向边界外） | `realpathDeepest()` 真身复检；逃逸项在列表里**不出现** | **403** |
| NUL / 控制符 | 显式拒绝 | **400** |
| 目录不存在 / 不是目录 | `statSync` 后判定 | **404** |
| `..` 出现在 **URL 路径段**（不是 query） | 路由前的 `decodedPath` 检查（`new URL()` 会规范化，必须先看原始 `req.url`） | **400** |

写操作面：浏览路由**只** `readdir`/`stat`/`read`（容器目录表 ≤ 64KB，必要时 ×4 倍增到 1MB）。
本服务落盘的只有 `<reports>/bench-props/**`（属性覆盖）、`<reports>/bench-thumbs/**`（缩略图缓存）、
`<MPW_ROOT>/Delete/bench-trash/**`（删除，默认 dryRun，`?confirm=1` 才移入，可 `mv` 回滚）。

### 2.4 与插件同名路由的对照（避免"以为少了什么"）

| 插件（`dsh-mpkg-wallpaper`） | 本仓 `:8902` 等价物 | 备注 |
|---|---|---|
| `GET /list-dirs?path=` | `GET /list-dirs?path=`（同形）+ `GET /api/dir-list` | 逐字段同形，可直接复用插件侧客户端代码 |
| `POST /custom-dir {dir}`（扫一个自定义目录） | `POST /api/library-dir {dir}` + `GET /api/library`（或 `POST /api/dir-pick` 先看扫描摘要） | 本服务里"自定义目录"就是库根，不另设状态 |
| `GET /raw?ltoken=&file=`（库内原样取字节） | `GET /media/dev/<itemId>/<相对路径>`、`GET /web/dev/<itemId>/<相对路径>` | 同样支持 Range（206/416）；itemId 单段校验 |
| `GET /library-media?ltoken=&file=`（单个媒体） | 同上（`/media/dev/**`） | 无 token 机制（本服务无沙箱 iframe 的不透明源场景） |
| `GET /custom-mpkg` / `pkg-extract`（容器解包） | **没有**（只读容器目录表：`GET /api/mpkg`） | 见 §5 诚实清单 |

---

## 3. 全类型扫描（scene / video / web / mpkg）

### 3.1 判定顺序（**内容优先**，声明只作线索；与插件 `detectWebWallpaperKind` 同序）

| 序 | 信号 | 命中 ⇒ `kind` | `kindSource` | `kindReason` |
|---|---|---|---|---|
| 1 | `scene.pkg` / `scenes/scene.pkg` / `gifscene.pkg`（也认 `project.file` 声明且**实际存在**） | `scene` | content | `scene-container` |
| 2 | 声明 `video`/`gif` **且**有视频文件 | `video` | declared | `declared-video` |
| 3 | 网页入口（`index.html`/`index.htm`/`index.xhtml`/`web/index.html`/`html/index.html`/`dist/index.html`） | `web` | content | `html-entry` |
| 4 | 视频文件（`.mp4/.webm/.mov/.mkv/.avi/.m4v`；先认声明，否则挑**最大**的） | `video` | content | `video-file` |
| 5 | `.mpkg` 合集容器（只读容器目录表判内层类型） | `mpkg` | content | `mpkg-container`（表读不出来 = `mpkg-container-unparsed`） |
| 6 | 只有声明（`scene`/`web`/`video`），入口文件缺失 | 同声明 | declared | `declared-*-no-*` |
| 7 | 什么都没有 | `unknown` | none | `no-entry-signal` |

* 容器内层类型（`containerKind`）与**条目级** `kind` **分开计数**：`scan.kinds` = 条目类型，
  `scan.containerKinds` = 容器里到底是什么（`scene.pkg` > 网页入口 > 视频 > 嵌套容器 > unknown）。
* `scene.pkg` / `gifscene.pkg` 是**PKGV 单场景包**，`scene.pkg` **不算**"合集容器"（只 `*.mpkg` 才算）；
  两者都能被 `GET /api/mpkg` 读表（PKG 家族），但只有 `.mpkg` 会进 `mpkgFiles`。
* 预览图：`project.preview`（**允许子目录相对路径**，实际存在才算，`previewSource:"declared"`）→
  `preview.gif|jpg|jpeg|png|webp|bmp|avif`（`previewSource:"fallback"`）→ 无。
* 大目录安全：`project.json` > 512KB **不读**；单次扫描的探测操作上限 `LIMITS.scanOps=20000`
  （超了在 `scan.budgetExceeded` 如实上报）；每层 `listItems=5000` / `dirEntries=2000` / `browserFiles=1000`。

### 3.2 逐类计数与"为什么这档扫不出来"

`GET /api/library` 的 `scan` 对象就是**证据面**（`jq`/`node -e` 都直接可读）：

```jsonc
"scan": {
  "root": "…", "exists": true, "dirs": 30, "items": 22, "hiddenDirs": 0,
  "looseFiles": 5, "loosePkgFiles": [], "looseMpkgFiles": ["…mpkg"],
  "looseFileNote": "5 个顶层文件不在列表里（列表只收**目录型**壁纸条目；其中 5 个是 .mpkg/.pkg 容器：…）",
  "kinds": {"scene": 11, "video": 4, "web": 7, "mpkg": 0, "unknown": 0},
  "containerKinds": {"scene": 6, "video": 6, "web": 0, "mpkg": 0, "unknown": 0},
  // signals = **信号出现次数**（一个 web 档里带 mp4 也会算 withVideo），与 kinds 的"条目类型计数"不是一回事
  "signals": {"withScene": 11, "withHtml": 7, "withVideo": 5, "withMpkg": 12, "withPreview": 22, "withProject": 22, "noPreview": 0, "renderable": 22, "mismatch": 0},
  "skipped": 1, "skippedList": [{"name": "…", "reason": "条目经符号链接越出库根：…"}],
  "budgetExceeded": false, "opsUsed": 370, "opsLimit": 20000, "durationMs": 88,
  "limits": {"listItems": 5000, "scanOps": 20000, "projectJsonBytes": 524288, "pkgTableBytes": 65536}
}
```

条目级的"扫不出来"解释（新字段，前端可以直接显示）：

| 字段 | 含义 |
|---|---|
| `kind` / `kindSource` / `kindReason` | 判成了什么、凭什么（内容/声明）、具体哪条规则 |
| `entryFile` / `entryExists` | 真正会被加载的入口文件（`scene.pkg`/`index.html`/`*.mp4`/`.mpkg`） |
| `renderable` / `renderReason` | 网页渲染器**能不能直接吃**；不能就给出原因（mpkg 容器 / 入口缺失 / 无信号） |
| `signals` | `{scene, html, video, videoCount, mpkg[], preview, previewSource, project, audio, subdirs}` |
| `container` / `containerKind` / `containerEntry` / `containerPreview` / `mpkgFiles[]` | 容器档的细节（含每个容器的目录表是否读得出来） |
| `probe` | `unknown` 档的"下一层像不像壁纸"提示：`{subdirs, subdirsWithSignals, sample}` |
| `mismatch` / `declaredType` | 声明与内容不一致（例如声明 `web` 但目录里只有 `scene.pkg`） |

### 3.3 缩略图与容器目录表

| 能力 | 路由 | 行为 |
|---|---|---|
| 缩略图 | `GET /api/thumb?item=<id>&w=<px>` | ① 库里现成 `preview.*`（`X-Bench-Thumb: preview-file\|declared-preview`）② 容器内**未压缩** `preview.*`（`container-preview`，≤2MB，**过图像魔数校验**）③ 视频档无预览 ⇒ 本机 `ffmpeg` 抽一帧缓存到 `<reports>/bench-thumbs/<id>-<w>.jpg` ④ 都没有 ⇒ **501** + `reason`/`hint` |
| 容器内层类型 | `GET /api/mpkg?item=<id>&file=<名>` | 只读 PKGV/PKGM **目录表**（magic/条目名/内层类型/容器内 `project.json` 能当 JSON 解析时给 title/type）；**不解包** |

`item` 一律单段：ASCII 走老口径 `[A-Za-z0-9][A-Za-z0-9._-]*`；**非 ASCII 名**（中文/日文收藏夹，实测语料里
「流萤」「纳西妲」这类）走国际口径（无分隔符/无控制符/≤120 字符）。URL 里需 `encodeURIComponent`。

---

## 4. 判据（`tests/bench-server-test.mjs`，只增不减）

```
node tests/bench-server-test.mjs            # 主套件 + 5 组变异 RED
node tests/bench-server-test.mjs --json     # 末尾附 BENCH-SERVER-TEST-JSON
```

| 组 | 覆盖 |
|---|---|
| A–I（既有 63 条，**未放宽**） | 静态面 / 8 个老 `/api/*` 契约 / 路径逃逸 / 删除 dryRun / 属性不写壁纸包 / 诊断流 / 服务不崩 |
| **J1–J18** | 目录选择器：列目录·上一级·"就选这个目录"·插件同形壳·`/api/fs/*` 三件套；四类越界（`..`/绝对/编码/符号链接）逐个 400/403/404；`fs/pick` 与 `dir-pick` 的提交/探针语义 |
| **K1–K6** | 库来源：`env`/`cli`/`default`/`none`/`user` 五态 + `selected` 语义 + `/__health.library.reason` |
| **L1–L22** | 全类型：逐类计数、容器内层计数、无 `project.json` 的 web/video、mpkg 容器读表、非 ASCII itemId、散落 `.mpkg` 如实计数、`probe` 提示、容器内缩略图、ffmpeg 抽帧、web 入口/子资源/Range、删除 `unknown` 目录需 `ack` |
| 变异 A–E | ①`isInside()` 恒真 + itemId 放开 ②dryRun 真删 ③**浏览边界恒真** ④**来源恒为 user/selected** ⑤**类型判定退回只认 scene** —— 每组都必须在 `/tmp` 副本里变红（`变异 N 必红` + `红的正是被变异掉的判据`） |

真树指纹：`真树 sha256 跑前跑后逐字相同`（server 文件 + 本测试文件 + `demo/**`）。
> ⚠ 该条会在**另一条线正在改 `demo/**`**时变红（它把 `demo/` 也纳入了指纹）。这不是本轮的回归：
> 跑之前/之后 `demo/` 的 mtime 会变。判断方法：`ls -la --time-style=full-iso demo/bench-patch.js demo/index.html`。

---

## 5. 诚实清单（做不到 / 需要别人配合 / 有代价）

1. **系统选择器（Android/桌面对话框）本服务替代不了**：`:8902` 是 Node HTTP 服务，不经手
   `showDirectoryPicker`/`webkitdirectory`。`POST /api/library-dir {pick:true}` 的 200 +
   `{cancelled,unsupported,degraded,degradedStatus:501}` **保持不变**（既有判据 C1），但响应里新增
   `picker:"server"` + `serverPicker{…}` + `systemPickerFallback` 说明：**页面应改用服务端选择器，
   系统对话框只作兜底**（无后端/静态托管时）。
2. **默认浏览边界不含整个 home**：`GET /api/fs/roots` 会列出 home 但 `listable:false`
   （放宽：`MPW_PICK_ROOT=<home 或更外层>`）。这是**故意的**隐私取舍，不是 bug。
3. **mpkg 容器不解包**：本服务只读容器**目录表**（判类型）与**未压缩的 `preview.*`**（出缩略图）。
   容器内的 `scene.pkg`/网页入口/压缩条目要真正加载，仍需插件侧 `pkg-extract.js`
   （或本仓 `server/pack-dir.mjs` 的反向打包能力）。因此 mpkg 条目的 `renderable:false` +
   `renderReason` 是**如实**的，不是"扫不出来"。
4. **顶层散落的 `.mpkg` 文件不进条目列表**（列表 = 目录型壁纸条目）：`scan.looseFiles` /
   `looseMpkgFiles` / `looseFileNote` 如实计数；容器内类型可经 `POST /api/dir-pick` 的
   `scan.looseContainers` 或 `GET /api/mpkg` 查。要"每个 mpkg 一条"，需要条目模型支持
   "文件型条目"（三处路由 + 前端渲染一起改），本轮**没做**。
5. **缩略图抽帧需要本机 ffmpeg**：没有 ffmpeg 时，视频档无 `preview.*` ⇒ `/api/thumb` 如实 **501**
   （不假装有图）。容器内 `preview.*` 若是 LZ4 压缩条目也取不到（会说明原因）。
6. **需要前端配合的字段**（服务端已给，前端未接之前功能不完整）：
   * 列表/分栏请改用 `kind`（`scene|video|web|mpkg|unknown`）而不是只看 `hasScene`：老产物 `rt()` 是
     `hasScene ? 'scene' : …` ⇒ **`.mpkg`/`unknown` 档在旧分栏里永远不显示**（`type:'mpkg'` 也不在
     `web|video` 分支里）。计数请直接读 `scan.kinds`（服务端已算好）。
   * 库来源请显示 `source`/`selected`（未选择时别画成"已选"）。
   * 缩略图优先用 `item.previewUrl`（有现成图）或 `item.thumbUrl`（可能 501，带 `thumbReason`）。
   * 目录浏览器请用 `/api/fs/roots` → `/api/fs/list?path=`（绝对路径）→ `/api/fs/pick`；
     行里可显示 `kind==='wallpaper'` 与 `entryKind`/`signal`（服务端已探好，前端不用再猜）。
7. **`/raw`、`/custom-dir` 这两个名字在本仓不存在**（它们是插件侧路由）。等价物见 §2.4；
   若前端要"逐字同名"，可以在 `:8902` 加别名，但本轮**故意不加**（避免两套形状同时存在）。
8. **既有 `/api/*` 判据一条没放宽**：A–I 组 63 条全绿；`{pick:true}` 的降级语义、`/api/props`、
   `/api/delete` dryRun、`/api/reveal` 501 全部原样。新增的 `409 needsAck` 只对
   "`confirm=1` + 条目**没有任何壁纸信号** + 未带 `ack:true`"生效（dryRun 分支不变）。

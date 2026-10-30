// we-scene-demo-server-8902.mjs —— **一站式测试台服务**（任务书 P2-2 骨架 + 让测试台在「带后端」模式下真正可用）
//
// 为什么要有第三个端口（用户原话：「我现在打开的离线页面是这样的，怎么去进入一个在线的页面」）：
//   `:8901` 是**纯静态**托管（服务 `demo/` 的产物）⇒ `/api/*` 与 `/diag` 全 404：壁纸库列表、属性保存、
//   删除、打开所在文件夹、渲染器诊断流**全部不可用**（页面自己会在左侧栏写明「静态托管（无 /api 后端）」）。
//   `:8899` 是**渲染器**页（`/`、`/bundle.js`、`/elysia/**`、`/shaders/**`、`/diag`、`/baseline`…），它**没有**测试台要的
//   `/api/*`，也**没有**测试台 iframe 写死的渲染器页路径。两个服务合起来也不构成"带后端的一站式测试台"。
//   本文件就是那第三个端口：**一个 origin 同时提供**「测试台静态面 + 测试台要的 /api/* + 渲染器 iframe 页 +
//   壁纸媒体面 + 诊断流」，且**不碰** :8899/:8901 的任何行为（新增文件，二者照旧可用）。
//
// 用法:
//   node server/we-scene-demo-server-8902.mjs [port] [--library=DIR] [--no-store|--store] [--static-root=DIR]
//   环境变量**优先**（与既有服务同风格：`process.env.X || argv`）：
//     PORT=8902                    端口
//     MPW_ROOT=/path/to/workspace  工作区根（默认 = 本仓库的上一级；决定库根/回收站/reports 的落点）
//     MPW_LIBRARY_DIR=/path/lib    壁纸库根（默认 <MPW_ROOT>/allwallpaper/dd）—— **只读**
//     MPW_REPORTS_DIR=/path/reports 上报根（默认 <MPW_ROOT>/reports）⇒ 属性覆盖落在 <reports>/bench-props/
//     MPW_BENCH_STATIC_DIR=/path/demo 测试台静态面根（默认 <repo>/demo；测试的变异副本靠它指回真树）
//     MPW_BENCH_STORE=1            静态面**不要** no-store（默认 no-store，与 :8901 同口径）
//     MPW_OPEN_CMD=/bin/true       `/api/reveal` 用的"打开器"（默认按 termux-open → xdg-open → open → explorer 查找：四个平台各一条）
//     MPW_LIMIT_*                  与 :8899 同名的上限变量在这里**不复用**（本服务只写属性覆盖文件，见 PROPS 上限）
//
// 一个 origin 提供的东西（逐条都对着产物里的**调用方**，不是猜的；证据见 docs/BENCH-8902.md）：
//   ① 静态测试台：`/` → `demo/index.html`；`demo/` 同时挂在 `/`（因产物 HTML 是 `<base href="./">` + `./assets/…`）、
//      `/demo/`、`/WEwebLoader/`、`/wallpaper-engine-webgl/` 四个挂载点下 —— 最后一个是**必需**的：
//      `demo/assets/bench-DSKWIqmS.js` 里 iframe 的 `k.src` 写死 `/wallpaper-engine-webgl/renderer/index.html?…`（3 处）。
//      静态面 no-store（`Cache-Control: no-store, must-revalidate`，与 :8901 逐字同口径）。
//   ② 媒体面：`/media/dev/<itemId>/<file>`（scene.pkg / preview.gif / 视频…，renderer bundle 的 `l1()` 依次试
//      `scene.pkg`、`scenes/scene.pkg`、`gifscene.pkg`，并取 `<mediaBase>/<src>/project.json`）与
//      `/web/dev/<itemId>/<file>`（web 类壁纸 iframe 的 src）—— 都是**库根内只读**，支持 Range（视频/拖动进度必需）。
//   ③ 8 个 `/api/*`（形状以调用方为准，逐条证据见 docs/BENCH-8902.md §2）：
//      GET  /api/library     列表：{dir, items:[{itemId,title,type,hasScene,file,preview,properties,dir,kind}]}
//      POST /api/library-dir 选择/收窄库根：{pick:true}⇒降级（见下）；{dir}⇒库根内的子目录；GET ⇒ 枚举子目录
//      GET  /api/web-probe  Web 壁纸**挂载前预检**：?item=<id> ⇒ {type, probe:{isWeb,heavy,external,heavyHits,externalRefs,htmlFile,reasons}}（判定核心 core/web-precheck.mjs；非 web 项 probe:null）
//      GET  /api/props       属性表：?item=<id> ⇒ {props:[描述子…]}（描述子字段=调用方读的那些）
//      POST /api/props       保存覆盖：?item=<id>，body={属性名:值} ⇒ 落 <reports>/bench-props/<id>.json（**不写进壁纸包**）
//      POST /api/props-dir   目录型属性：{pick:true}⇒降级；GET 枚举 / POST {dir} 取库根内的绝对目录
//      POST /api/props-file  文件型属性导入：?item=&name= + `X-Filename` 头 + 原始 body ⇒ 落 reports 并回可回读的 value
//      POST /api/delete      删除：**默认 dryRun**（只回计划，绝不移动）；`?confirm=1` 才移到 <MPW_ROOT>/Delete/bench-trash/<ts>/
//      POST /api/reveal      打开所在文件夹：先做库根内校验；找不到打开器 ⇒ **501 + 说明**（绝不成 500）
//      GET  /api/diag-stream SSE：`data: {"msg":…}\n\n`（调用方 `JSON.parse(e.data)` 后取 `.msg`）
//   ④ 诊断来源（**本服务自己维护环形缓冲**这条路，没代理 :8899）：renderer bundle 的 `ce()` 用
//      `new Image().src = `${origin}/diag?msg=…``（origin 取自 `mediaBase`）上报 ⇒ 本服务接 `GET /diag?msg=`（回 1×1 gif，
//      图片不报错）与 `POST /diag`（JSON），进环形缓冲（上限 200 条）并广播给所有 `/api/diag-stream` 订阅者。
//   ⑩（2026-09-19）**上报落盘**两条根路径（测试台调试页签的「立即上报」按钮按 /report → /baseline → /diag 依次试）：
//      POST /report   ⇒ `<reports>/r<ts>.json`（body ≤4MB；只受 `r*/selfcheck*` 的 60 份 / 64MB 滚动）
//      POST /baseline ⇒ `<reports>/baselines/<ts>.json`（body ≤1MB；**复用 core/baseline-metrics.mjs 校验**，
//                       不完整 ⇒ 400 且不落盘；独立目录独立上限 200 份 / 32MB）
//      POST /diag     ⇒ 环形缓冲（内存，最后兜底）。落点与 :8899 **逐字相同** ⇒ 消费端（report-audit /
//                       baseline-diff）不必区分"从哪个端口上报的"。
//   ⑤ `GET /__health` 自述：端口/库根/能力清单/**哪些端点降级为 501 及原因**/诊断缓冲条数。
//
// 安全红线（本文件里只有一条路径判据 `safeJoin()`，全部读写/删除/打开都必须过它）：
//   · 一律**规范化后前缀校验**（`path.relative` 判根内）→ 越界 403；相对路径里出现 `..` 直接 400；
//   · 再对**真身**做一次校验（`realpathSync` 逐级回溯）⇒ 符号链接逃逸也 403；
//   · `itemId` 只允许**单个路径段**（`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`）⇒ `../`、绝对路径、`a/b` 连第一关都过不去；
//   · **没有**任何"任意路径读/写"端点：库根内的读只有 `/api/library`、`/api/props`(读 project.json)、
//     `/media/dev/**`、`/web/dev/**`；写只有 <reports>/bench-props/**（属性覆盖）与 <MPW_ROOT>/Delete/bench-trash/**（删除）。
//   · 删除**默认 dryRun**（响应里回 from/to 与"要移多少文件/字节"的计划）；真删=移到回收站（`?confirm=1`），响应回
//     回收站路径 ⇒ 一条 `mv` 即可回滚（文档里给了命令）。
//   ⑥ 目录选择器（服务端只读浏览，**不弹任何系统对话框**）—— 契约见 docs/BENCH-LIBRARY-SOURCES.md：
//      **前端钉死的契约形状（环境内目录浏览器）**：
//        GET  /api/fs/roots             ⇒ {ok, roots:[{label,path(绝对),exists,listable,…}]}
//        GET  /api/fs/list?path=<绝对>  ⇒ {ok, path, parent, entries:[{name,type:'dir'|'file',size,kind}]}
//        POST /api/fs/pick {path}       ⇒ 选为壁纸库根，回 {ok, path, source:"user", library, scan}
//        GET  /api/fs/file?path=<绝对>  ⇒ **只读**取文件字节（"选择文件"用它把服务端文件喂给预览链；
//                                          同一个 `assertBrowsePath()` ⇒ 同一份允许根/同一套 403；支持 Range）
//      同一套浏览能力的另几个入口（字段更细：上一级/计数/入口类型/插件同形兼容壳）：
//        GET  /api/dir-list?path=…   列目录（子目录 + 文件 + 上一级 + 计数 + 入口类型）
//        GET  /api/dir-parent?path=… 上一级（到根即 atRoot:true，不是错误）
//        POST /api/dir-pick {path}    "就选这个目录"：只读校验 + 该目录的壁纸扫描摘要（默认不改状态）
//        GET  /list-dirs?path=…       与插件 `dsh-mpkg-wallpaper` 的 `/list-dirs` **逐字段同形**的兼容壳
//      **允许根清单**（`BROWSE_ROOTS`，都从环境推导，绝不写死本机路径）：
//        `MPW_PICK_ROOT`（默认 = `MPW_ROOT`）→ 库根/库根的上一级（仅当它落在浏览根之外时才追加）
//        → `MPW_ALLOW_DIRS`（冒号分隔的额外允许目录）。`..`/绝对越界/符号链接逃逸 ⇒ 400/403。
//      `GET /api/fs/roots` 的快捷根**全部推导**（库根、库根的上一级、`os.homedir()`、`process.cwd()`、
//      工作区根、`/media`·`/mnt`·`/run/media` 或 Windows 盘符）；home 一并列出但标 `listable:false`。
//      要放宽就用 `MPW_PICK_ROOT=<更外层的目录>` 或 `MPW_ALLOW_DIRS=<目录1:目录2>`。
//      所有浏览只做 readdir/stat（不写用户目录、不删除、不解包）。
//   ⑦ 库来源状态（**显式**，不假装已选）：`source: "env"|"cli"|"user"|"default"|"none"` + 实际路径，
//      见 `GET /api/library-source`、`GET /api/library`（顶层 `source`/`selected`/`explicit`/`library`）
//      与 `/__health.library`。默认值来自仓库约定 `<MPW_ROOT>/allwallpaper/dd`（**不是**用户选择）。
//      提交库根：`POST /api/library-dir {dir}`（也收 `?path=`）或 `POST /api/fs/pick {path}`。
//   ⑧ 全类型扫描：`scene.pkg`/`scenes/scene.pkg`/`gifscene.pkg`、`index.html` 等网页入口、
//      `.mp4/.webm/.mov` 视频、`.mpkg` 容器（只读容器目录表判类型）、`preview.*` 缩略图；
//      逐类计数在 `GET /api/library` 的 `scan.kinds` / `scan.containerKinds`，跳过的条目带**理由**。
//   ⑨ `GET /api/mpkg?item=&file=`（只读容器目录表）与 `GET /api/thumb?item=&w=`（缩略图：
//      优先库里现成的 `preview.*`；其次容器内**未压缩**的 `preview.*`；视频档用本机 ffmpeg 抽一帧
//      缓存到 `<reports>/bench-thumbs/`；都没有就**如实 501**）。
import http from 'node:http'
const httpRequest = http.request
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
// 基线快照的**校验判据**与 :8899 复用同一个纯模块（`:8902` 也接 `POST /baseline` ⇒ 必须同一把尺子，
//   否则"测试台收下的快照"与"渲染器侧产出的快照"会各有各的 schema，趋势数据没法比）。
import { mpwValidateSnapshot, BASELINE_SCHEMA } from '../core/baseline-metrics.mjs'
// ①(用户第 34 条 安全策略) 导入文件的**统一白名单/内容嗅探**（同一份纯模块给测试台与插件用，避免两处漂移）
import { checkUpload } from './upload-policy.mjs'
/* ⑥(2026-09-23) web 壁纸宿主：服务端注入 shim（`/web/**` 的 HTML）+ 不透明源存储落盘。
   纯逻辑在 core/we-web-shim.mjs 与 server/web-store.mjs 里，本文件只做接线与 HTTP 头。 */
import { buildWebShimSource, injectWebShim } from '../core/we-web-shim.mjs'
import { WEB_STORE_LIMITS, normalizeWallId, wallIdFor, storePath, mergeStore, evictPlan, opaqueCorsHeaders } from './web-store.mjs'
/* ①(P-177 同口径 2026-09-24) 官方随包 JSON 的**宽容解析**：**同一份实现直接复用**，不复制第二/第三份 ——
   `core/we-scene-bundle.js` 的 `parseWeJson`/`weJsonStats` 就是页面与 bundle 在用的那一份（P-177）。
   为什么本服务需要：库里那份 `project.json`（= **包旁**文件，与 scene.pkg 同级）与容器条目里的
   `project.json`（= **包内**）都可能带尾逗号/注释（官方 `assets/effects/fluidsimulation/effect.json`
   第 402 行自己就带尾逗号，WE 用 jsoncpp 照用）⇒ 严格 `JSON.parse` 会把整份**属性表**静默丢成 null
   （面板空白、`{user:…}` 全回落默认值），而日志一行都没有。
   ⚠ 宿主自有状态**绝不放宽**（HTTP 请求体 / bench-props 覆盖 / web-store 帧存储 / web-replace 策略）：
   那些地方"读失败 ≠ 没存过"，宽容会把**损坏**糊成"能读"（本仓既有纪律，见各站点上的 `[we-json:strict]`）。
   代价与副作用：本模块无顶层 DOM/IO（Node 里 import 实测 ~90ms、不写盘不联网），且 `:8899` 的
   `/transpiled/*` 早就在动态 import 同一个文件 ⇒ 不是新增一类依赖，只是提前到加载期。 */
import { parseWeJson, weJsonStats } from '../core/we-scene-bundle.js'
import { webPrecheckPlan, WEB_PRECHECK_LIMITS } from '../core/web-precheck.mjs'
/* ①(P-350 2026-10-16) 渲染器适配器契约（`core/renderer-adapter.mjs`，零依赖纯模块）：
   本服务只做**枚举**（`GET /api/renderers`）——"这一档现在能不能用"的机读答案。
   模块本体由渲染器根路由 `/core/**` 直供（`demo/renderer/adapter-boot.mjs` 以 `../../core/…` 取），
   本文件**不复制**任何适配器逻辑。 */
import { rendererAdapterReport } from '../core/renderer-adapter.mjs'
/* ⓐ(2026-09-24 · 用户第 5 条「直接把 8899 集成到 8902，我以后拿 8902 测试」)
   **同一份实现复用**，不是复制一份：`:8899` 的服务器把请求处理器导出成 `rendererRequestHandler`，
   本服务把它挂到自己的 origin 上（`/webloader/**` 与渲染器自己的根路由）。
   两个配套契约也在那边：`setLibraryRootProvider()`（库根**唯一真源**：本服务把 activeRoot 注入进去
   ⇒ `/pkg/<id>`、`/project/<id>`、`/ddlist/<id>`… 全部随"当前生效的库根"走，不用刷新、不用重启）
   与 `shellShimScript()`（预览框的 `?shell=0` 无外壳形态）。
   ⚠ 这个 import 之所以安全：那边已把顶层 `pkg-extract` 动态 import 改成"失败即降级"，
   且 `listen` 只在它自己是进程入口时发生（见 server/we-scene-demo-server.mjs 的 ⓪/⓪② 段）。 */
import { rendererRequestHandler, setLibraryRootProvider, pkgParserUnavailable } from './we-scene-demo-server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ── CLI 参数（环境变量优先，与 :8899 同风格：`process.env.X || argv`）───────────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
const flagVal = (name) => {
  const f = flag(name)
  if (!f) return undefined
  const eq = f.indexOf('=')
  return eq === -1 ? true : f.slice(eq + 1)
}
const positional = argv.filter((a) => !a.startsWith('--'))
const PORT = Number(process.env.PORT || positional[0] || 8902)
/* ⓪③(2026-09-27 P-204 安全审计 F8) **绑定地址：默认只回环**（改前 `server.listen(PORT)` 无 host 参数
   ⇒ Node 默认全网卡，而启动日志只打印 `127.0.0.1` —— 用户以为只有本机能连，实际同网段都能连）。
   回退口：`MPW_BIND=0.0.0.0`（局域网测试台/真机联调显式放开）。 */
const BIND_HOST = String(process.env.MPW_BIND || '').trim() || '127.0.0.1'
const BIND_IS_LOOPBACK = /^(127\.|::1$|\[::1\]$|localhost$)/i.test(BIND_HOST)
/* ①(用户报「3669681034 在 :8902 打开全黑」的根因与修法) **渲染器页反向代理**：
   `:8902` 的预览 iframe 原来只指向上游**产物页**（`demo/renderer/index.html` → `assets/renderer-*.js`），
   而那份产物是"先解码整张图再缩放上传"——对 `3669681034` 那张 **7680×4320 / 43.8MB / 5 级 mip** 的贴图，
   它必须先解出 132MB 位图（本仓 core 的 P-163 修复是**先选级再解码**，所以 `:8899` 不黑、`:8902` 黑）。
   这里把本仓自己的渲染器页（`:8899` 的 `/`、`/bundle.js`、`/pkg/…`、`/media/…` 等一整套路由）**在本服务上
   挂一个同源入口** `/webloader/**` ⇒ 测试台可以用它做预览，既拿到 mip 选级修复、又不会踩跨源。
   上游地址用环境变量覆盖（默认本机 8899；**不写死本机路径**，跨平台一致）。 */
const RENDERER_UPSTREAM = (() => {
  /* ①②(2026-09-24 用户第 5 条：只开 8902 一个服务)
     上游现在是**可选**的（原来无论谁都得先跑 :8899，否则预览整页 502）：
       · `MPW_RENDERER_UPSTREAM`（新名，**显式设置才生效**）或 `MPW_RENDERER_8899`（旧名，兼容既有测试/脚本）；
       · **两个都不设 ⇒ 没有上游** ⇒ `/webloader/**` 与渲染器根路由**全部由本服务本地直供**（默认口径）；
       · 设了但**指到死端口**：先按上游试一次，连接层失败就**回退本地直供**（页面照常出画），
         只有"本地也没有这条路由"时才按老口径 502（既有 K2d 判据不变）。
     值可以是 `http://host:port[/path]`，也可以是裸的 `host:port`（用户手册里写的就是后者）。 */
  const raw = String(process.env.MPW_RENDERER_UPSTREAM || process.env.MPW_RENDERER_8899 || '').trim()
  if (!raw) return null
  const norm = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : ('http://' + raw)
  try {
    const u = new URL(norm)
    const host = String(u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
    /* ⓪③(P-204 F8) **上游必须是回环**（改前只判"能不能解析"）：配成任意外部地址时，本服务会把
       调用方的 `Cookie` / `Authorization`（旧实现**全量转发请求头**）送到那台机器上。
       显式外发联调（例如上游跑在另一台机器）走 `MPW_ALLOW_REMOTE_UPSTREAM=1`，
       此时仍会按下面的 `MPW_PROXY_FORWARD_AUTH` 口径剥掉凭据头（默认剥）。 */
    const loopback = /^(127\.|::1$|localhost$)/i.test(host)
    const allowRemote = String(process.env.MPW_ALLOW_REMOTE_UPSTREAM || '').trim() === '1'
    if (!loopback && !allowRemote) {
      return {
        raw, host: null, port: null, path: '', bad: true,
        badReason: '上游 ' + host + ' 不是回环地址：本服务会（默认）把调用方请求头转发过去，拒绝启用。'
          + '确要指向远程/局域网上游请显式设 MPW_ALLOW_REMOTE_UPSTREAM=1',
        from: process.env.MPW_RENDERER_UPSTREAM ? 'env MPW_RENDERER_UPSTREAM' : 'env MPW_RENDERER_8899（旧名）',
      }
    }
    return { raw, host, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)), secure: u.protocol === 'https:', path: u.pathname.replace(/\/$/, ''), bad: false, from: process.env.MPW_RENDERER_UPSTREAM ? 'env MPW_RENDERER_UPSTREAM' : 'env MPW_RENDERER_8899（旧名）' }
  } catch { /* 配错**不静默**：health 如实回报，服务照常本地直供 */ return { raw, host: null, port: null, path: '', bad: true, from: process.env.MPW_RENDERER_UPSTREAM ? 'env MPW_RENDERER_UPSTREAM' : 'env MPW_RENDERER_8899（旧名）' } }
})()
const MPW_ROOT = path.resolve(process.env.MPW_ROOT || path.resolve(REPO_ROOT, '..'))
/* 库根**来源**（显式记录，`/api/library`、`/api/library-source` 与 `/__health` 都如实回报 ——
   不把"推导出来的默认值"当成"用户已选"）：
     env     = 环境变量 MPW_LIBRARY_DIR（优先级最高，与既有服务同风格）
     cli     = 命令行 --library=DIR
     default = **候选列表里第一条存在的**（推导；采用哪条/为什么写在 `reason` 与 `candidates[]` 里）
     none    = 所有候选都不存在（运行期 `/api/library` 的 `source` 才会出现这个值）
   ⚠①(2026-09-24 可移植性审计 B1：`process/we-scene-demo-server-8902.mjs:160` 的旧读数)
     旧实现把 `<MPW_ROOT>/allwallpaper/dd` 写成了**产品默认值**（作者机器的语料布局），别人机器上启动
     就 `source:'none'`/空库。现在默认值是**候选列表 + 存在性探测**，且**不写死任何本机路径**：
       `<MPW_ROOT>/allwallpaper/dd` → `<MPW_ROOT>/allwallpaper` → **本仓自带合成样例 `<repo>/samples`**
     最后一条是"任何检出都存在"的兜底 ⇒ 换台机器开箱就有东西可开；三条都不存在才 `none`。
     想关掉"自动采用仓库自带样例"这一条（例如发布版不希望把 samples 当库）：`MPW_NO_BUNDLED_SAMPLES=1`。 */
const LIBRARY_SOURCE_INFO = (() => {
  const envVal = process.env.MPW_LIBRARY_DIR
  const cliVal = typeof flagVal('library') === 'string' ? flagVal('library') : ''
  if (envVal) return { source: 'env', from: 'env MPW_LIBRARY_DIR', raw: envVal, candidates: [] }
  if (cliVal) return { source: 'cli', from: 'argv --library=DIR', raw: cliVal, candidates: [] }
  const cands = [
    { raw: path.join(MPW_ROOT, 'allwallpaper', 'dd'), why: '工作区语料布局 <MPW_ROOT>/allwallpaper/dd（不是产品默认，只是第一条候选）' },
    { raw: path.join(MPW_ROOT, 'allwallpaper'), why: '工作区语料总目录 <MPW_ROOT>/allwallpaper' },
    ...(process.env.MPW_NO_BUNDLED_SAMPLES === '1' ? [] : [{ raw: path.join(REPO_ROOT, 'samples'), why: '本仓自带**合成**样例 <repo>/samples（任何检出都存在）' }]),
  ]
  const probed = cands.map((c) => {
    const p = path.resolve(c.raw)
    let exists = false
    try { exists = fs.existsSync(p) && fs.statSync(p).isDirectory() } catch { exists = false }
    return { path: p, why: c.why, exists }
  })
  const hit = probed.find((c) => c.exists)
  const chosen = hit || probed[0] || { path: path.join(MPW_ROOT, 'allwallpaper', 'dd'), why: '没有任何候选（占位）', exists: false }
  return {
    source: 'default', from: hit ? chosen.why : '**候选全部不存在**（' + chosen.path + ' 是占位；要换库根请设 MPW_LIBRARY_DIR / --library=DIR 或 MPW_NO_BUNDLED_SAMPLES 之外自己放语料）',
    raw: chosen.path, candidates: probed, adopted: hit ? chosen.path : null,
  }
})()
const LIBRARY_ROOT_FROM = LIBRARY_SOURCE_INFO.source === 'default'
  ? ('推导候选（' + (LIBRARY_SOURCE_INFO.adopted ? '采用第一条存在的：' : '**没有存在的候选**：') + LIBRARY_SOURCE_INFO.from + '）')
  : LIBRARY_SOURCE_INFO.from
const MPW_ROOT_FROM = process.env.MPW_ROOT ? 'env MPW_ROOT' : '默认 = 本仓库的上一级目录'
const LIBRARY_ROOT_CONFIG = path.resolve(LIBRARY_SOURCE_INFO.raw)
// 目录浏览根（只读浏览的**信任边界**）：默认 = MPW_ROOT（本机工作区），可用 MPW_PICK_ROOT 覆盖。
// 与库根分开：库根可能只是浏览根里的一个子目录（例如 <MPW_ROOT>/allwallpaper/dd），
// 而选择器必须能浏览/选到 <MPW_ROOT>/allwallpaper/** 这类**库根之外、浏览根之内**的目录。
// ⚠ 边界**故意不默认放宽到整个 home**（home 常含 ~/.ssh、~/.dsh 等私人目录）：
//   `GET /api/fs/roots` 会把 home 列出来并标 `listable:false` + 放宽办法（MPW_PICK_ROOT=$HOME）。
const PICK_ROOT_CONFIG = path.resolve(process.env.MPW_PICK_ROOT || MPW_ROOT)
const PICK_ROOT_FROM = process.env.MPW_PICK_ROOT ? 'env MPW_PICK_ROOT' : '默认 = MPW_ROOT（工作区；不含整个 home）'
const REPORTS_DIR = path.resolve(process.env.MPW_REPORTS_DIR || path.join(MPW_ROOT, 'reports'))
const PROPS_DIR = path.join(REPORTS_DIR, 'bench-props')
/* ⑥ web 帧的存储落盘：`<reports>/web-store/<wallId>.json`（与 bench-props 同一条纪律：**绝不写进壁纸包**） */
const WEB_STORE_DIR = path.join(REPORTS_DIR, 'web-store')
const TRASH_ROOT = path.join(MPW_ROOT, 'Delete', 'bench-trash')
const STATIC_ROOT = path.resolve(process.env.MPW_BENCH_STATIC_DIR || (typeof flagVal('static-root') === 'string' ? flagVal('static-root') : '') || path.join(REPO_ROOT, 'demo'))
// no-store 默认开（:8901 口径）；`--no-store` 显式、`--store` 或 MPW_BENCH_STORE=1 关闭（环境变量优先）
const STORE = process.env.MPW_BENCH_STORE === '1' ? true
  : process.env.MPW_BENCH_STORE === '0' ? false
    : flag('no-store') ? false
      : flagVal('store') === true
const STARTED_AT = new Date().toISOString()
const OPEN_CMD_ENV = process.env.MPW_OPEN_CMD || ''
// 上限（安全：所有落盘都要有上限；属性覆盖很小，这里给的是"单文件/单次请求"硬顶）
// ⑩（2026-09-19）`numEnv` 与 :8899 同实现：**非法/缺省值一律回落默认**（绝不出现"配错上限 = 把上限关掉"）。
const numEnv = (name, def) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : def
}
const LIMITS = {
  propsFileBytes: 64 * 1024 * 1024,   // 单次 props-file 上传 ≤64MB
  propsJsonBytes: 2 * 1024 * 1024,    // 单次 props 保存 body ≤2MB
  bodyBytes: 2 * 1024 * 1024,         // 其它 JSON body ≤2MB
  listItems: 5000,                    // /api/library 最多列 5000 项（防病态目录把响应撑爆）
  scanOps: 20000,                     // 单次库扫描的探测操作上限（readdir/stat；防病态目录）
  mpkgPerDir: 400,                    // ③单个目录里最多把多少个 `.mpkg` 折成**独立条目**（病态目录上限）
  videoPerDir: 200,                   // ③mpkg 档目录里顺带成条的视频文件上限（同上）
  dirEntries: 2000,                   // /api/dir-list 单层最多列 2000 个目录
  browserFiles: 1000,                 // /api/dir-list 单层最多列 1000 个文件
  /* ②b(2026-09-24) `GET /api/fs/file` 的单文件上限：**读**（不是列）用户的壁纸包，最大的一份实测
     336MB（scene.pkg），给一倍余量；超限**如实 413**，绝不截断成"半个包"当成功。
     与 `propsFileBytes`（上传，64MB）不同：这条是**只读下载**，不落盘、不进内存（sendFile 流式 + Range）。 */
  browseReadBytes: numEnv('MPW_LIMIT_FS_FILE_BYTES', 768 * 1024 * 1024),
  projectJsonBytes: 512 * 1024,       // project.json 超过它就不读（绝不整包读大文件）
  pkgTableBytes: 64 * 1024,           // PKGV 容器目录表首读窗口（不够 ×4 倍增）
  pkgTableMaxBytes: 1024 * 1024,      // 目录表倍增硬顶（超过就放弃容器内类型判定，如实上报）
  thumbPixels: 640,                   // /api/thumb 的宽度上限
  thumbMs: 20000,                     // ffmpeg 抽帧单次上限
  diagBuffer: 200,                    // 诊断环形缓冲条数（内存，不落盘）
  diagMsgChars: 2000,                 // 单条诊断消息截断长度
  // ⑩（2026-09-19）`POST /report` 与 `POST /baseline` 的**落盘上限**：与 :8899 同一套口径（数量 + 总字节，
  //   最旧先删）。放到这里是因为测试台的「立即上报」按钮先把载荷发到 `/report`（见 demo/bench-patch.js
  //   的 `DEBUG_REPORT_ROUTES`）—— 收下了就必须有上限，否则点几下就能把工作区写满。
  //   **落点与 :8899 逐字相同**（`<reports>/r<ts>.json`、`<reports>/baselines/<ts>.json`）：两个端口写的是
  //   同一种诊断/趋势数据，消费端（report-audit / baseline-diff）不该因为"从哪个端口上报的"而分两套目录。
  //   环境变量名也与 :8899 相同（`MPW_LIMIT_REPORTS_MAX` / `MPW_LIMIT_REPORTS_BYTES` / `MPW_LIMIT_BASELINE_MAX`
  //   / `MPW_LIMIT_BASELINE_BYTES`）：**只用于测试/现场调参** —— 把上限压到很小才能在几秒内验完清理路径。
  reportMaxFiles: numEnv('MPW_LIMIT_REPORTS_MAX', 60),                      // <reports>/r<ts>.json ≤60 份
  reportMaxBytes: numEnv('MPW_LIMIT_REPORTS_BYTES', 64 * 1024 * 1024),      // 顶层 r*/selfcheck* 合计 ≤64MB
  baselineMaxFiles: numEnv('MPW_LIMIT_BASELINE_MAX', 200),                  // <reports>/baselines/<ts>.json ≤200 份
  baselineMaxBytes: numEnv('MPW_LIMIT_BASELINE_BYTES', 32 * 1024 * 1024),   // 趋势目录合计 ≤32MB
  reportBodyBytes: 4 * 1024 * 1024,   // 单次 /report body ≤4MB（与 :8899 逐字同口径）
  baselineBodyBytes: 1024 * 1024,     // 单次 /baseline body ≤1MB（快照实测 3–6KB）
}

// ── 小工具 ──────────────────────────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.pkg': 'application/octet-stream', '.mpkg': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.tex': 'application/octet-stream', '.zip': 'application/zip',
}
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'
const NO_STORE = 'no-store, must-revalidate'
function statSafe(p) { try { return fs.statSync(p) } catch { return null } }
function lstatSafe(p) { try { return fs.lstatSync(p) } catch { return null } }
function mkdirSafe(p) { try { fs.mkdirSync(p, { recursive: true }) } catch { /* 见调用点 */ } }
/** 目录可读性（只 try 一次 readdir，不看内容）—— 如实回报，不猜。 */
function dirReadable(dir) {
  try { fs.readdirSync(dir); return true } catch { return false }
}

/** HTTP 错误：`status` 决定响应码；**一律不抛 500**（调用方要么按 error 文案显示，要么按非 2xx 抛错）。 */
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || null }
}
const bad = (msg, extra) => new HttpError(400, msg, extra)
const forbidden = (msg, extra) => new HttpError(403, msg, extra)
const notFound = (msg, extra) => new HttpError(404, msg, extra)

function json(res, status, body, headers) {
  const text = JSON.stringify(body, null, 1)
  const h = Object.assign(
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': NO_STORE, 'X-Bench-Server': 'we-scene-demo-8902' },
    headers || {},
  )
  res.writeHead(status, h)
  res.end(text)
}
const jsonOk = (res, body, headers) => json(res, 200, Object.assign({ ok: true }, body || {}), headers)
const jsonErr = (res, e) => {
  const status = e instanceof HttpError ? e.status : 500
  const body = Object.assign({ ok: false, error: e && e.message ? e.message : String(e) }, e instanceof HttpError ? e.extra || {} : {})
  json(res, status, body)
}
const readBody = (req, cap) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  let over = false
  req.on('data', (c) => {
    size += c.length
    if (size > cap) {
      // ⑩（2026-09-19 实测）原来这里是 `reject(...) + req.destroy()`：**先掐连接再写响应**，客户端拿到的是
      //   `ECONNRESET`（curl exit 56、status 100），根本看不到 413 —— 也就是"如实回状态码"这条口径在
      //   超限这条路上从来没成立过。改成**停止读取（pause）**、让调用方把 413 真正写出去：
      //   响应发完后 Node 会关掉这条连接（请求体没读完 ⇒ 不会复用），客户端因此能读到 `413 + JSON 说明`。
      if (!over) { over = true; reject(new HttpError(413, `请求体超过上限 ${cap} 字节（读取已停止；本服务不落盘）`)); req.pause() }
      return
    }
    chunks.push(c)
  })
  req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)) })
  req.on('error', (e) => { if (!over) reject(e) })
})
/* [we-json:strict|request-body] **不是包内/包旁 JSON**：这是 **HTTP 请求体**（客户端写进来的），不是 WE 随包文件。
   客户端给坏 JSON 必须**如实 400**（宽容会把"客户端 bug"糊成"服务端读懂了"⇒ 调用方永远发现不了自己发错了）。
   ⇒ 这里**永远**用严格 `JSON.parse`，不许换成 `parseWeJson`。 */
async function readJsonBody(req, cap) {
  const buf = await readBody(req, cap)
  if (!buf.length) return {}
  const text = buf.toString('utf8').replace(/^\uFEFF/, '')
  try {
    const v = JSON.parse(text)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('JSON body 必须是对象')
    return v
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw bad(`JSON 解析失败：${e.message}`)
  }
}

// ── 路径安全：唯一判据 ───────────────────────────────────────────────────────────────────────────
/** 前缀校验（规范化后）：p 必须在 root 内（root 自己算"内"）。 */
function isInside(root, p) {
  const rel = path.relative(root, p)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
}
/** 取"最长存在前缀"的真实路径 + 未存在尾部（逐级回溯；缺失路径也能校验真身）。 */
function realpathDeepest(p) {
  let cur = path.resolve(p)
  const tail = []
  for (;;) {
    try {
      const real = fs.realpathSync(cur)
      return tail.length ? path.join(real, ...tail.slice().reverse()) : real
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return path.resolve(cur, ...tail.slice().reverse())
      tail.push(path.basename(cur))
      cur = parent
    }
  }
}
/**
 * 库根内的路径解析（**唯一**入口）：相对路径里出现 `..` ⇒ 400；解析后越根 ⇒ 403；
 * 真身（realpath）越根 ⇒ 403（符号链接逃逸）。返回**词法**规范化路径（真身已验证在根内）。
 */
function safeJoin(rootReal, input, label) {
  const what = label || 'path'
  if (typeof input !== 'string' || !input) throw bad(`缺少 ${what}`)
  if (input.includes('\0')) throw bad(`${what} 含 NUL`)
  const dec = (() => { try { return decodeURIComponent(input) } catch { return input } })()
  if (dec.includes('\0')) throw bad(`${what} 含 NUL`)
  let norm
  if (path.isAbsolute(dec)) {
    norm = path.resolve(dec)
  } else {
    if (dec.split(/[\\/]+/).includes('..')) throw bad(`${what} 含 ".."：${input}`)
    norm = path.resolve(rootReal, dec)
  }
  if (!isInside(rootReal, norm)) throw forbidden(`${what} 越出根目录（库根/浏览根）：${input}`)
  const real = realpathDeepest(norm)
  if (!isInside(rootReal, real)) throw forbidden(`${what} 经符号链接越出根目录（库根/浏览根）：${input}`)
  return norm
}
/** itemId = **单个路径段**（工坊 id 是数字；夹具用简单名）⇒ `../`、绝对路径、`a/b` 全在 400。 */
const ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
// 国际口径：**非 ASCII 名**（中文/日文/西里尔目录名，实测语料里有「流萤」「纳西妲」这类收藏夹）
// 同样只允许单个路径段。ASCII 名一律仍走上面的严格口径（老行为零变化），
// 只有"含至少一个非 ASCII 字符 + 无分隔符/无控制符"的名字才走这一条。
const ITEM_ID_INTL_RE = /^[^\u0000-\u001f\u007f/\\]{1,120}$/
function assertItemId(id) {
  if (typeof id !== 'string' || !id) throw bad('缺少 itemId')
  if (id === '.' || id === '..' || id.startsWith('.')) throw bad(`itemId 非法（不许以 "." 开头）：${String(id).slice(0, 120)}`)
  if (/[\\/]/.test(id) || /[\u0000-\u001f\u007f]/.test(id) || id.length > 120) {
    throw bad(`itemId 含路径分隔符/控制符或过长（只允许单个路径段）：${String(id).slice(0, 120)}`)
  }
  if (ITEM_ID_RE.test(id)) return id
  if (/[^\x00-\x7f]/.test(id) && ITEM_ID_INTL_RE.test(id)) return id     // 非 ASCII 单段名
  throw bad(`itemId 非法（只允许单个路径段 [A-Za-z0-9._-]，或含非 ASCII 字符的单段名）：${String(id).slice(0, 120)}`)
}
/** 属性名：WE 作者自定（`newproperty12`、`schemecolor`…）⇒ 同样只允许单段。 */
const PROP_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/
function assertPropName(n) {
  if (typeof n !== 'string' || !n) throw bad('缺少属性名 name')
  if (n === '.' || n === '..' || !PROP_NAME_RE.test(n)) throw bad(`属性名非法：${String(n).slice(0, 120)}`)
  return n
}
/** 上传文件名：只取 basename，且必须仍是单段（拒绝 `..`、分隔符、绝对路径）。 */
function assertFileName(raw, label) {
  const s = String(raw == null ? '' : raw)
  if (!s) throw bad(`缺少 ${label || '文件名'}`)
  if (s.includes('\0') || /[\\/]/.test(s)) throw bad(`${label || '文件名'} 不能含路径分隔符：${s.slice(0, 120)}`)
  if (s === '.' || s === '..') throw bad(`${label || '文件名'} 非法：${s}`)
  return s
}

// 库根：配置值可能不存在 ⇒ 真身只在存在时算；所有校验都用"真身或词法根"
const LIBRARY_ROOT_REAL = (() => {
  try { return fs.realpathSync(LIBRARY_ROOT_CONFIG) } catch { return LIBRARY_ROOT_CONFIG }
})()
// 浏览根（目录选择器的信任边界）：同样"真身优先"
const PICK_ROOT_REAL = (() => {
  try { return fs.realpathSync(PICK_ROOT_CONFIG) } catch { return PICK_ROOT_CONFIG }
})()
const LIBRARY_ROOT_EXISTS = !!statSafe(LIBRARY_ROOT_REAL)
/* ②(2026-09-24 用户第 1/2 条 · 只读浏览的**允许目录**策略)
   浏览边界从"单个根"变成"一份**推导出来的**允许根清单"，三条来源（都跨平台、都不写死本机路径）：
     ① `MPW_PICK_ROOT`（默认 = MPW_ROOT，工作区）—— 旧口径，永远在清单里、永远是第一顺位；
     ② **库根 / 库根的上一级**：库根可能由 `MPW_LIBRARY_DIR`/`--library=` 指到浏览根之外，
        那时"库根自己"与"放壁纸的上一级目录"都必须能浏览，否则用户就被自己的配置锁在门外；
     ③ `MPW_ALLOW_DIRS`：冒号/分号分隔的**额外**允许目录（显式放宽口，逐条生效）。
   保守之处：②③ 只在**确实落在浏览根之外**时才追加 —— 默认布局（库根在 MPW_ROOT 内）下
   这份清单与旧行为**逐字节等价**（不会因为"库根的上一级"顺带把 `/tmp` 之类打开）。 */
const BROWSE_EXTRA_DIRS = String(process.env.MPW_ALLOW_DIRS || '')
  .split(/[:;]/).map((s) => s.trim()).filter(Boolean).map((d) => path.resolve(d))
const BROWSE_ROOTS = (() => {
  const out = [PICK_ROOT_REAL]
  const add = (p) => { const r = realpathDeepest(p); if (!out.includes(r) && statSafe(r)) out.push(r) }
  const libParent = path.dirname(LIBRARY_ROOT_REAL)
  for (const p of [LIBRARY_ROOT_REAL, libParent, ...BROWSE_EXTRA_DIRS]) {
    if (out.some((r) => isInside(r, p))) continue       // 已经在允许清单里 ⇒ 不加（不放大边界）
    add(p)
  }
  return out
})()
const BROWSE_ROOTS_FROM = [
  'MPW_PICK_ROOT / MPW_ROOT（' + PICK_ROOT_FROM + '）',
  ...(BROWSE_ROOTS.length > 1 ? ['库根或库根的上一级（推导）' + (BROWSE_EXTRA_DIRS.length ? ' + MPW_ALLOW_DIRS' : '')] : []),
].join(' + ')
/** 命中的浏览根（清单里的**第一个**包含 p 的根）。`sameAs` 给"上一级"用：只在同一个根内向上。 */
function containingBrowseRoot(p, sameAs) {
  const real = realpathDeepest(p)
  if (sameAs) {
    const base = BROWSE_ROOTS.find((r) => isInside(r, realpathDeepest(sameAs)))
    if (base) return isInside(base, real) ? { label: 'browseRoot', path: base } : null
  }
  for (const r of BROWSE_ROOTS) if (isInside(r, real)) return { label: 'browseRoot', path: r }
  return null
}
/** `/api/fs/roots` 的roots[]：前端选择器的入口列表（`path` 一律绝对路径）。
 *  `listable` 才是"能不能列"（默认边界 = 工作区，home 通常在外 ⇒ 标 false 并给出放宽办法）。
 *
 *  ⚠①(2026-09-24 用户第 1 条「不要写死我的目录」) 这份候选表**必须全部是推导出来的**，且标签也要推导：
 *    旧实现里有两条是"这台机器的事实"被写成了字面量 —— `label:'工作区（DSHAREA）'`（工作区目录名写死）
 *    与 `label:'壁纸总目录 allwallpaper'`（把某台机的语料目录名当产品名词）。现在：
 *      · 标签一律由 `path.basename()` + **角色词**拼出来（工作区根 / 库根的上一级 / 宿主 home …）；
 *      · 候选一律从**库根（配置/环境变量/运行期选择）**、`os.homedir()`、`process.cwd()`、`/media`、
 *        Windows 盘符这些**任何机器上都成立**的东西推导；
 *      · 不存在的候选**照样列出**（`exists:false` + 原因），因为"列出来但没有"比"悄悄消失"更好排查。
 *    判据：`tests/bench-dsh-libroot-test.mjs` B 段扫描本文件（tracked 源）里不许出现本机绝对路径与
 *    写死的工作区名（与 `tests/secret-scan-test.mjs` 同一口径，那里扫的是全仓库 tracked 文件）。 */
function fsRoots() {
  const home = os.homedir() || '/'
  const lib = activeRoot
  const libParent = path.dirname(lib)
  /** 跨平台通用候选：POSIX 的挂载点目录 + Windows 盘符（都是"这台机器上可能存在的根"，不是写死的路径）。 */
  const platformRoots = []
  if (process.platform === 'win32') {
    for (const drive of 'CDEFGHIJ') {
      const p = drive + ':\\'
      if (statSafe(p)) platformRoots.push({ label: '盘符 ' + drive + ':', path: p, kind: 'drive' })
    }
  } else {
    // ①(2026-10-12 P-330) 挂载点补 **macOS 的 `/Volumes`** ✓（外接卷/磁盘映像挂在这里 ✗ ⇒ 原先 macOS 用户看不到外接盘 ✓）；
    //   WSL 的 `/mnt/c`、`/mnt/d` … 已被 `/mnt` 覆盖 ✓（用户进入 `/mnt` 后再选盘符 ✓，不逐盘列条目 ✗ —— 会撑爆 MAX_FS_ROOTS=6 ✓）。
    for (const m of ['/media', '/mnt', '/run/media', '/Volumes']) if (statSafe(m)) platformRoots.push({ label: '挂载点 ' + m, path: m, kind: 'mount' })
  }
  /* ②(2026-09-24 用户第 1 条「你搞这么多快捷根干嘛 你就留几个，所有电脑都可能有的几个就行了」)
     改前读数（真机 :8902 的选择器）：候选 **8–9 条**（当前库目录 / 配置库根 / 库根的上一级 /
     配置库根的上一级 / 宿主 home / 当前工作目录 / 工作区根 / 挂载点×2）⇒ 一行放不下 ⇒ 溢出，
     且"当前库目录"被竖排成一字一行、后面几条根本显示不出来。
     改后口径（**只减不增**，每条仍然是推导出来的，见 ①）：只留"任何一台电脑上都成立"的五类 ——
       ① 当前库目录（用户真正要选的）；② 库根的上一级（能退回上一层挑别的库）；
       ③ 宿主 home；④ 当前工作目录；⑤ 工作区根（= MPW_ROOT，与 ④ 同路径时自动合并成一条）；
       ⑥ 平台挂载点/盘符（POSIX /media·/mnt·/run/media 或 Windows 盘符，**最多留 2 条**）。
     删掉的三条：`配置库根`（与 ① 常同路径，纯重复）、`配置库根的上一级`（与 ② 同义）、
     多余的第 3+ 个挂载点 —— 它们都不是"用户会去点的根"，只是把一行撑爆。
     总条数上限 `MAX_FS_ROOTS`（含去重后）：保证一行 + 折行一定放得下（判据见
     `tests/bench-dsh-libroot-test.mjs` A1 与 `tests/bench-issue0924a-line-A-test.mjs` 的溢出自检）。 */
  const MAX_FS_ROOTS = 6
  // 顺序即去重优先级（同路径只留先出现的那条 ⇒ "当前库目录"永远在列表最前）
  const cands = [
    { label: '当前库目录', path: lib, kind: 'library', role: 'library' },
    // ①(用户第 1 条) 库根的**上一级**：从库根推导，跨机器成立（作者机上是 …/allwallpaper，别人机上是别的）
    { label: '库根的上一级（' + path.basename(libParent) + '）', path: libParent, kind: 'library-parent', role: 'library-parent' },
    { label: '宿主 home', path: home, kind: 'home', role: 'home' },
    { label: '当前工作目录（' + path.basename(process.cwd()) + '）', path: process.cwd(), kind: 'cwd', role: 'cwd' },
    { label: '工作区根（' + path.basename(MPW_ROOT) + '）', path: MPW_ROOT, kind: 'workspace', role: 'workspace' },
    ...platformRoots.slice(0, 2).map((r) => Object.assign({ role: r.kind }, r)),
  ]
  const out = []
  const byPath = new Map()
  for (const c of cands) {
    const p = path.resolve(c.path)
    const hit = byPath.get(p)
    if (hit) { hit.labels.push(c.label); continue }   // 同路径只出一条，标签合并（例如库根就是配置库根）
    const exists = !!statSafe(p)
    const inside = !!containingBrowseRoot(p)
    const row = Object.assign({}, c, {
      path: p, labels: [c.label], exists, listable: inside && exists,
      reason: inside ? (exists ? null : '路径不存在') : `不在只读浏览边界内（当前边界：${PICK_ROOT_REAL}）`,
      enableHint: inside ? null : `把浏览边界放宽到它（或它的上层）即可：MPW_PICK_ROOT=${path.resolve(c.path)}`,
    })
    if (out.length >= MAX_FS_ROOTS) break                // ② 上限：多出来的候选直接不进列表（见上）
    byPath.set(p, row)
    out.push(row)
  }
  return out
}
// 静态面允许的根（真身）：demo/ 自身 + demo/samples 软链指向的真身（`samples -> ../samples`，仓库自带合成样例）
const STATIC_ROOTS = (() => {
  const out = []
  try { out.push(fs.realpathSync(STATIC_ROOT)) } catch { out.push(STATIC_ROOT) }
  for (const cand of [path.join(STATIC_ROOT, 'samples')]) {
    try { const r = fs.realpathSync(cand); if (!out.includes(r)) out.push(r) } catch { /* 没有就没有 */ }
  }
  return out
})()
// 活动库根（可在库根内**收窄**到子目录，也可由选择器**显式**选成浏览根内的另一个目录）
let activeRoot = LIBRARY_ROOT_REAL
// 运行期"用户显式选过"的痕迹（**只有** POST /api/library-dir {dir|pick} 会写它）：
// 它的存在与否决定 /api/library 里 `source` 是 `user` 还是配置来源 —— 未选择时**不假装已选**。
let selection = null            // { dir, at, mode }
const selectRoot = (dir, mode) => { activeRoot = dir; selection = { dir, at: Date.now(), mode: mode || 'dir' }; return selection }
const clearSelection = () => { selection = null; activeRoot = LIBRARY_ROOT_REAL; return null }
/* ③(2026-09-24 用户「壁纸都启动失败 / PKG HTTP404」的根因那一半) itemId 从"**单个路径段**"推广到
   "**相对库根的嵌套路径**"（`<角色>/<角色>_NN.mpkg`）。为什么必须推广：项目所有者真实的库布局是
   `wallpaperE/<角色>/<角色>_NN.mpkg`（实测 148 个 `.mpkg`），旧口径"一个目录一个条目"让用户只看到
   20 条（= 20 个角色目录，每个 `file` = 该目录第一个 `.mpkg`）⇒ 148 张壁纸里绝大多数**根本看不见**。
   安全口径**一处都没放宽**（这是本文件唯一的路径判据，改动必须比原来更严、不许更松）：
     · 每一段仍是**单段名**：无 `/`、无 `\`、无控制符、不以 `.` 开头、非空、≤120 字符；
     · 整条路径仍走 `safeJoin(root, v, 'itemId')` 那三道校验：相对路径里出现 `..` ⇒ **400**、
       解析后越出库根 ⇒ **403**、真身（realpath）经符号链接越出库根 ⇒ **403**、含 NUL ⇒ 400。
   ⚠ 不许为了让嵌套 id 通过而把 `..`/越根判定改宽 —— 判据见 `tests/bench-mpkg-items-test.mjs`
   （`../../etc/passwd`、绝对路径 `/etc/passwd`、符号链接逃逸三组都必须被拒）。 */
const ITEM_PATH_MAX_SEGS = 8
function assertItemPath(id) {
  if (typeof id !== 'string' || !id) throw bad('缺少 itemId')
  if (id.length > 400) throw bad(`itemId 过长（>400）：${String(id).slice(0, 120)}`)
  const segs = id.split('/')
  if (segs.length > ITEM_PATH_MAX_SEGS) throw bad(`itemId 层级过深（>${ITEM_PATH_MAX_SEGS} 段）：${String(id).slice(0, 120)}`)
  for (const s of segs) {
    if (!s) throw bad(`itemId 有空路径段（首尾或连续 "/"）：${String(id).slice(0, 120)}`)
    if (s === '.' || s === '..' || s[0] === '.') throw bad(`itemId 段非法（不许以 "." 开头）：${String(id).slice(0, 120)}`)
    if (!ITEM_ID_INTL_RE.test(s)) throw bad(`itemId 段含路径分隔符/控制符或过长：${String(id).slice(0, 120)}`)
  }
  return segs.join('/')
}
/** itemId → 库根内**词法**绝对路径（**唯一**入口：段校验 + `safeJoin` 三道校验）。 */
const itemAbsPath = (id, label) => safeJoin(activeRoot, assertItemPath(id), label || 'itemId')
/** itemId 定位：**目录项**（`isDir`）或**单文件项**（`isFile`；`dir` = 所在目录、`base` = 文件名）。
 *  为什么要有"文件项"：`.mpkg` 一等项的 itemId 就指向一个**文件**（`<角色>/<角色>_01.mpkg`），
 *  而 `/api/props`、`/api/thumb`、`/api/reveal` 这些老路由要的是"条目所在的目录"⇒ 两种形态在这里收口。 */
function itemLocate(id) {
  const rel = assertItemPath(id)
  const abs = safeJoin(activeRoot, rel, 'itemId')
  const st = statSafe(abs)
  if (!st) throw notFound(`条目不存在：${rel}`)
  const real = realpathDeepest(abs)
  if (!isInside(activeRoot, real)) throw forbidden(`条目经符号链接越出库根：${rel}`)
  if (st.isDirectory()) return { id: rel, abs, real, isDir: true, isFile: false, dir: abs, base: null, st }
  if (st.isFile()) return { id: rel, abs, real, isDir: false, isFile: true, dir: path.dirname(abs), base: path.basename(abs), st }
  throw notFound(`条目既不是文件也不是目录：${rel}`)
}
/** 老的"目录型"取法（`itemId` 指向一个目录）。单段 id 的返回与旧实现逐字相同；
 *  嵌套 id 现在也成立（`<角色>/<子目录>`）；若指向的是**文件**，调用方应改用 `itemLocate()`。 */
const itemDirReal = (id) => itemAbsPath(id)
/* ③(2026-09-24 用户第 3/4 条：切根后**不刷新**就必须全部跟着变)
   把"当前生效的库根"以**函数**形式注入给渲染器处理器（`:8899` 那份实现里的**唯一**读取点
   `currentLibraryRoot()`）。为什么是函数而不是值：`activeRoot` 每次 `POST /api/library-dir` 都会变，
   注入一个取值器 ⇒ 同一个进程内 `/pkg/<id>`、`/project/<id>`、`/ddlist/<id>`、`/type/<id>`、
   `/ddvideo/…`、`/noise`、`/transpiled/…`、`/shader/…` **当次请求**就用新根，不必刷页面、不必重启服务。 */
setLibraryRootProvider(() => activeRoot)

/** 浏览路径解析（**唯一**入口）：`..` ⇒ 400；越浏览根 ⇒ 403；符号链接逃逸 ⇒ 403；NUL ⇒ 400。 *  返回 { norm, root }（root = 命中的浏览根），调用方要"只是校验"就用 assertBrowsePath()。 */
function resolveBrowsePath(input) {
  const what = 'path'
  if (typeof input !== 'string' || !input) throw bad(`缺少 ${what}`)
  if (input.includes('\0')) throw bad(`${what} 含 NUL`)
  const dec = (() => { try { return decodeURIComponent(input) } catch { return input } })()
  if (dec.includes('\0')) throw bad(`${what} 含 NUL`)
  let norm
  if (path.isAbsolute(dec)) {
    norm = path.resolve(dec)
  } else {
    if (dec.split(/[\\/]+/).includes('..')) throw bad(`${what} 含 ".."：${input}`)
    norm = path.resolve(PICK_ROOT_REAL, dec)
  }
  const root = containingBrowseRoot(norm)
  if (!root) throw forbidden(`${what} 越出浏览根（允许：${BROWSE_ROOTS.join(' , ')}）：${input}`)
  const real = realpathDeepest(norm)
  const rootReal = containingBrowseRoot(real)
  if (!rootReal) throw forbidden(`${what} 经符号链接越出浏览根：${input}`)
  return { norm, root: rootReal, real }
}
function assertBrowsePath(input) {
  return resolveBrowsePath(input == null || input === '' ? '.' : String(input)).norm
}
/** 库来源状态（`source` 只可能是 env/cli/user/default/none；`selected` 才是"用户选过没有"）。 */
function librarySource() {
  const baseSource = selection ? 'user' : LIBRARY_SOURCE_INFO.source
  // 既没有显式配置、候选里也没有任何一条存在 ⇒ `none`（连"回退到某条推导路径"都不成立）
  const source = (!selection && baseSource === 'default' && !LIBRARY_ROOT_EXISTS) ? 'none' : baseSource
  const exists = !!statSafe(activeRoot)
  const narrowed = activeRoot !== LIBRARY_ROOT_REAL
  const reason = (() => {
    if (source === 'user') return `用户在选择器里显式选定（${selection && selection.mode === 'pick' ? '{pick:true} 宿主对话框' : '路径提交'}）：${activeRoot}`
    if (source === 'env') return `环境变量 MPW_LIBRARY_DIR 指定：${LIBRARY_ROOT_CONFIG}`
    if (source === 'cli') return `命令行 --library= 指定：${LIBRARY_ROOT_CONFIG}`
    if (source === 'default') return `**没有人选过**：按候选顺序探测后采用 ${LIBRARY_ROOT_CONFIG}（${LIBRARY_SOURCE_INFO.from}）；` +
      '要换库根请在页面里用选择器选，或设 MPW_LIBRARY_DIR / --library=DIR'
    return `没有任何可用库根：既没有 MPW_LIBRARY_DIR/--library=，候选里也没有任何一条存在（逐条见 candidates）`
  })()
  return {
    dir: activeRoot,
    source,
    selected: !!selection,                                      // 用户是否**显式**选过
    explicit: source === 'env' || source === 'cli' || source === 'user',   // 是否有显式配置来源
    configuredDir: LIBRARY_ROOT_CONFIG,
    configuredDirReal: LIBRARY_ROOT_REAL,
    configuredSource: LIBRARY_SOURCE_INFO.source,
    configuredFrom: LIBRARY_SOURCE_INFO.from,
    configuredFromDerived: LIBRARY_ROOT_FROM,
    configuredExists: LIBRARY_ROOT_EXISTS,
    /* ①(审计 B1) 候选列表逐条如实回报（哪条被采用、哪条不存在、为什么）——
       "别人机器上为什么是这个库根"必须能一眼看出来，而不是靠读源码。 */
    candidates: (LIBRARY_SOURCE_INFO.candidates || []).map((c) => Object.assign({}, c, { adopted: c.path === LIBRARY_ROOT_CONFIG })),
    defaultDir: LIBRARY_ROOT_CONFIG,                             // 采用的那条（不再写死 <MPW_ROOT>/allwallpaper/dd）
    narrowed,
    withinConfiguredRoot: isInside(LIBRARY_ROOT_REAL, activeRoot),
    withinBrowseRoot: !!containingBrowseRoot(activeRoot),
    exists,
    readable: exists ? dirReadable(activeRoot) : false,
    env: {
      MPW_ROOT: process.env.MPW_ROOT || null,
      MPW_LIBRARY_DIR: process.env.MPW_LIBRARY_DIR || null,
      MPW_PICK_ROOT: process.env.MPW_PICK_ROOT || null,
    },
    roots: { mpwRoot: MPW_ROOT, mpwRootFrom: MPW_ROOT_FROM, browseRoot: PICK_ROOT_REAL, browseRootFrom: PICK_ROOT_FROM },
    reason,
  }
}
/** 浏览根自述（选择器的起始状态；`roots[]` 是给前端画"回到最上层"的入口）。 */
function browseRootInfo() {
  return {
    root: PICK_ROOT_REAL, configuredRoot: PICK_ROOT_CONFIG, from: PICK_ROOT_FROM,
    exists: !!statSafe(PICK_ROOT_REAL), home: os.homedir() || '/', platform: process.platform,
    readOnly: true,
  }
}

// ── 诊断环形缓冲（本服务自己的数据源，不代理 :8899）────────────────────────────────────────────
const diagBuffer = []
let diagSeq = 0
const sseClients = new Set()
function recordDiag(msg, level, source) {
  const text = String(msg == null ? '' : msg).slice(0, LIMITS.diagMsgChars)
  if (!text) return null
  const evt = { seq: ++diagSeq, ts: Date.now(), msg: text, level: level || (/fail|error|ERROR|失败/.test(text) ? 'error' : 'info'), source: source || 'bench' }
  diagBuffer.push(evt)
  while (diagBuffer.length > LIMITS.diagBuffer) diagBuffer.shift()
  const line = `data: ${JSON.stringify(evt)}\n\n`
  for (const c of sseClients) { try { c.write(line) } catch { /* 断开的连接由 close 事件清理 */ } }
  return evt
}
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

// ── /api/library：列表（只读）────────────────────────────────────────────────────────────────────
/** 包内/包旁 JSON 解析失败、调用方**按原有语义吞掉**时的记账（计数 + 一行诊断，不静默）。
 *  计数在解析器里（`weJsonStats()` 的 `calls/plain/trailingComma/comments/failed`），这里补一行 `console.warn`
 *  并在行尾带上累计 `failed`；同一个 `where|原因` 只吵一次 —— `readProjectJson` 在 `/api/library` 上
 *  是**逐条目**调用的，不去重会把一次损坏刷成几百行。返回值恒 `null`，方便 `catch (e) { return swallowWeJson(...) }`。 */
const weJsonSwallowedSeen = new Map()
function swallowWeJson(where, e) {
  try {
    const key = where + '|' + String((e && e.message) || e)
    const n = (weJsonSwallowedSeen.get(key) || 0) + 1
    weJsonSwallowedSeen.set(key, n)
    if (n === 1) console.warn('[8902] 包内/包旁 JSON 读取/解析失败（按原语义吞掉）: ' + where
      + ' — ' + String((e && e.message) || e) + '（weJsonStats.failed=' + weJsonStats().failed + '）')
  } catch { /* 记账本身失败不影响请求 */ }
  return null
}
/** 读库项目录里的 `project.json`（**包旁** JSON：与 scene.pkg 同级，属性表/标题/类型/入口都声明在这里）。
 *  （"包旁"判定：路径 = `<库项目录>/project.json`，由 `libraryItemFromDir`/`dirSignals`/`buildProps` 传入；
 *   `core/scene-project-json.mjs` 里那份查找链也是同一个官方法——WE 工坊布局就是"一个壁纸一个目录"。）
 *  官方容忍尾逗号/注释（jsoncpp）⇒ 走 `parseWeJson`（P-177 同一份实现）。
 *  语义与改动前逐条一致：不存在/超限 ⇒ `null`；真坏 JSON 仍然抛 ⇒ 这里按原语义吞掉并**记账**。 */
function readProjectJson(dir) {
  const p = path.join(dir, 'project.json')
  const st = statSafe(p)
  if (!st || !st.isFile()) return null
  if (st.size > LIMITS.projectJsonBytes) return null     // 大文件不读（绝不为一个属性表整包读盘）
  try { return parseWeJson(fs.readFileSync(p, 'utf8')) } catch (e) { return swallowWeJson('readProjectJson(' + p + ')', e) }
}
const SCENE_CANDIDATES = ['scene.pkg', 'scenes/scene.pkg', 'gifscene.pkg']   // 与 renderer bundle 的 `c1` 逐字一致
// 网页入口候选：**白名单路径**（不是递归搜索）—— 与插件 detectWebWallpaperKind 的"入口"口径一致，
// 常见布局：根 / web/ / html/ / dist/ 下的 index.html。
const HTML_ENTRY_CANDIDATES = ['index.html', 'index.htm', 'index.xhtml', 'web/index.html', 'html/index.html', 'dist/index.html']
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']
const MPKG_EXT = ['.mpkg', '.pkg']
const PREVIEW_CANDIDATES = ['preview.gif', 'preview.jpg', 'preview.jpeg', 'preview.png', 'preview.webp', 'preview.bmp', 'preview.avif']
const MPKG_EXT_RE = /\.(mpkg|pkg)$/i          // PKG 家族文件（选择器给"容器族"标 kind 用）
const MPKG_COLLECTION_RE = /\.mpkg$/i         // **只有 .mpkg** = 合集容器（语料里的收藏夹形态）
const PKG_ONLY_RE = /\.pkg$/i                 // 单场景包（scene.pkg 等）—— 不是"合集容器"，别混为一谈
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv|avi|m4v)$/i
function pickFirstFile(dir, preds, cap) {
  const names = listDirNames(dir, cap || 400)
  for (const pred of preds) { const hit = names.find(pred); if (hit) return hit }
  return null
}
function listDirNames(dir, cap) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  names.sort()
  return cap ? names.slice(0, cap) : names
}
function hasScenePkg(dir) {
  for (const rel of SCENE_CANDIDATES) { const st = statSafe(path.join(dir, rel)); if (st && st.isFile()) return rel }
  return null
}
/** 探测预算：一次库扫描里所有 readdir/stat 都计数，超过上限就停止深挖（并在 scan 里如实上报）。 */
function makeBudget(ops) {
  return {
    limit: ops, used: 0, exceeded: false,
    op() { this.used++; if (this.used > this.limit) { this.exceeded = true; return false } return true },
  }
}
/** 在**白名单相对路径**里找第一个存在的文件（不递归、不遍历整棵树）。 */
function pickExisting(dir, rels, budget) {
  for (const rel of rels) {
    if (budget && !budget.op()) return null
    const st = statSafe(path.join(dir, rel))
    if (st && st.isFile()) return rel
  }
  return null
}
// ── PKGV 容器目录表（**只读文件头**，不解包、不整包读）────────────────────────────────────────────
// 格式（与 dsh-mpkg-wallpaper/lib/pkg-extract.js 的 readPkgTable 逐字段一致）：
//   sizedString(magic='PKGV00xx') | i32 count | count × { sizedString(path), u32 offset, u32 length }
// 压缩标志不在表里（由读取端探测条目字节决定）⇒ 本服务**只读表**即可判定容器内有什么类型。
function parsePkgTable(buf, fileSize) {
  const need = (at, len) => at + len <= buf.length
  if (!need(0, 4)) return { ok: false, reason: '头部不足 4 字节', needMore: true }
  const magicLen = buf.readInt32LE(0)
  if (magicLen <= 0 || magicLen > 32) return { ok: false, reason: `magic 长度非法：${magicLen}` }
  if (!need(4, magicLen + 4)) return { ok: false, reason: '头部不足（magic）', needMore: true }
  const magic = buf.toString('utf8', 4, 4 + magicLen)
  // PKG 家族：`PKGV####` = 场景包；`PKGM####` = .mpkg 合集包（**实测语料里 .mpkg 全是 PKGM**）。
  // 目录表布局两者一致（packages/we-core/src/pkg.js 的解析口径）。
  if (!/^PKG[VM]\d{4}$/.test(magic)) return { ok: false, reason: `magic 不匹配：${magic.slice(0, 16)}`, magic }
  let at = 4 + magicLen
  const count = buf.readInt32LE(at); at += 4
  if (count < 0 || count > 1048576) return { ok: false, reason: `条目数非法：${count}`, magic }
  const entries = []
  for (let i = 0; i < count; i++) {
    if (!need(at, 4)) return { ok: false, reason: '目录表被截断', needMore: true, magic, count, parsedEntries: entries.length }
    const nl = buf.readInt32LE(at); at += 4
    if (nl < 0 || nl > 1024) return { ok: false, reason: `条目名长度非法：${nl}`, magic, count }
    if (!need(at, nl + 8)) return { ok: false, reason: '目录表被截断', needMore: true, magic, count, parsedEntries: entries.length }
    const name = buf.toString('utf8', at, at + nl); at += nl
    const offset = buf.readUInt32LE(at); at += 4
    const length = buf.readUInt32LE(at); at += 4
    entries.push({ path: name, offset, length })
  }
  return { ok: true, magic, count, dataStart: at, entries, fileSize: fileSize == null ? null : fileSize }
}
function readPkgTableHead(file) {
  const st = statSafe(file)
  if (!st || !st.isFile()) return { ok: false, reason: '不是普通文件' }
  if (st.size < 8) return { ok: false, reason: `文件太小（${st.size} B）` }
  let fd = null
  try { fd = fs.openSync(file, 'r') } catch (e) { return { ok: false, reason: `打不开：${(e && e.code) || e}` } }
  try {
    let n = Math.min(LIMITS.pkgTableBytes, st.size)
    for (;;) {
      const buf = Buffer.allocUnsafe(n)
      let got = 0
      while (got < n) { const r = fs.readSync(fd, buf, got, n - got, got); if (r <= 0) break; got += r }
      const parsed = parsePkgTable(buf.subarray(0, got), st.size)
      if (parsed.ok) return Object.assign({ headBytes: got, fileSize: st.size }, parsed)
      if (parsed.needMore && n < st.size && n < LIMITS.pkgTableMaxBytes) { n = Math.min(st.size, n * 4); continue }
      return Object.assign({ headBytes: got, fileSize: st.size, tableComplete: false }, parsed)
    }
  } finally { try { fs.closeSync(fd) } catch { /* 已关 */ } }
}
/** 容器内条目 → 类型信号（只按**路径名**判定，不读条目内容）。
 *  ③(2026-09-24 mpkg 一等项) 除聚合信号 `scene` 外，另给**两个更细的**字段 `sceneJson` / `scenePkg`：
 *  为什么必须分开：渲染器页的场景路只认 `scene.json`（`demo.html` 的 `lib.getEntry(pkg,'scene.json')`，
 *  没有就走"纯视频壁纸"或如实报错），而"容器里只有 scene.pkg"（PKGV 套 PKGV）**它吃不了**。
 *  聚合字段 `scene`/`kind` 的取值与顺序**逐字不变**（目录条目的 `containerKind` 判据不受影响）。 */
function classifyPkgEntries(entries) {
  const paths = (entries || []).map((e) => String(e.path || ''))
  const find = (re) => paths.find((p) => re.test(p)) || null
  const sceneJson = find(/(^|\/)scene\.json$/i)
  const scenePkg = find(/(^|\/)(scene\.pkg|gifscene\.pkg)$/i)
  const scene = scenePkg || sceneJson
  const html = find(/(^|\/)(index\.html?|index\.xhtml)$/i) || find(/\.html?$/i)
  const video = find(VIDEO_EXT_RE)
  const mpkg = find(MPKG_COLLECTION_RE)
  const project = find(/(^|\/)project\.json$/i)
  const preview = find(/(^|\/)preview\.(gif|png|jpe?g|webp|bmp|avif)$/i)
  // 顺序与目录口径一致：scene 容器 > 网页入口 > 视频 > 嵌套容器 > 未知
  const kind = scene ? 'scene' : html ? 'web' : video ? 'video' : mpkg ? 'mpkg' : 'unknown'
  return { kind, scene, sceneJson, scenePkg, html, video, mpkg, project, preview, count: paths.length }
}
/** 只读容器里某个条目的**开头**并尝试当 JSON 解析（project.json 通常是未压缩的普通 JSON）。
 *  解析不出来 ⇒ null（**不猜**、不解压）。
 *  ⚠ 这是**包内** JSON（条目路径 `…/project.json` 来自容器目录表）⇒ 走 `parseWeJson`（官方容忍尾逗号/注释）。
 *  归因只落在**解析**这一段：`openSync/readSync` 失败仍由外层 `catch { return null }` 兜（读盘失败 ≠ JSON 坏）。 */
function readPkgEntryHeadJson(file, dataStart, entry) {
  if (!entry || !(entry.length > 0) || entry.length > LIMITS.projectJsonBytes) return null
  const n = Math.min(entry.length, 64 * 1024)
  let fd = null
  try { fd = fs.openSync(file, 'r') } catch { return null }
  try {
    const buf = Buffer.allocUnsafe(n)
    let got = 0
    while (got < n) { const r = fs.readSync(fd, buf, got, n - got, dataStart + entry.offset + got); if (r <= 0) break; got += r }
    const text = buf.subarray(0, got).toString('utf8')      // BOM 由 parseWeJson 与官方一致地吃掉
    try {
      const j = parseWeJson(text)
      return j && typeof j === 'object' && !Array.isArray(j) ? j : null
    } catch (e) { return swallowWeJson('readPkgEntryHeadJson(' + file + '#' + String(entry.path || '') + ')', e) }
  } catch { return null } finally { try { fs.closeSync(fd) } catch { /* 已关 */ } }
}
/** `.mpkg`/`.pkg` 容器摘要：目录表 + 内层类型 + （能从容器里读到的）project.json。 */
function mpkgSummary(file, name) {
  const table = readPkgTableHead(file)
  const size = (statSafe(file) || {}).size || 0
  if (!table.ok) {
    return { name, size, tableOk: false, tableReason: table.reason, tableComplete: false, entries: 0, kind: 'unknown', signals: null, project: null, previewInContainer: null, entryNames: [] }
  }
  const sig = classifyPkgEntries(table.entries)
  const pjEntry = table.entries.find((e) => /(^|\/)project\.json$/i.test(String(e.path || '')))
  const project = pjEntry ? readPkgEntryHeadJson(file, table.dataStart, pjEntry) : null
  return {
    name, size, tableOk: true, tableReason: null, tableComplete: true,
    magic: table.magic, dataStart: table.dataStart, entries: table.entries.length, kind: sig.kind, signals: sig,
    entryNames: table.entries.slice(0, 40).map((e) => String(e.path)),
    project: project ? {
      title: project.title == null ? null : String(project.title),
      type: project.type == null ? null : String(project.type),
      file: project.file == null ? null : String(project.file),
      preview: project.preview == null ? null : String(project.preview),
      workshopid: project.workshopid == null ? null : String(project.workshopid),
    } : null,
    previewInContainer: sig.preview,
  }
}
/** 容器内**未压缩**条目的字节（只读该条目那一段，**上限 2MB**）：解不开/太大/越界 ⇒ null。 */
function readPkgEntryBytesBounded(file, table, entry, cap) {
  const max = cap || 2 * 1024 * 1024
  if (!entry || !(entry.length > 0) || entry.length > max) return null
  let fd = null
  try { fd = fs.openSync(file, 'r') } catch { return null }
  try {
    const buf = Buffer.allocUnsafe(entry.length)
    let got = 0
    const at = table.dataStart + entry.offset
    while (got < entry.length) { const r = fs.readSync(fd, buf, got, entry.length - got, at + got); if (r <= 0) break; got += r }
    return got === entry.length ? buf : null
  } catch { return null } finally { try { fs.closeSync(fd) } catch { /* 已关 */ } }
}
/** 图像魔数校验（容器里可能是 LZ4 压缩条目 ⇒ 头几个字节不是图像就**不当图用**）。 */
function imageMagicMime(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  return null
}
/** 容器内预览图（只在**未压缩**且魔数对得上时才回；否则 null + 理由）。 */
function containerPreviewBytes(file, containerFile) {
  const table = readPkgTableHead(file)
  if (!table.ok) return { ok: false, reason: `容器目录表读不出来：${table.reason}` }
  const want = PREVIEW_CANDIDATES.map((c) => c.toLowerCase())
  const entry = table.entries.find((e) => want.includes(String(e.path || '').toLowerCase())) ||
    table.entries.find((e) => /(^|\/)preview\.(gif|png|jpe?g|webp|bmp|avif)$/i.test(String(e.path || '')))
  if (!entry) return { ok: false, reason: '容器里没有 preview.*' }
  const buf = readPkgEntryBytesBounded(file, table, entry, 2 * 1024 * 1024)
  if (!buf) return { ok: false, reason: `容器内 ${entry.path} 读不出来或超过 2MB 上限（可能是压缩条目）`, entry: String(entry.path) }
  const mime = imageMagicMime(buf)
  if (!mime) return { ok: false, reason: `容器内 ${entry.path} 不是图像字节（很可能是 LZ4 压缩条目，本服务不解压）`, entry: String(entry.path) }
  return { ok: true, buf, mime, entry: String(entry.path), bytes: buf.length, container: containerFile }
}
// ── 目录信号（全类型）────────────────────────────────────────────────────────────────────────────
/** 一个壁纸目录的**内容信号**：scene 容器 / 网页入口 / 视频 / mpkg 容器 / 预览图 / project.json。 */
function dirSignals(dir, project, budget) {
  const names = listDirNames(dir, 4000)
  if (budget) budget.op()
  const declaredFile = project && typeof project.file === 'string' ? project.file.replace(/^\.\//, '') : ''
  // ① scene 容器：优先 project.json 声明的 file（存在才算），再走白名单路径
  let scene = null
  if (declaredFile && /^(scene\.pkg|scenes\/scene\.pkg|gifscene\.pkg)$/i.test(declaredFile)) {
    if (budget) budget.op()
    const st = statSafe(path.join(dir, declaredFile))
    if (st && st.isFile()) scene = declaredFile
  }
  if (!scene) scene = pickExisting(dir, SCENE_CANDIDATES, budget)
  // ② 网页入口：同样先认声明（存在才算），再走白名单
  let html = null
  if (declaredFile && /\.(html?|xhtml)$/i.test(declaredFile)) {
    if (budget) budget.op()
    const st = statSafe(path.join(dir, declaredFile))
    if (st && st.isFile()) html = declaredFile
  }
  if (!html) html = pickExisting(dir, HTML_ENTRY_CANDIDATES, budget)
  // ③ 视频：先认声明，再按"体积最大"挑（插件同序：大文件更可能是正片而不是彩蛋）
  const videoNames = names.filter((n) => VIDEO_EXT_RE.test(n)).slice(0, 24)
  let video = null
  if (declaredFile && VIDEO_EXT_RE.test(declaredFile)) {
    if (budget) budget.op()
    const st = statSafe(path.join(dir, declaredFile))
    if (st && st.isFile()) video = declaredFile
  }
  if (!video && videoNames.length) {
    let best = null
    for (const n of videoNames) {
      if (budget && !budget.op()) break
      const st = statSafe(path.join(dir, n))
      if (!st || !st.isFile()) continue
      if (!best || st.size > best.size) best = { name: n, size: st.size }
    }
    video = best ? best.name : null
  }
  // ④ mpkg/pk 容器（顶层，单层；容器内类型只读目录表判定）
  const mpkgNames = names.filter((n) => MPKG_COLLECTION_RE.test(n)).slice(0, 12)   // 合集容器只认 .mpkg
  const pkgNames = names.filter((n) => PKG_ONLY_RE.test(n) && !MPKG_COLLECTION_RE.test(n)).slice(0, 12)
  const containers = mpkgNames.map((n) => { if (budget) budget.op(); return mpkgSummary(path.join(dir, n), n) })
  // ⑤ 预览图：先认声明（**允许子目录相对路径**：`assets/preview.jpg` 这类真实存在），再走候选名
  let preview = null
  let previewSource = 'none'
  if (project && typeof project.preview === 'string' && project.preview) {
    const rel = project.preview.replace(/^\.\//, '')
    if (!rel.includes('..') && !path.isAbsolute(rel)) {
      if (budget) budget.op()
      const st = statSafe(path.join(dir, rel))
      if (st && st.isFile()) { preview = rel; previewSource = 'declared' }
    }
  }
  if (!preview) {
    const hit = PREVIEW_CANDIDATES.map((c) => names.find((n) => n.toLowerCase() === c)).find(Boolean) || null
    if (hit) { preview = hit; previewSource = 'fallback' }
  }
  const subdirs = names.filter((n) => { if (budget && !budget.op()) return false; const st = statSafe(path.join(dir, n)); return !!(st && st.isDirectory()) })
  return {
    names, declaredFile, scene, html, video, preview, previewSource,
    containers, mpkgNames, pkgNames, subdirs, videoNames,
    audio: names.filter((n) => /\.(mp3|ogg|wav|m4a|flac|opus)$/i.test(n)).length,
    project: !!project,
  }
}
/** 类型判定（内容优先，声明只作线索）—— 顺序与插件 detectWebWallpaperKind 对齐。 */
function decideKind(lower, sig) {
  const c = sig.containers.find((x) => x.tableOk && x.kind !== 'unknown') || null
  if (sig.scene) return { kind: 'scene', kindSource: 'content', reason: 'scene-container' }
  if ((lower === 'video' || lower === 'gif') && sig.video) return { kind: 'video', kindSource: 'declared', reason: 'declared-video' }
  if (sig.html) return { kind: 'web', kindSource: 'content', reason: c && lower === 'web' ? 'declared-html' : 'html-entry' }
  if (sig.video) return { kind: 'video', kindSource: 'content', reason: 'video-file' }
  if (sig.containers.length) return { kind: 'mpkg', kindSource: 'content', reason: c ? 'mpkg-container' : 'mpkg-container-unparsed' }
  if (lower === 'scene') return { kind: 'scene', kindSource: 'declared', reason: 'declared-scene-no-container' }
  if (lower === 'web') return { kind: 'web', kindSource: 'declared', reason: 'declared-web-no-entry' }
  if (lower === 'video' || lower === 'gif') return { kind: 'video', kindSource: 'declared', reason: 'declared-video-no-file' }
  return { kind: 'unknown', kindSource: 'none', reason: 'no-entry-signal' }
}
/** 未知条目：给一层"子目录里像不像壁纸"的提示（**只做提示**，不影响 kind 判定）。 */
function probeSubdirHints(dir, subdirs, budget) {
  let withSignals = 0
  const sample = []
  for (const n of subdirs.slice(0, 24)) {
    if (budget && !budget.op()) break
    const sub = path.join(dir, n)
    const hit = pickExisting(sub, SCENE_CANDIDATES, budget) || pickExisting(sub, HTML_ENTRY_CANDIDATES, budget) ||
      pickFirstFile(sub, [(x) => VIDEO_EXT_RE.test(x), (x) => MPKG_COLLECTION_RE.test(x)], 200)
    if (hit) { withSignals++; if (sample.length < 5) sample.push(n) }
  }
  return { subdirs: subdirs.length, subdirsWithSignals: withSignals, sample }
}
/** 一个库项 → 调用方要的形状（证据：bundle 的 `rt()`/`wt()`/列表渲染 + patch 的 `brandingForItemId()`）。
 *  ⚠ 老字段（itemId/dir/title/type/hasScene/file/preview/scenePkg/properties/kind/workshopid）语义**不变**
 *  （`type` 仍是 project.json 的原始声明值），新能力一律**加字段**：`kind` 改为内容优先判定，
 *  并补 `kindSource/kindReason/signals/entryFile/container/...`。 */
function libraryItemFromDir(id, dir, budget) {
  const projectRaw = readProjectJson(dir)                     // null = 这个目录**没有** project.json
  const project = projectRaw || {}
  const lower = String(project.type == null ? '' : project.type).trim().toLowerCase()
  const sig = dirSignals(dir, projectRaw, budget)
  const decided = decideKind(lower, sig)
  const container = sig.containers[0] || null
  const isContainerItem = decided.kind === 'mpkg'
  const containerPreview = isContainerItem && container && container.tableOk && container.previewInContainer
    ? { container: container.name, entry: container.previewInContainer }
    : null
  const entryFile = sig.scene || sig.html || sig.video || (isContainerItem ? container.name : null) ||
    (sig.declaredFile && !sig.declaredFile.includes('..') && !path.isAbsolute(sig.declaredFile) ? sig.declaredFile : null)
  const file = (() => {
    if (typeof project.file === 'string' && project.file) return project.file     // 声明优先（老契约逐字保留）
    if (sig.scene) return sig.scene
    if (sig.html) return sig.html
    if (sig.video) return sig.video
    if (isContainerItem) return container.name
    return null
  })()
  const typeRaw = String(project.type == null ? '' : project.type).trim()
  const type = typeRaw || (sig.scene ? 'scene' : sig.html ? 'web' : sig.video ? 'video' : isContainerItem ? 'mpkg' : 'unknown')
  const hasScene = !!sig.scene
  const renderable = (decided.kind === 'scene' && !!sig.scene) || (decided.kind === 'web' && !!sig.html) || (decided.kind === 'video' && !!sig.video)
  const renderReason = renderable ? null
    : isContainerItem ? 'mpkg 容器：网页渲染器读不了容器内条目（服务端只做类型判定；解包用 server/pack-dir.mjs / 插件侧 pkg-extract）'
      : decided.kind === 'unknown' ? '没有识别到壁纸入口（scene 容器 / 网页入口 / 视频 / mpkg 容器）'
        : `${decided.kind} 已声明但入口文件缺失（${decided.reason}）`
  const hint = (decided.kind === 'unknown' && sig.subdirs.length) ? probeSubdirHints(dir, sig.subdirs, budget) : null
  const preview = sig.preview
  const previewUrl = preview ? `/media/dev/${encodeURIComponent(id)}/${preview.split('/').map(encodeURIComponent).join('/')}` : null
  const ffmpegReady = !!findFfmpeg()
  const thumbUrl = previewUrl
    || (containerPreview ? `/api/thumb?item=${encodeURIComponent(id)}` : null)
    || (decided.kind === 'video' && sig.video && ffmpegReady ? `/api/thumb?item=${encodeURIComponent(id)}` : null)
  return {
    itemId: id,
    dir: id,                                    // 相对库根（不把绝对路径塞满列表；`/api/library` 的 `dir` 字段才是绝对根）
    title: String(project.title == null ? '' : project.title).trim() || (container && container.project && container.project.title) || id,
    type,
    hasScene,
    file,
    preview,
    scenePkg: sig.scene,                         // 命中哪一个（`scene.pkg` / `scenes/scene.pkg` / `gifscene.pkg`）
    // ⚠ patch 的 `propertiesForItemId()` 直接把这一项交给 `dragPropsToDisable()`（读 `v.type` / `v.text`）
    //   ⇒ 这里给的是 project.json 里的**原始 map**（不是 /api/props 的描述子数组）
    properties: (project.general && project.general.properties && typeof project.general.properties === 'object') ? project.general.properties : null,
    kind: decided.kind,                          // 内容优先的全类型判定：scene | video | web | mpkg | unknown
    workshopid: project.workshopid == null ? null : String(project.workshopid),
    // ── 新字段（全类型扫描的"证据面"；前端可以不读，但不必猜）──
    kindSource: decided.kindSource,              // content | declared | none
    kindReason: decided.reason,
    declaredType: typeRaw || null,
    mismatch: !!typeRaw && typeRaw.toLowerCase() !== decided.kind && !(typeRaw.toLowerCase() === 'gif' && decided.kind === 'video'),
    entryFile,
    entryExists: !!entryFile && !!statSafe(path.join(dir, entryFile)) && (statSafe(path.join(dir, entryFile)) || {}).isFile() === true,
    renderable,
    renderReason,
    hasHtml: !!sig.html,
    hasVideo: !!sig.video,
    hasPreview: !!preview,
    hasProject: !!sig.project,
    previewSource: sig.previewSource,            // declared | fallback | none
    previewUrl,
    thumbUrl,
    thumbReason: thumbUrl ? null : (isContainerItem ? 'mpkg 容器里没有可直出的 preview.*（或它是压缩条目）' : '库里没有 preview.* 且该档不是视频（无法抽帧）'),
    signals: {
      scene: sig.scene, sceneJson: null, html: sig.html, video: sig.video, videoCount: sig.videoNames.length,
      mpkg: sig.mpkgNames.length ? sig.mpkgNames : null, preview: sig.preview, previewSource: sig.previewSource,
      project: !!sig.project, audio: sig.audio, subdirs: sig.subdirs.length,
    },
    container: isContainerItem,
    containerKind: isContainerItem ? (container.kind || 'unknown') : null,
    containerEntry: isContainerItem && container.signals ? (container.signals.scene || container.signals.html || container.signals.video || null) : null,
    mpkgFiles: sig.containers.map((c) => ({ name: c.name, size: c.size, tableOk: c.tableOk, tableReason: c.tableReason, entries: c.entries, kind: c.kind, previewInContainer: c.previewInContainer })),
    containerPreview,
    probe: hint,
  }
}
function libraryItem(id, budget) {
  const dir = itemDirReal(id)
  const st = statSafe(dir)
  if (!st || !st.isDirectory()) return null
  const real = realpathDeepest(dir)
  if (!isInside(activeRoot, real)) throw forbidden(`条目经符号链接越出库根：${id}`)
  return libraryItemFromDir(id, dir, budget)
}
/* ── ③(2026-09-24) **文件型库项**：一个 `.mpkg` 文件 = 一个一等条目 ────────────────────────────────
   为什么必须逐文件成项：项目所有者真实用法下的读数（改前，库根 = wallpaperE）——
   `GET /api/library` ⇒ **items=20**（= 20 个**角色目录**），每条的 `file` = 该目录里**第一个** `.mpkg`；
   用户看到的 20 条背后是 148 个 `.mpkg`（`PKGM0014`×143 / `PKGM0018`×5，全部含 `preview.*`）
   ⇒ "好多壁纸都是启动失败 / PKG HTTP404"的**前一半根因**就是"它们在列表里根本不存在"。
   口径（逐字段与 `libraryItemFromDir` 对照，前端可以只认老字段）：
     · `itemId`  = **相对库根的嵌套路径** `<目录>/<文件名>`（路由侧仍走同一套 `safeJoin` 校验）；
     · `file`    = 文件名本身（不再借道"目录那一条"的 `file`）；
     · `type`/`kind` = **容器内条目判定**：`scene.json` ⇒ `scene`、视频 ⇒ `video`、`index.html` ⇒ `web`、
       只有嵌套 `.pkg` ⇒ `scene`（容器套容器）、都没有 ⇒ `unknown`。声明（容器内 project.json）只作线索；
     · `hasScene` = 该容器**能按场景挂载**（= 有 `scene.json`）。产物页 `wt()` 用 `hasScene ? 'scene' : type`
       选 `?type=`，而 `demo.html` 的场景路只认 `scene.json` ⇒ 这个布尔必须与"渲染器真的能吃"一致；
     · `preview` **恒为 null**：容器里的 `preview.*` **不是磁盘上的同级文件**，
       给 `/media/dev/<itemId>/<preview>` 会 404 ⇒ 缩略图统一走 `thumbUrl = /api/thumb?item=<嵌套 id>`
       （服务端只读容器内**未压缩**的 `preview.*` 那一段字节）；`previewInContainer` 另字段如实给出；
     · `renderable` = 渲染器页真能吃（scene/video/web 三档）；"只有 scene.pkg 没有 scene.json"的容器
       **标 false 并给理由**（不是静默失败，也不是假装能渲染）。 */
function libraryItemFromFile(id, loc) {
  const base = loc.base
  const parentDir = path.dirname(id)
  const isContainer = MPKG_EXT_RE.test(base)
  const isVideo = VIDEO_EXT_RE.test(base)
  const sum = isContainer ? mpkgSummary(loc.abs, base) : null
  const sig = sum && sum.signals ? sum.signals : null
  const ckind = isContainer ? containerKindOf(sum) : null
  const kind = isContainer ? ckind : (isVideo ? 'video' : 'unknown')
  const entry = sig ? (sig.scene || sig.html || sig.video || null) : null
  const previewInContainer = sum && sum.previewInContainer ? sum.previewInContainer : null
  /* `renderable` 的判据 = **渲染器页真能吃**（不是"类型看起来像"），三档各有依据：
       · 容器里有 `scene.json` ⇒ 走场景路（`demo.html` 取包 → `lib.getEntry(pkg,'scene.json')`）；
       · 容器里**没有** `scene.json` 但有视频 ⇒ 走"纯视频壁纸"路（`demo.html` 的 MPW-NOSCENE 分支）；
       · 容器里**只有** `index.html` ⇒ **不可渲染**：网页档要磁盘上的入口 URL（`/web/dev/<id>/index.html`），
         容器内条目取不到（那要解包）—— 如实标 false，不假装能挂；
       · 松散视频文件（非容器）⇒ 可渲染（`/media/dev/**` + `/ddvideo/**` 直出）。 */
  const hasSceneJson = !!(sig && sig.sceneJson)
  const videoOnly = !!(sig && !sig.sceneJson && sig.video)
  const renderable = isContainer ? (hasSceneJson || videoOnly) : isVideo
  const renderReason = renderable ? null
    : isContainer
      ? (sig && sig.scenePkg
        ? '容器里只有 scene.pkg（没有 scene.json）：渲染器页的场景路只认 scene.json ⇒ 这种包要走解包/插件路径'
        : sig && sig.html
          ? '容器里只有网页入口（index.html）：渲染器页的 web 档要磁盘上的入口 URL（/web/dev/<id>/index.html），容器内条目取不到 ⇒ 要走解包路径'
          : '容器里没有 scene.json / 视频 / 网页入口（只读目录表可见的条目：' + ((sum && sum.entryNames) || []).slice(0, 6).join(', ') + '）')
      : `不支持的文件型条目（${base}）`
  const thumbUrl = (isContainer && previewInContainer) || isVideo ? `/api/thumb?item=${encodeURIComponent(id)}` : null
  const thumbReason = thumbUrl ? null
    : isContainer
      ? (sum && !sum.tableOk
        ? `容器目录表读不出来：${sum.tableReason}`
        : '容器里没有可直出的 preview.*（或它是压缩条目）')
      : '该文件既不是容器也不是视频（无法出图）'
  const declaredType = sum && sum.project && sum.project.type ? String(sum.project.type) : null
  return {
    itemId: id,
    dir: parentDir === '.' ? '' : parentDir,     // 所在目录（相对库根）；`/api/library` 顶层的 `dir` 字段才是绝对根
    title: (sum && sum.project && sum.project.title) || base,
    type: kind,
    hasScene: kind === 'scene',                  // ③"能不能按场景挂载"（= 容器里有 scene.json）
    file: base,
    preview: null,                               // ③容器内预览不是磁盘文件（见上）
    scenePkg: null,                              // 没有磁盘上的 scene.pkg（容器内的另用 containerEntry 给）
    properties: null,                            // 属性表在容器里（GET /api/props 按需读，不塞进列表）
    kind,
    workshopid: (sum && sum.project && sum.project.workshopid) || null,
    kindSource: 'content',
    kindReason: isContainer ? ('container-entry:' + (sig && sig.sceneJson ? 'scene.json' : (entry || 'none'))) : 'video-file',
    declaredType,
    mismatch: !!declaredType && declaredType.toLowerCase() !== kind && !(declaredType.toLowerCase() === 'gif' && kind === 'video'),
    entryFile: base,
    entryExists: true,                           // 文件就在这儿（`/api/library` 里不存在"声明了但缺失"这一档）
    renderable,
    renderReason,
    hasHtml: kind === 'web',
    hasVideo: isVideo || !!(sig && sig.video),
    hasPreview: !!previewInContainer,
    hasProject: !!(sum && sum.project),    previewSource: 'none',
    previewUrl: null,
    thumbUrl,
    thumbReason,
    signals: {
      scene: null, sceneJson: !!(sig && sig.sceneJson), html: sig ? sig.html : null,
      video: sig ? sig.video : (isVideo ? base : null), videoCount: sig && sig.video ? 1 : (isVideo ? 1 : 0),
      mpkg: [base], preview: previewInContainer, previewSource: 'none',
      project: !!(sum && sum.project), audio: 0, subdirs: 0,
    },
    container: isContainer,
    containerKind: ckind,
    containerEntry: entry,
    mpkgFiles: isContainer
      ? [{ name: base, size: sum.size, tableOk: sum.tableOk, tableReason: sum.tableReason, entries: sum.entries, kind: sum.kind, previewInContainer }]
      : [],
    containerPreview: previewInContainer ? { container: base, entry: previewInContainer } : null,
    probe: null,
    /* 新字段（本轮新增，老消费方可以不读）：本条是**文件型**条目，以及它在库根里的层级。 */
    itemRole: 'file',
    parentDir: parentDir === '.' ? '' : parentDir,
    containerMagic: (sum && sum.magic) || null,
    containerEntries: (sum && sum.entries) || 0,
  }
}
/** 容器摘要 → 条目类型（**内容优先**；`sceneJson` 与 `scenePkg` 分开看，理由见 `classifyPkgEntries`）。 */
function containerKindOf(sum) {
  const s = sum && sum.signals
  if (!s) return 'unknown'
  if (s.sceneJson) return 'scene'          // 渲染器页的场景路（首选）
  if (s.video) return 'video'              // 纯视频壁纸（demo.html 的"没有 scene.json"那一档）
  if (s.html) return 'web'
  if (s.scenePkg || s.scene) return 'scene'  // 容器套容器（PKGV 在内层）：标 scene 但 `renderable=false`
  return 'unknown'
}
/** 一个库项目录 → **该目录产出的条目列表**（③ 本轮唯一的口径变化，必须讲清"避免重复计数"）：
 *  ① 目录顶层有 `.mpkg` ⇒ **逐文件成项**：每个 `.mpkg` 一条（嵌套 itemId）；
 *     并且**同一个目录里的视频文件也各成一条**（实测语料：`伊蕾娜/` = 5 `.mpkg` + 1 `.mp4`，
 *     `流萤/` = 4 `.mpkg` + 1 `.mp4`）—— 否则"换个目录就少几张壁纸"，还是同一类毛病；
 *  ② 逐文件成项的目录**不再产出"目录那一条"**：目录条与文件条是**同一批壁纸的两种表示**，
 *     两条都给就是重复计数（用户会看到 148 条文件 + 20 条目录 = 168，而库里其实只有 148 张）；
 *  ③ 目录顶层**没有** `.mpkg` ⇒ 维持旧口径：目录本身一条 —— `dd/<id>/scene.pkg`、网页档、视频档
 *     （目录里只有一个 mp4）、空目录、`<目录>/<子目录>` 这些**逐字不变**（回归读数：dd = 22 条）；
 *  ④ 一个 `.mpkg` 都没 stat 成功（权限/断链）⇒ 退回目录那一条并在 `scan.skippedList` 留痕，不静默丢。
 *  ⚠ 有意取舍（写下来，不藏着）：**同时**含 `.mpkg` 与 `index.html` 的目录，网页入口不会单独成条
 *   （`/web/dev/<目录>/index.html` 仍可直取）；实测 148 个容器的所在目录里没有一个含 `index.html`。 */
function libraryEntriesForDir(id, dir, budget) {
  const names = listDirNames(dir, 4000)
  if (budget) budget.op()
  const mpkgNames = names.filter((n) => MPKG_COLLECTION_RE.test(n))
  if (!mpkgNames.length) return [libraryItemFromDir(id, dir, budget)]
  const out = []
  const failed = []
  const add = (n, wantRe) => {
    if (!wantRe.test(n)) return
    if (budget && !budget.op()) return
    const abs = path.join(dir, n)
    const st = statSafe(abs)
    if (!st || !st.isFile()) { failed.push({ name: n, reason: 'stat 失败或不是普通文件' }); return }
    /* ③真身必须在库根内：**跟着软链走**的 `.mpkg` 不许成条 —— 否则"列表里看得见、取不到"
       （路由侧 `itemLocate()` 会 403）本身就不一致，而且会把库外文件的 title/size 泄进列表。 */
    const real = realpathDeepest(abs)
    if (!isInside(activeRoot, real)) { failed.push({ name: n, reason: '经符号链接越出库根' }); return }
    out.push(libraryItemFromFile(id + '/' + n, { id: id + '/' + n, abs, real, isDir: false, isFile: true, dir, base: n, st }))
  }
  for (const n of mpkgNames.slice(0, LIMITS.mpkgPerDir)) add(n, MPKG_COLLECTION_RE)
  for (const n of names.filter((x) => VIDEO_EXT_RE.test(x)).slice(0, LIMITS.videoPerDir)) add(n, VIDEO_EXT_RE)
  if (!out.length) return [libraryItemFromDir(id, dir, budget)]      // ④退回目录条（调用方按它自己的口径留痕）
  out.failedFiles = failed
  return out
}
const KINDS = ['scene', 'video', 'web', 'mpkg', 'unknown']
function listLibrary() {
  const t0 = Date.now()
  const budget = makeBudget(LIMITS.scanOps)
  const items = []
  const skipped = []
  const kinds = { scene: 0, video: 0, web: 0, mpkg: 0, unknown: 0 }
  const containerKinds = { scene: 0, video: 0, web: 0, mpkg: 0, unknown: 0 }
  const signals = { withScene: 0, withHtml: 0, withVideo: 0, withMpkg: 0, withPreview: 0, withProject: 0, noPreview: 0, renderable: 0, mismatch: 0 }
  let hiddenDirs = 0, looseFiles = 0, dirCount = 0
  /* ③(2026-09-24) 逐文件成项的记账（"避免重复计数"这条口径的**可核对读数**）：
     `fileItems` + `dirItems` 必须 = `items`；`mpkgFiles` 是"折成了独立条目的 `.mpkg` 个数"。 */
  const perFile = { items: 0, mpkg: 0, video: 0, dirsWithDirItem: 0, failed: 0 }
  const looseMpkg = []
  const loosePkg = []
  const src = librarySource()
  if (!statSafe(activeRoot)) {
    return {
      dir: activeRoot, configuredDir: LIBRARY_ROOT_CONFIG, items: [], count: 0, missing: true,
      error: `壁纸库根不存在或不可读：${activeRoot}`, source: src.source, selected: src.selected,
      scan: { root: activeRoot, exists: false, items: 0, kinds, containerKinds, skipped: 0, durationMs: Date.now() - t0, budgetExceeded: budget.exceeded },
    }
  }
  for (const name of listDirNames(activeRoot)) {
    if (name.startsWith('.')) { hiddenDirs++; continue }
    const full = path.join(activeRoot, name)
    const st = statSafe(full)                     // follow symlink + 真身校验（Dirent.isFile 在本机有误报 ⇒ 一律 statSync）
    if (!st) { skipped.push({ name, reason: 'stat 失败（断链 / 权限不足）' }); continue }
    if (!st.isDirectory()) {
      /* ①(P-261 2026-10-07) **顶层散落的容器/视频也逐文件成项**（此前"列表 = 目录型条目"，
         顶层 `.mpkg` 只进 `scan.looseMpkg` 计数、**不出现在 items 里**）：
         真机复现（库根 = `allwallpaper/1004`，顶层 6 个 `.mpkg`）⇒ `GET /api/library` **items=0**
         —— 用户看到的就是"扫描不到 MPKG 文件"；与 workshop 混合（顶层既有 `<id>/scene.pkg` 目录、
         又有散 `.mpkg`）时更隐蔽：目录照列、容器全丢。
         口径与 `libraryEntriesForDir` 的逐文件成项**逐条对齐**（嵌套 id ⇒ 这里是顶层 ⇒ id = 文件名）：
         真身必须在库根内（跟软链走的不成条）、`itemRole:'file'`、`hasScene`/`renderable` 由容器内容判。
         `looseFiles`/`looseMpkg`/`loosePkg` 的计数语义**不变**（仍是"顶层散文件"的全量读数）。 */
      looseFiles++
      if (MPKG_COLLECTION_RE.test(name) && looseMpkg.length < 20) looseMpkg.push(name)
      if (PKG_ONLY_RE.test(name) && loosePkg.length < 20) loosePkg.push(name)
      const looseRe = MPKG_EXT_RE.test(name) ? MPKG_EXT_RE : (VIDEO_EXT_RE.test(name) ? VIDEO_EXT_RE : null)
      if (looseRe && items.length < LIMITS.listItems) {
        if (!budget.op()) skipped.push({ name, reason: '扫描预算用尽（顶层散文件未成条）' })
        else {
          const real = realpathDeepest(full)
          if (!isInside(activeRoot, real)) skipped.push({ name, reason: '经符号链接越出库根' })
          else {
            let fid = null
            try { fid = assertItemId(name) } catch (e) { skipped.push({ name, reason: `itemId 非法：${e instanceof HttpError ? e.message : String((e && e.message) || e)}` }) }
            if (fid) {
              try {
                const it = libraryItemFromFile(fid, { id: fid, abs: full, real, isDir: false, isFile: true, dir: activeRoot, base: name, st })
                items.push(it)
                perFile.items++
                if (it.container) perFile.mpkg++; else perFile.video++
                kinds[it.kind] = (kinds[it.kind] || 0) + 1
                if (it.container) containerKinds[it.containerKind || 'unknown'] = (containerKinds[it.containerKind || 'unknown'] || 0) + 1
                if (it.hasScene) signals.withScene++
                if (it.hasHtml) signals.withHtml++
                if (it.hasVideo) signals.withVideo++
                if (it.hasPreview) signals.withPreview++; else signals.noPreview++
                if (it.hasProject) signals.withProject++
                if (it.mpkgFiles && it.mpkgFiles.length) signals.withMpkg++
                if (it.mismatch) signals.mismatch++
                if (it.renderable) signals.renderable++
              } catch (e) { skipped.push({ name, reason: e instanceof HttpError ? e.message : String((e && e.message) || e) }) }
            }
          }
        }
      }
      continue
    }
    dirCount++
    if (items.length >= LIMITS.listItems) { skipped.push({ name, reason: `超过 listItems 上限 ${LIMITS.listItems}（截断）` }); continue }
    let id
    try { id = assertItemId(name) } catch (e) { skipped.push({ name, reason: `itemId 非法：${e instanceof HttpError ? e.message : String(e && e.message || e)}` }); continue }
    try {
      /* ③(2026-09-24) 一个**目录**现在可能产出**多条**（目录里有 `.mpkg` ⇒ 逐文件成项，见
         `libraryEntriesForDir` 的口径与"避免重复计数"那三条）。目录里没有 `.mpkg` 时逐字等价旧行为。 */
      const real = realpathDeepest(full)
      if (!isInside(activeRoot, real)) throw forbidden(`条目经符号链接越出库根：${name}`)
      const its = libraryEntriesForDir(id, full, budget)
      for (const f of (its.failedFiles || [])) { skipped.push({ name: id + '/' + f.name, reason: f.reason }); perFile.failed++ }
      for (const it of its) {
        if (items.length >= LIMITS.listItems) { skipped.push({ name: it.itemId, reason: `超过 listItems 上限 ${LIMITS.listItems}（截断）` }); break }
        items.push(it)
        if (it.itemRole === 'file') {
          perFile.items++
          if (it.container) perFile.mpkg++; else perFile.video++
        } else perFile.dirsWithDirItem++
        kinds[it.kind] = (kinds[it.kind] || 0) + 1
        if (it.container) containerKinds[it.containerKind || 'unknown'] = (containerKinds[it.containerKind || 'unknown'] || 0) + 1
        if (it.hasScene) signals.withScene++
        if (it.hasHtml) signals.withHtml++
        if (it.hasVideo) signals.withVideo++
        if (it.hasPreview) signals.withPreview++; else signals.noPreview++
        if (it.hasProject) signals.withProject++
        if (it.mpkgFiles && it.mpkgFiles.length) signals.withMpkg++
        if (it.mismatch) signals.mismatch++
        if (it.renderable) signals.renderable++
      }
    } catch (e) {
      // 越界的符号链接 / 真身逃逸条目：跳过（不是整表报错），但**必须留痕**（`scan.skipped` 里能查到）
      skipped.push({ name, reason: e instanceof HttpError ? e.message : String(e && e.message || e) })
    }
  }
  return {
    dir: activeRoot, configuredDir: LIBRARY_ROOT_CONFIG, items, count: items.length,
    source: src.source, selected: src.selected, explicit: src.explicit, librarySource: src,
    scan: {
      root: activeRoot, exists: true, dirs: dirCount, items: items.length, hiddenDirs, looseFiles,
      looseMpkgFiles: looseMpkg, loosePkgFiles: loosePkg,
      looseFileNote: looseFiles
        ? `${looseFiles} 个顶层文件不在列表里（列表只收**目录型**壁纸条目` +
          (looseMpkg.length ? `；其中 ${looseMpkg.length} 个是 .mpkg/.pkg 容器：容器内类型见 GET /api/mpkg?item=&file= 或 POST /api/dir-pick 的 scan.looseContainers（本服务只读容器目录表，不解包）` : '') + '）'
        : undefined,
      kinds, containerKinds, signals,
      /* ③逐文件成项的记账（"一个 `.mpkg` 一条、目录条不再重复计"这条口径的可核对读数）：
         `fileItems + dirItems === items`，且 `mpkgFiles` = 折成独立条目的 `.mpkg` 个数。 */
      itemRoles: {
        fileItems: perFile.items, dirItems: perFile.dirsWithDirItem,
        mpkgFiles: perFile.mpkg, videoFiles: perFile.video, failedFiles: perFile.failed,
        note: '按内容判定：目录顶层有 .mpkg ⇒ 该目录**逐文件成项**（每个 .mpkg 一条 + 同目录视频各一条），'
          + '不再产出"目录那一条"（两条都给 = 同一批壁纸重复计数）；目录里没有 .mpkg ⇒ 维持"目录一条"的旧口径',
      },
      skipped: skipped.length, skippedList: skipped.slice(0, 20),
      budgetExceeded: budget.exceeded, opsUsed: budget.used, opsLimit: budget.limit,
      durationMs: Date.now() - t0,
      limits: {
        listItems: LIMITS.listItems, scanOps: LIMITS.scanOps,
        projectJsonBytes: LIMITS.projectJsonBytes, pkgTableBytes: LIMITS.pkgTableBytes,
      },
    },
  }
}

// ── /api/props：描述子（形状完全按调用方读的字段）─────────────────────────────────────────────────
/** 从 WE 的 HTML 文案里抽 media（调用方 `St()` 渲染 `{src, href}`；`fn()` 把相对 src 解析成
 *  `${mediaBase}/${itemId}/${src}`）——本服务只**如实搬运**，不做任何下载。 */
function extractMedia(html) {
  const text = String(html || '')
  const out = []
  const imgRe = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let m
  while ((m = imgRe.exec(text))) {
    const src = (m[1] || m[2] || m[3] || '').trim()
    if (!src) continue
    const before = text.slice(0, m.index)
    const lastClose = before.toLowerCase().lastIndexOf('</a>')
    let href = ''
    const aRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
    let am
    while ((am = aRe.exec(before))) {
      if (am.index > lastClose) href = (am[1] || am[2] || am[3] || '').trim()
    }
    out.push(href ? { src, href } : { src })
  }
  return out
}
const HTML_HINT_RE = /^\s*(imgsrc|ahref|hrbig|brahref)/i     // 与调用方 `Be()` 同口径：这种 text 不当标题用
/** WE `general.properties`（**map**）→ 调用方要的**扁平数组**（group 是分隔项，之后的项属于它 —— 调用方自己分组）。 */
function buildProps(dir, overrides) {
  const project = readProjectJson(dir)
  const raw = project && project.general && project.general.properties
  if (!raw || typeof raw !== 'object') return []
  const keys = Object.keys(raw)
  const orderOf = (k, i) => {
    const d = raw[k] || {}
    const o = Number(d.order)
    if (Number.isFinite(o)) return o
    const idx = Number(d.index)
    if (Number.isFinite(idx)) return 100 + idx
    return 1000 + i
  }
  const sorted = keys.map((k, i) => ({ k, o: orderOf(k, i) })).sort((a, b) => (a.o - b.o) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
  const out = []
  for (const { k } of sorted) {
    const d = raw[k] && typeof raw[k] === 'object' ? raw[k] : {}
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, k)
    const def = Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : null
    const desc = {
      name: k,
      text: d.text == null ? '' : String(d.text),
      ptype: d.type == null || d.type === '' ? 'text' : String(d.type),
      value: hasOverride ? overrides[k] : def,
      default: def,
      overridden: hasOverride,
    }
    if (d.condition) desc.condition = String(d.condition)
    const media = extractMedia(desc.text)
    if (media.length) desc.media = media
    for (const f of ['min', 'max', 'precision', 'step']) if (d[f] != null && Number.isFinite(Number(d[f]))) desc[f] = Number(d[f])
    if (Array.isArray(d.options)) desc.options = d.options
    if (d.fileType) desc.fileType = String(d.fileType)
    if (Array.isArray(d.filters)) desc.filters = d.filters
    out.push(desc)
  }
  return out
}
/* ⑥ web 帧存储：读一张 / 列全部（含 mtime，供淘汰按"最旧优先"）。**绝不写进壁纸包**。 */
/* [we-json:strict|host-state] **不是包内/包旁 JSON**：读的是 `<reports>/web-store/<wallId>.json` = **本服务自己**
   在 POST /api/web-store 时写下的宿主自有状态（同一个文件由本文件的写侧 `fs.writeFileSync` 生产）。
   ⇒ 保持严格：宿主设置"读失败 ≠ 没存过"（宽容会把**损坏**糊成"能读"，页面拿到半份 facade 快照却不报错）。 */
function readWebStore(wallId) {
  const id = normalizeWallId(wallId)
  if (!id) return {}
  const file = storePath(WEB_STORE_DIR, id)
  const st = statSafe(file)
  if (!st || !st.isFile()) return {}
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return (j && typeof j === 'object' && j.data && typeof j.data === 'object') ? j.data : {}
  } catch { return {} }
}
function listWebStore() {
  let names = []
  try { names = fs.readdirSync(WEB_STORE_DIR) } catch { return [] }
  const out = []
  for (const n of names) {
    if (!/\.json$/.test(n)) continue
    const id = normalizeWallId(n.replace(/\.json$/, ''))
    if (!id) continue
    const st = statSafe(path.join(WEB_STORE_DIR, n))
    out.push({ id, mtimeMs: st ? st.mtimeMs : 0 })
  }
  return out
}
/** web 帧的 wallId：只吃**相对量**（条目 id + 入口相对路径），不含绝对路径（与插件同形）。 */
const webWallIdFor = (item, rel) => wallIdFor([String(item || ''), String(rel || '').replace(/\\/g, '/')])

// 属性覆盖：落 <reports>/bench-props/<id>.json（**绝不写进壁纸包** —— 库里只有 project.json 是读的）
/* ③(2026-09-24 mpkg 一等项) 覆盖文件名：嵌套 itemId 的 `/` 换 `__`（保证仍落在 `PROPS_DIR` 一层里，
   且单段 itemId 与改动前**逐字相同** —— 老覆盖文件一个都不用迁）。与 `thumbCachePath` 同一套换算。 */
const propsFileFor = (id) => path.join(PROPS_DIR, `${assertItemPath(id).replace(/\//g, '__')}.json`)
/* [we-json:strict|host-state] **不是包内/包旁 JSON**：读的是 `<reports>/bench-props/<id>.json` = **本服务自己**保存的
   用户属性覆盖（同一个文件由下面的 `writeOverrides` 原子落盘）。⇒ 保持严格：宿主状态"读失败 ≠ 没存过"，
   宽容会把**半份/损坏的覆盖**糊成"能读"，于是面板显示的值与用户存下的值悄悄不一致。 */
function readOverrides(id) {
  const p = propsFileFor(id)
  const st = statSafe(p)
  if (!st || !st.isFile()) return {}
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
    const o = j && typeof j === 'object' ? (j.overrides && typeof j.overrides === 'object' ? j.overrides : j) : {}
    const out = {}
    for (const [k, v] of Object.entries(o)) {
      if (typeof k !== 'string' || !PROP_NAME_RE.test(k)) continue
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v
    }
    return out
  } catch { return {} }
}
function writeOverrides(id, overrides) {
  const p = propsFileFor(id)
  mkdirSafe(PROPS_DIR)
  const body = JSON.stringify({ itemId: id, savedAt: new Date().toISOString(), libraryRoot: activeRoot, overrides }, null, 1)
  const tmp = `${p}.tmp-${process.pid}`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, p)     // 原子落盘：半个 JSON 不会留在盘上
  return p
}

// ── /api/delete：默认 dryRun；真删=移进回收站 ─────────────────────────────────────────────────────
function collectPlan(root) {
  const files = []
  let bytes = 0
  const walk = (p) => {
    const st = lstatSafe(p)
    if (!st) return
    if (st.isSymbolicLink()) { files.push({ rel: path.relative(root, p), link: true, size: 0 }); return }
    if (st.isDirectory()) { for (const n of listDirNames(p)) walk(path.join(p, n)); return }
    if (st.isFile()) { files.push({ rel: path.relative(root, p), size: st.size }); bytes += st.size }
  }
  walk(root)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return { files, bytes, count: files.length }
}
function moveToTrash(itemId, fromDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destRoot = path.join(TRASH_ROOT, stamp)
  mkdirSafe(destRoot)
  const to = path.join(destRoot, itemId)
  if (statSafe(to)) throw new HttpError(409, `回收站目标已存在：${to}`)
  try {
    fs.renameSync(fromDir, to)
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      fs.cpSync(fromDir, to, { recursive: true, dereference: false, force: false, errorOnExist: false })
      fs.rmSync(fromDir, { recursive: true, force: true })
    } else throw e
  }
  return { to, trashRoot: destRoot }
}

// ── /api/reveal：先库根校验，再找打开器（找不到 501，绝不成 500）──────────────────────────────────
function isExecutableFile(p) {
  const st = statSafe(p)
  if (!st || !st.isFile()) return false
  try { fs.accessSync(p, fs.constants.X_OK); return true } catch { return false }
}
function whichSync(cmd) {
  if (cmd.includes(path.sep)) return isExecutableFile(path.resolve(cmd)) ? path.resolve(cmd) : null
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue
    const p = path.join(d, cmd)
    if (isExecutableFile(p)) return p
  }
  return null
}
function findOpener() {
  /* ①(2026-09-21 跨平台) 四平台候选：环境覆盖 → Termux → Linux → macOS → Windows。
     Windows 上打开文件夹就是 `explorer <path>`（PATH 里必有；`start` 需要经 cmd，故不选它）。
     只写 termux-open/xdg-open/open 会让 Windows 用户点"打开文件夹"直接 501（`tests/cross-platform-gate-test.mjs` C 段钉住）。 */
  const cands = [OPEN_CMD_ENV, 'termux-open', 'xdg-open', 'open', 'explorer'].filter(Boolean)
  for (const c of cands) { const hit = whichSync(c); if (hit) return { cmd: c, path: hit } }
  return null
}
function spawnDetached(opener, args) {
  return new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    try {
      const child = spawn(opener, args, { detached: true, stdio: 'ignore' })
      child.on('error', (e) => done({ ok: false, code: (e && e.code) || 'SPAWN_ERROR', message: e && e.message }))
      child.unref()
      setTimeout(() => done({ ok: true }), 150)
    } catch (e) {
      done({ ok: false, code: (e && e.code) || 'SPAWN_THROW', message: e && e.message })
    }
  })
}

// ── 目录选择器（服务端**只读**浏览；前端不再需要系统对话框）────────────────────────────────────────
// 与插件 `dsh-mpkg-wallpaper` 的 `/list-dirs` 同形（`dir` + `subdirs` + `home` + `platform`），
// 但多了"上一级 / 计数 / 文件列表 / 浏览根自述"，以及**必须**能进 `<MPW_ROOT>/allwallpaper/**` 这类环境内路径。
/** 文件类型（选择器筛选用；与库扫描同一套扩展名）。 */
function fileKindOf(name) {
  const ext = path.extname(name).toLowerCase()
  if (VIDEO_EXT_RE.test(name)) return 'video'
  if (MPKG_EXT_RE.test(name)) return 'mpkg'
  if (/\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i.test(name)) return 'image'
  if (/\.(mp3|ogg|wav|m4a|flac|opus)$/i.test(name)) return 'audio'
  if (/\.(html?|xhtml)$/i.test(name)) return 'html'
  if (ext === '.json') return 'json'
  if (ext === '.pkg') return 'pkg'
  return 'other'
}
/** 一个子目录"像不像壁纸"的**单层**探测（只用白名单名，不递归）：给选择器标 kind 用。 */
function dirWallpaperSignal(sub, budget) {
  const project = readProjectJson(sub)
  if (budget && !budget.op()) return { signal: null, kind: 'other' }
  const scene = pickExisting(sub, SCENE_CANDIDATES, budget)
  if (scene) return { signal: scene, kind: 'scene' }
  const html = pickExisting(sub, HTML_ENTRY_CANDIDATES, budget)
  if (html) return { signal: html, kind: 'web' }
  const names = listDirNames(sub, 200)
  const video = names.find((x) => VIDEO_EXT_RE.test(x))
  if (video) return { signal: video, kind: 'video' }
  const mpkg = names.find((x) => MPKG_COLLECTION_RE.test(x))
  if (mpkg) return { signal: mpkg, kind: 'mpkg' }
  if (project) return { signal: 'project.json', kind: String(project.type || 'unknown').toLowerCase() === 'web' ? 'web' : String(project.type || '').toLowerCase() === 'video' ? 'video' : 'scene' }
  return { signal: null, kind: 'other' }
}
/** 单层目录清单（**只 readdir/stat**；逃逸的符号链接不列出、断链不列出、隐藏项只计数）。 */
function dirListing(dir, opts) {
  const o = opts || {}
  const st = statSafe(dir)
  if (!st || !st.isDirectory()) throw notFound(`目录不存在或不是目录：${dir}`)
  const real = realpathDeepest(dir)
  const hitRoot = containingBrowseRoot(real)
  if (!hitRoot) throw forbidden(`目录经符号链接越出浏览根：${dir}`)
  /* ②(2026-09-24) 相对路径/`parent` 一律按**这个目录命中的那个允许根**算（多根清单下才不会有 `../../…`）。 */
  const rootReal = hitRoot.path
  const budget = makeBudget(6000)
  const names = listDirNames(dir, LIMITS.dirEntries + LIMITS.browserFiles + 200)
  const dirs = []
  const files = []
  let hidden = 0, linksSkipped = 0, truncated = false
  for (const n of names) {
    if (n.startsWith('.')) { hidden++; continue }
    const sub = path.join(dir, n)
    const s2 = statSafe(sub)                        // follow symlink（断链 ⇒ null）
    if (!s2) { linksSkipped++; continue }
    let r2
    try { r2 = realpathDeepest(sub) } catch { linksSkipped++; continue }
    if (!containingBrowseRoot(r2)) { linksSkipped++; continue }   // 逃逸的符号链接**不列出来**
    if (s2.isDirectory()) {
      if (dirs.length >= LIMITS.dirEntries) { truncated = true; continue }
      const probed = dirWallpaperSignal(sub, budget)
      dirs.push({
        name: n, path: path.relative(rootReal, sub), abs: sub,
        looksLikeWallpaper: probed.kind !== 'other', entryKind: probed.kind, signal: probed.signal,
      })
    } else if (s2.isFile() && o.files !== false) {
      if (files.length >= LIMITS.browserFiles) { truncated = true; continue }
      files.push({ name: n, ext: path.extname(n).toLowerCase(), size: s2.size, kind: fileKindOf(n), abs: sub })
    }
  }
  //  上一级：只在**同一个允许根**里向上（多根清单下不会从库根"上"到别的根去）
  const parent = (() => { const par = path.dirname(dir); return (par !== dir && containingBrowseRoot(par, dir)) ? par : null })()
  const rootInfo = browseRootInfo()
  return {
    dir,
    path: path.relative(rootReal, dir) || '.',
    browseRoot: rootReal, root: rootReal, configuredRoot: rootInfo.configuredRoot, rootFrom: rootInfo.from,
    allowedRoots: BROWSE_ROOTS.slice(),
    parent, atRoot: !parent, insideRoot: true, readOnly: true,
    home: rootInfo.home, platform: rootInfo.platform,
    roots: [{ name: rootInfo.root, path: rootInfo.root, kind: 'browseRoot' }],
    dirs, files, counts: { dirs: dirs.length, files: files.length, hidden, linksSkipped },
    truncated,
    libRoot: { dir: activeRoot, source: librarySource().source, insideThisDir: isInside(dir, activeRoot) || dir === activeRoot },
    pickHint: { commit: 'POST /api/dir-pick {path}（只读校验 + 扫描摘要）', asLibrary: 'POST /api/library-dir {dir:<绝对路径>}（把它设为壁纸库根）' },
  }
}
/** 单条目扫描摘要（选择器"就选这个目录"时给前端的预览：这里到底有没有壁纸）。
 *  除了子目录，还如实报告**顶层散文件**与**顶层 .mpkg 容器**（后者不进列表，但容器里是什么类型要能看见）。 */
function scanDirForPicker(dir, budget) {
  const b = budget || makeBudget(LIMITS.scanOps)
  const names = listDirNames(dir, LIMITS.dirEntries)
  const kinds = { scene: 0, video: 0, web: 0, mpkg: 0, unknown: 0 }
  const sample = []
  const looseContainers = []
  let dirs = 0, looseFiles = 0, unclassified = 0, escaped = 0
  const looseExt = {}
  for (const n of names) {
    if (n.startsWith('.')) continue
    const sub = path.join(dir, n)
    const st = statSafe(sub)
    if (!st) continue
    if (!st.isDirectory()) {
      looseFiles++
      const ext = path.extname(n).toLowerCase() || '(无扩展名)'
      looseExt[ext] = (looseExt[ext] || 0) + 1
      const __isContainer = MPKG_EXT_RE.test(n)
      const __isVideo = VIDEO_EXT_RE.test(n)
      if (__isContainer && looseContainers.length < 12 && b.op()) {   // 散落的 .mpkg/.pkg 都报（真身是容器）
        const sum = mpkgSummary(sub, n)
        looseContainers.push({ name: n, size: sum.size, tableOk: sum.tableOk, tableReason: sum.tableReason, entries: sum.entries, kind: sum.kind, entryNames: sum.entryNames, declared: sum.project })
      }
      /* ①(P-261 2026-10-07) **顶层散落容器/视频也算条目**（与 `listLibrary()` 同口径）：这份摘要是选择器
         对话框上"这个目录里有几张壁纸"的读数 —— 只把它们算进 `looseFiles` 会让对话框说"8 张"，而
         `/api/library` 实际列出 9 张（用户报的"扫描不到 MPKG 文件"就是这个错位的另一面）。
         `looseFiles`/`looseExt`/`looseContainers` 仍是**全量诊断读数**（不缩水），这里只多算 item 计数。 */
      if ((__isContainer || __isVideo) && b.op()) {
        const ck = __isContainer ? containerKindOf(mpkgSummary(sub, n)) : 'video'
        kinds[ck] = (kinds[ck] || 0) + 1
        if (sample.length < 8) sample.push({ itemId: n, kind: ck, type: ck, file: n, preview: null, renderable: true, containerKind: __isContainer ? ck : null })
      }
      continue
    }
    dirs++
    // ⚠ 计数与"样例"是两件事：**每个目录都要计数**（否则 count 会被样例上限截断，看起来像"只有 8 个"），
    //   样例只留前 8 条给前端做预览；预算用尽时**如实**记 unclassified（绝不假装数完了）。
    //   ⚠ 逃逸的符号链接目录**不算**壁纸条目（与 dirListing / libraryItem 同一判据）—— 这里也要查，
    //   否则一个指向库外的软链会被数成"一个 unknown 壁纸"（实测踩到）。
    if (!containingBrowseRoot(realpathDeepest(sub))) { escaped++; continue }
    if (!b.op()) { unclassified++; continue }
    let id = n
    try { id = assertItemId(n) } catch { unclassified++; continue }
    try {
      const it = libraryItemFromDir(id, sub, b)
      kinds[it.kind] = (kinds[it.kind] || 0) + 1
      if (sample.length < 8) sample.push({ itemId: it.itemId, kind: it.kind, type: it.type, file: it.file, preview: it.preview, renderable: it.renderable, containerKind: it.containerKind })
    } catch { escaped++ }        // 逃逸的符号链接条目：不进摘要（如实计数）
  }
  const looseKinds = { scene: 0, video: 0, web: 0, mpkg: 0, unknown: 0 }
  for (const c of looseContainers) looseKinds[c.kind] = (looseKinds[c.kind] || 0) + 1
  return {
    dir, scanned: true, dirs, looseFiles, looseExt, escaped, unclassified,
    count: Object.values(kinds).reduce((a, c) => a + c, 0),
    kinds, sample, looseContainers, looseContainerKinds: looseKinds,
    looseNote: (looseFiles && !looseContainers.length)
      ? `${looseFiles} 个顶层文件不在"壁纸条目"列表里（本服务只把**目录**当条目；散文件如实计数）` : undefined,
    budgetExceeded: b.exceeded,
  }
}
// ── 缩略图（缺什么补什么）：库里现成 preview.* → 视频档用本机 ffmpeg 抽一帧（缓存到 reports）────────
let ffmpegPathCache
function findFfmpeg() {
  if (ffmpegPathCache === undefined) ffmpegPathCache = whichSync('ffmpeg')
  return ffmpegPathCache
}
const THUMB_DIR = path.join(REPORTS_DIR, 'bench-thumbs')
/** ③缩略图缓存名：嵌套 itemId 的 `/` 换成 `__`（单段 itemId 与改动前**逐字相同**）。
 *  为什么不能直接用 itemId 拼：`<角色>/<文件>.mpkg` 会让缓存路径多一层目录（`mkdirSafe(THUMB_DIR)`
 *  只建一层）⇒ ffmpeg/写盘都会失败；也不能用 `path.basename`（`A/1.mpkg` 与 `B/1.mpkg` 会撞名）。 */
function thumbCachePath(item, w) {
  const safe = assertItemPath(item).replace(/\//g, '__')
  return path.join(THUMB_DIR, `${safe}-${w}.jpg`)
}
function runFfmpegFrame(src, out, w) {
  return new Promise((resolve) => {
    const bin = findFfmpeg()
    if (!bin) return resolve({ ok: false, code: 'NO_FFMPEG', message: '本机没有 ffmpeg' })
    let err = ''
    let child
    try {
      child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '3', out], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) { return resolve({ ok: false, code: 'SPAWN_THROW', message: String(e && e.message || e) }) }
    const kill = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已退 */ } }, LIMITS.thumbMs)
    child.stderr.on('data', (c) => { if (err.length < 2000) err += c.toString() })
    child.on('error', (e) => { clearTimeout(kill); resolve({ ok: false, code: (e && e.code) || 'SPAWN_ERROR', message: String(e && e.message || e) }) })
    child.on('close', (code) => {
      clearTimeout(kill)
      const st = statSafe(out)
      if (code === 0 && st && st.isFile() && st.size > 0) return resolve({ ok: true, bytes: st.size })
      try { fs.rmSync(out, { force: true }) } catch { /* 清理失败不致命 */ }
      resolve({ ok: false, code: `EXIT_${code}`, message: err.trim().slice(0, 300) || 'ffmpeg 没有产出帧' })
    })
  })
}
/** 缩略图计划：`file` = 直接回库里的图；`container` = 容器内未压缩 preview.*；`ffmpeg` = 抽帧后回；
 *  `none` = 明确 501（给理由）。
 *  ③(2026-09-24 mpkg 一等项) `item` 现在可能是**目录项**（老口径）或**单文件项**（`<角色>/<x>.mpkg`）：
 *  单文件项走得通的那一档是"容器内**未压缩** preview.*"（`/api/thumb?item=<嵌套 id>`），
 *  这正是产物列表缩略图用的 URL（`preview` 对文件项恒 null，见 `libraryItemFromFile`）。 */
function thumbPlan(item) {
  const loc = itemLocate(item)
  const dir = loc.dir
  const it = loc.isFile ? libraryItemFromFile(loc.id, loc) : libraryItem(item, makeBudget(4000))
  if (!loc.isFile) {
    if (it.preview) {
      const p = path.join(dir, it.preview)
      const pst = statSafe(p)
      if (pst && pst.isFile()) return { kind: 'file', path: p, item: it, from: it.previewSource === 'declared' ? 'declared-preview' : 'preview-file' }
    }
  }
  if (it.containerPreview) {
    const cfile = path.join(dir, it.containerPreview.container)
    const cst = statSafe(cfile)
    if (cst && cst.isFile()) {
      const r = containerPreviewBytes(cfile, it.containerPreview.container)
      if (r.ok) return { kind: 'container', bytes: r.buf, mime: r.mime, entry: r.entry, container: r.container, item: it, from: 'container-preview' }
      // 压缩条目 / 超大 / 读不出来 ⇒ 如实降级（下面的 none 分支会带上这句理由）
      it.containerPreviewReason = r.reason
    }
  }
  if (it.kind === 'video' && it.entryFile) {
    const src = path.join(dir, it.entryFile)
    const sst = statSafe(src)
    if (sst && sst.isFile()) return { kind: 'ffmpeg', src, item: it, from: 'ffmpeg-frame' }
  }
  if (it.container) {
    return {
      kind: 'none', item: it,
      reason: `mpkg 容器条目没有库内预览图（${it.containerPreviewReason || `容器内 ${(it.containerPreview && it.containerPreview.entry) || '没有 preview.*'} 取不到`}）`,
      hint: '本服务只读容器目录表 + 未压缩的 preview.*；压缩条目/其它素材要解包请用插件侧 pkg-extract',
    }
  }
  /* ③非容器/非视频的**散文件**：与改动前同一状态码（以前 `isDirectory()` 不成立就 404 "壁纸不存在"）。 */
  if (loc.isFile) throw notFound(`壁纸不存在：${item}`)
  return { kind: 'none', item: it, reason: `该条目没有 preview.* 且不是视频（kind=${it.kind}）`, hint: '把 preview.gif/jpg/png 放进壁纸目录即可' }
}

// ── 渲染器页反向代理：`/webloader/**` → 上游（默认 http://127.0.0.1:8899）─────────────────────────
/** 逐跳头不该转发（RFC 7230 §6.1）：转发它们会让两端连接语义串味。 */
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'])
/* ⓪③(2026-09-27 P-204 安全审计 F8) **转发到上游前要剥掉的凭据头**。
   改前 `proxyRenderer` 把入站请求头**逐条全量**转给 `RENDERER_UPSTREAM`（只滤逐跳头）⇒ 只要有请求打到
   `/webloader/**`，调用方的 DSH `Cookie`（会话）/`Authorization` 就被送到上游那台机器；
   上游地址是 env 配的（非请求可控），但"配错/上游被换掉"就是一次静默的凭据外带。
   现在默认剥（`MPW_PROXY_FORWARD_AUTH=1` 恢复旧行为）。判据：tests/sec-route-guard-test.mjs。 */
const CREDENTIAL_HEADERS = new Set(['cookie', 'authorization', 'proxy-authorization', 'referer', 'origin'])
export function isCredentialHeader(name) {
  const k = String(name == null ? '' : name).toLowerCase()
  if (CREDENTIAL_HEADERS.has(k)) return true
  if (/^x-.*(token|auth|secret|apikey|api-key|session)/.test(k)) return true
  if (/(^|[-_])(token|secret|apikey|password)$/.test(k)) return true
  return false
}
/** 入站头 → 上游头（纯函数；`opts.forwardAuth=true` 时恢复旧的全量转发口径）。 */
export function filterUpstreamHeaders(headers, opts) {
  const forwardAuth = !!(opts && opts.forwardAuth)
  const out = {}
  for (const [k, v] of Object.entries(headers || {})) {
    const lk = String(k).toLowerCase()
    if (HOP_HEADERS.has(lk)) continue
    if (!forwardAuth && isCredentialHeader(lk)) continue
    out[k] = v
  }
  return out
}
/** ②(2026-09-21 渲染器来源=本仓) 渲染器页**自己的只读路由**（它写在根上，见 §1.1 的同一条事实）。
 *  为什么需要这份名单：`demo.html` 取包用的是**根绝对路径** `/pkg/<id>`（`demo.html:2265`），
 *  挂在 `/webloader/` 下时这个请求会落到本服务根 ⇒ 实测 404、页面日志写 `pkg HTTP 404`、
 *  画布停在 300×150 的空画布（`/webloader/?id=3544152633` 的真机读数）。只代理 `/webloader/**`
 *  不够 ⇒ 把这些**渲染器页自己的**路由按前缀转发到同一上游。
 *  名单为什么是这几个：对 `demo.html` + `elysia/**` 做全量 grep（`'/pkg/`、`'/type/`、`'/ddlist/`、
 *  `'/ddvideo/`、`'/videolib/`、`'/project/`、`'/refrender/`、`'/weassist/`、`` `/noise ``、`'/pkgpath`、
 *  `'/pkgurl`）得到的**穷尽集**，一个不多。
 *  **刻意不在名单里**的（它们必须留在本服务）：`/diag`（诊断流要进测试台自己的环形缓冲，
 *  转走的话测试台的「渲染器诊断」页签就哑了）、`/report`+`/baseline`（本服务自己落盘）、
 *  `/media/dev/**`+`/web/dev/**`（库根只读面 + Range，本服务自己的）、`/api/**`（后端契约）。
 *  静态面**优先**：同名文件真的在 `demo/` 里存在就不代理（本服务是这台机上的权威静态面）。 */
const RENDERER_ROOT_ROUTES = ['/pkg/', '/type/', '/ddlist/', '/ddvideo/', '/videolib/', '/project/', '/refrender/', '/weassist/', '/noise', '/pkgpath', '/pkgurl']
/* ①②(2026-09-24 用户第 5 条) **渲染器面本地直供**：这些是渲染器页自己的路由（渲染器页写在渲染器路由
   空间里的**根**上），`:8902` 现在能自己服务它们 —— 名单 = 「前面那串 id 路由」+「静态资源路由」+「几个精确端点」。
   为什么要单独列：`:8902` 的静态面（`demo/`）挂在 `/`、`/demo/`、`/WEwebLoader/`、`/wallpaper-engine-webgl/`，
   凡是静态面里**真有同名文件**的，仍然由静态面优先（本服务是这台机上的权威静态面）；其余才交给渲染器处理器。
   **刻意不在名单里**的（必须留在本服务自己手里）：`/`（测试台页）、`/api/**`（后端契约）、`/diag`
   （诊断流进本服务的环形缓冲）、`/report`+`/baseline`（本服务落盘）、`/media/**`+`/web/**`（库根只读面 + Range）。 */
const RENDERER_LOCAL_PREFIXES = [
  ...RENDERER_ROOT_ROUTES,
  '/core/', '/shaders/', '/elysia/', '/assets/', '/render/', '/ref/', '/transpiled/', '/shader/',
  '/elysia-video/', '/ext/',
]
const RENDERER_LOCAL_EXACT = new Set([
  '/bundle.js', '/we-scene-bundle.js', '/puppet-skin.js', '/diag-flags.json',
  '/baseline-metrics.mjs', '/attach-transform.mjs', '/web-frame-geometry.mjs', '/web-frame-host.mjs',
  '/we-web-shim.mjs', '/audio-band-array.mjs', '/we-pointer-source.mjs', '/we-particle-pointer.mjs',
  // ②(P-228l 2026-10-05) `./we-animation.mjs`（属性动画运行时）：bundle 的同目录 import ⇒ 浏览器解析成
  //   `/we-animation.mjs`。8902 的渲染器处理器**不在** `core-module-wiring-test` 的三处清单里（那条只查
  //   8899/产物/sw），所以这里必须单独登记 —— 漏了就是 404 + 整条 module 图断掉（本轮实测：页面全黑、
  //   台账空、`__mpwAnims` 不存在）。
  '/we-animation.mjs',
  '/ext', '/noise', '/pkgpath', '/pkgurl', '/pkgdir', '/probe', '/shot',
])
const RENDERER_LOCAL_DIRS = ['web', 'core', 'shaders'].map((d) => path.join(REPO_ROOT, d))
/** 这条路径**本地就能服务**吗（用于"上游配了但连不上"时决定回退本地还是按老口径 502）。
 *  判据刻意保守：只认**明确的渲染器路由**（前缀/精确端点）、渲染器页本身、以及仓库里真实存在的
 *  渲染器静态资源（`web/`、`core/`、`shaders/`、`extensions/`、`assets/`）。
 *  `路径不在名单里` ⇒ 说"本地没有"（例如 `/webloader/anything`）⇒ 保持既有 502 语义。 */
function rendererLocalServes(p) {
  if (p === '/' || p === '/index.html') return true
  if (RENDERER_LOCAL_EXACT.has(p)) return true
  if (RENDERER_LOCAL_PREFIXES.some((pre) => p === pre || p.startsWith(pre))) return true
  const rel = p.replace(/^\/+/, '')
  if (!rel) return false
  for (const dir of [...RENDERER_LOCAL_DIRS, path.join(REPO_ROOT, 'extensions'), path.join(REPO_ROOT, 'assets')]) {
    const st = statSafe(path.join(dir, rel))
    if (st && st.isFile()) return true
  }
  return false
}
/** 把请求交给**同一份**渲染器处理器（本地直供）。`relOverride` = 已经去掉挂载前缀的相对路径。 */
function serveRendererLocal(req, res, url, relOverride, extraHeaders) {
  const rel = (typeof relOverride === 'string') ? relOverride : url.pathname.replace(/^\/webloader\/?/, '')
  const mountPath = '/' + String(rel).replace(/^\/+/, '')
  req.url = mountPath + (url.search || '')
  const head = Object.assign({ 'X-Bench-Served': 'local' }, extraHeaders || {})
  /* 可观测标记：本地直供的渲染器资源一律带 `X-Bench-Served: local`；
     若同时配了（但没用上的）上游，再补 `X-Bench-Upstream: <host:port>`，一眼能看出"上游在但没走它"。 */
  if (RENDERER_UPSTREAM && RENDERER_UPSTREAM.host) head['X-Bench-Upstream'] = RENDERER_UPSTREAM.host + ':' + RENDERER_UPSTREAM.port
  try { for (const [k, v] of Object.entries(head)) if (!res.headersSent) res.setHeader(k, v) } catch { /* 已发头 */ }
  recordDiag(`bench: 渲染器面本地直供 ${req.method} ${mountPath}${url.search || ''}`, 'info', 'renderer-local')
  return rendererRequestHandler(req, res)
}
function proxyRenderer(req, res, url, relOverride) {
  if (!RENDERER_UPSTREAM || RENDERER_UPSTREAM.bad || !RENDERER_UPSTREAM.host) {
    /* 配错/没配 ⇒ 不再 500（那是"必须先起 8899"的旧口径）：本地直供。 */
    return serveRendererLocal(req, res, url, relOverride, { 'X-Bench-Upstream': 'unconfigured' })
  }
  const rel = (typeof relOverride === 'string') ? relOverride : url.pathname.replace(/^\/webloader\/?/, '')
  const targetPath = (RENDERER_UPSTREAM.path ? RENDERER_UPSTREAM.path + '/' : '/') + rel + (url.search || '')
  const headers = filterUpstreamHeaders(req.headers, { forwardAuth: String(process.env.MPW_PROXY_FORWARD_AUTH || '').trim() === '1' })
  headers.host = RENDERER_UPSTREAM.host + ':' + RENDERER_UPSTREAM.port
  const up = httpRequest({
    host: RENDERER_UPSTREAM.host, port: RENDERER_UPSTREAM.port, method: req.method, path: targetPath,
    headers, timeout: 15000,
  }, (upRes) => {
    const out = {}
    for (const [k, v] of Object.entries(upRes.headers)) if (!HOP_HEADERS.has(String(k).toLowerCase())) out[k] = v
    /* ⚠ 响应头只能是 **ASCII**（latin-1）：一开始这里写了个 `→` 箭头，Node 直接
       `ERR_INVALID_CHAR: Invalid character in header content` 抛在异步回调里 ⇒ 连接被掐、curl 只看得到 `000`（实测踩到）。
       头里的说明一律用 ASCII；要给人读的中文说明放**响应体**（走 /__health 的自述）。 */
    out['X-Bench-Proxy'] = 'webloader->' + RENDERER_UPSTREAM.host + ':' + RENDERER_UPSTREAM.port
    out['X-Bench-Served'] = 'upstream'
    out['X-Bench-Upstream'] = RENDERER_UPSTREAM.host + ':' + RENDERER_UPSTREAM.port
    res.writeHead(upRes.statusCode || 502, out)
    upRes.pipe(res)
  })
  up.on('timeout', () => { try { up.destroy(new Error('upstream-timeout')) } catch { /* 已断 */ } })
  const localFallbackOk = (req.method === 'GET' || req.method === 'HEAD') && rendererLocalServes(url.pathname.replace(/^\/webloader\/?/, '/'))
  up.on('error', (e) => {
    if (res.headersSent) { try { res.destroy() } catch { /* 已断 */ } return }
    const code = String((e && e.code) || (e && e.message) || e)
    /* ②(2026-09-24) **上游配了但连不上 ⇒ 回退本地直供**（用户要求："把死端口设成上游，页面仍能完整工作"）。
       只对 GET/HEAD 回退：POST 的 body 已经喂给上游了，回退会拿到半个请求（那种情况保持老口径 502）。
       本地也没有这条路由（`rendererLocalServes` 说不认）⇒ 保持既有 502 + 人读说明（K2d 判据不变）。 */
    if (localFallbackOk) {
      recordDiag(`bench: 渲染器上游不可达（${code}）⇒ 本地直供 ${url.pathname}`, 'info', 'renderer-local')
      return serveRendererLocal(req, res, url, undefined, { 'X-Bench-Upstream-Error': code })
    }
    /* 上游没起来 ⇒ **502 + 人读说明**（不是挂住、也不是 500）：明确告诉调用方"本机 :8899 没在跑"以及怎么办。 */
    json(res, 502, {
      ok: false, error: '渲染器上游不可达：' + code,
      upstream: RENDERER_UPSTREAM.host + ':' + RENDERER_UPSTREAM.port,
      hint: '本服务**默认不需要上游**：不设 MPW_RENDERER_UPSTREAM 时 `/webloader/**` 与渲染器根路由全部本地直供。'
        + '这里出现 502 说明显式配了 MPW_RENDERER_UPSTREAM/MPW_RENDERER_8899 而它连不上，且这条路径本地也没有。',
      fallback: '/wallpaper-engine-webgl/renderer/index.html',
    })
  })
  req.pipe(up)
  return undefined
}
/** 渲染器面入口：**本地优先**（没配上游时就是纯本地；配了就走上游，上游连接失败回退本地）。 */
function serveRenderer(req, res, url, relOverride) {
  if (RENDERER_UPSTREAM && !RENDERER_UPSTREAM.bad && RENDERER_UPSTREAM.host) return proxyRenderer(req, res, url, relOverride)
  return serveRendererLocal(req, res, url, relOverride)
}

// ── 静态面 ──────────────────────────────────────────────────────────────────────────────────────
const MOUNTS = ['/demo', '/WEwebLoader', '/wallpaper-engine-webgl', '']   // `''` = 直接挂根（产物 HTML 是 <base href="./">）
function mapStatic(pathname) {
  for (const m of MOUNTS) {
    if (m === '') continue
    if (pathname === m) return { rel: '', redirect: pathname + '/' }
    if (pathname.startsWith(m + '/')) return { rel: pathname.slice(m.length + 1) }
  }
  return { rel: pathname.replace(/^\/+/, '') }
}
function staticTarget(relPath) {
  const dec = (() => { try { return decodeURIComponent(relPath) } catch { throw bad('URL 解码失败') } })()
  if (dec.includes('\0')) throw bad('路径含 NUL')
  const norm = path.resolve(STATIC_ROOT, dec)
  const real = realpathDeepest(norm)
  const ok = STATIC_ROOTS.some((root) => isInside(root, real))
  if (!ok) throw forbidden(`静态路径越出静态根：/${relPath}`)
  return norm
}
function sendFile(req, res, file, opts) {
  const st = statSafe(file)
  if (!st || !st.isFile()) return false
  const headers = Object.assign({
    'Content-Type': mimeOf(file),
    'Cache-Control': STORE ? 'no-cache' : NO_STORE,
    'Accept-Ranges': 'bytes',
    'X-Bench-Server': 'we-scene-demo-8902',
  }, (opts && opts.headers) || {})
  const range = req.headers.range
  let status = 200
  let start = 0
  let end = st.size - 1
  if (range && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      const hasA = m[1] !== ''
      const hasB = m[2] !== ''
      if (hasA && hasB) { start = Number(m[1]); end = Number(m[2]) }
      else if (hasA) { start = Number(m[1]); end = st.size - 1 }
      else if (hasB) { start = Math.max(0, st.size - Number(m[2])); end = st.size - 1 }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, 'Cache-Control': NO_STORE })
        res.end()
        return true
      }
      end = Math.min(end, st.size - 1)
      status = 206
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
    }
  }
  headers['Content-Length'] = String(end - start + 1)
  res.writeHead(status, headers)
  if (req.method === 'HEAD') { res.end(); return true }
  const stream = fs.createReadStream(file, { start, end })
  stream.on('error', () => { try { res.destroy() } catch { /* 已断开 */ } })
  stream.pipe(res)
  return true
}

// ── 路由 ────────────────────────────────────────────────────────────────────────────────────────
async function handleApi(req, res, url) {
  const p = url.pathname
  const q = url.searchParams

  /* ①(P-350 2026-10-16) GET /api/renderers —— **渲染器适配器的枚举面**（只读、无副作用）。
     为什么要有它：上游渲染器产物已按用户口径移出仓库（`demo/assets/renderer-*.js` 0 份）
     ⇒ "这一档现在能不能用"必须有个**机读**答案，页面/判据/工具不必各自去猜文件在不在。
     契约与注册表在 `core/renderer-adapter.mjs`（零依赖纯模块；本文件只做**枚举与挂载**）。
     外部来源的"配没配"直接照 `MPW_RENDERER_UPSTREAM` / `MPW_RENDERER_8899` 的既有语义读，
     不新增第二套开关。 */
  if (p === '/api/renderers' && (req.method === 'GET' || req.method === 'HEAD')) {
    const report = rendererAdapterReport({
      url: q.get('url') || undefined,
      config: { renderer: q.get('renderer') || undefined, rendererSrc: q.get('rendererSrc') || undefined },
      env: process.env,
      embed: q.get('embed') === '1',
      base: `http://127.0.0.1:${PORT}/`,
    })
    return jsonOk(res, Object.assign({ ok: true }, report))
  }

  // ① GET /api/library —— 列表（只读；带**显式**库来源 + 全类型逐类计数）
  if (p === '/api/library' && (req.method === 'GET' || req.method === 'HEAD')) {
    return jsonOk(res, listLibrary())
  }

  // ①b GET /api/library-source —— 只看库来源状态（选择器/页面据此显示"未选择"，不必先扫全库）
  if (p === '/api/library-source' && (req.method === 'GET' || req.method === 'HEAD')) {
    const src = librarySource()
    return jsonOk(res, {
      library: src, source: src.source, selected: src.selected, explicit: src.explicit, dir: src.dir,
      configuredDir: src.configuredDir, exists: src.exists, readable: src.readable, reason: src.reason,
      picker: Object.assign(browseRootInfo(), {
        routes: {
          list: 'GET /api/dir-list?path=', parent: 'GET /api/dir-parent?path=',
          pick: 'POST /api/dir-pick {path}', commit: 'POST /api/library-dir {dir}',
          compat: 'GET /list-dirs?path=', thumb: 'GET /api/thumb?item=', mpkg: 'GET /api/mpkg?item=&file=',
        },
        systemPickerFallback: 'Android/桌面系统对话框只能由页面自己调（showDirectoryPicker/webkitdirectory）——本服务**不经手**也**替代不了**，只作为兜底',
      }),
    })
  }

  // ①c /api/dir-list · /api/dir-parent · /api/dir-pick —— 服务端只读目录浏览（不需要系统对话框）
  if ((p === '/api/dir-list' || p === '/api/dir-parent') && (req.method === 'GET' || req.method === 'HEAD')) {
    const cur = assertBrowsePath(q.get('path') || '')
    const wantFiles = q.get('files') !== '0'
    if (p === '/api/dir-parent') {
      const par = (() => { const x = path.dirname(cur); return (x !== cur && containingBrowseRoot(x, cur)) ? x : null })()
      const payload = dirListing(par || cur, { files: wantFiles })
      payload.from = cur                      // 从哪个目录上来
      payload.atRoot = !payload.parent        // atRoot = **列出来的这个目录**已在浏览根（与 dirListing 同义）
      payload.moved = par ? 'up' : 'stayed'   // stayed = 已经在根上，没有再上一级
      payload.stayedAtRoot = !par
      return jsonOk(res, Object.assign(payload, { source: librarySource().source }))
    }
    return jsonOk(res, Object.assign(dirListing(cur, { files: wantFiles }), { source: librarySource().source }))
  }
  if (p === '/api/dir-pick') {
    if (req.method !== 'POST') throw new HttpError(405, '只支持 POST')
    const body = await readJsonBody(req, LIMITS.bodyBytes)
    const dir = assertBrowsePath(body.path)
    const st = statSafe(dir)
    if (!st || !st.isDirectory()) throw notFound(`目录不存在或不是目录：${body.path}`)
    const real = realpathDeepest(dir)
    const hitPick = containingBrowseRoot(real)
    if (!hitPick) throw forbidden(`目录经符号链接越出浏览根：${body.path}`)
    recordDiag(`bench: 选择器"就选这个目录" = ${dir}（只读校验；未改任何状态${body.asLibrary ? '；随后设为库根' : ''}）`, 'info', 'dir-pick')
    const out = {
      picked: true, dir, abs: dir, path: path.relative(hitPick.path, dir) || '.',
      browseRoot: hitPick.path, isDirectory: true, readable: dirReadable(dir), readOnly: true,
      scan: body.scan === false ? null : scanDirForPicker(dir),
      asLibrary: !!body.asLibrary,
      libraryBefore: { dir: activeRoot, source: librarySource().source, selected: librarySource().selected },
    }
    if (body.asLibrary) {
      selectRoot(dir, 'pick')
      out.libraryAfter = librarySource()
      out.dir = dir
    }
    return jsonOk(res, out)
  }

  // ①d /api/fs/* —— **前端钉死的契约形状**（环境内目录浏览器）：roots / list / pick
  //     GET  /api/fs/roots ⇒ {ok, roots:[{label,path(绝对),…}]}
  //     GET  /api/fs/list?path=<绝对> ⇒ {ok, path, parent, entries:[{name,type,size,kind}]}
  //     POST /api/fs/pick {path} ⇒ 选为库根并回 {ok, path, source:'user', library}
  //     错误码：400 参数非法 / 403 越界（`..`、绝对跳转、符号链接逃逸）/ 404 不存在；只读。
  if (p === '/api/fs/roots' && (req.method === 'GET' || req.method === 'HEAD')) {
    return jsonOk(res, {
      roots: fsRoots().map((r) => ({ label: r.label, labels: r.labels, path: r.path, kind: r.kind, exists: r.exists, listable: r.listable, reason: r.reason, enableHint: r.enableHint })),
      browseRoot: PICK_ROOT_REAL, browseRootFrom: PICK_ROOT_FROM,
      home: os.homedir() || '/', homeListable: !!containingBrowseRoot(os.homedir() || '/'),
      library: { dir: activeRoot, source: librarySource().source, selected: librarySource().selected },
      note: '只读：本服务不经手系统选择器（Android/桌面对话框只能由页面自己调，且只作兜底）',
    })
  }
  if (p === '/api/fs/list' && (req.method === 'GET' || req.method === 'HEAD')) {
    const raw = q.get('path')
    if (raw != null && raw !== '' && !path.isAbsolute((() => { try { return decodeURIComponent(raw) } catch { return raw } })())) {
      throw bad(`path 必须是绝对路径：${raw}`)
    }
    const dir = assertBrowsePath(raw == null || raw === '' ? '.' : raw)
    const listing = dirListing(dir, { files: q.get('files') !== '0' })
    const entries = [
      ...listing.dirs.map((d) => ({ name: d.name, type: 'dir', size: 0, kind: d.looksLikeWallpaper ? 'wallpaper' : 'other', path: d.abs, entryKind: d.entryKind, signal: d.signal })),
      ...listing.files.map((f) => ({
        name: f.name, type: 'file', size: f.size,
        kind: f.kind === 'video' ? 'video' : (f.kind === 'html' ? 'web' : (f.kind === 'mpkg' || f.kind === 'pkg' ? 'scene' : 'other')),
        path: f.abs, ext: f.ext, container: (f.kind === 'mpkg' || f.kind === 'pkg'),
      })),
    ]
    return jsonOk(res, {
      path: listing.dir, parent: listing.parent, entries, count: entries.length,
      atRoot: listing.atRoot, browseRoot: PICK_ROOT_REAL, roots: fsRoots().map((r) => ({ label: r.label, labels: r.labels, path: r.path, listable: r.listable })),
      counts: listing.counts, truncated: listing.truncated, readOnly: true,
      kindLegend: {
        dir: '"wallpaper" = 目录本身像壁纸（含 scene 容器 / 网页入口 / 视频 / mpkg / project.json）；"other" = 其余（可能还要再进一层）',
        file: '"scene" = .pkg/.mpkg 容器族；"video" = mp4/webm/mov/…；"web" = html；"other" = 其余',
        dirEntryKind: '"scene"|"video"|"web"|"mpkg"|"other" = 目录里命中的**入口类型**（更细的一层）',
      },
    })
  }
  if (p === '/api/fs/pick') {
    if (req.method !== 'POST') throw new HttpError(405, '只支持 POST')
    const body = await readJsonBody(req, LIMITS.bodyBytes)
    const spec = body.path != null ? body.path : q.get('path')
    const dir = assertBrowsePath(spec)
    const st = statSafe(dir)
    if (!st || !st.isDirectory()) throw notFound(`目录不存在或不是目录：${spec}`)
    const hitFsPick = containingBrowseRoot(realpathDeepest(dir))
    if (!hitFsPick) throw forbidden(`目录经符号链接越出浏览根：${spec}`)
    selectRoot(dir, 'pick')
    const src = librarySource()
    recordDiag(`bench: /api/fs/pick 选定库根 ${dir}（source=user）`, 'info', 'fs-pick')
    return jsonOk(res, {
      picked: true, path: dir, dir, source: src.source, selected: src.selected, library: src,
      scan: body.scan === false ? null : scanDirForPicker(dir),
      browseRoot: hitFsPick.path, readOnly: true,
    })
  }
  /* ②b(2026-09-24 用户第 2 条「选择文件为什么不能像选择文件夹一样，选我环境里的文件？」)
     `GET /api/fs/file?path=<绝对路径>` —— **同一个浏览 API/同一棵浏览树**里的**只读**取文件：
     与 `/api/fs/list` 用**同一个** `assertBrowsePath()`（= 同一份允许根清单 + 同一套 `..`/真身校验），
     越界**如实 403**、不存在 404、目录 400、超过单文件上限 413（不截断成"半个包"假装成功）。
     为什么需要它：服务端浏览树能"看见"文件之后，页面必须能把选中文件的**字节**喂给既有的预览链
     （`previewLocal({pkg,proj,…})`）——否则"能选不能用"。支持 Range（大包按需取段）。 */
  if (p === '/api/fs/file' && (req.method === 'GET' || req.method === 'HEAD')) {
    const rawSpec = q.get('path')
    const file = assertBrowsePath(rawSpec == null ? '' : rawSpec)
    const st = statSafe(file)
    if (!st) throw notFound(`文件不存在：${rawSpec}`)
    if (st.isDirectory()) throw bad(`这是目录不是文件（要列目录请用 GET /api/fs/list）：${rawSpec}`)
    if (!st.isFile()) throw bad(`不是普通文件：${rawSpec}`)
    const hitFile = containingBrowseRoot(realpathDeepest(file))
    if (!hitFile) throw forbidden(`文件经符号链接越出浏览根：${rawSpec}`)
    if (st.size > LIMITS.browseReadBytes) {
      throw new HttpError(413, `文件超过单次读取上限 ${LIMITS.browseReadBytes} 字节（${st.size}）：${rawSpec}`)
    }
    /* 大包**不**进内存：sendFile 走 createReadStream + Range。 */
    if (!sendFile(req, res, file, { headers: { 'X-Bench-Served': 'local', 'X-Bench-Browse-Root': hitFile.path } })) {
      throw notFound(`文件不可读：${rawSpec}`)
    }
    return undefined
  }

  // ② /api/library-dir —— 选择库根：{pick:true} 降级；{dir} 收窄/显式选定；GET 枚举子目录
  if (p === '/api/library-dir') {
    if (req.method === 'GET') {
      const dir = safeJoin(LIBRARY_ROOT_REAL, q.get('dir') || '.', 'dir')
      const dirs = []
      for (const n of listDirNames(dir)) {
        if (n.startsWith('.')) continue
        const sub = path.join(dir, n)
        const st = statSafe(sub)
        if (!st || !st.isDirectory()) continue
        if (!isInside(LIBRARY_ROOT_REAL, realpathDeepest(sub))) continue   // 逃逸的符号链接**不列出来**
        dirs.push({ name: n, path: path.relative(LIBRARY_ROOT_REAL, sub), abs: sub })
      }
      return jsonOk(res, {
        dir, root: LIBRARY_ROOT_REAL, activeDir: activeRoot, dirs, count: dirs.length,
        picker: 'server',                                  // 服务端选择器**可用**（见 /api/dir-list）
        browseRoot: PICK_ROOT_REAL,
        routes: { list: 'GET /api/dir-list', parent: 'GET /api/dir-parent', pick: 'POST /api/dir-pick' },
        source: librarySource().source, selected: librarySource().selected,
      })
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req, LIMITS.bodyBytes)
      // 前端契约：`POST /api/library-dir?path=<绝对路径>` 与 `{dir:<绝对路径>}` 等价（两种都收）
      if (!body.dir && q.get('path')) body.dir = q.get('path')
      if (body.pick) {
        // 没有 Electron/宿主对话框 ⇒ 明确降级。**注意 HTTP 码**：调用方是
        //   `if(!e.ok||t.error) throw` … `if(t.cancelled){ if(!t.unsupported) return; window.prompt(...) }`
        //   —— 非 2xx 会**掐掉**它自己的 prompt 回退 ⇒ 这里回 200 + {cancelled:true, unsupported:true, degraded:true}，
        //   并把"能力状态 501"如实写进 body.degradedStatus 与 /__health.degraded[]（不假装成功：cancelled=true）。
        //   ⚠ 系统对话框这条能力**确实**不存在（本服务是 Node 服务，不经手 Android/桌面选择器）；
        //     但页面**不需要**再退到系统对话框：服务端自带只读目录浏览（下面 picker.server 那几条路由）。
        const reason = '本服务没有宿主对话框（不是 Electron/termux 宿主）：无法弹系统"选择文件夹"'
        recordDiag(`bench: 系统"选择文件夹"对话框不可用（能力 501）—— ${reason}；` +
          '页面应改用服务端只读选择器 GET /api/dir-list + POST /api/dir-pick（不要退回系统选择器）', 'info', 'library-dir')
        return jsonOk(res, {
          cancelled: true, unsupported: true, degraded: true, degradedStatus: 501, picker: 'server',
          reason,
          hint: '页面请改用服务端选择器：GET /api/dir-list?path=…（列目录）→ POST /api/dir-pick {path}（就选这个目录）→ POST /api/library-dir {dir}（设为库根）',
          serverPicker: {
            available: true, readOnly: true, browseRoot: PICK_ROOT_REAL,
            list: 'GET /api/dir-list?path=', parent: 'GET /api/dir-parent?path=', pick: 'POST /api/dir-pick',
            commit: 'POST /api/library-dir {dir}', compat: 'GET /list-dirs?path=',
          },
          systemPickerFallback: '仅当页面在无后端（静态托管）或用户坚持时，才由页面自己调 showDirectoryPicker/webkitdirectory（Android 上就是系统选择器）',
          dir: activeRoot, configuredDir: LIBRARY_ROOT_CONFIG,
          source: librarySource().source, selected: librarySource().selected,
        })
      }
      if (body.reset) {
        clearSelection()
        return jsonOk(res, { dir: activeRoot, reset: true, root: LIBRARY_ROOT_REAL, source: librarySource().source, selected: false, library: librarySource() })
      }
      if (typeof body.dir === 'string' && body.dir) {
        // 相对路径：老语义（**库根内**收窄）；绝对路径：新语义（浏览根内任意目录 ⇒ 能选到
        // `<MPW_ROOT>/allwallpaper` 这类库根之外的收藏夹）。两条都过同一套 `..`/真身校验。
        const spec = String(body.dir).trim()
        const absolute = path.isAbsolute(spec)
        // 绝对路径走浏览根（safeJoin 内部已做 `..`/越根/真身三道校验）；
        // 相对路径走**老语义**（配置库根内收窄 —— 库根可能不在浏览根里，故这里不加浏览根判据）。
        const target = absolute ? assertBrowsePath(spec) : safeJoin(LIBRARY_ROOT_REAL, spec, 'dir')
        const st = statSafe(target)
        if (!st || !st.isDirectory()) throw notFound(`目录不存在：${body.dir}`)
        const insideConfigured = isInside(LIBRARY_ROOT_REAL, target)
        selectRoot(target, absolute ? 'absolute' : 'relative')
        recordDiag(`bench: 壁纸库根${insideConfigured ? '收窄' : '**改选**'}到 ${activeRoot}（${absolute ? '绝对路径' : '库根内相对路径'}；source=user）`, 'info', 'library-dir')
        const src = librarySource()
        return jsonOk(res, {
          dir: activeRoot, root: LIBRARY_ROOT_REAL, narrowed: activeRoot !== LIBRARY_ROOT_REAL,
          outsideConfiguredRoot: !insideConfigured, configuredRoot: LIBRARY_ROOT_REAL,
          source: src.source, selected: src.selected, library: src,
        })
      }
      throw bad('需要 {pick:true} / {reset:true} / {dir:"库根内相对路径或浏览根内绝对路径"}')
    }
  }

  // ②b GET /api/thumb —— 缩略图（web/mp4 档都要能出图；缺什么补什么）
  if (p === '/api/thumb' && (req.method === 'GET' || req.method === 'HEAD')) {
    const item = assertItemPath(q.get('item') || '')       // ③嵌套 itemId（`<角色>/<x>.mpkg`）也吃
    const w = Math.max(16, Math.min(LIMITS.thumbPixels, Number(q.get('w')) || 320))
    const plan = thumbPlan(item)
    if (plan.kind === 'file') {
      return sendFile(req, res, plan.path, {
        headers: {
          'X-Bench-Thumb': plan.from, 'X-Bench-Item': encodeURIComponent(item),
          'Cache-Control': STORE ? 'no-cache' : NO_STORE,
        },
      }) ? undefined : (() => { throw notFound(`缩略图不可读：${item}`) })()
    }
    if (plan.kind === 'none') {
      return json(res, 501, {
        ok: false, unsupported: true, degraded: true, itemId: item, kind: plan.item.kind,
        error: `无法为 ${item} 生成缩略图：${plan.reason}`, reason: plan.reason, hint: plan.hint,
      })
    }
    if (plan.kind === 'container') {
      // 容器内**未压缩** preview.*：只回这一段字节（先过图像魔数校验，上限 2MB）
      res.writeHead(200, {
        'Content-Type': plan.mime, 'Content-Length': String(plan.bytes.length),
        'Cache-Control': NO_STORE, 'X-Bench-Server': 'we-scene-demo-8902',
        'X-Bench-Thumb': plan.from, 'X-Bench-Item': encodeURIComponent(item),
        'X-Bench-Container': encodeURIComponent(plan.container), 'X-Bench-Entry': encodeURIComponent(plan.entry),
      })
      if (req.method === 'HEAD') return res.end()
      return res.end(plan.bytes)
    }
    // 视频档：库里没有 preview.* ⇒ 用本机 ffmpeg 抽一帧，缓存到 <reports>/bench-thumbs/<item>-<w>.jpg
    const bin = findFfmpeg()
    if (!bin) {
      return json(res, 501, {
        ok: false, unsupported: true, degraded: true, itemId: item, kind: plan.item.kind,
        error: `无法为 ${item} 生成缩略图：本机没有 ffmpeg（PATH 里找不到）`,
        reason: '视频档没有 preview.* 时必须抽帧；抽帧需要本机 ffmpeg',
        hint: '装 ffmpeg，或把 preview.gif/jpg/png 放进壁纸目录',
      })
    }
    const out = thumbCachePath(item, w)
    const srcSt = statSafe(plan.src)
    const cached = statSafe(out)
    const fresh = cached && cached.isFile() && cached.size > 0 && srcSt && cached.mtimeMs >= srcSt.mtimeMs
    if (!fresh) {
      mkdirSafe(THUMB_DIR)
      const r = await runFfmpegFrame(plan.src, out, w)
      if (!r.ok) {
        return json(res, 501, {
          ok: false, unsupported: true, degraded: true, itemId: item, kind: plan.item.kind,
          error: `ffmpeg 抽帧失败：${r.code} ${r.message || ''}`.trim(),
          reason: '视频档没有 preview.*，抽帧也没成功（如实降级，不假装有图）', ffmpeg: bin,
        })
      }
      recordDiag(`bench: 缩略图抽帧 ${item} ← ${path.basename(plan.src)}（${r.bytes} B → ${out}）`, 'info', 'thumb')
    }
    if (!sendFile(req, res, out, { headers: { 'X-Bench-Thumb': plan.from, 'X-Bench-Item': encodeURIComponent(item), 'Cache-Control': NO_STORE } })) {
      throw notFound(`缩略图生成后不可读：${item}`)
    }
    return undefined
  }

  // ②c GET /api/mpkg —— 只读容器目录表（`.mpkg`/`.pkg` 里到底是 scene / video / web）
  if (p === '/api/mpkg' && (req.method === 'GET' || req.method === 'HEAD')) {
    /* ③(2026-09-24) `item` 两种形态都吃：**目录项**（老口径：目录里挑一个容器，默认第一个）
       与**单文件项**（`.mpkg` 一等项：itemId 就指向那个容器本身）。两条都过 `itemLocate()`
       ⇒ 同一套 `safeJoin`（`..`/越根/真身三道），没有第二条路径判据。 */
    const loc = itemLocate(q.get('item') || '')
    if (loc.isFile && !MPKG_EXT_RE.test(loc.base)) throw notFound(`${loc.id} 不是 .mpkg/.pkg 容器（是散文件）`)
    const want = q.get('file') || ''
    const available = loc.isDir
      ? listDirNames(loc.dir, 400).filter((n) => MPKG_EXT_RE.test(n))   // .mpkg 与 .pkg 都是 PKG 家族，都读表
      : [loc.base]
    const file = want ? assertFileName(want, 'file') : available[0]
    if (!file) throw notFound(`${loc.id} 里没有 .mpkg/.pkg 文件`)
    if (!available.includes(file)) throw notFound(`${loc.id} 里没有这个容器：${file}`)
    const abs = loc.isDir ? path.join(loc.dir, file) : loc.abs
    const absReal = realpathDeepest(abs)
    if (!isInside(activeRoot, absReal)) throw forbidden(`容器经符号链接越出库根：${file}`)
    const sum = mpkgSummary(abs, file)
    return jsonOk(res, {
      itemId: loc.id, file, abs, size: sum.size, magic: sum.magic || null,
      tableOk: sum.tableOk, tableReason: sum.tableReason, entries: sum.entries,
      kind: sum.kind, signals: sum.signals, entryNames: sum.entryNames,
      declared: sum.project, previewInContainer: sum.previewInContainer,
      readOnly: true, note: '只读容器**目录表**（不解包、不解压、不整包读）；条目字节不在本服务职责内',
      available,
    })
  }

  // ⑥(2026-09-23) GET/POST /api/web-store —— web 帧（不透明源）的存储落盘
  //   契约见 docs/WEB-WALLPAPER-MERGE.md §3.5：帧内 facade 每 400ms 推一次快照，首帧由注入的种子回灌。
  //   `text/plain` 简单请求 ⇒ 无预检；wallId 必须受限字符集（拼路径前再校验一次）。
  if (p === '/api/web-store') {
    if (req.method === 'POST') {
      const body = await readJsonBody(req, WEB_STORE_LIMITS.bodyBytes)
      const wallId = normalizeWallId(body.wallId)
      if (!wallId) throw bad('wallId 不合法（只接受 6..32 位字母数字）')
      const prev = readWebStore(wallId)
      const merged = mergeStore(prev, body.data)
      const entries = listWebStore()
      const victims = evictPlan(entries, wallId)
      fs.mkdirSync(WEB_STORE_DIR, { recursive: true })
      const file = storePath(WEB_STORE_DIR, wallId)
      fs.writeFileSync(file, JSON.stringify({ wallId, at: Date.now(), data: merged.data }), 'utf8')
      for (const id of victims) { try { fs.unlinkSync(storePath(WEB_STORE_DIR, id)) } catch { /* 已被删/权限 */ } }
      return jsonOk(res, { ok: true, wallId, keys: Object.keys(merged.data).length, dropped: merged.dropped, truncated: merged.truncated, evicted: victims })
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const wallId = normalizeWallId(q.get('wallId') || '')
      if (!wallId) return jsonOk(res, { ok: true, walls: listWebStore().length, ids: listWebStore().map((e) => e.id) })
      return jsonOk(res, { ok: true, wallId, data: readWebStore(wallId) })
    }
    throw bad('只支持 GET/POST /api/web-store')
  }

  // ③ GET /api/web-probe?item=<id> —— **Web 壁纸挂载前预检**（插件侧 `probeWebWallpaper()` 的消费侧那一半）
  //   判定核心在 `core/web-precheck.mjs`（纯函数，与插件 `docs/WEB-WALLPAPER.md` §3.4 同语义）：
  //   · heavy    = 目录里（递归 ≤3 层）有 Spine/Live2D 骨骼资产；
  //   · external = 入口 HTML（只读前 256 KB）里有外链（排除 localhost / 127.0.0.1 / [::1]）。
  //   为什么放在服务端：库根解析、`..`/符号链接越界校验、文件读取都已有唯一实现，客户端不必再拼路径。
  if (p === '/api/web-probe') {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw bad('只支持 GET /api/web-probe')
    const loc = itemLocate(q.get('item') || '')
    /* 只对 **web** 项做预检：类型由列表同一套判定给出（`libraryItemFromDir`，与 `/api/library` 逐字同源）
       ⇒ 场景/视频项一次早退，不做无谓的目录遍历与入口读取。 */
    let kind = 'unknown'
    try { const d = libraryItemFromDir(loc.id, loc.isDir ? loc.dir : path.dirname(loc.abs), undefined); kind = String((d && d.type) || 'unknown').toLowerCase() } catch (e) { kind = 'unknown' }
    if (kind !== 'web') return jsonOk(res, { item: loc.id, type: kind, probe: null })
    const files = []
    const walk = (dir, depth) => {
      if (depth > WEB_PRECHECK_LIMITS.depth) return
      let ents = []
      try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
      for (const e of ents) {
        const abs = path.join(dir, e.name)
        const relPath = path.relative(loc.dir, abs).split(path.sep).join('/')
        if (e.isDirectory()) { files.push({ name: e.name, path: relPath + '/', depth }); walk(abs, depth + 1) } else if (e.isFile()) {
          let size = 0
          try { size = fs.statSync(abs).size } catch (err) { size = 0 }
          files.push({ name: e.name, path: relPath, depth, size })
        }
      }
    }
    if (loc.isDir) walk(loc.dir, 0)
    else files.push({ name: loc.base, path: loc.base, depth: 0 })
    // 入口：目录里的 index.html（大小写不敏感）；单文件项就是它自己
    let entryRel = loc.isDir ? (files.find((f) => /^index\.html?$/i.test(String(f.name))) || null) : { name: loc.base, path: loc.base }
    let entryHtml = null
    if (entryRel) {
      const absEntry = path.join(loc.dir, entryRel.path)
      try {
        const st = fs.statSync(absEntry)
        const fd = fs.openSync(absEntry, 'r')
        const buf = Buffer.alloc(Math.min(WEB_PRECHECK_LIMITS.bytes, st.size))
        const read = fs.readSync(fd, buf, 0, buf.length, 0)
        fs.closeSync(fd)
        entryHtml = buf.slice(0, read).toString('utf8')
      } catch (e) { entryHtml = null }
    }
    const probe = webPrecheckPlan({ files, entryHtml, entryFile: entryRel ? entryRel.path : null })
    return jsonOk(res, { item: loc.id, type: 'web', probe })
  }

  // ③ GET/POST /api/props —— 读属性表 / 保存覆盖（覆盖落在 reports，**不写进壁纸包**）
  if (p === '/api/props') {
    /* ③(2026-09-24 mpkg 一等项) `item` = 目录项或**单文件项**；属性表一律来自"**条目所在的目录**"里那份
       `project.json`（包旁 JSON，工坊口径）—— 文件项（`.mpkg`）的所在目录就是 `<角色>/`，
       与目录项共用同一份。容器**内**的 project.json 不在本路由职责内（`/api/mpkg` 的 `declared` 给线索）。 */
    const loc = itemLocate(q.get('item') || '')
    const item = loc.id
    const dir = loc.dir
    if (req.method === 'GET' || req.method === 'HEAD') {
      const overrides = readOverrides(item)
      const props = buildProps(dir, overrides)
      return jsonOk(res, {
        item, itemId: item, props, overridden: overrides, propsFile: propsFileFor(item),
        declared: props.length, overriddenCount: Object.keys(overrides).length,
        projectJson: !!readProjectJson(dir),
        itemRole: loc.isFile ? 'file' : 'dir', propsSourceDir: dir,
      })
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req, LIMITS.propsJsonBytes)
      const overrides = {}
      for (const [k, v] of Object.entries(body)) {
        assertPropName(k)
        if (v === null || !['string', 'number', 'boolean'].includes(typeof v)) throw bad(`属性 ${k} 的值只允许 string/number/boolean/null`)
        if (v !== null) overrides[k] = v
      }
      const file = writeOverrides(item, overrides)
      recordDiag(`bench: 属性保存 ${item}（${Object.keys(overrides).length} 项覆盖）→ ${file}`, 'info', 'props')
      return jsonOk(res, { item: item, itemId: item, saved: overrides, count: Object.keys(overrides).length, propsFile: file, wroteIntoWallpaper: false })
    }
  }

  // ④ /api/props-dir —— 目录型属性：{pick:true} 降级；GET 枚举库根内目录；POST {dir} 取绝对目录
  if (p === '/api/props-dir') {
    if (req.method === 'GET') {
      /* ③(2026-09-24) `item` 可为目录项或单文件项：单文件项（`.mpkg`）枚举的是**它所在的目录**
         （目录型属性本来就是"从某个目录里挑一个子目录"，见调用方文案）。 */
      const loc = q.get('item') ? itemLocate(q.get('item')) : null
      const item = loc ? loc.id : null
      const base = loc ? loc.dir : activeRoot
      const st = statSafe(base)
      if (!st || !st.isDirectory()) throw notFound(`目录不存在：${item || activeRoot}`)
      const dir = safeJoin(LIBRARY_ROOT_REAL, q.get('dir') || path.relative(LIBRARY_ROOT_REAL, base) || '.', 'dir')
      const dirs = []
      for (const n of listDirNames(dir)) {
        if (n.startsWith('.')) continue
        const sub = path.join(dir, n)
        const s2 = statSafe(sub)
        if (!s2 || !s2.isDirectory()) continue
        if (!isInside(LIBRARY_ROOT_REAL, realpathDeepest(sub))) continue   // 逃逸的符号链接不列出来
        dirs.push({ name: n, path: path.relative(LIBRARY_ROOT_REAL, sub) })
      }
      return jsonOk(res, { item, dir, root: LIBRARY_ROOT_REAL, dirs, count: dirs.length })
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req, LIMITS.bodyBytes)
      if (body.pick) {
        const reason = '没有宿主对话框：无法弹系统"选择目录"（调用方随后用 window.prompt 让用户手输绝对路径）'
        recordDiag(`bench: 目录型属性选择器降级（501 能力）—— ${reason}`, 'info', 'props-dir')
        return jsonOk(res, {
          cancelled: true, unsupported: true, degraded: true, degradedStatus: 501, picker: 'unsupported',
          reason, hint: '直接输入绝对路径；本服务不校验该属性值（它只是写进属性覆盖文件的一个字符串）',
        })
      }
      if (typeof body.dir === 'string' && body.dir) {
        const target = safeJoin(LIBRARY_ROOT_REAL, body.dir, 'dir')
        const st = statSafe(target)
        if (!st || !st.isDirectory()) throw notFound(`目录不存在：${body.dir}`)
        return jsonOk(res, { item: body.item ? assertItemPath(body.item) : null, name: body.name ? assertPropName(body.name) : null, dir: target, value: target })
      }
      throw bad('需要 {pick:true} 或 {dir:"库根内的路径"}')
    }
  }

  // ⑤ /api/props-file —— 文件型属性导入（写 reports/bench-props/files/**，**不写进壁纸包**）
  //    GET 的形状是 `/api/props-file/<itemId>/<name>/<filename>`（回读）⇒ 这里必须按**前缀**匹配，
  //    只按相等匹配会让回读落到"未知端点"404（实测踩到）。
  if (p === '/api/props-file' || p.startsWith('/api/props-file/')) {
    if (req.method === 'GET') {
      // 回读：/api/props-file/<itemId>/<name>/<filename>
      const segs = p.split('/').filter(Boolean).slice(2).map((s) => { try { return decodeURIComponent(s) } catch { throw bad('URL 解码失败') } })
      if (segs.length !== 3) throw bad('形状：/api/props-file/<itemId>/<name>/<filename>')
      const [item, name, file] = [assertItemPath(segs[0]), assertPropName(segs[1]), assertFileName(segs[2], '文件名')]
      /* ③嵌套 itemId 的回读 URL 由**写入侧**用 `encodeURIComponent(item)` 拼出（`/` ⇒ `%2F`，仍是**一段**）
         ⇒ 这里 `decodeURIComponent` 之后拿到的就是同一条嵌套 id，形状判据（3 段）不用改。 */
      const target = path.join(PROPS_DIR, 'files', item, name, file)
      const st = statSafe(target)
      if (!st || !st.isFile()) throw notFound(`未导入过该文件：${item}/${name}/${file}`)
      res.writeHead(200, { 'Content-Type': mimeOf(target), 'Content-Length': String(st.size), 'Cache-Control': NO_STORE, 'X-Bench-Server': 'we-scene-demo-8902' })
      if (req.method === 'HEAD') return res.end()
      return fs.createReadStream(target).pipe(res)
    }
    if (req.method === 'POST') {
      const loc = itemLocate(q.get('item') || '')      // ③目录项 / 单文件项（`.mpkg`）都吃
      const item = loc.id
      const name = assertPropName(q.get('name') || '')
      let rawName = String(req.headers['x-filename'] || '')
      try { rawName = decodeURIComponent(rawName) } catch { /* 未编码就算了 */ }
      const filename = assertFileName(rawName, 'X-Filename')
      const buf = await readBody(req, LIMITS.propsFileBytes)
      if (!buf.length) throw bad('空文件（body 为空）')
      /* ①(用户第 34 条「限制导入的文件类型」) **白名单 + 内容嗅探**：扩展名要在白名单里、**实际内容**
         要与扩展名同类、且不含可执行/脚本特征（PE/ELF/`#!`/`<script>`…）。客户端传的 content-type 一律不采信。
         拒收时回 4xx + 人读原因（不静默截断、不"改了后缀就放行"）。策略本体在 `server/upload-policy.mjs`（纯函数、可单测）。 */
      const verdict = checkUpload({ filename, buf, maxBytes: LIMITS.propsFileBytes })
      if (!verdict.ok) {
        throw new HttpError(/过大/.test(verdict.reason) ? 413 : 415, '导入被拒：' + verdict.reason, { policy: 'upload-policy.mjs' })
      }
      const outDir = path.join(PROPS_DIR, 'files', item, name)
      mkdirSafe(outDir)
      const target = path.join(outDir, filename)
      if (!isInside(path.join(PROPS_DIR, 'files'), target)) throw forbidden('导入路径越出 reports')
      fs.writeFileSync(target, buf)
      // 调用方要 `r.value`（`if(!o.ok||r.error||!r.value) throw`）⇒ 给**同源可回读的 URL**：
      //   runner 与渲染器同源，能直接 fetch 它；绝对磁盘路径另放 filePath（见 docs/BENCH-8902.md §5 未证实项）。
      const urlPath = `/api/props-file/${encodeURIComponent(item)}/${encodeURIComponent(name)}/${encodeURIComponent(filename)}`
      recordDiag(`bench: 导入文件属性 ${item}.${name} ← ${filename}（${buf.length} B，落 ${target}，未写进壁纸包）`, 'info', 'props-file')
      return jsonOk(res, { item, name, filename, bytes: buf.length, value: urlPath, url: urlPath, filePath: target, wroteIntoWallpaper: false })
    }
  }

  // ⑥ POST /api/delete —— 默认 dryRun；`?confirm=1` 才移进回收站（可回滚）
  if (p === '/api/delete') {
    if (req.method !== 'POST') throw new HttpError(405, '只支持 POST')
    const body = await readJsonBody(req, LIMITS.bodyBytes)
    /* ③(2026-09-24 mpkg 一等项) 两种条目都能删：**目录项** ⇒ 移整个目录（老口径逐字不变）；
       **单文件项**（`.mpkg`）⇒ 只移那个文件（不会连坐同一个角色目录里的其它容器）。
       默认仍是 dryRun、真删仍是"移到回收站"、可 `mv` 回滚；回收站里的落点保留嵌套路径的可读性
       （`<itemId>` 里的 `/` 换成 `__`，与 `propsFileFor`/`thumbCachePath` 同一套换算）。 */
    const loc = itemLocate(body.itemId || body.item || '')
    const item = loc.id
    const dir = loc.abs
    const confirm = q.get('confirm') === '1' || body.confirm === true || body.confirm === 1
    const plan = loc.isDir ? collectPlan(dir) : { count: 1, bytes: loc.st.size, files: [{ rel: loc.base, size: loc.st.size }] }
    const trashName = item.replace(/\//g, '__')
    if (!confirm) {
      recordDiag(`bench: 删除为 **dryRun**（未移动任何文件）：${item}（${plan.count} 个文件 / ${plan.bytes} B）` +
        `—— 真要删请用 ?confirm=1（移到 ${path.join(TRASH_ROOT, '<时间戳>')}，可回滚）`, 'info', 'delete')
      return jsonOk(res, {
        item, itemId: item, dryRun: true, wouldMove: true, confirm: false, action: 'move-to-trash',
        itemRole: loc.isFile ? 'file' : 'dir',
        from: dir, to: path.join(TRASH_ROOT, '<ts>', trashName), trashRoot: TRASH_ROOT,
        files: plan.files, fileCount: plan.count, bytes: plan.bytes,
        hint: '重发 POST /api/delete?confirm=1 才真删（移到回收站，不永久删除）',
      })
    }
    // 安全闸（①2026-09-19 选择器轮）：库根现在可以由选择器指到浏览根内**任何**目录 ⇒ 真删前先确认
    //   这一项**确实像壁纸**。没有任何壁纸信号（kind=unknown 且无 project.json）时，必须显式 ack。
    //   dryRun 不受影响（上面那条分支照旧只回计划）。
    //   ③文件项（`.mpkg`）本身就是容器 ⇒ 有明确壁纸信号，`libraryItemFromFile` 给 kind/container。
    const sig = loc.isFile ? libraryItemFromFile(item, loc) : libraryItem(item, makeBudget(4000))
    if (sig && !sig.renderable && sig.kind === 'unknown' && !sig.hasProject && body.ack !== true) {
      throw new HttpError(409, `拒绝删除：${item} 没有任何壁纸信号（不是壁纸目录）`, {
        needsAck: true, itemId: item, kind: sig.kind, signals: sig.signals,
        reason: '选择器可以把库根指到任意目录 ⇒ 删"不像壁纸"的目录需要显式确认，防误删',
        hint: '确实要删就带 {ack:true} 重发（仍只移到回收站，可 mv 回滚）',
      })
    }
    const moved = moveToTrash(trashName, dir)
    recordDiag(`bench: 已删除 ${item} → ${moved.to}（移到回收站，可回滚：mv "${moved.to}" "${dir}"）`, 'info', 'delete')
    return jsonOk(res, {
      item, itemId: item, dryRun: false, wouldMove: false, confirm: true, action: 'move-to-trash',
      itemRole: loc.isFile ? 'file' : 'dir',
      from: dir, to: moved.to, trashRoot: moved.trashRoot, files: plan.files, fileCount: plan.count, bytes: plan.bytes,
      rollback: `mv "${moved.to}" "${dir}"`,
    })
  }

  // ⑦ POST /api/reveal —— 只对库根内的路径；找不到打开器 ⇒ 501 + 说明（绝不成 500）
  if (p === '/api/reveal') {
    if (req.method !== 'POST') throw new HttpError(405, '只支持 POST')
    const body = await readJsonBody(req, LIMITS.bodyBytes)
    let target
    if (body.itemId || body.item) {
      /* ③(2026-09-24) 单文件项（`<角色>/<x>.mpkg`）也能"打开所在文件夹" ⇒ 落点是**它所在的目录**
         （调用方文案本来就是"打开所在文件夹"；把文件本身交给 xdg-open 会变成"用某程序打开它"）。 */
      const loc = itemLocate(body.itemId || body.item)
      target = loc.isDir ? loc.abs : loc.dir
    } else if (typeof body.path === 'string' && body.path) {
      target = safeJoin(activeRoot, body.path, 'path')
    } else throw bad('需要 {itemId} 或 {path:"库根内的路径"}')
    const st = statSafe(target)
    if (!st || !st.isDirectory()) throw notFound(`目录不存在：${target}`)
    const real = realpathDeepest(target)
    if (!isInside(activeRoot, real)) throw forbidden(`路径经符号链接越出库根：${body.itemId || body.path}`)
    const opener = findOpener()
    if (!opener) {
      // 诚实降级：501 + 说明（调用方把它当错误显示在日志里；**不是** 500，也不是假装成功）
      return json(res, 501, {
        ok: false, unsupported: true, degraded: true, itemId: body.itemId || null, path: target,
        error: '本机没有可用的"打开文件夹"程序（找不到 termux-open / xdg-open / open / explorer）',
        reason: '无头/精简环境常见：没有 X11 打开器；本服务**不会**替你启动浏览器或文件管理器',
        hint: '装 termux-open / xdg-open / explorer（Windows 自带），或用 MPW_OPEN_CMD=/path/to/opener 指定；也可以直接 `cd` 到上面这个 path',
        tried: [OPEN_CMD_ENV, 'termux-open', 'xdg-open', 'open', 'explorer'].filter(Boolean),
      })
    }
    const r = await spawnDetached(opener.path, [target])
    if (!r.ok) {
      return json(res, 501, {
        ok: false, unsupported: true, degraded: true, path: target,
        error: `打开器启动失败：${opener.path}（${r.code || ''} ${r.message || ''}）`.trim(),
        reason: '打开器存在但无法启动（无显示环境 / 权限）——按"能力不可用"降级，不是 500', opener: opener.path,
      })
    }
    recordDiag(`bench: 打开所在文件夹 ${target}（opener=${opener.path}）`, 'info', 'reveal')
    return jsonOk(res, { itemId: body.itemId || null, path: target, opened: true, opener: opener.path })
  }

  // ⑧ GET /api/diag-stream —— SSE（调用方 `JSON.parse(e.data).msg`）
  if (p === '/api/diag-stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': NO_STORE,
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Bench-Server': 'we-scene-demo-8902',
    })
    res.write('retry: 3000\n\n')
    for (const evt of diagBuffer.slice(-50)) res.write(`data: ${JSON.stringify(evt)}\n\n`)   // 回放：调用方 onmessage 收默认事件
    sseClients.add(res)
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* 清理在 close */ } }, 15000)
    const bye = () => { clearInterval(ping); sseClients.delete(res) }
    res.on('close', bye)
    res.on('error', bye)
    req.on('close', bye)
    return undefined
  }

  throw notFound(`未知端点：${req.method} ${p}`)
}

function handleDiagSink(req, res, url) {
  if (req.method === 'POST') {
    return readBody(req, LIMITS.bodyBytes).then((buf) => {
      let msg = ''
      const text = buf.toString('utf8')
      /* [we-json:strict|request-body] **不是包内/包旁 JSON**：`POST /diag` 的**请求体**；不是 JSON 就整份当消息文本用
         （既有降级语义，逐字保留）⇒ 严格 `JSON.parse` + `catch { msg = text }`。 */
      try { const j = JSON.parse(text); msg = j && typeof j === 'object' ? String(j.msg == null ? text : j.msg) : text } catch { msg = text }
      const evt = recordDiag(msg, url.searchParams.get('level') || undefined, 'renderer')
      return jsonOk(res, { buffered: diagBuffer.length, seq: evt ? evt.seq : null, msg: evt ? evt.msg : '' })
    })
  }
  // GET /diag?msg=…：renderer bundle 的 `ce()` 用 `new Image().src=…` 上报 ⇒ 回 1×1 gif（图片不报错）
  const evt = recordDiag(url.searchParams.get('msg') || '', url.searchParams.get('level') || undefined, 'renderer')
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': String(GIF_1x1.length), 'Cache-Control': NO_STORE, 'X-Bench-Server': 'we-scene-demo-8902' })
  res.end(GIF_1x1)
  void evt
}

// ═══ ⑩（2026-09-19）`POST /report` 与 `POST /baseline`：把测试台的「立即上报」真正收下来 ══════════════
//   为什么在 :8902 也要有：`demo/bench-patch.js` 的调试页签把「立即上报」的落点按
//   `DEBUG_REPORT_ROUTES = ['/report', '/baseline', '/diag']` **依次**试。:8902 原本只有 `/diag`（环形缓冲，
//   内存里 200 条、重启即失），于是按钮的日志永远是"上报失败 → 只能进 /diag 环形缓冲"，点完什么也没留下
//   （真实读数：`GET /report` 404）。三条路由的语义与 :8899 完全一致，**落点也一致**：
//     · `/report`   ⇒ `<reports>/r<ts>.json`（受 60 份 / 64MB 最旧先删滚动）
//     · `/baseline` ⇒ `<reports>/baselines/<ts>.json`（趋势数据，独立目录、独立上限，200 份 / 32MB）
//     · `/diag`     ⇒ 环形缓冲（原样保留，作为两条落盘路由都不可用时的最后兜底）
//   `/baseline` 的**校验判据**复用 `core/baseline-metrics.mjs`（与 :8899 同一把尺子）：不完整 ⇒ 400 且
//   **不落盘** —— 趋势目录里只留干净数据（缺字段当 0 比会得出假结论）。
/** 把一个目录收进 maxFiles/maxBytes 之内，**最旧先删**（与 :8899 的 `pruneDirToLimits` 同口径）。
 *  排序 = 文件名里的 epoch 优先（`r<ts>.json` / `<ts>.json` 都是"名字即时间"），拿不到才退回 mtime。
 *  任何一步失败都吞掉：**清理绝不能让写入路径 500**。返回 `{removed, freedBytes}`。 */
function pruneDirToLimits(dir, opts) {
  const o = opts || {}
  const maxFiles = o.maxFiles === undefined ? Infinity : o.maxFiles
  const maxBytes = o.maxBytes === undefined ? Infinity : o.maxBytes
  let removed = 0, freedBytes = 0
  try {
    let names
    try { names = fs.readdirSync(dir) } catch { return { removed: 0, freedBytes: 0 } }
    const keep = o.filter || (() => true)
    const tsOf = (n) => { const m = /(\d{10,})/.exec(n); return m ? Number(m[1]) : null }
    const rows = []
    for (const n of names) {
      if (!keep(n)) continue
      const st = statSafe(path.join(dir, n))
      if (!st || !st.isFile()) continue
      rows.push({ n, size: st.size, mtime: st.mtimeMs })
    }
    rows.sort((a, b) => {
      const ta = tsOf(a.n), tb = tsOf(b.n)
      if (ta !== null && tb !== null && ta !== tb) return ta - tb
      return (a.mtime - b.mtime) || a.n.localeCompare(b.n)
    })
    let total = rows.reduce((s, r) => s + r.size, 0)
    let count = rows.length
    for (const r of rows) {
      if (count <= maxFiles && total <= maxBytes) break
      try {
        fs.unlinkSync(path.join(dir, r.n))
        removed++; freedBytes += r.size; count--; total -= r.size
      } catch { /* 单个删不掉不阻断其余 */ }
    }
  } catch { /* ignore */ }
  return { removed, freedBytes }
}
/** `reports/` 顶层的滚动：只认 `r<ts>.json` 与 `selfcheck-<ts>.json` 这两类自造文件名。
 *  ⚠ `MPW_REPORTS_DIR` 默认是**工作区根的 reports/**，那里还躺着 `parity-*.json` 等别条线的产物
 *  （对账门禁要读）——**一个都不许删**，所以过滤器必须白名单化。 */
function pruneBenchReports() {
  const a = pruneDirToLimits(REPORTS_DIR, { maxFiles: LIMITS.reportMaxFiles, filter: (n) => /^r\d+\.json$/.test(n) })
  const b = pruneDirToLimits(REPORTS_DIR, { maxFiles: LIMITS.reportMaxFiles, filter: (n) => /^selfcheck-\d+\.json$/.test(n) })
  const c = pruneDirToLimits(REPORTS_DIR, { maxBytes: LIMITS.reportMaxBytes, filter: (n) => /^(r\d+|selfcheck-\d+)\.json$/.test(n) })
  return { removed: a.removed + b.removed + c.removed, freedBytes: a.freedBytes + b.freedBytes + c.freedBytes }
}
/** `reports/baselines/` 的滚动（只数 `<ts>.json`；与顶层各管各的）。 */
function pruneBenchBaselines() {
  return pruneDirToLimits(path.join(REPORTS_DIR, 'baselines'), {
    maxFiles: LIMITS.baselineMaxFiles,
    maxBytes: LIMITS.baselineMaxBytes,
    filter: (n) => /^\d+(-\d+)?\.json$/.test(n),
  })
}
/** `POST /report`：诊断载荷原样落 `<reports>/r<ts>.json`（不做 schema 校验——它就是"现场快照"，形状随版本走）。 */
function handleReport(req, res) {
  if (req.method !== 'POST') {
    return Promise.resolve(json(res, 405, {
      ok: false, error: '只接受 POST（body = 诊断报告 JSON）', allow: 'POST',
      hint: 'GET 这条路由没有内容可给：报告落在 <reports>/r<ts>.json（目录见 /__health.report.dir），服务端 stdout 也会打印一行落点',
    }, { Allow: 'POST' }))   // ①(2026-09-19) 405 按 HTTP 口径把小写 `allow` 也放进**响应头**（body 里那份是给人读的）
  }
  return readBody(req, LIMITS.reportBodyBytes).then((buf) => {
    const dir = REPORTS_DIR
    mkdirSafe(dir)
    pruneBenchReports()   // 写入前：先把上一次遗留的超限收回去
    const name = 'r' + Date.now() + '.json'
    fs.writeFileSync(path.join(dir, name), buf)
    const pr = pruneBenchReports()   // 写入后：本次这份也计入数量/字节上限
    console.log('[8902][report] ' + path.join(dir, name) + ' ' + buf.length + 'B'
      + (pr.removed ? '（滚动：删了 ' + pr.removed + ' 个最旧文件，释放 ' + (pr.freedBytes / 1048576).toFixed(2) + ' MB）' : ''))
    recordDiag(`bench: 收到诊断上报 r${name.slice(1)}（${buf.length} B）`, 'info', 'report')
    return jsonOk(res, { file: name, bytes: buf.length, dir, limit: { maxFiles: LIMITS.reportMaxFiles, maxBytes: LIMITS.reportMaxBytes } })
  }).catch((e) => {
    if (e instanceof HttpError) return jsonErr(res, e)
    return jsonErr(res, new HttpError(500, '落盘失败: ' + (e && e.message)))
  })
}
/** `POST /baseline`：真机基线快照 ⇒ `<reports>/baselines/<ts>.json`（校验不过 ⇒ 400 且不落盘）。 */
/* [we-json:strict|request-body] **不是包内/包旁 JSON**：body 是**客户端上报的**快照（HTTP 请求体）⇒ 坏 JSON 必须 400，
   宽容会让"上报端写错了"变成"服务端帮忙猜对了"，趋势数据从此不可信。 */
function handleBaseline(req, res) {
  if (req.method !== 'POST') {
    return Promise.resolve(json(res, 405, { ok: false, error: '只接受 POST（body = 基线快照 JSON）', allow: 'POST' }, { Allow: 'POST' }))
  }
  return readBody(req, LIMITS.baselineBodyBytes).then((buf) => {
    let snap = null
    try { snap = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')) } catch {
      return json(res, 400, { ok: false, error: 'body 不是合法 JSON' })
    }
    const v = mpwValidateSnapshot(snap)
    if (!v.ok) {
      return json(res, 400, {
        ok: false, error: '快照不完整（' + v.errors.slice(0, 6).join('；') + '）', errors: v.errors.slice(0, 20),
        hint: '完整快照的字段口径见 core/baseline-metrics.mjs 的 BASELINE_DEFAULTS/BASELINE_SCHEMA；不完整一律不落盘',
      })
    }
    const dir = path.join(REPORTS_DIR, 'baselines')
    mkdirSafe(dir)
    pruneBenchBaselines()
    const ts = Date.now()
    let name = ts + '.json', n = 1
    while (fs.existsSync(path.join(dir, name))) name = ts + '-' + (++n) + '.json'
    fs.writeFileSync(path.join(dir, name), buf)
    const pr = pruneBenchBaselines()
    const rel = 'baselines/' + name
    console.log('[8902][baseline] ' + path.join(dir, name) + ' ' + buf.length + 'B id=' + snap.id
      + ' fps中位=' + (snap.fps && snap.fps.median) + ' 启动=' + (snap.startup && snap.startup.totalMs) + 'ms'
      + (pr.removed ? '（滚动：删了 ' + pr.removed + ' 个最旧文件）' : ''))
    recordDiag(`bench: 基线快照 ${rel}（${buf.length} B，id=${snap.id}）`, 'info', 'baseline')
    return jsonOk(res, { schema: BASELINE_SCHEMA, file: rel, bytes: buf.length, dir })
  }).catch((e) => {
    if (e instanceof HttpError) return jsonErr(res, e)
    return jsonErr(res, new HttpError(500, '落盘失败: ' + (e && e.message)))
  })
}

function health() {
  const opener = findOpener()
  const lib = librarySource()
  const libScan = (() => { try { const s = listLibrary(); return { count: s.count, missing: !!s.missing, kinds: s.scan.kinds, containerKinds: s.scan.containerKinds, signals: s.scan.signals, skipped: s.scan.skipped, skippedList: s.scan.skippedList, durationMs: s.scan.durationMs, budgetExceeded: s.scan.budgetExceeded, looseFiles: s.scan.looseFiles, looseMpkgFiles: s.scan.looseMpkgFiles } } catch (e) { return { error: String(e && e.message || e) } } })()
  const ffmpeg = findFfmpeg()
  return {
    ok: true, service: 'we-scene-demo-8902', port: PORT, pid: process.pid, node: process.version,
    startedAt: STARTED_AT, uptimeSec: Math.round((Date.now() - Date.parse(STARTED_AT)) / 1000),
    libraryRoot: activeRoot, configuredLibraryRoot: LIBRARY_ROOT_REAL, libraryRootExists: !!statSafe(activeRoot),
    libraryItems: libScan.count == null ? null : libScan.count,
    // 库来源（**显式**）：source ∈ env|cli|user|default|none；selected = 用户到底选过没有
    library: lib, libraryScan: libScan,
    librarySource: lib.source, librarySelected: lib.selected, libraryExplicit: lib.explicit,
    reportsDir: REPORTS_DIR, propsDir: PROPS_DIR, trashRoot: TRASH_ROOT, thumbDir: THUMB_DIR,
    staticRoot: STATIC_ROOT, staticMounts: ['/', '/demo/', '/WEwebLoader/', '/wallpaper-engine-webgl/'], staticStore: STORE ? 'cache' : 'no-store',
    /* ①②③④(2026-09-24 用户第 4/5 条) 渲染器面：**默认本地直供**（同一份实现，见 rendererRequestHandler），
       上游只是**可选**的；配了连不上就回退本地。自述里把"上游在不在、走没走"写清楚。 */
    renderer: {
      servedBy: 'local', servedHeader: 'X-Bench-Served: local', upstreamHeader: 'X-Bench-Upstream: <host:port>',
      handler: 'server/we-scene-demo-server.mjs 的 rendererRequestHandler（同一份实现被两个入口复用）',
      libraryRootProvider: 'setLibraryRootProvider(() => activeRoot)——所有按 itemId 解析的路由用它',
      pkgParser: pkgParserUnavailable() ? { available: false, error: pkgParserUnavailable() } : { available: true },
    },
    rendererProxy: RENDERER_UPSTREAM ? {
      path: '/webloader/**', upstream: RENDERER_UPSTREAM.bad ? null : (RENDERER_UPSTREAM.host + ':' + RENDERER_UPSTREAM.port),
      from: RENDERER_UPSTREAM.from,
      mode: RENDERER_UPSTREAM.bad
        ? (RENDERER_UPSTREAM.badReason ? 'configured-but-refused（本地直供；上游被安全闸门拒绝：' + RENDERER_UPSTREAM.badReason + '）' : 'configured-but-invalid（本地直供，上游值无法解析）')
        : 'upstream-first（连接层失败 ⇒ 本地直供回退）',
      /* ⓪③(P-204 F8) 转发口径如实自述：默认**剥掉** Cookie/Authorization 等凭据头。 */
      forwardAuth: String(process.env.MPW_PROXY_FORWARD_AUTH || '').trim() === '1' ? 'on（MPW_PROXY_FORWARD_AUTH=1：**连凭据头一起转发**）' : 'off（默认：cookie/authorization/referer/x-*token* 一律不转发；要旧行为设 MPW_PROXY_FORWARD_AUTH=1）',
      purpose: '让测试台用**本仓渲染器页**预览（带 P-163 的"先选级再解码"；超大贴图不再黑屏）',
      localFallback: 'GET/HEAD：上游连不上 ⇒ 本地直供（响应头 X-Bench-Served: local + X-Bench-Upstream-Error）',
      fallback: '/wallpaper-engine-webgl/renderer/index.html（上游产物页）',
      unreachable: '仅当**本地也没有这条路由**时：502 + {upstream,hint,fallback}（不挂住、不 500）',
    } : {
      path: '/webloader/**', upstream: null, from: '未设置 MPW_RENDERER_UPSTREAM / MPW_RENDERER_8899',
      mode: 'local-only（默认口径：不需要上游，8902 自己服务渲染器面）',
      purpose: '只开 8902 一个服务就能打开并预览本仓渲染器页',
      localFallback: '全部本地直供', fallback: '/wallpaper-engine-webgl/renderer/index.html（上游产物页）',
      unreachable: '不适用（没有上游）',
    },
    mediaBase: '/media/dev', webBase: '/web/dev', rendererPage: '/wallpaper-engine-webgl/renderer/index.html',
    dirPicker: {
      available: BROWSE_ROOTS.some((r) => statSafe(r)), readOnly: true, browseRoot: PICK_ROOT_REAL, browseRootFrom: PICK_ROOT_FROM,
      allowedRoots: BROWSE_ROOTS.slice(), allowedRootsFrom: BROWSE_ROOTS_FROM,
      allowDirsEnv: 'MPW_ALLOW_DIRS（冒号/分号分隔的额外允许目录）',
      home: os.homedir() || '/', platform: process.platform,
      routes: {
        roots: 'GET /api/fs/roots', listAbs: 'GET /api/fs/list?path=', pickAbs: 'POST /api/fs/pick',
        fileAbs: 'GET /api/fs/file?path=',      // ②(第 2 条) "选择文件"与"选择文件夹"走同一棵浏览树
        list: 'GET /api/dir-list?path=', parent: 'GET /api/dir-parent?path=', pick: 'POST /api/dir-pick',
        commit: 'POST /api/library-dir {dir|?path=}', compat: 'GET /list-dirs?path=', source: 'GET /api/library-source',
      },
      escapes: '相对路径含 .. ⇒ 400；绝对路径越允许根 ⇒ 403；符号链接逃逸 ⇒ 403（不列出）；NUL/控制符 ⇒ 400',
      systemPickerFallback: '页面自带 showDirectoryPicker/webkitdirectory（Android 上即系统选择器）只能作兜底；服务端这条路由才是环境内路径的正路',
    },
    thumb: ffmpeg
      ? { available: true, engine: 'ffmpeg', ffmpeg, dir: THUMB_DIR, route: 'GET /api/thumb?item=&w=' }
      : { available: false, engine: 'preview-file-only', status: 501, route: 'GET /api/thumb?item=&w=', reason: '没有 preview.* 的视频档无法抽帧（PATH 里没有 ffmpeg）' },
    diag: { buffer: diagBuffer.length, bufferLimit: LIMITS.diagBuffer, seq: diagSeq, sseClients: sseClients.size, sink: ['GET /diag?msg=', 'POST /diag'], source: 'self (ring buffer; not a :8899 proxy)' },
    // ⑩（2026-09-19）上报落点自述：测试台「立即上报」按 /report → /baseline → /diag 依次试，
    //   这里如实回报**前两条真的存在**以及它们的磁盘落点/滚动上限（读的人不用再去翻代码）。
    report: {
      routes: ['POST /report', 'POST /baseline', 'POST /diag'],
      order: 'POST /report ⇒ POST /baseline ⇒ POST /diag（bench-patch.js 的 DEBUG_REPORT_ROUTES）',
      dir: REPORTS_DIR,
      report: { route: 'POST /report', file: '<reports>/r<ts>.json', bodyBytes: LIMITS.reportBodyBytes, maxFiles: LIMITS.reportMaxFiles, maxBytes: LIMITS.reportMaxBytes, schema: '不校验（现场诊断快照，形状随版本走）' },
      baseline: { route: 'POST /baseline', file: '<reports>/baselines/<ts>.json', bodyBytes: LIMITS.baselineBodyBytes, maxFiles: LIMITS.baselineMaxFiles, maxBytes: LIMITS.baselineMaxBytes, schema: BASELINE_SCHEMA, validate: 'core/baseline-metrics.mjs mpwValidateSnapshot（不完整 ⇒ 400 且不落盘）' },
      diag: { route: 'POST /diag', sink: '内存环形缓冲（重启即失；仅当前两条都不可用时才走到）' },
      prunes: ['r*/selfcheck* 最旧先删（数量 + 总字节）', 'baselines/ 独立滚动（数量 + 总字节）', 'reports/ 里别条线的 parity-* 等产物一个都不动'],
    },
    reveal: opener ? { available: true, opener: opener.path } : { available: false, status: 501, tried: [OPEN_CMD_ENV, 'termux-open', 'xdg-open', 'open', 'explorer'].filter(Boolean) },
    capabilities: {
      staticBench: true, mediaDev: true, webDev: true, rangeRequests: true,
      libraryList: true, libraryDirEnumerate: true, libraryDirNarrow: true,
      librarySourceReport: true, librarySelectAbsolute: true, fullTypeScan: true, mpkgContainerIndex: true,
      dirBrowse: true, dirParent: true, dirPick: true, dirPickerCompat: true, serverDirPicker: true,
      thumbRoute: true, thumbFfmpeg: !!ffmpeg,
      propsRead: true, propsWrite: true, propsDirEnumerate: true,
      propsFileImport: true, propsFileReadBack: true,
      deleteDryRun: true, deleteConfirmToTrash: true, trashRollback: true,
      diagSink: true, diagStream: true, health: true,
      debugReport: true, baselineSnapshot: true,   // ⑩ /report 与 /baseline 都真的在（不再是"只能进 /diag 环形缓冲"）
      nativeFolderPicker: false, nativeFilePicker: false,// 没有宿主对话框 ⇒ 见 degraded[]
      reveal: !!opener,
    },
    degraded: [
      {
        endpoint: 'POST /api/library-dir', when: '{pick:true}', capability: 'native-folder-picker', capabilityStatus: 501,
        httpStatusUsed: 200, body: '{cancelled:true, unsupported:true, degraded:true, degradedStatus:501, picker:"server", serverPicker:{…}}',
        reason: '宿主系统对话框这条能力真的没有（本服务是 Node 服务，不经手 Android/桌面选择器）；调用方 bench-DSKWIqmS.js 用 `if(!e.ok||t.error) throw` 判失败 ⇒ 回 501 会把它的回退**掐掉**，故用 200 + unsupported 明确降级。**页面不再需要退回系统选择器**：browse 用 GET /api/dir-list、commit 用 POST /api/library-dir {dir}（绝对路径，浏览根内任意目录）',
      },
      {
        endpoint: 'POST /api/props-dir', when: '{pick:true}', capability: 'native-folder-picker', capabilityStatus: 501,
        httpStatusUsed: 200, body: '{cancelled:true, unsupported:true, degraded:true, degradedStatus:501}',
        reason: '同上：宿主对话框没有；目录型用户属性请改用服务端选择器（GET /api/dir-list → POST /api/dir-pick）',
      },
      {
        endpoint: 'POST /api/reveal', when: '找不到 termux-open/xdg-open/open/explorer 或启动失败', capability: 'open-in-file-manager', capabilityStatus: 501,
        httpStatusUsed: 501, body: '{ok:false, unsupported:true, error, reason, hint}',
        reason: '无头/精简环境没有打开器；按能力不可用**真回 501**（调用方本来就把它当错误显示），绝不是 500',
      },
      {
        endpoint: 'GET /api/thumb', when: '视频档没有 preview.* 且本机没有 ffmpeg', capability: 'video-thumbnail', capabilityStatus: ffmpeg ? 200 : 501,
        httpStatusUsed: ffmpeg ? 200 : 501, body: ffmpeg ? 'image/jpeg（ffmpeg 抽帧，缓存到 <reports>/bench-thumbs/）' : '{ok:false, unsupported:true, degraded:true, error, reason, hint}',
        reason: ffmpeg ? '有 ffmpeg：视频档能抽帧' : '没有 ffmpeg：视频档缩略图只能用库里现成的 preview.*，没有就如实 501',
      },
      {
        endpoint: 'GET /api/thumb', when: 'mpkg 容器条目没有库内 preview.*', capability: 'container-thumbnail', capabilityStatus: 501,
        httpStatusUsed: 501, body: '{ok:false, unsupported:true, degraded:true, error, reason, hint}',
        reason: '本服务只读容器**目录表**（不解包）；容器内 preview.gif 需要插件侧 pkg-extract 解包后才有图',
      },
      {
        endpoint: 'GET /api/library', when: '顶层散落 .mpkg 文件（不是目录）', capability: 'loose-container-item', capabilityStatus: 501,
        httpStatusUsed: 200, body: '{items:[…], scan:{looseFiles, looseMpkgFiles}}',
        reason: '列表只收**目录型**壁纸条目；顶层 .mpkg 文件如实计数在 scan.looseMpkgFiles 里（不假装扫到了，也不静默丢掉）',
      },
    ],
    limits: LIMITS,
  }
}

const server = http.createServer((req, res) => {
  let url
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`) } catch { return jsonErr(res, bad('URL 解析失败')) }
  const p = url.pathname
  // ⚠ 两个**必须**在路由前做的事：
  //   ① `new URL()` 会把路径里的 `.`/`..` **规范化掉**（`/media/dev/a/../../out` → `/media/out`）⇒ 想"拒绝 `..`"
  //      就得先看**原始** req.url（含 `%2e%2e` 解码后），否则越界请求会被静默改写成另一个合法形状（实测踩到）。
  //   ② 处理函数里的**同步** throw 必须也被 `done()` 接住，否则一个 404 就能把整个服务打崩（实测踩到）。
  const rawPath = String(req.url || '/').split('?')[0].split('#')[0]
  const decodedPath = (() => { try { return decodeURIComponent(rawPath) } catch { return rawPath } })()
  if (decodedPath.includes('\0')) return jsonErr(res, bad('URL 路径含 NUL'))
  if (decodedPath.split('/').some((seg) => seg === '..')) return jsonErr(res, bad(`URL 路径含 ".."（拒绝）：${rawPath.slice(0, 200)}`))
  const onErr = (e) => {
    if (!(e instanceof HttpError)) {
      // 非预期错误也照实报（500）——但**库里那些"能力不可用"一律走 HttpError(501)**，见 /api/reveal
      console.error('[8902] 未预期错误', p, e)
    }
    jsonErr(res, e)
  }
  const done = (fn) => { try { return Promise.resolve(fn()).catch(onErr) } catch (e) { return onErr(e) } }

  // 诊断入口（renderer 的 `/diag?msg=` 与 `POST /diag`）
  if (p === '/diag') return done(() => handleDiagSink(req, res, url))
  // ⑩（2026-09-19）测试台「立即上报」的两条落盘路由：`/report`（现场快照）与 `/baseline`（趋势快照）。
  //   必须是**根路径**（`demo/bench-patch.js` 用的是相对 URL，落在页面 origin 的根上），
  //   且必须排在下面的静态兜底之前 —— 否则它们会走进静态面变成 404（这就是"点完什么也没留下"的原因）。
  if (p === '/report') return done(() => handleReport(req, res))
  if (p === '/baseline') return done(() => handleBaseline(req, res))
  if (p === '/__health' || p === '/__health/') return done(() => jsonOk(res, health()))
  if (p === '/favicon.ico') {
    /* ①(2026-09-23 品牌清理) 这里以前发的是 `icons/pwa-192.png` —— 那是**上游 WebWallGL 自己的图标**
       （`demo/LICENSE-webwallgl:23` 把 `icons/*.png` 列为上游产物）。改成仓库所有者的品牌图
       （`demo/assets/brand/favicon-32.png`，与站点根 `/icons/brand-32.png` 逐字节相同）。
       兜底顺序：favicon-32 → brand-192；两张都不在才 204（原行为不变）。 */
    for (const rel of [['assets', 'brand', 'favicon-32.png'], ['assets', 'brand', 'brand-192.png']]) {
      const cand = path.join(STATIC_ROOT, ...rel)
      if (statSafe(cand) && sendFile(req, res, cand)) return undefined
    }
    res.writeHead(204, { 'Cache-Control': NO_STORE }); return res.end()
  }
  /* ①(渲染器页同源入口) `/webloader/**`：**默认本地直供**（= 同一份渲染器处理器），
     只有显式配了 `MPW_RENDERER_UPSTREAM`/`MPW_RENDERER_8899` 才走上游（连不上则回退本地）。
     为什么要有这条路径：测试台预览超大贴图（如 3669681034 的 7680×4320/43.8MB）时，上游产物页
     "先解码再缩放"会黑屏，而本仓 core 有 P-163 的"先选级再解码"修复。 */
  if (p === '/webloader' || p.startsWith('/webloader/')) return done(() => serveRenderer(req, res, url))
  /* ②(2026-09-21 渲染器来源=本仓；2026-09-24 本地直供) 渲染器页**自己的**路由（它写在根上）：
     静态面优先（`demo/` 里真有同名文件就不打扰渲染器处理器），否则交给**同一份**渲染器实现。
     越根/坏 URL 仍按本服务既有口径 400/403（`staticTarget` 会抛，**不**把请求推给上游）。 */
  {
    const relForRenderer = p.replace(/^\/+/, '')
    const isRendererPath = RENDERER_LOCAL_EXACT.has(p) || RENDERER_LOCAL_PREFIXES.some((r) => p === r || p.startsWith(r))
    if (isRendererPath) {
      let localErr = null
      let localStat = null
      try { localStat = statSafe(staticTarget(relForRenderer)) } catch (e) { localErr = e }
      if (localErr) return jsonErr(res, localErr)
      if (!localStat || localStat.isDirectory()) return done(() => serveRenderer(req, res, url, relForRenderer))
    }
  }
  if (p.startsWith('/api/')) return done(() => handleApi(req, res, url))

  // 兼容壳：与插件 `dsh-mpkg-wallpaper` 的 `GET /list-dirs?path=` **逐字段同形**
  //   （`{ok, dir, subdirs, home, platform}`）—— 从插件侧搬过来的选择器代码可以一行不改地跑在本服务上。
  if (p === '/list-dirs' || p === '/list-dirs/') {
    return done(() => {
      const dir = assertBrowsePath(url.searchParams.get('path') || '')
      const payload = dirListing(dir, { files: false })
      const home = os.homedir() || '/'
      const within = isInside(PICK_ROOT_REAL, home)
      return jsonOk(res, {
        dir: payload.dir, subdirs: payload.dirs.map((d) => d.name), home,
        platform: process.platform,
        // 兼容字段之外**额外**给出服务端选择器的事实（不改变上面的形状）
        parent: payload.parent, atRoot: payload.atRoot, browseRoot: PICK_ROOT_REAL,
        homeInsideBrowseRoot: within, dirs: payload.dirs, counts: payload.counts,
        note: within ? undefined : '家目录不在浏览根内：home 只作展示，path 必须落在 browseRoot 之内',
      })
    })
  }

  // 媒体面（库根内只读）：/media/dev/<itemId>/<rel…>（scene.pkg / preview.gif / 视频）与 /web/dev/<itemId>/<rel…>
  for (const prefix of ['/media/dev/', '/web/dev/']) {
    if (p.startsWith(prefix)) {
      return done(() => {
        /* ③(2026-09-24 mpkg 一等项) itemId 现在可能是**嵌套路径**（`<角色>/<x>.mpkg`）⇒
           `/media/dev/<角色>/<x>.mpkg` 有**两种读法**且指向同一个文件：
             ① item=<角色>      + rel=<x>.mpkg   （老读法：`<目录项>/<文件>`）
             ② item=<角色>/<x>.mpkg + rel=''      （新读法：嵌套 itemId 本身）
           取**最长的"目录前缀"**作为 itemId（①优先，保持 `/web/dev/**` 的 shim 注入路径不被绕过），
           一个目录前缀都不成立时整条当单文件项（②）。两种读法的字节完全一致，
           段校验 / `safeJoin`（`..` ⇒ 400、越根 ⇒ 403、真身逃逸 ⇒ 403）一个不少。 */
        const { item, rel, rawRel } = splitItemRel(p.slice(prefix.length))
        /* ⑥ /web/dev/ 的 **HTML** 走"注入 shim"那条（同源入口必须原始 URL + 服务端注入，见 docs §3.1/§3.6）；
           其余（图片/字体/脚本/媒体）与 /media/dev/ 逐字节同路。 */
        if (prefix === '/web/dev/') return webMediaServe(req, res, item, rel, rawRel, url)
        return mediaServe(req, res, item, rel, rawRel, prefix)
      })
    }
  }

  // 静态测试台
  return done(() => {
    const mapped = mapStatic(p)
    if (mapped.redirect) {
      const loc = mapped.redirect + (url.search || '')   // `?` 原样带走（hash 不发给服务器，天然保留）
      res.writeHead(302, { Location: loc, 'Cache-Control': NO_STORE })
      return res.end()
    }
    let rel = mapped.rel
    if (rel === '') rel = 'index.html'
    let target = staticTarget(rel)
    let st = statSafe(target)
    if (st && st.isDirectory()) {
      const idx = path.join(target, 'index.html')
      const ist = statSafe(idx)
      if (ist && ist.isFile()) target = idx
      else throw notFound(`目录下没有 index.html：${p}`)
    }
    if (!statSafe(target)) throw notFound(`静态文件不存在：${p}`)
    if (!sendFile(req, res, target)) throw notFound(`静态文件不可读：${p}`)
    return undefined
  })
})
/**
 * shim 源：**按源文件 mtime 失效**的缓存（不是模块加载时的一锤子买卖）。
 * 为什么：原先写作 `const WEB_SHIM_SOURCE = buildWebShimSource()`（进程启动时算一次），改完
 * `core/we-web-shim.mjs` 不重启服务就会**继续发旧字符串** —— 本轮真机踩到：帧里跑的是旧 shim
 * （没有 `post('paused')` / 交互 op），宿主侧却按新协议等回报，于是"消息到了、状态不回"，
 * 看起来像投递坏了。判据：每次请求 stat 一次源文件，mtimeMs 变了就重建（构建 15KB 字符串，代价可忽略）。
 */
let webShimCache = { mtimeMs: 0, source: '' }
/**
 * 注入面的**内容替换表**（默认不存在 ⇒ 一个字节都不动）。文件：`<reports>/web-replace.json`，形状
 * `[{ "from": "作者写的字符串", "to": "替换成什么", "count": 1 }]`（`count` 省略 = 全部替换）。
 * 为什么走文件而不是 URL 旗标：替换规则属于**宿主策略**（每个宿主一套），不该让壁纸 URL 携带它；
 * 也避免插件/测试台各自发明一套参数。同样按 mtime 失效，改完不必重启服务。
 * 用途见台账第 17 条（网页档作者内嵌的署名文字/图标路径换成宿主自己的）。
 */
const WEB_REPLACE_FILE = () => path.join(REPORTS_DIR, 'web-replace.json')
let webReplaceCache = { mtimeMs: -1, list: [] }
/* [we-json:strict|host-state] **不是包内/包旁 JSON**：读的是 `<reports>/web-replace.json` = **宿主自己**的策略表
   （本服务 REPORTS_DIR 下、由人/宿主写）。⇒ 保持严格：策略是"注入面内容替换"的授权表，
   宽容会把一份**写坏的**策略当成有效策略用（或悄悄当成空表），两种都不是"如实用户写的"。
   这里已有诊断（stderr 一行 + 按空表处理），不是静默。 */
function webReplacements() {
  const file = WEB_REPLACE_FILE()
  let mtimeMs = -2
  try { mtimeMs = fs.statSync(file).mtimeMs } catch { mtimeMs = -1 }
  if (mtimeMs !== webReplaceCache.mtimeMs) {
    let list = []
    if (mtimeMs >= 0) {
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
        const arr = Array.isArray(j) ? j : (j && Array.isArray(j.replacements) ? j.replacements : [])
        list = arr.filter((r) => r && typeof r.from === 'string' && r.from).map((r) => ({ from: r.from, to: typeof r.to === 'string' ? r.to : '', count: r.count }))
      } catch (e) { try { process.stderr.write('[web-replace] 解析失败，按空表处理：' + (e && e.message) + '\n') } catch { /* ignore */ } }
    }
    webReplaceCache = { mtimeMs, list }
  }
  return webReplaceCache.list
}
function webShimSource() {
  const file = fileURLToPath(new URL('../core/we-web-shim.mjs', import.meta.url))
  let mtimeMs = 0
  try { mtimeMs = fs.statSync(file).mtimeMs } catch { /* 取不到就退化成"每次重建" */ }
  if (mtimeMs !== webShimCache.mtimeMs || !webShimCache.source) {
    webShimCache = { mtimeMs, source: buildWebShimSource() }
  }
  return webShimCache.source
}
/** web 帧首帧种子：作者属性默认值（+ reports 里的覆盖）+ 该壁纸的存储快照（不透明源 facade 回灌用）。 */
function webSeedFor(item, dir, rel) {
  const raw = (() => { try { const p = readProjectJson(dir); return (p && p.general && p.general.properties) || null } catch { return null } })()
  const ov = readOverrides(item)
  const props = {}
  if (raw && typeof raw === 'object') {
    for (const [k, d] of Object.entries(raw)) {
      if (typeof k !== 'string' || !PROP_NAME_RE.test(k)) continue
      const def = (d && typeof d === 'object' && Object.prototype.hasOwnProperty.call(d, 'value')) ? d.value : null
      props[k] = { value: Object.prototype.hasOwnProperty.call(ov, k) ? ov[k] : def }
    }
  }
  const wallId = webWallIdFor(item, rel)
  return { op: 'props', props, store: { wallId, data: readWebStore(wallId) } }
}
/**
 * `/media/dev/<…>` / `/web/dev/<…>` 的 **itemId / rel 切分**（③嵌套 itemId 的唯一入口）。
 * 取**最长的"目录前缀"**当 itemId（= 老的 `<itemId>/<rel…>` 读法，多层级也成立）；
 * 一个目录前缀都不成立 ⇒ 整条当一个**单文件项**的 itemId（`rel` 为空，直接回那个文件）。
 * 段校验走 `assertItemPath`（单段名 + 不给 `.`/`..`/控制符），路径校验走 `safeJoin` —— 与别的路由同一套。
 * `rel`（给 `safeJoin` 用的那一段）**保持百分号编码原样**：老的 `/media/dev/**` 就是这么传的
 * （`safeJoin` 内部解码一次），这样 rel 里的 `%` 行为与改动前逐字一致；`rawRel` 只是原样回显/诊断用。
 */
function splitItemRel(rawPath) {
  const parts = String(rawPath || '').split('/')
  const dec = (s) => { try { return decodeURIComponent(s) } catch { return s } }
  const dparts = parts.map(dec)
  if (!dparts.length || !dparts[0]) throw bad('缺少 itemId：/media/dev/<itemId>/<rel>')
  let best = null
  for (let n = 1; n < dparts.length; n++) {
    let cand
    try { cand = assertItemPath(dparts.slice(0, n).join('/')) } catch { break }   // 这一段就不合法 ⇒ 更长的也不合法
    const st = statSafe(safeJoin(activeRoot, cand, 'itemId'))
    if (st && st.isDirectory()) best = { item: cand, n }
  }
  if (best) return { item: best.item, rel: parts.slice(best.n).join('/'), rawRel: parts.slice(best.n).join('/') }
  const item = assertItemPath(dparts.join('/'))
  return { item, rel: '', rawRel: '' }
}

/**
 * `/web/dev/<itemId>/<rel>`：与 `mediaServe` 同一套路径校验，差别只有一条 ——
 * **HTML 响应会注入 WE API shim**（不透明源 CORS 也在这里给）。
 * 纪律：`?mpwshim=0`、非 HTML、HEAD、超过 8MB、命中阻塞性 CSP ⇒ **逐字节原样**（只在响应头留痕）。
 */
function webMediaServe(req, res, item, rel, rawRel, url) {
  const loc = itemLocate(item)
  if (!loc.isDir) {
    // ③单文件项（不会命中下面的 HTML 注入：容器/视频都不是 html）⇒ 原样直出。
    if (rel) throw notFound(`文件不存在：/web/dev/${item}/${rel}`)
    return sendFile(req, res, loc.abs, { headers: opaqueCorsHeaders(req.headers.origin) })
  }
  const dir = loc.dir
  if (!rel) throw notFound(`缺少文件路径：/web/dev/${item}/`)
  const file = safeJoin(dir, rel, '文件路径')
  const fst = statSafe(file)
  if (!fst || !fst.isFile()) throw notFound(`文件不存在：/web/dev/${item}/${rawRel}`)
  const freal = realpathDeepest(file)
  if (!isInside(activeRoot, freal)) throw forbidden(`文件经符号链接越出库根：${rel}`)
  const cors = opaqueCorsHeaders(req.headers.origin)
  const htmlish = /\.(html?|xhtml)$/i.test(rel)
  const off = url && url.searchParams.get('mpwshim') === '0'
  if (!htmlish || off || req.method === 'HEAD') {
    return sendFile(req, res, file, { headers: Object.assign({ 'X-Mpw-Shim': off ? 'off-by-query' : 'not-html' }, cors) })
  }
  let out
  try {
    const html = fs.readFileSync(file, 'utf8')
    out = injectWebShim(html, { shimSource: webShimSource(), seed: webSeedFor(item, dir, rel), replacements: webReplacements() })
  } catch (e) {
    /* 读/注入失败只 warn 不 500（原样发文件，别把壁纸弄成打不开） */
    try { process.stderr.write('[web-shim] 注入失败 ' + item + '/' + rel + '：' + (e && e.message) + '\n') } catch { /* ignore */ }
    return sendFile(req, res, file, { headers: Object.assign({ 'X-Mpw-Shim': 'error' }, cors) })
  }
  const headers = Object.assign({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': NO_STORE,
    'X-Bench-Server': 'we-scene-demo-8902',
    'X-Mpw-Shim': out.injected ? 'injected' : ('skipped:' + out.reason),
    /* 替换表命中数如实写响应头（0 也写：能一眼区分"没配替换表"与"配了但一条没命中"）。 */
    'X-Mpw-Shim-Replaced': String(out.replaced || 0),
  }, cors)
  if (!out.injected) return sendFile(req, res, file, { headers })
  res.writeHead(200, Object.assign({ 'Content-Length': String(Buffer.byteLength(out.html)) }, headers))
  res.end(out.html)
  return true
}

/** `/media/dev/<itemId>/<rel>`：库根内只读 + Range。③`itemId` 可为目录项或单文件项（嵌套路径）。 */
function mediaServe(req, res, item, rel, rawRel, prefix) {
  const loc = itemLocate(item)
  if (!loc.isDir) {
    // ③单文件项（`.mpkg` 一等项走这条，也顺带让 `<角色>/<x>.mpkg` 的两种读法都能取到同一份字节）
    if (rel) throw notFound(`文件不存在：${prefix}${item}/${rawRel}`)
    if (!sendFile(req, res, loc.abs, { headers: opaqueCorsHeaders(req.headers.origin) })) throw notFound(`文件不可读：${item}`)
    return undefined
  }
  const dir = loc.dir
  if (!rel) throw notFound(`缺少文件路径：${prefix}${item}/`)
  const file = safeJoin(dir, rel, '文件路径')
  const fst = statSafe(file)
  if (!fst || !fst.isFile()) throw notFound(`文件不存在：${prefix}${item}/${rawRel}`)
  const freal = realpathDeepest(file)
  if (!isInside(activeRoot, freal)) throw forbidden(`文件经符号链接越出库根：${rel}`)
  /* ⑥ 不透明源（sandbox 帧）要能用 fetch 取资源：**恰好** `Origin: null` 才给 CORS 头。 */
  if (!sendFile(req, res, file, { headers: opaqueCorsHeaders(req.headers.origin) })) throw notFound(`文件不可读：${rel}`)
  return undefined
}

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n') } catch { /* 已断开 */ }
  void err
})
server.listen(PORT, BIND_HOST, () => {
  const opener = findOpener()
  const healthSnap = health()
  const line = (s) => console.log(`[8902] ${s}`)
  line(`一站式测试台服务已启动：http://${BIND_HOST}:${PORT}/`
    + (BIND_IS_LOOPBACK ? '（只回环；要局域网访问请显式 MPW_BIND=0.0.0.0）' : '（**非回环绑定**：同网段可直连，请确认这是你要的）'))
  line(`  静态测试台     : ${STATIC_ROOT} 挂载在 / 、/demo/ 、/WEwebLoader/ 、/wallpaper-engine-webgl/（${STORE ? 'cache' : 'no-store'}）`)
  line(`  渲染器 iframe  : http://127.0.0.1:${PORT}/wallpaper-engine-webgl/renderer/index.html?type=scene&src=<itemId>（产物写死的路径）`)
  line(`  渲染器面(本地) : /webloader/** 与渲染器根路由（/bundle.js /core/** /elysia/** /pkg/<id> /project/<id> …）` +
    `由本服务**本地直供**（同一份 rendererRequestHandler；响应头 X-Bench-Served: local）` +
    (RENDERER_UPSTREAM ? `；上游=可选（${RENDERER_UPSTREAM.raw}${RENDERER_UPSTREAM.bad ? ' ← **拒绝/解析不了**（' + (RENDERER_UPSTREAM.badReason || '值无法解析') + '），按本地直供' : '，连不上则回退本地'}）` : '；上游=未配置（不需要 :8899）'))
  line(`  壁纸库根(只读) : ${activeRoot}${statSafe(activeRoot) ? '' : '  ← **不存在**（/api/library 会返回 missing+error）'}`)
  const lib = healthSnap.library
  line(`  库来源(显式)   : source=${lib.source} selected=${lib.selected}（${lib.reason}）`)
  line(`  浏览根(只读)   : ${BROWSE_ROOTS.join(' , ')}（${BROWSE_ROOTS_FROM}）—— 选择器：GET /api/fs/roots·list·file · GET /api/dir-list · GET /api/dir-parent · POST /api/dir-pick · 兼容壳 GET /list-dirs`)
  line(`  全类型扫描     : ${JSON.stringify(healthSnap.libraryScan.kinds || {})}（container: ${JSON.stringify(healthSnap.libraryScan.containerKinds || {})}）` +
    `；跳过 ${healthSnap.libraryScan.skipped == null ? '?' : healthSnap.libraryScan.skipped} 项（原因见 /api/library 的 scan.skippedList）`)
  line(`  缩略图         : GET /api/thumb?item=&w=（现成 preview.* 直出${healthSnap.thumb.available ? '；视频档用 ' + healthSnap.thumb.ffmpeg + ' 抽帧' : '；**没有 ffmpeg** ⇒ 无 preview 的视频档如实 501'}）`)
  line(`  属性覆盖落点   : ${PROPS_DIR}/<itemId>.json（不写进壁纸包；缩略图缓存落 ${THUMB_DIR}）`)
  line(`  回收站         : ${TRASH_ROOT}/<时间戳>/<itemId>（删除默认 dryRun；?confirm=1 才移入；可 mv 回滚）`)
  line(`  诊断流         : GET /api/diag-stream（SSE，环形缓冲 ${LIMITS.diagBuffer} 条；来源 GET /diag?msg= 与 POST /diag，**不代理 :8899**）`)
  line(`  上报落盘       : POST /report ⇒ ${path.join(REPORTS_DIR, 'r<ts>.json')}（≤${LIMITS.reportMaxFiles} 份 / ${Math.round(LIMITS.reportMaxBytes / 1048576)}MB，最旧先删）`)
  line(`                   POST /baseline ⇒ ${path.join(REPORTS_DIR, 'baselines', '<ts>.json')}（≤${LIMITS.baselineMaxFiles} 份 / ${Math.round(LIMITS.baselineMaxBytes / 1048576)}MB；schema ${BASELINE_SCHEMA}，校验不过 400 不落盘）`)
  line(`  健康自述       : http://127.0.0.1:${PORT}/__health`)
  line(`  降级为 501 的能力（见 /__health.degraded）：`)
  for (const d of healthSnap.degraded) line(`    · ${d.endpoint} ${d.when} → 能力 501（${d.capability}）；HTTP 用 ${d.httpStatusUsed}：${d.reason.slice(0, 60)}…`)
  line(opener ? `  /api/reveal 打开器：${opener.path}` : '  /api/reveal 打开器：**没有**（找不到 termux-open/xdg-open/open/explorer ⇒ 真回 501 + 说明）')
  line(`已就绪。curl 自检： curl -s http://127.0.0.1:${PORT}/__health | head -30`)
})

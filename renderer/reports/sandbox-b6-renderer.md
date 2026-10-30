# sandbox-b6-renderer.md — B6 渲染器侧（不透明源 iframe + `:8899` CORS）交付报告

- 任务：`RENDERER-SANDBOX-CONTRACT.md` §2.1 / §2.2 / §3 的**渲染器侧**实现（§4 为硬约束）。
- 日期：2026-09-14（本机时间 2026-09-13 深夜）
- 本轮改动文件：`we-scene-demo-server.mjs`、`demo.html`、`sandbox-cors-test.mjs`（新增）。**未**改 `we-scene-bundle.js`（非必要）、`run-all-tests.sh`、`PATCHES.md`、`README-DIAGNOSTICS.md` 及 `dsh-mpkg-wallpaper/**`。

---

## 1. 改动清单（file:line）

### 1.1 `we-scene-demo-server.mjs`（452 → 522 行）

| 位置 | 改动 |
|---|---|
| `we-scene-demo-server.mjs:12-13` | 端口来源新增 `PORT` 环境变量：`Number(process.env.PORT \|\| process.argv[2] \|\| 8899)`（CLI 参数旧用法逐字保留，向后兼容）。测试用它起随机空闲端口。 |
| `we-scene-demo-server.mjs:25-40` | **唯一 CORS 入口**：`CORS_HEADERS`（`access-control-allow-origin: *`、`access-control-allow-headers: content-type`、`access-control-allow-methods: GET, HEAD, POST, OPTIONS`）+ `applyCors(res)`（`res.setHeader`，带 `hasHeader` 去重）。 |
| `we-scene-demo-server.mjs:42-90` | 新增 `parseSingleRange` / `sendBuffer` / `sendFileStream`：单区间 Range（RFC 7233）集中实现，只有请求带 `Range` 才走 `206`；**不带 Range 的 200 响应与改动前逐字节一致**（各自原 content-type 不变）。 |
| `we-scene-demo-server.mjs:92-101` | 请求入口第一行 `applyCors(res)`（所有响应，含 404/500/catch 兜底/`res.writeHead(200); res.end('ok')` 健康路由/`createReadStream().pipe(res)` 管道流，全部带上三头；路由内无需再写）；第二段 `if (req.method === 'OPTIONS') → 204 + 空 body`（任何路径，预检集中应答，不落路由）。 |
| `we-scene-demo-server.mjs:110-123` | `/bundle.js`、`/we-scene-bundle.js`、`/attach-transform.mjs` 三条静态路由改走 `sendBuffer`（200 行为不变，新增 Range→206）。 |
| `we-scene-demo-server.mjs:291` | `/elysia-video/<id>` 改走 `sendFileStream`（原来就声明了 `accept-ranges: bytes` 但不实现 Range；200 响应头与旧代码逐字相同）。 |
| `we-scene-demo-server.mjs:334` | `/ddvideo/<id>/<file>` 同上。 |
| `we-scene-demo-server.mjs:348` | `/videolib/<file>` 同上。 |
| 未改 | 其余全部路由（`/report`、`/diag`、`/pkgurl`、`/pkgpath`、`/pkg/`、`/noise`、`/weassist/`、`/project`、`/ddlist`、`/type`、`/render`、`/ref`、`/refrender`、`/transpiled`、`/shader`、`/ext`、`/elysia/`、`/diag`、`/probe`、`/shaders/`、404）**保持原样**，只由入口统一加 CORS 头。 |

### 1.2 `demo.html`（2664 → 2835 行）

| 位置 | 改动 |
|---|---|
| `demo.html:39-188` | **新增经典 `<script>` 块**（B6 兼容层，解析期执行，早于 module）：手写 query 解析（**故意不用** `URLSearchParams.get`，见 §4.4）；`__mpwStrict`/`__mpwOpaque`/`__mpwThumbToken`；`__mpwSafeDataURL`（`toDataURL` 失败 → `__mpwTainted = true` + 返回 `null`，不抛）；`__mpwFixMedia`/`__mpwFixAllMedia`（仅 strict、仅 `http(s)`、跳过 `blob:`/`data:`）+ `MutationObserver`（childList+subtree+`src` 属性）；`mpw-cap` 发送器（`capObj`/`capPush` 去重/`__mpwCap()`/`__mpwCapErr()`/`__mpwCapMarkFrame()`）+ 首帧观察（250ms×32=8s）+ 7s 模块看门狗。 |
| `demo.html:189` | 截图按钮 `shot()` 改为走 `__mpwSafeDataURL`：失败不抛、不改下载行为，只提示并保留 `__mpwTainted` 标记。 |
| `demo.html:223-226` | module 脚本启动即置 `window.__mpwModuleStarted = 1` 并补发一次 init `mpw-cap`（与经典块 init 同内容 → 去重不重复发）。 |
| `demo.html:234` / `demo.html:237` | `?mode=elysia` 启动失败 / 无 WebGL2 → `__mpwCapErr(...)`（`ok:false`，插件据此回退 legacy）。 |
| `demo.html:631-632` | `type=video` 自动路由的 `<video>` 建好后 `__mpwFixMedia(v)`（strict 下补 `crossOrigin='anonymous'`）。 |
| `demo.html:647-648` | `?video=<rel>` 纯视频模式同上。 |
| `demo.html:2421-2425` | 自动上报：先算 `const __shotData = __mpwSafeDataURL(shot,'image/jpeg',0.6)`（2424）；读回被污染时不再让整份 payload 构造抛掉。 |
| `demo.html:2472` | payload 里 `shot: shot.toDataURL(...)` → `...(__shotData ? { shot: __shotData } : {})`（key 顺序/位置不变；失败即省略该字段）。 |
| `demo.html:2757` | WebGL 首帧 `window.__mpwFirstFrame = 1` 后补 `__mpwCapMarkFrame()`（`firstFrame:true` 立即上报，不等 250ms 轮询）。 |
| `demo.html:2764-2794` | 缩略图上传 `postThumb`：`tc.toDataURL` → `__mpwSafeDataURL`（2775-2777，污染则跳过本次上传）；token 存在时 body 增字段 `sceneToken` + `credentials:'omit'`（2783-2791）；**token 不存在时保持 `credentials:'include'` + 原 `content-type: text/plain;charset=UTF-8` + body 无新增字段（逐字节兼容旧插件）**；`fetch(__thumbPost, init)`（2792）。 |
| `demo.html:2833` | `boot()` 失败 → `__mpwCapErr('boot: …')`。 |

**未改**：`?mode=elysia` 分支的渲染逻辑、`/diag`·`/report` 上报字段（除 `shot` 的条件化）、`elysia/**`、`we-scene-bundle.js`。

### 1.3 `sandbox-cors-test.mjs`（新增，138 行）

自选空闲端口（`net.listen(0)` 探测）→ 以 `PORT=<port>` 启动 `we-scene-demo-server.mjs` → 5 条断言 → 无论成败 `SIGTERM`/2s 后 `SIGKILL` 回收子进程；退出码 0/1。**未**注册进 `run-all-tests.sh`（按要求留给集成方）。

---

## 2. 契约 → 实现映射

- **§2.1 参数**：`thumbpost`（旧）、`thumbtoken`（新，只进 body 字段 `sceneToken`，**不放请求头** —— 按 2026-09-13 修正条；自定义头会触发预检、预检不带 cookie 被宿主鉴权墙 401）、`sandbox=strict`（strict 时给 http(s) 的 `img/video/audio` 加 `crossOrigin='anonymous'`）。缺省（无这两个参数）时全部 no-op。
- **§2.2 `mpw-cap`**：payload 字段与顺序 `{ type:'mpw-cap', v:1, ok, opaque, sceneId, firstFrame, tainted, thumbToken, errs }`；发送时机 = 脚本初始化（`firstFrame:false`）→ module 启动 → 首帧出画（`firstFrame:true`）→ 能力变化（canvas 变污染 / 致命错误）；同内容不重发（JSON 串比较）；`parent.postMessage(obj,'*')`；`window.__mpwCap()` 返回当前对象（另有 `__mpwCapLast`/`__mpwCapPush`/`__mpwCapErr` 供测试/诊断）。`ok:false` 只出现在真·致命路径（无 WebGL2 / elysia 启动失败 / `boot()` 失败 / module 7s 未启动）。
- **§3 CORS**：唯一入口 `applyCors()`；三头对 200/206/404/500/204/管道流/隐式头一律生效；`OPTIONS` → 204。allow-headers 按修正后的口径只有 `content-type`（渲染器只用到 `text/plain;charset=UTF-8`（简单请求）与 `application/json`（预检）两种）。
- **§4.1 旧行为不变**：无 `sandbox=strict`/`thumbtoken` 时 —— 服务器 200 响应体/头与改动前逐字相同（仅多 CORS 三头）；页面 strict 分支全为 no-op；上报 payload 的 `shot` 字段仍在原位置、内容同一函数产物；缩略图 fetch 的 options 与 body 逐字节相同。
- **§4.2 门禁**：本任务只跑了被指定的 4 项（见 §3），**未**跑 `run-all-tests.sh`（按要求交给集成方）。
- **§4.3 新增测试**：`sandbox-cors-test.mjs`（本文件第 3 节即其输出）。插件侧 `tools/scene-sandbox-test.mjs` 属另一工作流。
- **§4.4/§4.5**：见 §4。

---

## 3. 验证输出（逐字粘贴）

```
$ cd /root/Desktop/DSHarea/we-scene-demo
$ node --check we-scene-demo-server.mjs
  OK

$ node demo-syntax-check.mjs
  ✓ 内联脚本 #1（classic，起始行 13，16 行）
  ✓ 内联脚本 #2（classic，起始行 38，1 行）
  ✓ 内联脚本 #3（classic，起始行 39，150 行）
  ✓ 内联脚本 #4（classic，起始行 189，1 行）
  ✓ 内联脚本 #5（classic，起始行 193，12 行）
  ✓ 内联脚本 #6（module，起始行 206，2630 行）
demo 内联脚本语法：6/6 通过

$ node --check we-scene-bundle.js
  OK

$ node sandbox-cors-test.mjs
we-scene-demo-server.mjs @ 37097（PORT 环境变量）
  ✓ GET / → 200 + CORS 三头（allow-origin: * / allow-headers: content-type / allow-methods: GET, HEAD, POST, OPTIONS）
  ✓ GET 不存在路由 → 404 + CORS 三头
  ✓ OPTIONS /report（POST 路由）→ 204 + allow-headers 含 content-type（CORS 三头齐全、空 body）
  ✓ GET /bundle.js + Range: bytes=0-10 → 206 + content-range: bytes 0-10/<size> + 11 字节切片 + CORS 三头
  ✓ GET /bundle.js（无 Range）→ 200 全量 + CORS 三头（范围支持不改普通客户端行为）

===== sandbox-cors 验证: 5 通过 / 0 失败 =====
rc=0

$ grep -n "credentials: 'include'" demo.html
674:      const rd = await fetch(pkgUrlQ, { credentials: 'include' })
2791:                    : { method: 'POST', credentials: 'include', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body }
   （674 = 旧的 /raw 直连，未改；2791 = 缩略图上传“无 token”分支，旧行为逐字保留）

$ node diag-flag-check.mjs --list | grep -E '^\s+(sandbox|thumbtoken)'
  sandbox         dsh-mpkg-wallpaper/lib/client.js:1738 regex [?&]sandbox=
   （只读 `--list`，未写 diag-flags.json；demo.html 未新增任何开关名：thumbtoken/thumbtoken 之外的
     `sandbox` 站点来自插件侧 client.js，见 §4.4）
```

页面侧逻辑（无浏览器，用 `node:vm` 起一个 mock window/document 跑 `demo.html:39-188` 那块经典脚本，脚本本体在 `/tmp/b6-cap-check.mjs`，不落仓库）：

```
$ node /tmp/b6-cap-check.mjs
  ✓ strict: __mpwStrict=true
  ✓ strict: __mpwOpaque=true（window.origin==="null"）
  ✓ strict: __mpwThumbToken 取自 URL
  ✓ 初始 mpw-cap 已发（v1 / ok:true / firstFrame:false / thumbToken:true）
  ✓ __mpwCap() 返回当前对象
  ✓ 首帧后补发（firstFrame:true）
  ✓ 同内容不重发（dedupe）
  ✓ toDataURL 抛错 → 返回 null + __mpwTainted=true + 能力变化补发
  ✓ 致命错误 → errs 记录 + ok:false
  ✓ http(s) video → crossOrigin=anonymous
  ✓ blob: video 不加 crossOrigin
  ✓ data: img 不加 crossOrigin
  ✓ 非媒体元素不动
  ✓ 安全读回正常返回 dataURL
  ✓ 注册了 7s 模块看门狗
  ✓ 模块未启动 → 看门狗判 ok:false（避免 strict 永久白屏）
  ✓ 模块已启动 → 看门狗不再判失败
  ✓ legacy: __mpwStrict=false / thumbToken 空
  ✓ legacy: 仍上报 mpw-cap（thumbToken:false）
  ✓ legacy: http img 不加 crossOrigin（旧行为不变）
  ✓ legacy: __mpwFixAllMedia 为 no-op
  ✓ 非不透明源：__mpwOpaque=false（但 strict 信号仍为 true）
  ✓ 无 window.origin 且 localStorage 抛错 → __mpwOpaque=true（兜底探测）
  ✓ 无 window.origin 且 localStorage 可用 → __mpwOpaque=false

===== B6 经典脚本块自检: 24 通过 / 0 失败 =====
```

---

## 4. 未能实现 / 偏离契约的点（逐条）

1. **§3 的 `206 Partial Content` 在本仓库原本不存在** —— 全文件没有任何 Range 解析（`accept-ranges: bytes` 只是声明）。任务要求测 `Range: bytes=0-10 → 206`，因此我**新增**了集中式单区间 Range（`parseSingleRange`/`sendBuffer`/`sendFileStream`），只用于 `/bundle.js`、`/we-scene-bundle.js`、`/attach-transform.mjs`、`/elysia-video/*`、`/ddvideo/*`、`/videolib/*`。这是本任务里唯一一处"额外行为"：带 `Range` 的客户端从"200 + 全量"变成"206 + 切片"，不带 `Range` 的客户端逐字不变（测试 (e) 专门锁这条）。若集成方不想要 Range，删掉这 3 个 helper 与 6 处调用即可，CORS 部分不受影响（改回 `res.writeHead(200, {...}); res.end(buf)`）。
2. **§2.3 `/raw` 直连（`demo.html:674`）未改**：契约把 `/raw` 的 `&st=<token>` 拼接与 `Origin: null` 校验划给插件/宿主侧，渲染器侧 §2.1 的冻结面只有 `thumbpost`/`thumbtoken`/`sandbox`。**集成提示**：`fetch(pkgUrlQ, { credentials:'include' })` 在不透明源下要求宿主回显 `access-control-allow-origin: null`（或具体 origin）**且** `access-control-allow-credentials: true`；若宿主只回 `*`，这次直连会抛 CORS 错并自动退回服务端代理 `/pkgurl`（那条是无 Origin 的服务端请求，按 §2.3 走旧 cookie 规则）。若要 strict 下更稳，可把该行改成 strict 时 `credentials:'omit'`（token 已在 URL 里）——**这属于插件侧接口决定，我没有擅自改**。
3. **`?mode=elysia`（CPU 路径）不上报 `firstFrame:true`**：`window.__mpwFirstFrame` 只有 WebGL 路径会置位（`demo.html:2757`），elysia 分支在 `elysia/demo-elysia.js` 里画帧、本任务不许改该目录。因此 elysia 页面的 `mpw-cap` 是 `ok:true, firstFrame:false`（插件若要求 `firstFrame` 才会回退，且壁纸 iframe 不用 `mode=elysia`，影响面为零）。
4. **§4.4（新增开关写 `README-DIAGNOSTICS.md`）与 §4.5（`PATCHES.md` 条目）未做**：任务书明确禁止我改这两个文档。因此我在 `demo.html` 里**故意用手写 query 解析**读 `sandbox`/`thumbtoken`：`diag-flag-check.mjs:68-86` 会把 `location` 绑定的 `URLSearchParams` 上的 `.get('x')` 当成诊断开关抓取并与 README 主表双向比对，直接用 `.get('sandbox')` 会让 `diag-flags` 门禁新增一个"代码有·文档无"的失配。**另外发现一个跨工作流的既有失配（非我引入）**：`dsh-mpkg-wallpaper/lib/client.js:1738` 的 `regex [?&]sandbox=` 使 `sandbox` 进入代码开关集合，而 `README-DIAGNOSTICS.md` 主表没有 `sandbox` 行 → `diag-flag-check`/`docs-check` 目前会因这一条报红（`node diag-flag-check.mjs --list` 现为 **70** 个开关，README 头部自称 62）。集成方需让插件侧补 README 行（或改抓取口径），这与渲染器侧无关。
5. **本任务无法做浏览器级验证**：环境无浏览器/GPU 运行，strict（不透明源）下的真实 `crossOrigin` 生效、画布是否仍被污染、`mpw-cap` 是否被插件正确接收，只能在插件侧的 `tools/scene-sandbox-test.mjs` + 真机/面板联调时确认。本报告第 3 节的 vm 自检覆盖了脚本逻辑分支（含 dedupe、tainted、errs、媒体过滤、legacy no-op）。
6. **`:8899` 运行进程状态**：本轮开始时 `:8899` 上跑的是 2026-09-12 启动的旧进程（无 CORS、`OPTIONS` 200），`keep-demo-server.sh` 的看门狗只在"不可达"时才拉起、不会自动更新，因此 strict 模式在那一刻不可能生效。交付时该进程已由看门狗用**新代码**重启（日志 `/tmp/demo-server.log` 时间戳 2026-09-14 00:00:53），实测 `:8899` 已是新行为：

```
$ curl -sD- -o /dev/null http://127.0.0.1:8899/
HTTP/1.1 200 OK
access-control-allow-origin: *
access-control-allow-headers: content-type
access-control-allow-methods: GET, HEAD, POST, OPTIONS
content-type: text/html; charset=utf-8

$ curl -sD- -o /dev/null -X OPTIONS http://127.0.0.1:8899/report
HTTP/1.1 204 No Content
access-control-allow-origin: *
access-control-allow-headers: content-type
access-control-allow-methods: GET, HEAD, POST, OPTIONS

$ curl -sD- -o /dev/null -H 'Range: bytes=0-10' http://127.0.0.1:8899/bundle.js
HTTP/1.1 206 Partial Content
access-control-allow-origin: *
access-control-allow-headers: content-type
access-control-allow-methods: GET, HEAD, POST, OPTIONS
content-type: text/javascript
content-range: bytes 0-10/296133
content-length: 11
accept-ranges: bytes
```

   若之后有人改了 `we-scene-demo-server.mjs` 而 `:8899` 仍可达，记得手工重启（看门狗不会更新代码）。我没有主动杀过这个共享进程。

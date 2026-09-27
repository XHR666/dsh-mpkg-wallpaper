# 宿主路由的来源闸门（P-204，2026-09-27）+ 网页帧同源逃逸 / 可控上游（P-205，2026-09-28）

> **一句话**：插件挂在 DSH 宿主上的 40+ 条 HTTP 路由此前**零鉴权、零 Origin/Host 校验**，且 `/raw`
> 把**任意 Origin** 回显成 `Access-Control-Allow-Origin` + `allow-credentials: true` ⇒ 任意网页可
> 「盲改 `customDir` → 跨源读回本机文件」。P-204 收口了宿主路由（F1–F4）；**P-205 收口了浏览器侧
> 剩下的两条**：网页壁纸 iframe 能被一条 `postMessage` 升到 **DSH 同源**（F5），以及
> `sceneRendererUrl`/`sceneExtUrl` 允许任意上游 + 场景令牌 `st` 随 URL 下发（F6）。
>
> 审计报告（同工作区，含逐条复现读数）：`../docs/reverse/SECURITY-AUDIT-secret-exfil-20260925.md`
> 判据（常驻门禁）：`tools/sec-route-guard-test.mjs`（P-204，45 断言）、
> `tools/web-frame-origin-guard-test.mjs`（P-205 F5，45 断言）、
> `tools/scene-url-token-guard-test.mjs`（P-205 F6，41 断言）；三条都注册在 `tools/check.sh` 第 5 步。
> 渲染器侧的对应收口：`../../we-scene-demo/docs/PATCHES.md` 的 **P-204**

## 1. 漏洞（审计 F1–F4，均有可复现读数）

| # | 漏洞 | 关键位置（改前） | 后果 |
|---|---|---|---|
| F1 | `/raw` 对**任意 Origin** 回显 ACAO + `allow-credentials: true` | `const origin = (req.headers.origin) \|\| '*'` → `cors` 对象 | 任意网页跨源读走本机文件（实测 `Origin: https://evil.example` → 200 + ACAO 回显 + 内容） |
| F2 | 全部路由零 CSRF：`POST /custom-dir`、`/settings`、`/diag`、`/upload`、`/update-apply`… | 框架层 `handle()` 直呼 `route.handler`，插件不校验 | `text/plain` 简单请求**免预检** ⇒ 任意网页可盲发状态变更 |
| F3 | `customDir` 只校验"目录存在" | `/custom-dir` 的 `existsSync(dir) && isDirectory()` | 指向 `~/.ssh` / `~/.aws` / 任意目录后，`/raw?file=<任意单段文件名>` 就能读 `id_rsa` 这类**无点前缀**文件 |
| F4 | `/scene-thumb-token` 对**任意身份**无鉴权签发 | 只校验 `scene` 长度 | 「不透明源必须带 `st`」形同虚设：攻击者自签 `custom\|\|<任意文件>` 即绕过 |

## 2. 修法（唯一的实现处）

| 符号 | 位置 | 做什么 |
|---|---|---|
| `corsOriginAllowed(origin)` | `lib/index.js:270` | 白名单判定：`null`（不透明源沙箱帧）恒允许；默认再放 `http://127.0.0.1:3080\|8899\|8902`（含 `localhost` 同义）；`*`/空/其它一律不放 |
| `corsForOrigin(req, extra, includeCredentials)` | `lib/index.js:278` | **三处 ACAO 回显**（`/raw`、音频路由的 `corsFor`、`/custom-scene-thumb`）+ `/lg` 静态 JS 全部改走它。非白名单 ⇒ **一个 `Access-Control-Allow-*` 都不发**（只留 `Vary: Origin`） |
| `secGateDecision(req, route)` | `lib/index.js:308` | 非 GET/HEAD/OPTIONS 的**写闸门**：`Sec-Fetch-Site` 有则必须 `same-origin`/`none`；`Origin` 必须在白名单（或"与 `Host` 同为字面 IP/localhost 的同源"）。`/scene-thumb-token` 与 `/settings` **连 GET 也过闸**；令牌签发额外拒 `Origin: null`（不允许沙箱帧自签） |
| `gatedWebServer(ws)` | `lib/index.js:366` | 包住宿主的 `webServer`（`lib/index.js:2206`）⇒ **所有** 经 `register()` 挂上的路由自动过闸（改一处覆盖 40+ 路由，新增路由自动被管，无需逐条改 handler） |
| `secCustomDirDenied(dir)` | `lib/index.js:331` | `/custom-dir` 的敏感目录黑名单：点开头的**路径段**、家目录自身/其父、`/etc`、`/root`、`/usr`… 、文件系统根 ⇒ 403 + 可读 `reason` |
| `secRawFileAllowed(file)` | `lib/index.js:357` | `/raw` 的 `file` **扩展名白名单**（容器/图片/视频/音频/json）。`/raw` 的两个真实用途是"整份容器喂渲染器"与"单段音轨喂 `<audio>`"；网页壁纸的 html/js/assets 走 `/custom-folder`、`/library-web`，**不受影响** |
| `secSceneIdentReason(scene)` | `lib/index.js:3716` | 令牌身份必须是**本机真存在**的场景：`custom\|<folder>\|<file>` 或 `library\|<ltoken>\|<file>`，`file` 需在白名单扩展名内、路径无 `..`/分隔符/点前缀、`folder`/`token` 能解析到真目录与真文件 |
| `GET /security` | `lib/index.js:3772` | **只读状态面**：闸门开关、白名单、被闸的写方法/GET 路径、扩展名白名单是否被回退口放开。现场"为什么我 403"不用翻源码 |

口径细节（为什么这样定）：

- **"无任何浏览器证据 ⇒ 放行"**：`curl`/离线桩不带 `Origin` 也不带 `Sec-Fetch-Site`。浏览器**无法**伪造或省略这两个头，
  所以"有就严格校验、没有按旧口径放行"既堵住 CSRF，又不破坏命令行与既有测试桩（`tools/*-test.mjs` 全是直呼 handler）。
- **局域网/手机不误伤**：`Origin` 与 `Host` 完全一致**且 Host 是字面 IP/localhost** 时放行（手机用
  `http://192.168.x.x:3080` 打开 DSH 的情形）；DNS 重绑定的 `Host` 是**域名**（`evil.example`）⇒ 仍被拒。
- **`/raw` 的字节仍可能被"盲取"**（写闸门只拦非 GET）：防护点是**没有 ACAO 就读不回**；这与浏览器模型一致。

## 3. 回退口（全部**默认关**，且可逆 —— 判据里逐条验证）

| env | 作用 | 风险 |
|---|---|---|
| `MPW_CSRF=0` | 关掉整道写闸门（F2 旧行为） | 任意网页又能盲发写请求 |
| `MPW_CORS_LEGACY=1` | 恢复"任意 Origin 回显 ACAO + credentials"（F1 旧行为） | 任意网页可跨源读回本机文件 |
| `MPW_CORS_ORIGINS=a,b` | **追加**白名单（渲染器换端口、反向代理域名） | 只影响被追加的源 |
| `MPW_CUSTOM_DIR_ALLOW_ANY=1` | `/raw` 不再限扩展名 | F3 的读文件面回到"任意单段文件名" |

**不可回退**的两条（有意为之）：`secCustomDirDenied` 的敏感目录黑名单；令牌签发的**身份真实性 + 拒 `Origin: null`**
（F4 的"令牌门形同虚设"不该留回退口）。

## 4. 判据（`tools/sec-route-guard-test.mjs`，45 通过 / 0 失败）

- **A1 攻击链（审计 §4.1 的自动化）**：evil 源 + `text/plain` 的 `POST /custom-dir` ⇒ **403**；
  `GET /raw?custom=1&file=topsecret.txt` ⇒ **403** 且**无 ACAO**；`id_rsa` ⇒ 403；`.credentials.yaml` ⇒ 403；
  `Origin: null` 自签 token ⇒ 403；同源但身份不存在 ⇒ 403。
- **A2 正常仍通**：同源改目录 ⇒ 200；`Origin: null` + 真 st 读真容器 ⇒ 200 + `ACAO: null` + 字节完整；
  白名单源（8899/8902）读音轨 ⇒ 200 + 回显；同源为真场景签 token ⇒ 200。
- **A3 回退口复现旧行为（= 变异必红）**：`MPW_CSRF=0` + `MPW_CORS_LEGACY=1` + `MPW_CUSTOM_DIR_ALLOW_ANY=1`
  下同一条链又变成 **200 + `ACAO: https://evil.example` + `allow-credentials: true` + 密文读回**；
  关掉回退口 ⇒ 恢复 403（可逆）。
- **B 纯函数矩阵**：白名单（null/3080/局域网同源/DNS 重绑定形态）、`secCustomDirDenied`（`~/.ssh`、`~/.dsh`、家目录）、
  `secRawFileAllowed`（容器/音轨放行，`.txt`/无后缀/`id_rsa` 拒）。
- **C 变异自证**：去掉扩展名白名单 / 去掉 CORS 白名单 / 去掉整道 CSRF 闸门 三组各自必红；身份校验不可回退（不存在的身份恒 403）。

另外同步改了两处既有门禁（**契约有意变更**，不是放宽）：

- `tools/host-sandbox-token-test.mjs`：夹具补真目录/真文件（P-204 起"身份必须真实存在"是签发前提），
  新增 H6（签发收口）与 H4b/H4c（白名单回显 / 非白名单无 ACAO）。20 → **25 通过 / 0 失败**。
- `tools/bundle-equivalence-test.mjs`：源码 ↔ 单文件 bundle 的路由对拍（两边同时带新闸门，逐字段仍一致）。

---

# F5 网页壁纸**同源逃逸**（P-205，2026-09-28）

## F5.1 根因（file:line 按符号对锚；行号会漂，请 `grep -n` 复核）

| 环节 | 符号 / 位置（改前） | 事实 |
|---|---|---|
| 入站校验只有 source | `mpwIsWebFrameMsg`（`lib/client.js`，原 `:4003`）→ 调用点 `:6017` | `ev.source === frame.contentWindow` 为真即放行；消息**确实**来自我们自己那个 frame ⇒ 挡不住作者页 |
| 自动降档路径 ①：shim 没报到 | `webShimArm`（`lib/client.js`，原 `:5914-5945`，`setAttribute('sandbox', MPW_WEB_COMPAT_ATTR)` 原 `:5938`、`frame.src = bare` 原 `:5940`） | 2.5s 未见 shim ready ⇒ 把 `sandbox` 换成 `allow-scripts allow-same-origin allow-pointer-lock` = **与 DSH 同源** |
| 自动降档路径 ②：帧内"策略类错误" | `mpwWebLooksPolicyBlocked` + `mpwWebSandboxFallback`（原 `:5907` / `:5914`），触发点 `mpwWebShimOnMessage` 的 `d.op==="error"`（原 `:6043`） | 作者页 `parent.postMessage({mpw:'mpw:web',op:'error',kind:'SecurityError',message:'…sandbox…'})` 即命中正则 ⇒ 同一条路升同源 |
| 档位表把"可降级"等同于"可降 compat" | `mpwWebFramePlanFor`（原 `:3799-3816`）；镜像源 `lib/web-wallpaper.js` 的 `webFramePlan`（`:148-157`，`degradable: m === 'auto'`） | `auto` 档允许降级，但**落点固定是 compat**（`MPW_WEB_COMPAT_ATTR`），没有"只降沙箱内"这一档 |
| 消费侧没有 origin 概念 | 同上 + `postMessage(…,'*')` 发送点（`lib/client.js` 8 处） | 帧内 shim 用 `'*'` 发；父页因此只能靠 source 判身份 |

审计行号引用（会漂）：`lib/client.js:3787` / `:5907→:5914→:5938/:5940` / 入站 `:4003`/`:6017`。

## F5.2 修法（唯一的实现处）

| 符号 | 位置 | 做什么 |
|---|---|---|
| `webFramePlan(mode, {autoCompatAllowed})` | `lib/web-wallpaper.js`（判定表**唯一源**） | 新增 `autoCompat` / `fallbackMode` / `fallbackAttr`：auto 档的自动降档落点默认 = `sandbox`（不透明源），只有显式回退口为 `true` 时才 = `compat` |
| `webFrameStatus(input)` | 同上 | 状态里如实播报 `autoCompat` / `fallbackMode`（现场一眼看出"自动路径能不能进 compat"） |
| `mpwWebFramePlanFor(mode, autoCompatAllowed)` / `mpwWebFrameAutoCompat()` | `lib/client.js`（镜像 + 设置项读取） | 客户端镜像同一张表；回退口只认显式真值（`true`/`1`/`"1"`/`"true"`/`"on"`/`"yes"`） |
| `mpwWebFrameExpectOrigin(frame)` | `lib/client.js` | 帧的**应有**来源：`sandbox` 属性不含 `allow-same-origin` ⇒ `"null"`（不透明源）；含 ⇒ 我们写的 `src` 的 origin。**不读 `contentWindow.origin`**（跨源读会抛），只用我们自己设的两处属性 |
| `mpwIsWebFrameMsgFor(ev, frame)` / `mpwIsWebFrameMsg(ev)` | `lib/client.js` | source **且** origin 双校验；不符 ⇒ 拒绝 + 记账（`reason: source|origin`，含 `expected`） |
| `mpwWebFrameGuardNote(kind, detail)` | `lib/client.js` | 台账写一处：`window.__mpwWebFrameGuard = { rejects, rejectReasons, lastReject, downgrades, lastDowngrade, autoBlocked, lastAutoBlocked, reloads, lastReload, autoCompat, events[] }`（≤24 条事件，计数不丢） |
| `webShimArm(frame)` | `lib/client.js` | 2.5s 兜底：**默认只去 `mpwshim=1` 重载**（`sandbox` 属性一字不改）+ 台账 `reload`；回退口打开时才是旧行为（`downgrade` + `risk:"same-origin"` + 明确警告） |
| `mpwWebSandboxFallback(why, detail, frameIn)` | `lib/client.js` | 默认**拒绝自动升同源**：状态/台账/面板提示 + `console.warn`，`return false` 且不碰属性；显式档仍走"只记账不换档"；回退口打开才恢复旧降级 |
| `mpwWebShimOnMessage(ev, frameIn)` | `lib/client.js` | 原匿名 message 监听抽成具名函数（生产注册同一函数，行为不变）⇒ 判据可离线直接驱动 |

口径细节（为什么这样定）：

- **`compat` = 同源 = 越权面**：`allow-scripts` + `allow-same-origin` 同时给，作者脚本能读宿主 DOM /
  `localStorage`、能带 DSH 会话 cookie 打插件路由 ⇒ 它只能是**用户显式选择**的结果（`?webframe=compat` /
  设置项 `webFrameMode=compat`），自动路径永远到不了。
- **降档 ≠ 白屏**：默认降档仍是"去掉 shim 标记 + 重载"，功能与"沙箱档"逐字一致；只是不再顺带把隔离换掉。
- **来源校验按"我们写的属性"推导**：`ev.origin` 是浏览器填的、攻击者伪造不了；期望值由我们自己设置的
  `src`/`sandbox` 推出 ⇒ 连"帧把自己导航到别的源（`src` 属性没变、`ev.source` 仍是它）"也会被拒。
- **`?webframe=` 仍是回退口**：URL 显式档优先于设置项（既有语义，未改）。

## F5.3 回退口与风险

| 开关 | 类型 | 作用 | 风险（写在文档 + 面板文案 + 台账里） |
|---|---|---|---|
| `webFrameAutoCompat` | **设置项**（设置页「壁纸设置 → Web 帧模式」下方的开关，默认**关**） | 打开后 auto 档恢复"被策略挡住 / shim 没报到 ⇒ 自动降 `compat`"的旧行为 | 等于**把第三方网页壁纸的脚本升到与 DSH 同源**（可读宿主界面与本地存储、可带 cookie 打插件路由）。降档时状态 `degraded`/`autoCompat` 置位、台账 `lastDowngrade.risk="same-origin"`、`console.warn` 明确警告 |
| `?webframe=auto\|sandbox\|compat` | URL 查询（**既有**，非本轮新增） | 当前这次页面加载临时覆盖设置项 | `compat` 同上；`?webframe=` 只影响当次加载 |
| `webFrameMode` | 设置项（既有） | 显式档；显式档**永不自动换档** | 选 `compat` 的代价同上（面板文案已写明） |

**不可回退**的一条（有意为之）：入站 `ev.origin` 校验与"自动降档落点恒为 sandbox"这两条**没有**"关掉校验"
的开关 —— 回退口只影响"要不要允许自动降 compat"，不影响"校验来源"。去掉校验的读数由变异子进程复现（见 F5.4）。

## F5.4 判据（`node tools/web-frame-origin-guard-test.mjs`，45 通过 / 0 失败，~9s）

- **A 伪造 policy 错误 + 非预期来源**：`source`/`origin` 都对 ⇒ 降档动作 `false`、`sandbox` 属性**一字不改**、
  帧历史上从未出现 `allow-same-origin`、台账 `autoBlocked=1`（`blockedBy:"auto-compat-off"`、`by:"frame-message"`）；
  `ev.origin` 不符（沙箱帧报页面源）⇒ 拒收（`rejectReasons.origin=1`、`lastReject.expected="null"`，且**不进**降档判定）；
  `ev.source` 不符 ⇒ 拒收（`rejectReasons.source=1`）；来源都对 ⇒ 错误照旧进 `/diag`（证明不是"全都拒"的假绿）。
  **2.5s 兜底**：帧被重载且 URL 去掉 `mpwshim=1`，`sandbox` 仍是 `allow-scripts`，台账 `reloads=1`/`downgrades=0`。
- **B 合法显式路径不被挡**：设置项 `compat` / `?webframe=compat` ⇒ 档与属性照旧（`allow-same-origin` 在）；
  compat 帧的**页面源**消息被接收（校验没把合法帧挡死）；显式 `sandbox` 被策略挡住 ⇒ 只记账（`explicit-tier`）、不换档。
- **C 回退口**：`webFrameAutoCompat:true` ⇒ 计划落点变 `compat`；策略错误 ⇒ 真降档、状态 `compat`+`degraded`、
  台账 `downgrades=1` 且 `lastDowngrade.risk="same-origin"`；2.5s 兜底同样走旧行为（`by:"shim-timeout"`）。
- **D 变异必红（子进程 + 源码注入，三组各自必红）**：
  - `origin-check-removed`（`if (got !== want)` → `if (false)`）⇒ **A2 红**（origin 校验没了，拒收不再发生）；
  - `source-check-removed`（source/contentWindow 校验整条去掉）⇒ **A3 红**；
  - `auto-compat-forced`（`const autoCompat = !!autoCompatAllowed;` → `true`）⇒ **A1 红**（属性被换成兼容集、
    台账变成 `downgrades`）。
- **既有门禁同步改了一处（契约有意变更）**：`tools/web-wallpaper-test.mjs` 的 B7 组 —— 宿主 `webFrameStatus()`
  形状新增 `autoCompat`/`fallbackMode`（B7d 期望值同步），并新增 B7b2（auto 落点 = sandbox、
  回退口打开才 = compat、显式档落点恒为自己）+ B7e 镜像对拍新增两列（自动降档落点 / 回退口打开时的落点）。
  **430 → 435 通过 / 0 失败**。

---

# F6 可控上游 + `st` 下发（P-205，2026-09-28）

## F6.1 根因（file:line 按符号对锚）

| 环节 | 符号 / 位置（改前） | 事实 |
|---|---|---|
| 上游地址读到什么用什么 | `mpwSceneRendererBase`（`lib/client.js`，原 `:6238-6245`） | `return String(readSection().sceneRendererUrl)` —— 无 scheme/主机/回环判定；默认值 `http://127.0.0.1:8902/webloader/` |
| 令牌随 URL 下发 | `applySceneViaRenderer`（原 `:6294`；`const rawUrlEff = __sbToken ? rawUrl + "&st=" + …`） | 宿主签发的场景 token（30 分钟、可读该场景 `/raw`）被拼进 `pkgurl` 一路送到 base 指向的源 |
| 扩展钩子同样无判定 | 同函数 `sceneExtUrl` → `&extbase=`（原 `:6262-6263`） | 渲染器会在**自己的源**里 `import()` 这个 base（审计 F9）⇒ 上游可控 = 渲染器源里的第三方代码 |
| 写侧 | `POST /settings`（`lib/index.js`） | 已由 P-204 写闸门挡跨源写；**消费侧**当时仍无判定（设置里手填 / 旧值 / 别的路径写进来的值都会生效） |

## F6.2 修法（唯一的实现处）

| 符号 | 位置 | 做什么 |
|---|---|---|
| `mpwSceneTargetGuard(rawUrl)` | `lib/client.js`（**唯一判定**） | 返回 `{ok, kind, origin, host, reason}`；`kind ∈ loopback / same-host-literal / whitelist / cross-origin / bad-scheme / unparsable / empty`。回环 = `127.0.0.0/8`、`::1`、`localhost`（含 `.localhost`、大小写、带端口）；`same-host-literal` = 目标主机 == 页面主机**且页面主机是字面 IP/localhost**（手机/局域网不误伤；**域名不算** ⇒ DNS 重绑定面仍拒）；`whitelist` = origin 逐字命中设置项 `sceneUrlWhitelist` |
| `mpwSceneWhitelistOrigins()` | `lib/client.js` | 解析 `sceneUrlWhitelist`（逗号/空白/分号分隔；接受整条 URL 或裸 `host:port`，一律取 **origin**）；非法条目如实标 `bad`（不静默吞） |
| `mpwSceneUrlGuardNote(kind, detail)` / `mpwSceneUrlRejectLog(where, url, guard)` | `lib/client.js` | 台账 `window.__mpwSceneUrlGuard = { allowed, rejected, rejectReasons, lastAllow, lastReject, whitelist, events[], warnSeen }`；拒绝时 `console.warn`（每目标一次，写明"怎么显式放行"）+ `POST /diag` 的 `kind:"scene-url-guard"` 信标 |
| `mpwSceneRendererBase()` | `lib/client.js` | 设置里的 `sceneRendererUrl` 先过闸门：**不合法 ⇒ 拒绝使用**（回落默认回环 base + 记账 + 日志）；生效目标（含默认 base）也记账 |
| `applySceneViaRenderer` 的 `targetGuard` / `stAllowed` | `lib/client.js` | `sceneExtUrl` 同样过闸门（不过 ⇒ **不拼** `&extbase=`）；`st`（以及 strict 档的 `thumbtoken`）只在目标过闸门时下发，否则 `__sbToken=null` + 计划退回 legacy + 记账 `st-not-delivered:*` |
| `mpwSceneTargetGuard` 等测试钩子 | `lib/client.js` 的 `__mpwSceneTest` | `targetGuard` / `targetWhitelist` / `rendererBase` / `defaultBase` / `urlGuard`（懒取值，避免 TDZ） |

口径细节：

- **为什么要"回落默认回环"而不是"整个场景渲染失败"**：拒绝的是**目标**，不是功能 —— 回落 `127.0.0.1:8902/webloader/`
  后画面照旧能出，非法上游一个字节都拿不到，且台账/日志说清了发生了什么（不静默、不白屏）。
- **`st` 是能力串，不是 cookie**：它 30 分钟内可读该场景的 `/raw`（含本机绝对路径与容器字节）⇒ 只在
  过闸门的目标上下发；跨源**非白名单**目标一律不带（分层：即便目标闸门将来被改坏，这一层仍然拦得住 —— 见 F6.4 的 B5b 变异读数）。
- **局域网/手机不误伤**：`Origin`/上游判定沿用 P-204 的"字面 IP 同主机"口径；域名（含 DNS 重绑定形态）一律拒。

## F6.3 回退口与风险

| 开关 | 类型 | 作用 | 风险 |
|---|---|---|---|
| `sceneUrlWhitelist` | **设置项**（设置页「场景渲染 → 渲染器上游白名单」，默认**空**） | 显式登记允许的跨源上游 origin（逗号/空格分隔）—— 唯一的放行口 | 登记进来的跨源上游会**连同 `st` 一起被放行**（等于把"读这个场景"的能力交给它）。逐 origin 比对，写法见面板提示 |
| `sceneRendererUrl` / `sceneExtUrl` | 设置项（既有） | 仍可自由填写，但只有过闸门的值才会被使用 | 非回环且未登记 ⇒ 拒绝 + 回落默认 + 记账/日志（不是静默忽略） |
| `MPW_CSRF` / `MPW_CORS_LEGACY` / `MPW_CORS_ORIGINS` / `MPW_CUSTOM_DIR_ALLOW_ANY` | env（P-204 的既有回退口） | 与本轮 F6 无交集（写闸门仍开着；`MPW_CORS_ORIGINS` 只影响 HTTP 路由的 ACAO） | — |

**本仓没有新增 env / URL / localStorage 开关**（因此渲染器仓 `tests/diag-flag-check.mjs` 的
「代码有·文档无 / 文档有·代码无」双向比对**读数不变 = 0/0**，见 F6.5）：两个回退口都是**设置项**
（`webFrameAutoCompat`、`sceneUrlWhitelist`），写在面板里、随 `~/.dsh-mpkg-wallpaper/settings.json` 持久化。
诊断口径（`window.__mpwWebFrameGuard` / `window.__mpwSceneUrlGuard`）是**只读状态面**，不是开关。

## F6.4 判据（`node tools/scene-url-token-guard-test.mjs`，41 通过 / 0 失败，~4s）

- **A 回环 ⇒ 带 `st`**：默认 base 与显式 `http://127.0.0.1:8899/` 都照旧使用，拼出来的 iframe URL 里
  `st=<宿主 token>` 在（渲染器 strict 主链路零回归）；台账 `allow/loopback`、0 次拒绝、无拒绝日志。
- **B 跨源（非白名单）⇒ 拒绝 + 记账 + 不静默**：`sceneRendererUrl=https://evil.example/webloader/` ⇒
  `rendererBase()` 回落默认回环；台账 `reject(where=sceneRendererUrl, kind=cross-origin)` + 原因可数；
  `console.warn` 明确说明"目标不在回环/白名单内 + 怎么放行"；**真实拼出来的 URL 里 0 处 `evil.example`**；
  `sceneExtUrl=https://evil.example/ext/` ⇒ **不拼** `&extbase=` 且同样记账 + `/diag` 信标。
- **C 白名单放行档（回退口）⇒ 带 `st`**：`sceneUrlWhitelist` 命中 ⇒ 用该 base、URL 带 `st`、台账 `allow/whitelist`；
  白名单里写**别的端口/origin** ⇒ 仍拒（逐 origin 比对，不是"有白名单就放行"）。
- **D 同主机口径**：页面在 `192.168.77.9` ⇒ 同 IP 的渲染器 `kind=same-host-literal` 放行；页面主机是
  **域名**（`evil.example`）⇒ 同域名目标仍拒（`cross-origin` 记账）。
- **E 非 http(s)**：`file:///etc/passwd` / `javascript:alert(1)` ⇒ 拒绝（`scheme:file` / `scheme:javascript` 记账），
  extbase 也不拼。
- **F 纯函数矩阵**：回环变体（`127.x`、`::1`、`localhost`、大小写、带端口、带路径/查询/锚点）全放行；
  白名单解析（整条 URL / 裸 host:port / 垃圾条目标 `bad`）；空值/其它网段/域名一律不放行。
- **G 变异必红（子进程 + 源码注入，四组）**：
  - `target-gate-removed`（`if (g.ok) return raw;` → `if (true) return raw;`）⇒ **B1 红**（攻击者 base 被直接用）；
  - `gate-and-st-removed`（同时把 `const stAllowed = !!targetGuard.ok;` → `true`）⇒ **B5b 红**
    （**令牌真的进了攻击者源的 URL** —— 这条读数专门证明分层：只去掉目标闸门时 B5b 仍绿）；
  - `whitelist-any`（白名单比对退化成"非空即放行"）⇒ **C4 红**；
  - `same-host-domain`（去掉"页面主机必须是字面 IP"的收窄）⇒ **D2 红**（DNS 重绑定形态被放行）。

## F6.5 与渲染器仓 `diag-flag-check.mjs` 的对齐（只读复核）

渲染器仓 `tests/diag-flag-check.mjs` 会从 `dsh-mpkg-wallpaper/lib/client.js` 抓"诊断开关"
（URL query / 白名单 localStorage 键 / `[?&]name=` 正则字面量）与 `docs/README-DIAGNOSTICS.md` 主表双向比对，
差异非 0 即退出码 1。本轮**没有**给 `lib/client.js` 新增任何 URL/localStorage 开关（两个回退口都是设置项），
且**未修改渲染器仓任何文件**（只读跑 `--list` 与自写的只读比对脚本）。读数：抓取源集合不变，
`code-only=∅ / doc-only=∅`（与改动前同一读数，0/0）。

---

## 5. 未验证边界（诚实清单）

1. **DSH 宿主实际绑定**：插件自身不 `listen`，路由挂在宿主上；宿主绑定是 `127.0.0.1` 还是 `0.0.0.0` 由 DSH 配置决定，
   本机**未实测**。本闸门不依赖它（Origin/Host 校验在两种绑定下都生效）。
2. **浏览器 PNA（Private Network Access）**：Chrome 可能拦截"公网页 → 127.0.0.1"的请求，使 F1/F2 在部分版本上本就打不响；
   本闸门是**不依赖该策略**的那一层，但"多浏览器实测"未做。
3. **真机 / 真浏览器未验（F5）**：本轮判据全是**离线桩**（假帧 + 直接驱动具名处理器）。以下**未实测**：
   (a) 真 Chromium 里不透明源 iframe 的 `message` 事件 `ev.origin` 是否恒为字符串 `"null"`（本实现按规范假定；
   父页在沙箱档下若不匹配会**拒收** ⇒ 若某版本给出别的序列化形式，表现是"shim 握手收不到"，可在
   `window.__mpwWebFrameGuard.rejectReasons.origin` 立刻看到）；(b) 帧内 shim 在**真机 Adreno/移动端**
   的微信/夸克类 WebView 上的 `origin` 行为；(c) `?webframe=compat` 下跨源（外部 URL）网页壁纸的
   `ev.origin` 是否等于其 `src` 的 origin（本实现按此推导，若不等则同样表现为拒收 + 台账可查）。
4. **真机 / 真浏览器未验（F6）**：`sceneRendererUrl` 指向**局域网另一台机器**的渲染器（白名单档）时，
   令牌 `st` 的实际可用性未实测 —— 渲染器向宿主 `/raw` 发请求时携带的是它自己的 `Origin`
   （非 `null`），而宿主 P-204 的令牌门只对 `Origin: null` 生效 ⇒ 白名单档可能"拿到令牌但用不上"。
   本轮的契约只保证"**发不发**由闸门决定"，不保证跨源渲染器能凭该令牌读到容器。
5. **场景帧（渲染器 iframe）的入站校验仍是 source-only**：`mpwIsSceneFrameMsg` 未做本轮 F5 的 origin
   双校验（那会波及渲染器仓的 strict/legacy 全部消息路径与 6 个既有场景门禁）。本轮只收口**网页壁纸帧**；
   渲染器帧的同类加固**留给下一个窗口**（判据可复用 F5 的 `frameExpectOrigin` 手法）。
6. **"用户在选择器里确认过的目录"capability**：审计建议的严格形态（只接受选择器确认过的目录）**未实现** ——
   P-204 落的是"敏感目录黑名单 + same-origin 闸门"这一档；实现 capability 需要给目录选择器加一条
   "确认即登记"的服务端记录，涉及 `lib/client.js`。
7. **`~/.dsh*` 只读约束**：本轮夹具全在 `os.tmpdir()`；未读取、未写入任何真实密钥/凭据文件；
   `~/.dsh-mpkg-wallpaper/settings.json` 未被本轮的判据写入（设置项都走 `loadPlugin({settings})` 的内存/localStorage 夹具）。
8. **本机另一个进程冒名收件**：`/raw` 的字节在"没有 ACAO"下浏览器读不回，但同机进程（已有代码执行权限）不在防护面内。

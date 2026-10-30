# DATA-LIMITS.md — 落盘清单 / 上限 / 清理策略 / 开关默认值（P-104）

> **用户原话（2026-09-16/17，两条发布纪律）**
> 1. 「像你这种测试用的**自动上报**的功能，这种你在上传仓库的时候要把它**默认给关掉**。」
> 2. 「这种自动上报、自动把什么**存储到本地**的类型的东西，这种需要**设置上限**的，这上限别忘记了。」
>
> 本文是这两条纪律的**落地台账**：每一个"会自动写盘/写 localStorage 的东西"逐项列出 ——
> 触发者 / 改前有没有上限 / 现上限（数量 + 总字节）/ 清理策略 / 上限常量写在哪。
> 机器判据在 `tests/data-limits-test.mjs`（**38 断言**，会变红的那种），门禁名 `data-limits`。

---

## 0. 开关默认值（纪律①：自动上报默认关）

| 位置 | 开关 | **默认值** | 开法 | 关法 | 说明 |
|---|---|---|---|---|---|
| 渲染器 `demo.html` | `autoReport`（`?report=`） | **关** | `?report=auto` | 不写（默认）/ `?noreport` | 开了才会建"首帧 700ms + 每 10s"两条定时器，把**当前画面截图 + 日志 + 逐层诊断** POST 到本地服务器 `/report`。自动路径另有 4 次上限 |
| 渲染器 `demo.html` | `?noreport` | —（显式关） | — | 一直有效 | **优先级高于 `?report=auto`**；插件 iframe 一直自动携带它 |
| 渲染器 `demo.html` | `?autorun` | **关** | 存在即开 | 不写 | 每 45s 自动跳下一个场景并持续上报（批量真机回归用） |
| 渲染器 `demo.html` | `?selfcheck` / `?perf=1&perfreport=1` | **关** | 存在即开 | 不写 | 自检 / 性能摘要，POST 到 `/diag`（**默认关**，本来就没开） |
| 渲染器 `demo.html` | 手动 `🛰 立即上报` 按钮 / `window.__mpwReport.now()` | **恒可用** | 点按钮 | — | **用户显式动作，不受上面任何开关影响**（P-104 前它被 `?noreport` 连坐摘掉，已解耦）。按钮 `title` 写明"会上传当前画面与诊断到本地服务器 `/report`" |
| 渲染器 `demo.html` | 手动 `📸 连拍` 按钮 / `j`·`J` 快捷键 | 恒可用 | 点按钮 / 按键 | — | 用户显式动作，POST 原始图片字节到 `/shot` |
| 插件 `lib/client.js` | `mpwdiag`（`localStorage`） | **关** | `localStorage.setItem('mpwdiag','1')` 后刷新 | 删键 / 设 `'0'` | 一个开关同时管两条自动上报：① 无条件 trace（`mpwTrace`）② DOM 诊断快照（加载后 6s / 见面板后 2.5s，每会话 ≤6 次） |
| 插件 `lib/client.js` | 错误自上报（`window.error` / `unhandledrejection`） | **开**（保留） | — | — | **只在真的抛错时**发（每会话 ≤8 次），不是定时/定期上报；为保留崩溃现场而**有意不禁用**，由宿主端硬上限兜底（见 §1） |

---

## 1. 会自动写盘的东西：清单 + 上限 + 清理策略

「改前」= P-104 之前的状态（2026-09-17 实测）。

| # | 文件 / 目录 | 触发者 | 改前上限 | **现上限（数量 / 总字节）** | 清理策略 | 上限常量在哪 |
|---|---|---|---|---|---|---|
| 1 | `<工作区>/reports/r<ts>.json` | 渲染器 `/report`：`?report=auto` 自动（≤4 次）+ `🛰 立即上报` 按钮 | 只有 60 份（无字节上限） | **60 份 / 与 #2 合计 64MB** | 写入**前**、写入**后**各收一次；**最旧先删** | `server/we-scene-demo-server.mjs` `MPW_LIMITS.reportsMaxFiles` / `.reportsMaxBytes` |
| 2 | `<工作区>/reports/selfcheck-<ts>.json` | 渲染器 `/diag`：`?selfcheck=1` 或 `?perf=1&perfreport=1` | **完全没有**（零滚动，实测这条最容易被忽略） | **40 份 / 与 #1 合计 64MB** | 同上；与 #1 共享字节预算 | 同上，`MPW_LIMITS.selfcheckMaxFiles` |
| 3 | `<工作区>/reports/shots/<id>/<ts>-<tag>.jpg\|png` | 渲染器 `/shot`：`📸 连拍`（默认 60 帧×100ms）/ `j` 单帧 | 只有每 id 400 帧（无字节上限） | **每 id 400 帧 / 200MB** | 写入**前**、写入**后**各收一次；每 id 内**最旧先删** | `MPW_LIMITS.shotPerIdMaxFiles` / `.shotPerIdMaxBytes` |
| 4 | 同上的**全部 id 合计** | 同上（换个壁纸就换一个 id 目录） | **没有全局上限**（id 越多磁盘越满） | **全局 500MB** | 超限时**每次删"所有 id 里最旧的那一帧"**（公平：不会一次掏空某个 id） | `MPW_LIMITS.shotTotalMaxBytes` |
| 5 | `<工作区>/reports/shots/<id>/index.jsonl` | 同上（每帧一行元数据） | 无 | 无（**台账，按设计永不删**） | — | — |
| 6 | `~/.dsh/.dsh-mpkg-wallpaper/diag-<epochms>.json`（`~` = 插件宿主端 home） | 插件宿主端 `/api/mpkg-wallpaper/diag`，每次 POST 写一份 | **完全没有**（实测 **3483 个 / 63MB**） | **50 个 / 32MB** | **启动清理一次** + 写入前/后各一次；**最旧先删**（按文件名里的 epoch） | `dsh-mpkg-wallpaper/lib/index.js` `DIAG_KEEP` / `DIAG_MAX_BYTES` |
| 7 | `localStorage['mpw-props:<壁纸id>']`（渲染器属性面板改动表） | 属性面板每次改动（250ms 防抖） | **完全没有**（键随壁纸数无限增长） | **24 键 / 单值 64KB / 合计 512KB** | 写入时 touch 一个 `mpw-ls-lru` 时间戳表；超限**按 LRU 淘汰最旧**；单值超限**拒写** | `demo.html` `MPW_LS_LIMITS`（`// ═══ MPW-LS-LIMIT-BEGIN ═══` 块） |
| 8 | `localStorage['dsh.mpkg-wallpaper.v2']` 等插件键 | 插件设置写入（250ms 防抖） | 无（只有 try/catch 静默失败） | **单值 256KB**（键数天然有界：插件只用 4 个固定键） | 超限**不写**（大图走 IndexedDB）+ 一行 `console.warn` | `dsh-mpkg-wallpaper/lib/client.js` `MPW_LS_MAX_BYTES` |
| 9 | `<工作区>/reports/baselines/<epochms>.json`（①§5-⑨ 真机基线快照；**子目录**） | 渲染器 `/baseline`：`?baseline=1`（**默认关**，用户显式打开；不属于"自动上报"） | **端点新增**（此前没有） | **200 份 / 32MB** | **启动清理一次** + 写入前/后各一次；**最旧先删**（按文件名里的 epoch） | `MPW_LIMITS.baselineMaxFiles` / `.baselineMaxBytes` |

### 1.1 不受本上限影响的"别人的产物"（**明令不删**）

`MPW_REPORTS_DIR` 默认是**工作区根**的 `reports/`，那里还躺着别条线的产物：`parity-*.json`（parity-check 门禁要读）、`*.md`、`compare/` 等。
两处过滤器都只认**自己造的文件名**：

- `pruneDirToLimits` 的 `filter`：`/^r\d+\.json$/`、`/^selfcheck-\d+\.json$/`、`/\.(jpg|png)$/i`
  （`reports/baselines/` 是**子目录**、由 `pruneBaselines()` 单独管，过滤器只认 `/^\d+\.json$/` ⇒
  两边的滚动互不干扰：顶层那份 60 份滚动**永远不会删掉基线快照**，反之亦然）
- 插件 `pruneDiagDir`：`/^diag-(\d+)\.json$/` —— 同目录的 `custom-dir.json`、`ffmpeg/` 一个都不碰

`tests/data-limits-test.mjs` 的 **B9 / D4** 就是这两条的反面断言（放一份 `parity-keepme.json` / `custom-dir.json` 进去，清理后必须还在）。

---

## 2. 上限常量：唯一来源（要调只改这三处）

| 作用域 | 文件 | 常量块 | env 覆盖（**仅供测试/现场调参**） |
|---|---|---|---|
| 服务端落盘（#1–#4、#9） | `server/we-scene-demo-server.mjs` | `const MPW_LIMITS = { … }`（紧跟 `MPW_REPORTS_DIR` 之后） | `MPW_LIMIT_REPORTS_MAX` / `MPW_LIMIT_SELFCHECK_MAX` / `MPW_LIMIT_REPORTS_BYTES` / `MPW_LIMIT_SHOT_FILES` / `MPW_LIMIT_SHOT_ID_BYTES` / `MPW_LIMIT_SHOT_TOTAL_BYTES` / `MPW_LIMIT_BASELINE_MAX` / `MPW_LIMIT_BASELINE_BYTES` |
| 渲染器 localStorage（#7） | `demo.html` | `const MPW_LS_LIMITS = { maxKeys, maxValueBytes, maxTotalBytes }` | 无（页面没有 env 注入点） |
| 插件 diag（#6） | `../dsh-mpkg-wallpaper/lib/index.js:1216` 起 | `const DIAG_KEEP` / `const DIAG_MAX_BYTES` | `DSH_WE_DIAG_KEEP` / `DSH_WE_DIAG_MAX_BYTES` / `DSH_WE_DIAG_DIR`（换目录） |
| 插件 localStorage（#8） | `../dsh-mpkg-wallpaper/lib/client.js:41` 起 | `const MPW_LS_MAX_BYTES` | 无 |

> **非法值一律回落默认**（`numEnv()` / `numEnvLimit()`）：`MPW_LIMIT_REPORTS_MAX=abc` → 60，绝不出现"配错上限 = 把上限关掉"。

---

## 3. 清理动作必须打日志（用户点名要求）

| 位置 | 日志格式 | 时机 |
|---|---|---|
| 服务端 | `[prune] reports/：已删除 N 个最旧文件，释放 X.XX MB（上限 r* 60 份 / selfcheck* 40 份 / 合计 64MB）` | 每次删除后（**0 个时不打**，免得刷屏） |
| 服务端 | `[limits] 启动清理完成：reports 删 A 份/…MB；shots 每 id 删 B 帧/…MB；shots 全局删 C 帧/…MB（上限：…；baselines 200 份/32MB（启动清理删 N 份））` | 进程启动时（`server.listen` 回调第一件事） |
| 服务端 | `[prune] reports/baselines/：已删除 N 个最旧文件，释放 X.XX MB（上限 200 份 / 32MB）` | 每次删除后（0 个时不打） |
| 服务端 | `[baseline] <绝对路径> <bytes>B id=<壁纸id> fps中位=<N> 启动=<N>ms` | 每次 `/baseline` 落盘成功 |
| 渲染器 | `🧹 localStorage 上限清理（写入 mpw-props:<id>）：已删除 N 个最旧键，释放 X.X KB（上限 24 键 / 512 KB）` | 每次淘汰后 |
| 渲染器 | `⚠ localStorage 拒绝写入 <键>：单值 X.X KB > 上限 64 KB（不截断、不静默）` | 单值超限 |
| 插件 | `[dsh-mpkg-wallpaper][prune] diag/（启动｜写入前｜写入后）：已删除 N 个最旧文件，释放 X.XX MB（上限 50 个 / 32 MB）` | 启动 + 每次写入前后 |

---

## 4. 会变红的机器判据

`node tests/data-limits-test.mjs`（门禁 `data-limits`，**38 断言**，~6s）

| 段 | 断言要点 |
|---|---|
| **A 默认关** | 从 `demo.html` 切出**真源码** `const autoReport = …` 求值：`""` → `false`、`?report=auto` → `true`、`?report=1`/`?report=`/`?report=AUTO` → `false`、`?report=auto&noreport=1` → `false`；两条定时器**只**出现在 `if (autoReport) { … }` 块内且全文各只出现一次；手动按钮块**不含**在自动门控里；**真服务空跑 3s：临时 `reports/` 零新增** |
| **B 服务端上限** | 灌超限 → 数量/字节双回到限内 + **最旧被删、最新还在**；`selfcheck` 那条零滚动的路也有上限；shots 每 id 数量/字节 + 全局字节（跨 id 公平删）；**别人的产物不误删**；`[prune]` / `[limits]` 日志格式；**启动清理一次**（预塞 20 份 → 一启动就只剩 5 份且是最新的 5 个） |
| **C 渲染器 localStorage** | 灌 32 键（上限 24）→ 键数/总量回限内、最新键还在、最旧被淘汰、日志出现；单值超限拒写 + 日志；**非 `mpw-props:` 前缀的键一个都不删** |
| **D 插件 diag** | 灌 12 份（上限 5）→ 只剩最新 5 个 + 日志；字节上限；`custom-dir.json` / `ffmpeg/` / 不合模式的 `diag-notanumber.json` 不动；`apply()` 启动清理已接线；客户端 `mpwTrace` 与 `mpwdiag` **默认关**；插件 localStorage 单值上限 |

自证"会红"：把上限调小或把默认改回开，对应用例立刻失败，例如
`MPW_LIMIT_REPORTS_MAX=0 node tests/data-limits-test.mjs` 会在 B3 红；把 `demo.html` 的 `=== 'auto'` 改回 `!has('noreport')` 会在 A2 红。

①(§5-⑨) `reports/baselines/` 的上限（#9）由**另一项门禁**覆盖：`node tests/baseline-test.mjs`（门禁名 `baseline`）
验"灌超限 → 只留最新 N 份"、"启动日志播报 baselines 上限"、"残缺快照 400 不落盘"、"GET 405"、
以及"采集器默认关时零行为变化"。

---

## 5. 未定项 / 本机不可验

1. **插件错误自上报仍默认开**（有意）：它只在真实 JS 异常时触发（每会话 ≤8 次），是崩溃现场的唯一来源；由宿主端"50 个 / 32MB"硬上限兜底。若用户要求"连错误也默认不发"，改 `client.js` 的 `pushErr` 加同一把 `mpwdiag` 闸门即可。
2. **`reports/` 的 64MB 是"两类自造 json 合计"**，不含 `parity-*.json` 等别条线产物 —— 整个目录的真实占用可能更大，但**不是本渲染器写的**，不在本文件承诺范围内。
3. **shots 全局 500MB 的清理是 O(重扫)**：每删一帧重扫所有 id 目录。当前量级（10 个 id × 400 帧）足够快；id 数量上千时需要改成一次性排序。
4. **真机未验**：Android WebView 上 localStorage 的 512KB 总量上限与浏览器配额策略未实测（本机只在 Node 里用假 `localStorage` 验了 LRU 逻辑）。
5. **`?report=auto` 未提供 UI 开关**（只有 URL 参数 + 手动按钮）。用户若要"面板上一个自动上报开关"，需要动属性面板，与 P-90 的统一质量面板一起做更合适。

# 系统媒体会话（服务端半边）—— 契约、取证、接线与诚实清单

①(MEDIA-1 2026-09-19 用户第 1 条「Now playing 显示的应该是**真实正在播放的歌**，不是只有测试台
自己的播放器状态」) 本文是 `lib/media-session.js` + `tools/media-session-test.mjs` 的设计文档。

**一句话**：本模块从操作系统拿「现在在放什么」（曲名/艺术家/专辑/封面/进度/播放状态）并能下发
播放控制，作为 NP 控件（`lib/now-playing.js`）将来接「真实系统媒体」的**服务端半边**。
本机（Termux/proot Ubuntu，无桌面环境）**取不到任何数据** —— 这不是缺陷，是被**推导**出来的结论
（§2）。交付的是**可插拔适配器 + 诚实的能力探测**，不是"假装能用"。

**本轮做完了什么 / 没做什么（边界，别误读）**：

| 事项 | 状态 |
| --- | --- |
| 适配器（MPRIS/playerctl、MPRIS/dbus-send、Windows SMTC）+ 回退 | ✅ 已实现（`lib/media-session.js`） |
| 能力探测 / 错误语义 / 参数化 / 800ms 超时 / 并发去重 / 解析健壮 | ✅ 已实现 + 95 条断言门禁 |
| 宿主路由（`lib/index.js` 暴露 `/media-session`、`/media-control`） | ❌ **未做** —— 该文件本轮被 NP-1 线占着，见 §6.1 |
| 客户端接线（`lib/client.js` 取数 + 喂给 NP 控件） | ❌ **未做** —— 同上，见 §6.2 |
| `file://` 封面的宿主代理路由 | ❌ **未做**（诚实清单 §9 第 4 条） |
| macOS | ❌ 未实现（`platform:'darwin'` ⇒ `unsupported-platform`，0 条命令） |

---

## 1. 交付物与怎么跑

```bash
node tools/media-session-test.mjs              # 95 条断言（含 6 组变异自证），~2.3s，峰值 RSS 96MiB
node tools/media-session-test.mjs --no-mutations   # 只看主体（89 条），不 spawn 变异子进程
```

| 文件 | 行数 | 角色 |
| --- | --- | --- |
| `lib/media-session.js` | 1052 | 纯逻辑 + 依赖注入的会话模块（**无顶层副作用**） |
| `tools/media-session-test.mjs` | 715 | 假 runner 驱动真代码的门禁（含分辨力自证） |
| `docs/MEDIA-SESSION.md` | 441 | 取证 / 契约 / 接线 / 诚实清单 |

**为什么 `lib/media-session.js` 是 ESM**（本仓一个真实的坑）：`package.json` 是 `"type":"module"`
⇒ `lib/*.js` 在 Node 里一律按 ESM 解析。`lib/now-playing.js` 之所以能写 `module.exports`，是因为它
**从不被 Node 直接加载**（被 `tools/build-now-playing.mjs` 内联进 `lib/client.js`，在浏览器里跑）。
本模块是宿主侧模块，必须能被 `import`（`lib/index.js` 同族、`tools/*.mjs` 直接 import）⇒ 只能写 ESM。
写成 `module.exports` 的后果是加载即 `ReferenceError`（比 now-playing.js 那条"静默空对象"好一点）。
测试 A1 断言"ESM 可 import 且导出非空"，就是这个判据。

---

## 2. 本机取证（真实命令 + 真实输出）

> 取证时间：2026-09-19。工作区绝对路径已按本仓门禁（`tools/secret-scan-test.mjs` 的
> `本机工作区绝对路径` 图案）替换为 `<仓库根>`；**其余字符逐字节未改**。

```console
$ which playerctl dbus-send dbus-monitor busctl powershell.exe pwsh 2>/dev/null
/usr/bin/dbus-send
/usr/bin/dbus-monitor
/usr/bin/busctl
(exit=1)          # 退出码 1 = 有参数没找到：playerctl / powershell.exe / pwsh 都不存在

$ ls -la /run/user/*/bus /var/run/dbus/system_bus_socket 2>/dev/null
(exit=2)          # 无任何输出：通配符没匹配到文件，系统总线套接字也不存在

$ echo $XDG_RUNTIME_DIR; ls /run/user 2>/dev/null
XDG_RUNTIME_DIR=[]
(exit=0)          # 变量为空；/run/user 目录不存在（无输出）

$ uname -a
Linux localhost 6.17.0-PRoot-Distro #1 SMP PREEMPT_DYNAMIC ... aarch64 aarch64 aarch64 GNU/Linux
```

**结论（推导，不是硬编码）**：本机是 Android/Termux + proot Ubuntu、**没有桌面环境**；
`XDG_RUNTIME_DIR` 为空且 `/run/user` 不存在 ⇒ **没有 D-Bus 会话总线** ⇒ Linux 侧的 MPRIS
（`org.mpris.MediaPlayer2.*`）在这台机器上**取不到数据**。

三条更细的实测（它们各自改变了模块的判定逻辑，见 §5 与 §8 的"本机实测"注释）：

```console
$ dbus-send --version ; echo rc=$?
Usage: dbus-send [--help] [--system | --session | --bus=ADDRESS | --peer=ADDRESS] [--dest=NAME]
       [--type=TYPE] [--print-reply[=literal]] [--reply-timeout=MSEC] <destination object path>
       <message name> [contents ...]
rc=1              # ① `--version` 不是 dbus-send 的合法选项：用法打到 stderr、exit 1（12ms）

$ dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
    org.freedesktop.DBus.ListNames ; echo rc=$?
Failed to open connection to "session" message bus: Unable to autolaunch a dbus-daemon without a $DISPLAY for X11
rc=1              # ② 二进制在、总线不在 —— 这才是本机 MPRIS 不可用的**真因**

$ busctl --user list --no-legend --no-pager
Failed to set bus address: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined
                  (consider using --machine=<user>@.host --user to connect to bus of other user)
(rc=0, 错误走 stderr)
```

① 让"在位判据"从"退出码为 0"改成"**能不能 exec 起来**"（否则本机会被误判成 `not-installed`）；
② 成为总线可达性的权威判据；①的用法文本里正好带 `--reply-timeout` 字样，曾把这条**正常退出**的
探测误判成超时 ⇒ 超时判定改成**只看信号/错误码**（详见 §8）。

**真 runner（真起进程）在本机跑真模块的端到端结果**（`createMediaSession({})`，节选）：

```json
{ "platform": "linux", "available": false, "adapter": "dbus-send", "reason": "no-session-bus",
  "detail": "总线不可达（via dbus-send）：Failed to open connection to \"session\" message bus: Unable to autolaunch a dbus-daemon without a $DISPLAY for X11",
  "bus": { "checked": true, "ok": false, "via": "dbus-send", "reason": "no-session-bus" },
  "candidates": [ { "id": "playerctl", "present": false, "detail": "spawn playerctl ENOENT" },
                  { "id": "dbus-send", "present": true, "exitCode": 1 } ],
  "probeCommands": 3,
  "snapshot": { "available": false, "reason": "no-session-bus", "source": "dbus-send", "title": "" },
  "control":  { "ok": false, "reason": "not-available", "adapter": "dbus-send" },
  "stats": { "commands": 3, "maxConcurrent": 1, "timeouts": 0, "failures": 3 },
  "ms": 29 }
```

即：**3 条探测命令、29ms、0 条媒体命令、0 次超时、available:false + 可读原因**。
本机没有"能取到数据"的可能，模块如实说做不到。

---

## 3. 契约（唯一权威；门禁断言的就是这一段）

```js
import { createMediaSession } from './media-session.js';       // 宿主侧（ESM）
const session = createMediaSession({ run, platform, env, now, timeoutMs, log });
// → { probe(), snapshot(), control(op, arg), stats(), lastProbe(), describe() }
```

| 入口 | 返回 | 语义 |
| --- | --- | --- |
| `probe(opts?)` | `Promise<ProbeInfo>` | **适配器可用性**：二进制能被 exec + 会话总线可达 + ≥1 个播放器。`{force:true}` 绕过 10s TTL 缓存 |
| `snapshot()` | `Promise<Snapshot>` | **统一形状**的当前媒体。**永不 reject** |
| `control(op, arg)` | `Promise<ControlResult>` | `op ∈ CONTROL_OPS`。**永不 reject** |
| `stats()` | `object` | `{commands, maxConcurrent, running, deduped, timeouts, failures, truncated}`（并发/去重断言的观测面） |
| `lastProbe()` | `ProbeInfo \| null` | 最近一次 probe 原始结果（含每个候选的探测过程与 reason，排障用） |
| `describe()` | `object` | 自述：版本/平台/超时/上限/模板（常量一处定义） |

**依赖注入**：`run(cmd, argv, { timeoutMs, maxBytes }) ⇒ Promise<{code, stdout, stderr, timedOut?, error?}>`
是**唯一**允许起进程的地方。模块除"默认真 runner"外不碰 `child_process` ⇒ 测试注入假 runner
就能驱动**全部真逻辑**（解析/判定/超时/去重/控制 argv 都在真实现里跑）。

### 3.1 `Snapshot`（21 个键**恒在** —— 前端不做存在性判断）

```js
{ available, reason, source, adapter, player,
  title, artist, album, artUrl, artUrlKind,
  duration, position, playing,
  canPlay, canPause, canNext, canPrev,
  truncated, clipped, notes[], at }
```

* `duration` / `position`：**毫秒整数**，拿不到 = `null`（**不编 0**；`0` 是"真的在开头"的合法值）。
* `available:false` ⇒ `reason ∈ REASONS`，其余字段取 `blankSnapshot()` 的中性值。
* `available:true` ⇒ `title` **非空**（读不到曲名 ⇒ 就当没读到 ⇒ `available:false / no-metadata`）。
* `source` / `adapter`：数据来源，`'playerctl' | 'dbus-send' | 'smtc' | 'none'`（二者同值，语义上
  `adapter` 是"用哪个适配器"、`source` 是"这批数据的出处"，分开命名是为了前端日志可读）。
* `player`：MPRIS 会话名（如 `spotify`）；SMTC 下为空串。
* `artUrlKind`：`'data' | 'http' | 'file' | 'other' | 'none'` —— **前端据此决定能不能直接塞 `<img>`**
  （`file:` 在浏览器里读不到，得走宿主代理，见 §6.3）。
* `truncated`（本命令输出被截断）/ `clipped`（字段被裁剪到 512 字符）/ `notes[]`（诊断线索，
  如 `caps-not-read`、`field-clipped`、`art-too-large`、`unexpanded:position`、`multiline-output`）。
* `at`：生成时间戳（`now()` 注入，便于测试）。

### 3.2 `ProbeInfo`

```js
{ version, platform, timeoutMs, available, adapter, reason, detail,
  bus: { checked, ok, via, reason, detail },
  players: [], candidates: [ { id, present, forced, exitCode, detail } ],
  commands, at }
```

`probe.available` = **适配器能用**；`snapshot.available` = **真的读到了曲目**。两者必须分开：
Windows 上 powershell 在位但当前没有媒体会话 ⇒ probe 可用、snapshot `no-metadata`。

### 3.3 错误语义（全是**返回值**，没有异常路径）

| `reason` | 谁产生 | 含义 / 下一步 |
| --- | --- | --- |
| `unsupported-platform` | probe | 平台没有已知接口（如 darwin）。**0 条命令** |
| `disabled-by-env` | probe | `MPW_MEDIA_ADAPTER=none` 显式关掉。**0 条命令** |
| `not-installed` | probe | 候选二进制都 exec 不起来（spawn 失败/超时） |
| `no-session-bus` | probe / snapshot | 二进制在但**会话总线不可达**（**本机就是这条**）；或读一半总线没了 |
| `no-player` | probe / control | 总线通但没有 `org.mpris.MediaPlayer2.*` 会话（或 `playerctl -l` 空） |
| `no-metadata` | snapshot | 有会话但没有曲名（空闲/无媒体） |
| `empty-output` | snapshot | 命令退出 0 但输出为空 |
| `unparsable` | snapshot | 输出认不出来（乱码/坏 JSON/模板整体未展开） |
| `timeout` | 任何命令 | 超过 `timeoutMs`（默认 800ms）——**只按信号/错误码判定，不看文本** |
| `not-available` | control | 适配器不可用，控制没发出去（`detail` 里带 probe 的 reason） |
| `bad-op` / `bad-arg` / `bad-player` | control / probe | 输入不合规。**0 条命令**（先校验再探测） |
| `error` | 兜底 | 其它失败（`detail` 保留原始文本，截断 200 字符） |

`control()` 的 `ok:false, reason:'refused' | 'no-args'` 来自 **SMTC 脚本自己的 JSON 回包**
（`TryXxxAsync` 返回 false / `$args` 没绑上）—— 如实失败，不假装成功。

### 3.4 安全与资源（每条都有断言）

| 约束 | 实现 | 断言 |
| --- | --- | --- |
| 参数化，**永不拼 shell 字符串** | 命令名与 argv 分开；用户可控值（播放器名/op/位置）只出现在**单个 argv 元素** | E7/E8/E9/E10（含"无 shell 不变式"：命令名只能是直呼可执行文件、argv 不许 `-c`/`/c`） |
| 播放器名白名单 | `/^[A-Za-z0-9_.-]{1,64}$/`，不合规 ⇒ `bad-player` | D7/D8（注入串 `a;rm -rf /` **从未**进过任何命令） |
| op 白名单 + seek 范围 | `CONTROL_OPS` 六项；seek ∈ [0, 24h] | E1/E2/E3/E6 |
| 超时 ≤ 800ms（默认） | `DEFAULT_TIMEOUT_MS=800`，钳制 [50, 5000]，**不存在"无超时"配置** | F1/F2/F9 + D12 |
| 并发去重 | 读操作**单飞**（同 key 并发只跑一次）+ 全局**串行队列**（同一时刻最多一条命令）；`control` **不去重**（连点两下必须发两条） | F4/F5/F6/E14 |
| 解析健壮 | 空/乱码/超长（截断）/字段裁剪（512 字符）/未展开模板/多行 ⇒ 记 note + 落 reason，**不抛** | B 组 15 条 |
| 输出有界 | 单命令输出上限 16KiB；封面 data URL 上限 700KB（超了丢封面、不丢整条快照） | B12/B13/F10 |

---

## 4. 能力矩阵（哪个平台能拿到什么）

| 平台 / 前提 | 适配器 | 曲名/艺术家/专辑 | 封面 | 进度 | 播放状态 | 控制 | 本轮可验？ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Linux + 会话总线 + `playerctl` | `playerctl`（**1 次** `metadata --format`） | ✅ | ✅ `mpris:artUrl`（**常是 `file://`**） | ✅ `mpris:length` + `position`（µs→ms） | ✅ `{{status}}` | play / pause / play-pause / next / previous / position(秒) | ❌ 本机无总线 |
| Linux + 会话总线 + 只有 `dbus-send` | `dbus-send`（**1 次** `Properties.GetAll`） | ✅ | ✅ | ✅ `Position` + `mpris:length` | ✅ `PlaybackStatus` | Play / Pause / PlayPause / Next / Previous / `Properties.Set(Position)` | ❌ 本机无总线 |
| Windows 10/11 + PowerShell | `smtc`（**1 次** `powershell.exe -Command <脚本>`） | ✅ | ✅ 缩略图→base64 `data:` URL | ✅ `TimelineProperties`（ms） | ✅ `PlaybackStatus` | `TryPlayAsync` / `TryPauseAsync` / `TryTogglePlayPauseAsync` / `TrySkipNextAsync` / `TrySkipPreviousAsync` / `TryChangePlaybackPositionAsync` | ❌ 本机无 powershell.exe |
| macOS | —— | —— | —— | —— | —— | —— | ❌ **未实现**（`unsupported-platform`） |
| 什么都没有（**本机**） | `none` | —— | —— | —— | —— | —— | ✅ 实测 `available:false`+可读 reason |

**能力字段的真实性（重要）**：

* `canPlay`/`canPause`：MPRIS 路线上，`Play`/`Pause`/`PlayPause` 是 `org.mpris.MediaPlayer2.Player`
  的**必需方法**（规范保证存在）⇒ "有播放器 ⇒ 能发"，这是**规范推导**不是猜。
* `canNext`/`canPrev`：`playerctl` 一次 metadata **读不到** `CanGoNext`/`CanGoPrevious` ⇒ 未知就
  **`false`**（不留"点了没用"的假键；note 里记 `caps-not-read`）。要精确值走 `dbus-send`（读
  `CanGoNext`/`CanGoPrevious` 属性）或 SMTC（`Controls.IsNextEnabled`）—— 那两条路线是**真值**。
* `xesam:artist` 是数组时**只取第一个**值（多艺术家拼接是可能的后续改进，本轮不做，见 §9.8）。

---

## 5. 三个适配器的实现细节（含"本机实测"标记）

### 5.1 `playerctl`（Linux 首选）

* 探测（3 条命令）：`playerctl --version` → `dbus-send --version` → `dbus-send --session … ListNames`
  （总线可达性 + 顺带拿 MPRIS 名字）→ 若选中 playerctl 再 `playerctl -l` 列播放器。
* 读取（**1 条**）：`playerctl --player=<名> metadata --format '<7 字段模板>'`。
  **一次调用取全部字段**：7 次调用 = 7 个进程，在手机上是不可接受的（用户的内存/进程约束）。
* **本机实测**：`--version` 退出非 0 **仍算在位**（在位判据 = "能不能 exec 起来"）。
* 模板未展开（老版本不认 `{{status}}`/`{{position}}`）⇒ 该字段丢弃 + note，**不会**把
  `{{status}}` 当曲名显示；整个模板都没展开 ⇒ `unparsable`。

### 5.2 `dbus-send`（Linux 退化路线）

* 读取（**1 条**）：`dbus-send --session --print-reply --dest=org.mpris.MediaPlayer2.<名>
  /org/mpris/MediaPlayer2 org.freedesktop.DBus.Properties.GetAll string:org.mpris.MediaPlayer2.Player`
* 解析 `dict entry( string "Key" variant <type> <value> )` 的**文本**回包，**按 key 自己的 variant
  类型**取值。这里踩过一个真坑（B 组钉住）：如果"抓 key 后面第一个 `string "…"`"，`mpris:length`
  的 key 后面跟的是 `int64`，抓到的会是**下一个字典项的键名**（`xesam:artist` 被当成了曲长/封面）。
* 数组属性（`array [ string "A" string "B" ]`）取第一个值，且只扫到本数组闭合前，不越界读下个属性。
* seek = `Properties.Set(Position, variant:int64:<µs>)`（**绝对位置**）；不是 `Player.Seek`
  —— 那个是**相对**偏移，语义不同。

### 5.3 `smtc`（Windows）

* 读取（**1 条**）：`powershell.exe -NoProfile -NonInteractive -Command <SMTC_SCRIPT>`，
  脚本用真 WinRT API：`[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,
  Windows.Media.Control, ContentType=WindowsRuntime]::RequestAsync()` + `AsTask` 反射 `Await`，
  然后 `TryGetMediaPropertiesAsync` / `GetTimelineProperties` / `GetPlaybackInfo`，
  `ConvertTo-Json -Compress` 输出单行 JSON；封面走 `Thumbnail.OpenReadAsync` + `DataReader` → base64
  `data:` URL（脚本内已限 ≤512KB）。
* 控制：**脚本本体是常量**，`op` 与位置是**独立 argv 元素**（`$args[0]`/`$args[1]`）。
  ⚠ `-Command <脚本> <参数…>` 把余下参数绑到 `$args` 的行为**必须在真机验证**（§9.3）；
  因此脚本自带自证：`$args.Count -lt 1` ⇒ `{"ok":false,"reason":"no-args"}` ⇒ 宿主**如实失败**，
  绝不在"参数没传进去"的情况下盲发一个动作。

---

## 6. 如何接进 NP 控件（**本轮不做**，留给下一个代理）

### 6.0 为什么留给下一个代理

`lib/client.js`、`lib/index.js`、`tools/check.sh`、`tools/token-namespace-test.mjs` 本轮由
**NP-1 线**在收尾，本任务明令不许碰（避免踩掉对方的工作）。所以本节只给**确切位置**与**判据**，
不动代码。所有行号是**取证时**的快照（会漂移，请按函数名定位）。

### 6.1 宿主路由（`lib/index.js`，**必改**，否则客户端无路可走）

浏览器里跑不了进程 ⇒ NP 控件必须经宿主路由取数。建议按既有 `/media-audio` 那条 POST 的写法加两条：

```js
// 进程内**单例**会话（probe 有 10s TTL 缓存，别每次请求 new 一个）
const mediaSession = createMediaSession({ env: process.env });   // 顶部 import { createMediaSession } from './media-session.js'
//   GET  /api/mpkg-wallpaper/media-session          → await mediaSession.snapshot()
//   POST /api/mpkg-wallpaper/media-control {op,arg} → await mediaSession.control(op, arg)
//   （可选）GET /api/mpkg-wallpaper/media-art?player=<名>  → 代理 file:// 封面（见 §6.3）
```

判据：`snapshot()` 的 21 个键原样透传（别在路由里"顺手"改形状）；`control` 的 `op` 只允许
`CONTROL_OPS` 六项；路由回包带 `available/reason`，客户端据此决定是否接管显示。

### 6.2 客户端（`lib/client.js`，**必改**）

| 位置（取证时行号） | 改动 |
| --- | --- |
| `npResolveMedia(section)` @5206 | **保持同步、语义不动**（它解的是"壁纸自己的媒体/音频轨"）。系统媒体是**另一条异步**补充路径，别把 fetch 塞进这个同步函数 |
| `applyNowPlaying(section)` @5343（`ctl.setMedia(npResolveMedia(s))` @5350） | 在这两行**之后**追加一次 `npRefreshSystemMedia()`；`!on` 分支（@5348）里同时停掉轮询定时器 |
| `npTransport(op, section)` @5281 | 数据源 = 系统媒体时，`play`/`pause`/`restart` 改成 `POST /media-control {op:'playpause'|'next'|'prev'}`（**先做能力判定**：`canNext/canPrev` 为 false 就别发）；`mute` 仍走既有设置 + `/media-audio`，不动 |
| `npEnsureCtl()` @5302（`createNowPlaying({…})` @5305） | **不用改**（`onTransport` 已经够用）；若要把"当前是否系统媒体"传进组件，走 `setMedia` 的字段而不是新加回调 |
| 新增 `npRefreshSystemMedia()` | `fetch(HOST_BASE + '/media-session')` → 可用则 `ctl.setMedia({ kind:'system', title:d.title, byline:[d.artist,d.album].filter(Boolean).join(' · '), cover:d.artUrl, total:Math.round(d.duration/1000), playing:d.playing, canPlay:d.canPlay, canVolume:true })` + `ctl.setProgress(Math.round(d.position/1000))` |

**`lib/now-playing.js` 不用改**（三个证据）：

1. `setMedia(next)` 是**合并式**（`now-playing.js:862`：`Object.assign({}, state.media, next)`）⇒ 新增
   `kind:'system'` 只是信息字段；
2. `media.kind` 在组件里**没有任何分支**（`grep -n "media\.kind" lib/now-playing.js` → 0 命中）；
3. `setProgress(at)` 已经存在（`now-playing.js:869`），直接可用。

**单位**：NP 的 `total`/`at` 是**秒**（`npResolveMedia` 里 `out.total = Math.round(vid.duration)`），
而本模块的 `duration`/`position` 是**毫秒** ⇒ 客户端要 `/1000`。

**轮询纪律（本机是手机，这条不是可选项）**：一次 `snapshot()` = **一个进程**。所以：
`setInterval` **≥2000ms**、只在 `ctl.isEnabled()` 且 `document.visibilityState === 'visible'` 时跑、
切走/关开关立刻 `clearInterval`；**禁止**放进 `requestAnimationFrame`/`timeupdate`（每秒 60 次 =
每秒 60 个进程）。模块侧已有单飞 + 串行队列兜底，但别把兜底当设计。

**建议开关**：与 NP 总开关同族，加一个 `npSystemMedia` 子开关，**默认关** —— 本机（无桌面环境）
根本取不到数据，默认开就是给用户一个"永远空着"的控件。

### 6.3 `file://` 封面（当前会显示不出来）

MPRIS 的 `mpris:artUrl` 在真机上**通常是 `file:///…`**（Chromium/Firefox 会写临时文件）。
浏览器的 `<img src="file://…">` 读不到宿主磁盘 ⇒ 客户端必须先看 `artUrlKind`：
`'data'`/`'http'` 直接用；`'file'` 需要宿主加一条 `/media-art?player=<名>` 代理路由
（读文件 + 限大小 + 只允许 MPRIS 给出的路径），**本轮未实现**。

### 6.4 要加到 `tools/check.sh` 的**确切一行**（本轮**不改**该文件）

插入点：**第 2 步**那一批里、`node tools/now-playing-test.mjs || fail=1` **之后**
（取证时该行在 `tools/check.sh:44`；已被 NP-1 线改过一次行号 ⇒ 请按**内容**定位）。
照抄本仓风格（注释在上、命令在下），插入内容**逐字**如下：

```bash
# ①(MEDIA-1 2026-09-19) 系统媒体会话（宿主侧半边）：
#   契约（21 键恒在的 snapshot）/ 三适配器解析（playerctl·dbus-send·SMTC，含空·乱码·超长·
#   未展开模板·字段裁剪）/ 诚实能力探测（**二进制在≠能用**：无会话总线 ⇒ available:false，
#   0 条媒体命令）/ 参数化控制 argv（无 shell 拼接）/ 默认 800ms 超时 + 并发去重；
#   6 组变异自证（available 默认值 / 截断 / 忽略总线 / SMTC 拼接 / 超时 / 单飞）各自必红。
#   本机取证与接线说明：docs/MEDIA-SESSION.md
node tools/media-session-test.mjs || fail=1
```

**为什么加在这里而不是新开一步**：`tools/integrity-check.mjs` ⑨b（`:178-188`）断言
`step "N/M"` 的**分母一致 + 序号从 1 起单调不减到 M**；新开一步要把 12 处标签全部重编号，
而本步（第 2 步）本来就是"一批 client/host 侧快测"的集合地（P-66、选择器、可见性、持久化、
NP 都在这里）。追加一行 = **零重编号、零冲突**。

---

## 7. 门禁自证（分辨力，防假绿）

`tools/media-session-test.mjs` 的 G 组把 6 个变异**真的跑一遍**（副本在 `mkdtemp`，真树不动），
每个变异必须让**指定那一组**变红，并打印"期望哪组红 / 实际哪组红"：

| 变异 | 期望红 | 变异内容 | 实测（2026-09-19） |
| --- | --- | --- | --- |
| `available-default-true` | A | 中性回退的 `available:false` → `true` | ✅ 实际 A（exit=1） |
| `truncation-removed` | B | 删掉输出截断 | ✅ 实际 B |
| `linux-ignores-session-bus` | D | Linux 判定不看会话总线 | ✅ 实际 D |
| `smtc-control-inlined-into-script` | E | op/位置**拼进** PowerShell 脚本文本 | ✅ 实际 E |
| `timeout-removed` | F | 删掉模块自己的超时兜底 | ✅ 实际 F |
| `single-flight-removed` | F | 删掉并发单飞 | ✅ 实际 F |

另外每条变异的**锚点唯一性**在源文件里被断言（命中必须恰好 1 次）—— 防止"源码改了、变异悄悄
没注入"变成假绿。

---

## 8. 实测数字（本轮）

| 项 | 数字 |
| --- | --- |
| `node tools/media-session-test.mjs` 尾行 | `结果: 95 通过, 0 失败` |
| 主体（`--no-mutations`） | `结果: 89 通过, 0 失败` |
| 变异自证 | 6/6 各自打中期望组 |
| 运行时长 / 峰值内存 | **2.27s / 96 MiB**（`ps` 采样父+子 RSS 合计；约束 ≤250MB） |
| 真机端到端 probe | 29ms、3 条命令、**0 条媒体命令**、0 次超时、`no-session-bus` |

**测试过程中被门禁抓到的两个真 bug**（这就是它们存在的意义）：

1. **`toMsOrNull(null)` 返回 0** —— `Number(null)`/`Number('')` 都是 0，不显式判空就会把
   "没有这个字段"静默变成"0 秒"（B16 断言抓到）。
2. **超时判定看文本** —— `dbus-send --version` 的用法文本里带 `--reply-timeout`，正则
   `/timeout/i` 把这条**正常退出**的探测记成了超时（真机跑出来 `timeouts:1` 才暴露）；
   现在只看 `killed`/`signal`/`ETIMEDOUT`（D15 断言钉住），并新增 D14（退出码非 0 仍算在位）。

---

## 9. 诚实清单

### 9.1 纯本地能验（已验，可信）

* 三个适配器的**解析**（对着"按真实回包形态手写的夹具"）：正常/空/乱码/超长/未展开模板/多行/
  字段裁剪；dbus 文本回包的 dict/array 形态。
* `probe()` 的**判定逻辑**（二进制不在位 / 总线不可达 / 无播放器 / env 开关 / 平台 / 白名单）。
* `control()` 的 **argv 逐字节形状**、op/参数校验、失败码映射、无 shell 不变式。
* 超时兜底、并发单飞、全局串行、TTL 缓存（`now()` 注入）。
* 6 组变异的分辨力。
* **本机真实环境**（真 runner、真进程）：`available:false / no-session-bus`，29ms、3 条命令。

### 9.2 只能在**带 D-Bus 会话总线的 Linux 真机**上验（未验）

* `playerctl` 真实输出与模板字段支持：`{{status}}`/`{{position}}`/`{{xesam:artist}}` 的**真实**
  展开行为（老版本可能不支持 ⇒ 我们只是"优雅降级"，没在真版本上验过）。
* `playerctl -l` 的真实播放器命名、`--player=<名>` 对 `firefox.instance_1` 这类带 `.`/`_` 的名字
  是否都成立。
* `dbus-send` 文本回包的真实排版（不同 dbus 版本的对齐/换行差异）—— 解析器按类型走，但
  **真实回包**里 `dict entry` 的嵌套深度/顺序未见过。
* `Position` 属性的实时性（部分播放器只在请求时更新）、`mpris:length` 对直播流是否为 0/缺失。
* 无人播放时 `playerctl metadata` 的真实退出码/文本（我们按 `no-player`/`empty-output` 兜底）。

**怎么验**：Ubuntu 桌面 + `sudo apt install playerctl`，用 `mpv --no-video <文件>` 或 Firefox 放
一段音频，然后 `node -e "…createMediaSession().snapshot()…"`；`dbus-send` 路线用
`MPW_MEDIA_ADAPTER=dbus-send` 强制。

### 9.3 只能在 **Windows 真机**上验（未验，含 4 个具体不确定点）

* `SMTC_SCRIPT` 整条链路：`AsTask` 反射前导在 **Windows PowerShell 5.1 与 pwsh 7** 上是否都能
  跑（`System.Runtime.WindowsRuntime` 的加载在两版上不同）。
* `-Command <脚本> <参数…>` → `$args` 的绑定行为（**最不确定的一条**；已内置 `no-args` 自证：
  若真机上 control 一律回 `no-args`，就是这条不成立 ⇒ 改写成 `& { … }` 脚本块形态或 `-File`
  临时脚本，改法在 §5.3）。
* 缩略图 `OpenReadAsync` + `DataReader` 的 `AsTask` 泛型类型选择（`IRandomAccessStreamWithContentType`
  是否真能这么取）。
* `ConvertTo-Json -Compress` 对 `[ordered]@{}` 的输出是否恒单行、字段名大小写是否如预期。

**怎么验**：Windows 10/11 上开 Edge/Spotify 播放，然后
`node -e "…createMediaSession({platform:'win32'}).snapshot()…"`，先看 `title` 再看 `canNext`
再看封面 `data:` 长度；控制逐个 op 试并断言回包 `{"ok":true}`。

### 9.4 未实现 / 已知缺口

1. **宿主路由 + 客户端接线未做**（§6）——本轮文件被别人占着。所以：**现在的 UI 仍然是旧行为**，
   本文的接线部分是"设计 + 确切位置"，不是"已完成"。
2. **`file://` 封面代理路由**未做（§6.3）⇒ 真机 Linux 上封面大概率显示不出来（曲名/艺术家能显示）。
3. **macOS 未实现** ⇒ `unsupported-platform`。要支持需 `nowplaying-cli` 或 AppleScript/JXA。
4. **`xesam:artist` 多值只取第一个**（不拼接）。
5. **进度是"采样值"而非插值**：`playerctl`/SMTC 每秒轮询之间的进度靠客户端自己推进更好；
   本轮只提供读数，不做客户端插值（留给接线那一步）。
6. **没有"播放器切换"**：多播放器时取 `players[0]`（可用 `MPW_MEDIA_PLAYER` 指定）；
   "跟随最近活跃播放器"未实现。
7. **`dbus-monitor` 事件源未用**：现在是轮询（每个快照 1 个进程）。真要做"无进程常驻"得靠
   长连接 D-Bus 客户端（Node 侧需 `dbus-next` 之类依赖）—— 本插件**不引新依赖**，所以没做。
8. **`busctl` 只在"dbus-send 不在位"时当总线探测的第二形态**；`busctl --user list` 的输出格式
   在 systemd 版本间的差异未在真机验过（本机实测那一条只证明了它会**快速失败**）。

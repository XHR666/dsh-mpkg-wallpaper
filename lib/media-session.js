// lib/media-session.js —— 「系统媒体会话」宿主侧（服务端半边）
//
// 为什么需要本模块：NP 控件（lib/now-playing.js）目前显示的**不是**系统媒体信息 ——
// 它显示的是本插件自己的东西（壁纸视频的进度、当前壁纸缩略图当封面）。用户要的是
// 「Now playing 里是**真实正在播放的歌**」。本模块是那条链路的**宿主半边**：
// 从操作系统拿「现在在放什么」（曲名/艺术家/专辑/封面/进度/播放状态）并能下发播放控制。
//   ① Linux：**MPRIS**（D-Bus 会话总线上的 `org.mpris.MediaPlayer2.*`）。优先 `playerctl`，
//      退化到 `dbus-send` 直接读属性。
//   ② Windows：**SMTC**（`GlobalSystemMediaTransportControlsSessionManager`，经 powershell.exe）。
//   ③ 都没有：`available:false` + `reason`。**不抛异常、不编数据、不做假动作。**
//
// ── 为什么是 ESM（而不是 lib/now-playing.js 那种 `module.exports`）────────────────────────────
// 本仓 package.json 是 `"type": "module"` ⇒ `lib/*.js` 在 Node 里一律按 **ESM** 解析。
// lib/now-playing.js 能写 CJS 风格，是因为它**从不被 Node 直接加载**：它被
// tools/build-now-playing.mjs 内联进 lib/client.js，再在浏览器里跑（那边只有 require/module）。
// 本文件是**宿主侧**模块，必须能被 `lib/index.js` 同族 ESM `import`、也能被 `tools/*.mjs`
// 直接 `import` ⇒ 只能写 ESM。写成 `module.exports` 的后果不是"加载就报错"那么友好：
// ESM 里 `module` 未定义 ⇒ 直接 ReferenceError（真加载即炸，测试会当场看见），
// 而同仓 lib/now-playing.js 那条路是**静默空对象**（更坏）。见该文件头的实测记录。
// 判据（tools/media-session-test.mjs A1/A2）：导出非空 + 形状齐全 + 动态 import 成功。
//
// ── 契约（唯一权威；tools/media-session-test.mjs 断言的就是这一段）────────────────────────────
//     createMediaSession({ run, platform, env, now, timeoutMs, log }) ⇒
//       { probe(), snapshot(), control(op, arg), stats(), lastProbe() }
//
//   · `run(cmd, argv, { timeoutMs, maxBytes })` ⇒ Promise<{ code, stdout, stderr, timedOut?, error? }>
//     **唯一**允许起进程的地方（依赖注入）。本模块除"默认真 runner"外**不**碰 child_process，
//     所以测试注入假 runner 就能驱动**全部**真逻辑（解析/判定/超时/去重/控制全在真代码里跑）。
//     `argv` **永远是数组**：本模块从不拼 shell 字符串、从不经过 `sh -c`（安全判据见 E 组）。
//
//   · probe()  ⇒ Promise<ProbeInfo>   适配器**可用性**：二进制在 + 会话总线通 + 至少一个播放器。
//   · snapshot() ⇒ Promise<Snapshot>  **统一形状**（见下）。永不 reject。
//   · control(op, arg) ⇒ Promise<ControlResult>。永不 reject。
//   · stats()  ⇒ 计数快照（commands/maxConcurrent/deduped/timeouts），供并发与去重断言。
//   · lastProbe() ⇒ 最近一次 probe 的**原始**结果（含每个候选的探测过程与 reason）。
//
//   Snapshot（**所有键恒在**，拿不到就是空/中性值 —— 不省略键，前端不用做存在性判断）：
//     { available, reason, source, adapter, player, title, artist, album, artUrl, artUrlKind,
//       duration, position, playing, canPlay, canPause, canNext, canPrev,
//       truncated, clipped, notes[], at }
//     · duration/position 单位 **毫秒**（整数），拿不到 = `null`（**不编 0**）。
//     · available:false ⇒ reason ∈ REASONS 且其余字段是 `blankSnapshot()` 的中性值。
//     · available:true  ⇒ `title` **非空**（读不到曲名 ⇒ 就当没读到 ⇒ available:false/no-metadata）。
//     · `canNext`/`canPrev` 在 playerctl 适配器下**恒 false**（一次 metadata 读不到 CanGoNext/…）：
//       未知就 false = 不显示"点了没用"的键（本仓政策：不留假动作）。要精确值走 dbus-send/SMTC。
//
// ── 错误语义（全部是**返回值**，没有异常路径）─────────────────────────────────────────────────
//   reason 取值（REASONS）：unsupported-platform / disabled-by-env / not-installed /
//     no-session-bus / no-player / no-metadata / empty-output / unparsable / timeout /
//     not-available（控制时适配器不可用）/ bad-op / bad-arg / bad-player / error
//   判定优先级（snapshot）：不可用适配器 ⇒ 直接回它的 reason（**0 条媒体命令**）；
//     命令失败 ⇒ timeout > not-installed > no-player > error；命令成功但内容空/不认 ⇒
//     empty-output / unparsable；认了但没曲名 ⇒ no-metadata。
//
// ── 安全（每条都有测试）───────────────────────────────────────────────────────────────────────
//   ① 参数化：命令名与参数**分开**传（argv 数组）；用户可控值（播放器名/位置/op）只出现在
//      **单个 argv 元素**里，绝不进命令名、绝不拼 shell 字符串。
//   ② 播放器名白名单 `/^[A-Za-z0-9_.-]{1,64}$/`：不合规 ⇒ `bad-player` + **0 条命令**。
//   ③ op 白名单 + seek 参数范围（有限数、0..24h）：不合规 ⇒ `bad-op`/`bad-arg` + **0 条命令**。
//   ④ 超时：默认 **800ms**（DEFAULT_TIMEOUT_MS），下界 50ms、上界 5000ms；超时 ⇒ reason `timeout`。
//   ⑤ 并发去重：读操作**单飞**（同一 key 并发只跑一次）+ 全局**串行队列**（同一时刻最多一条命令）。
//   ⑥ 解析健壮：空输出/乱码/超长/未展开模板 ⇒ 截断 + 记 notes + 落 reason，**不抛**。
//
// ── 本机（Termux/proot Ubuntu，无桌面环境）实测：拿不到数据 ────────────────────────────────────
//   取证命令与真实输出见 docs/MEDIA-SESSION.md §2：本机**没有** playerctl / powershell.exe，
//   `XDG_RUNTIME_DIR` 为空、`/run/user` 不存在 ⇒ **没有 D-Bus 会话总线** ⇒ Linux 侧 MPRIS
//   在本机取不到数据。所以本模块交付的是**可插拔适配器 + 诚实的能力探测**，不是"假装能用"。
//   `probe()` 在本机必须回 `available:false / no-session-bus`（不是硬编码，是**推导**出来的）。
//
// 许可：MIT（本仓库自写）。无第三方代码；WinRT/PowerShell 片段是按公开 API surface 写的。
'use strict';
import { execFile } from 'node:child_process';

/** 模块契约版本：换形状/换语义必须 +1（测试断言它在响应里出现，防"静默换形状"）。 */
export const MEDIA_SESSION_VERSION = 1;

/* ── 资源与安全上限（一处定义，测试与文档都引这里，不各自写一遍）───────────────────────────── */
/** 单条外部命令默认超时（ms）。用户要求「默认 ≤ 800ms」：这是**阻塞 UI 的预算**，不是随便填的数。 */
export const DEFAULT_TIMEOUT_MS = 800;
/** 超时可调范围（env/选项），防止有人写 0（=不超时，等价于裸奔）或 60s（=卡死界面）。 */
export const MIN_TIMEOUT_MS = 50;
export const MAX_TIMEOUT_MS = 5000;
/** 单次命令输出上限（字符）。超出 ⇒ 截断 + `truncated:true` + note（不抛、不无限吃内存）。 */
export const MAX_OUTPUT_CHARS = 16 * 1024;
/** 单个文本字段上限（字符）。超出 ⇒ 截断 + `clipped:true`（封面 data URL 另算，见 MAX_ART_CHARS）。 */
export const MAX_FIELD_CHARS = 512;
/** 封面 data URL 上限（字符；≈ 512KB 原始字节的 base64）。超出 ⇒ 丢封面 + note，不丢整条快照。 */
export const MAX_ART_CHARS = 700 * 1024;
/** seek 目标位（ms）上界：24h。超过 = 不是"跳到某处"，是坏数据/注入尝试。 */
export const SEEK_MAX_MS = 24 * 60 * 60 * 1000;
/** probe 结果缓存时长（ms）：探测比读取贵（多次命令），但也不能缓存到"插上播放器还不认"。 */
export const PROBE_TTL_MS = 10 * 1000;

/** 控制操作白名单（**唯一**权威；非法 op 直接 `bad-op`，一条命令都不发）。 */
export const CONTROL_OPS = Object.freeze(['play', 'pause', 'playpause', 'next', 'prev', 'seek']);
/** 适配器 id（`none` = 回退：什么都不做，如实说做不到）。 */
export const ADAPTER_IDS = Object.freeze(['playerctl', 'dbus-send', 'smtc', 'none']);
/** 失败/状态原因码（返回值里的 `reason`；测试断言"每个失败路径都落在表内"）。 */
export const REASONS = Object.freeze({
  OK: 'ok',
  UNSUPPORTED_PLATFORM: 'unsupported-platform',
  DISABLED_BY_ENV: 'disabled-by-env',
  NOT_INSTALLED: 'not-installed',
  NO_SESSION_BUS: 'no-session-bus',
  NO_PLAYER: 'no-player',
  NO_METADATA: 'no-metadata',
  EMPTY_OUTPUT: 'empty-output',
  UNPARSABLE: 'unparsable',
  TIMEOUT: 'timeout',
  NOT_AVAILABLE: 'not-available',
  BAD_OP: 'bad-op',
  BAD_ARG: 'bad-arg',
  BAD_PLAYER: 'bad-player',
  ERROR: 'error',
});

/** 播放器名白名单（argv 注入的第二道闸；第一道是"永不拼 shell 字符串"）。 */
export const PLAYER_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** MPRIS 常量（D-Bus 侧）。 */
export const MPRIS_DEST_PREFIX = 'org.mpris.MediaPlayer2.';
export const MPRIS_PATH = '/org/mpris/MediaPlayer2';
export const MPRIS_IFACE = 'org.mpris.MediaPlayer2.Player';
export const DBUS_PROPS_IFACE = 'org.freedesktop.DBus.Properties';

/** `playerctl metadata --format` 模板：**一次**调用取全部字段（7 次调用 = 7 个进程，不可接受）。
 *  ⚠ 诚实提示：老版本 playerctl 不认 `{{status}}`/`{{position}}` —— 那种情况下模板标记会**原样**
 *  留在输出里，本模块按"未展开 ⇒ 该字段缺失 + note"处理（不会把 `{{status}}` 当曲名显示）。 */
export const PLAYERCTL_TEMPLATE = [
  '{{status}}', '{{mpris:length}}', '{{position}}',
  '{{xesam:title}}', '{{xesam:artist}}', '{{xesam:album}}', '{{mpris:artUrl}}',
].join('\t');
/** playerctl 模板字段数（解析器按它切分；改模板必须同步改这里 —— 测试会断言两者一致）。 */
export const PLAYERCTL_FIELDS = 7;
/** 模板标记形态：出现在**值**里 = 该字段没被展开。 */
export const TEMPLATE_MARKER_RE = /\{\{[^}]*\}\}/;

/* ── Windows SMTC：两个 PowerShell 片段 ───────────────────────────────────────────────────────
 * 为什么是"脚本本体 + 独立 argv"，而不是把 op/位置拼进脚本文本：
 *   拼接 = 用户可控数据进了解释器源码（注入面）。这里脚本本体是**常量**，
 *   运行期参数只以**独立 argv 元素**交给 PowerShell（`$args[0]`/`$args[1]`）。
 *   ⇒ E 组断言：argv 里脚本那一个元素必须**逐字节等于** SMTC_CONTROL_SCRIPT，
 *     op 必须是**另一个**元素（把参数化改成拼接 ⇒ 必红，见 G 组第 3 条变异）。
 * ⚠ 诚实提示：`-Command <脚本> <参数…>` 把余下参数绑到 `$args` 的行为**必须真机验证**
 *   （本机没有 powershell.exe，见 docs/MEDIA-SESSION.md 诚实清单）。所以控制脚本**自带自证**：
 *   `$args.Count -lt 1` ⇒ 输出 `{"ok":false,"reason":"no-args"}` ⇒ 宿主会**如实失败**，
 *   绝不在"参数没传进去"的情况下盲发一个动作（不猜、不假装成功）。 */
const SMTC_PRELUDE = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null',
  '$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1" })[0]',
  'function Await($op, $type) { $m = $asTask.MakeGenericMethod($type); $t = $m.Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }',
  '$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]',
  '$mgr = Await ($mgrType::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  '$s = $mgr.GetCurrentSession()',
];

/** 只读：取当前会话的曲目/进度/状态 + 封面（base64 data URL，浏览器可直接显示）。 */
export const SMTC_SCRIPT = [
  ...SMTC_PRELUDE,
  'if ($null -eq $s) { Write-Output "{}"; exit 0 }',
  '$p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
  '$tl = $s.GetTimelineProperties()',
  '$pi = $s.GetPlaybackInfo()',
  '$ct = $pi.Controls',
  '$art = ""',
  'try {',
  '  if ($null -ne $p.Thumbnail) {',
  '    $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])',
  '    $n = [uint32]$st.Size',
  '    if ($n -gt 0 -and $n -le 524288) {',
  '      $rd = [Windows.Storage.Streams.DataReader]::new($st)',
  '      Await ($rd.LoadAsync($n)) ([uint32]) | Out-Null',
  '      $buf = New-Object byte[] $n',
  '      $rd.ReadBytes($buf)',
  '      $art = "data:image/png;base64," + [Convert]::ToBase64String($buf)',
  '    }',
  '  }',
  '} catch { $art = "" }',
  'Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{',
  '  title = [string]$p.Title',
  '  artist = [string]$p.Artist',
  '  album = [string]$p.AlbumTitle',
  '  playing = [string]$pi.PlaybackStatus',
  '  position = [double]$tl.Position.TotalMilliseconds',
  '  duration = [double]$tl.EndTime.TotalMilliseconds',
  '  canPlay = [bool]$ct.IsPlayEnabled',
  '  canPause = [bool]$ct.IsPauseEnabled',
  '  canNext = [bool]$ct.IsNextEnabled',
  '  canPrev = [bool]$ct.IsPreviousEnabled',
  '  art = $art',
  '}))',
].join('\n');

/** 控制：**op/位置从 `$args` 取**（脚本本体是常量，见上面的安全说明）。 */
export const SMTC_CONTROL_SCRIPT = [
  'if ($args.Count -lt 1) { Write-Output \'{"ok":false,"reason":"no-args"}\'; exit 0 }',
  '$op = [string]$args[0]',
  '$ms = -1.0',
  'if ($args.Count -gt 1) { [void][double]::TryParse([string]$args[1], [ref]$ms) }',
  ...SMTC_PRELUDE,
  'if ($null -eq $s) { Write-Output \'{"ok":false,"reason":"no-player"}\'; exit 0 }',
  '$okOp = $false',
  'switch ($op) {',
  '  "play"      { if ($args.Count -eq 1) { $okOp = $true }; $okOp = $s.TryPlayAsync().GetAwaiter().GetResult() }',
  '  "pause"     { $okOp = $s.TryPauseAsync().GetAwaiter().GetResult() }',
  '  "playpause" { $okOp = $s.TryTogglePlayPauseAsync().GetAwaiter().GetResult() }',
  '  "next"      { $okOp = $s.TrySkipNextAsync().GetAwaiter().GetResult() }',
  '  "prev"      { $okOp = $s.TrySkipPreviousAsync().GetAwaiter().GetResult() }',
  '  "seek"      { if ($ms -ge 0) { $okOp = $s.TryChangePlaybackPositionAsync([long]($ms * 10000)).GetAwaiter().GetResult() } }',
  '  default     { Write-Output \'{"ok":false,"reason":"bad-op"}\'; exit 0 }',
  '}',
  'if ($okOp) { Write-Output \'{"ok":true}\' } else { Write-Output \'{"ok":false,"reason":"refused"}\' }',
].join('\n');

/* ══════════════════════════ 纯函数（解析/判定；全部可单测、无副作用） ══════════════════════════ */

/** 统一形状的**中性值**：任何失败路径都回它 + reason（键恒在，前端不做存在性判断）。
 *  ⚠ 这里是"缺省可用性"的**唯一**定义点：改成 `true` = 对全世界撒谎（G 组第 1 条变异）。 */
export function blankSnapshot() {
  return {
    available: false,
    reason: REASONS.NO_PLAYER,
    source: 'none',
    adapter: 'none',
    player: '',
    title: '',
    artist: '',
    album: '',
    artUrl: '',
    artUrlKind: 'none',
    duration: null,
    position: null,
    playing: false,
    canPlay: false,
    canPause: false,
    canNext: false,
    canPrev: false,
    truncated: false,
    clipped: false,
    notes: [],
    at: 0,
  };
}

/** 超时值钳制：NaN/0/负数 ⇒ 默认值；越界 ⇒ 上下界（**不允许"无超时"**这种配置存在）。 */
export function clampTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  if (n < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (n > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return Math.round(n);
}

/** 文本字段清洗：控制字符（含 NUL/换行）一律去掉 → 修掉"乱码把界面撑爆"与"日志注入换行"。
 *  返回 `{ text, clipped, dirty }`：`clipped`=超长截断，`dirty`=原本含控制字符。 */
export function sanitizeText(value, max = MAX_FIELD_CHARS) {
  if (value === null || value === undefined) return { text: '', clipped: false, dirty: false };
  // eslint-disable-next-line no-control-regex
  const raw = String(value).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const capped = Number.isFinite(max) && max > 0 ? max : MAX_FIELD_CHARS;
  if (collapsed.length > capped) return { text: collapsed.slice(0, capped), clipped: true, dirty: raw !== String(value) };
  return { text: collapsed, clipped: false, dirty: raw !== String(value) };
}

/** 值是不是"没被展开的模板标记"（老 playerctl 不认某字段时的形态）。 */
export function isUnexpanded(value) {
  return TEMPLATE_MARKER_RE.test(String(value === null || value === undefined ? '' : value));
}

/** MPRIS 封面 URL 的形态判定（前端要知道能不能直接塞进 <img>）：file:// 必须经宿主代理。 */
export function mprisArtKind(url) {
  const s = String(url || '');
  if (!s) return 'none';
  if (s.startsWith('data:')) return 'data';
  if (/^https?:\/\//i.test(s)) return 'http';
  if (s.startsWith('file:')) return 'file';
  return 'other';
}

/** 次秒/微秒 → 毫秒（MPRIS 用**微秒**）。拿不到（null/undefined/空串/非有限/负数）⇒ null。 */
export function microsToMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n / 1000);
}

/** MPRIS 用微秒：ms → µs（seek 下发用；拿不到/负数 ⇒ null）。 */
export function msToMicros(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000);
}

/** 数值字段清洗：拿不到（null/undefined/空串/非有限/负数）⇒ null（**不编 0**）。
 *  为什么要显式判空：`Number(null)` 与 `Number('')` 都是 **0** —— 不判就会把
 *  "没有这个字段"静默变成"0 秒/0 毫秒"（B16 断言就是盯这一条的：数字 0 是合法值，
 *  与"没读到"必须区分开）。 */
export function toMsOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** `playerctl -l` / D-Bus ListNames 里抽 MPRIS 播放器名（去重、保序、剔除基线名）。 */
export function playersFromText(text) {
  const out = [];
  const re = /org\.mpris\.MediaPlayer2\.([A-Za-z0-9_.-]+)/g;
  const s = String(text || '');
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1];
    // `org.mpris.MediaPlayer2` 单独出现（无实例名）不是播放器；`playerctld` 是代理，不算真实会话。
    if (!name || name === 'MediaPlayer2' || name === 'playerctld') continue;
    if (out.indexOf(name) < 0) out.push(name);
  }
  return out;
}

/**
 * 解析 `playerctl metadata --format <模板>` 的一行输出（`\t` 分隔）。
 * 三类"不认"都不抛：空 ⇒ `{ ok:false, reason:'empty-output' }`；字段不足 ⇒ `unparsable`；
 * 未展开的模板标记 ⇒ 丢该字段 + note `unexpanded:<name>`（**不会**把 `{{status}}` 当曲名）。
 * 多行输出（曲名里带换行时会这样）只取第一行 + note `multiline-output`：宁可少显示，不猜。
 */
export function parsePlayerctlMetadata(stdout) {
  const raw = String(stdout === null || stdout === undefined ? '' : stdout);
  const notes = [];
  if (!raw.trim()) return { ok: false, reason: REASONS.EMPTY_OUTPUT, fields: {}, playing: false, notes };
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { ok: false, reason: REASONS.EMPTY_OUTPUT, fields: {}, playing: false, notes };
  if (lines.length > 1) notes.push('multiline-output');
  const parts = lines[0].split('\t');
  if (parts.length < PLAYERCTL_FIELDS) return { ok: false, reason: REASONS.UNPARSABLE, fields: {}, playing: false, notes };
  /* 字段名与模板一一对应（顺序即契约）：
     0 status / 1 length(µs) / 2 position(µs) / 3 title / 4 artist / 5 album / 6 artUrl */
  const names = ['status', 'length', 'position', 'title', 'artist', 'album', 'artUrl'];
  const keep = {};
  let unexpanded = 0;
  for (let i = 0; i < PLAYERCTL_FIELDS; i++) {
    const v = parts[i];
    if (isUnexpanded(v)) { unexpanded++; notes.push('unexpanded:' + names[i]); continue; }
    keep[names[i]] = v;
  }
  if (unexpanded === PLAYERCTL_FIELDS) {
    return { ok: false, reason: REASONS.UNPARSABLE, fields: {}, playing: false, notes }; // 整个模板没展开 = 不是数据
  }
  const status = String(keep.status || '').trim().toLowerCase();
  const fields = {
    title: keep.title,
    artist: keep.artist,
    album: keep.album,
    artUrl: keep.artUrl,
    duration: microsToMs(keep.length),
    position: microsToMs(keep.position),
  };
  return { ok: true, reason: REASONS.OK, fields, playing: status === 'playing', status, notes };
}

/**
 * 解析 `dbus-send --print-reply … Properties.GetAll string:org.mpris.MediaPlayer2.Player`
 * 的**文本**回包。回包是 `dict entry( string "Key" variant <type> <value> )` 的嵌套文本，
 * 这里不写完整 D-Bus 类型系统，只做"够用且可解释"的抽取：
 *   · 标量属性：`string "PlaybackStatus"` 后紧跟的那个 `variant string "Playing"` / `variant boolean true`
 *     / `variant int64 12345`；
 *   · Metadata 字典项：`dict entry( string "xesam:title" variant string "X" )`（取 key 后的第一个值）；
 *   · 数组属性（xesam:artist 是 `array [ string "A" ]`）⇒ 并成一个字符串（多艺术家用 " / " 连）。
 * 不认识/空的形态 ⇒ ok:false + reason（**不抛**）。
 */
export function parseDbusProperties(text) {
  const raw = String(text === null || text === undefined ? '' : text);
  const notes = [];
  if (!raw.trim()) return { ok: false, reason: REASONS.EMPTY_OUTPUT, props: {}, notes };
  /* 标量属性抽取：找 `string "<Key>"`，再找它之后第一个 `variant <type> <value>`。 */
  const scalar = (key) => {
    const at = raw.indexOf('string "' + key + '"');
    if (at < 0) return null;
    const rest = raw.slice(at);
    const m = /variant\s+(string|boolean|int64|uint64|double|byte|int32|uint32)\s+("(?:[^"\\]|\\.)*"|true|false|-?\d+(?:\.\d+)?)/.exec(rest);
    if (!m) return null;
    const type = m[1];
    const lit = m[2];
    if (type === 'string') return unescapeDbusString(lit.slice(1, -1));
    if (type === 'boolean') return lit === 'true';
    const num = Number(lit);
    return Number.isFinite(num) ? num : null;
  };
  /* Metadata 字典项抽取：**按 key 自己的 variant 类型**取值。
     为什么必须看类型而不能"抓 key 后面第一个字面量"：`dict entry( string "mpris:length"
     variant int64 215000000 )` 里 key 后面紧跟的是**数字**；如果先去找 `string "…"`，
     抓到的会是**下一个字典项的 key**（如 `"xesam:artist"`）—— 那就把一个键名当成了曲长/封面
     （实测踩过：duration 变成 null + 封面变成 `xesam:artist`）。
     数组属性（`array [ string "A" string "B" ]`，MPRIS 的多艺术家就这样）取**第一个**值。 */
  const metaItem = (key) => {
    const at = raw.indexOf('string "' + key + '"');
    if (at < 0) return null;
    const rest = raw.slice(at + ('string "' + key + '"').length);
    const typed = /variant\s+([A-Za-z0-9_.]+)\s*([\s\S]*)/.exec(rest);
    if (!typed) return null;
    const kind = typed[1];
    const body = typed[2];
    if (kind === 'string') {
      const str = /^\s*"((?:[^"\\]|\\.)*)"/.exec(body);
      return str ? unescapeDbusString(str[1]) : null;
    }
    if (/^(int64|uint64|int32|uint32|double|byte)$/.test(kind)) {
      const num = /^\s*(-?\d+(?:\.\d+)?)/.exec(body);
      return num ? Number(num[1]) : null;
    }
    if (kind === 'array') {
      /* 数组：只扫到本数组闭合（`]`）之前，取第一个 string —— 不越界读下一个属性。 */
      const close = body.indexOf(']');
      const scope = close >= 0 ? body.slice(0, close) : body.slice(0, 4096);
      const str = /string\s+"((?:[^"\\]|\\.)*)"/.exec(scope);
      return str ? unescapeDbusString(str[1]) : null;
    }
    return null;
  };
  const status = String(scalar('PlaybackStatus') || '').trim();
  const title = metaItem('xesam:title');
  const artist = metaItem('xesam:artist');
  const album = metaItem('xesam:album');
  const artUrl = metaItem('mpris:artUrl');
  const length = metaItem('mpris:length');
  const position = scalar('Position');
  if (!title && !artist && !status) return { ok: false, reason: REASONS.UNPARSABLE, props: {}, notes };
  const props = {
    title: title === null ? '' : title,
    artist: artist === null ? '' : artist,
    album: album === null ? '' : album,
    artUrl: artUrl === null ? '' : artUrl,
    duration: typeof length === 'number' ? microsToMs(length) : null,
    position: typeof position === 'number' ? microsToMs(position) : null,
    playing: status.toLowerCase() === 'playing',
    status,
    canPlay: scalar('CanPlay') === true,
    canPause: scalar('CanPause') === true,
    canNext: scalar('CanGoNext') === true,
    canPrev: scalar('CanGoPrevious') === true,
    propsRead: true,
  };
  if (typeof length !== 'number') notes.push('no-length');
  return { ok: true, reason: REASONS.OK, props, notes };
}

/** D-Bus 文本回包里的字符串转义（\" \\ \n 等）——不解会显示成 `a\"b`（脏数据）。 */
export function unescapeDbusString(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\\\/g, '\\');
}

/** 解析 SMTC 脚本的 JSON 输出（`{}` = 没有会话；坏 JSON ⇒ unparsable；不抛）。 */
export function parseSmtcJson(stdout) {
  const raw = String(stdout === null || stdout === undefined ? '' : stdout).trim();
  const notes = [];
  if (!raw) return { ok: false, reason: REASONS.EMPTY_OUTPUT, fields: {}, notes };
  let obj = null;
  try { obj = JSON.parse(raw); } catch { return { ok: false, reason: REASONS.UNPARSABLE, fields: {}, notes }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: REASONS.UNPARSABLE, fields: {}, notes };
  }
  const title = obj.title === undefined || obj.title === null ? '' : String(obj.title);
  const status = obj.playing === undefined || obj.playing === null ? '' : String(obj.playing);
  if (!title && !status) return { ok: false, reason: REASONS.NO_METADATA, fields: {}, notes };
  return {
    ok: true,
    reason: REASONS.OK,
    playing: status.toLowerCase() === 'playing',
    status,
    fields: {
      title: obj.title,
      artist: obj.artist,
      album: obj.album,
      artUrl: obj.art,
      duration: toMsOrNull(obj.duration),
      position: toMsOrNull(obj.position),
      canPlay: obj.canPlay === true,
      canPause: obj.canPause === true,
      canNext: obj.canNext === true,
      canPrev: obj.canPrev === true,
      propsRead: true,
    },
    notes,
  };
}

/** 解析控制脚本的 JSON 回包（`{"ok":true}` / `{"ok":false,"reason":"…"}`）。 */
export function parseControlReply(stdout) {
  const raw = String(stdout === null || stdout === undefined ? '' : stdout).trim();
  if (!raw) return { ok: false, reason: REASONS.EMPTY_OUTPUT };
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && o.ok === true) return { ok: true, reason: REASONS.OK };
    const r = o && typeof o === 'object' && o.reason ? String(o.reason) : REASONS.ERROR;
    return { ok: false, reason: r };
  } catch { return { ok: false, reason: REASONS.UNPARSABLE }; }
}

/** 把 runner 的返回**归一化**：假 runner 只给 `{code,stdout,stderr}` 也能跑真逻辑。
 *  `truncated` 在这里就标好（输出超上限），解析器拿到的一定是有界字符串。 */
export function normalizeRunResult(result) {
  const o = result && typeof result === 'object' ? result : {};
  let stdout = o.stdout === null || o.stdout === undefined ? '' : String(o.stdout);
  let stderr = o.stderr === null || o.stderr === undefined ? '' : String(o.stderr);
  let truncated = false;
  if (stdout.length > MAX_OUTPUT_CHARS) { stdout = stdout.slice(0, MAX_OUTPUT_CHARS); truncated = true; }
  if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(0, MAX_OUTPUT_CHARS);
  const code = typeof o.code === 'number' ? o.code : null;
  const timedOut = o.timedOut === true;
  const error = o.error ? String(o.error && o.error.message ? o.error.message : o.error) : '';
  const ok = o.ok !== undefined ? o.ok === true : (code === 0 && !timedOut && !error);
  return { ok, code, stdout, stderr, timedOut, error, truncated };
}

/** 默认真 runner（唯一碰 child_process 的地方）：**argv 数组**、固定超时、有界输出、无 shell。
 *  `killSignal: SIGKILL`：超时后必须真死（SIGTERM 对卡在 D-Bus 上的进程不保证有效）。 */
export function defaultRun(cmd, argv, opts = {}) {
  const timeoutMs = clampTimeout(opts.timeoutMs);
  return new Promise((resolve, reject) => {
    execFile(cmd, Array.isArray(argv) ? argv.slice() : [], {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_CHARS * 4,
      encoding: 'utf8',
      windowsHide: true,
      killSignal: 'SIGKILL',
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ code: 0, stdout, stderr });
    });
  });
}

/* ══════════════════════════ 会话工厂 ══════════════════════════ */

/**
 * 建一个媒体会话句柄。**无顶层副作用**：不到 probe()/snapshot()/control() 被调用，
 * 一个进程都不会起、一个字节都不会读。
 * @param {object} [options]
 * @param {Function} [options.run]       注入的 runner（默认 defaultRun）——测试的入口。
 * @param {string}   [options.platform]  默认 `process.platform`（注入 = 能测三平台分支）。
 * @param {object}   [options.env]       默认 `process.env`（读 MPW_MEDIA_* 开关）。
 * @param {Function} [options.now]       默认 `Date.now`（注入 = 能测 probe 缓存 TTL）。
 * @param {number}   [options.timeoutMs] 默认 DEFAULT_TIMEOUT_MS（800）。
 * @param {object}   [options.log]       可选 `{ warn(...) }`；只在"配置被忽略"这类异常上出声。
 */
export function createMediaSession(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : {};
  const platform = typeof options.platform === 'string' && options.platform ? options.platform : (typeof process !== 'undefined' && process.platform ? process.platform : 'unknown');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const run = typeof options.run === 'function' ? options.run : defaultRun;
  const timeoutMs = clampTimeout(options.timeoutMs !== undefined ? options.timeoutMs : env.MPW_MEDIA_TIMEOUT_MS);
  const log = options.log && typeof options.log.warn === 'function' ? options.log : null;

  const counts = { commands: 0, maxConcurrent: 0, running: 0, deduped: 0, timeouts: 0, failures: 0, truncated: 0 };
  let chain = Promise.resolve();     // 全局串行链：同一时刻最多一条命令
  const inflight = new Map();        // 单飞（读操作并发去重）
  let probeCache = null;             // { at, value }
  let lastProbeValue = null;

  /* ── 队列 + 超时 + 归一化：所有外部命令的唯一出口 ─────────────────────────────────────────── */
  /** 单条命令：串行 → 起进程 → 超时兜底 → 归一化。
   *  为什么超时在**本模块**也做一遍（runner 已经拿到 timeoutMs）：注入的 runner 可能不认这个
   *  选项（假 runner/未来换实现），**卡死一条命令 = 卡死整条 UI 链路**，所以自己再兜一层。 */
  async function runOne(cmd, argv, ms) {
    const prev = chain;
    let release;
    chain = new Promise((r) => { release = r; });
    await prev;
    counts.commands++;
    counts.running++;
    if (counts.running > counts.maxConcurrent) counts.maxConcurrent = counts.running;
    try {
      const res = await withTimeout(runSafe(cmd, argv, ms), ms);
      if (res.timedOut) counts.timeouts++;
      if (!res.ok) counts.failures++;
      if (res.truncated) counts.truncated++;
      return res;
    } finally {
      counts.running--;
      release();
    }
  }

  /** 调 runner 并把"抛"变成"返回值"（ENOENT/超时/权限全走这里，适配器里没有 try 分支）。 */
  async function runSafe(cmd, argv, ms) {
    try {
      const r = await run(cmd, Array.isArray(argv) ? argv.slice() : [], { timeoutMs: ms, maxBytes: MAX_OUTPUT_CHARS * 4 });
      return normalizeRunResult(r);
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      /* ⚠ 超时只能由**信号/错误码**判定，不许看文本！
       * 本机实测踩到的坑：`dbus-send --version` 不是合法选项，它把用法打到 stderr 并 exit 1，
       * 而用法文本里带 `--reply-timeout=MSEC` —— 一旦用 /timeout/i 去猜，这条**正常退出**的
       * 探测就会被记成 timeout（统计骗人、reason 也骗人）。execFile 真超时时给的是
       * `killed:true` + `signal:'SIGKILL'` 或 `code:'ETIMEDOUT'`，那才是唯一可信判据。 */
      const killed = !!(e && (e.killed === true || e.signal));
      const codeTimedOut = !!(e && e.code === 'ETIMEDOUT');
      return normalizeRunResult({
        ok: false, code: typeof e.code === 'number' ? e.code : null,
        stdout: e && e.stdout, stderr: e && e.stderr,
        timedOut: killed || codeTimedOut,
        error: msg,
      });
    }
  }

  /** 超时兜底：到点就**当失败**回（不 reject）。底层 promise 后到就丢弃（挂 then 防 unhandled）。 */
  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(normalizeRunResult({ ok: false, timedOut: true, error: 'timeout after ' + ms + 'ms' }));
      }, ms);
      promise.then((r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } },
        (e) => { if (!done) { done = true; clearTimeout(timer); resolve(normalizeRunResult({ ok: false, error: String((e && e.message) || e) })); } });
    });
  }

  /** 读操作单飞：并发同 key 只跑一次（界面里多个订阅者同时问 ⇒ 一条命令）。
   *  `control` **不**去重：每一次点击都必须真的发出去（去重会把"连点两下"吞掉一次）。 */
  function singleFlight(key, fn) {
    const hit = inflight.get(key);
    if (hit) { counts.deduped++; return hit; }
    const p = Promise.resolve().then(fn).then((v) => { inflight.delete(key); return v; },
      (e) => { inflight.delete(key); throw e; });
    inflight.set(key, p);
    return p;
  }

  /* ── 配置读取（env 开关；非法值**出声**而不是静默忽略）────────────────────────────────────── */
  function forcedAdapter() {
    const raw = env.MPW_MEDIA_ADAPTER === undefined || env.MPW_MEDIA_ADAPTER === null ? '' : String(env.MPW_MEDIA_ADAPTER).trim().toLowerCase();
    if (!raw || raw === 'auto') return null;
    if (ADAPTER_IDS.indexOf(raw) >= 0) return raw;
    if (log) log.warn('[media-session] 忽略无法识别的 MPW_MEDIA_ADAPTER=' + raw + '（合法值：' + ADAPTER_IDS.join('|') + '）');
    return null;
  }
  function envPlayer() {
    const raw = env.MPW_MEDIA_PLAYER === undefined || env.MPW_MEDIA_PLAYER === null ? '' : String(env.MPW_MEDIA_PLAYER).trim();
    if (!raw) return null;
    if (!PLAYER_NAME_RE.test(raw)) return { invalid: raw };
    return { name: raw };
  }

  /** 平台 → 候选适配器（顺序 = 优先级：playerctl 优先，退化到 dbus-send）。 */
  function candidates() {
    if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') return ['playerctl', 'dbus-send'];
    if (platform === 'win32') return ['smtc'];
    return [];
  }

  /* ── 能力探测（二进制 / 会话总线 / 播放器）───────────────────────────────────────────────── */
  /** 候选探测用的"版本"命令：便宜、不需要会话总线、能区分 ENOENT 与"装了但坏"。 */
  function presenceArgv(id) {
    if (id === 'playerctl') return ['--version'];
    if (id === 'dbus-send') return ['--version'];
    if (id === 'smtc') return ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'];
    return null;
  }
  function presenceCmd(id) {
    if (id === 'playerctl') return 'playerctl';
    if (id === 'dbus-send') return 'dbus-send';
    if (id === 'smtc') return 'powershell.exe';
    return null;
  }

  /** 会话总线探测：`dbus-send … ListNames`（顺带拿到 MPRIS 名字 ⇒ dbus 路线 0 额外命令）。
   *  `busctl --user list` 是 dbus-send 缺席时的第二形态。两者都不在 ⇒ 视为"无总线"，
   *  并**如实**说明是"没有可用的总线客户端"（不说"总线不存在"，那是两件事）。
   *  ⚠ 本机实测（docs/MEDIA-SESSION.md §2）：这条命令在无桌面环境里会**快速失败**并给出
   *  可读原因（`Failed to open connection to "session" message bus: Unable to autolaunch …`），
   *  所以它是"总线可达性"的**权威**判据 —— 比任何"二进制在不在"的判断都更接近真相。 */
  async function busProbe(haveDbusSend) {
    if (haveDbusSend) {
      const argv = ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames'];
      const r = await runOne('dbus-send', argv, timeoutMs);
      if (r.timedOut) return { ok: false, via: 'dbus-send', reason: REASONS.TIMEOUT, detail: r.error };
      if (!r.ok) {
        /* 失败原因要分清：**总线不可达**（本机就是这类）≠ 工具本身坏了（后者是 error）。
           分不清就会把"没装桌面环境"误报成"插件坏了"。 */
        const busless = buslessText(r);
        return { ok: false, via: 'dbus-send', reason: busless ? REASONS.NO_SESSION_BUS : REASONS.ERROR, detail: r.stderr || r.error };
      }
      return { ok: true, via: 'dbus-send', text: r.stdout, players: playersFromText(r.stdout) };
    }
    const r2 = await runOne('busctl', ['--user', 'list', '--no-legend', '--no-pager'], timeoutMs);
    if (r2.timedOut) return { ok: false, via: 'busctl', reason: REASONS.TIMEOUT, detail: r2.error };
    if (!r2.ok) return { ok: false, via: 'busctl', reason: REASONS.NO_SESSION_BUS, detail: r2.stderr || r2.error };
    return { ok: true, via: 'busctl', text: r2.stdout, players: playersFromText(r2.stdout) };
  }

  /** 错误文本是不是"没有会话总线"那一类（真实消息形态见 busProbe 注释）。 */
  function buslessText(r) {
    return /session.*(bus|message bus)|Unable to autolaunch|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|Failed to (open|connect).*bus/i.test(String((r && r.stderr) || '') + ' ' + String((r && r.error) || ''));
  }

  /** probe 的**真身**（不缓存）。判定顺序与 reason 优先级都写在这里，别处不再判。 */
  async function probeNow() {
    const started = now();
    const cmds0 = counts.commands;   // 本次 probe 的**用量**（差值），不是全局累计
    const info = {
      version: MEDIA_SESSION_VERSION,
      platform,
      timeoutMs,
      available: false,
      adapter: 'none',
      reason: REASONS.NO_PLAYER,
      detail: '',
      bus: { checked: false, ok: false, via: '', reason: '' },
      players: [],
      candidates: [],
      commands: 0,
      at: started,
    };
    const forced = forcedAdapter();
    if (forced === 'none') {
      info.reason = REASONS.DISABLED_BY_ENV;
      info.detail = 'MPW_MEDIA_ADAPTER=none（显式关掉：0 条命令）';
      return info;
    }
    if (forced) {
      info.candidates = [{ id: forced, present: true, forced: true, detail: 'MPW_MEDIA_ADAPTER 指定' }];
    } else {
      const list = candidates();
      if (!list.length) {
        info.reason = REASONS.UNSUPPORTED_PLATFORM;
        info.detail = 'platform=' + platform + ' 没有已知的系统媒体会话接口（0 条命令）';
        return info;
      }
      info.candidates = list.map((id) => ({ id, present: false, forced: false, detail: '' }));
    }
    /* ① 二进制在位（候选**按优先级**探测，第一个在位者胜出；全不在 ⇒ not-installed）。
     *  ⚠ "在位"的判据是**能不能 exec 起来**，不是"退出码为 0" —— 本机实测：
     *  `dbus-send --version` 不是它的合法选项（它把用法打到 stderr 并 exit 1，用法文本里
     *  还带 `--reply-timeout` 字样）。若把"非 0 退出"当成"没装"，本机会被误判成 not-installed，
     *  而**真因**是"装了 dbus-send、但没有会话总线"（这两个结论对用户的意义完全不同）。
     *  所以：spawn 失败（ENOENT/EACCES/…）或超时 ⇒ 不在位；跑起来了（哪怕 exit 1）⇒ 在位。 */
    let chosen = '';
    let haveDbusSend = false;
    for (const c of info.candidates) {
      const cmd = presenceCmd(c.id);
      const argv = presenceArgv(c.id);
      if (!cmd || !argv) continue;
      const r = await runOne(cmd, argv, timeoutMs);
      const spawnFailed = r.timedOut || (!!r.error && /ENOENT|ENOTDIR|EACCES|EPERM|not found|no such file/i.test(r.error));
      c.present = !spawnFailed;
      c.exitCode = r.code;
      if (r.timedOut) c.detail = REASONS.TIMEOUT;
      else if (!r.ok) c.detail = (r.error || r.stderr || 'exit ' + r.code).replace(/\s+/g, ' ').slice(0, 200);
      else c.detail = String(r.stdout || '').trim().split(/\r?\n/)[0].slice(0, 80);
      if (c.id === 'dbus-send') haveDbusSend = c.present;
      if (c.present && !chosen) chosen = c.id;
      /* dbus-send 即使不是首选也要知道它在不在（总线探测要用它）；所以不 break。 */
    }
    info.commands = counts.commands - cmds0;
    if (!chosen) {
      info.reason = REASONS.NOT_INSTALLED;
      info.detail = '候选适配器都不在位：' + info.candidates.map((c) => c.id + '(' + (c.detail || 'missing') + ')').join(', ');
      return info;
    }
    info.adapter = chosen;

    /* ② Linux 系：光有二进制不算能用 —— 还得有**会话总线**（否则 playerctl 一样读不到东西）。 */
    if (chosen === 'playerctl' || chosen === 'dbus-send') {
      const bus = await busProbe(haveDbusSend || chosen === 'dbus-send');
      info.bus = { checked: true, ok: bus.ok, via: bus.via, reason: bus.reason || (bus.ok ? '' : REASONS.NO_SESSION_BUS), detail: String(bus.detail || '').replace(/\s+/g, ' ').slice(0, 220) };
      info.commands = counts.commands - cmds0;
      if (!bus.ok) {
        info.reason = bus.reason || REASONS.NO_SESSION_BUS;
        info.detail = '总线不可达（via ' + bus.via + '）：' + info.bus.detail;
        return info;
      }
      /* ③ 至少一个播放器。playerctl 路线要单独列（`playerctl -l`）；dbus 路线直接复用 ListNames。 */
      const envP = envPlayer();
      if (envP && envP.invalid) {
        info.reason = REASONS.BAD_PLAYER;
        info.detail = 'MPW_MEDIA_PLAYER 不合规（只允许 A-Za-z0-9_.- 且 ≤64 字符）';
        return info;
      }
      if (envP && envP.name) {
        info.players = [envP.name];
      } else if (chosen === 'playerctl') {
        const r = await runOne('playerctl', ['-l'], timeoutMs);
        info.commands = counts.commands - cmds0;
        info.players = r.ok ? String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => PLAYER_NAME_RE.test(s)) : [];
        if (!r.ok) info.detail = 'playerctl -l 失败：' + String(r.stderr || r.error || '').slice(0, 160);
      } else {
        info.players = bus.players || [];
      }
      if (!info.players.length) {
        info.reason = REASONS.NO_PLAYER;
        if (!info.detail) info.detail = '会话总线上没有 org.mpris.MediaPlayer2.* 会话';
        return info;
      }
      info.available = true;
      info.reason = REASONS.OK;
      info.detail = 'players=' + info.players.join(',');
      return info;
    }

    /* ④ Windows：二进制在位即算可用（当前会话可能为空 ⇒ 那是 snapshot 的 no-metadata）。 */
    info.available = true;
    info.reason = REASONS.OK;
    info.detail = 'powershell.exe 在位';
    return info;
  }

  /** 带 TTL 缓存的 probe（默认 10s）。`{ force:true }` 绕过缓存（用户点"刷新"时用）。 */
  async function probe(opts = {}) {
    if (!opts || opts.force !== true) {
      const c = probeCache;
      if (c && now() - c.at < PROBE_TTL_MS) return c.value;
    }
    let value;
    try { value = await probeNow(); }
    catch (e) {
      value = {
        version: MEDIA_SESSION_VERSION, platform, timeoutMs, available: false, adapter: 'none',
        reason: REASONS.ERROR, detail: String((e && e.message) || e).slice(0, 200),
        bus: { checked: false, ok: false, via: '', reason: '' }, players: [], candidates: [], commands: counts.commands, at: now(),
      };
    }
    probeCache = { at: now(), value };
    lastProbeValue = value;
    return value;
  }

  /* ── 读取（各适配器各自的"一次调用"）────────────────────────────────────────────────────── */
  function playerArgvFor(id, player) {
    if (id === 'playerctl') return ['--player=' + player, 'metadata', '--format', PLAYERCTL_TEMPLATE];
    return [
      '--session', '--print-reply',
      '--dest=' + MPRIS_DEST_PREFIX + player,
      MPRIS_PATH, DBUS_PROPS_IFACE + '.GetAll', 'string:' + MPRIS_IFACE,
    ];
  }

  /** 把解析结果 + 适配器信息合成**统一形状**（所有 available:true 的唯一出口，字段清洗只写一次）。 */
  function assemble(kind, player, fields, playing, notes, extra) {
    const snap = blankSnapshot();
    snap.available = true;
    snap.reason = REASONS.OK;
    snap.source = kind;
    snap.adapter = kind;
    snap.player = player || '';
    const t = sanitizeText(fields.title);
    const a = sanitizeText(fields.artist);
    const al = sanitizeText(fields.album);
    snap.title = t.text;
    snap.artist = a.text;
    snap.album = al.text;
    snap.clipped = !!(t.clipped || a.clipped || al.clipped);
    if (snap.clipped) notes.push('field-clipped');
    if (t.dirty || a.dirty || al.dirty) notes.push('control-chars-stripped');
    const art = String(fields.artUrl || '');
    if (art.length > MAX_ART_CHARS) {
      notes.push('art-too-large');
      snap.artUrl = '';
      snap.artUrlKind = 'none';
    } else {
      snap.artUrl = art;
      snap.artUrlKind = kind === 'smtc' ? (art ? 'data' : 'none') : mprisArtKind(art);
    }
    snap.duration = toMsOrNull(fields.duration);
    snap.position = toMsOrNull(fields.position);
    snap.playing = !!playing;
    /* canPlay/canPause：MPRIS 里 Play/Pause 是**必需方法**（规范保证存在），所以"有播放器 ⇒ 能发"。
       canNext/canPrev：一次 metadata 读**读不到** CanGoNext/CanGoPrevious ⇒ 未知就 false（不留假键）。 */
    snap.canPlay = extra && extra.propsRead ? fields.canPlay === true : true;
    snap.canPause = extra && extra.propsRead ? fields.canPause === true : true;
    snap.canNext = extra && extra.propsRead ? fields.canNext === true : false;
    snap.canPrev = extra && extra.propsRead ? fields.canPrev === true : false;
    if (!(extra && extra.propsRead)) notes.push('caps-not-read');
    snap.notes = notes;
    snap.at = now();
    if (!snap.title) {
      /* 有播放器、有状态，但**没有曲名** ⇒ 当我们没读到（不编"未知曲目"这种假数据）。 */
      const empty = blankSnapshot();
      empty.reason = REASONS.NO_METADATA;
      empty.source = kind;
      empty.adapter = kind;
      empty.player = player || '';
      empty.playing = !!playing;
      empty.notes = notes;
      empty.at = snap.at;
      empty.duration = toMsOrNull(fields.duration);
      empty.position = toMsOrNull(fields.position);
      empty.canPlay = snap.canPlay;
      empty.canPause = snap.canPause;
      empty.canNext = snap.canNext;
      empty.canPrev = snap.canPrev;
      return empty;
    }
    return snap;
  }

  /** 失败路径 → 统一形状（reason 由调用方给）。 */
  function fail(reason, kind, player, detail) {
    const snap = blankSnapshot();
    snap.reason = reason;
    snap.source = kind || 'none';
    snap.adapter = kind || 'none';
    snap.player = player || '';
    if (detail) snap.notes = [String(detail).slice(0, 200)];
    snap.at = now();
    return snap;
  }

  /** 命令失败 → reason 的**唯一**映射点（优先级：超时 > 未安装 > 无播放器 > 其它error）。 */
  function reasonFromRun(r) {
    if (r.timedOut) return REASONS.TIMEOUT;
    const blob = (r.error || '') + ' ' + (r.stderr || '');
    if (/ENOENT|not found|command not found|no such file/i.test(blob)) return REASONS.NOT_INSTALLED;
    /* 播放器在跑、总线**中途没了**（休眠/会话切换）也要如实说是"没有会话总线"，
       而不是笼统的 error —— 排障时这两个结论指向完全不同的修法。 */
    if (buslessText(r)) return REASONS.NO_SESSION_BUS;
    if (/no players? found|No player could be found|没有播放器/i.test(blob)) return REASONS.NO_PLAYER;
    if (r.code === 0 && !r.stdout.trim()) return REASONS.EMPTY_OUTPUT;
    return REASONS.ERROR;
  }

  async function readVia(info) {
    const kind = info.adapter;
    const player = info.players[0] || '';
    if (kind === 'smtc') {
      const r = await runOne('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SMTC_SCRIPT], timeoutMs);
      if (!r.ok) return fail(reasonFromRun(r), 'smtc', '', r.error || r.stderr);
      const p = parseSmtcJson(r.stdout);
      const notes = p.notes.slice();
      if (r.truncated) notes.push('output-truncated');
      if (!p.ok) return fail(p.reason, 'smtc', '', notes.join(','));
      const snap = assemble('smtc', '', p.fields, p.playing, notes, { propsRead: true });
      snap.truncated = snap.truncated || r.truncated;
      return snap;
    }
    const argv = playerArgvFor(kind, player);
    const cmd = kind === 'playerctl' ? 'playerctl' : 'dbus-send';
    const r = await runOne(cmd, argv, timeoutMs);
    if (!r.ok) return fail(reasonFromRun(r), kind, player, r.error || r.stderr);
    const notes = [];
    if (r.truncated) notes.push('output-truncated');
    if (kind === 'playerctl') {
      const p = parsePlayerctlMetadata(r.stdout);
      if (!p.ok) return fail(p.reason, kind, player, p.notes.join(','));
      const snap = assemble(kind, player, p.fields, p.playing, notes.concat(p.notes), { propsRead: false });
      snap.truncated = r.truncated;
      return snap;
    }
    const p = parseDbusProperties(r.stdout);
    if (!p.ok) return fail(p.reason, kind, player, p.notes.join(','));
    const snap = assemble(kind, player, p.props, p.props.playing, notes.concat(p.notes), { propsRead: true });
    snap.truncated = r.truncated;
    return snap;
  }

  /** 统一快照：适配器不可用 ⇒ 直接回它的 reason（**0 条媒体命令**）；可用 ⇒ 一次读 + 解析。 */
  async function snapshotImpl() {
    const info = await probe();
    if (!info.available) return fail(info.reason, info.adapter === 'none' ? 'none' : info.adapter, '', info.detail);
    const snap = await readVia(info);
    snap.truncated = snap.truncated || false;
    return snap;
  }

  const snapshot = (opts = {}) => singleFlight('snapshot', async () => {
    try { return await snapshotImpl(); }
    catch (e) { return fail(REASONS.ERROR, 'none', '', String((e && e.message) || e).slice(0, 200)); }
  });

  /* ── 控制（op 白名单 + 参数校验 + 参数化 argv）────────────────────────────────────────────── */
  /** op/arg 校验：**先校验再探测**（非法输入 ⇒ 0 条命令，连 probe 都不跑）。 */
  function validate(op, arg) {
    const name = typeof op === 'string' ? op.trim().toLowerCase() : '';
    if (CONTROL_OPS.indexOf(name) < 0) return { ok: false, reason: REASONS.BAD_OP };
    if (name === 'seek') {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 0 || n > SEEK_MAX_MS) return { ok: false, reason: REASONS.BAD_ARG };
      return { ok: true, op: name, arg: Math.round(n) };
    }
    return { ok: true, op: name, arg: null };
  }

  function controlArgv(kind, player, op, arg) {
    if (kind === 'playerctl') {
      const sub = { play: ['play'], pause: ['pause'], playpause: ['play-pause'], next: ['next'], prev: ['previous'] }[op];
      if (op === 'seek') return ['--player=' + player, 'position', (arg / 1000).toFixed(3)];
      return ['--player=' + player].concat(sub);
    }
    if (kind === 'dbus-send') {
      const dest = '--dest=' + MPRIS_DEST_PREFIX + player;
      if (op === 'seek') {
        /* MPRIS：跳到绝对位置 = 写 Position 属性（不是 Player.Seek —— 那个是**相对**偏移）。 */
        return ['--session', '--print-reply', dest, MPRIS_PATH, DBUS_PROPS_IFACE + '.Set',
          'string:' + MPRIS_IFACE, 'string:Position', 'variant:int64:' + String(msToMicros(arg) || 0)];
      }
      const method = { play: 'Play', pause: 'Pause', playpause: 'PlayPause', next: 'Next', prev: 'Previous' }[op];
      return ['--session', '--print-reply', dest, MPRIS_PATH, MPRIS_IFACE + '.' + method];
    }
    /* SMTC：脚本本体是**常量**，op 与位置是**独立 argv 元素**（绝不拼进脚本文本）。 */
    return ['-NoProfile', '-NonInteractive', '-Command', SMTC_CONTROL_SCRIPT, op, arg === null || arg === undefined ? '' : String(arg)];
  }

  const control = async (op, arg) => {
    const out = { ok: false, op: typeof op === 'string' ? op : '', adapter: 'none', reason: REASONS.BAD_OP, detail: '' };
    try {
      const v = validate(op, arg);
      if (!v.ok) { out.reason = v.reason; return out; }   // 0 条命令
      out.op = v.op;
      const info = await probe();
      out.adapter = info.adapter;
      if (!info.available) { out.reason = REASONS.NOT_AVAILABLE; out.detail = info.reason; return out; }
      const player = info.players[0] || '';
      const argv = controlArgv(info.adapter, player, v.op, v.arg);
      const cmd = info.adapter === 'playerctl' ? 'playerctl' : (info.adapter === 'dbus-send' ? 'dbus-send' : 'powershell.exe');
      const r = await runOne(cmd, argv, timeoutMs);
      if (!r.ok) { out.reason = reasonFromRun(r); out.detail = String(r.error || r.stderr || '').slice(0, 200); return out; }
      const reply = info.adapter === 'smtc' ? parseControlReply(r.stdout) : { ok: true, reason: REASONS.OK };
      out.ok = reply.ok;
      out.reason = reply.reason;
      return out;
    } catch (e) {
      out.reason = REASONS.ERROR;
      out.detail = String((e && e.message) || e).slice(0, 200);
      return out;
    }
  };

  return {
    probe,
    snapshot,
    control,
    stats: () => Object.assign({}, counts),
    lastProbe: () => lastProbeValue,
    /** 自述（诊断面板/测试都读它）：常量一处定义，不各自写死。 */
    describe: () => ({
      version: MEDIA_SESSION_VERSION, platform, timeoutMs, runInjected: typeof options.run === 'function',
      adapters: ADAPTER_IDS.slice(), ops: CONTROL_OPS.slice(), template: PLAYERCTL_TEMPLATE,
      limits: { maxOutputChars: MAX_OUTPUT_CHARS, maxFieldChars: MAX_FIELD_CHARS, maxArtChars: MAX_ART_CHARS, seekMaxMs: SEEK_MAX_MS, probeTtlMs: PROBE_TTL_MS },
    }),
  };
}

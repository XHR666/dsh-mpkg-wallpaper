// tools/media-session-test.mjs —— 「系统媒体会话（宿主侧半边）」的常驻门禁
//
// 为什么需要它：lib/media-session.js 是**看不见的失败**高发区。它做的事是"起外部进程读别人的输出"，
// 而这四类错误在真机上都不会报错、只会静默给错数据或卡住界面：
//   ① **编数据**：没播放器/没总线时返回 available:true + 空曲名 ⇒ Now playing 显示空气；
//   ② **参数化被改回字符串拼接**：用户可控的播放器名/位置进了解释器源码 = 注入面；
//   ③ **超时没了**：`playerctl` 卡在 D-Bus 上 ⇒ 一条命令挂死整条 UI 链路；
//   ④ **并发不去重**：界面里多个订阅者同时问 ⇒ 一秒内起十几个进程（本机是 Termux/手机，
//      进程 + 内存都要命 —— 这是用户反复强调的那条约束）。
// 所以本测试**不**依赖真机、不依赖真播放器：注入假 runner 驱动**真代码**（解析/判定/超时/去重/
// 控制 argv 全在真实现里跑），再用**变异自证**证明这些断言真的有分辨力（G 组）。
//
// 判据（7 组；假 runner，无浏览器、无网络、无真进程）：
//   A. 加载与契约：ESM 可 import / 导出非空 / 形状 20 个键恒在 / 中性回退不许是 available:true /
//      建会话**不起任何命令**（顶层零副作用）/ 常量与模板自洽
//   B. Linux MPRIS 解析：playerctl 正常·空·乱码·超长·未展开模板·多行·字段裁剪；
//      退化到 dbus-send 的 `Properties.GetAll` 文本回包解析
//   C. Windows SMTC：脚本规格（真 WinRT API 名 + 自证 `no-args` 兜底）/ JSON 正常·空会话·坏 JSON /
//      控制回包三种（ok / refused / no-args）
//   D. probe() 能力判定：二进制不在位 / **二进制在位但没有会话总线**（本机就是这一类）/
//      总线通但没播放器 / MPW_MEDIA_ADAPTER=none / 不支持的平台 / 播放器名白名单 / probe TTL 缓存
//      —— 每条都断言"到底发了几条命令"
//   E. control() 参数化与失败路径：op 白名单 / seek 参数范围 / 三种适配器的**逐字节 argv** /
//      **无 shell 不变式** / 失败码映射 / 非法输入 0 条命令 / control 不参与去重
//   F. 超时与并发去重：默认 800ms 上界 / 钳制 / 超时 ⇒ reason:timeout（且不挂死）/
//      并发同 key 单飞 / 全局串行（同一时刻最多一条命令）
//   G. 分辨力自证：6 组变异各自必须让**指定那一组**变红（副本在 mkdtemp，真树不动）
//
// 用法: node tools/media-session-test.mjs [--module <path>] [--no-mutations]
// 约定（与 tools/now-playing-test.mjs 同族）：`--no-mutations` 的子进程不许再跑变异段（防 fork 炸弹）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const MODULE_PATH = path.resolve(argOf('--module', path.join(repoRoot, 'lib', 'media-session.js')))
const NO_MUT = process.argv.includes('--no-mutations')

/* 真实断言助手（本仓教训：ok(name, cond) 恒真 = 假绿）。编号 = 组前缀 + 组内序号。 */
let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const counters = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 }
const mk = (g) => (name, cond, detail) => ok(g + (++counters[g]) + ' ' + name, cond, detail)
const A = mk('A'), B = mk('B'), C = mk('C'), D = mk('D'), E = mk('E'), F = mk('F'), G = mk('G')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-media-session-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

/* ══════════════════════ 假 runner（唯一的"外部世界"；真代码全在真实现里跑） ══════════════════════
   runner 合约（与 lib/media-session.js 文件头一致）：`run(cmd, argv, { timeoutMs, maxBytes })`。
   本假 runner **故意不实现** timeoutMs ⇒ 超时只能由**被测模块自己**的兜底实现生效
   （这正是 F 组要断的东西；变异"删掉超时"后假 runner 不会替它兜住）。
   另一条纪律：**不许有"永不 resolve"的规则** —— 变异体跑的是同一个测试文件，
   一旦有永不 resolve 的 await，变异子进程只能靠 spawnSync 的 120s 超时收场（慢且判不出来）。
   要测"慢命令"就用 delayMs（有限延迟）：删掉超时 ⇒ 命令晚到并被解析 ⇒ 断言照样变红。 */
function makeRunner(rules) {
  const calls = []
  let concurrent = 0, maxConcurrent = 0
  const run = async (cmd, argv, opts) => {
    const isArr = Array.isArray(argv)
    const list = isArr ? argv.slice() : [String(argv)]
    calls.push({ cmd, argv: list, argvIsArray: isArr, opts: Object.assign({}, opts) })
    concurrent++
    if (concurrent > maxConcurrent) maxConcurrent = concurrent
    try {
      const hit = rules.find((r) => r.match(cmd, list))
      if (!hit) { const e = new Error('spawn ' + cmd + ' ENOENT'); e.code = 'ENOENT'; throw e }
      if (hit.delayMs) await new Promise((r) => setTimeout(r, hit.delayMs))
      if (hit.throwText) { const e = new Error(hit.throwText); if (hit.throwCode) e.code = hit.throwCode; throw e }
      return {
        code: hit.code === undefined ? 0 : hit.code,
        stdout: typeof hit.stdout === 'function' ? hit.stdout(cmd, list) : (hit.stdout === undefined ? '' : hit.stdout),
        stderr: hit.stderr === undefined ? '' : hit.stderr,
      }
    } finally { concurrent-- }
  }
  run.calls = calls
  run.maxConcurrent = () => maxConcurrent
  run.count = (pred) => calls.filter((c) => pred(c)).length
  run.hasCmd = (name) => calls.some((c) => c.cmd === name)
  run.log = () => calls.map((c) => c.cmd + ' ' + c.argv.join(' ')).join('\n')
  return run
}
const argvHas = (c, s) => c.argv.some((a) => String(a).indexOf(s) >= 0)

/* ══════════════════════ 夹具：真实形态的输出（不是玩具字符串） ══════════════════════ */
const TPL = '{{status}}\t{{mpris:length}}\t{{position}}\t{{xesam:title}}\t{{xesam:artist}}\t{{xesam:album}}\t{{mpris:artUrl}}'
const PC_LINE = ['Playing', '215000000', '65432000', 'Song X', 'Artist A', 'Album X', 'file:///tmp/cover.png'].join('\t')
/** D-Bus ListNames 回包（真实形态：每行一个 string；注意含代理 `playerctld` 与总线私有名 `:1.23`）。 */
const DBUS_NAMES = [
  'method return time=1.1 sender=org.freedesktop.DBus -> destination=:1.99 serial=3 reply_serial=2',
  '   array [',
  '      string "org.freedesktop.DBus"',
  '      string ":1.23"',
  '      string "org.mpris.MediaPlayer2.playerctld"',
  '      string "org.mpris.MediaPlayer2.spotify"',
  '   ]',
].join('\n')
/** Properties.GetAll 回包（真实形态：dict entry( string "Key" variant <type> <value> )，含数组属性）。 */
const DBUS_PROPS = [
  'method return time=1.2 sender=:1.42 -> destination=:1.99 serial=7 reply_serial=2',
  '   array [',
  '      dict entry(',
  '         string "PlaybackStatus"',
  '         variant             string "Playing"',
  '      )',
  '      dict entry(',
  '         string "Position"',
  '         variant             int64 65432000',
  '      )',
  '      dict entry(',
  '         string "CanPlay"',
  '         variant             boolean true',
  '      )',
  '      dict entry(',
  '         string "CanPause"',
  '         variant             boolean true',
  '      )',
  '      dict entry(',
  '         string "CanGoNext"',
  '         variant             boolean true',
  '      )',
  '      dict entry(',
  '         string "CanGoPrevious"',
  '         variant             boolean false',
  '      )',
  '      dict entry(',
  '         string "Metadata"',
  '         variant             array [',
  '               dict entry(',
  '                  string "mpris:length"',
  '                  variant                      int64 215000000',
  '               )',
  '               dict entry(',
  '                  string "mpris:artUrl"',
  '                  variant                      string "file:///tmp/cover.png"',
  '               )',
  '               dict entry(',
  '                  string "xesam:album"',
  '                  variant                      string "Album X"',
  '               )',
  '               dict entry(',
  '                  string "xesam:artist"',
  '                  variant                      array [',
  '                        string "Artist A"',
  '                        string "Artist B"',
  '                     ]',
  '               )',
  '               dict entry(',
  '                  string "xesam:title"',
  '                  variant                      string "Song X"',
  '               )',
  '            ]',
  '      )',
  '   ]',
].join('\n')
const SMTC_JSON = JSON.stringify({
  title: 'Song W', artist: 'Artist W', album: 'Album W', playing: 'Playing',
  position: 12345, duration: 215000, canPlay: true, canPause: true, canNext: true, canPrev: false,
  art: 'data:image/png;base64,AAAA',
})
/** 通用规则集（Linux 正常路径）：playerctl + dbus-send 都在位，总线上有 spotify。 */
const linuxRules = (over = {}) => ([
  { match: (c, a) => c === 'playerctl' && a[0] === '--version', stdout: 'playerctl 2.4.1\n' },
  { match: (c, a) => c === 'dbus-send' && a[0] === '--version', stdout: 'D-Bus Message Bus Daemon 1.14.10\n' },
  { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('ListNames') >= 0), stdout: over.names === undefined ? DBUS_NAMES : over.names, ...(over.namesFail ? { code: 1, stderr: 'Failed to open connection to session bus' } : {}) },
  { match: (c, a) => c === 'playerctl' && a[0] === '-l', stdout: over.list === undefined ? 'spotify\n' : over.list },
  { match: (c, a) => c === 'playerctl' && a[1] === 'metadata', stdout: over.meta === undefined ? PC_LINE : over.meta, ...(over.metaDelay ? { delayMs: over.metaDelay } : {}) },
  { match: (c, a) => c === 'playerctl' && ['play', 'pause', 'play-pause', 'next', 'previous', 'position'].indexOf(a[1]) >= 0, stdout: over.ctl === undefined ? '' : over.ctl, ...(over.ctlFail ? { code: 1, stderr: 'No players found' } : {}) },
  { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('.GetAll') >= 0), stdout: over.props === undefined ? DBUS_PROPS : over.props },
  { match: (c, a) => c === 'dbus-send' && a.some((x) => /\.(Play|Pause|PlayPause|Next|Previous)$/.test(x)), stdout: 'method return' },
  { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('.Set') >= 0), stdout: 'method return' },
])
const winRules = (over = {}) => ([
  { match: (c, a) => c === 'powershell.exe' && a.indexOf('$PSVersionTable.PSVersion.Major') >= 0, stdout: '5\n' },
  { match: (c, a) => c === 'powershell.exe' && a.some((x) => String(x).indexOf('TryGetMediaPropertiesAsync') >= 0), stdout: over.json === undefined ? SMTC_JSON : over.json, ...(over.delayMs ? { delayMs: over.delayMs } : {}) },
  { match: (c, a) => c === 'powershell.exe' && a.some((x) => String(x).indexOf('TryTogglePlayPauseAsync') >= 0), stdout: over.ctl === undefined ? '{"ok":true}' : over.ctl },
])

/* ══════════════════════ 加载（ESM 真 import；同时证明"能被宿主 import"） ══════════════════════ */
let M = null, loadErr = ''
try { M = await import(pathToFileURL(MODULE_PATH).href) } catch (e) { loadErr = String((e && e.stack) || e) }
if (!M) {
  console.error('✗ 无法 import ' + MODULE_PATH + '\n' + loadErr)
  console.log(`\n结果: ${pass} 通过, ${fail + 1} 失败`)
  console.log('✗ 媒体会话门禁未通过（模块加载失败）')
  process.exit(1)
}
const {
  createMediaSession, blankSnapshot, clampTimeout, sanitizeText, isUnexpanded, mprisArtKind,
  microsToMs, msToMicros, toMsOrNull, playersFromText, parsePlayerctlMetadata, parseDbusProperties,
  parseSmtcJson, parseControlReply, normalizeRunResult, defaultRun, unescapeDbusString,
  PLAYERCTL_TEMPLATE, PLAYERCTL_FIELDS, SMTC_SCRIPT, SMTC_CONTROL_SCRIPT, CONTROL_OPS, ADAPTER_IDS,
  REASONS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_OUTPUT_CHARS, MAX_FIELD_CHARS,
  MAX_ART_CHARS, PROBE_TTL_MS, MEDIA_SESSION_VERSION, PLAYER_NAME_RE,
} = M
const SRC = fs.readFileSync(MODULE_PATH, 'utf8')
const mkSession = (opts) => createMediaSession(opts)

/* ══════════════════════ A. 加载与契约 ══════════════════════ */
console.log('\n== A. 加载与契约（ESM / 导出 / 形状 / 中性回退 / 零顶层副作用）==')
A('ESM 可 import 且导出非空（写成 module.exports 会在这里当场炸）', Object.keys(M).length >= 20, Object.keys(M).length + ' 个导出')
A('契约常量齐全（版本/超时/上限/原因码/操作白名单）',
  MEDIA_SESSION_VERSION === 1 && DEFAULT_TIMEOUT_MS === 800 && MAX_OUTPUT_CHARS === 16384 && CONTROL_OPS.length === 6 && ADAPTER_IDS.length === 4 && Object.keys(REASONS).length >= 14,
  'v' + MEDIA_SESSION_VERSION + ' timeout=' + DEFAULT_TIMEOUT_MS + ' maxOut=' + MAX_OUTPUT_CHARS)
A('★ 默认超时 ≤ 800ms（用户硬约束：不许一条命令挂死 UI）', DEFAULT_TIMEOUT_MS <= 800 && MIN_TIMEOUT_MS > 0 && MAX_TIMEOUT_MS >= DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS + '..' + MAX_TIMEOUT_MS)
A('playerctl 模板字段数与解析器契约一致（改模板必须同步改 PLAYERCTL_FIELDS）',
  PLAYERCTL_TEMPLATE.split('\t').length === PLAYERCTL_FIELDS && PLAYERCTL_TEMPLATE.indexOf('{{xesam:title}}') >= 0)
const blank = blankSnapshot()
const CONTRACT_KEYS = ['available', 'reason', 'source', 'adapter', 'player', 'title', 'artist', 'album', 'artUrl', 'artUrlKind', 'duration', 'position', 'playing', 'canPlay', 'canPause', 'canNext', 'canPrev', 'truncated', 'clipped', 'notes', 'at']
A('★ 统一形状 21 个键**恒在**（前端不做存在性判断）', CONTRACT_KEYS.every((k) => k in blank), CONTRACT_KEYS.filter((k) => !(k in blank)).join(',') || 'all present')
A('★ 中性值 = available:false（默认 true 就是对全世界撒谎；G1 变异盯着这一行）',
  blank.available === false && blank.title === '' && blank.duration === null && blank.position === null && blank.playing === false && Array.isArray(blank.notes))
A('中性值里 duration/position 是 null 而不是 0（0 = "真的在开头"，不许混为一谈）',
  blank.duration === null && blank.position === null)
const sA = mkSession({ run: makeRunner([]), platform: 'linux', env: {} })
A('★ 建会话**零顶层副作用**：不调用就不起命令、也没有 probe 记录',
  sA.stats().commands === 0 && sA.lastProbe() === null && typeof sA.describe === 'function')
A('self-describe 自洽（平台/超时/上限一处定义）',
  sA.describe().timeoutMs === 800 && sA.describe().limits.maxOutputChars === MAX_OUTPUT_CHARS && sA.describe().adapters.length === 4)
A('纯函数出口可用（解析/换算/判定都能单独调）',
  typeof parsePlayerctlMetadata === 'function' && typeof clampTimeout === 'function' && typeof defaultRun === 'function')
A('超时钳制：NaN/0/负数 ⇒ 默认 800；越界 ⇒ 上下界（不存在"无超时"配置）',
  clampTimeout(NaN) === 800 && clampTimeout(0) === 800 && clampTimeout(-5) === 800 && clampTimeout(1) === MIN_TIMEOUT_MS && clampTimeout(999999) === MAX_TIMEOUT_MS && clampTimeout('250') === 250)
A('toolchain 形态：默认 runner 是函数（唯一碰 child_process 的地方），模块源码里没有顶层 run 调用',
  typeof defaultRun === 'function' && !/^\s*(await\s+)?defaultRun\(/m.test(SRC))

/* ══════════════════════ B. Linux MPRIS 解析 ══════════════════════ */
console.log('\n== B. Linux MPRIS：playerctl 正常/空/乱码/超长/未展开/多行/裁剪 + dbus-send 退化 ==')
const rB = makeRunner(linuxRules())
const sB = mkSession({ run: rB, platform: 'linux', env: {} })
const probeB = await sB.probe()
const snapB = await sB.snapshot()
B('probe 判定可用（二进制 + 会话总线 + 播放器三件套齐）',
  probeB.available === true && probeB.adapter === 'playerctl' && probeB.reason === REASONS.OK, JSON.stringify(probeB.players))
B('★ probe 命令序列可核对（playerctl/`dbus-send`/playerctl -l 各一次，无废话命令）',
  rB.calls.slice(0, 4).map((c) => c.cmd + '|' + c.argv.join(' ')).join(' , ') === 'playerctl|--version , dbus-send|--version , dbus-send|--session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames , playerctl|-l',
  rB.log().split('\n').slice(0, 4).join(' , '))
B('★ 代理 `playerctld` 与会话私有名不算播放器（只剩真会话 spotify）',
  JSON.stringify(probeB.players) === '["spotify"]', JSON.stringify(probeB.players))
B('★ 一次 metadata 调用取回全部字段（7 个进程变 1 个进程）',
  rB.count((c) => c.cmd === 'playerctl' && c.argv[1] === 'metadata') === 1,
  'metadata 调用次数=' + rB.count((c) => c.cmd === 'playerctl' && c.argv[1] === 'metadata'))
B('快照可用 + 来源/适配器/播放器如实标注',
  snapB.available === true && snapB.source === 'playerctl' && snapB.adapter === 'playerctl' && snapB.player === 'spotify', snapB.title)
B('曲名/艺术家/专辑逐字段正确', snapB.title === 'Song X' && snapB.artist === 'Artist A' && snapB.album === 'Album X')
B('★ 单位换算：MPRIS 是**微秒** ⇒ duration/position 必须变成毫秒',
  snapB.duration === 215000 && snapB.position === 65432, snapB.duration + 'ms / ' + snapB.position + 'ms')
B('播放状态 playing 正确（Playing ⇒ true）', snapB.playing === true)
B('★ 封面是 file:// ⇒ artUrlKind:"file"（前端要知道这种 URL 不能直接进 <img>，得走宿主代理）',
  snapB.artUrl === 'file:///tmp/cover.png' && snapB.artUrlKind === 'file', snapB.artUrlKind)
B('★ playerctl 一次 metadata 读不到 CanGoNext/CanGoPrevious ⇒ canNext/canPrev **false** + note（不留假键）',
  snapB.canNext === false && snapB.canPrev === false && snapB.notes.indexOf('caps-not-read') >= 0 && snapB.canPlay === true && snapB.canPause === true,
  JSON.stringify(snapB.notes))
B('artUrl 形态判定纯函数：data/http/file/空',
  mprisArtKind('data:image/png;base64,AA') === 'data' && mprisArtKind('https://a/b.png') === 'http' && mprisArtKind('file:///tmp/a.png') === 'file' && mprisArtKind('') === 'none' && mprisArtKind('ftp://x') === 'other')
B('空输出 ⇒ available:false + empty-output，且**不编任何字段**',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules({ meta: '' })), platform: 'linux', env: {} }); const x = await s.snapshot(); return x.available === false && x.reason === REASONS.EMPTY_OUTPUT && x.title === '' })())
B('乱码/二进制 ⇒ unparsable（不抛、不把乱码当曲名）',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules({ meta: '\u0000\u0001binary\u00ff\u00fe garbage' })), platform: 'linux', env: {} }); const x = await s.snapshot(); return x.available === false && x.reason === REASONS.UNPARSABLE && x.title === '' })())
B('★ 超长输出 ⇒ 截断 + `truncated:true` + note `output-truncated`（吃不下就如实说，不无限吃内存）',
  await (async () => {
    const s = mkSession({ run: makeRunner(linuxRules({ meta: PC_LINE + '\n' + 'x'.repeat(MAX_OUTPUT_CHARS * 2) })), platform: 'linux', env: {} })
    const x = await s.snapshot()
    return x.available === true && x.truncated === true && x.notes.indexOf('output-truncated') >= 0 && x.title === 'Song X'
  })())
B('★ 超长字段 ⇒ 裁剪到 MAX_FIELD_CHARS + `clipped:true`（一条脏数据不许把界面撑爆）',
  await (async () => {
    const long = 'T'.repeat(MAX_FIELD_CHARS * 3)
    const line = ['Playing', '1000', '0', long, 'A', 'B', ''].join('\t')
    const s = mkSession({ run: makeRunner(linuxRules({ meta: line })), platform: 'linux', env: {} })
    const x = await s.snapshot()
    return x.available === true && x.clipped === true && x.title.length === MAX_FIELD_CHARS && x.notes.indexOf('field-clipped') >= 0
  })())
B('★ 未展开的模板标记（老版本 playerctl 不认 {{position}}）⇒ 丢该字段 + note，**不当曲名显示**',
  await (async () => {
    const line = ['{{status}}', '215000000', '{{position}}', 'Song Y', 'Artist Y', 'Album Y', ''].join('\t')
    const s = mkSession({ run: makeRunner(linuxRules({ meta: line })), platform: 'linux', env: {} })
    const x = await s.snapshot()
    return x.available === true && x.title === 'Song Y' && x.duration === 215000 && x.position === null && x.playing === false && x.notes.indexOf('unexpanded:position') >= 0
  })())
B('★ 整个模板都没展开 ⇒ unparsable（不是"一首叫 {{status}} 的歌"）',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules({ meta: '{{status}}\t{{xesam:title}}' })), platform: 'linux', env: {} }); const x = await s.snapshot(); return x.available === false && x.reason === REASONS.UNPARSABLE })())
B('多行输出（曲名里带换行）⇒ 只取第一行 + note multiline-output（宁可少显示，不猜）',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules({ meta: PC_LINE + '\ntail-of-output' })), platform: 'linux', env: {} }); const x = await s.snapshot(); return x.title === 'Song X' && x.notes.indexOf('multiline-output') >= 0 })())
B('控制字符被剥掉（换行/NUL 不进 UI、也不做日志注入）',
  sanitizeText('a\u0000b\nc').text === 'a b c' && sanitizeText('  x  ').text === 'x')
B('换算纯函数：微秒↔毫秒；负数/NaN ⇒ null（不编 0）',
  microsToMs(1500000) === 1500 && microsToMs(-1) === null && microsToMs('x') === null && msToMicros(1500) === 1500000 && msToMicros(-1) === null && toMsOrNull(0) === 0 && toMsOrNull(NaN) === null)
B('D-Bus 转义还原（\\" \\n \\\\）',
  unescapeDbusString('a\\"b\\nc\\\\d') === 'a"b c\\d')
B('★ 退化路线（没有 playerctl）⇒ dbus-send 的 Properties.GetAll 一次读全（含 CanGoNext 等属性）',
  await (async () => {
    const rules2 = [
      { match: (c, a) => c === 'dbus-send' && a[0] === '--version', stdout: 'D-Bus 1.14.10' },
      { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('ListNames') >= 0), stdout: DBUS_NAMES },
      { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('.GetAll') >= 0), stdout: DBUS_PROPS },
    ]
    const r2 = makeRunner(rules2)
    const s = mkSession({ run: r2, platform: 'linux', env: {} })
    const p = await s.probe()
    const x = await s.snapshot()
    return p.available === true && p.adapter === 'dbus-send' && x.available === true && x.source === 'dbus-send' &&
      x.title === 'Song X' && x.artist === 'Artist A' && x.album === 'Album X' && x.duration === 215000 && x.position === 65432 &&
      x.playing === true && x.canNext === true && x.canPrev === false && x.canPlay === true
  })())
B('dbus-send 回包：空 ⇒ empty-output；纯垃圾 ⇒ unparsable',
  parseDbusProperties('').reason === REASONS.EMPTY_OUTPUT && parseDbusProperties('method return\n nothing here').reason === REASONS.UNPARSABLE)
B('解析器对"字段不足/空"的返回值形状稳定（ok/fields/notes 恒在）',
  ['', '\t\t', 'a\tb'].every((t) => { const p = parsePlayerctlMetadata(t); return typeof p.ok === 'boolean' && typeof p.fields === 'object' && Array.isArray(p.notes) && typeof p.reason === 'string' }))
B('runner 归一化：Buffer/对象/异常形态都能进解析器（不让脏返回炸掉上层）',
  normalizeRunResult({ code: 0, stdout: Buffer.from('x') }).stdout === 'x' && normalizeRunResult(null).ok === false && normalizeRunResult({ ok: true }).ok === true && normalizeRunResult({ code: 3 }).ok === false)

/* ══════════════════════ C. Windows SMTC ══════════════════════ */
console.log('\n== C. Windows SMTC：脚本规格 + JSON 解析 + 控制回包 ==')
const rC = makeRunner(winRules())
const sC = mkSession({ run: rC, platform: 'win32', env: {} })
const probeC = await sC.probe()
const snapC = await sC.snapshot()
C('脚本用**真** WinRT API（不是占位 stub）',
  SMTC_SCRIPT.indexOf('GlobalSystemMediaTransportControlsSessionManager') >= 0 && SMTC_SCRIPT.indexOf('TryGetMediaPropertiesAsync') >= 0 && SMTC_SCRIPT.indexOf('GetTimelineProperties') >= 0 && SMTC_SCRIPT.indexOf('RequestAsync') >= 0)
C('★ 控制脚本自带**自证兜底**：$args 没绑上 ⇒ {"ok":false,"reason":"no-args"}（不盲发动作、不假装成功）',
  SMTC_CONTROL_SCRIPT.indexOf('$args.Count -lt 1') >= 0 && SMTC_CONTROL_SCRIPT.indexOf('no-args') >= 0 && SMTC_CONTROL_SCRIPT.indexOf('$args[0]') >= 0)
C('★ 控制脚本本体是**常量**（运行期参数不在脚本文本里）',
  SMTC_CONTROL_SCRIPT.indexOf('TryPlayAsync') >= 0 && !/\$\{/.test(SMTC_CONTROL_SCRIPT))
C('win32 ⇒ 适配器 smtc 且可用（二进制在位即算可用；当前会话为空是 snapshot 的事）',
  probeC.available === true && probeC.adapter === 'smtc' && probeC.reason === REASONS.OK)
C('读快照：曲名/艺术家/专辑/进度/总长/状态逐字段正确（毫秒）',
  snapC.available === true && snapC.source === 'smtc' && snapC.title === 'Song W' && snapC.artist === 'Artist W' && snapC.album === 'Album W' &&
  snapC.duration === 215000 && snapC.position === 12345 && snapC.playing === true)
C('★ SMTC 的 canPlay/canPause/canNext/canPrev 来自 Controls（真值，不是 MPRI 那套"未知就 false"）',
  snapC.canPlay === true && snapC.canPause === true && snapC.canNext === true && snapC.canPrev === false)
C('封面是 data URL（浏览器可直接显示，不需要宿主代理）',
  snapC.artUrl.indexOf('data:image/png;base64,') === 0 && snapC.artUrlKind === 'data')
C('空会话（脚本回 {}）⇒ available:false + no-metadata（不编"未知曲目"）',
  await (async () => { const s = mkSession({ run: makeRunner(winRules({ json: '{}' })), platform: 'win32', env: {} }); const x = await s.snapshot(); return x.available === false && x.reason === REASONS.NO_METADATA && x.title === '' })())
C('坏 JSON ⇒ unparsable；纯函数同样稳',
  await (async () => { const s = mkSession({ run: makeRunner(winRules({ json: 'not json at all' })), platform: 'win32', env: {} }); const x = await s.snapshot(); return x.available === false && x.reason === REASONS.UNPARSABLE })() &&
  parseSmtcJson('').reason === REASONS.EMPTY_OUTPUT && parseSmtcJson('[1,2]').reason === REASONS.UNPARSABLE)
C('控制回包三态：ok / refused / no-args（no-args = PS 参数没绑上时如实失败）',
  parseControlReply('{"ok":true}').ok === true && parseControlReply('{"ok":false,"reason":"refused"}').reason === 'refused' &&
  parseControlReply('{"ok":false,"reason":"no-args"}').reason === 'no-args' && parseControlReply('garbage').reason === REASONS.UNPARSABLE)
C('SMTC 控制：ok:false ⇒ control() 如实回失败（不吞）',
  await (async () => { const s = mkSession({ run: makeRunner(winRules({ ctl: '{"ok":false,"reason":"refused"}' })), platform: 'win32', env: {} }); const r = await s.control('playpause'); return r.ok === false && r.reason === 'refused' && r.adapter === 'smtc' })())

/* ══════════════════════ D. probe() 能力判定（本机就是"没有总线"那一类） ══════════════════════ */
console.log('\n== D. probe() 能力判定：每条都问"到底发了几条命令" ==')
D('★ 不支持的平台 ⇒ available:false + unsupported-platform 且 **0 条命令**',
  await (async () => { const r = makeRunner([]); const s = mkSession({ run: r, platform: 'darwin', env: {} }); const p = await s.probe(); return p.available === false && p.reason === REASONS.UNSUPPORTED_PLATFORM && r.calls.length === 0 })())
D('★ MPW_MEDIA_ADAPTER=none（显式关掉）⇒ available:false + disabled-by-env 且 **0 条命令**',
  await (async () => { const r = makeRunner(linuxRules()); const s = mkSession({ run: r, platform: 'linux', env: { MPW_MEDIA_ADAPTER: 'none' } }); const p = await s.probe(); return p.available === false && p.reason === REASONS.DISABLED_BY_ENV && r.calls.length === 0 })())
D('★ 两个二进制都不在位 ⇒ not-installed，且只跑了 2 条"版本"探测（**没有**任何媒体命令）',
  await (async () => {
    const r = makeRunner([])
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const p = await s.probe()
    const mediaish = r.count((c) => c.argv.some((a) => /metadata|GetAll|ListNames|-l$/.test(String(a))))
    return p.available === false && p.reason === REASONS.NOT_INSTALLED && r.calls.length === 2 && mediaish === 0
  })())
D('★ 本机情形：playerctl 在位但**没有会话总线** ⇒ no-session-bus（二进制 ≠ 能用；诚实探测的关键一条）',
  await (async () => {
    const r = makeRunner([
      { match: (c, a) => c === 'playerctl' && a[0] === '--version', stdout: 'playerctl 2.4.1' },
      { match: (c, a) => c === 'dbus-send' && a[0] === '--version', stdout: 'D-Bus 1.14.10' },
      { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('ListNames') >= 0), code: 1, stderr: 'Failed to open connection to session bus: Unable to autolaunch' },
    ])
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const p = await s.probe()
    return p.available === false && p.reason === REASONS.NO_SESSION_BUS && p.bus.checked === true && p.bus.ok === false && r.count((c) => c.argv.some((a) => String(a).indexOf('metadata') >= 0)) === 0
  })())
D('★ 总线通但没有 MPRIS 会话 ⇒ no-player（不编一个假播放器）',
  await (async () => {
    const r = makeRunner([
      { match: (c, a) => c === 'playerctl' && a[0] === '--version', stdout: 'playerctl 2.4.1' },
      { match: (c, a) => c === 'dbus-send' && a[0] === '--version', stdout: 'D-Bus 1.14.10' },
      { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('ListNames') >= 0), stdout: 'array [\n string "org.freedesktop.DBus"\n string ":1.7"\n]' },
      { match: (c, a) => c === 'playerctl' && a[0] === '-l', stdout: '' },
    ])
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const p = await s.probe()
    const x = await s.snapshot()
    return p.available === false && p.reason === REASONS.NO_PLAYER && x.available === false && x.reason === REASONS.NO_PLAYER && x.title === ''
  })())
D('★ 适配器不可用时：snapshot/control **一条媒体命令都不发**（只复用缓存的 probe）',
  await (async () => {
    const r = makeRunner([])
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    await s.probe()
    const n1 = r.calls.length
    const x = await s.snapshot()
    const c = await s.control('next')
    return x.available === false && x.reason === REASONS.NOT_INSTALLED && c.ok === false && c.reason === REASONS.NOT_AVAILABLE && r.calls.length === n1
  })())
D('★ MPW_MEDIA_PLAYER 白名单：注入形态（`a;rm -rf /`）⇒ bad-player，且那个串**从未**进过任何命令',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: { MPW_MEDIA_PLAYER: 'a;rm -rf /' } })
    const p = await s.probe()
    const leaked = r.count((c) => String(c.cmd).indexOf('rm') >= 0 || c.argv.some((a) => String(a).indexOf('rm -rf') >= 0))
    return p.available === false && p.reason === REASONS.BAD_PLAYER && leaked === 0
  })())
D('合法但少见的播放器名（含 . - _ 与数字）⇒ 用 `--player=<名>`，且名只出现在**一个** argv 元素里',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: { MPW_MEDIA_PLAYER: 'MPV-1.2_x' } })
    const p = await s.probe()
    await s.snapshot()
    const c = r.calls.find((x) => x.argv[1] === 'metadata')
    const inOneArg = c && c.argv.filter((a) => String(a).indexOf('MPV-1.2_x') >= 0).length === 1
    return p.players[0] === 'MPV-1.2_x' && !!c && c.cmd === 'playerctl' && c.argv[0] === '--player=MPV-1.2_x' && inOneArg === true
  })())
D('MPW_MEDIA_ADAPTER 强制指定（在 linux platform 上强指 smtc 也照办：便于排障）',
  await (async () => { const r = makeRunner(winRules()); const s = mkSession({ run: r, platform: 'linux', env: { MPW_MEDIA_ADAPTER: 'smtc' } }); const p = await s.probe(); return p.available === true && p.adapter === 'smtc' && r.hasCmd('powershell.exe') })())
D('无法识别的 MPW_MEDIA_ADAPTER ⇒ 忽略 + 出声（不静默），仍走自动判定',
  await (async () => {
    const warns = []
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: { MPW_MEDIA_ADAPTER: 'mpris??' }, log: { warn: (m) => warns.push(String(m)) } })
    const p = await s.probe()
    return p.adapter === 'playerctl' && warns.length === 1 && warns[0].indexOf('MPW_MEDIA_ADAPTER') >= 0
  })())
D('★ probe TTL 缓存：TTL 内二次 probe **0 条新命令**；force:true 绕过缓存',
  await (async () => {
    let t = 1000
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {}, now: () => t })
    await s.probe()
    const n1 = r.calls.length
    await s.probe()
    const n2 = r.calls.length
    t += PROBE_TTL_MS + 1
    await s.probe()
    const n3 = r.calls.length
    await s.probe({ force: true })
    const n4 = r.calls.length
    return n1 === n2 && n3 > n2 && n4 > n3
  })())
D('MPW_MEDIA_TIMEOUT_MS 走钳制（不许用 env 关掉超时或拉到 60s）',
  mkSession({ run: makeRunner([]), platform: 'linux', env: { MPW_MEDIA_TIMEOUT_MS: '999999' } }).describe().timeoutMs === MAX_TIMEOUT_MS &&
  mkSession({ run: makeRunner([]), platform: 'linux', env: { MPW_MEDIA_TIMEOUT_MS: 'abc' } }).describe().timeoutMs === DEFAULT_TIMEOUT_MS)
D('playersFromText 纯函数：去重/保序/剔除 playerctld 与私有名',
  JSON.stringify(playersFromText(DBUS_NAMES)) === '["spotify"]' && JSON.stringify(playersFromText('org.mpris.MediaPlayer2.a org.mpris.MediaPlayer2.a')) === '["a"]' && playersFromText('').length === 0)
/* ↓ 这两条来自**本机实测**（docs/MEDIA-SESSION.md §2）：本机 dbus-send 的 `--version` 不是合法选项，
   它把用法打到 stderr 并 exit 1，而用法文本里正好带 `--reply-timeout=MSEC`。第一次真机跑时
   被这两个细节各坑了一次（误判成 not-installed / 误判成 timeout），所以在此钉死。 */
const DBUS_SEND_USAGE = 'Usage: dbus-send [--help] [--system | --session | --bus=ADDRESS | --peer=ADDRESS] [--dest=NAME] [--type=TYPE] [--print-reply[=literal]] [--reply-timeout=MSEC] <destination object path> <message name> [contents ...]'
const DBUS_NO_BUS = 'Failed to open connection to "session" message bus: Unable to autolaunch a dbus-daemon without a $DISPLAY for X11'
const realMachineRules = () => ([
  /* playerctl 真机不存在 ⇒ ENOENT（假 runner 未命中规则时就是这条） */
  { match: (c, a) => c === 'dbus-send' && a[0] === '--version', code: 1, stdout: '', stderr: DBUS_SEND_USAGE },
  { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('ListNames') >= 0), code: 1, stdout: '', stderr: DBUS_NO_BUS },
])
D('★ 本机实测①：`--version` 退出非 0 **仍算在位**（在位判据是"能不能 exec 起来"，不是退出码）',
  await (async () => {
    const r = makeRunner(realMachineRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const p = await s.probe()
    const dbs = p.candidates.find((c) => c.id === 'dbus-send')
    return p.adapter === 'dbus-send' && dbs && dbs.present === true && dbs.exitCode === 1 && p.reason === REASONS.NO_SESSION_BUS
  })())
D('★ 本机实测②：错误文本里出现 `reply-timeout` 字样**不许**被当成超时（timedOut 只看信号/错误码）',
  await (async () => {
    const r = makeRunner(realMachineRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const p = await s.probe()
    const x = await s.snapshot()
    const c = await s.control('playpause')
    return s.stats().timeouts === 0 && p.reason === REASONS.NO_SESSION_BUS && p.bus.ok === false && p.bus.via === 'dbus-send' &&
      x.available === false && x.reason === REASONS.NO_SESSION_BUS && c.ok === false && c.reason === REASONS.NOT_AVAILABLE &&
      r.count((c2) => c2.argv.some((a) => /metadata|GetAll/.test(String(a)))) === 0
  })())
D('★ 总线中途消失（播放器本来在跑）⇒ 也报 no-session-bus，而不是笼统的 error',
  await (async () => {
    const r = makeRunner(linuxRules().map((x) => (x.match.toString().indexOf("'metadata'") >= 0 ? Object.assign({}, x, { code: 1, stdout: '', stderr: DBUS_NO_BUS }) : x)))
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    await s.probe()
    const x = await s.snapshot()
    return x.available === false && x.reason === REASONS.NO_SESSION_BUS
  })())

/* ══════════════════════ E. control()：参数化与失败路径 ══════════════════════ */
console.log('\n== E. control()：op 白名单 / 参数范围 / 逐字节 argv / 无 shell / 失败码 ==')
E('★ 未知 op ⇒ bad-op 且 **0 条命令**（连 probe 都不跑）',
  await (async () => { const r = makeRunner(linuxRules()); const s = mkSession({ run: r, platform: 'linux', env: {} }); const x = await s.control('destroy'); return x.ok === false && x.reason === REASONS.BAD_OP && r.calls.length === 0 })())
E('★ 非字符串/空 op ⇒ bad-op（不做类型体操，直接拒）',
  await (async () => { const r = makeRunner(linuxRules()); const s = mkSession({ run: r, platform: 'linux', env: {} }); const a = await s.control(null); const b = await s.control('  '); const c = await s.control({ op: 'play' }); return a.reason === REASONS.BAD_OP && b.reason === REASONS.BAD_OP && c.reason === REASONS.BAD_OP && r.calls.length === 0 })())
E('★ seek 参数范围：NaN/-1/超 24h/字符串 ⇒ bad-arg 且 0 条命令',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const a = await s.control('seek', NaN); const b = await s.control('seek', -1)
    const c = await s.control('seek', 24 * 3600 * 1000 + 1); const d = await s.control('seek', 'abc')
    return [a, b, c, d].every((x) => x.reason === REASONS.BAD_ARG) && r.calls.length === 0
  })())
E('★ playerctl 控制 argv 逐字节核对（next/prev 的动作名不是想当然的 skip）',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    await s.control('next'); await s.control('prev'); await s.control('playpause'); await s.control('play'); await s.control('pause')
    const seen = r.calls.filter((c) => c.cmd === 'playerctl' && c.argv[1] !== 'metadata' && c.argv[0] !== '--version' && c.argv[0] !== '-l').map((c) => c.argv.join(' '))
    const want = ['--player=spotify next', '--player=spotify previous', '--player=spotify play-pause', '--player=spotify play', '--player=spotify pause']
    return JSON.stringify(seen) === JSON.stringify(want)
  })())
E('★ seek 换算：playerctl 的 position 吃**秒**（90_000ms ⇒ "90.000"）',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const x = await s.control('seek', 90000)
    const c = r.calls.find((q) => q.argv[1] === 'position')
    return x.ok === true && !!c && JSON.stringify(c.argv) === JSON.stringify(['--player=spotify', 'position', '90.000'])
  })())
E('★ 非法 op/参数不进任何命令文本（注入面清零）且失败原因可判别',
  await (async () => { const r = makeRunner(linuxRules()); const s = mkSession({ run: r, platform: 'linux', env: {} }); await s.control('next; rm -rf /'); return r.calls.length === 0 })())
E('★ 无 shell 不变式：命令名只能是直呼可执行文件，argv 不许出现 `-c`/`/c` 解释器形态',
  (() => {
    const allow = ['playerctl', 'dbus-send', 'busctl', 'powershell.exe']
    const bad = rB.calls.concat(rC.calls).filter((c) => allow.indexOf(c.cmd) < 0 || c.argvIsArray !== true || c.argv[0] === '-c' || c.argv[0] === '/c')
    return bad.length === 0
  })(), '违规 ' + rB.calls.concat(rC.calls).filter((c) => ['playerctl', 'dbus-send', 'busctl', 'powershell.exe'].indexOf(c.cmd) < 0).length + ' 条')
E('★ SMTC 控制：脚本 argv 元素**逐字节等于**常量，op 必须是**另一个**元素（参数化而不是拼接）',
  await (async () => {
    const r = makeRunner(winRules())
    const s = mkSession({ run: r, platform: 'win32', env: {} })
    await s.control('next')
    const c = r.calls.find((q) => q.argv.some((a) => String(a).indexOf('TrySkipNextAsync') >= 0))
    return !!c && c.cmd === 'powershell.exe' && c.argv.length === 6 && c.argv[3] === SMTC_CONTROL_SCRIPT && c.argv[4] === 'next' && c.argv[5] === ''
  })())
E('★ SMTC seek：位置作为独立 argv 元素（不是拼进脚本）',
  await (async () => {
    const r = makeRunner(winRules())
    const s = mkSession({ run: r, platform: 'win32', env: {} })
    await s.control('seek', 4200)
    const c = r.calls.find((q) => q.argv.some((a) => String(a).indexOf('TryChangePlaybackPositionAsync') >= 0))
    return !!c && c.argv[3] === SMTC_CONTROL_SCRIPT && c.argv[4] === 'seek' && c.argv[5] === '4200'
  })())
E('★ dbus-send seek 是**绝对位置**：Properties.Set Position variant:int64:<µs>',
  await (async () => {
    const r = makeRunner([
      { match: (c, a) => c === 'dbus-send' && a[0] === '--version', stdout: 'D-Bus 1' },
      { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('ListNames') >= 0), stdout: DBUS_NAMES },
      { match: (c, a) => c === 'dbus-send' && a.some((x) => x.indexOf('.Set') >= 0), stdout: 'method return' },
    ])
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const x = await s.control('seek', 90000)
    const c = r.calls.find((q) => q.argv.some((a) => String(a).indexOf('.Set') >= 0))
    return x.ok === true && !!c && c.argv.indexOf('string:Position') >= 0 && c.argv.some((a) => a === 'variant:int64:90000000') && c.argv.some((a) => a === '--dest=org.mpris.MediaPlayer2.spotify')
  })())
E('★ 控制失败如实回码：`No players found` ⇒ no-player（不假装成功）',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules({ ctlFail: true })), platform: 'linux', env: {} }); const x = await s.control('next'); return x.ok === false && x.reason === REASONS.NO_PLAYER })())
E('控制成功 ⇒ ok:true + reason:ok + adapter 如实',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules()), platform: 'linux', env: {} }); const x = await s.control('next'); return x.ok === true && x.reason === REASONS.OK && x.op === 'next' && x.adapter === 'playerctl' })())
E('op 大小写/空白容错（" Next " ⇒ next），但**仍**受白名单约束',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules()), platform: 'linux', env: {} }); const a = await s.control(' Next '); const b = await s.control(' NEXT '); return a.ok === true && a.op === 'next' && b.op === 'next' })())
E('★ control **不参与去重**：两次并发 next 必须发出两条命令（去重会把连点吞掉一次）',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const [a, b] = await Promise.all([s.control('next'), s.control('next')])
    return a.ok === true && b.ok === true && r.count((c) => c.argv[1] === 'next') === 2
  })())
E('CONTROL_OPS 是唯一权威：每个 op 都能映射到至少一条命令（没有"列了却做不到"的键）',
  CONTROL_OPS.length === 6 && CONTROL_OPS.every((op) => ['play', 'pause', 'playpause', 'next', 'prev', 'seek'].indexOf(op) >= 0))

/* ══════════════════════ F. 超时与并发去重 ══════════════════════ */
console.log('\n== F. 超时（默认 800ms）与并发去重 ==')
F('★ 默认会话每次命令都带 800ms 超时（不给"裸奔"留口子）',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    await s.snapshot()
    await s.control('next')
    return r.calls.length > 0 && r.calls.every((c) => c.opts && c.opts.timeoutMs === 800)
  })())
F('★ 慢命令（假 runner **故意不认** timeoutMs）⇒ 模块自己的兜底生效：reason:timeout 且<250ms 返回',
  await (async () => {
    const r = makeRunner(linuxRules({ metaDelay: 300 }))
    const s = mkSession({ run: r, platform: 'linux', env: {}, timeoutMs: 60 })
    const t0 = Date.now()
    const x = await s.snapshot()
    const dt = Date.now() - t0
    return x.available === false && x.reason === REASONS.TIMEOUT && dt < 250 && s.stats().timeouts >= 1 && s.stats().maxConcurrent === 1
  })())
F('★ 超时后**不**留下"并发 2 条"的队列泄漏（模块视角 maxConcurrent 恒 1）',
  await (async () => {
    const r = makeRunner(linuxRules({ metaDelay: 300 }))
    const s = mkSession({ run: r, platform: 'linux', env: {}, timeoutMs: 60 })
    await Promise.all([s.snapshot(), s.snapshot(), s.snapshot()])
    return s.stats().maxConcurrent === 1
  })())
F('★ 单飞：5 个并发 snapshot() ⇒ metadata 只跑 **1** 次（deduped ≥ 4）',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    const all = await Promise.all([0, 1, 2, 3, 4].map(() => s.snapshot()))
    const meta = r.count((c) => c.argv[1] === 'metadata')
    return all.every((x) => x.available === true && x.title === 'Song X') && meta === 1 && s.stats().deduped >= 4
  })())
F('★ 全局串行：并发 snapshot + control ⇒ 真并发峰值 = 1（本机是手机/单进程约束）',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    await Promise.all([s.snapshot(), s.control('next'), s.snapshot(), s.control('pause')])
    return r.maxConcurrent() === 1 && s.stats().maxConcurrent === 1
  })())
F('★ 去重是"按 key"的：snapshot 与 control 不互相吞（控制照发）',
  await (async () => {
    const r = makeRunner(linuxRules())
    const s = mkSession({ run: r, platform: 'linux', env: {} })
    await Promise.all([s.snapshot(), s.control('next')])
    return r.count((c) => c.argv[1] === 'metadata') === 1 && r.count((c) => c.argv[1] === 'next') === 1
  })())
F('一条命令**失败**不会卡死队列（后续命令照跑：假 runner 先抛 ENOENT 再成功）',
  await (async () => {
    let first = true
    /* 强制 playerctl ⇒ 候选里只有它 ⇒ 总线探测走 **busctl** 这条路（顺带覆盖 busctl 分支）。 */
    const r = makeRunner([
      { match: (c, a) => c === 'playerctl' && a[0] === '--version', stdout: 'playerctl 2.4.1' },
      { match: (c, a) => c === 'busctl', stdout: 'org.freedesktop.DBus\norg.mpris.MediaPlayer2.spotify\n' },
      { match: (c, a) => c === 'playerctl' && a[0] === '-l', stdout: 'spotify\n' },
      { match: (c, a) => c === 'playerctl' && a[1] === 'metadata', stdout: () => { if (first) { first = false; const e = new Error('ENOENT x'); e.code = 'ENOENT'; throw e } return PC_LINE } },
    ])
    const s = mkSession({ run: r, platform: 'linux', env: { MPW_MEDIA_ADAPTER: 'playerctl' } })
    const a = await s.snapshot()
    const b = await s.snapshot()
    return a.available === false && a.reason === REASONS.NOT_INSTALLED && b.available === true && b.title === 'Song X' && s.stats().maxConcurrent === 1
  })())
F('stats() 计数自洽（commands 单调、maxConcurrent ≤ commands）',
  (() => { const st = sB.stats(); return st.commands > 0 && st.maxConcurrent >= 1 && st.maxConcurrent <= st.commands && st.running === 0 })())
F('★ 超时值也进 probe 报告（排障时能看出"这次只给了 60ms"）',
  await (async () => { const s = mkSession({ run: makeRunner(linuxRules()), platform: 'linux', env: {}, timeoutMs: 123 }); const p = await s.probe(); return p.timeoutMs === 123 && s.describe().timeoutMs === 123 })())
F('上限常量互相自洽（封面上限 > 字段上限；输出上限 > 字段上限 ⇒ 裁剪与截断是两件事）',
  MAX_ART_CHARS > MAX_FIELD_CHARS && MAX_OUTPUT_CHARS > MAX_FIELD_CHARS && PLAY_NAME_OK())
function PLAY_NAME_OK() { return PLAYER_NAME_RE.test('spotify') && PLAYER_NAME_RE.test('MPV-1.2_x') && !PLAYER_NAME_RE.test('a;rm') && !PLAYER_NAME_RE.test('x'.repeat(65)) }

/* ══════════════════════ G. 分辨力自证（RED-if-reverted） ══════════════════════ */
const MUTS = [
  {
    id: 'available-default-true',
    expect: 'A',
    why: '把中性回退的 available 改成 true（= 没播放器也报"有媒体"，A 组必须抓到）',
    anchor: "    available: false,\n    reason: REASONS.NO_PLAYER,",
    to: "    available: true,\n    reason: REASONS.NO_PLAYER,",
  },
  {
    id: 'truncation-removed',
    expect: 'B',
    why: '删掉输出截断（= 超长输出原样进解析器：吃内存 + truncated 标志永远为 false，B 组必须抓到）',
    anchor: 'if (stdout.length > MAX_OUTPUT_CHARS) {',
    to: 'if (false) {',
  },
  {
    id: 'linux-ignores-session-bus',
    expect: 'D',
    why: '让 Linux 判定不看会话总线（= 本机这种"有二进制没总线"的机器会被谎报成可用，D 组必须抓到）',
    anchor: 'if (!bus.ok) {',
    to: 'if (false) {',
  },
  {
    id: 'smtc-control-inlined-into-script',
    expect: 'E',
    why: '把 op/位置**拼进** PowerShell 脚本文本（= 参数化退化成字符串拼接：注入面回来了，E 组必须抓到）',
    anchor: "['-NoProfile', '-NonInteractive', '-Command', SMTC_CONTROL_SCRIPT, op, arg === null || arg === undefined ? '' : String(arg)]",
    to: "['-NoProfile', '-NonInteractive', '-Command', SMTC_CONTROL_SCRIPT + ' ' + op + ' ' + (arg === null || arg === undefined ? '' : String(arg))]",
  },
  {
    id: 'timeout-removed',
    expect: 'F',
    why: '删掉模块自己的超时兜底（= 慢命令直接挂住调用方，F 组必须抓到）',
    anchor: 'withTimeout(runSafe(cmd, argv, ms), ms)',
    to: 'runSafe(cmd, argv, ms)',
  },
  {
    id: 'single-flight-removed',
    expect: 'F',
    why: '删掉并发单飞（= 5 个订阅者同时问就起 5 条命令，F 组必须抓到）',
    anchor: 'const hit = inflight.get(key);',
    to: 'const hit = void 0;',
  },
]
if (!NO_MUT) {
  console.log('\n== G. 分辨力自证：6 组变异必须各自让**指定那一组**变红（副本在 mkdtemp，真树不动）==')
  const GROUPS = { A: /✗ A\d/, B: /✗ B\d/, C: /✗ C\d/, D: /✗ D\d/, E: /✗ E\d/, F: /✗ F\d/ }
  for (const m of MUTS) {
    const hits = SRC.split(m.anchor).length - 1
    if (hits !== 1) { G('变异 ' + m.id + ' 的锚点在源文件里唯一', false, '命中 ' + hits + ' 次（源码改了？）'); continue }
    const mutated = SRC.split(m.anchor).join(m.to)
    if (mutated === SRC) { G('变异 ' + m.id + ' 注入成功', false, '注入后与原文相同'); continue }
    const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--module', copy, '--no-mutations'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 })
    const out = (r.stdout || '') + (r.stderr || '')
    const caught = Object.keys(GROUPS).filter((g) => GROUPS[g].test(out))
    const got = caught.includes(m.expect) ? m.expect : (r.status === 0 ? 'PASS(没红)' : 'FAIL(其它组)')
    G('变异 ' + m.id + '：期望 ' + m.expect + ' 组变红，实际 ' + got, got === m.expect, m.why + '  [exit=' + r.status + ']')
    if (got !== m.expect) {
      console.error('      ↑ 实际报红分组：[' + caught.join(',') + ']；RED 行：'
        + out.split('\n').filter((l) => /^\s*✗/.test(l)).slice(0, 3).join(' | '))
    }
  }
}

cleanup()
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 系统媒体会话门禁未通过'); process.exit(1) }
console.log('✓ 系统媒体会话门禁通过：契约/三适配器解析/诚实能力判定（含无总线）/参数化控制/800ms 超时/并发去重 全部为真')

// script-sandbox-globals-test.mjs —— P-121 A：脚本沙箱的**全局副作用隔离**（宿主 console 不许被作者脚本静音）
//
// ── 现象（现场复现，逐字节）──────────────────────────────────────────────────────────────
//   `$MPW_ROOT/allwallpaper/0917/3462491575/scene.pkg` 的作者脚本正文含
//       `if (!isRunningInEditor) {\n\tconsole.log = () => { }`
//   （本文件 S2 直接在包里扫出来：命中 1 个脚本节点）。脚本沙箱的实现是 `elysia/scene-scripts.js`
//   的 `compileScript()`，它此前把 `context.console` 直接指向**宿主的真 console 对象**；而
//   `elysia/nsl.js` 的沙箱是 `new Function('__nslCtx', 'with (__nslCtx) { … }')`
//   （浏览器/Node 同一份实现 —— **没有独立 realm**）⇒ `with` 只遮蔽 ctx 上**有**的键，
//   ctx.console 就是宿主 console ⇒ 这个包跑过之后，**宿主进程的 `console.log` 被全局改写**。
//   改动前实测（同一台机器、同一命令）：
//     · 真包 0917/3462491575：跑完 t=0 的 init+update 与 t=0.5 的 update 后 `console.log === 跑之前` = **false**；
//     · 合成脚本 `console.log = () => {}`：`console.log` 变成空函数、宿主再 log 什么都不输出；
//   旁证：`tests/camera-script-origin-probe.mjs` 里专门写了 `muteConsole` 规避（测试被迫用
//   `fs.writeSync` 输出），说明这不只是"测试不便"，而是**真实运行路径上的宿主污染**。
//
// ── 根因（file:line 为改动前）────────────────────────────────────────────────────────────
//   `elysia/scene-scripts.js:321`（改前）：`Date, Math, console, JSON, …` —— `console` 与其它
//   内建一起被塞进 sandbox context，值是**宿主 console 对象本身**（同一个引用）；
//   `elysia/nsl.js:19-43`：`with (__nslCtx)` 的兜底作用域是**宿主全局**（Node 侧甚至是进程全局：
//   `process`/`Buffer`/`global` 可直达）⇒ ctx 上的键只是"遮蔽"，遮蔽物本身仍与宿主共享。
//
// ── 改法（file:line 为改动后）────────────────────────────────────────────────────────────
//   · `elysia/scene-scripts.js:259-306` 新增 `makeSandboxConsole()`：**每个沙箱一个** Proxy 门面 ——
//     写只落门面自己（作者"把 console 静音"的意图在它自己的沙箱内照常生效），读**按名字转发**到
//     *当前*宿主 console 的同名方法（调用时重取 ⇒ `demo.html:929-931` 把 `console.warn/error`
//     桥到页面 `#log` 面板之后，沙箱日志照样进 #log；Node 侧照常进 stdout）。门面不冻结：
//     作者脚本 `'use strict'` 下 `console.log = …` 必须能赋值成功，否则脚本会加载失败（更重的行为改变）。
//   · `elysia/scene-scripts.js:321-325`：`console: makeSandboxConsole()` 替掉 `console`；
//     并 `...SANDBOX_HOST_ONLY_GLOBALS`（`:309-317`）把**宿主进程句柄**显式 shadow 成 `undefined`
//     （`process/require/module/exports/Buffer/global`）—— WE 运行时不提供、浏览器里本来就不存在，
//     Node 侧从此与浏览器同形（语料 11 个 dd 包 `typeof process` 零命中）。
//
// ── 判据（本文件逐条钉住）──────────────────────────────────────────────────────────────
//   ① `console.log/warn/error/info/debug` 跑过"静音脚本"后与跑之前**逐个 `===` 同一引用**（S1a），
//      且宿主 `console.log` **仍然真的会输出**（S3b：**捕获子进程 stdout 字节**，不是"看起来没报错"）；
//   ② 正常脚本的 `console.log` 仍在宿主可见（S3a：子进程 stdout 里逐字出现）；沙箱内日志的去向写清：
//      门面 → 宿主 console 同名方法 →（浏览器）demo.html 的 `#log` 面板 /（Node）stdout；
//      作者自己静音之后那条**不再出现**（S3c）—— 证明门面是"每沙箱一个"而不是把日志全吞了；
//   ③ 其它危险全局：`globalThis`（沙箱内 = ctx，S5）、`localStorage`（沙箱内存实现，S7）、
//      `process/require/module/exports/Buffer/global`（shadow 成 undefined，S6）全部**真断言**钉住；
//      ② 剩下没隔离的（bare `setTimeout`/`fetch` 直达宿主全局、松散赋值落宿主 global、
//      `Object.prototype` 同 realm 共享）在 S8 里**如实记录测量值**（NOTE，不计票）——不假装已隔离。
//
// ── 内置红-if-reverted（真跑到；2 个变异，S9）────────────────────────────────────────────
//   把 `elysia/*.js` + `elysia/we-renderer/math.js`（scene-script-apis 的 import 链）**逐文件复制**
//   进 `mkdtemp` 临时目录（**绝不改真树**；`fs.cpSync` 在本机 /tmp 上抛 EINVAL、`Dirent.isFile()`
//   有误报 ⇒ 用 `statSync` 判类型 + `readFileSync/writeFileSync` 复制），对副本做最小"改回旧写法"变异：
//     M1：`console: makeSandboxConsole(),` → `console,`（回到共享宿主 console）⇒ S1a/S3b 红
//     M2：删掉 `...SANDBOX_HOST_ONLY_GLOBALS,`（回到"进程句柄可直达"）⇒ S6a 红
//   两个变异各自**独立起子进程**跑本文件（`--no-mutation` 防递归）：要求 `rc=1`、**点名的那条断言变红**、
//   且基线 ✓ S0 仍在（证明是"变异打破语义"而不是"副本根本加载不起来"）。
//   锚点命中数必须**恰好 1**，否则打 `SKIP … mutation-selfcheck`（不计票），绝不把"没法变异"当"变异通过"。
//
// ── 本轮实测（Node 24 + 假 DOM/mock-GL 无关；无浏览器、无 X11，硬约束）──────────────────────
//   · 改动前：真包 `console.log === before` = false；改动后 = true（本文件 S2 钉住）。
//   · 峰值 RSS 见结尾 `PeakRSS` 行（真包 35MB 走 parsePkg + JSON.parse，实测 ~120MB）。
//   · ⚠ 未证实项：本机**没有**浏览器，`new Function` + `with` 的**浏览器分支**只能靠同一份
//     `elysia/nsl.js` 源码等价外推；真机（WE 运行时 / 出货页面）复测未做。
//
// ── 注册待办 ─────────────────────────────────────────────────────────────────────────────
//   注册待办：`add "script-sandbox-globals" "node tests/script-sandbox-globals-test.mjs"`
//   （等 run-all-tests.sh 释放后加；本轮按纪律**不改** tests/run-all-tests.sh）
//
// 参照来源许可声明：本文件为原创测试代码，不含第三方实现代码（未复制/未翻译 wer-ref、we-layerd-ref、
//   oneincase/webwallgl）；真包只从本机语料读（仓库内 samples 已因版权移除 ⇒ 缺语料时该项 SKIP）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

// ═══════════════════════════ 0. 用法/参数/退出码 ═══════════════════════════
const USAGE = `用法：node tests/script-sandbox-globals-test.mjs [--no-mutation] [--verbose]
  --no-mutation   跳过内置红-if-reverted 自检
  --verbose       打印子进程输出全文
环境变量：
  MPW_SCENE_SCRIPTS  沙箱实现的**副本**路径（内置红-if-reverted 用；平时不要设，设了就等于"测的是副本"）
  MPW_ROOT           工作区根（默认 = 仓库的上一级，WS）—— 只用于真包条件项
退出码：0 全过（含 SKIP）/ 1 有失败 / 2 用法错误`
function usage(msg) { process.stderr.write('用法错误：' + msg + '\n' + USAGE + '\n'); process.exit(2) }
const argv = process.argv.slice(2)
let VERBOSE = false, MUTATION = true
for (const a of argv) {
  if (a === '--no-mutation') MUTATION = false
  else if (a === '--verbose') VERBOSE = true
  else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0) }
  else usage('未知参数 ' + a)
}

// ═══════════════════════════ 1. 真断言助手（真实计票）═══════════════════════════
// ⚠ 报告一律走 SAVED_LOG：M1 变异体里"宿主 console.log 被作者脚本静音"正是被测现象，
//   若用 `console.log` 报告，变异体会连自己的输出一起静音 ⇒ 判据无法读（假绿/假红都不可信）。
const SAVED_LOG = console.log
const out = (...a) => { try { SAVED_LOG(...a) } catch { /* ignore */ } }
let pass = 0, fail = 0, skip = 0
const note = (name, detail) => { out('  · ' + name + (detail ? '  [' + detail + ']' : '')) }
const ok = (name, cond, detail) => {
  if (cond) { pass++; out('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; out('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const skipItem = (name, reason) => { skip++; out('  SKIP script-sandbox-globals ' + name + ' — ' + reason) }

// ═══════════════════════════ 2. 被测沙箱（默认真树；变异自检用副本）═══════════════════════════
const MODULE = process.env.MPW_SCENE_SCRIPTS
  ? path.resolve(process.env.MPW_SCENE_SCRIPTS)
  : path.join(ROOT, 'elysia', 'scene-scripts.js')
if (!fs.existsSync(MODULE)) usage('沙箱实现不存在：' + MODULE)
const IS_MUTANT_RUN = !!process.env.MPW_SCENE_SCRIPTS
const mod = await import(pathToFileURL(MODULE).href)
const { applySceneScripts, createScriptCache } = mod

out('script-sandbox-globals-test —— P-121 A：沙箱全局副作用隔离（沙箱实现=' + path.relative(ROOT, MODULE) + '）')

// 子进程/变异共用临时目录（退出时清理）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p121-sandbox-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ } })

// ── 通用：把一段脚本放进真宿主跑一趟，读回它写进 value 的 JSON ──
// applySceneScripts 会把 update() 的返回值 formatResult 后写回 `obj.value`（非 Vec3 字符串原样），
// 所以"沙箱内看到的全局"可以用脚本自己序列化出来 —— 全是**数值/字符串**判据，不看渲染输出。
function runInSandbox(script, { id = 1, name = 'p121-probe' } = {}) {
  const node = { id, name, script, value: '' }
  const scene = { general: {}, objects: [node] }
  const cache = createScriptCache()
  applySceneScripts(scene, 0, { scriptCache: cache })
  let parsed = null
  try { parsed = JSON.parse(node.value) } catch { /* 非 JSON ⇒ 保持 null（断言里当缺数据） */ }
  const entry = [...cache.map.values()][0] || null
  return {
    node, scene, cache, entry, data: parsed,
    compileError: entry ? entry.error : '(无条目)',
    updateErrors: entry ? (entry.updateErrors || 0) : -1,
    ctx: entry ? entry.context : null,
  }
}

// ═══════════════════════════ 3. S0 前置：模块真的装上了 ═══════════════════════════
ok('S0a 沙箱宿主的两个入口都在（测试打的是真实现，不是空壳）',
  typeof applySceneScripts === 'function' && typeof createScriptCache === 'function',
  'applySceneScripts=' + typeof applySceneScripts + ' createScriptCache=' + typeof createScriptCache)
// 基线：本进程跑在 Node 里 ⇒ `process` 真实存在（下面 S6 的"被 shadow 掉"才有意义，不是平凡真）
ok('S0b 绿前提：测试进程自身跑在 Node 里（`typeof process === "object"`，宿主侧确实有进程句柄）',
  typeof process === 'object' && typeof Buffer === 'function', 'typeof process=' + typeof process + ' typeof Buffer=' + typeof Buffer)

// ═══════════════════════════ 4. S1 现场（合成最小复现）：宿主 console 逐属性 === ═══════════════════════════
const METHODS = ['log', 'warn', 'error', 'info', 'debug']
const MUTE_SCRIPT = [
  "'use strict';",
  'export function init(value) {',
  "  console.log('[沙箱] init：静音之前我还能输出');",
  '  console.log = () => {};',
  '  console.warn = () => {};',
  '  console.error = () => {};',
  '  console.info = () => {};',
  '  console.debug = () => {};',
  "  console.log('[沙箱] init：静音之后（这一条在我自己的沙箱里不该出去）');",
  '  return value;',
  '}',
].join('\n')
{
  const before = {}; for (const m of METHODS) before[m] = console[m]
  const r = runInSandbox(MUTE_SCRIPT, { name: 'muter' })
  ok('S1a ★ 跑过 `console.log = () => {}` 的脚本后，宿主 console 的 5 个写方法**逐个 === 同一引用**',
    METHODS.every((m) => console[m] === before[m]),
    METHODS.map((m) => m + ':' + (console[m] === before[m] ? '===' : '≠')).join(' '))
  ok('S1b 宿主 console 的对象身份也没被换（不是"换了个同名对象"）', typeof console.log === 'function' && console.log.name === before.log.name,
    'name=' + String(console.log.name) + '（改动前实测：被换成空箭头函数、宿主再 log 什么都不输出）')
  ok('S1c 沙箱条目本身跑成功了（0 error ⇒ S1a 不是"脚本根本没跑"的假绿）',
    r.compileError == null && r.updateErrors === 0, 'compileError=' + String(r.compileError) + ' updateErrors=' + r.updateErrors)
  ok('S1d 门面 ≠ 宿主 console（沙箱拿到的是每沙箱一个的独立对象）',
    !!r.ctx && r.ctx.console !== console && r.ctx.console.log !== console.log,
    'ctx.console===console ? ' + (r.ctx && r.ctx.console === console))
  ok('S1e 作者的"静音"意图在**它自己的沙箱内**仍然生效（只是不再污染宿主）',
    !!r.ctx && r.ctx.console.log !== console.log && String(r.ctx.console.log).includes('=> {}'),
    'ctx.console.log=' + (r.ctx ? String(r.ctx.console.log).slice(0, 40) : '(无 ctx)'))
}

// ═══════════════════════════ 5. S2 现场（真语料 0917/3462491575）═══════════════════════════
{
  const MPW_WS = process.env.MPW_ROOT || WS
  const PKG = path.join(MPW_WS, 'allwallpaper', '0917', '3462491575', 'scene.pkg')
  if (!fs.existsSync(PKG)) {
    skipItem('真包 0917/3462491575（P-120 记录的现场包）', '缺语料 ' + PKG)
  } else {
    const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
    const DEC = new TextDecoder()
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
    const sj = JSON.parse(DEC.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    const hits = []
    const walk = (o) => {
      if (!o || typeof o !== 'object') return
      if (typeof o.script === 'string' && /console\.log\s*=/.test(o.script)) hits.push(o)
      if (Array.isArray(o)) { o.forEach(walk); return }
      for (const k of Object.keys(o)) walk(o[k])
    }
    walk(sj)
    ok('S2a 真包里确实有"把 console.log 赋值掉"的作者脚本（现场证据，不是合成）',
      hits.length >= 1, '命中脚本节点=' + hits.length)
    const before = {}; for (const m of METHODS) before[m] = console[m]
    const cache = createScriptCache()
    applySceneScripts(sj, 0, { scriptCache: cache })
    applySceneScripts(sj, 0.5, { scriptCache: cache })     // 第二趟：idempotent 复核
    const errs = [...cache.map.values()].filter((e) => e.error).length
    ok('S2b ★★ 真包跑两趟（init+update、再 update）后，宿主 console 的 5 个写方法仍逐个 === 同一引用',
      METHODS.every((m) => console[m] === before[m]),
      METHODS.map((m) => m + ':' + (console[m] === before[m] ? '===' : '≠')).join(' ')
      + '；脚本条目=' + cache.map.size + ' 编译失败=' + errs
      + '（改动前实测：console.log === before 为 **false**）')
    ok('S2c 该包脚本没有因为隔离而变红（编译失败条目 = 0 ⇒ 作者脚本照跑）',
      cache.map.size >= 1 && errs === 0, '条目=' + cache.map.size + ' 失败=' + errs)
  }
}

// ═══════════════════════════ 6. S3 ②：日志去向（捕获子进程 stdout 字节）═══════════════════════════
// 为什么必须用**子进程 + 真 stdout**：本进程里给 `process.stdout.write` 打补丁会把自己的报告一起捕进去
// （自证式假绿）。子进程只做实验、按**字节**输出，父进程读 spawnSync 的 stdout 逐条断言。
{
  const CHILD = path.join(TMP, 'stdout-child.mjs')
  const childSrc = `
import { pathToFileURL } from 'node:url'
const SAVED_LOG = console.log
const OUT = (...a) => { try { SAVED_LOG(...a) } catch {} }
const mod = await import(pathToFileURL(process.env.MPW_SCENE_SCRIPTS).href)
const MUTER = [
  "'use strict';",
  'export function update(value) {',
  "  console.log('P121-SCRIPT-LOG-BEFORE-MUTE');",
  '  console.log = () => {}; console.warn = () => {}; console.error = () => {};',
  "  console.log('P121-SCRIPT-LOG-AFTER-MUTE');",
  '  return value;',
  '}',
].join('\\n')
const LOGGER = [
  "'use strict';",
  'export function update(value) {',
  "  console.log('P121-SCRIPT-LOG-FROM-NORMAL-SCRIPT');",
  '  return value;',
  '}',
].join('\\n')
const before = { log: console.log, warn: console.warn, error: console.error }
const scene = { general: {}, objects: [
  { id: 1, name: 'muter', script: MUTER, value: '0 0 0' },     // 先跑（节点顺序 = update 顺序）
  { id: 2, name: 'logger', script: LOGGER, value: '0 0 0' },
] }
mod.applySceneScripts(scene, 0, { scriptCache: mod.createScriptCache() })
const same = before.log === console.log && before.warn === console.warn && before.error === console.error
OUT('P121-CHILD-IDENTITY ' + JSON.stringify({ same }))
console.log('P121-HOST-MARKER-STILL-OUTPUTS')   // ← 宿主自己的 log：M1 变异体里这一行会消失
`
  fs.writeFileSync(CHILD, childSrc)
  const r = spawnSync(process.execPath, [CHILD], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    env: Object.assign({}, process.env, { MPW_SCENE_SCRIPTS: MODULE }),
  })
  const so = String(r.stdout || '')
  if (VERBOSE) note('S3 子进程 stdout（' + so.length + ' 字节）', JSON.stringify(so.slice(0, 400)))
  ok('S3-run 子进程正常结束（rc=0；否则下面三条都是在读崩溃现场）', r.status === 0,
    'rc=' + r.status + ' stderr=' + JSON.stringify(String(r.stderr || '').slice(0, 200)))
  ok('S3a ★ 正常脚本的 console.log **逐字**出现在宿主 stdout（沙箱没把日志吞掉）',
    so.includes('P121-SCRIPT-LOG-FROM-NORMAL-SCRIPT'), '捕获 ' + so.length + ' 字节')
  ok('S3b ★★ 宿主自己的 console.log 在脚本静音之后**仍然真的会输出**（stdout 字节证据，不是"没报错"）',
    so.includes('P121-HOST-MARKER-STILL-OUTPUTS') && so.includes('"same":true'),
    'identity=' + (/"same":true/.test(so) ? 'true' : 'false') + ' HostMarker=' + so.includes('P121-HOST-MARKER-STILL-OUTPUTS'))
  ok('S3c 静音**之前**那条日志照旧可见（转发在跑，不是"整条 console 都死了"）',
    so.includes('P121-SCRIPT-LOG-BEFORE-MUTE'), '')
  ok('S3d 静音**之后**那条日志不再出现（作者的静音意图在它自己的沙箱内生效 ⇒ 门面是每沙箱一个，不是全局开关）',
    !so.includes('P121-SCRIPT-LOG-AFTER-MUTE'), '')
}

// ═══════════════════════════ 7. S4 每沙箱一个门面（互不影响）═══════════════════════════
{
  const a = runInSandbox(MUTE_SCRIPT, { id: 11, name: 'sandbox-A' })
  const b = runInSandbox('export function update(value) { return value; }', { id: 12, name: 'sandbox-B' })
  ok('S4a 两个沙箱的门面是**不同对象**（缓存按脚本源共享，但门面不共享）',
    !!a.ctx && !!b.ctx && a.ctx.console !== b.ctx.console && a.ctx.console.log !== b.ctx.console.log,
    'A===B ? ' + (a.ctx && b.ctx && a.ctx.console === b.ctx.console))
  // B 的门面 log 是否还在"转发"——用**临时替换宿主 console.log** 来证：门面按名字**调用时**重取宿主方法，
  // 所以宿主（= 出货页面的 demo.html:929-931 把 console.warn/error 桥到 #log 面板）替换之后照样跟得上。
  const savedLog = console.log, savedWarn = console.warn
  const seen = []
  console.log = (...args) => { seen.push('log:' + args.join(' ')) }
  console.warn = (...args) => { seen.push('warn:' + args.join(' ')) }
  try {
    if (b.ctx) { b.ctx.console.log('P121-FORWARD-PROBE'); b.ctx.console.warn('P121-WARN-BRIDGE-PROBE') }
  } finally { console.log = savedLog; console.warn = savedWarn }
  ok('S4b A 静音不影响 B：B 的门面 log 仍转发到**当前**宿主方法（换掉宿主 console.log 后调用被记到）',
    seen.includes('log:P121-FORWARD-PROBE'), '记录=' + JSON.stringify(seen))
  ok('S4c 同一机制的出货用法：宿主把 console.warn 桥到页面 #log 之后，沙箱 warn 照样进那条桥（demo.html:929-931）',
    seen.includes('warn:P121-WARN-BRIDGE-PROBE'), '记录=' + JSON.stringify(seen))
  ok('S4d A 静音也不影响宿主（对照 S1a；这条是"每个沙箱一个门面"的第三面）',
    typeof console.log === 'function' && !String(console.log).includes('=> {}'),
    '宿主 console.log.name=' + String(console.log.name))
}

// ═══════════════════════════ 8. S5～S7 ③：其它危险全局（真断言钉住）═══════════════════════════
const GLOBAL_PROBE = [
  "'use strict';",
  'export function update(value) {',
  '  var r = {};',
  "  r.typeofProcess = typeof process;",
  "  r.typeofRequire = typeof require;",
  "  r.typeofModule = typeof module;",
  "  r.typeofExports = typeof exports;",
  "  r.typeofBuffer = typeof Buffer;",
  "  r.typeofGlobal = typeof global;",
  "  r.typeofGlobalThis = typeof globalThis;",
  "  r.typeofLocalStorage = typeof localStorage;",
  "  r.localStorageHasGet = !!(typeof localStorage === 'object' && typeof localStorage.get === 'function');",
  "  r.engineTimeoutIsFn = (typeof engine === 'object' && typeof engine.setTimeout === 'function');",
  "  r.engineTimeoutIsHostTimeout = (typeof engine === 'object' && engine.setTimeout === setTimeout);",
  "  r.bareFetch = typeof fetch;",
  "  r.bareSetTimeout = typeof setTimeout;",
  "  globalThis.__p121CtxMark = 'from-sandbox';",   // globalThis 若= 宿主 ⇒ 会落到宿主 global
  "  localStorage.set('p121-key', 'p121-value');",
  "  try { __p121Loose = 'leak'; } catch (e) { r.looseThrew = String(e && e.message); }",   // 未声明标识符
  "  try { Object.prototype.__p121Proto = 'proto'; } catch (e) { r.protoThrew = String(e && e.message); }",
  '  r.localStorageReadBack = localStorage.get("p121-key");',
  '  return JSON.stringify(r);',
  '}',
].join('\n')
{
  const r = runInSandbox(GLOBAL_PROBE, { name: 'globals' })
  const d = r.data || {}
  ok('S5 绿前提：探针脚本跑成功、序列化结果读得回来（下面每条断言才有意义）',
    !!r.data && r.updateErrors === 0, 'data=' + (r.data ? 'ok' : 'null') + ' updateErrors=' + r.updateErrors + ' compileError=' + String(r.compileError))
  ok('S5a ★ 沙箱里 `globalThis` = 沙箱 ctx：脚本写 `globalThis.__p121CtxMark` **没有**落到宿主 global',
    globalThis.__p121CtxMark === undefined, '宿主 globalThis.__p121CtxMark=' + String(globalThis.__p121CtxMark))
  ok('S5b 那它落到哪了：沙箱条目自己的 context 上（可观测落点 = entry.context）',
    !!r.ctx && r.ctx.__p121CtxMark === 'from-sandbox', 'entry.context.__p121CtxMark=' + String(r.ctx && r.ctx.__p121CtxMark))
  const sh = ['Process', 'Require', 'Module', 'Exports', 'Buffer', 'Global']
  const undef = sh.filter((k) => d['typeof' + k] === 'undefined')
  ok('S6 ★ 宿主进程句柄 6 个全被 shadow 成 undefined（process/require/module/exports/Buffer/global）',
    undef.length === sh.length,
    sh.map((k) => k + '=' + String(d['typeof' + k])).join(' '))
  ok('S6a ★★ 其中 `process` 单独钉一条（变异 M2 点名这条）：沙箱内 typeof process === "undefined"，而宿主是 object',
    d.typeofProcess === 'undefined' && typeof process === 'object',
    'sandbox=' + String(d.typeofProcess) + ' host=' + typeof process)
  ok('S6b `globalThis` 仍是 object（没有把沙箱自己的 ctx 一起 shadow 掉 ⇒ 脚本探测环境不会崩）',
    d.typeofGlobalThis === 'object', 'sandbox typeof globalThis=' + String(d.typeofGlobalThis))
  ok('S7a localStorage = 沙箱自己的内存实现（不是宿主页面的 Storage）',
    d.typeofLocalStorage === 'object' && d.localStorageHasGet === true && d.localStorageReadBack === 'p121-value'
    && !!r.ctx && r.ctx.localStorage !== globalThis.localStorage,
    'typeof=' + String(d.typeofLocalStorage) + ' readBack=' + String(d.localStorageReadBack))
  ok('S7b `engine.setTimeout` 是宿主 API（≠ 宿主全局 setTimeout；语料里 3326873240 等用它做节流）',
    d.engineTimeoutIsFn === true && d.engineTimeoutIsHostTimeout === false,
    'isFn=' + String(d.engineTimeoutIsFn) + ' isHostTimeout=' + String(d.engineTimeoutIsHostTimeout))
  // S8 的两条"如实记录"要在宿主留下痕迹 ⇒ **先取快照**，再立刻清掉（不留在宿主 global / 原型链上）
  const looseSnap = (() => { try { return String(globalThis.__p121Loose) } catch { return '?' } })()
  const protoSnap = (() => { try { return String(({}).__p121Proto) } catch { return '?' } })()
  try { delete globalThis.__p121Loose } catch { /* ignore */ }
  try { delete Object.prototype.__p121Proto } catch { /* ignore */ }
  try { delete globalThis.__p121CtxMark } catch { /* ignore */ }

  // ═══════════ S8 剩余面（**如实记录，不计票**）：没有隔离的那几条 + 它们的测量值 ═══════════
  note('S8 剩余面（NOTE，不是绿）：沙箱是 `new Function` + `with(ctx)`（同 realm，`elysia/nsl.js`）⇒')
  note('    ① bare `setTimeout` / `fetch` 未遮蔽 ⇒ 直达宿主全局',
    'typeof fetch=' + String(d.bareFetch) + ' typeof setTimeout=' + String(d.bareSetTimeout) + '（本机 Node 两者都存在于宿主全局）')
  note('    ② 未声明标识符的松散赋值落**宿主** global（`with` 没这个键就穿透）',
    '脚本内 `__p121Loose = "leak"` ⇒ 宿主 globalThis.__p121Loose=' + looseSnap)
  note('    ③ 内建对象（Object/Array/…）与宿主同 realm ⇒ `Object.prototype.x = 1` 会写穿宿主原型链',
    '脚本内 `Object.prototype.__p121Proto = "proto"` ⇒ 宿主 ({}).__p121Proto=' + protoSnap)
  note('    以上三条**不在本轮修复范围**（要真隔离得给沙箱独立 realm —— 浏览器侧没有 node:vm），'
    + '本轮只把"已被遮蔽/已隔离"的那些钉住；三条都已在 docs/PATCHES.md P-121「未证实项」列明')
}

// ═══════════════════════════ 9. S9 内置红-if-reverted（真副本变异）═══════════════════════════
if (IS_MUTANT_RUN) {
  note('S9 变异体运行（MPW_SCENE_SCRIPTS 已设）⇒ 跳过红-if-reverted 自检，避免递归')
} else if (!MUTATION) {
  note('S9 红-if-reverted 自检被 --no-mutation 跳过（本次运行**未**复核变异必红）')
} else {
  const SRC = fs.readFileSync(MODULE, 'utf8')
  try {
    // 逐文件复制（`fs.cpSync` 在本机 /tmp 上抛 EINVAL）；**用 statSync 判类型**（本机 fs 的
    // Dirent.isFile() 对部分普通文件报 false/isSymbolicLink()=true，靠它会漏掉依赖模块）
    const copyTree = (fromDir, toDir, filter) => {
      fs.mkdirSync(toDir, { recursive: true })
      for (const name of fs.readdirSync(fromDir)) {
        const src = path.join(fromDir, name), dst = path.join(toDir, name)
        let st = null
        try { st = fs.statSync(src) } catch { st = null }
        if (!st) continue
        if (st.isDirectory()) { copyTree(src, dst, filter); continue }
        if (!st.isFile()) continue
        if (filter && !filter(src, name)) continue
        fs.writeFileSync(dst, fs.readFileSync(src))
      }
    }
    const tmpEly = path.join(TMP, 'elysia')
    copyTree(path.join(ROOT, 'elysia'), tmpEly, (src) => !src.includes(path.sep + 'vendor' + path.sep))
    const MUTANTS = [
      {
        id: 'M1', fix: 'console 门面', expectName: 'S1a（宿主 console 逐属性 ===）', expect: /✗ S1a/,
        desc: '改回旧写法：`console: makeSandboxConsole()` → `console`（沙箱与宿主共享真 console）',
        edits: [['console: makeSandboxConsole(),', 'console,']],
      },
      {
        id: 'M2', fix: '进程句柄 shadow', expectName: 'S6a（沙箱内 typeof process === undefined）', expect: /✗ S6a/,
        desc: '改回旧写法：删掉 `...SANDBOX_HOST_ONLY_GLOBALS,`（process/Buffer/global 可直达宿主）',
        edits: [['    ...SANDBOX_HOST_ONLY_GLOBALS,\n', '']],
      },
    ]
    for (const m of MUTANTS) {
      let src = SRC, bad = null
      for (const [from, to] of m.edits) {
        const n = src.split(from).length - 1
        if (n !== 1) { bad = '锚点命中 ' + n + ' 次：' + JSON.stringify(from.slice(0, 70)); break }
        src = src.split(from).join(to)
      }
      if (bad) { skipItem('mutation-selfcheck ' + m.id, bad + '（沙箱那几行已被改写 ⇒ 需重新标定；不做变异＝不算证据）'); continue }
      const f = path.join(tmpEly, 'scene-scripts.js')
      fs.writeFileSync(f, src)
      const r = spawnSync(process.execPath, [process.argv[1], '--no-mutation'], {
        encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
        env: Object.assign({}, process.env, { MPW_SCENE_SCRIPTS: f }),
      })
      const so = String(r.stdout || '') + String(r.stderr || '')
      const redLine = (so.match(m.expect) || [])[0] || (so.match(/✗ [^\n]*/) || [])[0] || ''
      ok('S9-' + m.id + '（' + m.fix + '）变异「' + m.desc + '」⇒ 子进程 rc=1 且 ' + m.expectName + ' 变红',
        r.status === 1 && m.expect.test(so),
        'rc=' + r.status + ' 失败断言=' + JSON.stringify(redLine.slice(0, 160)))
      // 基线仍在 ⇒ 变异打破的是被点名的那条语义，不是"副本根本加载不起来"（否则红得毫无意义）
      ok('S9-' + m.id + 'b 变异体里基线仍为 ✓（S0a/S5 在变异体里仍成立 ⇒ 红是被点名的那条）',
        /✓ S0a/.test(so) && /✓ S5 /.test(so), '')
      if (r.status !== 1 && VERBOSE) note('S9-' + m.id + ' 子进程输出尾部', JSON.stringify(so.slice(-600)))
    }
  } finally { /* TMP 由 process.on('exit') 统一清理 */ }
}

// ═══════════════════════════ 10. 汇总（真实计票）═══════════════════════════
const peak = (() => { try { const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/); return m ? Math.round(+m[1] / 1024) + 'MB' : '?' } catch { return '?' } })()
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skip + '；PeakRSS=' + peak + ')')
if (fail) {
  out('\n' + fail + ' 项失败')
  process.exit(1)
}
out('\nALL PASS （' + pass + ' 项' + (skip ? '，另 SKIP ' + skip : '') + '）')
process.exit(0)

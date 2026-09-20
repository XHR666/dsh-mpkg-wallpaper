// tools/cross-platform-test.mjs —— 插件侧**跨平台静态门禁**（秒级：无浏览器 / 无网络 / 无真机）
//
// 为什么要有它：本仓既有门禁几乎全是"在 Linux 本机跑一遍看行为"，**没有一条**钉住"平台分支真的齐全、
// 不许写成 Linux 独占"。WSL 只写死 /mnt/c 就是这类漏网：Steam 装在 D:/E:/… 的 WSL 用户永远扫不到，
// 而本机（非 WSL）跑什么都绿 —— 判据必须是契约，不是"在我机器上能跑"。
//
// 判据（任一 ✗ → 退出码 1）：
//   A 纯函数契约（lib/index.js 的 steamProbeDirs(env)，五个入参全可注入）：
//     · win32/darwin/linux/android 的候选集合与"抽函数之前"的历史表达式**逐字节相同**（重构不是重设计）；
//     · WSL（release 含 microsoft；或注入的 /proc/version 含 microsoft）⇒ /mnt/d…/mnt/z × 四相对路径，
//       且仍含 /mnt/c 两条；release 换成普通 linux ⇒ 一条 /mnt/d 都没有（证明是那条分支产生的，不是到处乱探）；
//     · 三平台各自命中自己的根：macOS 根不出现在 linux 入参里，反之亦然；
//     · 纯函数纪律：同参两次调用逐项相同 / 无重复项 / 全是字符串 / 退化入参（会抛的 exists、会抛的
//       procVersion、null 与空串入参）一律不抛；
//     · 接线：locateWallpaperEngine() 真的走这个纯函数（源码级），旧常量 STEAM_PROBE_DIRS_NONWIN 已消失。
//   B tracked 静态扫描（`git ls-files -z`，NUL 分隔；没有 git ⇒ 打印 SKIP 并以 0 退出，不假装通过）：
//     · B1 代码路径（lib/**/*.js、tools/**/*.mjs）：不许有 '/tmp/…' 字面量；五类宿主绝对路径
//          （本机工作区根 / 用户主目录 / 设备共享存储根 / Termux 私有目录 / Windows 用户目录）
//       必须**当场可覆盖** —— 同行出现 process.env / os.homedir() / os.tmpdir() 才算；
//     · B2 shell 可移植（shell 脚本）：不许用 bash 4+ 独有特性（macOS 自带 bash 3.2），
//          用了 [[ 或数组的脚本 shebang 必须是 bash 而不是 sh；
//     · B3 文件名可移植：无大小写冲突 / Windows 非法字符 / 保留设备名 / 结尾空格或点；
//     · B4 文本卫生：文本无 BOM、无 CRLF。
//     存量豁免只走**账本**（LEDGER：逐条 file + 特征子串 + 理由），且每条必须**仍然命中**（防腐烂）：
//     被豁免的代码被删/被改写 ⇒ 条目过期 ⇒ 判红，逼人回来清账；账本不是"放行名单"。
//   G 分辨力自证：上面每一类各喂一个**合成反例**（字符串/路径）必须报红，对应的干净样本必须**零发现**。
//   M 变异自证：把实现"改回去"必须变红 —— ①删掉 WSL 盘符枚举（改回只探 /mnt/c）⇒ A 段红；
//     ②把临时目录/宿主路径写死（无同行覆盖）⇒ B1 红。两处都在 mkdtemp 夹具里做，真树只读；
//     对照组（未变异的副本、干净样本）在同一套判据下必须仍全绿。`--no-mutations` 跳过本段。
//
// ⚠ 自指陷阱：本文件自己也在 B1 的扫描范围内 ⇒ 会被判据命中的字面量（临时目录前缀、'/root/…'、
//   '/home/<小写用户>/'、Windows 用户目录、以及账本里的特征子串）**全部按片段拼装**；整串写在源码里
//   会让自己成为唯一命中（本仓先例：tools/secret-scan-test.mjs 文件头的同一段告诫）。
//
// ⚠ 诚实边界：WSL 分支只按 `os.release()`（+ /proc/version 兜底）判 —— 本仓开发机不是 WSL，
//   所以"真机 WSL 上 /mnt/d/… 真的存在"这件事**没有**在本机验证过；这里钉住的是**分支与候选清单**，
//   以及"候选只是字符串、是否真有由调用方 existsSync 决定"。
//
// 用法: node tools/cross-platform-test.mjs                  # 人读（含变异自证）
//       node tools/cross-platform-test.mjs --no-mutations   # 只跑 A/B/G（变异子进程用）
//       node tools/cross-platform-test.mjs --list           # 只列账本（含当前 file:line）后退出
// 退出码：0 通过 / 1 有发现（或账本腐烂） / 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const SELF = fileURLToPath(import.meta.url)

const argv = process.argv.slice(2)
const NO_MUT = argv.includes('--no-mutations')
const LIST_ONLY = argv.includes('--list')
for (const a of argv) {
  if (!['--no-mutations', '--list'].includes(a)) {
    console.error(`✗ 未知参数 ${a}\n用法: node tools/cross-platform-test.mjs [--no-mutations] [--list]`)
    process.exit(2)
  }
}

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const firstX = (out) => ((String(out).match(/✗[^\n]*/) || [''])[0] || '').trim().slice(0, 120)

/* ── 会被判据命中的字面量：一律按片段拼装（见文件头"自指陷阱"） ── */
const P = '/'                                              // 路径分隔符
const BS = '\\'
const TMP = P + 'tmp'                                      // 临时目录前缀（不写出连续的 '/tmp'）
const POSIX_HOME = P + 'home/u'                            // 合成 linux/WSL 用例的 home
const TERMUX_HOME = P + 'data' + P + 'data/com.termux/files/home'
const WIN_HOME = 'C:' + BS + 'Users' + BS + 'u'
const norm = (s) => String(s).replace(/\\/g, '/')

/* ═══════════════════════ 判据实现（纯函数：真树扫描与 G 段合成自证共用同一份） ═══════════════════════ */

/* 注释行：本仓注释专门用来记事故/真机读数（史料），不是运行时路径 ⇒ 代码路径判据不参与。
   注意：这是**代码判据**的口径；tools/secret-scan-test.mjs 的凭据判据仍然连注释一起扫。 */
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line)

/* 同行"当场可覆盖"令牌：有它就不算写死（换成别的机器/目录只要设个环境变量或换个 home）。 */
const OVERRIDE_RE = /process\.env|os\.homedir\(\)|os\.tmpdir\(\)/

/* B1 代码路径判据（lib 下的 .js 与 tools 下的 .mjs）。模式全部片段拼装，防自指。 */
const TMP_LITERAL = TMP + P
const HOST_PATH_RULES = [
  { id: 'host-root', re: new RegExp(P + 'root/') },                                        // 本机工作区/宿主家目录根
  { id: 'host-home', re: new RegExp(P + 'home' + '/(?!user/)[a-z0-9_-]+/') },              // 真实用户名的家目录
  { id: 'host-emulated', re: new RegExp(P + 'storage' + P + 'emulated') },                 // 设备共享存储根
  { id: 'host-termux', re: new RegExp(P + 'data' + P + 'data/com\\.termux') },             // Termux 私有目录
  { id: 'host-win-users', re: new RegExp('C:' + BS + BS + '{1,2}Users' + BS + BS + '{1,2}') }, // Windows 用户目录
]
function codeLineFindings(rel, line, lineNo) {
  const out = []
  if (isCommentLine(line)) return out
  const overridable = OVERRIDE_RE.test(line)
  if (line.includes(TMP_LITERAL) && !overridable) out.push({ rule: 'code-tmp-literal', file: rel, line: lineNo, text: line.trim().slice(0, 140) })
  for (const r of HOST_PATH_RULES) {
    if (!r.re.test(line)) continue
    if (overridable) continue
    out.push({ rule: r.id, file: rel, line: lineNo, text: line.trim().slice(0, 140) })
  }
  return out
}

/* B2 shell 可移植判据。macOS 自带 bash 3.2 ⇒ 下面这些 bash 4+ 独有写法在 mac 上直接语法错。 */
const BASH4_RULES = [
  { id: 'shell-bash4-mapfile', re: /\bmapfile\b/ },
  { id: 'shell-bash4-readarray', re: /\breadarray\b/ },
  { id: 'shell-bash4-declare-A', re: /\bdeclare\s+-A\b/ },
  { id: 'shell-bash4-local-n', re: /\blocal\s+-n\b/ },
  { id: 'shell-bash4-upper', re: new RegExp('\\$\\{[A-Za-z_][A-Za-z0-9_]*\\^\\^') },
  { id: 'shell-bash4-lower', re: new RegExp('\\$\\{[A-Za-z_][A-Za-z0-9_]*,,' + '\\}') },
  { id: 'shell-bash4-wait-n', re: /\bwait\s+-n\b/ },
  { id: 'shell-bash4-coproc', re: /\bcoproc\b/ },
  { id: 'shell-bash4-append-redirect', re: /&>>/ },
]
/* `[[` 与数组是 bash 语法（POSIX sh 没有）⇒ 用了就必须 shebang bash，否则在某些 /bin/sh（dash）上必炸。 */
const SHELL_BRACKET_RE = /\[\[/
const SHELL_ARRAY_RE = /(^|\s)(declare\s+-a\s+)?[A-Za-z_][A-Za-z0-9_]*=\(|\$\{[A-Za-z_][A-Za-z0-9_]*\[[@*]\]\}/
function shellFindings(rel, text) {
  const out = []
  const lines = String(text).split('\n')
  lines.forEach((line, i) => {
    for (const r of BASH4_RULES) if (r.re.test(line)) out.push({ rule: r.id, file: rel, line: i + 1, text: line.trim().slice(0, 120) })
  })
  if (SHELL_BRACKET_RE.test(text) || SHELL_ARRAY_RE.test(text)) {
    const shebang = (lines[0] || '').trim()
    if (!/\bbash\b/.test(shebang)) out.push({ rule: 'shell-shebang-must-be-bash', file: rel, line: 1, text: shebang || '(无 shebang)' })
  }
  return out
}

/* B3 文件名可移植判据（tracked 全量；Windows 上这些名字建不出来 / 解不出来）。 */
const WIN_ILLEGAL_RE = /[:*?"<>|]/
const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
function fileNameFindings(rel) {
  const out = []
  for (const seg of String(rel).split('/')) {
    if (WIN_ILLEGAL_RE.test(seg)) out.push({ rule: 'name-illegal-char', file: rel, line: 0, text: seg })
    else if (WIN_RESERVED_RE.test(seg)) out.push({ rule: 'name-reserved-device', file: rel, line: 0, text: seg })
    if (/[ .]$/.test(seg)) out.push({ rule: 'name-trailing-space-dot', file: rel, line: 0, text: JSON.stringify(seg) })
  }
  return out
}
/* 大小写冲突：同一路径只差大小写 ⇒ 在大小写不敏感的文件系统（macOS 默认 / Windows）上互相覆盖。 */
function caseConflictFindings(files) {
  const byLower = new Map()
  for (const f of files) {
    const k = String(f).toLowerCase()
    if (!byLower.has(k)) byLower.set(k, [])
    byLower.get(k).push(f)
  }
  const out = []
  for (const [, group] of byLower) {
    if (group.length < 2) continue
    for (const f of group) out.push({ rule: 'name-case-conflict', file: f, line: 0, text: group.join(' vs ') })
  }
  return out
}

/* B4 文本卫生判据（BOM / CRLF）。UTF-16 的 BOM 也算 —— 那种文件在别人的编辑器里是乱码。 */
const BOMS = [[0xEF, 0xBB, 0xBF], [0xFF, 0xFE], [0xFE, 0xFF]]
function textHygieneFindings(buf) {
  const out = []
  if (BOMS.some((b) => b.every((v, i) => buf[i] === v))) out.push('text-bom')
  if (buf.includes(Buffer.from('\r\n'))) out.push('text-crlf')
  return out
}

const isCodeFile = (rel) => /^lib\/.*\.js$/.test(rel) || /^tools\/.*\.mjs$/.test(rel)
/* shell 判据的范围：本仓的 shell 脚本（tools/*.sh）**加上** .githooks/*（版本化的 git hook 也是 shell，
   同类脚本不该漏；只按扩展名会让它成为盲区）。 */
const isShellFile = (rel) => /^tools\/.*\.sh$/.test(rel) || /^\.githooks\//.test(rel)

/* ═══════════════════════ 账本（存量豁免：逐条 file + 特征子串 + 理由） ═══════════════════════
   规矩（与 tools/secret-scan-test.mjs 同一套）：**逐条**登记、每条能说出"为什么不是写死路径"；
   不许按文件/目录整片豁免。条目必须**仍然命中**（用同一份判据复算）⇒ 过期就判红。 */
const LI = (file, rule, parts, why) => ({ file, rule, match: parts.join(''), why })
const LEDGER = [
  // ── B1 临时目录前缀：存量 18 处，全部是"手工探针的 CLI 默认落点"或"测试夹具/门禁元数据的字符串" ──
  LI('tools/audio-source-hunt-live-probe.mjs', 'code-tmp-literal', ["arg('out', '", TMP, "/np-live')"], '手工真机探针的 CLI 默认落点（--out 可覆盖）：不是运行时/门禁写死的目录'),
  LI('tools/bs-bottom-panel-probe.mjs', 'code-tmp-literal', ["arg('cookie', '", TMP, "/ffprobe/cookie.json')"], '手工真机探针的 CLI 默认落点（--cookie 可覆盖）'),
  LI('tools/bs-compat-probe.mjs', 'code-tmp-literal', ["arg('cookie', '", TMP, "/ffprobe/cookie.json')"], '手工真机探针的 CLI 默认落点（--cookie 可覆盖）'),
  LI('tools/diag-subsystem-test.mjs', 'code-tmp-literal', ["file: '", TMP, "/fake/diag-123.json'"], '被测代码解析的**宿主响应夹具字符串**（假文件名），测试自己不用它落盘'),
  LI('tools/dir-picker-probe.mjs', 'code-tmp-literal', ["const COOKIE = '", TMP, "/ffprobe/cookie.json'"], '手工探针的只读 Cookie 路径常量（与 hdr-probe 系列同一份；进程只读不写）'),
  LI('tools/dir-picker-probe.mjs', 'code-tmp-literal', ["arg('before-client', '", TMP, "/dirpick-before-client.js')"], '手工真机探针的 CLI 默认落点（--before-client 可覆盖）'),
  LI('tools/hdr-probe-mint-cookie.mjs', 'code-tmp-literal', ["arg('out', '", TMP, "/ffprobe/cookie.json')"], '手工真机探针的 CLI 默认落点（--out 可覆盖）'),
  LI('tools/media-session-test.mjs', 'code-tmp-literal', ["'Album X', 'file://", TMP, "/cover.png'"], 'MPRIS **协议夹具**里的 file:// 封面 URI（断言解析结果），不是我们读写的落盘位置'),
  LI('tools/media-session-test.mjs', 'code-tmp-literal', ['"file://', TMP, '/cover.png"'], '同上：另一个子用例里的协议夹具字符串'),
  LI('tools/media-session-test.mjs', 'code-tmp-literal', ["snapB.artUrl === 'file://", TMP, "/cover.png'"], '同上：快照比对用的协议夹具字符串'),
  LI('tools/media-session-test.mjs', 'code-tmp-literal', ["mprisArtKind('file://", TMP, "/a.png')"], '同上：artUrlKind 分类器的输入样本（file 一类的最小例）'),
  LI('tools/np-media-live-probe.mjs', 'code-tmp-literal', ["arg('out', '", TMP, "/np-media')"], '手工真机探针的 CLI 默认落点（--out 可覆盖）'),
  LI('tools/np-pause-persist-live-probe.mjs', 'code-tmp-literal', ["arg('out', '", TMP, "/np-live')"], '手工真机探针的 CLI 默认落点（--out 可覆盖）'),
  LI('tools/np-sidebar-live-probe.mjs', 'code-tmp-literal', ["arg('out', '", TMP, "/np-live')"], '手工真机探针的 CLI 默认落点（--out 可覆盖）'),
  LI('tools/secret-scan-test.mjs', 'code-tmp-literal', ["WL('const COOKIE = ', '', \"'", TMP, "/ffprobe/cookie.json'\")"], '本仓另一条门禁的白名单**特征子串**（自指形态，必须与被豁免那一行逐字一致）'),
  LI('tools/secret-scan-test.mjs', 'code-tmp-literal', ['默认 ', TMP, '/ffprobe/cookie.json）'], '上一条白名单的**理由文本**（描述被豁免的路径），不是运行时代码'),
  LI('tools/settings-persist-live-probe.mjs', 'code-tmp-literal', ["arg('out', '", TMP, "/mpw-settings-persist')"], '手工真机探针的 CLI 默认落点（--out 可覆盖）'),
  LI('tools/wallpaper-lifecycle-live-probe.mjs', 'code-tmp-literal', ["arg('out', '", TMP, "/mpw-lifecycle')"], '手工真机探针的 CLI 默认落点（--out 可覆盖）'),
  // ── B1 宿主绝对路径：存量 7 处（其中 2 处是别的门禁自己的"自指图案"） ──
  LI('tools/dir-picker-probe.mjs', 'host-root', ["'", P, "root/.dsh/profiles/web/node_modules/dsh-mpkg-wallpaper/lib/client.js'"], '手工探针取"本机 DSH profile 里的插件副本"当对照，脚本只在本机手动跑（--before-client 另有一份）'),
  LI('tools/dir-picker-probe.mjs', 'host-root', ["'", P, "root/.dsh/profiles/web/cordis.patch.yml'"], '同一条手工探针要"碰一下"本机 profile 的挂载文件来复现现场（用户手动跑，不进任何门禁）'),
  LI('tools/dir-picker-test.mjs', 'host-home', ["'", P, "home/u/Pictures'"], 'B 组假 DOM 用例的**合成夹具路径**（假用户 u），与断言里的期望值逐字同源'),
  LI('tools/dir-picker-test.mjs', 'host-home', ["'", P, "home/u/Pictures/a'"], '同上：按 Enter 进子目录那条断言的期望值'),
  LI('tools/np-media-live-probe.mjs', 'host-root', ["arg('settings', '", P, "root/.dsh-mpkg-wallpaper/settings.json')"], '手工真机探针读用户真机 settings.json 的默认路径（--settings 可覆盖）'),
  LI('tools/integrity-check.mjs', 'host-root', ["'", P, "root/Desktop/' + 'DSHarea'"], '门禁**自己的自指图案**（按片段拼装，躲开自己）：本条就是"允许宿主根字面量出现"的唯一理由'),
  LI('tools/secret-scan-test.mjs', 'host-root', ["'", P, "root/Desktop/' + 'DSHarea'"], '同上：敏感信息门禁的自指图案（与 integrity-check 互为交叉校验，两处都要留）'),
]

/* ═══════════════════════ 取 tracked 文件（node_modules/.git 天然不在内） ═══════════════════════ */
const MUT_SCAN = process.env.MPW_XPLAT_MUT_SCAN ? path.resolve(process.env.MPW_XPLAT_MUT_SCAN) : ''
const MUT_SCAN_AS = process.env.MPW_XPLAT_MUT_SCAN_AS || 'tools/mut-scan.mjs'   // 变异副本扮演的角色路径（决定它受哪套判据管）
let tracked = [], gitErr = ''
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\0').filter(Boolean)
} catch (e) { gitErr = String((e && e.message) || e) }
if (MUT_SCAN) tracked = [...tracked.filter((f) => f !== MUT_SCAN_AS), MUT_SCAN_AS]
const absOf = (rel) => (MUT_SCAN && rel === MUT_SCAN_AS ? MUT_SCAN : path.join(ROOT, rel))

const lineCache = new Map()
const linesOf = (rel) => {
  if (!lineCache.has(rel)) {
    try { lineCache.set(rel, fs.readFileSync(absOf(rel), 'utf8').split('\n')) } catch { lineCache.set(rel, []) }
  }
  return lineCache.get(rel)
}

/* ── 账本反查（防腐烂）：条目必须仍能在目标文件里找到那一行，且那一行仍被对应判据命中 ── */
const ledgerAudit = LEDGER.map((e, i) => {
  const lines = linesOf(e.file)
  const idx = lines.findIndex((l) => l.includes(e.match))
  if (idx < 0) return { ...e, i, ok: false, line: null, err: '被豁免的那一行不存在了（代码改过 ⇒ 回来清账/删条目）' }
  const hits = codeLineFindings(e.file, lines[idx], idx + 1).map((h) => h.rule)
  if (!hits.includes(e.rule)) return { ...e, i, ok: false, line: idx + 1, err: '该行已不再被 ' + e.rule + ' 命中（已改成可覆盖写法 ⇒ 删掉这条账）' }
  return { ...e, i, ok: true, line: idx + 1, err: '' }
})

if (LIST_ONLY) {
  console.log(`账本 ${LEDGER.length} 条（判定口径：条目必须仍然命中，否则判红）：`)
  for (const a of ledgerAudit) console.log(`  ${a.ok ? '✓' : '✗'} ${a.file}:${a.line === null ? '?' : a.line} [${a.rule}] ${a.match}\n      why: ${a.why}`)
  const stale = ledgerAudit.filter((a) => !a.ok)
  if (stale.length) for (const a of stale) console.error(`  ✗ ${a.file} [${a.rule}] ${a.err}`)
  if (gitErr) console.log('SKIP 账本只做了"逐条反查"（git 不可用 ⇒ 没有 tracked 清单可比对）—— 不假装通过')
  process.exit(stale.length ? 1 : 0)
}

/* ═══════════════════════ A 段：纯函数契约 ═══════════════════════ */
console.log('== A 段：steamProbeDirs(env) 纯函数契约（平台分支可在非 WSL 机器上断言）==')
const PLUGIN_PATH = process.env.MPW_XPLAT_MUT_PLUGIN ? path.resolve(process.env.MPW_XPLAT_MUT_PLUGIN) : path.join(ROOT, 'lib', 'index.js')
let steamProbeDirs = null, importErr = ''
try { const mod = await import(pathToFileURL(PLUGIN_PATH).href); steamProbeDirs = mod.steamProbeDirs } catch (e) { importErr = String((e && e.message) || e) }
const hasFn = typeof steamProbeDirs === 'function'
ok('★ lib/index.js 导出纯函数 steamProbeDirs（入参 platform/release/homedir/exists/procVersion 全可注入）',
  hasFn, hasFn ? '' : (importErr || 'typeof=' + typeof steamProbeDirs))

if (hasFn) {
  /* A1 与"抽函数之前"的历史表达式逐字节相同：WSL 之外**不许**多出/少掉任何候选。 */
  const LEGACY_WIN_DIRS = [
    'C:' + BS + 'Program Files (x86)' + BS + 'Steam', 'C:' + BS + 'Program Files' + BS + 'Steam',
    'D:' + BS + 'Steam', 'D:' + BS + 'SteamLibrary', 'E:' + BS + 'SteamLibrary',
  ]
  const legacyProbeDirs = (platform, homedir) => [
    ...LEGACY_WIN_DIRS,
    ...(platform === 'darwin' ? [path.join(homedir, 'Library', 'Application Support', 'Steam')] : []),
    ...(platform === 'linux' || platform === 'android' ? [path.join(homedir, '.local', 'share', 'Steam')] : []),
    P + 'mnt/c/Program Files (x86)/Steam', P + 'mnt/c/Program Files/Steam',
  ]
  const eqCases = [['win32', WIN_HOME], ['darwin', '/Users/u'], ['linux', POSIX_HOME], ['android', TERMUX_HOME]]
  const diffs = []
  for (const [platform, homedir] of eqCases) {
    const now = steamProbeDirs({ platform, homedir, release: '6.1.0-generic', procVersion: '' })
    const before = legacyProbeDirs(platform, homedir)
    if (JSON.stringify(now) !== JSON.stringify(before)) diffs.push(platform + ': now=' + JSON.stringify(now) + ' / before=' + JSON.stringify(before))
  }
  ok('★ win32/darwin/linux/android 候选集合与抽函数前的历史表达式逐字节相同（重构不是重设计）', diffs.length === 0, diffs.slice(0, 2).join(' | '))

  /* A2 WSL 分支：判据必须能在这台**非 WSL** 机器上成立（入参全注入，不读本机 /proc/version）。 */
  const WSL_ARGS = { platform: 'linux', release: '5.15.90.1-microsoft-standard-WSL2', homedir: POSIX_HOME, exists: () => true }
  const wsl = steamProbeDirs(WSL_ARGS)
  const RELS = ['Program Files (x86)/Steam', 'Program Files/Steam', 'SteamLibrary', 'Steam']
  const allDrives = [...'defghijklmnopqrstuvwxyz'].every((d) => RELS.every((r) => wsl.includes(P + 'mnt/' + d + P + r)))
  ok('★ WSL（release 含 microsoft）⇒ 枚举 /mnt/d…/mnt/z × 四相对路径（92 条候选）',
    allDrives && wsl.includes(P + 'mnt/d/SteamLibrary'), 'WSL 候选 ' + wsl.length + ' 条；含 /mnt/d/SteamLibrary=' + wsl.includes(P + 'mnt/d/SteamLibrary'))
  ok('★ WSL ⇒ 仍含 /mnt/c 两条与 Linux 本家 ~/.local/share/Steam',
    wsl.includes(P + 'mnt/c/Program Files (x86)/Steam') && wsl.includes(P + 'mnt/c/Program Files/Steam') && wsl.some((s) => norm(s).endsWith('/.local/share/Steam')))
  const plain = steamProbeDirs({ platform: 'linux', release: '6.1.0-generic', homedir: POSIX_HOME, procVersion: '' })
  ok('★ 普通 linux（非 WSL）⇒ 一条 /mnt/d…/mnt/z 都没有（证明是那条分支产生的，不是到处乱探）',
    !plain.some((s) => /^\/mnt\/[d-z]\//.test(s)), '普通 linux 候选 ' + plain.length + ' 条')
  const viaProc = steamProbeDirs({ platform: 'linux', release: '6.1.0-generic', homedir: POSIX_HOME, procVersion: 'Linux version 5.15.90.1-microsoft-standard-WSL2 (gcc ...)' })
  const viaProcFn = steamProbeDirs({ platform: 'linux', release: '6.1.0-generic', homedir: POSIX_HOME, procVersion: () => 'x-microsoft-y' })
  ok('★ /proc/version 兜底：release 不含 microsoft 时也走 WSL 分支（注入字符串/函数两种都算）',
    viaProc.includes(P + 'mnt/d/SteamLibrary') && viaProcFn.includes(P + 'mnt/z/Steam'))

  /* A3 三平台各自成根：macOS 根不出现在 linux 入参里，反之亦然。 */
  const win = steamProbeDirs({ platform: 'win32', release: '10.0.22631', homedir: WIN_HOME })
  const mac = steamProbeDirs({ platform: 'darwin', release: '23.5.0', homedir: '/Users/u' })
  const android = steamProbeDirs({ platform: 'android', release: '5.10.0', homedir: TERMUX_HOME })
  const isMacRoot = (s) => norm(s).includes('Library/Application Support/Steam')
  const isLinuxRoot = (s) => norm(s).includes('/.local/share/Steam')
  ok('★ win32：命中 Windows 安装根（STEAM_PROBE_DIRS 原样保留），且不含 macOS/Linux 根',
    win.includes(LEGACY_WIN_DIRS[0]) && win.includes(LEGACY_WIN_DIRS[2]) && !win.some(isMacRoot) && !win.some(isLinuxRoot))
  ok('★ darwin：命中 ~/Library/Application Support/Steam，且不含 Linux 根',
    mac.some(isMacRoot) && !mac.some(isLinuxRoot))
  ok('★ linux：命中 ~/.local/share/Steam，且不含 macOS 根',
    plain.some(isLinuxRoot) && !plain.some(isMacRoot))
  ok('★ android：同 Linux 分支（~/.local/share/Steam）', android.some(isLinuxRoot))

  /* A4 纯函数纪律：顺序稳定 / 无重复 / 全是字符串 / 退化入参不抛。 */
  const wsl2 = steamProbeDirs({ platform: 'linux', release: '5.15.90.1-microsoft-standard-WSL2', homedir: POSIX_HOME, exists: () => true })
  ok('★ 纯函数纪律：同一入参两次调用逐项相同（顺序稳定）', JSON.stringify(wsl) === JSON.stringify(wsl2))
  ok('★ 纯函数纪律：无重复项 + 元素全是字符串',
    new Set(wsl).size === wsl.length && wsl.every((s) => typeof s === 'string') && new Set(plain).size === plain.length)
  const degenerate = []
  const tryCall = (label, arg) => {
    try {
      const r = arg === undefined ? steamProbeDirs() : steamProbeDirs(arg)
      if (!Array.isArray(r) || !r.every((s) => typeof s === 'string')) degenerate.push(label + '（返回的不是字符串数组）')
    } catch (e) { degenerate.push(label + '：' + String((e && e.message) || e)) }
  }
  const throwing = () => { throw new Error('boom') }
  tryCall('空入参', undefined)
  tryCall('会抛的 exists', { platform: 'linux', release: '6.1.0-generic', homedir: POSIX_HOME, exists: throwing })
  tryCall('会抛的 procVersion', { platform: 'linux', release: '6.1.0-generic', homedir: POSIX_HOME, procVersion: throwing })
  tryCall('全 null 入参', { platform: null, release: null, homedir: null, exists: null, procVersion: null })
  tryCall('全空串入参', { platform: '', release: '', homedir: '', exists: '', procVersion: '' })
  ok('★ 纯函数纪律：退化入参一律不抛（含会抛的 exists / procVersion、null 与空串）', degenerate.length === 0, degenerate.join(' | '))

  /* A5 接线：纯函数不能是"没人用的漂亮函数"。 */
  const src = fs.readFileSync(PLUGIN_PATH, 'utf8')
  ok('★ 接线：locateWallpaperEngine() 用 probes.push(...steamProbeDirs())', /probes\.push\(\.\.\.steamProbeDirs\(\)\)/.test(src))
  ok('★ 接线：旧常量 STEAM_PROBE_DIRS_NONWIN 已消失（平台分支只有一处实现）', !src.includes('STEAM_PROBE_DIRS_NONWIN'))
  ok('★ 接线：注册表那条路没动（steamPathFromRegistry() 仍排在候选最前）',
    /const reg = steamPathFromRegistry\(\);[\s\S]{0,80}if \(reg\) probes\.push\(reg\);/.test(src))
}

/* ═══════════════════════ B 段：tracked 静态扫描 ═══════════════════════ */
console.log('\n== B 段：tracked 文件静态扫描（文件名 / 文本 / 代码路径 / shell）==')
let codeF = [], shellF = [], nameF = [], textF = []
let textScanned = 0, skippedBinary = 0, skippedBig = 0, codeFiles = 0, shellFiles = 0
if (gitErr) {
  console.log('SKIP 跨平台静态扫描：取不到 tracked 文件清单（git 不可用或不是 git 工作树）—— 不假装通过')
  console.log('     原因：' + gitErr.slice(0, 140))
} else {
  for (const rel of tracked) {
    nameF.push(...fileNameFindings(rel))
    if (isCodeFile(rel)) codeFiles++
    if (isShellFile(rel)) shellFiles++
    let buf = null
    try {
      const st = fs.statSync(absOf(rel))
      if (st.size > 4 * 1048576) { skippedBig++; continue }
      buf = fs.readFileSync(absOf(rel))
    } catch { continue }
    if (buf.subarray(0, 8192).includes(0)) { skippedBinary++; continue }
    textScanned++
    textF.push(...textHygieneFindings(buf).map((rule) => ({ rule, file: rel, line: 0, text: '' })))
    if (isCodeFile(rel)) {
      buf.toString('utf8').split('\n').forEach((line, i) => codeF.push(...codeLineFindings(rel, line, i + 1)))
    }
    if (isShellFile(rel)) shellF.push(...shellFindings(rel, buf.toString('utf8')))
  }
  nameF.push(...caseConflictFindings(tracked))

  /* 账本豁免：只放行"条目仍命中"的那一行（file+rule+line 三元组）。 */
  const exempt = new Set(ledgerAudit.filter((a) => a.ok).map((a) => a.file + '|' + a.rule + '|' + a.line))
  const keep = (f) => !exempt.has(f.file + '|' + f.rule + '|' + f.line)
  const raw = { code: codeF, shell: shellF, name: nameF, text: textF }
  codeF = codeF.filter(keep); shellF = shellF.filter(keep); nameF = nameF.filter(keep); textF = textF.filter(keep)

  const report = (arr) => {
    for (const f of arr.slice(0, 15)) console.error(`  ✗ [${f.rule}] ${f.file}${f.line ? ':' + f.line : ''}  ${f.text || ''}`)
    if (arr.length > 15) console.error(`  … 还有 ${arr.length - 15} 处`)
  }
  console.log(`扫描 ${tracked.length} 个 tracked 文件（代码 ${codeFiles} 个走 B1 / shell ${shellFiles} 个走 B2 / 文本 ${textScanned} 个走 B4；跳过二进制 ${skippedBinary}、>4MB ${skippedBig}）`)
  console.log(`账本 ${LEDGER.length} 条（当前 ${ledgerAudit.filter((a) => a.ok).length} 条反查命中；豁免 ${Object.values(raw).reduce((s, a) => s + a.length, 0) - (codeF.length + shellF.length + nameF.length + textF.length)} 处发现）`)
  if (codeF.length) report(codeF)
  if (shellF.length) report(shellF)
  if (nameF.length) report(nameF)
  if (textF.length) report(textF)
  ok('★ B1 代码路径：lib/**/*.js、tools/**/*.mjs 无写死的临时目录，五类宿主绝对路径都当场可覆盖',
    codeF.length === 0, codeF.length ? codeF.length + ' 处（见上）' : `代码文件 ${codeFiles} 个`)
  ok('★ B2 shell 可移植：无 bash 4+ 独有特性（macOS 自带 bash 3.2），用 [[/数组的 shebang 是 bash',
    shellF.length === 0, shellF.length ? shellF.length + ' 处（见上）' : `shell 脚本 ${shellFiles} 个`)
  ok('★ B3 文件名可移植：无大小写冲突 / Windows 非法字符 / 保留设备名 / 结尾空格或点',
    nameF.length === 0, nameF.length ? nameF.length + ' 处（见上）' : `${tracked.length} 个文件`)
  ok('★ B4 文本卫生：tracked 文本无 BOM、无 CRLF',
    textF.length === 0, textF.length ? textF.length + ' 处（见上）' : `文本 ${textScanned} 个`)
  ok(`★ 账本 ${LEDGER.length} 条全部仍然命中（防腐烂：被豁免的代码改了就得回来清账）`,
    ledgerAudit.every((a) => a.ok),
    ledgerAudit.filter((a) => !a.ok).map((a) => a.file + '(' + a.rule + '):' + a.err).slice(0, 3).join(' | '))
}

/* ═══════════════════════ G 段：分辨力自证（合成反例必红 / 干净样本零发现） ═══════════════════════ */
console.log('\n== G 段：分辨力自证（每类一个合成反例 + 对应干净样本）==')
const SAMPLE_FILE = 'tools/sample.mjs'
const SAMPLE_SH = 'tools/sample.sh'
const SAMPLE_BYTES = (...bytes) => Buffer.from(bytes)
const SYNTHETIC = [
  // B1 代码路径：临时目录
  { kind: 'code', rule: 'code-tmp-literal', text: "const out = '" + TMP + "/mpw-xplat'", expect: 'hit', note: '写死临时目录' },
  { kind: 'code', rule: '', text: "const out = path.join(os.tmpdir(), 'mpw-xplat')", expect: 'clean', note: 'os.tmpdir() 推导' },
  { kind: 'code', rule: '', text: "const out = process.env.MPW_OUT || '" + TMP + "/mpw-xplat'", expect: 'clean', note: '同行可覆盖' },
  { kind: 'code', rule: '', text: '// 历史事故：' + "'" + TMP + "/mpw-exp/lines.png' 那个目录被磁盘清理过", expect: 'clean', note: '注释行（史料）不参与' },
  // B1 代码路径：五类宿主绝对路径
  { kind: 'code', rule: 'host-root', text: "const s = '" + P + "root/.dsh/settings.json'", expect: 'hit', note: '本机工作区/宿主根' },
  { kind: 'code', rule: 'host-home', text: "const s = '" + P + "home/alice/wp'", expect: 'hit', note: '真实用户名家目录' },
  { kind: 'code', rule: 'host-emulated', text: "const s = '" + P + 'storage' + P + "emulated/0/wp'", expect: 'hit', note: '设备共享存储根' },
  { kind: 'code', rule: 'host-termux', text: "const s = '" + P + 'data' + P + "data/com.termux/files/wp'", expect: 'hit', note: 'Termux 私有目录' },
  { kind: 'code', rule: 'host-win-users', text: "const s = 'C:" + BS + 'Users' + BS + "name/wp'", expect: 'hit', note: 'Windows 用户目录' },
  { kind: 'code', rule: '', text: "const s = process.env.DSH_HOME || '" + P + "root/.dsh'", expect: 'clean', note: '同行可覆盖' },
  // B2 shell
  { kind: 'shell', rule: 'shell-bash4-mapfile', text: '#!/usr/bin/env bash\nmapfile -t a < f\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-readarray', text: '#!/usr/bin/env bash\nreadarray -t a < f\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-declare-A', text: '#!/usr/bin/env bash\ndeclare -A m=()\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-local-n', text: '#!/usr/bin/env bash\nf() { local -n r=$1; }\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-upper', text: '#!/usr/bin/env bash\necho "${v^^}"\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-lower', text: '#!/usr/bin/env bash\necho "${v,,}"\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-wait-n', text: '#!/usr/bin/env bash\nwait -n\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-coproc', text: '#!/usr/bin/env bash\ncoproc myjob { echo hi; }\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-bash4-append-redirect', text: '#!/usr/bin/env bash\necho hi &>> log\n', expect: 'hit' },
  { kind: 'shell', rule: 'shell-shebang-must-be-bash', text: '#!/bin/sh\ndeclare -a A=()\n', expect: 'hit', note: 'sh + 数组' },
  { kind: 'shell', rule: 'shell-shebang-must-be-bash', text: '#!/bin/sh\n[[ -n "$1" ]] && echo x\n', expect: 'hit', note: 'sh + [[' },
  { kind: 'shell', rule: '', text: '#!/usr/bin/env bash\ndeclare -a A=()\n[[ -n "$1" ]] && echo "${A[@]}"\n', expect: 'clean' },
  { kind: 'shell', rule: '', text: '#!/bin/sh\n[ -n "$1" ] && exit 0\necho "${v}"\n', expect: 'clean' },
  // B3 文件名
  { kind: 'name', rule: '', text: 'docs/notes.md', expect: 'clean' },
  { kind: 'name', rule: 'name-illegal-char', text: 'tools/a:b.mjs', expect: 'hit' },
  { kind: 'name', rule: 'name-illegal-char', text: 'tools/what?.mjs', expect: 'hit' },
  { kind: 'name', rule: 'name-reserved-device', text: 'tools/CON.md', expect: 'hit' },
  { kind: 'name', rule: 'name-reserved-device', text: 'tools/lpt1.log', expect: 'hit' },
  { kind: 'name', rule: 'name-trailing-space-dot', text: 'tools/report.', expect: 'hit' },
  { kind: 'name', rule: 'name-trailing-space-dot', text: 'tools/name /x.md', expect: 'hit' },
  { kind: 'name', rule: '', text: 'tools/my file.mjs', expect: 'clean' },
  { kind: 'case', rule: 'name-case-conflict', files: ['docs/Notes.md', 'docs/notes.md'], expect: 'hit' },
  { kind: 'case', rule: '', files: ['docs/Notes.md', 'docs/other.md'], expect: 'clean' },
  // B4 文本卫生
  { kind: 'text', rule: 'text-bom', bytes: SAMPLE_BYTES(0xEF, 0xBB, 0xBF, 0x61, 0x0A), expect: 'hit', note: 'UTF-8 BOM' },
  { kind: 'text', rule: 'text-bom', bytes: SAMPLE_BYTES(0xFF, 0xFE, 0x61, 0x00), expect: 'hit', note: 'UTF-16 BOM' },
  { kind: 'text', rule: 'text-crlf', bytes: SAMPLE_BYTES(0x61, 0x0D, 0x0A, 0x62), expect: 'hit', note: 'CRLF' },
  { kind: 'text', rule: '', bytes: SAMPLE_BYTES(0x61, 0x0A, 0x62), expect: 'clean' },
]
function sampleFindings(c) {
  if (c.kind === 'code') return codeLineFindings(SAMPLE_FILE, c.text, 1)
  if (c.kind === 'shell') return shellFindings(SAMPLE_SH, c.text)
  if (c.kind === 'name') return fileNameFindings(c.text)
  if (c.kind === 'case') return caseConflictFindings(c.files)
  if (c.kind === 'text') return textHygieneFindings(c.bytes).map((rule) => ({ rule, file: 'x', line: 0, text: '' }))
  return []
}
let gBad = 0
for (const c of SYNTHETIC) {
  const got = sampleFindings(c)
  const rules = got.map((f) => f.rule)
  const label = c.kind + ':' + (c.rule || '(干净样本)') + (c.note ? '（' + c.note + '）' : '')
  if (c.expect === 'hit') {
    const good = rules.includes(c.rule)
    if (!good) gBad++
    ok('G 反例必红 · ' + label, good, good ? '命中 ' + c.rule : '实际命中：' + (rules.join(',') || '(无)') + ' · 样本：' + c.text.slice(0, 60))
  } else {
    const good = got.length === 0
    if (!good) gBad++
    ok('G 干净样本零发现 · ' + label, good, good ? '' : '误报：' + rules.join(',') + ' · 样本：' + JSON.stringify(c.text).slice(0, 60))
  }
}

/* ═══════════════════════ M 段：变异自证（把实现改回去必须变红） ═══════════════════════ */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-xplat-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

function runSelf(args, env) {
  const r = spawnSync(process.execPath, [SELF, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 26, cwd: ROOT })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
/* 把 lib/index.js 连同它的**相对 import 依赖图**复制进夹具目录（真树只读）。
   夹具 = 入口的完整依赖闭包，所以变异副本能像真树一样被 import；总量 < 1MB（本仓夹具纪律）。 */
function stagePluginFixture(mutate) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'plugin-'))
  const seen = new Set(), texts = new Map()
  const queue = [['index.js', path.join(ROOT, 'lib', 'index.js')]]
  while (queue.length) {
    const [name, abs] = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const raw = fs.readFileSync(abs, 'utf8')
    texts.set(name, name === 'index.js' ? mutate(raw) : raw)
    for (const m of raw.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([\w.-]+)['"]/g)) {
      if (!seen.has(m[1])) queue.push([m[1], path.join(path.dirname(abs), m[1])])
    }
  }
  let bytes = 0
  for (const [name, text] of texts) { fs.writeFileSync(path.join(dir, name), text); bytes += Buffer.byteLength(text) }
  return { dir, entry: path.join(dir, 'index.js'), bytes, files: [...texts.keys()] }
}

if (!NO_MUT && !gitErr) {
  console.log('\n== M 段：变异自证（把实现"改回去"必须变红；真树只读，夹具走 mkdtemp）==')
  const WSL_LOOP = "for (const letter of WSL_DRIVE_LETTERS) for (const rel of WSL_STEAM_RELS) dirs.push('/mnt/' + letter + '/' + rel);"
  let staged = null, mutatedPl = null, mutErr = ''
  try {
    staged = stagePluginFixture((s) => s)
    mutatedPl = stagePluginFixture((s) => {
      const out = s.replace(WSL_LOOP, '/* 变异：删掉盘符枚举（= 改回只探 /mnt/c 的旧实现） */')
      if (out === s) throw new Error('注入点没匹配上（lib/index.js 的 WSL 循环改了？）')
      return out
    })
  } catch (e) { mutErr = String((e && e.message) || e) }
  ok('M 夹具：插件依赖闭包复制进 ' + (staged ? staged.files.length + ' 个文件 / ' + (staged.bytes / 1024).toFixed(1) + 'KB' : '（失败）') + '（<1MB）',
    !!staged && staged.bytes < 1048576 && !mutErr, mutErr)

  /* 对照组：不改任何东西的副本在同一套判据下必须仍全绿（否则变异红了也说明不了问题）。 */
  const r0 = staged ? runSelf(['--no-mutations'], { MPW_XPLAT_MUT_PLUGIN: staged.entry }) : { status: -1, out: mutErr }
  ok('M 对照组：未变异的插件副本仍全绿', r0.status === 0, 'exit=' + r0.status + ' ' + firstX(r0.out))

  const r1 = mutatedPl ? runSelf(['--no-mutations'], { MPW_XPLAT_MUT_PLUGIN: mutatedPl.entry }) : { status: -1, out: mutErr }
  ok('M 变异①（第 1 条）：删掉 WSL 盘符枚举 ⇒ A 段「WSL ⇒ 枚举 /mnt/d…」必红',
    r1.status !== 0 && /✗ ★ WSL（release 含 microsoft）/.test(r1.out), 'exit=' + r1.status + ' ' + firstX(r1.out))

  /* 第 4 条的变异：拿一份干净合成样本当对照，再把它改成"写死路径"（真树里没有人这么写）。 */
  const CLEAN_FIXTURE = [
    '// 合成夹具：干净样本（B1 判据下应零发现）',
    "import os from 'node:os'",
    "import path from 'node:path'",
    "export const OUT = path.join(os.tmpdir(), 'mpw-xplat-fixture')",
    '',
  ].join('\n')
  const DIRTY_LINES = [
    "const cache = '" + TMP + "/mpw-xplat-fixture'      // 写死临时目录（无同行覆盖 ⇒ 必红）",
    "const settings = '" + P + "root/.dsh-mpkg-wallpaper/settings.json'   // 写死宿主绝对路径（无同行覆盖 ⇒ 必红）",
    '',
  ].join('\n')
  const cleanScan = path.join(tmpRoot, 'clean-scan.mjs'), dirtyScan = path.join(tmpRoot, 'dirty-scan.mjs')
  fs.writeFileSync(cleanScan, CLEAN_FIXTURE)
  fs.writeFileSync(dirtyScan, CLEAN_FIXTURE + DIRTY_LINES)
  const scanEnv = (p) => ({ MPW_XPLAT_MUT_SCAN: p, MPW_XPLAT_MUT_SCAN_AS: 'tools/mut-scan.mjs' })
  const r2 = runSelf(['--no-mutations'], scanEnv(cleanScan))
  ok('M 对照组：干净合成样本注入扫描集合后仍零发现', r2.status === 0, 'exit=' + r2.status + ' ' + firstX(r2.out))
  const r3 = runSelf(['--no-mutations'], scanEnv(dirtyScan))
  ok('M 变异②（第 4 条）：把临时目录/宿主路径写死 ⇒ B1 两类判据都必红',
    r3.status !== 0 && /\[code-tmp-literal\] tools\/mut-scan\.mjs/.test(r3.out) && /\[host-root\] tools\/mut-scan\.mjs/.test(r3.out),
    'exit=' + r3.status + ' ' + firstX(r3.out))
  console.log(`  变异退出码：①WSL 盘符枚举删掉 = ${r1.status} · ②写死临时目录/宿主路径 = ${r3.status}（两条对照组 = ${r0.status} / ${r2.status}）`)
  console.log(`  变异夹具：${path.relative(ROOT, tmpRoot) === '' ? tmpRoot : tmpRoot.replace(os.homedir(), '~')}（exit 时兜底删除）`)
}

cleanup()
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 跨平台静态门禁未通过'); process.exit(1) }
console.log('✓ 跨平台静态门禁通过：WSL 分支可判 + 三平台各有自己的根 + 纯函数纪律 + tracked 静态卫生（账本反查无腐烂）')

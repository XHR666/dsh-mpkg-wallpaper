// cross-platform-gate-test.mjs —— 跨平台静态门禁（2026-09-20 第 1 条：**不要面向结果编程**，要真的适配 mac / Windows / WSL）
//
// 为什么需要它：本仓大量脚本/服务是在 Termux(Linux) 上写出来的，"在我机器上能跑"很容易被写成
//   **事实上的 Linux 独占**（写死 `/root/...`、`/tmp/...`、只有 `termux-open`/`xdg-open` 的打开器、
//   bash 4 语法）。这类问题在作者机上**永远不报错**，只有换平台才炸 ⇒ 必须由静态判据兜住，
//   而不是等用户在 mac/Windows 上踩一遍。
//
// 判据（A–F 逐类；任一不满足 ⇒ 退出码 1）：
//   A 不可覆盖的本机绝对路径：代码里的 `/root/…`、`/home/<user>/…`、`/storage/` + `emulated`、
//     Termux 私有目录、`C:\Users\…` 必须**当场给出覆盖口**（同行有 `process.env` / `os.homedir()`
//     / `os.tmpdir()`），否则判红。白名单逐条写理由，且**每条都必须仍然命中**（防腐烂）。
//   B 临时目录：代码里不许写死 `/tmp/…`（Windows 没有 `/tmp`；macOS 的 `/tmp` 是 `/private/tmp`
//     的软链）⇒ 走 `os.tmpdir()`。判据 = **裸 `/tmp/` 片段**（不再要求紧贴引号 —— 2026-09-24
//     可移植性审计 PA-09：旧判据只认 `'/tmp/`、`"/tmp/`，实测渲染器 shell 脚本里**代码行**含
//     `/tmp/` 的 8 处全漏；「规则没写全」比「没规则」更危险）。注释（行首 / 行尾 / 块注释）不执行
//     ⇒ 不参与判据（文档里的举例照旧允许）；同行给出覆盖口（process.env / os.tmpdir() / …）也放行。
//     扫描器自己的"宿主路径前缀表"与**存量站点**走白名单：每条必写理由、且必须仍然命中（防腐烂）。
//   C 打开器候选链：同一文件里必须同时有 Linux(`xdg-open`) / macOS(`open`) / Windows(`explorer`
//     或 `cmd … start`) 三条分支**加**环境覆盖口 —— 只写 Termux/Linux 的打开器 = 另外两个平台
//     点"打开文件夹"直接 501。
//   D bash 版本：`.sh` 不许用 bash 4+ 独有特性（macOS 自带 bash 3.2）；用了 `[[`/数组的脚本
//     shebang 必须是 bash（`#!/bin/bash` 或 `#!/usr/bin/env bash`），不能是 `#!/bin/sh`。
//   E 文件名可移植性：无大小写冲突（macOS/Windows 大小写不敏感）、无 Windows 非法字符
//     `: * ? " < > |`、无保留设备名、无结尾空格/点、单段 ≤255 字节、整条 ≤200 字符。
//   F 文本卫生：tracked 文本文件无 BOM、无 CRLF（CRLF 的 `.sh` 在 Linux/WSL 上是
//     `bad interpreter: /bin/bash^M`）。第三方素材（`assets/fonts/**`）与二进制跳过并计数。
//
// 自证（G 段）：把每类违规的**合成样本**喂给同一批纯扫描器 ⇒ 必须逐类报红；干净样本 ⇒ 零发现。
//   没有这一段，门禁"永远绿"与"真的在查"无法区分。
//
// 口径：只扫 `git ls-files`（= tracked）。没有 git ⇒ 打印 SKIP 并以 0 退出（不假装通过）。
// 用法: node tests/cross-platform-gate-test.mjs [--json]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from './_root.mjs'

const JSON_OUT = process.argv.includes('--json')
let pass = 0, fail = 0
const out = []
const say = (s) => { out.push(s); if (!JSON_OUT) console.log(s) }
const check = (name, ok, detail = '') => {
  if (ok) { pass++; say('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; say('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ── 路径/字面量按片段拼（本文件也是 tracked、也会被自己扫 —— 整串写出来会自指命中） ── */
const SL = '/'
const QUOTES = "['\"]"
const CODE_DIRS = ['server/', 'tools/', 'core/', 'elysia/', 'web/', 'demo/', 'tests/', 'scripts/']
const TEXT_SKIP = [/^assets\/fonts\//, /^demo\/assets\//, /^references\//, /^reports\//]
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|ttf|otf|woff2?|mp[34]|webm|pkg|zip|gz|bin|wasm|pdf|so|node)$/i

const HOST_PATH_RES = [
  { name: 'workspace-abs', re: new RegExp(SL + 'root' + SL) },
  /* `/home/USER/…` 是本仓**占位符约定**（全大写段），真机路径一定含小写用户名 ⇒ 只对小写段报红 */
  { name: 'home-abs', re: new RegExp(SL + 'home' + SL + '[A-Za-z0-9._-]*[a-z][A-Za-z0-9._-]*' + SL) },
  { name: 'device-shared-storage', re: new RegExp(SL + 'storage' + SL + 'emulated') },
  { name: 'termux-private', re: new RegExp(SL + 'data' + SL + 'data' + SL + 'com' + '\\.' + 'termux') },
  { name: 'windows-user-profile', re: new RegExp('[A-Za-z]:\\\\\\\\?' + 'Users' + '\\\\\\\\') },
]
const OVERRIDE_HINT = /process\.env|os\.homedir|os\.tmpdir|homedir\(\)|tmpdir\(\)/
/* ①(PA-09 2026-09-24) **裸 `/tmp/`**（去掉 QUOTES 前缀）：`cp x /tmp/y`、`> /tmp/z`、`X=/tmp/…`
   这类**代码行**里的写法也必须抓到。旧判据 `QUOTES + /tmp/` 只认紧贴引号的形态 ⇒ 实测 8/8 漏检。
   片段仍按 `SL + 'tmp' + SL` 拼装：整串写出来会被这条判据自指命中。 */
const TMP_LITERAL_RE = new RegExp(SL + 'tmp' + SL)
/* 白名单：key = `相对路径::特征串`；reason 必填（空理由 = 静默放宽，判红）；每条都会被反查"是否仍然命中"
   （不命中 = 腐烂 = 红）。
   ①(PA-09 2026-09-24) 判据放宽后新暴露的存量站点**逐条**登记在这里（改前它们 8/8 漏检，所以从没被看见）：
   特征串取**该站点自己的路径片段**（不是整个文件的 `/tmp/` 通配）⇒ 谁把那行修好了，条目立刻失效并判红，
   逼人回来删条目（这就是"白名单不许腐烂"）。理由里同时写明**正确修法**，便于别的工作线接手。 */
const TMPDIR_FIX = '修法：TMPDIR="${TMPDIR:-$(node -e \'process.stdout.write(require("os").tmpdir())\')}" 或整体落 $(mktemp -d)'
const ALLOW = [
  { key: 'tests/docs-check.mjs::' + SL + 'root' + SL, reason: '文档检查器要**认出**本机路径形态（扫描器词汇，不是运行时依赖）' },
  { key: 'tests/pack-closure-test.mjs::' + SL + 'tmp' + SL, reason: '打包扫描器的"宿主路径前缀表"：它正是用来判定产物里**不许**出现这些前缀（词汇表）' },
  { key: 'tests/secret-scan-test.mjs::' + SL + 'root' + SL, reason: '敏感信息扫描器的"本机工作区绝对路径"图案（词汇表）' },
  { key: 'tests/publish-check.mjs::' + SL + 'root' + SL, reason: '发布面隐私扫描器的"作者工作区前缀"图案 + 它的注释（词汇表）' },
  { key: 'tests/secret-scan-test.mjs::' + SL + 'data' + SL, reason: '敏感信息扫描器的 Termux 私有目录图案（词汇表）' },
  { key: 'tests/cross-platform-gate-test.mjs::' + SL + 'root' + SL, reason: '本门禁自己的图案片段（自指豁免；片段已拆开写，命中即说明有人把它们拼回整串）' },
  /* —— B 段放宽后暴露的存量 `/tmp` 站点（PA-11，class B；逐条登记 + 理由 + 修法）—— */
  { key: 'tests/keep-servers.sh::' + SL + 'tmp' + SL + 'keep-servers.log', reason: '存量：keep-servers.sh 日志写死 /tmp（PA-11）。' + TMPDIR_FIX + '；写权不在本次可移植性修复线（只放宽判据，不动该脚本）' },
  { key: 'tests/keep-servers.sh::' + SL + 'tmp' + SL + 'we-scene-8899.log', reason: '存量：start_8899 重定向写死 /tmp（PA-11）。' + TMPDIR_FIX },
  { key: 'tests/keep-servers.sh::' + SL + 'tmp' + SL + '8901.log', reason: '存量：start_8901 重定向写死 /tmp（PA-11）。' + TMPDIR_FIX },
  { key: 'tests/keep-servers.sh::' + SL + 'tmp' + SL + '8902.log', reason: '存量：start_8902 重定向写死 /tmp（PA-11）。' + TMPDIR_FIX },
  { key: 'tests/keep-servers.sh::' + SL + 'tmp' + SL + 'keep-servers-openviking.log', reason: '存量：openviking 重定向写死 /tmp（PA-11）。' + TMPDIR_FIX },
  { key: 'tests/keep-demo-server.sh::' + SL + 'tmp' + SL + 'demo-server.log', reason: '存量：demo server 日志写死 /tmp（PA-11）。' + TMPDIR_FIX },
  { key: 'tests/run-all-tests.sh::LOCKFILE=' + SL + 'tmp' + SL + '.mpw-gate.lock', reason: '存量：门禁**锁文件**写死 /tmp（PA-11；多用户机器上 /tmp 还是可被抢占的路径，比日志更要紧）。' + TMPDIR_FIX },
  { key: 'tests/run-all-tests.sh::LASTLOG=' + SL + 'tmp' + SL + 'run-all-tests-last.log', reason: '存量：门禁日志写死 /tmp（PA-11）。' + TMPDIR_FIX },
  { key: 'tests/shot-to-png.mjs::' + SL + 'tmp' + SL + 'auto-', reason: '存量：默认输出路径写死 /tmp（PA-11 同族）。修法：`process.argv[3] || path.join(os.tmpdir(), ...)`（同文件 :24/:29 已有 require(\'node:os\') 可用）' },
  { key: 'tests/shot-to-png.mjs::' + SL + 'tmp' + SL + '_shot-', reason: '存量：抽帧中间文件写死 /tmp（PA-11 同族）。修法同上（os.tmpdir()）' },
  { key: 'tests/report-latest.mjs::' + SL + 'tmp' + SL + 'mpw-shot-', reason: '存量：截图落地路径写死 /tmp（PA-11 同族）。修法：`path.join(os.tmpdir(), ...)`' },
  { key: 'tests/headless-shot.mjs::' + SL + 'tmp' + SL + 'headless-evidence.json', reason: '存量：**帮助文本**里的证据路径示例（打印给人看，不执行）。⚠ 顺带发现实现与文案不一致：实际写 `path.join(os.tmpdir(), …)`（:136）而文案说 /tmp ⇒ 该行文案应改成 os.tmpdir() 的动态值（属该线写权）' },
  { key: 'tests/video-downscale-flicker-probe.mjs::' + SL + 'tmp' + SL + 'vid19', reason: '存量：**帮助文本**里的抽帧示例（两行 console.log 打印给用户的用法示例，不执行）——「文档里的举例」口径，判据不据此报红，但仍按"逐条登记"纪律列在这里' },
]
const BASH4_RES = [
  { name: 'mapfile', re: /\bmapfile\b/ },
  { name: 'readarray', re: /\breadarray\b/ },
  { name: 'declare-A', re: /\bdeclare\s+-A\b/ },
  { name: 'local-n', re: /\blocal\s+-n\b/ },
  { name: 'case-upper', re: /\$\{[A-Za-z_][A-Za-z0-9_]*\^\^\}/ },
  { name: 'case-lower', re: /\$\{[A-Za-z_][A-Za-z0-9_]*,,/ },
  { name: 'wait-n', re: /\bwait\s+-n\b/ },
  { name: 'coproc', re: /\bcoproc\b/ },
  { name: 'append-both', re: /&>>/ },
]
const WINDOWS_BAD = /[:*?"<>|]/
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.[^.]*)?$/i

/* ── 纯扫描器（自证段直接复用；都是"文本进 → 发现出"，不碰文件系统） ── */
/** A 段：本机绝对路径是否**当场可覆盖**（同一行给出 env/家目录/tmpdir 之一）。 */
export function scanHostPaths(rel, text) {
  const found = []
  text.split('\n').forEach((line, i) => {
    if (!isCode(rel) || isCommentLine(line)) return
    for (const { name, re } of HOST_PATH_RES) {
      if (!re.test(line)) continue
      if (OVERRIDE_HINT.test(line)) continue
      if (allowHit(rel, line, name)) continue
      found.push({ rel, line: i + 1, kind: 'host-path-hardcoded', name, text: line.trim().slice(0, 120) })
    }
  })
  return found
}
/** B 段：写死的 `/tmp/…`（**裸片段**：`cp x /tmp/y` / `> /tmp/z` / `X=/tmp/…` 都算）。
 *  ①(PA-09) 只看**代码部分**（注释剥离），同行有覆盖口（process.env / os.tmpdir() / …）则放行。 */
export function scanTmpLiterals(rel, text) {
  const found = []
  if (!isCode(rel)) return found
  const lines = text.split('\n')
  const code = codePartsOfLines(rel, lines)
  for (let i = 0; i < lines.length; i++) {
    if (!TMP_LITERAL_RE.test(code[i])) continue
    if (OVERRIDE_HINT.test(code[i])) continue
    if (allowHit(rel, lines[i], 'tmp')) continue      // 白名单按**原行**匹配（登记的是原文特征，便于人核对）
    found.push({ rel, line: i + 1, kind: 'tmp-literal', text: lines[i].trim().slice(0, 120) })
  }
  return found
}
/** D 段：bash 4+ 独有特性（macOS 自带 3.2）+ shebang 与语法不匹配。 */
export function scanBashPortability(rel, text) {
  const found = []
  if (!rel.endsWith('.sh')) return found
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const { name, re } of BASH4_RES) {
      if (re.test(line)) found.push({ rel, line: i + 1, kind: 'bash4-only', name, text: line.trim().slice(0, 120) })
    }
  })
  const shebang = String(lines[0] || '').trim()
  const bashisms = /\[\[|\bfunction\s+\w|\bdeclare\b|\blocal\b|\$\{[A-Za-z_]\w*\[@\]\}/.test(text)
  if (bashisms && /^#!\/bin\/sh\b/.test(shebang)) {
    found.push({ rel, line: 1, kind: 'shebang-mismatch', text: shebang })
  }
  return found
}
/** F 段：BOM / CRLF（只看我们自己写的文本；第三方素材在调用处跳过）。 */
export function scanTextHygiene(rel, buf) {
  const found = []
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    found.push({ rel, line: 1, kind: 'bom' })
  }
  const head = buf.subarray(0, 8192)
  if (head.includes(0)) return found                      // 二进制：只判 BOM，不判行尾
  const text = buf.toString('utf8')
  const crlf = text.indexOf('\r\n')
  if (crlf >= 0) {
    found.push({ rel, line: text.slice(0, crlf).split('\n').length, kind: 'crlf' })
  }
  return found
}
/** E 段：文件名/路径本身的可移植性（大小写冲突、Windows 非法字符与保留名、结尾空格点、长度）。 */
export function scanPathNames(paths) {
  const found = []
  const byLower = new Map()
  for (const rel of paths) {
    const low = rel.toLowerCase()
    if (byLower.has(low) && byLower.get(low) !== rel) {
      found.push({ rel, kind: 'case-collision', other: byLower.get(low) })
    } else if (!byLower.has(low)) byLower.set(low, rel)
    for (const seg of rel.split('/')) {
      if (WINDOWS_BAD.test(seg)) found.push({ rel, kind: 'windows-illegal-char', seg })
      if (WINDOWS_RESERVED.test(seg)) found.push({ rel, kind: 'windows-reserved-name', seg })
      if (/[ .]$/.test(seg)) found.push({ rel, kind: 'trailing-space-or-dot', seg })
      if (Buffer.byteLength(seg, 'utf8') > 255) found.push({ rel, kind: 'segment-too-long', seg })
    }
    if (rel.length > 200) found.push({ rel, kind: 'path-too-long' })
  }
  return found
}
/** C 段：打开器候选链是否四平台齐全（返回缺失项）。 */
export function openerChainGaps(text) {
  const gaps = []
  if (!/'xdg-open'|"xdg-open"/.test(text)) gaps.push('linux:xdg-open')
  if (!/'open'|"open"/.test(text)) gaps.push('macos:open')
  if (!/'explorer'|"explorer"|'start'|"start"/.test(text)) gaps.push('windows:explorer|start')
  if (!/OPEN_CMD_ENV|MPW_OPEN_CMD/.test(text)) gaps.push('override:env')
  return gaps
}
/** 注释行（`#` / `//` / 块注释内部）不参与 A/B 判据：注释**不会执行**，不构成"平台上跑不了"；
    门禁管的是"能跑起来的那部分代码有没有可覆盖的路径"。（示例注释的跨平台性是风格约定，另说。） */
function isCommentLine(line) { return /^\s*(#|\/\/|\*|\/\*)/.test(line) }
/** 取若干行的**代码部分**（注释剥掉，行号一一对应）—— B 段用它：
    ①(PA-09 2026-09-24) 旧判据只看"行首是不是注释"，于是 **行尾注释** 与 **块注释内部**（例如
    行尾注释（`const x = y // … /tmp/…`）与**块注释内部**（斜杠星号开、星号斜杠闭，含跨行续行）
    都会被旧判据误判成"代码里写死了 /tmp"（假阳性）；反过来，真正的代码写法（`cp x /tmp/y`、`> /tmp/z`）
    又因为要求紧贴引号而被漏掉（假阴性）。这里一次解决两头：
      · `/tmp/` 判据只看**代码部分**；白名单仍按**原行**匹配（登记的是人看得见的原文特征）。
      · 注释风格按文件类型：`.sh` 认 `#`（`#` 需在行首或空白之后，避免切掉 `$#`/`${x#y}`）；
        `.mjs/.js` 认 `//` 与块注释（跨行用状态机跟住）。注意本注释里**不能出现**那个结束序列，
        否则会把注释提前闭合（上一版就踩了这一下）。
    轻量词法（只跟踪 ' " ` 三种引号与转义）足够本判据用：它不是解释器，只求"别把注释当代码"。 */
function codePartsOfLines(rel, lines) {
  const shell = /\.(sh|bash)$/i.test(rel)
  const out = []
  let inBlock = false
  for (const line of lines) {
    let code = ''
    let inStr = null
    for (let i = 0; i < line.length;) {
      const c = line[i], c2 = line.slice(i, i + 2)
      if (inBlock) { if (c2 === '*/') { inBlock = false; i += 2 } else i++; continue }
      if (inStr) {
        code += c
        if (c === '\\') { code += line[i + 1] || ''; i += 2; continue }
        if (c === inStr) inStr = null
        i++; continue
      }
      if (!shell && c2 === '/*') { inBlock = true; code += ' '; i += 2; continue }
      if (!shell && c2 === '//') break
      if (shell && c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break
      if (c === '"' || c === "'" || c === '`') { inStr = c; code += c; i++; continue }
      code += c; i++
    }
    out.push(code)
  }
  return out
}
function isCode(rel) {
  if (/\.md$/i.test(rel)) return false            /* 代码目录里的 .md 是文档：可以贴日志/例子（泄漏那一面由 secret-scan 覆盖全量 tracked） */
  return CODE_DIRS.some((d) => rel.startsWith(d)) && !TEXT_SKIP.some((re) => re.test(rel))
}
function allowHit(rel, line, name) {
  return ALLOW.some((a) => {
    const [file, needle] = a.key.split('::')
    return file === rel && line.includes(needle)
  })
}

/* ── 列 tracked 文件（跨平台：`git ls-files -z` + NUL 分隔，不依赖 shell 展开） ── */
let files = null
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean)
} catch (e) {
  say('SKIP 跨平台静态门禁 —— 取不到 `git ls-files`（没有 git 或不在仓库里）：' + String((e && e.message) || e).slice(0, 120))
  process.exit(0)
}

say('== A/B 本机绝对路径与写死的临时目录（可覆盖性）==')
const findingsAB = []
let codeFiles = 0, skippedAssets = 0
for (const rel of files) {
  if (TEXT_SKIP.some((re) => re.test(rel))) { skippedAssets++; continue }
  if (BINARY_EXT.test(rel)) continue
  const abs = path.join(ROOT, rel)
  let buf
  try { buf = fs.readFileSync(abs) } catch { continue }
  if (buf.subarray(0, 8192).includes(0)) continue
  if (isCode(rel)) codeFiles++
  const text = buf.toString('utf8')
  findingsAB.push(...scanHostPaths(rel, text), ...scanTmpLiterals(rel, text))
}
check('A/B 代码里的本机绝对路径与 `/tmp` 字面量要么可覆盖、要么在白名单里', findingsAB.length === 0,
  findingsAB.length === 0 ? ('扫了 ' + codeFiles + ' 个代码文件，跳过 ' + skippedAssets + ' 个素材/产物路径')
    : JSON.stringify(findingsAB.slice(0, 6)))
check('A/B 白名单逐条仍然命中（防腐烂：条目失效必须回来删）',
  ALLOW.every((a) => {
    const [file, needle] = a.key.split('::')
    try { return fs.readFileSync(path.join(ROOT, file), 'utf8').includes(needle) } catch { return false }
  }), ALLOW.length + ' 条')

say('\n== C 打开器候选链（Linux / macOS / Windows + 覆盖口）==')
{
  const targets = files.filter((f) => isCode(f) && /(^|\/)(server|tools)\//.test(f))
  const users = []
  for (const rel of targets) {
    let text = ''
    try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch { continue }
    if (!/'xdg-open'|"xdg-open"/.test(text)) continue          // 只有真的在找打开器的文件才受这条约束
    users.push({ rel, gaps: openerChainGaps(text) })
  }
  const bad = users.filter((u) => u.gaps.length)
  check('每一个"找打开器"的文件都同时给出 Linux/macOS/Windows 三条分支与环境覆盖口', bad.length === 0,
    users.length === 0 ? '没有文件在找打开器（跳过）' : (bad.length ? JSON.stringify(bad) : users.map((u) => u.rel).join(', ')))
}

say('\n== D shell 脚本的可移植性（macOS 自带 bash 3.2）==')
const findingsD = []
for (const rel of files.filter((f) => f.endsWith('.sh'))) {
  let text = ''
  try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch { continue }
  findingsD.push(...scanBashPortability(rel, text))
}
check('`.sh` 里没有 bash 4+ 独有特性，且 shebang 与实际语法匹配', findingsD.length === 0,
  findingsD.length === 0 ? (files.filter((f) => f.endsWith('.sh')).length + ' 个脚本') : JSON.stringify(findingsD.slice(0, 6)))

say('\n== E 文件名/路径可移植性 ==')
const findingsE = scanPathNames(files)
check('没有大小写冲突 / Windows 非法字符 / 保留设备名 / 结尾空格点 / 超长路径', findingsE.length === 0,
  findingsE.length === 0 ? (files.length + ' 条 tracked 路径') : JSON.stringify(findingsE.slice(0, 6)))

say('\n== F 文本卫生（BOM / CRLF）==')
const findingsF = []
let textScanned = 0
for (const rel of files) {
  if (TEXT_SKIP.some((re) => re.test(rel))) continue
  if (BINARY_EXT.test(rel)) continue
  let buf
  try { buf = fs.readFileSync(path.join(ROOT, rel)) } catch { continue }
  if (buf.subarray(0, 8192).includes(0)) continue
  textScanned++
  findingsF.push(...scanTextHygiene(rel, buf))
}
check('tracked 文本没有 BOM、没有 CRLF', findingsF.length === 0,
  findingsF.length === 0 ? (textScanned + ' 个文本文件') : JSON.stringify(findingsF.slice(0, 6)))

say('\n== G 分辨力自证（合成样本必须逐类报红；干净样本必须零发现）==')
{
  const dirtyHost = 'const cache = ' + JSON.stringify(SL + 'root' + SL + '.dsh-cache') + '\n'
  const cleanHost = 'const cache = process.env.MPW_CACHE || ' + JSON.stringify(SL + 'root' + SL + '.dsh-cache') + '\n'
  check('G1 不可覆盖的本机绝对路径被 A 段抓到', scanHostPaths('tools/fake.mjs', dirtyHost).length === 1,
    JSON.stringify(scanHostPaths('tools/fake.mjs', dirtyHost)[0] || null))
  check('G2 同一行给出 env 覆盖口就不算违规', scanHostPaths('tools/fake.mjs', cleanHost).length === 0)
  check('G2b 文档不在 A 段扫描面内（docs 可以当例子引用）', scanHostPaths('docs/fake.md', dirtyHost).length === 0)
  const T = SL + 'tmp' + SL
  const tmpSample = 'const d = ' + JSON.stringify(T + 'x') + '\n'
  check('G3 写死的临时目录被 B 段抓到', scanTmpLiterals('tools/fake.mjs', tmpSample).length === 1)
  check('G3b 走 os.tmpdir() 的写法不报', scanTmpLiterals('tools/fake.mjs', 'const d = path.join(os.tmpdir(), "x")\n').length === 0)
  check('G3c 注释行里的示例不算违规（注释不执行）', scanTmpLiterals('tools/fake.mjs', '// 例: node x.mjs ' + JSON.stringify(T + 'a.png') + '\n').length === 0)
  /* ①(PA-09 2026-09-24) 判据放宽的**分辨力反例**（旧判据 QUOTES+`/tmp/` 在这四条上全漏 ⇒ 这条门禁曾经
     "以为查了、其实一处没查"）。shell 变量赋值 / 重定向 / 命令参数三种真实写法必须逐条报红。 */
  check('G3d shell 变量赋值 `LOG=' + T + 'keep.log` 被 B 段抓到（旧判据漏检）',
    scanTmpLiterals('tools/fake.sh', 'LOG=' + T + 'keep.log\n').length === 1,
    JSON.stringify(scanTmpLiterals('tools/fake.sh', 'LOG=' + T + 'keep.log\n')))
  check('G3e 重定向 `>> ' + T + 'x.log 2>&1 &` 被 B 段抓到（旧判据漏检）',
    scanTmpLiterals('tools/fake.sh', 'node server.mjs >> ' + T + 'x.log 2>&1 &\n').length === 1)
  check('G3f 命令参数 `cp a ' + T + 'b` 被 B 段抓到（旧判据漏检）',
    scanTmpLiterals('tools/fake.sh', 'cp a ' + T + 'b\n').length === 1)
  // ⚠ 提示文案里也不能出现那个整串（本文件自己也是 tracked、也被 B 段扫）⇒ 同样按片段拼。
  check('G3g 反引号模板串 `' + T + 'x-${id}.png` 被 B 段抓到（旧判据只认单双引号 ⇒ 漏检）',
    scanTmpLiterals('tools/fake.mjs', 'const p = `' + T + 'x-${id}.png`\n').length === 1)
  check('G3h **行尾注释**里的 /tmp 不算违规（注释不执行；旧判据会假阳性）',
    scanTmpLiterals('tools/fake.mjs', 'const p = path.join(OUT, "a.png") // 避开共用 ' + T + 'vd/ 的覆盖\n').length === 0)
  check('G3i **块注释内部**（含跨行续行）里的 /tmp 不算违规',
    scanTmpLiterals('tools/fake.mjs', '/* 说明：\n   Windows 没有 ' + T + '，macOS 是 /private' + T + ' 的软链\n*/\nconst a = 1\n').length === 0)
  check('G3j shell 里 `#` 之后的 /tmp 不算违规，但同一行的 `$#`/`${x#y}` 不会被误当注释',
    scanTmpLiterals('tools/fake.sh', 'echo done # 日志见 ' + T + 'x.log\n').length === 0
    && scanTmpLiterals('tools/fake.sh', 'echo ${x#y} > ' + T + 'out\n').length === 1)
  check('G4 bash 4 独有特性被 D 段抓到（mapfile / declare -A / ${x^^}）',
    scanBashPortability('a.sh', '#!/usr/bin/env bash\nmapfile -t x < f\ndeclare -A m\necho ${v^^}\n').length === 3)
  check('G5 `#!/bin/sh` + bash 语法被 D 段抓到',
    scanBashPortability('a.sh', '#!/bin/sh\nif [[ -n $x ]]; then :; fi\n').some((f) => f.kind === 'shebang-mismatch'))
  check('G6 CRLF 与 BOM 被 F 段抓到',
    scanTextHygiene('a.txt', Buffer.from('x\r\ny\n', 'utf8')).some((f) => f.kind === 'crlf')
    && scanTextHygiene('b.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x\n')])).some((f) => f.kind === 'bom'))
  check('G7 大小写冲突 / Windows 非法字符被 E 段抓到',
    scanPathNames(['demo/a.js', 'demo/A.js']).some((f) => f.kind === 'case-collision')
    && scanPathNames(['demo/a?b.js']).some((f) => f.kind === 'windows-illegal-char')
    && scanPathNames(['demo/CON.txt']).some((f) => f.kind === 'windows-reserved-name'))
  check('G8 打开器缺 Windows 分支被 C 段抓到',
    openerChainGaps("const c = [process.env.OPEN_CMD_ENV, 'termux-open', 'xdg-open', 'open']").includes('windows:explorer|start')
    && openerChainGaps("const c = [process.env.OPEN_CMD_ENV, 'xdg-open', 'open', 'explorer']").length === 0)
  check('G9 干净样本零发现（不是"永远报红"的假门禁）',
    scanHostPaths('tools/ok.mjs', 'const a = 1\n').length === 0 && scanTmpLiterals('tools/ok.mjs', 'const a = 1\n').length === 0
    && scanBashPortability('ok.sh', '#!/usr/bin/env bash\nset -e\n').length === 0
    && scanPathNames(['demo/a.js', 'docs/b.md']).length === 0)
}

say('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (JSON_OUT) console.log(JSON.stringify({ pass, fail, findings: [...findingsAB, ...findingsD, ...findingsE, ...findingsF] }, null, 2))
if (fail === 0) say('✓ 跨平台静态门禁通过：本机路径可覆盖 + 临时目录走 os.tmpdir + 打开器四平台 + bash 3.2 兼容 + 文件名/文本卫生')
process.exit(fail > 0 ? 1 : 0)

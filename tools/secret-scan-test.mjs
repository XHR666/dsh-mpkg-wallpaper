// tools/secret-scan-test.mjs —— 敏感信息常驻扫描（**tracked 文件**；秒级，无网络、无浏览器、无子进程）
//
// 已注册：`tools/check.sh` 第 6 步（发布完整性自检）里紧跟 `tools/integrity-check.mjs` 一行 ——
// 刻意**不新增步骤**（`integrity-check.mjs` ⑨b 断言 check.sh 的 "N/M" 编号自洽，加一步要全表改分母，
// 徒增冲突面）。单独跑：`node tools/secret-scan-test.mjs`。
//
// 为什么要有它：`tools/integrity-check.mjs` ④⑤ 只查**发布面**（`lib/**`），而密钥最容易从
// **docs / tools / CI 配置 / 测试夹具**漏出去 —— 那些目录不进 npm 包，却会进公开仓库。
// 报告会过期，脚本不会 ⇒ 做成每次门禁都跑的常驻项。
//
// 判据（三条，任一不满足 → 退出码 1）：
//   A 凭据形态：tracked 文件里 0 命中（模式表见 PATTERNS；白名单见 WHITELIST，逐条写理由）
//   B 本机绝对路径门禁：tracked 文件里 0 命中（三种图案见 LOCAL_PATH_PATTERNS：本机工作区绝对路径 /
//     设备共享存储根（emulated）/ Termux 私有目录（com.termux））。**覆盖 tracked 全量** ——
//     docs/tools/CI 配置都算，不是"只看发布面"的假门禁。
//   C 白名单不许腐烂：WHITELIST 里每一条都必须**仍然命中** —— 删掉/改写被豁免的那一行 ⇒ 判红，
//     逼人回来删条目；否则白名单会慢慢变成"什么都没查"的遮羞布。
//
// 口径：
//   · 只扫 `git ls-files` 列出的文件（= tracked）。**不扫** node_modules / .git：本就不入库。
//   · 二进制（前 8KB 含 NUL）与 >4MB 文件跳过（不假装扫过：计数会打出来）。
//   · 日志**只打命中的前 6 个字符 + `…`**，绝不把疑似密钥全文写进日志（日志也会进 CI 归档）。
//
// ⚠ 自指陷阱（本文件里所有模式与白名单特征串都按这个规矩写）：本文件自己也是 tracked 文件、也会被扫，
//   所以**任何模式字面量都必须在源码里拆成片段**，否则本文件会成为唯一命中：
//     · `new RegExp('_auth' + 'Token=')` 而不是整串（否则 npm 令牌行形态自指）；
//     · 白名单的 `match` 也用 `'STORE_' + 'KEY = ' + '"…"'` 这样的拼接 —— 因为 `KEY = "…"` 本身就是
//       "名字含 key + 引号里 ≥20 字符"的形态，整串写在源码里会被 `assigned-credential-ext` 自指命中。
//   渲染器侧同一手法的先例：`tests/publish-check-selftest.mjs` 的 `'refer' + 'ences'`（躲 reference-isolation）。
//
// 用法: node tools/secret-scan-test.mjs            # 人读
//       node tools/secret-scan-test.mjs --json     # 机读
//       node tools/secret-scan-test.mjs --list     # 只列白名单（含每条的当前 file:line）后退出
// 退出码：0 干净 / 1 有命中（或白名单腐烂）/ 2 用法错误
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const LIST_ONLY = argv.includes('--list')
const KNOWN = ['--json', '--list']
for (const a of argv) {
  if (!KNOWN.includes(a)) {
    console.error(`✗ 未知参数 ${a}\n用法: node tools/secret-scan-test.mjs [--json] [--list]`)
    process.exit(2)
  }
}

// ── A 段：凭据形态模式表 ──
const PATTERNS = [
  { name: 'npm-auth-token-line', re: new RegExp('_auth' + 'Token=') },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: 'slack-token', re: /\bxox[baprs]-/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'bearer-literal', re: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  // 赋值式（题目指定的关键词集；引号里 ≥12 字符）
  { name: 'assigned-credential', re: /(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"][^'"]{12,}['"]/i },
  // 赋值式扩展（名字里含关键词 + 引号里 ≥20 字符）：`MY_GITHUB_TOKEN='…'`、`clientSecret: '…'` 这类真实
  // 泄漏形态**不在**上一条的关键词集里。代价：把"存储键名/路径常量"这类长字符串也算进来 ⇒ 由 WHITELIST 逐条豁免。
  { name: 'assigned-credential-ext', re: /(secret|token|passwd|password|credential|api[_-]?key|key|cookie)[A-Za-z0-9_]*\s*[:=]\s*['"][A-Za-z0-9+/_.-]{20,}['"]/i },
]

// ── C 段：白名单 ──
// 规矩：**逐条**登记，每条都要能说出"为什么它不是密钥"；**不许**按文件/目录整片豁免（那就是遮羞布）。
// `match` 是被豁免那一行的**特征子串**（用字面量而不是行号：行号会漂，字面量不会）；C 段断言它
// **仍然存在且仍被该模式命中** —— 条目过期就判红，逼人回来清账。`file:line` 由运行时打印（不写死）。
const WL = (a, b, c) => a + b + c   // 仅为把下面的自指形态拆开（见文件头"自指陷阱"）
const WHITELIST = [
  {
    file: 'lib/client.js',
    pattern: 'assigned-credential-ext',
    match: WL('STORE_', 'KEY = ', '"dsh.mpkg-wallpaper.v2"'),
    why: 'localStorage **键名**（插件设置整串 JSON 的存储键）：值是点分命名的键字符串，不含凭据；键名必须公开且稳定，否则升级后读不回用户设置',
  },
  {
    file: 'tools/dir-picker-probe.mjs',
    pattern: 'assigned-credential-ext',
    match: WL('const COOKIE = ', '', "'/tmp/ffprobe/cookie.json'"),
    why: '**文件路径**常量（自签 Cookie 的落盘位置，默认 /tmp/ffprobe/cookie.json），不是 Cookie 值本身；值由 tools/hdr-probe-mint-cookie.mjs 运行时现签、从不入库',
  },
]

// ── B 段：本机绝对路径门禁 ──
// 与 `tools/integrity-check.mjs` 的 ⑩ 节**同一判据、两处独立执行**（那边走 `git grep -InE`、这边走下面
// 对 tracked 文件的同一遍读取）：互为交叉校验，任一处腐烂另一处仍会响。图案同样按片段拼装（防自指）。
const LOCAL_PATH_PATTERNS = [
  { name: '本机工作区绝对路径', re: new RegExp('/root/Desktop/' + 'DSHarea') },
  { name: '设备共享存储根', re: new RegExp('/storage/' + 'emulated') },
  { name: 'Termux 私有目录', re: new RegExp('/data/' + 'data/com\\.termux') },
]

// ── 取 tracked 文件（node_modules/.git 天然不在内）──
let tracked = []
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\0').filter(Boolean)
} catch (e) {
  console.error('✗ 取不到 tracked 文件列表（git 不可用或不是 git 工作树）：' + String((e && e.message) || e))
  process.exit(1)
}

const scan = (patterns) => {
  const hits = []
  let textScanned = 0, skippedBinary = 0, skippedBig = 0
  for (const f of tracked) {
    const abs = path.join(ROOT, f)
    let buf = null
    try {
      if (fs.statSync(abs).size > 4 * 1048576) { skippedBig++; continue }
      buf = fs.readFileSync(abs)
    } catch { continue }
    if (buf.subarray(0, 8192).includes(0)) { skippedBinary++; continue }
    textScanned++
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        const m = p.re.exec(lines[i])
        if (m) hits.push({ file: f, line: i + 1, pattern: p.name, masked: m[0].slice(0, 6) + '…' })
      }
    }
  }
  return { hits, textScanned, skippedBinary, skippedBig }
}

// ── C 段：白名单活性（每条都必须仍然命中；用 match 定位而不是行号 ⇒ 行号漂移不算腐烂）──
const cache = new Map()
const linesOf = (f) => { if (!cache.has(f)) { try { cache.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) } catch { cache.set(f, []) } } return cache.get(f) }
const whitelistAudit = WHITELIST.map((w) => {
  const p = PATTERNS.find((x) => x.name === w.pattern)
  if (!p) return { ...w, ok: false, line: null, err: '模式名不存在：' + w.pattern }
  const lines = linesOf(w.file)
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(w.match) && p.re.test(lines[i])) return { ...w, ok: true, line: i + 1, err: '' }
  return { ...w, ok: false, line: null, err: `该行已不存在或不再被 ${w.pattern} 命中 ⇒ 条目过期，请删除` }
})

const secrets = scan(PATTERNS)
const effective = secrets.hits.filter((h) => !whitelistAudit.some((w) => w.ok && w.file === h.file && w.pattern === h.pattern && linesOf(h.file)[h.line - 1].includes(w.match)))
const paths = scan(LOCAL_PATH_PATTERNS)
const staleWhitelist = whitelistAudit.filter((w) => !w.ok)
const ok = !effective.length && !paths.hits.length && !staleWhitelist.length

if (LIST_ONLY) {
  console.log(`白名单 ${WHITELIST.length} 条（判定口径：条目必须仍然命中，否则判红）：`)
  for (const w of whitelistAudit) console.log(`  ${w.ok ? '✓' : '✗'} ${w.file}:${w.line === null ? '?' : w.line} [${w.pattern}] ${w.match}\n      why: ${w.why}`)
  process.exit(ok ? 0 : 1)
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    tracked: tracked.length, textScanned: secrets.textScanned, skippedBinary: secrets.skippedBinary, skippedBig: secrets.skippedBig,
    secretHits: effective, rawSecretHits: secrets.hits.length,
    whitelist: whitelistAudit.map((w) => ({ file: w.file, line: w.line, pattern: w.pattern, match: w.match, ok: w.ok })),
    localPathHits: paths.hits, ok,
  }, null, 1))
  process.exit(ok ? 0 : 1)
}

console.log(`扫描 ${tracked.length} 个 tracked 文件（文本 ${secrets.textScanned} 个；跳过二进制 ${secrets.skippedBinary} / >4MB ${secrets.skippedBig}）· 凭据模式 ${PATTERNS.length} 条 · 本机路径模式 ${LOCAL_PATH_PATTERNS.length} 条`)
console.log(`白名单 ${WHITELIST.length} 条（每条都断言"仍然命中"；当前 ${whitelistAudit.filter((w) => w.ok).length} 条命中）`)

if (effective.length) {
  console.error(`\n✗ 疑似凭据 ${effective.length} 处（只打前 6 字符，避免密钥进日志）：`)
  for (const h of effective) console.error(`  ✗ ${h.file}:${h.line} [${h.pattern}] ${h.masked}`)
}
if (paths.hits.length) {
  console.error(`\n✗ 本机绝对路径 ${paths.hits.length} 处（公开仓库不该带操作环境信息；兜底默认请按脚本位置推导）：`)
  for (const h of paths.hits) console.error(`  ✗ ${h.file}:${h.line} [${h.pattern}] ${h.masked}`)
}
if (staleWhitelist.length) {
  console.error(`\n✗ 白名单腐烂 ${staleWhitelist.length} 条（条目还在、被豁免的代码没了 ⇒ 白名单正在变成遮羞布）：`)
  for (const w of staleWhitelist) console.error(`  ✗ ${w.file} [${w.pattern}] ${w.match}\n      ${w.err}`)
}
if (ok) console.log('\n✓ 敏感信息扫描干净：凭据 0 命中、本机绝对路径 0 命中、白名单无腐烂条目')
process.exit(ok ? 0 : 1)

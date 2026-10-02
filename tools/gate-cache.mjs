// tools/gate-cache.mjs —— 门禁（tools/check.sh）的**输入指纹 / 增量缓存 / 单实例锁**后端（纯 Node，秒级）
//
// 为什么要有它（2026-10-02 门禁提速轮，数字见 docs/GATE-PERFORMANCE.md）：
//   ① 一遍门禁 12 步 / 65 条命令，实测 ~18 分钟；而"改一行再跑一遍"里绝大多数步的**输入根本没变**；
//   ② 两条线同时各跑一遍门禁会把设备跑崩（内存翻倍）。⇒ 按**步**做增量 + 全局单实例锁。
//
// 判据覆盖的红线（本文件所有设计都服从它，任何一条都不许为了"快"让步）：
//   · "绿"只有在（键相同）∧（上次**真跑**过）∧（那次退出码 0）三者同时成立时才产生；
//   · 键变 / 上次红 / 没有记录 / --full ⇒ 一律**真跑**，绝不因为"看着像没改"而跳过；
//   · 缓存自己坏了（读不出、算不出、写不进）⇒ **绝不报绿**：退回真跑，并在门禁汇总里显式记账；
//   · --full 逐条真跑 = 覆盖不丢的权威档；--list 只打印状态，不跑判据、不抢锁。
//
// 键 = 门禁**输入**的哈希（不是输出），逐条见 coreFingerprint()：
//   工作树内容（lib/** + tools/** + docs/** + package.json + …；排除门禁自己的产物 tools/probe-out/、dist/）
//   ⊕ git HEAD ⊕ node 版本/平台 ⊕ ffmpeg/ffprobe 指纹（决定转码类判据会不会 SKIP）
//   ⊕ 语料指纹（../allwallpaper/{dd,0917} 的 size+mtime；24GB 内容哈希不现实，退而用元数据）
//   ⊕ 已装 better-sidebar 指纹（tools/better-sidebar-compat-test.mjs 读它做锚点金丝雀）
//   ⊕ 步号。
//   ⇒ 上述任何一处在两次运行之间变了（哪怕一个字节），键就变 ⇒ 该步真跑。
//   分辨力自证（改一个字节必变）与"绿跳过 / 红不跳过"的判定断言：tools/gate-cache-test.mjs。
//
// 落盘：os.tmpdir()（可用 MPW_GATE_CACHE / MPW_GATE_LOCK 覆盖）；**仓库里不留本机绝对路径**。
// 测试可用 MPW_GATE_REPO 把"仓库根"指到夹具上（默认 = 本文件所在目录的上一级）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SCHEMA = 'mpw-gate-cache-v1'
export const STEP_TOTAL = 12

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(process.env.MPW_GATE_REPO || path.join(HERE, '..'))

/* 语料目录（相对仓库根；与 lib/index.js、tools/*-test.mjs 的默认探法逐字一致）。
   设了 MPW_SCENE_ROOT 时把它也算进指纹（那些测试优先读它 ⇒ 输入确实变了）。 */
export const CORPUS_RELS = ['../allwallpaper/dd', '../allwallpaper/0917']

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')
const isFile = (p) => { try { return fs.statSync(p).isFile() } catch { return false } }
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }

/* ── 工作树遍历 ────────────────────────────────────────────────────────────────
   排除的三类东西**必须**排除，否则"跑一遍门禁"自己就会把键改掉 ⇒ 缓存永远命不中：
     · tools/probe-out/ —— 第 9 步（真机复刻 A/B）的截图/JSON 落点，每次跑都重写；
     · dist/            —— 第 11 步（bundle 等价性）的构建产物；
     · node_modules/.git/编辑器残渣。
   软链不进指纹（跨机器指向不同目标；仓库内软链的目标本身也在树里）。 */
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist'])
const SKIP_TREE_PREFIX = ['tools/probe-out/']
const SKIP_REL_RE = /(^|\/)\.#|~$|\.log$|\.tmp$/

/* 条目类型判定：**只信 lstat，不信 Dirent.d_type**。
   为什么（真机实测，两个方向都错）：部分虚拟/容器文件系统（overlayfs、fuse 等）下
     · 工具新建的目录会回 DT_UNKNOWN（isFile/isDirectory 同时 false）；
     · **普通文件会被报成 symlink**（isSymbolicLink() true，而 lstat 说是 regular file）
       ⇒ 第一版实现把它当软链跳过 ⇒ 那个文件**整条不进指纹** ⇒ 改它一个字节键不变（缓存键的静默空洞）。
   本仓先例：`lib/index.js` 的 listWallpaperFiles 就栽在 d_type 上（软链/d_type 误报会让条目整条消失）。
   代价：每个条目多一次 lstat（工作树 ~164 + 语料 399 个条目 ⇒ 几毫秒），换的是"条目一条都不许丢"。 */
export function entryKind(dir, e) {
  try {
    const st = fs.lstatSync(path.join(dir, e.name))
    if (st.isSymbolicLink()) return 'link'
    if (st.isDirectory()) return 'dir'
    if (st.isFile()) return 'file'
  } catch { /* 读不到就当 other（跳过） */ }
  return 'other'
}

export function walkTree(root) {
  const out = []
  const walk = (dir, rel) => {
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name
      const kind = entryKind(dir, e)
      if (kind === 'link' || kind === 'other') continue
      if (kind === 'dir') {
        if (SKIP_DIR_NAMES.has(e.name)) continue
        if (SKIP_TREE_PREFIX.some((p) => (r + '/').startsWith(p))) continue
        walk(path.join(dir, e.name), r)
      } else {
        if (SKIP_REL_RE.test(r)) continue
        out.push(r)
      }
    }
  }
  if (!isDir(root)) return out
  walk(root, '')
  return out
}

/* 内容指纹（工作树用这个：改一个字节 ⇒ sha 变）。 */
export function fingerprintTree(root) {
  const files = walkTree(root)
  const h = crypto.createHash('sha256')
  let bytes = 0
  for (const rel of files) {
    let st = null, buf = null
    try { st = fs.statSync(path.join(root, rel)); buf = fs.readFileSync(path.join(root, rel)) } catch { st = null }
    if (!st || !buf) { h.update(rel + '\0UNREADABLE\n'); continue }
    bytes += st.size
    h.update(rel + '\0' + st.size + '\0' + sha256(buf) + '\n')
  }
  return { sha256: h.digest('hex'), files: files.length, bytes }
}

/* 元数据指纹（语料那 24GB 用这个：size+mtime，够敏感且秒级）。
   口径写在 docs/GATE-PERFORMANCE.md「诚实边界」：语料**内容**变了但 size 与 mtime 都没变（理论上可能）
   这一档不进键 —— 那种情况下用 --full 兜底。 */
export function fingerprintMeta(root) {
  const files = walkTree(root)
  const h = crypto.createHash('sha256')
  let bytes = 0
  for (const rel of files) {
    let st = null
    try { st = fs.statSync(path.join(root, rel)) } catch { st = null }
    if (!st) { h.update(rel + '\0GONE\n'); continue }
    bytes += st.size
    h.update(rel + '\0' + st.size + '\0' + Math.round(st.mtimeMs) + '\n')
  }
  return { sha256: h.digest('hex'), files: files.length, bytes }
}

export function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return 'no-git' }
}

function versionLine(cmd) {
  try {
    const out = execFileSync(cmd, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 })
    return String(out).split('\n')[0].trim().slice(0, 160) || 'present'
  } catch { return 'absent' }
}

/* 已装 better-sidebar：tools/better-sidebar-compat-test.mjs 的 E 段会读它（锚点金丝雀），
   它不属于本仓 ⇒ 内容不进工作树哈希，得单独进键；装了/没装/换版本都会让第 10 步真跑。
   路径来源与那条测试逐字一致（MPW_BS_DIR 可覆盖；默认 os.homedir()，同一行给"可覆盖"令牌）。 */
export function betterSidebarFingerprint() {
  const dir = process.env.MPW_BS_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-better-sidebar')
  if (!isFile(path.join(dir, 'package.json'))) return { present: false, sha256: sha256('bs-absent'), files: 0 }
  const rels = ['package.json']
  try {
    for (const f of fs.readdirSync(path.join(dir, 'lib')).filter((f) => f.endsWith('.js')).sort()) rels.push('lib/' + f)
  } catch { /* 没有 lib/ 就只有 package.json */ }
  const h = crypto.createHash('sha256')
  let bytes = 0
  for (const rel of rels) {
    let st = null
    try { st = fs.statSync(path.join(dir, rel)) } catch { st = null }
    if (!st) { h.update(rel + '\0GONE\n'); continue }
    bytes += st.size
    h.update(rel + '\0' + st.size + '\0' + Math.round(st.mtimeMs) + '\n')
  }
  return { present: true, sha256: h.digest('hex'), files: rels.length, bytes }
}

export function corpusFingerprints() {
  const rels = [...CORPUS_RELS]
  if (process.env.MPW_SCENE_ROOT) rels.unshift(process.env.MPW_SCENE_ROOT)
  return rels.map((rel) => {
    const abs = path.isAbsolute(rel) ? rel : path.resolve(REPO_ROOT, rel)
    if (!isDir(abs)) return { rel, present: false, sha256: sha256('corpus-absent:' + rel), files: 0, bytes: 0 }
    const m = fingerprintMeta(abs)
    return { rel, present: true, ...m }
  })
}

/* 一次运行只算一次（12 步共用）；单次成本实测 ~0.3s（工作树 ~8MB 内容哈希 + 400 条语料 stat + 两次 -version）。 */
export function coreFingerprint() {
  const t0 = Date.now()
  const tree = fingerprintTree(REPO_ROOT)
  const head = gitHead()
  const corpus = corpusFingerprints()
  const bs = betterSidebarFingerprint()
  const runtime = `${process.version}|${process.platform}|${process.arch}`
  const ffmpeg = versionLine('ffmpeg')
  const ffprobe = versionLine('ffprobe')
  const sha = sha256([
    SCHEMA,
    'head:' + head,
    'tree:' + tree.sha256,
    'runtime:' + runtime,
    'ffmpeg:' + ffmpeg,
    'ffprobe:' + ffprobe,
    'corpus:' + corpus.map((c) => c.rel + '=' + c.sha256).join(','),
    'bs:' + (bs.present ? bs.sha256 : 'absent'),
  ].join('\n'))
  return {
    sha256: sha, head, tree, corpus,
    bs: { present: bs.present, sha256: bs.sha256, files: bs.files },
    runtime, ffmpeg, ffprobe, ms: Date.now() - t0,
  }
}

export function stepKey(coreSha, step) {
  return sha256([SCHEMA, 'step:' + Number(step), 'core:' + String(coreSha)].join('\n'))
}

/* ── 缓存目录 / 记录 ─────────────────────────────────────────────────────────
   缓存与锁都在 os.tmpdir()（不进仓库）；目录名带仓库路径哈希 ⇒ 同一台机器上多个 clone 不互相串。 */
export function cacheDir() {
  if (process.env.MPW_GATE_CACHE) return path.resolve(process.env.MPW_GATE_CACHE)
  return path.join(os.tmpdir(), 'dsh-mpkg-wallpaper-gate-' + sha256(REPO_ROOT).slice(0, 12))
}
export function lockPath() {
  if (process.env.MPW_GATE_LOCK) return path.resolve(process.env.MPW_GATE_LOCK)
  return path.join(cacheDir(), 'gate.lock')
}
export const lockDirFallback = (lockFile) => lockFile + '.d'
const stepFile = (dir, step) => path.join(dir, 'steps', 'step-' + Number(step) + '.json')

export function readRecord(step, dir = cacheDir()) {
  try {
    const j = JSON.parse(fs.readFileSync(stepFile(dir, step), 'utf8'))
    if (!j || j.schema !== SCHEMA || Number(j.step) !== Number(step)) return null
    return j
  } catch { return null }
}

export function writeRecord(rec, dir = cacheDir()) {
  const f = stepFile(dir, rec.step)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = f + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ schema: SCHEMA, ...rec }, null, 1) + '\n')
  fs.renameSync(tmp, f)   // 原子替换：读到半截记录不算数（readRecord 会当 null）
  return f
}

/* 决策：唯一的"跳过"出口就在下面这一处（skip 需要 key 相同 + 上次 status=green + 非 --full）。 */
export function decide({ step, key, dir = cacheDir(), full = false }) {
  const prev = readRecord(step, dir)
  if (full) return { action: 'run', reason: 'full', key, prev }
  if (!prev) return { action: 'run', reason: 'uncached', key, prev: null }
  if (String(prev.key || '') !== String(key)) return { action: 'run', reason: 'key-changed', key, prev }
  if (prev.status !== 'green') return { action: 'run', reason: 'last-' + String(prev.status || 'unknown'), key, prev }
  return { action: 'skip', reason: 'green-cached', key, prev }
}

/* --list 用：四态（未缓存 / 绿 / 红 / 脏）。 */
export function statusOf({ step, key, dir = cacheDir() }) {
  const prev = readRecord(step, dir)
  if (!prev) return { status: 'uncached', prev: null }
  if (String(prev.key || '') !== String(key)) return { status: 'dirty', prev }
  return { status: prev.status === 'green' ? 'green' : 'red', prev }
}

/* ── 锁（与 tools/check.sh 的 flock/mkdir 两条路共用同一份解析/文案） ───────────── */
export function parseLockInfo(text, nowMs = Date.now()) {
  const lines = String(text === undefined || text === null ? '' : text).split('\n').map((s) => s.trim()).filter(Boolean)
  const pid = /^[0-9]+$/.test(lines[0] || '') ? Number(lines[0]) : null
  const startedSec = /^[0-9]+$/.test(lines[1] || '') ? Number(lines[1]) : null
  const elapsed = startedSec === null ? null : Math.max(0, Math.round(nowMs / 1000 - startedSec))
  const alive = pid === null ? null : isAlive(pid)
  return { pid, startedSec, elapsed, alive }
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return !!(e && e.code === 'EPERM') }
}

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* 环境不支持就退化成不重试 */ } }

/* 抢锁失败的一方读锁文件时有极小竞态（持有者刚 flock 成功、还没写 info）⇒ 短重试几次。 */
export function readLockInfo(lockFile, { tries = 8, waitMs = 30 } = {}) {
  let text = ''
  for (let i = 0; i < tries; i++) {
    try { text = fs.readFileSync(lockFile, 'utf8') } catch { text = '' }
    if (/^[0-9]+$/m.test(text)) break
    sleepSync(waitMs)
  }
  return { ...parseLockInfo(text), raw: text, lockFile }
}

/* 人话提示：必须包含"另一个门禁在跑（PID …，已跑 … 秒），本次退出"这句（tools/gate-cache-test.mjs 逐字断言）。 */
export function busyMessage(info, lockFile) {
  const pid = info && info.pid !== null && info.pid !== undefined ? String(info.pid) : '未知'
  const el = info && info.elapsed !== null && info.elapsed !== undefined ? String(info.elapsed) : '未知'
  const gone = info && info.alive === false
    ? '（记录里的 PID 已经退出：锁多半正被它的某个子进程短暂握着、或正在释放中 —— 稍等 1~2 秒重跑即可；若一直失败，用 ps 找残留子进程）'
    : ''
  return [
    `✗ 另一个门禁在跑（PID ${pid}，已跑 ${el} 秒），本次退出 —— 没有跑任何判据。`,
    '  原因：同一时刻只允许一个门禁实例（两条线并发跑会让内存翻倍，本机就是被这个跑崩的）。',
    `  锁文件: ${lockFile}${gone}`,
    '  怎么办：等那一个跑完再跑。锁由 flock 交给内核管，进程退出即释放 ⇒ 不会留"残留锁"；',
    '          只想看状态可以另开终端跑 bash tools/check.sh --list（它不抢锁、不跑判据）。',
  ].join('\n')
}

/* mkdir 兜底锁的"是不是死进程留下的"判定：能确定 PID 已死才说 stale（否则宁可快速失败）。 */
export function lockStale(lockFile) {
  const info = readLockInfo(lockFile, { tries: 2, waitMs: 10 })
  if (info.pid === null) return 'no'
  return info.alive ? 'no' : 'yes'
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
function usage() {
  return [
    '用法:',
    '  node tools/gate-cache.mjs core [--json|--line]         # 门禁输入指纹（工作树+HEAD+运行时+语料+bs）',
    '  node tools/gate-cache.mjs key --step N [--core SHA]    # 某一步的缓存键',
    '  node tools/gate-cache.mjs decide --step N --core SHA [--full]   # 打印 SKIP<TAB>毫秒<TAB>键 / RUN<TAB>原因<TAB>键',
    '  node tools/gate-cache.mjs record --step N --key SHA --status green|red --ms 毫秒',
    '  node tools/gate-cache.mjs status --step N --core SHA   # 打印 状态<TAB>上次毫秒<TAB>键前缀<TAB>上次真跑时间',
    '  node tools/gate-cache.mjs busy --lock FILE             # 抢锁失败时的人话提示（写 stderr 由调用方决定码）',
    '  node tools/gate-cache.mjs lock-stale --lock FILE       # mkdir 兜底锁：yes/no（死进程留下才 yes）',
    '  node tools/gate-cache.mjs dir | lock-path',
  ].join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0] || ''
  const has = (k) => argv.includes(k)
  const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
  const coreOf = () => { const c = val('--core', ''); return c || coreFingerprint().sha256 }
  const atIso = (ms) => { try { return new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16) } catch { return '-' } }

  switch (cmd) {
    case 'core': {
      const c = coreFingerprint()
      if (has('--json')) process.stdout.write(JSON.stringify(c, null, 2) + '\n')
      else if (has('--line')) process.stdout.write([c.sha256, c.tree.files, c.corpus.reduce((s, x) => s + x.files, 0), String(c.head).slice(0, 8), c.ffmpeg, c.bs.present ? '在' : '不在', c.ms].join('\t') + '\n')
      else process.stdout.write(c.sha256 + '\n')
      return 0
    }
    case 'key':
      process.stdout.write(stepKey(coreOf(), Number(val('--step', '0'))) + '\n')
      return 0
    case 'decide': {
      const step = Number(val('--step', '0'))
      const d = decide({ step, key: stepKey(coreOf(), step), full: has('--full'), dir: cacheDir() })
      const prevMs = d.prev && Number.isFinite(Number(d.prev.ms)) ? Number(d.prev.ms) : 0
      /* ⚠ 这里必须吐**完整**键：check.sh 会把它原样交给 record 存起来，下次 decide 拿完整键比对。
         曾经这里吐的是 12 位前缀 ⇒ 存进去的是前缀、比的是全长 ⇒ **永远判"键变了"、缓存从不命中**
         （由 tools/gate-cache-test.mjs 的 CLI 往返判据与编排自检一起钉住）。显示时才截断。 */
      process.stdout.write(d.action === 'skip'
        ? ['SKIP', prevMs, d.key].join('\t') + '\n'
        : ['RUN', d.reason, d.key].join('\t') + '\n')
      return 0
    }
    case 'record': {
      const step = Number(val('--step', '0'))
      const status = val('--status', '')
      if (!['green', 'red'].includes(status)) { process.stderr.write('record: --status 必须是 green|red\n'); return 2 }
      writeRecord({ step, key: String(val('--key', '')), status, ms: Number(val('--ms', '0')) || 0, at: new Date().toISOString() })
      return 0
    }
    case 'status': {
      const step = Number(val('--step', '0'))
      const s = statusOf({ step, key: stepKey(coreOf(), step), dir: cacheDir() })
      const prev = s.prev || {}
      process.stdout.write([s.status, Number(prev.ms) || 0, String(prev.key || '').slice(0, 12), prev.at ? atIso(Date.parse(prev.at)) : '-'].join('\t') + '\n')
      return 0
    }
    case 'busy': {
      const lockFile = val('--lock', lockPath())
      process.stderr.write(busyMessage(readLockInfo(lockFile), lockFile) + '\n')
      return 0
    }
    case 'lock-stale':
      process.stdout.write(lockStale(val('--lock', lockPath())) + '\n')
      return 0
    case 'dir':
      process.stdout.write(cacheDir() + '\n')
      return 0
    case 'lock-path':
      process.stdout.write(lockPath() + '\n')
      return 0
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(usage() + '\n')
      return 0
    default:
      process.stderr.write('未知子命令: ' + (cmd || '(空)') + '\n' + usage() + '\n')
      return 2
  }
}

/* 只有"被当成脚本直接跑"时才走 CLI：被 import 时（tools/gate-cache-test.mjs 要 import 它的纯函数）
   不许执行 CLI、不许污染调用方的 exitCode。 */
const invokedDirectly = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
})()
if (invokedDirectly) process.exitCode = main()

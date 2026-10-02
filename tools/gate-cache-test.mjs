// tools/gate-cache-test.mjs —— 门禁"输入指纹 / 增量缓存 / 单实例锁"的判据
//
// 为什么要有它（2026-10-02 门禁提速轮）：为了让门禁从 ~18 分钟降到"没改东西时几秒"，给 tools/check.sh
// 加了增量缓存与单实例锁。这类优化**最危险的失效模式是静默漏跑**——键算得太粗（改了源码却判"没变"）、
// 绿/红判反（上次红的也被跳过）、锁形同虚设（两条线照样并发）。这一条判据只钉这四件事：
//
//   A 键的分辨力：lib/**、tools/**、package.json 里**改一个字节** ⇒ 键必变；
//                 门禁自己的产物（tools/probe-out/、dist/）变化 ⇒ 键**不变**（否则缓存永远命不中，
//                 "缓存"会退化成"每步都真跑"）；语料、git HEAD 也是输入（改了就必变）。
//   B 决策函数：绿 + 键一致 ⇒ 跳过；红 ⇒ 真跑；键变 ⇒ 真跑；没记录 ⇒ 真跑；--full ⇒ 真跑（哪怕全绿）；
//                缓存文件损坏 / schema 不对 ⇒ **当没缓存**（绝不把"读不出"当成"绿"）。
//   C --list：真的打印 12 步（编号 1..12 各一次）+ 每步状态；且它**不跑判据**、**不抢锁**。
//   D 锁：真起第二个 check.sh（--selftest-lock：只抢锁不跑判据）⇒ 快速失败 + 人话提示《另一个门禁在跑
//          （PID …，已跑 … 秒），本次退出》+ 非零退出码；第一个跑完后能立刻再抢到 ⇒ 没有"残留锁"。
//
// 用法: node tools/gate-cache-test.mjs      （纯 Node；约 4s；不跑任何门禁步骤）
// 说明：夹具在 os.tmpdir() 里现造；真实仓库只读（只跑 `check.sh --list` / `--selftest-lock` 两个不跑判据的入口）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(process.env.MPW_GATE_REPO || path.join(here, '..'))
const HELPER = path.join(here, 'gate-cache.mjs')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-gate-cache-test-'))

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

/* ── 夹具仓库（内容全部现造；REPO_ROOT 用 MPW_GATE_REPO 注入 => 不碰真仓库） ───────────── */
const FIX = path.join(TMP, 'repo')
const W = (rel, text) => {
  const p = path.join(FIX, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
  return p
}
const BASE = {
  'package.json': '{"name":"fixture","version":"1.0.0"}\n',
  'lib/client.js': 'export const A = 1\n',
  'tools/some-test.mjs': 'console.log("hi")\n',
  'tools/probe-out/evidence.json': '{"run":1}\n',
  'dist/bundle.mjs': 'export const B = 2\n',
  'docs/NOTE.md': '# note\n',
}
const writeBase = () => { for (const [rel, text] of Object.entries(BASE)) W(rel, text) }
writeBase()

/* 同一个 helper 文件、不同夹具根 => 用带 query 的动态 import 拿独立实例（模块级 REPO_ROOT 是常量）。 */
async function modFor(repoRoot) {
  const url = pathToFileURL(HELPER).href + '?repo=' + encodeURIComponent(repoRoot)
  const prev = process.env.MPW_GATE_REPO
  process.env.MPW_GATE_REPO = repoRoot
  try { return await import(url) } finally {
    if (prev === undefined) delete process.env.MPW_GATE_REPO; else process.env.MPW_GATE_REPO = prev
  }
}

const m = await modFor(FIX)
const CACHE = path.join(TMP, 'cache')
process.env.MPW_GATE_CACHE = CACHE
const stepRec = (n) => path.join(CACHE, 'steps', 'step-' + n + '.json')

/* ═══════════════════════ A 键的分辨力 ═══════════════════════ */
console.log('\n== A 输入键的分辨力（改一个字节必变；门禁自己的产物必不算）==')
{
  const core = () => m.coreFingerprint().sha256
  const k0 = core()
  ok('A0 同一棵树两次算键逐字相同（确定性）', core() === k0, k0.slice(0, 12))

  // 门禁产物：第 9 步写 tools/probe-out/、第 11 步写 dist/ ——它们要是进键，跑一遍门禁就把自己判脏
  W('tools/probe-out/evidence.json', '{"run":2}\n')
  W('dist/bundle.mjs', 'export const B = 3\n')
  W('tools/probe-out/replica-after/measure.json', '{"peaks":[1,2,3]}\n')
  ok('A1 门禁产物（tools/probe-out/**、dist/**）变化 ⇒ 键不变（否则缓存永不命中）', core() === k0)

  W('lib/client.js', 'export const A = 2\n')
  const k1 = core()
  ok('A2 lib/** 改一个字节 ⇒ 键变', k1 !== k0, k1.slice(0, 12))

  W('lib/client.js', BASE['lib/client.js'])
  W('tools/some-test.mjs', 'console.log("hi!")\n')
  const k2 = core()
  ok('A3 tools/** 改一个字节 ⇒ 键变', k2 !== k0 && k2 !== k1, k2.slice(0, 12))

  W('tools/some-test.mjs', BASE['tools/some-test.mjs'])
  W('package.json', '{"name":"fixture","version":"1.0.1"}\n')
  const k3 = core()
  ok('A4 package.json 改一个字节 ⇒ 键变', k3 !== k0 && k3 !== k2, k3.slice(0, 12))

  W('package.json', BASE['package.json'])
  ok('A5 全部还原 ⇒ 键回到 k0（不是"跑一次就漂"）', core() === k0)

  // 语料（../allwallpaper/dd）是外部输入：出现/变化都必须让键变，否则"新加一个壁纸包"这类改动会被缓存吞掉
  const corpusFile = path.join(TMP, 'allwallpaper', 'dd', '1234567890', 'scene.pkg')
  fs.mkdirSync(path.dirname(corpusFile), { recursive: true })
  fs.writeFileSync(corpusFile, 'PKGV0022-fixture')
  const k4 = core()
  ok('A6 语料（../allwallpaper/dd）出现新包 ⇒ 键变', k4 !== k0, k4.slice(0, 12))
  fs.writeFileSync(corpusFile, 'PKGV0022-fixture-2')
  ok('A7 语料内容变化（size/mtime 变） ⇒ 键再变', core() !== k4)

  // git HEAD 也是输入：5 条判据拿 `git show HEAD:lib/client.js` 当 before ⇒ HEAD 动了必须重跑
  const git = (args) => spawnSync('git', args, { cwd: FIX, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).status === 0
  if (hasGit) {
    const beforeGit = core()                       // ← 必须**先**抓：commit 之后同一棵树内容没变，只有 HEAD 变
    git(['init', '-q'])
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture', '--allow-empty'])
    const c = m.coreFingerprint()
    ok('A8 git HEAD 进键（同一棵树内容、HEAD 从无到有 ⇒ 键变）', c.head !== 'no-git' && c.sha256 !== beforeGit, String(c.head).slice(0, 8))
  } else {
    console.log('  · SKIP A8：本机没有 git（HEAD 进键这一条未验）')
  }

  // A10/A11：**条目不许悄悄消失**。Dirent.d_type 不可信（f2fs/overlayfs/fuse 等会回 DT_UNKNOWN ⇒
  // isFile() 与 isDirectory() 同时 false）。第一版实现只看 d_type，结果某个"由工具新建的目录"整棵子树
  // 不在指纹里、改它一字节键不变 —— 缓存键出现静默空洞（本仓 lib/index.js 有同类事故先例）。
  const walked = m.walkTree(FIX)
  const EXPECT_EXCLUDED = ['tools/probe-out/evidence.json', 'dist/bundle.mjs']   // 这两条是**故意**排除的门禁产物（见 A1）
  const dropped = Object.keys(BASE).filter((f) => !EXPECT_EXCLUDED.includes(f) && !walked.includes(f))
  ok('A10 该进指纹的条目一条都不许悄悄消失（只允许那两条故意排除的产物缺席）', dropped.length === 0, JSON.stringify(dropped))
  const lie = (name, kind) => ({ name, isFile: () => kind === 'file', isDirectory: () => kind === 'dir', isSymbolicLink: () => kind === 'link' })
  const dirKind = m.entryKind(FIX, lie('lib', 'unknown'))
  const fileKind = m.entryKind(path.join(FIX, 'lib'), lie('client.js', 'unknown'))
  const lieLinkKind = m.entryKind(path.join(FIX, 'lib'), lie('client.js', 'link'))   // ← 普通文件被谎报成 symlink（本机实测形态）
  let realLinkKind = 'skip'
  try { fs.symlinkSync('client.js', path.join(FIX, 'lib', 'alias.js')); realLinkKind = m.entryKind(path.join(FIX, 'lib'), lie('alias.js', 'file')) } catch { /* 建不了软链就跳过这一格 */ }
  ok('A11 类型判定只信 lstat（dirent 两个方向都会撒谎：新建目录报 unknown、普通文件报 symlink）',
    dirKind === 'dir' && fileKind === 'file' && lieLinkKind === 'file' && (realLinkKind === 'link' || realLinkKind === 'skip'),
    [dirKind, fileKind, lieLinkKind, realLinkKind].join('/'))

  const core1 = m.coreFingerprint().sha256
  ok('A9 步号独立成键（逐步分开缓存；同 core 不同步 ⇒ 键不同）',
    m.stepKey(core1, 1) !== m.stepKey(core1, 2) && m.stepKey(core1, 1) === m.stepKey(core1, 1))
}

/* ═══════════════════════ B/E 决策函数（绿跳过 / 红不跳过 / --full 不跳过） ═══════════════════════ */
console.log('\n== B 决策函数（skip 的唯一出口：键一致 ∧ 上次真跑为绿 ∧ 非 --full）==')
let GREEN_KEY = ''
{
  const core = m.coreFingerprint().sha256
  GREEN_KEY = m.stepKey(core, 7)
  const rec = (status, key, ms) => m.writeRecord({ step: 7, key, status, ms, at: new Date().toISOString() })

  const d0 = m.decide({ step: 7, key: GREEN_KEY })
  ok('B1 没有记录 ⇒ 真跑（uncached）', d0.action === 'run' && d0.reason === 'uncached', d0.reason)

  rec('green', GREEN_KEY, 1234)
  const d1 = m.decide({ step: 7, key: GREEN_KEY })
  ok('B2 绿 + 键一致 ⇒ 跳过，并带上上次真跑耗时', d1.action === 'skip' && d1.prev && d1.prev.ms === 1234, JSON.stringify({ action: d1.action, ms: d1.prev && d1.prev.ms }))
  ok('B3 状态口径：绿（--list 用）', m.statusOf({ step: 7, key: GREEN_KEY }).status === 'green')

  const d2 = m.decide({ step: 7, key: m.stepKey(core, 7) + 'x' })
  ok('B4 键变了（哪怕上次绿） ⇒ 真跑（key-changed）', d2.action === 'run' && d2.reason === 'key-changed', d2.reason)
  ok('B5 状态口径：脏（记录在、键已变）', m.statusOf({ step: 7, key: 'other-key' }).status === 'dirty')

  rec('red', GREEN_KEY, 88)
  const d3 = m.decide({ step: 7, key: GREEN_KEY })
  ok('B6 **上次为红 ⇒ 真跑**（失败绝不继承、也不许被跳过）', d3.action === 'run' && d3.reason === 'last-red', d3.reason)
  ok('B7 状态口径：红（--list 用）', m.statusOf({ step: 7, key: GREEN_KEY }).status === 'red')

  rec('green', GREEN_KEY, 4321)
  const d4 = m.decide({ step: 7, key: GREEN_KEY, full: true })
  ok('B8 --full ⇒ 真跑（哪怕绿缓存；这是"覆盖不丢"的权威档）', d4.action === 'run' && d4.reason === 'full', d4.reason)

  // 坏缓存绝不报绿：读到半截/写坏/schema 不对 ⇒ 当没缓存
  fs.writeFileSync(stepRec(7), '{ half-written')
  ok('B9 缓存文件是半截 JSON ⇒ 当没缓存（真跑，不报绿）', m.decide({ step: 7, key: GREEN_KEY }).action === 'run')
  fs.writeFileSync(stepRec(7), JSON.stringify({ schema: 'someone-elses-v9', step: 7, key: GREEN_KEY, status: 'green', ms: 1 }))
  ok('B10 schema 不认识的记录 ⇒ 当没缓存（不冒充绿）', m.decide({ step: 7, key: GREEN_KEY }).action === 'run')
  fs.writeFileSync(stepRec(7), JSON.stringify({ schema: m.SCHEMA, step: 8, key: GREEN_KEY, status: 'green', ms: 1 }))
  ok('B11 记录里的步号对不上 ⇒ 当没缓存（不串步）', m.decide({ step: 7, key: GREEN_KEY }).action === 'run')
  fs.unlinkSync(stepRec(7))
  ok('B12 状态口径：未缓存', m.statusOf({ step: 7, key: GREEN_KEY }).status === 'uncached')

  // E 分辨力自证（把决策的输入翻一下，结论必须跟着翻 —— 它就是"变异必红"的最小形式）
  console.log('\n== E 分辨力自证（同一份缓存在两种输入下必须给出相反结论）==')
  rec('green', GREEN_KEY, 10)
  const skipWhenGreen = m.decide({ step: 7, key: GREEN_KEY }).action === 'skip'
  rec('red', GREEN_KEY, 10)
  const runWhenRed = m.decide({ step: 7, key: GREEN_KEY }).action === 'run'
  ok('E1 同样的键：绿 ⇒ skip、红 ⇒ run（结论跟着状态翻）', skipWhenGreen && runWhenRed)
  rec('green', GREEN_KEY, 10)
  const skipSameKey = m.decide({ step: 7, key: GREEN_KEY }).action === 'skip'
  const runChangedKey = m.decide({ step: 7, key: GREEN_KEY + 'x' }).action === 'run'
  ok('E2 同样的状态：键一致 ⇒ skip、键变 ⇒ run（结论跟着键翻）', skipSameKey && runChangedKey)
}

/* ═══════════════════════ G 编排结构（静态：判据命令不许漏在 gate 块外） ═══════════════════════ */
// 为什么单独一条：缓存/锁的价值全靠"每条判据都在 gate_begin…gate_end 之间"这一条结构事实。
// 将来有人往 check.sh 里加一条判据却忘了包进块里，它会**每次无条件跑**（缓存形同虚设），
// 而在人眼里"门禁还是绿的" —— 静默的成本，必须机器判红。
console.log('\n== G 编排结构（每条判据命令都在某个 gate 块里）==')
{
  const sh = fs.readFileSync(path.join(ROOT, 'tools', 'check.sh'), 'utf8').split('\n')
  const CMD = /^\s*node tools\/[^\s]+\s/
  let open = '', inside = [], outside = []
  const steps = []
  for (const line of sh) {
    const b = line.match(/^\s*gate_begin (\d+)\s*$/)
    if (b) { open = b[1]; steps.push(Number(b[1])); continue }
    if (/^\s*gate_end \d+\s*$/.test(line)) { open = ''; continue }
    if (!CMD.test(line)) continue
    if (open) inside.push({ step: open, cmd: line.trim() }); else outside.push(line.trim())
  }
  ok('G1 判据命令一条都没漏在 gate 块外（漏了就会每次无条件跑）', outside.length === 0, JSON.stringify(outside.slice(0, 3)))
  ok('G2 12 个步骤各有 gate_begin（1..12 各一次）', JSON.stringify(steps) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), JSON.stringify(steps))
  const withCmd = [...new Set(inside.map((x) => x.step))].map(Number).sort((a, b) => a - b)
  ok('G3 除第 1 步（它的命令是 `node --check` 不是 `node tools/*.mjs`）外，2..12 每个块里都有判据命令（无空块/错位块）',
    JSON.stringify(withCmd) === JSON.stringify([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), JSON.stringify(withCmd))
  const i1 = sh.findIndex((l) => /^\s*gate_begin 1\s*$/.test(l))
  const j1 = sh.findIndex((l) => /^\s*gate_end 1\s*$/.test(l))
  ok('G3b 第 1 步块里有 `node --check`（不是空块）', i1 > 0 && j1 > i1 && /node --check/.test(sh.slice(i1, j1).join('\n')))
  ok('G4 新判据挂在第 6 步里（不新增步骤）', inside.some((x) => x.step === '6' && x.cmd.includes('gate-cache-test.mjs')), '第 6 步 ' + inside.filter((x) => x.step === '6').length + ' 条')
}

/* ═══════════════════════ F CLI 往返（check.sh 真正走的那条路） ═══════════════════════ */
// 为什么单列一段：库级断言**测不出**"CLI 输出的键被截断"这类错 —— 那正是本判据第一次写完时真实踩过的坑
// （decide 吐 12 位前缀 ⇒ record 存前缀 ⇒ 下次拿全长比对永远不等 ⇒ 缓存一次都没命中，编排自检才发现）。
// 这一段每一条都从**命令行**走一遍：decide → record（原样用 decide 吐出来的键）→ decide 必须 SKIP。
console.log('\n== F CLI 往返（decide 吐的键必须能被 record 存下、且下次 decide 认它）==')
{
  const cli = (args) => {
    const r = spawnSync(process.execPath, [HELPER, ...args], { cwd: FIX, env: { ...process.env, MPW_GATE_REPO: FIX, MPW_GATE_CACHE: CACHE }, encoding: 'utf8' })
    return { status: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() }
  }
  fs.rmSync(CACHE, { recursive: true, force: true })
  const d1 = cli(['decide', '--step', '9', '--core', m.coreFingerprint().sha256])
  const f = d1.out.split('\t')
  ok('F1 CLI decide（无记录）⇒ RUN', d1.status === 0 && f[0] === 'RUN', d1.out.slice(0, 60))
  ok('F2 CLI decide 吐的是**完整 64 位键**（截断过就会让缓存永不命中）', /^[0-9a-f]{64}$/.test(f[2] || ''), (f[2] || '').slice(0, 16) + '…（' + String(f[2] || '').length + ' 字符）')
  const rec = cli(['record', '--step', '9', '--key', f[2], '--status', 'green', '--ms', '4321'])
  ok('F3 CLI record 写入成功', rec.status === 0)
  const d2 = cli(['decide', '--step', '9', '--core', m.coreFingerprint().sha256])
  ok('F4 同一个键再 decide ⇒ SKIP（这条就是"缓存真的命中"）', d2.out.split('\t')[0] === 'SKIP', d2.out.slice(0, 60))
  ok('F5 SKIP 时带上上次真跑耗时', d2.out.split('\t')[1] === '4321', d2.out.split('\t')[1])
  const st = cli(['status', '--step', '9', '--core', m.coreFingerprint().sha256])
  ok('F6 CLI status ⇒ green', st.out.split('\t')[0] === 'green', st.out.slice(0, 60))
  const d3 = cli(['decide', '--step', '9', '--core', m.coreFingerprint().sha256, '--full'])
  ok('F7 CLI decide --full ⇒ RUN（哪怕绿缓存）', d3.out.split('\t')[0] === 'RUN' && d3.out.split('\t')[1] === 'full', d3.out.slice(0, 60))
  const bad = cli(['record', '--step', '9', '--key', f[2], '--status', 'nonsense'])
  ok('F8 CLI record 拒绝非法状态（不写坏记录）', bad.status !== 0)
  fs.rmSync(CACHE, { recursive: true, force: true })
}

console.log('\n== D 单实例锁（第二个实例快速失败；第一个跑完不留残留锁）==')
const waitForLock = (child, timeoutMs) => new Promise((resolve, reject) => {
  let out = ''
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已退出 */ } reject(new Error('等不到 LOCK-ACQUIRED（' + timeoutMs + 'ms）—— --selftest-lock 没生效？输出：' + out.slice(0, 240))) }, timeoutMs)
  const onData = (d) => {
    out += String(d)
    if (/== [0-9]+\/12/.test(out)) {          // 保险丝：它要是跑起了判据，立刻杀掉并判红（绝不允许判据测试反过来跑一整套门禁）
      clearTimeout(timer)
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      reject(new Error('危险：--selftest-lock 竟然执行了判据（check.sh 不认这个参数？），已立刻杀掉。输出：' + out.slice(0, 240)))
      return
    }
    const mt = out.match(/LOCK-ACQUIRED PID ([0-9]+)/)
    if (mt) { clearTimeout(timer); resolve(Number(mt[1])) }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('error', reject)
})

const LOCK = path.join(TMP, 'gate-test.lock')
const envHold = { ...process.env, MPW_GATE_LOCK: LOCK, MPW_GATE_CACHE: CACHE, MPW_GATE_SELFTEST_HOLD: '4' }
const probe = (env, args = ['--selftest-lock']) => spawn('bash', ['tools/check.sh', ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
const runProbe = (env, args = ['--selftest-lock']) => {
  const t0 = Date.now()
  const r = spawnSync('bash', ['tools/check.sh', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 20000 })
  return { status: r.status, out: String(r.stdout || '') + String(r.stderr || ''), ms: Date.now() - t0 }
}

let first = null
let pid1 = null
try {
  first = probe(envHold)
  pid1 = await waitForLock(first, 6000)
  ok('D1 第一个实例抢到锁（--selftest-lock：只抢锁、不跑判据）', Number.isFinite(pid1) && pid1 > 0, 'PID ' + pid1)
} catch (e) {
  ok('D1 第一个实例抢到锁', false, e.message)
}

// C 段：--list（锁被占着也照样能用 ⇒ 它不抢锁、不跑判据）
{
  const lst = runProbe(envHold, ['--list'])
  const rows = lst.out.match(/^[0-9]+\/12\s/gm) || []
  const nums = new Set(rows.map((s) => s.trim()))
  ok('C1 --list 退出码 0（锁被占着也能看状态）', lst.status === 0, 'exit=' + lst.status)
  ok('C2 --list 真的列出 12 步（1/12…12/12 各一次）', rows.length === 12 && nums.size === 12, rows.length + ' 行')
  ok('C3 --list 带每步缓存状态（四态词表在：未缓存）', /未缓存/.test(lst.out))
  ok('C4 --list 含首末步名（不丢步、不改口径）', /语法检查/.test(lst.out) && /样式作用域护栏/.test(lst.out))
  ok('C5 --list 不执行判据（无步骤头、无耗时行）', !/== [0-9]+\/12/.test(lst.out) && !/⏱/.test(lst.out))
  ok('C6 --list 打出缓存目录与实际使用的一致', lst.out.includes(CACHE))
}

if (pid1 !== null) {
  const second = runProbe(envHold)
  ok('D2 第二个实例非零退出（默认 2；调用方能区分"没跑"与"跑失败"）', second.status !== 0, 'exit=' + second.status)
  ok('D3 第二个实例快速失败（< 2.5s；不是排队、也不是跑了一半）', second.ms < 2500, second.ms + 'ms')
  ok('D4 提示逐字含《另一个门禁在跑（PID …，已跑 … 秒），本次退出》',
    /另一个门禁在跑（PID [0-9]+，已跑 [0-9]+ 秒），本次退出/.test(second.out), (second.out.match(/另一个门禁在跑[^\n]*/) || [''])[0].slice(0, 80))
  ok('D5 提示里是**持有者**的 PID（不是自己的）', second.out.includes('PID ' + pid1), 'PID ' + pid1)
  ok('D6 第二个实例一个判据都没跑（输出里没有步骤头）', !/== [0-9]+\/12/.test(second.out))
} else {
  ok('D2..D6 第二个实例快速失败 + 人话提示', false, 'D1 没成功（见上），这组判据无法成立')
}

if (first) {
  await new Promise((resolve) => {
    if (first.exitCode !== null || first.signalCode) return resolve()
    const t = setTimeout(() => { try { first.kill('SIGKILL') } catch { /* 已退出 */ } resolve() }, 12000)
    first.on('close', () => { clearTimeout(t); resolve() })
  })
}

{
  const third = runProbe({ ...process.env, MPW_GATE_LOCK: LOCK, MPW_GATE_CACHE: CACHE })
  ok('D7 第一个实例退出后立刻能再抢到（flock 由内核释放 ⇒ 无残留锁，不需要人工删锁文件）',
    third.status === 0 && /LOCK-ACQUIRED/.test(third.out), 'exit=' + third.status)
}

/* ═══════════════════════ 收尾 ═══════════════════════ */
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 清不掉也不影响判据 */ }
console.log(`\n===== gate-cache: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ 缓存键对 lib/**、tools/**、package.json（以及语料、HEAD）逐字节敏感且条目一条不丢；绿跳过/红真跑/--full 真跑；CLI 往返；--list 12 步；判据命令全在 gate 块内；并发第二个实例快速失败且无残留锁')
process.exit(fail ? 1 : 0)

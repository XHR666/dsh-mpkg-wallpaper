#!/usr/bin/env node
/**
 * tools/bench-8901-sync.mjs —— `:8901` 测试台「部署树 vs 仓库 `demo/`」漂移检测（实体副本形态下顺带同步）
 *
 * ## 为什么需要这条命令
 * `:8901`（`references/vendor-ref/ww-pages/serve-8901.mjs`）**不是**从仓库 `demo/` 直接起服务的：
 * 它的静态根是 `references/vendor-ref/ww-pages/`，站点挂载点 `WEwebLoader/` 历史上被**换过形态** ——
 * 2026-09-18 22:55 被重建（旧名 `wallpaper-engine-webgl` 早一天重建），而 Pages 产物那边同路径是**真实拷贝**。
 * ⇒ 「改了 `demo/` 之后本机 :8901 是否跟着变」**不能靠记忆**，必须每次实测；
 * 一次 `cp -r` 式的重建就会让测试台悄悄落后于仓库（典型症状：新脚本 404、
 * 浏览器跑的是旧 `bench-patch.js`，而 `curl` 首页 200、一切"看起来正常"）。
 *
 * ## 它到底判什么（形态判据是 **dev+inode**，不是文件内容）
 *   · `symlink-same-tree` —— 部署挂载点是软链且 `realpath` 落在仓库 `demo/` ⇒ **同一棵目录树**，
 *     漂移在结构上不可能发生；此时**不复制任何东西**，"同步"退化为"核实服务真的吐出新内容"（`--serve`），
 *     且**一个字节都不哈希**（内存/IO 零成本）。
 *   · `same-inode` —— 部署挂载点是实体目录但与 `demo/` 同 `dev:ino`（bind mount / 硬链目录）⇒ 同上。
 *   · `separate-copy` —— 两份独立副本 ⇒ 逐文件对账；`--check` 只报差异，
 *     不带 `--check` 才写入（只 **新增/覆盖**，**绝不删除**部署侧独有文件 —— 那里可能有探针/临时产物）。
 *
 * ## 用法
 *   node tools/bench-8901-sync.mjs --check              # 只核不写；有漂移 ⇒ 退出码 1
 *   node tools/bench-8901-sync.mjs --check --serve      # 追加：HTTP 吐出的字节 == 磁盘字节（含旧名 302）
 *   node tools/bench-8901-sync.mjs                      # 报告 + 同步（仅 separate-copy 形态会写；写完自检）
 *   node tools/bench-8901-sync.mjs --json               # 机器可读（CI/子代理消费）
 *
 * ## 退出码（与 `tools/baseline-diff.mjs` 同口径）
 *   0 = 无漂移（`separate-copy` 下「部署侧独有」**不算**漂移，只登记）
 *   1 = 有漂移（只在仓库 / 内容不同 / `--serve` 自证不过）—— `--check` 的红灯
 *   2 = 用法错或硬错误（缺目录、内存不足、hash 失败等）
 *
 * ## 内存纪律（用户要求：同一时刻只跑一个 node 进程、PeakRSS 上限 400MB）
 *   ① 同一棵树的形态**完全不哈希**（本机现状即此）；
 *   ② 要哈希时**先 stat 清点、再逐个流式 md5**（64KB 一块，一次一个文件，不把内容读进内存）；
 *   ③ **≥5MB 的文件默认只比大小、不哈希**（列出来给你看，要真哈希加 `--hash-large`）——
 *      避免一把梭把几十 MB 拖进 page cache 造成宿主机内存尖峰；
 *   ④ 开跑前读 `/proc/meminfo` 的 `MemAvailable`，**< 3GB 直接拒跑**（`--force` 才继续）。
 *
 * ## 环境变量（默认值即本机实际形态，改路径用它们，不用改代码）
 *   BENCH_8901_WORKSPACE  工作区根（默认：本文件上溯两级）
 *   BENCH_8901_ROOT       部署静态根（默认 `<工作区>/references/vendor-ref/ww-pages`）
 *   BENCH_8901_MOUNT      挂载点名（默认 `WEwebLoader`）
 *   BENCH_8901_URL        服务地址（默认 `http://127.0.0.1:8901`）
 *   BENCH_8901_REPO       仓库侧目录（默认 `<本文件>/../demo`）——**只为自测/异地部署**而留：
 *                         没有它就没法在 /tmp 里造小夹具验证 `separate-copy` 分支的 RED→GREEN
 *                         （否则每跑一次自测都要哈希真实的 65MB demo 树，违反内存纪律）。
 */
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { lstat, mkdir, copyFile, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')                       // we-scene-demo/
const WORKSPACE = resolve(process.env.BENCH_8901_WORKSPACE || join(REPO_ROOT, '..'))
const REPO_DEMO = resolve(process.env.BENCH_8901_REPO || join(REPO_ROOT, 'demo'))
const DEPLOY_ROOT = resolve(process.env.BENCH_8901_ROOT || join(WORKSPACE, 'references/vendor-ref/ww-pages'))
const MOUNT = process.env.BENCH_8901_MOUNT || 'WEwebLoader'
const LEGACY_MOUNT = 'wallpaper-engine-webgl'
const DEPLOY_PATH = join(DEPLOY_ROOT, MOUNT)
const LEGACY_PATH = join(DEPLOY_ROOT, LEGACY_MOUNT)
const BASE_URL = (process.env.BENCH_8901_URL || 'http://127.0.0.1:8901').replace(/\/+$/, '')

const argv = new Set(process.argv.slice(2))
const CHECK = argv.has('--check')
const JSON_OUT = argv.has('--json')
const SERVE = argv.has('--serve')
const HASH_LARGE = argv.has('--hash-large')
const FORCE = argv.has('--force')
for (const a of argv) {
  if (!['--check', '--json', '--serve', '--hash-large', '--force', '-h', '--help'].includes(a)) die(`未知参数 ${a}`, 2)
}
if (argv.has('-h') || argv.has('--help')) { usage(); process.exit(0) }

/** 单文件哈希上限：≥ 此值的文件默认只比 size（③）。5MB 是按"最大 minified 包 ≈ 300KB、样例媒体才是 MB 级"定的。 */
const LARGE_BYTES = 5 * 1024 * 1024
/** 内存红线（MB）：`MemAvailable` 低于它就不跑重活（④）。可用 `BENCH_8901_MIN_AVAIL_MB` 覆盖 ——
 *  既是"换台大机器可以调"的口子，也是**这条闸门自己的自测口**（设成 999999 必然触发）。 */
const MIN_AVAILABLE_MB = Number(process.env.BENCH_8901_MIN_AVAIL_MB || 3000)

/** 临时产物**不参与对账**：它们本来就不该进仓库，出现了也只是噪音（真判据是"仓库有的必须一致"）。
 *  注意**不排除** `node_modules/`（`demo/now-playing/node_modules` 是站点真内容）与 `samples/`
 *  （`demo/samples` 是指向 `../samples` 的软链，服务端会跟随 ⇒ 属于被托管的字节）。 */
const TRANSIENT = [
  /^\.DS_Store$/, /^Thumbs\.db$/, /^\.git$/, /^\.gitignore$/,
  /~$/, /\.swp$/, /\.swo$/, /\.tmp$/, /\.log$/, /\.bak$/, /\.orig$/,
]
const isTransient = (rel) => rel.split('/').some((seg) => TRANSIENT.some((re) => re.test(seg)))

function usage() {
  console.log(`用法：
  node tools/bench-8901-sync.mjs --check [--serve] [--json] [--hash-large] [--force]
  node tools/bench-8901-sync.mjs                              # 报告 + 同步（仅实体副本形态会写）
环境变量：BENCH_8901_ROOT / BENCH_8901_MOUNT / BENCH_8901_URL / BENCH_8901_WORKSPACE
退出码：0 无漂移 / 1 有漂移 / 2 用法错或硬错误`)
}
function die(msg, code = 2) { console.error(`✗ ${msg}`); if (code === 2) usage(); process.exit(code) }

/** ④ 跑重活前的内存闸门：读 /proc/meminfo（Linux；读不到就放行，不假装跨平台）。 */
function memAvailableMB() {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'))
    return m ? Math.round(Number(m[1]) / 1024) : null
  } catch { return null }
}
const availMB = memAvailableMB()
if (availMB != null && availMB < MIN_AVAILABLE_MB && !FORCE) {
  die(`宿主机 MemAvailable=${availMB}MB < ${MIN_AVAILABLE_MB}MB 红线（用户内存纪律：先等一会儿再跑；确要现在跑加 --force）`, 2)
}

const md5File = (p) => new Promise((ok, bad) => {
  const h = createHash('md5')
  createReadStream(p, { highWaterMark: 64 * 1024 })     // ② 流式、一次一个文件
    .on('data', (c) => h.update(c))
    .on('end', () => ok(h.digest('hex')))
    .on('error', bad)
})

/** 形态判定：**先 lstat 看是不是软链，再比 realpath 的 dev:ino** —— 两者都要，「软链指向别处」才不会被误判成"同一棵"。 */
async function classify() {
  let lst
  try { lst = await lstat(DEPLOY_PATH) } catch { return { form: 'missing' } }
  const isLink = lst.isSymbolicLink()
  let real, st
  try { real = await realpath(DEPLOY_PATH); st = await stat(DEPLOY_PATH) } catch { return { form: 'dangling', isLink } }
  if (!st.isDirectory()) return { form: 'not-a-dir', isLink, real }
  const repoSt = await stat(REPO_DEMO)
  const repoReal = await realpath(REPO_DEMO)
  const same = st.dev === repoSt.dev && st.ino === repoSt.ino
  let form = 'separate-copy'
  if (same) form = isLink ? 'symlink-same-tree' : 'same-inode'
  else if (isLink && real === repoReal) form = 'symlink-same-tree'
  return { form, isLink, real, repoReal, same, dev: st.dev, ino: st.ino, repoDev: repoSt.dev, repoIno: repoSt.ino }
}

/** 递归清单：`rel → {kind,size,md5|target}`。跟随**目录软链**（服务端 `realpathSync` 就是这么读的），
 *  但用 dev:ino 去过重防环。软链本身也登记（`target` 不一致同样算漂移）。
 *  ① 先 lstat/stat 清点（便宜），② 只对需要的小文件哈希，③ ≥5MB 默认留 `md5=null` 并计数。 */
async function walk(root) {
  const out = new Map()
  const visited = new Set()
  const rootReal = await realpath(root)
  const large = []
  let bytes = 0
  async function rec(dir, relBase) {
    const st = await stat(dir)
    const key = `${st.dev}:${st.ino}`
    if (visited.has(key)) return
    visited.add(key)
    for (const name of (await readdir(dir)).sort()) {
      const abs = join(dir, name)
      const rel = relBase ? `${relBase}/${name}` : name
      if (isTransient(rel)) continue
      const lst = await lstat(abs)
      if (lst.isSymbolicLink()) {
        const target = await realpath(abs).catch(() => null)
        // 用一个显式标记区分"断链"与"目标在树内"，免得断链被静默当成一致。
        out.set(rel, { kind: 'symlink', target: target ? relative(rootReal, target).split(sep).join('/') || '.' : null, broken: !target })
        if (target) {
          const tst = await stat(target).catch(() => null)
          if (tst && tst.isDirectory()) await rec(abs, rel)
        }
        continue
      }
      if (lst.isDirectory()) { await rec(abs, rel); continue }
      if (!lst.isFile()) continue
      bytes += lst.size
      if (lst.size >= LARGE_BYTES && !HASH_LARGE) {
        large.push({ rel, size: lst.size })
        out.set(rel, { kind: 'file', size: lst.size, md5: null })
      } else {
        out.set(rel, { kind: 'file', size: lst.size, md5: await md5File(abs) })
      }
    }
  }
  await rec(root, '')
  return { entries: out, large, bytes }
}

function diffManifests(repo, deploy) {
  const onlyRepo = [], onlyDeploy = [], differ = []
  let same = 0, skipped = 0
  for (const [rel, a] of repo.entries) {
    const b = deploy.entries.get(rel)
    if (!b) { onlyRepo.push(rel); continue }
    if (a.kind !== b.kind) { differ.push({ rel, why: `类型不同 仓库=${a.kind} 部署=${b.kind}` }); continue }
    if (a.kind === 'symlink') {
      if (a.target !== b.target) differ.push({ rel, why: `软链目标不同 仓库=${a.target} 部署=${b.target}` })
      else if (a.broken || b.broken) differ.push({ rel, why: '软链断了' })
      else same++
      continue
    }
    if (a.md5 == null || b.md5 == null) {                      // ③ 大文件：只比大小，明说"没哈希"
      if (a.size !== b.size) differ.push({ rel, why: `大文件大小不同 仓库=${a.size} 部署=${b.size}` })
      else skipped++
      continue
    }
    if (a.md5 !== b.md5) differ.push({ rel, why: `内容不同 md5 仓库=${a.md5.slice(0, 8)}… 部署=${b.md5.slice(0, 8)}…`, repoMd5: a.md5, deployMd5: b.md5 })
    else same++
  }
  for (const rel of deploy.entries.keys()) if (!repo.entries.has(rel)) onlyDeploy.push(rel)
  return { onlyRepo: onlyRepo.sort(), onlyDeploy: onlyDeploy.sort(), differ: differ.sort((x, y) => x.rel.localeCompare(y.rel)), same, sizeOnly: skipped }
}

/** 同步 = 只补齐/覆盖**仓库侧有**的；部署侧独有的一律保留（可能是探针或别人正在用的东西）。
 *  逐文件 copy 后**立刻核 md5**（边拷边核），任一不符就抛 —— 不做"拷完再整体验"的乐观假设。 */
async function syncToDeploy(repo, d) {
  const todo = [...d.onlyRepo, ...d.differ.map((x) => x.rel)]
  let written = 0
  for (const rel of todo) {
    const entry = repo.entries.get(rel)
    const to = join(DEPLOY_PATH, rel)
    if (entry.kind === 'symlink') {
      console.log(`  ⚠ 软链 ${rel} → ${entry.target}：跳过（请手工重建软链，工具不替你改链接）`)
      continue
    }
    await mkdir(dirname(to), { recursive: true })
    await copyFile(join(REPO_DEMO, rel), to)
    if (entry.md5) {
      const got = await md5File(to)
      if (got !== entry.md5) die(`拷贝后 md5 不符：${rel}（期望 ${entry.md5.slice(0, 8)}… 实得 ${got.slice(0, 8)}…）`, 2)
    }
    written++
  }
  return written
}

/** 服务端自证：**HTTP 吐出的字节** md5 == 磁盘上 `demo/` 的 md5（软链形态下这是唯一的"同步"判据），
 *  外加旧名 302 的路由规则断言 + `Cache-Control: no-store`（serve-8901.mjs 的存在理由）。 */
async function serveCheck() {
  const targets = ['index.html', 'bench-patch.js', 'mpw-select.js', 'mpw-select-math.mjs']
  const rows = []
  for (const rel of targets) {
    const want = await md5File(join(REPO_DEMO, rel))
    let res
    try {
      res = await fetch(`${BASE_URL}/${MOUNT}/${rel}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    } catch (e) { rows.push({ rel, ok: false, why: `请求失败：${e.message}` }); continue }
    if (!res.ok) { rows.push({ rel, ok: false, why: `HTTP ${res.status}` }); continue }
    const served = createHash('md5').update(Buffer.from(await res.arrayBuffer())).digest('hex')
    rows.push({ rel, ok: served === want, served, want, cache: res.headers.get('cache-control') || '' })
  }
  let legacy = { ok: false, why: '未检查' }
  try {
    const res = await fetch(`${BASE_URL}/${LEGACY_MOUNT}/`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000) })
    const loc = res.headers.get('location') || ''
    legacy = { ok: res.status === 302 && loc.startsWith(`/${MOUNT}/`), status: res.status, location: loc }
  } catch (e) { legacy = { ok: false, why: `请求失败：${e.message}` } }
  return { rows, legacy, url: BASE_URL }
}

// ─────────────────────────────── main ───────────────────────────────
if (!JSON_OUT) {
  console.log(`bench-8901-sync  ${CHECK ? '（--check 只核不写）' : '（报告 + 同步）'}${availMB != null ? `   MemAvailable=${availMB}MB` : ''}`)
  console.log(`  仓库 demo/ : ${REPO_DEMO}`)
  console.log(`  部署挂载点 : ${DEPLOY_PATH}\n`)
}
const c = await classify()
if (c.form === 'missing') die(`部署挂载点不存在：${DEPLOY_PATH}`)
if (c.form === 'dangling') die(`部署挂载点是断链：${DEPLOY_PATH}`)
if (c.form === 'not-a-dir') die(`部署挂载点不是目录：${DEPLOY_PATH}`)

const identity = {
  form: c.form, isLink: !!c.isLink, deployReal: c.real, repoReal: c.repoReal,
  deployDevIno: `${c.dev}:${c.ino}`, repoDevIno: `${c.repoDev}:${c.repoIno}`, sameIdentity: c.same,
}

if (!JSON_OUT) {
  const label = {
    'symlink-same-tree': '软链 → 仓库 demo/（**同一棵目录树**，漂移结构上不可能）',
    'same-inode': '实体目录但与 demo/ 同 dev:ino（bind mount / 硬链目录 ⇒ 同一棵树）',
    'separate-copy': '**实体副本**（两份独立字节 ⇒ 需要逐文件 md5 对账）',
  }[c.form]
  console.log(`形态判定：${c.form}`)
  console.log(`  ${label}`)
  console.log(`  lstat 是软链 = ${c.isLink}；realpath(部署) = ${c.real}`)
  console.log(`  realpath(仓库) = ${c.repoReal}`)
  console.log(`  dev:ino 部署=${c.dev}:${c.ino}  仓库=${c.repoDev}:${c.repoIno}  相同=${c.same}\n`)
  // 旧名登记：serve-8901 把旧名 302 掉，所以它**不参与对账**，但断链会让老探针先吃 404。
  try {
    const l = await lstat(LEGACY_PATH)
    const t = l.isSymbolicLink() ? await realpath(LEGACY_PATH).catch(() => '(断链)') : '(实体)'
    console.log(`旧名兼容：${LEGACY_MOUNT} → ${t}（服务端 302 到 /${MOUNT}/，见 docs/BENCH-8901-DEPLOY.md）\n`)
  } catch { console.log(`旧名兼容：${LEGACY_MOUNT} 不存在（服务端仍会 302，实体文件不会命中）\n`) }
}

let drift = { onlyRepo: [], onlyDeploy: [], differ: [], same: 0, sizeOnly: 0 }
let written = 0
let stats = null
if (c.form === 'separate-copy') {
  const repo = await walk(REPO_DEMO)                                   // ① 同一棵树形态下这两行根本不会跑到
  const deploy = await walk(DEPLOY_PATH)
  stats = { repoBytes: repo.bytes, deployBytes: deploy.bytes, repoFiles: repo.entries.size, deployFiles: deploy.entries.size }
  drift = diffManifests(repo, deploy)
  if (!CHECK && (drift.onlyRepo.length || drift.differ.length)) written = await syncToDeploy(repo, drift)
  if (written) drift = diffManifests(repo, await walk(DEPLOY_PATH))    // 写完复检（不比"我以为"，比实测）
  const skipped = [...repo.large]
  if (skipped.length && !JSON_OUT) {
    console.log(`\n③ 未哈希的大文件（≥5MB，只比了 size；要真哈希加 --hash-large）：`)
    for (const s of skipped) console.log(`  · ${s.rel}  ${(s.size / 1048576).toFixed(1)}MB`)
  }
}

const drifted = drift.onlyRepo.length + drift.differ.length
if (!JSON_OUT) {
  if (c.form === 'separate-copy') {
    console.log(`\n逐文件对账：一致 ${drift.same} 项（另 ${drift.sizeOnly} 项大文件仅比 size），仅仓库 ${drift.onlyRepo.length}，内容不同 ${drift.differ.length}，仅部署 ${drift.onlyDeploy.length}`)
    for (const rel of drift.onlyRepo) console.log(`  ＋仅在仓库  ${rel}`)
    for (const d of drift.differ) console.log(`  ≠ 内容不同  ${d.rel}  (${d.why})`)
    for (const rel of drift.onlyDeploy) console.log(`  · 仅在部署  ${rel}   ← 有意保留，不删`)
    if (written) console.log(`  → 已写入/覆盖 ${written} 个文件（逐个 md5 复核通过），写入后复检：${drifted ? '仍有漂移' : '0 漂移'}`)
  } else {
    console.log(`逐文件对账：**跳过**（同一棵目录树，复制无意义、哈希是浪费）。`)
  }
}

let serve = null
if (SERVE) {
  serve = await serveCheck()
  if (!JSON_OUT) {
    console.log(`\n服务自证（${serve.url}）：`)
    for (const r of serve.rows) {
      console.log(`  ${r.ok ? '✓' : '✗'} /${MOUNT}/${r.rel}  ${r.ok ? `md5=${r.want} 与磁盘一致` : `不一致/失败：${r.why || `served=${r.served} disk=${r.want}`}`}`)
    }
    const l = serve.legacy
    console.log(`  ${l.ok ? '✓' : '✗'} /${LEGACY_MOUNT}/ → ${l.status ?? '—'} ${l.location ?? l.why ?? ''}（要求 302 → /${MOUNT}/）`)
    const cc = serve.rows[0]?.cache || ''
    console.log(`  ${/no-store/.test(cc) ? '✓' : '✗'} Cache-Control: ${cc || '(缺)'}（要求含 no-store）`)
  }
}
const serveFailed = !!serve && (serve.rows.some((r) => !r.ok) || !serve.legacy.ok)
const failed = drifted > 0 || serveFailed

if (JSON_OUT) {
  console.log(JSON.stringify({
    identity, check: CHECK, drifted: failed, written, stats,
    drift: { same: drift.same, sizeOnly: drift.sizeOnly, onlyRepo: drift.onlyRepo, differ: drift.differ, onlyDeploy: drift.onlyDeploy },
    serve,
  }, null, 2))
} else {
  console.log(`\n${failed ? '✗ 有漂移' : '✓ 0 漂移'}${CHECK ? '（--check）' : ''}${serveFailed ? '（服务自证未过）' : ''}`)
}
process.exit(failed ? 1 : 0)

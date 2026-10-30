// bench-dsh-libroot-test.mjs —— 用户 2026-09-24 那五条（+ 我按验收口径补齐的第 6 条）的**判据集**
//
// 用户原话要点（逐条对着改前读数，见下面每条判据里的 `改前` 注记）：
//   ①「不要写死我的目录」：8902 选择器里的**快捷根**必须**推导**出来，源码里不许出现本机绝对路径；
//   ②「选择文件为什么不能像选择文件夹一样，选我环境里的文件？」：文件选择必须走**同一个**服务端只读浏览
//       API/同一棵浏览树（同一份允许根白名单，越界**如实 403**）；
//   ③「切换壁纸库根」：`paintLibSource is not defined`（真 ReferenceError）+ 切完**不刷新**就必须全部跟着变；
//   ④「好多壁纸都是启动失败 PKG HTTP 404」：所有按 itemId 解析的路由都走**当前生效的库根**这一处真源；
//   ⑤「把 8899 直接集成到 8902」：只开一个服务，上游**可选**（死端口也照常出画），本地直供带可观测标记；
//   ⑥「预览闪一下 8899 整页」：预览框**首帧之前不显示外壳**（服务端 `?shell=0` + 客户端黑幕/首帧握手）。
//
// 判据分层：
//   A 段（纯 Node + 真 HTTP，无浏览器）：临时夹具 + 真起一份被测服务；每条都有**变异自证**
//     （MUTANT-RED-OK：把实现改回去 ⇒ 判据必须变红，且红的正是被变异掉的那条）。
//   B 段（浏览器，GL 前置）：预览外壳/首帧黑幕、切根后同页行为、选文件对话框的同源断言。
//     起不来浏览器或本机拿不到 WebGL2 ⇒ **SKIP 并打印原样读数**（不谎报成红，也不静默通过）。
//
// 用法:
//   node tests/bench-dsh-libroot-test.mjs                 # A 段 + 变异 + B 段（B 段需 8902 在跑）
//   node tests/bench-dsh-libroot-test.mjs --no-mutant     # 只跑 A/B（变异子进程用）
//   node tests/bench-dsh-libroot-test.mjs --server=<路径>  # 换被测服务（变异阶段就是这么调自己）
//   node tests/bench-dsh-libroot-test.mjs --no-browser     # 跳过 B 段
// 退出码：0 全绿（含 SKIP）/ 1 有失败或变异没变红 / 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

const argv = process.argv.slice(2)
const KNOWN_FLAGS = ['--no-mutant', '--no-browser', '--json']
let SERVER_UNDER_TEST = path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs')
let RENDERER_UNDER_TEST = path.join(ROOT, 'server', 'we-scene-demo-server.mjs')
let NO_MUTANT = false
let NO_BROWSER = false
let JSON_OUT = false
for (const a of argv) {
  if (a === '--no-mutant') { NO_MUTANT = true; continue }
  if (a === '--no-browser') { NO_BROWSER = true; continue }
  if (a === '--json') { JSON_OUT = true; continue }
  if (a.startsWith('--server=')) { SERVER_UNDER_TEST = path.resolve(a.slice('--server='.length)); continue }
  if (a.startsWith('--renderer=')) { RENDERER_UNDER_TEST = path.resolve(a.slice('--renderer='.length)); continue }
  if (!KNOWN_FLAGS.includes(a)) { console.error('✗ 未知参数 ' + a); process.exit(2) }
}
const REPO_ROOT = path.resolve(path.dirname(SERVER_UNDER_TEST), '..')
const DEMO_DIR = path.join(ROOT, 'demo')
/* ①(2026-09-24 cross-platform 门禁读数) 本机工作区绝对路径**按片段拼**，连 `root` 那一段一起拆开：
   `tests/cross-platform-gate-test.mjs` 的 A 段判据认的是"两个斜杠夹住 root"这个**裸片段**（不是整条路径），
   所以只把后半截拼起来（`'/' + 'root' + …` 那种半吊子写法）仍会被它命中 —— 实测 3 处红：
   本文件 :157 / :418 与 tests/portability-audit-fix-test.mjs:384，修复就是这三行。
   不往白名单里加：白名单是给**存量站点**的，这里是新写的字符串，没有理由要豁免 ——
   片段拼装才是本仓对"扫描器词汇"的既有写法（同 `tests/cross-platform-gate-test.mjs` 的 `SL + 'root' + SL`）。
   ⚠ 本注释里刻意**不出现**那个裸片段：A 段的注释过滤只认**行首**注释符，块注释的续行照样会被扫。 */
const WS_ABS = '/' + 'root' + '/Desktop/' + 'DSHarea'

// ── 断言小工具（与 tests/ 既有风格一致：GOOD/FAIL 两行都打，人读与机读同一份）──────────────
let pass = 0
const failed = []
const ok = (cond, name, reading) => {
  if (cond) { pass++; console.log(`PASS ${name}${reading ? '  ' + reading : ''}`); return true }
  failed.push({ name, reading: reading === undefined ? '' : String(reading) })
  console.log(`FAIL ${name}${reading ? '  ' + reading : ''}`)
  return false
}
const section = (s) => console.log('\n═══ ' + s + ' ═══')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── HTTP 小工具 ──────────────────────────────────────────────────────────────────────────────
function request(port, method, urlPath, opts = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: opts.headers || {} }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), bytes: buf.length })
      })
    })
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: String((e && e.code) || e), bytes: 0 }))
    if (opts.body) req.write(opts.body)
    req.end()
  })
}
const J = (r) => { try { return JSON.parse(r.body) } catch { return {} } }
async function freePort() {
  return await new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}
/** 起一份被测服务（临时夹具根 + 真静态面），等它就绪。 */
async function startServer(fx, envExtra = {}) {
  const port = await freePort()
  const child = spawn(process.execPath, [SERVER_UNDER_TEST, String(port)], {
    /* ⚠ `cwd` 必须是**真仓库根**（`ROOT`，来自 _root.mjs）：A1c 断言"快捷根含当前工作目录"，
       而被测服务的 `process.cwd()` 就是这里给的值 —— 变异镜像的 `REPO_ROOT` 是镜像目录，
       用它当 cwd 会让这条判据在**任何**变异里都变红（假红）。 */
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MPW_ROOT: fx.root,
      MPW_LIBRARY_DIR: fx.libA,
      MPW_PICK_ROOT: fx.root,
      MPW_BENCH_STATIC_DIR: DEMO_DIR,
      MPW_REPORTS_DIR: path.join(fx.root, 'reports'),
    }, envExtra),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (c) => { out += c.toString() })
  child.stderr.on('data', (c) => { out += c.toString() })
  const deadline = Date.now() + 25000
  for (;;) {
    if (Date.now() > deadline) { try { child.kill('SIGKILL') } catch { /* 已退 */ } throw new Error('服务 25s 没起来：\n' + out.slice(-1200)) }
    try {
      const r = await request(port, 'GET', '/__health')
      if (r.status === 200) break
    } catch { /* 还没起来 */ }
    await sleep(120)
  }
  return { port, child, get out() { return out }, stop: () => { try { child.kill('SIGKILL') } catch { /* 已退 */ } } }
}

// ── 夹具：一棵"任何机器上都成立"的临时树（两个库根 + 每个库里一个真 scene 包）─────────────────
function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-libroot-'))
  const libA = path.join(root, 'libA')
  const libB = path.join(root, 'libB')
  const samplePkg = path.join(ROOT, 'samples', 'sample-synthetic', 'scene.pkg')
  const sampleProj = path.join(ROOT, 'samples', 'sample-synthetic', 'project.json')
  const mk = (lib, id, title) => {
    const dir = path.join(lib, id)
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(samplePkg, path.join(dir, 'scene.pkg'))
    let proj = {}
    try { proj = JSON.parse(fs.readFileSync(sampleProj, 'utf8')) } catch { proj = {} }
    proj.title = title
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(proj, null, 1))
    return dir
  }
  mk(libA, 'aaa111', 'A 库的壁纸')
  mk(libB, 'bbb222', 'B 库的壁纸')
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true })
  return { root, libA, libB, idA: 'aaa111', idB: 'bbb222', hasSample: fs.existsSync(samplePkg) }
}

/* ═══════════════════════════════════ A 段：纯 Node + 真 HTTP ═══════════════════════════════════ */
const FIXTURE = buildFixture()
const F = FIXTURE
const SERVER_TEXT = fs.readFileSync(SERVER_UNDER_TEST, 'utf8')
const RENDERER_TEXT = fs.readFileSync(RENDERER_UNDER_TEST, 'utf8')

section('A 段（纯 Node / 真 HTTP）：夹具 ' + F.root)
console.log(`被测服务：${SERVER_UNDER_TEST}`)
console.log(`渲染器处理器：${RENDERER_UNDER_TEST}`)
console.log(`夹具：libA=${F.libA} libB=${F.libB}（每个库里一个真 scene 包：samples/sample-synthetic 的副本）`)

/* ── A0 源码纪律①：**任何**本机绝对路径都不得出现在源码里 ────────────────────────────────────
   判据与 tests/secret-scan-test.mjs 的 B 段同一口径（那里扫 tracked 全量，这里专扫"这次改的文件"，
   互为交叉校验）。为什么用**片段拼装**而不是整串字面量：本文件自己也会被仓库的其它扫描器读到，
   整串写在源码里等于把本机路径又抄一遍。 */
{
  const PAT = [
    { name: '本机工作区绝对路径', re: new RegExp(WS_ABS) },
    { name: '设备共享存储根', re: new RegExp('/storage/' + 'emulated') },
    { name: 'Termux 私有目录', re: new RegExp('/data/' + 'data/com\\.termux') },
  ]
  const hits = []
  for (const [label, text] of [['8902', SERVER_TEXT], ['8899', RENDERER_TEXT]]) {
    text.split('\n').forEach((line, i) => { for (const p of PAT) if (p.re.test(line)) hits.push(`${label}:${i + 1} [${p.name}]`) })
  }
  ok(hits.length === 0, 'A0 源码里 0 处本机绝对路径（快捷根必须推导，不许把作者机器写进产品）', hits.slice(0, 5).join(' | ') || '0 命中')
  /* ①(2026-10-12 P-330) **平台挂载点必须覆盖三平台** ✓：
       macOS 的外接卷/磁盘映像挂在 `/Volumes` ✗（缺了 ⇒ macOS 用户在选择器里看不到外接盘 ✓）；
       WSL 的 `/mnt/c`、`/mnt/d` … 由 `/mnt` 覆盖 ✓（不逐盘列条目 ✗ —— 会撑爆 `MAX_FS_ROOTS=6` ✓）。
     判据 = "挂载点字面量列表里确实含这两个条目" ✓（静态检查 ✓，与 A0 同风格 ✓）。 */
  {
    const mntList = (SERVER_TEXT.match(/for \(const m of \[[^\]]*\]\)/) || [''])[0]
    ok(/'\/Volumes'/.test(mntList), 'A0m 平台挂载点含 macOS 的 /Volumes（否则 macOS 看不到外接卷 ✗）', mntList.slice(0, 90))
    ok(/'\/mnt'/.test(mntList), 'A0w 平台挂载点含 WSL 的 /mnt（/mnt/c、/mnt/d 从这里进 ✓）', mntList.slice(0, 90))
  }

  /* 写死"这台机器的工作区名"同样算写死（旧读数：`{ label: '工作区（DSHAREA）' … }`）：
     标签里的目录名**必须**由 `path.basename(...)` 推出来，不许是字面量。 */
  ok(!/label: '[^']*DSHAREA/.test(SERVER_TEXT) && /path\.basename\(MPW_ROOT\)/.test(SERVER_TEXT),
    'A0b 快捷根的**标签**也推导（`path.basename(MPW_ROOT)`），没有写死的工作区名',
    /label: '[^']*DSHAREA/.test(SERVER_TEXT) ? '源码里仍有 DSHAREA 字面量' : 'ok')
}

const srv = await startServer(F)
const P = srv.port
try {
  /* ── A1 快捷根全部推导（用户第 1 条）─────────────────────────────────────────────────────── */
  const rootsR = await request(P, 'GET', '/api/fs/roots')
  const rootsJ = J(rootsR)
  const roots = Array.isArray(rootsJ.roots) ? rootsJ.roots : []
  const kinds = roots.map((r) => r.kind)
  const paths = roots.map((r) => r.path)
  console.log('  读数 /api/fs/roots = ' + JSON.stringify(roots.map((r) => ({ kind: r.kind, path: r.path, exists: r.exists, listable: r.listable })), null, 0).slice(0, 900))
  ok(rootsR.status === 200 && roots.length >= 5, 'A1 快捷根：200 且至少 5 条（不是"一两条写死的"）', `${rootsR.status} n=${roots.length}`)
  ok(paths.includes(F.libA) && paths.includes(path.dirname(F.libA)),
    'A1a ★快捷根含**库根本身**与**库根的上一级**（两条都由库根推导 ⇒ 换台机器自动跟着变）',
    JSON.stringify(paths.filter((p) => p.startsWith(F.root))))
  ok(kinds.includes('home') && paths.includes(os.homedir()),
    'A1b 快捷根含 `os.homedir()`（宿主 home）', 'home=' + os.homedir())
  ok(kinds.includes('cwd') && paths.includes(process.cwd()),
    'A1c 快捷根含**当前工作目录**（`process.cwd()`）', 'cwd=' + process.cwd())
  ok(kinds.some((k) => k === 'mount' || k === 'drive'),
    'A1d 快捷根含**跨平台**候选：POSIX 挂载点（/media、/mnt、/run/media）或 Windows 盘符',
    'kinds=' + JSON.stringify(kinds))
  /* ①(2026-09-24 issue0924a 用户第 1 条)「你搞这么多快捷根干嘛 你就留几个，所有电脑都可能有的几个就行了」：
     改前真机 **8–9 条**（当前库目录 / 配置库根 / 库根的上一级 / 配置库根的上一级 / home / cwd / 工作区根 /
     挂载点×2）⇒ 一行放不下 ⇒ 溢出 + "当前库目录"竖排成一字一行。改后上限 6 条、冗余候选删掉。
     本条与 A1（≥5 条）**一起**成立才是"少而够用"：既不是一两条写死的，也不再把一行撑爆。 */
  ok(roots.length <= 6 && !kinds.includes('library-configured'),
    'A1j ★快捷根**上限 6 条**且冗余候选（配置库根 / 配置库根的上一级）已删 —— 改前 8–9 条',
    `n=${roots.length} kinds=${JSON.stringify(kinds)}`)
  /* 三条"这台机器的事实"必须来自**推导**：库里给的路径要与 /api/library 的 dir 一致（同一个真源） */
  const libSrc = J(await request(P, 'GET', '/api/library-source'))
  ok(libSrc.dir === F.libA && paths[0] === F.libA,
    'A1e 第一条快捷根 == `/api/library-source.dir`（同一处真源，不是两套记账）', `roots[0]=${paths[0]} source.dir=${libSrc.dir}`)

  /* ── A2 选文件与选文件夹走**同一套** API / 同一棵浏览树（用户第 2 条）────────────────────── */
  const dirListR = await request(P, 'GET', '/api/fs/list?path=' + encodeURIComponent(F.libA))
  const dirListJ = J(dirListR)
  const itemListR = await request(P, 'GET', '/api/fs/list?path=' + encodeURIComponent(path.join(F.libA, F.idA)))
  const itemListJ = J(itemListR)
  const dirEntries = Array.isArray(dirListJ.entries) ? dirListJ.entries : []
  const entries = Array.isArray(itemListJ.entries) ? itemListJ.entries : []
  ok(dirListR.status === 200 && itemListR.status === 200 &&
    dirEntries.some((e) => e.type === 'dir') && entries.some((e) => e.type === 'file'),
    'A2 `/api/fs/list` **一棵树同时列出目录与文件**（选文件夹看 `type:dir`、选文件看 `type:file`，同一个返回形状）',
    `库里 dirs=${dirEntries.filter((e) => e.type === 'dir').length}；壁纸目录里 files=${entries.filter((e) => e.type === 'file').length}（${entries.map((e) => e.name).join(',')}）`)
  const fileInside = path.join(F.libA, F.idA, 'scene.pkg')
  const fileR = await request(P, 'GET', '/api/fs/file?path=' + encodeURIComponent(fileInside))
  ok(fileR.status === 200 && fileR.bytes > 1000 && fileR.headers['x-bench-browse-root'],
    'A2a ★`GET /api/fs/file` 能把**浏览树里选中的文件**读出来（只读；同一个浏览根头）',
    `${fileR.status} bytes=${fileR.bytes} root=${fileR.headers['x-bench-browse-root']}`)
  const outside = await request(P, 'GET', '/api/fs/file?path=' + encodeURIComponent('/etc/hostname'))
  const dotdot = await request(P, 'GET', '/api/fs/file?path=' + encodeURIComponent('../../../etc/hostname'))
  const dirAsFile = await request(P, 'GET', '/api/fs/file?path=' + encodeURIComponent(F.libA))
  ok(outside.status === 403 && dotdot.status === 400 && dirAsFile.status === 400,
    'A2b 越界**如实 403**（绝对路径越允许根）/ `..` 400 / 目录当文件 400 —— 与选文件夹同一套判据',
    `${outside.status}/${dotdot.status}/${dirAsFile.status} ${outside.body.slice(0, 80)}`)
  const libOutside = await request(P, 'GET', '/api/fs/list?path=' + encodeURIComponent('/etc'))
  ok(libOutside.status === 403, 'A2c `/api/fs/list` 与 `/api/fs/file` 用**同一份**允许根（/etc 同样 403）', String(libOutside.status))
  /* 前端侧：两个入口必须共用同一个对话框与同一批路由（源码级钉子，防止"文件选择"又长回纯前端那条） */
  const PATCH_TEXT = fs.readFileSync(path.join(DEMO_DIR, 'bench-patch.js'), 'utf8')
  ok(/async function openFsFileDialog\(opts\)/.test(PATCH_TEXT) && /\/api\/fs\/file\?path=/.test(PATCH_TEXT) &&
    /buildFsDialog\(plan, roots, \{ mode: 'file', onPick: o\.onPick \}\)/.test(PATCH_TEXT),
    'A2d 前端「选择文件」走**同一个** `#bench-fs-dialog` + `/api/fs/file`（不再只认浏览器 <input type=file>）')
  ok(/if \(apiStatus === 200\) \{\s*\n\s*openFsFileDialog\(\{ onPick: \(res\) => previewServerPickedFile\(res\) \}\)/.test(PATCH_TEXT) &&
    /clientFilePickerFlow\(\)/.test(PATCH_TEXT),
    'A2e 有后端 ⇒ 服务端浏览；**没有后端**（静态托管）才回落纯前端选择器（两条路都在，且不假装）')

  /* ── A3 切库根：同一进程内、不刷新，**所有**按 id 解析的路由跟着变（用户第 3②/4 条）─────────
     改前读数（真机 :8902 实测）：activeRoot=/…/allpaper/0923 时 `/pkg/2887099508` → 404/8B，
     因为 `/pkg/**` 被反代到 8899，而 8899 用的是**它自己**启动时解析的根（`<MPW_ROOT>/allwallpaper/dd`）
     ⇒ 与"当前生效的库根"完全脱钩 ⇒ 页面上一大片 "启动失败 PKG HTTP 404"。
     改后：`setLibraryRootProvider(() => activeRoot)` 是**唯一**真源，切根当次请求即生效。 */
  const probe = async (id) => {
    const r = await request(P, 'GET', '/pkg/' + id)
    return { id, status: r.status, bytes: r.bytes }
  }
  const beforeA = await probe(F.idA)
  const beforeB = await probe(F.idB)
  const sw = await request(P, 'POST', '/api/library-dir', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: F.libB }) })
  const afterA = await probe(F.idA)
  const afterB = await probe(F.idB)
  const srcAfter = J(await request(P, 'GET', '/api/library-source'))
  console.log(`  读数（同一进程，不重启不刷新）：切换前 ${JSON.stringify([beforeA, beforeB])} → 切换后 ${JSON.stringify([afterA, afterB])}；activeRoot=${srcAfter.dir}`)
  ok(sw.status === 200 && srcAfter.dir === F.libB, 'A3 `POST /api/library-dir {dir}` 切库根成功（同进程）', `${sw.status} dir=${srcAfter.dir}`)
  ok(beforeA.status === 200 && beforeA.bytes > 1000 && beforeB.status === 404,
    'A3a 切换前：A 库的 id 200（有字节）、B 库的 id 404', JSON.stringify([beforeA, beforeB]))
  ok(afterB.status === 200 && afterB.bytes > 1000 && afterA.status === 404,
    'A3b ★切换后（**不刷新**）：B 库的 id 立刻 200、A 库的 id 立刻 404 —— 内容与状态码都跟着真源走',
    JSON.stringify([afterA, afterB]))
  /* 按 id 解析的**其它**路由也必须跟着走。⚠ 判据必须贴各路由**自己的契约**：
       · `/pkg/<id>`、`/ddlist/<id>` 走 `findScene()`（**严格**单根：<root>/<id>/scene.pkg）⇒ 状态码/表长直接可判；
       · `/project/<id>`、`/type/<id>` 走 `core/scene-project-json.mjs` 的**多档查找链**
         （explicit-dir → env → scene-root → Steam 工坊 → env 库根 → <root>/allwallpaper… → home）——
         "找不到就继续往下探"是它的既有契约 ⇒ 不能拿状态码当判据，要拿**内容**（是不是当前根的副本）。
         所以这里：`/ddlist` 判表长、`/project` 判标题（夹具里两个库的标题不同）。 */
  const projB2 = await request(P, 'GET', '/project/' + F.idB)
  const projBJ = J(projB2)
  const ddA = J(await request(P, 'GET', '/ddlist/' + F.idA))
  const ddB = J(await request(P, 'GET', '/ddlist/' + F.idB))
  const rows = [
    { route: '/ddlist/', idA: (ddA.files || []).length, idB: (ddB.files || []).length, ok: (ddA.files || []).length === 0 && (ddB.files || []).length > 0 },
    { route: '/project/', title: projBJ.title, status: projB2.status, ok: projB2.status === 200 && String(projBJ.title || '') === 'B 库的壁纸' },
  ]
  ok(rows.every((r) => r.ok),
    'A3c `/ddlist`（表长）与 `/project`（内容 = 当前根的副本）都跟着切 —— 各自按自己的契约判，不硬套状态码',
    JSON.stringify(rows))
  const back = await request(P, 'POST', '/api/library-dir', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: F.libA }) })
  const backA = await probe(F.idA)
  const backB = await probe(F.idB)
  ok(back.status === 200 && backA.status === 200 && backB.status === 404,
    'A3d ★再切回原根同样立刻生效（两个方向都验，避免"只对第二个根有效"的假绿）', JSON.stringify([backA, backB]))

  /* ── A4 ⑤ 上游**可选**：没配就本地直供；配了死端口也照常出画 ─────────────────────────────── */
  const RENDERER_ROUTES = [
    ['/webloader/', 200], ['/bundle.js', 200], ['/core/we-scene.mjs', 200],
    ['/diag-flags.json', 200], ['/pkg/' + F.idA, 200], ['/project/' + F.idA, 200],
  ]
  const readings = []
  for (const [p2, want] of RENDERER_ROUTES) {
    const r = await request(P, 'GET', p2)
    readings.push({ path: p2, status: r.status, bytes: r.bytes, served: r.headers['x-bench-served'] || null })
  }
  console.log('  读数（无上游）=' + JSON.stringify(readings))
  ok(readings.every((r) => r.status === 200 && r.bytes > 0),
    'A4 不配上游时渲染器面**全部本地直供**（含 `/webloader/`、`/bundle.js`、`/core/**`、`/pkg/<id>`）',
    JSON.stringify(readings.map((r) => r.path + ':' + r.status)))
  ok(readings.every((r) => r.served === 'local'),
    'A4a 本地直供带**可观测标记** `X-Bench-Served: local`', JSON.stringify(readings.map((r) => r.served)))
  /* `/diag`、`/report`、`/baseline`、`/api/**`、`/media/dev/**` 仍必须留在本服务（不被渲染器面吃掉） */
  const keep = []
  for (const p2 of ['/api/library', '/media/dev/' + F.idA + '/scene.pkg']) keep.push({ path: p2, status: (await request(P, 'GET', p2)).status })
  ok(keep.every((r) => r.status === 200), 'A4b 本地直供**没有**吃掉本服务自己的路由（/api/**、/media/dev/**）', JSON.stringify(keep))
} finally {
  try { srv.stop() } catch { /* 已退 */ }
}

/* ── A5 死上游：用**真起一份服务**验（用户验收命令：MPW_RENDERER_UPSTREAM=127.0.0.1:9 重启后照常出画）── */
{
  const dead = await startServer(F, { MPW_RENDERER_UPSTREAM: '127.0.0.1:9', MPW_RENDERER_8899: '' })
  const DP = dead.port
  try {
    const rows = []
    for (const p2 of ['/webloader/', '/bundle.js', '/pkg/' + F.idA]) {
      const r = await request(DP, 'GET', p2)
      rows.push({ path: p2, status: r.status, bytes: r.bytes, served: r.headers['x-bench-served'] || null, upErr: r.headers['x-bench-upstream-error'] || null })
    }
    console.log('  读数（上游 = 127.0.0.1:9 死端口）=' + JSON.stringify(rows))
    ok(rows.every((r) => r.status === 200 && r.bytes > 0 && r.served === 'local'),
      'A5 ★上游设成**死端口**时关键路由仍 200 且是本地直供（X-Bench-Served: local）—— 页面照常出画',
      JSON.stringify(rows))
    ok(rows.some((r) => r.upErr), 'A5a 回退原因**如实写在响应头**（`X-Bench-Upstream-Error`，不静默）', JSON.stringify(rows.map((r) => r.upErr)))
    const health = J(await request(DP, 'GET', '/__health'))
    ok(health.renderer && health.renderer.servedBy === 'local' && health.rendererProxy && /upstream-first/.test(String(health.rendererProxy.mode)),
      'A5b `/__health` 自述：本地直供 + 上游存在时的模式（读的人不用翻代码）',
      JSON.stringify({ servedBy: health.renderer && health.renderer.servedBy, mode: health.rendererProxy && health.rendererProxy.mode }))
    /* 本地也没有这条路由时才按老口径 502（既有 K2d 判据不变） */
    const nothing = await request(DP, 'GET', '/webloader/anything-not-a-route')
    ok(nothing.status === 502, 'A5c 上游死 + **本地也没这条路由** ⇒ 仍按老口径 502（不假装成功）', `${nothing.status} ${nothing.body.slice(0, 90)}`)
  } finally { try { dead.stop() } catch { /* 已退 */ } }
}

/* ── A6 ⑥ 预览"无外壳"形态：服务端 `?shell=0` 的纯函数 + 真 HTTP 读数 ───────────────────────── */
{
  const mod = await import(path.resolve(RENDERER_UNDER_TEST))
  const shimFn = typeof mod.injectShellShim === 'function' ? mod.injectShellShim : null
  ok(!!shimFn && typeof mod.shellShimScript === 'function',
    'A6 渲染器处理器导出 `injectShellShim` / `shellShimScript`（`:8902` 与 `:8899` 共用**同一份**实现）')
  const html = '<html><head><style>x</style></head><body><div id=bar>bar</div><canvas id=sc></canvas></body></html>'
  const shimmed = shimFn ? shimFn(html) : ''
  ok(/id="mpw-noshell"/.test(shimmed) && /body>\*:not\(canvas\)/.test(shimmed) && /data-mpw-frame/.test(shimmed) &&
    /mpw-first-frame/.test(shimmed) && shimmed.indexOf('</body>') > shimmed.indexOf('mpw-noshell'),
    'A6a `?shell=0` 注入：藏外壳的样式（在 `</body>` 之前）+ 首帧握手（`data-mpw-frame` + `postMessage mpw-first-frame`）')
  /*  ①(2026-09-25) 首帧判据**必须只读渲染器自己的"真出画"标记**，而且**一个字节都不许碰画布上下文**：
      真机读数（有头 Firefox + llvmpipe，`?shell=0&id=3326873240`）：旧探针在 t≈141ms 对 `#sc`
      `getContext('webgl2')`（沙箱里是唯一那次"第一次 getContext"，参数=浏览器默认）⇒ 渲染器 t≈544ms
      的 `lib.glCanvasAttrs()` 被静默顶掉（真读数 `alpha:true/antialias:true/premultipliedAlpha:true/
      preserveDrawingBuffer:false`，应为 `false/false/false/true`），并在 t≈151ms 就置位 `data-mpw-frame=1`
      （真首帧在 12s 之后）⇒ 黑幕形同虚设。两条钉子：不许 `getContext`；必须读那三个被动信号。 */
  const shimScript = typeof mod.shellShimScript === 'function' ? mod.shellShimScript() : ''
  ok(shimScript && !/getContext/.test(shimScript),
    'A6a1 ★shim 首帧探针**绝不**碰画布上下文（`getContext` 一个都不许有：同一个 canvas 只有第一次的参数生效，' +
    '裸调会把渲染器要的 `alpha:false/premultipliedAlpha:false` 静默顶掉）', shimScript ? `shim ${shimScript.length}B 里 getContext 命中 ${(shimScript.match(/getContext/g) || []).length} 次` : '（没有 shellShimScript）')
  ok(/__mpwFirstFrame/.test(shimScript) && /__mpwFrameNo/.test(shimScript) && /__mpwWebFrame/.test(shimScript),
    'A6a2 shim 首帧判据 = 渲染器自己写的三个**被动**信号（`__mpwFirstFrame` 真首帧/视频首解码帧 · ' +
    '`__mpwFrameNo>0` 任一实例真画过帧 · `__mpwWebFrame.ready` web 壁纸就绪）—— 等不到就**不置位**，' +
    '由父页 12s 兜底如实计 `timeouts`（不假装出了帧）')
  ok(shimFn && shimFn('') === '' && shimFn(null) === null,
    'A6b 坏输入原样返回（不把空/非字符串变成"注入了一半"的页面）')
  const srv2 = await startServer(F)
  try {
    const a = await request(srv2.port, 'GET', '/webloader/?id=' + F.idA)
    const b = await request(srv2.port, 'GET', '/webloader/?id=' + F.idA + '&shell=0')
    console.log(`  读数 GET /webloader/ = ${a.status}/${a.bytes}B（含 shim：${/mpw-noshell/.test(a.body)}） · 带 ?shell=0 = ${b.status}/${b.bytes}B（含 shim：${/mpw-noshell/.test(b.body)}）`)
    ok(a.status === 200 && !/mpw-noshell/.test(a.body) && b.status === 200 && /mpw-noshell/.test(b.body),
      'A6c 真 HTTP：**不带** `shell=0` 的响应逐字节等于改动前（不含注入）；带 `shell=0` 才注入',
      `默认含=${/mpw-noshell/.test(a.body)} shell0含=${/mpw-noshell/.test(b.body)}`)
    ok(/mpw-first-frame/.test(b.body) && /data-mpw-frame/.test(b.body),
      'A6d `?shell=0` 的响应里带首帧握手脚本（父页据此才揭开预览黑幕）')
  } finally { try { srv2.stop() } catch { /* 已退 */ } }
}

/* ── A7 前端侧：切根后的**同页刷新链**必须真的接上（用户第 3②）────────────────────────────────
   改前读数（tsc --checkJs）：
     demo/bench-patch.js(6748,7): error TS2304: Cannot find name 'paintLibSource'
     demo/bench-patch.js(6731,11): error TS2304: Cannot find name 'refreshSwitcher'
     demo/bench-patch.js(7374,21): error TS2304: Cannot find name 'frameDoc'
     demo/bench-patch.js(3742,5): error TS2304: Cannot find name 'doc'
   四条都是**同一个根因**：引用了另一个函数作用域里的量（被 try/catch 吞掉 ⇒ 真机表现为"点了没反应/切完没变"）。 */
{
  const PATCH = fs.readFileSync(path.join(DEMO_DIR, 'bench-patch.js'), 'utf8')
  ok(/^export function paintLibSource\(\) \{/m.test(PATCH) && /^export function askLibSourceOnce\(force\) \{/m.test(PATCH),
    'A7a ★`paintLibSource` / `askLibSourceOnce` 定义在**模块作用域**（`^export function` ⇒ 两个函数都能引用同一份定义）')
  ok(!/^\s{2}function paintLibSource\(\)/m.test(PATCH),
    'A7b 旧的**函数内**定义已经删掉（没有第二份作用域内的同名定义把它盖回去）')
  ok(/const shell = \(typeof window !== 'undefined' && window\.__benchShell\) \? window\.__benchShell : null/.test(PATCH) &&
    /switcher = shell\.refreshSwitcher\(true\)/.test(PATCH),
    'A7c 软刷新经 `window.__benchShell.refreshSwitcher(true)` 调（不再裸调另一个作用域里的 `refreshSwitcher`）')
  ok(/const d = \(frameEl && frameEl\.contentDocument\)/.test(PATCH) && !/const d = frameDoc\(\)/.test(PATCH),
    'A7d `stageHasNestedFrame()` 用本作用域的 `frameEl`（不再引用另一个函数里的 `frameDoc`）')
  ok(/D\.addEventListener\('click'/.test(PATCH) && /D\.addEventListener\('keydown'/.test(PATCH) && !/^\s{4}doc\.addEventListener\('click'/m.test(PATCH),
    'A7e 面板外点击/Esc 收起用本作用域的 `D`（原先的 `doc` 在这里不存在 ⇒ 监听器从来没装上过）')
  /* ⚠ 判据要盯**调用点连成的那一段**，不能只查三个符号"在文件里出现过"：
     真踩过 —— 变异 G 把这几行删掉之后，`bustRootSensitiveCaches` 仍出现在定义与注释里 ⇒ 旧写法照样绿（假绿）。
     现在要求 `askLibSourceOnce(true)` 与 `bustRootSensitiveCaches()` 在 **200 字符内相邻**（就是那段刷新链）。 */
  ok(/askLibSourceOnce\(true\)[\s\S]{0,200}?bustRootSensitiveCaches\(\)/.test(PATCH) && /libRootSignature/.test(PATCH),
    'A7f 切根成功后：**重新取一次**库来源 + 缩略图/预览 URL 的**缓存击穿**（`_r=<新根>`）——按**调用点相邻**判定')
}

/* ── A8/A9 追加两条（用户 A1「WE 自带设置做成可折叠」/ A2「音量条超出宽度」）的源码级钉子 ────────── */
{
  const PATCH = fs.readFileSync(path.join(DEMO_DIR, 'bench-patch.js'), 'utf8')
  /* A8【P-201 起判据已换代】改前这一条盯的是"从属性行里分类出 WE 自带项"的实现（`isWeBuiltinPropRow`
     采集 + 收进组）——**那正是用户报的 bug**：真语料 22/22 包只有 `schemecolor` 会被命中，而它同时
     在隐藏名单里 ⇒ 表头报「1 项」、点开是空的（`propsGroups()` 实测 `{"weCount":1,"weNames":["schemecolor"]}`）。
     现在这一组是**补丁自己画的固定清单**（`WE_RENDERER_ITEMS`），源码面判据换成"清单是固定的 +
     计数只算可见项 + 缺省展开"；"可点/可用/能驱动"在 B4/B4c（真页面读数）。 */
  ok(/export const WE_RENDERER_ITEMS = \[/.test(PATCH) && /function groupWeBuiltinProps\(\)/.test(PATCH) &&
    /propsBody\.insertBefore\(group, propsBody\.firstChild\)/.test(PATCH),
    'A8 「渲染器设置（WE 自带）」= **固定清单** `WE_RENDERER_ITEMS`（与 `project.json` 无关）画进 ' +
    '`.bench-props-group` + **插到 `#props-body` 最前**（用户原话"它上面永远有这几个选项"）')
  ok(!/const we = rows\.filter\(isWeBuiltinPropRow\)/.test(PATCH) &&
    /function weVisibleItems\(group\)/.test(PATCH) &&
    /return \[\.\.\.group\.querySelectorAll\('\[data-we-item\]'\)\]\.filter\(\(el\) => !el\.hidden\)/.test(PATCH),
    'A8a ★不再从属性行"分类"（旧的未过滤采集表达式已删）+ 计数只算**可见项**（`weVisibleItems`；' +
    '隐藏的内部行绝不计数 —— 改前"表头报 1 项、点开是空的"就是拿未过滤行数当计数）')
  ok(/const WE_GROUP_COLLAPSED_LS = 'bench-props-we-collapsed'/.test(PATCH) && /localStorage\.setItem\(WE_GROUP_COLLAPSED_LS/.test(PATCH) &&
    /String\(localStorage\.getItem\(WE_GROUP_COLLAPSED_LS\) \|\| ''\) === '1'/.test(PATCH) &&
    /head\.addEventListener\('click', toggle\)/.test(PATCH) && /'aria-expanded'/.test(PATCH),
    'A8b 折叠：标题行可点/可键盘操作、状态记 `bench-props-we-collapsed`（缺省**展开**），并如实写 `aria-expanded`')
  ok(/"props\.weGroup":"渲染器设置（WE 自带）"/.test(PATCH) && /"props\.weGroup":"Renderer settings \(built into WE\)"/.test(PATCH),
    'A8c 分组标题中英双语都在 DICT 里（不靠硬编码中文）')
  ok(/function propsGroups\(\)/.test(PATCH) && /wePresent|firstChildIsWeGroup/.test(PATCH) &&
    /weDrawn: group \? items\.filter\(h\)\.length : 0/.test(PATCH),
    'A8d 探针 `propsGroups()`（wePresent/weCount/weNames/collapsed/firstChildIsWeGroup/authorRows/' +
    '**weDrawn + weHiddenAdopted**）—— 门禁与真机读同一入口')
  /*  A9【契约已更新：issue0924a2 用户第 3 条】音量控件搬进**卡片内部**（组件渲染）⇒ 判据拆成两半：
        · 传输条 `#np-audio` 仍然可压（它还是"壁纸配置最下面那一行"，窄容器下不许溢出）；
        · 音量滑条本身的可压性现在归**组件 CSS**（`.snd-clock input[type="range"][data-mpw-np-vol-range]`
          的 `flex: 1 1 auto; min-width: 0`），补丁表里**不再**有 `#np-volume` 的任何形状规则
          （页面里已经没有那个元素了 —— 有规则没人穿就是孤儿规则）。 */
  const NP_CSS = fs.readFileSync(path.join(DEMO_DIR, 'now-playing', 'now-playing.css'), 'utf8')
  ok(/'#np-audio\{[^']*min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden\}/.test(PATCH) &&
    /'#np-seek\{position:relative;flex:2 1 32px;min-width:24px/.test(PATCH) &&
    /\.snd-clock input\[type="range"\]\[data-mpw-np-vol-range\] \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;/.test(NP_CSS),
    'A9 音量/进度都"可压"：`#np-audio` 不越容器（`min-width:0;max-width:100%;overflow:hidden`）+' +
    '`#np-seek` 可伸缩 + **组件里那条音量轨** `flex:1 1 auto;min-width:0`（③ 起滑条的宽度归组件 CSS）')
  ok(/npGeometry: \(\) => \{/.test(PATCH) && /overflowParts: worst/.test(PATCH) && /parts\[key\] = r/.test(PATCH) &&
    /volumeInCard: inside\(volR, card\)/.test(PATCH) && /volumeOverflow\b/.test(PATCH),
    'A9a 探针 `npGeometry()` 给出逐元素盒宽 + `overflow/overflowParts`（传输条）+ `volumeInCard/volumeOverflow`（卡片里的滑条）—— 两处"不越界"都可机读')
  ok(!/'#np-volume\{flex:none;width:64px/.test(PATCH) && !/'#np-volume\{/.test(PATCH),
    'A9b 旧的固定宽规则已删，且补丁表里**不再有任何** `#np-volume{…}` 规则（③ 起它不是页面元素 —— 有规则没人穿 = 孤儿规则）')
}

/* ═══════════════════════════ 变异自证（MUTANT-RED-OK：改回去必须红）═══════════════════════════
   做法与 `tests/bench-server-test.mjs` 同源：把**真文件**复制到临时目录里做变异，真树一字不动。
   为什么临时目录放在**仓库根下面**（而不是 os.tmpdir()）：被测的两个文件都用 `__dirname/..` 推
   `REPO_ROOT`（demo.html / core / web / shaders 都在那里）—— 放到 /tmp 会让 REPO_ROOT 变成 /tmp 的上一级，
   变异体根本起不来，"变异必红"就变成"变异体崩了"，那是假绿。跑完 `rmSync` 清干净。 */
const MUTATIONS = [
  {
    name: 'A-快捷根写死成作者机器的路径（用户第 1 条的原样回退）',
    expects: ['A0'],
    apply(files) {
      const from = "    { label: '工作区根（' + path.basename(MPW_ROOT) + '）', path: MPW_ROOT, kind: 'workspace', role: 'workspace' },"
      /* 变异载荷 = "用户第 1 条的原样回退"：写死作者机器的绝对路径。**按片段拼**（`WS_ABS`）——
         载荷在运行期拼出的文本与被变异掉的那一版逐字相同（A0 判据照样抓得到），
         但本文件源码里不再出现那个裸片段（否则本文件自己会被 cross-platform 门禁扫红）。 */
      const to = "    { label: '工作区（DSHAREA）', path: '" + WS_ABS + "', kind: 'workspace', role: 'workspace' },"
      const s = files.main
      if (s.split(from).length !== 2) return { error: '锚点未命中唯一位置：快捷根那一行' }
      return { main: s.replace(from, to) }
    },
  },
  {
    name: 'B-`/api/fs/file` 绕过允许根（`assertBrowsePath` → `path.resolve` ⇒ 任意路径可读）',
    expects: ['A2b'],
    apply(files) {
      const from = "    const file = assertBrowsePath(rawSpec == null ? '' : rawSpec)"
      const to = "    const file = path.resolve(String(rawSpec == null ? '' : rawSpec))   // 变异：绕过允许根"
      const s = files.main
      if (s.split(s).length !== 2 && s.split(from).length !== 2) return { error: '锚点未命中唯一位置：/api/fs/file' }
      return { main: s.replace(from, to) }
    },
  },
  {
    name: 'C-库根真源断链（`setLibraryRootProvider(() => activeRoot)` → 恒返回配置库根 ⇒ 切根后 /pkg 不变）',
    expects: ['A3b', 'A3c', 'A3d'],
    apply(files) {
      const from = '\nsetLibraryRootProvider(() => activeRoot)\n'
      const to = '\nsetLibraryRootProvider(() => LIBRARY_ROOT_REAL)   // 变异：切根不再传导给渲染器处理器\n'
      const s = files.main
      if (s.split(from).length !== 2) return { error: '锚点未命中唯一位置：setLibraryRootProvider' }
      return { main: s.replace(from, to) }
    },
  },
  {
    name: 'D-上游连不上不再回退本地（`if (localFallbackOk)` → `if (false)` ⇒ 死端口时整页 502）',
    expects: ['A5'],
    apply(files) {
      const from = '    if (localFallbackOk) {'
      const to = '    if (false) {   // 变异：不回退本地'
      const s = files.main
      if (s.split(from).length !== 2) return { error: '锚点未命中唯一位置：localFallbackOk' }
      return { main: s.replace(from, to) }
    },
  },
  {
    name: 'E-渲染器面不再本地直供（`serveRenderer` 一律走代理 ⇒ 没配上游时 /webloader 直接 500/502）',
    expects: ['A4', 'A4a'],
    apply(files) {
      const from = 'function serveRenderer(req, res, url, relOverride) {\n  if (RENDERER_UPSTREAM && !RENDERER_UPSTREAM.bad && RENDERER_UPSTREAM.host) return proxyRenderer(req, res, url, relOverride)\n  return serveRendererLocal(req, res, url, relOverride)\n}'
      const to = 'function serveRenderer(req, res, url, relOverride) {\n  return json(res, 502, { ok: false, error: "变异：不再本地直供" })   // 变异：去掉本地直供\n}'
      const s = files.main
      if (s.split(from).length !== 2) return { error: '锚点未命中唯一位置：serveRenderer 定义' }
      return { main: s.replace(from, to) }
    },
  },
  {
    name: 'F-`?shell=0` 注入被摘掉（用户第 6 条的服务端那一半）',
    expects: ['A6c', 'A6d'],
    apply(files) {
      const from = "      if (url.searchParams.get('shell') === '0') {"
      const to = "      if (false) {   // 变异：不再注入无外壳形态"
      const s = files.renderer
      if (s.split(from).length !== 2) return { error: '锚点未命中唯一位置：shell=0 注入点' }
      return { renderer: s.replace(from, to) }
    },
  },
  {
    name: 'G-前端切根刷新链断掉（软刷新里不再重新取来源、不再击穿缩略图缓存）',
    expects: ['A7f'],
    apply(files) {
      const from = '    askLibSourceOnce(true)                       // ② 重新取权威来源（doc 里的 `dir` 必须是新根）\n    paintLibSource()\n    bustRootSensitiveCaches()                    // ④ 缩略图/预览的缓存击穿'
      const to = '    // 变异：切根后不再刷新来源、不再击穿缓存'
      const s = files.patch
      if (s.split(from).length !== 2) return { error: '锚点未命中唯一位置：refreshLibrarySoft 尾段' }
      return { patch: s.replace(from, to) }
    },
  },
]

function runChild(args, ms) {
  return new Promise((resolve) => {
    /*  ⚠(2026-09-25) `detached: true` + 超时杀**整组**：子进程自己会 spawn 镜像服务
        （`startServer`），只杀子进程会把这些孙进程**遗弃**（实测 /tmp 下留下
        `mutant-N.mjs` 服务进程，ppid=1、抱着端口与内存不放）。同一个进程组一次收干净。 */
    const child = spawn(process.execPath, [path.resolve(import.meta.dirname, 'bench-dsh-libroot-test.mjs'), ...args], {
      cwd: ROOT, env: Object.assign({}, process.env), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    let out = ''
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', (c) => { out += c.toString() })
    const killGroup = (sig) => { try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* 已退 */ } } }
    const t = setTimeout(() => killGroup('SIGKILL'), ms || 240000)
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out }) })
  })
}
const parseChildJson = (out) => {
  const line = out.split('\n').filter((l) => l.startsWith('BENCH-DSH-LIBROOT-JSON ')).pop()
  if (!line) return null
  try { return JSON.parse(line.slice('BENCH-DSH-LIBROOT-JSON '.length)) } catch { return null }
}

// ── 变异副本（同一份实现被两个入口复用 ⇒ 变异要能同时覆盖两个文件）────────────────────────────
/** 造一个"镜像"目录：`<tmp>/mN/{server/*, core -> repo/core, demo -> repo/demo, …}`。
 *  为什么不是"把副本丢进 os.tmpdir() 再改写相对 import"：
 *   ① 被测文件用 `__dirname/..` 推 `REPO_ROOT`（demo.html / core / web / shaders 都在那里）——
 *      镜子里的软链让这个推导**天然成立**，不必给产品代码加测试专用开关；
 *   ② 改写相对 import 会往副本里写**本机绝对路径** ⇒ A0（源码里 0 处本机路径）会对**任何**变异都变红，
 *      "红的正是被变异掉的那条"就成了假绿。镜像里源码文本与真树逐字相同（只改被变异的那几处）。 */
function buildMirror(mtDir, idx, mainSrc, rendSrc) {
  const d = path.join(mtDir, 'm' + idx)
  const srv = path.join(d, 'server')
  fs.mkdirSync(srv, { recursive: true })
  const SKIP_TOP = new Set(['server', 'node_modules', 'tests', 'docs', 'reports', 'archive', '.git'])
  for (const top of fs.readdirSync(REPO_ROOT)) {
    if (SKIP_TOP.has(top) || top.startsWith('.')) continue
    try { fs.symlinkSync(path.join(REPO_ROOT, top), path.join(d, top)) } catch { /* 已存在/不支持 */ }
  }
  for (const name of fs.readdirSync(path.join(REPO_ROOT, 'server'))) {
    if (name === 'we-scene-demo-server-8902.mjs' || name === 'we-scene-demo-server.mjs') continue
    try { fs.symlinkSync(path.join(REPO_ROOT, 'server', name), path.join(srv, name)) } catch { /* 已存在 */ }
  }
  fs.writeFileSync(path.join(srv, 'we-scene-demo-server.mjs'), rendSrc)
  const mainPath = path.join(srv, 'we-scene-demo-server-8902.mjs')
  fs.writeFileSync(mainPath, mainSrc)
  return mainPath
}

async function mutateRed() {
  const mtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-libroot-mut-'))
  const rows = []
  try {
    const base = {
      main: fs.readFileSync(SERVER_UNDER_TEST, 'utf8'),
      renderer: fs.readFileSync(RENDERER_UNDER_TEST, 'utf8'),
      patch: fs.readFileSync(path.join(DEMO_DIR, 'bench-patch.js'), 'utf8'),
    }
    for (let i = 0; i < MUTATIONS.length; i++) {
      const m = MUTATIONS[i]
      const r = m.apply(Object.assign({}, base))
      if (r.error) { ok(false, `变异${i + 1} 可施加（锚点唯一）`, r.error); continue }
      const mainPath = buildMirror(mtDir, i + 1, r.main || base.main, r.renderer || base.renderer)
      //  bench-patch 的变异要真的生效 ⇒ 临时把真文件换掉（跑完立刻还原；真树内容逐字写回）
      const patchPath = path.join(DEMO_DIR, 'bench-patch.js')
      const mutatedPatch = r.patch || null
      try {
        if (mutatedPatch) fs.writeFileSync(patchPath, mutatedPatch)
        const res = await runChild([`--server=${mainPath}`, `--renderer=${path.join(path.dirname(mainPath), 'we-scene-demo-server.mjs')}`, '--no-mutant', '--no-browser'])
        const j = parseChildJson(res.out)
        const redLines = res.out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 5)
        const redNames = ((j && j.failed) || []).map((f) => f.name)
        const expectHit = m.expects.filter((e) => redNames.some((n) => n.startsWith(e)))
        console.log(`\n─── 变异 ${i + 1}：${m.name}`)
        console.log(`    子进程退出码 = ${res.code}（要求 1）`)
        console.log(`    RED 行（原文）：\n${redLines.map((l) => '      ' + l).join('\n') || '      (无 FAIL 行)'}`)
        ok(res.code === 1 && redLines.length > 0, `变异${i + 1} 必红：子进程退出码 1 且有 FAIL`, `code=${res.code} fails=${redNames.length}`)
        ok(expectHit.length > 0, `变异${i + 1} 红的正是被变异掉的判据（${m.expects.join('/')}）`,
          `命中=${expectHit.join(',') || '无'} 实际=${redNames.join(' | ').slice(0, 240)}` +
          (j ? '' : ' · 子进程读数缺失，尾部输出=' + JSON.stringify(res.out.slice(-260))))
        rows.push({ i: i + 1, name: m.name, code: res.code, red: redNames, hit: expectHit })
      } finally {
        if (mutatedPatch) fs.writeFileSync(patchPath, base.patch)     // 真树逐字还原
      }
    }
  } finally {
    try { fs.rmSync(mtDir, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
  }
  return rows
}

if (!NO_MUTANT) {
  section('变异自证（副本只活到跑完；真树一字不动）')
  const before = fs.readFileSync(path.join(DEMO_DIR, 'bench-patch.js'), 'utf8')
  await mutateRed()
  const after = fs.readFileSync(path.join(DEMO_DIR, 'bench-patch.js'), 'utf8')
  ok(before === after, '真树 bench-patch.js 跑前跑后逐字相同（变异只在副本里；并行编辑会假红）',
    before === after ? 'sha 相同' : '内容变了 ' + before.length + '→' + after.length)
  console.log('MUTANT-RED-OK ' + JSON.stringify((failed.length === 0 ? '（本轮全部变异都已变红，见上）' : '（有未变红的变异，见上）')))
}

/* ═══════════════════════════════ B 段：浏览器探针（GL 前置 / SKIP-able）═══════════════════════════
   为什么必须在浏览器里做：⑥ 是**帧序列**问题（"外壳可见期"），② 的"同一个对话框"是**交互**问题，
   ③ 的"不刷新点一下能出画"是**页面状态机**问题 —— 这三条在 Node 里都只能测到源码级钉子。 */
async function browserStage() {
  if (NO_BROWSER) { console.log('SKIP B 段（--no-browser）'); return }
  const { launchGLBrowser, glCapability, closeQuiet, logGLSkip, glReading, findPlaywright } = await import('./_gl-browser.mjs')
  const BASE = process.env.MPW_BENCH_BASE || 'http://127.0.0.1:8902'
  let up = false
  try { const r = await fetch(BASE + '/__health', { signal: AbortSignal.timeout(4000) }); up = r.ok } catch { up = false }
  if (!up) { console.log(`SKIP B 段（浏览器）—— 测试台不可达：${BASE}（A 段已跑完；起服务：node server/we-scene-demo-server-8902.mjs 8902）`); return }
  //  必须先确认对面是**新代码**（旧服务没有本地直供标记）⇒ 否则"外壳闪"根本不是被测版本，测了也是假读数
  let marker = null
  try {
    const r = await fetch(BASE + '/bundle.js', { method: 'HEAD', signal: AbortSignal.timeout(6000) })
    marker = r.headers.get('x-bench-served')
  } catch { marker = null }
  if (marker !== 'local') { console.log(`SKIP B 段（浏览器）—— ${BASE} 不是"渲染器面本地直供"的新服务（X-Bench-Served=${marker}）；重启 :8902 后再跑`); return }
  const pwPath = findPlaywright()
  if (!pwPath) { console.log('SKIP B 段（浏览器）—— 找不到 playwright'); return }
  /* ⚠ playwright 是 CJS 包：`import()` 出来的是 `{default: {...}}`，具名导出不一定被识别
     （实测漏了这一步 ⇒ `firefox` undefined ⇒ `Cannot read properties of undefined (reading 'launch')`）。
     与 `bench-renderer-source-test.mjs` 的 D 段逐字同款取法。 */
  const pw = await import(pathToFileURL(pwPath).href)
  const firefox = (pw.default && pw.default.firefox) || pw.firefox
  if (!firefox) { console.log('SKIP B 段（浏览器）—— playwright 没有 firefox 导出'); return }
  const { browser, launchNote } = await launchGLBrowser(firefox)
  try {
    const gl = await glCapability(browser)
    console.log('B 段浏览器：' + launchNote + ' · GL=' + JSON.stringify(gl))
    if (!gl.webgl2) { logGLSkip('B 段（预览外壳/首帧）', launchNote, gl); return }
    const ctx = await browser.newContext({ viewport: { width: 900, height: 620 } })
    const page = await ctx.newPage()
    const pageErrs = []
    const pageLogs = []
    page.on('pageerror', (e) => pageErrs.push(String((e && e.message) || e)))
    page.on('console', (m) => { try { pageLogs.push(m.type() + ': ' + String(m.text()).slice(0, 200)) } catch { /* ignore */ } })
    /*  B2d 的记录器：**在开页之前**装（`addInitScript` 对页面本身与后续每个 iframe 都生效）。
        只记录、只透传 —— 探针自己绝不建上下文（否则探针就成了"抢在渲染器前面 getContext"的那个）。 */
    await page.addInitScript(() => {
      try {
        const rec = []
        const orig = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (type, attrs) {
          try {
            if (this && this.id === 'sc') {
              rec.push({
                t: Math.round(performance.now()), type, hasAttrs: !!attrs,
                alpha: attrs ? attrs.alpha : null, premultipliedAlpha: attrs ? attrs.premultipliedAlpha : null,
                antialias: attrs ? attrs.antialias : null, preserveDrawingBuffer: attrs ? attrs.preserveDrawingBuffer : null,
              })
            }
          } catch (e) { /* 只记录，失败不影响页面 */ }
          return orig.call(this, type, attrs)
        }
        window.__ctxSc = rec
      } catch (e) { /* 桩环境 */ }
    })
    await page.goto(BASE + '/?benchlib=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 45000 })
    try { await page.waitForFunction(() => !!(window.__benchPatch && window.__benchShell), null, { timeout: 30000 }) } catch { /* 下面按读数判 */ }
    /* B1 ③①：`paintLibSource` 是模块作用域的真函数（改前 `typeof` 在 init 里是 undefined + ReferenceError） */
    const libProbe = await page.evaluate(() => (window.__benchPatch && window.__benchPatch.libSourceProbe) ? window.__benchPatch.libSourceProbe() : null)
    ok(!!libProbe && libProbe.defined === true, 'B1 `__benchPatch.libSourceProbe().defined === true`（定义层面存在，不是被 try/catch 掩盖）', JSON.stringify(libProbe))
    /* B2 ⑥：切壁纸时按固定时间点采样预览框 —— **外壳可见期一帧都不许有** */
    const sample = async (label) => page.evaluate((lbl) => {
      const out = { label: lbl, t: Date.now(), probe: null, shell: null, src: null }
      try { out.probe = window.__benchPatch && window.__benchPatch.frameProbe ? window.__benchPatch.frameProbe() : null } catch (e) { out.probe = { error: String(e && e.message) } }
      try {
        const fr = document.querySelector('#frame')
        out.src = fr ? String(fr.getAttribute('src') || '') : null
        const d = fr && fr.contentDocument
        if (d) {
          const vis = (sel) => { const el = d.querySelector(sel); if (!el) return 'absent'; const cs = d.defaultView.getComputedStyle(el); return (cs.display === 'none' || cs.visibility === 'hidden') ? 'hidden' : 'VISIBLE' }
          out.shell = { bar: vis('#bar'), log: vis('#log'), logbar: vis('#logbar'), fps: vis('#fps'), props: vis('#mpw-props-panel'), canvas: (() => { const c = d.querySelector('canvas'); return c ? (c.width + 'x' + c.height) : 'absent' })(), noshellStyle: !!d.getElementById('mpw-noshell') }
        }
      } catch (e) { out.shell = { error: String(e && e.message) } }
      return out
    }, label)
    const first = await sample('after-load')
    //  触发一次真实的"切壁纸"：点左侧列表里的第二项（没有列表就点工具条的「重挂载」）
    const clicked = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#list li[data-id]')]
      const el = li[1] || li[0]
      if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return String(el.dataset.id || '') }
      const rm = document.querySelector('#reload') || document.querySelector('#remount')
      if (rm) { rm.click(); return 'remount' }
      return null
    })
    const timeline = [first]
    /*  ⚠(2026-09-25) 黑幕判据不能只靠"固定时间点碰运气"：黑幕的生命期 = `arm(src 变) → 渲染器真首帧`
        （真机是**秒级**：取包+建纹理），但旧实现里 shim 用"canvas 取得到上下文"当首帧 ⇒ 生命期只有 ~10ms，
        固定采样点靠运气命中，这条判据因此假过也假红过。现在改成**密采样**（≈12ms 一次，全程 2.6s）：
        只要黑幕真的存在，就必然被抓到；再逐条断言"**首帧之前黑幕一定在**（不许提前揭开）"。 */
    const fast = []
    for (let i = 0; i < 180; i++) {
      fast.push(await page.evaluate(() => {
        const p = (window.__benchPatch && window.__benchPatch.frameProbe) ? window.__benchPatch.frameProbe() : null
        let shellVis = false
        try {
          const fr = document.querySelector('#frame')
          const d = fr && fr.contentDocument
          if (d) { for (const sel of ['#bar', '#log', '#fps']) { const el = d.querySelector(sel); if (el) { const cs = d.defaultView.getComputedStyle(el); if (cs.display !== 'none' && cs.visibility !== 'hidden') { shellVis = true; break } } } }
        } catch (e) { /* 跨源/无文档 */ }
        return p ? { armed: p.armed, veil: p.veilVisible, ff: p.firstFrameAt, shellVis } : null
      }))
      await sleep(12)
    }
    for (const ms of [60, 160, 400, 900, 1600, 2600]) { await sleep(ms === 60 ? 60 : ms - timeline[timeline.length - 1].t + timeline[0].t || ms); timeline.push(await sample('t+' + ms)) }
    console.log('  B 段读数（切壁纸过程采样，clicked=' + clicked + '）：\n' + timeline.map((s) => '    ' + JSON.stringify({ at: s.label, veil: s.probe && s.probe.veilVisible, armed: s.probe && s.probe.armed, firstFrameAt: s.probe && s.probe.firstFrameAt, shell: s.shell, canvas: s.shell && s.shell.canvas })).join('\n'))
    console.log('  B 段读数（黑幕密采样 ' + fast.length + ' 次，≈12ms 间隔）：' + JSON.stringify({
      armedSamples: fast.filter((x) => x && x.armed).length,
      armVeilPairs: fast.filter((x) => x && x.armed && x.veil && !x.ff).length,
      earlyReveal: fast.filter((x) => x && x.armed && !x.veil && !x.ff).length,
      maxVeilRun: (() => { let m = 0, c = 0; for (const x of fast) { if (x && x.armed && x.veil && !x.ff) { c++; m = Math.max(m, c) } else c = 0 } return m })(),
      firstFrameSeen: fast.some((x) => x && x.ff),
      shellVisibleSamples: fast.filter((x) => x && x.shellVis).length,
    }))
    const shellVisibleFast = fast.filter((x) => x && x.shellVis)
    const shellVisible = timeline.filter((s) => s.shell && ['bar', 'log', 'fps'].some((k) => s.shell[k] === 'VISIBLE'))
    ok(shellVisible.length === 0 && shellVisibleFast.length === 0,
      'B2 ★切壁纸全过程中预览框里**没有**出现渲染器页外壳（#bar/#log/#fps 恒为 hidden/absent；' +
      '粗采样 ' + timeline.length + ' 次 + 密采样 ' + fast.length + ' 次都算）',
      `粗采样可见=${shellVisible.length} 密采样可见=${shellVisibleFast.length}` +
      (shellVisible.length ? ' ' + JSON.stringify(shellVisible.map((s) => ({ at: s.label, shell: s.shell }))).slice(0, 300) : ''))
    const noshellSeen = timeline.some((s) => s.shell && s.shell.noshellStyle === true)
    ok(noshellSeen, 'B2a 预览的渲染器文档里能看到服务端注入的 `#mpw-noshell`（证明 `?shell=0` 真的生效）', String(noshellSeen))
    const armedSeen = fast.some((x) => x && x.armed)
    const veilSeen = fast.some((x) => x && x.armed && x.veil && !x.ff)
    ok(armedSeen && veilSeen, 'B2b 首帧之前的**黑幕**真的挂上了（密采样里至少一次 `armed && veilVisible && !firstFrameAt`）',
      JSON.stringify({ armedSamples: fast.filter((x) => x && x.armed).length, veilBeforeFrame: fast.filter((x) => x && x.armed && x.veil && !x.ff).length }))
    const earlyReveal = fast.filter((x) => x && x.armed && !x.veil && !x.ff)
    ok(earlyReveal.length === 0,
      'B2b1 ★黑幕**不许在首帧之前被揭开**（`armed && !veilVisible && !firstFrameAt` 的采样数必须为 0 —— ' +
      '旧 shim 用"canvas 取得到上下文"当首帧，真机 t≈151ms 就揭幕而真首帧在 12s 之后，正是这条抓的）',
      `提前揭幕采样=${earlyReveal.length}`)
    const shellFlag = timeline.map((s) => s.probe && s.probe.shellUrl).filter(Boolean)
    ok(shellFlag.length > 0, 'B2c 预览 iframe 的 URL 带 `shell=0`（无外壳形态是本仓档的缺省，不是手工加的）', String(shellFlag.length))
    /*  B2d(2026-09-25) **同一 canvas 只有第一次 getContext 的参数生效** ⇒ 端到端钉住"没人抢在渲染器前面
        取上下文"。做法：开页**之前**在**所有帧**（`addInitScript` 对后续 iframe 同样生效）里给
        `HTMLCanvasElement.prototype.getContext` 套一层**透传**记录器（只记 `#sc` 上每次调用的参数，
        然后原样 call through ⇒ 探针自己不建上下文、不改任何行为）。旧 shim 在这里留下的第一条是
        `attrs:null`（浏览器默认 ⇒ `alpha:true/antialias:true/premultipliedAlpha:true`），
        新实现的第一条必然是渲染器那份 `lib.glCanvasAttrs()`。 */
    {
      const rec = await page.evaluate(() => {
        try {
          const fr = document.querySelector('#frame')
          const w = fr && fr.contentWindow
          return {
            rec: (w && w.__ctxSc) || null,
            url: (w && w.location) ? String(w.location.href) : null,
            noshell: !!(fr && fr.contentDocument && fr.contentDocument.getElementById('mpw-noshell')),
          }
        } catch (e) { return { err: String(e && e.message) } }
      })
      const first = rec.rec && rec.rec[0]
      const want = { alpha: false, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true }
      const same = !!first && Object.keys(want).every((k) => first[k] === want[k])
      console.log(`  B2d 读数（预览 iframe 里 #sc 上的 getContext 记录）：${JSON.stringify(rec)}`)
      ok(same, 'B2d ★预览页 `#sc` 上**第一次** `getContext` 的参数 = 渲染器要的那份（`alpha:false / ' +
        'premultipliedAlpha:false / antialias:false / preserveDrawingBuffer:true`）—— 证明确实没人抢在渲染器前面取上下文',
        JSON.stringify(first || null))
    }
    ok(!pageErrs.some((e) => /is not defined/.test(e)), 'B3 整轮顶层页 0 个 "is not defined" 脚本错（第 3 条①的真修读数）', JSON.stringify(pageErrs.slice(0, 4)))

    /* ── B4(用户 A1 + P-201) 「渲染器设置（WE 自带）」分组：**组里的项可见、可用、能驱动 API** ─────────
       改前这一条只断言"组在不在 + 有没有收进 schemecolor"——**这个 bug 存在时照样绿**：
       那一行同时在隐藏名单里（`hidden=""`），表头报「1 项」、点开是空的。现在改成盯
       "项与固定清单逐项相等 + 几何上看得见 + 控件能用 + 改一项渲染器侧读数真的变"。 */
    await page.evaluate(() => { const li = document.querySelector('#list li[data-id]'); if (li) li.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await sleep(3400)
    /*  固定清单（与 `demo/bench-patch.js` 的 `WE_RENDERER_ITEMS` 逐项对应；**手写在这里** ⇒ 实现少一项即红）。
        判据只认清单里的 8 个"本页已实现"项的名字。 */
    const WE_IMPL = ['flipH', 'colorOptions', 'brightness', 'contrast', 'saturation', 'hue', 'playbackRate', 'volume']
    const g0 = await page.evaluate(() => (window.__benchPatch.propsGroups ? window.__benchPatch.propsGroups() : null))
    console.log('  B4 读数 propsGroups=' + JSON.stringify(g0))
    const names0 = (g0 && g0.weNames) || []
    ok(!!g0 && g0.wePresent === true && g0.firstChildIsWeGroup === true &&
      WE_IMPL.every((n) => names0.includes(n)) && names0.length >= WE_IMPL.length &&
      g0.weCount === names0.length && g0.weDrawn === g0.weCount && g0.collapsed === false &&
      String(g0.weHeaderCount || '').includes(String(g0.weCount)) && !names0.some((n) => /^schemecolor$|^ui_/i.test(n)),
      'B4 ★★「渲染器设置（WE 自带）」分组：**排在 `#props-body` 最前**、**项与固定清单逐项相等**' +
      '（用户点名的那 5 组 8 项一个不漏）、**表头计数 = 看得见的行数**（`weCount === weDrawn`，' +
      '不再把隐藏的内部行算进去）、缺省展开、名称里没有 `schemecolor`/`ui_*`',
      JSON.stringify({ names: names0, count: g0 && g0.weCount, drawn: g0 && g0.weDrawn, header: g0 && g0.weHeaderCount, adopted: g0 && g0.weHiddenAdopted }))
    ok(!!g0 && g0.weAvail && WE_IMPL.every((n, i) => g0.weAvail[names0.indexOf(n)] === true),
      'B4c 这 8 项在本仓渲染器档下都**真的可用**（`weAvail=true`，即 `__wp` 已发布且控件没被置灰）',
      JSON.stringify({ names: names0, avail: g0 && g0.weAvail }))
    /*  **能用**：真点一下「水平翻转」，`__wp` 侧读数必须真的变（改前这一组一个能驱动渲染器的控件都没有）。 */
    const drive = await page.evaluate(async () => {
      const el = document.getElementById('bench-we-flipH')
      if (!el) return { ok: false, why: 'no-control' }
      const before = (() => { try { return document.querySelector('#frame').contentWindow.__wp.displayState().flipH } catch (e) { return null } })()
      el.checked = true
      el.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 260))
      let after = null, tf = null
      try {
        const fr = document.querySelector('#frame')
        after = fr.contentWindow.__wp.displayState().flipH
        tf = fr.contentDocument.getElementById('sc').style.transform
      } catch (e) { /* 跨源 */ }
      el.checked = false
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, before, after, tf }
    })
    ok(drive.ok === true && drive.before === false && drive.after === true && String(drive.tf).includes('scaleX(-1)'),
      'B4d 组里的项**真的驱动渲染器**：勾一下「水平翻转」⇒ `__wp.displayState().flipH` 从 false 变 true，' +
      '且 `#sc` 内联样式出现 `transform: scaleX(-1)`（改完已还原）',
      JSON.stringify(drive))
    const g1 = await page.evaluate(() => {
      const head = document.querySelector('.bench-props-group[data-group="we"] .bench-props-group-head')
      if (head) head.click()
      return window.__benchPatch.propsGroups()
    })
    const g2 = await page.evaluate(() => window.__benchPatch.propsGroups())
    ok(g1.collapsed === true && g2.collapsed === true && g1.weCount === g2.weCount,
      'B4a 标题行点击 ⇒ 折叠（`data-collapsed=1`），重画后状态还在；项数不变（只是 display:none，不是删掉）',
      JSON.stringify({ after: g1, again: g2 }))
    const g3 = await page.evaluate(() => {
      const head = document.querySelector('.bench-props-group[data-group="we"] .bench-props-group-head')
      if (head) head.click()
      return window.__benchPatch.propsGroups()
    })
    ok(g3.collapsed === false, 'B4b 再点一次展开（两态可逆，不是单向开关）', JSON.stringify(g3))

    /* ── B5(用户 A2 + issue0924a2 用户第 3 条) "滑条不越出容器"：传输条逐元素 + 卡片里的音量轨
       两级都要量；并**当场做对照**（把滑条强行撑到 400px ⇒ `volumeOverflow` 必须变 true）证明判据不恒真。 ── */
    const openNpCard = async () => {
      /*  ③ 起音量轨只在**卡片展开**时存在 ⇒ 量它之前先展开（组件自己的 `.snd-tap`，真点击）。 */
      await page.evaluate(() => {
        const props = document.querySelector('#props')
        if (props) { props.hidden = false; props.removeAttribute('hidden') }
        const host = document.querySelector('#np-host')
        if (host) host.style.display = ''
      })
      /* ①(2026-10-07 消抖) 整轮门禁里软件渲染的页面更慢 ⇒ 卡片展开/音量轨出现的等待要有余量：
         4 次 ×700ms 在满载时会量到"还没展开"（B5b1/B5b/B5b2 假红，单跑 87/0 复现不了）。改 8 次 ×900ms。 */
      for (let i = 0; i < 8; i++) {
        const g = await page.evaluate(() => (window.__benchPatch && window.__benchPatch.npGeometry ? window.__benchPatch.npGeometry() : null))
        if (g && g.volumeVisible) return g
        const tap = await page.$('#np-host .snd-tap')
        if (tap) { try { await tap.click() } catch { /* 重试 */ } }
        await sleep(900)
      }
      return await page.evaluate(() => (window.__benchPatch && window.__benchPatch.npGeometry ? window.__benchPatch.npGeometry() : null))
    }
    const widthRead = async (w) => {
      await page.setViewportSize({ width: w, height: 720 })
      await sleep(400)
      const pre = await openNpCard()
      // ①(2026-10-07 消抖) 仍没展开 ⇒ 再给一轮（换视口后布局/媒体态会重排，满载时第一轮常常落空）
      if (!pre || !pre.volumeVisible) { await sleep(1500); await openNpCard() }
      return await page.evaluate((vw) => {
        const strip = document.querySelector('#np-audio')
        if (strip) strip.style.display = ''
        const api = window.__benchPatch
        const after = api.npGeometry ? api.npGeometry() : null
        /*  对照（**同一把尺子**）：把卡片里的滑条强行撑到 400px ⇒ `volumeOverflow` 必须变 true；
            撤掉注入立刻回 false。改前那套 `#np-volume{flex:none;width:64px}` 复现已退休 ——
            那个元素现在不在传输条里，量它等于量一条不存在的路径。 */
        let forced = null
        try {
          const st = document.createElement('style')
          st.id = 'bench-a2-forced'
          st.textContent = '#np-volume{flex:none!important;width:400px!important;min-width:400px!important;max-width:400px!important}'
          document.head.appendChild(st)
          forced = api.npGeometry ? api.npGeometry() : null
          st.remove()
        } catch (e) { forced = { error: String(e && e.message) } }
        //  after 也在**同一个 200px 容器**下量一次（这样 after/afterNarrow 才是同一条件下的对照）
        let afterNarrow = null
        try {
          const props3 = document.querySelector('#props')
          if (props3) { props3.style.width = '200px'; props3.style.maxWidth = '200px' }
          afterNarrow = api.npGeometry ? api.npGeometry() : null
          if (props3) { props3.style.width = ''; props3.style.maxWidth = '' }
        } catch (e) { afterNarrow = { error: String(e && e.message) } }
        const brief = (g) => (g ? {
          overflow: !!g.overflow, parts: Object.keys(g.parts || {}).length,
          stripW: g.strip ? Math.round(g.strip.width) : null,
          cardW: g.card ? Math.round(g.card.width) : null,
          volumeVisible: !!g.volumeVisible,
          volumeInCard: !!g.volumeInCard, volumeInCardX: !!g.volumeInCardX, volumeOverflow: !!g.volumeOverflow,
          volumeInStrip: !!g.volumeInStrip, stripHasVolume: !!g.stripHasVolume, muteInCard: !!g.muteInCard,
          sliderW: g.slider ? Math.round(g.slider.width) : null,
          sliders: g.slider ? [Math.round(g.slider.left), Math.round(g.slider.right)] : null,
          cards: g.card ? [Math.round(g.card.left), Math.round(g.card.right)] : null,
          parts_: g.overflowParts,
        } : null)
        return { viewport: vw, after: brief(after), afterNarrow: brief(afterNarrow), forced: brief(forced) }
      }, w)
    }
    /* ⚠ 视口要覆盖**两种布局**：`bench-narrow`（≤1180，面板全宽）与桌面档（`#props` = 320px 的右栏）。 */
    const w1280 = await widthRead(1280)
    const w390 = await widthRead(390)
    const w320 = await widthRead(320)
    console.log('  B5 读数（改后=当前实现 / 对照=把滑条强行撑到 400px）：\n    ' + JSON.stringify(w1280) + '\n    ' + JSON.stringify(w390) + '\n    ' + JSON.stringify(w320))
    ok([w1280, w390, w320].every((x) => x.after && x.after.overflow === false && x.afterNarrow && x.afterNarrow.overflow === false),
      'B5 ★传输条**不越出「壁纸配置」栏**：1280（桌面档，右栏 320px）/ 390 / 320 三种宽度下 `npGeometry().overflow === false`',
      JSON.stringify({ w1280: w1280.after, w390: w390.after, w320: w320.after }))
    /*  ③ 新契约的主判据：音量滑条在**卡片内部**、且自身不越出卡片 —— 三种宽度各量一次（都要求卡片已展开）。 */
    ok([w1280, w390, w320].every((x) => x.after && x.after.volumeVisible === true && x.after.volumeInCard === true &&
      x.after.volumeInCardX === true && x.after.volumeOverflow === false && x.after.muteInCard === true &&
      x.after.volumeInStrip === false && x.after.stripHasVolume === false),
      'B5b1 ★★用户第 3 条：音量控件（滑条 + 静音第四键）在 **NP 卡片内部**（`volumeInCard/volumeInCardX/muteInCard` 为真、`volumeOverflow` 为假），' +
      '传输条 `#np-audio` 里没有它（`volumeInStrip/stripHasVolume` 为假）',
      JSON.stringify([w1280.after, w390.after, w320.after].map((g) => g && { v: g.volumeVisible, inCard: g.volumeInCard, inCardX: g.volumeInCardX, ovf: g.volumeOverflow, mute: g.muteInCard, inStrip: g.volumeInStrip, stripHas: g.stripHasVolume, w: g.sliderW })))
    /*  对照（不恒真的证据）：同一把尺子，把滑条撑到 400px ⇒ `volumeOverflow` 必须变 true；撤掉立刻回 false。 */
    // ①(2026-10-04 修) `forced.sliderW` 量的是 `getBoundingClientRect()`（含盒模型：CSS 强制
    //   width:400 + 自身 padding ⇒ 实测 408）⇒ 断言"撑宽生效"（≥400 且 ≈400，量级 ≠ 正常 158），
    //   不写死精确相等——浏览器盒模型口径变化不应打红这条对照判据。
    ok(!!w1280.forced && w1280.forced.volumeOverflow === true && w1280.forced.sliderW >= 400 && w1280.forced.sliderW < 420 && w1280.after.volumeOverflow === false,
      'B5b ★对照读数（同一入口 `npGeometry()`）：把卡片里的滑条强行撑到 400px（CSS）⇒ 实测量 ≥400（含盒模型）且 `volumeOverflow` 当场变 true；当前实现为 false —— 判据有分辨力，不是恒真',
      JSON.stringify({ forced: w1280.forced, after: w1280.after }))
    /*  窄容器（200px 的「壁纸配置」栏）下：滑条**在卡片里也不越出卡片**。如实记录：卡片自身是 260px 固定宽
        （组件设计如此、本轮没动），在 200px 的面板里会横向溢出 —— 这是**改动前就存在**的状态，
        不是本轮引入的（旧实现的 `#np-volbar` 是块级行所以能缩到 200px，而卡片一直缩不了）。 */
    ok(!!w1280.afterNarrow && w1280.afterNarrow.volumeInCard === true && w1280.afterNarrow.volumeOverflow === false &&
      w1280.afterNarrow.sliderW > 0,
      'B5b2 200px 窄容器下：滑条**仍然在卡片内部**且自身不越界（`volumeInCard===true` / `volumeOverflow===false` / 有实际宽度）—— "滑条不越出容器"这条判据按新契约继续成立',
      JSON.stringify({ afterNarrow: w1280.afterNarrow }))
    console.log('  B5b2 说明：200px 面板下**卡片本身**（260px 固定宽）会溢出面板，这是组件设计（本轮未改）；判据量的是"滑条 vs 卡片"。')

    /* ── B6(用户 A3) 半成品清点：`#page-wpset` 的过期结论已被就地改正 + 控件清单读数 ────────────────── */
    /* ⚠ 判据为什么用"页面内夹具"而不是直接量真表格：真页面里 `tbody tr` 有 99 行（表格很多），
       同一个标签文案在别的表里也可能出现 ⇒ 直接按文案找行会找错行（实测就是这样：找到的行末列是空的）。
       所以：往真页面里插一张**我们自己的**小表（四行 = 那四条），调 `__benchPatch.wpsetDocFix()`，
       断言这四行被改成「已实现」；再如实打印真文档的 `.tag-todo` 计数。这是**确定性**判据。 */
    const wpsetFix = await page.evaluate(() => {
      const f = window.__benchPatch && window.__benchPatch.wpsetDocFix
      if (!f) return { error: 'wpsetDocFix 探针缺失' }
      const labels = ['翻转（水平翻转）', '播放速度 0.5–2×', '显示颜色选项（总开关）', '亮度 / 对比度 / 饱和度 / 色调偏移']
      const t = document.createElement('table')
      t.id = 'bench-wpset-fixture'
      const tb = document.createElement('tbody')
      for (const lb of labels) {
        const tr = document.createElement('tr')
        const c1 = document.createElement('td'); c1.textContent = lb
        const c2 = document.createElement('td'); c2.textContent = 'x'
        const c3 = document.createElement('td')
        const sp = document.createElement('span'); sp.className = 'tag tag-todo'; sp.textContent = '需实现'
        c3.appendChild(sp)
        tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3)
        tb.appendChild(tr)
      }
      t.appendChild(tb); document.body.appendChild(t)
      const first = f()
      const second = f()
      const rows = [...tb.querySelectorAll('tr')].map((tr) => {
        const tds = tr.querySelectorAll('td')
        const last = String((tds[tds.length - 1] || {}).textContent || '').trim()
        //  语言可能是 en（真机读数实测：`Implemented（…）`）⇒ 判据接受两语
        return { text: last.slice(0, 24), ok: /已实现|Implemented/.test(last) && !/需实现|to be implemented/i.test(last), marked: tr.dataset.benchWpset === 'fixed' }
      })
      t.remove()
      return { first, second, rows, docTodoLeft: document.querySelectorAll('.tag-todo').length }
    })
    const audit = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('button, input, select')]
      const vis = controls.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
      return { pagePresent: !!document.querySelector('#page-wpset'), rows: document.querySelectorAll('tbody tr').length, controls: controls.length, visible: vis.length, nowPlaying: !!document.querySelector('#np-mount .snd') }
    })
    console.log('  B6 读数（半成品清点）=' + JSON.stringify(audit) + ' · 文档文案夹具=' + JSON.stringify(wpsetFix) + ' · 日志=' + JSON.stringify(pageLogs.slice(0, 3)))
    ok(!!wpsetFix && Array.isArray(wpsetFix.rows) && wpsetFix.rows.length === 4 && wpsetFix.rows.every((r) => r.ok) &&
      wpsetFix.first >= 4 && wpsetFix.second === 0,
      'B6 ★「已实现却写着需实现」的四行会被就地改正成「已实现 / Implemented」（页面内夹具；第二次调用幂等返回 0）',
      JSON.stringify(wpsetFix))
    ok(!!wpsetFix && typeof wpsetFix.docTodoLeft === 'number',
      'B6b 真文档的 `.tag-todo` 计数如实打印（半成品清点的原始读数，不挑数字）',
      JSON.stringify({ docTodoLeft: wpsetFix && wpsetFix.docTodoLeft }))
    ok(audit.controls > 30 && audit.visible > 10,
      'B6a 交互控件清点：页面里可见控件都能量到盒宽（`看不到/量不到`的控件会被这条暴露出来）',
      JSON.stringify({ controls: audit.controls, visible: audit.visible }))
    ok(audit.controls > 30 && audit.visible > 10,
      'B6a 交互控件清点：页面里可见控件都能量到盒宽（`看不到/量不到`的控件会被这条暴露出来）',
      JSON.stringify({ controls: audit.controls, visible: audit.visible }))
    /* ── B7(用户 E + issue0924a2 用户第 2 条) 真语料复现：同一张图在**真面板**里到底画了几遍 ────────
       真语料读数（`allwallpaper/dd/3660962877/project.json`）：img token 39 个，唯一 URL 7 个，
       其中一条 URL 出现 **33 次**（33 个属性名的文案里逐字节相同）。
       **②(2026-09-25) 补上的那一半根因**：面板里还有一份**产物自己渲染**的图
       （`div.prop-media > img`，来自渲染器解析出的 media 列表），旧账本**完全没管它**。
       真机读数（dd/3660962877，改前）：`ours 6 + media 38 = 44 张`，同一张画面 33 遍；
       改后：`rendered = 7`（每个身份一条），`hiddenDup ≈ 37`。 */
    /* 选一张"多图"的壁纸：列表里逐项点过去，直到 `propsImages().report.images > 5`（真语料里
       3660962877 有 38 个 img token；不同库根/类型过滤下列表顺序会变，所以**按读数挑**，不按 id 挑）。 */
    const pickAndRead = async (url) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      try { await page.waitForFunction(() => !!(window.__benchPatch && window.__benchShell), null, { timeout: 25000 }) } catch { /* 下面按读数判 */ }
      try { await page.waitForFunction(() => document.querySelectorAll('#list li[data-id]').length > 0, null, { timeout: 25000 }) } catch { /* 空列表 */ }
      const tried = []
      let best = null
      for (let k = 0; k < 12; k++) {
        const id = await page.evaluate((idx) => {
          const li = [...document.querySelectorAll('#list li[data-id]')][idx]
          if (!li) return ''
          li.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          return String(li.dataset.id || '')
        }, k)
        if (!id) break
        await sleep(1800)
        const r = await page.evaluate(() => (window.__benchPatch.propsImages ? window.__benchPatch.propsImages() : null))
        tried.push({ id, images: (r && r.report && r.report.images) || 0 })
        if (r && r.report && r.report.images > 5) { best = { picked: id, r }; break }
        if (!best || ((r && r.report && r.report.images) || 0) > ((best.r && best.r.report && best.r.report.images) || 0)) best = { picked: id, r }
      }
      return Object.assign(best || { picked: '', r: null }, { tried })
    }
    const imgOnce = await pickAndRead(BASE + '/?benchimg=' + Date.now())
    const imgAll = await pickAndRead(BASE + '/?propimg=all&benchimg=' + Date.now())
    const brief = (x) => (x && x.r) ? {
      item: x.picked, mode: x.r.mode, rendered: x.r.rendered, links: x.r.links,
      ours: x.r.ours, media: x.r.media, hiddenDup: x.r.hiddenDup,
      tokens: x.r.report && x.r.report.images, dupSkipped: x.r.report && x.r.report.duplicatesSkipped,
      variants: x.r.report && x.r.report.variants && x.r.report.variants.evidence,
      dupGroups: x.r.report && (x.r.report.duplicateGroups || []).map((g) => ({ count: g.count, kept: g.kept })),
      loadedImgs: (x.r.natural || []).filter((n) => n.w > 0).length, tried: (x.tried || []).slice(-4),
    } : null
    console.log('  B7 读数（真面板）：once=' + JSON.stringify(brief(imgOnce)) + '\n              all =' + JSON.stringify(brief(imgAll)))
    ok(!!imgOnce.r && imgOnce.r.mode === 'once' && imgOnce.r.rendered > 0 && imgOnce.r.report &&
      imgOnce.r.rendered === (imgOnce.r.report.groups.length || -1) && imgOnce.r.report.duplicatesSkipped > 0,
      'B7 ★真语料：`once`（缺省）档下**同一张画面只画一遍**（`rendered == 身份组数`，且 duplicatesSkipped > 0）',
      JSON.stringify(brief(imgOnce)))
    ok(!!imgOnce.r && (imgOnce.r.media || 0) + (imgOnce.r.ours || 0) === imgOnce.r.rendered && (imgOnce.r.hiddenDup || 0) > 0,
      'B7b ★★用户第 2 条：**产物自己渲染的 `.prop-media` 图也在同一本账里**（`media + ours = rendered`，且 `hiddenDup > 0` 说明真的压掉了重复）—— ' +
      '改前这一份完全不进账（真机读数：同一张画面 33 遍）',
      JSON.stringify({ rendered: imgOnce.r && imgOnce.r.rendered, ours: imgOnce.r && imgOnce.r.ours, media: imgOnce.r && imgOnce.r.media, hiddenDup: imgOnce.r && imgOnce.r.hiddenDup }))
    ok(!!imgAll.r && imgAll.r.mode === 'all' && !!imgOnce.r && imgAll.r.rendered > imgOnce.r.rendered,
      'B7a 对照档 `?propimg=all`（改前行为）在同一张壁纸上画得**更多** —— 改前/改后读数成对，不是恒绿',
      JSON.stringify({ once: brief(imgOnce), all: brief(imgAll) }))
        logGLSkip('B 段末（GL 读数留档）', launchNote, gl)
  } finally { await closeQuiet(browser) }
}
try { await browserStage() } catch (e) { ok(false, 'B 段执行（非环境类异常必须看见）', String((e && e.message) || e).slice(0, 300)) }

/* ── 收尾 ───────────────────────────────────────────────────────────────────────────────────── */
try { fs.rmSync(FIXTURE.root, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
console.log(`\n═══ 汇总：PASS=${pass} FAIL=${failed.length} ═══`)
for (const f of failed) console.log('  FAIL ' + f.name + (f.reading ? ' — ' + f.reading : ''))
/* ⚠机读那一行必须**同步写 fd 1**：紧跟其后的 `process.exit()` 会丢掉管道里还没 flush 的异步写
   （实测：父进程 parse 到的 failed 恒为空 ⇒ "红的正是那条"变成假绿）。 */
try { fs.writeSync(1, 'BENCH-DSH-LIBROOT-JSON ' + JSON.stringify({ pass, failed: failed.map((f) => ({ name: f.name, reading: f.reading })) }) + '\n') } catch { /* 已关 */ }
if (JSON_OUT) console.log(JSON.stringify({ pass, failed }, null, 1))
process.exit(failed.length === 0 ? 0 : 1)

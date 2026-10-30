// bench-mpkg-items-test.mjs —— `.mpkg` 成为测试台**一等库项**的判据集（用户"壁纸都启动失败 / PKG HTTP404"的根因那一半）
//
// 真机根因（库根 = `<WS>/allwallpaper/wallpaperE`，项目所有者真实的库布局 `<角色>/<角色>_NN.mpkg`）：
//   · `GET /api/library` ⇒ **items=20**（= 20 个**角色目录**），每条 `file` = 该目录里**第一个** `.mpkg`
//     ⇒ 148 个 `.mpkg` 里绝大多数**在列表里根本不存在**（用户看不到那些壁纸）；
//   · `GET /pkg/卡提希娅` ⇒ 404/52B（`ID_PAT` 只认单段 ASCII，非 ASCII id 连路由都进不去）、
//     `GET /pkg/other` ⇒ 404/8B `no scene`（`findScene()` 只找 `<root>/<id>/scene.pkg`）
//     ⇒ 页面日志 `pkg HTTP 404`（用户原话的 `PKG HTTP404`）。
// 本文件判的就是"这两条都修好了"：
//   A1 扫描器：**逐文件成项**（每个 `.mpkg` 一条，`itemId` = 相对库根的**嵌套路径**）+ 容器内类型判定
//      + **目录条不重复计数**（口径写在 `scan.itemRoles.note` 里，可核对）；
//   A2 路由：`/pkg/<嵌套 id>` 200 且与 `stat` **等长**（`.mpkg` 字节原样回）、`/project`、`/api/mpkg`、
//      缩略图、`/media/dev/**` 的两种读法、以及"越界仍被拒"（`..`/绝对路径/符号链接逃逸）；
//   A2o 413 门槛：超限如实 413 不截断 + **中间边界值**（恰好等于上限 ⇒ 200 且逐字节相等 / 只差 1 字节 ⇒ 413）；
//   A2p **并发**（12 发：整包 GET ×6 + Range 206 ×3 + HEAD ×3）⇒ 无串包/无截断、跑完服务仍健康；
//   A3 真语料（条件项）：`wallpaperE` 下每个 `.mpkg` 都在列表里成条，`dd` 仍是"目录一条"（零回归）。
//
// 判据分层（与 `tests/bench-dsh-libroot-test.mjs` 同款）：
//   · A 段 = 纯 Node + 真 HTTP（临时夹具 + 真起一份被测服务），无浏览器；
//   · **变异自证**（MUTANT-RED-OK）：把实现改回旧口径 ⇒ 判据必须变红，且红的正是被变异掉的那条；
//   · 段末打印机读行 `BENCH-MPKG-ITEMS-JSON {...}`（父进程/变异阶段读它）。
//
// 用法:
//   node tests/bench-mpkg-items-test.mjs                 # A 段 + 变异
//   node tests/bench-mpkg-items-test.mjs --no-mutant      # 只跑 A 段（变异子进程用）
//   node tests/bench-mpkg-items-test.mjs --server=<路径>  # 换被测 8902 服务（变异阶段就是这么调自己）
//   node tests/bench-mpkg-items-test.mjs --renderer=<路径> # 换被测 8899 渲染器处理器（同上）
//   node tests/bench-mpkg-items-test.mjs --json           # 末尾再打一份人读 JSON
// 退出码：0 全绿（含 SKIP）/ 1 有失败或变异没变红 / 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
const KNOWN_FLAGS = ['--no-mutant', '--json']
let SERVER_UNDER_TEST = path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs')
let RENDERER_UNDER_TEST = path.join(ROOT, 'server', 'we-scene-demo-server.mjs')
let NO_MUTANT = false
let JSON_OUT = false
for (const a of argv) {
  if (a === '--no-mutant') { NO_MUTANT = true; continue }
  if (a === '--json') { JSON_OUT = true; continue }
  if (a.startsWith('--server=')) { SERVER_UNDER_TEST = path.resolve(a.slice('--server='.length)); continue }
  if (a.startsWith('--renderer=')) { RENDERER_UNDER_TEST = path.resolve(a.slice('--renderer='.length)); continue }
  if (!KNOWN_FLAGS.includes(a)) { console.error('✗ 未知参数 ' + a); process.exit(2) }
}
const DEMO_DIR = path.join(ROOT, 'demo')
const CORPUS_MPKG = path.join(WS, 'allwallpaper', 'wallpaperE')   // 真实布局：<角色>/<角色>_NN.mpkg
const CORPUS_DD = path.join(WS, 'allwallpaper', 'dd')             // 老布局：<id>/scene.pkg（回归基准）

// ── 断言小工具（GOOD/FAIL 两行都打，人读与机读同一份）──────────────────────────────────────────
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
        resolve({ status: res.statusCode, headers: res.headers, buf, body: buf.toString('utf8'), bytes: buf.length })
      })
    })
    req.on('error', (e) => resolve({ status: 0, headers: {}, buf: Buffer.alloc(0), body: String((e && e.code) || e), bytes: 0 }))
    if (opts.body) req.write(opts.body)
    req.end()
  })
}
const J = (r) => { try { return JSON.parse(r.body) } catch { return {} } }
const enc = (s) => encodeURIComponent(s)
async function freePort() {
  return await new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}
/** 起一份被测服务（临时夹具根 + 真静态面），等它就绪。**cwd 必须是真仓库根**（见 bench-dsh-libroot 的同条注释）。 */
async function startServer(fx, envExtra = {}, args = []) {
  const port = await freePort()
  const child = spawn(process.execPath, [SERVER_UNDER_TEST, String(port), ...args], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MPW_ROOT: fx.root,
      MPW_LIBRARY_DIR: fx.lib,
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
    if (Date.now() > deadline) { try { child.kill('SIGKILL') } catch { /* 已退 */ } throw new Error('服务 25s 没起来：\n' + out.slice(-1500)) }
    try { const r = await request(port, 'GET', '/__health'); if (r.status === 200) break } catch { /* 还没起来 */ }
    await sleep(120)
  }
  return { port, child, out: () => out }
}
const stop = (srv) => { try { srv.child.kill('SIGKILL') } catch { /* 已退 */ } }

// ── 夹具：三层布局（库根/<角色>/<文件>.mpkg）+ 目录里混视频/网页 + 越界靶子 ──────────────────────
/** 造一个**真实**的 PKG 家族容器（PKGV=场景包 / PKGM=.mpkg 合集包；目录表 + 原样存储的载荷）。 */
function buildPkg(magic, files) {
  const i32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeInt32LE(n | 0, 0); return b }
  const u32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0, 0); return b }
  const sized = (s) => { const body = Buffer.from(String(s), 'utf8'); return Buffer.concat([i32(body.length), body]) }
  let dataLen = 0
  const metas = files.map(([name, content]) => {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content))
    const m = { name, buf, offset: dataLen }
    dataLen += buf.length
    return m
  })
  const head = [sized(magic), i32(metas.length)]
  for (const m of metas) head.push(sized(m.name), u32(m.offset), u32(m.buf.length))
  return Buffer.concat([...head, ...metas.map((m) => m.buf)])
}
const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c) }
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-mpkg-items-'))
  const root = path.join(base, 'ws')
  const lib = path.join(root, 'lib')
  const outside = path.join(base, 'outside')
  fs.mkdirSync(lib, { recursive: true })
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  w(path.join(outside, 'secret.mpkg'), buildPkg('PKGM0018', [['preview.gif', 'GIF89a-OUTSIDE-SECRET'], ['scene.json', '{"secret":true}']]))
  w(path.join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE\n')

  // ① 三层布局的 mpkg 目录：容器内类型 scene / video / web / 只有 scene.pkg（渲染器吃不了）
  const A1 = '甲_01.mpkg'
  const A2 = '甲_02.mpkg'
  const A3 = '甲_03.mpkg'
  const A4 = '甲_04.mpkg'
  const B1 = '乙_01.mpkg'
  const VIDEO = '甲_clip.mp4'
  w(path.join(lib, '角色甲', A1), buildPkg('PKGM0018', [
    ['preview.gif', 'GIF89a-container-preview-bytes'],                    // ≥12B：过图像魔数校验
    ['project.json', JSON.stringify({ title: '甲一 场景', type: 'Scene', file: 'scene.json', workshopid: '111' })],
    ['scene.json', '{"general":{"properties":{}}}'],
  ]))
  w(path.join(lib, '角色甲', A2), buildPkg('PKGM0014', [
    ['preview.jpg', 'JPEG-container-preview-bytes'],
    ['project.json', JSON.stringify({ title: '甲二 视频', type: 'video', file: 'wallpaper.mp4' })],
    ['wallpaper.mp4', Buffer.alloc(4096, 7)],
  ]))
  w(path.join(lib, '角色甲', A3), buildPkg('PKGM0014', [
    ['index.html', '<!doctype html><title>in-container web</title>'],
    ['project.json', JSON.stringify({ title: '甲三 网页', type: 'Web' })],
  ]))
  w(path.join(lib, '角色甲', A4), buildPkg('PKGM0014', [
    ['preview.png', 'PNG-container-preview-bytes'],
    ['scene.pkg', 'PKGV0022-nested-scene-pkg'],                            // 容器套容器：渲染器页只认 scene.json ⇒ 不可渲染
  ]))
  w(path.join(lib, '角色甲', VIDEO), 'FAKE-MP4-BYTES')                     // 同目录里的松散视频
  w(path.join(lib, '角色甲', 'project.json'), JSON.stringify({ type: 'scene', title: '甲目录属性', general: { properties: { clock: { type: 'bool', value: false } } } }))
  w(path.join(lib, '角色乙', B1), buildPkg('PKGM0014', [
    ['preview.gif', 'GIF89a-BBBB-preview-bytes'],
    ['scene.json', '{"general":{}}'],
  ]))
  /* ①(P-261 2026-10-07) **库根顶层散落的 `.mpkg`**（真机复现：库根 `allwallpaper/1004` 顶层 6 个 `.mpkg`
     ⇒ 修前 `GET /api/library` **items=0**，用户看到的就是"扫描不到 MPKG 文件"）。 */
  w(path.join(lib, '丙_顶层.mpkg'), buildPkg('PKGM0018', [
    ['preview.gif', 'GIF89a-top-preview-bytes'],
    ['project.json', JSON.stringify({ title: '丙 顶层容器', type: 'Scene', file: 'scene.json' })],
    ['scene.json', '{"general":{"properties":{}}}'],
  ]))
  // ② 没有 .mpkg 的目录：仍是"目录一条"（老口径零回归）
  w(path.join(lib, '场景丙', 'scene.pkg'), 'PKGV0001-fixture-scene-bytes')
  w(path.join(lib, '场景丙', 'preview.gif'), 'GIF89a-ccc-preview')
  w(path.join(lib, '网页丁', 'index.html'), '<!doctype html><title>fixture web</title>')
  w(path.join(lib, '空目录', 'placeholder.txt'), 'x')
  fs.rmSync(path.join(lib, '空目录', 'placeholder.txt'))
  // ③ 病态大小：超 413 门槛用（配合 MPW_LIMIT_PKG_BYTES=1 的那份服务）
  w(path.join(lib, '大包', '大_01.mpkg'), buildPkg('PKGM0014', [['preview.gif', 'GIF89a-big-preview'], ['scene.json', '{}']]))
  // ④ 符号链接逃逸（真身校验必须拦住）
  let linkOk = false
  try { fs.symlinkSync(path.join(outside, 'secret.mpkg'), path.join(lib, '角色乙', '逃逸.mpkg')); linkOk = true } catch { linkOk = false }
  let dirLinkOk = false
  try { fs.symlinkSync(outside, path.join(lib, '逃逸目录'), 'dir'); dirLinkOk = true } catch { dirLinkOk = false }
  return { base, root, lib, outside, linkOk, dirLinkOk, names: { A1, A2, A3, A4, B1, VIDEO } }
}

// ── A 段：扫描器（逐文件成项 + 类型判定 + 目录条不重复计数）────────────────────────────────────
async function scanStage(fx, srv) {
  const P = srv.port
  const enc1 = (s) => s.split('/').map(enc).join('/')
  const lib = await request(P, 'GET', '/api/library')
  const L = J(lib)
  const items = L.items || []
  /** ⚠ 取法一律"取不到就给空对象"：变异体（例如退回"目录一条"）会让这些 id 消失，
      判据要**如实变红**，不许因为 `undefined.kind` 把变异体弄崩（崩了是假红，不是判据在干活）。 */
  const byId = (id) => items.find((i) => i.itemId === id) || {}
  const m = fx.names
  console.log(`  A1 读数：count=${L.count} kinds=${JSON.stringify(L.scan && L.scan.kinds)} itemRoles=${JSON.stringify(L.scan && L.scan.itemRoles)}`)
  console.log('  A1 条目表：\n' + items.map((i) => `    ${i.itemId}  type=${i.type} kind=${i.kind} role=${i.itemRole || 'dir'} file=${i.file} renderable=${i.renderable}`).join('\n'))

  ok(items.some((i) => i.itemId === `角色甲/${m.A1}`) && items.some((i) => i.itemId === `角色甲/${m.A2}`) && items.some((i) => i.itemId === `角色甲/${m.A3}`) && items.some((i) => i.itemId === `角色甲/${m.A4}`),
    'A1a ★**逐文件成项**：`角色甲/` 下的 4 个 `.mpkg` 各成一条（itemId = 相对库根的**嵌套路径**）',
    JSON.stringify(items.filter((i) => i.itemId.startsWith('角色甲/')).map((i) => i.itemId)))
  const f1 = byId(`角色甲/${m.A1}`)
  ok(!!f1.itemId && f1.itemRole === 'file' && f1.file === m.A1 && f1.dir === '角色甲' && f1.parentDir === '角色甲' && f1.entryFile === m.A1,
    'A1b 文件型条目的字段口径：`file` = 文件名本身、`dir`/`parentDir` = 所在目录、`itemRole="file"`（前端只认老字段也能用）',
    JSON.stringify(f1 && { itemId: f1.itemId, file: f1.file, dir: f1.dir, role: f1.itemRole, entry: f1.entryFile, magic: f1.containerMagic, entries: f1.containerEntries }))
  const types = Object.fromEntries([m.A1, m.A2, m.A3, m.A4, m.B1].map((n) => {
    const d = n === m.B1 ? '角色乙' : '角色甲'
    const it = byId(`${d}/${n}`)
    return [n, { type: it.type, kind: it.kind, ck: it.containerKind, ce: it.containerEntry, renderable: it.renderable }]
  }))
  console.log('  A1c 类型判定读数：' + JSON.stringify(types))
  ok(types[m.A1].kind === 'scene' && types[m.A1].type === 'scene' && types[m.A1].renderable === true && types[m.A1].ce === 'scene.json',
    'A1c ★容器内类型判定（scene）：有 `scene.json` ⇒ type/kind=scene、hasScene=true、renderable=true（页面才会按 `?type=scene` 挂）',
    JSON.stringify(types[m.A1]))
  ok(types[m.A2].kind === 'video' && types[m.A2].renderable === true,
    'A1d ★容器内类型判定（video）：有视频条目 ⇒ type/kind=video', JSON.stringify(types[m.A2]))
  ok(types[m.A3].kind === 'web' && types[m.A3].renderable === false && /index\.html/.test(String(byId(`角色甲/${m.A3}`).renderReason)),
    'A1e ★容器内类型判定（web）：有 `index.html` ⇒ type/kind=web；同时**如实**标 `renderable=false`（网页档要磁盘上的入口 URL，容器内条目取不到 ⇒ 不假装能挂）',
    JSON.stringify({ t: types[m.A3], reason: byId(`角色甲/${m.A3}`).renderReason }))
  ok(types[m.A4].kind === 'scene' && types[m.A4].renderable === false && !!byId(`角色甲/${m.A4}`).renderReason,
    'A1f 容器里**只有** `scene.pkg`（没有 `scene.json`）⇒ 类型照实判 scene，但 `renderable=false` + 给理由（渲染器页的场景路只认 scene.json；不假装能渲染）',
    JSON.stringify({ t: types[m.A4], reason: byId(`角色甲/${m.A4}`).renderReason }))

  // 目录条不重复计数（这条口径必须**可核对**）
  const rol = L.scan && L.scan.itemRoles
  ok(!!rol && rol.fileItems > 0 && rol.dirItems > 0 && (rol.fileItems + rol.dirItems) === L.count && rol.mpkgFiles === 7,
    'A1g ★**目录条不重复计数**：`scan.itemRoles.fileItems + dirItems === count`（同一批壁纸的两种表示不会各来一条）+ `mpkgFiles=7`（夹具 6 个 + P-261 的顶层那 1 个）',
    JSON.stringify({ roles: rol, count: L.count }))
  ok(!byId('角色甲').itemId && !byId('角色乙').itemId && !!byId(`角色乙/${m.B1}`).itemId &&
    items.filter((i) => i.parentDir === '角色乙').length === 1,
    'A1h 有 `.mpkg` 的目录**不再产出"目录那一条"**（`角色甲`/`角色乙` 都不在列表里）；`角色乙` 只有 1 个 `.mpkg` ⇒ 恰好 1 条文件条（既不重复也不漏）',
    JSON.stringify({ 角色甲: byId('角色甲').itemId || null, 角色乙: byId('角色乙').itemId || null, 乙条数: items.filter((i) => i.parentDir === '角色乙').map((i) => i.itemId) }))
  /* ①(P-261) 顶层散落容器成条：`itemId` = 文件名本身、`dir=''`、`itemRole='file'`、类型按容器内容判。 */
  const top = byId('丙_顶层.mpkg')
  ok(!!top.itemId && top.itemRole === 'file' && top.dir === '' && top.parentDir === '' && top.kind === 'scene' && top.renderable === true,
    'A1m ★P-261 **库根顶层散落的 `.mpkg` 也成条**（修前只进 `scan.looseMpkg` 计数、`items` 里看不到 ⇒ 用户"扫描不到 MPKG 文件"；含"与 workshop 目录混合"的库根）',
    JSON.stringify({ id: top.itemId, role: top.itemRole, dir: top.dir, kind: top.kind, renderable: top.renderable }))
  ok(byId(`角色甲/${m.VIDEO}`).kind === 'video',
    'A1i 目录里**混的视频**也各成一条（否则"这个目录里还有一张壁纸"会看不见）', JSON.stringify(byId(`角色甲/${m.VIDEO}`) && { id: byId(`角色甲/${m.VIDEO}`).itemId, kind: byId(`角色甲/${m.VIDEO}`).kind }))
  ok(byId('场景丙').kind === 'scene' && byId('场景丙').hasScene === true && (!byId('场景丙').itemRole || byId('场景丙').itemRole === 'dir'),
    'A1j **零回归**：目录里没有 `.mpkg` ⇒ 维持"目录一条"的旧口径（`场景丙/scene.pkg` 仍是 scene 目录条）',
    JSON.stringify(byId('场景丙') && { id: byId('场景丙').itemId, kind: byId('场景丙').kind, role: byId('场景丙').itemRole }))
  ok(byId('网页丁').kind === 'web', 'A1k 网页档（无 .mpkg）照旧：目录一条 + kind=web', JSON.stringify(byId('网页丁') && { kind: byId('网页丁').kind }))
  ok(byId('空目录').kind === 'unknown', 'A1l 空目录照旧成条（unknown）', JSON.stringify(byId('空目录') && { kind: byId('空目录').kind }))
  ok((L.scan.skippedList || []).some((s) => s.name === '逃逸目录'),
    'A1m 逃逸的符号链接目录进 `scan.skippedList`（带理由，不是静默消失）', JSON.stringify(L.scan.skippedList))

  // ── A2：路由（同一套夹具）──────────────────────────────────────────────────────────────────
  section('A2 路由：/pkg/<嵌套 id> 等长、越界被拒、/api/mpkg 与缩略图、413 门槛')
  const pkgA1 = await request(P, 'GET', '/pkg/' + enc1(`角色甲/${m.A1}`))
  const stA1 = fs.statSync(path.join(fx.lib, '角色甲', m.A1))
  ok(pkgA1.status === 200 && pkgA1.bytes === stA1.size && /application\/octet-stream/.test(String(pkgA1.headers['content-type'])),
    'A2a ★`GET /pkg/<嵌套 itemId>`（`.mpkg` 一等项）⇒ **200 且与 `stat` 等长**、content-type = application/octet-stream',
    `${pkgA1.status} ${pkgA1.bytes}B vs stat ${stA1.size}B ct=${pkgA1.headers['content-type']}`)
  ok(Buffer.compare(pkgA1.buf, fs.readFileSync(path.join(fx.lib, '角色甲', m.A1))) === 0,
    'A2b `/pkg/<嵌套 id>` 回的字节与磁盘上的容器**逐字节相同**（不是被重打包/截断的另一份）', `${pkgA1.bytes}B`)
  const pkgDir = await request(P, 'GET', '/pkg/' + enc('场景丙'))
  const stDir = fs.statSync(path.join(fx.lib, '场景丙', 'scene.pkg'))
  ok(pkgDir.status === 200 && pkgDir.bytes === stDir.size,
    'A2c 老口径**逐字不变**：`/pkg/<目录 id>`（`<root>/<id>/scene.pkg`）⇒ 200 且等长',
    `${pkgDir.status} ${pkgDir.bytes}B vs stat ${stDir.size}B`)
  const pkgMiss = await request(P, 'GET', '/pkg/' + enc('不存在的包'))
  ok(pkgMiss.status === 404 && pkgMiss.body === 'no scene',
    'A2d `/pkg/<不存在>` ⇒ 404 + 老口径正文 `no scene`（既有客户端按这段文本判断，不许换字）', `${pkgMiss.status} ${JSON.stringify(pkgMiss.body)}`)
  const pkgBig = await request(P, 'GET', '/pkg/' + enc1(`大包/大_01.mpkg`))
  ok(pkgBig.status === 200 && pkgBig.bytes === fs.statSync(path.join(fx.lib, '大包', '大_01.mpkg')).size,
    'A2e 另一份 `.mpkg`（同名不同目录）同样 200 且等长（itemId 的目录那一段真的参与解析）', `${pkgBig.status} ${pkgBig.bytes}B`)

  // 越界（**一条都不许放宽**）
  const trav = [
    ['/pkg/..%2F..%2Fetc%2Fpasswd', 400, 'GET'],
    ['/api/mpkg?item=' + enc('../../outside/secret.mpkg'), 400, 'GET'],
    ['/api/mpkg?item=' + enc('/etc/passwd'), 400, 'GET'],
    ['/api/thumb?item=' + enc('../../outside/secret.mpkg'), 400, 'GET'],
    ['/api/props?item=' + enc('../../outside/secret.mpkg'), 400, 'GET'],
    ['/media/dev/' + enc('../../outside/secret.txt'), 400, 'GET'],
    ['/api/mpkg?item=' + enc('角色乙/../../outside/secret.mpkg'), 400, 'GET'],
  ]
  const travReads = []
  for (const [u, want, method] of trav) {
    const r = await request(P, method, u)
    travReads.push(`${u.split('?')[0].slice(0, 30)}…⇒${r.status}`)
    ok(r.status === want && !/TOP-SECRET/.test(r.body), `A2f 越界仍被拒（${want}）：${u.slice(0, 60)}`, `${r.status} ${r.body.slice(0, 90)}`)
  }
  console.log('  A2f 越界读数：' + travReads.join(' '))
  const lit = await request(P, 'GET', '/media/dev/../../etc/passwd')
  ok(lit.status !== 200 && !/root:/.test(lit.body),
    'A2g 字面（未编码）的 `../../`（URL 会被 `new URL()` 规范化掉 ⇒ 落到静态面）绝不是 200、也不含靶子字节（改动前后一致）',
    `${lit.status} ${JSON.stringify(lit.body.slice(0, 60))}`)
  if (fx.linkOk) {
    const esc = await request(P, 'GET', '/pkg/' + enc1(`角色乙/逃逸.mpkg`))
    ok(esc.status === 403 && !/OUTSIDE-SECRET/.test(esc.body),
      'A2h 符号链接逃逸：`/pkg/<指向库外的 .mpkg 软链>` ⇒ **403**（真身校验）且回不出靶子字节', `${esc.status} ${esc.body.slice(0, 100)}`)
    const escThumb = await request(P, 'GET', '/api/thumb?item=' + enc('角色乙/逃逸.mpkg'))
    ok(escThumb.status === 403 || (escThumb.status !== 200 && !/OUTSIDE-SECRET/.test(escThumb.body)),
      'A2h2 缩略图路由同一套校验：逃逸软链拿不到容器内 preview 字节', `${escThumb.status} ${escThumb.bytes}B`)
  } else { console.log('SKIP A2h 符号链接逃逸（本机建不了软链）') }

  // 容器面 / 缩略图 / 属性 / 媒体面的两种读法
  const mp = await request(P, 'GET', '/api/mpkg?item=' + enc(`角色甲/${m.A1}`))
  const MP = J(mp)
  ok(mp.status === 200 && MP.tableOk === true && MP.magic === 'PKGM0018' && MP.kind === 'scene' && MP.itemId === `角色甲/${m.A1}` && MP.file === m.A1,
    'A2i ★`GET /api/mpkg?item=<嵌套 id>`（单文件项形态）⇒ 只读容器目录表（magic/内层类型/file 回显）',
    `${mp.status} ${JSON.stringify({ magic: MP.magic, kind: MP.kind, file: MP.file, entries: MP.entries })}`)
  const mpDir = await request(P, 'GET', '/api/mpkg?item=' + enc('角色甲') + '&file=' + enc(m.A2))
  ok(mpDir.status === 200 && J(mpDir).magic === 'PKGM0014' && J(mpDir).kind === 'video',
    'A2i2 老形状（`item=<目录>&file=<容器名>`）逐字不变 ⇒ 200 + 同一个容器的目录表', `${mpDir.status} ${J(mpDir).magic}`)
  const mpEsc = await request(P, 'GET', '/api/mpkg?item=' + enc('角色甲') + '&file=' + enc('../../secret.txt'))
  ok(mpEsc.status === 400, 'A2i3 `/api/mpkg` 的 `file` 参数带路径 ⇒ 400（这条老判据不许回退）', String(mpEsc.status))
  const th = await request(P, 'GET', '/api/thumb?item=' + enc(`角色甲/${m.A1}`))
  ok(th.status === 200 && /image\/gif/.test(String(th.headers['content-type'])) && th.headers['x-bench-thumb'] === 'container-preview' && th.buf.toString('latin1', 0, 6) === 'GIF89a',
    'A2j ★缩略图：`/api/thumb?item=<嵌套 id>` ⇒ 容器内**未压缩** preview.* 直出（列表出图不需要解包）',
    `${th.status} ${th.headers['content-type']} ${th.headers['x-bench-thumb']} ${th.bytes}B`)
  const pr = await request(P, 'GET', '/api/props?item=' + enc(`角色甲/${m.A1}`))
  const PR = J(pr)
  ok(pr.status === 200 && PR.itemId === `角色甲/${m.A1}` && PR.itemRole === 'file' && Array.isArray(PR.props) && PR.props.length >= 1 && /角色甲$/.test(String(PR.propsSourceDir)),
    'A2k `/api/props?item=<嵌套 id>` ⇒ 属性表来自**条目所在目录**的 `project.json`（包旁 JSON 的工坊口径）',
    `${pr.status} props=${PR.props && PR.props.length} src=${PR.propsSourceDir}`)
  const medNested = await request(P, 'GET', '/media/dev/' + enc1(`角色甲/${m.A1}`))
  const medOld = await request(P, 'GET', '/media/dev/' + enc('角色甲') + '/' + enc(m.A1))
  ok(medNested.status === 200 && medOld.status === 200 && Buffer.compare(medNested.buf, medOld.buf) === 0 && medNested.bytes === stA1.size,
    'A2l `/media/dev/**` 的**两种读法**（嵌套 itemId 一次给全 / `<目录>/<文件>` 老写法）都 200 且字节相同',
    `${medNested.status}/${medOld.status} ${medNested.bytes}B/${medOld.bytes}B`)
  const delDry = await request(P, 'POST', '/api/delete', { body: JSON.stringify({ itemId: `角色甲/${m.A1}` }), headers: { 'content-type': 'application/json' } })
  const stillThere = fs.existsSync(path.join(fx.lib, '角色甲', m.A1))
  ok(delDry.status === 200 && J(delDry).dryRun === true && J(delDry).itemRole === 'file' && stillThere,
    'A2m `/api/delete` 对文件型条目**默认 dryRun**（只回计划、`itemRole:"file"`、文件原地不动）',
    `${delDry.status} ${JSON.stringify({ dryRun: J(delDry).dryRun, role: J(delDry).itemRole, from: J(delDry).from })}`)
  const rv = await request(P, 'POST', '/api/reveal', { body: JSON.stringify({ itemId: `角色甲/${m.A1}` }), headers: { 'content-type': 'application/json' } })
  ok(rv.status === 200 && J(rv).opened === true && /角色甲$/.test(String(J(rv).path)),
    'A2n `/api/reveal` 对文件型条目"打开所在文件夹" ⇒ 落点是**它所在的目录**（不是把容器交给打开器）',
    `${rv.status} ${J(rv).path}`)
}

/** A2o：413 门槛（独立实例，`MPW_LIMIT_PKG_BYTES=1`）——**如实 413，绝不截断**。
 *
 *  ①(2026-10-12 台账 §1.2 第 45 项 / §1.3 第 88 项 G2h) **中间边界值**：此前只用 `MPW_LIMIT_PKG_BYTES=1`
 *  这种"病态档"（离真实边界无穷远），判不出**恰好等于上限**这一格。补 A2o4/A2o5 两格把它钉死：
 *    · `limit == 文件字节数` ⇒ **200 + 逐字节相等**（判定式是 `size > limit`，"等于"必须放行）；
 *    · `limit == 文件字节数 − 1` ⇒ **413**（只差 1 字节也必须拒 ⇒ 证明这不是"恒 413/恒 200"的假判据）。
 *  变异自证：把服务端判定改成 `>=`（一位之差）⇒ A2o4 必红（见 MUTATIONS 的 M6）。 */
async function thresholdStage(fx) {
  section('A2o 413 门槛（MPW_LIMIT_PKG_BYTES=1 的独立实例）：超限如实 413、正文说明不截断')
  const srv = await startServer(fx, { MPW_LIMIT_PKG_BYTES: '1' })
  try {
    const r1 = await request(srv.port, 'GET', '/pkg/' + enc(`角色甲/${fx.names.A1}`))
    const r2 = await request(srv.port, 'GET', '/pkg/' + enc('场景丙'))
    ok(r1.status === 413 && /MPW_LIMIT_PKG_BYTES/.test(r1.body) && /不截断/.test(r1.body),
      'A2o ★`.mpkg` 超上限 ⇒ **413** + 正文给出上限来源与"本路由不截断包体"', `${r1.status} ${r1.body.slice(0, 120)}`)
    ok(r2.status === 413, 'A2o2 同一把尺子也管老口径（目录型 `scene.pkg`）⇒ 413', String(r2.status))
    const head = await request(srv.port, 'HEAD', '/pkg/' + enc(`角色甲/${fx.names.A1}`))
    ok(head.status === 413, 'A2o3 HEAD 同样如实 413（不是"HEAD 放行、GET 拒绝"的两套口径）', String(head.status))
  } finally { stop(srv) }

  /* ── A2o4/A2o5：中间边界值（恰好等于上限 / 只差 1 字节）────────────────────────────────────── */
  const rel = `角色甲/${fx.names.A1}`
  const abs = path.join(fx.lib, '角色甲', fx.names.A1)
  const want = fs.readFileSync(abs)
  const size = want.length
  section(`A2o 中间边界值：limit == 文件大小（${size}B）⇒ 200；limit == 大小−1 ⇒ 413`)
  const srvEq = await startServer(fx, { MPW_LIMIT_PKG_BYTES: String(size) })
  try {
    const g = await request(srvEq.port, 'GET', '/pkg/' + enc(rel))
    const same = g.buf.length === want.length && Buffer.compare(g.buf, want) === 0
    ok(g.status === 200 && same,
      `A2o4 ★恰好等于上限（limit=${size}）⇒ **200 且逐字节相等**（判定式是 size > limit，"等于"放行；不许是截断或 413）`,
      `${g.status} ${g.bytes}B/${size}B 逐字节相等=${same}`)
    const h = await request(srvEq.port, 'HEAD', '/pkg/' + enc(rel))
    ok(h.status === 200 && Number(h.headers['content-length']) === size,
      'A2o5 同一档的 HEAD：200 且 Content-Length = stat 字节数（HEAD 与 GET 同一把尺子）',
      `${h.status} len=${h.headers['content-length']} vs ${size}`)
  } finally { stop(srvEq) }
  const srvMinus = await startServer(fx, { MPW_LIMIT_PKG_BYTES: String(size - 1) })
  try {
    const g = await request(srvMinus.port, 'GET', '/pkg/' + enc(rel))
    ok(g.status === 413,
      `A2o5b **只差 1 字节**（limit=${size - 1}）⇒ 413（与 A2o4 一红一绿 ⇒ 判据真的卡在边界上，不是恒真/恒假）`,
      `${g.status} ${g.body.slice(0, 80)}`)
  } finally { stop(srvMinus) }
}

/** A2p：**并发**下的流式发送（G2h 的"并发未验"那一半）。
 *
 *  同一个进程里 12 发并发（6 整包 GET + 3 Range 206 + 3 HEAD），断言：状态码/长度/首尾字节各自正确、
 *  **互不串包**（每发都与夹具文件逐字节/逐段相等）、以及跑完服务仍健康（没被并发拖死）。
 *  口径：软件 GL/单线程 Node 上这条测的是**流式发送的状态隔离**（`sendFileStream` 每请求独立 fd/游标），
 *  不是吞吐基准 ⇒ 只判正确性 + 打一条耗时读数。 */
async function concurrencyStage(fx) {
  const rel = `角色甲/${fx.names.A1}`
  const abs = path.join(fx.lib, '角色甲', fx.names.A1)
  const want = fs.readFileSync(abs)
  const size = want.length
  section(`A2p 并发（12 发：整包 GET ×6 + Range 206 ×3 + HEAD ×3；文件 ${size}B）`)
  const srv = await startServer(fx, { MPW_LIMIT_PKG_BYTES: String(size) })
  try {
    const t0 = Date.now()
    const full = Array.from({ length: 6 }, () => request(srv.port, 'GET', '/pkg/' + enc(rel)))
    const range = Array.from({ length: 3 }, () => request(srv.port, 'GET', '/pkg/' + enc(rel), { headers: { Range: 'bytes=0-31' } }))
    const heads = Array.from({ length: 3 }, () => request(srv.port, 'HEAD', '/pkg/' + enc(rel)))
    const [F, R, H] = await Promise.all([Promise.all(full), Promise.all(range), Promise.all(heads)])
    const ms = Date.now() - t0
    const fOk = F.every((r) => r.status === 200 && r.buf.length === want.length && Buffer.compare(r.buf, want) === 0)
    const rOk = R.every((r) => r.status === 206 && r.bytes === 32 && Buffer.compare(r.buf, want.subarray(0, 32)) === 0)
    const hOk = H.every((r) => r.status === 200 && Number(r.headers['content-length']) === size)
    ok(fOk, 'A2p1 6 发并发整包 GET：全部 200 且**逐字节等于夹具**（无串包/无截断）',
      `状态=${F.map((r) => r.status).join(',')} 长度=${F.map((r) => r.bytes).join(',')} vs ${size}`)
    ok(rOk, 'A2p2 3 发并发 Range（bytes=0-31）：全部 **206 + 32B + 内容等于文件前 32B**',
      `状态=${R.map((r) => r.status).join(',')} 长度=${R.map((r) => r.bytes).join(',')}`)
    ok(hOk, 'A2p3 3 发并发 HEAD：全部 200 且 Content-Length = stat（三种方法同一把尺子）',
      `状态=${H.map((r) => r.status).join(',')} len=${H.map((r) => r.headers['content-length']).join(',')}`)
    const health = await request(srv.port, 'GET', '/__health')
    ok(health.status === 200, 'A2p4 并发跑完服务仍健康（/__health 200）：并发没有把单线程事件循环拖死', `${health.status}`)
    console.log(`  A2p 读数：12 发并发总耗时 ${ms}ms（参考值，非断言阈值）`)
  } finally { stop(srv) }
}

// ── A3：真语料（条件项；库根不存在 ⇒ SKIP 并打印读数）─────────────────────────────────────────
async function corpusStage() {
  section('A3 真语料（条件项）：wallpaperE 每个 .mpkg 都在列表里；dd 零回归')
  if (!fs.existsSync(CORPUS_MPKG)) { console.log(`SKIP A3 —— 语料库不存在：${CORPUS_MPKG}（不是通过，是缺数据）`); return }
  const dirs = fs.readdirSync(CORPUS_MPKG).filter((n) => { try { return fs.statSync(path.join(CORPUS_MPKG, n)).isDirectory() } catch { return false } })
  const mpkg = []
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(CORPUS_MPKG, d))) {
      if (/\.mpkg$/i.test(f)) mpkg.push(d + '/' + f)
    }
  }
  const fx = { root: path.join(CORPUS_MPKG, '..', '..'), lib: CORPUS_MPKG }
  const srv = await startServer(fx, { MPW_PICK_ROOT: path.join(CORPUS_MPKG, '..') })
  try {
    const L = J(await request(srv.port, 'GET', '/api/library'))
    const items = L.items || []
    const fileItems = items.filter((i) => i.itemRole === 'file')
    const mpkgItems = fileItems.filter((i) => /\.mpkg$/i.test(String(i.file)))
    console.log(`  A3 读数：磁盘 ${mpkg.length} 个 .mpkg（${dirs.length} 个目录）/ 列表 items=${L.count}（file=${fileItems.length} mpkg=${mpkgItems.length} dir=${items.length - fileItems.length}）kinds=${JSON.stringify(L.scan && L.scan.kinds)}`)
    console.log('  A3 抽样 5 条：\n' + mpkgItems.slice(0, 5).map((i) => `    itemId=${i.itemId}  type=${i.type}  file=${i.file}  hasScene=${i.hasScene}  renderable=${i.renderable}`).join('\n'))
    ok(mpkgItems.length === mpkg.length,
      `A3a ★真语料：磁盘上每个 .mpkg 都在列表里成条（${mpkg.length} 个 ⇒ ${mpkgItems.length} 条）`,
      `disk=${mpkg.length} items=${mpkgItems.length} count=${L.count}`)
    ok(mpkgItems.length === mpkg.length && mpkgItems.every((i) => i.itemId === `${i.parentDir}/${i.file}` && i.parentDir && i.file),
      'A3b 每条 itemId = **相对库根的嵌套路径** <目录>/<文件名>（不是 basename、也不是目录名）',
      JSON.stringify(mpkgItems.slice(0, 3).map((i) => i.itemId)))
    const sceneOnes = mpkgItems.filter((i) => i.type === 'scene')
    ok(sceneOnes.length > 0 && mpkgItems.some((i) => i.type === 'video'),
      'A3c 真语料的类型判定两类都出（scene = 容器里有 scene.json；video = 纯视频容器）',
      JSON.stringify(L.scan && L.scan.kinds))
    /* `/pkg/<真语料嵌套 id>`：抽**最小**的一个 scene 包做整包等长（本机最大的一份 294MB，不在门禁里整包拉）。 */
    const sized = sceneOnes.map((i) => ({ i, size: (() => { try { return fs.statSync(path.join(CORPUS_MPKG, i.itemId)).size } catch { return -1 } })() }))
      .filter((x) => x.size > 0).sort((a, b) => a.size - b.size)
    if (sized.length) {
      const pick = sized[0]
      const r = await request(srv.port, 'GET', '/pkg/' + pick.i.itemId.split('/').map(enc).join('/'))
      ok(r.status === 200 && r.bytes === pick.size,
        `A3d ★真语料 /pkg/<嵌套 id> ⇒ 200 且与 stat 等长（本条取最小的一份：${pick.i.itemId}）`,
        `${r.status} ${r.bytes}B vs stat ${pick.size}B`)
      const big = sized[sized.length - 1]
      const hr = await request(srv.port, 'HEAD', '/pkg/' + big.i.itemId.split('/').map(enc).join('/'))
      const rr = await request(srv.port, 'GET', '/pkg/' + big.i.itemId.split('/').map(enc).join('/'), { headers: { Range: 'bytes=0-1023' } })
      ok(hr.status === 200 && Number(hr.headers['content-length']) === big.size && rr.status === 206 && rr.bytes === 1024,
        `A3e 最大的那份（${(big.size / 1048576).toFixed(1)}MB）走**流式**：HEAD 的 Content-Length = stat，Range 取 1KB ⇒ 206（不整包进内存）`,
        `HEAD ${hr.status} len=${hr.headers['content-length']} vs ${big.size} · Range ${rr.status} ${rr.bytes}B`)
    }
  } finally { stop(srv) }
  if (fs.existsSync(CORPUS_DD)) {
    const fx2 = { root: path.join(CORPUS_DD, '..', '..'), lib: CORPUS_DD }
    const srv2 = await startServer(fx2, { MPW_PICK_ROOT: path.join(CORPUS_DD, '..') })
    try {
      const L2 = J(await request(srv2.port, 'GET', '/api/library'))
      const nDirs = fs.readdirSync(CORPUS_DD).filter((n) => { try { return fs.statSync(path.join(CORPUS_DD, n)).isDirectory() } catch { return false } }).length
      ok((L2.items || []).every((i) => i.itemRole !== 'file') && L2.count >= nDirs,
        `A3f **零回归**：老布局（dd，<id>/scene.pkg）仍然只有"目录条"，一条文件条都不多（dirs=${nDirs} items=${L2.count}）`,
        JSON.stringify({ dirs: nDirs, count: L2.count, fileItems: (L2.items || []).filter((i) => i.itemRole === 'file').length }))
    } finally { stop(srv2) }
  } else { console.log('SKIP A3f —— dd 语料不存在：' + CORPUS_DD) }
}

/* ═══════════════════════════ 变异自证（MUTANT-RED-OK：改回去必须红）═══════════════════════════
   做法与 `tests/bench-dsh-libroot-test.mjs` 同源：把**真文件**复制到仓库根下的临时镜像里做变异
   （真树一字不动；镜像里用软链指向真树 ⇒ 被测文件的 `__dirname/..` 推出来的 REPO_ROOT 天然成立）。 */
const MUTATIONS = [
  {
    name: 'M1 把"逐文件成项"退回"目录一条"（`libraryEntriesForDir` 恒回目录条）',
    expects: ['A1a', 'A1g', 'A1h'],
    apply(files) {
      const from = '  const mpkgNames = names.filter((n) => MPKG_COLLECTION_RE.test(n))\n  if (!mpkgNames.length) return [libraryItemFromDir(id, dir, budget)]'
      const to = '  const mpkgNames = names.filter((n) => MPKG_COLLECTION_RE.test(n))\n  if (true) return [libraryItemFromDir(id, dir, budget)]   // 变异：退回"目录一条"'
      if (files.main.split(from).length !== 2) return { error: '锚点未命中唯一位置：libraryEntriesForDir 的早退分支' }
      return { main: files.main.replace(from, to) }
    },
  },
  {
    name: 'M4 拆掉"库根顶层散落容器成条"（顶层 `.mpkg` 又只进 looseMpkg 计数）',
    expects: ['A1m'],
    apply(files) {
      const from = "      const looseRe = MPKG_EXT_RE.test(name) ? MPKG_EXT_RE : (VIDEO_EXT_RE.test(name) ? VIDEO_EXT_RE : null)"
      const to = "      const looseRe = null   // 变异：顶层散落容器不成条（回到 P-261 之前的「只计数」口径）"
      if (files.main.split(from).length !== 2) return { error: '锚点未命中唯一位置：listLibrary 顶层散落容器分支' }
      return { main: files.main.replace(from, to) }
    },
  },
  {
    name: 'M2 去掉 `/pkg` 的 `.mpkg` 分支（文件型 itemId 又变回 404）',
    expects: ['A2a', 'A2b', 'A2e'],
    apply(files) {
      const from = "          if (r.ok) { if (r.isFile && /\\.(mpkg|pkg)$/i.test(cand)) { hit = { file: r.full, size: r.st.size, from: 'container-file' }; break } }"
      const to = "          if (r.ok) { if (false) { hit = { file: r.full, size: r.st.size, from: 'container-file' }; break } }   // 变异：去掉 mpkg 分支"
      if (files.renderer.split(from).length !== 2) return { error: '锚点未命中唯一位置：/pkg 的 mpkg 分支' }
      return { renderer: files.renderer.replace(from, to) }
    },
  },
  {
    name: 'M3 放宽越界校验（拆掉 `assertItemPath` 的 `..` + `safeJoin` 的三道 + `itemLocate` 的真身校验）',
    expects: ['A2f', 'A2h'],
    apply(files) {
      /* ⚠ 为什么一次拆**五处**：路径安全在这里是**纵深防御**（段校验 ⇒ `..` 判定 ⇒ 词法前缀 ⇒ 真身），
         只拆一层另一层还兜得住 ⇒ 判据不会红，那就不构成"变异自证"。这一组就是任务书里点名不许做的那件事
         （"为了省事放宽越界防护"）⇒ 必须看见判据变红（`A2f`/`A2h`）。 */
      const pairs = [
        ["    if (s === '.' || s === '..' || s[0] === '.') throw bad(`itemId 段非法（不许以 \".\" 开头）：${String(id).slice(0, 120)}`)",
          "    if (s === '.') throw bad(`itemId 段非法：${String(id).slice(0, 120)}`)   // 变异：`..` 不再被拒", 'assertItemPath 的 .. 判定'],
        ["    if (dec.split(/[\\\\/]+/).includes('..')) throw bad(`${what} 含 \"..\"：${input}`)\n    norm = path.resolve(rootReal, dec)",
          "    norm = path.resolve(rootReal, dec)   // 变异：safeJoin 不再拒 `..`", 'safeJoin 的 .. 判定'],
        ["  if (!isInside(rootReal, norm)) throw forbidden(`${what} 越出根目录（库根/浏览根）：${input}`)",
          "  // 变异：越根（词法）不再拒", 'safeJoin 的词法越根判定'],
        ["  if (!isInside(rootReal, real)) throw forbidden(`${what} 经符号链接越出根目录（库根/浏览根）：${input}`)",
          "  // 变异：越根（真身）不再拒", 'safeJoin 的真身越根判定'],
        ['  if (!isInside(activeRoot, real)) throw forbidden(`条目经符号链接越出库根：${rel}`)',
          '  // 变异：itemLocate 的真身越根不再拒', 'itemLocate 的真身越根判定'],
      ]
      for (const [a, , why] of pairs) {
        if (files.main.split(a).length !== 2) return { error: '锚点未命中唯一位置：' + why }
      }
      let out = files.main
      for (const [a, b] of pairs) out = out.replace(a, b)
      return { main: out }
    },
  },
  {
    name: 'M4 嵌套 itemId 从查询参数路由里退回（`itemLocate` 改用单段 `assertItemId`）',
    expects: ['A2i', 'A2j', 'A2k'],
    apply(files) {
      const from = 'function itemLocate(id) {\n  const rel = assertItemPath(id)'
      const to = 'function itemLocate(id) {\n  const rel = assertItemId(id)   // 变异：只认单段 itemId'
      if (files.main.split(from).length !== 2) return { error: '锚点未命中唯一位置：itemLocate 的段校验' }
      return { main: files.main.replace(from, to) }
    },
  },
  {
    /* ①(2026-10-12 §1.2 #45 / §1.3 #88 G2h) **一位之差**（`>` → `>=`）：恰好等于上限的那一格必须变红。
       这是"边界判据真的卡在边界上"的自证 —— 若只测病态档（limit=1），这个变异**不会红**。 */
    name: 'M6 413 判定改成 `>=`（一位之差：恰好等于上限也从 200 变 413）',
    expects: ['A2o4'],
    apply(files) {
      const from = '      if (hit.size > PKG_MAX_BYTES) {'
      const to = '      if (hit.size >= PKG_MAX_BYTES) {   // 变异：一位之差（恰好等于上限也拒）'
      if (files.renderer.split(from).length !== 2) return { error: '锚点未命中唯一位置：/pkg 的 PKG_MAX_BYTES 判定' }
      return { renderer: files.renderer.replace(from, to) }
    },
  },
]

function runChild(args, ms) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.resolve(import.meta.dirname, 'bench-mpkg-items-test.mjs'), ...args], {
      cwd: ROOT, env: Object.assign({}, process.env), stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', (c) => { out += c.toString() })
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已退 */ } }, ms || 300000)
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out }) })
  })
}
const parseChildJson = (out) => {
  const line = out.split('\n').filter((l) => l.startsWith('BENCH-MPKG-ITEMS-JSON ')).pop()
  if (!line) return null
  try { return JSON.parse(line.slice('BENCH-MPKG-ITEMS-JSON '.length)) } catch { return null }
}
/** 造镜像：`<tmp>/mN/{server/*, core -> repo/core, demo -> repo/demo, …}`（与 bench-dsh-libroot 同款）。 */
function buildMirror(mtDir, idx, mainSrc, rendSrc) {
  const d = path.join(mtDir, 'm' + idx)
  const srv = path.join(d, 'server')
  fs.mkdirSync(srv, { recursive: true })
  const SKIP_TOP = new Set(['server', 'node_modules', 'tests', 'docs', 'reports', 'archive', '.git'])
  for (const top of fs.readdirSync(ROOT)) {
    if (SKIP_TOP.has(top) || top.startsWith('.')) continue
    try { fs.symlinkSync(path.join(ROOT, top), path.join(d, top)) } catch { /* 已存在/不支持 */ }
  }
  for (const name of fs.readdirSync(path.join(ROOT, 'server'))) {
    if (name === 'we-scene-demo-server-8902.mjs' || name === 'we-scene-demo-server.mjs') continue
    try { fs.symlinkSync(path.join(ROOT, 'server', name), path.join(srv, name)) } catch { /* 已存在 */ }
  }
  fs.writeFileSync(path.join(srv, 'we-scene-demo-server.mjs'), rendSrc)
  const mainPath = path.join(srv, 'we-scene-demo-server-8902.mjs')
  fs.writeFileSync(mainPath, mainSrc)
  return mainPath
}
async function mutateRed() {
  const mtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-mpkg-items-mut-'))
  const rows = []
  try {
    const base = { main: fs.readFileSync(SERVER_UNDER_TEST, 'utf8'), renderer: fs.readFileSync(RENDERER_UNDER_TEST, 'utf8') }
    for (let i = 0; i < MUTATIONS.length; i++) {
      const m = MUTATIONS[i]
      const r = m.apply(Object.assign({}, base))
      if (r.error) { ok(false, `变异${i + 1} 可施加（锚点唯一）`, r.error); continue }
      const mainPath = buildMirror(mtDir, i + 1, r.main || base.main, r.renderer || base.renderer)
      const res = await runChild([`--server=${mainPath}`, `--renderer=${path.join(path.dirname(mainPath), 'we-scene-demo-server.mjs')}`, '--no-mutant'])
      const j = parseChildJson(res.out)
      const redLines = res.out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 6)
      const redNames = ((j && j.failed) || []).map((f) => f.name)
      const expectHit = m.expects.filter((e) => redNames.some((n) => n.startsWith(e)))
      console.log(`\n─── 变异 ${i + 1}：${m.name}`)
      console.log(`    子进程退出码 = ${res.code}（要求 1）`)
      console.log(`    RED 行（原文）：\n${redLines.map((l) => '      ' + l).join('\n') || '      (无 FAIL 行)'}`)
      ok(res.code === 1 && redLines.length > 0, `变异${i + 1} 必红：子进程退出码 1 且有 FAIL`, `code=${res.code} fails=${redNames.length}`)
      ok(expectHit.length > 0, `变异${i + 1} 红的正是被变异掉的判据（${m.expects.join('/')}）`,
        `命中=${expectHit.join(',') || '无'} 实际=${redNames.join(' | ').slice(0, 260)}` + (j ? '' : ' · 子进程读数缺失，尾部=' + JSON.stringify(res.out.slice(-300))))
      rows.push({ i: i + 1, name: m.name, code: res.code, red: redNames, hit: expectHit })
    }
  } finally {
    try { fs.rmSync(mtDir, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
  }
  return rows
}

// ── 主流程 ────────────────────────────────────────────────────────────────────────────────────
const fx = makeFixture()
const srv = await startServer(fx)
try {
  section('A1 扫描器：逐文件成项 + 容器内类型判定 + 目录条不重复计数（真起一份 8902）')
  await scanStage(fx, srv)
  await thresholdStage(fx)
  await concurrencyStage(fx)
  await corpusStage()
} finally { stop(srv) }

if (!NO_MUTANT) {
  section('变异自证（镜像里改，真树一字不动）')
  const a = fs.readFileSync(SERVER_UNDER_TEST, 'utf8') + fs.readFileSync(RENDERER_UNDER_TEST, 'utf8')
  await mutateRed()
  const b = fs.readFileSync(SERVER_UNDER_TEST, 'utf8') + fs.readFileSync(RENDERER_UNDER_TEST, 'utf8')
  ok(a === b, '真树两个服务文件跑前跑后逐字相同（变异只在镜像里；并行编辑会假红）', a === b ? '长度与内容相同' : '内容变了')
  console.log('MUTANT-RED-OK ' + JSON.stringify(failed.length === 0 ? '（本轮全部变异都已变红，见上）' : '（有未变红的变异，见上）'))
}

/* ── 收尾 ───────────────────────────────────────────────────────────────────────────────────── */
try { fs.rmSync(fx.base, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
console.log(`\n═══ 汇总：PASS=${pass} FAIL=${failed.length} ═══`)
for (const f of failed) console.log('  FAIL ' + f.name + (f.reading ? ' — ' + f.reading : ''))
try { fs.writeSync(1, 'BENCH-MPKG-ITEMS-JSON ' + JSON.stringify({ pass, failed: failed.map((f) => ({ name: f.name, reading: f.reading })) }) + '\n') } catch { /* 已关 */ }
if (JSON_OUT) console.log(JSON.stringify({ pass, failed }, null, 1))
process.exit(failed.length === 0 ? 0 : 1)

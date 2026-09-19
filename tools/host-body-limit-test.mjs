// tools/host-body-limit-test.mjs —— 宿主侧 POST 接收端的**超限语义**回归（真 HTTP + 变异自证）
//
// 为什么单开一条（而不是塞进 diag-subsystem-test）：
//   那条测的是**客户端**（payload 组装 / 一键发送 / 客户端瘦身），宿主路由是用桩 `fetch` 假的；
//   而"超限时客户端到底看到什么"只有**真 socket** 才测得出来 —— 这正是本条要钉的东西。
//
// 背景（同类缺陷，2026-09-20 在渲染器仓发现后一并查到这里）：
//   `lib/index.js` 两个 POST 接收端原来都是 `if (body.length > CAP) req.destroy()`：
//   **先掐连接再写响应** ⇒ 客户端拿到 `ECONNRESET`（真机实测 curl `status=100 / exit=56`），
//   "如实回 413 + JSON 说明"这条口径在超限路上从来没成立过。
//   修法口径（与 `we-scene-demo` 那四处一致）：**继续把请求体读干净但不再缓存**，到 `end` 回 413。
//   ⚠ 不能用 `req.pause()`：请求体没读完 ⇒ `end` 永不触发 ⇒ 请求挂死（渲染器仓实测 25s 超时）。
//
// 判据：
//   A1 POST /diag 正常档 ⇒ 200 + `{ok:true,file}` + **字节逐字落盘**（夹具目录）
//   A2 POST /diag 超限（>8MB）⇒ **413 + JSON 说明**（不是 ECONNRESET/100）、**一个字节都没落盘**、
//      紧接的正常档仍 200（服务不崩）
//   A3 POST /custom-scene-thumb 超限 ⇒ **413 且带 CORS 头**（跨源渲染器要能读到原因）
//   B  **分辨力自证**：把 `lib/index.js` 拷到 mkdtemp 里**改回 `req.destroy()`** ⇒ A2 必须变红
//      （即"客户端能读到 413"这条判据不是永远为真）；变异只发生在副本里，真树跑前跑后 sha256 相同
//
// 卫生：夹具（diag 目录）与变异副本都在 mkdtemp 下，退出兜底清理；不写仓库内目录、不碰用户设置。
// 用法: node tools/host-body-limit-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const INDEX = path.join(repoRoot, 'lib', 'index.js')
const BASE = '/api/mpkg-wallpaper'

let pass = 0, fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')) }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-bodylimit-'))
const cleanup = () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* tmp 清不掉不致命 */ } }
process.on('exit', cleanup)

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const treeShaBefore = sha(INDEX)

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer()
  s.on('error', rej)
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
})

/** 起一个"最小宿主"：把 `apply()` 注册的路由挂到真 http 服务上（exact 匹配 pathname）。 */
async function bootHost(indexPath, diagDir) {
  process.env.DSH_WE_DIAG_DIR = diagDir      // lib/index.js 模块顶层读它 ⇒ 必须在 import 之前设
  const mod = await import(pathToFileURL(indexPath).href + '?t=' + Date.now())
  const routes = new Map()
  mod.apply({ webServer: { register: (r) => { routes.set(r.path, r); return { dispose() {} } } }, loader: null, logger: { info() {}, warn() {}, error() {} } })
  const port = await freePort()
  const server = http.createServer((req, res) => {
    let url = null
    try { url = new URL(req.url, 'http://127.0.0.1') } catch { res.writeHead(400); return res.end('bad url') }
    const r = routes.get(url.pathname)
    if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"no route"}') }
    try { Promise.resolve(r.handler(req, res, url)).catch((e) => { try { res.writeHead(500); res.end(String(e && e.message || e)) } catch { /* 已响应 */ } }) } catch (e) { try { res.writeHead(500); res.end(String(e && e.message || e)) } catch { /* 已响应 */ } }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { port, base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => server.close(r)), hasDiag: routes.has(BASE + '/diag'), hasThumb: routes.has(BASE + '/custom-scene-thumb') }
}
/** POST 原始字节；**把"连接被掐"也如实返回**（ECONNRESET 与 413 必须区分得开）。 */
function post(base, p, body, headers) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: Number(new URL(base).port), method: 'POST', path: p, headers: Object.assign({ 'content-length': body.length }, headers || {}) }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), err: '' }))
    })
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', err: String(e && e.code || e && e.message || e) }))
    req.setTimeout(20000, () => { try { req.destroy(new Error('client-timeout')) } catch { /* 已断 */ } })
    req.write(body)
    req.end()
  })
}
const listing = (d) => { try { return fs.readdirSync(d) } catch { return [] } }

/* ═══ A 段：真 HTTP ═══ */
console.log('══ 宿主 POST 接收端超限语义（真 HTTP）══')
{
  const diagDir = path.join(tmpRoot, 'diag')
  const host = await bootHost(INDEX, diagDir)
  try {
    ok(host.hasDiag && host.hasThumb, '路由已注册（/diag 与 /custom-scene-thumb）', '/diag=' + host.hasDiag + ' thumb=' + host.hasThumb)
    // A1 正常档
    const small = Buffer.from(JSON.stringify({ why: 'bodylimit-test', subsystems: { fields: {} } }))
    const r1 = await post(host.base, BASE + '/diag', small, { 'content-type': 'application/json' })
    let j1 = {}; try { j1 = JSON.parse(r1.body) } catch { /* 断言会报 */ }
    const files1 = listing(diagDir)
    ok(r1.status === 200 && j1.ok === true && /diag-\d+\.json$/.test(String(j1.file)) && files1.length === 1,
      'A1 正常档 ⇒ 200 + {ok:true,file} + 落盘 1 份', `status=${r1.status} file=${j1.file} files=${files1.length}`)
    ok(files1.length === 1 && fs.readFileSync(path.join(diagDir, files1[0])).equals(small),
      'A1b 落盘字节**逐字相同**（没有隐式改写/截断）', 'bytes=' + small.length)
    // A2 超限档
    const big = Buffer.alloc(8 * 1024 * 1024 + 4096, 0x78)     // 8MB+4KB：超过 DIAG_BODY_MAX
    const r2 = await post(host.base, BASE + '/diag', big, { 'content-type': 'application/json' })
    let j2 = {}; try { j2 = JSON.parse(r2.body) } catch { /* 断言会报 */ }
    ok(r2.status === 413 && j2.ok === false && /上限/.test(String(j2.error)) && !r2.err,
      'A2 超限 ⇒ **413 + JSON 说明**（不是 ECONNRESET、不是 100/连接被掐）',
      `status=${r2.status} err=${r2.err || '-'} body=${r2.body.slice(0, 90)}`)
    ok(listing(diagDir).length === 1, 'A2b 超限载荷**一个字节都没落盘**（条目数不变）', 'files=' + listing(diagDir).length)
    const r3 = await post(host.base, BASE + '/diag', small, { 'content-type': 'application/json' })
    ok(r3.status === 200 && listing(diagDir).length === 2, 'A2c 紧接的正常档仍 200（超限没把服务/路由打崩）', 'status=' + r3.status + ' files=' + listing(diagDir).length)
    // A3 跨源 + 超限：/custom-scene-thumb
    const r4 = await post(host.base, BASE + '/custom-scene-thumb', Buffer.alloc(3 * 1024 * 1024 + 4096, 0x79),
      { 'content-type': 'application/json', origin: 'null' })
    let j4 = {}; try { j4 = JSON.parse(r4.body) } catch { /* 断言会报 */ }
    ok(r4.status === 413 && j4.ok === false && /上限/.test(String(j4.error)) &&
      !!r4.headers['access-control-allow-origin'],
      'A3 /custom-scene-thumb 超限 ⇒ 413 **且带 CORS 头**（不透明源渲染器也能读到原因）',
      `status=${r4.status} cors=${JSON.stringify(r4.headers['access-control-allow-origin'])} body=${r4.body.slice(0, 80)}`)
  } finally { await host.stop() }
}

/* ═══ B 段：分辨力自证（副本里改回 req.destroy() ⇒ A2 必须变红）═══ */
console.log('\n══ B 分辨力自证（变异只发生在 mkdtemp 副本里）══')
{
  const src = fs.readFileSync(INDEX, 'utf8')
  const from = "            if (body.length > DIAG_BODY_MAX) { tooBig = true; body = ''; }"
  const to = "            if (body.length > DIAG_BODY_MAX) { req.destroy(); }"
  const mutated = src.replace(from, to)
  if (mutated === src) {
    ok(false, '变异注入成功（锚点唯一）', '锚点没匹配上：lib/index.js 的 /diag 超限行被改过？')
  } else {
    // ⚠ 变异副本不能只拷 index.js：它 `import './pkg-extract.js'` / `'./web-wallpaper.js'`，
    //   还 `new URL('../package.json', import.meta.url)` ⇒ 得把 **lib/ 整目录 + package.json** 一起拷
    //   （只拷单文件会 ERR_MODULE_NOT_FOUND；渲染器仓那边的变异夹具踩过同一个坑）。
    const mutLib = path.join(tmpRoot, 'mut', 'lib')
    fs.mkdirSync(mutLib, { recursive: true })
    for (const f of fs.readdirSync(path.join(repoRoot, 'lib'))) {
      const src2 = path.join(repoRoot, 'lib', f)
      if (!fs.statSync(src2).isFile()) continue          // liquid-glass/ 是目录：本测试用不到它
      fs.copyFileSync(src2, path.join(mutLib, f))
    }
    fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(tmpRoot, 'mut', 'package.json'))
    const copy = path.join(mutLib, 'index.js')
    fs.writeFileSync(copy, mutated)
    const diagDir2 = path.join(tmpRoot, 'diag-mut')
    const host2 = await bootHost(copy, diagDir2)
    try {
      const big = Buffer.alloc(8 * 1024 * 1024 + 4096, 0x78)
      const r = await post(host2.base, BASE + '/diag', big, { 'content-type': 'application/json' })
      ok(!(r.status === 413 && /上限/.test(r.body)),
        'B1 改回 `req.destroy()` ⇒ 客户端**拿不到** 413/说明（这条判据有分辨力）',
        `status=${r.status} err=${r.err || '-'} body=${r.body.slice(0, 60) || '-'}`)
      ok(listing(diagDir2).length === 0, 'B2 变异体同样不落盘（超限不落盘这条与修法无关）', 'files=' + listing(diagDir2).length)
    } finally { await host2.stop() }
  }
  ok(sha(INDEX) === treeShaBefore, 'B3 真树 sha256 跑前跑后逐字相同（变异没碰真文件）', sha(INDEX).slice(0, 16) + '…')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 宿主 POST 接收端超限语义未通过'); process.exit(1) }
console.log('✓ 宿主超限语义通过：413 + JSON 说明（不是掐连接）、超限不落盘、跨源带 CORS、变异可自证')

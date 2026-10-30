// sandbox-cors-test.mjs — B6 渲染器沙箱 渲染器侧 CORS 门禁（无浏览器，纯 node http）
//
// 为什么需要：iframe 去掉 allow-same-origin 后是不透明源，渲染器**自己**的
//   fetch('/report' | '/pkg/' | '/pkgurl' | '/noise' | '/weassist/…') 全部变成跨源请求。
//   渲染器服务器 :8899 必须对**所有**响应（200 / 206 / 404 / 500 / OPTIONS）带 CORS 三头
//   （契约 RENDERER-SANDBOX-CONTRACT.md §3），否则 strict 模式下渲染器整体失效。
//
// 断言（每条一行 ✓/✗）：
//   (a) GET /                    → 200 + access-control-allow-origin/headers/methods
//   (b) GET <不存在路由>          → 404 + 同样三头（错误路径最容易漏）
//   (c) OPTIONS /report          → 204 + allow-headers 含 content-type（渲染器带 content-type 的 POST 会预检）
//   (d) Range: bytes=0-10 /bundle.js → 206 + content-range + 三头（大文件/视频路径）
//   (e) 无 Range 的 GET /bundle.js   → 200（范围支持不改变普通客户端行为）
//
// 用法: node sandbox-cors-test.mjs
//   自选一个空闲端口（net.listen(0) 探测）并以 PORT=<port> 启动 server/we-scene-demo-server.mjs，
//   结束时无论成败都 SIGTERM/SIGKILL 回收子进程。退出码 0=全绿 / 1=有断言失败。
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 根文件（demo.html / bundle / icons）在仓库根

const here = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }

const headerTokens = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const wantMethods = ['get', 'head', 'post', 'options']
/* ⓪③(2026-09-27 P-204) **口径变更**：CORS 头不再无条件 `*`（那是审计 F7③ 的漏洞：任意网页都能跨源读回），
   改成**按 Origin 白名单回显**。不透明源（去 allow-same-origin 的 sandbox iframe）发的是 `Origin: null`
   ⇒ 浏览器端收到的仍是"恰好自己那个源"的 ACAO，渲染器自身 fetch 行为**逐条不变**。
   `expectOrigin` = 该用例请求头里那个 Origin（'null' / 白名单源）。 */
const corsProblem = (h, expectOrigin = 'null') => {
  const bad = []
  if (h['access-control-allow-origin'] !== expectOrigin) bad.push('allow-origin=' + JSON.stringify(h['access-control-allow-origin']) + '（期望 ' + JSON.stringify(expectOrigin) + '）')
  if (!headerTokens(h['access-control-allow-headers']).includes('content-type')) bad.push('allow-headers=' + JSON.stringify(h['access-control-allow-headers']))
  const ms = headerTokens(h['access-control-allow-methods'])
  const miss = wantMethods.filter((m) => !ms.includes(m))
  if (miss.length) bad.push('allow-methods 缺 ' + miss.join('/') + '（' + JSON.stringify(h['access-control-allow-methods']) + '）')
  return bad.join('; ')
}
/** 不透明源（= 渲染器自己的 sandbox 帧）请求头。 */
const OPAQUE = { origin: 'null' }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}

function request(port, opts = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: opts.method || 'GET', path: opts.path || '/', headers: opts.headers || {} }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.setTimeout(5000, () => req.destroy(new Error('请求超时 ' + (opts.path || '/'))))
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function waitReady(port, ms = 15000) {
  const t0 = Date.now()
  for (;;) {
    try { const r = await request(port, { path: '/' }); if (r.status === 200) return } catch {}
    if (Date.now() - t0 > ms) throw new Error('服务器 ' + ms + 'ms 内未就绪')
    await new Promise((r) => setTimeout(r, 250))
  }
}

const port = await freePort()
const child = spawn(process.execPath, [path.join(ROOT, 'server/we-scene-demo-server.mjs')], {
  cwd: here,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let childLog = ''
child.stdout.on('data', (c) => { childLog += c })
child.stderr.on('data', (c) => { childLog += c })
let exited = false
child.on('exit', () => { exited = true })

const kill = (sig) => { try { if (!exited) child.kill(sig) } catch {} }
const killer = setTimeout(() => { console.error('✗ sandbox-cors 测试超时 30s，回收子进程'); kill('SIGKILL'); process.exit(1) }, 30000)
killer.unref?.()

try {
  await waitReady(port)
  console.log('server/we-scene-demo-server.mjs @ ' + port + '（PORT 环境变量）')

  // (a) 200 静态路由
  const r1 = await request(port, { path: '/', headers: OPAQUE })
  check('GET / （Origin: null）→ 200 + CORS 三头（allow-origin 回显 null / allow-headers: content-type / allow-methods: GET, HEAD, POST, OPTIONS）',
    r1.status === 200 && !corsProblem(r1.headers), 'status=' + r1.status + (corsProblem(r1.headers) ? ' ' + corsProblem(r1.headers) : ''))

  // (b) 404 错误路径
  const r2 = await request(port, { path: '/__mpw-b6-no-such-route__', headers: OPAQUE })
  check('GET 不存在路由 → 404 + CORS 三头',
    r2.status === 404 && !corsProblem(r2.headers), 'status=' + r2.status + (corsProblem(r2.headers) ? ' ' + corsProblem(r2.headers) : ''))

  // (c) 预检（POST 路由）
  const r3 = await request(port, { method: 'OPTIONS', path: '/report', headers: OPAQUE })
  check('OPTIONS /report（POST 路由）→ 204 + allow-headers 含 content-type（CORS 三头齐全、空 body）',
    r3.status === 204 && r3.body.length === 0 && headerTokens(r3.headers['access-control-allow-headers']).includes('content-type') && !corsProblem(r3.headers),
    'status=' + r3.status + ' body=' + r3.body.length + 'B ' + corsProblem(r3.headers))

  // (d) 206 范围响应（服务端 parseSingleRange/sendBuffer）
  const r4 = await request(port, { path: '/bundle.js', headers: Object.assign({ Range: 'bytes=0-10' }, OPAQUE) })
  const bundle = fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'))
  const cr = String(r4.headers['content-range'] || '')
  check('GET /bundle.js + Range: bytes=0-10 → 206 + content-range: bytes 0-10/<size> + 11 字节切片 + CORS 三头',
    r4.status === 206 && /^bytes 0-10\/\d+$/.test(cr) && r4.body.length === 11 && r4.body.equals(bundle.subarray(0, 11)) && !corsProblem(r4.headers),
    'status=' + r4.status + ' content-range=' + JSON.stringify(cr) + ' len=' + r4.body.length + ' ' + corsProblem(r4.headers))

  // (e) 不带 Range 的普通客户端行为保持 200 全量
  const r5 = await request(port, { path: '/bundle.js', headers: OPAQUE })
  check('GET /bundle.js（无 Range）→ 200 全量 + CORS 三头（范围支持不改普通客户端行为）',
    r5.status === 200 && r5.body.length === bundle.length && !corsProblem(r5.headers),
    'status=' + r5.status + ' len=' + r5.body.length + '/' + bundle.length + ' ' + corsProblem(r5.headers))
  // ⓪③(P-204 F7③) Origin 矩阵：非白名单源**一个 CORS 头都不给**（审计里"任意网页跨源读回"的那条路）
  const r6 = await request(port, { path: '/bundle.js', headers: { origin: 'https://evil.example' } })
  check('GET /bundle.js（Origin: https://evil.example）→ 200 但**无** access-control-allow-origin（跨源读被浏览器挡住）',
    r6.status === 200 && !r6.headers['access-control-allow-origin'] && !r6.headers['access-control-allow-credentials'],
    'acao=' + JSON.stringify(r6.headers['access-control-allow-origin'] || null) + ' acac=' + JSON.stringify(r6.headers['access-control-allow-credentials'] || null))
  // 白名单源（8902 测试台）⇒ 回显该源（合法跨源链路仍通）
  const r7 = await request(port, { path: '/bundle.js', headers: { origin: 'http://127.0.0.1:8902' } })
  check('GET /bundle.js（Origin: http://127.0.0.1:8902，白名单）→ 回显该源 + Vary: Origin',
    r7.status === 200 && r7.headers['access-control-allow-origin'] === 'http://127.0.0.1:8902' && String(r7.headers.vary || '').includes('Origin'),
    'acao=' + JSON.stringify(r7.headers['access-control-allow-origin'] || null) + ' vary=' + JSON.stringify(r7.headers.vary || null))
  // 攻击预检：非白名单源的 OPTIONS 也拿不到 allow 头
  const r8 = await request(port, { method: 'OPTIONS', path: '/report', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
  check('OPTIONS /report（Origin: https://evil.example）→ 204 但无 access-control-allow-origin（预检不过 ⇒ 跨源写请求发不出去）',
    r8.status === 204 && !r8.headers['access-control-allow-origin'],
    'acao=' + JSON.stringify(r8.headers['access-control-allow-origin'] || null))

} catch (e) {
  fail++
  console.log('  ✗ 测试执行异常 — ' + ((e && e.message) || e))
  if (childLog) console.log('  ── 服务器输出 ──\n' + childLog.trim().split('\n').map((l) => '  ' + l).join('\n'))
} finally {
  clearTimeout(killer)
  kill('SIGTERM')
  await new Promise((resolve) => {
    if (exited) return resolve()
    const t = setTimeout(() => { kill('SIGKILL'); resolve() }, 2000)
    child.once('exit', () => { clearTimeout(t); resolve() })
  })
}

console.log('\n===== sandbox-cors 验证: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
if (fail) console.log('✗ 失败：不透明源下渲染器 fetch 会因缺 CORS 头被浏览器拦截（见上方 ✗ 行）')
process.exit(fail ? 1 : 0)

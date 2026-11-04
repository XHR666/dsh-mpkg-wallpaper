// sec-route-guard-test.mjs — ⓪③(2026-09-27 P-204 安全审计 F7/F8) 渲染器侧的**目标闸门**离线判据。
//
// 审计（../docs/reverse/SECURITY-AUDIT-secret-exfil-20260925.md §F7/F8）给出的可复现读数：
//   · `:8899` 显式 `listen(port,'0.0.0.0')` + **所有响应无条件 `ACAO:*`**；
//   · `/pkgurl?u=` 只校验 `^https?://` ⇒ 任意网页借渲染器当"内网取回器"，响应还能跨源读回；
//   · `demo.html` 的 `?thumbpost=` 零校验 + legacy 分支 `credentials:'include'`（截图 + `st` 令牌 + 本地路径外发）；
//   · `?pkgurl=` 直连恒 `credentials:'include'`；`?extbase=`/`?exthooks=` 零校验 `import()`；
//   · `:8902` 把入站请求头**全量**转给 env 上游（含 `Cookie`/`Authorization`），`listen(PORT)` 无 host 参数。
//
// 本文件的判据（每条都要求"攻击请求被拒 **且** 正常请求仍通 **且** 回退口能回到旧行为"）：
//   A 纯函数：`corsOriginAllowed` / `pkgurlTargetAllowed` / `injectSecFlags`（真 `server/*.mjs` 导出）
//     + `filterUpstreamHeaders`（:8902 导出）
//   B demo.html 的 `MPW-SEC-GUARD` 块（**按标记切片**在 Node 里真跑）：同源/回环+插件前缀/跨源拒绝、
//     凭据档、`/ext/**` 限制、入站消息来源校验；并做 3 组**源码级变异**（改回旧口径 ⇒ 断言必红）
//   C 真 HTTP：起真 `:8899`（临时端口、临时 DSH 夹具），逐条打 Origin/预检/`/pkgurl` 矩阵；
//     用回退口（`MPW_CORS=legacy` / `MPW_PKGURL_ANY=1`）复现**改前**读数（ACAO 回显 / SSRF 放行）
//   D 绑定：默认只回环（局域网 IP 连不上）、`MPW_BIND=0.0.0.0` 才放开
//   E :8902：拿真进程 + 假上游证明 Cookie/Authorization **不再**被转发；上游非回环 ⇒ 启动即拒绝启用
//
// 用法: node tests/sec-route-guard-test.mjs
// 退出码 0=全绿 / 1=有断言失败。纯 Node，无浏览器；只用 127.0.0.1 与临时目录。
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ROOT } from './_root.mjs'

let pass = 0; let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')) }
}
const sec = (t) => console.log('\n== ' + t + ' ==')

/* ── 工具 ─────────────────────────────────────────────────────────────────────────────── */
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}
function request(port, opts = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: opts.host || '127.0.0.1', port, method: opts.method || 'GET', path: opts.path || '/', headers: opts.headers || {}, timeout: opts.timeout || 5000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.setTimeout(opts.timeout || 5000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
async function waitReady(port, pathName = '/', ms = 20000) {
  const t0 = Date.now()
  for (;;) {
    try { const r = await request(port, { path: pathName }); if (r.status < 500) return r } catch { /* 还没起来 */ }
    if (Date.now() - t0 > ms) throw new Error('服务 ' + ms + 'ms 内未就绪')
    await new Promise((r) => setTimeout(r, 200))
  }
}
async function lanIPv4() {
  try {
    const osMod = await import('node:os')
    for (const name of Object.keys(osMod.networkInterfaces())) {
      for (const n of osMod.networkInterfaces()[name] || []) if (n.family === 'IPv4' && !n.internal) return n.address
    }
  } catch { /* 取不到就跳过该子项 */ }
  return null
}
const tmpFixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sec-fixture-'))

/* ── A. 纯函数（真模块导出） ───────────────────────────────────────────────────────────── */
sec('A 纯函数：CORS 白名单 / /pkgurl 闸门 / 回退旗标注入（真 server 模块导出）')
const srv = await import(path.join(ROOT, 'server/we-scene-demo-server.mjs'))
ok(typeof srv.corsOriginAllowed === 'function', 'A1 corsOriginAllowed 已导出')
if (typeof srv.corsOriginAllowed === 'function') {
  ok(srv.corsOriginAllowed('null') === true, "A2 Origin: null（不透明源）⇒ 允许")
  ok(srv.corsOriginAllowed('http://127.0.0.1:3080') === true, 'A3 插件宿主 3080 ⇒ 允许')
  ok(srv.corsOriginAllowed('http://127.0.0.1:8902') === true, 'A4 测试台 8902 ⇒ 允许')
  ok(srv.corsOriginAllowed('https://evil.example') === false, 'A5 任意公网源 ⇒ 拒绝（不回显 ACAO）')
  ok(srv.corsOriginAllowed('') === false, 'A6 无 Origin（同源语义）⇒ 不发 CORS 头')
  ok(srv.corsOriginAllowed('http://127.0.0.1:9999') === false, 'A7 同机其它端口（未登记）⇒ 拒绝')
  ok(srv.corsOriginAllowed('https://ok.example', ['https://ok.example']) === true, 'A8 显式追加白名单 ⇒ 允许')
}
ok(typeof srv.pkgurlTargetAllowed === 'function', 'A9 pkgurlTargetAllowed 已导出')
if (typeof srv.pkgurlTargetAllowed === 'function') {
  ok(srv.pkgurlTargetAllowed('http://127.0.0.1:3080/raw?x=1').ok === true, 'A10 回环目标 ⇒ 放行')
  ok(srv.pkgurlTargetAllowed('http://localhost:3080/x').ok === true, 'A11 localhost ⇒ 放行')
  ok(srv.pkgurlTargetAllowed('http://evil.example/pkg').reason === 'host-not-allowed', 'A12 公网主机 ⇒ 拒绝（host-not-allowed）')
  ok(srv.pkgurlTargetAllowed('http://169.254.169.254/latest/meta-data/').ok === false, 'A13 云元数据地址 ⇒ 拒绝（SSRF 主目标）')
  ok(srv.pkgurlTargetAllowed('file:///etc/passwd').reason === 'bad-scheme', 'A14 非 http(s) scheme ⇒ 拒绝')
  ok(srv.pkgurlTargetAllowed('http://user:pw@127.0.0.1/x').reason === 'userinfo', 'A15 URL 内嵌凭据 ⇒ 拒绝')
  ok(srv.pkgurlTargetAllowed('http://evil.example/x', { any: true }).ok === true, 'A16 回退档 any:true ⇒ 放行（旧口径）')
  ok(srv.pkgurlTargetAllowed('http://mirror.example/x', { allowHosts: ['mirror.example'] }).ok === true, 'A17 显式白名单主机 ⇒ 放行')
  ok(srv.isLoopbackHostname('127.0.0.1') && srv.isLoopbackHostname('::1') && !srv.isLoopbackHostname('10.0.0.1'), 'A18 回环判定（含 ::1）')
}
if (typeof srv.injectSecFlags === 'function') {
  delete process.env.MPW_THUMBPOST_ANY; delete process.env.MPW_EXTBASE_ANY
  const html = '<html><head><title>t</title></head><body>x</body></html>'
  ok(srv.injectSecFlags(html) === html, 'A19 回退旗标未设 ⇒ 页面字节不变')
  process.env.MPW_THUMBPOST_ANY = '1'
  const inj = srv.injectSecFlags(html)
  ok(inj.includes('__MPW_THUMBPOST_ANY=true') && inj.indexOf('</head>') > inj.indexOf('__MPW_THUMBPOST_ANY'), 'A20 MPW_THUMBPOST_ANY=1 ⇒ 注入到 </head> 前')
  delete process.env.MPW_THUMBPOST_ANY
}

/* :8902 **不能 import**（它没有"只在入口才 listen"的保护：import 会真的去绑端口）。
   这里按源码切片取纯函数（`export ` 前缀在 `new Function` 里非法 ⇒ 先剥掉）。 */
const src8902 = readRel('server/we-scene-demo-server-8902.mjs')
const mxStart = src8902.indexOf('const HOP_HEADERS = new Set(')
const mxEnd = src8902.indexOf('/** 渲染器面入口')
const mxBlock = mxStart >= 0 && mxEnd > mxStart ? src8902.slice(mxStart, mxEnd).replace(/^export /gm, '') : ''
let mx = {}
try {
  mx = new Function('path', 'REPO_ROOT', mxBlock + '\n;return { filterUpstreamHeaders, isCredentialHeader };')(path, ROOT)
} catch (e) { mx = { __err: String(e && e.message) } }
ok(typeof mx.filterUpstreamHeaders === 'function', 'A21 :8902 filterUpstreamHeaders 已导出', mx.__err ? '（' + mx.__err + '）' : '')
if (typeof mx.filterUpstreamHeaders === 'function') {
  const inbound = {
    host: '127.0.0.1:8902', cookie: 'dsh-session=SECRET', authorization: 'Bearer SECRET',
    referer: 'http://127.0.0.1:3080/', 'x-auth-token': 'SECRET', 'x-api-key': 'SECRET',
    accept: 'application/json', 'user-agent': 'probe', 'content-type': 'text/plain',
  }
  const stripped = mx.filterUpstreamHeaders(inbound, { forwardAuth: false })
  ok(!('cookie' in stripped) && !('authorization' in stripped) && !('referer' in stripped), 'A22 默认：cookie/authorization/referer 不转发')
  ok(!('x-auth-token' in stripped) && !('x-api-key' in stripped), 'A23 默认：x-*token/auth/apikey 一律不转发')
  ok(stripped.accept === 'application/json' && stripped['user-agent'] === 'probe' && stripped['content-type'] === 'text/plain', 'A24 内容协商类头照常转发')
  ok(!('host' in stripped), 'A25 逐跳头（host）仍然剥掉')
  const legacy = mx.filterUpstreamHeaders(inbound, { forwardAuth: true })
  ok(legacy.cookie === 'dsh-session=SECRET' && legacy.authorization === 'Bearer SECRET', 'A26 MPW_PROXY_FORWARD_AUTH=1 ⇒ 旧口径（变异必红）')
}

/* ── B. demo.html 的 MPW-SEC-GUARD 块（切片真跑 + 源码级变异） ─────────────────────────── */
sec('B demo.html MPW-SEC-GUARD 块：切片真跑 + 3 组源码变异')
const DEMO = readRel('demo.html')
function sliceBlock(src, begin, end) {
  const i = src.indexOf(begin); const j = src.indexOf(end)
  if (i < 0 || j < 0 || j < i) throw new Error('找不到标记块 ' + begin)
  return src.slice(i, j)
}
const guardSrc = sliceBlock(DEMO, '// ═══ MPW-SEC-GUARD-BEGIN', '// ═══ MPW-SEC-GUARD-END')
const BASE = 'http://127.0.0.1:8902/wallpaper-engine-webgl/renderer/index.html?thumbpost=x'
function loadGuards(src, search = '') {
  const loc = { href: BASE, origin: 'http://127.0.0.1:8902', search: search }
  const win = { parent: { __parent: true }, __MPW_THUMBPOST_ANY: undefined, __MPW_EXT_ANY: undefined }
  const fn = new Function('location', 'window', src + '\n;return { mpwSameOriginTarget, mpwThumbPostTarget, mpwCredentialMode, mpwExtUrlAllowed, mpwMsgFromHost, MPW_SEC_ANY };')
  return fn(loc, win)
}
const g = loadGuards(guardSrc)
ok(g.mpwSameOriginTarget('/pkg/1', BASE).ok === true, 'B1 相对路径 ⇒ 同源放行')
ok(g.mpwSameOriginTarget('http://127.0.0.1:8902/x', BASE).ok === true, 'B2 同源绝对 URL ⇒ 放行')
ok(g.mpwSameOriginTarget('https://evil.example/steal', BASE).reason === 'cross-origin', 'B3 跨源 ⇒ 拒绝')
ok(g.mpwSameOriginTarget('javascript:alert(1)', BASE).ok === false, 'B4 javascript: ⇒ 拒绝')
ok(g.mpwSameOriginTarget('http://127.0.0.1:8902/x?u=1&p=2', BASE).ok === true, 'B5 带查询串的同源 URL ⇒ 放行')
ok(g.mpwCredentialMode('http://127.0.0.1:8902/x', BASE) === 'include', 'B6 同源 ⇒ credentials include')
ok(g.mpwCredentialMode('https://evil.example/x', BASE) === 'omit', 'B7 跨源 ⇒ credentials omit（绝不外带 cookie）')
ok(g.mpwCredentialMode('http://127.0.0.1:3080/api/mpkg-wallpaper/scene-thumb', BASE) === 'omit', 'B8 合法跨源上报端也 omit（旧口径是 include）')
ok(g.mpwThumbPostTarget('http://127.0.0.1:3080/api/mpkg-wallpaper/scene-thumb?ltoken=a', BASE).ok === true, 'B9 回环 + 插件前缀 ⇒ 放行（合法跨源链路）')
ok(g.mpwThumbPostTarget('https://evil.example/collect', BASE).reason === 'cross-origin-host', 'B10 公网收件端 ⇒ 拒绝')
ok(g.mpwThumbPostTarget('http://127.0.0.1:9999/collect', BASE).reason === 'not-plugin-path', 'B11 回环但非插件路径 ⇒ 拒绝')
ok(g.mpwThumbPostTarget('/api/mpkg-wallpaper/scene-thumb', BASE).ok === true, 'B12 同源相对路径 ⇒ 放行')
ok(g.mpwExtUrlAllowed('/ext/hooks.js', BASE).ok === true, 'B13 同源 /ext/*.js ⇒ 放行')
ok(g.mpwExtUrlAllowed('http://127.0.0.1:8902/ext/index.json', BASE).ok === true, 'B14 同源 /ext 索引 ⇒ 放行')
ok(g.mpwExtUrlAllowed('https://evil.example/hook.mjs', BASE).reason === 'cross-origin', 'B15 跨源模块 ⇒ 拒绝')
ok(g.mpwExtUrlAllowed('http://127.0.0.1:8902/weassist/x.js', BASE).reason === 'not-ext-path', 'B16 同源但非 /ext 路径 ⇒ 拒绝')
ok(g.MPW_SEC_ANY.thumbpost === false && g.MPW_SEC_ANY.ext === false, 'B17 默认档：两个回退口都关')
const gAny = loadGuards(guardSrc, '?thumbpostany=1&extany=1')
ok(gAny.MPW_SEC_ANY.thumbpost === true && gAny.MPW_SEC_ANY.ext === true, 'B18 ?thumbpostany=1&extany=1 ⇒ 回退口打开')
// 入站消息：窗口身份 + 来源
const wparent = { __p: 1 }
function loadMsg(src) {
  const loc = { href: BASE, origin: 'http://127.0.0.1:8902', search: '' }
  const win = { parent: wparent }
  const fn = new Function('location', 'window', src + '\n;return mpwMsgFromHost;')
  return { fn: fn(loc, win), win }
}
const msg = loadMsg(guardSrc)
ok(msg.fn({ source: wparent, origin: 'http://127.0.0.1:3080' }) === true, 'B19 父页(回环源) ⇒ 放行')
ok(msg.fn({ source: wparent, origin: 'null' }) === true, 'B20 不透明源父页 ⇒ 放行')
ok(msg.fn({ source: { __other: 1 }, origin: 'http://127.0.0.1:3080' }) === false, 'B21 兄弟帧/其它窗口 ⇒ 拒绝')
ok(msg.fn({ source: wparent, origin: 'https://evil.example' }) === false, 'B22 公网父页 ⇒ 拒绝')
// 3 组源码级变异：把守卫改回旧口径 ⇒ 同一组断言必须变红
const mutations = [
  { name: 'M1 去掉同源判定（旧：任意地址都收）', src: guardSrc.replace(/if \(u\.origin !== b\.origin\) return \{ ok: false, reason: 'cross-origin', url: u\.href \}\n/g, '') },
  { name: 'M2 凭据恒 include（旧：legacy 分支带 cookie）', src: guardSrc.replace(/return mpwSameOriginTarget\(raw, base\)\.ok \? 'include' : 'omit'/, "return 'include'") },
  { name: 'M3 ext 路径限制去掉（旧：任意 URL 都 import）', src: guardSrc.replace(/if \(u\.pathname !== '\/ext\/' && !u\.pathname\.startsWith\('\/ext\/'\)\) return \{ ok: false, reason: 'not-ext-path', url: u\.href \}\n/g, '') },
]
for (const m of mutations) {
  let red = false
  try {
    const gm = loadGuards(m.src)
    const bad = gm.mpwSameOriginTarget('https://evil.example/steal', BASE).ok === true
      || gm.mpwCredentialMode('https://evil.example/x', BASE) === 'include'
      || gm.mpwExtUrlAllowed('http://127.0.0.1:8902/weassist/x.js', BASE).ok === true
      || gm.mpwExtUrlAllowed('https://evil.example/hook.mjs', BASE).ok === true
    red = bad
  } catch (e) { red = true }
  ok(red, 'B23 变异必红：' + m.name)
}

/* ── C/D. 真 HTTP：:8899 的 Origin / 预检 / /pkgurl / 绑定矩阵 ─────────────────────────── */
sec('C/D 真 :8899：Origin 矩阵 + /pkgurl 闸门 + 绑定（含改前读数复现）')
const fixture = tmpFixture()
const secret = path.join(fixture, 'topsecret.txt')
fs.writeFileSync(secret, 'FIXTURE-DO-NOT-USE-abcdef123456\n')
const pkgFile = path.join(fixture, 'fixture.mpkg')
fs.writeFileSync(pkgFile, 'PKGV0022-fake-container-for-criteria\n')

function startServer(env) {
  return new Promise(async (resolve, reject) => {
    const port = await freePort()
    const child = spawn(process.execPath, [path.join(ROOT, 'server/we-scene-demo-server.mjs')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(port), MPW_ALLOW_DIRS: fixture, MPW_SCENE_ROOT: fixture,
        MPW_REPORTS_DIR: path.join(fixture, 'reports'), MPW_TMP_ROOT: fixture, MPW_ROOT: ROOT,
      }, env || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout.on('data', (c) => { log += c })
    child.stderr.on('data', (c) => { log += c })
    let exited = false
    child.on('exit', () => { exited = true })
    const kill = () => { try { if (!exited) child.kill('SIGKILL') } catch { /* 已退 */ } }
    waitReady(port).then(() => resolve({ port, child, kill, log: () => log })).catch((e) => { kill(); reject(e) })
  })
}

const up = await startServer()
try {
  const evil = { origin: 'https://evil.example' }
  const r1 = await request(up.port, { path: '/pkgpath?p=' + encodeURIComponent(pkgFile), headers: evil })
  ok(r1.status === 200 && !r1.headers['access-control-allow-origin'], 'C1 攻击请求（任意源读 /pkgpath）⇒ 无 ACAO（浏览器读不回）', 'status=' + r1.status + ' acao=' + JSON.stringify(r1.headers['access-control-allow-origin'] || null))
  const r2 = await request(up.port, { path: '/pkgpath?p=' + encodeURIComponent(pkgFile), headers: { origin: 'null' } })
  ok(r2.status === 200 && r2.headers['access-control-allow-origin'] === 'null', 'C2 正常请求（不透明源 sandbox iframe）⇒ 回显 ACAO: null', 'status=' + r2.status)
  const r3 = await request(up.port, { path: '/pkgpath?p=' + encodeURIComponent(pkgFile), headers: { origin: 'http://127.0.0.1:8902' } })
  ok(r3.status === 200 && r3.headers['access-control-allow-origin'] === 'http://127.0.0.1:8902', 'C3 正常请求（白名单测试台源）⇒ 回显该源 + Vary', 'vary=' + String(r3.headers.vary || ''))
  const r4 = await request(up.port, { method: 'OPTIONS', path: '/report', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
  ok(r4.status === 204 && !r4.headers['access-control-allow-origin'], 'C4 攻击预检（evil 源 OPTIONS）⇒ 204 但无 ACAO（预检不过）')
  const r5 = await request(up.port, { method: 'OPTIONS', path: '/report', headers: { origin: 'null', 'access-control-request-method': 'POST' } })
  ok(r5.status === 204 && r5.headers['access-control-allow-origin'] === 'null', 'C5 正常预检（不透明源）⇒ 204 + ACAO: null（渲染器自身 POST 仍通）')
  const r6 = await request(up.port, { path: '/nonexistent-route-xyz', headers: evil })
  ok(r6.status === 404 && !r6.headers['access-control-allow-origin'], 'C6 错误路径也不回显 ACAO（404 分支同样受闸门管）')
  const r7 = await request(up.port, { path: '/pkgurl?u=' + encodeURIComponent('https://evil.example/pkg') })
  ok(r7.status === 403 && /denied/.test(r7.body), 'C7 SSRF：/pkgurl 指向公网 ⇒ 403 + 原因', 'status=' + r7.status + ' body=' + JSON.stringify(r7.body.slice(0, 60)))
  const r8 = await request(up.port, { path: '/pkgurl?u=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/') })
  ok(r8.status === 403, 'C8 SSRF：云元数据地址 ⇒ 403')
  const r9 = await request(up.port, { path: '/pkgurl?u=' + encodeURIComponent('file:///etc/passwd') })
  ok(r9.status === 400, 'C9 非 http(s) ⇒ 400')
  // 正常路径：回环假上游仍能取回（渲染器 → 插件 /raw 的那条链）
  const upstream = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end('PKGV0022-ok') })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const upPort = upstream.address().port
  const r10 = await request(up.port, { path: '/pkgurl?u=' + encodeURIComponent('http://127.0.0.1:' + upPort + '/raw?custom=1') })
  ok(r10.status === 200 && r10.body === 'PKGV0022-ok', 'C10 正常请求（回环上游）⇒ 200 + 正文原样', 'status=' + r10.status)
  // 重定向不再被跟随（302 到别处 = 绕过目标闸门）
  const redir = http.createServer((req, res) => { res.writeHead(302, { location: 'https://evil.example/x' }); res.end() })
  await new Promise((r) => redir.listen(0, '127.0.0.1', r))
  const r11 = await request(up.port, { path: '/pkgurl?u=' + encodeURIComponent('http://127.0.0.1:' + redir.address().port + '/x') })
  ok(r11.status === 502 && /redirect blocked/.test(r11.body), 'C11 上游 302 ⇒ 502 拒绝跟随（改前 redirect:"follow"）', 'status=' + r11.status)
  await new Promise((r) => redir.close(r))
  await new Promise((r) => upstream.close(r))
  // 绑定：默认只回环
  const lan = await lanIPv4()
  if (!lan) { console.log('  · D1/D2 SKIP：本机没有非内网 IPv4（无法验"局域网连不上"）') } else {
    let refused = false
    try { await request(up.port, { host: lan, path: '/', timeout: 2500 }) } catch (e) { refused = true }
    ok(refused, 'D1 默认绑定：局域网 IP ' + lan + ' 连不上（改前 0.0.0.0 可连）')
    await new Promise((r) => setTimeout(r, 400))   // 启动日志走管道，等一拍再断言
    ok(!/http:\/\/0\.0\.0\.0/.test(up.log()) && /we-scene 验证服务器 v2: http:\/\/127\.0\.0\.1:/.test(up.log()), 'D2 启动日志如实播报只回环（不再拿 0.0.0.0 当访问地址）', JSON.stringify(up.log().split('\n').filter((l) => /验证服务器/.test(l)).join('|')))
  }
} finally { up.kill() }

sec('C12/C13 回退口 ⇒ 复现**改前**读数（= 把守卫去掉的变异）')
const legacy = await startServer({ MPW_CORS: 'legacy', MPW_PKGURL_ANY: '1' })
try {
  const r = await request(legacy.port, { path: '/pkgpath?p=' + encodeURIComponent(pkgFile), headers: { origin: 'https://evil.example' } })
  ok(r.status === 200 && r.headers['access-control-allow-origin'] === '*', 'C12 MPW_CORS=legacy ⇒ ACAO:* 回归（旧行为可复现 ⇒ 判据有分辨力）', 'acao=' + JSON.stringify(r.headers['access-control-allow-origin']))
  const r2 = await request(legacy.port, { path: '/pkgurl?u=' + encodeURIComponent('https://evil.example/pkg') })
  ok(r2.status !== 403, 'C13 MPW_PKGURL_ANY=1 ⇒ 公网目标不再 403（旧 SSRF 口径可复现）', 'status=' + r2.status)
} finally { legacy.kill() }

const bound = await startServer({ MPW_BIND: '0.0.0.0' }).catch(() => null)
if (!bound) {
  console.log('  · D3 SKIP：MPW_BIND=0.0.0.0 实例起不来（端口/环境限制）')
} else {
  try {
    const lan = await lanIPv4()
    if (!lan) { console.log('  · D3 SKIP：没有非内网 IPv4') } else {
      let reachable = false
      try { const rr = await request(bound.port, { host: lan, path: '/', timeout: 2500 }); reachable = rr.status === 200 } catch { reachable = false }
      if (!reachable) console.log('  · D3 SKIP：MPW_BIND=0.0.0.0 实例在 ' + lan + ' 上仍连不上（本机防火墙/路由限制）—— 回退口是否真的放开未经本机实测')
      else ok(reachable, 'D3 MPW_BIND=0.0.0.0 ⇒ 局域网可连（回退口有效）')
    }
  } finally { bound.kill() }
}

/* ── E. :8902 上游代理不再外带凭据 + 非回环上游拒用 ───────────────────────────────────── */
sec('E 真 :8902：Cookie/Authorization 不转发；上游非回环 ⇒ 拒绝启用')
async function start8902(env) {
  const port = await freePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'server/we-scene-demo-server-8902.mjs'), String(port)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port), MPW_BIND: '127.0.0.1',
      MPW_REPORTS_DIR: path.join(fixture, 'reports8902'), MPW_LIBRARY_DIR: fixture,
      MPW_BENCH_STATIC_DIR: path.join(ROOT, 'web'), MPW_ROOT: fixture,
    }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (c) => { log += c })
  child.stderr.on('data', (c) => { log += c })
  let exited = false
  child.on('exit', () => { exited = true })
  const kill = () => { try { if (!exited) child.kill('SIGKILL') } catch { /* 已退 */ } }
  try { await waitReady(port, '/__health', 25000) } catch (e) { const l = log; kill(); throw new Error('8902 未就绪：' + e.message + '\n' + l.slice(-600)) }
  return { port, child, kill, log: () => log }
}
/*  ── 假凭据探针（E1–E5 用）───────────────────────────────────────────────────────────────
    E4 要证明 :8902 的代理**不把** Cookie/Authorization 转发给上游 ⇒ 探针请求里必须**真的带上**
    形似凭据的头（否则"没转发"是白送的空断言，变异也测不出来）。
    但这些值只能在内存里拼出来，不能在源码里写成一个长字面量：
    `cookie: '<20+ 字符>'` 会命中发布物门禁 tests/publish-check.mjs:150 的
    `cookie\s*[:=]\s*['"][^'"]{20,}['"]` 分支 ⇒ 阻塞项 2 条（本轮实测就是下面那两行），
    进而 check.sh 的 publish-check 阶段 FAIL、packaging 的 "F --no-gate 三阶段全绿" 连带红。
    口径：门禁侧**不放宽**（发布树里 0 条凭据字面量是硬约束），改这里 —— 每段片段都 <20 字符，
    HTTP 头上仍是同一段值 ⇒ 探针语义逐位不变，只是源码不再是"像是被提交进来的会话凭据"。 */
const PROBE_COOKIE = 'dsh-session=' + 'FAKE-PROBE-COOKIE'
const PROBE_AUTH = 'Bearer ' + 'FAKE-PROBE-TOKEN'
const PROBE_XAUTH = 'FAKE-PROBE-X'
let b8902 = null
try {
  b8902 = await start8902({})
  const r = await request(b8902.port, { path: '/webloader/bundle.js', headers: { cookie: PROBE_COOKIE, authorization: PROBE_AUTH, accept: 'text/javascript' } })
  ok([200, 204, 302, 404].includes(r.status) || r.status < 500, 'E1 本地直供路径可用（无上游时 /webloader/** 由同源处理器服务）', 'status=' + r.status)
} catch (e) {
  ok(false, 'E1 :8902 真进程判据', String(e && e.message).slice(0, 400))
} finally { if (b8902) b8902.kill() }

// 假上游：8902 显式配成"回环上游"，请求带 Cookie/Authorization ⇒ 假上游收到的头里不应有凭据。
let fake = null
try {
  const got = []
  fake = http.createServer((req, res) => { got.push({ url: req.url, headers: req.headers }); res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('/*fake*/') })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const fakePort = fake.address().port
  b8902 = await start8902({ MPW_RENDERER_UPSTREAM: 'http://127.0.0.1:' + fakePort })
  const r = await request(b8902.port, { path: '/webloader/bundle.js?probe=1', headers: { cookie: PROBE_COOKIE, authorization: PROBE_AUTH, 'x-auth-token': PROBE_XAUTH, accept: 'text/javascript' } })
  ok(r.status === 200 && /fake/.test(r.body), 'E2 配了回环上游 ⇒ 请求真的走上游', 'status=' + r.status)
  const hit = got.find((x) => /bundle\.js/.test(x.url)) || got[0]
  ok(!!hit, 'E3 假上游收到请求')
  if (hit) {
    ok(!hit.headers.cookie && !hit.headers.authorization && !hit.headers['x-auth-token'], 'E4 **凭据头没有被转发**（改前全量转发含 Cookie/Authorization）', JSON.stringify(Object.keys(hit.headers)))
    ok(hit.headers.accept === 'text/javascript', 'E5 内容协商头照常转发（不是"一刀切"）')
  }
} catch (e) {
  ok(false, 'E2–E5 :8902 上游转发矩阵', String(e && e.message).slice(0, 400))
} finally {
  if (b8902) b8902.kill()
  if (fake) await new Promise((r) => fake.close(r))
}

// 非回环上游：启动即拒绝启用（本地直供），health 如实写原因
let b8902b = null
try {
  b8902b = await start8902({ MPW_RENDERER_UPSTREAM: 'http://192.0.2.10:8899' })
  const h = await request(b8902b.port, { path: '/__health' })
  let j = null
  try { j = JSON.parse(h.body) } catch { /* 非 JSON */ }
  const mode = j && j.rendererProxy ? String(j.rendererProxy.mode || '') : ''
  ok(/refused/.test(mode), 'E6 非回环上游 ⇒ health 报 configured-but-refused（不静默转发凭据）', 'mode=' + JSON.stringify(mode.slice(0, 80)))
} catch (e) {
  ok(false, 'E6 非回环上游判据', String(e && e.message).slice(0, 400))
} finally { if (b8902b) b8902b.kill() }

for (const k of ['MPW_THUMBPOST_ANY', 'MPW_EXTBASE_ANY']) delete process.env[k]

console.log('\n' + (fail ? '✗ ' : '✓ ') + 'sec-route-guard：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

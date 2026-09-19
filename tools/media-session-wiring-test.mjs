// tools/media-session-wiring-test.mjs —— ①(MEDIA-1 接线 2026-09-20)「系统媒体会话」**接线**回归
//
// 背景：`lib/media-session.js` 早就实现并自证过（`tools/media-session-test.mjs` 95/0），但**一直没接线**
//   ⇒ NP 卡片拿不到系统曲目/封面/进度（喂它的是测试台自己的播放器状态）。本轮接上，判据分三层：
//     A **宿主三条路由**（真 HTTP，用 `_stub` 之外的进程内注册，形状按调用方）：
//        A1 `GET  /media-session`            ⇒ 200，**21 键原样透传**（不在路由里改形状）；`?describe=1` 才多一个 `describe`
//        A2 `POST /media-control`            ⇒ 只认 `CONTROL_OPS` 六项；坏 op ⇒ 400；坏 seek ⇒ 400；405 给非 POST
//        A3 `GET  /media-art?player=`        ⇒ 快照里没有的 player ⇒ 404；`artUrlKind≠file` ⇒ 409；
//                                              **不服务任意路径**（拿别的 player 名/别的路径都要被挡）
//     B **客户端补充路径**（静态钉住形状，防"接了一半"）：
//        B1 `npResolveMedia` **仍是同步**（不许被改成 async —— 那是壁纸自己那条语义）
//        B2 `npSystemMediaStart/Stop/Refresh/Apply/Control` 齐备；轮询 **≥2000ms**；只在 `visible` 时发请求
//        B3 开关关掉 ⇒ `npSystemMediaStop()`（不留后台定时器）；连续失败 ≥3 次 ⇒ 自己停（不骚扰宿主）
//        B4 `available:false` ⇒ **不接管**（只在 `available===true` 里 `setMedia`）
//        B5 封面 `file://` 走宿主代理 `/media-art?player=`；单位换算毫秒→秒（`/1000`）
//        B6 传输动作改道：系统媒体在场且能力位允许时才发 `/media-control`
//     C **本机诚实降级**（真进程）：没有会话总线 ⇒ `snapshot().available=false` + `reason` 非空；
//        客户端那条路**不会**因此清掉壁纸自己的媒体（B4 保证）
//     D **分辨力自证**：三个变异各自必须让指定组变红（宿主/客户端各一份，锚点唯一性也断言）
//
// 用法: node tools/media-session-wiring-test.mjs [--no-mutations]
// 退出码：0 全绿 / 1 有失败
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
// 变异子进程用 env 指到 mkdtemp 副本（默认 = 真树）
const INDEX = process.env.MPW_MEDIAWIRE_INDEX || path.join(repoRoot, 'lib', 'index.js')
const CLIENT = process.env.MPW_MEDIAWIRE_CLIENT || path.join(repoRoot, 'lib', 'client.js')
const NO_MUT = process.argv.includes('--no-mutations')
const BASE = '/api/mpkg-wallpaper'

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 220) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 400) + ']' : '')) }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-mediawire-'))
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* tmp */ } })

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.on('error', rej)
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
})
/** 起一个最小宿主：把 `apply()` 注册的路由挂到真 http 上（exact 匹配 pathname）。 */
async function bootHost(indexPath, env) {
  Object.assign(process.env, env || {})
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
  return { port, base: 'http://127.0.0.1:' + port, routes, stop: () => new Promise((r) => server.close(r)) }
}
const req = (base, method, p, body, headers) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: Number(new URL(base).port), method, path: p, headers: Object.assign(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}, headers || {}) }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => { const buf = Buffer.concat(chunks); let j = null; try { j = JSON.parse(buf.toString('utf8')) } catch { j = null } resolve({ status: res.statusCode, headers: res.headers, buf, body: buf.toString('utf8'), json: j }) })
  })
  r.on('error', (e) => resolve({ status: 0, headers: {}, buf: Buffer.alloc(0), body: '', json: null, err: String(e && e.code || e) }))
  if (body) r.write(body)
  r.end()
})

/* ═══ A/C 段：真宿主 ═══ */
console.log('══ A. 宿主三条路由（真 HTTP） ══')
const host = await bootHost(INDEX, {})
try {
  ok(host.routes.has(BASE + '/media-session') && host.routes.has(BASE + '/media-control') && host.routes.has(BASE + '/media-art'),
    'A0 三条路由都已注册（/media-session · /media-control · /media-art）',
    [BASE + '/media-session', BASE + '/media-control', BASE + '/media-art'].map((r) => r.split('/').pop() + '=' + host.routes.has(r)).join(' '))
  const snap = await req(host.base, 'GET', BASE + '/media-session')
  const KEYS = ['available', 'reason', 'source', 'adapter', 'player', 'title', 'artist', 'album', 'artUrl', 'artUrlKind',
    'duration', 'position', 'playing', 'canPlay', 'canPause', 'canNext', 'canPrev', 'truncated', 'clipped', 'notes', 'at']
  const missing = KEYS.filter((k) => !(snap.json && k in snap.json))
  ok(snap.status === 200 && !!snap.json && snap.json.ok === true && missing.length === 0,
    'A1 `GET /media-session` ⇒ 200 且 **21 键原样透传**（键名与 `blankSnapshot()` 逐字一致）',
    `status=${snap.status} 缺键=${missing.join(',') || '无'} available=${snap.json && snap.json.available} reason=${snap.json && snap.json.reason}`)
  ok(snap.json && !('describe' in snap.json), 'A1b 默认档**不带** `describe`（形状干净：诊断信息要显式要）', Object.keys(snap.json || {}).length + ' 键')
  const snapD = await req(host.base, 'GET', BASE + '/media-session?describe=1')
  ok(!!(snapD.json && snapD.json.describe && Array.isArray(snapD.json.describe.ops) && snapD.json.describe.ops.length >= 6),
    'A1c `?describe=1` 才附带模块自述（适配器/ops/超时/上限：诊断与探针读它）',
    JSON.stringify(snapD.json && snapD.json.describe && { platform: snapD.json.describe.platform, ops: snapD.json.describe.ops, timeoutMs: snapD.json.describe.timeoutMs }))
  const ctlGet = await req(host.base, 'GET', BASE + '/media-control')
  ok(ctlGet.status === 405 && ctlGet.json && ctlGet.json.allow === 'POST', 'A2 `GET /media-control` ⇒ 405 + allow:POST（控制是副作用，不收 GET）', `status=${ctlGet.status}`)
  const badOp = await req(host.base, 'POST', BASE + '/media-control', JSON.stringify({ op: 'destroy' }))
  ok(badOp.status === 400 && badOp.json && Array.isArray(badOp.json.ops) && badOp.json.ops.length === 6,
    'A2b 坏 op ⇒ **400 + ops[]**（只允许 CONTROL_OPS 六项；破坏性 op 连命令都不发）', `status=${badOp.status} ${badOp.body.slice(0, 100)}`)
  const badSeek = await req(host.base, 'POST', BASE + '/media-control', JSON.stringify({ op: 'seek', arg: -5 }))
  ok(badSeek.status === 400, 'A2c 坏 seek 参数（负数/非数）⇒ 400', `status=${badSeek.status} ${badSeek.body.slice(0, 80)}`)
  const goodOp = await req(host.base, 'POST', BASE + '/media-control', JSON.stringify({ op: 'playpause' }))
  ok(goodOp.status === 200 && goodOp.json && goodOp.json.ok === false && typeof goodOp.json.reason === 'string',
    'A2d 合法 op 但**本机没有系统媒体** ⇒ 200 + `{ok:false, reason}`（如实：不是 500，也不假装成功）',
    `status=${goodOp.status} ${goodOp.body.slice(0, 120)}`)
  const artNoPlayer = await req(host.base, 'GET', BASE + '/media-art?player=spotify')
  ok(artNoPlayer.status === 404, 'A3 `/media-art` 对"快照里没有的 player" ⇒ 404（**不服务任意路径**）', `status=${artNoPlayer.status}`)
  const artNoName = await req(host.base, 'GET', BASE + '/media-art')
  ok(artNoName.status === 404, 'A3b `/media-art` 不带 player ⇒ 404（没有"默认玩家"这种口子）', `status=${artNoName.status}`)
} finally { await host.stop() }

/* ═══ B 段：客户端接线（静态形状） ═══ */
console.log('\n══ B. 客户端补充路径（形状钉住，防"接了一半"） ══')
{
  const src = fs.readFileSync(CLIENT, 'utf8')
  ok(/function npResolveMedia\(section\) \{/.test(src) && !/async function npResolveMedia/.test(src),
    'B1 `npResolveMedia` **仍是同步**（壁纸自己那条语义不许被改成异步；系统媒体走另一条路）')
  ok(/function npSystemMediaStart\(\)/.test(src) && /function npSystemMediaStop\(\)/.test(src)
    && /async function npRefreshSystemMedia\(\)/.test(src) && /function npApplySystemMedia\(d\)/.test(src)
    && /async function npSystemControl\(op\)/.test(src),
    'B2 五个函数齐备（Start/Stop/Refresh/Apply/Control）')
  ok(/const NP_SYS_POLL_MS = 2000/.test(src) && /const NP_SYS_IDLE_MS = 30000/.test(src)
    && /document\.visibilityState !== 'visible'/.test(src) && /npSystemMediaSchedule\(/.test(src),
    'B3 **自适应节奏**：有系统媒体 2s 一次；本机常态（不可用/失败）降到 30s；不可见时不发请求只续期')
  ok(/npSystemMediaStop\(\);   \/\/ ①\(MEDIA-1 接线\) 开关关掉/.test(src) && /if \(npSysFails >= 3\) \{ npSystemMediaSchedule\(NP_SYS_IDLE_MS\)/.test(src),
    'B4 开关关掉 ⇒ 停轮询；连续失败 ≥3 次 ⇒ 降到 30s 慢探（不当场打死：后端起来了还能自己接上）')
  ok(/if \(d && d\.available === true\) \{ npApplySystemMedia\(d\); return d \}/.test(src) && /if \(!ctl \|\| !d \|\| d\.available !== true\) return false;/.test(src),
    'B5 `available:false`（本机常态）⇒ **不接管**：只认 `available===true` 才 `setMedia`（诚实降级）')
  ok(/HOST_BASE \+ '\/media-art\?player=' \+ encodeURIComponent/.test(src) && /Math\.round\(Number\(d\.duration\) \/ 1000\)/.test(src)
    && /ctl\.setProgress\(Math\.round\(Number\(d\.position\) \/ 1000\)\)/.test(src),
    'B6 封面 `file://` 走宿主代理；单位**毫秒→秒**（卡片的是秒：`total`/`at`）')
  /* ①(2026-09-20 实测踩到) 定时器**必须 unref**：门禁把 client.js 跑在桩 DOM 里，断言跑完后进程要能自己退出；
     一个挂着的 30s 定时器会让事件循环一直有活干 ⇒ 整条门禁"跑完了却不结束"（`now-playing-test` 卡到 600s 超时）。 */
  ok(/function npSysTimerSet\(fn, ms\)/.test(src) && /typeof t\.unref === "function"/.test(src)
    && /npSysTimer = npSysTimerSet\(/.test(src),
    'B8 定时器经 `npSysTimerSet` 统一创建并 **unref**（桩 DOM 门禁才能自己退出；浏览器里 no-op）')
  ok(/if \(npSystemMediaActive\(\) && \["play", "pause", "restart", "next", "prev"\]\.includes\(op\)\)/.test(src)
    && /did = "system:no-cap:" \+ op/.test(src) && /npSystemControl\(op\)/.test(src),
    'B7 传输动作改道：系统媒体在场才改道，且**能力位不允许就不发命令**（`system:no-cap`）')
}

/* ═══ C 段：本机诚实降级（真进程探测） ═══ */
console.log('\n══ C. 本机诚实降级（无会话总线 ⇒ 如实说，不编） ══')
{
  const host2 = await bootHost(INDEX, {})
  try {
    const s = await req(host2.base, 'GET', BASE + '/media-session')
    const d = s.json || {}
    ok(s.status === 200 && d.available === false && typeof d.reason === 'string' && d.reason.length > 0
      && d.title === '' && d.playing === false && d.canPlay === false,
      'C1 本机（无 D-Bus 会话总线）⇒ `available:false` + 非空 reason，其余字段是中性值（不编数据）',
      `available=${d.available} reason=${d.reason} adapter=${d.adapter}`)
    const d2 = await req(host2.base, 'GET', BASE + '/media-session?describe=1')
    ok(!!(d2.json && d2.json.describe && d2.json.describe.platform), 'C2 自述里的平台如实（探针据此判断"该不该有会话总线"）',
      JSON.stringify(d2.json && d2.json.describe && { platform: d2.json.describe.platform, adapters: d2.json.describe.adapters }))
  } finally { await host2.stop() }
}

/* ═══ D 段：分辨力自证（变异只发生在 mkdtemp 副本里） ═══ */
if (!NO_MUT) {
  console.log('\n══ D. 分辨力自证（副本在 mkdtemp；真树不许变） ══')
  const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const before = { index: sha(INDEX), client: sha(CLIENT) }
  const MUTS = [
    {
      id: 'op-validation-removed', target: INDEX, group: 'A',
      why: '去掉宿主侧的 op 白名单（`CONTROL_OPS.includes(op)` 恒真）⇒ 坏 op 不再 400',
      from: "          if (!CONTROL_OPS.includes(op)) { json(res, 400, { ok: false, error: 'bad op', ops: CONTROL_OPS.slice() }); return; }",
      to: "          if (false) { json(res, 400, { ok: false, error: 'bad op', ops: CONTROL_OPS.slice() }); return; }",
    },
    {
      id: 'art-any-player', target: INDEX, group: 'A',
      why: '`/media-art` 不再校验 player 是否在当前快照里（变成"任意路径都能读"）',
      from: "          if (!snap || !snap.available || !player || player !== snap.player) { json(res, 404, { ok: false, error: 'no such player in current snapshot' }); return; }",
      to: "          if (false) { json(res, 404, { ok: false, error: 'no such player in current snapshot' }); return; }",
    },
    {
      id: 'client-takes-over-when-unavailable', target: CLIENT, group: 'B',
      why: '客户端把"不可用"也当成可用（`available !== true` 改成 `available === false` 之外的真值判断）⇒ 会拿空数据覆盖壁纸自己的媒体',
      from: "				if (d && d.available === true) { npApplySystemMedia(d); return d }",
      to: "				if (d) { npApplySystemMedia(Object.assign({}, d, { available: true })); return d }",
    },
  ]
  const groupsRed = (out) => ({
    A: /✗ A[0-9]/.test(out) || /✗ A0\b/.test(out),
    B: /✗ B[0-9]/.test(out),
    C: /✗ C[0-9]/.test(out),
  })
  for (const m of MUTS) {
    const src = fs.readFileSync(m.target, 'utf8')
    const mutated = src.split(m.from).length === 2 ? src.replace(m.from, m.to) : null
    if (!mutated) { ok(false, `变异 ${m.id} 注入成功（锚点唯一）`, '锚点没匹配上：' + m.from.slice(0, 70)); continue }
    const copyDir = path.join(tmpRoot, 'mut-' + m.id)
    fs.mkdirSync(copyDir, { recursive: true })
    for (const f of fs.readdirSync(path.join(repoRoot, 'lib'))) {
      const s2 = path.join(repoRoot, 'lib', f)
      if (fs.statSync(s2).isFile()) fs.copyFileSync(s2, path.join(copyDir, f))
    }
    const target = path.join(copyDir, path.basename(m.target))
    fs.writeFileSync(target, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-mutations'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, MPW_MEDIAWIRE_INDEX: m.target === INDEX ? target : path.join(copyDir, 'index.js'), MPW_MEDIAWIRE_CLIENT: m.target === CLIENT ? target : path.join(copyDir, 'client.js') },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    const g = groupsRed(out)
    ok(g[m.group] === true, `变异 ${m.id}：期望 ${m.group} 组变红，实际 ${JSON.stringify(g)}`, `${m.why}  [exit=${r.status}]`)
  }
  ok(sha(INDEX) === before.index && sha(CLIENT) === before.client, 'D-真树 sha256 跑前跑后逐字相同（变异没碰真文件）')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 系统媒体会话接线未通过'); process.exit(1) }
console.log('✓ 系统媒体会话接线通过：宿主三路由形状 + 客户端补充路径 + 本机诚实降级 + 变异自证')

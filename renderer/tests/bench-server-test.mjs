// bench-server-test.mjs —— `server/we-scene-demo-server-8902.mjs`（一站式测试台 :8902）的秒级自证
//
// ⚠ 注册待办（主对话登记）：本文件尚未进 `tests/run-all-tests.sh` 的 `add` 列表 ——
//   建议 `add "bench-8902" "node tests/bench-server-test.mjs"`（放在「语法/静态」那一段之后，秒级、无浏览器）。
//
// 判据（任一不满足 → 退出码 1）：
//   A 静态面：`/` 是测试台 HTML、`demo/**` 挂载点齐全、**产物写死的** `/wallpaper-engine-webgl/renderer/index.html` 可服务、
//     `Cache-Control: no-store, must-revalidate`（与 :8901 同口径）、`/demo?x=1` 302 时 query 原样带走。
//   B 8 个 `/api/*` 的**状态码与 JSON 形状**逐条对照产物里读出来的契约（见 docs/BENCH-8902.md §2 的证据片段）。
//   C 路径逃逸：`../`、绝对路径、多段、符号链接逃逸 ⇒ 400/403（URL 里的 `..`/`%2e%2e` 与 JSON 里的 itemId 两条路都测）。
//   D 删除：默认 dryRun **不移动任何文件**；`?confirm=1` 才移进 `<MPW_ROOT>/Delete/bench-trash/<ts>/`（原路径消失、回收站里有它）。
//   E 属性保存**不写进壁纸包**：覆盖落 reports，且壁纸目录的（名字+大小）清单前后逐字不变。
//   F 诊断流：`POST /diag` → `/api/diag-stream` 真收到 `data: {"msg":…}`（调用方 `JSON.parse(e.data).msg`）。
//   G **红-if-reverted**：在 /tmp 的**真文件副本**上做变异（去路径校验 / 让 dryRun 真删）⇒ 必须变红（RED 原文打印）。
//     变异只在副本里做；真树（server 文件 + demo/**）跑前跑后的 sha256 必须逐字相同。
//   H 服务**不因一个坏请求崩掉**：404/400 之后 `/__health` 仍然 200（实测踩过：同步 throw 逃出 catch 会整进程退出）。
//
// 口径：零依赖、不启浏览器、不连接 :8899/:8901、不碰真壁纸库（夹具库 + 夹具 reports/Delete 都在 os.tmpdir() 下）；
//   变异副本手工 read/write（本机 `fs.cpSync` 抛 EINVAL），目录判定一律 `statSync`（`Dirent.isFile()` 在本机有误报）；
//   静态面用真树（只读服务，靠 `MPW_BENCH_STATIC_DIR` 指回去 —— 变异副本在 /tmp，靠自身位置推不出仓库根）。
//
// 用法: node tests/bench-server-test.mjs                 # 主套件 + 变异 RED（人读）
//       node tests/bench-server-test.mjs --json           # 末尾附一行 BENCH-SERVER-TEST-JSON
//       node tests/bench-server-test.mjs --no-mutant      # 只跑主套件（变异子进程用）
//       node tests/bench-server-test.mjs --server=<路径>  # 换被测服务（变异阶段就是这么调自己的）
// 退出码：0 全绿 / 1 有失败（或变异没变红）/ 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(import.meta.dirname, '..')
const DEMO_DIR = path.join(ROOT, 'demo')
const SERVER_REAL = path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs')
const HERE_TEST = path.join(ROOT, 'tests', 'bench-server-test.mjs')

const argv = process.argv.slice(2)
const argVal = (n) => { const f = argv.find((a) => a.startsWith(`--${n}=`)); return f ? f.slice(f.indexOf('=') + 1) : null }
const JSON_OUT = argv.includes('--json')
const NO_MUTANT = argv.includes('--no-mutant')
const SERVER_UNDER_TEST = argVal('server') || SERVER_REAL

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法: node tests/bench-server-test.mjs [--json] [--no-mutant] [--server=<路径>]')
  process.exit(0)
}
if (!fs.existsSync(SERVER_UNDER_TEST) || !fs.statSync(SERVER_UNDER_TEST).isFile()) {
  console.error(`被测服务不存在：${SERVER_UNDER_TEST}`)
  process.exit(2)
}

// ── 断言与输出 ────────────────────────────────────────────────────────────────────────────────────
const results = []
function check(name, cond, detail) {
  const ok = !!cond
  results.push({ name, ok, detail: detail == null ? '' : String(detail).slice(0, 400) })
  console.log(`${ok ? '  ok  ' : 'FAIL  '} ${name}${detail && !ok ? `\n         ↳ ${String(detail).slice(0, 400)}` : ''}`)
  return ok
}
const failures = () => results.filter((r) => !r.ok)
let skipped = 0
const skip = (name, why) => { skipped++; console.log(` SKIP   ${name}（${why}）`) }

// ── 夹具（临时库 + 夹具 reports/Delete + 库外靶子）──────────────────────────────────────────────────
function writeFile(p, content) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content) }
/** 造一个**真实**的 PKG 家族容器（PKGV=场景包 / PKGM=.mpkg 合集包；目录表 + 原样存储的载荷）。
 *  与生产解析口径一致（packages/we-core/src/pkg.js 的 readPkgTable）。 */
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
/** 本机有没有 ffmpeg（缩略图抽帧那条能力用它；没有就 SKIP 对应断言，不当失败）。 */
function whichFfmpeg() {
  try { const p = execFileSync('which', ['ffmpeg'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return p || null } catch { return null }
}
/** 造一个**真能抽帧**的 1 秒 mp4（没有 ffmpeg 就写假字节：只测类型判定，抽帧断言 SKIP）。 */
function makeTinyMp4(out) {
  fs.mkdirSync(path.dirname(out), { recursive: true })     // ffmpeg 不会替你建目录
  const ff = whichFfmpeg()
  if (!ff) { writeFile(out, 'FAKE-MP4-BYTES'); return false }
  try {
    execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-pix_fmt', 'yuv420p', out], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30000 })
    return fs.existsSync(out) && fs.statSync(out).size > 0
  } catch { writeFile(out, 'FAKE-MP4-BYTES'); return false }
}
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-8902-'))
  const ws = path.join(base, 'ws')
  const dd = path.join(ws, 'allwallpaper', 'dd')
  const outside = path.join(base, 'outside')
  fs.mkdirSync(dd, { recursive: true })
  fs.mkdirSync(path.join(ws, 'reports'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  writeFile(path.join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE\n')

  const props = {
    clock: { type: 'bool', text: '时钟/Clock', value: false, order: 100 },
    newproperty1: { type: 'slider', text: '强度/Strength', value: 0.5, min: 0, max: 1.5, step: 0.01, precision: 3, order: 104 },
    schemecolor: { type: 'color', text: '颜色/Color', value: '1 1 1', order: 110 },
    grp: { type: 'group', text: '音频组件', value: '', order: 120 },
    fmt: { type: 'combo', text: '格式', value: '3', options: [{ label: 'A', value: '1' }, { label: 'B', value: '3' }], order: 121 },
    newproperty2: { text: '看图<br><img src="http://example.invalid/x.png">', value: '', order: 130 },
    tex: { type: 'file', text: '贴图', value: '', fileType: '.png,.jpg', order: 140 },
  }
  writeFile(path.join(dd, 'hina-scene', 'project.json'), JSON.stringify({
    type: 'Scene', title: '夹具场景 Hina', file: 'scene.json', preview: 'preview.gif', workshopid: '3554161528',
    general: { properties: props },
  }, null, 1))
  writeFile(path.join(dd, 'hina-scene', 'scene.pkg'), 'PKGV0001fixture-scene-bytes')
  writeFile(path.join(dd, 'hina-scene', 'preview.gif'), 'GIF89a-fixture-preview')

  writeFile(path.join(dd, 'web-lida', 'project.json'), JSON.stringify({ type: 'Web', title: '夹具网页壁纸', file: 'index.html', preview: 'preview.gif' }))
  writeFile(path.join(dd, 'web-lida', 'index.html'), '<!doctype html><title>fixture web</title>')
  writeFile(path.join(dd, 'web-lida', 'preview.gif'), 'GIF89a-web-preview')

  writeFile(path.join(dd, 'trash-me', 'project.json'), JSON.stringify({ type: 'scene', title: '待删夹具', file: 'scene.json' }))
  writeFile(path.join(dd, 'trash-me', 'scene.pkg'), 'PKGV-trash-me')

  writeFile(path.join(dd, 'sub', 'inner-scene', 'project.json'), JSON.stringify({ type: 'scene', title: '子目录场景', file: 'scene.json' }))
  writeFile(path.join(dd, 'sub', 'inner-scene', 'scene.pkg'), 'PKGV-inner')

  // ── 全类型语料（**独立库根** ws/types：不动 dd 的条目数，见 C3/C4）────────────────────────────
  const types = path.join(ws, 'types')
  writeFile(path.join(types, 'scene-a', 'project.json'), JSON.stringify({
    type: 'Scene', title: '类型夹具·场景', file: 'scene.json', preview: 'preview.gif',
    general: { properties: { clock: { type: 'bool', value: false } } },
  }))
  writeFile(path.join(types, 'scene-a', 'scene.pkg'), 'PKGV0022-scene-a')
  writeFile(path.join(types, 'scene-a', 'preview.gif'), 'GIF89a-scene-a-preview')
  writeFile(path.join(types, 'scene-gif', 'gifscene.pkg'), 'PKGV0022-gifscene')     // 无 project.json：靠内容判定
  writeFile(path.join(types, 'scene-gif', 'preview.png'), 'PNG-scene-gif-preview')
  writeFile(path.join(types, 'web-noproj', 'index.html'), '<!doctype html><title>fixture web no project.json</title>')
  writeFile(path.join(types, 'web-noproj', 'assets', 'app.js'), 'console.log("web-noproj")')
  writeFile(path.join(types, 'web-noproj', 'preview.gif'), 'GIF89a-web-noproj-preview')
  const mp4Real = makeTinyMp4(path.join(types, 'video-noproj', 'clip.mp4'))          // 无 project.json / 无 preview
  writeFile(path.join(types, 'video-declared', 'project.json'), JSON.stringify({ type: 'video', title: '类型夹具·视频', file: 'movie.mp4', preview: 'preview.jpg' }))
  makeTinyMp4(path.join(types, 'video-declared', 'movie.mp4'))
  writeFile(path.join(types, 'video-declared', 'preview.jpg'), 'JPEG-fixture-preview')
  // mpkg 容器（PKGM 家族 = 实测语料里的 .mpkg 形态）：容器内 preview.gif 未压缩 ⇒ 缩略图可直出
  const containerName = '夹具容器_01.mpkg'
  const containerBuf = buildPkg('PKGM0018', [
    ['preview.gif', Buffer.from('GIF89a-container-preview-bytes')],
    ['project.json', Buffer.from(JSON.stringify({ title: '夹具容器场景', type: 'Scene', file: 'scene.pkg', preview: 'preview.gif', workshopid: '999' }))],
    ['scene.pkg', Buffer.from('PKGV0022-inside-container')],
  ])
  fs.mkdirSync(path.join(types, 'mpkg-scene'), { recursive: true })
  fs.writeFileSync(path.join(types, 'mpkg-scene', containerName), containerBuf)
  // 顶层散落的 .mpkg（不是目录 ⇒ 不进列表，但必须**如实计数**并给出容器内类型）
  const looseName = '散的容器.mpkg'
  fs.mkdirSync(types, { recursive: true })
  fs.writeFileSync(path.join(types, looseName), buildPkg('PKGM0014', [['scene.pkg', Buffer.from('PKGV0022-loose')], ['preview.gif', Buffer.from('GIF89a-loose')]]))
  // 非 ASCII 目录名（中文收藏夹）：itemId 国际口径；内容 = scene.pkg
  writeFile(path.join(types, '流萤', 'scene.pkg'), 'PKGV0022-liuying')
  writeFile(path.join(types, '流萤', 'preview.gif'), 'GIF89a-liuying')
  // unknown + 子目录提示（入口在**下一层**，本层没有信号）
  writeFile(path.join(types, 'empty-dir', 'inner', 'scene.pkg'), 'PKGV0022-inner')

  let linkOk = false
  try { fs.symlinkSync(outside, path.join(dd, 'evil-link'), 'dir'); linkOk = true } catch { linkOk = false }
  let typesLinkOk = false
  try { fs.symlinkSync(outside, path.join(types, 'evil-link'), 'dir'); typesLinkOk = true } catch { typesLinkOk = false }
  return { base, ws, dd, types, outside, linkOk: linkOk && typesLinkOk, containerName, containerBuf, looseName, mp4Real }
}

/** 目录清单指纹（名字 + 大小；一律 statSync —— 本机 Dirent.isFile() 有误报）。 */
function dirFingerprint(dir) {
  const out = []
  for (const n of fs.readdirSync(dir).sort()) {
    const st = fs.statSync(path.join(dir, n))
    out.push(`${n}:${st.isDirectory() ? 'd' : 'f'}:${st.size}`)
  }
  return out.join('|')
}
/** 真树指纹：server 文件 + demo/**（跳过符号链接；限量防止意外放大）。 */
function treeFingerprint() {
  const h = createHash('sha256')
  const files = []
  const walk = (p, depth) => {
    const st = fs.lstatSync(p)
    if (st.isSymbolicLink()) { files.push(`L ${path.relative(ROOT, p)}`); return }
    if (st.isDirectory()) { if (depth > 4) return; for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n), depth + 1); return }
    if (st.isFile() && files.length < 400) files.push(`F ${path.relative(ROOT, p)} ${st.size} ${createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)}`)
  }
  for (const p of [SERVER_REAL, HERE_TEST]) walk(p, 0)
  walk(DEMO_DIR, 0)
  for (const f of files.sort()) h.update(f + '\n')
  return { hash: h.digest('hex'), files: files.length }
}

// ── HTTP 客户端（用 http.request，路径**原样**发出：`..` 不会被客户端规范化）──────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}
function request(port, method, urlPath, opts) {
  const o = opts || {}
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, o.headers || {})
    let body
    if (o.json !== undefined) { body = Buffer.from(JSON.stringify(o.json)); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(body.length) }
    else if (o.body !== undefined) { body = Buffer.isBuffer(o.body) ? o.body : Buffer.from(String(o.body)); headers['Content-Length'] = String(body.length) }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, timeout: 8000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        let json = null
        try { json = JSON.parse(buf.toString('utf8')) } catch { json = null }
        resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), buf, json })
      })
    })
    req.on('timeout', () => { req.destroy(new Error(`超时：${method} ${urlPath}`)) })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
/** SSE：读到满足 `until(text)` 就断开；返回收到的文本。 */
function readSse(port, urlPath, until, ms) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: urlPath, headers: { Accept: 'text/event-stream' }, timeout: ms || 5000 }, (res) => {
      let buf = ''
      const finish = (why) => { try { req.destroy() } catch { /* 已断 */ } resolve({ status: res.statusCode, headers: res.headers, text: buf, why }) }
      res.on('data', (c) => { buf += c.toString('utf8'); if (until(buf)) finish('matched') })
      res.on('end', () => finish('ended'))
      setTimeout(() => finish('timeout'), ms || 5000)
    })
    req.on('error', () => resolve({ status: 0, headers: {}, text: '', why: 'error' }))
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function startServer(fx, extraEnv, extraArgs) {
  const port = await freePort()
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    MPW_ROOT: fx.ws,
    MPW_LIBRARY_DIR: fx.dd,
    MPW_REPORTS_DIR: path.join(fx.ws, 'reports'),
    MPW_BENCH_STATIC_DIR: DEMO_DIR,          // 变异副本在 /tmp：静态面必须靠这个指回真树
  }, extraEnv || {})
  const child = spawn(process.execPath, [SERVER_UNDER_TEST, ...(extraArgs || [])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (c) => { log += c.toString() })
  child.stderr.on('data', (c) => { log += c.toString() })
  const deadline = Date.now() + 8000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`服务提前退出（code=${child.exitCode}）：\n${log}`)
    try { const r = await request(port, 'GET', '/__health'); if (r.status === 200) break } catch { /* 还没起来 */ }
    if (Date.now() > deadline) throw new Error(`服务 8s 未就绪：${SERVER_UNDER_TEST}\n${log}`)
    await sleep(100)
  }
  return { port, child, log: () => log, stop: async () => { try { child.kill('SIGTERM') } catch { /* 已退 */ } await sleep(120); try { child.kill('SIGKILL') } catch { /* 已退 */ } } }
}

// ── 主套件 ────────────────────────────────────────────────────────────────────────────────────────
async function runSuite() {
  const fx = makeFixture()
  console.log(`夹具库：${fx.dd}`)
  const servers = []
  try {
    const s = await startServer(fx, { MPW_OPEN_CMD: '/bin/true' })   // 打开器换成 /bin/true：**绝不**真开文件管理器/浏览器
    servers.push(s)
    const P = s.port
    const J = (r) => r.json || {}

    console.log('\n[A] 静态面（测试台 HTML + 挂载点 + no-store）')
    const root = await request(P, 'GET', '/')
    check('A1 GET / → 200 且是测试台 HTML（含产物入口 bench-DSKWIqmS.js）', root.status === 200 && /bench-DSKWIqmS\.js/.test(root.body), `status=${root.status} len=${root.body.length}`)
    check('A2 GET / 的 Cache-Control = no-store, must-revalidate（:8901 口径）', String(root.headers['cache-control'] || '').includes('no-store'), root.headers['cache-control'])
    const as = await request(P, 'GET', '/assets/bench-DSKWIqmS.js')
    check('A3 GET /assets/bench-DSKWIqmS.js → 200 + no-store（<base href="./"> 决定它必须挂在根）', as.status === 200 && String(as.headers['cache-control'] || '').includes('no-store') && /javascript/.test(String(as.headers['content-type'])), `${as.status} ${as.headers['content-type']} ${as.headers['cache-control']}`)
    const rend = await request(P, 'GET', '/wallpaper-engine-webgl/renderer/index.html')
    check('A4 产物写死的 iframe 路径 /wallpaper-engine-webgl/renderer/index.html → 200 text/html', rend.status === 200 && /text\/html/.test(String(rend.headers['content-type'])), `${rend.status} ${rend.headers['content-type']}`)
    const mounts = await Promise.all(['/demo/index.html', '/demo/', '/WEwebLoader/', '/wallpaper-engine-webgl/', '/renderer/index.html'].map((u) => request(P, 'GET', u)))
    check('A5 四个挂载点 + /renderer/ 全部 200', mounts.every((r) => r.status === 200), mounts.map((r, i) => `${['/demo/index.html', '/demo/', '/WEwebLoader/', '/wallpaper-engine-webgl/', '/renderer/index.html'][i]}=${r.status}`).join(' '))
    const redir = await request(P, 'GET', '/demo?x=1&t=2')
    check('A6 /demo?x=1&t=2 → 302 到 /demo/?x=1&t=2（query 原样带走）', redir.status === 302 && redir.headers.location === '/demo/?x=1&t=2', `${redir.status} ${redir.headers.location}`)
    const rawTrav = await request(P, 'GET', '/assets/../../etc/passwd')
    check('A7 原始 URL 里的 .. ⇒ 400（new URL 会规范化掉，所以必须看 raw req.url）', rawTrav.status === 400, `status=${rawTrav.status}`)
    const encTrav = await request(P, 'GET', '/assets/%2e%2e/%2e%2e/etc/passwd')
    check('A8 %2e%2e 编码的 .. ⇒ 400', encTrav.status === 400, `status=${encTrav.status}`)

    console.log('\n[B] /api/library（契约：{dir, items:[{itemId,title,type,hasScene,file,preview,properties}]}）')
    const lib = await request(P, 'GET', '/api/library')
    const items = (J(lib).items) || []
    const hina = items.find((i) => i.itemId === 'hina-scene')
    check('B1 GET /api/library → 200 + application/json + {dir, items[]}', lib.status === 200 && /application\/json/.test(String(lib.headers['content-type'])) && typeof J(lib).dir === 'string' && Array.isArray(items), `${lib.status} ${lib.headers['content-type']} items=${items.length}`)
    check('B2 场景项字段齐全且值对（itemId/title/type/hasScene/file/preview/properties）',
      !!hina && hina.title === '夹具场景 Hina' && hina.type === 'Scene' && hina.hasScene === true && hina.file === 'scene.json' && hina.preview === 'preview.gif'
      && hina.kind === 'scene' && hina.properties && hina.properties.clock && hina.properties.clock.type === 'bool',
      JSON.stringify(hina && { itemId: hina.itemId, title: hina.title, type: hina.type, hasScene: hina.hasScene, file: hina.file, preview: hina.preview, kind: hina.kind, props: hina.properties ? Object.keys(hina.properties).length : null }))
    const web = items.find((i) => i.itemId === 'web-lida')
    check('B3 web 项：hasScene=false、file=index.html、kind=web（调用方 rt() 的分支）', !!web && web.hasScene === false && web.file === 'index.html' && web.kind === 'web', JSON.stringify(web && { hasScene: web.hasScene, file: web.file, kind: web.kind }))
    check('B4 逃出库根的符号链接条目**不出现**在列表里（evil-link）', !items.some((i) => i.itemId === 'evil-link'), items.map((i) => i.itemId).join(','))

    console.log('\n[C] /api/library-dir（无宿主对话框 ⇒ 明确降级 + 库根内收窄）')
    const pick = await request(P, 'POST', '/api/library-dir', { json: { pick: true } })
    check('C1 POST {pick:true} → 200 + {cancelled:true, unsupported:true, degraded:true, degradedStatus:501}（非 2xx 会掐掉调用方的 prompt 回退）',
      pick.status === 200 && J(pick).cancelled === true && J(pick).unsupported === true && J(pick).degraded === true && J(pick).degradedStatus === 501, `${pick.status} ${pick.body.slice(0, 180)}`)
    const enumr = await request(P, 'GET', '/api/library-dir')
    const enumDirs = ((J(enumr).dirs) || []).map((d) => d.name)
    check('C2 GET /api/library-dir → 枚举库根内子目录（含 sub，不含逃逸的 evil-link）', enumr.status === 200 && enumDirs.includes('sub') && !enumDirs.includes('evil-link'), enumDirs.join(','))
    const narrow = await request(P, 'POST', '/api/library-dir', { json: { dir: 'sub' } })
    const libNarrow = await request(P, 'GET', '/api/library')
    check('C3 POST {dir:"sub"} → 200 + narrowed，且 /api/library 只列子目录里的项', narrow.status === 200 && J(narrow).narrowed === true && ((J(libNarrow).items) || []).length === 1 && J(libNarrow).items[0].itemId === 'inner-scene', `${narrow.status} → ${((J(libNarrow).items) || []).map((i) => i.itemId).join(',')}`)
    await request(P, 'POST', '/api/library-dir', { json: { reset: true } })
    const libBack = await request(P, 'GET', '/api/library')
    check('C4 POST {reset:true} → 库根还原（列表项数回到 4）', ((J(libBack).items) || []).length === 4, String(((J(libBack).items) || []).length))
    const esc = await request(P, 'POST', '/api/library-dir', { json: { dir: '../../' } })
    check('C5 POST {dir:"../../"} ⇒ 400（相对 dir 里的 .. 直接拒）', esc.status === 400, `${esc.status} ${esc.body.slice(0, 120)}`)

    console.log('\n[D] /api/props（读/写：形状按调用方 + 覆盖落 reports，不写进壁纸包）')
    const propsBefore = await request(P, 'GET', '/api/props?item=hina-scene')
    const plist = (J(propsBefore).props) || []
    const by = (n) => plist.find((p) => p.name === n)
    check('D1 GET /api/props?item= → 200 + {props:[…]}（数组）', propsBefore.status === 200 && Array.isArray(plist) && plist.length === 7, `${propsBefore.status} n=${plist.length}`)
    check('D2 描述子字段：name/text/ptype/value/default/overridden', !!by('clock') && by('clock').ptype === 'bool' && by('clock').value === false && by('clock').default === false && by('clock').overridden === false && by('clock').text === '时钟/Clock', JSON.stringify(by('clock')))
    check('D3 slider 带 min/max/step/precision；combo 带 options；group 的 ptype=group', !!by('newproperty1') && by('newproperty1').min === 0 && by('newproperty1').max === 1.5 && by('newproperty1').step === 0.01 && Array.isArray(by('fmt').options) && by('fmt').options.length === 2 && by('grp').ptype === 'group', JSON.stringify([by('newproperty1'), by('fmt'), by('grp')]).slice(0, 260))
    check('D4 无 type 的文案项 → ptype=text，并从 HTML 里抽出 media[{src}]', !!by('newproperty2') && by('newproperty2').ptype === 'text' && Array.isArray(by('newproperty2').media) && by('newproperty2').media[0].src === 'http://example.invalid/x.png', JSON.stringify(by('newproperty2')).slice(0, 200))
    const fpBefore = dirFingerprint(path.join(fx.dd, 'hina-scene'))
    const save = await request(P, 'POST', '/api/props?item=hina-scene', { json: { clock: true, newproperty1: 0.9 } })
    const fpAfter = dirFingerprint(path.join(fx.dd, 'hina-scene'))
    check('D5 POST /api/props → 200 {ok:true, count:2}', save.status === 200 && J(save).ok === true && J(save).count === 2, `${save.status} ${save.body.slice(0, 140)}`)
    const propsFile = path.join(fx.ws, 'reports', 'bench-props', 'hina-scene.json')
    const pf = fs.existsSync(propsFile) ? JSON.parse(fs.readFileSync(propsFile, 'utf8')) : null
    check('D6 覆盖落 <reports>/bench-props/<id>.json（不在壁纸目录里）', !!pf && pf.overrides && pf.overrides.clock === true && pf.overrides.newproperty1 === 0.9, propsFile)
    check('D7 **壁纸包没被写**：目录（名字+大小）指纹前后逐字相同', fpBefore === fpAfter, `${fpBefore} → ${fpAfter}`)
    const propsAfter = await request(P, 'GET', '/api/props?item=hina-scene')
    const clock2 = ((J(propsAfter).props) || []).find((p) => p.name === 'clock')
    check('D8 再读：value=true 且 overridden=true（覆盖生效）', clock2 && clock2.value === true && clock2.overridden === true && clock2.default === false, JSON.stringify(clock2))
    const badVal = await request(P, 'POST', '/api/props?item=hina-scene', { json: { clock: { nested: 1 } } })
    check('D9 非标量值 ⇒ 400', badVal.status === 400, `${badVal.status} ${badVal.body.slice(0, 120)}`)
    const badName = await request(P, 'POST', '/api/props?item=hina-scene', { json: { '../x': 1 } })
    check('D10 非法属性名 ⇒ 400', badName.status === 400, `${badName.status} ${badName.body.slice(0, 120)}`)

    console.log('\n[E] /api/props-dir 与 /api/props-file（无宿主选择器 ⇒ 降级；导入落 reports）')
    const pdir = await request(P, 'POST', '/api/props-dir', { json: { pick: true } })
    check('E1 POST /api/props-dir {pick:true} → 200 + unsupported + degradedStatus 501', pdir.status === 200 && J(pdir).unsupported === true && J(pdir).cancelled === true && J(pdir).degradedStatus === 501, `${pdir.status} ${pdir.body.slice(0, 160)}`)
    const pdirEnum = await request(P, 'GET', '/api/props-dir?item=hina-scene')
    check('E2 GET /api/props-dir?item= → 库根内枚举 {dir, dirs[]}', pdirEnum.status === 200 && typeof J(pdirEnum).dir === 'string' && Array.isArray(J(pdirEnum).dirs), `${pdirEnum.status} ${pdirEnum.body.slice(0, 140)}`)
    const fileName = '图 片.png'
    /* ①(用户第 34 条 安全策略) 夹具改成**真 PNG 头**：新策略要求"内容类别与扩展名一致"，
       旧夹具 `'PNGDATA-fixture'`（只是 ASCII 文本却叫 `.png`）现在会被**正确拒收**（415）——
       这正是那条判据在起作用；夹具必须给合法内容，否则就是在要求"放松策略"。 */
    const PNG_FIXTURE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fixture-bytes')])
    const up = await request(P, 'POST', `/api/props-file?item=hina-scene&name=tex`, { body: PNG_FIXTURE, headers: { 'X-Filename': encodeURIComponent(fileName), 'Content-Type': 'image/png' } })
    check('E3 POST /api/props-file → 200 且回 value（调用方 `!r.value` 会抛）', up.status === 200 && typeof J(up).value === 'string' && J(up).value.length > 0 && J(up).bytes === PNG_FIXTURE.length, `${up.status} ${up.body.slice(0, 200)}`)
    const back = J(up).value ? await request(P, 'GET', J(up).value) : { status: 0, buf: Buffer.alloc(0) }
    check('E4 回读 value 指向的 URL：200 + 内容逐字节相同', back.status === 200 && Buffer.compare(back.buf, PNG_FIXTURE) === 0, `${back.status} ${back.buf.length}B`)
    /* 安全策略在**这条路由**上的行为也要钉住（用户第 34 条）：脚本类一律 415、内容与扩展名不符也 415。 */
    const upHtml = await request(P, 'POST', '/api/props-file?item=hina-scene&name=tex', { body: Buffer.from('<html><script>x</script>'), headers: { 'X-Filename': 'evil.html' } })
    check('E3b 安全策略：`.html`（脚本类）⇒ **415 + 人读原因**', upHtml.status === 415 && /拒收|白名单/.test(upHtml.body), `${upHtml.status} ${upHtml.body.slice(0, 140)}`)
    const upPe = await request(P, 'POST', '/api/props-file?item=hina-scene&name=tex', { body: Buffer.from('MZ\x90\x00binary'), headers: { 'X-Filename': 'evil.png' } })
    check('E3c 安全策略：PE 可执行改名 `.png` ⇒ **415**（防改后缀绕过）', upPe.status === 415 && /可执行/.test(upPe.body), `${upPe.status} ${upPe.body.slice(0, 140)}`)
    const upEsc = await request(P, 'POST', '/api/props-file?item=hina-scene&name=tex', { body: Buffer.from('x'), headers: { 'X-Filename': encodeURIComponent('../../escape.txt') } })
    check('E5 X-Filename 带路径分隔符 ⇒ 400（不许逃出 reports）', upEsc.status === 400, `${upEsc.status} ${upEsc.body.slice(0, 120)}`)
    const nameEsc = await request(P, 'POST', '/api/props-file?item=hina-scene&name=..%2Fx', { body: Buffer.from('x'), headers: { 'X-Filename': 'ok.png' } })
    check('E6 name 带路径分隔符 ⇒ 400', nameEsc.status === 400, `${nameEsc.status} ${nameEsc.body.slice(0, 120)}`)

    console.log('\n[F] /api/delete（默认 dryRun 不移动；confirm=1 移进回收站）')
    const trashRoot = path.join(fx.ws, 'Delete', 'bench-trash')
    const dry = await request(P, 'POST', '/api/delete', { json: { itemId: 'trash-me' } })
    const stillThere = fs.existsSync(path.join(fx.dd, 'trash-me', 'scene.pkg'))
    const trashHas = fs.existsSync(trashRoot) && fs.readdirSync(trashRoot).length > 0
    check('F1 POST /api/delete（默认）→ 200 + dryRun:true + 计划（from/to/fileCount）', dry.status === 200 && J(dry).dryRun === true && J(dry).wouldMove === true && J(dry).from === path.join(fx.dd, 'trash-me') && J(dry).fileCount === 2, `${dry.status} ${dry.body.slice(0, 200)}`)
    check('F2 dryRun **没有移动任何文件**：原路径还在、回收站是空的/不存在', stillThere && !trashHas, `原路径=${stillThere} 回收站有内容=${trashHas}`)
    const conf = await request(P, 'POST', '/api/delete?confirm=1', { json: { itemId: 'trash-me' } })
    const gone = !fs.existsSync(path.join(fx.dd, 'trash-me'))
    const to = J(conf).to || ''
    const inTrash = !!to && fs.existsSync(path.join(to, 'scene.pkg')) && to.startsWith(trashRoot + path.sep)
    check('F3 POST /api/delete?confirm=1 → 200 + dryRun:false + to 在 <MPW_ROOT>/Delete/bench-trash/<ts>/ 下', conf.status === 200 && J(conf).dryRun === false && inTrash, `${conf.status} to=${to}`)
    check('F4 真删后：原路径消失、回收站里有它（可 `mv` 回滚）', gone && inTrash, `原路径消失=${gone} 回收站里有=${inTrash}`)
    const dEsc1 = await request(P, 'POST', '/api/delete', { json: { itemId: '../outside' } })
    const dEsc2 = await request(P, 'POST', '/api/delete', { json: { itemId: '/etc' } })
    const dEsc3 = await request(P, 'POST', '/api/delete', { json: { itemId: 'evil-link' } })
    check('F5 delete itemId=../outside ⇒ 400；=/etc ⇒ 400（单段校验）', dEsc1.status === 400 && dEsc2.status === 400, `${dEsc1.status}/${dEsc2.status}`)
    check('F6 delete itemId=evil-link（符号链接逃逸）⇒ 403，且库外目录**没被移走**', dEsc3.status === 403 && fs.existsSync(path.join(fx.outside, 'secret.txt')), `${dEsc3.status} ${dEsc3.body.slice(0, 120)}`)

    console.log('\n[G] /api/reveal 与 /api/props /media 的路径逃逸')
    const rEsc1 = await request(P, 'POST', '/api/reveal', { json: { itemId: 'evil-link' } })
    const rEsc2 = await request(P, 'POST', '/api/reveal', { json: { path: '../outside' } })
    check('G1 reveal：符号链接逃逸 ⇒ 403（先校验路径，再看打开器）', rEsc1.status === 403, `${rEsc1.status} ${rEsc1.body.slice(0, 120)}`)
    check('G2 reveal：path 含 .. ⇒ 400', rEsc2.status === 400, `${rEsc2.status} ${rEsc2.body.slice(0, 120)}`)
    const pEsc1 = await request(P, 'GET', '/api/props?item=..%2Foutside')
    const pEsc2 = await request(P, 'GET', '/api/props?item=%2Fetc')
    const pEsc3 = await request(P, 'GET', '/api/props?item=evil-link')
    check('G3 props?item=../outside ⇒ 400、=/etc ⇒ 400、=evil-link ⇒ 403', pEsc1.status === 400 && pEsc2.status === 400 && pEsc3.status === 403, `${pEsc1.status}/${pEsc2.status}/${pEsc3.status}`)
    const mOk = await request(P, 'GET', '/media/dev/hina-scene/scene.pkg')
    check('G4 /media/dev/<id>/scene.pkg → 200 且字节与磁盘一致', mOk.status === 200 && mOk.body === 'PKGV0001fixture-scene-bytes', `${mOk.status} ${JSON.stringify(mOk.body.slice(0, 40))}`)
    const mRange = await request(P, 'GET', '/media/dev/hina-scene/scene.pkg', { headers: { Range: 'bytes=0-3' } })
    check('G5 Range: bytes=0-3 → 206 + Content-Range + 4 字节（视频/拖动进度必需）', mRange.status === 206 && mRange.headers['content-range'] === 'bytes 0-3/27' && mRange.buf.length === 4 && mRange.body === 'PKGV', `${mRange.status} ${mRange.headers['content-range']} ${JSON.stringify(mRange.body)}`)
    const mEsc = await request(P, 'GET', '/media/dev/evil-link/secret.txt')
    check('G6 /media/dev/evil-link/secret.txt（符号链接逃逸）⇒ 403，库外文件读不到', mEsc.status === 403 && !mEsc.body.includes('TOP-SECRET'), `${mEsc.status} ${mEsc.body.slice(0, 100)}`)
    const mTrav = await request(P, 'GET', '/media/dev/hina-scene/../../outside/secret.txt')
    check('G7 /media raw .. ⇒ 400，库外文件读不到', mTrav.status === 400 && !mTrav.body.includes('TOP-SECRET'), `${mTrav.status} ${mTrav.body.slice(0, 100)}`)
    const trev = await request(P, 'POST', '/api/reveal', { json: { itemId: 'hina-scene' } })
    check('G8 reveal（MPW_OPEN_CMD=/bin/true）→ 200 {opened:true, opener:"/bin/true"}', trev.status === 200 && J(trev).opened === true && J(trev).opener === '/bin/true', `${trev.status} ${trev.body.slice(0, 140)}`)

    console.log('\n[H] /api/diag-stream（SSE）+ /diag（环形缓冲来源）+ /__health')
    const ssePromise = readSse(P, '/api/diag-stream', (t) => t.includes('hello-bench-sse'), 5000)
    await sleep(200)
    const got = await ssePromise
    await request(P, 'POST', '/diag', { json: { msg: 'hello-bench-sse' } })
    const got2 = got.text.includes('hello-bench-sse') ? got : await readSse(P, '/api/diag-stream', (t) => t.includes('hello-bench-sse'), 3000)
    check('H1 GET /api/diag-stream → 200 + text/event-stream', got.status === 200 && /text\/event-stream/.test(String(got.headers['content-type'])), `${got.status} ${got.headers['content-type']}`)
    const evtLine = got2.text.split('\n').find((l) => l.includes('hello-bench-sse')) || ''
    let evt = null
    try { evt = JSON.parse(evtLine.replace(/^data: /, '')) } catch { evt = null }
    check('H2 POST /diag 的消息经 SSE 到达，且 `JSON.parse(data).msg` 就是原文（调用方只读 .msg）', !!evt && evt.msg === 'hello-bench-sse', evtLine.slice(0, 160))
    const diagImg = await request(P, 'GET', '/diag?msg=' + encodeURIComponent('image-sink'))
    check('H3 GET /diag?msg= ←→ 200 image/gif（renderer 用 new Image() 上报，回 1×1 gif 不报错）', diagImg.status === 200 && /image\/gif/.test(String(diagImg.headers['content-type'])), `${diagImg.status} ${diagImg.headers['content-type']}`)
    const health = await request(P, 'GET', '/__health')
    const H = J(health)
    check('H4 GET /__health → 200 + 端口/库根/能力清单/降级列表', health.status === 200 && H.port === P && H.libraryRoot === fx.dd && H.capabilities && Array.isArray(H.degraded) && H.degraded.length >= 3, `${health.status} port=${H.port} root=${H.libraryRoot} degraded=${(H.degraded || []).length}`)
    check('H5 /__health.degraded 里能查到"无宿主选择器"与 reveal 的 501 说明', (H.degraded || []).some((d) => d.capability === 'native-folder-picker' && d.capabilityStatus === 501) && (H.degraded || []).some((d) => d.capability === 'open-in-file-manager'), JSON.stringify((H.degraded || []).map((d) => d.endpoint)))
    check('H6 /__health.reveal 报告打开器（MPW_OPEN_CMD=/bin/true）', H.reveal && H.reveal.available === true && H.reveal.opener === '/bin/true', JSON.stringify(H.reveal))
    const notFound = await request(P, 'GET', '/definitely-not-here')
    const alive = await request(P, 'GET', '/__health')
    check('H7 未知路径 ⇒ 404，且**服务没崩**（随后 /__health 仍 200）', notFound.status === 404 && alive.status === 200, `404=${notFound.status} health=${alive.status}`)
    check('H8 静态面 no-store 与库根只读：库目录树指纹仍与夹具一致（服务不改库）', fs.existsSync(path.join(fx.dd, 'hina-scene', 'scene.pkg')) && dirFingerprint(path.join(fx.dd, 'hina-scene')).includes('scene.pkg'), dirFingerprint(path.join(fx.dd, 'hina-scene')))

    console.log('\n[I] reveal 的 501 降级路径（PATH="" ⇒ 找不到任何打开器；**必须 501，不能 500**）')
    const s2 = await startServer(fx, { PATH: '', MPW_OPEN_CMD: '' })
    servers.push(s2)
    const noOpen = await request(s2.port, 'POST', '/api/reveal', { json: { itemId: 'hina-scene' } })
    check('I1 找不到打开器 ⇒ **501** + unsupported:true + error/reason/hint（不是 500，也不假装成功）',
      noOpen.status === 501 && J(noOpen).unsupported === true && !!J(noOpen).error && !!J(noOpen).reason && !!J(noOpen).hint, `${noOpen.status} ${noOpen.body.slice(0, 200)}`)
    const h2 = await request(s2.port, 'GET', '/__health')
    check('I2 /__health.reveal 如实报告 available:false + status:501', J(h2).reveal && J(h2).reveal.available === false && J(h2).reveal.status === 501, JSON.stringify(J(h2).reveal))
    const stillWorks = await request(s2.port, 'GET', '/api/library')
    check('I3 降级不影响其它端点：同一进程里 /api/library 仍 200', stillWorks.status === 200, String(stillWorks.status))
    if (!fx.linkOk) skip('符号链接逃逸用例', '本机 symlinkSync 不可用（EPERM）')

    console.log('\n[J] 服务端只读目录选择器（环境内浏览：不用系统对话框也能选到 <MPW_ROOT>/allwallpaper/**）')
    const s3 = await startServer(fx, { MPW_LIBRARY_DIR: '', MPW_OPEN_CMD: '/bin/true' })   // 「默认来源」实例
    servers.push(s3)
    const P3 = s3.port
    const rootList = await request(P3, 'GET', '/api/dir-list')
    const rootDirs = ((J(rootList).dirs) || []).map((d) => d.name)
    check('J1 GET /api/dir-list（无 path）→ 200 + 列浏览根（含 allwallpaper 与 types 夹具）',
      rootList.status === 200 && J(rootList).dir === fx.ws && J(rootList).atRoot === true && J(rootList).parent === null && rootDirs.includes('allwallpaper') && rootDirs.includes('types') && J(rootList).readOnly === true,
      `${rootList.status} dir=${J(rootList).dir} atRoot=${J(rootList).atRoot} dirs=${rootDirs.join(',')}`)
    const inAll = await request(P3, 'GET', `/api/dir-list?path=${encodeURIComponent(fx.ws + '/allwallpaper')}`)
    const inDirs = ((J(inAll).dirs) || []).map((d) => d.name)
    check('J2 能进 <MPW_ROOT>/allwallpaper ⇒ 列出 dd（库根**之外、浏览根之内**的目录也能进）',
      inAll.status === 200 && J(inAll).dir === path.join(fx.ws, 'allwallpaper') && inDirs.includes('dd') && J(inAll).parent === fx.ws,
      `${inAll.status} dir=${J(inAll).dir} dirs=${inDirs.join(',')} parent=${J(inAll).parent}`)
    const keyed = await request(P3, 'GET', '/api/dir-list?files=1&path=' + encodeURIComponent(fx.ws))
    check('J3 列出的目录带"像不像壁纸"的判据（entryKind/signal）+ 计数 + 只读自述',
      keyed.status === 200 && ((J(keyed).dirs) || []).every((d) => typeof d.entryKind === 'string' && 'looksLikeWallpaper' in d) && typeof J(keyed).counts.dirs === 'number' && J(keyed).pickHint && J(keyed).pickHint.commit,
      JSON.stringify(((J(keyed).dirs) || []).slice(0, 3)))
    const upR = await request(P3, 'GET', `/api/dir-parent?path=${encodeURIComponent(fx.ws + '/allwallpaper')}`)
    check('J4 GET /api/dir-parent ⇒ 回上一级（from=原目录，dir=父目录）',
      upR.status === 200 && J(upR).dir === fx.ws && J(upR).from === path.join(fx.ws, 'allwallpaper') && J(upR).atRoot === true && J(upR).moved === 'up' && J(upR).stayedAtRoot === false,
      `${upR.status} dir=${J(upR).dir} from=${J(upR).from}`)
    const esc1 = await request(P3, 'GET', '/api/dir-list?path=' + encodeURIComponent('../../etc'))
    check('J5 浏览相对路径含 .. ⇒ 400（不是"被 new URL 规范化掉"）', esc1.status === 400, `${esc1.status} ${esc1.body.slice(0, 120)}`)
    const esc2 = await request(P3, 'GET', '/api/dir-list?path=' + encodeURIComponent('/etc'))
    const esc3 = await request(P3, 'GET', '/api/dir-list?path=%2Fetc')
    check('J6 浏览绝对路径越界（/etc 与 %2Fetc）⇒ 403，且**没有**列出 /etc 的内容',
      esc2.status === 403 && esc3.status === 403 && !/passwd|hostname/.test(esc2.body) && !/passwd/.test(esc3.body),
      `${esc2.status}/${esc3.status} ${esc2.body.slice(0, 100)}`)
    const esc4 = await request(P3, 'GET', '/api/dir-list?path=' + encodeURIComponent(fx.types + '/../..'))
    check('J7 浏览路径用 ../.. 跳出去 ⇒ 403（绝对路径也要过真身校验）', esc4.status === 403, `${esc4.status} ${esc4.body.slice(0, 120)}`)
    const escLink = await request(P3, 'GET', '/api/dir-list?path=' + encodeURIComponent(fx.types + '/evil-link'))
    const typesList = await request(P3, 'GET', `/api/dir-list?path=${encodeURIComponent(fx.types)}`)
    check('J8 符号链接逃逸目录：直接进 ⇒ 403；在父目录列表里 ⇒ **不出现**',
      escLink.status === 403 && !((J(typesList).dirs) || []).some((d) => d.name === 'evil-link') && !/TOP-SECRET/.test(escLink.body),
      `${escLink.status} listed=${((J(typesList).dirs) || []).map((d) => d.name).join(',')}`)
    const pickOk = await request(P3, 'POST', '/api/dir-pick', { json: { path: fx.types } })
    check('J9 POST /api/dir-pick（就选这个目录）⇒ 200 + picked + 扫描摘要 + **不改库根**（asLibrary 默认 false）',
      pickOk.status === 200 && J(pickOk).picked === true && J(pickOk).dir === fx.types && J(pickOk).asLibrary === false && J(pickOk).scan && J(pickOk).scan.count === 9 && J(pickOk).libraryBefore.dir === fx.dd,
      `${pickOk.status} ${JSON.stringify({ picked: J(pickOk).picked, dir: J(pickOk).dir, asLibrary: J(pickOk).asLibrary, count: J(pickOk).scan && J(pickOk).scan.count, kinds: J(pickOk).scan && J(pickOk).scan.kinds, escaped: J(pickOk).scan && J(pickOk).scan.escaped, before: J(pickOk).libraryBefore })}`)
    check('J10 dir-pick 的扫描摘要如实分开"子目录条目"与"顶层散文件/容器"；逃逸软链只计 escaped 不算条目',
      J(pickOk).scan.dirs === 9 && J(pickOk).scan.escaped === 1 && J(pickOk).scan.count === 9 && J(pickOk).scan.looseFiles === 1 && J(pickOk).scan.looseContainers.length === 1 && J(pickOk).scan.looseContainers[0].kind === 'scene' && J(pickOk).scan.looseContainers[0].name === fx.looseName,
      JSON.stringify({ dirs: J(pickOk).scan.dirs, escaped: J(pickOk).scan.escaped, count: J(pickOk).scan.count, looseFiles: J(pickOk).scan.looseFiles, loose: J(pickOk).scan.looseContainers.map((c) => c.name + ':' + c.kind) }))
    const pickEsc = await request(P3, 'POST', '/api/dir-pick', { json: { path: '/etc' } })
    const pickEsc2 = await request(P3, 'POST', '/api/dir-pick', { json: { path: '../../' } })
    const pickMiss = await request(P3, 'POST', '/api/dir-pick', { json: { path: fx.ws + '/nope-not-here' } })
    check('J11 dir-pick：越界绝对路径 ⇒ 403；.. ⇒ 400；不存在 ⇒ 404',
      pickEsc.status === 403 && pickEsc2.status === 400 && pickMiss.status === 404, `${pickEsc.status}/${pickEsc2.status}/${pickMiss.status}`)
    const compat = await request(P3, 'GET', '/list-dirs?path=' + encodeURIComponent(fx.ws + '/allwallpaper'))
    check('J12 兼容壳 GET /list-dirs（插件同形：{ok,dir,subdirs,home,platform}）⇒ 200 且 subdirs 含 dd',
      compat.status === 200 && Array.isArray(J(compat).subdirs) && J(compat).subdirs.includes('dd') && typeof J(compat).home === 'string' && typeof J(compat).platform === 'string',
      `${compat.status} ${compat.body.slice(0, 160)}`)
    const fsRootsR = await request(P3, 'GET', '/api/fs/roots')
    const roots = (J(fsRootsR).roots) || []
    const labels = roots.map((r) => r.label).join(' | ')
    const pathsAbs = roots.every((r) => path.isAbsolute(r.path))
    /* ①(PA-37 2026-09-24 可移植性审计) 这里原来把实现里那 3 条候选**逐字钉死**
       （`r.path === fx.ws`、`r.path === path.join(fx.ws,'allwallpaper')`、`r.path === os.homedir()`）：
       测试与实现自我循环 —— 于是"把作者专属快捷根改成一般规则"必然让门禁变红，**门禁在保护缺陷**。
       现在断言的是**契约**（与"具体有哪些根"无关，任何一台机器上都成立）：
         ① roots 非空、path 绝对且已规范化；② 每条带 exists/listable/reason，且 `exists` 必须**如实**
         （用 fs.existsSync 逐条复核）；③ `listable ⇒ exists`，不可列必须给非空 reason（不许"列出来但不说为什么"）；
         ④ path 去重；⑤ **标签必须由 basename/角色词拼出**，不得把 ≥2 段的绝对路径原样抄进标签
         （"标签也要推导"—— 作者工作区目录名当初就是这么漏进 UI 的）；
         ⑥ 必须含**当前库根**与**它的上一级**（两者都从夹具/运行期推导）；⑦ 必须含 os.homedir()。
       "还有哪些根"由实现按运行期信息推导 ⇒ 本判据不关心，也就不会再保护任何一种写法。
       （分辨力证明：把实现里那两条作者式根删掉/参数化后，本条**仍然绿** —— 见下面"变异 J2"那一段。）*/
    const absNorm = roots.length > 0 && roots.every((r) => typeof r.path === 'string' && path.isAbsolute(r.path) && path.resolve(r.path) === r.path)
    const existsTruthful = roots.every((r) => typeof r.exists === 'boolean' && r.exists === fs.existsSync(r.path))
    const flagsContract = roots.every((r) => typeof r.listable === 'boolean'
      && (r.listable ? r.exists === true : (typeof r.reason === 'string' && r.reason.length > 0)))
    const dedupedPaths = new Set(roots.map((r) => r.path)).size === roots.length
    const ABS_IN_LABEL = /(^|[\s（(])(\/[^/\s]+\/[^/\s]+|[A-Za-z]:\\)/
    const labelsDerived = roots.every((r) => typeof r.label === 'string' && r.label.length > 0 && !ABS_IN_LABEL.test(r.label))
    const hasLibrary = roots.some((r) => r.path === path.resolve(fx.dd) && (r.kind === 'library' || r.role === 'library'))
    const hasLibraryParent = roots.some((r) => r.path === path.resolve(path.dirname(fx.dd)))       // 从库根推导，不点名作者目录
    const hasHome = roots.some((r) => r.path === path.resolve(os.homedir()))
    check('J13 GET /api/fs/roots ⇒ {ok,roots:[…]} 且满足快捷根**契约**（非空 / 绝对且规范化 / exists 如实 / listable⇒exists 且不可列必有 reason / path 去重 / 标签只由 basename+角色词拼出 / 含当前库根与其上一级与 os.homedir()）',
      fsRootsR.status === 200 && Array.isArray(J(fsRootsR).roots) && pathsAbs &&
      absNorm && existsTruthful && flagsContract && dedupedPaths && labelsDerived && hasLibrary && hasLibraryParent && hasHome,
      `${fsRootsR.status} n=${roots.length} abs=${absNorm} exists如实=${existsTruthful} flags=${flagsContract} 去重=${dedupedPaths} 标签推导=${labelsDerived} 库根=${hasLibrary} 库根上一级=${hasLibraryParent} home=${hasHome} | ${labels}`)
    const fsList = await request(P3, 'GET', '/api/fs/list?path=' + encodeURIComponent(fx.types))
    const fe = (J(fsList).entries) || []
    const byName = (n) => fe.find((e) => e.name === n)
    check('J14 GET /api/fs/list ⇒ {ok,path,parent,entries:[{name,type,size,kind}]}（kind 枚举齐全）',
      fsList.status === 200 && J(fsList).path === fx.types && J(fsList).parent === fx.ws && fe.length === 9 &&
      fe.every((e) => typeof e.name === 'string' && (e.type === 'dir' || e.type === 'file') && typeof e.size === 'number' && ['wallpaper', 'scene', 'video', 'web', 'other'].includes(e.kind)),
      `${fsList.status} n=${fe.length} ${fe.slice(0, 4).map((e) => `${e.name}:${e.type}:${e.kind}`).join(',')}`)
    check('J15 fs/list 的 kind 判定：目录看"是不是壁纸目录"、文件看扩展名（scene/video/web/other），非 ASCII 名照列',
      !!byName('scene-a') && byName('scene-a').kind === 'wallpaper' && byName('scene-a').entryKind === 'scene' &&
      !!byName('web-noproj') && byName('web-noproj').kind === 'wallpaper' && byName('web-noproj').entryKind === 'web' &&
      !!byName('empty-dir') && byName('empty-dir').kind === 'other' &&
      !!byName(fx.looseName) && byName(fx.looseName).type === 'file' && byName(fx.looseName).kind === 'scene' && byName(fx.looseName).container === true &&
      !!byName('流萤') && byName('流萤').kind === 'wallpaper' && byName('流萤').entryKind === 'scene',
      JSON.stringify(fe.map((e) => `${e.name}:${e.type}:${e.kind}:${e.entryKind || ''}`)))
    const fsListRel = await request(P3, 'GET', '/api/fs/list?path=relative/thing')
    const fsListEsc = await request(P3, 'GET', '/api/fs/list?path=' + encodeURIComponent(fx.outside))
    const fsListSym = await request(P3, 'GET', '/api/fs/list?path=' + encodeURIComponent(fx.types + '/evil-link'))
    const fsListMiss = await request(P3, 'GET', '/api/fs/list?path=' + encodeURIComponent(fx.ws + '/nope'))
    check('J16 fs/list 错误码：相对路径 ⇒ 400；越界/符号链接逃逸 ⇒ 403；不存在 ⇒ 404（只读，绝不写）',
      fsListRel.status === 400 && fsListEsc.status === 403 && fsListSym.status === 403 && fsListMiss.status === 404,
      `${fsListRel.status}/${fsListEsc.status}/${fsListSym.status}/${fsListMiss.status}`)
    const fsPick = await request(P3, 'POST', '/api/fs/pick', { json: { path: fx.types, scan: false } })
    const afterPick = await request(P3, 'GET', '/api/library')
    check('J17 POST /api/fs/pick ⇒ 200 + source:"user" 且库根真的换了（/api/library.dir + items 都是它）',
      fsPick.status === 200 && J(fsPick).source === 'user' && J(fsPick).selected === true && J(fsPick).path === fx.types &&
      // ①(P-261) 基线跟随：库根顶层散落的容器也成一等项 ⇒ `types` 根的 items 8 → 9
      J(afterPick).dir === fx.types && J(afterPick).source === 'user' && ((J(afterPick).items) || []).length === 9,
      `${fsPick.status} ${fsPick.body.slice(0, 160)} → dir=${J(afterPick).dir} items=${((J(afterPick).items) || []).length}`)
    const resetBack = await request(P3, 'POST', '/api/library-dir', { json: { reset: true } })
    check('J18 POST /api/library-dir {reset:true} ⇒ 库根还原且 source 回到配置来源（不再假装 user）',
      resetBack.status === 200 && J(resetBack).dir === fx.dd && J(resetBack).selected === false && J(resetBack).source === 'default',
      `${resetBack.status} ${resetBack.body.slice(0, 160)}`)

    console.log('\n[K] 库来源必须**显式**（env / cli / user / default / none；未选择时不许假装已选）')
    const srcEnv = await request(P, 'GET', '/api/library-source')
    check('K1 MPW_LIBRARY_DIR 指定 ⇒ source=env + selected=false（配置来源 ≠ 用户已选）',
      srcEnv.status === 200 && J(srcEnv).source === 'env' && J(srcEnv).selected === false && J(srcEnv).explicit === true && J(srcEnv).dir === fx.dd &&
      /MPW_LIBRARY_DIR/.test(J(srcEnv).library.configuredFrom), `${srcEnv.status} ${srcEnv.body.slice(0, 200)}`)
    const srcDefault = await request(P3, 'GET', '/api/library-source')
    check('K2 没给 MPW_LIBRARY_DIR ⇒ source=default，且路径就是仓库约定 <MPW_ROOT>/allwallpaper/dd（不是"用户选过"）',
      srcDefault.status === 200 && J(srcDefault).source === 'default' && J(srcDefault).selected === false && J(srcDefault).explicit === false &&
      J(srcDefault).dir === fx.dd && J(srcDefault).library.configuredSource === 'default' && /allwallpaper/.test(J(srcDefault).library.configuredFrom),
      `${srcDefault.status} ${srcDefault.body.slice(0, 220)}`)
    const libDefault = await request(P3, 'GET', '/api/library')
    check('K3 默认来源仍然可用（列表非空）但顶层 source/selected/explicit 三件套如实回报',
      libDefault.status === 200 && J(libDefault).source === 'default' && J(libDefault).selected === false && J(libDefault).explicit === false &&
      ((J(libDefault).items) || []).length === 3 && typeof J(libDefault).dir === 'string',
      `source=${J(libDefault).source} selected=${J(libDefault).selected} items=${((J(libDefault).items) || []).length}`)
    const hDef = await request(P3, 'GET', '/__health')
    check('K4 /__health.library 也带 source/selected/reason（人读的来龙去脉，不用猜）',
      J(hDef).library && J(hDef).library.source === 'default' && J(hDef).library.selected === false && typeof J(hDef).library.reason === 'string' && /没有人选过|默认/.test(J(hDef).library.reason),
      JSON.stringify(J(hDef).library && { source: J(hDef).library.source, reason: String(J(hDef).library.reason).slice(0, 120) }))
    const srcNone = await (async () => {
      const empty = path.join(fx.base, 'emptyspace')          // MPW_ROOT 指到空目录 ⇒ 推导候选全都不存在
      fs.mkdirSync(empty, { recursive: true })
      /* ⚠(2026-09-24 契约变更，随可移植性审计 B1 一起来) 库根默认值从"写死 <MPW_ROOT>/allwallpaper/dd"
         改成**候选列表 + 存在性探测**（…/allwallpaper/dd → …/allwallpaper → **<repo>/samples**）。
         于是"候选全都不存在"这条路径要靠 `MPW_NO_BUNDLED_SAMPLES=1`（显式不采用仓库自带样例）才能构造 ——
         本判据的**意图一个字没变**：没有任何可用库根时必须 `source:'none'` + 空列表 + `ok:true`（不是 500）。 */
      const s5 = await startServer(fx, { MPW_ROOT: empty, MPW_LIBRARY_DIR: '', MPW_NO_BUNDLED_SAMPLES: '1', MPW_OPEN_CMD: '/bin/true' })
      servers.push(s5)
      const r = await request(s5.port, 'GET', '/api/library-source')
      const lib = await request(s5.port, 'GET', '/api/library')
      check('K5 没有显式配置且**所有候选都不存在**（MPW_NO_BUNDLED_SAMPLES=1）⇒ source=none，items 为空且 **ok:true**（不是 500）',
        r.status === 200 && J(r).source === 'none' && J(r).exists === false && J(r).selected === false &&
        lib.status === 200 && J(lib).ok === true && J(lib).missing === true && ((J(lib).items) || []).length === 0 && /不存在/.test(String(J(lib).error)),
        `${r.status} ${r.body.slice(0, 160)} | library=${lib.status} ${lib.body.slice(0, 140)}`)
      return r
    })()
    check('K6 source=none 时 /api/library-source 也如实给出 reason（人读：没有 MPW_LIBRARY_DIR、默认路径也不存在）',
      /默认路径|没有/.test(String(J(srcNone).reason)) && J(srcNone).library.configuredExists === false,
      String(J(srcNone).reason).slice(0, 200))

    console.log('\n[L] 全类型扫描（scene / video / web / mpkg）+ 缩略图 + 容器目录表（web/mp4 档也要能出图）')
    const cliSrv = await startServer(fx, { MPW_LIBRARY_DIR: '', MPW_OPEN_CMD: '/bin/true' }, [`--library=${fx.types}`])
    servers.push(cliSrv)
    const P4 = cliSrv.port
    const srcCli = await request(P4, 'GET', '/api/library-source')
    check('L1 --library=DIR ⇒ source=cli（命令行来源也要显式）+ selected=false',
      srcCli.status === 200 && J(srcCli).source === 'cli' && J(srcCli).selected === false && J(srcCli).explicit === true && J(srcCli).dir === fx.types,
      `${srcCli.status} ${srcCli.body.slice(0, 200)}`)
    const lib4 = await request(P4, 'GET', '/api/library')
    const items4 = (J(lib4).items) || []
    const it = (id) => items4.find((i) => i.itemId === id)
    /* ③(2026-09-24 `.mpkg` 一等项口径变化，读数重算 —— 见 `tests/bench-mpkg-items-test.mjs` A1 段)：
       `types/mpkg-scene/` 里只有一个 `夹具容器_01.mpkg` ⇒ 该目录**逐文件成项**（itemId 变**嵌套路径**
       `mpkg-scene/夹具容器_01.mpkg`），条目类型按**容器内条目**判定（容器里有 `scene.pkg` ⇒ `scene`），
       目录那一条**不再产出**（否则同一批壁纸重复计数）。所以：
         · `count` 仍是 **8**（8 个目录 ⇒ 7 个目录条 + 1 个文件条）；
         · `kinds` 由 `{scene:3,…,mpkg:1}` 变成 `{scene:4,…,mpkg:0}`（那一条从"mpkg 容器档"变成按内容判的 scene）；
         · `signals.withScene` 4 / `withPreview` 6（文件条也有 scene 信号与容器内预览）。 */
    /* ①(P-261 2026-10-07) 基线跟随：库根**顶层散落的容器**现在也成一等项（`散的容器.mpkg`）⇒
       `count` 8 → **9**、`kinds.scene` 4 → **5**（该容器只有 `scene.pkg`、没有 `scene.json` ⇒ 按内容判 scene）。 */
    check('L2 逐类计数：scene 5 / video 2 / web 1 / mpkg 0 / unknown 1（fixture 9 项 = 7 目录条 + 2 文件条；`.mpkg` 逐文件成项 + 顶层散落容器也成条）',
      J(lib4).count === 9 && JSON.stringify(J(lib4).scan.kinds) === JSON.stringify({ scene: 5, video: 2, web: 1, mpkg: 0, unknown: 1 }),
      `count=${J(lib4).count} kinds=${JSON.stringify(J(lib4).scan.kinds)} items=${items4.map((i) => i.itemId + ':' + i.kind).join(',')}`)
    check('L3 容器内类型单独计数（containerKinds.scene=2：`mpkg-scene/` 里那个 + 顶层散落那个）+ 信号聚合（逐项计数）',
      J(lib4).scan.containerKinds.scene === 2 && J(lib4).scan.signals.withScene === 5 && J(lib4).scan.signals.withHtml === 1 && J(lib4).scan.signals.withVideo === 2 && J(lib4).scan.signals.withMpkg === 2 && J(lib4).scan.signals.withPreview === 7,
      JSON.stringify({ containerKinds: J(lib4).scan.containerKinds, signals: J(lib4).scan.signals }))
    check('L4 网页档（**没有 project.json**）：kind=web / kindSource=content / entryFile=index.html / renderable=true',
      !!it('web-noproj') && it('web-noproj').kind === 'web' && it('web-noproj').kindSource === 'content' && it('web-noproj').entryFile === 'index.html' &&
      it('web-noproj').renderable === true && it('web-noproj').hasHtml === true && it('web-noproj').type === 'web' && it('web-noproj').hasProject === false,
      JSON.stringify(it('web-noproj') && { kind: it('web-noproj').kind, src: it('web-noproj').kindSource, entry: it('web-noproj').entryFile, type: it('web-noproj').type }))
    check('L5 视频档：无声明（video-noproj）与有声明（video-declared）都判成 video；entryFile 指向真正的 mp4',
      !!it('video-noproj') && it('video-noproj').kind === 'video' && it('video-noproj').entryFile === 'clip.mp4' && it('video-noproj').hasVideo === true &&
      !!it('video-declared') && it('video-declared').kind === 'video' && it('video-declared').preview === 'preview.jpg' && it('video-declared').file === 'movie.mp4',
      JSON.stringify(items4.filter((i) => i.kind === 'video').map((i) => ({ id: i.itemId, entry: i.entryFile, kindSource: i.kindSource }))))
    /* ③(2026-09-24) 旧判据认的是"目录那一条"（`itemId=mpkg-scene`、`kind=mpkg`、`type=mpkg`）。
       现在 `.mpkg` 是**一等库项**：条目 id 是**嵌套路径** `mpkg-scene/夹具容器_01.mpkg`，类型按
       **容器内条目**判定（这里只有 `scene.pkg`、没有 `scene.json` ⇒ `kind/type=scene`，但
       `renderable=false` + 理由），`file` = 文件名本身 —— 断言**更严**（多了 itemId 形态 / itemRole /
       容器内容派生 type / 不可渲染的理由），并把"目录条不再重复产出"这条口径也钉住。 */
    const cItem = it('mpkg-scene/' + fx.containerName)
    check('L6 mpkg 档（一等项）：itemId=嵌套路径 + itemRole=file + 容器内类型派生 type/kind=scene + 容器内 preview + 只有 scene.pkg ⇒ renderable=false',
      !!cItem && cItem.itemRole === 'file' && cItem.container === true && cItem.kind === 'scene' && cItem.type === 'scene' &&
      cItem.containerKind === 'scene' && cItem.containerEntry === 'scene.pkg' && !!cItem.containerPreview && cItem.containerPreview.entry === 'preview.gif' &&
      cItem.renderable === false && /scene\.json/.test(String(cItem.renderReason)) && cItem.file === fx.containerName &&
      cItem.title === '夹具容器场景' && cItem.thumbUrl === '/api/thumb?item=' + encodeURIComponent('mpkg-scene/' + fx.containerName),
      JSON.stringify(cItem && { id: cItem.itemId, role: cItem.itemRole, kind: cItem.kind, type: cItem.type, ck: cItem.containerKind, ce: cItem.containerEntry, cp: cItem.containerPreview, renderable: cItem.renderable, thumb: cItem.thumbUrl }))
    check('L6b 逐文件成项的口径可核对：`mpkg-scene` 不再产出"目录那一条"，且 `fileItems + dirItems === count`（不重复计数）',
      !it('mpkg-scene') && J(lib4).scan.itemRoles && J(lib4).scan.itemRoles.fileItems === 2 &&
      (J(lib4).scan.itemRoles.fileItems + J(lib4).scan.itemRoles.dirItems) === J(lib4).count,
      JSON.stringify({ dirItem: !!it('mpkg-scene'), roles: J(lib4).scan.itemRoles, count: J(lib4).count }))
    check('L7 非 ASCII 目录名（中文收藏夹）照常成条目并可渲染（itemId 国际口径，不再被静默丢掉）',
      !!it('流萤') && it('流萤').kind === 'scene' && it('流萤').hasScene === true && it('流萤').renderable === true && it('流萤').type === 'scene',
      JSON.stringify(it('流萤') && { id: it('流萤').itemId, kind: it('流萤').kind, scene: it('流萤').scenePkg }))
    /* ①(P-261 2026-10-07) **语义反转（有意）**：顶层散落的 `.mpkg` 过去"只计数、不进列表"，
       真机表现就是用户报的"扫描不到 MPKG 文件"（库根顶层 6 个 `.mpkg` ⇒ `items=0`）⇒ 现在**既进条目列表、
       又保留原有计数**（`looseFiles`/`looseMpkgFiles` 仍是"顶层散文件"的全量读数，诊断面不缩水）。 */
    check('L8 顶层散落的 .mpkg：**既成一等项**（`itemId` = 文件名、`itemRole=file`），又保留 `scan.looseFiles/looseMpkgFiles` 计数',
      !!it(fx.looseName) && it(fx.looseName).itemRole === 'file' && it(fx.looseName).dir === '' && it(fx.looseName).kind === 'scene' &&
      J(lib4).scan.looseFiles === 1 && ((J(lib4).scan.looseMpkgFiles) || []).includes(fx.looseName) && /目录型/.test(String(J(lib4).scan.looseFileNote)),
      JSON.stringify({ item: it(fx.looseName) && { id: it(fx.looseName).itemId, role: it(fx.looseName).itemRole, dir: it(fx.looseName).dir, kind: it(fx.looseName).kind }, looseFiles: J(lib4).scan.looseFiles }))
    check('L9 unknown 条目带"下一层像不像壁纸"的提示（probe.subdirsWithSignals）—— 回答"为什么这层扫不出来"',
      !!it('empty-dir') && it('empty-dir').kind === 'unknown' && it('empty-dir').probe && it('empty-dir').probe.subdirs === 1 && it('empty-dir').probe.subdirsWithSignals === 1,
      JSON.stringify(it('empty-dir') && { kind: it('empty-dir').kind, probe: it('empty-dir').probe }))
    const skippedNames = ((J(lib4).scan.skippedList) || []).map((s) => s.name)
    check('L10 逃逸符号链接条目进 scan.skippedList（带理由），不是静默消失',
      J(lib4).scan.skipped >= 1 && skippedNames.includes('evil-link') && /越出|符号链接/.test(JSON.stringify(J(lib4).scan.skippedList)),
      JSON.stringify(J(lib4).scan.skippedList))
    const mpkgR = await request(P4, 'GET', `/api/mpkg?item=mpkg-scene&file=${encodeURIComponent(fx.containerName)}`)
    check('L11 GET /api/mpkg ⇒ 只读容器目录表（magic/条目/内层类型/容器内 project.json）',
      mpkgR.status === 200 && J(mpkgR).tableOk === true && J(mpkgR).magic === 'PKGM0018' && J(mpkgR).kind === 'scene' &&
      ((J(mpkgR).entryNames) || []).includes('scene.pkg') && J(mpkgR).declared && J(mpkgR).declared.title === '夹具容器场景' && J(mpkgR).readOnly === true,
      `${mpkgR.status} ${mpkgR.body.slice(0, 220)}`)
    const mpkgEsc = await request(P4, 'GET', '/api/mpkg?item=mpkg-scene&file=' + encodeURIComponent('../../secret.txt'))
    const mpkgMiss = await request(P4, 'GET', `/api/mpkg?item=mpkg-scene&file=${encodeURIComponent('nope.mpkg')}`)
    check('L12 /api/mpkg：容器名带路径 ⇒ 400；不存在的容器 ⇒ 404', mpkgEsc.status === 400 && mpkgMiss.status === 404, `${mpkgEsc.status}/${mpkgMiss.status}`)
    const thWeb = await request(P4, 'GET', '/api/thumb?item=web-noproj')
    check('L13 缩略图（web 档）：库里现成 preview.gif 直出 + X-Bench-Thumb 说明来源',
      thWeb.status === 200 && /image\/gif/.test(String(thWeb.headers['content-type'])) && String(thWeb.headers['x-bench-thumb']).length > 0 && thWeb.buf.length > 0,
      `${thWeb.status} ${thWeb.headers['content-type']} ${thWeb.headers['x-bench-thumb']} ${thWeb.buf.length}B`)
    const thMpkg = await request(P4, 'GET', '/api/thumb?item=mpkg-scene')
    check('L14 缩略图（mpkg 档）：容器内**未压缩** preview.gif 直出（不解包也能出图；来源写在响应头）',
      thMpkg.status === 200 && /image\/gif/.test(String(thMpkg.headers['content-type'])) && thMpkg.headers['x-bench-thumb'] === 'container-preview' &&
      decodeURIComponent(String(thMpkg.headers['x-bench-entry'] || '')) === 'preview.gif' && thMpkg.buf.toString('latin1', 0, 6) === 'GIF89a',
      `${thMpkg.status} ${thMpkg.headers['content-type']} ${thMpkg.headers['x-bench-thumb']} ${thMpkg.headers['x-bench-entry']}`)
    const thVideo = await request(P4, 'GET', '/api/thumb?item=video-declared')
    check('L15 缩略图（mp4 档有 preview.jpg）：直出库里的预览图，不需要 ffmpeg',
      thVideo.status === 200 && /image\/jpeg/.test(String(thVideo.headers['content-type'])), `${thVideo.status} ${thVideo.headers['content-type']}`)
    if (fx.mp4Real) {
      const thFrame = await request(P4, 'GET', '/api/thumb?item=video-noproj&w=160')
      check('L15b 缩略图（mp4 档**没有** preview.*）：ffmpeg 抽一帧 ⇒ 200 image/jpeg（JPEG 魔数 FFD8）',
        thFrame.status === 200 && /image\/jpeg/.test(String(thFrame.headers['content-type'])) && thFrame.buf[0] === 0xff && thFrame.buf[1] === 0xd8,
        `${thFrame.status} ${thFrame.headers['content-type']} ${thFrame.buf.length}B`)
    } else skip('L15b 视频抽帧缩略图', '本机没有 ffmpeg（或用它造 mp4 失败）')
    const thNone = await request(P4, 'GET', '/api/thumb?item=empty-dir')
    check('L16 缩略图（既无 preview 也非视频）：**501** + unsupported + reason + hint（不假装有图）',
      thNone.status === 501 && J(thNone).unsupported === true && !!J(thNone).reason && !!J(thNone).hint, `${thNone.status} ${thNone.body.slice(0, 180)}`)
    const webEntry = await request(P4, 'GET', '/web/dev/web-noproj/index.html')
    const webAsset = await request(P4, 'GET', '/web/dev/web-noproj/assets/app.js')
    const mediaHtml = await request(P4, 'GET', '/media/dev/web-noproj/index.html')
    check('L17 web 档的清单面与入口面：/web/dev/<id>/index.html + 子资源 + /media/dev/<id>/index.html 全 200',
      webEntry.status === 200 && /text\/html/.test(String(webEntry.headers['content-type'])) && webEntry.body.includes('web no project.json') &&
      webAsset.status === 200 && /javascript/.test(String(webAsset.headers['content-type'])) && mediaHtml.status === 200,
      `${webEntry.status}/${webAsset.status}/${mediaHtml.status}`)
    const vidRange = await request(P4, 'GET', '/media/dev/video-declared/movie.mp4', { headers: { Range: 'bytes=0-3' } })
    check('L18 mp4 档走 /media/dev/**：Range ⇒ 206 + Content-Range（拖动进度/首帧必需）',
      vidRange.status === 206 && /^bytes 0-3\//.test(String(vidRange.headers['content-range'])) && vidRange.buf.length === 4,
      `${vidRange.status} ${vidRange.headers['content-range']}`)
    const intlMedia = await request(P4, 'GET', `/media/dev/${encodeURIComponent('流萤')}/preview.gif`)
    const mpkgMedia = await request(P4, 'GET', `/media/dev/mpkg-scene/${encodeURIComponent(fx.containerName)}`)
    check('L19 非 ASCII itemId 与 .mpkg 容器本体都能经 /media/dev/** 原样取到（容器字节逐字节相同）',
      intlMedia.status === 200 && intlMedia.body === 'GIF89a-liuying' && mpkgMedia.status === 200 && Buffer.compare(mpkgMedia.buf, fx.containerBuf) === 0,
      `${intlMedia.status}/${mpkgMedia.status} ${mpkgMedia.buf.length}B vs ${fx.containerBuf.length}B`)
    const delUnknown = await request(P4, 'POST', '/api/delete?confirm=1', { json: { itemId: 'empty-dir' } })
    const unknownStillThere = fs.existsSync(path.join(fx.types, 'empty-dir'))
    check('L20 安全意识：库根可被选择器指到任意目录 ⇒ 真删"没有壁纸信号"的目录需要显式 ack（409 + needsAck），默认拒绝',
      delUnknown.status === 409 && J(delUnknown).needsAck === true && unknownStillThere, `${delUnknown.status} ${delUnknown.body.slice(0, 160)}`)
    const delAck = await request(P4, 'POST', '/api/delete?confirm=1', { json: { itemId: 'empty-dir', ack: true } })
    check('L21 带 {ack:true} 才移进回收站（仍可 mv 回滚，不是永久删除）',
      delAck.status === 200 && J(delAck).dryRun === false && !fs.existsSync(path.join(fx.types, 'empty-dir')) && String(J(delAck).rollback || '').startsWith('mv '),
      `${delAck.status} ${delAck.body.slice(0, 160)}`)
    const hFf = await request(P4, 'GET', '/__health')
    check('L22 /__health 如实报告选择器契约、缩略图引擎与全类型能力（能力清单可被发现）',
      !!J(hFf).dirPicker && J(hFf).dirPicker.readOnly === true && typeof J(hFf).dirPicker.browseRoot === 'string' &&
      !!J(hFf).capabilities.fullTypeScan && !!J(hFf).capabilities.serverDirPicker && !!J(hFf).capabilities.thumbRoute &&
      !!J(hFf).libraryScan && typeof J(hFf).libraryScan.kinds === 'object',
      JSON.stringify({ picker: J(hFf).dirPicker && J(hFf).dirPicker.routes, caps: { fullTypeScan: J(hFf).capabilities.fullTypeScan, serverDirPicker: J(hFf).capabilities.serverDirPicker } }))

    // ═══ ①(用户报「3669681034 打开全黑」的配套修法) `/webloader/**` 反向代理：测试台能预览**本仓渲染器页** ═══
    //   为什么需要：`:8902` 的预览 iframe 原来只指向上游**产物页**（先解码整张图再缩放上传）——
    //   对 `3669681034` 那张 7680×4320 / 43.8MB / 5 级 mip 的贴图会黑；本仓 core 有 P-163 的"先选级再解码"。
    //   判据用**测试自带的上游**（不依赖真 :8899 在不在）：路径/查询/方法/body 逐项转发、上游挂了 ⇒ 502 + 人读说明。
    console.log('\n[K2] `/webloader/**` 渲染器页反向代理（测试自带上游，不依赖真 :8899）')
    {
      const upSrv = http.createServer((q, r) => {
        let body = ''
        q.on('data', (c) => { body += c })
        q.on('end', () => {
          r.writeHead(200, { 'content-type': 'application/json' })
          r.end(JSON.stringify({ seenPath: q.url, seenMethod: q.method, seenBody: body, seenHost: q.headers.host }))
        })
      })
      await new Promise((res) => upSrv.listen(0, '127.0.0.1', res))
      const upPort = upSrv.address().port
      const sPx = await startServer(fx, { MPW_RENDERER_8899: 'http://127.0.0.1:' + upPort })
      servers.push(sPx)
      const PX = sPx.port
      const g1 = await request(PX, 'GET', '/webloader/some/page.html?q=1&x=2')
      let j1 = {}; try { j1 = JSON.parse(g1.body) } catch { /* 断言会报 */ }
      check('K2a `GET /webloader/<path>?<query>` 逐项转发到上游（路径 + 查询都在），并带 `X-Bench-Proxy` 说明头',
        g1.status === 200 && j1.seenPath === '/some/page.html?q=1&x=2' && j1.seenMethod === 'GET' && !!g1.headers['x-bench-proxy'],
        `${g1.status} ${g1.body.slice(0, 140)} proxy=${g1.headers['x-bench-proxy']}`)
      const g2 = await request(PX, 'POST', '/webloader/api/thing', { body: 'hello-body', headers: { 'content-type': 'text/plain' } })
      let j2 = {}; try { j2 = JSON.parse(g2.body) } catch { /* 断言会报 */ }
      check('K2b `POST` 的**方法与 body** 也转发（流式，不缓冲成 GET）',
        g2.status === 200 && j2.seenMethod === 'POST' && j2.seenBody === 'hello-body', `${g2.status} ${g2.body.slice(0, 140)}`)
      const hPx = J(await request(PX, 'GET', '/__health'))
      check('K2c `/__health.rendererProxy` 自述入口/上游/用途/回退页（读的人不用翻代码）',
        !!(hPx.rendererProxy && hPx.rendererProxy.path === '/webloader/**' && /127\.0\.0\.1/.test(String(hPx.rendererProxy.upstream)) && hPx.rendererProxy.fallback),
        JSON.stringify(hPx.rendererProxy).slice(0, 180))
      await new Promise((res) => upSrv.close(res))
      const g3 = await request(PX, 'GET', '/webloader/anything')
      let j3 = {}; try { j3 = JSON.parse(g3.body) } catch { /* 断言会报 */ }
      check('K2d 上游不可达 ⇒ **502 + {upstream,hint,fallback}**（不挂住、不 500、不假成功）',
        g3.status === 502 && j3.ok === false && !!j3.upstream && !!j3.hint && !!j3.fallback, `${g3.status} ${g3.body.slice(0, 160)}`)
    }

    // ═══ ①(2026-09-19) 上报落盘：测试台「立即上报」按 /report → /baseline → /diag 依次试，而 :8902 原本
    //   只有 /diag（内存环形缓冲）⇒ 按钮的日志永远是"上报失败 → 只能进 /diag 环形缓冲"，点完什么都不剩。
    //   这一节把两条落盘路由钉住：形状、落点、**校验不过不落盘**、**超限回 413**、以及滚动上限。
    console.log('\n[M] 上报落盘：POST /report（现场快照）+ POST /baseline（趋势快照，复用 baseline-metrics 校验）')
    const REPORTS = path.join(fx.ws, 'reports')
    const minimalSnap = (over) => Object.assign({
      kind: 'baseline', schema: 1, at: new Date().toISOString(), id: 'fixture-item',
      window: { frames: 120 }, frames: { n: 120 },
      fps: { windowMs: 500, median: 60 }, startup: { totalMs: 321 },
      counts: { layers: 7 }, vramProxy: { textureBytesEst: 1024 },
    }, over || {})
    const repBody = JSON.stringify({ kind: 'bench-debug-report', ts: 1789000000000, diag: ['line-a', 'line-b'] })
    const rep = await request(P, 'POST', '/report', { body: repBody, headers: { 'Content-Type': 'application/json' } })
    const repFile = path.join(REPORTS, String(J(rep).file || 'missing'))
    check('M1 POST /report ⇒ 200 {ok,file:"r<ts>.json",bytes} 且**内容逐字落盘**到 <reports>/r<ts>.json',
      rep.status === 200 && J(rep).ok === true && /^r\d+\.json$/.test(String(J(rep).file)) && J(rep).bytes === repBody.length &&
      fs.existsSync(repFile) && fs.readFileSync(repFile, 'utf8') === repBody,
      `${rep.status} ${rep.body.slice(0, 140)} exists=${fs.existsSync(repFile)}`)
    const repGet = await request(P, 'GET', '/report')
    check('M2 GET /report ⇒ 405 + allow:POST + error/hint（不是 404，也不是 500）',
      repGet.status === 405 && String(repGet.headers.allow || '').includes('POST') && !!J(repGet).error && !!J(repGet).hint,
      `${repGet.status} ${repGet.body.slice(0, 140)}`)
    const repBig = await request(P, 'POST', '/report', { body: 'x'.repeat(4 * 1024 * 1024 + 4096), headers: { 'Content-Type': 'application/json' } })
    const repAlive = await request(P, 'GET', '/__health')
    check('M3 POST /report 超限（>4MB）⇒ **413 + JSON 说明**、不落盘、服务仍活着（旧实现先 req.destroy() ⇒ 客户端只看到 ECONNRESET）',
      repBig.status === 413 && J(repBig).ok === false && /上限/.test(String(J(repBig).error)) &&
      fs.readdirSync(REPORTS).filter((n) => /^r\d+\.json$/.test(n)).length === 1 && repAlive.status === 200,
      `${repBig.status} ${repBig.body.slice(0, 120)} files=${fs.readdirSync(REPORTS).filter((n) => /^r\d+\.json$/.test(n)).length} health=${repAlive.status}`)
    const blDir = path.join(REPORTS, 'baselines')
    const blBad = await request(P, 'POST', '/baseline', { json: { kind: 'bench-debug-report', ts: 1 } })
    check('M4 POST /baseline 字段不全 ⇒ 400 + errors[] + **不落盘**（趋势目录里只留干净数据，缺字段不许当 0 比）',
      blBad.status === 400 && Array.isArray(J(blBad).errors) && J(blBad).errors.length > 0 && !fs.existsSync(blDir),
      `${blBad.status} ${blBad.body.slice(0, 160)} dirExists=${fs.existsSync(blDir)}`)
    const blBody = JSON.stringify(minimalSnap())
    const bl = await request(P, 'POST', '/baseline', { body: blBody, headers: { 'Content-Type': 'application/json' } })
    const blFile = path.join(REPORTS, String(J(bl).file || 'missing'))
    check('M5 POST /baseline 合法快照 ⇒ 200 {schema:1,file:"baselines/<ts>.json",bytes} 且内容逐字落盘',
      bl.status === 200 && J(bl).schema === 1 && /^baselines\/\d+(-\d+)?\.json$/.test(String(J(bl).file)) && J(bl).bytes === blBody.length &&
      fs.existsSync(blFile) && fs.readFileSync(blFile, 'utf8') === blBody,
      `${bl.status} ${bl.body.slice(0, 160)}`)
    const blGet = await request(P, 'GET', '/baseline')
    check('M6 GET /baseline ⇒ 405（只收 POST）', blGet.status === 405 && !!J(blGet).error, `${blGet.status} ${blGet.body.slice(0, 120)}`)
    const hRep = J(await request(P, 'GET', '/__health'))
    check('M7 /__health.report 自述三条路由 + 落点 + 上限（默认 60 份 / 64MB，与 :8899 同值）；capabilities.debugReport/baselineSnapshot 都是 true',
      hRep.report && JSON.stringify(hRep.report.routes) === JSON.stringify(['POST /report', 'POST /baseline', 'POST /diag']) &&
      hRep.report.dir === REPORTS && hRep.report.baseline.schema === 1 &&
      hRep.report.report.maxFiles === 60 && hRep.report.report.maxBytes === 64 * 1024 * 1024 &&
      hRep.report.baseline.maxFiles === 200 && hRep.report.baseline.maxBytes === 32 * 1024 * 1024 &&
      hRep.capabilities.debugReport === true && hRep.capabilities.baselineSnapshot === true,
      JSON.stringify(hRep.report && { routes: hRep.report.routes, dir: hRep.report.dir, report: hRep.report.report, baseline: hRep.report.baseline, caps: [hRep.capabilities.debugReport, hRep.capabilities.baselineSnapshot] }))
    // 上限要**压小**才好在秒级验完滚动：起一个专用实例（上限 3 份 / 100KB），并把"别条线的产物"当诱饵放进去
    {
      fs.writeFileSync(path.join(REPORTS, 'parity-keepme.json'), '{"keep":1}')      // 别条线的产物（对账门禁要读）
      fs.writeFileSync(path.join(REPORTS, 'notes.md'), '# keep')                    // 非白名单文件
      const sLim = await startServer(fx, { MPW_LIMIT_REPORTS_MAX: '3', MPW_LIMIT_REPORTS_BYTES: '100000', MPW_LIMIT_BASELINE_MAX: '2' })
      servers.push(sLim)
      const PL = sLim.port
      for (let i = 0; i < 9; i++) await request(PL, 'POST', '/report', { body: JSON.stringify({ i, pad: 'z'.repeat(20000) }) })
      const rFiles = fs.readdirSync(REPORTS).filter((n) => /^r\d+\.json$/.test(n))
      const rBytes = rFiles.reduce((s, n) => s + fs.statSync(path.join(REPORTS, n)).size, 0)
      check('M8 滚动上限（数量 3 份 / 100KB，同实例共发 9 份 ×20KB）⇒ 份数与总字节都回到限内（最旧先删）',
        rFiles.length <= 3 && rBytes <= 100000, `n=${rFiles.length} bytes=${rBytes} (${rFiles.sort().join(',')})`)
      check('M9 白名单化清理：`parity-keepme.json`（别条线产物）与 `notes.md` 在滚动后**原封不动**',
        fs.existsSync(path.join(REPORTS, 'parity-keepme.json')) && fs.existsSync(path.join(REPORTS, 'notes.md')))
      for (let i = 0; i < 5; i++) await request(PL, 'POST', '/baseline', { body: JSON.stringify(minimalSnap({ id: 'fixture-' + i })) })
      // ⚠ 目录可能**根本不存在**（例如"上报路由被拿掉"的变异体）：这里必须容忍 ⇒ 断言失败，而不是让套件崩掉
      //   （变异要求的是"这条判据变红"，不是"子进程抛 ENOENT"——崩了就没法核对红在哪一条）。
      const listIfAny = (d) => { try { return fs.readdirSync(d) } catch { return [] } }
      const blNames = listIfAny(blDir).filter((n) => /^\d+(-\d+)?\.json$/.test(n))
      check('M10 baselines/ 的滚动与 reports/ 顶层**各管各的**（上限 2 份）：只数 baselines/，顶层 r*.json 不受影响',
        blNames.length <= 2 && fs.readdirSync(REPORTS).filter((n) => /^r\d+\.json$/.test(n)).length <= 3,
        `baselines=${blNames.length} top=${fs.readdirSync(REPORTS).filter((n) => /^r\d+\.json$/.test(n)).length}`)
      const hLim = J(await request(PL, 'GET', '/__health'))
      check('M11 上限可用 `MPW_LIMIT_*` 现场调参（与 :8899 同名同义），且非法值回落默认（绝不出现"配错=关掉上限"）',
        hLim.report.report.maxFiles === 3 && hLim.report.baseline.maxFiles === 2 && hLim.limits.reportMaxFiles === 3,
        JSON.stringify({ report: hLim.report.report.maxFiles, baseline: hLim.report.baseline.maxFiles }))
    }
    return { fx }
  } finally {
    for (const s of servers) await s.stop()
    try { fs.rmSync(fx.base, { recursive: true, force: true }) } catch { /* tmp 清不掉不致命 */ }
  }
}

// ── 变异（在 /tmp 的**真文件副本**上做；真树 sha256 跑前跑后必须相同）────────────────────────────────
const MUTATIONS = [
  {
    name: 'A-去掉路径校验（`isInside()` 恒真 + itemId 单段正则放开 ⇒ 词法/真身两道守卫一起失效）',
    expects: ['F5', 'F6', 'G1', 'G3', 'G6'],
    apply(src) {
      const reps = [
        // 唯一的路径判据：让它恒真 ⇒ safeJoin / 每个端点的 realpath 复核 / 静态根白名单同时失效
        ['function isInside(root, p) {\n  const rel = path.relative(root, p)', 'function isInside(root, p) {\n  if (root || p) return true\n  const rel = path.relative(root, p)'],
        ['const ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/', 'const ITEM_ID_RE = /^[\\s\\S]*$/'],
      ]
      let out = src
      for (const [from, to] of reps) {
        if (out.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from.slice(0, 60)}…` }
        out = out.replace(from, to)
      }
      return { out }
    },
  },
  {
    name: 'B-让 dryRun 真删（`if (!confirm)` 变成 `if (false)` ⇒ 默认就移文件）',
    expects: ['F2'],
    apply(src) {
      const from = '    if (!confirm) {'
      const to = '    if (false) {'
      if (src.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from}` }
      return { out: src.replace(from, to) }
    },
  },
  {
    name: 'C-目录选择器去掉浏览边界（`containingBrowseRoot()` 恒真 ⇒ 绝对越界/符号链接逃逸全部放行；`..` 仍被独立拒绝）',
    expects: ['J5', 'J6', 'J7', 'J8', 'J11'],
    apply(src) {
      /* ②(2026-09-24) 锚点跟着实现走：浏览边界从"单个 PICK_ROOT_REAL"改成**推导出来的允许根清单**
         （`BROWSE_ROOTS`：MPW_PICK_ROOT → 库根/库根的上一级 → MPW_ALLOW_DIRS），`containingBrowseRoot()`
         里那句前缀判定随之变形。变异语义不变：**让边界判定恒真** ⇒ 越界/逃逸必须全线变红。 */
      const from = "  for (const r of BROWSE_ROOTS) if (isInside(r, real)) return { label: 'browseRoot', path: r }"
      const to = "  return { label: 'browseRoot', path: BROWSE_ROOTS[0], real }   // 变异：浏览边界恒真\n" + from
      if (src.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from}` }
      return { out: src.replace(from, to) }
    },
  },
  {
    name: 'D-库来源永远报"用户已选"（`source` 恒为 user + selected 恒真 ⇒ 未选择却假装已选）',
    expects: ['K1', 'K2', 'K3'],
    apply(src) {
      const from = "  const baseSource = selection ? 'user' : LIBRARY_SOURCE_INFO.source"
      const to = "  const baseSource = 'user'; selection = selection || { dir: activeRoot, at: Date.now(), mode: 'mutant' }"
      if (src.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from}` }
      return { out: src.replace(from, to) }
    },
  },
  {
    name: 'E-类型判定退回"只认 scene"（内容信号优先那条早退恒真 ⇒ web/video/mpkg 全被标成 scene）',
    expects: ['L2', 'L4', 'L5', 'L6'],
    apply(src) {
      const from = "  if (sig.scene) return { kind: 'scene', kindSource: 'content', reason: 'scene-container' }"
      const to = "  if (sig.scene || true) return { kind: 'scene', kindSource: 'content', reason: 'scene-container' }"
      if (src.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from}` }
      return { out: src.replace(from, to) }
    },
  },
  {
    name: 'F-上报落盘路由整段消失（`/report` 与 `/baseline` 两行删掉 ⇒ 回到"点完什么也没留下"，只剩 /diag 环形缓冲）',
    expects: ['M1', 'M5'],
    apply(src) {
      const from = "  if (p === '/report') return done(() => handleReport(req, res))\n  if (p === '/baseline') return done(() => handleBaseline(req, res))\n"
      const to = "  // 变异：上报落盘路由整段消失\n"
      if (src.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from.split('\n')[0]}` }
      return { out: src.replace(from, to) }
    },
  },
  {
    name: 'G-基线校验放行（`mpwValidateSnapshot` 恒 ok ⇒ 残缺快照也落盘，趋势数据里混进"缺字段当 0"的假结论）',
    expects: ['M4'],
    apply(src) {
      const from = "    if (!v.ok) {"
      const to = "    if (!v.ok && false) {"
      if (src.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from}` }
      return { out: src.replace(from, to) }
    },
  },
  {
    name: 'H-快捷根契约破坏（`path` 变相对 + `exists` 恒真 + 标签抄绝对路径 ⇒ J13 契约判据必须红）',
    expects: ['J13'],
    apply(src) {
      const from = "    const row = Object.assign({}, c, {\n      path: p, labels: [c.label], exists, listable: inside && exists,"
      const to = "    const row = Object.assign({}, c, {\n      path: path.relative(BROWSE_ROOTS[0], p) || p, labels: [p], exists: true, listable: inside && exists,   // 变异：相对路径 + exists 恒真 + 标签抄绝对路径"
      if (src.split(from).length !== 2) return { error: `变异锚点未命中唯一位置：${from.split('\n')[1]}` }
      return { out: src.replace(from, to) }
    },
  },
  {
    /* ①(PA-37) **分辨力证明**（与上面几条相反：这条要求"仍然绿"）：旧 J13 把实现里那 3 条候选
       （`fx.ws` / `fx.ws/allwallpaper` / `os.homedir()`）逐字钉死 ⇒ 谁把"作者式快捷根"删掉/参数化，
       门禁就红 ⇒ 门禁在保护缺陷。改成语义契约后，删掉那两条**属于"这台机器的事实"的候选**
       （`MPW_ROOT` 工作区根、`process.cwd()`）**必须仍然绿**：契约只要求
       "含当前库根 + **它的上一级** + os.homedir()" —— 库根本身与"它的上一级"都从库根推导得出
       （`<repo>/samples` 与配置库根那两条仍在），与"作者工作区叫什么"无关。
       ⚠ 不要拿"库根的上一级"那条来变异：契约**明确要求**它存在，删了本来就该红（那是契约不是缺陷）。 */
    name: 'J2 删掉"这台机器的事实"式快捷根（MPW_ROOT 工作区根 + process.cwd()）⇒ J13 **必须仍然绿**（判据不得保护缺陷）',
    expects: [],
    mustStayGreen: ['J13'],
    apply(src) {
      const cut = (s, frag) => {
        const i = s.indexOf(frag)
        if (i < 0) return null
        const lineEnd = s.indexOf('\n', i)
        return s.slice(0, i) + s.slice(lineEnd + 1)
      }
      let out = src
      for (const frag of [
        "{ label: '工作区根（' + path.basename(MPW_ROOT) + '）', path: MPW_ROOT, kind: 'workspace', role: 'workspace' },",
        "{ label: '当前工作目录（' + path.basename(process.cwd()) + '）', path: process.cwd(), kind: 'cwd', role: 'cwd' },",
      ]) {
        const next = cut(out, frag)
        if (next === null) return { error: `变异锚点未命中：${frag.slice(0, 50)}` }
        out = next
      }
      return { out }
    },
  },
]

function runChild(serverPath, args, ms) {
  return new Promise((resolve) => {
    /*  ⚠(2026-09-25) `detached: true` + 超时杀**整组**：子套件自己会 `startServer()` spawn 被测服务，
        只杀子进程会把孙进程遗弃（实测两次跑完留下 `mutant-7.mjs` 服务进程：ppid=1、抱着端口与内存）。
        同一个进程组一次收干净（正常退出仍走子套件自己的 `stop()`）。 */
    const child = spawn(process.execPath, [HERE_TEST, `--server=${serverPath}`, '--json', '--no-mutant', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let out = ''
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', (c) => { out += c.toString() })
    const killGroup = (sig) => { try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* 已退 */ } } }
    const t = setTimeout(() => killGroup('SIGKILL'), ms || 120000)
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out }) })
  })
}
function parseChildJson(out) {
  const line = out.split('\n').filter((l) => l.startsWith('BENCH-SERVER-TEST-JSON ')).pop()
  if (!line) return null
  try { return JSON.parse(line.slice('BENCH-SERVER-TEST-JSON '.length)) } catch { return null }
}

async function main() {
  console.log(`被测服务：${SERVER_UNDER_TEST}`)
  console.log(`真树指纹（跑前）：${treeFingerprint().hash.slice(0, 24)}…（${treeFingerprint().files} 个条目）`)
  const before = treeFingerprint()

  console.log('\n═══ 主套件（干净服务）═══')
  await runSuite()
  const fails = failures()

  let mutantReport = null
  if (!NO_MUTANT) {
    console.log('\n═══ 变异 RED（副本在 /tmp；真树不许变）═══')
    const mtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-8902-mut-'))
    const src = fs.readFileSync(SERVER_REAL, 'utf8')
    const rows = []
    for (let i = 0; i < MUTATIONS.length; i++) {
      const m = MUTATIONS[i]
      const r = m.apply(src)
      if (r.error) { check(`变异${i + 1} 可施加（锚点唯一）`, false, r.error); continue }
      const p = path.join(mtDir, `mutant-${i + 1}.mjs`)
      /* ⚠ 变异副本在 /tmp ⇒ **相对 import 会断**（`../core/baseline-metrics.mjs` 解析成 /core/…、
         `./upload-policy.mjs` 解析成 /upload-policy.mjs）—— 与被测服务的静态面要显式给
         `MPW_BENCH_STATIC_DIR` 是同一个道理（副本靠自身位置推不出仓库根）。
         口径：**把相对 import 全部改写成指向真树的绝对路径**（只影响副本，真树一字不动）。
         历史：这条夹具已经因为"新增相对 import 忘了同步"红过两次（`../core/baseline-metrics.mjs`、
         本轮 `./upload-policy.mjs`）⇒ 现在用正则**一次覆盖所有相对说明符**，不再逐个手写。 */
      const srcPatched = r.out.replace(
        /from '(\.\.?\/[^']+)'/g,
        (m0, rel) => `from ${JSON.stringify(path.resolve(path.dirname(SERVER_REAL), rel))}`)
      fs.writeFileSync(p, srcPatched)
      const res = await runChild(p, [])
      const j = parseChildJson(res.out)
      const redLines = res.out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 6)
      const redNames = ((j && j.failed) || []).map((f) => f.name)
      const expectHit = m.expects.filter((e) => redNames.some((n) => n.startsWith(e)))
      console.log(`\n─── 变异 ${i + 1}：${m.name}`)
      console.log(`    子进程退出码 = ${res.code}（要求 ${m.mustStayGreen ? 0 : 1}）`)
      console.log(`    RED 行（原文）：\n${redLines.map((l) => '      ' + l).join('\n') || '      (无 FAIL 行)'}`)
      if (m.mustStayGreen) {
        /* ①(PA-37) "必须仍然绿"的变异：判据不许保护缺陷 —— 被点名的判据**不得**出现在红集里，
           而且整轮不许有**别的**失败（否则说明这次变异把它处判据也带红了，分辨力证明不成立）。 */
        const leaked = m.mustStayGreen.filter((e) => redNames.some((n) => n.startsWith(e)))
        check(`变异${i + 1} 分辨力：把作者式写法删掉后 ${m.mustStayGreen.join('/')} **仍然绿**（判据不保护缺陷）`,
          res.code === 0 && redNames.length === 0 && leaked.length === 0,
          `code=${res.code} 该判据变红=${leaked.join(',') || '否'} 本轮红集=${redNames.join(' | ').slice(0, 200) || '（空）'}`)
      } else {
        check(`变异${i + 1} 必红：子进程退出码 1 且有 FAIL`, res.code === 1 && redLines.length > 0, `code=${res.code} fails=${(j && j.failed || []).length}`)
        check(`变异${i + 1} 红的正是被变异掉的判据（${m.expects.join('/')}）`, expectHit.length > 0, `命中=${expectHit.join(',') || '无'} 实际=${redNames.join(' | ').slice(0, 300)}`)
      }
      rows.push({ name: m.name, code: res.code, failed: redNames, redLines, mustStayGreen: m.mustStayGreen || null })
    }
    mutantReport = rows
    try { fs.rmSync(mtDir, { recursive: true, force: true }) } catch { /* tmp 清不掉不致命 */ }
  }

  const after = treeFingerprint()
  /* ⚠ 这条判据的**已知环境假红**：指纹覆盖 `demo/**`（静态面），而本仓允许**多条工作线并行**——
     别的线在跑本套件期间改 `demo/index.html` 之类的文件，指纹当然会变（实测：与 `:8902` 外壳线并行时红过一次）。
     它抓的是"**本套件的变异写进了真树**"这一类事故；并行编辑属于外部写，重跑即可（或等别的线收工再跑）。 */
  check('真树 sha256 跑前跑后逐字相同（变异只发生在 /tmp 副本里；与其它工作线并行时会假红，见上）',
    before.hash === after.hash, `${before.hash.slice(0, 24)} → ${after.hash.slice(0, 24)}`)

  const allFails = failures()
  const ok = allFails.length === 0
  console.log(`\n═══ 汇总 ═══`)
  console.log(`断言 ${results.length} 项：通过 ${results.length - allFails.length} / 失败 ${allFails.length} / SKIP ${skipped}`)
  for (const f of allFails) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail.slice(0, 200)}` : ''}`)
  console.log(ok ? 'BENCH-SERVER-TEST: 全绿 ✓' : 'BENCH-SERVER-TEST: 有失败 ✗')
  if (JSON_OUT) console.log('BENCH-SERVER-TEST-JSON ' + JSON.stringify({ ok, total: results.length, skipped, failed: allFails.map((f) => ({ name: f.name, detail: f.detail })), mutants: mutantReport }))
  process.exit(ok ? 0 : 1)
}

const watchdog = setTimeout(() => { console.error('BENCH-SERVER-TEST: 看门狗超时（120s）—— 本套件应当秒级完成'); process.exit(1) }, 120000)
watchdog.unref()
main().catch((e) => {
  console.error('BENCH-SERVER-TEST: 崩了\n' + (e && e.stack ? e.stack : e))
  if (JSON_OUT) console.log('BENCH-SERVER-TEST-JSON ' + JSON.stringify({ ok: false, crashed: String(e && e.message || e) }))
  process.exit(1)
})

#!/usr/bin/env node
// tools/upload-dedup-test.mjs —— P-309 上传副本**内容哈希去重**判据（RESOURCE-AUDIT #4 剩余半）
//
// 缺口：`/upload` 每次 `crypto.randomBytes(16)` 新 token（`lib/index.js:2949`），`pruneUploads()`（`:1633`）
//   只有数量+字节上限 ⇒ **重复导入同一 mpkg 占双份磁盘 + files Map 双条目**。
// 修法：接收流上**边写边算 sha256**（不整包驻留）⇒ `hash → token` 索引命中即复用旧副本；
//   回退位 `MPW_UPLOAD_DEDUP=0`（环境变量 ⇒ 不触发渲染器 README 开关表扫描面）。
//
// 断言（真 HTTP 打**真 lib/index.js 注册的**路由；夹具自合成 ≤1MB，退出即删）：
//   A 去重语义：A1 首传落一份 / A2 同内容二次传 ⇒ 同 token + deduped:true + 磁盘仍一份 + files 仍一条 /
//     A3 同大小不同内容 ⇒ 不去重 / A4 命中后 lastUsed 被刷新（保护窗） / A5 prune 上限语义不变 + 被回收者的哈希索引被清
//   B 回退位：`MPW_UPLOAD_DEDUP=0` ⇒ 逐字节回旧（两次都新 token、无 deduped、磁盘两份）
//   C 变异自证：把"命中即复用"改回"总是新 token" ⇒ A2 必红（期望红集 == 实际红集）
// 用法: node tools/upload-dedup-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const BASE = '/api/mpkg-wallpaper'
const LIB = process.env.MPW_UPLOAD_TEST_LIB || path.join(repoRoot, 'lib', 'index.js')
const CHILD = process.argv.includes('--child')

const rows = []
const ok = (id, why, cond, detail = '') => rows.push({ id, why, pass: !!cond, detail: String(detail) })

/* ── 临时目录 ─────────────────────────────────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-uploaddedup-'))
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* 忽略 */ } }
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130) })

/* ── 合成容器（与 parseMpkgHead 布局同源，同 tools/pkg-import-test.mjs） ── */
function buildContainer(version, files) {
  const vb = Buffer.from(version, 'latin1')
  const heads = []
  let off = 0
  for (const [name, data] of files) {
    const nb = Buffer.from(name, 'utf8')
    const h = Buffer.alloc(4 + nb.length + 8)
    h.writeUInt32LE(nb.length, 0); nb.copy(h, 4)
    h.writeUInt32LE(off, 4 + nb.length); h.writeUInt32LE(data.length, 4 + nb.length + 4)
    heads.push(h); off += data.length
  }
  const head = Buffer.alloc(4 + vb.length + 4)
  head.writeUInt32LE(vb.length, 0); vb.copy(head, 4); head.writeUInt32LE(files.length, 4 + vb.length)
  return Buffer.concat([head, Buffer.concat(heads), ...files.map(([, d]) => d)])
}
const SCENE = Buffer.from('{"general":{"type":"scene"}}', 'utf8')
const GIF_A = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(4096, 7)])
const GIF_B = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(4096, 9)])   // 同大小、不同内容
const contentA = buildContainer('PKGM0014', [['scene.json', SCENE], ['preview.gif', GIF_A]])
const contentB = buildContainer('PKGM0014', [['scene.json', SCENE], ['preview.gif', GIF_B]])
const contentC = buildContainer('PKGV0022', [['scene.json', SCENE]])

/* ── 起一个"真路由"世界 ──────────────────────────────────────── */
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
}
async function boot(env = {}) {
  const dshHome = fs.mkdtempSync(path.join(TMP, 'home-'))
  process.env.DSH_HOME = dshHome
  delete process.env.DSH_WE_UPLOAD_KEEP; delete process.env.DSH_WE_UPLOAD_MAX_BYTES; delete process.env.DSH_WE_UPLOAD_PROTECT_MS
  delete process.env.MPW_UPLOAD_DEDUP
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v)
  const mod = await import(pathToFileURL(LIB).href + '?t=' + Date.now() + '-' + Math.random())
  const routes = new Map()
  mod.apply({ webServer: { register: (r) => { routes.set(r.path, r); return { dispose() {} } } }, loader: null, logger: { info() {}, warn() {}, error() {} } })
  const port = await freePort()
  const server = http.createServer((req, res) => {
    let url = null
    try { url = new URL(req.url, 'http://127.0.0.1') } catch { res.writeHead(400); return res.end('bad url') }
    const r = routes.get(url.pathname)
    if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"no route"}') }
    try { Promise.resolve(r.handler(req, res, url)).catch((e) => { try { res.writeHead(500); res.end(String(e && e.message || e)) } catch { /* 已响应 */ } }) }
    catch (e) { try { res.writeHead(500); res.end(String(e && e.message || e)) } catch { /* 已响应 */ } }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const dataDir = path.join(dshHome, '.dsh-mpkg-wallpaper')
  return {
    mod, dshHome, dataDir, base: 'http://127.0.0.1:' + port,
    files: () => (mod.__mpwTest && mod.__mpwTest.uploadFiles ? mod.__mpwTest.uploadFiles() : []),
    hashes: () => (mod.__mpwTest && mod.__mpwTest.uploadHashes ? mod.__mpwTest.uploadHashes() : []),
    dedupOn: () => (mod.__mpwTest && mod.__mpwTest.uploadDedupOn ? mod.__mpwTest.uploadDedupOn() : null),
    mpkgNames: () => { try { return fs.readdirSync(dataDir).filter((n) => /\.mpkg$/.test(n)) } catch { return [] } },
    stop: () => new Promise((r) => server.close(r)),
  }
}
const post = (base, buf) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: Number(new URL(base).port), method: 'POST', path: BASE + '/upload', headers: { 'content-length': buf.length, 'content-type': 'application/octet-stream' } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c))
    res.on('end', () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw.toString('utf8')) } catch { /* 非 JSON */ } resolve({ status: res.statusCode, json }) })
  })
  req.on('error', () => resolve({ status: 0, json: null }))
  req.end(buf)
})

/* ═══════════════ A 段：去重语义（默认档；变异子进程也跑这一段 ⇒ 红集可判） ═══════════════ */
{
  const W = await boot()
  const r1 = await post(W.base, contentA)
  ok('A1', '首传：200 + 新 token + 磁盘一份', r1.status === 200 && r1.json && r1.json.token && W.mpkgNames().length === 1, `status=${r1.status} token=${r1.json && r1.json.token} disk=${W.mpkgNames().length}`)
  const T1 = (r1.json && r1.json.token) || null
  const r2 = await post(W.base, contentA)
  const sameTok = !!(r2.json && r2.json.token && r2.json.token === T1)
  ok('A2', '同内容二次传 ⇒ **同 token** + `deduped:true` + 磁盘**仍一份** + files 仍**一条**',
    r2.status === 200 && sameTok && r2.json.deduped === true && W.mpkgNames().length === 1 && W.files().length === 1,
    `status=${r2.status} token=${r2.json && r2.json.token} deduped=${r2.json && r2.json.deduped} disk=${W.mpkgNames().length} files=${W.files().length}`)
  const r3 = await post(W.base, contentB)
  const tokB = (r3.json && r3.json.token) || null
  ok('A3', '同大小**不同**内容 ⇒ 不去重（token 不同、磁盘两份）',
    r3.status === 200 && tokB && tokB !== T1 && W.mpkgNames().length === 2 && W.files().length === 2,
    `tokenB=${tokB} disk=${W.mpkgNames().length} files=${W.files().length}`)
  const recT1 = W.files().find((f) => f.token === T1) || null
  ok('A4', '去重命中后复用记录的 `lastUsed` 被刷新（保护窗不被误删）', !!(recT1 && recT1.lastUsed > 0), `lastUsed=${recT1 && recT1.lastUsed}`)
  ok('A4b', '哈希索引里 contentA 指向复用 token（且不含已丢弃的临时 token）',
    W.hashes().some(([h, t]) => t === T1) && W.hashes().length === 2, JSON.stringify(W.hashes().map(([h, t]) => t)))
  // A5：prune 上限语义不变 + 被回收者的哈希索引被清
  const W2 = await boot({ DSH_WE_UPLOAD_KEEP: '1', DSH_WE_UPLOAD_PROTECT_MS: '1' })
  await post(W2.base, contentA)
  await new Promise((r) => setTimeout(r, 10))
  await post(W2.base, contentB)              // 触发 prune：A 已过保护窗 ⇒ 应被回收
  const left = W2.mpkgNames().length
  const hashesLeft = W2.hashes().length
  ok('A5', '`pruneUploads` 数量上限语义不变（KEEP=1 ⇒ 磁盘剩 1 份）+ 被回收者的哈希索引同步清掉',
    left === 1 && hashesLeft === 1, `disk=${left} hashes=${hashesLeft}`)
  await W.stop(); await W2.stop()
}

/* ═══════════════ B 段：回退位 MPW_UPLOAD_DEDUP=0 ═══════════════ */
if (!CHILD) {
  const W0 = await boot({ MPW_UPLOAD_DEDUP: '0' })
  const a1 = await post(W0.base, contentA)
  const a2 = await post(W0.base, contentA)
  ok('B1', '`MPW_UPLOAD_DEDUP=0` ⇒ 逐字节回旧：两次**不同** token、无 `deduped:true`、磁盘两份',
    a1.status === 200 && a2.status === 200 && a1.json.token !== a2.json.token && a2.json.deduped !== true && W0.mpkgNames().length === 2,
    `t1=${a1.json && a1.json.token} t2=${a2.json && a2.json.token} deduped=${a2.json && a2.json.deduped} disk=${W0.mpkgNames().length}`)
  ok('B2', '回退档读数：`__mpwTest.uploadDedupOn()===false`（接线可核）', W0.dedupOn() === false, String(W0.dedupOn()))
  await W0.stop()
}

/* ═══════════════ C 段：变异自证（撤掉"命中即复用" ⇒ A2 必红） ═══════════════ */
if (CHILD) {
  const failed = rows.filter((r) => !r.pass).map((r) => r.id)
  console.log('MUTANT-RED:' + JSON.stringify(failed))
  process.exit(failed.length ? 1 : 0)
}
let mutOk = false, mutDetail = '未跑'
try {
  /* 变异副本必须**整目录拷贝**：`lib/index.js` 里有相对 import（`./pkg-extract.js`）⇒ 单文件拷到 tmp 会解析失败。 */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-dedup-mut-'))
  const libSrc = path.dirname(LIB)
  fs.cpSync(libSrc, path.join(dir, 'lib'), { recursive: true })
  const f = path.join(dir, 'lib', path.basename(LIB))
  const src = fs.readFileSync(f, 'utf8')
  const mutated = src.replace('if (prevOk) {', 'if (false && prevOk) {   // MUTANT')
  if (mutated === src) throw new Error('变异替换点未命中（去重实现措辞变了）')
  fs.writeFileSync(f, mutated)
  const out = (() => { try { return execFileSync(process.execPath, [path.join(here, 'upload-dedup-test.mjs'), '--child'], { env: Object.assign({}, process.env, { MPW_UPLOAD_TEST_LIB: f }), encoding: 'utf8' }) } catch (e) { return String((e && e.stdout) || '') } })()
  const m = /MUTANT-RED:(\[.*\])/.exec(out)
  const got = m ? JSON.parse(m[1]) : null
  const want = ['A2', 'A3', 'A4', 'A4b']   // 推理：撤掉复用后 ①A2 新 token/双份 ②A3 磁盘 3 份 ③A4 lastUsed=0 ④A4b 索引指向第二个 token
  mutOk = Array.isArray(got) && got.length === want.length && got.every((x, i) => x === want[i])
  mutDetail = `红集=${JSON.stringify(got)}（期望 ${JSON.stringify(want)}）`
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
} catch (e) { mutDetail = '变异自证异常: ' + String(e && e.message || e).slice(0, 160) }
ok('M1', '变异自证：撤掉"命中即复用" ⇒ 期望红集 == 实际红集', mutOk, mutDetail)
if (mutOk) console.log('    MUTANT-RED-OK M1 ' + mutDetail)

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== upload-dedup: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

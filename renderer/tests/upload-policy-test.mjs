// upload-policy-test.mjs —— ①(用户第 34 条 安全策略) 导入文件的**统一白名单 + 内容嗅探**门禁
//
// 判据（任一不满足 ⇒ 退出码 1）：
//   A **文件名**：单段、无分隔符/穿越/控制字符、必须有扩展名、长度受限（`../evil.png`、`..`、`a/b.png`、无扩展名全拒）
//   B **扩展名白名单**：脚本/可执行/归档/主动内容后缀一律拒（`.html .js .sh .exe .zip .svg …`），
//     图片/音频/视频/字体/文本收
//   C **内容嗅探（防改后缀绕过）**：PE(MZ)/ELF/Mach-O/`#!`/`<?php`/`<script>`/HTML 特征一律拒，
//     **即使扩展名是 `.png`**；扩展名与**实际内容类别**不符也拒（`.png` 里塞 FLAC）
//   D **音频格式适配**（用户第 10 条）：`.flac`/`.opus`/`.m4a`/`.aac`/`.oga` 都在白名单且 magic 能认出来，
//     MIME 正确（`audio/flac` 等），**不靠扩展名猜**（改后缀的 FLAC 会被 C 拦下）
//   E **文本类**：合法 UTF-8 才收、含 NUL/控制字符拒、体积上限比二进制更严（4MB）
//   F **接线**：`:8902` 服务端的 `/api/props-file` **真的调用** `checkUpload`（静态断言 + 真 HTTP 一条拒收用例）
//   G **分辨力自证**：把"内容与扩展名同类"这条判据去掉（副本）⇒ C 组必红
//
// 用法: node tests/upload-policy-test.mjs [--no-mutant]
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const POLICY = path.join(ROOT, 'server', 'upload-policy.mjs')
const SERVER = path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs')
const NO_MUT = process.argv.includes('--no-mutant')

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 180) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 260) + ']' : '')) }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-upload-'))
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp */ } })

const P = await import(pathToFileURL(process.env.MPW_UPLOAD_POLICY || POLICY).href)
const B = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]),
  gif: Buffer.from('GIF89a' + 'x'.repeat(20)),
  flac: Buffer.concat([Buffer.from('fLaC'), Buffer.from([0, 0, 0, 0x22]), Buffer.alloc(16)]),
  ogg: Buffer.from('OggS' + 'x'.repeat(24)),
  mp3: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(24)]),
  m4a: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(16)]),
  wav: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)]),
  mp4: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(16)]),
  webm: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]),
  woff2: Buffer.from('wOF2' + 'x'.repeat(20)),
  pe: Buffer.from('MZ\x90\x00' + 'x'.repeat(20)),
  elf: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(16)]),
  shebang: Buffer.from('#!/bin/sh\necho hi\n'),
  php: Buffer.from('<?php echo 1; ?>'),
  scriptPng: Buffer.from('<script>alert(1)</script>'),
  txt: Buffer.from('hello 世界\n'),
  nul: Buffer.from('abc\u0000def'),
}

console.log('== A 文件名（防穿越）==')
for (const [name, why] of [['../evil.png', '含分隔符'], ['a/b.png', '含 /'], ['a\\b.png', '含 \\'], ['..', '就是 ..'], ['.hidden.png', '点开头'], ['noext', '无扩展名'], ['x'.repeat(200) + '.png', '过长'], ['bad\u0001.png', '控制字符']]) {
  const r = P.checkUpload({ filename: name, buf: B.png })
  ok(!r.ok, `A 拒 ${why}：${name.slice(0, 18)}`, r.reason)
}
ok(P.checkUpload({ filename: 'good.png', buf: B.png }).ok, 'A 收正常单段文件名 `good.png`')

console.log('\n== B 扩展名白名单 ==')
for (const n of ['e.exe', 's.sh', 'p.py', 'h.html', 'j.js', 'z.zip', 'v.svg', 'd.dll', 'w.wasm']) {
  const r = P.checkUpload({ filename: n, buf: B.txt })
  ok(!r.ok, `B 拒脚本/可执行/归档/主动内容后缀：${n}`, r.reason)
}
console.log('\n== C 内容嗅探（改后缀不能绕过）==')
ok(!P.checkUpload({ filename: 'evil.png', buf: B.pe }).ok, 'C PE(`MZ`) 改名 `.png` 也拒', P.checkUpload({ filename: 'evil.png', buf: B.pe }).reason)
ok(!P.checkUpload({ filename: 'evil.png', buf: B.elf }).ok, 'C ELF 改名 `.png` 也拒')
ok(!P.checkUpload({ filename: 'evil.png', buf: B.shebang }).ok, 'C `#!` 脚本改名 `.png` 也拒')
ok(!P.checkUpload({ filename: 'evil.png', buf: B.php }).ok, 'C `<?php` 改名 `.png` 也拒')
ok(!P.checkUpload({ filename: 'evil.png', buf: B.scriptPng }).ok, 'C `<script>` 改名 `.png` 也拒')
ok(!P.checkUpload({ filename: 'fake.png', buf: B.flac }).ok, 'C 内容与扩展名**不同类**（FLAC 叫 `.png`）也拒', P.checkUpload({ filename: 'fake.png', buf: B.flac }).reason)
ok(!P.checkUpload({ filename: 'fake.mp3', buf: B.png }).ok, 'C 反方向（PNG 叫 `.mp3`）同样拒')

console.log('\n== D 音频格式适配（用户第 10 条）==')
for (const [n, buf, mime] of [['a.flac', B.flac, 'audio/flac'], ['b.opus', B.ogg, 'audio/opus']]) {
  // `.opus` 容器常是 Ogg 封装 ⇒ 内容类别 audio、扩展名在表里即可（MIME 按扩展名给）
  const r = P.checkUpload({ filename: n, buf })
  ok(r.ok && r.kind === 'audio' && r.mime === mime, `D ${n} ⇒ audio / ${mime}`, r.ok ? r.mime : r.reason)
}
for (const [n, buf, mime] of [['c.oga', B.ogg, 'audio/ogg'], ['d.m4a', B.m4a, 'audio/mp4'], ['e.mp3', B.mp3, 'audio/mpeg'], ['f.wav', B.wav, 'audio/wav']]) {
  const r = P.checkUpload({ filename: n, buf })
  ok(r.ok && r.mime === mime, `D ${n} ⇒ ${mime}`, r.ok ? r.mime : r.reason)
}
/* 同类之内改后缀（MP3 内容叫 `.flac`）**允许**：判据是"类别一致"而不是"具体格式一致" ——
   音频之间互换后缀不构成风险，而"跨类别"（音频内容叫 `.png`）才是要拦的。 */
ok(P.checkUpload({ filename: 'x.flac', buf: B.mp3 }).ok, 'D 同类改后缀（MP3 内容叫 `.flac`）允许 —— 判据是**类别**不是具体格式')
ok(!P.checkUpload({ filename: 'x.png', buf: B.mp3 }).ok, 'D 跨类别改后缀（MP3 内容叫 `.png`）拒')

console.log('\n== E 文本类 ==')
ok(P.checkUpload({ filename: 'n.txt', buf: B.txt }).ok, 'E 合法 UTF-8 文本收')
ok(!P.checkUpload({ filename: 'n.txt', buf: B.nul }).ok, 'E 含 NUL 的"文本"拒')
ok(P.checkUpload({ filename: 'p.json', buf: Buffer.from('{"a":1}') }).ok, 'E `.json`（模型/文本类）收')
ok(!P.checkUpload({ filename: 'big.txt', buf: Buffer.alloc(P.MAX_TEXT_BYTES + 1, 0x61) }).ok, 'E 文本类超 4MB 拒', 'MAX_TEXT_BYTES=' + P.MAX_TEXT_BYTES)
ok(!P.checkUpload({ filename: 'x.png', buf: Buffer.alloc(64) }).ok, 'E 认不出内容的一律拒（deny-by-default）')

console.log('\n== F 接线（服务端真的调用策略）==')
{
  const src = fs.readFileSync(SERVER, 'utf8')
  ok(/import \{ checkUpload \} from '\.\/upload-policy\.mjs'/.test(src) && /checkUpload\(\{ filename, buf, maxBytes: LIMITS\.propsFileBytes \}\)/.test(src),
    'F1 `server/we-scene-demo-server-8902.mjs` 的 `/api/props-file` 走 `checkUpload`（不是各写一份判断）')
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  ok((pkg.files || []).some((f) => /upload-policy\.mjs$/.test(f)), 'F2 新模块进了 `package.json.files`（否则发布包里缺文件 ⇒ 0.2.0 那类事故）')
}
/** 真 HTTP：起一个临时 8902（夹具库/reports 都在 tmp），POST 一个 `.html`（拒）与一个 `.png`（收）。 */
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
{
  const fx = path.join(tmp, 'ws'); const dd = path.join(fx, 'allwallpaper', 'dd')
  fs.mkdirSync(path.join(dd, 'w1'), { recursive: true })
  fs.writeFileSync(path.join(dd, 'w1', 'project.json'), JSON.stringify({ type: 'Scene', title: 'fx', file: 'scene.json' }))
  fs.writeFileSync(path.join(dd, 'w1', 'scene.pkg'), 'PKGV0001fixture')
  const port = await freePort()
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, PORT: String(port), MPW_ROOT: fx, MPW_LIBRARY_DIR: dd, MPW_REPORTS_DIR: path.join(fx, 'reports'), MPW_BENCH_STATIC_DIR: path.join(ROOT, 'demo') }, stdio: ['ignore', 'pipe', 'pipe'] })
  const post = (p, body, headers) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: Object.assign({ 'content-length': body.length }, headers || {}) }, (res) => {
      const cs = []; res.on('data', (c) => cs.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString('utf8') }))
    })
    r.on('error', (e) => resolve({ status: 0, body: String(e && e.code) })); r.write(body); r.end()
  })
  try {
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) { try { await fetch('http://127.0.0.1:' + port + '/__health', { signal: AbortSignal.timeout(600) }); ready = true } catch { await new Promise((r) => setTimeout(r, 120)) } }
    ok(ready, 'F3 临时 8902 服务已就绪（夹具库在 tmp，不碰真语料）')
    const bad = await post('/api/props-file?item=w1&name=tex', Buffer.from('<html><script>x</script>'), { 'x-filename': 'evil.html' })
    ok(bad.status === 415 && /拒收|白名单/.test(bad.body), 'F4 真 HTTP：`.html` 导入 ⇒ **415 + 人读原因**', bad.status + ' ' + bad.body.slice(0, 120))
    const bad2 = await post('/api/props-file?item=w1&name=tex', B.pe, { 'x-filename': 'evil.png' })
    ok(bad2.status === 415 && /可执行/.test(bad2.body), 'F5 真 HTTP：PE 改名 `.png` ⇒ 415', bad2.status + ' ' + bad2.body.slice(0, 120))
    const good = await post('/api/props-file?item=w1&name=tex', B.png, { 'x-filename': 'ok.png' })
    ok(good.status === 200 && /"ok":\s*true/.test(good.body), 'F6 真 HTTP：正常 `.png` ⇒ 200（策略不挡正常导入）', good.status + ' ' + good.body.slice(0, 100))
  } finally { try { child.kill('SIGKILL') } catch { /* 已退 */ } }
}

console.log('\n== G 分辨力自证（变异只落 mkdtemp）==')
if (!NO_MUT) {
  const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const before = sha(POLICY)
  const src = fs.readFileSync(POLICY, 'utf8')
  const from = "  if (!kindOk) return { ok: false, reason: `内容与扩展名不符"
  const i = src.indexOf(from)
  if (i < 0) ok(false, 'G0 变异锚点存在', '没找到"内容与扩展名不符"那段')
  else {
    const mutated = src.replace("const kindOk = magicKind === extKind", "const kindOk = true")
    const copy = path.join(tmp, 'upload-policy-mut.mjs')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [process.argv[1], '--no-mutant'], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, MPW_UPLOAD_POLICY: copy } })
    const out = (r.stdout || '') + (r.stderr || '')
    ok(/✗ C /.test(out), 'G1 去掉"内容与扩展名同类"这条 ⇒ **C 组必红**（判据有分辨力）', 'exit=' + r.status)
  }
  ok(sha(POLICY) === before, 'G2 真树 sha256 跑前跑后一致（变异没碰真文件）', sha(POLICY).slice(0, 16) + '…')
}

console.log(`\n────\nupload-policy-test：${pass} 通过 / ${fail} 失败`)
if (fail) { console.error('✗ 上传策略未通过'); process.exit(1) }
console.log('✓ 上传策略通过：文件名/扩展名白名单/内容嗅探/音频格式/文本上限/接线/变异自证')

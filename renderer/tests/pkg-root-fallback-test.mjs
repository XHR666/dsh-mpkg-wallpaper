// pkg-root-fallback-test.mjs —— `/pkg/<id>` 的**候选库根回落**判据（2026-10-10 新增）
//
// 真机依据（用户 2026-10-10 16:37 日志）：`:8902` 的生效根 = `allwallpaper/0923`，而目标包在
// `allwallpaper/1004` ⇒ `GET /pkg/逆流茶会-姐妹日常+(x-ray).mpkg` **无论名字怎么编码都 404**。
// 即：上一条"`+`/空格三形态兜底"只治了名字，**根不匹配**是另一条独立成因（`libraryRoots()` 原为
// `[生效根, SAMPLE_ROOT]`，永远看不到兄弟根）。
// 修法：`siblingLibraryRoots()` —— 生效根的同级一层目录（有界 64、按 primary 缓存），只对 `.mpkg/.pkg`
// 生效；命中标注 `from:'sibling-root'` 并给 `globalThis.__pkgRootFallback` 计数。
//
// 判据（真 HTTP + 临时夹具；活动根留空、包放兄弟根）：
//   A1 `%2B` 形态 → 200；A2 `+`→空格 形态 → 200；A3 兄弟根里的普通包 → 200；A4 哪里都没有 → 404。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })

const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-rootfb-'))
const A = path.join(fx, 'r0923'); const B = path.join(fx, 'r1004')
fs.mkdirSync(A, { recursive: true }); fs.mkdirSync(B, { recursive: true })
const NAME = '逆流茶会-姐妹日常+(x-ray).mpkg'
fs.writeFileSync(path.join(B, NAME), 'PKG1')
fs.writeFileSync(path.join(B, '正常包.mpkg'), 'PKG2')

const port = await new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs'), String(port)], { env: { ...process.env, MPW_LIBRARY_DIR: A }, stdio: ['ignore', 'pipe', 'pipe'] })
const get = (u) => new Promise((r) => { const q = http.get({ host: '127.0.0.1', port, path: u }, (res) => { res.resume(); res.on('end', () => r(res.statusCode)) }); q.on('error', () => r(0)); q.setTimeout(4000, () => { q.destroy(); r(0) }) })

try {
  let up = false
  for (let i = 0; i < 40; i++) { if (await get('/api/library') === 200) { up = true; break } await new Promise((r) => setTimeout(r, 150)) }
  if (!up) { ok('A0', '被测服务能起来', false, '5s 内 /api/library 未 200') } else {
    ok('A1', '活动根为空、包在**兄弟根**：`%2B` 形态 → 200', await get('/pkg/' + encodeURIComponent(NAME)) === 200, '见真机 16:37 日志')
    ok('A2', '同上、`+`→空格 形态 → 200（与三形态兜底叠加）', await get('/pkg/' + encodeURIComponent(NAME.replace('+', ' '))) === 200, '')
    ok('A3', '兄弟根里的普通包 → 200（回落对一般 id 也生效）', await get('/pkg/' + encodeURIComponent('正常包.mpkg')) === 200, '')
    ok('A4', '哪里都没有的包 → 仍 404（回落不许把 404 变 200）', await get('/pkg/' + encodeURIComponent('不存在的包.mpkg')) === 404, '')
  }
} finally { try { child.kill('SIGKILL') } catch { /* ignore */ } try { fs.rmSync(fx, { recursive: true, force: true }) } catch { /* ignore */ } }

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== pkg-root-fallback: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

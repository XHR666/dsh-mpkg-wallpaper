// pkg-id-encoding-test.mjs —— `/pkg/<id>` 的 **id 编码形态**判据集（P-262 回归判据）
//
// 真机根因（P-262，2026-10-10）：id 里的空格被上游编码成 `+`（URLSearchParams 行为），而
// `/pkg/<id>` 只做 `decodeURIComponent`（**不把 `+` 还原成空格**）⇒ 同一个文件两种形态
// 一个 200 一个 404。实测对照（:8903，库根 allwallpaper/1004）：
//   逆流茶会-姐妹日常%20(x-ray).mpkg → 200
//   逆流茶会-姐妹日常+(x-ray).mpkg   → 404     ← 页面日志里的那个 id
// 页面表现 = `pkg HTTP 404` + `⚠ 7s 内没有首帧，但 module 已启动`。
//
// 判据（A 段：纯 Node + 真 HTTP + 临时夹具，无浏览器、不碰真实语料）：
//   A1 `%20` 形态 → 200（老口径，不许回归）
//   A2 **`+` 形态 → 200**（新增兜底：`+`→空格；这就是 P-262 的回归线）
//   A3 字面 `+` 文件名（`lit+eral.mpkg`）→ 200，且**原样优先**（不被 `+`→空格 误伤）
//   A4 对称兜底：`%20` 形态解析不到时用 空格→`+` 再试一次（`lit%20eral.mpkg` → 200）
//   A5 非 ASCII（`中文 名.mpkg` 的两种编码）→ 200
//   A6 真不存在的 id → 仍 404（负数用例：兜底不许把 404 变成 200）
//
// 用法: node tests/pkg-id-encoding-test.mjs [--json]
// 退出码：0 全绿 / 1 有失败 / 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { ROOT } from './_root.mjs'

const JSON_OUT = process.argv.slice(2).includes('--json')
/* 被测入口：`:8902` 那个文件（**唯一可独立起**的服务入口**；`we-scene-demo-server.mjs` 是被它
   import 的渲染器处理器模块，直接 spawn 不会 listen —— 实测：spawn 它 60×150ms 也起不来）。 */
const SERVER = path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs')

const fxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pkgid-'))
const lib = path.join(fxRoot, 'lib')
fs.mkdirSync(lib, { recursive: true })
// 夹具：只含**空格**的、只含**字面 +** 的、非 ASCII 的（各 4 字节，路由只做流式回，不解析内容）
for (const name of ['only space.mpkg', 'lit+eral.mpkg', '中文 名.mpkg']) fs.writeFileSync(path.join(lib, name), 'PKG1')

const rows = []
const ok = (id, why, cond, detail) => { rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) }) }

function get(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 40) }))
    })
    req.on('error', (e) => resolve({ status: 0, body: String((e && e.message) || e) }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }) })
  })
}

async function freePort() {
  return await new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}

async function main() {
  const port = await freePort()
  const child = spawn(process.execPath, [SERVER, String(port)], {
    env: { ...process.env, MPW_LIBRARY_DIR: lib, MPW_REPORTS_DIR: path.join(fxRoot, 'reports'), MPW_QUIET: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let childErr = ''
  try { child.stderr.on('data', (d) => { childErr += String(d) }) } catch { /* ignore */ }

  try {
    let up = false
    for (let i = 0; i < 60; i++) {
      const r = await get(port, '/api/library')
      if (r.status === 200) { up = true; break }
      await new Promise((r2) => setTimeout(r2, 150))
    }
    if (!up) { ok('server-up', '被测服务能在 5s 内起来', false, childErr.slice(-200)); return }

    const cases = [
      ['A1 %20 形态（老口径）', '/pkg/only%20space.mpkg', 200],
      ['A2 `+` 形态（P-262 兜底：+→空格）', '/pkg/only+space.mpkg', 200],
      ['A3 字面 `+` 文件名（原样优先，不被误伤）', '/pkg/lit+eral.mpkg', 200],
      ['A4 对称兜底（空格→+）', '/pkg/lit%20eral.mpkg', 200],
      ['A5a 非 ASCII + %20', '/pkg/%E4%B8%AD%E6%96%87%20%E5%90%8D.mpkg', 200],
      ['A5b 非 ASCII + `+`', '/pkg/%E4%B8%AD%E6%96%87+%E5%90%8D.mpkg', 200],
      ['A6 真不存在 ⇒ 仍 404（负数用例）', '/pkg/nope-not-here.mpkg', 404],
    ]
    for (const [why, urlPath, want] of cases) {
      const r = await get(port, urlPath)
      ok(want === 200 ? 'A' : 'A6', why, r.status === want, `HTTP ${r.status}（期望 ${want}）body=${r.body}`)
    }
  } finally {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    try { fs.rmSync(fxRoot, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

await main()
const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.why + ' — ' + r.detail)
console.log(`===== pkg-id-encoding: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
if (JSON_OUT) console.log('PKG-ID-ENCODING-JSON ' + JSON.stringify({ pass: rows.length - fail.length, fail: fail.length, rows }))
process.exit(fail.length ? 1 : 0)

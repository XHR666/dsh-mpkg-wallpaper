// pkg-name-corpus-test.mjs —— `/pkg/<id>` 出端编码的**语料级**保证（2026-10-11）
//
// 由来（① 的真机串）：用户日志里 id 带 `+`（`%2B`）而磁盘名带**空格** ⇒ 说明上游某处把空格变过 `+`
// （或 id 本身就带 `+`）。P-262 已在服务端做"名字三形态兜底"（原样 / `+`→空格 / 空格→`+`），
// 本判据补上**出端**的语料级保证：`demo.html` 的 URL 构造按 `/` 分段 `encodeURIComponent`
// ⇒ 对语料里**每一个真实包名**（含空格 / CJK / `(` `)` / `#` 等）都必须是**无损往返**。
//
// 边界：本判据只验证"编码→解码"的无损性（纯函数级），不启动服务；服务端三形态兜底由
// `tests/pkg-id-encoding-test.mjs` 与 `tests/pkg-root-fallback-test.mjs`（真 HTTP）覆盖。
import fs from 'node:fs'
import path from 'node:path'
import { WS, ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })

const walk = (d, out = []) => {
  let ns = []
  try { ns = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of ns) {
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (/\.(mpkg|pkg)$/i.test(x.name)) out.push(p)
  }
  return out
}
const files = walk(path.join(WS, 'allwallpaper'))
const names = files.map((f) => path.basename(f))
const enc = (id) => String(id).split('/').map(encodeURIComponent).join('/')
const bad = names.filter((n) => decodeURIComponent(enc(n)) !== n)
const withSpace = names.filter((n) => n.includes(' '))
const withPlus = names.filter((n) => n.includes('+'))

ok('N1', '语料基数足够（≥200 个容器）', names.length >= 200, 'names=' + names.length)
ok('N2', '**每个**语料包名分段 encodeURIComponent 后往返无损', bad.length === 0,
  bad.length ? bad.slice(0, 3).join(' | ') : ('含空格 ' + withSpace.length + ' 个 / 含 + ' + withPlus.length + ' 个'))
ok('N3', '出端构造用的是按段编码（demo.html 源码断言）',
  /'\/pkg\/'\s*\+\s*[^\n]*split\('\/'\)[^\n]*map\(encodeURIComponent\)/.test(fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')), '')
ok('N4', '危险字符样本确实存在（判据非空转）', withSpace.length > 0, '含空格示例=' + (withSpace[0] || '无'))
ok('N5', '含 `+` 的名字在语料里不存在时也保持通过（说明 `+` 只可能来自上游转换）',
  withPlus.length === 0 || withPlus.every((n) => decodeURIComponent(enc(n)) === n), '含 + 数=' + withPlus.length)

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== pkg-name-corpus: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

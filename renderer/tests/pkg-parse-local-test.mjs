// pkg-parse-local-test.mjs —— 「本仓自带解析器」的判据（2026-10-11）
//
// 背景：此前只克隆渲染器的人会被 `start-demo.sh` 预检挡住（"找不到包解析器" ✗），
// 因为服务器只去姊妹插件仓找 `pkg-extract.js`。现改为本仓根自带 `pkg-parse.mjs`（MIT 薄封装 `we-core/pkg.js` ✓）
// ⇒ 判据钉住两件事：①契约函数齐全（`parsePkg`/`readPkgEntry` ✓，服务器正是按这两个名字取用 ✓）；
// ②真的能解**两种**容器（`PKGV*` 与 `PKGM*` ✓），且 `readPkgEntry` 读出的字节长度 == 条目 size ✓。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'
import { parsePkg, readPkgEntry, PKG_EXTRACT_SOURCE } from '../pkg-parse.mjs'

const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

ok('契约：导出 parsePkg / readPkgEntry（服务器按这两个名字取用）',
  typeof parsePkg === 'function' && typeof readPkgEntry === 'function')
ok('自带来源自述在位（便于诊断页显示用哪个解析器）', typeof PKG_EXTRACT_SOURCE === 'string' && PKG_EXTRACT_SOURCE.length > 0)

// 找一个 PKGV 容器与一个 PKGM 容器（语料在工作区；缺失则 SKIP 该条，不假红）
const roots = ['0923', 'dd', '0917', '1004']
const found = { PKGV: null, PKGM: null }
for (const d of roots) {
  const dir = path.join(WS, 'allwallpaper', d)
  let names = []
  try { names = fs.readdirSync(dir) } catch { continue }
  for (const n of names) {
    for (const cand of [path.join(dir, n, 'scene.pkg'), path.join(dir, n + '.mpkg'), path.join(dir, n + '.pkg')]) {
      if (!fs.existsSync(cand)) continue
      let magic = ''
      try { const fd = fs.openSync(cand, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); magic = b.toString('latin1', 4, 8) } catch { continue }
      if (magic.startsWith('PKGV') && !found.PKGV) found.PKGV = cand
      if (magic.startsWith('PKGM') && !found.PKGM) found.PKGM = cand
    }
    if (found.PKGV && found.PKGM) break
  }
  if (found.PKGV && found.PKGM) break
}
for (const kind of ['PKGV', 'PKGM']) {
  const f = found[kind]
  if (!f) { console.log('  SKIP ' + kind + '：语料里没找到（素材不在本机时为正常）'); continue }
  const buf = fs.readFileSync(f)
  let pkg = null; let err = ''
  try { pkg = parsePkg(buf) } catch (e) { err = String(e && e.message || e) }
  ok(`真包解析 ${kind}：${path.basename(f)}（条目 ${pkg ? pkg.entries.length : '-'}）`,
    !!pkg && pkg.entries.length > 0, err || ('magic=' + (pkg && pkg.magic)))
  if (pkg && pkg.entries.length) {
    const e0 = pkg.entries.find((x) => x.size > 0) || pkg.entries[0]
    const bytes = readPkgEntry(pkg, e0)
    ok(`readPkgEntry 返回字节数 == 条目 size（${e0.name.slice(0, 40)}）`,
      bytes && bytes.length === e0.size, 'got=' + (bytes && bytes.length) + ' want=' + e0.size)
    const bytes2 = readPkgEntry(buf, e0)   // 兼容插件的 (data, entry) 形态
    ok('readPkgEntry 亦接受 (data, entry) 形态并给出同样结果',
      bytes2 && bytes2.length === e0.size)
  }
}

const fail = rows.filter((r) => !r.pass)
for (const r of rows) if (!r.pass) console.log('  FAIL ' + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== pkg-parse-local: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

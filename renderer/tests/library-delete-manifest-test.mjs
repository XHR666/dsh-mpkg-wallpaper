// tests/library-delete-manifest-test.mjs —— 「去重后的暂存区」必须与**机器可读清单**双向一致
//
// 背景（口径，见 docs/DELETE-MOVED-20260923.md + docs/USER-ITEMS-20260921.md 第 14/16 轮）：
//   壁纸库的重复副本**不再硬删** —— 一律 `rename` 进 `allwallpaper/delete/<原相对路径>`，
//   并在 `allwallpaper/delete/MANIFEST.json` 里逐条记下：原相对路径、大小、sha256、**保留的孪生副本**。
//   `delete/` 是同盘暂存区（未压缩、未改内容），回滚就是把文件 `mv` 回去。
//
// 为什么要有这个门禁：口径从"删"改成"移 + 记清单"之后，唯一能防止它**悄悄腐烂**的就是"磁盘 ↔ 清单"对账：
//   · 有人往 `delete/` 里丢文件却没登记（清单外的遗留物 = 说不清来历的重复项）；
//   · 清单里登记了但盘上没了（= 被删了，或路径写错）；
//   · 移走的文件与"保留副本"**不再逐字节相同**（= 保留副本被换过/清单配错对）；
//   · 大小/sha256 与清单不符（= 文件被改过）。
// 四类都必须在门禁里变红，且**分辨力自证**（把清单改坏必红）不能省。
//
// 本机语料（`allwallpaper/`）不进仓库 ⇒ 缺语料时整项 **SKIP**（rc=0，与其余真包类条件项同口径），
// 但 SKIP 前仍会跑**夹具段的四组变异**（那部分不依赖语料）—— 覆盖率不会因为"没语料"而变成零。
//
// 用法：node tests/library-delete-manifest-test.mjs [--no-hash]
//   --no-hash：只对账"路径集合 + 大小"（秒级；日常快跑用），默认对每对**全文件 sha256** 复核（1.7GB 读数，~10-20s）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { WS } from './_root.mjs'

const NO_HASH = process.argv.includes('--no-hash')
let pass = 0, fail = 0
const ok = (cond, n, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  ' + d : '')) }
  else { fail++; console.error('  ✗ ' + n + (d ? '  → ' + d : '')) }
  return !!cond
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

/** 对账一份"暂存区 + 清单"：只依赖 `allRoot/delete/MANIFEST.json`，可对任意（含夹具）树跑。
 *  @returns {{ problems:Array, listed:Set, onDisk:Set, count:number, bytes:number, hashed:number }} */
function checkManifest(allRoot, { hash = true } = {}) {
  const DEL = path.join(allRoot, 'delete')
  const MAN = path.join(DEL, 'MANIFEST.json')
  const problems = [], listed = new Set(), onDisk = new Set()
  let count = 0, bytes = 0, hashed = 0
  if (!fs.existsSync(MAN)) { problems.push('清单不存在: ' + MAN); return { problems, listed, onDisk, count, bytes, hashed } }
  let doc = null
  try { doc = JSON.parse(fs.readFileSync(MAN, 'utf8')) } catch (e) { problems.push('清单不是合法 JSON: ' + String(e.message).slice(0, 80)); return { problems, listed, onDisk, count, bytes, hashed } }
  const entries = Array.isArray(doc.entries) ? doc.entries : []
  const walk = (d, out = []) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const st = fs.statSync(p); if (st.isDirectory()) walk(p, out); else out.push(p) } return out }
  for (const p of walk(DEL)) { const rel = path.relative(DEL, p); if (rel !== 'MANIFEST.json') onDisk.add(rel) }
  for (const e of entries) {
    if (!e || typeof e.moved !== 'string' || !e.moved) { problems.push('清单条目缺 `moved`：' + JSON.stringify(e).slice(0, 80)); continue }
    listed.add(e.moved)
    const abs = path.join(DEL, e.moved)
    if (!fs.existsSync(abs)) { problems.push('清单有、磁盘无: ' + e.moved); continue }
    const st = fs.statSync(abs)
    count++; bytes += st.size
    if (e.size !== st.size) problems.push('大小不符: ' + e.moved + ' 清单=' + e.size + ' 磁盘=' + st.size)
    if (hash) { const h = sha256(abs); hashed++; if (e.sha256 !== h) problems.push('sha256 不符: ' + e.moved + ' 清单=' + String(e.sha256).slice(0, 12) + '… 磁盘=' + h.slice(0, 12) + '…') }
    // 孪生副本：必须在 delete/ **之外**、存在、大小相同、且（hash 档）逐字节相同
    if (typeof e.kept !== 'string' || !e.kept) { problems.push('清单条目缺 `kept`（保留副本）: ' + e.moved); continue }
    const keptAbs = path.join(allRoot, e.kept)
    if (keptAbs.startsWith(DEL + path.sep)) { problems.push('`kept` 指向 delete/ 内部（应该是库内保留副本）: ' + e.kept); continue }
    if (!fs.existsSync(keptAbs)) { problems.push('保留副本不存在: ' + e.kept); continue }
    const kst = fs.statSync(keptAbs)
    if (kst.size !== st.size) { problems.push('保留副本大小不符: ' + e.kept + ' ' + kst.size + ' ≠ ' + st.size); continue }
    if (hash) { const kh = sha256(keptAbs); hashed++; if (kh !== (e.sha256 || sha256(abs))) problems.push('保留副本内容与移走文件不同: ' + e.kept) }
  }
  for (const rel of onDisk) if (!listed.has(rel)) problems.push('磁盘有、清单无（来历不明的暂存文件）: ' + rel)
  for (const rel of listed) if (!onDisk.has(rel)) problems.push('清单有、磁盘无: ' + rel)
  if (Number(doc.count) !== count) problems.push('清单 count=' + doc.count + ' 与实际条目数 ' + count + ' 不一致')
  if (Number(doc.bytes) !== bytes) problems.push('清单 bytes=' + doc.bytes + ' 与实际总字节 ' + bytes + ' 不一致')
  return { problems: [...new Set(problems)], listed, onDisk, count, bytes, hashed }
}

/* ── ① 真语料对账（缺语料 ⇒ SKIP，但仍跑下面的夹具段）────────────────────────────────────────── */
const ALL = path.join(WS, 'allwallpaper')
const HAVE = fs.existsSync(path.join(ALL, 'delete'))
console.log('== 暂存区 ↔ 清单 对账（' + (NO_HASH ? '只对路径+大小' : '含全文件 sha256') + '）==')
if (!HAVE) {
  console.log('SKIP library-delete-manifest —— 本机语料里没有 `allwallpaper/delete/`（语料属本机资产，不进仓库）')
} else {
  const r = checkManifest(ALL, { hash: !NO_HASH })
  console.log('  读数：清单条目 ' + r.count + ' 条 / ' + r.bytes + ' B（' + (r.bytes / 1048576).toFixed(2) + ' MiB）· 磁盘文件 ' + r.onDisk.size +
    ' 个 · 本档哈希 ' + r.hashed + ' 次')
  ok(r.problems.length === 0, '真语料：磁盘 ↔ 清单**双向一致**，逐条 sha256 与保留副本相同（0 问题）',
    r.problems.length ? JSON.stringify(r.problems.slice(0, 4)) : ('条目 ' + r.count + ' · ' + (r.bytes / 1048576).toFixed(2) + ' MiB'))
  ok(r.count > 0 && r.listed.size === r.onDisk.size, '清单条目集合 == delete/ 里的文件集合（不多不少）',
    '清单 ' + r.listed.size + ' / 磁盘 ' + r.onDisk.size)
}

/* ── ② 分辨力自证：夹具树 + 四组变异（不依赖语料）────────────────────────────────────────────── */
console.log('\n== 分辨力自证（夹具树 + 四组变异，必须各自变红）==')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delman-'))
const mkFixture = () => {
  const root = fs.mkdtempSync(path.join(tmp, 'fx-'))
  fs.mkdirSync(path.join(root, 'delete', 'role'), { recursive: true })
  fs.mkdirSync(path.join(root, 'role'), { recursive: true })
  const a = Buffer.alloc(4096, 7), b = Buffer.alloc(8192, 9)
  fs.writeFileSync(path.join(root, 'delete', 'role', 'x.mpkg'), a)
  fs.writeFileSync(path.join(root, 'role', 'x.mpkg'), a)
  fs.writeFileSync(path.join(root, 'delete', 'role', 'y.mpkg'), b)
  fs.writeFileSync(path.join(root, 'role', 'y.mpkg'), b)
  const entries = [
    { moved: 'role/x.mpkg', original: 'role/x.mpkg', kept: 'role/x.mpkg', size: a.length, sha256: sha256(path.join(root, 'delete', 'role', 'x.mpkg')), twins: 1 },
    { moved: 'role/y.mpkg', original: 'role/y.mpkg', kept: 'role/y.mpkg', size: b.length, sha256: sha256(path.join(root, 'delete', 'role', 'y.mpkg')), twins: 1 },
  ]
  const doc = { count: entries.length, bytes: a.length + b.length, entries }
  const write = () => fs.writeFileSync(path.join(root, 'delete', 'MANIFEST.json'), JSON.stringify(doc, null, 1) + '\n')
  write()
  return { root, doc, write }
}
{
  const f = mkFixture()
  const base = checkManifest(f.root)
  ok(base.problems.length === 0, '夹具基线：完好夹具树 ⇒ 0 问题（否则下面的"必红"没有意义）', JSON.stringify(base.problems))

  const mut = (name, fn, expect) => {
    const g = mkFixture()
    fn(g)
    g.write()
    const r = checkManifest(g.root)
    const hit = r.problems.some((p) => p.includes(expect))
    ok(hit, '变异「' + name + '」必红（且点名到具体文件）', 'problems=' + JSON.stringify(r.problems.slice(0, 3)) + ' 期望含 ' + expect)
  }
  mut('篡改 sha256', (g) => { g.doc.entries[0].sha256 = 'deadbeef'.repeat(8) }, 'sha256 不符')
  /*  这一组两种检测都算对：换成一个**不同大小**的副本 ⇒ 先被"大小不符"拦下（且不再比内容）；
      换成同大小的另一个文件 ⇒ 才走到"内容不同"。判据按"保留副本"这一族匹配，不锁死具体措辞。 */
  mut('保留副本指向别的内容', (g) => { g.doc.entries[0].kept = 'role/y.mpkg' }, '保留副本')
  mut('清单少登记一条（磁盘有、清单无）', (g) => { g.doc.entries.pop(); g.doc.count = 1; g.doc.bytes = 4096 }, '磁盘有、清单无')
  mut('清单多登记一条（清单有、磁盘无）', (g) => { g.doc.entries.push({ moved: 'role/z.mpkg', kept: 'role/x.mpkg', size: 1, sha256: 'x' }); g.doc.count = 3 }, '清单有、磁盘无')
  mut('大小被改过', (g) => { g.doc.entries[1].size = 123 }, '大小不符')
  /*  反向自证：**只**把清单换成"删掉 kept 字段"的写法也必须红（防"清单字段悄悄消失但仍全绿"） */
  mut('kept 字段缺失', (g) => { delete g.doc.entries[0].kept }, '缺 `kept`')
}

try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

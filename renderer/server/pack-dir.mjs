// server/pack-dir.mjs — 把 WE workshop **源目录**打包成渲染器可直接吃的 PKG 容器（.mpkg）。
//
// 为什么需要它（用户第 22 项："MPKG 和 workshop 源目录，你要可以去混合加载"）：
//   渲染器只接受**一个包文件**（`?pkgurl=`/`?pkgpath=` → 一个 PKG 容器 buffer），读不了目录树。
//   与其在渲染器里加一套"虚拟目录包"（改动面大、易回归），不如在服务器/工具侧把目录即时打包成
//   PKG 容器 —— 渲染器与现有链路一行都不用改。
//
// 容器格式（与 dsh-mpkg-wallpaper/lib/pkg-extract.js 的 parsePkg 完全一致，实测过）：
//   sizedString(magic='PKGV00xx')   // i32 长度前缀 + UTF-8
//   i32 entryCount
//   entryCount × { sizedString(path), u32 offset, u32 length }   // offset 相对数据区起点
//   <data 区>                        // 本工具一律**原样存储**（不压缩）：probeCompressedEntry 不会误判
//
// 用法：
//   node server/pack-dir.mjs <源目录> [输出.mpkg]        # 省略输出则写 <源目录>.mpkg
//   node server/pack-dir.mjs <源目录> --verify           # 打包后逐条回读并与源文件比对 sha256（默认开）
//   node server/pack-dir.mjs --scan <根目录>             # 列出根目录下所有可直接打包的 workshop 目录
//
// 兼容：本工具只读源目录，不改任何文件；输出可被 parsePkg/readPkgEntry 正确解析（--verify 自证）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// ①(P-101 2026-09-16 目录再整理) 本脚本移入 `server/`：插件的兄弟目录与 `--scan` 默认根
//   都相对**仓库根**（= HERE/..）解析，保持收拢前的语义。
const REPO_ROOT = path.resolve(HERE, '..')
const PKG_MAGIC = 'PKGV0022'                 // 与语料实测一致（0022/0023 都出现过，解析器只校验 PKGV\d{4}）
const MAX_FILES = 200000                     // 防御：异常目录（符号链接环/超大树）
const MAX_BYTES = 4 * 1024 * 1024 * 1024     // 防御：单包上限 4GB

/** 递归收集文件（相对路径统一用 '/' 分隔，跳过符号链接，避免环）。 */
export function collectFiles(root) {
  const out = []
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isSymbolicLink()) continue
      const abs = path.join(dir, ent.name)
      const r = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) walk(abs, r)
      else if (ent.isFile()) { out.push({ rel: r, abs }); if (out.length > MAX_FILES) throw new Error('文件数超过上限 ' + MAX_FILES) }
    }
  }
  walk(root, '')
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))  // 确定性输出（同目录两次打包字节相同）
  return out
}

/** 打包：原样存储（flags=0），返回 { buf, entries }。 */
export function packDir(root) {
  const files = collectFiles(root)
  if (!files.length) throw new Error('目录里没有文件: ' + root)
  const magic = Buffer.from(PKG_MAGIC, 'utf8')
  const head = []
  head.push(i32(magic.length), magic, i32(files.length))
  let dataLen = 0
  for (const f of files) { f.size = fs.statSync(f.abs).size; f.offset = dataLen; dataLen += f.size }
  if (dataLen > MAX_BYTES) throw new Error('数据区超过上限')
  for (const f of files) {
    const p = Buffer.from(f.rel, 'utf8')
    head.push(i32(p.length), p, u32(f.offset), u32(f.size))
  }
  const header = Buffer.concat(head)
  const buf = Buffer.allocUnsafe(header.length + dataLen)
  header.copy(buf, 0)
  let at = header.length
  for (const f of files) { const b = fs.readFileSync(f.abs); b.copy(buf, at); at += b.length }
  return { buf, entries: files }
}

const i32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeInt32LE(n | 0, 0); return b }
const u32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0, 0); return b }

/** 用**生产解析器**回读校验（同一份 parsePkg，避免"自己解析自己"的假验证）。
 *  ①(2026-10-30 路径固化) 插件树解析：env `MPW_PLUGIN_DIR` → 集成布局 `REPO_ROOT/../plugin`
 *     （渲染器并入插件工作区，插件目录改名自 `dsh-mpkg-wallpaper`）→ 旧兄弟仓名回退（原检出仍可跑）。 */
async function loadPluginPkgExtract() {
  const cands = [process.env.MPW_PLUGIN_DIR,
    path.join(REPO_ROOT, '..', 'plugin'),
    path.join(REPO_ROOT, '..', 'dsh-mpkg-wallpaper')].filter(Boolean)
  for (const c of cands) {
    const p = path.join(c, 'lib', 'pkg-extract.js')
    try { if (fs.existsSync(p)) return await import(p) } catch { /* 下一个候选 */ }
  }
  throw new Error('找不到插件树 pkg-extract.js（候选: ' + cands.map((c) => path.join(c, 'lib', 'pkg-extract.js')).join(', ') + '）')
}
async function verify(root, buf, files) {
  const mod = await loadPluginPkgExtract()
  const index = mod.parsePkg(buf)
  const byPath = new Map(index.map((e) => [e.path, e]))
  if (index.length !== files.length) throw new Error(`条目数不一致：packed=${files.length} parsed=${index.length}`)
  let bad = 0, checked = 0
  for (const f of files) {
    const e = byPath.get(f.rel)
    if (!e) { console.error('  ✗ 缺条目 ' + f.rel); bad++; continue }
    if (e.size !== f.size) { console.error('  ✗ 尺寸不符 ' + f.rel); bad++; continue }
    const got = mod.readPkgEntry(buf, e)
    const want = fs.readFileSync(f.abs)
    const h1 = crypto.createHash('sha256').update(got).digest('hex')
    const h2 = crypto.createHash('sha256').update(want).digest('hex')
    if (h1 !== h2) { console.error('  ✗ 内容不符 ' + f.rel); bad++; continue }
    checked++
  }
  if (bad) throw new Error(`回读校验失败 ${bad} 条`)
  return { count: checked, bytes: buf.length, compressed: index.filter((e) => e.flags).length }
}

async function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || argv[0] === '--help') {
    console.log('用法: node server/pack-dir.mjs <源目录> [输出.mpkg] | --scan <根目录>')
    return
  }
  if (argv[0] === '--scan') {
    const root = argv[1] || REPO_ROOT
    const hits = []
    const walk = (dir, depth) => {
      if (depth > 6) return
      let ents = []
      try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      const names = new Set(ents.map((e) => e.name))
      if (names.has('scene.pkg') || names.has('project.json')) hits.push(dir)
      for (const e of ents) if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1)
    }
    walk(root, 0)
    console.log(`可直接打包的 workshop 目录 ${hits.length} 个：`)
    for (const h of hits.slice(0, 40)) console.log('  ' + path.relative(root, h))
    if (hits.length > 40) console.log(`  …（还有 ${hits.length - 40} 个）`)
    return
  }
  const root = path.resolve(argv[0])
  const out = path.resolve(argv[1] && !argv[1].startsWith('--') ? argv[1] : root.replace(/[\\/]+$/, '') + '.mpkg')
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { console.error('不是目录: ' + root); process.exit(2) }
  const t0 = Date.now()
  const { buf, entries } = packDir(root)
  fs.writeFileSync(out, buf)
  const v = await verify(root, buf, entries)
  console.log(`打包完成: ${out}`)
  console.log(`  条目 ${v.count} 个 / ${(v.bytes / 1048576).toFixed(2)} MiB / 压缩条目 ${v.compressed} / 用时 ${Date.now() - t0}ms`)
  console.log(`  解析器: parsePkg + readPkgEntry（生产代码），逐条 sha256 与源文件一致 ✓`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1) })
}

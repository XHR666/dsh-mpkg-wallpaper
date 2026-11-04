// tools/pkg-patch.mjs —— 受控 A/B 用的 **PKG 容器读写器**（P-236）
//
// 用途：把 `scene.json`（或包内任何一个 JSON 条目）改几个字段后**重新打包**，同一份输入喂两档
//   —— 本仓档 `?pkgpath=<改过的包>`、上游产物档 `window.__wp.loadSceneFile(blob, projectJson)`
//   —— 于是"我们和官方渲染器对同一份输入的响应"变成可判问题（P-236 定案就是这么做的：把光轴层的
//   `instanceoverride.alpha` 改成 0，两档读数一比，谁读了这个覆写一目了然）。
//
// 容器布局（实测 PKGV0012–PKGV0024 / PKGM0014 同款，**条目不压缩**）：
//   [u32 magicLen][magic 字节][u32 入口数]{u32 nameLen, name 字节, u32 offset, u32 size}… + 数据段
//   `offset` 相对**目录表末尾**（首个条目恒 0）。读=切数据段；写=按原顺序重排目录表 + 拼数据段。
//   ⇒ 只有被替换过的条目字节会变，其余条目**逐字节相同**（可 diff 验证）。
//
// 用法（CLI）：
//   node tools/pkg-patch.mjs --in a.pkg --out b.pkg --dump scene.json > scene.json
//   node tools/pkg-patch.mjs --in a.pkg --out b.pkg --put scene.json=./scene.json
//   node tools/pkg-patch.mjs --in a.pkg --out b.pkg --drop-object 'Light shafts 0'
//   node tools/pkg-patch.mjs --in a.pkg --list | head
// 用法（模块）：
//   import { readPkg, writePkg, getJson, setJson } from './pkg-patch.mjs'
//   const p = readPkg(src); const sj = getJson(p, 'scene.json'); sj.objects = [] ; setJson(p, 'scene.json', sj); writePkg(dst, p)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const td = new TextDecoder()
const te = new TextEncoder()
/** 官方 JSON 入口可能带 BOM（`parseWeJson` 特意吃掉）——这里同款处理，避免 `JSON.parse` 抛。 */
export const textOf = (u8) => td.decode(u8).replace(/^\uFEFF/, '')

/** 读容器 → `{ magic, order, files: Map<name, Uint8Array> }`（各条目字节是**副本**，改它不影响原文件）。 */
export function readPkg(file) {
  const raw = new Uint8Array(fs.readFileSync(file))
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const magicLen = dv.getUint32(0, true)
  if (magicLen < 1 || magicLen > 64) throw new Error('魔数长度异常: ' + magicLen)
  const magic = td.decode(raw.subarray(4, 4 + magicLen))
  if (!/^PKGV|^PKGM|^v\d/i.test(magic)) throw new Error('不是 PKG/PKGM 容器，魔数: ' + magic)
  const count = dv.getUint32(4 + magicLen, true)
  let p = 4 + magicLen + 4
  const order = []
  const files = new Map()
  const starts = []
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint32(p, true); p += 4
    const name = td.decode(raw.subarray(p, p + nameLen)); p += nameLen
    const offset = dv.getUint32(p, true); p += 4
    const size = dv.getUint32(p, true); p += 4
    order.push(name)
    starts.push([name, offset, size])
  }
  const dataStart = p
  for (const [name, offset, size] of starts) files.set(name, raw.slice(dataStart + offset, dataStart + offset + size))
  return { magic, order, files, fileSize: raw.length }
}

/** 写容器（同 `server/pack-dir.mjs` 的布局）。条目顺序按 `order` 保序，新增条目追加在末尾。 */
export function writePkg(file, { magic, files, order }) {
  const names = (order || []).filter((n) => files.has(n)).concat([...files.keys()].filter((n) => !(order || []).includes(n)))
  const i32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeInt32LE(n | 0); return b }
  const u32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0); return b }
  const sized = (s) => { const p = Buffer.from(s, 'utf8'); return Buffer.concat([i32(p.length), p]) }
  const head = [sized(magic), u32(names.length)]
  let offset = 0
  const part = []
  for (const n of names) {
    const b = Buffer.from(files.get(n))
    head.push(sized(n), u32(offset), u32(b.length))
    part.push(b)
    offset += b.length
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([Buffer.concat(head), ...part]))
  return { file, entries: names.length, bytes: fs.statSync(file).size }
}

/** 取包内 JSON 条目（默认 `scene.json`）→ 解析后的对象；不存在返回 null。 */
export function getJson(pkg, name = 'scene.json') {
  const e = pkg.files.get(name) || pkg.files.get(name.replace(/\\/g, '/'))
  if (!e) return null
  try { return JSON.parse(textOf(e)) } catch { return null }
}

/** 写回包内 JSON 条目（`null` = 删除该条目）。 */
export function setJson(pkg, name, obj) {
  if (obj === null) { pkg.files.delete(name); pkg.order = pkg.order.filter((n) => n !== name); return pkg }
  pkg.files.set(name, te.encode(JSON.stringify(obj)))
  return pkg
}

/** 删掉 `scene.json` 里名字匹配的对象（`name` 精确匹配或正则）。返回被删的个数。 */
export function dropObjects(pkg, name) {
  const sj = getJson(pkg, 'scene.json')
  if (!sj || !Array.isArray(sj.objects)) return 0
  const re = name instanceof RegExp ? name : new RegExp('^' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')
  const before = sj.objects.length
  sj.objects = sj.objects.filter((o) => !re.test(String(o.name || '')))
  setJson(pkg, 'scene.json', sj)
  return before - sj.objects.length
}

// ─────────────────────────────── CLI ───────────────────────────────
/** 自检（合成 3 条目小包，不依赖语料）：往返逐字节相同 + `dropObjects` 只动 `scene.json`。 */
export function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-patch-'))
  const a = path.join(tmp, 'a.pkg'), b = path.join(tmp, 'b.pkg'), c = path.join(tmp, 'c.pkg')
  const files = new Map([
    ['scene.json', te.encode(JSON.stringify({ general: { x: 1 }, objects: [{ name: 'keep' }, { name: 'gone' }] }))],
    ['materials/m.tex', new Uint8Array([1, 2, 3, 4, 5])],
    ['particles/p.json', te.encode('{"emitter":[]}')],
  ])
  writePkg(a, { magic: 'PKGV0018', files, order: [...files.keys()] })
  const r1 = readPkg(a)
  writePkg(b, r1)
  const same = Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0
  const r2 = readPkg(a)
  const dropped = dropObjects(r2, 'gone')
  writePkg(c, r2)
  const r3 = readPkg(c)
  const texSame = Buffer.compare(Buffer.from(r1.files.get('materials/m.tex')), Buffer.from(r3.files.get('materials/m.tex'))) === 0
  const objs = getJson(r3, 'scene.json').objects
  const out = { roundTripByteIdentical: same, dropped, objectsLeft: objs.map((o) => o.name), untouchedEntryIdentical: texSame, magic: r3.magic, entries: r3.order.length }
  fs.rmSync(tmp, { recursive: true, force: true })
  return out
}

const isMain = (() => { try { return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname) } catch { return false } })()
if (isMain) {
  const argv = process.argv.slice(2)
  const opt = (k, def = null) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def }
  if (argv.includes('--self-test')) {
    const r = selfTest()
    const ok = r.roundTripByteIdentical && r.dropped === 1 && r.objectsLeft.join() === 'keep' && r.untouchedEntryIdentical && r.entries === 3
    console.log((ok ? 'PASS' : 'FAIL') + ' pkg-patch 自检 ' + JSON.stringify(r))
    process.exit(ok ? 0 : 1)
  }
  const src = opt('in')
  if (!src || src === true) { console.error('用法见文件头注释（--in/--out/--list/--dump/--put/--drop-object）'); process.exit(2) }
  const pkg = readPkg(src)
  if (opt('list')) { for (const n of pkg.order) console.log(n); process.exit(0) }
  const dump = opt('dump')
  if (dump) {
    const e = pkg.files.get(dump)
    if (!e) { console.error('包内没有条目：' + dump); process.exit(3) }
    process.stdout.write(textOf(e)); console.log('')
    process.exit(0)
  }
  let changed = 0
  const put = opt('put')
  if (put && put !== true) {
    for (const pair of String(put).split(',')) {
      const i = pair.indexOf('=')
      const name = pair.slice(0, i)
      const file = pair.slice(i + 1)
      pkg.files.set(name, new Uint8Array(fs.readFileSync(file)))
      if (!pkg.order.includes(name)) pkg.order.push(name)
      changed++
    }
  }
  const drop = opt('drop-object')
  if (drop && drop !== true) changed += dropObjects(pkg, String(drop))
  const out = opt('out')
  if (!out || out === true) { console.error('缺少 --out（本工具只读不写时请用 --dump/--list）'); process.exit(2) }
  if (!changed && !opt('force')) console.error('警告：没有任何改动（加 --force 可强制重写一遍做逐字节对照）')
  console.log(JSON.stringify(Object.assign(writePkg(out, pkg), { changed })))
}

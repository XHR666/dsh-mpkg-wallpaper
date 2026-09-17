// tools/persist-size-scan.mjs —— 壁纸 dataURL 真实体积分布（只读语料，不写任何东西）
//
// 为什么需要它（本轮持久化 bug 的证据链）：
//   插件把壁纸 `image` 常以 **dataURL** 内联进 section JSON，而 localStorage 单值有硬顶
//   （`MPW_LS_MAX_BYTES`）。要知道"真机为什么刷新回默认壁纸"，必须先把**真实语料**里
//   最可能被选中的背景图有多大（dataURL 字节数）量出来 —— 而不是拍脑袋定阈值。
//
// 口径（与 lib/client.js 逐字一致，见 tools/persist-size-scan.mjs 里的 pickBackgroundEntry 切片）：
//   · 候选 = `pickBackgroundEntry(entries, date)` 的第一命中；`--slot day|night|dusk|morning` 指定时段
//     （缺省 day）；该函数在**活动时段后缀 > day > night > dusk > morning > 内嵌 mp4 > 任意图片**
//     的优先序上取第一个命中。
//   · `ensureInfiniteGif()` 会改写 GIF 的 NETSCAPE2.0 循环次数（同一长度，字节可能微变），
//     所以 GIF 走真实现切片后再量，与运行期一致。
//   · dataURL 长度 = `data:<mime>;base64,` 前缀 + ceil(字节数 / 3) * 4（浏览器 FileReader 口径）。
//
// 用法：
//   node tools/persist-size-scan.mjs [--dir <语料目录>]... [--slot day] [--top 10] [--json]
//   缺省语料目录：<工作区>/allwallpaper/dd 与 <工作区>/allwallpaper/0917（存在才扫）
//   目录里可以是 *.mpkg 文件，也可以是**子目录**（子目录内取第一个 *.mpkg）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const WORKSPACE = path.resolve(ROOT, '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')

const argv = process.argv.slice(2)
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const SLOT = argVal('--slot', 'day')
const TOP = Number(argVal('--top', '12')) || 12
const AS_JSON = argv.includes('--json')
const dirs = []
for (let i = 0; i < argv.length; i++) if (argv[i] === '--dir' && argv[i + 1]) dirs.push(argv[i + 1])
if (!dirs.length) {
  for (const d of ['allwallpaper/dd', 'allwallpaper/0917']) {
    const p = path.join(WORKSPACE, d)
    if (fs.existsSync(p)) dirs.push(p)
  }
}

/** 从真源码里切一段（两端锚点必须存在）。 */
function cut (s, a, b) {
  const i = s.indexOf(a)
  const j = i >= 0 ? s.indexOf(b, i) : -1
  if (i < 0 || j < 0) throw new Error('切块失败（源码结构变了，请同步本工具）: ' + a.slice(0, 40))
  return s.slice(i, j)
}

const src = fs.readFileSync(CLIENT, 'utf8')
/** 与运行期**同一份实现**：parseMpkg / pickBackgroundEntry / guessMime / ensureInfiniteGif。 */
const impl = new Function('DataView', 'TextDecoder', `
	${cut(src, 'function parseMpkg(buffer) {', 'function guessMime(name) {')}
	${cut(src, 'function guessMime(name) {', 'function entryBytes(buffer, entry, dataStart) {')}
	${cut(src, 'function timeSlotKey(', 'function pickBackgroundEntry(')}
	${cut(src, 'function pickBackgroundEntry(', 'function blobToDataUrl(')}
	${cut(src, 'function ensureInfiniteGif(', '\t\t/** 处理视频纹理壁纸')}
	return { parseMpkg, guessMime, timeSlotKey, pickBackgroundEntry, ensureInfiniteGif };
`)(DataView, TextDecoder)

const DATAURL_PREFIX = (mime) => 'data:' + mime + ';base64,'
const dataUrlLen = (bytes, mime) => DATAURL_PREFIX(mime).length + Math.ceil(bytes.length / 3) * 4
const kb = (n) => (n / 1024).toFixed(1)

function listPkgs (dir) {
  const out = []
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isFile() && /\.mpkg$/i.test(e.name)) out.push(p)
    else if (e.isDirectory()) {
      let sub = []
      try { sub = fs.readdirSync(p) } catch {}
      const hit = sub.find((f) => /\.mpkg$/i.test(f))
      if (hit) { out.push(path.join(p, hit)); continue }
      // ⑵(本机语料实情) dd / 0917 是**解包后的 workshop 目录**：preview.gif + scene.pkg。
      //   这些包的静态帧路径用的就是 preview 图，所以按 `preview_<slot>.<ext> / <slot>.<ext> / preview.*`
      //   的口径量它 —— 与 client 的 pickBackgroundEntry 优先级一致。
      const pv = sub.filter((f) => /\.(gif|png|jpe?g|webp)$/i.test(f))
      if (pv.length) out.push({ dirPack: p, files: pv })
    }
  }
  return out
}

/** ⑵解包目录：按 pickBackgroundEntry 的口径在文件名上取优先命中。 */
function pickFromDir (files) {
  const exts = ['gif', 'png', 'jpg', 'jpeg', 'webp']
  for (const suf of [SLOT, 'day', 'night', 'dusk', 'morning']) {
    for (const ext of exts) {
      const hit = files.find((f) => {
        const n = f.toLowerCase()
        return n === `preview_${suf}.${ext}` || n === `preview-${suf}.${ext}` || n === `${suf}.${ext}`
      })
      if (hit) return { file: hit, slot: suf === SLOT ? SLOT : null }
    }
  }
  const any = files.find((f) => /\.(gif|png|jpe?g|webp)$/i.test(f)) || null
  return any ? { file: any, slot: null } : null
}

const rows = []
let pkgCount = 0
for (const dir of dirs) {
  for (const item of listPkgs(dir)) {
    pkgCount++
    if (item && item.dirPack) {   // ⑵解包目录（dd / 0917）
      const pick = pickFromDir(item.files)
      if (!pick) continue
      const fp = path.join(item.dirPack, pick.file)
      let bytes = fs.readFileSync(fp)
      const mime = /\.gif$/i.test(pick.file) ? 'image/gif' : /\.png$/i.test(pick.file) ? 'image/png'
        : /\.webp$/i.test(pick.file) ? 'image/webp' : 'image/jpeg'
      if (/\.gif$/i.test(pick.file)) bytes = Buffer.from(impl.ensureInfiniteGif(new Uint8Array(bytes)))
      rows.push({
        pkg: path.basename(item.dirPack), dir: path.dirname(item.dirPack), entry: pick.file, slot: pick.slot,
        bytes: bytes.length, mime, dataUrl: dataUrlLen(bytes, mime), kind: 'image',
      })
      continue
    }
    let mpkg = null
    try { mpkg = impl.parseMpkg(fs.readFileSync(item).buffer) } catch (e) { console.error('  解析失败 ' + path.basename(item) + ': ' + e.message); continue }
    const pick = impl.pickBackgroundEntry(mpkg.entries, new Date(2026, 8, 17, 12, 0, 0))
    if (!pick || !pick.entry) continue
    const e = pick.entry
    const p = item
    if (/\.(mp4|webm|mov)$/i.test(e.name)) {   // 视频壁纸不走 dataURL 路径（Blob → IndexedDB），只登记
      rows.push({ pkg: path.basename(p), dir: path.dirname(p), entry: e.name, slot: pick.slot, bytes: e.size, kind: 'video' })
      continue
    }
    const off = mpkg.dataStart + e.index
    let bytes = Buffer.from(fs.readFileSync(p).buffer, off, e.size)
    if (/\.gif$/i.test(e.name)) bytes = Buffer.from(impl.ensureInfiniteGif(new Uint8Array(bytes)))
    const mime = impl.guessMime(e.name)
    rows.push({
      pkg: path.basename(p), dir: path.dirname(p), entry: e.name, slot: pick.slot,
      bytes: bytes.length, mime, dataUrl: dataUrlLen(bytes, mime), kind: 'image',
    })
  }
}

const imgs = rows.filter((r) => r.kind === 'image').sort((a, b) => b.dataUrl - a.dataUrl)
const LIMITS = { lsMax: 256 * 1024, spill: 2 * 1024 * 1024 }

if (AS_JSON) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), slot: SLOT, dirs, pkgCount, limits: LIMITS, rows: imgs.slice(0, TOP) }, null, 2))
} else {
  console.log('# 壁纸 dataURL 真实体积分布（' + dirs.join(' , ') + '；时段=' + SLOT + '）')
  console.log('# 口径：pickBackgroundEntry 命中项 → 真字节数 → dataURL 长度（前缀 + ceil(n/3)*4）')
  console.log('# 阈值：localStorage 单值上限 ' + kb(LIMITS.lsMax) + ' KB；大图落 IndexedDB 线 ' + kb(LIMITS.spill) + ' KB')
  console.log('')
  console.log('| 排名 | 包 id（父目录/文件名） | 条目名 | 素材字节 | dataURL 字节 | 超 256KB | 超 2MB |')
  console.log('|---|---|---|---|---|---|---|')
  imgs.slice(0, TOP).forEach((r, i) => {
    console.log('| ' + (i + 1) + ' | ' + path.basename(r.dir) + '/' + r.pkg + ' | ' + r.entry + ' | ' + r.bytes + ' (' + kb(r.bytes) + ' KB)'
      + ' | ' + r.dataUrl + ' (' + kb(r.dataUrl) + ' KB) | ' + (r.dataUrl > LIMITS.lsMax ? '**是**' : '否')
      + ' | ' + (r.dataUrl > LIMITS.spill ? '**是**' : '否') + ' |')
  })
  if (imgs.length) {
    const over = imgs.filter((r) => r.dataUrl > LIMITS.lsMax).length
    const over2 = imgs.filter((r) => r.dataUrl > LIMITS.spill).length
    console.log('')
    console.log('图片类候选 ' + imgs.length + ' 个：'
      + 'dataURL 中位数 ' + kb(imgs[Math.floor(imgs.length / 2)].dataUrl) + ' KB，'
      + '最大 ' + kb(imgs[0].dataUrl) + ' KB（' + path.basename(imgs[0].dir) + '/' + imgs[0].pkg + ' ' + imgs[0].entry + '）；'
      + '超 256KB ' + over + '/' + imgs.length + '，超 2MB ' + over2 + '/' + imgs.length)
    console.log('⇒ 落在「超 localStorage 上限、但按 2MB 口径仍算小图」这一带的：'
      + imgs.filter((r) => r.dataUrl > LIMITS.lsMax && r.dataUrl <= LIMITS.spill).length + ' 个（这批就是被拒写且不落 IDB 的）')
  }
  const vids = rows.filter((r) => r.kind === 'video')
  if (vids.length) console.log('（另有 ' + vids.length + ' 个候选是内嵌视频/目录 mpkg，走 Blob→IndexedDB，不在此表）')
}

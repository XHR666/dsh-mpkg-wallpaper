// mpkg-video-codec-probe.mjs —— 任务④ 的第二因定性：`<video>` 在真机上恒 `rs=0 / ns=1`（既没解码也没在下载）。
//
// 已定性的第一因：`__videoBase` 块在 `scene` 还是 null 时执行 ⇒ 必抛 ⇒ 层从未加入（已修，见 demo.html
// `MPW-VIDEOBASE` 段）。但**修好后 B 档仍读到 `rs=0`** ⇒ 还有第二因。本探针**不开浏览器**，
// 直接问容器与编解码器这三个可判定问题：
//   Q1 容器里到底有什么（条目名/大小）——`project.json.file` 指向的条目是否真是视频；
//   Q2 这段字节是什么容器（mp4/webm/mkv）+ 什么编解码器（avc1/hvc1/av01/vp09…）——ffprobe 权威读数；
//   Q3 若编解码器是浏览器不支持的（如 HEVC），那 `rs=0/ns=1` 的**一部分**就是环境能力而不是我们的 bug；
//      若编解码器是 `h264`/`vp9` 且 ffprobe 能解 ⇒ 问题在页面侧（blob/MIME/时机/尺寸），属产品面。
//
// 口径：纯 Node、**内存有界**（只读目录表 + 分块把**单个视频条目**落到真盘临时文件，绝不整包入内存；
//       /tmp 是 tmpfs 会吃内存，所以临时文件写仓库内 `reports/.tmp-video/` 并在结束时清空）。
//       逐个处理、读完即释放。ffprobe 不可用则如实 SKIP（只给 magic/令牌候选）。
// 用法：node tests/mpkg-video-codec-probe.mjs [--n 8] [--pkg <abs>]... [--json <out>] [--max-entry-mb 320]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { WS, ROOT } from './_root.mjs'
import { readIndexHead, readEntryBytes, walkContainers } from './_pkg-index.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const argAll = (k) => argv.reduce((a, v, i) => (v === k && argv[i + 1] ? (a.push(argv[i + 1]), a) : a), [])
const N = Math.max(1, +(argVal('--n') || 8))
const JSON_OUT = argVal('--json')
const MAX_ENTRY = (+(argVal('--max-entry-mb') || 320)) * 1048576
const TMP = path.join(ROOT, 'reports', '.tmp-video')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

function hasFfprobe() {
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true } catch { return false }
}
const FF = hasFfprobe()

function magicOf(b) {
  const hex = Array.from(b.subarray(0, 16)).map((x) => x.toString(16).padStart(2, '0')).join('')
  const ascii = Array.from(b.subarray(0, 16)).map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('')
  let kind = 'unknown'
  if (hex.startsWith('1a45dfa3')) kind = 'matroska/webm'
  else if (ascii.slice(4, 8) === 'ftyp') kind = 'iso-bmff(mp4/mov) brand=' + ascii.slice(8, 12)
  else if (hex.startsWith('52494646')) kind = 'riff'
  else if (hex.startsWith('ffd8ff')) kind = 'jpeg'
  else if (hex.startsWith('89504e47')) kind = 'png'
  else if (hex.startsWith('4f676753')) kind = 'ogg'
  return { kind, hex, ascii }
}

/* codec 四字码/CodecID 的有界扫描：只在前 4MB 与后 4MB 里找（moov 在头或在尾两种排布都覆盖）。 */
const CODEC_TOKENS = ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09', 'vp08', 'mp4v', 'dvh1', 'dvhe']
const MKV_TOKENS = ['V_MPEG4/ISO/AVC', 'V_MPEGH/ISO/HEVC', 'V_AV1', 'V_VP9', 'V_VP8', 'V_MPEG2', 'V_MS/VFW/FOURCC']
function scanTokensAt(file, start, len) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, start)
    const s = buf.subarray(0, n).toString('latin1')
    return [...CODEC_TOKENS.filter((t) => s.includes(t)), ...MKV_TOKENS.filter((t) => s.includes(t))]
  } finally { fs.closeSync(fd) }
}

/* 分块把**一条**条目写到真盘（4MB 复用缓冲 ⇒ 常驻内存与条目大小无关）。 */
function extractEntryChunked(srcFile, idx, entry, dst) {
  const CH = 4 << 20
  const inFd = fs.openSync(srcFile, 'r')
  const outFd = fs.openSync(dst, 'w')
  const buf = Buffer.alloc(CH)
  try {
    let done = 0
    while (done < entry.size) {
      const want = Math.min(CH, entry.size - done)
      const got = fs.readSync(inFd, buf, 0, want, idx.dataStart + entry.off + done)
      if (got <= 0) throw new Error('条目读提前结束 @' + done)
      fs.writeSync(outFd, buf, 0, got)
      done += got
    }
    return done
  } finally { fs.closeSync(inFd); fs.closeSync(outFd) }
}

function ffprobeFile(f) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f],
      { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 })
    const j = JSON.parse(out)
    const v = (j.streams || []).find((s) => s.codec_type === 'video') || {}
    const a = (j.streams || []).find((s) => s.codec_type === 'audio') || {}
    return { ok: true, vcodec: v.codec_name || null, vprofile: v.profile || null, pix: v.pix_fmt || null,
      w: v.width || null, h: v.height || null, fps: v.r_frame_rate || null, acodec: a.codec_name || null,
      dur: j.format && j.format.duration ? +(+j.format.duration).toFixed(2) : null,
      fmt: (j.format && j.format.format_name) || null }
  } catch (e) {
    return { ok: false, err: String((e && e.stderr) || (e && e.message) || e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300) }
  }
}

/* 候选集：库内 `.mpkg`（含 `delete/` 之外的正式库）。自推导，不写字面清单。 */
function candidates() {
  const given = argAll('--pkg')
  if (given.length) return given
  const all = walkContainers(path.join(WS, 'allwallpaper')).filter((p) => /\.mpkg$/i.test(p))
  /* 与 MPKG-SWEEP §2 同口径优先：含 `scene.json` 的（PKGM0014 = 视频 + scene.json）。 */
  const withScene = []
  const noScene = []
  for (const p of all) {
    let has = false
    try { const idx = readIndexHead(p); has = idx.entries.some((e) => e.name === 'scene.json') } catch {}
    ;(has ? withScene : noScene).push(p)
  }
  /* 抽样：等距抽（覆盖不同角色目录），不做"先到先得"（那会全落在一个目录）。 */
  const spread = (arr, k) => {
    const step = Math.max(1, Math.floor(arr.length / Math.max(1, k)))
    const out = []
    for (let i = 0; i < arr.length && out.length < k; i += step) out.push(arr[i])
    return out
  }
  const kScene = Math.min(withScene.length, Math.ceil(N * 0.75))
  return [...spread(withScene, kScene), ...spread(noScene, N - kScene)]
}

const rows = []
const list = candidates()
console.log('== .mpkg 视频编解码器取证 ==')
console.log('· ffprobe: ' + (FF ? '可用' : '**不可用（只能给 magic/令牌候选）**') + ' · 临时目录=' + path.relative(ROOT, TMP))
console.log('· 候选 ' + list.length + ' 个（库内 .mpkg 总数由遍历自推导）')

for (const p of list) {
  const rel = path.relative(path.join(WS, 'allwallpaper'), p)
  const rec = { pkg: rel, entries: null, video: null }
  let tmpFile = null
  try {
    const st = fs.statSync(p)
    rec.size = st.size
    const idx = readIndexHead(p)
    rec.magic = idx.magic
    rec.entries = idx.entries.map((e) => ({ name: e.name, size: e.size }))
    /* `project.json.file` 是页面取视频的那一行（与 demo.html 同源），失败就如实记。 */
    let vfile = '', pj = null
    const pje = idx.entries.find((e) => e.name === 'project.json')
    if (pje) {
      try { pj = JSON.parse(readEntryBytes(p, idx, pje).toString('utf8').replace(/^\uFEFF/, '')) }
      catch (e) { rec.pjErr = String(e.message).slice(0, 80) }
    }
    if (pj) vfile = pj.file || (pj.general && pj.general.file) || ''
    rec.projectFile = vfile || null
    rec.projectType = pj ? (pj.type || null) : null
    rec.hasSceneJson = idx.entries.some((e) => e.name === 'scene.json')
    const byName = idx.entries.find((e) => e.name === vfile)
    /* 兜底：project.json 没给 file 时，取条目里唯一的 mp4/webm（**如实标注**是兜底而非页面口径）。 */
    const vEnt = byName || idx.entries.find((e) => /\.(mp4|webm|mov)$/i.test(e.name))
    if (!vEnt) { rec.err = '容器内无可识别视频条目'; rows.push(rec); console.log('  ⚠ ' + rel + ' — ' + rec.err); continue }
    rec.video = { name: vEnt.name, size: vEnt.size, viaProjectJson: !!byName }
    if (vEnt.size > MAX_ENTRY) {
      rec.err = '视频条目 ' + (vEnt.size / 1048576).toFixed(0) + 'MB 超过 --max-entry-mb（不落盘，避免吃满磁盘）'
      rows.push(rec); console.log('  ⚠ ' + rel + ' — ' + rec.err); continue
    }
    tmpFile = path.join(TMP, 'v' + rows.length + (path.extname(vEnt.name) || '.bin'))
    const wrote = extractEntryChunked(p, idx, vEnt, tmpFile)
    if (wrote !== vEnt.size) throw new Error('落盘字节数不符 ' + wrote + '≠' + vEnt.size)
    const fd = fs.openSync(tmpFile, 'r'); const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd)
    const mg = magicOf(head)
    rec.magicKind = mg.kind
    rec.tokens = { head: scanTokensAt(tmpFile, 0, Math.min(4 << 20, vEnt.size)),
      tail: vEnt.size > (4 << 20) ? scanTokensAt(tmpFile, Math.max(0, vEnt.size - (4 << 20)), Math.min(4 << 20, vEnt.size)) : [] }
    if (FF) rec.probe = ffprobeFile(tmpFile)
    const pr = rec.probe || {}
    console.log('  · ' + rel + '  (' + (rec.size / 1048576).toFixed(1) + 'MB, ' + rec.entries.length + ' 条目)'
      + ' vfile=' + (vfile || '(project.json 无 file)') + ' byPJ=' + rec.video.viaProjectJson
      + ' 视频=' + (rec.video.size / 1048576).toFixed(1) + 'MB ' + rec.magicKind
      + (FF ? (' ⇒ **' + (pr.ok ? (pr.vcodec + (pr.vprofile ? '/' + pr.vprofile : '') + ' ' + pr.w + 'x' + pr.h + ' ' + pr.pix + ' ' + pr.dur + 's')
        : 'ffprobe 失败: ' + pr.err) + '**')
        : (' ⇒ 令牌=[' + [...new Set([...rec.tokens.head, ...rec.tokens.tail])].join(',') + ']'))
      + ' scene.json=' + rec.hasSceneJson)
  } catch (e) {
    rec.err = String((e && e.message) || e).slice(0, 200)
    console.log('  ⛔ ' + rel + ' — ' + rec.err)
  }
  if (tmpFile) { try { fs.unlinkSync(tmpFile) } catch {} }
  rows.push(rec)
}

/* 汇总：编解码器分布（**这是结论行**：若出现 ffprobe 认不得/浏览器不支持的编解码器，rs=0 就是能力而非我们的 bug）。 */
const dist = new Map()
for (const r of rows) {
  const k = r.probe ? (r.probe.ok ? r.probe.vcodec : 'ffprobe失败') : (r.err ? '（读取跳过）' : '未读')
  dist.set(k, (dist.get(k) || 0) + 1)
}
console.log('· 编解码器分布：' + Array.from(dist).map(([k, v]) => k + '×' + v).join(' · '))
console.log('· 含 scene.json 的样本：' + rows.filter((r) => r.hasSceneJson).length + '/' + rows.length + '（PKGM0014 口径 = 视频 + scene.json）')
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ when: new Date().toISOString(), ffprobe: FF, rows }, null, 1)); console.log('· 读数已落盘：' + JSON_OUT) }
fs.rmSync(TMP, { recursive: true, force: true })

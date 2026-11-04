// tex-split-plane-test.mjs —— `format 5` 载荷口径的判据（P-264 平面分离 → ①2026-10-12 ETC2 更正）
//
// ⚠ 现行事实（①2026-10-12。官方依据：官方 arm64 `libscenejni.so` 里 `glCompressedTexImage2D` 的
//   **全库唯一调用点** `0x260a8fc`（`GLTexture::Init`）按 format 分派 —— `format 5 → mov w2,#0x9278`
//   = **GL_COMPRESSED_RGBA8_ETC2_EAC**；同函数 4→0x83f3(DXT5)、6→0x83f2、7→0x83f1、3→0x8d64(ETC1)）：
//     · **缺省档 = ETC2 + EAC alpha 解码**（`case 5: … ? decodeDXT5(…) : __decodeEtc2Rgba8(w, h, data)`
//       的**后**一支）；
//     · **`?tex5=legacy` = 旧的"按 BC3(DXT5) 解"**（本文件此前当作"当前发布口径"、据此钉基线带的那一档）；
//     · **`?texplane=split`（P-264 的平面分离重排）现在只嵌在 legacy 档内部** ⇒ 缺省档下它是**空操作**
//       （C3/C4 用合成载荷的**行为**断言钉死这条关系，不再只看源码文本）。
//
// B 段口径为什么变（2026-10-12：只跟事实走、**不放松强度**）：
//   本文件原先的 [98,110] / [108,122] 是"**缺省按 BC3 解**"时代的读数；缺省改为 ETC2 后同一断言必然红
//   （实测缺省 MAD=2.5 / 5.6）—— 那是"缺省语义变了"，不是"渲染回归"。于是：
//     · 缺省档改钉**新事实**：与 `packages/we-core/src/etc2.js` 的 `decodeEtc2Rgba8` 对同一 mip
//       **逐字节一致**（0 处不同；规范解码器 = 独立、可复核的基准）+ 不透明区 MAD ≤ 30（像图；
//       同一份载荷按 BC3 解 ≈104/115 = 彩色噪声）⇒ 缺省若退回按 BC3 解，两处都会红；
//     · 旧基线带 [98,110] / [108,122] **一字不改地保留为 `?tex5=legacy` 档的断言**，并加一条
//       "legacy 解码 == 内部等价 `decodePixels(4, 同 data)` **逐字节一致**"⇒ 旧路径仍被覆盖，
//       且把开关与旧实现钉在一起（开关坏掉 / 接线被改都会红）。
//
// 原始记录（P-264 当时的口径，保留作历史，勿据此下结论）：
//   ⚠ 2026-10-10：本文件原先记录的"平面分离更好（天空 103.6→4.9）"**无法在同一进程内复现**
//   （同配置重算：天空 407.7 / 丛雨 329.7，而 legacy 分别 113.6 / 122.0），且用户真机目视两版都错
//   ⇒ P-264 已**降级为可选**（`?texplane=split`），**缺省先回到 P-264 之前**（其后缺省又由 ETC2 更正接管）。
//   统一口径三布局对照，10 张 format 5 贴图：
//   · 旧口径（每 16B 块 = alpha@0..7 + color@8..15）在 **10/10** 张上都是最差的（93~137）；
//   · 平面分离（前半 nB*8 = 全部 alpha 块，后半 = 全部 color 块）在 **10/10** 张上都更好，
//     其中 天空 103.6→4.9、树丛1 114.6→13.8、树丛2 98.5→20.4、树丛3 93.0→22.4、纸堆 122.8→18.1。
//   修复 = `reorderSplitPlanes()` 把平面分离重排成既有 16B/块形态（解码算法一行不改）。
//
// 判据：A 段纯函数（合成载荷，逐字节断言）；B 段真语料回归（条件项：样本不在则 SKIP）；
//       C 段接线（C1 源码结构 / C2 开关与主表登记 / C3–C4 三档关系的行为级断言）。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { reorderSplitPlanes, parseTex, decodeMip0, decodePixels } from '../core/we-scene-bundle.js'
import { decodeEtc2Rgba8 } from '../packages/we-core/src/etc2.js'
import { ROOT, WS } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })

/** 逐字节不同的个数（长度不同 ⇒ -1）——"同一份载荷两档解码是否逐位相同"的判据。 */
const byteDiff = (a, b) => {
  if (!a || !b || a.length !== b.length) return -1
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

/** 相邻像素平均差（三通道求和 / 不透明像素对）——越小越像真图；彩色噪声 ≈ 100+（BC3 误读 format 5 的实测值）。 */
function opaqueMad(rgba, w, h) {
  let s = 0, c = 0
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
    const i = (y * w + x) * 4, j = i - 4
    if (rgba[i + 3] > 200 && rgba[j + 3] > 200) {
      s += Math.abs(rgba[i] - rgba[j]) + Math.abs(rgba[i + 1] - rgba[j + 1]) + Math.abs(rgba[i + 2] - rgba[j + 2])
      c++
    }
  }
  return c ? s / c : NaN
}

// A1：2 块（8×4 ⇒ 2×1 块）合成载荷：alpha 平面在前、color 平面在后
const nB = 2, alpha = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18])
const color = Uint8Array.from([101, 102, 103, 104, 105, 106, 107, 108, 201, 202, 203, 204, 205, 206, 207, 208])
const payload = Uint8Array.from([...alpha, ...color])
const out = reorderSplitPlanes(payload, 8, 4)
ok('A1', '平面分离 → 每块 alpha(8)+color(8)', out.length === payload.length
  && Array.from(out.slice(0, 8)).join() === '1,2,3,4,5,6,7,8'
  && Array.from(out.slice(8, 16)).join() === '101,102,103,104,105,106,107,108'
  && Array.from(out.slice(16, 24)).join() === '11,12,13,14,15,16,17,18'
  && Array.from(out.slice(24, 32)).join() === '201,202,203,204,205,206,207,208', '逐字节重排正确')
ok('A2', '长度不匹配 ⇒ 原样返回（旧行为零风险）', (() => { const bad = payload.slice(0, 31); return reorderSplitPlanes(bad, 8, 4) === bad })() && reorderSplitPlanes(null, 4, 4) === null, 'passthrough ok')
ok('A3', '非 4 对齐尺寸的块数按 ceil 计算', reorderSplitPlanes(new Uint8Array(2 * 16), 5, 5).length === 32, 'ceil ok')

// ---------------------------------------------------------------- C 段：接线（源码结构 + 行为）
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const src = fs.readFileSync(BUNDLE, 'utf8')

/* C1 源码结构：取出 `case 5:` 与 `case 6:` 之间的那条 return，**去注释 + 压空白**后核对关键令牌与**顺序**。
   为什么必须断言顺序：旧行为与新事实的唯一差别就是"谁在缺省位"——
     旧：缺省 `decodeDXT5(data)`（= BC3）；新：缺省 `__decodeEtc2Rgba8(w, h, data)`（= ETC2+EAC）。
   只查"源码里出现过 ETC2"会被"两档写反 / 加了开关但缺省没换"骗过 ⇒ 顺序 + 三元结构一起断言。 */
const case5 = (() => {
  const m = /case 5:([\s\S]*?)\n\s*case 6:/.exec(src)
  if (!m) return ''
  return m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()
})()
{
  const iGate = case5.indexOf('TEX5_LEGACY')
  const iBc3 = case5.indexOf('decodeDXT5')
  const iSplit = case5.indexOf('TEXPLANE_SPLIT')
  const iEtc2 = case5.indexOf('__decodeEtc2Rgba8')
  ok('C1', '接线（源码）：format 5 **缺省走 ETC2**（`__decodeEtc2Rgba8`）；`?tex5=legacy` 才回到旧的 BC3，'
    + 'P-264 的 `?texplane=split` 重排**只嵌在 legacy 档内**',
  iGate >= 0 && iBc3 > iGate && iSplit > iBc3 && iEtc2 > iSplit
    && /TEXPLANE_SPLIT \? reorderSplitPlanes\(data, w, h\) : data/.test(case5)
    && /__decodeEtc2Rgba8\(w, h, data\)/.test(case5),
  case5 ? '令牌位置 legacy@' + iGate + ' bc3@' + iBc3 + ' split@' + iSplit + ' etc2@' + iEtc2 : '未找到 case 5 分支')
}
/* C2 开关登记：两个开关都要"读得到 + 主表有行"（`diag-flag-check` 对未登记的 URL 开关判红）。 */
{
  const diag = fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8')
  const row = (f) => new RegExp('^\\| `' + f + '` \\|', 'm').test(diag)
  ok('C2', '开关：`?tex5=legacy`（回退到旧 BC3 口径）与 `?texplane=split`（仅 legacy 档内的重排）都读 URL 且都登记在主表',
    /get\('tex5'\) === 'legacy'/.test(src) && /get\('texplane'\) === 'split'/.test(src) && row('tex5') && row('texplane'),
    'tex5 行=' + row('tex5') + ' texplane 行=' + row('texplane'))
}
/* C3/C4 行为级三档关系：URL 开关是**模块级常量**（模块求值时读一次 `location.search`），同一 URL 再 import
   只会拿到缓存实例 ⇒ 用「伪 `location` + 带 query 的模块 URL」拿到"浏览器里带该开关"的**独立实例**
   （Node 的 ESM 把 `file://…/we-scene-bundle.js?q` 当不同模块各自求值一次）。
   伪 location 只在这些实例加载期间存在，加载后按原描述符还原/删除；缺省档用顶部那个**无 location** 的
   静态实例（= Node 判据里既有的"缺省档"语义，也是 B 段语料走的同一支）。 */
const FAKE_LOCATION = (search) => ({
  search, href: 'http://localhost/' + search, pathname: '/', protocol: 'http:',
  host: 'localhost', hostname: 'localhost', origin: 'http://localhost',
})
const prevLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
const loadVariant = async (search) => {
  globalThis.location = FAKE_LOCATION(search)
  return import(pathToFileURL(BUNDLE).href + search)
}
const splitOnly = await loadVariant('?texplane=split')                 // 只带重排开关
const legacyOnly = await loadVariant('?tex5=legacy')                   // 旧 BC3 档
const legacySplit = await loadVariant('?tex5=legacy&texplane=split')   // 旧 BC3 + 重排
if (prevLocation) Object.defineProperty(globalThis, 'location', prevLocation)
else delete globalThis.location
/* 合成载荷 8×4 = 2 块（16B/块，ETC2 与 BC3 同块尺寸）；字节用 `i*37+11` 造**非对称**值：
   平面分离重排会把前后两块互换 ⇒ "重排生效 / 不生效"在这份载荷上可区分（恒等载荷会退化成假绿）。 */
const blk = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff)
const blkReordered = reorderSplitPlanes(blk, 8, 4)
{
  const etc2Gold = decodeEtc2Rgba8(8, 4, blk)
  const defEtc2 = decodePixels(5, blk, 8, 4)
  const splitEtc2 = splitOnly.decodePixels(5, blk, 8, 4)
  ok('C3', '行为（合成 8×4）：缺省 format 5 **逐字节 == `decodeEtc2Rgba8`**；只带 `?texplane=split` 时'
    + '**与缺省逐字节相同**（缺省档下重排是空操作）',
  byteDiff(defEtc2, etc2Gold) === 0 && byteDiff(splitEtc2, defEtc2) === 0 && byteDiff(blkReordered, blk) !== 0,
  '缺省 vs 规范解码器 diff=' + byteDiff(defEtc2, etc2Gold)
    + ' / split 档 vs 缺省 diff=' + byteDiff(splitEtc2, defEtc2)
    + ' / 重排自身 diff=' + byteDiff(blkReordered, blk) + '（≠0 ⇒ 本载荷可分辨）')
  const legBc3 = legacyOnly.decodePixels(5, blk, 8, 4)
  const legSplitBc3 = legacySplit.decodePixels(5, blk, 8, 4)
  ok('C4', '行为（合成 8×4）：`?tex5=legacy` **逐字节 == 旧的 `decodePixels(4, data)`**；'
    + '`?tex5=legacy&texplane=split` == `decodePixels(4, 重排后)`',
  byteDiff(legBc3, decodePixels(4, blk, 8, 4)) === 0
    && byteDiff(legSplitBc3, decodePixels(4, blkReordered, 8, 4)) === 0
    && byteDiff(legBc3, legSplitBc3) !== 0,
  'legacy vs BC3 diff=' + byteDiff(legBc3, decodePixels(4, blk, 8, 4))
    + ' / legacy+split vs BC3(重排) diff=' + byteDiff(legSplitBc3, decodePixels(4, blkReordered, 8, 4))
    + ' / 两档相差 ' + byteDiff(legBc3, legSplitBc3) + ' 字节')
}

// ---------------------------------------------------------------- B 段：真语料回归（条件项）
/* 样本路径**不得写成字面绝对路径**（publish-check 红线：公开仓库不带操作环境信息）：
   用运行时工作区根（_root.mjs 的 WS）+ 相对语料路径拼出来。 */
const SAMPLE = path.join(WS, 'allwallpaper', '1004', '夜莺night——【parallax_视差】blue_archive_妃咲_kisaki_月下独酌【蔚蓝档案】.mpkg')
if (!fs.existsSync(SAMPLE)) {
  console.log('  ⏭ B 段 SKIP（样本不在本机）')
} else {
  const b = fs.readFileSync(SAMPLE); let o = 0
  const ml = b.readUInt32LE(o); o += 4 + ml
  const n = b.readUInt32LE(o); o += 4
  const ents = []
  for (let i = 0; i < n; i++) { const nl = b.readUInt32LE(o); o += 4; const nm = b.toString('utf8', o, o + nl); o += nl; const off = b.readUInt32LE(o); const size = b.readUInt32LE(o + 4); o += 8; if (nm.endsWith('.tex')) ents.push({ nm, off, size }) }
  const start = o
  for (const [want, lo, hi] of [['天空.tex', 98, 110], ['树丛1.tex', 108, 122]]) {
    /* lo/hi = **`?tex5=legacy` 档（= P-264 之前的 BC3 口径）的基线带**，阈值沿用旧值、一字不改。 */
    const hit = ents.find((e) => e.nm.endsWith(want))
    if (!hit) { ok('B' + want, '样本条目存在', false, '未找到 ' + want); continue }
    const buf = b.subarray(start + hit.off, start + hit.off + hit.size)
    const tex = parseTex(buf)
    const m = tex.images[0][0]
    const im = decodeMip0(tex)                 // 缺省档（= ETC2；Node 无 location ⇒ 不走任何回退开关）
    const need = Math.ceil(im.width / 4) * Math.ceil(im.height / 4) * 16
    ok('B' + want + ' 长度', want + ' 是 format 5 且 mip 载荷 == ceil(w/4)·ceil(h/4)·16（ETC2 与 BC3 同块尺寸 ⇒ 长度校验抓不到格式错）',
      tex.format === 5 && m.data.length === need, `format=${tex.format} ${im.width}x${im.height} bytes=${m.data.length} vs ${need}`)
    /* 缺省档 = ETC2 的两条独立断言：
       ① 与规范解码器 `decodeEtc2Rgba8` **逐字节一致**（最强：任何像素差都会红，且能指出差在哪）；
       ② 不透明区 MAD ≤ 30（像图；同载荷按 BC3 解 ≈104/115 ⇒ 指标本身有分辨力，兼作自证）。 */
    const etc2 = decodeEtc2Rgba8(im.width, im.height, m.data)
    const dDiff = byteDiff(im.rgba, etc2)
    const dMad = opaqueMad(im.rgba, im.width, im.height)
    const bc3Mad = opaqueMad(decodePixels(4, m.data, im.width, im.height), im.width, im.height)
    ok('B' + want + ' 缺省=ETC2', want + ' 缺省档 == `decodeEtc2Rgba8` 逐字节一致 + MAD ≤ 30（像图）',
      dDiff === 0 && dMad <= 30 && bc3Mad > 60,
      `diff=${dDiff} MAD=${dMad.toFixed(1)}（同载荷按 BC3 解 MAD=${bc3Mad.toFixed(1)} ⇒ 自证有分辨力）`)
    /* legacy 档 = 旧 BC3 口径：旧基线带原样保留 + 与内部等价 `decodePixels(4, 同 data)` 逐字节一致
       ⇒ 旧路径仍被覆盖；开关坏掉或接线被改都会红。 */
    const leg = legacyOnly.decodeMip0(legacyOnly.parseTex(buf))
    const lDiff = byteDiff(leg.rgba, decodePixels(4, m.data, im.width, im.height))
    const lMad = opaqueMad(leg.rgba, im.width, im.height)
    ok('B' + want + ' legacy', want + ' `?tex5=legacy` 档仍落旧基线带 [' + lo + ',' + hi + ']（P-264 之前 = BC3 口径）',
      lMad >= lo && lMad <= hi && lDiff === 0 && leg.width === im.width && leg.height === im.height,
      `MAD=${lMad.toFixed(1)} legacy==BC3(data) diff=${lDiff}`)
  }
}

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== tex-split-plane: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)

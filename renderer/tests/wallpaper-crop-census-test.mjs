// wallpaper-crop-census-test.mjs —— ①「壁纸画面四周被切」的**只读**全语料普查 + 判据
//
// 背景（用户实测原话）：「丛雨.mpkg 这个壁纸的上下左右各被切掉了一部分」+「检查有没有其他壁纸也会被切」。
//
// 它量什么：对每个能拿到 scene.json 的包，用**渲染器自己的** `parseScene` + `buildCamera`
//   （`core/we-scene-bundle.js`，只读 import）算出：
//     · 设计画布 `general.orthogonalprojection`（缺省 1920×1080）；
//     · 相机取景窗口 `framedW/framedH`（buildCamera 在给定画布盒宽高比下的输出）；
//     · **画布裁切** = 设计画布被取景窗口切掉的比例（每边 %）—— 作者设计区被切；
//     · **内容裁切** = 可见层实绘包围盒被取景窗口切掉的比例（每边 %）—— 作者内容被切；
//   两个读数都只在 >0.5% 时算「这一边被切」。
//
// 为什么画布盒宽高比默认 16:9：`demo.html` 的 `fitCanvas()` 把画布 **CSS 盒**取成"窗口内最大的
//   16:9 盒"（`demo.html:395-406`），`applyLiveNow` 再按它算绘制缓冲（等比收缩、宽高比不变，
//   `core/we-scene-bundle.js:11146-11173`）⇒ 取景窗口的比例**只由"设计画布比例 vs 16:9"决定**，
//   与窗口实际大小无关。真机读数印证：`:8902` 实时壁纸的 `videoStats.canvas = 1832x1030`
//   （1.77864 ≈ 16:9；见 `/api/diag-stream`）。
//
// 判据（任一不满足 → 退出码 1；`--selftest` 只跑 S*）：
//   S1 自证·四档可区分：合成输入下 verdict() 必须分别给出 none / 两边 / 四边 / 两边（竖幅）四种结论
//      —— 证明"四边被切"这一档**可达**（不是永远绿的假判据）。
//   S2 自证·对实现敏感：同一合成输入把 fillmode 换 stretch ⇒ 结论必须从"被切"翻成 none
//      —— 证明读数跟踪的是取景实现，而不是常量。
//   S3 自证·zoom 敏感：zoom=2 ⇒ 必须出现四边被切（这是 16:9 画布在 16:9 盒下**唯一**能得到
//      "四周各切一点"的机制）。
//   C1 对照·已知未切：`1004/丛雨.mpkg`（3840×2160 = 16:9）在 16:9 盒下四边裁切都 < 0.1%
//      （真机盒 1832×1030 的偶偶取整给出 0.02% ≈ 0.5px）。
//   C2 对照·已知被切：`wallpaperE/白洲梓/白洲梓1_04.mpkg`（1080×1920 竖幅）必须左右 0、上下各 > 5%
//      （实测 34.19%）⇒ 反方向也有读数。
//   C3 普查非空：全语料里"设计画布被切"与"内容四边被切"两类计数都必须 > 0（否则判据退化成永绿）。
//   C4 真实输入变异：把画布盒比例改成 16:10 后，丛雨的结论必须从 none 翻成"左右被切"
//      —— 证明判据对**真实语料 + 真实参数**的变化敏感。
//   C5 变异对照：同一批样本强制 `fillmode=stretch`（无取景裁切）⇒ C2 的"已知被切"样本必须变绿；
//      若仍报被切，说明读数不是由取景算出来的 ⇒ 红。
//
// 用法：
//   node tests/wallpaper-crop-census-test.mjs                       # 全语料普查（默认 <工作区>/allwallpaper）
//   node tests/wallpaper-crop-census-test.mjs --selftest             # 只跑 S1–S3（纯合成，秒级）
//   node tests/wallpaper-crop-census-test.mjs --corpus=<dir> --box=1832x1030 --json=<file>
//   node tests/wallpaper-crop-census-test.mjs --max-bytes=0          # 不限制单包字节（默认 96MB）
//
// 纪律：**只读**。不改 core / 不落盘（除非显式 `--json=`）；所有路径由 `_root.mjs` 的 WS 推导或命令行给出。
import fs from 'node:fs'
import path from 'node:path'
import { WS } from './_root.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const arg = (n) => {
  const eq = argv.find((a) => a.startsWith('--' + n + '='))
  if (eq) return eq.slice(n.length + 3)
  const i = argv.indexOf('--' + n)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const has = (n) => argv.includes('--' + n)
const SELFTEST = has('selftest')
const CORPUS = path.resolve(arg('corpus') || process.env.MPW_CORPUS || path.join(WS, 'allwallpaper'))
/* 画布盒口径（①-A P-339 的**双档**，两个档位在**同一次运行**里都算 ⇒ 写死任一档另一档必红）：
     `--fit=design`（缺省｜**改动后**：`fitCanvas` 让盒比例跟随设计画布 `general.orthogonalprojection`）
     `--fit=box169`（**改动前**：盒恒为"窗口内最大的 16:9 盒"）
   `--box=WxH` 显式给盒时两档同值（留给"变异/真实参数"判据，例如 `--box=1920x1200`）。 */
const FIT = (() => { const v = String(arg('fit') || 'design').trim().toLowerCase(); return (v === 'box169' || v === '16x9' || v === 'legacy') ? 'box169' : 'design' })()
const BOX_ARG = (() => { const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(arg('box') || '')); return m ? { w: Number(m[1]), h: Number(m[2]) } : null })()
const BOX169 = { w: 1832, h: 1030 }   // 真机 :8902 实时读数：窗口内最大的 16:9 盒
const boxFor = (sw, sh) => BOX_ARG
  ? { w: BOX_ARG.w, h: BOX_ARG.h, src: 'arg/--box（两档同值）' }
  : (FIT === 'box169'
    ? { w: BOX169.w, h: BOX169.h, src: '--fit=box169（改动前口径）' }
    : { w: 1000, h: Math.max(2, 1000 / (sw / sh)), src: '--fit=design（改动后口径：盒比例 = 设计比例）' })
const JSON_OUT = arg('json')
const MAX_BYTES = (() => { const v = arg('max-bytes'); const n = v === null ? 96 * 1024 * 1024 : Number(v); return Number.isFinite(n) && n > 0 ? n : Infinity })()
const LIMIT = (() => { const v = Number(arg('limit')); return Number.isFinite(v) && v > 0 ? v : Infinity })()
const CUT_EPS = 0.5   // 单边 > 0.5% 才算"这一边被切"

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const sides = (cut) => ['L', 'R', 'T', 'B'].filter((k) => cut[k] > CUT_EPS)
const fmt = (cut) => ['L', 'R', 'T', 'B'].map((k) => (cut[k] || 0).toFixed(2) + '%').join('/')

/* ── 纯几何：给定设计画布 + 取景窗口，算"画布被切"与"内容被切"的每边比例（可被合成输入直测） ── */
export function cutOfWindow(sw, sh, fw, fh, rect) {
  const vl = sw / 2 - fw / 2, vr = sw / 2 + fw / 2, vt = sh / 2 - fh / 2, vb = sh / 2 + fh / 2
  const r = rect || { minX: 0, minY: 0, maxX: sw, maxY: sh }
  const cw = Math.max(1e-6, r.maxX - r.minX), ch = Math.max(1e-6, r.maxY - r.minY)
  return {
    canvas: { L: Math.max(0, vl) / sw * 100, R: Math.max(0, sw - vr) / sw * 100, T: Math.max(0, vt) / sh * 100, B: Math.max(0, sh - vb) / sh * 100 },
    content: { L: Math.max(0, vl - r.minX) / cw * 100, R: Math.max(0, r.maxX - vr) / cw * 100, T: Math.max(0, vt - r.minY) / ch * 100, B: Math.max(0, r.maxY - vb) / ch * 100 },
    window: { l: vl, r: vr, t: vt, b: vb },
  }
}

/* ── 纯几何：ASPECTCROP/ASPECTFIT/STRETCH/CENTER 的取景窗口（与 buildCamera 同式，供自证用） ── */
export function framedOf(sw, sh, boxW, boxH, fillmode = 'aspectcrop', zoom = 1) {
  let fw = sw, fh = sh
  if (boxW > 0 && boxH > 0) {
    const fboAspect = boxW / boxH, sAspect = sw / sh
    const fitLike = fboAspect < sAspect
    const fm = String(fillmode || 'aspectcrop').toLowerCase()
    if (fm === 'stretch') { fw = sw; fh = sh }
    else if (fm === 'aspectfit') { if (fitLike) { fw = sw; fh = sw / fboAspect } else { fw = sh * fboAspect; fh = sh } }
    else if (fm === 'center') { fw = boxW; fh = boxH }
    else { if (fitLike) { fw = sh * fboAspect; fh = sh } else { fw = sw; fh = sw / fboAspect } }
    const z = (typeof zoom === 'number' && zoom > 0.0001) ? zoom : 1
    fw = Math.max(1, fw / z); fh = Math.max(1, fh / z)
  }
  return { fw, fh }
}

/* ── 判据自证（纯合成输入；不需要语料、不需要浏览器） ── */
function selftest() {
  const box169 = { w: 1832, h: 1030 }        // 真机实测盒（≈16:9）
  const box1610 = { w: 1920, h: 1200 }       // 本机桌面 1920×1200（X11 截图证据）
  const boxPortrait = { w: 1080, h: 1920 }
  const kind = (sw, sh, box, opts) => {
    const f = framedOf(sw, sh, box.w, box.h, opts && opts.fillmode, opts && opts.zoom)
    const c = cutOfWindow(sw, sh, f.fw, f.fh)
    const s = sides(c.canvas)
    return { f, c, s, verdict: s.length === 0 ? 'none' : (s.length === 4 ? 'four' : 'two') }
  }
  // S1 四档可区分（含"四边被切"可达）
  const a = kind(3840, 2160, box169)                    // 16:9 @ 16:9 → none
  const b = kind(3840, 2160, box1610)                   // 16:9 @ 16:10 → 左右
  const c = kind(3840, 2160, box169, { zoom: 2 })       // zoom 2 → 四边
  const d = kind(1080, 1920, box169)                    // 竖幅 @ 16:9 → 上下
  ok(a.verdict === 'none', 'S1a 16:9 设计 @16:9 盒 ⇒ 未切', 'framed=' + a.f.fw.toFixed(1) + 'x' + a.f.fh.toFixed(1) + ' 画布切=' + fmt(a.c.canvas))
  ok(b.verdict === 'two' && b.s.join() === 'L,R', 'S1b 16:9 设计 @16:10 盒 ⇒ 左右被切（两边）', '画布切=' + fmt(b.c.canvas))
  ok(c.verdict === 'four', 'S1c 16:9 设计 @16:9 盒 + zoom=2 ⇒ **四边被切**（该档可达）', 'framed=' + c.f.fw.toFixed(1) + 'x' + c.f.fh.toFixed(1) + ' 画布切=' + fmt(c.c.canvas))
  ok(d.verdict === 'two' && d.s.join() === 'T,B', 'S1d 竖幅 1080×1920 @16:9 盒 ⇒ 上下被切（两边）', '画布切=' + fmt(d.c.canvas))
  ok(new Set([a.verdict, b.verdict, c.verdict, d.verdict]).size >= 3, 'S1e 四档结论不是常量（至少三种不同结论）', JSON.stringify([a.verdict, b.verdict, c.verdict, d.verdict]))
  // S2 对实现敏感：同输入换 stretch ⇒ 必须变 none
  const bStretch = kind(3840, 2160, box1610, { fillmode: 'stretch' })
  ok(bStretch.verdict === 'none', 'S2 fillmode=stretch ⇒ 同一 16:10 输入必须翻成未切（读数跟着实现走）', '画布切=' + fmt(bStretch.c.canvas))
  // S3 zoom 敏感（放大才可能四周都切）
  ok(c.c.canvas.T > CUT_EPS && c.c.canvas.L > CUT_EPS, 'S3 zoom=2 时四边读数都 > 阈值', fmt(c.c.canvas))
  ok(a.c.canvas.T < 0.1 && a.c.canvas.L < 0.1, 'S3b zoom=1 时同输入读数 ≈ 0（对照）', fmt(a.c.canvas))
}

/* ── 语料普查 ── */
function listPkgs(root) {
  const out = []
  const walk = (d) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(mpkg|pkg)$/i.test(e.name)) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

async function census() {
  const { parsePkg, readPkgEntry, entryNames, getEntry } = await import(path.join(REPO, 'packages/we-core/src/pkg.js'))
  const lib = await import(path.join(REPO, 'core/we-scene-bundle.js'))
  const files = listPkgs(CORPUS)
  console.log('语料根: ' + CORPUS)
  console.log('画布盒档位: --fit=' + FIT + (BOX_ARG ? '（--box=' + BOX_ARG.w + 'x' + BOX_ARG.h + ' 覆盖，两档同值）' : (FIT === 'box169' ? '（盒恒 ' + BOX169.w + 'x' + BOX169.h + ' = 改动前口径）' : '（盒比例 = 各场景设计画布比例 = 改动后口径）')))
  console.log('容器数: ' + files.length + '（单包上限 ' + (MAX_BYTES === Infinity ? '无' : Math.round(MAX_BYTES / 1048576) + 'MB') + '）')
  const rows = []
  const sceneCache = new Map()      // file → 解析后的 scene（只给判据 C4 复用，不写进 JSON）
  let n = 0
  for (const f of files) {
    if (n >= LIMIT) break
    const rel = path.relative(CORPUS, f)
    let rec = { file: rel }
    try {
      const st = fs.statSync(f)
      if (st.size > MAX_BYTES) { rec.skip = 'size>' + Math.round(MAX_BYTES / 1048576) + 'MB'; rows.push(rec); continue }
      n++
      const pkg = parsePkg(new Uint8Array(fs.readFileSync(f)))
      const names = entryNames(pkg)
      const sj = names.find((x) => x === 'scene.json') || names.find((x) => /(^|\/)scene\.json$/.test(x))
      if (!sj) { rec.skip = 'no scene.json'; rows.push(rec); continue }
      const ent = pkg.entries.find((x) => (x.name || x.path) === sj)
      const j = JSON.parse(Buffer.from(readPkgEntry(pkg, ent)).toString('utf8').replace(/^\uFEFF/, ''))
      const scene = lib.parseScene(j, null, { attachCtx: { readEntry: (nm) => getEntry(pkg, nm), time: 0 } })
      const op = (scene.general && scene.general.orthogonalprojection) || null
      const sw = (op && Number(op.width) > 0) ? Number(op.width) : 1920
      const sh = (op && Number(op.height) > 0) ? Number(op.height) : 1080
      const box = boxFor(sw, sh)
      const cam = lib.buildCamera(scene, box.w, box.h, {})
      // 修前档（盒恒 16:9）永远同时算一份 ⇒ 双档读数在同一次运行里都在（C2/C3a/C6 用它做反向对照）
      const box169Now = (Math.abs(box.w / box.h - 16 / 9) < 1e-9)
      const cam169 = box169Now ? cam : lib.buildCamera(scene, BOX169.w, BOX169.h, {})
      // 可见内容包围盒（跳过容器层；无正尺寸的层不参与）
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, drawable = 0, text = 0
      for (const l of scene.layers) {
        if (l.isContainer) continue
        if (l.__text) text++
        if (!l.visible) continue
        const w = Math.abs((l.size && l.size[0]) || 0) * Math.abs((l.scale && l.scale[0]) || 1)
        const h = Math.abs((l.size && l.size[1]) || 0) * Math.abs((l.scale && l.scale[1]) || 1)
        if (!(w > 0) || !(h > 0)) continue
        minX = Math.min(minX, l.origin[0] - w / 2); maxX = Math.max(maxX, l.origin[0] + w / 2)
        minY = Math.min(minY, l.origin[1] - h / 2); maxY = Math.max(maxY, l.origin[1] + h / 2)
        drawable++
      }
      const rect = drawable > 0 ? { minX, minY, maxX, maxY } : null
      const cut = cutOfWindow(sw, sh, cam.framedW, cam.framedH, rect)
      const cut169 = box169Now ? cut : cutOfWindow(sw, sh, cam169.framedW, cam169.framedH, rect)
      sceneCache.set(rel, scene)
      const cs = sides(cut.canvas), ks = rect ? sides(cut.content) : []
      rows.push(Object.assign(rec, {
        canvas: [sw, sh], framed: [+cam.framedW.toFixed(2), +cam.framedH.toFixed(2)], box: [box.w, +box.h.toFixed(2)], boxSrc: box.src, fit: FIT,
        cut: Object.fromEntries(['L', 'R', 'T', 'B'].map((k) => [k, +cut.canvas[k].toFixed(2)])),
        cut169: Object.fromEntries(['L', 'R', 'T', 'B'].map((k) => [k, +cut169.canvas[k].toFixed(2)])),
        cut169Sides: sides(cut169.canvas),
        contentCut: Object.fromEntries(['L', 'R', 'T', 'B'].map((k) => [k, +cut.content[k].toFixed(2)])),
        contentBBox: rect ? [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)] : null,
        canvasSides: cs, contentSides: ks, drawable, text, layers: scene.layers.length,
      }))
    } catch (e) { rec.skip = 'ERR ' + String((e && e.message) || e).slice(0, 90); rows.push(rec) }
  }
  const withScene = rows.filter((r) => r.canvas)
  console.log('解析成功: ' + withScene.length + ' / ' + rows.length + '（其余：视频/web 包或无 scene.json）')
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1)); console.log('读数已写: ' + JSON_OUT) }
  console.log('')
  console.log('【A】设计画布 ≠ 16:9 ⇒ 相机把设计画布切掉（左列 = 改动后档 `--fit=design`，右列 = 改动前档 `--fit=box169`）')
  const two = withScene.filter((r) => r.cut169Sides.length === 2).sort((a, b) => Math.max(...Object.values(b.cut169)) - Math.max(...Object.values(a.cut169)))
  console.log('  改动前档被切数量: ' + two.length + ' / ' + withScene.length
    + '；改动后档被切数量: ' + withScene.filter((r) => r.canvasSides.length > 0).length + ' / ' + withScene.length)
  for (const r of two.slice(0, 10)) {
    console.log('   canvas=' + String(r.canvas.join('x')).padEnd(11)
      + ' 改后切=' + fmt(r.cut).padEnd(28) + ' 改前切=' + fmt(r.cut169).padEnd(28) + ' ' + r.file.slice(0, 42))
  }
  console.log('')
  console.log('【B】作者内容超出设计画布 ⇒ 内容四边都被切（画布本身不切）')
  const four = withScene.filter((r) => r.contentSides.length === 4).sort((a, b) => Math.max(...Object.values(b.contentCut)) - Math.max(...Object.values(a.contentCut)))
  console.log('  数量: ' + four.length + ' / ' + withScene.length)
  for (const r of four.slice(0, 10)) console.log('   canvas=' + String(r.canvas.join('x')).padEnd(11) + ' 内容切 L/R/T/B=' + fmt(r.contentCut) + '  内容盒=' + JSON.stringify(r.contentBBox) + '  ' + r.file.slice(0, 40))
  console.log('')
  console.log('【C】用户实测样本')
  for (const pat of [/丛雨/, /白洲梓1_04/, /藤田ことね/]) {
    for (const r of withScene.filter((x) => pat.test(x.file))) {
      console.log('   ' + r.file.slice(0, 46).padEnd(48) + ' canvas=' + String(r.canvas.join('x')).padEnd(11) + ' 画布切=' + fmt(r.cut) + ' 内容切=' + fmt(r.contentCut))
    }
  }
  return { rows, withScene, two, four, sceneCache, lib }
}

/* ── 主流程 ── */
console.log('══ wallpaper-crop-census ══（只读；不改 core / 不写语料）')
selftest()
if (SELFTEST) {
  console.log('\n--selftest：只跑判据自证。')
  console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail)
  process.exit(fail ? 1 : 0)
}
const { withScene, two, four, sceneCache, lib } = await census()
const pick = (re) => withScene.find((r) => re.test(r.file))

console.log('\n【判据】')
const control = pick(/1004[/\\]丛雨\.mpkg$/)
if (!control) {
  ok(false, 'C1 对照·已知未切（1004/丛雨.mpkg）—— 语料里没找到这个包', '语料根=' + CORPUS)
} else {
  const m = Math.max(...Object.values(control.cut))
  ok(m < 0.1, 'C1 对照·已知未切 丛雨（3840×2160=16:9）四边裁切 < 0.1%', '读数 ' + fmt(control.cut) + '（内容 ' + fmt(control.contentCut) + '）')
}
const known = pick(/白洲梓1_04\.mpkg$/)
if (!known) {
  ok(false, 'C2 对照·已知被切（白洲梓1_04.mpkg）—— 语料里没找到这个包', '语料根=' + CORPUS)
} else {
  ok(known.cut169.L < 0.1 && known.cut169.R < 0.1 && known.cut169.T > 5 && known.cut169.B > 5,
    'C2 对照·已知被切 白洲梓1_04（1080×1920 竖幅）@改动前档（盒 16:9）⇒ 左右 0、上下各 > 5%',
    '读数 ' + fmt(known.cut169))
}
ok(two.length > 0, 'C3a 改动前档"设计画布被切"计数 > 0（判据没退化成永绿）', 'n=' + two.length)
ok(four.length > 0, 'C3b 全语料"内容四边被切"计数 > 0', 'n=' + four.length)
// C4 真实输入变异：换 16:10 盒，丛雨必须从 none 翻成"左右被切"；且**渲染器自己的 buildCamera**
//    在同一输入下必须与上面的纯几何同式（判据与实现耦合，不是各算各的）。
if (control) {
  const sc = sceneCache.get(control.file)
  const alt = framedOf(control.canvas[0], control.canvas[1], 1920, 1200, 'aspectcrop', 1)
  const altCut = cutOfWindow(control.canvas[0], control.canvas[1], alt.fw, alt.fh)
  ok(sides(altCut.canvas).join() === 'L,R' && altCut.canvas.L > 4,
    'C4 真实输入变异：丛雨 @16:10 盒 ⇒ 翻成"左右各被切"（对真实参数敏感）',
    '16:10 framed=' + alt.fw.toFixed(1) + 'x' + alt.fh.toFixed(1) + ' 画布切=' + fmt(altCut.canvas))
  if (sc) {
    const camAlt = lib.buildCamera(sc, 1920, 1200, {})
    const same = Math.abs(camAlt.framedW - alt.fw) < 0.51 && Math.abs(camAlt.framedH - alt.fh) < 0.51
    ok(same, 'C4b 纯几何与渲染器 buildCamera 在 16:10 盒下读数一致（±0.5px）',
      'buildCamera=' + camAlt.framedW.toFixed(2) + 'x' + camAlt.framedH.toFixed(2) + ' vs 纯几何=' + alt.fw.toFixed(2) + 'x' + alt.fh.toFixed(2))
  } else {
    ok(false, 'C4b 纯几何 vs buildCamera 一致性 —— 拿不到丛雨的解析 scene', 'file=' + control.file)
  }
}
// C5 变异对照：stretch 下"已知被切"必须变绿
if (known) {
  const s = framedOf(known.canvas[0], known.canvas[1], BOX169.w, BOX169.h, 'stretch', 1)
  const sCut = cutOfWindow(known.canvas[0], known.canvas[1], s.fw, s.fh)
  ok(sides(sCut.canvas).length === 0, 'C5 变异对照：fillmode=stretch ⇒ 已知被切样本必须变未切（读数跟着取景实现走）', '画布切=' + fmt(sCut.canvas))
}
/* ── C6/C7 ①-A(P-339) **双档**：改动后档（盒比例=设计比例）必须 0 切；改动前档必须 > 0 切。
   两档在**同一次运行**里各断言一次 ⇒ 谁把某一档写死（例如"永远 0"或"永远 >0"），另一档必红。
   接线侧的证明（`fitCanvas` 真的按设计比例给盒、固定档真的按比例重算）在
   `tests/canvas-fit-and-csz-test.mjs` 的 A1/A7b —— 本文件只读几何，不假装读过浏览器。 */
if (FIT === 'design' && !BOX_ARG) {
  const cutAfter = withScene.filter((r) => r.canvasSides.length > 0)
  ok(cutAfter.length === 0,
    'C6 ①-A 双档·改后（盒比例=设计比例）⇒ 全语料"设计画布被切"必须 == 0（26 → 0）',
    '改后=' + cutAfter.length + ' / ' + withScene.length + (cutAfter.length ? '，首个=' + cutAfter[0].file : ''))
  ok(two.length > 0,
    'C7 ①-A 双档·改前（盒恒 16:9，同一次运行的反向读数）⇒ 必须 > 0（否则判据是同义反复）',
    '改前=' + two.length + '，最狠 ' + (two[0] ? (two[0].canvas.join('x') + ' ' + fmt(two[0].cut169)) : '-'))
} else {
  console.log('SKIP C6/C7 —— 仅在 `--fit=design`（无 `--box=` 覆盖）下做双档对拍；当前 fit=' + FIT + (BOX_ARG ? ' box=' + BOX_ARG.w + 'x' + BOX_ARG.h : ''))
}
/* ── C8 双档·竖幅样本：改后 0.00% / 改前 34.19%（同一条读数链上的两个方向） ── */
if (known && FIT === 'design' && !BOX_ARG) {
  const afterMax = Math.max(...Object.values(known.cut))
  const beforeMax = Math.max(...Object.values(known.cut169))
  ok(afterMax < 0.05 && beforeMax > 30,
    'C8 ①-A 双档·竖幅 1080×1920：改后 0.00% / 改前 34.19%（>30%）',
    '改后 ' + fmt(known.cut) + ' / 改前 ' + fmt(known.cut169))
}
console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)

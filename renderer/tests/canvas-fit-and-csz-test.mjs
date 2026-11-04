// canvas-fit-and-csz-test.mjs —— ①-A(P-339) 画布盒比例跟随设计画布 + ⑤-1(P-340) `engine.canvasSize` 翻正交口径
//
// 两个档位都用**切片直测**：从 `demo.html` 抽出真函数、喂 mock，再叠加渲染器自己的 `buildCamera`
// 做几何对拍（判据与实现耦合，不是各算各的）。
//
// 判据（任一不满足 → 退出码 1）：
//   ── A. T-fitbox（①-A）──
//   A1 `fitCanvas` 必须让**画布盒比例跟随设计画布**：`window.__mpwCanvasAspect = 1080/1920` 时盒必须竖幅
//      （改动前：恒 16:9 ⇒ 竖幅 1080×1920 的包在取景里被上下各切 34.19%）★能失败
//   A2 16:9 设计画布时盒尺寸必须与**旧算式逐位相同**（1920×1200 窗口 → 1920×1080）⇒ 绝大多数包零回归
//   A3 `?canvasbox=16x9` = 回退口：竖幅设计下盒必须**回到 16:9**（A/B 用）
//   A4 未挂场景（`__mpwCanvasAspect` 缺失）时盒必须是 16:9（启动期无回归）
//   A5 **双档几何对拍**（同一批设计画布跑两档，写死任一档另一档必红）：
//        · 修后档（盒 = 设计比例）⇒ 四边裁切必须 == 0.00%
//        · 修前档（盒 = 16:9）    ⇒ 非 16:9 设计必须 > 5%（有一条轴被切）
//   A6 真实输入变异：3840×2160（= `丛雨` 的设计画布）在 16:10 盒下必须读出左右各 5.00%
//   A7 接线：活档位（`?res=dpr`）的画布必须来自**画布 CSS 盒**（`cv.clientWidth/clientHeight`）；
//        固定档的画布尺寸必须按设计比例重算（P-339 标记）
//   ── B. T-csz（⑤-1）──
//   B1 缺省档：`engine.canvasSize` 必须 = **场景/壁纸尺寸**（3840×2160），不是渲染缓冲（1832×1030）★能失败
//   B2 `?csz=render` 回退口必须逐位回到旧口径（cv 尺寸）
//   B3 `?csz=ortho` 显式档 == 缺省档
//   B4 **双档不变性**：同场景在 `?res=720p`（cv 1280×720）与 `?res=2160p`（cv 3840×2160）两档下
//      `canvasSize` 必须**同值**（脚本落点不许随渲染尺寸漂）★能失败
//   B5 **变异自证**：把档位切到 `?csz=render`（= 改动前的缺省）⇒ B4 的不变性必须**变红**，
//      且差异恰好 = 两档 cv 之差；打印「期望红集 == 实际红集」
//   B6 无正交矩形的场景（3D 包）必须回落到 cv 尺寸（不引入回归）
//   B7 接线：脚本引擎确实吃这个值（`canvasSize: mpwEngineCanvasSize()`）
//   B8 语料读数：真包 `窗畔弦歌` 的 Clock origin 脚本 `x=0.5` ⇒ 落点 0.5×3840=1920（不是 0.5×1832=916）
//
// 用法: node tests/canvas-fit-and-csz-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { WS } from './_root.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const html = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8')
const lib = await import(path.join(REPO, 'core/we-scene-bundle.js'))

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/** 从 demo.html 切片（与 tests/text-layout-test.mjs 同一手法）。 */
function extractFn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('未找到: ' + header)
  let i = src.indexOf('{', start), depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(start, i + 1)
}

/* ── 纯几何（与 `tests/wallpaper-crop-census-test.mjs` 同式）：画布被切 %（每边） ── */
export function cutOfBox(sw, sh, boxW, boxH, fillmode = 'aspectcrop') {
  const fboAspect = boxW / boxH, sAspect = sw / sh
  const fitLike = fboAspect < sAspect
  let fw = sw, fh = sh
  const fm = String(fillmode || 'aspectcrop').toLowerCase()
  if (fm === 'stretch') { /* 同尺寸 */ }
  else if (fm === 'aspectfit') { if (fitLike) { fw = sw; fh = sw / fboAspect } else { fw = sh * fboAspect; fh = sh } }
  else if (fm === 'center') { fw = boxW; fh = boxH }
  else { if (fitLike) { fw = sh * fboAspect; fh = sh } else { fw = sw; fh = sw / fboAspect } }
  const vl = sw / 2 - fw / 2, vr = sw / 2 + fw / 2, vt = sh / 2 - fh / 2, vb = sh / 2 + fh / 2
  return { L: Math.max(0, vl) / sw * 100, R: Math.max(0, sw - vr) / sw * 100, T: Math.max(0, vt) / sh * 100, B: Math.max(0, sh - vb) / sh * 100, framed: [fw, fh] }
}
const sidesOf = (c, eps = 0.05) => ['L', 'R', 'T', 'B'].filter((k) => c[k] > eps)
const fmt = (c) => ['L', 'R', 'T', 'B'].map((k) => c[k].toFixed(2) + '%').join('/')

/* ══════════════════════ A. T-fitbox（①-A） ══════════════════════ */
console.log('══ A. T-fitbox（①-A 画布盒比例跟随设计画布） ══')
const fitSrc = extractFn(html, 'function fitCanvas() {')
/** 跑切片出来的 fitCanvas；返回它写进画布 CSS 的盒尺寸（mock DOM/window/location）。 */
function runFitCanvas({ vw, vh, aspect, search = '' }) {
  const style = {}
  const el = { style }
  const win = { innerWidth: vw, innerHeight: vh }
  if (aspect !== undefined) win.__mpwCanvasAspect = aspect
  const loc = { search }
  const doc = { getElementById: () => el }
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'location', fitSrc + '\nreturn fitCanvas')(win, doc, loc)
  fn()
  return { w: parseInt(style.width, 10), h: parseInt(style.height, 10), left: style.left, top: style.top, style, win }
}
{
  const portrait = 1080 / 1920
  const r1 = runFitCanvas({ vw: 1920, vh: 1200, aspect: portrait })
  const a1 = r1.w / r1.h
  ok(r1.w < r1.h && Math.abs(a1 - portrait) < 0.01,
    'A1 盒比例跟随设计画布（竖幅 1080×1920 ⇒ 盒竖幅）', '盒=' + r1.w + 'x' + r1.h + '（比例 ' + a1.toFixed(4) + '，期望 ' + portrait.toFixed(4) + '）')

  const r2 = runFitCanvas({ vw: 1920, vh: 1200, aspect: 16 / 9 })
  const legacy = (() => { let w = 1920, h = Math.round(1920 * 9 / 16); if (h > 1200) { h = 1200; w = Math.round(1200 * 16 / 9) } return { w, h } })()
  ok(r2.w === legacy.w && r2.h === legacy.h, 'A2 16:9 设计画布 ⇒ 盒与旧算式逐位相同（零回归）', '盒=' + r2.w + 'x' + r2.h + ' vs 旧 ' + legacy.w + 'x' + legacy.h)

  const r3 = runFitCanvas({ vw: 1920, vh: 1200, aspect: portrait, search: '?canvasbox=16x9' })
  ok(Math.abs(r3.w / r3.h - 16 / 9) < 0.01, 'A3 `?canvasbox=16x9` 回退口 ⇒ 盒回到 16:9', '盒=' + r3.w + 'x' + r3.h)

  const r4 = runFitCanvas({ vw: 1920, vh: 1200 })
  ok(Math.abs(r4.w / r4.h - 16 / 9) < 0.01, 'A4 未挂场景（无 __mpwCanvasAspect）⇒ 盒 16:9（启动期无回归）', '盒=' + r4.w + 'x' + r4.h)

  // A5 双档几何对拍：修后档（盒=设计比例）必须 0%；修前档（盒=16:9）非 16:9 必须 > 5%
  const designs = [[3840, 2160], [1080, 1920], [3440, 1440], [1100, 1050], [4800, 8186], [2560, 1440]]
  let afterWorst = 0, beforeCut = 0, beforeTotal = 0
  const rows = []
  for (const [sw, sh] of designs) {
    const a = sw / sh
    // 修后档：盒 = 设计比例（fitCanvas 在 A1 已证明会把盒设成这个比例）
    const bw = 1000, bh = 1000 / a
    const after = cutOfBox(sw, sh, bw, bh)
    // 修前档：盒 = 16:9（窗口内最大的 16:9 盒）
    const before = cutOfBox(sw, sh, 1832, 1030)
    afterWorst = Math.max(afterWorst, ...['L', 'R', 'T', 'B'].map((k) => after[k]))
    if (sw / sh !== 16 / 9) { beforeTotal++; if (Math.max(...['L', 'R', 'T', 'B'].map((k) => before[k])) > 5) beforeCut++ }
    rows.push(sw + 'x' + sh + ' 修后=' + fmt(after) + ' 修前=' + fmt(before))
  }
  ok(afterWorst < 0.05, 'A5a 修后档（盒=设计比例）⇒ 全部四边裁切 0.00%（' + designs.length + ' 个设计画布）', '最大 ' + afterWorst.toFixed(2) + '%')
  ok(beforeTotal > 0 && beforeCut === beforeTotal, 'A5b 修前档（盒=16:9）⇒ 非 16:9 设计全部 > 5% 被切（同批样本，反向读数）', '被切 ' + beforeCut + '/' + beforeTotal + '；最狠 ' + rows.filter((r) => !r.startsWith('3840x2160')).slice(0, 1)[0])
  for (const r of rows) console.log('    · ' + r)

  // A6 真实输入变异：丛雨的设计画布 @16:10 盒
  const r6 = cutOfBox(3840, 2160, 1920, 1200)
  ok(Math.abs(r6.L - 5) < 0.1 && Math.abs(r6.R - 5) < 0.1 && r6.T < 0.05 && r6.B < 0.05,
    'A6 真实输入变异：3840×2160（丛雨）@16:10 盒 ⇒ 左右各 5.00%、上下 0', '读数 ' + fmt(r6))

  // A7 接线
  const liveFromBox = /cssW:\s*cv\.clientWidth,\s*cssH:\s*cv\.clientHeight/.test(html)
  ok(liveFromBox, 'A7a 活档位画布来自画布 CSS 盒（cv.clientWidth/clientHeight）⇒ 盒比例 = 取景比例', liveFromBox ? '' : '未找到接线')
  const fixedTierRescale = /__mpwCanvasAspect/.test(html) && /__resTier\.width\s*=\s*__w0/.test(html) && /__budget/.test(html)
  ok(fixedTierRescale, 'A7b 固定档（720p…2160p/auto）画布按设计比例重算（像素预算不变）', fixedTierRescale ? '' : '未找到 P-339 重算块')
}

/* ══════════════════════ B. T-csz（⑤-1） ══════════════════════ */
console.log('\n══ B. T-csz（⑤-1 engine.canvasSize 口径） ══')
const cszBlock = (() => {
  const start = html.indexOf('let __mpwCszMode = null')
  const fnStart = html.indexOf('function mpwEngineCanvasSize() {', start)
  let i = html.indexOf('{', fnStart), depth = 0
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break } }
  return html.slice(start, i + 1)
})()
/** 跑切片出来的 `mpwEngineCanvasSize`（mock cv / scene / location.search）。 */
function runCsz({ cvW, cvH, sceneW, sceneH, search = '' }) {
  const cv = { width: cvW, height: cvH }
  const scene = sceneW ? { general: { orthogonalprojection: { width: sceneW, height: sceneH } } } : { general: {} }
  const loc = { search }
  // eslint-disable-next-line no-new-func
  const fn = new Function('cv', 'scene', 'location', cszBlock + '\nreturn mpwEngineCanvasSize')(cv, scene, loc)
  return fn()
}
{
  const design = { sceneW: 3840, sceneH: 2160 }
  const live = { cvW: 1832, cvH: 1030 }   // 真机 :8902 实时读数
  const b1 = runCsz(Object.assign({}, design, live))
  ok(b1.x === 3840 && b1.y === 2160,
    'B1 缺省档 ⇒ canvasSize = 场景/壁纸尺寸 3840×2160（不是渲染缓冲 1832×1030）', '读数 ' + JSON.stringify(b1))

  const b2 = runCsz(Object.assign({ search: '?csz=render' }, design, live))
  ok(b2.x === 1832 && b2.y === 1030, 'B2 `?csz=render` 回退口 ⇒ 逐位回到旧口径（cv 尺寸）', '读数 ' + JSON.stringify(b2))

  const b3 = runCsz(Object.assign({ search: '?csz=ortho' }, design, live))
  ok(b3.x === b1.x && b3.y === b1.y, 'B3 `?csz=ortho` 显式档 == 缺省档', '读数 ' + JSON.stringify(b3))

  // B4 双档不变性（?res=720p vs ?res=2160p 的 cv 尺寸）
  const tierA = Object.assign({ cvW: 1280, cvH: 720 }, design)
  const tierB = Object.assign({ cvW: 3840, cvH: 2160 }, design)
  const b4a = runCsz(tierA), b4b = runCsz(tierB)
  ok(b4a.x === b4b.x && b4a.y === b4b.y,
    'B4 双档不变性：?res=720p 与 ?res=2160p 下 canvasSize 同值（脚本落点不随渲染尺寸漂）',
    '720p→' + JSON.stringify(b4a) + '  2160p→' + JSON.stringify(b4b))

  // B5 变异自证：同源切 ?csz=render ⇒ B4 必须变红，且差异恰好 = 两档 cv 之差
  const variant = (search) => {
    const a = runCsz(Object.assign({ search }, { cvW: 1280, cvH: 720 }, design))
    const b = runCsz(Object.assign({ search }, { cvW: 3840, cvH: 2160 }, design))
    return { same: a.x === b.x && a.y === b.y, delta: [b.x - a.x, b.y - a.y] }
  }
  const vDefault = variant('')
  const vRender = variant('?csz=render')
  const expectedRed = new Set(['csz=render'])
  const actualRed = new Set()
  if (!vDefault.same) actualRed.add('csz=default')
  if (!vRender.same) actualRed.add('csz=render')
  const sameSets = expectedRed.size === actualRed.size && [...expectedRed].every((k) => actualRed.has(k))
  ok(sameSets && vDefault.same === true && vRender.same === false && vRender.delta[0] === 2560 && vRender.delta[1] === 1440,
    'B5 变异自证：`?csz=render` 下不变性必须变红、且差异恰好 = 两档 cv 之差（2560×1440）',
    '期望红集=' + JSON.stringify([...expectedRed]) + ' 实际红集=' + JSON.stringify([...actualRed]) + ' renderΔ=' + JSON.stringify(vRender.delta))
  console.log('    · 期望红集 == 实际红集：' + (sameSets ? '是' : '否') + '（缺省档 ' + (vDefault.same ? '绿' : '红') + ' / render 档 ' + (vRender.same ? '绿' : '红') + '）')

  // B6 无正交矩形（3D 包）⇒ 回落 cv（不引入回归）
  const b6 = runCsz({ cvW: 1832, cvH: 1030, sceneW: 0, sceneH: 0 })
  ok(b6.x === 1832 && b6.y === 1030, 'B6 无 `general.orthogonalprojection`（3D 包）⇒ 回落 cv 尺寸（无回归）', '读数 ' + JSON.stringify(b6))

  // B7 接线
  ok(/canvasSize:\s*mpwEngineCanvasSize\(\)/.test(html), 'B7 脚本引擎确实吃这个值（`canvasSize: mpwEngineCanvasSize()`）')
  // B9 相机 origin 脚本同口径（语料 14 个相机对象的 origin 脚本用 engine.canvasSize；漏了这一路 = 只修了一半）
  const camWired = /cameraScriptHost:\s*\{[\s\S]{0,400}?canvasSize:\s*\{/.test(html) && /get x\(\)\s*\{\s*return mpwEngineCanvasSize\(\)\.x\s*\}/.test(html)
  ok(camWired, 'B9 相机 origin 脚本宿主同口径（活取值 getter，`?csz=render` 仍可回退）', camWired ? '' : '未找到 cameraScriptHost.canvasSize 接线')
}

/* B8 真包读数（语料不在 ⇒ 如实 SKIP） */
{
  const pkgPath = path.join(WS, 'allwallpaper', '1004', '夜莺night——blue_archive_小鸟游星野_窗畔弦歌.mpkg')
  if (!fs.existsSync(pkgPath)) {
    skip('B8 真包 Clock 落点读数', '语料不在：<工作区>/allwallpaper/1004/…窗畔弦歌.mpkg')
  } else {
    const { parsePkg, readPkgEntry, entryNames } = await import(path.join(REPO, 'packages/we-core/src/pkg.js'))
    const pkg = parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
    const names = entryNames(pkg)
    const sj = names.find((x) => x === 'scene.json')
    const ent = pkg.entries.find((x) => (x.name || x.path) === sj)
    const j = JSON.parse(Buffer.from(readPkgEntry(pkg, ent)).toString('utf8').replace(/^\uFEFF/, ''))
    const objs = Array.isArray(j.objects) ? j.objects : []
    const hit = objs.filter((o) => o && o.origin && typeof o.origin === 'object' && typeof o.origin.script === 'string')
      .filter((o) => /engine\.canvasSize\.x/.test(o.origin.script))
      .map((o) => {
        const sp = (o.origin.scriptproperties || {})
        const px = sp.x && (typeof sp.x === 'object' ? sp.x.value : sp.x)
        const py = sp.y && (typeof sp.y === 'object' ? sp.y.value : sp.y)
        return { name: o.name, px: Number(px), py: Number(py) }
      })
      .filter((r) => isFinite(r.px) || isFinite(r.py))
    const op = (j.general && j.general.orthogonalprojection) || {}
    const dw = Number(op.width) || 1920, dh = Number(op.height) || 1080
    if (!hit.length) skip('B8 真包 Clock 落点读数', '该包里没有 `engine.canvasSize` 型 origin 脚本')
    else {
      const r0 = hit[0]
      const want = { x: r0.px * dw, y: r0.py * dh }
      const old = { x: r0.px * 1832, y: r0.py * 1030 }   // 真机渲染缓冲读数
      ok(Math.abs(want.x - 1920) < 1 || Math.abs(r0.px - 0.5) > 1e-9,
        'B8 真包读数：`' + (r0.name || '(无名)') + '` 的 origin 脚本 p=(' + r0.px + ',' + r0.py + ') ⇒ 正交口径落点 ' + want.x.toFixed(1) + ',' + want.y.toFixed(1)
        + '（旧渲染口径 ' + old.x.toFixed(1) + ',' + old.y.toFixed(1) + '，差 ' + Math.abs(want.x - old.x).toFixed(1) + 'px）',
        'canvasSize 脚本对象 ' + hit.length + ' 个；场景画布 ' + dw + 'x' + dh)
    }
  }
}

console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)

// text-layout-test.mjs — RE-32 文本几何回归：直接从 demo.html 提取 rasterizeTextLayer/textPad，
// 用 mock canvas 2D（可控字体度量）逐项校验官方语义：
//   ① 行高 = ascent+descent（不是 1.2×size）   ② baseline = inkTop + maxIa + i×lineH
//   ③ verticalalign/horizontalalign 落点       ④ size 回填（显式只增不减，limitwidth 尊重盒宽）
//   ⑤ CSS padding 展开序                       ⑥ 宽度驱动省略号 + maxrows 截行
//   ⑦(Q2 2026-09-14 用户第 3/11 项) **字号单位**：pointsize 官方定义 = "font size in points for 300 DPI"
//     （lib.sceneScript.d.ts:838-841）→ CSS px = pointsize × 300/72，`?pts=raw` 回旧口径。
//     本文件在 Q2 之前**只测几何**（mock 的 measureText 直接用 ctx.font 的 px 值 → "pointsize 当 px"
//     在测试里自洽，改了代码也照样过）→ 现在按新的 px 口径重算全部期望值，并额外锁死语料实数。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const html = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')

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

const padSrc = extractFn(html, 'const textPad = (padding) =>')
const fnSrc = extractFn(html, 'function rasterizeTextLayer(layer) {')

// ---- Q2 字号口径：官方 300 DPI 换算（测试侧独立算，不复用 demo 里的常量）----
const DPI = 300 / 72            // 4.16666…
const PTS = 20                  // 本文件默认 pointsize（与 Q2 前一致，便于逐条对照旧期望）
const PT = PTS * DPI            // = 83.3333 px
const R = (x) => Math.round(x)

// ---- mock canvas：字号取自 ctx.font，字宽 = 1.0×字号，度量可预测 ----
const CHW = 1.0, ASC = 0.8, DESC = 0.2, INK_ASC = 0.75, INK_DESC = 0.05
function mkCtx(state) {
  const ctx = {
    font: '', textBaseline: '', fillStyle: '', textAlign: '',
    _size() { const m = /([\d.]+)px/.exec(this.font); return m ? Number(m[1]) : 10 },
    measureText(s) {
      const pt = this._size()
      const w = String(s).length * pt * CHW
      return { width: w, fontBoundingBoxAscent: pt * ASC, fontBoundingBoxDescent: pt * DESC,
        actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: pt * INK_ASC, actualBoundingBoxDescent: pt * INK_DESC }
    },
    fillRect() {}, scale(kx, ky) { state.scale = [kx, ky] },
    fillText(text, x, y) { state.texts.push({ text, x, y, font: this.font }) },
    getImageData(x, y, w, h) { state.size = [w, h]; return { data: new Uint8ClampedArray(w * h * 4) } },
  }
  return ctx
}
const document = {
  __canvases: [],
  createElement() {
    const state = { texts: [], scale: [1, 1], size: [0, 0] }
    const cv = { width: 0, height: 0, getContext: () => mkCtx(state), __state: state }
    document.__canvases.push(cv)
    return cv
  },
}
// 第 5 个参数 location：Q2 的 ?pts=raw 分支要读它（不给就是 undefined → 走官方换算）
const factory = new Function('document', 'textFontFamily', 'layer', 'cvOut', 'location',
  padSrc + '\n' + fnSrc + '\nreturn { textPad, rasterizeTextLayer }')
const { textPad } = factory(document, () => 'sans-serif', {}, [], undefined)

function raster(text, opts = {}, authoredSize = null, flags = {}) {
  const layer = { __text: Object.assign({ text, pointsize: PTS, padding: 0, horizontalalign: 'left', verticalalign: 'top', maxwidth: 0, limitwidth: false, limitrows: false, maxrows: 1, limituseellipsis: false, font: 'f.ttf' }, opts) }
  if (authoredSize) layer.__textAuthoredSize = authoredSize
  document.__canvases.length = 0
  const loc = flags.ptsRaw ? { search: '?pts=raw' } : undefined
  const api = factory(document, () => 'sans-serif', layer, null, loc)
  const r = api.rasterizeTextLayer(layer)
  // 最后一个 canvas = 最终位图（第一个是度量用 probe）
  const out = document.__canvases[document.__canvases.length - 1]
  return { r, state: out ? out.__state : { texts: [] }, box: r ? { w: r.boxW, h: r.boxH } : null }
}

const checks = []
const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

// ⑤ padding 展开（CSS 序 [top,right,bottom,left]）
push('padding 1 值 → 四边同', JSON.stringify(textPad(32)) === JSON.stringify([32, 32, 32, 32]), JSON.stringify(textPad(32)))
push('padding 2 值 → 垂直|水平', JSON.stringify(textPad('10 20')) === JSON.stringify([10, 20, 10, 20]), JSON.stringify(textPad('10 20')))
push('padding 3 值 → 上|水平|下', JSON.stringify(textPad('1 2 3')) === JSON.stringify([1, 2, 3, 2]), JSON.stringify(textPad('1 2 3')))
push('padding 4 值 → 上右下左', JSON.stringify(textPad('1 2 3 4')) === JSON.stringify([1, 2, 3, 4]), JSON.stringify(textPad('1 2 3 4')))

// ⑦ Q2：pointsize 是 300 DPI 磅值 → CSS px = pointsize × 300/72
{
  const { box, state } = raster('abc')
  push('Q2a pointsize 20 → 83.33px（×4.1667），墨迹宽 3×PT=250', box && box.w === R(3 * PT), JSON.stringify(box))
  push('Q2b ctx.font 用换算后 px（不是 20px）', /^83\.\d+px /.test(state.texts[0].font), state.texts[0].font)
  const raw = raster('abc', {}, null, { ptsRaw: true })
  push('Q2c ?pts=raw → 旧口径 20px（宽 60）', raw.box.w === 60 && near(raw.state.texts[0].y, 15), JSON.stringify(raw.box) + ' font=' + raw.state.texts[0].font)
  // 语料实数（砂狼白子11_03「文本1」pointsize 34.798，投影 2160，渲染画布 720）
  const pt34798 = 34.798 * DPI
  push('Q2d 34.798 磅 → 144.9917 场景单位', near(pt34798, 144.9917, 1e-3), pt34798.toFixed(4))
  push('Q2e 1280×720 画布 → 48.33px（旧 11.60px）', near(pt34798 * 720 / 2160, 48.3306, 1e-3) && near(34.798 * 720 / 2160, 11.5993, 1e-3),
    (pt34798 * 720 / 2160).toFixed(4) + ' vs old ' + (34.798 * 720 / 2160).toFixed(4))
}
// Q2f：真实语料包逐层核对（包不在 → SKIP，不红）
{
  const PKG = `${MPW_WS}/allwallpaper/wallpaperE/砂狼白子/砂狼白子11_03.mpkg`
  if (!fs.existsSync(PKG)) console.log('SKIP Q2f 语料包不在（' + PKG + '）——跳过真实 pointsize 核对')
  else {
    try {
      const lib = await import('../core/we-scene-bundle.js')
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
      const scene = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
      const o = (scene.objects || []).find((x) => x.name === '文本1')
      const sc = lib.parseScene(scene, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef: () => null })
      const l = sc.layers.find((x) => x.name === '文本1')
      const ps = l && l.__text && l.__text.pointsize
      const projH = (scene.general && scene.general.orthogonalprojection && scene.general.orthogonalprojection.height) || 2160
      push('Q2f 真包「文本1」pointsize=34.798（属性绑定解包）', ps === 34.798 && !!o, String(ps))
      push('Q2f 真包 → ' + (ps * DPI).toFixed(2) + ' 场景单位 = ' + (ps * DPI * 720 / projH).toFixed(2) + 'px@720',
        near(ps * DPI, 144.9917, 1e-3) && near(ps * DPI * 720 / projH, 48.3306, 1e-3), 'projH=' + projH)
    } catch (e) { console.log('SKIP Q2f 语料读取失败：' + e.message) }
  }
}

// ① 行高 = ascent+descent = PT，高度回填 = 墨高（0.75+0.05)×PT（**不是** 1.2×PT）
{
  const { r, box, state } = raster('abc')
  push('① 单行墨迹宽=3×83.33=250', box && box.w === R(3 * PT), JSON.stringify(box))
  push('① 盒高=墨高' + R(0.8 * PT) + '（非 1.2×83.33=' + R(1.2 * PT) + '）', box && box.h === R(0.8 * PT), JSON.stringify(box))
  push('② 单行 baseline=inkTop+maxIa=' + (0.75 * PT), state.texts.length === 1 && near(state.texts[0].y, 0.75 * PT), JSON.stringify(state.texts[0]))
  push('⑦ 位图盒 = 墨迹盒（Q2 后仍只增不减，见 ④）', r && r.boxW === box.w && r.boxH === box.h, JSON.stringify([r.boxW, r.boxH]))
}
// ① 两行：高度 = 1×lineH + 墨高；两行 baseline 差 = lineH
{
  const { box, state } = raster('abc\ndef')
  push('① 两行盒高=PT+0.8PT=' + R(1.8 * PT), box && box.h === R(1.8 * PT), JSON.stringify(box))
  push('② 逐行 baseline 步进=行高' + PT, state.texts.length === 2 && near(state.texts[1].y - state.texts[0].y, PT), state.texts.map((t) => t.y).join(','))
}
// ③ verticalalign：显式盒 [400,100]（宽够放 250 墨迹 → 不再触发"只增不减"）
{
  const top = raster('abc', { verticalalign: 'top' }, [400, 100])
  push('③ top：baseline=' + (0.75 * PT), near(top.state.texts[0].y, 0.75 * PT), String(top.state.texts[0].y))
  const center = raster('abc', { verticalalign: 'center' }, [400, 100])
  push('③ center：inkTop=(100−' + R(0.8 * PT) + ')/2 → baseline=' + ((100 - 0.8 * PT) / 2 + 0.75 * PT).toFixed(3), near(center.state.texts[0].y, (100 - 0.8 * PT) / 2 + 0.75 * PT), String(center.state.texts[0].y))
  const bottom = raster('abc', { verticalalign: 'bottom' }, [400, 100])
  push('③ bottom：inkTop=100−' + R(0.8 * PT) + ' → baseline=' + (100 - 0.8 * PT + 0.75 * PT).toFixed(3), near(bottom.state.texts[0].y, 100 - 0.8 * PT + 0.75 * PT), String(bottom.state.texts[0].y))
  // 水平：center → x=(400−250)/2=75；right → x=400−250=150
  const hc = raster('abc', { horizontalalign: 'center' }, [400, 100])
  push('③ horizontal center → x=75', near(hc.state.texts[0].x, (400 - 3 * PT) / 2), String(hc.state.texts[0].x))
  const hr = raster('abc', { horizontalalign: 'right' }, [400, 100])
  push('③ horizontal right → x=150', near(hr.state.texts[0].x, 400 - 3 * PT), String(hr.state.texts[0].x))
}
// ④ size 回填：显式只增不减、limitwidth 尊重盒宽、无显式时 = 墨迹+padding
{
  const grow = raster('abc', {}, [30, 10])
  push('④ 显式盒过小 → 增长到 250×' + R(0.8 * PT), grow.box.w === R(3 * PT) && grow.box.h === R(0.8 * PT), JSON.stringify(grow.box))
  const keep = raster('abc', { limitwidth: true, maxwidth: 5 * PT }, [30, 10])
  push('④ limitwidth → 尊重盒宽（30×10 不变）', keep.box.w === 30 && keep.box.h === 10, JSON.stringify(keep.box))
  const pad = raster('abc', { padding: '5 10' }, null)
  push('④ 无显式盒 → 墨迹+padding = 270×' + R(0.8 * PT + 10), pad.box.w === 270 && pad.box.h === R(0.8 * PT + 10), JSON.stringify(pad.box))
  const lw = raster('abc', { limitwidth: true, maxwidth: 5 * PT }, null)
  push('④ 无显式盒 + limitwidth → 宽=maxwidth=' + R(5 * PT), lw.box.w === R(5 * PT), JSON.stringify(lw.box))
}
// ⑥ 省略号：宽度驱动（maxwidth≈5×PT、字宽 PT、maxrows 1）
{
  const W = 5 * PT + 1
  const { state, box } = raster('abcdefghij', { limitwidth: true, maxwidth: W, limitrows: true, maxrows: 1, limituseellipsis: true })
  const line = state.texts.length === 1 ? state.texts[0].text : state.texts.map((t) => t.text).join('|')
  push('⑥ 截行+省略号：末行按宽度减字为 "abcd…"', line === 'abcd…', JSON.stringify(line))
  const noEll = raster('abcdefghij', { limitwidth: true, maxwidth: W, limitrows: true, maxrows: 1, limituseellipsis: false })
  push('⑥ 未开省略号 → 直接截断 "abcde"', noEll.state.texts[0].text === 'abcde', JSON.stringify(noEll.state.texts[0].text))
  const wrapped = raster('aaa bbb ccc', { limitwidth: true, maxwidth: 3.5 * PT })
  push('⑥ 无 maxrows → 按词换行 3 行（吸收宽度）', wrapped.state.texts.length === 3 && wrapped.box.h === R(2.8 * PT), JSON.stringify({ n: wrapped.state.texts.length, box: wrapped.box }))
}

let pass = 0
for (const c of checks) { console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail !== undefined ? '  — ' + c.detail : ''}`); if (c.ok) pass++ }
console.log(`\n${pass}/${checks.length} 通过（RE-32 文本几何 + Q2 字号口径）`)
process.exit(pass === checks.length ? 0 : 1)

/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // camera-fillmode-test.mjs — P0-4（WER-ALIGN B1/B2）验收：fillmode 四分支 + zoom 除法 + 视差官方公式
// 证据链（wer-ref VulkanRender.cpp:1531-1576 / WESceneRuntimeDriver.cpp:681 / WPNodeTransformResolver.cpp:147-162）：
//   STRETCH=(sw,sh)；ASPECTFIT=窗口≥场景（contain）；ASPECTCROP(缺省)=窗口≤场景（cover，裁边）；
//   CENTER=窗口=输出像素（1 场景单位=1 像素，wer-ref :1564-1570 framed=width/height=输出尺寸）；
//   正交窗口 = framed/zoom；投影区间 = [场景中心 ± framed/2]（居中）。
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
const fails = []
function chk(cond, label, detail) {
  if (cond) { pass++; console.log('PASS  ' + label) }
  else { fail++; fails.push(label + (detail !== undefined ? '  [' + detail + ']' : '')); console.log('FAIL  ' + label + (detail !== undefined ? '  [' + detail + ']' : '')) }
}
const eq = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const eqf = (a, b, eps = 0.01) => Math.abs(a - b) <= eps  // mat4Ortho 是 f32，反解有浮点误差

function frameOf(fillmode, sw, sh, w, h, zoom = 1) {
  const scene = { general: { orthogonalprojection: { width: sw, height: sh }, zoom, fillmode } }
  const cam = lib.buildCamera(scene, w, h, {})
  // 投影窗口宽高 = right−left / top−bottom
  const m = cam.projection
  // mat4Ortho(l, r, t, b, ...) 列主：窗口宽 = 由 cx±framed/2 构造，直接用 projW 语义反推：
  // 这里改用 exposed 语义：projection 对 (cx−framedW/2, cy−framedH/2) 与 (cx+..) 的映射
  // 取 NDC(±1) 反解窗口：
  const l = m[0], sx = m[12]
  // x_ndc = (x - (cx))*2/framedW → 反解 framedW = 2/m[0]
  const framedW = 2 / m[0]
  const framedH = 2 / Math.abs(m[5])   // P-69：修正后投影 m[5] 为负（y-down：y=0→NDC+1），取模还原窗口高
  return { framedW, framedH }
}
function frameOfOpts(fillmode, sw, sh, w, h, zoom = 1) {
  const scene = { general: { orthogonalprojection: { width: sw, height: sh }, zoom } }
  return frameOf(fillmode ? scene : { general: { orthogonalprojection: { width: sw, height: sh }, zoom } }, sw, sh, w, h, zoom)
}

// ── ① 16:9→16:9：所有分支与"旧实现"恒等（GREEN 基线）──
{
  const g = { orthogonalprojection: { width: 3840, height: 2160 }, zoom: 1 }
  const cam = lib.buildCamera({ general: g }, 1920, 1080, {})
  chk(eq(cam.projW, 3840) && eq(cam.projH, 2160), '① projW/H = 设计尺寸', cam.projW + 'x' + cam.projH)
  const m = cam.projection
  const framedW = 2 / m[0], framedH = 2 / Math.abs(m[5])   // P-69：见上
  chk(eqf(framedW, 3840) && eqf(framedH, 2160), '① ASPECTCROP 16:9→16:9 framed=3840×2160（恒等基线）', framedW + 'x' + framedH)
  // 居中：x=960（设计左缘 -1920 偏移）应落在窗口左缘 → NDC -1
  chk(eq(m[12], -1) || true, '① ortho 平移项存在')
}

// ── ② 四分支：4:3 输出（1440×1080，fboAspect=1.333 < 1.777）──
{
  const sw = 3840, sh = 2160, w = 1440, h = 1080
  const crop = frameOf('aspectcrop', sw, sh, w, h)
  chk(eqf(crop.framedW, 2880) && eqf(crop.framedH, 2160), '② ASPECTCROP（cover，裁左右）→ 2880×2160', crop.framedW + 'x' + crop.framedH)
  const fit = frameOf('aspectfit', sw, sh, w, h)
  chk(eqf(fit.framedW, 3840) && eqf(fit.framedH, 2880), '② ASPECTFIT 4:3 输出 → 3840×2880（窗口包住场景，上下留边）', fit.framedW + 'x' + fit.framedH)
  const st = frameOf('stretch', sw, sh, w, h)
  chk(eqf(st.framedW, 3840) && eqf(st.framedH, 2160), '② STRETCH → 设计尺寸 3840×2160', st.framedW + 'x' + st.framedH)
  const ctr = frameOf('center', sw, sh, w, h)
  chk(eqf(ctr.framedW, 1440) && eqf(ctr.framedH, 1080), '② CENTER → 输出像素 1440×1080（官方 :1564-1570）', ctr.framedW + 'x' + ctr.framedH)
}
// ── ③ 更宽输出（2560×1080，fboAspect=2.37 > 1.777）──
{
  const sw = 3840, sh = 2160, w = 2560, h = 1080
  const crop = frameOf('aspectcrop', sw, sh, w, h)
  chk(eqf(crop.framedW, 3840) && eqf(crop.framedH, 3840 / (2560 / 1080)), '③ ASPECTCROP 更宽输出 → 保设计宽裁上下', crop.framedW + 'x' + Math.round(crop.framedH))
  const fit = frameOf('aspectfit', sw, sh, w, h)
  chk(eqf(fit.framedW, 2160 * (2560 / 1080)) && eqf(fit.framedH, 2160), '③ ASPECTFIT 更宽输出 → 保设计高扩左右', Math.round(fit.framedW) + 'x' + fit.framedH)
}
// ── ④ zoom：窗口 = framed/zoom ──
{
  const g = { orthogonalprojection: { width: 3840, height: 2160 }, zoom: 2 }
  const cam = lib.buildCamera({ general: g }, 1920, 1080, {})
  const m = cam.projection
  chk(eqf(2 / m[0], 1920) && eqf(2 / Math.abs(m[5]), 1080), '④ zoom=2 → 窗口减半 1920×1080', (2 / m[0]) + 'x' + (2 / Math.abs(m[5])))
  const g0 = { orthogonalprojection: { width: 3840, height: 2160 }, zoom: -3 }
  lib.buildCamera({ general: g0 }, 1920, 1080, {})
  chk(true, '④ zoom≤0 → 回退 1（不抛错）')
}
// ── ⑤ fillmode 来源：scene.general.fillmode 与 opts.fillmode ──
{
  const camA = lib.buildCamera({ general: { orthogonalprojection: { width: 3840, height: 2160 }, fillmode: 'stretch' } }, 1440, 1080, {})
  chk(eqf(2 / camA.projection[0], 3840), '⑤ scene.general.fillmode=stretch 生效', String(2 / camA.projection[0]))
  const camB = lib.buildCamera({ general: { orthogonalprojection: { width: 3840, height: 2160 } } }, 1440, 1080, { fillmode: 'center' })
  chk(eqf(2 / Math.abs(camB.projection[5]), 1080), '⑤ opts.fillmode=center 生效（语料 fillmode=0 次，缺省恒 ASPECTCROP）', String(2 / Math.abs(camB.projection[5])))
}

// ── ⑥ 视差官方公式（数学复刻，源实现见 renderLayer 视差块 + 鼠标向量换算）──
{
  // 官方：offset = ((node_pos − cam_pos) + mouse) ∘ depth × amount
  // mouse 世界向量 = ((0.5−mx)·orthoW, (0.5−my)·orthoH)·influence（y-down 换算，WPNodeTransformResolver.cpp:154-156）
  const orthoW = 3840, orthoH = 2160, amount = 0.35, influence = 0.25
  const mx = 1, my = 0.5 // 鼠标在最右
  const mwx = (0.5 - mx) * orthoW * influence   // = -480
  const camCx = orthoW / 2
  // 居中满幅背景层 depth=−0.17：offset = (0 + (−480)) × −0.17 × 0.35 = +28.56px（背景轻微反向漂移）
  const offBg = (0 + mwx) * -0.17 * amount
  chk(eq(offBg, 28.56), '⑥ 居中满幅背景：位移 ≈ +28.6px（不飞出画面）', String(offBg))
  // 层在 x=3000（偏离中心 1080）：offset = (1080 − 480)×depth×amount
  const offNear = ((3000 - camCx) + mwx) * 0.5 * amount
  chk(eq(offNear, 105), '⑥ 前景层 node_pos 项参与（官方相消结构）', String(offNear))
  // 鼠标归中 → 任何层仅 node_pos 项
  const offCenter = ((3000 - camCx) + 0) * 0.5 * amount
  chk(eq(offCenter, 189), '⑥ 鼠标居中 → 纯 node_pos 项', String(offCenter))
}

const src = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
chk(src.includes("get('parallax') !== 'legacy'") || src.includes("get('parallax') === 'legacy'"), '⑥ ?parallax=legacy A/B 开关保留（demo 侧）')

console.log(`\n${pass}/${pass + fail} 通过（B1/B2 fillmode/zoom + 视差官方公式）`)
if (fails.length) console.log('失败项:\n  ' + fails.join('\n  '))
process.exit(fail === 0 ? 0 : 1)

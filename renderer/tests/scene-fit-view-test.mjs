// scene-fit-view-test.mjs —— 场景档 `?fit=` 的上游语义（"画面偏小右移"那条，2026-09-23）
//
// 现象（真机 A/B，同一张 Girl and Cat、同一个 640×360 取景框）：上游把画面铺满整幅，本仓只画在中间偏右
// 一块、左侧/上方露出清屏灰。根因：本仓 `?fit=` **只判参数在不在**（`has('fit')`），而宿主/测试台的预览 URL
// 恒带 `fit=cover`（那是**上游 fit 模式**）⇒ 被当成"本页的自动适应取景"，对所有层做了 k≈0.78 的缩放 +
// 一次 `origin=(origin−c)/k`（居中公式除反了）⇒ 读数：`houseback` origin 1959.6→2488.1、scale 1.0489→0.8215。
//
// 判据分两半：
//   · **纯函数**（`sceneFitPlan` / `sceneFitViewport` / `normalizeSceneFit`）：与上游 bundle 的三个函数
//     （`Gn`/`Eh`/`wo`，见 core/web-frame-geometry.mjs 的注释）逐值对拍；
//   · **源码级接线**：`demo.html` 必须按取值分流（`fit=1|auto` 才走自动取景、`cover|contain|stretch|fill|fit`
//     走上游语义），且自动取景里不再出现 `/ k` 那种除反的居中。
//
// 运行：node tests/scene-fit-view-test.mjs   （全过退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
import { sceneFitPlan, sceneFitViewport, normalizeSceneFit } from '../core/web-frame-geometry.mjs'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.log('  ✗ ' + n + (d ? '  [' + d + ']' : '')) } }
const html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

console.log('== A 取值归一（上游 `Gn` 同表）==')
{
  ok('A1 `contain` 保持 contain', normalizeSceneFit('contain') === 'contain')
  ok('A2 `fit` 别名 → contain（上游把「自适应」叫 fit）', normalizeSceneFit('fit') === 'contain')
  ok('A3 `stretch` → stretch', normalizeSceneFit('stretch') === 'stretch')
  ok('A4 `fill` → **cover**（上游口径，不是 stretch）', normalizeSceneFit('fill') === 'cover')
  ok('A5 未知值/空/非串 → cover（上游缺省也是 cover）',
    normalizeSceneFit('wat') === 'cover' && normalizeSceneFit('') === 'cover' && normalizeSceneFit(null) === 'cover')
  ok('A6 大小写与空白不敏感', normalizeSceneFit('  COVER ') === 'cover' && normalizeSceneFit('\tCover') === 'cover')
}

console.log('== B 覆盖式视口（上游 `Eh`）==')
{
  const same = sceneFitViewport(1920, 1080, 3840, 2160)
  ok('B1 画布与投影同比例 ⇒ 视口 = 投影（不折腾）', same && near(same.viewW, 3840) && near(same.viewH, 2160), JSON.stringify(same))
  const r169 = sceneFitViewport(1600, 1000, 3840, 2160)   // 16:10 画布
  ok('B2 16:10 画布落在比例表里 ⇒ 视口取**整比例** 3456×2160（不是 0.625 这种任意值）',
    r169 && near(r169.viewW, 3456) && near(r169.viewH, 2160), JSON.stringify(r169))
  const r43 = sceneFitViewport(800, 600, 3840, 2160)      // 4:3 不在表里 ⇒ 交给调用方 max 兜底
  ok('B3 4:3 不在设备比例表 ⇒ null（调用方按 max 比例覆盖）', r43 === null, JSON.stringify(r43))
  ok('B4 参数不可用 ⇒ null（0/负/非有限值都不许算出"视口"）',
    sceneFitViewport(0, 100, 3840, 2160) === null && sceneFitViewport(100, 100, 0, 2160) === null
    && sceneFitViewport(NaN, 100, 3840, 2160) === null)
  /* B5 cover 的两条不变量（**按上游真语义**，不是"视口 ≥ 投影"）：
     ① 视口 ⊆ 投影（两维都不超过）⇒ 只会裁掉场景，绝不会露出设计区之外；
     ② 视口比例 = 画布比例（容差 2%）⇒ 画布上不留黑边。
     注：`viewW < projW` 是**正常**的（16:10 画布配 16:9 投影 = 裁两侧），我第一版把不变量写反了。 */
  const viol = []
  for (const [cw, ch] of [[1600, 1000], [800, 600], [2560, 1080], [3440, 1440], [640, 480], [1080, 1920], [1920, 1080]]) {
    const p = sceneFitPlan('cover', 3840, 2160, cw, ch)
    if (!p) { viol.push([cw, ch, 'null']); continue }
    const inside = p.viewW <= 3840 + 1e-6 && p.viewH <= 2160 + 1e-6
    const aspectOk = Math.abs((p.viewW / p.viewH) - (cw / ch)) <= 0.02 * (cw / ch)
    const centered = Math.abs(p.offX - (3840 - p.viewW) / 2) < 1e-6 && Math.abs(p.offY - (2160 - p.viewH) / 2) < 1e-6
    if (!inside || !aspectOk || !centered) viol.push([cw, ch, p.viewW, p.viewH, inside, aspectOk, centered])
  }
  ok('B5 七种画布比例下 cover 视口都落在投影内（⊆，只裁不露）+ 比例=画布比例 + 居中',
    viol.length === 0, 'violations=' + JSON.stringify(viol.slice(0, 3)))
}

console.log('== C 三态取景 + 偏移 + 元素 object-fit（上游 `wo`/`ac`）==')
{
  const c1 = sceneFitPlan('cover', 3840, 2160, 640, 360)
  ok('C1 同比例 cover ⇒ 视口=投影、偏移 0、object-fit=cover',
    c1 && near(c1.viewW, 3840) && near(c1.viewH, 2160) && c1.offX === 0 && c1.offY === 0 && c1.objectFit === 'cover',
    JSON.stringify(c1))
  const c2 = sceneFitPlan('cover', 3840, 2160, 1600, 1000)
  ok('C2 16:10 cover ⇒ 视口 3456×2160、**居中**偏移 (192,0)、object-fit=cover',
    c2 && near(c2.viewW, 3456) && near(c2.offX, 192) && near(c2.offY, 0) && c2.objectFit === 'cover', JSON.stringify(c2))
  const c3 = sceneFitPlan('cover', 3840, 2160, 800, 600)
  ok('C3 4:3 cover（兜底路径）⇒ 视口 2880×2160、偏移 (480,0)',
    c3 && near(c3.viewW, 2880) && near(c3.viewH, 2160) && near(c3.offX, 480), JSON.stringify(c3))
  const c4 = sceneFitPlan('contain', 3840, 2160, 1600, 1000)
  ok('C4 16:10 contain ⇒ 视口 3840×2400（比投影**高**，上下留边）、偏移 -(120)、object-fit=contain',
    c4 && near(c4.viewW, 3840) && near(c4.viewH, 2400) && near(c4.offY, -120) && c4.objectFit === 'contain', JSON.stringify(c4))
  /* C5 上游把 `fill` 归一成 cover（**不是** stretch）——与本仓**帧盒**那条路的 `normalizeFrameFit('fill')
     = 'stretch'` 不同表；两张表各自有测试钉住，别把它们合并。 */
  const c5 = sceneFitPlan('fill', 3840, 2160, 1600, 1000)
  ok('C5 上游 `fill` = cover 语义（视口 3456×2160、object-fit=cover —— 不是拉伸）',
    c5 && c5.mode === 'cover' && near(c5.viewW, 3456) && near(c5.viewH, 2160) && c5.objectFit === 'cover', JSON.stringify(c5))
  const c6 = sceneFitPlan('stretch', 3840, 2160, 1600, 1000)
  ok('C6 stretch ⇒ 恒等视口、object-fit=fill', c6 && c6.mode === 'stretch' && c6.objectFit === 'fill', JSON.stringify(c6))
  const c7 = sceneFitPlan('cover', 3840, 2160, 640, 360, 0, 0)
  ok('C7 对齐可配：align=(0,0) ⇒ 偏移 0（左上对齐，不再居中）',
    c7 && c7.offX === 0 && c7.offY === 0 && near(c7.viewW, 3840), JSON.stringify(c7))
  ok('C8 参数不可用 ⇒ null（不许编一个视口出来）',
    sceneFitPlan('cover', 0, 2160, 640, 360) === null && sceneFitPlan('cover', 3840, 2160, 0, 0) === null)
}

console.log('== D 分辨力自证（判据认得出"错的那种"）==')
{
  /* D1 上游 default = cover：若把它当成 contain，16:10 画布下视口会变成"更高"而不是"更宽"，必须能被认出来 */
  const asCover = sceneFitPlan('cover', 3840, 2160, 1600, 1000)
  const asContain = sceneFitPlan('contain', 3840, 2160, 1600, 1000)
  ok('D1 cover 与 contain 在 16:10 画布下**结果不同**（判据不是恒真）',
    asCover.viewH < asContain.viewH && asCover.objectFit !== asContain.objectFit,
    JSON.stringify({ cover: asCover, contain: asContain }))
  /* D2 修前的居中公式（(p−c)/k）必须与修后的公式给出**不同**的落点，否则这组断言没有分辨力 */
  const k = 0.7832, p = 1959.64258, bcx = 1930, DCW = 3840
  const cOld = p - (bcx - DCW / 2) === 0 ? 0 : (p - (bcx - DCW / 2)) / k
  const cNew = k * p - k * (bcx - DCW / 2) + DCW / 2 * (1 - k)
  ok('D2 旧式 `(p−c)/k` 与推导式 `k·p − k·c + C(1−k)` 落点相差 > 100 单位（判据有分辨力）',
    Math.abs(cOld - cNew) > 100, JSON.stringify({ old: +cOld.toFixed(2), neu: +cNew.toFixed(2) }))
}

console.log('== E 源码级接线（demo.html）==')
{
  /* ⚠ 只查**代码形态**：注释里写明旧写法（`has('fit')`）是应该保留的史料，别把注释也判成违规。 */
  const oldTrigger = /new URLSearchParams\(location\.search\)\.has\('fit'\)/
  ok('E1 自动取景**只认显式取值** `fit=1` / `fit=auto`（代码里不再出现 has-fit 触发）',
    /FIT_AUTOFIT\s*=\s*\(__fitVal === '1' \|\| __fitVal === 'auto'\)/.test(html) && !oldTrigger.test(html),
    oldTrigger.test(html) ? '仍有 has(\'fit\') 触发' : 'ok')
  ok('E2 上游五个取值单独成路（cover/contain/stretch/fill/fit）',
    /SCENE_FIT = \(__fitVal === 'cover'[\s\S]{0,120}__fitVal === 'fit'\)/.test(html))
  ok('E3 上游档真的调用了纯函数并落三件事：平移原点 / 改投影视口 / 设 object-fit',
    /sceneFitPlan\(SCENE_FIT, projW, projH, cv\.width, cv\.height, 0\.5, 0\.5\)/.test(html)
    && /l\.origin = \[l\.origin\[0\] - plan\.offX, l\.origin\[1\] - plan\.offY/.test(html)
    && /g0\.orthogonalprojection = \{ width: plan\.viewW, height: plan\.viewH \}/.test(html)
    && /cv\.style\.objectFit = plan\.objectFit/.test(html))
  ok('E4 自动取景的居中公式已修（不再出现 `/ k` 的除反形态）',
    !/\(l\.origin\[0\] - cx\) \/ k/.test(html) && /k \* l\.origin\[0\] - k \* \(bcx - DCW \/ 2\)/.test(html))
  ok('E5 未知取值不动作（保持改动前逐位不变）——`SCENE_FIT` 为 null 时不进任何分支',
    /const SCENE_FIT = \([\s\S]{0,200}\) \? __fitVal : null/.test(html))
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 场景档 fit 语义对齐：归一表 / 整比例视口 / 三态取景与居中偏移 / object-fit / 接线与公式')
process.exit(fail > 0 ? 1 : 0)

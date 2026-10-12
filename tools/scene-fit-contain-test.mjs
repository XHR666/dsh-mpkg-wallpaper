// scene-fit-contain-test.mjs —— 场景**静态合成**（canvas 路径）的适配档：`cover`（旧，会裁）vs `contain`（新缺省）
//
// 背景（真机量化，见 `<工作区>/docs/reports/CROP-TEXT-POSITION-DIAGNOSIS.md` §11）：
//   用户截图 3392×2400（框比例 **1.41333**）里的主场景素材（16:9 = 1.77778）**左右各被裁 10.31%**、
//   上下 ≈0，与 "cover 到 1.4133 的框" 预测值 **10.25%/边** 吻合（差 0.06pp）。
//   本插件 `lib/client.js` 的 `showSceneEl()` 里那条 `scale = Math.max(vw / manifest.w, vh / manifest.h)`
//   就是 **cover**（= 与截图同一条算式）：16:9 素材铺进任意非 16:9 的框都会裁掉长边两端的 10.25%。
//
// 判据（任一不满足 → 退出码 1；`--selftest` 只跑纯函数部分）：
//   T1 **修后档（缺省 contain）**：16:9 场景包围盒 + 3392×2400 框 ⇒ 整幅可见（四边裁切 **0.00%**），
//      且绘制矩形必须**落在框内**（不越界）。
//   T2 **修前档（显式 cover）**：同一输入 ⇒ 左右各 **10.25%** 被裁、上下 0%（= 真机截图的读数方向）。
//   T3 接线：`mpwSceneFitMode()` 缺省必须是 `contain`；`?scenefit=cover` 与设置项 `sceneFit='cover'`
//      必须能切到 `cover`；`draw()` 必须走 `mpwSceneFitPlan()`（不许第二套算式留在原地）。
//   T4 变异自证：把缺省改回 `cover`（源级变异）⇒ T1 的判据必须**变红**；打印「期望红集 == 实际红集」。
//
// 用法: node tools/scene-fit-contain-test.mjs
import fs from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const REPO = path.resolve(HERE, '..')
const CLIENT = path.join(REPO, 'lib', 'client.js')
const SRC = fs.readFileSync(CLIENT, 'utf8')

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

/** 从 client.js 切出一个函数（花括号配对；与仓库既有切片测法同款）。 */
function sliceFn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return null
  let i = src.indexOf('{', start), depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(start, i + 1)
}

/* ── 纯几何：给定档位/框/场景包围盒 ⇒ 缩放与绘制矩形（判据独立算，不复用被测实现） ── */
function planRef(fit, vw, vh, w, h) {
  const s = (String(fit).toLowerCase() === 'cover') ? Math.max(vw / w, vh / h) : Math.min(vw / w, vh / h)
  const dw = w * s, dh = h * s
  return { scale: s, dw, dh, x: (vw - dw) / 2, y: (vh - dh) / 2 }
}
/** 每边"被裁"比例（%）：绘制矩形超出框的部分 / 绘制矩形 */
function cutPct(plan, vw, vh) {
  return {
    L: Math.max(0, -plan.x) / plan.dw * 100, R: Math.max(0, plan.x + plan.dw - vw) / plan.dw * 100,
    T: Math.max(0, -plan.y) / plan.dh * 100, B: Math.max(0, plan.y + plan.dh - vh) / plan.dh * 100,
  }
}
const fmt = (c) => ['L', 'R', 'T', 'B'].map((k) => c[k].toFixed(2) + '%').join('/')
const sides = (c, eps = 0.05) => ['L', 'R', 'T', 'B'].filter((k) => c[k] > eps)

const BOX = { vw: 3392, vh: 2400 }        // 用户截图的框（1.41333）
const SCENE = { w: 3840, h: 2160 }        // 丛雨 的主场景包围盒（16:9）

/* ── 被测实现（切片） ── */
const planSrc = sliceFn(SRC, 'function mpwSceneFitPlan(')
const modeSrc = sliceFn(SRC, 'function mpwSceneFitMode(')
const hay = (planSrc || '') + '\n' + (modeSrc || '')
const missing = []
if (!planSrc) missing.push('mpwSceneFitPlan(')
if (!modeSrc) missing.push('mpwSceneFitMode(')

let plan = null
if (planSrc) {
  // eslint-disable-next-line no-new-func
  plan = new Function('return (' + planSrc.replace(/^function\s+\w+/, 'function') + ')')()
}
let mode = null
if (modeSrc) {
  // eslint-disable-next-line no-new-func
  mode = new Function('location', 'readSection', 'return (' + modeSrc.replace(/^function\s+\w+/, 'function') + ')')
}

console.log('══ T1/T2 适配档：16:9 场景包围盒 + ' + BOX.vw + '×' + BOX.vh + ' 框（' + (BOX.vw / BOX.vh).toFixed(5) + '） ══')
{
  const want = planRef('contain', BOX.vw, BOX.vh, SCENE.w, SCENE.h)
  const got = plan ? plan('contain', BOX.vw, BOX.vh, SCENE.w, SCENE.h) : null
  const cRef = cutPct(want, BOX.vw, BOX.vh)
  const cGot = got ? cutPct({ dw: SCENE.w * got.scale, dh: SCENE.h * got.scale, x: got.offX, y: got.offY }, BOX.vw, BOX.vh) : null
  const inside = got ? (got.offX >= -1e-6 && got.offY >= -1e-6 && got.offX + SCENE.w * got.scale <= BOX.vw + 1e-6 && got.offY + SCENE.h * got.scale <= BOX.vh + 1e-6) : false
  ok(!!got && Math.abs(got.scale - want.scale) < 1e-9 && sides(cGot).length === 0 && inside,
    'T1 缺省 contain ⇒ 整幅可见（四边裁切 0.00%）且绘制矩形在框内',
    got ? ('scale=' + got.scale.toFixed(6) + ' 绘制=' + (SCENE.w * got.scale).toFixed(1) + 'x' + (SCENE.h * got.scale).toFixed(1)
      + ' @(' + got.offX.toFixed(1) + ',' + got.offY.toFixed(1) + ') 四边裁切=' + fmt(cGot) + ' 在框内=' + inside)
      : '未切到 mpwSceneFitPlan（实现缺失）')
  // 修前档：同输入的 cover 读数（= 真机截图方向）
  const wantCover = planRef('cover', BOX.vw, BOX.vh, SCENE.w, SCENE.h)
  const cCover = cutPct(wantCover, BOX.vw, BOX.vh)
  const gotCover = got ? plan('cover', BOX.vw, BOX.vh, SCENE.w, SCENE.h) : null
  const cGotCover = gotCover ? cutPct({ dw: SCENE.w * gotCover.scale, dh: SCENE.h * gotCover.scale, x: gotCover.offX, y: gotCover.offY }, BOX.vw, BOX.vh) : null
  ok(!!gotCover && Math.abs(cGotCover.L - 10.25) < 0.1 && Math.abs(cGotCover.R - 10.25) < 0.1 && cGotCover.T < 0.05 && cGotCover.B < 0.05,
    'T2 显式 cover ⇒ 左右各 10.25% 被裁、上下 0%（= 真机截图读数方向的反向对照）',
    gotCover ? ('四边裁切=' + fmt(cGotCover) + '（参考算式 ' + fmt(cCover) + '）') : '未切到 mpwSceneFitPlan（实现缺失）')
}
console.log('\n══ T3 接线 ══')
{
  const hasDefaultContain = /return\s+"contain"/.test(modeSrc || '')
  ok(hasDefaultContain, 'T3a `mpwSceneFitMode()` 缺省必须是 contain', hasDefaultContain ? '' : '未找到缺省 contain（或函数缺失）')
  let mDefault = null, mUrl = null, mSet = null
  if (mode) {
    const f = mode({ search: '' }, () => ({}))
    mDefault = f()
    mUrl = mode({ search: '?scenefit=cover' }, () => ({}))()
    mSet = mode({ search: '' }, () => ({ sceneFit: 'cover' }))()
  }
  ok(mDefault === 'contain', 'T3b 缺省档实测 = contain', '读数 ' + JSON.stringify(mDefault))
  ok(mUrl === 'cover', 'T3c `?scenefit=cover` ⇒ cover（A/B 回退口）', '读数 ' + JSON.stringify(mUrl))
  ok(mSet === 'cover', 'T3d 设置项 `sceneFit:"cover"` ⇒ cover（用户可 opt-in 回旧观感）', '读数 ' + JSON.stringify(mSet))
  const usesPlan = /mpwSceneFitPlan\(\s*mpwSceneFitMode\(\)/.test(SRC)
  ok(usesPlan, 'T3e `showSceneEl` 的 draw() 必须走 `mpwSceneFitPlan(mpwSceneFitMode(), …)`（单一算式）', usesPlan ? '' : '未找到接线')
  const noRawCover = !/const scale = Math\.max\(vw \/ manifest\.w, vh \/ manifest\.h\)/.test(SRC)
  ok(noRawCover, 'T3f 旧的裸 cover 算式必须已移除（不许留第二套）', noRawCover ? '' : '旧算式仍在')
  /* T5 场景**静态帧**（`.mpw-scene-fallback` 的 img）也是 16:9 素材：CSS 基础规则是 `img{object-fit:cover}`
     ⇒ 必须在挂/撤该类的两处按同一档位覆盖/撤销（否则回退帧仍被裁、且 contain 会漏到图片壁纸）。 */
  const fbAdd = /classList\.add\("mpw-scene-fallback"\)[\s\S]{0,600}?img\.style\.objectFit = \(mpwSceneFitMode\(\) === "cover"\) \? "cover" : "contain"/.test(SRC)
  const fbClear = /classList\.remove\("mpw-scene-fallback"\)[\s\S]{0,400}?img\.style\.objectFit = ""/.test(SRC)
  ok(fbAdd && fbClear, 'T5 场景静态帧同档位：挂 `mpw-scene-fallback` ⇒ 按档设 objectFit；撤销 ⇒ 还原内联覆盖',
    '挂=' + fbAdd + ' 撤=' + fbClear)
}
console.log('\n══ T4 变异自证（期望红集 == 实际红集） ══')
{
  // 源级变异：把缺省 contain 改成 cover ⇒ T1 那条判据必须变红
  const mutant = modeSrc ? SRC.replace(modeSrc, modeSrc.replace(/return\s+"contain"/, 'return "cover"')) : SRC
  const mutated = mutant !== SRC
  const modeM = mutated ? new Function('location', 'readSection', 'return (' + sliceFn(mutant, 'function mpwSceneFitMode(').replace(/^function\s+\w+/, 'function') + ')')({ search: '' }, () => ({}))() : null
  const t1Passes = (m) => {
    if (m !== 'contain') return false
    const p = plan ? plan(m, BOX.vw, BOX.vh, SCENE.w, SCENE.h) : null
    if (!p) return false
    return sides(cutPct({ dw: SCENE.w * p.scale, dh: SCENE.h * p.scale, x: p.offX, y: p.offY }, BOX.vw, BOX.vh)).length === 0
  }
  const actualRed = new Set()
  if (!mutated) actualRed.add('变异构造失败')
  else if (!t1Passes(modeM)) actualRed.add('缺省改回 cover')
  const expectedRed = new Set(['缺省改回 cover'])
  const sameSets = expectedRed.size === actualRed.size && [...expectedRed].every((k) => actualRed.has(k))
  ok(sameSets && t1Passes('contain') !== t1Passes('cover'),
    'T4 源级变异：缺省改回 cover ⇒ T1 必红（且 contain 档必须仍绿）',
    '期望红集=' + JSON.stringify([...expectedRed]) + ' 实际红集=' + JSON.stringify([...actualRed]) + '（变异后缺省=' + JSON.stringify(modeM) + '）')
}

if (missing.length) {
  console.log('\n（实现缺失：' + missing.join(' / ') + ' ⇒ 上面相关判据为红是**预期**的改动前读数）')
}
console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)

// tools/corner-continuity-test.mjs —— 2026-11-02 任务②③「Apple 连续圆角 + 内外圆角同心」判据
//
// 任务②（连续圆角）：corner-shape: superellipse(4)（超椭圆，曲率连续）只包在
//   @supports (corner-shape: superellipse(4)) 里 ⇒ 不支持的环境零生成、观感维持现状；
//   半径族 --mpw-r-lg/md/sm（16/10/6px）单点定义在 body，引用处逐值等于旧字面量 ⇒ 观感零变化；
//   不做 clip-path/mask 回退层（红线：含 fixed 后代的容器禁 transform/filter 家族与裁剪）。
// 任务③（内外同心）：容器定义 --mpw-r-outer / --mpw-gap（padding 同样读 gap），内层半径 =
//   max(0px, calc(var(--mpw-r-outer) - var(--mpw-gap)))，禁止硬编码内半径 ⇒ padding/margin
//   变动时内半径**自动跟随**（本判据把"必须是 calc 形式"写成契约，硬编码即红）。
//   落点三处：.mpw_tabBar→.mpw_tab（12/4 ⇒ 8px，旧值逐等）、.mpw_selectMenu→.mpw_selectOpt
//   （10/4 ⇒ 6px，旧 8px ⇒ 同心化 -2px）、.mpw_liquidGroup→.mpw_liquidSlider（16/6 ⇒ 10px，
//   旧 12px ⇒ 同心化 -2px；inset/width 同步读 gap）。
//   例外（具名登记，A5 值级账本）：内缩间距 ≥ 外半径时同心退化为 0（如 .mpw_scanSel 内
//   缩 10px = 外半径 10px），保留 8px 观感不套公式。
// 真机一次性核对项（交用户）：设置面板/按钮/输入框/缩略图转角是否为连续曲率（不支持
//   corner-shape 的浏览器应无任何变化）；tab 栏内 tab 与外框圆角是否同心。
//
// 用法: node tools/corner-continuity-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwBsTabState']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

const CLIENT = path.join(ROOT, 'lib', 'client.js')
const cssFloat = () => {
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  let css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ float: true }) : '')
  cancelWorldTimers()
  return css
}
/** 剥注释的产物（断言用；避免注释里的示例文本误伤） */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
/** 抽出某条规则体（选择器 → 花括号体；取第一处；剥注释） */
const ruleBody = (css, sel) => {
  const i = css.indexOf(sel)
  if (i < 0) return null
  const b0 = css.indexOf('{', i)
  if (b0 < 0) return null
  let depth = 1, j = b0 + 1
  while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++ }
  return css.slice(b0 + 1, j - 1).replace(/\/\*[\s\S]*?\*\//g, '')
}
const decl = (body, prop) => {
  if (!body) return null
  const m = new RegExp('(?:^|[;\\s])' + prop.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*:\\s*([^;]+)').exec(body)
  return m ? m[1].trim() : null
}

console.log('== A. buildCss float:on 真产物：token 块 / @supports 包裹 / token 化 ==')
let css = cssFloat()
let bare = stripComments(css)
{
  const tokenBody = ruleBody(css, 'body {\n\t--mpw-r-lg')
  ok('A1 半径族 + 曲率档位单点定义（--mpw-r-lg/md/sm = 16/10/6px + --mpw-corner-shape: superellipse(4)）',
    decl(tokenBody, '--mpw-r-lg') === '16px' && decl(tokenBody, '--mpw-r-md') === '10px'
    && decl(tokenBody, '--mpw-r-sm') === '6px' && decl(tokenBody, '--mpw-corner-shape') === 'superellipse(4)',
    JSON.stringify(tokenBody && tokenBody.replace(/\s+/g, ' ').slice(0, 120)))

  const supIdx = bare.indexOf('@supports (corner-shape: superellipse(4))')
  let supEnd = -1
  if (supIdx >= 0) {
    const b0 = bare.indexOf('{', supIdx)
    let depth = 1, j = b0 + 1
    while (j < bare.length && depth > 0) { if (bare[j] === '{') depth++; else if (bare[j] === '}') depth--; j++ }
    supEnd = j
  }
  const csHits = [...bare.matchAll(/[^-\w]corner-shape\s*:/g)].map((m) => m.index)
  const outside = csHits.filter((i) => i < supIdx || i >= supEnd)
  ok('A2 每一处 corner-shape 声明都在 @supports (corner-shape: superellipse(4)) 块内（不支持环境零生成）',
    supIdx >= 0 && supEnd > supIdx && outside.length === 0,
    'hits=' + csHits.length + ' outside=' + JSON.stringify(outside))

  const expectMd = [['.mpw_input {'], ['.mpw_button {'], ['.mpw_scanSel {'], ['.mpw_busy {'], ['.mpw_updBadge {']]
  const badMd = expectMd.filter(([sel]) => decl(ruleBody(css, sel), 'border-radius') !== 'var(--mpw-r-md)')
  const expectSm = ['.mpw_tag {', '.mpw_thumb {'].filter((sel) => decl(ruleBody(css, sel), 'border-radius') !== 'var(--mpw-r-sm)')
  ok('A3 中面引用 --mpw-r-md（input/button/scanSel/busy/updBadge）、小面引用 --mpw-r-sm（tag/thumb）',
    badMd.length === 0 && expectSm.length === 0,
    'md 红=' + JSON.stringify(badMd) + ' sm 红=' + JSON.stringify(expectSm))
  {  // .mpw_dialog 的结构规则（半径那笔）是运行时注入的组件样式，不进 buildCss 产物 ⇒ 源码级断言
    const srcDlg = fs.readFileSync(CLIENT, 'utf8')
    // 源码里有多条 .mpw_dialog {（实心底/磨砂底/结构样式）——取带 border-radius 的那条（结构样式）
    let dlgRadius = null
    let iDlg = srcDlg.indexOf('.mpw_dialog {')
    while (iDlg >= 0) {
      const body = srcDlg.slice(srcDlg.indexOf('{', iDlg) + 1, srcDlg.indexOf('}', iDlg))
      const r = decl(body, 'border-radius')
      if (r) { dlgRadius = r; break }
      iDlg = srcDlg.indexOf('.mpw_dialog {', iDlg + 1)
    }
    ok('A3b 大面对话框引用 --mpw-r-lg（源码级；规则随弹窗组件运行时注入）',
      dlgRadius === 'var(--mpw-r-lg)', String(dlgRadius))
  }
  ok('A3c 分组标题/活动进度条同档（.mpw_section / .mpw_busy 都走令牌，无字面量残留）',
    decl(ruleBody(css, '.mpw_section {'), 'border-radius') === 'var(--mpw-r-md)', '')
}

console.log('\n== B. 任务③ 内外同心契约（容器 outer/gap + 内层 max(0px, calc(...))，禁止硬编码）==')
{
  const tabBar = ruleBody(css, '.mpw_tabBar {')
  ok('B1 tabBar 容器定 --mpw-r-outer: 12px / --mpw-gap: 4px，自身半径读 outer、padding 读 gap',
    decl(tabBar, '--mpw-r-outer') === '12px' && decl(tabBar, '--mpw-gap') === '4px'
    && decl(tabBar, 'border-radius') === 'var(--mpw-r-outer)' && decl(tabBar, 'padding') === 'var(--mpw-gap) 6px',
    'radius=' + decl(tabBar, 'border-radius') + ' padding=' + decl(tabBar, 'padding'))
  ok('B2 .mpw_tab 内半径 = max(0px, calc(outer - gap))（12-4=8px 与旧值逐等；fallback=旧值）',
    decl(ruleBody(css, '.mpw_tab {'), 'border-radius')
      === 'max(0px, calc(var(--mpw-r-outer, 12px) - var(--mpw-gap, 4px)))',
    String(decl(ruleBody(css, '.mpw_tab {'), 'border-radius')))

  const menu = ruleBody(css, '.mpw_selectMenu {')
  ok('B3 selectMenu 容器定 outer=--mpw-r-md / gap: 4px，padding 读 gap',
    decl(menu, '--mpw-r-outer') === 'var(--mpw-r-md)' && decl(menu, '--mpw-gap') === '4px'
    && decl(menu, 'padding') === 'var(--mpw-gap)', '')
  ok('B4 .mpw_selectOpt 内半径 = calc 形式（10-4=6px，同心化后 -2px）',
    String(decl(ruleBody(css, '.mpw_selectOpt {'), 'border-radius')).indexOf('max(0px, calc(var(--mpw-r-outer') === 0,
    String(decl(ruleBody(css, '.mpw_selectOpt {'), 'border-radius')))

  const group = ruleBody(css, '.mpw_liquidGroup {')
  ok('B5 liquidGroup 容器定 outer=--mpw-r-lg / gap: 6px，padding 读 gap',
    decl(group, '--mpw-r-outer') === 'var(--mpw-r-lg)' && decl(group, '--mpw-gap') === '6px'
    && decl(group, 'padding') === 'var(--mpw-gap)', '')
  const slider = ruleBody(css, '.mpw_liquidSlider {')
  ok('B6 liquidSlider inset/宽/半径全读 gap（inset=gap、宽=(100%-2×gap)/6、半径=calc(outer-gap)）',
    decl(slider, 'inset') === 'var(--mpw-gap, 6px)'
    && decl(slider, 'width') === 'calc((100% - (2 * var(--mpw-gap, 6px))) / 6)'
    && String(decl(slider, 'border-radius')).indexOf('max(0px, calc(var(--mpw-r-outer') === 0,
    'inset=' + decl(slider, 'inset') + ' width=' + decl(slider, 'width') + ' radius=' + decl(slider, 'border-radius'))
}

console.log('\n== C. 例外登记（值级账本，双向防腐）==')
{
  /* 账本扫 float:on 真产物（注释已剥；其它档位若出现新字面量值，C1 会红并在此登记） */
  const bareDlg = ''
  /* 每个字面量 px 值必须有登记理由；登记了的值必须仍在产物出现（账本不许腐烂）。
     999px/50% = 胶囊/正圆（不套 token，superellipse 也不应用）；0/inherit = 清零/继承语义。 */
  const REGISTRY = {
    '2px': 'tab 激活下划线（2px 高细条）',
    '3px': '进度条轨道/填充（6px 高细条）',
    '4px': '导航图标微图',
    '8px': '现役次高频档（缩略图/网格单元/行内按钮等 19 处）：介于 sm(6)/md(10) 之间，为防观感变化保留字面量；内缩间距 ≥ 外半径的组合（如 scanSel 内缩 10px）同心退化为 0，保留 8px 观感',
    '11px': '开关轨道胶囊（高 22px，半径=高/2）',
    '999px': '胶囊/正圆（now-playing 徽标等）：半径=半高，superellipse 会把正圆改形故不套 token',
    '14px': '设置页玻璃容器 + better-sidebar 面板适配（现值保留）',
    '15px': '预设 chip（现值保留）',
    '16px': '大开关轨道胶囊（高 32px，半径=高/2）',
    /* ①(2026-11-01 T06) 通用浮层/预览表面（.dsh-conv-preview 等）用 10px，与宿主菜单圆角观感一致 */
    '10px': '通用浮层/预览表面（.dsh-conv-preview 等）：与宿主菜单圆角观感一致',
  }
  const vals = {}
  const re = /border-radius\s*:\s*([^;}{]+)/g
  for (const product of [bare, bareDlg]) {
    let m
    while ((m = re.exec(product))) {
      const v = m[1].replace(/!important/g, '').trim()
      if (/^\d+px$/.test(v)) vals[v] = (vals[v] || 0) + 1
    }
  }
  const unregistered = Object.keys(vals).filter((v) => !REGISTRY[v])
  ok('C1 产物里的字面量 px 圆角值全部在登记表内（未登记 ⇒ 红）',
    unregistered.length === 0, 'values=' + JSON.stringify(vals) + ' 未登记=' + JSON.stringify(unregistered))
  const rotten = Object.keys(REGISTRY).filter((v) => !(v in vals))
  ok('C2 登记表零腐烂（登记的每个值当前仍在产物出现，防"账本留着值没了"）',
    rotten.length === 0, 'rotten=' + JSON.stringify(rotten) + ' values=' + JSON.stringify(vals))
}

console.log('\n== D. 红线（回退层不做）+ 应用面抽查 ==')
{
  ok('D1 产物零 clip-path 声明（回退层不做：fixed 后代容器禁裁剪）',
    (bare.match(/clip-path\s*:/g) || []).length === 0, '')
  ok('D2 产物零 mask 声明（同上）',
    (bare.match(/(^|[^-\w])mask\s*:/g) || []).length === 0, '')
  const supIdx = bare.indexOf('@supports (corner-shape: superellipse(4))')
  const supEnd = bare.indexOf('}', bare.indexOf('corner-shape: var(--mpw-corner-shape);', supIdx)) // 应用面块结束
  ok('D3 应用面含设置面板控件与悬浮外壳（.mpw_input 与 body[data-mpw-float] 外壳都在 @supports 块内）',
    supIdx >= 0
    && bare.indexOf('.mpw_input,', supIdx) > supIdx
    && bare.indexOf('body[data-mpw-float] .pI_x6G_sidebarCol,', supIdx) > supIdx, '')
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUTANTS = [
  { id: 'M1', what: '.mpw_input 改回字面量 10px ⇒ A3 必红', expect: ['A3'],
    patch: (s) => s.replace('\tborder: 1px solid var(--dsw-alias-border-l2); border-radius: var(--mpw-r-md);\n\tbackground: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);',
      '\tborder: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;\n\tbackground: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);'),
    verify: (s) => s.indexOf('border-radius: 10px;\n\tbackground: var(--dsw-alias-bg-module-platform)') >= 0 },
  { id: 'M2', what: '拆掉 @supports 包裹 ⇒ A2 必红', expect: ['A2'],
    patch: (s) => s.replace('@supports (corner-shape: superellipse(4)) {', '/* M2: wrapper removed */'),
    verify: (s) => s.indexOf('@supports (corner-shape: superellipse(4)) {') < 0 },
  { id: 'M3', what: '.mpw_tab 内半径改回硬编码 8px（同心契约破坏）⇒ B2 必红', expect: ['B2'],
    patch: (s) => s.replace('\tborder-radius: max(0px, calc(var(--mpw-r-outer, 12px) - var(--mpw-gap, 4px)));', '\tborder-radius: 8px; /* M3 */'),
    verify: (s) => s.split('border-radius: 8px; /* M3 */').length === 2 },
  { id: 'M4', what: '悬浮外壳加 clip-path（红线）⇒ D1 必红', expect: ['D1'],
    patch: (s) => s.replace('body[data-mpw-float] .pI_x6G_sidebarCol {\n\tmargin: 12px;', 'body[data-mpw-float] .pI_x6G_sidebarCol {\n\tclip-path: inset(0 round 12px); /* M4 */\n\tmargin: 12px;'),
    verify: (s) => s.indexOf('clip-path: inset(0 round 12px);') >= 0 },
]
function runChecks(clientPath) {
  const r = { A2: false, A3: false, B2: false, D1: false }
  try {
    reset()
    loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
    const c = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ float: true }) : '')
    cancelWorldTimers()
    const b = stripComments(c)
    const supIdx = b.indexOf('@supports (corner-shape: superellipse(4))')
    let supEnd = -1
    if (supIdx >= 0) {
      const b0 = b.indexOf('{', supIdx)
      let depth = 1, j = b0 + 1
      while (j < b.length && depth > 0) { if (b[j] === '{') depth++; else if (b[j] === '}') depth--; j++ }
      supEnd = j
    }
    r.A2 = supIdx >= 0 && [...b.matchAll(/[^-\w]corner-shape\s*:/g)].every((m) => m.index >= supIdx && m.index < supEnd)
    r.A3 = decl(ruleBody(c, '.mpw_input {'), 'border-radius') === 'var(--mpw-r-md)'
    r.B2 = decl(ruleBody(c, '.mpw_tab {'), 'border-radius') === 'max(0px, calc(var(--mpw-r-outer, 12px) - var(--mpw-gap, 4px)))'
    r.D1 = (b.match(/clip-path\s*:/g) || []).length === 0
  } catch (e) { /* 判红即结果 */ }
  return r
}
for (const m of MUTANTS) {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const mutated = m.patch(src)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id + '：变异没有真的打上去（R2）'); continue }
  const tmp = path.join(ROOT, 'tools', 'probe-out', '.mut-corner-' + m.id + '.client.js')
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, mutated)
  let red
  try {
    const r = runChecks(tmp)
    red = m.expect.filter((id) => !r[id])
  } catch (e) { red = m.expect.slice() }
  try { fs.unlinkSync(tmp) } catch {}
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

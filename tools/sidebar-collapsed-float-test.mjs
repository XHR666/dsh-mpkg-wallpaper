// tools/sidebar-collapsed-float-test.mjs —— 2026-11-02 任务①「侧栏收起态悬浮效果消失（回归）」判据
//
// 根因（取证结论，见 lib/client.js ⑨a 注释）：
//   收起态悬浮观感 = 我们自己的悬浮外壳规则在画（body[data-mpw-float] [data-sidebar-collapsed]
//   块：margin 12px -12px 12px 12px + border-radius 令牌 + 边框 + box-shadow）。宿主 layout/
//   sidebar 包在收起态只改 centerCol 边线与 leading-clearance，不给 sidebarCol 任何
//   margin/radius/shadow（宿主包 CSS 逐条读过，2026-11-02）。
//   c1a55a6 为修"切设置页后界面左移"加的
//     html body:has([data-sidebar-collapsed]) [class*="sidebarCol"] { margin:0 !important;
//       border-radius:0 !important; box-shadow:none !important }
//     html body:has([data-sidebar-collapsed]) [class*="sidebarCol"]:not([data-sidebar-right-panel])
//       { padding:0 !important }
//   用整类清零把这三件套连同 padding 一起杀掉 ⇒ 用户看到"收起后悬浮效果消失"；且右栏面板
//   （同命中 sidebarCol 子串）在左栏收起期间被误清。左移真因 2026-11-02 定案为设置页 tab 行
//   N×100% 超宽撑破布局根（frame.scrollLeft=156），由 tab 同格堆叠根治 ⇒ 清零规则整体撤销。
//
// 本判据（每条都能被"改回坏写法"变红，见文末 M1/M2 变异自证；R1）：
//   A1 收起态悬浮三件套在位（margin / border-radius 令牌 / box-shadow，无 !important 清零）
//   A2 展开态悬浮外壳零变化（margin 12px / padding 10px 12px 14px / 令牌圆角 / 阴影）
//   A3 回归模式不得复活：产物里不得存在"选择器含 :has([data-sidebar-collapsed]) 且命中
//      [class*="sidebarCol"] 整类"的规则（右栏面板同理被该模式波及 ⇒ 模式整体禁止）
//   真机一次性核对项（判据管不到的，交用户在真页面确认并记进台账）：
//     ① 悬浮开：展开态侧栏悬浮卡片观感不变；② 悬浮开：收起后 rail 悬浮卡片（圆角/阴影/边框）
//     回来且 rail 图标行完整；③ 左栏收起时右栏面板悬浮观感不受影响；④ 设置页各 tab 间切换后
//     界面不再整体左移（frame.scrollLeft 恒 0，配合 tools/bs-tab-test.mjs 的 D8 产物断言）。
//
// 用法: node tools/sidebar-collapsed-float-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const CLIENT = path.join(ROOT, 'lib', 'client.js')
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwBsTabState']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

const cssFloat = () => {
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ float: true }) : '')
  cancelWorldTimers()
  return css
}
/** 抽出某条规则体（选择器 → 花括号体；取第一处；剔除注释，避免注释文本误伤断言） */
const ruleBody = (css, sel) => {
  const i = css.indexOf(sel)
  if (i < 0) return null
  const b0 = css.indexOf('{', i)
  if (b0 < 0) return null
  let depth = 1, j = b0 + 1
  while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++ }
  return css.slice(b0 + 1, j - 1).replace(/\/\*[\s\S]*?\*\//g, '')
}
/** 产物里所有"选择器含锚串"的规则体（选择器起点 = 上一个规则边界/注释结束后） */
const rulesWithAnchor = (css, anchor) => {
  const out = []
  let i = css.indexOf(anchor)
  while (i >= 0) {
    const selStart = Math.max(css.lastIndexOf('}', i), css.lastIndexOf('{', i), css.lastIndexOf('*/', i)) + 1
    const b0 = css.indexOf('{', i)
    if (b0 >= 0) {
      let depth = 1, j = b0 + 1
      while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++ }
      out.push({ sel: css.slice(selStart, b0).trim(), body: css.slice(b0 + 1, j - 1).replace(/\/\*[\s\S]*?\*\//g, '') })
    }
    i = css.indexOf(anchor, i + anchor.length)
  }
  return out
}
const has = (body, frag) => !!body && body.indexOf(frag) >= 0

console.log('== A. buildCss float:on 真产物：收起态悬浮三件套 / 展开态零变化 / 清零模式禁止 ==')
{
  const css = cssFloat()

  const collapsed = ruleBody(css, 'body[data-mpw-float] [data-sidebar-collapsed] .pI_x6G_sidebarCol,')
  ok('A1a 收起态外壳 margin 在位（12px -12px 12px 12px，rail 图标行完整的那一笔）',
    has(collapsed, 'margin: 12px -12px 12px 12px;'), 'body=' + String(collapsed).slice(0, 120))
  ok('A1b 收起态外壳圆角走令牌（--mpw-side-radius，两态同源）',
    has(collapsed, 'border-radius: var(--mpw-side-radius);'), '')
  ok('A1c 收起态外壳阴影在位（--mpw-float-shadow）且无 !important 清零',
    has(collapsed, 'box-shadow: var(--mpw-float-shadow);')
    && !/margin:\s*0 !important/.test(collapsed)
    && !/border-radius:\s*0 !important/.test(collapsed)
    && !/box-shadow:\s*none !important/.test(collapsed), '')

  const expanded = ruleBody(css, 'body[data-mpw-float] .pI_x6G_sidebarCol {')
  ok('A2 展开态外壳零变化（margin 12px / padding 10px 12px 14px / 令牌圆角 / 阴影）',
    has(expanded, 'margin: 12px;') && has(expanded, 'padding: 10px 12px 14px;')
    && has(expanded, 'border-radius: var(--mpw-side-radius);')
    && has(expanded, 'box-shadow: var(--mpw-float-shadow);'),
    'body=' + String(expanded).slice(0, 160))

  const bad = rulesWithAnchor(css, ':has([data-sidebar-collapsed])')
    .filter((r) => r.sel.indexOf('[class*="sidebarCol"]') >= 0)
  ok('A3 整类清零模式不得回归：产物里没有"has([data-sidebar-collapsed]) + sidebarCol 整类"规则',
    bad.length === 0, bad.length ? 'sel=' + bad[0].sel.slice(0, 120) : '')

  const colRules = rulesWithAnchor(css, '[data-sidebar-collapsed]')
    .filter((r) => /padding:\s*0 !important/.test(r.body) && r.sel.indexOf('[class*="sidebarCol"]') >= 0)
  ok('A3b 收起态不给 sidebarCol 整类打 padding:0 !important（rail 内容完整的另一面）',
    colRules.length === 0, colRules.length ? 'sel=' + colRules[0].sel.slice(0, 120) : '')

  /* 反向对照（R5）：外壳规则虽然常驻产物，但选择器**必须**全部带 body[data-mpw-float]
     门控前缀（悬浮关 ⇒ 属性不在 ⇒ 我们的壳零命中）—— 专属外壳的判定锚就是这枚属性，
     不需要第二套壳标记。收窄口径：只查"以 sidebarCol 自身为终点"的规则（rail 内部面
     [class*="root"] 后代规则管壁纸可见性，不属外壳几何，不在此列）。 */
  const shellRules = rulesWithAnchor(css, '[data-sidebar-collapsed] .pI_x6G_sidebarCol')
    .filter((r) => /\.pI_x6G_sidebarCol\s*[,]/.test(r.sel))
  const ungated = shellRules.filter((r) => r.sel.indexOf('body[data-mpw-float]') < 0)
  ok('A4 反向：收起态外壳规则全部带 body[data-mpw-float] 专属门控（悬浮关 ⇒ 零命中）',
    shellRules.length >= 1 && ungated.length === 0,
    'rules=' + shellRules.length + ' ungated=' + JSON.stringify(ungated.map((r) => r.sel.slice(0, 80))))
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUTANTS = [
  { id: 'M1', what: 'c1a55a6 的整类清零规则写回去 ⇒ A3 必红',
    expect: ['A3'],
    patch: (s) => s.replace('.mpw_scanCellName { position: absolute;',
      'html body:has([data-sidebar-collapsed]) [class*="sidebarCol"] {\n  margin: 0 !important;\n  border-radius: 0 !important;\n  box-shadow: none !important;\n}\n.mpw_scanCellName { position: absolute;'),
    verify: (s) => s.indexOf('html body:has([data-sidebar-collapsed]) [class*="sidebarCol"]') >= 0 },
  { id: 'M2', what: '收起态外壳三件套被清成 !important 归零（模拟 c1a55a6 打到我们壳上的效果）⇒ A1 必红',
    expect: ['A1a', 'A1b', 'A1c'],
    patch: (s) => s.replace('\tmargin: 12px -12px 12px 12px;', '\tmargin: 0 !important;')
      .replace('\tborder-radius: var(--mpw-side-radius);\n\tborder: 1px solid rgba(19,45,83,0.26);\n\tbox-shadow: var(--mpw-float-shadow);\n\toverflow: visible;',
        '\tborder-radius: 0 !important;\n\tborder: none;\n\tbox-shadow: none !important;\n\toverflow: visible;'),
    verify: (s) => s.indexOf('margin: 0 !important;') >= 0 && s.indexOf('margin: 12px -12px 12px 12px;') < 0 },
]
function runChecks(clientPath) {
  const r = { A1a: false, A1b: false, A1c: false, A3: false }
  try {
    const css = cssFloatWith(clientPath)
    const collapsed = ruleBody(css, 'body[data-mpw-float] [data-sidebar-collapsed] .pI_x6G_sidebarCol,')
    r.A1a = has(collapsed, 'margin: 12px -12px 12px 12px;')
    r.A1b = has(collapsed, 'border-radius: var(--mpw-side-radius);')
    r.A1c = has(collapsed, 'box-shadow: var(--mpw-float-shadow);')
      && !/margin:\s*0 !important/.test(collapsed)
      && !/border-radius:\s*0 !important/.test(collapsed)
      && !/box-shadow:\s*none !important/.test(collapsed)
    r.A3 = rulesWithAnchor(css, ':has([data-sidebar-collapsed])')
      .filter((x) => x.sel.indexOf('[class*="sidebarCol"]') >= 0).length === 0
  } catch (e) { /* 判红即结果 */ }
  return r
}
function cssFloatWith(clientPath) {
  reset()
  loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ float: true }) : '')
  cancelWorldTimers()
  return css
}
for (const m of MUTANTS) {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const mutated = m.patch(src)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id + '：变异没有真的打上去（R2）——锚点/唯一性检查'); continue }
  const tmp = path.join(ROOT, 'tools', 'probe-out', '.mut-' + m.id + '.client.js')
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, mutated)
  let red
  try {
    const r = runChecks(tmp)
    red = m.expect.filter((id) => !r[id])   // 期望红的项实际没红 ⇒ 收进实际红集
  } catch (e) { red = m.expect.slice() }   // 副本整个跑挂 ⇒ 判红成立
  try { fs.unlinkSync(tmp) } catch {}
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

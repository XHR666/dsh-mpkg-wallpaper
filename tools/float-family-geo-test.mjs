// tools/float-family-geo-test.mjs —— 2026-10-30 任务书 §1 判据：标题栏悬浮恢复 + 悬浮三面同族
//
// 根因定案（真机探针 probe-out/before.float-glow.txt + 源码考古，2026-10-30）：
//   上一轮 55da7a8（2026-10-28 §1 统一几何）在 float 块头部注释**中间**插入了 ⑤ 注释
//   （自带收尾符）+ body[data-mpw-float]{--mpw-side-radius…} 令牌规则，旧注释的后半段
//   （「②(修正) 标题栏下边保留描边…圆角描边完整」+ 它自己的收尾符）从此**没有开启符**
//   ⇒ 产物 CSS 里出现一段裸文本；浏览器把这段文本连同紧随其后的
//   `body[data-mpw-float] .wSkVaW_header {…}` 一起解析成一条"选择器非法"的规则**整条丢弃**
//   ⇒ 真机标题栏悬浮丢失（margin=0/radius=0）。左栏/右栏规则在丢弃点之后，解析器在下一个
//   块边界恢复 ⇒ 不受影响（真机：左栏 margin=12px 正常悬浮——这正是"侧栏浮、标题栏不浮"
//   的机制解释）。glow-fixed-safety-test A3 的 text 级 indexOf 断言探不到"文本在场但被
//   解析丢弃"这一族，本文件补上**解析级**判据。
//
//   ⑪(2026-10-31 任务书 §1) **C3b 翻转留痕**：2026-10-30（⑩拆两半）的 C3b 断言"空栏不压
//      悬浮外壳"把当时的错误设计写成了契约——真机实测外壳放行后 float 档把空白标题栏撑成
//      描边悬浮卡片，而宿主原生空会话完全没有标题栏。本轮翻转为"空栏兜底必须含 5 条归零"
//      （margin/padding/border-width/border-radius/box-shadow，!important）+ 新增反向断言
//      C3d（非空栏悬浮外壳仍在且同令牌、无 !important）；M4 改为"去掉归零 ⇒ C3b 红"、
//      新增 M5"归零扩到非空栏 ⇒ C3d 红"；M2 期望红集如实计入 C3d 级联。
//
// 断言（每条都能被文末变异变红）：
//   C1 产物 CSS 注释配平 + 前导合法：float:on 与 float:off 两条产物路径，逐字符扫描
//      （注释状态机 + 块深度）⇒ 无未闭合注释/未闭合块；每条顶层规则的前导（选择器段）
//      只含选择器安全字符集（CJK 文本、`!` 等裸文本特征 = 必红）。
//   C2 规则存活：`body[data-mpw-float] .wSkVaW_header` / `.pI_x6G_sidebarCol`（float 门控
//      左栏）/ 右栏 push 三条规则在解析出的规则列表里以**独立规则**存在（前导逐字相等，
//      不与垃圾文本合并）。
//   C3 悬浮三面同族：三处规则都 ① 引用 var(--mpw-side-radius)（同一圆角令牌）
//      ② 引用 var(--mpw-float-shadow)（同一阴影令牌）③ 非零外间距（margin/top 内缩）
//      ④ 圆角与阴影令牌都定义在 body[data-mpw-float] 令牌规则里（单源）。
//   C4 float-off 让位：data-mpw-float-off 重置规则对标题栏/左栏含 box-shadow: none
//      （阴影进家族后，设置面板打开期间（sblur/float-off）不得残留）。
//   M1 变异：把孤儿裸文本塞回令牌规则与标题栏规则之间 ⇒ C1+C2 必红（复刻 55da7a8 事故）
//   M2 变异：标题栏阴影改回不同令牌的字面量 ⇒ C3 必红
//   M3 变异：float-off 重置去掉 box-shadow: none ⇒ C4 必红
//
// 用法: node tools/float-family-geo-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs')
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwGlobalWired', '__mpwThumbSched',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }
function cssOf(settings) {
  reset()
  loadPlugin({ quiet: true, settings })
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')
  cancelWorldTimers()
  return css
}
const WITH_FLOAT = { enabled: true, image: 'data:image/png;base64,AAA', float: true }
const NO_FLOAT = { enabled: true, image: 'data:image/png;base64,AAA', float: false }

/* ---------- 解析器（注释状态机 + 块深度；够判本族事故，不是完整 CSS 解析器） ---------- */
const SAFE_PRELUDE = /^[A-Za-z0-9_\-\s.*#:()\[\]="'~+>,$@|]+$/
function parseTopRules(css) {
  let inComment = false, depth = 0
  let prelude = ''
  const rules = []
  for (let i = 0; i < css.length; i++) {
    const c = css[i], n = css[i + 1]
    if (inComment) { if (c === '*' && n === '/') { inComment = false; i++; prelude = '' } continue }
    if (c === '/' && n === '*') { inComment = true; i++; continue }
    if (depth === 0) {
      if (c === '{') { rules.push({ pre: prelude.replace(/\s+/g, ' ').trim() }); prelude = ''; depth = 1; continue }
      if (c === '}' || c === ';') { prelude = ''; continue }
      prelude += c
    } else {
      if (c === '{') depth++
      else if (c === '}') depth--
    }
  }
  return { rules, unclosedComment: inComment, unterminatedBlock: depth !== 0 }
}
const findRule = (parsed, sel) => parsed.rules.find((r) => r.pre === sel)
const has = (s, re) => re.test(s)
// 取顶层规则体（从选择器命中点配平花括号；注释先剥）
const stripC = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '')
function ruleBody(css, sel) {
  const raw = stripC(css).replace(/\s+/g, ' ')
  const s = sel.replace(/\s+/g, ' ')
  const i = raw.indexOf(s + ' {')
  if (i < 0) return null
  const b0 = raw.indexOf('{', i)
  let depth = 1, j = b0 + 1
  while (j < raw.length && depth > 0) { if (raw[j] === '{') depth++; else if (raw[j] === '}') depth--; j++ }
  return raw.slice(b0 + 1, j - 1).trim()
}

const FAM = [
  { name: '标题栏', sel: 'body[data-mpw-float] .wSkVaW_header', bodyMust: /margin:\s*10px 16px 0/ },
  { name: '左栏', sel: 'body[data-mpw-float] .pI_x6G_sidebarCol', bodyMust: /margin:\s*12px(\s*!important)?\s*;/ },
  { name: '右栏push', sel: 'html body[data-mpw-float]:not([data-mpw-rightbar-parked]) [data-sidebar-right-panel="push"]', bodyMust: /top:\s*10px !important/ },
]

console.log('== A. 解析级（注释配平 + 规则存活，float:on/off 两条产物路径）==')
const CSS_ON = cssOf(WITH_FLOAT)
const CSS_OFF = cssOf(NO_FLOAT)
for (const [tag, css] of [['float:on', CSS_ON], ['float:off', CSS_OFF]]) {
  const p = parseTopRules(css)
  ok(`A1[${tag}] 注释配平 + 块配平（无未闭合注释/块）`, !p.unclosedComment && !p.unterminatedBlock,
    p.unclosedComment ? '有未闭合注释' : (p.unterminatedBlock ? '有未闭合块' : '配平'))
  const bad = p.rules.filter((r) => r.pre && !SAFE_PRELUDE.test(r.pre))
  ok(`A2[${tag}] 全部顶层规则前导只含选择器安全字符（裸文本/中文/叹号 = 55da7a8 事故特征）`,
    bad.length === 0, bad.length ? '首条非法前导=' + JSON.stringify(bad[0].pre.slice(0, 90)) : '零命中')
}

console.log('\n== B. 规则存活 + 三面同族（float:on）==')
const P_ON = parseTopRules(CSS_ON)
for (const f of FAM) ok(`B1 ${f.name} 规则存活（独立规则，前导逐字相等）`, !!findRule(P_ON, f.sel),
  findRule(P_ON, f.sel) ? '存活' : '被解析丢弃（55da7a8 事故同族）')
const bodies = {}
for (const f of FAM) bodies[f.name] = ruleBody(CSS_ON, f.sel)
{
  const miss = FAM.filter((f) => !bodies[f.name])
  ok('B2 三处规则体可提取', miss.length === 0, miss.length ? '缺失=' + miss.map((f) => f.name).join(',') : '')
  const noRadius = FAM.filter((f) => bodies[f.name] && !/border-radius:\s*var\(--mpw-side-radius\)/.test(bodies[f.name]))
  // ⑨(2026-10-30 §3) 右栏 18px 字面量收编进令牌后，三处（标题栏/左栏/右栏push）逐处同令牌
  ok('B3 三处圆角同令牌（都引用 var(--mpw-side-radius)；§3 起含右栏）', noRadius.length === 0,
    noRadius.length ? '偏离=' + noRadius.map((f) => f.name).join(',') : '三处同源')
  const noShadow = FAM.filter((f) => bodies[f.name] && !/box-shadow:\s*var\(--mpw-float-shadow/.test(bodies[f.name]))
  ok('B4 三处阴影同令牌（都引用 var(--mpw-float-shadow)）', noShadow.length === 0,
    noShadow.length ? '偏离=' + noShadow.map((f) => f.name).join(',') : '三处同源')
  const noGap = FAM.filter((f) => !bodies[f.name] || !f.bodyMust.test(bodies[f.name]))
  ok('B5 三处非零外间距（标题栏 margin / 左栏 margin / 右栏 top 内缩）', noGap.length === 0,
    noGap.length ? '偏离=' + noGap.map((f) => f.name).join(',') : '三处都有')
  const tokBody = ruleBody(CSS_ON, 'body[data-mpw-float]')
  ok('B6 圆角+阴影令牌单源（都定义在 body[data-mpw-float] 令牌规则）',
    !!tokBody && /--mpw-side-radius:/.test(tokBody) && /--mpw-float-shadow:/.test(tokBody),
    tokBody ? tokBody.slice(0, 120) : '令牌规则缺失')
}

console.log('\n== C. float-off 让位（设置面板打开期间不残留悬浮外壳）==')
{
  const offSidebar = ruleBody(CSS_ON, 'body[data-mpw-float-off] body[data-mpw-float] .pI_x6G_sidebarCol, body[data-mpw-float-off] body[data-mpw-float] [class*="sidebarCol"]')
  const offHeader = ruleBody(CSS_ON, 'body[data-mpw-float-off] body[data-mpw-float] .wSkVaW_header')
  ok('C1 float-off 左栏重置含 box-shadow: none', !!offSidebar && /box-shadow:\s*none/.test(offSidebar), offSidebar || '规则缺失')
  ok('C2 float-off 标题栏重置含 box-shadow: none', !!offHeader && /box-shadow:\s*none/.test(offHeader), offHeader || '规则缺失')
}
console.log('\n== C3. 空栏兜底（⑪翻转：空栏全量归零 + 非空栏外壳完好）==')
{
  /* ⑪(2026-10-31 任务书 §1) 改向记录：C3b 在 2026-10-30（⑩拆两半）断言的是"空栏不压悬浮外壳"——
     那是把当时的错误设计写成了契约：真机实测外壳放行后，float 档把空白标题栏撑成一张描边
     悬浮卡片，而宿主原生空会话**完全没有标题栏**（宿主 .wSkVaW_headerBlank{min-height:0;
     padding-bottom:0}，外壳归零即高度为 0）。本轮翻转：空栏兜底**必须**含 5 条归零声明
     （margin/padding/border-width/border-radius/box-shadow，!important）；并新增反向断言
     C3d（非空栏态悬浮外壳仍在且同令牌、无 !important），防止把归零扩到有会话态。 */
  // header 本体的空栏兜底：材质压制（底色/磨砂/最小高）仍在
  const blankHeader = ruleBody(CSS_ON, '} html body[data-mpw-hdr-blank][data-mpw-hdr-blank] .wSkVaW_header')
  ok('C3a 空栏兜底（header 本体）保留材质压制（背景透明 + backdrop none + min-height 0）',
    !!blankHeader && /background-color:\s*transparent !important/.test(blankHeader)
    && /backdrop-filter:\s*none !important/.test(blankHeader) && /min-height:\s*0 !important/.test(blankHeader),
    blankHeader || '规则缺失')
  const zeroings = ['margin: 0 !important', 'padding: 0 !important', 'border-width: 0 !important',
    'border-radius: 0 !important', 'box-shadow: none !important']
  const missing = zeroings.filter((z) => !blankHeader || blankHeader.indexOf(z) < 0)
  ok('C3b 空栏兜底（header 本体）含 5 条外壳归零（margin/padding/border-width/border-radius/box-shadow，!important）',
    missing.length === 0, missing.length ? '缺=' + missing.join(' , ') : '5 条齐')
  // ::before/::after/磨砂子层组的压制原样保留（10-09 细磨砂条根因不回潮）
  const blankPseudo = ruleBody(CSS_ON, 'html body[data-mpw-hdr-blank][data-mpw-hdr-blank] .wSkVaW_header::before, html body[data-mpw-hdr-blank][data-mpw-hdr-blank] .wSkVaW_header::after, html body[data-mpw-hdr-blank][data-mpw-hdr-blank] .wSkVaW_header:not(:where([data-code-block-banner])) > .mpw-hdrFrost')
  ok('C3c 空栏兜底（伪元素/磨砂子层）原样保留（含 margin:0 !important 与 background-image:none）',
    !!blankPseudo && /margin:\s*0 !important/.test(blankPseudo) && /background-image:\s*none !important/.test(blankPseudo),
    blankPseudo ? blankPseudo.slice(0, 90) : '规则缺失')
  // 反向断言（⑪新增）：归零只许落在空栏，非空栏（有会话）悬浮外壳必须完好
  const floatHeader = ruleBody(CSS_ON, 'body[data-mpw-float] .wSkVaW_header')
  const shellOk = !!floatHeader
    && /margin:\s*10px 16px 0(?!\s*!important)/.test(floatHeader)
    && /padding:\s*8px 16px 8px(?!\s*!important)/.test(floatHeader)
    && /border-radius:\s*var\(--mpw-side-radius\)(?!\s*!important)/.test(floatHeader)
    && /box-shadow:\s*var\(--mpw-float-shadow\)(?!\s*!important)/.test(floatHeader)
  ok('C3d 反向：非空栏（有会话）标题栏悬浮外壳仍在（margin/padding/radius/shadow 非零且同令牌、无 !important）',
    shellOk, floatHeader || '规则缺失')
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const CLIENT_PATH = path.join(here, '..', 'lib', 'client.js')
const CLIENT = fs.readFileSync(CLIENT_PATH, 'utf8')
function runChecksOn(clientText, clientPath) {
  // 隔离副本：写进 node_modules/.tmp-mut/<id>.js，loadPlugin 用 clientPath 指过去
  fs.mkdirSync(path.dirname(clientPath), { recursive: true })
  fs.writeFileSync(clientPath, clientText)
  const css = cssOfPath(clientPath, WITH_FLOAT)
  const r = {}
  const p = parseTopRules(css)
  r['A1'] = !p.unclosedComment && !p.unterminatedBlock
    && p.rules.every((x) => !x.pre || SAFE_PRELUDE.test(x.pre))
  r['B1标题栏'] = !!findRule(p, 'body[data-mpw-float] .wSkVaW_header')
  r['B4阴影'] = FAM.every((f) => { const b = ruleBody(css, f.sel); return b && /box-shadow:\s*var\(--mpw-float-shadow/.test(b) })
  const offHeader = ruleBody(css, 'body[data-mpw-float-off] body[data-mpw-float] .wSkVaW_header')
  r['C2float-off'] = !!offHeader && /box-shadow:\s*none/.test(offHeader)
  /* C3（⑪翻转）：空栏 5 条归零必须在 + 非空栏外壳必须完好（反向） */
  const blankHeader = ruleBody(css, '} html body[data-mpw-hdr-blank][data-mpw-hdr-blank] .wSkVaW_header')
  r['C3a'] = !!blankHeader && /background-color:\s*transparent !important/.test(blankHeader)
    && /backdrop-filter:\s*none !important/.test(blankHeader) && /min-height:\s*0 !important/.test(blankHeader)
  r['C3b'] = !!blankHeader && ['margin: 0 !important', 'padding: 0 !important', 'border-width: 0 !important',
    'border-radius: 0 !important', 'box-shadow: none !important'].every((z) => blankHeader.indexOf(z) >= 0)
  const floatHeader = ruleBody(css, 'body[data-mpw-float] .wSkVaW_header')
  r['C3d'] = !!floatHeader
    && /margin:\s*10px 16px 0(?!\s*!important)/.test(floatHeader)
    && /padding:\s*8px 16px 8px(?!\s*!important)/.test(floatHeader)
    && /border-radius:\s*var\(--mpw-side-radius\)(?!\s*!important)/.test(floatHeader)
    && /box-shadow:\s*var\(--mpw-float-shadow\)(?!\s*!important)/.test(floatHeader)
  return r
}
function cssOfPath(clientPath, settings) {
  reset()
  loadPlugin({ quiet: true, clientPath, settings })
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')
  cancelWorldTimers()
  return css
}
const MUT = [
  { id: 'M1', what: '孤儿裸文本塞回（复刻 55da7a8 注释截断）⇒ A1/B1 必红', expect: ['A1', 'B1标题栏'],
    patch: (s) => s.replace('body[data-mpw-float] .wSkVaW_header {\n\tmargin: 10px 16px 0;',
      '   ②(修正) 变异孤儿文本（无开启符）：headerBg 规则的 border-bottom transparent\n   用 !important 会取消下边线 → 这里用 !important 覆盖回来，圆角描边完整。 */\nbody[data-mpw-float] .wSkVaW_header {\n\tmargin: 10px 16px 0;'),
    verify: (s) => s.indexOf('变异孤儿文本（无开启符）') >= 0 },
  { id: 'M2', what: '标题栏阴影改回异源字面量 ⇒ B4 必红（⑪联动：C3d 的同令牌检查一并红，如实计入）', expect: ['B4阴影', 'C3d'],
    patch: (s) => s.replace('\tborder-radius: var(--mpw-side-radius);\n\tbox-shadow: var(--mpw-float-shadow);\n}\nbody[data-mpw-float] body[data-ds-dark-theme] .wSkVaW_header,',
      '\tborder-radius: var(--mpw-side-radius);\n\tbox-shadow: 0 8px 28px rgba(0,0,0,0.2);\n}\nbody[data-mpw-float] body[data-ds-dark-theme] .wSkVaW_header,'),
    verify: (s) => s.indexOf('box-shadow: 0 8px 28px rgba(0,0,0,0.2);') >= 0 },
  { id: 'M3', what: 'float-off 标题栏重置去掉 box-shadow:none ⇒ C2 必红', expect: ['C2float-off'],
    patch: (s) => s.replace('body[data-mpw-float-off] body[data-mpw-float] .wSkVaW_header {\n\tmargin: 0; padding: 0; border: none; border-radius: 0; box-shadow: none;\n}',
      'body[data-mpw-float-off] body[data-mpw-float] .wSkVaW_header {\n\tmargin: 0; padding: 0; border: none; border-radius: 0;\n}'),
    verify: (s) => /body\[data-mpw-float-off\] body\[data-mpw-float\] \.wSkVaW_header \{\n\tmargin: 0; padding: 0; border: none; border-radius: 0;\n\}/.test(s) },
  { id: 'M4', what: '⑪去掉空栏 5 条归零（回退到 ⑩ 外壳放行形态）⇒ C3b 必红', expect: ['C3b'],
    patch: (s) => s.replace('\tmin-height: 0 !important;\n\tmargin: 0 !important;\n\tpadding: 0 !important;\n\tborder-width: 0 !important;\n\tborder-radius: 0 !important;\n\tbox-shadow: none !important;\n}',
      '\tmin-height: 0 !important;\n}'),
    verify: (s) => !/min-height: 0 !important;\n\tmargin: 0 !important;\n\tpadding: 0 !important;\n\tborder-width: 0 !important;\n\tborder-radius: 0 !important;\n\tbox-shadow: none !important;\n\}/.test(s) },
  { id: 'M5', what: '⑪把归零扩到非空栏（float 标题栏 margin 压成 0 !important）⇒ C3d 必红', expect: ['C3d'],
    patch: (s) => s.replace('body[data-mpw-float] .wSkVaW_header {\n\tmargin: 10px 16px 0;\n\tpadding: 8px 16px 8px;',
      'body[data-mpw-float] .wSkVaW_header {\n\tmargin: 0 !important;\n\tpadding: 8px 16px 8px;'),
    verify: (s) => /body\[data-mpw-float\] \.wSkVaW_header \{\n\tmargin: 0 !important;\n\tpadding: 8px 16px 8px;/.test(s) },
]
let expectRed = [], actualRed = []
for (const m of MUT) {
  const patched = m.patch(CLIENT)
  if (!m.verify(patched)) { fail++; console.error('  ✗ ' + m.id + ' 变异未生效（patch 未命中）'); continue }
  const rr = runChecksOn(patched, path.join(here, '..', 'node_modules', '.tmp-mut', 'float-family-' + m.id + '.js'))
  const red = Object.keys(rr).filter((k) => !rr[k])
  const expOk = m.expect.every((e) => red.includes(e))
  const noExtra = red.every((k) => m.expect.includes(k))
  if (expOk && noExtra) { pass++; console.log('  ✓ ' + m.id + ' ' + m.what + '  [期望红集==' + JSON.stringify(m.expect) + ' == 实际红集==' + JSON.stringify(red) + ']') }
  else { fail++; console.error('  ✗ ' + m.id + '  期望红集==' + JSON.stringify(m.expect) + '  实际红集==' + JSON.stringify(red)) }
  expectRed = expectRed.concat(m.expect); actualRed = actualRed.concat(red)
}
ok('M0 变异红集逐条相等（期望 == 实际）', JSON.stringify([...expectRed].sort()) === JSON.stringify([...actualRed].sort()),
  JSON.stringify({ expect: expectRed.sort(), actual: actualRed.sort() }))

// 清理变异副本
try { fs.rmSync(path.join(here, '..', 'node_modules', '.tmp-mut'), { recursive: true, force: true }) } catch { /* ignore */ }

console.log('\n' + (fail === 0 ? '✓ 全部通过 ' : '✗ 有失败 ') + pass + '/' + (pass + fail))
process.exit(fail === 0 ? 0 : 1)

// tools/glow-fixed-safety-test.mjs —— 2026-10-29 任务书判据（3D 倾斜回归修复的防线）
//
// 背景（真机回归，根因见 lib/client.js 光晕模块头部注释）：
//   2026-10-28 §3 的 3D 倾斜把 transform/perspective 写在 .wSkVaW_header 等**内部含
//   position:fixed 后代的容器**上 ⇒ 容器成为 containing block ⇒ dsh-conversation 的
//   .dsh-conv-panel（fixed，挂在标题栏 slot 内，lib/client.js __convPanelLayerCss 注释取证）
//   被钉进容器局部坐标系 ⇒ 逐帧漂移；跨面移动时祖先链 transform 忽有忽无 ⇒ 位置闪。
//   修复 = 方案 A：倾斜本体移除、光晕保留（四类候选面全含 fixed 后代，方案 B 无处可挂）。
//
// 本文件断言（每条都能被变异变红，见文末 M1–M3）：
//   A1 倾斜本体零残留：无 MPW_TILT_/mpwTilt 标识、无 data-mpw-tilt、无 perspective( 写入
//   A2 光晕模块在位（mpwGlowSync + apply 接线 + 判据出口）
//   A3 float 三处悬浮几何规则都在（float:on 产物），且这三处规则体**无 transform/perspective**
//      （float 靠 margin/padding/border 实现，不与任何 transform 写入者抢属性）
//   B1 「fixed 后代安全」：四类面各挂一个 position:fixed 后代 + 光晕开启 + 指针在面上移动
//      ⇒ 面与 fixed 后代祖先链上零 inline transform/filter/perspective（面板恒相对视口定位）
//   B2 稳定性：指针在标题栏↔左栏间连续移动，每步采样祖先链都干净（等价于浮窗位置不随鼠标变）
//   B3 ⑧(2026-10-30 改向) 光晕写在"面上"：四类面带 data-mpw-glow-face 标记 + --mpw-glow-x/y
//      在面元素上；旧 body 级 [data-mpw-glow] 层零残留（显隐细节由 panel-glow-face-test 覆盖）
//   B4 float 关 ⇒ 光晕全卸（监听 0、面标记全摘）；B4b reduced-motion ⇒ 不启用
//   M1 变异：把 transform 写回面 ⇒ B1 必红
//   M2 变异：面解析恒空（无面被标记）⇒ B3a 必红
//   M3 变异：float 标题栏规则被改成 transform 实现 ⇒ A3 必红
//
// 旧 tilt-glow-test 的断言改向（2026-10-28 → 2026-10-29，不许静默）：
//   · B1 倾斜落点 / B2 白名单行为 / B8 弹层安全阀：随倾斜本体删除（功能不存在，断言对象消失）；
//   · B3 祖先链零 transform：升格为 B1（从"倾斜面的祖先"扩展到"fixed 后代全祖先链"——
//     旧口径漏掉"倾斜元素内部还有 fixed 后代"，正是本次回归的判据缺口）；
//   · B4/B4b 开关关闭、B5 reduced-motion、B6 光晕显隐：保留（演化为 A2/B3/B4）；
//   · B0 apply 接线：保留（A2）。
//
// ⑧2026-10-30 二次改向（不许静默）：光晕从"body 级 fixed 光斑层"重做为"面内背景层"
//   （radial-gradient 叠在面上 + JS 写该面 CSS 变量；旧层被内容盖住 = 真机看不见，
//   2026-10-30 任务书 §0.2）——旧 B3 的"body 层形态/显隐"断言删除，改为 B3a/B3b
//   （面标记 + 变量在面 + 旧层零残留）；B2b 的"跟随"证据从 glow 层 translate3d 改为
//   面变量更新；M1/M2 的锚点随实现更新（写入点在 mpwGlowApply / 解析器）。
//   正向行为判据（四面变量/可见性/淡出/峰值 alpha）在 tools/panel-glow-face-test.mjs。
//
// 用法: node tools/glow-fixed-safety-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwBsTabState',
  '__mpwTiltTest', '__mpwGlowTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

console.log('== A. 静态（倾斜移除 + 光晕保留 + float 完好）==')
ok('A1 倾斜本体零残留：无 MPW_TILT_/mpwTilt 标识、无 data-mpw-tilt、无 perspective( 写入 style',
  !/const MPW_TILT_|function mpwTilt|data-mpw-tilt/.test(CLIENT)
  && !/\.style\.transform\s*=\s*"perspective\(/.test(CLIENT))
ok('A2 光晕模块在位：mpwGlowSync 定义 + apply 接线 + __mpwGlowTest 出口',
  CLIENT.includes('function mpwGlowSync(on)')
  /* ⑫(2026-10-31 §2) 接线串更新：光晕开关（外观第 2 项"鼠标光晕"）接入后，同步点变为
     "悬浮 body 属性 ∧ mpwGlowPref(section)"——悬浮关 ⇒ 光晕强制不生效。 */
  && CLIENT.includes('try { mpwGlowSync(document.body.hasAttribute("data-mpw-float") && mpwGlowPref(section)) } catch {}')
  && CLIENT.includes('globalThis.__mpwGlowTest'))
ok('A2b 倾斜安全阀接线已从快路摘除（mpwTagPopoverFast 不再调用 mpwTiltSafetyOnRecords）',
  !CLIENT.includes('try { mpwTiltSafetyOnRecords(records) } catch (e) {}'))

/* A3：float:on 产物里，三处悬浮几何规则都在，且规则体无 transform/perspective */
const ruleBody = (css, sel) => {
  const i = css.indexOf(sel)
  if (i < 0) return null
  const b0 = css.indexOf('{', i)
  if (b0 < 0) return null
  let depth = 1, j = b0 + 1
  while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++ }
  return css.slice(b0 + 1, j - 1).replace(/\/\*[\s\S]*?\*\//g, '')
}
{
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ float: true }) : '')
  cancelWorldTimers()
  const bodies = {
    左栏: ruleBody(css, 'body[data-mpw-float] .pI_x6G_sidebarCol {'),
    标题栏: ruleBody(css, 'body[data-mpw-float] .wSkVaW_header {'),
    右栏: ruleBody(css, 'html body[data-mpw-float]:not([data-mpw-rightbar-parked]) [data-sidebar-right-panel="push"] {'),
  }
  const bad = Object.keys(bodies).filter((k) => !bodies[k])
  ok('A3a float 三处悬浮几何规则都在（左栏/标题栏/右栏）', bad.length === 0,
    bad.length ? '缺失=' + bad.join(',') : '三处规则体均非空')
  const tfBad = Object.keys(bodies).filter((k) => bodies[k] && /(^|[;\s])(transform|perspective)\s*:/.test(bodies[k]))
  ok('A3b 三处 float 规则体零 transform/perspective（悬浮不靠 transform，无人可抢该属性）',
    tfBad.length === 0, tfBad.length ? '违规=' + tfBad.join(',') : '零命中')
}

/* ---------- 行为夹具：四类面各挂一个 position:fixed 后代 ---------- */
function boot({ reduced = false } = {}) {
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  if (reduced) globalThis.matchMedia = (q) => ({ matches: String(q).indexOf('prefers-reduced-motion') >= 0, addEventListener() {}, removeEventListener() {} })
  const doc = globalThis.document
  const mk = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e }
  const header = mk('header', 'wSkVaW_header')
  const panel = mk('div', 'dsh-conv-panel'); panel.setAttribute('data-conv-panel', '')   // dsh-conversation 大纲浮窗（真机为 position:fixed）
  const composer = mk('div', ''); composer.setAttribute('data-composer-card', '')
  const menu = mk('div', ''); menu.setAttribute('data-trigger-menu', '')                 // 就地渲染的加号菜单
  const side = mk('div', 'pI_x6G_sidebarCol')
  const overlay = mk('div', 'VOzbGW_overlay')                                            // 侧栏内 fixed 弹层（在案形态）
  const right = mk('div', ''); right.setAttribute('data-sidebar-right-panel', 'push')   // ⑧真机形态：push 变体（probe-out/before.float-glow.json）
  const rsPop = mk('div', 'somePop_fixed')
  header.appendChild(panel); composer.appendChild(menu); side.appendChild(overlay); right.appendChild(rsPop)
  doc.body.appendChild(header); doc.body.appendChild(composer); doc.body.appendChild(side); doc.body.appendChild(right)
  const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(doc.body) } catch (e) {} return out }
  doc.querySelectorAll = (s) => allEls().filter((el) => selMatch(el, s))
  doc.querySelector = (s) => doc.querySelectorAll(s)[0] || null
  for (const el of allEls()) {
    el.matches = (s) => selMatch(el, s)
    el.closest = (s) => { for (let p = el; p; p = p.parentElement) { try { if (p.matches && p.matches(s)) return p } catch (e) {} } return null }
  }
  return { doc, header, panel, composer, menu, side, overlay, right, rsPop, T: globalThis.__mpwGlowTest }
}
const selMatch = (el, sel) => {
  for (const one of String(sel || '').split(',')) {
    const t = one.trim()
    if (!t) continue
    // ⑧(2026-10-30) 光晕面选择器带 :not([data-code-block-banner]) 形态 ⇒ 本桩支持拆 :not([attr])
    let base = t, notAttr = null
    const nm = t.match(/^(.*?):not\(\[([^\]]+)\]\)$/)
    if (nm) { base = nm[1]; notAttr = nm[2] }
    let hit = false
    if (/^\[class\*="([^"]+)"\]$/.test(base)) hit = String(el.className || '').indexOf(base.slice(9, -2)) >= 0
    else if (/^\[[^\]=]+\]$/.test(base)) hit = el.hasAttribute(base.slice(1, -1))   // ⑧修正：补收尾 \]（原式缺它 ⇒ attr-only 选择器永不命中）
    else if (/^\[[^\]=]+=["']?[^"']/.test(base)) { const m = base.match(/^\[([^\]=]+)=["']?([^"']+)["']?\]$/); hit = m && el.getAttribute(m[1]) === m[2] }
    else if (/^\./.test(base)) hit = String(el.className || '').split(/\s+/).includes(base.slice(1))
    else if (/^[a-zA-Z][\w-]*$/.test(base)) hit = String(el.tagName).toLowerCase() === base.toLowerCase()
    if (hit && notAttr && el.hasAttribute(notAttr)) hit = false
    if (hit) return true
  }
  return false
}
/** fixed 后代安全判据本体：面板祖先链（含面容器）上零 inline transform/filter/perspective。 */
function chainClean(panelEl) {
  for (let p = panelEl; p; p = p.parentElement) {
    const s = p.style || {}
    if (s.transform) return { ok: false, why: 'transform@' + (p.className || p.tagName) }
    if (s.filter && s.filter !== 'none') return { ok: false, why: 'filter@' + (p.className || p.tagName) }
    if (s.perspective) return { ok: false, why: 'perspective@' + (p.className || p.tagName) }
    if (p === globalThis.document.body) break
  }
  return { ok: true, why: '' }
}

console.log('\n== B. 行为（fixed 后代安全 + 光晕）==')
{
  const F = boot()
  const T = F.T
  const surfaces = [F.header, F.composer, F.side, F.right]
  const panels = [F.panel, F.menu, F.overlay, F.rsPop]
  T.sync(true)
  const st0 = T.state()
  ok('B0 float:true ⇒ 光晕启用（on=true、监听=1）', st0.on === true && st0.listeners === 1)

  /* B1：指针在每类面上移动（target=面内 fixed 后代，等价"鼠标滑过面"）⇒ 面与链上零 transform */
  let b1 = true, b1why = ''
  for (let i = 0; i < surfaces.length; i++) {
    T.move({ target: panels[i], clientX: 100 + i * 50, clientY: 100 })
    T.tick()
    const c = chainClean(panels[i])
    if (!c.ok || surfaces[i].style.transform) { b1 = false; b1why = (c.why || 'surface transform') + '@' + i; break }
  }
  ok('B1 fixed 后代安全：四类面 + 指针移动后，面与 fixed 后代祖先链零 inline transform/filter/perspective',
    b1, b1why || '四链全净')

  /* B2（§3.2 稳定性）：标题栏↔左栏连续移动，每步采样都干净 + 光晕跟随。
     ②(2026-10-30 改向) 光晕改为面内背景层后，"跟随"的证据从 glow 层 translate3d
     变为面 --mpw-glow-x/y 随移动变化（层已不存在）。 */
  let b2 = true, b2why = ''
  const seq = [[F.header, F.panel], [F.side, F.overlay], [F.header, F.panel], [F.side, F.overlay]]
  const glowFollow = []
  for (let k = 0; k < seq.length; k++) {
    T.move({ target: seq[k][0], clientX: 200 + k * 30, clientY: 60 + k * 10 })
    T.tick()
    const c = chainClean(seq[k][1])
    glowFollow.push(!!seq[k][0].style.getPropertyValue('--mpw-glow-x'))
    if (!c.ok) { b2 = false; b2why = c.why + '@step' + k; break }
  }
  ok('B2 稳定性：标题栏↔左栏连续移动，每步祖先链干净（浮窗定位来源不被改写）', b2, b2why || '四步全净')
  ok('B2b 光晕在移动中跟随（面上的 --mpw-glow-x 逐面更新；⑧改向：不再有 glow 层 transform）', glowFollow.every(Boolean))

  /* B3（⑧2026-10-30 改向）：光晕变量写在"面上"、旧 body 层零残留。
     旧断言（body 级 fixed 层形态/显隐）随实现删除；显隐（alpha 0↔1）由
     panel-glow-face-test J3/J6 覆盖。这里保留红线口径：body 不被标记、
     [data-mpw-glow] 层不存在、四类面被标记且带变量。 */
  const surfaces2 = [F.header, F.composer, F.side, F.right]
  for (let i = 0; i < surfaces2.length; i++) { T.move({ target: surfaces2[i], clientX: 20 + i * 10, clientY: 20 }); T.tick() }
  ok('B3a 光晕写在面上：四类面带 data-mpw-glow-face 标记 + --mpw-glow-x/y 变量在面元素上',
    surfaces2.every((s) => s.hasAttribute('data-mpw-glow-face')
      && !!s.style.getPropertyValue('--mpw-glow-x') && !!s.style.getPropertyValue('--mpw-glow-y')))
  ok('B3b 旧 body 层零残留：无 [data-mpw-glow] 节点、body 无 face 标记',
    F.doc.querySelector('[data-mpw-glow]') == null && !F.doc.body.hasAttribute('data-mpw-glow-face'))

  /* B4：开关关闭零效果（保留自旧 B4 的演进版；⑧改向：节点删除 ⇒ 标记全摘） */
  T.sync(false)
  const st4 = T.state()
  ok('B4 float 关 ⇒ 光晕全卸（监听 0、面标记全摘、无 body 层）',
    st4.on === false && st4.listeners === 0 && st4.faceCount === 0
    && F.doc.querySelector('[data-mpw-glow-face]') == null && F.doc.querySelector('[data-mpw-glow]') == null)
  cancelWorldTimers()
}
/* B4b：reduced-motion（保留自旧 B5 的演进版） */
{
  const F = boot({ reduced: true })
  const T = F.T
  T.sync(true)
  const st = T.state()
  ok('B4b reduced-motion ⇒ 光晕不启用（on=false、零监听、无面标记）',
    st.on === false && st.listeners === 0 && st.faceCount === 0)
  cancelWorldTimers()
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: '把 transform 写回面（倾斜回归复刻；⑧改向：写入点在 mpwGlowApply 的面变量之后）⇒ B1 必红', expect: ['B1'],
    patch: (s) => s.replace('\t\t\t\t\tface.style.setProperty("--mpw-glow-r", rad + "px");',
      '\t\t\t\t\tface.style.setProperty("--mpw-glow-r", rad + "px");\n\t\t\t\t\ttry { face.style.transform = "perspective(900px) rotateX(1.6deg)" } catch (e) {}'),
    verify: (s) => s.indexOf('face.style.transform = "perspective(900px) rotateX(1.6deg)"') >= 0 },
  { id: 'M2', what: '面解析恒空（resolve 失效 = 无面被标记，⑧改向自 M2"ensure 空转"）⇒ B3a 必红', expect: ['B3a'],
    patch: (s) => s.replace('for (let n = target, k = 0; n && n.nodeType === 1 && k < 12; n = n.parentElement, k++) {',
      'for (let n = null, k = 0; n && n.nodeType === 1 && k < 12; n = n.parentElement, k++) { /* 变异：解析恒空 */'),
    verify: (s) => s.indexOf('for (let n = null, k = 0;') >= 0 },
  { id: 'M3', what: 'float 标题栏规则被改成 transform 实现 ⇒ A3 必红', expect: ['A3'],
    patch: (s) => s.replace('body[data-mpw-float] .wSkVaW_header {\n\tmargin: 10px 16px 0;', 'body[data-mpw-float] .wSkVaW_header {\n\ttransform: translateY(-2px);\n\tmargin: 10px 16px 0;'),
    verify: (s) => s.indexOf('body[data-mpw-float] .wSkVaW_header {\n\ttransform: translateY(-2px);') >= 0 },
]
function runChecksOn(clientPath) {
  const r = {}
  try {
    reset()
    loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
    const doc = globalThis.document
    /* A3（产物级） */
    const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ float: true }) : '')
    const bodies = {
      左栏: ruleBody(css, 'body[data-mpw-float] .pI_x6G_sidebarCol {'),
      标题栏: ruleBody(css, 'body[data-mpw-float] .wSkVaW_header {'),
      右栏: ruleBody(css, 'html body[data-mpw-float]:not([data-mpw-rightbar-parked]) [data-sidebar-right-panel="push"] {'),
    }
    r['A3'] = bodies.左栏 && bodies.标题栏 && bodies.右栏
      && !Object.keys(bodies).some((k) => /(^|[;\s])(transform|perspective)\s*:/.test(bodies[k]))
    /* B1/B3（行为级，夹具同主流程） */
    const mk = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e }
    const header = mk('header', 'wSkVaW_header')
    const panel = mk('div', 'dsh-conv-panel')
    const side = mk('div', 'pI_x6G_sidebarCol')
    const overlay = mk('div', 'VOzbGW_overlay')
    header.appendChild(panel); side.appendChild(overlay)
    doc.body.appendChild(header); doc.body.appendChild(side)
    const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(doc.body) } catch (e) {} return out }
    doc.querySelectorAll = (s) => allEls().filter((el) => selMatch(el, s))
    doc.querySelector = (s) => doc.querySelectorAll(s)[0] || null
    for (const el of allEls().concat([doc.body])) {
      el.matches = (s) => selMatch(el, s)
      el.closest = (s) => { for (let p = el; p; p = p.parentElement) { try { if (p.matches && p.matches(s)) return p } catch (e) {} } return null }
    }
    const T = globalThis.__mpwGlowTest
    T.sync(true)
    T.move({ target: panel, clientX: 120, clientY: 60 }); T.tick()
    r['B1'] = chainClean(panel).ok && !header.style.transform
    /* ⑧改向：B3 = 面标记 + 变量写在面上（旧"body 层存在"断言随实现删除） */
    r['B3a'] = header.hasAttribute('data-mpw-glow-face') && side.hasAttribute('data-mpw-glow-face')
      && !!header.style.getPropertyValue('--mpw-glow-x') && !!side.style.getPropertyValue('--mpw-glow-x')
    r['B3b'] = !doc.querySelector('[data-mpw-glow]') && !doc.body.hasAttribute('data-mpw-glow-face')
    cancelWorldTimers()
  } catch (e) { /* 判红即结果 */ }
  return r
}
for (const m of MUT) {
  const raw = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const mutated = m.patch(raw)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id + '：变异没有真的打上去（R2）'); continue }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-glowfs-'))
  process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
  const p = path.join(TMP, 'client-mut.js')
  fs.writeFileSync(p, mutated)
  const r = runChecksOn(p)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  const red = m.expect.filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

// tools/panel-glow-face-test.mjs —— 2026-10-30 任务书 §2 判据：面板内鼠标光晕（面内背景层）
//
// 实现口径（lib/client.js 光晕模块 ⑧ 注释 + buildUiCss float 块 ⑧）：
//   · CSS：background-image: radial-gradient(...) 叠在面自身背景上（画在 background-color
//     之上、内容之下）——不占 header ::before/::after（磨砂/高光在用）、不产生层叠上下文、
//     不产生 fixed containing block、不拦事件、不改布局；
//   · JS：document 级 pointermove（rAF 节流）从 target 向上解析"面"，懒打 data-mpw-glow-face
//     标记，写 --mpw-glow-x/y（面内坐标）与 --mpw-glow-r（面长边 30–50%，90–380px 夹取）；
//     alpha 由 rAF 缓动 0↔1（峰值 0.12 在 CSS calc 乘子，≤0.14）。
//   改向记录（不许静默）：取代 2026-10-29 的 body 级 position:fixed; z-index:-1 光斑层 ——
//     它被内容整体盖住 = 真机看不见（2026-10-30 任务书 §0.2 判定"实现存在但看不见"）。
//     glow-fixed-safety-test 的 B3（body 层形态/显隐断言）随实现删除，其红线职责
//     （fixed 后代安全）保留在 glow-fixed-safety-test，并把"面标记 + 变量写在面上"
//     的正向断言移交本文件。
//
// 本文件断言（对应任务书 §2 判据 1–6，每条都能被文末变异变红）：
//   J1 四个面各自产生 --mpw-glow-x/y 更新（桩驱动 pointermove，值随坐标变化）
//   J2 面规则在场且命中：产物 CSS 里 body[data-mpw-float] [data-mpw-glow-face] 规则含
//      radial-gradient + 峰值 alpha 0.12（calc 乘子）；面被标记（规则命中面）；主题令牌两套
//   J3 光的可见性：alpha 变量 > 0 且写在**面上**（不是 body 层；旧 body 层零残留）
//   J4 红线自证：四类面 + fixed 后代祖先链零 transform/filter/perspective/contain
//      （inline 与源码两级），复用 glow-fixed-safety-test 的 B1 思路
//   J5 开关关闭 / reduced-motion ⇒ 零监听、标记全摘、alpha 恒 0
//   J6 淡出：离开面（移到非面元素）/离开窗口 ⇒ alpha 缓动回 0
//   MV1 变异：变量写到 body 上 ⇒ J1/J3 必红（任务书 §2 变异①）
//   MV2 变异：给面加 transform 定位 ⇒ J4 必红（任务书 §2 变异②）
//   MV3 变异：面规则删除 ⇒ J2 必红
//
// 用法: node tools/panel-glow-face-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs')
const CLIENT = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwBsTabState',
  '__mpwTiltTest', '__mpwGlowTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }
function load(settings) { reset(); loadPlugin({ quiet: true, settings }); }

console.log('== A. 产物 CSS（float:on）—— 面规则在场 + 峰值/主题令牌 ==')
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
const FACE_RULE = 'body[data-mpw-float] [data-mpw-glow-face]'
let CSS_ON = '', CSS_OFF = ''
{
  load({ enabled: true, image: 'data:image/png;base64,AAA', float: true })
  CSS_ON = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')
  cancelWorldTimers()
  load({ enabled: true, image: 'data:image/png;base64,AAA', float: false })
  CSS_OFF = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')
  cancelWorldTimers()
}
{
  const b = ruleBody(CSS_ON, FACE_RULE)
  ok('A1 面规则在场：body[data-mpw-float] [data-mpw-glow-face]', !!b, b ? '' : '规则缺失')
  ok('A2 背景层 = radial-gradient（面内光，不是 body 层）', !!b && /background-image:\s*radial-gradient\(/.test(b))
  ok('A3 峰值 alpha = 0.12（calc(var(--mpw-glow-alpha, 0) * 0.12)，≤0.14）',
    !!b && /rgba\(var\(--mpw-glow-rgb, 96 140 255\) \/ calc\(var\(--mpw-glow-alpha, 0\) \* 0\.12\)\)/.test(b))
  const light = ruleBody(CSS_ON, 'body[data-mpw-float]') || ''
  const dark = ruleBody(CSS_ON, 'body[data-ds-dark-theme][data-mpw-float]') || ''
  ok('A4 主题令牌两套（--mpw-glow-rgb 浅/深）',
    /--mpw-glow-rgb:\s*96 140 255/.test(light) && /--mpw-glow-rgb:\s*168 196 255/.test(dark),
    'light=' + (/--mpw-glow-rgb:[^;]+/.exec(light) || ['∅'])[0] + ' dark=' + (/--mpw-glow-rgb:[^;]+/.exec(dark) || ['∅'])[0])
  ok('A5 float:off 产物无面规则（开关同闸）', CSS_OFF.indexOf('[data-mpw-glow-face]') < 0)
}

/* ---------- 行为夹具：四类面各挂一个 position:fixed 后代 ---------- */
function boot({ reduced = false } = {}) {
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  if (reduced) globalThis.matchMedia = (q) => ({ matches: String(q).indexOf('prefers-reduced-motion') >= 0, addEventListener() {}, removeEventListener() {} })
  const doc = globalThis.document
  const mk = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e }
  const header = mk('header', 'wSkVaW_header')
  const panel = mk('div', 'dsh-conv-panel'); panel.setAttribute('data-conv-panel', '')
  const composer = mk('div', ''); composer.setAttribute('data-composer-card', '')
  const menu = mk('div', ''); menu.setAttribute('data-trigger-menu', '')
  const side = mk('div', 'pI_x6G_sidebarCol')
  const overlay = mk('div', 'VOzbGW_overlay')
  const right = mk('div', '')
  right.setAttribute('data-sidebar-right-panel', 'push')
  const rsPop = mk('div', 'somePop_fixed')
  header.appendChild(panel); composer.appendChild(menu); side.appendChild(overlay); right.appendChild(rsPop)
  doc.body.appendChild(header); doc.body.appendChild(composer); doc.body.appendChild(side); doc.body.appendChild(right)
  const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(doc.body) } catch (e) {} return out }
  doc.querySelectorAll = (s) => allEls().filter((el) => selMatch(el, s))
  doc.querySelector = (s) => doc.querySelectorAll(s)[0] || null
  for (const el of allEls().concat([doc.body])) {
    el.matches = (s) => selMatch(el, s)
    el.closest = (s) => { for (let p = el; p; p = p.parentElement) { try { if (p.matches && p.matches(s)) return p } catch (e) {} } return null }
  }
  return { doc, header, panel, composer, menu, side, overlay, right, rsPop, T: globalThis.__mpwGlowTest }
}
const selMatch = (el, sel) => {
  for (const one of String(sel || '').split(',')) {
    const t = one.trim()
    if (!t) continue
    // 拆 :not([attr]) 尾巴（光晕面选择器的形态；本桩只支持这一种 :not）
    let base = t, notAttr = null
    const nm = t.match(/^(.*?):not\(\[([^\]]+)\]\)$/)
    if (nm) { base = nm[1]; notAttr = nm[2] }
    let hit = false
    if (/^\[class\*="([^"]+)"\]$/.test(base)) hit = String(el.className || '').indexOf(base.slice(9, -2)) >= 0
    else { const m = base.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/)
      if (m) hit = m[2] !== undefined ? el.getAttribute(m[1]) === m[2] : el.hasAttribute(m[1])
      else if (/^\./.test(base)) hit = String(el.className || '').split(/\s+/).includes(base.slice(1))
      else if (/^[a-zA-Z][\w-]*$/.test(base)) hit = String(el.tagName).toLowerCase() === base.toLowerCase() }
    if (hit && notAttr && el.hasAttribute(notAttr)) hit = false
    if (hit) return true
  }
  return false
}
const chainClean = (panelEl) => {
  for (let p = panelEl; p; p = p.parentElement) {
    const s = p.style || {}
    if (s.transform) return { ok: false, why: 'transform@' + (p.className || p.tagName) }
    if (s.filter && s.filter !== 'none') return { ok: false, why: 'filter@' + (p.className || p.tagName) }
    if (s.perspective) return { ok: false, why: 'perspective@' + (p.className || p.tagName) }
    if (s.contain && s.contain !== 'none') return { ok: false, why: 'contain@' + (p.className || p.tagName) }
    if (p === globalThis.document.body) break
  }
  return { ok: true, why: '' }
}
const varsOf = (el) => ({
  x: el.style.getPropertyValue('--mpw-glow-x'),
  y: el.style.getPropertyValue('--mpw-glow-y'),
  r: el.style.getPropertyValue('--mpw-glow-r'),
  a: el.style.getPropertyValue('--mpw-glow-alpha'),
  marked: el.hasAttribute('data-mpw-glow-face'),
})
const tickN = async (T, n) => { for (let i = 0; i < n; i++) T.tick(); await new Promise((r) => setTimeout(r, 0)) }

console.log('\n== B. 行为（四面变量 / 可见性 / 红线 / 淡出 / 开关）==')
{
  const F = boot()
  const T = F.T
  const surfaces = [F.header, F.side, F.right, F.composer]
  const inFace = [F.panel, F.overlay, F.rsPop, F.menu]   // 指针目标 = 面内 fixed 后代（等价"鼠标滑过面"）
  T.sync(true)
  const st0 = T.state()
  ok('B0 float:true ⇒ 光晕启用（on、监听=1）', st0.on === true && st0.listeners === 1)

  /* J1：四面各自写 x/y，且随坐标变化 */
  let j1 = true, j1why = ''
  for (let i = 0; i < surfaces.length; i++) {
    T.move({ target: inFace[i], clientX: 40 + i * 30, clientY: 30 + i * 10 }); T.tick()
    const v = varsOf(surfaces[i])
    if (!v.marked || !v.x || !v.y) { j1 = false; j1why = '面' + i + ' 未标记或未写 x/y: ' + JSON.stringify(v); break }
    T.move({ target: inFace[i], clientX: 90 + i * 30, clientY: 70 + i * 10 }); T.tick()
    const v2 = varsOf(surfaces[i])
    if (v2.x === v.x || v2.y === v.y) { j1 = false; j1why = '面' + i + ' 坐标未随移动变化'; break }
  }
  ok('J1 四个面各自产生 --mpw-glow-x/y 且值随坐标变化', j1, j1why)

  /* J2：面被标记（规则命中面） */
  ok('J2 四面都带 data-mpw-glow-face 标记（CSS 面规则命中）', surfaces.every((s) => s.hasAttribute('data-mpw-glow-face')))

  /* J3：alpha 到站 = 1，写在面上；body 无标记、旧 body 层零残留 */
  T.move({ target: F.panel, clientX: 60, clientY: 40 })
  await tickN(T, 30)
  const st3 = T.state()
  const hv = varsOf(F.header)
  ok('J3 光可见：alpha=1 写在面上（面内坐标系，非 body 层）',
    parseFloat(hv.a) === 1 && st3.faceAlpha === 1 && !F.doc.body.hasAttribute('data-mpw-glow-face') && !F.doc.querySelector('[data-mpw-glow]'),
    'faceAlpha=' + st3.faceAlpha + ' bodyMarked=' + F.doc.body.hasAttribute('data-mpw-glow-face'))
  ok('J3b 半径在 90–380px（面长边 30–50% 夹取）', parseFloat(hv.r) >= 90 && parseFloat(hv.r) <= 380, 'r=' + hv.r)

  /* J4：红线 —— 指针扫过四类面（含 fixed 后代），面与链零 transform/filter/perspective/contain */
  let j4 = true, j4why = ''
  for (let i = 0; i < surfaces.length; i++) {
    T.move({ target: inFace[i], clientX: 100 + i * 20, clientY: 100 }); T.tick()
    const c = chainClean(inFace[i])
    if (!c.ok || surfaces[i].style.transform) { j4 = false; j4why = (c.why || 'surface transform') + '@面' + i; break }
  }
  const glowMod = CLIENT.slice(CLIENT.indexOf('const MPW_GLOW_FACE_SEL'), CLIENT.indexOf('function mpwGlowSync'))
  ok('J4 红线：四类面 + fixed 后代祖先链零 transform/filter/perspective/contain（inline 级）', j4, j4why)
  ok('J4b 红线：光晕模块源码零 transform/filter/perspective 写入（源码级）',
    !/\.style\.(transform|filter|perspective)\s*=/.test(glowMod) && !/perspective\(/.test(glowMod))

  /* J6：淡出 —— 移到非面元素 / 离开窗口 */
  const plain = F.doc.createElement('div')
  F.doc.body.appendChild(plain)
  T.move({ target: plain, clientX: 200, clientY: 200 })
  await tickN(T, 30)
  const aAfterLeave = parseFloat(varsOf(F.header).a)
  T.move({ target: F.panel, clientX: 50, clientY: 50 })
  await tickN(T, 30)
  T.out({ relatedTarget: null })
  await tickN(T, 30)
  const aAfterOut = parseFloat(varsOf(F.header).a)
  ok('J6 淡出：离开面 ⇒ alpha 回 0；离开窗口 ⇒ alpha 回 0',
    aAfterLeave === 0 && aAfterOut === 0, 'leave=' + aAfterLeave + ' out=' + aAfterOut)

  /* J5：开关关闭零残留 */
  T.sync(false)
  const st5 = T.state()
  ok('J5 float 关 ⇒ 全卸（监听 0、标记全摘、无 lit）',
    st5.on === false && st5.listeners === 0 && st5.faceCount === 0 && Object.keys(st5.lit).length === 0
    && surfaces.every((s) => !s.hasAttribute('data-mpw-glow-face')))
  cancelWorldTimers()
}
/* J5b：reduced-motion */
{
  const F = boot({ reduced: true })
  const T = F.T
  T.sync(true)
  const st = T.state()
  T.move({ target: F.header, clientX: 10, clientY: 10 }); T.tick()
  ok('J5b reduced-motion ⇒ 不启用（on=false、零监听、零标记、alpha 恒 0）',
    st.on === false && st.listeners === 0 && st.faceCount === 0
    && !F.header.hasAttribute('data-mpw-glow-face') && !F.header.style.getPropertyValue('--mpw-glow-alpha'))
  cancelWorldTimers()
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
function behaviorChecks(clientText, clientPath) {
  fs.mkdirSync(path.dirname(clientPath), { recursive: true })
  fs.writeFileSync(clientPath, clientText)
  reset()
  loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  const doc = globalThis.document
  const r = {}
  /* 产物级 J2 */
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')
  const b = ruleBody(css, FACE_RULE)
  r['J2'] = !!b && /background-image:\s*radial-gradient\(/.test(b)
    && /rgba\(var\(--mpw-glow-rgb, 96 140 255\) \/ calc\(var\(--mpw-glow-alpha, 0\) \* 0\.12\)\)/.test(b)
  /* 行为级 J1/J3/J4（夹具同主流程） */
  const mk = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e }
  const header = mk('header', 'wSkVaW_header')
  const panel = mk('div', 'dsh-conv-panel')
  const side = mk('div', 'pI_x6G_sidebarCol')
  const overlay = mk('div', 'VOzbGW_overlay')
  header.appendChild(panel); side.appendChild(overlay)
  doc.body.appendChild(header); doc.body.appendChild(side)
  const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(doc.body) } catch (e2) {} return out }
  doc.querySelectorAll = (s) => allEls().filter((el) => selMatch(el, s))
  doc.querySelector = (s) => doc.querySelectorAll(s)[0] || null
  for (const el of allEls().concat([doc.body])) {
    el.matches = (s) => selMatch(el, s)
    el.closest = (s) => { for (let p = el; p; p = p.parentElement) { try { if (p.matches && p.matches(s)) return p } catch (e2) {} } return null }
  }
  const T = globalThis.__mpwGlowTest
  T.sync(true)
  T.move({ target: panel, clientX: 44, clientY: 33 }); T.tick()
  const v1 = { x: header.style.getPropertyValue('--mpw-glow-x'), y: header.style.getPropertyValue('--mpw-glow-y'), marked: header.hasAttribute('data-mpw-glow-face') }
  T.move({ target: panel, clientX: 88, clientY: 66 }); T.tick()
  const v2 = { x: header.style.getPropertyValue('--mpw-glow-x'), y: header.style.getPropertyValue('--mpw-glow-y') }
  r['J1'] = !!v1.marked && !!v1.x && !!v1.y && v2.x !== v1.x && v2.y !== v1.y
  for (let i = 0; i < 30; i++) T.tick()
  const a = parseFloat(header.style.getPropertyValue('--mpw-glow-alpha'))
  r['J3'] = a === 1 && !doc.body.hasAttribute('data-mpw-glow-face') && !doc.querySelector('[data-mpw-glow]')
  r['J4'] = chainClean(panel).ok && !header.style.transform
  T.sync(false)
  cancelWorldTimers()
  return r
}
const MUT = [
  { id: 'MV1', what: '变量解析改成 body（写到 body 上而非面，任务书 §2 变异①）⇒ J1/J3 必红', expect: ['J1', 'J3'],
    patch: (s) => s.replace('function mpwGlowApply(ev) {\n\t\t\t\tconst st = mpwGlowSt;\n\t\t\t\tconst face = mpwGlowResolve(ev && ev.target);',
      'function mpwGlowApply(ev) {\n\t\t\t\tconst st = mpwGlowSt;\n\t\t\t\tconst face = document.body; /* 变异：变量写到 body 上，面不再被标记 */'),
    verify: (s) => s.indexOf('const face = document.body; /* 变异：变量写到 body 上，面不再被标记 */') >= 0 },
  { id: 'MV2', what: '给面加 transform 定位（任务书 §2 变异②）⇒ J4 必红', expect: ['J4'],
    patch: (s) => s.replace('\t\t\t\t\tface.style.setProperty("--mpw-glow-r", rad + "px");',
      '\t\t\t\t\tface.style.setProperty("--mpw-glow-r", rad + "px");\n\t\t\t\t\ttry { face.style.transform = "translateZ(0)" } catch (e) {}'),
    verify: (s) => s.indexOf('face.style.transform = "translateZ(0)"') >= 0 },
  { id: 'MV3', what: '面规则删除 ⇒ J2 必红', expect: ['J2'],
    patch: (s) => s.replace('body[data-mpw-float] [data-mpw-glow-face] {\n\tbackground-image: radial-gradient(var(--mpw-glow-r, 240px) circle at var(--mpw-glow-x, 50%) var(--mpw-glow-y, 50%), rgba(var(--mpw-glow-rgb, 96 140 255) / calc(var(--mpw-glow-alpha, 0) * 0.12)), rgba(var(--mpw-glow-rgb, 96 140 255) / 0) 70%);\n}', '/* 面规则已变异移除 */'),
    verify: (s) => s.indexOf('radial-gradient(var(--mpw-glow-r, 240px)') < 0 },
]
let expectRed = [], actualRed = []
for (const m of MUT) {
  const patched = m.patch(CLIENT)
  if (!m.verify(patched)) { fail++; console.error('  ✗ ' + m.id + ' 变异未生效（patch 未命中）'); continue }
  const rr = behaviorChecks(patched, path.join(here, '..', 'node_modules', '.tmp-mut', 'panel-glow-' + m.id + '.js'))
  const red = Object.keys(rr).filter((k) => !rr[k])
  const expOk = m.expect.every((e) => red.includes(e))
  const noExtra = red.every((k) => m.expect.includes(k))
  if (expOk && noExtra) { pass++; console.log('  ✓ ' + m.id + ' ' + m.what + '  [期望红集==' + JSON.stringify(m.expect) + ' == 实际红集==' + JSON.stringify(red) + ']') }
  else { fail++; console.error('  ✗ ' + m.id + '  期望红集==' + JSON.stringify(m.expect) + '  实际红集==' + JSON.stringify(red)) }
  expectRed = expectRed.concat(m.expect); actualRed = actualRed.concat(red)
}
ok('M0 变异红集逐条相等（期望 == 实际）', JSON.stringify([...expectRed].sort()) === JSON.stringify([...actualRed].sort()),
  JSON.stringify({ expect: expectRed.sort(), actual: actualRed.sort() }))
try { fs.rmSync(path.join(here, '..', 'node_modules', '.tmp-mut'), { recursive: true, force: true }) } catch { /* ignore */ }

console.log('\n' + (fail === 0 ? '✓ 全部通过 ' : '✗ 有失败 ') + pass + '/' + (pass + fail))
process.exit(fail === 0 ? 0 : 1)

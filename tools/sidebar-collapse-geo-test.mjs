// tools/sidebar-collapse-geo-test.mjs —— 2026-10-28 任务书 §1「左栏收起态三问题」判据
//
// 三问题与修法（命中清单见交付报告；判据逐条可失败，变异见文末 M1–M4）：
//   ① 圆角不一致（展开 20px / 收起 12px）→ 两态 + sidebar 根收敛到同一枚令牌
//      --mpw-side-radius（宿主 --dsw-alias-radius-l2，缺省 12px），A2 逐键相等。
//   ② 图标抖动/回弹 → 我们的 margin/padding 过渡（旧 0.18s ease）与宿主
//      .pI_x6G_frame{transition:grid-template-columns var(--ds-transition-duration-slow)
//      var(--ds-ease-in-out)}（= 0.3s cubic-bezier(.4,0,.2,1)，宿主包实测）两条曲线赛跑；
//      改成同参数同令牌（A3/A4/A5），并在宿主瞬移（[data-dragging]）与 reduced-motion 下让位。
//   ③ tooltip 被外壳 overflow:hidden 裁掉 → 「截断兜底」姊妹版：气泡开着期间给裁切祖先打
//      data-mpw-tip-unclip（B 组）；auto/scroll 滚动容器永不打标（B3）。
//
// 用法: node tools/sidebar-collapse-geo-test.mjs
import fs from 'node:fs'
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
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwBsTabState']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

/* ---------- A 组：buildCss 真产物（float:on）里的统一几何 ---------- */
let world = null
function boot(settings) {
  reset()
  world = loadPlugin({ quiet: true, settings: settings || { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
}
const cssFloat = () => {
  boot()
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
const decl = (body, prop) => {
  const m = body && new RegExp('(?:^|[;\\s])' + prop.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*:\\s*([^;]+)').exec(body)
  return m ? m[1].trim() : null
}

console.log('== A. 统一收起/展开几何（buildCss float:on 真产物）==')
{
  const css = cssFloat()
  const tokenDef = ruleBody(css, 'body[data-mpw-float] {\n\t--mpw-side-radius') || ruleBody(css, '--mpw-side-radius:')
  ok('A1 统一令牌单点定义：--mpw-side-radius / --mpw-side-dur / --mpw-side-ease 都在 float 块',
    /--mpw-side-radius:\s*var\(--dsw-alias-radius-l2, 12px\)/.test(css)
    && /--mpw-side-dur:\s*var\(--ds-transition-duration-slow, 0\.3s\)/.test(css)
    && /--mpw-side-ease:\s*var\(--ds-ease-in-out, cubic-bezier\(0\.4, 0, 0\.2, 1\)\)/.test(css))

  const expanded = ruleBody(css, 'body[data-mpw-float] .pI_x6G_sidebarCol {')
  const collapsed = ruleBody(css, 'body[data-mpw-float] [data-sidebar-collapsed] .pI_x6G_sidebarCol,')
  const sideRoot = ruleBody(css, 'body[data-mpw-float] [data-mpw-sidebar-root] {')
  const rExp = decl(expanded, 'border-radius'), rCol = decl(collapsed, 'border-radius'), rRoot = decl(sideRoot, 'border-radius')
  ok('A2 两态 + sidebar 根圆角逐键相等（同一计算来源 var(--mpw-side-radius)）',
    rExp === 'var(--mpw-side-radius)' && rCol === 'var(--mpw-side-radius)' && rRoot === 'var(--mpw-side-radius)',
    `展开=${rExp} 收起=${rCol} 根=${rRoot}`)

  const tExp = decl(expanded, 'transition'), tCol = decl(collapsed, 'transition')
  ok('A3 两态 transition 逐字一致（同令牌同参数；且不再含 border-radius/border-color 过渡）',
    tExp && tExp === tCol && tExp.indexOf('--mpw-side-dur') >= 0 && tExp.indexOf('--mpw-side-ease') >= 0
    && tExp.indexOf('border-radius') < 0 && tExp.indexOf('border-color') < 0,
    `展开=${tExp}`)

  /* 宿主瞬移（拖拽）让位 = 玻璃统一块既有规则（无 float 门控、!important、覆盖 sidebarCol 一族） */
  ok('A4 宿主瞬移让位（既有规则）：body[data-dragging]/[data-dsh-sidebar-dragging] ⇒ sidebarCol transition:none !important',
    /html body\[data-dsh-sidebar-dragging\] \[class\*="sidebarCol"\],[\s\S]{0,200}?html body\[data-dragging\] \[class\*="sidebarCol"\],[\s\S]{0,80}?\{[^}]*transition:\s*none !important;/.test(css))
  ok('A5 reduced-motion 让位：@media (prefers-reduced-motion: reduce) 下 sidebarCol transition:none',
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?body\[data-mpw-float\] \.pI_x6G_sidebarCol,\s*\n\s*body\[data-mpw-float\] \[class\*="sidebarCol"\] \{\s*\n\t\ttransition: none;\s*\n\s*\}/.test(css))

  /* 反向对照（独立实现口径，R4）：侧栏三处规则的 border-radius 声明里不许再出现任何像素字面量 */
  const radiusLiterals = [expanded, collapsed, sideRoot]
    .map((b) => (b.match(/border-radius\s*:\s*([^;]+);/g) || []).join(' '))
    .join(' ')
  ok('A6 反向：侧栏 float 规则的 border-radius 声明里无像素字面量残留（全部走令牌）',
    /\dpx/.test(radiusLiterals) === false, '声明=' + radiusLiterals.trim())
}

console.log('\n== B. tooltip 去裁切（行为：真实现 __mpwPopUntruncTest.tipFast/tipSync）==')
/* 夹具：shell(裁切外壳) > root > btn > tip(role=tooltip)。
   桩选择器仿真：支持逗号列表 + [class*="x"] + [attr] + [attr="v"] + .wSkVaW_header(带 :not 数据块横幅排除)。 */
const attrMatch = (el, sel) => {
  const s = String(sel || '').trim()
  let m = /^\[class\*="([^"]+)"\]$/.exec(s)
  if (m) return String(el.className || '').indexOf(m[1]) >= 0
  m = /^\[([^\]=~^$|]+)="([^"]*)"\]$/.exec(s)
  if (m) return el.getAttribute(m[1]) === m[2]
  m = /^\[([^\]=~^$|]+)\]$/.exec(s)
  if (m) return el.hasAttribute(m[1])
  m = /^\.([A-Za-z0-9_-]+)(?::|$)/.exec(s)
  if (m) return String(el.className || '').indexOf(m[1]) >= 0 && !(s.indexOf('data-code-block-banner') >= 0 && el.hasAttribute('data-code-block-banner'))
  return false
}
const selMatch = (el, sel) => String(sel || '').split(',').some((s) => attrMatch(el, s))
function installSelShims() {
  const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(globalThis.document.body) } catch (e) {} return out }
  globalThis.document.querySelectorAll = (sel) => allEls().filter((el) => {
    const s = String(sel)
    if (s === '[data-mpw-tip-unclip]' || s === MPW_TIP_MARK) return el.hasAttribute('data-mpw-tip-unclip')
    return selMatch(el, sel)
  })
  globalThis.document.querySelector = (sel) => globalThis.document.querySelectorAll(sel)[0] || null
  for (const el of allEls()) {
    el.matches = (s) => selMatch(el, s)
    el.querySelectorAll = (s) => allEls().filter((x) => x !== el && contains(el, x) && selMatch(x, s))
    el.querySelector = (s) => el.querySelectorAll(s)[0] || null
  }
}
const contains = (a, b) => { for (let p = b; p; p = p.parentElement) if (p === a) return true; return false }
const MPW_TIP_MARK = '[data-mpw-tip-unclip][data-mpw-tip-unclip]'
const base = globalThis.getComputedStyle
function withCs(el, cs) { el.__cs = cs; return el }
function bootB() {
  boot({ enabled: true, image: 'data:image/png;base64,AAA', float: true })
  globalThis.getComputedStyle = (el) => {
    if (el && el.__cs) { const d = Object.assign({}, base(el)); for (const k of Object.keys(el.__cs)) d[k] = el.__cs[k]; return d }
    return base(el)
  }
}
function buildShell({ overflow = 'hidden' } = {}) {
  const doc = globalThis.document
  const shell = doc.createElement('div'); shell.className = 'pI_x6G_sidebarCol'
  const root = doc.createElement('div'); root.className = 'wSkVaW_root'
  const btn = doc.createElement('button')
  const tip = doc.createElement('div'); tip.setAttribute('role', 'tooltip'); tip.textContent = '收起侧边栏'
  withCs(shell, { overflow, position: 'relative' })
  doc.body.appendChild(shell); shell.appendChild(root); root.appendChild(btn); btn.appendChild(tip)
  installSelShims()
  return { shell, root, btn, tip }
}

{
  bootB()
  const T = globalThis.__mpwPopUntruncTest
  ok('B0 判据出口在（tipFast/tipSync/tipClips）', !!T && typeof T.tipFast === 'function' && typeof T.tipSync === 'function' && typeof T.tipClips === 'function')

  /* B1：气泡插入帧 ⇒ 裁切祖先同帧打标（= 打标后真实浏览器里该祖先 overflow 变 visible，
     tooltip 的 rect 不再被裁剪 —— 结构前提与 CSS 放开规则成对断言，见 B5） */
  const f1 = buildShell({})
  const n1 = T.tipFast(f1.tip)
  ok('B1 气泡在裁切外壳内 ⇒ tipFast 同帧给外壳打 data-mpw-tip-unclip（渲染前生效）',
    n1 >= 1 && f1.shell.hasAttribute('data-mpw-tip-unclip'), 'n=' + n1)

  /* B1b：观察器快路（addedNodes 批次）也接线 —— 用新外壳（幂等台账不混用） */
  const f1b = buildShell({})
  const n1b = T.fastPath([{ type: 'childList', target: f1b.shell, addedNodes: [f1b.tip] }])
  ok('B1b 观察器快路（mpwTagPopoverFast addedNodes）对插入帧同步打标（接线在位）',
    n1b >= 0 && f1b.shell.hasAttribute('data-mpw-tip-unclip'))

  /* B2：气泡移除 ⇒ 同一趟回收（宿主逐字还原） */
  f1.btn.removeChild(f1.tip)
  const n2 = T.tipSync()
  ok('B2 气泡移除 ⇒ tipSync 摘标（外壳还原，不再有 data-mpw-tip-unclip）',
    n2 >= 1 && !f1.shell.hasAttribute('data-mpw-tip-unclip'), 'n=' + n2)

  /* B3 反向：滚动容器（auto）永不打标 —— 放开会破坏滚动 */
  const f3 = buildShell({ overflow: 'auto' })
  const n3 = T.tipFast(f3.tip)
  ok('B3 反向：滚动容器 overflow:auto ⇒ 不打标（滚动行为不许被破坏）',
    n3 === 0 && !f3.shell.hasAttribute('data-mpw-tip-unclip'), 'n=' + n3)

  /* B4 反向：外壳里没气泡 ⇒ 无标记 */
  const f4 = buildShell({})
  f4.btn.removeChild(f4.tip)
  const n4 = T.tipSync()
  ok('B4 反向：无气泡 ⇒ 不打标、已有标记被回收', !f4.shell.hasAttribute('data-mpw-tip-unclip'), 'n=' + n4)

  ok('B5 CSS 放开规则在（!important，与打标成对）：[data-mpw-tip-unclip] ⇒ overflow visible',
    /\[data-mpw-tip-unclip\]\[data-mpw-tip-unclip\] \{[^}]*overflow:\s*visible !important;/.test(CLIENT))
  cancelWorldTimers()
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUTANTS = [
  { id: 'M1', what: '展开态圆角改回 20px 硬编码 ⇒ A2 必红', expect: ['A2'],
    patch: (s) => s.replace('body[data-mpw-float] .pI_x6G_sidebarCol {\n\tmargin: 12px;\n\tpadding: 10px 12px 14px;\n\tborder: 1px solid rgba(19,45,83,0.26);\n\tborder-radius: var(--mpw-side-radius);', 'body[data-mpw-float] .pI_x6G_sidebarCol {\n\tmargin: 12px;\n\tpadding: 10px 12px 14px;\n\tborder: 1px solid rgba(19,45,83,0.26);\n\tborder-radius: 20px;'),
    verify: (s) => s.indexOf('border-radius: 20px;\n\toverflow: hidden;') >= 0 },
  { id: 'M2', what: '收起态过渡改回 0.18s ease ⇒ A3 必红', expect: ['A3'],
    patch: (s) => s.replace('transition: margin var(--mpw-side-dur) var(--mpw-side-ease), padding var(--mpw-side-dur) var(--mpw-side-ease);\n}', 'transition: margin 0.18s ease, padding 0.18s ease;\n}'),
    verify: (s) => s.indexOf('transition: margin 0.18s ease, padding 0.18s ease;') >= 0 },
  { id: 'M3', what: '快路接线去掉（mpwTipUnclipFast 不再被 mpwTagPopoverFast 调用）⇒ B1b 必红', expect: ['B1b'],
    patch: (s) => s.replace('/* ①(2026-10-28 任务书 §1) 气泡插入帧同步去裁切（渲染前生效） */\n\t\t\t\t\t\ttry { mpwTipUnclipFast(node) } catch (e) {}', '/* 快路接线已变异移除 */'),
    verify: (s) => s.indexOf('try { mpwTipUnclipFast(node) } catch (e) {}') < 0 },
  { id: 'M4', what: 'CSS 放开规则删除 ⇒ B5 必红', expect: ['B5'],
    patch: (s) => s.replace('[data-mpw-tip-unclip][data-mpw-tip-unclip] {\n\toverflow: visible !important;\n\toverflow-x: visible !important;\n\toverflow-y: visible !important;\n}', '/* 放开规则已变异移除 */'),
    verify: (s) => s.indexOf('[data-mpw-tip-unclip][data-mpw-tip-unclip]') < 0 },
]
function runChecks(clientPath) {
  const r = { A2: false, A3: false, B1b: false, B5: false }
  try {
    reset()
    loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
    const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ float: true }) : '')
    const expanded = ruleBody(css, 'body[data-mpw-float] .pI_x6G_sidebarCol {')
    const collapsed = ruleBody(css, 'body[data-mpw-float] [data-sidebar-collapsed] .pI_x6G_sidebarCol,')
    r.A2 = decl(expanded, 'border-radius') === 'var(--mpw-side-radius)' && decl(collapsed, 'border-radius') === 'var(--mpw-side-radius)'
      && decl(ruleBody(css, 'body[data-mpw-float] [data-mpw-sidebar-root] {'), 'border-radius') === 'var(--mpw-side-radius)'
    const tExp = decl(expanded, 'transition'), tCol = decl(collapsed, 'transition')
    r.A3 = !!tExp && tExp === tCol && tExp.indexOf('--mpw-side-dur') >= 0
    r.B5 = /\[data-mpw-tip-unclip\]\[data-mpw-tip-unclip\] \{[^}]*overflow:\s*visible !important;/.test(css)
    cancelWorldTimers()
  } catch (e) { /* 判红即结果 */ }
  try { reset(); loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
    globalThis.getComputedStyle = (el) => { if (el && el.__cs) { const d = Object.assign({}, base(el)); for (const k of Object.keys(el.__cs)) d[k] = el.__cs[k]; return d } return base(el) }
    const T = globalThis.__mpwPopUntruncTest
    const f1b = buildShell({})
    const n1b = T.fastPath([{ type: 'childList', target: f1b.shell, addedNodes: [f1b.tip] }])
    r.B1b = n1b >= 0 && f1b.shell.hasAttribute('data-mpw-tip-unclip')
    cancelWorldTimers()
  } catch (e) { /* 判红即结果 */ }
  return r
}
for (const m of MUTANTS) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const mutated = m.patch(src)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id + '：变异没有真的打上去（R2）——锚点/唯一性检查'); continue }
  const tmp = path.join(ROOT, 'tools', 'probe-out', '.mut-' + m.id + '.client.js')
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, mutated)
  let red
  try {
    const r = runChecks(tmp)
    red = Object.keys(m.expect).length ? m.expect.filter((id) => !r[id]) : []
    red = m.expect.filter((id) => !r[id])   // 期望红的项实际没红 ⇒ 收进实际红集
  } catch (e) { red = m.expect.slice() }   // 副本整个跑挂 ⇒ 判红成立
  try { fs.unlinkSync(tmp) } catch {}
  const expectRed = m.expect
  const eq = expectRed.length === red.length && expectRed.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(expectRed) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(expectRed) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

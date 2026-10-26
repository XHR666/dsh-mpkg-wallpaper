// tools/tilt-glow-test.mjs —— 2026-10-28 任务书 §3「3D 微倾斜 + 鼠标光晕」判据
//
// 许可红线（任务书 §3）：参考项目 DSH-Transparent-UI-Plugin 是 AGPL-3.0 —— 本实现为
// **独立实现**：只参考"效果描述与交互形态"，未复制/未翻译/未改写其源码、注释、常量组织。
//
// 断言清单（每条都能被变异变红；变异见文末 M1–M3）：
//   A1 静态接线：引擎在 lib/client.js、applyFromStorageInner 在 float 属性落定后调 sync、
//      弹层安全阀接进观察器快路、判据出口暴露
//   A2 白名单恰四类：composer / 右栏 / 左侧栏（排除右栏）/ 标题栏（排除代码块横幅）；
//      白名单不含任何正文/消息区选择器
//   A3 许可说明在位：实现注释写明"独立实现，未复制 AGPL 代码"
//   B0 apply 接线：float:true ⇒ 引擎启用（data-mpw-tilt + on）；float:false ⇒ 全关
//   B1 倾斜落点：move 到左侧栏上 ⇒ transform 只写在该面上（perspective+rotateX+rotateY）
//   B2 白名单行为：move 到正文元素上 ⇒ 不产生任何新 transform（curEl=null）
//   B3 祖先链干净：倾斜活跃时，被倾斜面的祖先链 style.transform 全空
//   B4 开关关闭零效果：sync(false) ⇒ 监听 0、光晕节点删除、transform 清零；后续 move 无效
//   B5 reduced-motion：matchMedia reduce ⇒ sync(true) 也完全不启用（零监听/零节点）
//   B6 光晕：move ⇒ 光晕节点出现（data-mpw-glow、opacity=1、translate3d 跟随）；zero ⇒ opacity=0
//   B7 按住判据：float-off / side-lift ⇒ hold=true（弹层打开期间不许倾斜）
//   B8 弹层安全阀：倾斜活跃 + 弹层插入记录 ⇒ 当帧清零 + holdUntil 压制重倾斜
//
// 用法: node tools/tilt-glow-test.mjs
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
  '__mpwTiltTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

console.log('== A. 静态接线 ==')
ok('A1 引擎在位：mpwTiltGlowSync 定义 + applyFromStorageInner 在 float 属性后调用 + 安全阀进快路 + 判据出口',
  CLIENT.includes('function mpwTiltGlowSync(on)')
  && CLIENT.includes('try { mpwTiltGlowSync(document.body.hasAttribute("data-mpw-float")) } catch {}')
  && CLIENT.includes('try { mpwTiltSafetyOnRecords(records) } catch (e) {}')
  && CLIENT.includes("globalThis.__mpwTiltTest"))
{
  /* A2：从源码抽出白名单选择器（跨行字符串拼接 → 取到终止分号，拼回单串），
     断言恰四类、无正文/消息区 */
  const i = CLIENT.indexOf('const MPW_TILT_SURF_SEL = ')
  const j = CLIENT.indexOf("';", i)
  const sel = CLIENT.slice(i, j + 2).replace(/const MPW_TILT_SURF_SEL = |[+;]|'/g, '').replace(/\s+/g, ' ').trim()
  ok('A2a 白名单含四类作用面（composer/右栏/左侧栏/标题栏）',
    sel.includes('[data-composer-card]') && sel.includes('[data-sidebar-right-panel]')
    && sel.includes('[class*="sidebarCol"]:not([data-sidebar-right-panel])')
    && sel.includes('.wSkVaW_header:not(:where([data-code-block-banner]))'), sel.slice(0, 90) + '…')
  ok('A2b 白名单不含正文/消息区（scrollBody/markdown/消息容器一个都没有）',
    !/scrollBody|markdown|message|Message|conv/i.test(sel))
}
ok('A3 许可说明在位：注释写明独立实现、未复制 AGPL 代码',
  /独立实现/.test(CLIENT) && /未复制|未参考其实现|未复制、未翻译/.test(CLIENT))

/* ---------- 行为夹具：_stub DOM + 定向 matches/closest + rect ---------- */
const selMatch = (el, sel) => {
  const s = String(sel || '')
  // 生产白名单是逗号列表；逐项匹配（只实现本测试需要的形态）
  for (const one of s.split(', ')) {
    const t = one.trim()
    if (!t) continue
    let hit = true
    // 剥 :not(...)（单层）
    const nots = []
    const base = t.replace(/:not\(([^)]*)\)/g, (_, inner) => { nots.push(inner.trim()); return '' })
      .replace(/:where\(([^)]*)\)/g, (_, inner) => { nots.push(inner.trim()); return '' })
    if (/^\[class\*="([^"]+)"\]$/.test(base)) hit = String(el.className || '').indexOf(base.slice(9, -2)) >= 0
    else if (/^\[[^\]=]+]$/.test(base)) hit = el.hasAttribute(base.slice(1, -1))
    else if (/^\./.test(base)) hit = String(el.className || '').split(/\s+/).includes(base.slice(1))
    if (hit) { for (const n of nots) { if (selMatch(el, n)) { hit = false; break } } }
    if (hit) return true
  }
  return false
}
function installShims(el) {
  el.matches = (s) => selMatch(el, s)
  el.closest = (s) => { for (let p = el; p; p = p.parentElement) { try { if (p.matches && p.matches(s)) return p } catch (e) {} } return null }
  return el
}
function boot(settings, { reduced = false } = {}) {
  reset()
  const world = loadPlugin({ quiet: true, settings: settings || { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
  if (reduced) {
    globalThis.matchMedia = (q) => ({ matches: String(q).indexOf('prefers-reduced-motion') >= 0, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  }
  const doc = globalThis.document
  const side = installShims(doc.createElement('div')); side.className = 'pI_x6G_sidebarCol'
  const btn = installShims(doc.createElement('button')); side.appendChild(btn)
  const msg = installShims(doc.createElement('div')); msg.className = 'wSkVaW_scrollBody'
  side.getBoundingClientRect = () => ({ left: 0, top: 0, width: 264, height: 800, right: 264, bottom: 800 })
  msg.getBoundingClientRect = () => ({ left: 264, top: 0, width: 800, height: 800, right: 1064, bottom: 800 })
  doc.body.appendChild(side); doc.body.appendChild(msg)
  /* 桩的 document.querySelector 恒 null：给光晕节点断言一个最小实现（属性选择器） */
  const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(doc.body) } catch (e) {} return out }
  doc.querySelectorAll = (s) => allEls().filter((el) => selMatch(el, s))
  doc.querySelector = (s) => doc.querySelectorAll(s)[0] || null
  const T = globalThis.__mpwTiltTest
  return { doc, side, btn, msg, T }
}
const moveAt = (T, el, x, y) => T.move({ target: el, clientX: x, clientY: y })

console.log('\n== B. 行为（真引擎）==')
{
  const { doc, side, btn, msg, T } = boot()
  ok('B0 apply 接线：float:true ⇒ 引擎启用（data-mpw-tilt + on=true）',
    doc.body.hasAttribute('data-mpw-tilt') && T.state().on === true && T.state().listeners === 1)

  /* B1：指针移到侧栏按钮上（target=btn，面上应命中 side） */
  moveAt(T, btn, 130, 100)
  T.tick()
  const st1 = T.state()
  ok('B1 倾斜只写在被命中面上：transform 含 perspective+rotateX+rotateY，curEl === 侧栏',
    st1.curEl === side && /perspective\(\d+px\)/.test(st1.curTransform)
    && /rotateX\(-?\d+(\.\d+)?deg\)/.test(st1.curTransform) && /rotateY\(-?\d+(\.\d+)?deg\)/.test(st1.curTransform),
    'tf=' + String(st1.curTransform).slice(0, 90))

  /* B3：祖先链干净（面上有倾斜时，祖先链 style.transform 全空；桩里 body 之上无节点） */
  const ancTf = []
  for (let p = side.parentElement; p; p = p.parentElement) ancTf.push(String(p.style.transform || ''))
  ok('B3 祖先链零 transform：面上有倾斜时，祖先链 style.transform 全空',
    ancTf.length >= 1 && ancTf.every((t) => !t), '祖先数=' + ancTf.length + ' 值=' + JSON.stringify(ancTf))

  /* B2：指针移到正文元素 ⇒ 不产生新 transform */
  moveAt(T, msg, 600, 300)
  T.tick()
  const st2 = T.state()
  ok('B2 白名单行为：move 到正文元素 ⇒ 不产生新 transform（curEl 不得是正文）',
    st2.curEl !== msg && !(msg.style.transform), 'cur=' + (st2.curEl && st2.curEl.className) + ' msgTf="' + (msg.style.transform || '') + '"')

  /* B6：光晕 */
  ok('B6a 光晕节点出现：move 后 data-mpw-glow 在 body、opacity=1、transform=translate3d',
    !!T.state().hasGlow && doc.querySelector('[data-mpw-glow]') != null
    && String(doc.querySelector('[data-mpw-glow]').style.opacity) === '1'
    && /translate3d\(/.test(String(doc.querySelector('[data-mpw-glow]').style.transform || '')))
  T.zero()
  ok('B6b 光晕收场：zero ⇒ opacity=0（页面隐藏/离开淡出）',
    String(doc.querySelector('[data-mpw-glow]').style.opacity) === '0')

  /* B7：按住判据 */
  doc.body.setAttribute('data-mpw-float-off', '')
  ok('B7a 按住：float-off（设置面板/全屏弹层开着）⇒ hold=true', T.hold(side) === true)
  doc.body.removeAttribute('data-mpw-float-off')
  side.setAttribute('data-mpw-side-lift', '')
  ok('B7b 按住：侧栏子树里有弹层（side-lift）⇒ hold=true', T.hold(side) === true)
  side.removeAttribute('data-mpw-side-lift')

  /* B8：弹层安全阀 */
  moveAt(T, btn, 130, 100); T.tick()
  const hadTilt = !!T.state().curEl
  const fired = T.safety([{ target: doc.body, addedNodes: [(() => { const d = doc.createElement('div'); d.className = 'VOzbGW_overlay'; return installShims(d) })()] }])
  ok('B8 弹层安全阀：倾斜活跃 + 弹层插入记录 ⇒ 当帧清零 + holdUntil 压制',
    hadTilt && fired === 1 && !T.state().curEl && T.state().holdUntil > 0)
  moveAt(T, btn, 130, 100); T.tick()
  ok('B8b 压制窗口内重倾斜被按住（不许带着 transform 画弹层首帧）', !T.state().curEl)
  T.zero()

  /* B4：开关关闭零效果 */
  T.sync(false)
  const st4 = T.state()
  ok('B4 开关关闭零效果：监听 0、光晕节点删除、无 cur、data-mpw-tilt 移除',
    st4.on === false && st4.listeners === 0 && !st4.hasGlow && doc.body.hasAttribute('data-mpw-tilt') === false && !st4.curEl)
  moveAt(T, btn, 130, 100); T.tick()
  ok('B4b 关闭后 move 无效（不建光晕、不倾斜）', !T.state().hasGlow && !T.state().curEl)
  cancelWorldTimers()
}
/* B5：reduced-motion 完全禁用 */
{
  const { doc, side, btn, T } = boot(undefined, { reduced: true })
  T.sync(true)
  const st = T.state()
  ok('B5 reduced-motion：sync(true) 也完全不启用（on=false、零监听、无光晕；move 后无 transform）',
    st.on === false && st.listeners === 0 && !st.hasGlow && doc.body.hasAttribute('data-mpw-tilt') === false)
  moveAt(T, btn, 130, 100); T.tick()
  ok('B5b reduced-motion 下 move 零效果', !side.style.transform && !T.state().curEl)
  cancelWorldTimers()
}
/* B0b：apply 接线（float:false 档）—— 重启世界 */
{
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: false } })
  const T = globalThis.__mpwTiltTest
  ok('B0b float:false ⇒ 引擎全关（无 data-mpw-tilt、on=false、无光晕节点）',
    globalThis.document.body.hasAttribute('data-mpw-tilt') === false && T.state().on === false && !T.state().hasGlow)
  cancelWorldTimers()
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: '白名单扩进正文 ⇒ B2 必红', expect: ['B2'],
    patch: (s) => s.replace("const MPW_TILT_SURF_SEL = '[data-composer-card], [data-sidebar-right-panel], '", "const MPW_TILT_SURF_SEL = '[data-composer-card], [data-sidebar-right-panel], [class*=\"scrollBody\"], '"),
    verify: (s) => /MPW_TILT_SURF_SEL = '\[data-composer-card\], \[data-sidebar-right-panel\], \[class\*="scrollBody"\]/.test(s) },
  { id: 'M2', what: 'sync 忽略 on 参数恒启用 ⇒ B4 必红', expect: ['B4'],
    patch: (s) => s.replace('const want = !!on && !mpwTiltReduced();', 'const want = true;'),
    verify: (s) => s.indexOf('const want = true;') >= 0 && s.indexOf('const want = !!on && !mpwTiltReduced();') < 0 },
  { id: 'M3', what: 'reduced-motion 判据改恒 false ⇒ B5 必红', expect: ['B5'],
    patch: (s) => s.replace('try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) } catch (e) { return false }', 'try { return false } catch (e) { return false }'),
    verify: (s) => s.indexOf('return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)') < 0 },
]
function runChecksOn(clientPath, { reduced = false } = {}) {
  const r = {}
  try {
    reset()
    loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
    if (reduced) globalThis.matchMedia = (q) => ({ matches: String(q).indexOf('prefers-reduced-motion') >= 0, addEventListener() {}, removeEventListener() {} })
    const T = globalThis.__mpwTiltTest
    const doc = globalThis.document
    const side = installShims(doc.createElement('div')); side.className = 'pI_x6G_sidebarCol'
    const btn = installShims(doc.createElement('button')); side.appendChild(btn)
    const msg = installShims(doc.createElement('div')); msg.className = 'wSkVaW_scrollBody'
    side.getBoundingClientRect = () => ({ left: 0, top: 0, width: 264, height: 800, right: 264, bottom: 800 })
    doc.body.appendChild(side); doc.body.appendChild(msg)
    T.sync(true)
    // B2：正文无 transform
    T.move({ target: msg, clientX: 600, clientY: 300 }); T.tick()
    r['B2'] = T.state().curEl !== msg && !msg.style.transform
    // B4：关闭零效果
    T.sync(false)
    const st4 = T.state()
    r['B4'] = st4.on === false && st4.listeners === 0 && !st4.hasGlow && doc.body.hasAttribute('data-mpw-tilt') === false
    cancelWorldTimers()
  } catch (e) { /* 判红即结果 */ }
  try {
    reset()
    loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA', float: true } })
    if (reduced) globalThis.matchMedia = (q) => ({ matches: String(q).indexOf('prefers-reduced-motion') >= 0, addEventListener() {}, removeEventListener() {} })
    const T = globalThis.__mpwTiltTest
    const doc = globalThis.document
    const side = installShims(doc.createElement('div')); side.className = 'pI_x6G_sidebarCol'
    const btn = installShims(doc.createElement('button')); side.appendChild(btn)
    side.getBoundingClientRect = () => ({ left: 0, top: 0, width: 264, height: 800, right: 264, bottom: 800 })
    doc.body.appendChild(side)
    T.sync(true)
    r['B5'] = T.state().on === false && T.state().listeners === 0 && !T.state().hasGlow
    cancelWorldTimers()
  } catch (e) { /* 判红即结果 */ }
  return r
}
for (const m of MUT) {
  const raw = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const mutated = m.patch(raw)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id + '：变异没有真的打上去（R2）'); continue }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-tilt-'))
  process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
  const p = path.join(TMP, 'client-mut.js')
  fs.writeFileSync(p, mutated)
  /* M3 考的是 reduced-motion 判据 ⇒ 需要把 matchMedia 设成 reduce；其余变异要引擎正常启用 */
  const r = runChecksOn(p, { reduced: m.id === 'M3' })
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  const red = m.expect.filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

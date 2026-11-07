// tools/error-note-dismiss-test.mjs — Z10（2026-11-08）底部错误黑条可关闭判据
//
// 需求（用户 2026-11-07 23:50 第 1 条）：底部错误常驻黑条（#mpw-armNote 源不可用 /
// #mpw-sceneNote 场景兜底）最左侧加可点击 ×；点击立刻隐藏本条，同一 kind+url/reason
// 的错误在本页会话内不再自动重现（apply/applyFromStorage 重入不再弹）；新错误
//（不同 key）重新出现；用户主动 refreshBg/重新应用/清壁纸 = 新一轮；源恢复成功退场；
// 不弹模态、不入错误上传、不改错误 ring 记账、不改 15s 节流/去重语义。
//
// 实现：mpwBottomNoteEnsure（共用构造，× 按钮 pointer-events:auto ≥24×24，整条
// pointer-events:none）+ mpwArmNoteDismissed / mpwSceneNoteDismissed（页面级 Set，
// 不入持久化用户档）+ clearBg/refreshBg/mpwArmNoteRemove/mpwSceneNoteRemove 清空记账。
//
// 驱动方式：全部走**生产实现本身**（__mpwArmNoteProbe.set = mpwBgArmErrorSet、
// __mpwSandbox.holdFallback = mpwSandboxHoldFallback）。说明（诚实边界）：桩 DOM 的
// addEventListener 是不分目标的共享表 ⇒ × 的 click 用**同一个函数引用**（真实浏览器
// addEventListener 注册的同一执行体）经 btn.__mpwNoteDismiss 直调，语义等价于真实点击。
//
// 变异自证（隔离副本，R2 生效断言 + 期望红集==实际红集）：
//   M1 删 × 按钮 ⇒ ①② 红；M2 关闭不记账 ⇒ ③ 红；M3 关闭时清 ring/写用户档 ⇒ ⑦ 红。
//
// 用法: node tools/error-note-dismiss-test.mjs [--client <path>]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const argClient = process.argv.indexOf('--client')
const REAL_CLIENT = argClient > 0 ? process.argv[argClient + 1] : path.join(here, '..', 'lib', 'client.js')

let pass = 0, fail = 0
const ok = (id, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + id + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + id + (detail ? '  [' + detail + ']' : '')) }
}

const reset = () => { for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} } }
const boot = (clientPath) => {
  reset()
  const r = loadPlugin({ clientPath, settings: { enabled: true, image: '', webUrl: '', sceneKey: '' }, quiet: true, ctxDecorate: (ctx) => { ctx.theme = { overrideTokens: () => ({ dispose() {} }) } } })
  if (r.applyErrors.length) throw new Error('apply 报错: ' + r.applyErrors[0])
  await0(r)
  return r
}
const await0 = (r) => { /* boot 同步完成；占位保持可读 */ }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const noteEl = (id) => (typeof document !== 'undefined' && document.getElementById) ? document.getElementById(id) : null
/* 桩元素没有可用的 querySelector（恒 null）⇒ 从 children 里找 button。 */
const btnOf = (bar) => { const kids = (bar && bar.children) || []; for (const c of kids) { if (String(c.tagName) === 'BUTTON') return c } return null }
const dismissFn = (btn) => (btn && typeof btn.__mpwNoteDismiss === 'function') ? btn.__mpwNoteDismiss : null

/* ---------- 断言套件（真树与变异副本共用；返回红 ID 集） ---------- */
async function runSuite(clientPath) {
  const red = []
  const ck = (id, cond, detail) => {
    console.log('  ' + (cond ? '✓ ' : '✗ ') + id + (detail ? '  [' + detail + ']' : ''))
    if (!cond) red.push(id)
  }
  let sb = null
  try { sb = boot(clientPath) } catch (e) { ck('B0', false, String(e.message || e)); return red }
  const arm = globalThis.__mpwArmNoteProbe
  const sandbox = globalThis.__mpwSandbox
  if (!arm || !sandbox || typeof sandbox.holdFallback !== 'function') { ck('B0', false, '缺 __mpwArmNoteProbe/__mpwSandbox 入口'); return red }

  /* == ① armNote 生成断言含 × 按钮 == */
  arm.hintedReset()
  const st1 = arm.set('image', 'http://127.0.0.1:3080/api/mpkg/wall1.mpkg', 404, 'not found')
  const bar1 = noteEl('mpw-armNote')
  const b1 = btnOf(bar1)
  ck('A1a', !!bar1 && !!b1 && b1.textContent === '×', 'bar=' + !!bar1 + ' × 按钮=' + !!(b1 && b1.textContent === '×'))
  ck('A1b', !!b1 && /关闭|close/i.test(String(b1.getAttribute('aria-label') || '')), 'aria-label=' + (b1 ? b1.getAttribute('aria-label') : 'null'))
  /* 桩 style 不解析 cssText（无逐属性 setter）⇒ 断言 cssText 字符串（真实 DOM 按它解析）。 */
  const b1css = b1 ? String(b1.style.cssText) : ''
  const bar1css = bar1 ? String(bar1.style.cssText) : ''
  ck('A1c', /pointer-events:\s*auto/.test(b1css) && /pointer-events:\s*none/.test(bar1css),
    'btn css 含 pointer-events:auto=' + /pointer-events:\s*auto/.test(b1css) + ' bar css 含 none=' + /pointer-events:\s*none/.test(bar1css))
  ck('A1d', /width:\s*24px/.test(b1css) && /height:\s*24px/.test(b1css),
    'btn css 可点区=' + ((b1css.match(/width:\s*\d+px/) || [''])[0] + 'x' + (b1css.match(/height:\s*\d+px/) || [''])[0]))
  ck('A1e', String(bar1.getAttribute('data-mpw-dismiss-key') || '') === 'image|http://127.0.0.1:3080/api/mpkg/wall1.mpkg',
    'dismiss-key=' + (bar1 ? bar1.getAttribute('data-mpw-dismiss-key') : 'null'))

  /* == ② 点击后节点移除 == */
  const ringBefore1 = (globalThis.__mpwErrRing ? globalThis.__mpwErrRing() : []).length
  const lsBefore1 = String(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2'))
  const df1 = dismissFn(b1)
  if (df1) df1()
  ck('A2', df1 ? !noteEl('mpw-armNote') : false, '点击后 bar 存在=' + !!noteEl('mpw-armNote') + ' (dismissFn=' + !!df1 + ')')
  ck('A2b', arm.dismissedSize() === 1, 'dismissed 记账=' + arm.dismissedSize())
  /* 副作用断言必须**紧贴**关闭动作（后续 B 组 holdFallback 会重推 ring/改状态）。
     ①(2026-11-08 Z10) 关闭 = 纯 UI：错误 ring 不增删、用户档不写。 */
  const ringAfter1 = (globalThis.__mpwErrRing ? globalThis.__mpwErrRing() : []).length
  const lsAfter1 = String(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2'))
  ck('A2c', ringAfter1 === ringBefore1 && lsAfter1 === lsBefore1,
    'arm 关闭副作用：ring ' + ringBefore1 + '->' + ringAfter1 + ' ls 不变=' + (lsAfter1 === lsBefore1))

  /* == ③ 同 key 不再自动重现（重置 15s 节流后重放同一 set ⇒ 黑条不出现）== */
  arm.hintedReset()
  arm.set('image', 'http://127.0.0.1:3080/api/mpkg/wall1.mpkg', 404, 'not found')
  ck('A3', !noteEl('mpw-armNote'), '同 key 重放后 bar=' + !!noteEl('mpw-armNote'))

  /* == ④ 不同 key（不同 url）重新出现 == */
  arm.set('image', 'http://127.0.0.1:3080/api/mpkg/wall2.mpkg', 404, 'not found')
  const bar4 = noteEl('mpw-armNote')
  ck('A4', !!bar4, '不同 url 后 bar=' + !!bar4)

  /* == ⑤ sceneNote 同样 ②③④ == */
  sandbox.sceneHintedReset()
  const keyA = sandbox.holdFallbackKeyOf('strict-fail', 'ident1', 'why1')
  sandbox.holdFallback('strict-fail', 'ident1', 'why1', null)
  const sbar1 = noteEl('mpw-sceneNote')
  const sb1 = btnOf(sbar1)
  ck('B1', !!sbar1 && !!sb1 && sb1.textContent === '×' && /关闭|close/i.test(String(sb1.getAttribute('aria-label') || '')), 'scene bar=' + !!sbar1 + ' ×=' + !!(sb1 && sb1.textContent === '×'))
  ck('B1b', String(sbar1.getAttribute('data-mpw-dismiss-key') || '') === keyA, 'dismiss-key=' + (sbar1 ? sbar1.getAttribute('data-mpw-dismiss-key') : 'null'))
  const ringBefore2 = (globalThis.__mpwErrRing ? globalThis.__mpwErrRing() : []).length
  const lsBefore2 = String(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2'))
  const dfS = dismissFn(sb1)
  if (dfS) dfS()
  ck('B2', dfS ? !noteEl('mpw-sceneNote') : false, '点击后 scene bar=' + !!noteEl('mpw-sceneNote'))
  const ringAfterS = (globalThis.__mpwErrRing ? globalThis.__mpwErrRing() : []).length
  const lsAfterS = String(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2'))
  ck('D1', ringAfterS === ringBefore2, 'scene 关闭副作用：ring ' + ringBefore2 + '->' + ringAfterS + '（关闭动作本身不得增删）')
  ck('D2', lsAfterS === lsBefore2, 'scene 关闭副作用：用户档未被改写')
  sandbox.sceneHintedReset()
  sandbox.holdFallback('strict-fail', 'ident1', 'why1', null)
  ck('B3', !noteEl('mpw-sceneNote'), '同 key 重放后 scene bar=' + !!noteEl('mpw-sceneNote'))
  sandbox.sceneHintedReset()
  sandbox.holdFallback('strict-fail', 'ident2', 'why1', null)
  const sbar4 = noteEl('mpw-sceneNote')
  ck('B4', !!sbar4, '不同 ident 后 scene bar=' + !!sbar4)

  /* == ⑥ 恢复清空后 DOM 干净 + 记账清空 == */
  const rmArm = arm.remove()
  ck('C1', rmArm === true && !noteEl('mpw-armNote') && arm.dismissedSize() === 0, 'armNoteRemove=' + JSON.stringify(rmArm) + ' bar=' + !!noteEl('mpw-armNote') + ' dismissed=' + arm.dismissedSize())
  const rmScene = sandbox.sceneNoteRemove()
  ck('C2', rmScene === undefined || rmScene === true || typeof rmScene === 'undefined', 'sceneNoteRemove 调用无异常')
  ck('C2b', !noteEl('mpw-sceneNote'), 'scene bar=' + !!noteEl('mpw-sceneNote'))

  /* == ⑦ 关闭动作零副作用（D1/D2 已在 B 组紧贴断言）+ 不产生模态 + ring 单调 == */
  const ringAfter = (globalThis.__mpwErrRing ? globalThis.__mpwErrRing() : []).length
  ck('D4', ringAfter >= ringBefore1, 'ring 单调（关闭不减账）：' + ringBefore1 + '->' + ringAfter)
  const modalHit = (function () {
    if (!document.body || !document.body.children) return false
    for (const c of document.body.children) {
      const cls = String(c.className || '')
      if (cls.indexOf('mpw_dialog') >= 0 || c.getAttribute && c.getAttribute('role') === 'dialog') return true
    }
    return false
  })()
  ck('D3', !modalHit, '关闭动作未产生模态/弹窗节点')

  return red
}

/* ---------- 变异自证（隔离副本；R2 生效断言） ---------- */
const src0 = fs.readFileSync(REAL_CLIENT, 'utf8')
const mkTmp = (pfx) => fs.mkdtempSync(path.join(os.tmpdir(), pfx))

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-z10-mut-')
  const f = path.join(dir, 'client.js')
  let mutated = src0
  const applied = []
  for (const [anchor, replacement, keepAnchor] of pairs) {
    const n = mutated.split(anchor).length - 1
    const next = mutated.replace(anchor, replacement)
    /* R2 生效断言：替换型 ⇒ 旧串不再存在；append 型（keepAnchor）⇒ 锚点恰好保留 1 次
       且替换串必须**新增**内容（replacement 比 anchor 长）。 */
    const okApply = n === 1 && next !== mutated && (keepAnchor
      ? (next.includes(anchor) && replacement.length > anchor.length && mutated.split(replacement).length - 1 === 0)
      : !next.includes(anchor))
    applied.push(okApply)
    mutated = next
  }
  fs.writeFileSync(f, mutated)
  let red = []
  try { red = await runSuite(f) } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)] }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort())
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + '  ' + what)
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort()) + ' 变异生效=' + JSON.stringify(applied))
  if (eq) pass++; else fail++
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

console.log('== 真树断言（' + path.basename(REAL_CLIENT) + '）==')
const redReal = await runSuite(REAL_CLIENT)
for (const id of redReal) fail++
if (redReal.length === 0) { pass++; console.log('  真树零红 ✓') } else { console.log('  真树红集: ' + JSON.stringify(redReal)); fail++ }

console.log('\n== 变异自证（隔离副本）==')
/* M1 删 × 按钮（arm+scene 共用构造里的 appendChild(btn)）⇒ ①② 红 */
await withMutant('M1', '删 × 按钮（两黑条都无关闭控件）',
  [['bar.appendChild(btn);', ';']],
  ['A1a', 'A1b', 'A1c', 'A1d', 'A2', 'A2b', 'A3', 'B1', 'B2', 'B3'])
/* M2 关闭不记账（onDismiss 写成空操作）⇒ ③ 红（同 key 重放又出现）*/
await withMutant('M2', '关闭不记录 dismissed（同 key 重放重现）',
  [['(k) => { try { mpwArmNoteDismissed.add(String(k || "")) } catch (e) {} }', '(k) => {}'],
   ['(k) => { try { mpwSceneNoteDismissed.add(String(k || "")) } catch (e) {} }', '(k) => {}']],
  ['A2b', 'A3', 'B3'])
/* M3 关闭时连错误 ring 一起清 / 写用户档 ⇒ ⑦ 红 */
await withMutant('M3', '关闭时清错误 ring + 写用户档（越界副作用）',
  [['try { const k = bar.getAttribute("data-mpw-dismiss-key"); if (onDismiss) onDismiss(String(k || "")) } catch (e) {}',
    'try { const k = bar.getAttribute("data-mpw-dismiss-key"); if (onDismiss) onDismiss(String(k || "")) } catch (e) {} ;try { if (window.__mpwErrRingClear) window.__mpwErrRingClear() } catch (e) {} ;try { localStorage.setItem("dsh.mpkg-wallpaper.v2", "{}") } catch (e) {}', true]],
  ['A2c', 'D1'])

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

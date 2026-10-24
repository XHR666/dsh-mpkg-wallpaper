// tools/plus-menu-frost-test.mjs —— 加号菜单磨砂「首帧缺失」修复的判据（2026-10-24）
//
// 根因链（诊断结论，行号证据见提交与交付报告）：
//   加号菜单（input-trigger 的 MenuSurface，data-trigger-menu）**就地渲染**在输入卡片
//   [data-composer-card] 子树里（该包无 createPortal）；「对话框虚化」开时本插件给卡片加
//   backdrop-filter（buildCss B 块 [data-composer-card] 规则）⇒ 卡片成为菜单磨砂的 backdrop
//   root ⇒ 壳上补的 blur(--mpw-pop-blur) 只能采样卡片内部 = 无磨砂。
//   去截断原本只跑在重活节流路（setupPopTagWatch 的 rAF + 150ms 节流 + mpwHeavyGate 动画
//   闸门，最坏 ~600ms）⇒ 首帧到补跑之间无磨砂；先开权限面板再点加号时，权限面板关闭动画
//   正让闸门推迟 ⇒ 无磨砂窗口更长。
// 修复：mpwPopUntruncFast —— 观察器同步快路（mpwTagPopoverFast，微任务、渲染前）对突变里
//   出现的菜单壳做**定点**祖先链走查（与 mpwPopUntruncExtra 同判据），首帧前摘掉卡片 blur。
//
// 本文件断言（每条都能被变异变红，见文末 M1/M2）：
//   T1 直接驱动：壳有 blur + 卡片有 blur + 卡片是可去截断祖先 ⇒ fastUntrunc **同步**打标
//   T2 接线在位：观察器快路（fastPath = mpwTagPopoverFast）对 addedNodes 批次也走到同一结果
//   T3 反向：壳自身无 blur（弹层虚化关）⇒ 不动手（没有"截断"可言）
//   T4 反向：祖先无 blur ⇒ 不动手
//   T5 标记保全：先标的另一个祖先不被后续 fast 撤掉（need 合并语义）
//   M1 变异：去掉 mpwTagPopoverFast 的 mpwPopUntruncFast 接线 ⇒ T2 必红（T1 仍绿）
//   M2 变异：fast 的"可去截断祖先"判据恒假 ⇒ T1/T2 必红
// 复现: node tools/plus-menu-frost-test.mjs
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
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwBsTabState']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

/* ---------- 夹具（与 popover-glass-test 同款：桩 DOM + 每元素 __cs 覆写 computed） ---------- */
/** [attr] 与逗号列表匹配（MPW_MENU_SHELL_SEL / MPW_POP_TAG_SEL 的桩形态） */
const attrMatch = (el, sel) => {
  const s = String(sel || '').trim()
  const m = /^\[([^\]=~^$|]+)\]$/.exec(s)
  return m ? el.hasAttribute(m[1].trim()) : false
}
let world = null
function boot(clientPath) {
  reset()
  world = loadPlugin({ quiet: true, clientPath: clientPath || path.join(ROOT, 'lib', 'client.js'),
    settings: { enabled: true, image: 'data:image/png;base64,AAA', dialogBlur: true } })
  // querySelectorAll/Selector 仿真：支持 [attr] 与逗号列表（MPW_MENU_SHELL_SEL 的形态）
  const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(globalThis.document.body) } catch (e) {} return out }
  globalThis.document.querySelectorAll = (sel) => allEls().filter((el) => String(sel).split(',').some((s) => attrMatch(el, s)))
  globalThis.document.querySelector = (sel) => globalThis.document.querySelectorAll(sel)[0] || null
  const base = globalThis.getComputedStyle
  globalThis.getComputedStyle = (el) => {
    if (el && el.__cs) { const d = Object.assign({}, base(el)); for (const k of Object.keys(el.__cs)) d[k] = el.__cs[k]; return d }
    return base(el)
  }
  globalThis.innerWidth = 1024
  globalThis.innerHeight = 768
  globalThis.document.body.__cs = { backgroundColor: 'rgba(0, 0, 0, 0)' }
}
/** body > card(.uV2eYG_card，blur 14px，定位元素) > shell(data-trigger-menu，blur 10px) */
function buildChain({ cardBlur = 'blur(14px)', shellBlur = 'blur(10px)', cardCls = 'uV2eYG_card' } = {}) {
  const doc = globalThis.document
  const card = doc.createElement('div'); card.className = cardCls
  const shell = doc.createElement('div'); shell.className = '_3e4SsG_menu'
  shell.setAttribute('data-trigger-menu', '')
  card.__cs = { backdropFilter: cardBlur, backgroundColor: 'rgba(255,255,255,0.42)', position: 'relative', zIndex: 'auto', borderTopLeftRadius: '16px' }
  shell.__cs = { backdropFilter: shellBlur }
  doc.body.appendChild(card); card.appendChild(shell)
  const matchesShim = (el) => (sel) => String(sel || '').split(',').some((s) => attrMatch(el, s))
  card.matches = matchesShim(card); shell.matches = matchesShim(shell)
  // 快路/标记路径会在节点子树里 querySelector（桩默认恒 null ⇒ 仿真一层子树查找）
  card.querySelector = (sel) => [shell].find((c) => String(sel).split(',').some((s) => attrMatch(c, s))) || null
  shell.querySelector = () => null
  return { card, shell }
}
const marked = (el) => el.hasAttribute && el.hasAttribute('data-mpw-pop-untrunc')

console.log('== A. 静态接线 ==')
ok('A1 快路函数与钩子存在：mpwPopUntruncFast + mpwTagPopoverFast 两分支接线 + 判据出口',
  CLIENT.includes('function mpwPopUntruncFast(')
  && CLIENT.includes('try { mpwPopUntruncFast(t) } catch (e) {}')
  && CLIENT.includes('try { mpwPopUntruncFast(node) } catch (e) {}')
  && CLIENT.includes('fastPath: (records) => mpwTagPopoverFast(records)')
  && CLIENT.includes('fastUntrunc: (root) => mpwPopUntruncFast(root)'))
ok('A2 快路判据与主路同源（blur 祖先 + 包装容器白名单 + 只处理最近一个）',
  CLIENT.includes('const MPW_MENU_SHELL_SEL = \'[data-menu-material], [data-trigger-menu], [class*="ZKlsPq_menu"]\';')
  && CLIENT.includes('wrap = declared || /(_card|composer|overlayAnchor|_seat|_stack)/i.test(String(p.className || ""))')
  && CLIENT.includes('const need = new Set(popUntruncs.keys());'))

console.log('\n== T. 行为（真 apply 的快路）==')
{
  boot()
  const T = globalThis.__mpwPopUntruncTest
  ok('T0 判据出口在', !!T && typeof T.fastUntrunc === 'function' && typeof T.fastPath === 'function')

  const { card, shell } = buildChain()
  const n = T.fastUntrunc(shell)
  ok('T1 壳有 blur + 卡片有 blur ⇒ fastUntrunc 同步给卡片打上 data-mpw-pop-untrunc（渲染前生效）',
    n >= 1 && marked(card), 'n=' + n)

  // T2：观察器快路（addedNodes 批次 = 菜单插入帧）。用**新链**（真实场景：重新开菜单 = 新元素；
  // 直接 removeAttribute 会破坏 popUntruncs 台账与属性的一致性，不是真实路径）。
  const c2 = buildChain()
  const n2 = T.fastPath([{ type: 'childList', target: c2.card, addedNodes: [c2.shell] }])
  ok('T2 观察器快路（mpwTagPopoverFast）对插入帧也同步打标（接线在位）',
    marked(c2.card), 'fastPath 返回=' + n2)

  // T3：壳自身无 blur（弹层虚化关档）⇒ 不动手
  card.removeAttribute('data-mpw-pop-untrunc')
  shell.__cs.backdropFilter = 'none'
  const n3 = T.fastUntrunc(shell)
  ok('T3 反向：壳无 blur ⇒ 不打标（没有"截断"可言）', n3 === 0 && !marked(card), 'n=' + n3)

  // T4：祖先无 blur（对话框虚化关档的卡片）⇒ 不动手
  shell.__cs.backdropFilter = 'blur(10px)'
  card.__cs.backdropFilter = 'none'
  const n4 = T.fastUntrunc(shell)
  ok('T4 反向：祖先无 blur ⇒ 不打标', n4 === 0 && !marked(card), 'n=' + n4)

  // T5：标记保全 —— 两条链，先标 cardA，再对 cardB 的壳走 fast ⇒ cardA 标记仍在
  card.__cs.backdropFilter = 'blur(14px)'
  const a = buildChain()                                  // 链 A（card 已在上面动过 __cs，这里另起干净的）
  const b = buildChain()
  T.fastUntrunc(a.shell)
  const aMarkedFirst = marked(a.card)
  T.fastUntrunc(b.shell)
  ok('T5 need 合并语义：后续 fast 不撤掉先前祖先的标记',
    aMarkedFirst && marked(a.card) && marked(b.card),
    'A 先=' + aMarkedFirst + ' A 后=' + marked(a.card) + ' B=' + marked(b.card))
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==')
const src0 = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const TMP_DIRS = []
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d }
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } })

async function withMutant(id, what, pairs, expectRed, drive) {
  const dir = mkTmp('mpw-frost-mut-')
  const f = path.join(dir, 'client.js')
  let mutated = src0
  const applied = []
  for (const [a, r] of pairs) {
    const n = mutated.split(a).length - 1
    const next = mutated.replace(a, r)
    applied.push(n === 1 && next !== mutated && !next.includes(a))
    mutated = next
  }
  fs.writeFileSync(f, mutated)
  const red = []
  const detail = {}
  const g = (idc, cond, d) => { detail[idc] = d || ''; if (!cond) red.push(idc) }
  boot(f)
  drive(g, world)
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort())
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what)
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied) + (eq ? '' : '  详情=' + JSON.stringify(detail).slice(0, 300)))
  if (!eq) fail++; else pass++
}

await withMutant('M1', '去掉观察器快路接线（addedNodes 分支的 mpwPopUntruncFast 调用）', [
  ['\t\t\t\t\t\t/* ①(2026-10-24 加号菜单磨砂首帧) 插入帧同步去截断（渲染前生效） */\n\t\t\t\t\t\ttry { mpwPopUntruncFast(node) } catch (e) {}',
   '\t\t\t\t\t\t/* M1 removed */'],
], ['T2'], (g, w) => {
  const T = globalThis.__mpwPopUntruncTest
  const { card, shell } = buildChain()
  const n = T.fastUntrunc(shell)
  g('T1', n >= 1 && marked(card), 'n=' + n)
  card.removeAttribute('data-mpw-pop-untrunc')
  T.fastPath([{ type: 'childList', target: card, addedNodes: [shell] }])
  g('T2', marked(card), '标记=' + marked(card))
})

await withMutant('M2', '快路的"可去截断祖先"判据恒假（wrap 判定改 false）', [
  ['if (wrap && mpwPopCanCtx(p, acs)) { need.add(p); added++; }\n\t\t\t\t\tbreak;   // 与 mpwPopUntruncExtra 同语义：只处理最近的一个 blur 祖先',
   'if (false) { need.add(p); added++; } /* M2 */\n\t\t\t\t\tbreak;   // 与 mpwPopUntruncExtra 同语义：只处理最近的一个 blur 祖先'],
], ['T1', 'T2'], (g, w) => {
  const T = globalThis.__mpwPopUntruncTest
  const { card, shell } = buildChain()
  const n = T.fastUntrunc(shell)
  g('T1', n >= 1 && marked(card), 'n=' + n)
  card.removeAttribute('data-mpw-pop-untrunc')
  T.fastPath([{ type: 'childList', target: card, addedNodes: [shell] }])
  g('T2', marked(card), '标记=' + marked(card))
})

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====')
cancelWorldTimers()
process.exit(fail ? 1 : 0)

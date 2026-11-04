// tools/tip-no-layout-shift-test.mjs —— #Bug4 判据（2026-11-03 任务书 A2-2）
//
// 背景（真机 Bug 4）：悬停「发送/暂停」键时页面上下震荡 —— 历史 tooltip-unclip 机制
// （气泡开着期间放开祖先 overflow）会改变布局（滚动条/高度变化）⇒ 鼠标相对按钮热区
// 反复进出 ⇒ 震荡。且 sidebarCol 的磨砂（tooltip 被裁的根因）已迁 ::before 伪元素，
// tooltip 不再被包含块+overflow 困住 ⇒ unclip 这条历史补丁只剩风险没有收益。
//
// 处置（lib/client.js mpwTipUnclip* 块注释同源）：
//   ① 整条机制**默认关闭**；兜底开关 = window.__mpwTipUnclip === true 或 ?mpwtipunclip=1
//   ② 打开时三道护栏：body/html/[class*="frame"] 永不碰；滚动容器（auto/scroll）不碰
//     （既有）；放开前后 scrollHeight/clientHeight 变化 ≥1px ⇒ 立刻回滚 + 拉黑
//
// 本文件断言（每条都能被文末 M1–M3 变异打红）：
//   A1 默认关：不设开关时，气泡出现 ⇒ 0 打标、0 属性（布局零改动）
//   A2 兜底开 ?mpwtipunclip=1 ⇒ 恢复打标（开关真的在）
//   B1 兜底开 window.__mpwTipUnclip ⇒ 小裁切祖先被打标（机制本身还活着）
//   B2 永不碰名单：body / [class*="frame"] 哪怕在裁切也**绝不**被打标
//   B3 滚动容器（overflow:auto）不打标（既有护栏保留）
//   B4 布局位移即回滚：打标后 scrollHeight 变化 ≥1px ⇒ 下一帧摘标 + 拉黑（再不重打）
//   M1 变异：回滚改恒假 ⇒ B4 必红
//   M2 变异：默认关的闸拆掉 ⇒ A1 必红
//   M3 变异：永不碰名单拆掉 ⇒ B2 必红
//
// 用法: node tools/tip-no-layout-shift-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 桩环境：getComputedStyle 读 el.__cs；元素 matches 支持本判据用到的最小选择器集。 */
function installEnv() {
  globalThis.getComputedStyle = (el) => Object.assign(
    { overflow: 'visible', overflowX: 'visible', overflowY: 'visible', position: 'static' },
    (el && el.__cs) || {})
}
const mkMatcher = (e) => (s) => String(s).split(',').some((one) => {
  const t = one.trim()
  if (!t) return false
  if (/^(body|html)$/i.test(t)) return String(e.tagName || '').toLowerCase() === t.toLowerCase()
  let m = t.match(/^\[class\*="([^"]+)"\]$/)
  if (m) return String(e.className || '').indexOf(m[1]) >= 0
  m = t.match(/^\[role="([^"]+)"\]$/)
  if (m) return e.getAttribute('role') === m[1]
  return false
})
const mkEl = (tag, cls) => {
  const e = globalThis.document.createElement(tag)
  if (cls) e.className = cls
  e.matches = mkMatcher(e)
  return e
}
/** body ← chain… ← tip 的祖先链（index 0 最靠 body）。 */
function bootChain({ interCls = '', bodyClips = false } = {}) {
  const doc = globalThis.document
  if (!doc.body.__matchesInstalled) {           // 桩自带的 body 也要装 matcher（默认恒 false ⇒ 永不碰名单测不到它）
    const m = doc.body.matches
    doc.body.matches = (s) => mkMatcher(doc.body)(s) || m.call(doc.body, s)
    doc.body.__matchesInstalled = true
  }
  doc.body.__cs = { overflow: bodyClips ? 'hidden' : 'visible' }
  const frame = mkEl('div', 'pI_x6G_frame')
  frame.__cs = { overflow: 'hidden' }          // frame 恒裁切（宿主底规则自带）——正好验证"永不碰"
  const wrap = mkEl('div', interCls || 'mpw_tipClipWrap')
  wrap.__cs = { overflow: 'hidden' }           // 小裁切祖先：机制的目标对象
  const tip = mkEl('span', '_bubble_12mhf_1')
  tip.setAttribute('role', 'tooltip')
  frame.appendChild(wrap); wrap.appendChild(tip); doc.body.appendChild(frame)
  return { doc, frame, wrap, tip }
}
const marks = (doc) => doc.querySelectorAll('[data-mpw-tip-unclip]')
// 桩 doc.querySelectorAll 恒空 ⇒ 与 tag 同款手法：直接沿已知链断言
const marked = (el) => el.hasAttribute('data-mpw-tip-unclip')

const T = () => globalThis.__mpwPopUntruncTest

/* ---------- 主流程 ---------- */
{
  console.log('== A. 默认关（#Bug4 处置①）==')
  cancelWorldTimers()
  loadPlugin({ quiet: true, settings: { enabled: true } })
  installEnv()
  globalThis.__mpwTipUnclip = undefined
  globalThis.location.search = ''
  const F = bootChain()
  T().tipFast(F.tip)
  T().tipSync()
  ok('A1 默认关：气泡出现也不打标（0 属性、布局零改动）', !marked(F.wrap) && !marked(F.frame) && !marked(F.doc.body))
  ok('A1b tipFast 返回 0', T().tipFast(F.tip) === 0)

  console.log('\n== A2. 兜底开关真的在 ==')
  globalThis.location.search = '?mpwtipunclip=1'
  const n = T().tipFast(F.tip)
  ok('A2 ?mpwtipunclip=1 ⇒ 小裁切祖先被打标', n >= 1 && marked(F.wrap))
  // 复位
  globalThis.location.search = ''
  for (const el of [F.wrap, F.frame]) el.removeAttribute('data-mpw-tip-unclip')

  console.log('\n== B. 兜底打开后的护栏 ==')
  globalThis.__mpwTipUnclip = true
  // B2/B3 用一条新链：body 与 frame 都在裁切
  // （桩 doc.querySelectorAll 恒空 ⇒ 全量同步路测不到，与 lib 内 tag 同款：走单节点快路驱动）
  const G = bootChain({ bodyClips: true })
  G.doc.body.__cs = { overflow: 'hidden' }
  T().tipFast(G.tip)
  ok('B2 永不碰：body / [class*="frame"] 在裁切也绝不打标', !marked(G.doc.body) && !marked(G.frame))
  ok('B2b 小裁切祖先照常打标（护栏没有连坐）', marked(G.wrap))
  // B3 滚动容器
  const H = bootChain({ interCls: 'mpw_tipScrollWrap' })
  H.wrap.__cs = { overflow: 'auto' }
  T().tipFast(H.tip)
  ok('B3 滚动容器（auto/scroll）不打标（既有护栏）', !marked(H.wrap))
  // B4 布局位移 ⇒ 回滚 + 拉黑
  const K = bootChain()
  K.wrap.scrollHeight = 100; K.wrap.clientHeight = 90
  const n4 = T().tipFast(K.tip)
  ok('B4a 打标成功（放开前记录了尺寸）', n4 >= 1 && marked(K.wrap))
  K.wrap.scrollHeight = 140                     // 放开导致布局位移（滚动条/高度变化）
  await sleep(140)                              // rAF(桩=0ms) 触发复核
  ok('B4b 位移 ≥1px ⇒ 立刻回滚（摘标）', !marked(K.wrap))
  T().tipFast(K.tip)
  ok('B4c 回滚后拉黑：同一元素不再重打（放弃 unclip）', !marked(K.wrap))
  // 无位移的对照：标记保留
  const L = bootChain()
  L.wrap.scrollHeight = 100; L.wrap.clientHeight = 90
  T().tipFast(L.tip)
  await sleep(140)
  ok('B4d 对照：无位移 ⇒ 标记保留（护栏不误伤）', marked(L.wrap))
  globalThis.__mpwTipUnclip = undefined
  cancelWorldTimers()
}

/* ---------- 变异自证（隔离副本；期望红集 == 实际红集，逐条相等） ---------- */
console.log('\n== M. 变异自证 ==')
const MUT = [
  { id: 'M1', what: '位移回滚改恒假（布局变了也不回滚）⇒ B4 必红', expect: ['B4'],
    patch: (s) => s.replace('if (el.scrollHeight !== sh0 || el.clientHeight !== ch0) {', 'if (false) { /* 变异：回滚失效 */'),
    verify: (s) => s.indexOf('if (false) { /* 变异：回滚失效 */') >= 0 },
  { id: 'M2', what: '默认关的闸拆掉（快路恒开）⇒ A1 必红', expect: ['A1'],
    patch: (s) => s.replace('if (!mpwTipUnclipEnabled()) return 0;', 'if (false) return 0; /* 变异：闸拆 */'),
    verify: (s) => s.indexOf('if (false) return 0; /* 变异：闸拆 */') >= 0 },
  { id: 'M3', what: '永不碰名单拆掉 ⇒ B2 必红', expect: ['B2'],
    patch: (s) => s.replace("try { if (el.matches && el.matches(MPW_TIP_UNCLIP_NEVER_SEL)) return false } catch (e) {}",
      "try { if (false) return false } catch (e) {} /* 变异：名单拆 */"),
    verify: (s) => s.indexOf('if (false) return false } catch (e) {} /* 变异：名单拆 */') >= 0 },
]
async function runChecksOn(clientPath) {
  const r = {}
  try {
    cancelWorldTimers()
    loadPlugin({ quiet: true, clientPath, settings: { enabled: true } })
    installEnv()
    // A1
    globalThis.__mpwTipUnclip = undefined; globalThis.location.search = ''
    const F = bootChain()
    T().tipFast(F.tip)
    r['A1'] = !marked(F.wrap) && !marked(F.frame) && !marked(F.doc.body)
    // B2
    globalThis.__mpwTipUnclip = true
    const G = bootChain({ bodyClips: true })
    T().tipFast(G.tip)
    r['B2'] = !marked(G.doc.body) && !marked(G.frame) && marked(G.wrap)
    // B4
    const K = bootChain()
    K.wrap.scrollHeight = 100; K.wrap.clientHeight = 90
    T().tipFast(K.tip); K.wrap.scrollHeight = 140
    await sleep(140)
    r['B4'] = !marked(K.wrap)
    globalThis.__mpwTipUnclip = undefined
    cancelWorldTimers()
  } catch (e) { /* 判红即结果 */ }
  return r
}
for (const m of MUT) {
  const raw = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const mutated = m.patch(raw)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id + '：变异没有真的打上去（R2）'); continue }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-tipshift-'))
  process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
  const p = path.join(TMP, 'client-mut.js')
  fs.writeFileSync(p, mutated)
  const r = await runChecksOn(p)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  const red = m.expect.filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

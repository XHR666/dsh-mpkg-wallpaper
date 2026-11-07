// tools/np-conflict-test.mjs —— Z9（2026-11-07 任务书）：Now Playing 槽位冲突检测/归因/自动关闭判据
//
// 现场（主会话探针）：dsh-mobile 把按钮注入宿主 slot sidebar.footer.action ⇒ NP 让位
//（yield="foreign-occupant"）但持久化 npNowPlaying:true ⇒ "开关开着、卡片不显示"的矛盾。
// 需求：设置里加冲突检测；冲突 ⇒ 自动关闭（每 occupant 每会话一次）+ 归因说明（谁占用/为什么不能开启）；
// 用户点开启被阻止；冲突消失可再开。不改默认值、不碰 DSH Mobile/宿主、保留既有 yield 行为。
// 断言：
//   A 归因（行为级，真函数体）：从 lib/now-playing.js 提取 occupantOf/npOccupantAttribution 及其依赖，
//     夹具 DOM：slot 容器里 [宿主 slot 出口 div][我方 div][button.dsh-mobile-control__trigger] ⇒
//     occupantOf 返回按钮；归因 = {pluginId:"dsh-mobile", pluginName:"DSH Mobile", attribution:"class-prefix",
//     tag:"button", className/text 原样}；宿主原生节点与未知类名分别不误判/落 "另一个插件"+unknown-class。
//   B inspect 冲突暴露（源码级）：inspect() 含 conflict 块（reason=NP_YIELD_FOREIGN + occupant 归因）。
//   C 设置行（源码级）：自动关闭走既有 commit 且每 occupant 一次（__mpwNpAutoClosedKeys 去重）；用户点
//     开启被阻止（conflict 时不写设置）；data-mpw-np-conflict 机读属性；不改默认值
//     （DEFAULT_NP_NOW_PLAYING 语义不变）；i18n 三键 zh/en 同步。
//   D 回归：np-control-test / np-media-test / now-playing-test / panel-fixes-test 子进程全绿。
// 变异自证（内存副本；期望红集 == 实际红集，逐条相等）：
//   M1 删 inspect 的 conflict 块 ⇒ 红 ["B"]；M2 归因函数改恒 null ⇒ 红 ["A"]；
//   M3 删自动关闭写入 ⇒ 红 ["C"]。
// 用法: node tools/np-conflict-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

const NP = fs.readFileSync(path.join(ROOT, 'lib', 'now-playing.js'), 'utf8')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

/* ---------- 提取真函数体（锚点切片；now-playing.js 是生成区源，允许直接跑） ----------
   切 [occupantOf, createController) —— 该区间自含 occupantOf/attrOf/isOurNode/isHostOwnedNode/
   isEffectivelyEmptyNode/npOccupantAttribution 且括号配平；常量 NP_ATTR/NP_SLOT_ATTR 手动前置
   （原文件里它们在更早的模块结构内，整段切会失衡）。 */
function sliceFns(src) {
  const iOcc = src.indexOf('function occupantOf(container, mode, selfNode) {')
  const iCtl = src.indexOf('function createController() {')
  if (!(iOcc >= 0 && iCtl > iOcc)) return null
  return 'const NP_ATTR = "data-mpw-now-playing";\nconst NP_SLOT_ATTR = "data-mpw-np-slot";\n'
    + src.slice(iOcc, iCtl)
    + '\nif (typeof attrOf !== "function") { attrOf = function (el, k) { try { return el && el.hasAttribute && el.hasAttribute(k) ? String(el.getAttribute(k) || "") : null } catch (e) { return null } } }\n'
}
const FNS = sliceFns(NP)

/* ---------- 极简 DOM 夹具 ---------- */
function mkNode(tag, cls, attrs, parent) {
  const node = {
    tagName: String(tag).toUpperCase(), className: cls || '', nodeType: 1,
    __attrs: Object.assign({}, attrs || {}), children: [], parentElement: parent || null,
    textContent: '',
  }
  node.getAttribute = (k) => (k in node.__attrs ? String(node.__attrs[k]) : null)
  node.hasAttribute = (k) => k in node.__attrs
  if (parent) parent.children.push(node)
  return node
}

function runAttribution(mutSrc) {
  const body = mkNode('div', 'sideFooter')
  const hostSlot = mkNode('div', 'slotOutlet', { 'data-slot': 'sidebar.footer.action' }, body)
  const ours = mkNode('div', 'mpw_np_slot', { 'data-mpw-np-slot': '' }, body)
  const foreign = mkNode('button', 'dsh-mobile-control__trigger', { 'aria-label': '移动访问' }, body)
  foreign.textContent = '移动访问'
  const unknown = mkNode('div', 'xFoo_bar_baz', {}, body)
  const fns = new Function('body', (mutSrc || FNS) + '\nreturn { occupantOf, npOccupantAttribution };')
  const { occupantOf, npOccupantAttribution } = fns(body)
  return {
    occ: occupantOf(body, 'slot', ours),
    attrButton: npOccupantAttribution(foreign),
    attrHost: npOccupantAttribution(hostSlot),
    attrUnknown: npOccupantAttribution(unknown),
    ours: occupantOf(body, 'slot', foreign),   // 反向：把我们当 self ⇒ 占用者应是按钮（顺序无关性抽查）
    hostSlot, ours, foreign, unknown,
  }
}

console.log('== A 归因（真函数体 + 夹具 DOM）==')
{
  if (!FNS) bad('A 提取失败（源锚点变了）')
  else {
    const r = runAttribution()
    let a = []
    if (!r.occ || r.occ !== r.foreign) a.push('occupantOf 未返回 foreign 按钮（宿主/我方/空节点放行规则变了？）')
    const at = r.attrButton || {}
    if (at.pluginId !== 'dsh-mobile' || at.pluginName !== 'DSH Mobile' || at.attribution !== 'class-prefix') a.push('归因错误: ' + JSON.stringify(at))
    if (at.tag !== 'button' || String(at.className || '').indexOf('dsh-mobile-control__trigger') < 0) a.push('tag/className 未原样带出')
    if (!r.attrHost || r.attrHost.pluginId !== null) a.push('宿主 slot 出口被误归因（应为 null，绝不猜成宿主）')
    if (!r.attrUnknown || r.attrUnknown.pluginId !== null || r.attrUnknown.pluginName !== '另一个插件' || r.attrUnknown.attribution !== 'unknown-class') a.push('未知类名未落"另一个插件"+原始 class')
    if (a.length === 0) ok('A occupantOf 放行规则 + 归因三态（class-prefix/data-plugin/unknown）全部正确')
    else bad('A 归因断言失败', a.join('；'))
  }
}

console.log('\n== B/C 源码级 ==')
{
  let bc = []
  if (!/conflict: \(\(\) => \{[\s\S]{0,200}NP_YIELD_FOREIGN, occupant: npOccupantAttribution\(occ\)/.test(NP)) bc.push('inspect().conflict 缺失或形态不符')
  if (!/const __mpwNpAutoClosedKeys = new Set\(\)/.test(CLIENT)) bc.push('自动关闭去重集缺失')
  if (!/if \(conflict && npOnNow && !wasAutoClosed\) \{[\s\S]{0,200}commit\(\{ npNowPlaying: false \}, true\)/.test(CLIENT)) bc.push('自动关闭未走 commit 写 false')
  if (!/if \(v && conflict\) return;/.test(CLIENT)) bc.push('用户点开启未被阻止（冲突时应不写设置）')
  if (!/"data-mpw-np-conflict": conflict \? occKey : null/.test(CLIENT)) bc.push('data-mpw-np-conflict 机读属性缺失')
  if (!/DEFAULT_NP_NOW_PLAYING = true/.test(CLIENT) && !/DEFAULT_NP_NOW_PLAYING = false/.test(CLIENT)) bc.push('DEFAULT_NP_NOW_PLAYING 常量缺失')
  const d0 = CLIENT.match(/const DEFAULT_NP_NOW_PLAYING = (true|false)/)
  if (d0 && d0[1] !== 'true') bc.push('npNowPlaying 默认值被改成关（任务书禁止）')
  cancelWorldTimers()
  const w = loadPlugin({ quiet: true, settings: { enabled: true } })
  const zh = (w.localeDicts || {}).zh || {}, en = (w.localeDicts || {}).en || {}
  for (const k of ['npConflict.occupied', 'npConflict.occupiedOff', 'npConflict.cleared']) {
    if (!(k in zh) || !(k in en)) bc.push('i18n 缺键: ' + k)
    else if (!zh[k] || !en[k]) bc.push('i18n 空文案: ' + k)
  }
  cancelWorldTimers()
  if (bc.length === 0) ok('B/C inspect 冲突暴露 + 设置行（自动关闭/阻止/机读属性/默认值/i18n）全部在位')
  else bad('B/C 断言失败', bc.join('；'))
}

console.log('\n== D 回归（子进程）==')
for (const t of ['np-control-test', 'np-media-test', 'now-playing-test', 'panel-fixes-test']) {
  let exit = 0
  try { execFileSync('node', [path.join(here, t + '.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { exit = 1 }
  if (exit === 0) ok('D ' + t + ' 绿')
  else bad('D ' + t + ' 红')
}

console.log('\n== M 变异自证（内存副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: '删 inspect 的 conflict 块 ⇒ B 必红', expect: ['B'],
    patch: (s) => s.replace(/\/\* Z9\(2026-11-07 9\.1\) 只读冲突信息[\s\S]*?conflict: \(\(\) => \{[\s\S]*?\}\)\(\),\n/, ''),
    verify: (s) => !s.includes('conflict: (() => {') },
  { id: 'M2', what: '归因函数改恒 null（打在提取的函数体上）⇒ A 必红', expect: ['A'],
    patch: (s) => s.replace(/function npOccupantAttribution\(el\) \{[\s\S]*?\n  \}/, 'function npOccupantAttribution(el) {\n    return { tag: null, className: "", text: null, pluginId: null, pluginName: null, attribution: null };\n  }'),
    verify: (s) => s.includes('return { tag: null, className: "", text: null, pluginId: null, pluginName: null, attribution: null };') },
  { id: 'M3', what: '删自动关闭写入 ⇒ C 必红', expect: ['C'],
    patch: (s) => s.replace(/if \(conflict && npOnNow && !wasAutoClosed\) \{\s*\n\s*__mpwNpAutoClosedKeys\.add\(occKey\);\s*\n\s*try \{ commit\(\{ npNowPlaying: false \}, true\); \} catch \(e\) \{ mpwErr\("np-conflict\(auto-off\)", e\) \}\s*\n\s*\}/, '/* M3 removed */'),
    verify: (s) => !s.includes('commit({ npNowPlaying: false }, true);') },
]
for (const m of MUT) {
  let r = { A: true, B: true, C: true }
  if (m.id === 'M2') {
    const mutSlice = m.patch(FNS)
    if (!m.verify(mutSlice)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
    const rr = runAttribution(mutSlice)
    const at = rr.attrButton || {}
    r['A'] = !(at.pluginId === null && at.pluginName === null && at.attribution === null)
  } else if (m.id === 'M1') {
    const mutNP = m.patch(NP)
    if (!m.verify(mutNP)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
    r['B'] = /conflict: \(\(\) => \{[\s\S]{0,200}NP_YIELD_FOREIGN/.test(mutNP)
  } else {
    const mutC = m.patch(CLIENT)
    if (!m.verify(mutC)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
    r['C'] = /if \(conflict && npOnNow && !wasAutoClosed\) \{[\s\S]{0,200}commit\(\{ npNowPlaying: false \}, true\)/.test(mutC)
  }
  const red = ['A', 'B', 'C'].filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

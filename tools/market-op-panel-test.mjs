// tools/market-op-panel-test.mjs —— Z7（2026-11-07 任务书）：第三方浮层白纱补偿（市场「任务」opPanel + DSH Mobile 提示框）
//
// 现场与根因（主会话只读定案）：有壁纸时 applyTokenOverrides 把宿主 --dsw-alias-bg-layer-1/2 全局改半透明；
// 插件市场「任务」浮层 .nUhMVa_opPanel（dshmarket CSS module，hash 前缀随构建变、后缀 _opPanel 稳定）
// 与 DSH Mobile 提示框族（.dsh-mobile-control__notes-panel 等 4 个）消费 bg-layer 且无 backdrop ⇒ 白纱透字。
// 修法 = 既有实底补偿机制：mpwSolidSurfaceSync/Fast 把这些表面打 data-mpw-solid-surface="l1"
// （不改全局 token 值/既有 l1·l2 语义/宿主与 dshmarket 源码；不加 :has()；排除我方节点）。
// 断言（DOM 夹具跑**真函数体**——从 client.js 提取 mpwSolidSurfaceSync/Fast/mpwSolidInMarket/mpwIsOurs）：
//   S1 sync：市场容器内 .nUhMVa_opPanel ⇒ 打 l1；DSH Mobile 四个精确类 ⇒ 打 l1；触发器不标
//   S2 fast：同一 tick 打标（首帧不闪透明）——opPanel + notes-panel 都走快路
//   S3 反向：非市场同后缀类 / 我方节点 / 普通 div 不误标；触发器不标
//   S4 源码：l1 CSS 规则在位；无 [class*="dsh-mobile-control__"] 毯式子串选择器（只许精确类）
// 变异自证（对提取的函数体打补丁；期望红集 == 实际红集，逐条相等）：
//   M1 删 _opPanel 处理 ⇒ 红 [S1op]；M2 删 fast 扩表 ⇒ 红 [S2]；M3 删 DSH Mobile sync 块 ⇒ 红 [S1mb]
// 用法: node tools/market-op-panel-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

/* ---------- 提取真函数体 ---------- */
function sliceAnchor(startAnchor, endAnchor) {
  const i = CLIENT.indexOf(startAnchor)
  if (i < 0) return null
  const j = CLIENT.indexOf(endAnchor, i + startAnchor.length)
  return j > i ? CLIENT.slice(i, j) : null
}
const SRC_FAST = sliceAnchor('function mpwSolidSurfaceFast(el) {', 'function mpwTagPopoverFast(records) {')
const SRC_SYNC = sliceAnchor('function mpwSolidSurfaceSync() {', '/* ①(P3 修复 2026-10-03')
const SRC_OURS = sliceAnchor('function mpwIsOurs(node) {', 'function mpwSolidSurfaceFast(el) {')

/* ---------- 极简 DOM 夹具（只支持本判据用到的选择器形态） ---------- */
function mkNode(tag, cls, attrs, parent) {
  const node = {
    tagName: String(tag).toUpperCase(), className: cls || '', nodeType: 1,
    __attrs: Object.assign({}, attrs || {}), children: [], parentElement: parent || null,
  }
  node.classList = { contains: (c) => String(node.className).split(/\s+/).includes(c) }
  node.getAttribute = (k) => (k in node.__attrs ? String(node.__attrs[k]) : null)
  node.setAttribute = (k, v) => { node.__attrs[k] = String(v) }
  node.matches = (sel) => selMatch(node, sel)
  node.closest = (sel) => { let p = node; while (p) { if (selMatch(p, sel)) return p; p = p.parentElement } return null }
  node.querySelectorAll = (sel) => {
    const out = []
    const walk = (n) => { for (const c of n.children) { if (selMatch(c, sel)) out.push(c); walk(c) } }
    walk(node); return out
  }
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] || null
  if (parent) parent.children.push(node)
  return node
}
function classesOf(n) { return String((n && n.className) || '').split(/\s+/).filter(Boolean) }
function selMatch(n, sel) {
  for (const part of String(sel).split(',')) {
    const s = part.trim()
    if (!s) continue
    let hit = false
    if (s.startsWith('.')) hit = classesOf(n).includes(s.slice(1))
    else if (s.startsWith('[class*="')) hit = String(n.className || '').indexOf(s.slice(9, s.indexOf('"', 9))) >= 0
    else if (s.startsWith('[data-plugin*="')) hit = String((n.__attrs || {})['data-plugin'] || '').indexOf(s.slice(15, s.indexOf('"', 15))) >= 0
    else if (s.startsWith('[')) {
      const k = s.slice(1, s.indexOf('='))
      const v = s.slice(s.indexOf('=') + 2, s.lastIndexOf('"'))
      hit = String((n.__attrs || {})[k] || '') === v
    } else hit = n.tagName === String(s).toUpperCase()
    if (hit) return true
  }
  return false
}
function buildWorld() {
  const body = mkNode('body', '')
  const market = mkNode('div', 'nUhMVa_market dshmarket', { 'data-plugin': 'dshmarket' }, body)
  const opWrap = mkNode('div', 'nUhMVa_opWrap', {}, market)
  const opPanel = mkNode('div', 'nUhMVa_opPanel', {}, opWrap)
  const strayPanel = mkNode('div', 'xFoo_opPanel', {}, body)         // 非市场同后缀类（反向）
  const mbPanel = mkNode('div', 'dsh-mobile-control__panel', {}, body)
  const mbTrigger = mkNode('button', 'dsh-mobile-control__trigger', {}, mbPanel)
  const mbNotes = mkNode('div', 'dsh-mobile-control__notes-panel', {}, mbPanel)
  const mbUpdateNotes = mkNode('div', 'dsh-mobile-control__update-notes', {}, body)
  const mbUpdateCard = mkNode('div', 'dsh-mobile-control__update-card', {}, body)
  const mbWarn = mkNode('div', 'dsh-mobile-control__http-frame-warning', {}, body)
  const oursRoot = mkNode('div', 'mpw_layer', { 'data-plugin': 'dsh-mpkg-wallpaper' }, body)
  const oursPanel = mkNode('div', 'myPlugin_opPanel', {}, oursRoot)   // 我方节点（反向）
  const plain = mkNode('div', 'plain', {}, body)
  return { body, market, opWrap, opPanel, strayPanel, mbPanel, mbTrigger, mbNotes, mbUpdateNotes, mbUpdateCard, mbWarn, oursRoot, oursPanel, plain }
}

function runFixture(mutatedFastSrc, mutatedSyncSrc, mutatedOursSrc) {
  const doc = { __nodes: [], querySelectorAll: (sel) => { const out = []; const walk = (n) => { for (const c of n.children) { if (selMatch(c, sel)) out.push(c); walk(c) } } ; for (const b of doc.__roots) walk(b); return out } }
  const w = buildWorld()
  doc.__roots = [w.body]
  const fns = new Function('document', 'window', (mutatedOursSrc || SRC_OURS) + '\n' + (mutatedFastSrc || SRC_FAST) + '\n' + (mutatedSyncSrc || SRC_SYNC) + '\nreturn { sync: mpwSolidSurfaceSync, fast: mpwSolidSurfaceFast };')(doc, {})
  return { w, fns }
}

console.log('== S1/S3/S4 主判据（真函数体 + DOM 夹具）==')
let base
try { base = runFixture() } catch (e) { console.error('夹具执行异常: ' + (e && e.stack || e)); process.exit(1) }
{
  base.fns.sync()
  const r = base.w
  ok('S1op 市场容器内 opPanel 被 sync 打 l1', r.opPanel.getAttribute('data-mpw-solid-surface') === 'l1')
  ok('S1mb DSH Mobile 四个提示框被 sync 打 l1', ['mbNotes', 'mbUpdateNotes', 'mbUpdateCard', 'mbWarn'].every((k) => r[k].getAttribute('data-mpw-solid-surface') === 'l1'))
  ok('S3a 非市场同后缀类不误标', r.strayPanel.getAttribute('data-mpw-solid-surface') !== 'l1')
  ok('S3b 我方节点（祖先 data-plugin=本插件）不误标', r.oursPanel.getAttribute('data-mpw-solid-surface') !== 'l1')
  ok('S3c DSH Mobile 触发器不被改背景（精确类不含它）', r.mbTrigger.getAttribute('data-mpw-solid-surface') !== 'l1')
  ok('S3d 普通 div 不误标', r.plain.getAttribute('data-mpw-solid-surface') !== 'l1')
}
console.log('\n== S2 fast 快路（同 tick 打标）==')
{
  const r1 = runFixture()
  const n1 = r1.fns.fast(r1.w.opPanel)
  ok('S2op fast(opPanel) 首帧即打标', n1 === 1 && r1.w.opPanel.getAttribute('data-mpw-solid-surface') === 'l1')
  const r2 = runFixture()
  const n2 = r2.fns.fast(r2.w.mbNotes)
  ok('S2mb fast(notes-panel) 同 tick 打标', n2 === 1 && r2.w.mbNotes.getAttribute('data-mpw-solid-surface') === 'l1')
  const r3 = runFixture()
  const n3 = r3.fns.fast(r3.w.mbTrigger)
  ok('S2反 fast(trigger) 不打标', n3 === 0 && r3.w.mbTrigger.getAttribute('data-mpw-solid-surface') !== 'l1')
}
console.log('\n== S4 源码断言 ==')
{
  ok('S4a l1 CSS 规则在位（既有语义未改）', /html body \[data-mpw-solid-surface="l1"\]/.test(CLIENT))
  ok('S4b 无 DSH Mobile 毯式子串选择器（只许精确类）', !/\[class\*="dsh-mobile-control__"\]/.test(CLIENT) && /\.dsh-mobile-control__notes-panel/.test(CLIENT))
  ok('S4c _opPanel 市场限定函数在位', SRC_FAST && SRC_FAST.includes('function mpwSolidInMarket') && SRC_SYNC.includes('mpwSolidInMarket'))
  ok('S4d 全局 token 覆盖值未被顺手改（applyTokenOverrides 只在原处）', (CLIENT.match(/--dsw-alias-bg-layer-1/g) || []).length >= 2)
}

console.log('\n== M 变异自证（对提取函数体打补丁；期望红集 == 实际红集，逐条相等）==')
function redSet(fastSrc, syncSrc) {
  const { w, fns } = runFixture(fastSrc, syncSrc)
  fns.sync()
  const g = {
    S1op: w.opPanel.getAttribute('data-mpw-solid-surface') === 'l1',
    S1mb: ['mbNotes', 'mbUpdateNotes', 'mbUpdateCard', 'mbWarn'].every((k) => w[k].getAttribute('data-mpw-solid-surface') === 'l1'),
    S2: (() => { const r2 = runFixture(fastSrc, syncSrc); const n = r2.fns.fast(r2.w.opPanel); return n === 1 && r2.w.opPanel.getAttribute('data-mpw-solid-surface') === 'l1' })(),
  }
  return ['S1op', 'S1mb', 'S2'].filter((k) => !g[k])
}
const MUT = [
  { id: 'M1', what: '删 _opPanel sync 处理 ⇒ S1op 必红', expect: ['S1op'],
    patch: (s) => s.split('\n').filter((l) => !l.includes('_opPanel') || l.includes('dsh-conv-panel')).join('\n'),
    verify: (s) => !s.includes("document.querySelectorAll('[class*=\"_opPanel\"]')") },
  { id: 'M2', what: 'fast 扩表去掉 opPanel 条目 ⇒ S2 必红', expect: ['S2'],
    patch: (s) => s.replace("['[class*=\"_opPanel\"]', \"l1\", true],", ''),
    verify: (s) => !s.includes("['[class*=\"_opPanel\"]', \"l1\", true],") },
  { id: 'M3', what: '删 DSH Mobile sync 块 ⇒ S1mb 必红', expect: ['S1mb'],
    patch: (s) => s.replace(/\.dsh-mobile-control__notes-panel, \.dsh-mobile-control__update-notes, \.dsh-mobile-control__update-card, \.dsh-mobile-control__http-frame-warning/, '.dsh-mobile-control__none'),
    verify: (s) => !s.includes('__notes-panel, .dsh-mobile-control__update-notes') },
]
for (const m of MUT) {
  const isFast = m.id === 'M2'
  const src = isFast ? SRC_FAST : SRC_SYNC
  const mutated = m.patch(src)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const red = isFast ? redSet(mutated, SRC_SYNC) : redSet(SRC_FAST, mutated)
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

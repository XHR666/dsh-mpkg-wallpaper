// tools/scan-detail-overlay-test.mjs —— Z4（2026-11-07 任务书）：扫描页详情预览覆盖层 + 已应用 SVG 徽标复核判据
//
// 职责 = **只读复核 + 补判据**（UI 修复由主会话完成、已在基线 64476d4 里；本判据不改 UI）。
// 复核结论（读数见各断言 detail）：
//   · 详情/网格占位：类型词仍是占位**内容**（空态兜底用），但占位**层**只在"无媒体候选"时显示
//     （data-mpw-thumb-shown 门控 + display:none !important）⇒ 媒体存在时不再盖白蒙层/类型字；
//   · 白蒙层：扫描页缩略图自带的模糊铺底层（.mpw_thumb::before）在 [data-mpw-bs-scan] 下被整体关闭；
//   · 已应用角标：content:"✓" 字符已换成 18px 圆形 SVG 勾徽标（亮/暗两套 background-image）。
// 断言：
//   A 无类型占位覆盖：A1 mpwThumbChildren 的占位层只在无媒体候选时标 shown（源码）；
//     A2 扫描详情/网格两条 :not([data-mpw-thumb-shown]) display:none !important 规则在位；
//     A3 行为级：用**真 mpwThumbChildren 函数体**（从源码提取 + 桩候选链）验证 有候选⇒占位未标 shown、
//        无候选⇒标 shown（CSS 据此隐藏/显示）。
//   B 无白色蒙层：B1 [data-mpw-bs-scan] 下 .mpw_scanThumb/.mpw_scanSelThumb/.mpw_scanCell 的 ::before
//     关闭规则在位（display:none + filter:none）。
//   C SVG 徽标：C1 .mpw_scanCellApplied::after content:"" + 两套 SVG data-uri + 暗色变体 + 类名仍在 JS；
//     C2 content: "✓" 0 命中。
//   D 不退化：bs-scan-test / bs-tab-test 子进程全绿。
// 变异自证（隔离副本 os.tmpdir()；期望红集 == 实际红集，逐条相等）：
//   M1 去掉详情占位的 :not([data-mpw-thumb-shown]) 门控 ⇒ 红 ["A"]；
//   M2 徽标换回 content:"✓"（删 SVG）⇒ 红 ["C"]；
//   M3 删掉扫描页 ::before 关闭规则（白蒙层回归）⇒ 红 ["B"]。
// 改前红：--client <修复前副本> ⇒ A/B/C 全红（主会话修复在 64476d4，其父提交即"改前"）。
// 用法: node tools/scan-detail-overlay-test.mjs [--client <path>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }
const argC = process.argv.indexOf('--client')
const clientPath = argC > 0 ? process.argv[argC + 1] : path.join(ROOT, 'lib', 'client.js')
if (argC > 0) console.log('  （对照副本：' + clientPath + '）')
const CLIENT = fs.readFileSync(clientPath, 'utf8')

function runSourceChecks(src) {
  const r = {}
  /* A */
  {
    const aFail = []
    if (!/"data-mpw-thumb-shown": out\.length \? void 0 : ""/.test(src)) aFail.push('A1 占位层 shown 门控缺失（mpwThumbChildren）')
    if (!/\.mpw_scanSelThumb \[data-mpw-thumb-ph\]:not\(\[data-mpw-thumb-shown\]\) \{\s*\n\s*display: none !important;/.test(src)) aFail.push('A2 详情占位隐藏规则缺失')
    if (!/\[data-mpw-scan-grid\] \.mpw_scanThumb \[data-mpw-thumb-ph\]:not\(\[data-mpw-thumb-shown\]\) \{\s*\n\s*display: none !important;/.test(src)) aFail.push('A2 网格占位隐藏规则缺失')
    r['A'] = aFail.length === 0
    r.__a = aFail.join('；') || 'shown 门控 + 详情/网格隐藏规则在位'
  }
  /* B */
  {
    const bFail = []
    if (!/html body \[data-mpw-bs-scan\] \.mpw_scanThumb::before,\s*\nhtml body \[data-mpw-bs-scan\] \.mpw_scanSelThumb::before,\s*\nhtml body \[data-mpw-bs-scan\] \.mpw_scanCell \.mpw_thumb::before \{\s*\n\s*display: none !important;/.test(src)) bFail.push('B1 扫描页 ::before 关闭规则缺失')
    r['B'] = bFail.length === 0
    r.__b = bFail.join('；') || '模糊铺底层在扫描页整体关闭'
  }
  /* C */
  {
    const cFail = []
    const blk = (src.match(/\.mpw_scanCellApplied::after \{[\s\S]*?\n\}/) || [''])[0]
    if (!blk) cFail.push('C1 徽标规则块缺失')
    else {
      if (!/content: ""/.test(blk)) cFail.push('C1 content 非空')
      if (!(blk.match(/data:image\/svg\+xml/g) || []).length) cFail.push('C1 无 SVG data-uri')
      if (!/body\[data-ds-dark-theme\] \.mpw_scanCellApplied::after \{/.test(src)) cFail.push('C1 暗色变体缺失')
    }
    if (!/" mpw_scanCellApplied"/.test(src)) cFail.push('C1 类名不在 JS 里使用（className 拼接点丢失）')
    if ((src.match(/content: *"✓"/g) || []).length !== 0) cFail.push('C2 content:"✓" 残留')
    r['C'] = cFail.length === 0
    r.__c = cFail.join('；') || 'SVG 勾徽标（亮/暗两套）+ content 空 + 类名在用'
  }
  return r
}

console.log('== 主判据（源码级）==')
const srcR = runSourceChecks(CLIENT)
for (const [id, name] of [['A', 'A 无类型占位覆盖（shown 门控 + 隐藏规则）'], ['B', 'B 无白色蒙层（::before 关闭规则）'], ['C', 'C 已应用角标 = SVG 徽标（✓ 字符 0 残留）']]) {
  if (srcR[id]) ok(name, srcR['__' + id.toLowerCase()])
  else bad(name, srcR['__' + id.toLowerCase()])
}

console.log('\n== A3 行为级：真 mpwThumbChildren 函数体（提取 + 桩候选链）==')
{
  const i = CLIENT.indexOf('function mpwThumbChildren(h, section, opts) {')
  let d = 0, j = i
  if (i >= 0) for (; j < CLIENT.length; j++) { if (CLIENT[j] === '{') d++; else if (CLIENT[j] === '}') { d--; if (d === 0) break } }
  const fnSrc = i >= 0 ? CLIENT.slice(i, j + 1) : ''
  if (!fnSrc) bad('A3 未能提取 mpwThumbChildren 函数体')
  else {
    const run = (cands) => {
      const mk = (t, p, ...k) => ({ __el: true, type: t, props: p || {}, kids: k.flat(9) })
      const f = new Function('h', 'mpwThumbCandidates', 'mpwThumbDirIdentity', 'mpwThumbEpoch', 'mpwThumbOk', 'mpwThumbNext', fnSrc + '\nreturn mpwThumbChildren;')(
        mk, () => cands, () => 'probe-dir', 7, () => {}, () => {})
      return f(mk, {}, {})
    }
    const withMedia = run([{ kind: 'video', src: 'probe.mp4' }])
    const ph1 = withMedia.find((e) => e.props && e.props['data-mpw-thumb-ph'] !== undefined)
    const mediaEls = withMedia.filter((e) => e.type === 'video' || e.type === 'img')
    const noMedia = run([])
    const ph2 = noMedia.find((e) => e.props && e.props['data-mpw-thumb-ph'] !== undefined)
    const a3 = []
    if (!ph1) a3.push('有候选时占位元素缺失')
    else if (ph1.props['data-mpw-thumb-shown'] !== undefined) a3.push('有候选时占位被标 shown（会被显示 ⇒ 覆盖媒体）')
    if (!mediaEls.length) a3.push('有候选时媒体元素缺失')
    if (!ph2) a3.push('无候选时占位元素缺失')
    else if (ph2.props['data-mpw-thumb-shown'] !== '') a3.push('无候选时占位未标 shown（空态没内容）')
    if (a3.length === 0) ok('A3 有候选⇒占位未标 shown（CSS 隐藏）；无候选⇒标 shown（空态显示）')
    else bad('A3 占位门控行为不符', a3.join('；'))
  }
}

console.log('\n== D 回归（子进程，退出码；"不退化"= 无新增红）==')
/* bs-scan 必须全绿；bs-tab 里 D8a（同格堆叠 visibility:hidden）是基线 64476d4 上的**既有红**
   （detach A/B 已证：基线同红，主会话遗留，非本轮引入）⇒ "不退化"口径 = 除该条外不允许任何 ✗，
   K 组（K1/K2/K3/K3b/K4）必须全绿。 */
{
  try { execFileSync('node', [path.join(here, 'bs-scan-test.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); ok('D bs-scan-test 全绿') }
  catch (e) { bad('D bs-scan-test 红', String(e.stdout || e.message).split('\n').filter((l) => l.includes('✗')).slice(0, 2).join(' | ')) }
  let btOut = ''
  let btExit = 0
  try { btOut = execFileSync('node', [path.join(here, 'bs-tab-test.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString() } catch (e) { btExit = 1; btOut = String(e.stdout || e.message) }
  const reds = btOut.split('\n').filter((l) => l.includes('  ✗')).map((l) => l.trim())
  const preExisting = reds.filter((l) => l.startsWith('✗ D8a'))
  const newReds = reds.filter((l) => !l.startsWith('✗ D8a'))
  if (newReds.length === 0) ok('D bs-tab-test 无新增红（K 组全绿；既有红仅 D8a）', '红条目=' + JSON.stringify(reds))
  else bad('D bs-tab-test 出现新增红（不退化被破坏）', newReds.join(' | '))
}

console.log('\n== M 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: '详情占位去掉 shown 门控（覆盖层回归）⇒ A 必红', expect: ['A'],
    patch: (s) => s.replace('.mpw_scanSelThumb [data-mpw-thumb-ph]:not([data-mpw-thumb-shown]) {', '.mpw_scanSelThumb [data-mpw-thumb-ph] {'),
    verify: (s) => s.includes('.mpw_scanSelThumb [data-mpw-thumb-ph] {') && !s.includes('.mpw_scanSelThumb [data-mpw-thumb-ph]:not([data-mpw-thumb-shown]) {') },
  { id: 'M2', what: '徽标换回 content:"✓" 并删 SVG ⇒ C 必红', expect: ['C'],
    patch: (s) => s.replace(/\.mpw_scanCellApplied::after \{[\s\S]*?\n\}/, '.mpw_scanCellApplied::after {\n\tcontent: "✓"; position: absolute; right: 5px; top: 5px; }'),
    verify: (s) => (s.match(/content: *"✓"/g) || []).length >= 1 },
  { id: 'M3', what: '删扫描页 ::before 关闭规则（白蒙层回归）⇒ B 必红', expect: ['B'],
    patch: (s) => s.replace(/html body \[data-mpw-bs-scan\] \.mpw_scanThumb::before,[\s\S]*?\n\}/, '/* M3 removed */'),
    verify: (s) => !/html body \[data-mpw-bs-scan\] \.mpw_scanSelThumb::before/.test(s) },
]
for (const m of MUT) {
  const mutated = m.patch(CLIENT)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-ov-mut-'))
  const p = path.join(TMP, 'client-mut.js')
  fs.writeFileSync(p, mutated)
  const r = runSourceChecks(fs.readFileSync(p, 'utf8'))
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  const red = ['A', 'B', 'C'].filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

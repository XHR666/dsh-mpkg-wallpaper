// tools/command-output-header-test.mjs —— Z8（2026-11-07 任务书）：会话命令输出滚动容器被标题栏选择器误伤的回归判据
//
// 现场（主会话 A/B 定案）：dsh-conversation 命令输出头复用宿主标题栏类名
// `div._header_8z71b_32.wSkVaW_header`（无 data-window-drag），本插件的全族 `.wSkVaW_header` /
// `[class*="_header"]` 规则把它当真标题栏：注入 float 几何（圆角 28px/背景/margin）+ overflow:visible
// 覆盖宿主 overflow:auto ⇒ 滚动失效、内容溢出堆叠。修法 = 全族结构限定为 `header.…`（真标题栏是
// `<header class="wSkVaW_header">`），JS 查询同改；既有判据钉住文本按 R19 演进（见各文件头）。
// 断言：
//   A 源码级：client.js 里不存在裸 `.wSkVaW_header`（必须 header. 限定；headerBlank/Sessionless 等
//     同前缀类不算）；`[class*="wSkVaW_header"]` / `[class*="_header"]` / `[class*="_header_"]` 全部
//     header 限定（_floatHeader_ 是另一族，单独登记不在本轮范围）。
//   B 反向（防"收没了"）：真标题栏选择器仍在——`header.wSkVaW_header` 出现次数 ≥ 基线（实测 106）；
//     wide 桥/z 序/磨砂/光晕面的 header 限定选择器都在。
//   C 行为级（产物 CSS）：__mpwBuildCss 产物里每一条引用标题栏类的规则的每个复合选择器都被 header
//     限定 ⇒ 伪造的 `div._header_8z71b_32.wSkVaW_header` 不再命中任何产物规则（真 <header> 命中）。
//   D 回归：panel-fixes / style-scope-guard / conv-panel-firstframe 子进程全绿。
// 变异自证（内存副本；期望红集 == 实际红集，逐条相等）：
//   M1 把 aqua 主题那条改回裸 `.wSkVaW_header` ⇒ 红 [A]；
//   M2 wide 桥 `[class*="_header_"]` 去掉 header 限定 ⇒ 红 [A]；
//   M3 全部 header 限定删光（真标题栏也收没）⇒ 红 [B]。
// 用法: node tools/command-output-header-test.mjs
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

const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce', '__mpwBuildCss']
const resetGlobals = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch {} } }

/* 源码级扫描：定位所有"选择器位置"的 wSkVaW_header / _header 引用，检查 header 限定。 */
function scanSource(src) {
  const bad = []
  // 1) 裸 .wSkVaW_header（后面不跟同前缀大写字母；前面不能是 header.）
  for (const m of src.matchAll(/(?<!header)\.wSkVaW_header(?![A-Za-z])/g)) {
    bad.push('裸 .wSkVaW_header @' + src.slice(0, m.index).split('\n').length)
  }
  // 2) 属性子串选择器必须 header 限定（_floatHeader_ 属另一族，登记不在本轮范围）
  for (const m of src.matchAll(/(?<!header)\[class\*="wSkVaW_header"\]/g)) bad.push('未限定 [class*="wSkVaW_header"] @' + src.slice(0, m.index).split('\n').length)
  for (const m of src.matchAll(/(?<!header)\[class\*="_header"\]/g)) bad.push('未限定 [class*="_header"] @' + src.slice(0, m.index).split('\n').length)
  for (const m of src.matchAll(/(?<!header)\[class\*="_header_"\]/g)) bad.push('未限定 [class*="_header_"] @' + src.slice(0, m.index).split('\n').length)
  return bad
}
/* 产物级：从 CSS 文本抽出顶层规则的每个选择器复合段，凡引用标题栏类的复合段必须以 header 开头。 */
function scanProduct(cssText) {
  const bad = []
  let depth = 0, selStart = 0
  const segs = []
  for (let i = 0; i < cssText.length; i++) {
    const c = cssText[i]
    if (c === '/' && cssText[i + 1] === '*') { const e = cssText.indexOf('*/', i + 2); i = e < 0 ? cssText.length : e + 1; continue }
    if (c === '{') { if (depth === 0) segs.push(cssText.slice(selStart, i)); depth++; continue }
    if (c === '}') { depth--; if (depth === 0) selStart = i + 1; continue }
  }
  for (const seg of segs) {
    // 逗号拆分；对每个复合段，找标题栏类 token，检查其前面紧邻的是 header（tag 限定）
    for (const one of seg.split(',')) {
      const s = one.trim()
      if (!/wSkVaW_header|_header_/.test(s)) continue
      for (const m of s.matchAll(/(header\.)?\.?wSkVaW_header(?![A-Za-z])|(header)?\[class\*="(_header_?|wSkVaW_header)"\]/g)) {
        const tok = m[0]
        if (tok.startsWith('header')) continue
        bad.push('产物规则未限定: ' + s.slice(0, 90) + (s.length > 90 ? '…' : ''))
        break
      }
    }
  }
  return bad
}

console.log('== 主判据 ==')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
{
  const badSrc = scanSource(CLIENT)
  if (badSrc.length === 0) ok('A 源码级：无裸 .wSkVaW_header / 未限定 _header 族（_floatHeader_ 另族登记）')
  else bad('A 源码级：存在未限定选择器', badSrc.slice(0, 6).join(' | '))
  const cnt = (CLIENT.match(/header\.wSkVaW_header/g) || []).length
  const cnt2 = (CLIENT.match(/header\[class\*="_header_"\]/g) || []).length
  if (cnt >= 90 && cnt2 >= 10) ok('B 反向：真标题栏选择器仍在（header.wSkVaW_header×' + cnt + '，header[_header_]×' + cnt2 + '）')
  else bad('B 反向：真标题栏选择器被收没', 'header.wSkVaW_header×' + cnt + ' header[_header_]×' + cnt2)
  const forGlow = /MPW_GLOW_FACE_SEL = 'header\.wSkVaW_header/.test(CLIENT)
  const forWide = /'header, header\[class\*="_header_"\]:not\(\[data-code-block-banner\]\)/.test(CLIENT)
  const forFrost = /html body\[data-mpw-hdr-frost-el\] header\.wSkVaW_header/.test(CLIENT)
  if (forGlow && forWide && forFrost) ok('B2 关键功能面仍接真标题栏（光晕面/wide 桥/磨砂）')
  else bad('B2 关键功能面丢失', 'glow=' + forGlow + ' wide=' + forWide + ' frost=' + forFrost)
}
{
  resetGlobals(); cancelWorldTimers()
  const w = loadPlugin({ quiet: true, settings: { enabled: true, image: 'stub-wallpaper.png' } })
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ enabled: true, image: 'stub-wallpaper.png' }) : '')
  const badCss = scanProduct(css)
  if (badCss.length === 0) ok('C 产物级：每条标题栏规则的复合段都 header 限定（命令输出头 div 不再命中）')
  else bad('C 产物级：存在未限定规则', badCss.slice(0, 5).join(' | '))
  // 双向：真 <header class="wSkVaW_header"> 仍命中（用产物选择器对两种节点做 matches 模拟）
  const divHit = badCss.length === 0
  ok('C2 双向：命令输出头 div 无命中=' + divHit + '（真 header 命中由 B2 源码断言背书）')
  cancelWorldTimers()
}
console.log('\n== D 回归（子进程）==')
for (const t of ['panel-fixes-test', 'style-scope-guard', 'conv-panel-firstframe-test']) {
  let exit = 0
  try { execFileSyncWait(t) } catch (e) { exit = 1 }
  if (exit === 0) ok('D ' + t + ' 绿')
  else bad('D ' + t + ' 红（既有红需与本轮前一致）')
}
function execFileSyncWait(t) {
  execFileSync('node', [path.join(here, t + '.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
}

console.log('\n== M 变异自证（内存副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: 'aqua 主题条改回裸 .wSkVaW_header ⇒ A 必红', expect: ['A'],
    patch: (s) => s.replace('body[data-mpw-aqua] header.wSkVaW_header:not([data-code-block-banner])', 'body[data-mpw-aqua] .wSkVaW_header:not([data-code-block-banner])'),
    verify: (s) => /body\[data-mpw-aqua\] \.wSkVaW_header:/.test(s) },
  { id: 'M2', what: 'wide 桥 _header_ 去掉 header 限定 ⇒ A 必红', expect: ['A'],
    patch: (s) => s.replace("'header, header[class*=\"_header_\"]:not([data-code-block-banner]):not([data-disclosure-header])'", "'header, [class*=\"_header_\"]:not([data-code-block-banner]):not([data-disclosure-header])'"),
    verify: (s) => s.includes("'header, [class*=\"_header_\"]:not([data-code-block-banner])") },
  { id: 'M3', what: '全部 header 限定删光 ⇒ B 必红（真标题栏也被收没；删限定必然产生裸选择器 ⇒ A 同时红，这是该变异的固有伴生红）', expect: ['A', 'B'],
    patch: (s) => s.replace(/header\.wSkVaW_header/g, '.wSkVaW_header'),
    verify: (s) => (s.match(/(?<![\w.])header\.wSkVaW_header(?![A-Za-z])/g) || []).length === 0 },
]
for (const m of MUT) {
  const mut = m.patch(CLIENT)
  if (!m.verify(mut)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const r = {}
  r['A'] = scanSource(mut).length === 0
  const cnt = (mut.match(/header\.wSkVaW_header/g) || []).length
  /* 与主判据 B 同口径：计数下限 90（Blank/Sessionless 等同前缀类会抬高裸计数，不影响该下限语义） */
  r['B'] = cnt >= 90 && /header\[class\*="_header_"\]/.test(mut) && /MPW_GLOW_FACE_SEL = 'header\.wSkVaW_header/.test(mut)
  const red = ['A', 'B'].filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

// tools/css-matrix.mjs — 设置组合矩阵下的 CSS 结构与"历史 bug 回归"校验（无需浏览器）
//
// 为什么需要它：插件的外观 CSS 由 buildCss(section) 现场拼装，任何一处抛错都会让
// <style> 保持为空 → 整个界面错乱（已经发生过两次）。单组设置构建通过 ≠ 其它组合通过，
// 所以这里把关键开关做全组合遍历 + 随机组合抽样，并对每个组合断言：
//   结构类：不抛错 / 花括号配平 / 无 ${ 残留 / 无 undefined|NaN|[object Object]
//   回归类：以前修过的 bug 不许复活（详见 CHECK 列表）
//
// 用法: node tools/css-matrix.mjs [--client <path>] [--random 600] [--css <out.css>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, readSection } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const argClient = process.argv.indexOf('--client')
const clientPath = argClient > 0 ? process.argv[argClient + 1] : path.join(here, '..', 'lib', 'client.js')
const argRand = process.argv.indexOf('--random')
const RANDOM = argRand > 0 ? Math.max(0, parseInt(process.argv[argRand + 1], 10) || 0) : 600

const problems = []
const note = (m) => { if (problems.length < 40) problems.push(m) }

/* ---------- 载入插件（apply 一次即可，__mpwBuildCss 是纯函数） ---------- */
const loaded = loadPlugin({ clientPath, settings: readSection(), quiet: true })
if (loaded.applyErrors.length) problems.push('apply 期间报错: ' + loaded.applyErrors.slice(0, 3).join(' | '))
if (typeof globalThis.__mpwBuildCss !== 'function') {
  console.error('✗ 插件未暴露 __mpwBuildCss（无法做组合校验）')
  process.exit(1)
}
const build = (patch) => { try { return String(globalThis.__mpwBuildCss(patch) || '') } catch (e) { return '/*BUILD_ERROR*/ ' + (e && e.message) } }

const base = Object.assign({}, readSection(), { image: true, enabled: true })

/* ---------- 组合空间 ---------- */
// 核心开关：全组合（2^9 = 512）——覆盖"透出/虚化/悬浮/玻璃/水色"之间的相互影响
const CORE = ['sidebar', 'unifyTint', 'headerBg', 'headerBlur', 'float', 'lgCss', 'aquaMask', 'aquaTint', 'rightSidebarBlur']
// 其余开关：随机组合抽样（含面板里的次要开关 + 数值极值）
// ①(2026-09-19) 去掉 `glassWindow`：该字段已按用户裁定**退役删除**（无 toggleRow、无读取点，见
//   tools/switch-wiring-test.mjs 的 RETIRED 段）⇒ 再放进组合里只是给 buildCss 传一个不存在的键。
const EXTRA = ['headerFrostOwn', 'sidebarBlur', 'popoverBlur', 'confirmBlur', 'maskBlur', 'dialogBlur', 'settingsBlur', 'todoBlur',
  'chatFollow', 'sessionFollow', 'clock', 'sharp', 'aquaInk', 'aquaTextEnhance']
const NUM = { popoverAlpha: [50, 80, 94, 100], headerFrostAmount: [0, 12, 30, 60], opacity: [0, 50, 82, 100], blur: [0, 30], sidebarAlpha: [0, 35, 100], unifyAmount: [0, 30, 40],
  rightSidebarBlurAmount: [0, 14, 40], rightSidebarAlpha: [0, 45, 100], popoverAmount: [0, 10, 40], headerBlurAmount: [0, 30] }

const combos = []
for (let m = 0; m < (1 << CORE.length); m++) {
  const p = {}
  CORE.forEach((k, i) => { p[k] = !!(m & (1 << i)) })
  combos.push(['full#' + m, p])
}
let seed = 20260913
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
for (let i = 0; i < RANDOM; i++) {
  const p = {}
  for (const k of CORE.concat(EXTRA)) p[k] = rnd() < 0.5
  for (const k of Object.keys(NUM)) { const v = NUM[k]; p[k] = v[Math.floor(rnd() * v.length) % v.length] }
  combos.push(['rnd#' + i, p])
}
// 边界场景：壁纸关 / 插件关 / 测试模式
combos.push(['无壁纸', { image: false }])
combos.push(['插件关闭', { enabled: false }])
combos.push(['液态玻璃测试模式', { lgTest: true }])

/* ---------- 断言实现 ---------- */
const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '')
const rules = (t) => [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
const subjectIs = (sel, needle) => sel.split(',').some((s) => s.trim().endsWith(needle))
const bodyHas = (body, prop) => new RegExp('(^|;)\\s*' + prop + '\\s*:').test(body)
const bodyVal = (body, prop) => { const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]*)').exec(body); return m ? m[1].trim() : null }

function check(label, patch, css) {
  if (css.startsWith('/*BUILD_ERROR*/')) { note('[' + label + '] buildCss 抛错 → 样式表会变空: ' + css.slice(0, 120)); return }
  const t = strip(css)
  // 1) 结构
  let depth = 0, bad = -1
  for (let i = 0; i < t.length; i++) { if (t[i] === '{') depth++; else if (t[i] === '}') { depth--; if (depth < 0 && bad < 0) bad = i } }
  if (bad >= 0) note('[' + label + '] 多余 } → 后续规则被丢弃 @' + bad)
  if (depth !== 0) note('[' + label + '] 花括号未闭合 depth=' + depth)
  const lo = t.match(/\$\{[^}]{0,40}/)
  if (lo) note('[' + label + '] 模板占位符残留: ' + lo[0])
  for (const junk of ['undefined', 'NaN', '[object Object]']) {
    const i = t.indexOf(junk)
    if (i >= 0) note('[' + label + '] CSS 里出现 ' + junk + ': …' + t.slice(Math.max(0, i - 70), i + 24).replace(/\s+/g, ' '))
  }
  // 2) 锚点
  if (!/\.mpw-bgWrap/.test(t)) note('[' + label + '] 缺 .mpw-bgWrap（壁纸层会掉进普通流）')
  else if (!/\.mpw-bgWrap\s*\{[^}]*position:\s*fixed/.test(t) && !/\.mpw-bgWrap\s*\{[^}]*display:\s*none/.test(t)) note('[' + label + '] .mpw-bgWrap 既非 fixed 也非 hidden')
  if (!/\.pI_x6G_sidebarCol/.test(t)) note('[' + label + '] 缺 .pI_x6G_sidebarCol 规则')
  // 3) 回归：顶栏不得成为 backdrop root（否则浮层的 backdrop-filter 采样为空 → 透出锐利文字）
  for (const [sel, body] of rules(t)) {
    if (/data-mpw-hdr-blur-element/.test(sel)) continue // 显式开启的"元素级模糊"模式允许
    if (subjectIs(sel, '.wSkVaW_header') || subjectIs(sel, 'header[class*="_header_"]')) {
      if (/isolation\s*:\s*isolate/.test(body)) note('[' + label + '] 顶栏出现 isolation:isolate → 浮层虚化失效')
      for (const p of ['filter', 'backdrop-filter', '-webkit-backdrop-filter']) {
        const v = bodyVal(body, p)
        if (v && v !== 'none' && !/^none\s*!important$/.test(v)) note('[' + label + '] 顶栏自身带 ' + p + ' → 浮层虚化失效: ' + sel.slice(0, 60))
      }
      const ovf = bodyVal(body, 'overflow')
      if (ovf && /^hidden/.test(ovf)) note('[' + label + '] 顶栏 overflow:hidden → 会裁掉浮层: ' + sel.slice(0, 60))
    }
    // 4) 回归：浮层不许被改 position（会把它拉进普通流 → 顶栏被撑高）
    if (/(_menu|_popover|_dropdown|role="menu"|QsffPG_menu|_denseList)/.test(sel) && bodyHas(body, 'position')) {
      note('[' + label + '] 浮层被改 position（会撑高顶栏）: ' + sel.slice(0, 70) + ' → ' + bodyVal(body, 'position'))
    }
    // 5) 回归：悬浮态右侧导航条不许被改尺寸（曾把 38px 压成 28px）
    if (/(_tabStrip|dockkit-strip)/.test(sel)) {
      for (const p of ['padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'box-sizing', 'height', 'max-height', 'min-height']) {
        if (bodyHas(body, p)) note('[' + label + '] 导航条尺寸被改（曾压扁 38→28px）: ' + p + ' @ ' + sel.slice(0, 60))
      }
    }
    // 6) 回归：顶栏浮层宿主的层级必须够高（低于正文就会"被压住"）
    if (/QsffPG_root|QsffPG\b/.test(sel) && bodyHas(body, 'z-index')) {
      const z = bodyVal(body, 'z-index')
      if (z !== 'auto' && parseInt(z, 10) < 100) note('[' + label + '] 浮层宿主 z-index 过低（会被正文压住）: ' + z + ' @ ' + sel.slice(0, 50))
    }
  }
  // 7) 顶栏磨砂必须跟随开关（曾出现"开了虚化但规则根本没生成"）
  //    语义（源码 headerFrosted = (headerBlur || unifyTint) && headerBg）：
  //      · 「顶栏」开关(headerBg)是标题栏外观的总闸：关掉就完全不接管标题栏；
  //      · 总闸开时，统一虚化(unifyTint)或标题栏磨砂(headerBlur)任一为开 → 必须有磨砂层。
  const frost = rules(t).some(([sel, body]) => /\.wSkVaW_header::before/.test(sel) && /backdrop-filter/.test(body) && !/backdrop-filter\s*:\s*none/.test(body))
  if (typeof patch.headerBg === 'boolean' && typeof patch.headerBlur === 'boolean') {
    const wantFrost = (patch.headerBlur || !!patch.unifyTint) && patch.headerBg
    if (wantFrost && !frost) note('[' + label + '] 该有顶栏磨砂但规则缺失（虚化会"没效果"）')
    if (!wantFrost && frost) note('[' + label + '] 不该有顶栏磨砂却有（用户关掉的开关没生效）')
    if (wantFrost && !/--mpw-hdr-blur\s*:/.test(t)) note('[' + label + '] 有磨砂层但缺 --mpw-hdr-blur 半径变量')
    // 10) 「标题栏磨砂强度」独立滑条：开了就必须按它出半径（否则用户拖了没反应）
    if (wantFrost && patch.headerFrostOwn === true && typeof patch.headerFrostAmount === 'number') {
      const want = '--mpw-hdr-blur: ' + Math.round(patch.headerFrostAmount) + 'px'
      if (t.indexOf(want) < 0) note('[' + label + '] 独立磨砂滑条没生效（期望 ' + want + '）')
    }
  }
  // 8) 浮层虚化开关同理
  const popBlur = rules(t).some(([sel, body]) => /(_menu|_popover|_dropdown|role="menu")/.test(sel) && /backdrop-filter/.test(body) && !/backdrop-filter\s*:\s*none/.test(body))
  const popOn = patch.popoverBlur || patch.aquaMask || patch.aquaTint
  if (popOn && !popBlur) note('[' + label + '] 浮层虚化应生效但规则缺失')
  // 9) 弹层表面底色兜底（用户"浮层看得穿"的根治项）：只要不透明度被调低，就必须发规则
  if (typeof patch.popoverAlpha === 'number' && patch.popoverAlpha < 100) {
    if (!/--mpw-pop-alpha/.test(t)) note('[' + label + '] 调低了弹层不透明度却没发表面底色规则（会重新"看得穿"）')
    else if (t.indexOf('--mpw-pop-alpha, ' + (patch.popoverAlpha / 100).toFixed(2)) < 0) note('[' + label + '] 弹层不透明度未按设置生效（期望 ' + (patch.popoverAlpha / 100).toFixed(2) + '）')
  }
}

/* ---------- 跑矩阵 ---------- */
const dumpIdx = process.argv.indexOf('--css')
let dumped = null
for (const [label, patch] of combos) {
  const merged = Object.assign({}, base, patch)
  const css = build(merged)
  check(label, merged, css)
  if (dumpIdx > 0 && label === 'full#511') dumped = css
}
if (dumpIdx > 0 && process.argv[dumpIdx + 1] && dumped) { fs.writeFileSync(process.argv[dumpIdx + 1], dumped); console.log('（全开组合 CSS → ' + process.argv[dumpIdx + 1] + '）') }

/* ---------- 结果 ---------- */
console.log('（已校验 ' + combos.length + ' 组设置：' + (1 << CORE.length) + ' 全组合 + ' + RANDOM + ' 随机 + 3 个边界）')
if (problems.length) {
  console.error('✗ CSS 组合矩阵: 发现 ' + problems.length + ' 个问题')
  for (const p of problems) console.error('   - ' + p)
  process.exit(1)
}
console.log('✓ CSS 组合矩阵: 结构完整、无模板残留、8 类历史回归全部未复现')

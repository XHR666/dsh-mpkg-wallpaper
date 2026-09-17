// tools/switch-wiring-test.mjs —— 「开关必须真的接线」审计（功能静默无效这一类 bug 的通用判据）
//
// 为什么需要它（2026-09-18 真实事故）：
//   「配色」(accent) 与「深底文字可读增强」(aquaTextEnhance) 两段 CSS 被一起包在
//   `if (aquaOn(section))` 里 ⇒ **只开这两个开关时规则根本不生成**：界面上开关能点、
//   没有任何效果、控制台也不报错。这类 bug 靠"看代码"很难发现（每段自己的注释都写着
//   "不依赖 Aqua"），靠单测也容易漏（没人会想到给"只开 accent"写一条）。
//   通用判据：**每个开关都必须让 buildCss 的产物发生变化**（或明确登记为"不影响 CSS"）。
//
// 口径：
//   · 布尔开关：逐个比较 `buildCss({...默认, [f]: true})` 与 `buildCss({...默认, [f]: false})`
//     的产物文本（去掉注释后逐字节比较）。相同 ⇒ 该开关对 CSS 没有任何影响。
//   · 非布尔功能（配色 accent / 主题色 themeColor）单独探测。
//   · `NON_CSS` 白名单：明确只影响运行时（音频/省电/看门狗/持久化字段…）的开关，
//     每条必须写 reason（文档指针可选）；**新加的开关若既没接线也没登记 ⇒ 判红**。
//   · 分辨力自证：把 accent 的门控改回 `aquaOn` ⇒ 必须变红（变异注入到 mkdtemp 副本，
//     不动仓库文件；夹具 < 1MB，exit 兜底删除）。
//
// 用法: node tools/switch-wiring-test.mjs [--client <path>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const ONLY_JSON = process.argv.includes('--json-only')
/* 变异子进程**不许再跑变异段**（否则子进程又生孙进程 = fork 炸弹，实测挂到超时）。
   父进程 spawn 时显式带 --no-mutations。 */
const NO_MUT = process.argv.includes('--no-mutations')

/* 真实断言助手（本仓教训：ok(name, detail) 恒真 = 假绿） */
let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

/* ── A. 「不影响 buildCss 产物」白名单：只影响**运行时**的开关（每条必须写清为什么） ── */
const NON_CSS = {
  enabled: '总开关：buildCss 只在 `enabled === false` 时把 image 清空，产物差异由"无壁纸"分支承担（换算在调用点 applyFromStorageInner）',
  forceEnabled: '强制启用（运行时优先级开关），不改样式生成',
  mute: '壁纸音频静音：只作用于 video/音量，不生成 CSS',
  rotate: '自动轮换：纯定时器行为，不生成 CSS',
  hybrid: 'scene 混合渲染模式：只改 iframe 参数/合成路径，不生成 CSS',
  sceneWatchdog: '场景看门狗：运行时监控，不生成 CSS',
  clock: '时钟：元素由 JS 创建/更新（旧配置兼容项，设置页已无开关）',
  clock24h: '时钟 24 小时制：JS 写元素文案，不进 CSS',
  clockSec: '时钟秒显示：同上（元素内文案）',
  clockDate: '时钟日期显示：同上（元素内文案）',
  powPauseHidden: '省电：页面隐藏时暂停播放，运行时行为',
  powPauseBlur: '省电：失焦时暂停播放，运行时行为',
  powPauseBattery: '省电：电池供电时暂停播放，运行时行为',
  lgComposer: '液态玻璃目标选择（输入框）：由 JS 打 [data-mpw-lg-css] 标记，样式在 lgCss 段统一下发',
  lgSidebar: '液态玻璃目标选择（侧栏）：同上（JS 打标记）',
  lgHeader: '液态玻璃目标选择（顶栏）：同上（JS 打标记）',
  chatFollow: '作用于壁纸层**内联样式** --mpw-bg-blur（lib/client.js:4197 的 JS 路径），不进 buildCss（注：buildCss 里那个同名局部 chatFollowInCss 是死代码，未使用）',
  newStyle: '只改**设置页控件外观**（JS 选 className，如液态滑块 radio），不进 buildCss',
  bsBottomAvoid: '已定案的**故意空操作**：该块只输出一段说明注释（"不要再用 margin-left 二次偏移"，对齐交给 better-sidebar 自己的 ResizeObserver）',
}

/* ── A2. 非布尔功能探测：patch 里放进去必须让产物变化（运行时门控型的见 RUNTIME_GATED） ── */
const NON_BOOL_PROBES = [
  { name: 'accent', patch: { accent: '#ff0000' }, why: '「配色」：品牌交互色/发送键（2026-09-18 修复前被 aquaOn 吞掉 ⇒ 只开它时规则根本不生成）' },
  { name: 'aquaTextEnhance', patch: { aquaTextEnhance: true }, why: '「深底文字可读增强」：文字描边 + 文字 token（同上，2026-09-18 修复）' },
]

/* ── B. 已证实失效 / 未接线（尚未修）：审计会每次把它们显式列出来 ──
 * 已修并从本表删除：lgCss（TDZ，2026-09-18）、sessionFollow（无人读，2026-09-18 按用户裁定接线）。
 * 为什么要双向断言：条目一旦被修好，本表必须删掉（否则"已知失效"会变成永久遮羞布）。 */
const KNOWN_DEAD = {
  glassWindow: {
    reason: '「设置窗口液态玻璃」只有 i18n 文案与导入净化名单，**既无设置页开关也无读取点** ⇒ 功能未接线（旧配置字段）',
    evidence: 'grep -n "glassWindow" lib/client.js ⇒ 只有 i18n + boolFields 净化名单，无 toggleRow、无 section.glassWindow 读取',
  },
}

/* ── C. 运行时门控型：CSS **常驻输出**，开关通过运行时属性/内联 token 生效 ──
 * 判据不是"产物变化"（它本来就不变，这是对的），而是"门控规则必须在产物里存在"。 */
const RUNTIME_GATED = [
  { name: 'themeColor', patch: { themeColor: '#123456' }, marker: /body\[data-mpw-theme\]/, why: '主题颜色：CSS 常驻（buildThemeColorCss 无条件输出），运行时由 body[data-mpw-theme] + --mpw-theme-color 生效' },
]

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ').replace(/\s+/g, ' ').trim()
const grab = (src, name) => {
  const m = new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(src)
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-switch-wiring-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

const src = fs.readFileSync(clientPath, 'utf8')
const bools = grab(src, 'const boolFields').filter((b) => !['lgTest', 'enabled', 'forceEnabled'].includes(b))
const loaded = loadPlugin({ clientPath, settings: {}, quiet: true })
if (loaded.applyErrors.length) { console.error('✗ apply() 报错：' + loaded.applyErrors.slice(0, 2).join(' | ')); process.exit(1) }
if (typeof globalThis.__mpwBuildCss !== 'function') { console.error('✗ 未暴露 __mpwBuildCss'); process.exit(1) }
const build = (patch) => {
  try { return strip(String(globalThis.__mpwBuildCss(Object.assign({ image: true, enabled: true }, patch)) || '')) }
  catch (e) { return '/*BUILD_ERROR*/ ' + (e && e.message) }
}

if (!ONLY_JSON) console.log(`══ 开关接线审计（每个开关都必须改变 CSS，或在 NON_CSS 里登记原因）══\n产物：${path.relative(repoRoot, clientPath)} · 布尔开关 ${bools.length} 个`)

/* ── 1. 布尔开关：在**多个上下文**里，on vs off 至少要有一个不同 ──
 * 为什么不是一个上下文就够了：有些开关是**条件门**（例如 chatFollow 只在统一虚化开着时才
 * 改变聊天区规则），单看"其它全关"会误判成"没接线"。所以这里在 3 个上下文里各比一次，
 * 只要在任一上下文里改变过产物就算接线。 */
const richCtx = Object.fromEntries(['unifyTint', 'headerBg', 'headerBlur', 'sidebar', 'sidebarBlur', 'aquaMask', 'aquaTint',
  'dialogBlur', 'settingsBlur', 'confirmBlur', 'popoverBlur', 'maskBlur', 'float', 'thinkBg', 'todoBlur', 'rightSidebarBlur', 'lgCss'].map((k) => [k, true]))
const allTrue = Object.fromEntries(bools.map((b) => [b, true]))
const CONTEXTS = [
  { name: '默认档（其它全关）', base: {} },
  { name: '富上下文（主要外观全开）', base: richCtx },
  { name: '其它布尔全开', base: allTrue },
]
const noEffect = []
const effectCtx = new Map()
for (const f of bools) {
  let touched = null
  for (const c of CONTEXTS) {
    const on = build({ ...c.base, [f]: true })
    const off = build({ ...c.base, [f]: false })
    if (on !== off) { touched = c.name; break }
  }
  if (touched) effectCtx.set(f, touched)
  else if (!NON_CSS[f] && !KNOWN_DEAD[f]) noEffect.push(f)
}
if (!ONLY_JSON) {
  console.log('\n== A. 布尔开关：on/off 产物必须不同（或在 NON_CSS 登记）==')
  const wired = bools.filter((f) => effectCtx.has(f))
  ok(`★ ${bools.length} 个布尔开关全部接线（或已登记为"不影响 CSS"）`, noEffect.length === 0,
    noEffect.length ? '在 3 个上下文里都没有任何 CSS 影响且未登记：' + noEffect.join(', ')
      : `${wired.length} 个有 CSS 影响 / ${bools.filter((f) => NON_CSS[f]).length} 个已登记为"仅运行时" / ${bools.filter((f) => KNOWN_DEAD[f]).length} 个已知失效（下表）`)
}

/* ── 1a0. sessionFollow（新会话按钮跟随面板不透明度）双向判据 ──
 * 来历：设置页有开关 + 文案 + DEFAULT_SESSION_FOLLOW，但**全仓没有任何地方读 section.sessionFollow**
 * （开关点了没效果）。用户裁定按**用户可见文案**实现：开 = 跟随那条透明度（U(panel) 现状公式）；
 * 关 = 回到宿主原色 var(--dsw-alias-button-elevated-fill)（不混 transparent）。 */
const NEW_SESSION_BG = /background-color:\s*(color-mix\(in srgb, var\(--dsw-alias-button-elevated-fill\)[^;]*|var\(--dsw-alias-button-elevated-fill\)) !important;/g
const sessionCases = []
for (const ctx of [{ name: '默认档', patch: {} }, { name: '统一虚化档', patch: { unifyTint: true } }]) {
  const on = build({ ...ctx.patch, sessionFollow: true })
  const off = build({ ...ctx.patch, sessionFollow: false })
  const onVals = [...on.matchAll(NEW_SESSION_BG)].map((x) => x[1])
  const offVals = [...off.matchAll(NEW_SESSION_BG)].map((x) => x[1])
  sessionCases.push([`★ sessionFollow:开档 [${ctx.name}] 新会话按钮跟随那条透明度（color-mix + U(panel)）`,
    onVals.length >= 2 && onVals.every((v) => /^color-mix\(in srgb, var\(--dsw-alias-button-elevated-fill\) \d+%, transparent\)$/.test(v)),
    `命中 ${onVals.length} 条：${JSON.stringify(onVals)}`])
  sessionCases.push([`★ sessionFollow:关档 [${ctx.name}] 新会话按钮回**宿主原色**且不再有 color-mix 混透明`,
    offVals.length >= 2 && offVals.every((v) => v === 'var(--dsw-alias-button-elevated-fill)'),
    `命中 ${offVals.length} 条：${JSON.stringify(offVals)}`])
  sessionCases.push([`★ sessionFollow:开/关两档产物必须不同 [${ctx.name}]`, on !== off, `${on.length} B vs ${off.length} B`])
}

/* ── 1a. 液态玻璃（lgCss）双向判据 ──
 * 来历：`bdSupported` 在块内先使用后声明 ⇒ TDZ ReferenceError 被模块级 catch 吞掉，整块**从未执行**
 * （2026-09-18 修复：把声明提到使用之前，catch 保留）。判据必须双向，否则"两档都不产出"也会绿。 */
const LG_MARK_BLOCK = /mix-blend-mode:\s*screen/            // 液态玻璃块独有（玻璃高光层），与 SVG 支持无关
const LG_MARK_SVG = /url\(#mpw-lg-warp\)/                    // 只在环境支持 backdrop-filter:url() 时出现
const LG_SUPPORTED = (() => { try { return !!(globalThis.CSS && CSS.supports && CSS.supports("backdrop-filter", "url(#mpw-lg-warp)")) } catch { return false } })()
const lgOn = build({ lgCss: true })
const lgOff = build({ lgCss: false })
const lgCase = []
lgCase.push(['★ lgCss:true 的产物里出现液态玻璃块（它真的生成了）', LG_MARK_BLOCK.test(lgOn), `marker=${LG_MARK_BLOCK} / len=${lgOn.length}`])
lgCase.push(['★ lgCss:false 的产物里**没有**液态玻璃块', !LG_MARK_BLOCK.test(lgOff) && !LG_MARK_SVG.test(lgOff), `len=${lgOff.length}`])
lgCase.push(['★ 两档产物**不再逐字节相同**', lgOn !== lgOff, `true=${lgOn.length} B / false=${lgOff.length} B`])
lgCase.push([`★ 环境支持 backdrop-filter:url() 时必须有 url(#mpw-lg-warp)（本环境 CSS.supports=${LG_SUPPORTED}）`,
  LG_SUPPORTED ? LG_MARK_SVG.test(lgOn) : true, LG_SUPPORTED ? `count=${(lgOn.match(/url\(#mpw-lg-warp\)/g) || []).length}` : '本环境不支持 ⇒ 按"自动回退纯模糊"豁免（已断言块仍在）'])
/* ?lgcss=off 一键回退（修好后首次真正启用 ⇒ 必须能整体关掉；与 ?sbfill/?railink 同款） */
const lgOffFlag = (() => {
  try {
    const keep = globalThis.location.search
    globalThis.location.search = '?lgcss=off'
    const v = build({ lgCss: true })
    globalThis.location.search = keep
    return v
  } catch (e) { return '' }
})()
lgCase.push(['★ ?lgcss=off 时产物里**没有**液态玻璃块（一键回退有效）', !LG_MARK_BLOCK.test(lgOffFlag) && !LG_MARK_SVG.test(lgOffFlag), `len=${lgOffFlag.length}`])
lgCase.push(['★ 不写 ?lgcss=off 时必须出现液态玻璃块（回退口没把功能关死）', LG_MARK_BLOCK.test(lgOn), `len=${lgOn.length}`])

if (!ONLY_JSON) {
  console.log('\n== A4. sessionFollow（新会话按钮跟随面板不透明度）双向判据 ==')
  for (const [name, cond, detail] of sessionCases) ok(name, cond, detail)
}

/* ── 1b. 已知失效清单：必须**仍然失效**（修好了就要从表里删掉，否则这张表会变成遮羞布） ── */
if (!ONLY_JSON) {
  console.log('\n== A2. ⚠ 已知失效/未接线开关（未修，需决策）==')
  if (!Object.keys(KNOWN_DEAD).length) console.log('  （无）')
  for (const [id, info] of Object.entries(KNOWN_DEAD)) {
    const stillDead = !effectCtx.has(id)
    ok(`⚠ ${id} 仍然失效（表与实现一致）`, stillDead, info.reason)
    if (!stillDead) console.error(`      ↑ 它已经被接线了 ⇒ 请从 tools/switch-wiring-test.mjs 的 KNOWN_DEAD 删除该条`)
    console.log(`      证据：${info.evidence}`)
  }
}

if (!ONLY_JSON) {
  console.log('\n== A3. 液态玻璃（lgCss）双向判据（防"两档都不产出也算绿"）==')
  for (const [name, cond, detail] of lgCase) ok(name, cond, detail)
}

/* ── 2. 非布尔功能 ── */
if (!ONLY_JSON) console.log('\n== B. 非布尔功能：放进 patch 必须改变产物（或登记为运行时门控）==')
for (const p of NON_BOOL_PROBES) {
  const base = build({})
  const withIt = build(p.patch)
  ok(`★ ${p.name}：设值后产物变化`, withIt !== base, p.why + (withIt === base ? '（产物与默认档逐字节相同 ⇒ 该功能对 CSS 无影响）' : ''))
}
for (const r of RUNTIME_GATED) {
  const base = build({})
  ok(`★ ${r.name}：门控规则常驻产物里（运行时开关型）`, r.marker.test(String(globalThis.__mpwBuildCss({ image: true, enabled: true }) || '')), r.why)
}

/* ── 3. 分辨力自证：把 accent 的门控改回 aquaOn，必须变红 ── */
const MUTS = [
  {
    id: 'accent-gate-reverted',
    mut: (s) => s.replace('if (accentConfigured) aquaCssParts.push(', 'if (aquaOn(section)) aquaCssParts.push('),
    expect: 'A',
    why: '把「配色」的门控改回被 aquaOn 包住（2026-09-18 修复前的写法）',
  },
  {
    id: 'sessionfollow-unread-again',
    mut: (s) => s.replace('const sessionFollowOn = section.sessionFollow !== void 0 ? !!section.sessionFollow : DEFAULT_SESSION_FOLLOW;', 'const sessionFollowOn = true;'),
    expect: 'A4',
    why: '把 `section.sessionFollow` 的读取删掉（= 复现"开关存在但全仓无人读"的原 bug）',
  },
  {
    id: 'lgcss-off-guard-removed',
    mut: (s) => s.replace('if (lgCssOn && !lgCssOff && hasImage && bdSupported) {', 'if (lgCssOn && hasImage && bdSupported) {'),
    expect: 'A5',
    why: '去掉 `?lgcss=off` 的守卫（回退口失效 ⇒ 用户没法一键关掉首次启用的液态玻璃）',
  },
  {
    id: 'lgcss-tdz-restored',
    why: '把 `bdSupported` 的声明挪回液态玻璃块**之后**（复现原来的 TDZ ReferenceError ⇒ 整块被 catch 吞掉）',
    mut: (s) => s
      .replace("\t\t\tconst bdSupported = window.__mpwBackdropRendered !== false;\n\t\t\t// ①(新 2026-09-13 第15项) 纯 CSS/SVG 液态玻璃", "\t\t\t// ①(新 2026-09-13 第15项) 纯 CSS/SVG 液态玻璃")
      .replace("\t\t\t// 磨砂玻璃 = 半透明背景 + backdrop blur，两者缺一不可（原理见下方 CSS 注释）。", "\t\t\tconst bdSupported = window.__mpwBackdropRendered !== false;\n\t\t\t// 磨砂玻璃 = 半透明背景 + backdrop blur，两者缺一不可（原理见下方 CSS 注释）。"),
    expect: 'A3',
  },
  {
    id: 'text-enhance-gate-reverted',
    mut: (s) => s.replace('if (textEnhanceOn) aquaCssParts.push(', 'if (aquaOn(section)) aquaCssParts.push('),
    expect: 'A',
    why: '把「深底文字可读增强」的门控改回被 aquaOn 包住',
  },
]
if (!NO_MUT && !ONLY_JSON) console.log('\n== C. 分辨力自证：把门控改回"被 aquaOn 包住"必须变红 ==')
for (const m of (NO_MUT ? [] : MUTS)) {
  const mutated = m.mut(src)
  if (mutated === src) { ok(`变异 ${m.id} 注入成功`, false, '注入点没匹配上（源码改了？）'); continue }
  const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
  fs.writeFileSync(copy, mutated)
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--client', copy, '--no-mutations'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 })
  const out = (r.stdout || '') + (r.stderr || '')
  // 变红判定：**期望的那一组**断言必须真的报红（分组名 = 断言名前缀，避免"别的组红了也算过"）
  const GROUPS = {
    A3: /✗ ★ (lgCss:true|lgCss:false|两档产物|环境支持|\?lgcss=off 时)/,
    A4: /✗ ★ sessionFollow/,
    A5: /✗ ★ (\?lgcss=off 时|不写 \?lgcss=off 时)/,
    A: /✗ ★ (accent|themeColor|aquaTextEnhance)/,
  }
  const caughtGroups = Object.keys(GROUPS).filter((g) => GROUPS[g].test(out))
  const got = caughtGroups.includes(m.expect) ? m.expect : (r.status === 0 ? 'PASS' : 'FAIL(其它)')
  ok(`变异 ${m.id}：期望 ${m.expect} 变红，实际 ${got}`, got === m.expect, `${m.why}  [exit=${r.status}]`)
  if (got !== m.expect) console.error('      ↑ 实际报红分组：[' + caughtGroups.join(',') + ']；RED 行：'
    + out.split('\n').filter((l) => /^\s*✗/.test(l)).slice(0, 3).join(' | '))
}

cleanup()
if (!ONLY_JSON) {
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  if (fail) { console.error('✗ 开关接线审计未通过'); process.exit(1) }
  console.log('✓ 开关接线审计通过：每个开关都真的改变了 CSS（或已登记为仅运行时）')
}

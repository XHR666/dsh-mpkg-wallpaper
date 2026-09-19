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
  powPauseHidden: '省电：页面隐藏时暂停播放，运行时行为（①(NP-5) 起同时是"隐藏即静音"的总闸，见 lib/client.js 的 mpwHiddenAudioBlock）',
  /* ①(NP-5) 卡片的播放/暂停**用户意图**（持久化）：只影响运行时的媒体状态与卡片显示，
     产物 CSS 一个字都不变。读到它的是：npApplyPersistedPause()（刷新/换档后按它落实
     "整体 pause" 或 "只静音音轨"）与 npResolveMedia() 的 playing 派生量（卡片显示暂停态）。 */
  npPaused: '用户的播放/暂停意图（持久化）：运行时落实媒体状态 + 卡片显示，不生成 CSS',
  powPauseBlur: '省电：失焦时暂停播放，运行时行为',
  powPauseBattery: '省电：电池供电时暂停播放，运行时行为',
  lgComposer: '液态玻璃目标选择（输入框）：由 JS 打 [data-mpw-lg-css] 标记，样式在 lgCss 段统一下发',
  lgSidebar: '液态玻璃目标选择（侧栏）：同上（JS 打标记）',
  lgHeader: '液态玻璃目标选择（顶栏）：同上（JS 打标记）',
  chatFollow: '作用于壁纸层**内联样式** --mpw-bg-blur（lib/client.js:4197 的 JS 路径），不进 buildCss（注：buildCss 里那个同名局部 chatFollowInCss 是死代码，未使用）',
  newStyle: '只改**设置页控件外观**（JS 选 className，如液态滑块 radio），不进 buildCss',
  bsBottomAvoid: '已定案的**故意空操作**：该块只输出一段说明注释（"不要再用 margin-left 二次偏移"，对齐交给 better-sidebar 自己的 ResizeObserver）',
  /* ①(NP-4)②「播放/暂停同时控制壁纸」：**只影响运行时的传输落点**（要不要把动作同步到壁纸媒体），
     产物 CSS 一个字都不变。它不是"没接线"——读到它的是 lib/client.js 的 npLinkOn()，
     由 npTransport 的 play/pause/seek 三条分支消费，并写进媒体快照的 canPlay/canSeek/link
     三个派生量（组件根上落成 data-mpw-np-link）。判据在 tools/np-control-test.mjs 的 D 组
     （联动开 ⇒ 播放键驱动壁纸媒体；关 ⇒ 一个字节都不碰；且默认值必须仍是 true = 不改既有行为），
     变更默认值或删掉 npOnNow 门控都会让那一组变红。 */
  npLinkWallpaper: '只影响**运行时的传输落点**（同步不同步到壁纸媒体），不生成 CSS；消费者是 lib/client.js 的 npLinkOn() → npTransport，判据见 tools/np-control-test.mjs D 组',
}

/* ── A2. 非布尔功能探测：patch 里放进去必须让产物变化（运行时门控型的见 RUNTIME_GATED） ── */
const NON_BOOL_PROBES = [
  { name: 'accent', patch: { accent: '#ff0000' }, why: '「配色」：品牌交互色/发送键（2026-09-18 修复前被 aquaOn 吞掉 ⇒ 只开它时规则根本不生成）' },
  { name: 'aquaTextEnhance', patch: { aquaTextEnhance: true }, why: '「深底文字可读增强」：文字描边 + 文字 token（同上，2026-09-18 修复）' },
]

/* ── B. 已证实失效 / 未接线（尚未修）：审计会每次把它们显式列出来 ──
 * 已修并从本表删除：lgCss（TDZ，2026-09-18）、sessionFollow（无人读，2026-09-18 按用户裁定接线）、
 * glassWindow（2026-09-19 **按用户裁定的政策删除**，见下方 RETIRED —— 不是接线，所以不进本表）。
 * 为什么要双向断言：条目一旦被修好，本表必须删掉（否则"已知失效"会变成永久遮羞布）。
 * **本表现在是空的**：45 个布尔开关要么真的改变产物，要么在 NON_CSS 里逐条写了"为什么只影响运行时"。 */
const KNOWN_DEAD = {}

/* ── B2. 已**退役**（删掉）的开关：必须 0 悬空引用、0 孤儿文案 ──
 * 政策（2026-09-19 用户原话）：**不留"看得见却点不动"的死文案**。
 * `glassWindow`（设置窗口液态玻璃）当时的处境：`lib/client.js` 里只有 i18n 2 键 ×2 语言 + 2 处默认值
 * + 导出/导入名单，**既没有 toggleRow（没人看得见）、也没有任何 `section.glassWindow` 读取点（点不动）**；
 * 而它文案承诺的功能（"整个设置卡片/弹窗玻璃化"）**已由 `settingsBlur`（设置面板虚化）+ `dialogBlur` /
 * `popoverBlur` 覆盖** ⇒ 接线只会多出第二个管同一元素的开关（且要把设置面板变成 backdrop root，
 * 正是仓库反复踩过的回归类），而"隐身文案"删掉对用户**零可见影响** ⇒ 选**删除**（A/B 里的 B）。
 * 删了之后必须机器看住两件事（**判据就是这一段**）：
 *   ① 源码里 0 命中 —— 只删 i18n 而漏删 `BACKUP_FIELDS`/`boolFields` 会让它在**导入备份**时落到
 *      "未登记类型"的兜底 `patch[k] = v`（未净化直通）⇒ 悬空字段复活；
 *   ② 两套字典里 0 命中 —— 只删 zh 会破坏 `panel-fixes-test` 的"zh/en 键集合一致"，只删源码会留孤儿文案。
 * 变异自证：把 i18n 那两行加回副本 ⇒ 本段必红（`node tools/switch-wiring-test.mjs --client /tmp/mut.js`）。 */
const RETIRED = [
  {
    id: 'glassWindow',
    i18n: ['glassWindow', 'glassWindow.desc'],
    why: '「设置窗口液态玻璃」：无 toggleRow、无读取点（功能已由 settingsBlur/dialogBlur/popoverBlur 覆盖）⇒ 2026-09-19 删文案 + 删字段（默认值/导出导入名单同步删），不接线',
  },
]

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

/* ── 0. 已退役开关：源码 0 命中 + 两套字典 0 命中（理由见上方 RETIRED） ──
 * 放在最前面：如果这一段落红，后面"A. 45 个布尔开关全部接线"的绿色就**不可信**
 * （悬空字段会以"未净化直通"的方式从导入备份里复活）。 */
const zhDict = (loaded.localeDicts && loaded.localeDicts.zh) || {}
const enDict = (loaded.localeDicts && loaded.localeDicts.en) || {}
const retiredCases = []
for (const r of RETIRED) {
  const re = new RegExp('\\b' + r.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g')
  const hits = (src.match(re) || []).length
  retiredCases.push([`★ 已退役开关 ${r.id}：源码里 0 命中（无悬空字段 / 无净化名单残留 / 无孤儿文案引用）`,
    hits === 0, `命中 ${hits} 处`])
  const left = r.i18n.filter((k) => (k in zhDict) || (k in enDict))
  retiredCases.push([`★ 已退役开关 ${r.id}：i18n 键 ${r.i18n.join(' / ')} 两套字典都没有（无孤儿文案）`,
    left.length === 0, left.length ? '仍在字典里: ' + left.join(', ') : `字典键数 zh=${Object.keys(zhDict).length} / en=${Object.keys(enDict).length}`])
}
if (!ONLY_JSON) {
  console.log('\n== A0. 已退役开关（删掉的死文案/死字段）：0 悬空引用、0 孤儿文案 ==')
  console.log('  （政策：不留"看得见却点不动"的死文案；每条退役理由见源码 RETIRED 表）')
  for (const [name, cond, detail] of retiredCases) ok(name, cond, detail)
  for (const r of RETIRED) console.log(`      ${r.id}：${r.why}`)
}

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

/* ── 顶栏"自身不得带 filter/backdrop-filter"自查 ──
 * 来历（本仓真机历史回归）：`.wSkVaW_header` 本体一旦带 backdrop-filter 就成了 **backdrop root**
 * ⇒ 顶栏内浮层（子代理展开面板/后台任务条）的 backdrop 采样范围被隔离 ⇒ 浮层磨砂失效、背后文字锐利透出。
 * 口径**逐字对齐** tools/css-matrix.mjs:88-96（含 `data-mpw-hdr-blur-element` 例外），只在这里做一次
 * 独立复算，这样"液态玻璃把顶栏变成 backdrop root"会在秒级单项里就红，而不是等组合矩阵。 */
const CSS_RULES = (t) => [...String(t).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
const SUBJECT_IS = (sel, needle) => sel.split(',').some((x) => x.trim().endsWith(needle))
const BODY_PROP = (body, prop) => { const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]*)').exec(body); return m ? m[1].trim() : null }
function headerSelfFilter(css) {
  return CSS_RULES(css).filter(([sel, body]) => {
    if (/data-mpw-hdr-blur-element/.test(sel)) return false
    if (!(SUBJECT_IS(sel, '.wSkVaW_header') || SUBJECT_IS(sel, 'header[class*="_header_"]'))) return false
    return ['filter', 'backdrop-filter', '-webkit-backdrop-filter'].some((pr) => {
      const v = BODY_PROP(body, pr)
      return v && v !== 'none' && !/^none\s*!important$/.test(v)
    })
  }).map(([sel]) => sel)
}
const HEADER_PSEUDO_GLASS = (css) => CSS_RULES(css).some(([sel, body]) => /\.wSkVaW_header::before/.test(sel) && /backdrop-filter/.test(body) && !/backdrop-filter\s*:\s*none/.test(body))

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
lgCase.push(['★ 顶栏**本体**不得带 filter/backdrop-filter（否则顶栏成 backdrop root ⇒ 浮层磨砂失效）', headerSelfFilter(lgOn).length === 0, '违规选择器：' + JSON.stringify(headerSelfFilter(lgOn))])
lgCase.push(['★ 顶栏折射确实落在**伪元素**上（不是被删掉，而是换了层）', HEADER_PSEUDO_GLASS(lgOn), `len=${lgOn.length}`])
const lgNoHeaderFrost = build({ lgCss: true, headerBg: false, headerBlur: false, unifyTint: false })
lgCase.push(['★ 用户关掉顶栏磨砂时，液态玻璃不许再给顶栏加折射（与 css-matrix 断言 7 同口径）', !HEADER_PSEUDO_GLASS(lgNoHeaderFrost), `len=${lgNoHeaderFrost.length}`])

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
    id: 'header-backdrop-root-restored',
    mut: (s) => s.replace(
      '.pI_x6G_sidebarCol,\n[data-composer-card],\n.wSkVaW_scrollBody {',
      '.pI_x6G_sidebarCol,\n.wSkVaW_header,\n[data-composer-card],\n.wSkVaW_scrollBody {'),
    expect: 'A6',
    why: '把 `.wSkVaW_header` 加回"直接吃 backdrop-filter"那条规则（= 液态玻璃修复前的写法，会让顶栏变成 backdrop root）',
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
  {
    id: 'retired-glasswindow-copy-restored',
    mut: (s) => s.replace('\t\t\t"glass.title": "液态玻璃（elysia395 方案）",',
      '\t\t\t"glassWindow": "设置窗口液态玻璃",\n\t\t\t"glass.title": "液态玻璃（elysia395 方案）",'),
    expect: 'A0',
    why: '把已退役开关 glassWindow 的 i18n 文案加回 zh 字典（= 复现"孤儿文案/悬空键"，A0 段必须抓到）',
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
    A0: /✗ ★ 已退役开关/,
    A3: /✗ ★ (lgCss:true|lgCss:false|两档产物|环境支持|\?lgcss=off 时)/,
    A4: /✗ ★ sessionFollow/,
    A5: /✗ ★ (\?lgcss=off 时|不写 \?lgcss=off 时)/,
    A6: /✗ ★ 顶栏/,
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

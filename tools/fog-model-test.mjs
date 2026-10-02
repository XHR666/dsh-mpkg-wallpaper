// tools/fog-model-test.mjs —— 「统一虚化 / 界面虚化」语义收口门禁（2026-10-02 用户第 1–5 项）
//
// 病（三条真机反馈，逐条对应本文件的判据）：
//   ①「整屏虚化程度 = 0 + 左侧边栏/标题栏透明度 = 0」时，左侧边栏**变透明但仍带壁纸采样粉**，
//      标题栏**还在模糊**：厚度与颜色各写各的 —— 表面底色读滑条，而"面板取色"的 token 覆盖
//      把 alpha 写死（sidebar-fill 85%）；标题栏半径又被 `Math.max(12, unAmt || 0)` 抬到 12px。
//   ② 设置页早写着"统一虚化开启中：右侧边栏/dock 由整屏虚化程度 + 透明度接管"，但实现里
//      右栏/dock 走的是自己那套参数（--mpw-rs-blur / --mpw-rs-alpha）⇒ 文案与实现不符。
//   ③「界面虚化」与「统一虚化」的关系没有任何入口说明，也不能选择"不跟随"。
//
// 判据分组：
//   A 组 口径/接线（静态）：默认值、雾模型钳制、四处接线、设置行位置、i18n zh/en 成对
//   B 组 CSS 落点：接管规则/共同表面 token/blur 值 = 0 时必须是 none、不跟随时不产出接管
//   C 组 行为落点（真实现 __mpwHdrFrostTest）：0 ⇒ 0px；跟随 ⇒ unifyAmount；不跟随 ⇒ 自己的条
//   D 组 取色厚度（切片执行真 aquaTokenOverrides）：厚度 0 ⇒ 采样色 alpha 0%（不刷粉色）
//   E 组 变异自证：把关键判断改坏 ⇒ 对应组必红（真源零改动）
//
// 卫生：变异副本落 mkdtemp，退出即删（仓库铁律：不写固定 /tmp 路径）。
// 用法: node tools/fog-model-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')
const SRC = fs.readFileSync(CLIENT, 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-fog-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

/* ── 源码切片（判据与 lib 同源） ─────────────────────────────────────────── */
function sliceFn(name, text) {
  const src = text || SRC
  const i = src.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('缺少函数 ' + name)
  let d = 0, started = false
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true } else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1) }
  }
  throw new Error('函数体不配平 ' + name)
}
const constOf = (name, text) => {
  const m = new RegExp('const ' + name + ' = ([^;\\n]+);').exec(text || SRC)
  if (!m) throw new Error('缺少常量 ' + name)
  return m[1]
}
/* ①(本仓铁律) 多次 loadPlugin 之间必须清掉插件自身的幂等守卫，否则第二次 apply 被
   `__mpwAppliedOnce` 直接忽略 ⇒ __mpwBuildCss 没重装、产物为空、判据**假绿**
   （与 props-panel-wiring / wallpaper-lifecycle 同款清单）。 */
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* 删不掉也不抛 */ } } }
let world = null
const boot = (settings, clientPath) => {
  reset()
  world = loadPlugin({ quiet: true, clientPath: clientPath || CLIENT, settings: settings || {} })
  /* ⚠️ `image: true` 是**布尔脏值**：normalizeSection 会把它当"异常字符串字段"清掉
     （盘上真值是字符串/dataURL）⇒ 只走 readSection() 会落进"无壁纸"分支、拿到 42KB 的
     空壳 CSS，判据全部假绿（第一版就是这个坑）。所以构建时按 bs-compat 测试同法把设置
     作为 patch 传进 __mpwBuildCss（patch 与 readSection 合并后再进 buildCss，不过净化）。 */
  const patch = Object.assign({ enabled: true, image: 'stub-wallpaper.png' }, settings || {})
  return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss(patch) : '') || '')
}
const STRIP = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '')

/** 从任意源码文本编译出真的 mpwFogModel（A 组边界判据与 E 组行为变异共用）。 */
const fogOf = (text) => new Function([
  'const DEFAULT_BLUR_FOLLOW_UNIFY = ' + constOf('DEFAULT_BLUR_FOLLOW_UNIFY', text) + ';',
  'const DEFAULT_UNIFY_TINT = ' + constOf('DEFAULT_UNIFY_TINT', text) + ';',
  'const DEFAULT_UNIFY_AMOUNT = ' + constOf('DEFAULT_UNIFY_AMOUNT', text) + ';',
  'const DEFAULT_SIDEBAR_ALPHA = ' + constOf('DEFAULT_SIDEBAR_ALPHA', text) + ';',
  'const DEFAULT_OPACITY = ' + constOf('DEFAULT_OPACITY', text) + ';',
  sliceFn('mpwFogModel', text),
  'return mpwFogModel;',
].join('\n'))()
const RULES = (css) => [...STRIP(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
const HAS_RULE = (css, selRe, bodyRe) => RULES(css).some(([sel, body]) => selRe.test(sel) && (!bodyRe || bodyRe.test(body)))
const TOKEN = (css, name) => {
  const m = new RegExp('--' + name + '\\s*:\\s*([^;}]+)').exec(STRIP(css))
  return m ? m[1].trim() : ''
}
/** 把工作树副本按 patch 改一处 → 落 mkdtemp，返回可 loadPlugin 的路径（真源零改动）。 */
const mutant = (tag, from, to) => {
  if (SRC.indexOf(from) < 0) throw new Error('变异锚点不存在：' + tag)
  const f = path.join(tmpRoot, 'client-' + tag + '.js')
  fs.writeFileSync(f, SRC.split(from).join(to))
  return f
}

/* ══════════════════════════════════════════════════════════════════
   A 组：口径与接线（静态）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== A 组：口径与接线（静态）==')
ok('A1 雾模型是唯一源：`mpwFogModel` 存在，且「跟随」默认值 = true（DEFAULT_BLUR_FOLLOW_UNIFY）',
  /function mpwFogModel\(section\)/.test(SRC) && constOf('DEFAULT_BLUR_FOLLOW_UNIFY') === 'true',
  'DEFAULT_BLUR_FOLLOW_UNIFY = ' + constOf('DEFAULT_BLUR_FOLLOW_UNIFY'))
{
  // 真执行 mpwFogModel：钳制边界（0/40/100/50）
  const fog = fogOf(SRC)
  const f0 = fog({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 0, opacity: 10 })
  ok('A2 雾模型钳制：amount 0–40、side 0–100、chat ≥50（面板不透明度的历史下限）',
    f0.amountPx === 0 && f0.sidePct === 0 && f0.chatPct === 50 && f0.unifyOn === true, JSON.stringify(f0))
  const f1 = fog({ unifyTint: true, unifyAmount: 99, sidebarAlpha: 999, opacity: 999 })
  ok('A2b 上界钳制：40 / 100 / 100', f1.amountPx === 40 && f1.sidePct === 100 && f1.chatPct === 100, JSON.stringify(f1))
  const fShell = fog({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 35 })
  ok('A2e amount 0 ⇒ shellPct = 100（实心），但 sidePct 仍 = 35（取色 alpha 用原始值，不跟着钳）',
    fShell.shellPct === 100 && fShell.sidePct === 35, JSON.stringify(fShell))
  const fShell2 = fog({ unifyTint: true, unifyAmount: 12, sidebarAlpha: 35 })
  ok('A2f amount > 0 ⇒ shellPct = sidePct（真的在虚化时厚度条说了算）',
    fShell2.shellPct === 35, JSON.stringify(fShell2))
  const f2 = fog({ unifyTint: true, blurFollowUnify: false })
  ok('A2c 「不跟随」⇒ unifyOn=false（其余字段仍按各自默认给值）', f2.followUnify === false && f2.unifyOn === false, JSON.stringify(f2))
  const f3 = fog({ unifyTint: false })
  ok('A2d 统一虚化关 ⇒ unifyOn=false（跟随开关无意义）', f3.unifyOn === false && f3.followUnify === true, JSON.stringify(f3))
}
ok('A3 四处接线齐全：默认值对象 / BACKUP_FIELDS / 导入布尔净化 / 设置行 toggleRow',
  /blurFollowUnify: DEFAULT_BLUR_FOLLOW_UNIFY/.test(SRC)
  && /"blurFollowUnify"/.test(SRC)
  && (SRC.match(/"blurFollowUnify"/g) || []).length >= 3
  && /toggleRow\(t\("blurFollowUnify"\), t\("blurFollowUnify\.desc"\), "blurFollowUnify", DEFAULT_BLUR_FOLLOW_UNIFY/.test(SRC),
  '"blurFollowUnify" 出现 ' + (SRC.match(/"blurFollowUnify"/g) || []).length + ' 次')
{
  /* 位置判据（用户第3项）：说明行 + 开关必须在 **tab 栏之后、界面虚化标题之前**。 */
  const iTab = SRC.indexOf('"data-mpw-tabkey": "blur"')
  const iHint = SRC.indexOf('t("blur.follow.hint")')
  const iSw = SRC.indexOf('toggleRow(t("blurFollowUnify")')
  const iTitle = SRC.indexOf('h("div", { className: "mpw_section" }, t("sec.blur"))')
  ok('A4 说明行 + 跟随开关位于「tab 栏 → 界面虚化标题」之间（顺序：tabkey < hint < 开关 < 标题）',
    iTab > 0 && iHint > iTab && iSw > iHint && iTitle > iSw,
    JSON.stringify({ iTab, iHint, iSw, iTitle }))
}
{
  /* 用户第4项：右侧边栏/dock 虚化必须在「界面虚化」页里（外观页不再有那两行）。 */
  const iBlurTab = SRC.indexOf('"data-mpw-tabkey": "blur"')
  const iOtherTab = SRC.indexOf('"data-mpw-tabkey": "other"')
  const iRsRow = SRC.indexOf('toggleRow(t("rightSidebarBlur")')
  ok('A5 「右侧边栏/dock 虚化」整组在 blur tab 内（blur tab 起点 < 该行 < other tab 起点）',
    iBlurTab > 0 && iRsRow > iBlurTab && iOtherTab > iRsRow, JSON.stringify({ iBlurTab, iRsRow, iOtherTab }))
  const box = SRC.slice(iBlurTab, iOtherTab)
  ok('A5b 该组含小组标题 + 两枚滑条（虚化程度 / 表面透明度）+ 接管提示',
    /t\("sec\.blurRight"\)/.test(box) && /"rightSidebarBlurAmount"/.test(box) && /"rightSidebarAlpha"/.test(box)
    && /t\("rightSidebarBlur\.overridden"\)/.test(box))
  ok('A5c 外观页里不再重复渲染这两条滑条（只留迁移说明注释）',
    !/sliderRow\(t\("rightSidebarBlurAmount"\), "rightSidebarBlurAmount"/.test(SRC.slice(0, iBlurTab)),
    '')
}
{
  /* i18n：新键在 zh/en 两套字典里成对（缺一边 = 英文界面漏中文，历史 bug） */
  const lines = SRC.split('\n')
  const iZh = lines.findIndex((l) => l === '\t\tconst zh = {')
  const iEn = lines.findIndex((l) => l === '\t\tconst en = {')
  const endOf = (s) => { for (let i = s + 1; i < lines.length; i++) if (lines[i] === '\t\t};') return i; throw new Error('字典不配平') }
  const zk = new Set([...lines.slice(iZh, endOf(iZh)).join('\n').matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]))
  const ek = new Set([...lines.slice(iEn, endOf(iEn)).join('\n').matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]))
  const need = ['blurFollowUnify', 'blurFollowUnify.desc', 'blur.follow.hint', 'sec.blurRight', 'sec.blurRight.desc',
    'unifyAmount.desc', 'sidebarAlpha.desc', 'rightSidebarBlurAmount.desc', 'rightSidebarAlpha.desc']
  const missZh = need.filter((k) => !zk.has(k)), missEn = need.filter((k) => !ek.has(k))
  ok('A6 新增/补写的文案 zh/en 成对齐全（含 4 条原本缺 desc 的滑条说明）',
    !missZh.length && !missEn.length, JSON.stringify({ missZh, missEn }))
  ok('A6b zh/en 键集合仍然一一对应（不许多、不许少）',
    [...zk].every((k) => ek.has(k)) && [...ek].every((k) => zk.has(k)),
    'zh=' + zk.size + ' en=' + ek.size)
}

/* ══════════════════════════════════════════════════════════════════
   B 组：CSS 落点（真 buildCss）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== B 组：CSS 落点（接管 / 共同表面 / 0 就是 0）==')
const RS_SEL = /\[data-sidebar-right-panel\]|\[data-dockkit-(pane|strip|surface|float)\]/
{
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 0, chatFollow: false })
  ok('B1 接管规则存在：右栏 / dock 指向共同表面 token（--mpw-unify-surface）',
    HAS_RULE(css, /\[data-mpw-unify\]/, /--mpw-unify-surface/) || /\[data-mpw-unify\] \[data-sidebar-right-panel\]/.test(STRIP(css)))
  ok('B1b 不虚化（amount 0）⇒ 共同表面 **实心**（alpha 1.000）：没有模糊时不许把原始壁纸透出来',
    TOKEN(css, 'mpw-unify-surface') === 'rgba(255, 255, 255, 1.000)', TOKEN(css, 'mpw-unify-surface'))
  ok('B1c 半径 0 ⇒ 接管规则的 backdrop-filter 是 **none**（不是 blur(0px)：后者仍建 containing block）',
    HAS_RULE(css, /\[data-mpw-unify\] \[data-sidebar-right-panel\]/, /backdrop-filter:\s*none/) && TOKEN(css, 'mpw-unify-blur') === '0px',
    JSON.stringify({ blur: TOKEN(css, 'mpw-unify-blur') }))
  ok('B1d 暗色同款：--mpw-unify-surface-dark alpha = 1.000', TOKEN(css, 'mpw-unify-surface-dark') === 'rgba(18, 22, 30, 1.000)', TOKEN(css, 'mpw-unify-surface-dark'))
  ok('B1e 接管不碰弹层/设置面板：抑制规则（overlay/modal 打开时 backdrop-filter: none）在产物里',
    HAS_RULE(css, /\[data-mpw-unify\]:has\(\[class\*="_overlay"\]\) \[data-dockkit-pane\]/, /backdrop-filter:\s*none/))
}
{
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 0, chatFollow: false })
  ok('B1f 不虚化 ⇒ 左侧栏/标题栏也实心：--mpw-chrome-alpha = 1（与右栏/dock 同一条纪律）',
    Number(TOKEN(css, 'mpw-chrome-alpha')) === 1 && /var\(--mpw-chrome-alpha\)/.test(TOKEN(css, 'mpw-surface-side-frost')),
    JSON.stringify([TOKEN(css, 'mpw-chrome-alpha'), TOKEN(css, 'mpw-surface-side-frost')]))
  ok('B1g 不虚化 ⇒ body[data-mpw-unify] 接管仍在（开关门控照旧）、但半径变量是 0px',
    TOKEN(css, 'mpw-unify-blur') === '0px', TOKEN(css, 'mpw-unify-blur'))
}
{
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, chatFollow: false })
  ok('B2 厚度/半径都跟着两个条走：alpha=0.600、blur=24px、规则里就是 blur(24px)',
    TOKEN(css, 'mpw-unify-surface') === 'rgba(255, 255, 255, 0.600)' && TOKEN(css, 'mpw-unify-blur') === '24px'
    && HAS_RULE(css, /\[data-mpw-unify\] \[data-sidebar-right-panel\]/, /backdrop-filter:\s*blur\(24px\)/),
    JSON.stringify([TOKEN(css, 'mpw-unify-surface'), TOKEN(css, 'mpw-unify-blur')]))
}
{
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, blurFollowUnify: false, sidebarBlur: true, sidebarBlurAmount: 9, rightSidebarBlur: true, chatFollow: false })
  ok('B3 「不跟随」⇒ 不产出接管规则（无 --mpw-unify-surface / 无 [data-mpw-unify] 规则）',
    TOKEN(css, 'mpw-unify-surface') === '' && !/\[data-mpw-unify\]/.test(STRIP(css)))
  ok('B3b 「不跟随」⇒ 左侧边栏自己的磨砂恢复输出（body[data-mpw-sblur] 规则），半径用它自己的 9px',
    HAS_RULE(css, /body\[data-mpw-sblur\][^,]*\.pI_x6G_sidebarCol/, /backdrop-filter:\s*blur\(9px\)/))
  ok('B3c 「不跟随」⇒ chrome 半径回落到历史公式（sidebarBlur 开 ⇒ sidebarBlurAmount=9px）',
    TOKEN(css, 'mpw-chrome-blur') === '9px', TOKEN(css, 'mpw-chrome-blur'))
}
{
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, sidebarBlur: true, sidebarBlurAmount: 9, chatFollow: false })
  ok('B4 「跟随」⇒ chrome 半径归统一虚化（30px，不被 sidebarBlur 的 9px 分走）',
    TOKEN(css, 'mpw-chrome-blur') === '30px', TOKEN(css, 'mpw-chrome-blur'))
  ok('B4b 「跟随」⇒ 左侧边栏不再输出自己那条 backdrop-filter（避免双重模糊）',
    !HAS_RULE(css, /body\[data-mpw-sblur\][^,]*\.pI_x6G_sidebarCol/, /backdrop-filter/))
}
{
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, bsCompat: true, chatFollow: false })
  ok('B5 better-sidebar 面板/底部工作台：跟雾色与厚度，但**不给** backdrop-filter（防困住内部 fixed 内容）',
    HAS_RULE(css, /\[data-mpw-unify\] \[data-dsh-better-sidebar\] \[class\*="_bottomPanel"\]/, /background-color:\s*var\(--mpw-unify-surface\)/)
    && !HAS_RULE(css, /\[data-mpw-unify\] \[data-dsh-better-sidebar\]/, /backdrop-filter/))
  const cssOff = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, bsCompat: false, chatFollow: false })
  ok('B5b bsCompat 手动关 ⇒ 产物里 0 条 [data-dsh-better-sidebar] 规则（尊重用户手动关）',
    !/\[data-dsh-better-sidebar\]/.test(STRIP(cssOff)))
}
{
  const css = boot({ enabled: true, image: false, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40 })
  ok('B6 无壁纸 ⇒ 不产出接管规则（该路径本来就没有玻璃块）',
    TOKEN(css, 'mpw-unify-surface') === '' && !/\[data-mpw-unify\]/.test(STRIP(css)))
}
{
  const css = boot({ enabled: true, image: true, unifyTint: false, unifyAmount: 30, sidebarAlpha: 40, rightSidebarBlur: true, rightSidebarBlurAmount: 14, rightSidebarAlpha: 45 })
  ok('B7 统一虚化关 ⇒ 右栏/dock 回到自己那套参数（--mpw-rs-blur/--mpw-rs-alpha 被写值）',
    TOKEN(css, 'mpw-rs-blur') === '14px' && TOKEN(css, 'mpw-rs-alpha') === '0.45',
    JSON.stringify([TOKEN(css, 'mpw-rs-blur'), TOKEN(css, 'mpw-rs-alpha')]))
}

/* ══════════════════════════════════════════════════════════════════
   C 组：行为落点（__mpwHdrFrostTest：真 syncHeaderFrost）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== C 组：标题栏磨砂半径（0 就是 0 / 跟随 / 独立）==')
const hdrPx = (settings) => {
  boot(settings)
  const T = globalThis.__mpwHdrFrostTest
  if (!T) return { err: 'no-hook' }
  T.sync()
  const st = T.state() || {}
  const m = /(\d+)px/.exec(String(st.reason || ''))
  return { reason: String(st.reason || ''), px: m ? Number(m[1]) : null, injected: !!st.injected }
}
{
  const r = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 0 })
  ok('C1 整屏虚化程度 = 0 ⇒ 标题栏半径 **0px**（旧行为是 12px 下限：拉到 0 还在模糊）',
    r.px === 0 && /跟随整屏虚化 0px/.test(r.reason), JSON.stringify(r))
  const r2 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30 })
  ok('C2 跟随档：半径 = unifyAmount（30px）', r2.px === 30, JSON.stringify(r2))
  const r3 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, headerFrostOwn: true, headerFrostAmount: 8 })
  ok('C3 独立强度开了 ⇒ 用 headerFrostAmount（8px），与统一虚化解耦', r3.px === 8, JSON.stringify(r3))
  const r4 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, headerFrostOwn: true, headerFrostAmount: 0 })
  ok('C3b 独立强度 = 0 ⇒ 也是 0px（"0 = 不磨砂"，不再被 8px 下限抬起来）', r4.px === 0, JSON.stringify(r4))
  const r5 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, blurFollowUnify: false, headerBlur: true, headerBlurAmount: 100 })
  ok('C4 不跟随 ⇒ 标题栏自己的磨砂条说了算（100% → 25px），统一虚化不再接管',
    r5.px === 25, JSON.stringify(r5))
  const r6 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 18, blurFollowUnify: false, headerBlur: true, headerBlurAmount: 0 })
  ok('C4b 不跟随 + 自己的条为 0（默认自动档）⇒ 回落统一虚化 18px（不出现"两边都不管"的空档）',
    r6.px === 18, JSON.stringify(r6))
}

/* ══════════════════════════════════════════════════════════════════
   D 组：取色厚度（切片执行真 aquaTokenOverrides）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== D 组：面板取色的可见程度 = 雾厚度（厚度 0 不刷采样色）==')
function runAqua(section, text) {
  const code = [
    'const document = { body: { hasAttribute: () => false } };',
    'const getComputedStyle = () => ({ getPropertyValue: (n) => (n === "--mpw-aqua-rgb" ? "255 128 160" : "") });',
    'const DEFAULT_BLUR_FOLLOW_UNIFY = ' + constOf('DEFAULT_BLUR_FOLLOW_UNIFY', text) + ';',
    'const DEFAULT_UNIFY_TINT = ' + constOf('DEFAULT_UNIFY_TINT', text) + ';',
    'const DEFAULT_UNIFY_AMOUNT = ' + constOf('DEFAULT_UNIFY_AMOUNT', text) + ';',
    'const DEFAULT_SIDEBAR_ALPHA = ' + constOf('DEFAULT_SIDEBAR_ALPHA', text) + ';',
    'const DEFAULT_OPACITY = ' + constOf('DEFAULT_OPACITY', text) + ';',
    'const DEFAULT_AQUA_TINT = ' + constOf('DEFAULT_AQUA_TINT', text) + ';',
    'const DEFAULT_AQUA_MASK = ' + constOf('DEFAULT_AQUA_MASK', text) + ';',
    'const DEFAULT_AQUA_INK = ' + constOf('DEFAULT_AQUA_INK', text) + ';',
    'const DEFAULT_AQUA_TEXT_ENHANCE = ' + constOf('DEFAULT_AQUA_TEXT_ENHANCE', text) + ';',
    sliceFn('aquaParseHex', text), sliceFn('aquaInkForRgb', text), sliceFn('aquaBrandColor', text),
    sliceFn('mpwFogModel', text), sliceFn('aquaTokenOverrides', text),
    'return aquaTokenOverrides;',
  ].join('\n')
  return new Function(code)()(section)
}
{
  const o = runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 0 })
  const fill = o && o['--dsw-specific-sidebar-fill'] && o['--dsw-specific-sidebar-fill'].light
  const base = o && o['--dsw-alias-bg-base'] && o['--dsw-alias-bg-base'].light
  ok('D1 厚度 0 ⇒ 侧边栏填充的采样色 alpha = 0%（真机"透明侧边栏 + 壁纸采样粉"的直接来源）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+0%/.test(String(fill)), String(fill))
  ok('D1b 主画布同款：按聊天区厚度给 alpha（统一虚化开 ⇒ 面板不透明度，默认 82%）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+82%/.test(String(base)), String(base))
  const o2 = runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60 })
  const fill2 = o2 && o2['--dsw-specific-sidebar-fill'] && o2['--dsw-specific-sidebar-fill'].light
  ok('D2 厚度 60 ⇒ 采样色 alpha = 60%（色相仍来自壁纸，只是可见程度归滑条）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+60%/.test(String(fill2)), String(fill2))
  const o3 = runAqua({ aquaTint: true, unifyTint: false })
  const fill3 = o3 && o3['--dsw-specific-sidebar-fill'] && o3['--dsw-specific-sidebar-fill'].light
  ok('D3 统一虚化关 ⇒ 保留历史档 85%（观感与刷新前一致，不借机改行为）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+85%/.test(String(fill3)), String(fill3))
}
{
  ok('D4 标题栏采样色的可见程度也归厚度：CSS 读 var(--mpw-aqua-header-alpha, 62%)，JS 按雾模型写值',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+var\(--mpw-aqua-header-alpha, 62%\)/.test(SRC)
    && /setProperty\("--mpw-aqua-header-alpha", pct \+ "%"\)/.test(SRC)
    && /const pct = fog\.unifyOn \? fog\.sidePct : 62;/.test(SRC)
    && /removeProperty\("--mpw-aqua-header-alpha"\)/.test(SRC))
}

/* ══════════════════════════════════════════════════════════════════
   E 组：变异自证（真源零改动；改坏关键判断 ⇒ 对应判据必红）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== E 组：变异自证 ==')
{
  /* E1 半径下限改回旧写法（0 被抬到 12px）⇒ C1 必红 */
  const m1 = mutant('hdr-floor', 'const pxFloor = (v, lo) => (Number(v) > 0 ? Math.max(lo, Number(v)) : 0);',
    'const pxFloor = (v, lo) => Math.max(lo, Number(v) || 0);')
  const r = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 0 })
  const rM = (() => { boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 0 }, m1); const T = globalThis.__mpwHdrFrostTest; T.sync(); const st = T.state() || {}; const mm = /(\d+)px/.exec(String(st.reason || '')); return { reason: st.reason, px: mm ? Number(mm[1]) : null } })()
  ok('E1 半径下限改回 `Math.max(lo, v||0)` ⇒ 0 被抬成 12px（C1 必红）',
    rM.px === 12 && r.px === 0, JSON.stringify({ mutant: rM.px, real: r.px }))
}
{
  /* E2 取色 alpha 写死回 85% ⇒ D1 必红（**行为**变异：变异体走同一条 runAqua 判据） */
  const m2 = mutant('aqua-fixed', 'const sideAlpha = fog.unifyOn ? fog.sidePct / 100 : 0.85;', 'const sideAlpha = 0.85;')
  const txtM = fs.readFileSync(m2, 'utf8')
  const mutFill = ((runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 0 }, txtM) || {})['--dsw-specific-sidebar-fill'] || {}).light
  const realFill = ((runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 0 }) || {})['--dsw-specific-sidebar-fill'] || {}).light
  ok('E2 取色 alpha 写死回 85% ⇒ 厚度 0 时仍刷 85% 采样色（D1 必红）',
    /85%/.test(String(mutFill)) && /0%/.test(String(realFill)),
    JSON.stringify({ mutant: mutFill, real: realFill }))
}
{
  /* E3 跟随开关判断被去掉（恒跟随）⇒ B3 必红 */
  const m3 = mutant('follow-ignored', 'const unifyFollowNow = unifyTint && blurFollowUnify;', 'const unifyFollowNow = unifyTint;')
  const cssM = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, blurFollowUnify: false, chatFollow: false }, m3)
  const cssR = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, blurFollowUnify: false, chatFollow: false })
  ok('E3 「跟随」开关被忽略 ⇒ 不跟随时也会产出接管规则（B3 必红）',
    TOKEN(cssM, 'mpw-unify-surface') !== '' && TOKEN(cssR, 'mpw-unify-surface') === '',
    JSON.stringify({ mutant: TOKEN(cssM, 'mpw-unify-surface'), real: TOKEN(cssR, 'mpw-unify-surface') }))
}
{
  /* E4 better-sidebar 段不再受 bsCompat 门控 ⇒ B5b 必红 */
  const m4 = mutant('bs-ungated', 'const bsTakeoverSurface = !unifyTakeover || !bsCompatTakeover ? "" : `', 'const bsTakeoverSurface = !unifyTakeover ? "" : `')
  const cssM = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, bsCompat: false, chatFollow: false }, m4)
  const cssR = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, bsCompat: false, chatFollow: false })
  ok('E4 better-sidebar 段不再受 bsCompat 门控 ⇒ 手动关也照样产出规则（B5b 必红）',
    /\[data-dsh-better-sidebar\]/.test(STRIP(cssM)) && !/\[data-dsh-better-sidebar\]/.test(STRIP(cssR)))
}
{
  /* E4b 不虚化时的"实心"钳制被去掉（回到"厚度 0 ⇒ 透明"）⇒ B1b/B1f 必红 */
  const m5 = mutant('solid-floor', 'shellPct: amountPx > 0 ? sidePct : 100,', 'shellPct: sidePct,')
  const fogM = fogOf(fs.readFileSync(m5, 'utf8'))
  const m = fogM({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 0 })
  const r = fogOf(SRC)({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 0 })
  ok('E4b 去掉"不虚化 ⇒ 实心"钳制 ⇒ 厚度 0 又变全透明（B1b/B1f 必红）',
    m.shellPct === 0 && r.shellPct === 100, JSON.stringify({ mutant: m.shellPct, real: r.shellPct }))
}
{
  /* E5 真源零改动 */
  const now = fs.readFileSync(CLIENT, 'utf8')
  ok('E5 变性自证只动 mkdtemp 副本：真源 sha256 跑前跑后逐字节相同',
    now === SRC)
}

console.log(`\n===== fog-model: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ 雾模型口径成立：厚度 0 = 一个像素不刷、半径 0 = 真 0、跟随开关真能解耦、右栏/dock 与左栏同一套表面')
process.exitCode = fail ? 1 : 0

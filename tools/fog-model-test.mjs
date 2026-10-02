// tools/fog-model-test.mjs —— 「统一虚化 / 界面虚化」语义收口门禁（2026-10-02 用户第 1–5 项 + 语义重做）
//
// 病（四条真机反馈，逐条对应本文件的判据）：
//   ①「整屏虚化程度 = 0 + 左侧边栏/标题栏透明度 = 0」时，左侧边栏**变透明但仍带壁纸采样粉**，
//      标题栏**还在模糊**：厚度与颜色各写各的 —— 表面底色读滑条，而"面板取色"的 token 覆盖
//      把 alpha 写死（sidebar-fill 85%）；标题栏半径又被 `Math.max(12, unAmt || 0)` 抬到 12px。
//   ② 设置页早写着"统一虚化开启中：右侧边栏/dock 由整屏虚化程度 + 透明度接管"，但实现里
//      右栏/dock 走的是自己那套参数（--mpw-rs-blur / --mpw-rs-alpha）⇒ 文案与实现不符。
//   ③「界面虚化」与「统一虚化」的关系没有任何入口说明，也不能选择"不跟随"。
//   ④(2026-10-02 真机，提交 f470590) 透明度 = 0 时**界面仍然盖着宿主**：左栏被我们的 `!important`
//      钉回旧 token（宿主打开设置面板时换上的深色导航被盖掉 → "设置一开左栏就变黑"）、聊天区
//      顶栏被写死 `rgba(255,255,255,0.38)` 白底 + 无条件注入磨砂层 ⇒ 宿主的原生外观全被覆盖。
//
// 语义（2026-10-02 用户拍板；代码里 `mpwSurfacePlan()` 是**唯一源**，`mpwFogModel()` 只是薄包装）：
//   · 「界面透明度」`sidebarAlpha`：**0 = 完全不透明（正常界面）**、**100 = 完全透明（看到壁纸）**；
//     生效不透明度 = `100 - 透明度`。**与模糊解耦**：模糊 0 时照样按透明度透出（壁纸是清晰的）。
//   · 基色 = **宿主自己的 token**：左栏/右栏/dock = `var(--dsw-specific-sidebar-fill)`、
//     标题栏 = `var(--dsw-alias-bg-base)` ⇒ 产物里是 `color-mix(in srgb, var(--dsw-…) N%, transparent)`，
//     **不再是**我们的纯白/中性色（`rgba(255,255,255,…)` / `rgba(18,22,30,…)`）。
//   · 「整屏虚化程度」= 半径（0 ⇒ 接管规则里写 `backdrop-filter: none`，不是 `blur(0px)`）。
//   · 归属：统一虚化开 + `blurFollowUnify` 开 + 该项**没被用户单独动过**（`*UserSet` 标记）
//     ⇒ 用统一值（四个表面完全一致）；`sidebarBlurUserSet` / `headerFrostUserSet` /
//     `rightSidebarBlurUserSet` 任一为真 ⇒ **该项**独立（自己的开关/半径/透明度），不牵连别项。
//     `commit()` 里的 `mpwMarkUserSet()` 是标记的**唯一落点**（动过某条滑条/开关 ⇒ 打标记；
//     `patch.blurFollowUnify === true` ⇒ 清空三个标记）。
//   · **「界面透明度」= 0（生效不透明度 ≥ 100）⇒ 该表面完全不覆盖宿主**（`chromeInert`，f470590）：
//     不产出玻璃统一块 / G 块（`unifyAmount > 0 && bdSupported && !chromeInert`）/ 右栏·dock 的 F 块
//     （`rsBlur && !rightInert`）/ 「透出壁纸」半透明分支与不透明兜底分支 / `--mpw-surface-side-unify-light`
//     覆盖（`unifyChrome`）/ 接管块（`unifyTakeover && !rightInert`）；标题栏（`.wSkVaW_header`）
//     不注入 `.mpw-hdrFrost` 且撤 `data-mpw-hdr-translucent`；JS 侧 `body[data-mpw-unify]` 也不打。
//     **不是**"写一个 100% 的宿主色"：写成 100% 同样会把宿主自己换上的颜色（如设置面板打开时的
//     深色导航）钉回去 —— 所以判据是"**0 处** chrome 覆盖规则"，不是 `color-mix(…, 100.0%)`。
//
// 判据分组：
//   A 组 口径/接线（静态）：唯一源、默认值、雾模型钳制/解耦、四处接线、设置行位置、i18n zh/en 成对
//   B 组 CSS 落点：透明度 0 ⇒ 0 处 chrome 覆盖规则；非 0 档 ⇒ 接管规则/共同表面 = 宿主 token +
//      生效不透明度、半径 0 = none、不跟随时不产出接管
//   C 组 行为落点（真实现 __mpwHdrFrostTest）：0 ⇒ 0px；跟随 ⇒ unifyAmount；独立 ⇒ 自己那条
//   D 组 取色厚度（切片执行真 aquaTokenOverrides）：取色 alpha = 表面**不透明度**（透明度 100 ⇒ 0%）
//   E 组 变异自证：把关键判断改坏 ⇒ 对应组必红（真源零改动）
//   F 组 独立性/归属：不跟随不接管；跟随档四表面逐字一致；*UserSet 只让**那一项**独立；
//       `mpwMarkUserSet()` 是标记唯一落点（含"未被接管的字段不许打标记"）
//   F7 组 透明度 = 0 ⇒ 完全不覆盖宿主（f470590）：chrome token/选择器/左栏表层 0 处、左栏规则 ≤ 2 条、
//       45 ⇒ 规则恢复、标题栏行为（交还宿主 vs 正常注入）、以及 `chromeInert` 判据的变异自证
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
/** 切片一条 **多行** 声明（对象/数组字面量；`constOf` 只吃单行）。
    括号配平 + 跳过字符串里的括号与分号（`MPW_USERSET_OF` 的值就是一堆带引号的键名）。 */
function sliceDecl(name, text) {
  const src = text || SRC
  const head = 'const ' + name + ' = '
  const i = src.indexOf(head)
  if (i < 0) throw new Error('缺少声明 ' + name)
  const start = i + head.length
  let d = 0, q = ''
  for (let j = start; j < src.length; j++) {
    const c = src[j]
    if (q) { if (c === '\\') { j++; continue } if (c === q) q = ''; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '{' || c === '[' || c === '(') d++
    else if (c === '}' || c === ']' || c === ')') d--
    else if (c === ';' && d === 0) return src.slice(start, j)
  }
  throw new Error('声明不配平 ' + name)
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
/** 从任意源码文本编译出真的 mpwSurfacePlan / mpwFogModel（边界判据与 E 组行为变异共用）。
    ⚠️ `mpwFogModel` 现在是 `mpwSurfacePlan()` 的薄包装 ⇒ **必须把 surfacePlan（连同它依赖的
    全部默认值常量）一起带上**，否则 new Function 里直接 ReferenceError（第一版的坑）。 */
const PLAN_CONSTS = ['DEFAULT_BLUR_FOLLOW_UNIFY', 'DEFAULT_UNIFY_TINT', 'DEFAULT_UNIFY_AMOUNT', 'DEFAULT_SIDEBAR_ALPHA',
  'DEFAULT_OPACITY', 'DEFAULT_CHAT_FOLLOW',
  'DEFAULT_SIDEBAR_BLUR', 'DEFAULT_SIDEBAR_BLUR_AMOUNT',
  'DEFAULT_HEADER', 'DEFAULT_HEADER_BLUR_AMOUNT', 'DEFAULT_HEADER_FROST_OWN', 'DEFAULT_HEADER_FROST_AMOUNT',
  'DEFAULT_RIGHT_SIDEBAR_BLUR', 'DEFAULT_RIGHT_SIDEBAR_AMOUNT', 'DEFAULT_RIGHT_SIDEBAR_ALPHA']
const constDecls = (text, names) => names.map((n) => 'const ' + n + ' = ' + constOf(n, text) + ';').join('\n')
const planOf = (text) => new Function([
  constDecls(text, PLAN_CONSTS),
  sliceFn('mpwSurfacePlan', text),
  'return mpwSurfacePlan;',
].join('\n'))()
const fogOf = (text) => new Function([
  constDecls(text, PLAN_CONSTS),
  sliceFn('mpwSurfacePlan', text),
  sliceFn('mpwFogModel', text),
  'return mpwFogModel;',
].join('\n'))()
/** 切片执行真的 `mpwMarkUserSet`（F 组：标记的唯一落点）。 */
const markOf = (text) => new Function([
  'const MPW_USERSET_OF = ' + sliceDecl('MPW_USERSET_OF', text) + ';',
  'const MPW_USERSET_KEYS = ' + sliceDecl('MPW_USERSET_KEYS', text) + ';',
  sliceFn('mpwMarkUserSet', text),
  'return mpwMarkUserSet;',
].join('\n'))()
const RULES = (css) => [...STRIP(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
const HAS_RULE = (css, selRe, bodyRe) => RULES(css).some(([sel, body]) => selRe.test(sel) && (!bodyRe || bodyRe.test(body)))
const TOKEN = (css, name) => {
  const m = new RegExp('--' + name + '\\s*:\\s*([^;}]+)').exec(STRIP(css))
  return m ? m[1].trim() : ''
}
/* 表面基色（宿主 token）与 `mpwSurfaceColor()` 同款输出形态：`透明度 0` ⇒ `100.0%`（实心）。 */
const SIDE_BASE = 'var(--dsw-specific-sidebar-fill)'
const TOP_BASE = 'var(--dsw-alias-bg-base)'
const SURF = (base, opacityPct) => 'color-mix(in srgb, ' + base + ' ' + Number(opacityPct).toFixed(1) + '%, transparent)'
/** 把工作树副本按 patch 改一处 → 落 mkdtemp，返回可 loadPlugin 的路径（真源零改动）。
    ⚠️ 锚点必须**唯一**：`split/join` 会把所有出现处一起改掉，若锚点不唯一就成了"多处变异"，
    判据虽然还会红，但**红的原因不再是它想自证的那一条**（自证失效）。所以这里直接抛错。
    ①(2026-10-02 f470590 后复查) E1/E2/E3/E4/E4b/F6 与 F7e 的锚点在真源里**各出现 1 次**
    （`chromeInert` 的出现没有让任何既有锚点变重复）⇒ 无需换锚点。 */
const mutant = (tag, from, to) => {
  const n = SRC.split(from).length - 1
  if (n < 1) throw new Error('变异锚点不存在：' + tag)
  if (n > 1) throw new Error('变异锚点不唯一（' + n + ' 处，需换到唯一锚点）：' + tag)
  const f = path.join(tmpRoot, 'client-' + tag + '.js')
  fs.writeFileSync(f, SRC.split(from).join(to))
  return f
}

/* ══════════════════════════════════════════════════════════════════
   A 组：口径与接线（静态）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== A 组：口径与接线（静态）==')
ok('A1 `mpwSurfacePlan` 是唯一源、`mpwFogModel` 只是薄包装；「跟随」默认值 = true（DEFAULT_BLUR_FOLLOW_UNIFY）',
  /function mpwSurfacePlan\(section\)/.test(SRC) && /function mpwFogModel\(section\)/.test(SRC)
  && /const P = mpwSurfacePlan\(s\)/.test(SRC) && constOf('DEFAULT_BLUR_FOLLOW_UNIFY') === 'true',
  'DEFAULT_BLUR_FOLLOW_UNIFY = ' + constOf('DEFAULT_BLUR_FOLLOW_UNIFY'))
{
  // 真执行 mpwFogModel：钳制边界（0/40/100/50）
  const fog = fogOf(SRC)
  const f0 = fog({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 0, opacity: 10 })
  ok('A2 雾模型钳制：amount 0–40、side 0–100、chat ≥50（面板不透明度的历史下限）',
    f0.amountPx === 0 && f0.sidePct === 0 && f0.chatPct === 50 && f0.unifyOn === true, JSON.stringify(f0))
  const f1 = fog({ unifyTint: true, unifyAmount: 99, sidebarAlpha: 999, opacity: 999 })
  ok('A2b 上界钳制：40 / 100 / 100（透明度 100 ⇒ 生效不透明度 0 = 完全透明）',
    f1.amountPx === 40 && f1.sidePct === 100 && f1.chatPct === 100 && f1.shellPct === 0, JSON.stringify(f1))
  const fShell = fog({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 35 })
  ok('A2e 模糊与透明度**解耦**：amount 0 + 透明度 35 ⇒ shellPct = 65（不虚化也照样按透明度透出，不再钉到 100）',
    fShell.amountPx === 0 && fShell.sidePct === 35 && fShell.shellPct === 65, JSON.stringify(fShell))
  const fShell2 = fog({ unifyTint: true, unifyAmount: 12, sidebarAlpha: 35 })
  ok('A2f shellPct 恒 = 100 - 透明度（与半径无关）：amount 12 时同样 65；透明度 0 ⇒ 100（完全不透明）、100 ⇒ 0（完全透明）',
    fShell2.shellPct === 65
    && fog({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 0 }).shellPct === 100
    && fog({ unifyTint: true, unifyAmount: 0, sidebarAlpha: 100 }).shellPct === 0,
    JSON.stringify({ at12: fShell2.shellPct, t0: 100, t100: 0 }))
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
  ok('A5b 该组含小组标题 + 两枚滑条（虚化程度 / 表面透明度）+ 归属提示（跟随中=接管提示 / 动过=已独立）',
    /t\("sec\.blurRight"\)/.test(box) && /t\("sec\.blurRight\.desc"\)/.test(box)
    && /"rightSidebarBlurAmount"/.test(box) && /"rightSidebarAlpha"/.test(box)
    && /t\(section\.rightSidebarBlurUserSet \? "overridden\.indep" : "rightSidebarBlur\.overridden"\)/.test(box))
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
console.log('\n== B 组：CSS 落点（透明度 0 ⇒ 0 处覆盖 / 接管 / 共同表面 / 0 就是 0）==')
const RS_SEL = /\[data-sidebar-right-panel\]|\[data-dockkit-(pane|strip|surface|float)\]/
{
  /* ①(2026-10-02 f470590) **透明度 = 0 ⇒ 该表面完全不覆盖宿主**（`chromeInert`）。
     旧口径（≤f470590）在这里断言"共同表面 = `color-mix(…, 100.0%)` 实心" —— 那条口径
     **已废**：写 100% 的宿主色同样是把宿主钉回去（真机：打开设置面板时宿主换上的深色导航
     被 `!important` 覆盖 ⇒ "设置一开左栏就变黑"）。新口径 = **0 处 chrome 覆盖规则**。
     下面 B1–B1e 逐项把"0 处"钉死；非 0 档的结构判据搬到 B1f–B1i（否则接管块没人测）。 */
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 0, chatFollow: false })
  const s = STRIP(css)
  ok('B1 透明度 0 ⇒ 接管规则 **0 处**：`--mpw-unify-surface` 不产出、`[data-mpw-unify]` 0 处、右栏/dock 接管选择器 0 处',
    TOKEN(css, 'mpw-unify-surface') === ''
    && !/\[data-mpw-unify\]/.test(s)
    && !RULES(css).some(([sel]) => /\[data-mpw-unify\]/.test(sel) && RS_SEL.test(sel)),
    JSON.stringify({ surface: TOKEN(css, 'mpw-unify-surface'), sel: (s.match(/\[data-mpw-unify\]/g) || []).length }))
  ok('B1b 透明度 0 ⇒ 共同表面 token 与左栏表层 token 都**不产出**（不是 `color-mix(…, 100.0%)`：写 100% 仍会覆盖宿主自己的颜色）',
    !/--mpw-unify-surface/.test(s) && !/--mpw-surface-side-frost/.test(s) && TOKEN(css, 'mpw-surface-side-frost') === '',
    JSON.stringify({ unifySurface: (s.match(/--mpw-unify-surface/g) || []).length, frost: (s.match(/--mpw-surface-side-frost/g) || []).length }))
  ok('B1c 透明度 0 ⇒ 连"半径 0 ⇒ backdrop-filter: none"那条接管规则也不产出（**0 处**，而不是产出个 `none`）',
    !HAS_RULE(css, /\[data-mpw-unify\] \[data-sidebar-right-panel\]/, /backdrop-filter/)
    && TOKEN(css, 'mpw-unify-blur') === '',
    JSON.stringify({ blur: TOKEN(css, 'mpw-unify-blur') }))
  ok('B1d 透明度 0 ⇒ 暗色档同款：`--mpw-unify-surface-dark` 也不产出（不是"逐字等于亮色那条"）',
    TOKEN(css, 'mpw-unify-surface-dark') === '' && !/--mpw-unify-surface-dark/.test(s),
    TOKEN(css, 'mpw-unify-surface-dark'))
  ok('B1e 透明度 0 ⇒ 弹层/设置面板抑制规则也不产出（没有接管就没有要抑制的东西）：`[data-mpw-unify]:has(…_overlay…)` 0 处',
    !/\[data-mpw-unify\]:has\(/.test(s))
}
{
  /* 非 0 透明度（`chromeInert = false`）时的接管块 —— 原 B1/B1b/B1d/B1e 的结构判据（把档位从
     `sidebarAlpha: 0` 挪到 45；语义重做后 45 ⇒ 生效不透明度 55%）。 */
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 45, chatFollow: false })
  ok('B1f 透明度 45（非 0 档）⇒ 接管规则存在：右栏 / dock 指向共同表面 token（--mpw-unify-surface = 宿主侧栏 token 55.0%），暗色档逐字相等',
    HAS_RULE(css, /\[data-mpw-unify\]/, /--mpw-unify-surface/)
    && TOKEN(css, 'mpw-unify-surface') === SURF(SIDE_BASE, 55)
    && TOKEN(css, 'mpw-unify-surface-dark') === TOKEN(css, 'mpw-unify-surface'),
    JSON.stringify([TOKEN(css, 'mpw-unify-surface'), TOKEN(css, 'mpw-unify-surface-dark')]))
  ok('B1g 半径 0 ⇒ 接管规则的 backdrop-filter 是 **none**（不是 blur(0px)：后者仍建 containing block）',
    HAS_RULE(css, /\[data-mpw-unify\] \[data-sidebar-right-panel\]/, /backdrop-filter:\s*none/) && TOKEN(css, 'mpw-unify-blur') === '0px',
    JSON.stringify({ blur: TOKEN(css, 'mpw-unify-blur') }))
  /* ①(2026-10-02 真机定案) 抑制规则的判据从 `:has([class*="_overlay"])` 改成 **JS 门控**
     `body[data-mpw-sblur-off]`：宿主的 `uV2eYG_overlayAnchor`（聊天输入区锚点）常驻 DOM ⇒
     `:has()` 版本**永久命中**，会把右栏/dock/标题栏的模糊一直撤掉（探针读数 bf=none）。
     判据同步：产物里必须有 sblur-off 版的抑制规则，且**不许**再出现 :has(overlay) 版。 */
  ok('B1h 接管不碰弹层/设置面板：抑制规则走 JS 门控 body[data-mpw-sblur-off]（不再用会永久命中的 :has(overlay)）',
    HAS_RULE(css, /body\[data-mpw-sblur-off\] \[data-dockkit-pane\]/, /backdrop-filter:\s*none/)
    && !/\[data-mpw-unify\]:has\(\[class\*="_overlay"\]\)/.test(STRIP(css)))
  ok('B1i 非 0 档 + 不虚化 ⇒ body[data-mpw-unify] 接管仍在（开关门控照旧）、半径变量是 0px；左栏表层 = 同一条宿主 token 55.0%',
    TOKEN(css, 'mpw-unify-blur') === '0px' && TOKEN(css, 'mpw-surface-side-frost') === SURF(SIDE_BASE, 55)
    && TOKEN(css, 'mpw-chrome-alpha') === '0.55',
    JSON.stringify({ blur: TOKEN(css, 'mpw-unify-blur'), frost: TOKEN(css, 'mpw-surface-side-frost') }))
}
{
  const css = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, chatFollow: false })
  ok('B2 半径/透明度都跟着两个条走：透明度 60 ⇒ 生效不透明度 40.0%、blur=24px、规则里就是 blur(24px)',
    TOKEN(css, 'mpw-unify-surface') === SURF(SIDE_BASE, 40) && TOKEN(css, 'mpw-unify-blur') === '24px'
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
  ok('B7 统一虚化关 ⇒ 右栏/dock 回到自己那套参数（--mpw-rs-blur 14px / --mpw-rs-alpha = 生效不透明度 0.55）',
    TOKEN(css, 'mpw-rs-blur') === '14px' && TOKEN(css, 'mpw-rs-alpha') === '0.55',
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
  const r3 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, headerFrostUserSet: true, headerFrostOwn: true, headerFrostAmount: 8 })
  ok('C3 标题栏被单独动过（headerFrostUserSet）⇒ 用 headerFrostAmount（8px），与统一虚化解耦', r3.px === 8, JSON.stringify(r3))
  const r4 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, headerFrostUserSet: true, headerFrostOwn: true, headerFrostAmount: 0 })
  ok('C3b 独立强度 = 0 ⇒ 也是 0px（"0 = 不磨砂"，不再被 8px 下限抬起来）', r4.px === 0, JSON.stringify(r4))
  /* ⚠️ 关于这条支路（不跟随 + headerFrostOwn 关 + headerBlur 开）：lib 里 `num()` 少传一个参数的
     缺陷已修（`num(<pct/4>, 0, 0, 40)`，见 mpwSurfacePlan 的 header 分支）⇒ 现在 100% ÷ 4 = **25px**。
     读数的坑：桩里没有宿主 `header` 元素（`findHostHeader()` → null）⇒ `syncHeaderFrost` 末尾的
     `hdrFrostState.px = el ? px : 0` 把 px 记成 0 —— **真正的半径在 `state().reason` 里**
     （`…｜跟随整屏虚化 25px`，hdrPx() 就是从这里取的）。别拿 `state().px` 判这条支路。
     C4 保持宽松（等 lib 这条链的真机行为确认后再收紧）；C4c 用 reason 把换算钉死（25px / 10px）。 */
  const r5 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, blurFollowUnify: false, headerBlur: true, headerBlurAmount: 100 })
  ok('C4 不跟随 ⇒ 标题栏走自己的链（表面模型 header.indep=true），半径不再是统一虚化的 30px',
    r5.px !== 30
    && planOf(SRC)({ unifyTint: true, unifyAmount: 30, blurFollowUnify: false, headerBlur: true, headerBlurAmount: 100 }).header.indep === true,
    JSON.stringify(r5))
  const r5b = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, blurFollowUnify: false, headerBlur: true, headerBlurAmount: 40 })
  ok('C4c 不跟随 ⇒ 标题栏磨砂条的换算成立：100% → 25px、40% → 10px（统一值的 30px 完全不参与）',
    r5.px === 25 && r5b.px === 10, JSON.stringify({ pct100: r5, pct40: r5b }))
  const r6 = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 18, blurFollowUnify: false, headerBlur: true, headerBlurAmount: 0 })
  ok('C4b 不跟随 ⇒ 标题栏**真的独立**：自己的条为 0 就是 0px（不再回落到统一虚化的 18px —— 独立不藕断丝连）',
    r6.px === 0, JSON.stringify(r6))
}

/* ══════════════════════════════════════════════════════════════════
   D 组：取色厚度（切片执行真 aquaTokenOverrides）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== D 组：面板取色的可见程度 = 表面生效不透明度（透明度 100 ⇒ 一个像素不刷）==')
function runAqua(section, text) {
  const code = [
    'const document = { body: { hasAttribute: () => false } };',
    'const getComputedStyle = () => ({ getPropertyValue: (n) => (n === "--mpw-aqua-rgb" ? "255 128 160" : "") });',
    constDecls(text, PLAN_CONSTS.concat(['DEFAULT_AQUA_TINT', 'DEFAULT_AQUA_MASK', 'DEFAULT_AQUA_INK', 'DEFAULT_AQUA_TEXT_ENHANCE'])),
    sliceFn('aquaParseHex', text), sliceFn('aquaInkForRgb', text), sliceFn('aquaBrandColor', text),
    sliceFn('mpwSurfacePlan', text), sliceFn('mpwFogModel', text), sliceFn('aquaTokenOverrides', text),
    'return aquaTokenOverrides;',
  ].join('\n')
  return new Function(code)()(section)
}
{
  const o = runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 0, sidebarAlpha: 0 })
  const fill = o && o['--dsw-specific-sidebar-fill'] && o['--dsw-specific-sidebar-fill'].light
  const base = o && o['--dsw-alias-bg-base'] && o['--dsw-alias-bg-base'].light
  ok('D1 界面透明度 0 ⇒ 侧边栏填充的采样色 alpha = **100%**（表面完全不透明 = 取色就是本色）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+100%/.test(String(fill)), String(fill))
  ok('D1b 主画布同款：基色 token 的取色 alpha = 表面生效不透明度（透明度 0 ⇒ 100%）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+100%/.test(String(base)), String(base))
  const o100 = runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 100 })
  const fill100 = o100 && o100['--dsw-specific-sidebar-fill'] && o100['--dsw-specific-sidebar-fill'].light
  ok('D1c 界面透明度 100（完全透明）⇒ 采样色 alpha = **0%**：一个像素都不刷（真机"透明侧边栏 + 壁纸采样粉"的直接来源）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+0%/.test(String(fill100)), String(fill100))
  const o2 = runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60 })
  const fill2 = o2 && o2['--dsw-specific-sidebar-fill'] && o2['--dsw-specific-sidebar-fill'].light
  ok('D2 透明度 60 ⇒ 采样色 alpha = 40%（色相仍来自壁纸，可见程度归"生效不透明度"）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+40%/.test(String(fill2)), String(fill2))
  const o3 = runAqua({ aquaTint: true, unifyTint: false })
  const fill3 = o3 && o3['--dsw-specific-sidebar-fill'] && o3['--dsw-specific-sidebar-fill'].light
  ok('D3 统一虚化关 ⇒ 保留历史档 85%（观感与刷新前一致，不借机改行为）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+85%/.test(String(fill3)), String(fill3))
}
{
  /* ⚠️ 观察（不改 lib、也不据此下判据）：`const pct = fog.unifyOn ? fog.sidePct : 62;` 写进的是
     `--mpw-aqua-header-alpha`（CSS 里当 color-mix 的 **alpha** 用）。语义重做后 `sidePct` = **透明度**
     （0 = 不透明），而 D1–D3 的取色 alpha 用的是**生效不透明度**（100 - 透明度）⇒ 同一套口径下
     标题栏这一支是**反的**：透明度 0 写 0%（不刷采样色）、透明度 100 写 100%（整条刷满）。
     若要收口，修法是 `fog.shellPct`（或 `100 - fog.sidePct`）。
     本判据只钉"接线存在"（方向不进断言 —— 口径未拍板前不把它固化成门禁）。 */
  ok('D4 标题栏采样色的可见程度 = 表面**不透明度**（CSS 读 var(--mpw-aqua-header-alpha, 62%)，JS 写 shellPct = 100 - 透明度）',
    /rgb\(var\(--mpw-aqua-rgb\)\)\s+var\(--mpw-aqua-header-alpha, 62%\)/.test(SRC)
    && /setProperty\("--mpw-aqua-header-alpha", pct \+ "%"\)/.test(SRC)
    && /const pct = fog\.unifyOn \? fog\.shellPct : 62;/.test(SRC)
    && /removeProperty\("--mpw-aqua-header-alpha"\)/.test(SRC))
}

/* ══════════════════════════════════════════════════════════════════
   F8 组：**静默被丢弃的 CSS 值**（2026-10-02 真机定案的那类 bug）
   病：`--mpw-surface-pop: rgba(var(--mpw-chrome-bg, 255,255,255), 0.94)` —— 而
   `--mpw-chrome-bg` 早已改成**颜色**（`var(--dsw-specific-sidebar-fill)`）而不是三元组 ⇒
   解析成 `rgba(var(--dsw-…), .94)` 属非法值，整条声明在 computed-value 阶段被**静默丢弃**
   ⇒ 所有弹层"只有模糊、没有底"（用户第 3 条「完全透明、文字重叠」的真根因，探针在真机
   Firefox 里逐条验过：非法形态 computed = rgba(0,0,0,0)）。
   判据：产物里凡出现 `rgba(var(--mpw-X), …)`，被引用的 `--mpw-X` 必须是**三元组**（`r,g,b`）；
   否则判红并指出是哪一枚 token。
   ══════════════════════════════════════════════════════════════════ */
{
  const css = boot({ enabled: true, image: true })
  const flat = STRIP(css)
  const tripletOk = new Set()
  for (const m of flat.matchAll(/--(mpw-[\w-]+)\s*:\s*([^;}]+)/g)) {
    const name = m[1], val = String(m[2]).trim()
    if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(val)) tripletOk.add(name)
  }
  const bad = []
  for (const m of flat.matchAll(/rgba\(\s*var\(\s*--(mpw-[\w-]+)\s*[,)]/g)) {
    if (!tripletOk.has(m[1])) bad.push(m[1])
  }
  ok('F8 没有"引用了非三元组 token 的 rgba(var(--mpw-…))"——这类值会被浏览器静默丢弃（弹层"只有模糊没有底"的真根因）',
    bad.length === 0, JSON.stringify([...new Set(bad)]))
  ok('F8c 弹层表面选择器排除了菜单的内层滚动视口（[class*="_viewport"]）——否则父 _menu 与子 _viewport 两层同时命中，真机实测底部两层 0.94 叠加、模糊也叠两层（用户第 3 条①指令菜单）',
    /POP_NOT = `[^`]*_viewport/.test(SRC), '')
  ok('F8b 弹层表面与右栏整块表面都是合法颜色表达式（color-mix / 具体色），不是 rgba(var(…))',
    /--mpw-surface-pop:\s*color-mix\(/.test(flat) && /--mpw-surface-rs-full:\s*color-mix\(/.test(flat))
}

/* ══════════════════════════════════════════════════════════════════
   E 组：变异自证（真源零改动；改坏关键判断 ⇒ 对应判据必红）
   ⚠️ 锚点纪律：`mutant()` 现在**强制锚点唯一**（split/join 会一次改多处 ⇒ 自证失效）。
      ①(2026-10-02 f470590 后复查) E1 `Math.max(0, planHdr…)` / E2 `sideAlpha = planAqua…` /
      E3 `unifyFollowNow = unifyTint && blurFollowUnify` / E4 `bsTakeoverSurface = !unifyTakeover…` /
      E4b `shellPct: Math.max(0, Math.min(100, 100 - sidePct))` / F6 `headerFrostAmount: 'headerFrostUserSet'`
      在真源里**各出现 1 次** —— `chromeInert` / `unifyChrome` / `rightInert` 的加入没有让任何既有锚点
      变重复 ⇒ 无需换锚点（若将来重复，`mutant()` 会直接抛"变异锚点不唯一"，不会静默变成多处变异）。
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== E 组：变异自证 ==')
{
  /* E1 标题栏半径下限改回旧写法（0 被抬到 12px）⇒ C1 必红 */
  const m1 = mutant('hdr-floor', 'un ? Math.max(0, Math.round(planHdr.header.blur || 0))',
    'un ? Math.max(12, Math.round(planHdr.header.blur || 0))')
  const r = hdrPx({ enabled: true, image: true, unifyTint: true, unifyAmount: 0 })
  const rM = (() => { boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 0 }, m1); const T = globalThis.__mpwHdrFrostTest; T.sync(); const st = T.state() || {}; const mm = /(\d+)px/.exec(String(st.reason || '')); return { reason: st.reason, px: mm ? Number(mm[1]) : null } })()
  ok('E1 半径下限改回 `Math.max(12, plan…)` ⇒ 整屏虚化 0 也被抬成 12px（C1 必红）',
    rM.px === 12 && r.px === 0, JSON.stringify({ mutant: rM.px, real: r.px }))
}
{
  /* E2 取色 alpha 写死回 85% ⇒ D1c 必红（**行为**变异：变异体走同一条 runAqua 判据） */
  const m2 = mutant('aqua-fixed', 'const sideAlpha = planAqua.unifyOn ? planAqua.right.opacityPct / 100 : 0.85;', 'const sideAlpha = 0.85;')
  const txtM = fs.readFileSync(m2, 'utf8')
  const mutFill = ((runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 100 }, txtM) || {})['--dsw-specific-sidebar-fill'] || {}).light
  const realFill = ((runAqua({ aquaTint: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 100 }) || {})['--dsw-specific-sidebar-fill'] || {}).light
  ok('E2 取色 alpha 写死回 85% ⇒ 透明度 100 时仍刷 85% 采样色（D1c 必红）',
    /85%/.test(String(mutFill)) && /0%/.test(String(realFill)),
    JSON.stringify({ mutant: mutFill, real: realFill }))
}
{
  /* E3 跟随开关判断被去掉（恒跟随）⇒ B3/F1 必红 */
  const m3 = mutant('follow-ignored', 'const unifyFollowNow = unifyTint && blurFollowUnify;', 'const unifyFollowNow = unifyTint;')
  const cssM = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, blurFollowUnify: false, chatFollow: false }, m3)
  const cssR = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, blurFollowUnify: false, chatFollow: false })
  ok('E3 「跟随」开关被忽略 ⇒ 不跟随时也会产出接管规则（B3/F1 必红）',
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
  /* E4b 把 shellPct 钉回 100（旧的"不虚化 ⇒ 实心"钳制）⇒ A2f 必红 */
  const m5 = mutant('solid-floor', 'shellPct: Math.max(0, Math.min(100, 100 - sidePct)),', 'shellPct: 100,')
  const fogM = fogOf(fs.readFileSync(m5, 'utf8'))
  const m = fogM({ unifyTint: true, unifyAmount: 12, sidebarAlpha: 100 })
  const r = fogOf(SRC)({ unifyTint: true, unifyAmount: 12, sidebarAlpha: 100 })
  ok('E4b 把 shellPct 钉回 100（"不虚化 ⇒ 实心"旧钳制）⇒ 透明度 100 不再透出（A2f 必红）',
    m.shellPct === 100 && r.shellPct === 0, JSON.stringify({ mutant: m.shellPct, real: r.shellPct }))
}
{
  /* E5 真源零改动（E 组与 F6 的变异自证都只动 mkdtemp 副本） */
  const now = fs.readFileSync(CLIENT, 'utf8')
  ok('E5 变性自证只动 mkdtemp 副本：真源 sha256 跑前跑后逐字节相同',
    now === SRC)
}

/* ══════════════════════════════════════════════════════════════════
   F 组：独立性 / 归属（谁被接管、谁独立、标记在哪落）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== F 组：独立性/归属（跟随开关 + *UserSet 标记）==')
{
  /* F1 不跟随 ⇒ 一条接管规则都不产出（沿用/强化原 B3：连变量名都不许出现）。 */
  const off = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, blurFollowUnify: false, chatFollow: false })
  const on = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 60, chatFollow: false })
  const tokOff = (STRIP(off).match(/--mpw-unify-/g) || []).length
  const selOff = (STRIP(off).match(/\[data-mpw-unify\]/g) || []).length
  const tokOn = (STRIP(on).match(/--mpw-unify-/g) || []).length
  ok('F1 blurFollowUnify=false ⇒ 接管规则 0 处（--mpw-unify-* 与 [data-mpw-unify] 都不许出现）；打开跟随立刻 ≥3 处',
    tokOff === 0 && selOff === 0 && tokOn >= 3, JSON.stringify({ off: { tokens: tokOff, sels: selOff }, onTokens: tokOn }))
}
{
  /* F2 跟随档：四个表面**逐字一致**（左栏/右栏/dock 同一条宿主 token；标题栏 bg-base 那条；三半径相等）。 */
  const st = { enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, chatFollow: false }
  const css = boot(st)
  const plan = planOf(SRC)({ unifyTint: true, unifyAmount: 30, sidebarAlpha: 40 })
  ok('F2 跟随档：左栏（--mpw-surface-side-frost）与右栏/dock（--mpw-unify-surface 及 -dark）逐字相等 = 宿主侧栏 token 60.0%',
    TOKEN(css, 'mpw-surface-side-frost') === SURF(SIDE_BASE, 60)
    && TOKEN(css, 'mpw-unify-surface') === SURF(SIDE_BASE, 60)
    && TOKEN(css, 'mpw-unify-surface-dark') === TOKEN(css, 'mpw-unify-surface'),
    JSON.stringify([TOKEN(css, 'mpw-surface-side-frost'), TOKEN(css, 'mpw-unify-surface')]))
  ok('F2b 跟随档：三个半径逐字相等（--mpw-chrome-blur == --mpw-rs-blur == --mpw-unify-blur = 30px）',
    TOKEN(css, 'mpw-chrome-blur') === '30px' && TOKEN(css, 'mpw-rs-blur') === '30px' && TOKEN(css, 'mpw-unify-blur') === '30px',
    JSON.stringify([TOKEN(css, 'mpw-chrome-blur'), TOKEN(css, 'mpw-rs-blur'), TOKEN(css, 'mpw-unify-blur')]))
  ok('F2c 标题栏用宿主 bg-base 那条（左栏/右栏是 sidebar-fill）：表面模型里基色/半径/透明度三项都与左栏同源',
    plan.header.base === TOP_BASE && plan.left.base === SIDE_BASE && plan.right.base === SIDE_BASE
    && plan.header.opacityPct === plan.left.opacityPct
    && plan.header.blur === plan.left.blur && plan.left.blur === plan.right.blur
    && /setProperty\("--mpw-hdr-frost-bg", mpwSurfaceColor\(pl\.header\.base, pl\.header\.opacityPct \/ 100\)\)/.test(SRC),
    JSON.stringify({ header: plan.header, left: plan.left, right: plan.right }))
}
{
  /* F3 只有右栏被单独动过 ⇒ **只**右栏独立；左栏/标题栏仍是统一值。 */
  const st = { enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, rightSidebarBlurUserSet: true, rightSidebarBlur: true, rightSidebarBlurAmount: 10, rightSidebarAlpha: 20, chatFollow: false }
  const css = boot(st)
  ok('F3 右栏被单独动过 ⇒ 右栏半径/透明度用自己那套（--mpw-rs-blur 10px / --mpw-rs-alpha 0.80 / 表面 80.0%）',
    TOKEN(css, 'mpw-rs-blur') === '10px' && TOKEN(css, 'mpw-rs-alpha') === '0.8'
    && TOKEN(css, 'mpw-surface-rs-dock') === SURF(SIDE_BASE, 80),
    JSON.stringify([TOKEN(css, 'mpw-rs-blur'), TOKEN(css, 'mpw-rs-alpha'), TOKEN(css, 'mpw-surface-rs-dock')]))
  const r = hdrPx(st)
  ok('F3b 右栏独立**不许**牵连左栏/标题栏：chrome 半径仍 30px、左栏表面仍统一色 60.0%、标题栏半径仍 30px',
    TOKEN(css, 'mpw-chrome-blur') === '30px'
    && TOKEN(css, 'mpw-chrome-alpha') === '0.6'
    && TOKEN(css, 'mpw-surface-side-frost') === SURF(SIDE_BASE, 60)
    && r.px === 30,
    JSON.stringify({ chrome: TOKEN(css, 'mpw-chrome-blur'), side: TOKEN(css, 'mpw-surface-side-frost'), hdr: r }))
}
{
  /* F4 只有标题栏被单独动过 ⇒ 标题栏用自己的半径；左栏仍是统一值。 */
  const st = { enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40, headerFrostUserSet: true, headerFrostOwn: true, headerFrostAmount: 12, chatFollow: false }
  const r = hdrPx(st)
  ok('F4 标题栏被单独动过（headerFrostUserSet + headerFrostOwn）⇒ 半径用它自己的 12px', r.px === 12, JSON.stringify(r))
  const css = boot(st)
  ok('F4b 标题栏独立**不许**牵连左栏：chrome 半径仍 30px、左栏表面仍统一色 60.0%',
    TOKEN(css, 'mpw-chrome-blur') === '30px' && TOKEN(css, 'mpw-surface-side-frost') === SURF(SIDE_BASE, 60),
    JSON.stringify([TOKEN(css, 'mpw-chrome-blur'), TOKEN(css, 'mpw-surface-side-frost')]))
}
{
  /* F5 mpwMarkUserSet()：标记的**唯一落点**（切片执行真实现）。 */
  const mark = markOf(SRC)
  const m1 = mark({ rightSidebarAlpha: 70 })
  ok('F5 {rightSidebarAlpha:70} ⇒ rightSidebarBlurUserSet=true（其余两个标记一个都不打）',
    m1.rightSidebarBlurUserSet === true && !('sidebarBlurUserSet' in m1) && !('headerFrostUserSet' in m1), JSON.stringify(m1))
  const m2 = mark({ headerBlur: true })
  const m3 = mark({ headerFrostAmount: 20 })
  ok('F5b {headerBlur:true} / {headerFrostAmount:20} ⇒ headerFrostUserSet=true（两个字段都算"动过标题栏"）',
    m2.headerFrostUserSet === true && m3.headerFrostUserSet === true
    && m2.sidebarBlurUserSet === undefined && m3.rightSidebarBlurUserSet === undefined, JSON.stringify([m2, m3]))
  const m4 = mark({ sidebarBlurAmount: 9 })
  ok('F5c {sidebarBlurAmount:9} ⇒ sidebarBlurUserSet=true', m4.sidebarBlurUserSet === true && m4.headerFrostUserSet === undefined, JSON.stringify(m4))
  const m5 = mark({ blurFollowUnify: true })
  ok('F5d {blurFollowUnify:true} ⇒ 三个标记全部 = false（重新跟随 = 清空归属）',
    m5.sidebarBlurUserSet === false && m5.headerFrostUserSet === false && m5.rightSidebarBlurUserSet === false, JSON.stringify(m5))
  const m6 = mark({ blurFollowUnify: true, sidebarBlurAmount: 9 })
  ok('F5e 同一 patch 里既有「重新跟随」又动了滑条 ⇒ 跟随优先，仍然三个标记全清',
    m6.sidebarBlurUserSet === false && m6.headerFrostUserSet === false && m6.rightSidebarBlurUserSet === false, JSON.stringify(m6))
  const m7 = mark({ unifyAmount: 9 })
  ok('F5f {unifyAmount:9}（**未被接管**的字段）⇒ 一个标记都不打（否则调统一虚化就把四项全变独立）',
    !('sidebarBlurUserSet' in m7) && !('headerFrostUserSet' in m7) && !('rightSidebarBlurUserSet' in m7), JSON.stringify(m7))
  const m8 = mark({ rightSidebarBlur: false })
  ok('F5g {rightSidebarBlur:false}（把开关关掉也是"动过"）⇒ rightSidebarBlurUserSet=true',
    m8.rightSidebarBlurUserSet === true, JSON.stringify(m8))
}
{
  /* F6 变异自证：把 MPW_USERSET_OF 里的映射删掉一条 ⇒ F5 必红。
     与 E 组同款：变异体落 mkdtemp 副本、**重新 loadPlugin**（真源零改动）。 */
  const m6 = mutant('userset-map', " headerFrostAmount: 'headerFrostUserSet',", '')
  boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 40 }, m6)
  const markM = markOf(fs.readFileSync(m6, 'utf8'))
  const markR = markOf(SRC)
  const gotM = markM({ headerFrostAmount: 20 })
  const gotR = markR({ headerFrostAmount: 20 })
  ok('F6 删掉 MPW_USERSET_OF 的 headerFrostAmount 映射 ⇒ 动过那条滑条不再打标记（F5b 必红）',
    gotM.headerFrostUserSet !== true && gotR.headerFrostUserSet === true, JSON.stringify({ mutant: gotM, real: gotR }))
}

/* ══════════════════════════════════════════════════════════════════
   F7 组：透明度 = 0 ⇒ 完全不覆盖宿主（`chromeInert`，提交 f470590）
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== F7 组：透明度 0 ⇒ 完全不覆盖宿主（chromeInert）==')
/* 「左栏规则」计数口径 = **真机读数同款**（chrome-surface-live-probe 里"透明度 0 时 8→2"就是按
   宿主侧栏类 `pI_x6G_sidebarCol` 数的）：选择器里出现该类的规则条数。
   ⚠️ 别用 `/sidebarCol/` 宽口径：`[data-mpw-lg-css]:not([class*="sidebarCol"])` 这种**否定式**
   里的字样会被误计（透明 0 档会多数出 2 条，阈值就永远"差一点"）。 */
const SIDE_RULES = (css) => RULES(css).filter(([sel]) => /pI_x6G_sidebarCol/.test(sel))
const INERT_ST = { enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 0, chatFollow: false }
const LIVE_ST = { enabled: true, image: true, unifyTint: true, unifyAmount: 24, sidebarAlpha: 45, chatFollow: false }
/** F7a 的判据本体（F7e 的变异自证要拿它对变异体重算一遍）。 */
const F7A_HOLDS = (css) => {
  const s = STRIP(css)
  return (s.match(/--mpw-unify-/g) || []).length === 0
    && (s.match(/\[data-mpw-unify\]/g) || []).length === 0
    && !/--mpw-surface-side-frost/.test(s)
}
{
  /* F7a 透明度 0 ⇒ 三处全空：统一虚化 token / 接管选择器 / 左栏表层 token（连声明都不产出）。 */
  const css = boot(INERT_ST)
  const s = STRIP(css)
  const unifyTok = (s.match(/--mpw-unify-/g) || []).length
  const unifySel = (s.match(/\[data-mpw-unify\]/g) || []).length
  const frost = (s.match(/--mpw-surface-side-frost/g) || []).length
  ok('F7a 透明度 0 ⇒ `--mpw-unify-*` 0 处、`[data-mpw-unify]` 规则 0 处、`--mpw-surface-side-frost` 0 处（该 token 不被任何规则引用）',
    unifyTok === 0 && unifySel === 0 && frost === 0, JSON.stringify({ unifyTok, unifySel, frost }))
}
{
  /* F7b 透明度 0 ⇒ 左栏规则数**显著下降**（真机 8→2）。剩下的 2 条不是本模型产出的，而是
     用户显式特性：收起/悬浮 float（`[data-sidebar-collapsed]` 下让内层 root 透出）与
     主题色（`body[data-mpw-theme]` 的 `--mpw-theme-color` wash）—— 阈值就卡在"≤ 2 条"，
     且这 2 条必须真的是那两个特性的门控选择器（多出第 3 条 = 覆盖规则漏出来了）。 */
  const side = SIDE_RULES(boot(INERT_ST))
  const rest = side.map(([sel]) => sel.replace(/\s+/g, ' '))
  ok('F7b 透明度 0 ⇒ 左栏（pI_x6G_sidebarCol）规则 **≤ 2 条**；剩下的只许是用户显式特性：悬浮 float（[data-sidebar-collapsed]）与主题色（body[data-mpw-theme]），不属于本模型',
    side.length <= 2 && rest.every((x) => /data-sidebar-collapsed|data-mpw-theme/.test(x)),
    JSON.stringify({ count: side.length, rest }))
}
{
  /* F7c 透明度 45（非 0 档）⇒ 规则恢复：接管块在、左栏规则数回到 ≥ 5（unifyAmount 24 档实测 8）。 */
  const css = boot(LIVE_ST)
  const side = SIDE_RULES(css)
  ok('F7c 透明度 45 ⇒ 规则恢复：接管块存在（--mpw-unify-surface 有值 + [data-mpw-unify] 规则在）且左栏规则数 ≥ 5',
    TOKEN(css, 'mpw-unify-surface') !== '' && /\[data-mpw-unify\]/.test(STRIP(css)) && side.length >= 5,
    JSON.stringify({ surface: TOKEN(css, 'mpw-unify-surface'), sideRules: side.length }))
}
{
  /* F7d 行为（真实现 `syncHeaderFrost`）：桩里 `document.querySelector` 恒 null ⇒ 注入链永远走不到
     "真的挂上层"那一步（C4 注释里的坑：`injected` 恒 false，读数没有分辨力）。这里给桩**补一枚假宿主
     标题栏**（用桩自己的 `createElement`，只把 `querySelector` 改成命中 header 选择器；`.mpw-hdrFrost`
     查询不含 "header" 字样 ⇒ 仍返回 null，cleanup 语义不变）⇒ `injected` / `translucent` / 层数
     三个读数才有分辨力。 */
  const probe = (settings) => {
    boot(settings)
    const doc = globalThis.document
    const hdr = doc.createElement('header')
    hdr.className = 'wSkVaW_header'
    doc.querySelector = (sel) => (/header/i.test(String(sel)) ? hdr : null)
    const T = globalThis.__mpwHdrFrostTest
    if (!T) return { err: 'no-hook' }
    T.sync()
    const st = T.state() || {}
    return {
      reason: String(st.reason || ''), injected: !!st.injected, translucent: !!st.translucent, px: st.px,
      layers: (hdr.children || []).filter((c) => c && c.className === 'mpw-hdrFrost').length,
      attr: hdr.hasAttribute('data-mpw-hdr-translucent'),
    }
  }
  const r0 = probe(INERT_ST)
  ok('F7d 透明度 0 ⇒ 标题栏**交还宿主**：reason 含「交还宿主」、translucent=false、injected=false、宿主头上 0 层 .mpw-hdrFrost、data-mpw-hdr-translucent 未打',
    /交还宿主/.test(r0.reason) && r0.translucent === false && r0.injected === false && r0.layers === 0 && r0.attr === false,
    JSON.stringify(r0))
  const r45 = probe(LIVE_ST)
  ok('F7d2 透明度 45 ⇒ 正常注入路径：reason 走「跟随整屏虚化 24px」（不含「交还宿主」）、injected=true、translucent=true、宿主头上 1 层 .mpw-hdrFrost',
    !/交还宿主/.test(r45.reason) && /跟随整屏虚化 24px/.test(r45.reason)
    && r45.injected === true && r45.translucent === true && r45.layers === 1 && r45.attr === true,
    JSON.stringify(r45))
}
{
  /* F7e 变异自证：把 `chromeInert` 的判据改坏（`>= 100` → `>= 101`：透明度 0 不再 inert）⇒
     F7a 必红（F7b 跟着红：左栏规则 2→8 条）。mkdtemp 副本 + 重新 loadPlugin，与 E 组同款。 */
  const m7 = mutant('chrome-inert', 'const chromeInert = surfacePlan.left.opacityPct >= 100;',
    'const chromeInert = surfacePlan.left.opacityPct >= 101;')
  const cssM = boot(INERT_ST, m7)
  const cssR = boot(INERT_ST)
  ok('F7e 变异自证：`chromeInert` 的 `>= 100` 改成 `>= 101` ⇒ 透明度 0 也照旧产出左栏表层（--mpw-surface-side-frost 0→2 处、左栏规则 2→8 条）⇒ F7a/F7b 必红',
    F7A_HOLDS(cssM) === false && F7A_HOLDS(cssR) === true,
    JSON.stringify({
      mutant: { f7a: F7A_HOLDS(cssM), frost: (STRIP(cssM).match(/--mpw-surface-side-frost/g) || []).length, sideRules: SIDE_RULES(cssM).length },
      real: { f7a: F7A_HOLDS(cssR), frost: (STRIP(cssR).match(/--mpw-surface-side-frost/g) || []).length, sideRules: SIDE_RULES(cssR).length },
    }))
}


/* ══════════════════════════════════════════════════════════════════
   G 组：**透明度语义搬值**（2026-10-03 真机定案："左栏还是粉色，现在右栏也被注入了粉色"）
   3.15.0 把两条滑条的数值语义翻转了（旧 = 白雾厚度/不透明，新 = 透明度），默认值照映射搬了
   （新 65 ≡ 旧 35），但**存量档里的用户值没搬** ⇒ 用户当年为"求实心"拖到的 100 翻转后成了
   "全透明" ⇒ 左栏整块透出壁纸、跟随档下右栏一起透（观感 = 被注入壁纸的粉色；探针三次读数
   都证明那层就是壁纸本身，一个采样色都没刷）。
   判据：旧档一次性按 `新 = 100 - 旧` 搬值并落盘标记 `alphaSemantics = 2`；带标记的档一字不动；
   从没设过的档保持新默认；标记**不进用户档视图**（面板/导出/字段比较看不到）。
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== G 组：透明度语义搬值（旧档 100 = 全不透明 → 新档 0）==')
{
  /* 旧档：真机用户档同形（sidebarAlpha 100 / rightSidebarAlpha 45，无记账键） */
  const LEGACY = { enabled: true, image: 'stub-wallpaper.png', unifyTint: true, unifyAmount: 4, blurFollowUnify: true, sidebarAlpha: 100, rightSidebarAlpha: 45 }
  /* ⚠️ 这两个字段只能**经档**进去（loadPlugin 的 settings），不能进 buildCss 的 patch：
     patch 是"用户的本次改动"，会在 readSection() **之后**盖上 —— 那就把刚搬好的值又盖回旧值，
     判据假红（第一版就是这么红的）。 */
  const bootLegacy = (settings, clientPath) => {
    reset()
    world = loadPlugin({ quiet: true, clientPath: clientPath || CLIENT, settings: settings || {}, legacyAlphaSemantics: true })
    const patch = Object.assign({ enabled: true, image: 'stub-wallpaper.png' }, settings || {})
    delete patch.sidebarAlpha; delete patch.rightSidebarAlpha
    return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss(patch) : '') || '')
  }
  const P = () => globalThis.__mpwPersist
  const cssLegacy = bootLegacy(LEGACY)
  const rawLegacy = (() => { try { return JSON.parse(globalThis.localStorage.getItem(P().key) || '{}') } catch { return {} } })()
  ok('G1 旧档（无记账键）⇒ 生效不透明度回到 100%：--mpw-chrome-alpha = 1 且不再是 0（旧档 100 不再被当成"全透明"）',
    /--mpw-chrome-alpha:\s*1(\.0+)?\s*[;}]/.test(STRIP(cssLegacy)) && !/--mpw-chrome-alpha:\s*0\s*[;}]/.test(STRIP(cssLegacy)),
    (STRIP(cssLegacy).match(/--mpw-chrome-alpha:[^;}]+/) || [''])[0])
  /* 用户档视图：**必须在换世界之前读**（下面 G3 会 boot 一个新世界，全局钩子随之换人） */
  const viewAfter = (() => { try { const v = P().read(); return { sidebarAlpha: v.sidebarAlpha, right: v.rightSidebarAlpha, alphaSemantics: v.alphaSemantics } } catch { return null } })()
  /* 落盘是**延迟**的（boot 收尾前不写：宿主那份档还没合并回来）⇒ 显式收尾一次再读盘 */
  let moved = null
  try { P().writePartial({ unifyAmount: 4 }) } catch (e) { moved = 'writePartial 抛错:' + e.message }
  try { P().bootSettle('gate') } catch (e) { moved = (moved ? moved + ' | ' : '') + 'bootSettle 抛错:' + e.message }
  await new Promise((r) => setTimeout(r, 150))   /* 落盘是"0ms 定时器 + 异步写"：等它真的落地再读盘 */
  const persisted = (() => { try { return JSON.parse(globalThis.localStorage.getItem(P().key) || '{}') } catch { return {} } })()
  ok('G2 落盘的档被**搬过值**且带上幂等标记：sidebarAlpha 100→0、rightSidebarAlpha 45→55、alphaSemantics=2',
    persisted.sidebarAlpha === 0 && persisted.rightSidebarAlpha === 55 && persisted.alphaSemantics === 2,
    JSON.stringify({ sidebarAlpha: persisted.sidebarAlpha, rightSidebarAlpha: persisted.rightSidebarAlpha, alphaSemantics: persisted.alphaSemantics }) + (moved ? ' | ' + moved : ''))
  const cssAgain = (() => { reset(); world = loadPlugin({ quiet: true, clientPath: CLIENT, settings: persisted }); return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ enabled: true, image: 'stub-wallpaper.png' }) : '') || '') })()
  ok('G3 搬值只做一次：带标记的档再开机**不再翻**（仍是全不透明，不是 100 ⇒ 不是透明）',
    /--mpw-chrome-alpha:\s*1(\.0+)?\s*[;}]/.test(STRIP(cssAgain)), (STRIP(cssAgain).match(/--mpw-chrome-alpha:[^;}]+/) || [''])[0])
  ok('G4 记账键不进用户档视图（面板/导出/字段比较看不到 alphaSemantics），且搬值后的值在视图里就是 0/55',
    !!viewAfter && viewAfter.alphaSemantics === undefined && viewAfter.sidebarAlpha === 0 && viewAfter.right === 55,
    JSON.stringify(viewAfter))
  ok('G5 新档语义（用户自己把滑条拖到 100 = 明确要全透明，带标记）⇒ 一字不动：--mpw-chrome-alpha = 0',
    (() => { reset(); world = loadPlugin({ quiet: true, clientPath: CLIENT, settings: { enabled: true, image: 'stub-wallpaper.png', unifyTint: true, unifyAmount: 4, blurFollowUnify: true, sidebarAlpha: 100, rightSidebarAlpha: 45, alphaSemantics: 2 } }); const c = String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ enabled: true, image: 'stub-wallpaper.png' }) : '') || ''); return /--mpw-chrome-alpha:\s*0\s*[;}]/.test(STRIP(c)) })(),
    '')
  ok('G6 档里从没设过这两个字段 ⇒ 保持**新默认**（不透明 35% = chrome alpha 0.35，不当成旧档搬值）',
    (() => { reset(); world = loadPlugin({ quiet: true, clientPath: CLIENT, settings: { enabled: true, image: 'stub-wallpaper.png', unifyTint: true, unifyAmount: 4 } }); const c = String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ enabled: true, image: 'stub-wallpaper.png' }) : '') || ''); return /--mpw-chrome-alpha:\s*0\.35\s*[;}]/.test(STRIP(c)) })(),
    '')
  ok('G7 搬值是"唯一入口 + 纯函数"：`mpwAlphaFlipValue()` 就是 `100 - 旧值`（右栏那条的兜底默认值不参与搬值）',
    /mpwAlphaFlipValue/.test(SRC) && /100 - n/.test(SRC) && /const alphaFlip = s0\[MPW_ALPHA_SEM_KEY\] !== MPW_ALPHA_SEM;/.test(SRC))
  ok('G8 变异自证：把搬值公式 `100 - n` 改回 `n`（不搬值）⇒ G1/G2 必红（真源零改动）',
    (() => {
      const m = mutant('alpha-noflip', 'return Number.isFinite(n) ? Math.max(0, Math.min(100, 100 - n)) : void 0;', 'return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : void 0;')
      const cssM = bootLegacy(LEGACY, m)
      return !/--mpw-chrome-alpha:\s*1(\.0+)?\s*[;}]/.test(STRIP(cssM))
    })(), '')
}


/* ══════════════════════════════════════════════════════════════════
   H 组：**无雾层 ⇒ 一个滤镜都不给宿主**（2026-10-04 真机："整屏虚化程度调大时左/右侧边栏
   被叠上一层粉色滤镜；调到 0 就是完全透明的状态"）
   病：真实档（界面透明度 100% + chatFollow 关 + 整屏虚化 40）下，侧栏只剩
   `backdrop-filter: blur(40px) saturate(140%)` —— 我们一个像素都不画，却对**宿主内容**施加了
   模糊 + 饱和 ⇒ 那块壁纸被糊成一片平均色（用户壁纸在那里正是粉的）＝ 他读到的"粉色滤镜"。
   铁律：表面不透明度 ≤ 0 **且** 该项不是用户单独配的（`indep`）⇒ 半径归 0、写 `none`；
   用户显式开过该项自己的磨砂（indep）时照旧给。另：chrome 表面一律不再叠 `saturate(140%)`
   （壁纸层自己已带 contrast(1.06) saturate(1.12)，再乘 1.4 就是"侧栏比屏幕别处更粉"）。
   ══════════════════════════════════════════════════════════════════ */
console.log('\n== H 组：无雾层 ⇒ 不给宿主叠 backdrop-filter（+ chrome 去 saturate）==')
{
  /* 用户真机档：界面透明度 100%（无雾）+ chatFollow 关 + 整屏虚化 40 */
  const NOFOG_ST = { enabled: true, image: true, unifyTint: true, unifyAmount: 40, sidebarAlpha: 100, chatFollow: false, blurFollowUnify: true }
  const cssNoFog = boot(NOFOG_ST)
  const bn = STRIP(cssNoFog)
  /* ⚠️ 只在**真正作用于侧栏**的规则里取读数：`[data-mpw-lg-css]:not([class*="sidebarCol"])`
     这类"选择器里出现 sidebarCol"的规则不算（它打的是液态玻璃元素）。 */
  const sideBlur = (css) => RULES(css).filter(([sel]) => /sidebarCol/.test(sel) && !/data-mpw-lg-css/.test(sel))
    .flatMap(([, body]) => (body.match(/backdrop-filter:\s*([^;]+)/g) || []))
  const sideBlurs = sideBlur(cssNoFog)
  ok('H1 无雾层（界面透明度 100%）⇒ 左栏所有 backdrop-filter 都是 none（我们一个像素都不画时不留滤镜）',
    sideBlurs.length > 0 && sideBlurs.every((d) => /:\s*none(\s*!important)?\s*$/.test(d.trim())),
    // ↑ 允许 `none !important`（本仓统一写法）
    JSON.stringify(sideBlurs.slice(0, 3)))
  ok('H1b 同一档下右栏/dock 的统一虚化半径也是 none（`--mpw-unify-blur` / `--mpw-rs-blur` 不得把 40 传下去）',
    /* 两枚半径 token 都必须是 0px（不得把 40 传下去）；`--mpw-bg-blur`（壁纸层自己的磨砂条）不在本判据内。
       ⚠️ 用**正向**匹配 0px：`/token:\s*(?!0px)/` 会因为 `\s*` 可以先匹配 0 个字符而在"空格+0px"上误判为命中。 */
    /--mpw-unify-blur:\s*0px\b/.test(bn) && /--mpw-rs-blur:\s*0px\b/.test(bn)
    && !/backdrop-filter:\s*blur\(40px\)/.test(bn),
    (bn.match(/--mpw-unify-blur:[^;}]+/) || [''])[0] + ' | ' + (bn.match(/--mpw-rs-blur:[^;}]+/) || [''])[0])
  ok('H2 chrome 表面不再叠 saturate：左栏/右栏/dock 的规则里 0 处 `saturate(140%)`（壁纸层自带 1.12，再乘 1.4 = 比屏幕别处更粉）',
    !/saturate\(140%\)/.test(bn) || !RULES(cssNoFog).some(([sel, body]) => /sidebarCol|sidebar-right-panel|dockkit/.test(sel) && /saturate\(140%\)/.test(body)),
    '')
  /* 有雾档（界面透明度 45 ⇒ 不透明度 55%）⇒ 模糊照给，但同样不带 saturate */
  const cssFog = boot({ enabled: true, image: true, unifyTint: true, unifyAmount: 30, sidebarAlpha: 45, chatFollow: false, blurFollowUnify: true })
  const bf = STRIP(cssFog)
  const blurs = sideBlur(cssFog)
  ok('H3 有雾层（不透明度 55%）⇒ 模糊照给（blur(30px)）且**不含 saturate**（只有模糊，没有色偏）',
    blurs.some((d) => /blur\(30px\)/.test(d)) && !blurs.some((d) => /saturate/.test(d)),
    JSON.stringify(blurs.slice(0, 3)))
  /* 独立档：用户显式开过自己的侧栏磨砂 ⇒ 即使无雾也要照给（他点名要的） */
  const cssOwn = boot(Object.assign({}, NOFOG_ST, { sidebarBlur: true, sidebarBlurAmount: 14, sidebarBlurUserSet: true }))
  const ownBlurs = sideBlur(cssOwn)
  ok('H4 用户显式开过侧栏磨砂（`sidebarBlurUserSet` + 开关开）⇒ 无雾也照给（indep 优先，不被"无雾"规则吞掉）',
    ownBlurs.some((d) => /blur\((14|40)px\)/.test(d)),
    JSON.stringify(ownBlurs.slice(0, 3)))
  /* 标题栏：同一条铁律 */
  const hdrState = (() => {
    reset(); world = loadPlugin({ quiet: true, clientPath: CLIENT, settings: Object.assign({}, NOFOG_ST, { headerBg: true, headerFrostUserSet: false }) })
    try { globalThis.__mpwBuildCss({ enabled: true, image: 'stub-wallpaper.png' }) } catch {}
    try { const T = globalThis.__mpwHdrFrostTest; T.sync(); return T.state() || {} } catch { return {} }
  })()
  ok('H5 标题栏同一条铁律：无雾层 ⇒ 交还宿主（reason 含「无雾层」、injected=false、px=0）',
    String(hdrState.reason || '').includes('无雾层') && hdrState.injected === false && Number(hdrState.px) === 0,
    JSON.stringify({ reason: hdrState.reason, injected: hdrState.injected, px: hdrState.px }))
  /* 变异自证：把"无雾 ⇒ 半径归 0"的判断改坏（`<= 0` → `< 0`）⇒ H1 必红 */
  const m = mutant('nofog-blur', 'surfacePlan.left.opacityPct <= 0 && !surfacePlan.left.indep', 'surfacePlan.left.opacityPct < 0')
  const cssM = boot(NOFOG_ST, m)
  ok('H6 变异自证：`leftNoFog` 判据改坏（`<= 0` → `< 0`）⇒ 左栏又出现 blur(40px)（H1 必红）',
    sideBlur(cssM).some((d) => /blur\(40px\)/.test(d)),
    JSON.stringify(sideBlur(cssM).slice(0, 2)))
}

console.log(`\n===== fog-model: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ 雾模型口径成立：透明度 0 = 完全不覆盖宿主（chrome 覆盖规则 0 处、标题栏交还宿主）、透明度 100 = 一个像素不刷、半径 0 = 真 0、跟随开关真能解耦、未被单独动过的表面与统一值逐字一致')
process.exitCode = fail ? 1 : 0

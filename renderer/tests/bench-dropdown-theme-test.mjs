// bench-dropdown-theme-test.mjs —— 测试台三条真机报障的判据（2026-09-22）
//
// 覆盖用户第 25 / 29 / 12 条（都是"静态可判"的那类：一个未定义函数、一个捕获监听、一个缺省分支）：
//   25 叉掉几张贴后卡住 + `Uncaught ReferenceError: setTypeFilter is not defined`
//      → 根因：`switchToWallpaper` 调的 `setTypeFilter` **全仓从未定义**（重构时丢的）。
//        契约：那条路必须调**产物自己的**切档函数 `driveBundleType`，且全仓不再出现 `setTypeFilter`。
//   29 分辨率下拉里滚轮一滚就把浮层关掉
//      → 根因：捕获阶段的 `scroll ⇒ closeAll(null)` 把**列表自身**的滚动也收了（列表 `overflow-y:auto` 可滚）。
//        契约：捕获监听仍在、非内部滚动仍然 closeAll，但**浮层内部**的滚动要跳过。
//   12 一进 :8902 就是深色主题
//      → 根因：主题规范化对"从没设过"回落到 dark。
//        契约：**没存过 ⇒ light**；显式 dark/light 照办；历史 'auto' 仍按系统偏好迁移一次（旧语义不动）。
//
// 运行：node tests/bench-dropdown-theme-test.mjs   （全过 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'
import { normalizeThemeMode, themePlan, nextThemeMode, resolveTheme } from '../demo/bench-patch.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.log('  ✗ ' + n + (d ? '  [' + d + ']' : '')) } }
const PATCH_RAW = fs.readFileSync(path.join(ROOT, 'demo', 'bench-patch.js'), 'utf8')
/** 剥掉注释后的**代码文本**：判"某个标识符还在不在代码里"必须只看代码 —— 注释里提到它是正常的
 *  （本次修复的注释就写了"旧写法调的 setTypeFilter 从未定义"），拿注释判红会变成自指假红。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const PATCH = stripComments(PATCH_RAW)
const HTML = fs.readFileSync(path.join(ROOT, 'demo', 'index.html'), 'utf8')
const HTML_CODE = stripComments(HTML)

console.log('== 25 未定义函数（`setTypeFilter`）==')
ok('25a 切档那条路调的是产物自己的 `driveBundleType(kind)`',
  /if \(kind && kind !== bundleType\) \{ driveBundleType\(kind\);/.test(PATCH))
ok('25b 全仓不再出现 `setTypeFilter`（调用/定义都不许有 —— 它从未存在过）',
  !/setTypeFilter/.test(PATCH), '命中 ' + (PATCH.match(/setTypeFilter/g) || []).length)
ok('25c `driveBundleType` 真的定义在同一文件（函数声明会提升 ⇒ 前面的调用合法）',
  /function driveBundleType\(type\) \{/.test(PATCH))

console.log('\n== 29 浮层内部滚动 / 与锚点无关的滚动都不该关掉自己 ==')
/* ⚠(2026-09-25 ⑦) **契约收窄**（旧 → 新），理由写在代码里、这里也留一份：
   旧契约只要求"非**内部**的滚动一律 `closeAll(null)`"。但捕获阶段的监听连**与锚点无关**的容器滚动也收得到
   —— 实测（`:8902` 无头门禁）：日志窗 `#logbody` 在场景加载时自己往下跟，250ms 里滚了 4 次，
   同一次展开的读数从"列表在"变成"列表没了" ⇒ 用户看到的就是"下拉点开就没了"。
   新契约：**只有可能移动锚点的滚动源**（视口/文档、或锚点的祖先）才收起；无关容器的滚动不收。
   `resize` 与"浮层内部跳过"两条**逐字保留**（都是加严之外的原意）。 */
/** 29 组四条判据的**具名**正则（D5 拿它们对变异体自证分辨力；不具名就没法证明判据真的在判）。 */
const RE_29A = /addEventListener\('scroll', \(e\) => \{/
const RE_29A_TAIL = /\}, true\)/
const RE_29B = /addEventListener\('scroll', \(e\) => \{[\s\S]{0,900}?for \(const d of dropdowns\)[\s\S]{0,200}?d\.wrap\.contains\(t\)[\s\S]{0,120}?return/
const RE_29B2 = /typeof d\.anchorMoved === 'function' \? d\.anchorMoved\(\) : null[\s\S]{0,300}?scrollAffectsAnchor\(t, d\.btn, doc\)[\s\S]{0,120}?if \(affected\) d\.close\(\)/
/** scroll 处理器**函数体**（从 `addEventListener('scroll', (e) => {` 到收尾的 `}, true)`）。
 *  判据要落在**这一段**里：`resize` 那行紧跟其后、里面本来就有 `closeAll(null)`（合法），
 *  用"往后看 N 个字符"的写法会把 resize 那行也算进来 ⇒ 假红。 */
const scrollBody = (src) => {
  const i = src.indexOf("addEventListener('scroll', (e) => {")
  if (i < 0) return null
  const j = src.indexOf('}, true)', i)
  return j < 0 ? null : src.slice(i, j)
}
const RE_29B3 = { test: (src) => { const b = scrollBody(src); return !!b && /closeAll\s*\(/.test(b) } }
const RE_29C = /addEventListener\('resize', \(\) => closeAll\(null\)\)/
ok('29a 捕获阶段的 scroll 监听仍在（滚动这件事本身仍然盯着 —— 这条没被放宽）',
  RE_29A.test(PATCH) && RE_29A_TAIL.test(PATCH))
ok('29b 处理器**先**判"事件源在某个已登记浮层内部"并 return（用户第 29 条那条契约逐字保留）',
  RE_29B.test(PATCH))
ok('29b2 ⑦收起**只对"真的动到了锚点"的滚动**发生（先判锚点 rect：`d.anchorMoved()`；无法判定时退回纯函数 `scrollAffectsAnchor(t, d.btn, doc)`）',
  RE_29B2.test(PATCH))
/* ⚠⑦(2026-09-25) 追加判据：`anchorMoved()` 必须真在 `bindDropdown` 里实现（而不是处理器里写个恒 null 的占位），
   且浮层坐标那一刻记下 rect —— 否则"先滚动后展开"的异步时序坑会回来（门禁 M7 实测红过）。 */
ok('29b4 ⑦`anchorMoved()` 真有实现：展开/定位时记 `anchorRect`，比较时容差 0.5px，无法判定返回 `null`',
  /let anchorRect = null/.test(PATCH) && /anchorRect = \{ left: rect\.left, top: rect\.top, width: rect\.width, height: rect\.height \}/.test(PATCH)
  && /const anchorMoved = \(\) => \{[\s\S]{0,420}?!anchorRect \|\| typeof btn\.getBoundingClientRect !== 'function'[\s\S]{0,120}?return null[\s\S]{0,220}?> 0\.5/.test(PATCH)
  && /const api = \{ sel, wrap, btn, list, label, open, close, position, anchorMoved,/.test(PATCH))
ok('29b3 旧的**无条件** `closeAll(null)` 已不在 scroll 处理器里（那正是"日志窗自己滚就点开没了"的写法）',
  !RE_29B3.test(PATCH))
ok('29c resize 那条保持原样（窗口改尺寸时浮层仍要收起：坐标会脱开）',
  RE_29C.test(PATCH))
ok('29d 下拉列表自身可滚（`overflow-y:auto` + 限高）—— 这正是"一滚滚轮就关"能发生的物理前提',
  /\.bench-rd-list\{[^}]*overflow-y:auto/.test(HTML) || /\.bench-rd-list\{[^}]*overflow-y:auto/.test(PATCH))
{
  const m = await import(pathToFileURL(path.join(ROOT, 'demo', 'mpw-select-math.mjs')).href)
  const doc = { documentElement: { name: 'html' }, body: { name: 'body' } }
  const mid = { name: 'mid', parentElement: { name: 'outer', parentElement: null } }
  const btn = { name: 'btn', parentElement: mid }
  ok('29e 视口/文档滚动 ⇒ 收起（`document` / `documentElement` / `body` 三种事件目标都算）',
    [doc, doc.documentElement, doc.body].every((t) => m.scrollAffectsAnchor(t, btn, doc) === true))
  ok('29f 锚点祖先（含锚点自己）滚动 ⇒ 收起（原意：浮层会与锚点脱开）',
    m.scrollAffectsAnchor(mid.parentElement, btn, doc) === true
    && m.scrollAffectsAnchor(mid, btn, doc) === true
    && m.scrollAffectsAnchor(btn, btn, doc) === true)
  ok('29g 兄弟容器 / 日志窗这类**与锚点无关**的滚动 ⇒ **不收**（本次修复的判据本身）',
    m.scrollAffectsAnchor({ name: 'logbody' }, btn, doc) === false
    && m.scrollAffectsAnchor({ name: 'other' }, null, doc) === false
    && m.scrollAffectsAnchor(null, btn, doc) === false)
}

console.log('\n== 12 主题缺省 = 浅色（纯函数口径）==')
ok('12a **从没设过** ⇒ light（null / undefined / 空串都算没设过）',
  normalizeThemeMode(null, true) === 'light' && normalizeThemeMode(undefined, true) === 'light' && normalizeThemeMode('', true) === 'light',
  JSON.stringify([normalizeThemeMode(null, true), normalizeThemeMode(undefined, true), normalizeThemeMode('', true)]))
ok('12b 系统偏好是深色也仍然是 light（"缺省浅色"与系统无关 —— 这是用户要的默认）',
  normalizeThemeMode(null, true) === 'light' && normalizeThemeMode(null, false) === 'light')
ok('12c 显式 dark / light 照办（用户在设置里选过的不能被覆盖）',
  normalizeThemeMode('dark', false) === 'dark' && normalizeThemeMode('light', true) === 'light')
ok('12d 历史值 `auto` 仍按系统偏好**迁移一次**（旧语义逐位保留，不是被我一起改掉）',
  normalizeThemeMode('auto', true) === 'dark' && normalizeThemeMode('auto', false) === 'light')
ok('12e 非法值（垃圾字符串）也落到 light（与"没设过"同支）',
  normalizeThemeMode('nonsense', true) === 'light')
ok('12f `themePlan` 与实际生效 theme 自洽（light ⇒ data-theme=light）',
  themePlan(null, true).mode === 'light' && themePlan(null, true).theme === 'light' && resolveTheme('light', true) === 'light')
ok('12g 点击循环仍是两态（light ⇄ dark），没有被改成三态',
  nextThemeMode('light') === 'dark' && nextThemeMode('dark') === 'light')

console.log('\n== 26 配置按钮"选中"必须=真的展开且有内容 ==')
ok('26a 按下态由"未收起 **且** 属性表真有行"决定（旧写法只看收起与否 ⇒ 新加载壁纸时亮蓝底却是空的）',
  /let hasRows = false/.test(PATCH) && /c\.dataset && c\.dataset\.benchPropsEmpty/.test(PATCH) && /const on = !want && hasRows/.test(PATCH))
ok('26b 我们插的空态带 `data-bench-props-empty` 标记（不给空态也算"有行"）',
  /benchPropsEmpty/.test(PATCH))
ok('26c `aria-pressed` 与 `checked` 都由这同一个 `on` 写（两处不许各判一套）',
  /propsToggleBtn\.classList\.toggle\('checked', on\)/.test(PATCH) && /propsToggleBtn\.setAttribute\('aria-pressed', on \? 'true' : 'false'\)/.test(PATCH))

console.log('\n== 27 页签全叉光 ⇒ 属性面板必须清空 ==')
ok('27a `closeWallpaperTab` 里判"一个都不剩"（没打开项、没当前项，**且列表里没有 `.active`**）',
  /const noneLeft = \(\) => !\(Array\.isArray\(pinned\) && pinned\.length\) && !curId/.test(PATCH)
  && /querySelector\('#list li\.active'\)/.test(PATCH))
ok('27b 清空是**延迟一拍再判定**（切档瞬间 curId/pinned 都可能是空的 ⇒ 立刻清会误清新那张的面板）',
  /if \(noneLeft\(\)\) setTimeout\(\(\) => \{ try \{ if \(noneLeft\(\)\) \{ clearPropsBody\(\); paintPropsEmpty\(\) \}/.test(PATCH))
ok('27c 清空发生在落盘之后（用的是刚写回的 `pinned`/`curId`，不是旧的）',
  PATCH.indexOf('writePinned(plan.pinned)') < PATCH.indexOf('const noneLeft ='))

console.log('\n== 9 重挂载后音量要按当前档位重放（唯一落点不复制）==')
ok('9a 音量唯一落点被引到模块级（`applyAudio` 仍在 initNavSound 闭包内定义，只做引用转发）',
  /let MPW_APPLY_AUDIO = null/.test(PATCH) && /try \{ MPW_APPLY_AUDIO = applyAudio \}/.test(PATCH)
  && (PATCH.match(/function applyAudio\(\)/g) || []).length === 1)
ok('9b iframe `load` 后按当前档位重放两次（300ms / 1200ms —— 渲染器建媒体是异步的）',
  /setTimeout\(\(\) => \{ try \{ if \(MPW_APPLY_AUDIO\) MPW_APPLY_AUDIO\(\) \} catch \(e\) \{\} \}, 300\)/.test(PATCH)
  && /\}, 1200\)/.test(PATCH))

console.log('\n== 10 属性面板滑动条样式（补丁表 + 静态镜像同文）==')
ok('10a 三条规则在补丁表里（轨道 4px 圆角 / WebKit 滑块 / Firefox 滑块；appearance:none）',
  /'#props-body input\[type=range\],#props input\[type=range\]\{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:999px/.test(PATCH)
  && /::-webkit-slider-thumb/.test(PATCH) && /::-moz-range-thumb/.test(PATCH))
ok('10b 静态镜像同文（逐条加 `html.bench-shell ` 前缀；`demo-check` D8 是本条的端到端兜底）',
  (HTML_CODE.match(/html\.bench-shell #props-body input\[type=range\]/g) || []).length >= 2
  && /html\.bench-shell #props-body input\[type=range\]::-webkit-slider-thumb/.test(HTML_CODE)
  && /html\.bench-shell #props-body input\[type=range\]::-moz-range-thumb/.test(HTML_CODE))

console.log('\n== D 分辨力自证：把三处改回旧写法必红 ==')
ok('D1 旧写法（`setTypeFilter`）一旦回到代码里，25b 立刻红 —— 这里证明该判据确实在扫"代码"（注释不算）',
  /setTypeFilter/.test(stripComments('switchToWallpaper(): setTypeFilter(kind)')) && !/setTypeFilter/.test(PATCH)
  && /setTypeFilter/.test(PATCH_RAW))   // 注释里提到它是允许的（本次修复的注释就是这么写的）
ok('D2 旧的主题缺省（回落 dark）在 12a 下必红：模拟旧函数',
  (() => { const old = (saved) => (String(saved == null ? '' : saved) === 'light' ? 'light' : 'dark'); return old(null) === 'dark' && normalizeThemeMode(null, true) === 'light' })())
/** 分辨力自证用的两个**变异体**（只在这条测试里当字符串用；真树一个字都不动）：
 *  · old  = 2026-09-22 之前/之后的旧契约写法（滚动 ⇒ 无条件 closeAll）—— 29b3 必须判它红；
 *  · dead = 退化成"根本不看滚动"（连监听都不挂）—— 29a 必须判它红。
 *  两个方向都堵上，才能证明这组判据不是"只要写点相关字样就绿"。 */
const MUT_SCROLL_OLD = "addEventListener('scroll', (e) => { const t = e.target\n"
  + "  if (t) { for (const d of dropdowns) { if (d.wrap.contains(t)) return } }\n"
  + "  closeAll(null)\n}, true)"
const MUT_SCROLL_DEAD = "addEventListener('resize', () => closeAll(null))"
ok('D3 ★ 分辨力：旧写法（scroll ⇒ 无条件 closeAll）被 29b2/29b3 判红，而真树是绿的',
  !RE_29B2.test(MUT_SCROLL_OLD) && RE_29B3.test(MUT_SCROLL_OLD) && RE_29B2.test(PATCH) && !RE_29B3.test(PATCH))
ok('D3b ★ 分辨力：「根本不看滚动」的写法被 29a 判红（防"删掉监听也绿"）',
  !RE_29A.test(MUT_SCROLL_DEAD) && RE_29A.test(PATCH) && RE_29C.test(MUT_SCROLL_DEAD))

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 测试台三条（未定义函数 / 浮层内部滚动 / 主题缺省）通过：接线正确 + 纯函数口径 + 各有分辨力')
process.exit(fail > 0 ? 1 : 0)

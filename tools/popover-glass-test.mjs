// tools/popover-glass-test.mjs —— 弹层玻璃"三条路"分类的判据（2026-10-05 v3：去截断 + 补霜）
//
// 设计（真机迭代到 v3 的收口版；宿主元素一个都不碰语义，只"摘一个属性 + 垫一层自己的霜层"）：
//   A 无模糊祖先（挂在 body 下的模型/推理选择器）⇒ 我们自己的 58% 表面 + 自己的 blur；
//   B 祖先里有模糊、且那是我们自己的弹层装饰 或 已知包装容器（输入框卡片 / 菜单容器）⇒
//     给该祖先打 data-mpw-pop-untrunc（静态 !important 规则把它的 backdrop-filter 摘掉 ⇒ backdrop root
//     回到整页，**弹层自己的 blur 立刻采样得到页面**，连被弹层压住的目标条一起糊），
//     同时在它内部垫一层 data-mpw-pop-frost（inset:0 + z-index:-1 + 沿用原 blur）⇒ 容器自己的磨砂一点没少；
//   C 祖先里有模糊但不是包装容器（用户正在看的面板 / 未知 / 静态元素）⇒ 什么都不摘，弹层打
//     data-mpw-pop-trunc（88% 实底）。
//
// 为什么 v2 的「根级模糊层」被删掉（真机读数 tools/host-popover-probe.mjs --groups glass-placement）：
//   层挂卡片子树里 ⇒ backdrop root 被卡片截断（观感 = "只剩白色半透明，模糊没了"）；
//   层挂 body（任何 z）⇒ elementsFromPoint 命中栈显示它压在整个弹层之上（弹层在卡片的层叠上下文里）。
//
// 本文件同时钉死两条**反自激**判据（真机"底色时有时无"的根因）：
//   ① 分类的硬前提放行"已带标记"的表面（C 类规则会把表面的 backdrop-filter 撤成 none，
//      只认 computed blur ⇒ 打标/撤标逐帧自激）；已被我们去截断的祖先照样算截断祖先；
//   ② 兜底底标记把**当初的理由**写进属性值（empty/painted），复核只走结构性判据、绝不重读底色
//      （否则会读到我们自己画的那层 58% ⇒ 撤标 ⇒ 宿主底回来 ⇒ 再打标）。
//
// 用法: node tools/popover-glass-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

const registry = []
const installShim = () => {
  const attrSel = (sel) => { const m = /^\[([^\]=~^$|]+)\]$/.exec(String(sel).trim()); return m ? m[1].trim() : null }
  const allEls = () => { const out = []; const walk = (e) => { for (const c of (e.children || [])) { out.push(c); walk(c) } }; try { walk(globalThis.document.body) } catch (e) {} ; return out }
  globalThis.document.querySelectorAll = (sel) => { const a = attrSel(sel); if (a) return allEls().filter((el) => el.hasAttribute && el.hasAttribute(a)); return [] }
  globalThis.document.querySelector = (sel) => globalThis.document.querySelectorAll(sel)[0] || null
  const base = globalThis.getComputedStyle
  globalThis.getComputedStyle = (el) => {
    if (el && el.__cs) { const d = Object.assign({}, base(el)); for (const k of Object.keys(el.__cs)) d[k] = el.__cs[k]; return d }
    return base(el)
  }
  /* 走宿主弹层的元素要有可量的矩形（mpwPopIsFloating 的面积闸门）+ 视口尺寸 + body 透明底
     （桩的 getComputedStyle 是固定对象：不补这两项，"宿主自己没画底"那条路根本走不到） */
  globalThis.innerWidth = 1024
  globalThis.innerHeight = 768
  globalThis.document.body.__cs = { backgroundColor: 'rgba(0, 0, 0, 0)' }
}
/** body > anc(blur[, bg]) > surface[data-mpw-pop-bg](blur)；anc 是"定位元素"（去截断要求它给霜层当层叠上下文） */
const buildChain = (ancCls, ancBg, surfaceBlur = 'blur(11px)', ancExtra = {}) => {
  /* 上一轮的 surface 从 DOM 摘掉（真实场景里 React 卸载弹层就是这样）⇒ 生产侧按 isConnected 撤层 */
  for (const el of registry.slice()) { try { if (el.parentElement) el.parentElement.removeChild(el) } catch (e) {} }
  registry.length = 0
  const body = globalThis.document.body
  const anc = globalThis.document.createElement('div'); anc.className = ancCls
  const surface = globalThis.document.createElement('div'); surface.className = '_3e4SsG_menu'; surface.setAttribute('data-mpw-pop-bg', 'empty')
  anc.__cs = Object.assign({ backdropFilter: 'blur(14px)', backgroundColor: ancBg || 'rgba(0, 0, 0, 0)', position: 'relative', zIndex: 'auto', borderTopLeftRadius: '22px' }, ancExtra)
  surface.__cs = { backdropFilter: surfaceBlur }
  body.appendChild(anc); anc.appendChild(surface); registry.push(anc, surface)
  for (const el of [anc, surface]) {
    el.matches = (sel) => {
      const s2 = String(sel || '')
      if (s2 === '[data-mpw-pop-untrunc]') return el.hasAttribute('data-mpw-pop-untrunc')
      if (/JObwrW_panel|_menu|_popover|_denseList/.test(s2)) return !!el.__inPopSet
      const m = /^\[([^\]=~^$|]+)\]$/.exec(s2.trim()); return m ? el.hasAttribute(m[1].trim()) : false
    }
  }
  return { anc, surface }
}
/** body 下孤零零一个表面（A 类：没有模糊祖先） */
const buildLone = (blur = 'blur(11px)') => {
  for (const el of registry.slice()) { try { if (el.parentElement) el.parentElement.removeChild(el) } catch (e) {} }
  registry.length = 0
  const s = globalThis.document.createElement('div'); s.className = '_list_1nxmc_8'
  s.setAttribute('data-mpw-pop-bg', 'empty'); s.__cs = { backdropFilter: blur }
  s.matches = () => false
  globalThis.document.body.appendChild(s); registry.push(s)
  return s
}
const frostOf = (anc) => Array.from(anc.children || []).find((c) => c.hasAttribute && c.hasAttribute('data-mpw-pop-frost')) || null

console.log('== A 组：静态接线 ==')
ok('A1 分类器在、且旧「根级模糊层」已删除（无 mpwPopGlassApply / 无 glass-layer 元素）',
  CLIENT.includes('function mpwPopClassifySync()') && CLIENT.includes('function mpwPopUntruncApply(')
  && !CLIENT.includes('mpwPopGlassApply') && !CLIENT.includes('data-mpw-pop-glass-layer'))
ok('A2 三条路的判据齐备：表面集合 + 自己的装饰/包装容器白名单 + 实底标记 + 去截断表',
  CLIENT.includes('p.matches(MPW_POP_TAG_SEL)')
  && CLIENT.includes('wrap = declared || isOurDeco || /(_card|composer|overlayAnchor|_seat|_stack)/i.test(String(p.className || ""))')
  && CLIENT.includes('truncated.add(el)') && CLIENT.includes('glasses.add(el)')
  && CLIENT.includes('neutralize.add(p)') && CLIENT.includes('function mpwPopCanCtx('))
ok('A3 去截断规则：双属性提特异性 + 我们自己的表面规则把它排除（否则自己的 blur 规则会压制它）',
  /html body \[data-mpw-pop-untrunc\]\[data-mpw-pop-untrunc\] \{/.test(CLIENT)
  && /:not\(\[data-mpw-pop-untrunc\]\)`;/.test(CLIENT))
ok('A4 补霜层：容器内 inset:0 + z-index:-1 + 沿用原 blur（绝对定位 ⇒ 不需要随滚动/缩放重贴）',
  /data-mpw-pop-frost/.test(CLIENT)
  && /position:absolute;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none/.test(CLIENT)
  && /border-radius:" \+ rec.radius \+ ";backdrop-filter:" \+ rec.bf/.test(CLIENT)
  && !/position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none/.test(CLIENT))
ok('A5 反自激①：分类硬前提放行已带标记的表面；已被去截断的祖先照样算截断祖先',
  CLIENT.includes('const marked = el.hasAttribute("data-mpw-pop-glass") || el.hasAttribute("data-mpw-pop-trunc");')
  && CLIENT.includes('const declared = !!(p.hasAttribute && p.hasAttribute("data-mpw-pop-untrunc"));'))
ok('A6 反自激②：兜底底标记把理由写进属性值、复核只走结构性判据（不再重读底色）',
  CLIENT.includes('const reason = el.getAttribute("data-mpw-pop-bg");')
  && CLIENT.includes('if (reason === "empty") { need = !mpwPopHasPaintedAncestor(el); why = "empty" }')
  && CLIENT.includes('else if (reason === "painted") { need = mpwPopIsFloating(el); why = "painted" }'))
/* ①(2026-10-09 DSH 0.2.0) 宿主新菜单自带**内层 material 底**（._material_ri079_21，58% + 自家 blur40）：
   我们再垫一层自己的 58% ⇒ 叠成 ≈82% 近白（真机："白、没模糊"）。以下三条是**不许改坏**的护栏：
   ① 判据必须存在（属性优先，宿主声明 data-menu-material 就撤我们的底）；
   ② CSS 兜底不许把 material 家族再刷上我们的表面 token（防"表面先插入那一帧"）；
   ③ Token 用量 / 会话统计（bRhRbq_panel，role=dialog）维持宿主白底：走 --mpw-surface-panel，
      不许被 pop-bg / trunc 那两条接管（用户明确说这两块现在是正常效果）。 */
ok('M1 宿主 material 菜单不再叠我们的底（data-menu-material 判据在位 + sticky 复核只走结构判据）',
  CLIENT.includes('data-menu-material') && CLIENT.includes('mpwPopHostMaterial')
  && CLIENT.includes('if (el.hasAttribute && el.hasAttribute("data-menu-material")) { need = false; why = "host-material" }'))
ok('M2 CSS 兜底把 material 家族排除在我们的兜底底之外（:not([data-menu-material])）',
  CLIENT.includes('[data-mpw-pop-bg]:not([data-menu-material])')
  && CLIENT.includes('[data-ds-dark-theme] [data-mpw-pop-bg]:not([data-menu-material])'))
ok('M3 Token 用量 / 会话统计（role=dialog）仍走宿主面板白底，不被 pop-bg/trunc 接管',
  /\[role="dialog"\][^{]*\{[^}]*--mpw-surface-panel/.test(CLIENT) || CLIENT.includes('--mpw-surface-panel'))

/* ①(2026-10-09 DSH 0.2.0) E/I 的"不许改坏"钉子：用户明确说下面两块现在是**想要的效果**，
   所以我们**一个字符都不许碰**（今天事实上就是 0 命中，这两条断言把它钉死；将来真要接管
   必须先删掉断言并写明理由 —— 让"改坏"必须是一次显式决定，而不是顺手）。 */
ok('M4 目标条（nLMEza_bar）不在我们的任何 CSS/JS 里（用户说它现在就是要的效果）',
  !/nLMEza/.test(CLIENT))
/* ①(2026-10-09 用户第三批第 2 项：'会话统计和 token 用量的地方，它的模糊好像也是没有生效的')
   ⇒ 这是**显式决定**要接管：真机读数原本是 bg=rgb(255,255,255)（不透明）⇒ 宿主自带 blur(40px)
   一点都看不见；现在换成霜化底（--mpw-surface-panel-frost 80%）+ 常量 blur(11px)。
   断言随之改向：钉**新**行为（这两块必须走霜化表面），而不是"零接管"。 */
/* ②(2026-10-10 第四批真机) 用户报"会话统计 / Token 用量弹框里的 grid 容器是纯白、没有模糊"。
   真机 + 宿主 CSS 定案：`dl.bRhRbq_details` 与 `._7KE1Ra_cell/_option/_groups` 在宿主里全是
   `background:0 0`（自己不画底）⇒ 白是**我们叠出来的**：面板已经 80% 霜化，内层再刷 80%
   ⇒ 合成 96% ≈ 纯白。断言随之改向"**内层不吃我们的底**、只有面板本身霜化"，
   并钉住另外两条本次修复：团队面板 ::before 实心底中和、外层已玻璃时内层不吃兜底底。 */
ok('M5 弹框内层不再叠白底：dl[data-session-stats-*] 不被我们刷底，面板本身仍霜化；团队面板 ::before 已中和；内层兜底底有祖先判据',
  !/^[ \t]*html body \[data-session-stats-(usage|details)\][^{]*\{[^}]*--mpw-surface-panel-frost/m.test(CLIENT)
  && /^[ \t]*html body \[class\*="bRhRbq_panel"\][^{]*\{[^}]*--mpw-surface-panel-frost/m.test(CLIENT)
  && CLIENT.includes('[data-team-panel]::before')
  && CLIENT.includes('mpwPopInsideMenuShell')
  && CLIENT.includes('[data-team-panel]::before,'))

/* ②(2026-10-10 第五批真机) 用户报"有壁纸时加号菜单/子代理树只剩白底、没模糊"。机制：这两类弹层
   落在我们自己的玻璃祖先里（卡片 blur14/侧栏/面板）⇒ 自己的 blur 采样不到页面；而主路去截断只扫
   [data-mpw-pop-bg]，宿主 material 菜单按 H 判据**故意没有**这个标记 ⇒ 永远不去截断。
   这里钉住新加的**专用趟**的三条纪律：只加不删（不能重演上轮把 B1 输入框卡片 case 弄坏的那次）、
   只处理最近一个带 blur 的祖先、绝不参与 glasses/truncated 打标（否则又会给它们叠一层我们的底）。 */
ok('M6 专用去截断趟：宿主 material 菜单 / 触发候选菜单 / 子代理树都进 need，且只加不删',
  CLIENT.includes('function mpwPopUntruncExtra(')
  && /mpwPopUntruncExtra\(neutralize\)[\s\S]{0,80}mpwPopUntruncApply\(neutralize\)/.test(CLIENT)
  && /function mpwPopUntruncExtra[\s\S]{0,4000}?need\.add\(p\)/.test(CLIENT)
  && !/function mpwPopUntruncExtra[\s\S]{0,4000}?glasses\.add/.test(CLIENT)
  && !/function mpwPopUntruncExtra[\s\S]{0,4000}?truncated\.add/.test(CLIENT))
ok('M7 子智能体会话树只补模糊、不补底（ZKlsPq_menu 进模糊规则，不进底色规则）',
  /html body :is\(\$\{popTreeSel\}\),\n\$\{popSurfaceSel\} \{/.test(CLIENT)
  && !/popSurfaceCss = \(popAlphaUserSet[\s\S]{0,400}popTreeSel/.test(CLIENT))
/* ③(2026-10-10 真机层次读数定案) 用户："外面的圆角那圈模糊正常，里面有一个直角的矩形又是白的"。
   读数为证：宿主 material 菜单里 `._7KE1Ra_groups[role="menu"]` 是 **radius 0** 的滚动容器，
   而我们那条 `[role="menu"]` 弹层规则把 blur 打在了它身上 ⇒ 它把身后的 58% 白底在方形区域内
   又糊一遍。修法：外层已是 material 外壳时，内层容器统一打 data-mpw-menu-inner，并从
   **底色与模糊两条规则**里排除（两层都钉住，防止将来只改一条）。 */
ok('M8 material 外壳里的内层容器（直角滚动容器）被一条 !important 规则直接中和（只加不改既有规则）',
  CLIENT.includes('data-mpw-menu-inner')
  && /html body \[data-mpw-menu-inner\](?:\[data-mpw-menu-inner\]){2,3} \{[\s\S]{0,200}backdrop-filter: none !important/.test(CLIENT)
  && /querySelectorAll\('\[data-menu-material\], \[data-trigger-menu\], \[class\*="ZKlsPq_menu"\]'\)/.test(CLIENT))

ok('A7 提示气泡不接管底色（深底浅字的宿主气泡：我们压上去就成白字看不清）',
  /el.getAttribute\("role"\) === "tooltip"/.test(CLIENT))
ok('A8 会话里掉帧：快路不再夹带全文档扫描（mpwSideLiftSync 只在节流的重活路径里）',
  (() => {
    const i = CLIENT.indexOf('function mpwTagPopoverFast(')
    const j = CLIENT.indexOf('function mpwTagOnePopover(')
    return i > 0 && j > i && !CLIENT.slice(i, j).includes('try { mpwSideLiftSync() }')
  })()
  && CLIENT.includes('const popHeavyTail = () => {') && CLIENT.includes('if (since >= 150 && (!mpwHeavyAnimRunning() || since >= 600)) popHeavySync();'))

console.log('== B 组：三条路的行为 ==')
reset()
loadPlugin({ quiet: true, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
installShim()
const H = globalThis.__mpwPopUntruncTest
ok('B0 出口就位（sync / untruncCount / frostCount / truncCount / tag）',
  !!H && typeof H.sync === 'function' && typeof H.untruncCount === 'function'
  && typeof H.frostCount === 'function' && typeof H.truncCount === 'function' && typeof H.tag === 'function')
{
  const { anc, surface } = buildChain('uV2eYG_card', 'rgba(255, 255, 255, 0.55)')
  H.sync()
  const frost = frostOf(anc)
  ok('B1 包装容器（输入框卡片）⇒ 容器打 data-mpw-pop-untrunc、霜层补回它的 blur、弹层打 glass 标记',
    anc.hasAttribute('data-mpw-pop-untrunc') && !!frost
    && /blur\(14px\)/.test(String(frost.style.backdropFilter || frost.style.cssText))
    && surface.hasAttribute('data-mpw-pop-glass') && !surface.hasAttribute('data-mpw-pop-trunc'),
    'untrunc=' + H.untruncCount() + ' frost=' + H.frostCount())
  ok('B2 去截断要给霜层的 z-index:-1 兜住 ⇒ 给定位容器补 z-index:0（不改它原有的绘制次序）',
    anc.style.zIndex === '0' && /z-index:-1/.test(String(frost.style.cssText)), 'anc.z=' + anc.style.zIndex + ' frost=' + String(frost.style.cssText).slice(0, 120))
  H.sync(); H.sync()
  const frost2 = frostOf(anc)
  ok('B3 反自激①：连跑三次分类，标记/去截断/霜层**都还在**（旧版这里会逐帧打-撤-打）',
    surface.hasAttribute('data-mpw-pop-glass') && anc.hasAttribute('data-mpw-pop-untrunc')
    && H.untruncCount() === 1 && H.frostCount() === 1 && frost2 === frost, 'frost稳定=' + (frost2 === frost))
  surface.removeAttribute('data-mpw-pop-bg')
  H.sync()
  ok('B4 弹层关闭 ⇒ 去截断与霜层全撤、容器的 inline z-index 还原（不留残留）',
    !anc.hasAttribute('data-mpw-pop-untrunc') && !frostOf(anc) && anc.style.zIndex === ''
    && H.untruncCount() === 0 && H.frostCount() === 0, 'z=' + JSON.stringify(anc.style.zIndex))
}
{
  const { anc, surface } = buildChain('_3e4SsG_menu', 'rgba(0, 0, 0, 0)')
  anc.__inPopSet = true                                   // 它是我们自己的弹层装饰（blur 是我们给的）
  H.sync()
  ok('B5 祖先是我们自己的弹层装饰（未打底标记）⇒ 同样走去截断（它的 blur 本来就是我们刷的）',
    anc.hasAttribute('data-mpw-pop-untrunc') && surface.hasAttribute('data-mpw-pop-glass'), '')
  surface.removeAttribute('data-mpw-pop-bg'); H.sync()
}
{
  const { anc, surface } = buildChain('JObwrW_panel', 'rgba(255, 255, 255, 0.5)')
  anc.__inPopSet = true; anc.setAttribute('data-mpw-pop-bg', 'painted')   // 祖先自己是"用户正在看的面板"
  H.sync()
  ok('B6 祖先自己是弹层表面（子代理展开框一类）⇒ 祖先不动、弹层改实底 data-mpw-pop-trunc',
    surface.hasAttribute('data-mpw-pop-trunc') && !surface.hasAttribute('data-mpw-pop-glass')
    && !anc.hasAttribute('data-mpw-pop-untrunc'), '')
  H.sync()
  ok('B7 反自激①：C 类实底把表面 backdrop-filter 撤成 none，第二轮不许把标记摘掉（旧版在这里闪）',
    surface.hasAttribute('data-mpw-pop-trunc'), '')
  surface.removeAttribute('data-mpw-pop-bg'); H.sync()
}
{
  const { anc, surface } = buildChain('unknown-panel', 'rgba(0, 0, 0, 0.2)')
  H.sync()
  ok('B8 未知的模糊祖先 ⇒ 保守走实底（不摘容器、不垫霜层）',
    surface.hasAttribute('data-mpw-pop-trunc') && !anc.hasAttribute('data-mpw-pop-untrunc') && H.untruncCount() === 0, '')
  surface.removeAttribute('data-mpw-pop-bg'); H.sync()
}
{
  const { anc, surface } = buildChain('uV2eYG_card', 'rgba(255, 255, 255, 0.55)', 'blur(11px)', { position: 'static' })
  H.sync()
  ok('B9 静态祖先不碰（给它 position:relative 会改包含块、把宿主弹层带跑）⇒ 退回实底',
    surface.hasAttribute('data-mpw-pop-trunc') && !anc.hasAttribute('data-mpw-pop-untrunc'), '')
  surface.removeAttribute('data-mpw-pop-bg'); H.sync()
}
{
  const s = buildLone()
  H.sync()
  ok('B10 无模糊祖先（body 下的模型/推理选择器）⇒ 既不打 glass 也不打 trunc（用它自己的 58% + blur）',
    !s.hasAttribute('data-mpw-pop-glass') && !s.hasAttribute('data-mpw-pop-trunc') && H.untruncCount() === 0, '')
  s.removeAttribute('data-mpw-pop-bg'); H.sync()
}
{
  const { surface } = buildChain('uV2eYG_card', 'rgba(255, 255, 255, 0.55)', 'none')
  surface.removeAttribute('data-mpw-pop-bg')
  H.sync()
  ok('B11 硬前提：表面自己没模糊、也没带标记 ⇒ 什么都不做（别去摘人家的容器）',
    !surface.hasAttribute('data-mpw-pop-glass') && !surface.hasAttribute('data-mpw-pop-trunc') && H.untruncCount() === 0, '')
}
{
  const { anc, surface } = buildChain('uV2eYG_card', 'rgba(255, 255, 255, 0.55)')
  surface.setAttribute('role', 'tooltip')
  H.sync()
  ok('B12 提示气泡（role=tooltip）⇒ 不接管：既不摘容器、也不做实底（白字必须留在宿主的深底上）',
    !surface.hasAttribute('data-mpw-pop-glass') && !surface.hasAttribute('data-mpw-pop-trunc') && !anc.hasAttribute('data-mpw-pop-untrunc'), '')
  surface.removeAttribute('role'); surface.removeAttribute('data-mpw-pop-bg'); H.sync()
}

console.log('== C 组：兜底底标记器（闪烁 = 打标/撤标自激）==')
{
  const el = buildLone()
  el.__cs = { backdropFilter: 'blur(11px)', backgroundColor: 'rgb(255, 255, 255)' }   // 宿主画了不透明底
  el.removeAttribute('data-mpw-pop-bg')
  const t1 = H.tag(el)
  const tagged = el.getAttribute('data-mpw-pop-bg')
  /* 我们自己画上的那层（真浏览器里它 computed 成 color(srgb 0.976 0.980 0.984 / 0.58)；这里用
     等价的可解析写法 rgba(…, 0.58)，好让"重读底色⇒撤标"这条错法**能被变异测试抓到**） */
  el.__cs = { backdropFilter: 'blur(11px)', backgroundColor: 'rgba(249, 250, 251, 0.58)' }
  const t2 = H.tag(el)
  ok('C1 宿主不透明底 ⇒ 打标并把理由记为 painted；下一轮读到"我们自己画的 58%"时**不许撤标**',
    t1 === true && tagged === 'painted' && el.getAttribute('data-mpw-pop-bg') === 'painted' && t2 === false,
    'why=' + tagged + ' 第二轮改动=' + t2)
  const tip = buildLone()
  tip.setAttribute('role', 'tooltip'); tip.removeAttribute('data-mpw-pop-bg')
  tip.__cs = { backdropFilter: 'blur(11px)', backgroundColor: 'rgb(255, 255, 255)' }
  ok('C2 提示气泡永不打标（宿主深底浅字，我们一接管就白字看不清）', H.tag(tip) === false && !tip.hasAttribute('data-mpw-pop-bg'), '')
  for (const e of [el, tip]) e.removeAttribute('data-mpw-pop-bg')
  H.sync()
}
console.log('== D 组：变异自证（真源零改动）==')
const loadMutant = (from, to) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pop-glass-'))
  const mut = CLIENT.replace(from, to)
  if (mut === CLIENT) throw new Error('变异锚点缺失：' + from.slice(0, 40))
  const p = path.join(dir, 'client.js'); fs.writeFileSync(p, mut)
  reset()
  loadPlugin({ quiet: true, clientPath: p, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
  installShim()
  return globalThis.__mpwPopUntruncTest
}
{
  /* 变异①：兜底底标记器不再按"当初的理由"复核（退回重读底色）⇒ 第二轮就会撤掉刚打的标记 */
  const MH = loadMutant('else if (reason === "painted") { need = mpwPopIsFloating(el); why = "painted" }',
    'else if (false) { need = mpwPopIsFloating(el); why = "painted" }')
  const el = buildLone()
  el.__cs = { backdropFilter: 'blur(11px)', backgroundColor: 'rgb(255, 255, 255)' }
  el.removeAttribute('data-mpw-pop-bg')
  MH.tag(el)
  el.__cs = { backdropFilter: 'blur(11px)', backgroundColor: 'rgba(249, 250, 251, 0.58)' }
  MH.tag(el)
  ok('D1 把"按当初的理由复核"改坏 ⇒ 第二轮就把刚打的标记撤了（C1 必红：这就是真机闪烁）',
    !el.hasAttribute('data-mpw-pop-bg'), '')
  el.removeAttribute('data-mpw-pop-bg')
}
{
  /* 变异②：分类硬前提不再放行"已带标记"的表面 ⇒ C 类把表面 blur 撤掉后，下一轮判成 A 而摘标记 */
  const MH = loadMutant('const marked = el.hasAttribute("data-mpw-pop-glass") || el.hasAttribute("data-mpw-pop-trunc");',
    'const marked = false;')
  const { anc, surface } = buildChain('JObwrW_panel', 'rgba(255, 255, 255, 0.5)')
  anc.__inPopSet = true; anc.setAttribute('data-mpw-pop-bg', 'painted')
  surface.__cs = { backdropFilter: 'blur(11px)' }
  MH.sync()
  const first = surface.hasAttribute('data-mpw-pop-trunc')
  surface.__cs = { backdropFilter: 'none' }        // 下一帧：C 类规则已经把表面的 backdrop-filter 撤成 none
  MH.sync()
  ok('D2 把"已带标记就放行"改坏 ⇒ 第二轮把 trunc 标记摘掉（B7 必红：真机就是打-撤-打地闪）',
    first && !surface.hasAttribute('data-mpw-pop-trunc'), '首轮=' + first + ' 二轮=' + surface.hasAttribute('data-mpw-pop-trunc'))
  surface.removeAttribute('data-mpw-pop-bg')
}
console.log('\n===== popover-glass: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

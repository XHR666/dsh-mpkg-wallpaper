// tools/popover-glass-test.mjs —— 弹层玻璃"三条路"分类的判据（取代 popover-untrunc-test）
//
// 设计（真机迭代到 2026-10-05 的收口版，宿主元素一个都不碰）：
//   A 无模糊祖先（挂在 body 下的模型/推理选择器）⇒ 我们自己的 58% 表面 + 自己的 blur；
//   B 祖先里有模糊、且它是**已知包装容器**（输入框卡片一类）⇒ 弹层打 data-mpw-pop-glass，
//     由 mpwPopGlassApply() 在**根级**垫一层对齐弹层矩形的模糊层（backdrop root = 整页）——
//     这样弹层真能糊到页面背后，**包装容器自己的磨砂也不再被摘**（真机："展开加号/权限/上下文，
//     输入框的模糊被顶掉了" ⇒ 两条都要）；
//   C 祖先里有模糊、但它不是包装容器（用户正在看的面板，如子代理展开框）⇒ 什么都不摘，
//     给弹层打 data-mpw-pop-trunc（88% 实底）。
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
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest', '__mpwPopTagTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

const registry = []
const installShim = () => {
  const attrSel = (sel) => { const m = /^\[([^\]=~^$|]+)\]$/.exec(String(sel).trim()); return m ? m[1].trim() : null }
  globalThis.document.querySelectorAll = (sel) => { const a = attrSel(sel); if (a) return registry.filter((el) => el.hasAttribute(a)); return [] }
  globalThis.document.querySelector = (sel) => globalThis.document.querySelectorAll(sel)[0] || null
  const base = globalThis.getComputedStyle
  globalThis.getComputedStyle = (el) => {
    if (el && el.__cs) { const d = Object.assign({}, base(el)); for (const k of Object.keys(el.__cs)) d[k] = el.__cs[k]; return d }
    return base(el)
  }
}
/** body > anc(blur[, bg]) > surface[data-mpw-pop-bg](blur) */
const buildChain = (ancCls, ancBg, surfaceBlur = 'blur(11px)') => {
  /* 上一轮的 surface 从 DOM 摘掉（真实场景里 React 卸载弹层就是这样）⇒ 生产侧按 isConnected 撤层 */
  for (const el of registry.slice()) { try { if (el.parentElement) el.parentElement.removeChild(el) } catch (e) {} }
  registry.length = 0
  const body = globalThis.document.body
  const anc = globalThis.document.createElement('div'); anc.className = ancCls
  const surface = globalThis.document.createElement('div'); surface.className = '_3e4SsG_menu'; surface.setAttribute('data-mpw-pop-bg', '')
  anc.__cs = { backdropFilter: 'blur(14px)', backgroundColor: ancBg || 'rgba(0, 0, 0, 0)' }
  surface.__cs = { backdropFilter: surfaceBlur }
  body.appendChild(anc); anc.appendChild(surface); registry.push(anc, surface)
  for (const el of [anc, surface]) {
    el.matches = (sel) => { const s2 = String(sel || ''); if (/JObwrW_panel|_menu|_popover|_denseList/.test(s2)) return !!el.__inPopSet; const m = /^\[([^\]=~^$|]+)\]$/.exec(s2.trim()); return m ? el.hasAttribute(m[1].trim()) : false }
  }
  return { anc, surface }
}

console.log('== A 组：静态接线 ==')
ok('A1 分类器与根级模糊层都在（mpwPopClassifySync / mpwPopGlassApply）',
  CLIENT.includes('function mpwPopClassifySync()') && CLIENT.includes('function mpwPopGlassApply()'))
ok('A2 三条路的判据齐备：弹层表面集合 + 已知包装容器白名单 + 实底标记',
  CLIENT.includes('p.matches(MPW_POP_TAG_SEL)')
  && CLIENT.includes('wrap = /(_card|composer|overlayAnchor|_seat|_stack)/i.test(String(p.className || ""))')
  && CLIENT.includes('truncated.add(el)') && CLIENT.includes('glasses.add(el)'))
ok('A3 不再摘宿主祖先的 blur（untrunc 规则已移除：无 backdrop-filter:none 的注入样式）',
  !CLIENT.includes('data-mpw-pop-untrunc-style'))
ok('A4 根级模糊层：fixed + pointer-events:none + 读 --mpw-pop-blur',
  /data-mpw-pop-glass-layer/.test(CLIENT) && /position:fixed;pointer-events:none;z-index:4/.test(CLIENT) && /--mpw-pop-blur/.test(CLIENT))
ok('A5 滚动/缩放时重贴（fixed 层跟着弹层走）', /addEventListener\("scroll"/.test(CLIENT) && /addEventListener\("resize"/.test(CLIENT))

console.log('== B 组：三条路的行为 ==')
reset()
loadPlugin({ quiet: true, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
installShim()
const H = globalThis.__mpwPopUntruncTest
ok('B0 出口就位（sync / glassCount / truncCount）', !!H && typeof H.sync === 'function' && typeof H.glassCount === 'function')
{
  const { anc, surface } = buildChain('uV2eYG_card', 'rgba(255, 255, 255, 0.55)')
  H.sync()
  ok('B1 包装容器（输入框卡片）⇒ 弹层打 data-mpw-pop-glass，祖先的 blur **一个像素都不动**',
    surface.hasAttribute('data-mpw-pop-glass') && !surface.hasAttribute('data-mpw-pop-trunc')
    && String(anc.__cs.backdropFilter) === 'blur(14px)', 'anc.bf=' + anc.__cs.backdropFilter)
  ok('B2 根级模糊层就位（body 下、覆盖弹层矩形）', H.glassCount() >= 1, 'layers=' + H.glassCount())
  surface.removeAttribute('data-mpw-pop-bg')
  H.sync()
  ok('B3 弹层关闭 ⇒ glass 标记与根级层都撤掉（不留残留）',
    !surface.hasAttribute('data-mpw-pop-glass') && H.glassCount() === 0, 'layers=' + H.glassCount())
}
{
  const { anc, surface } = buildChain('JObwrW_panel', 'rgba(255, 255, 255, 0.5)')
  surface.__inPopSet = false; anc.__inPopSet = true               // 祖先自己是"用户正在看的面板"
  H.sync()
  ok('B4 祖先自己是弹层表面（子代理展开框一类）⇒ 祖先不动、弹层改实底 data-mpw-pop-trunc',
    surface.hasAttribute('data-mpw-pop-trunc') && !surface.hasAttribute('data-mpw-pop-glass')
    && String(anc.__cs.backdropFilter) === 'blur(14px)', '')
}
{
  const { surface } = buildChain('unknown-panel', 'rgba(0, 0, 0, 0.2)')
  H.sync()
  ok('B5 未知的模糊祖先 ⇒ 保守走实底（不摘、不垫层）',
    surface.hasAttribute('data-mpw-pop-trunc') && !surface.hasAttribute('data-mpw-pop-glass') && H.glassCount() === 0, '')
  surface.removeAttribute('data-mpw-pop-bg'); H.sync()
}
{
  registry.length = 0
  const body = globalThis.document.body
  const s6 = globalThis.document.createElement('div'); s6.className = '_list_1nxmc_8'; s6.setAttribute('data-mpw-pop-bg', ''); s6.__cs = { backdropFilter: 'blur(11px)' }
  s6.matches = () => false
  body.appendChild(s6); registry.push(s6)
  H.sync()
  ok('B6 无模糊祖先（body 下的模型/推理选择器）⇒ 既不打 glass 也不打 trunc（用它自己的 58% + blur）',
    !s6.hasAttribute('data-mpw-pop-glass') && !s6.hasAttribute('data-mpw-pop-trunc') && H.glassCount() === 0, '')
  s6.removeAttribute('data-mpw-pop-bg'); H.sync()
}
{
  const { surface } = buildChain('uV2eYG_card', 'rgba(255, 255, 255, 0.55)', 'none')
  H.sync()
  ok('B7 硬前提：表面自己没有模糊 ⇒ 什么都不做（连 glass 都不打）',
    !surface.hasAttribute('data-mpw-pop-glass') && !surface.hasAttribute('data-mpw-pop-trunc') && H.glassCount() === 0, '')
  surface.removeAttribute('data-mpw-pop-bg'); H.sync()
}

console.log('== C 组：变异自证（真源零改动）==')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pop-glass-'))
  const mut = CLIENT.replace('if (!cs || !cs.backdropFilter || String(cs.backdropFilter).indexOf("blur") < 0) continue;', 'if (!cs) continue;')
  if (mut === CLIENT) throw new Error('变异锚点缺失')
  const p = path.join(dir, 'client.js'); fs.writeFileSync(p, mut)
  reset()
  loadPlugin({ quiet: true, clientPath: p, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
  installShim()
  const MH = globalThis.__mpwPopUntruncTest
  const { surface } = buildChain('uV2eYG_card', 'rgba(255, 255, 255, 0.55)', 'none')
  MH.sync()
  ok('C1 把"表面要有模糊"的硬前提改坏 ⇒ 没有模糊的表面也被打 glass（B7 必红）',
    surface.hasAttribute('data-mpw-pop-glass'), '')
  surface.removeAttribute('data-mpw-pop-bg'); MH.sync()
}
console.log('\n===== popover-glass: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

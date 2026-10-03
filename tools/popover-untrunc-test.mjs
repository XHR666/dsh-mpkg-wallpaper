// popover-untrunc-test.mjs —— P3「弹层玻璃 backdrop root 被截断」修复的判据
//
// 病（docs/POPOVER-BLUR.md，真机定案）：挂在宿主输入框卡片（uV2eYG_card，backdrop-filter:
//   blur(14px)）子树里的弹层（+ 菜单 / 权限 / 上下文面板），其 backdrop root 被卡片截断
//   ⇒ 弹层自己的 blur(11px) 只能采样卡片内部 = 有半透明、没模糊；挂在 body 下的模型选择器正常。
//   实验定案：①移出祖先链即恢复（React 管的 DOM 不许 reparent）③宿主规则带 !important ⇒
//   inline 覆盖无效、CSSOM 注入同特异性更晚的 !important 规则有效且可逆。
//
// 修（lib/client.js `mpwPopUntruncSync()`，挂在 prun 的 rAF 合并入口 + mpwHeavyGate 闸门之下）：
//   只扫已打 `data-mpw-pop-bg` 的弹层表面；硬前提 = 表面 computed backdrop-filter 含 blur
//   （没模糊就不用摘）；沿祖先链（≤12 层，body/html 止）找**第一个**带 blur 的截断祖先，
//   打 `data-mpw-pop-untrunc` 属性；有目标 ⇒ 确保 `<style data-mpw-pop-untrunc-style>` 在场
//   （一条静态规则 `[data-mpw-pop-untrunc] { backdrop-filter: none !important; … }`）；
//   无目标 ⇒ 摘属性、撤规则元素（宿主逐字还原）。
//
// 判据结构（桩世界 _stub.mjs：document.querySelectorAll 恒 [] ⇒ 测试侧垫一层最小属性选择器
//           垫片 + 元素感知的 getComputedStyle；生产代码零改动）：
//   A 组 静态：函数/规则/接线（prun + setup 初始调用）+ 规则必须带 !important（实验③的结论）
//   B 组 行为：截断祖先被打标（只打第一个）+ 规则元素在场；弹层关 ⇒ 属性摘除 + 规则元素撤除
//             （逐字还原）；硬前提（表面没模糊 ⇒ 不打标）；健康弹层（body 下）⇒ 不打标
//   C 组 变异自证：把"身后要有模糊"的前提改掉 ⇒ 无模糊表面也被打标（B 组对应断言必红）
//
// 用法: node tools/popover-untrunc-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) } }

const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce',
  '__mpwBuildCss', '__mpwSectionTest', '__mpwHdrFrostTest', '__mpwGlobalWired', '__mpwNpCtlSeq', '__mpwNowPlaying',
  '__mpwNowPlayingSlotAction', '__mpwPersist', '__mpwStyleWatch', '__mpwHeavyTest', '__mpwPopUntruncTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }

/* 测试侧 DOM 垫片：属性选择器查询 + 元素感知的 getComputedStyle（桩世界缺这两样） */
const registry = []
let csOf = () => ({})
const installShim = () => {
  const attrSel = (sel) => {
    const m = /^\[([^\]=~^$|]+)\]$/.exec(String(sel).trim())
    return m ? m[1].trim() : null
  }
  globalThis.document.querySelectorAll = (sel) => {
    const a = attrSel(sel)
    if (a) return registry.filter((el) => el.hasAttribute(a))
    return []
  }
  globalThis.document.querySelector = (sel) => {
    const r = globalThis.document.querySelectorAll(sel)
    return r[0] || null
  }
  const base = globalThis.getComputedStyle
  globalThis.getComputedStyle = (el) => {
    if (el && el.__cs) {
      const d = Object.assign({}, base(el))
      for (const k of Object.keys(el.__cs || {})) d[k] = el.__cs[k]
      return d
    }
    return base(el)
  }
}
/** 搭一条 链：body > card(blur) > mid > surface[data-mpw-pop-bg](blur)；返回各节点 */
const buildChain = (surfaceBlur, cardBlur) => {
  registry.length = 0
  const body = globalThis.document.body
  const card = globalThis.document.createElement('div'); card.className = 'uV2eYG_card'
  const mid = globalThis.document.createElement('div'); mid.className = 'mid-layer'
  const surface = globalThis.document.createElement('div'); surface.className = '_3e4SsG_menu'; surface.setAttribute('data-mpw-pop-bg', '')
  /* ②(2026-10-05) 截断祖先分两类：**透明包装**（只有 backdrop-filter、没有底）⇒ 摘它的 blur 没损失；
     **自己有可见底的玻璃板**（真机：子代理展开框/输入框卡片 uV2eYG_card）⇒ 动它 = 用户能看到的那层模糊
     没了（真机回归现场）⇒ 不许动它，改为把弹层表面做实在。夹具默认透明包装，D 组专项用有底祖先。
     ⚠ 必须显式写 backgroundColor：桩里读不到 ⇒ mpwColorAlpha 会按"认不出 = 不透明(1)"处理。 */
  card.__cs = cardBlur ? { backdropFilter: cardBlur, backgroundColor: 'rgba(0, 0, 0, 0)' } : {}
  surface.__cs = surfaceBlur ? { backdropFilter: surfaceBlur } : {}
  body.appendChild(card); card.appendChild(mid); mid.appendChild(surface)
  registry.push(card, mid, surface)
  /* 桩 DOM 没有 Element.matches ⇒ 垫一层最小实现：测试用 `__inPopSet` 显式声明"这个元素在弹层表面
     集合里"（= 用户正看着的那块面板），属性选择器按属性判。生产代码只调 `p.matches(MPW_POP_TAG_SEL)`。 */
  for (const el of [card, mid, surface]) {
    el.matches = (sel) => {
      const s2 = String(sel || '')
      if (/JObwrW_panel|_menu|_popover|_denseList/.test(s2)) return !!el.__inPopSet
      const m = /^\[([^\]=~^$|]+)\]$/.exec(s2.trim())
      return m ? el.hasAttribute(m[1].trim()) : false
    }
  }
  return { card, mid, surface }
}

console.log('== A 组：静态 ==')
ok('A1 mpwPopUntruncSync / 规则元素都在；规则必须带 !important（实验③：宿主规则带 !important，inline 压不过）',
  CLIENT.includes('function mpwPopUntruncSync() {') && CLIENT.includes('data-mpw-pop-untrunc-style')
  && /popUntruncStyleEl\.textContent = "\[data-mpw-pop-untrunc\] \{ backdrop-filter: none !important; -webkit-backdrop-filter: none !important; \}"/.test(CLIENT))
ok('A2 硬前提在源码里：表面 computed backdrop-filter 含 blur 才继续（与 mpwTagPopoverBg 同口径）',
  /indexOf\("blur"\) < 0\) continue;/.test(CLIENT))
ok('A3 接线：同步快路（新增子树当场判定，消灭"先白后变"）+ rAF 兜底（受 mpwHeavyGate 闸门）+ setup 初始',
  CLIENT.includes('function mpwTagPopoverFast(records)') && CLIENT.includes('mpwTagPopoverFast(records)')
  && CLIENT.indexOf('mpwHeavyGate("popTag", prun)') >= 0
  && (CLIENT.match(/mpwPopUntruncSync\(\); /g) || []).length >= 2)

console.log('== B 组：行为 ==')
reset()
loadPlugin({ quiet: true, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
installShim()
const H = globalThis.__mpwPopUntruncTest
ok('B0 __mpwPopUntruncTest 出口就位', !!H && typeof H.sync === 'function' && typeof H.stylePresent === 'function')
{
  const { card, surface } = buildChain('blur(11px)', 'blur(14px)')
  const n = H.sync()
  ok('B1 截断祖先被打标：card 有 data-mpw-pop-untrunc + 规则元素在场',
    n === 1 && card.hasAttribute('data-mpw-pop-untrunc') && H.stylePresent(), 'n=' + n)
  ok('B1b 幂等：再跑一次不翻倍、不抖动', H.sync() === 1 && card.hasAttribute('data-mpw-pop-untrunc') && H.stylePresent())
  // 弹层关闭：表面摘除 ⇒ 属性与规则元素一起撤（逐字还原）
  surface.remove(); registry.splice(registry.indexOf(surface), 1)
  const n2 = H.sync()
  ok('B2 弹层关闭 ⇒ 属性**同步**摘除（视觉瞬时）', n2 === 0 && !card.hasAttribute('data-mpw-pop-untrunc'), 'n2=' + n2)
  await new Promise((r) => setTimeout(r, 10))
  ok('B2c 规则元素在下一拍撤走（撤除也瞬时：先注入禁过渡+保持 none，再摘规则）', !H.stylePresent() && !H.killPresent(), '')
}
{
  const { card, surface } = buildChain('blur(11px)', 'blur(14px)')
  surface.remove(); registry.splice(registry.indexOf(surface), 1)
  // 无模糊的表面：不满足硬前提 ⇒ 不打标
  const { card: card2, surface: surf2 } = (() => {
    const body = globalThis.document.body
    const c2 = globalThis.document.createElement('div'); c2.className = 'uV2eYG_card'; c2.__cs = { backdropFilter: 'blur(14px)', backgroundColor: 'rgba(0, 0, 0, 0)' }
    const s2 = globalThis.document.createElement('div'); s2.className = '_menu'; s2.setAttribute('data-mpw-pop-bg', ''); s2.__cs = {}
    body.appendChild(c2); c2.appendChild(s2)
    registry.push(c2, s2)
    return { card: c2, surface: s2 }
  })()
  const n = H.sync()
  ok('B3 硬前提：表面没有 blur ⇒ 即使有截断祖先也不打标（唯一在册的表面无模糊 ⇒ 零目标、规则不落）',
    n === 0 && !card2.hasAttribute('data-mpw-pop-untrunc'), 'n=' + n)
}
{
  // 健康弹层：挂在 body 下（无截断祖先）⇒ 不打标
  registry.length = 0
  const body = globalThis.document.body
  const s3 = globalThis.document.createElement('div'); s3.className = '_7KE1Ra_menu'; s3.setAttribute('data-mpw-pop-bg', ''); s3.__cs = { backdropFilter: 'blur(11px)' }
  body.appendChild(s3); registry.push(s3)
  const n = H.sync()
  ok('B4 健康弹层（body 下，模型选择器形态）⇒ 不打标、规则元素不落',
    n === 0 && globalThis.document.querySelectorAll('[data-mpw-pop-untrunc]').length === 0 && !H.stylePresent(), 'n=' + n)
  // 只打第一个截断祖先：card 外再套一层截断者 ⇒ 只标近的那个
  const outer = globalThis.document.createElement('div'); outer.className = 'outer-blur'; outer.__cs = { backdropFilter: 'blur(6px)', backgroundColor: 'rgba(0, 0, 0, 0)' }
  const card = globalThis.document.createElement('div'); card.className = 'uV2eYG_card'; card.__cs = { backdropFilter: 'blur(14px)', backgroundColor: 'rgba(0, 0, 0, 0)' }
  const mid = globalThis.document.createElement('div'); mid.className = 'mid'
  const surf = globalThis.document.createElement('div'); surf.className = '_menu'; surf.setAttribute('data-mpw-pop-bg', ''); surf.__cs = { backdropFilter: 'blur(11px)' }
  body.appendChild(outer); outer.appendChild(card); card.appendChild(mid); mid.appendChild(surf)
  registry.push(outer, card, mid, surf)
  const n2 = H.sync()
  ok('B5 多层截断 ⇒ 只打第一个（近的）截断祖先',
    n2 === 1 && card.hasAttribute('data-mpw-pop-untrunc') && !outer.hasAttribute('data-mpw-pop-untrunc'), 'n2=' + n2)
}

console.log('== C 组：变异自证（真源零改动）==')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pop-untrunc-'))
  let mut = CLIENT.replace('if (!cs || !cs.backdropFilter || String(cs.backdropFilter).indexOf("blur") < 0) continue;',
    'if (!cs) continue;')
  if (mut === CLIENT) throw new Error('变异锚点缺失')
  const p = path.join(dir, 'client.js'); fs.writeFileSync(p, mut)
  reset()
  loadPlugin({ quiet: true, clientPath: p, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
  installShim()
  const MH = globalThis.__mpwPopUntruncTest
  registry.length = 0
  const body = globalThis.document.body
  const c = globalThis.document.createElement('div'); c.className = 'uV2eYG_card'; c.__cs = { backdropFilter: 'blur(14px)', backgroundColor: 'rgba(0, 0, 0, 0)' }
  const s = globalThis.document.createElement('div'); s.className = '_menu'; s.setAttribute('data-mpw-pop-bg', ''); s.__cs = {}
  body.appendChild(c); c.appendChild(s); registry.push(c, s)
  const n = MH.sync()
  ok('C1 把"身后要有模糊"前提改掉 ⇒ 无模糊表面也被打标（B3 对应断言必红）', n === 1 && c.hasAttribute('data-mpw-pop-untrunc'), 'n=' + n)
}
reset()

console.log('\n== D 组：祖先自己是"有底的玻璃板" ⇒ 绝不动它（真机回归：子代理展开框的模糊被摘没了）==')
{
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'stub-wallpaper.png' }, search: '' })
  installShim()
  const { card, surface } = buildChain('blur(11px)', 'blur(14px)')
  /* 祖先自己也在"弹层表面集合"里 = 用户正在看的那块面板（真机：子代理展开框 / 后台任务面板） */
  card.className = 'JObwrW_panel'
  card.__inPopSet = true                                        // 它自己就是"我们管的弹层表面"
  card.__cs.backgroundColor = 'rgba(255, 255, 255, 0.55)'
  const n = globalThis.__mpwPopUntruncTest.sync()
  ok('D1 祖先自己是"我们管的弹层表面"（用户正看着的面板）⇒ 不摘它的 blur、不打 data-mpw-pop-untrunc',
    n >= 1000 && !card.hasAttribute('data-mpw-pop-untrunc'), 'n=' + n + ' untrunc=' + card.hasAttribute('data-mpw-pop-untrunc'))
  ok('D2 改为把**弹层自己**标记为"实底"（data-mpw-pop-trunc；宿主元素一个都不碰）',
    surface.hasAttribute('data-mpw-pop-trunc') && !surface.hasAttribute('data-mpw-pop-untrunc'), '')
  /* 现实场景：弹层关了 ⇒ 标记器摘掉 data-mpw-pop-bg（元素可能还在 DOM 里一瞬）⇒ 我们的实底标记也必须撤掉 */
  const n2 = (() => { surface.removeAttribute('data-mpw-pop-bg'); return globalThis.__mpwPopUntruncTest.sync() })()
  ok('D3 表面不再是弹层表面（标记被摘）⇒ 实底标记也清掉、返回值归零（可逆、不留残留）',
    !surface.hasAttribute('data-mpw-pop-trunc') && n2 === 0, 'n2=' + n2)
  ok('D4 生产代码里"只摘已知包装容器"的判据在场（祖先自己是弹层表面 ⇒ 保护；非 _card/composer 包装 ⇒ 一律不碰）+ 实底规则用我们自己的标记属性',
    /if \(ancestorIsSurface\) \{ blockedByGlass = true; break \}/.test(CLIENT)
    && /strippableWrap = \/\(_card\|composer\|overlayAnchor\|_seat\|_stack\)\/i/.test(CLIENT)
    && /ancestorIsSurface = p\.matches\(MPW_POP_TAG_SEL\)/.test(CLIENT)
    && /\[data-mpw-pop-trunc\] \{ background-color: color-mix\(in srgb, var\(--dsw-specific-sidebar-fill\) 88%/.test(CLIENT))
  /* D5：**有底但不是弹层表面**的包装（真机：输入框卡片 uV2eYG_card）⇒ 允许摘它的 blur，换来弹层真模糊 */
  {
    const { card: card5, surface: surf5 } = buildChain('blur(11px)', 'blur(14px)')
    card5.className = 'uV2eYG_card'
    card5.__inPopSet = false                                     // 只是"挡在前面的包装"，不是面板
    card5.__cs.backgroundColor = 'rgba(255, 255, 255, 0.55)'
    const n5 = globalThis.__mpwPopUntruncTest.sync()
    /* D6：摘掉之后祖先自己没有 blur 了 ⇒ 第二轮不许"找不到带 blur 的祖先"就把它当陈旧标记还原（真机抖动） */
  {
    const { card: c6, surface: s6 } = buildChain('blur(11px)', 'blur(14px)')
    c6.className = 'uV2eYG_card'; c6.__inPopSet = false
    c6.__cs.backgroundColor = 'rgba(255, 255, 255, 0.55)'
    const n6a = globalThis.__mpwPopUntruncTest.sync()
    c6.__cs.backdropFilter = 'none'          // 我们刚把它摘掉 ⇒ 下一轮读到的就是 none
    const n6b = globalThis.__mpwPopUntruncTest.sync()
    ok('D6 抖动修复：已经摘过、弹层还开着 ⇒ 下一轮保持（不许因为"祖先已无 blur"就还原再摘，来回抖）',
      n6a === 1 && n6b === 1 && c6.hasAttribute('data-mpw-pop-untrunc'), 'n6a=' + n6a + ' n6b=' + n6b)
    /* 弹层关掉（标记被摘）⇒ 祖先属性与规则一起还原 */
    s6.removeAttribute('data-mpw-pop-bg')
    const n6c = globalThis.__mpwPopUntruncTest.sync()
    ok('D6b 弹层关 ⇒ 祖先属性摘除、规则元素撤走（宿主逐字还原）',
      n6c === 0 && !c6.hasAttribute('data-mpw-pop-untrunc'), 'n6c=' + n6c)
  }
  ok('D5 有底但**不是**弹层表面的包装（真机：输入框卡片 uV2eYG_card）⇒ 摘它的 blur，弹层这才糊得到页面背后',
      n5 === 1 && card5.hasAttribute('data-mpw-pop-untrunc') && !surf5.hasAttribute('data-mpw-pop-trunc'),
      'n5=' + n5 + ' untrunc=' + card5.hasAttribute('data-mpw-pop-untrunc') + ' trunc=' + surf5.hasAttribute('data-mpw-pop-trunc'))
  }
}

console.log(`\n===== popover-untrunc: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ P3 收口：弹层开着期间截断祖先的 blur 被可逆摘除（CSSOM !important 规则），关了即还原')
process.exit(fail ? 1 : 0)

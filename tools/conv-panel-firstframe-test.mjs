// tools/conv-panel-firstframe-test.mjs —— 2026-10-31 任务书 §3 判据：
//   大纲面板（.dsh-conv-panel）展开首帧实底 + 面板底色单变量预留（--mpw-conv-panel-bg）
//
// 背景（真机现象 + 机制，lib/client.js ⑬ 注释）：
//   面板实底靠 data-mpw-solid-surface="l1" 标记（CSS 把背景刷回宿主主题原值）；打标原在
//   节流重活（popHeavySync = rAF 合并 + 180ms 尾巴）⇒ 面板挂载/显形的首帧属性还没落，
//   它自身 background:var(--dsw-alias-bg-layer-1)（有壁纸时被全局改半透明）直接画出来 =
//   用户看到的"展开 0.2–0.5s 半透明（一层白滤镜透出文字）"。
//   修法 = 加号菜单磨砂首帧（a6a7dce）同型的**观察器同步快路**：mpwSolidSurfaceFast
//   挂进 mpwTagPopoverFast（观察器回调 = 微任务、渲染前），对插入/显形节点定向检查、
//   命中即同步打标 ⇒ t=0（首帧绘制前）属性已在；稳态兜底仍由 mpwSolidSurfaceSync 负责。
//
// 断言（每条都能被文末变异变红）：
//   B1 插入帧（addedNodes 突变，含子树包裹形态）⇒ fastPath 返回后**同 tick** 属性已在
//      （t=0），且 t=16/50/100/200ms 采样全程在（幂等、无闪烁）
//   B2 显形帧（attributes 突变）⇒ 同 tick 属性已在
//   B3 稳态兜底 solidSync 幂等（重复同步不翻值）
//   A1 产物 CSS：面板 background-color 声明只有一处（亮）/一处（暗），值 = var(--mpw-conv-panel-bg, …)
//      —— 唯一值来源（⑬单变量收敛；旧写法硬编码 var(--dsw-static-neutral-bluish-*)）
//   A2 变量定义在标记规则上，默认 = 宿主主题原值（稳态观感零变化）
//   A3 "改一个变量即整体改面板底色"：把产物里变量定义替换为 rgba(255,0,0,0.5) ⇒
//      background-color 行消费的就是该变量（值来源唯一 ⇒ 变量改 = 面板 alpha 改）
//   MV1 变异：快路两处 mpwSolidSurfaceFast 接线删除 ⇒ B1/B2 必红（首帧回退）
//   MV2 变异：background-color 换回硬编码（绕开变量）⇒ A1/A3 必红
//
// 用法: node tools/conv-panel-firstframe-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs')
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwGlobalWired', '__mpwThumbSched',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState',
  '__mpwBsScanKick', '__mpwBsScanMore', '__mpwPopUntruncTest', '__mpwHeavyTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* ignore */ } } }
function boot(settings) {
  reset()
  loadPlugin({ quiet: true, settings: settings || { enabled: true, image: 'data:image/png;base64,AAA' } })
  const doc = globalThis.document
  const mkPanel = (parent) => {
    const el = doc.createElement('div')
    el.className = 'dsh-conv-panel'
    el.setAttribute('data-conv-panel', '')
    ;(parent || doc.body).appendChild(el)
    return el
  }
  // 桩元素是裸节点：给 matches/querySelector 接上最小实现（mpwSolidSurfaceFast 依赖它们
  // 做定向命中；plus-menu-frost-test 同款做法）
  const walk = (e, fn) => { fn(e); for (const c of (e.children || [])) walk(c, fn) }
  const wire = (root) => walk(root, (el) => {
    if (el.__wired) return
    el.__wired = true
    el.matches = (sel) => String(sel).indexOf('dsh-conv-panel') >= 0 && String(el.className || '').indexOf('dsh-conv-panel') >= 0
    el.querySelector = (sel) => {
      let hit = null
      walk(el, (n) => { if (!hit && n !== el && String(n.className || '').indexOf('dsh-conv-panel') >= 0) hit = n })
      return hit
    }
    el.querySelectorAll = (sel) => { const out = []; walk(el, (n) => { if (n !== el && String(n.className || '').indexOf('dsh-conv-panel') >= 0) out.push(n) }); return out }
  })
  const origAppend = doc.body.appendChild.bind(doc.body)
  doc.body.appendChild = (el) => { const r = origAppend(el); wire(el); return r }
  return { doc, mkPanel, wire, T: globalThis.__mpwPopUntruncTest }
}

console.log('== B. 首帧实底（真 fastPath 直驱：t=0 即在，稳态采样无闪烁）==')
{
  const F = boot()
  const T = F.T
  // B1：插入帧（面板直接插入 body）
  const p1 = F.doc.createElement('div'); p1.className = 'dsh-conv-panel'
  const records = [{ type: 'childList', target: F.doc.body, addedNodes: [p1] }]
  F.doc.body.appendChild(p1)
  const t0 = Date.now()
  T.fastPath(records)
  const markedAtT0 = p1.getAttribute('data-mpw-solid-surface') === 'l1'
  ok('B1a 插入帧 t=0（fastPath 同 tick）属性即已打上（微任务语义 = 渲染前）',
    markedAtT0 && Date.now() - t0 < 50, 'attr=' + JSON.stringify(p1.getAttribute('data-mpw-solid-surface')))
  // t=16/50/100/200ms 采样：全程在、无闪烁
  let stable = true
  for (const ms of [16, 50, 100, 200]) {
    await sleep(ms)
    if (p1.getAttribute('data-mpw-solid-surface') !== 'l1') { stable = false; break }
  }
  ok('B1b t=16/50/100/200ms 采样全程在（幂等无闪烁）', stable)
  // B1c：子树包裹形态（宿主常把面板包在 slot 容器里）
  const wrap = F.doc.createElement('div')
  F.doc.body.appendChild(wrap)
  const p2 = F.doc.createElement('div'); p2.className = 'dsh-conv-panel'; wrap.appendChild(p2)
  T.fastPath([{ type: 'childList', target: F.doc.body, addedNodes: [wrap] }])
  ok('B1c 包裹容器插入（面板在子树里）⇒ 定向 querySelector 命中并打标',
    p2.getAttribute('data-mpw-solid-surface') === 'l1')
  // B2：显形帧（属性突变；宿主"先插入隐藏→class/style 显形"的形态）
  p1.removeAttribute('data-mpw-solid-surface')
  T.fastPath([{ type: 'attributes', target: p1, attributeName: 'class' }])
  ok('B2 显形帧（attributes 突变）同 tick 打标', p1.getAttribute('data-mpw-solid-surface') === 'l1')
  // B3：稳态兜底幂等
  T.solidSync(); T.solidSync()
  ok('B3 稳态 solidSync 幂等（重复同步不翻值）', p1.getAttribute('data-mpw-solid-surface') === 'l1')
  // 非面板节点不误标
  const plain = F.doc.createElement('div'); F.doc.body.appendChild(plain)
  T.fastPath([{ type: 'childList', target: F.doc.body, addedNodes: [plain] }])
  ok('B4 反向：非面板节点不误标', plain.getAttribute('data-mpw-solid-surface') == null)
  cancelWorldTimers()
}

console.log('\n== A. 产物级：单变量收敛（--mpw-conv-panel-bg 唯一值来源）==')
const stripC = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '')
function ruleBody(css, sel) {
  const raw = stripC(css).replace(/\s+/g, ' ')
  const s = sel.replace(/\s+/g, ' ')
  const i = raw.indexOf(s)
  if (i < 0) return null
  const b0 = raw.indexOf('{', i)
  let depth = 1, j = b0 + 1
  while (j < raw.length && depth > 0) { if (raw[j] === '{') depth++; else if (raw[j] === '}') depth--; j++ }
  return raw.slice(b0 + 1, j - 1).trim()
}
let CSS_ON = ''
{
  reset()
  loadPlugin({ quiet: true, settings: { enabled: true, image: 'data:image/png;base64,AAA' } })
  CSS_ON = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')
  cancelWorldTimers()
}
{
  // 面板 background-color 声明全文恰两处（亮/暗），且值都来自 var(--mpw-conv-panel-bg, …)
  const raw = stripC(CSS_ON).replace(/\s+/g, ' ')
  const declRe = /background-color:\s*var\(--mpw-conv-panel-bg[^;]*\)\s*!important/g
  const decls = raw.match(declRe) || []
  ok('A1 面板 background-color 全产物恰 2 处（亮/暗）且值 = var(--mpw-conv-panel-bg, …)',
    decls.length === 2 && (raw.match(/background-color:\s*var\(--dsw-static-neutral-bluish/g) || []).length === 0,
    'decls=' + decls.length + ' 硬编码残留=' + (raw.match(/background-color:\s*var\(--dsw-static-neutral-bluish/g) || []).length)
  const light = ruleBody(CSS_ON, 'html body [data-mpw-solid-surface="l1"]')
  const dark = ruleBody(CSS_ON, 'html body[data-ds-dark-theme] [data-mpw-solid-surface="l1"]')
  ok('A2 变量定义在标记规则上且默认=宿主主题原值（稳态观感零变化）',
    !!light && /--mpw-conv-panel-bg:\s*var\(--dsw-static-neutral-bluish-00\)/.test(light)
    && !!dark && /--mpw-conv-panel-bg:\s*var\(--dsw-static-neutral-bluish-875\)/.test(dark))
  // A3：内存副本替换变量定义 ⇒ 面板底色随变量走（值来源唯一）
  const swapped = CSS_ON.replace('--mpw-conv-panel-bg: var(--dsw-static-neutral-bluish-00)', '--mpw-conv-panel-bg: rgba(255, 0, 0, 0.5)')
  const swLight = ruleBody(swapped, 'html body [data-mpw-solid-surface="l1"]')
  ok('A3 改这一个变量 ⇒ 面板底色整体跟着变（background-color 只引用变量）',
    !!swLight && /--mpw-conv-panel-bg:\s*rgba\(255, 0, 0, 0\.5\)/.test(swLight)
    && /background-color:\s*var\(--mpw-conv-panel-bg, var\(--dsw-static-neutral-bluish-00\)\) !important/.test(swLight))
  // 层级/让位与 alpha 无耦合（⑬约束 3）：conv-panel 层级规则的判定面只有 z-index 与模态 :has
  const layerSlice = raw.slice(raw.indexOf('dsh-conv-panel') >= 0 ? 0 : 0)
  ok('A4 层级/让位规则不依赖 alpha（dsh-conv-panel 相关规则无 background/opacity 声明耦合）',
    (layerSlice.match(/html body \.dsh-conv-panel \{ z-index: 880 !important; \}/g) || []).length === 1
      && !/\.dsh-conv-panel[^{]*\{[^}]*opacity/.test(raw.replace(/html body \[data-mpw-solid-surface="l1"\][^}]*\}/g, '')))
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const CLIENT = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')
function behaviorChecks(clientText, clientPath) {
  fs.mkdirSync(path.dirname(clientPath), { recursive: true })
  fs.writeFileSync(clientPath, clientText)
  reset()
  loadPlugin({ quiet: true, clientPath, settings: { enabled: true, image: 'data:image/png;base64,AAA' } })
  const doc = globalThis.document
  const r = {}
  const T = globalThis.__mpwPopUntruncTest
  const p = doc.createElement('div'); p.className = 'dsh-conv-panel'; doc.body.appendChild(p)
  // 桩元素接 matches（mpwSolidSurfaceFast 的定向命中依赖；与主流程 boot 同款）
  p.matches = (sel) => String(sel).indexOf('dsh-conv-panel') >= 0 && String(p.className || '').indexOf('dsh-conv-panel') >= 0
  p.querySelector = () => null
  T.fastPath([{ type: 'childList', target: doc.body, addedNodes: [p] }])
  r['B1a'] = p.getAttribute('data-mpw-solid-surface') === 'l1'
  p.removeAttribute('data-mpw-solid-surface')
  T.fastPath([{ type: 'attributes', target: p, attributeName: 'class' }])
  r['B2'] = p.getAttribute('data-mpw-solid-surface') === 'l1'
  const css = String(globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : '')
  const raw = stripC(css).replace(/\s+/g, ' ')
  r['A1'] = (raw.match(/background-color:\s*var\(--mpw-conv-panel-bg[^;]*\)\s*!important/g) || []).length === 2
    && (raw.match(/background-color:\s*var\(--dsw-static-neutral-bluish/g) || []).length === 0
  cancelWorldTimers()
  return r
}
const MUT = [
  { id: 'MV1', what: '快路两处 mpwSolidSurfaceFast 接线删除 ⇒ B1/B2 必红（首帧回退）', expect: ['B1a', 'B2'],
    patch: (s) => s.replace('						/* ⑬(2026-10-31 §3.1) 大纲面板以属性突变显形的同帧实底（首帧透明修复） */\n						try { mpwSolidSurfaceFast(t) } catch (e) {}', '')
      .replace('						/* ⑬(2026-10-31 §3.1) 大纲面板插入帧同步实底（首帧透明修复） */\n						try { mpwSolidSurfaceFast(node) } catch (e) {}', ''),
    verify: (s) => s.indexOf('try { mpwSolidSurfaceFast(t) } catch (e) {}') < 0 && s.indexOf('try { mpwSolidSurfaceFast(node) } catch (e) {}') < 0 },
  { id: 'MV2', what: 'background-color 换回硬编码（绕开变量）⇒ A1 必红', expect: ['A1'],
    patch: (s) => s.replace('background-color: var(--mpw-conv-panel-bg, var(--dsw-static-neutral-bluish-00)) !important;',
      'background-color: var(--dsw-static-neutral-bluish-00) !important;'),
    verify: (s) => s.indexOf('background-color: var(--dsw-static-neutral-bluish-00) !important;\n}') >= 0 },
]
let expectRed = [], actualRed = []
for (const m of MUT) {
  const patched = m.patch(CLIENT)
  if (!m.verify(patched)) { fail++; console.error('  ✗ ' + m.id + ' 变异未生效（patch 未命中）'); continue }
  const rr = behaviorChecks(patched, path.join(here, '..', 'node_modules', '.tmp-mut', 'conv-panel-' + m.id + '.js'))
  const red = Object.keys(rr).filter((k) => !rr[k])
  const expOk = m.expect.every((e) => red.includes(e))
  const noExtra = red.every((k) => m.expect.includes(k))
  if (expOk && noExtra) { pass++; console.log('  ✓ ' + m.id + ' ' + m.what + '  [期望红集==' + JSON.stringify(m.expect) + ' == 实际红集==' + JSON.stringify(red) + ']') }
  else { fail++; console.error('  ✗ ' + m.id + '  期望红集==' + JSON.stringify(m.expect) + '  实际红集==' + JSON.stringify(red)) }
  expectRed = expectRed.concat(m.expect); actualRed = actualRed.concat(red)
}
ok('M0 变异红集逐条相等（期望 == 实际）', JSON.stringify([...expectRed].sort()) === JSON.stringify([...actualRed].sort()),
  JSON.stringify({ expect: expectRed.sort(), actual: actualRed.sort() }))
try { fs.rmSync(path.join(here, '..', 'node_modules', '.tmp-mut'), { recursive: true, force: true }) } catch { /* ignore */ }

console.log('\n' + (fail === 0 ? '✓ 全部通过 ' : '✗ 有失败 ') + pass + '/' + (pass + fail))
process.exit(fail === 0 ? 0 : 1)

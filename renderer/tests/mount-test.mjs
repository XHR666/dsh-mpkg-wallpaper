// mount-test.mjs —— P-91：库入口 `core/we-scene.mjs` 的 `mount(container, opts)` 契约回归
// 复现：node mount-test.mjs
//
// 为什么用**桩渲染器**而不是真 GL：`mount` 的职责边界是"画布/上下文/帧循环/帧末链/生命周期"，
// 真 GL 只会把断言埋进 506KB bundle 的实现细节里。所以 `mount` 留了 `opts.createRenderer` /
// `opts.raf` / `opts.now` 三个注入点（见 core/we-scene.mjs 文件头"依赖注入"一节），
// 本测试**只**断言它对宿主的对外契约：
//   ① 容器解析（选择器 / Element / 无效 → 可读错误）
//   ② 画布口径（自建并挂载 / `opts.canvas` 接管 / 尺寸与 dpr / 容器 clientWidth 兜底）
//   ③ **帧序 = demo.html 逐条一致**：render → runBloom（仅 general.bloom 为真）→ runAA → runPostFrameHooks
//   ④ 生命周期：autostart / start / stop / pause / resume / resize / setScene / setTextures /
//      setQuality 透传 / dispose（含自建画布的摘除、接管画布**不**摘除）
//   ⑤ 健壮性：render 抛错不中断循环且最多 5 条日志；无 rAF / 无 document 时报可读错误
import fs from 'node:fs'
import path from 'node:path'
import { mount, VERSION } from '../core/we-scene.mjs'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

let pass = 0, fail = 0
const fails = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

// ── 桩环境：最小 document / 元素 / rAF 队列 ──
function mkEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), nodeType: 1, style: {}, children: [], parentNode: null,
    clientWidth: 0, clientHeight: 0,
    appendChild(c) { c.parentNode = el; el.children.push(c); return c },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c },
    querySelector() { return null },
  }
  return el
}
const mkDoc = () => ({ createElement: (t) => mkEl(t), querySelector: () => null })

// ── 桩渲染器：把每次调用按顺序记进 calls ──
function mkRenderer(opts = {}) {
  const calls = []
  const r = {
    calls,
    gl: {},
    render(scene, textures, w, h, t) {
      calls.push({ m: 'render', scene, textures, w, h, t })
      if (opts.renderThrows && calls.filter((c) => c.m === 'render').length <= opts.renderThrows) return Promise.reject(new Error('boom'))
      return Promise.resolve()
    },
    runBloom(g, w, h) { calls.push({ m: 'runBloom', g, w, h }) },
    runAA(w, h) { calls.push({ m: 'runAA', w, h }) },
    runPostFrameHooks(info) { calls.push({ m: 'hooks', info }) },
    resetShaderCaches() { calls.push({ m: 'resetShaderCaches' }) },
    setQuality(patch) { calls.push({ m: 'setQuality', patch }); return { q: 'high', aa: 'off', pp: 'high' } },
    getQuality() { return { q: 'high', aa: 'off', pp: 'high' } },
  }
  return r
}

// 受控 rAF：手动 flush 才能推进帧（同步、确定性、不依赖真计时器）
function mkRaf() {
  const q = []
  return {
    raf: (fn) => { q.push(fn); return q.length },
    cancelRaf: () => {},
    pending: () => q.length,
    async flush(n = 1) { for (let i = 0; i < n; i++) { const fn = q.shift(); if (fn) await fn() } },
  }
}
// 同步等待微任务（frame 内部 await render 后还有后半段）
const drain = () => new Promise((r) => setTimeout(r, 0))

const sceneNoBloom = { general: {}, layers: [{ id: 1 }, { id: 2 }] }
const sceneBloom = { general: { bloom: { value: true } }, layers: [{ id: 1 }] }

// =====================================================================================
console.log('\n[1] 容器与画布口径')
{
  const doc = mkDoc()
  const host = mkEl('div'); host.clientWidth = 800; host.clientHeight = 600
  const r = mkRenderer()
  const R = mkRaf()
  const h = mount(host, { document: doc, createRenderer: () => r, raf: R.raf, cancelRaf: R.cancelRaf, now: () => 0, scene: sceneNoBloom })
  check('自建画布并挂进容器', host.children.length === 1 && host.children[0].tagName === 'CANVAS')
  check('尺寸取容器的 clientWidth/Height', h.canvas.width === 800 && h.canvas.height === 600, h.canvas.width + 'x' + h.canvas.height)
  check('autostart 默认排了一帧', R.pending() === 1, String(R.pending()))
  h.dispose()

  // opts.width/height + dpr 覆盖容器
  const doc2 = mkDoc(); const host2 = mkEl('div'); host2.clientWidth = 800; host2.clientHeight = 600
  const h2 = mount(host2, { document: doc2, createRenderer: () => mkRenderer(), raf: mkRaf().raf, now: () => 0, scene: sceneNoBloom, width: 100, height: 50, dpr: 2 })
  check('opts.width/height × dpr 优先于容器尺寸', h2.canvas.width === 200 && h2.canvas.height === 100, h2.canvas.width + 'x' + h2.canvas.height)
  h2.dispose()

  // 无容器尺寸 → 默认 1280×720
  const host3 = mkEl('div')
  const h3 = mount(host3, { document: mkDoc(), createRenderer: () => mkRenderer(), raf: mkRaf().raf, now: () => 0, scene: sceneNoBloom })
  check('容器无尺寸时回落 1280×720', h3.canvas.width === 1280 && h3.canvas.height === 720)
  h3.dispose()

  // opts.canvas 接管：不 append、dispose 不摘除
  const doc4 = mkDoc(); const host4 = mkEl('div'); const myCanvas = mkEl('canvas')
  const h4 = mount(host4, { document: doc4, canvas: myCanvas, createRenderer: () => mkRenderer(), raf: mkRaf().raf, now: () => 0, scene: sceneNoBloom, autostart: false })
  check('opts.canvas 接管时不 append 新画布', host4.children.length === 0 && h4.canvas === myCanvas)
  check('autostart:false 时不排帧', h4.running === false)
  h4.dispose()
  check('接管画布 dispose 后不被摘除（宿主所有）', myCanvas.parentNode === null)

  // 无效容器 / 缺 rAF / 缺 document：可读错误
  const errs = {}
  for (const [k, fn] of Object.entries({
    badContainer: () => mount(null, {}),
    missingSel: () => mount('#nope', { document: mkDoc() }),
    noRaf: () => { const g = globalThis.requestAnimationFrame; delete globalThis.requestAnimationFrame; try { return mount(mkEl('div'), { document: mkDoc(), createRenderer: () => mkRenderer(), now: () => 0 }) } finally { if (g) globalThis.requestAnimationFrame = g } },
    noDoc: () => mount(mkEl('div'), { createRenderer: () => mkRenderer(), raf: () => 1, now: () => 0 }),
  })) { try { fn(); errs[k] = '' } catch (e) { errs[k] = e.message } }
  check('无效容器抛可读错误', /容器无效/.test(errs.badContainer), errs.badContainer)
  check('选择器找不到抛可读错误', /容器无效/.test(errs.missingSel), errs.missingSel)
  check('无 rAF 抛可读错误', /requestAnimationFrame/.test(errs.noRaf), errs.noRaf)
  check('无 document 且无 opts.canvas 抛可读错误', /opts\.canvas/.test(errs.noDoc), errs.noDoc)
}

console.log('\n[2] 帧序 = demo.html 逐条一致（render → bloom → AA → hooks）')
{
  const R = mkRaf()
  const r = mkRenderer()
  const h = mount(mkEl('div'), { document: mkDoc(), createRenderer: () => r, raf: R.raf, now: () => 1000, scene: sceneBloom, autostart: false })
  h.start()
  await R.flush(1); await drain()
  const seq = r.calls.map((c) => c.m)
  check('无 bloom 声明时**不**调 runBloom；有声明则调', JSON.stringify(seq) === JSON.stringify(['render', 'runBloom', 'runAA', 'hooks']), JSON.stringify(seq))
  check('render 实参 = (scene, textures, canvasW, canvasH, tSec)', (() => {
    const c = r.calls[0]
    return c.scene === sceneBloom && c.textures === h.textures && c.w === h.canvas.width && c.h === h.canvas.height && c.t === 0
  })(), JSON.stringify({ w: r.calls[0].w, h: r.calls[0].h, t: r.calls[0].t }))
  check('hooks 收到 { frame, w, h, layers, tex }', (() => {
    const i = r.calls.find((c) => c.m === 'hooks').info
    return i.frame === 0 && i.w === h.canvas.width && i.h === h.canvas.height && i.layers === 1 && i.tex === 0
  })(), JSON.stringify(r.calls.find((c) => c.m === 'hooks').info))
  check('frameCount 递增到 1', h.frameCount === 1)
  check('首帧后自动排下一帧（running 时）', R.pending() === 1)
  // 第二帧：tSec 随 now 前进
  let t = 1500
  const R2 = mkRaf(); const r2 = mkRenderer()
  const h2 = mount(mkEl('div'), { document: mkDoc(), createRenderer: () => r2, raf: R2.raf, now: () => t, scene: sceneNoBloom })
  await R2.flush(1); await drain()
  t = 2000
  await R2.flush(1); await drain()
  const rends = r2.calls.filter((c) => c.m === 'render')
  check('tSec = (now - t0)/1000 逐帧推进（帧0=0，帧1=0.5）', rends[0].t === 0 && rends[1].t === 0.5, rends.map((c) => c.t).join(','))
  check('无 bloom 的包零 runBloom 调用', !r2.calls.some((c) => c.m === 'runBloom'))
  h.dispose(); h2.dispose()
}

console.log('\n[3] 生命周期：stop / pause / resume / resize / setScene / setTextures / setQuality / dispose')
{
  const R = mkRaf(); const r = mkRenderer()
  const host = mkEl('div'); host.clientWidth = 300; host.clientHeight = 200
  const h = mount(host, { document: mkDoc(), createRenderer: () => r, raf: R.raf, cancelRaf: R.cancelRaf, now: () => 0, scene: sceneNoBloom })

  h.stop()
  check('stop 后 running=false 且不再排帧', h.running === false)
  await R.flush(5); await drain()
  check('stop 后 flush 也不产生 render 调用', r.calls.filter((c) => c.m === 'render').length === 0)

  h.start()
  await R.flush(1); await drain()
  const n1 = r.calls.filter((c) => c.m === 'render').length
  h.pause()
  await R.flush(1); await drain()
  check('pause 后仍排帧但不推进渲染', h.running === true && r.calls.filter((c) => c.m === 'render').length === n1)
  h.resume()
  await R.flush(1); await drain()
  check('resume 后恢复渲染', r.calls.filter((c) => c.m === 'render').length === n1 + 1)

  h.resize(640, 480)
  check('resize 后画布尺寸更新（不乘 dpr）', h.canvas.width === 640 && h.canvas.height === 480, h.canvas.width + 'x' + h.canvas.height)

  const s2 = { general: {}, layers: [] }
  h.setScene(s2, new Map([['x', {}]]))
  check('setScene 换场景', h.scene === s2)
  check('setScene 清 shader 缓存（避免复用上一个场景的程序）', r.calls.some((c) => c.m === 'resetShaderCaches'))
  check('setScene 可同时换贴图表', h.textures.size === 1)
  h.setTextures(new Map())
  check('setTextures 单独换表', h.textures.size === 0)

  h.setQuality({ q: 'low' })
  check('setQuality 透传给 renderer', JSON.stringify(r.calls.filter((c) => c.m === 'setQuality').map((c) => c.patch)) === JSON.stringify([{ q: 'low' }]))
  check('getQuality 透传 renderer 快照', h.getQuality() && h.getQuality().q === 'high')

  h.dispose()
  check('dispose 后自建画布被摘除', host.children.length === 0)
  check('dispose 幂等（二次调用不抛）', (() => { try { h.dispose(); return true } catch (e) { return false } })())
  await R.flush(5); await drain()
  check('dispose 后 flush 不再渲染', r.calls.filter((c) => c.m === 'render').length === n1 + 1)
}

console.log('\n[4] 健壮性：render 抛错不中断循环、最多 5 条日志')
{
  const R = mkRaf(); const logs = []
  const r = mkRenderer({ renderThrows: 99 })
  const h = mount(mkEl('div'), { document: mkDoc(), createRenderer: () => r, raf: R.raf, now: () => 0, scene: sceneNoBloom, onLog: (m) => logs.push(m) })
  for (let i = 0; i < 7; i++) { await R.flush(1); await drain() }
  check('7 帧全抛错仍继续排帧（不静默停住）', R.pending() === 1 && r.calls.filter((c) => c.m === 'render').length === 7, String(r.calls.filter((c) => c.m === 'render').length))
  check('错误日志最多 5 条', logs.filter((m) => /render error/.test(m)).length === 5, String(logs.filter((m) => /render error/.test(m)).length))
  check('render 抛错时该帧不计入 frameCount', h.frameCount === 0, String(h.frameCount))
  h.dispose()
}

console.log('\n[5] 场景注入：opts.sceneJson + opts.userProps + opts.renderConfig')
{
  const R = mkRaf(); const r = mkRenderer()
  const sceneJson = { general: {}, camera: null, layers: [], objects: [], materials: [] }
  const h = mount(mkEl('div'), {
    document: mkDoc(), createRenderer: () => r, raf: R.raf, now: () => 0, autostart: false,
    sceneJson, project: { type: 'scene' }, userProps: { color: '1 0 0' }, renderConfig: {},
  })
  check('sceneJson 被 parseScene 解析成含 layers 的场景', !!(h.scene && Array.isArray(h.scene.layers)))
  check('userProps/renderConfig 不抛（空场景边界）', h.scene !== null)
  h.dispose()
}

console.log('\n[6] 版本口径：VERSION 与 package.json 一致')
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  check('VERSION === package.json.version', VERSION === pkg.version, VERSION + ' vs ' + pkg.version)
  check('package.json.license 与 LICENSE 一致（GPL-3.0-or-later）', pkg.license === 'GPL-3.0-or-later', String(pkg.license))
}

// =====================================================================================
console.log('\n' + '─'.repeat(72))
console.log(`mount-test：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条断言）`)
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }
console.log('✓ P-91 库入口 mount() 契约（画布/帧序/生命周期/注入）全部断言通过')

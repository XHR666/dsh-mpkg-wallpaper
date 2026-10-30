#!/usr/bin/env node
// multi-instance-test.mjs — 用户第 4 项「一页多实例」门禁（P-77）
//
// 覆盖（父任务书列的 7 条，逐条对应下面的 [T*] 段）：
//   [T1] **无 `?ids=` 时逐位不变**（红线）：解析器返回 null；demo.html 单实例调用点直连
//        bootInstance（**不经过调度器**）；`/report` payload 的 `instances` 键在单实例时不存在
//        （把 demo.html 里那几行真源码切出来、两种状态各跑一次，验"有/无该键"）
//   [T2] `?ids=` 解析：非法项 / 去重 / 顺序 = 布局顺序 / `?ids=` 空或全非法 → 退回单实例
//   [T3] maxinst 超出：**不创建 WebGL 上下文**（桩计数）+ 占位块有原因文案
//   [T4] 同一时刻只有一个 active；未选中的实例 **0 帧**（桩 rAF 计数）
//   [T5] 释放路径：`dispose()` 调 `WEBGL_lose_context.loseContext()`（桩断言）+ 从调度器摘除 + 上下文数回落
//   [T6] `/report` 的 `instances` 字段：单实例不存在、多实例字段齐全（设计文档 §2.5 的 8 键）
//   [T7] 一帧最多推进 1 个 active（+ 至多 1 个到期 idle）：桩计数器
// 另有 [T8] 预算降档（maxinst ≥ 3 → 720p + multi-idle 粒子档，?res= 可覆盖）、
//      [T9] 布局/UI（`.mpw-inst` 容器 + 点击激活 + `?instlog=all`）、
//      [T10] demo.html 接线静态断言（单实例路径不碰调度器；`__mpwInstances` 形状；dispose → loseContext）。
//
// 无浏览器依赖（本机 PRoot 起不了 Chromium，见 headless-shot.mjs 的降级链记录）：真源码切片 +
// 假 DOM + 桩 rAF/桩 boot ⇒ 调度/预算/释放/诊断语义可在 Node 里逐条钉死。
import fs from 'node:fs'
import path from 'node:path'
import {
  MPW_MULTI_DEFAULTS, MPW_MULTI_PARTICLE_BUDGET,
  mpwMultiParseIds, mpwMultiParseOpts, mpwMultiBudget, mpwLoseContext, createMultiInstanceHost,
} from '../elysia/multi-instance.js'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT   // ①(2026-09-16) 根文件（demo.html / bundle）在仓库根
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}

// ── 假 DOM（本模块只用 createElement/appendChild/className/textContent/style/事件/getElementById）──
function mkEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', textContent: '', id: '',
    style: {}, parentNode: null, tabIndex: 0,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c },
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k] },
    addEventListener(t, h) { (this.listeners[t] = this.listeners[t] || []).push(h) },
    removeEventListener() {},
    fire(t, ev) { for (const h of (this.listeners[t] || []).slice()) h(Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, ev || {})) },
    getContext(kind) { this._ctx = this._ctx || { kind, getExtension: () => null, getParameter: () => 4096 }; return this._ctx },
    _text() { return this.textContent + this.children.map((c) => c._text()).join(' ') },
    _find(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c._find(pred, out); return out },
  }
  return el
}
function mkDoc() {
  const body = mkEl('body')
  return {
    body, hidden: false, _l: {},
    createElement: (t) => mkEl(t),
    addEventListener(t, h) { (this._l[t] = this._l[t] || []).push(h) },
    getElementById(id) { return body._find((e) => e.id === id)[0] || null },
    fire(t, ev) { for (const h of (this._l[t] || []).slice()) h(Object.assign({ preventDefault() {} }, ev || {})) },
  }
}
/** 桩环境：手动 rAF（测试自己决定"何时来一帧"）+ 桩 boot（可数上下文） */
function mkEnv(ids, search, bootImpl) {
  const doc = mkDoc(), logEl = mkEl('pre')
  const rafQ = []
  const ctx = { live: 0, created: 0, disposed: 0, boots: [], frames: {} }
  const opts = mpwMultiParseOpts(search)
  const env = {
    doc, logEl, rafQ, ctx,
    raf(cb) { rafQ.push(cb); return rafQ.length },
    caf() {},
    now: 1000,
    boot(rec) {
      ctx.created++; ctx.live++
      ctx.boots.push(rec.id)
      ctx.frames[rec.id] = 0
      const gl = { getExtension: (n) => (n === 'WEBGL_lose_context' ? { loseContext() { ctx.lost = (ctx.lost || 0) + 1; ctx.live-- } } : null) }
      const h = {
        gl, ctx: { lost: 0, restored: 0 },
        frame() { ctx.frames[rec.id]++ },
        dispose() {
          ctx.disposed++
          if (mpwLoseContext(gl)) { /* 桩已计数 */ }
        },
      }
      if (bootImpl) return bootImpl(rec, h) || Promise.resolve(h)
      return Promise.resolve(h)
    },
  }
  const parsed = mpwMultiParseIds(new URLSearchParams((search || '').replace(/^\?/, '')) ) || null
  const host = createMultiInstanceHost(Object.assign({
    ids, opts, budget: mpwMultiBudget(opts, ids.length), doc, logEl,
    invalid: parsed ? parsed.invalid : [], dupes: parsed ? parsed.dupes : [],
    raf: env.raf, caf: env.caf, now: () => env.now, boot: env.boot,
    onSnapshot: (rows) => { env.rows = rows },
  }))
  env.host = host
  return env
}
/** 手动驱动调度器 n 帧（推进时钟，避免 instfps 的到期判定把结果搅乱） */
function ticks(env, n, dt = 16) { const out = []; for (let i = 0; i < n; i++) { env.now += dt; out.push(env.host.tick(env.now)) } return out }

console.log('[T1] 无 ?ids= ⇒ 单实例路径（红线）')
{
  check('T1a `?id=X` / 无参数 / `?ids=` 空 / 全非法 ⇒ 解析器返回 null（= 走原单实例路径）',
    mpwMultiParseIds('?id=3554161528') === null && mpwMultiParseIds('') === null &&
    mpwMultiParseIds('?ids=') === null && mpwMultiParseIds('?ids=,,,') === null && mpwMultiParseIds('?ids=@@@,###') === null)
  check('T1b 有 ?ids=a,b ⇒ 返回 ids（顺序=布局顺序）', (() => {
    const r = mpwMultiParseIds('?ids=3554161528,3719111841'); return r && r.ids.length === 2 && r.ids[0] === '3554161528' && r.ids[1] === '3719111841'
  })())
  // 真源码切片：单实例调用点必须**直连** bootInstance（不是"多实例里的 N=1"），多实例才建 host
  const callSingle = HTML.match(/bootInstance\(MPW_PRIMARY_INST\)/)
  check('T1c demo.html 单实例调用点 = bootInstance(MPW_PRIMARY_INST)（直连，不经过调度器）', !!callSingle)
  check('T1d 多实例 host 只在 `if (MPW_MULTI_IDS)` 分支里创建（单实例不会构造调度器）',
    /if \(MPW_MULTI_IDS\) \{[\s\S]{0,900}?createMultiInstanceHost\(/.test(HTML))
  check('T1e 单实例 descriptor 的字段就是原来的模块级常量（canvas=cv / gl / id / logEl=log / fpsEl / logf / primary:true）',
    /const MPW_PRIMARY_INST = \{ canvas: cv, gl, id, logEl: log, fpsEl, logf, primary: true \};/.test(HTML))
  /*  ①(2026-09-25 ISSUE0924A ⑭) **判据按语义更新**：取的上下文这件事没变（无 `?ids=` ⇒ 模块级在 `#sc` 上
      取 webgl2；多实例 ⇒ 每格自建），变的是"怎么取"——旧写法是一行裸 `cv.getContext('webgl2', …)`
      （一次定生死，把瞬时/资源性失败报成"当前浏览器不支持 WebGL2"），现在是 `await mpwAcquireWebGL2(cv, attrs)`
      （挂 `webglcontextcreationerror` 收 statusMessage + 150/400/900ms 退避重试 + 三分归因台账，见 P-187 ⑭）。
      所以这里钉**三条**：①分支仍在（`MPW_MULTI_IDS ? null :`）；②单实例路径取的就是 `cv`（`#sc`）；
      ③那个 helper 拿得到画布与 attrs；④**裸 getContext 已经不在模块级那一行了**（防退回去）。 */
  const acqLine = (HTML.match(/const gl = MPW_MULTI_IDS \? null : ([^;]+);/) || [])[1] || ''
  check('T1f 没有 ?ids= 时模块级仍照旧在 #sc 上取 webgl2 上下文（多实例时才跳过）',
    /^await mpwAcquireWebGL2\(cv, lib\.glCanvasAttrs\(location\.search\)\)$/.test(acqLine.trim()) &&
    /async function mpwAcquireWebGL2\(cvEl, attrs\)/.test(HTML) &&
    !/cv\.getContext\('webgl2'/.test(acqLine),
    '取上下文那一行 = ' + JSON.stringify(acqLine.trim().slice(0, 100)))
  check('T1g 装载核心搬进 bootInstance（loadTex/loadScene 现在是实例作用域内的函数，在 bootInstance 之后）',
    HTML.indexOf('async function bootInstance(inst) {') > 0 &&
    HTML.indexOf('async function bootInstance(inst) {') < HTML.indexOf('async function loadTex(name, opts = {}) {') &&
    HTML.indexOf('async function loadTex(name, opts = {}) {') < HTML.indexOf('function loadScene() {'))
}
{
  // `/report` payload 的 instances 键：把 demo.html 里那一行**真源码**切出来，两种状态各跑一次
  const LINE = /if \(mpwMultiHost\) payload\.instances = mpwMultiHost\.reportInstances\(\)/.exec(HTML)
  check('T1h demo.html 里只有一处给 payload 加 instances 键，且以 mpwMultiHost 为门',
    !!LINE && (HTML.match(/payload\.instances/g) || []).length === 1)
  const makePayload = (host) => {
    const payload = { id: '3554161528', ok: true, fps: 60 }
    // eslint-disable-next-line no-new-func
    new Function('payload', 'mpwMultiHost', LINE[0])(payload, host)
    return payload
  }
  const single = makePayload(null)
  const multi = makePayload({ reportInstances: () => [{ id: 'a', state: 'active' }, { id: 'b', state: 'paused' }] })
  check('T1i 单实例 payload **不含** instances 键；多实例含（旧解析不会炸）',
    !('instances' in single) && Array.isArray(multi.instances) && multi.instances.length === 2, { single, multi })
}

console.log('[T2] `?ids=` 解析：非法项 / 去重 / 顺序')
{
  const r = mpwMultiParseIds('?ids=a1,b2,a1,@@bad, c3 ,,b2')
  check('T2a 去重保留首次位置 + 非法项单列 + 空项跳过', r && r.ids.join(',') === 'a1,b2,c3', r)
  check('T2b 非法项带原因文案', r && r.invalid.length === 1 && r.invalid[0].raw === '@@bad' && /非法 id/.test(r.invalid[0].reason))
  check('T2c 重复项登记在 dupes（提示"已去重"）', r && r.dupes.join(',') === 'a1,b2')
  const o = mpwMultiParseOpts('?ids=a,b&layout=col&maxinst=2&instfps=0,6&inactive=idle&instlog=all&res=1440p')
  check('T2d 五个新开关解析正确', o.layout === 'col' && o.maxinst === 2 && o.instfps.active === 0 && o.instfps.idle === 6 && o.inactive === 'idle' && o.instlog === 'all' && o.res === '1440p', o)
  const d = mpwMultiParseOpts('?ids=a&layout=zzz&maxinst=0&instfps=x,y&inactive=hover&instlog=none')
  check('T2e 非法值一律回默认并记 notes（默认 layout=grid / maxinst=4 / instfps=0,4 / inactive=pause / instlog=active）',
    d.layout === 'grid' && d.maxinst === 4 && d.instfps.active === 0 && d.instfps.idle === 4 && d.inactive === 'pause' && d.instlog === 'active' && d.notes.length >= 5, d)
  const h = mpwMultiParseOpts('?ids=a&maxinst=99')
  check('T2f maxinst 超过硬上限 8 → 按 8 计并记原因（浏览器上下文上限 ~8–16）', h.maxinst === MPW_MULTI_DEFAULTS.HARD_MAXINST && h.notes.length === 1)
  check('T2g 默认值就是用户拍板的两条：inactive=pause、maxinst=4',
    MPW_MULTI_DEFAULTS.INACTIVE === 'pause' && MPW_MULTI_DEFAULTS.MAXINST === 4)
}

console.log('[T3] maxinst 超出：不创建上下文 + 占位块写明原因')
{
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const env = mkEnv(ids, '?ids=' + ids.join(',') + '&maxinst=4')
  await env.host.start()
  check('T3a 6 个 id / maxinst=4 ⇒ 只创建 4 个上下文（桩计数）', env.ctx.created === 4 && env.ctx.live === 4, { created: env.ctx.created, live: env.ctx.live })
  check('T3b 只对前 4 个 id 调 boot（顺序 = 布局顺序）', env.ctx.boots.join(',') === 'a,b,c,d')
  check('T3c 超限格子**没有 canvas**（不创建 WebGL 上下文）',
    env.host.instances[4].canvas === null && env.host.instances[5].canvas === null &&
    env.host.instances[0].canvas !== null)
  const txt = env.doc.getElementById('mpw-inst-host')._text()
  check('T3d 占位块写明原因（"超出实例上限 maxinst=4 / 未创建 WebGL 上下文"）',
    /超出实例上限 maxinst=4/.test(txt) && /未创建 WebGL 上下文/.test(txt), txt.slice(0, 160))
  check('T3e 诊断里超限格子 state=disposed 且 reason 有原因',
    env.host.snapshot()[4].state === 'disposed' && /超出实例上限/.test(env.host.snapshot()[4].reason))
  check('T3f 去重/非法提示落在容器里（不静默吞输入）', (() => {
    const e2 = mkEnv(['a', 'a', '@@x'], '?ids=a,a,@@x')
    e2.host.build()
    const t = e2.doc.getElementById('mpw-inst-host')._text()
    return /已忽略 1 个非法 id/.test(t) && /已去重 1 个重复 id/.test(t)
  })())
}

console.log('[T4] 点选激活：同一时刻只有一个 active；未选中 0 帧')
{
  const env = mkEnv(['a', 'b', 'c'], '?inactive=pause')
  await env.host.start()
  ticks(env, 10)
  check('T4a 启动后默认选中第一个（其余显示遮罩）', env.host.active().id === 'a' && env.host.instances.filter((r) => r.selected).length === 1)
  check('T4b 未选中实例 **0 帧**（桩 rAF 计数）', env.ctx.frames.a === 11 && env.ctx.frames.b === 0 && env.ctx.frames.c === 0,
    env.ctx.frames)
  check('T4c 状态机：a=active，b/c=paused 且 reason 写明"未选中"',
    env.host.snapshot()[0].state === 'active' && env.host.snapshot()[1].state === 'paused' && /未选中/.test(env.host.snapshot()[1].reason))
  check('T4d paused 格子的 rAF 被"跳过"记账（skipped 累加）', env.host.instances[1].skipped >= 10, env.host.instances[1].skipped)
  env.host.activate(1)
  const before = { a: env.ctx.frames.a, b: env.ctx.frames.b }
  ticks(env, 5)
  check('T4e 切换后原 active 立刻停（0 帧增长）、新 active 在跑', env.ctx.frames.a === before.a && env.ctx.frames.b > before.b,
    { before, after: { a: env.ctx.frames.a, b: env.ctx.frames.b } })
  check('T4f 选中唯一性（activate 会清掉其它格的 selected）', env.host.instances.filter((r) => r.selected).length === 1 && env.host.instances[0].selected === false)
  const txt = env.doc.getElementById('mpw-inst-host')._text()
  check('T4g 未选中格子有"▶ 点击激活"遮罩、选中格子遮罩隐藏',
    env.host.instances[0].maskEl.style.display === 'flex' && env.host.instances[1].maskEl.style.display === 'none' &&
    /▶ 点击激活/.test(txt))
  check('T4h 点画布即激活（tile click 事件驱动真实源码路径）', (() => {
    env.host.instances[0].el.fire('click')
    return env.host.active().id === 'a' && env.host.instances[1].selected === false
  })())
  check('T4i 键盘可选中（Enter/Space → activate，设计文档 §2.2 可访问性）', (() => {
    env.host.instances[2].el.fire('keydown', { key: 'Enter' })
    return env.host.active().id === 'c'
  })())
  const e3 = mkEnv(['a', 'b', 'c'], '?inactive=idle&instfps=0,4')
  await e3.host.start()
  check('T4j ?inactive=idle：未选中格子进 idle 档（不是 paused）',
    e3.host.instances[1].state === 'idle' && e3.host.instances[2].state === 'idle' && /idle/.test(e3.host.snapshot()[1].reason))
  ticks(e3, 30, 16)
  check('T4k idle 档生效：idle 格确有帧但不是每帧（≈4fps vs active 每帧）',
    e3.ctx.frames.b >= 1 && e3.ctx.frames.b < e3.ctx.frames.a, { a: e3.ctx.frames.a, b: e3.ctx.frames.b, c: e3.ctx.frames.c })
}

console.log('[T5] 释放路径：loseContext + 从调度器摘除')
{
  const env = mkEnv(['a', 'b', 'c'], '?maxinst=3')
  await env.host.start()
  ticks(env, 3)
  const bFrames = env.ctx.frames.b
  env.host.activate(1)
  ticks(env, 2)
  env.host.disposeAt(1, '测试移除')
  const after = env.ctx.frames.b
  ticks(env, 10)
  check('T5a dispose 调用了宿主的 dispose（其内部走 mpwLoseContext）', env.ctx.disposed === 1)
  check('T5b loseContext 真被调用（桩 gl 计数）', env.ctx.lost === 1)
  check('T5c 存活的 WebGL 上下文数回落 3 → 2（不泄漏）', env.ctx.live === 2, env.ctx.live)
  check('T5d 从调度器摘除：dispose 后再也不出帧（0 帧增长）', env.ctx.frames.b === after)
  check('T5e 状态变 disposed（且不再被自动选中）', env.host.snapshot()[1].state === 'disposed' && !env.host.instances[1].selected)
  check('T5f dispose 后自动把 active 交给下一个存活实例（画面不会全停）', env.host.active() && env.host.active().id !== 'b')
  check('T5g mpwLoseContext 对没有扩展的上下文返回 false（不抛）', mpwLoseContext({ getExtension: () => null }) === false && mpwLoseContext(null) === false)
  check('T5h 同一实例重复 dispose 幂等', env.host.disposeAt(1, '再来一次') === false)
  check('T5i 创建 3 个 → disposeAll 后上下文数回落 0（设计文档第 5 步的断言）', (() => {
    env.host.disposeAll('测试收尾')
    return env.ctx.live === 0 && env.ctx.disposed === 3
  })(), { live: env.ctx.live, disposed: env.ctx.disposed })
}

console.log('[T6] /report 的 instances 字段（单实例不存在 / 多实例齐全）')
{
  const env = mkEnv(['a', 'b'], '?maxinst=2')
  await env.host.start()
  ticks(env, 2)
  const rows = env.host.reportInstances()
  const KEYS = ['id', 'state', 'ctxLost', 'fps', 'pending', 'drawn', 'paused', 'reason']
  check('T6a 每行含设计文档 §2.5 的 8 个字段（值类型正确）',
    rows.length === 2 && rows.every((r) => KEYS.every((k) => k in r) &&
      typeof r.id === 'string' && typeof r.state === 'string' && typeof r.ctxLost === 'number' &&
      typeof r.fps === 'number' && typeof r.pending === 'boolean' && typeof r.drawn === 'number' &&
      typeof r.paused === 'boolean' && typeof r.reason === 'string'), rows[0])
  check('T6b 多实例独有字段（selected/overLimit/errors/budget）在行里', rows.every((r) => 'selected' in r && 'overLimit' in r && 'budget' in r))
  const snap = env.host.snapshot()
  check('T6c __mpwInstances 形状 = 8 键（不多不少）', snap.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(KEYS)), Object.keys(snap[0]))
  check('T6d 计数真实：active 行的 drawn 随帧增长、paused 行为 0',
    snap[0].drawn > 0 && snap[1].drawn === 0 && snap[1].paused === true && snap[0].paused === false)
}

console.log('[T7] 一帧最多推进 1 个 active（设计文档 §2.3）')
{
  const env = mkEnv(['a', 'b', 'c', 'd'], '?inactive=pause')
  await env.host.start()
  const per = []
  for (let i = 0; i < 20; i++) { env.now += 16; const b4 = { ...env.ctx.frames }; env.host.tick(env.now); const adv = Object.keys(env.ctx.frames).filter((k) => env.ctx.frames[k] > (b4[k] || 0)); per.push(adv.length) }
  check('T7a pause 档：每帧推进的实例数恒 ≤ 1', per.every((n) => n <= 1), per.slice(0, 8))
  check('T7b 一帧最多 1 个 active（调度器记账）', env.host.frameStats.activeAdvanced <= env.host.frameStats.ticks)
  const e2 = mkEnv(['a', 'b', 'c', 'd'], '?inactive=idle&instfps=0,60')
  await e2.host.start()
  const per2 = []
  for (let i = 0; i < 20; i++) { e2.now += 16; const b4 = { ...e2.ctx.frames }; e2.host.tick(e2.now); const adv = Object.keys(e2.ctx.frames).filter((k) => e2.ctx.frames[k] > (b4[k] || 0)); per2.push(adv.map((k) => k).length) }
  check('T7c idle 档：每帧 ≤ 1 active + 1 idle（合计 ≤ 2）', per2.every((n) => n <= 2), per2.slice(0, 8))
  const acts = e2.host.advanceLog.filter((a) => a.kind === 'active')
  const byTick = {}
  for (const a of e2.host.advanceLog) { /* advanceLog 不记 tick 序号，改按帧统计 */ }
  check('T7d advanceLog 可审计：active 事件数 + 点选即时那一帧 = active 帧数',
    acts.length + 1 === e2.ctx.frames.a && e2.host.advanceLog.filter((x) => x.kind === 'activate').length === 1,
    { acts: acts.length, a: e2.ctx.frames.a })
}

console.log('[T8] 预算：maxinst ≥ 3 自动降档（720p + multi-idle 粒子档）')
{
  const b1 = mpwMultiBudget(mpwMultiParseOpts('?maxinst=1'), 1)
  const b2 = mpwMultiBudget(mpwMultiParseOpts('?maxinst=2'), 2)
  const b3 = mpwMultiBudget(mpwMultiParseOpts('?maxinst=3'), 3)
  check('T8a maxinst=2 且只有 1 格 ⇒ 不降档、不覆盖粒子预算（= 单实例同预算，供 N=1 对照）',
    b1.downgrade === false && b1.res === null && b1.particleBudget === null)
  check('T8a2 真多格（2 格）⇒ 粒子走 multi-idle 档，但画布不降档', b2.particleBudget && b2.particleBudget.tier === 'multi-idle' && b2.downgrade === false && b2.res === null)
  check('T8b maxinst=3 ⇒ 降档到 720p + multi-idle 粒子档', b3.downgrade === true && b3.res === '720p' && b3.particleBudget && b3.particleBudget.tier === 'multi-idle')
  check('T8c multi-idle 档 = normal × 0.25（240→60 / 1200→300 / 16→4 / 400→100 / 240→60）',
    MPW_MULTI_PARTICLE_BUDGET.perLayer === 60 && MPW_MULTI_PARTICLE_BUDGET.total === 300 &&
    MPW_MULTI_PARTICLE_BUDGET.layers === 4 && MPW_MULTI_PARTICLE_BUDGET.steps === 100 && MPW_MULTI_PARTICLE_BUDGET.rate === 60)
  const b3r = mpwMultiBudget(mpwMultiParseOpts('?maxinst=3&res=1440p'), 3)
  check('T8d ?res= 覆盖自动降档（仍然是降档态、但画布档由用户定）', b3r.res === '1440p' && b3r.downgrade === true)
  const b6 = mpwMultiBudget(mpwMultiParseOpts('?maxinst=4'), 6)
  check('T8e 超出上限的格子数可计算（6 id / maxinst=4 → over=2）', b6.over === 2)
  check('T8f 降档原因文案含"已降档"（状态条要标）', b3.reasons.some((s) => /已降档/.test(s)), b3.reasons)
  check('T8g demo.html 接线：降档在既有 cv.width 行**之后**另算（不改被 video-quality-test 钉住的那两行）+ 粒子档走 inst.particleBudget',
    /if \(inst\.res && !new URLSearchParams\(location\.search\)\.get\('res'\)\) \{\s*\n\s*const __resDown = lib\.parseResTier\(inst\.res\)/.test(HTML) &&
    /particleBudget: inst\.particleBudget,/.test(HTML) &&
    /cv\.width = __resTier\.width; cv\.height = __resTier\.height;/.test(HTML) &&
    /lib\.parseResTier\(new URLSearchParams\(location\.search\)\.get\('res'\)\)/.test(HTML))
  const env = mkEnv(['a', 'b', 'c'], '?maxinst=3')
  env.host.build()
  check('T8h 降档时状态条标"已降档"', env.host.instances[0].barEls.tag.textContent === '已降档')
}

console.log('[T9] 布局与日志收敛')
{
  for (const [layout, probe] of [['grid', /display:grid/], ['row', /flex-direction:row/], ['col', /flex-direction:column/]]) {
    const env = mkEnv(['a', 'b'], '?layout=' + layout)
    env.host.build()
    check('T9a layout=' + layout + ' 的容器样式正确', probe.test(env.host.root.style.cssText))
  }
  const env = mkEnv(['a', 'b'], '?instlog=all')
  await env.host.start()
  env.host.logfFor(0)('hello-A'); env.host.logfFor(1)('hello-B')
  check('T9b ?instlog=all：日志显示全部实例（带 [id] 前缀）', /\[a\] hello-A/.test(env.host.logText()) && /\[b\] hello-B/.test(env.host.logText()))
  check('T9c ?instlog=all 时日志写进 #log 元素', /hello-A/.test(env.logEl.textContent))
  const e2 = mkEnv(['a', 'b'], '')
  await e2.host.start()
  e2.host.logfFor(0)('A-only'); e2.host.logfFor(1)('B-only')
  check('T9d 默认只显示 active 实例的日志（其余各自收敛，不刷屏）', /A-only/.test(e2.host.logText()) && !/B-only/.test(e2.host.logText()), e2.host.logText())
  e2.host.activate(1)
  check('T9e 切到 b 后日志视图跟着换（active 语义）', /B-only/.test(e2.host.logText()) && !/A-only/.test(e2.host.logText()))
  check('T9f 每实例日志有环形上限（不吃内存）', MPW_MULTI_DEFAULTS.LOG_LINES > 0 && (() => {
    for (let i = 0; i < MPW_MULTI_DEFAULTS.LOG_LINES + 50; i++) e2.host.logfFor(1)('line' + i)
    return e2.host.instances[1].logLines.length === MPW_MULTI_DEFAULTS.LOG_LINES
  })())
  const e3 = mkEnv(['a'], '?inactive=pause')
  await e3.host.start()
  check('T9g 单格多实例（ids 只有 1 个）仍走多实例容器（用于 A/B 对照）', !!e3.host.root && e3.host.instances.length === 1)
}

console.log('[T10] demo.html 接线静态断言')
{
  check('T10a 新模块被 import（elysia/multi-instance.js）', /from '\.\/elysia\/multi-instance\.js'/.test(HTML))
  check('T10b 开关解析入口在 demo.html 里真实调用（?ids= 决定路由；query 对象绑定 location）',
    /const MPW_MULTI_Q = new URLSearchParams\(location\.search\);/.test(HTML) &&
    /const MPW_MULTI_IDS = mpwMultiParseIds\(MPW_MULTI_Q\);/.test(HTML))
  check('T10b2 六个新开关以正则字面量登记（diag-flag-check 的代码↔README 双向比对认这个形式）',
    ['ids', 'layout', 'maxinst', 'instfps', 'inactive', 'instlog'].every((f) => new RegExp('\\[\\?&\\]' + f + '=').test(HTML)))
  check('T10c 多实例 descriptor 带 scheduled:true（调度器驱动）与 per-instance logf',
    /scheduled: true,/.test(HTML) && /logf: mpwMultiHost\.logfFor\(rec\.i\)/.test(HTML) && /primary: rec\.i === 0/.test(HTML))
  check('T10d 未选中实例的 frame 由调度器控制：bootInstance 末尾 `if (!SCHEDULED)` 才自排 rAF',
    /if \(!SCHEDULED\) rafId = requestAnimationFrame\(frame\)/.test(HTML) && /if \(!SCHEDULED\) rafId = requestAnimationFrame\(frame\);/.test(HTML))
  check('T10e dispose 走 mpwLoseContext（WEBGL_lose_context.loseContext）并把引用清空',
    /mpwLoseContext\(gl\)/.test(HTML) && /textures\.clear\(\)/.test(HTML))
  check('T10f dispose 有显式路径：句柄 dispose() → cancelAnimationFrame + loseContext + textures.clear + 清 renderer/scene/pkg',
    /dispose: \(\) => \{/.test(HTML) && /cancelAnimationFrame\(rafId\)/.test(HTML) &&
    /renderer = null; scene = null; pkg = null;/.test(HTML) && /const mpwHandle = \{/.test(HTML))
  check('T10g __mpwInstances 由 onSnapshot 发布（8 键形状来自模块）', /window\.__mpwInstances = rows/.test(HTML))
  check('T10h 单实例时 window.__mpw* 既有全局仍由原代码写（多实例只镜像 active 的关键项）',
    /if \(MPW_WRITE_GLOBALS\) window\.__mpwFps = fpsNow/.test(HTML) &&
    /window\.__mpwInstances = rows/.test(HTML) && /window\.__mpwInstActive = a\.id; window\.__mpwFps = Math\.round\(a\.fps\)/.test(HTML))
  const pageGates = (HTML.match(/typeof PAGE === 'undefined' \|\| PAGE/g) || []).length
  check('T10i 页级 UI（属性面板/音频面板/媒体宿主/上报/自检/perf/缩略图）都加了 PAGE 门（多实例只跑 primary）',
    pageGates >= 9, pageGates)
}

console.log('[T11] 真接线动态跑：切 demo.html 的 `if (MPW_MULTI_IDS) {...}` 块 + 桩 bootInstance（不碰浏览器）')
{
  const i0 = HTML.indexOf('if (MPW_MULTI_IDS) {')
  const j0 = HTML.indexOf('} else {\n// ═══ ①(P-77 一页多实例·第 1 步) 单实例调用点', i0)
  const BLOCK = (i0 >= 0 && j0 > i0) ? HTML.slice(i0, j0 + 1) : ''   // j0+1 = 把 if 分支的闭合 `}` 带上（切片要能独立 eval）
  check('T11a 能切出多实例接线块（源码结构未变）', BLOCK.length > 800, BLOCK.length)
  const ids = ['a', 'b', 'c']
  const opts = mpwMultiParseOpts('?maxinst=2&layout=row')          // 顺带覆盖"超出上限"一格
  const budget = mpwMultiBudget(opts, ids.length)
  const doc = mkDoc(), logEl = mkEl('pre'), cv = mkEl('canvas')
  const win = { requestAnimationFrame: () => 7, cancelAnimationFrame() {}, addEventListener() {}, __mpwInstances: undefined }
  const calls = [], logs = []
  const bootInstance = (inst) => {
    calls.push(inst)
    return Promise.resolve({ id: inst.id, frame() {}, dispose() { calls.push('dispose:' + inst.id) } })
  }
  // eslint-disable-next-line no-new-func
  /* ⚠ 切片块现在还依赖模块级的 `lib.glCanvasAttrs()`（画布上下文属性的唯一来源，第 24 条）。
     桩必须把它一起注入：第一版漏了 ⇒ 块内抛 ReferenceError ⇒ `bootInstance` 一次都没调、T11c 读数是 `[]`。 */
  const libStub = { glCanvasAttrs: () => ({ alpha: false, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true, depth: true, stencil: false }) }
  /* ⚠ 切片块读 `location.search`（画布上下文属性走 `lib.glCanvasAttrs(location.search)`，第 24 条）
     ⇒ 桩里必须有 `location`。第一版只补了 `lib`、漏了 `location`：块内每个格子取上下文时抛
     ReferenceError（被逐格 try/catch 吞掉）⇒ `bootInstance` 0 次调用、T11c 读数 `[]`。 */
  const locationStub = { search: '', href: 'http://localhost/' }
  const run = new Function('cv', 'MPW_MULTI_IDS', 'MPW_MULTI_OPTS', 'MPW_MULTI_BUDGET', 'createMultiInstanceHost',
    'bootInstance', 'mpwMultiHost', 'log', 'logf', 'fpsEl', 'document', 'window', 'lib', 'location',
    BLOCK + '\nreturn { get host() { return mpwMultiHost } };')
  const api = run(cv, { ids, invalid: [{ raw: '@@x', reason: '非法 id（不是包 id 形状）' }], dupes: [] }, opts, budget,
    createMultiInstanceHost, bootInstance, null, logEl, (m) => logs.push(String(m)), mkEl('span'), doc, win, libStub, locationStub)
  const flush = async (n = 6) => { for (let k = 0; k < n; k++) await new Promise((r) => setTimeout(r, 0)) }
  await flush()
  const host = api.host
  check('T11b 宿主建起来了、网格容器在 DOM 里、#sc 让位（display:none）',
    !!host && !!doc.getElementById('mpw-inst-host') && cv.style.display === 'none')
  check('T11c 只对上限内的 2 格调 boot（第 3 格超出 maxinst=2 ⇒ 不建上下文）',
    calls.length === 2 && calls[0].id === 'a' && calls[1].id === 'b', calls.map((c) => (c && c.id) || c))
  check('T11d 每格拿到自己的 canvas + gl 由接线层创建（canvas 各不相同）',
    calls[0].canvas !== calls[1].canvas && calls[0].canvas === host.instances[0].canvas)
  check('T11e descriptor 形状：scheduled=true / primary 只给第一格 / res·particleBudget 来自预算 / logf 是函数',
    calls.every((c) => c.scheduled === true && typeof c.logf === 'function') &&
    calls[0].primary === true && calls[1].primary === false &&
    calls.every((c) => c.res === budget.res && c.particleBudget === budget.particleBudget))
  check('T11f 首格默认选中（active），其余 paused ⇒ window.__mpwInstances 已发布且 8 键齐全',
    host.active() && host.active().id === 'a' && win.__mpwInstances.length === 3 &&
    JSON.stringify(Object.keys(win.__mpwInstances[0])) === JSON.stringify(['id', 'state', 'ctxLost', 'fps', 'pending', 'drawn', 'paused', 'reason']),
    win.__mpwInstances)
  check('T11g 一帧只推进 1 个（pause 档）：手动 tick 10 次后只有首格在涨',
    (() => { let t = 5000; const before = host.instances.map((r) => r.drawn); for (let k = 0; k < 10; k++) host.tick((t += 16)); const after = host.instances.map((r) => r.drawn); return after[0] > before[0] && after[1] === before[1] && after[2] === before[2] })())
  check('T11h 启动日志含实例数/上限/布局（真机排障第一眼）',
    logs.some((l) => /一页多实例：3 个 id（上限 2，布局 row/.test(l)) && logs.some((l) => /忽略非法 id 1 个/.test(l)), logs)
  check('T11i 释放走宿主的 handle.dispose（→ mpwLoseContext），且状态转 disposed',
    (() => { host.disposeAt(0, '测试'); return calls.indexOf('dispose:a') > 0 && host.snapshot()[0].state === 'disposed' })())
}

console.log('\n' + (fail ? '✗' : '✅') + ' multi-instance-test：' + pass + ' 断言通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
// tools/silent-failure-guards-test.mjs —— ①(2026-09-23 静默失败审计) 四条客户端修复的**无浏览器**门禁
//   审计文件：../docs/SILENT-FAILURE-AUDIT-20260923.md（§A-1 表 #1 / §A-2 表 #2 / §A-10 表 #12）
//   资源审计：docs/RESOURCE-AUDIT-20260923.md（§2.1 #2 —— blob URL 只保留一支的结构性护栏，见 E 组）
//
// 为什么单开一个文件：这四条修的都是"**失败被当成正常值**"，判据的性质一样 ——
//   "把修复改回去，某一条必须变红"。它们分散在 client.js 的不同子系统里（注册入口 / 帧内 shim 通道 /
//   磨砂与样式自愈 / 帧内 localStorage 三态），各自的既有门禁（np-media / web-wallpaper / frost-rail /
//   settings-persist）只覆盖自己的主路径，没有一处钉住"失败要留痕"。
//
// 判据分组（每组都能单独变红；标签前缀是契约，变异子进程按 `✗ <组字母>` 匹配）：
//   A 注册入口（lib/client.js 尾部双 id 注册）：
//     A1 loader 抛错 ⇒ 两个 id 都试过（重试语义不变）+ `globalThis.__mpwRegisterErr` 有 id/msg + 两行 console.error
//     A2 `__ModuleLoader__` 整个缺失 ⇒ 同样留痕
//     A3 注册循环**之外**的异常（outer catch）⇒ `__mpwRegisterErr.id === '*'` + console.error
//     A4 成功路径零行为变化：`__mpwRegisterErr` 不存在 + `__mpwRegisteredIds` 可对拍
//     A5 idempotency 语义不变：已注册过 ⇒ 一个 id 都不再 load
//   B webShimCallChecked（帧内 shim 唯一控制通道）：
//     B1 送达成功 ⇒ true、台账零增长；B2 postMessage 抛错 ⇒ false + 台账 {op,where}
//     B3 没有 contentWindow ⇒ false + 累计计数 +1；B4 台账有上限（≤32 条）
//     B5 **原始 `webShimCall` 语义未被改动**：直接调它失败时**不**写台账（既有调用方零影响）
//     B6 `pauseWebFrame` 失败 ⇒ `powState().framePausedByUs === false`（修前无条件置 true）
//     B7 `pauseWebFrame` 成功 ⇒ 仍然记账 true、`resumeWebFrame` 仍然撤销（成功路径逐位不变）
//     B8 源码护栏：裸 `webShimCall(` 只剩"定义 + 包装内部那一处"（13 处调用点全部改走 checked）
//   C 磨砂/样式自愈的 8 处 catch 全部走 mpwErr：
//     C1/C2/C3 三处函数尾**运行时可观测**（querySelectorAll / MutationObserver 抛错 ⇒ 错误环里有 where）
//     C4 8 条修复后的 catch 字面量各出现恰好一次（4 处函数尾 + 4 处调用点；调用点的 catch 在被调方
//        自己吞掉异常后**不可达**，所以只能用源码判据 —— 报告里如实写明这一边界）
//   D 帧内 localStorage 读失败 ≠ "没存过"（applyWebCfg）：
//     D1 真·没存过 ⇒ 'empty'（既有语义：允许写默认值）/ D2 有存储 ⇒ 'ok' / D3 getItem 抛错 ⇒ 'error'
//     D4 JSON 损坏 ⇒ 'error' / D5 没有 localStorage 对象 ⇒ 'empty'（不变）
//     D6 `applyWebCfg` 必须"错误 ⇒ showError(readFail) + return"（拒绝写回），且 `ls.setItem` 在守卫之后
//     D7 `webcfg.readFail` 中英两套字典都在
//   E 结构性护栏（资源审计 #2）：每一处清 `npAudio.src` 后面都必须有 `npBlobUrlSet("")`；
//     blob 兜底必须"先设新 src 再 revoke 旧 URL"；revoke 只有一个出口
//
// 用法：
//   node tools/silent-failure-guards-test.mjs                 # 全部（含变异自证）
//   node tools/silent-failure-guards-test.mjs --no-mutations
//   node tools/silent-failure-guards-test.mjs --client <path> # 变异副本（真树不动）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const NO_MUT = process.argv.includes('--no-mutations')
const clientSrc = fs.readFileSync(clientPath, 'utf8')

let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  — ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-silent-'))
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 忽略 */ } })

const { loadPlugin } = await import('./_stub.mjs')

/* ══════════════ 会话守卫 & 环境（与 np-media-test 同一口径） ══════════════ */
const SESS_GUARDS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr',
  '__mpwBsVerAt', '__mpwGlobalWired', '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwSectionTest',
  '__mpwNpTest', '__mpwLifecycleTest', '__mpwWebTest', '__mpwPowerWired', '__mpwNpOwnsSound', '__mpwErrHook',
  '__mpwSandboxCapHook', '__mpwLnGuard', '__mpwWebShimHook', '__mpwNowPlaying', '__mpwNowPlayingSlotAction',
  '__mpwNpCtlSeq', '__mpwAppliedOnce', '__mpwShimCallFails', '__mpwShimCallFailN', '__mpwShimCallWarned']
function clearGuards() { for (const k of SESS_GUARDS) { try { delete globalThis[k] } catch { /* ignore */ } } }

/** 一份干净的桩环境（真 client.js + 真 apply）；返回 hooks 与一个可用的 web 帧。 */
function env(opts = {}) {
  clearGuards()
  const loaded = loadPlugin({ clientPath, settings: opts.settings || { enabled: true }, quiet: true })
  const doc = loaded.doc
  const wrap = doc.createElement('div'); wrap.id = 'mpw-bgWrap'
  const frame = doc.createElement('iframe'); frame.className = 'mpw-webFrame'
  frame.__attrs.set('src', opts.frameSrc || 'host:?custom=1&folder=1&file=index.html&mpwshim=1')
  wrap.querySelector = (sel) => (String(sel).indexOf('iframe') >= 0 ? frame : null)
  doc.body.appendChild(wrap)
  if (opts.postMessageThrows) frame.contentWindow = { postMessage() { throw new Error('帧已导航/已销毁（postMessage 抛错）') } }
  else if (opts.noContentWindow) frame.contentWindow = undefined
  else frame.contentWindow = { postMessage() {} }
  return { ...loaded, doc, wrap, frame, L: globalThis.__mpwLifecycleTest, W: globalThis.__mpwWebTest }
}
/** 静音 console.error（mpwErr 必打一行）并返回捕获数组 + 还原函数。 */
function captureConsoleError() {
  const list = []
  const orig = console.error
  console.error = (...a) => { list.push(a.map((x) => (x && x.message) || String(x)).join(' ')) }
  return { list, restore: () => { console.error = orig } }
}
const ringWheres = () => { try { return (globalThis.__mpwErrRing() || []).map((e) => String(e.where)) } catch { return [] } }

/* ══════════════ A. 注册入口：失败必须留痕（审计 §A-1 表 #3） ══════════════ */
console.log('\n== A. 双 id 注册入口：失败留痕（__mpwRegisterErr + console.error），重试/idempotency 语义不变 ==')
/** 在**隔离**的全局状态里求值一次 client.js（只跑注册尾部，不需要 DOM）。 */
function evalRegistration(mode) {
  for (const k of ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr']) { try { delete globalThis[k] } catch { /* ignore */ } }
  globalThis.window = globalThis
  const loads = []
  if (mode === 'throw') globalThis.__ModuleLoader__ = { load: (r) => { loads.push(String(r.id)); throw new Error('loader boom') } }
  else if (mode === 'ok' || mode === 'pre') globalThis.__ModuleLoader__ = { load: (r) => { loads.push(String(r.id)) } }
  else if (mode === 'missing') delete globalThis.__ModuleLoader__
  else if (mode === 'outer') {
    /* 让 `globalThis.__mpwRegistered = 1` 抛错 ⇒ 只能走 outer catch（内层 try 覆盖不到这一句） */
    globalThis.__ModuleLoader__ = { load: (r) => { loads.push(String(r.id)) } }
    Object.defineProperty(globalThis, '__mpwRegistered', { configurable: true, get: () => 0, set: () => { throw new Error('全局标记被占位/只读') } })
  }
  if (mode === 'pre') globalThis.__mpwRegistered = 1
  const cap = captureConsoleError()
  try { new Function('require', 'module', 'exports', clientSrc)(() => ({}), { exports: {} }, {}) }
  finally { cap.restore() }
  const out = { loads, errs: cap.list, regErr: globalThis.__mpwRegisterErr, ids: globalThis.__mpwRegisteredIds }
  if (mode === 'outer') { try { delete globalThis.__mpwRegistered } catch { /* ignore */ } }
  return out
}
{
  const A1 = evalRegistration('throw')
  ok(A1.loads.length === 2 && !!A1.regErr && A1.regErr.id === '@local/dsh-mpkg-wallpaper' && /loader boom/.test(String(A1.regErr.msg)) && A1.errs.length === 2,
    'A1 loader 抛错 ⇒ 两个 id **都试过**（重试语义保留）且失败留痕（id/msg 可读 + 两行 console.error）',
    JSON.stringify({ loads: A1.loads, regErr: A1.regErr, errs: A1.errs.length }))
  const A2 = evalRegistration('missing')
  ok(!!A2.regErr && /load/.test(String(A2.regErr.msg)) && A2.errs.length >= 1,
    'A2 `__ModuleLoader__` 整个缺失（宿主载入器没装）⇒ 同样留痕（不再是"什么都没有、日志零线索"）',
    JSON.stringify({ regErr: A2.regErr, errs: A2.errs.length }))
  const A3 = evalRegistration('outer')
  ok(!!A3.regErr && A3.regErr.id === '*' && /只读|占位/.test(String(A3.regErr.msg)) && A3.errs.length === 1,
    'A3 注册循环**之外**的异常走 outer catch：`__mpwRegisterErr.id === "*"` + console.error（两处 catch 都留痕）',
    JSON.stringify({ regErr: A3.regErr, errs: A3.errs.length }))
  const A4 = evalRegistration('ok')
  ok(A4.regErr === undefined && A4.loads.length === 2 && Array.isArray(A4.ids) && A4.ids.length === 2,
    'A4 成功路径零行为变化：`__mpwRegisterErr` 不存在、两个 id 都注册、台账 `__mpwRegisteredIds` 可对拍',
    JSON.stringify({ regErr: A4.regErr, loads: A4.loads, ids: A4.ids }))
  const A5 = evalRegistration('pre')
  ok(A5.loads.length === 0 && A5.regErr === undefined,
    'A5 idempotency 语义不变：已注册过 ⇒ 一个 id 都不再 load（`__mpwRegistered` 仍先置位）',
    JSON.stringify({ loads: A5.loads, regErr: A5.regErr }))
}

/* ══════════════ B. webShimCallChecked：可判定返回值必须被读（审计 §A-1 表 #1） ══════════════ */
console.log('\n== B. 帧内 shim 通道：读返回值 + 失败台账 + `pauseWebFrame` 失败不记 `webFramePausedByUs` ==')
{
  const E = env()
  const L = E.L
  let posts = 0
  const good = { contentWindow: { postMessage() { posts++ } } }
  const dead = { contentWindow: { postMessage() { throw new Error('detached') } } }
  const bare = {}
  const r1 = L.shimCallChecked(good, { op: 'policy' }, 'unit-ok')
  const n1 = L.shimFailN()
  const r2 = L.shimCallChecked(dead, { op: 'pause' }, 'unit-dead')
  const f2 = L.shimFails()
  ok(r1 === true && posts === 1 && n1 === 0,
    'B1 送达成功 ⇒ true、postMessage 真的被调用、台账零增长',
    JSON.stringify({ r1, posts, n1 }))
  ok(r2 === false && f2.length === 1 && f2[0].op === 'pause' && f2[0].where === 'unit-dead',
    'B2 postMessage 抛错 ⇒ false + 台账记下 {op,where}（这就是"点了暂停但没生效"的唯一线索）',
    JSON.stringify({ r2, fails: f2 }))
  const r3 = L.shimCallChecked(bare, { op: 'props' }, 'unit-noframe')
  ok(r3 === false && L.shimFailN() === 2,
    'B3 没有 contentWindow（帧已销毁）⇒ false + 累计计数 +1（`__mpwShimCallFailN` 单调可观测）',
    JSON.stringify({ r3, failN: L.shimFailN() }))
  for (let i = 0; i < 40; i++) L.shimCallChecked(bare, { op: 'ping' }, 'unit-flood')
  ok(L.shimFails().length === 32,
    'B4 台账有上限（≤32 条）：长跑/每次 apply 都失败也不会把内存与诊断面板刷爆',
    'len=' + L.shimFails().length)
  /* B5：修法的前提是**不动 `webShimCall` 自身**（13 处调用点里还有探针/门禁直接调它） */
  const nBefore = L.shimFailN()
  const raw = E.W.call(dead, { op: 'pause' })
  ok(raw === false && L.shimFailN() === nBefore,
    'B5 原始 `webShimCall` 语义未变：直接调它失败时返回 false 且**不**写台账（既有调用方零影响）',
    JSON.stringify({ raw, failN: L.shimFailN(), nBefore }))
  const E2 = env({ postMessageThrows: true })
  const nFail0 = E2.L.shimFailN()
  E2.L.pauseWebFrame()
  const st2 = E2.L.powState()
  const last = E2.L.shimFails().slice(-1)[0] || null
  ok(st2.framePausedByUs === false && E2.L.shimFailN() === nFail0 + 1 && !!last && last.where === 'pauseWebFrame',
    'B6 `pauseWebFrame` 失败 ⇒ **不**记 `webFramePausedByUs`（修前无条件置 true ⇒ 恢复时会 play() 作者自己停着的媒体）',
    JSON.stringify({ pow: st2, failN: E2.L.shimFailN(), last }))
  const E3 = env()
  E3.L.pauseWebFrame()
  const stOk = E3.L.powState()
  E3.L.resumeWebFrame()
  ok(stOk.framePausedByUs === true && E3.L.powState().framePausedByUs === false && E3.L.shimFailN() === 0,
    'B7 `pauseWebFrame` 成功路径逐位不变：仍然记账 true、`resumeWebFrame` 仍然撤销',
    JSON.stringify({ paused: stOk.framePausedByUs, after: E3.L.powState().framePausedByUs, failN: E3.L.shimFailN() }))
  const bareCalls = (clientSrc.match(/webShimCall\(/g) || []).length
  const checkedCalls = (clientSrc.match(/webShimCallChecked\(/g) || []).length
  /* 15 = 定义 1 + 包装内部 1 + 13 个调用点；裸 2 = 定义 + 包装内部。把任一调用点改回裸调用 ⇒ 两数各挪 1。 */
  ok(bareCalls === 2 && checkedCalls === 15,
    'B8 源码护栏：裸 `webShimCall(` 只剩"定义 + 包装内部那一处"（=2），13 个调用点全部改走 checked',
    JSON.stringify({ bareCalls, checkedCalls }))
}

/* ══════════════ C. 磨砂/样式自愈的 catch 必须走 mpwErr（审计 §A-2 表 #2） ══════════════ */
console.log('\n== C. 磨砂同步 / 样式自愈的 8 处 catch：一律走 mpwErr（本文件 61-62 的"致命路径必须报"白名单）==')
{
  const E = env()
  const L = E.L
  const cap = captureConsoleError()
  const realQSA = E.doc.querySelectorAll
  E.doc.querySelectorAll = () => { throw new Error('第三方插件替换/弄坏了 querySelectorAll') }
  L.applyFrostInline({})
  const c1 = ringWheres().includes('applyFrostInline')
  L.applyCompatBridges({})
  const c2 = ringWheres().includes('applyCompatBridges')
  E.doc.querySelectorAll = realQSA
  const realMO = globalThis.MutationObserver
  globalThis.MutationObserver = class { constructor() { throw new Error('MutationObserver 不可用') } }
  L.startFrostObserver()
  const c3 = ringWheres().includes('startFrostObserver')
  globalThis.MutationObserver = realMO
  cap.restore()
  ok(c1, 'C1 `applyFrostInline` 函数尾：抛错 ⇒ `__mpwErrRing()` 里有 "applyFrostInline"（修前空 catch ⇒ 磨砂整块静默失效）', JSON.stringify(ringWheres()))
  ok(c2, 'C2 `applyCompatBridges` 函数尾：抛错 ⇒ 有 "applyCompatBridges"', JSON.stringify(ringWheres()))
  ok(c3, 'C3 `startFrostObserver` 函数尾：观察器起不来 ⇒ 有 "startFrostObserver"（**观察器没起来 = 永远不自愈**）', JSON.stringify(ringWheres()))
  const FIXED = [
    'catch (e) { mpwErr("applyCompatBridges+startCompatObserver(web)", e); }',
    'catch (e) { mpwErr("applyFrostInline+startFrostObserver(web)", e); }',
    'catch (e) { mpwErr("refreshAqua+refreshRailInk+scheduleAquaTint(apply)", e); }',
    'catch (e) { mpwErr("applyCompatBridges+startCompatObserver", e); }',
    'catch (e) { mpwErr("applyFrostInline", e); }',
    'catch (e) { mpwErr("startFrostObserver", e); }',
    'catch (e) { mpwErr("applyCompatBridges", e); }',
    'catch (e) { mpwErr("startCompatObserver", e); }',
  ]
  const counts = FIXED.map((s) => clientSrc.split(s).length - 1)
  ok(counts.every((c) => c === 1),
    'C4 8 条修复后的 catch 字面量各出现**恰好一次**（4 处函数尾 + 4 处调用点；任一条被改回 `catch {}` ⇒ 本组红）',
    JSON.stringify(counts))
}

/* ══════════════ D. 帧内 localStorage："读失败" ≠ "没存过"（审计 §A-10 表 #12） ══════════════ */
console.log('\n== D. 帧内 localStorage 读取三态：读失败 ⇒ 报错 + 拒绝写回（否则覆盖用户在帧内改过的设置）==')
{
  const E = env()
  const W = E.W
  const d1 = W.frameStored({ getItem: () => null }, 'setting')
  const d2 = W.frameStored({ getItem: () => JSON.stringify({ SettingModel: { bgmVolume: 0.3 } }) }, 'setting')
  const d3 = W.frameStored({ getItem() { throw new Error('SecurityError: 帧内 localStorage 不可达') } }, 'setting')
  const d4 = W.frameStored({ getItem: () => '{坏 JSON' }, 'setting')
  const d5 = W.frameStored(null, 'setting')
  ok(d1 && d1.state === 'empty' && d1.stored === null,
    "D1 真·没存过（getItem 回 null）⇒ state='empty'（既有语义不变：允许用默认值合并后写回）", JSON.stringify(d1))
  ok(d2 && d2.state === 'ok' && d2.stored && d2.stored.SettingModel && d2.stored.SettingModel.bgmVolume === 0.3,
    "D2 有存储 ⇒ state='ok' 且拿到用户真实值（对照组：修复不许把正常读取也挡掉）", JSON.stringify(d2))
  ok(d3 && d3.state === 'error' && /SecurityError/.test(String(d3.err && d3.err.message)),
    "D3 getItem 抛错 ⇒ state='error'（修前被吞成 null = '没存过' ⇒ 默认值整串覆盖用户设置）",
    JSON.stringify({ state: d3 && d3.state, msg: d3 && d3.err && d3.err.message }))
  ok(d4 && d4.state === 'error', "D4 JSON 损坏 ⇒ state='error'（同上：解析失败也不是'没存过'）", JSON.stringify({ state: d4 && d4.state }))
  ok(d5 && d5.state === 'empty', "D5 没有 localStorage 对象 ⇒ 'empty'（降级路径语义不变）", JSON.stringify(d5))
  const i0 = clientSrc.indexOf('const applyWebCfg = (patch, live) =>')
  const i1 = clientSrc.indexOf('const applyCustomWebReal', i0)
  const body = i0 >= 0 && i1 > i0 ? clientSrc.slice(i0, i1) : ''
  const iRead = body.indexOf('mpwReadFrameStored(ls, skelKey)')
  const iGuard = body.indexOf('if (rd.state === "error")')
  const iFail = body.indexOf('webcfg.readFail')
  const iRet = body.indexOf('return;', iGuard)
  const iSet = body.indexOf('ls.setItem(skelKey')
  ok(iRead > 0 && iGuard > iRead && iFail > iGuard && iRet > iFail && iSet > iRet,
    'D6 `applyWebCfg` 的守卫顺序：先三态读取 → 错误分支 showError(readFail) + return → **之后**才是 ls.setItem',
    JSON.stringify({ iRead, iGuard, iFail, iRet, iSet, bodyLen: body.length }))
  const dicts = (clientSrc.match(/"webcfg\.readFail": "/g) || []).length
  ok(dicts === 2, 'D7 `webcfg.readFail` 文案中英两套字典都在（缺失 ⇒ 用户看到的是一串键名）', 'count=' + dicts)
}

/* ══════════════ E. 结构性护栏：np blob URL 的每一个清 src 点都要 revoke（资源审计 #2） ══════════════ */
console.log('\n== E. np blob 兜底 URL：清 src 必伴随 revoke、先设新 src 再 revoke、revoke 只有一个出口 ==')
{
  const lines = clientSrc.split('\n')
  const sites = []
  lines.forEach((l, i) => { if (l.indexOf('npAudio.removeAttribute("src")') >= 0) sites.push(i) })
  /* 窗口 5 行：卸载那处的清 src 与 revoke 之间隔着两行注释（见 npDropAudio） */
  const withoutRevoke = sites.filter((i) => lines.slice(i, i + 5).join('\n').indexOf('npBlobUrlSet("")') < 0)
  ok(sites.length === 4 && withoutRevoke.length === 0,
    'E1 每一处清 `npAudio.src`（4 处：硬归零 / 换壁纸清源 ×2 / 卸载）后面 5 行内都有 `npBlobUrlSet("")`',
    JSON.stringify({ sites: sites.map((i) => i + 1), withoutRevoke: withoutRevoke.map((i) => i + 1) }))
  const iObj = clientSrc.indexOf('npAudio.src = obj;')
  const blobTail = iObj >= 0 ? clientSrc.slice(iObj, iObj + 200) : ''
  const iSet = blobTail.indexOf('npBlobUrlSet(obj);')
  ok(iObj > 0 && iSet > 0 && iSet < blobTail.indexOf('npAudio.play()'),
    'E2 blob 兜底：`npAudio.src = obj` 之后紧跟 `npBlobUrlSet(obj)`（**先设新 src 再 revoke 旧 URL**）',
    JSON.stringify(blobTail.split('\n').slice(0, 4)))
  const revokers = (clientSrc.match(/URL\.revokeObjectURL\(prev\)/g) || []).length
  ok(revokers === 1, 'E3 revoke 只有**一个**出口（`npBlobUrlSet`）：新增清 src 路径时不可能绕开台账', 'revokers=' + revokers)
}

/* ══════════════ F. 分辨力自证（RED-if-reverted） ══════════════ */
const MUTS = [
  {
    id: 'register-silent-again', expect: 'A',
    why: '①(§A-1 表 #3) 把注册入口的四处留痕（两处 __mpwRegisterErr + 两处 console.error）删掉 = 审计原样：'
      + '插件整个没注册上，用户只看到"什么都没有"、日志零线索',
    mut: (s) => s
      .replace('\t\t\t\t\ttry { globalThis.__mpwRegisterErr = { id: __mpwId, msg: String((e && e.message) || e), at: Date.now() }; } catch (e2) {}\n', '')
      .replace('\t\t\t\t\ttry { console.error("[dsh-mpkg-wallpaper] 注册失败（插件不会加载）: " + __mpwId, e); } catch (e2) {}\n', '')
      .replace('\t\ttry { globalThis.__mpwRegisterErr = { id: "*", msg: String((e && e.message) || e), at: Date.now() }; } catch (e2) {}\n', '')
      .replace('\t\ttry { console.error("[dsh-mpkg-wallpaper] 注册入口异常（插件不会加载）:", e); } catch (e2) {}\n', ''),
  },
  {
    id: 'pause-webframe-claims-credit-again', expect: 'B',
    why: '①(§A-1 表 #1) 把 `pauseWebFrame` 的记账改回无条件 `webFramePausedByUs = true` = 审计原样：'
      + 'shim 没送达也记成"我们按下的暂停" ⇒ 恢复时 play() 作者自己停着的媒体',
    mut: (s) => s.replace('\t\t\t\twebFramePausedByUs = !!(shimOk || n > 0);', '\t\t\t\twebFramePausedByUs = true;'),
  },
  {
    id: 'bare-webshimcall-resurrected', expect: 'B',
    why: '①(§A-1 表 #1) 把一个调用点改回裸 `webShimCall(...)`（忽略返回值）= 审计原样：'
      + '13 个调用点全部忽略可判定返回值 —— 这条是 B8 源码护栏的分辨力证明',
    mut: (s) => s.replace('webShimCallChecked(frame, { op: "ping" }, "webShimAfterLoad");', 'webShimCall(frame, { op: "ping" });'),
  },
  {
    id: 'frost-catch-silent-again', expect: 'C',
    why: '①(§A-2 表 #2) 把 `applyFrostInline` 函数尾改回 `catch (e) {}` = 审计原样：'
      + '磨砂同步整块静默失效（本文件 63-65 自述的"磨砂三轮没修好"同一形态）',
    mut: (s) => s.replace('\t\t\t} catch (e) { mpwErr("applyFrostInline", e); }', '\t\t\t} catch (e) {}'),
  },
  {
    id: 'frame-ls-read-fail-as-empty-again', expect: 'D',
    why: '①(§A-10 表 #12) 把三态里的 error 改回 empty = 审计原样：读失败被当成"没存过"，'
      + '随后把默认值写回，覆盖用户在帧内改过的真实设置',
    mut: (s) => s.replace('\t\t\t\treturn { state: "ok", stored: JSON.parse(raw), err: null };\n\t\t\t} catch (e) { return { state: "error", stored: null, err: e } }',
      '\t\t\t\treturn { state: "ok", stored: JSON.parse(raw), err: null };\n\t\t\t} catch (e) { return { state: "empty", stored: null, err: null } }'),
  },
  {
    id: 'webcfg-writeback-guard-removed', expect: 'D',
    why: '①(§A-10 表 #12) 删掉 applyWebCfg 读失败分支里的 `return;`（只报错、照样往下写回）= 修了一半：'
      + '用户设置仍会被默认值覆盖',
    mut: (s) => s.replace('showError(t("webcfg.readFail") + String((readErr && readErr.message) || readErr));\n\t\t\t\t\t\treturn;',
      'showError(t("webcfg.readFail") + String((readErr && readErr.message) || readErr));'),
  },
  {
    id: 'np-clear-src-skips-revoke', expect: 'E',
    why: '①(资源审计 #2) 把 npFetchTracks 换壁纸清源那处的 `npBlobUrlSet("")` 删掉 ⇒ 上一张壁纸的 blob URL 留在 registry',
    mut: (s) => s.replace('\t\t\t\t\t\t\tnpBlobUrlSet("");\n\t\t\t\t\t\t\tapplyNowPlaying(readSection());',
      '\t\t\t\t\t\t\tapplyNowPlaying(readSection());'),
  },
]
if (!NO_MUT) {
  console.log('\n== F. 分辨力自证：' + MUTS.length + ' 组变异必须各自让**指定那一组**变红（副本在 mkdtemp，真树不动）==')
  const GROUPS = { A: /✗ A\d/, B: /✗ B\d/, C: /✗ C\d/, D: /✗ D\d/, E: /✗ E\d/ }
  for (const m of MUTS) {
    const mutated = m.mut(clientSrc)
    if (mutated === clientSrc) { ok(false, 'F 变异 ' + m.id + ' 注入成功', '注入点没匹配上（源码改了？）'); continue }
    const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-mutations', '--client', copy], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 })
    const out = (r.stdout || '') + (r.stderr || '')
    const caught = Object.keys(GROUPS).filter((g) => GROUPS[g].test(out))
    const got = caught.includes(m.expect) ? m.expect : (r.status === 0 ? 'PASS' : 'FAIL(其它)')
    ok(got === m.expect, 'F 变异 ' + m.id + '：期望 ' + m.expect + ' 组变红，实际 ' + got, m.why + '  [exit=' + r.status + ']')
    if (got !== m.expect) console.error('      ↑ 实际报红分组：[' + caught.join(',') + ']')
  }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail) { console.error('✗ 静默失败门禁未通过'); process.exit(1) }
console.log('✓ 静默失败门禁通过：注册留痕 / shim 通道可判定 / 磨砂 8 处报错 / 帧内存储三态 / blob URL 护栏 —— 全部有判据，且各有变异自证')

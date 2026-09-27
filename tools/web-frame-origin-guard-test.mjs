// tools/web-frame-origin-guard-test.mjs —— ①(2026-09-28 P-205 安全审计 F5) 网页壁纸**同源逃逸**判据。
//
// 审计（同工作区 docs/reverse/SECURITY-AUDIT-secret-exfil-20260925.md §F5，根因行号按符号重新对锚）：
//   改前 `lib/client.js` 的 `mpwIsWebFrameMsg`（只查 `ev.source === frame.contentWindow`）+ 两条自动降档
//   （`webShimArm` 的 2.5s 兜底、`mpwWebSandboxFallback` 的"策略类错误"兜底）把帧的 sandbox 属性写成
//   `allow-scripts allow-same-origin allow-pointer-lock` ⇒ 第三方网页壁纸脚本升到**与 DSH 同源**。
//   作者页只需 `parent.postMessage({mpw:'mpw:web',op:'error',kind:'SecurityError',message:'…sandbox…'})`
//   就能触发（消息确实来自我们自己那个 frame ⇒ source 校验挡不住）。
//
// 本文件判据（对着 F5 的四条验收）：
//   A 默认档（auto + 回退口关）：①伪造 policy 错误（source/origin 都对）⇒ **不降档**（sandbox 属性一字不改）
//     且记账（`autoBlocked`）；②`ev.origin` 不符 ⇒ **忽略**（`rejects`/`rejectReasons.origin`）；
//     ③`ev.source` 不符 ⇒ 忽略；④2.5s shim 兜底只**去标记重载**，仍不换源（`reloads`）。
//   B 合法显式路径不被挡：`webFrameMode=compat` / `?webframe=compat` ⇒ 仍是 compat（attr 含 allow-same-origin）；
//     显式档被策略挡住 ⇒ 只记账不换档。
//   C 回退口（**风险档**）：`webFrameAutoCompat:true` ⇒ 才允许自动降 compat，且台账标 `risk:'same-origin'`。
//   D 变异自证（子进程 + 源码注入）：去掉 origin 校验 / 去掉 source 校验 / 强制 autoCompat ⇒ A 段必红。
//
// 用法: node tools/web-frame-origin-guard-test.mjs
// 纯 Node，无浏览器、无网络、无 ffmpeg；只读 lib/client.js（变异写 os.tmpdir() 副本）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(here, '..')
const CLIENT = path.join(REPO, 'lib', 'client.js')
/* 变异子进程：用注入后的副本，且**不再**跑变异段（否则孙进程 = fork 炸弹） */
const MUT_CLIENT = process.env.MPW_WEBFRAME_MUT_CLIENT ? path.resolve(process.env.MPW_WEBFRAME_MUT_CLIENT) : CLIENT
const NO_MUT = !!process.env.MPW_WEBFRAME_MUT_CLIENT

let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? ' → ' + detail : '')) }
}
const eq = (a, b, name) => ok(a === b, name, a === b ? '' : `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PAGE_ORIGIN = 'http://127.0.0.1:3080'
const SHIM_URL = '/api/mpkg-wallpaper/custom-folder/f1/index.html?mpwshim=1&mpwmute=1'
const SAND_ATTR = 'allow-scripts'
const COMPAT_ATTR = 'allow-scripts allow-same-origin allow-pointer-lock'

/* 每个"世界"重装：client.js 有单实例守卫（不清就在同一进程里 loadPlugin 不到注册） */
const SESS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwWebTest', '__mpwSceneTest', '__mpwWebShimHook', '__mpwWebFrameGuard', '__mpwSceneUrlGuard']
const clearGuards = () => { for (const k of SESS) { try { delete globalThis[k] } catch { /* ignore */ } } }

/** 假帧：`bgElements().frame` 在桩里查不到（桩的 querySelector 恒 null）⇒ 判据显式传入。
 *  带属性表 + `src` 访问器 + **每次 setAttribute 的历史**（用来证明"从没写过 allow-same-origin"）。 */
function mkFrame(src, sandbox) {
  const attrs = new Map([['src', String(src)], ['sandbox', String(sandbox)]])
  const log = []
  const frame = {
    contentWindow: { __fakeFrame: true },
    attrs, attrLog: log, srcLog: [],
    getAttribute(k) { const key = String(k); return attrs.has(key) ? attrs.get(key) : null },
    setAttribute(k, v) { const key = String(k); attrs.set(key, String(v)); log.push([key, String(v)]) },
    removeAttribute(k) { attrs.delete(String(k)) },
    get src() { return attrs.get('src') || '' },
    set src(v) { attrs.set('src', String(v)); frame.srcLog.push(String(v)) },
    __mpwShimOk: false, __mpwShimFellBack: false, __mpwSandboxFallback: null, __mpwShimTimer: 0,
  }
  return frame
}
const sandboxAttr = (f) => String(f.getAttribute('sandbox') || '')
const everSameOrigin = (f) => f.attrLog.some(([k, v]) => k === 'sandbox' && /allow-same-origin/.test(v))

/** 重装一个世界并取钩子。 */
function world(opts = {}) {
  clearGuards()
  const T = loadPlugin(Object.assign({ quiet: true, clientPath: MUT_CLIENT }, opts))
  const W = globalThis.__mpwWebTest
  if (!W) throw new Error('__mpwWebTest 未暴露（client.js 的测试钩子块没跑？）')
  return { T, W }
}
const forgedPolicyError = () => ({ mpw: 'mpw:web', op: 'error', kind: 'SecurityError', message: "Failed to construct 'Worker': Access to the script at 'blob:null/1' is denied by the sandbox" })

/* ══════════════ A. 默认档：伪造错误不降档 + 来源校验 + 记账 ══════════════ */
console.log('\n== A. 默认档 auto（webFrameAutoCompat 关）：伪造 policy 错误不得升同源 ==')
{
  const { W, T } = world()
  const f = mkFrame(SHIM_URL, SAND_ATTR)
  W.frameStatusSet({})
  eq(W.framePlan().mode + '/' + W.framePlan().fallbackMode + '/autoCompat=' + W.frameAutoCompat(), 'auto/sandbox/autoCompat=false', 'A0 默认档计划：auto，自动降档落点 = sandbox，回退口关')

  /* A1 source + origin 都对 ⇒ 走到"策略类错误"分支，但**默认不换源** */
  const r1 = W.frameFallback('script-error', 'SecurityError: sandbox', f)
  eq(r1, false, 'A1 伪造 policy 错误（source/origin 都对）⇒ 降档动作返回 false')
  eq(sandboxAttr(f), SAND_ATTR, 'A1 sandbox 属性一字不改（仍是不透明源，没有 allow-same-origin）')
  eq(everSameOrigin(f), false, 'A1 帧历史上**从未**写过 allow-same-origin')
  eq(W.frameGuard().autoBlocked, 1, 'A1 台账记下"自动降档被拦"1 次（不静默）')
  eq(W.frameGuard().lastAutoBlocked.blockedBy, 'auto-compat-off', 'A1 台账写明被谁拦（auto-compat-off）')
  eq(W.frameGuard().lastAutoBlocked.by, 'frame-message', 'A1 台账写明触发者（frame-message）')
  eq(W.frameStatus().mode + '/' + (W.frameStatus().attr === SAND_ATTR ? 'sandbox-attr' : 'other') + '/degraded=' + String(W.frameStatus().degraded), 'auto/sandbox-attr/degraded=false', 'A1 可查状态：档仍是 auto（实际属性 = 沙箱），未标记降级')

  /* A2 走真实入站 handler：origin 不符 ⇒ 忽略（连"策略错误"都不该被处理） */
  const before = W.frameGuard().autoBlocked
  const cw = f.contentWindow
  W.frameMsg({ data: forgedPolicyError(), origin: PAGE_ORIGIN, source: cw }, f)     // 沙箱帧的 origin 必须是 "null"
  eq(W.frameGuard().rejects, 1, 'A2 ev.origin 不符（沙箱帧却报页面源）⇒ 拒收 1 条')
  eq(W.frameGuard().rejectReasons.origin, 1, 'A2 拒收原因 = origin（可数）')
  eq(W.frameGuard().lastReject.expected, 'null', 'A2 台账写明"期望来源 = null"（不透明源）')
  eq(W.frameGuard().autoBlocked, before, 'A2 被拒消息**不进**降档判定（autoBlocked 不涨）')
  eq(sandboxAttr(f), SAND_ATTR, 'A2 被拒后 sandbox 属性仍不变')

  /* A3 ev.source 不符（另一个窗口）⇒ 忽略 */
  W.frameMsg({ data: forgedPolicyError(), origin: 'null', source: { __other: true } }, f)
  eq(W.frameGuard().rejects, 2, 'A3 ev.source 不是我们这个 frame ⇒ 再拒 1 条')
  eq(W.frameGuard().rejectReasons.source, 1, 'A3 拒收原因 = source（可数）')

  /* A4 来源都对 ⇒ 处理器**确实在处理**（否则 A2/A3 的"拒收"可能是假绿：全都拒） */
  const diagN0 = T.diagEvents.filter((d) => d.why === 'script-error').length
  W.frameMsg({ data: forgedPolicyError(), origin: 'null', source: cw }, f)
  eq(W.frameGuard().rejects, 2, 'A4 source+origin 都对 ⇒ 不再计拒收')
  ok(diagN0 >= 1, 'A4 该错误被如实记账（/diag 的 script-error 信标）', 'diag=' + diagN0)
  eq(W.frameGuard().autoBlocked >= 2, true, 'A4 同时记一条"自动降档被拦"（A1 的那条 + 这条）')
}

/* A5 2.5s shim 兜底：只去 shim 标记重载，**不换源** */
console.log('\n== A5. shim 未报到（2.5s）：只去 mpwshim 标记重载，sandbox 属性仍是不透明源 ==')
{
  const { W } = world()
  const f = mkFrame(SHIM_URL, SAND_ATTR)
  W.frameShimArm(f)
  await sleep(2750)
  ok(f.srcLog.length === 1 && f.srcLog[0].indexOf('mpwshim=1') < 0, 'A5 帧被重载且 URL 去掉了 mpwshim=1', 'src=' + String(f.srcLog[0] || '').slice(0, 90))
  eq(sandboxAttr(f), SAND_ATTR, 'A5 重载后 sandbox 属性仍是 allow-scripts（**不**自动升同源）')
  eq(everSameOrigin(f), false, 'A5 这条路径也从未写过 allow-same-origin')
  eq(W.frameGuard().reloads, 1, 'A5 台账记"只去标记重载"1 次')
  eq(W.frameGuard().downgrades, 0, 'A5 台账里换档次数 = 0')
}

/* 记录该世界的 /diag 信标条数（桩把 POST /diag 的 body 收进 T.diagEvents） */

/* ══════════════ B. 合法显式路径不被挡 ══════════════ */
console.log('\n== B. 显式档（用户合法路径）：compat 仍生效，sandbox 仍不自动降 ==')
{
  const { W } = world({ settings: { webFrameMode: 'compat' } })
  const p = W.framePlan()
  eq(p.mode + '/' + (p.attr === COMPAT_ATTR ? 'compat-attr' : 'sandbox-attr') + '/shim=' + p.shim + '/degradable=' + p.degradable,
    'compat/compat-attr/shim=false/degradable=false', 'B1 设置项 webFrameMode=compat ⇒ 兼容档照旧生效（合法路径不被闸门挡）')
  const f = mkFrame('/api/mpkg-wallpaper/custom-folder/f1/index.html', COMPAT_ATTR)
  W.frameFallback('script-error', 'SecurityError: sandbox', f)
  eq(sandboxAttr(f), COMPAT_ATTR, 'B2 显式 compat 档被"策略错误"撞上 ⇒ 属性不变（已是最宽档）')
  eq(W.frameGuard().lastAutoBlocked.blockedBy, 'explicit-tier', 'B2 台账写明被拦原因（explicit-tier）')
  eq(W.frameGuard().downgrades, 0, 'B2 台账换档次数 = 0')
}
{
  const { W } = world({ search: '?webframe=compat' })
  eq(W.frameResolve().mode + '/' + W.frameResolve().source, 'compat/query', 'B3 ?webframe=compat（URL 显式）⇒ 兼容档，且 source=query')
  const f = mkFrame('/api/mpkg-wallpaper/custom-folder/f1/index.html', COMPAT_ATTR)
  const r = W.frameIsMsg({ data: forgedPolicyError(), origin: PAGE_ORIGIN, source: f.contentWindow }, f)
  eq(r, true, 'B3 compat 帧（allow-same-origin + 同源 src）⇒ 页面源的消息被接收（校验没把合法帧挡死）')
}
{
  const { W } = world({ settings: { webFrameMode: 'sandbox' } })
  const f = mkFrame(SHIM_URL, SAND_ATTR)
  eq(W.framePlan().degradable, false, 'B4 显式 sandbox ⇒ degradable=false')
  W.frameFallback('script-error', 'SecurityError: sandbox', f)
  eq(sandboxAttr(f), SAND_ATTR, 'B4 显式 sandbox 被策略挡住 ⇒ 仍不换档')
  eq(W.frameGuard().lastAutoBlocked.blockedBy, 'explicit-tier', 'B4 台账原因 = explicit-tier')
}

/* ══════════════ C. 回退口（风险档）：显式打开后才允许自动降 compat ══════════════ */
console.log('\n== C. 回退口 webFrameAutoCompat=true：显式打开才允许自动降 compat（有风险） ==')
const dg = []
{
  const { W } = world({ settings: { webFrameAutoCompat: true }, fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }) })
  eq(W.frameAutoCompat(), true, 'C1 设置项 webFrameAutoCompat=true 被读到')
  eq(W.framePlan().fallbackMode + '/' + (W.framePlan().fallbackAttr === COMPAT_ATTR ? 'compat-attr' : 'sandbox-attr'), 'compat/compat-attr', 'C1 计划里的自动降档落点变成 compat')
  const f = mkFrame(SHIM_URL, SAND_ATTR)
  const r = W.frameFallback('script-error', 'SecurityError: sandbox', f)
  eq(r, true, 'C2 回退口打开 + policy 错误 ⇒ 真的降 compat（旧行为）')
  ok(/allow-same-origin/.test(sandboxAttr(f)), 'C2 sandbox 属性换成兼容集', sandboxAttr(f))
  eq(W.frameStatus().mode + '/' + String(W.frameStatus().degraded), 'compat/true', 'C2 可查状态如实播报 compat + degraded')
  eq(W.frameGuard().downgrades, 1, 'C2 台账记换档 1 次')
  eq(W.frameGuard().lastDowngrade.risk, 'same-origin', 'C2 台账**标注风险** risk=same-origin（不静默降级）')
  dg.push('risk-flagged')
}
{
  const { W } = world({ settings: { webFrameAutoCompat: true } })
  const f = mkFrame(SHIM_URL, SAND_ATTR)
  W.frameShimArm(f)
  await sleep(2750)
  ok(/allow-same-origin/.test(sandboxAttr(f)), 'C3 回退口打开时 2.5s 兜底也走旧行为（换 compat 属性）', sandboxAttr(f))
  eq(W.frameGuard().downgrades, 1, 'C3 台账记换档（by=shim-timeout）')
  eq(W.frameGuard().lastDowngrade.by, 'shim-timeout', 'C3 触发者写清 shim-timeout')
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (NO_MUT) process.exit(fail ? 1 : 0)

/* ══════════════ D. 变异自证 ══════════════ */
console.log('\n== D. 变异自证：去掉来源校验 / 强制自动进 compat ⇒ A 段必红 ==')
const src = fs.readFileSync(CLIENT, 'utf8')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-webframe-mut-'))
const MUTS = [
  {
    id: 'origin-check-removed', expect: 'A2',
    why: '把"ev.origin 与期望来源不等就拒收"改成恒不拒（= 去掉 origin 校验，审计 F5 的原始形态）',
    from: 'if (got !== want) {',
    to: 'if (false) {',
  },
  {
    id: 'source-check-removed', expect: 'A3',
    why: '把 source/contentWindow 校验整条去掉（只留 origin）',
    from: 'if (!f || !f.contentWindow || !ev || ev.source !== f.contentWindow) {',
    to: 'if (false) {',
  },
  {
    id: 'auto-compat-forced', expect: 'A1',
    why: '把 auto 档的自动降档落点强制成 compat（= 允许自动进兼容档，F5 的原始形态）',
    from: 'const autoCompat = !!autoCompatAllowed;',
    to: 'const autoCompat = true;',
  },
]
for (const m of MUTS) {
  const mutated = src.replace(m.from, m.to)
  if (mutated === src) { ok(false, `变异 ${m.id} 注入成功`, '注入点没匹配上（源码改了？）'); continue }
  const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
  fs.writeFileSync(copy, mutated)
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { MPW_WEBFRAME_MUT_CLIENT: copy }),
  })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const failedA1 = /✗ A1 /.test(out)
  const failedA2 = /✗ A2 /.test(out)
  const failedA3 = /✗ A3 /.test(out)
  const got = failedA2 ? 'A2' : failedA3 ? 'A3' : failedA1 ? 'A1' : 'PASS'
  ok(got === m.expect, `变异 ${m.id}：期望 ${m.expect} 变红，实际 ${got}`, `${m.why}  [exit=${r.status}]`)
}
try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉不抛 */ }
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ F5（网页壁纸同源逃逸）判据未通过'); process.exit(1) }
console.log('✓ F5 通过：自动路径进不了 compat、入站消息 source+origin 双校验、降档/拒收全程记账、显式档零回归')

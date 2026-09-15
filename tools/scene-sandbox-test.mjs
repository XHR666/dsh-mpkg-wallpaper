// tools/scene-sandbox-test.mjs — B6 沙箱/场景 token 回归（契约：we-scene-demo/RENDERER-SANDBOX-CONTRACT.md）
// 覆盖：
//   T1 模式计划：无 token → legacy(no-token)；无身份 → no-ident；?mpwsandbox=legacy → forced
//   T2 token 取不到（宿主未重启 404）→ 静默保持 legacy，不抛错
//   T3 取到 token → 挂载 strict：URL 带 sandbox=strict&thumbtoken=…，且 pkgurl 追加 &st=…
//   T4 strict 失败（渲染器自报 ok:false / 8s 无首帧）→ 一次性回退 legacy + diag 落证
//   T5 diag.sandbox 结构（模式/iframe 属性/token 缓存/失败表）
import { loadPlugin } from './_stub.mjs'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.error('  ✗ ' + name) } }
const eq = (a, b, name) => ok(a === b, name + (a === b ? '' : `（got=${JSON.stringify(a)} want=${JSON.stringify(b)}）`))
const flush = () => new Promise((r) => setTimeout(r, 12))

// 每会话清掉"只注册一次"的守卫与钩子，才能在同一进程里重新 loadPlugin（client.js 第 6 行有
// `if (globalThis.__mpwClientLoaded) return …` 的短路，不清就会 loadPlugin 抛"未注册"）。
const SESS_GUARDS = ['__mpwSandboxCapHook', '__mpwLnGuard', '__mpwHealthHook', '__mpwSceneTest', '__mpwSandbox', '__mpwClientLoaded', '__mpwRegistered']
const clearGuards = () => { for (const k of SESS_GUARDS) { try { delete globalThis[k] } catch {} } }
const applyScene = (T) => T.applyScene({ rawFile: 'scene.pkg', folder: 'f1', title: 'SB', key: 'custom|f1' })

/* ══════════ 会话 A：能取到 token → strict ══════════ */
console.log('\n== A. 宿主可签发 token → strict 沙箱 ==')
const A = loadPlugin({ quiet: true })
const S = globalThis.__mpwSandbox
const TA = globalThis.__mpwSceneTest
ok(!!S && typeof S.plan === 'function', '沙箱测试入口 __mpwSandbox 已暴露')

/* T1 计划 */
eq(S.plan(null).reason, 'no-ident', 'T1 无身份 → reason=no-ident')
eq(S.plan('custom|f1|scene.pkg').mode, 'legacy', 'T1 未取 token 时默认 legacy（不冒进）')
eq(S.plan('custom|f1|scene.pkg').reason, 'no-token', 'T1 legacy 原因 = no-token')

/* 覆盖 fetch：token 路由可用（diag 事件照旧收集） */
const diagEvents = []
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.indexOf('/scene-thumb-token') >= 0) {
    return { ok: true, status: 200, json: async () => ({ ok: true, token: 'TK.test', exp: Math.floor(Date.now() / 1000) + 1800 }) }
  }
  try { if (u.indexOf('/diag') >= 0 && opts && opts.body) diagEvents.push(JSON.parse(opts.body)) } catch {}
  return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
}

/* T3 取 token → strict 挂载 */
S.prefetch('custom|f1|scene.pkg'); await flush()
eq(S.diag().tokens.length, 1, 'T3 token 取到并缓存（按 ident）')
eq(S.plan('custom|f1|scene.pkg').mode, 'strict', 'T3 有 token → 计划为 strict')
applyScene(TA); await flush()
const evA = diagEvents.filter((d) => d.why === 'renderer-iframe').pop()
ok(!!evA, 'T3 场景挂载 diag 已上报')
ok(!!evA && /[?&]sandbox=strict(&|$)/.test(evA.url), 'T3 iframe URL 带 sandbox=strict')
ok(!!evA && /thumbtoken=TK\.test/.test(evA.url), 'T3 iframe URL 带 thumbtoken=<token>')
ok(!!evA && decodeURIComponent(evA.url).indexOf('st=TK.test') >= 0, 'T3 pkgurl 追加 &st=<token>（/raw 授权）')
ok(!!evA && evA.sb && evA.sb.mode === 'strict', 'T3 diag 记录 sb.mode=strict')

/* T5 diag 结构 */
const dg = S.diag()
ok(!!dg.last && typeof dg.last.mode === 'string', 'T5 diag.last 有模式')
ok(Array.isArray(dg.tokens) && dg.tokens.indexOf('custom|f1|scene.pkg') >= 0, 'T5 diag.tokens 列出已缓存身份')

/* T4 strict 失败 → 回退 legacy（一次性） */
S.fail('unit-test'); await flush()
ok(!!S.diag().failed['custom|f1|scene.pkg'], 'T4 失败写入 failed 表（该场景此后强制 legacy）')
ok(diagEvents.some((d) => d.kind === 'scene-sandbox' && d.why === 'strict-fallback'), 'T4 diag 落证 scene-sandbox/strict-fallback')
const evA2 = diagEvents.filter((d) => d.why === 'renderer-iframe').pop()
ok(!!evA2 && !/[?&]sandbox=strict(&|$)/.test(evA2.url), 'T4 回退后重新挂载为 legacy（URL 不再带 sandbox=strict）')
eq(S.plan('custom|f1|scene.pkg').mode, 'legacy', 'T4 回退后计划不再回到 strict')

/* ══════════ 会话 B：token 取不到（宿主未重启）→ legacy 零回归 ══════════ */
console.log('\n== B. 宿主无 token 路由（404）→ legacy 零回归 ==')
clearGuards()
const B = loadPlugin({ quiet: true }) // 桩 fetch 固定 404
const SB = globalThis.__mpwSandbox
const TB = globalThis.__mpwSceneTest
SB.prefetch('custom|f1|scene.pkg'); await flush()
eq(SB.diag().tokens.length, 0, 'B 取不到 token 时不缓存（静默失败）')
const rB = applyScene(TB); await flush()
eq(rB, true, 'B 挂载照常成功（不因拿不到 token 失败）')
const evB = B.diagEvents.filter((d) => d.why === 'renderer-iframe').pop()
ok(!!evB && !/sandbox=strict/.test(evB.url), 'B legacy URL 不含 sandbox=strict（与今天一致）')
ok(!!evB && !/[?&]st=/.test(decodeURIComponent(evB.url)), 'B legacy URL 不含 st=（旧行为不变；用 [?&] 锚定避免命中 thumbpost=）')
ok(!!evB && evB.sb && evB.sb.reason === 'no-token', 'B diag 说明 legacy 原因 = no-token')

/* ══════════ 会话 C：显式 legacy（?mpwsandbox=legacy）══════════ */
console.log('\n== C. 显式 legacy 开关 ==')
clearGuards()
loadPlugin({ quiet: true, search: '?mpwsandbox=legacy' })
const SC = globalThis.__mpwSandbox
eq(SC.plan('custom|f1|scene.pkg').reason, 'forced', 'C ?mpwsandbox=legacy → reason=forced（即便有 token 也不 strict）')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)

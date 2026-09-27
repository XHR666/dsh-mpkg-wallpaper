// tools/scene-url-token-guard-test.mjs —— ①(2026-09-28 P-205 安全审计 F6) 场景上游地址 + `st` 下发的判据。
//
// 审计（同工作区 docs/reverse/SECURITY-AUDIT-secret-exfil-20260925.md §F6，根因按符号对锚）：
//   改前 `lib/client.js` 的 `mpwSceneRendererBase` 直接 `String(readSection().sceneRendererUrl)`，
//   `applySceneViaRenderer` 再把它拼成渲染器 iframe 的 src、把宿主签发的场景 token `st` 拼进 `pkgurl`、
//   把 `sceneExtUrl` 拼成 `&extbase=` ⇒ "设置被改到攻击者源" = 令牌 + 本机绝对路径一路送到那个源。
//   跨源写设置已被 P-204 的写闸门堵死；本闸门是**消费侧**那一层：只允许 http(s) 回环 / 显式白名单。
//
// 本文件判据（对着 F6 的三条验收）：
//   A 回环目标 ⇒ 用该 base 且 **带 st**（默认档零回归；渲染器主链路靠它）。
//   B 跨源（非白名单）⇒ 一律拒绝使用（回落默认回环 base，URL 里 0 处攻击者源）+ 记账 + 明确日志；
//     `sceneExtUrl` 同样被拦（不拼 `&extbase=`）。
//   C 白名单放行档（设置项 `sceneUrlWhitelist`）⇒ 用该 base 且**带 st**（显式回退口有效）。
//   D "与页面同主机且页面主机是字面 IP/localhost" 放行（手机/局域网不误伤）；**域名不算**（DNS 重绑定仍拒）。
//   E 非法 scheme（file:/javascript:/data:）⇒ 拒绝 + 记账 bad-scheme。
//   F 纯函数矩阵：回环变体 / 白名单解析（逗号、空白、整条 URL、垃圾条目）/ 目标 kind+reason。
//   G 变异自证（子进程 + 源码注入）：去掉目标闸门 / 去掉 st 闸门 / 白名单退化成任意放行 /
//     同主机判定恒真 ⇒ A–D 段对应断言必红。
//
// 用法: node tools/scene-url-token-guard-test.mjs
// 纯 Node，无浏览器、**无网络**（fetch 全是桩）、无 ffmpeg；变异只写 os.tmpdir() 副本。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(here, '..')
const CLIENT = path.join(REPO, 'lib', 'client.js')
const MUT_CLIENT = process.env.MPW_SCENEURL_MUT_CLIENT ? path.resolve(process.env.MPW_SCENEURL_MUT_CLIENT) : CLIENT
const NO_MUT = !!process.env.MPW_SCENEURL_MUT_CLIENT

let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? ' → ' + detail : '')) }
}
const eq = (a, b, name) => ok(a === b, name, a === b ? '' : `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`)
const flush = () => new Promise((r) => setTimeout(r, 15))

const DEFAULT_BASE = 'http://127.0.0.1:8902/webloader/'
const EVIL_BASE = 'https://evil.example/webloader/'
const EVIL_EXT = 'https://evil.example/ext/'
const LAN_BASE = 'http://192.168.77.9:8902/webloader/'

const SESS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwWebTest', '__mpwSceneTest', '__mpwWebShimHook', '__mpwWebFrameGuard', '__mpwSceneUrlGuard']
const clearGuards = () => { for (const k of SESS) { try { delete globalThis[k] } catch { /* ignore */ } } }

/** 起一个世界：桩 fetch 里 `/scene-thumb-token` 恒签发 TK.test（strict 链路要它才会拼 `st`）。 */
function world(settings) {
  clearGuards()
  const diagEvents = []
  const warns = []
  const T = loadPlugin({
    quiet: true, clientPath: MUT_CLIENT, settings: settings || {},
    fetch: async (url, opts) => {
      const u = String(url)
      if (u.indexOf('/scene-thumb-token') >= 0) {
        return { ok: true, status: 200, json: async () => ({ ok: true, token: 'TK.test', exp: Math.floor(Date.now() / 1000) + 1800 }) }
      }
      try { if (u.indexOf('/diag') >= 0 && opts && opts.body) diagEvents.push(JSON.parse(opts.body)) } catch { /* 非 JSON */ }
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    },
  })
  const orig = console.warn
  console.warn = (...a) => { try { warns.push(a.map((x) => String(x)).join(' ')) } catch { /* ignore */ } }
  const restore = () => { console.warn = orig }
  const S = globalThis.__mpwSceneTest
  const SB = globalThis.__mpwSandbox
  if (!S) { restore(); throw new Error('__mpwSceneTest 未暴露') }
  return { T, S, SB, diagEvents, warns, restore }
}

/** 挂载一次场景并取这套代码**真实拼出来的** iframe URL + sandbox 计划。 */
async function mountScene(S, key, SB) {
  try { SB.prefetch('custom|f1|scene.pkg') } catch { /* 没有沙箱钩子也不影响 */ }
  await flush()
  S.applyScene({ rawFile: 'scene.pkg', folder: 'f1', title: 'F6', key: key || 'custom|f1' })
  await flush()
  return null
}
const lastIframe = (diagEvents) => diagEvents.filter((d) => d.why === 'renderer-iframe').pop() || null
const rejectedWarn = (warns) => warns.filter((w) => /目标不在回环\/白名单内/.test(w)).length

/* ══════════════ A. 回环目标：带 st（默认档零回归） ══════════════ */
console.log('\n== A. 回环渲染器（默认 / 显式 127.0.0.1）⇒ 使用该 base 且**带 st** ==')
{
  const { S, SB, diagEvents, warns, restore } = world({})
  eq(S.defaultBase(), DEFAULT_BASE, 'A0 默认 base 仍是 127.0.0.1:8902/webloader/（与改动前一致）')
  await mountScene(S, null, SB)
  const ev = lastIframe(diagEvents)
  ok(!!ev && ev.url.indexOf(DEFAULT_BASE) === 0, 'A1 场景 iframe 指向默认回环 base', ev ? String(ev.url).slice(0, 70) : 'no-diag')
  ok(!!ev && /[?&]st=TK\.test(&|$)/.test(ev.url) === false && decodeURIComponent(ev.url).indexOf('st=TK.test') >= 0, 'A2 回环目标**带 st**（宿主签发的场景 token 照旧下发）')
  const g = S.urlGuard()
  eq(g.rejected, 0, 'A3 回环目标 0 次拒绝')
  ok(g.allowed >= 1 && g.lastAllow.kind === 'loopback', 'A3 台账记 allow/loopback（生效目标也记账）', 'kind=' + (g.lastAllow && g.lastAllow.kind))
  eq(rejectedWarn(warns), 0, 'A4 回环目标不打"被拒"日志')
  restore()
}
{
  const { S, SB, diagEvents, restore } = world({ sceneRendererUrl: 'http://127.0.0.1:8899/' })
  eq(S.rendererBase(), 'http://127.0.0.1:8899/', 'A5 设置里显式回环（换端口）⇒ 照旧生效')
  await mountScene(S, null, SB)
  const ev = lastIframe(diagEvents)
  ok(!!ev && ev.url.indexOf('http://127.0.0.1:8899/') === 0 && decodeURIComponent(ev.url).indexOf('st=TK.test') >= 0, 'A5 显式回环 base 也带 st（端口无关）')
  restore()
}

/* ══════════════ B. 跨源非白名单：拒绝 + 记账 + 明确日志 + 不拼 extbase ══════════════ */
console.log('\n== B. 跨源（非白名单）渲染器 ⇒ 拒绝使用（回落默认回环）+ 记账 + 不静默 ==')
{
  const { S, SB, diagEvents, warns, restore } = world({ sceneRendererUrl: EVIL_BASE, sceneExtUrl: EVIL_EXT })
  eq(S.rendererBase(), DEFAULT_BASE, 'B1 sceneRendererUrl=https://evil.example/… ⇒ 拒绝使用，回落默认回环 base')
  const g0 = S.urlGuard()
  ok(g0.rejected >= 1 && g0.lastReject.where === 'sceneRendererUrl' && g0.lastReject.kind === 'cross-origin', 'B2 台账记 reject（where=sceneRendererUrl / kind=cross-origin）', JSON.stringify(g0.lastReject && { w: g0.lastReject.where, k: g0.lastReject.kind, r: g0.lastReject.reason }))
  ok(g0.rejectReasons['cross-origin'] >= 1, 'B2 拒绝原因可数（cross-origin）')
  ok(rejectedWarn(warns) >= 1, 'B3 console.warn 明确说明"目标不在回环/白名单内 + 怎么放行"（不静默）', String(warns[0] || '').slice(0, 110))
  await mountScene(S, null, SB)
  const ev = lastIframe(diagEvents)
  ok(!!ev && String(ev.url).indexOf('evil.example') < 0, 'B4 真实拼出来的 iframe URL 里**0 处**攻击者源')
  ok(!!ev && String(ev.url).indexOf(DEFAULT_BASE) === 0, 'B4 回落默认回环 base（功能不丢）')
  const dec = ev ? decodeURIComponent(ev.url) : ''
  ok(dec.indexOf('st=TK.test') >= 0 && dec.indexOf('evil.example') < 0, 'B5 `st` 只到了回环 base，一个字节都没发往攻击者源')
  /* B5b = "令牌只出现在放行目标上"的**分层**读数：去掉目标闸门但留着 st 闸门 ⇒ 这条仍绿（st 不下发）；
     两个闸门一起去掉 ⇒ 这条变红（令牌真的进了攻击者源的 URL）。变异自证靠它分辨。 */
  ok(dec.indexOf('st=TK.test') < 0 || ev.url.indexOf(DEFAULT_BASE) === 0, 'B5b st 只出现在回环/白名单目标的 URL 上（分层：去掉目标闸门也拦得住）')
  ok(dec.indexOf('extbase=') < 0, 'B6 sceneExtUrl=https://evil.example/ext/ ⇒ **不拼** &extbase=（同样被闸门拦下）')
  const g1 = S.urlGuard()
  ok(g1.events.some((e) => e.kind === 'reject' && e.where === 'sceneExtUrl' && e.kind === '' || (e.where === 'sceneExtUrl')), 'B6 台账里 sceneExtUrl 也有记录', JSON.stringify(g1.events.filter((e) => e.where === 'sceneExtUrl').slice(-1)))
  ok(diagEvents.some((d) => d.kind === 'scene-url-guard' && d.why === 'sceneExtUrl'), 'B6 /diag 信标如实上报（kind=scene-url-guard）')
  restore()
}

/* ══════════════ C. 白名单放行档（回退口） ══════════════ */
console.log('\n== C. 白名单放行档（sceneUrlWhitelist）⇒ 用该 base 且带 st（显式回退口） ==')
{
  const { S, SB, diagEvents, restore } = world({ sceneRendererUrl: LAN_BASE, sceneUrlWhitelist: 'http://192.168.77.9:8902' })
  eq(S.rendererBase(), LAN_BASE, 'C1 目标 origin 在白名单里 ⇒ 照旧使用（跨源上游显式放行）')
  const wl = S.targetWhitelist()
  ok(wl.length === 1 && wl[0].origin === 'http://192.168.77.9:8902', 'C1 白名单解析出 origin', JSON.stringify(wl))
  await mountScene(S, null, SB)
  const ev = lastIframe(diagEvents)
  const dec = ev ? decodeURIComponent(ev.url) : ''
  ok(!!ev && ev.url.indexOf(LAN_BASE) === 0, 'C2 iframe 指向白名单 base')
  ok(dec.indexOf('st=TK.test') >= 0, 'C2 白名单放行档**带 st**（回退口语义：显式放行的上游才拿得到令牌）')
  const g = S.urlGuard()
  ok(g.allowed >= 1 && g.lastAllow.kind === 'whitelist', 'C3 台账记 allow/whitelist（放行也记账）', 'kind=' + (g.lastAllow && g.lastAllow.kind))
  restore()
}
{
  const { S, restore } = world({ sceneRendererUrl: LAN_BASE, sceneUrlWhitelist: 'http://192.168.77.9:9999' })
  eq(S.rendererBase(), DEFAULT_BASE, 'C4 白名单里是**别的 origin/端口** ⇒ 仍拒绝（逐 origin 比对，不是"有白名单就放行"）')
  restore()
}

/* ══════════════ D. 同主机字面 IP / localhost；域名不算 ══════════════ */
console.log('\n== D. "与页面同主机 + 页面主机是字面 IP/localhost" 放行；**域名不算**（DNS 重绑定面） ==')
{
  const { S, restore } = world({ sceneRendererUrl: LAN_BASE, sceneUrlWhitelist: 'http://192.168.77.9:9999' })
  const page = globalThis.location
  /* 模拟"手机用局域网 IP 打开 DSH"：页面源换成同一个字面 IP（白名单里是**别的端口** ⇒ 靠同主机口径放行） */
  globalThis.location = { href: 'http://192.168.77.9:3080/', search: '', hash: '', origin: 'http://192.168.77.9:3080', hostname: '192.168.77.9', host: '192.168.77.9:3080', protocol: 'http:' }
  eq(S.targetGuard(LAN_BASE).kind, 'same-host-literal', 'D1 页面在同字面 IP 上 ⇒ kind=same-host-literal（局域网不误伤）')
  globalThis.location = page
  restore()
}
{
  /* 页面主机是**域名** + 目标同域名（DNS 重绑定形态）：白名单里不写它 ⇒ 必须拒 */
  const { S, restore } = world({ sceneRendererUrl: 'http://evil.example:8902/webloader/' })
  const page = globalThis.location
  globalThis.location = { href: 'http://evil.example:3080/', search: '', hash: '', origin: 'http://evil.example:3080', hostname: 'evil.example', host: 'evil.example:3080', protocol: 'http:' }
  eq(S.rendererBase(), DEFAULT_BASE, 'D2 页面主机是**域名** ⇒ 同域名目标仍拒（不靠 DNS 判同源；白名单才是放行口）')
  const g = S.urlGuard()
  ok(g.rejected >= 1 && g.lastReject.reason === 'cross-origin', 'D2 台账如实记 cross-origin', 'reason=' + (g.lastReject && g.lastReject.reason))
  globalThis.location = page
  restore()
}

/* ══════════════ E. 非法 scheme ══════════════ */
console.log('\n== E. 非 http(s) 目标（file:/javascript:/data:）⇒ 拒绝 + bad-scheme 记账 ==')
{
  const { S, SB, restore } = world({ sceneRendererUrl: 'file:///etc/passwd', sceneExtUrl: 'javascript:alert(1)' })
  eq(S.rendererBase(), DEFAULT_BASE, 'E1 file:// 目标被拒（回落默认回环）')
  const g = S.urlGuard()
  ok(g.events.some((e) => e.reason === 'scheme:file' && e.where === 'sceneRendererUrl'), 'E1 台账记 scheme:file', JSON.stringify(g.events.map((e) => e.reason).slice(-3)))
  await mountScene(S, null, SB)
  const g2 = S.urlGuard()
  ok(g2.events.some((e) => e.where === 'sceneExtUrl' && e.reason === 'scheme:javascript'), 'E2 javascript: 的 extbase 同样被拒并记账（不拼进 URL）', JSON.stringify(g2.events.filter((e) => e.where === 'sceneExtUrl').slice(-1)))
  restore()
}

/* ══════════════ F. 纯函数矩阵 ══════════════ */
console.log('\n== F. 目标闸门纯函数矩阵 ==')
{
  const { S, restore } = world({ sceneUrlWhitelist: '192.168.77.9:8902, https://ok.example/ext/index.html ,garbage:::,   ' })
  const g = (u) => S.targetGuard(u)
  eq([g('http://127.0.0.1:8902/x'), g('http://127.1.2.3/'), g('http://localhost:8902/'), g('http://[::1]:8902/'), g('http://LOCALHOST/')].map((x) => x.kind).join(','),
    'loopback,loopback,loopback,loopback,loopback', 'F1 回环变体全放行（127.0.0.0/8、::1、localhost、大小写、端口）')
  eq([g('https://ok.example/ext/index'), g('http://192.168.77.9:8902/webloader/')].map((x) => x.kind).join(','),
    'whitelist,whitelist', 'F2 白名单：整条 URL 与"裸 host:port"都按 **origin** 命中')
  eq([g('https://evil.example/'), g('http://10.0.0.5:8902/'), g('')].map((x) => x.kind + '/' + x.ok).join(','),
    'cross-origin/false,cross-origin/false,empty/false', 'F3 其它域名/其它网段/空值一律不放行')
  eq([g('file:///x'), g('javascript:alert(1)'), g('data:text/html,x')].map((x) => x.kind).join(','),
    'bad-scheme,bad-scheme,bad-scheme', 'F4 非 http(s) 一律 bad-scheme')
  const wl = S.targetWhitelist()
  ok(wl.some((w) => w.bad === 'unparsable' && w.raw === 'garbage:::'), 'F5 白名单里的垃圾条目如实标 bad（不静默吞）', JSON.stringify(wl))
  ok(g('http://127.0.0.1:8902/?a=1#x').reason === 'loopback', 'F6 带路径/查询/锚点的回环目标照旧放行')
  restore()
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (NO_MUT) process.exit(fail ? 1 : 0)

/* ══════════════ G. 变异自证 ══════════════ */
console.log('\n== G. 变异自证：去掉目标闸门 / 去掉 st 闸门 / 白名单任意放行 / 同主机恒真 ⇒ 必红 ==')
const src = fs.readFileSync(CLIENT, 'utf8')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-sceneurl-mut-'))
const MUTS = [
  {
    id: 'target-gate-removed', expect: 'B1',
    why: '把"目标不在回环/白名单内就拒绝使用"改成恒用原值（= 去掉目标闸门，F6 的原始形态）',
    pairs: [['if (g.ok) return raw;', 'if (true) return raw;']],
  },
  {
    id: 'gate-and-st-removed', expect: 'B5b',
    why: '同时去掉目标闸门**和** `st` 闸门 ⇒ 令牌真的发往攻击者源（分层防护的最后读数）',
    pairs: [['if (g.ok) return raw;', 'if (true) return raw;'], ['const stAllowed = !!targetGuard.ok;', 'const stAllowed = true;']],
  },
  {
    id: 'whitelist-any', expect: 'C4',
    why: '把白名单比对退化成"白名单非空即放行"（= 任意跨源放行）',
    pairs: [['if (w && w.origin && w.origin === origin) return Object.assign(out, { ok: true, kind: "whitelist", reason: "whitelist" });',
      'if (w && w.origin) return Object.assign(out, { ok: true, kind: "whitelist", reason: "whitelist" });']],
  },
  {
    id: 'same-host-domain', expect: 'D2',
    why: '把"同主机放行"收窄条件去掉（域名的同主机也放行 = DNS 重绑定面）',
    pairs: [['(mpwSceneLiteralIpHost(pageHost) || mpwSceneLoopbackHost(pageHost))', 'true']],
  },
]
for (const m of MUTS) {
  let mutated = src, injectOk = true
  for (const [from, to] of m.pairs) {
    if (mutated.indexOf(from) < 0) { injectOk = false; break }
    mutated = mutated.replace(from, to)
  }
  if (!injectOk || mutated === src) { ok(false, `变异 ${m.id} 注入成功`, '注入点没匹配上（源码改了？）'); continue }
  const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
  fs.writeFileSync(copy, mutated)
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { MPW_SCENEURL_MUT_CLIENT: copy }),
  })
  const out = String(r.stdout || '') + String(r.stderr || '')
  /* 按"最专门的那条"先判：B5b（令牌泄漏）> B1（目标闸门）> B4（攻击者源进 URL）> C4（白名单任意放行）> D2 */
  const failedB5b = /✗ B5b /.test(out)
  const failedB1 = /✗ B1 /.test(out)
  const failedB4 = /✗ B4 /.test(out)
  const failedC4 = /✗ C4 /.test(out)
  const failedD2 = /✗ D2 /.test(out)
  const got = failedB5b ? 'B5b' : failedB1 ? 'B1' : failedB4 ? 'B4' : failedC4 ? 'C4' : failedD2 ? 'D2' : 'PASS'
  ok(got === m.expect, `变异 ${m.id}：期望 ${m.expect} 变红，实际 ${got}`, `${m.why}  [exit=${r.status}]`)
}
try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉不抛 */ }
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ F6（可控上游 / st 下发）判据未通过'); process.exit(1) }
console.log('✓ F6 通过：设置里的上游只走回环/显式白名单、st 只发往放行目标、非法目标全程记账')

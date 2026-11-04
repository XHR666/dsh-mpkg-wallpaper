#!/usr/bin/env node
/**
 * prop-push-test.mjs —— **场景帧属性下发通道（P-203）**的会变红的判据（纯 Node，不靠浏览器）
 *
 * 现场：改「WE 自带选项 / 包内 `general.properties`」的属性只**持久化**，要下次应用壁纸才生效。
 * 缺口：插件侧只有给 web 帧的 `{op:"props"}`；场景渲染器帧（127.0.0.1:8902）与插件页（3080）
 * **不同源** ⇒ `contentDocument`/`__wp` 都够不着 ⇒ 缺的只是"跨源那一跳"（postMessage op）。
 * 本判据钉五件事：
 *   A 源码口径：参数 op/回执名在、只认父页/自己的来源纪律在、回执真的发、空表分支在、
 *     `?proppush=legacy` 回退口在、`window.__mpwPropsApplyHost` 真的被赋值（此前全仓 0 处赋值
 *     ⇒ 场景档推送恒 `ok:false`，"改属性要下次应用才生效"的另一半根因）。
 *   B 行为（**真源码切片** + `new Function` 驱动，判据不碰真页面）：
 *     ① 父页 props ⇒ **真的写进用户属性表** + 走面板应用链 + 回执发出；
 *     ② 非父页来源 ⇒ 忽略（零改动、零回执，只留 rejected 计数）；
 *     ③ 空表/非法表 ⇒ 回执但零改动（"到了但空"≠"根本没到"：不是这个 op 的消息一条都不记）；
 *     ④ `?proppush=legacy` ⇒ 不认（不挂监听器、直接驱动也不动作、一个字段都不碰）。
 *   C 记账面：`window.__mpwUserPropsPush`（`n`/`last`/`msgs`/`receipts`/`rejected`/`legacy`）可机读。
 *   D 时段属性：宿主一次推整张表（键**数组**）时 `timevarying`/`display` 这批要触发时段重算
 *     （只判字符串会把它们漏掉 ⇒ "改了时段属性画面不动"）。
 *   E 变异自证：删回执 / 删来源纪律 / 空表提前返回 / legacy 失效 / 删 `__mpwPropsApplyHost` 赋值
 *     / 删数组键的时段判定 —— 六种变异各自必红（跑**副本**，真树 sha256 跑前跑后不变）。
 *
 * 跑法：`node tests/prop-push-test.mjs [--no-mutant]`
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
/* 变异自证要驱动**副本**：`MPW_PROP_PUSH_DEMO` 指向副本时，本脚本的全部读数都来自它（真树不受影响）。 */
const DEMO = process.env.MPW_PROP_PUSH_DEMO || path.join(ROOT, 'demo.html')
const NO_MUT = process.argv.includes('--no-mutant')
const HTML = fs.readFileSync(DEMO, 'utf8')

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 220) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 400) + ']' : '')) }
}

/* ── 切片：属性 op 处置块 + 它依赖的真实现（`mpwWebNormalizeProps` / `mpwWebApplyProps`）── */
const MARK_OP = "const MPW_PROP_PUSH_OP = 'mpw-user-props'"
const MARK_NEXT = "/* ①(P-112-BANDGEOM 后续 2026-09-25) **帧几何模块接进 web 帧路径**"
const MARK_NORM = '/** 属性表归一：产品档契约为'
const MARK_SEND = '/**\n * 宿主 → web 帧的控制 op 送达'
const MARK_APPLY = '/**\n * `__wp.updateWebProps` 的真实现'

function cut(src, from, to) {
  const i = src.indexOf(from)
  if (i < 0) return null
  const j = src.indexOf(to, i + from.length)
  if (j < 0) return null
  return src.slice(i, j)
}
const SLICE_NORM = cut(HTML, MARK_NORM, MARK_SEND)
const SLICE_APPLY = cut(HTML, MARK_APPLY, MARK_OP)
const SLICE_PUSH = cut(HTML, MARK_OP, MARK_NEXT)

console.log('== A 源码口径（P-203 场景帧属性下发通道）==')
ok(!!SLICE_PUSH, 'A0 属性 op 切片区存在（锚点命中）')
ok(!!SLICE_NORM && !!SLICE_APPLY, 'A0b 真实现切片存在（`mpwWebNormalizeProps` / `mpwWebApplyProps`）')
{
  const S = SLICE_PUSH || ''
  ok(/const MPW_PROP_PUSH_OP = 'mpw-user-props'/.test(S), 'A1 op 名 = `mpw-user-props`（新名，不沿用已登记旗标/通道名）')
  ok(/const MPW_PROP_PUSH_ACK = 'mpw-props-applied'/.test(S), 'A2 回执名 = `mpw-props-applied`')
  ok(/function mpwPropPushFromParent\(ev\)/.test(S) && /ev\.source === window\.parent/.test(S),
    'A3 来源纪律在：与 `mpw-audio-policy` 同款的"只认父页/自己"')
  ok(/reply\(ev, led\.last\)/.test(S), 'A4 认下来的 op **真的回执**（`reply(ev, led.last)`）')
  ok(/target\.postMessage\(msg, '\*'\)/.test(S), 'A5 回执走 postMessage（跨源唯一可达），且记 `receipts`')
  ok(/receiptFails/.test(S), 'A6 发起方不可回 ⇒ 记 `receiptFails`（**不假装发过**）')
  ok(/const rec = apply\(d\.props\)/.test(S), 'A7 走真实现 `apply(d.props)`（不是自己另写一套写表逻辑）')
  ok(/if \(MPW_PROP_PUSH_LEGACY\) return null/.test(S), 'A8 回退口：`?proppush=legacy` 时 op 直接不认')
  ok(/const MPW_PROP_PUSH_RAW = \(\(\) => \{ try \{ return new URLSearchParams\(location\.search\)\.get\('proppush'\)/.test(S),
    'A9 `?proppush=` **显式读一次**（diag-flag-check 的四条抓取规则看得到这个解析点）')
  ok(/if \(!MPW_PROP_PUSH_LEGACY\) \{/.test(S) && /window\.addEventListener\('message'/.test(S),
    'A10 legacy 档**不挂**监听器（逐位回到改动前）')
  ok(/window\.__mpwUserPropsPush = mpwUserPropsPush/.test(S), 'A11 记账面挂到 `window.__mpwUserPropsPush`（可机读）')
  ok(/\bn: 0, last: null, msgs: 0, receipts: 0/.test(S), 'A12 记账字段齐（`n`/`last`/`msgs`/`receipts`/`rejected`/`legacy`）')
}
{
  /* `window.__mpwPropsApplyHost` 是 `mpwWebApplyProps` 场景档分支**按名字读**的契约点。
     改前全仓只有"读"没有"写" ⇒ 场景档推送恒落 ok:false（= 用户报的"只持久化、下次应用才生效"）。 */
  const assigns = HTML.match(/window\.__mpwPropsApplyHost\s*=/g) || []
  ok(assigns.length === 1, 'A13 `window.__mpwPropsApplyHost` **恰好一处赋值**（改前 0 处 ⇒ 场景档推送恒失败）', 'count=' + assigns.length)
  ok(/window\.__mpwPropsApplyHost = applyAll/.test(HTML), 'A14 赋的正是面板那条应用链 `applyAll`（对象引用同一份）')
  const iHost = HTML.indexOf('window.__mpwPropsApplyHost = applyAll')
  const iFn = HTML.lastIndexOf('const applyAll = (why, key) =>', iHost)
  const iRet = HTML.indexOf('const retimed =', iFn)
  ok(iFn > 0 && iRet > iFn && iRet < iHost, 'A15 赋值点在 `applyAll` 之后（`retimed` 定义之后，不早于它）')
  ok(/Array\.isArray\(key\) && key\.some\(\(k\) => TIME_PROP_KEYS\.has\(k\)\)/.test(HTML),
    'D1 宿主一次推整张表（键**数组**）时也判时段键 ⇒ `timevarying`/`display` 会重算')
}

/* ── 行为：真源码切片 + `new Function` 驱动 ──
   一句"迷你页面"：真 `mpwWebApplyProps`（场景档分支）+ 真 P-203 块，只把 `window`/`location`/`lib`
   与监听器收集器当形参注入（`webFrameEl` 置 null = 场景档；`webPropsLast` 是那函数的模块级记账量）。 */
const PAGE = (() => {
  const src = [
    'let webFrameEl = null, webPropsLast = null;',
    SLICE_NORM, SLICE_APPLY, SLICE_PUSH,
    'return { handle: mpwUserPropsPushHandle, ledger: mpwUserPropsPush, legacyOf: mpwPropPushLegacyOf,',
    '  op: MPW_PROP_PUSH_OP, ack: MPW_PROP_PUSH_ACK, legacy: MPW_PROP_PUSH_LEGACY, listeners: __mpwListeners, windowRef: window };',
  ].join('\n')
  const mk = (search) => {
    const win = { __mpwUserProps: null, __mpwPropsApplyHost: null, __mpwPropsCtx: null }
    const listeners = []
    win.addEventListener = (t, fn) => { if (t === 'message') listeners.push(fn) }
    return new Function('window', 'location', 'lib', '__mpwListeners', src)(
      win, { search: search || '' }, { normalizePropValue: (t, v) => v }, listeners)
  }
  return { mk }
})()

console.log('\n== B 行为（真源码切片：`mpwWebApplyProps` 场景档 + P-203 op）==')
{
  const P = PAGE.mk('')
  ok(P.legacy === false && P.ledger.legacy === false, 'B0 缺省档 = 接线（legacy=false）')
  ok(P.listeners.length === 1, 'B0b 缺省档挂上了一条 message 监听器', 'n=' + P.listeners.length)
  /* 场景档就绪的夹具：面板已装载（表 + 应用链都在） */
  const calls = []
  P.windowRef.__mpwUserProps = { speed: 1, flip: false }
  P.windowRef.__mpwPropsApplyHost = (why, key) => { calls.push({ why, key }); return { applied: 3 } }
  const recv = []
  const parent = { postMessage: (m) => recv.push(m) }
  /* ev.source === window.parent ⇒ 夹具里把 parent 指到发送者本身 */
  P.windowRef.parent = parent
  const ev = { data: { type: P.op, props: { speed: { value: 2.5 }, flip: true } }, source: parent, origin: 'http://127.0.0.1:3080' }
  const ret = P.handle(ev)
  ok(!!ret && ret.ok === true && ret.count === 2, '①-1 父页 props ⇒ 真实现回报 ok/2 项', JSON.stringify(ret || null))
  ok(P.windowRef.__mpwUserProps.speed === 2.5 && P.windowRef.__mpwUserProps.flip === true,
    '①-2 **用户属性表真的变了**（`window.__mpwUserProps`）', JSON.stringify(P.windowRef.__mpwUserProps))
  ok(calls.length === 1 && calls[0].why === 'host-updateWebProps' && Array.isArray(calls[0].key) && calls[0].key.length === 2,
    "①-3 走了**面板同一条应用链**（`applyAll('host-updateWebProps', [keys])`）", JSON.stringify(calls))
  ok(recv.length === 1 && recv[0].type === P.ack && recv[0].ok === true && recv[0].count === 2,
    '①-4 回执发出（`' + P.ack + '`）且字段齐', JSON.stringify(recv[0] || null))
  ok(P.ledger.n === 1 && P.ledger.msgs === 1 && P.ledger.receipts === 1 && !!P.ledger.last && P.ledger.last.keys.length === 2,
    '①-5 记账面：n/msgs/receipts/last 都对', JSON.stringify({ n: P.ledger.n, msgs: P.ledger.msgs, receipts: P.ledger.receipts }))
  /* 裸值形态也要认（`{名:裸值}`） */
  const r2 = P.handle({ data: { type: P.op, props: { speed: 3 } }, source: parent, origin: 'x' })
  ok(P.windowRef.__mpwUserProps.speed === 3 && r2 && r2.count === 1, '①-6 也接受 `{名:裸值}` 形态', JSON.stringify(P.windowRef.__mpwUserProps))

  /* ② 非父页来源 ⇒ 忽略 */
  const before = JSON.stringify(P.windowRef.__mpwUserProps)
  const recvBefore = recv.length
  const other = { postMessage: () => { throw new Error('不该给不明来源回执') } }
  const r3 = P.handle({ data: { type: P.op, props: { speed: 99 } }, source: other, origin: 'http://evil.invalid' })
  ok(r3 === null && JSON.stringify(P.windowRef.__mpwUserProps) === before && recv.length === recvBefore,
    '②-1 非父页来源 ⇒ 忽略：零改动、零回执')
  ok(P.ledger.rejected === 1 && P.ledger.msgs === 2 && !!P.ledger.lastRejected,
    '②-2 但**留痕**（`rejected`/`lastRejected`），不当成没发生过', JSON.stringify(P.ledger.lastRejected))

  /* ③ 空/非法表 ⇒ 回执但零改动；且"根本没到"要能分开 */
  const recv2 = recv.length
  const r4 = P.handle({ data: { type: P.op, props: {} }, source: parent, origin: 'x' })
  ok(!!r4 && r4.count === 0 && r4.ok === false && recv.length === recv2 + 1 && recv[recv.length - 1].type === P.ack,
    '③-1 空表 ⇒ **如实回执**（count:0 / ok:false + 原因）', JSON.stringify(recv[recv.length - 1] || null))
  ok(JSON.stringify(P.windowRef.__mpwUserProps) === before, '③-2 空表 ⇒ 零改动（表逐字不变）')
  const n3 = P.ledger.n
  const r5 = P.handle({ data: { type: P.op, props: null }, source: parent, origin: 'x' })
  ok(!!r5 && r5.count === 0 && P.ledger.n === n3 + 1, '③-3 `props:null` 同款处置（照样回执、零改动）')
  const msgs4 = P.ledger.msgs, recv4 = P.ledger.receipts
  const r6 = P.handle({ data: { type: 'mpw-audio-policy', muted: true }, source: parent, origin: 'x' })
  ok(r6 === null && P.ledger.msgs === msgs4 && P.ledger.receipts === recv4,
    '③-4 **不是这个 op 的消息一条都不记**（"到了但空" ≠ "根本没到"）', JSON.stringify({ msgs: P.ledger.msgs, receipts: P.ledger.receipts }))
  const r7 = P.handle({ data: 'not-an-object', source: parent })
  ok(r7 === null && P.ledger.msgs === msgs4 && P.ledger.receipts === recv4, '③-5 非对象载荷同款（不记数、不动作）')
  /* 监听器入口与直接驱动同一条路（真接线，不只是函数能跑） */
  const recv3 = recv.length
  P.listeners[0]({ data: { type: P.op, props: { speed: 7 } }, source: parent, origin: 'x' })
  ok(P.windowRef.__mpwUserProps.speed === 7 && recv.length === recv3 + 1, 'B1 走**真监听器**（`addEventListener` 那条）也生效', 'speed=' + P.windowRef.__mpwUserProps.speed)
}
{
  /* ④ `?proppush=legacy` ⇒ 不认（回到改动前） */
  const L = PAGE.mk('?proppush=legacy')
  ok(L.legacy === true && L.ledger.legacy === true, '④-1 legacy 档被识别（`?proppush=legacy`）')
  ok(L.listeners.length === 0, '④-2 legacy 档**不挂** message 监听器（逐位回到改动前）', 'n=' + L.listeners.length)
  L.windowRef.__mpwUserProps = { speed: 1 }
  const recv = []
  const parent = { postMessage: (m) => recv.push(m) }
  L.windowRef.parent = parent
  const r = L.handle({ data: { type: L.op, props: { speed: 9 } }, source: parent, origin: 'x' })
  ok(r === null && L.windowRef.__mpwUserProps.speed === 1 && recv.length === 0 && L.ledger.n === 0 && L.ledger.msgs === 0,
    '④-3 直接驱动也不动作（零改动、零回执、零记账）')
  ok(L.legacyOf('off') === true && L.legacyOf('0') === true && L.legacyOf('false') === true && L.legacyOf('') === false && L.legacyOf('1') === false,
    '④-4 取值口径：`legacy`/`off`/`0`/`false` 关；空与其它值 = 接线（缺省档不变）')
  ok(PAGE.mk('?proppush=1').legacy === false && PAGE.mk('?proppush=').legacy === false,
    '④-5 显式接线档（`proppush=1` / 空值）仍是接线 —— 只有明确写 legacy 才关')
}
{
  /* 场景档**未就绪**（面板还没装载）⇒ 如实回报 ok:false + 原因（插件据此重试） */
  const P = PAGE.mk('')
  P.windowRef.__mpwUserProps = null
  P.windowRef.__mpwPropsApplyHost = null
  const recv = []
  const parent = { postMessage: (m) => recv.push(m) }
  P.windowRef.parent = parent
  const r = P.handle({ data: { type: P.op, props: { speed: 2 } }, source: parent, origin: 'x' })
  ok(!!r && r.ok === false && r.count === 0 && /没有用户属性表|没有运行期应用链/.test(r.why),
    'B2 属性表/应用链还没就绪 ⇒ **如实** ok:false + 原因（不假装成功，插件可据此重试）', JSON.stringify(r))
  ok(recv.length === 1 && recv[0].ok === false, 'B2b 失败也回执（回执 = 两端的判据面）')
  /* 就绪后同一条 op 立刻生效（= 重试真的能救回来） */
  P.windowRef.__mpwUserProps = {}
  P.windowRef.__mpwPropsApplyHost = () => ({ applied: 1 })
  const r2 = P.handle({ data: { type: P.op, props: { speed: 2 } }, source: parent, origin: 'x' })
  ok(!!r2 && r2.ok === true && P.windowRef.__mpwUserProps.speed === 2, 'B2c 就绪后同一条 op 生效（重试路径有意义）')
}

/* ── E 变异自证（副本，真树不动）── */
if (!NO_MUT) {
  console.log('\n== E 变异自证（副本，真树不动）==')
  const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const before = sha(DEMO)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-proppush-'))
  const MUTS = [
    ['E1 删回执（`reply(ev, led.last)` → 空操作）', 'try { reply(ev, led.last) } catch (e) { led.receiptFails++ }', '/* 变异：不回执 */'],
    ['E2 删来源纪律（只认父页/自己 → 谁都认）', 'if (!mpwPropPushFromParent(ev)) {', 'if (false) {'],
    ['E3 空表提前返回（不回执、不记账）', 'led.msgs++\n  const rec = apply(d.props)', 'led.msgs++\n  if (!d.props || !Object.keys(d.props || {}).length) return null\n  const rec = apply(d.props)'],
    ['E4 legacy 失效（`?proppush=legacy` 照样接线）', 'const MPW_PROP_PUSH_LEGACY = mpwPropPushLegacyOf(MPW_PROP_PUSH_RAW)', 'const MPW_PROP_PUSH_LEGACY = false'],
    ['E5 删 `__mpwPropsApplyHost` 赋值（场景档推送恒失败）', 'try { window.__mpwPropsApplyHost = applyAll } catch (e) { /* 无 window */ }', '/* 变异：不交接应用链 */'],
    ['E6 删数组键的时段判定', '|| (Array.isArray(key) && key.some((k) => TIME_PROP_KEYS.has(k)))', ''],
  ]
  for (const [name, from, to] of MUTS) {
    const mutated = HTML.includes(from) ? HTML.replace(from, to) : null
    ok(!!mutated && mutated !== HTML, name + ' —— 变异锚点命中')
    if (!mutated) continue
    const copy = path.join(tmp, 'demo-' + Math.abs(name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) + '.html')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [process.argv[1], '--no-mutant'], {
      env: Object.assign({}, process.env, { MPW_PROP_PUSH_DEMO: copy }), encoding: 'utf8',
    })
    const red = r.status !== 0
    ok(red, name + ' ⇒ **必红**', red ? ('exit=' + r.status) : '变异后判据仍然全绿（判据没抓住它）')
  }
  ok(sha(DEMO) === before, 'E7 真树 sha256 跑前跑后逐字相同（变异没碰真文件）', before.slice(0, 16) + '…')
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

console.log('\n' + (fail ? '✗' : '✓') + ' P-203 场景帧属性下发通道：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * props-compat-test.mjs —— **插件兼容层 op 组（任务单 P3）**的会变红的判据（纯 Node，不靠浏览器）
 *
 * 五个 op（`mpw-props-describe` / `mpw-props-reset` / `mpw-layers-list` / `mpw-layers-set` / `mpw-ui-set`）
 * 是插件把属性面板/逐层开关/自带 UI 开关收进「测试项」tab 的运行期通道（全部 postMessage，不改 URL）。
 * 本判据钉六件事：
 *   A 源码口径：五个 op 名在、回执 `-result` 后缀在、只认父页/自己的来源纪律在、同 rid 幂等（ring 32）在、
 *     `?propscompat=legacy` 回退口在且**显式读一次**、legacy 档不挂监听器、`window.__mpwPropsCompat` 记账面在。
 *   B 行为（**真源码切片** + `new Function` 驱动，判据不碰真页面）：
 *     ① describe ⇒ 纯读（model/values 原样、零改动）、回执发出、`schemaVersion:1`；
 *     ② reset ⇒ 清 store + map 重放默认 + 走 `__mpwPropsApplyHost('reset')` 面板同一条链 + save 被调；
 *        应用链缺席 ⇒ ok:false（差异已清、默认未重放，**不假装成功**）；
 *     ③ 同 rid 重放 ⇒ 原回执再发、副作用**不重复执行**（applyHost 只跑一次）；
 *     ④ layers-list ⇒ 复用注入的 layerHealth 口径逐行带 index；无层 ⇒ ok:false；
 *     ⑤ layers-set ⇒ 只写/清 `__lnHidden`、容器层不动、非法载荷零改动；空数组 = 全部恢复；
 *     ⑥ ui-set ⇒ 隐藏 #mpw-audio-panel/#mpw-audio-btn + setOpen(false)；np absent 如实记；两键全缺 ⇒ 零改动；
 *     ⑦ 非父页来源 ⇒ 忽略（零改动、零回执、rejected 留痕）；不是这五个 op 的消息一条都不记；
 *     ⑧ `?propscompat=legacy` ⇒ 不认（不挂监听器、直接驱动也零动作）。
 *   C 记账面：n/msgs/receipts/rejected/idem/evicted/ops 可机读。
 *   D 变异自证（跑**副本**，真树 sha256 跑前跑后不变）：删来源纪律 / 删 legacy 闸 / 删 rid 幂等 /
 *     删"非法载荷零改动" —— 四种变异各自必红，期望红集 == 实际红集（逐条相等）。
 *
 * 跑法：`node tests/props-compat-test.mjs [--no-mutant]`
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
/* 变异自证要驱动**副本**：`MPW_PROPS_COMPAT_DEMO` 指向副本时，本脚本的全部读数都来自它（真树不受影响）。 */
const DEMO = process.env.MPW_PROPS_COMPAT_DEMO || path.join(ROOT, 'demo.html')
const NO_MUT = process.argv.includes('--no-mutant')
const HTML = fs.readFileSync(DEMO, 'utf8')
const SHA0 = crypto.createHash('sha256').update(HTML).digest('hex')

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 240) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 400) + ']' : '')) }
}

/* ── 切片：兼容层 op 块（哨兵注释定界，同 lib/index.js webloader 工厂的形态）── */
const MARK_BEGIN = '// ── [props-compat BEGIN] ──'
const MARK_END = '// ── [props-compat END] ──'
const iB = HTML.indexOf(MARK_BEGIN), iE = HTML.indexOf(MARK_END)
const SLICE = (iB >= 0 && iE > iB) ? HTML.slice(iB, iE) : null

console.log('== A 源码口径（任务单 P3 插件兼容层 op 组）==')
ok(!!SLICE, 'A0 兼容层 op 切片区存在（哨兵命中）')
{
  const S = SLICE || ''
  for (const op of ['mpw-props-describe', 'mpw-props-reset', 'mpw-layers-list', 'mpw-layers-set', 'mpw-ui-set']) {
    ok(S.indexOf("'" + op + "'") >= 0, 'A1 op 在：`' + op + '`')
    ok(S.indexOf("'" + op + "-result'") >= 0, 'A2 回执名在：`' + op + '-result`')
  }
  ok(/function mpwPropsCompatFromParent\(ev\)/.test(S) && /ev\.source === window\.parent/.test(S),
    'A3 来源纪律在：只认父页/自己（与 P-203 同款）')
  ok(/const MPW_PROPS_COMPAT_RID_RING = 32/.test(S) && /ridMemo\.has\(rid\)/.test(S) && /mpwPropsCompat\.idem\+\+/.test(S),
    'A4 同 rid 幂等在（ring 32 + memo + idem 计数）')
  ok(/new URLSearchParams\(location\.search\)\.get\('propscompat'\)/.test(S),
    'A5 `?propscompat=` **显式读一次**（diag-flag-check 的抓取规则看得到这个解析点）')
  ok(/if \(MPW_PROPS_COMPAT_LEGACY\) return null/.test(S), 'A6 回退口：`?propscompat=legacy` 时 op 直接不认')
  ok(/if \(!MPW_PROPS_COMPAT_LEGACY\) \{/.test(S) && /window\.addEventListener\('message'/.test(S),
    'A7 legacy 档**不挂**监听器（回到改动前逐位）')
  ok(/window\.__mpwPropsCompat = mpwPropsCompat/.test(S), 'A8 记账面挂到 `window.__mpwPropsCompat`（可机读）')
  ok(/target\.postMessage\(body, '\*'\)/.test(S) && /receiptFails\+\+/.test(S),
    'A9 回执走 postMessage；发不出去记 receiptFails（不假装发过）')
  ok(/mpwLayerHealth\(scene, led, sk, errs, o\)/.test(S), 'A10 layers-list **复用** mpwLayerHealth（不另写可见性判定）')
  ok(/__lnHidden/.test(S) && /isContainer/.test(S), 'A11 layers-set 只动既有 `__lnHidden` 开关，容器层不动')
  ok(/__mpwPropsApplyHost/.test(S) && /applyHost\('reset'\)/.test(S), 'A12 reset 走**面板同一条应用链**（P-203 交接点）')
  ok(/apply-host-missing/.test(S) && /不假装成功/.test(S), 'A13 应用链缺席 ⇒ ok:false（不假装重放成功）')
}

/* ── 行为：真源码切片 + `new Function` 驱动 ──
   迷你页面：只把 window / location / lib / mpwLayerHealth / 监听器收集器当形参注入。
   deps 按 op 注入夹具（真页面不传 ⇒ 走全局契约点：__mpwPropsCtx / __mpwPropsApplyHost / __sceneLayers …）。 */
const PAGE = (() => {
  const mk = (search, winProps) => {
    const win = Object.assign({
      __mpwPropsCtx: null, __mpwPropsApplyHost: null, __mpwSceneLayers: null, __mpwTime: null,
      __mpwUserPropsPush: null, __mpwAudioPanel: null,
    }, winProps || {})
    const listeners = []
    win.addEventListener = (t, fn) => { if (t === 'message') listeners.push(fn) }
    const fn = new Function('window', 'location', 'lib', 'mpwLayerHealth', 'document', '__mpwListeners', SLICE +
      '\n;return { handle: mpwPropsCompatHandle, ledger: mpwPropsCompat, legacy: MPW_PROPS_COMPAT_LEGACY, listeners: __mpwListeners, windowRef: window };')
    return fn(win, { search: search || '' }, {}, () => ({}), undefined, listeners)
  }
  return { mk }
})()

const parentOf = (win) => {
  const recv = []
  const parent = { postMessage: (m) => recv.push(m) }
  win.parent = parent
  return { parent, recv }
}
const evOf = (win, parent, data, rid) => ({ data: Object.assign({ rid }, data), source: parent, origin: 'http://127.0.0.1:3080' })

console.log('\n== B 行为（真源码切片驱动）==')
{
  const P = PAGE.mk('')
  ok(P.legacy === false, 'B0 缺省档 = 接线（legacy=false）')
  ok(P.listeners.length === 1, 'B0b 缺省档挂上了一条 message 监听器', 'n=' + P.listeners.length)

  /* ① describe：纯读 */
  {
    const { parent, recv } = parentOf(P.windowRef)
    const modelOut = { items: [{ key: 'speed', type: 'slider', label: '速度' }], counts: { total: 1, rendered: 1 } }
    const ctx = { map: { speed: 2 }, schema: { speed: { type: 'slider' } }, locked: null, store: {}, save: () => {}, key: 'mpw-props:42' }
    const modelCalls = []
    P.windowRef.__mpwPropsCtx = ctx
    P.windowRef.__mpwUserPropsPush = { n: 3, msgs: 4, receipts: 4, rejected: 0, last: { why: 'mount' } }
    const ret = P.handle(evOf(P.windowRef, parent, { type: 'mpw-props-describe' }, 'r1'),
      { describe: { propsPanelModel: (s, m, o) => { modelCalls.push({ s, m, o }); return modelOut } } })
    ok(!!ret && ret.ok === true && ret.schemaVersion === 1 && ret.model === modelOut,
      '①-1 describe ⇒ ok + schemaVersion:1 + model 原样（纯读）', JSON.stringify(ret && { ok: ret.ok, sv: ret.schemaVersion }))
    ok(JSON.stringify(ret.values) === JSON.stringify(ctx.map), '①-2 values = 当前 map 快照', JSON.stringify(ret.values))
    ok(modelCalls.length === 1 && modelCalls[0].m === ctx.map && modelCalls[0].o && modelCalls[0].o.locked === null,
      '①-3 走注入的 propsPanelModel（真页面 = lib.propsPanelModel），locked 透传')
    ok(recv.length === 1 && recv[0].type === 'mpw-props-describe-result' && recv[0].rid === 'r1',
      '①-4 回执发出（-result 后缀 + rid 配对）', JSON.stringify({ t: recv[0] && recv[0].type, rid: recv[0] && recv[0].rid }))
    ok(!!ret.pushState && ret.pushState.n === 3, '①-5 附 P-203 台账摘要（pushState）')
    ok(P.ledger.n === 1 && P.ledger.ops['mpw-props-describe'] === 1, '①-6 记账：n/ops', JSON.stringify(P.ledger.ops))
    /* 上下文缺席（场景没装载）⇒ 如实回执 ok:false */
    P.windowRef.__mpwPropsCtx = null
    const ret2 = P.handle(evOf(P.windowRef, parent, { type: 'mpw-props-describe' }, 'r2'), {})
    ok(!!ret2 && ret2.ok === false && /no-scene-props/.test(ret2.why) && recv.length === 2,
      '①-7 无属性表 ⇒ ok:false + why（"到了但没数据"可分）', ret2 && ret2.why)
    P.windowRef.__mpwPropsCtx = ctx
  }

  /* ②③ reset：清差异 + 重放默认 + 应用链；同 rid 幂等；应用链缺席 */
  {
    const { parent, recv } = parentOf(P.windowRef)
    const applyCalls = []
    const saved = []
    const defaults = { speed: 1, flip: false }
    const ctx = { map: { speed: 5, flip: true, extra: 'user' }, schema: { speed: { type: 'slider' }, flip: { type: 'bool' } },
      locked: new Set(), store: { speed: 5, flip: true }, save: (s) => saved.push(JSON.parse(JSON.stringify(s))), key: 'mpw-props:42' }
    P.windowRef.__mpwPropsCtx = ctx
    P.windowRef.__mpwPropsApplyHost = (why, key) => { applyCalls.push({ why, key }); return { stats: { applied: 7 } } }
    const ret = P.handle(evOf(P.windowRef, parent, { type: 'mpw-props-reset' }, 'R1'), { reset: { propsDefaults: () => defaults } })
    ok(!!ret && ret.ok === true && ret.applied === true, '②-1 reset ⇒ ok + applied', JSON.stringify(ret && { ok: ret.ok, cleared: ret.cleared }))
    ok(JSON.stringify(ret.cleared.sort()) === JSON.stringify(['flip', 'speed']) && ret.cleared.length === 2,
      '②-2 cleared = 该壁纸差异键（localStorage store）', JSON.stringify(ret.cleared))
    ok(JSON.stringify(ctx.map) === JSON.stringify(defaults), '②-3 map 重放作者默认（与面板 onReset 同一套）', JSON.stringify(ctx.map))
    ok(ctx.store && Object.keys(ctx.store).length === 0, '②-4 store 已清（差异 0 项）')
    ok(saved.length === 1, '②-5 ctx.save 被调（落盘清空后的差异表）', 'n=' + saved.length)
    ok(applyCalls.length === 1 && applyCalls[0].why === 'reset', '②-6 走面板同一条应用链 applyAll(\'reset\')', JSON.stringify(applyCalls))
    ok(recv.length === 1 && recv[0].type === 'mpw-props-reset-result' && recv[0].rid === 'R1' && recv[0].ok === true,
      '②-7 回执发出（ok 才允许插件清自己那侧）')
    /* ③ 同 rid 幂等：原回执再发、副作用不重复。body 一致 = 与**第一次**的回执逐字相同。 */
    const applyN0 = applyCalls.length, nLedger = P.ledger.n, recvN0 = recv.length
    const firstBody = JSON.stringify(recv[recvN0 - 1])
    const ret3 = P.handle(evOf(P.windowRef, parent, { type: 'mpw-props-reset' }, 'R1'), { reset: { propsDefaults: () => defaults } })
    ok(!!ret3 && ret3.ok === true && recv.length === recvN0 + 1 && JSON.stringify(recv[recv.length - 1]) === firstBody,
      '③-1 同 rid 重放 ⇒ **原回执**（与第一次的回执逐字一致）再发一次')
    ok(applyCalls.length === applyN0 && P.ledger.n === nLedger, '③-2 **副作用不重复执行**（applyHost 没再跑、n 没再涨）',
      JSON.stringify({ apply: applyCalls.length, n: P.ledger.n }))
    ok(P.ledger.idem === 1, '③-3 idem 计数 = 1', 'idem=' + P.ledger.idem)
    /* 新 rid ⇒ 正常执行 */
    P.handle(evOf(P.windowRef, parent, { type: 'mpw-props-reset' }, 'R2'), { reset: { propsDefaults: () => defaults } })
    ok(applyCalls.length === applyN0 + 1, '③-4 新 rid ⇒ 副作用照常执行', 'apply=' + applyCalls.length)
    /* 应用链缺席 ⇒ ok:false（不假装成功），但差异清理照报 */
    P.windowRef.__mpwPropsApplyHost = null
    const ret5 = P.handle(evOf(P.windowRef, parent, { type: 'mpw-props-reset' }, 'R3'), { reset: { propsDefaults: () => defaults, ctx } })
    ok(!!ret5 && ret5.ok === false && /apply-host-missing/.test(ret5.why) && Array.isArray(ret5.cleared),
      '③-5 应用链缺席 ⇒ ok:false + cleared 照报（插件不会清自己那侧）', ret5 && ret5.why)
    P.windowRef.__mpwPropsApplyHost = (why) => ({ stats: {} })
  }

  /* ④⑤ layers-list / layers-set */
  {
    const { parent, recv } = parentOf(P.windowRef)
    const layers = [{ name: 'A' }, { name: 'B', __lnHidden: true }, { name: 'C', isContainer: true }, { name: 'D' }]
    const healthRows = [
      { name: 'A', visible: true, visibleBy: null, skipReason: null },
      { name: 'B', visible: false, visibleBy: 'ln-hidden', skipReason: 'ln-hidden' },
      { name: 'C', visible: true, visibleBy: 'container', skipReason: 'container' },
      { name: 'D', visible: false, visibleBy: 'author', skipReason: 'invisible' },
    ]
    const ret = P.handle(evOf(P.windowRef, parent, { type: 'mpw-layers-list' }, 'L1'),
      { layersList: { layers, layerHealth: (scene, led, sk, errs, o) => ({ layerHealth: healthRows, layerHealthSummary: { total: 4 } }) } })
    ok(!!ret && ret.ok === true && Array.isArray(ret.layers) && ret.layers.length === 4,
      '④-1 layers-list ⇒ ok + 层行数组', JSON.stringify(ret && ret.summary))
    ok(ret.layers[1].visible === false && ret.layers[1].visibleBy === 'ln-hidden' && ret.layers[0].index === 0 && ret.layers[3].index === 3,
      '④-2 行 = {index,name,visible,visibleBy,skipReason}（口径来自注入的 layerHealth = 真页面 mpwLayerHealth）',
      JSON.stringify(ret.layers[1]))
    const retNo = P.handle(evOf(P.windowRef, parent, { type: 'mpw-layers-list' }, 'L2'),
      { layersList: { layers, layerHealth: () => { throw new Error('x') } } })
    ok(!!retNo && retNo.ok === false && /layerHealth failed/.test(retNo.why), '④-3 层健康计算抛错 ⇒ ok:false + why（零改动）', retNo && retNo.why)

    /* ⑤ layers-set */
    const mkLayers = () => [{ name: 'A' }, { name: 'B', isContainer: true }, { name: 'C' }, { name: 'D', __lnHidden: true }]
    let L = mkLayers()
    const ret2 = P.handle(evOf(P.windowRef, parent, { type: 'mpw-layers-set', hidden: [0, 4] }, 'S1'), { layersSet: { layers: L } })
    ok(!!ret2 && ret2.ok === true && L[0].__lnHidden === true && !L[2].__lnHidden,
      '⑤-1 hidden=[0,4] ⇒ 0 号写 __lnHidden；越界下标不炸', JSON.stringify(ret2 && { hidden: ret2.hidden, n: ret2.hiddenCount }))
    ok(L[1].__lnHidden === undefined && !L[1].__lnHidden, '⑤-2 容器层**不动**（父链/定位不变，与 ?ln 同口径）')
    ok(L[3].__lnHidden === false, '⑤-3 不在 hidden 集里的既有 __lnHidden 被清（= 恢复显示）')
    const retEmpty = P.handle(evOf(P.windowRef, parent, { type: 'mpw-layers-set', hidden: [] }, 'S2'), { layersSet: { layers: L } })
    ok(!!retEmpty && retEmpty.ok === true && !L[0].__lnHidden, '⑤-4 空数组 = 全部恢复显示')
    const before = JSON.stringify(L.map((l) => !!l.__lnHidden))
    const retBad = P.handle(evOf(P.windowRef, parent, { type: 'mpw-layers-set' }, 'S3'), { layersSet: { layers: L } })
    ok(!!retBad && retBad.ok === false && /bad-payload/.test(retBad.why), '⑤-5 缺 hidden ⇒ ok:false（如实回执）', retBad && retBad.why)
    const retBad2 = P.handle(evOf(P.windowRef, parent, { type: 'mpw-layers-set', hidden: ['x', -1, 1.5] }, 'S4'), { layersSet: { layers: L } })
    ok(!!retBad2 && retBad2.ok === false && /bad-index/.test(retBad2.why), '⑤-6 非负整数以外的下标 ⇒ ok:false（零改动）', retBad2 && retBad2.why)
    ok(JSON.stringify(L.map((l) => !!l.__lnHidden)) === before, '⑤-7 非法载荷 ⇒ 层状态逐字不变（零改动）')
  }

  /* ⑥ ui-set */
  {
    const { parent } = parentOf(P.windowRef)
    const els = {}
    const mkEl = () => ({ style: {}, setOpenCalls: 0 })
    for (const id of ['mpw-audio-panel', 'mpw-audio-btn']) els[id] = mkEl()   // 只预置音频面板两个元素；#np-mount 缺席
    const doc = { getElementById: (id) => (els[id] === undefined ? null : els[id]) }
    P.windowRef.__mpwAudioPanel = { setOpen: (o) => { P.windowRef.__mpwAudioPanel.lastCall = o } }
    const ret = P.handle(evOf(P.windowRef, parent, { type: 'mpw-ui-set', np: false, audioPanel: false }, 'U1'), { uiSet: { doc } })
    ok(!!ret && ret.ok === true && ret.audioPanel === 'hidden' && els['mpw-audio-panel'].style.display === 'none' && els['mpw-audio-btn'].style.display === 'none',
      '⑥-1 audioPanel:false ⇒ 面板 + 顶栏按钮都隐藏', JSON.stringify(ret))
    ok(P.windowRef.__mpwAudioPanel.lastCall === false, '⑥-2 先收起展开态（setOpen(false)）')
    ok(ret.np && ret.np.indexOf('absent') === 0, '⑥-3 本页没有 NP（#np-mount 缺席）⇒ 如实记 absent', ret.np)
    const ret2 = P.handle(evOf(P.windowRef, parent, { type: 'mpw-ui-set', audioPanel: true }, 'U2'), { uiSet: { doc } })
    ok(ret2.audioPanel === 'shown' && els['mpw-audio-panel'].style.display === '', '⑥-4 audioPanel:true ⇒ 恢复显示（交回 CSS/类控制）')
    const ret3 = P.handle(evOf(P.windowRef, parent, { type: 'mpw-ui-set' }, 'U3'), { uiSet: { doc } })
    ok(!!ret3 && ret3.ok === false && /bad-payload/.test(ret3.why), '⑥-5 两键全缺 ⇒ 零改动 + 如实回执', ret3 && ret3.why)
  }

  /* ⑦ 来源纪律 / 非 op 消息 */
  {
    const before = P.ledger.msgs
    const other = { postMessage: () => { throw new Error('不该给不明来源回执') } }
    const r = P.handle({ data: { type: 'mpw-props-describe', rid: 'X' }, source: other, origin: 'http://evil.invalid' }, {})
    ok(r === null && P.ledger.rejected === 1 && !!P.ledger.lastRejected, '⑦-1 非父页来源 ⇒ 忽略 + rejected 留痕', JSON.stringify(P.ledger.lastRejected || {}))
    const m2 = P.ledger.msgs
    const r2 = P.handle({ data: { type: 'mpw-audio-policy', muted: true }, source: P.windowRef.parent, origin: 'x' }, {})
    ok(r2 === null && P.ledger.msgs === m2, '⑦-2 不是这五个 op 的消息一条都不记')
    const r3 = P.handle({ data: 'not-an-object', source: P.windowRef.parent, origin: 'x' }, {})
    ok(r3 === null && P.ledger.msgs === m2, '⑦-3 非对象载荷同款（不记数、不动作）')
    ok(P.ledger.msgs >= before, '⑦-4 记账连续（msgs 只增不减）')
  }
}
{
  /* ⑧ `?propscompat=legacy` ⇒ 不认（回到改动前） */
  const L = PAGE.mk('?propscompat=legacy')
  ok(L.legacy === true && L.ledger.legacy === true, '⑧-1 legacy 档被识别（`?propscompat=legacy`）')
  ok(L.listeners.length === 0, '⑧-2 legacy 档**不挂** message 监听器（逐位回到改动前）', 'n=' + L.listeners.length)
  const { parent, recv } = parentOf(L.windowRef)
  const r = L.handle(evOf(L.windowRef, parent, { type: 'mpw-props-describe' }, 'z'), {})
  ok(r === null && recv.length === 0 && L.ledger.msgs === 0, '⑧-3 legacy 档直接驱动也零动作（零回执、零记账）')
  const L2 = PAGE.mk('?propscompat=off')
  ok(L2.legacy === true, '⑧-4 off 同义')
}

/* ── D. 变异自证（隔离副本；期望红集 == 实际红集） ── */
if (!NO_MUT) {
  console.log('\n== D 变异自证（副本上打变异；期望红集 == 实际红集）==')
  const runVariant = (mutator, mutTag) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-propscompat-mut-'))
    const copy = path.join(dir, 'demo.html')
    let src = HTML
    const applied = mutator(src)
    if (applied === src) throw new Error('变异 ' + mutTag + ' 没打上去（锚点没命中）')
    fs.writeFileSync(copy, applied)
    const me = fileURLToPath(import.meta.url)
    const r = spawnSync(process.execPath, [me, '--no-mutant'], { encoding: 'utf8', env: Object.assign({}, process.env, { MPW_PROPS_COMPAT_DEMO: copy }) })
    const allOut = String(r.stdout || '') + '\n' + String(r.stderr || '')
    const reds = allOut.split('\n').filter((l) => l.startsWith('  ✗ '))
      .map((l) => (l.match(/^  ✗ ([^ ]+) /) || [])[1]).filter(Boolean)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    return { reds, out: allOut }
  }
  /* 断言 id 白名单：变异子进程输出里只统计行为段的这些 id（防别的段落噪声混进红集比对）。 */
  const CASES = ['①-7', '③-1', '③-2', '③-3', '⑤-5', '⑦-1', '⑧-3']
  const MUTS = [
    /* 锚点带函数名：`mpwPropsCompatFromParent` 与 P-203 的 `mpwPropPushFromParent` 函数体逐字相同，
       裸锚点会先命中文件里更早的 P-203 块（变异打错位置 = 静默失效，R2 教训）。 */
    { id: 'M1 来源纪律删掉', expect: ['⑦-1'], pairs: [[
      'function mpwPropsCompatFromParent(ev) {\n  let fromParent = false\n  try { fromParent = (ev.source === window.parent) } catch (e) { fromParent = false }\n  if (!fromParent && ev.source !== window && ev.source != null) return false\n  return true\n}',
      'function mpwPropsCompatFromParent(ev) {\n  return true\n}',
    ]] },
    { id: 'M2 legacy 闸删掉', expect: ['⑧-3'], pairs: [['if (MPW_PROPS_COMPAT_LEGACY) return null', 'if (false) return null']] },
    { id: 'M3 rid 幂等删掉', expect: ['③-1', '③-2', '③-3'], pairs: [['if (rid !== null && mpwPropsCompat.ridMemo.has(rid)) {', 'if (false) {']] },
    { id: 'M4 非法载荷零改动删掉', expect: ['⑤-5'], pairs: [
      ["const raw = (D.hidden !== undefined) ? D.hidden : ((D.payload && typeof D.payload === 'object') ? D.payload.hidden : null)",
        "let raw = (D.hidden !== undefined) ? D.hidden : ((D.payload && typeof D.payload === 'object') ? D.payload.hidden : null)"],
      ["if (!Array.isArray(raw)) return { ok: false, why: 'bad-payload（期望 {hidden:[下标数组]}，如 {hidden:[1,4]}；空数组 = 全部恢复显示）' }",
        'if (!Array.isArray(raw)) raw = []'],
    ] },
  ]
  for (const m of MUTS) {
    let reds = [], out = ''
    try { ({ reds, out } = runVariant((s) => { let x = s; for (const [a, b] of m.pairs) { if (x.indexOf(a) < 0) return s; x = x.replace(a, b) } return x }, m.id)) }
    catch (e) { ok(false, `M ${m.id} 注入成功`, String(e && e.message)); continue }
    const want = m.expect.slice().sort(); const got = reds.filter((x) => CASES.indexOf(x) >= 0).sort()
    ok(JSON.stringify(got) === JSON.stringify(want), `M ${m.id}：期望红集 == 实际红集`,
      '期望=' + JSON.stringify(want) + ' 实际=' + JSON.stringify(got) + (reds.length && !got.length ? '｜原红行: ' + reds.slice(0, 3).join(',') : ''))
  }
  /* 副本纪律：真树跑前跑后 sha256 不变 */
  const SHA1 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'demo.html'))).digest('hex')
  ok(SHA0 === SHA1, 'D0 变异只打在副本上（真树 demo.html sha256 跑前跑后一致）', SHA1.slice(0, 16) + '…')
}

console.log(`\n===== props-compat: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

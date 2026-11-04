// tools/props-compat-test.mjs —— **插件兼容层（属性/层控 op 客户端）**的判据（任务单 P4，离线桩）
//
// 钉六件事（都不靠浏览器）：
//   A 源码口径：五个 op 与 `-result` 回执、`propscompat=legacy` 回退口、台账 `window.__mpwPropsCompat`、
//     超时/重试上限常量、镜像适配器（rowsFromCompatModel）、清理自证三件套、切换弹窗（两键 + Enter/Esc +
//     propSwitchAsk）、`mpwApplyWallFromList` 守卫（先弹窗后加载）、面板数据源接线（describe.model）。
//   B 行为（**真源码切片** + `new Function` 驱动）：① 发出 op 且 rid 唯一；② 回执按 rid 配对 resolve；
//     ③ 超时 ⇒ 同 rid 重发（重试上限内）⇒ 耗尽 ⇒ ok:false + 'timeout-exhausted'（不抛）；
//     ④ 幂等：同帧同 op 同载荷在途 ⇒ 复用 Promise、只发一次；⑤ legacy ⇒ Active=false；
//     ⑥ 非本帧来源的回执不消费。
//   C 对拍（真源模块 vs client.js 镜像）：`lib/scene-props-compat.js` 与切片在**同一批夹具**上必须给
//     出同一个答案（行适配器 / 切换询问判定 / 自证三件套 / legacy 解析 / 状态机结局）——镜像漂移必红。
//   D 变异自证：删幂等 / 删重试 / legacy 失效 / 删回执帧校验 —— 四种变异各自必红（期望红集逐条相等）。
//
// 运行：node tools/props-compat-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(import.meta.dirname, '..')
const CLIENT = process.env.MPW_PROPS_COMPAT_CLIENT || path.join(REPO, 'lib', 'client.js')
const SRC = fs.readFileSync(CLIENT, 'utf8')
const B_BEGIN = '// [scene-props-compat BEGIN]'
const B_END = '// [scene-props-compat END]'

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + String(detail).slice(0, 220) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  [' + String(detail).slice(0, 320) + ']' : '')) }
}
const eq = (a, b, name) => ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`)

function sliceBlock(src) {
  const i = src.indexOf(B_BEGIN)
  if (i < 0) return null
  const j = src.indexOf(B_END, i)
  if (j < 0) return null
  return src.slice(i, j)
}
const BLOCK = sliceBlock(SRC)

/** 切片驱动：注入 window/readSection/bgElements/定时器 桩。 */
function harness(src, opts) {
  const block = sliceBlock(src)
  if (!block) return null
  const O = opts || {}
  const posted = []
  const timers = []
  const frame = O.noFrame ? null : (O.frame || (() => {
    const f = { contentWindow: { postMessage: (m, t) => posted.push({ m, t }) }, __src: 'http://127.0.0.1:3080/webloader/?pkgurl=x&st=TK' }
    f.getAttribute = (k) => (k === 'src' ? f.__src : null)
    return f
  })())
  const win = Object.assign({ __mpwPropsCompat: null, __mpwPropsCompatCache: null, __mpwPropsCompatCacheMiss: null }, O.win || {})
  const listeners = []
  win.addEventListener = (t, fn) => { if (t === 'message') listeners.push(fn) }
  const setT = (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, cleared: false, done: false }); return id }
  const clearT = (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true }
  const section = O.section || {}
  const api = new Function('window', 'readSection', 'bgElements', 'setTimeout', 'clearTimeout',
    block + '\nreturn { call: mpwPropsCompatCall, result: mpwPropsCompatResult, active: mpwPropsCompatActive, legacy: mpwPropsCompatLegacy,'
    + ' describe: mpwPropsCompatDescribe, reset: mpwPropsCompatReset, layersList: mpwPropsCompatLayersList, layersSet: mpwPropsCompatLayersSet,'
    + ' uiSet: mpwPropsCompatUiSet, rowsFrom: mpwPropsRowsFromCompatModel, needsAsk: mpwPropsNeedsSwitchAsk, verify: mpwPropsVerifyResetDone,'
    + ' state: mpwPropsCompatState, ledger: () => window.__mpwPropsCompat, OPS: MPW_PROPS_COMPAT_OPS, TIMEOUT: MPW_PROPS_COMPAT_TIMEOUT_MS, RETRY_CAP: MPW_PROPS_COMPAT_RETRY_CAP };')(
    win, () => section, () => ({ frame }), setT, clearT)
  /** 一步一个定时器：跑第 n 步（默认 1 步）——超时/重试的时序要**逐拍**验证，不能一把跑光。 */
  const tick = (n = 1) => {
    let ran = 0
    for (; ran < n; ran++) {
      const t = timers.find((x) => !x.cleared && !x.done)
      if (!t) break
      t.done = true
      t.fn()
    }
    return ran
  }
  return { api, posted, timers, frame, win, listeners, tick }
}
/** 构造一条来自本帧的回执 message。 */
const receiptEv = (H, body) => ({ data: body, source: H.frame.contentWindow, origin: 'http://127.0.0.1:3080' })

console.log('== A 源码口径（任务单 P4 兼容层）==')
ok('A0 兼容层切片存在（哨兵命中）', !!BLOCK)
{
  const S = BLOCK || ''
  for (const op of ['mpw-props-describe', 'mpw-props-reset', 'mpw-layers-list', 'mpw-layers-set', 'mpw-ui-set']) {
    ok(`A1 op 在：\`${op}\``, S.indexOf('"' + op + '"') >= 0)
    ok(`A2 回执类型派生在：\`${op}-result\``, /-result"/.test(S) || S.indexOf('op + "-result"') >= 0)
  }
  ok('A3 legacy 回退口（propscompat 解析点在切片内）', S.indexOf('propscompat') >= 0 && S.indexOf("([^;&\\s]*)") >= 0,
    '解析点正则 + 旗标名都在')
  ok('A3b legacy 同义值（legacy/off/0/false）', S.indexOf('v === "legacy" || v === "off" || v === "0" || v === "false"') >= 0,
    '与 proppush=legacy 同一套口径')
  ok('A4 台账挂 window.__mpwPropsCompat', /window\.__mpwPropsCompat = mpwPropsCompatState\.ledger/.test(S))
  ok('A5 超时/重试上限常量', /MPW_PROPS_COMPAT_TIMEOUT_MS = 4000/.test(S) && /MPW_PROPS_COMPAT_RETRY_CAP = 2/.test(S))
  ok('A6 rid 单调唯一（seq + 时间尾）', /"pc" \+ \(\+\+mpwPropsCompatState\.seq\) \+ "-" \+ Date\.now\(\)\.toString\(36\)/.test(S))
  ok('A7 幂等（同帧同 op 同载荷 ⇒ 复用在途）', /rec\.sig === sig/.test(S) && /return rec\.promise/.test(S))
  ok('A8 回执只认本帧（ev.source === frame.contentWindow）', /f\.contentWindow === ev\.source/.test(S))
  ok('A9 耗尽 ⇒ ok:false + timeout-exhausted（不抛）', /timeout-exhausted/.test(S) && /resolve\(\{ type: mpwPropsCompatResultTypeOf\(op\), rid, ok: false/.test(S))
  ok('A10 行适配器（渲染器 model → 面板行）', /function mpwPropsRowsFromCompatModel\(/.test(S) && /isGroup/.test(S) && /visible === false/.test(S))
  ok('A11 自证三件套（propEdits-cleared / receipt-ok / values-eq-default）',
    /propEdits-cleared/.test(S) && /receipt-ok/.test(S) && /values-eq-default/.test(S))
}
{
  ok('A12 切换守卫在 mpwApplyWallFromList（先弹窗后加载 + skipAsk 重入）',
    /function mpwApplyWallFromList\(w, ui, skipAsk\)/.test(SRC) && /mpwPropsNeedsSwitchAsk\(s && s\.propEdits, s && s\.mpkgKey, w && w\.key\)/.test(SRC))
  ok('A13 弹窗两键 + Enter/Esc（data-mpw-propask-* + keydown）',
    /data-mpw-propask-save/.test(SRC) && /data-mpw-propask-discard/.test(SRC) && /ev\.key === "Enter"/.test(SRC) && /ev\.key === "Escape"/.test(SRC))
  ok('A14 「以后不再询问」= propSwitchAsk（默认询问）',
    /s\.propSwitchAsk !== void 0 \? !!s\.propSwitchAsk : true/.test(SRC) && /propSwitchAsk: false/.test(SRC))
  ok('A15 恢复默认 = 回执驱动（reset → ok 才更新 UI）+ 自证诊断',
    /mpwPropsCompatReset\(\)/.test(SRC) && /props-reset-verify/.test(SRC) && /mpwPropsVerifyResetDone\(/.test(SRC))
  ok('A16 面板数据源接线（describe.model → 行适配器；本地模型兜底 + legacy）',
    /mpwPropsRowsFromCompatModel\(compatDesc\.model, propEdits\)/.test(SRC) && /props\.compatSrc/.test(SRC) && /mpwPropsModel\(allProps, propEdits\)/.test(SRC))
  ok('A17 全局弹窗桥（扫描 tab 的 scanUi 也能弹同一个）', /globalThis\.__mpwPropAskBridge/.test(SRC))
}

console.log('\n== B 行为（真源码切片驱动）==')
{
  /* ① 发出 op + rid 唯一；② 回执按 rid 配对；⑤ describe 缓存 */
  const H = harness(SRC)
  const p1 = H.api.call('mpw-props-describe', {})
  ok('B1 发出 op（type + rid）', H.posted.length === 1 && H.posted[0].m.type === 'mpw-props-describe' && typeof H.posted[0].m.rid === 'string',
    JSON.stringify(H.posted[0] && H.posted[0].m))
  const rid1 = H.posted[0].m.rid
  const p2 = H.api.call('mpw-layers-list', {})
  ok('B2 rid 互不相同', H.posted[1].m.rid !== rid1, `${rid1} vs ${H.posted[1].m.rid}`)
  const consumed = H.api.result(receiptEv(H, { type: 'mpw-props-describe-result', rid: rid1, ok: true, schemaVersion: 1, model: { items: [] }, values: {} }))
  ok('B3 回执按 rid 配对消费', consumed === true)
  p1.then((r) => {
    ok('B4 describe 回执 resolve（ok + model 原样）', r && r.ok === true && !!r.model && r.rid === rid1, JSON.stringify(r && { ok: r.ok, rid: r.rid }))
  })
  /* ⑤ describe 带缓存：成功 ⇒ 写 __mpwPropsCompatCache；再调（同 key、未过期）⇒ 不再发 */
  const H5d = harness(SRC)
  const dPr = H5d.api.describe()
  const dRid = H5d.posted[0].m.rid
  H5d.api.result(receiptEv(H5d, { type: 'mpw-props-describe-result', rid: dRid, ok: true, model: { items: [] }, values: {} }))
  dPr.then(async (r) => {
    ok('B5 describe 成功 ⇒ 缓存写入（__mpwPropsCompatCache）', !!H5d.win.__mpwPropsCompatCache && !!H5d.win.__mpwPropsCompatCache.model, JSON.stringify(!!H5d.win.__mpwPropsCompatCache))
    const n0 = H5d.posted.length
    const r2 = await H5d.api.describe()
    ok('B5b 同 key 未过期 ⇒ 走缓存（不再发）', H5d.posted.length === n0 && r2 && r2.ok === true, 'posted=' + H5d.posted.length)
  })
  const pForeign = H.api.result({ data: { type: 'mpw-props-describe-result', rid: 'stranger', ok: true }, source: { postMessage: () => {} }, origin: 'x' })
  ok('B6 陌生 rid 的回执不消费', pForeign === false)
  const pWrongSrc = H.api.result({ data: { type: 'mpw-layers-list-result', rid: H.posted[1].m.rid, ok: true, layers: [] }, source: { postMessage: () => {} }, origin: 'x' })
  ok('B7 非本帧来源的回执不消费', pWrongSrc === false)

  /* ③ 超时 ⇒ 同 rid 重发 ⇒ 耗尽 */
  const H2 = harness(SRC)
  const q = H2.api.call('mpw-props-reset', {})
  const ridR = H2.posted[0].m.rid
  const sends0 = H2.posted.length
  H2.tick(1)                                    // 第一次超时 ⇒ 重试（同 rid；逐拍验证）
  ok('B8 超时 ⇒ 同 rid 重发', H2.posted.length === sends0 + 1 && H2.posted[sends0].m.rid === ridR && H2.posted[sends0].m.type === 'mpw-props-reset',
    JSON.stringify(H2.posted[sends0] && H2.posted[sends0].m))
  H2.tick(2)                                    // 再两拍 ⇒ 重试耗尽（cap=2 ⇒ 最多 3 发）
  ok('B9 最多 3 次发送（1 + retryCap=2）', H2.posted.length === sends0 + 2, 'posted=' + H2.posted.length)
  q.then((r) => {
    ok('B10 耗尽 ⇒ ok:false + timeout-exhausted（不抛）', r && r.ok === false && r.why === 'timeout-exhausted', JSON.stringify(r))
    ok('B11 台账记 timeouts', H2.api.ledger().timeouts === 1)
  })

  /* ④ 幂等 */
  const H3 = harness(SRC)
  const a = H3.api.call('mpw-layers-set', { hidden: [1] })
  const b = H3.api.call('mpw-layers-set', { hidden: [1] })
  ok('B12 同帧同 op 同载荷 ⇒ 复用在途（同一 Promise、只发一次）', a === b && H3.posted.length === 1, 'posted=' + H3.posted.length)
  const c = H3.api.call('mpw-layers-set', { hidden: [2] })
  ok('B13 载荷不同 ⇒ 新调用（再发一次）', c !== a && H3.posted.length === 2)

  /* ⑤ legacy + Active */
  const H4 = harness(SRC, { section: { sceneDebugParams: 'propscompat=legacy' } })
  eq(H4.api.legacy(), true, 'B14 propscompat=legacy 被识别')
  eq(H4.api.active(), false, 'B15 legacy ⇒ Active=false')
  const H4b = harness(SRC, { section: {} })
  eq(H4b.api.legacy(), false, 'B16 缺省档 = 非 legacy')
  eq(H4b.api.active(), true, 'B17 场景帧在 ⇒ Active=true')
  const H4c = harness(SRC, { noFrame: true, section: {} })
  eq(H4c.api.active(), false, 'B18 场景帧不在 ⇒ Active=false')

  /* 行适配器形状 */
  const H5 = harness(SRC)
  const model = { items: [
    { key: 'grp', isGroup: true, label: '分组' },
    { key: 'speed', type: 'slider', label: '速度', value: 0.5, defValue: 1, min: 0, max: 2, step: 0.1, visible: true },
    { key: 'flip', type: 'bool', label: '翻转', value: false, defValue: false, visible: true },
    { key: 'hidden', type: 'bool', label: '不可见', visible: false },
    { key: 'note1', type: '', label: '文案行', visible: true },
  ] }
  const rows = H5.api.rowsFrom(model, { speed: 1.5 })
  ok('B19 行数（不可见行不渲染）', rows.length === 4, 'rows=' + rows.length)
  const rSpeed = rows.find((r) => r.key === 'speed')
  ok('B20 行形状：显示值优先 propEdits + edited 标记 + min/max/step 透传',
    rSpeed && rSpeed.kind === 'control' && rSpeed.type === 'slider' && rSpeed.value === 1.5 && rSpeed.edited === true
    && rSpeed.min === 0 && rSpeed.max === 2 && rSpeed.step === 0.1 && rSpeed.group === 'grp', JSON.stringify(rSpeed || null))
  const rGrp = rows.find((r) => r.key === 'grp')
  ok('B21 分组行 childCount（可见子项计 3，不可见行不计）', rGrp && rGrp.kind === 'group' && rGrp.childCount === 3, 'childCount=' + (rGrp && rGrp.childCount))
  const rNote = rows.find((r) => r.key === 'note1')
  ok('B22 无控件条目 ⇒ note 行', rNote && rNote.kind === 'note')

  /* 切换询问判定 + 自证三件套 */
  ok('B23 needsAsk：旧壁纸有非空 propEdits 且目标不同 ⇒ true',
    H5.api.needsAsk({ 'k1': { a: 1 } }, 'k1', 'k2') === true)
  ok('B24 needsAsk：同一张 / 无改动 / 无旧键 ⇒ false',
    H5.api.needsAsk({ 'k1': { a: 1 } }, 'k1', 'k1') === false && H5.api.needsAsk({ 'k1': {} }, 'k1', 'k2') === false
    && H5.api.needsAsk(null, 'k1', 'k2') === false)
  const v1 = H5.api.verify({ receipt: { ok: true }, propEditsAfter: {}, key: 'k1', values: { speed: 1 }, model: { items: [{ key: 'speed', defValue: 1 }] } })
  ok('B25 自证三件套全过 ⇒ pass', v1.pass === true && v1.checks.length === 3, JSON.stringify(v1))
  const v2 = H5.api.verify({ receipt: { ok: true }, propEditsAfter: { k1: { a: 1 } }, key: 'k1', values: { speed: 1 }, model: { items: [{ key: 'speed', defValue: 1 }] } })
  ok('B26 本地没清干净 ⇒ 不通过（不假装成功）', v2.pass === false && v2.checks.some((c) => c.id === 'propEdits-cleared' && !c.ok))
}

console.log('\n== C 对拍（真源模块 vs client.js 镜像）==')
{
  ;(async () => {
    try {
      const MOD = await import(path.join(REPO, 'lib', 'scene-props-compat.js'))
      const H = harness(SRC)
      /* legacy 解析对拍 */
      for (const p of ['propscompat=legacy', 'a=1;propscompat=off', 'x=1 propscompat=0', 'propscompat=1', 'other=legacy', '']) {
        const m = MOD.propsCompatLegacyOf(p)
        const c = harness(SRC, { section: { sceneDebugParams: p } }).api.legacy()
        eq(m, c, `C1 legacyOf 对拍：${JSON.stringify(p)} ⇒ ${m}`)
      }
      /* 行适配器对拍（同一夹具逐行 JSON 相等） */
      const model = { items: [
        { key: 'g', isGroup: true, label: 'G' },
        { key: 'a', type: 'slider', label: 'A', value: 2, defValue: 3, min: 0, max: 5, step: 1, visible: true },
        { key: 'b', type: 'combo', label: 'B', value: 'x', defValue: 'y', options: [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }], visible: true },
        { key: 'c', type: 'color', label: 'C', value: '1 2 3', defValue: '0 0 0', visible: false },
        { key: 'd', type: 'text', label: 'D', value: 'hi', defValue: '', visible: true },
      ] }
      const edits = { a: 4 }
      eq(JSON.stringify(MOD.rowsFromCompatModel(model, edits)), JSON.stringify(H.api.rowsFrom(model, edits)),
        'C2 rowsFromCompatModel 对拍（逐行 JSON 相等）')
      /* needsAsk / verify 对拍 */
      eq(MOD.needsPropsSwitchAsk({ k: { a: 1 } }, 'k', 'j'), H.api.needsAsk({ k: { a: 1 } }, 'k', 'j'), 'C3 needsAsk 对拍 true')
      eq(MOD.needsPropsSwitchAsk({}, 'k', 'j'), H.api.needsAsk({}, 'k', 'j'), 'C3 needsAsk 对拍 false')
      const vf = { receipt: { ok: true }, propEditsAfter: { k: {} }, key: 'k', values: { a: 1 }, model: { items: [{ key: 'a', defValue: 1 }] } }
      eq(JSON.stringify(MOD.verifyPropsResetDone(vf)), JSON.stringify(H.api.verify(vf)), 'C4 verify 三件套对拍')
      /* 状态机对拍：同一场景（超时耗尽）两侧结局一致 */
      {
        const modWin = {}
        const modTimers = []
        const client = MOD.createPropsCompatClient({
          post: () => true, now: () => Date.now(),
          setTimeout: (fn) => { modTimers.push(fn); return modTimers.length }, clearTimeout: (id) => { if (modTimers[id - 1]) modTimers[id - 1] = null },
          ledgerTarget: modWin,
        })
        const pr = client.call('F', 'mpw-props-reset', {})
        for (let i = 0; i < 6; i++) { const t = modTimers.find((x) => typeof x === 'function'); if (!t) break; modTimers[modTimers.indexOf(t)] = null; t() }
        const rMod = await pr
        const H2 = harness(SRC)
        const pr2 = H2.api.call('mpw-props-reset', {})
        H2.tick(8)
        const rCli = await pr2
        eq(rMod.ok, rCli.ok, 'C5 状态机对拍：超时耗尽结局一致（ok=false）')
        eq(rMod.why, rCli.why, 'C6 状态机对拍：why 一致（timeout-exhausted）')
      }
    } catch (e) {
      ok('C0 对拍段执行', false, String(e && e.message || e))
    }
  })()
}

/* ── D. 变异自证（子进程 + MPW_PROPS_COMPAT_CLIENT 指向变异副本；期望红集逐条相等） ── */
if (!process.env.MPW_PROPS_COMPAT_MUT) {
  console.log('\n== D 变异自证 ==')
  const MUTS = [
    { id: 'M1 幂等删掉', expect: ['B12', 'B13'], pairs: [['for (const rec of mpwPropsCompatState.pending.values()) {', 'for (const rec of []) {']] },
    { id: 'M2 重试删掉（超时直接耗尽）', expect: ['B8', 'B9'], pairs: [['if (rec.attempts <= MPW_PROPS_COMPAT_RETRY_CAP) {', 'if (false) {']] },
    /* 锚点带真实缩进（块内是 2 个 tab）；在解析点最前面插一条恒 return，让 legacy 恒 false。 */
    { id: 'M3 legacy 失效（恒 false）', expect: ['B14', 'B15'], pairs: [[
      'function mpwPropsCompatLegacy() {\n\t\t\ttry {',
      'function mpwPropsCompatLegacy() {\n\t\t\ttry { if (1) return false;',
    ]] },
    { id: 'M4 回执帧校验删掉', expect: ['B7'], pairs: [['try { same = !!(f && f.contentWindow && f.contentWindow === ev.source) } catch (e) { same = false }\n\t\t\t\tif (!same) return false;',
        'try { same = !!(f && f.contentWindow && f.contentWindow === ev.source) } catch (e) { same = false }\n\t\t\t\tif (false) return false;']] },
  ]
  const tmpRoot = fs.mkdtempSync(path.join(path.dirname(process.env.TMPDIR || '/tmp'), 'mpw-propscompat-plug-'))
  for (const m of MUTS) {
    let mutated = SRC
    let injectOk = true
    for (const [from, to] of m.pairs) {
      if (mutated.indexOf(from) < 0) { injectOk = false; break }
      mutated = mutated.replace(from, to)
    }
    if (!injectOk || mutated === SRC) { ok(`变异 ${m.id} 注入成功`, false, '锚点没命中（源码改了？）'); continue }
    const copy = path.join(tmpRoot, 'client-' + m.id.replace(/\W+/g, '-') + '.js')
    fs.writeFileSync(copy, mutated)
    const me = fileURLToPath(import.meta.url)
    const r = spawnSync(process.execPath, [me], { encoding: 'utf8', env: Object.assign({}, process.env, { MPW_PROPS_COMPAT_MUT: m.id, MPW_PROPS_COMPAT_CLIENT: copy }), timeout: 60000 })
    const out = String(r.stdout || '') + String(r.stderr || '')
    /* 变异子进程里只看对应那条断言是否变红；且别的 B 段不许连带红（红集逐条）。 */
    const reds = out.split('\n').filter((l) => l.includes('✗ B'))
      .map((l) => (l.match(/✗ (B\d+)/) || [])[1]).filter(Boolean)
    const want = m.expect.slice().sort()
    ok(`变异 ${m.id}：期望 ${JSON.stringify(want)} 红，实际 ${JSON.stringify(reds.sort())}`,
      JSON.stringify(reds.sort()) === JSON.stringify(want), out.includes('✗') ? 'red=' + reds.join(',') : 'PASS')
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉不抛 */ }
} else {
  /* 变异子进程模式：只跑 A+B 段（跳过 D），红集由父进程解析。 */
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

setTimeout(() => {
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}, 300)

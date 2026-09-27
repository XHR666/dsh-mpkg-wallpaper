// scene-props-push-test.mjs —— **场景帧属性下发通道（P-203）**的判据（离线桩，不开浏览器）
//
// 现场：改「WE 自带选项 / 包内 general.properties」的属性只**持久化**，要下次应用壁纸才生效 ——
// 插件把改动写进 `propEdits` 并落盘，但场景渲染器帧（127.0.0.1:8902）与插件页（3080）**不同源**，
// `contentDocument`/`__wp` 都够不着；渲染器侧 `mpwWebApplyProps` 的场景档分支早已接好 ⇒ 缺的只是
// "跨源那一跳"。本判据钉四件事（都**不靠浏览器**）：
//   A 源码口径：op/回执名、三个触发点（`setProp` / 挂载·重载·刷新 / 恢复默认）、回执监听、
//     退避重试有上限、回退口 `proppush=legacy`（且进了 `MPW_SCENE_DEBUG_KEYS` ⇒ 同一旗标也进帧 URL）、
//     台账 `window.__mpwRendererPropsPush`。
//   B 行为（**真源码切片** + `new Function` 驱动）：① `setProp` 形状 ⇒ 发出 op 且载荷形状正确；
//     ② 帧重载（contentWindow 换了）⇒ 即使值没变也重发一次；③ 同帧同值 ⇒ 不重发（幂等），
//     但**回执说没生效**时下一趟要重发（重试）；④ `legacy` ⇒ 一个字节都不发；⑤ 帧不在/空表 ⇒ 如实记账。
//   C 挂载路径：`mpwScenePropsAfterMount` 推整表 / 无改动一个字节都不发 / 网页壁纸帧不发。
//   D 变异自证：**删调用 / 去重发 / 去"刷新必重发" / 去幂等 / 回退口失效 / 删重试 / 删挂载点 / 删重试排程** —— 八种变异**各自必红**
//     （在同一份检查函数上跑变异源码，真树一字不动）。
//
// 运行：node tools/scene-props-push-test.mjs   （全过 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const CLIENT = process.env.MPW_SCENE_PROPS_CLIENT || path.join(REPO, 'lib', 'client.js')
const SRC_REAL = fs.readFileSync(CLIENT, 'utf8')
const START = 'const MPW_SCENE_PROPS_MAX_ATTEMPTS = 10;'
const END = '/** ①(新) web 壁纸静音：iframe.muted + 内部所有 audio/video 元素 muted。'

/** 切片：块的唯一定界（判据只认这一段真源码；变异也切这一段）。 */
function sliceBlock(SRC) {
  const i = SRC.indexOf(START)
  if (i < 0) return null
  const j = SRC.indexOf(END, i)
  if (j < 0) return null
  return SRC.slice(i, j)
}
/** 把切片装进一个"迷你页面"：只注入 `window`/`readSection`/`bgElements`/定时器（其余都是块内真源码）。 */
function harness(SRC, section) {
  const block = sliceBlock(SRC)
  if (!block) return null
  const posted = []
  const timers = []
  const frame = { contentWindow: { postMessage: (m, t) => posted.push({ m, t }) }, __src: 'http://127.0.0.1:8902/?pkgurl=x' }
  frame.getAttribute = (k) => (k === 'src' ? frame.__src : null)
  const win = { __mpwRendererPropsPush: null }
  const listeners = []
  win.addEventListener = (t, fn) => { if (t === 'message') listeners.push(fn) }
  const setTimeoutStub = (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, cleared: false }); return id }
  const clearTimeoutStub = (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true }
  const api = new Function('window', 'readSection', 'bgElements', 'setTimeout', 'clearTimeout',
    block + '\nreturn { send: sendRendererSceneProps, receipt: mpwScenePropsReceipt, afterMount: mpwScenePropsAfterMount,'
    + ' wire: mpwScenePropsWire, legacy: mpwScenePropsLegacy, note: mpwScenePropsNote, MAX: MPW_SCENE_PROPS_MAX_ATTEMPTS, OP: MPW_SCENE_PROPS_OP, ACK: MPW_SCENE_PROPS_ACK };')(
    win, () => section, () => ({ frame }), setTimeoutStub, clearTimeoutStub)
  return { api, posted, timers, frame, win, listeners, tick: (n = 1) => { for (let i = 0; i < n; i++) { const t = timers.find((x) => !x.cleared && !x.done); if (!t) return false; t.done = true; t.fn() } return true } }
}
const newCw = () => ({ postMessage: () => {} })

/** 全部检查 = 「源码」的函数（变异时拿同一份检查去跑变异源码 ⇒ "必红"是可证的，不是自我声明）。 */
function runAll(SRC) {
  const R = []
  const ok = (name, cond, detail) => R.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) })
  const sl = sliceBlock(SRC)

  // ── A 源码口径 ──
  ok('A0 属性通道块可切片（锚点命中）', !!sl)
  const S = sl || ''
  ok('A1 op = `mpw-user-props` / 回执 = `mpw-props-applied`',
    /MPW_SCENE_PROPS_OP = "mpw-user-props"/.test(S) && /MPW_SCENE_PROPS_ACK = "mpw-props-applied"/.test(S))
  ok('A2 `setProp` 真接场景帧分支（`pkgurl=` 帧 ⇒ `sendRendererSceneProps(..., "setProp")`）',
    /else if \(frame && String\(frame\.getAttribute\("src"\) \|\| ""\)\.indexOf\("pkgurl="\) >= 0\) sendRendererSceneProps\(frame, \{ \[key\]: \{ value \} \}, "setProp"\);/.test(SRC))
  ok('A2b `setProp` 的 web 帧那条（shim `op:"props"`）**没被动过**',
    /if \(frame && mpwWebShimUrl\(frame\.getAttribute\("src"\)\)\) webShimCallChecked\(frame, \{ op: "props", props: \{ \[key\]: \{ value \} \} \}, "setProp"\);/.test(SRC))
  const onload = (/frame\.onload = \(\) => \{([\s\S]*?)\n\t\t\t\};/.exec(SRC) || [, ''])[1]
  ok('A3 挂载/重载/刷新之后推一次（`frame.onload` 里调 `mpwScenePropsAfterMount(frame, true)` = 新文档强制重发）',
    /mpwScenePropsAfterMount\(frame, true\)/.test(onload), 'onload len=' + onload.length)
  const reentry = (/if \(__urlId\(frame\.getAttribute\("src"\)\) === __urlId\(url\)\) \{([\s\S]*?)\n\t\t\t\} catch \{\}/.exec(SRC) || [, ''])[1]
  ok('A3b 同 URL 重入（onload 不触发那条）也补一次，但**不带 fresh**（没有新文档 ⇒ 走幂等）',
    /mpwScenePropsAfterMount\(frame\)/.test(reentry) && !/mpwScenePropsAfterMount\(frame, true\)/.test(reentry))
  ok('A4 恢复默认 ⇒ 把**作者默认值**推回去（`sendRendererSceneProps(frame, back, "reset")`）',
    /sendRendererSceneProps\(frame, back, "reset"\)/.test(SRC) && /const it = allProps\.find\(\(p\) => p && p\.key === k\)/.test(SRC))
  ok('A5 回执监听装一次（`window.__mpwScenePropsHook` + `mpwScenePropsReceipt`）',
    /window\.__mpwScenePropsHook/.test(S) && /addEventListener\("message", \(ev\) => \{ try \{ mpwScenePropsReceipt\(ev\) \} catch \(e\) \{\} \}\)/.test(S))
  ok('A6 只认**我们那个帧**的回执（`f.contentWindow === ev.source`）', /f\.contentWindow === ev\.source/.test(S))
  ok('A7 回退口读 `sceneDebugParams` 里的同一个旗标名 `proppush`',
    /proppush/.test(S) && /sceneDebugParams/.test(S) && /mpwScenePropsLegacy/.test(S))
  ok('A7b `proppush` 进了 `MPW_SCENE_DEBUG_KEYS`（同一旗标会被带进渲染器帧 URL ⇒ 两端一起关）',
    /const MPW_SCENE_DEBUG_KEYS = \[[^\]]*"proppush"\]/.test(SRC))
  ok('A8 退避重试**有上限**（`MPW_SCENE_PROPS_MAX_ATTEMPTS` + `retry-exhausted`）',
    /MPW_SCENE_PROPS_MAX_ATTEMPTS = \d+/.test(S) && /retry-exhausted/.test(S) && /attempts > MPW_SCENE_PROPS_MAX_ATTEMPTS/.test(S))
  ok('A9 台账 `window.__mpwRendererPropsPush`（`n`/`last`/`log`/`skipped`）',
    /window\.__mpwRendererPropsPush/.test(S) && /\bskipped\b/.test(S))
  ok('A10 幂等/重发口径写在代码里（`fresh`/`stale` = 新文档或 contentWindow 换了 / `sig` 比对）',
    /const fresh = force === "fresh";/.test(S) && /const stale = fresh \|\| !prev \|\| prev\.win !== cw;/.test(S) && /prev\.sig === sig/.test(S))

  // ── B 行为：真源码切片驱动 ──（`propEdits` 非空：`afterMount` 那条要真有改动可推）
  const H = harness(SRC, { sceneDebugParams: '', mpkgKey: 'k', propEdits: { k: { speed: 2.5, flip: true } } })
  ok('B0 行为夹具可建（块能跑起来）', !!H)
  if (H) {
    const { api } = H
    ok('B1 `setProp` 形状的推送 ⇒ 真的发出 op，载荷形状 = `{名:{value}}`',
      H.api.send(H.frame, { speed: 2.5, flip: true }, 'setProp') === true
      && H.posted.length === 1 && H.posted[0].m.type === 'mpw-user-props'
      && JSON.stringify(H.posted[0].m.props) === JSON.stringify({ speed: { value: 2.5 }, flip: { value: true } })
      && H.posted[0].m.why === 'setProp' && H.posted[0].t === '*',
      JSON.stringify(H.posted[0] || null))
    ok('B1b 裸值/`{value}` 两种入参归一后一致',
      JSON.stringify(api.wire({ a: 1, b: { value: 2 } })) === JSON.stringify({ a: { value: 1 }, b: { value: 2 } }))
    ok('B1c 台账：`n` 记发出次数 + `last.keys` 可读',
      H.win.__mpwRendererPropsPush && H.win.__mpwRendererPropsPush.n === 1
      && JSON.stringify(H.win.__mpwRendererPropsPush.last.keys) === JSON.stringify(['speed', 'flip']),
      JSON.stringify(H.win.__mpwRendererPropsPush && H.win.__mpwRendererPropsPush.last))
    // ② 帧重载（contentWindow 换了）⇒ 值没变也重发一次
    const n1 = H.posted.length
    H.frame.contentWindow = { postMessage: (m, t) => H.posted.push({ m, t }) }   // 新文档 = 老内容全丢
    const again = api.send(H.frame, { speed: 2.5, flip: true }, 'mount')
    ok('B2 帧重载 ⇒ **即使值没变也重发一次**（stale:true）',
      again === true && H.posted.length === n1 + 1 && H.frame.__mpwScenePropsPush.stale === true,
      JSON.stringify({ posted: H.posted.length, stale: H.frame.__mpwScenePropsPush.stale }))
    // ②b **刷新**（`frame.onload` ⇒ fresh）：同帧、同载荷、**已确认**也必须重发
    //    （WindowProxy 身份在导航前后**可能是同一个** ⇒ 只靠 contentWindow 判不出"新文档"）
    api.receipt({ data: { type: api.ACK, ok: true, count: 2, keys: ['speed', 'flip'] }, source: H.frame.contentWindow })
    const n2b = H.posted.length
    const remount = api.afterMount(H.frame, true)
    ok('B2b `frame.onload`（fresh）⇒ 同帧同值也**无条件重发**（刷新后渲染器状态已全丢）',
      remount === true && H.posted.length === n2b + 1 && H.frame.__mpwScenePropsPush.fresh === true,
      JSON.stringify({ remount, posted: H.posted.length, fresh: H.frame.__mpwScenePropsPush.fresh }))
    const sameUrl = api.afterMount(H.frame)
    ok('B2c 同 URL 重入（没有新文档 ⇒ 不带 fresh）⇒ 依旧幂等（不重发）',
      sameUrl === false && H.posted.length === n2b + 1)
    // ③ 同帧同值 ⇒ 不重发
    const n2 = H.posted.length
    const dup = api.send(H.frame, { speed: 2.5, flip: true }, 'setProp')
    ok('B3 同帧同值重复 ⇒ **不重发**（幂等）', dup === false && H.posted.length === n2, 'posted=' + H.posted.length)
    // ③b 回执 ok ⇒ 彻底确认；回执说没生效 ⇒ 保留待发（**重试**，不是破坏幂等）
    api.receipt({ data: { type: api.ACK, ok: true, count: 2, keys: ['speed', 'flip'], dest: 'scene-props' }, source: H.frame.contentWindow })
    ok('B3b 回执 ok ⇒ 记入 `receipt`、`want=false` 且撤销重试定时器',
      H.frame.__mpwScenePropsPush.receipt && H.frame.__mpwScenePropsPush.receipt.ok === true
      && H.frame.__mpwScenePropsPush.want === false && H.frame.__mpwScenePropsPush.pending === false
      && H.timers.every((t) => t.cleared || t.done),
      JSON.stringify({ receipt: H.frame.__mpwScenePropsPush.receipt, timers: H.timers.map((t) => ({ ms: t.ms, cleared: t.cleared })) }))
    const n3 = H.posted.length
    const dup2 = api.send(H.frame, { speed: 2.5, flip: true }, 'setProp')
    ok('B3c 确认之后同值再来 ⇒ 依旧不重发（幂等面覆盖"已确认"档）', dup2 === false && H.posted.length === n3)
    api.receipt({ data: { type: api.ACK, ok: false, count: 0, why: '本档没有用户属性表', dest: 'scene-props' }, source: H.frame.contentWindow })
    ok('B3d 回执 ok:false ⇒ `want=true`（保留待发，不假装已生效）',
      H.frame.__mpwScenePropsPush.want === true && H.frame.__mpwScenePropsPush.receipt.ok === false)
    const retried = api.send(H.frame, { speed: 2.5, flip: true }, 'retry')
    ok('B3e 未生效 ⇒ 下一次触发就补发（同载荷）', retried === true && H.posted.length === n3 + 1,
      JSON.stringify({ retried, posted: H.posted.length }))
    // ④ 退避重试有上限：连续"没生效"到上限后必须停，且**不再排新定时器**
    const sendsBefore = H.posted.length
    let guard = 0
    while (guard++ < 40) {
      api.receipt({ data: { type: api.ACK, ok: false, why: '面板还没装载' }, source: H.frame.contentWindow })
      if (!H.tick()) break
    }
    const sentInB4 = H.posted.length - sendsBefore
    ok('B4 退避重试到上限 ⇒ 停发并记 `exhausted`（不无限刷、不留常驻定时器）',
      H.frame.__mpwScenePropsPush.exhausted === true && H.frame.__mpwScenePropsPush.want === false
      && sentInB4 >= 1 && sentInB4 <= H.api.MAX + 1 && H.timers.filter((t) => !t.cleared && !t.done).length === 0,
      JSON.stringify({ guard, sentInB4, attempts: H.frame.__mpwScenePropsPush.attempts, live: H.timers.filter((t) => !t.cleared && !t.done).length }))
    // 回执只认自己那个帧 / 只认这个 type
    const n4 = H.posted.length
    const before = JSON.stringify(H.frame.__mpwScenePropsPush.receipt)
    ok('B5 别人发来的回执被忽略（`ev.source` 不是我们的帧）',
      api.receipt({ data: { type: api.ACK, ok: true }, source: newCw() }) === false && JSON.stringify(H.frame.__mpwScenePropsPush.receipt) === before)
    ok('B5b 别的 type 的回执被忽略', api.receipt({ data: { type: 'mpw-audio-policy' }, source: H.frame.contentWindow }) === false)
    ok('B5c 忽略路径不改任何状态', H.posted.length === n4)
  }
  // ④ legacy ⇒ 一个字节都不发
  const L = harness(SRC, { sceneDebugParams: 'ln=12; proppush=legacy', mpkgKey: 'k', propEdits: { k: { speed: 3 } } })
  ok('B6 `sceneDebugParams` 里 `proppush=legacy` ⇒ **一个字节都不发**（零 postMessage、零未确认）',
    L && L.api.legacy() === true && L.api.send(L.frame, { speed: 3 }, 'setProp') === false && L.posted.length === 0
    && L.api.afterMount(L.frame) === false && L.posted.length === 0
    && L.win.__mpwRendererPropsPush.skipped === 2 && L.win.__mpwRendererPropsPush.n === 0,
    JSON.stringify(L && L.win.__mpwRendererPropsPush && L.win.__mpwRendererPropsPush.last))
  ok('B6b `proppush=off` / `=0` / `=false` 同义；空值与其它值 = 接线（缺省档逐位不变）',
    L && harness(SRC, { sceneDebugParams: 'proppush=off' }).api.legacy() === true
    && harness(SRC, { sceneDebugParams: 'proppush=false' }).api.legacy() === true
    && harness(SRC, { sceneDebugParams: 'proppush=1' }).api.legacy() === false
    && harness(SRC, { sceneDebugParams: '' }).api.legacy() === false
    && harness(SRC, { sceneDebugParams: 'proppush' }).api.legacy() === false)
  // ⑤ 失败/帧不在/空表 ⇒ 如实记账，不假装成功
  const N = harness(SRC, { sceneDebugParams: '', mpkgKey: 'k', propEdits: {} })
  ok('B7 帧不在 ⇒ `posted:false` + 原因（不假装成功）',
    N && N.api.send(null, { a: 1 }, 'setProp') === false && N.win.__mpwRendererPropsPush.skipped === 1
    && N.win.__mpwRendererPropsPush.last.reason === 'no-frame', JSON.stringify(N && N.win.__mpwRendererPropsPush.last))
  ok('B7b 空表/非法表 ⇒ 不发，`reason:"no-props"`',
    N && N.api.send(N.frame, {}, 'setProp') === false && N.api.send(N.frame, null, 'setProp') === false
    && N.win.__mpwRendererPropsPush.skipped === 3 && N.posted.length === 0)
  // C 挂载路径
  const M = harness(SRC, { sceneDebugParams: '', mpkgKey: 'k', propEdits: { k: { brightness: 0.5, hue: -20 } } })
  ok('C1 挂载/重载 ⇒ 把该壁纸的 `propEdits` **整表**推一次',
    M && M.api.afterMount(M.frame) === true && M.posted.length === 1
    && JSON.stringify(M.posted[0].m.props) === JSON.stringify({ brightness: { value: 0.5 }, hue: { value: -20 } })
    && M.posted[0].m.why === 'mount', JSON.stringify(M && M.posted[0] && M.posted[0].m))
  const M2 = harness(SRC, { sceneDebugParams: '', mpkgKey: 'k', propEdits: {} })
  ok('C2 没有改动 ⇒ **一个字节都不发**（缺省档与改动前逐位一致）',
    M2 && M2.api.afterMount(M2.frame) === false && M2.posted.length === 0 && M2.win.__mpwRendererPropsPush === null)
  const M3 = harness(SRC, { sceneDebugParams: '', mpkgKey: 'k', propEdits: { k: { a: 1 } } })
  M3.frame.__src = 'http://127.0.0.1:8902/?type=web&src=x'
  ok('C3 网页壁纸帧不发（那条走 shim 的 `op:"props"`，两条通道不混）',
    M3.api.afterMount(M3.frame) === false && M3.posted.length === 0)
  const M4 = harness(SRC, { sceneDebugParams: '', mpkgKey: 'other', propEdits: { k: { a: 1 } } })
  ok('C4 换壁纸后只推**当前**那一个壁纸的改动（按 `mpkgKey` 取）',
    M4.api.afterMount(M4.frame) === false && M4.posted.length === 0)
  // 重试定时器：挂载后未确认 ⇒ 排了一次退避；回执 ok 后必须撤掉（不留常驻定时器）
  const T = harness(SRC, { sceneDebugParams: '', mpkgKey: 'k', propEdits: { k: { a: 1 } } })
  T.api.afterMount(T.frame)
  const timerOk = T.timers.length === 1 && T.timers[0].ms === 1500 && !T.timers[0].cleared
  T.api.receipt({ data: { type: T.api.ACK, ok: true, count: 1 }, source: T.frame.contentWindow })
  ok('C5 未确认时排一次退避重试；回执 ok ⇒ 撤销（无常驻定时器）',
    timerOk && T.timers[0].cleared === true, JSON.stringify(T.timers))
  T.tick()
  ok('C5b 撤销后的重试回调不再发（幂等面不因定时器破口）', T.posted.length === 1)
  return R
}

// ── 跑真树 ──
const real = runAll(SRC_REAL)
console.log('== A/B/C 判据（真源码：' + path.relative(REPO, CLIENT) + '）==')
for (const r of real) console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.name + (r.detail ? '  [' + r.detail.slice(0, 200) + ']' : ''))
let pass = real.filter((r) => r.ok).length
let fail = real.length - pass

// ── D 变异自证（同一份检查跑变异源码 ⇒ "必红"可证；真树一字不动）──
console.log('\n== D 变异自证（内存副本，真树不动）==')
const MUTS = [
  ['D1 删调用（`setProp` 的场景帧分支去掉）', 'else if (frame && String(frame.getAttribute("src") || "").indexOf("pkgurl=") >= 0) sendRendererSceneProps(frame, { [key]: { value } }, "setProp");', '', 'A2'],
  ['D2 去重发（帧元素换了也不再下发：`stale` 不看 contentWindow）', 'const stale = fresh || !prev || prev.win !== cw;', 'const stale = fresh || !prev;', 'B2'],
  ['D2b 去刷新强制（`fresh` 失效 ⇒ `onload` 后同值不重发）', 'const fresh = force === "fresh";', 'const fresh = false;', 'B2b'],
  ['D3 去幂等（同帧同值也重发）', 'if (!stale && !want && !retry && prev.sig === sig) return false;', 'if (false) return false;', 'B3'],
  ['D4 回退口失效（`legacy` 照样发）', 'if (mpwScenePropsLegacy()) { mpwScenePropsNote(frame, { keys: keys, why: whyS, posted: false, reason: "proppush=legacy" }); return false; }', '', 'B6'],
  ['D5 删重试（回执说没生效也不保留待发）', 'rec.want = !d.ok;', 'rec.want = false;', 'B3d'],
  ['D6 删挂载触发点（`frame.onload` 里那次调用去掉）', 'try { mpwScenePropsAfterMount(frame, true); } catch {}\n', '', 'A3'],
  ['D7 删"回执没生效 ⇒ 排重试"（未生效就再没人补发）', 'if (!d.ok) mpwScenePropsRetryLater(f);', '', 'B4'],
]
for (const [name, from, to, expect] of MUTS) {
  /* 锚点必须**唯一**：同一个函数体里还有别的通道（音频策略）有同形行 ⇒ 打在别处 = 判据假绿（实测踩过）。 */
  const occ = SRC_REAL.split(from).length - 1
  pass += occ === 1 ? 1 : 0; if (occ !== 1) fail++
  console.log('  ' + (occ === 1 ? '✓' : '✗') + ' ' + name + ' —— 变异锚点唯一（命中 ' + occ + ' 处）')
  const mutated = occ === 1 ? SRC_REAL.replace(from, to) : null
  const hit = !!mutated
  pass += hit ? 1 : 0; if (!hit) fail++
  console.log('  ' + (hit ? '✓' : '✗') + ' ' + name + ' —— 变异锚点命中')
  const res = hit ? runAll(mutated) : []
  const reds = res.filter((r) => !r.ok).map((r) => r.name.split(' ')[0])
  const isRed = hit && reds.length > 0
  pass += isRed ? 1 : 0; if (!isRed) fail++
  console.log('  ' + (isRed ? '✓' : '✗') + ' ' + name + ' ⇒ **必红**' + (isRed ? '（红在 ' + reds.slice(0, 6).join(',') + (reds.length > 6 ? '…' : '') + '）' : '（变异后判据仍全绿 ⇒ 判据没抓住它）'))
  // 期望的那条判据必须真的红（不只是"别处红了"）
  const targeted = hit && res.some((r) => !r.ok && r.name.startsWith(expect))
  pass += targeted ? 1 : 0; if (!targeted) fail++
  console.log('  ' + (targeted ? '✓' : '✗') + ' ' + name + ' ⇒ 期望的 `' + expect + '` 那条确实红')
}
// 真树 sha 不变（本判据只读 + 内存变异）
const crypto = await import('node:crypto')
const shaOf = (s) => crypto.createHash('sha256').update(s).digest('hex')
const unchanged = shaOf(fs.readFileSync(CLIENT, 'utf8')) === shaOf(SRC_REAL)
pass += unchanged ? 1 : 0; if (!unchanged) fail++
console.log('  ' + (unchanged ? '✓' : '✗') + ' 真树跑前跑后逐字相同（变异只在内存里）')

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 场景帧属性下发通过：setProp/挂载·重载/恢复默认三处接线 + 幂等·重发·重试 + legacy 回退口 + 如实记账（判据对八种变异有分辨力）')
process.exit(fail > 0 ? 1 : 0)

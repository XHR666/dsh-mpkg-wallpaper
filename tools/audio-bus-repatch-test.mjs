// audio-bus-repatch-test.mjs —— 「周期重压幂等化 + dispose 真的接上」的**源级/接线**门禁（2026-09-23）
//
// 为什么与 `tools/audio-bus-test.mjs` 分开：那边用桩跑**行为**；这里只读源码与生成产物，钉住三条
// 光靠行为测不出来的东西（真机上出问题时最容易被"改回去"的三处）：
//   A `lib/audio-bus.js` 的**周期路径**里不许出现节点操作 / 全文档扫描（句法级，不受桩能力影响）；
//   B `lib/client.js`（生成区 + 手写区）里 `dispose()` 与 800ms 轮询**真的接上了生命周期**；
//   C **变异自证**：把上面每条判据在内存副本里改回旧写法 ⇒ 同一判据必须变红（不是"永远绿"）。
// 运行：node tools/audio-bus-repatch-test.mjs   （全过退出码 0）
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const MOD = path.join(REPO, 'lib', 'audio-bus.js')
const CLIENT = path.join(REPO, 'lib', 'client.js')
const modSrc = fs.readFileSync(MOD, 'utf8')
const clientSrc = fs.readFileSync(CLIENT, 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ── 判据（每个都是纯函数：同一份判据既跑真源码、也跑变异副本 ⇒ 变异自证不是另写一遍） ────────────── */
/** 750ms 周期拍子的**整段**体（生成区与源共用同一行文本）。 */
const tickBody = (src) => {
  const m = /win\.setInterval\(\(\) => \{([\s\S]*?)\}, 750\)/.exec(src)
  return m ? m[1] : null
}
const NODE_OPS = ['querySelectorAll', 'installAudioBus(', 'connect(', 'disconnect(', 'createGain(', 'attachShadow(', 'suspend(', 'resume(']
/** A1 周期路径里没有节点操作 / 没有全文档扫描 / 走的是"周期"标记（帧集合没变就别重枚举）。 */
const checkTickPure = (src) => {
  const body = tickBody(src)
  if (body === null) return false
  if (NODE_OPS.some((k) => body.indexOf(k) >= 0)) return false
  return body.indexOf("periodic('750ms'") >= 0 && body.indexOf("applyMute('tick')") >= 0 && body.indexOf('syncFrames({ periodic: true })') >= 0
}
/** A2 收口只在"值真的不同"时写（`force` 例外：取消类自动化那一条必须强制补回）。 */
const checkCloseGate = (src) => src.indexOf("if (!force && cur === cur && cur === v) { did('close-bus', 'paramWritesSkipped'); continue }") >= 0
/** A3 元素压制是逐项**幂等**的（muted / volume / pause 三项各自比过再写）。 */
const checkSuppressGate = (src) => src.indexOf('if (el.muted !== true) { el.muted = true;') >= 0
  && src.indexOf('if (Number(el.volume) !== 0) { el.volume = 0;') >= 0
  && src.indexOf('if (typeof el.pause === "function" && !el.paused)'.replace(/"/g, "'")) >= 0
/** A4 `dispose()` 把五类钩子 + observer + 帧内总线全部收回（旧实现只清了定时器与两类钩子）。 */
const checkDisposeComplete = (src) => {
  const i = src.indexOf('    dispose() {')
  if (i < 0) return false
  const body = src.slice(i, src.indexOf('\n    },', i))
  return ['clearInterval(timer)', 'p.proto.connect = p.origConnect', 'rec.proto.disconnect = rec.orig',
    'rec.proto[rec.fn] = rec.orig', 'rec.proto.attachShadow = rec.orig', 'mo.disconnect()',
    "disposeFrameBus(rec, 'parent-dispose')"].every((k) => body.indexOf(k) >= 0)
}
/** 剥注释（静态判据只看**可执行代码**；块注释与行注释都去掉，`://` 不当行注释）。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
/** A5 全文档 `'*'` 选择器在可执行代码里只出现一次，且在安装期那一次扫描里。 */
const checkSingleStarScan = (src) => {
  const code = stripComments(src)
  if (code.split("'*'").length - 1 !== 2) return false                                  // 选择器 + postMessage 的 targetOrigin
  if (code.split("safeQuery(win.document, '*')").length - 1 !== 1) return false
  const j = src.indexOf("safeQuery(win.document, '*')")
  const start = src.lastIndexOf('const shadowScanOnce', j)
  return start >= 0 && j > start && src.slice(start, src.indexOf('\n  };', start)).indexOf('shadowScanned = true') >= 0
}
/** A6 本模块自己**从不**调用 suspend/resume（只装计数器看别人有没有调）。 */
const checkNeverSuspends = (src) => !/\.suspend\(|\.resume\(/.test(stripComments(src))
/** A7 「谁把静音抬回来」台账挂在既有 `gainAutomation` 下，有界且区分"有没有写者栈"。 */
const checkReclaims = (src) => src.indexOf('reclaims: {') >= 0 && src.indexOf('bySource[source]') >= 0
  && src.indexOf('traceable') >= 0 && src.indexOf('R.entries.length > 31') >= 0
/** B1 生成区：dispose 收掉 800ms 轮询与 storage 监听，并调模块 api 的 dispose。 */
const checkWiringDispose = (src) => src.indexOf('function mpwAudioBusDispose(why) {') >= 0
  && src.indexOf('clearInterval(mpwAudioBusTimer)') >= 0
  && src.indexOf('removeEventListener("storage", mpwAudioBusOnStorage)') >= 0
  && src.indexOf('if (api && typeof api.dispose === "function") api.dispose()') >= 0
/** B2 800ms 轮询的句柄必须保存（旧写法 `setInterval(...)` 句柄丢弃 ⇒ 永远清不掉）。 */
const checkTimerHandle = (src) => src.indexOf('mpwAudioBusTimer = setInterval(') >= 0 && src.indexOf('let mpwAudioBusTimer = 0') >= 0
/** B3 插件生命周期接线：`ctx.effect` 里装 + 卸载时 dispose。 */
const checkCtxEffect = (src) => src.indexOf('return () => { try { mpwAudioBusDispose("ctx-dispose") }') >= 0
/** B4 换壁纸/卸载帧时释放**帧内**那条总线。 */
const checkFrameDispose = (src) => /cw && cw\.__mpwAudioBus && typeof cw\.__mpwAudioBus\.dispose === "function"\) cw\.__mpwAudioBus\.dispose\(\)/.test(src)
/** B5 生成区里带着台账与抬回台账（探针在真机上要读得到）。 */
const checkLedgerInBundle = (src) => src.indexOf('window.__mpwAudioBusRepatch') >= 0 && src.indexOf('reclaims') >= 0 && src.indexOf('__mpwAudioBusDisposed') >= 0
/** B6 设置变更的事件驱动通路（storage）与轮询兜底都在。 */
const checkStorageWired = (src) => src.indexOf('addEventListener("storage", mpwAudioBusOnStorage)') >= 0
  && src.indexOf('function mpwAudioBusOnStorage() {') >= 0

console.log('== A lib/audio-bus.js：周期路径的句法级判据 ==')
ok('A1 750ms 周期拍子里**没有**节点创建/连接/断开、没有 suspend/resume、没有全文档扫描，且带"周期"标记',
  checkTickPure(modSrc), JSON.stringify({ tick: String(tickBody(modSrc)).trim().slice(0, 120) }))
ok('A2 收口只在"值真的不同"时写（`force` 例外留给取消类自动化）', checkCloseGate(modSrc))
ok('A3 元素压制逐项幂等（muted / volume / pause 各自比过再写）', checkSuppressGate(modSrc))
ok('A4 `dispose()` 收回：定时器 + connect/param/disconnect/ctxLife/attachShadow 钩子 + observer + 帧内总线',
  checkDisposeComplete(modSrc))
ok('A5 全文档 `querySelectorAll("*")` 全文件只出现**一次**，且只在安装期那一次扫描里', checkSingleStarScan(modSrc))
ok('A6 本模块自己从不调用 suspend/resume（只装计数器看别人有没有调）', checkNeverSuspends(modSrc))
ok('A7 「谁把静音抬回来」台账挂在既有 `gainAutomation.reclaims` 下：来源分类 + 节流栈 + 有界 ≤32',
  checkReclaims(modSrc))

console.log('\n== B lib/client.js：生成区与手写区的接线 ==')
ok('B1 生成区 dispose 收掉 800ms 轮询 + storage 监听，并调用模块 api 的 dispose', checkWiringDispose(clientSrc))
ok('B2 800ms 轮询句柄被保存（旧写法句柄丢弃 ⇒ 永远清不掉）', checkTimerHandle(clientSrc))
ok('B3 插件生命周期：`ctx.effect` 装载 + 卸载时 `mpwAudioBusDispose("ctx-dispose")`', checkCtxEffect(clientSrc))
ok('B4 换壁纸/卸载帧：`disposeWebFrame` 释放**帧内**那条总线', checkFrameDispose(clientSrc))
ok('B5 生成产物里带着 `__mpwAudioBusRepatch` / `reclaims` / `__mpwAudioBusDisposed` 三个读出口', checkLedgerInBundle(clientSrc))
ok('B6 设置变更的事件驱动通路（storage）与 800ms 轮询兜底都在', checkStorageWired(clientSrc))
ok('B7 生成区与源逐字一致（改源不重跑生成器 ⇒ 这里与 audio-bus-wiring-test A2 一起红）',
  clientSrc.indexOf(modSrc.replace(/^export /gm, '')) >= 0)

console.log('\n== C 变异自证：把每条判据改回旧写法 ⇒ 同一判据必须变红（内存副本，不动真树） ==')
{
  const mutate = (src, from, to) => {
    if (src.indexOf(from) < 0) throw new Error('变异锚点找不到：' + from.slice(0, 60))
    return src.replace(from, to)
  }
  const cases = [
    ['C1 周期拍子改回"每拍重枚举帧 + 重入 setMode"（旧写法） ⇒ A1 必红',
      () => checkTickPure(mutate(modSrc, "syncFrames({ periodic: true })", 'syncFrames()'))],
    ['C2 去掉"值同则不写"的守卫 ⇒ A2 必红',
      () => checkCloseGate(mutate(modSrc, 'if (!force && cur === cur && cur === v) { did(', 'if (false) { did('))],
    ['C3 元素压制改回无条件写 ⇒ A3 必红',
      () => checkSuppressGate(mutate(modSrc, 'if (el.muted !== true) { el.muted = true;', 'if (true) { el.muted = true;'))],
    ['C4 dispose 不再清定时器 ⇒ A4 必红',
      () => checkDisposeComplete(mutate(modSrc, 'disposed = true;\n      if (timer) { try { win.clearInterval(timer) } catch (e) {} ; timer = 0 }', 'disposed = true;\n      if (false && timer) { timer = 0 }'))],
    ['C5 全文档扫描回到每拍（`collectMedia` 里的旧写法） ⇒ A5 必红',
      () => checkSingleStarScan(mutate(modSrc, 'const collectMedia = (out) => {', "const collectMedia = (out) => { win.document.querySelectorAll('*');"))],
    ['C6 生成区 dispose 不再清 800ms 轮询 ⇒ B1 必红',
      () => checkWiringDispose(mutate(clientSrc, 'clearInterval(mpwAudioBusTimer)', 'void 0'))],
    ['C7 800ms 轮询句柄又丢掉（旧写法） ⇒ B2 必红',
      () => checkTimerHandle(mutate(clientSrc, 'mpwAudioBusTimer = setInterval(', 'setInterval('))],
    ['C8 拆掉 `ctx.effect` 的释放闭包 ⇒ B3 必红',
      () => checkCtxEffect(mutate(clientSrc, 'return () => { try { mpwAudioBusDispose("ctx-dispose") }', 'return () => {'))],
    ['C9 换壁纸不再释放帧内总线 ⇒ B4 必红',
      () => checkFrameDispose(mutate(clientSrc, 'cw.__mpwAudioBus.dispose()', 'void 0'))],
  ]
  for (const [name, run] of cases) ok(name, run() === false)
  ok('C10 变异只发生在内存副本里：两个真文件的 sha 与读入时一致',
    fs.readFileSync(MOD, 'utf8') === modSrc && fs.readFileSync(CLIENT, 'utf8') === clientSrc)
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 周期重压幂等化的源级/接线判据通过：周期路径无节点操作与全文档扫描 / 值同则不写 / 元素逐项幂等 / dispose 全清并接上插件与帧的生命周期 / 有分辨力')
process.exit(fail > 0 ? 1 : 0)

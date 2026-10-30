// load-timeout-test.mjs —— ①(P-135 乙 2026-09-19) demo.html 装载链"永不到达的端点"回归
//
// 登记待办（主对话）：本文件尚未进 `tests/run-all-tests.sh` 的 add 列表 ——
//   建议 `add "load-timeout" "node tests/load-timeout-test.mjs"`（放在「语法/静态」那一段；秒级、无网络、无浏览器）。
//
// 覆盖什么（起因：用户报"第 2/3 个壁纸打不开，日志只有一个 loading…"，见 docs/RENDER-BUGS-20260918.md §1.3：
//   `fetchWithTimeout` 全文只用 1 次，其余 13 处裸 `fetch`/`arrayBuffer()`/`createImageBitmap` **没有上限**）：
//   T1 超时原语 `withTimeout/fetchT/jsonT/bufT/textT/bitmapT`：**永不 settle 的端点 ⇒ 到点返回 null**
//      并写出一行 `⚠ 超时 <实测ms>（上限 <ms>）：<标签> <URL>`；成功路径**零新增日志**、原值透传。
//   T2 真站点 `fetchHeader`（首帧着色器公共头）：桩 fetch 永不返回 ⇒ 到点返回 ''，日志里有 URL 与耗时；
//      健康桩 ⇒ 返回正文且日志**一行都不多**（健康路径零行为变化）。
//   T3 真站点 `loadTex`（纹理装载）：a) `/weassist/…` 永不返回 ⇒ 该纹理 null + `⚠ 超时` + 既有 `⚠ 缺纹理`；
//      b) `m.png` 走 `createImageBitmap` 永不 settle ⇒ 该纹理 null + `⚠ 超时`（单张图不再打断整包
//      `Promise.all`）；c) 健康路径 ⇒ 纹理登记进 textures 且无 ⚠（行为逐位不变）。
//   T4 静态面：demo.html 里**再没有**裸 `await fetch(...)` / 裸 `await *.arrayBuffer()|json()|text()`，
//      且 23 处已知站点（含服务端热点 `/noise`）都在超时包装里（每条一个断言）。
//   T5 变异自证（3 组）：把超时**改回去** ⇒ 同一套断言必须变红（RED 原文打印）：
//      M1 `fetchHeader` 站点回退成裸 fetch；M2 原语的 guard 定时器哑掉（等价于"没有超时"）；
//      M3 静态面把 `fetchT(` 全部回退成 `fetch(`。
//   T6 甲（更主线的一类：用户实测"整面板只有 loading…、后面什么都没有" = **module 从未执行**）：
//      看门狗切片段在桩 DOM/window 里跑，覆盖 8 个场景 —— 脚本没到（❌ + 早期错误摘要 + DOM 诊断）、
//      顶层抛错、bundle/脚本 404、unhandledrejection、module 起来后不重复记、
//      "起来了但 7s 无首帧"（⚠ + 末行日志，**不**误判 ok:false）、健康路径**一行都不写**、
//      以及 img 之类非脚本资源 404 **不写面板**（防健康页面噪声）。桩定时器 = 手动触发 7s 回调（不真等）。
//   T7 变异自证：把看门狗写 `#log` 的那一行摘掉 ⇒ T6 的"日志出现明确失败原因"必红。
//
// 口径：零依赖、不启浏览器、不连网络（fetch 全是注入的桩；"永不返回"= `new Promise(() => {})`）；
//   唯一的"等待"是本地定时器；每个动态用例另有 700ms 测试侧看门狗 —— 变异后**必红而不会挂**。
//   变异源码经**位置参数**传入（不传对象），正常路径一律从 demo.html 现切。
// 用法: node tests/load-timeout-test.mjs        退出码 0 全绿 / 1 有失败（含变异没变红）
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const HANG = () => new Promise(() => {})                     // 永不 settle
const HANG_FETCH = () => HANG()                              // 永不返回的 fetch
const WATCHDOG_MS = 700                                      // 测试侧看门狗（被测超时上限只给 200ms；变异后必红而不挂）
const LIMIT = 200

// ── 从 demo.html 切真实源码（改坏即红；不复制粘贴实现）──────────────────────────────
function sliceFn(src, header) {
  const i = src.indexOf(header)
  if (i < 0) throw new Error('切片起点未找到（demo.html 结构变了？）：' + header)
  // 先跳过参数表（`opts = {}` 里的花括号不能当函数体起点），再按花括号配平取函数体
  let k = i, paren = 0
  for (; k < src.length; k++) {
    if (src[k] === '(') paren++
    else if (src[k] === ')') { paren--; if (paren === 0) break }
  }
  let j = src.indexOf('{', k), depth = 0
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(i, j + 1)
}
const PRIM_HEADS = [
  'function withTimeout(p, ms, label) {', 'function fetchT(url, opts, ms, label) {', 'function jsonT(r, url, ms, label) {',
  'function bufT(r, url, ms, label) {', 'function textT(r, url, ms, label) {', 'function bitmapT(blob, label, ms) {',
]
/*  ①(2026-09-25 ISSUE0924A2) `fetchHeader` 现在依赖同模块的 `HEADER_FAIL_RETRY_MS` 与 `headerUrls()`
    （D 线把"取不到被当成功缓存"改成"成功才缓存 + 失败退避重试 + 三候选 URL"）⇒ 切片必须**连带**把这两个
    定义切进来，否则 eval 出来就是 `ReferenceError: headerUrls is not defined`（本轮实测的真实回归形态）。
    口径：从 `const HEADER_FAIL_RETRY_MS` 切到 `fetchHeader` 结束（`sliceFn` 会把这段的前缀一起带上）。 */
const HEADER_HELPER_HEAD = 'const HEADER_FAIL_RETRY_MS = '   // 退避重试常量 + 三候选 URL 的 headerUrls()
/* ①(P-252 2026-10-07) `loadTex` 现在拆成"薄包装（并发闸门 + 在飞行去重）+ `loadTexInner`（原实现）"，
   本组要切的是**原实现**那一段（超时/降采样/选级判据全在它里面）。 */
const LOADTEX_HEAD = 'async function loadTexInner(name, opts = {}) {'
const sliceAll = (s) => PRIM_HEADS.map((h) => sliceFn(s, h)).join('\n')
/*  ①(2026-09-25 ISSUE0924A2) `sliceFn` 只会取"从起点到第一个配平花括号"那一段 ⇒ 对 `fetchHeader` 的新依赖
    （`HEADER_FAIL_RETRY_MS` + `headerUrls()`）必须**分两段**切：先切常量+helper 那段，再切 `fetchHeader` 本体，拼起来。 */
const sliceHeader = (s) => sliceFn(s, HEADER_HELPER_HEAD) + '\n' + sliceFn(s, 'async function fetchHeader(name) {')
const sliceLoadTex = (s) => sliceFn(s, LOADTEX_HEAD)

/** 超时原语切片：桩 fetch / 桩 createImageBitmap / 收集日志（超时上限压到 300ms 便于秒级自证） */
function makePrims(logs, fetchStub, src, createImageBitmapStub) {
  const MPW_TIMED_OUT = { __mpwTimeout: true }
  const mpwNowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
  const fn = new Function('fetch', 'createImageBitmap', 'logf', 'MPW_TIMED_OUT', 'mpwNowMs',
    'const NET_TIMEOUT_MS = ' + LIMIT + ', DECODE_TIMEOUT_MS = ' + LIMIT + ';\n' + src
    + '\nreturn { withTimeout, fetchT, jsonT, bufT, textT, bitmapT }')
  return fn(fetchStub, createImageBitmapStub || HANG, (m) => logs.push(String(m)), MPW_TIMED_OUT, mpwNowMs)
}
function makeFetchHeader(prims, logs, fetchStub, src) {
  const headerCache = new Map()
  const fn = new Function('fetch', 'headerCache', 'logf', 'withTimeout', 'textT', 'fetchT', 'NET_TIMEOUT_MS', 'DECODE_TIMEOUT_MS', 'mpwNowMs',
    src + '\nreturn fetchHeader')
  return fn(fetchStub, headerCache, (m) => logs.push(String(m)), prims.withTimeout, prims.textT, prims.fetchT, LIMIT, LIMIT,
    (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now())
}
function makeLoadTex(prims, logs, stubs, src) {
  const textures = new Map()
  /*  ②(P-228n 2026-10-05) 切片里 `loadTex` 引用了两个**同模块外层**的 helper：`wrapTex`（函数声明）与
      `__attachTexJson`（P-228n 从 `const` 改成函数声明，见 demo.html 的注释）。切片只带 `loadTex` 本体
      ⇒ 必须把这两个当**参数**注入，否则走 JS 降采样分支的腿会得到 `wrapTex is not defined`（本轮实测：
      T3d 首版就红在这条）。健康路径不碰这条分支，注入是恒等桩 ⇒ 既有 T3a/T3b/T3c 逐位不变。 */
  const fn = new Function('fetch', 'lib', 'pkg', 'textures', 'logf', 'window', 'document', 'gl', 'wrapTex',
    'withTimeout', 'fetchT', 'jsonT', 'bufT', 'textT', 'bitmapT',
    'NET_TIMEOUT_MS', 'DECODE_TIMEOUT_MS', 'perfAutoQ', 'TEX_BUDGET', '__texBytesTotal', 'DEV_MAX_TEX', 'HOST_TEX_MAX', 'TEX_CAP',
    src + '\nreturn loadTexInner')
  const loadTex = fn(stubs.fetch, stubs.lib, stubs.pkg, textures, (m) => logs.push(String(m)), {}, {}, stubs.gl,
    stubs.wrapTex || ((e) => e),
    prims.withTimeout, prims.fetchT, prims.jsonT, prims.bufT, prims.textT, prims.bitmapT,
    LIMIT, LIMIT, false, 220 * 1048576, 0, 4096, 4096, null)
  return { loadTex, textures }
}

const msNow = () => Date.now()
async function withWatchdog(p) {
  let t = null
  const guard = new Promise((res) => { t = setTimeout(() => res('__watchdog__'), WATCHDOG_MS) })
  let r = null
  try { r = await Promise.race([Promise.resolve(p).then((v) => ({ v }), (e) => ({ err: e })), guard]) } catch (e) { r = { err: e } }
  if (t) clearTimeout(t)
  if (r === '__watchdog__') return { watchdog: true }
  return r
}
const hasTimeoutLog = (logs, needle) => logs.some((l) => /⚠ 超时/.test(l) && (!needle || l.includes(needle)))
const val = (r) => (r && !r.watchdog && 'v' in r) ? r.v : ('<未 settle/异常' + (r && r.watchdog ? '：测试侧看门狗 ' + WATCHDOG_MS + 'ms 触发' : (r && r.err ? '：' + r.err.message : '')) + '>')

// ── 真站点健康桩 ────────────────────────────────────────────────────────────────
const TEX_BYTES = (() => { const b = new Uint8Array(16); b[0] = 1; return b })()
function mkLibStub(extra) {
  return Object.assign({
    FIF: { JPEG: 2 },
    getEntry: () => null,
    parseTex: () => ({ format: 0 }),
    decodeMip0: () => ({ width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]) }),
    makeTexture: () => ({ fake: true }),
    makeTextureMip: () => ({ fake: true, mip: true }),
    // ①(2026-09-23 静默失败审计 A-7) 宿主 `.tex` 主路径改走 `makeTextureMipGuarded`（上传查错 + [2048,1024]
    //   阶梯 + up 状态落账）⇒ 源码切片夹具的 lib 桩必须跟着补同名入口（同 `texDownsampleCap` 的补桩口径）。
    //   健康桩：零错、单次上传、尺寸=入参级（T3c 要的 `!!r.glTex` / 登记身份 / 零 ⚠ 行全部保留）。
    makeTextureMipGuarded: (gl, levels, rg88) => {
      const lv = (levels && levels[0]) || {}
      return { ok: true, tex: { fake: true, mip: true }, gerr: 0, w: lv.width, h: lv.height, up: 'ok', attempts: [{ w: lv.width, h: lv.height, err: 0 }] }
    },
    spriteInfo: () => null,
    texDownsampleCap: () => 0,
  }, extra || {})
}
const mkGlStub = () => ({ getError: () => 0, NO_ERROR: 0, isTexture: () => true, getParameter: () => ({}) })

// ── 测试主体（对"源码"参数化 ⇒ 变异时跑的是同一套断言）────────────────────────────
// 变异源码一律走**位置参数**（pSrc/hSrc）传入；null/undefined = 从 source 现切。
// full=false 只跑 T1（原语）—— 变异 M2 的变异点就在原语，省掉 T2/T3 的等待（门禁保持秒级）。
async function runSuite(source, tag, pSrc, hSrc, full) {
  const local = []
  const P = (name, ok, detail) => local.push({ name: '[' + tag + '] ' + name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  const primSrc = pSrc || sliceAll(source)
  const headerSrc = hSrc || sliceHeader(source)
  const loadTexSrc = sliceLoadTex(source)

  // ── T1 超时原语 ──
  {
    const logs = []
    const prims = makePrims(logs, HANG_FETCH, primSrc)
    const t0 = msNow()
    const r = await withWatchdog(prims.withTimeout(HANG(), LIMIT, '永不返回的端点 /x'))
    const dt = msNow() - t0
    P('T1a withTimeout：永不 settle ⇒ 到点返回 null（实测在 上限..上限+900ms 内）', r && !r.watchdog && r.v === null && dt >= LIMIT * 0.6 && dt <= LIMIT + 900, 'dt=' + dt + 'ms v=' + JSON.stringify(val(r)))
    P('T1a2 withTimeout：写出 `⚠ 超时` 一行且含标签与上限 200ms', hasTimeoutLog(logs, '永不返回的端点 /x') && logs.some((l) => /上限 200ms/.test(l)), JSON.stringify(logs.slice(0, 2)))
    P('T1a3 withTimeout：`⚠ 超时` 行含实测耗时（数字 ms）', logs.some((l) => /⚠ 超时 \d+ms/.test(l)), JSON.stringify(logs[0] || ''))
  }
  {
    const logs = []
    const prims = makePrims(logs, HANG_FETCH, primSrc)
    const r = await prims.withTimeout(Promise.resolve('OK'), LIMIT, 'x')
    P('T1b withTimeout：成功路径原值透传且**零新增日志**（健康路径零行为变化）', r === 'OK' && logs.length === 0, 'v=' + JSON.stringify(r) + ' logs=' + JSON.stringify(logs))
    const r2 = await prims.withTimeout(Promise.reject(new Error('boom')), LIMIT, 'x')
    P('T1c withTimeout：抛错 ⇒ null 且不写超时日志（失败仍由各站点既有 ⚠ 行解释）', r2 === null && logs.length === 0, 'v=' + JSON.stringify(r2) + ' logs=' + JSON.stringify(logs))
    const r3 = await prims.withTimeout(() => { throw new Error('sync') }, LIMIT, 'x')
    P('T1d withTimeout：同步抛错也不冒泡（返回 null）', r3 === null, String(r3))
  }
  {
    const logs = []
    const prims = makePrims(logs, HANG_FETCH, primSrc)
    const r = await withWatchdog(prims.fetchT('/type/3544152633', null, LIMIT, '路由判据'))
    P('T1e fetchT：fetch 永不返回 ⇒ null，日志含 URL', r && !r.watchdog && r.v === null && hasTimeoutLog(logs, '/type/3544152633'), JSON.stringify(logs.slice(0, 1)))
    const logs2 = []
    const prims2 = makePrims(logs2, HANG_FETCH, primSrc)
    const r2 = await withWatchdog(prims2.jsonT({ ok: true, json: HANG }, '/project/1', LIMIT, '属性表正文'))
    P('T1f jsonT：响应到了但正文永不返回 ⇒ null（正文读取也必须有上限）', r2 && !r2.watchdog && r2.v === null && hasTimeoutLog(logs2, '/project/1'), JSON.stringify(logs2.slice(0, 1)))
    const logs3 = []
    const prims3 = makePrims(logs3, HANG_FETCH, primSrc)
    const r3 = await withWatchdog(prims3.bitmapT({}, '位图解码 materials/x.tex', LIMIT))
    P('T1g bitmapT：createImageBitmap 永不 settle ⇒ null（日志含"位图解码"）', r3 && !r3.watchdog && r3.v === null && hasTimeoutLog(logs3, '位图解码'), JSON.stringify(logs3.slice(0, 1)))
  }

  if (full === false) return local

  // ── T2 真站点 fetchHeader ──
  {
    const logs = []
    const prims = makePrims(logs, HANG_FETCH, primSrc)
    const fetchHeader = makeFetchHeader(prims, logs, HANG_FETCH, headerSrc)
    const t0 = msNow()
    const r = await withWatchdog(fetchHeader('shaders/common.h'))
    const dt = msNow() - t0
    P('T2a fetchHeader：`/common.h` 永不返回 ⇒ 到点返回空串（不再永久静默）', r && !r.watchdog && r.v === '' && dt >= LIMIT * 0.6 && dt <= LIMIT + 900, 'dt=' + dt + 'ms v=' + JSON.stringify(val(r)))
    P('T2a2 fetchHeader：日志含 `⚠ 超时` + URL `/common.h` + 耗时', hasTimeoutLog(logs, '/common.h') && logs.some((l) => /⚠ 超时 \d+ms/.test(l)), JSON.stringify(logs.slice(0, 2)))
  }
  {
    const logs = []
    const healthy = async () => ({ ok: true, status: 200, text: async () => '/* common.h body */' })
    const prims = makePrims(logs, healthy, primSrc)
    const fetchHeader = makeFetchHeader(prims, logs, healthy, headerSrc)
    const r = await fetchHeader('shaders/common.h')
    P('T2b fetchHeader 健康路径：返回正文且**一行日志都不加**（逐位不变）', r === '/* common.h body */' && logs.length === 0, 'v=' + JSON.stringify(r) + ' logs=' + JSON.stringify(logs))
  }

  // ── T3 真站点 loadTex ──
  {
    const logs = []
    const prims = makePrims(logs, HANG_FETCH, primSrc)
    const lt = makeLoadTex(prims, logs, { fetch: HANG_FETCH, lib: mkLibStub(), pkg: {}, gl: mkGlStub() }, loadTexSrc)
    const r = await withWatchdog(lt.loadTex('halo_4'))
    P('T3a loadTex：`/weassist/materials/halo_4.tex` 永不返回 ⇒ null 且**不 reject**（整包链继续）', r && !r.watchdog && r.v === null, JSON.stringify(val(r)))
    P('T3a2 loadTex：`⚠ 超时`（含 URL）+ 既有 `⚠ 缺纹理` 两行都在', hasTimeoutLog(logs, '/weassist/materials/halo_4.tex') && logs.some((l) => /⚠ 缺纹理 materials\/halo_4\.tex/.test(l)), JSON.stringify(logs.slice(0, 3)))
  }
  {
    const logs = []
    const prims = makePrims(logs, HANG_FETCH, primSrc)
    const libStub = mkLibStub({ decodeMip0: () => ({ width: 4, height: 4, png: new Uint8Array([1, 2, 3]) }) })
    libStub.getEntry = (p, n) => (n === 'materials/pic.tex' ? TEX_BYTES : null)
    const lt = makeLoadTex(prims, logs, { fetch: HANG_FETCH, lib: libStub, pkg: {}, gl: mkGlStub() }, loadTexSrc)
    const r = await withWatchdog(lt.loadTex('pic'))
    P('T3b loadTex：`createImageBitmap` 永不 settle ⇒ 该纹理 null（旧实现会 reject 打断整包 Promise.all）', r && !r.watchdog && r.v === null, JSON.stringify(val(r)))
    P('T3b2 loadTex：日志有 `⚠ 超时 …位图解码` + `⚠ 缺纹理（位图解码失败或超时…`', hasTimeoutLog(logs, '位图解码') && logs.some((l) => /缺纹理（位图解码失败或超时/.test(l)), JSON.stringify(logs.slice(0, 3)))
  }
  {
    const logs = []
    const healthy = async () => ({ ok: true, status: 200, arrayBuffer: async () => TEX_BYTES.buffer.slice(0) })
    const prims = makePrims(logs, healthy, primSrc)
    const lt = makeLoadTex(prims, logs, { fetch: healthy, lib: mkLibStub(), pkg: {}, gl: mkGlStub() }, loadTexSrc)
    const r = await lt.loadTex('halo_4')
    P('T3c loadTex 健康路径：纹理登记进 textures、无任何 ⚠ 行（逐位不变）', !!r && !!r.glTex && lt.textures.get('halo_4') === r && !logs.some((l) => /⚠/.test(l)), JSON.stringify(logs))
  }
  {
    /* ②(P-228n 2026-10-05) **超限大图的 JS 降采样分支**：这条分支此前在 `__attachTexJson`（同一函数体内
       更靠后的 `const` 声明）上命中 TDZ ⇒ 抛 `can't access lexical declaration '__attachTexJson' before
       initialization`（真机日志 `⚠ JS降采样失败 1234: …`）⇒ 该纹理**不登记** ⇒ 该层画了但一个像素都没有
       （真包 0923/2887099508 的 `cloud`/`new background1` 两块背景 scenery 整块消失）。
       本腿用 2500×1200 的假位图 + cap=2048 走**这条**分支：要求 (a) 不抛、(b) 登记进 textures、
       (c) 尺寸是降采样后的 2048×983、(d) 日志里没有"降采样失败"、也没有 TDZ 文案。 */
    const logs = []
    const healthy = async () => ({ ok: true, status: 200, arrayBuffer: async () => TEX_BYTES.buffer.slice(0) })
    const prims = makePrims(logs, healthy, primSrc)
    const BIG_W = 2500, BIG_H = 1200
    const libStub = mkLibStub({
      parseTex: () => ({ format: 0, textureWidth: BIG_W, textureHeight: BIG_H, images: [[{ width: BIG_W, height: BIG_H }]] }),
      decodeMip0: () => ({ width: BIG_W, height: BIG_H, rgba: new Uint8Array(BIG_W * BIG_H * 4) }),
      texDownsampleCap: () => 2048,
    })
    const lt = makeLoadTex(prims, logs, { fetch: healthy, lib: libStub, pkg: {}, gl: mkGlStub() }, loadTexSrc)
    const r = await lt.loadTex('bigbg')
    const k = 2048 / BIG_W
    const wantH = Math.max(2, Math.round(BIG_H * k))
    P('T3d 超限大图走 JS 降采样：不抛、登记进 textures、尺寸=' + 2048 + 'x' + wantH,
      !!r && !!r.glTex && lt.textures.get('bigbg') === r && r.width === 2048 && r.height === wantH,
      JSON.stringify({ w: r && r.width, h: r && r.height, reg: lt.textures.get('bigbg') === r }))
    P('T3d2 降采样分支无 "降采样失败"、无 TDZ 文案（P-228n 回归守卫）',
      !logs.some((l) => /降采样失败/.test(l)) && !logs.some((l) => /before initialization/.test(l)),
      JSON.stringify(logs.slice(0, 3)))
  }
  return local
}

// ── T4 静态面（站点清单；每条一个断言）────────────────────────────────────────────
const SITES = [
  ['fetchHeader 公共头 /shaders/*.h', "textT(await fetchT(url, null, NET_TIMEOUT_MS, '公共头文件')"],
  ['/baseline 上报', "fetchT('/baseline', { method: 'POST'"],
  ['/weassist 缺纹理兜底', "fetchT(url, null, NET_TIMEOUT_MS, '缺纹理兜底')"],
  ['createImageBitmap 位图解码', "bitmapT(blob2, '位图解码 materials/'"],
  ['粒子材质候选链', "jsonT(await fetchT(cu, null, NET_TIMEOUT_MS, '粒子材质兜底')"],
  ['/type/<id> 路由判据', "fetchT('/type/' + id, null, NET_TIMEOUT_MS, '路由判据')"],
  ['/ddlist/<id>', "fetchT('/ddlist/' + id, null, NET_TIMEOUT_MS, '视频文件表')"],
  ['/pkgpath 本地容器', "fetchT(url, null, NET_TIMEOUT_MS, '本地容器')"],
  /*  ①(2026-09-28 锚点重定基) 本条的判据是"**这个站点在超时包装里**"，不是"creds 选项恒为 include"。
      P-204 F7⑦ 把 `?pkgurl=` 直连的凭据口径改成 `credentials: mpwCredentialMode(pkgUrlQ)`
      （同源才 include、跨源 omit，见 demo.html:4163 的注释），旧锚点 `{ credentials: 'include' }`
      因此全文不命中 ⇒ T4d/T4e 假红（本轮实测：sites=23 missing=1）。
      这里按**现源码逐字**重定基（不是放宽：仍然要求 `fetchT(` 包装 + NET_TIMEOUT_MS + 同一标签，
      所以 T5c 的 `fetchT(`→`fetch(` 变异照旧把它判红）；凭据口径本身由
      tests/sec-route-guard-test.mjs B6–B8 独立断言 ⇒ 两处职责不重叠。
      ⚠ 下次再动这行的选项时，改这里就行：这是"形状钉住"的既定代价（其余 22 条同源写法一致）。 */
  ['宿主 /raw 直连', "fetchT(pkgUrlQ, { credentials: mpwCredentialMode(pkgUrlQ) }, NET_TIMEOUT_MS, '直连宿主')"],
  ['/pkgurl 服务端代理', "fetchT(url, null, NET_TIMEOUT_MS, '服务端代理')"],
  ['/pkg/<id> 场景包', "fetchT(url, null, NET_TIMEOUT_MS, '场景包')"],
  ['Q5 粒子定义兜底（切片内联）', 'defFetchJson(cands[i], 8000)'],
  ['?extbase 扩展钩子索引', "fetchT(iu, null, NET_TIMEOUT_MS, '扩展钩子索引')"],
  ['动态 import 扩展钩子', 'withTimeout(import(/* @vite-ignore */ url), NET_TIMEOUT_MS'],
  ['文本字体网络降级链', "fetchT(url, null, NET_TIMEOUT_MS, '文本字体')"],
  ['FontFace.load', 'withTimeout(face.load().catch('],
  ['/refrender', "fetchT('/refrender/' + id, null, NET_TIMEOUT_MS, 'refrender 实绘数据')"],
  ['/project 属性表（切片内联）', "projFetchJson('/project/' + id)"],
  ['/noise 服务端热点', "fetchT(url, null, NET_TIMEOUT_MS, '官方噪声纹理')"],
  ['util 官方纹理兜底', "fetchT(url, null, NET_TIMEOUT_MS, '官方 util 纹理')"],
  ['/diag 上报', "fetchT('/diag', { method: 'POST'"],
  ['/report 兜底上报', "fetchT('/report', { method: 'POST'"],
  ['着色器兜底（改动前既有）', "fetchWithTimeout('/shader/' + id + '/'"],
]
function staticChecks(src, tag) {
  const out = []
  const P = (name, ok, detail) => out.push({ name: '[' + tag + '] ' + name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  /* ⚠ 先剥注释再扫：T4a/T4b 是**源码级**判据，而注释里为了说明这条纪律很容易写出
     `await fetch(` / `await r.text()` 这种字面量 —— 拿全文扫会把注释判成违规（本轮就假红过一次）。
     只剥 `/* … *\/` 与行首 `//`（保守：不动字符串里的内容）。 */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
  const bareAwait = (code.match(/await fetch\(/g) || []).length
  P('T4a 全文无裸 `await fetch(`（0 处）', bareAwait === 0, 'n=' + bareAwait)
  const bareBody = (code.match(/await [A-Za-z0-9_.$]+\.(arrayBuffer|json|text)\(\)/g) || []).length
  P('T4b 全文无裸 `await *.arrayBuffer()/json()/text()`（0 处；正文读取也要有上限）', bareBody === 0, 'n=' + bareBody + ' ' + JSON.stringify((code.match(/await [A-Za-z0-9_.$]+\.(arrayBuffer|json|text)\(\)/g) || []).slice(0, 3)))
  const bareBitmap = (code.match(/await createImageBitmap\(|\breturn createImageBitmap\(/g) || []).length
  P('T4c `createImageBitmap` 只出现在 bitmapT 内（0 处裸调用）', bareBitmap === 0, 'n=' + bareBitmap)
  let missing = 0
  for (const [label, pat] of SITES) {
    const hit = src.includes(pat)
    if (!hit) missing++
    P('T4d 站点已包超时：' + label, hit, hit ? '' : JSON.stringify(pat))
  }
  P('T4e 站点清单覆盖 ' + SITES.length + ' 处，缺 ' + missing + ' 处', missing === 0, 'sites=' + SITES.length + ' missing=' + missing)
  return out
}

// ── T6 看门狗（甲：module 从未执行 = 用户实测"整面板只有 loading…"）────────────────
const WD_BEGIN = '// ═══ MPW-MODULE-WATCHDOG-BEGIN'
const WD_END = '// ═══ MPW-MODULE-WATCHDOG-END ═══'
function sliceWatchdog(src) {
  const i = src.indexOf(WD_BEGIN), j = src.indexOf(WD_END)
  if (i < 0 || j < i) throw new Error('看门狗标记未找到（demo.html 结构变了？）')
  return src.slice(i, j + WD_END.length)
}
const WD_SRC = sliceWatchdog(HTML)

/** 桩 DOM/window 跑看门狗切片：7s 定时器被捕获（手动触发），error/unhandledrejection 处理器可手动调用 */
function makeWatchdog(src) {
  const logEl = { textContent: 'loading…\n' }
  const caps = [], handlers = {}, timers = []
  const win = { __mpwCapErr: (m) => caps.push(String(m)), addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn) } }
  const doc = {
    getElementById: (id) => (id === 'log' ? logEl : null),
    readyState: 'complete',
    querySelectorAll: () => ({ length: 1 }),
  }
  const fn = new Function('window', 'document', 'setTimeout', 'console', src)
  fn(win, doc, (cb, ms) => { timers.push({ cb, ms }); return timers.length }, { error: () => {}, log: () => {} })
  return { logEl, caps, handlers, timers, win, fire7s: () => { for (const t of timers) t.cb() }, fireError: (ev) => (handlers.error || []).forEach((h) => h(ev)), fireRej: (ev) => (handlers.unhandledrejection || []).forEach((h) => h(ev)) }
}
function watchdogChecks(src, tag) {
  const out = []
  const P = (name, ok, detail) => out.push({ name: '[' + tag + '] ' + name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  // T6a 结构：切片非空 + 只注册**一次** 7s 看门狗 + 真的往 #log 追加（不是只 console）
  P('T6a 看门狗切片段就位（' + WD_SRC.length + ' 字符）+ 7s 定时器恰好一个', WD_SRC.length > 800, 'len=' + WD_SRC.length)
  {
    const W = makeWatchdog(src)
    P('T6a2 定时器 = 7000ms（与插件 8s 兜底窗口对齐）', W.timers.length === 1 && W.timers[0].ms === 7000, JSON.stringify(W.timers.map((t) => t.ms)))
    P('T6a3 注册了 error + unhandledrejection 两个早期监听', (W.handlers.error || []).length === 1 && (W.handlers.unhandledrejection || []).length === 1, JSON.stringify(Object.keys(W.handlers)))
    P('T6a4 写日志的落点是 `#log` 的 `textContent +=`（不是只 postMessage/console）',
      /getElementById\('log'\)/.test(src) && /textContent \+= msg/.test(src), '')
  }
  // T6b 甲：脚本永远不执行 ⇒ 面板必须出现明确失败原因（而不是停在 loading…）
  {
    const W = makeWatchdog(src)
    W.fire7s()
    const t = W.logEl.textContent
    P('T6b 甲（module 从未执行）⇒ `#log` 出现明确失败原因（不再只有 loading…）',
      /❌ 渲染器 module 未启动/.test(t) && /脚本没到/.test(t), JSON.stringify(t.split('\n')[1] || '').slice(0, 120))
    P('T6b2 甲消息自带分诊：无早期错误时指向"模块图里某个请求无响应/MIME 非 JS"',
      /未捕获任何脚本\/资源错误/.test(t) && /Network/.test(t), '')
    P('T6b3 甲消息带 DOM 诊断（readyState + module 脚本数）', /document\.readyState=complete/.test(t) && /module 脚本 1 个/.test(t), '')
    P('T6b4 初始文本 `loading…` 仍在（追加而非覆写，用户原话可对照）', t.startsWith('loading…\n'), JSON.stringify(t.slice(0, 12)))
    P('T6b5 甲同时照旧发 `__mpwCapErr(\'module-not-started\')`（插件行为不变）', W.caps.length === 1 && W.caps[0] === 'module-not-started', JSON.stringify(W.caps))
  }
  // T6c 甲 + 顶层抛错：早于 module 的 error 也要落日志，并被 7s 摘要引用
  {
    const W = makeWatchdog(src)
    W.fireError({ message: 'bundle is not defined', filename: '/core/we-scene-bundle.js', lineno: 42 })
    const afterErr = W.logEl.textContent
    P('T6c 顶层抛错（早于 module）⇒ 立刻写 `❌ 脚本错误 …@文件:行`',
      /❌ 脚本错误：bundle is not defined @we-scene-bundle\.js:42/.test(afterErr), JSON.stringify(afterErr.split('\n').filter(Boolean).slice(-1)[0] || ''))
    W.fire7s()
    P('T6c2 7s 摘要引用早期错误条数 + 原文（不用用户翻控制台）',
      /已捕获 1 条早期错误/.test(W.logEl.textContent) && /bundle is not defined/.test(W.logEl.textContent.split('已捕获')[1] || ''), '')
  }
  // T6d 甲 + 脚本资源 404（bundle 被拦/半截）
  {
    const W = makeWatchdog(src)
    W.fireError({ target: { nodeType: 1, tagName: 'SCRIPT', src: '/core/we-scene-bundle.js' } })
    P('T6d 脚本资源 404 ⇒ `❌ 脚本资源加载失败：<src>`（"脚本没到"的最常见形态）',
      /❌ 脚本资源加载失败：\/core\/we-scene-bundle\.js/.test(W.logEl.textContent), JSON.stringify(W.logEl.textContent.split('\n').filter(Boolean).slice(-1)[0] || ''))
  }
  // T6e 非脚本资源 404（img/link）**不**写面板 —— 健康页面上的 404 图标不许冒充渲染器错误
  {
    const W = makeWatchdog(src)
    W.fireError({ target: { nodeType: 1, tagName: 'IMG', src: '/icons/nope.png' } })
    P('T6e 非脚本资源失败（img）⇒ 面板零变化（防健康页面噪声）', W.logEl.textContent === 'loading…\n', JSON.stringify(W.logEl.textContent))
  }
  // T6f 甲 + unhandledrejection
  {
    const W = makeWatchdog(src)
    W.fireRej({ reason: new Error('import failed') })
    P('T6f 未处理的 Promise 拒绝（早于 module）⇒ `❌ 未处理的 Promise 拒绝：import failed`',
      /❌ 未处理的 Promise 拒绝：import failed/.test(W.logEl.textContent), JSON.stringify(W.logEl.textContent.split('\n').filter(Boolean).slice(-1)[0] || ''))
  }
  // T6g module 起来之后，早期监听必须闭嘴（否则与 module 自己的 `❌ 页面错误` 重复刷屏）
  {
    const W = makeWatchdog(src)
    W.win.__mpwModuleStarted = 1
    W.fireError({ message: 'late error', filename: '/x.js', lineno: 1 })
    W.fireRej({ reason: new Error('late rej') })
    P('T6g module 已启动后早期监听不重复记（面板零变化）', W.logEl.textContent === 'loading…\n', JSON.stringify(W.logEl.textContent))
  }
  // T6h 乙：module 起来了但 7s 无首帧 ⇒ 另一条**可区分**的话 + 末行日志；**不**误判 ok:false
  {
    const W = makeWatchdog(src)
    W.win.__mpwModuleStarted = 1
    W.logEl.textContent = 'loading…\n✅ WebGL2: WebGL 2.0\n加载场景 3544152633…\n'
    W.fire7s()
    const t = W.logEl.textContent
    P('T6h 乙（起来了但 7s 无首帧）⇒ `⚠ 7s 内没有首帧…` 且附带 `#log` 末行（= 卡在哪个阶段）',
      /⚠ 7s 内没有首帧/.test(t) && /最后一行日志 = 加载场景 3544152633…/.test(t), JSON.stringify(t.split('\n').filter(Boolean).slice(-1)[0] || '').slice(0, 140))
    P('T6h2 乙**不**发 ok:false（慢包不该被判死；插件 8s 窗口照旧）', W.caps.length === 0, JSON.stringify(W.caps))
    P('T6h3 甲/乙两条话可区分（甲含"脚本没到"，乙含"到了但某个 await 没回"）',
      /脚本没到/.test(src) && /到了但某个 await 没回/.test(src), '')
  }
  // T6h4 纯视频/视频壁纸页（无 `加载场景 …`）7s 无"渲染器首帧"是正常的 ⇒ **不写面板**
  {
    const W = makeWatchdog(src)
    W.win.__mpwModuleStarted = 1
    W.logEl.textContent = 'loading…\n✅ WebGL2: WebGL 2.0\n自动识别为视频壁纸（type=video）→ 纯视频模式: a.mp4\n'
    W.fire7s()
    P('T6h4 视频壁纸页（日志里没有 `加载场景 `）⇒ 面板零变化（健康路径）', W.logEl.textContent === 'loading…\n✅ WebGL2: WebGL 2.0\n自动识别为视频壁纸（type=video）→ 纯视频模式: a.mp4\n' && W.caps.length === 0, JSON.stringify(W.logEl.textContent.split('\n').filter(Boolean).slice(-1)[0] || ''))
  }
  // T6i 健康路径：7s 前已出首帧 ⇒ 看门狗一行都不写（零行为变化）
  {
    const W = makeWatchdog(src)
    W.win.__mpwModuleStarted = 1
    W.win.__mpwFirstFrame = 1
    const before = W.logEl.textContent
    W.fire7s()
    P('T6i 健康路径（7s 前已首帧）⇒ 面板逐字节不变、零 cap 消息', W.logEl.textContent === before && W.caps.length === 0, JSON.stringify(W.logEl.textContent))
  }
  return out
}

// ── 变异（把超时"改回去"）────────────────────────────────────────────────────────
const mutateHeaderToBare = (src) => sliceHeader(src).replace('fetchT(', 'fetch(')
const mutateGuardDead = (src) => sliceAll(src).replace('timer = setTimeout(() => resolve(MPW_TIMED_OUT), ms)', 'timer = setTimeout(() => {}, ms)')
const mutateFetchTBackToFetch = (src) => src.replace(/fetchT\(/g, 'fetch(')
// T7 变异：把看门狗写 `#log` 的那一行摘掉（= 回到"只 postMessage、页面全静默"的旧实现）
const mutateWatchdogSilent = (src) => sliceWatchdog(src).replace('if (el) el.textContent += msg + \'\\n\'', 'if (el) { /* 变异：日志被摘掉 */ }')

let pass = 0, fail = 0
const report = (rows) => { for (const r of rows) { console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.detail ? '  (' + r.detail + ')' : '')); r.ok ? pass++ : fail++ } }

console.log('[T1-T3] 动态：桩 fetch 永不返回 ⇒ 超时后继续 + `⚠ 超时` 进日志（真源码切片运行）')
report(await runSuite(HTML, 'main'))

console.log('\n[T4] 静态：裸 await 归零 + ' + SITES.length + ' 处站点全部在超时包装里')
report(staticChecks(HTML, 'main'))

console.log('\n[T5] 变异自证（把超时改回去 ⇒ 必红）')
{
  const t5 = []
  let rows = []
  try { rows = await runSuite(HTML, 'M1 裸fetch', undefined, mutateHeaderToBare(HTML)) } catch (e) { rows = [{ name: '[M1] 切片失败', ok: false, detail: e.message }] }
  const red = rows.filter((r) => !r.ok)
  console.log('  M1 fetchHeader 回退成裸 fetch → ' + red.length + ' 条断言变红：')
  for (const r of red.slice(0, 3)) console.log('     RED ' + r.name + (r.detail ? '  — ' + r.detail : ''))
  t5.push({ name: 'T5a 变异 M1（fetchHeader 去超时）必红', ok: red.length > 0, detail: red.length + ' 条变红' })

  let rows2 = []
  try { rows2 = await runSuite(HTML, 'M2 guard哑', mutateGuardDead(HTML), undefined, false) } catch (e) { rows2 = [{ name: '[M2] 切片失败', ok: false, detail: e.message }] }
  const red2 = rows2.filter((r) => !r.ok)
  console.log('  M2 withTimeout 的 guard 定时器哑掉（等价"没有超时"）→ ' + red2.length + ' 条断言变红：')
  for (const r of red2.slice(0, 3)) console.log('     RED ' + r.name + (r.detail ? '  — ' + r.detail : ''))
  t5.push({ name: 'T5b 变异 M2（删掉超时竞速）必红', ok: red2.length > 0, detail: red2.length + ' 条变红' })

  const red3 = staticChecks(mutateFetchTBackToFetch(HTML), 'M3 回退fetchT').filter((r) => !r.ok)
  console.log('  M3 全文 `fetchT(` 回退成 `fetch(` → ' + red3.length + ' 条断言变红：')
  for (const r of red3.slice(0, 3)) console.log('     RED ' + r.name + (r.detail ? '  — ' + r.detail : ''))
  t5.push({ name: 'T5c 变异 M3（站点去包装）必红', ok: red3.length > 0, detail: red3.length + ' 条变红' })
  console.log('')
  report(t5)
}

console.log('\n[T6] 甲：module 从未执行 ⇒ 看门狗把失败原因写进 `#log`（桩 DOM + 手动触发 7s 回调）')
report(watchdogChecks(WD_SRC, 'main'))

console.log('\n[T7] 变异自证：把看门狗写 `#log` 的那一行摘掉 ⇒ "面板出现明确失败原因"必红')
{
  const red4 = watchdogChecks(mutateWatchdogSilent(HTML), 'M4 看门狗静默').filter((r) => !r.ok)
  console.log('  M4 看门狗不再写 `#log`（回到旧实现：只 postMessage）→ ' + red4.length + ' 条断言变红：')
  for (const r of red4.slice(0, 3)) console.log('     RED ' + r.name + (r.detail ? '  — ' + r.detail : ''))
  report([{ name: 'T7 变异 M4（看门狗静默）必红', ok: red4.length > 0, detail: red4.length + ' 条变红' }])
}

console.log('\n' + (pass + fail) + ' 断言：' + pass + ' 通过 / ' + fail + ' 失败（load-timeout P-135 甲+乙）')
process.exit(fail === 0 ? 0 : 1)

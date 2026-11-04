// weassist-prefetch-test.mjs —— P-206：**宿主侧接线**（`demo.html` 的效果链 `/weassist` 预取 + 同步 reader 注册）
//
// 背景（P-205 只做完 core 侧）：`core/we-scene-bundle.js` 有三级候选链（① 包内 → ② `/weassist/<rel>` →
//   ③ `/weassist/<效果目录><rel>`）+ 宿主注入口 `setWeAssetReader(fn)`，但**页面从没注册过 reader**
//   （`lib.resolveEffectChain(pkg, ef, rd)` 三个实参）⇒ 线上仍是"包内优先 + 缺件记账"：3 个 `PKGM0014`
//   真包（砂狼白子11_03 / 佩丽卡1_03 / 陈千语_03）离线端到端已从 0 变成 22/37/25 个挂上的效果实例，
//   浏览器里还是 0。core 是纯模块（不 import node:fs、不该自己发 fetch）⇒ **取件是宿主的事**。
//
// 本文件（纯 Node：**不起浏览器、不解纹理**；真包里只做 `parseScene` + 效果链解析）四层判据：
//   S1 结构（demo.html 源码序 + 切片块原文）：块存在 · 注册调用在 · reader 是**同步**且 miss 返回 null ·
//      `?weassist=legacy` 回退门在 · URL 全同源（块内 0 个绝对/跨源地址）· 上限常量与台账在 ·
//      调用点在 `await loadScene()` **之前** · 效果链解析**对所有层**（不再嵌在 `layer.image` 分支里）。
//   S2 行为（合成资产 + 桩 fetch，**用真 core 的候选链函数**）：
//      ① 预取清单 = 与 core 逐级同序、命中即停（7 次请求的精确顺序）；
//      ② 命中后注册的 reader 能被 `lib.readWeAssetText` 命中第三级（`weassist-effect-subtree`）；
//      ③ miss ⇒ null（不问网络、不抛）；④ legacy ⇒ 0 请求 + 不注册；
//      ⑤ 有界：请求数/字节数/墙钟三档触顶都只记 `truncated`，**不抛**、已收的照用；
//      ⑥ 失败/超时不阻塞：桩 fetch 抛异常/返回 null 时函数照常 resolve。
//   S3 真语料（3 个 PKGM0014 真包 + 2 个**含包内效果**的真包；`/weassist` 桩 = 服务端同语义的磁盘读）：
//      ① 3 包读数与离线冻结值一致（实例 50/45/25 · 挂上 22/37/25 · pass 30/47/25 · material 来源全是第三级）；
//      ② 同一个包**不注册 reader** 时挂上数 = 0（证明"改前是 0"、判据真的钉在注册这一步）；
//      ③ 逐位不回归：含包内效果的真包链摘要 digest == `effect-json-fallback-test` 的冻结值（2 包），
//         且"预取+注册"与"完全不注册"两档 digest 逐字相同（包内优先）。
//   S4 变异自证：隔离的 demo.html 副本真改真跑本文件，期望红集**精确相等**（真树不动）。
//
// 用法:
//   node tests/weassist-prefetch-test.mjs                 # 全跑
//   node tests/weassist-prefetch-test.mjs --no-mutations   # 只跑 S1/S2/S3（变异子进程用）
//   MPW_DEMO_FILE=<另一个 demo.html> node ...              # 指向隔离副本（变异子进程用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'
import { DEFAULT_ASSETS } from './gen-particle-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const DEMO_FILE = process.env.MPW_DEMO_FILE || path.join(ROOT, 'demo.html')
const DEMO_SRC = fs.readFileSync(DEMO_FILE, 'utf8')
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
const WE_ASSETS = process.env.WE_ASSETS || DEFAULT_ASSETS
const CORPUS = path.join(process.env.MPW_ROOT || WS, 'allwallpaper')
const DEC = new TextDecoder()

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }
const lineOf = (src, needle) => { const i = src.indexOf(needle); return i < 0 ? -1 : src.slice(0, i).split('\n').length }

console.log('== P-206：demo.html 的效果链 /weassist 预取 + 同步 reader 注册 ==')
console.log('   demo=' + path.relative(ROOT, DEMO_FILE) + '  WE assets=' + WE_ASSETS + (exists(WE_ASSETS) ? '' : '（**不存在**）'))

/* ───────────────── 切片：只取 MPW-FX-PREFETCH 块（真源码，不复制） ───────────────── */
const BEGIN = '// ═══ MPW-FX-PREFETCH-BEGIN'
const END = '// ═══ MPW-FX-PREFETCH-END ═══'
function sliceBlock(src) {
  const i = src.indexOf(BEGIN), j = src.indexOf(END)
  if (i < 0 || j < i) return null
  return src.slice(i, j + END.length)
}
const BLOCK = sliceBlock(DEMO_SRC)

/** 造沙箱：把切出来的真块放进一个函数作用域，注入桩（fetch/时钟/globalThis），返回块内 API。 */
function makeSandbox(blockSrc, opts = {}) {
  const requests = [], logs = [], registrations = [], fakeGlobal = {}
  const clock = { t: 1000 }
  const fetchImpl = opts.fetchImpl || (() => null)
  const libWrap = {
    weAssetCandidates: (...a) => lib.weAssetCandidates(...a),
    effectAssetDirOf: (...a) => lib.effectAssetDirOf(...a),
    parseWeJson: (...a) => lib.parseWeJson(...a),
    // ③(2026-10-12) 内置效果表（S2-14/S2-15 的判据入口；真 core 的那份，不是桩）
    builtinEffectAsset: (...a) => lib.builtinEffectAsset(...a),
    setWeAssetReader: (fn) => { registrations.push(fn); return lib.setWeAssetReader(fn) },
  }
  const fetchT = async (url) => { requests.push(url); const r = await fetchImpl(url); return r === undefined ? null : r }
  const textT = async (r) => (r && r.ok && typeof r.text === 'string') ? r.text : null
  const body = blockSrc + '\n;return { prefetchWeEffectAssets, mpwWeassistLegacyFrom, mpwWeAssetReader, weAssistUrl,'
    + ' MPW_WEASSIST_LEGACY, FX_PREFETCH_MAX_REQ, FX_PREFETCH_MAX_BYTES, FX_PREFETCH_BUDGET_MS };'
  const f = new Function('lib', 'fetchT', 'textT', 'logf', 'mpwNowMs', 'location', 'globalThis', body)
  const api = f(libWrap, fetchT, textT, (m) => logs.push(String(m)), () => (clock.t += 5),
    { search: opts.search === undefined ? '' : opts.search }, fakeGlobal)
  return { api, requests, logs, registrations, fakeGlobal, libWrap }
}

/** `/weassist/<rel>` 的**服务端同语义**桩：decodeURIComponent → 前缀校验 → 读磁盘（= 路由 `/weassist/(.+)`）。 */
function diskWeAssistFetch(url, assets = WE_ASSETS) {
  const m = /^\/weassist\/(.+)$/.exec(String(url))
  if (!m) return { ok: false, status: 404 }
  let rel = null
  try { rel = decodeURIComponent(m[1]) } catch (e) { return { ok: false, status: 400 } }
  rel = String(rel).replace(/^\.+\//, '')
  const base = path.resolve(assets)
  const full = path.resolve(base, rel)
  if (full !== base && !full.startsWith(base + path.sep)) return { ok: false, status: 403 }
  try {
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return { ok: false, status: 404 }
    return { ok: true, text: fs.readFileSync(full, 'utf8') }
  } catch (e) { return { ok: false, status: 404 } }
}

/* ───────────────── S1：结构（源码序） ───────────────── */
console.log('-- S1 结构')
check('S1-1 预取块存在且可切（MPW-FX-PREFETCH-BEGIN/END）', !!BLOCK && BLOCK.length > 2000,
  BLOCK ? ('demo.html:' + lineOf(DEMO_SRC, BEGIN) + ' 起，' + BLOCK.length + ' 字节') : '锚点缺失')
if (!BLOCK) { console.log('\n✗ FAIL —— 没有块，后续判据无法驱动'); process.exit(1) }
const readCallLine = lineOf(DEMO_SRC, 'lib.setWeAssetReader(mpwWeAssetReader)')
const callLine = lineOf(DEMO_SRC, 'await prefetchWeEffectAssets(scene, {')
const loadLine = lineOf(DEMO_SRC, 'await loadScene();')
const resolveLine = lineOf(DEMO_SRC, 'lib.resolveEffectChain(pkg, ef, rd, {')
const imgGuardLine = lineOf(DEMO_SRC, '    if (!layer.image) return;')
check('S1-2 注册调用的**唯一**出处（`lib.setWeAssetReader(mpwWeAssetReader)`）在块内且恰一处',
  readCallLine > 0 && (DEMO_SRC.match(/lib\.setWeAssetReader\(mpwWeAssetReader\)/g) || []).length === 1,
  'demo.html:' + readCallLine)
check('S1-3 reader 是**同步**的（函数体里没有 await/fetch/Promise），miss 返回 null',
  (() => {
    const i = BLOCK.indexOf('function mpwWeAssetReader(')
    if (i < 0) return false
    const body = BLOCK.slice(i, BLOCK.indexOf('\n}', i))
    return !/await|fetchT|Promise/.test(body) && /\(v === undefined \|\| v === null\) \? null : v/.test(body)
  })())
check('S1-4 `?weassist=legacy` 回退门在（纯函数解析 + 早退 `return led` + 旗标登记正则）',
  /function mpwWeassistLegacyFrom\(search\)/.test(BLOCK) && /if \(MPW_WEASSIST_LEGACY\) \{[\s\S]{0,200}?return led/.test(BLOCK)
  && DEMO_SRC.includes('const MPW_WEASSIST_FLAGS = [/[?&]weassist=/]'))
check('S1-5 URL **全同源**：块内 0 个绝对/跨源地址，URL 由 `weAssistUrl` 拼相对 `/weassist/`',
  !/https?:\/\//.test(BLOCK) && BLOCK.includes("return '/weassist/' + clean.split('/').map((s) => encodeURIComponent(s)).join('/')"))
check('S1-6 有界四档常量 + 三处触顶检查 + 台账发布都在（请求数/字节/单请求超时/整段预算/并发）',
  ['FX_PREFETCH_MAX_REQ = 600', 'FX_PREFETCH_MAX_BYTES = 6 << 20', 'FX_PREFETCH_TIMEOUT_MS = 3000',
    'FX_PREFETCH_BUDGET_MS = 10000', 'FX_PREFETCH_CONC = 8'].every((s) => BLOCK.includes(s))
  && BLOCK.includes('led.requests >= FX_PREFETCH_MAX_REQ') && BLOCK.includes('led.bytes >= FX_PREFETCH_MAX_BYTES')
  && BLOCK.includes('mpwNowMs() - led.t0 > FX_PREFETCH_BUDGET_MS')
  && BLOCK.includes('globalThis.__mpwFxPrefetch = led') && BLOCK.includes('limits: {'))
check('S1-7 三级清单都在（效果定义 → material → shader frag/vert），且都走 `lib.weAssetCandidates`',
  BLOCK.includes('lib.weAssetCandidates(rel, effectDir)') && BLOCK.includes('lib.effectAssetDirOf(e.rel)')
  && BLOCK.includes('seenMat.add(key); matJobs.push({ mat: m, dir: dir });')
  && BLOCK.includes("for (const stage of ['frag', 'vert'])"))
check('S1-7b 包内优先快路径在（`opts.readPkgText` → `pkgText(rel)` 先问包内，命中即不发请求）+ demo 调用点传了它',
  BLOCK.includes('const local = pkgText(rel);') && BLOCK.includes('typeof opts.readPkgText === ') 
  && DEMO_SRC.includes('readPkgText: (rel) => { const e = lib.getEntry(pkg, rel); return e ? rd(e) : null },'))
check('S1-8 调用点在 `await loadScene()` **之前**（reader 必须先注册）',
  callLine > 0 && loadLine > 0 && callLine < loadLine, 'prefetch@' + callLine + ' < loadScene@' + loadLine)
check('S1-9 效果链解析**对所有层**：唯一调用点在 `if (!layer.image) return;` 之前（P-206 第二处改动）',
  resolveLine > 0 && imgGuardLine > 0 && resolveLine < imgGuardLine
  && (DEMO_SRC.match(/lib\.resolveEffectChain\(pkg, ef, rd, \{/g) || []).length === 1,
  'resolveEffectChain@' + resolveLine + ' < image 守卫@' + imgGuardLine)
check('S1-10 缺件不静默：解析调用带 `{ onLog }`（core 的 P-205 台账进页面日志）',
  DEMO_SRC.includes('lib.resolveEffectChain(pkg, ef, rd, { onLog: (m) => logf('))
check('S1-11 读出台账 `__mpwFxResolve` 发布在（实例/挂上/pass/来源分布）',
  DEMO_SRC.includes('window.__mpwFxResolve = window.__mpwFxResolve || []'))

/* ───────────────── S2：行为（合成资产 + 桩 fetch；候选链用真 core 函数） ───────────────── */
console.log('-- S2 行为（合成）')
const SHAKE = {
  'effects/shake/effect.json': JSON.stringify({ passes: [{ material: 'materials/effects/shake.json', target: '_rt_shake' }] }),
  'effects/shake/materials/effects/shake.json': JSON.stringify({ passes: [{ shader: 'effects/shake', blending: 'normal', textures: ['util/noise'] }] }),
  'effects/shake/shaders/effects/shake.frag': 'void main() { /* frag */ }',
  'effects/shake/shaders/effects/shake.vert': 'void main() { /* vert */ }',
}
const assetFetch = (assets) => (url) => {
  const rel = decodeURIComponent(String(url).replace(/^\/weassist\//, ''))
  return (rel in assets) ? { ok: true, text: assets[rel] } : { ok: false, status: 404 }
}
const SCENE_SHAKE = { layers: [{ effects: [{ file: 'effects/shake/effect.json' }] }, { effects: [{ file: 'effects/shake/effect.json' }] }] }
{
  lib.setWeAssetReader(null)
  const sb = makeSandbox(BLOCK, { fetchImpl: assetFetch(SHAKE) })
  const led = await sb.api.prefetchWeEffectAssets(SCENE_SHAKE)
  const expect = [
    '/weassist/effects/shake/effect.json',
    '/weassist/materials/effects/shake.json', '/weassist/effects/shake/materials/effects/shake.json',
    '/weassist/shaders/effects/shake.frag', '/weassist/effects/shake/shaders/effects/shake.frag',
    '/weassist/shaders/effects/shake.vert', '/weassist/effects/shake/shaders/effects/shake.vert',
  ]
  // 顺序口径：**每个 rel 的候选链内部**必须"直读级 → 效果自带子树级"（同序于 core 的 `weAssetText`）；
  //   不同 rel（frag/vert）之间是同批并发 ⇒ 只要求多重集相等（frag/vert 互相穿插不算错）。
  const idxOf = (u) => sb.requests.indexOf(u)
  const orderOk = [
    ['/weassist/materials/effects/shake.json', '/weassist/effects/shake/materials/effects/shake.json'],
    ['/weassist/shaders/effects/shake.frag', '/weassist/effects/shake/shaders/effects/shake.frag'],
    ['/weassist/shaders/effects/shake.vert', '/weassist/effects/shake/shaders/effects/shake.vert'],
  ].every(([a, b]) => idxOf(a) >= 0 && idxOf(b) >= 0 && idxOf(a) < idxOf(b))
  check('S2-1 预取清单 = 与 core 候选链**逐级同序、命中即停**（同一 rel 的两个实例只取一次；无多余候选）',
    eq(sb.requests.slice().sort(), expect.slice().sort()) && orderOk && led.effects === 1 && led.materials === 1 && led.shaders === 2,
    '请求 ' + sb.requests.length + ' 次=' + JSON.stringify(sb.requests.map((u) => u.replace('/weassist/', ''))) + '；台账 effects/materials/shaders=' + led.effects + '/' + led.materials + '/' + led.shaders)
  check('S2-2 命中后**注册**了同步 reader，且 core 的三级链真的能命中第三级（`weassist-effect-subtree`）',
    sb.registrations.length === 1 && typeof lib.getWeAssetReader() === 'function'
    && (() => {
      const r = lib.readWeAssetText('materials/effects/shake.json', 'effects/shake/', {})
      return r && r.source === 'weassist-effect-subtree' && r.rel === 'effects/shake/materials/effects/shake.json' && r.text === SHAKE[r.rel]
    })(),
    'led.registered=' + led.registered + ' mapSize=' + led.mapSize + ' hits=' + led.hits + ' ' + JSON.stringify(led.byKind))
  check('S2-3 reader 的 miss = null（不问网络、不抛）；表里有的按 rel 原样返回',
    sb.api.mpwWeAssetReader('effects/shake/effect.json') === SHAKE['effects/shake/effect.json']
    && sb.api.mpwWeAssetReader('effects/nope/effect.json') === null
    && sb.api.mpwWeAssetReader(undefined) === null && sb.api.mpwWeAssetReader('/effects/shake/effect.json') === SHAKE['effects/shake/effect.json'])
  check('S2-4 台账 `__mpwFxPrefetch` 发布（limits/enabled/registered/bytes/requests/truncated）',
    sb.fakeGlobal.__mpwFxPrefetch === led && led.enabled === true && led.registered === true
    && led.requests === 7 && led.truncated === false && led.limits && led.limits.maxReq === 600 && led.limits.conc === 8,
    JSON.stringify({ requests: led.requests, bytes: led.bytes, ms: led.ms, limits: led.limits }))
  check('S2-5 日志非空且写明来源（"已注册同步 weAssetReader"）',
    sb.logs.some((l) => /P-206 效果资产预取/.test(l) && /已注册同步 weAssetReader/.test(l)), JSON.stringify((sb.logs[0] || '').slice(0, 120)))
  lib.setWeAssetReader(null)
}
{
  // ④ legacy 档：不预取、不注册（= 回到改动前）
  const sb = makeSandbox(BLOCK, { fetchImpl: assetFetch(SHAKE), search: '?weassist=legacy&id=x' })
  const led = await sb.api.prefetchWeEffectAssets(SCENE_SHAKE)
  check('S2-6 `?weassist=legacy` ⇒ 0 次请求 + **不注册**（`lib.getWeAssetReader()` 仍为 null）+ 台账如实记 legacy',
    sb.requests.length === 0 && sb.registrations.length === 0 && lib.getWeAssetReader() === null
    && led.legacy === true && led.registered === false && sb.logs.some((l) => /weassist=legacy/.test(l)),
    'requests=' + sb.requests.length + ' led=' + JSON.stringify({ legacy: led.legacy, registered: led.registered }))
  check('S2-7 纯函数口径：只有字面 `legacy` 关档（`1`/空/其它值都照常预取）',
    sb.api.mpwWeassistLegacyFrom('?weassist=legacy') === true && sb.api.mpwWeassistLegacyFrom('?weassist=1') === false
    && sb.api.mpwWeassistLegacyFrom('') === false && sb.api.mpwWeassistLegacyFrom(null) === false)
}
{
  // ④b 包内优先快路径：包内 effect.json **不发请求**（只就地解析），它引用的**外部** material 仍要去取。
  const PKG_ASSETS = { 'effects/pkg/effect.json': JSON.stringify({ passes: [{ material: 'materials/effects/pkg.json' }] }) }
  const WE_ASSETS2 = Object.assign({}, SHAKE, {
    'materials/effects/pkg.json': JSON.stringify({ passes: [{ shader: 'effects/shake' }] }),
    'effects/pkg/shaders/effects/shake.frag': 'void main() { /* frag via effect dir */ }',
    'effects/pkg/shaders/effects/shake.vert': 'void main() { /* vert via effect dir */ }',
  })
  lib.setWeAssetReader(null)
  const sb = makeSandbox(BLOCK, { fetchImpl: assetFetch(WE_ASSETS2) })
  const led = await sb.api.prefetchWeEffectAssets({ layers: [{ effects: [{ file: 'effects/pkg/effect.json' }] }] }, {
    readPkgText: (rel) => (rel in PKG_ASSETS) ? PKG_ASSETS[rel] : null,
  })
  check('S2-13 包内已有的 effect.json **0 次请求**（`inPkg.effect=1`），它引用的外部 material 与 shader 源照取；'
    + 'shader 的第三级重定基用的是**效果目录**（`effects/pkg/`）而不是 material 的目录',
    led.inPkg.effect === 1 && sb.requests.every((u) => !/effects\/pkg\/effect\.json$/.test(u))
    && sb.requests.includes('/weassist/materials/effects/pkg.json')
    && sb.requests.includes('/weassist/effects/pkg/shaders/effects/shake.frag')
    && !sb.requests.some((u) => /materials\/effects\/shaders\//.test(u))
    && led.byKind.material === 1 && led.byKind.shader === 2 && led.registered === true && led.mapSize === 3,
    'requests=' + JSON.stringify(sb.requests.map((u) => u.replace('/weassist/', ''))) + ' inPkg=' + JSON.stringify(led.inPkg)
    + ' byKind=' + JSON.stringify(led.byKind) + ' mapSize=' + led.mapSize)
  lib.setWeAssetReader(null)
}
{
  // ⑤ 有界：三档触顶都只记 truncated、不抛、已收的照用
  const small = (src, a, b) => src.replace(a, b)
  lib.setWeAssetReader(null)
  const sbReq = makeSandbox(small(BLOCK, 'const FX_PREFETCH_MAX_REQ = 600;', 'const FX_PREFETCH_MAX_REQ = 2;'), { fetchImpl: assetFetch(SHAKE) })
  const ledReq = await sbReq.api.prefetchWeEffectAssets(SCENE_SHAKE)
  check('S2-8 触顶①请求数（=2）⇒ `truncated=max-req`、函数照常返回、已命中的入表/注册',
    ledReq.truncated === 'max-req' && ledReq.requests === 2 && ledReq.registered === true && ledReq.mapSize >= 1,
    JSON.stringify({ requests: ledReq.requests, truncated: ledReq.truncated, mapSize: ledReq.mapSize }))
  lib.setWeAssetReader(null)
  const sbBytes = makeSandbox(small(BLOCK, 'const FX_PREFETCH_MAX_BYTES = 6 << 20;', 'const FX_PREFETCH_MAX_BYTES = 10;'), { fetchImpl: assetFetch(SHAKE) })
  const ledBytes = await sbBytes.api.prefetchWeEffectAssets(SCENE_SHAKE)
  check('S2-9 触顶②字节数（=10B）⇒ `truncated=max-bytes`、不抛、表空时不注册',
    ledBytes.truncated === 'max-bytes' && ledBytes.registered === false && ledBytes.mapSize === 0,
    JSON.stringify({ bytes: ledBytes.bytes, truncated: ledBytes.truncated, mapSize: ledBytes.mapSize }))
  lib.setWeAssetReader(null)
  const sbMs = makeSandbox(small(BLOCK, 'const FX_PREFETCH_BUDGET_MS = 10000;', 'const FX_PREFETCH_BUDGET_MS = 0;'), { fetchImpl: assetFetch(SHAKE) })
  const ledMs = await sbMs.api.prefetchWeEffectAssets(SCENE_SHAKE)
  check('S2-10 触顶③墙钟（=0ms）⇒ `truncated=budget-ms`、0 请求、不抛',
    ledMs.truncated === 'budget-ms' && ledMs.requests === 0 && ledMs.registered === false,
    JSON.stringify({ requests: ledMs.requests, truncated: ledMs.truncated }))
  lib.setWeAssetReader(null)
}
{
  // ⑥ 失败/超时不阻塞挂载：桩 fetch 抛异常 / 返回 null / 正文超时（textT → null）
  const bad = [
    ['抛异常', () => { throw new Error('boom') }],
    ['返回 null', () => null],
    ['正文超时（textT 拿不到）', () => ({ ok: true, text: null })],
  ]
  let ok = true; const reads = []
  for (const [name, impl] of bad) {
    lib.setWeAssetReader(null)
    const sb = makeSandbox(BLOCK, { fetchImpl: impl })
    let led = null, threw = null
    try { led = await sb.api.prefetchWeEffectAssets(SCENE_SHAKE) } catch (e) { threw = String(e && e.message) }
    reads.push(name + ': ' + (threw ? ('THREW ' + threw) : ('ok req=' + led.requests + ' reg=' + led.registered)))
    if (threw || !led || led.registered !== false) ok = false
  }
  check('S2-11 失败/超时/异常一律**不阻塞挂载**（函数 resolve、不注册、台账在）', ok, reads.join(' | '))
  check('S2-12 无效果链的场景：0 请求、0 日志、不注册（不刷屏）',
    await (async () => {
      const sb = makeSandbox(BLOCK, { fetchImpl: assetFetch(SHAKE) })
      const led = await sb.api.prefetchWeEffectAssets({ layers: [{}, { effects: [] }] })
      return sb.requests.length === 0 && sb.logs.length === 0 && led.registered === false && led.effects === 0
    })())
  lib.setWeAssetReader(null)
  /* ③(2026-10-12) **内置效果（磁流体 wwgl_cuiliuti）的"同级快路径"**：内置效果只住在 core 的表里，
     `/weassist/**` 永远没有它 ⇒ 预取**一次请求都不该发**，而台账要如实记成 `builtin`（不是 `miss`）。
     回退位 `?cuiliuti=off` ⇒ core 的表整条关掉 ⇒ 同一场景回到"照发候选链请求"（= 接线前的读数）。
     这一组是"内置这一级真的接在预取上、且开关双向可辨"的判据（两档读数必须**不同**）。 */
  {
    const SCENE_CUIL = { layers: [{ effects: [{ file: 'effects/wwgl_cuiliuti/effect.json' }] }] }
    lib.setWeAssetReader(null)
    const sbOn = makeSandbox(BLOCK, { fetchImpl: () => ({ ok: false, status: 404 }) })
    const ledOn = await sbOn.api.prefetchWeEffectAssets(SCENE_CUIL)
    check('S2-14 内置效果：**0 次网络请求**（与"包内优先"同级），台账记 `builtin` 而不是 `miss`',
      sbOn.requests.length === 0 && ledOn.builtin.effect === 1 && ledOn.builtin.material === 1 && ledOn.builtin.shader === 2
      && ledOn.miss === 0 && ledOn.hits === 0 && ledOn.inPkg.effect === 0,
      'req=' + sbOn.requests.length + ' builtin=' + JSON.stringify(ledOn.builtin) + ' miss=' + ledOn.miss + ' hits=' + ledOn.hits)
    const sbOff = makeSandbox(BLOCK, { fetchImpl: () => ({ ok: false, status: 404 }), search: '?cuiliuti=off' })
    const ledOff = await sbOff.api.prefetchWeEffectAssets(SCENE_CUIL)
    check('S2-15 `?cuiliuti=off` ⇒ 同一场景回到候选链（请求数 > 0、`builtin` 全 0、miss ≥ 1）——开关双向可辨',
      sbOff.requests.length > 0 && ledOff.builtin.effect === 0 && ledOff.builtin.material === 0 && ledOff.builtin.shader === 0 && ledOff.miss >= 1,
      'req=' + sbOff.requests.length + ' builtin=' + JSON.stringify(ledOff.builtin) + ' miss=' + ledOff.miss)
    lib.setWeAssetReader(null)
  }
}

/* ───────────────── S3：真语料（磁盘同语义的 /weassist 桩 + 真 core 解析器） ───────────────── */
console.log('-- S3 真语料')
/** 链摘要（FNV-1a 32，`Math.imul` 真 32 位）——**与 `demo.html::loadScene` 的 `fxStat.digest` 逐字同算式**
    （同一份行构造 + 行间 '\n' + 行尾无）：浏览器读数与离线读数据此可以直接对数。 */
function chainDigest(rows) {
  let h = 0x811c9dc5
  const s = rows.join('\n')
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
/** 一个层-效果实例的链摘要行（口径 = demo.html 里 `fxHashAdd(JSON.stringify({f,fbos,mp:[…]}))`）。 */
const chainRow = (ef) => {
  const mps = ef.materialPasses || []
  return JSON.stringify({ f: String((ef && ef.file) || ''), fbos: ef.fbos || null,
    mp: mps.map((m) => ({ s: m.shader, b: m.blending, t: m.target, binds: m.binds, tx: m.textures, c: m.combos, k: m.constants })) })
}
/** 与 `demo.html::loadScene` 同序：**所有层**、层序内效果序（P-206 起不再按 `layer.image` 过滤）。 */
function resolveAllEffects(pkgFile) {
  const pkg = openPkgLazy(pkgFile)
  const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(pkgFile)), null,
    { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  const st = { instances: 0, attached: 0, passes: 0, realShaders: 0, sources: {}, matSources: {}, rows: [], fxRows: [], logs: [] }
  for (const l of scene.layers) for (const ef of (l.effects || [])) {
    const r = lib.resolveEffectChain(pkg, ef, (b) => DEC.decode(b), { onLog: (m) => st.logs.push(String(m)) })
    st.instances++
    const mps = ef.materialPasses || []
    if (mps.length) { st.attached++; st.passes += mps.length }
    const src = (r && r.source) || 'miss'
    st.sources[src] = (st.sources[src] || 0) + 1
    for (const mp of mps) {
      const ms = mp.__matSource || 'none'
      st.matSources[ms] = (st.matSources[ms] || 0) + 1
      if (mp.shader) st.realShaders++
    }
    st.fxRows.push(chainRow(ef))
    // 冻结值口径（= `effect-json-fallback-test.mjs` 的 chainOf）：`<file>:<链 JSON>`
    st.rows.push(String(ef.file || '') + ':' + JSON.stringify({
      fbos: ef.fbos || null, commands: ef.commands || null,
      mp: mps.map((m) => ({ s: m.shader, b: m.blending, t: m.target, binds: m.binds, tx: m.textures, c: m.combos, k: m.constants })),
    }))
  }
  st.digest = chainDigest(st.fxRows)
  return { pkg, scene, st }
}
const digest = (rows) => crypto.createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16)

const VIDEOBASE = [
  { rel: 'wallpaperE/砂狼白子/砂狼白子11_03.mpkg', fx: 50, attached: 22, passes: 30, miss: 28, digest: '34c36f1e' },
  { rel: 'wallpaperE/佩丽卡/佩丽卡1_03.mpkg', fx: 45, attached: 37, passes: 47, miss: 8, digest: '14342015' },
  { rel: 'wallpaperE/陈千语/陈千语_03.mpkg', fx: 25, attached: 25, passes: 25, miss: 0, digest: '0546438e' },
]
{
  if (!exists(WE_ASSETS)) {
    check('S3-1 三个 PKGM0014 真包"预取 ⇒ 真的挂上"（×WE 资产存在时才可判）', false, 'WE assets 不存在: ' + WE_ASSETS)
  } else {
    const readouts = []
    let ok = true, okLegacy = true
    for (const v of VIDEOBASE) {
      const f = path.join(CORPUS, v.rel)
      if (!exists(f)) { ok = false; readouts.push(v.rel + ': 语料缺失'); continue }
      lib.setWeAssetReader(null)
      // (a) 预取 + 注册（= 页面路径：先 parseScene 拿到清单，再预取，再解析效果链）
      const pkgA = openPkgLazy(f)
      const sceneA = lib.parseScene(lib.parseWeJson(readSceneJsonText(f)), null, { attachCtx: { readEntry: (n) => lib.getEntry(pkgA, n), time: 0 } })
      const sb2 = makeSandbox(BLOCK, { fetchImpl: (u) => diskWeAssistFetch(u) })
      const led2 = await sb2.api.prefetchWeEffectAssets(sceneA, { readPkgText: (rel) => { const e = lib.getEntry(pkgA, rel); return e ? DEC.decode(e) : null } })
      lib.resetEffectAssetLedger()
      const { st } = resolveAllEffects(f)
      const ledFx = lib.effectAssetLedger()
      const registered = typeof lib.getWeAssetReader() === 'function'
      // (b) legacy 档（不注册）⇒ 挂上数必须为 0（= 改动前的浏览器读数）
      lib.setWeAssetReader(null)
      lib.resetEffectAssetLedger()
      const legacy = resolveAllEffects(f).st
      readouts.push(path.basename(v.rel) + ' fx=' + st.instances + ' 挂上=' + st.attached + ' pass=' + st.passes
        + ' 真shader=' + st.realShaders + ' 链摘要=' + st.digest + ' 预取命中=' + led2.hits + JSON.stringify(led2.byKind)
        + ' 请求=' + led2.requests + ' 入表=' + led2.mapSize + ' 定义来源=' + JSON.stringify(st.sources)
        + ' material来源=' + JSON.stringify(st.matSources) + ' 台账eff=' + ledFx.eff + ' | legacy 挂上=' + legacy.attached)
      if (!(registered && st.instances === v.fx && st.attached === v.attached && st.passes === v.passes
        && st.realShaders === st.passes && (st.matSources['weassist-effect-subtree'] || 0) === v.passes
        && ledFx.eff === v.miss && led2.registered === true && led2.requests > 0)) ok = false
      if (v.digest && st.digest !== v.digest) ok = false
      if (!(legacy.attached === 0 && legacy.passes === 0)) okLegacy = false
    }
    lib.setWeAssetReader(null)
    check('S3-1 预取+注册 ⇒ 3 个 PKGM0014 真包挂上效果（实例 50/45/25 · 挂上 22/37/25 · pass 30/47/25 · 每条都有真 shader · material 全来自第三级 · 台账 eff=28/8/0 · 链摘要 34c36f1e/14342015/0546438e）',
      ok, readouts.join('  |  '))
    check('S3-2 同一个包**不注册 reader** 时挂上 = 0（"改前浏览器里是 0"这条对照）', okLegacy,
      VIDEOBASE.map((v) => path.basename(v.rel)).join(' / '))
  }
}
{
  // S3-3 逐位不回归：含**包内效果**的真包，链摘要 digest == effect-json-fallback-test 的冻结值；
  //   且"预取+注册"与"完全不注册"两档 digest 逐字相同（core 包内优先 ⇒ 预取只补外部件）。
  //   做法（为什么这样才够强）：先用**外部件充足的 PKGM0014 包**建一张**非空**的页面级表并注册 reader，
  //   再在"reader 已注册且表里有条目"的状态下解析这些**自足包** ⇒ digest 必须与"完全不注册"时逐字相同。
  //   ③ `wallpaperE/other/红鸾樱落.mpkg` 是**浏览器对照档**用的包（9.4MB，57 个包内效果实例，自足：
  //   预取 0 请求 / 0 入表 / 不注册）：它的 P-206 `链摘要`（FNV-1a 32）冻结在这里，
  //   浏览器读数（`__mpwFxResolve[].digest`）与 offline 对同一个数。
  const FROZEN = [
    { rel: '0923/2887099508/scene.pkg', fx: 60, digest: '0893411b3e54efb7' },
    { rel: 'dd/3544152633/scene.pkg', fx: 61, digest: '8689ed1d10827dc4' },
    { rel: 'wallpaperE/other/红鸾樱落.mpkg', fx: 57, digest: 'f7fdc187eef6cd34', fxDigest: 'e5ad6bf3' },
  ]
  const readouts = []
  let ok = true
  for (const v of FROZEN) {
    const f = path.join(CORPUS, v.rel)
    if (!exists(f)) { ok = false; readouts.push(v.rel + ': 语料缺失'); continue }
    lib.setWeAssetReader(null)
    const noReader = resolveAllEffects(f).st
    const dNo = digest(noReader.rows)
    const pkg = openPkgLazy(f)
    const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(f)), null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
    const sb = makeSandbox(BLOCK, { fetchImpl: (u) => diskWeAssistFetch(u) })
    const ledSelf = await sb.api.prefetchWeEffectAssets(scene, { readPkgText: (rel) => { const e = lib.getEntry(pkg, rel); return e ? DEC.decode(e) : null } })
    // ⇒ 再灌一份**外部件充足**的 PKGM0014 包（页面级表是累积的）——保证"reader 已注册且表非空"这个前提，
    //    而不是让自足包走到"表空 ⇒ 不注册"那条路上（那样证明不了"注册了也不动包内链"）。
    const fxFile = path.join(CORPUS, VIDEOBASE[0].rel)
    const pkgX = openPkgLazy(fxFile)
    const sceneX = lib.parseScene(lib.parseWeJson(readSceneJsonText(fxFile)), null, { attachCtx: { readEntry: (n) => lib.getEntry(pkgX, n), time: 0 } })
    const sbX = makeSandbox(BLOCK, { fetchImpl: (u) => diskWeAssistFetch(u) })
    const ledX = await sbX.api.prefetchWeEffectAssets(sceneX, { readPkgText: (rel) => { const e = lib.getEntry(pkgX, rel); return e ? DEC.decode(e) : null } })
    const registered = typeof lib.getWeAssetReader() === 'function'
    const withReader = resolveAllEffects(f).st
    const dWith = digest(withReader.rows)
    readouts.push(path.basename(path.dirname(v.rel)) + '/' + path.basename(v.rel) + ' fx=' + withReader.instances
      + ' digest=' + dWith + '/' + v.digest + ' 链摘要=' + withReader.digest + (v.fxDigest ? '/' + v.fxDigest : '')
      + ' 本包预取入表=' + ledSelf.mapSize + ' 外部表=' + ledX.mapSize + ' reader=' + registered)
    if (!(noReader.rows.length === v.fx && dNo === v.digest && dWith === v.digest && withReader.attached === noReader.attached)) ok = false
    if (v.fxDigest && !(noReader.digest === v.fxDigest && withReader.digest === v.fxDigest)) ok = false
    if (!(registered && ledX.mapSize > 0)) ok = false
  }
  lib.setWeAssetReader(null)
  check('S3-3 逐位不回归：3 个含包内效果的真包（60/61/57 实例）"reader 已注册且外部表非空" == "完全不注册" == 冻结 digest（含 P-206 链摘要 e5ad6bf3）',
    ok, readouts.join('  |  '))
}

/* ───────────────── S4：变异自证（隔离 demo.html 副本；真树不动） ───────────────── */
const MUTANTS = [
  { id: 'no-reader-registration', expect: ['S1', 'S2', 'S3'],
    edit: (s) => s.replace('    if (map.size > 0) led.registered = !!lib.setWeAssetReader(mpwWeAssetReader);', '    if (map.size > 0) led.registered = false;') },
  { id: 'no-material-phase', expect: ['S1', 'S2', 'S3'],
    edit: (s) => s.replace('        seenMat.add(key); matJobs.push({ mat: m, dir: dir });', '        seenMat.add(key);') },
  { id: 'no-legacy-gate', expect: ['S1', 'S2'],
    edit: (s) => s.replace('    if (MPW_WEASSIST_LEGACY) {', '    if (false) {') },
  { id: 'no-bounds', expect: ['S1', 'S2'],
    edit: (s) => s.replace('  if (led.requests >= FX_PREFETCH_MAX_REQ) { led.truncated = led.truncated || \'max-req\'; return null }', '  if (false) { return null }') },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('-- S4 变异自证（隔离 demo.html 副本；真树不动）')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-fxprefetch-'))
  for (const m of MUTANTS) {
    const target = path.join(tmp, m.id + '.html')
    const mutated = m.edit(DEMO_SRC)
    if (mutated === DEMO_SRC) { check('S4 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 64 << 20,
      env: { ...process.env, MPW_DEMO_FILE: target },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(S\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('S4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n' + (fail ? '✗ FAIL' : '✓ PASS') + ' weassist-prefetch-test: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)

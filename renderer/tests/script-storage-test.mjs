#!/usr/bin/env node
// script-storage-test.mjs — P-153：脚本 `localStorage` 的**共享持久**档（`?scriptstore=persist`）门禁
//
// 背景（方案 `docs/UPSTREAM-PORT-PLAN-20260919.md` §5）：
//   官方语义是"**同一张壁纸的全部脚本共享一份 + 跨会话持久**"（上游 `oneincase/webwallgl`（MIT）
//   `renderer/vendor/we-scene/render/storage.js`）。本仓今天的实现是**逐沙箱一个 `new Map()`**
//   （`elysia/scene-scripts.js` 的 env 构造处）：脚本之间互相看不见、刷新即复位 —— 而那是本仓的
//   既有纪律（"脚本沙箱不碰宿主存储"）。⇒ 本项**不改默认档**：缺省逐位保持 legacy，
//   只有显式 `?scriptstore=persist` 才走"共享持久"档。**"默认要不要改成持久化"由用户拍板**。
//
// 本测试守 5 组 + 1 组变异自证（**无浏览器**：假 DOM / 注入的 localStorage 桩驱动真代码）：
//   G0 开关判定式与导出面（`?scriptstore=persist` 唯一判定式、命名空间消毒、缺省不建 store）
//   G1 **legacy 档逐位不变**：同沙箱 set→get 可见 / **跨沙箱不可见** / 门面对象逐沙箱一份 /
//      **一个键都不落任何 storage（0 次 setItem / 0 次 getItem / 0 个键）**
//   G2 persist 档：跨沙箱可见 + 真 setItem（键前缀 `mpw.<包id>.`）+ 值 round-trip（含 Vec3 对象）
//      + remove 生效 + **重建 store（模拟刷新）后仍在** + 命名空间隔离 + `LOCATION_GLOBAL` 跨壁纸
//      + `clear()` **只清本命名空间**（宿主其它键逐字不动）+ 全局路径（只用 `location.search` +
//      `window.localStorage`，不改宿主）
//   G2r 真语料真代码：`dd/3326873240` 的作者脚本（objects[21] 写 `miDragable`、objects[8] 写/读
//      `storedPosRoundMIC`）在两种档下的读数差（legacy 读不到 ⇒ 回退 `scriptProperties.isMovable`）
//   G3 异常兜底：`setItem` 抛（配额）⇒ 脚本不报错、退回内存、**恰好 1 行 warn**；
//      `getItem` 抛 / 访问 `localStorage` 属性即抛（不透明源/隐私模式）/ 完全没有后端 ⇒ 同
//   G4 语料口径（8 包 / 66 次调用 / 只用 get-set-remove / `LOCATION_*`+`resizeScreen` = 0）
//   G5 RED-IF-REVERTED（**6 组变异**，每组在 `/tmp` 的真文件副本上真跑一次子进程；真树不动）：
//      R1 默认档改成 persist ⇒ G0/G1 必红 ｜ R2 去掉键前缀 ⇒ G2 必红 ｜ R3 去掉 try/catch ⇒ G3 必红
//      ｜ R4 忽略 `opts.scriptStore`（换回逐沙箱 Map）⇒ G2 必红 ｜ R5 去掉写穿透 ⇒ G2 必红
//      ｜ R6 `clear()` 清整个后端 ⇒ G2 必红
//
// 用法：node tests/script-storage-test.mjs                 （全跑；缺语料时 G4/G2r 标 SKIP 不红）
//       node tests/script-storage-test.mjs --no-mutants     （跳过 G5，变异子进程用）
// 门禁名：`script-storage`（`tests/run-all-tests.sh --only script-storage`）
// 资源：单 node 进程、无浏览器、无网络；PeakRSS 实测 ~90MB；~1s（不含 6 组变异子进程）。
import { WS, ROOT } from './_root.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// ①(P-153) 变异子进程用 `MPW_P153_SCENE_SCRIPTS` 指向 /tmp 的副本；缺省 = 本仓库真文件
const SRC = process.env.MPW_P153_SCENE_SCRIPTS || path.join(ROOT, 'elysia', 'scene-scripts.js')
const MUTANT_MODE = !!process.env.MPW_P153_MUTANT
const RUN_MUTANTS = !MUTANT_MODE && !process.argv.includes('--no-mutants')
const MPW_WS = process.env.MPW_ROOT || WS
const mod = await import(pathToFileURL(SRC).href)
const {
  applySceneScripts, createScriptCache, dispatchScriptEvent,
  scriptStorePersist, scriptStoreNamespace, makeScriptStore, makeScriptStoreApi, scriptStoreFor,
  SCRIPT_STORE_KEY_PREFIX, SCRIPT_STORE_GLOBAL_NS, LOCATION_SCREEN, LOCATION_GLOBAL,
} = mod

let pass = 0, fail = 0, skip = 0
const fails = []
const redGroups = new Set()
function check(group, ok, name, detail) {
  if (ok) { pass++; console.log(`  ✓ [${group}] ${name}` + (detail ? `  [${detail}]` : '')) }
  else {
    fail++; fails.push(`${group} ${name}`); redGroups.add(group)
    console.log(`  ✗ [${group}] ${name}` + (detail ? `  [${detail}]` : ''))
  }
}
const eq = (group, a, b, name) => check(group, a === b, name, `实测 ${JSON.stringify(a)} vs 期望 ${JSON.stringify(b)}`)

// ───────────────────────── 假 DOM / localStorage 桩 ─────────────────────────
/**
 * 一个够用的 DOM Storage 桩：计数器 + 可选"某方法抛错"（配额/隐私模式/不透明源）。
 * `st.mode` 可以**中途改**（`st.mode = 'getItem'` 之后所有读都抛）——用来证明"同一 cache 的
 * 两个沙箱共享内存"这条不依赖后端。
 */
function makeFakeStorage(mode = '') {
  const map = new Map()
  const calls = { getItem: 0, setItem: 0, removeItem: 0, key: 0, length: 0, clear: 0 }
  const boom = (what) => {
    const e = new Error('boom:' + what)
    e.name = (what === 'setItem') ? 'QuotaExceededError' : 'SecurityError'
    throw e
  }
  const st = {
    map, calls, mode,
    get length() { calls.length++; if (st.mode === 'length') boom('length'); return map.size },
    key(i) { calls.key++; if (st.mode === 'key') boom('key'); const ks = [...map.keys()]; return i >= 0 && i < ks.length ? ks[i] : null },
    getItem(k) { calls.getItem++; if (st.mode === 'getItem') boom('getItem'); k = String(k); return map.has(k) ? map.get(k) : null },
    setItem(k, v) { calls.setItem++; if (st.mode === 'setItem') boom('setItem'); map.set(String(k), String(v)) },
    removeItem(k) { calls.removeItem++; if (st.mode === 'removeItem') boom('removeItem'); map.delete(String(k)) },
    clear() { calls.clear++; map.clear() },
  }
  return st
}
/** 装/卸全局假 DOM（`location` / `localStorage`）：访问 `localStorage` 属性即抛 = 不透明源/隐私模式。 */
const REAL_GLOBALS = {
  location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
  localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
}
function setGlobal(name, value) {
  if (value === undefined) { try { delete globalThis[name] } catch { /* ignore */ } return }
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
}
function setThrowingLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { const e = new Error('访问 localStorage 即抛（不透明源 / 隐私模式）'); e.name = 'SecurityError'; throw e },
  })
}
function restoreGlobals() {
  for (const [n, d] of Object.entries(REAL_GLOBALS)) {
    if (d) Object.defineProperty(globalThis, n, d)
    else { try { delete globalThis[n] } catch { /* ignore */ } }
  }
}
setGlobal('location', undefined)
setGlobal('localStorage', undefined)

// ───────────────────────── 跑脚本的小工具（真代码路径） ─────────────────────────
const mkScene = (scripts) => ({ objects: scripts.map((s) => Object.assign({ visible: true, value: '' }, s)) })
/**
 * 跑一趟 `applySceneScripts`（真入口），返回 `{ values, errs, shared, cache, scene }`。
 * `values[i]` = 第 i 个脚本节点的 `value`（脚本 init 的返回值会经 `formatResult` 写回这里）。
 */
function run(scripts, opts = {}) {
  const cache = opts.cache || createScriptCache()
  const shared = opts.shared || {}
  // 与 demo.html 同形：宿主把**自己那个** shared 对象交给 cache（`sceneScriptCache.shared = scriptShared`）
  // —— `applySceneScripts` 的 `shared` 是 `cache.shared || opts.shared`，不这样挂就读不到脚本写的值。
  cache.shared = shared
  const scene = mkScene(scripts)
  const errs = []
  applySceneScripts(scene, opts.time || 0, Object.assign({
    scriptCache: cache,
    shared,
    renderObjects: scene.objects,
    onError: (stage, e) => errs.push(stage + ':' + ((e && e.message) || String(e))),
  }, opts.apply || {}))
  return { values: scene.objects.map((o) => o.value), errs, shared, cache, scene }
}
const val = (v) => (v === null ? 'null' : String(v))

// 探针脚本（真作者脚本形态：`export function init`）
const S_SETGET = `export function init() {
  localStorage.set('k', 'v1'); localStorage.setItem('k2', 'v2');
  return [String(localStorage.get('k')), String(localStorage.getItem('k2')),
    String(localStorage.has('k')), String(localStorage.has('nope')),
    String(localStorage.get('nope')), String(localStorage.get('nope', 'dflt'))].join('|');
}`
const S_A_SET = `export function init() { localStorage.set('sharedKey', 'fromA'); return 'A' }`
const S_B_GET = `export function init() { const v = localStorage.get('sharedKey'); return v === null ? 'NULL' : String(v) }`
const S_TAG_W = `export function init() { localStorage.__tag = 'A'; return 'A' }`
const S_TAG_R = `export function init() { return String(localStorage.__tag) }`
const S_CLEAR = `export function init() {
  localStorage.set('a', '1'); localStorage.set('b', '2'); localStorage.clear();
  return [String(localStorage.get('a')), String(localStorage.get('b'))].join('|');
}`
const S_NUM = `export function init() { localStorage.set('miShowClock', 2); return String(localStorage.get('miShowClock')) }`
const S_NUM_R = `export function init() { return typeof localStorage.get('miShowClock') + ':' + String(localStorage.get('miShowClock')) }`
const S_POS_W = `export function init() { localStorage.set('pos', new Vec3(11, 22, 33)); return 'W' }`
const S_POS_R = `export function init() { return JSON.stringify(localStorage.get('pos')) }`
const S_RM = `export function init() { localStorage.set('gone', 'x'); localStorage.remove('gone'); return String(localStorage.get('gone')) }`
const S_A_SET2 = `export function init() { localStorage.set('sharedKey2', 'fromA2'); return 'A2' }`
const S_A_SET3 = `export function init() { localStorage.set('sharedKey3', 'fromA3'); return 'A3' }`
const S_API = `export function init() {
  const L = localStorage;
  localStorage.set('one', '1'); localStorage.set('two', '2');
  return [typeof L.getItem, typeof L.setItem, typeof L.removeItem, typeof L.delete,
    L.key(0) === null ? 'k0:null' : 'k0:' + typeof L.key(0),
    Array.isArray(L.keys()) ? 'keys:' + L.keys().sort().join(',') : 'keys:no',
    typeof L.length, String(L.LOCATION_SCREEN), String(L.LOCATION_GLOBAL)].join('|');
}`
const S_GLOBAL_LS = `export function init() {
  localStorage.set('g', 'G1', localStorage.LOCATION_GLOBAL);
  localStorage.set('s', 'S1', localStorage.LOCATION_SCREEN);
  return 'ok';
}`
const S_GLOBAL_RD = `export function init() {
  return String(localStorage.get('g', null, localStorage.LOCATION_GLOBAL)) + '|' + String(localStorage.get('s'));
}`

const SEARCH = '?id=3326873240&scriptstore=persist'
const SEARCH_OTHER = '?id=3554161528&scriptstore=persist'
const PERSIST = { scriptStoreSearch: SEARCH }
const PERSIST_OTHER = { scriptStoreSearch: SEARCH_OTHER }
const LEGACY = { scriptStoreSearch: '' }

// ───────────────────────── G0 开关判定式与导出面 ─────────────────────────
console.log('\n[G0] 开关判定式与导出面')
eq('G0', scriptStorePersist('?scriptstore=persist'), true, '`?scriptstore=persist` ⇒ 开')
eq('G0', scriptStorePersist('?a=1&scriptstore=persist&b=2'), true, '混在其它参数里也认')
eq('G0', scriptStorePersist(''), false, '缺省（空查询串）⇒ legacy')
eq('G0', scriptStorePersist('?scriptstore=legacy'), false, '`?scriptstore=legacy` ⇒ legacy')
eq('G0', scriptStorePersist('?xscriptstore=persist'), false, '`?xscriptstore=persist` 不得误命中')
eq('G0', makeScriptStore({ scriptStoreSearch: '' }), null, 'legacy 档**不建 store**（缺省不新建任何后端路径）')
check('G0', typeof scriptStoreNamespace === 'function' && typeof makeScriptStoreApi === 'function'
  && typeof scriptStoreFor === 'function' && typeof makeScriptStore === 'function', '导出面齐全（工厂/门面/解析器）')
eq('G0', scriptStoreNamespace({}, '?id=3326873240'), '3326873240', '命名空间 = `?id=`（与 demo.html `mpw-props:<id>` 同口径）')
eq('G0', scriptStoreNamespace({}, '?id=../../etc/passwd'), '______etc_passwd', '命名空间消毒（去掉 `/` 与 `.`）')
eq('G0', scriptStoreNamespace({ scriptStoreNamespace: 'mine' }, SEARCH), 'mine', '显式 `scriptStoreNamespace` 优先于 `?id=`')
eq('G0', SCRIPT_STORE_KEY_PREFIX, 'mpw.', '键前缀常量 = `mpw.`（方案 §5.4② 的建议名）')

// ───────────────────────── G1 legacy 档（缺省，逐位不变） ─────────────────────────
console.log('\n[G1] legacy 档（缺省）：逐沙箱内存 Map、不共享、不持久')
{
  const fake = makeFakeStorage()
  setGlobal('localStorage', fake)          // 故意装一个可用的全局 storage：legacy 也不许碰它
  const r1 = run([{ script: S_SETGET }], { apply: LEGACY })
  check('G1', r1.errs.length === 0, 'legacy 脚本不报错', r1.errs.join(';') || 'errors=0')
  eq('G1', val(r1.values[0]), 'v1|v2|true|false|null|dflt', '同沙箱：set/setItem 后 get/getItem/has 全可见')
  const r2 = run([{ script: S_A_SET }, { script: S_B_GET }], { apply: LEGACY })
  eq('G1', val(r2.values[1]), 'NULL', '**跨沙箱不可见**（生产者写、消费者读 = null）')
  const r3 = run([{ script: S_TAG_W }, { script: S_TAG_R }], { apply: LEGACY })
  eq('G1', val(r3.values[1]), 'undefined', '门面对象**逐沙箱一份**（脚本 A 挂的 `__tag` 脚本 B 看不到）')
  const r4 = run([{ script: S_CLEAR }], { apply: LEGACY })
  eq('G1', val(r4.values[0]), 'null|null', 'legacy `clear()` 只清本沙箱')
  const r5 = run([{ script: S_SETGET }], { apply: LEGACY })
  check('G1', r5.errs.length === 0, '第二次跑同形态脚本仍不报错')
  // ★ 硬指标：legacy 档绝不落任何 storage
  eq('G1', fake.calls.setItem, 0, '★ **0 次 setItem**（脚本 set/setItem 跑了 2 次，storage 一次没碰）')
  eq('G1', fake.calls.getItem, 0, '★ 0 次 getItem')
  eq('G1', fake.calls.removeItem, 0, '0 次 removeItem')
  eq('G1', fake.calls.key, 0, '0 次 key（没枚举过宿主键）')
  eq('G1', fake.calls.length, 0, '0 次 length（没读过宿主键数）')
  eq('G1', fake.map.size, 0, '★ 宿主 storage 里**一个键都没有**')
  const twoCaches = [run([{ script: S_A_SET }], { apply: LEGACY }), run([{ script: S_B_GET }], { apply: LEGACY })]
  eq('G1', val(twoCaches[1].values[0]), 'NULL', '跨 cache（另一张"壁纸"）也不可见')
  setGlobal('localStorage', undefined)
}

// ───────────────────────── G2 persist 档 ─────────────────────────
console.log('\n[G2] persist 档：跨沙箱共享 + 真落盘 + 刷新后仍在 + 命名空间隔离')
let persists = 0
{
  const fake = makeFakeStorage()
  const apply = Object.assign({ scriptStoreBackend: fake }, PERSIST)
  const w = run([{ script: S_A_SET }], { apply })
  const r = run([{ script: S_B_GET }], { apply })
  check('G2', w.errs.length === 0 && r.errs.length === 0, 'persist 脚本不报错')
  eq('G2', val(r.values[0]), 'fromA', '★ **跨沙箱可见**（脚本 B 读到脚本 A 写的值）')
  check('G2', fake.calls.setItem >= 1, '★ 真的调用后端 `setItem`', `setItem=${fake.calls.setItem}`)
  check('G2', fake.map.has('mpw.3326873240.sharedKey'), '★ 键名实例 = `mpw.3326873240.sharedKey`',
    [...fake.map.keys()].join(','))
  check('G2', [...fake.map.keys()].every((k) => k.startsWith('mpw.')), '落盘键一律带我们的前缀 `mpw.`')
  // 同一 cache（= 同一张壁纸）的两个沙箱共享**同一份 store**：后端全抛也照样读得到
  const cShare = createScriptCache()
  run([{ script: S_A_SET }], { apply, cache: cShare })
  fake.mode = 'getItem'                    // 之后任何后端读都抛
  eq('G2', val(run([{ script: S_B_GET }], { apply, cache: cShare }).values[0]), 'fromA',
    '★ 同一 cache 的两个沙箱共享同一份存储（后端读全抛也读得到 ⇒ 真的同源，不是"各读各的后端"）')
  fake.mode = ''
  // 值 round-trip
  eq('G2', val(run([{ script: S_NUM }], { apply }).values[0]), '2', '数值写入后读回 2')
  const numNew = run([{ script: S_NUM_R }], { apply, cache: createScriptCache() })
  eq('G2', val(numNew.values[0]), 'number:2', '**新 store（内存空）**从后端读回 number（不是字符串）')
  eq('G2', val(run([{ script: S_POS_W }], { apply }).values[0]), 'W', 'Vec3 对象真的写进存储（作者脚本形态）')
  eq('G2', val(run([{ script: S_POS_R }], { apply, cache: createScriptCache() }).values[0]),
    '{"x":11,"y":22,"z":33}', '★ Vec3 对象 round-trip（跨 store 读回 `{x,y,z}`，`formatResult` 认得）')
  // 模拟"刷新"：全新 cache + 同一个后端 ⇒ 值仍在
  const reload = run([{ script: S_B_GET }], { apply, cache: createScriptCache() })
  eq('G2', val(reload.values[0]), 'fromA', '★ 重新建 store（模拟刷新）后值**仍在**')
  // remove 生效（内存 + 后端都删）
  const rm = run([{ script: S_RM }], { apply })
  eq('G2', val(rm.values[0]), 'null', 'remove 后同会话读 null')
  check('G2', !fake.map.has('mpw.3326873240.gone'), 'remove 后**后端键也没了**')
  // 命名空间隔离：另一张壁纸（不同 `?id=`）读不到、也覆盖不了
  eq('G2', val(run([{ script: S_B_GET }], { apply: Object.assign({ scriptStoreBackend: fake }, PERSIST_OTHER) }).values[0]),
    'NULL', '★ 另一张壁纸（`?id=3554161528`）读不到 A 的键（命名空间隔离）')
  const otherWrite = `export function init() { localStorage.set('sharedKey', 'fromOther'); return 'B' }`
  run([{ script: otherWrite }], { apply: Object.assign({ scriptStoreBackend: fake }, PERSIST_OTHER) })
  eq('G2', fake.map.get('mpw.3326873240.sharedKey'), 'fromA', '另一张壁纸写同名键，**不覆盖** A 的键')
  eq('G2', fake.map.get('mpw.3554161528.sharedKey'), 'fromOther', '另一张壁纸的键落成 `mpw.3554161528.sharedKey`')
  // 显式命名空间覆盖 `?id=`
  const nsFake = makeFakeStorage()
  run([{ script: S_A_SET }], { apply: { scriptStoreSearch: SEARCH, scriptStoreNamespace: 'mine', scriptStoreBackend: nsFake } })
  check('G2', nsFake.map.has('mpw.mine.sharedKey'), '显式 `scriptStoreNamespace` 决定键前缀', [...nsFake.map.keys()].join(','))
  eq('G2', fake.map.has('mpw.mine.sharedKey'), false, '显式命名空间与 `?id=` 命名空间互不污染')
  // LOCATION_GLOBAL（跨壁纸） vs LOCATION_SCREEN（按壁纸）
  const gFake = makeFakeStorage()
  const gA = { scriptStoreSearch: '?id=AAA&scriptstore=persist', scriptStoreBackend: gFake }
  const gB = { scriptStoreSearch: '?id=BBB&scriptstore=persist', scriptStoreBackend: gFake }
  run([{ script: S_GLOBAL_LS }], { apply: gA })
  eq('G2', val(run([{ script: S_GLOBAL_RD }], { apply: gB }).values[0]), 'G1|null',
    '★ `LOCATION_GLOBAL` 跨壁纸可见、`LOCATION_SCREEN` 不可见')
  check('G2', gFake.map.has('mpw.__global.g') && gFake.map.has('mpw.AAA.s'), 'GLOBAL 落 `mpw.__global.`、SCREEN 落 `mpw.<id>.`',
    [...gFake.map.keys()].join(','))
  eq('G2', LOCATION_SCREEN, 0, '`LOCATION_SCREEN` = 0'); eq('G2', LOCATION_GLOBAL, 1, '`LOCATION_GLOBAL` = 1')
  eq('G2', SCRIPT_STORE_GLOBAL_NS, '__global', 'GLOBAL 命名空间段 = `__global`')
  // API 面（门面成员逐个到位；`key/keys/length` 给的是**去掉前缀**的键）
  const apiFake = makeFakeStorage()
  const apiOut = val(run([{ script: S_API }], { apply: { scriptStoreSearch: SEARCH, scriptStoreBackend: apiFake } }).values[0])
  eq('G2', apiOut, 'function|function|function|function|k0:string|keys:one,two|number|0|1',
    'API 面：getItem/setItem/removeItem/delete/key/keys/length/LOCATION_* 逐个到位')
  check('G2', !apiOut.includes('mpw.'), '`key()/keys()` 返回的是**去掉前缀**的键（脚本看不见我们的前缀）')
  // clear() 只清本命名空间 —— 绝不碰宿主的键
  const hostFake = makeFakeStorage()
  hostFake.map.set('mpw-props:3326873240', '{"a":1}')       // 宿主自己的键（demo.html 的属性面板）
  hostFake.map.set('mpw-ls-lru', '{}')                      // 宿主自己的键
  hostFake.map.set('unrelated', 'keepme')                   // 别人的键
  hostFake.map.set('mpw.3554161528.other', 'otherwallpaper')// 另一张壁纸的键
  const clr = run([{ script: S_CLEAR }], { apply: { scriptStoreSearch: SEARCH, scriptStoreBackend: hostFake } })
  check('G2', clr.errs.length === 0, '`clear()` 不报错')
  check('G2', hostFake.map.get('mpw-props:3326873240') === '{"a":1}' && hostFake.map.get('mpw-ls-lru') === '{}'
    && hostFake.map.get('unrelated') === 'keepme' && hostFake.map.get('mpw.3554161528.other') === 'otherwallpaper',
  '★ `clear()` **只清本命名空间**：宿主键 / 别人的键 / 另一张壁纸的键**逐字不动**',
  [...hostFake.map.keys()].join(','))
  eq('G2', [...hostFake.map.keys()].filter((k) => k.startsWith('mpw.3326873240.')).length, 0, '本命名空间的键被清光')
  // 全局路径：只用 `location.search` + `window.localStorage`（宿主一行都不用改）
  const gFake2 = makeFakeStorage()
  setGlobal('location', { search: '?id=3326873240&scriptstore=persist' })
  setGlobal('localStorage', gFake2)
  run([{ script: S_A_SET }], {})           // 不传任何 P-153 选项 ⇒ 走 `location.search`
  check('G2', gFake2.map.has('mpw.3326873240.sharedKey'), '★ 只靠 `location.search` + `window.localStorage` 就能持久（宿主零改动）',
    [...gFake2.map.keys()].join(','))
  restoreGlobals()
  // 同一容器只建一个 store（同一壁纸全部脚本共享一份）
  const quiet = { scriptStoreBackend: makeFakeStorage(), onScriptStoreWarn: () => {} }
  const c = createScriptCache()
  check('G2', scriptStoreFor(c, Object.assign({}, quiet, PERSIST)) === scriptStoreFor(c, Object.assign({}, quiet, PERSIST)),
    '同一 cache 容器 ⇒ 同一个 store（共享一份）')
  check('G2', scriptStoreFor(createScriptCache(), Object.assign({}, quiet, PERSIST))
    !== scriptStoreFor(createScriptCache(), Object.assign({}, quiet, PERSIST)),
  '不同 cache 容器 ⇒ 不同 store（换壁纸不串）')
  check('G2', scriptStoreFor(createScriptCache(), LEGACY) === null, 'legacy 档解析结果恒为 null')
  persists = fake.calls.setItem
}

// ───────────────────────── G2r 真语料真代码 ─────────────────────────
console.log('\n[G2r] 真语料 `dd/3326873240`：作者脚本自己写、另一份（模拟刷新）读')
let G2R_OK = false
{
  const pkg = path.join(MPW_WS, 'allwallpaper', 'dd', '3326873240', 'scene.pkg')
  if (!fs.existsSync(pkg)) {
    skip++; console.log('  ⤵ SKIP [G2r] 缺真包 ' + pkg + '（语料缺失 ⇒ 本组不计入判定）')
  } else {
    const sceneJson = readPkgJson(pkg, 'scene.json')
    const SRC_DRAG = sceneJson.objects[8].origin.script     // 生产/消费同一份：cursorUp 写 storedPosRoundMIC，init 读
    const SRC_TOGGLE = sceneJson.objects[21].scale.script   // 生产：cursorClick 写 miDragable
    const AUTHORED = '100.000000 200.000000 0.000000'
    const writer = (apply) => run([
      { id: 21, script: SRC_TOGGLE, value: '', origin: AUTHORED },
      { id: 8, script: SRC_DRAG, value: '', origin: AUTHORED },
    ], { apply })
    // "重开壁纸"：全新 cache（内存空）+ 作者层的 authored origin 与写盘时**不同**（否则读回 authored 也"看着对"）
    const reload = (apply) => run([{ id: 8, script: SRC_DRAG, value: '', origin: '0.000000 0.000000 0.000000' }], { apply })
    // ① legacy：作者脚本照写，消费者读不到 ⇒ 回退 `scriptProperties.isMovable`(=false)、origin 保持 authored
    {
      const w = writer(LEGACY)
      dispatchScriptEvent(w.cache, 'cursorClick', {})
      dispatchScriptEvent(w.cache, 'cursorUp', {})
      check('G2r', w.errs.length === 0, 'legacy：真作者脚本跑通', w.errs.join(';') || 'errors=0')
      const r = reload(LEGACY)
      eq('G2r', val(r.shared.miDragable), 'false', 'legacy：`shared.miDragable` 读不到 ⇒ 回退 `scriptProperties.isMovable`=false')
      eq('G2r', val(r.values[0]), '0.000000 0.000000 0.000000', 'legacy：刷新后拖拽位置**复位**（读到 null ⇒ authored origin）')
    }
    // ② persist：同一后端 + 新 cache（模拟刷新）⇒ 两个值都读回来
    {
      const fake = makeFakeStorage()
      const apply = { scriptStoreBackend: fake, scriptStoreSearch: '?id=3326873240&scriptstore=persist' }
      const w = writer(apply)
      dispatchScriptEvent(w.cache, 'cursorClick', {})
      dispatchScriptEvent(w.cache, 'cursorUp', {})
      check('G2r', w.errs.length === 0, 'persist：真作者脚本跑通', w.errs.join(';') || 'errors=0')
      check('G2r', fake.map.has('mpw.3326873240.miDragable') && fake.map.has('mpw.3326873240.storedPosRoundMIC'),
        'persist：真作者脚本落下的两个键', [...fake.map.keys()].join(','))
      const r = reload(apply)
      eq('G2r', val(r.shared.miDragable), 'true', '★ persist：`shared.miDragable` 读到生产者写的 true（同壁纸共享）')
      eq('G2r', val(r.values[0]), AUTHORED, '★ persist：刷新后拖拽位置**还在**（`storedPosRoundMIC` round-trip）')
      G2R_OK = true
    }
  }
}

// ───────────────────────── G3 异常兜底 ─────────────────────────
console.log('\n[G3] 异常兜底：配额 / 隐私模式 / 不透明源 ⇒ 绝不崩、退回内存、恰好一行 warn')
{
  // ① setItem 抛（配额）。同一 cache = 同一 store ⇒ 才谈得上"退回内存后同会话仍共享"
  const quota = makeFakeStorage('setItem')
  const warns = []
  const cq = createScriptCache()
  const applyQ = { scriptStoreSearch: SEARCH, scriptStoreBackend: quota, onScriptStoreWarn: (m) => warns.push(String(m)) }
  const w = run([{ script: S_A_SET }], { apply: applyQ, cache: cq })
  check('G3', w.errs.length === 0, '★ `setItem` 抛配额 ⇒ 脚本**不报错**（onError 调用 0 次）', w.errs.join(';') || 'errors=0')
  eq('G3', val(run([{ script: S_B_GET }], { apply: applyQ, cache: cq }).values[0]), 'fromA',
    '★ 退回内存：同一张壁纸的另一个脚本仍读到 A 写的值')
  eq('G3', warns.length, 1, '★ **恰好 1 行 warn**', warns[0] || '（无）')
  check('G3', /P-153/.test(warns[0] || '') && /退回内存/.test(warns[0] || '') && /QuotaExceededError/.test(warns[0] || ''),
    'warn 文案含 P-153 / 退回内存 / 真实异常名')
  const w2 = run([{ script: S_A_SET2 }], { apply: applyQ, cache: cq })   // 新沙箱（新源码）、同 store
  check('G3', w2.errs.length === 0, '配额之后继续跑同一壁纸的其它脚本仍不报错')
  eq('G3', warns.length, 1, '不再重复告警（仍 1 行）')
  eq('G3', quota.calls.setItem, 1, '降级后不再重试后端写（`setItem` 只被调用过 1 次）')
  eq('G3', val(run([{ script: S_A_SET3 }], { apply: applyQ, cache: cq }).values[0]), 'A3', '降级后写入照样成功（纯内存）')
  eq('G3', quota.calls.setItem, 1, '第三次写入也没再碰后端（降级是"整会话"的，不是逐次重试）')

  // ② getItem 抛（不透明源）
  const opaque = makeFakeStorage('getItem')
  const w3 = []
  const co = createScriptCache()
  const applyO = { scriptStoreSearch: SEARCH, scriptStoreBackend: opaque, onScriptStoreWarn: (m) => w3.push(String(m)) }
  const o = run([{ script: S_B_GET }], { apply: applyO, cache: co })
  check('G3', o.errs.length === 0, '`getItem` 抛 ⇒ 脚本不报错')
  eq('G3', val(o.values[0]), 'NULL', '`getItem` 抛 ⇒ 读回 null（不崩）')
  eq('G3', w3.length, 1, '`getItem` 抛 ⇒ 恰好 1 行 warn')
  eq('G3', val(run([{ script: S_A_SET }], { apply: applyO, cache: co }).values[0]), 'A', '读抛 ⇒ 整会话退化内存后仍可写')

  // ③ 访问 `localStorage` 属性即抛（不透明源 / Safari 隐私模式）
  setThrowingLocalStorage()
  const w4 = []
  const cp = createScriptCache()
  const applyP = { scriptStoreSearch: SEARCH, onScriptStoreWarn: (m) => w4.push(String(m)) }
  const p = run([{ script: S_A_SET }], { apply: applyP, cache: cp })
  check('G3', p.errs.length === 0, '★ 访问 `localStorage` 即抛（不透明源）⇒ 脚本不报错')
  eq('G3', val(run([{ script: S_B_GET }], { apply: applyP, cache: cp }).values[0]), 'fromA',
    '不透明源下退回内存：同壁纸内仍可跨脚本读写')
  eq('G3', w4.length, 1, '不透明源 ⇒ 恰好 1 行 warn', w4[0] || '（无）')
  restoreGlobals()

  // ④ 完全没有后端（Node / 宿主没给 window.localStorage）
  const w6 = []
  const cn = createScriptCache()
  const n = run([{ script: S_A_SET }], { apply: { scriptStoreSearch: SEARCH, onScriptStoreWarn: (m) => w6.push(String(m)) }, cache: cn })
  check('G3', n.errs.length === 0, '没有 localStorage 后端 ⇒ 脚本不报错（内存档照常跑）')
  eq('G3', w6.length, 1, '没有后端 ⇒ 恰好 1 行 warn', w6[0] || '（无）')

  // ⑤ 默认告警走 console.warn（真宿主路径）
  const realWarn = console.warn
  const seen = []
  console.warn = (...a) => seen.push(a.join(' '))
  try { makeScriptStore({ scriptStoreSearch: SEARCH }) } finally { console.warn = realWarn }
  check('G3', seen.length === 1 && /\[P-153\]/.test(seen[0]), '默认告警真的走 `console.warn`（1 行，含 [P-153]）', seen.join('|'))
  eq('G3', makeScriptStore({ scriptStoreSearch: '' }), null, 'legacy 档**一个 warn 都不产生**（缺省不建后端路径）')
}

// ───────────────────────── G4 语料口径 ─────────────────────────
// （变异子进程跳过本组：它只负责回答"哪一组变红"，而全部变异期望组都在 G0–G3；
//   跳过还能把子进程的内存/耗时压到最低 —— 父进程已跑过这一组。）
/* ②(2026-09-23 语料漂移修复) G4 的**语料自导出基线**：旧写法把数字钉死成"命中包 = 8 / 调用 66 次 /
 *   `resizeScreen` = 0"，今晚新增 `allwallpaper/0923/`（37 个包）后实测 10 包 / 92 次 ⇒ 门禁红在
 *   "语料长了"而不是"实现坏了"。新判据：
 *     · **规模只增不减**：命中包数/调用次数必须 ≥ 下面这份自导出基线（掉下来 = 包没了/扫漏了 ⇒ 红）；
 *     · **逐包语义**（与规模无关）：每个命中包的调用面只有 get/set/remove、每次出现都在 scene.json 里、
 *       `resizeScreen` 的每一次出现都必须有**作者自己的同名定义**（`hostResizeSurface() === 0`）——
 *       即"语料没有在调宿主 API"，这才是原判据（`resizeScreen` 命中共 0）真正想守的东西。
 *   与语料无关的**精确**判据仍在别处：G0–G3 全是合成夹具（假 DOM + 注入 storage 桩）的逐值断言，
 *   G2r 钉真包作者脚本的两档读数差 —— 判据本身的分辨力不依赖本机语料。
 *   基线取法：`P153_CORPUS_UPDATE=1` 时本组会打印可粘贴的一行（见下）。 */
const CORPUS_BASELINE = {
  note: '2026-09-23 全语料（含 0923/）自导出；只增不减。旧写死值：pkgs=8 / occ=66 / resizeScreen 出现=0',
  pkgs: 10, occ: 92,
}
console.log('\n[G4] 语料口径（自导出基线 ' + JSON.stringify(CORPUS_BASELINE) + ' / 只用 get-set-remove / LOCATION_* 宿主面 = 0）')
if (MUTANT_MODE) {
  console.log('  ⤵ SKIP [G4]（变异子进程：本组与任何变异期望组无关）')
} else {
  const corpus = scanCorpus()
  if (!corpus) {
    skip++; console.log('  ⤵ SKIP [G4] 缺语料根 ' + path.join(MPW_WS, 'allwallpaper') + '（不计入判定）')
  } else {
    console.log('    命中包：')
    for (const r of corpus.rows) console.log(`      ${r.id.padEnd(14)} -> ${JSON.stringify(r.calls)}  键样: ${r.keys.slice(0, 4).join(', ') || '—'}`)
    /* `resizeScreen` 的"宿主 API 面" = 调用数 − 同包内作者自己的定义数（作者自己定义了就不需要宿主提供）。
     * 纯函数 ⇒ 判据本身可以拿合成数字证明有分辨力（下面 G4 的第二条）。 */
    const hostResizeSurface = (calls, defs) => Math.max(0, calls - defs)
    // ②(2026-09-23) 用**全部带 scene.json 的容器**的台账（`rsPerFile`），不是 `rows`（见扫描器里的注释）
    const rsEntries = [...(corpus.rsPerFile || new Map())].map(([file, v]) => ({ file, calls: v.calls, defs: v.defs }))
    const rsCalls = rsEntries.reduce((s, r) => s + r.calls, 0)
    const rsDefs = rsEntries.reduce((s, r) => s + r.defs, 0)
    const rsSurface = rsEntries.reduce((s, r) => s + hostResizeSurface(r.calls, r.defs), 0)
    if (process.env.P153_CORPUS_UPDATE) console.log('  [corpus-baseline] ' + JSON.stringify({ pkgs: corpus.rows.length, occ: corpus.rows.reduce((s, r) => s + r.occ, 0), rsCalls, rsDefs }))
    check('G4', corpus.rows.length >= CORPUS_BASELINE.pkgs && corpus.rows.every((r) => r.occ > 0 && /\.(mpkg|pkg)$/.test(r.file)),
      '命中包数 ≥ 基线 ' + CORPUS_BASELINE.pkgs + '（每个命中包都真的带 scene.json 且真出现 localStorage）', `实测 ${corpus.rows.length} 包（基线 ${CORPUS_BASELINE.pkgs}）`)
    check('G4', corpus.rows.reduce((s, r) => s + r.occ, 0) >= CORPUS_BASELINE.occ,
      '`localStorage` 出现次数 ≥ 基线 ' + CORPUS_BASELINE.occ, `实测 ${corpus.rows.reduce((s, r) => s + r.occ, 0)} vs 基线 ${CORPUS_BASELINE.occ}`)
    eq('G4', corpus.allJsonOcc, corpus.rows.reduce((s, r) => s + r.occ, 0), '每一次出现**全部**在 scene.json 里（全部 JSON entry 同数）')
    const methods = new Set(corpus.rows.flatMap((r) => Object.keys(r.calls)))
    eq('G4', [...methods].sort().join(','), 'get,remove,set', '调用面只有 get/set/remove（方案 §5.3；逐包，与语料规模无关）')
    const by = (tail) => corpus.rows.find((r) => r.file.endsWith(tail))
    const canon = (calls) => JSON.stringify(Object.fromEntries(Object.entries(calls || {}).sort()))
    eq('G4', canon(by('/dd/3326873240/scene.pkg') && by('/dd/3326873240/scene.pkg').calls), '{"get":5,"set":5}',
      '`dd/3326873240 -> {set:5,get:5}`')
    eq('G4', canon(by('/dd/3554161528/scene.pkg') && by('/dd/3554161528/scene.pkg').calls), '{"get":2,"remove":1,"set":1}',
      '`dd/3554161528 -> {remove:1,set:1,get:2}`')
    eq('G4', canon(by('/dd/3660962877/scene.pkg') && by('/dd/3660962877/scene.pkg').calls), '{"get":1,"set":1}',
      '`dd/3660962877 -> {get:1,set:1}`')
    eq('G4', corpus.tok.LOCATION_SCREEN.occ, 0, '`LOCATION_SCREEN` 命中共 0')
    eq('G4', corpus.tok.LOCATION_GLOBAL.occ, 0, '`LOCATION_GLOBAL` 命中共 0')
    /* ②(2026-09-23) `resizeScreen`：不再是"出现 0 次"，而是"**宿主 API 面 = 0**" —— 语料里每一次出现
     *   都有同包内作者自己的定义（实测 `0923/3589454154` 的 `export function resizeScreen(size) {}`）。
     *   哪天有包**只调不定义** ⇒ rsSurface > 0 ⇒ 红（那才是"沙箱要补这个全局"的信号）。 */
    check('G4', rsSurface === 0 && rsCalls >= rsDefs,
      '`resizeScreen` 的**宿主 API 面 = 0**（每次出现都有同包内作者定义；只调不定义 ⇒ 红）',
      `出现 ${rsCalls} / 作者定义 ${rsDefs} / 宿主面 ${rsSurface}（语料面：${JSON.stringify(rsEntries.filter((r) => r.calls).map((r) => path.relative(MPW_WS, r.file)))}）`)
    check('G4', hostResizeSurface(0, 0) === 0 && hostResizeSurface(1, 1) === 0 && hostResizeSurface(0, 1) === 0 && hostResizeSurface(1, 0) === 1,
      '`hostResizeSurface()` 本身有分辨力（合成数字：自己定义⇒不算宿主面；只调不定义⇒宿主面 1）',
      JSON.stringify([[0, 0], [1, 1], [0, 1], [1, 0]].map((p) => hostResizeSurface(p[0], p[1]))))
    check('G4', corpus.tok.LOCATION_SCREEN.files.size === 0 && corpus.tok.LOCATION_GLOBAL.files.size === 0,
      '两级位置在语料里**一个包都没用到**（缺省 LOCATION_SCREEN 无回归面）')
  }
}

// ───────────────────────── G5 RED-IF-REVERTED（6 组真变异） ─────────────────────────
console.log('\n[G5] RED-IF-REVERTED：6 组变异（只在 /tmp 副本上做，真树不动），每组必须真的变红')
const MUTANTS = [
  {
    id: 'R1', desc: '默认档改成 persist（缺省也建 store）', expect: 'G1',
    anchor: '  if (!scriptStorePersist(search)) return null;',
    repl: '  // 变异 R1：默认档改成 persist\n  if (false) return null;',
  },
  {
    id: 'R2', desc: '去掉命名空间键前缀（裸键落宿主 storage）', expect: 'G2',
    anchor: "    prefix: SCRIPT_STORE_KEY_PREFIX + namespace + '.',",
    repl: "    prefix: '',",
  },
  {
    id: 'R3', desc: '去掉 try/catch 兜底（后端抛错直接冒泡）', expect: 'G3',
    anchor: '  try { store.backend.setItem(full, raw); return true; }\n  catch (e) { scriptStoreFail(store, e); return false; }',
    repl: '  store.backend.setItem(full, raw); return true;',
  },
  {
    id: 'R4', desc: '忽略 opts.scriptStore（换回逐沙箱 Map）', expect: 'G2',
    anchor: '    localStorage: opts.scriptStore ? makeScriptStoreApi(opts.scriptStore) : (() => {',
    repl: '    localStorage: (() => {',
  },
  {
    id: 'R5', desc: '去掉写穿透（只写内存、不落后端）', expect: 'G2',
    anchor: '  storeBackendWrite(store, full, storeEncode(value));',
    repl: '  /* 变异 R5：不落后端 */',
  },
  {
    id: 'R6', desc: 'clear() 清整个后端（含宿主键）', expect: 'G2',
    anchor: '  for (const k of storeKeys(store, location)) storeRemove(store, k, location);',
    repl: '  try { store.backend.clear(); } catch (e) { scriptStoreFail(store, e); }',
  },
]
if (!RUN_MUTANTS) {
  console.log('  ⤵ SKIP [G5]（--no-mutants / 变异子进程）')
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p153-mut-'))
  try {
    // ① 不用 `fs.cpSync`（本机 Node 24 对它抛 EINVAL）——自己走目录树逐文件复制
    copyTree(path.join(ROOT, 'elysia'), path.join(tmp, 'elysia'))
    const target = path.join(tmp, 'elysia', 'scene-scripts.js')
    const orig = fs.readFileSync(path.join(ROOT, 'elysia', 'scene-scripts.js'), 'utf8')
    for (const m of MUTANTS) {
      const hits = orig.split(m.anchor).length - 1
      check('G5', hits === 1, `${m.id} 锚点在真文件里**唯一**（否则自证不成立）`, `命中 ${hits} 次`)
      if (hits !== 1) continue
      fs.writeFileSync(target, orig.replace(m.anchor, m.repl))
      let out = '', rc = 0
      try {
        out = execFileSync(process.execPath, [path.join(ROOT, 'tests', 'script-storage-test.mjs'), '--no-mutants'], {
          cwd: ROOT, encoding: 'utf8', timeout: 300000,
          // stderr 也收进管道：变异体的 warn 属于"变异后的行为"，不该糊在门禁输出里
          stdio: ['ignore', 'pipe', 'pipe'],
          env: Object.assign({}, process.env, { MPW_P153_MUTANT: m.id, MPW_P153_SCENE_SCRIPTS: target }),
        })
      } catch (e) { rc = e.status == null ? 1 : e.status; out = String(e.stdout || '') + String(e.stderr || '') }
      const red = [...new Set([...out.matchAll(/✗ \[(G\d+r?)\]/g)].map((x) => x[1]))].sort()
      check('G5', rc === 1, `${m.id}（${m.desc}）⇒ 门禁**真的变红**`, `rc=${rc}`)
      check('G5', red.includes(m.expect), `${m.id} 变红组含 ${m.expect}`, `实测变红组 [${red.join(',')}]`)
      if (m.id === 'R1') check('G5', red.includes('G1'), 'R1「默认档改成 persist」让 **legacy 组** 变红（0 次 setItem / 跨沙箱不可见）',
        `实测变红组 [${red.join(',')}]`)
      console.log(`      ${m.id}（${m.desc}）实测变红组 [${red.join(',')}]，子进程 rc=${rc}`)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ───────────────────────── 汇总 ─────────────────────────
console.log(`\nG0-G5：${pass} 通过 / ${fail} 失败${skip ? ` / ${skip} 组 SKIP` : ''}（persist 后端 setItem 实测 ${persists} 次；真语料 ${G2R_OK ? '已跑' : 'SKIP'}）`)
if (fail) {
  console.log('失败项：\n  - ' + fails.join('\n  - '))
  console.log('RED-GROUPS ' + [...redGroups].sort().join(','))
  process.exit(1)
}
console.log('ALL PASS')
if (MUTANT_MODE) console.log('MUTANT ' + process.env.MPW_P153_MUTANT + ' 未变红（变异未生效或被别的断点遮蔽）')

// ───────────────────────── 只读工具：PKG 入口表 + JSON entry / 语料扫描 ─────────────────────────
// （函数声明 ⇒ 提升，可在上面的段落里直接用；`countOcc` 同样写成函数声明，避免 TDZ。）
function countOcc(text, tok) { return text.split(tok).length - 1 }

/** 递归复制一棵目录树（逐文件 `copyFileSync`；不用 `fs.cpSync` —— 本机 Node 24 对它抛 EINVAL）。 */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else fs.copyFileSync(s, d)
  }
}

/** 从 `.pkg`/`.mpkg` 里取一个 JSON entry 的正文（流式：只读文件头 ≤4MiB + seek 单条 entry）。 */
function readPkgJson(file, entryName) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const hl = Math.min(1 << 22, size)
    const head = Buffer.alloc(hl)
    fs.readSync(fd, head, 0, hl, 0)
    const ml = head.readUInt32LE(0)
    if (ml < 1 || ml > 64) throw new Error('不是 PKGV/PKGM 头')
    const cnt = head.readUInt32LE(4 + ml)
    let p = 8 + ml
    const ents = []
    for (let i = 0; i < cnt; i++) {
      if (p + 12 > head.length) throw new Error('entry 表超出头部窗口')
      const nl = head.readUInt32LE(p); p += 4
      const name = head.toString('utf8', p, p + nl); p += nl
      const off = head.readUInt32LE(p); p += 4
      const sz = head.readUInt32LE(p); p += 4
      ents.push({ name, off, size: sz })
    }
    const e = ents.find((x) => x.name === entryName)
    if (!e) throw new Error('没有 entry ' + entryName)
    const b = Buffer.alloc(e.size)
    fs.readSync(fd, b, 0, e.size, p + e.off)
    return JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''))
  } finally { fs.closeSync(fd) }
}

/** 全语料扫描（只读；与方案 §附 A 同口径：entry 表 + 单个 JSON entry，从不整包读入）。 */
function scanCorpus() {
  const roots = [path.join(MPW_WS, 'allwallpaper'), path.join(os.homedir(), '.dsh-mpkg-wallpaper')]
  const files = []
  const walk = (p) => {
    let st; try { st = fs.statSync(p) } catch { return }
    if (st.isFile()) { if (/\.(pkg|mpkg)$/i.test(p)) files.push(p); return }
    let ents = []; try { ents = fs.readdirSync(p) } catch { return }
    for (const e of ents) walk(path.join(p, e))
  }
  for (const r of roots) walk(r)
  if (!files.length) return null
  const TOK = ['localStorage', 'LOCATION_SCREEN', 'LOCATION_GLOBAL', 'resizeScreen']
  const tok = {}; for (const t of TOK) tok[t] = { occ: 0, files: new Set() }
  const rows = []
  let allJsonOcc = 0
  /* ②(2026-09-23) `resizeScreen` 的逐容器台账必须**独立于下面的 `localStorage` 过滤**：
   *   旧写法把它挂在 `rows` 上，而 `rows` 只收"scene.json 里出现 localStorage"的容器 ⇒
   *   `0923/3589454154`（只有作者自写的 `export function resizeScreen(){}`、没有 localStorage）
   *   会整个漏掉，判据变成空转（实测：挂 rows 时读到 0 次，独立台账读到 1 次）。 */
  const rsPerFile = new Map()   // 容器 → { calls, defs }（全部带 scene.json 的容器都记）
  for (const f of files) {
    let fd = -1
    try {
      fd = fs.openSync(f, 'r')
      const size = fs.fstatSync(fd).size
      const hl = Math.min(1 << 22, size)
      const head = Buffer.alloc(hl)
      fs.readSync(fd, head, 0, hl, 0)
      const ml = head.readUInt32LE(0)
      if (ml < 1 || ml > 64) continue
      const cnt = head.readUInt32LE(4 + ml)
      let p = 8 + ml
      const ents = []
      for (let i = 0; i < cnt; i++) {
        if (p + 12 > head.length) throw new Error('entry 表超出头部窗口')
        const nl = head.readUInt32LE(p); p += 4
        const name = head.toString('utf8', p, p + nl); p += nl
        const off = head.readUInt32LE(p); p += 4
        const sz = head.readUInt32LE(p); p += 4
        ents.push({ name, off, size: sz })
      }
      const dataStart = p
      const sceneEnt = ents.find((e) => /^scene\.json$/i.test(e.name))
      if (!sceneEnt) continue                        // 视频容器/壳：与 §5.3 口径一致
      let sceneText = null
      let pkgOcc = 0
      let rsCalls = 0, rsDefs = 0                    // ②(2026-09-23) `resizeScreen`：本容器内的调用/作者定义数
      for (const e of ents) {
        if (!/\.json$/i.test(e.name) || e.size <= 0 || e.size > (8 << 20)) continue
        const b = Buffer.alloc(e.size)
        fs.readSync(fd, b, 0, e.size, dataStart + e.off)
        const t = b.toString('utf8')
        for (const k of TOK) { const c = countOcc(t, k); if (c) { tok[k].occ += c; tok[k].files.add(f) } }
        if (t.includes('resizeScreen')) {
          rsCalls += (t.match(/resizeScreen\s*\(/g) || []).length
          rsDefs += (t.match(/(?:function|const|let|var)\s+resizeScreen\b/g) || []).length
          const acc = rsPerFile.get(f) || { calls: 0, defs: 0 }
          acc.calls += (t.match(/resizeScreen\s*\(/g) || []).length
          acc.defs += (t.match(/(?:function|const|let|var)\s+resizeScreen\b/g) || []).length
          rsPerFile.set(f, acc)
        }
        const o = countOcc(t, 'localStorage')
        pkgOcc += o
        allJsonOcc += o
        if (e === sceneEnt) sceneText = t
      }
      const sceneOcc = sceneText ? countOcc(sceneText, 'localStorage') : 0
      if (!sceneOcc) continue
      const calls = {}
      const keys = []
      for (const m of sceneText.matchAll(/localStorage\.([A-Za-z_$][\w$]*)/g)) calls[m[1]] = (calls[m[1]] || 0) + 1
      for (const m of sceneText.matchAll(/localStorage\.(?:get|set|remove|has|getItem|setItem|removeItem|delete)\(\s*([^,)]{1,40})/g)) {
        const k = m[1].trim(); if (!keys.includes(k)) keys.push(k)
      }
      rows.push({ file: f, id: path.basename(path.dirname(f)), occ: sceneOcc, pkgOcc, calls, keys, rsCalls, rsDefs })
    } catch { /* 单包损坏：跳过（不静默改数字：下面的计数断言会兜住） */ } finally { if (fd >= 0) try { fs.closeSync(fd) } catch { /* ignore */ } }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id))
  return { files: files.length, rows, tok, allJsonOcc, rsPerFile }
}

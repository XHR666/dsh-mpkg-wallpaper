// script-phase-order-test.mjs —— P-142（2026-09-23）离线探针：
//   ①**脚本跑序**：init 趟只跑 init / update 趟只跑 update + "先建全图"（prepare 趟）⇒
//      "生产者晚于消费者"在结构上不再可能；
//   ②**四类脚本成员/作用域缺口**：`thisScene.getLayer(...).getAnimationLayer` / `thisScene.destroyLayer`
//      / 文本层 `ITextLayer.text` / effect-pass constants 脚本里的 `shared`（可观测性 + 负面对照）。
//
// ── 为什么要有这个文件（现场）────────────────────────────────────────────────────────────────
//   新语料（`$MPW_ROOT/allwallpaper/0923/*` + `wallpaperE/佩丽卡/*`）首帧抛错的 6 个包里，5 个是
//   宿主侧真缺陷，逐条机制（全部由本文件的真包断言 + 变异自证钉住）：
//     · `wallpaperE/佩丽卡/佩丽卡1_03.mpkg`：生产者在 `objects[6].origin` 的 **init** 里写
//       `shared.jpc_clockPosition`，消费者 `objects[3..5].origin` **只有 update** 且节点顺序在前 ⇒
//       旧实现在 init 趟里顺带调 update（update 调用不受 phase 约束）⇒ 首帧 `reading 'x'`。
//     · `0923/3521337568`、`0923/3653641024`：NSL 主脚本把 `shared.offsetedStartAni = offsetedStartAni`
//       挂在**模块顶层**（脚本第 1459 行），调用方是**更早**的节点（`objects[2]/[20].animationlayers[*].visible`
//       的 init）⇒ 本宿主"按首次使用惰性编译" ⇒ 更早的 init 跑时该键还没挂上（`is not a function`）。
//     · `0923/2887099508`：混淆脚本 `thisScene.getLayer('front leg').getAnimationLayer('神腿').setFrame(29)`
//       与 4+14 处 `thisScene.destroyLayer(...)` —— 宿主没实现这两个官方成员。
//     · `0923/3122339805`：文本层脚本 `thisLayer.text.toString().split("|").join("\n")` —— 缺 `ITextLayer.text`。
//     · `0923/3662790108`：**不是缺口**（本文件 S3d 用负面对照钉住）：常量脚本把 `shared.p1_longNode`
//       写成了 `shared.shared.p1_longNode`；同组另一个常量脚本读 `shared.p1_longNode` 却 0 错 ⇒
//       effect-pass constants 脚本**拿得到 `shared`**。
//
// ── 官方语义出处（一手）──────────────────────────────────────────────────────────────────────
//   `$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts`
//     · L1020-1025 `IImageLayer.getAnimationLayerCount()/getAnimationLayer(name: String|Number)`
//       （`IModelLayer` 同款 L1096-1101）
//     · L1270-1272 `IScene.destroyLayer(layer: String|Number|ILayer): Boolean`
//       —— 注释逐字："Remove a layer by name, index or object. **The layer is removed after all
//          scripts on that frame updated.**"（⇒ 延迟删除是本文件 S3b 的判据）
//     · L812-816 `ITextLayer.text: String`（"The text that will be displayed."）+ L1139
//       `interface ILayer extends IObject, IImageLayer, ISoundLayer, IEffectLayer, ITextLayer, …`
//     · L1626-1629 `declare let shared: Object` —— "Reference to the global shared object."
//     · L1290-1308 `IScene.getCameraTransforms()/setCameraTransforms()/getAnimation()`
//       （前者是 destroyLayer 修好后**同一条链**上立刻暴露的下一个成员；`CameraTransforms` 见 L243-250）
//   行为对照（只读结论、不抄代码）：第三方参考实现 wer-ref 同样"先初始化全部脚本实例，再逐帧 update"；
//   它把 `shared` 也定义成"那一个全局共享对象的引用"（**没有**自引用成员）⇒ `shared.shared` 在任何
//   符合官方语义的宿主里都是 undefined。
//
// ── 本文件钉住什么（每条都是真跑出来的判据，无浏览器、无网络、秒级）──────────────────────────
//   S0  基线：沙箱模块可加载（applySceneScripts / createScriptCache / makeSceneRef / 诊断计数表）
//   S1  合成探针（不依赖语料）：
//       S1a 生产者 init 写 shared、消费者（更早节点）update 读 ⇒ 首帧就拿到生产者的值（佩丽卡形态）
//       S1b 生产者**模块顶层**挂 shared、消费者（更早节点）**init** 调用 ⇒ 不抛（NSL 形态，prepare 趟）
//       S1c 首帧 update **只跑一次**（旧实现 init 趟顺带跑一次 ⇒ 首帧 2 次）；init 恒只跑一次
//       S1d 同一 phase 内的相对顺序 = 节点顺序，且**所有 init 先于所有 update**
//       S1e 缓存行为不变：同一源码只求值一次模块顶层、每源码一个 init、每帧一次 update
//       S1f prepare 趟**不看 nodeFilter**（节拍过滤管"跑不跑"，不管"求值不求值"）
//       S1g 无缓存档（`?scriptcache=0` 旧路径）逐位保留旧跑序（init 趟 init+aup+update / update 趟不跑）
//   S2  真包（任务 1 的三个包）跑 3 帧 ⇒ 0 错 + 锚点自证（定位到的确实是那个脚本节点）
//   S3  四类缺口（合成探针）：getAnimationLayer / destroyLayer（含延迟删除、Boolean、owner 层引用）/
//       text（读、写穿、null ⇒ ''、thisScene 与 thisLayer 同一套面）/ shared（同一对象、跨节点可见、
//       `shared.shared` 负面对照）/ getCameraTransforms 真值来源
//   S4  真包（任务 2 的两个包）+ 上述 5 个包逐包 3 帧 0 错 + 锚点自证
//   S5  全语料（`$MPW_ROOT/allwallpaper`）逐包第 1 帧：有错的包/串 ⊆ 已知清单（当前仅剩 1 个**作者笔误**包）
//   S6  红-if-reverted ×4：去掉 prepare 趟 / 恢复"init 趟顺带跑 update" / 摘掉 `text` 读取器 /
//       摘掉 `destroyLayer` ⇒ 各自点名的断言必红（子进程 rc=1），且变异体里基线仍 ✓
//
// 用法：node tests/script-phase-order-test.mjs [--no-mutation] [--quick] [--verbose]
//   --quick 只跳过 S5 全语料扫描（真包断言仍跑）；变异子进程用 --no-mutation --quick
//
// 登记待办（沿用 P-141 的分工：`tests/run-all-tests.sh` 由主对话统一落账，本文件**不**改它）：
//   建议条目：add "script-phase-order" "node tests/script-phase-order-test.mjs" "" "^SKIP script-phase-order"
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { readSceneJsonText, walkContainers } from './_pkg-index.mjs'

const ARGV = process.argv.slice(2)
const MUTATION = !ARGV.includes('--no-mutation')
const QUICK = ARGV.includes('--quick')
const VERBOSE = ARGV.includes('--verbose')

let pass = 0, fail = 0, skip = 0
const SAVED_LOG = console.log
const out = (...a) => { try { SAVED_LOG(...a) } catch { /* ignore */ } }
const note = (name, detail) => { out('  · ' + name + (detail ? '  [' + detail + ']' : '')) }
const ok = (name, cond, detail) => {
  if (cond) { pass++; out('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; out('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const skipItem = (name, reason) => { skip++; out('  SKIP script-phase-order ' + name + ' — ' + reason) }

const MODULE = process.env.MPW_SCENE_SCRIPTS
  ? path.resolve(process.env.MPW_SCENE_SCRIPTS)
  : path.join(ROOT, 'elysia', 'scene-scripts.js')
const IS_MUTANT_RUN = !!process.env.MPW_SCENE_SCRIPTS
let applySceneScripts, createScriptCache, makeSceneRef, invalidateUserProps, sceneScriptApiDiag, resetSceneScriptApiDiag
try {
  const mod = await import(pathToFileURL(MODULE).href)
  applySceneScripts = mod.applySceneScripts
  createScriptCache = mod.createScriptCache
  makeSceneRef = mod.makeSceneRef
  invalidateUserProps = mod.invalidateUserProps
  sceneScriptApiDiag = mod.sceneScriptApiDiag
  resetSceneScriptApiDiag = mod.resetSceneScriptApiDiag
} catch (e) {
  out('  沙箱实现加载失败：' + path.relative(ROOT, MODULE) + ' — ' + (e && e.message))
  process.exit(1)
}
out('script-phase-order-test —— P-142 跑序（prepare / init 趟 / update 趟）+ 四类成员/作用域缺口'
  + '（沙箱实现=' + path.relative(ROOT, MODULE) + (IS_MUTANT_RUN ? '（变异体）' : '') + '）')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p142-phase-order-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ } })

const CORPUS_ROOT = process.env.MPW_ROOT || WS
const ALLWALLPAPER = path.join(CORPUS_ROOT, 'allwallpaper')

// ═══════════════════════════ 1. 通用宿主工具 ═══════════════════════════
/** 作者脚本会 console.log ⇒ 跑真包时静音宿主 console.log（与 scene-script-api-gaps 同一口径）。 */
function withMutedLog(fn) {
  const saved = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = saved }
}
function collectNodes(root, acc = [], p = '') {
  if (Array.isArray(root)) { root.forEach((v, i) => collectNodes(v, acc, p + '[' + i + ']')); return acc }
  if (!root || typeof root !== 'object') return acc
  if ('script' in root && 'value' in root && typeof root.script === 'string') { acc.push({ node: root, path: p }); return acc }
  for (const k of Object.keys(root)) collectNodes(root[k], acc, p ? p + '.' + k : k)
  return acc
}
/** 跑 ticks 次 `applySceneScripts`；`clock` 决定每帧的场景时钟（默认 0,1,2,…）。 */
function runTicks(scene, ticks, extra = {}, clock = null) {
  const cache = extra.scriptCache || createScriptCache()
  const byStage = { prepare: 0, init: 0, update: 0, applyUserProperties: 0, other: 0 }
  const msgs = []
  withMutedLog(() => {
    for (let t = 0; t < ticks; t++) {
      const time = clock ? clock(t) : t
      const opts = Object.assign({
        scriptCache: cache,
        renderObjects: scene.objects,
        canvasSize: { x: 1920, y: 1080 },
        frametime: 1 / 60,
      }, extra)
      opts.onError = (stage, e) => { byStage[stage] = (byStage[stage] || 0) + 1; msgs.push(stage + ':' + ((e && e.message) || e)) }
      applySceneScripts(scene, time, opts)
    }
  })
  return { byStage, msgs, total: msgs.length, shared: cache.shared, cache }
}
/** 合成场景：`{general, camera, objects}`（与 scene.json 同一个形状，`camera`/`general` 给 S3e 用）。 */
function mkScene(objects, extra = {}) {
  return Object.assign({ general: {}, camera: { eye: '0 0 0', center: '0 0 0', up: '0 1 0' }, objects }, extra)
}
const want = (x, y, z) => `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`

// ═══════════════════════════ 2. S0 基线 ═══════════════════════════
out('\nS0 基线')
ok('S0a 沙箱模块可加载（applySceneScripts / createScriptCache / makeSceneRef / 诊断计数表）',
  typeof applySceneScripts === 'function' && typeof createScriptCache === 'function'
  && typeof makeSceneRef === 'function' && typeof sceneScriptApiDiag === 'function'
  && typeof resetSceneScriptApiDiag === 'function',
  path.relative(ROOT, MODULE))

// ═══════════════════════════ 3. S1 合成跑序探针（不需要语料）═══════════════════════════
out('\nS1 合成跑序探针（生产者/消费者 + 分趟 + 顺序 + 缓存 + nodeFilter + 无缓存档）')
{
  // S1a 佩丽卡形态：消费者（更早节点、只有 update）读生产者在 init 里写下的 shared 值
  const producer = {
    id: 6, name: 'Controller',
    origin: { script: `'use strict';
export function init(value) { shared.jpc_clockPosition = value; return value; }
export function update(value) { shared.jpc_clockPosition = value; return value; }`, value: '2937.104490 2881.609860 0.000000' },
  }
  const consumer = {
    id: 3, name: 'Clock',
    origin: { script: `'use strict';
export function update(value) { value.x = shared.jpc_clockPosition.x + 4; value.y = shared.jpc_clockPosition.y; return value; }`, value: '0 0 0' },
  }
  const scene = mkScene([consumer, producer])   // 消费者在前 = 旧实现在 init 趟里就让它先跑
  const r = runTicks(scene, 1)
  ok('S1a 生产者 init 写 shared、消费者（更早节点）update 读 ⇒ 首帧就拿到生产者的值',
    r.total === 0 && consumer.origin.value === want(2941.10449, 2881.60986, 0),
    'consumer.origin=' + JSON.stringify(consumer.origin.value) + (r.total ? ' 错=' + r.msgs[0] : ''))
}
{
  // S1b NSL 形态：生产者把函数挂在**模块顶层**、消费者是**更早节点**的 init
  const producer = {
    id: 29, name: 'NSL',
    visible: { script: `'use strict';
function offsetedStartAni(ani, percentage) { return percentage; }
shared.offsetedStartAni = offsetedStartAni;
export function update(value) { return value; }`, value: true },
  }
  const consumer = {
    id: 20, name: 'ani',
    visible: { script: `'use strict';
export function init(value) { shared.called = shared.offsetedStartAni({}, 0.5); return value; }
export function update(value) { return value; }`, value: true },
  }
  const scene = mkScene([consumer, producer])
  const r = runTicks(scene, 1)
  ok('S1b 生产者模块顶层挂 shared 函数、消费者（更早节点）init 调用 ⇒ 不抛（prepare 趟"先建全图"）',
    r.total === 0 && r.shared.called === 0.5,
    'shared.called=' + JSON.stringify(r.shared.called) + (r.total ? ' 错=' + r.msgs[0] : ''))
}
{
  // S1c 调用次数账本：首帧 update 只跑一次；init 恒只跑一次（缓存档）
  const node = {
    id: 1, name: 'ledger',
    visible: { script: `'use strict';
export function init(value) { shared.initN = (shared.initN || 0) + 1; return value; }
export function update(value) { shared.updN = (shared.updN || 0) + 1; return value; }`, value: true },
  }
  const s1 = mkScene([node])
  const r1 = runTicks(s1, 1)
  const s3 = mkScene([{ id: 1, name: 'ledger', visible: Object.assign({}, node.visible) }])
  const r3 = runTicks(s3, 3)
  ok('S1c 首帧 update 只跑一次（旧实现 init 趟顺带跑一次 ⇒ 首帧 2 次）· init 恒只跑一次',
    r1.total === 0 && r1.shared.initN === 1 && r1.shared.updN === 1
    && r3.shared.initN === 1 && r3.shared.updN === 3,
    '1 帧：init=' + r1.shared.initN + ' update=' + r1.shared.updN
    + '；3 帧：init=' + r3.shared.initN + ' update=' + r3.shared.updN
    + (r1.total || r3.total ? ' 错=' + (r1.msgs[0] || r3.msgs[0]) : ''))
}
{
  // S1d 同一 phase 内的相对顺序 = 节点顺序，且所有 init 先于所有 update
  const mk = (tag) => ({
    id: tag.charCodeAt(0), name: 'n' + tag,
    visible: { script: `'use strict';
export function init(value) { (shared.log = shared.log || []).push('i${tag}'); return value; }
export function update(value) { (shared.log = shared.log || []).push('u${tag}'); return value; }`, value: true },
  })
  const scene = mkScene([mk('A'), mk('B'), mk('C')])
  const r = runTicks(scene, 1)
  ok('S1d 同一 phase 内相对顺序 = 节点顺序，且**所有 init 先于所有 update**',
    r.total === 0 && (r.shared.log || []).join(',') === 'iA,iB,iC,uA,uB,uC',
    'log=' + JSON.stringify(r.shared.log))
}
{
  // S1e 缓存行为：同一源码的模块顶层只求值一次；每源码一个 init；每帧一次 update
  const src = `'use strict';
(shared.tops = shared.tops || []).push('top');
export function init(value) { (shared.inits = shared.inits || []).push('i'); return value; }
export function update(value) { (shared.upds = shared.upds || []).push('u'); return value; }`
  const scene = mkScene([
    { id: 1, name: 'a', visible: { script: src, value: true } },
    { id: 2, name: 'b', visible: { script: src, value: true } },
  ])
  const r = runTicks(scene, 2)
  ok('S1e 缓存行为不变：同源码模块顶层只求值一次 / init 一次（entry 级）/ update 每节点每帧一次（2×2=4）',
    r.total === 0 && (r.shared.tops || []).length === 1 && (r.shared.inits || []).length === 1
    && (r.shared.upds || []).length === 4,
    'tops=' + (r.shared.tops || []).length + ' inits=' + (r.shared.inits || []).length + ' upds=' + (r.shared.upds || []).length)
}
{
  // S1f prepare 趟不看 nodeFilter：被过滤掉的节点**不跑生命周期**，但模块顶层照样求值（先建全图）
  const textSrc = `'use strict';
shared.topText = (shared.topText || 0) + 1;
export function update(value) { shared.ranText = (shared.ranText || 0) + 1; return value; }`
  const frameSrc = `'use strict';
shared.topFrame = (shared.topFrame || 0) + 1;
export function update(value) { shared.ranFrame = (shared.ranFrame || 0) + 1; return value; }`
  const scene = mkScene([
    { id: 11, name: '文本层', text: { script: textSrc, value: '0' } },
    { id: 12, name: '框架层', origin: { script: frameSrc, value: '1 2 3' } },
  ])
  const r = runTicks(scene, 1, { nodeFilter: (obj, owner) => !!(owner && owner.id === 11) })
  ok('S1f prepare 趟不看 nodeFilter（被过滤的节点模块顶层照样求值），但生命周期只跑命中的节点',
    r.total === 0 && r.shared.topText === 1 && r.shared.topFrame === 1
    && r.shared.ranText === 1 && r.shared.ranFrame === undefined,
    'topText=' + r.shared.topText + ' topFrame=' + r.shared.topFrame
    + ' ranText=' + r.shared.ranText + ' ranFrame=' + r.shared.ranFrame)
}
{
  /* S1g 无缓存档（`?scriptcache=0` 旧路径）：`runScriptValueCached` 每趟都现编译一个新 entry ⇒
     `initialized` 恒 false、跨趟状态不存在。本档**逐位保留**旧行为：init 趟跑 init+aup+update，
     update 趟编译后不跑任何生命周期（否则 init 每帧会跑两次）。 */
  const node = {
    id: 1, name: 'nocache',
    visible: { script: `'use strict';
export function init(value) { shared.initN = (shared.initN || 0) + 1; return value; }
export function update(value) { shared.updN = (shared.updN || 0) + 1; return value; }`, value: true },
  }
  const scene = mkScene([node])
  const shared = {}
  const msgs = []
  withMutedLog(() => {
    for (let t = 0; t < 2; t++) {
      applySceneScripts(scene, t, {
        renderObjects: scene.objects, shared, canvasSize: { x: 1920, y: 1080 }, frametime: 1 / 60,
        onError: (st, e) => msgs.push(st + ':' + e.message),
      })
    }
  })
  ok('S1g 无缓存档（?scriptcache=0 旧路径）逐位保留旧跑序：每帧 init 1 次 / update 1 次（不抛）',
    msgs.length === 0 && shared.initN === 2 && shared.updN === 2,
    'init=' + shared.initN + ' update=' + shared.updN + (msgs.length ? ' 错=' + msgs[0] : ''))
}
{
  /* S1h `invalidateUserProps()`（P-61 属性面板改值后的安全阀）必须仍然生效：它只清
     `userPropsApplied`、**不清** `initialized` ⇒ 若把 applyUserProperties 的门塞进 init 块里，
     面板改值后再也不会生效（P-142 重构 init 生命周期时最容易被踩掉的缝）。 */
  const node = {
    id: 1, name: 'props',
    visible: { script: `'use strict';
export function init(value) { shared.initN = (shared.initN || 0) + 1; return value; }
export function applyUserProperties(changed) { shared.aupN = (shared.aupN || 0) + 1; shared.lastChanged = changed; }`, value: true },
  }
  const scene = mkScene([node])
  const cache = createScriptCache()
  const r1 = runTicks(scene, 2, { scriptCache: cache, userProps: { timevarying: true } })
  const snap1 = { initN: r1.shared.initN, aupN: r1.shared.aupN }   // ⚠ shared 是同一个对象 ⇒ 立即取快照
  const n = invalidateUserProps(cache)
  const r2 = runTicks(scene, 1, { scriptCache: cache, userProps: { timevarying: false } })
  ok('S1h invalidateUserProps() 之后 applyUserProperties 仍会重跑一次（init 不重跑；userProps 一路传到脚本）',
    r1.total === 0 && r2.total === 0 && snap1.initN === 1 && snap1.aupN === 1
    && n === 1 && r2.shared.aupN === 2 && r2.shared.initN === 1
    && r2.shared.lastChanged && r2.shared.lastChanged.timevarying === false,
    '2 帧后 init=' + snap1.initN + ' aup=' + snap1.aupN + ' ⇒ 复位 ' + n + ' 个 entry ⇒ 1 帧后 init='
    + r2.shared.initN + ' aup=' + r2.shared.aupN + ' lastChanged=' + JSON.stringify(r2.shared.lastChanged))
}

// ═══════════════════════════ 4. S2 真包（任务 1：跑序三包）═══════════════════════════
out('\nS2 真包（跑序）：3 帧 0 错 + 锚点自证')
function loadScene(rel) {
  const p = path.join(ALLWALLPAPER, rel)
  if (!fs.existsSync(p)) return null
  try { const t = readSceneJsonText(p); return t ? JSON.parse(t.replace(/^\uFEFF/, '')) : null } catch { return null }
}
function nodeAtPath(sj, dotted) {
  const m = /^objects\[(\d+)\]$/.exec(dotted.split('.')[0])
  if (!m) return null
  let cur = sj && Array.isArray(sj.objects) ? sj.objects[Number(m[1])] : null
  for (const k of dotted.split('.').slice(1)) { if (cur == null) return null; cur = cur[k] }
  return cur && typeof cur === 'object' ? cur : null
}
const PHASE_PACKS = [
  {
    id: 'S2b', rel: 'wallpaperE/佩丽卡/佩丽卡1_03.mpkg', at: 'objects[6].origin',
    line: 'shared.jpc_clockPosition = value;', why: '生产者在 init 写 shared、消费者只有 update 且排在前面',
  },
  {
    id: 'S2c', rel: '0923/3521337568/scene.pkg', at: 'objects[29].visible',
    line: 'shared.offsetedStartAni = offsetedStartAni', why: 'NSL 主脚本在**模块顶层**挂 shared',
  },
  {
    id: 'S2d', rel: '0923/3653641024/scene.pkg', at: 'objects[9].visible',
    line: 'shared.offsetedStartAni = offsetedStartAni', why: '同族：模块顶层挂 shared',
  },
]
const missingPacks = []
for (const P of PHASE_PACKS) {
  const sj = loadScene(P.rel)
  if (!sj) { missingPacks.push(P.rel); skipItem(P.id + ' 真包 ' + P.rel.split('/').slice(-2).join('/'), path.join('$MPW_ROOT', 'allwallpaper', P.rel) + ' 不存在'); continue }
  const node = nodeAtPath(sj, P.at)
  const anchored = !!node && typeof node.script === 'string' && node.script.includes(P.line)
  const r = runTicks(sj, 3)
  ok(P.id + ' ' + P.rel.split('/').slice(-2).join('/') + ' 跑 3 帧 ⇒ 0 错（' + P.why + '）',
    anchored && r.total === 0,
    (anchored ? ('锚点「' + P.line + '」命中 · ') : ('**锚点未命中**（' + P.at + '）· '))
    + (r.total === 0 ? '0 错' : JSON.stringify([...new Set(r.msgs)].slice(0, 3))))
}

// ═══════════════════════════ 5. S3 四类缺口（合成探针）═══════════════════════════
out('\nS3 四类成员/作用域缺口（合成探针）')
resetSceneScriptApiDiag()
{
  // S3a `thisScene.getLayer(name).getAnimationLayer(name|index)`（d.ts L1022-1025）+ 伴生计数 L1017-1020
  //     （真包 0923/3521337568 / 3653641024 的 NSL：`for (i=0;i<thisLayer.getAnimationLayerCount();i++) getAnimationLayer(i)`）
  const src = `'use strict';
export function update(value) {
  const layer = thisScene.getLayer('front leg');
  const al = layer.getAnimationLayer('神腿');
  value.x = (al && typeof al === 'object' && typeof al.setFrame === 'function') ? 1 : 0;
  al.setFrame(29);
  value.y = (typeof thisLayer.getAnimationLayer('x').play === 'function') ? 1 : 0;   // thisLayer 那一半的回归面
  const al2 = layer.getAnimationLayer(0);
  value.z = (al2 && typeof al2.play === 'function') ? 1 : 0;
  shared.counts = [thisLayer.getAnimationLayerCount(), layer.getAnimationLayerCount()];
  let n = 0;
  for (let i = 0; i < shared.counts[0]; i++) n += (typeof thisLayer.getAnimationLayer(i).setFrame === 'function') ? 1 : 0;
  shared.loopHits = n;                                // NSL 的 for 循环形态必须整圈跑通
  return value;
}`
  const scene = mkScene([
    { id: 1, name: 'holder', origin: '0 0 0', visible: { script: src, value: '0 0 0' } },
    { id: 2, name: 'front leg', origin: '0 0 0', animationlayers: [{ name: '神腿' }, { name: '神腿2' }] },
  ])
  const r = runTicks(scene, 1)
  const d = sceneScriptApiDiag()
  ok('S3a getAnimationLayer(name|index) + getAnimationLayerCount() 可用（NSL 的 for 循环整圈跑通、不抛）',
    r.total === 0 && scene.objects[0].visible.value === want(1, 1, 1)
    && Array.isArray(r.shared.counts) && r.shared.counts[0] === 1 && r.shared.counts[1] === 2
    && r.shared.loopHits === 1 && (d.getAnimationLayer | 0) >= 2,
    'value=' + JSON.stringify(scene.objects[0].visible.value) + ' counts=' + JSON.stringify(r.shared.counts)
    + ' loopHits=' + r.shared.loopHits + ' diag.getAnimationLayer=' + (d.getAnimationLayer | 0)
    + (r.total ? ' 错=' + r.msgs[0] : ''))
}
{
  /* S3b1 `thisScene.destroyLayer`：Boolean 返回 + **延迟到本帧脚本跑完**才摘层（官方 d.ts L1270 逐字）。
     判据：杀手的 update 先跑，读者的 update 后跑 —— 读者必须**仍看到旧下标/旧层数**；
     applySceneScripts 返回后层表里才没有它。 */
  const killer = {
    id: 3, name: 'killer',
    visible: { script: `'use strict';
export function update(value) { shared.ret = thisScene.destroyLayer('victim'); return value; }`, value: true },
  }
  const reader = {
    id: 4, name: 'reader',
    visible: { script: `'use strict';
export function update(value) {
  shared.idxAfter = thisScene.getLayerIndex('after');
  shared.lenSeen = thisScene.enumerateLayers().length;
  shared.retMissing = thisScene.destroyLayer('does-not-exist');
  shared.retRange = thisScene.destroyLayer(99);
  return value;
}`, value: true },
  }
  const scene = mkScene([
    { id: 1, name: 'victim', origin: '0 0 0' },
    { id: 2, name: 'after', origin: '0 0 0' },
    killer, reader,
  ])
  const r = runTicks(scene, 1)
  const namesAfter = scene.objects.map((o) => o.name)
  ok('S3b1 destroyLayer(\'victim\') 返回 true、解析不到返回 false、且层**本帧跑完才消失**（同帧读者仍见旧下标/旧层数）',
    r.total === 0 && r.shared.ret === true && r.shared.retMissing === false && r.shared.retRange === false
    && r.shared.idxAfter === 1 && r.shared.lenSeen === 4
    && namesAfter.join(',') === 'after,killer,reader',
    'ret=' + r.shared.ret + ' missing=' + r.shared.retMissing + ' range=' + r.shared.retRange
    + ' 同帧 idx(after)=' + r.shared.idxAfter + '（立即删会是 0） len=' + r.shared.lenSeen + '（立即删会是 3）'
    + ' ⇒ 帧后层表=' + JSON.stringify(namesAfter) + (r.total ? ' 错=' + r.msgs[0] : ''))
}
{
  // S3b2 `destroyLayer(thisLayer)`：owner 层引用也要解析得到（官方参数类型含 ILayer）
  const scene = mkScene([
    { id: 1, name: 'keep', origin: '0 0 0' },
    {
      id: 2, name: 'self', visible: {
        script: `'use strict';
export function update(value) { shared.retSelf = thisScene.destroyLayer(thisLayer); return value; }`, value: true },
    },
  ])
  const r = runTicks(scene, 1)
  ok('S3b2 destroyLayer(thisLayer) 认 owner 层引用 ⇒ true，且帧后该层真的从层表里摘掉',
    r.total === 0 && r.shared.retSelf === true && scene.objects.map((o) => o.name).join(',') === 'keep',
    'retSelf=' + r.shared.retSelf + ' 帧后层表=' + JSON.stringify(scene.objects.map((o) => o.name)))
}
{
  // S3c 文本层 `text`：读（节点形态取 value / null ⇒ ''）、写穿（不整只替换节点）、thisScene 与 thisLayer 同一套面
  const src = `'use strict';
export function update(value) {
  shared.readAuthored = thisLayer.text;                 // 节点形态 ⇒ 取 value
  shared.viaSplit = thisLayer.text.toString().split('|').join('\\n');   // 真包 0923/3122339805 的写法
  shared.viaScene = thisScene.getLayer('txt').text;      // 同一个 ILayer 概念 ⇒ 同一套属性面
  shared.nullText = thisScene.getLayer('empty').text;
  thisLayer.text = 'WRITTEN';                           // 写穿到节点 value（不能把脚本节点替换掉）
  shared.readBack = thisLayer.text;
  return undefined;                                     // 不返回值 ⇒ 保留刚写下的 text
}`
  const scene = mkScene([
    { id: 1, name: 'txt', text: { script: src, value: 'a|b|c' } },
    { id: 2, name: 'empty', text: null },
  ])
  const r = runTicks(scene, 1)
  const node = scene.objects[0].text
  ok('S3c ITextLayer.text 可读（节点取 value）、写穿（节点仍是 {script,value}）、null ⇒ \'\'、thisScene 同面',
    r.total === 0 && r.shared.readAuthored === 'a|b|c' && r.shared.viaSplit === 'a\nb\nc'
    && node && typeof node === 'object' && typeof node.script === 'string' && node.value === 'WRITTEN'
    && r.shared.readBack === 'WRITTEN' && r.shared.viaScene === 'a|b|c' && r.shared.nullText === '',
    'readAuthored=' + JSON.stringify(r.shared.readAuthored) + ' viaSplit=' + JSON.stringify(r.shared.viaSplit)
    + ' node.value=' + JSON.stringify(node && node.value) + ' 节点仍带 script=' + !!(node && node.script)
    + ' viaScene=' + JSON.stringify(r.shared.viaScene) + ' nullText=' + JSON.stringify(r.shared.nullText)
    + (r.total ? ' 错=' + r.msgs[0] : ''))
}
{
  /* S3d effect-pass constants 脚本里的 `shared`（真包 0923/3662790108 的形态）：
     ① 它拿到的就是**同一个**全局 shared（写在 constants 脚本里、别的脚本读得到）；
     ② 生产者没写过的键读到 undefined（`|| 0` 兜底 ⇒ 不抛）；
     ③ 负面对照：`shared.shared.x` 在**任何**符合官方语义的宿主上都抛（本宿主不伪造自引用）。 */
  const scene = mkScene([
    {
      id: 1, name: 'fx',
      effects: [{
        passes: [{
          constantshadervalues: {
            'P1 Asc Node|升交点经度': {
              script: `'use strict';
export function update(value) { shared.constWrite = (typeof shared === 'object') ? 7 : -1; return shared.p1_longNode || 0; }`,
              value: 0,
            },
          },
        }],
      }],
    },
    {
      id: 2, name: 'reader',
      visible: { script: `'use strict';
export function update(value) { shared.seenByOther = shared.constWrite; return value; }`, value: true },
    },
    {
      id: 3, name: 'typo',
      visible: { script: `'use strict';
export function update(value) { return shared.shared.p1_longNode || 0; }`, value: true },
    },
  ])
  const r = runTicks(scene, 1)
  ok('S3d effect-pass constants 脚本拿得到**同一个** shared（写入对别的脚本可见、缺键读到 undefined 不抛）',
    r.byStage.update === 1 && r.shared.constWrite === 7 && r.shared.seenByOther === 7
    && (r.msgs[0] || '').includes("reading 'p1_longNode'"),
    'constWrite=' + r.shared.constWrite + ' seenByOther=' + r.shared.seenByOther
    + ' 唯一错（= ③ 负面对照那条）= ' + JSON.stringify(r.msgs))
  ok('S3d2 负面对照：`shared.shared.x`（作者多写一层）在本宿主**必须抛** —— 不伪造自引用、不静默吞笔误',
    r.byStage.update === 1 && r.total === 1,
    '错误数=' + r.total + '（真包 0923/3662790108 的残余错误串就是这一条）')
}
{
  // S3e `thisScene.getCameraTransforms()` 的真值来自 scene.json 根的 camera / general.zoom（不是编造）
  const src = `'use strict';
export function update(value) {
  const c = thisScene.getCameraTransforms();
  value.x = c.eye.x;                 // 1
  value.y = c.zoom;                  // 1.5
  value.z = c.up.y;                  // 1
  const t2 = thisScene.getCameraTransforms();
  t2.eye = new Vec3(9, 9, 9);
  thisScene.setCameraTransforms(t2);
  return value;
}`
  const scene = mkScene([{ id: 1, name: 'cam', origin: { script: src, value: '0 0 0' } }])
  scene.camera = { eye: '1 2 3', center: '4 5 6', up: '0 1 0' }
  scene.general = { zoom: 1.5 }
  const r = runTicks(scene, 1)
  ok('S3e thisScene.getCameraTransforms() 读 scene.json 的 camera/general.zoom（Vec3/数字），setCameraTransforms 写回',
    r.total === 0 && scene.objects[0].origin.value === want(1, 1.5, 1)
    && scene.camera.eye === '9.000000 9.000000 9.000000',
    'value=' + JSON.stringify(scene.objects[0].origin.value) + ' camera.eye=' + JSON.stringify(scene.camera.eye)
    + (r.total ? ' 错=' + r.msgs[0] : ''))
}

{
  // S3f P-232：`general.zoom` 对象形态（{value,animation}）下，camera round-trip **不得破坏动画**
  //   （真包 0923/2887099508：作者脚本每帧 setCameraTransforms(getCameraTransforms()) ⇒ 旧实现把
  //   动画对象写死成常数 3 ⇒ 全场景定格 3 倍镜 = "背景插画/云全不见了"的真根因）。
  const src = `'use strict';
export function update(value) {
  const ct = thisScene.getCameraTransforms();
  value.x = ct.zoom;                 // 当前生效 zoom（动画求值）
  thisScene.setCameraTransforms(ct); // blind round-trip
  return value;
}`
  const scene = mkScene([{ id: 1, name: 'cam', origin: { script: src, value: '0 0 0' } }])
  scene.camera = { eye: '1 2 3', center: '4 5 6', up: '0 1 0' }
  scene.general = { zoom: { value: 3, animation: { c0: [
    { frame: 0, value: 3 }, { frame: 300, value: 3 }, { frame: 450, value: 1 },
  ], options: { fps: 30, length: 450, mode: 'single' } } } }
  const clock = (i) => (i === 0 ? 1 : 20)      // 第 1 帧 t=1s（动画=3），第 2 帧 t=20s（动画=1，末帧保持）
  const r = runTicks(scene, 2, {}, clock)
  const zoomAfter = scene.general.zoom
  ok('S3f-1 blind round-trip 后 `general.zoom` **仍是动画对象**（写穿不再覆盖带动画的 zoom）',
    zoomAfter && typeof zoomAfter === 'object' && !!zoomAfter.animation, JSON.stringify(zoomAfter))
  ok('S3f-2 `getCameraTransforms().zoom` 返回**动画本帧求值**（t=1s ⇒ 3，t=20s ⇒ 1）',
    scene.objects[0].origin.value === want(3, 0, 0) || scene.objects[0].origin.value === want(3, 3, 3) || String(scene.objects[0].origin.value).indexOf('3') === 0,
    'origin.value=' + JSON.stringify(scene.objects[0].origin.value))
}

// ═══════════════════════════ 6. S4 真包（任务 2：成员/作用域两包 + 五包汇总）═══════════════════════════
out('\nS4 真包（成员/作用域）：3 帧 0 错 + 锚点自证')
const MEMBER_PACKS = [
  {
    id: 'S4a', rel: '0923/2887099508/scene.pkg', at: 'objects[39].visible', line: "['getAnimationLayer']",
    why: 'thisScene.getLayer(...).getAnimationLayer + 4+14 处 thisScene.destroyLayer',
    also: (sj) => collectNodes(sj).filter((x) => x.node.script.includes('destroyLayer')).length,
  },
  {
    id: 'S4b', rel: '0923/3122339805/scene.pkg', at: 'objects[39].text', line: 'thisLayer.text.toString()',
    why: '文本层 ITextLayer.text',
  },
]
for (const P of MEMBER_PACKS) {
  const sj = loadScene(P.rel)
  if (!sj) { missingPacks.push(P.rel); skipItem(P.id + ' 真包 ' + P.rel.split('/').slice(-2).join('/'), path.join('$MPW_ROOT', 'allwallpaper', P.rel) + ' 不存在'); continue }
  const node = nodeAtPath(sj, P.at)
  const anchored = !!node && typeof node.script === 'string' && node.script.includes(P.line)
  const extra = P.also ? ('同包 destroyLayer 调用点=' + P.also(sj) + ' 处 · ') : ''
  const r = runTicks(sj, 3)
  ok(P.id + ' ' + P.rel.split('/').slice(-2).join('/') + ' 跑 3 帧 ⇒ 0 错（' + P.why + '）',
    anchored && r.total === 0,
    extra + (anchored ? ('锚点「' + P.line + '」命中 · ') : ('**锚点未命中**（' + P.at + '）· '))
    + (r.total === 0 ? '0 错' : JSON.stringify([...new Set(r.msgs)].slice(0, 3))))
}
ok('S4c 任务 1+2 的 5 个真包全部可见（缺失时逐条 SKIP，不假装通过）', missingPacks.length === 0,
  missingPacks.length ? '缺：' + JSON.stringify(missingPacks) : '5/5 可见')

// ═══════════════════════════ 7. S5 全语料逐包第 1 帧 ═══════════════════════════
const HAVE_CORPUS = fs.existsSync(ALLWALLPAPER)
/* 残余清单：**作者笔误**（不是宿主缺口）——理由与证据见本文件开头 + scene-script-api-gaps 的 S4c 注释。
   判据 = "有错的包/串 ⊆ 清单"（新包或同包新串 ⇒ 红），清单只允许变短。 */
const KNOWN_RESIDUAL = {
  '0923/3662790108/scene.pkg': ["update:Cannot read properties of undefined (reading 'p1_longNode')"],
}
if (QUICK) skipItem('S5 全语料逐包扫描', '--quick（变异子进程）跳过')
else if (!HAVE_CORPUS) skipItem('S5 全语料逐包扫描', path.join('$MPW_ROOT', 'allwallpaper') + ' 不存在（属本机资产，不进仓库）')
else {
  out('\nS5 全语料逐包第 1 帧（$MPW_ROOT/allwallpaper）')
  const files = walkContainers(ALLWALLPAPER)
  const found = new Map()
  let withScripts = 0, nodes = 0, checked = 0
  const t0 = Date.now()
  for (const f of files) {
    let sj = null
    try { const t = readSceneJsonText(f); if (t) sj = JSON.parse(t.replace(/^\uFEFF/, '')) } catch { continue }
    if (!sj) continue
    const ns = collectNodes(sj).length
    if (!ns) continue
    withScripts++; nodes += ns
    const msgs = []
    withMutedLog(() => {
      try {
        applySceneScripts(sj, 0, { scriptCache: createScriptCache(), canvasSize: { x: 1920, y: 1080 }, frametime: 1 / 60, onError: (st, e) => msgs.push(st + ':' + ((e && e.message) || e)) })
      } catch (e) { msgs.push('host:' + e.message) }
    })
    checked++
    if (msgs.length) found.set(path.relative(ALLWALLPAPER, f), [...new Set(msgs)])
  }
  note('扫描面：' + files.length + ' 个容器 / ' + withScripts + ' 个带 scripts 的包 / ' + nodes + ' 个脚本节点 · ' + (Date.now() - t0) + 'ms')
  /** 纯函数：本轮"不在清单里"的包/串（判据本身用合成数字证明有分辨力）。 */
  const unexpected = (foundMap, known) => {
    const bad = []
    for (const [rel, msgs] of foundMap) {
      const allow = known[rel]
      if (!allow) { bad.push(rel + '（清单里没有这个包）'); continue }
      for (const m of msgs) if (!allow.includes(m)) bad.push(rel + ' :: ' + m)
    }
    return bad
  }
  const bad = unexpected(found, KNOWN_RESIDUAL)
  const absent = Object.keys(KNOWN_RESIDUAL).filter((rel) => !found.has(rel))
  ok('S5a 扫描非空（带 scripts 的包 ≥ 20，逐包检查数 = 带 scripts 的包数）',
    withScripts >= 20 && checked === withScripts, withScripts + ' 个包 / 检查 ' + checked + ' 个')
  ok('S5b 有脚本错的包/串 ⊆ 已知残余清单（本轮 ' + found.size + ' 个包 / 清单 ' + Object.keys(KNOWN_RESIDUAL).length + ' 个；新包或新串即红）',
    bad.length === 0,
    bad.length ? ('新缺口：' + JSON.stringify(bad.slice(0, 5))) : ('0 个新缺口；清单里已消失（= 修好了，请删条目）：' + JSON.stringify(absent)))
  ok('S5b-分辨力（合成数字）：清单内=放行 / 新包=红 / 同包新串=红',
    unexpected(new Map([['A', ['x:1']]]), { A: ['x:1'] }).length === 0
    && unexpected(new Map([['B', ['x:1']]]), { A: ['x:1'] }).length === 1
    && unexpected(new Map([['A', ['x:1', 'y:2']]]), { A: ['x:1'] }).length === 1,
    '清单内=0 / 新包=1 / 同包新串=1')
  if (found.size) for (const [rel, msgs] of found) note('残余 ' + rel, JSON.stringify(msgs))
}

// ═══════════════════════════ 8. S6 红-if-reverted（变异自证）═══════════════════════════
if (IS_MUTANT_RUN) note('S6 变异体运行（MPW_SCENE_SCRIPTS 已设）⇒ 跳过自检，避免递归')
else if (!MUTATION) note('S6 红-if-reverted 自检被 --no-mutation 跳过（本次运行**未**复核变异必红）')
else {
  out('\nS6 红-if-reverted ×4：去掉 prepare 趟 / 恢复 init 趟顺带跑 update / 摘掉 text / 摘掉 destroyLayer')
  const copyTree = (fromDir, toDir, filter) => {
    fs.mkdirSync(toDir, { recursive: true })
    for (const name of fs.readdirSync(fromDir)) {
      const src = path.join(fromDir, name), dst = path.join(toDir, name)
      let st = null
      try { st = fs.statSync(src) } catch { st = null }
      if (!st) continue
      if (st.isDirectory()) { copyTree(src, dst, filter); continue }
      if (!st.isFile()) continue
      if (filter && !filter(src, name)) continue
      fs.writeFileSync(dst, fs.readFileSync(src))
    }
  }
  const tmpEly = path.join(TMP, 'elysia')
  copyTree(path.join(ROOT, 'elysia'), tmpEly, (src) => !src.includes(path.sep + 'vendor' + path.sep))
  // ①(P-232) scene-scripts.js 新增 `import { evalSceneZoom } from '../core/we-scene-bundle.js'`
  //   （getCameraTransforms 的动画求值）⇒ 副本必须连 core/ 一起拷，否则 ../core 相对导入断链、
  //   变异子进程启动即崩（rc=1 且没有任何断言名 = 不是"变异必红"，是加载失败）。
  copyTree(path.join(ROOT, 'core'), path.join(TMP, 'core'), null)
  const pristine = path.join(tmpEly, 'scene-scripts.js')
  fs.writeFileSync(pristine, fs.readFileSync(MODULE))
  const runCopy = () => spawnSync(process.execPath, [process.argv[1], '--no-mutation', '--quick'], {
    encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { MPW_SCENE_SCRIPTS: pristine }),
  })
  const rc = runCopy()
  const rcOut = String(rc.stdout || '') + String(rc.stderr || '')
  ok('S6-0 对照组：未变异的 /tmp 副本跑本文件全绿（rc=0）',
    rc.status === 0 && /ALL PASS/.test(rcOut),
    'rc=' + rc.status + ' ' + ((rcOut.match(/\(计票：[^)]*\)/) || [''])[0]))
  if (VERBOSE && rc.status !== 0) note('S6-0 副本输出尾部', JSON.stringify(rcOut.slice(-800)))

  const SRC = fs.readFileSync(MODULE, 'utf8')
  const MUTANTS = [
    {
      id: 'M1', fix: 'prepare 趟（先建全图）', expect: /✗ S1b /, baseline: /✓ S0a /,
      baselineName: 'S0a（副本可加载）',
      desc: '删掉 prepare 趟（回到"按首次使用惰性编译"）= 真包 0923/3521337568 / 3653641024 的复现条件',
      anchor: "  for (const [obj, owner] of nodes) {\n    try { run(obj, owner, 'prepare') } catch (e) { if (typeof opts.onError === 'function') try { opts.onError('prepare', e) } catch { /* ignore */ } }\n  }\n",
      to: "  /* MUTANT：prepare 趟被删掉（回到「按首次使用惰性编译」） */\n",
      expectReal: /✗ S2c |✗ S2d /,
    },
    {
      id: 'M2', fix: 'init 趟只跑 init', expect: /✗ S1a /, baseline: /✓ S0a /,
      baselineName: 'S0a（副本可加载）',
      desc: '恢复旧行为：init 趟在 init 之后继续跑 update（= 真包 wallpaperE/佩丽卡/佩丽卡1_03.mpkg 的复现条件）',
      anchor: "  if (phase === 'init' && cache) return;\n  if (typeof exports.update === 'function') {",
      to: "  if (false) return;   // MUTANT：init 趟顺带跑 update\n  if (typeof exports.update === 'function') {",
      expectReal: /✗ S2b /,
    },
    {
      id: 'M3', fix: 'ITextLayer.text 读取器', expect: /✗ S3c /, baseline: /✓ S0a /,
      baselineName: 'S0a（副本可加载）',
      desc: '把 textOf() 改成恒返回 undefined（回到"读到 undefined ⇒ reading \'toString\'"的旧状态）',
      anchor: "const textOf = (obj) => { const t = nodeRaw(obj ? obj.text : null); return t == null ? '' : String(t) };",
      to: "const textOf = () => undefined;   // MUTANT",
      expectReal: /✗ S4b /,
    },
    {
      id: 'M4', fix: 'thisScene.destroyLayer', expect: /✗ S3b1/, baseline: /✓ S0a /,
      baselineName: 'S0a（副本可加载）',
      desc: '把 api.destroyLayer 改名（= 该成员不存在，回到 init/update 抛 is not a function 的旧状态）',
      anchor: '  api.destroyLayer = (layerOrName) => {',
      to: '  api.__mutant_destroyLayer = (layerOrName) => {',
    },
  ]
  for (const m of MUTANTS) {
    const n = SRC.split(m.anchor).length - 1
    if (n !== 1) {
      skipItem('mutation-selfcheck ' + m.id, '锚点命中 ' + n + ' 次：' + JSON.stringify(m.anchor.slice(0, 60))
        + '（沙箱那几行已被改写 ⇒ 需重新标定；不做变异＝不算证据）')
      continue
    }
    fs.writeFileSync(pristine, SRC.split(m.anchor).join(m.to))
    const r = runCopy()
    const so = String(r.stdout || '') + String(r.stderr || '')
    const redLine = (so.match(m.expect) || [])[0] || (so.match(/✗ [^\n]*/) || [])[0] || ''
    ok('S6-' + m.id + '（' + m.fix + '）变异「' + m.desc + '」⇒ 子进程 rc=1 且点名断言变红',
      r.status === 1 && m.expect.test(so),
      'rc=' + r.status + ' 失败断言=' + JSON.stringify(redLine.slice(0, 160)))
    ok('S6-' + m.id + 'b 变异体里基线仍 ✓（' + m.baselineName + ' ⇒ 红是被点名那条，不是副本起不来）',
      m.baseline.test(so), '')
    if (m.expectReal) {
      // 反向证明：该变异体必须让**真包**那条断言也变红（= "改前抛错"的离线复现）
      const realLine = (so.match(m.expectReal) || [])[0] || ''
      ok('S6-' + m.id + 'c 同一变异体里真包断言也变红（' + m.expectReal.source + '）',
        m.expectReal.test(so), '失败断言=' + JSON.stringify(realLine.slice(0, 160)))
    }
    if (r.status !== 1 && VERBOSE) note('S6-' + m.id + ' 子进程输出尾部', JSON.stringify(so.slice(-800)))
  }
  fs.writeFileSync(pristine, SRC)   // 还原副本（对照组已用完）
}

// ═══════════════════════════ 9. 汇总 ═══════════════════════════
const peak = (() => { try { const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/); return m ? Math.round(+m[1] / 1024) + 'MB' : '?' } catch { return '?' } })()
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skip + '；PeakRSS=' + peak + ')')
if (fail) { out('\n' + fail + ' 项失败'); process.exit(1) }
out('\nALL PASS （' + pass + ' 项' + (skip ? '，另 SKIP ' + skip : '') + '）')
process.exit(0)

// script-layer-ref-audit-test.mjs —— P-174（2026-09-24）**层引用成员 × 五个面**全表普查 + `ISoundLayer.volume`
//
// ── 为什么要有这个文件 ───────────────────────────────────────────────────────────────────────
//   P-137/P-141/P-142/P-143 四批都是**按现象点补**成员缺口（用户上报/语料报错/静默 NaN 扫到哪个补哪个）。
//   从没做过"官方 d.ts 里**所有**层引用成员 × 本文件的**五个面**"的全表普查 ⇒
//     · 同一批成员反复以"另一种形态"冒出来（P-137 的 size ⇒ P-143 的 pointsize/font ⇒ 本批的 volume）；
//     · "同一个 ILayer 概念不能两套面"这条纪律没有可复算的守门（缺哪一面只能靠人眼）。
//   本文件把普查表**钉进判据**：官方名单（含 d.ts 出处行号）× 五个面 × 三档（已实现/缺失/故意不实现），
//   外加 `volume` 的读写行为与真包落点。表与实测不一致就红，并**点名成员 + 面**。
//
// ── 五个面（本文件的行话；同一个 ILayer 概念的五个挂载点）────────────────────────────────────
//   F1_getLayer       `makeSceneRef().layer()` → `thisScene.getLayer/enumerateLayers/getSceneObject/createLayer`
//   F2_emptyLayerRef  `makeOwnerRef().emptyLayerRef()` —— `thisLayer.getParent()` 在**根层**上的返回值
//   F3_layerRefFor    `makeOwnerRef().layerRefFor(obj)` —— `thisLayer.getParent()` 找到父层时的返回值
//   F4_thisLayer      `thisLayer`
//   F5_thisObject     `thisObject`
//   ⚠ F2 与 F3 在**本批之前**：F3 其实**不可达** —— `buildById()` 把 `byId` 挂在了 `makeOwnerRef()` 的
//     返回壳上，而读它的是内层 `ref.byId` ⇒ 恒 undefined ⇒ `thisLayer.getParent()` 永远返回空引用
//     （`name:''`、`id:-1`），`layerRefFor(obj)` 整条路径死掉。语料 6 个包 / 117 处 `getParent` 全中招
//     （含 `thisLayer.getParent().getParent()` 与 `parent.getTransformMatrix().m[13] > …`）。
//     本批修掉（见实现处的 P-174 注释），所以 F3 现在**真能**被造出来并被判据钉住。
//
// ── 本批改了什么（锚点）──────────────────────────────────────────────────────────────────
//   `elysia/scene-scripts.js`：
//     ① `LAYER_REF_MEMBER_ACCESSORS`（新导出）= 6 个值成员的**同一对** get/set 函数对象
//        （volume/alpha/angles/color/parallaxDepth/alignment），用 `LAYER_FACE_TARGET` WeakMap
//        把五个面绑到"取底层 scene.json 对象的函数"上 ⇒ **一套实现挂在五处**（S4 用函数身份自证）。
//     ② `volumeOf/writeVolume`（新）+ `soundPropsFor`：落点 = `obj.soundprops.volume`（渲染器模型）
//        + `obj.volume`（作者节点，nodeWrite 保 `{script,user,animation,value}` 的其它键）
//        + `obj.soundCtl.setVolume()`（活控制器）；读顺位 = soundCtl → soundprops → 用户属性活值 →
//        节点 value → 1，全程 clamp[0,1]；写拒绝非有限值（不落盘）。
//     ③ `anglesOf/colorOf/parallaxDepthOf/alignmentOf/alphaOf`：F1 原有语义提成模块级单一实现，
//        挂到五个面（F1 的 `color` 缺字段时旧读法是 (0,1,1)、`alignment` 旧读法给 undefined ⇒
//        按"读到的数 = 屏幕上用的数"补成 (1,1,1) / 'center'，依据 `core/we-scene-bundle.js:1615-1616`）。
//     ④ `buildById()` 挂到内层 `ref`（F3 可达）+ `particleInstanceOf(null)` 短路
//        （F3 打通后 `Object.assign(…, emptyLayerRef(), …)` 会遍历读到 `get instance` ⇒ 空引用抛错）。
//     ⑤ `SCENE_SCRIPT_API_DIAG` 增 4 个计数：volumeRead / volumeWrite / volumeWriteRejected / volumeClamp。
//
// ── 真包改前 / 改后读数（`0923/2887099508/scene.pkg`，objects[76] 的作者脚本里
//    `thisScene['getLayer']('桥')['volume']=0x1`（6 处写 volume），'桥' = objects[79]，
//    authored `volume = {"user":"bgm","value":1}`、`sound:["sounds/12333.mp3"]`）──────────────
//   · 改前实测（HEAD 版本，注入探针脚本）：
//       `typeof getLayer('桥').volume` = **'undefined'**、值 undefined、**不是自有键**；
//       `getLayer('桥')['volume'] = 0.25` 之后：`桥.volume` 仍是 `{"user":"bgm","value":1}`、
//       **没有** `soundprops` 键（赋值只是在那个每次访问新建的临时引用上建了个立刻丢弃的自有属性）
//       —— 既不报错也不生效，就是本批要收口的那个静默缺口。
//   · 改后实测：读 = **1**（authored 节点 value；用户属性 bgm 有值时 = 用户值）；
//       写 0.25 ⇒ `桥.soundprops = {"volume":0.25}`、`桥.volume = {"user":"bgm","value":0.25}`
//       （**`user` 键保留**）、读回 0.25。
//
// ── 官方出处（一手）──────────────────────────────────────────────────────────────────────
//   主文件 = `$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts`
//     （= 仓库既有注释一直引用的那份；本文件所有行号都是它的实测行号；md5 见 S1 输出）
//     对照文件 = `$MPW_ROOT/Steam/steamapps/common/wallpaper_engine/ui/dist/monaco/
//     autocomplete/lib.sceneScript.d.ts`（抬头写着 **VERSION 2.8**，比主文件多 14 个成员 ⇒ S1c 单列）
//   ⚠ 官方 d.ts 的 `ILayer extends … IModel …`（L1139）里那个 `IModel` **没有声明**（官方笔误）——
//     实际存在的是 `IModelLayer`（L1082），本文件按 IModelLayer 取它的成员。
//   ⚠ 官方 d.ts 里**没有** `thisObject`（两份都 0 命中）⇒ F5 的"官方依据"只有
//     `interface IThisPropertyObjectBase extends IObject {}`（L504-510，空接口）这一条；
//     F5 的值成员是我们按"thisObject 就是该层"的既有口径给的（见实现处注释），判据里如实标 `na`/`impl`。
//
// ── 语料使用普查（判据的"为什么要做/为什么先不做"依据；不是本测试的运行时依赖）────────────────
//   200+ 容器 / 80 个带脚本包 / 3741 个脚本节点，只统计 {script:"…"} 源码串里的 `.M` 与 `['M']`：
//     origin 702·45包 / name 623·8 / visible 494·31 / play 413·41 / getAnimation 190·24 /
//     alpha 160·11 / getParent 117·6 / text 53·8 / angles 33·12 / alignment 29·10 / isPlaying 25·6 /
//     volume 23·3 / color 14·4 / parallaxDepth 11·9 / solid 7·2 / getEffect 5·2 /
//     getAnimationLayerCount 3·3（**全部来自包内嵌的 WE 运行时库**，作者代码 0 次）/ …
//   30 个官方成员 **0 命中**（骨骼族/挂点附件族/emitParticles/lookAt/lookAtYaw/setParent/getChildren/
//   padding/anchor/opaquebackground/backgroundcolor/rootmotion/createAnimationLayer/…）⇒ 判据里标
//   `gap`（缺失，已登记）并写清依据，而不是假装实现。
//
// ── 本文件钉住什么 ───────────────────────────────────────────────────────────────────────────
//   S0 基线：模块可加载 + 新导出在 + 4 个 volume 计数键在
//   S1 官方名单：嵌入表 vs 两份 d.ts 的**实测解析**（成员名 + 行号；多一个/少一个/行号漂移即红）
//   S2 覆盖矩阵（官方名单 × 五面）：`impl` 必须在场（缺一项就红，点名成员+面）/ `gap`·`na` 必须缺席
//      （若变成在场 ⇒ 表过期，同样红）+ 每个 `gap`·`na` 必须写清依据
//   S3 `volume` 行为（J 组）：读（authored/节点/soundprops/控制器/用户属性优先）/写（三处落点）/
//      保作者节点（`{script,user,value}` 的其它键一个不动）/非有限值不落盘/clamp[0,1]/空引用安全/计数
//   S4 五面同源（K 组）：访问器**函数身份**相等（一套实现挂在五处）+ 同一状态下 F1/F3/F4/F5 读数一致
//   S5 真包：'桥' 的改前/改后读数（写死在断言说明）+ 落点 + 节点保留 + 用户属性优先
//   S6 变异自证 ×4：①摘掉 F4 的 volume ②写穿落到错槽（不建 soundprops）③去掉"非有限值不落盘"
//      ④把 byId 修复回退（F3 退回空引用）—— 每组打印 `MUTANT-RED-OK` 且**期望红集 == 实际红集**
//
// 用法：node tests/script-layer-ref-audit-test.mjs [--no-mutation] [--verbose]
//   纯 Node / 不开浏览器 / 不读 15GB 语料（只读两份 d.ts + 两个真包）；变异子进程用 --no-mutation
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { readSceneJsonText } from './_pkg-index.mjs'

const ARGV = process.argv.slice(2)
const MUTATION = !ARGV.includes('--no-mutation')
const VERBOSE = ARGV.includes('--verbose')

let pass = 0, fail = 0, skip = 0
const SAVED_LOG = console.log
const out = (...a) => { try { SAVED_LOG(...a) } catch { /* ignore */ } }
const note = (name, detail) => { out('  · ' + name + (detail ? '  [' + detail + ']' : '')) }
const ok = (name, cond, detail) => {
  if (cond) { pass++; out('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; out('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const skipItem = (name, reason) => { skip++; out('  SKIP script-layer-ref-audit ' + name + ' — ' + reason) }
const short = (v, n = 220) => { let s; try { s = typeof v === 'string' ? v : JSON.stringify(v) } catch { s = String(v) } if (s === undefined) s = String(v); return s.length > n ? s.slice(0, n) + '…' : s }

const MODULE = process.env.MPW_SCENE_SCRIPTS
  ? path.resolve(process.env.MPW_SCENE_SCRIPTS)
  : path.join(ROOT, 'elysia', 'scene-scripts.js')
const IS_MUTANT_RUN = !!process.env.MPW_SCENE_SCRIPTS
let applySceneScripts, createScriptCache, makeSceneRef, sceneScriptApiDiag, resetSceneScriptApiDiag
let LAYER_REF_MEMBER_ACCESSORS, LAYER_REF_FACE_NAMES
try {
  const mod = await import(pathToFileURL(MODULE).href)
  applySceneScripts = mod.applySceneScripts
  createScriptCache = mod.createScriptCache
  makeSceneRef = mod.makeSceneRef
  sceneScriptApiDiag = mod.sceneScriptApiDiag
  resetSceneScriptApiDiag = mod.resetSceneScriptApiDiag
  LAYER_REF_MEMBER_ACCESSORS = mod.LAYER_REF_MEMBER_ACCESSORS
  LAYER_REF_FACE_NAMES = mod.LAYER_REF_FACE_NAMES
} catch (e) {
  out('  沙箱实现加载失败：' + path.relative(ROOT, MODULE) + ' — ' + (e && e.message))
}
out('script-layer-ref-audit-test —— P-174 层引用成员 × 五个面全表普查 + ISoundLayer.volume'
  + '（沙箱实现=' + path.relative(ROOT, MODULE) + (IS_MUTANT_RUN ? '（变异体）' : '') + '）')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p144-layer-ref-audit-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ } })
const CORPUS_ROOT = process.env.MPW_ROOT || WS
const ALLWALLPAPER = path.join(CORPUS_ROOT, 'allwallpaper')

// ═══════════════════════════ 0. 通用工具 ═══════════════════════════
function withMutedLog(fn) {
  const saved = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = saved }
}
/** 跑 ticks 次 `applySceneScripts`（**同一个 cache 跨帧** = 宿主行为）。 */
function runTicks(scene, ticks, extra = {}) {
  const cache = extra.scriptCache || createScriptCache()
  const msgs = []
  withMutedLog(() => {
    for (let t = 0; t < ticks; t++) {
      const opts = Object.assign({
        scriptCache: cache,
        renderObjects: scene.objects,
        canvasSize: { x: 1920, y: 1080 },
        frametime: 1 / 60,
      }, extra)
      opts.onError = (stage, e) => msgs.push(stage + ':' + ((e && e.message) || e))
      applySceneScripts(scene, t, opts)
    }
  })
  return { msgs, total: msgs.length, shared: cache.shared, cache }
}
const mkScene = (objects) => ({ general: {}, camera: { eye: '0 0 0', center: '0 0 0', up: '0 1 0' }, objects })

/* ═══════════════════════════ 1. S0 基线 ═══════════════════════════ */
out('\nS0 基线')
ok('S0a 沙箱模块可加载（applySceneScripts / createScriptCache / makeSceneRef / 诊断表）',
  typeof applySceneScripts === 'function' && typeof createScriptCache === 'function'
  && typeof makeSceneRef === 'function' && typeof sceneScriptApiDiag === 'function' && typeof resetSceneScriptApiDiag === 'function',
  path.relative(ROOT, MODULE))
ok('S0b P-174 新导出在场：LAYER_REF_MEMBER_ACCESSORS（6 个成员）+ LAYER_REF_FACE_NAMES（5 个面）',
  !!LAYER_REF_MEMBER_ACCESSORS && Array.isArray(LAYER_REF_FACE_NAMES)
  && LAYER_REF_FACE_NAMES.length === 5
  && ['volume', 'alpha', 'angles', 'color', 'parallaxDepth', 'alignment']
    .every((k) => LAYER_REF_MEMBER_ACCESSORS[k] && typeof LAYER_REF_MEMBER_ACCESSORS[k].get === 'function' && typeof LAYER_REF_MEMBER_ACCESSORS[k].set === 'function'),
  short(LAYER_REF_FACE_NAMES) + ' / ' + Object.keys(LAYER_REF_MEMBER_ACCESSORS || {}).join(','))
{
  const d = sceneScriptApiDiag ? sceneScriptApiDiag() : {}
  const KEYS = ['volumeRead', 'volumeWrite', 'volumeWriteRejected', 'volumeClamp']
  const missing = KEYS.filter((k) => typeof d[k] !== 'number')
  ok('S0c 4 个 volume 计数键都在 sceneScriptApiDiag() 里（"不静默"的可观测入口）', missing.length === 0,
    missing.length ? ('缺：' + missing.join(',')) : KEYS.join(','))
}

/* ═══════════════════════════ 2. S1 官方名单（嵌入表 vs d.ts 实测解析）═══════════════════════════ */
//  口径：`ILayer`（L1139）的闭包 = ILayer ∪ 它 extends 的每个接口的成员（`IModel` 无声明 ⇒ 用 IModelLayer）。
//  嵌入表按"成员 → 出处（接口@行号）"逐条写死；S1 用真 d.ts 重新解析一遍**逐条核对**（可复算）。
const DTS_PRIMARY = path.join(CORPUS_ROOT, 'wallpaper_engine', 'ui', 'dist', 'monaco', 'autocomplete', 'lib.sceneScript.d.ts')
const DTS_STEAM = path.join(CORPUS_ROOT, 'Steam', 'steamapps', 'common', 'wallpaper_engine', 'ui', 'dist', 'monaco', 'autocomplete', 'lib.sceneScript.d.ts')
const LAYER_IFACES = ['IObject', 'IImageLayer', 'ISoundLayer', 'IEffectLayer', 'ITextLayer', 'IParticleSystem', 'IModelLayer', 'ICamera', 'ILayer']
/** 嵌入的官方名单（成员名 → 主 d.ts 行号；行号是 S1 的核对项之一）。 */
const OFFICIAL = [
  ['getAnimation', 498], ['alpha', 995], ['color', 1000], ['alignment', 1005],
  ['getTextureAnimation', 1010], ['getVideoTexture', 1015], ['getAnimationLayerCount', 1020], ['getAnimationLayer', 1025],
  ['createAnimationLayer', 1030], ['playSingleAnimation', 1035], ['destroyAnimationLayer', 1040],
  ['getBoneCount', 1045], ['getBoneTransform', 1050], ['setBoneTransform', 1055], ['getBoneIndex', 1060],
  ['getBoneParentIndex', 1065], ['applyBonePhysicsImpulse', 1070], ['resetBonePhysicsSimulation', 1075],
  ['isPlaying', 748], ['play', 753], ['stop', 758], ['pause', 763], ['volume', 768],
  ['getEffect', 779], ['getEffectCount', 784], ['transformAttachmentToTexture', 790], ['size', 795],
  ['perspective', 800], ['solid', 805],
  ['text', 816], ['opaquebackground', 831], ['backgroundcolor', 836], ['pointsize', 841], ['font', 846],
  ['padding', 851], ['horizontalalign', 856], ['verticalalign', 861], ['anchor', 867],
  ['emitParticles', 979], ['instance', 984],
  ['rootmotion', 1091], ['fov', 1127], ['zoom', 1132],
  ['origin', 1143], ['angles', 1148], ['scale', 1153], ['parallaxDepth', 1158], ['name', 1163], ['visible', 1168],
  ['getTransformMatrix', 1173], ['rotateObjectSpace', 1178], ['lookAt', 1184], ['lookAtYaw', 1191],
  ['setParent', 1198], ['getParent', 1210], ['getChildren', 1215],
  ['getAttachmentIndex', 1220], ['getAttachmentMatrix', 1225], ['getAttachmentOrigin', 1230], ['getAttachmentAngles', 1235],
]
/** 2.8 版（Steam 那份）**ILayer 闭包**里多出来的成员（主 d.ts 里没有 ⇒ 判据里单列，全部按 gap 处理）。
 *  ⚠ `executeMaterialFunction` **不在**这份名单里：它属于 `IEffect`（`getEffect()` 返回的**子句柄**），
 *  不是 ILayer 闭包的一部分 —— 判据用 S1c2 单列它（子句柄面的 2.8 增量），避免"把子句柄混进层成员表"。 */
const OFFICIAL_2_8_DELTA = [
  'getLocalBoneTransform', 'setLocalBoneTransform', 'getLocalBoneAngles', 'setLocalBoneAngles',
  'getLocalBoneOrigin', 'setLocalBoneOrigin', 'getBlendShapeIndex', 'getBlendShapeWeight', 'setBlendShapeWeight',
  'limitrows', 'maxrows', 'limitwidth', 'maxwidth',
]
/** 解析一份 d.ts：返回 { iface → [{name, line}] }（成员 = 缩进恰好一个 tab 的 `name:` / `name(`）。 */
function parseDts(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const out = {}
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    const m = /^interface\s+([A-Za-z0-9_$]+)/.exec(L)
    if (m) { cur = m[1]; out[cur] = out[cur] || []; continue }
    if (/^\}/.test(L)) { cur = null; continue }
    if (!cur) continue
    const mm = /^\t(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[?]?\s*(?:\(|:)/.exec(L)
    if (mm) out[cur].push({ name: mm[1], line: i + 1 })
  }
  const ext = {}
  for (const L of lines) {
    const m = /^interface\s+([A-Za-z0-9_$]+)\s+extends\s+([^{]+)/.exec(L)
    if (m) ext[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean)
  }
  return { members: out, ext }
}
/** 从解析结果里取"ILayer 闭包"的成员名集合（去重）。
 *  ⚠ 官方笔误：`ILayer extends … IModel …` 里的 `IModel` 没有声明（S1b2 钉住）—— 实际承载这些成员的是
 *  `IModelLayer`，所以这里显式把 `IModel` 折到 `IModelLayer`（不折的话 `rootmotion` 会被漏掉，
 *  S1a 会红；这正是"表要能复算"的价值：漏一个就报出来）。 */
function closureOf(parsed) {
  const names = new Set()
  const walk = (iface) => {
    const target = (iface === 'IModel' && parsed.members.IModelLayer) ? 'IModelLayer' : iface
    if (!parsed.members[target]) return
    for (const m of parsed.members[target]) names.add(m.name)
    for (const e of (parsed.ext[target] || [])) walk(e)
  }
  walk('ILayer')
  return names
}
{
  const embedded = new Set(OFFICIAL.map(([n]) => n))
  if (!fs.existsSync(DTS_PRIMARY)) {
    skipItem('S1 官方名单核对', path.relative(CORPUS_ROOT, DTS_PRIMARY) + ' 不存在（嵌入表仍驱动 S2）')
  } else {
    const raw = fs.readFileSync(DTS_PRIMARY)
    const md5 = (await import('node:crypto')).createHash('md5').update(raw).digest('hex')
    const p = parseDts(DTS_PRIMARY)
    const names = closureOf(p)
    const missing = [...embedded].filter((n) => !names.has(n))
    const extra = [...names].filter((n) => !embedded.has(n))
    ok('S1a 嵌入的官方名单 == 主 d.ts 的 ILayer 闭包实测（' + embedded.size + ' 个成员；md5=' + md5 + '）',
      missing.length === 0 && extra.length === 0,
      (missing.length ? ('实测里没有：' + missing.join(',')) : '') + (extra.length ? (' 表里没登记：' + extra.join(',')) : '') || (embedded.size + ' 个成员逐条命中'))
    // 行号核对（成员名 → 行号；同一成员在多行出现时不强求）
    const lineOf = new Map()
    for (const iface of LAYER_IFACES) for (const m of (p.members[iface] || [])) if (!lineOf.has(m.name)) lineOf.set(m.name, m.line)
    const badLines = OFFICIAL.filter(([n, ln]) => lineOf.has(n) && lineOf.get(n) !== ln)
    ok('S1b 嵌入表的**行号**逐条命中主 d.ts（出处可复算；' + OFFICIAL.length + ' 条）', badLines.length === 0,
      badLines.length ? badLines.map(([n, ln]) => n + '(表 ' + ln + ' ≠ 实测 ' + lineOf.get(n) + ')').join(' ') : '全部命中')
    const iModelDeclared = !!p.members.IModel
    ok('S1b2 官方笔误的旁证：`ILayer extends … IModel` 里的 `IModel` 确实**没有**声明（成员取自 IModelLayer）',
      !iModelDeclared && (p.ext.ILayer || []).includes('IModel') && !!p.members.IModelLayer,
      'IModel declared=' + iModelDeclared + ' / IModelLayer=' + ((p.members.IModelLayer || []).length) + ' 个成员')
  }
  if (!fs.existsSync(DTS_STEAM)) {
    skipItem('S1c 2.8 对照', path.relative(CORPUS_ROOT, DTS_STEAM) + ' 不存在')
  } else {
    const raw = fs.readFileSync(DTS_STEAM)
    const md5 = (await import('node:crypto')).createHash('md5').update(raw).digest('hex')
    const p2 = parseDts(DTS_STEAM)
    const n2 = closureOf(p2)
    const delta = [...n2].filter((n) => !embedded.has(n))
    const gone = [...embedded].filter((n) => !n2.has(n))
    ok('S1c 2.8 对照：主名单 ⊆ 2.8 名单，且多出来的正好是登记过的 ' + OFFICIAL_2_8_DELTA.length + ' 个（md5=' + md5 + '）',
      gone.length === 0 && delta.length === OFFICIAL_2_8_DELTA.length && OFFICIAL_2_8_DELTA.every((n) => delta.includes(n)),
      '只在 2.8 里：' + short(delta) + (gone.length ? (' / 2.8 里反而没有：' + gone.join(',')) : ''))
    // 子句柄面的 2.8 增量（**不算**层成员）：IEffect 多了 executeMaterialFunction
    const eff2 = (p2.members.IEffect || []).map((m) => m.name)
    const eff1 = (parseDts(DTS_PRIMARY).members.IEffect || []).map((m) => m.name)
    const effDelta = eff2.filter((n) => !eff1.includes(n))
    ok('S1c2 子句柄面的 2.8 增量单列（不进层成员表）：IEffect 多出 executeMaterialFunction',
      effDelta.length === 1 && effDelta[0] === 'executeMaterialFunction',
      'IEffect 2.8 增量=' + short(effDelta) + '（本仓 IEffect 句柄未实现它 ⇒ 与该成员的 gap 档位一致）')
  }
}

/* ═══════════════════════════ 3. 构造五个面 ═══════════════════════════ */
//  同一个 ILayer 概念的五个挂载点，全部指向**同一层 R**（F2 例外：空引用）。
//  R 的字段刻意覆盖成员真值（volume 节点 / alpha 脚本节点 / color / angles / parallaxDepth / alignment …）。
//  ⚠ **F4/F5 是惰性面**（`thisLayer`/`thisObject` 的 getter 每次读 `ref.current`，P-60）⇒ 它们的
//    *读值* 必须在脚本执行**当中**取；跑完再读会拿到"最后一个 owner"（实测：F4.id 会变成 C 的 2）。
//    所以下面同时抓两份东西：
//      · `faces`（面对象本身）—— 只用来查**成员在场**与**访问器身份**（与 owner 无关）；
//      · `snap`（脚本内取好的**值快照**）—— 所有值/行为断言都用它，不许在跑完后再读 F4/F5。
const PICK_FN = `function __pick(o) {
  return {
    volume: o.volume, alpha: o.alpha, color: String(o.color), angles: String(o.angles),
    parallaxDepth: String(o.parallaxDepth), alignment: o.alignment, name: o.name, id: o.id,
  };
}`
const CAP_ROOT = `'use strict';
${PICK_FN}
export function update(value) {
  shared.__snap = Object.assign(shared.__snap || {}, {
    F1_getLayer: __pick(thisScene.getLayer('R')),
    F2_emptyLayerRef: __pick(thisLayer.getParent()),
    F4_thisLayer: __pick(thisLayer),
    F5_thisObject: __pick(thisObject),
  });
  shared.__faces = Object.assign(shared.__faces || {}, {
    F1_getLayer: thisScene.getLayer('R'),
    F2_emptyLayerRef: thisLayer.getParent(),
    F4_thisLayer: thisLayer,
    F5_thisObject: thisObject,
    f4Name: thisLayer.name, f4Id: thisLayer.id,
  });
  return value;
}`
const CAP_CHILD = `'use strict';
${PICK_FN}
export function update(value) {
  const p = thisLayer.getParent();
  shared.__snap = Object.assign(shared.__snap || {}, { F3_layerRefFor: __pick(p) });
  shared.__faces = Object.assign(shared.__faces || {}, { F3_layerRefFor: p });
  return value;
}`
function baseObjects() {
  return [
    {
      id: 1, name: 'R', origin: '10 20 0', scale: '1 1 1', color: '0.1 0.2 0.3', angles: '1 2 3',
      parallaxDepth: '2 2', alignment: 'center', alpha: { script: 'x', value: 0.5 },
      sound: ['sounds/a.mp3'], volume: { user: 'bgm', value: 0.8 },
      pointsize: 48, font: 'fonts/Atami-Regular.otf', horizontalalign: 'right', verticalalign: 'bottom',
      visible: { script: CAP_ROOT, value: true },
      effects: [{ file: 'e.json', name: 'E0', visible: true, passes: [{ constantshadervalues: { alpha: 1 } }] }],
    },
    { id: 2, name: 'C', parent: 1, origin: '0 0 0', visible: { script: CAP_CHILD, value: true } },
  ]
}
function buildFaces(extra = {}) {
  const objects = baseObjects()
  const r = runTicks(mkScene(objects), 1, Object.assign({ userProps: {} }, extra))
  const f = r.shared.__faces || {}
  const snap = r.shared.__snap || {}
  const faces = {
    F1_getLayer: f.F1_getLayer, F2_emptyLayerRef: f.F2_emptyLayerRef, F3_layerRefFor: f.F3_layerRefFor,
    F4_thisLayer: f.F4_thisLayer, F5_thisObject: f.F5_thisObject,
  }
  return { faces, snap, objects, R: objects[0], msgs: r.msgs, shared: r.shared }
}
/** 在一个真脚本里跑一段行为（`this` 语义与作者脚本一致：thisLayer/thisObject 惰性绑定 R）。 */
function scen(bodySrc, extra = {}) {
  const objects = baseObjects()
  objects[0].__probe = { script: `'use strict';\n${PICK_FN}\nexport function update(value) {\n${bodySrc}\n  return value;\n}`, value: 'probe' }
  const r = runTicks(mkScene(objects), 1, Object.assign({ userProps: {} }, extra))
  return { objects, R: objects[0], C: objects[1], shared: r.shared, msgs: r.msgs, total: r.total }
}
const FACE_KEYS = LAYER_REF_FACE_NAMES || ['F1_getLayer', 'F2_emptyLayerRef', 'F3_layerRefFor', 'F4_thisLayer', 'F5_thisObject']
const BUILT = buildFaces()
const FACES = BUILT.faces
const SNAP = BUILT.snap
const faceKeysOf = (o) => { const s = new Set(); for (const k in o) s.add(k); return s }
const PRESENT = {}
for (const k of FACE_KEYS) PRESENT[k] = FACES[k] ? faceKeysOf(FACES[k]) : new Set()

out('\nS1d 五个面的装配（面对象来自真跑，不是手工构造）')
ok('S1d-1 五个面全部构造成功（F1 getLayer / F2 空引用 / F3 getParent 有父 / F4 thisLayer / F5 thisObject）',
  FACE_KEYS.every((k) => FACES[k] && typeof FACES[k] === 'object'), FACE_KEYS.map((k) => k + '=' + (FACES[k] ? faceKeysOf(FACES[k]).size : 'null')).join(' '))
ok('S1d-2 面身份正确（**脚本内快照**）：F2 是空引用（id=-1、name=\'\'）、F1/F3/F4/F5 都指向真层 R（id=1）',
  SNAP.F2_emptyLayerRef && SNAP.F2_emptyLayerRef.id === -1 && SNAP.F2_emptyLayerRef.name === ''
  && ['F1_getLayer', 'F3_layerRefFor', 'F4_thisLayer', 'F5_thisObject'].every((k) => SNAP[k] && SNAP[k].id === 1 && SNAP[k].name === 'R'),
  FACE_KEYS.map((k) => k.replace(/^(F\d)_.*$/, '$1') + '=' + short(SNAP[k] && SNAP[k].name) + '/' + (SNAP[k] && SNAP[k].id)).join(' ')
  + ' · F3 可达=本批 byId 修复（改前恒为空引用）· errs=' + BUILT.msgs.length)
ok('S1d-3 构造五个面的探针脚本 0 报错（byId 修复后 getParent 链不再抛）', BUILT.msgs.length === 0, short(BUILT.msgs))

/* ═══════════════════════════ 4. S2 普查表 + 覆盖矩阵 ═══════════════════════════ */
//  三档：impl（该面上已实现，判据要求**在场**）/ gap（缺失=已登记的技术债，判据要求**缺席**）/
//        na（故意不实现，判据要求**缺席**且必须给依据）。
const IMPL = 'impl', GAP = 'gap', NA = 'na'
const A = (t) => ({ F1_getLayer: t, F2_emptyLayerRef: t, F3_layerRefFor: t, F4_thisLayer: t, F5_thisObject: t })
const L4 = (t4, t5) => ({ F1_getLayer: t4, F2_emptyLayerRef: t4, F3_layerRefFor: t4, F4_thisLayer: t4, F5_thisObject: t5 })
const F5_NA = 'thisObject 没有官方 ILayer 声明（两份 d.ts 都 0 命中；最近的 IThisPropertyObjectBase L504-510 是空接口），' +
  '本仓口径只把**值成员**给它（这一条见实现处注释）；语料 0 处 `thisObject.<方法>()` ⇒ 不扩这条回归面'
const GAP_ANIM = '语料普查 0 命中；本仓动画层由 core 在载入时烘焙（`animationlayers`），没有"脚本侧创建/销毁动画层"的落点 ⇒ 登记为缺失，不编造'
const GAP_BONE = '语料普查 0 命中；本仓骨骼只做只读采样（`elysia/we-renderer/puppet.js` + MDL 解析），没有 setBoneTransform/物理脉冲的落点 ⇒ 登记为缺失'
const GAP_ATTACH = '语料普查 0 命中；本仓挂点走 core 载入时烘焙（`attachBindDelta`/attachmentOffsets，demo.html/we-scene-bundle），脚本侧无改写落点 ⇒ 登记为缺失'
const GAP_TEXT = '语料普查 0 命中；core 的文本光栅**有**读它的落点（`core/we-scene-bundle.js:1588-1600`）⇒ 只是"还没做"，登记为缺失（下一步候选），不是没有落点'
const CENSUS = [
  // [成员, 官方出处（主 d.ts）, 档位, 依据]
  ['getAnimation', 'IObject.getAnimation L498（返回 IAnimation，L494-499）', A(IMPL), '已实现（五面）：IAnimation 面 + 计数；语料 190 处/24 包'],
  ['alpha', 'IImageLayer.alpha L995-998 / ITextLayer.alpha L826-829', A(IMPL), '★本批统一：F1 既有语义（nodeRaw + 缺省 1 + `Number(v)||0` 写）提成模块级单一实现挂五面（F2/F3/F5 此前完全没有）'],
  ['color', 'IImageLayer.color L1000-1003 / ITextLayer.color L821-824', A(IMPL), '★本批统一：缺字段缺省 (1,1,1)（core:1616 parseColor + :1378-1383）；F1 旧读法缺字段给 (0,1,1) 已修；语料 14 处/4 包'],
  ['alignment', 'IImageLayer.alignment L1005-1008', A(IMPL), "★本批统一：缺省 'center'（core:1615 `o.alignment || 'center'`）；语料 29 处/10 包，含 `if (bar.alignment !== x)` 先比较后写"],
  ['getTextureAnimation', 'IImageLayer.getTextureAnimation L1010-1013', L4(IMPL, NA), 'F1-F4 已实现（ITextureAnimation 面 + 计数，真机语料 71 处/10 包）；F5 na：' + F5_NA],
  ['getVideoTexture', 'IImageLayer.getVideoTexture L1015-1018', L4(IMPL, NA), 'F1-F4 已实现（IVideoTexture 安全句柄）；F5 na：' + F5_NA],
  ['getAnimationLayerCount', 'IImageLayer L1020-1023 / IModelLayer L1096-1099', L4(IMPL, NA), 'F1-F4 已实现（与 getAnimationLayer 同一份 animRefShared）；F5 na：' + F5_NA],
  ['getAnimationLayer', 'IImageLayer L1025-1028 / IModelLayer L1101-1104', L4(IMPL, NA), 'F1-F4 已实现；F5 na：' + F5_NA],
  ['createAnimationLayer', 'IImageLayer L1030-1033', A(GAP), GAP_ANIM],
  ['playSingleAnimation', 'IImageLayer L1035-1038', A(GAP), GAP_ANIM],
  ['destroyAnimationLayer', 'IImageLayer L1040-1043', A(GAP), GAP_ANIM],
  ['getBoneCount', 'IImageLayer L1045-1048', A(GAP), GAP_BONE],
  ['getBoneTransform', 'IImageLayer L1050-1053', A(GAP), GAP_BONE],
  ['setBoneTransform', 'IImageLayer L1055-1058', A(GAP), GAP_BONE],
  ['getBoneIndex', 'IImageLayer L1060-1063', A(GAP), GAP_BONE],
  ['getBoneParentIndex', 'IImageLayer L1065-1068', A(GAP), GAP_BONE],
  ['applyBonePhysicsImpulse', 'IImageLayer L1070-1073', A(GAP), GAP_BONE],
  ['resetBonePhysicsSimulation', 'IImageLayer L1075-1078', A(GAP), GAP_BONE],
  ['isPlaying', 'ISoundLayer L748-751（方法，不是属性）/ IParticleSystem L974-977', L4(IMPL, NA), 'F1-F4 已实现（共享播放状态机 + 计数；官方文档"Check if we\'re playing any sound."）；F5 na：' + F5_NA],
  ['play', 'ISoundLayer L753-756 / IParticleSystem L959-962', L4(IMPL, NA), 'F1-F4 已实现（P-141：语料 413 处/41 包）；F5 na：' + F5_NA],
  ['stop', 'ISoundLayer L758-761 / IParticleSystem L969-972', L4(IMPL, NA), 'F1-F4 已实现；F5 na：' + F5_NA],
  ['pause', 'ISoundLayer L763-766 / IParticleSystem L964-967', L4(IMPL, NA), 'F1-F4 已实现；F5 na：' + F5_NA],
  ['volume', 'ISoundLayer.volume L768（"Adjust volume."）', A(IMPL), '★本批新增：落点 obj.soundprops.volume + obj.volume（保节点）+ soundCtl.setVolume；缺省 1 / clamp[0,1] / 非有限值不落盘（依据见实现处 P-174 长注释）；真包语料 23 处/3 包'],
  ['getEffect', 'IEffectLayer.getEffect L779-782', A(IMPL), '已实现（P-143；IEffect 句柄 + 名字/下标解析 + 计数）'],
  ['getEffectCount', 'IEffectLayer.getEffectCount L784-787', A(IMPL), '已实现（P-143）'],
  ['transformAttachmentToTexture', 'IEffectLayer L790-793', A(GAP), GAP_ATTACH],
  ['size', 'IEffectLayer.size L795-798（readonly Vec2）', A(IMPL), '已实现（P-137；读 Vec3 超集、写静默丢弃；语料 122 处/18 包）'],
  ['perspective', 'IEffectLayer.perspective L800-803 / IModelLayer.perspective L1086-1089', A(GAP), '语料 1 处但是 `props.perspective`（用户属性读取，不是图层写）；本仓图层级透视没有独立开关（透视走 camera/effects 链路）⇒ 登记为缺失'],
  ['solid', 'IEffectLayer.solid L805-808', A(NA), '故意不实现：语料 7 处/2 包**全是写**（`thisScene.getLayer(x)["solid"]=…`），而本仓 core 在**载入时**把 solid 烘焙成布尔（`core/we-scene-bundle.js:1604-1610`）⇒ 脚本侧写 raw 字段没有消费者，提供它就是"假开关"（P-76 对 volume 的同一条口径）'],
  ['text', 'ITextLayer.text L816-819', A(IMPL), "已实现（P-142；读 `''` 兜底 + 写穿 nodeWrite；语料 53 处/8 包）"],
  ['opaquebackground', 'ITextLayer.opaquebackground L831-834', A(GAP), GAP_TEXT],
  ['backgroundcolor', 'ITextLayer.backgroundcolor L836-839', A(GAP), GAP_TEXT],
  ['pointsize', 'ITextLayer.pointsize L841-844（300 DPI 磅值）', A(IMPL), '已实现（P-143；缺省 32 与 core:1583 逐位一致）'],
  ['font', 'ITextLayer.font L846-849', A(IMPL), '已实现（P-143；缺省 \'\' 与 core:1578 一致）'],
  ['padding', 'ITextLayer.padding L851-854', A(GAP), GAP_TEXT],
  ['horizontalalign', 'ITextLayer.horizontalalign L856-859', A(IMPL), '已实现（P-143；缺省 left 与 core:1586 一致）'],
  ['verticalalign', 'ITextLayer.verticalalign L861-864', A(IMPL), '已实现（P-143；缺省 top 与 core:1587 一致）'],
  ['anchor', 'ITextLayer.anchor L867-870', A(GAP), '语料普查 0 命中；本仓文本锚点走 `alignment`（core 只读 `o.alignment`，没有 anchor 读取点）⇒ 登记为缺失'],
  ['emitParticles', 'IParticleSystem.emitParticles L979-982', L4(IMPL, NA), 'F1-F4 已实现（no-op + 计数 + `__psEmitRequest` 记档：本机无粒子发射注入点）；F5 na：' + F5_NA],
  ['instance', 'IParticleSystem.instance L984-987', L4(IMPL, NA), 'F1-F4 已实现（P-141：字段写穿 `obj.instanceoverride`，core 真读）；F5 na：' + F5_NA],
  ['rootmotion', 'IModelLayer.rootmotion L1091-1094', A(GAP), '语料普查 0 命中；本仓模型层不做 rootmotion 位移 ⇒ 登记为缺失'],
  ['fov', 'ICamera.fov L1127-1130（"For 3D scenes only"）', A(NA), '故意不实现：本仓 fov 走**场景级**通道（`thisScene.getCameraTransforms()` + `general.fov`，见 tests/camera-persp-test.mjs）；图层引用上再开一个入口就是第二套相机面 ⇒ 不提供'],
  ['zoom', 'ICamera.zoom L1132-1135', A(NA), '同上：语料唯一 1 处 `zoom` 也是 `thisScene.getCameraTransforms().zoom`（不是图层成员）⇒ 不提供第二入口'],
  ['origin', 'ILayer.origin L1143-1146', A(IMPL), '已实现（五面；P-143 起 nodeWrite 保节点 + 显式写优先）'],
  ['angles', 'ILayer.angles L1148-1151', A(IMPL), '★本批统一：F1 既有语义提成模块级单一实现挂五面（F2-F5 此前全缺）；语料 33 处/12 包（`{x,y,z}` 字面量与 Vec3 两种写法）'],
  ['scale', 'ILayer.scale L1153-1156', A(IMPL), '已实现（五面；语料 326 处/28 包）'],
  ['parallaxDepth', 'ILayer.parallaxDepth L1158-1161', A(IMPL), '★本批统一：写只落两段（官方是 Vec2）、接受 Vec2/Vec3/数组/串；语料 11 处/9 包全是 `new Vec2(…)`'],
  ['name', 'ILayer.name L1163-1166', A(IMPL), '已实现（五面）'],
  ['visible', 'ILayer.visible L1168-1171', A(IMPL), '已实现（五面；语料 494 处/31 包）'],
  ['getTransformMatrix', 'ILayer.getTransformMatrix L1173-1176', L4(IMPL, NA), 'F1-F4 已实现（行向量 4×4；语料 20 处/5 包）；F5 na：' + F5_NA],
  ['rotateObjectSpace', 'ILayer.rotateObjectSpace L1178-1181', A(GAP), '语料普查 0 命中；本仓旋转写入口是 `angles`（core 每帧从 angles 合成矩阵）⇒ 登记为缺失'],
  ['lookAt', 'ILayer.lookAt L1184-1189', A(GAP), '语料普查 0 命中 ⇒ 登记为缺失'],
  ['lookAtYaw', 'ILayer.lookAtYaw L1191-1196', A(GAP), '语料普查 0 命中 ⇒ 登记为缺失'],
  ['setParent', 'ILayer.setParent L1198-1208（两个重载）', A(GAP), '语料普查 0 命中；本仓父子关系在 core 的 world 重算里烘焙（运行时改父级要动那条链）⇒ 登记为缺失'],
  ['getParent', 'ILayer.getParent L1210-1213（"or undefined if the layer is not parented"）', L4(IMPL, NA), 'F1-F4 已实现；**本批之前 F3 不可达**（byId 挂错对象 ⇒ 永远返回空引用），本批修好后 F3 真能拿到父层（S1d-2/S4 钉住）；语料 117 处/6 包；F5 na：' + F5_NA],
  ['getChildren', 'ILayer.getChildren L1215-1218', A(GAP), '语料普查 0 命中；本仓子层表在 core 的 `childIds`/`hasChildren` 里 ⇒ 登记为缺失'],
  ['getAttachmentIndex', 'ILayer.getAttachmentIndex L1220-1223', A(GAP), GAP_ATTACH],
  ['getAttachmentMatrix', 'ILayer.getAttachmentMatrix L1225-1228', A(GAP), GAP_ATTACH],
  ['getAttachmentOrigin', 'ILayer.getAttachmentOrigin L1230-1233', A(GAP), GAP_ATTACH],
  ['getAttachmentAngles', 'ILayer.getAttachmentAngles L1235-1238', A(GAP), GAP_ATTACH],
  // ── 2.8 版（Steam 那份 d.ts）**多出来**的 14 个成员：主 d.ts（本文件的行号基准）里没有它们 ⇒
  //    单列登记，全部 gap（语料普查也是 0 命中）。不登记就会变成"官方有、表里没有"的灰区（S2-1 守这条）。
  ['limitrows', 'ITextLayer.limitrows（2.8 新增）', A(GAP), '2.8 增量 + 语料 0 命中；本仓文本限行走 core 载入时解析（`core:1592-1594 limitrows/limitwidth` 布尔）⇒ 登记为缺失'],
  ['maxrows', 'ITextLayer.maxrows（2.8 新增）', A(GAP), '2.8 增量 + 语料 0 命中；core 有 `maxrows: textNum(o.maxrows, 1)`（:1595）⇒ 下一步候选，登记为缺失'],
  ['limitwidth', 'ITextLayer.limitwidth（2.8 新增）', A(GAP), '2.8 增量 + 语料 0 命中；同 limitrows ⇒ 登记为缺失'],
  ['maxwidth', 'ITextLayer.maxwidth（2.8 新增）', A(GAP), '2.8 增量 + 语料 0 命中；core 有 `maxwidth: textNum(o.maxwidth, 0)`（:1584）与 textMaxwidth 消费链 ⇒ 下一步候选，登记为缺失'],
  ['getLocalBoneTransform', 'IImageLayer（2.8 新增）', A(GAP), GAP_BONE + '（2.8 增量）'],
  ['setLocalBoneTransform', 'IImageLayer（2.8 新增）', A(GAP), GAP_BONE + '（2.8 增量）'],
  ['getLocalBoneAngles', 'IImageLayer（2.8 新增）', A(GAP), GAP_BONE + '（2.8 增量）'],
  ['setLocalBoneAngles', 'IImageLayer（2.8 新增）', A(GAP), GAP_BONE + '（2.8 增量）'],
  ['getLocalBoneOrigin', 'IImageLayer（2.8 新增）', A(GAP), GAP_BONE + '（2.8 增量）'],
  ['setLocalBoneOrigin', 'IImageLayer（2.8 新增）', A(GAP), GAP_BONE + '（2.8 增量）'],
  ['getBlendShapeIndex', 'IImageLayer（2.8 新增）', A(GAP), '2.8 增量 + 语料 0 命中；本仓不解析 blend shape ⇒ 登记为缺失'],
  ['getBlendShapeWeight', 'IImageLayer（2.8 新增）', A(GAP), '2.8 增量 + 语料 0 命中；同上'],
  ['setBlendShapeWeight', 'IImageLayer（2.8 新增）', A(GAP), '2.8 增量 + 语料 0 命中；同上'],
]
/** 非官方成员（本仓/NSL 口径；官方 d.ts 里没有 ⇒ 单列，**不算**官方名单的一部分）。 */
const EXTRAS = [
  ['originalOrigin', [], A(IMPL), '非官方（d.ts/文档都 0 命中）：真机语料 3 处/3 包 + wer-ref 行为对照（P-143），依据强度=中'],
  ['debug', [], A(IMPL), '非官方：真机语料 24 处/5 包（含包内嵌库），依据强度=低，缺省 false（P-143 如实标注）'],
  ['getParticleSystem', [], L4(IMPL, NA), '非官方（语料 3 处/3 包的自造写法）；官方模型里"本层就是 IParticleSystem"⇒ 返回本层视图；F5 na'],
  ['clicked', [], L4(IMPL, NA), '非官方（NSL 光标面）：F1-F4 恒 false 占位；F5 na'],
  ['cursorDetected', [], L4(IMPL, NA), '非官方（NSL 光标面）：F1-F4 恒 false 占位；F5 na'],
  ['getMaterial', [], { F1_getLayer: GAP, F2_emptyLayerRef: GAP, F3_layerRefFor: GAP, F4_thisLayer: GAP, F5_thisObject: IMPL },
    '非官方：只有 `thisObject.getMaterial()` 这个历史入口（返回 `{}`）；其余面没有 ⇒ 单列'],
]

out('\nS2 覆盖矩阵：官方名单（' + OFFICIAL.length + '）× 五个面 × 三档')
{
  const allRows = CENSUS.concat(EXTRAS.map(([n, , t, w]) => [n, '（非官方）', t, w]))
  // ① 普查表自检：官方名单里每个成员都必须有且只有一行
  const rowsByName = new Map()
  for (const row of CENSUS) {
    if (rowsByName.has(row[0])) { rowsByName.get(row[0]).dup = true; continue }
    rowsByName.set(row[0], row)
  }
  const officialNames = OFFICIAL.map(([n]) => n)
  const officialAllNames = officialNames.concat(OFFICIAL_2_8_DELTA)
  const unclassified = officialNames.filter((n) => !rowsByName.has(n))
  const notOfficial = [...rowsByName.keys()].filter((n) => !officialAllNames.includes(n))
  ok('S2-0 官方 ' + officialNames.length + ' 个成员（+2.8 增量 ' + OFFICIAL_2_8_DELTA.length + '）全部被普查表分类（多一个/少一个都红）',
    unclassified.length === 0 && notOfficial.length === 0 && ![...rowsByName.values()].some((r) => r.dup),
    (unclassified.length ? ('未分类：' + unclassified.join(',')) : '') + (notOfficial.length ? (' 不在官方名单：' + notOfficial.join(',')) : '') || (officialNames.length + ' 个成员各有且只有一行'))
  // ② 2.8 增量成员也必须登记（按 gap 处理：主 d.ts 没有、语料 0 命中）
  const deltaUnlisted = OFFICIAL_2_8_DELTA.filter((n) => !allRows.some((r) => r[0] === n))
  ok('S2-1 2.8 增量 ' + OFFICIAL_2_8_DELTA.length + ' 个成员也有档位（不存在"官方有、表里没有"的灰区）',
    deltaUnlisted.length === 0, deltaUnlisted.length ? ('未登记：' + deltaUnlisted.join(',')) : '全部登记（gap：主 d.ts 无 + 语料 0 命中）')
  // ③ 逐格核对：impl 必在场（缺一项就红，点名成员+面）/ gap·na 必缺席 / 必须写清依据
  const implMissing = [], staleAbsent = [], noWhy = []
  for (const [name, src, tiers, why] of allRows) {
    for (const fk of FACE_KEYS) {
      const want = tiers[fk]
      const has = PRESENT[fk] && PRESENT[fk].has(name)
      if (want === IMPL) { if (!has) implMissing.push(name + '@' + fk) }
      else if (want === GAP || want === NA) {
        if (has) staleAbsent.push(name + '@' + fk + '(' + want + ')')
        if (!why || !String(why).trim()) noWhy.push(name + '@' + fk)
      } else implMissing.push(name + '@' + fk + '(档位非法:' + want + ')')
    }
  }
  ok('S2-2 ★覆盖矩阵：所有 `impl` 格子在对应面上**真实存在**（' + allRows.reduce((n, r) => n + FACE_KEYS.filter((k) => r[2][k] === IMPL).length, 0) + ' 格；缺一项即红并点名成员+面）',
    implMissing.length === 0, implMissing.length ? ('缺失：' + short(implMissing, 400)) : '无缺口')
  ok('S2-3 `gap`/`na` 格子在对应面上**确实不存在**（存在 ⇒ 普查表过期/漏登记，同样红）',
    staleAbsent.length === 0, staleAbsent.length ? ('表已过期：' + short(staleAbsent, 400)) : '无过期')
  ok('S2-4 每个 `gap`/`na` 格子都写清了依据（不许空白分档）', noWhy.length === 0,
    noWhy.length ? short(noWhy, 200) : ('gap=' + CENSUS.filter((r) => r[2].F1_getLayer === GAP).length + ' 行 / na=' + CENSUS.filter((r) => r[2].F1_getLayer === NA).length + ' 行，均有依据'))
  // ④ 汇总表（人可读；只打印非 impl 行 + 行列统计）
  const stat = {}
  for (const fk of FACE_KEYS) {
    stat[fk] = { impl: 0, gap: 0, na: 0 }
    for (const r of allRows) stat[fk][r[2][fk]] = (stat[fk][r[2][fk]] || 0) + 1
  }
  note('五面统计（impl/gap/na）', FACE_KEYS.map((k) => k + '=' + stat[k].impl + '/' + stat[k].gap + '/' + stat[k].na).join('  '))
  for (const [name, src, tiers, why] of allRows) {
    if (tiers.F1_getLayer === IMPL && FACE_KEYS.every((k) => tiers[k] === IMPL)) continue
    note('档位 ' + name, FACE_KEYS.map((k) => k.replace(/^(F\d)_[a-zA-Z]+$/, '$1') + ':' + tiers[k]).join(' ') + (tiers.F5_thisObject === NA ? '' : ''))
  }
}

/* ═══════════════════════════ 5. S3 `volume` 行为（J 组）═══════════════════════════ */
out('\nS3 ISoundLayer.volume 行为（读 / 写 / 保节点 / 非有限 / clamp / 空引用 / 计数 / 控制器）')
resetSceneScriptApiDiag()
{
  // J1 读：authored 节点（无用户属性传入 ⇒ 节点 value；soundprops 不存在）
  ok('S3a 读：authored `volume` 是 `{user:"bgm", value:0.8}` ⇒ F1/F3/F4/F5 都读 **0.8**（typeof number；不是节点对象、不是 undefined）',
    ['F1_getLayer', 'F3_layerRefFor', 'F4_thisLayer', 'F5_thisObject'].every((k) => SNAP[k].volume === 0.8)
    && SNAP.F2_emptyLayerRef.volume === 1,
    'F1=' + SNAP.F1_getLayer.volume + ' F3=' + SNAP.F3_layerRefFor.volume + ' F4=' + SNAP.F4_thisLayer.volume
    + ' F5=' + SNAP.F5_thisObject.volume + ' F2(空引用)=' + SNAP.F2_emptyLayerRef.volume)
  // J2 空引用给缺省 1（不是 undefined/NaN）
  ok('S3b 空引用（F2 = `thisLayer.getParent()` 在根层上）读 **1**（有限数缺省；不是 undefined/NaN）',
    SNAP.F2_emptyLayerRef.volume === 1 && FACES.F2_emptyLayerRef.volume === 1, String(SNAP.F2_emptyLayerRef.volume))
  // J3 缺字段 ⇒ 1
  ok('S3c 层上根本没有 `volume` 字段 ⇒ 读 **1**（渲染器 parse 的 `parseNum(o.volume, 1)` 同款缺省）',
    (() => {
      const objects = baseObjects(); delete objects[0].volume
      const r = runTicks(mkScene(objects), 1, { userProps: {} })
      return r.shared.__snap.F1_getLayer.volume === 1 && r.shared.__snap.F5_thisObject.volume === 1
    })(), '1')
  // J4 soundprops 是渲染器模型的落点 ⇒ 优先于 authored 节点
  ok('S3d 读：`soundprops.volume` 在场时读 **0.42**（渲染器模型落点优先于 authored 节点的 0.8 ⇒ 读到的就是屏幕上用的那个数）',
    (() => {
      const objects = baseObjects(); objects[0].soundprops = { volume: 0.42, playbackmode: 'loop' }
      const r = runTicks(mkScene(objects), 1, { userProps: {} })
      return r.shared.__snap.F1_getLayer.volume === 0.42 && r.shared.__snap.F3_layerRefFor.volume === 0.42
    })(), '0.42')
  // J5 活控制器 soundCtl 最优先
  ok('S3e 读顺位①：`soundCtl.getVolume()` 在场时读 **0.9**（真作用于播放流的那个数优先于 soundprops 的 0.42）',
    (() => {
      const objects = baseObjects()
      objects[0].soundprops = { volume: 0.42 }
      objects[0].soundCtl = { _v: 0.9, getVolume() { return this._v }, setVolume(v) { this._v = v } }
      const r = runTicks(mkScene(objects), 1, { userProps: {} })
      return r.shared.__snap.F1_getLayer.volume === 0.9
    })(), '0.9')
  // J6 用户属性绑定优先于节点 value（demo.html currentAudioVolume 同款）
  {
    const b = buildFaces({ userProps: { bgm: 0.3 } })
    ok('S3f 读顺位③：`volume` 是 `{user:"bgm",…}` 且用户属性 bgm=0.3 ⇒ 读 **0.3**（用户属性活值即屏幕值；帧末清空 ⇒ 帧外退回节点 value 0.8）',
      b.snap.F1_getLayer.volume === 0.3 && makeSceneRef(b.objects).getLayer('R').volume === 0.8,
      '帧内=' + b.snap.F1_getLayer.volume + ' 帧外=' + makeSceneRef(b.objects).getLayer('R').volume)
  }
  // J7 写穿三处落点（五个面各写一次，落点必须相同）+ 保节点 + 读回
  for (const fk of ['F1_getLayer', 'F2_emptyLayerRef', 'F3_layerRefFor', 'F4_thisLayer', 'F5_thisObject']) {
    const expr = fk === 'F1_getLayer' ? "thisScene.getLayer('R')"
      : fk === 'F2_emptyLayerRef' ? 'thisLayer.getParent()'
        : fk === 'F3_layerRefFor' ? "thisScene.getLayer('C').getParent()"
          : fk === 'F4_thisLayer' ? 'thisLayer' : 'thisObject'
    const s = scen(`${expr}.volume = 0.25;\n  shared.after = ${expr}.volume;`)
    const R = s.R
    const expectLanding = fk !== 'F2_emptyLayerRef'
    ok('S3g-' + fk + ' 写穿：`' + expr + '.volume = 0.25` ⇒ ' + (expectLanding
      ? '`R.soundprops.volume === 0.25` **且** authored 节点 `value === 0.25` 且立刻读回 0.25'
      : '空引用 ⇒ **不落盘**（R 一位不变、不抛错 —— 写入被 `!obj` 分支拒掉）'),
      expectLanding
        ? (R.soundprops && R.soundprops.volume === 0.25 && R.volume && R.volume.value === 0.25 && s.shared.after === 0.25 && s.total === 0)
        : (!R.soundprops && R.volume && R.volume.value === 0.8 && s.total === 0),
      'soundprops=' + short(R.soundprops) + ' volume=' + short(R.volume) + ' 写后读回=' + short(s.shared.after) + ' errs=' + s.total)
  }
  // J8 保作者节点（三键 `{script,user,value}`：写只动 value）
  {
    const objects = baseObjects()
    // 真包 `0923/2887099508` 的 'HF' 层就是这种三键节点（script + user + value 同时存在）
    objects[0].volume = { script: 'var a=1;', user: 'bgm', value: 0.7 }
    objects[0].__probe = { script: `'use strict';\nexport function update(value) { thisLayer.volume = 0.2; return value; }`, value: 'probe' }
    const r = runTicks(mkScene(objects), 1, { userProps: {} })
    ok('S3h 保作者节点：`{script,user,value}` 节点写后其它键逐一保留（script/user 原样、只有 value 变 0.2）',
      objects[0].volume.script === 'var a=1;' && objects[0].volume.user === 'bgm' && objects[0].volume.value === 0.2 && r.total === 0,
      short(objects[0].volume) + ' errs=' + r.total)
  }
  {
    const s = scen("thisScene.getLayer('R').volume = 0.4;\n  shared.before = JSON.stringify(thisScene.getLayer('R').volume);")
    const R = s.R
    const before = JSON.stringify(R.volume)
    const beforeSp = JSON.stringify(R.soundprops)
    const s2 = scen("thisScene.getLayer('R').volume = 0.4; thisScene.getLayer('R').volume = NaN; thisScene.getLayer('R').volume = undefined; thisScene.getLayer('R').volume = Infinity; thisScene.getLayer('R').volume = 'abc';")
    ok('S3i 非有限值**不落盘**：NaN / undefined / Infinity / `\'abc\'` 四次写之后节点与 soundprops 一位没变（仍是 0.4）',
      JSON.stringify(s2.R.volume) === before && JSON.stringify(s2.R.soundprops) === beforeSp
      && !!s2.R.soundprops && s2.R.soundprops.volume === 0.4 && s2.total === 0,
      'volume=' + short(s2.R.volume) + ' soundprops=' + short(s2.R.soundprops))
    void s
  }
  // J10 clamp[0,1]
  {
    const s = scen("thisScene.getLayer('R').volume = 1.5;\n  shared.hi = thisScene.getLayer('R').volume;\n  thisScene.getLayer('R').volume = -2;\n  shared.lo = thisScene.getLayer('R').volume;")
    ok('S3j clamp[0,1]：写 1.5 ⇒ 落 **1** 且读回 1；写 -2 ⇒ 落 **0**（播放端 `Math.min(1, Math.max(0, …))` 同款 ⇒ 读回值 = 屏幕值）',
      !!s.R.soundprops && s.R.soundprops.volume === 0 && s.shared.hi === 1 && s.shared.lo === 0,
      '1.5→' + s.shared.hi + ' -2→' + s.shared.lo + ' soundprops=' + short(s.R.soundprops))
  }
  // J11 soundCtl.setVolume 真被调用；空引用写安全
  {
    const objects = baseObjects()
    const seen = []
    objects[0].soundCtl = { getVolume: () => 0.5, setVolume: (v) => seen.push(v) }
    objects[0].__probe = {
      script: `'use strict';
export function update(value) {
  const before = Object.keys(thisScene.getLayer('R')).length;
  thisScene.getLayer('C').getParent().volume = 0.6;
  thisLayer.getParent().volume = 0.9;
  shared.__j11 = [before, Object.keys(thisScene.getLayer('R')).length];
  return value;
}`, value: 'probe',
    }
    const r = runTicks(mkScene(objects), 1, { userProps: {} })
    ok('S3k 活控制器：写 0.6 ⇒ `soundCtl.setVolume(0.6)` 被调用；空引用(F2)上写 0.9 **不抛错**、不往真层上加键（键数不变）',
      seen.length === 1 && seen[0] === 0.6 && r.shared.__j11 && r.shared.__j11[0] === r.shared.__j11[1] && r.total === 0,
      'setVolume=' + short(seen) + ' 键数=' + short(r.shared.__j11) + ' errs=' + r.total)
  }
  const d = sceneScriptApiDiag()
  ok('S3l 可观测：四个 volume 计数都动过（读 ≥ 10 / 写 ≥ 5 / 拒绝 ≥ 5 / clamp ≥ 2）',
    d.volumeRead >= 10 && d.volumeWrite >= 5 && d.volumeWriteRejected >= 5 && d.volumeClamp >= 2,
    short({ read: d.volumeRead, write: d.volumeWrite, rejected: d.volumeWriteRejected, clamp: d.volumeClamp }))
}

/* ═══════════════════════════ 6. S4 五面同源（K 组）═══════════════════════════ */
out('\nS4 五面同源：同一对 get/set 函数对象 + 同一状态下读数一致')
{
  for (const m of Object.keys(LAYER_REF_MEMBER_ACCESSORS)) {
    const descs = FACE_KEYS.map((k) => [k, FACES[k] ? Object.getOwnPropertyDescriptor(FACES[k], m) : null])
    const bad = descs.filter(([, d]) => !d || !d.get || d.get !== LAYER_REF_MEMBER_ACCESSORS[m].get || d.set !== LAYER_REF_MEMBER_ACCESSORS[m].set)
    ok('S4 identity ' + m + '：五个面上的访问器与 `LAYER_REF_MEMBER_ACCESSORS.' + m + '` 是**同一个函数对象**（一套实现挂在五处，不是五份复制）',
      bad.length === 0, bad.length ? ('不是同源：' + bad.map(([k]) => k).join(',')) : '5/5 同源')
  }
  // 行为等价：F1/F3/F4/F5 指向同一层 ⇒ 六个成员读数必须逐一相同（F2 是空引用，按缺省单列）
  for (const m of Object.keys(LAYER_REF_MEMBER_ACCESSORS)) {
    const vals = ['F1_getLayer', 'F3_layerRefFor', 'F4_thisLayer', 'F5_thisObject'].map((k) => String(SNAP[k][m]))
    const same = vals.every((v) => v === vals[0])
    ok('S4 equiv ' + m + '：F1/F3/F4/F5 指向同一层 ⇒ 四个面读同一个值（' + short(vals[0], 40) + '）',
      same, same ? '4/4 一致' : short(vals))
  }
  ok('S4 empty：空引用（F2）六项全是**有限/合法缺省**（angles `0 0 0` / color `1 1 1` / 视差 `1 1 0` / center / alpha 1 / volume 1）',
    SNAP.F2_emptyLayerRef.angles === '0 0 0' && SNAP.F2_emptyLayerRef.color === '1 1 1'
    && SNAP.F2_emptyLayerRef.parallaxDepth === '1 1 0' && SNAP.F2_emptyLayerRef.alignment === 'center'
    && SNAP.F2_emptyLayerRef.alpha === 1 && SNAP.F2_emptyLayerRef.volume === 1,
    short(SNAP.F2_emptyLayerRef))
}

/* ═══════════════════════════ 7. S5 真包（改前/改后读数写进断言说明）═══════════════════════════ */
out('\nS5 真包 0923/2887099508：`thisScene.getLayer(\'桥\')[\'volume\']` 改前读不到 → 改后真落到 soundprops.volume')
{
  const rel = '0923/2887099508/scene.pkg'
  const p = path.join(ALLWALLPAPER, rel)
  if (!fs.existsSync(p)) skipItem('S5 真包 ' + rel, '语料不存在')
  else {
    let sj = null
    try { sj = JSON.parse(readSceneJsonText(p).replace(/^\uFEFF/, '')) } catch { sj = null }
    const authorNode = sj && sj.objects[76]
    const anchored = !!(authorNode && JSON.stringify(authorNode).includes("['volume']=0x1"))
    ok('S5a 锚点：objects[76] 的作者脚本里确实有 `thisScene[\'getLayer\'](\'…\')[\'volume\']=0x1` 一族写法（本判据的真包依据）',
      anchored, anchored ? '锚点命中（该脚本 6 处写 volume：桥/XR/HF/BBB/CCC/…）' : '**锚点未命中**（语料换版？）')
    const bridgeIdx = sj.objects.findIndex((o) => o && o.name === '桥')
    const bridge = sj.objects[bridgeIdx]
    ok('S5a2 \'桥\' 层结构：sound 层 + authored `volume={user:"bgm",value:1}`（写穿必须保住 user 键）',
      !!bridge && Array.isArray(bridge.sound) && bridge.sound.length > 0
      && bridge.volume && bridge.volume.user === 'bgm' && bridge.volume.value === 1,
      'objects[' + bridgeIdx + '] sound=' + short(bridge && bridge.sound) + ' volume=' + short(bridge && bridge.volume))
    // 探针：读 → 写 → 读回（**同一个 applySceneScripts，共用一个 cache**）
    bridge.__probeVolume = {
      script: `'use strict';
export function update(value) {
  const l = thisScene.getLayer('桥');
  shared.__j = Object.assign(shared.__j || {}, {
    t: typeof l.volume, v: l.volume,
    hasOwn: Object.keys(l).indexOf('volume') >= 0,
    spBefore: JSON.stringify(l.soundprops === undefined ? null : l.soundprops),
  });
  l['volume'] = 0;                 // 先写 0（渲染器模型落点 soundprops.volume 从这一刻起存在 ⇒ 读回走它）
  shared.__j.zero = l.volume;
  l['volume'] = 0.25;              // 再写 0.25（最后一次写决定落点终值）
  shared.__j.after = l.volume;
  shared.__j.afterType = typeof l.volume;
  return value;
}`, value: 'probe',
    }
    const r = runTicks(sj, 1, { userProps: {} })
    const J = r.shared.__j || {}
    ok('S5b 读（改前 = `typeof \'undefined\'`、值 undefined、不是自有键）：现在 typeof=\'number\'、值 = **1**（authored 节点 value）',
      J.t === 'number' && J.v === 1 && J.hasOwn === true && r.total === 0,
      '改前实测={"t":"undefined","keys":false} → 现在=' + short({ t: J.t, v: J.v, hasOwn: J.hasOwn }) + ' errs=' + r.total)
    ok('S5c ★落点（改前：写 0.25 后 `桥.volume` 仍是 `{user:"bgm",value:1}`、**没有** soundprops 键）：现在写 0 落 `soundprops.volume=0`、写 0.25 落 **0.25**（读回也走 soundprops ⇒ 0 → 0.25）',
      J.spBefore === 'null' && bridge.soundprops && bridge.soundprops.volume === 0.25
      && J.zero === 0 && J.after === 0.25 && J.afterType === 'number',
      '写前 soundprops=' + short(J.spBefore) + '（改前实测 = null 一位没变） → 写 0 读回=' + J.zero + ' → 写 0.25 读回=' + J.after
      + ' ⇒ 跑完 `桥.soundprops=' + short(bridge.soundprops) + '`')
    ok('S5d 保作者节点：`桥.volume` 仍是 `{user:"bgm",…}` 节点（`user` 键保留）且 value 跟着脚本走（最终 0.25）—— 改前 value 一位没动（永远 1）',
      bridge.volume && bridge.volume.user === 'bgm' && bridge.volume.value === 0.25,
      '最终 `桥.volume=' + short(bridge.volume) + '`（键：' + Object.keys(bridge.volume || {}).join(',') + '）')
    // 用户属性优先（屏幕值）：同一个包、同一个层，bgm=0.4 ⇒ 读到 0.4
    delete bridge.__probeVolume
    const withSoundprops = bridge.soundprops ? bridge.soundprops.volume : null
    delete bridge.soundprops                       // 宿主侧清掉上一支探针留下的渲染器模型落点
    bridge.__probeVolume = {
      script: `'use strict';
export function update(value) { shared.__k = thisScene.getLayer('桥').volume; return value; }`, value: 'probe',
    }
    const r2 = runTicks(sj, 1, { userProps: { bgm: 0.4 } })
    delete bridge.__probeVolume
    ok('S5e 用户属性绑定优先：soundprops 清掉后传 `userProps={bgm:0.4}` ⇒ 读到 **0.4**（demo.html `currentAudioVolume` 同款：用户值即屏幕值）；soundprops 在场时它优先（读到 ' + withSoundprops + '）',
      r2.shared.__k === 0.4 && r2.total === 0, '读到=' + short(r2.shared.__k) + '（soundprops 在场时=' + withSoundprops + '）errs=' + r2.total)
  }
}

/* ═══════════════════════════ 8. S6 变异自证 ×4 ═══════════════════════════ */
if (IS_MUTANT_RUN) note('S6 变异体运行（MPW_SCENE_SCRIPTS 已设）⇒ 跳过自检，避免递归')
else if (!MUTATION) note('S6 红-if-reverted 自检被 --no-mutation 跳过（本次运行**未**复核变异必红）')
else {
  out('\nS6 红-if-reverted ×4：摘掉 F4 的 volume / 写穿落到错槽 / 去掉"非有限值不落盘" / 把 byId 修复回退')
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
  const pristine = path.join(tmpEly, 'scene-scripts.js')
  fs.writeFileSync(pristine, fs.readFileSync(MODULE))
  const runCopy = () => spawnSync(process.execPath, [process.argv[1], '--no-mutation'], {
    encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { MPW_SCENE_SCRIPTS: pristine }),
  })
  const failNamesOf = (s) => {
    const set = new Set()
    for (const m of String(s).matchAll(/^\s*✗\s+(.+?)(?:\s{2}\[|$)/gm)) set.add(m[1].trim())
    return set
  }
  const rc = runCopy()
  const rcOut = String(rc.stdout || '') + String(rc.stderr || '')
  const baseRed = failNamesOf(rcOut)
  ok('S6-0 对照组：未变异的 /tmp 副本跑本文件全绿（rc=0）',
    rc.status === 0 && /ALL PASS/.test(rcOut) && baseRed.size === 0,
    'rc=' + rc.status + ' ' + ((rcOut.match(/\(计票：[^)]*\)/) || [''])[0]))
  if (VERBOSE && rc.status !== 0) note('S6-0 副本输出尾部', short(rcOut.slice(-900), 500))

  const SRC = fs.readFileSync(MODULE, 'utf8')
  const MUTANTS = [
    {
      id: 'V1', fix: 'volume 挂在 F4（thisLayer）上',
      desc: '把 F4 的挂载表里的 volume 摘掉（只摘一个面 ⇒ `thisLayer.volume` 回到 undefined）',
      anchor: "      cursorDetected: false,\n      clicked: false,\n    }, cur), LAYER_REF_MEMBER_ACCESSORS);",
      to: "      cursorDetected: false,\n      clicked: false,\n    }, cur), (() => { const s = Object.assign({}, LAYER_REF_MEMBER_ACCESSORS); delete s.volume; return s })());",
      // 实测红集（/tmp 变异体跑本文件 --no-mutation 的 ✗ 名单；含两条级联：S3h 写不进去、S3a 快照缺 F4）
      expect: ['S2-2', 'S3a', 'S3g-F4_thisLayer', 'S3h', 'S4 identity volume', 'S4 equiv volume'],
    },
    {
      id: 'V2', fix: 'volume 的写穿落点（obj.soundprops.volume）',
      desc: '让写穿不建/不写 soundprops（= 回到"只写 authors 节点"的错落点）',
      anchor: "  const sp = soundPropsFor(obj);\n  if (sp) nodeWrite(sp, 'volume', c);",
      to: "  const sp = null;   // MUTANT\n  if (sp) nodeWrite(sp, 'volume', c);",
      // 实测红集：四个面的写穿断言 + 两条级联（非有限/clamp 也读不到落点）+ 真包落点 S5c
      expect: ['S3g-F1_getLayer', 'S3g-F3_layerRefFor', 'S3g-F4_thisLayer', 'S3g-F5_thisObject', 'S3i', 'S3j', 'S5c'],
    },
    {
      id: 'V3', fix: '"非有限值不落盘"这条守门',
      desc: '去掉 `Number.isFinite` 检查（NaN/Infinity 会真的写进节点与 soundprops）',
      anchor: "  if (!Number.isFinite(n)) { apiBump('volumeWriteRejected'); return false }   // ⚠ 非有限值不落盘",
      to: "  if (false) { apiBump('volumeWriteRejected'); return false }   // MUTANT",
      expect: ['S3i', 'S3l'],   // 实测红集：非有限值断言 + 计数断言（拒绝次数掉到 0）
    },
    {
      id: 'V4', fix: 'byId 修复（F3 layerRefFor 可达）',
      desc: '把 `buildById` 改回"挂在返回壳上"（⇒ `ref.byId` 恒 undefined ⇒ F3 退回空引用）',
      anchor: "      const inner = (r.ref && typeof r.ref === 'object') ? r.ref : r;",
      to: "      const inner = r;   // MUTANT",
      // 实测红集：F3 退回空引用 ⇒ 身份断言 + 三条 F3 读值断言 + 五个 equiv（alignment 恰好仍等于缺省 'center' ⇒ 不在名单里）
      expect: ['S1d-2', 'S3a', 'S3d', 'S4 equiv alpha', 'S4 equiv angles', 'S4 equiv color', 'S4 equiv parallaxDepth', 'S4 equiv volume'],
    },
  ]
  for (const m of MUTANTS) {
    const file = path.join(tmpEly, m.file || 'scene-scripts.js')
    const src = fs.readFileSync(file, 'utf8')
    const n = src.split(m.anchor).length - 1
    if (n !== 1) {
      skipItem('mutation-selfcheck ' + m.id, '锚点命中 ' + n + ' 次：' + JSON.stringify(String(m.anchor).slice(0, 70)) + '（需重新标定；不做变异＝不算证据）')
      continue
    }
    fs.writeFileSync(file, src.split(m.anchor).join(m.to))
    const r = runCopy()
    const so = String(r.stdout || '') + String(r.stderr || '')
    const red = failNamesOf(so)
    const expected = new Set(m.expect)
    const missingRed = [...expected].filter((e) => ![...red].some((x) => x.startsWith(e)))
    const unexpectedRed = [...red].filter((x) => ![...expected].some((e) => x.startsWith(e)))
    const exact = missingRed.length === 0 && unexpectedRed.length === 0
    ok('S6-' + m.id + '（' + m.fix + '）变异「' + m.desc + '」⇒ 子进程 rc=1 且**期望红集 == 实际红集**',
      r.status === 1 && exact,
      'rc=' + r.status + ' 期望=' + short(m.expect, 160) + ' 实际=' + short([...red], 200)
      + (missingRed.length ? (' 少红=' + short(missingRed, 120)) : '') + (unexpectedRed.length ? (' 多红=' + short(unexpectedRed, 160)) : ''))
    if (r.status === 1 && exact) out('  MUTANT-RED-OK ' + m.id + '  期望红集 ' + m.expect.length + ' 项 == 实际红集 ' + red.size + ' 项')
    if (VERBOSE && !exact) note('S6-' + m.id + ' 子进程输出尾部', short(so.slice(-1200), 600))
    fs.writeFileSync(file, src)   // 还原（下一个变异体从干净副本开始）
  }
}

/* ═══════════════════════════ 9. 汇总 ═══════════════════════════ */
const peak = (() => { try { const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/); return m ? Math.round(+m[1] / 1024) + 'MB' : '?' } catch { return '?' } })()
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skip + '；PeakRSS=' + peak + ')')
if (fail) { out('\n' + fail + ' 项失败'); process.exit(1) }
out('\nALL PASS （' + pass + ' 项' + (skip ? '，另 SKIP ' + skip : '') + '）')

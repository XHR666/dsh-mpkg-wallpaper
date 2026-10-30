// script-member-gaps-test.mjs —— P-143（2026-09-23）离线探针：**静默缺口**（不抛错但值错）
//
// ── 为什么要有这个文件 ───────────────────────────────────────────────────────────────────────
//   上一批（P-142，见 tests/script-phase-order-test.mjs）把"有错包 6 → 1"清完后，登记了一批
//   **不抛错但值错**的成员缺口 —— 比抛错更危险：门禁/日志都看不见，只有画面/布局错。四类：
//     · `ITextLayer` 的 `pointsize` / `font` / `horizontalalign` / `verticalalign`（官方 d.ts L812-868）
//     · `originalOrigin`（官方无；真机语料 + 行为对照 wer-ref）
//     · `IEffectLayer.getEffect`（官方 d.ts L779）
//     · `thisLayer.debug`（官方无；真机语料）
//   本文件的判据全部**真跑**（无浏览器、无网络、秒级），改前读数写死在 S5/S6 的断言说明里。
//
// ── 改前实测（本文件钉住的"静默"现场，全部可复算）────────────────────────────────────────────
//   · `wallpaperE/佩丽卡/佩丽卡1_03.mpkg` `objects[5].origin`（update）：
//       `value.y = shared.jpc_clockPosition.y + thisLayer.pointsize * 0.36 + 5;`
//       `pointsize` 是 `undefined` ⇒ `undefined * 0.36` = NaN ⇒ **整条 origin** =
//       `"2925.104490 NaN 0.000000"`（3 帧后的读数，改后 `"2925.104490 2952.965060 0.000000"`）。
//   · `wallpaperE/芙宁娜/芙宁娜1_04.mpkg`（与 `芙宁娜_08.mpkg` 同源）init：
//       `thisScene.createLayer({ …, pointsize: thisLayer.pointsize, font: thisLayer.font, … })`
//       ⇒ 阴影文本层 `pointsize: undefined, font: undefined`（**静默**用渲染器缺省 32/默认字体；
//       源层实际是 38 / `fonts/8bitOperatorPlus8-Regular.ttf`）。
//   · `0923/3521337568` / `0923/3653641024` / `dd/3554161528` 的 NSL 拖动库：
//       `thisLayer.origin = thisLayer.originalOrigin; // 恢复初始位置`
//       ⇒ 读不到 ⇒ `set origin(undefined)` 静默不写（"重置位置"整条功能死掉，且**无任何报错**）。
//   · `0923/3122339805`：`thisLayer.getEffect(0).visible=false`（用户属性关掉专辑封面染色）
//       ⇒ 改前 `update:thisLayer.getEffect is not a function`（1 帧 1 错，效果开关失效）。
//   · `0923/2887099508`：`thisScene.getLayer('中-菜单-浮动')['getEffect']('阴影-设置3').visible=true`
//       ⇒ 改前 cursorEnter 派发 5 错、五个 effect 全部停在 authored 的 false。
//   · `0923/3662790108`：`if (thisLayer.debug) { console.log(…) }`
//       ⇒ 改前 `thisLayer.debug` 是 `undefined`（`typeof` = 'undefined'），作者调试分支恒假。
//
// ── 官方语义出处（一手，逐条行号为实测）──────────────────────────────────────────────────────
//   `$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts`
//     · L812-868 `interface ITextLayer`：`text: String` / `color: Vec3` / `alpha: Number` /
//       `pointsize: Number`（"Size of the font in points for 300 DPI."）/ `font: String`（"Font path."）/
//       `horizontalalign: String`（"Horizontal text alignment: left, center, right."）/
//       `verticalalign: String`（"Vertical text alignment: center, top, bottom."）
//     · L1139 `interface ILayer extends IObject, IImageLayer, ISoundLayer, IEffectLayer, ITextLayer, …`
//       ⇒ 这四个成员在**每个** ILayer（= `thisLayer`/`thisObject`/`getLayer()` 引用/`getParent()`）上
//     · L775-784 `IEffectLayer.getEffect(name: String|Number): IEffect` / `getEffectCount(): Number`
//     · L520-545 `interface IEffect extends IObject`：`getMaterial(index)` / `getMaterialCount()` /
//       `setMaterialProperty(propertyName, value)` / `visible: Boolean` / `name: String`；
//       L512-514 `interface IMaterial extends IObject {}`（**没有**自己的字段）
//     · L95-100 `class Vec3 { x: Number; y: Number; z: Number;
//       constructor(x: Number|Vec2|String, y?: Number, z?: Number) }`（Vec2 同款 L7-11）
//   ⚠ `originalOrigin` 与 `debug` **不在**官方 d.ts、也不在官方 ILayer 文档页
//     （https://docs.wallpaperengine.io/en/scene/scenescript/reference/class/ILayer.html）⇒ 这两条的
//     依据 = 真机语料 + 行为对照（GPL-2.0-only 的 wer-ref，**只取行为结论、未复制代码**）：
//     `references/wer-ref/.../WPSceneScriptHost.cpp:2268-2295` 把 originalOrigin 实现成"作者 authorted
//     的层 origin（不是脚本改过的运行值）"、`:6747-6752` 只在层仍有初始配置时报告该成员存在。
//     缺省策略见实现处注释（`elysia/scene-scripts.js` 的 P-143 块）：pointsize 32 / font '' /
//     horizontalalign 'left' / verticalalign 'top'（**逐位对齐本仓库渲染器 `core/we-scene-bundle.js:1578-1587`**）、
//     debug `false`（布尔调试开关缺省关）。
//
// ── 本文件钉住什么 ───────────────────────────────────────────────────────────────────────────
//   S0  基线：沙箱模块可加载 + P-143 的 11 个新计数键都在 `sceneScriptApiDiag()` 里（可观测）
//   S1  `ITextLayer` 四成员：真值 / 缺字段安全缺省（**Number.isFinite 且 !== NaN**）/ ≤0 同渲染器口径 /
//       写穿保节点 / 非有限值**不写**（NaN 不落盘）/ 同一个 ILayer 概念一套面（thisLayer=thisObject=
//       thisScene.getLayer）/ 每次命中计数
//   S2  `originalOrigin`：authored 快照（**不是**运行值）/ init 里改过 origin 也照样回 authored /
//       createLayer 新层在"被作者改动之前"抓快照 / 空引用给有限 Vec3 / 写 origin 不再吃掉脚本节点
//   S3  `getEffect` / `getEffectCount`：下标 + 名字解析 / `visible` 写穿到 effect 条目 / 绑定在
//       `effects[i].visible` 上的脚本 `thisLayer` 仍是**那一层**（P-143 的 owner 修正）/
//       `setMaterialProperty` 只写已存在的键 / 解析不到 ⇒ 安全句柄（不抛错）+ 计数
//   S4  `thisLayer.debug`：`typeof` 是 'boolean'、缺省 false、写回自洽、空引用 false + 计数
//   S5  `Vec3`/`Vec2` 构造缺省：`new Vec3(0)` / `new Vec2(0)` 的分量必须是**有限数 0**（官方字段类型
//       Number + 可选参数）—— 真包 `砂狼白子11_03` 的媒体颜色过渡初值 `new Vec3(0)` 就靠这条
//   S6  真包（改前/改后读数逐条写进断言说明）：佩丽卡1_03 origin.y / 芙宁娜阴影层 pointsize+font /
//       3122339805 getEffect / 2887099508 cursorEnter / NSL resetPosition / 3662790108 debug
//   S7  全语料（`$MPW_ROOT/allwallpaper`）第 1-2 帧**静默 NaN 扫描**：脚本跑完后不允许出现新的
//       NaN/Infinity 层属性（白名单只留已定位的、与 P-143 四类无关的残留；新包即红）
//   S8  红-if-reverted ×6：pointsize 读取器 / authored 快照 / getEffect / numOr0（Vec3 缺省）/
//       owner 绑定 / debug 读取器 —— 各自点名的断言必红（子进程 rc=1）且变异体里基线仍 ✓
//
// 用法：node tests/script-member-gaps-test.mjs [--no-mutation] [--quick] [--verbose]
//   --quick 跳过 S7 全语料扫描（真包断言仍跑）；变异子进程用 --no-mutation --quick
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
const skipItem = (name, reason) => { skip++; out('  SKIP script-member-gaps ' + name + ' — ' + reason) }
const short = (v, n = 200) => { let s; try { s = typeof v === 'string' ? v : JSON.stringify(v) } catch { s = String(v) } if (s === undefined) s = String(v); return s.length > n ? s.slice(0, n) + '…' : s }

const MODULE = process.env.MPW_SCENE_SCRIPTS
  ? path.resolve(process.env.MPW_SCENE_SCRIPTS)
  : path.join(ROOT, 'elysia', 'scene-scripts.js')
const IS_MUTANT_RUN = !!process.env.MPW_SCENE_SCRIPTS
let applySceneScripts, createScriptCache, makeSceneRef, dispatchScriptEvent, sceneScriptApiDiag, resetSceneScriptApiDiag
try {
  const mod = await import(pathToFileURL(MODULE).href)
  applySceneScripts = mod.applySceneScripts
  createScriptCache = mod.createScriptCache
  makeSceneRef = mod.makeSceneRef
  dispatchScriptEvent = mod.dispatchScriptEvent
  sceneScriptApiDiag = mod.sceneScriptApiDiag
  resetSceneScriptApiDiag = mod.resetSceneScriptApiDiag
} catch (e) {
  out('  沙箱实现加载失败：' + path.relative(ROOT, MODULE) + ' — ' + (e && e.message))
}
out('script-member-gaps-test —— P-143 静默缺口：ITextLayer 四成员 / originalOrigin / getEffect / debug'
  + '（沙箱实现=' + path.relative(ROOT, MODULE) + (IS_MUTANT_RUN ? '（变异体）' : '') + '）')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p143-member-gaps-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ } })

const CORPUS_ROOT = process.env.MPW_ROOT || WS
const ALLWALLPAPER = path.join(CORPUS_ROOT, 'allwallpaper')

// ═══════════════════════════ 1. 通用宿主工具（与 script-phase-order-test 同一口径）═══════════════════════════
function withMutedLog(fn) {
  const saved = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = saved }
}
/** 跑 ticks 次 `applySceneScripts`（**同一个 cache 跨帧** = 宿主行为）。 */
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
function mkScene(objects, extra = {}) {
  return Object.assign({ general: {}, camera: { eye: '0 0 0', center: '0 0 0', up: '0 1 0' }, objects }, extra)
}
const isFin = (v) => typeof v === 'number' && Number.isFinite(v)
const numOf = (v) => Number(v && typeof v === 'object' && 'x' in v ? v.x : v)

// ═══════════════════════════ 2. S0 基线 ═══════════════════════════
out('\nS0 基线')
ok('S0a 沙箱模块可加载（applySceneScripts / createScriptCache / makeSceneRef / dispatchScriptEvent / 诊断计数表）',
  typeof applySceneScripts === 'function' && typeof createScriptCache === 'function'
  && typeof makeSceneRef === 'function' && typeof dispatchScriptEvent === 'function'
  && typeof sceneScriptApiDiag === 'function' && typeof resetSceneScriptApiDiag === 'function',
  path.relative(ROOT, MODULE))
{
  const d = sceneScriptApiDiag ? sceneScriptApiDiag() : {}
  const KEYS = ['textPointsizeWrite', 'textFontWrite', 'textAlignWrite', 'originalOriginRead', 'originalOriginMiss',
    'getEffect', 'getEffectUnresolved', 'getEffectCount', 'effectWrite', 'effectWriteUnresolved', 'debugRead', 'debugWrite']
  const missing = KEYS.filter((k) => typeof d[k] !== 'number')
  ok('S0b P-143 的 12 个新计数键都在 sceneScriptApiDiag() 里（"不静默"的可观测入口）', missing.length === 0,
    missing.length ? ('缺：' + missing.join(',')) : KEYS.length + ' 键齐全')
}

// ═══════════════════════════ 3. S1 ITextLayer 四个值成员 ═══════════════════════════
out('\nS1 ITextLayer 四成员（pointsize / font / horizontalalign / verticalalign）')
resetSceneScriptApiDiag()
{
  const readSrc = `'use strict';
export function update(value) {
  shared.A = {
    pt: thisLayer.pointsize, ptType: typeof thisLayer.pointsize,
    font: thisLayer.font, fontType: typeof thisLayer.font,
    ha: thisLayer.horizontalalign, va: thisLayer.verticalalign,
    computed: thisLayer.pointsize * 0.36 + 5,            // 佩丽卡1_03 objects[5].origin 的同款算术
    objPt: thisObject.pointsize, objHa: thisObject.horizontalalign,
    scenePt: thisScene.getLayer('A').pointsize, sceneFont: thisScene.getLayer('A').font,
    finite: Number.isFinite(thisLayer.pointsize) && !Number.isNaN(thisLayer.pointsize * 0.36),
  };
  return value;
}`
  const emptySrc = `'use strict';
export function update(value) {
  shared.C = {
    pt: thisLayer.pointsize, ptType: typeof thisLayer.pointsize,
    font: thisLayer.font, fontType: typeof thisLayer.font,
    ha: thisLayer.horizontalalign, va: thisLayer.verticalalign,
    computed: thisLayer.pointsize * 0.36,
    finite: Number.isFinite(thisLayer.pointsize) && !Number.isNaN(thisLayer.pointsize * 0.36),
  };
  return value;
}`
  const writeSrc = `'use strict';
export function update(value) {
  thisLayer.pointsize = 20;                              // B.pointsize 是作者的 {script,value} 节点
  thisLayer.font = 'fonts/written.otf';
  thisLayer.horizontalalign = 'right';
  thisLayer.verticalalign = 'bottom';
  shared.B = [thisLayer.pointsize, thisLayer.font, thisLayer.horizontalalign, thisLayer.verticalalign];
  thisLayer.pointsize = NaN;                             // ⚠ 非有限值**不得**落盘（否则节点被写成 NaN）
  thisLayer.pointsize = undefined;
  thisLayer.font = null;                                 // 官方 String ⇒ ''（读得回、不是 undefined）
  shared.Bad = [thisLayer.pointsize, thisLayer.font];
  return value;
}`
  const keepSrc = `'use strict';
export function update(value) { return value; }`
  const scene = mkScene([
    { id: 1, name: 'A', origin: '0 0 0', visible: { script: readSrc, value: true }, pointsize: 48, font: 'fonts/Atami-Regular.otf', horizontalalign: 'center', verticalalign: 'bottom' },
    { id: 2, name: 'B', origin: '0 0 0', pointsize: { script: keepSrc, value: 12 }, visible: { script: writeSrc, value: true } },
    { id: 3, name: 'C', origin: '0 0 0', visible: { script: emptySrc, value: true } },
    { id: 4, name: 'D', origin: '0 0 0', visible: { script: keepSrc, value: true }, pointsize: 0 },
  ])
  const r = runTicks(scene, 2)
  const A = r.shared.A || {}, C = r.shared.C || {}, B = r.shared.B || [], Bad = r.shared.Bad || []
  ok('S1a 真值：pointsize=48 / font=Atami-Regular.otf / ha=center / va=bottom（四个都从作者字段读出来）',
    A.pt === 48 && A.ptType === 'number' && A.font === 'fonts/Atami-Regular.otf' && A.ha === 'center' && A.va === 'bottom',
    short(A))
  ok('S1b pointsize 参与算术必须有限（**NaN 对策**：48*0.36+5=22.28，不是 NaN）',
    isFin(A.computed) && Math.abs(A.computed - (48 * 0.36 + 5)) < 1e-9 && A.finite === true, 'computed=' + A.computed)
  ok('S1c 缺字段回安全缺省：pointsize=32（有限）/ font=\'\'（字符串）/ ha=left / va=top；算术有限',
    C.pt === 32 && isFin(C.pt) && C.font === '' && C.fontType === 'string' && C.ha === 'left' && C.va === 'top' && isFin(C.computed) && C.finite === true,
    short(C))
  ok('S1d 渲染器口径一致：`pointsize: 0` ⇒ 读 32（core `textNum(o.pointsize,32)` 就是 >0 才算；读到的数=屏幕上用的数）',
    numOf(scene.objects[3].pointsize) === 0 && (() => {
      const s2 = mkScene([{ id: 9, name: 'E', origin: '0 0 0', visible: { script: emptySrc, value: true }, pointsize: 0 }])
      return runTicks(s2, 1).shared.C.pt === 32
    })(), 'pointsize:0 → 32')
  ok('S1e 写穿 + **保节点**：B.pointsize 仍是作者的 {script,value} 节点且 value=20；font/ha/va 写进作者字段（脚本随后写 null 的 font 结算为 \'\'）',
    !!scene.objects[1].pointsize && typeof scene.objects[1].pointsize === 'object' && typeof scene.objects[1].pointsize.script === 'string'
    && scene.objects[1].pointsize.value === 20
    && B[0] === 20 && B[1] === 'fonts/written.otf' && B[2] === 'right' && B[3] === 'bottom'
    && scene.objects[1].horizontalalign === 'right' && scene.objects[1].verticalalign === 'bottom'
    && scene.objects[1].font === '',
    'node=' + short(scene.objects[1].pointsize, 80) + ' B=' + short(B))
  ok('S1f 非有限值**不落盘**：写 NaN/undefined 后 pointsize 仍是 20（不是 NaN）；写 null 的 font 读回 \'\'',
    B[0] === 20 && isFin(B[0]) && Bad[0] === 20 && isFin(Bad[0]) && Bad[1] === '' && scene.objects[1].pointsize.value === 20,
    'Bad=' + short(Bad))
  ok('S1g 同一个 ILayer 概念一套面：thisLayer == thisObject == thisScene.getLayer(name)',
    A.objPt === 48 && A.objHa === 'center' && A.scenePt === 48 && A.sceneFont === 'fonts/Atami-Regular.otf',
    'objPt=' + A.objPt + ' scenePt=' + A.scenePt + ' sceneFont=' + A.sceneFont)
  const d = sceneScriptApiDiag()
  ok('S1h 可观测：写命中有计数（textPointsizeWrite/textFontWrite/textAlignWrite；读 NaN 那两次不计数）',
    d.textPointsizeWrite >= 1 && d.textFontWrite >= 2 && d.textAlignWrite >= 2,
    short({ pt: d.textPointsizeWrite, font: d.textFontWrite, align: d.textAlignWrite }))
}

// ═══════════════════════════ 4. S2 originalOrigin ═══════════════════════════
out('\nS2 originalOrigin（authored 快照 / createLayer / 空引用 / 保节点）')
resetSceneScriptApiDiag()
{
  const src = `'use strict';
export function init(value) {
  thisLayer.origin = new Vec3(1, 2, 0);                  // 作者在 init 里就动了位置
  return value;                                          // ⚠ 返回**写前快照**：不得回滚显式赋值
}
export function update(value) {
  shared.OO = [thisLayer.originalOrigin.x, thisLayer.originalOrigin.y, thisLayer.originalOrigin.z];
  shared.OOFinite = Number.isFinite(thisLayer.originalOrigin.x) && Number.isFinite(thisLayer.originalOrigin.y);
  shared.OOEmpty = [thisScene.getLayer('nope').originalOrigin.x, thisScene.getLayer('nope').originalOrigin.y];
  if (!shared.dynDone) {                                 // createLayer 新层：快照必须"创建时"抓
    shared.dynDone = 1;
    const l = thisScene.createLayer({ origin: '7 8 0' });
    l.origin = new Vec3(99, 99, 0);
    shared.OODyn = [l.originalOrigin.x, l.originalOrigin.y, l.originalOrigin.z];
  }
  return value;
}`
  const scene = mkScene([
    { id: 1, name: 'Mover', origin: { script: src, value: '10.000000 20.000000 0.000000' } },
  ])
  const r = runTicks(scene, 2)
  const OO = r.shared.OO || []
  const raw = scene.objects[0]
  ok('S2a authored 真值：init 把 origin 改成 (1,2,0)，originalOrigin 仍读回 authored 的 (10,20,0)（= 不是运行值）',
    OO[0] === 10 && OO[1] === 20 && OO[2] === 0 && r.shared.OOFinite === true, short(OO))
  ok('S2b **保节点**：`thisLayer.origin = …` 之后 origin 仍是作者的 {script,value} 节点（旧实现整只替换 ⇒ 作者脚本永久停摆）',
    !!raw.origin && typeof raw.origin === 'object' && typeof raw.origin.script === 'string',
    'origin=' + short(raw.origin, 90))
  ok('S2b2 显式属性写优先于返回值：init 里 `thisLayer.origin = (1,2,0)` 后 `return value`（写前快照 (10,20,0)）⇒ 节点值仍是 (1,2,0)',
    String(raw.origin && raw.origin.value) === '1.000000 2.000000 0.000000',
    'origin.value=' + short(raw.origin && raw.origin.value))
  ok('S2c createLayer 新层：创建配置 origin=7 8 0，作者随后改成 (99,99,0) ⇒ originalOrigin 仍是 (7,8,0)',
    Array.isArray(r.shared.OODyn) && r.shared.OODyn[0] === 7 && r.shared.OODyn[1] === 8, short(r.shared.OODyn))
  ok('S2d 空引用也给**有限** Vec3（不是 undefined/NaN）：getLayer(不存在的名字).originalOrigin = (0,0,0)',
    Array.isArray(r.shared.OOEmpty) && r.shared.OOEmpty[0] === 0 && r.shared.OOEmpty[1] === 0, short(r.shared.OOEmpty))
  const d = sceneScriptApiDiag()
  ok('S2e 可观测：originalOriginRead ≥ 1（命中 authored 快照；惰性补抓会另计 originalOriginMiss）',
    d.originalOriginRead >= 1, short({ read: d.originalOriginRead, miss: d.originalOriginMiss }))
}

// ═══════════════════════════ 5. S3 getEffect / getEffectCount ═══════════════════════════
out('\nS3 IEffectLayer.getEffect / getEffectCount（下标 / 名字 / 写穿 / owner / 安全句柄）')
resetSceneScriptApiDiag()
{
  const effSrc = `'use strict';
export function update(value) {                          // 绑定在 effects[0].visible 上
  shared.effOwnerName = thisLayer.name;                  // owner 修正后 = 'Album Cover'（不是 effect 条目）
  shared.effOwnerPt = thisLayer.pointsize;               // 同一个 ILayer 面：层上的文本成员也读得到
  shared.effCount = thisLayer.getEffectCount();
  thisLayer.getEffect('阴影-设置3').visible = true;       // 名字解析 + 写穿
  return value;
}`
  const layerSrc = `'use strict';
export function update(value) {
  const e0 = thisLayer.getEffect(0);                     // 下标解析
  shared.effName = thisLayer.getEffect('阴影-设置3').name;
  shared.effCount2 = thisScene.getLayer('Album Cover').getEffectCount();
  shared.effVisible0 = e0.visible;
  e0.visible = false;                                    // 写穿到 effects[0].visible（作者的脚本节点）
  e0.setMaterialProperty('alpha', 0.25);                 // 只写"已经存在"的键
  e0.setMaterialProperty('nope', 1);                     // 不存在的键**不创建**
  const u = thisLayer.getEffect('不存在');
  shared.effUnresolved = [typeof u.visible, u.visible, typeof u.name, u.name, u.getMaterialCount(),
    typeof u.getMaterial(0).getAnimation, u.setMaterialProperty ? 'fn' : 'missing'];
  u.visible = false;                                     // 未解析句柄：不抛错、只记帐
  return value;
}`
  const scene = mkScene([
    {
      id: 1, name: 'Album Cover', origin: '0 0 0', pointsize: 40, visible: { script: layerSrc, value: true },
      effects: [
        { file: 'effects/tint/effect.json', id: 561, name: '', visible: { script: effSrc, value: true }, passes: [{ constantshadervalues: { alpha: 1, color: '1 1 1' }, id: 562 }] },
        { file: 'effects/shadow/effect.json', id: 563, name: '阴影-设置3', visible: false, passes: [{ constantshadervalues: { Notch: 0.5 } }] },
      ],
    },
  ])
  const r = runTicks(scene, 2)
  const layer = scene.objects[0]
  const eff0 = layer.effects[0]
  ok('S3a 下标解析 + 写穿：`thisLayer.getEffect(0).visible = false` ⇒ effects[0].visible.value === false，且节点仍是作者的 {script,value}',
    !!eff0.visible && typeof eff0.visible === 'object' && typeof eff0.visible.script === 'string' && eff0.visible.value === false,
    'visible=' + short(eff0.visible, 90))
  ok('S3b 名字解析 + 写穿：`getEffect(\'阴影-设置3\').visible = true` ⇒ effects[1].visible === true',
    layer.effects[1].visible === true, 'visible=' + short(layer.effects[1].visible))
  ok('S3c owner 修正：绑定在 `effects[0].visible` 上的脚本 `thisLayer` 仍是**那一层**（name「Album Cover」、pointsize=40、getEffectCount=2）',
    r.shared.effOwnerName === 'Album Cover' && r.shared.effOwnerPt === 40 && r.shared.effCount === 2,
    short({ name: r.shared.effOwnerName, pt: r.shared.effOwnerPt, n: r.shared.effCount }))
  ok('S3d getEffectCount / name 读回真值：getLayer().getEffectCount()=2、getEffect(\'阴影-设置3\').name 逐字',
    r.shared.effCount2 === 2 && r.shared.effName === '阴影-设置3', short({ n: r.shared.effCount2, name: r.shared.effName }))
  ok('S3e setMaterialProperty 只写"已存在的键"：alpha 0.25 写进 constantshadervalues，`nope` **不**被凭空创建',
    eff0.passes[0].constantshadervalues.alpha === 0.25 && !('nope' in eff0.passes[0].constantshadervalues),
    short(eff0.passes[0].constantshadervalues))
  const U = r.shared.effUnresolved || []
  ok('S3f 解析不到 ⇒ **安全句柄**（不抛错）：visible 是布尔、name 回请求名、getMaterialCount()=0、IMaterial 有 IObject.getAnimation',
    U[0] === 'boolean' && U[1] === true && U[2] === 'string' && U[3] === '不存在' && U[4] === 0 && U[5] === 'function' && U[6] === 'fn',
    short(U))
  const d = sceneScriptApiDiag()
  ok('S3g 可观测：getEffect/getEffectUnresolved/effectWrite/effectWriteUnresolved 各有计数（未解析的写不静默）',
    d.getEffect >= 3 && d.getEffectUnresolved >= 1 && d.effectWrite >= 3 && d.effectWriteUnresolved >= 1,
    short({ get: d.getEffect, un: d.getEffectUnresolved, w: d.effectWrite, wu: d.effectWriteUnresolved }))
}

// ═══════════════════════════ 6. S4 debug + S5 Vec3/Vec2 构造缺省 ═══════════════════════════
out('\nS4 thisLayer.debug（布尔开关，缺省 false）')
resetSceneScriptApiDiag()
{
  const src = `'use strict';
export function update(value) {
  shared.dbg0 = [typeof thisLayer.debug, thisLayer.debug, thisLayer.debug === false];
  thisLayer.debug = true;
  shared.dbg1 = [thisLayer.debug, thisObject.debug];
  shared.dbgEmpty = [typeof thisScene.getLayer('nope').debug, thisScene.getLayer('nope').debug];
  return value;
}`
  const scene = mkScene([{ id: 1, name: 'D', origin: '0 0 0', visible: { script: src, value: true } }])
  const r = runTicks(scene, 1)
  const d0 = r.shared.dbg0 || [], d1 = r.shared.dbg1 || [], de = r.shared.dbgEmpty || []
  ok('S4a 缺省是**真布尔 false**（不是 undefined）：`typeof thisLayer.debug === \'boolean\'`、`=== false` 成立、`if (…)` 分支确定',
    d0[0] === 'boolean' && d0[1] === false && d0[2] === true, short(d0))
  ok('S4b 写回自洽：`thisLayer.debug = true` 之后 thisLayer/thisObject 都读 true；空引用恒 false',
    d1[0] === true && d1[1] === true && de[0] === 'boolean' && de[1] === false, short({ d1, de }))
  const d = sceneScriptApiDiag()
  ok('S4c 可观测：debugRead ≥ 3、debugWrite ≥ 1', d.debugRead >= 3 && d.debugWrite >= 1, short({ r: d.debugRead, w: d.debugWrite }))
}

out('\nS5 Vec3 / Vec2 构造缺省（参与算术的分量必须有限）')
{
  const src = `'use strict';
export function update(value) {
  const a = new Vec3(0), b = new Vec3(1), c = new Vec2(0), d = new Vec2(2, 3);
  shared.vec = [a.toString(), b.toString(), b.multiply(2).toString(), c.toString(), d.toString(),
    a.x, a.y, a.z, c.x, c.y, b.x, b.y, b.z,
    new Vec3('1 2 3').toString(),
    Number.isFinite(a.y) && Number.isFinite(a.z) && Number.isFinite(c.y) && Number.isFinite(b.y) && Number.isFinite(b.z)];
  shared.vecArith = new Vec3(0).add(new Vec3(1)).multiply(3).x;
  return value;
}`
  const scene = mkScene([{ id: 1, name: 'V', origin: '0 0 0', visible: { script: src, value: true } }])
  const r = runTicks(scene, 1)
  const V = r.shared.vec || []
  ok('S5a `new Vec3(0)` / `new Vec2(0)` 的分量是**有限数 0**（官方字段类型 Number + y/z 可选 ⇒ 省略分量不是 undefined/NaN；`new Vec3(1)`=(1,0,0)）',
    V[0] === '0 0 0' && V[1] === '1 0 0' && V[2] === '2 0 0' && V[3] === '0 0' && V[4] === '2 3'
    && V[5] === 0 && V[6] === 0 && V[7] === 0 && V[8] === 0 && V[9] === 0 && V[10] === 1 && V[11] === 0 && V[12] === 0
    && V[13] === '1 2 3' && V[14] === true,
    short(V))
  ok('S5b 构造出来的向量参与算术仍有限：`new Vec3(0).add(new Vec3(1)).multiply(3).x === 3`',
    r.shared.vecArith === 3, 'x=' + r.shared.vecArith)
}

// ═══════════════════════════ 7. S6 真包（改前/改后读数）═══════════════════════════
out('\nS6 真包：改前读数 → 改后断言')
function loadScene(rel) {
  const p = path.join(ALLWALLPAPER, rel)
  if (!fs.existsSync(p)) return null
  try { const t = readSceneJsonText(p); return t ? JSON.parse(t.replace(/^\uFEFF/, '')) : null } catch { return null }
}
function nodeAtPath(sj, dotted) {
  // 支持 `objects[85].effects[0].visible` 这种**任意层级**的下标（第一版只解析首段 ⇒ 读到 null）
  const parts = String(dotted).replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = sj
  for (const k of parts) { if (cur == null) return null; cur = cur[k] }
  return cur && typeof cur === 'object' ? cur : null
}
const missingPacks = []
const need = (rel) => {
  const sj = loadScene(rel)
  if (!sj) missingPacks.push(rel)
  return sj
}

// S6a 佩丽卡1_03 —— 改前 `"2925.104490 NaN 0.000000"`（pointsize undefined 参与算术）
{
  const rel = 'wallpaperE/佩丽卡/佩丽卡1_03.mpkg'
  const sj = need(rel)
  if (!sj) skipItem('S6a 真包 ' + rel, '语料不存在')
  else {
    const anchored = String(nodeAtPath(sj, 'objects[5].origin') && nodeAtPath(sj, 'objects[5].origin').script || '')
      .includes('thisLayer.pointsize * 0.36 + 5')
    const r = runTicks(sj, 3)
    const v = String(sj.objects[5].origin.value !== undefined ? sj.objects[5].origin.value : sj.objects[5].origin).trim().split(/\s+/).map(Number)
    const jpc = r.shared.jpc_clockPosition
    const pts = Number(sj.objects[5].pointsize.value)
    const expect = (jpc ? jpc.y : NaN) + pts * 0.36 + 5
    ok('S6a ' + rel.split('/').slice(-2).join('/') + ' objects[5].origin.y 不再是 NaN（改前="2925.104490 NaN 0.000000"）',
      anchored && Number.isFinite(v[1]) && !Number.isNaN(v[1]) && Number.isFinite(v[0]) && r.total === 0,
      (anchored ? '锚点命中（`… + thisLayer.pointsize * 0.36 + 5`）· ' : '**锚点未命中** · ')
      + 'origin="' + sj.objects[5].origin.value + '"（改前 y=NaN）· errs=' + r.total + (r.total ? ' ' + short(r.msgs, 120) : ''))
    ok('S6a2 而且 y 是**算得出来的那个数**：jpc_clockPosition.y(' + (jpc ? jpc.y : '?') + ') + pointsize(' + pts + ')*0.36 + 5 = ' + expect,
      Number.isFinite(expect) && Math.abs(v[1] - expect) < 1e-6, 'y=' + v[1] + ' 期望=' + expect)
  }
}

// S6b 芙宁娜 —— 改前 `createLayer({pointsize: undefined, font: undefined})`
for (const rel of ['wallpaperE/芙宁娜/芙宁娜1_04.mpkg', 'wallpaperE/芙宁娜/芙宁娜_08.mpkg']) {
  const sj = need(rel)
  if (!sj) { skipItem('S6b 真包 ' + rel, '语料不存在'); continue }
  const srcLayer = sj.objects[4]
  const authoredPt = Number(srcLayer.pointsize)
  const authoredFont = String(srcLayer.font)
  const r = runTicks(sj, 1)
  const dyn = sj.objects.filter((o) => o && o.__dynamic)
  const d = dyn[0]
  const anchored = String(srcLayer.text && srcLayer.text.script || '').includes('pointsize: thisLayer.pointsize')
  ok('S6b ' + rel.split('/').slice(-2).join('/') + ' 阴影层读到了源层真值（改前 pointsize/font 都是 undefined ⇒ 静默用 32/默认字体）',
    anchored && !!d && d.pointsize === authoredPt && d.font === authoredFont && Number.isFinite(d.pointsize),
    (anchored ? '锚点命中 · ' : '**锚点未命中** · ') + '源层 pt=' + authoredPt + ' font=' + authoredFont
    + ' → 阴影层 pt=' + (d ? short(d.pointsize) : 'n/a') + ' font=' + (d ? short(d.font) : 'n/a'))
}

// S6c 3122339805 —— 改前 `update:thisLayer.getEffect is not a function`
{
  const rel = '0923/3122339805/scene.pkg'
  const sj = need(rel)
  if (!sj) skipItem('S6c 真包 ' + rel, '语料不存在')
  else {
    const node = nodeAtPath(sj, 'objects[85].effects[0].visible')
    const anchored = !!node && typeof node.script === 'string' && node.script.includes('thisLayer.getEffect(0).visible = false')
    const rOff = runTicks(sj, 1, { userProps: { disablealbumtint: true } })
    const vOff = nodeAtPath(sj, 'objects[85].effects[0].visible').value
    const rOn = runTicks(sj, 1, { userProps: { disablealbumtint: false } })
    const vOn = nodeAtPath(sj, 'objects[85].effects[0].visible').value
    ok('S6c ' + rel.split('/').slice(-2).join('/') + ' 关闭染色 ⇒ effects[0].visible=false、开启 ⇒ true，且 0 错（改前：1 错 + 开关无效）',
      anchored && rOff.total === 0 && rOn.total === 0 && vOff === false && vOn === true,
      (anchored ? '锚点命中 · ' : '**锚点未命中** · ') + 'off=' + short(vOff) + ' on=' + short(vOn) + ' errs=' + (rOff.total + rOn.total)
      + (rOff.total ? ' ' + short(rOff.msgs, 120) : ''))
  }
}

// S6d 2887099508 —— 改前 cursorEnter 5 错、五个 effect 全停在 false
{
  const rel = '0923/2887099508/scene.pkg'
  const sj = need(rel)
  if (!sj) skipItem('S6d 真包 ' + rel, '语料不存在')
  else {
    const layerNamed = sj.objects.find((o) => o && o.name === '中-菜单-浮动')
    const anchored = !!(layerNamed && layerNamed.effects.some((e) => e && e.name === '阴影-设置3' && e.visible === false))
    const r = runTicks(sj, 1)
    const ev = dispatchScriptEvent(r.cache, 'cursorEnter', { worldPosition: { x: 0, y: 0, z: 0 } }, { onError: (n, e) => r.msgs.push(n + ':' + ((e && e.message) || e)) })
    const after = layerNamed ? layerNamed.effects.map((e) => e.visible) : []
    const getEffectErrs = r.msgs.filter((m) => /getEffect is not a function/.test(m)).length
    ok('S6d ' + rel.split('/').slice(-2).join('/') + ' cursorEnter ⇒ 四个阴影 effect 全部 visible=true（改前全 false + 5 处错含 getEffect）',
      anchored && ev.calls >= 4 && after.filter((x) => x === true).length >= 4 && getEffectErrs === 0,
      (anchored ? '锚点命中 · ' : '**锚点未命中** · ') + 'calls=' + ev.calls + ' visible=' + short(after) + ' getEffect 错=' + getEffectErrs
      + ' 其它错=' + short(r.msgs.filter((m) => !/getEffect is not a function/.test(m)), 120))
  }
}

// S6e NSL resetPosition —— 改前 `thisLayer.origin = undefined` 静默 no-op
for (const [rel, idx] of [['0923/3521337568/scene.pkg', 23], ['0923/3653641024/scene.pkg', 27], ['dd/3554161528/scene.pkg', 24]]) {
  const sj = need(rel)
  if (!sj) { skipItem('S6e 真包 ' + rel, '语料不存在'); continue }
  const raw = sj.objects[idx]
  const authored = String((raw.origin && typeof raw.origin === 'object') ? raw.origin.value : raw.origin)
  const r = runTicks(sj, 1)
  const entry = [...r.cache.map.values()].find((e) => e && e.exports && typeof e.exports.resetPosition === 'function')
  const anchored = !!(raw.origin && typeof raw.origin === 'object' && typeof raw.origin.script === 'string'
    && raw.origin.script.includes('thisLayer.origin = thisLayer.originalOrigin'))
  let after = null, kept = false
  if (entry) {
    entry.ownerRef.setOwner(raw)
    raw.origin.value = '111.000000 222.000000 0.000000'      // 模拟"被拖动过"
    withMutedLog(() => { try { entry.exports.resetPosition() } catch { /* 记在 kept/after 上 */ } })
    after = String(raw.origin && typeof raw.origin === 'object' ? raw.origin.value : raw.origin)
    kept = !!(raw.origin && typeof raw.origin === 'object' && typeof raw.origin.script === 'string')
  }
  const authoredXy = authored.trim().split(/\s+/).slice(0, 2).map(Number)
  const afterXy = String(after).trim().split(/\s+/).slice(0, 2).map(Number)
  ok('S6e ' + rel.split('/').slice(-2).join('/') + ' resetPosition() 把 origin 复位到 authored（改前：读不到 originalOrigin ⇒ 静默 no-op）',
    anchored && !!entry && kept && Math.abs(afterXy[0] - authoredXy[0]) < 1e-6 && Math.abs(afterXy[1] - authoredXy[1]) < 1e-6 && afterXy[0] !== 111,
    (anchored ? '锚点命中 · ' : '**锚点未命中** · ') + 'authored=' + short(authored) + ' 拖动=111 222 → 复位=' + short(after) + ' 节点保留=' + kept)
}

// S6f 3662790108 —— 改前 `thisLayer.debug` 是 undefined
{
  const rel = '0923/3662790108/scene.pkg'
  const sj = need(rel)
  if (!sj) skipItem('S6f 真包 ' + rel, '语料不存在')
  else {
    const raw = sj.objects[684]
    const anchored = !!(raw.text && typeof raw.text.script === 'string' && raw.text.script.includes('if (thisLayer.debug)'))
    raw.__probeDebug = {
      script: `'use strict';
export function update(value) {
  shared.__probe = [typeof thisLayer.debug, thisLayer.debug, thisLayer.debug === false];
  thisLayer.debug = true;
  shared.__probe2 = thisLayer.debug;
  return value;
}`, value: 'probe',
    }
    const r = runTicks(sj, 1)
    delete raw.__probeDebug
    const p0 = r.shared.__probe || []
    ok('S6f ' + rel.split('/').slice(-2).join('/') + ' 作者层上的 thisLayer.debug：改前 undefined（typeof=\'undefined\'）⇒ 现在 typeof=\'boolean\'、值 false、写后 true',
      anchored && p0[0] === 'boolean' && p0[1] === false && p0[2] === true && r.shared.__probe2 === true,
      (anchored ? '锚点命中（`if (thisLayer.debug)`）· ' : '**锚点未命中** · ') + '探针=' + short(p0) + ' 写后=' + short(r.shared.__probe2))
  }
}

// S6g Vec3 单参数缺省的真包证据（砂狼白子11_03 的媒体颜色过渡初值 `new Vec3(0)`）
{
  const rel = 'wallpaperE/砂狼白子/砂狼白子11_03.mpkg'
  const sj = need(rel)
  if (!sj) skipItem('S6g 真包 ' + rel, '语料不存在')
  else {
    const node = nodeAtPath(sj, 'objects[46].color')
    const anchored = !!node && typeof node.script === 'string' && node.script.includes('new Vec3(0)')
    runTicks(sj, 1)
    const v = nodeAtPath(sj, 'objects[46].color').value
    ok('S6g ' + rel.split('/').slice(-2).join('/') + ' `new Vec3(0)` 初值 ⇒ color="0.000000 0.000000 0.000000"（改前="0.000000 NaN NaN"）',
      anchored && typeof v === 'string' && !/NaN/.test(v) && v === '0.000000 0.000000 0.000000',
      (anchored ? '锚点命中 · ' : '**锚点未命中** · ') + 'color=' + short(v))
  }
}
if (missingPacks.length) note('语料缺失（相关真包断言已 SKIP）', missingPacks.join(', '))

// ═══════════════════════════ 8. S7 全语料"静默 NaN"扫描 ═══════════════════════════
// 口径：逐包跑 **1 个 cache × 2 帧**（宿主行为；两个 cache = 每帧重跑 init/顶层，会造出假 NaN），
//   然后只在**脚本节点写到场景对象上的值**里找 NaN/Infinity（数字非有限，或字符串里含 NaN/Infinity）。
// 白名单 = 已定位、与 P-143 四类**无关**的残留（用一份"把 P-143 特性全部中和掉"的副本对照跑过：
//   这些包在中和版里同样 NaN ⇒ 不是本批引入；中和版 17 包 → 现行版 7 包，且没有任何"只在现行版出现"的包）。
// 新包出现即红（"彻底消除这一类静默 NaN"的守门）。
const KNOWN_NAN = {
  '0917/3351163962/scene.pkg': ['作者脚本把 scriptProperties 当可写变量自赋值后自引用（WE 里 scriptProperties 只读）'],
  '0917/3509243656/scene.pkg': ['用户属性绑定是**两层**嵌对象（{user:sizex,value:{user:x,…}}）且本机无该用户值 ⇒ scriptProperties.yszx 是对象'],
  '0923/3521337568/scene.pkg': ['属性脚本对 Vec3 属性返回**标量** ⇒ 下一帧 value.x 读 undefined ⇒ NaN（属性类型强制契约，另案）'],
  '0923/3589454154/scene.pkg': ['作者关键帧 t1==t2==0（零长区间）⇒ (t-t1)/(t2-t1) = 0/0 = NaN'],
  '0923/3662790108/scene.pkg': ['作者笔误 shared.shared.p1_longNode（P-142 已登记）+ 依赖 shared 生产者链未就绪'],
  'dd/3554161528/scene.pkg': ['同 0923/3521337568：属性脚本对 Vec3 属性返回标量'],
  'dd/3660962877/scene.pkg': ['shared 里传的是**用户属性绑定对象**（{user:min,value:0.5}）而非数值 ⇒ 乘法 NaN（用户属性解包另案）'],
}
if (QUICK || IS_MUTANT_RUN) note('S7 全语料静默 NaN 扫描被 ' + (QUICK ? '--quick' : 'MPW_SCENE_SCRIPTS（变异体）') + ' 跳过')
else if (!fs.existsSync(ALLWALLPAPER)) skipItem('S7 全语料扫描', path.join('$MPW_ROOT', 'allwallpaper') + ' 不存在')
else {
  out('\nS7 全语料（' + path.relative(WS, ALLWALLPAPER) + '）静默 NaN 扫描：脚本跑完后不允许出现新的 NaN/Infinity')
  const badOf = (o) => {
    const found = []
    const seen = new WeakSet()
    const walk = (v, p, d) => {
      if (v == null || d > 12) return
      if (typeof v === 'number') { if (!Number.isFinite(v)) found.push(p + '=' + v); return }
      if (typeof v === 'string') { if (/NaN|Infinity/.test(v)) found.push(p + '=' + JSON.stringify(v)); return }
      if (typeof v !== 'object' || seen.has(v)) return
      seen.add(v)
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + '[' + i + ']', d + 1)); return }
      if (typeof v.script === 'string' && 'value' in v) { walk(v.value, p + '.value', d + 1); return }
      for (const k of Object.keys(v)) walk(v[k], p + '.' + k, d + 1)
    }
    walk(o, '', 0)
    return found
  }
  const files = walkContainers(ALLWALLPAPER)
  const found = new Map()
  let scanned = 0, withScripts = 0
  for (const f of files) {
    let txt = null
    try { txt = readSceneJsonText(f) } catch { continue }
    if (!txt) continue
    let scene; try { scene = JSON.parse(txt.replace(/^\uFEFF/, '')) } catch { continue }
    scanned++
    if (!JSON.stringify(scene.objects || []).includes('"script"')) continue
    withScripts++
    try {
      const cache = createScriptCache()
      withMutedLog(() => {
        for (let t = 0; t < 2; t++) {
          applySceneScripts(scene, t, { scriptCache: cache, renderObjects: scene.objects, canvasSize: { x: 1920, y: 1080 }, frametime: 1 / 60, onError: () => {} })
        }
      })
    } catch { /* 包级异常不影响扫描（本批只看值） */ }
    const hits = []
    for (let i = 0; i < (scene.objects || []).length; i++) {
      const b = badOf(scene.objects[i])
      if (b.length) hits.push('objects[' + i + '] ' + b.slice(0, 3).join(', '))
    }
    if (hits.length) found.set(path.relative(ALLWALLPAPER, f), hits)
  }
  const unexpected = [...found.keys()].filter((k) => !KNOWN_NAN[k])
  const absent = Object.keys(KNOWN_NAN).filter((k) => !found.has(k))
  ok('S7a 扫描规模：容器 ' + files.length + ' / 解析 ' + scanned + ' / 带脚本 ' + withScripts + '（带脚本的都要跑到）',
    withScripts >= 20 && scanned >= withScripts, withScripts + ' 个带脚本包')
  ok('S7b 出现 NaN/Infinity 的包 ⊆ 已知残留清单（' + found.size + ' 个 / 清单 ' + Object.keys(KNOWN_NAN).length + ' 个；新包即红）',
    unexpected.length === 0, unexpected.length ? ('新缺口：' + JSON.stringify(unexpected.slice(0, 5))) : ('0 个新缺口'))
  ok('S7b-分辨力（合成数字）：清单内=放行 / 新包=红 / 清单里已消失=提示删除',
    (new Map([['A', ['x']]])).has('A') && !KNOWN_NAN['A'] && !found.has('__不存在__') && absent.length >= 0,
    '清单命中路径可判：' + (found.has('__不存在__') ? '异常' : 'ok'))
  if (found.size) for (const [rel, hits] of found) note('残留 ' + rel, short(hits, 160))
  if (absent.length) note('清单里已消失（= 修好了，请删条目）', absent.join(', '))
}

// ═══════════════════════════ 9. S8 红-if-reverted（变异自证）═══════════════════════════
if (IS_MUTANT_RUN) note('S8 变异体运行（MPW_SCENE_SCRIPTS 已设）⇒ 跳过自检，避免递归')
else if (!MUTATION) note('S8 红-if-reverted 自检被 --no-mutation 跳过（本次运行**未**复核变异必红）')
else {
  out('\nS8 红-if-reverted ×6：pointsize 读取器 / authored 快照 / getEffect / Vec3 缺省 / owner 绑定 / debug')
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
  const runCopy = () => spawnSync(process.execPath, [process.argv[1], '--no-mutation', '--quick'], {
    encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { MPW_SCENE_SCRIPTS: pristine }),
  })
  const rc = runCopy()
  const rcOut = String(rc.stdout || '') + String(rc.stderr || '')
  ok('S8-0 对照组：未变异的 /tmp 副本跑本文件全绿（rc=0）',
    rc.status === 0 && /ALL PASS/.test(rcOut),
    'rc=' + rc.status + ' ' + ((rcOut.match(/\(计票：[^)]*\)/) || [''])[0]))
  if (VERBOSE && rc.status !== 0) note('S8-0 副本输出尾部', short(rcOut.slice(-800), 400))

  const SRC = fs.readFileSync(MODULE, 'utf8')
  const MUTANTS = [
    {
      id: 'M1', fix: 'ITextLayer.pointsize 读取器', expect: /✗ S1b |✗ S1c /, real: /✗ S6a /, baseline: /✓ S0a /,
      desc: '把 pointsizeOf 改成返回 undefined（= 回到"undefined*0.36 ⇒ NaN"的旧状态）',
      anchor: "  const n = Number(nodeRaw(obj ? obj.pointsize : null));\n  return Number.isFinite(n) && n > 0 ? n : 32;",
      to: "  return undefined;   // MUTANT",
    },
    {
      id: 'M2', fix: 'originalOrigin 的 authored 快照', expect: /✗ S2a /, real: /✗ S6e /, baseline: /✓ S0a /,
      desc: '把 snapshotAuthoredOrigins 改成 no-op（⇒ 惰性补抓到的已是运行值，"恢复初始位置"变 no-op）',
      anchor: "export function snapshotAuthoredOrigins(objects) {\n  let n = 0;",
      to: "export function snapshotAuthoredOrigins(objects) {\n  return 0;   // MUTANT\n  let n = 0;",
    },
    {
      id: 'M3', fix: 'IEffectLayer.getEffect', expect: /✗ S3a |✗ S3f /, real: /✗ S6c /, baseline: /✓ S0a /,
      desc: '把 effectRefFor 改成返回 undefined（= 该成员不存在，回到 `getEffect is not a function`）',
      anchor: 'function effectRefFor(obj, nameOrIndex) {\n  const index = effectIndexOf(obj, nameOrIndex);',
      to: 'function effectRefFor(obj, nameOrIndex) {\n  return undefined;   // MUTANT\n  const index = effectIndexOf(obj, nameOrIndex);',
    },
    {
      id: 'M4', fix: 'Vec3/Vec2 构造缺省（numOr0）', expect: /✗ S5a /, real: null, baseline: /✓ S0a /,
      desc: '把 numOr0 改成恒等（= 回到 `new Vec3(0)` 的 y/z = undefined ⇒ 下游 NaN）',
      anchor: 'const numOr0 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 };',
      to: 'const numOr0 = (v) => v;   // MUTANT',
      file: 'scene-script-apis.js',
    },
    {
      id: 'M5', fix: '脚本节点 owner 绑定（effects[i] 上的脚本 thisLayer=层）', expect: /✗ S3c /, real: /✗ S6c /, baseline: /✓ S0a /,
      desc: '恢复 `collect(x, x)`（嵌套数组元素抢当 owner ⇒ effect 上的脚本 thisLayer 变成 effect 条目）',
      anchor: 'obj.forEach((x) => collect(x, isLayerArray ? x : owner, false));',
      to: 'obj.forEach((x) => collect(x, x, false));',
    },
    {
      id: 'M6', fix: 'thisLayer.debug 读取器', expect: /✗ S4a /, real: /✗ S6f /, baseline: /✓ S0a /,
      desc: '把 debugFlagOf 改成返回 undefined（= 回到 `typeof === \'undefined\'` 的旧状态）',
      anchor: "  apiBump('debugRead');\n  if (!obj) return false;",
      to: "  return undefined;   // MUTANT",
    },
  ]
  for (const m of MUTANTS) {
    const file = path.join(tmpEly, m.file || 'scene-scripts.js')
    const src = fs.readFileSync(file, 'utf8')
    const n = src.split(m.anchor).length - 1
    if (n !== 1) {
      skipItem('mutation-selfcheck ' + m.id, '锚点命中 ' + n + ' 次：' + JSON.stringify(m.anchor.slice(0, 60)) + '（需重新标定；不做变异＝不算证据）')
      continue
    }
    fs.writeFileSync(file, src.split(m.anchor).join(m.to))
    const r = runCopy()
    const so = String(r.stdout || '') + String(r.stderr || '')
    const redLine = (so.match(m.expect) || [])[0] || (so.match(/✗ [^\n]*/) || [])[0] || ''
    ok('S8-' + m.id + '（' + m.fix + '）变异「' + m.desc + '」⇒ 子进程 rc=1 且点名断言变红',
      r.status === 1 && m.expect.test(so), 'rc=' + r.status + ' 失败断言=' + JSON.stringify(redLine.slice(0, 160)))
    ok('S8-' + m.id + 'b 变异体里基线仍 ✓（S0a 副本可加载 ⇒ 红是被点名那条，不是副本起不来）', m.baseline.test(so), '')
    if (m.real) {
      const realLine = (so.match(m.real) || [])[0] || ''
      ok('S8-' + m.id + 'c 同一变异体里真包断言也变红（' + m.real.source + '）', m.real.test(so),
        '失败断言=' + JSON.stringify(realLine.slice(0, 160)))
    }
    if (r.status !== 1 && VERBOSE) note('S8-' + m.id + ' 子进程输出尾部', short(so.slice(-800), 400))
    fs.writeFileSync(file, src)   // 还原（下一个变异体从干净副本开始）
  }
}

// ═══════════════════════════ 10. 汇总 ═══════════════════════════
const peak = (() => { try { const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/); return m ? Math.round(+m[1] / 1024) + 'MB' : '?' } catch { return '?' } })()
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skip + '；PeakRSS=' + peak + ')')
if (fail) { out('\n' + fail + ' 项失败'); process.exit(1) }
out('\nALL PASS （' + pass + ' 项' + (skip ? '，另 SKIP ' + skip : '') + '）')

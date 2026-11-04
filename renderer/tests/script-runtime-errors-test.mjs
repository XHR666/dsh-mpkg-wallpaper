// script-runtime-errors-test.mjs —— P-137：**真包里作者脚本 update() 每帧抛同一根 TypeError**
//                             （`Cannot read properties of undefined (reading 'x')`）的复现 + 判据 + 同族扫描
//
// 登记待办（P-137 分工：`tests/run-all-tests.sh` 由主对话统一落账，本文件**不**改它）：
//   建议条目：add "script-runtime-errors" "node tests/script-runtime-errors-test.mjs" "" "^SKIP script-runtime-errors"
//
// ── 用户原话（第 8 项）────────────────────────────────────────────────────────────────────
//   「有些视频壁纸，它下面总是报一堆的错，我点了手动上报」⇒ `$MPW_ROOT/reports/` 里最相关的三份：
//     · `r1789751541247.json` 壁纸 **3327063360**：`subsystems.scriptErrs =
//       ["update:Cannot read properties of undefined (reading 'x')×511"]`（`scripts:1 / scriptErr:0`）
//     · `r1789751395466.json` 壁纸 **3660962877**：同一条错 **×72**
//     · `r1789751340469.json` 壁纸 3719111841：`scriptErrs: []`（对照：无此错）
//   `demo.html:3237-3245` 的 onError 每收到一次 `update` 异常就把 `stage:message` 计数 +1
//   （`window.__mpwScriptErrs[k] = (…||0)+1`）⇒ ×511 = 该脚本的 update 抛了 511 次 = 511 帧。
//
// ── 根因（一句话）────────────────────────────────────────────────────────────────────────
//   沙箱里 `thisLayer` / `thisObject`（`elysia/scene-scripts.js` 的 `makeOwnerRef()`）此前**没有
//   `size` 这个键** ⇒ 作者脚本读到的 `thisLayer.size` 是 `undefined`，紧跟的 `.x` 立刻抛
//   `Cannot read properties of undefined (reading 'x')`，每帧一次。官方 d.ts 里
//   `IEffectLayer.size: Vec2`（"Resolution of the image layer in pixels. Only read this, do not write."）、
//   `ILayer extends … IEffectLayer …` ⇒ 这是**合法且必需**的 API，不是作者写错。
//   出错的脚本行（真包原文）：
//     3327063360 · `objects[50].scale`（层 "Background"，workshop 3219510589）:
//         `value.x = width / (thisLayer.size.x * initScale.x) * initScale.x;`
//     3660962877 · `objects[122].origin`（层 "音乐封面"，workshop 3449579583）:
//         `let imageSize = thisLayer.size; imageSize.x *= scale.x * 0.5;`
//
// ── 本文件钉住什么（每条都是真跑出来的数值判据，无浏览器、无网络、秒级）──────────────────
//   S1/S2  真包脚本原文 + 我们的沙箱跑 N 帧：**修后 0 次**；N 选得让"修前"**逐字等于上报里的
//          ×511 / ×72**（修前首帧 init 趟会多跑一次 update ⇒ 510/71 帧 ↔ 511/72 次计数，
//          P-142 跑序修好后首帧同样只跑一次，见 S1 注释）。
//   S3     两个真包**整包**（全部脚本节点）跑 4 帧 ⇒ `scriptErrs` 为空（= 上报字段的口径）。
//   S4     合成探针：`size` 的**量纲/取值/拷贝语义/赋值不抛错/`thisObject.size` 同源**逐条钉住。
//   S5     同族扫描：`$MPW_ROOT/allwallpaper` 下**所有**带脚本的容器，逐包第 1 帧检查 ⇒
//          "还有哪些包会抛脚本错"。硬断言：抛 `reading 'x'` 的包 ⊆ **已知那一个**；残余错误
//          **种类与包/串**都必须 ⊆ 已知清单（②(2026-09-23) 起逐包逐串；见 `KNOWN_GAPS` /
//          `KNOWN_GAP_PKGS`），出现**新**包或**新**串即红。
//   S6     红-if-reverted：`elysia/` 复制进 mkdtemp，做两个"删掉 size 访问器"的变异，各自独立
//          子进程跑本文件 ⇒ 要求 rc=1 + **点名的那条断言**变红 + 基线 ✓ 仍在（证明是变异打破语义，
//          而不是副本根本跑不起来）。
//
// 用法：node tests/script-runtime-errors-test.mjs [--no-mutation] [--quick] [--verbose]
//   --no-mutation  跳过 S6 自检（子进程用；避免递归）
//   --quick        跳过 S5 语料扫描（变异子进程用，省时间）
// 退出码：0 全过（含 SKIP）/ 1 有失败 / 2 用法错误
//
// 环境：`MPW_SCENE_SCRIPTS` 覆盖被测沙箱（变异自检用）；`MPW_ROOT` 覆盖语料根（默认工作区根）。
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
for (const a of ARGV) if (!['--no-mutation', '--quick', '--verbose'].includes(a)) {
  console.error('未知参数：' + a + '\n用法：node tests/script-runtime-errors-test.mjs [--no-mutation] [--quick] [--verbose]')
  process.exit(2)
}

// 计票（与 tests/script-sandbox-globals-test.mjs 同一套风格）
const SAVED_LOG = console.log
const out = (...a) => { try { SAVED_LOG(...a) } catch { /* ignore */ } }
let pass = 0, fail = 0, skip = 0
const note = (name, detail) => { out('  · ' + name + (detail ? '  [' + detail + ']' : '')) }
const ok = (name, cond, detail) => {
  if (cond) { pass++; out('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; out('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const skipItem = (name, reason) => { skip++; out('  SKIP script-runtime-errors ' + name + ' — ' + reason) }

// ═══════════════════════════ 1. 被测沙箱（默认真树；变异自检用 /tmp 副本）═══════════════════════
const MODULE = process.env.MPW_SCENE_SCRIPTS
  ? path.resolve(process.env.MPW_SCENE_SCRIPTS)
  : path.join(ROOT, 'elysia', 'scene-scripts.js')
const IS_MUTANT_RUN = !!process.env.MPW_SCENE_SCRIPTS
let applySceneScripts, createScriptCache
try {
  const mod = await import(pathToFileURL(MODULE).href)
  applySceneScripts = mod.applySceneScripts
  createScriptCache = mod.createScriptCache
} catch (e) {
  out('  沙箱实现加载失败：' + path.relative(ROOT, MODULE) + ' — ' + (e && e.message))
  process.exit(1)
}
out('script-runtime-errors-test —— P-137：thisLayer.size 缺失 ⇒ 作者 update() 每帧 TypeError'
  + '（沙箱实现=' + path.relative(ROOT, MODULE) + (IS_MUTANT_RUN ? '（变异体）' : '') + '）')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p137-script-runtime-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ } })

const CORPUS_ROOT = process.env.MPW_ROOT || WS
const ALLWALLPAPER = path.join(CORPUS_ROOT, 'allwallpaper')

// ═══════════════════════════ 2. 通用宿主工具 ═══════════════════════════
// 作者脚本会 `console.log(...)`（跑过缺口之后才走到那一行）⇒ 跑真包时临时静音宿主 console.log，
// 免得把几千行 Vec3 dump 混进门禁输出（demo.html 只把 console.warn/error 桥到 #log 面板，
// console.log 只进 devtools ⇒ 静音不影响任何页面行为）。
function withMutedLog(fn) {
  const saved = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = saved }
}

// 沙箱的节点收集口径（与 `elysia/scene-scripts.js` 的 collect() 逐条一致）：
// 对象同时有 `script`(string) 与 `value` 两个键即一个脚本节点。
function collectNodes(root, out = [], p = '') {
  if (Array.isArray(root)) { root.forEach((v, i) => collectNodes(v, out, p + '[' + i + ']')); return out }
  if (!root || typeof root !== 'object') return out
  if ('script' in root && 'value' in root && typeof root.script === 'string') { out.push({ node: root, path: p }); return out }
  for (const k of Object.keys(root)) collectNodes(root[k], out, p ? p + '.' + k : k)
  return out
}
/** `objects[50].scale` → 真包 scene.json 里的那个脚本节点（找不到返回 null）。 */
function nodeAtPath(sj, dotted) {
  const m = /^objects\[(\d+)\]$/.exec(dotted.split('.')[0])
  if (!m) return null
  let cur = sj && Array.isArray(sj.objects) ? sj.objects[Number(m[1])] : null
  for (const k of dotted.split('.').slice(1)) { if (cur == null) return null; cur = cur[k] }
  return cur && typeof cur === 'object' ? cur : null
}
/** 跑 ticks 次 `applySceneScripts`（= demo 的每帧调用），返回按 stage 分类的错误计数。 */
function runTicks(scene, ticks, extra = {}) {
  const cache = createScriptCache()
  const byStage = { init: 0, update: 0, applyUserProperties: 0, other: 0 }
  const msgs = []
  withMutedLog(() => {
    for (let t = 0; t < ticks; t++) {
      applySceneScripts(scene, t, Object.assign({
        scriptCache: cache,
        canvasSize: { x: 1920, y: 1080 },
        onError: (stage, e) => { byStage[stage] = (byStage[stage] || 0) + 1; msgs.push(stage + ':' + ((e && e.message) || e)) },
      }, extra))
    }
  })
  return { byStage, msgs, total: msgs.length, update: byStage.update | 0 }
}
/** 一段作者脚本放进真宿主跑一趟，返回 { value, msgs }。 */
function runProbe(script, nodeExtra = {}, ticks = 2) {
  const node = Object.assign({ id: 1, name: 'p137-probe', script, value: '0 0 0' }, nodeExtra)
  const scene = { general: {}, objects: [node] }
  const r = runTicks(scene, ticks)
  return { value: node.value, msgs: r.msgs, node }
}
const isVec3ish = (v) => v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number'

// 语料里的容器（只读目录表，按偏移取 scene.json，**不**整包载入内存）
function loadScene(rel) {
  const p = path.join(CORPUS_ROOT, rel)
  if (!fs.existsSync(p)) return null
  try {
    const t = readSceneJsonText(p)
    return t ? JSON.parse(t.replace(/^\uFEFF/, '')) : null
  } catch { return null }
}

// ═══════════════════════════ 3. S0 基线 ═══════════════════════════
const PACK_A = {
  id: '3327063360',
  rel: 'allwallpaper/dd/3327063360/scene.pkg',
  at: 'objects[50].scale',
  lines: ['value.x = width / (thisLayer.size.x * initScale.x) * initScale.x;'],
  report: 'r1789751541247.json', reportCount: 511, ticks: 510,
}
const PACK_B = {
  id: '3660962877',
  rel: 'allwallpaper/dd/3660962877/scene.pkg',
  at: 'objects[122].origin',
  lines: ['let imageSize = thisLayer.size;', 'imageSize.x *= scale.x * 0.5;'],
  report: 'r1789751395466.json', reportCount: 72, ticks: 71,
}
out('\nS0 基线')
ok('S0a 沙箱模块可加载（applySceneScripts / createScriptCache）',
  typeof applySceneScripts === 'function' && typeof createScriptCache === 'function', path.relative(ROOT, MODULE))
const sjA = loadScene(PACK_A.rel)
const sjB = loadScene(PACK_B.rel)
const HAVE_A = !!sjA, HAVE_B = !!sjB
// 真包是**本机语料**（不进仓库）⇒ 缺了必须 SKIP 而不是红（`run-all-tests.sh` 的硬约束）：
// 缺时 S1/S2/S3 与"要靠真包变红"的 M1 一并 SKIP，本文件仍以 exit 0 收尾。
const CAN_RUN_REAL = HAVE_A && HAVE_B
if (CAN_RUN_REAL) ok('S0b 真包可见（$MPW_ROOT/allwallpaper/dd/{3327063360,3660962877}/scene.pkg）', true, 'A=有 B=有')
else skipItem('S0b 真包可见', 'A=' + (HAVE_A ? '有' : '缺') + ' B=' + (HAVE_B ? '有' : '缺')
  + ' ⇒ S1/S2/S3 与 S6-M1 一并 SKIP（真包属本机语料，不进仓库）')
if (QUICK) skipItem('S0c 语料扫描可用性', '--quick（变异子进程）跳过 S5')
else {
  const hasCorpus = fs.existsSync(ALLWALLPAPER)
  if (hasCorpus) ok('S0c 语料根可见（$MPW_ROOT/allwallpaper）', true, path.relative(WS, ALLWALLPAPER) || ALLWALLPAPER)
  else skipItem('S0c 语料根可见', '$MPW_ROOT/allwallpaper 不存在 ⇒ S5 同族扫描一并 SKIP（语料属本机资产，不进仓库）')
}

// ═══════════════════════════ 4. S1/S2 真包脚本原文 + 我们的沙箱跑 N 帧 ═══════════════════════════
//
// 为什么 TICKS = 510 / 71（而不是 511 / 72）：这两个数**只用来对齐"修前"的上报窗口**。旧实现
// `applySceneScripts` 一次调用里 init 趟会顺带再调一次 update（`runScriptValueCached` 的 update 段
// 当时不受 phase 约束）⇒ 首帧计 **2** 次、其后每帧 1 次 = `TICKS + 1` 次，取 510/71 正好逐字等于
// 上报里的 ×511 / ×72。①(P-142 2026-09-23) 跑序修好后首帧也只跑一次 ⇒ 本窗口实测 = `TICKS` 次
// （断言只看"抛错 = 0"，计数只进 note，所以窗口值不需要改）。
out('\nS1/S2 真包脚本原文 × N 帧（复现窗口 = 上报计数）')
for (const P of [PACK_A, PACK_B]) {
  const tag = P === PACK_A ? 'S1' : 'S2'
  const sj = P === PACK_A ? sjA : sjB
  if (!sj) { skipItem(tag + ' ' + P.id + ' 复现', path.join('$MPW_ROOT', P.rel) + ' 不存在'); continue }
  const node = nodeAtPath(sj, P.at)
  // 锚点自证：定位到的确实是"读 thisLayer.size"那个节点（否则后面的 0 错毫无意义）
  const hitLines = node && typeof node.script === 'string' ? P.lines.filter((l) => node.script.includes(l)) : []
  ok(tag + 'a ' + P.id + ' ' + P.at + ' 是真包脚本原文且逐字读 thisLayer.size',
    !!node && typeof node.script === 'string' && node.script.includes('thisLayer.size') && hitLines.length === P.lines.length,
    node ? ('源码 ' + node.script.length + ' 字节 · 命中行「' + hitLines[0] + '」') : '节点未找到')
  if (!node) continue
  const alone = { general: {}, objects: [node] }
  const r = runTicks(alone, P.ticks)
  note(tag + ' 窗口：' + P.ticks + ' 帧 × 1 次/帧 = ' + P.ticks + ' 次（P-142 起首帧不再多跑一次）'
    + '；上报 ' + P.report + ' 的 ×' + P.reportCount + ' 是"修前"的计数窗口 ——本窗口实测错数 = ' + r.total + ' 次')
  ok(tag + 'b ' + P.id + ' ' + P.at + ' 跑 ' + P.ticks + ' 帧 ⇒ update 抛错 ' + P.reportCount + ' → 0',
    r.update === 0, r.total === 0 ? '本窗口 0 错（上报字段 scriptErrs 口径）' : ('实测 ' + r.total + ' 错：' + JSON.stringify([...new Set(r.msgs)].slice(0, 3))))
}

// ═══════════════════════════ 5. S3 整包（全部脚本节点）跑 4 帧 ═══════════════════════════
// 对应上报里的 `subsystems.scriptErrs`：真机上它是**整包所有脚本**的聚合，本项按同一口径复核。
out('\nS3 整包 scriptErrs（上报口径）')
for (const P of [PACK_A, PACK_B]) {
  const tag = P === PACK_A ? 'S3a' : 'S3b'
  const sj = P === PACK_A ? sjA : sjB
  if (!sj) { skipItem(tag + ' ' + P.id + ' 整包', path.join('$MPW_ROOT', P.rel) + ' 不存在'); continue }
  const n = collectNodes(sj).length
  const r = runTicks(sj, 4)
  ok(tag + ' ' + P.id + ' 整包 ' + n + ' 个脚本节点 × 4 帧 ⇒ scriptErrs 为空',
    r.total === 0, r.total === 0 ? '0 错' : JSON.stringify([...new Set(r.msgs)].slice(0, 4)))
}

// ═══════════════════════════ 6. S4 合成探针（size 的量纲/语义，通用而非包补丁）═══════════════════════
// 官方 d.ts（`$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts:790-795`）：
//   `readonly size: Vec2` —— "Resolution of the image layer in pixels. Only read this, do not write."
// 本仓库统一用 Vec3 承载（parseV 口径，见 elysia/scene-scripts.js 的 sizeOf 注释）：.x/.y 同值、.z=0。
out('\nS4 合成探针：thisLayer.size / thisObject.size 的量纲与语义')
const SIZE3 = '1206.00000 512.00000 0.00000'
const SIZE2 = '1206.00000 512.00000'          // 场景里 size 常常只有两段（真包实测）
{
  // S4a 取值 + 两段 size 的 z 补 0
  const src = `'use strict';
export function update(value) {
  const s = thisLayer.size;
  value.x = s.x; value.y = s.y; value.z = s.z;
  return value;
}`
  const r2 = runProbe(src, { size: SIZE2 })
  const r3 = runProbe(src, { size: SIZE3 })
  ok('S4a thisLayer.size 读出数字 x/y 且两段 size 的 z 补 0（不是 undefined）',
    r2.msgs.length === 0 && r2.value === '1206.000000 512.000000 0.000000'
    && r3.msgs.length === 0 && r3.value === '1206.000000 512.000000 0.000000',
    'SIZE2 → ' + JSON.stringify(r2.value) + ' / SIZE3 → ' + JSON.stringify(r3.value)
    + (r2.msgs.length ? ' 错=' + r2.msgs[0] : ''))
}
{
  // S4b 缺 size 字段的层（文本/合成层）⇒ 零向量而不是 undefined
  const src = `'use strict';
export function update(value) {
  const s = thisLayer.size;
  value.x = s.x + s.y + s.z;
  value.y = (s === undefined) ? -1 : 1;
  value.z = 0;
  return value;
}`
  const r = runProbe(src, {})
  ok('S4b 层没有 size 字段时 ⇒ Vec3 零向量（而不是 undefined ⇒ 又一条 reading \'x\'）',
    r.msgs.length === 0 && r.value === '0.000000 1.000000 0.000000', JSON.stringify(r.value) + (r.msgs.length ? ' 错=' + r.msgs[0] : ''))
}
{
  // S4c 每次访问返回新对象（写它不污染层）；官方 readonly ⇒ 赋值不抛错（只写 getter 时 'use strict' 会抛）
  const src = `'use strict';
export function update(value) {
  const a = thisLayer.size;
  a.x = 999;
  thisLayer.size = new Vec3(1, 2, 3);
  value.x = thisLayer.size.x;
  value.y = thisLayer.size.y;
  value.z = 0;
  return value;
}`
  const r = runProbe(src, { size: SIZE2 })
  ok('S4c size 每次访问是新对象（写它不污染层）且 `thisLayer.size = …` 在 strict 下不抛错',
    r.msgs.length === 0 && r.value === '1206.000000 512.000000 0.000000',
    JSON.stringify(r.value) + (r.msgs.length ? ' 错=' + r.msgs[0] : ''))
}
{
  // S4d thisObject.size 与 thisLayer 同源（thisObject = 属性所绑定的那个层）
  const src = `'use strict';
export function update(value) {
  value.x = thisObject.size.x;
  value.y = thisObject.size.y;
  value.z = 0;
  return value;
}`
  const r = runProbe(src, { size: SIZE2 })
  ok('S4d thisObject.size 同样是数字（与 thisLayer 同一个 ILayer 概念）',
    r.msgs.length === 0 && r.value === '1206.000000 512.000000 0.000000', JSON.stringify(r.value) + (r.msgs.length ? ' 错=' + r.msgs[0] : ''))
}
{
  // S4e thisScene.getLayer(name).size 与本项同一口径（回归面：那一路本来就有 size，不能被改坏）
  const src = `'use strict';
export function update(value) {
  const L = thisScene.getLayer('bg');
  value.x = L.size.x; value.y = L.size.y; value.z = 0;
  return value;
}`
  const probe = { id: 1, name: 'p137-probe', script: src, value: '0 0 0' }
  const holder = { id: 2, name: 'bg', size: SIZE2, origin: '0 0 0' }
  const scene = { general: {}, objects: [probe, holder] }
  const r = runTicks(scene, 1)
  ok('S4e thisScene.getLayer(name).size 口径不变（命中带 size 的层 ⇒ 1206/512/0）',
    r.total === 0 && probe.value === '1206.000000 512.000000 0.000000',
    JSON.stringify(probe.value) + (r.total ? ' 错=' + r.msgs[0] : ''))
}

// ═══════════════════════════ 7. S5 同族扫描（全语料第 1 帧）═══════════════════════════
// 用户第 8 条的真正目的：不是修一个包，而是"同一类 bug 还有多少"。
// 硬断言只有两条：① 抛 `reading 'x'` 的包 = **0**；② 残余错误种类 ⊆ KNOWN_GAPS（出现新种类即红）。
//
// ①(P-141 2026-09-19) **白名单被清空**：P-137 交付时这里冻结了"残余 8 类 / 8 包"的其他 API 缺口
//   （getAnimation / getParticleSystem / getLayerIndex / isPlaying / createLayer / toFixed 级联 /
//   audioLayer.stop / engine.setInterval）。P-141 把这 8 类逐个实现后，**先实测**"有脚本错的包 = 0"
//   （全语料 37 个带 scripts 的包 / 1953 个脚本节点），再把这个白名单缩到空 —— 顺序不能反：
//   白名单是**结果**不是手段。缩空之后 S5c 的语义变成"任何残余种类都算新"，
//   并且下面新增的 S5d 直接断言"包数 = 0"，避免"白名单为空 + 无断言"出现假绿。
//   ②(2026-09-23 语料漂移修复) **白名单重新非空**：新增 `0923/` + `wallpaperE/` 后实测 6 个包
//   抛 6 类错 —— 逐条查过真因，全是**新语料暴露的宿主/API 缺口**（不是语料噪音；清单上方有逐条
//   真因与文件行号）。判据因此升级为**逐包 + 逐串**：新包 ⇒ 红、已知包多出一条新串 ⇒ 也红、
//   已知串消失（= 产品侧修好了）⇒ 打印"已消失，请删条目"（不红）。
/* ②(2026-09-23 语料漂移修复) 白名单**:逐包 + 逐串**登记 2026-09-23 新语料暴露的缺口。
 *   为什么不是"把 0 改成 6"了事：这 6 个包是**真的在抛错**，而"全语料 0 错"这条判据本身没错 ——
 *   所以判据改成"**任何不在清单里的包/错误串 ⇒ 红**"（比"种类 ⊆ 白名单"更细：同包多一条新串也红），
 *   并把每条缺口的**真因**写清（下方注释），便于产品侧决定是否补 API/语义。
 *   ③(P-142 2026-09-23 产品侧已修，清单 6 → 1)：`elysia/scene-scripts.js` 修了**跑序**（新增 prepare 趟
 *   "先建全图"，init 趟只跑 init、update 趟只跑 update）与**四类成员/作用域缺口**，下面 5 条已消失：
 *     · `0923/2887099508`（getAnimationLayer / destroyLayer）、`0923/3122339805`（ITextLayer.text）、
 *     · `0923/3521337568`、`0923/3653641024`（模块顶层挂 shared 的 NSL 主脚本）、
 *     · `wallpaperE/佩丽卡/佩丽卡1_03.mpkg`（生产者在 init 写 shared、消费者只有 update 且排在前面）。
 *   ⚠ 仍留的**唯一**一条是**作者笔误**（不是宿主缺口）：`0923/3662790108` 的常量脚本把
 *     `shared.p1_longNode` 写成了 `shared.shared.p1_longNode`（同组另一个常量脚本读 `shared.p1_longNode`
 *     却 0 错 ⇒ 证明 constants 脚本**拿得到** shared；全语料 206 容器里 `shared.shared` 只有这一个包在读、
 *     零个包在写）。宿主不伪造 `shared.shared`，逐条证据见 `tests/script-phase-order-test.mjs` 的 S3d/S5。 */
const KNOWN_GAPS = new Set([
  'update:Cannot read properties of undefined (reading \'p1_longNode\')',
])
/** 逐包清单：rel → 该包允许出现的**归一化**错误串集合（同包新串同样红）。 */
const KNOWN_GAP_PKGS = new Map([
  ['0923/3662790108/scene.pkg', ['update:Cannot read properties of undefined (reading \'p1_longNode\')']],
])
/** `reading 'x'`（P-137 同一类）的已知包：**已清空**（P-142 修好 `wallpaperE/佩丽卡/佩丽卡1_03.mpkg` 后
 *  全语料 0 个包抛这一类）—— 白名单空 = 硬判据：再出现任何一个包即红。 */
const KNOWN_X_PKGS = new Set()
const normMsg = (m) => String(m).replace(/×\d+/g, '').replace(/\b\d+(\.\d+)?\b/g, 'N')

if (QUICK) skipItem('S5 同族扫描', '--quick（变异子进程）跳过')
else if (!fs.existsSync(ALLWALLPAPER)) skipItem('S5 同族扫描', path.join('$MPW_ROOT', 'allwallpaper') + ' 不存在')
else {
  out('\nS5 同族扫描：$MPW_ROOT/allwallpaper 全部容器，逐包第 1 帧')
  const files = walkContainers(ALLWALLPAPER)
  const errPacks = []          // 有错的包
  const pkgMsgs = new Map()    // 包 → 归一化错误串集合（②(2026-09-23) S5d 的逐包逐串判据要用）
  const xPacks = []            // 抛 reading 'x' 的包
  const kinds = new Map()      // 归一化错误种类 → 包数
  let withScripts = 0, nodes = 0
  for (const f of files) {
    let sj = null
    try { const t = readSceneJsonText(f); if (t) sj = JSON.parse(t.replace(/^\uFEFF/, '')) } catch { continue }
    if (!sj) continue
    const ns = collectNodes(sj).length
    if (!ns) continue
    withScripts++; nodes += ns
    const msgs = []
    withMutedLog(() => {
      try { applySceneScripts(sj, 0, { scriptCache: createScriptCache(), canvasSize: { x: 1920, y: 1080 }, onError: (st, e) => msgs.push(st + ':' + ((e && e.message) || e)) }) }
      catch (e) { msgs.push('host:' + e.message) }
    })
    if (!msgs.length) continue
    const rel = path.relative(ALLWALLPAPER, f)
    errPacks.push(rel)
    const uniq = [...new Set(msgs)]
    if (uniq.some((m) => /reading 'x'/.test(m))) xPacks.push(rel)
    pkgMsgs.set(rel, new Set(uniq.map(normMsg)))
    for (const m of uniq) kinds.set(normMsg(m), (kinds.get(normMsg(m)) || 0) + 1)
  }
  const total = files.length
  note('扫描面：' + total + ' 个容器 / ' + withScripts + ' 个带 scripts 的包 / ' + nodes + ' 个脚本节点')
  note('有脚本错的总包数 = ' + errPacks.length + '（P-137 修前实测 18 ⇒ 修后 ' + errPacks.length + '，差额 11 全是本类 bug）')
  ok('S5a 扫描非空（带 scripts 的包 ≥ 20，否则"0 个包抛错"是假绿）', withScripts >= 20, withScripts + ' 个包')
  /* ②(2026-09-23) S5b 从"`reading 'x'` 的包 = 0"改成"⊆ **已知那一个包**"：P-137 那类 bug 的
   *   判据本身没错（新语料里它又出现了一次），所以保留"别处再出现即红"的分辨力。 */
  const xUnknown = xPacks.filter((p) => !KNOWN_X_PKGS.has(p))
  const xMissing = [...KNOWN_X_PKGS].filter((p) => !xPacks.includes(p))
  ok('S5b 第 1 帧抛 `reading \'x\'` 的包 ⊆ 已知清单（已知 ' + KNOWN_X_PKGS.size + ' 个；出现新包即红）', xUnknown.length === 0,
    xUnknown.length ? ('新包：' + JSON.stringify(xUnknown.slice(0, 5))) : ('本轮 ' + xPacks.length + ' 个；清单里已消失（= 修好了，请删条目）：' + JSON.stringify(xMissing)))
  const unknown = [...kinds.keys()].filter((k) => !KNOWN_GAPS.has(k))
  ok('S5c 残余错误种类 ⊆ 已知清单（出现**新**种类即红）', unknown.length === 0,
    unknown.length ? JSON.stringify(unknown) : kinds.size + ' 种 / 清单 ' + KNOWN_GAPS.size + ' 种'
      + (KNOWN_GAPS.size ? '（全部为已登记的新语料缺口，见 KNOWN_GAPS 上方注释）' : '（白名单已缩空 ⇒ 0 种是硬判据）'))
  /* ②(2026-09-23) S5d 从"白名单为空 ⇒ 包数 = 0"改成**逐包逐串**（比 S5c 的种类层更细）：
   *   新包 ⇒ 红；已知包多出一条新串 ⇒ 也红；清单为空时退化成原来的"包数 = 0"。 */
  const unexpectedPkgs = []
  for (const rel of errPacks) {
    const allow = KNOWN_GAP_PKGS.get(rel)
    if (!allow) { unexpectedPkgs.push(rel + '（**新包**）'); continue }
    for (const m of pkgMsgs.get(rel) || []) if (!allow.includes(m)) unexpectedPkgs.push(rel + ' :: ' + m)
  }
  const knownAbsent = [...KNOWN_GAP_PKGS.keys()].filter((rel) => !errPacks.includes(rel))
  ok('S5d 有脚本错的包/串 ⊆ 已知缺口清单（逐包逐串；清单为空 ⇔ 必须 0 个包）', unexpectedPkgs.length === 0,
    unexpectedPkgs.length ? ('新缺口：' + JSON.stringify(unexpectedPkgs.slice(0, 5))) : (errPacks.length + ' 个包全部在清单内；清单里已消失：' + JSON.stringify(knownAbsent)))
  /* 分辨力自证（合成数字，不依赖语料）：两个 matcher 对"新包 / 同包新串 / 清单内"三态判定正确。 */
  const pkgsSubset = (found, known) => {
    const outP = []
    for (const [rel, ms] of found) { const a = known.get(rel); if (!a) { outP.push(rel); continue } for (const m of ms) if (!a.includes(m)) outP.push(rel + '::' + m) }
    return outP
  }
  const synthFound = new Map([['A', ['x:1']], ['B', ['y:2']], ['C', ['z:3', 'w:4']]])
  const synthKnown = new Map([['A', ['x:1']], ['C', ['z:3']]])
  ok('S5d-分辨力（合成数字）：清单内=放行、新包=报红、同包新串=报红',
    pkgsSubset(new Map([['A', ['x:1']]]), synthKnown).length === 0
    && pkgsSubset(synthFound, synthKnown).length === 2,
    '清单内=0 新包+新串=' + pkgsSubset(synthFound, synthKnown).length + '（' + JSON.stringify(pkgsSubset(synthFound, synthKnown)) + '）')
  out('    —— 残余（前 5 个包）：' + (errPacks.length ? '' : '无（0 个包有脚本错）'))
  for (const p of errPacks.slice(0, 5)) out('       ' + p)
  out('    —— 残余错误种类（包数）：' + (kinds.size ? '' : '无（0 种）'))
  for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) out('       ' + v + ' 个包  ' + k)
}

// ═══════════════════════════ 8. S6 红-if-reverted（变异自检）═══════════════════════════
if (IS_MUTANT_RUN) note('S6 变异体运行（MPW_SCENE_SCRIPTS 已设）⇒ 跳过自检，避免递归')
else if (!MUTATION) note('S6 红-if-reverted 自检被 --no-mutation 跳过（本次运行**未**复核变异必红）')
else {
  out('\nS6 红-if-reverted：删掉 size 访问器 ⇒ 本文件必须变红')
  const SRC = fs.readFileSync(MODULE, 'utf8')
  try {
    // 逐文件复制（`fs.cpSync` 在本机 /tmp 上抛 EINVAL；`Dirent.isFile()` 有误报 ⇒ statSync 判类型）
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
    const SIZE_LAYER_ANCHOR = "      // ①(P-137) `thisLayer.size`（IEffectLayer.size，官方 Vec2 / readonly）：长注释见 sizeOf 定义处\n"
      + '      get size() { return sizeOf(cur()); },\n'
      + '      set size(v) { /* 官方 readonly：静默丢弃而不抛错，理由见 sizeOf 上方注释 */ },\n'
    const SIZE_OBJECT_ANCHOR = "      // ①(P-137) `thisObject.size`：与 thisLayer 同一个 ILayer 概念（属性绑定的对象就是该层），\n"
      + '      //   同一份 sizeOf 读取器 —— 缺了它，把 size 写在 thisObject 上的作者脚本会掉进同一条 TypeError。\n'
      + '      get size() { return sizeOf(cur()); },\n'
      + '      set size(v) { /* 官方 readonly：静默丢弃而不抛错，理由见 sizeOf 上方注释 */ },\n'
    const MUTANTS = [
      {
        id: 'M1', fix: 'thisLayer.size 读取器', expectName: 'S1b / S2b（真包 update 抛错 511/72 → 0）',
        expect: /✗ S(1|2)b/, quick: false, baseline: /✓ S0a/, baselineName: 'S0a（副本可加载）',
        desc: '删掉 layerRef() 里的 `size` 访问器（回到"读到 undefined"的旧状态）',
        edits: [[SIZE_LAYER_ANCHOR, '']],
      },
      {
        id: 'M2', fix: 'thisObject.size 读取器', expectName: 'S4d（thisObject.size 是数字）',
        expect: /✗ S4d/, quick: true, baseline: /✓ S4a/, baselineName: 'S4a（thisLayer.size 那一半完好、合成探针照样出数）',
        desc: '删掉 objectRef() 里的 `size` 访问器（thisObject 那一半回到旧状态）',
        edits: [[SIZE_OBJECT_ANCHOR, '']],
      },
    ]
    for (const m of MUTANTS) {
      // M1 的唯一硬判据是"真包 S1b/S2b 变红" ⇒ 真包缺失时它无从证明，如实 SKIP（不假装通过）
      if (m.id === 'M1' && !CAN_RUN_REAL) { skipItem('mutation-selfcheck ' + m.id, '真包缺失 ⇒ S1b/S2b 无从变红'); continue }
      let src = SRC, bad = null
      for (const [from, to] of m.edits) {
        const n = src.split(from).length - 1
        if (n !== 1) { bad = '锚点命中 ' + n + ' 次：' + JSON.stringify(from.slice(0, 70)); break }
        src = src.split(from).join(to)
      }
      if (bad) { skipItem('mutation-selfcheck ' + m.id, bad + '（沙箱那几行已被改写 ⇒ 需重新标定；不做变异＝不算证据）'); continue }
      const f = path.join(tmpEly, 'scene-scripts.js')
      fs.writeFileSync(f, src)
      const args = [process.argv[1], '--no-mutation']
      if (m.quick) args.push('--quick')     // M1 要跑全语料（用来证明"修前 11 个包抛 reading 'x'"）
      const r = spawnSync(process.execPath, args, {
        encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, { MPW_SCENE_SCRIPTS: f }),
      })
      const so = String(r.stdout || '') + String(r.stderr || '')
      const redLine = (so.match(m.expect) || [])[0] || (so.match(/✗ [^\n]*/) || [])[0] || ''
      const measured = (so.match(/本窗口实测 = \d+ 次/) || [])[0] || ''
      ok('S6-' + m.id + '（' + m.fix + '）变异「' + m.desc + '」⇒ 子进程 rc=1 且 ' + m.expectName + ' 变红',
        r.status === 1 && m.expect.test(so),
        'rc=' + r.status + ' 失败断言=' + JSON.stringify(redLine.slice(0, 160)) + (measured ? ' · 变异体 ' + measured : ''))
      // 基线仍在 ⇒ 变异打破的是被点名的那条语义，不是"副本根本加载不起来"（否则红得毫无意义）。
      // 基线**按变异各取一条不受该变异影响的断言**（M1 取 S0a：副本可加载；M2 取 S4a：thisLayer.size
      // 那一半完好、合成探针照样出数）—— 拿被变异打破的那条当"基线"是把同一条错算两遍。
      ok('S6-' + m.id + 'b 变异体里基线仍 ✓（' + m.baselineName + ' ⇒ 红是被点名的那条，不是副本起不来）',
        m.baseline.test(so), '')
      if (!m.quick) {
        // 反向证明：同一趟全语料扫描在变异体里**必须**重新出现 `reading 'x'` 的包 —— 这就是
        // "这类 bug 到底还有多少"的对照值（真树 = 0）。
        const xline = (so.match(/✗ S5b[^\n]*/) || [])[0] || ''
        const detail = xline.split('—')[1] || ''
        const listed = (detail.match(/"([^"]+)"/g) || []).length
        const before = (so.match(/有脚本错的总包数 = \d+/) || [])[0] || ''
        const xkind = (so.match(/\d+ 个包\s+update:Cannot read properties of undefined \(reading 'x'\)/) || [])[0] || ''
        ok('S6-M1c 变异体里同族扫描回到"有包抛 reading \'x\'"（真树 0 个包 ⇒ 两边的差额全是本类 bug）',
          /✗ S5b/.test(so), '变异体 ' + (xkind || (listed + ' 个包（明细被截断到前 5）')) + ' · ' + before
          + ' · 前 5：' + detail.slice(0, 110))
        if (VERBOSE && detail) note('S6-M1 变异体 S5b 明细', detail.slice(0, 300))
      }
      if (r.status !== 1 && VERBOSE) note('S6-' + m.id + ' 子进程输出尾部', JSON.stringify(so.slice(-800)))
    }
  } finally { /* TMP 由 process.on('exit') 统一清理 */ }
}

// ═══════════════════════════ 9. 汇总 ═══════════════════════════
const peak = (() => { try { const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/); return m ? Math.round(+m[1] / 1024) + 'MB' : '?' } catch { return '?' } })()
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skip + '；PeakRSS=' + peak + ')')
if (fail) { out('\n' + fail + ' 项失败'); process.exit(1) }
out('\nALL PASS （' + pass + ' 项' + (skip ? '，另 SKIP ' + skip : '') + '）')
process.exit(0)

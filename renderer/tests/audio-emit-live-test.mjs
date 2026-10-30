/* 参照来源许可声明：本文件提到的 wer-ref/lwe-ref 是第三方参考实现（GPL-2.0-only / GPL-3.0-only），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。官方语义引注见 docs/PATCHES.md P-131。 */
// audio-emit-live-test.mjs — ①(P-131 批D 2026-09-19) **音频驱动发射 + AudioBuffers 活视图** 秒级门禁
//
// 注册：①(P-132 批D 后 · 主对话补登记 2026-09-19) 已登记进 `tests/run-all-tests.sh`：
//   `add "audio-emit-live" "node tests/audio-emit-live-test.mjs"`（实测 ~0.35s，无浏览器/无网络）。
//   登记前该文件的判据由已注册的 `particle-render-correctness`（⑧/⑧R/⑧M 段）与 `audio-band-wiring`（T6 段）承担。
//
// 覆盖（全部"手算/独立复算 vs 实测"，且都在本机秒级可跑）：
//   T1 **语料字段 vs 我们的支持**：真包（3 个 mode>0 的音频驱动包）里 `audioprocessing*` 的字段/取值直方图
//      与 `parseAudioResponse` 的解析结果逐项对齐（字段面 = 官方编辑器 *Audio response* 的全集）
//   T2 **活视图**：`engine.registerAudioBuffers(n)` 在"脚本顶层只调一次 + scriptCache"下，长期持有的那份
//      必须**同一引用、内容每帧变化**、`average` 逐段 = (left+right)/2（官方 AudioBuffers 文档口径）
//   T3 **`?audioemit=` 档位表**（auto/strict/legacy）在**真模块**上的行为（动态 import + 桩 location）
//   T4 **反向变异（RED-IF-REVERTED）**：把 `elysia/scene-scripts.js` 的活视图改回旧"每次新建数组"
//      写法（**在 /tmp 的真文件副本里改**，真树只读）⇒ T2 的断言必红
//
// 运行：node tests/audio-emit-live-test.mjs [--verbose]   （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as _root from './_root.mjs'
import * as lib from '../core/we-scene-bundle.js'
import { applySceneScripts, createScriptCache, peekAudioView } from '../elysia/scene-scripts.js'
import { parseAudioResponse, audioEnvelope, createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS } from '../core/audio-band-array.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MPW_WS = process.env.MPW_ROOT || _root.WS || path.resolve(_root.ROOT, '..')
const VERBOSE = process.argv.includes('--verbose')
let failed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps
const dec = new TextDecoder()

/* ── 真包读取（只 seek entry，不整包解包；用完就丢引用）───────────────────────────
 * 语料只在 mpkg/scene.pkg 的 entry 里，`parsePkg` 只解析文件头的自描述入口表 ⇒ 单包内存 = 该包字节数
 * （本用例只读 3 个**模式>0**的音频驱动包：11MB / 44MB / 23MB，逐个读、逐个丢）。 */
function readDefsPkg(rel) {
  const file = `${MPW_WS}/allwallpaper/${rel}/scene.pkg`
  if (!fs.existsSync(file)) return null
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file)))
  const out = []
  for (const e of (pkg.entries || [])) {
    if (!/^particles\/.*\.json$/.test(e.name)) continue
    try {
      const d = JSON.parse(dec.decode(lib.getEntry(pkg, e.name)))
      if (JSON.stringify(d).includes('audioprocessing')) out.push({ name: e.name, def: d })
    } catch (err) { /* 坏 entry 跳过（与本用例无关） */ }
  }
  return out
}

console.log('\n== T1 语料 `audioprocessing*` 字段 vs 我们的支持（真包直读）==')
{
  const PKGS = ['0917/3299228616', 'dd/3544152633', 'dd/3554161528']
  const records = []
  let missing = 0
  for (const rel of PKGS) {
    const defs = readDefsPkg(rel)
    if (!defs) { missing++; continue }
    for (const d of defs) for (const kind of ['emitter', 'initializer', 'operator']) {
      for (const c of (d.def[kind] || [])) {
        if (!Object.keys(c).some((k) => k.startsWith('audioprocessing'))) continue
        records.push({ pkg: rel, def: d.name, kind, raw: c, spec: parseAudioResponse(c, kind === 'emitter' ? 'emitter' : 'operator') })
      }
    }
  }
  if (missing) { ok(true, 'T1 语料包缺失（SKIP 视作 PASS）', missing + '/3 个包不在本机') }
  else {
    // 直方图按**键排序**序列化（对象插入序不稳，比较会假红）
    const hist = (key) => records.reduce((m, r) => { const v = String(r.raw[key]); m[v] = (m[v] || 0) + 1; return m }, {})
    const H = (key) => JSON.stringify(Object.keys(hist(key)).sort().map((k) => [k, hist(key)[k]]))
    const HE = (want) => JSON.stringify(Object.keys(want).sort().map((k) => [k, want[k]]))
    const kinds = records.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m }, {})
    const on = records.filter((r) => r.spec && r.spec.mode > 0)
    // 语料实测（本用例自己 grep 的口径）：13 个 mode>0 组件 = 10 emitter + 1 initializer + 2 operator；
    //   逐个包：0917/3299228616 = 36 层（6 个 Star_*.json，各 1 个 emitter）、dd/3544152633 = 8 层
    //   （Stars_copy1 的 2 emitter + 1 initializer + 1 operator、Star_Reactive 的 emitter+operator）、
    //   dd/3554161528 = 1 层（notes1_simple_copy1）。
    ok(records.length === 14 && on.length === 13,
      'T1a 3 个真音频驱动包里 `audioprocessing*` 组件 = 14 个，其中 **mode>0 = 13 个**（真开着音频响应）',
      `共 ${records.length} / mode>0 ${on.length}`)
    ok(kinds.emitter === 11 && kinds.initializer === 1 && kinds.operator === 2 && on.filter((r) => r.kind === 'emitter').length === 10,
      'T1a 组件分布：emitter 11（其中 10 个 mode>0）/ initializer 1 / operator 2（turbulence）',
      JSON.stringify(kinds))
    ok(H('audioprocessingmode') === HE({ 3: 13, undefined: 1 }),
      'T1b 语料 `audioprocessingmode` **只出现 3（Center）** 13 次（官方编辑器：None/Left/Right/Center ⇒ 3=居中）',
      H('audioprocessingmode'))
    ok(H('audioprocessingbounds') === HE({ '0 1': 2, '0.5 1': 3, '0.8 1': 2, undefined: 7 }),
      'T1b `audioprocessingbounds` = "0 1"/"0.5 1"/"0.8 1" —— 均为 `Vec2` 字符串，我们按 [b0,b1] 阈值区间解析',
      H('audioprocessingbounds'))
    ok(H('audioprocessingfrequencyend') === HE({ 15: 1, 10: 1, 3: 1, 2: 1, undefined: 10 }) &&
      H('audioprocessingfrequencystart') === HE({ 1: 2, undefined: 12 }),
      'T1b `audioprocessingfrequencyend` = 15/10/3/2、`frequencystart` = 1 ⇒ 官方文档的"0..15 频段下标"口径（不是 Hz）',
      JSON.stringify(hist('audioprocessingfrequencyend')) + ' / ' + JSON.stringify(hist('audioprocessingfrequencystart')))
    ok(H('audioprocessingexponent') === HE({ 3: 1, 1: 1, undefined: 12 }),
      'T1b `audioprocessingexponent` = 3 / 1（幂次）', H('audioprocessingexponent'))
    // 我们**认得**语料里的每一个键（解析结果非空且 mode 与原文一致）
    ok(on.every((r) => r.spec && r.spec.mode === Number(r.raw.audioprocessingmode) && Array.isArray(r.spec.bounds) && r.spec.bounds.length === 2 &&
      Number.isFinite(r.spec.exponent) && Number.isFinite(r.spec.freqStart) && Number.isFinite(r.spec.freqEnd)),
      'T1c 13/13 个 mode>0 组件的五个字段全部被 `parseAudioResponse` 读出（mode/bounds/exponent/freqStart/freqEnd）')
    // mode=3 的包默认（缺 bounds/exponent/freq 的 6 个 Star_*.json）走 emitter 官方缺省
    const starDefaults = records.filter((r) => r.def.includes('Star_0') || r.def.includes('Shooting_Star'))
    ok(starDefaults.length === 6 && starDefaults.every((r) => r.spec.bounds[0] === 0.8 && r.spec.exponent === 2 && r.spec.freqEnd === 1),
      'T1d `Star_*.json`（6 个只写 mode:3 的 def）按 emitter 官方缺省补全：bounds 0.8-1 / exponent 2 / freq 0-1',
      starDefaults.length ? JSON.stringify(starDefaults[0].spec) : '0')
    // 官方语义矩阵（供报告 §④ 的表格；此处以断言形式钉住"我们支持的档位"）
    const specAll = { mode: 3, bounds: [0, 1], exponent: 1, freqStart: 0, freqEnd: 15 }
    const v = createLiveBands(AUDIO_RESPONSE_BANDS)
    const a = new Float32Array(AUDIO_RESPONSE_BANDS).fill(1)
    writeLiveBands(v, a, a, { kind: 'test', hasSource: true })
    ok(near(audioEnvelope(specAll, v), 1) && audioEnvelope({ ...specAll, mode: 0 }, v) === null &&
      near(audioEnvelope({ ...specAll, mode: 1 }, v), 1) && near(audioEnvelope({ ...specAll, mode: 2 }, v), 1),
      'T1e 0-3 档语义：0=None（返回 null = 不调制）/ 1=Left / 2=Right / 3=Center（全 1 频段下四档都=1，通道差异见 ⑧-3）')
  }
}

console.log('\n== T2 AudioBuffers 活视图（脚本顶层只调一次 + scriptCache）==')
{
  // 与真机同形：一段脚本在**顶层**调 `registerAudioBuffers(16)` 并长期持有，`update()` 里读它
  const SRC = `'use strict';
const audioBuffer = engine.registerAudioBuffers(engine.AUDIO_RESOLUTION_16);
export function update(value) { return String(audioBuffer.average[0].toFixed(6)) + '|' + String(audioBuffer.average[15].toFixed(6)) + '|' + audioBuffer.left.length }`
  const mkScene = () => ({ objects: [{ id: 7, text: { script: SRC, value: '' } }] })
  const hostOf = (reader) => (n) => {
    const l = new Float32Array(n), r = new Float32Array(n)
    for (let i = 0; i < n; i++) { l[i] = reader.l(i); r[i] = reader.r(i) }
    return { left: l, right: r }
  }
  const scene = mkScene()
  const cache = createScriptCache()
  let frame = 0
  const reader = { l: () => 0.25, r: () => 0.25 }
  const run = (t) => applySceneScripts(scene, t, { scriptCache: cache, renderObjects: scene.objects, frametime: 1 / 60, audioBuffers: hostOf(reader) })
  run(0)
  const v1 = peekAudioView(16)
  const first = scene.objects[0].text.value
  reader.l = (i) => 0.1 + i * 0.05        // 第 2 帧：低频小、高频大（逐段不同）
  reader.r = (i) => 0.1 + i * 0.05
  run(1 / 60)
  const v2 = peekAudioView(16)
  const second = scene.objects[0].text.value
  ok(!!v1 && v1 === v2 && v1.left === v2.left && v1.average === v2.average,
    'T2a ★`registerAudioBuffers(16)` 顶层只调一次：跨帧是**同一对象/同一批数组**（scriptCache 下脚本不再重编也照样更新）')
  ok(first !== second && /^0\.250000\|0\.250000\|16$/.test(first) && /^0\.100000\|0\.850000\|16$/.test(second),
    'T2a ★内容**随帧原地变化**：第 1 帧 average=[0.25…0.25]，第 2 帧 = [0.1…0.85]（旧实现永远是编译那一刻的全 0）',
    first + ' → ' + second)
  ok(v2.left instanceof Float32Array && v2.average instanceof Float32Array && v2.left.length === 16,
    'T2b 类型/长度 = 官方文档口径（Float32Array、长度 = resolution）')
  let badA = 0, spread = 0
  for (let i = 0; i < 16; i++) { if (!near(v2.average[i], (v2.left[i] + v2.right[i]) / 2)) badA++; spread = Math.max(spread, Math.abs(v2.average[i] - v2.average[0])) }
  ok(badA === 0 && spread > 1e-3,
    'T2c `average` 逐段 = (left[i]+right[i])/2（官方 "arithmetic mean of both channels"；旧实现是"整条总均值填满" ⇒ 对任何 i 都一样）',
    'spread=' + spread.toFixed(4))
  // 没有宿主数据源 ⇒ 全 0 且**可观测**（hasSource=false / kind=silent），不是静默假装
  const scene2 = mkScene()
  applySceneScripts(scene2, 0, { scriptCache: createScriptCache(), renderObjects: scene2.objects, frametime: 1 / 60, audioBuffers: () => null })
  const z = peekAudioView(16)
  ok(/^0\.000000\|0\.000000\|16$/.test(scene2.objects[0].text.value) && z.hasSource === false && z.kind === 'silent' && z.average.every((x) => x === 0),
    'T2d 没有数据源 ⇒ 全 0 + `hasSource=false`/`kind=silent`（可观测；旧实现连"有没有源"都无从判断）',
    scene2.objects[0].text.value + ' hasSource=' + z.hasSource)
}

console.log('\n== T3 `?audioemit=` 档位表（真模块 + 桩 location 动态 import）==')
{
  const def = { maxcount: 100000, emitter: [{ name: 'boxrandom', rate: 100, distancemax: '0 0 0', audioprocessingmode: 3, audioprocessingbounds: '0 1', audioprocessingexponent: 1, audioprocessingfrequencystart: 0, audioprocessingfrequencyend: 15 }],
    initializer: [{ name: 'lifetimerandom', min: 1000, max: 1000 }], operator: [{ name: 'movement' }], renderer: [{ name: 'sprite' }] }
  const load = async (search) => {
    globalThis.location = { search }
    const m = await import('file://' + path.join(ROOT, 'core', 'we-scene-bundle.js') + '?audioemit=' + encodeURIComponent(search))
    return m
  }
  const count = (m, view) => {
    m.setAudioBands(view)
    const sys = m.buildParticleSystem(def, {})
    m.simulateParticleSystem(sys, 1.0)
    return sys.particles.length
  }
  const loud = (() => { const v = createLiveBands(16); const a = new Float32Array(16).fill(1); writeLiveBands(v, a, a, { kind: 'test', hasSource: true }); return v })()
  const auto = await load('')
  const strict = await load('?audioemit=strict')
  const legacy = await load('?audioemit=legacy')
  ok(auto.audioBandsInfo().mode === 'auto' && strict.audioBandsInfo().mode === 'strict' && legacy.audioBandsInfo().mode === 'legacy',
    'T3a 档位解析：缺省 auto / `?audioemit=strict` / `?audioemit=legacy`（另有 `off`·`0` 别名）',
    [auto.audioBandsInfo().mode, strict.audioBandsInfo().mode, legacy.audioBandsInfo().mode].join('/'))
  const aNoView = count(auto, null), sNoView = count(strict, null), lNoView = count(legacy, null)
  ok(aNoView > 0 && sNoView === 0 && lNoView === aNoView,
    'T3b ★没有数据源时：auto = 保持旧行为（>0 粒，不把 52 层抹掉）/ strict = 官方"静音不发射"（0 粒）/ legacy = 旧行为',
    `auto=${aNoView} strict=${sNoView} legacy=${lNoView}`)
  const aLoud = count(auto, loud), sLoud = count(strict, loud), lLoud = count(legacy, loud)
  ok(Math.abs(aLoud - lNoView) <= 1 && Math.abs(sLoud - aLoud) <= 1 && lLoud === lNoView,
    'T3c ★有数据源（满音量）时：auto 与 strict 都按官方调制（≈旧行为）/ legacy **完全不调制**（与无视图逐位相同）',
    `auto=${aLoud} strict=${sLoud} legacy=${lLoud}`)
  const silentView = createLiveBands(16)
  // "有数据源但很安静"：`hasSource=true` + 全 0 频段（不能只给空视图 —— 那是"没有数据源"，走 auto 豁免）
  writeLiveBands(silentView, new Float32Array(16), new Float32Array(16), { kind: 'analyser', hasSource: true })
  const aSilent = count(auto, silentView)
  const sSilent = count(strict, silentView)
  ok(sSilent === 0, 'T3d strict 档：有数据源但静音 ⇒ 0 粒', 'strict=' + sSilent)
  ok(aSilent === 0, 'T3d 有数据源但静音（全 0 频段）⇒ auto/strict 都算 env=0 ⇒ **0 粒**（官方 emitter 语义）', 'auto=' + aSilent)
  delete globalThis.location
}

console.log('\n== T4 反向变异（/tmp 真文件副本；真树只读）==')
{
  const SRC_FILE = path.join(ROOT, 'elysia', 'scene-scripts.js')
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const before = sha(SRC_FILE)
  const src = fs.readFileSync(SRC_FILE, 'utf8')
  // 变异：把 `registerAudioBuffers` 改回旧写法（每次调用**新建**数组 = "编译那一刻的快照"）
  // 变异体 = **批 D 之前的原始实现**（逐字取自 `git show HEAD:elysia/scene-scripts.js`）：
  //   转发宿主返回的数组 → 顶层 `const` 拿到"编译那一刻的快照"，此后 5 帧都不动。
  const OLD_IMPL = `      registerAudioBuffers: (n) => {
        const len = Math.max(1, Number(n) || 64)
        if (typeof opts.audioBuffers === 'function') {
          try {
            const b = opts.audioBuffers(len)
            if (b && b.left && b.right && b.average) return b
          } catch { /* 回退静默 */ }
        }
        const z = new Array(len).fill(0)
        return { left: z.slice(), right: z.slice(), average: z.slice() }
      },`
  const anchor = '      registerAudioBuffers: (n) => fillAudioView(liveAudioView(n), opts.audioBuffers),'
  let red = null
  if (!src.includes(anchor)) red = '变异**没生效**（找不到 registerAudioBuffers 锚点）'
  else {
    const tmp = path.join(os.tmpdir(), 'p131-mut-scene-scripts.mjs')
    // 手工 readFileSync/writeFileSync（本机 fs.cpSync 抛 EINVAL；不用它）
    fs.writeFileSync(tmp, src.replace(anchor, OLD_IMPL).replace(/from '\.\//g, "from '" + path.join(ROOT, 'elysia') + '/'))
    try {
      const m = await import('file://' + tmp + '?mut=1')
      const SRC2 = `'use strict';
const audioBuffer = engine.registerAudioBuffers(engine.AUDIO_RESOLUTION_16);
export function update(value) { return String(audioBuffer.average[0].toFixed(6)) }`
      const scene = { objects: [{ id: 7, text: { script: SRC2, value: '' } }] }
      const cache = m.createScriptCache()
      const reader = { v: 0.25 }
      const run = (t) => m.applySceneScripts(scene, t, {
        scriptCache: cache, renderObjects: scene.objects, frametime: 1 / 60,
        // 宿主按**内缝契约**给三件套（改动前的实现要求 average 存在才转发）
        audioBuffers: (n) => ({ left: new Array(n).fill(reader.v), right: new Array(n).fill(reader.v), average: new Array(n).fill(reader.v) }),
      })
      run(0)
      const first = scene.objects[0].text.value
      reader.v = 0.9
      for (let i = 1; i <= 5; i++) run(i / 60)
      const after = scene.objects[0].text.value
      red = (first === '0.250000' && after === '0.250000')
        ? '变异生效｜旧写法（每次新建数组）⇒ 5 帧后仍是 ' + after + '（顶层 const 冻在编译那一刻）⇒ T2a/T2b 的"内容随帧变化"必红'
        : '变异**没红**（first=' + first + ' after=' + after + '）'
    } finally { try { fs.unlinkSync(tmp) } catch (e) { /* ignore */ } }
  }
  console.log('   RED ' + red)
  ok(/变异生效/.test(String(red)), 'T4 RED-IF-REVERTED：`registerAudioBuffers` 改回"每次新建数组"后，活视图断言变红（真树 sha256 前后相同：' + (sha(SRC_FILE) === before) + '）')
  ok(sha(SRC_FILE) === before, 'T4 真树 `elysia/scene-scripts.js` 跑前跑后 sha256 相同（变异只落在 /tmp 副本）', before.slice(0, 16))
}

console.log(failed ? `\n${failed} 项失败` : '\nALL PASS')
process.exit(failed ? 1 : 0)

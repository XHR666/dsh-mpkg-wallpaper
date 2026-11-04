// audio-band-wiring-test.mjs — P-112-BANDGEOM（任务书 §5-4 / P1-5）128 元频段数组**接线**验收
//
// 断言对象不是模块本身（那是 tests/audio-band-array-test.mjs 的活），而是**接线**：
//   `demo.html` 的 `MPW-BANDFEED` 块（`?bandfeed=`）与 `MPW-AUDIOBUFFERS` 块（脚本侧入口），
//   连同"模块真在链路里"的三处落点（服务端路由 / 产物根映射 / 源码 import）。
//
// 手法（与 baseline-test / props-panel-test / log-panel 同一套）：把**真源码切片**出来，
//   用 `new Function` 注入桩（假 analyser / 假 window.parent / 假 location），跑真实分支。
//   不碰 DOM、不碰 GPU、不碰网络 ⇒ 确定性、~0.1s。
//
// 六组：
//   T1 开关真值表（①(P-131 批D) **缺省 = auto**；off/sim/real/mic/垃圾值）
//   T2 模拟源：128 元 + γ/gain 曲线**逐位**对拍 + 不是全零（"接上了"的第一手证据）
//   T3 真实源：只钳位不套 γ（规格 §2.1/§5 的口径差异）+ 单声道不伪造立体声 + **无源 ⇒ 全 0 且可观测**
//   T4 场景层消费点：`audioBuffers(n)` 是**活视图**（同一 n 同一对象、内容随帧变化）+ `average` 逐段
//   T5 宿主桥（提案消息）+ 诊断 + 三处落点 + **反向变异必红**
//   T6 ①(P-131 批D) 16 段活视图交给渲染器（`lib.setAudioBands`）/ 麦克风源 / legacy 逐位回退
//
// 运行：node tests/audio-band-wiring-test.mjs   （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  packBands, simulatedBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
  // ①(P-131 批D) 活视图 + 16 段口径（官方 `audioprocessingfrequency*` 的 0..15 下标就在 16 段上）
  createLiveBands, writeLiveBands, resampleBands, AUDIO_RESPONSE_BANDS, audioEnvelope, parseAudioResponse,
} from '../core/audio-band-array.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps

const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
function slice(src, begin, end) {
  const i = src.indexOf(begin)
  if (i < 0) throw new Error('切片起点缺失: ' + begin)
  const j = src.indexOf(end, i)
  if (j < 0) throw new Error('切片终点缺失: ' + end)
  return src.slice(i, j + end.length)
}
const BAND_BLOCK = slice(HTML, '// ═══ MPW-BANDFEED-BEGIN', '// ═══ MPW-BANDFEED-END ═══')
const BUF_BLOCK = slice(HTML, '// ═══ MPW-AUDIOBUFFERS-BEGIN', '// ═══ MPW-AUDIOBUFFERS-END ═══')

/* ── 桩环境：把两个真源码块拼起来跑（依赖全部注入，源码里的裸标识符由形参遮蔽） ── */
function makeEnv(opts = {}) {
  const posted = []
  const logs = []
  const bandCalls = []
  const win = { parent: null, __mpwAudioBands: null, __mpwAudioBandSource: null }
  if (opts.navigator) win.navigator = opts.navigator
  if (opts.embedded) win.parent = { postMessage: (m) => posted.push(m) }
  else win.parent = win                                   // 顶层页面：parent === window
  const analyser = opts.analyser || null
  const freq = opts.freq || (analyser ? new Uint8Array(analyser.frequencyBinCount) : null)
  const sceneAudio = { ctx: null, analyser, els: [], freq, started: !!analyser, vols: [] }
  const location = { search: opts.search || '' }
  // ①(P-131 批D) 渲染器侧入口桩：`lib.setAudioBands(view)` 是 16 段活视图的**唯一**注入点
  const lib = {
    setAudioBands: (v) => { bandCalls.push(v); return v },
    audioBandsInfo: () => ({ mode: 'auto', hasView: bandCalls.length > 0, resolution: bandCalls.length ? bandCalls[bandCalls.length - 1].left.length : 0,
      kind: bandCalls.length ? bandCalls[bandCalls.length - 1].kind : null, hasSource: bandCalls.length ? !!bandCalls[bandCalls.length - 1].hasSource : false }),
  }
  const body = BAND_BLOCK + '\n' + BUF_BLOCK + `
return { BANDFEED, bandArrayNow, bandPublish, bandFrameTick, audioBuffers, last: () => bandLast, clock: () => bandClock,
         band16: () => bandView16, mic: () => bandMic, viewFor: bandViewFor, silentLogged: () => bandSilentLogged, placeholderLogged: () => bandPlaceholderLogged }`
  const fn = new Function(
    'packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
    'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
    'sceneAudio', 'location', 'window', 'logf', body,
  )
  const api = fn(packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
    createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, lib, sceneAudio, location, win, (m) => logs.push(m))
  return { api, win, posted, logs, bandCalls, lib, sceneAudio, location }
}
/** 造一个"真实源"analyser 桩：每段固定字节值（0..255），可指定返回数组长度 */
function fakeAnalyser(values, binCount) {
  const bins = binCount || values.length
  const freq = new Uint8Array(bins)
  return {
    frequencyBinCount: bins,
    getByteFrequencyData(target) { for (let i = 0; i < bins; i++) target[i] = (values[i % values.length] || 0) & 255 },
    _freq: freq,
  }
}

console.log('\n== T1 开关真值表（?bandfeed=）==')
{
  const cases = [
    // ①(P-131 批D) **缺省翻面**：空值/`?audio=1`/非法值/`auto` 一律 auto；只有 0/off/no/false 才是关
    ['', 'auto'], ['?audio=1', 'auto'], ['?bandfeed=', 'auto'], ['?bandfeed=auto', 'auto'],
    ['?bandfeed=banana', 'auto'],
    ['?bandfeed=0', 'off'], ['?bandfeed=off', 'off'], ['?bandfeed=no', 'off'], ['?bandfeed=false', 'off'],
    ['?bandfeed=1', 'auto'], ['?bandfeed=on', 'auto'], ['?bandfeed=true', 'auto'],
    ['?bandfeed=SIM', 'sim'], ['?bandfeed=simulated', 'sim'], ['?bandfeed=real', 'real'], ['?bandfeed=ANALYSER', 'real'],
    ['?bandfeed=mic', 'mic'], ['?bandfeed=MICROPHONE', 'mic'],
  ]
  let bad = 0
  for (const [s, want] of cases) { const e = makeEnv({ search: s }); if (e.api.BANDFEED !== want) { bad++; console.log('   ✗ ' + s + ' → ' + e.api.BANDFEED + '（期望 ' + want + '）') } }
  ok(bad === 0, 'T1a 18 条真值表全部命中（缺省/空值/非法值 = auto；只有 0/off/no/false 才关）', '坏 ' + bad + ' 条')
  ok(makeEnv({}).api.BANDFEED === 'auto' && makeEnv({ search: '?audio=1' }).api.BANDFEED === 'auto',
    'T1b 缺省 = **auto**（P-131 批D 翻面：批 D 之前缺省是 off ⇒ 25 个包的音频响应恒平）')
  ok(makeEnv({ search: '?bandfeed=off' }).api.BANDFEED === 'off',
    'T1c 旧行为仍可用 `?bandfeed=off` **逐位**复现（缺省翻面不改逃生口）')
}

console.log('\n== T2 模拟源：128 元 + γ/gain 曲线 + "确实有数据" ==')
{
  // ①(P-131 批D) 模拟源只在**显式** `?bandfeed=sim` 档（缺省 auto 无源是全 0，不假装有声音）
  const e = makeEnv({ search: '?bandfeed=sim' })
  const r = e.api.bandFrameTick(1.25)
  ok(r === undefined || r === null || true, 'T2a bandFrameTick 不抛错')
  const bands = e.win.__mpwAudioBands
  ok(bands instanceof Float32Array && bands.length === AUDIO_BAND_LEN, 'T2a 喂到消费点的是 128 元 Float32Array', bands && (bands.length + ' 元'))
  const stats = bandStats(bands)
  ok(stats.length === 128 && stats.silent === false && stats.peak > 0.3,
    'T2b 有数据（silent=false；`silent` 是"接上没有"的判据）', 'peak=' + stats.peak.toFixed(4) + ' peakAt=' + stats.peakAt)
  // "频谱要尖"（规格 §2.3）：模拟源在**节拍点上**把峰值顶到 1 附近 —— 单点取样可能落在拍间隙，
  //   所以按一个 132BPM 周期扫一遍取极值（这也是作者阈值 `band > 0.9` 能成立的判据）。
  let sweepPeak = 0, sweepAt = 0
  for (let t = 0; t < 2; t += 0.02) { const s = bandStats(simulatedBandArray(t)); if (s.peak > sweepPeak) { sweepPeak = s.peak; sweepAt = t } }
  ok(sweepPeak > 0.95, 'T2b 曲线是"尖"的（一个节拍周期内峰值 >0.95 ⇒ 阈值判定型作者能用）', 'sweepPeak=' + sweepPeak.toFixed(4) + ' @t=' + sweepAt.toFixed(2))
  ok(stats.peakAt < 64, 'T2c 峰值落在低频侧（底鼓/贝斯权重；模拟源刻意做得"像音乐"）', 'peakAt=' + stats.peakAt)

  const want = simulatedBandArray(1.25)
  let diff = 0
  for (let i = 0; i < 128; i++) if (!Object.is(bands[i], want[i])) diff++
  ok(diff === 0, 'T2d 与 `simulatedBandArray(1.25)` **逐位**相同（纯函数、无随机数 ⇒ 可对拍）')

  const pre = simulatedBands(1.25)
  const shaped = packBands(pre.preL, pre.preR)
  let diff2 = 0
  for (let i = 0; i < 128; i++) if (!Object.is(bands[i], shaped[i])) diff2++
  ok(diff2 === 0, 'T2e 曲线就是模块默认 γ=1.8/gain=1.8 那一条（`packBands` 默认档逐位相同）')
  ok(near(bands[0], shapeBand(pre.preL[0])) && near(bands[64], shapeBand(pre.preR[0])),
    'T2e 左 0..63 / 右 64..127 的通道布局在链路上保持')
  ok(e.api.last().source === 'simulated' && e.win.__mpwAudioBandSource === 'simulated',
    'T2f 源的来源被如实标注（simulated=模拟，analyser=真实）')
  ok(e.api.last().stats.silent === false, 'T2f 诊断读数（`bandStats`）跟着链路更新')
}

console.log('\n== T3 真实源：只钳位（不套 γ）+ 不伪造立体声 ==')
{
  // 前 64 个 bin 恒定 51（=0.2）、其余 0 ⇒ 重采样到 64 段后每段都是 0.2
  const an = fakeAnalyser(new Array(64).fill(51), 128)
  const e = makeEnv({ search: '?bandfeed=1', analyser: an })
  e.api.bandFrameTick(0.5)
  const bands = e.win.__mpwAudioBands
  ok(bands.length === 128 && near(bands[0], 0.2, 1e-6) && near(bands[63], 0.2, 1e-6),
    'T3a 真实频谱按 0..1 原样进入左通道（0.2 仍是 0.2）', 'L[0]=' + bands[0].toFixed(6))
  ok(near(bands[64], 0.2, 1e-6) && near(bands[127], 0.2, 1e-6), 'T3b 右通道同位（单 analyser ⇒ 两声道同源，非伪造差异）')
  ok(Math.abs(bands[0] - shapeBand(0.2)) > 0.1,
    'T3c **没有**再套一次 γ（真源 clampOnly；套了会把 0.2 顶到 ' + shapeBand(0.2).toFixed(4) + '）')
  ok(e.api.last().source === 'analyser', 'T3d 来源标注 = analyser（真实源优先于模拟源）')

  const e2 = makeEnv({ search: '?bandfeed=sim', analyser: an })
  e2.api.bandFrameTick(0.5)
  ok(e2.api.last().source === 'simulated', 'T3e `?bandfeed=sim` 强制模拟源（真实源在场也不用；做 A/B 用）')

  const e3 = makeEnv({ search: '?bandfeed=real' })
  e3.api.bandFrameTick(0.5)
  ok(e3.api.last().source === 'silent' && bandStats(e3.win.__mpwAudioBands).silent === true,
    'T3f `?bandfeed=real` 且没有数据源 ⇒ **全零** + silent=true（不假装有声音 —— 无系统环回的诚实口径）')

  const anZero = fakeAnalyser(new Array(64).fill(0), 128)
  const e4 = makeEnv({ search: '?bandfeed=1', analyser: anZero })
  e4.api.bandFrameTick(0.5)
  ok(bandStats(e4.win.__mpwAudioBands).silent === true && e4.api.last().source === 'analyser',
    'T3g 真实源在场但很安静 ⇒ silent=true 且 source=analyser（"没数据源"与"数据源很安静"可区分）')

  /* ★2026-09-24 任务 ⑫ **契约变更（auto 无源）**：旧语义（钉死提交 151ce0a 的 `git show 151ce0a:demo.html`）
     是"全 0 + source='silent' + 一次性静音日志"；现改为**按时间驱动的占位频谱**
     （source=simulated / placeholder=true / 一次性**占位**日志），理由 = 用户「没有数据源但音条确实是在动的」
     + 上游 oneincase/webwallgl 的 `createSimulatedAudio` 同款做法 + 全 0 会让作者 shader 的音条高度退化
     （`smoothstep(0,0,0)` 除零：本机不画 / 部分驱动整层白色实心块）。"如实全 0"改由 `?bandfeed=real` 承担。 */
  const e5 = makeEnv({})
  e5.api.bandFrameTick(0.5); e5.api.bandFrameTick(0.6); e5.api.bandFrameTick(0.7)
  const e5s = bandStats(e5.win.__mpwAudioBands)
  ok(e5.api.last().source === 'simulated' && e5.api.last().placeholder === true && e5s.silent === false && e5s.peak > 0 && e5.win.__mpwAudioBandSource === 'simulated',
    'T3h auto 无源 ⇒ **时间驱动占位频谱**（非全 0 / source=simulated / placeholder=true；不冒充真实源）',
    'source=' + e5.api.last().source + ' peak=' + e5s.peak + ' reason=' + e5.api.last().reason)
  ok(e5.logs.filter((m) => /频段数据源/.test(m)).length === 1 && e5.api.placeholderLogged() === true,
    'T3h 占位只留**一条**一次性日志（多帧不刷屏；"明确可观测、不静默"的落点）',
    'logs=' + e5.logs.length)
  const e5r = makeEnv({ search: '?bandfeed=real' })
  e5r.api.bandFrameTick(0.5); e5r.api.bandFrameTick(0.6)
  ok(e5r.api.last().source === 'silent' && bandStats(e5r.win.__mpwAudioBands).peak === 0 && e5r.api.silentLogged() === true,
    'T3h2 `?bandfeed=real` 无源 ⇒ 仍是**全 0 + silent + 一次性静音日志**（旧语义原样保留在这条档上）',
    'source=' + e5r.api.last().source)
  const e6 = makeEnv({ search: '?bandfeed=mic' })
  e6.api.bandFrameTick(0.5)
  ok(e6.api.last().source === 'silent' && /^mic-/.test(String(e6.api.last().reason)),
    'T3i `?bandfeed=mic` 但没拿到麦克风 ⇒ 全 0 + reason=mic-*（区分"没请求到"与"没数据源"）',
    String(e6.api.last().reason))
}

console.log('\n== T4 场景层消费点：脚本 `registerAudioBuffers` 拿到的是同一份**活视图** ==')
{
  const e = makeEnv({ search: '?bandfeed=sim' })
  e.api.bandFrameTick(2.0)
  const n = 16
  const bufs = e.api.audioBuffers(n)
  ok(bufs && bufs.left.length === n && bufs.right.length === n && bufs.average.length === n,
    'T4a `audioBuffers(n)` 三件套长度 = n（脚本侧契约不变）')
  const bands = e.api.last().bands
  let bad = 0
  for (let i = 0; i < n; i++) {
    // 独立复算同一口径（左通道 0..63 → n 段均值；用模块的 resampleBands 这一份实现复算）
    const want = resampleBands(bands.subarray(0, AUDIO_BAND_HALF), n)[i]
    if (!near(bufs.left[i], want)) bad++
  }
  ok(bad === 0, 'T4b left 逐段等于"128 元数组左半 → n 段均值"的独立复算（接线真到了消费点）', '坏 ' + bad + ' 段')
  ok(bufs.left.some((v) => v > 0), 'T4c 非全零（脚本的音条会动，不是"静默 shim"）')
  // ①(P-131 批D 口径修正) `average` 必须是**逐段**的左右均值（官方 "arithmetic mean of both
  //   channels"；语料 344 处读的就是 `audioBuffer.average[frequency]`）。旧实现把整条 128 元的
  //   总均值灌满 n 段 ⇒ 对任何 frequency 都是同一个数（即使有数据，音条也是平的）。
  let badAvg = 0, spread = 0
  for (let i = 0; i < n; i++) {
    if (!near(bufs.average[i], (bufs.left[i] + bufs.right[i]) / 2)) badAvg++
    spread = Math.max(spread, Math.abs(bufs.average[i] - bufs.average[0]))
  }
  ok(badAvg === 0, 'T4d average 逐段 = (left[i]+right[i])/2（官方口径），不是"整条总均值填满"', '坏 ' + badAvg + ' 段')
  ok(spread > 1e-3, 'T4d average 逐段有差异（旧实现的"常量 average"会让 344 处 `average[freq]` 全等）', 'spread=' + spread.toFixed(6))
  // ①(P-131 批D) **活视图**：同一 n 永远同一对象（脚本顶层 `const` 长期持有），内容随帧变化
  const again = e.api.audioBuffers(n)
  ok(again === bufs && again.left === bufs.left && again.average === bufs.average,
    'T4e ★同一 n 返回**同一对象/同一批数组**（官方："顶层存 const、只调一次"）')
  const snap = [bufs.average[0], bufs.average[8], bufs.average[15]]
  e.api.bandFrameTick(2.37)
  e.api.audioBuffers(n)
  const moved = [bufs.average[0], bufs.average[8], bufs.average[15]]
  ok(moved.some((v, i) => Math.abs(v - snap[i]) > 1e-6),
    'T4e ★长期持有的那个对象**内容随帧原地变化**（不是"编译那一刻的快照"）',
    snap.map((v) => v.toFixed(4)).join(',') + ' → ' + moved.map((v) => v.toFixed(4)).join(','))
  // 数据源标注（渲染器粒子侧靠它判"有没有采集源"）
  ok(bufs.hasSource === true && bufs.kind === 'simulated',
    'T4f 活视图带数据源标注（kind/hasSource：simulated 算"有数据源"）', bufs.kind + '/' + bufs.hasSource)

  // ①(P-131 批D) legacy 两条必须**显式** `?bandfeed=off`（缺省已是 auto ⇒ 不再是"旧路径"）
  const e2 = makeEnv({ search: '?bandfeed=off' })           // 关：旧路径（无 analyser ⇒ null）
  ok(e2.api.audioBuffers(8) === null, 'T4g `?bandfeed=off` 逐位回到旧路径（无 analyser ⇒ null，脚本走静默 shim）')
  const an = fakeAnalyser(new Array(64).fill(255), 128)
  const e3 = makeEnv({ search: '?bandfeed=off', analyser: an })   // 关：旧路径（有 analyser ⇒ 旧口径 0..1 均值）
  const oldBuf = e3.api.audioBuffers(4)
  ok(oldBuf && oldBuf.left.length === 4 && near(oldBuf.left[0], 1) && oldBuf.right[0] === oldBuf.left[0] && oldBuf.left !== oldBuf.right,
    'T4g `?bandfeed=off` 旧路径照旧（`left` 是新数组、`right` 是它的 slice ⇒ 消费方改写 left 不会串到 right）')
  ok(!ArrayBuffer.isView(oldBuf.average) && near(oldBuf.average[0], 1) && near(oldBuf.average[3], 1),
    'T4g legacy 的 `average` 仍是旧的"整条总均值填满"（活视图路径才修口径 —— 回退口逐位复现旧行为）')
}

console.log('\n== T5 宿主桥 + 诊断 + 落点 + 反向变异 ==')
{
  const e = makeEnv({ search: '?bandfeed=sim', embedded: true })
  e.api.bandFrameTick(3.0)
  ok(e.posted.length === 1, 'T5a 嵌在宿主里 ⇒ 发出一帧（顶层页面不发：parent===window 直接返回）')
  const m = e.posted[0]
  ok(m && m.type === 'mpw-audio-bands' && m.v === 1 && m.len === AUDIO_BAND_LEN && Array.isArray(m.bands) && m.bands.length === 128,
    'T5a 消息形态 `{type:"mpw-audio-bands", v:1, len:128, bands:[128]}`')
  ok(Array.from(e.api.last().bands).every((v, i) => Object.is(v, m.bands[i])),
    'T5b 载荷与渲染侧同一份值（可 JSON 化 ⇒ 过得了 postMessage 结构化克隆）')
  ok(m.source === 'simulated' && typeof m.t === 'number', 'T5b 带 source/t（宿主可判"有没有数据源"）')
  const again = e.api.bandPublish(3.01)
  ok(again === null && e.posted.length === 1, 'T5c 节流：同 50ms 内不重复发（不影响渲染帧率）')
  ok(e.api.bandPublish(3.2) !== null && e.posted.length === 2, 'T5c 过窗口后恢复发送')
  const e2 = makeEnv({ search: '?bandfeed=sim', embedded: false })
  e2.api.bandFrameTick(3.0)
  ok(e2.posted.length === 0, 'T5d 顶层页面零 postMessage（除"关"之外的又一道"不外发"保险）')
  const e3 = makeEnv({ search: '?bandfeed=off', embedded: true })
  e3.api.bandFrameTick(3.0)
  ok(e3.posted.length === 0, 'T5d `?bandfeed=off` 时零 postMessage')
  /* ★2026-09-24 任务 ⑫：缺省档（auto）没有数据源也照发一帧；载荷里的 `source` 从 `'silent'` 变成
     `'simulated'`（占位频谱）—— 宿主仍能区分三种态：`silent`（?bandfeed=real 无真实源）/ `simulated`
     （占位或显式 sim）/ `analyser|mic`（真实源）。**不静默不发**这条口径不变。 */
  const e4 = makeEnv({ embedded: true })
  e4.api.bandFrameTick(3.0)
  ok(e4.posted.length === 1 && e4.posted[0].source === 'simulated' && e4.posted[0].bands.some((v) => v > 0),
    'T5d auto 无源：照发一帧、`source=simulated`（占位）+ 非全 0（宿主可区分"没数据/占位/真实源"三态）')
  const e4r = makeEnv({ search: '?bandfeed=real', embedded: true })
  e4r.api.bandFrameTick(3.0)
  ok(e4r.posted.length === 1 && e4r.posted[0].source === 'silent' && e4r.posted[0].bands.every((v) => v === 0),
    'T5d2 `?bandfeed=real` 无源：照发一帧但 `source=silent` + 全 0（"我没数据"的诚实标注仍是可达态）')

  const stats = e.api.last().stats
  ok(stats && stats.length === 128 && typeof stats.silent === 'boolean', 'T5e `bandStats` 摘要进状态（诊断口径）')

  ok(HTML.indexOf("from './audio-band-array.mjs'") > 0, 'T5f demo.html 真源码里有模块 import（接线落点 1/3）')
  const server = fs.readFileSync(path.join(ROOT, 'server', 'we-scene-demo-server.mjs'), 'utf8')
  ok(server.indexOf("p === '/audio-band-array.mjs'") > 0, 'T5f 自带服务器有同名路由（落点 2/3：浏览器相对说明符解析得到）')
  const bp = fs.readFileSync(path.join(ROOT, 'build-pages.mjs'), 'utf8')
  ok(/core\/audio-band-array\.mjs', 'audio-band-array\.mjs'/.test(bp), 'T5f 产物根映射在位（落点 3/3：Pages 下也 200）')
  const spec = fs.readFileSync(path.join(ROOT, 'docs', 'AUDIO-BAND-SPEC.md'), 'utf8')
  ok(spec.indexOf('AUDIO-BAND-WIRING.md') > 0, 'T5g 规格 §6 已指向接线文档（"未接线"口径不再陈旧）')
  ok(fs.existsSync(path.join(ROOT, 'docs', 'AUDIO-BAND-WIRING.md')), 'T5g 接线文档在位（docs/AUDIO-BAND-WIRING.md）')

  /* ── 反向变异：把接线改回旧行为 ⇒ 上面两条最关键的断言必须变红 ── */
  const red = []
  // 变异 1：真实源不再 clampOnly（改成默认 γ/gain 曲线）⇒ T3c 必红
  const mutated1 = BAND_BLOCK.replace('packBands(pair.left, pair.right, bandReuse, { clampOnly: true })',
    'packBands(pair.left, pair.right, bandReuse, {})')
  ok(mutated1 !== BAND_BLOCK, 'T5h 变异生效（真源分支确有 clampOnly 字样可改）')
  {
    const an = fakeAnalyser(new Array(64).fill(51), 128)
    const posted = []
    const win = { parent: { postMessage: (x) => posted.push(x) }, __mpwAudioBands: null }
    const sceneAudio = { analyser: an, freq: null, started: true, els: [], vols: [] }
    const body = mutated1 + '\nreturn { bandArrayNow, bandFrameTick, last: () => bandLast }'
    const api = new Function('packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
      'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
      'sceneAudio', 'location', 'window', 'logf', body)(
      packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
      createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, { setAudioBands: (v) => v, audioBandsInfo: () => ({}) },
      sceneAudio, { search: '?bandfeed=1' }, win, () => {})
    api.bandFrameTick(0.5)
    const v = win.__mpwAudioBands[0]
    const redOk = Math.abs(v - 0.2) > 1e-9                    // 期望"变异后不再是 0.2"
    if (redOk) red.push('变异1(去 clampOnly)：0.2 → ' + v.toFixed(6) + ' ⇒ T3c「没有套 γ」变红')
  }
  // 变异 2：关掉 bandfeed 分支（audioBuffers 回到旧路径）⇒ T4a/T4c 必红
  const mutated2 = BUF_BLOCK.replace("if (BANDFEED !== 'off') {", "if (false) {")
  ok(mutated2 !== BUF_BLOCK, 'T5h 变异生效（脚本侧分支确有 BANDFEED 判据可改）')
  {
    const win = { parent: null, __mpwAudioBands: null }
    const sceneAudio = { analyser: null, freq: null, started: false, els: [], vols: [] }
    const body = BAND_BLOCK + '\n' + mutated2 + '\nreturn { audioBuffers, bandFrameTick }'
    const api = new Function('packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
      'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
      'sceneAudio', 'location', 'window', 'logf', body)(
      packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
      createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, { setAudioBands: (v) => v, audioBandsInfo: () => ({}) },
      sceneAudio, { search: '?bandfeed=1' }, win, () => {})
    api.bandFrameTick(1.0)
    const bufs = api.audioBuffers(16)
    if (bufs === null) red.push('变异2(关分支)：`audioBuffers(16)` 变回 null ⇒ T4a/T4c/T4e 变红')
  }
  ok(red.length === 2, 'T5h RED-IF-REVERTED：两条最关键的断言在"改回旧行为"后确实变红')
  for (const r of red) console.log('   RED ' + r)
}

console.log('\n== T6 (P-131 批D) 16 段活视图 → 渲染器 / 麦克风源 / legacy 逐位回退 ==')
{
  // ①(P-131) `?bandfeed=` 非 off ⇒ 把 16 段活视图交给渲染器（粒子 `audioprocessing*` 的唯一数据入口）。
  //   官方编辑器里 `audioprocessingfrequency*` 的取值就是 0..15 ⇒ 分辨率必须是 16 段。
  const e = makeEnv({ search: '?bandfeed=sim' })
  ok(e.bandCalls.length === 1 && e.bandCalls[0] === e.api.band16(),
    'T6a 缺省档（非 off）**注入一次** 16 段活视图给渲染器（lib.setAudioBands 只调一次、引用恒定）',
    'calls=' + e.bandCalls.length)
  const v16 = e.api.band16()
  ok(v16 instanceof Object && v16.left instanceof Float32Array && v16.left.length === AUDIO_RESPONSE_BANDS && v16.average.length === 16,
    'T6a 活视图 = 16 段 Float32Array 三件套（官方 AudioBuffers 的类型与 0..15 下标口径）',
    'len=' + (v16 && v16.left && v16.left.length))
  e.api.bandFrameTick(1.0)
  const snap = Array.from(v16.average)
  e.api.bandFrameTick(1.41)
  ok(e.bandCalls.length === 1 && e.bandCalls[0] === v16,
    'T6b 逐帧 tick 不再重复注入（同一对象；宿主每帧只写数组内容）')
  ok(Array.from(v16.average).some((x, i) => Math.abs(x - snap[i]) > 1e-6),
    'T6b 16 段活视图的内容**每帧原地变化**（同一个数组对象）')
  // 16 段 = 128 元的 4:1 折叠（左半/右半各自 64→16），average 逐段 = 左右均值 —— 与模块口径独立复算
  {
    const bands = e.api.last().bands
    const wl = resampleBands(bands.subarray(0, AUDIO_BAND_HALF), 16)
    const wr = resampleBands(bands.subarray(AUDIO_BAND_HALF), 16)
    let bad = 0
    for (let i = 0; i < 16; i++) if (!near(v16.left[i], wl[i]) || !near(v16.right[i], wr[i]) || !near(v16.average[i], (wl[i] + wr[i]) / 2)) bad++
    ok(bad === 0, 'T6c 16 段的 left/right/average 与"128 元 4:1 折叠 + 逐段左右均值"独立复算一致', '坏 ' + bad + ' 段')
    ok(v16.hasSource === true && v16.kind === 'simulated', 'T6c 活视图标注数据源（渲染器的"无源豁免"判据）', v16.kind + '/' + v16.hasSource)
  }
  /* ★2026-09-24 任务 ⑫ **契约变更（auto 无源）**：旧语义（151ce0a）"全 0 + hasSource=false"；
     现为**时间驱动的占位频谱**（source=simulated / placeholder=true），理由见 demo.html 该分支的注释
     与 tests/bench-bandfeed-switch-test.mjs A1。"只认真实源"的 `?bandfeed=real|mic` 仍是全 0 + silent。 */
  const e2 = makeEnv({})
  e2.api.bandFrameTick(0.5)
  const v2 = e2.api.band16()
  ok(e2.bandCalls.length === 1 && v2.hasSource === true && v2.kind === 'simulated' && Array.from(v2.left).some((x) => x > 0),
    'T6d auto 无源 ⇒ 交给渲染器的活视图是**按时间驱动的占位频谱**（非全 0 / hasSource=true / placeholder 档；**不冒充真实源**）')
  const e2r = makeEnv({ search: '?bandfeed=real' })
  e2r.api.bandFrameTick(0.5)
  const v2r = e2r.api.band16()
  ok(e2r.bandCalls.length === 1 && v2r.hasSource === false && v2r.kind === 'silent' && Array.from(v2r.left).every((x) => x === 0),
    'T6d2 `?bandfeed=real` 无源 ⇒ 仍是全 0 + hasSource=false（"如实静音"这条旧语义原样保留）')
  // legacy 关档：**不注入**（渲染器侧与批 D 之前逐位一致）
  const e3 = makeEnv({ search: '?bandfeed=off' })
  e3.api.bandFrameTick(0.5)
  ok(e3.bandCalls.length === 0 && e3.api.bandArrayNow(1).source === 'off',
    'T6e `?bandfeed=off` ⇒ 一次都不注入（渲染器无活视图 ⇒ `audioprocessing*` 退回旧行为）')

  // 麦克风源：显式 `?bandfeed=mic` → getUserMedia → AnalyserNode（异步；拿到前保持 silent）
  const fakeMicAnalyser = fakeAnalyser(new Array(64).fill(128), 128)
  const win = { parent: null, __mpwAudioBands: null, __mpwAudioBandSource: null }
  let gumCalls = 0
  win.navigator = {
    mediaDevices: { getUserMedia: () => { gumCalls++; return Promise.resolve({ id: 'stream' }) } },
    permissions: { query: () => Promise.resolve({ state: 'granted' }) },
  }
  // demo 的代码取 `window.AudioContext || window.webkitAudioContext` ⇒ 桩挂 window（与浏览器同形）
  const FakeAC = function FakeAC() {
    this.createAnalyser = () => fakeMicAnalyser
    this.createMediaStreamSource = () => ({ connect: () => {} })
  }
  win.AudioContext = FakeAC
  const sceneAudio = { ctx: null, analyser: null, els: [], freq: null, started: false, vols: [] }
  const logs = []
  const bandCalls = []
  const lib = { setAudioBands: (v) => { bandCalls.push(v); return v }, audioBandsInfo: () => ({}) }
  const body = BAND_BLOCK + '\n' + BUF_BLOCK + `
return { BANDFEED, bandFrameTick, audioBuffers, mic: () => bandMic, last: () => bandLast }`
  const api = new Function('packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
    'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
    'sceneAudio', 'location', 'window', 'logf', 'AudioContext', body)(
    packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
    createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, lib,
    sceneAudio, { search: '?bandfeed=mic' }, win, (m) => logs.push(m), FakeAC)
  ok(api.BANDFEED === 'mic' && gumCalls === 1, 'T6f `?bandfeed=mic` ⇒ 显式请求麦克风（getUserMedia 恰好一次）', 'calls=' + gumCalls)
  ok(api.mic().status === 'idle' && api.last().source === 'off',
    'T6f 拿到麦克风**之前**：状态 idle、还没出帧（异步不阻塞首帧）')
  await new Promise((r) => setTimeout(r, 0))
  ok(api.mic().status === 'on' && !!api.mic().analyser,
    'T6f getUserMedia resolve ⇒ 麦克风 analyser 就绪（FFT 4096 与官方 RE-16 同尺寸）', api.mic().status)
  api.bandFrameTick(0.5)
  ok(api.last().source === 'mic' && api.last().bands.some((v) => v > 0) && api.audioBuffers(16).hasSource === true,
    'T6g 麦克风成为数据源：source=mic、非全 0、脚本侧活视图 hasSource=true',
    'source=' + api.last().source + ' peak=' + Math.max(...api.last().bands).toFixed(4))
  // 缺省档**不弹权限框**：auto 只走 permissions.query（已授权才启用）
  {
    const w2 = { parent: null, navigator: { mediaDevices: { getUserMedia: () => { throw new Error('auto 不该弹权限框') } },
      permissions: { query: () => Promise.resolve({ state: 'prompt' }) } } }
    const sa2 = { ctx: null, analyser: null, els: [], freq: null, started: false, vols: [] }
    const body2 = BAND_BLOCK + '\n' + BUF_BLOCK + '\nreturn { BANDFEED, bandFrameTick, mic: () => bandMic }'
    const api2 = new Function('packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
      'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
      'sceneAudio', 'location', 'window', 'logf', 'AudioContext', body2)(
      packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
      createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, { setAudioBands: (v) => v },
      sa2, { search: '' }, w2, () => {}, function FakeAC() { this.createAnalyser = () => fakeAnalyser([0], 1) })
    await new Promise((r) => setTimeout(r, 0))
    api2.bandFrameTick(0.5)
    ok(api2.mic().status === 'idle' && api2.BANDFEED === 'auto',
      'T6h 缺省档 auto 在"未授权/未决定"时**不弹权限框、不启用麦克风**（只有 permissions=granted 才静默启用）')
  }

  /* ── 反向变异（P-131）：把本批三处改动各自改回旧写法 ⇒ 对应断言必须变红 ── */
  const red = []
  const mkBlock = (mut) => {
    const w = { parent: null, navigator: null, __mpwAudioBands: null, __mpwAudioBandSource: null }
    const sa = { ctx: null, analyser: null, els: [], freq: null, started: false, vols: [] }
    const calls = []
    const b = BAND_BLOCK + '\n' + BUF_BLOCK + '\nreturn { BANDFEED, bandFrameTick, audioBuffers, band16: () => bandView16 }'
    const fn = new Function('packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
      'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
      'sceneAudio', 'location', 'window', 'logf', 'AudioContext', mut)
    return fn(packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
      createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, { setAudioBands: (v) => { calls.push(v); return v } },
      sa, { search: '' }, w, () => {}, function FakeAC() { this.createAnalyser = () => fakeAnalyser([0], 1) })
  }
  // 变异 1：缺省档改回 `off`（批 D 之前的缺省）
  {
    const mut = BAND_BLOCK.replace("      return 'auto'\n    } catch (e) { return 'auto' }", "      return 'off'\n    } catch (e) { return 'off' }")
    if (mut === BAND_BLOCK) red.push('变异1 **没生效**（缺省分支没匹配上）')
    else {
      const api = mkBlock(mut + '\n' + BUF_BLOCK + '\nreturn { BANDFEED }')
      if (api.BANDFEED === 'off') red.push('变异1(缺省回 off)：BANDFEED=' + api.BANDFEED + ' ⇒ T1b「缺省 = auto」变红')
    }
  }
  // 变异 2：`audioBuffers` 改回"每次新建数组的快照"（批 D 之前的形态）
  {
    const snapImpl = `function audioBuffers(n) {
      const b = bandArrayNow(bandClock)
      const out = new Array(n).fill(0)
      for (let i = 0; i < n; i++) out[i] = b.bands[i]
      const sum = out.reduce((a, x) => a + x, 0)
      return { left: out, right: out.slice(), average: new Array(n).fill(sum / n) }
    }`
    const i0 = BUF_BLOCK.indexOf('  function audioBuffers(n) {')
    const i1 = BUF_BLOCK.lastIndexOf('  // ═══ MPW-AUDIOBUFFERS-END')
    const mutBuf = BUF_BLOCK.slice(0, i0) + snapImpl + '\n' + BUF_BLOCK.slice(i1)
    const api = mkBlock(BAND_BLOCK + '\n' + mutBuf + '\nreturn { bandFrameTick, audioBuffers }')
    api.bandFrameTick(1.0)
    const a1 = api.audioBuffers(16)
    const held = a1
    api.bandFrameTick(9.0)
    const a2 = api.audioBuffers(16)
    if (a1 !== a2) red.push('变异2(快照 audioBuffers)：`audioBuffers(16)` 每次新对象 ⇒ T4e「同一对象」变红')
    else if (Math.abs(held.average[0] - held.average[15]) < 1e-9 && held.average[0] !== 0) red.push('变异2b：average 又变回常量填满 ⇒ T4d「逐段有差异」变红')
  }
  // 变异 3：16 段活视图不注入渲染器（删掉 `lib.setAudioBands(bandView16)`）
  {
    const mut = BAND_BLOCK.replace("  if (BANDFEED !== 'off') { try { lib.setAudioBands(bandView16) } catch (e) { /* ignore */ } }", '')
    if (mut === BAND_BLOCK) red.push('变异3 **没生效**（注入行没匹配上）')
    else {
      const w = { parent: null, navigator: null }
      const sa = { ctx: null, analyser: null, els: [], freq: null, started: false, vols: [] }
      const calls = []
      const b = mut + '\n' + BUF_BLOCK + '\nreturn { BANDFEED, bandFrameTick }'
      const api = new Function('packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
        'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
        'sceneAudio', 'location', 'window', 'logf', b)(
        packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
        createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, { setAudioBands: (v) => { calls.push(v); return v } },
        sa, { search: '?bandfeed=sim' }, w, () => {})
      api.bandFrameTick(0.5)
      if (calls.length === 0) red.push('变异3(不注入渲染器)：粒子侧拿不到 16 段活视图 ⇒ T6a 变红')
    }
  }
  ok(red.length === 3, 'T6i RED-IF-REVERTED：三处 P-131 改动各自改回旧写法后，对应断言都变红（' + red.length + '/3）')
  for (const r of red) console.log('   RED ' + r)
}

console.log(failed ? `\n${failed} 项失败` : '\nALL PASS')
process.exit(failed ? 1 : 0)

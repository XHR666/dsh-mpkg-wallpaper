// audio-band-array-test.mjs — P-103 音频频段数组契约（128 元）验收
//
// 规格：docs/AUDIO-BAND-SPEC.md（先写规格、再按规格实现；差异清单见规格 §5）
// 参照：oneincase/webwallgl（MIT © oneincase，commit b61e8910ae0a176288aed99ce9a93a13ea07df57）
//       的 `renderer/src/web.ts` —— 只对齐**行为契约**（左右各 64 段 / 0..1 钳位 / γ 对比扩展曲线），
//       未复制代码（台账 docs/COPYING-RULES.md §4 #10）
//
// 断言四组：
//   T1 长度契约：恒 128 元、左 0..63 / 右 64..127、短输入补 0、长输入截断、复用缓冲只认正确长度
//   T2 钳位与曲线：越界/NaN 输入被钳到 0..1；γ+增益曲线单调不减、端点 0→0 / 1→1；clampOnly 只钳位
//   T3 模拟源：确定性（同 t 同 seed 逐位相同）、有节拍（低频随拍起伏）、通道不复制、无 NaN
//   T4 统计与文档：bandStats 口径（全零 = silent / 峰值位置）+ 规格文档与台账在位
//
// 运行：node tests/audio-band-array-test.mjs   （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUDIO_BAND_HALF, AUDIO_BAND_LEN, AUDIO_BAND_GAMMA, AUDIO_BAND_GAIN,
  shapeBand, packBands, simulatedBands, simulatedBandArray, bandStats,
} from '../core/audio-band-array.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps

/* ══════════════ T1 长度契约 ══════════════ */
console.log('\n== T1 packBands：长度契约与通道布局 ==')
{
  ok(AUDIO_BAND_HALF === 64 && AUDIO_BAND_LEN === 128, 'T1a 契约长度 64 + 64 = 128')

  const left = Array.from({ length: 64 }, (_, i) => (i + 1) / 64)
  const right = Array.from({ length: 64 }, (_, i) => 1 - i / 64)
  const out = packBands(left, right)
  ok(out.length === AUDIO_BAND_LEN, 'T1b 输出恒 128 元')
  ok(out instanceof Float32Array, 'T1b 输出是 Float32Array（可直接喂给 GPU/WebAudio）')
  ok(out[0] > 0 && out[63] > out[0], 'T1c 左通道占 0..63（递增夹具：末段 > 首段）')
  ok(out[64] > out[127], 'T1c 右通道占 64..127（递减夹具：首段 > 末段）')

  const short = packBands([0.5], [0.25])
  ok(short.length === 128 && near(short[0], shapeBand(0.5)) && near(short[1], 0) && near(short[64], shapeBand(0.25)),
    'T1d 短输入：给了的按曲线走，余下补 0（契约长度不随输入变）')
  const long = packBands(new Array(200).fill(1), new Array(200).fill(1))
  ok(long.length === 128 && near(long[63], 1) && near(long[127], 1), 'T1d 长输入：只取前 64 段')

  const buf = new Float32Array(128)
  const reused = packBands([1], [1], buf)
  ok(reused === buf, 'T1e 传入正确长度的缓冲 → 复用（零分配路径）')
  const ignored = packBands([1], [1], new Float32Array(10))
  ok(ignored !== null && ignored.length === 128, 'T1e 缓冲长度不对 → 忽略并新建（不给半截数组）')
  ok(packBands(null, null).length === 128 && near(packBands(null, null)[0], 0), 'T1e 空输入 → 全零 128 元（不抛错）')
}

/* ══════════════ T2 钳位与曲线 ══════════════ */
console.log('\n== T2 钳位与对比扩展曲线 ==')
{
  const o = packBands([2, -1, NaN, 0.5], [2, -1, NaN, 0.5])
  ok(o[0] === 1, 'T2a 越界 >1 → 钳到 1')
  ok(o[1] === 0, 'T2a 越界 <0 → 钳到 0')
  ok(o[2] === 0, 'T2a NaN → 0（不把 NaN 传进下游）')
  ok(Number.isFinite(o[3]) && o[3] > 0 && o[3] <= 1, 'T2a 正常值在 (0,1] 内')

  ok(near(shapeBand(0), 0), 'T2b 曲线端点 0 → 0')
  ok(near(shapeBand(1), 1), 'T2b 曲线端点 1 → 1（增益与 γ 配对，峰值顶到 1 而不是溢出）')
  let mono = true, prev = -1
  for (let i = 0; i <= 100; i++) { const v = shapeBand(i / 100); if (v < prev - 1e-9) mono = false; prev = v }
  ok(mono, 'T2b 曲线单调不减（100 点扫描）')
  ok(shapeBand(0.2) < 0.2 && shapeBand(0.9) > 0.9, 'T2b 曲线是"对比扩展"：小值被压深、大值被抬高（γ=' + AUDIO_BAND_GAMMA + ' gain=' + AUDIO_BAND_GAIN + '）')
  ok(shapeBand(-5) === 0 && shapeBand(5) === 1, 'T2b 曲线入口也做钳位（外部脏值不进 pow）')

  const raw = packBands([0.2, 0.9], [0, 1], null, { clampOnly: true })
  ok(near(raw[0], 0.2) && near(raw[1], 0.9), 'T2c clampOnly：真实归一化频谱只钳位（再套 γ 会把音条整体顶满）')
  const custom = packBands([0.5], [0.5], null, { gamma: 1, gain: 1 })
  ok(near(custom[0], 0.5), 'T2c 可传自定义 γ/增益（恒等曲线可复现）')
}

/* ══════════════ T3 确定性模拟源 ══════════════ */
console.log('\n== T3 simulatedBands：确定性 / 节拍 / 通道差异 ==')
{
  const a = simulatedBands(1.25, { seed: 7 })
  const b = simulatedBands(1.25, { seed: 7 })
  let same = true
  for (let i = 0; i < AUDIO_BAND_HALF; i++) if (a.preL[i] !== b.preL[i] || a.preR[i] !== b.preR[i]) same = false
  ok(same, 'T3a 同 (t, seed) → 逐位相同（无随机数；测试可对拍、真机不抖成噪点）')
  const c = simulatedBands(1.25, { seed: 8 })
  ok(c.preL.some((v, i) => v !== a.preL[i]), 'T3a 不同 seed → 不同序列')

  let inRange = true, anyDiff = false
  for (let i = 0; i < AUDIO_BAND_HALF; i++) {
    const l = a.preL[i], r = a.preR[i]
    if (!(l >= 0 && l <= 1) || !(r >= 0 && r <= 1)) inRange = false
    if (Math.abs(l - r) > 1e-9) anyDiff = true
  }
  ok(inRange, 'T3b pre* 恒在 0..1（下游无需再防）')
  ok(anyDiff, 'T3b 左右通道不互为复制（相位差）')

  // 节拍：低频段（band0）在 1 秒内的峰值显著高于其最小值（每拍一个尖峰）
  const lowVals = []
  for (let t = 0; t < 1; t += 1 / 60) lowVals.push(simulatedBands(t, { seed: 1 }).preL[0])
  const lo = Math.min(...lowVals), hi = Math.max(...lowVals)
  ok(hi - lo > 0.25, 'T3c 低频段随节拍起伏（峰谷差 ' + (hi - lo).toFixed(3) + ' > 0.25）')
  // 频谱倾斜：低频能量高于高频
  const lowMean = a.preL.slice(0, 8).reduce((s, v) => s + v, 0) / 8
  const highMean = a.preL.slice(56, 64).reduce((s, v) => s + v, 0) / 8
  ok(lowMean > highMean, 'T3c 低频均值 > 高频均值（像真实音乐，不是白噪声）')
  ok(a.left.length === AUDIO_BAND_HALF && a.right.length === AUDIO_BAND_HALF, 'T3c left/right 各 64 段（已整形）')

  const arr = simulatedBandArray(2.5, { seed: 3 })
  ok(arr.length === AUDIO_BAND_LEN && arr.every((v) => Number.isFinite(v)), 'T3d simulatedBandArray 直接给 128 元且无 NaN')
  ok(simulatedBands(NaN).preL.every((v) => Number.isFinite(v)), 'T3d t=NaN → 按 0 处理（不产生 NaN 频谱）')
}

/* ══════════════ T4 统计与登记 ══════════════ */
console.log('\n== T4 bandStats / 规格与台账登记 ==')
{
  const s0 = bandStats(new Float32Array(128))
  ok(s0.length === 128 && s0.silent === true && s0.peak === 0 && s0.nonzero === 0, 'T4a 全零 → silent=true（诊断一眼看出"没有数据"）')
  const arr = new Float32Array(128); arr[5] = 0.8; arr[70] = 0.4
  const s1 = bandStats(arr)
  ok(near(s1.peak, 0.8) && s1.peakAt === 5 && s1.nonzero === 2, 'T4a 峰值/位置/非零计数正确')
  ok(near(s1.mean, 1.2 / 128), 'T4a 均值按契约长度（128）归一')
  ok(bandStats(null).silent === true && bandStats(null).length === 0, 'T4a 非数组输入不抛错')

  const spec = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'AUDIO-BAND-SPEC.md'), 'utf8') } catch { return '' } })()
  ok(spec.length > 1500 && spec.indexOf('packBands') >= 0 && spec.indexOf('128') >= 0, 'T4b 规格文档在位（先写规格、再实现）')
  const tp = (() => { try { return fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8') } catch { return '' } })()
  ok(tp.indexOf('audio-band-array') >= 0, 'T4b THIRD-PARTY.md 已登记本模块（署名 + 台账指针）')
  const ledger = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'COPYING-RULES.md'), 'utf8') } catch { return '' } })()
  ok(ledger.indexOf('audio-band-array') >= 0, 'T4b docs/COPYING-RULES.md §4 台账含本模块条目')
}

console.log(failed ? `\n${failed} 项失败` : '\nALL PASS')
process.exit(failed ? 1 : 0)

// effects-corpus.mjs —— CPU 效果链洁净室验收用的**确定性语料**（纯数据，无断言、无 bundle 依赖）
//
// 为什么单独一个文件：`clean-room-effects-blend-test.mjs` 的冻结真值（digest / 抽样值）是在
// **重写前**的实现上跑同一份语料得到的。语料构造放这里，保证"生成真值"与"验收"用的是
// **逐位相同**的输入（同一份代码，不存在两处漂移）。
//
// 语料全部**自造**（合成贴图 + 参数组合），不含任何真机壁纸数据、不读任何第三方/专有资产。

/** 确定性 PRNG（mulberry32）：同 seed 恒同序列，跨平台稳定。 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 合成贴图：RGBA 或 RG88（RG88 的存储形状 = 我们的解包口径：byte0=G、byte3=R，见规格 §2.4）。 */
export function makeTexture(w, h, seed, { rg88 = false, mips = 0 } = {}) {
  const rnd = mulberry32(seed)
  const fill = (ww, hh) => {
    const rgba = new Uint8Array(ww * hh * 4)
    for (let i = 0; i < ww * hh; i++) {
      const g = Math.floor(rnd() * 256)
      const r = Math.floor(rnd() * 256)
      if (rg88) { rgba[i * 4] = g; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0; rgba[i * 4 + 3] = r }
      else { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = Math.floor(rnd() * 256); rgba[i * 4 + 3] = Math.floor(rnd() * 256) }
    }
    return { width: ww, height: hh, rgba, rg88 }
  }
  const tex = fill(w, h)
  if (mips > 0) {
    const chain = [{ width: w, height: h, rgba: tex.rgba }]
    let cw = Math.max(1, w >> 1), ch = Math.max(1, h >> 1)
    for (let i = 0; i < mips; i++) { chain.push(fill(cw, ch)); cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1) }
    tex.mips = chain
  }
  return tex
}

/** 贴图集（含缺项：调用方按"没有该贴图"走兜底路径）。 */
export function makeTextures() {
  return new Map([
    ['flow_rgba', makeTexture(16, 16, 0x1111)],
    ['flow_rg88', makeTexture(8, 8, 0x2222, { rg88: true })],
    ['mask', makeTexture(12, 9, 0x3333)],
    ['mask_rg88', makeTexture(6, 6, 0x4444, { rg88: true })],
    ['phase', makeTexture(10, 4, 0x5555)],
    ['noise', makeTexture(16, 16, 0x6666, { mips: 3 })],
    ['noise_nomip', makeTexture(7, 7, 0x7777)],
  ])
}

// ───────────────────────────── ① 混合模式语料 ─────────────────────────────

/** 单通道/整色混合的 (A,B,opacity) 输入组：随机 12 组 + 边界与非有限 15 组。 */
export function blendCases() {
  const rnd = mulberry32(0xc0ffee)
  const cases = []
  for (let i = 0; i < 12; i++) {
    cases.push({ A: [rnd(), rnd(), rnd()], B: [rnd(), rnd(), rnd()], opacity: rnd() })
  }
  const BOUND = [
    { A: [0, 0, 0], B: [0, 0, 0], opacity: 0 },
    { A: [1, 1, 1], B: [1, 1, 1], opacity: 1 },
    { A: [0.5, 0.5, 0.5], B: [0.5, 0.5, 0.5], opacity: 0.5 },
    { A: [0, 1, 0.5], B: [1, 0, 0.5], opacity: 0 },
    { A: [1, 0, 0.5], B: [0, 1, 0.5], opacity: 1 },
    { A: [1.5, -0.25, 0.75], B: [0.25, 1.25, -0.5], opacity: 0.3 },
    { A: [0.25, 0.5, 0.75], B: [0.75, 0.5, 0.25], opacity: 0.7 },   // 分量并列（HSL 取首分支）
    { A: [0.5, 0.5, 0.5], B: [0.5, 0.5, 0.5], opacity: 0 },         // 全并列 + op=0
    { A: [0.2, 0.2, 0.2], B: [0.7, 0.3, 0.1], opacity: 0.4 },       // delta == 0（灰）
    { A: [0, 0.5, 1], B: [0, 0.5, 1], opacity: 0.5 },
    { A: [5e-324, 1e-300, 0.9999999999999999], B: [1, 1 - Number.EPSILON, 0], opacity: 1e-10 },
    { A: [0.1, 0.2, 0.3], B: [0, 1, 0.5], opacity: 0.9999999999999999 },
    { A: [NaN, 1, 0], B: [Infinity, -Infinity, 0.5], opacity: 0.5 },
    { A: [0.4, 0.6, 0.8], B: [0.2, 0.4, 0.6], opacity: NaN },
    { A: [0.4, 0.6, 0.8], B: [0.2, 0.4, 0.6], opacity: Infinity },
  ]
  return cases.concat(BOUND)
}

/** 模式 id 全谱：0..33（含未定义 id 的缺省行）。 */
export const BLEND_MODES = Array.from({ length: 34 }, (_, i) => i)

// ───────────────────────── ② 颜色类效果（tint/pulse/key）语料 ─────────────────────────

const INITIAL_PIXELS = [
  [12.5, 200, 77.25, 180],
  [0, 0, 0, 0],
  [255, 255, 255, 255],
  [300, -20, 128, 0.5],
]

/** 每个场景 = 一条效果栈 + 采样上下文；`freshT(i)` 给出该场景第 i 组初值。 */
export function colorScenarios() {
  const S = []
  const push = (name, items) => S.push({ name, items })
  const tint = (o = {}) => Object.assign({ type: 'tint', alpha: 0.65, masked: false, mask: '', blendMode: 2, color: [0.9, 0.15, 0.4] }, o)
  const pulse = (o = {}) => Object.assign({ type: 'pulse', masked: false, mask: '', bounds: [0.2, 0.9], speed: 1.3, phase: 0.7, amount: 0.8, noiseAmount: 0, noise: '', noiseSpeed: 0.5, power: 1, pulseColor: true, tintLow: [1, 0.8, 0.6], tintHigh: [0.2, 0.9, 1], blendMode: 9, pulseAlpha: false }, o)
  const key = (o = {}) => Object.assign({ type: 'key', key: [0.2, 0.4, 0.6], tol: 0.1, fuzz: 0.35, invert: false, keyAlpha: 0.25, flatten: false }, o)

  push('tint/无蒙版/mode2', [tint()])
  push('tint/蒙版/mode0', [tint({ masked: true, mask: 'mask', blendMode: 0, alpha: 0.4 })])
  push('tint/蒙版缺贴图/mode30', [tint({ masked: true, mask: 'nope', blendMode: 30 })])
  push('tint/蒙版rg88/mode32', [tint({ masked: true, mask: 'mask_rg88', blendMode: 32 })])
  push('tint/mode11/alpha0', [tint({ blendMode: 11, alpha: 0 })])
  push('pulse/纯时间', [pulse()])
  push('pulse/噪声', [pulse({ noiseAmount: 0.6, noise: 'noise', noiseSpeed: 0.25 })])
  push('pulse/噪声缺贴图', [pulse({ noiseAmount: 0.6, noise: 'nope', noiseSpeed: 0.25 })])
  push('pulse/masked+蒙版', [pulse({ masked: true, mask: 'mask', pulseAlpha: true, power: 2.5 })])
  push('pulse/masked+缺贴图', [pulse({ masked: true, mask: 'nope', pulseAlpha: true })])
  push('pulse/无pulseColor+alpha', [pulse({ pulseColor: false, pulseAlpha: true })])
  push('pulse/bounds退化', [pulse({ bounds: [0.5, 0.5], amount: 1 })])
  push('pulse/mode31', [pulse({ blendMode: 31 })])
  push('key/基本', [key()])
  push('key/invert+flatten', [key({ invert: true, flatten: true, keyAlpha: 0.7 })])
  push('key/大fuzz', [key({ fuzz: 1.5, tol: 0.4, keyAlpha: 1 })])
  push('key/fuzz0/tol0', [key({ fuzz: 0, tol: 0, flatten: true })])
  push('栈：tint→key', [tint({ masked: true, mask: 'mask' }), key({ flatten: true })])
  push('栈：key→tint', [key(), tint({ blendMode: 22 })])
  push('栈：pulse(masked)→key', [pulse({ masked: true, mask: 'mask', pulseAlpha: true }), key({ invert: true })])
  push('栈：key→pulse(pulseAlpha)', [key({ keyAlpha: 0 }), pulse({ pulseAlpha: true, blendMode: 5 })])
  push('栈：未知类型夹在中间', [tint(), { type: 'unknown', x: 1 }, key()])
  push('栈：空', [])
  return S
}

/** 场景 × 初值的展开（每个组合一份全新数组，便于检查"原地改写"行为）。 */
export function colorRuns() {
  const runs = []
  const times = [0, 1.7, -3.25]
  const uvs = [[0.5, 0.5], [0.13, 0.87], [1.2, -0.3]]
  let n = 0
  for (const s of colorScenarios()) {
    for (let k = 0; k < INITIAL_PIXELS.length; k++) {
      const time = times[n % times.length]
      const [u0, v0] = uvs[n % uvs.length]
      runs.push({ name: `${s.name}#${k}`, items: s.items, t: INITIAL_PIXELS[k].slice(), time, u0, v0 })
      n++
    }
  }
  return runs
}

// ───────────────────────── ③ 位移 / shake 蒙版 / waterflow 语料 ─────────────────────────

const scroll = (o = {}) => Object.assign({ type: 'scroll', sx: 0.25, sy: -0.4, rx: 2, ry: 3 }, o)
const shake = (o = {}) => Object.assign({ type: 'shake', phase: 'phase', flow: 'flow_rgba', speed: 1.1, fx: 1.7, fy: 0.6, bounds: [0.1, 0.9], direction: 0, amp: 0.35, masked: false, mask: '' }, o)
const waves = (o = {}) => Object.assign({ type: 'waves', mask: 'mask', direction: 0.9, speed: 0.7, scale: 8, perspective: 0.3, strength: 0.05 }, o)
const sway = (o = {}) => Object.assign({ type: 'sway', noise: 'noise', noiseScale: 0.6, ratio: 0.8, direction: 1.2, strength: 0.5, masked: false, mask: '', phase: 2.1, speed: 1.4, power: 1.3 }, o)
const flow = (o = {}) => Object.assign({ type: 'flow', phase: 'phase', phaseScale: 1.5, flow: 'flow_rgba', speed: 0.6, strength: 0.45 }, o)

export const DISPLACE_SCENARIOS = [
  { name: 'scroll/基本', items: [scroll()] },
  { name: 'scroll/零与负', items: [scroll({ sx: 0, sy: -0.75, rx: 1, ry: 0.5 })] },
  { name: 'shake/基本(rgba流图)', items: [shake()] },
  { name: 'shake/rg88流图+direction2', items: [shake({ flow: 'flow_rg88', direction: 2, fx: 0.4, fy: 2.2 })] },
  { name: 'shake/direction1+相位缺贴图', items: [shake({ direction: 1, phase: 'nope' })] },
  { name: 'waves/基本', items: [waves()] },
  { name: 'waves/蒙版缺贴图', items: [waves({ mask: 'nope', perspective: -0.4, strength: -0.08 })] },
  { name: 'waves/负方向', items: [waves({ direction: -2.4, scale: 0.5 })] },
  { name: 'sway/带mip噪声', items: [sway()] },
  { name: 'sway/无mip+蒙版', items: [sway({ noise: 'noise_nomip', masked: true, mask: 'mask_rg88', noiseScale: 2.5 })] },
  { name: 'sway/蒙版缺贴图+noiseScale>1', items: [sway({ masked: true, mask: 'nope', noiseScale: 1.8, power: 0.7 })] },
  { name: '组合：scroll→shake→waves→sway', items: [scroll(), shake(), waves(), sway()] },
  { name: '组合：未知类型夹在中间', items: [shake(), { type: 'unknown' }, sway({ masked: true, mask: 'mask' })] },
  { name: '空', items: [] },
]

export const SHAKE_MASK_SCENARIOS = [
  { name: '单 shake/masked/蒙版', items: [shake({ masked: true, mask: 'mask' })] },
  { name: '单 shake/masked/蒙版rg88', items: [shake({ masked: true, mask: 'mask_rg88', direction: 2 })] },
  { name: '单 shake/masked/缺蒙版', items: [shake({ masked: true, mask: 'nope' })] },
  { name: 'shake/masked + 其它位移', items: [scroll(), shake({ masked: true, mask: 'mask' }), waves()] },
  { name: '两条 shake（都 masked）', items: [shake({ masked: true, mask: 'mask', speed: 0.3 }), shake({ masked: true, mask: 'mask_rg88', direction: 1, amp: -0.2 })] },
  { name: '无 masked shake（应原样返回）', items: [shake({ masked: false }), waves()] },
]

export const FLOW_SCENARIOS = [
  { name: 'flow/基本', items: [flow()] },
  { name: 'flow/rg88流图', items: [flow({ flow: 'flow_rg88', speed: 1.9, strength: 0.8 })] },
  { name: 'flow/相位缺贴图', items: [flow({ phase: 'nope' })] },
  { name: 'flow/流图缺贴图', items: [flow({ flow: 'nope' })] },
  { name: 'flow/负strength+大speed', items: [flow({ strength: -0.6, speed: 12.25, phaseScale: 0.25 })] },
  { name: 'flow/多条', items: [flow(), flow({ speed: 0.125, strength: 0.2 })] },
  { name: 'flow/无 flow 项（应原样返回）', items: [scroll(), waves()] },
]

/** 位移/水波流场景 × 采样上下文。 */
export function displaceRuns() {
  const runs = []
  // 内点为主（避免 uv 落在贴图边界被夹取成"四个 tap 同色"的退化情形），保留一组越界 uv 覆盖夹取路径
  const uvs = [[0.5, 0.5], [0.37, 0.62], [0.06, 0.94], [1.4, -0.4]]
  const times = [0, 0.75, 3.5, -1.25]
  const pix = [10, 20, 30, 40]
  DISPLACE_SCENARIOS.forEach((s, i) => runs.push({ name: s.name, items: s.items, texW: 32, texH: 18, u0: uvs[i % uvs.length][0], v0: uvs[i % uvs.length][1], time: times[i % times.length] }))
  SHAKE_MASK_SCENARIOS.forEach((s, i) => runs.push({ name: s.name, items: s.items, texW: 32, texH: 18, u0: uvs[(i + 1) % uvs.length][0], v0: uvs[(i + 1) % uvs.length][1], time: times[(i + 2) % times.length], t: pix.slice() }))
  FLOW_SCENARIOS.forEach((s, i) => runs.push({ name: s.name, items: s.items, texW: 32, texH: 18, u0: uvs[(i + 2) % uvs.length][0], v0: uvs[(i + 2) % uvs.length][1], time: times[(i + 1) % times.length], t: pix.slice() }))
  return runs
}

// ───────────────────────── ④ 冻结真值用的 digest ─────────────────────────

/** FNV-1a 64（BigInt 实现，避免 32 位碰撞）：对每个数的 **IEEE-754 位模式** 逐个喂入。 */
export function digest(values) {
  const buf = new ArrayBuffer(8)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  let h = 0xcbf29ce484222325n
  const P = 0x100000001b3n
  const M = (1n << 64n) - 1n
  for (const v of values) {
    dv.setFloat64(0, v === undefined ? NaN : v, false)
    for (let i = 0; i < 8; i++) { h = (h ^ BigInt(u8[i])) & M; h = (h * P) & M }
  }
  return h.toString(16).padStart(16, '0')
}

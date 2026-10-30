/* P-103 (2026-09-16) 音频频段契约：按 docs/AUDIO-BAND-SPEC.md 的规格实现。
 * 参照 `oneincase/webwallgl`（MIT © oneincase，commit b61e8910ae0a176288aed99ce9a93a13ea07df57）的
 * `renderer/src/web.ts` —— 只对齐**行为契约**：宿主/网页侧 `wallpaperRegisterAudioListener` 收到的是
 * **128 元数组**（左 0..63 + 右 64..127），逐项钳到 0..1；以及"频谱要尖"的观感（γ 对比扩展 + 固定增益）。
 * **未复制其代码**：命名、打包形态、γ/增益的落点、模拟源的确定性与相位口径均自写，
 * 差异清单见 spec §5 与 THIRD-PARTY.md §12（台账 docs/COPYING-RULES.md §4 #10）。
 *
 * 与既有渲染器的关系：本仓库此前**没有**"左右各 64 段的频段数组"这一形态（音频侧只有按文件扫描的
 * 音轨索引，见 P-89 洁净室重写）。本模块是**新增能力**，不改任何既有路径；接线留待音频源落地。
 */
// audio-band-array.mjs — 128 元频段数组契约（打包/钳位/γ 扩展/确定性模拟源）

/** 频段数组的长度契约：左 64 + 右 64（与 WE 网页 API 的 `wallpaperRegisterAudioListener` 一致） */
export const AUDIO_BAND_HALF = 64;
export const AUDIO_BAND_LEN = AUDIO_BAND_HALF * 2;

/** 对比扩展指数：真实音乐的 FFT 是尖的（底鼓瞬时接近 1、间隙约 0.05），
 *  平缓的合成波形必须先做 γ 扩展才"像"频谱（否则音条是一团平泥、阈值判定永不成立）。 */
export const AUDIO_BAND_GAMMA = 1.8;
/** 扩展后乘的固定增益：把峰值顶到 1 附近（与 γ 一起定义为一条曲线，缺一不可） */
export const AUDIO_BAND_GAIN = 1.8;

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** 单频段整形：`0..1` 钳位输入 → γ 对比扩展 → 增益 → 再钳到 0..1（曲线严格单调不减）。 */
export function shapeBand(v) {
  const x = Math.max(0, Math.min(1, num(v, 0)));
  if (x <= 0) return 0;
  return Math.min(1, Math.pow(x, AUDIO_BAND_GAMMA) * AUDIO_BAND_GAIN);
}

/**
 * 左右频段 → 128 元 Float32Array（左 0..63、右 64..127）。
 * 输入比 64 短 ⇒ 余下填 0；比 64 长 ⇒ 只取前 64（契约长度**恒定**，调用方无需再判长度）。
 * 逐项 `0..1` 钳位（越界值来自噪声/未归一化的源，交给下游会让无关阈值全亮）。
 * @param {ArrayLike<number>} left
 * @param {ArrayLike<number>} right
 * @param {Float32Array|null} out 可选复用缓冲（长度必须是 128；长度不对则忽略并新建）
 * @param {{gamma?:number, gain?:number, clampOnly?:boolean}} [opts]
 *   clampOnly=true → 只做 0..1 钳位（真实频谱已是归一化值，再套 γ 会把音条整体顶满）
 */
export function packBands(left, right, out = null, opts = {}) {
  const dst = out && out.length === AUDIO_BAND_LEN ? out : new Float32Array(AUDIO_BAND_LEN);
  const gamma = num(opts.gamma, AUDIO_BAND_GAMMA);
  const gain = num(opts.gain, AUDIO_BAND_GAIN);
  const shape = (v) => {
    const x = Math.max(0, Math.min(1, num(v, 0)));
    if (opts.clampOnly) return x;
    if (x <= 0) return 0;
    return Math.min(1, Math.pow(x, gamma) * gain);
  };
  for (let i = 0; i < AUDIO_BAND_HALF; i++) {
    dst[i] = shape(left ? left[i] : 0);
    dst[AUDIO_BAND_HALF + i] = shape(right ? right[i] : 0);
  }
  return dst;
}

/**
 * 确定性模拟频谱源（没有真实音频源时的回落；也让"频谱相关功能"能被自动化测试）。
 *
 * 形态刻意做得"像音乐"：低频段（底鼓/贝斯）能量高且有**强节拍**、高频段（镲片）弱而快、
 * 通道间有相位差（消除单声道感）。全程 **Lissajous 叠加 + 无随机数** ⇒ 同一 `(t, seed)`
 * 永远给出同一组值（测试可逐位对拍；真机上也不会每帧抖成噪点）。
 *
 * @param {number} t 秒
 * @param {{seed?:number}} [opts]
 * @returns {{left:Float32Array, right:Float32Array, preL:Float32Array, preR:Float32Array}}
 *   `pre*` = **未**做 γ/钳位的原始值（0..1 内）；`left/right` = 已按 `packBands` 曲线整形。
 *   两者都给，是因为"阈值判定型"作者要峰值、"积分型"作者要均值，只有一种口径必然顾此失彼。
 */
export function simulatedBands(t, opts = {}) {
  const sec = num(t, 0);
  const seed = num(opts.seed, 1);
  const preL = new Float32Array(AUDIO_BAND_HALF);
  const preR = new Float32Array(AUDIO_BAND_HALF);
  const beat = 2.2;                                   // 每秒 2.2 拍 ≈ 132 BPM
  const kick = Math.pow(Math.max(0, Math.sin(Math.PI * sec * beat)), 6);   // 每拍一个尖峰
  for (let i = 0; i < AUDIO_BAND_HALF; i++) {
    const f = i / (AUDIO_BAND_HALF - 1);              // 0（最低频）..1（最高频）
    const low = Math.pow(1 - f, 2.2);                 // 低频权重（底鼓/贝斯）
    const high = Math.pow(f, 1.6) * 0.35;             // 高频权重（镲片/空气声），弱
    const wob = 0.5 + 0.5 * Math.sin(sec * (1.1 + 3.7 * f) + seed + f * 9.1);
    const flick = 0.5 + 0.5 * Math.sin(sec * (7.3 + 21 * f) + seed * 1.7 + i);
    const base = low * (0.35 + 0.65 * kick) + high * flick;
    preL[i] = Math.max(0, Math.min(1, base * (0.55 + 0.45 * wob)));
    // 右通道：相位偏移 + 轻微不同的摆动 ⇒ 通道间有差异（不是单声道复制）
    const wobR = 0.5 + 0.5 * Math.sin(sec * (1.1 + 3.7 * f) + seed + 1.31 + f * 8.3);
    preR[i] = Math.max(0, Math.min(1, base * (0.55 + 0.45 * wobR)));
  }
  const shapedL = packBands(preL, preL, null, { clampOnly: false });
  const shapedR = packBands(preR, preR, null, { clampOnly: false });
  return {
    left: shapedL.slice(0, AUDIO_BAND_HALF),
    right: shapedR.slice(AUDIO_BAND_HALF),
    preL,
    preR,
  };
}

/**
 * 打包成 128 元数组（模拟源的便捷入口；真实源请直接用 `packBands`）。
 */
export function simulatedBandArray(t, opts = {}) {
  const s = simulatedBands(t, opts);
  return packBands(s.preL, s.preR, null, { clampOnly: false });
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ①(P-131 批 D 2026-09-19) **音频响应（audio response）** 与 **活视图（live view）**
 *
 * 两件事，都有官方一手文档（`docs/PATCHES.md` P-131 列了逐条出处）：
 *   1. `engine.registerAudioBuffers(n)` 返回的 `AudioBuffers` 是**每帧自动更新的活对象**
 *      （官方文档原文：`Their contents will be updated for every frame automatically, so you can
 *      continuously read the audio levels from this object.`；官方示例把返回值存进顶层 `const`、
 *      只调一次）⇒ 宿主必须交出**同一批数组对象**、内容原地刷新，不能是"调用那一刻的快照"。
 *   2. 粒子组件的 `audioprocessing*`（mode/bounds/exponent/frequencystart/frequencyend）叫
 *      **Audio response**，取值语义：mode = `None`(0)/`Left`(1)/`Right`(2)/`Center`(3)；
 *      bounds = 起止阈值（在 [b0,b1] 之间线性淡入）；exponent = 幂次（越大越压低声小的部分）；
 *      frequency 端点是 **16 段频谱的下标 0..15**（0 = 低频 bass、15 = 高频 treble）。
 * 本模块只放**纯函数**（无 DOM/无 WebAudio）：活视图 + 包络，宿主与渲染器共用同一份口径。
 * ⚠ 未证实项（需真机/官方二进制）：① `average` 的官方实现是否严格等于 (left+right)/2
 *   （文档只说"两个通道的算术平均"）；② 包络在 [freqstart,freqend] 上取**均值**还是峰值
 *   （文档未写 ⇒ 本实现取均值，见 P-131 的"未证实"节）；③ 16 段频谱的频率切分（我们按
 *   自己 128 元契约 4:1 折叠，官方是 mel 布局，见 `docs/AUDIO-BAND-SPEC.md` §5）。
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** 音频响应档位（官方编辑器下拉：None / Left / Right / Center） */
export const AUDIO_RESPONSE_MODES = { none: 0, left: 1, right: 2, center: 3 }

/** 音频响应读的是 **16 段分辨率**（官方编辑器把 frequency 取值写成 0..15） */
export const AUDIO_RESPONSE_BANDS = 16

/**
 * 官方缺省（两套，按组件类型分）：
 *   · emitter  —— 官方二进制字符串池里 `audioprocessingbounds` 旁边就是字面量 `"0.8 1.0"`，
 *     且 `lwe-ref` 的 emitter 解析写死 `parseVec2("audioprocessingbounds", glm::vec2(0.8,1.0))`、
 *     `audioprocessingexponent → 2`、`frequencystart → 0`、`frequencyend → 1`、`mode → 0`。
 *     `frequencyend=1` 与官方文档"设成 1 就只对鼓点反应"一致 ⇒ 发射器缺省只看最低两段。
 *   · operator / initializer —— `lwe-ref` 的 `it.user(...)` 分支：bounds (0,1)、exponent 1、
 *     frequencystart 0、frequencyend 15（全频段）、mode 0。
 */
export const AUDIO_RESPONSE_DEFAULTS = {
  emitter: { mode: 0, bounds: [0.8, 1.0], exponent: 2, freqStart: 0, freqEnd: 1 },
  operator: { mode: 0, bounds: [0.0, 1.0], exponent: 1, freqStart: 0, freqEnd: 15 },
}

/** 解析 `audioprocessing*`（原始 def 组件对象）→ 归一化 spec；mode<=0 视作"没开音频响应"。 */
export function parseAudioResponse(raw, kind = 'operator') {
  const d = AUDIO_RESPONSE_DEFAULTS[kind === 'emitter' ? 'emitter' : 'operator']
  if (!raw || typeof raw !== 'object') return null
  const has = ['audioprocessingmode', 'audioprocessingbounds', 'audioprocessingexponent',
    'audioprocessingfrequencystart', 'audioprocessingfrequencyend'].some((k) => raw[k] !== undefined)
  if (!has) return null
  const i = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : dflt }
  const b = pVec2Like(raw.audioprocessingbounds, d.bounds)
  const mode = i(raw.audioprocessingmode, d.mode)
  return {
    mode,
    bounds: b,
    // 官方 exponent 是"幂次"，文档口径 ≥1；<1 会让小声被放大（未在语料出现）⇒ 只做下限保护
    exponent: (() => { const n = Number(raw.audioprocessingexponent); return Number.isFinite(n) && n > 0 ? n : d.exponent })(),
    // 官方 frequency 端点是 16 段下标，负数/越界在取值时再钳（这里保留作者原值，便于诊断）
    freqStart: i(raw.audioprocessingfrequencystart, d.freqStart),
    freqEnd: i(raw.audioprocessingfrequencyend, d.freqEnd),
    kind: kind === 'emitter' ? 'emitter' : 'operator',
  }
}
function pVec2Like(s, dflt) {
  if (s == null) return dflt.slice()
  if (Array.isArray(s)) return [num(s[0], dflt[0]), num(s[1], dflt[1])]
  if (typeof s === 'object') return [num(s.x, dflt[0]), num(s.y, dflt[1])]
  const p = String(s).trim().split(/\s+/).map(Number)
  return [num(p[0], dflt[0]), num(p[1], dflt[1])]
}

/** 单通道重采样：`src` 的 `srcLen` 项 → `n` 段均值（低频在前；越界当 0）。`out` 复用。 */
export function resampleBands(src, n, out = null) {
  const len = Math.max(1, Math.trunc(num(n, 1)))
  const dst = out && out.length === len ? out : new Float32Array(len)
  const srcLen = src && typeof src.length === 'number' ? src.length : 0
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * srcLen / len), z = Math.max(a + 1, Math.floor((i + 1) * srcLen / len))
    let s = 0
    for (let k = a; k < z; k++) s += num(src[k], 0)
    dst[i] = srcLen ? s / (z - a) : 0
  }
  return dst
}

/**
 * 新建一份**活视图**：`{resolution, left, right, average}` 三个 `Float32Array`。
 * 官方文档把 `left/right/average` 的类型写成 `Float32Array`，且"每帧自动更新" ⇒ 调用方
 * （脚本顶层 `const`）长期持有它，宿主每帧 `writeLiveBands` 原地刷新。
 */
export function createLiveBands(resolution = AUDIO_RESPONSE_BANDS) {
  const n = Math.max(1, Math.trunc(num(resolution, AUDIO_RESPONSE_BANDS)))
  return {
    resolution: n,
    left: new Float32Array(n),
    right: new Float32Array(n),
    average: new Float32Array(n),
    // 诊断（宿主填）：'analyser' | 'mic' | 'simulated' | 'silent'
    kind: 'silent',
    hasSource: false,
    revision: 0,
  }
}

/**
 * 用左右通道数据**原地**写活视图（`average[i] = (left[i]+right[i])/2` —— 官方文档的
 * "arithmetic mean of both channels"）。左右缺一个 ⇒ 用另一个补齐（单声道不伪造立体声差异）。
 * 返回同一个 `view` 对象（引用恒定，内容随帧变化）。
 */
export function writeLiveBands(view, left, right, opts = {}) {
  if (!view || !view.left) return view
  const n = view.left.length
  const l = resampleBands(left, n, view.left)
  const r = resampleBands(right != null ? right : left, n, view.right)
  for (let i = 0; i < n; i++) view.average[i] = (l[i] + r[i]) / 2
  if (opts.kind !== undefined) view.kind = String(opts.kind)
  if (opts.hasSource !== undefined) view.hasSource = !!opts.hasSource
  view.revision = (view.revision | 0) + 1
  return view
}

/**
 * **音频响应包络**（0..1）——粒子 `audioprocessing*` 的官方语义：
 *
 * ```text
 *   通道   = mode 1→left、2→right、3→average（Center = 左右同时）
 *   频段   = [min(freqStart,freqEnd), max(...)] 闭区间（16 段下标，0=低频）
 *   raw    = 该区间各段的**均值**
 *   t      = clamp((raw − bounds0) / (bounds1 − bounds0), 0, 1)   // bounds 是"起止阈值"
 *   env    = t ^ exponent
 * ```
 *
 * 返回 `null` = **不做音频调制**（mode<=0，或没有活视图/没有数据源 —— 调用方保持原值）。
 * 返回 0 = "有数据源但此刻是静音"（官方：没声音就不发射）。
 */
export function audioEnvelope(spec, view) {
  if (!spec || !(num(spec.mode, 0) > 0)) return null
  if (!view) return null
  const mode = Math.trunc(num(spec.mode, 0))
  const arr = mode === 1 ? view.left : mode === 2 ? view.right : view.average
  if (!arr || !arr.length) return null
  const last = arr.length - 1
  const clampIdx = (v) => Math.max(0, Math.min(last, Math.trunc(num(v, 0))))
  let f0 = clampIdx(spec.freqStart), f1 = clampIdx(spec.freqEnd)
  if (f1 < f0) { const t = f0; f0 = f1; f1 = t }
  let sum = 0
  for (let k = f0; k <= f1; k++) sum += num(arr[k], 0)
  const raw = sum / (f1 - f0 + 1)
  const b0 = num(spec.bounds && spec.bounds[0], 0), b1 = num(spec.bounds && spec.bounds[1], 1)
  let t
  if (b1 > b0) t = (raw - b0) / (b1 - b0)
  else t = raw >= b1 ? 1 : 0                   // 退化区间（b1<=b0）：阈值型判定
  t = t <= 0 ? 0 : t >= 1 ? 1 : t
  const exp = num(spec.exponent, 1)
  const env = exp === 1 ? t : Math.pow(t, exp)
  return env <= 0 ? 0 : env >= 1 ? 1 : env
}

/** 频段数组诊断摘要（进 diag/日志：一眼看出"有没有数据 / 是不是全零 / 峰值在哪一段"）。 */
export function bandStats(arr) {
  const a = arr && typeof arr.length === 'number' ? arr : [];
  let sum = 0, peak = 0, peakAt = -1, nonzero = 0;
  for (let i = 0; i < a.length; i++) {
    const v = num(a[i], 0);
    sum += v;
    if (v > peak) { peak = v; peakAt = i; }
    if (v > 0) nonzero++;
  }
  const n = a.length || 1;
  return { length: a.length, mean: sum / n, peak, peakAt, nonzero, silent: nonzero === 0 };
}

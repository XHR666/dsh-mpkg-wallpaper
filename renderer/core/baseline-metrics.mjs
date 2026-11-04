// baseline-metrics.mjs —— ①(§5-⑨ 真机基线快照 2026-09-17) **真机基线**的纯计算内核。
//
// 为什么有这个文件：
//   极致清单第 ⑨ 项要"定期抓 FPS / VRAM / 启动耗时 / 壁纸切换耗时，形成趋势"，让"变慢了"
//   这件事以后**有数据可查**。本机**无 GPU、无 WebGL2** ⇒ 这里一个真实数字都产不出来，
//   能交付的是"能在用户真机上跑、并把结果落盘/回传的工具链"：采集器（浏览器侧，见 demo.html 的
//   `MPW-BASELINE-BEGIN` 段）+ 服务端落盘（`POST /baseline`）+ 对照闸门（`tools/baseline-diff.mjs`）。
//
// 本模块 = 那条链上**唯一**做算术的地方，刻意做成**零依赖、无 DOM、无 GL 依赖**的纯函数集：
//   · 分位/中位/1% low 的定义只有一份（`mpwPercentile` 等），页面、脚本、测试读同一份；
//   · 采样器是**状态机**（喂 rAF 时间戳），测试用合成时间戳即可复现全部口径，不需要真机；
//   · GL 侧只做**代理计数**（包装 createFramebuffer/createTexture/texImage2D/draw*），
//     传个假 gl 对象就能单测（tests/baseline-test.mjs T3）。
//
// ⚠ **VRAM 的诚实说明**（写进文档、也写在快照里）：浏览器**拿不到**真实显存占用 ——
//   WebGL 没有查询显存的 API，`performance.memory` 是 **JS 堆**（不是显存），
//   `Σw×h×bpp` 是**估算**（漏 mip、漏驱动对齐/压缩、含 FBO 附件纹理）。
//   所以本模块产出的字段一律叫 `*Est` / `*Proxy`，**永不**命名为"显存/VRAM 实测值"。
//
// 用法（页面侧）：见 demo.html `MPW-BASELINE-BEGIN` 段；用法（Node 侧）：见 tools/baseline-diff.mjs。

/** 快照 schema 版本：字段含义变化时 +1（`baseline-diff` 拒绝对不同 schema 硬比）。 */
export const BASELINE_SCHEMA = 1

/** 采集默认值与硬边界（时长越界一律钳制，不静默变成"永不结束"）。 */
export const BASELINE_DEFAULTS = {
  durationSec: 10,
  minDurationSec: 2,
  maxDurationSec: 120,
  windowMs: 500,          // FPS 滚动窗口：500ms（任务书 §5-⑨ 指定）
  startupFrameTarget: 90, // 启动耗时另一条判据："第 90 帧"（与 ?thumbpost 的 t90 同口径）
  probeIntervalMs: 250,   // "纹理齐全"探测节流（每 250ms 一次，避免逐帧扫层）
}

/** 数值口径常量（改这里 = 改所有消费者；文档 docs/BASELINE.md 与测试同源引用）。 */
export const BASELINE_UNITS = {
  msRound: 2,            // 毫秒一律四舍五入到 0.01ms
  fpsRound: 2,           // 帧率一律四舍五入到 0.01fps
  p1LowFraction: 0.01,   // "1% low" = 最慢 1% 帧（至少 1 帧）
  bytesPerPixelDefault: 4,
}

// ─────────────────────────── 基础数学（唯一定义处） ───────────────────────────

const round = (v, n) => (Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : null)
const finiteList = (values) => {
  const out = []
  if (!values || typeof values.length !== 'number') return out
  for (let i = 0; i < values.length; i++) { const v = Number(values[i]); if (Number.isFinite(v)) out.push(v) }
  return out
}
const sortedAsc = (arr) => arr.slice().sort((a, b) => a - b)

/**
 * **最近秩（nearest-rank）分位**：`idx = ceil(q×n) − 1`，钳到 `[0, n−1]`。
 * 为什么用最近秩而不是线性插值：口径只有一条、真值表能逐位写死（`baseline-test` T1），
 * 且不会被"两个数平均"这种插值把慢帧抹平（性能分位要保守）。
 * 偶数个样本时 `q=0.5` 取**下中位**（不取两数平均）——与 `mpwMedian` 同一个函数。
 * @param {number[]} values 任意数值序列（内部过滤非有限值后排序）
 * @param {number} q 0..1（越界钳制）
 * @returns {number|null} 空输入/非法 q → null
 */
export function mpwPercentile(values, q) {
  const arr = finiteList(values)
  if (!arr.length) return null
  const qq = Number(q)
  if (!Number.isFinite(qq)) return null
  const c = Math.min(1, Math.max(0, qq))
  arr.sort((a, b) => a - b)
  return arr[Math.max(0, Math.min(arr.length - 1, Math.ceil(c * arr.length) - 1))]
}

/** 中位 = `mpwPercentile(values, 0.5)`（偶数样本取下中位，见上）。 */
export function mpwMedian(values) { return mpwPercentile(values, 0.5) }

/** 均值（过滤非有限值）；空输入 → null。 */
export function mpwMean(values) {
  const arr = finiteList(values)
  if (!arr.length) return null
  let s = 0
  for (const v of arr) s += v
  return s / arr.length
}

/**
 * 每帧耗时（ms）的分位画像。**输入语义 = 相邻两帧的时间间隔**（rAF 时间戳之差），
 * 不是"渲染函数内部耗时"——后者只在 `?perf=1` 时才有（见 `render` 块的口径说明）。
 * @returns {{n:number,p50:number|null,p95:number|null,p99:number|null,max:number|null,mean:number|null}}
 */
export function mpwFrameMsStats(frameTimesMs) {
  const arr = finiteList(frameTimesMs)
  return {
    n: arr.length,
    p50: round(mpwPercentile(arr, 0.5), BASELINE_UNITS.msRound),
    p95: round(mpwPercentile(arr, 0.95), BASELINE_UNITS.msRound),
    p99: round(mpwPercentile(arr, 0.99), BASELINE_UNITS.msRound),
    max: arr.length ? round(Math.max(...arr), BASELINE_UNITS.msRound) : null,
    mean: round(mpwMean(arr), BASELINE_UNITS.msRound),
  }
}

/**
 * **1% low FPS** = `1000 / mean(最慢 1% 帧的帧时间)`（至少取 1 帧）。
 * 口径说明：这是"卡顿最狠的那 1% 帧"折算成的帧率，与"FPS 中位"一起看才能区分
 * "一直慢"和"偶尔卡一下"。
 */
export function mpwP1LowFps(frameTimesMs) {
  const arr = finiteList(frameTimesMs)
  if (!arr.length) return null
  const take = Math.max(1, Math.ceil(arr.length * BASELINE_UNITS.p1LowFraction))
  const worst = sortedAsc(arr).slice(-take)
  const m = mpwMean(worst)
  return (m && m > 0) ? round(1000 / m, BASELINE_UNITS.fpsRound) : null
}

/**
 * **滚动窗口 FPS**：把帧时间戳切成长度 `windowMs` 的**完整**窗口，每窗
 * `fps = 窗内帧数 × 1000 / windowMs`。
 * 两条刻意选择（写进文档、测试锁死）：
 *   ① 只统计**完整覆盖**的窗口（末尾不足一窗的残窗丢弃），否则最后一窗会因帧数不足虚报低帧率；
 *   ② 总时长不足一窗时给**一个** `partial:true` 的窗口（`fps=(n−1)×1000/span`），
 *      这样 `?baselinedur=2` 这种超短采集也有数，而不是空表。
 */
export function mpwFpsWindows(timestampsMs, windowMs = BASELINE_DEFAULTS.windowMs) {
  const w = Number(windowMs) > 0 ? Number(windowMs) : BASELINE_DEFAULTS.windowMs
  const ts = finiteList(timestampsMs)
  const out = []
  if (ts.length < 2) return { windowMs: w, windows: [], partial: false }
  const t0 = ts[0], tN = ts[ts.length - 1], span = tN - t0
  if (span < w) {
    out.push({ t0: round(t0, BASELINE_UNITS.msRound), t1: round(tN, BASELINE_UNITS.msRound), frames: ts.length, fps: round((ts.length - 1) * 1000 / span, BASELINE_UNITS.fpsRound), partial: true })
    return { windowMs: w, windows: out, partial: true }
  }
  const full = Math.floor(span / w)
  for (let b = 0; b < full; b++) {
    const a = t0 + b * w, z = a + w
    let n = 0
    for (const t of ts) if (t >= a && t < z) n++
    out.push({ t0: round(a, BASELINE_UNITS.msRound), t1: round(z, BASELINE_UNITS.msRound), frames: n, fps: round(n * 1000 / w, BASELINE_UNITS.fpsRound), partial: false })
  }
  return { windowMs: w, windows: out, partial: false }
}

/**
 * FPS 汇总：**中位**（任务书指定）、**1% low**、min/max（只在完整窗口上取 min/max，
 * 避免残窗把 min 拉低）。
 * @returns {{windowMs:number,windows:number,partial:boolean,median:number|null,p1Low:number|null,min:number|null,max:number|null}}
 */
export function mpwFpsStats(frameTimesMs, timestampsMs, windowMs = BASELINE_DEFAULTS.windowMs) {
  const win = mpwFpsWindows(timestampsMs, windowMs)
  const fpsList = win.windows.filter((x) => !x.partial).map((x) => x.fps)
  const basis = fpsList.length ? fpsList : win.windows.map((x) => x.fps)
  return {
    windowMs: win.windowMs,
    windows: win.windows.length,
    partial: win.partial,
    median: round(mpwPercentile(basis, 0.5), BASELINE_UNITS.fpsRound),
    p1Low: mpwP1LowFps(frameTimesMs),
    min: basis.length ? round(Math.min(...basis), BASELINE_UNITS.fpsRound) : null,
    max: basis.length ? round(Math.max(...basis), BASELINE_UNITS.fpsRound) : null,
  }
}

/**
 * 启动耗时三段（全部相对**导航起点**，单位 ms；`performance.now()` 的时间原点就是导航起点）：
 *   `navToFirstFrameMs`      导航 → 首帧画完（含解析/下载/纹理上传/首次渲染）
 *   `firstFrameToReadyMs`    首帧 → "就绪"（**纹理齐全**或**第 90 帧**，谁先到算谁）
 *   `totalMs`                导航 → 就绪（= 上面两段之和，趋势对比的主指标）
 * `readyReason`：`tex-complete` / `frame-target` / `timeout`（窗口结束仍未就绪）。
 * 任一输入非有限 → 对应字段为 null（不编造数字）。
 */
export function mpwStartupStats(o) {
  const opt = o || {}
  const nav = numOrNull(opt.navToFirstFrameMs)
  const ready = numOrNull(opt.firstFrameToReadyMs)
  const target = Number.isFinite(Number(opt.frameTarget)) ? Number(opt.frameTarget) : BASELINE_DEFAULTS.startupFrameTarget
  return {
    navToFirstFrameMs: round(nav, BASELINE_UNITS.msRound),
    firstFrameToReadyMs: round(ready, BASELINE_UNITS.msRound),
    totalMs: (nav !== null && ready !== null) ? round(nav + ready, BASELINE_UNITS.msRound) : null,
    readyReason: opt.readyReason || null,
    // 帧号：用 numOrNull（不是 Number.isFinite(Number(x)) —— `Number(null)===0` 会把"没有这个值"写成 0）
    readyFrame: numOrNull(opt.readyFrame),
    texReadyFrame: numOrNull(opt.texReadyFrame),
    frameTarget: target,
    nav: (opt.nav && typeof opt.nav === 'object') ? opt.nav : null,
  }
}
function numOrNull(v) { const n = Number(v); return (v === null || v === undefined || v === '' || !Number.isFinite(n)) ? null : n }

// ─────────────────────────── 纹理/FBO 代理（GL 包装器） ───────────────────────────

/**
 * `internalformat` → 每像素字节数（**估算**；认不出的格式按 4 计并在 `unknownFormats` 里记账）。
 * 用 `gl` 自己的常量名取值（不写死数字，跨实现一致）；`gl` 缺失时只用默认值。
 */
export function mpwBytesPerPixel(internalFormat, gl) {
  const g = gl || {}
  const table = [
    [g.RGBA32F, 16], [g.RGBA16F, 8], [g.RGB32F, 12], [g.RGB16F, 6],
    [g.RGBA8, 4], [g.RGBA, 4], [g.SRGB8_ALPHA8, 4], [g.RGB10_A2, 4], [g.RGB5_A1, 4],
    [g.RGB, 3], [g.RG8, 2], [g.RG, 2],
    [g.R8, 1], [g.RED, 1], [g.ALPHA, 1], [g.LUMINANCE, 1], [g.LUMINANCE_ALPHA, 2],
  ]
  for (const [k, bpp] of table) if (k !== undefined && k !== null && k === internalFormat) return bpp
  return BASELINE_UNITS.bytesPerPixelDefault
}

/**
 * 在**真 gl 对象**上装一层只读计数（页面侧只在 `?baseline=` 打开时调用一次）：
 *   · `glFbosLive`  = createFramebuffer − deleteFramebuffer（**活着的 FBO 个数**，真计数不是估算）
 *   · `glTexturesLive` = createTexture − deleteTexture
 *   · `textureBytesEst` = Σ(每个活纹理最近一次 **level-0** `texImage2D` 的 w×h×bpp)
 *     ⚠ 这是**估算**：漏 mip 链、漏驱动对齐/压缩，**包含 FBO 的颜色附件纹理**
 *     （它们也是 texImage2D 上传的）——正因为包含，它比"只数贴图"更接近"总 GPU 内存代理"。
 *   · `texBytesMaxSingle` = 单张最大估算（排查"某张巨图"）
 *   · `drawCalls` = drawArrays/drawElements/实例化版的总调用次数（每帧 draw 数的来源）
 *   · `uploads` / `uploadBytes` = 上传次数与累计字节（视频纹理逐帧重传会很大，属"带宽代理"）
 * 包装是**幂等**的（同一 gl 上重复调用直接返回已有计数器），失败一律吞掉（诊断绝不影响渲染）。
 * @param {WebGL2RenderingContext|object} gl 真 gl 或假 gl（测试）
 * @returns {{installed:boolean, snapshot:Function, reset:Function}}
 */
export function mpwBaselineInstallGlCounters(gl) {
  const empty = () => ({
    glFbosLive: 0, glFbosCreated: 0, glFbosDeleted: 0,
    glTexturesLive: 0, glTexturesCreated: 0, glTexturesDeleted: 0,
    textureBytesEst: 0, texBytesMaxSingle: 0, unknownFormats: 0,
    drawCalls: 0, uploads: 0, uploadBytes: 0,
  })
  if (!gl || typeof gl !== 'object') return { installed: false, snapshot: empty, reset: () => {} }
  const liveBytes = (cc) => { let s = 0; for (const v of cc.texBytes.values()) s += v; return s }
  if (gl.__mpwBaselineCounters) {
    // 幂等：同一 gl 上重复调用（多实例/重复 boot）直接复用已有计数器，绝不二次包装
    const c0 = gl.__mpwBaselineCounters
    return {
      installed: true,
      snapshot: () => Object.assign({}, c0.totals, { textureBytesEst: liveBytes(c0), texBytesMaxSingle: c0.texMax }),
      reset: () => { c0.totals = empty(); c0.texBytes = new Map(); c0.texMax = 0; c0.pending = [] },
    }
  }
  const c = { totals: empty(), texBytes: new Map(), texMax: 0, pending: [] }
  try { gl.__mpwBaselineCounters = c } catch (e) { /* 只读 gl（桩）允许无属性 */ }
  // 包装 = **先调原函数、再记账**（`createTexture` 要拿到返回值当记账键；GL 抛错时不计账，
  // 与"真出错时数字就别算了"同向）。计数自身抛错绝不影响 GL 调用。
  const wrap = (name, fn) => {
    const raw = gl[name]
    if (typeof raw !== 'function') return false
    gl[name] = function (...a) {
      const ret = raw.apply(gl, a)
      try { fn(a, ret) } catch (e) { /* 计数失败不影响 GL */ }
      return ret
    }
    return true
  }
  const bppOf = (internalFormat) => {
    const b = mpwBytesPerPixel(internalFormat, gl)
    if (b === BASELINE_UNITS.bytesPerPixelDefault && internalFormat !== gl.RGBA && internalFormat !== gl.RGBA8) c.totals.unknownFormats++
    return b
  }
  wrap('createFramebuffer', () => { c.totals.glFbosLive++; c.totals.glFbosCreated++ })
  wrap('deleteFramebuffer', () => { c.totals.glFbosLive = Math.max(0, c.totals.glFbosLive - 1); c.totals.glFbosDeleted++ })
  wrap('createTexture', (a, ret) => {
    c.totals.glTexturesLive++; c.totals.glTexturesCreated++
    if (ret) { c.pending.push(ret); if (c.pending.length > 8) c.pending.shift() }
  })
  wrap('deleteTexture', (a) => {
    c.totals.glTexturesLive = Math.max(0, c.totals.glTexturesLive - 1)
    c.totals.glTexturesDeleted++
    if (a[0]) c.texBytes.delete(a[0])
  })
  // texImage2D：9 参（w/h 数字）与 6 参（源对象）两种形态都认；只记 level 0。
  // 归属规则（写进文档，别指望它精确）：`createTexture` 之后的**第一次** level-0 上传记到那张新纹理
  // （本仓库与官方路径都是 create→bind→texImage2D）；队列空 = 已有纹理的**重传**（视频逐帧），
  // 尺寸早已记过 ⇒ 只累计带宽（uploadBytes），**不改**活字节数（避免把别人的字节数覆盖掉）。
  wrap('texImage2D', (a) => {
    const level = Number(a[1])
    if (level !== 0) return
    const bpp = bppOf(a[2])
    let w = 0, h = 0
    if (typeof a[3] === 'number' && typeof a[4] === 'number') { w = Number(a[3]); h = Number(a[4]) }
    else if (a[5] && typeof a[5] === 'object') { w = Number(a[5].width) || 0; h = Number(a[5].height) || 0 }
    else if (typeof a[5] === 'number' && typeof a[6] === 'number') { w = Number(a[5]); h = Number(a[6]) }
    if (!(w > 0 && h > 0)) return
    const bytes = w * h * bpp
    c.totals.uploads++
    c.totals.uploadBytes += bytes
    if (c.texMax < bytes) c.texMax = bytes
    const tex = c.pending.shift() || null
    if (tex) c.texBytes.set(tex, bytes)
  })
  wrap('texSubImage2D', () => { c.totals.uploads++ })
  for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) wrap(n, () => { c.totals.drawCalls++ })
  return {
    installed: true,
    snapshot: () => Object.assign({}, c.totals, { textureBytesEst: liveBytes(c), texBytesMaxSingle: c.texMax }),
    reset: () => { c.totals = empty(); c.texBytes = new Map(); c.texMax = 0; c.pending = [] },
  }
}

// ─────────────────────────── 开关解析（?baseline / ?baselinedur / ?baselineswap） ───────────────────────────

const SWAP_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/

/**
 * 解析采集开关（与既有 `?flag` 同形，**默认关**）：
 *   · `?baseline=1`（或 `on/yes/true`）→ 开，时长取 `?baselinedur=` 或默认 10s
 *   · `?baseline=<秒>`（≥ `minDurationSec`）→ 开，并**顺带**定时长（少写一个参数）
 *   · `?baseline=0|off|no|false` 或**不写** → 关（不写参数 = 零行为变化，红线）
 *   · `?baselinedur=<秒>` → 时长（2..120，越界钳制；非法值记 note 并回落默认）
 *   · `?baselineswap=<另一个包 id>` → 采集结束后切到它再切回来，两次切换各记一次耗时
 * 非法输入**不抛异常**：关掉采集 + 往 `notes` 里写一行原因（页面会打出来，不静默）。
 * @param {{get:Function}|null} searchParams URLSearchParams（或同形对象）
 */
export function mpwBaselineParseOpts(searchParams) {
  const get = (k) => { try { return searchParams && typeof searchParams.get === 'function' ? searchParams.get(k) : null } catch (e) { return null } }
  const notes = []
  const raw = get('baseline')
  let on = false
  let durationSec = BASELINE_DEFAULTS.durationSec
  if (raw !== null && raw !== '') {
    const s = String(raw).trim().toLowerCase()
    if (s === '0' || s === 'off' || s === 'no' || s === 'false') on = false
    else if (s === '1' || s === 'on' || s === 'yes' || s === 'true') on = true
    else {
      const n = Number(s)
      if (Number.isFinite(n) && n >= BASELINE_DEFAULTS.minDurationSec) { on = true; durationSec = clampDur(n) }
      else { on = false; notes.push('?baseline=' + raw + ' 非法（只认 1/on/yes/true 或 ≥' + BASELINE_DEFAULTS.minDurationSec + ' 的秒数）→ 采集保持**关**') }
    }
  }
  const durRaw = get('baselinedur')
  if (durRaw !== null && durRaw !== '') {
    const n = Number(String(durRaw).trim())
    if (Number.isFinite(n) && n >= BASELINE_DEFAULTS.minDurationSec) {
      durationSec = clampDur(n)
      if (!on) notes.push('?baselinedur=' + durRaw + ' 写了但 ?baseline 未开 → **不采集**（默认关）')
    } else {
      notes.push('?baselinedur=' + durRaw + ' 非法（要 ≥' + BASELINE_DEFAULTS.minDurationSec + ' 秒）→ 用默认 ' + durationSec + 's')
    }
  }
  let swapId = null
  const swapRaw = get('baselineswap')
  if (swapRaw !== null && swapRaw !== '') {
    const s = String(swapRaw).trim()
    if (SWAP_ID_RE.test(s) && !s.includes('..')) swapId = s
    else notes.push('?baselineswap=' + swapRaw + ' 非法（只认 [A-Za-z0-9_][A-Za-z0-9_.-]{0,63}，拒 `..`）→ 不做切换测量')
  }
  if (swapId && !on) notes.push('?baselineswap 写了但 ?baseline 未开 → 不做切换测量')
  return {
    on, durationSec, swapId,
    windowMs: BASELINE_DEFAULTS.windowMs,
    startupFrameTarget: BASELINE_DEFAULTS.startupFrameTarget,
    raw: { baseline: raw, baselinedur: durRaw, baselineswap: swapRaw },
    notes,
  }
}
function clampDur(n) { return Math.min(BASELINE_DEFAULTS.maxDurationSec, Math.max(BASELINE_DEFAULTS.minDurationSec, Math.round(Number(n) * 100) / 100)) }

// ─────────────────────────── 采样器（状态机；无 DOM / 无 GL） ───────────────────────────

/**
 * 建一个采样器。调用方（demo.html）每帧喂 `noteFrame(rAF 时间戳, 帧号)`，
 * 采样器自己按 `probeIntervalMs` 节流去问 `state()`（纹理齐全没/活纹理数/FBO 数/设备信息）。
 * **不做任何 IO、不建定时器**：`shouldFinish()` 返回 true 时由调用方去 build + POST。
 * @param {{opts:object, state?:Function, now?:Function}} o
 */
export function mpwBaselineCreateSampler(o) {
  const opt = (o && o.opts) || {}
  const durationMs = (Number(opt.durationSec) > 0 ? Number(opt.durationSec) : BASELINE_DEFAULTS.durationSec) * 1000
  const windowMs = Number(opt.windowMs) > 0 ? Number(opt.windowMs) : BASELINE_DEFAULTS.windowMs
  const frameTarget = Number(opt.startupFrameTarget) > 0 ? Number(opt.startupFrameTarget) : BASELINE_DEFAULTS.startupFrameTarget
  const stateOf = (typeof (o && o.state) === 'function') ? o.state : () => ({})
  const stamps = []      // rAF 时间戳（ms，相对导航起点）
  const dts = []         // 相邻帧间隔（ms；首帧无间隔）
  let firstTs = null, lastTs = null, readyTs = null, readyReason = null, readyFrame = null
  let texReadyFrame = null, texMissingLast = null, lastProbeTs = null, frames = 0
  let renderMs = []      // 仅 `?perf=1` 时由 noteRenderMs 喂入（渲染函数内部耗时）
  const notes = (opt.notes || []).slice()

  const probeState = (ts) => {
    let st = null
    try { st = stateOf() || {} } catch (e) { st = {} }
    const missing = Number(st.texMissing)
    if (Number.isFinite(missing)) texMissingLast = missing
    if (readyTs === null) {
      // 纹理齐全：帧号取"探测那一刻"（探测每 250ms 一次 ⇒ 帧号是近似值，时间也是上界）
      if (Number.isFinite(missing) && missing === 0) { readyTs = ts; readyReason = 'tex-complete'; readyFrame = frames; texReadyFrame = frames }
      // 第 90 帧判据：帧号**精确**（判据本身就是帧号），时间受探测节流影响是上界
      else if (frames >= frameTarget) { readyTs = ts; readyReason = 'frame-target'; readyFrame = frameTarget }
    }
    return st
  }

  return {
    /** 每帧调一次（rAF 时间戳 + 该页的帧号；帧号缺省用内部计数）。 */
    noteFrame(ts, frameNo) {
      const t = Number(ts)
      if (!Number.isFinite(t)) return
      frames = Number.isFinite(Number(frameNo)) ? Number(frameNo) : frames + 1
      const prev = lastTs
      if (prev !== null) {
        const dt = t - prev
        if (Number.isFinite(dt) && dt >= 0) dts.push(dt)
      }
      stamps.push(t)
      if (firstTs === null) { firstTs = t; probeState(t) }      // 首帧立刻探一次（小场景可能已齐全）
      lastTs = t
      if (lastProbeTs === null || (t - lastProbeTs) >= BASELINE_DEFAULTS.probeIntervalMs) { lastProbeTs = t; probeState(t) }
    },
    /** `?perf=1` 同开时喂"渲染主体耗时"（否则 `render.available=false`，明细看快照里的 note）。 */
    noteRenderMs(ms) { const v = Number(ms); if (Number.isFinite(v) && v >= 0) renderMs.push(v) },
    /** 时长到了没（到点由调用方 build + POST；采样器自己不动手）。 */
    shouldFinish() { return firstTs !== null && lastTs !== null && (lastTs - firstTs) >= durationMs },
    elapsedSec() { return (firstTs !== null && lastTs !== null) ? round((lastTs - firstTs) / 1000, 3) : null },
    /** 组装快照（`meta` 由页面提供 url/id/ua/flags/device 等环境字段）。 */
    build(meta) {
      const m = meta || {}
      const st = (() => { try { return stateOf() || {} } catch (e) { return {} } })()
      const counts = Object.assign({
        layers: null, layersVisible: null, textures: null, texMissing: texMissingLast,
        glTexturesLive: null, glFbosLive: null, drawCalls: null, drawsPerFrame: null, uploads: null, uploadBytes: null,
      }, m.counts || {})
      const drawAvg = (Number.isFinite(Number(counts.drawCalls)) && frames > 0) ? round(Number(counts.drawCalls) / frames, 2) : null
      if (drawAvg !== null) counts.drawsPerFrame = drawAvg
      counts.frames = frames
      if (readyTs === null) { readyReason = readyReason || 'timeout' }
      const startup = mpwStartupStats({
        navToFirstFrameMs: firstTs,
        firstFrameToReadyMs: (readyTs !== null && firstTs !== null) ? (readyTs - firstTs) : null,
        readyReason,
        readyFrame, texReadyFrame, frameTarget,
        nav: m.nav || null,
      })
      const vram = Object.assign({}, m.vramProxy || {})
      const texBytes = Number(vram.textureBytesEst)
      const heap = Number(vram.jsHeapUsedBytes)
      vram.note = '浏览器**拿不到**真实显存读数（WebGL 无此 API）：本块全为代理估算 —— textureBytesEst = Σ(活纹理 level-0 的 w×h×bpp，含 FBO 附件纹理，漏 mip/驱动对齐)，jsHeap* 是 **JS 堆**（performance.memory，非显存，Firefox/Safari 无此 API ⇒ null）。'
      vram.totalBytesEst = (Number.isFinite(texBytes) || Number.isFinite(heap))
        ? (Number.isFinite(texBytes) ? texBytes : 0) + (Number.isFinite(heap) ? heap : 0)
        : null
      vram.totalMBEst = Number.isFinite(vram.totalBytesEst) ? round(vram.totalBytesEst / 1048576, 2) : null
      vram.textureMBEst = Number.isFinite(texBytes) ? round(texBytes / 1048576, 2) : null
      return {
        kind: 'baseline',
        schema: BASELINE_SCHEMA,
        at: new Date().toISOString(),
        id: (m.id !== undefined && m.id !== null) ? String(m.id) : null,
        url: m.url || null,
        ua: m.ua || null,
        source: m.source || 'browser',
        flags: m.flags || {},
        device: st.device || m.device || null,
        window: { targetSec: round(durationMs / 1000, 3), actualSec: (firstTs !== null && lastTs !== null) ? round((lastTs - firstTs) / 1000, 3) : null, frames, fpsWindowMs: windowMs, endedBy: m.endedBy || 'duration' },
        frames: mpwFrameMsStats(dts),
        fps: mpwFpsStats(dts, stamps, windowMs),
        render: {
          available: renderMs.length > 0,
          note: renderMs.length ? '渲染主体耗时（?perf=1 的 frameMs，包住 render 调用）' : '未开 ?perf=1 ⇒ 无渲染内部耗时；frames.ms 是**相邻帧间隔**（受 vsync/合成影响，不等于渲染开销）',
          n: renderMs.length,
          p50: round(mpwPercentile(renderMs, 0.5), BASELINE_UNITS.msRound),
          p95: round(mpwPercentile(renderMs, 0.95), BASELINE_UNITS.msRound),
          p99: round(mpwPercentile(renderMs, 0.99), BASELINE_UNITS.msRound),
          max: renderMs.length ? round(Math.max(...renderMs), BASELINE_UNITS.msRound) : null,
          mean: round(mpwMean(renderMs), BASELINE_UNITS.msRound),
        },
        startup,
        counts,
        vramProxy: vram,
        phases: m.phases || null,
        switch: null,
        notes,
      }
    },
    /** 只读内部量（测试/诊断用）。 */
    stats() { return { frames, firstTs, lastTs, readyTs, readyReason, readyFrame, texMissingLast, dts: dts.length } },
  }
}

// ─────────────────────────── 壁纸切换：阶段流转（跨导航） + 合并 ───────────────────────────

/**
 * **切换测量为什么是跨导航的**：`?id=` 换包在 demo.html 里没有"热切换"路径（换包 = 整页重载，
 * 与用户点插件换壁纸的真实代价同形）。所以流程是三次导航、用 `sessionStorage` 交接：
 *   ① `?id=A&baseline=1&baselineswap=B` → 测 A（role=primary）→ 存交接 → 跳 B
 *   ② `?id=B&baseline=1`                → 测 B（role=swapTo，它的 `startup.totalMs` 就是"切过去"的耗时）→ 跳回 A
 *   ③ `?id=A&baseline=1`                → 测 A（role=swapBack）→ 合并三阶段 → POST → 清交接
 * 本函数是这条流程的**唯一判据**（纯函数，`baseline-test` T4 把四档都钉住），调用方只负责执行。
 * @returns {{role:'primary'|'swapTo'|'swapBack'|'single'|'abort', navTo:string|null, final:boolean, saveHandoff:boolean, reason:string}}
 */
export function mpwBaselineNextStage(currentId, opts, handoff) {
  const id = (currentId === undefined || currentId === null) ? null : String(currentId)
  const swapId = (opts && opts.swapId) || null
  const h = handoff && typeof handoff === 'object' ? handoff : null
  if (!swapId) return { role: 'single', navTo: null, final: true, saveHandoff: false, reason: '未指定 ?baselineswap ⇒ 只测当前包' }
  if (!h || !Array.isArray(h.phases) || !h.phases.length) {
    // 自我导航护栏：**只在没有交接时**生效 —— 无交接 + `?baselineswap=<当前包>` 会让"跳过去" = 原地刷新
    // ⇒ 按单段处理（否则无限循环）。注意不能无条件拦：流程第 2 段本来就停在 swapId 这个包上。
    if (id !== null && swapId === id) return { role: 'single', navTo: null, final: true, saveHandoff: false, reason: '?baselineswap 指的就是当前包 ⇒ 不做切换测量（防自我导航）' }
    return { role: 'primary', navTo: swapId, final: false, saveHandoff: true, reason: '首段：测完当前包后切到 ' + swapId }
  }
  if (h.phases.length >= 2 && h.originId === id) {
    return { role: 'swapBack', navTo: null, final: true, saveHandoff: false, reason: '回到起点包 ⇒ 本段（含回切耗时）收尾并合并上报' }
  }
  if (h.swapId === id && h.phases.length === 1) {
    return { role: 'swapTo', navTo: h.originId, final: false, saveHandoff: false, reason: '已在目标包 ⇒ 测完切回起点包 ' + h.originId }
  }
  // 兜底：交接与当前页对不上（用户手改了 URL / sessionStorage 被清）⇒ 就地收尾，**绝不来回跳**（防死循环）
  return { role: 'abort', navTo: null, final: true, saveHandoff: false, reason: '交接与当前包对不上（本段就地收尾，不导航；避免来回跳）' }
}

/**
 * 合并三阶段为**一份**快照：指标取 `primary` 段（首段，最干净）；`switch` 两趟耗时取各自段的启动总耗时。
 * @param {object} handoff `{v,originId,swapId,startedAt,phases:[{role,snapshot}]}`
 * @param {object} finalSnapshot 末段（`swapBack`）刚采到的快照
 */
export function mpwBaselineMergeHandoff(handoff, finalSnapshot) {
  const h = handoff && typeof handoff === 'object' ? handoff : { phases: [] }
  const phases = Array.isArray(h.phases) ? h.phases.filter((p) => p && p.snapshot) : []
  const primary = phases.find((p) => p.role === 'primary')
  const swapTo = phases.find((p) => p.role === 'swapTo')
  const base = primary ? JSON.parse(JSON.stringify(primary.snapshot)) : JSON.parse(JSON.stringify(finalSnapshot || {}))
  const brief = (p) => (p && p.snapshot) ? {
    id: p.snapshot.id || null,
    role: p.role,
    totalMs: (p.snapshot.startup && p.snapshot.startup.totalMs !== undefined) ? p.snapshot.startup.totalMs : null,
    fpsMedian: (p.snapshot.fps && p.snapshot.fps.median !== undefined) ? p.snapshot.fps.median : null,
    framesP50: (p.snapshot.frames && p.snapshot.frames.p50 !== undefined) ? p.snapshot.frames.p50 : null,
  } : null
  base.phases = phases.map(brief).concat(finalSnapshot ? [brief({ role: 'swapBack', snapshot: finalSnapshot })] : [])
  const sw = (p) => (p && p.snapshot && p.snapshot.startup) ? p.snapshot.startup.totalMs : null
  base.switch = {
    note: '整页导航口径（换包 = 重新导航 + 建档 + 首帧 + 就绪）：swapTo/swapBack 各记一次；含上一页卸载耗时',
    swapTo: swapTo ? { id: (swapTo.snapshot && swapTo.snapshot.id) || null, ms: sw(swapTo), fpsMedian: swapTo.snapshot.fps ? swapTo.snapshot.fps.median : null, readyReason: swapTo.snapshot.startup ? swapTo.snapshot.startup.readyReason : null } : null,
    swapBack: finalSnapshot ? { id: finalSnapshot.id || null, ms: finalSnapshot.startup ? finalSnapshot.startup.totalMs : null, fpsMedian: finalSnapshot.fps ? finalSnapshot.fps.median : null, readyReason: finalSnapshot.startup ? finalSnapshot.startup.readyReason : null } : null,
  }
  base.at = (finalSnapshot && finalSnapshot.at) || base.at
  base.notes = (base.notes || []).concat(['切换耗时 = 三阶段导航口径（primary 指标取首段；swapTo/swapBack 只取启动总耗时）'])
  return base
}

// ─────────────────────────── 快照校验（服务端/脚本/测试共用） ───────────────────────────

/** 必填路径（点号路径 + 类型说明）。`baseline-diff` 用它拒绝残缺输入，避免"字段缺失当 0 比"。 */
export const BASELINE_REQUIRED = [
  ['kind', 'string'], ['schema', 'number'], ['at', 'string'], ['id', 'string'],
  ['window.frames', 'number'], ['frames.n', 'number'],
  ['fps.windowMs', 'number'], ['startup.totalMs', 'number'],
  ['counts.layers', 'number'], ['vramProxy.textureBytesEst', 'number'],
]
const dig = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object') ? a[k] : undefined, o)

/**
 * 校验快照：`{ok, errors[]}`。**故意不宽松**（缺字段 = 报错，不能当 0 参与对比）。
 * 另做两条语义检查：`window.frames` 必须 > 0；`schema` 必须等于 `BASELINE_SCHEMA`。
 */
export function mpwValidateSnapshot(o) {
  const errors = []
  if (!o || typeof o !== 'object') return { ok: false, errors: ['不是对象'] }
  for (const [p, t] of BASELINE_REQUIRED) {
    const v = dig(o, p)
    if (v === undefined || v === null) { errors.push('缺字段 ' + p); continue }
    if (t === 'number' && !Number.isFinite(Number(v))) errors.push(p + ' 不是有限数：' + JSON.stringify(v))
    if (t === 'string' && typeof v !== 'string') errors.push(p + ' 不是字符串：' + JSON.stringify(v))
  }
  if (Number.isFinite(Number(o.schema)) && Number(o.schema) !== BASELINE_SCHEMA) errors.push('schema=' + o.schema + ' ≠ 本工具支持的 ' + BASELINE_SCHEMA)
  if (Number.isFinite(Number(dig(o, 'window.frames'))) && Number(dig(o, 'window.frames')) <= 0) errors.push('window.frames ≤ 0（没有任何帧的采集不算快照）')
  return { ok: errors.length === 0, errors }
}

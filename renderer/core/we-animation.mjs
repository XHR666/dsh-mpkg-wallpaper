// core/we-animation.mjs —— WE 场景**属性动画**的唯一实现处（播放头 / 模式 / 求值 / 联动组）
//
// 为什么单列一个纯模块：属性动画此前散在两处、且都只有"半套语义"——
//   · `parseScene` 用 `extractAnimKf(propObj, fps = 30)` 收关键帧（**帧率硬编码 30**），
//   · 渲染期用 `animValueAt(ch, t)` 求值（**周期恒 = 末关键帧、恒定循环**），只接了
//     `origin`/`scale`/`visible` 三个载体，`alpha`（语料最常见的载体）**一格都没接**。
//   而 WE 的动画对象自带 `options.{fps,length,mode,startpaused}` 与 `relative`、`options.children/parent`
//   联动组：硬编码 30fps 会把 fps=60 的轨道播成 2 倍速（语料 214 条轨道里 56 条 fps≠30），
//   恒定循环会把 `mode:"single"` 的一次性淡入变成每秒重播，`startpaused:true`（90 条）则本该等脚本
//   `getAnimation().play()` 再走。语义与判据见 docs/PATCHES.md P-228l。
//
// 语义来源（行为对照，不复制代码）：
//   · `references/vendor-ref/webwallgl/renderer/vendor/we-scene/render/animation.js`
//     （上游 MIT © 2026 oneincase，`createAnimation`/`wrapFrame`/`sampleChannel`/`linkAnimations`/
//       `crossedEvents`；手柄语义由**全库 630 个段**反推：`front.x/back.x` 是「段长比例」、
//       `front.y/back.y` 是「相对端点的绝对增量」）
//   · 官方 d.ts `docs/extracts/official-extract/lib.sceneScript.d.ts` L1568+ `interface IAnimation`
//     （play/pause/stop/isPlaying/getFrame/setFrame/rate/fps/frameCount/duration/addEndedCallback）
//
// 本模块**无依赖、无副作用**：不读 canvas/GL/DOM，不写任何全局。宿主（core/we-scene-bundle.js 的
// 渲染循环 + demo.html 的帧循环 + elysia/scene-scripts.js 的脚本门面）只做接线。

/** 通道名：语料 100% 连续（c0…cN 无空洞），最多见过 c3。 */
const CHANNEL_NAMES = ['c0', 'c1', 'c2', 'c3']

/** 三次贝塞尔的一维分量。 */
function bez1(p0, p1, p2, p3, t) {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/**
 * 已知 x 求参数 t（贝塞尔的 x 不等于 t —— 手柄长度不是 1/3 时差得很远）。
 * Newton 迭代为主、二分兜底：x(t) 在手柄合法时单调，但工坊数据里存在手柄超长导致的非单调段，
 * Newton 会跑飞（对照实现同款处理）。
 */
function solveT(x0, x1, x2, x3, x) {
  if (x <= x0) return 0
  if (x >= x3) return 1
  let t = x3 - x0 > 1e-9 ? (x - x0) / (x3 - x0) : 0.5
  for (let i = 0; i < 8; i++) {
    const cur = bez1(x0, x1, x2, x3, t) - x
    if (Math.abs(cur) < 1e-6) return t
    const u = 1 - t
    const d = 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2)
    if (Math.abs(d) < 1e-9) break
    const nt = t - cur / d
    if (nt < 0 || nt > 1 || !Number.isFinite(nt)) break
    t = nt
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    t = (lo + hi) / 2
    if (bez1(x0, x1, x2, x3, t) < x) lo = t
    else hi = t
  }
  return t
}

/** 一条通道的关键帧：过滤非法项、按 frame 升序、只留 {frame,value,front,back}。无有效帧返回 null。 */
export function animChannelKeys(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const out = []
  for (const k of raw) {
    if (!k || typeof k !== 'object') continue
    const frame = Number(k.frame)
    const value = Number(k.value)
    if (!Number.isFinite(frame) || !Number.isFinite(value)) continue
    out.push({ frame, value, front: k.front || null, back: k.back || null })
  }
  if (!out.length) return null
  out.sort((a, b) => a.frame - b.frame)
  return out
}

/**
 * 读一条动画定义（scene.json 里某个属性上的 `{value?, animation:{c0..cN, options, relative}}`）。
 * 返回 null = 不是动画对象（调用方回落静态值）。**不丢字段**：name/parent/children/events 都读出来。
 */
export function readAnimDef(def) {
  if (!def || typeof def !== 'object') return null
  const a = def.animation
  if (!a || typeof a !== 'object') return null
  const opts = (a.options && typeof a.options === 'object') ? a.options : {}
  /* 通道 = `c0..cN` 的**连续前缀**（实测 100% 连续、无空洞；对照实现同款取法）。
     不能"过滤掉缺失项再压紧"：`channels[i] ↔ c{i}` 的位序就是渲染侧的 x/y/z 映射，
     压紧会把「只缺 c1」的轨道错位成 x=c0 / y=c2（静默画错轴）。 */
  const channels = []
  for (const name of CHANNEL_NAMES) {
    const keys = animChannelKeys(a[name])
    if (!keys) break
    channels.push(keys)
  }
  if (!channels.length) return null
  const lenRaw = Number(opts.length)
  const fpsRaw = Number(opts.fps)
  const modeRaw = String(opts.mode || 'single')
  const events = Array.isArray(opts.events)
    ? opts.events
      .filter((e) => e && Number.isFinite(Number(e.frame)) && typeof e.name === 'string')
      .map((e) => ({ frame: Number(e.frame), name: e.name }))
    : []
  return {
    fps: Number.isFinite(fpsRaw) && fpsRaw > 0 ? fpsRaw : 30,
    length: Number.isFinite(lenRaw) && lenRaw > 0 ? lenRaw : 0,
    mode: modeRaw === 'loop' || modeRaw === 'mirror' ? modeRaw : 'single',   // 未知值 → single（官方枚举只有三种）
    relative: a.relative === true,
    wraploop: opts.wraploop === true,
    startpaused: opts.startpaused === true,
    name: typeof opts.name === 'string' ? opts.name : '',
    channels,
    /** 通道数 = c0..cN 连续个数（值() 的返回形状由它决定：1 → 标量，>1 → 数组） */
    channelCount: channels.length,
    events,
    parentKey: opts.parent && typeof opts.parent.key === 'string' ? opts.parent.key : null,
    childKeys: Array.isArray(opts.children) ? opts.children.map((c) => (c && typeof c.key === 'string' ? c.key : null)).filter(Boolean) : [],
  }
}

/**
 * 把播放头帧号按 mode 折进 [0, length]（loop 环绕、mirror 折返、single 原样夹到 [0,length]）。
 * length ≤ 0（语料 0 处）⇒ 原样返回，调用方按末关键帧钳值。
 */
export function wrapAnimFrame(frame, length, mode) {
  const len = Number(length) > 0 ? Number(length) : 0
  const f = Number(frame) || 0
  if (!len) return f
  if (mode === 'loop') {
    const m = f % len
    return m < 0 ? m + len : m
  }
  if (mode === 'mirror') {
    const period = len * 2
    let m = f % period
    if (m < 0) m += period
    return m <= len ? m : period - m
  }
  return f < 0 ? 0 : (f > len ? len : f)
}

/**
 * 在一条通道上按帧号求值。`wrap = {length}`（loop + wraploop）时末关键帧之后平滑接到首帧。
 * 手柄语义（对照实现由全库 630 段反推）：
 *   P1 = (f0 + min(|front.x|,1.5)·span/3, v0 + front.y)
 *   P2 = (f1 − min(|back.x|,1.5)·span/3, v1 + back.y)
 * `enabled:false` 的一侧落回弦上的三等分点（该侧线性）。
 */
export function sampleAnimChannel(keys, frame, wrap) {
  if (!keys || !keys.length) return 0
  if (keys.length === 1) return keys[0].value
  if (wrap && Number(wrap.length) > 0) {
    const first = keys[0]
    const last = keys[keys.length - 1]
    const span = Number(wrap.length) - last.frame
    if (span > 1e-9 && frame > last.frame && frame <= Number(wrap.length)) {
      return sampleAnimChannel([
        { frame: 0, value: last.value, front: last.front, back: last.back },
        { frame: span, value: first.value, front: first.front, back: first.back },
      ], frame - last.frame)
    }
  }
  if (frame <= keys[0].frame) return keys[0].value
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return last.value
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid].frame <= frame) lo = mid
    else hi = mid
  }
  const k0 = keys[lo]
  const k1 = keys[hi]
  const span = k1.frame - k0.frame
  if (span <= 0) return k1.value
  const fr = k0.front
  const bk = k1.back
  const third = span / 3
  const frOn = !!(fr && fr.enabled)
  const bkOn = !!(bk && bk.enabled)
  const fx = frOn ? Math.abs(Number(fr.x) || 0) : 1
  const bx = bkOn ? Math.abs(Number(bk.x) || 0) : 1
  const x1 = k0.frame + Math.min(fx, 1.5) * third
  const x2 = k1.frame - Math.min(bx, 1.5) * third
  const y1 = frOn ? k0.value + (Number(fr.y) || 0) : k0.value + (k1.value - k0.value) / 3
  const y2 = bkOn ? k1.value + (Number(bk.y) || 0) : k1.value - (k1.value - k0.value) / 3
  const t = solveT(k0.frame, x1, x2, k1.frame, frame)
  return bez1(k0.value, y1, y2, k1.value, t)
}

/** 基准值归一成数组（标量 / 数组 / scene.json 的 `"x y z"` 字符串）。 */
export function animBaseNumeric(base) {
  if (Array.isArray(base)) return base.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
  if (typeof base === 'string') return base.trim().split(/\s+/).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
  if (Number.isFinite(Number(base))) return [Number(base)]
  return []
}

/**
 * 播放头越过关键帧事件的检测（advance 内调用；`setFrame` 不产生事件）。
 * 半开区间：前进 `prev < f ≤ cur`、后退 `cur ≤ f < prev`。loop 按周期展开、mirror 双周期。
 * 语料只有 1 个包（0923/2887099508）带 `options.events`，4 条。
 */
export function crossedEvents(events, prev, cur, length, mode) {
  if (!events || !events.length || prev === cur) return []
  const forward = cur > prev
  const len = Number(length) > 0 ? Number(length) : 1
  const hits = []
  if (mode === 'single') {
    for (const e of events) if (forward ? (e.frame > prev && e.frame <= cur) : (e.frame >= cur && e.frame < prev)) hits.push({ at: e.frame, e })
  } else if (mode === 'loop') {
    const kMin = Math.floor(Math.min(prev, cur) / len)
    const kMax = Math.floor(Math.max(prev, cur) / len)
    for (let k = kMin; k <= kMax; k++) {
      for (const e of events) {
        const at = k * len + e.frame
        if (forward ? (at > prev && at <= cur) : (at >= cur && at < prev)) hits.push({ at, e })
      }
    }
  } else {
    const period = len * 2
    const kMin = Math.floor(Math.min(prev, cur) / period)
    const kMax = Math.floor(Math.max(prev, cur) / period)
    for (let k = kMin; k <= kMax; k++) {
      for (const e of events) {
        const at1 = k * period + e.frame
        const at2 = k * period + 2 * len - e.frame
        for (const at of (at1 === at2 ? [at1] : [at1, at2])) {
          if (forward ? (at > prev && at <= cur) : (at >= cur && at < prev)) hits.push({ at, e })
        }
      }
    }
  }
  hits.sort((a, b) => (forward ? a.at - b.at : b.at - a.at))
  return hits.map((h) => h.e)
}

/**
 * 建一条动画的播放控制器（官方 IAnimation 的运行期内核）。
 * 关键点：
 *   · **advance 语义**（按 dt 推进播放头），不是"把场景时钟钉进求值"——脚本 `play()/rate/setFrame`
 *     才跑得起来（钉时间会每帧把播放头拉回场景时钟）；
 *   · `startpaused:true` ⇒ 初始 `playing=false`，播放头停 0，**值照常施加**（= 官方"停帧 0"）；
 *   · `mode:"single"` 到 `length` 就停（置 ended + 回调），不重播；
 *   · `relative:true` ⇒ `applyTo(base)` = 基准 + 动画值（基准必须是**冻结的初始快照**，不能写回）；
 *   · 联动组：`options.parent.key` 的 child 用 **leader 的播放头**采样自己的通道（child 不自己推进）。
 * @param {object} def `readAnimDef()` 的返回
 * @param {object} [opts] `{ base }` 基准值（标量/数组/"x y z"）
 */
export function createAnimation(def, opts = {}) {
  const d = def || readAnimDef(null)
  const anim = {
    name: d && d.name || '',
    mode: (d && d.mode) || 'single',
    fps: (d && d.fps) || 30,
    relative: !!(d && d.relative),
    wraploop: !!(d && d.wraploop),
    channelCount: (d && d.channelCount) || 0,
    parentKey: (d && d.parentKey) || null,
    childKeys: (d && d.childKeys) || [],
    parent: null,
    frame: 0,
    baseNumeric: animBaseNumeric(opts.base),
    playing: !(d && d.startpaused),
    rate: 1,
    ended: false,
    _channels: (d && d.channels) || [],
    _events: (d && d.events) || [],
    _eventQueue: [],
    _endedCallbacks: [],
    get frameCount() { return (d && d.length) || 0 },
    get duration() { return this.frameCount > 0 ? this.frameCount / (anim.fps || 30) : 0 },
  }
  /** 播放头（联动 child 用 leader 的） */
  anim.playhead = () => (anim.parent ? anim.parent.frame : anim.frame)
  anim.play = () => { if (anim.parent) return anim.parent.play(); anim.playing = true; anim.ended = false; return anim }
  anim.pause = () => { if (anim.parent) return anim.parent.pause(); anim.playing = false; return anim }
  anim.stop = () => { if (anim.parent) return anim.parent.stop(); anim.playing = false; anim.frame = 0; anim.ended = false; return anim }
  anim.setFrame = (f) => { if (anim.parent) return anim.parent.setFrame(f); const n = Number(f); if (Number.isFinite(n)) anim.frame = n; return anim }
  anim.getFrame = () => anim.playhead()
  anim.setRate = (r) => { if (anim.parent) return anim.parent.setRate(r); const n = Number(r); if (Number.isFinite(n)) anim.rate = n; return anim }
  anim.isPlaying = () => (anim.parent ? anim.parent.playing : anim.playing)
  anim.addEndedCallback = (fn) => { if (anim.parent) return anim.parent.addEndedCallback(fn); if (typeof fn === 'function') anim._endedCallbacks.push(fn); return anim }
  /** 当前值：1 通道 → 标量；多通道 → 数组；无通道 → null。 */
  anim.value = () => {
    const chans = anim._channels
    if (!chans.length) return null
    const f = wrapAnimFrame(anim.playhead(), anim.frameCount, anim.mode)
    const wrap = anim.wraploop && anim.mode === 'loop' && anim.frameCount > 0 ? { length: anim.frameCount } : null
    if (chans.length === 1) return sampleAnimChannel(chans[0], f, wrap)
    return chans.map((c) => sampleAnimChannel(c, f, wrap))
  }
  /**
   * 施加到基准值：`relative` ⇒ 逐分量 基准 + 动画值；否则直接取动画值。
   * ⚠ 调用方必须传**冻结的初始快照**（写回自身会变成逐帧积分）。
   */
  anim.applyTo = (base) => {
    const v = anim.value()
    if (v === null) return null
    if (!anim.relative) return v
    const b = animBaseNumeric(base)
    if (Array.isArray(v)) return v.map((x, i) => x + (Number(b[i]) || 0))
    return v + (Number(b[0]) || 0)
  }
  /** 推进播放头。dt 单位秒；not playing 或联动 child ⇒ 不动。 */
  anim.advance = (dt) => {
    if (anim.parent) return 0
    if (!anim.playing) return 0
    const prev = anim.frame
    anim.frame += (Number(dt) || 0) * anim.fps * anim.rate
    const len = anim.frameCount
    if (anim.mode === 'single' && len > 0) {
      if (anim.frame >= len) {
        anim.frame = len
        anim.playing = false
        if (!anim.ended) {
          anim.ended = true
          for (const cb of anim._endedCallbacks) { try { cb() } catch (e) { /* 回调抛错不拖垮渲染 */ } }
        }
      } else if (anim.frame < 0) {
        anim.frame = 0
        anim.playing = false
      }
    }
    const evs = crossedEvents(anim._events, prev, anim.frame, len, anim.mode)
    for (const e of evs) anim._eventQueue.push(e)
    return evs.length
  }
  anim.takeEvents = () => { if (!anim._eventQueue.length) return []; const out = anim._eventQueue.slice(); anim._eventQueue.length = 0; return out }
  return anim
}

/**
 * 联动组接线：`options.parent.key` 指向**同作用域**里另一条动画的 key ⇒ child.parent = leader。
 * 悬空 parent / 自指 / 多级 parent 不链接（记一条诊断），退化为独立动画。
 * @param {Map<string,object>|object} siblings key → 控制器
 */
export function linkAnimations(siblings, onDiag) {
  const map = siblings instanceof Map ? siblings : new Map(Object.entries(siblings || {}))
  for (const [key, ctrl] of map) {
    if (!ctrl || !ctrl.parentKey) continue
    const leader = map.get(ctrl.parentKey)
    if (!leader || leader === ctrl) { if (onDiag) onDiag(`动画联动 parent 悬空（退化为独立）：${key} -> ${ctrl.parentKey}`); continue }
    if (leader.parentKey) { if (onDiag) onDiag(`动画联动多级 parent（不支持，退化为独立）：${key} -> ${ctrl.parentKey}`); continue }
    ctrl.parent = leader
  }
  return map
}

/**
 * 逐条推进（联动 child 由 `advance` 自行跳过）。返回**播放头真的动了**的条数
 * （不能用 `advance()` 的返回值计数：它返回的是"越过的帧事件数"，没有事件的轨道恒 0）。
 */
export function advanceAnimations(ctrls, dt) {
  let n = 0
  if (!ctrls || !dt) return 0
  for (const c of ctrls) {
    if (!c || c.parent) continue
    const before = c.frame
    c.advance(dt)
    if (c.frame !== before) n++
  }
  return n
}

/**
 * 把五条**层载体**（alpha/visible/origin/scale/angles）的当前值写回目标对象（渲染层 = `layer`）。
 *
 * 为什么"写回"而不是在每个采样点各算一遍：这五个载体的消费点分散（合成 color4、`g_UserAlpha`/`g_Alpha`
 * uniform、粒子 `alphaMul`、蒙皮 mesh 世界矩阵、命中矩形、绘制门），写回 = 与"脚本属性写回"
 * （`syncScriptOrigins`）同一口径 ⇒ 不会出现"某处接了、某处没接"的半套语义。
 *
 * 三条硬约束（判据 `tests/anim-semantics-test.mjs` 逐条钉死）：
 *   1. 基准由调用方传**冻结快照**（`base`）⇒ `relative:true` 的动画不会逐帧积分；
 *   2. y 翻转：scene.json 的 origin 是编辑器 y-up，渲染层是 y-down（`projH − y`）⇒ 绝对关键帧的 y
 *      要翻转、`relative` 增量要**取负**（否则动画方向上下颠倒）；
 *   3. 单通道动画只写对应的那一个分量（c0→x、c1→y、c2→z），其余保持基准 —— 与 legacy 路径
 *      `ox = animValueAt(c0) ?? ox` 同口径。
 *
 * @param {object} target 渲染层对象（读/写 alpha/visible/origin/scale/angles）
 * @param {object} ctrls `{field: 控制器}`（解析期建好，见 `createAnimation`）
 * @param {object} base 冻结的基准快照 `{field: 值}`（标量 / 数组 / "x y z"）
 * @param {object} [opts] `{ projH }` = 编辑器 y-up → 渲染 y-down 的翻转基准（缺省不翻转）
 * @returns {string[]} 本次实际写过的字段名（诊断用；空数组 = 一条都没写）
 */
export function applyAnimsToLayer(target, ctrls, base, opts = {}) {
  if (!target || !ctrls) return []
  const b = base || {}
  const H = Number(opts.projH)
  const wrote = []
  if (ctrls.alpha) {
    const v = ctrls.alpha.applyTo(b.alpha)
    if (Number.isFinite(v)) { target.alpha = Math.max(0, Math.min(1, v)); wrote.push('alpha') }
  }
  if (ctrls.visible) {
    const v = ctrls.visible.applyTo(b.visible)
    if (Number.isFinite(v)) { target.visible = v > 0.5; wrote.push('visible') }
  }
  if (ctrls.origin && target.origin) {
    const v = ctrls.origin.applyTo(b.origin)
    if (Array.isArray(v)) {
      target.origin[0] = v[0]
      if (ctrls.origin.relative) {
        // 编辑器 y-up 的**增量**：渲染 y-down ⇒ 取负（基准是渲染空间的冻结快照）
        const by = Number(animBaseNumeric(b.origin)[1]) || 0
        target.origin[1] = by - (v[1] - by)
      } else {
        target.origin[1] = Number.isFinite(H) ? H - v[1] : v[1]
      }
      if (v.length > 2) target.origin[2] = v[2]
      wrote.push('origin')
    } else if (Number.isFinite(v)) { target.origin[0] = v; wrote.push('origin') }
  }
  if (ctrls.scale && target.scale) {
    const v = ctrls.scale.applyTo(b.scale)
    if (Array.isArray(v)) { for (let i = 0; i < v.length && i < 3; i++) target.scale[i] = v[i]; wrote.push('scale') }
    else if (Number.isFinite(v)) { target.scale[0] = v; wrote.push('scale') }
  }
  if (ctrls.angles && target.angles) {
    const v = ctrls.angles.applyTo(b.angles)
    if (Array.isArray(v)) { for (let i = 0; i < v.length && i < 3; i++) target.angles[i] = v[i]; wrote.push('angles') }
    else if (Number.isFinite(v)) { target.angles[0] = v; wrote.push('angles') }
  }
  return wrote
}

/** 诊断行（`?anim=1` 的台账用它；不泄露包数据，只有语义读数）。 */
export function animDiag(ctrl) {
  if (!ctrl) return null
  const v = ctrl.value()
  return {
    name: ctrl.name, mode: ctrl.mode, fps: ctrl.fps, relative: ctrl.relative,
    length: ctrl.frameCount, duration: ctrl.duration,
    frame: +Number(ctrl.playhead()).toFixed(4), playing: !!ctrl.isPlaying(), rate: ctrl.rate, ended: !!ctrl.ended,
    linked: !!ctrl.parent, value: Array.isArray(v) ? v.map((x) => +Number(x).toFixed(4)) : (v === null ? null : +Number(v).toFixed(4)),
    base: ctrl.baseNumeric.slice(0, 3),
  }
}

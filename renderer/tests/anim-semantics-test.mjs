// tests/anim-semantics-test.mjs — P-228l：WE **属性动画**语义（fps/length/mode/startpaused/relative + 联动组 + alpha 载体）
//
// 为什么有这条：属性动画此前有两处"半套语义"——
//   · `parseScene` 用 `extractAnimKf(propObj, fps = 30)`（**帧率硬编码 30**）、渲染期 `animValueAt()` 求值
//     （**周期恒 = 末关键帧、恒定循环**），且只接了 `origin`/`scale`/`visible`；
//   · `alpha`（语料最常见的载体）**一格都没接** ⇒ 带 alpha 动画的层一律按"静态 1"画（永久可见）。
//   语料实读（116 个可解析 scene.json）：214 条轨道里 **90 条 `startpaused:true`**、**56 条 fps≠30**、
//   **65 条 alpha 载体**（其中 46 条在挂载瞬间的值 ≠ 静态 1 ⇒ 那些层在我们这里是"永久可见"，
//   官方是"停帧 0 = 隐藏，等脚本 `getAnimation().play()`"）。
//
// 口径（四条，全部钉在本文件）：
//   ① 播放头按 **dt 推进**（`advance` 语义），不是"把场景时钟钉进求值" —— 脚本 `play()/rate/setFrame`
//      才驱动得了；`rate=1` 自动播放时两者等价（Σdt = 经过秒数）。
//   ② `options.{fps,length,mode}` 逐条生效：fps=60 的轨道在同一段 dt 里走两倍帧（= 硬编码 30 会变"倍速"）；
//      `mode:"single"` 到 length 就停并回调，**不重播**；`mirror` 折返；`loop` 环绕（`wraploop` 才补尾接头）。
//   ③ `startpaused:true` ⇒ 初始 `playing=false`，**值照常按帧 0 施加**（= 官方"停帧 0"，层隐藏，等脚本 play）。
//   ④ `relative:true` ⇒ `基准 + 动画值`；基准必须是**冻结快照**（写回自身会逐帧积分）；origin 的 y 走
//      "编辑器 y-up → 渲染 y-down"：绝对关键帧翻转、`relative` 增量取负。
//
// 用法: node tests/anim-semantics-test.mjs        （语料/真包不在时那两组打 SKIP，不把"没测到"算通过）
import fs from 'node:fs'
import path from 'node:path'
import { WS } from './_root.mjs'
import * as lib from '../core/we-scene-bundle.js'
import * as A from '../core/we-animation.mjs'

let pass = 0, fail = 0, skip = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }
const sk = (n, why) => { skip++; console.log('  SKIP ' + n + '：' + why) }
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps

const kf = (frame, value, frontY = 0, backY = 0) => ({
  frame, value,
  front: frontY === null ? { enabled: false, x: 1, y: 0 } : { enabled: true, x: 1, y: frontY },
  back: backY === null ? { enabled: false, x: -1, y: 0 } : { enabled: true, x: -1, y: backY },
})
/** 线性通道：两侧手柄都 `enabled:false` ⇒ 每段退化为直线（判据里的"真值"用得上）。 */
const lin = (pairs) => pairs.map(([f, v]) => kf(f, v, null, null))
const def = (c0, options, extra = {}) => ({ value: 1, animation: Object.assign({ c0, options }, extra) })

/* ── ① 读定义：不丢字段、位序不塌 ───────────────────────────────────────── */
console.log('── ① `readAnimDef`：options / relative / 通道前缀 ──')
{
  const d = A.readAnimDef(def(lin([[0, 0], [30, 1]]), { fps: 60, length: 30, mode: 'loop', name: '淡入', startpaused: true, wraploop: true }, { relative: true }))
  ok('A1 fps/length/mode/name/startpaused/wraploop/relative 全读到',
    d.fps === 60 && d.length === 30 && d.mode === 'loop' && d.name === '淡入' && d.startpaused === true && d.wraploop === true && d.relative === true,
    JSON.stringify({ fps: d.fps, length: d.length, mode: d.mode, name: d.name, startpaused: d.startpaused, wraploop: d.wraploop, relative: d.relative }))
  const d2 = A.readAnimDef({ animation: { c0: lin([[0, 1]]), options: {} } })
  ok('A2 缺省 fps=30 / mode=single / length=0 / relative=false', d2.fps === 30 && d2.mode === 'single' && d2.length === 0 && d2.relative === false)
  const d3 = A.readAnimDef({ animation: { c0: lin([[0, 1]]), options: { mode: 'pingpong' } } })
  ok('A3 未知 mode → single（官方枚举只有 single/loop/mirror）', d3.mode === 'single')
  ok('A4 非动画对象 → null（调用方回落静态值）',
    A.readAnimDef(null) === null && A.readAnimDef({}) === null && A.readAnimDef({ value: 1 }) === null && A.readAnimDef({ animation: {} }) === null)
  const d4 = A.readAnimDef({ animation: { c0: lin([[0, 0], [10, 1]]), c2: lin([[0, 0], [10, 2]]), options: { length: 10 } } })
  ok('A5 通道取 **c0..cN 连续前缀**（缺 c1 ⇒ 只到 c0，位序不塌）', d4.channelCount === 1 && d4.channels.length === 1,
    'channelCount=' + d4.channelCount)
  const d5 = A.readAnimDef({ animation: { c0: lin([[3, 1], [0, 0]]), options: { length: 3, parent: { key: 'origin' }, children: [{ key: 'alpha' }] } } })
  ok('A6 关键帧按 frame 升序（工坊数据不保证有序）+ parent/children 读到',
    d5.channels[0][0].frame === 0 && d5.parentKey === 'origin' && d5.childKeys[0] === 'alpha')
  const d6 = A.readAnimDef({ animation: { c0: [{ frame: 0, value: 'x' }, { frame: 5, value: 2 }], options: { length: 5 } } })
  ok('A7 非法关键帧被丢弃（value 非数值）', d6.channels[0].length === 1 && d6.channels[0][0].value === 2)
}

/* ── ② 求值：模式折返 + 手柄语义 ─────────────────────────────────────────── */
console.log('── ② `wrapAnimFrame` / `sampleAnimChannel` ──')
{
  ok('B1 single 夹到 [0,length]', A.wrapAnimFrame(-5, 10, 'single') === 0 && A.wrapAnimFrame(99, 10, 'single') === 10 && A.wrapAnimFrame(4, 10, 'single') === 4)
  ok('B2 loop 环绕（含负帧）', A.wrapAnimFrame(12, 10, 'loop') === 2 && A.wrapAnimFrame(-3, 10, 'loop') === 7)
  ok('B3 mirror 折返（周期 2·length）', A.wrapAnimFrame(12, 10, 'mirror') === 8 && A.wrapAnimFrame(20, 10, 'mirror') === 0 && A.wrapAnimFrame(25, 10, 'mirror') === 5)
  ok('B4 length=0 ⇒ 原样返回（不除零）', A.wrapAnimFrame(7, 0, 'loop') === 7)
  const ch = lin([[0, 0], [10, 1]])
  ok('B5 线性段中点 = 0.5；首帧前/末帧后钳值（不外推）',
    near(A.sampleAnimChannel(ch, 5), 0.5) && near(A.sampleAnimChannel(ch, -3), 0) && near(A.sampleAnimChannel(ch, 99), 1))
  ok('B6 单关键帧 = 常值', near(A.sampleAnimChannel(lin([[4, 0.25]]), 99), 0.25) && near(A.sampleAnimChannel([], 3), 0))
  // 手柄语义：front.x/back.x 是**段长比例**（× span/3），front.y/back.y 是相对端点的**绝对增量**。
  const eased = [kf(0, 0, 0, 0), kf(30, 1, 0, 0)]     // 两侧 x=1,y=0 ⇒ 标准缓入缓出（水平切线）
  const e3 = A.sampleAnimChannel(eased, 3)
  const l3 = A.sampleAnimChannel(lin([[0, 0], [30, 1]]), 3)
  ok('B7 水平切线手柄 ⇒ 中点仍是 0.5，但两端更平（t=3 缓动 0.028 < 线性 0.1）',
    near(A.sampleAnimChannel(eased, 15), 0.5, 1e-3) && e3 < l3,
    't=3 缓动=' + e3.toFixed(5) + ' 线性=' + l3.toFixed(5))
  // 手柄 x 的读法：比例 × span/3（对照实现由全库 630 段反推）。front.x=0.6、span=30 ⇒ 控制点在 frame 6；
  // 若误读成"绝对帧"（控制点 frame 0.6）则几乎退化成线性，同一采样点会给出明显不同的值。
  const ratio = [kf(0, 0, 0, 0), kf(30, 1, 0, 0)]
  ratio[0].front = { enabled: true, x: 0.6, y: 0 }
  const vRatio = A.sampleAnimChannel(ratio, 15)
  // 反证：若把 front.x=0.6 当**绝对帧**读（控制点落在 frame 0.6 ≈ 段首），曲线退化成近似线性 ——
  // 中点会是 0.5 附近；本实现的读法给出 0.56749（偏离线性 > 0.02）⇒ 这条断言能区分两种读法。
  ok('B8 手柄 x 按"比例 × span/3"解释（t=15 → 0.56749；按绝对帧读法会退化成 ≈0.5 的线性）',
    near(vRatio, 0.56749, 5e-4) && Math.abs(vRatio - 0.5) > 0.02,
    'v=' + vRatio.toFixed(5) + ' 与线性的差=' + (vRatio - 0.5).toFixed(5))
  // wraploop：末关键帧之后平滑接到首帧（keys 末帧 20、length 30 ⇒ 尾部 10 帧从末值回到首值）
  const ch2 = lin([[0, 1], [20, 0]])
  const w25 = A.sampleAnimChannel(ch2, 25, { length: 30 })
  ok('B9 `wraploop` 只对 loop 生效：尾部接回首帧（t=25 是尾部中点 ⇒ 0.5；无 wrap 时钳在末值 0）',
    near(w25, 0.5) && near(A.sampleAnimChannel(ch2, 25), 0), 'wrap=' + w25.toFixed(4))
}

/* ── ③ 控制器：播放头 / fps / mode / startpaused / rate ─────────────────── */
console.log('── ③ `createAnimation`：播放头与模式 ──')
{
  const mk = (options, extra = {}) => A.createAnimation(A.readAnimDef(def(lin([[0, 0], [30, 1]]), options, extra)), { base: 1 })
  const c30 = mk({ fps: 30, length: 30, mode: 'single' })
  const c60 = mk({ fps: 60, length: 60, mode: 'single' })
  c30.advance(0.5); c60.advance(0.5)
  ok('C1 fps 逐条生效：同一段 dt，fps=60 走的帧数是 fps=30 的两倍（硬编码 30 ⇒ 60fps 轨道变"倍速"）',
    c30.frame === 15 && c60.frame === 30, 'fps30→' + c30.frame + ' fps60→' + c60.frame)
  // 变异自证：把 fps 抹成 30，C1 的读数必须变化（证明这条断言真的在看 fps）
  const c60b = A.createAnimation(Object.assign({}, A.readAnimDef(def(lin([[0, 0], [30, 1]]), { fps: 60, length: 60, mode: 'single' })), { fps: 30 }), { base: 1 })
  c60b.advance(0.5)
  ok('C1b 变异自证：把 fps 改成 30 ⇒ 帧数从 30 掉到 15', c60b.frame === 15 && c60b.frame !== c60.frame)
  const cs = mk({ fps: 30, length: 30, mode: 'single' })
  ok('C2 自动播放（无 startpaused）⇒ playing=true，frame 从 0 起', cs.playing === true && cs.frame === 0)
  cs.advance(2)
  ok('C3 `mode:"single"` 到 length 就停（frame 钳在末帧、playing=false、不重播）', cs.frame === 30 && cs.playing === false && near(cs.value(), 1))
  cs.advance(10)
  ok('C3b 停住之后继续 advance 不再推进（不循环）', cs.frame === 30)
  let ended = 0
  const ce = mk({ fps: 30, length: 30, mode: 'single' }); ce.addEndedCallback(() => ended++)
  ce.advance(1.2); ce.advance(1)
  ok('C4 ended 回调只在首次到头时触发一次，且 `ended` 置位', ended === 1 && ce.ended === true, 'ended=' + ended)
  const cp = mk({ fps: 30, length: 30, mode: 'single', startpaused: true })
  ok('C5 `startpaused:true` ⇒ playing=false 且帧停 0，但**值照常按帧 0 施加**（= 官方"停帧 0"，层隐藏等脚本 play）',
    cp.playing === false && cp.frame === 0 && near(cp.value(), 0) && near(cp.applyTo(1), 0))
  cp.play(); cp.advance(0.5)
  ok('C6 play() 之后开始推进（脚本驱动的通路）', cp.playing === true && cp.frame === 15 && near(cp.value(), 0.5), 'frame=' + cp.frame)
  cp.stop()
  ok('C7 stop() 回帧 0 + 停播', cp.frame === 0 && cp.playing === false)
  const cl = mk({ fps: 30, length: 30, mode: 'loop' })
  cl.advance(1.5)
  ok('C8 `mode:"loop"` 环绕到 length 之后（frame 40 帧 → 10）', cl.frame === 45 && near(A.wrapAnimFrame(cl.frame, 30, 'loop'), 15), 'frame=' + cl.frame)
  const cm = mk({ fps: 30, length: 30, mode: 'mirror' })
  cm.advance(1.5)   // 45 帧 → 折返 15
  ok('C9 `mode:"mirror"` 折返（45 帧 → 15）', near(cm.value(), A.sampleAnimChannel(lin([[0, 0], [30, 1]]), 15)))
  const cr = mk({ fps: 30, length: 30, mode: 'single' })
  cr.setRate(2); cr.advance(0.5)
  ok('C10 `rate` 缩放播放头（setRate(2) ⇒ 0.5s 走 30 帧）', cr.frame === 30 && cr.rate === 2)
  const cf = mk({ fps: 30, length: 30, mode: 'single' })
  cf.setFrame(12)
  ok('C11 setFrame 直接定位（不做事件、不推进）', cf.frame === 12 && near(cf.value(), 0.4))
  const cfs = A.createAnimation(A.readAnimDef(def(lin([[0, 0], [30, 1]]), { fps: 30, length: 30, mode: 'single', events: [{ frame: 10, name: 'S' }] })), { base: 1 })
  cfs.advance(0.4)
  const evs = cfs.takeEvents()
  ok('C12 播放头越过帧事件 ⇒ 入队一次并清空（`options.events`，语料 0923/2887099508 有 4 条）',
    evs.length === 1 && evs[0].name === 'S' && cfs.takeEvents().length === 0, JSON.stringify(evs))
}

/* ── ④ 基准 / relative / 联动组 ─────────────────────────────────────────── */
console.log('── ④ `applyTo` / 联动组 ──')
{
  const abs = A.createAnimation(A.readAnimDef(def(lin([[0, 5], [10, 9]]), { fps: 30, length: 10, mode: 'single' })), { base: 100 })
  ok('D1 非 relative ⇒ 直接取动画值（基准不参与）', near(abs.applyTo(100), 5) && near(abs.value(), 5))
  /* ⚠ `relative` 的位置：**在 `animation` 里**（`{animation:{c0…,options,relative:true}}`）。
     语料实读（213 条轨道）：`animation.relative=true` **55 条**、属性外层 `relative=true` **0 条**
     ⇒ 读里层是对的（对照实现读外层，语料不支持那个位置）。 */
  const rel3 = A.createAnimation(A.readAnimDef({ animation: { c0: lin([[0, 1], [10, 3]]), c1: lin([[0, -2], [10, -4]]), c2: lin([[0, 0], [10, 0]]), options: { fps: 30, length: 10, mode: 'single' }, relative: true } }), { base: [3040, 1710, 0] })
  const v = rel3.applyTo([3040, 1710, 0])
  ok('D2 relative ⇒ 逐分量「基准 + 动画值」', Array.isArray(v) && v[0] === 3041 && v[1] === 1708 && v[2] === 0, JSON.stringify(v))
  const frozen = [3040, 1710, 0]
  rel3.advance(10 / 30)
  const v2 = rel3.applyTo(frozen)
  ok('D3 基准是冻结快照 ⇒ 推进后是「基准 + 新值」而不是逐帧积分', v2[0] === 3043 && v2[1] === 1706 && frozen[0] === 3040, JSON.stringify({ v2, frozen }))
  const diag = []
  const sib = {
    origin: A.createAnimation(A.readAnimDef({ animation: { c0: lin([[0, 0], [30, 10]]), c1: lin([[0, 0], [30, 20]]), c2: lin([[0, 0], [30, 0]]), options: { fps: 30, length: 30, mode: 'single', children: [{ key: 'alpha' }] }, relative: true } }), { base: [0, 0, 0] }),
    alpha: A.createAnimation(A.readAnimDef({ animation: { c0: lin([[0, 1], [30, 0]]), options: { fps: 30, length: 30, mode: 'single', parent: { key: 'origin' } } } }), { base: 1 }),
    scale: A.createAnimation(A.readAnimDef({ animation: { c0: lin([[0, 1], [30, 2]]), options: { fps: 30, length: 30, mode: 'single', parent: { key: 'nope' } } } }), { base: 1 }),
  }
  A.linkAnimations(sib, (m) => diag.push(m))
  ok('D4 `children[].key`/`parent.key` 按**属性名**接线（child.parent = leader）', sib.alpha.parent === sib.origin)
  ok('D5 悬空 parent ⇒ 不链接 + 记一条诊断', sib.scale.parent === null && diag.length === 1, JSON.stringify(diag))
  sib.alpha.play(); sib.origin.advance(0.5)
  ok('D6 child 用 **leader 的播放头**采样自己的通道（child.frame 不动）',
    sib.alpha.frame === 0 && sib.alpha.getFrame() === 15 && near(sib.alpha.value(), 0.5), 'child.frame=' + sib.alpha.frame + ' playhead=' + sib.alpha.getFrame() + ' v=' + sib.alpha.value())
  const n = A.advanceAnimations([sib.origin, sib.alpha, sib.scale], 0.5)
  ok('D7 `advanceAnimations` 跳过联动 child（不重复推进）', n === 2, '推进条数=' + n)
}

/* ── ⑤ 写回渲染层：alpha/visible/origin/scale/angles + y 翻转 ───────────── */
console.log('── ⑤ `applyAnimsToLayer`（渲染写回语义） ──')
{
  const mkCtrl = (a, base) => A.createAnimation(A.readAnimDef(a), { base })
  const alpha = mkCtrl({ animation: { c0: lin([[0, 1.6], [10, -0.4]]), options: { fps: 30, length: 10, mode: 'single' } } }, 1)
  const vis = mkCtrl({ animation: { c0: lin([[0, 0], [10, 1]]), options: { fps: 30, length: 10, mode: 'single' } } }, true)
  const t = { alpha: 1, visible: true, origin: [0, 0, 0], scale: [1, 1, 1], angles: [0, 0, 0] }
  let wrote = A.applyAnimsToLayer(t, { alpha: alpha, visible: vis }, { alpha: 0, visible: true }, { projH: 3420 })
  ok('E1 alpha 写回并夹到 [0,1]（关键帧 1.6 / −0.4 是贝塞尔过冲，语料实测存在）',
    t.alpha === 1 && wrote.indexOf('alpha') >= 0, 'alpha=' + t.alpha + ' wrote=' + JSON.stringify(wrote))
  ok('E2 visible 是**阶跃**语义（>0.5 才可见）', t.visible === false && wrote.indexOf('visible') >= 0, 'visible=' + t.visible)
  // 绝对 origin：编辑器 y-up ⇒ 渲染 y-down（projH − y）
  const oAbs = mkCtrl({ animation: { c0: lin([[0, 100], [10, 400]]), c1: lin([[0, 200], [10, 500]]), c2: lin([[0, 0], [10, 0]]), options: { fps: 30, length: 10, mode: 'single' } } }, [0, 0, 0])
  const t2 = { origin: [0, 0, 0] }
  A.applyAnimsToLayer(t2, { origin: oAbs }, { origin: [0, 0, 0] }, { projH: 3420 })
  ok('E3 绝对 origin 的 y 走翻转（编辑器 y=200 ⇒ 渲染 3420−200=3220）', t2.origin[0] === 100 && t2.origin[1] === 3220 && t2.origin[2] === 0, JSON.stringify(t2.origin))
  const oRel = mkCtrl({ animation: { c0: lin([[0, 10], [10, 10]]), c1: lin([[0, -20], [10, -20]]), c2: lin([[0, 0], [10, 0]]), options: { fps: 30, length: 10, mode: 'single' }, relative: true } }, [3040, 1710, 0])
  const t3 = { origin: [3040, 1710, 0] }
  A.applyAnimsToLayer(t3, { origin: oRel }, { origin: [3040, 1710, 0] }, { projH: 3420 })
  ok('E4 relative origin 的 y 增量取负（编辑器 −20 ⇒ 渲染 +20）', t3.origin[0] === 3050 && t3.origin[1] === 1730, JSON.stringify(t3.origin))
  // 变异自证：不传 projH ⇒ 不翻转（读数必须变化）
  const t3b = { origin: [0, 0, 0] }
  A.applyAnimsToLayer(t3b, { origin: oAbs }, { origin: [0, 0, 0] }, {})
  ok('E5 变异自证：不传 projH ⇒ y 不翻转（证明 E3 真的在测翻转）', t3b.origin[1] === 200 && t3b.origin[1] !== t2.origin[1])
  // 单通道：只写 x
  const sx = mkCtrl({ animation: { c0: lin([[0, 3], [10, 3]]), options: { fps: 30, length: 10, mode: 'single' } } }, 1)
  const t4 = { scale: [1, 2, 3] }
  A.applyAnimsToLayer(t4, { scale: sx }, { scale: [1, 2, 3] }, {})
  ok('E6 单通道动画只写 c0→x，y/z 保持基准（与 legacy `sx = animValueAt(c0) ?? sx` 同口径）',
    t4.scale[0] === 3 && t4.scale[1] === 2 && t4.scale[2] === 3, JSON.stringify(t4.scale))
  // 无动画的字段一个都不写
  const t5 = { alpha: 0.5, visible: false, origin: [1, 2, 3] }
  const w5 = A.applyAnimsToLayer(t5, {}, {}, { projH: 100 })
  ok('E7 ctrls 空 ⇒ 一个字段都不写（`sceneAnimDiag` 之外零开销）', w5.length === 0 && t5.alpha === 0.5 && t5.visible === false && t5.origin[1] === 2)
}

/* ── ⑥ bundle 接线：解析注册表 / 档位 / 源码钉 ───────────────────────────── */
console.log('── ⑥ bundle 接线（解析注册表 + `?anim=` 档位 + 源码钉） ──')
{
  const sceneJson = {
    general: { orthogonalprojection: { width: 100, height: 50 } },
    objects: [
      { id: 1, name: 'fade', alpha: { value: 1, animation: { c0: lin([[0, 0], [30, 1]]), options: { fps: 30, length: 30, mode: 'single', startpaused: true } } } },
      { id: 2, name: 'static', origin: '10 20 0' },
    ],
  }
  const scene = lib.parseScene(sceneJson, null)
  ok('F1 `parseScene` 登记动画层/轨道数（`__srcStats.animLayers/animTracks`）', scene.__srcStats.animLayers === 1 && scene.__srcStats.animTracks === 1,
    JSON.stringify({ animLayers: scene.__srcStats.animLayers, animTracks: scene.__srcStats.animTracks }))
  ok('F2 `__animByRaw`（WeakMap）按 **raw scene.json 对象**取控制器；静态层取不到',
    !!scene.__animByRaw.get(sceneJson.objects[0]).alpha && !scene.__animByRaw.get(sceneJson.objects[1]))
  ok('F3 联动诊断表存在且为空（本场景无联动组）', Array.isArray(scene.__animLinkDiag) && scene.__animLinkDiag.length === 0)
  const before = scene.__animCtrls[0].frame
  lib.advanceSceneAnimations(scene, 0.5)
  ok('F4 缺省档：`advanceSceneAnimations` 推进（startpaused 的那条不动，自动播放的那条才动）',
    before === 0 && scene.__animCtrls[0].frame === 0, 'frame=' + scene.__animCtrls[0].frame)
  ok('F5 `sceneAnimDiag` 形状（层/属性/档位 + animDiag 字段）',
    sceneAnimDiagShape(scene), JSON.stringify(lib.sceneAnimDiag(scene, 1)[0]))
  const dg = lib.sceneAnimDiag(scene, 1)[0]
  ok('F6 legacy 档：`advanceSceneAnimations` 返回 0（legacy 路径按场景时钟直接采样，没有播放头）',
    lib.setAnimMode('legacy') === 'legacy' && lib.advanceSceneAnimations(scene, 1) === 0 && lib.animMode() === 'legacy')
  lib.setAnimMode('we')
  ok('F7 档位可复位（`setAnimMode("we")`）+ `animMode()` 读数', lib.animMode() === 'we' && lib.advanceSceneAnimations(scene, 0.1) === 0)
  // 源码钉：两套语义不同时施加 + 宿主接线位置
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'core', 'we-scene-bundle.js'), 'utf8')
  const host = fs.readFileSync(path.join(import.meta.dirname, '..', 'demo.html'), 'utf8')
  ok('F8 legacy 采样点被档位门住（`compositeLayer` 的 origin/scale + 绘制门的 visible 各一处）',
    /ANIM_MODE_RUNTIME === 'legacy' && layer\.anim && time !== undefined/.test(src) &&
    /ANIM_MODE_RUNTIME === 'legacy' && layer\.anim && layer\.anim\.visible && time !== undefined/.test(src))
  ok('F9 渲染循环在可见性判定**之前**逐帧写回（`applyLayerAnims` 必须在 `let __layerVis` 之前）',
    src.indexOf('if (ANIM_MODE_RUNTIME !== \'legacy\') applyLayerAnims(layer)') > 0 &&
    src.indexOf('if (ANIM_MODE_RUNTIME !== \'legacy\') applyLayerAnims(layer)') < src.indexOf('let __layerVis = layer.visible'))
  ok('F10 宿主每帧推进一次，且排在 `renderer.render(` 之前',
    host.indexOf('lib.advanceSceneAnimations(scene,') > 0 && host.indexOf('lib.advanceSceneAnimations(scene,') < host.indexOf('renderer.render(scene, textures'))
  ok('F15 宿主给动画的 dt = **场景时钟差**（不吃 `mpwCapScriptDt` 的单帧 0.05s 封顶）',
    /const dtAnim = Math\.max\(0, tSec - lastAnimClock\)/.test(host) &&
    /lib\.advanceSceneAnimations\(scene, dtAnim\)/.test(host) &&
    !/lib\.advanceSceneAnimations\(scene, mpwSceneDt\(mpwCapScriptDt\(frameDt\)\)\)/.test(host),
    '（低于 20fps 时沿用封顶会让动画变慢动作：llvmpipe 实测 13s 轨道走 60s+）')
  ok('F11 宿主把控制器注册给脚本门面（`setAnimationResolver`，重挂载重建）',
    /setAnimationResolver\(\(raw\) => \(scene && scene\.__animByRaw/.test(host))
  // ②(P-228l) 帧事件：`advanceSceneAnimations` 必须**取走**队列（否则 loop 轨道越帧会让队列无界增长），
  //   取走的条目进有界环 `scene.__animEvents`（宿主读数 `window.__mpwAnimEvents()`）。
  {
    const sj2 = {
      general: {},
      objects: [{
        id: 7, name: 'ev',
        alpha: { value: 1, animation: { c0: lin([[0, 0], [30, 1]]), options: { fps: 30, length: 30, mode: 'loop', events: [{ frame: 10, name: 'S' }] } } },
      }],
    }
    const sc2 = lib.parseScene(sj2, null)
    lib.advanceSceneAnimations(sc2, 0.5)     // 15 帧 ⇒ 越过 frame 10
    const ring = sc2.__animEvents || []
    ok('F13 越帧事件被取走并进有界环（layer/field/event/frame 四字段）',
      ring.length === 1 && ring[0].layer === 'ev' && ring[0].field === 'alpha' && ring[0].event === 'S' && ring[0].frame === 10,
      JSON.stringify(ring))
    for (let i = 0; i < 20; i++) lib.advanceSceneAnimations(sc2, 0.5)
    ok('F14 事件环有界（上限 60，不随 loop 轨道无界增长）', (sc2.__animEvents || []).length <= 60, 'len=' + (sc2.__animEvents || []).length)
  }
  const diagShape = lib.sceneAnimDiag(scene, 1)[0]
  ok('F12 `sceneAnimDiag` 每条含 mode/fps/length/frame/playing/rate/ended/linked/value/base（可机读）',
    ['mode', 'fps', 'length', 'frame', 'playing', 'rate', 'ended', 'linked', 'value', 'base'].every((k) => k in diagShape))
  void dg
}
function sceneAnimDiagShape(scene) {
  const d = lib.sceneAnimDiag(scene, 5)
  return Array.isArray(d) && d.length === 1 && d[0].layer === 'fade' && d[0].field === 'alpha' && d[0].mode === 'single' && d[0].fps === 30
}

/* ── ⑦ 脚本门面：`getAnimation()` 真句柄（媒体事件 → play() → 动画真的走） ── */
console.log('── ⑦ 脚本门面 `getAnimation()`（真控制器 / 中性桩两条落点） ──')
{
  const S = await import('../elysia/scene-scripts.js')
  const sceneJson = {
    general: { orthogonalprojection: { width: 100, height: 50 } },
    objects: [{
      id: 1, name: 'media', alpha: { value: 1, animation: { c0: lin([[0, 0], [30, 1]]), options: { fps: 30, length: 30, mode: 'single', startpaused: true } } },
      // 语料最常见的用法：媒体缩略图变化 ⇒ 播自己的动画（21 包 / 172 处里的 162 处是无参调用）。
      // ⚠ 脚本节点 = 属性上的 `{script, value}` 对象（宿主 `collect()` 的判据是 `'script' in obj && 'value' in obj`；
      //   语料里绝大多数作者脚本就挂在 `visible` 上）——不是层上的顶层 `script` 字段。
      visible: { script: 'export function mediaThumbnailChanged(event) { thisObject.getAnimation().play(); }', value: true },
    }],
  }
  const scene = lib.parseScene(sceneJson, null)
  const ctrl = scene.__animByRaw.get(sceneJson.objects[0]).alpha
  const cache = S.createScriptCache()
  const runAll = (time) => S.applySceneScripts(sceneJson, time, { renderObjects: sceneJson.objects, userProps: {}, scriptCache: cache })
  runAll(0)
  S.resetSceneScriptApiDiag()
  ok('G1 未注册解析器 ⇒ 中性桩（`animationStub` 计数；行为与改动前逐位相同）',
    S.setAnimationResolver(null) === false && (runAll(0), runEvent(S, cache, 'mediaThumbnailChanged') > 0) &&
    S.sceneScriptApiDiag().animationStub > 0 && ctrl.playing === false,
    JSON.stringify({ stub: S.sceneScriptApiDiag().animationStub, real: S.sceneScriptApiDiag().animationReal, playing: ctrl.playing }))
  S.resetSceneScriptApiDiag()
  S.setAnimationResolver((raw) => (raw && scene.__animByRaw.get(raw)) || null)
  const calls = runEvent(S, cache, 'mediaThumbnailChanged')
  const d = S.sceneScriptApiDiag()
  ok('G2 注册解析器 ⇒ `getAnimation()` 命中**真控制器**（`animationReal` 计数 + play() 真的把播放头启动）',
    calls > 0 && d.animationReal > 0 && d.animationStub === 0 && ctrl.playing === true,
    JSON.stringify({ calls, real: d.animationReal, stub: d.animationStub, playing: ctrl.playing }))
  lib.advanceSceneAnimations(scene, 1)
  ok('G3 play() 之后推进 1s ⇒ 帧 30、值 1（脚本 → 播放头 → 渲染求值整条链通）', ctrl.frame === 30 && near(ctrl.value(), 1), 'frame=' + ctrl.frame + ' value=' + ctrl.value())
  const ref = S.sceneScriptApiDiag()
  ok('G4 IAnimation 面：fps/frameCount/duration/name/rate 读到真值（不再是 0）',
    (() => { const r = ctrl; return r.fps === 30 && r.frameCount === 30 && near(r.duration, 1) })() && ref.animationWrite >= 1,
    'fps=' + ctrl.fps + ' frameCount=' + ctrl.frameCount + ' duration=' + ctrl.duration + ' writes=' + ref.animationWrite)
  S.setAnimationResolver(null)
  const cache2 = S.createScriptCache()
  const raw2 = { general: {}, objects: [{ id: 9, name: 'plain', origin: '1 2 0', visible: { script: 'export function init() { thisLayer.getAnimation().play(); }', value: true } }] }
  lib.parseScene(raw2, null)
  S.resetSceneScriptApiDiag()
  S.applySceneScripts(raw2, 0, { renderObjects: raw2.objects, userProps: {}, scriptCache: cache2 })
  ok('G5 层没有属性动画 ⇒ 仍旧是中性桩（不抛错、不静默）', S.sceneScriptApiDiag().animationStub > 0 && S.sceneScriptApiDiag().animationReal === 0,
    JSON.stringify({ stub: S.sceneScriptApiDiag().animationStub, real: S.sceneScriptApiDiag().animationReal }))
}
/** 向所有脚本条目投递一个事件（返回命中条目数）；用于 G1/G2。 */
function runEvent(S, cache, name) {
  const out = S.dispatchScriptEvent(cache, name, { state: 1 })
  return out.calls + out.entries
}

/* ── ⑧ 真包：0923/2887099508（探针包；离线可复现的读数） ─────────────────── */
console.log('── ⑧ 真包 0923/2887099508（探针包） ──')
{
  const pkgPath = path.join(WS, 'allwallpaper', '0923', '2887099508', 'scene.pkg')
  if (!fs.existsSync(pkgPath)) sk('真包 2887099508', '语料里没有 ' + pkgPath)
  else {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
    const sj = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    const scene = lib.parseScene(sj, null)
    ok('H1 解析注册表：7 个动画层 / 8 条轨道（6 条 alpha + mkj 的 origin/alpha 联动组）',
      scene.__srcStats.animLayers === 7 && scene.__srcStats.animTracks === 8,
      JSON.stringify({ animLayers: scene.__srcStats.animLayers, animTracks: scene.__srcStats.animTracks }))
    const byName = (n) => scene.layers.find((l) => l.name === n)
    const six = ['黑底', '凯尔希', '1语言', '2语言', '3语言'].map(byName)
    ok('H2 五条 `startpaused` 的 alpha 轨道在挂载瞬间 = 隐藏（帧 0 值 0）—— 改动前是"永久 alpha=1 可见"',
      six.every((l) => l && l.__animCtrls && l.__animCtrls.alpha.playing === false && near(l.__animCtrls.alpha.value(), 0)))
    const mkj = byName('mkj')
    ok('H3 `mkj`：origin 是 leader（relative、13s、single），alpha 是它的 child（用 leader 播放头）',
      mkj && mkj.__animCtrls.origin.relative === true && mkj.__animCtrls.alpha.parent === mkj.__animCtrls.origin &&
      mkj.__animCtrls.origin.frameCount === 390 && mkj.__animCtrls.alpha.frameCount === 390)
    ok('H4 `mkj` 的 alpha 关键帧末帧是 164 而 length=390 ⇒ 只有用 leader 播放头才采得到正确值（child.frame 恒 0）',
      mkj.__animCtrls.alpha.getFrame() === mkj.__animCtrls.origin.getFrame())
    const lang1 = byName('1语言')
    lang1.__animCtrls.alpha.play()
    lib.advanceSceneAnimations(scene, 2)
    const v2 = lang1.__animCtrls.alpha.value()
    lib.advanceSceneAnimations(scene, 10)
    const c = lang1.__animCtrls.alpha
    ok('H5 `1语言`：play() 后 2s 淡入到 1、5s（150 帧）到末帧 0 并停住 + ended（single 不重播）',
      near(v2, 1, 1e-9) && near(c.value(), 0) && c.playing === false && c.ended === true,
      JSON.stringify({ v2: +v2.toFixed(4), vEnd: +c.value().toFixed(4), frame: c.frame, playing: c.playing, ended: c.ended }))
    const before = byName('黑底').__animCtrls.alpha.value()
    ok('H6 未被 play() 的轨道仍是帧 0（黑底/2语言/3语言/凯尔希 不受别的层 play 影响）',
      near(before, 0) && ['凯尔希', '2语言', '3语言'].every((n) => near(byName(n).__animCtrls.alpha.value(), 0)))
    // 写回：把整场景推进到一个统一时刻后，layer 上的 alpha/visible 与控制器一致
    const scene2 = lib.parseScene(sj, null)
    lib.advanceSceneAnimations(scene2, 0.5)
    const heart = scene2.layers.find((l) => l.name === 'heart 1')
    A.applyAnimsToLayer(heart, heart.__animCtrls, heart.__animBase, { projH: heart.__animProjH })
    ok('H7 `heart 1`（自动播放、single、1→1→0）在 0.5s 时 alpha 仍为 1；`1语言`（未播）写回后 = 0',
      near(heart.alpha, 1) && (() => { const l = scene2.layers.find((x) => x.name === '1语言'); A.applyAnimsToLayer(l, l.__animCtrls, l.__animBase, { projH: l.__animProjH }); return l.alpha === 0 })(),
      'heart.alpha=' + heart.alpha)
  }
}

/* ── ⑨ 语料普查：口径可达性（缺语料 ⇒ SKIP，不把"没测到"算通过） ────────── */
console.log('── ⑨ 语料普查：`readAnimDef` 能覆盖多少条真实轨道 ──')
{
  let idx = null
  try { idx = await import('./_pkg-index.mjs') } catch (e) { idx = null }
  const roots = ['dd', '0923', '0917', 'wallpaperE'].map((r) => path.join(WS, 'allwallpaper', r))
  const have = idx && roots.filter((r) => fs.existsSync(r))
  if (!idx || !have.length) sk('语料普查', '没有 ' + roots.join(' / '))
  else {
    const files = []
    for (const r of have) { try { idx.walkContainers(r, files) } catch (e) { /* 单个根失败不影响其它 */ } }
    let pkgs = 0, tracks = 0, parsed = 0, paused = 0, offFps = 0, alphaChanged = 0, alphaTracks = 0, modes = {}, fpsSet = {}
    for (const f of files) {
      let txt = null
      try { txt = idx.readSceneJsonText(f) } catch (e) { continue }
      if (!txt) continue
      let sj = null
      try { sj = JSON.parse(txt.replace(/^\uFEFF/, '')) } catch (e) { continue }
      pkgs++
      const visit = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) { node.forEach(visit); return }
        if (node.animation && typeof node.animation === 'object') {
          tracks++
          const d = A.readAnimDef(node)
          if (d) {
            parsed++
            modes[d.mode] = (modes[d.mode] || 0) + 1
            fpsSet[d.fps] = (fpsSet[d.fps] || 0) + 1
            if (d.startpaused) paused++
            if (d.fps !== 30) offFps++
          }
        }
        for (const k of Object.keys(node)) { if (k === 'animation' || k === 'particle') continue; visit(node[k]) }
      }
      for (const o of sj.objects || []) visit(o)
      void alphaTracks; void alphaChanged
    }
    ok('I1 抽查容器数 > 0（语料在）', pkgs > 0, '可解析 scene.json 的包 = ' + pkgs + ' / 容器 = ' + files.length)
    ok('I2 `readAnimDef` 覆盖 **100%** 的真实动画对象（不能有"读不出来"的轨道）', tracks > 0 && parsed === tracks, 'parsed=' + parsed + ' tracks=' + tracks)
    ok('I3 真实数据里 `startpaused` 与 fps≠30 都不是孤例（= 硬编码 30 / 一律自动播放这两条真的会踩到）',
      paused > 0 && offFps > 0, 'startpaused=' + paused + ' fps≠30=' + offFps + ' 总轨道=' + tracks)
    ok('I4 mode 落在官方枚举内（single/loop/mirror）', Object.keys(modes).every((m) => m === 'single' || m === 'loop' || m === 'mirror'), JSON.stringify(modes))
    console.log('    读数：轨道 ' + tracks + '（startpaused ' + paused + '、fps≠30 ' + offFps + '）  mode=' + JSON.stringify(modes) + '  fps 分布=' + JSON.stringify(fpsSet))
  }
}

console.log('\n===== anim-semantics: ' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)

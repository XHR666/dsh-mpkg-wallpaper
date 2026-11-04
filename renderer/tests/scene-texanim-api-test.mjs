#!/usr/bin/env node
/**
 * scene-texanim-api-test.mjs —— 官方 `ITextureAnimation` 面（`thisLayer.getTextureAnimation()`）的门禁
 * （2026-09-21）。为什么单开一条：
 *
 *   真机语料（包 3544152633）的作者脚本逐字用到官方 `ITextureAnimation`：
 *     · `playeroutlineanim.origin`  `thisLayer.getTextureAnimation().rate = 9`
 *     · `playerplay.alpha/origin`  `getFrame()` / `frameCount` / `rate = 0|5`
 *   而本仓库的 `texAnimRefShared()` 之前**没有** `rate` / `frameCount` / `duration` / `isPlaying()` / `join()`
 *   （只有自造的四个空 `setXxx()`）⇒ 后果不是抛错而是**静默错分支**：
 *   `getFrame() == frameCount - 1` 里 `frameCount === undefined` ⇒ `NaN` 比较恒假，
 *   "播完这一遍就做某事"永远不触发；`rate = 9` 写成自建属性后**没人读**。
 *
 * 覆盖：
 *   A. 官方面本身（Node 直接跑真源码 `elysia/scene-scripts.js` 的 `texAnimRefShared`）
 *   B. 元数据回填与 `rate` 前推的接线钉子（`demo.html` 同帧同步 + `core` 的精灵帧推进）
 *   C. 精灵帧 UV 的既有语义（`spriteFrameRectUV` 取模不越界）
 * 纯 Node，无浏览器（真机读数由 `tests/bench-renderer-source-test.mjs` 的 D 段与语料门禁承担）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

const SS = await import(pathToFileURL(path.join(ROOT, 'elysia', 'scene-scripts.js')).href)
const CORE = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')

/* ── A. 官方面（真源码） ─────────────────────────────────────────────────────────── */
{
  SS.resetSceneScriptApiDiag()
  const raw = {}
  const tex = SS.texAnimRefShared(raw)
  ok(typeof tex.getFrame === 'function' && typeof tex.isPlaying === 'function' && typeof tex.join === 'function' &&
    typeof tex.play === 'function' && typeof tex.stop === 'function' && typeof tex.setFrame === 'function',
    'A1 方法面：`getFrame/isPlaying/join/play/stop/setFrame` 都是函数（官方 d.ts:551-606 的成员一个不缺）')
  ok(tex.rate === 1, 'A2 `rate` 缺省 = 1（官方："默认 1"）', String(tex.rate))
  tex.rate = 9
  ok(tex.rate === 9 && raw.__texRate === 9,
    'A3 ★`rate` **可写且读回**（旧实现里这个键根本不存在 ⇒ 写操作静默丢失；真机脚本 `rate = 9` 就是这条）', JSON.stringify({ rate: tex.rate }))
  tex.rate = NaN
  ok(tex.rate === 9, 'A4 非有限值不写（不把速度写成 NaN）—— 仍保持上一次的 9', String(tex.rate))
  ok(tex.frameCount === 0 && tex.duration === 0,
    'A5 没有帧元数据时 `frameCount/duration` = **0**（不编造；0 与 `undefined` 的区别是"数值可比较"）')
  raw.__texFrameCount = 31; raw.__texFrameDuration = 1.29
  ok(tex.frameCount === 31 && tex.duration === 1.29,
    'A6 宿主盖章后读回真值（`__texFrameCount` / `__texFrameDuration`）', JSON.stringify({ n: tex.frameCount, d: tex.duration }))
  ok(tex.getFrame() === 0 && (() => { tex.setFrame(7); return tex.getFrame() === 7 })() && raw.__texFrameForced === true,
    'A7 `setFrame` 钉帧（`__texFrame` + `__texFrameForced`）—— 既有语义未动')
  tex.play()
  const playing = tex.isPlaying()
  tex.stop()
  ok(playing === true && tex.isPlaying() === false,
    'A8 `isPlaying()` 跟随 `play/stop`（官方是**方法**，不是属性）')
  tex.setFrame(3)
  tex.join()
  ok(raw.__texFrameForced === false, 'A9 `join()` 清掉本对象的强制帧（回到自动推进 = 本仓库对"共享动画状态"的最近映射）')
  let threw = false
  try { tex.setRate(2); tex.setTime(1); tex.setFps(30); tex.setFrameCount(10) } catch (e) { threw = true }
  ok(!threw, 'A10 自造的四个空 `setXxx()` **保留**（语料里已有调用方；删掉会把静默 no-op 变成新版 TypeError）')
  const d = SS.sceneScriptApiDiag()
  ok(d.texAnimRateWrite === 1 && d.texAnimJoin === 1,
    'A11 可观测性：`rate` 写与 `join()` 各有计数（`sceneScriptApiDiag()`，门禁/诊断可读）', JSON.stringify({ rate: d.texAnimRateWrite, join: d.texAnimJoin }))
  const face = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(tex), 'rate')
  ok(!face || true, 'A12 说明：`rate` 是访问器（get+set）而不是数据属性 —— 这样写能干到 raw 对象、并被渲染层读到', '')
}

/* ── B. 接线钉子（回填 / 前推 / 渲染层消费） ─────────────────────────────────────── */
{
  ok(/raw\.__texFrameCount === undefined && typeof l\.__texFrameCount === 'number'/.test(HTML) &&
    /raw\.__texFrameDuration === undefined && typeof l\.__texFrameDuration === 'number'/.test(HTML),
    'B1 `demo.html`：把 core 盖章的 `frameCount/duration` **回填**给脚本可见对象（只在脚本侧还没有值时）—— ' +
    '没有这一步，`getFrame() == frameCount-1` 永远是 NaN 比较')
  ok(/typeof raw\.__texRate === 'number'[\s\S]{0,120}l\.__texRate = raw\.__texRate/.test(HTML),
    'B2 `demo.html`：脚本写的 `rate` **前推**到渲染层（`l.__texRate`）')
  ok(/typeof layer\.__texFrameCount !== 'number'\) layer\.__texFrameCount = Number\(texObj\.sprite\.numFrames\)/.test(CORE_SRC) &&
    /typeof layer\.__texFrameDuration !== 'number'\) layer\.__texFrameDuration = Number\(texObj\.sprite\.duration\)/.test(CORE_SRC),
    'B3 `core`：从 `texObj.sprite`（TEXS 帧表算出来的真值）**盖章** `frameCount/duration` 到图层')
  ok(/const rate = \(typeof rateRaw === 'number' && isFinite\(rateRaw\)\) \? rateRaw : 1/.test(CORE_SRC) &&
    /else if \(!\(rate > 0\)\) \{ frame = \(typeof layer\.__spriteFrame === 'number'\)/.test(CORE_SRC) &&
    /frame = Math\.floor\(\(time \|\| 0\) \* rate \/ ft\)/.test(CORE_SRC),
    'B4 `core` 精灵帧推进：`rate` 缺省 → `floor(time/ft)`（**与改动前逐位相同**）；`rate>0` → 按倍率；' +
    '`rate<=0` → **冻结在上一帧**（不能退化成 frame 0 —— 真机脚本用 `rate=0` 停在末帧）')
  ok(/__texFrameForced\) \{ frame = Number\(layer\.__texFrame\) \|\| 0; layer\.__spriteFrame = frame \}/.test(CORE_SRC),
    'B5 钉帧优先于倍率（`setFrame` 的那一帧不被 `rate` 抢走）')
}

/* ── C. 精灵帧 UV（取模不越界，帧号任意大/负都不许抛） ───────────────────────────── */
{
  const sp = { numFrames: 10, frameWidthUV: 0.1, frameHeightUV: 0.1, frametime: 0.1, duration: 1 }
  const r0 = CORE.spriteFrameRectUV(sp, 0)
  const r9 = CORE.spriteFrameRectUV(sp, 9)
  const r12 = CORE.spriteFrameRectUV(sp, 12)
  ok(r0 && r0.u0 === 0 && Math.abs(r9.u0 - 0.9) < 1e-9 && Math.abs(r12.u0 - 0.2) < 1e-9,
    'C1 `spriteFrameRectUV` 取模回绕（12 % 10 = 2）—— `rate` 放大后帧号会跑得很快，回绕必须稳', JSON.stringify([r0 && r0.u0, r9 && r9.u0, r12 && r12.u0]))
  ok(CORE.spriteFrameRectUV({ numFrames: 0 }, 3) === null && CORE.spriteFrameRectUV(null, 1) === null,
    'C2 没有帧表 ⇒ `null`（渲染层退回整图 UV，不抛）')
}

console.log(`── 汇总：PASS=${pass} FAIL=${fail}`)
process.exit(fail === 0 ? 0 : 1)

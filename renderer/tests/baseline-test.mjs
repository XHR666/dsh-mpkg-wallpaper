// baseline-test.mjs —— ①(§5-⑨ 真机基线快照 2026-09-17) 验收
//
// 交付物三件（本文件逐件断言）：
//   ① 采集器：demo.html `MPW-BASELINE-BEGIN/END` 段（**默认关**）+ core/baseline-metrics.mjs 纯内核；
//   ② 落盘：`POST /baseline` → `reports/baselines/<ts>.json`（服务端上限/校验/滚动）；
//   ③ 对照闸门：tools/baseline-diff.mjs（阈值集中一处 + env 覆盖 + 退出码 0/1/2 语义）。
//
// 断言五组：
//   T1 分位/统计口径：最近秩分位、中位（偶数取下中位）、帧间隔分位、1% low、500ms 滚动窗 FPS
//   T2 快照字段齐全 + 校验：合成时间戳跑采样器 → 必填字段/类型/就绪判据（纹理齐全 / 第 90 帧 / 超时）
//   T3 GL 代理计数：活 FBO/纹理数、Σw×h×bpp、重传不重复计数、删除回落、幂等、假 gl/无 gl 不炸
//   T4 开关解析 + 切换阶段流转 + 合并（含"防自我导航"与"交接对不上就就地收尾"）
//   T5 闸门与端到端：baseline-diff 纯函数判据 + CLI 退出码（0/1/2）+ env 覆盖 + 真服务 POST /baseline
//      + **默认关时零行为变化**（把 demo.html 真源码切片，用桩 DOM/桩 gl 跑：不开参数 → 不包装 GL、
//        不建定时器、不发请求；开了 → 真跑满时长并把快照 POST 出去）
//
// 运行：node tests/baseline-test.mjs   （全过输出 ALL PASS，退出码 0）

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { ROOT } from './_root.mjs'
import {
  BASELINE_SCHEMA, BASELINE_DEFAULTS,
  mpwPercentile, mpwMedian, mpwMean, mpwFrameMsStats, mpwP1LowFps, mpwFpsWindows, mpwFpsStats,
  mpwStartupStats, mpwBytesPerPixel, mpwBaselineInstallGlCounters, mpwBaselineParseOpts,
  mpwBaselineCreateSampler, mpwBaselineNextStage, mpwBaselineMergeHandoff, mpwValidateSnapshot,
} from '../core/baseline-metrics.mjs'
import { THRESHOLDS, ENV_OF, resolveThresholds, compareSnapshots, METRICS } from '../tools/baseline-diff.mjs'

let pass = 0, fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server', 'we-scene-demo-server.mjs'), 'utf8')

/** 切出 demo.html 里标记之间的整段（含 END 标记）——与 data-limits/props-panel 同一套切片手法 */
const sliceMarks = (src, begin, end) => {
  const i = src.indexOf(begin)
  if (i < 0) return ''
  const j = src.indexOf(end, i)
  if (j < 0) return ''
  return src.slice(i, j + end.length)
}
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  s.on('error', rej)
})

/* ══════════════ T1 分位/统计口径（唯一定义处，逐值钉死） ══════════════ */
console.log('\n== T1 分位/统计口径（最近秩 + 500ms 滚动窗） ==')
{
  check('T1a 最近秩分位：idx = ceil(q×n)−1（q=0.5 偶数样本取**下中位**）',
    mpwPercentile([1, 2, 3, 4], 0.5) === 2 && mpwPercentile([1, 2, 3, 4, 5], 0.5) === 3,
    'p50([1..4])=' + mpwPercentile([1, 2, 3, 4], 0.5) + ' p50([1..5])=' + mpwPercentile([1, 2, 3, 4, 5], 0.5))
  check('T1a 边界：q=0 → 最小、q=1 → 最大、q 越界被钳制',
    mpwPercentile([5, 1, 3], 0) === 1 && mpwPercentile([5, 1, 3], 1) === 5
    && mpwPercentile([5, 1, 3], 9) === 5 && mpwPercentile([5, 1, 3], -3) === 1)
  check('T1a 分位不是"线性插值"：p95([1..4]) = ceil(3.8)−1 = 3 → 4（保守，不抹平慢帧）',
    mpwPercentile([1, 2, 3, 4], 0.95) === 4 && mpwPercentile([1, 2, 3, 4], 0.25) === 1)
  check('T1a 非有限值被过滤；空输入/非法 q → null',
    mpwPercentile([1, NaN, Infinity, 3], 1) === 3 && mpwPercentile([], 0.5) === null && mpwPercentile([1], NaN) === null)
  {
    const arr = [4, 3, 2, 1]
    mpwPercentile(arr, 0.5)
    check('T1a 不修改入参顺序（内部先拷贝再排序）', arr.join(',') === '4,3,2,1', arr.join(','))
  }
  check('T1a median/mean 与分位同源', mpwMedian([1, 2, 3, 4]) === 2 && near(mpwMean([1, 2, 3, 4]), 2.5))
  check('T1a 空列表的 mean → null（不返回 0 冒充数据）', mpwMean([]) === null && mpwMedian([]) === null)

  const st = mpwFrameMsStats([10, 20, 30, 40])
  check('T1b 帧间隔分位：n/p50/p95/p99/max/mean 逐值正确',
    st.n === 4 && st.p50 === 20 && st.p95 === 40 && st.p99 === 40 && st.max === 40 && st.mean === 25,
    JSON.stringify(st))

  check('T1c 1% low = 1000 / mean(最慢 1% 帧)，至少 1 帧',
    mpwP1LowFps([...Array(99).fill(16), 200, 200]) === 5, '99×16ms + 2×200ms ⇒ 5.00fps')
  check('T1c 均匀 60fps → 1% low ≈ 60（不会被分位算法虚报）', near(mpwP1LowFps(Array(300).fill(1000 / 60)), 60))
  check('T1c 空输入 → null', mpwP1LowFps([]) === null)

  const stamps = Array.from({ length: 121 }, (_, i) => i * (1000 / 60))
  const win = mpwFpsWindows(stamps, 500)
  check('T1d 500ms 完整窗：2s / 60fps ⇒ 4 个窗、每窗 30 帧、每窗 60fps',
    win.windows.length === 4 && win.windows.every((w) => w.frames === 30 && near(w.fps, 60, 0.01)) && win.partial === false,
    'windows=' + win.windows.length)
  const short = mpwFpsWindows([0, 20, 40], 500)
  check('T1d 总时长不足一窗 ⇒ 1 个 partial 窗（fps = (n−1)×1000/span），不返回空表',
    short.windows.length === 1 && short.windows[0].partial === true && near(short.windows[0].fps, 50) && short.partial === true)
  check('T1d 窗口 fps = 窗内帧数 × 1000 / windowMs（唯一口径）',
    mpwFpsWindows(Array.from({ length: 41 }, (_, i) => i * 25), 500).windows.every((w) => near(w.fps, 40)),
    '40fps 序列每窗 20 帧')
  const fs1 = mpwFpsStats(Array(600).fill(1000 / 60), stamps.slice(0, 600), 500)
  check('T1d FPS 汇总字段齐全（median/p1Low/min/max/windows/windowMs）',
    ['windowMs', 'windows', 'partial', 'median', 'p1Low', 'min', 'max'].every((k) => k in fs1) && near(fs1.median, 60),
    JSON.stringify(fs1))

  const su = mpwStartupStats({ navToFirstFrameMs: 800, firstFrameToReadyMs: 154.25, readyReason: 'tex-complete', readyFrame: 37, texReadyFrame: 37 })
  check('T1e 启动三段：nav→首帧 + 首帧→就绪 = totalMs（主指标）',
    su.navToFirstFrameMs === 800 && su.firstFrameToReadyMs === 154.25 && su.totalMs === 954.25 && su.readyReason === 'tex-complete')
  const su2 = mpwStartupStats({ navToFirstFrameMs: 800 })
  check('T1e 就绪时间缺失 ⇒ firstFrameToReady/total 为 null（不编造 0）',
    su2.firstFrameToReadyMs === null && su2.totalMs === null && su2.frameTarget === BASELINE_DEFAULTS.startupFrameTarget)
}

/* ══════════════ T2 采样器 → 快照字段齐全 + 校验 ══════════════ */
console.log('\n== T2 快照字段齐全 + mpwValidateSnapshot ==')
{
  const mk = (stateFn, dt = 1000 / 60, frames = 620, durationSec = 10) => {
    const s = mpwBaselineCreateSampler({ opts: { durationSec, windowMs: 500, startupFrameTarget: 90 }, state: stateFn })
    for (let i = 0; i < frames; i++) s.noteFrame(300 + i * dt, i + 1)
    return s
  }
  const meta = { id: 'sample-synthetic', url: 'http://127.0.0.1:8899/?id=sample-synthetic&baseline=1', ua: 'test', flags: { baseline: '1' }, counts: { layers: 5, textures: 3, glTexturesLive: 4, glFbosLive: 2 }, vramProxy: { textureBytesEst: 2048, jsHeapUsedBytes: 100000 } }

  const s1 = mk(() => ({ texMissing: 0 }))
  const snap = s1.build(meta)
  check('T2a 必填字段全齐且校验通过', mpwValidateSnapshot(snap).ok, JSON.stringify(mpwValidateSnapshot(snap).errors))
  check('T2a kind/schema/at/id/source 正确', snap.kind === 'baseline' && snap.schema === BASELINE_SCHEMA && typeof snap.at === 'string' && snap.id === 'sample-synthetic' && snap.source === 'browser')
  check('T2a window 块：targetSec/actualSec/frames/fpsWindowMs/endedBy', snap.window.targetSec === 10 && snap.window.fpsWindowMs === 500 && snap.window.frames === 620 && snap.window.endedBy === 'duration', JSON.stringify(snap.window))
  check('T2a frames 块五个分位齐全', ['n', 'p50', 'p95', 'p99', 'max', 'mean'].every((k) => typeof snap.frames[k] === 'number'))
  check('T2a fps 块：中位/1% low/min/max', typeof snap.fps.median === 'number' && typeof snap.fps.p1Low === 'number' && typeof snap.fps.min === 'number')
  check('T2a counts 块：层数/可见层/纹理/活 FBO/活纹理/draw/上传',
    snap.counts.layers === 5 && snap.counts.glTexturesLive === 4 && snap.counts.glFbosLive === 2 && snap.counts.frames === 620,
    JSON.stringify(snap.counts))
  check('T2a vramProxy 块：**代理**字段 + 诚实 note + 合计（含 JS 堆）',
    snap.vramProxy.textureBytesEst === 2048 && snap.vramProxy.jsHeapUsedBytes === 100000 && snap.vramProxy.totalBytesEst === 102048
    && /拿不到\*\*真实显存读数/.test(snap.vramProxy.note) && /JS 堆/.test(snap.vramProxy.note))
  check('T2a render 块在未开 ?perf 时 available=false 且写明口径（帧间隔 ≠ 渲染开销）',
    snap.render.available === false && snap.render.p50 === null && /相邻帧间隔/.test(snap.render.note))
  check('T2a 就绪判据 = 纹理齐全（texMissing=0 先到）', snap.startup.readyReason === 'tex-complete' && snap.startup.readyFrame >= 1 && snap.startup.totalMs > 0)

  const s2 = mk(() => ({ texMissing: 3 }))   // 缺纹理一直存在 ⇒ 只能靠第 90 帧
  const snap2 = s2.build(meta)
  check('T2b 纹理不齐时就绪判据回落"第 90 帧"（readyReason=frame-target / readyFrame=90）',
    snap2.startup.readyReason === 'frame-target' && snap2.startup.readyFrame === 90 && snap2.counts.texMissing === 3,
    JSON.stringify(snap2.startup))

  // 超时：帧数不足以到 90、纹理又不齐
  const s3 = mpwBaselineCreateSampler({ opts: { durationSec: 2, windowMs: 500, startupFrameTarget: 90 }, state: () => ({ texMissing: 7 }) })
  for (let i = 0; i < 40; i++) s3.noteFrame(100 + i * (1000 / 60), i + 1)
  const snap3 = s3.build(meta)
  check('T2c 窗口结束仍未就绪 ⇒ readyReason=timeout 且 totalMs=null（如实报，不假装就绪）',
    snap3.startup.readyReason === 'timeout' && snap3.startup.totalMs === null, JSON.stringify(snap3.startup))

  const s4 = mk(() => ({ texMissing: 0 }))
  s4.noteRenderMs(8.5); s4.noteRenderMs(21.5)
  const snap4 = s4.build(meta)
  check('T2d 开了 ?perf=1（喂渲染主体耗时）⇒ render.available=true 且分位有值',
    snap4.render.available === true && snap4.render.n === 2 && snap4.render.max === 21.5 && /perf=1/.test(snap4.render.note))

  const bad = [
    [{}, '缺全部'],
    [{ kind: 'baseline', schema: BASELINE_SCHEMA, at: 'x', id: 'y', window: { frames: 0 }, frames: { n: 0 }, fps: { windowMs: 500 }, startup: { totalMs: null }, counts: { layers: 1 }, vramProxy: { textureBytesEst: 1 } }, 'window.frames=0 不算快照'],
    [{ ...snap, schema: 999 }, 'schema 不符'],
    [null, '非对象'],
  ]
  check('T2e 校验器拒绝残缺/坏 schema/零帧（缺字段当 0 比会得出假结论）', bad.every(([o]) => mpwValidateSnapshot(o).ok === false))
  check('T2e 采样器内部量可读（诊断/测试用）', (() => { const st = s1.stats(); return st.frames === 620 && st.readyReason === 'tex-complete' && st.dts === 619 })())
  check('T2e notes 从 opts 带进快照（非法参数不静默）',
    (() => { const s = mpwBaselineCreateSampler({ opts: { durationSec: 10, notes: ['n1'] }, state: () => ({}) }); return s.build(meta).notes.join(',') === 'n1' })())
}

/* ══════════════ T3 GL 代理计数（假 gl；真页面用同一函数） ══════════════ */
console.log('\n== T3 GL 代理计数（活 FBO/纹理 + Σw×h×bpp） ==')
{
  const fakeGl = () => ({
    RGBA: 6408, RGBA8: 32856, RGBA16F: 34842, RGBA32F: 34836, RGB: 6407, RGB16F: 34843, RGB32F: 34837,
    R8: 33321, RG8: 33323, RED: 6403, ALPHA: 6406, LUMINANCE: 6409, LUMINANCE_ALPHA: 6410,
    RGB10_A2: 32857, RGB5_A1: 32855, SRGB8_ALPHA8: 35907,
    _f: 0,
    createFramebuffer() { return { f: ++this._f } }, deleteFramebuffer() {},
    createTexture() { return { t: Math.random() } }, deleteTexture() {},
    texImage2D() {}, texSubImage2D() {}, drawArrays() {}, drawElements() {}, drawArraysInstanced() {}, drawElementsInstanced() {},
  })
  check('T3a bpp 表：RGBA=4 / RGBA16F=8 / RGBA32F=16 / RGB=3 / R8=1 / 未知格式回落 4',
    mpwBytesPerPixel(6408, { RGBA: 6408 }) === 4 && mpwBytesPerPixel(34842, { RGBA16F: 34842 }) === 8
    && mpwBytesPerPixel(34836, { RGBA32F: 34836 }) === 16 && mpwBytesPerPixel(33321, { R8: 33321 }) === 1
    && mpwBytesPerPixel(12345, { RGBA: 6408 }) === 4)

  const gl = fakeGl()
  const c = mpwBaselineInstallGlCounters(gl)
  check('T3b install 成功且幂等（第二次调用复用同一计数器，不二次包装）',
    c.installed === true && mpwBaselineInstallGlCounters(gl).installed === true)
  const t1 = gl.createTexture(); gl.texImage2D(3553, 0, gl.RGBA, 100, 50, 0, gl.RGBA, 5121, null)
  const t2 = gl.createTexture(); gl.texImage2D(3553, 0, gl.RGBA16F, 10, 10, 0, gl.RGBA, 5131, null)
  let s = c.snapshot()
  check('T3c 活纹理字节 = Σw×h×bpp（100×50×4 + 10×10×8 = 20800），最大单张 20000',
    s.glTexturesLive === 2 && s.textureBytesEst === 20800 && s.texBytesMaxSingle === 20000, JSON.stringify({ t: s.textureBytesEst, m: s.texBytesMaxSingle }))
  gl.texImage2D(3553, 0, gl.RGBA, 100, 50, 0, gl.RGBA, 5121, null)   // 队列空 = 已有纹理重传
  s = c.snapshot()
  check('T3c 重传（视频逐帧）只累计带宽，**不**重复计入活字节',
    s.textureBytesEst === 20800 && s.uploads === 3 && s.uploadBytes === 40800, JSON.stringify({ b: s.textureBytesEst, u: s.uploads, ub: s.uploadBytes }))
  gl.deleteTexture(t1)
  s = c.snapshot()
  check('T3c 删除纹理：活数 −1 且字节回落', s.glTexturesLive === 1 && s.textureBytesEst === 800)
  gl.createFramebuffer(); gl.createFramebuffer(); gl.deleteFramebuffer()
  s = c.snapshot()
  check('T3d 活 FBO 数 = created − deleted（真计数，不是估算）', s.glFbosCreated === 2 && s.glFbosDeleted === 1 && s.glFbosLive === 1)
  gl.drawArrays(); gl.drawElements(); gl.drawElementsInstanced()
  s = c.snapshot()
  check('T3d draw call 计数（含实例化版）', s.drawCalls === 3)
  gl.createTexture(); gl.texImage2D(3553, 0, 99999, 4, 4, 0, gl.RGBA, 5121, null)
  s = c.snapshot()
  check('T3d 不认识的 internalformat 记 unknownFormats（不静默当成精确值）', s.unknownFormats === 1 && s.textureBytesEst === 800 + 64)
  const before = c.snapshot().drawCalls
  gl.drawArrays()
  check('T3d 幂等性：重复 install 不会让同一调用被计两次', c.snapshot().drawCalls === before + 1)
  check('T3e 没有 gl（本机无 WebGL2 / elysia 路径）⇒ installed=false、快照全 0，不抛',
    (() => { const r = mpwBaselineInstallGlCounters(null); return r.installed === false && r.snapshot().glFbosLive === 0 })())
}

/* ══════════════ T4 开关解析 + 切换阶段流转 + 合并 ══════════════ */
console.log('\n== T4 ?baseline 解析 / 三阶段切换 / 合并 ==')
{
  const P = (q) => mpwBaselineParseOpts(new URLSearchParams(q))
  check('T4a **默认关**：不写参数 = on:false（红线：零行为变化）',
    P('').on === false && P('?id=x').on === false && P('baseline=').on === false)
  check('T4a ?baseline=1 → 开、默认 10s', P('baseline=1').on === true && P('baseline=1').durationSec === 10)
  check('T4a ?baseline=<秒> 顺带定时长（少写一个参数）', P('baseline=30').on === true && P('baseline=30').durationSec === 30)
  check('T4a ?baseline=0/off/no/false → 关', ['0', 'off', 'no', 'false'].every((v) => P('baseline=' + v).on === false))
  check('T4a 非法值 → 关 + 一行 note（不静默、不抛）',
    P('baseline=abc').on === false && P('baseline=abc').notes.some((n) => /非法/.test(n)))
  check('T4a ?baselinedur 生效并夹在 2..120',
    P('baseline=1&baselinedur=45').durationSec === 45 && P('baseline=1&baselinedur=999').durationSec === 120
    && P('baseline=1&baselinedur=1').durationSec === 10 && P('baseline=1&baselinedur=1').notes.some((n) => /非法/.test(n)))
  check('T4a 只写 ?baselinedur 不开采集 ⇒ 仍然关（并说明原因）',
    P('baselinedur=30').on === false && P('baselinedur=30').notes.length === 1)
  check('T4a ?baselineswap 合法才收（拒 `..` 与奇怪字符）',
    P('baseline=1&baselineswap=3554161528').swapId === '3554161528'
    && P('baseline=1&baselineswap=../etc').swapId === null && P('baseline=1&baselineswap=a/b').swapId === null)
  check('T4a 三个开关名与 README-DIAGNOSTICS 主表一致（脚本抓取口径）',
    /\[\?&\]baseline=/.test(HTML) && /\[\?&\]baselinedur=/.test(HTML) && /\[\?&\]baselineswap=/.test(HTML))

  const opts = { swapId: 'B' }
  const st1 = mpwBaselineNextStage('A', { swapId: null }, null)
  check('T4b 无 ?baselineswap ⇒ single（只测当前包）', st1.role === 'single' && st1.final === true && st1.navTo === null)
  const st2 = mpwBaselineNextStage('A', opts, null)
  check('T4b 首段：primary → 存交接 + 跳到目标包', st2.role === 'primary' && st2.navTo === 'B' && st2.final === false && st2.saveHandoff === true)
  const h1 = { v: 1, originId: 'A', swapId: 'B', phases: [{ role: 'primary', snapshot: {} }] }
  const st3 = mpwBaselineNextStage('B', opts, h1)
  check('T4b 第二段：在目标包 ⇒ swapTo → 跳回起点包', st3.role === 'swapTo' && st3.navTo === 'A' && st3.final === false)
  const h2 = { v: 1, originId: 'A', swapId: 'B', phases: [{ role: 'primary', snapshot: {} }, { role: 'swapTo', snapshot: {} }] }
  const st4 = mpwBaselineNextStage('A', opts, h2)
  check('T4b 第三段：回到起点包 ⇒ swapBack → 合并上报并收尾', st4.role === 'swapBack' && st4.final === true && st4.saveHandoff === false)
  const st5 = mpwBaselineNextStage('C', opts, h2)
  check('T4b 交接与当前包对不上 ⇒ abort（就地收尾，**绝不**来回跳死循环）', st5.role === 'abort' && st5.final === true && st5.navTo === null)
  const st6 = mpwBaselineNextStage('A', { swapId: 'A' }, null)
  check('T4b 防自我导航：?baselineswap= 当前包 ⇒ single（否则原地刷新到死循环）', st6.role === 'single' && st6.navTo === null)

  const mkSnap = (id, total, fps) => ({ id, at: 'x', startup: { totalMs: total }, fps: { median: fps }, frames: { p50: 16.7 }, notes: [] })
  const handoff = { v: 1, originId: 'A', swapId: 'B', phases: [{ role: 'primary', snapshot: mkSnap('A', 900, 60) }, { role: 'swapTo', snapshot: mkSnap('B', 1500, 58) }] }
  const merged = mpwBaselineMergeHandoff(handoff, mkSnap('A', 1100, 59))
  check('T4c 合并：主指标取 primary 段（首段最干净）', merged.id === 'A' && merged.startup.totalMs === 900 && merged.fps.median === 60)
  check('T4c 合并：switch.swapTo / swapBack 各记一次（= 各自段的启动总耗时）',
    merged.switch.swapTo.ms === 1500 && merged.switch.swapTo.id === 'B' && merged.switch.swapBack.ms === 1100 && merged.switch.swapBack.id === 'A')
  check('T4c 合并：phases 摘要三段齐 + 口径 note', merged.phases.length === 3 && /整页导航口径/.test(merged.switch.note))
  check('T4c 无交接时合并退化为单段快照（不炸）',
    (() => { const m = mpwBaselineMergeHandoff(null, mkSnap('A', 1, 2)); return m.id === 'A' && m.switch !== null })())
}

/* ══════════════ T5 闸门 + 默认关真源码跑 + 真服务端到端 ══════════════ */
console.log('\n== T5 baseline-diff 闸门（纯函数 + CLI 退出码 + env 覆盖）==')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-baseline-'))
const mkSnap = (o) => {
  const s = mpwBaselineCreateSampler({ opts: { durationSec: 10, windowMs: 500, startupFrameTarget: 90 }, state: () => ({ texMissing: 0 }) })
  const dt = o.dt || (1000 / 60)   // 缺省 60fps（曾经漏默认值 ⇒ 时间戳全是 NaN ⇒ 造出 0 帧的假快照，测试自己先崩）
  for (let i = 0; i < (o.frames || 620); i++) s.noteFrame(300 + i * dt, i + 1)
  return s.build({
    id: o.id || 'sample-synthetic', url: 'u', ua: 'ua', flags: {},
    counts: { layers: 5, textures: 3, glTexturesLive: 4, glFbosLive: 2, drawCalls: 1200, uploads: 6, uploadBytes: 1000 },
    vramProxy: { textureBytesEst: o.tex || 2048, jsHeapUsedBytes: 100000 },
  })
}
const writeJson = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(obj)); return p }
{
  const base = mkSnap({ dt: 1000 / 60 })
  const same = mkSnap({ dt: 1000 / 60 })
  const degraded = mkSnap({ dt: 20, tex: 20000 })
  const a = writeJson('base.json', base), b = writeJson('same.json', same), c = writeJson('bad.json', degraded)
  const pA = writeJson('pretty.json', base)

  check('T5a 相同输入：0 项退化', compareSnapshots(base, same, THRESHOLDS).regressions.length === 0)
  const reg = compareSnapshots(base, degraded, THRESHOLDS)
  check('T5a 人为构造退化（帧间隔 +20%、纹理 +877%）：逐项报退化',
    reg.regressions.some((r) => r.path === 'frames.p50') && reg.regressions.some((r) => r.path === 'vramProxy.textureBytesEst')
    && reg.regressions.some((r) => r.path === 'fps.median'),
    reg.regressions.map((r) => r.path).join(','))
  check('T5a 噪声地板：|Δ| ≤ floor 一律不判退化（这里 0.2ms 抖动）',
    (() => { const x = JSON.parse(JSON.stringify(base)); x.frames = { ...x.frames, p50: x.frames.p50 + 0.2 }; return compareSnapshots(base, x, THRESHOLDS).regressions.length === 0 })())
  check('T5a 方向语义：FPS 上升不判退化、帧间隔下降不判退化',
    (() => { const x = JSON.parse(JSON.stringify(base)); x.fps = { ...x.fps, median: base.fps.median + 5 }; x.frames = { ...x.frames, p50: base.frames.p50 - 2 }; return compareSnapshots(base, x, THRESHOLDS).regressions.length === 0 })())
  check('T5a 基线为 0：两侧都 0 → 0% 不退化；cur>0 → +∞ 必须报',
    (() => {
      const z = JSON.parse(JSON.stringify(base)); z.counts = { ...z.counts, glFbosLive: 0 }
      const z2 = JSON.parse(JSON.stringify(z))
      const z3 = JSON.parse(JSON.stringify(z)); z3.counts = { ...z3.counts, glFbosLive: 9 }
      return compareSnapshots(z, z2, THRESHOLDS).regressions.length === 0 && compareSnapshots(z, z3, THRESHOLDS).regressions.length === 1
    })())
  check('T5a 一侧未采集（如未开 ?baselineswap 的 switch.*）→ 跳过而非当 0 比',
    compareSnapshots(base, same, THRESHOLDS).skipped.some((r) => r.path === 'switch.swapTo.ms'))
  check('T5a 阈值集中一处且 env 覆盖表齐全（9 个键一一对应）',
    Object.keys(THRESHOLDS).length === Object.keys(ENV_OF).length && Object.keys(THRESHOLDS).every((k) => ENV_OF[k] && ENV_OF[k].startsWith('MPW_BASELINE_TH_')))
  check('T5a env 覆盖生效；非法 env 被忽略（配错阈值 ≠ 关掉闸门）',
    resolveThresholds({ MPW_BASELINE_TH_FRAME_PCT: '5' }).values.framePct === 5
    && resolveThresholds({ MPW_BASELINE_TH_FRAME_PCT: 'abc' }).values.framePct === THRESHOLDS.framePct
    && resolveThresholds({ MPW_BASELINE_TH_STARTUP_PCT: '-1' }).values.startupPct === THRESHOLDS.startupPct)

  const run = (args, env) => {
    try { const out = execFileSync('node', ['tools/baseline-diff.mjs', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(env || {}) } }); return { rc: 0, out } }
    catch (e) { return { rc: e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
  }
  const r1 = run([a, b])
  check('T5b CLI：相同输入 → 退出码 0（可当回归闸门放行）', r1.rc === 0, 'rc=' + r1.rc)
  const r2 = run([a, c, '--quiet'])
  check('T5b CLI：人为退化 → 退出码 1 + 明细行', r2.rc === 1 && /退化/.test(r2.out), 'rc=' + r2.rc)
  const r3 = run([a, c, '--quiet'], { MPW_BASELINE_TH_FRAME_PCT: '200', MPW_BASELINE_TH_FPS_PCT: '200', MPW_BASELINE_TH_VRAM_PCT: '9999' })
  check('T5b CLI：env 放宽阈值后同一对快照 → 退出码 0（阈值真的可覆盖）', r3.rc === 0, 'rc=' + r3.rc)
  const r4 = run([a, path.join(tmp, 'nope.json')])
  check('T5b CLI：文件不存在 → 退出码 2（用法/输入错误，不是"退化"）', r4.rc === 2, 'rc=' + r4.rc)
  const badJson = path.join(tmp, 'broken.json'); fs.writeFileSync(badJson, '{oops')
  check('T5b CLI：坏 JSON → 退出码 2', run([a, badJson]).rc === 2)
  const incomplete = writeJson('incomplete.json', { kind: 'baseline', schema: 1 })
  const r5 = run([a, incomplete])
  check('T5b CLI：残缺快照 → 退出码 2 + 报出缺哪些字段', r5.rc === 2 && /缺字段/.test(r5.out), 'rc=' + r5.rc)
  const other = writeJson('other.json', mkSnap({ id: 'other-id' }))
  check('T5b CLI：--require-same-id 时 id 不同 → 退出码 2；默认只告警（rc=0）',
    run([a, other, '--require-same-id']).rc === 2 && run([a, other]).rc === 0)
  const rj = run([a, c, '--json'])
  check('T5b CLI：--json 机读输出含 ok/regressions/thresholds', (() => { try { const j = JSON.parse(rj.out); return j.ok === false && Array.isArray(j.regressions) && j.thresholds.framePct === THRESHOLDS.framePct } catch (e) { return false } })())
  check('T5b CLI：未知选项 → 退出码 2', run([a, b, '--wat']).rc === 2)
  check('T5c METRICS 覆盖任务书点名的四类指标（FPS / 帧耗时 / 启动 / 切换）',
    ['fps.median', 'frames.p50', 'startup.totalMs', 'switch.swapTo.ms', 'switch.swapBack.ms', 'vramProxy.textureBytesEst'].every((p) => METRICS.some((m) => m.path === p)))
  check('T5c 快照文件是合法 JSON 且能被 diff 工具读回（同一份 schema）', (() => { try { return mpwValidateSnapshot(JSON.parse(fs.readFileSync(pA, 'utf8'))).ok } catch (e) { return false } })())
}

/* ══════════════ T5g 趋势脚本遇到"半截快照"不许当场炸掉 ══════════════
 * 现场（2026-09-18）：一次被中断的采集在 `reports/real-machine/` 留下 5 字节文件，内容字面量 `null`。
 * `JSON.parse('null')` **不抛**，于是 `tests/baseline-trend.mjs` 在 `o.file = rel(file)` 那行以
 * `TypeError: Cannot set properties of null` 崩掉 —— 症状是"趋势门禁红"，真因是"有份数据没写完"，
 * 两者都该报红但报法完全不同（要能一眼看出是哪份文件、坏在哪）。本组用**真子进程**钉死这条行为：
 * 坏输入 ⇒ 退出码 1 + 指名文件；同一目录里的好报告仍照常入表；删掉坏文件 ⇒ 回到 0。
 * 变异检验：把 `tests/baseline-trend.mjs` 里那段 `顶层不是 JSON 对象` 的守卫删掉 ⇒ 本组必红（见 PATCHES P-115）。 */
console.log('\n== T5g 趋势脚本对半截快照的容错（坏输入报红，不崩在赋值行） ==')
{
  const runTrend = (dir) => {
    try { const out = execFileSync('node', ['tests/baseline-trend.mjs', '--dir=' + dir], { cwd: ROOT, encoding: 'utf8' }); return { rc: 0, out } }
    catch (e) { return { rc: e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
  }
  const good = { kind: 'real-machine', schema: 1, at: '2026-09-18T01:00:00.000Z', id: 'synthetic-trend', startup: { totalMs: 1200 } }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-trend-'))
  const rm = path.join(d, 'real-machine'); fs.mkdirSync(rm, { recursive: true })
  fs.writeFileSync(path.join(rm, '1000.json'), JSON.stringify(good))
  // ① 半截文件（内容字面量 null）——就是现场那 5 字节
  fs.writeFileSync(path.join(rm, '2000.json'), 'null')
  const r = runTrend(d)
  check('T5g 目录里有 `null` 半截快照 → 退出码 1（坏输入=红），且**不**以 TypeError 崩掉',
    r.rc === 1 && !/TypeError/.test(r.out), 'rc=' + r.rc + (r.rc !== 1 ? ' / ' + r.out.slice(0, 120) : ''))
  check('T5g 报错**指名文件** + 说清"顶层不是 JSON 对象" + 带上原文片段（能直接定位是半截文件）',
    /2000\.json/.test(r.out) && /顶层不是 JSON 对象/.test(r.out) && /"null"/.test(r.out))
  check('T5g 同一目录里的好报告仍照常入表（不是"一份坏就全丢"）', /synthetic-trend/.test(r.out) && /趋势表/.test(r.out))
  // ② 其它非对象顶层：数字 / 字符串 / 数组（同样过得了 JSON.parse）
  for (const [n, body] of [['num', '5'], ['str', '"x"'], ['arr', '[1,2]']]) {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-trend-' + n + '-'))
    fs.mkdirSync(path.join(d2, 'real-machine'), { recursive: true })
    fs.writeFileSync(path.join(d2, 'real-machine', '3000.json'), body)
    const rr = runTrend(d2)
    check('T5g 顶层是 ' + n + '（' + body + '）→ 退出码 1 且不崩', rr.rc === 1 && !/TypeError/.test(rr.out), 'rc=' + rr.rc)
    fs.rmSync(d2, { recursive: true, force: true })
  }
  // ③ 手工处置的等价动作：删掉坏文件 → 回到 0（该脚本的既有语义不变）
  fs.rmSync(path.join(rm, '2000.json'))
  const r2 = runTrend(d)
  check('T5g 删掉半截文件后 → 退出码 0（2026-09-18 的手工处置，现在脚本自己会报红）', r2.rc === 0, 'rc=' + r2.rc)
  // ④ "没数据" ≠ "数据坏了"：空目录仍然 SKIP + rc 0
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-trend-empty-'))
  const r3 = runTrend(empty)
  check('T5g 一份都快照都没有 → `SKIP baseline-trend` + 退出码 0（条件项，门禁不红）',
    r3.rc === 0 && /^SKIP baseline-trend/m.test(r3.out), 'rc=' + r3.rc)
  fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(empty, { recursive: true, force: true })
}

console.log('\n== T5d 默认关时零行为变化（demo.html 真源码切片 + 桩 DOM/桩 gl 跑） ==')
{
  const block = sliceMarks(HTML, '// ═══ MPW-BASELINE-BEGIN', '// ═══ MPW-BASELINE-END ═══')
  check('T5d 采集块在位（标记切片非空）', block.length > 3000, block.length + ' 字符')
  check('T5d 采集块内**没有**定时器（不新起 rAF/setInterval/timeout 之外的循环）', !/setInterval\s*\(/.test(block))
  check('T5d GL 包装在"开"的门控里（源码位置：门控在包装之前）',
    block.indexOf('MPW_BASELINE_OPTS.on) {') > 0 && block.indexOf('mpwBaselineInstallGlCounters') > block.indexOf('MPW_BASELINE_OPTS.on) {'))
  check('T5d 帧循环里的调用点是**唯一**一处且是 null 短路',
    (HTML.split('if (MPW_BASELINE) MPW_BASELINE.onFrame(').length - 1) === 1)
  // ①(P-135 乙 2026-09-19) POST 现在走 demo.html 的 `fetchT('/baseline', …)`（统一超时包装）——
  //   **判定口径一字不变**（仍必须是 /baseline，不是 /report），只是接受被包装后的写法。
  check('T5d 结果走 `/baseline`（不是 /report：趋势数据不能被 60 份滚动清掉）', /(?:fetchT|fetch)\('\/baseline'/.test(block))
  check('T5d 开关名登记给 diag-flag-check（正则字面量）', /MPW_BASELINE_FLAGS = \[/.test(block))

  // 把真源码切出来跑：`new Function` 与 props-panel/log-panel 的切片驱动同一套手法
  const makeEnv = (search) => {
    const logs = [], posts = [], badges = []
    const fakeGl = {
      RGBA: 6408, RGBA8: 32856, RGBA16F: 34842, RGBA32F: 34836, RGB: 6407, R8: 33321, RG8: 33323, RED: 6403,
      MAX_TEXTURE_SIZE: 3379, VENDOR: 7936, RENDERER: 7937, VERSION: 7938,
      _f: 0,
      getParameter(k) { return k === 3379 ? 4096 : ('p' + k) },
      createFramebuffer() { return { f: ++this._f } }, deleteFramebuffer() {},
      createTexture() { return { t: Math.random() } }, deleteTexture() {},
      texImage2D() {}, texSubImage2D() {}, drawArrays() {}, drawElements() {},
    }
    const store = new Map()
    const env = {
      logs, posts, badges,
      location: { href: 'http://127.0.0.1:8899/?id=sample-synthetic' + search, search },
      sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
      document: { createElement: () => ({ style: {}, textContent: '' }), body: { appendChild: (el) => badges.push(el.textContent) } },
      navigator: { userAgent: 'node-test', hardwareConcurrency: 8 },
      devicePixelRatio: 1,
      gl: fakeGl, cv: { width: 1920, height: 1080 },
      scene: { layers: [{ visible: true, textureName: 'tex/a' }, { visible: false, textureName: 'tex/b' }] },
      textures: new Map([['tex/a', { width: 10, height: 10 }]]),
      id: 'sample-synthetic', PAGE: true,
      logf: (m) => logs.push(String(m)),
      fetch: async (u, o) => { posts.push({ u, o }); return { ok: true, status: 200, json: async () => ({ ok: true, file: 'baselines/1.json' }) } },
      // ①(P-135 乙 2026-09-19) demo.html 本块现在用模块级 `fetchT/jsonT/NET_TIMEOUT_MS`（统一超时包装）：
      //   切片环境按既有手法把这三个也当入参注入 —— fetchT 直接转发到同一个桩（posts 记录口径不变），
      //   jsonT 就是"ok 才解析"的薄包装（与 demo.html 里的语义一致）。
      fetchT: (u, o) => env.fetch(u, o),
      jsonT: async (r) => (r && r.ok ? r.json() : null),
      NET_TIMEOUT_MS: 8000,
      lib: { registerMpwHook: () => true },
      mpw: { mpwBaselineParseOpts, mpwBaselineCreateSampler, mpwBaselineInstallGlCounters, mpwBaselineNextStage, mpwBaselineMergeHandoff },
    }
    return env
  }
  const runBlock = (blockSrc, env, win) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function('mpwBaselineParseOpts', 'mpwBaselineCreateSampler', 'mpwBaselineInstallGlCounters', 'mpwBaselineNextStage', 'mpwBaselineMergeHandoff',
      'location', 'sessionStorage', 'document', 'navigator', 'devicePixelRatio', 'gl', 'cv', 'scene', 'textures', 'id', 'PAGE', 'logf', 'fetch', 'lib', 'window',
      'fetchT', 'jsonT', 'NET_TIMEOUT_MS',
      blockSrc + '\nreturn MPW_BASELINE;')
    return fn(env.mpw.mpwBaselineParseOpts, env.mpw.mpwBaselineCreateSampler, env.mpw.mpwBaselineInstallGlCounters,
      env.mpw.mpwBaselineNextStage, env.mpw.mpwBaselineMergeHandoff,
      env.location, env.sessionStorage, env.document, env.navigator, env.devicePixelRatio, env.gl, env.cv, env.scene,
      env.textures, env.id, env.PAGE, env.logf, env.fetch, env.lib, win || {},
      env.fetchT, env.jsonT, env.NET_TIMEOUT_MS)
  }

  // ① 不带开关：必须什么都不做（不包装 GL、不记账、不发请求、不建定时器）
  const e0 = makeEnv('')
  const rawCreate = e0.gl.createFramebuffer
  const r0 = runBlock(block, e0)
  check('T5d **默认关**：MPW_BASELINE === null', r0 === null)
  check('T5d 默认关：GL 未被包装（gl.__mpwBaselineCounters 不存在、createFramebuffer 原样）',
    e0.gl.__mpwBaselineCounters === undefined && e0.gl.createFramebuffer === rawCreate)
  check('T5d 默认关：零日志、零请求、零徽标', e0.logs.length === 0 && e0.posts.length === 0 && e0.badges.length === 0)
  const e0b = makeEnv('&baselinedur=5')
  const r0b = runBlock(block, e0b)
  check('T5d 只写 ?baselinedur（没写 ?baseline）⇒ 仍然关，但**说一句**（写了没生效不许静默）',
    r0b === null && e0b.logs.some((l) => /基线采集=关/.test(l)))

  // ② 带开关：真跑满时长 → 快照 POST 出去（无浏览器也能验完整链路）
  const e1 = makeEnv('&baseline=1&baselinedur=2')
  const win1 = {}
  const rawCreate1 = e1.gl.createFramebuffer
  const r1 = runBlock(block, e1, win1)
  check('T5d 开了：返回采集器对象且 GL 被包装（同一 gl 幂等）', !!r1 && typeof r1.onFrame === 'function' && e1.gl.__mpwBaselineCounters !== undefined && e1.gl.createFramebuffer !== rawCreate1)
  check('T5d 开了：启动日志写明时长/窗口/结果去向（并声明 VRAM 只有代理）',
    e1.logs.some((l) => /基线采集已启用/.test(l) && /reports\/baselines\//.test(l) && /代理估算/.test(l)))
  // 喂 60fps 帧直到到点收口（2s 时长 ⇒ 约第 121 帧）；同时造一次 FBO/纹理使用，验证代理计数进了快照
  e1.gl.createFramebuffer()
  e1.gl.createTexture(); e1.gl.texImage2D(3553, 0, e1.gl.RGBA, 64, 64, 0, e1.gl.RGBA, 5121, null)
  e1.gl.drawArrays()
  for (let i = 0; i < 400 && e1.posts.length === 0; i++) r1.onFrame(300 + i * (1000 / 60), i + 1)
  await new Promise((r) => setTimeout(r, 30))   // 回传成功后的日志/徽标在 fetch 的 Promise 里 ⇒ 放一拍再断言
  check('T5d 开了：到点自动收口并 POST 到 /baseline（只发一次）', e1.posts.length === 1 && /\/baseline$/.test(e1.posts[0].u))
  const posted = (() => { try { return JSON.parse(e1.posts[0].o.body) } catch (e) { return null } })()
  check('T5d 回报的快照**完整通过校验**（服务端不会再 400）', !!posted && mpwValidateSnapshot(posted).ok, JSON.stringify(posted && mpwValidateSnapshot(posted).errors))
  check('T5d 快照里的时长/帧数属实（2s 目标 ⇒ 2.0–2.2s、帧数 >100）',
    posted && near(posted.fps.median, 60, 0.5) && posted.window.frames > 100 && posted.window.actualSec >= 2 && posted.window.actualSec < 2.2,
    posted ? ('fps=' + posted.fps.median + ' frames=' + posted.window.frames + ' sec=' + posted.window.actualSec) : 'null')
  check('T5d 快照里代理计数来自真 gl（FBO 1 / 纹理 1 / 64²×4 = 16384B）',
    posted && posted.counts.glFbosLive === 1 && posted.counts.glTexturesLive === 1 && posted.vramProxy.textureBytesEst === 16384,
    posted ? JSON.stringify(posted.counts) : 'null')
  check('T5d 快照里就绪判据 = 纹理齐全（stub scene 无缺纹理）',
    posted && posted.startup.readyReason === 'tex-complete' && posted.startup.totalMs > 0)
  check('T5d 页面给一行摘要徽标（用户不用翻控制台）', e1.badges.length === 1 && /基线快照/.test(e1.badges[0]) && /baselines\/1\.json/.test(e1.badges[0]), e1.badges[0])
  check('T5d 全局暴露 window.__mpwBaselineSnapshot 供手工取数（回传失败的兜底）',
    !!win1.__mpwBaselineSnapshot && win1.__mpwBaselineSnapshot.kind === 'baseline' && mpwValidateSnapshot(win1.__mpwBaselineSnapshot).ok)
  // ③ 回传失败也不静默：日志给出可操作的下一步 + 徽标转红
  const e3 = makeEnv('&baseline=1&baselinedur=2')
  e3.fetch = async () => { throw new Error('boom') }
  const r3 = runBlock(block, e3, {})
  for (let i = 0; i < 400 && e3.badges.length === 0; i++) r3.onFrame(300 + i * (1000 / 60), i + 1)
  await new Promise((r) => setTimeout(r, 30))
  check('T5d 回传失败：日志/徽标都说明失败并指向 window.__mpwBaselineSnapshot',
    e3.logs.some((l) => /基线快照回传失败/.test(l) && /__mpwBaselineSnapshot/.test(l)) && e3.badges.some((b) => /回传失败/.test(b)))
  // ④ 切换三阶段：首段存交接 + 构造换包 URL（不真跳，只验交接与 URL）
  const e2 = makeEnv('&baseline=1&baselinedur=2&baselineswap=other-pkg')
  const r2 = runBlock(block, e2, {})
  check('T5d 切换测量：启动日志点名目标包与阶段判据', e2.logs.some((l) => /切换测量目标 other-pkg/.test(l)))
  for (let i = 0; i < 400 && !e2.sessionStorage.getItem('mpw-baseline-handoff'); i++) r2.onFrame(300 + i * (1000 / 60), i + 1)
  check('T5d 切换测量：首段完成后日志说明"跳转"并给出总时长 ×3',
    e2.logs.some((l) => /切换测量第 1\/3 段/.test(l) && /总计约 6s/.test(l)))
  const hand = (() => { try { return JSON.parse(e2.sessionStorage.getItem('mpw-baseline-handoff')) } catch (e) { return null } })()
  check('T5d 切换测量：首段快照存进 sessionStorage 交接（供第 3 段合并）',
    !!hand && hand.originId === 'sample-synthetic' && hand.swapId === 'other-pkg' && hand.phases.length === 1 && hand.phases[0].role === 'primary',
    JSON.stringify(hand && { o: hand.originId, s: hand.swapId, n: hand.phases.length }))
  check('T5d 切换测量：首段**不**上报（等第三段合并成一份）', e2.posts.length === 0)
}

console.log('\n== T5e 服务端 /baseline 端到端（真子进程 + 真落盘 + 上限） ==')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-baseline-srv-'))
  const logPath = path.join(dir, 'server.log')
  const fd = fs.openSync(logPath, 'a')
  const port = await freePort()
  const child = spawn(process.execPath, ['server/we-scene-demo-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MPW_REPORTS_DIR: dir, MPW_LIMIT_BASELINE_MAX: '3' },
    stdio: ['ignore', fd, fd],
  })
  const base = 'http://127.0.0.1:' + port
  const log = () => { try { return fs.readFileSync(logPath, 'utf8') } catch { return '' } }
  try {
    let up = false
    for (let i = 0; i < 120 && !up; i++) {
      if (child.exitCode !== null) break
      try { await fetch(base + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); up = true } catch { await new Promise((r) => setTimeout(r, 150)) }
    }
    check('T5e 服务起来了', up)
    const post = async (bodyObj, raw) => {
      const r = await fetch(base + '/baseline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw !== undefined ? raw : JSON.stringify(bodyObj) })
      let j = null; try { j = await r.json() } catch (e) {}
      return { status: r.status, j }
    }
    const snap = mkSnap({})
    const okRes = await post(snap)
    const fileRel = (okRes.j && okRes.j.file) || null
    check('T5e 合法快照 → 200 + 返回相对路径 baselines/<ts>.json',
      okRes.status === 200 && okRes.j && okRes.j.ok === true && !!fileRel && /^baselines\/\d+(-\d+)?\.json$/.test(fileRel), JSON.stringify(okRes.j))
    check('T5e 真的落盘到 reports/baselines/（内容 = 提交的快照）',
      !!fileRel && (() => { const fp = path.join(dir, fileRel); return fs.existsSync(fp) && JSON.parse(fs.readFileSync(fp, 'utf8')).id === 'sample-synthetic' })())
    const badRes = await post({ kind: 'baseline', schema: BASELINE_SCHEMA })
    check('T5e 残缺快照 → 400 + 列出缺哪些字段（趋势目录只收干净数据）',
      badRes.status === 400 && badRes.j && badRes.j.ok === false && Array.isArray(badRes.j.errors) && badRes.j.errors.length > 0)
    const badJson = await post(null, '{oops')
    check('T5e 坏 JSON → 400', badJson.status === 400)
    for (let i = 0; i < 5; i++) await post(mkSnap({}))
    const names = fs.readdirSync(path.join(dir, 'baselines')).filter((n) => /^\d+/.test(n)).sort()
    check('T5e 上限滚动：灌 6 份（上限 3）⇒ 只留 3 份、最旧的被删',
      names.length === 3, 'n=' + names.length)
    const srvSrcStatic = await fetch(base + '/baseline-metrics.mjs')
    const bodyTxt = await srvSrcStatic.text()
    check('T5e 静态路由 /baseline-metrics.mjs 200（demo.html 的相对 import 能解析）',
      srvSrcStatic.status === 200 && /mpwBaselineCreateSampler/.test(bodyTxt))
    const getRes = await fetch(base + '/baseline')
    check('T5e GET /baseline → 405（语义明确，不是静默 404）', getRes.status === 405)
    check('T5e 启动日志播报 baselines 上限（现场一眼看到）', /\[limits\] 启动清理完成/.test(log()) && /baselines \d+ 份\/\d+MB/.test(log()))
    check('T5e 写入日志带 id/fps/启动耗时（服务端留痕）', /\[baseline\].*id=sample-synthetic/.test(log()))
  } finally {
    try { child.kill('SIGKILL') } catch (e) { /* ignore */ }
  }
}

console.log('\n== T5f 登记与文档（口径可核对） ==')
{
  const runAll = fs.readFileSync(path.join(ROOT, 'tests', 'run-all-tests.sh'), 'utf8')
  const readme = fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8')
  const tbl = sliceMarks(readme, '<!-- FLAG-TABLE-BEGIN -->', '<!-- FLAG-TABLE-END -->')
  check('T5f run-all-tests.sh 已注册 baseline 项（追加在 add 列表末尾）',
    /add "baseline"\s+"node tests\/baseline-test\.mjs"/.test(runAll))
  check('T5f README-DIAGNOSTICS 主表登记 baseline / baselinedur / baselineswap 三行',
    /^\|\s*`baseline`\s*\|/m.test(tbl) && /^\|\s*`baselinedur`\s*\|/m.test(tbl) && /^\|\s*`baselineswap`\s*\|/m.test(tbl))
  check('T5f docs/BASELINE.md 在位且写明 VRAM 代理局限与真机跑法',
    (() => {
      const p = path.join(ROOT, 'docs', 'BASELINE.md')
      if (!fs.existsSync(p)) return false
      const md = fs.readFileSync(p, 'utf8')
      return /拿不到/.test(md) && /代理/.test(md) && /\?baseline=1/.test(md) && /baseline-diff/.test(md) && /MPW_BASELINE_TH_/.test(md)
    })())
  check('T5f README.md 指向 docs/BASELINE.md', /BASELINE\.md/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')))
  check('T5f 服务端上限唯一来源 MPW_LIMITS 含 baselines 两项',
    /baselineMaxFiles: numEnv\('MPW_LIMIT_BASELINE_MAX'/.test(SERVER_SRC) && /baselineMaxBytes: numEnv\('MPW_LIMIT_BASELINE_BYTES'/.test(SERVER_SRC))
  check('T5f 服务端 /baseline 写入前后各清理一次（与 /report 同纪律）',
    (SERVER_SRC.split('pruneBaselines(MPW_REPORTS_DIR)').length - 1) >= 3)   // 启动 + 写前 + 写后
  check('T5f PATCHES.md 有 P-109-BASELINE 一节', /^## P-109-BASELINE/m.test(fs.readFileSync(path.join(ROOT, 'docs', 'PATCHES.md'), 'utf8')))
  check('T5f build-pages 白名单收录新模块（线上 demo 的相对 import 不 404）',
    /core\/baseline-metrics\.mjs', 'baseline-metrics\.mjs'/.test(fs.readFileSync(path.join(ROOT, 'build-pages.mjs'), 'utf8')))
}

try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
console.log('\n' + (fail ? fail + ' 项失败' : 'ALL PASS （' + pass + ' 项）'))
process.exit(fail ? 1 : 0)

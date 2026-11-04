// mesh-badframe-test.mjs — P-41 A1-b 网格动画坏帧检测 v3（detectBadAnimFrames）单测
// 复现：node mesh-badframe-test.mjs
// 背景（真机 r1789233100291 + 2026-09-12 demo 注释"每条轨道存 length+1 帧，结尾 1~17 帧是导出垃圾"）：
//   旧"迭代二阶差分（骨骼和）"过滤器三个结构性缺陷——
//   ①垃圾平台内部帧漏杀（hina 人物 f67-69,71,72 存活 → 周期性抽动）；
//   ②回绕污染（f0 的环形邻居是尾部垃圾 → f0-3 级联误杀 → 开头姿态错）；
//   ③骨骼和抵消单骨乱跳（sig 把 58-61 好帧也拖下水）。
//   v3 = 尾部逐骨绝对步长切除（垃圾=结尾连续后缀）+ 原邻域精修（中段孤立尖峰）。
//
// ①(P-139 2026-09-19) **本测试的"真数据尾部垃圾"前提已被推翻**：上面三条缺陷的真身不是"导出垃圾"，
//   而是渲染采样器 `puppet.js::_sampleAnimRT` 的**旧式寻址**（`((frame+posShift)%totalFrames)*36 +
//   (2b%9)*4`，把每骨行移位折进帧号取模）。P-139 把渲染路径接到唯一实现处
//   `core/attach-transform.mjs::sampleAnimRT`（官方逐行同址）后逐字节复核：
//     · 主体 f174-179 的**逐骨局部量逐位等于帧 0**（`sampleBoneLocalsRT` 实测 f179 vs f0 差 ≤0.001u）；
//     · 逐帧最大步长：主体 **1.55u**、眼睛组合 **7.13u**、左耳朵1 **31.86u**（旧式分别是 699/366/157）；
//     · 尾部（末 12 帧）步长全为 **0.0u** ⇒ **没有垃圾尾巴可切**。
//   ⇒ 本文件里"真数据命中尾部垃圾"的断言改为：① 钉住"修正采样器下真数据无坏帧"（分析器必须报空，
//     这是新事实）；② 用**合成注入的尾部垃圾**继续钉住 v3 检测器的能力（安全性不能因数据变干净而丢失）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const DIR = `${MPW_WS}/allwallpaper/dd`
const dec = new TextDecoder()
const H = {}
installPuppet(H)

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const dOf = (a, c) => Math.abs(c.tx - a.tx) + Math.abs(c.ty - a.ty) + Math.abs(c.angle - a.angle) * 100

// 旧检测器（逐字复刻 demo.html 修复前实现，用于证明"测试抓得到旧 bug"）
function oldDetect(sig) {
  const rawLen = sig.length
  const step = new Float64Array(rawLen)
  for (let f = 0; f < rawLen; f++) step[f] = Math.abs(sig[(f + 1) % rawLen] - sig[f])
  const bad = new Set()
  for (let pass = 0; pass < 4; pass++) {
    const goodIdx = []
    for (let f = 0; f < rawLen; f++) if (!bad.has(f)) goodIdx.push(f)
    if (goodIdx.length < 4) break
    const dev = new Float64Array(rawLen)
    for (const f of goodIdx) {
      let pg = f, ng = f
      for (let k = 1; k <= rawLen; k++) { const i = (f - k + rawLen * 4) % rawLen; if (!bad.has(i)) { pg = i; break } }
      for (let k = 1; k <= rawLen; k++) { const i = (f + k) % rawLen; if (!bad.has(i)) { ng = i; break } }
      dev[f] = Math.abs(sig[f] - (sig[pg] + sig[ng]) / 2)
    }
    const ds = goodIdx.map((f) => dev[f]).sort((x, y) => x - y)
    const med = ds.length ? ds[ds.length >> 1] : 0
    const thr = Math.max(med * 10, 5)
    let added = 0
    for (const f of goodIdx) {
      let ls = 0
      for (let k = -2; k <= 2; k++) { const i = (f + k + rawLen * 4) % rawLen; if (step[i] > ls) ls = step[i] }
      if (dev[f] > thr && dev[f] > 0.45 * ls) { bad.add(f); added++ }
    }
    if (!added) break
  }
  return bad
}

// ── T1 合成：正常帧（逐骨步长~2）+ 尾部垃圾后缀（步长~500，与骨和抵消无关）──
console.log('[T1] 合成信号：好帧步长~2，最后 13 帧垃圾步长~500')
{
  const N = 75
  const sig = new Float64Array(N)
  const maxStep = new Float64Array(N)
  for (let f = 0; f < N; f++) { sig[f] = Math.sin(f / N * Math.PI * 2) * 100; maxStep[f] = 2 }
  for (let f = 62; f < N; f++) { maxStep[f] = 500; sig[f] = 50000 + (f % 3) * 37 }
  const v2 = lib.detectBadAnimFrames({ sig, maxStep })
  const old = oldDetect(sig)
  const tail = []
  for (let f = 62; f < N; f++) tail.push(f)
  const missed = tail.filter((f) => !v2.bad.has(f))
  const headEaten = [0, 1, 2, 3].filter((f) => v2.bad.has(f))
  check('T1a v3 把尾部垃圾整段切除', missed.length === 0, missed.length ? '漏 ' + missed.join(',') : '62-74 全灭')
  check('T1b v3 不吃动画开头 0-3 帧（回绕污染修复）', headEaten.length === 0, headEaten.join(',') || '0-3 全保留')
  check('T1c 中段合法快速段不受影响（非尾部 >T 不判）', !v2.bad.has(30) && !v2.bad.has(45))
  const oldMissed = [67, 68, 69, 71, 72].filter((f) => !old.has(f))
  const oldHead = [0, 1, 2, 3].filter((f) => old.has(f))
  check('T1d 旧检测器头部误杀复现（合成 ' + oldHead.length + ' 帧；真数据平台内部漏杀见 T2d/T2c 设备日志逐位）',
    oldHead.length > 0)
}

// ── T2/T3 真数据：全部 6 个蒙皮层 ──
function meshLayersOf(id) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(DIR, id, 'scene.pkg'))))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const scene = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')))
  const out = []
  for (const l of scene.layers) {
    try {
      if (!l.image) continue
      const me = entry(l.image); if (!me) continue
      const mj = JSON.parse(dec.decode(me)); if (!mj || !mj.puppet) continue
      const ru = entry(mj.puppet); if (!ru) continue
      const mesh = H._parseMdl(new MpwBuffer(ru.buffer, ru.byteOffset, ru.byteLength))
      if (!mesh || !mesh.bones || !mesh.bones.length || !mesh.animations || !mesh.animations.length) continue
      out.push({ name: String(l.name || l.id), mesh, nb: mesh.bones.length, anim: mesh.animations[0] })
    } catch (e) { /* 与 demo 一致 */ }
  }
  return out
}
function profilesOf(t) {
  const N = t.anim.frameCount
  const sig = new Float64Array(N), maxStep = new Float64Array(N)
  const rt = (f) => H._sampleAnimRT(t.mesh, t.anim, f, t.nb, t.mesh.bones)
  for (let f = 0; f < N; f++) {
    const a = rt(f); let sum = 0, mx = 0
    for (let b = 0; b < t.nb; b++) {
      sum += a[b].tx + a[b].ty + a[b].angle * 100
      const d = dOf(a[b], rt((f + 1) % N)[b])
      if (d > mx) mx = d
    }
    sig[f] = sum; maxStep[f] = mx
  }
  return { sig, maxStep, N }
}

console.log('[T2] 真数据 hina 3554161528「人物」（设备日志实锤：旧=16/75 [0-3+58-66,70,73,74]）')
{
  const ls = meshLayersOf('3554161528')
  const renwu = ls.find((x) => x.name === '人物')
  check('T2-0 找到蒙皮层「人物」', !!renwu, ls.map((x) => x.name).join('/'))
  if (renwu) {
    const { sig, maxStep, N } = profilesOf(renwu)
    const v3 = lib.detectBadAnimFrames({ sig, maxStep })
    const old = oldDetect(sig)
    const badArr = [...v3.bad].sort((a, b) => a - b)
    const headKept = [0, 1, 2, 3].every((f) => !v3.bad.has(f))
    // 垃圾=尾部连续后缀（设备日志与逐骨剖面：61 起步长爆发，62-74 全灭）
    const isSuffix = badArr.length > 0 && badArr.every((f, i) => f === N - badArr.length + i)
    check('T2a v3 保留动画开头 0-3 帧', headKept, 'bad=[' + badArr.join(',') + ']')
    // ①(P-139) 修正采样器下真数据 f62-74 步长全部正常（旧式的"垃圾平台"= 寻址回绕读到的邻轨字节）
    let tailMax = 0
    for (let f = 60; f < N; f++) tailMax = Math.max(tailMax, maxStep[f])
    check('T2b 修正采样器下真数据无坏帧（v3 报空；尾部 f60-74 逐骨最大步长 ≤8u）',
      v3.bad.size === 0 && tailMax <= 8, badArr.length + ' 帧 bad=[' + badArr.join(',') + '] 尾部 maxStep=' + tailMax.toFixed(2) + 'u')
    {
      const ms = Float64Array.from(maxStep)
      for (let f = 65; f <= 74; f++) ms[f] = Math.max(ms[f], 50) * 50
      const arr = [...lib.detectBadAnimFrames({ sig, maxStep: ms }).bad].sort((a, b) => a - b)
      check('T2c 合成注入尾部垃圾（f65-74 步长 ×50）后 v3 命中整段（含邻域精修扩出的 61-64 与环形首帧 0-3）',
        [65, 70, 74].every((f) => arr.includes(f)) && arr.length >= 10 && arr.length <= 18,
        'bad=[' + arr.join(',') + ']')
      check('T2c2 注入的边界帧 61-64 与环形首帧 0-3 **不是**由真实数据触发（未注入时 v3 报空 ⇒ 上一条纯属注入效应）',
        v3.bad.size === 0, '未注入 bad 数 = ' + v3.bad.size)
    }
    check('T2d 旧检测器（骨骼和口径）在**修正采样器**下确实失效/退化（回绕污染源已消失，故旧实现的"16 帧"不再复现）',
      old.size < 16, 'old.size=' + old.size + ' [' + [...old].sort((a, b) => a - b).join(',') + ']')
    // 平滑性：跨坏帧插值步进 ≤ 保留区合法最大单帧步进
    const good = []
    for (let f = 0; f < N; f++) if (!v3.bad.has(f)) good.push(f)
    let mxHalf = 0
    for (let i = 0; i < good.length; i++) {
      const a = good[i], b2 = good[(i + 1) % good.length]
      const span = ((b2 - a + N) % N) || N
      const d = Math.abs(sig[b2] - sig[a]) / span
      if (d > mxHalf) mxHalf = d
    }
    let legit = 0
    for (let f = 0; f < N; f++) if (!v3.bad.has(f) && !v3.bad.has((f + 1) % N)) legit = Math.max(legit, Math.abs(sig[(f + 1) % N] - sig[f]))
    check('T2e 跨坏帧插值步进 ≤ 合法单帧步进（无结构跳变）', mxHalf <= legit * 1.05 + 1e-6,
      '插值最大=' + mxHalf.toFixed(1) + ' 合法=' + legit.toFixed(1))
  }
}

console.log('[T3] 真数据凯尔希 3719111841 + GirlCat 3544152633 蒙皮层（不误杀 + 尾部命中）')
{
  // 文档实锤的垃圾尾巴（2026-09-12 demo 注释 + 本轮逐骨剖面）
  const expect = {
    '3544152633': { 'girl': [177, 178, 179] },
    '3719111841': { '主体': [177, 178, 179], '眼睛组合': [234, 235, 236, 237, 238, 239], '左耳朵1': [298, 299] },
  }
  for (const [id, layers] of Object.entries(expect)) {
    const ls = meshLayersOf(id)
    check('T3-0 ' + id + ' 蒙皮层数 ≥ ' + Object.keys(layers).length, ls.length >= Object.keys(layers).length, ls.map((x) => x.name).join('/'))
    for (const t of ls) {
      const { sig, maxStep, N } = profilesOf(t)
      const v3 = lib.detectBadAnimFrames({ sig, maxStep })
      const old = oldDetect(sig)
      const badArr = [...v3.bad].sort((a, b) => a - b)
      const want = layers[t.name]
      if (want) {
        // ①(P-139) 老断言（"文档垃圾帧必须命中"）的前提已推翻：那批帧在**修正采样器**下逐位等于帧 0
        //   （`docs/RENDER-BUGS-20260918.md` §2 的 A-2/A-3 判据）。现在钉住两条新事实：
        //   ① 修正采样器下真数据无坏帧（v3 空）；② 合成注入同位置垃圾后 v3 仍能切掉后缀。
        const docTailMax = Math.max(...want.map((f) => maxStep[f]))
        const ms = Float64Array.from(maxStep)
        for (let f = want[0]; f <= want[want.length - 1]; f++) ms[f] = Math.max(ms[f], 50) * 50
        const injected = lib.detectBadAnimFrames({ sig, maxStep: ms })
        const hit = v3.bad.size === 0 && docTailMax <= 8 &&
          want.every((f) => injected.bad.has(f)) && injected.bad.size <= 17
        check('T3 ' + id + ' ' + t.name + ' 修正采样器下无坏帧（文档尾巴 ' + JSON.stringify(want) + ' 实测步长 ≤' + docTailMax.toFixed(2) + 'u）+ 注入后 v3 仍切得掉',
          hit, 'v3=[' + badArr.join(',') + '] 注入后=[' + [...injected.bad].sort((a, b) => a - b).join(',') + '] 旧=[' + [...old].sort((a, b) => a - b).join(',') + ']')
      } else {
        const notWorse = v3.bad.size <= old.size + 2 && v3.bad.size / N <= 0.15
        check('T3 ' + id + ' ' + t.name + ' v3 不误杀（' + v3.bad.size + '/' + N + '，旧 ' + old.size + '）', notWorse,
          'v3=[' + badArr.join(',') + ']')
      }
    }
  }
}

// ── T4 退化输入 ──
console.log('[T4] 退化输入')
{
  const r1 = lib.detectBadAnimFrames({ sig: [1, 2, 3, 4, 5], maxStep: [1, 1, 1, 1, 1] })
  check('T4a 短序列(<8) 不判坏', r1.bad.size === 0)
  const r2 = lib.detectBadAnimFrames({ sig: new Float64Array(20).fill(7), maxStep: new Float64Array(20).fill(2) })
  check('T4b 常值序列 不判坏', r2.bad.size === 0)
  const r3 = lib.detectBadAnimFrames({ sig: new Float64Array(40).map((_, i) => Math.sin(i * 0.3) * 50), maxStep: new Float64Array(40).fill(1.5) })
  check('T4c 纯正弦 不判坏', r3.bad.size === 0, 'bad=' + [...r3.bad].join(','))
  const r4 = lib.detectBadAnimFrames({ sig: new Float64Array(30).map((_, i) => i * 3), maxStep: new Float64Array(30).fill(500) })
  // 全动画都快（中位步长>T/3）→ 尾部切除必须跳过；回绕缝由邻域精修处理（原既有行为，≤缝邻几帧）
  check('T4d 全动画都快 → 不做尾部切除（只余回绕缝邻帧，<17）', r4.bad.size < 17 && r4.bad.size <= 8,
    'bad=' + [...r4.bad].sort((a, b) => a - b).join(','))
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)

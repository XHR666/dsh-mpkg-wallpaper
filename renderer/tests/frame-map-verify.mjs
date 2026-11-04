// frame-map-verify.mjs — 交叉验证 demo.html「坏帧跳过 + 相位插值」采样（2026-09-12 定案②）
// 用法: node frame-map-verify.mjs [wallpaperId...]
// 判定: 插值后整周期最大相邻姿势差 ≤ 合法(非坏帧区间)最大单帧步进，且回绕处不超标 → 无"末帧抽动"
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'

const DIR = process.env.WP_DIR || path.join(WS, 'allwallpaper', 'dd')
const dec = new TextDecoder()
const H = {}
installPuppet(H)
const med = (a) => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }

function sigOf(mesh, anim, nb, f) {
  const rt = H._sampleAnimRT(mesh, anim, f, nb, mesh.bones)
  let s = 0
  for (let b = 0; b < nb; b++) s += rt[b].tx + rt[b].ty + rt[b].angle * 100
  return s
}

function analyse(mesh, anim, nb) {
  const N = Math.max(3, anim.frameCount || 3)
  const sig = new Float64Array(N)
  for (let f = 0; f < N; f++) sig[f] = sigOf(mesh, anim, nb, f)
  const step = new Float64Array(N)
  for (let f = 0; f < N; f++) step[f] = Math.abs(sig[(f + 1) % N] - sig[f])
  const bad = new Set()
  let thr = 5
  for (let pass = 0; pass < 4; pass++) {
    const good = []; for (let f = 0; f < N; f++) if (!bad.has(f)) good.push(f)
    if (good.length < 4) break
    const dev = new Float64Array(N)
    for (const f of good) {
      let pg = f, ng = f
      for (let k = 1; k <= N; k++) { const i = (f - k + N * 4) % N; if (!bad.has(i)) { pg = i; break } }
      for (let k = 1; k <= N; k++) { const i = (f + k) % N; if (!bad.has(i)) { ng = i; break } }
      dev[f] = Math.abs(sig[f] - (sig[pg] + sig[ng]) / 2)
    }
    thr = Math.max(med(good.map((f) => dev[f])) * 10, 5)
    let added = 0
    for (const f of good) {
      let ls = 0
      for (let k = -2; k <= 2; k++) ls = Math.max(ls, step[(f + k + N * 4) % N])
      if (dev[f] > thr && dev[f] > 0.45 * ls) { bad.add(f); added++ }
    }
    if (!added) break
  }
  const good = []; for (let f = 0; f < N; f++) if (!bad.has(f)) good.push(f)
  if (good.length < 4) { good.length = 0; for (let f = 0; f < N; f++) good.push(f); bad.clear() }
  const sigAt = (phase) => {
    let i = 0; while (i < good.length && good[i] <= phase) i++
    const p0 = (i === 0) ? good[good.length - 1] - N : good[i - 1]
    const n0 = (i === good.length) ? good[0] + N : good[i]
    const sp = n0 - p0, w = sp > 1e-6 ? (phase - p0) / sp : 0
    const A = sig[((p0 % N) + N) % N], B = sig[((n0 % N) + N) % N]
    return A + (B - A) * w
  }
  const ds = new Float64Array(N * 2)
  for (let k = 0; k < N * 2; k++) ds[k] = Math.abs(sigAt((k + 1) * 0.5) - sigAt(k * 0.5))
  // 原始剖面的同一指标（对照：插值不得比原始数据更"尖"）
  const rawAt = (phase) => { const f = Math.floor(phase), t = phase - f; return sig[f % N] + (sig[(f + 1) % N] - sig[f % N]) * t }
  const dsRaw = new Float64Array(N * 2)
  for (let k = 0; k < N * 2; k++) dsRaw[k] = Math.abs(rawAt((k + 1) * 0.5) - rawAt(k * 0.5))
  const spikeOf = (arr) => {
    let sp = 0, at = -1
    for (let k = 0; k < arr.length; k++) {
      const win = []
      for (let j = -6; j <= 6; j++) if (j) win.push(arr[(k + j + arr.length * 2) % arr.length])
      const m = med(win)
      const r = m > 1e-6 ? arr[k] / m : (arr[k] > 5 ? 1e9 : 0)
      if (r > sp) { sp = r; at = k }
    }
    return { sp, at }
  }
  const spikeRaw = spikeOf(dsRaw).sp
  let mx = 0, seam = ds[N * 2 - 1]
  // 感知判据：孤立尖峰比（该半步进 / 邻域 ±6 半步进的中位数）——真正的"抽一下"才会 >3
  let spike = 0, spikeAt = -1
  for (let k = 0; k < ds.length; k++) {
    const win = []
    for (let j = -6; j <= 6; j++) if (j) win.push(ds[(k + j + ds.length * 2) % ds.length])
    const m = med(win)
    const r = m > 1e-6 ? ds[k] / m : (ds[k] > 5 ? 1e9 : 0)
    if (ds[k] > mx) mx = ds[k]
    if (r > spike) { spike = r; spikeAt = k }
  }
  // 合法基准：两个端点都不是坏帧的原始单帧步进最大值（换算成"每半帧"= /2）
  let legit = 0
  for (let f = 0; f < N; f++) if (!bad.has(f) && !bad.has((f + 1) % N)) legit = Math.max(legit, step[f])
  const rawMax = Math.max(...Array.from(step))
  const continuity = mx / Math.max(1e-6, (legit || rawMax) / 2)
  return { N, bad: [...bad].sort((a, b) => a - b), thr, mx, seam, legit, rawMax, spike, spikeAt, spikeRaw, continuity }
}

function layersOf(id) {
  const pkgPath = path.join(DIR, id, 'scene.pkg')
  if (!fs.existsSync(pkgPath)) return null
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
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
      out.push({ name: l.name, mesh, nb: mesh.bones.length, anim: mesh.animations[0] })
    } catch (e) { /* 与 demo 一致 */ }
  }
  return out
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['3719111841', '3327063360', '3544152633', '3554161528']
let fail = 0, total = 0
for (const id of ids) {
  const ls = layersOf(id)
  if (!ls) { console.log(`[${id}] 无 scene.pkg`); continue }
  console.log(`\n[${id}] 蒙皮层 ${ls.length}`)
  for (const t of ls) {
    const r = analyse(t.mesh, t.anim, t.nb)
    const ok = r.spike <= Math.max(3.0, r.spikeRaw * 1.15) && r.seam <= Math.max(2, r.mx * 1.05) && r.continuity <= 1.3
    total++; if (!ok) fail++
    console.log('  ' + String(t.name).padEnd(12) + 'len=' + String(r.N).padStart(4) +
      ' 坏帧=' + String(r.bad.length).padStart(3) + '[' + r.bad.slice(0, 12).join(',') + (r.bad.length > 12 ? ',…' : '') + ']' +
      ' 原始max=' + r.rawMax.toFixed(1).padStart(8) + ' 合法max=' + r.legit.toFixed(1).padStart(7) +
      ' 插值max=' + r.mx.toFixed(1).padStart(7) + ' 回绕=' + r.seam.toFixed(1).padStart(6) +
      ' 尖峰比=' + (r.spike >= 1e8 ? '∞' : r.spike.toFixed(2)) + '(原始' + (r.spikeRaw >= 1e8 ? '∞' : r.spikeRaw.toFixed(2)) + ')' +
      ' 连续比=' + r.continuity.toFixed(2) + (ok ? ' ✓' : ' ✗'))
  }
}
console.log(`\n结果: ${total - fail}/${total} 通过` + (fail ? ` ✗（${fail} 层异常）` : ' ✓ 全部平滑'))
process.exit(fail ? 1 : 0)

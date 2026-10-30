// perf-profile.mjs — 逐包静态成本画像 + 粒子 CPU 基准（MERGED-2 第 2 项 B）
// 输出 perf-matrix.json + Top-10 重包表；perf-baseline.json 供后续对比。
//
// 用法:
//   node perf-profile.mjs                    # 全量扫描（默认 allwallpaper + ~/.dsh-mpkg-wallpaper + $MPW_SD_ROOT）
//   node perf-profile.mjs --pkg <绝对路径>   # 只画像一个包
//   node perf-profile.mjs --max-mb 400      # 跳过 >N MB 的包（防 OOM，默认 400）
//   node perf-profile.mjs --json            # 只输出 JSON
//   node perf-profile.mjs --write-baseline  # 覆盖 perf-baseline.json
//
// 静态成本（确定性，可入基线）：层数/纹理层/效果层(含效果 pass 数)/粒子层(maxcount 合计)/蒙皮网格层/文本层/视频层；
// 纹理解码累计 ms 与字节（Node 无法光栅化 PNG/JPEG/WEBP/MP4 → 记 container 字节，浏览器侧另有 loadTex 计时）；
// 粒子 CPU 基准：每层 buildParticleSystem + simulateParticleSystem 100 帧（1/30s 步进）→ ms/帧 与平均存活数。
// 重包评分 cost = fxPasses×8 + maxcount/1000 + decodeMB×2 + mesh×4 + layers/20（启发式，用于 Top-10 排序）。
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
// ①(去个人化 2026-09-16) 插件下载缓存 / 备用语料根：环境变量优先；默认值只是作者本机路径。
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'
const MPW_SD_ROOT = process.env.MPW_SD_ROOT || '/mnt/sdcard/wallpapertest1'

const dec = new TextDecoder()
const ARGS = process.argv.slice(2)
const argVal = (k) => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : null }
const HAS = (k) => ARGS.includes(k)
const MAX_MB = Number(argVal('--max-mb') || 400)
const ROOTS = [`${MPW_WS}/allwallpaper`, MPW_PLUGIN_CACHE, MPW_SD_ROOT]
const WE_ASSETS = `${MPW_WS}/wallpaper_engine/assets`
const OUT_JSON = path.join(ROOT, 'perf-matrix.json')
const BASELINE = path.join(ROOT, 'perf-baseline.json')

function findPkgs() {
  const out = []
  const roots = argVal('--pkg') ? [argVal('--pkg')] : ROOTS
  const scan = (p) => {
    let st; try { st = fs.statSync(p) } catch { return }
    if (st.isFile()) { if (/\.(pkg|mpkg)$/i.test(p)) out.push(p); return }
    for (const f of fs.readdirSync(p)) scan(path.join(p, f))
  }
  roots.forEach(scan)
  return [...new Set(out)]
}

function pkgId(file) {
  const d = path.basename(path.dirname(file))
  if (d === 'dd' || d === 'wallpapertest1' || d === 'wallpaperE' || path.extname(file).toLowerCase() === '.mpkg') {
    return path.basename(file).replace(/\.(pkg|mpkg)$/i, '')
  }
  return d
}

async function profile(file) {
  const row = { id: pkgId(file), path: file, fileMB: +(fs.statSync(file).size / 1048576).toFixed(1) }
  let pkg = null
  try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file))) } catch (e) { row.err = 'parsePkg: ' + e.message; return row }
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const readBytes = (n) => {
    const e = entry(n); if (e) return e
    try { const fp = path.join(WE_ASSETS, String(n || '')); if (fp.startsWith(WE_ASSETS) && fs.existsSync(fp)) return new Uint8Array(fs.readFileSync(fp)) } catch {}
    return null
  }
  const rd = (b) => dec.decode(b)
  // 视频壁纸容器：整段播 mp4，无场景渲染成本
  const videoEntries = pkg.entries.filter((e) => /\.(mp4|webm)$/i.test(e.name)).length
  const texEntries = pkg.entries.filter((e) => /\.tex$/i.test(e.name)).length
  if (videoEntries > 0 && texEntries === 0) { row.type = 'video-wallpaper'; row.static = { layers: 0 }; return row }

  let sceneObj = null
  for (const n of ['scene.json', 'Scene.json']) { const e = entry(n); if (e) { try { sceneObj = JSON.parse(rd(e).replace(/^\uFEFF/, '')) } catch {} ; break } }
  if (!sceneObj) { row.err = 'no scene.json'; return row }
  const readParticleDef = (p) => { try { const e = entry(p); return e ? JSON.parse(rd(e)) : null } catch { return null } }
  let scene
  try { scene = lib.parseScene(sceneObj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef }) } catch (e) { row.err = 'parseScene: ' + e.message; return row }
  lib.applyRenderConfig(scene, { sceneId: String(row.id || ""), hideUI: true, hideParticles: false, clearBgFx: true, log: () => {} })
  const layers = scene.layers

  // ── 静态成本 ──
  let fxPasses = 0
  const effectLayers = layers.filter((l) => l.effects && l.effects.length)
  for (const l of effectLayers) for (const ef of l.effects) fxPasses += (ef.passes || (lib.resolveEffectChain(pkg, ef, rd), ef.passes) || []).length
  let meshLayers = 0
  const H = {}
  installPuppet(H)
  for (const l of layers) {
    try {
      if (!l.image) continue
      const me = entry(l.image); if (!me) continue
      const mj = JSON.parse(rd(me)); if (!mj || !mj.puppet) continue
      const ru = entry(mj.puppet); if (!ru) continue
      const mesh = H._parseMdl(new MpwBuffer(ru.buffer, ru.byteOffset, ru.byteLength))
      if (mesh && mesh.bones && mesh.bones.length && mesh.animations && mesh.animations.length) meshLayers++
    } catch {}
  }
  const particleLayers = layers.filter((l) => l.particleDef)
  const maxcount = particleLayers.reduce((s, l) => s + ((l.particleDef && l.particleDef.maxcount) || 0), 0)
  row.static = {
    layers: layers.length,
    visible: layers.filter((l) => l.visible).length,
    texLayers: layers.filter((l) => typeof l.image === 'string' && !l.isContainer).length,
    effectLayers: effectLayers.length,
    fxPasses,
    particleLayers: particleLayers.length,
    maxcount,
    meshLayers,
    textLayers: layers.filter((l) => l.__text).length,
    videoLayers: layers.filter((l) => /\.(mp4|webm)$/i.test(String(l.image || ''))).length,
  }

  // ── 纹理解码累计（parseTex+decodeMip0 计时；容器字节按 image/video 原始数据计）──
  const readTexBytes = (tn) => {
    for (const c of ['materials/' + tn + '.tex', 'materials/' + tn, tn + '.tex', tn]) {
      const e = entry(c); if (e) return e
    }
    try { const fp = path.join(WE_ASSETS, 'materials', tn + '.tex'); if (fs.existsSync(fp)) return new Uint8Array(fs.readFileSync(fp)) } catch {}
    return null
  }
  const tDec0 = performance.now()
  let decodeOk = 0, decodeFail = 0, decodeBytes = 0
  const seenTex = new Set()
  const decodeOne = (tn) => {
    if (typeof tn !== 'string' || !tn || tn.startsWith('util/') || tn.startsWith('_rt_') || seenTex.has(tn)) return
    seenTex.add(tn)
    const b = readTexBytes(tn)
    if (!b) return
    try {
      const tex = lib.parseTex(b)
      const m0 = lib.decodeMip0(tex)
      decodeOk++
      decodeBytes += m0.rgba ? m0.rgba.length : (m0.image ? m0.image.length : (m0.video ? m0.video.length : 0))
    } catch { decodeFail++ }
  }
  for (const l of layers) {
    try {
      if (typeof l.image === 'string' && !l.isContainer) {
        const me = entry(l.image); if (!me) continue
        const mj = JSON.parse(rd(me))
        const mat = lib.resolveMaterial(mj)
        const mate = mat && mat.materialPath ? entry(mat.materialPath) : null
        if (!mate) continue
        const material = JSON.parse(rd(mate))
        for (const p of (material.passes || [])) for (const tn of (p.textures || [])) decodeOne(tn)
      }
      for (const ef of (l.effects || [])) {
        try { lib.resolveEffectChain(pkg, ef, rd); for (const p of (ef.passes || [])) for (const tn of (p.textures || [])) decodeOne(tn) } catch {}
      }
      if (l.particleDef && l.particleDef.material) {
        const mate = readBytes(l.particleDef.material)
        if (mate) { try { const material = JSON.parse(rd(mate)); for (const p of (material.passes || [])) for (const tn of (p.textures || [])) decodeOne(tn) } catch {} }
      }
    } catch {}
  }
  row.textures = { decodeMs: +(performance.now() - tDec0).toFixed(1), decodeOk, decodeFail, decodeMB: +(decodeBytes / 1048576).toFixed(1) }

  // ── 粒子 CPU 基准：每层 100 帧（1/30s），ms/帧 ──
  const partRows = []
  for (const l of particleLayers) {
    try {
      const sys = lib.buildParticleSystem(l.particleDef, { seedStr: 'perf:' + (l.name || l.id) })
      const t0 = performance.now()
      let simT = 0
      for (let f = 0; f < 100; f++) { simT += 1 / 30; lib.simulateParticleSystem(sys, simT) }
      const perFrameMs = (performance.now() - t0) / 100
      partRows.push({ name: String(l.name || l.id).slice(0, 24), maxcount: sys.maxCount, perFrameMs: +perFrameMs.toFixed(3), alive: sys.particles.length })
    } catch (e) { partRows.push({ name: String(l.name || l.id).slice(0, 24), err: String(e.message) }) }
  }
  row.particleBench = {
    layers: partRows.length,
    perFrameMsTotal: +partRows.reduce((s, r) => s + (r.perFrameMs || 0), 0).toFixed(3),
    rows: partRows,
  }

  // ── 重包评分（启发式，排序用）──
  row.cost = +(row.static.fxPasses * 8 + row.static.maxcount / 1000 + row.textures.decodeMB * 2 +
    row.static.meshLayers * 4 + row.static.layers / 20).toFixed(1)
  return row
}

// ── C6 纹理/显存画像（--texreport <id|路径>）：读 .tex 头（不解码），产出 reports/perf-tex-<id>.json ──
// 用途：给 A/B 判断"该不该降采样"（任务书 C6，与 B5 低内存档 / A6 小设备纹理预算呼应）。
// 口径：uploadMB = w×h×4（RGBA 解码后上传显存）；容器字节 ≠ 显存（BC 压缩纹理解码后膨胀）。
// 设备上限取 4096（真机上报 maxTextureSize 实测值；浏览器侧应以 MAX_TEXTURE_SIZE 为准）。
if (HAS('--texreport')) {
  const target = argVal('--texreport')
  let file = target
  if (!fs.existsSync(file)) {
    const cand = path.join(`${MPW_WS}/allwallpaper/dd`, target, 'scene.pkg')
    if (fs.existsSync(cand)) file = cand
  }
  if (!fs.existsSync(file)) { console.error('找不到容器：' + target); process.exit(2) }
  const id = pkgId(file)
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file)))
  const DEV_MAX = 4096
  const rows = []
  for (const e of pkg.entries) {
    if (!/\.tex$/i.test(e.name)) continue
    try {
      const tex = lib.parseTex(lib.getEntry(pkg, e.name))
      const w = tex.width | 0, h = tex.height | 0
      if (!w || !h) continue
      rows.push({
        name: e.name, w, h, fmt: tex.format, containerKB: Math.round(e.size / 1024),
        uploadMB: +(w * h * 4 / 1048576).toFixed(2),
        over2048: w > 2048 || h > 2048, over4096: w > DEV_MAX || h > DEV_MAX,
        downsample: (w > DEV_MAX || h > DEV_MAX) ? `P0 超 ${DEV_MAX} 必降（texDownsampleCap 已覆盖）` : (w > 2048 || h > 2048) ? 'P1 候选（低内存档/?perf=auto 降采样对象）' : null,
      })
    } catch (err) { rows.push({ name: e.name, err: err.message }) }
  }
  const ok = rows.filter((r) => !r.err)
  const totalMB = +ok.reduce((s, r) => s + r.uploadMB, 0).toFixed(1)
  const big = ok.filter((r) => r.over2048).sort((a, b) => b.uploadMB - a.uploadMB)
  const out = {
    id, container: file, generatedAt: new Date().toISOString(), deviceMax: DEV_MAX,
    summary: {
      textures: ok.length, decodeErrors: rows.length - ok.length, uploadMB: totalMB,
      mipNote: 'mip 链另 +~33%；MIN_FILTER=LINEAR 不读 mip（P-36：generateMipmap 仅 POT）',
      over2048: big.length, over4096: ok.filter((r) => r.over4096).length,
    },
    bigTextures: big, rows,
  }
  fs.mkdirSync(`${MPW_WS}/reports`, { recursive: true })
  const outPath = `${MPW_WS}/reports/perf-tex-${id}.json`
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1))
  console.log(`场景 ${id}：${ok.length} 张纹理，预计上传显存 ${totalMB}MB（+mip ~33%）；>2048 共 ${big.length} 张、>${DEV_MAX} 共 ${ok.filter((r) => r.over4096).length} 张`)
  for (const r of big.slice(0, 10)) console.log(`  ${String(r.w + 'x' + r.h).padEnd(12)} ${String(r.uploadMB + 'MB').padStart(9)} ${r.downsample}  ${r.name}`)
  console.log('→ ' + outPath)
  process.exit(0)
}

// ── main ──
const files = findPkgs()
if (!HAS('--json') && !HAS('--pkg')) console.error(`画像 ${files.length} 个包（max ${MAX_MB}MB）…`)
const rows = []
for (const f of files) {
  try { rows.push(await profile(f)) } catch (e) { rows.push({ id: pkgId(f), path: f, err: 'profile: ' + e.message }) }
}

if (HAS('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0) }

// Top-10 重包表
const top = rows.filter((r) => !r.err && r.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 10)
console.log('\n══ Top-10 重包（启发式 cost = fxPasses×8 + maxcount/1000 + decodeMB×2 + mesh×4 + layers/20）')
console.log('cost  包  层(可见) 效果层(fxpass) 粒子(max) 蒙皮 纹理MB  粒子CPU ms/帧')
for (const r of top) {
  console.log(
    String(r.cost).padStart(5) + ' ' + r.id.slice(0, 24).padEnd(25) +
    `${r.static.layers}(${r.static.visible})`.padStart(9) +
    ` ${r.static.effectLayers}(${r.static.fxPasses})`.padStart(10) +
    ` ${r.static.particleLayers}(${r.static.maxcount})`.padStart(11) +
    String(r.static.meshLayers).padStart(4) +
    String(r.textures.decodeMB).padStart(8) +
    String(r.particleBench.perFrameMsTotal).padStart(10))
}
const partTotal = rows.reduce((s, r) => s + ((r.static && r.static.maxcount) || 0), 0)
console.log(`\n合计 ${rows.length} 包 · 粒子层 maxcount 总计 ${partTotal} · 粒子 CPU 基准最重包: ` +
  (rows.filter((r) => r.particleBench && r.particleBench.perFrameMsTotal > 0).sort((a, b) => b.particleBench.perFrameMsTotal - a.particleBench.perFrameMsTotal)[0] || { id: '-', particleBench: { perFrameMsTotal: 0 } }).id +
  ' (' + (rows.filter((r) => r.particleBench).sort((a, b) => b.particleBench.perFrameMsTotal - a.particleBench.perFrameMsTotal)[0]?.particleBench.perFrameMsTotal || 0) + 'ms/帧)')

// --pkg 单包冒烟不写 perf-matrix.json（避免覆盖全量矩阵）；基线仍按 --write-baseline/缺省规则处理
if (!HAS('--pkg')) fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1))
if (!HAS('--pkg') && (HAS('--write-baseline') || !fs.existsSync(BASELINE))) {
  // 基线只存确定性强的字段（静态成本 + 粒子 CPU ms/帧 + 解码成败计数）；时序字段波动大不入基线
  const slim = { generatedAt: new Date().toISOString(), rows: rows.map((r) => ({ id: r.id, path: r.path, static: r.static, textures: r.textures ? { decodeOk: r.textures.decodeOk, decodeFail: r.textures.decodeFail, decodeMB: r.textures.decodeMB } : null, particleBench: r.particleBench, cost: r.cost, err: r.err })) }
  fs.writeFileSync(BASELINE, JSON.stringify(slim, null, 1))
  console.log(`\n基线已写入 ${path.basename(BASELINE)}${HAS('--write-baseline') ? '（--write-baseline）' : '（首次运行）'}`)
}
process.exit(0)

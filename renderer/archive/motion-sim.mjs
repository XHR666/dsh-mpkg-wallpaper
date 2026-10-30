// ===== MDLA 骨骼动画 逐帧偏移 校验脚本（Node） =====
// 复刻 demo.html 的 MDAT/MDLS/MDLA sample() 与附件偏移公式，
// 打印每附件在若干帧的偏移值，并报告 32 帧内的最大逐帧步进（验证"随时间变化、无跳变"）。
// 用法: node motion-sim.mjs <id=3719111841> [pkgPath]
import * as lib from '/root/Desktop/DSHarea/we-scene-demo/we-scene-bundle.js'
import fs from 'node:fs'

const id = process.argv[2] || '3719111841'
const pkgPath = process.argv[3] || ('/tmp/' + id + '.pkg')
const buf = new Uint8Array(fs.readFileSync(pkgPath))
const pkg = lib.parsePkg(buf)
const dec = new TextDecoder()
function getEntry(n) { const e = pkg.entries.find((x) => x.name === n); return e ? new Uint8Array(lib.getEntry(pkg, e.name)) : null }
const rd = (b) => dec.decode(b).replace(/^\uFEFF/, '')
const m0GetMd = (e) => e instanceof Uint8Array ? e : new Uint8Array(e)

// 网格包围盒中心（用于 自带 puppet 附件的 pivot；仅影响绝对值，逐帧增量中相消）
function meshCenterOf(b) {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    let mdlsOffset = b.length
    for (let off = 9; off + 4 < b.length; off++) {
      if (b[off] === 0x4d && b[off + 1] === 0x44 && b[off + 2] === 0x4c && b[off + 3] === 0x53) { mdlsOffset = off; break }
    }
    for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
      const vertexBytes = dv.getUint32(offset + 4, true)
      const verticesOffset = offset + 8
      if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue
      const indexLenOffset = verticesOffset + vertexBytes
      if (indexLenOffset + 4 > mdlsOffset) continue
      const indexBytes = dv.getUint32(indexLenOffset, true)
      const indicesOffset = indexLenOffset + 4
      if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue
      const vc = vertexBytes / 80
      let sane = true
      for (let i = 0; i < Math.min(vc, 48); i++) {
        const vo = verticesOffset + i * 80
        for (let k = 0; k < 3; k++) { const v = dv.getFloat32(vo + k * 4, true); if (!isFinite(v) || Math.abs(v) > 1e6) { sane = false; break } }
        if (!sane) break
      }
      if (!sane) continue
      const ic = indexBytes / 2
      if (ic > 0) { let ok = 0; for (let k = 0; k < Math.min(ic, 200); k++) { if (dv.getUint16(indicesOffset + k * 2, true) < vc) ok++ } if (ok < Math.min(ic, 200) * 0.9) continue }
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
      for (let i = 0; i < vc; i++) {
        const vo = verticesOffset + i * 80
        const x = dv.getFloat32(vo, true), y = dv.getFloat32(vo + 4, true)
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
      }
      return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
    }
  } catch {}
  return null
}

// MDAT 锚点 + MDLS 骨骼 + MDLA 动画 + sample()，与 demo.html 逐行等同
function anchorsOf(modelJson) {
  if (!modelJson || !modelJson.puppet) return null
  const e = getEntry(modelJson.puppet)
  if (!e) return null
  const b = m0GetMd(e)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out = []
  for (let idx = 0; ; ) {
    idx = b.indexOf(0x4d, idx)
    if (idx < 0 || idx + 8 > b.length) break
    if (dec.decode(b.slice(idx, idx + 8)) !== 'MDAT0001') { idx += 4; continue }
    let p = idx + 13
    if (p + 2 > b.length) break
    const count = b[p] | (b[p + 1] << 8); p += 2
    for (let e2 = 0; e2 < count && e2 < 64 && p + 2 < b.length; e2++) {
      const boneIdx = b[p] | (b[p + 1] << 8); p += 2
      let ne = p; while (ne < b.length && b[ne] !== 0) ne++
      if (ne - p > 128) break
      const name = dec.decode(b.slice(p, ne)); p = ne + 1
      if (p + 64 > b.length) break
      const m16 = []; for (let i = 0; i < 16; i++) m16.push(dv.getFloat32(p + i * 4, true)); p += 64
      out.push({ name, boneIdx, tx: m16[12], ty: m16[13] })
    }
    break
  }
  const matMulRow = (a, b2) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b2[k * 4 + j]; return r }
  let bones = []
  try {
    let mdlsOffset = -1
    for (let i = 9; i + 4 < b.length; i++) { if (b[i] === 0x4d && b[i + 1] === 0x44 && b[i + 2] === 0x4c && b[i + 3] === 0x53) { mdlsOffset = i; break } }
    if (mdlsOffset >= 0) {
      let p = mdlsOffset + 13
      const bc = dv.getUint32(p, true); p += 4
      for (let bi = 0; bi < bc && p + 12 < b.length; bi++) {
        let he = 0
        let type = dv.getUint32(p + 1, true); let parent = dv.getInt32(p + 5, true); let len = dv.getUint32(p + 9, true)
        if (len === 0 || len > 4096) { type = dv.getUint32(p + 2, true); parent = dv.getInt32(p + 6, true); len = dv.getUint32(p + 10, true); he = 1; if (len === 0 || len > 4096) break }
        p += 9 + he + 4
        const m = new Array(16); for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(p + i * 4, true); p += len
        let je = p; while (je < b.length && b[je] !== 0) je++; p = je + 1
        bones.push({ index: bi, parent })
      }
    }
  } catch {}
  let anims = []; let sample = null
  try {
    let mdla = -1
    for (let i = 0; i + 4 <= b.length; i++) { if (b[i] === 0x4d && b[i + 1] === 0x44 && b[i + 2] === 0x4c && b[i + 3] === 0x41) { mdla = i; break } }
    if (mdla >= 0) {
      let p = mdla + 9 + 4
      const ac = dv.getUint32(p, true); p += 4
      for (let a = 0; a < ac && p + 12 < b.length; a++) {
        p += 8
        let ne = p; while (ne < b.length && b[ne] !== 0) ne++
        const name = dec.decode(b.slice(p, ne)); p = ne + 1
        let le = p; while (le < b.length && b[le] !== 0) le++; p = le + 1
        while (p + 1 < b.length && !(b[p] === 0xf0 && b[p + 1] === 0x41)) p++
        p += 2
        const fc = b[p] | (b[p + 1] << 8); p += 2
        p += 2 + 4
        const bc = dv.getUint32(p, true); p += 4
        p += 4
        const sb = dv.getUint32(p, true); p += 4
        const segs = []
        for (let bi = 0; bi < bc && p + (bi + 1) * sb <= b.length; bi++) segs.push(p + bi * sb)
        anims.push({ name, frameCount: fc, segs })
        p += sb * bc
      }
    }
    if (anims.length && bones.length) {
      const anim = anims[0]
      sample = (frame) => {
        const o = new Array(bones.length).fill(null)
        const tf = Math.max(1, anim.frameCount)
        for (let bi = 0; bi < bones.length; bi++) {
          const segStart = anim.segs[bi]
          if (segStart === undefined || segStart + 36 > b.length) continue
          const b2 = 2 * bi
          const posShift = Math.floor(b2 / 9)
          const posCol = b2 % 9
          const f0 = ((frame + posShift) % tf) * 36
          const oo = segStart + f0 + posCol * 4
          const px = dv.getFloat32(oo, true), py = dv.getFloat32(oo + 4, true)
          const rotShift = Math.floor((b2 + 5) / 9)
          const rotCol = (b2 + 5) % 9
          const o2 = segStart + ((frame + posShift + rotShift) % tf) * 36 + rotCol * 4
          const rotZ = dv.getFloat32(o2, true)
          if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rotZ)) {
            const parent = bones[bi].parent
            if (parent >= 0 && parent < bones.length && o[parent]) {
              const pa = o[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa)
              o[bi] = { angle: pa + rotZ, tx: o[parent].tx + px * pc - py * ps, ty: o[parent].ty + px * ps + py * pc }
            } else o[bi] = { angle: rotZ, tx: px, ty: py }
          }
        }
        return o
      }
    }
  } catch {}
  out._bones = bones; out._anims = anims; out._sample = sample
  return out
}

function offsetOf(anch, pose, pivX, pivY, ayFlip) {
  const c = Math.cos(pose.angle), sn = Math.sin(pose.angle)
  const ax = anch.tx * c - anch.ty * sn
  const ay = anch.tx * sn + anch.ty * c
  const tyFinal = ayFlip ? -(pose.ty + ay) : (pose.ty + ay)
  return [pose.tx + ax + pivX, tyFinal + pivY]
}

const scene = JSON.parse(rd(getEntry('scene.json')))
const objById = new Map(scene.objects.map((o) => [o.id, o]))
const attObjs = scene.objects.filter((o) => o.attachment !== undefined && o.attachment !== null && o.parent !== undefined)

const N = 32
const rows = []
for (const o of attObjs) {
  const po = objById.get(o.parent)
  if (!po || !po.image) continue
  const pj = JSON.parse(rd(getEntry(po.image)))
  const anchors = anchorsOf(pj)
  if (!anchors) continue
  const anch = anchors.find((a) => a.name === o.attachment)
  if (!anch) continue
  const sampleFn = anchors._sample
  const anim = anchors._anims && anchors._anims[0]
  if (!sampleFn || !anim) continue
  let pivX = 0, pivY = 0
  try {
    if (o.image) {
      const cm = getEntry(o.image)
      if (cm) {
        const cj = JSON.parse(rd(cm))
        if (cj && cj.puppet) { const ce = getEntry(cj.puppet); if (ce) { const piv = meshCenterOf(m0GetMd(ce)); if (piv) { pivX = piv.cx; pivY = piv.cy } } }
      }
    }
  } catch {}
  const offs = []
  for (let f = 0; f < N; f++) {
    const pose = sampleFn(f)[anch.boneIdx]
    offs.push(pose ? offsetOf(anch, pose, pivX, pivY, false) : null)
  }
  const a = offs.filter(Boolean)
  if (a.length < N) continue
  // 一致性：静态偏移（demo 用 animRT0 帧0）= 逐帧 offset[0]（应为同一 pose）
  const staticOff = offsetOf(anch, sampleFn(0)[anch.boneIdx], pivX, pivY, false)
  const baseOff = a[0]
  const off0Match = Math.abs(staticOff[0] - baseOff[0]) < 1e-6 && Math.abs(staticOff[1] - baseOff[1]) < 1e-6
  // 90 帧（3s）循环特性：帧内平滑 + 回绕步进
  const off90 = []
  for (let f = 0; f < 90; f++) { const pose = sampleFn(f)[anch.boneIdx]; off90.push(pose ? offsetOf(anch, pose, pivX, pivY, false) : null) }
  let maxStep90 = 0
  for (let f = 1; f < 90; f++) { if (off90[f] && off90[f - 1]) { const s = Math.hypot(off90[f][0] - off90[f - 1][0], off90[f][1] - off90[f - 1][1]); if (s > maxStep90) maxStep90 = s } }
  const wrapStep = (off90[89] && off90[0]) ? Math.hypot(off90[89][0] - off90[0][0], off90[89][1] - off90[0][1]) : 0
  let maxStep = 0, maxStepAt = 0
  for (let f = 1; f < N; f++) {
    const s = Math.hypot(a[f][0] - a[f - 1][0], a[f][1] - a[f - 1][1])
    if (s > maxStep) { maxStep = s; maxStepAt = f }
  }
  const spanX = Math.max(...a.map((x) => x[0])) - Math.min(...a.map((x) => x[0]))
  const spanY = Math.max(...a.map((x) => x[1])) - Math.min(...a.map((x) => x[1]))
  rows.push({ o, anch, anim, offs: a, N, maxStep, maxStepAt, spanX, spanY, off0Match, maxStep90, wrapStep })
}

console.log('id=' + id + '  附件对象=' + attObjs.length + '  带MDLA动画附件=' + rows.length + '  帧数窗口=' + N)
const allOff0Match = rows.every((r) => r.off0Match)
console.log('帧0一致性(逐帧offset[0]==静态animRT0偏移): ' + (allOff0Match ? '全部一致 ✓' : '存在不一致 ⚠ → ' + rows.filter((r) => !r.off0Match).map((r) => r.o.name).join(',')))
console.log('90帧窗口 每层最大逐帧步进 与 回绕步进(89→0):')
for (const r of rows) {
  console.log(`   ${r.o.name.padEnd(8)} ${r.o.attachment.padEnd(4)} 内帧step=${r.maxStep90.toFixed(2).padStart(6)}  回绕step=${r.wrapStep.toFixed(2).padStart(6)}${r.wrapStep < 3 ? '  ✓近无缝' : '  ⚠回绕有阶跃(90帧窗截半周期所致)'}`)
}
for (const r of rows) {
  console.log(`\n== obj ${r.o.id} ${r.o.name} › ${r.o.attachment} | anim=${r.anim.name} frames=${r.anim.frameCount} bone=${r.anch.boneIdx} 锚(${r.anch.tx.toFixed(1)},${r.anch.ty.toFixed(1)})`)
  console.log(`   span(0..31) dx=${r.spanX.toFixed(2)} dy=${r.spanY.toFixed(2)} ; 最大逐帧步进=${r.maxStep.toFixed(3)} @f${r.maxStepAt}  ${r.maxStep < 25 ? '✓平滑' : '⚠跳变'}`)
  console.log('   off@f: ' + [0, 1, 2, 3, 8, 16, 24, 31].map((f) => f + ':[' + r.offs[f].map((v) => v.toFixed(1)).join(',') + ']').join('  '))
}

// 逐帧 32 帧完整打印（取 左耳朵1 或任一 Ears 附件）
const ear = rows.find((r) => /耳1|左耳朵1|耳朵1/i.test(r.o.name)) || rows[0]
if (ear) {
  console.log('\n===== 完整 32 帧偏移值打印: obj ' + ear.o.id + ' ' + ear.o.name + ' (' + ear.o.attachment + ') =====')
  for (let f = 0; f < 32; f++) {
    console.log('  f=' + String(f).padStart(2) + '  offset=[' + ear.offs[f].map((v) => v.toFixed(2)).join(', ') + ']')
  }
}


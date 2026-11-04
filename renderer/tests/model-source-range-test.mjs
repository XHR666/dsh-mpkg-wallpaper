// model-source-range-test.mjs — P-248（2026-10-07）老式模型层的**区间读**判据。
//
// 背景：`.mdl` 的 material 路径固定在头部（偏移 21 起、至多 512 字节），而 `getEntry()` 是**整条拷贝**；
//   语料里有 156 MB / 51 MB 的 `.mdl` ⇒ 为读 300 字节把整条拷进内存。Node 实测（`0923/3589454154`，245 MB 包）：
//   `registerModelSource` 一步的 `modelSourceLedger().readBytes = 222 299 693`（≈212 MB），
//   是 256 MB 包在浏览器里 OOM 的直接原因之一。
// 修法：`getEntryRange(pkg, name, off, len)`（只拷区间）+ `registerModelSource(path, readEntry, readEntryRange)`
//   优先走区间读（512 B），`attachCtx.readEntryRange` 由宿主（demo.html）提供；无区间读 ⇒ 逐位回旧（整条读）。
//
// 判据：A 合成包（2 MB 假 mdl）证明"只读区间、绝不整条读"；B 只有整条读时契约不变；C 真包（37 MB / 8 mdl）
//   的 `readBytes` 落在 KB 级且 8 个材质全部解析出来。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { WS } from './_root.mjs'

const MPW_WS = process.env.MPW_ROOT || WS
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const enc = new TextEncoder()
/** 合成 PKG（与 usertextures 判据同一容器布局：PKGV0001 + 目录表 + 连续数据区）。 */
function buildPkg(entries) {
  const magic = enc.encode('PKGV0001')
  const names = entries.map((e) => enc.encode(e.name))
  let headSize = 4 + magic.length + 4
  for (const n of names) headSize += 4 + n.length + 8
  const chunks = []; let off = 0; const dir = []
  entries.forEach((e, i) => {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data
    dir.push({ name: names[i], off, size: data.length }); chunks.push(data); off += data.length
  })
  const buf = new Uint8Array(headSize + off)
  const dv = new DataView(buf.buffer); let p = 0
  dv.setInt32(p, magic.length, true); p += 4
  buf.set(magic, p); p += magic.length
  dv.setInt32(p, entries.length, true); p += 4
  for (const d of dir) {
    dv.setInt32(p, d.name.length, true); p += 4
    buf.set(d.name, p); p += d.name.length
    dv.setInt32(p, d.off, true); p += 4
    dv.setInt32(p, d.size, true); p += 4
  }
  for (const c of chunks) { buf.set(c, p); p += c.length }
  return buf
}
/** 造一个"头部是合法 MDLV0023 + materials/…json、其余是填充"的假 mdl（默认 2 MB）。 */
function fakeMdl(material, sizeBytes) {
  const head = new Uint8Array(21 + material.length + 1)
  head.set(enc.encode('MDLV0023'), 0)
  head.set(enc.encode(material), 21)
  head[21 + material.length] = 0
  const total = Math.max(sizeBytes || 2 * 1024 * 1024, head.length)
  const out = new Uint8Array(total)
  out.set(head, 0)
  for (let i = head.length; i < total; i++) out[i] = (i * 31) & 0xff   // 填充（模拟大文件）
  return out
}

console.log('== A 合成包：区间读只读头部、绝不整条读 ==')
{
  const MDL = 'models/big/big.mdl'
  const MAT = 'materials/big.json'
  const pkgBuf = buildPkg([
    { name: 'scene.json', data: JSON.stringify({ objects: [{ id: 1, name: '模型层', model: MDL }] }) },
    { name: MDL, data: fakeMdl(MAT, 2 * 1024 * 1024) },
    { name: MAT, data: JSON.stringify({ passes: [{ shader: 'generic4', textures: ['bigtex'] }] }) },
  ])
  const pkg = lib.parsePkg(pkgBuf)
  let wholeBytes = 0, rangeBytes = 0, rangeCalls = 0
  const sj = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  lib.resetModelSources()
  const scene = lib.parseScene(sj, null, {
    attachCtx: {
      readEntry: (n) => { const b = lib.getEntry(pkg, n); wholeBytes += b ? b.length : 0; return b },
      readEntryRange: (n, o, l) => { const b = lib.getEntryRange(pkg, n, o, l); rangeBytes += b ? b.length : 0; rangeCalls++; return b },
      time: () => 0,
    },
    readParticleDef: null,
  })
  const led = lib.modelSourceLedger()
  const src = lib.parsedModelSource(MDL)
  check('A1 区间接口在位（`getEntryRange` 导出 + `attachCtx.readEntryRange` 被调用）',
    typeof lib.getEntryRange === 'function' && rangeCalls > 0, 'rangeCalls=' + rangeCalls)
  check('A2 模型来源登记成功（material 路径从头 512 字节里读出来）',
    led.registered === 1 && !!src && src.material === MAT, JSON.stringify({ led, src }))
  check('A3 **整条读次数 = 0**（2 MB 的 mdl 一个字节都没被整条拷）', wholeBytes === 0, 'wholeBytes=' + wholeBytes)
  check('A4 区间读总量 = 512 B（`MDL_MATERIAL_PATH_MAX`），不是 2 MB',
    rangeBytes === 512 && led.readBytes === 512, 'rangeBytes=' + rangeBytes + ' led.readBytes=' + led.readBytes)
  check('A5 层仍带 `model` 来源（`image` 写进 mdl 路径、未被丢弃）',
    scene.layers.length === 1 && String(scene.layers[0].image) === MDL && !scene.layers[0].__modelDropped,
    JSON.stringify({ image: scene.layers[0].image, dropped: scene.layers[0].__modelDropped }))
}

console.log('== B 只有整条读（老宿主）：契约逐位不变 ==')
{
  const MDL = 'models/big/big.mdl'
  const MAT = 'materials/big.json'
  const pkg = lib.parsePkg(buildPkg([
    { name: 'scene.json', data: JSON.stringify({ objects: [{ id: 1, name: '模型层', model: MDL }] }) },
    { name: MDL, data: fakeMdl(MAT, 1024 * 1024) },
    { name: MAT, data: JSON.stringify({ passes: [{ shader: 'generic4', textures: ['bigtex'] }] }) },
  ]))
  const sj = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  lib.resetModelSources()
  let whole = 0
  lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => { const b = lib.getEntry(pkg, n); whole += b ? b.length : 0; return b }, time: () => 0 }, readParticleDef: null })
  const led = lib.modelSourceLedger()
  check('B1 无区间读 ⇒ 仍走整条读且登记成功（旧宿主行为逐位保持）',
    led.registered === 1 && led.readBytes === 1024 * 1024 && whole === 1024 * 1024,
    JSON.stringify({ registered: led.registered, readBytes: led.readBytes, whole }))
}

console.log('== C 真包 0917/3509243656（37 MB / 8 个 mdl 层）：KB 级读 + 全部解析 ==')
{
  const P = path.join(MPW_WS, 'allwallpaper', '0917', '3509243656', 'scene.pkg')
  if (!fs.existsSync(P)) check('C 真包存在', false, '语料缺失: ' + P)
  else {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(P)))
    const sj = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    lib.resetModelSources()
    let whole = 0
    lib.parseScene(sj, null, {
      attachCtx: {
        readEntry: (n) => { const b = lib.getEntry(pkg, n); whole += b ? b.length : 0; return b },
        readEntryRange: (n, o, l) => lib.getEntryRange(pkg, n, o, l),
        time: () => 0,
      },
      readParticleDef: null,
    })
    const led = lib.modelSourceLedger()
    const mdlLayers = (sj.objects || []).filter((o) => typeof o.model === 'string' && /\.mdl$/i.test(o.model)).length
    check('C1 8 个 mdl 层全部登记（registered=8、miss=0）', led.registered === 8 && led.miss === 0, JSON.stringify(led))
    check('C2 区间读总量 ≤ 8×512 = 4096 B（此前 = 该包全部 mdl 字节数，实测 37 MB 级）',
      led.readBytes <= 4096 && led.readBytes > 0, 'readBytes=' + led.readBytes + '（mdl 层 ' + mdlLayers + ' 个）')
    const sky = lib.parsedModelSource('models/自制天空盒02/自制天空盒02.mdl')
    check('C3 最大那个 mdl 的 material 仍解析正确',
      !!sky && sky.material === 'materials/models/自制天空盒02/材质.json', JSON.stringify(sky))
  }
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败（P-248 模型来源区间读）')
process.exit(fail === 0 ? 0 : 1)

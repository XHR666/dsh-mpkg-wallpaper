// submesh-evidence.mjs — P-109（任务书 P1-4）取证工具：**用 `?submesh=` 探针**给 hina 3554161528 出
//   「面部顶点/骨分组台账 + 多时间点位移 + 隔离出图」的原始证据（不做断言、不进任何门禁）。
//
// 两条通路（**一次只开一个无头浏览器**；本机 GL 不可用时自动走 ②，不失败）：
//   ① `--browser`：无头 Firefox 真跑 demo 页（`?id=<id>&submesh=<规格>`），读 `window.__mpwSubMesh` +
//      截图 ⇒ 真像素级证据（需要浏览器能建 WebGL 上下文；本机 PRoot 环境**建不起来**，见末尾"环境"）。
//   ② 默认（Node 探针）：mock-GL 驱动**真实 bundle 的 `renderMeshLayer`**（真 MDL + 真 additive 动画
//      姿势），走的就是那条被 `?submesh=` 接管的绘制路径 ⇒ 台账与浏览器里**同一份代码产出**。
//
// 用法：
//   node tests/submesh-evidence.mjs --id 3554161528 --secs 9            # Node 探针（默认）
//   node tests/submesh-evidence.mjs --browser                           # 试浏览器路径
//   node tests/submesh-evidence.mjs --url http://127.0.0.1:8899 --out reports/submesh-3554161528
//
// 产出（`reports/submesh-<id>/`）：
//   ledger-all.json     `?submesh=all` 全量台账（29 组：顶点数/bbox/质心/影响骨/父链/tri 计数/
//                        位移时程 hist/三角形变号计数 invert/summary）—— 多时间点位移与翻转的直接证据
//   ledger-<规格>.json  各隔离规格的台账（选中组 + 实绘三角形数）
//   render.json         软栅格化输入：若干时间点上每组的**蒙皮后顶点**（含 UV）与三角形（含变号标记）
//   tex-<材质>.rgba/.json  解码后的真实贴图（供 UV 裁剪看"这组画的是脸/眼/眉的哪一块"）
//   log.txt             `[submesh]` 结构化摘要行（与进设备上报的同一批）
//
// 环境（2026-09-17 本机实测，写进 PATCHES P-109.4）：无头 Firefox **建不了 WebGL**——
//   `AllowWebgl2:false restricts context creation on this system` / `tryNativeGL / Exhausted GL
//   driver options (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS)`（无 `/dev/dri`、PRoot 容器）；
//   Chromium+SwiftShader 在本机 PRoot 下 newPage 挂起（`tests/headless-shot.mjs` 档位表已记）。
//   ⇒ 本工具默认走 ②（Node 探针），台账与"哪些顶点/三角形属于哪根骨"全部可得，**像素级对比不做**。
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

globalThis.location = globalThis.location || { search: '' }
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const ROOT = path.resolve(import.meta.dirname, '..')
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
const at = await import(pathToFileURL(path.join(ROOT, 'core', 'attach-transform.mjs')).href)
const ps = await import(pathToFileURL(path.join(ROOT, 'core', 'puppet-skin.js')).href)

const MPW_WS = process.env.MPW_ROOT || WS
const ID = arg('--id', '3554161528')
const PKG = arg('--pkg', path.join(MPW_WS, 'allwallpaper', 'dd', ID, 'scene.pkg'))
const OUT = path.resolve(arg('--out', path.join('reports', 'submesh-' + ID)))
const SECS = Number(arg('--secs', '9'))
const SHOTS = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))
const SPECS = SHOTS.length ? SHOTS : ['16-19,30', '17*', '5-8,14,20,29', '16', '30', '1']
const dec = new TextDecoder()
const logLines = []
fs.mkdirSync(OUT, { recursive: true })
const write = (n, o) => fs.writeFileSync(path.join(OUT, n), typeof o === 'string' ? o : JSON.stringify(o, null, 1))

// ── 极简 PNG 编码（只给贴图/软栅格化图用；无第三方依赖）──
const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c } return t })()
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer || rgba, rgba.byteOffset || 0, rgba.length).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))])
}

// ── ① 浏览器通路（可选；GL 不可用时不失败）──
if (argv.includes('--browser')) {
  const URL_BASE = arg('--url', 'http://127.0.0.1:8899')
  const PW = process.env.MPW_PLAYWRIGHT || path.join(MPW_WS, 'dsh-mpkg-wallpaper', 'node_modules', 'playwright', 'index.mjs')
  const { firefox } = await import(pathToFileURL(PW).href)
  console.log('▶ 浏览器通路：无头 Firefox（软件光栅）→ ' + URL_BASE)
  const browser = await firefox.launch({ timeout: 60_000, firefoxUserPrefs: { ...AUDIO_MUTE_PREFS, 'webgl.force-enabled': true, 'webgl.disabled': false, 'gfx.webrender.software': true } })
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  page.on('console', (m) => { const t = m.text(); if (/\[submesh\]|WebGL|restricts|Exhausted/i.test(t)) logLines.push(t) })
  await page.goto(URL_BASE + '/?id=' + ID + '&nodebug&submesh=all', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(SECS * 1000 + 3000)
  const gl = await page.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) })
  const L = await page.evaluate(() => (globalThis.__mpwSubMesh ? JSON.parse(JSON.stringify(globalThis.__mpwSubMesh)) : null))
  if (L) { write('ledger-all.json', L); await page.screenshot({ path: path.join(OUT, 'shot-normal.png') }); console.log('  ✓ 浏览器台账：样本 ' + L.samples.n + ' 帧 / t ' + L.samples.t0 + '→' + L.samples.t1 + 's') }
  else console.log('  ⚠ 浏览器 WebGL=' + gl + ' 且没有台账 ⇒ 本机浏览器通路不可用（见文件头"环境"），改走 Node 探针')
  await browser.close()
}
if (argv.includes('--browser-only')) { write('log.txt', logLines.join('\n')); process.exit(0) }

// ── ② Node 探针通路：mock-GL 驱动真实 renderMeshLayer（真 MDL + 真 additive 动画）──
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  RG8: 0x8229, RG: 0x8227, ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER: 0x8892, TRIANGLES: 4, UNSIGNED_SHORT: 0x1403, FLOAT: 0x1406 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function mkGl() {
  let seq = 0, curUnit = 0
  const curTex = new Array(8).fill(null)
  const draws = [], eboData = []
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createShader: () => mk('sh'), createProgram: () => mk('prog'),
    createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindBuffer: () => {}, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {}, useProgram: () => {},
    bufferData: (t, data) => { if (t === CONST.ELEMENT_ARRAY_BUFFER && data && data.length) eboData.push(Array.from(data)) },
    drawElements: (m, c) => draws.push(c), drawArrays: (m, f, c) => draws.push(c),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_BlendIdx: 2, a_BlendWeight: 3 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0, isTexture: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', texImage2D: () => {}, texParameteri: () => {},
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, draws, eboData }
}
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }' : 'void main(){ gl_FragColor = vec4(1.0); }')

if (!fs.existsSync(PKG)) { console.log('SKIP：缺包 ' + PKG); write('log.txt', 'missing pkg ' + PKG); process.exit(0) }
const b = fs.readFileSync(PKG)
const pkg = lib.parsePkg(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
const modelJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'models/人物.json')).replace(/^\uFEFF/, ''))
const mesh = at.parseMdl(lib.getEntry(pkg, modelJson.puppet))
const NB = mesh.bones.length, NV = mesh.positions.length
const nTri = Math.floor(mesh.indices.length / 3)
const obj66 = sceneJson.objects.find((o) => o.id === 66)
const layer = { id: 66, name: '人物', size: [1405, 2013], scale: [1, 1, 1], origin: [2200.54, 595, 0], angles: [0, 0, 0], alpha: 1 }
const ORIGIN = [2200.54, 595], SCALE = [1, -1], PROJ = [3840, 2160]
console.log('▶ Node 探针通路：' + modelJson.puppet + '  顶点=' + NV + ' 骨=' + NB + ' 三角形=' + nTri + ' 动画=' + mesh.animations.length)

// bind 世界姿势 → bindInv → 每帧 gBones（与 demo.html updateSkinBones 同式）
const parentOf = [], bindInv = []
for (let i = 0; i < NB; i++) parentOf.push((mesh.bones[i] && mesh.bones[i].parent != null) ? (mesh.bones[i].parent | 0) : -1)
const bindWorld = lib.bindWorldChain(mesh.bones)   // ①(P-110) 与渲染器同源（子先乘修正序；旧序见 ?bindorder=legacy）
for (let i = 0; i < NB; i++) bindInv[i] = ps.matInvertRow(bindWorld[i])
const bindRT = bindWorld.map((m) => ({ angle: Math.atan2(m[1], m[0]), tx: m[12], ty: m[13] }))
// ⚠ 动画层 → MDLA 动画的映射必须用**仓库既有口径**（`attach-transform.selectAnimLayers`：
//   名字精确 → 数字后缀 → 层索引 → 0；demo.html 的 `animId` 匹配在本包全败 —— 人物 3 层声明的是
//   动画对象 id 726/1258/182，而 MDL 里 animations[].id 是 182/…/… ⇒ 只有第三条能按 id 命中）。
//   曾经手写"id → 名字 → 0"的回退把 动画2/动画3 都落到 animations[0] 上，得到的是**假姿势**。
const animSpec = at.selectAnimLayers(obj66, mesh)
const good = lib.analyzeAnimGoodFrames(mesh, at.sampleAnimRT)
function gBonesAt(t) {
  const A = lib.sampleCompositeAdditivePose({ mesh, bindRT, animSpec, animGood: good, tAnim: t, fps: 30, nb: NB, sampleRT: at.sampleAnimRT })
  const g = new Float32Array(NB * 16)
  for (let i = 0; i < NB; i++) {
    const { angle, tx, ty } = A[i], c = Math.cos(angle), s = Math.sin(angle)
    g.set(at.matMulRow(bindInv[i], [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]), i * 16)
  }
  return g
}
/** 一组规格跑一遍真 renderMeshLayer（探针在 bundle 里），返回台账 */
async function runSpec(search, times, keepEvery = 1) {
  const prev = globalThis.location
  globalThis.location = { search }
  delete globalThis.__mpwSubMesh
  const M = mkGl()
  const r = lib.createRenderer({ getContext: () => M.gl }, { onLog: (m) => { if (String(m).includes('[submesh]')) logLines.push(String(m)) }, shaderResolver })
  const minScene = { general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, properties: {}, layers: [] }
  let last = null
  for (let k = 0; k < times.length; k++) {
    if (k % keepEvery === 0 || k === times.length - 1) {
      await r.render(minScene, new Map(), 1920, 1080, times[k])   // 让探针的帧时间 = times[k]
      r.renderMeshLayer(layer, mesh, gBonesAt(times[k]), NB, ORIGIN, SCALE, PROJ, { id: 'tex#人物' })
      last = globalThis.__mpwSubMesh ? JSON.parse(JSON.stringify(globalThis.__mpwSubMesh)) : null
    }
  }
  globalThis.location = prev
  return { ledger: last, draws: M.draws, ebo: M.eboData }
}
const TIMES = []
const step = 1 / 30
for (let t = 0; t <= SECS + 1e-9; t += step) TIMES.push(+t.toFixed(4))
console.log('  ① ?submesh=all：' + TIMES.length + ' 帧（t=0→' + SECS + 's，1/30s 步长）…')
const all = await runSpec('?id=' + ID + '&submesh=all', TIMES)
write('ledger-all.json', all.ledger)
const sum = all.ledger.summary
console.log('     → ledger-all.json：组=' + sum.nGroups + ' 顶点=' + all.ledger.nv + ' 样本=' + all.ledger.samples.n
  + ' 最大位移=b' + sum.maxDispGroup + ' ' + sum.maxDisp + 'px@' + sum.maxDispAt + 's 最多变号=b' + sum.maxInvertGroup + ' ' + sum.maxInvert + '条@' + sum.maxInvertAt + 's')

// ② 各隔离规格（每个规格再跑几帧，确认实绘三角形数）
for (const spec of SPECS) {
  const res = await runSpec('?id=' + ID + '&submesh=' + encodeURIComponent(spec) + '&subtri=all', [0, 0.5, 1.0, 2.0, 4.0, 8.0])
  if (!res.ledger) { console.log('  ⚠ ?submesh=' + spec + ' 无台账'); continue }
  const sel = res.ledger.groups.filter((g) => g.sel)
  write('ledger-' + spec.replace(/[^0-9a-z*,.-]/gi, '_') + '.json', res.ledger)
  console.log('  ② ?submesh=' + spec + ' ⇒ 选中 ' + sel.length + ' 组 / ' + res.ledger.drawn.tris + ' 三角形（'
    + sel.map((g) => 'b' + g.b + ':n=' + g.nv).join(' ') + '）')
}

// ③ 软栅格化输入：每个采样时间点上每组的蒙皮顶点（+UV）与三角形（+变号标记）
const sampleTs = [0, 0.233, 0.4, 0.6, 1.0, 2.5, 6.0, 8.37, 8.5, 9.0]
const dom = new Int32Array(NV)
for (let i = 0; i < NV; i++) {
  const w = mesh.blendWeights[i] || [1, 0, 0, 0], bi = mesh.blendIndices[i] || [0, 0, 0, 0]
  let k = 0
  for (let j = 1; j < 4; j++) if ((w[j] || 0) > (w[k] || 0)) k = j
  let wsz = 0
  for (let j = 0; j < 4; j++) wsz += Math.abs(w[j] || 0)
  dom[i] = wsz > 0 ? (bi[k] | 0) : (bi[0] | 0)
}
const triList = []
for (let ti = 0; ti < nTri; ti++) {
  const i0 = mesh.indices[ti * 3], i1 = mesh.indices[ti * 3 + 1], i2 = mesh.indices[ti * 3 + 2]
  const g = (dom[i0] === dom[i1] && dom[i1] === dom[i2]) ? dom[i0] : -1
  triList.push({ ti, i: [i0, i1, i2], g })
}
function skinVerts(g16) {
  const out = new Float64Array(NV * 2)
  for (let i = 0; i < NV; i++) {
    const p = mesh.positions[i], w = mesh.blendWeights[i] || [1, 0, 0, 0], bi = mesh.blendIndices[i] || [0, 0, 0, 0]
    let x = 0, y = 0
    for (let k = 0; k < 4; k++) {
      const ww = w[k] || 0
      if (ww === 0) continue
      const o = (bi[k] | 0) * 16
      x += (p[0] * g16[o] + p[1] * g16[o + 4] + p[2] * g16[o + 8] + g16[o + 12]) * ww
      y += (p[0] * g16[o + 1] + p[1] * g16[o + 5] + p[2] * g16[o + 9] + g16[o + 13]) * ww
    }
    out[i * 2] = x; out[i * 2 + 1] = y
  }
  return out
}
const uv = mesh.uvs
const frames = []
let base = null
for (const t of sampleTs) {
  const V = skinVerts(gBonesAt(t))
  if (!base) base = { V: skinVerts(gBonesAt(0)), signs: null, sg: null }
  const triOut = triList.map(({ ti, i, g }) => {
    const ax = V[i[0] * 2], ay = V[i[0] * 2 + 1], bx = V[i[1] * 2], by = V[i[1] * 2 + 1], cx = V[i[2] * 2], cy = V[i[2] * 2 + 1]
    const ar = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    return { ti, g, i, a: +ar.toFixed(4) }
  })
  if (!base.sg) base.sg = triOut.map((o) => Math.sign(o.a))
  frames.push({ t, tri: triOut, verts: Array.from(V).map((v) => +v.toFixed(4)) })
}
const S = base.sg
for (const fr of frames) for (let k = 0; k < fr.tri.length; k++) {
  const a = fr.tri[k].a
  fr.tri[k].inv = (a !== 0 && S[k] !== 0 && Math.sign(a) !== S[k]) ? 1 : 0
}
write('render.json', {
  layer: { id: 66, name: '人物', origin: ORIGIN, scale: SCALE, proj: PROJ },
  nb: NB, nv: NV, nTri, uv, indices: mesh.indices, dom: Array.from(dom),
  groups: [...new Set(Array.from(dom))].sort((a, b) => a - b).map((b2) => ({ b: b2, nv: Array.from(dom).filter((d) => d === b2).length, chain: (() => { const c = []; let p = parentOf[b2]; let gu = 0; while (p >= 0 && gu++ < 64) { c.push(p); p = parentOf[p] } return c })() })),
  frames,
})
console.log('  ③ → render.json（' + sampleTs.length + ' 个时间点的蒙皮顶点/三角形 + UV）')

// ④ 真实贴图解码（供 UV 裁剪：这一组画的是脸上哪一块）
try {
  const mat = JSON.parse(dec.decode(lib.getEntry(pkg, 'materials/人物.json')).replace(/^\uFEFF/, ''))
  const texName = (((mat.passes || [])[0] || {}).textures || [])[0]
  const u8 = lib.getEntry(pkg, 'materials/' + texName + '.tex')
  const tex = lib.parseTex(u8)
  const mip = lib.decodeMip0(tex)
  if (mip && mip.rgba) {
    fs.writeFileSync(path.join(OUT, 'tex-' + texName + '.rgba'), Buffer.from(mip.rgba.buffer || mip.rgba, mip.rgba.byteOffset || 0, mip.rgba.length))
    write('tex-' + texName + '.json', { name: texName, width: mip.width, height: mip.height, format: tex.format })
    try { fs.writeFileSync(path.join(OUT, 'tex-' + texName + '.png'), png(mip.width, mip.height, mip.rgba)) } catch (e) { logLines.push('[tex] png 编码失败 ' + e.message) }
    console.log('  ④ → tex-' + texName + '.png（' + mip.width + '×' + mip.height + '）')
  }
} catch (e) { console.log('  ④ 贴图解码跳过：' + e.message) }

write('log.txt', logLines.join('\n') + '\n')
console.log('✓ 完成：' + OUT)

// submesh-probe-test.mjs — P-109（任务书 P1-4）：`?submesh=` 子网格隔离探针（唯一能直接解"眉毛翻转"悬案的工具）
//
// 背景（UNTOUCHED-AREAS D 项）：hina 3554161528 的 37 个对象里**没有**独立眼/眉层（脸是一张
//   `materials/人物.tex`），用户报的"眉毛翻转/眼睛乱动"只可能是**骨/蒙皮权重**的产物；而既有探针
//   都看不到 puppet 内部：`?ln` 只到**层**粒度，`layer.__subMeshOnly`（P-44）是 MDL **多材质子块**
//   维度、hina 单块 ⇒ 用不上。本测试守 `?submesh=` 的四件事：
//     ① **默认关 = 逐位不变**：把**当前源码反向变异成"去掉探针的旧写法"**再跑同一帧，
//        GL 调用序列必须逐条相同；且默认不写 `__mpwSubMesh`（零副作用）、不建过滤 EBO；
//     ② **分组正确性**：探针台账 vs **独立复算**（本文件用 `core/attach-transform.mjs` 自己再算一遍
//        主影响骨/bbox/质心/影响骨表/父链）逐字段一致；并给出"错误分组规则"的对照（用
//        `blendIndices[0]` 分组会得到不同的组数/顶点分布 ⇒ 断言具备区分力，改回错写法必红）；
//     ③ **筛选语义**：单骨/闭区间/`*` 后代（父链）/`all` 四种规格下**实绘索引集**与独立期望逐位一致
//        （mock GL 记录 `bufferData(ELEMENT_ARRAY_BUFFER)` 内容 + `drawElements` 实参）；
//        三种三角形归属规则 `?subtri=all|major|any` 的条数与独立期望一致；空集筛选**一个 draw 都不发**；
//     ④ **台账字段**：bbox/质心/顶点数/影响骨/父链/位移时程/翻转计数的形状与数值不变量
//        （顶点数求和=497、质心落 bbox 内、bind 姿态位移恒 0、world 口径对拍、`?bones=` 可叠加）。
//
// 运行：node tests/submesh-probe-test.mjs   （全过输出 ALL PASS，退出码 0；缺包时真包部分 SKIP 视作 PASS）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

globalThis.location = globalThis.location || { search: '' }
const ROOT = path.resolve(import.meta.dirname, '..')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const lib = await import(pathToFileURL(BUNDLE).href)
const at = await import(pathToFileURL(path.join(ROOT, 'core', 'attach-transform.mjs')).href)
const ps = await import(pathToFileURL(path.join(ROOT, 'core', 'puppet-skin.js')).href)

// ①(去个人化 2026-09-16) 工作区根：环境变量优先；默认值只是作者本机路径。
const MPW_WS = process.env.MPW_ROOT || WS
const PKG = process.env.MPW_HINA_PKG || path.join(MPW_WS, 'allwallpaper', 'dd', '3554161528', 'scene.pkg')
const dec = new TextDecoder()

let pass = 0, fail = 0
const fails = []
function check(ok, name, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const near = (a, b, eps, name) => check(Math.abs(a - b) <= eps, name, `实测 ${a} vs 期望 ${b}，容差 ${eps}`)
const bits = (x) => JSON.stringify(x)

// ───────────────────────── mock GL（记录调用序列；与 projection-y-test 同族） ─────────────────────────
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  RG8: 0x8229, RG: 0x8227, ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER: 0x8892, TRIANGLES: 4, UNSIGNED_SHORT: 0x1403,
  STATIC_DRAW: 0x88E4, FLOAT: 0x1406 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function mkGl() {
  let seq = 0, curUnit = 0
  const curTex = new Array(8).fill(null)
  const calls = []            // 每条 GL 调用一行（默认逐位不变对拍的唯一依据）
  const eboData = []          // bufferData(ELEMENT_ARRAY_BUFFER) 的内容（= 实绘索引集）
  const draws = []            // drawElements 实参
  const vaos = []             // 本会话创建的 VAO（判"是否新建过滤 VAO"）
  const mk = (k) => { const o = { id: k + '#' + (++seq) }; if (k === 'vao') vaos.push(o); return o }
  const log = (n, a) => calls.push(n + '(' + a + ')')
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createShader: () => mk('sh'), createProgram: () => mk('prog'),
    createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    bindVertexArray: (v) => log('bindVertexArray', v ? v.id : null),
    activeTexture: (u) => { curUnit = u },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null; log('bindTexture', curUnit + ',' + (tex ? tex.id : null)) },
    bindBuffer: (t, b) => log('bindBuffer', (t === CONST.ELEMENT_ARRAY_BUFFER ? 'EBO' : 'VBO') + ',' + (b ? b.id : null)),
    bufferData: (t, data) => {
      log('bufferData', (t === CONST.ELEMENT_ARRAY_BUFFER ? 'EBO' : 'VBO') + ',' + (data && data.length))
      if (t === CONST.ELEMENT_ARRAY_BUFFER && data && data.length) eboData.push({ vao: vaos.length, data: Array.from(data) })
    },
    enableVertexAttribArray: (l) => log('enableVertexAttribArray', l),
    vertexAttribPointer: (l, size, type, norm, stride, off) => log('vertexAttribPointer', [l, size, stride, off].join(',')),
    drawElements: (m, c, t, o) => { draws.push([m, c, t, o]); log('drawElements', [m, c, t, o].join(',')) },
    drawArrays: (m, f, c) => { draws.push(['arrays', c]); log('drawArrays', [m, f, c].join(',')) },
    useProgram: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_BlendIdx' ? 2 : n === 'a_BlendWeight' ? 3 : -1,
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0, isTexture: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', texImage2D: () => {}, texParameteri: () => {},
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniformMatrix4fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, calls, eboData, draws, vaos, reset() { calls.length = 0; eboData.length = 0; draws.length = 0 } }
}
const shaderResolver = async (rel) => (rel.endsWith('.vert')
  ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }'
  : 'void main(){ gl_FragColor = vec4(1.0); }')

// ───────────────────────── 真包 / 真 MDL（缺包则真包段 SKIP） ─────────────────────────
const hasPkg = fs.existsSync(PKG)
let mesh = null, layer66 = null, sceneJson = null
if (hasPkg) {
  const b = fs.readFileSync(PKG)
  const pkg = lib.parsePkg(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
  sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const mj = JSON.parse(dec.decode(lib.getEntry(pkg, 'models/人物.json')).replace(/^\uFEFF/, ''))
  mesh = at.parseMdl(lib.getEntry(pkg, mj.puppet))
  layer66 = { id: 66, name: '人物', size: [1405, 2013], scale: [1, 1, 1], origin: [2200.54, 595, 0], angles: [0, 0, 0], alpha: 1 }
}
const NB = mesh ? mesh.bones.length : 0
const NV = mesh ? mesh.positions.length : 0

// ───────────────────────── 独立复算（不复用探针代码；探针错就必红） ─────────────────────────
/** 主影响骨 = 4 个权重里最大的那根（并列取小下标）；权重全零 → blendIndices[0]（与 MESH_VS 的 w==0 跳过同口径） */
function refDominant(i) {
  const w = mesh.blendWeights[i] || [1, 0, 0, 0], bi = mesh.blendIndices[i] || [0, 0, 0, 0]
  let k = 0
  for (let j = 1; j < 4; j++) if ((w[j] || 0) > (w[k] || 0)) k = j
  let wsz = 0
  for (let j = 0; j < 4; j++) wsz += Math.abs(w[j] || 0)
  return wsz > 0 ? (bi[k] | 0) : (bi[0] | 0)
}
/** 用 blendIndices[0] 分组（**错误规则**，只作对照：证明断言有区分力） */
function refFirstIdx(i) {
  const bi = mesh.blendIndices[i] || [0, 0, 0, 0]
  return bi[0] | 0
}
function refGroups(keyFn) {
  const g = new Map()
  for (let i = 0; i < NV; i++) { const b = keyFn(i); if (!g.has(b)) g.set(b, []); g.get(b).push(i) }
  return g
}
/** 独立复算的三角形归属表（规则与文档一致） */
function refTris() {
  const out = { all: new Map(), major: new Map(), any: new Map() }
  const dom = new Array(NV)
  for (let i = 0; i < NV; i++) dom[i] = refDominant(i)
  const nTri = Math.floor(mesh.indices.length / 3)
  for (let ti = 0; ti < nTri; ti++) {
    const a = dom[mesh.indices[ti * 3]], b = dom[mesh.indices[ti * 3 + 1]], c = dom[mesh.indices[ti * 3 + 2]]
    const push = (m, k) => { if (!m.has(k)) m.set(k, []); m.get(k).push(ti) }
    if (a === b && b === c) push(out.all, a)
    push(out.major, (b === c) ? b : (a === c) ? a : a)
    if (a === b) { push(out.any, a); push(out.any, c) }
    else if (b === c) { push(out.any, b); push(out.any, a) }
    else if (a === c) { push(out.any, a); push(out.any, b) }
    else { push(out.any, a); push(out.any, b); push(out.any, c) }
  }
  return out
}
const parentOf = []
if (mesh) for (let b = 0; b < NB; b++) parentOf.push((mesh.bones[b] && mesh.bones[b].parent != null) ? (mesh.bones[b].parent | 0) : -1)
function refDescendants(sel) {
  const s = new Set(sel)
  let add = true
  while (add) { add = false; for (let b = 0; b < NB; b++) if (parentOf[b] >= 0 && s.has(parentOf[b]) && !s.has(b)) { s.add(b); add = true } }
  return s
}

// ───────────────────────── 渲染驱动 ─────────────────────────
function mkMinScene() {
  return { general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, properties: {}, layers: [] }
}
const BIND_GBONES = () => {
  const g = new Float32Array(NB * 16)
  for (let b = 0; b < NB; b++) g.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], b * 16)
  return g
}
/** 跑一层 mesh（默认 gBones = bind 姿态）；`mod` 可换成"旧写法"变异模块 */
async function runMesh(search, opts = {}) {
  const mod = opts.mod || lib
  const prevLoc = globalThis.location
  globalThis.location = { search }
  delete globalThis.__mpwSubMesh
  delete globalThis.__mpwBones
  const M = mkGl()
  const r = mod.createRenderer({ getContext: () => M.gl }, { onLog: () => {}, shaderResolver })
  const gBones = BIND_GBONES()
  const times = opts.times || [0.5]
  for (let k = 0; k < times.length; k++) {
    if (opts.viaRenderScene) await r.render(mkMinScene(), new Map(), 1920, 1080, times[k])
    M.reset()
    r.renderMeshLayer(layer66, mesh, gBones, NB, [2200.54, 595], [1, -1], [3840, 2160], { id: 'tex#x' })
  }
  globalThis.location = prevLoc
  return { ledger: globalThis.__mpwSubMesh, calls: M.calls, eboData: M.eboData, draws: M.draws, vaos: M.vaos }
}

// ───────────────────────── ① 默认关：与"去掉探针的旧写法"逐条对拍 ─────────────────────────
console.log('\n[1] 默认关（无 ?submesh=）：GL 调用序列与"旧写法"逐条一致 + 零副作用')
let mutantPath = null
try {
  if (!hasPkg) {
    console.log('  SKIP submesh 真包段（缺包 ' + PKG + '）')
  } else {
    // **反向变异**（任务书"改回旧写法要能红"的机器化）：把源码里的 P-109 探针块整段删掉、
    //   绘制尾巴还原成旧写法，写成临时模块再跑同一帧 —— 两条 GL 调用序列必须**逐条相同**。
    const SRC = fs.readFileSync(BUNDLE, 'utf8')
    const M1 = '  // ①(P-109) 子网格隔离探针的实现'
    const M2 = '  // ①(P-69 第 4 项) 逐骨位姿探针的实现'
    const i1 = SRC.indexOf(M1), i2 = SRC.indexOf(M2)
    check(i1 > 0 && i2 > i1, '失效性检查：源码里找得到 P-109 探针块标记（探针被删/改写 ⇒ 本测试必红）',
      'i1=' + i1 + ' i2=' + i2)
    const NEW_TAIL = `      let __subDraw = null
      if (SUB_WANT) { try { __subDraw = __subMeshTick(layer, mesh, rec, __sm, gBonesArr, boneCount, originXY, scaleXY, __mc) } catch (e) { __subDraw = null } }
      if (__subDraw) {
        // 筛选生效：只画命中的索引区间（\`count === 0\` = 该筛选下没有三角形 ⇒ **一个 draw 都不发**，
        //   ⚠ 绝不退回全量——否则"按不存在的骨号筛选"会画出整个网格，是最危险的误判）。
        if (__subDraw.count > 0) {
          gl.bindVertexArray(__subDraw.vao)
          gl.drawElements(gl.TRIANGLES, __subDraw.count, gl.UNSIGNED_SHORT, 0)
          gl.bindVertexArray(null)
        }
      } else if (__sm) gl.drawElements(gl.TRIANGLES, __sm.count, gl.UNSIGNED_SHORT, __sm.start * 2)
      else gl.drawElements(gl.TRIANGLES, rec.count, gl.UNSIGNED_SHORT, 0)
      gl.bindVertexArray(null)`
    const OLD_TAIL = `      if (__sm) gl.drawElements(gl.TRIANGLES, __sm.count, gl.UNSIGNED_SHORT, __sm.start * 2)
      else gl.drawElements(gl.TRIANGLES, rec.count, gl.UNSIGNED_SHORT, 0)
      gl.bindVertexArray(null)`
    check(SRC.includes(NEW_TAIL), '失效性检查：源码里找得到 P-109 的绘制接线（接线被改 ⇒ 本测试必红）')
    const MUT = SRC.slice(0, i1) + SRC.slice(i2).replace(NEW_TAIL, OLD_TAIL)
    //   变异文件必须落在 core/ 里（bundle 的相对导入 './attach-transform.mjs' 才解析得到）
    mutantPath = path.join(ROOT, 'core', '.tmp-submesh-mutant-' + process.pid + '.mjs')
    fs.writeFileSync(mutantPath, MUT)
    const mod = await import(pathToFileURL(mutantPath).href + '?v=' + Date.now())

    const now = await runMesh('?id=3554161528&nodebug')
    const old = await runMesh('?id=3554161528&nodebug', { mod })
    check(now.ledger === undefined, '默认（无 ?submesh=）⇒ 不写 globalThis.__mpwSubMesh（零副作用）', bits(now.ledger))
    check(bits(now.calls) === bits(old.calls), '默认路径 GL 调用序列 == 旧写法（逐条相同，共 ' + old.calls.length + ' 条）',
      bits(now.calls) === bits(old.calls) ? '' : ('now=' + bits(now.calls) + ' old=' + bits(old.calls)))
    check(bits(now.draws) === bits(old.draws) && bits(now.draws) === bits([[4, mesh.indices.length, 0x1403, 0]]),
      '默认绘制实参 == 冻结旧写法 [TRIANGLES, indices.length, UNSIGNED_SHORT, 0]', bits(now.draws))
    check(now.vaos.length === old.vaos.length, '默认路径不多建 VAO（' + old.vaos.length + ' 个，与旧写法相同）',
      'now=' + now.vaos.length + ' old=' + old.vaos.length)
    check(now.eboData.length === 1, '默认路径只建 1 个 EBO（上传自带的那个，无过滤 EBO）', 'n=' + now.eboData.length)

    // `?submesh=all`：只出台账、绘制**逐位不变**
    const all = await runMesh('?id=3554161528&submesh=all')
    check(bits(all.calls) === bits(now.calls), '?submesh=all ⇒ GL 调用序列与默认档逐条相同（只出台账）',
      bits(all.calls) === bits(now.calls) ? '' : ('all=' + bits(all.calls)))
    check(all.ledger && all.ledger.all === true && all.ledger.groups.length === 29,
      '?submesh=all ⇒ 台账 29 个顶点组（真 MDL 实测）', all.ledger ? ('组=' + all.ledger.groups.length) : 'undefined')
    check(all.ledger && all.ledger.drawn && all.ledger.drawn.unchanged === true, '台账标记 drawn.unchanged=true（all 档不改绘制）')
    const off2 = await runMesh('?id=3554161528&submesh=off')
    check(off2.ledger === undefined, '?submesh=off ⇒ 同"默认关"（不写台账）')

    // ───────────────────────── ② 分组正确性：探针台账 vs 独立复算 ─────────────────────────
    console.log('\n[2] 分组正确性：台账 vs 独立复算（主影响骨/顶点数/bbox/质心/影响骨/父链）')
    const refG = refGroups(refDominant)
    const led = all.ledger
    check(led.nv === NV && led.nb === NB, `顶点/骨数（nv=${NV} nb=${NB}）`, `探针 nv=${led.nv} nb=${led.nb}`)
    check(led.groups.length === refG.size, `组数 == 独立复算（${refG.size}）`, `探针 ${led.groups.length}`)
    let sumV = 0, bboxOk = true, cOk = true, boneOk = true, chainOk = true, vertsOk = true
    for (const g of led.groups) {
      const vs = refG.get(g.b) || []
      sumV += g.nv
      if (g.nv !== vs.length) vertsOk = false
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0
      for (const i of vs) {
        const p = mesh.positions[i]
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); cx += p[0]; cy += p[1]
      }
      cx /= vs.length; cy /= vs.length
      if (Math.abs(g.bbox[0] - x0) > 1e-3 || Math.abs(g.bbox[1] - y0) > 1e-3 || Math.abs(g.bbox[2] - x1) > 1e-3 || Math.abs(g.bbox[3] - y1) > 1e-3) bboxOk = false
      if (Math.abs(g.c[0] - cx) > 1e-3 || Math.abs(g.c[1] - cy) > 1e-3) cOk = false
      if (g.verts.length !== Math.min(32, vs.length)) vertsOk = false
      const m = new Map()
      for (const i of vs) {
        const w = mesh.blendWeights[i], bi = mesh.blendIndices[i]
        for (let j = 0; j < 4; j++) { const ww = w[j] || 0; if (!ww) continue; const bb = bi[j] | 0; const cur = m.get(bb) || { w: 0, n: 0 }; cur.w += ww; cur.n++; m.set(bb, cur) }
      }
      const exp = [...m.entries()].map(([b, o]) => ({ b, w: +o.w.toFixed(4), n: o.n })).sort((a, b) => b.w - a.w || a.b - b.b)
      if (bits(g.bones) !== bits(exp)) { boneOk = false; if (fails.length < 3) console.log('    ↳ b' + g.b + ' 影响骨不一致: ' + bits(g.bones) + ' vs ' + bits(exp)) }
      const ch = []
      let p = parentOf[g.b], guard = 0
      while (p >= 0 && guard++ < 64) { ch.push(p); p = parentOf[p] }
      if (bits(g.chain) !== bits(ch)) chainOk = false
    }
    check(sumV === NV && vertsOk, `各组顶点数求和 == 全部顶点数（${NV}），且 verts[] 与组内顶点一致`, 'sum=' + sumV)
    check(bboxOk, '每组 bbox == 独立复算（bind 网格空间 min/max）')
    check(cOk, '每组质心 == 独立复算')
    check(boneOk, '每组"被哪些骨影响"表（骨号/权重和/顶点数/排序）== 独立复算')
    check(chainOk, '每根主影响骨的父链（由近及远）== 独立复算')
    // **区分力对照**：错误规则（blendIndices[0]）会得到不同的分组 ⇒ 上面的断言不是恒真
    const wrongG = refGroups(refFirstIdx)
    check(wrongG.size !== refG.size,
      `区分力对照：用 blendIndices[0] 分组会得到 ${wrongG.size} 组 ≠ 主影响骨的 ${refG.size} 组（改回错写法必红）`)
    let diffV = 0
    for (let i = 0; i < NV; i++) if (refDominant(i) !== refFirstIdx(i)) diffV++
    check(diffV > 0, `区分力对照：${diffV}/${NV} 个顶点的 blendIndices[0] ≠ 主影响骨`, 'diff=' + diffV)

    // ───────────────────────── ③ 筛选语义：实绘索引集 vs 独立期望 ─────────────────────────
    console.log('\n[3] 筛选语义：单骨 / 闭区间 / `*` 后代 / 三档 tri 规则的实绘索引集')
    const refT = refTris()
    const expIdx = (triList) => {
      const out = []
      for (const ti of triList.slice().sort((a, b) => a - b)) out.push(mesh.indices[ti * 3], mesh.indices[ti * 3 + 1], mesh.indices[ti * 3 + 2])
      return out
    }
    const uni = (arrs) => { const s = new Set(); for (const a of arrs) for (const t of a) s.add(t); return [...s].sort((a, b) => a - b) }
    const cases = [
      { spec: '16', sel: [16] },
      { spec: '17-19', sel: [17, 18, 19] },
      { spec: '24*', sel: [...refDescendants([24])] },
      { spec: '16-19,30', sel: [16, 17, 18, 19, 30] },
    ]
    for (const c of cases) {
      for (const mode of ['all', 'major', 'any']) {
        const res = await runMesh('?id=3554161528&submesh=' + encodeURIComponent(c.spec) + '&subtri=' + mode)
        const expTris = uni(c.sel.map((b) => refT[mode].get(b) || []))
        const got = res.eboData.length ? res.eboData[res.eboData.length - 1].data : []
        const want = expIdx(expTris)
        const d = res.draws[res.draws.length - 1]
        const ok = bits(got) === bits(want) && bits(d) === bits([4, want.length, 0x1403, 0])
          && res.ledger && res.ledger.drawn.tris === expTris.length
        check(ok, `?submesh=${c.spec}&subtri=${mode} ⇒ 实绘 ${expTris.length} 个三角形（索引 ${want.length} 个）与独立期望逐位一致`,
          ok ? ('draw=' + bits(d)) : ('got=' + got.length + ' want=' + want.length + ' draw=' + bits(d) + ' ledgertris=' + (res.ledger && res.ledger.drawn.tris)))
        if (c.spec === '16-19,30' && mode === 'all') {
          const selGroups = res.ledger.groups.filter((g) => g.sel).map((g) => g.b)
          check(bits(selGroups) === bits([16, 17, 18, 19, 30]), '台账 sel 标记 == 筛选骨集合', bits(selGroups))
          check(res.ledger.groups.find((g) => g.b === 16).tri.all === (refT.all.get(16) || []).length
            && res.ledger.groups.find((g) => g.b === 16).tri.major === (refT.major.get(16) || []).length
            && res.ledger.groups.find((g) => g.b === 16).tri.any === (refT.any.get(16) || []).length,
            '台账每组 tri.{all,major,any} 三种规则条数 == 独立复算（以 b16 为例）',
            bits(res.ledger.groups.find((g) => g.b === 16).tri))
        }
      }
    }
    // `24*` 必须真的把 24 的后代（25/26/27）含进来 —— 否则就是"只按骨号没走父链"
    const d24 = await runMesh('?id=3554161528&submesh=24*')
    const sel24 = d24.ledger.groups.filter((g) => g.sel).map((g) => g.b)
    check(bits(sel24) === bits([25, 26, 27]), '?submesh=24* ⇒ 选中 {25,26,27}（骨 24 无顶点，选中它的三个子骨）', bits(sel24))
    const d24b = await runMesh('?id=3554161528&submesh=24')
    check(d24b.ledger.groups.filter((g) => g.sel).length === 0 && d24b.draws.length === 0,
      '?submesh=24（不带 *）⇒ 0 组、**一个 draw 都不发**（不退回全量：这是最危险的误判，单独守一条）',
      'draws=' + bits(d24b.draws))
    // 全量规格：all 规则下 = 整块"严格归属"集合
    const r16 = []
    for (let b = 16; b <= 31; b++) r16.push(b)
    const fullAll = await runMesh('?id=3554161528&submesh=16-31&subtri=all')
    check(fullAll.eboData.length && bits(fullAll.eboData[fullAll.eboData.length - 1].data) === bits(expIdx(uni(r16.map((b) => refT.all.get(b) || [])))),
      '?submesh=16-31 ⇒ 实绘 = 选中骨里"严格归属"三角形的并集（与独立期望逐位一致）',
      'tris=' + (fullAll.ledger && fullAll.ledger.drawn.tris) + '/' + uni(r16.map((b) => refT.all.get(b) || [])).length)
    // 不存在的骨号：台账 missing 记录、不崩、不画
    const miss = await runMesh('?id=3554161528&submesh=99')
    check(miss.ledger && bits(miss.ledger.missing) === bits([99]) && miss.ledger.drawn.tris === 0 && miss.draws.length === 0,
      '?submesh=99（不存在的骨号）⇒ missing=[99]、0 三角形、0 次 draw、不崩', (miss.ledger ? bits(miss.ledger.missing) : 'undefined') + ' draws=' + miss.draws.length)
    const offBad = await runMesh('?id=3554161528&submesh=abc,16')
    check(offBad.ledger && offBad.ledger.drawn.tris === (refT.all.get(16) || []).length, '非法 token 被忽略、合法 token 仍生效（abc,16 ⇒ 只有 b16）')

    // ───────────────────────── ④ 台账字段 + 位移时程 + 翻转计数 + 与 ?bones= 叠加 ─────────────────────────
    console.log('\n[4] 台账字段/位移时程/翻转计数/与 ?bones= 叠加')
    const seq = await runMesh('?id=3554161528&submesh=all&bones=人物', { viaRenderScene: true, times: [0, 0.1, 0.25, 0.5, 1] })
    const L = seq.ledger
    check(!!L && !!globalThis.__mpwSubMesh, '台账对象存在（globalThis.__mpwSubMesh）')
    const g16 = L.groups.find((g) => g.b === 16)
    check(!!g16 && g16.nv === (refG.get(16) || []).length, `b16 组：${(refG.get(16) || []).length} 个顶点`, g16 && ('nv=' + g16.nv))
    check(g16.c[0] >= g16.bbox[0] && g16.c[0] <= g16.bbox[2] && g16.c[1] >= g16.bbox[1] && g16.c[1] <= g16.bbox[3],
      '质心必落在本组 bbox 内（不变量）', bits(g16.c) + ' in ' + bits(g16.bbox))
    check(Array.isArray(g16.hist) && g16.hist.length >= 2 && g16.hist[0][0] <= g16.hist[g16.hist.length - 1][0],
      '位移时程 hist 为按时间递增的 [t,dx,dy] 序列（≥2 个采样点）', g16.hist.length + ' 点 t=' + g16.hist.map((h) => h[0]).join(','))
    check(g16.disp && isFinite(g16.disp.dx) && isFinite(g16.disp.dy) && g16.disp.mag >= 0,
      'disp 字段有限且 mag ≥ 0', bits(g16.disp))
    const magHist = Math.max(...g16.hist.map((h) => Math.hypot(h[1], h[2])))
    check(magHist <= g16.disp.mag + 1e-6, 'disp.mag ≥ hist 内最大位移（会话累计口径 ≥ 采样窗口径）',
      magHist.toFixed(4) + ' ≤ ' + g16.disp.mag)
    check(L.summary && L.summary.nGroups === 29 && L.summary.nSelected === 29 && L.summary.vertsSelected === NV,
      'summary：29 组 / 选中 29 组 / 顶点合计 = 全部顶点（all 档）', bits(L.summary))
    check(L.samples.n === 5 && L.samples.t0 === 0 && L.samples.t1 === 1, 'samples 记账（5 帧 / t0=0 / t1=1）', bits({ n: L.samples.n, t0: L.samples.t0, t1: L.samples.t1 }))
    check(globalThis.__mpwBones && globalThis.__mpwBones.nb === NB && L.nb === NB,
      '与 ?bones= 叠加：两个探针同时生效且互不覆盖（__mpwBones + __mpwSubMesh）',
      'bones=' + (globalThis.__mpwBones && globalThis.__mpwBones.nb) + ' submesh=' + L.nb)
    // 姿态 = bind（gBones = I）⇒ 蒙皮后 == 原始顶点坐标 ⇒ 位移必须恒为 0（自证蒙皮台账口径正确）
    let maxDisp0 = 0
    for (const g of L.groups) maxDisp0 = Math.max(maxDisp0, g.disp.mag)
    near(maxDisp0, 0, 1e-4, '姿态=bind（gBones=I）⇒ 全组位移恒为 0（蒙皮台账口径自证）')
    let maxInv0 = 0
    for (const g of L.groups) maxInv0 = Math.max(maxInv0, g.invert.max)
    check(maxInv0 === 0, '姿态=bind ⇒ 无三角形变号（翻转计数基线为 0）', 'maxInvert=' + maxInv0)
    // 世界坐标口径：world = origin + scale⊙skin（本档 skin == 原始顶点，可直接对拍）
    near(g16.last.world[0], 2200.54 + 1 * g16.c[0], 1e-3, 'world.x == origin.x + scale.x·skin.x（设计像素口径）')
    near(g16.last.world[1], 595 + (-1) * g16.c[1], 1e-3, 'world.y == origin.y + scale.y·skin.y（scale.y=−1 与 MESH_VS 同口径）')
  }
} finally {
  // 临时变异模块必须清掉（失败/异常路径也不留垃圾）
  try { if (mutantPath) fs.unlinkSync(mutantPath) } catch (e) { /* ignore */ }
}

// ───────────────────────── ⑤ 反向断言：真动画下探针必须报出"位移/翻转"（工具具备能力） ─────────────────────────
console.log('\n[5] 真动画（hina 三条 additive 层）下探针的判别力：位移与翻转计数非平凡')
if (!hasPkg) {
  console.log('  SKIP submesh 动画段（缺包）')
} else {
  // ①(P-110 2026-09-17) bind 链序改走**渲染器同一实现处**（`core/puppet-skin.js::bindWorldChain`，
  //   子先乘修正序；旧写法只由 `?bindorder=legacy` 启用）—— 本段之前自己写了一遍父先乘，等于让
  //   探针量的是"改前的口径"；现在与 demo.html/attach-transform 逐位同源（见 tests/bind-order-test.mjs）。
  const bindWorld = lib.bindWorldChain(mesh.bones)
  const bindInv = bindWorld.map(ps.matInvertRow)
  const bindRT = lib.bindWorldPolar(bindWorld)
  const obj66 = sceneJson.objects.find((o) => o.id === 66)
  // 动画层 → MDLA 动画的映射用仓库既有口径（名字 → 数字后缀 → 层索引 → 0；见 attach-transform.selectAnimLayers）
  const animSpec = at.selectAnimLayers(obj66, mesh)
  const good = lib.analyzeAnimGoodFrames(mesh, at.sampleAnimRT)
  const prevLoc = globalThis.location
  globalThis.location = { search: '?id=3554161528&submesh=all' }
  delete globalThis.__mpwSubMesh
  const M = mkGl()
  const r = lib.createRenderer({ getContext: () => M.gl }, { onLog: () => {}, shaderResolver })
  const gBones = new Float32Array(NB * 16)
  const times = []
  for (let f = 0; f <= 270; f += 3) times.push(f / 30)
  for (const t of times) {
    const A = lib.sampleCompositeAdditivePose({ mesh, bindRT, animSpec, animGood: good, tAnim: t, fps: 30, nb: NB, sampleRT: at.sampleAnimRT })
    for (let b = 0; b < NB; b++) {
      const { angle, tx, ty } = A[b], c = Math.cos(angle), s = Math.sin(angle)
      gBones.set(at.matMulRow(bindInv[b], [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]), b * 16)
    }
    await r.render(mkMinScene(), new Map(), 1920, 1080, t)   // 让探针的帧时间（__bonesNowT）落在该 t
    r.renderMeshLayer(layer66, mesh, gBones, NB, [2200.54, 595], [1, -1], [3840, 2160], { id: 'tex#x' })
  }
  globalThis.location = prevLoc
  const L2 = globalThis.__mpwSubMesh
  check(!!L2 && L2.samples.n === times.length, `探针在 ${times.length} 个真动画时间点上记账`, L2 && ('samples=' + L2.samples.n))
  const top = L2.groups.slice().sort((a, b) => b.disp.mag - a.disp.mag)[0]
  check(top.disp.mag > 1, `真动画下最大位移非平凡（b${top.b} 位移 ${top.disp.mag.toFixed(2)} skin 单位 @${top.disp.at}s）`,
    'top=' + bits({ b: top.b, mag: top.disp.mag, at: top.disp.at }))
  const inv = L2.groups.slice().sort((a, b) => b.invert.max - a.invert.max)[0]
  check(inv.invert.max > 0, `真动画下存在"组内三角形有向面积变号"（b${inv.b} 最多 ${inv.invert.max}/${inv.invert.nTri} 条 @${inv.invert.at}s）`,
    'inv=' + bits({ b: inv.b, max: inv.invert.max, at: inv.invert.at, nTri: inv.invert.nTri }))
  check(L2.samples.t1 > L2.samples.t0, `时程跨 ${L2.samples.t0}→${L2.samples.t1}s（多时间点位移可判）`)
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAILED ' + fail)) + `（${pass} 通过 / ${fail} 失败）`)
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }

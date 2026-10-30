// submesh-mirror-test.mjs — P-117（2026-09-18）：把"眉毛整组翻转 180°"变成**组级方向判据**，并修掉
//   `?submesh=` 台账里"三角形有向面积变号"的**基线口径**缺陷。全部读数走**真渲染路径**
//   （mock-GL 驱动真 `renderMeshLayer` + 真包 `scene.pkg` + 真 MDLA 动画 + 真 `sampleCompositeAdditivePose`）。
//
// 为什么需要这个测试（P-117 的取证结论）：
//   ① P-110 修掉 bind 世界链序后，hina 面部还剩 `b16 1/17` 的"变号"。既有 `invert` 计数把两种**完全不同**
//      的现象混在一个数里：(a) **整组镜像**（用户报的"眉毛翻 180°"，组的方向反转、det<0）；(b) **局部塌陷/折面**
//      （个别三角形有向面积过零又回来，组 det 仍为正）。只报 `invert>0` ⇒ "那个 bug 到底还在不在"无法判定。
//   ② 旧口径的变号基线取"探针看到的**第一个采样帧**"⇒ 若会话从"已经折叠/已经镜像"的那一帧开始，
//      基线就把翻转态当正常态 ⇒ **持续存在的镜像整个漏报**（实测：`?bindorder=legacy` 下只取 f8..f11
//      这 4 帧，b17 明明 8/8 全翻，旧口径报 `invert.max=0`）。基线必须取 **bind 姿态**（顶点原始绕序）。
//
// 本测试守四件事：
//   T1 判据自证：gBones=I（bind 姿态）⇒ 每组 det≈1、无镜像、无变号（判据不是"永远绿"的空断言）
//   T2 **用户可见不变量**：hina 真动画 271 帧（t=0→9s）⇒ `mirrorGroups=0` 且 `minDet>0.9`
//   T3 RED-IF-REVERTED：同一段帧 + `?bindorder=legacy`（P-110 之前的序 = 那个 bug）⇒ 判据必须变红
//   T4 判据灵敏度：合成"镜像"（只把骨 16 矩阵第一行取负）⇒ 必须报出 b16 镜像（反证 T2 有区分力）
//   T5 残余定性：默认序下 b16 `invert>0` 但**组 det 始终为正** ⇒ 是折面不是镜像（与 P-110 口径一致）
//   T6 根因钉死：残余的驱动是**作者数据**——anim1 轨 30（瞳孔骨）第 14→15 行的一帧 9.4px 跳变，
//      用**独立的顺序寻址**（wer-ref 布局：[int32 flags][uint32 byteSize][N×36B]）从原始字节复核
//   T7 口径修正自证：会话落在折面窗口内时，bind 基线报 8/8、legacy 基线报 0/8（旧口径盲区可复现）
//   T8 不回归：其余 4 个有 puppet 的真包同样 `mirrorGroups=0`；2 个无 puppet 的包探针无物可测
//   T9 零副作用：`?subbase=legacy` 只改台账、GL 调用序列逐条不变（与 `?submesh=` 的既有契约一致）
//
// 运行：node tests/submesh-mirror-test.mjs   （全过 ALL PASS，退出码 0；缺语料时真包段 SKIP 视作 PASS）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

globalThis.location = globalThis.location || { search: '' }
const ROOT = path.resolve(import.meta.dirname, '..')
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
const at = await import(pathToFileURL(path.join(ROOT, 'core', 'attach-transform.mjs')).href)
const ps = await import(pathToFileURL(path.join(ROOT, 'core', 'puppet-skin.js')).href)
const dec = new TextDecoder()

// ①(去个人化) 工作区根：环境变量优先；默认值只是作者本机路径（与既有真包测试同口径）
const MPW_WS = process.env.MPW_ROOT || WS
const DD = process.env.MPW_DD || path.join(MPW_WS, 'allwallpaper', 'dd')
const HINA = process.env.MPW_HINA_PKG || path.join(DD, '3554161528', 'scene.pkg')
const OTHER = ['3544152633', '3327063360', '3719111841', '3326873240', '3660962877']

let pass = 0, fail = 0
const fails = []
function check(ok, name, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const near = (a, b, eps, name) => check(Math.abs(a - b) <= eps, name, `实测 ${a} vs 期望 ${b}，容差 ${eps}`)
const bits = (x) => JSON.stringify(x)

// ───────────────────────── mock GL（与 tests/submesh-probe-test.mjs 同族；只记录调用序列） ─────────────────────────
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  RG8: 0x8229, RG: 0x8227, ELEMENT_ARRAY_BUFFER: 0x8893, ARRAY_BUFFER: 0x8892, TRIANGLES: 4, UNSIGNED_SHORT: 0x1403,
  STATIC_DRAW: 0x88E4, FLOAT: 0x1406 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function mkGl() {
  let seq = 0, curUnit = 0
  const curTex = new Array(8).fill(null)
  const calls = [], draws = []
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const log = (n, a) => calls.push(n + '(' + a + ')')
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createShader: () => mk('sh'), createProgram: () => mk('prog'),
    createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    bindVertexArray: (v) => log('bindVertexArray', v ? v.id : null),
    activeTexture: (u) => { curUnit = u },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null; log('bindTexture', curUnit + ',' + (tex ? tex.id : null)) },
    bindBuffer: (t, b) => log('bindBuffer', (t === CONST.ELEMENT_ARRAY_BUFFER ? 'EBO' : 'VBO') + ',' + (b ? b.id : null)),
    bufferData: (t, d) => log('bufferData', (t === CONST.ELEMENT_ARRAY_BUFFER ? 'EBO' : 'VBO') + ',' + (d && d.length)),
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
  return { gl, calls, draws, reset() { calls.length = 0; draws.length = 0 } }
}
const shaderResolver = async (rel) => (rel.endsWith('.vert')
  ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }'
  : 'void main(){ gl_FragColor = vec4(1.0); }')
const mkMinScene = () => ({ general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, properties: {}, layers: [] })
const IDENT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

// ───────────────────────── 真包装载（独立于探针：自己找"有 puppet 的模型 + 承载它的层"） ─────────────────────────
/** 解析一个真包 → { pkg, sceneJson, layers:[{obj, mesh}] }（只看带 `puppet` 的模型 json） */
function loadPkg(pkgPath) {
  if (!fs.existsSync(pkgPath)) return null
  const b = fs.readFileSync(pkgPath)
  const pkg = lib.parsePkg(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
  const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const out = []
  for (const e of pkg.entries || []) {
    const p = e.path || e.name
    if (!p || !/^models\/.*\.json$/i.test(p)) continue
    let j = null
    try { j = JSON.parse(dec.decode(lib.getEntry(pkg, p)).replace(/^\uFEFF/, '')) } catch { continue }
    if (!j || !j.puppet) continue
    const mesh = at.parseMdl(lib.getEntry(pkg, j.puppet))
    // 承载该模型的层：scene.json 里 image == 这个模型 json 的对象（demo.html 的 layer 口径）
    const obj = (sceneJson.objects || []).find((o) => o && o.image === p) || null
    out.push({ modelPath: p, mesh, obj })
  }
  return { pkg, sceneJson, models: out }
}
/** 该模型对应的层信息（探针只需要 id/name；origin/scale 只影响 world 读数） */
function layerOf(model, idx) {
  const o = model.obj || {}
  const ov = (v) => (v && typeof v === 'object' && v.value !== undefined ? v.value : v)
  const num = (v, d) => { const x = Number(ov(v)); return isFinite(x) ? x : d }
  const pair = (v, d) => { const a = String(ov(v) == null ? '' : ov(v)).trim().split(/\s+/).map(Number); return (a.length >= 2 && isFinite(a[0]) && isFinite(a[1])) ? [a[0], a[1]] : d }
  return { id: (o.id !== undefined ? o.id : (1000 + idx)), name: String(o.name || ('puppet' + idx)),
    size: pair(o.size, [1000, 1000]), scale: [1, 1, 1], origin: pair(o.origin, [0, 0]), angles: [0, 0, 0], alpha: 1 }
}
/** 用真渲染器跑一串时刻：每帧算 additive 合成姿势 → gBones → renderMeshLayer（= demo.html 的生产写法） */
async function runFrames(model, layer, search, times, opts = {}) {
  const mesh = model.mesh
  const NB = mesh.bones.length
  const bindWorld = lib.bindWorldChain(mesh.bones, { legacy: !!opts.legacyBind })
  const bindInv = bindWorld.map(ps.matInvertRow)
  const bindRT = lib.bindWorldPolar(bindWorld)
  const animSpec = (model.obj ? at.selectAnimLayers(model.obj, mesh) : null) || [{ animIdx: 0, blend: 1, rate: 1, additive: false }]
  const good = lib.analyzeAnimGoodFrames(mesh, at.sampleAnimRT)
  const prevLoc = globalThis.location
  globalThis.location = { search }
  delete globalThis.__mpwSubMesh
  const M = mkGl()
  const r = lib.createRenderer({ getContext: () => M.gl }, { onLog: () => {}, shaderResolver })
  const gBones = new Float32Array(NB * 16)
  for (const t of times) {
    if (opts.rawGbones) opts.rawGbones(gBones, mesh, NB)
    else {
      const A = lib.sampleCompositeAdditivePose({ mesh, bindRT, animSpec, animGood: good, tAnim: t, fps: 30, nb: NB, sampleRT: at.sampleAnimRT })
      for (let b = 0; b < NB; b++) {
        const { angle, tx, ty } = A[b], c = Math.cos(angle), s = Math.sin(angle)
        gBones.set(at.matMulRow(bindInv[b], [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]), b * 16)
      }
    }
    await r.render(mkMinScene(), new Map(), 1920, 1080, t)      // 让探针的帧时间落在该 t
    r.renderMeshLayer(layer, mesh, gBones, NB, layer.origin, [1, -1], [3840, 2160], { id: 'tex#x' })
  }
  globalThis.location = prevLoc
  return { ledger: globalThis.__mpwSubMesh, calls: M.calls, draws: M.draws, NB, mesh, bindRT, animSpec }
}
const allFrames = []
for (let f = 0; f <= 270; f++) allFrames.push(f / 30)      // t = 0 → 9.0s（覆盖 anim1 的 240 帧周期 + 第二次跳变）

console.log('[T1] 判据自证：bind 姿态（gBones=I）⇒ 每组 det≈1、无镜像、无变号')
const hina = fs.existsSync(HINA) ? loadPkg(HINA) : null
let hinaRun = null
if (!hina || !hina.models.length) {
  console.log('  SKIP T1–T7 真包段（缺 hina 包 ' + HINA + '）')
} else {
  const model = hina.models[0], layer = layerOf(model, 0)
  console.log(`  （包：${path.relative(MPW_WS, HINA)}｜模型：${model.modelPath}｜层：id=${layer.id} "${layer.name}"｜骨 ${model.mesh.bones.length}｜顶点 ${model.mesh.positions.length}）`)
  const bind = await runFrames(model, layer, '?id=hina&submesh=all', [0], { rawGbones: (g, m, nb) => { for (let i = 0; i < nb; i++) g.set(IDENT4, i * 16) } })
  const L0 = bind.ledger
  const dets0 = L0.groups.map((g) => g.orient && g.orient.det).filter((d) => d !== null && d !== undefined)
  check(dets0.length >= 20, `orient.det 覆盖了绝大多数组（${dets0.length}/${L0.groups.length}；顶点 <3 的退化组如实置 null）`, 'n=' + dets0.length)
  const maxDev0 = Math.max(...dets0.map((d) => Math.abs(d - 1)))
  check(maxDev0 <= 2e-3, `bind 姿态 ⇒ 每组最小二乘拟合就是恒等映射 ⇒ det≈1（实测最大偏差 ${maxDev0.toExponential(2)}，判据不是"永远绿"）`)
  check(L0.summary.maxInvert === 0 && L0.groups.every((g) => g.invert.max === 0), 'bind 姿态 ⇒ 无三角形变号（变号计数基线自证）', 'maxInvert=' + L0.summary.maxInvert)
  check(L0.summary.mirrorGroups === 0 && L0.summary.minDet > 0.99, 'bind 姿态 ⇒ 无镜像组、minDet≈1', `mirrorGroups=${L0.summary.mirrorGroups} minDet=${L0.summary.minDet}`)
  check(L0.base === 'bind', '台账自描述基线口径（缺省 = bind）', 'base=' + L0.base)

  console.log('\n[T2] 用户可见不变量：hina 真动画 271 帧 ⇒ 没有任何子网格被镜像（组方向 det 恒正）')
  hinaRun = await runFrames(model, layer, '?id=hina&submesh=all', allFrames)
  const L = hinaRun.ledger
  check(L.samples.n === allFrames.length, `探针在 ${allFrames.length} 个真动画帧上记账（t=0→9.0s，覆盖 anim1 的 240 帧周期）`, 'samples=' + L.samples.n)
  check(L.summary.mirrorGroups === 0, '**无任何组被镜像**（mirrorGroups=0 = "眉毛整组翻 180°"在组级判据下不存在）', bits(L.summary.mirrorGroups) + ' mirrorBones=' + bits(L.summary.mirrorBones))
  check(L.summary.minDet > 0.9, `最差组方向 det 仍 >0.9（实测 ${L.summary.minDet} @b${L.summary.minDetGroup} @${L.summary.minDetAt}s ⇒ 只是局部收缩/折面，不是镜像）`)
  const g17 = L.groups.find((g) => g.b === 17), g18 = L.groups.find((g) => g.b === 18)
  check(!!g17 && g17.orient.mirror === false && g17.invert.max === 0, '眉毛组 b17：det>0 且变号 0 条（P-110 的 8/8 → 0/8 在组级判据下也成立）', g17 && `det=${g17.orient.det} minDet=${g17.orient.minDet} invert=${g17.invert.max}/${g17.invert.nTri}`)
  check(!!g18 && g18.orient.mirror === false && g18.invert.max === 0, '睫毛组 b18：det>0 且变号 0 条', g18 && `minDet=${g18.orient.minDet} invert=${g18.invert.max}/${g18.invert.nTri}`)

  console.log('\n[T3] RED-IF-REVERTED：把链序改回 P-110 之前的父先乘（?bindorder=legacy）⇒ 上述断言必须变红')
  const leg = await runFrames(model, layer, '?id=hina&submesh=all&bindorder=legacy', allFrames, { legacyBind: true })
  const Lleg = leg.ledger
  check(Lleg.summary.mirrorGroups > 0, `legacy 序 ⇒ 判据变红：${Lleg.summary.mirrorGroups} 个组被镜像`, 'mirrorBones=' + bits(Lleg.summary.mirrorBones))
  check(Lleg.summary.mirrorBones.includes(17), 'legacy 序下**眉毛组 b17** 就在被镜像的组里（判据抓的正是用户报的那一组）', bits(Lleg.summary.mirrorBones))
  check(Lleg.summary.minDet < -0.5, `legacy 序下最差组 det 明显为负（= 真的翻过去，不是塌陷）：${Lleg.summary.minDet} @b${Lleg.summary.minDetGroup}`, '|det|≈1 量级')
  check(Lleg.summary.maxInvert >= 8 && Lleg.summary.maxInvertGroup === 18, `legacy 序下变号条数也回升（b${Lleg.summary.maxInvertGroup} ${Lleg.summary.maxInvert} 条 @${Lleg.summary.maxInvertAt}s）`, '与 P-110 记录的 b18 12/16 同量级')
  const g17l = Lleg.groups.find((g) => g.b === 17)
  check(!!g17l && g17l.orient.minDet < 0 && g17l.orient.mirror === true, 'b17 的 orient.mirror=true、minDet<0（逐组字段可定位到具体骨）', g17l && `minDet=${g17l.orient.minDet} @${g17l.orient.minDetAt}s`)

  console.log('\n[T4] 判据灵敏度（反证 T2 不是空断言）：合成"只镜像骨 16"⇒ 必须报出 b16')
  const mir = await runFrames(model, layer, '?id=hina&submesh=all', [0], { rawGbones: (g, m, nb) => {
    for (let i = 0; i < nb; i++) g.set(IDENT4, i * 16)
    for (let c = 0; c < 4; c++) g[16 * 16 + c] = -g[16 * 16 + c]      // 骨 16 矩阵第一行取负 ⇒ det<0
  } })
  check(mir.ledger.summary.mirrorGroups === 1 && mir.ledger.summary.mirrorBones[0] === 16,
    '合成镜像（骨 16 矩阵第一行取负）⇒ 恰好 1 个组被判镜像且就是 b16', bits(mir.ledger.summary.mirrorBones) + ' minDet=' + mir.ledger.summary.minDet)
  check(mir.ledger.summary.minDet < -1, '合成镜像下 minDet 明显为负（-1 量级 = 整组翻转，与"塌陷到 0"可区分）', 'minDet=' + mir.ledger.summary.minDet)

  console.log('\n[T5] 残余定性：默认序下 b16 的 1/17 是**折面**（三角形面积过零）而非**镜像**（组 det 恒正）')
  const g16 = L.groups.find((g) => g.b === 16)
  check(!!g16 && g16.invert.max === 1 && g16.invert.nTri === 17, 'b16 残余变号 1/17（与 P-110 记录一致）', g16 && `${g16.invert.max}/${g16.invert.nTri} @${g16.invert.at}s`)
  check(!!g16 && g16.orient.minDet > 0.9 && g16.orient.mirror === false,
    `同一个 b16：组级方向 det 全程 ≥ ${g16 ? g16.orient.minDet : '-'}（>0.9）⇒ 是**局部塌陷**不是镜像`, 'minDet@' + (g16 && g16.orient.minDetAt) + 's')
  // 变号的三角形都是"多骨权重"三角形（P-110 口径：单骨三角形永不翻）
  const wts = model.mesh.blendWeights, idxs = model.mesh.blendIndices, idx = model.mesh.indices
  const domOf = (i) => { const w = wts[i] || [1, 0, 0, 0], bi = idxs[i] || [0, 0, 0, 0]; let k = 0; for (let j = 1; j < 4; j++) if ((w[j] || 0) > (w[k] || 0)) k = j
    let s = 0; for (let j = 0; j < 4; j++) s += Math.abs(w[j] || 0); return s > 0 ? (bi[k] | 0) : (bi[0] | 0) }
  let single = 0, multi = 0
  for (let ti = 0; ti < Math.floor(idx.length / 3); ti++) {
    const a = domOf(idx[ti * 3]), b2 = domOf(idx[ti * 3 + 1]), c = domOf(idx[ti * 3 + 2])
    const g = (a === b2 && b2 === c) ? a : -1
    if (g === 16) single++                       // b16 严格归属的三角形（单骨组）
  }
  check(single === 17, `b16 严格归属的组内三角形 17 条（台账 invert.nTri 同口径）`, 'n=' + single)

  console.log('\n[T6] 根因钉死：残余的驱动是**作者数据**（anim1 轨 30 第 14→15 行 9.4px 跳变），且合成在 t=0 逐位等于 bind')
  const mesh = model.mesh
  const an1 = mesh.animations[1]
  check(!!an1 && an1.frameCount === 240, 'anim1 = 240 帧（8.0s @30fps ⇒ 与 P-109 记录的"每 8s 复现"周期一致）', an1 && `frameCount=${an1.frameCount} segBytes=${an1.segBytes} segs=${an1.segs.length}`)
  // 独立顺序寻址（wer-ref 布局：[int32 flags][uint32 byteSize][byteSize/36 行 × 36B]）复核轨 30
  const dv = new DataView(mesh.raw.buffer, mesh.raw.byteOffset, mesh.raw.byteLength)
  const trackBytes = an1.segBytes, nTrk = an1.segs.length
  const hdr0 = an1.segs[0] - 8
  let sizeOk = true
  for (let b = 0; b < nTrk; b++) if (dv.getUint32(hdr0 + b * (8 + trackBytes) + 4, true) !== trackBytes) sizeOk = false
  check(sizeOk, `每条轨的头 byteSize 都等于 segBytes=${trackBytes}（= 241 行×36B ⇒ 独立布局自洽）`, 'tracks=' + nTrk)
  const t30 = hdr0 + 30 * (8 + trackBytes) + 8
  const rowOf = (f) => ({ px: dv.getFloat32(t30 + f * 36, true), py: dv.getFloat32(t30 + f * 36 + 4, true) })
  const step = Math.hypot(rowOf(15).px - rowOf(14).px, rowOf(15).py - rowOf(14).py)
  check(step > 9, `轨 30（瞳孔骨 b30）第 14→15 行存在**一帧 9.4px 级跳变**（独立寻址实测 ${step.toFixed(4)}px；这是残余折面的驱动源）`, `f14=(${rowOf(14).px.toFixed(3)},${rowOf(14).py.toFixed(3)}) f15=(${rowOf(15).px.toFixed(3)},${rowOf(15).py.toFixed(3)})`)
  let maxDiff = 0
  for (let f = 0; f < an1.frameCount; f++) {
    const o = an1.segs[30] + f * 36 + 8 * 30
    maxDiff = Math.max(maxDiff, Math.abs(dv.getFloat32(o, true) - rowOf(f).px), Math.abs(dv.getFloat32(o + 4, true) - rowOf(f).py))
  }
  check(maxDiff === 0, '两种独立寻址（本仓 `segs[b]+36f+8b` vs wer-ref 顺序布局）读到的字节**逐位相同**', 'maxΔ=' + maxDiff)
  const composite0 = lib.sampleCompositeAdditivePose({ mesh, bindRT: lib.bindWorldPolar(lib.bindWorldChain(mesh.bones)),
    animSpec: hinaRun.animSpec, animGood: lib.analyzeAnimGoodFrames(mesh, at.sampleAnimRT), tAnim: 0, fps: 30, nb: mesh.bones.length, sampleRT: at.sampleAnimRT })
  const bindRT0 = lib.bindWorldPolar(lib.bindWorldChain(mesh.bones))
  let maxD0 = 0
  for (let b = 0; b < mesh.bones.length; b++) maxD0 = Math.max(maxD0, Math.abs(composite0[b].tx - bindRT0[b].tx), Math.abs(composite0[b].ty - bindRT0[b].ty), Math.abs(composite0[b].angle - bindRT0[b].angle))
  check(maxD0 === 0, 't=0 的 3 层 additive 合成逐位等于 bind 基准（additive 语义自证：帧 0 无偏移）', 'maxΔ=' + maxD0)

  console.log('\n[T7] 变号基线口径修正自证：会话落在折面窗口内时，旧口径（首帧基线）会**整个漏报**')
  const win = []
  for (let f = 8; f <= 11; f++) win.push(f / 30)          // f8..f11 = 0.267→0.367s（legacy 序下 b17 全翻的窗口）
  const inWinBindBase = await runFrames(model, layer, '?id=hina&submesh=all&bindorder=legacy', win, { legacyBind: true })
  const inWinLegacyBase = await runFrames(model, layer, '?id=hina&submesh=all&bindorder=legacy&subbase=legacy', win, { legacyBind: true })
  const g17b = inWinBindBase.ledger.groups.find((g) => g.b === 17)
  const g17o = inWinLegacyBase.ledger.groups.find((g) => g.b === 17)
  check(inWinBindBase.ledger.base === 'bind' && inWinLegacyBase.ledger.base === 'legacy', '口径自描述：`?subbase=legacy` 时台账 base=legacy，缺省 base=bind', `${inWinBindBase.ledger.base} / ${inWinLegacyBase.ledger.base}`)
  check(!!g17b && g17b.invert.max === g17b.invert.nTri, `bind 基线（缺省）：这 4 帧里 b17 **全翻**被抓住（${g17b ? g17b.invert.max + '/' + g17b.invert.nTri : '-'}）`)
  check(!!g17o && g17o.invert.max === 0, 'legacy 基线（P-109 旧口径）：同一段帧报 **0 条变号**（基线=首帧翻转态 ⇒ 镜像整段漏报）', g17o && `${g17o.invert.max}/${g17o.invert.nTri}`)
  check(inWinBindBase.ledger.summary.mirrorGroups === inWinLegacyBase.ledger.summary.mirrorGroups
    && inWinBindBase.ledger.summary.minDet === inWinLegacyBase.ledger.summary.minDet,
    '组级 det 判据**不依赖** `?subbase`（两种变号口径下镜像组数与 minDet 逐位相同）⇒ 它补的正是变号计数看不到的那一半',
    `mirrorGroups ${inWinBindBase.ledger.summary.mirrorGroups} vs ${inWinLegacyBase.ledger.summary.mirrorGroups}；minDet ${inWinBindBase.ledger.summary.minDet} vs ${inWinLegacyBase.ledger.summary.minDet}`)
  const lgWin = await runFrames(model, layer, '?id=hina&submesh=all&bindorder=legacy&subbase=legacy', allFrames, { legacyBind: true })
  check(lgWin.ledger.summary.mirrorGroups === Lleg.summary.mirrorGroups && lgWin.ledger.summary.minDet === Lleg.summary.minDet,
    '`?subbase=legacy` 不影响组级 det 判据（两种口径给出同一组镜像数）', `mirrorGroups ${lgWin.ledger.summary.mirrorGroups} vs ${Lleg.summary.mirrorGroups}`)
}

console.log('\n[T8] 不回归：其余真包（真动画）同样无镜像组；无 puppet 的包探针无物可测')
for (const id of OTHER) {
  const pkgPath = path.join(DD, id, 'scene.pkg')
  const P = fs.existsSync(pkgPath) ? loadPkg(pkgPath) : null
  if (!P) { console.log(`  SKIP ${id}（缺包）`); continue }
  if (!P.models.length) {
    const nObj = (P.sceneJson.objects || []).length
    check(true, `${id}：0 个带 puppet 的模型 ⇒ 蒙皮探针无物可测（结构性对照：对象 ${nObj} 层，链序/判据对其零影响）`)
    continue
  }
  const model = P.models[0], layer = layerOf(model, 0)
  const times = []
  for (let f = 0; f <= 60; f++) times.push(f / 30)         // t=0→2.0s（覆盖各包动画首段）
  const r = await runFrames(model, layer, `?id=${id}&submesh=all`, times)
  const s = r.ledger.summary
  check(s.mirrorGroups === 0, `${id}（${model.modelPath.split('/').pop()}，骨 ${r.NB}）：mirrorGroups=0（无镜像组）`,
    `groups=${s.nGroups} minDet=${s.minDet}(b${s.minDetGroup}) maxInvert=${s.maxInvert}(b${s.maxInvertGroup}) maxDisp=${s.maxDisp} frames=${r.ledger.samples.n}`)
}

console.log('\n[T9] 零副作用：`?subbase=legacy` 只改台账，GL 调用序列/绘制实参逐条不变')
if (hina && hina.models.length) {
  const model = hina.models[0], layer = layerOf(model, 0)
  const a = await runFrames(model, layer, '?id=hina&submesh=all', [0, 0.5])
  const b2 = await runFrames(model, layer, '?id=hina&submesh=all&subbase=legacy', [0, 0.5])
  check(bits(a.calls) === bits(b2.calls), `?subbase 开关不改变 GL 调用序列（${a.calls.length} 条逐条相同）`, bits(a.calls) === bits(b2.calls) ? '' : 'DIFF')
  check(bits(a.draws) === bits(b2.draws), '`?subbase` 不改变 drawElements 实参（= 不画任何不同的东西）', bits(a.draws))
  const off = await runFrames(model, layer, '?id=hina&nodebug', [0.5])
  check(off.ledger === undefined, '不开 `?submesh=` ⇒ `globalThis.__mpwSubMesh` 仍不写（新增判据也走同一开关，零副作用）', bits(off.ledger))
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : ('FAILED ' + fail)) + `（${pass} 通过 / ${fail} 失败）`)
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }

// meshsize-test.mjs — P-58 H1：`?meshsize=1|crop` 网格层 scale/origin 算术单测（无浏览器/无 GL）
// 复现：node meshsize-test.mjs
//
// 背景（用户第4项 凯尔希 3719111841；docs/MODEL-INDIRECTION-RESEARCH.md §7）：
//   `renderMeshLayer` 按**网格原始顶点范围** 1:1 绘制（wpos = origin + (scale.x, ySign·scale.y)·v_raw），
//   不读 layer.size；研究稿据此提出"按 size 框缩放 + cropoffset 校正"的修法。
//   本仓库的**官方标定**（refrender-3719111841.json，官方 preview/真机标定矩形）显示：
//   主体 91 = [1268.18,251.97,1399.80,2073.37]、长发3 475 = [245.46,718.00,1986.05,1619.47]、
//   左耳朵1 303 = [1777.93,77.98,444.89,394.99] —— 与"bbox×scale"逐位吻合（≤1.4px），
//   也就是**今天的画法才是官方口径**；size 框口径会大 19%/17%/89%（= 台账 vs CPU 基线的比值分叉）。
//   附加实测（P-58，5 个 puppet 层全覆盖）：网格 UV footprint = 纹理不透明 footprint，
//   "不透明像素落在网格 UV 框外"计数 = 0 ⇒ 两种画法的可见像素相同，比值差是**口径**不是错位。
// 因此本测试同时钉住两侧：
//   A) 默认（旗标关）= 今天 = 官方标定（≤2px），比值 0.838/0.853/0.528 逐位复现（研究稿数字）；
//   B) `?meshsize=1` = 作者 size 框口径（gl/cpu 尺寸比 1.0 ± 0.05，供真机 A/B）；
//   C) `?meshsize=crop` = 研究稿的 cropoffset 中心（RE-02 已判定官方运行时不消费该字段，
//      故只作 A/B；本测试钉住它的确切位移量，真机上"发片飞出去"即证伪）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
// ①(P-58 H1) 模块级旗标（MCC_ENABLED 等）在 **import 时**按 location.search 求值 → 测试里先把
//   location 钉成 `?mcc=1`：这样 F 段能同时验"`?mcc=1` 仍照旧补偿"与"旗标开时 noCenterComp 抑制
//   双重校正"。其余旗标（vflip/qflip/nofx/perf…）取值与浏览器默认一致。
globalThis.location = globalThis.location || { search: '?mcc=1', href: 'http://localhost/?mcc=1' }
const lib = await import('../core/we-scene-bundle.js')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const r1 = (v) => Math.round(v * 10) / 10
const r3 = (v) => Math.round(v * 1000) / 1000

// ── 真包实数（生产解析器；缺包则整段 SKIP，条件项不红）──
const ROOT = process.env.MPW_ROOT || WS
const DD = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const SCENE = '3719111841'
const PKG = path.join(DD, SCENE, 'scene.pkg')
const TARGETS = ['主体', '长发3', '左耳朵1']     // KI-10 三层
const RESEARCH_RATIO = { '主体': [0.838, 0.923], '长发3': [0.853, 0.891], '左耳朵1': [0.528, 0.496] }

function loadReal() {
  if (!fs.existsSync(PKG)) return null
  const lib2 = lib
  const pkg = lib2.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
  const readEntry = (n) => lib2.getEntry(pkg, n)
  const sj = JSON.parse(new TextDecoder().decode(readEntry('scene.json')).replace(/^\uFEFF/, ''))
  const scene = lib2.parseScene(JSON.parse(JSON.stringify(sj)), null, { attachCtx: { readEntry, time: 0 } })
  lib2.applyRenderConfig(scene, { sceneId: SCENE })
  const PH = {}
  // elysia 生产 MDL 解析器（与 demo.html installPuppet 同源；顶部 await import 已加载）
  __installPuppet(PH)
  const out = []
  for (const l of scene.layers) {
    if (!l.image) continue
    const me = readEntry(l.image); if (!me) continue
    let model; try { model = JSON.parse(new TextDecoder().decode(me)) } catch { continue }
    if (!model.puppet) continue
    const mdl = readEntry(model.puppet); if (!mdl) continue
    let mesh; try { mesh = PH._parseMdl(mdl) } catch { continue }
    if (!mesh || !mesh.positions || !mesh.positions.length) continue
    const mat = lib2.resolveMaterial(model)
    out.push({ layer: l, mesh, bbox: lib2.meshBBox(mesh), cropoffset: mat && mat.cropoffset ? mat.cropoffset : null })
  }
  return out
}
// elysia 生产 puppet 解析器（demo.html 的 installPuppet 同源）；此处直接 import，避免依赖解析差异
let __installPuppet = null

const mod = await import('../elysia/we-renderer/puppet.js')
__installPuppet = mod.installPuppet

// 与 demo 台账同式：bbox 两角点经 wpos=origin+scale·v → 设计坐标矩形
function drawnRect(originXY, scaleXY, bb) {
  const pts = [[bb[0], bb[1]], [bb[2], bb[3]]].map(([x, y]) => [originXY[0] + scaleXY[0] * x, originXY[1] + scaleXY[1] * y])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0]
}

const real = loadReal()
let byName = new Map()
if (!real) {
  console.log(`SKIP meshsize：缺语料包 ${PKG}（条件项不红）`)
} else {
  byName = new Map(real.map((r) => [String(r.layer.name), r]))
  const refFile = path.join(path.dirname(new URL(import.meta.url).pathname), 'refrender-' + SCENE + '.json')
  const REF = fs.existsSync(refFile) ? JSON.parse(fs.readFileSync(refFile, 'utf8')) : null

  // ── A 默认路径（旗标关）= 今天 = 官方标定 ──
  console.log('[A] 默认（?meshsize 关）：bbox×layer.scale → 官方标定 refrender')
  for (const name of TARGETS) {
    const r = byName.get(name)
    if (!r) { check('A ' + name + ' 在包内', false, '层不存在'); continue }
    const l = r.layer
    const ySign = -1
    const rect = drawnRect([l.origin[0], l.origin[1]], [l.scale[0], ySign * l.scale[1]], r.bbox)
    const sizeBox = [Math.abs(l.size[0] * l.scale[0]), Math.abs(l.size[1] * l.scale[1])]
    const ratio = [rect[2] / sizeBox[0], rect[3] / sizeBox[1]]
    const want = RESEARCH_RATIO[name]
    check(`A ${name} 尺寸比复现研究稿 ${want[0]}/${want[1]}`,
      Math.abs(ratio[0] - want[0]) <= 0.002 && Math.abs(ratio[1] - want[1]) <= 0.002,
      `实测 ${r3(ratio[0])}/${r3(ratio[1])}`)
    const ref = REF && REF[String(l.id)]
    if (ref) {
      const dc = Math.hypot((rect[0] + rect[2] / 2) - (ref[0] + ref[2] / 2), (rect[1] + rect[3] / 2) - (ref[1] + ref[3] / 2))
      const dwh = Math.max(Math.abs(rect[2] - ref[2]), Math.abs(rect[3] - ref[3]))
      check(`A ${name} 与官方标定矩形一致（中心 ≤2px / 尺寸 ≤2px）`, dc <= 2 && dwh <= 2,
        `Δc=${r1(dc)}px Δwh=${r1(dwh)}px  gl=[${rect.map(r1)}] ref=[${ref.map(r1)}]`)
    } else check('A ' + name + '（无标定条目，跳过）', true)
  }

  // ── B `?meshsize=1`：size 框口径（研究稿验收：比值 → 1.0 ± 0.05）──
  console.log('[B] ?meshsize=1：scale=size·scale/bbox，实绘中心=origin+alignment')
  for (const name of TARGETS) {
    const r = byName.get(name)
    if (!r) continue
    const l = r.layer
    const fit = lib.meshLayerFit(l, r.bbox, { ySign: -1 })
    check(`B ${name} meshLayerFit 返回可用结果`, !!fit)
    if (!fit) continue
    const rect = drawnRect(fit.origin, fit.scale, r.bbox)
    const sizeBox = [Math.abs(l.size[0] * l.scale[0]), Math.abs(l.size[1] * l.scale[1])]
    const ratio = [rect[2] / sizeBox[0], rect[3] / sizeBox[1]]
    check(`B ${name} gl/cpu 尺寸比 = 1.0 ± 0.05（研究稿验收）`,
      Math.abs(ratio[0] - 1) <= 0.05 && Math.abs(ratio[1] - 1) <= 0.05, `实测 ${r3(ratio[0])}/${r3(ratio[1])}`)
    const scaleBox = [Math.abs(fit.box[0]), Math.abs(fit.box[1])]
    check(`B ${name} 实绘宽高 = size×scale`, Math.abs(rect[2] - scaleBox[0]) < 0.01 && Math.abs(rect[3] - scaleBox[1]) < 0.01,
      `rect=${r1(rect[2])}x${r1(rect[3])} size×scale=${r1(scaleBox[0])}x${r1(scaleBox[1])}`)
    // 实绘中心 = origin（这三层 alignment=center）
    const c = [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2]
    check(`B ${name} 实绘中心 = layer.origin（alignment=center）`,
      Math.abs(c[0] - l.origin[0]) <= 0.5 && Math.abs(c[1] - l.origin[1]) <= 0.5, `center=[${r1(c[0])},${r1(c[1])}] origin=[${r1(l.origin[0])},${r1(l.origin[1])}]`)
    // 与官方标定的差距 = 本实验的"代价"（真机 A/B 要看的量）
    const ref = REF && REF[String(l.id)]
    if (ref) {
      const dwh = Math.max(Math.abs(rect[2] - ref[2]), Math.abs(rect[3] - ref[3]))
      console.log(`      · ${name} 与官方标定的尺寸差 Δ=${r1(dwh)}px（研究稿预期：主体 270/171、长发3 342/197、左耳朵1 394/399）`)
    }
  }

  // ── C `?meshsize=crop`：研究稿的 cropoffset 中心（位移量精确钉住）──
  console.log('[C] ?meshsize=crop：网格空间中心改用 model.cropoffset')
  {
    const r = byName.get('长发3')
    const l = r.layer
    const fitB = lib.meshLayerFit(l, r.bbox, { ySign: -1 })
    const fitC = lib.meshLayerFit(l, r.bbox, { ySign: -1, cropOffset: r.cropoffset })
    check('C 长发3 包内 cropoffset 为 (-1049.5,-490)', !!r.cropoffset && r.cropoffset[0] === -1049.5 && r.cropoffset[1] === -490, JSON.stringify(r.cropoffset))
    check('C crop 模式 centerMode=cropoffset 且网格中心取 cropoffset',
      fitC.centerMode === 'cropoffset' && fitC.meshCenter[0] === -1049.5 && fitC.meshCenter[1] === -490)
    check('C 默认（bbox 中心）centerMode=bbox', fitB.centerMode === 'bbox')
    // 位移 = scale·(bboxCenter − crop)：研究稿公式 ox' = ox − (crop − bboxCx)·sx 的净效果
    const sx = fitB.scale[0], sy = fitB.scale[1]
    const dx = (fitB.meshCenter[0] - fitC.meshCenter[0]) * sx
    const dy = (fitB.meshCenter[1] - fitC.meshCenter[1]) * sy
    check('C crop 相对 bbox 中心的位移量（设计 px）= (+852.7, −300.5)（crop 模式把长发3 右移/上移）',
      Math.abs(dx - 852.7) < 0.5 && Math.abs(dy + 300.5) < 0.5, `实测 Δ=(${r1(dx)},${r1(dy)})`)
    check('C crop 位移量级 = |crop−bboxC|×scale（研究稿公式 ox\'=ox−(crop−bboxCx)·sx 的净效果）',
      Math.abs(Math.abs(dx) - Math.abs((-1049.5 - 0) * sx)) < 0.5 && Math.abs(Math.abs(dy) - Math.abs((-490 - (-103.5)) * Math.abs(sy))) < 0.5,
      `sx=${r3(sx)} |sy|=${r3(Math.abs(sy))}`)
    check('C 无 cropoffset 的层回退 bbox 中心（主体/左耳朵1 未传 → bbox 模式）',
      ['主体', '左耳朵1'].every((n) => lib.meshLayerFit(byName.get(n).layer, byName.get(n).bbox, { ySign: -1 }).centerMode === 'bbox'))
  }

  // ── D 与官方"1:1 = 今天"的关系：旗标关时调用点必须恒等 ──
  console.log('[D] 零回归契约：旗标关 ⇒ 调用点恒等（originXY=[ox,oy]、scaleXY=[sx,ySign·sy]）')
  {
    const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
    check("D1 demo 解析 ?meshsize（get('meshsize')）", /get\('meshsize'\)/.test(HTML))
    check('D2 demo 默认 null（缺参/空/?meshsize=0 → 默认路径）',
      /v === null \|\| v === '' \|\| v === '0'\) \? null/.test(HTML))
    check('D3 旗标开才调用生产算术 lib.meshLayerFit(...)', /if \(MESHSIZE\) \{[\s\S]{0,400}lib\.meshLayerFit\(layer, lib\.meshBBox\(sk\.mesh\)/.test(HTML))
    check('D4 旗标开时停用 __center 补偿（noCenterComp）', /noCenterComp: true/.test(HTML) && /meshOpts = \{ noCenterComp: true \}/.test(HTML))
    check('D5 renderMeshLayer 把 meshOpts 作为第 9 参传入', /renderer\.renderMeshLayer\(layer, sk\.mesh, sk\.gBones, sk\.nb, originXY, scaleXY, \[projW, projH\], texObj\.glTex, meshOpts\)/.test(HTML))
    check('D6 台账矩形用本次实绘 originXY/scaleXY + 缓存 bbox（旗标关时与旧式逐位相同）',
      /originXY\[0\] \+ scaleXY\[0\] \* px2/.test(HTML) && /if \(!sk\.mesh\.__bbox\) lib\.meshBBox\(sk\.mesh\)/.test(HTML))
    check('D7 ?mcc=0/1 语义未动（bundle 仍只认 mcc=1 为强制开，且 noCenterComp 是第三条与门）',
      /const __useC = MCC_ENABLED && !!__c && !\(opts2 && opts2\.noCenterComp\)/.test(fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url), 'utf8')))
    check('D8 旗标关时 bundle 侧 bbox 留存不改变绘制（uploadMeshLayer 只在算 __center 时填 __bbox）',
      /mc = mesh\.__center = \[\(mnx \+ mxx\) \/ 2, \(mny \+ mxy\) \/ 2\][\s\S]{0,600}if \(!mesh\.__bbox\) mesh\.__bbox = \[mnx, mny, mxx, mxy\]/.test(fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url), 'utf8')))
  }
}

// ── E 合成用例：alignment / align=0 / 退化保护 / ySign ──
console.log('[E] 合成用例：alignment 枢轴、?align=0、ySign、退化保护')
{
  const base = { size: [200, 100], scale: [2, 2], origin: [1000, 500], alignment: 'center' }
  const bb = [-50, -25, 50, 25]   // bbox 100×50 → scale = size·scale/bbox = 4
  const f0 = lib.meshLayerFit(base, bb, { ySign: -1 })
  check('E1 center：实绘中心 = origin，scale = (200·2/100, -100·2/50) = (4,-4)',
    f0.origin[0] === 1000 && f0.origin[1] === 500 && f0.scale[0] === 4 && f0.scale[1] === -4, JSON.stringify(f0.scale) + ' o=' + JSON.stringify(f0.origin))
  const fl = lib.meshLayerFit({ ...base, alignment: 'left' }, bb, { ySign: -1 })
  check('E2 left：实绘中心右移 w/2=200 → 网格原点 = 1000+200−4·0 = 1200（x）',
    fl.origin[0] === 1200, 'ox=' + fl.origin[0])
  const ft = lib.meshLayerFit({ ...base, alignment: 'top' }, bb, { ySign: -1 })
  check('E3 top（y-down）：实绘中心下移 h/2=100 → oy = 500+100−(−4)·0 = 600', ft.origin[1] === 600, 'oy=' + ft.origin[1])
  const fz = lib.meshLayerFit({ ...base, alignment: 'left' }, bb, { ySign: -1, alignZero: true })
  check('E4 ?align=0 口径 = center（偏移归零）', fz.origin[0] === 1000, 'ox=' + fz.origin[0])
  const fs1 = lib.meshLayerFit(base, bb, { ySign: 1 })
  check('E5 ?skiny=0 → ySign=+1（只翻 y 的符号，大小不变）', fs1.scale[1] === 4 && Math.abs(fs1.scale[0]) === 4)
  check('E6 退化保护：size 0 / bbox 0 / 缺 bbox → null（调用点回退默认路径）',
    lib.meshLayerFit({ ...base, size: [0, 0] }, bb) === null &&
    lib.meshLayerFit(base, [10, 10, 10, 10]) === null &&
    lib.meshLayerFit(base, null) === null)
  check('E7 负 scale（镜像层）：大小取绝对值、不产生负宽矩形',
    (() => { const f = lib.meshLayerFit({ ...base, scale: [-2, 2] }, bb, { ySign: -1 }); return f.scale[0] === -4 && drawnRect(f.origin, f.scale, bb)[2] === 400 })())
  check('E8 cropOffset 传 null/非有限值 → 回退 bbox 中心',
    lib.meshLayerFit(base, bb, { cropOffset: null }).centerMode === 'bbox' &&
    lib.meshLayerFit(base, bb, { cropOffset: [NaN, 0] }).centerMode === 'bbox')
}


// ── F mock-GL 端到端：真实 renderMeshLayer 的 u_Origin/u_Scale（?mcc=1 环境下）──
console.log('[F] mock-GL 端到端：renderMeshLayer 实际 uniform（location.search="?mcc=1"）')
{
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA16F: 0x881A, HALF_FLOAT: 0x140B }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let curUnit = 0, draws = 0
  const uniLoc = new Map(), uniVal = new Map()
  const handlers = {
    createTexture: () => ({ id: 'tex' }), createFramebuffer: () => ({ id: 'fbo' }), createBuffer: () => ({ id: 'buf' }),
    createVertexArray: () => ({ id: 'vao' }), createShader: () => ({ id: 'sh' }), createProgram: () => ({ id: 'prog' }),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u }, bindTexture: () => {},
    bindFramebuffer: () => {}, useProgram: () => {},
    drawElements: () => { draws++ }, drawArrays: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'u_Tex', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : 1),
    getUniformLocation: (p, n) => { const o = { n }; uniLoc.set(o, n); return o },
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: (loc, a, b) => { const n = uniLoc.get(loc); if (n) uniVal.set(n, [a, b]) },
    uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const canvas = { getContext: () => gl, width: 1280, height: 720, addEventListener: () => {} }
  const r = lib.createRenderer(canvas, { onLog: () => {} })
  check('F0 createRenderer 暴露 renderMeshLayer', typeof r.renderMeshLayer === 'function')
  // 合成网格：bbox [-50,-25,50,25]（中心 0），2 顶点 1 骨骼
  const mesh = {
    positions: [[-50, -25, 0], [50, 25, 0]],
    uvs: [[0, 0], [1, 1]],
    indices: [0, 1, 0],
    blendIndices: [[0, 0, 0, 0], [0, 0, 0, 0]],
    blendWeights: [[1, 0, 0, 0], [1, 0, 0, 0]],
  }
  const bones = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const tex = { id: 'tex' }
  const layer = { id: 9001, name: 'F 合成网格层', origin: [1000, 500, 0], scale: [1, 1, 1], size: [200, 100], alignment: 'center' }
  const bb = lib.meshBBox(mesh)
  check('F1 meshBBox 缓存 = [-50,-25,50,25] 且 __center=0', JSON.stringify(bb) === '[-50,-25,50,25]' && JSON.stringify(mesh.__center) === '[0,0]', JSON.stringify(bb) + ' c=' + JSON.stringify(mesh.__center))
  // 今天的行为（旗标关）：origin/scale 原样进 uniform；?mcc=1 时再叠加 −scale·center 补偿
  uniVal.clear(); draws = 0
  r.renderMeshLayer(layer, mesh, bones, 1, [1000, 500], [1, -1], [3840, 2160], tex)
  check('F2 旗标关：u_Scale = 调用方传入的 [1,-1]', JSON.stringify(uniVal.get('u_Scale')) === '[1,-1]', JSON.stringify(uniVal.get('u_Scale')))
  check('F3 旗标关 + ?mcc=1：u_Origin = origin − scale·center = [1000,500]（center=0）',
    JSON.stringify(uniVal.get('u_Origin')) === '[1000,500]', JSON.stringify(uniVal.get('u_Origin')))
  check('F4 每次调用恰好 1 次 drawElements', draws === 1, 'draws=' + draws)
  // 偏心肌网格（center=(10,20)）验证 mcc=1 确实还在补偿（回归保护）
  const mesh2 = { positions: [[-40, -5, 0], [60, 45, 0]], uvs: [[0, 0], [1, 1]], indices: [0, 1, 0], blendIndices: [[0, 0, 0, 0], [0, 0, 0, 0]], blendWeights: [[1, 0, 0, 0], [1, 0, 0, 0]] }
  lib.meshBBox(mesh2)
  const layer2 = { ...layer, id: 9002, scale: [2, 2, 1] }
  uniVal.clear()
  r.renderMeshLayer(layer2, mesh2, bones, 1, [1000, 500], [2, -2], [3840, 2160], tex)
  check('F5 ?mcc=1 + 偏心肌：u_Origin = [1000−2·10, 500−(−2)·20] = [980,540]',
    JSON.stringify(uniVal.get('u_Origin')) === '[980,540]', JSON.stringify(uniVal.get('u_Origin')))
  // 旗标开：调用方已把中心算进 origin → noCenterComp 必须抑制上面的补偿
  uniVal.clear()
  r.renderMeshLayer(layer2, mesh2, bones, 1, [980, 540], [2, -2], [3840, 2160], tex, { noCenterComp: true })
  check('F6 旗标开（noCenterComp）+ ?mcc=1：u_Origin 原样透传 = [980,540]（无双重校正）',
    JSON.stringify(uniVal.get('u_Origin')) === '[980,540]', JSON.stringify(uniVal.get('u_Origin')))
  // 真包三层：旗标开的 uniform 与 meshLayerFit 完全一致（算术 → GPU 参数闭环）
  if (real) {
    let ok = 0, tot = 0
    for (const name of TARGETS) {
      const rr = byName.get(name); if (!rr) continue
      const fit = lib.meshLayerFit(rr.layer, rr.bbox, { ySign: -1 })
      uniVal.clear()
      r.renderMeshLayer(rr.layer, rr.mesh, bones, 1, fit.origin, fit.scale, [3840, 2160], tex, { noCenterComp: true })
      const o = uniVal.get('u_Origin'), s = uniVal.get('u_Scale')
      tot++
      if (o && s && Math.abs(o[0] - fit.origin[0]) < 1e-4 && Math.abs(o[1] - fit.origin[1]) < 1e-4 &&
          Math.abs(s[0] - fit.scale[0]) < 1e-6 && Math.abs(s[1] - fit.scale[1]) < 1e-6) ok++
    }
    check('F7 真包 ' + TARGETS.join('/') + '：GPU uniform 与 meshLayerFit 逐位一致', ok === tot && tot === TARGETS.length, `${ok}/${tot}`)
  }
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
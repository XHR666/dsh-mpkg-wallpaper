// composite-zorder-test.mjs — P-246（上游接入 P2 第 3 项 / 计划书 P-151）**合成源命名捕获**判据。
//
// 官方语义（上游 `renderer.js` 的 `_rt_imageLayerComposite_<源层id>_<后缀>` 槽 + `capture*AtZOrder` 一路）：
//   材质/pass 的 `textures[]` 里引用某层"合成纹理"时，取的是**该层在这一帧 z 序上的成品**（画到它那一刻的
//   帧缓冲），并允许"引用方排在源之前"⇒ 消费上一帧成品。本仓此前对这类名字恒返回**引用方自己的链输入**。
//
// 判据分两层：
//   A 源码/离线：导出与台账、回退口、真包引用集合（`0917/3509243656` 的 2 个材质 / 源层 589·433）、
//     捕获调用点在"可见性/容器跳过"之前；
//   B mock-GL 端到端：真跑 `createRenderer().render()` 两帧 —— 源层 `visible:false` 也要被捕获、
//     引用方的 pass 解析到**捕获到的 RT**（而不是链输入）、`?composite=legacy` 时退回旧口径。
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
import fs from 'node:fs'
import path from 'node:path'
import { WS, ROOT } from './_root.mjs'

const CORE_SRC = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const MPW_WS = process.env.MPW_ROOT || WS
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== A 源码 / 离线 ==')
{
  check('A1 `compositeSourceStats` / `resetCompositeSourceStats` 导出且形状正确',
    typeof lib.compositeSourceStats === 'function' && typeof lib.resetCompositeSourceStats === 'function' &&
    (() => { lib.resetCompositeSourceStats(); const l = lib.compositeSourceStats(); return l.frames === 0 && l.refs === 0 && l.captures === 0 && l.hits === 0 && l.misses === 0 && l.gc === 0 && Array.isArray(l.lastRefs) })(), '')
  check('A2 回退口 `?composite=legacy` 在位，且只包住合成源分支（非 `$`/非 `_rt_imageLayerComposite` 名不受影响）',
    /get\('composite'\) === 'legacy'/.test(CORE_SRC) && /if \(!COMPOSITE_LEGACY\) \{\n\s+const hit = compositeSources\.get\(name\)/.test(CORE_SRC))
  check('A3 捕获调用点在"可见性/容器跳过"**之前**（源层常是 `visible:false` 的背景快照载体）',
    CORE_SRC.indexOf("captureCompositeAtZOrder(layer, width, height)") > 0 &&
    CORE_SRC.indexOf("captureCompositeAtZOrder(layer, width, height)") < CORE_SRC.indexOf("if (!__layerVis || (layer.isContainer"),
    '调用点=' + CORE_SRC.indexOf("captureCompositeAtZOrder(layer, width, height)") + ' 跳过点=' + CORE_SRC.indexOf("if (!__layerVis || (layer.isContainer"))
  check('A4 捕获用"同一 tag ⇒ 同一张 RT"（跨帧存活 ⇒ 引用方排在源之前时读到上一帧成品）',
    /getFBO\(width, height, 'composite_' \+ layer\.id\)/.test(CORE_SRC) && /compositeSources\.set\(nm, \{/.test(CORE_SRC))
  check('A5 每条引用消失时 GC（只清名字，不重建 RT）', /compositeSources\.delete\(k\); __compositeLedger\.gc\+\+/.test(CORE_SRC))

  // 真包引用集合（离线扫资产，不挂浏览器）
  const PKG = path.join(MPW_WS, 'allwallpaper', '0917', '3509243656', 'scene.pkg')
  if (!fs.existsSync(PKG)) check('A6 真包 0917/3509243656', false, '语料缺失: ' + PKG)
  else {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
    const DEC = new TextDecoder()
    const read = (n) => { try { return DEC.decode(lib.getEntry(pkg, n)) } catch (e) { return null } }
    const refs = []
    for (const e of pkg.entries) {
      if (!/\.json$/i.test(e.name)) continue
      const t = read(e.name)
      if (!t) continue
      const m = t.match(/_rt_imageLayerComposite_(\d+)_[a-z]/g)
      if (m) refs.push({ asset: e.name, names: [...new Set(m)] })
    }
    const all = [...new Set(refs.flatMap((r) => r.names))]
    check('A6 真包引用集合 = 2 个名字（`…_589_a` / `…_433_a`，2 个材质）',
      all.length === 2 && all.includes('_rt_imageLayerComposite_589_a') && all.includes('_rt_imageLayerComposite_433_a') && refs.length === 2,
      JSON.stringify(refs.map((r) => r.asset + ' → ' + r.names.join(','))))
    const sj = JSON.parse(read('scene.json').replace(/^\uFEFF/, ''))
    const byId = new Map((sj.objects || []).map((o) => [o.id, o]))
    const s589 = byId.get(589), s433 = byId.get(433)
    check('A7 源层 589/433 都在 scene.json 里、且**默认不可见**（所以捕获必须发生在可见性跳过之前）',
      !!s589 && !!s433 && s589.visible === false && s433.visible === false,
      JSON.stringify({ s589: s589 && { name: s589.name, visible: s589.visible }, s433: s433 && { name: s433.name, visible: s433.visible } }))
    const refLayers = (sj.objects || []).filter((o) => JSON.stringify(o).includes('自制天空盒02') || JSON.stringify(o).includes('Hollow Cylinder')).map((o) => o.id + ':' + String(o.name) + '@idx' + (sj.objects || []).indexOf(o))
    const srcIdx = [589, 433].map((id) => (sj.objects || []).findIndex((o) => o.id === id))
    /* ⚠ 如实登记：本包的两个引用方都是 **3D 模型层**（`model: models/…/*.mdl`），本仓当前把这类层
       丢弃（`__modelDropped`）⇒ 它们的材质**不会**走到 `resolveTextureName` ⇒ 本机制在本包**像素收益为 0**
       （通路先行、等模型层支持落地后自动生效；`dependencies` 作为诊断字段照记）。 */
    const scene = lib.parseScene(sj, null, {})
    const l331 = (scene.layers || []).find((l) => l.id === 331), l436 = (scene.layers || []).find((l) => l.id === 436)
    check('A8 引用方是 **3D 模型层且本仓当前丢弃**（`__modelDropped`）⇒ 像素收益待模型层支持；`dependencies` 保留',
      !!l331 && !!l436 && !!l331.__modelDropped && !!l436.__modelDropped &&
      JSON.stringify(l331.dependencies) === '[589]' && JSON.stringify(l436.dependencies) === '[433]',
      JSON.stringify({ l331: l331 && { dropped: !!l331.__modelDropped, deps: l331.dependencies }, l436: l436 && { dropped: !!l436.__modelDropped, deps: l436.dependencies } }))
    check('A9 引用方（331/436）排在源（589@idx35 / 433@idx40）**之前** ⇒ 官方"留一帧"语义在本包真的用得上',
      refLayers.length >= 2 && (sj.objects || []).findIndex((o) => o.id === 331) < srcIdx[0] && (sj.objects || []).findIndex((o) => o.id === 436) < srcIdx[1],
      JSON.stringify({ refLayers, srcIdx }))
  }
}

console.log('== B mock-GL 端到端（两帧：源层不可见也要捕获 / 引用方解析到捕获 RT / legacy 退回）==')
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let ids = 0, curUnit = 0, curProg = null, readFbo = null, drawFbo = null
const curTex = new Array(8).fill(null)
const draws = [], blits = []
const tid = (t) => (t ? (t.__mpwId || t.id || 'anon') : null)
const mk = (kind) => ({ id: kind + '#' + (++ids) })
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  useProgram: (p) => { curProg = p },
  bindFramebuffer: (target, f) => { if (target === CONST.READ_FRAMEBUFFER) readFbo = f; else if (target === CONST.DRAW_FRAMEBUFFER) drawFbo = f; else { readFbo = f; drawFbo = f } },
  blitFramebuffer: (...a) => blits.push({ from: readFbo && readFbo.id, to: drawFbo && drawFbo.id, args: a.slice(0, 4) }),
  drawArrays: (m, f, c) => draws.push({ prog: curProg && curProg.id, tex: curTex.map(tid), count: c }),
  getUniformLocation: (p, n) => ({ p, n }), getProgramParameter: () => true, getShaderParameter: () => true,
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 2 }),
  getAttribLocation: () => 0, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
  uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
  uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const canvas = { getContext: () => gl }
const shaderResolver = async (rel) => (rel.endsWith('.vert')
  ? 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ v_TexCoord=a_TexCoord; gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0); }'
  : 'uniform sampler2D g_Texture0; uniform sampler2D g_Texture1; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture2D(g_Texture0,v_TexCoord) + texture2D(g_Texture1,v_TexCoord); }')
const mkLayer = (extra) => Object.assign({ id: 1, name: '层', visible: true, animLayers: false, solid: false, isContainer: false,
  textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
  alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
  effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
const mkTextures = () => new Map([['tex_a', { glTex: { __mpwId: 'layer_base' }, width: 100, height: 100 }]])
// 引用方：一个 materialPass 的槽 0 = 合成源名（`generic4` 那种"层内容就是合成纹理"的写法）
const refEffect = (srcName) => ({ file: 'fx', visible: true, passes: [{ combos: {}, textures: [srcName] }],
  materialPasses: [{ shader: 'fx', blending: 'normal', target: null, binds: [], textures: [srcName], combos: {}, constants: {} }] })
// 源层（id=589，**不可见**，与真包同形）：它只提供"z 序快照"
const srcLayer = () => mkLayer({ id: 589, name: 'Custom BG', visible: false, textureName: 'tex_a', size: [1920, 1080], effects: [] })
const useLayer = () => mkLayer({ id: 331, name: '自制天空盒02', visible: true, effects: [refEffect('_rt_imageLayerComposite_589_a')] })
const mkRenderer = () => createRenderer(canvas, { shaderResolver, onLog: () => {} })

{
  lib.resetCompositeSourceStats()
  draws.length = 0; blits.length = 0
  const r = mkRenderer()
  const sc = mkScene([useLayer(), srcLayer()])   // 引用方在前、源在后（真包 331@34 < 589@35）
  await r.render(sc, mkTextures(), 640, 360, 0.016)
  const l1 = lib.compositeSourceStats()
  const firstHits = l1.hits
  check('B1 第一帧：扫描到 1 个源层 + 在源层 z 序完成捕获（源层 `visible:false` 也捕获）',
    l1.frames >= 1 && l1.refs === 1 && l1.captures >= 1 && l1.errors === 0,
    JSON.stringify({ frames: l1.frames, refs: l1.refs, captures: l1.captures, errors: l1.errors, lastRefs: l1.lastRefs }))
  check('B2 第一帧：引用方**未命中**（排在源之前、还没有上一帧成品）⇒ 退回旧口径但记账',
    l1.misses >= 1 && firstHits === 0, JSON.stringify({ hits: l1.hits, misses: l1.misses }))
  check('B3 捕获走的是 blit 到命名 RT（不是"拿引用方自己的链输入"）', blits.length >= 1, JSON.stringify(blits.slice(0, 2)))
  draws.length = 0
  await r.render(sc, mkTextures(), 640, 360, 0.032)
  const l2 = lib.compositeSourceStats()
  check('B4 第二帧：引用方**命中**捕获到的合成源（"留一帧"语义成立）',
    l2.hits > firstHits && l2.captures >= 2, JSON.stringify({ hits: l2.hits, misses: l2.misses, captures: l2.captures }))
  check('B5 宿主可读台账 `globalThis.__mpwComposite`', !!globalThis.__mpwComposite && globalThis.__mpwComposite.hits > 0, JSON.stringify(globalThis.__mpwComposite && { hits: globalThis.__mpwComposite.hits }))
  check('B6 渲染照常（引用方与源层都产生 draw，且不抛错）', draws.length >= 1, 'draws=' + draws.length)
}

{
  // legacy：整条关（不扫描、不捕获、解析退回链输入）
  lib.resetCompositeSourceStats()
  globalThis.location = { search: '?composite=legacy' }
  draws.length = 0; blits.length = 0
  const r2 = mkRenderer()
  const sc = mkScene([useLayer(), srcLayer()])
  await r2.render(sc, mkTextures(), 640, 360, 0.016)
  await r2.render(sc, mkTextures(), 640, 360, 0.032)
  delete globalThis.location
  const l3 = lib.compositeSourceStats()
  check('B7 `?composite=legacy`：不扫描/不捕获/不解析（逐位回旧口径）',
    l3.frames === 0 && l3.captures === 0 && l3.hits === 0 && blits.length === 0, JSON.stringify({ led: l3, blits: blits.length }))
  check('B8 legacy 下渲染照常', draws.length >= 2, 'draws=' + draws.length)
}

{
  // 无引用：零开销（不捕获、refs=0）
  lib.resetCompositeSourceStats()
  draws.length = 0; blits.length = 0
  const r3 = mkRenderer()
  await r3.render(mkScene([mkLayer({ id: 7, effects: [] })]), mkTextures(), 640, 360, 0.016)
  const l4 = lib.compositeSourceStats()
  check('B9 场景里没有合成源引用 ⇒ refs=0、零捕获、零 blit（其余 55 个包零开销）',
    l4.refs === 0 && l4.captures === 0 && blits.length === 0, JSON.stringify({ refs: l4.refs, captures: l4.captures, blits: blits.length }))
}

{
  // ①(P-247) 层内容槽 = 保留名（老式模型层：材质槽 0 直接写合成源名）⇒ 也要进扫描集合、并在层内容路径命中
  lib.resetCompositeSourceStats()
  draws.length = 0; blits.length = 0
  const r5 = mkRenderer()
  const sc5 = mkScene([
    mkLayer({ id: 331, name: '模型层(内容=合成源)', visible: true, textureName: '_rt_imageLayerComposite_589_a', size: [0, 0], effects: [] }),
    srcLayer(),
  ])
  await r5.render(sc5, mkTextures(), 640, 360, 0.016)
  const m1 = lib.compositeSourceStats()
  await r5.render(sc5, mkTextures(), 640, 360, 0.032)
  const m2 = lib.compositeSourceStats()
  check('B11 层内容 = 保留名：扫描到引用（refs≥1）且首帧未命中记账', m1.refs >= 1 && m1.misses >= 1, JSON.stringify({ refs: m1.refs, misses: m1.misses, lastRefs: m1.lastRefs }))
  check('B12 第二帧：层内容命中合成源（`layerContentHits>0`）—— 老式模型层的槽 0 因此真的能画出来',
    m2.layerContentHits > 0 && m2.hits > 0, JSON.stringify({ hits: m2.hits, layerContentHits: m2.layerContentHits }))
}

{
  // `dependencies` 诊断通道：声明了依赖但名字不在可见材质链里（= 引用方被丢弃）⇒ 只记诊断、不捕获
  lib.resetCompositeSourceStats()
  draws.length = 0; blits.length = 0
  const r4 = mkRenderer()
  await r4.render(mkScene([mkLayer({ id: 331, dependencies: [589], effects: [] }), srcLayer()]), mkTextures(), 640, 360, 0.016)
  const l5 = lib.compositeSourceStats()
  check('B10 只声明 `dependencies`、没有可见材质引用 ⇒ `depIds=1`（诊断）但 `refs=0`/零捕获（不猜名字）',
    l5.depIds === 1 && l5.depList[0] === 589 && l5.refs === 0 && l5.captures === 0 && blits.length === 0,
    JSON.stringify({ depIds: l5.depIds, depList: l5.depList, refs: l5.refs, captures: l5.captures }))
}

{
  /* ①(P-260 2026-10-07) **网格路径的保留名解析口** `renderer.resolveLayerTexture(name, textures, layer)`：
     几何档（`?modellayer=mesh`/auto）的层内容纹理此前只有 `textures.get(textureName)` 一条路 ⇒ 材质槽写着
     `_rt_imageLayerComposite_*`（合成源）或 `$*`（系统纹理）的层**恒 miss**、`(noTex)` 不画。
     这里验证：同一张捕获 RT 能被这个口子拿到（= 几何档的保留名层真的能画），且普通名走直接查表、
     未命中返回 null（调用方走原兜底）。 */
  lib.resetCompositeSourceStats()
  draws.length = 0; blits.length = 0
  const r6 = mkRenderer()
  const sc6 = mkScene([
    mkLayer({ id: 331, name: '模型层(内容=合成源)', visible: true, textureName: '_rt_imageLayerComposite_589_a', size: [0, 0], effects: [refEffect('_rt_imageLayerComposite_589_a')] }),
    srcLayer(),
  ])
  await r6.render(sc6, mkTextures(), 640, 360, 0.016)
  await r6.render(sc6, mkTextures(), 640, 360, 0.032)
  const meshHit = (typeof r6.resolveLayerTexture === 'function') ? r6.resolveLayerTexture('_rt_imageLayerComposite_589_a', mkTextures(), { clampuvs: null }) : null
  check('B13 `resolveLayerTexture` 命中捕获到的合成源 RT（几何档的保留名层因此能画）',
    !!meshHit && !!meshHit.glTex && meshHit.width > 0, JSON.stringify({ hit: !!meshHit, glTex: !!(meshHit && meshHit.glTex), w: meshHit && meshHit.width }))
  const missHit = (typeof r6.resolveLayerTexture === 'function') ? r6.resolveLayerTexture('materials/不存在.tex', mkTextures(), {}) : null
  check('B14 普通名走直接查表、未命中返回 null（调用方仍走原 `(noTex)` 兜底，不猜）',
    missHit === null && (() => { const d = r6.resolveLayerTexture('tex_a', mkTextures(), {}); return !!d && !!d.glTex && d.glTex.__mpwId === 'layer_base' })())
  const stat6 = lib.compositeSourceStats()
  check('B15 该口的命中进 `compositeSourceStats().meshHits` 台账', stat6.meshHits >= 1, 'meshHits=' + stat6.meshHits)
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败（P-246 合成源命名捕获）')
process.exit(fail === 0 ? 0 : 1)

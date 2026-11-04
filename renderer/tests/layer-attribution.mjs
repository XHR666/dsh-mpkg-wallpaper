// layer-attribution.mjs —— C0 测量基建①：**离线层归因**（对任一 pkg / 裸 scene.json 输出每层
// `{vis, texture, passes, chainInput, blend, rect(设计/实绘), skipReason}`）
//
// 为什么要有它（批次 3 任务书 C0）：`?ln=N` 逐层隔离会把其它层标 `__lnHidden`（demo.html），
//   单层画面会走进别的兜底分支（charfit 单层居中 / copybg 链输入=背景拷贝…）⇒ "单层=清屏色"是
//   **线索不是定论**。后面每件修复都需要"某层为什么没出像素"的**可复核**读数 —— 本工具用
//   **真 parseScene + mock GL + 真 renderScene**（同 tests/package-matrix.mjs / scene-zoom-test.mjs
//   口径，不起浏览器、不加载 GL）在**整帧**（无 `__lnHidden`）下产出每层台账：
//     · 实绘矩形 = `opts.onLayerDraw`（core/we-scene-bundle.js）的 mvp×单位 quad 角点 → 屏幕像素，
//       y 向定符照抄 demo.html 的 `mpwLedgerYDown`（origin 锚自动判翻转）—— 与真机 `__mpwLayerLedger`
//       **同一套数学**，两边读数可以直接对（C0② 的一致性量法）。
//     · 只记"最终上屏"那趟：mock GL 跟踪 FRAMEBUFFER_BINDING（scene-zoom-test 同款），绑着 FBO 的
//       onLayerDraw 事件（效果链拷贝趟）不作为上屏矩形；没有 null-FBO 事件时如实记 `rectDrawn:null`。
//
// **schema（固定；新增字段必须在这里登记）**——每层一行：
//   { idx, id, name, type,            // type ∈ image|video|particle|text|sound|light|solid|none（parse 侧口径）
//     vis,                            // parseScene 后的静态 visible（已含 applyRenderConfig 的 UI 隐藏）
//     texture, textureHit,            // 内容纹理名（材质 pass0.textures[0]）+ 包内命中（解码成功才算命中）
//     passes, fxFiles,                // 效果 pass 总数 / 效果文件名（去重）
//     copybg, chainInput,             // layer.copybackground + 链输入语义 ∈ own|rt|none
//                                     //   own=有自有内容走自有贴图（P-199）；rt=无自有内容**且有效果链** ⇒
//                                     //   背景拷贝（P-230：fx=0 的 copybg 层不换入，画自己的纯色/内容，
//                                     //     此时 bind=solidcolor/white 而不是 rtcopy）；none=无效果链。
//                                     //   `?copybginput=legacy` 时 fx=0 也换（bind 变 rtcopy）。
//     blend,                          // layer.colorBlendMode（RE-18 官方层混合模式）
//     animGeom (可选),                // origin/scale 有关键帧 ⇒ 矩形随时间变（一致性对账容相位差）
//     rectDesign {x,y,w,h},           // 设计坐标 = origin±size/2（alignment=center 口径；父子合并后的 world.origin）
//     rectDrawn {x0,y0,x1,y1}|null,   // 实绘矩形（画布像素、y-down 顶左原点）；没上屏 = null
//     bind,                           // 上屏时的输入纹理 ∈ texture|white|transparent|solidcolor|particle|mesh
//     skipReason }                    // **没上屏才有**，固定枚举（见下）
// skipReason 枚举（固定，新增需登记）：
//   invisible           — 作者原文 visible=false（parseScene 后即为 false）
//   invisible-config    — applyRenderConfig 把 visible 关掉（UI 名单正则/类别开关/音频美术豁免/组合互斥…
//                         bundle 不留标记，本工具以 parse 后 vs 配置后的 visible 差分归因，不复制任何正则）
//   invisible-anim      — 可见性关键帧在采样时刻 ≤0.5（P1-9 官方阶跃语义）
//   container           — isContainer（composelayer 无条件 / 真容器）—— C3 的对象，本工具只如实记
//   particle-no-def     — 声明了 particle 但 def 未解析（core 渲染循环的 `particle && !particleDef` continue）
//   particle-tex-missing — 粒子层贴图未装载 ⇒ P-59 跳过（`[粒子] 跳过无贴图层` 日志）
//   particle-budget     — 粒子层超预算跳过（`[粒子预算] … 超预算跳过` 日志）
//   logical-helper      — 无效果链的 projectlayer/fullscreenlayer = 逻辑 framebuffer helper（P-231，
//                         wer-ref RegisterLogicalImageLayer / "skip no effect fullscreen layer" ⇒ 不画）
//   particle-idle       — 粒子层在采样时刻存活 0（CPU 模拟复核；未到发射窗/已消亡）
//   degenerate-geometry — size×scale ≤0 且无内容（非 solid、无纹理）⇒ renderLayer 静默早退
//                         （sound 层 `scale=0 0 0` = 官方"只出声不出画"；compositeLayer drawGuard 同判据）
//   draw-failed         — renderLayer 抛异常（单层失败不拖垮整帧）
//   not-drawn           — 兜底：走了上列之外的未上屏路径 ⇒ **必须**查清后新增枚举值并登记，禁止堆积
//
// 用法：
//   node tests/layer-attribution.mjs --pkg  <abs scene.pkg> [--json <out>] [--time <s>] [--summary]
//   node tests/layer-attribution.mjs --scene <abs scene.json> [--json <out>] [--time <s>]
//   node tests/layer-attribution.mjs --selftest            # 门禁入口：桩件断言（schema/枚举/矩形）+ 变异自证
// 读数落盘：`reports/layer-attribution-<pkgid>.json`（--json 可改路径）。门禁走 --selftest 的合成桩件
//   （模板 = solidlayer-fallback-test.mjs，**不加载真包**）；真包用 --pkg 由人/探针自查。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const has = (k) => argv.includes(k)

const dec = new TextDecoder()
/* bundle 从 REPO 动态导入（不是 `../core/...` 静态导入）：--selftest 的变异段把 core/ 复制到 /tmp
   改坏后以独立模块再导入，主库零污染（solidlayer-fallback / scene-zoom 同款）。 */
const REPO = process.env.MPW_REPO_ROOT || ROOT
const lib = await import(pathToFileURL(path.join(REPO, 'core', 'we-scene-bundle.js')).href)
// WE 资产兜底：显式 MPW_ROOT > 工作区根推导（_root.mjs 的 WS 口径；不写死本机绝对路径——
//   publish-check/secret-scan/cross-platform 三条门禁都会抓）
const WE_ASSETS = process.env.MPW_ROOT ? path.join(process.env.MPW_ROOT, 'wallpaper_engine', 'assets')
  : path.join(WS, 'wallpaper_engine', 'assets')

/* ── mock GL（口径 = scene-zoom-test.mjs 的 makeMockGL + solidlayer-fallback-test.mjs 的 1×1 打标）────── */
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function makeMockGL(getLayer) {
  let ids = 0, curUnit = 0, curProg = null, curFbo = null
  const curTex = new Array(8).fill(null)
  const progUni = new Map()
  const draws = []
  const mk = (k) => ({ id: k + '#' + (++ids) })
  const setUni = (l, v) => { if (l && l.p && l.n) { if (!progUni.has(l.p.id)) progUni.set(l.p.id, {}); progUni.get(l.p.id)[l.n] = v } }
  const snap = () => ({ __layer: getLayer(), tex0: curTex[0], fbo: curFbo })
  const gl = {
    __draws: draws,
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u - CONST.TEXTURE0 },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: (t, f) => { curFbo = f || null }, useProgram: (p) => { curProg = p }, bindBuffer: () => {},
    texImage2D: (target, level, ifmt, w, h, b, fmt, type, data) => {
      const tex = curTex[curUnit]
      if (!tex || w !== 1 || h !== 1 || !data || data.length < 4) return
      let all = data[0]; for (let i = 1; i < 4; i++) if (data[i] !== all) { all = -1; break }
      if (all === 255) tex.__solid = 'white'
      else if (all === 0) tex.__solid = 'transparent'
    },
    drawArrays: () => draws.push(snap()), drawElements: () => draws.push(snap()),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'u_Tex', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v),
    uniform2f: (l, a, b) => setUni(l, [a, b]), uniform3f: (l, a, b, c) => setUni(l, [a, b, c]),
    uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]), uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  return new Proxy(gl, { get(t, prop) {
    if (prop in t) return t[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D u_Tex; uniform vec4 u_Color4; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(u_Tex, v_TexCoord) * u_Color4; }'
const shaderResolver = async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG)

/* y 向定符：照抄 demo.html `mpwLedgerYDown`（origin 锚自动判翻转；两种矩阵约定都自洽，不靠猜）。
   入参 yA/yB 是 GL 窗口 y（底左原点），oyPx = 层 origin 的画布 y（设计 y-down 换算）。 */
export function ledgerYDown(yA, yB, H, oyPx) {
  const h = (Number(H) > 0) ? Number(H) : 1080
  const a = Number(yA), b = Number(yB)
  const lo = Math.min(a, b), hi = Math.max(a, b)
  const flipped = (() => {
    if (oyPx === null || oyPx === undefined || !isFinite(Number(oyPx))) return true
    const c = (lo + hi) / 2
    return Math.abs((h - c) - Number(oyPx)) < Math.abs(c - Number(oyPx))
  })()
  const conv = (v) => (flipped ? (h - v) : v)
  return { y0: Math.round(Math.min(conv(lo), conv(hi))), y1: Math.round(Math.max(conv(lo), conv(hi))), flipped }
}

/* ── 核心：对一个 sceneObj 做整帧归因 ───────────────────────────────────────────────
 * deps = { readEntry(n)→Uint8Array|null, readParticleDef(p)→obj|null, propsMap, id, pkg }
 * opts = { time, lib }  返回 { layers, summary, logs }。任何包/桩件通用；不写死任何包名/层名/尺寸。 */
export async function attributeScene(sceneObj, deps = {}, opts = {}) {
  const L = opts.lib || lib
  const time = opts.time !== undefined ? Number(opts.time) : 1.0
  const logs = []
  const readEntry = deps.readEntry || (() => null)
  const readParticleDef = deps.readParticleDef || (() => null)

  const scene = L.parseScene(JSON.parse(JSON.stringify(sceneObj)), null, { attachCtx: { readEntry: (n) => readEntry(n), time: 0 }, readParticleDef })
  const preVis = scene.layers.map((l) => !!l.visible) // parse 后（作者原文）的可见性
  // render config：与 package-matrix 同款（hideUI 与真机 demo 的默认一致；粒子保留）
  L.applyRenderConfig(scene, { sceneId: deps.id || 'scene', properties: deps.propsMap || null, propertiesSchema: deps.propertiesSchema || null, refrender: null,
    anchor: 'refcenter', hideUI: true, hideParticles: false, clearBgFx: true, log: (m) => logs.push(String(m)) })
  // 用户属性应用（与 demo applyAll 同一条链：gated 门控 + {user:{condition}} 组合互斥）。
  //   缺这步时互斥组的层只有真机可见（C0② P1 对账抓到：Clock/在播放）。propsMap 为空（无 schema 桩件）时跳过。
  if (deps.propsMap && deps.propertiesSchema && L.applyUserProperties) {
    try {
      const gated = L.gatedOffNames ? L.gatedOffNames(deps.propertiesSchema, deps.propsMap) : new Set()
      L.applyUserProperties(scene, deps.propsMap, { schema: deps.propertiesSchema, gated })
    } catch (e2) { logs.push('[layer-attribution] applyUserProperties: ' + e2.message) }
  }

  const layers = scene.layers
  const op = scene.general && scene.general.orthogonalprojection
  const projW = (op && op.width) || 3840, projH = (op && op.height) || 2160
  // 画布：与 package-matrix 同口径（设计尺寸钳到 1920×1080 内），onLayerDraw 的 width/height 即这个画布
  const W = Math.min(1920, projW), H = Math.min(1080, projH)
  // raw objects 按 id 对齐（scene.layers 与 objects 不保证同长；id 是 parseScene 保留的对象 id）
  const objById = new Map(((sceneObj && sceneObj.objects) || []).map((o) => [o.id, o]))

  // 纹理装载（package-matrix 同款）：image→model→material→passes[0].textures[0] → textureName
  const texMap = new Map()
  const ensureTex = (tn) => {
    if (texMap.has(tn)) return
    let rec = null
    const e = readEntry('materials/' + tn + '.tex') || readEntry('materials/' + tn) || readEntry(tn + '.tex') || readEntry(tn)
    if (e) { try { const tex = L.parseTex(e); const m0 = L.decodeMip0(tex); rec = { glTex: L.makeTexture(gl, m0.rgba || new Uint8Array([128, 128, 128, 255]), m0.width || 8, m0.height || 8), width: m0.width || 8, height: m0.height || 8 } } catch (e2) { rec = null } }
    if (!rec) { try { const fp = path.join(WE_ASSETS, 'materials', tn + '.tex'); if (fp.startsWith(WE_ASSETS) && fs.existsSync(fp)) { const tex = L.parseTex(new Uint8Array(fs.readFileSync(fp))); const m0 = L.decodeMip0(tex); rec = { glTex: L.makeTexture(gl, m0.rgba || new Uint8Array([128, 128, 128, 255]), m0.width || 8, m0.height || 8), width: m0.width || 8, height: m0.height || 8 } } } catch (e2) { rec = null } }
    texMap.set(tn, rec) // null = 引用了但拿不到（如实记 textureHit=false）
  }
  const gl = makeMockGL(() => curLayerIdx) // 先建（ensureTex 的 makeTexture 要用）
  let curLayerIdx = -1
  for (const l of layers) {
    try {
      if (typeof l.image === 'string' && !l.isContainer) {
        const bi = L.resolveBuiltin(l.image)
        let mj = bi && bi.kind === 'model' ? bi.value : null
        if (!mj) { const me = readEntry(l.image); if (me) mj = JSON.parse(dec.decode(me)) }
        if (!mj) continue
        if (mj.solidlayer) l.solid = true
        const mat = L.resolveMaterial(mj)
        let material = null
        if (mat && mat.materialPath) {
          const bm = L.resolveBuiltin(mat.materialPath)
          material = bm && bm.kind === 'material' ? bm.value : null
          if (!material) { const mate = readEntry(mat.materialPath); if (mate) material = JSON.parse(dec.decode(mate)) }
        }
        if (!material) continue
        const pass0 = (material.passes || [])[0]
        const tn = pass0 && pass0.textures && pass0.textures[0]
        if (typeof tn === 'string' && tn && !tn.startsWith('_rt_')) { l.textureName = tn; ensureTex(tn) }
      }
      for (const ef of (l.effects || [])) {
        try { if (deps.pkg) L.resolveEffectChain(deps.pkg, ef, (b) => dec.decode(b)) } catch (e2) { /* 链解析失败如实记，不影响归因 */ }
      }
      if (l.particleDef && l.particleDef.material) {
        try { const mate = readEntry(l.particleDef.material); const material = mate ? JSON.parse(dec.decode(mate)) : null
          const tn = material && material.passes && material.passes[0] && material.passes[0].textures[0]
          if (typeof tn === 'string' && tn) { l.particleTexName = tn; ensureTex(tn) }
        } catch (e2) {}
      }
    } catch (e2) { /* 单层装载失败不影响其余层 */ }
  }
  texMap.set('util/white', { glTex: { __solid: 'white' }, width: 1, height: 1 })
  texMap.set('util/noflow', { glTex: {}, width: 1, height: 1 })
  texMap.set('util/noise', { glTex: {}, width: 256, height: 256 })
  for (const tn of ['util/gradient', 'base_white']) texMap.set(tn, { glTex: {}, width: 8, height: 8 })

  // 蒙皮层：标 ready（与 package-matrix 同款；onMeshLayer 只记账不真绘）
  const skinLayers = layers.filter((l) => l.__skin)
  for (const l of skinLayers) { try { l.__skinReady = true } catch (e2) {} }

  // 渲染 + 台账
  const drawEvents = new Map() // idx → [{x0,y0,x1,y1,fboScreen,isWhite,isTransparent}]
  const meshDrawn = new Map()
  const layerErrors = new Map()
  let renderer = null
  renderer = L.createRenderer({ getContext: () => gl, width: W, height: H }, {
    onLog: (m) => {
      logs.push(String(m))
      const m1 = /^\[首帧\] #(\d+) /.exec(String(m))
      if (m1) curLayerIdx = Number(m1[1])
      else if (String(m).includes('层循环结束')) curLayerIdx = -2
      const me = /跳过渲染失败的层 "(.+)"/.exec(String(m))
      if (me) { const li = layers.findIndex((x) => String(x.name || x.id) === me[1]); if (li >= 0) layerErrors.set(li, String(m)) }
    },
    onLayerDraw: (layer, info) => {
      const idx = layers.indexOf(layer)
      if (idx < 0) return
      // 只认"最终上屏"那趟（默认帧缓冲）；与 demo.html 同判据
      let fboScreen = true
      try { fboScreen = gl.getParameter(gl.FRAMEBUFFER_BINDING) === null } catch (e2) {}
      const m = info.mvp
      const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
      const scr = (v, n) => (v * 0.5 + 0.5) * n
      const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
      const x0 = Math.round(scr(Math.min(A[0], B[0]), info.width)), x1 = Math.round(scr(Math.max(A[0], B[0]), info.width))
      const yA = scr(Math.min(A[1], B[1]), info.height), yB = scr(Math.max(A[1], B[1]), info.height)
      const oyPx = (() => { try { const ph = (op && op.height) || info.height; return (layer.origin && isFinite(Number(layer.origin[1]))) ? Number(layer.origin[1]) / ph * info.height : null } catch (e2) { return null } })()
      const yy = ledgerYDown(yA, yB, info.height, oyPx)
      if (!drawEvents.has(idx)) drawEvents.set(idx, [])
      drawEvents.get(idx).push({ x0, y0: yy.y0, x1, y1: yy.y1, fboScreen, isWhite: !!info.isWhite, isTransparent: !!info.isTransparent })
    },
    onMeshLayer: (layer) => {
      const idx = layers.indexOf(layer)
      if (idx >= 0) meshDrawn.set(idx, true)
    },
    shaderResolver, trace: false, auditFrames: 1, copyBackground: false, hideParticles: false, align: true,
    // ①(C0 对齐 2026-10-04) demo 缺省**关视差**（`?parallax=` 不带时 parallaxOff=true，"先把视差关掉，
    //   不然有些壁纸不好测试"）—— 离线归因必须与生产同态，否则带 parallaxDepth 的层两边矩形差一个
    //   视差位移（真包 0923/2887099508 的 16 条 y 向失配就是它：cameraparallax=true）。
    parallaxOff: true,
    campose: opts.campose || 'legacy',
  })
  try { globalThis.__mpwPointer = { x: projW / 2, y: projH / 2, inside: true } } catch (e2) {}
  let renderErr = null
  try { await renderer.render(scene, texMap, W, H, time) } catch (e2) { renderErr = String(e2.message) }
  try { delete globalThis.__mpwPointer } catch (e2) {}
  // GL draw 计数（按 [首帧] #N 日志归层）：粒子/网格等**不走 compositeLayer**（无 onLayerDraw 事件）
  // 的层用它兜底判定"画了没有"。
  const glDrawCount = new Map()
  for (const d of gl.__draws) { const li = d.__layer; if (li != null && li >= 0) glDrawCount.set(li, (glDrawCount.get(li) || 0) + 1) }
  // 粒子层"存活 0"检测（渲染后 CPU 模拟一发，口径 = package-matrix：指针=画布中心、模拟到 time）
  const particleIdle = new Map()
  if (L.buildParticleSystem && L.simulateParticleSystem) {
    for (let i2 = 0; i2 < layers.length; i2++) {
      const l2 = layers[i2]
      if (!l2.particleDef || glDrawCount.get(i2)) continue
      try {
        const sys = L.buildParticleSystem(l2.particleDef, { seedStr: 'attr:' + (l2.name || l2.id) })
        try { sys.pointer = [projW / 2, projH / 2] } catch (e3) {}
        L.simulateParticleSystem(sys, time)
        if (!sys.particles.length) particleIdle.set(i2, true)
      } catch (e3) { /* 模拟失败如实留给 not-drawn */ }
    }
  }
  // 粒子层的 P-59 跳过记账（日志→枚举）
  const particleSkip = new Map()
  for (const m of logs) {
    let mm = /\[粒子\] 跳过无贴图层 "(.+?)"/.exec(m)
    if (mm) { const li = layers.findIndex((x) => String(x.name || x.id) === mm[1]); if (li >= 0 && !particleSkip.has(li)) particleSkip.set(li, 'particle-tex-missing') }
    mm = /\[粒子预算\] 层 "(.+?)" 超预算跳过/.exec(m)
    if (mm) { const li = layers.findIndex((x) => String(x.name || x.id) === mm[1]); if (li >= 0 && !particleSkip.has(li)) particleSkip.set(li, 'particle-budget') }
  }

  // 逐层归因
  const rows = []
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]
    const o = objById.get(l.id)
    const type = l.particleDef ? 'particle'
      : (l.__text ? 'text'
        : ((o && o.sound != null) ? 'sound'
          : ((o && o.light != null) ? 'light'
            : (l.solid ? 'solid'
              : (typeof l.image === 'string' && /\.(mp4|webm)$/i.test(l.image)) ? 'video'
                : (typeof l.image === 'string' && !l.isContainer) ? 'image' : 'none'))))
    // 可见性关键帧（P1-9）：time 处 ≤0.5 = 帧内不可见
    let visAnim = null
    if (l.anim && l.anim.visible) {
      try {
        const ch = l.anim.visible.get ? l.anim.visible.get('c0') : l.anim.visible
        const vv = L.animValueAt(ch, time)
        if (vv !== null && vv !== undefined) visAnim = vv > 0.5
      } catch (e2) { /* 关键帧异常 → 静态值兜底 */ }
    }
    const fxFiles = [...new Set((l.effects || []).map((e2) => String(e2.file || '')))].filter(Boolean)
    const passCount = (l.effects || []).reduce((a, e2) => a + ((e2.passes || []).length), 0)
    const texKey = l.textureName || l.particleTexName || null
    const hasOwnTex = !!(texKey && (texKey.startsWith('util/') || texMap.get(texKey)))
    const chainInput = !passCount ? 'none' : (hasOwnTex ? 'own' : 'rt')
    // 设计矩形（origin±size/2；父子合并后的 world.origin；size 0/缺 = 未定 → null）
    const rectDesign = (l.origin && l.size && Number.isFinite(l.origin[0]) && Number.isFinite(Number(l.size[0])) && Number(l.size[0]) > 0)
      ? { x: Math.round(l.origin[0] - l.size[0] / 2), y: Math.round(l.origin[1] - l.size[1] / 2), w: Math.round(l.size[0]), h: Math.round(l.size[1]) } : null
    // 实绘矩形：优先"默认帧缓冲"事件；一个都没有 ⇒ null（没上屏）
    const evs = drawEvents.get(i) || []
    const ev = evs.find((e2) => e2.fboScreen) || null
    const isMesh = meshDrawn.has(i)
    const nGlDraws = glDrawCount.get(i) || 0
    let bind = null, skipReason = null
    if (isMesh) bind = 'mesh'
    else if (ev) bind = ev.isTransparent ? 'transparent' : (ev.isWhite ? (l.solid ? 'solidcolor' : 'white') : (l.particleDef ? 'particle' : (l.copybackground && !hasOwnTex ? 'rtcopy' : 'texture')))
    else if (nGlDraws > 0) bind = l.particleDef ? 'particle' : 'gl-draw-nocallback' // 粒子/网格外的无回调绘制=盲区，登记用
    if (!bind) {
      if (!l.visible) skipReason = preVis[i] ? 'invisible-config' : 'invisible'
      else if (visAnim === false) skipReason = 'invisible-anim'
      else if (l.isContainer) skipReason = 'container'
      else if (l.particle && !l.particleDef) skipReason = 'particle-no-def'
      else if (typeof l.image === 'string' && !passCount &&
               (l.image.indexOf('models/util/projectlayer') === 0 || l.image.indexOf('models/util/fullscreenlayer') === 0)) skipReason = 'logical-helper'
      else if (particleSkip.has(i)) skipReason = particleSkip.get(i)
      else if (l.particleDef && particleIdle.has(i)) skipReason = 'particle-idle'
      // 退化几何（2026-10-04 B1 对齐 drawGuard 口径）：core 的静默跳过有两道——renderLayer 早退
      //   （lw0≤0）与 compositeLayer drawGuard（实绘 ≤0.5 设计px，P-21"退化层不发绘制"）。
      //   实测语料 0917/3509243656 的 text/image/solid 层 scale=0.001 族（size×scale=0.18）被
      //   drawGuard 拦截 ⇒ 此前只判 ≤0 时这批漏进 not-drawn。判据 = 实绘尺寸 ≤0.5（与 drawGuard
      //   同数）且非 solid（solid 的 size=0 在 parse 侧已整屏回退）、无纹理、非粒子。
      else if (l.size && l.scale && (!(Math.abs(l.size[0] * l.scale[0]) > 0.5) || !(Math.abs(l.size[1] * l.scale[1]) > 0.5)) && !l.solid && !texKey) skipReason = 'degenerate-geometry'
      else if (layerErrors.has(i)) skipReason = 'draw-failed'
      else skipReason = 'not-drawn'
    }
    rows.push({
      idx: i, id: l.id, name: String(l.name || l.id), type,
      vis: !!l.visible, ...(visAnim !== null ? { visAnim } : {}),
      // 动画关键帧标记（C0② 一致性对账用：origin/scale 有关键帧的层，矩形对账必须容相位差）
      ...((l.anim && (l.anim.origin || l.anim.scale)) ? { animGeom: true } : {}),
      texture: texKey, textureHit: texKey ? hasOwnTex : null,
      passes: passCount, ...(fxFiles.length ? { fxFiles } : {}),
      copybg: !!l.copybackground, chainInput,
      blend: l.colorBlendMode || 0,
      rectDesign, ...(ev ? { rectDrawn: { x0: ev.x0, y0: ev.y0, x1: ev.x1, y1: ev.y1 } } : { rectDrawn: null }),
      ...(bind ? { bind } : {}), ...(skipReason ? { skipReason } : {}),
      ...(nGlDraws ? { glDraws: nGlDraws } : {}),
    })
  }
  const summary = {
    layers: rows.length,
    drawn: rows.filter((r) => r.bind).length,
    skipped: rows.filter((r) => r.skipReason).length,
    skipReasons: rows.reduce((a, r) => { if (r.skipReason) a[r.skipReason] = (a[r.skipReason] || 0) + 1; return a }, {}),
    binds: rows.reduce((a, r) => { if (r.bind) a[r.bind] = (a[r.bind] || 0) + 1; return a }, {}),
    renderErr, canvas: { w: W, h: H }, proj: { w: projW, h: projH }, time,
  }
  return { layers: rows, summary, logs }
}

/* ── pkg 模式：scene.json 从包内取 ─────────────────────────────────────────────── */
async function attributePkg(pkgPath, opts = {}) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  let sceneObj = null
  for (const n of ['scene.json', 'Scene.json']) { const e = entry(n); if (e) { sceneObj = JSON.parse(dec.decode(e).replace(/^\uFEFF/, '')); break } }
  if (!sceneObj) throw new Error('no scene.json in pkg')
  let propsMap = null, propertiesSchema = null
  try {
    const pj = entry('project.json') || (fs.existsSync(path.join(path.dirname(pkgPath), 'project.json')) ? fs.readFileSync(path.join(path.dirname(pkgPath), 'project.json')) : null)
    const pr = pj ? JSON.parse(dec.decode(pj)) : null
    if (pr && pr.general && pr.general.properties) {
      propertiesSchema = pr.general.properties
      // 属性默认值走 lib.propsDefaults（与 scene-zoom-test / 真机 demo 同口径 ⇒ 组合互斥层（{user:{condition}}）
      // 在离线侧与真机同态，否则互斥组的可见性两边不一致（C0② 真机对账时抓到：Clock/在播放 只有真机可见）。
      propsMap = lib.propsDefaults ? lib.propsDefaults(propertiesSchema) : null
    }
  } catch (e2) {}
  const id = path.basename(path.dirname(pkgPath))
  const out = await attributeScene(sceneObj, {
    id, propsMap, propertiesSchema, pkg,
    readEntry: (n) => entry(n),
    readParticleDef: (p) => { try { const e = entry(p); return e ? JSON.parse(dec.decode(e)) : null } catch (e2) { return null } },
  }, opts)
  out.pkg = { id, path: pkgPath, entries: pkg.entries.length }
  return out
}

/* ── 自测桩件：固定枚举/schema/矩形断言（门禁入口）─────────────────────────────────── */
// WE 语义：`layer.image` 指向**模型 JSON**（模型→材质→纹理），纹理名来自材质 pass0.textures[0]。
// 夹具用 readEntry 供最小模型/材质链（无真包）。
const STUB_FILES = {
  'models/pic.json': { material: 'materials/picmat.json' },
  'materials/picmat.json': { passes: [{ textures: ['images/pic'] }] },
  'effects/pt/effect.json': { passes: [], fbos: [] },
  'materials/pt.json': { passes: [{ shader: 'effects/pt.frag', textures: [] }] },
}
const STUB = () => ({
  general: { orthogonalprojection: { width: 1920, height: 1080 } },
  objects: [
    { id: 1, name: 'vis-image', image: 'models/pic.json', size: '800 600', origin: '960 540 0' },      // 模型链声明纹理但包里没有 ⇒ 透明兜底，但**会画**
    { id: 2, name: 'hidden-layer', image: 'models/pic.json', size: '400 300', origin: '300 300 0', visible: false }, // invisible
    { id: 3, name: 'container', image: 'models/util/composelayer.json', size: '100 100', origin: '100 100 0' },   // 无 fx ⇒ container（官方逻辑 helper，C3 后仍跳）
    { id: 9, name: 'carrier', image: 'models/util/composelayer.json', size: '200 200', origin: '900 200 0', copybackground: true,
      effects: [{ file: 'effects/pt/effect.json', passes: [{ material: 'materials/pt.json' }] }] },  // 有 fx ⇒ 效果载体（P-231：参与渲染）
    { id: 10, name: 'proj-logical', image: 'models/util/projectlayer.json', size: '1920 1080', origin: '960 540 0' }, // 无 fx ⇒ logical-helper
    { id: 11, name: 'full-logical', image: 'models/util/fullscreenlayer.json', size: '1920 1080', origin: '960 540 0' }, // 无 fx ⇒ logical-helper
    { id: 4, name: 'beep', sound: ['sounds/a.mp3'], size: '100 100', origin: '500 500 0' },                       // 声音层，名字不在 UI 名单 ⇒ 透明兜底上屏
    { id: 5, name: 'wind.mp3', sound: ['sounds/b.mp3'], size: '100 100', origin: '700 700 0' },                   // 名字命中 UI 名单 ⇒ invisible-config
    { id: 6, name: 'particle-nodef', particle: 'particles/missing.json', size: '100 100', origin: '900 900 0' },  // particle-no-def
    { id: 7, name: 'solid-colored', solid: true, color: '0.2 0.6 0.2', size: '200 200', origin: '1500 800 0' },   // solidcolor 上屏
    { id: 8, name: 'text-layer', text: { text: 'hello' }, size: '300 100', origin: '1200 300 0' },                // 文本层（Node 侧无光栅器 ⇒ 透明上屏）
  ],
})
const enc = new TextEncoder()
const STUB_READ = (n) => { const v = STUB_FILES[String(n)]; return v ? enc.encode(JSON.stringify(v)) : null }

async function runSelftest() {
  let pass = 0, fail = 0, skip = 0
  const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }
  const sk = (name, why) => { skip++; console.log('  ~ SKIP ' + name + '（' + why + '）') }
  const ENUM = ['invisible', 'invisible-config', 'invisible-anim', 'container', 'particle-no-def', 'particle-tex-missing', 'particle-budget', 'particle-idle', 'degenerate-geometry', 'logical-helper', 'draw-failed', 'not-drawn']
  const BIND = ['texture', 'rtcopy', 'white', 'transparent', 'solidcolor', 'particle', 'mesh', 'gl-draw-nocallback']
  const IS_MUTANT = (process.argv.find((a) => a.startsWith('--mutant=')) || '').slice('--mutant='.length) || null

  const res = await attributeScene(STUB(), { id: 'stub', readEntry: STUB_READ, readParticleDef: () => null }, { time: 1.0 })
  const rows = res.layers
  console.log('== layer-attribution 自测（合成桩件 + 真 parseScene/renderScene + mock GL，不加载真包）==')
  if (IS_MUTANT) console.log('   ⚠ 变异模式：' + IS_MUTANT + '（隔离副本 root=' + REPO + '）')

  // A 段：schema 完备 —— 每行都有固定字段、枚举不出界
  ok('A1 桩件 11 层全归因', rows.length === 11, 'rows=' + rows.length)
  ok('A2 每行 schema 固定字段齐全（idx/id/name/type/vis/texture/passes/chainInput/blend/rectDesign/rectDrawn）',
    rows.every((r) => ['idx', 'id', 'name', 'type', 'vis', 'texture', 'passes', 'chainInput', 'blend', 'rectDesign', 'rectDrawn'].every((k) => k in r)),
    JSON.stringify(rows.find((r) => !('chainInput' in r)) || null))
  ok('A3 skipReason 枚举不出界', rows.every((r) => !r.skipReason || ENUM.includes(r.skipReason)), JSON.stringify(rows.map((r) => r.skipReason).filter((s) => s && !ENUM.includes(s))))
  ok('A4 bind 枚举不出界', rows.every((r) => !r.bind || BIND.includes(r.bind)), JSON.stringify(rows.map((r) => r.bind).filter((s) => s && !BIND.includes(s))))
  ok('A5 上了屏的行必有 rectDrawn，没上屏的必有 skipReason 且 rectDrawn=null',
    rows.every((r) => (r.bind ? !!r.rectDrawn : (r.rectDrawn === null && !!r.skipReason))),
    JSON.stringify(rows.filter((r) => (r.bind ? !r.rectDrawn : (r.rectDrawn !== null || !r.skipReason)))))

  // B 段：逐层机制断言（跳过判定/绑定）
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
  ok('B1 hidden-layer ⇒ skipReason=invisible', byName['hidden-layer'] && byName['hidden-layer'].skipReason === 'invisible', JSON.stringify(byName['hidden-layer']))
  ok('B2 container（无 fx composelayer）⇒ skipReason=container（P-231 后仍跳 = 官方逻辑 helper）', byName['container'] && byName['container'].skipReason === 'container', JSON.stringify(byName['container']))
  ok('B2b carrier（composelayer+fx）⇒ 上屏（bind=rtcopy，效果载体参与渲染）', byName['carrier'] && byName['carrier'].bind === 'rtcopy', JSON.stringify(byName['carrier']))
  ok('B2c proj-logical / full-logical（无 fx）⇒ skipReason=logical-helper', byName['proj-logical'] && byName['proj-logical'].skipReason === 'logical-helper' && byName['full-logical'] && byName['full-logical'].skipReason === 'logical-helper',
    JSON.stringify([byName['proj-logical'], byName['full-logical']]))
  ok('B3 particle-nodef ⇒ skipReason=particle-no-def', byName['particle-nodef'] && byName['particle-nodef'].skipReason === 'particle-no-def', JSON.stringify(byName['particle-nodef']))
  ok('B4 beep（声音层，名字不在 UI 名单）上屏且 bind=transparent（无图像内容是设计）', byName['beep'] && byName['beep'].bind === 'transparent', JSON.stringify(byName['beep']))
  ok('B5 wind.mp3（名字命中 UI 名单）⇒ skipReason=invisible-config（配置关的，不是作者）', byName['wind.mp3'] && byName['wind.mp3'].skipReason === 'invisible-config', JSON.stringify(byName['wind.mp3']))
  ok('B6 solid-colored 上屏 bind=solidcolor', byName['solid-colored'] && byName['solid-colored'].bind === 'solidcolor', JSON.stringify(byName['solid-colored']))
  ok('B7 text-layer type=text 且上屏（Node 侧透明兜底）', byName['text-layer'] && byName['text-layer'].type === 'text' && !!byName['text-layer'].bind, JSON.stringify(byName['text-layer']))
  ok('B8 vis-image 走完模型链、纹理引用命中失败 ⇒ texture 名如实记 + textureHit=false 但仍上屏（透明兜底可解释）',
    byName['vis-image'] && byName['vis-image'].texture === 'images/pic' && byName['vis-image'].textureHit === false && !!byName['vis-image'].bind, JSON.stringify(byName['vis-image']))

  // C 段：矩形数学 —— 实绘矩形 ↔ 设计矩形自洽（同中心、同尺寸；画布→设计坐标按 1920/1080 投影换算）
  const kx = 1920 / res.summary.canvas.w, ky = 1080 / res.summary.canvas.h
  for (const nm of ['vis-image', 'solid-colored', 'beep']) {
    const r = byName[nm]
    if (!r || !r.rectDrawn || !r.rectDesign) { sk('C 段 ' + nm, '无 rectDrawn/rectDesign'); continue }
    const d = r.rectDesign, q = r.rectDrawn
    const qw = (q.x1 - q.x0) * kx, qh = (q.y1 - q.y0) * ky
    const dcx = d.x + d.w / 2, dcy = d.y + d.h / 2, qcx = (q.x0 + q.x1) / 2 * kx, qcy = (q.y0 + q.y1) / 2 * ky
    ok('C ' + nm + ' 实绘矩形中心 = 设计矩形中心（±2 设计px）', Math.abs(dcx - qcx) < 2 && Math.abs(dcy - qcy) < 2,
      'design=(' + dcx + ',' + dcy + ') drawn=(' + qcx.toFixed(1) + ',' + qcy.toFixed(1) + ')')
    ok('C ' + nm + ' 实绘矩形尺寸 = 设计尺寸（±2 设计px）', Math.abs(d.w - qw) < 2 && Math.abs(d.h - qh) < 2,
      'design=' + d.w + 'x' + d.h + ' drawn=' + qw.toFixed(1) + 'x' + qh.toFixed(1))
  }

  // D 段：变异自证 —— 隔离副本改坏 bundle 的"不可见跳层"判定 ⇒ B1 必红（量法承重证明）
  if (!IS_MUTANT) {
    const CORE = path.join(ROOT, 'core')
    const src = fs.readFileSync(path.join(CORE, 'we-scene-bundle.js'), 'utf8')
    const anchor = "      if (!__layerVis || (layer.isContainer && (!(layer.effects && layer.effects.length) || CONTAINERFX_MODE === 'legacy'))) {"
    if (!src.includes(anchor)) ok('D0 变异锚点存在', false, '不可见/容器跳层行没找到（P-231 门控形态）')
    else {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-layerattr-'))
      for (const f of fs.readdirSync(CORE)) { if (/\.(mjs|js)$/.test(f)) fs.copyFileSync(path.join(CORE, f), path.join(dir, f)) }
      fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'), src.replace(anchor, '      if (layer.isContainer && (!(layer.effects && layer.effects.length) || CONTAINERFX_MODE === \'legacy\')) {'))
      const mlib = await import(pathToFileURL(path.join(dir, 'we-scene-bundle.js')).href + '?t=' + Date.now())
      const mres = await attributeScene(STUB(), { id: 'stub', readEntry: STUB_READ, readParticleDef: () => null }, { time: 1.0, lib: mlib })
      const mhidden = mres.layers.find((r) => r.name === 'hidden-layer')
      ok('D 变异自证：去掉"不可见"跳层判定 ⇒ hidden-layer 被画出来（B1 必红）',
        !!mhidden && !!mhidden.bind && !mhidden.skipReason, JSON.stringify(mhidden))
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e2) {}
    }
  }

  console.log('===== layer-attribution: ' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' SKIP' : '') + ' =====')
  process.exit(fail ? 1 : 0)
}

/* ── CLI（只在本文件是主脚本时跑；被 import 时不执行）──────────────────────────────── */
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath2(import.meta.url))
function fileURLToPath2(u) { return new URL(u).pathname }
if (IS_MAIN) await main()
async function main() {
  if (has('--selftest')) { await runSelftest(); process.exit(0) }
  const PKG = argVal('--pkg'), SCENE = argVal('--scene')
  if (!PKG && !SCENE) { console.error('用法: node tests/layer-attribution.mjs --pkg <abs scene.pkg> | --scene <abs scene.json> [--json <out>] [--time <s>] [--summary]'); process.exit(2) }
  const time = Number(argVal('--time') || 1.0)
  const out = PKG ? await attributePkg(PKG, { time }) : await attributeScene(JSON.parse(fs.readFileSync(SCENE, 'utf8').replace(/^\uFEFF/, '')), { id: path.basename(SCENE, '.json'), readEntry: () => null, readParticleDef: () => null }, { time })
  const jsonPath = argVal('--json') || (PKG ? path.join(ROOT, 'reports', 'layer-attribution-' + out.pkg.id + '.json') : null)
  if (jsonPath) { fs.mkdirSync(path.dirname(jsonPath), { recursive: true }); fs.writeFileSync(jsonPath, JSON.stringify(out, null, 1)) }
  console.log('== layer-attribution ' + (PKG ? 'pkg=' + out.pkg.id : 'scene=' + path.basename(SCENE)) + '  canvas=' + out.summary.canvas.w + 'x' + out.summary.canvas.h + '  t=' + out.summary.time + 's ==')
  console.log('   层数=' + out.summary.layers + ' 上屏=' + out.summary.drawn + ' 未上屏=' + out.summary.skipped + '  skipReasons=' + JSON.stringify(out.summary.skipReasons) + '  binds=' + JSON.stringify(out.summary.binds))
  if (out.summary.renderErr) console.log('   ⚠ renderErr: ' + out.summary.renderErr)
  if (has('--summary') || !jsonPath) {
    for (const r of out.layers) {
      console.log('  #' + String(r.idx).padStart(2) + ' ' + r.name.slice(0, 24).padEnd(24) + ' type=' + String(r.type).padEnd(8) + ' vis=' + (r.vis ? 1 : 0)
        + ' tex=' + String(r.texture || '-').slice(0, 28).padEnd(28) + (r.textureHit === false ? '✗' : ' ') + ' fx=' + String(r.passes).padStart(2)
        + ' chain=' + r.chainInput.padEnd(4) + ' copybg=' + (r.copybg ? 1 : 0)
        + (r.rectDrawn ? ' px=[' + r.rectDrawn.x0 + ',' + r.rectDrawn.x1 + ']x[' + r.rectDrawn.y0 + ',' + r.rectDrawn.y1 + ']' : '')
        + (r.bind ? ' bind=' + r.bind : ' skip=' + r.skipReason))
    }
  }
  if (jsonPath) console.log('   JSON → ' + jsonPath)
}

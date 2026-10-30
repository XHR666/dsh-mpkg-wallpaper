// P76-gpu-rect-probe.mjs — 只读取证（非门禁项）：用 mock-GL 走**真实 GPU 绘制路径**
//   （renderScene → compositeLayer），抓每层的 mvp，按 demo.html:3588-3626 的口径算实绘矩形，
//   与 refrender-<id>.json（官方标定）对账 —— 回答"CPU 基线对、真机偏 +1639px 到底偏在哪"。
// 复现：node P76-gpu-rect-probe.mjs [sceneId]
import fs from 'node:fs'
import * as lib from './we-scene-bundle.js'
import { installPuppet } from './elysia/we-renderer/puppet.js'

const id = process.argv[2] || '3719111841'
const DIR = '/root/Desktop/DSHarea/allwallpaper/dd'
const dec = new TextDecoder()

// ---- mock GL ----
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6,
  READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let ids = 0, curVao = null, curUnit = 0, curFbo = null, curProg = null, curBuf = null
const bufData = new Map()
const curTex = new Array(8).fill(null)
const mk = (k) => ({ id: k + '#' + (++ids) })
const draws = []
let uniMVP = null
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: (v) => { curVao = v }, activeTexture: (u) => { curUnit = u },
  bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  bindFramebuffer: (t, f) => { curFbo = f }, useProgram: (p) => { curProg = p },
  bindBuffer: (t, b) => { curBuf = b },
  bufferData: (t, data) => { if (curBuf) bufData.set(curBuf.id, Array.from(data).slice(0, 10)) },
  drawArrays: (m, f, c) => { draws.push({ prog: curProg && curProg.id, fbo: curFbo && curFbo.id, vao: curVao && curVao.id }) },
  drawElements: (m, c) => { draws.push({ prog: curProg && curProg.id, fbo: curFbo && curFbo.id, elements: true }) },
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
  getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_Alpha' ? 2 : -1,
  getUniformLocation: () => ({ u: 1 }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR,
  getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
  uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
  uniformMatrix4fv: (loc, tr, m) => { if (m && m.length === 16) uniMVP = Array.from(m) },
  uniformMatrix3fv: () => {}, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
const REF = JSON.parse(fs.readFileSync(`./refrender-${id}.json`, 'utf8'))
const scene = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')))
// ① 与 demo.html 一致：**不**传 refrender（那是一层"按标定摆位"的诊断 hack，会掩盖真 bug）
lib.applyRenderConfig(scene, { sceneId: id, hideParticles: true, hideUI: true, log: () => {} })

const textures = new Map()
for (const l of scene.layers) {
  try {
    if (!l.image) continue
    const me = entry(l.image); if (!me) continue
    const mj = JSON.parse(dec.decode(me)); if (!mj) continue
    const mat = lib.resolveMaterial(mj); if (!mat) continue
    const mate = entry(mat.materialPath); if (!mate) continue
    const material = JSON.parse(dec.decode(mate))
    const tn = material.passes && material.passes[0] && material.passes[0].textures && material.passes[0].textures[0]
    if (tn) { l.textureName = tn; if (!textures.has(tn)) textures.set(tn, { glTex: { __name: tn, id: 'tex_' + tn }, width: 1024, height: 1024 }) }
  } catch (e) {}
}

const H = {}; installPuppet(H)
const skinLayers = []
for (const l of scene.layers) {
  try {
    if (!l.image) continue
    const me = entry(l.image); if (!me) continue
    const mj = JSON.parse(dec.decode(me)); if (!mj || !mj.puppet) continue
    const ru = entry(mj.puppet); if (!ru) continue
    const mesh = H._parseMdl(ru)
    if (!mesh || !mesh.bones || !mesh.bones.length) continue
    const nb = mesh.bones.length
    const bindWorld = new Array(nb), bindInv = new Array(nb)
    for (let b = 0; b < nb; b++) { const p = mesh.bones[b].parent, lo = mesh.bones[b].bind; bindWorld[b] = (p >= 0 && bindWorld[p]) ? H._matMulRow(bindWorld[p], lo) : lo.slice() }
    for (let b = 0; b < nb; b++) bindInv[b] = H._matInvertRow(bindWorld[b])
    const anim = mesh.animations && mesh.animations[0]
    const N = Math.max(3, (anim && anim.frameCount) || 3)
    const gBones = new Float32Array(nb * 16)
    for (let b = 0; b < nb; b++) gBones.set(bindInv[b], b * 16)   // 帧 0：RT=单位阵 → gBones = bindInv（= bind 位姿）
    skinLayers.push(Object.assign(l, { __skin: { mesh, nb, bindInv, gBones, animIdx: 0, fps: (anim && anim.fps) || 30, frameCount: N } }))
  } catch (e) {}
}
console.log(`[${id}] 层=${scene.layers.length} 蒙皮=${skinLayers.length}（${skinLayers.map((l) => l.name).join('/')}）`)

const W = 3840, Hh = 2160
const ledger = []
const LOGS = []
const renderer = lib.createRenderer({ getContext: () => gl, width: W, height: Hh }, {
  onLog: (m) => { LOGS.push(String(m)) },
  shaderResolver,
  onMeshLayer: () => {},
  onLayerDraw: (layer, info) => {
    // 逐字复刻 demo.html:3584-3626 的口径（含 FRAMEBUFFER_BINDING 守卫）
    if (gl.getParameter(CONST.FRAMEBUFFER_BINDING) !== null) return
    const m = info.mvp
    const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
    const scr = (v, n) => (v * 0.5 + 0.5) * n
    const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
    const x0 = Math.round(scr(Math.min(A[0], B[0]), info.width)), x1 = Math.round(scr(Math.max(A[0], B[0]), info.width))
    const yA = scr(Math.min(A[1], B[1]), info.height), yB = scr(Math.max(A[1], B[1]), info.height)
    // 逐字复刻 demo.html:3857 mpwLedgerYDown（GL 底左 → y-down 顶左，以 layer.origin 为锚定符号）
    const projH = (scene && scene.general && scene.general.orthogonalprojection && Number(scene.general.orthogonalprojection.height)) || info.height
    const oyPx = (layer.origin && isFinite(Number(layer.origin[1]))) ? Number(layer.origin[1]) / projH * info.height : null
    const yyDown = (() => {
      const H2 = info.height, a2 = yA, b2 = yB
      const lo = Math.min(a2, b2), hi = Math.max(a2, b2)
      const flipped = (oyPx === null || oyPx === undefined || !isFinite(Number(oyPx))) ? true
        : (Math.abs((H2 - (lo + hi) / 2) - Number(oyPx)) < Math.abs((lo + hi) / 2 - Number(oyPx)))
      const conv = (v) => (flipped ? (H2 - v) : v)
      return { y0: Math.round(Math.min(conv(lo), conv(hi))), y1: Math.round(Math.max(conv(lo), conv(hi))) }
    })()
    const k = 3840 / info.width
    const nm = String(layer.name || layer.id).slice(0, 20)
    if (ledger.some((e) => e.n === nm)) return
    ledger.push({ id: layer.id, n: nm, w: info.width, h: info.height,
      rd: [Math.round(x0 * k), Math.round(yyDown.y0 * k), Math.round((x1 - x0) * k), Math.round((yyDown.y1 - yyDown.y0) * k)],
      mvpT: [Math.round(m[12]), Math.round(m[13])], quadW: Math.round(info.quadW), quadH: Math.round(info.quadH),
      rawY: [Math.round(yA), Math.round(yB)], yDown: [yyDown.y0, yyDown.y1], quad: [Math.round(info.quadW * k), Math.round(info.quadH * k)],
      mvp: Array.from(m).map((v) => Math.round(v * 1e6) / 1e6),
      org: [layer.origin[0], layer.origin[1]], sc: [layer.scale[0], layer.scale[1]],
      sz: [layer.size[0], layer.size[1]], aligns: String(layer.alignment),
      par: layer.parallaxDepth ? Array.from(layer.parallaxDepth) : null, ws: [info.width, info.height] })
  },
  trace: false, auditFrames: 1, copyBackground: false, clearBgFx: true, hideParticles: true,
  // 与 demo.html 默认一致：parallaxOff=true（?parallax=1 才开视差）
  parallaxOff: process.env.P76_PARON !== '1',
})
await renderer.render(scene, textures, W, Hh, 1.0)

console.log('\n=== GPU 路径实绘矩形（mock-GL，demo 口径）vs refrender 标定 ===')
console.log('id   名称            GPU rd[x,y,w,h]              标定[x,y,w,h]             Δx0    Δy0   Δw  Δh  mvpT')
const pad = (s, n) => String(s).padEnd(n)
for (const e of ledger) {
  const r = REF[String(e.id)]
  const d = r ? [e.rd[0] - r[0], e.rd[1] - r[1], e.rd[2] - r[2], e.rd[3] - r[3]].map((v) => Math.round(v)) : null
  console.log(pad(e.id, 5) + pad(e.n, 15) + pad(JSON.stringify(e.rd), 28) +
    pad(r ? JSON.stringify(r.map((v) => Math.round(v))) : '-', 26) +
    (d ? pad(d[0], 7) + pad(d[1], 6) + pad(d[2], 4) + pad(d[3], 4) : pad('-', 21)) +
    ' ' + JSON.stringify(e.mvpT) + ' quad=' + JSON.stringify(e.quad))
}

console.log('\n=== compositeLayer 内部日志 ===')
for (const l of LOGS) if (/背景|bg帧/.test(l)) console.log('  ' + l)
console.log('\n=== 31 背景正常 全矩阵 ===')
const bg = ledger.find((e) => e.id === 31)
if (bg) {
  console.log('origin=', bg.org, 'scale=', bg.sc, 'size=', bg.sz, 'alignment=', bg.aligns, 'parallax=', bg.par, 'viewport=', bg.ws)
  console.log('mvp  =', JSON.stringify(bg.mvp))
  console.log('  m[12],m[13] =', bg.mvp[12], bg.mvp[13])
  // 由 rd 反解实际参与投影的 (ox, oy)
  const qx = bg.quad[0], qy = bg.quad[1]
  const oxImplied = (bg.rd[0] + qx / 2) / 3840 * 3840
  console.log('  由 rd 反解：实绘中心 x =', (bg.rd[0] + bg.rd[2] / 2), ' y =', (bg.rd[1] + bg.rd[3] / 2))
  console.log('  期望中心   x =', bg.org[0], ' y =', bg.org[1])
  console.log('  Δ中心 = (', (bg.rd[0] + bg.rd[2] / 2) - bg.org[0], ',', (bg.rd[1] + bg.rd[3] / 2) - bg.org[1], ')')
  void oxImplied; void qy
}

// render-audit.mjs — 用 mock-GL 驱动**真实** renderScene（core/we-scene-bundle.js），逐层报告
// "画了 / 跳过 / 抛异常中断"，用于本地复现设备上"只剩几层、整体缺失"的渲染问题。
// 用法: node render-audit.mjs [id] [--skinoff] [--bgfx]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const id = process.argv[2] || '3719111841'
const useSkin = !process.argv.includes('--skinoff')
const DIR = `${MPW_WS}/allwallpaper/dd`
const dec = new TextDecoder()
const { parsePkg, getEntry, createRenderer, applyRenderConfig } = lib

// ---- mock GL（记录 draw 调用）----
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let ids = 0, curVao = null, curUnit = 0, curFbo = null, curProg = null, drawCount = 0, curBuf = null
const bufData = new Map()
const curTex = new Array(8).fill(null)
const tid = (t) => (t ? (t.__name || t.id || 'anon') : null)
const mk = (k) => ({ id: k + '#' + (++ids) })
const draws = []
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: (v) => { curVao = v }, activeTexture: (u) => { curUnit = u },
  bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  bindFramebuffer: (t, f) => { curFbo = f }, useProgram: (p) => { curProg = p },
  bindBuffer: (t, b) => { curBuf = b },
  bufferData: (t, data) => { if (curBuf) bufData.set(curBuf.id, Array.from(data).slice(0, 10)) },
  drawArrays: (m, f, c) => { drawCount++; draws.push({ prog: curProg && curProg.id, fbo: curFbo && curFbo.id, tex: curTex.map(tid), count: c, verts: curBuf ? (bufData.get(curBuf.id) || null) : null, vao: curVao && curVao.id }) },
  drawElements: (m, c) => { drawCount++; draws.push({ prog: curProg && curProg.id, fbo: curFbo && curFbo.id, tex: curTex.map(tid), count: c, elements: true }) },
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
  getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_Alpha' ? 2 : -1,
  getUniformLocation: () => ({ u: 1 }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
  uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
  uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {}, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

// ---- 真实 pkg / scene ----
// ①(RE-25) 支持直接审计任意 PKG/PKGM 容器：node render-audit.mjs --pkg <path>
const argPkg = process.argv.indexOf('--pkg')
const pkgPath = argPkg > 0 ? process.argv[argPkg + 1] : `${DIR}/${id}/scene.pkg`
/* ①(2026-09-21 逐层基线夹具) `tests/scene-layer-baseline-test.mjs` 要的是**数字**，不是人读的行。
   人读输出保持原样（向后兼容），末尾额外打一行 `MPW-AUDIT-JSON {...}` 作为机读契约：
   层数/可见层/首帧逐层状态/跳过原因/每帧背景直绘/蒙皮命中/音频层。 */
const argJson = process.argv.indexOf('--json')
const jsonPath = argJson > 0 ? process.argv[argJson + 1] : null
const pkg = parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
const entry = (n) => { const e = getEntry(pkg, n); return e ? new Uint8Array(e) : null }
const REF = `${MPW_WS}/we-scene-demo/refrender-${id}.json`
const scene = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')))
// ①(修正) 与 demo 一致：**无条件**调用 applyRenderConfig（RE-06 可见性/隐藏规则都在其中）；
//   之前只在有 refrender 文件时才调用 → 无该文件的包会误报"蒙皮层被隐藏"。
applyRenderConfig(scene, { sceneId: id, refrender: fs.existsSync(REF) ? JSON.parse(fs.readFileSync(REF, 'utf8')) : null, anchor: 'refcenter', clearBgFx: true, hideParticles: true, hideUI: true, log: () => {} })

// ---- 纹理表（mock）：按 demo 的真实链路解析 model→material→passes[0].textures[0] ----
const textures = new Map()
for (const l of scene.layers) {
  try {
    if (!l.image) continue
    const me = entry(l.image); if (!me) continue
    const mj = JSON.parse(dec.decode(me)); if (!mj) continue
    const mat = lib.resolveMaterial(mj); if (!mat) continue
    const mate = entry(mat.materialPath); if (!mate) continue
    const material = JSON.parse(dec.decode(mate))
    const pass0 = material.passes && material.passes[0]
    const tn = pass0 && pass0.textures && pass0.textures[0]
    if (tn) { l.textureName = tn; if (!textures.has(tn)) textures.set(tn, { glTex: { __name: tn, id: 'tex_' + tn }, width: 1024, height: 1024 }) }
  } catch (e) {}
}
console.log(`[${id}] 层=${scene.layers.length} 纹理=${textures.size} 蒙皮=${useSkin ? 'on' : 'off'}`)

// ---- 蒙皮准备（与 demo.html 同算法：坏帧跳过 + 相位插值）----
const H = {}
installPuppet(H)
const skinLayers = []
if (useSkin) {
  for (const l of scene.layers) {
    try {
      if (!l.image) continue
      const me = entry(l.image); if (!me) continue
      const mj = JSON.parse(dec.decode(me)); if (!mj || !mj.puppet) continue
      const ru = entry(mj.puppet); if (!ru) continue
      const mesh = H._parseMdl(new MpwBuffer(ru.buffer, ru.byteOffset, ru.byteLength))
      if (!mesh || !mesh.bones || !mesh.bones.length || !mesh.animations || !mesh.animations.length) { console.log('  ⚠ 解析失败:', l.name); continue }
      const nb = mesh.bones.length
      const bindWorld = new Array(nb), bindInv = new Array(nb)
      for (let b = 0; b < nb; b++) { const p = mesh.bones[b].parent, lo = mesh.bones[b].bind; bindWorld[b] = (p >= 0 && bindWorld[p]) ? H._matMulRow(bindWorld[p], lo) : lo.slice() }
      for (let b = 0; b < nb; b++) bindInv[b] = H._matInvertRow(bindWorld[b])
      const anim = mesh.animations[0]
      const N = Math.max(3, anim.frameCount || 3)
      const sig = new Float64Array(N)
      for (let f = 0; f < N; f++) { const rt = H._sampleAnimRT(mesh, anim, f, nb, mesh.bones); let s = 0; for (let b = 0; b < nb; b++) s += rt[b].tx + rt[b].ty + rt[b].angle * 100; sig[f] = s }
      const l2 = { mesh, nb, bindInv, animIdx: 0, fps: anim.fps || 30, frameCount: N, gBones: new Float32Array(nb * 16) }
      skinLayers.push(Object.assign(l, { __skin: l2 }))
    } catch (e) { console.log('  ⚠ 蒙皮准备异常', l.name, e.message) }
  }
  console.log('  蒙皮层: ' + skinLayers.map((l) => l.name).join(' / '))
}
const updateBones = (tSec) => {
  for (const l of skinLayers) {
    const sk = l.__skin
    const rt = H._sampleAnimRT(sk.mesh, sk.mesh.animations[sk.animIdx], Math.floor(tSec * sk.fps) % sk.frameCount, sk.nb, sk.mesh.bones)
    for (let b = 0; b < sk.nb; b++) {
      const m = H._matMulRow(H._matMulRow([Math.cos(rt[b].angle), -Math.sin(rt[b].angle), 0, 0, Math.sin(rt[b].angle), Math.cos(rt[b].angle), 0, 0, 0, 0, 1, 0, rt[b].tx, rt[b].ty, 0, 1], [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]), sk.bindInv[b])
      sk.gBones.set(m, b * 16)
    }
  }
}

// ---- 真实 renderScene ----
const meshDraws = []
const skipLogs = []
const renderer = createRenderer({ getContext: () => gl, width: 3840, height: 2160 }, {
  onLog: (m) => skipLogs.push(m),
  shaderResolver,
  onMeshLayer: (layer) => {
    const sk = layer.__skin
    const tex = layer.textureName ? textures.get(layer.textureName) : null
    meshDraws.push({ layer: layer.name, hasSkin: !!sk, hasGBones: !!(sk && sk.gBones), hasTex: !!(tex && tex.glTex), visible: layer.visible })
    if (renderer.renderMeshLayer && sk && sk.gBones && tex && tex.glTex) {
      const op = scene.general && scene.general.orthogonalprojection
      renderer.renderMeshLayer(layer, sk.mesh, sk.gBones, sk.nb, [layer.origin[0], layer.origin[1]], [layer.scale[0], -layer.scale[1]], [(op && op.width) || 3840, (op && op.height) || 2160], tex.glTex)
    }
  },
  trace: false,
  auditFrames: 1,
  copyBackground: false,
  clearBgFx: !process.argv.includes('--bgfx'),
  hideParticles: true,
})
// 复现 demo 真实流程：蒙皮层保持 visible=true，只用 __skinReady 触发 mesh 分支
if (useSkin) { updateBones(1.0); skinLayers.forEach((l) => { l.__skinReady = true }) }
if (useSkin) for (const l of skinLayers) if (!l.visible) console.log('  ⚠(回归!) 蒙皮层被置 visible=false → mesh 回调不会触发:', l.name)
let err = null
try {
  await renderer.render(scene, textures, 3840, 2160, 1.0)
} catch (e) { err = e }
const before = drawCount
console.log(`  render() ${err ? '抛异常: ' + err.message : '正常返回'} · drawArrays/drawElements 调用=${drawCount}`)
const usedTex = new Set()
for (const d of draws) for (const t of (d.tex || [])) if (t) usedTex.add(t)
const wantTex = ['背景', '长发3', '长带子', '主体', '右侧发']
console.log('  纹理是否被 draw 使用: ' + wantTex.map((n) => n + '=' + (usedTex.has(n) ? '是' : '否')).join(' '))
// 背景层的 draw 顶点数据（帧间对比：缓存键命中有没有导致几何没上传）
const frameReports = []
for (let fi = 1; fi <= 3; fi++) {
  await renderer.render(scene, textures, 3840, 2160, fi)
  const bgDraws = draws.filter((d) => (d.tex || []).includes('背景') && !d.fbo)
  frameReports.push({ frame: fi, bgDraws: bgDraws.length, totalDraws: draws.length, verts: bgDraws[0] ? bgDraws[0].verts : null })
  console.log('  帧' + fi + ' 背景直绘 draw 次数=' + bgDraws.length +
    (bgDraws[0] ? ' 顶点=' + JSON.stringify(bgDraws[0].verts) + ' tex=' + JSON.stringify(bgDraws[0].tex.filter(Boolean)) : ''))
  draws.length = 0
}
console.log(`  mesh 回调层数=${meshDraws.length}`)
for (const m of meshDraws) console.log(`    mesh ${String(m.layer).padEnd(12)} skin=${m.hasSkin} gBones=${m.hasGBones} tex=${m.hasTex} visible=${m.visible}`)
console.log(`  可见层=${scene.layers.filter((l) => l.visible).length} / 总层=${scene.layers.length}`)
const hiddenSkin = skinLayers.filter((l) => !l.visible).length
console.log(`  蒙皮层被置 visible=false 的个数=${hiddenSkin}（必须为 0：为 0 才与修复后的 demo 一致）`)
const meshDrawn = new Set(meshDraws.filter((m) => m.hasSkin && m.hasGBones).map((m) => m.layer)).size
console.log(skinLayers.length === 0
  ? '  【断言】该包无蒙皮层（跳过）—'
  : `  【断言】mesh 回调命中 ${meshDrawn}/${skinLayers.length} 层 → ${meshDrawn === skinLayers.length ? '通过 ✓' : '失败 ✗（层会消失）'}`)
if (skipLogs.length) { console.log('  渲染器日志:'); skipLogs.slice(0, 20).forEach((m) => console.log('    ' + m)) }

/* ── 机读报告（见文件上方 `--json` 注释）：人读输出已全部打完，这里只追加一行契约 ── */
{
  const parseFirstFrame = (m) => {
    const g = /^\[首帧\] #(\d+) (.+?) vis=(\d+) tex=(\S+) skin=(\d+) fx=(\d+) part=(\d+)$/.exec(m)
    return g ? { index: Number(g[1]), name: g[2], vis: Number(g[3]), tex: g[4], skin: Number(g[5]), fx: Number(g[6]), part: Number(g[7]) } : null
  }
  const firstFrame = skipLogs.map(parseFirstFrame).filter(Boolean)
  const skipped = skipLogs.filter((m) => /^\[首帧\] \. #\d+ 跳过/.test(m)).map((m) => m.replace(/^\[首帧\] \. /, ''))
  const audioLayers = firstFrame.filter((f) => /audio|音条|音频/i.test(f.name))
  const report = {
    id,
    pkg: path.relative(MPW_WS, pkgPath).split(path.sep).join('/'),   // 相对路径：报告里不留宿主绝对路径
    layers: { total: scene.layers.length, visible: scene.layers.filter((l) => l.visible).length },
    textures: textures.size,
    drawCalls: drawCount,
    renderError: err ? String(err.message) : null,
    skin: { layers: skinLayers.map((l) => l.name), hidden: hiddenSkin, drawn: meshDrawn, total: skinLayers.length },
    firstFrame,
    skipped,
    frames: frameReports,
    audioLayers,
  }
  const line = 'MPW-AUDIT-JSON ' + JSON.stringify(report)
  console.log(line)
  if (jsonPath) { try { fs.writeFileSync(jsonPath, JSON.stringify(report, null, 1) + '\n') } catch (e) { console.log('  ⚠ 写 --json 失败: ' + e.message) } }
}

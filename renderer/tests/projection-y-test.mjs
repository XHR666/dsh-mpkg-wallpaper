// projection-y-test.mjs — P-69 回归（用户第 1/2 项）
//
// 背景（真机证据链，见 PATCHES.md P-69）：
//   · 真机 `3554161528` 上报 r1789405811216 的 `shot` 里，两个花朵层被画到**屏幕上半部分**（花瓣带
//     0..1095 设计像素），官方 WE 截图（Testphoto/TP11/W1.jpg）在**下半部分**；CPU 预览与官方一致。
//   · 复原：把两个花朵层的 origin 关于 1080 镜像后用 preview.mjs 重渲 = 与真机画面逐处吻合
//     （band 指标 [3.65,17.88,17.81,28.93,21.44,1.49,0.88,0.46,0.01,0] ↔ 真机
//      [5.13,16.9,13.61,30.19,16.58,1.13,0.75,0.46,0.21,0.03]）。
//   · 根因：buildCamera 的 `mat4Ortho(left,right,top,bottom,…)` 第 3/4 实参顺序与其公式
//     （glMatrix：`2/(bottom−top)`）相反 ⇒ 世界 y=0 → NDC −1（屏幕底），而 parseScene 产出的是
//     y-down（y=0=顶）。走 viewProj 的四边形/粒子层全部绕屏幕中线镜像；蒙皮层走自己的
//     MESH_VERT（`1 − wpos.y*2/u_Proj.y`，本来就是 y-down）所以一直是正的 —— 这就是"只有部分层不对"。
//   · 第二项（粒子卡顿）：粒子系统逐帧重建 + 从 0 重放 ⇒ hina id389 `cherry blossoms on cursor`
//     （origin=画布正中、rate=100/s、maxcount=1000、spritetrail）每帧重放 250–400 步 × ~165 粒
//     ≈ 9.6 万次粒子更新/帧（本机 62.8ms/帧）。改成按输入签名缓存 + 每帧只推进 dt 后 ≈ 400 次/帧、
//     2.2ms/帧，存活粒子数与顶点流逐位不变。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg) } }
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}（实测 ${a} vs 期望 ${b}，容差 ${eps}）`)

const PKG = `${MPW_WS}/allwallpaper/dd/3554161528/scene.pkg`
const WE_ASSETS = `${MPW_WS}/wallpaper_engine/assets`
const dec = new TextDecoder()

// ───────────────────────── ① 投影真值表（纯函数，无 GL） ─────────────────────────
console.log('\n[1] 相机投影真值表：世界 y-down → NDC')
{
  const scene = { general: { orthogonalprojection: { width: 3840, height: 2160 } } }
  const pt = (m, x, y) => [+(m[0] * x + m[4] * y + m[12]).toFixed(6), +(m[1] * x + m[5] * y + m[13]).toFixed(6)]
  const vpOf = () => { const cam = lib.buildCamera(scene, 1920, 1080, { fillmode: 'aspectcrop' }); return lib.mat4Multiply(cam.projection, cam.view) }

  lib.setProjectionYFix(true)
  const vpF = vpOf()
  near(pt(vpF, 0, 0)[1], +1, 1e-4, 'fix: world y=0 → NDC y=+1（屏幕顶）')
  near(pt(vpF, 0, 2160)[1], -1, 1e-4, 'fix: world y=2160 → NDC y=−1（屏幕底）')
  near(pt(vpF, 0, 1080)[1], 0, 1e-4, 'fix: world y=1080 → NDC y=0（屏幕中线）')
  near(pt(vpF, 3840, 1080)[0], +1, 1e-4, 'fix: world x=3840 → NDC x=+1')
  // 与 MESH_VERT（bundle:4529 `1.0 - wpos.y*2.0/u_Proj.y`）同式 —— 两条绘制路径必须同口径
  for (const y of [0, 1, 540, 1080, 1620, 2160]) {
    const meshNdc = 1.0 - y * 2.0 / 2160
    near(pt(vpF, 0, y)[1], meshNdc, 1e-6, `fix: y=${y} 与 MESH_VERT 的 1−2y/H 同式（float32 容差）`)
  }

  lib.setProjectionYFix(false)
  const vpL = vpOf()
  near(pt(vpL, 0, 0)[1], -1, 1e-4, 'legacy(?projy=legacy): world y=0 → NDC y=−1（旧镜像口径，复现 bug）')
  near(pt(vpL, 0, 2160)[1], +1, 1e-4, 'legacy: world y=2160 → NDC y=+1')
  // 两种口径对同一世界点的屏幕落点必须互为镜像（这是本次改动的"改前/改后"关系）
  for (const y of [0, 519.45, 1080, 1640.55, 2160]) {
    const a = pt(vpF, 0, y)[1], b = pt(vpL, 0, y)[1]
    near(a, -b, 1e-9, `口径互镜: fix(${y})=${a} == −legacy(${y})`)
  }
  lib.setProjectionYFix(null)
  ok(lib.projectionYFix() === true, '默认（无 ?projy）为 fix')
}

// ───────────────────────── ② 真包 3554161528：花朵层落点 ─────────────────────────
console.log('\n[2] 真包 3554161528 花朵层落点（官方 W1.jpg 量出来的范围）')
if (!fs.existsSync(PKG)) {
  console.log('  SKIP projection-y（缺包 ' + PKG + '）')
} else {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
  const sceneJson = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sceneJson, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef })
  const projH = scene.general.orthogonalprojection.height
  const l73 = scene.layers.find((l) => l.id === 73)
  const l50 = scene.layers.find((l) => l.id === 50)
  const l82 = scene.layers.find((l) => l.id === 82)
  ok(!!l73 && !!l50 && !!l82, '花朵(id73)/花朵 拷贝(id50)/钢琴(id82) 三对照层都在')
  // 解析值（y-down）必须与真机上报 layers[] 的 origin 逐位一致（r1789405811216）
  near(l73.origin[1], 1640.55, 0.05, 'id73 花朵 parsed origin.y = 1640.55（真机上报 1641）')
  near(l50.origin[1], 1875.43, 0.05, 'id50 花朵 拷贝 parsed origin.y = 1875.43（真机上报 1875）')
  near(l82.origin[1], 1052.95, 0.05, 'id82 钢琴 parsed origin.y = 1052.95（真机上报 1053）')

  lib.setProjectionYFix(true)
  const camF = lib.buildCamera(scene, 1920, 1080, { fillmode: 'aspectcrop' })
  const vpF = lib.mat4Multiply(camF.projection, camF.view)
  const rowOf = (m, y) => (1 - (m[1] * 0 + m[5] * y + m[13])) * 0.5 * projH   // NDC y → 画面行（y 向下）
  near(rowOf(vpF, l73.origin[1]), 1640.55, 0.5, 'fix: 花朵画在画面行 1640.55（下半屏）')
  near(rowOf(vpF, l73.origin[1]), l73.origin[1], 0.5, 'fix: 屏幕落点 == parsed y（恒等，不再镜像）')
  const h73 = l73.size[1] * l73.scale[1]
  const y0 = rowOf(vpF, l73.origin[1]) - h73 / 2, y1 = rowOf(vpF, l73.origin[1]) + h73 / 2
  ok(y0 > projH * 0.45 && y1 > projH, `fix: 花朵外接框 ${y0.toFixed(0)}..${y1.toFixed(0)} 覆盖画面底部（上边缘 >45% 高度）`)
  // 官方 W1.jpg 用 flower-band-metric 量的花瓣带：设计 y 1071..2160（下缘铺满）—— 花朵上边缘必须落在这附近
  ok(Math.abs(y0 - 1065) < 12, `fix: 花朵上边缘 ${y0.toFixed(0)} ≈ 官方量的 1065（10 带指标第 5 带起有花）`)

  lib.setProjectionYFix(false)
  const camL = lib.buildCamera(scene, 1920, 1080, { fillmode: 'aspectcrop' })
  const vpL = lib.mat4Multiply(camL.projection, camL.view)
  near(rowOf(vpL, l73.origin[1]), 519.45, 0.5, 'legacy: 花朵被画到画面行 519.45（=真机上报里"上半屏大白花"的实测位置）')
  near(rowOf(vpL, l50.origin[1]), 284.57, 0.5, 'legacy: 花朵 拷贝 → 画面行 284.57(=真机)')
  const shift82 = Math.abs(rowOf(vpL, l82.origin[1]) - l82.origin[1])
  near(shift82, 54.1, 0.5, 'legacy: 钢琴只偏 54px ⇒ 这是"只有花朵看着不对"的原因（对照层）')
  lib.setProjectionYFix(null)
}

// ───────────────────────── ③ 粒子模拟：缓存不变量 + 代价 ─────────────────────────
console.log('\n[3] 粒子模拟：incr 缓存与 replay 逐位同起点、稳态代价下降')
{
  // 极简 mock GL（只够建纹理 + 跑 renderScene）
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    RG8: 0x8229, RG: 0x8227 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let seq = 0, curUnit = 0
  const curTex = new Array(8).fill(null)
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0, isTexture: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', texImage2D: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const shaderResolver = async (rel) => (rel.endsWith('.vert')
    ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }'
    : 'void main(){ gl_FragColor = vec4(1.0); }')

  if (!fs.existsSync(PKG)) { console.log('  SKIP 粒子部分（缺包）') } else {
    const build = () => {
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
      const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
      const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
      const scene = lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef })
      lib.applyRenderConfig(scene, { sceneId: '3554161528', clearBgFx: true, hideUI: true, hideParticles: false, log: () => {} })
      const textures = new Map()
      const put = (name, buf) => {
        if (!buf || textures.has(name)) return
        let tex, m
        try { tex = lib.parseTex(new Uint8Array(buf)); m = lib.decodeMip0(tex) } catch { return }
        if (!m || !m.rgba) return
        const gt = lib.makeTextureMip(gl, [m], tex.format === 8)
        if (gt) textures.set(name, { glTex: gt, width: m.width, height: m.height, rg88: tex.format === 8, format: tex.format })
      }
      for (const l of scene.layers) {
        if (l.particleDef && l.particleDef.material) {
          try {
            const e = lib.getEntry(pkg, l.particleDef.material)
            const tn = e ? ((JSON.parse(dec.decode(e)).passes || [])[0] || {}).textures?.[0] : null
            if (tn) { l.particleTexName = tn
              const te = lib.getEntry(pkg, 'materials/' + tn + '.tex') || (fs.existsSync(WE_ASSETS + '/materials/' + tn + '.tex') ? fs.readFileSync(WE_ASSETS + '/materials/' + tn + '.tex') : null)
              put(tn, te) } } catch {}
        }
        if (!l.image) continue
        try {
          let model; const bi = lib.resolveBuiltin(l.image)
          if (bi && bi.kind === 'model') model = bi.value
          else { const me = lib.getEntry(pkg, l.image); if (!me) continue; model = JSON.parse(dec.decode(me)) }
          const mat = lib.resolveMaterial(model); if (!mat) continue
          const bm = lib.resolveBuiltin(mat.materialPath)
          let material
          if (bm && bm.kind === 'material') material = bm.value
          else { const me2 = lib.getEntry(pkg, mat.materialPath); if (!me2) continue; material = JSON.parse(dec.decode(me2)) }
          const tn = ((material.passes || [])[0] || {}).textures?.[0]
          if (tn) { l.textureName = tn
            const te = lib.getEntry(pkg, 'materials/' + tn + '.tex') || (fs.existsSync(WE_ASSETS + '/materials/' + tn + '.tex') ? fs.readFileSync(WE_ASSETS + '/materials/' + tn + '.tex') : null)
            put(tn, te) } } catch {}
      }
      return { scene, textures }
    }
    const runFrames = async (mode, times) => {
      globalThis.location = { search: mode === 'replay' ? '?psim=replay' : '' }
      const { scene, textures } = build()
      const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver })
      const out = []
      for (const t of times) {
        await r.render(scene, textures, 1920, 1080, t)
        out.push({ alive: r.particleStats.alive, drawn: r.particleStats.drawn,
          steps: r.particleStats.simSteps, updates: r.particleStats.simUpdates, simMode: r.particleStats.simMode })
      }
      delete globalThis.location
      return out
    }
    const T = [12.5, 12.5 + 1 / 30, 12.5 + 2 / 30]
    const rep = await runFrames('replay', T)
    const inc = await runFrames('incr', T)
    ok(rep[0].simMode === 'replay' && inc[0].simMode === 'incr', '?psim=replay / 默认 incr 两档都生效')
    ok(inc[0].alive === rep[0].alive && inc[0].drawn === rep[0].drawn,
      `首帧（从 0 重放）存活粒子与批次数逐位一致：incr ${inc[0].alive}/${inc[0].drawn} == replay ${rep[0].alive}/${rep[0].drawn}`)
    ok(inc[1].steps <= 20 && rep[1].steps >= 200,
      `第二帧模拟步数：incr ${inc[1].steps} 步 vs replay ${rep[1].steps} 步（缓存命中后只推进 dt）`)
    ok(inc[1].updates * 20 < rep[1].updates,
      `第二帧粒子更新次数：incr ${inc[1].updates} vs replay ${rep[1].updates}（≥20× 下降）`)
    // ①(2026-09-18 重校) 判据原为"Δ ≤ 3"（绝对）。P-130 把 `emitter.rate` 缺省从 10 改成官方的 **5** 之后
    //   同一条真包（id389）的稳态存活数从 ~2× 降到 ~238，两档（incr 逐帧推进 / replay 每帧从 0 重放）
    //   的**帧步进量化误差**相对占比变大 ⇒ 实测 inc=242/239/238 vs rep=242/237/233（第三帧 Δ=5 ≈ 2.1%）。
    //   判据的**本意**是"两档在稳态上一致（只允许帧量化抖动）"，不是"绝对 3 颗" ⇒ 改成"绝对下限 3 颗
    //   + 相对 2.5%"。原口径若被"改回旧行为"仍会红（见 T11 的变异自证），所以没有放松红线。
    const dAlive = Math.abs(inc[2].alive - rep[2].alive)
    const tolAlive = Math.max(3, Math.ceil(0.025 * Math.max(inc[2].alive, rep[2].alive)))
    ok(dAlive <= tolAlive, `第三帧存活粒子数仍一致（Δ=${dAlive} ≤ 容差 ${tolAlive} = max(3, 2.5%)；inc=${inc.map((x) => x.alive).join('/')} rep=${rep.map((x) => x.alive).join('/')}）`)
  }
}

// ───────────────────────── ④ lockToPointer（用户第 6 项：中心放射爆） ─────────────────────────
console.log('\n[4] lockToPointer：无指针不发射 / 有指针跟随 / ?cursor=off / 非锁定层不受影响')
{
  if (!fs.existsSync(PKG)) { console.log('  SKIP lockToPointer（缺包）') } else {
    // 复用 [3] 的 mock GL 骨架
    const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
      FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
      RG8: 0x8229, RG: 0x8227 }
    for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
    let seq = 0, curUnit = 0
    const curTex = new Array(8).fill(null)
    const mk = (k) => ({ id: k + '#' + (++seq) })
    const handlers = {
      createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
      createShader: () => mk('sh'), createProgram: () => mk('prog'),
      activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
      getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
      getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
      getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
      getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
      getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
      checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
      getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0, isTexture: () => true,
      getShaderInfoLog: () => '', getProgramInfoLog: () => '', texImage2D: () => {},
    }
    const gl = new Proxy({}, { get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    } })
    const shaderResolver = async (rel) => (rel.endsWith('.vert')
      ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }'
      : 'void main(){ gl_FragColor = vec4(1.0); }')
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
    const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
    const scene = lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef })
    lib.applyRenderConfig(scene, { sceneId: '3554161528', clearBgFx: true, hideUI: true, hideParticles: false, log: () => {} })

    // ① 发射器归类：只有 id389 的发射器挂指针；雪景远景/落花 等环境层不受影响
    const sysOf = (id) => { const l = scene.layers.find((x) => x.id === id); return l ? lib.buildParticleSystem(l.particleDef, { origin: l.origin, scale: l.scale, seedStr: 't' }) : null }
    const s389 = sysOf(389), s1760 = sysOf(1760), s320 = sysOf(320)
    ok(s389 && s389.pointerCp === 0 && s389.emitters.every((e) => e.__ptrLocked), 'id389 cherry blossoms on cursor：controlpoint[0].flags=1 → 全发射器挂指针')
    ok(s1760 && !s1760.emitters.some((e) => e.__ptrLocked) && s320 && !s320.emitters.some((e) => e.__ptrLocked),
      '雪景远景(id1760)/落花(id320) 无 flags=1 控制点 → 发射器**不**受指针影响（回归）')

    // ② 指针注入：window.__mpwPointer（设计坐标）
    const layer389 = () => { const l = scene.layers.find((x) => x.id === 389); if (!l.particleDef) l.particleDef = readParticleDef('particles/' + '') || lib.getEntry(pkg, 'scene.json') && null; return l }
    const run389 = async (ptr) => {
      const sc = lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef })
      lib.applyRenderConfig(sc, { sceneId: '3554161528', clearBgFx: true, hideUI: true, hideParticles: false, log: () => {} })
      for (const l of sc.layers) if (l.id !== 389) l.visible = false   // 只留 cherry blossoms on cursor
      // 只留 id389（拿到它的粒子贴图）
      const textures = new Map()
      const put = (name, buf) => {
        if (!buf || textures.has(name)) return
        let tex, m
        try { tex = lib.parseTex(new Uint8Array(buf)); m = lib.decodeMip0(tex) } catch { return }
        if (!m || !m.rgba) return
        const gt = lib.makeTextureMip(gl, [m], tex.format === 8)
        if (gt) textures.set(name, { glTex: gt, width: m.width, height: m.height, rg88: tex.format === 8, format: tex.format })
      }
      for (const l of sc.layers) {
        if (!l.particleDef || !l.particleDef.material) continue
        try {
          const me = lib.getEntry(pkg, l.particleDef.material)
          const tn = me ? ((JSON.parse(dec.decode(me)).passes || [])[0] || {}).textures?.[0] : null
          if (!tn) continue
          l.particleTexName = tn
          put(tn, lib.getEntry(pkg, 'materials/' + tn + '.tex') || (fs.existsSync(WE_ASSETS + '/materials/' + tn + '.tex') ? fs.readFileSync(WE_ASSETS + '/materials/' + tn + '.tex') : null))
        } catch {}
      }
      if (ptr) globalThis.window = { __mpwPointer: ptr }; else delete globalThis.window
      const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver })
      await r.render(sc, textures, 1920, 1080, 6)
      delete globalThis.window
      const alive = r.particleStats.alive
      const l = sc.layers.find((x) => x.id === 389)
      return { alive, stats: r.particleStats }
    }
    const noPtr = await run389(null)
    ok(noPtr.alive === 0, `无指针 ⇒ lockToPointer 层 0 粒（官方 W1.jpg 画面正中无放射爆；实测 alive=${noPtr.alive}）`)
    const withPtr = await run389({ x: 800, y: 400, inside: true })
    ok(withPtr.alive > 0, `有指针(800,400) ⇒ 正常发射（alive=${withPtr.alive}）`)

    // ②b 落点断言：两个已知指针坐标 → 粒子生成位置就在该点附近（distancemin=max=1）
    {
      const l = scene.layers.find((x) => x.id === 389)
      for (const P of [[800, 400], [2600, 1700]]) {
        const sys = lib.buildParticleSystem(l.particleDef, { origin: l.origin, scale: l.scale, seedStr: 'ptr' })
        ok(sys.emitters.every((e) => e.__ptrLocked), `落点断言前置：id389 发射器全挂指针（${P}）`)
        sys.pointer = P
        // 只推进 0.2s：粒子初速 (0,100,0) 会让它们随后离开指针，落点断言看的是**生成位置**
        lib.simulateParticleSystem(sys, 0.2, 400)
        const ps = sys.particles.slice(0, 40)
        const dx = ps.map((q) => Math.abs(q.pos[0] - P[0])), dy = ps.map((q) => Math.abs(q.pos[1] - P[1]))
        const mx = Math.max(...dx), my = Math.max(...dy)
        ok(ps.length > 0 && mx < 60 && my < 60,
          `指针 ${P} ⇒ 粒子生成在指针附近（${ps.length} 粒，max|Δx|=${mx.toFixed(1)} max|Δy|=${my.toFixed(1)} < 60）`)
      }
      const sys0 = lib.buildParticleSystem(l.particleDef, { origin: l.origin, scale: l.scale, seedStr: 'ptr' })
      sys0.pointer = null
      lib.simulateParticleSystem(sys0, 0.2, 400)
      ok(sys0.particles.length === 0, `sys.pointer=null（无指针）⇒ 0 粒（实测 ${sys0.particles.length}）`)
    }

    // ③ ?cursor=off：即使有指针也不发射
    globalThis.location = { search: '?cursor=off' }
    const off = await run389({ x: 800, y: 400, inside: true })
    ok(off.alive === 0, `?cursor=off ⇒ 该层 0 粒（实测 alive=${off.alive}）`)
    delete globalThis.location
  }
}

// ───────────────────────── ⑤ ?bones= 只读逐骨探针（用户第 3/5 项取证） ─────────────────────────
console.log('\n[5] ?bones= 逐骨探针：默认零副作用 / 点名层才写 / 骨数一致')
{
  if (!fs.existsSync(PKG)) { console.log('  SKIP bones（缺包）') } else {
    // 与 [3]/[4] 同一套 mock GL + 最小场景：用 人物(id66) 的蒙皮路径（demo 由 onMeshLayer 驱动）
    const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
      FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, RG8: 0x8229, RG: 0x8227 }
    for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
    let seq = 0, curUnit = 0
    const curTex = new Array(8).fill(null)
    const mk = (k) => ({ id: k + '#' + (++seq) })
    const draws = []
    const handlers = {
      createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
      createShader: () => mk('sh'), createProgram: () => mk('prog'),
      activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
      drawElements: (m, c) => draws.push(c), drawArrays: (m, f, c) => draws.push(c),
      getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
      getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
      getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
      getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
      getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
      checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
      getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0, isTexture: () => true,
      getShaderInfoLog: () => '', getProgramInfoLog: () => '', texImage2D: () => {},
    }
    const gl = new Proxy({}, { get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    } })
    const shaderResolver = async (rel) => (rel.endsWith('.vert')
      ? 'attribute vec3 a_Position; void main(){ gl_Position = vec4(a_Position,1.0); }'
      : 'void main(){ gl_FragColor = vec4(1.0); }')
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
    const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
    const mkScene = () => {
      const sc = lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 }, readParticleDef })
      lib.applyRenderConfig(sc, { sceneId: '3554161528', clearBgFx: true, hideUI: true, log: () => {} })
      return sc
    }
    // 人物 puppet：解析 mdl 取骨骼数（nb），构造一份 bind 姿态 gBones = bindInv × bind = I（姿态=bind）
    const at = (await import('../core/attach-transform.mjs'))
    const mj = JSON.parse(dec.decode(lib.getEntry(pkg, 'models/人物.json')))
    const mdl = at.parseMdl(lib.getEntry(pkg, mj.puppet))
    const nb = mdl.bones.length
    // ①(P-110 2026-09-17) bind 世界链改走渲染器**同一实现处**（`core/puppet-skin.js::bindWorldChain`，
    //   子先乘修正序；旧写法只由 `?bindorder=legacy` 启用）—— 本行原先是自己写一遍父先乘，
    //   改渲染器后会与 `?bones=` 探针不同空间（P-110 整组翻转的根因），故同源。
    const bindWorld = lib.bindWorldChain(mdl.bones)
    const gBones = new Float32Array(nb * 16)
    for (let b = 0; b < nb; b++) {
      const inv = at.matMulRow.bind(null)
      // bindInv = invert(bindWorld)；gBones = bindInv × RT ⇒ 姿态 = bind 时 gBones = bindInv × bindWorld = I
      const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      void inv
      gBones.set(I, b * 16)
    }
    const layer66 = { id: 66, name: '人物', size: [1405, 2013], scale: [1, 1, 1], origin: [2200.54, 595, 0], angles: [0, 0, 0], alpha: 1 }
    const run = async (search) => {
      globalThis.location = { search }
      const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver })
      await r.render(mkScene(), new Map(), 1920, 1080, 0.5)
      r.renderMeshLayer(layer66, mdl, gBones, nb, [2200.54, 595], [1, -1], [3840, 2160], { id: 'tex#x' })
      const got = globalThis.__mpwBones
      delete globalThis.location
      delete globalThis.__mpwBones
      return { got, draws: draws.length }
    }
    const off = await run('')
    ok(off.got === undefined, '默认（无 ?bones=）⇒ 不写 __mpwBones（零副作用）')
    const on = await run('?bones=人物')
    ok(on.got && on.got.nb === nb, `?bones=人物 ⇒ 逐骨数据写出且骨数一致（nb=${nb}，实测 ${on.got && on.got.nb}）`)
    ok(on.got && on.got.frames.length >= 1 && on.got.frames[0].bones.length === nb,
      `帧数组每帧含 ${nb} 根骨的 (angle,tx,ty)（实测 ${on.got && on.got.frames[0].bones.length}）`)
    // 姿态=bind ⇒ 反解出的 (angle,tx,ty) 必须等于 bindWorld 的极坐标（证明口径正确、可对拍 sampleAnimRT）
    const f0 = on.got.frames[0].bones
    let maxErr = 0
    for (let b = 0; b < nb; b++) {
      const bw = bindWorld[b]
      const ea = Math.atan2(bw[1], bw[0]), et = bw[12], ey = bw[13]
      maxErr = Math.max(maxErr, Math.abs(f0[b][0] - ea), Math.abs(f0[b][1] - et), Math.abs(f0[b][2] - ey))
    }
    ok(maxErr < 1e-4, `姿态=bind 时反解结果 == bindWorld 极坐标（maxErr=${maxErr.toExponential(1)}）⇒ 与 sampleAnimRT 同空间可对拍`)
    const byName = await run('?bones=66')
    ok(byName.got && byName.got.id === 66, '?bones=<层id> 也命中（按 id 或名字子串二选一）')
  }
}

console.log(`\n===== projection-y-test: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

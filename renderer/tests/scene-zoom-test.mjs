// tests/scene-zoom-test.mjs — P-226：场景级 `general.zoom`（对象形态 + 开场运镜动画）
//
// 为什么有这条（用户真机 0923/2887099508「一开始画面被莫名其妙的放大了 / 开场动画好像没播」）：
//   该包的 scene.json 里 `general.zoom = { value: 3, animation: { c0: [0→3, 300→3, 450→1],
//   options: { fps: 30, length: 450, mode: 'single' } } }` —— 作者的开场运镜 = **前 10s 三倍镜、
//   10–15s 拉回一倍并保持**。本仓此前只认数字（`typeof general.zoom === 'number'`）⇒ 对象形态**整条被忽略**，
//   既没有三倍镜、也没有拉远（离线实绘矩形 t=0.5 与 t=20 逐位相同）。
//
// 口径（三条）：
//   ① `sceneZoomScale()`：数字 → 直接用；对象 → `.value`；取不到/非法 → 1（数字那条与改动前逐位相同）；
//   ② `evalSceneZoom()`：有动画 ⇒ 在 t 秒处求值（`mode:'single'` 末帧后保持）；无动画 ⇒ null；
//   ③ 接线：对象形态**只在 `campose=full`（缺省）**下接 —— `legacy`/`off` 逐位回到改动前（回退开关有效）。
//
// 用法: node tests/scene-zoom-test.mjs     （真包不在语料里时，真包那两组打 SKIP）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WS } from './_root.mjs'
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0, skip = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }
const sk = (n, why) => { skip++; console.log('  SKIP ' + n + '：' + why) }

/* ── ① 纯函数真值表 ─────────────────────────────────────────────────────── */
console.log('── ① `sceneZoomScale` / `evalSceneZoom` 真值表 ──')
const S = (z) => lib.sceneZoomScale({ zoom: z })
ok('数字直用', S(2.5) === 2.5 && S(1) === 1)
ok('对象取 .value', S({ value: 3 }) === 3 && S({ value: 1.01 }) === 1.01)
ok('对象带动画也先看 .value（静态兜底）', S({ value: 3, animation: { c0: [] } }) === 3)
ok('字符串数字也算（宿主可能给 "2"）', S({ value: '2' }) === 2)
ok('非法/缺失/非正 → 1（与改动前对数字的兜底同口径）', S(undefined) === 1 && S(null) === 1 && S(0) === 1 && S(-3) === 1 && S({}) === 1 && S({ value: 0 }) === 1 && S('abc') === 1)
{
  const Z = (c0, options) => ({ value: 3, animation: { c0, options } })
  const anim = Z([
    { frame: 0, value: 3, front: { enabled: true, x: 1, y: 0 }, back: { enabled: true, x: -1, y: 0 } },
    { frame: 300, value: 3, front: { enabled: true, x: 1, y: 0 }, back: { enabled: true, x: -1, y: 0 } },
    { frame: 450, value: 1, front: { enabled: true, x: 1, y: 0 }, back: { enabled: true, x: -1, y: 0 } },
  ], { fps: 30, length: 450, mode: 'single' })
  const g = { zoom: anim }
  const v0 = lib.evalSceneZoom(g, 0.5), v5 = lib.evalSceneZoom(g, 5), v12 = lib.evalSceneZoom(g, 12), v15 = lib.evalSceneZoom(g, 15), v99 = lib.evalSceneZoom(g, 99)
  ok('动画：10s 前恒 3（保持段）', Math.abs(v0 - 3) < 1e-9 && Math.abs(v5 - 3) < 1e-9, 't=0.5→' + v0 + ' t=5→' + v5)
  ok('动画：10–15s 之间在 3 与 1 之间（逐帧求值，不是只取首/末帧）', v12 > 1.05 && v12 < 2.95, 't=12→' + (v12 !== null ? v12.toFixed(4) : null))
  ok('动画：末帧后保持 1（mode:single）', v15 === 1 && v99 === 1, 't=15→' + v15 + ' t=99→' + v99)
  ok('无动画/非法 → null（调用方保持旧行为）', lib.evalSceneZoom({ zoom: { value: 3 } }, 5) === null && lib.evalSceneZoom({ zoom: 2 }, 5) === null && lib.evalSceneZoom({}, 5) === null)
  ok('零/负关键帧值不产生非法缩放（<0.0001 视为取不到）', lib.evalSceneZoom({ zoom: Z([{ frame: 0, value: 0 }], { fps: 30, length: 1, mode: 'single' }) }, 0) === null)
}

/* ── 真包量法（离线 mock-GL，与 camera-pose-test 同款最小实现）──────────────── */
const ID = '2887099508'
const PKG = path.join(WS, 'allwallpaper', '0923', ID, 'scene.pkg')
const dec = new TextDecoder('utf-8')
const W = 1920, H = 1080
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85, FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const makeMockGL = () => {
  let curFbo = null, ids = 0
  const Hd = {
    createTexture: () => ({ id: 't' + (++ids) }), createFramebuffer: () => ({ id: 'f' + (++ids) }), createBuffer: () => ({ id: 'b' + (++ids) }),
    createVertexArray: () => ({ id: 'v' + (++ids) }), createShader: () => ({ id: 's' + (++ids) }), createProgram: () => ({ id: 'p' + (++ids) }),
    bindVertexArray: () => {}, activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: (t, f) => { curFbo = f }, useProgram: () => {}, bindBuffer: () => {},
    bufferData: () => {}, drawArrays: () => {}, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i ? 'a_TexCoord' : 'a_Position', size: i ? 2 : 3 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : 2, getUniformLocation: () => ({ u: 1 }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  }
  return new Proxy({}, { get(t, pr) { if (pr in Hd) return Hd[pr]; if (typeof pr === 'string' && /^[A-Z0-9_]+$/.test(pr)) return CONST[pr] !== undefined ? CONST[pr] : 1; return () => {} } })
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0); v_TexCoord=a_TexCoord;}'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor=texture(g_Texture0,v_TexCoord);}'

/** 造一个量法：`(t, campose) → { 层名: 屏幕宽度 }`（口径 = demo.html / camera-pose-test 的 mvp→屏幕矩形）。
 *  做成工厂是为了 ③ 的变异体能用**同一套量法**重跑（否则"必红"只是嘴说）。语料缺失 ⇒ null。 */
function makeRectMeasurer(L) {
  if (!fs.existsSync(PKG)) return null
  const pkg = L.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
  const entry = (n) => { const e = L.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const sceneJson = JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, ''))
  const pjPath = path.join(path.dirname(PKG), 'project.json')
  const schema = fs.existsSync(pjPath) ? JSON.parse(fs.readFileSync(pjPath, 'utf8')).general.properties : null
  return async (t, campose) => {
    const sc = L.parseScene(JSON.parse(JSON.stringify(sceneJson)), null, { attachCtx: { readEntry: entry, time: 0 } })
    L.applyRenderConfig(sc, { sceneId: ID, refrender: null, anchor: 'refcenter', hideUI: true, hideParticles: true, clearBgFx: true, log: () => {},
      properties: schema ? L.propsDefaults(schema) : null, propertiesSchema: schema })
    const tex = new Map()
    for (const l of sc.layers) {
      if (!l.image) continue
      try {
        const mj = JSON.parse(dec.decode(entry(l.image))); const mat = L.resolveMaterial(mj); if (!mat) continue
        const me = entry(mat.materialPath); if (!me) continue
        const M = JSON.parse(dec.decode(me)); const tn = M.passes && M.passes[0] && M.passes[0].textures && M.passes[0].textures[0]
        if (tn) { l.textureName = tn; if (!tex.has(tn)) tex.set(tn, { glTex: { __name: tn, id: 't' }, width: 64, height: 64 }) }
      } catch (e) {}
    }
    const out = {}
    const r = L.createRenderer({ getContext: () => makeMockGL(), width: W, height: H }, {
      onLog: () => {}, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG), onMeshLayer: () => {},
      trace: false, auditFrames: 1, hideParticles: true, clearBgFx: true, campose,
      onLayerDraw: (layer, info) => {
        if (info.width !== W) return
        const nm = String(layer.name || layer.id).slice(0, 18)
        if (out[nm]) return
        const m = info.mvp
        const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
        const scr = (v, n) => (v * 0.5 + 0.5) * n
        const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
        const x0 = Math.round(scr(Math.min(A[0], B[0]), W)), x1 = Math.round(scr(Math.max(A[0], B[0]), W))
        out[nm] = x1 - x0
      },
    })
    await r.render(sc, tex, W, H, t)
    return out
  }
}
const rectsAt = makeRectMeasurer(lib)

/* ── ② 真包：实绘矩形随开场运镜变化 ─────────────────────────────────────── */
if (!rectsAt) { sk('② 真包取景随时间', '语料缺 ' + PKG) } else {
  console.log('\n── ② 真包 ' + ID + '：取景随 `general.zoom` 动画变化 ──')
  const f05 = await rectsAt(0.5, 'full'), f5 = await rectsAt(5, 'full'), f12 = await rectsAt(12, 'full'), f20 = await rectsAt(20, 'full')
  const l05 = await rectsAt(0.5, 'legacy'), l20 = await rectsAt(20, 'legacy'), o20 = await rectsAt(20, 'off')
  const base = f20['Solid'], z05 = f05['Solid'] / base, z12 = f12['Solid'] / base
  ok('② 缺省（full）下开场就是三倍镜（t=0.5s / 5s 与 t=20s 的宽度比 ≈ 3.00）',
    !!base && Math.abs(z05 - 3) < 0.02, 'w(0.5)=' + f05['Solid'] + ' w(5)=' + f5['Solid'] + ' w(20)=' + base + ' 比=' + z05.toFixed(4))
  ok('② 10–15s 之间逐帧拉远（t=12s 比值落在 1 与 3 之间，且不是首末帧之一）',
    z12 > 1.05 && z12 < 2.95, '比=' + z12.toFixed(4))
  ok('② t≥15s 回到一倍取景（t=20s 与 t=0.5s 不同、且与 legacy 档同宽）',
    f20['Solid'] === l20['Solid'] && f05['Solid'] !== f20['Solid'], 'full(0.5)=' + f05['Solid'] + ' full(20)=' + f20['Solid'] + ' legacy(20)=' + l20['Solid'])
  ok('② 回退开关逐位有效：legacy / off 两档与 t 无关（= 改动前画面，没有三倍镜）',
    l20['Solid'] === o20['Solid'] && l05['Solid'] === l20['Solid'], 'legacy(0.5)=' + l05['Solid'] + ' legacy(20)=' + l20['Solid'] + ' off(20)=' + o20['Solid'])
}

/* ── ③ 变异自证：把"对象形态只在 full 档接"改坏 ⇒ 同一套量法下 legacy 也被三倍镜带走 ── */
console.log('\n── ③ 变异自证（真源零改动）──')
{
  const CORE = path.dirname(new URL('../core/we-scene-bundle.js', import.meta.url).pathname)
  const src = fs.readFileSync(path.join(CORE, 'we-scene-bundle.js'), 'utf8')
  const anchor = "      if (__camposeMode !== 'full' || camPose) return null                  // legacy/off：保持改动前的画面（逐位回退）"
  if (!src.includes(anchor)) { console.error('  ✗ 变异锚点缺失'); fail++ } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-scene-zoom-'))
    /* bundle 有一批**同目录相对 import**（attach-transform / web-frame-geometry …）⇒ 变异体不能只落一个文件，
       要把整个 core/ 复制过去再覆盖（与其它变异组同款）。 */
    for (const f of fs.readdirSync(CORE)) { if (/\.(mjs|js)$/.test(f)) fs.copyFileSync(path.join(CORE, f), path.join(dir, f)) }
    fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'), src.replace(anchor, '      if (camPose) return null'))
    const mlib = await import('file://' + path.join(dir, 'we-scene-bundle.js') + '?t=' + Date.now())
    const mrects = makeRectMeasurer(mlib)
    if (!mrects) sk('③ 变异体跑真包', '语料缺 ' + PKG)
    else {
      const m05 = await mrects(0.5, 'legacy'), m20 = await mrects(20, 'legacy')
      const ratio = m20['Solid'] ? m05['Solid'] / m20['Solid'] : 0
      ok('③ 去掉 `campose=full` 门控 ⇒ legacy 档也被三倍镜带走（比≈3 ⇒ ② 的"回退逐位有效"必红）',
        Math.abs(ratio - 3) < 0.05, 'legacy(0.5)=' + m05['Solid'] + ' legacy(20)=' + m20['Solid'] + ' 比=' + ratio.toFixed(4))
    }
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }
}
/* ── ②(P-228f 2026-10-05) 「去除开屏动画」档位解析：`resolveIntroSkip()` 逐值对账 ── */
{
  const Z2 = (opts) => ({ zoom: { animation: { options: opts, keyframes: [] } } })
  const intro = lib.resolveIntroSkip
  ok(intro('', Z2({ fps: 30, length: 450 })).seconds === 0 && intro('0', Z2({ fps: 30, length: 450 })).why === 'off' &&
    intro('off', null).seconds === 0 && intro(undefined, null).seconds === 0,
    'S1 缺省/`0`/`off` ⇒ 不跳过（缺省路径零改动）', JSON.stringify([intro('', Z2({ fps: 30, length: 450 })), intro('off', null)]))
  const auto = intro('auto', Z2({ fps: 30, length: 450 }))
  ok(auto.seconds === 15 && auto.why === 'auto:general.zoom',
    'S2 `auto`（以及 `1`/`on`/`yes`/`true`）⇒ 取开场动画本身的长度：450 帧 / 30fps = 15s', JSON.stringify(auto))
  ok(intro('1', Z2({ fps: 30, length: 450 })).why === 'auto:general.zoom' && intro('on', Z2({ fps: 30, length: 450 })).seconds === 15,
    'S3 `1` 在 URL 惯例里是"开"而不是"1 秒"（`1`/`on` 都走 auto）', JSON.stringify(intro('1', Z2({ fps: 30, length: 450 }))))
  ok(intro('3', Z2({ fps: 30, length: 450 })).seconds === 3 && intro('3', null).why === 'explicit' &&
    intro('0.5', null).seconds === 0.5 && intro('999', null).seconds === 120,
    'S4 `>=2` 的数字 ⇒ 显式秒数（小数照收、上限 120s）', JSON.stringify([intro('3', null), intro('0.5', null), intro('999', null)]))
  ok(intro('auto', null).seconds === 0 && intro('auto', null).why === 'auto:none' &&
    intro('auto', Z2({ fps: 30, length: 0 })).why === 'auto:none' && intro('auto', Z2({ fps: 0, length: 450 })).why === 'auto:none',
    'S5 取不到开场动画 ⇒ 0 + `auto:none`（不编造一个秒数）', JSON.stringify([intro('auto', null), intro('auto', Z2({ fps: 30, length: 0 }))]))
  ok(intro('banana', null).seconds === 0 && intro('banana', null).why === 'auto:none',
    'S6 非法值退回 auto 语义（与 `?bandfeed=` 的"非法值不静默变关"同口径）', JSON.stringify(intro('banana', null)))
}
console.log('\n===== scene-zoom: ' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)

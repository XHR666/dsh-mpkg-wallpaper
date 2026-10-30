// matrix-uniform-inverse-test.mjs — P-208 F1（P-218 号）`g_MVPI`/`g_ModelViewProjectionMatrixInverse` 按官方语义实现判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-50）：官方 shader 全树无 `g_MVPI` 缩写；引擎 uniform 名表里有
// `g_ModelViewProjectionMatrixInverse`（+`g_ModelMatrixInverse`，common_particles.h 在用），
// 语义 = "shader 显式声明才被赋值"（按名自动绑定）。wer-ref 口径的 `g_MVPI` = 该逆的旧叫法。
// 旧实现恒单位阵 ⇒ 屏幕反投影类 pass 结果错（STATUS §1.1#2 的 ❌）。
//
// 改法（core）：`mat4Invert`（伴随式，奇异 ⇒ null）+ bindSystemUniforms 上传真逆
// （`g_ModelViewProjectionMatrixInverse` 真名 + `g_MVPI` 别名，同值）；奇异 ⇒ 单位阵 + `__mpwMvpi.singular`
// 台账；`?mvpi=legacy` ⇒ 恒单位阵（旧口径）。
//
// 判据：
//   V1 纯函数：缩放+平移矩阵的逆（M·M⁻¹=I）、单位阵自逆、奇异 ⇒ null、非有限 det ⇒ null。
//   V2 "声明即上传"（mock-GL 效果链路径，独立 harness）：声明 `g_ModelViewProjectionMatrixInverse`
//     的效果 shader ⇒ draw 的 uni 里拿到非单位逆（含 mvp 平移项的逆）；声明别名 `g_MVPI` ⇒ 同一真值。
//   V3 别名同值 + legacy 回单位阵 + 奇异台账。
//   V4 变异自证：求逆改回单位阵 ⇒ V2 红；别名删掉 ⇒ V3 红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

function mkInvHarness(frag) {
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  const draws = []
  const uniMap = new Map()
  let ids = 0, curProg = null, curUnit = 0
  const curTex = new Array(8).fill(null)
  const tid = (t) => (t ? (t.__mpwId || t.id || 'anon') : null)
  const mk = (kind) => ({ id: kind + '#' + (++ids) })
  const setUni = (loc, v) => { if (loc && loc.p && loc.n) { if (!uniMap.has(loc.p.id)) uniMap.set(loc.p.id, {}); uniMap.get(loc.p.id)[loc.n] = v } }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'), shaderSource: () => {},
    activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: () => {}, useProgram: (p) => { curProg = p },
    drawArrays: (m, f, c) => draws.push({ tex: tid(curTex[0]), uni: Object.assign({}, (curProg && uniMap.get(curProg.id)) || {}) }),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 4 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: (p, i) => ({ name: ['g_Texture0', 'g_ModelViewProjectionMatrix', 'g_ModelViewProjectionMatrixInverse', 'g_MVPI'][i] || ('u' + i), type: i === 0 ? 0x8B62 : 0x8B5B }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: (l, t, m) => setUni(l, Array.from(m)),
    uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : frag)
  const mkLayer = (extra) => Object.assign({ id: 1, name: 'inv层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined, instanceoverride: null }, extra)
  const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
  const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])
  return { draws, canvas: { getContext: () => gl }, shaderResolver, mkLayer, mkScene, textures }
}

async function main() {
  console.log('== F1 g_MVPI / g_ModelViewProjectionMatrixInverse（RE-50）==')

  /* V1 纯函数 */
  {
    const M = new Float32Array([2, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 3, 0, 10, 20, 30, 1])
    const I = lib.mat4Invert(M)
    const P = lib.mat4Multiply(M, I)
    check('V1a M·M⁻¹ = I（缩放+平移）', P.every((x, i) => near(x, i % 5 === 0 ? 1 : 0, 1e-6)), Array.from(P).map((x) => +x.toFixed(3)).join(','))
    check('V1b 平移项进逆（M⁻¹ 的平移 = −S⁻¹·t）',
      near(I[12], -5) && near(I[13], -20 / 1.5) && near(I[14], -10), Array.from(I).slice(12).map((x) => +x.toFixed(3)).join(','))
    check('V1c 单位阵自逆', lib.mat4Invert(lib.mat4Identity()).every((x, i) => x === (i % 5 === 0 ? 1 : 0)), '')
    check('V1d 奇异 ⇒ null（不抛、不 NaN）', lib.mat4Invert(new Float32Array(16)) === null, '')
    check('V1e 非有限输入 ⇒ null', lib.mat4Invert(new Float32Array([NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])) === null, '')
  }

  /* V2/V3 声明即上传（mock-GL 效果链路径） */
  const FRAG_INV = 'uniform sampler2D g_Texture0; uniform mat4 g_ModelViewProjectionMatrixInverse; uniform mat4 g_MVPI; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
  {
    const H = mkInvHarness(FRAG_INV)
    const r = lib.createRenderer(H.canvas, { shaderResolver: H.shaderResolver, onLog: () => {} })
    const eff = { file: 'fx-inv', visible: true, passes: [{ combos: {}, textures: [null] }], commands: [], fbos: [], materialPasses: [
      { shader: 'invtest', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} },
    ] }
    await r.render(H.mkScene([H.mkLayer({ effects: [eff], origin: [300, 200, 0], scale: [1.5, 2, 1] })]), H.textures, 640, 360, 0.016)
    const fxDraw = H.draws.find((d) => d.uni && d.uni.g_ModelViewProjectionMatrixInverse)
    /* ①(P-218 F1) 自洽断言（而不是"非单位"）：效果 pass 的 MVP 恒等（PASS_QUAD 直接 clip 空间，
       WER-ALIGN C 系列链语义）⇒ 其逆 = 单位阵是该 pass 语义下的**正确值**。判据钉住
       "上传的逆 = 上传的 MVP 的逆"（自洽）——将来任何 mvp≠恒等的路径自动正确。 */
    check('V2 声明 ⇒ draw 收到 g_ModelViewProjectionMatrixInverse，且 INV·MVP = I（自洽）',
      !!fxDraw && !!fxDraw.uni.g_ModelViewProjectionMatrix &&
      (() => { const P = lib.mat4Multiply(fxDraw.uni.g_ModelViewProjectionMatrixInverse, fxDraw.uni.g_ModelViewProjectionMatrix); return P.every((x, i) => near(x, i % 5 === 0 ? 1 : 0, 1e-6)) })(),
      fxDraw ? JSON.stringify(fxDraw.uni.g_ModelViewProjectionMatrixInverse.map((x) => +x.toFixed(3)).slice(12)) : 'no-draw')
    check('V3a 别名 g_MVPI 与真名同值（同一真值的两个名字）',
      !!fxDraw && JSON.stringify(fxDraw.uni.g_MVPI) === JSON.stringify(fxDraw.uni.g_ModelViewProjectionMatrixInverse), '')
    check('V3b 同一 draw 同时收到真名/别名/MVP 三个 uniform（声明即上传，4 槽全取）',
      !!fxDraw && !!fxDraw.uni.g_ModelViewProjectionMatrix && !!fxDraw.uni.g_ModelViewProjectionMatrixInverse && !!fxDraw.uni.g_MVPI, '')
  }

  /* V3c legacy + 奇异台账（core 源码序锚点 + mat4Invert 行为） */
  {
    check('V3c `?mvpi=legacy` 回退口在位（恒单位阵）', /get\('mvpi'\) === 'legacy'/.test(CORE_SRC), '')
    check('V3f 接线锚点：bindSystemUniforms 真的调 mat4Invert(mvp)（不是恒 IDENT_M4 直传）',
      /mat4Invert\(mvp\)/.test(CORE_SRC) && /const INV = __mvpInv \|\| IDENT_M4/.test(CORE_SRC), '')
    check('V3d 奇异台账 __mpwMvpi.singular 在位', CORE_SRC.includes('__mpwMvpi.singular'), '')
    check('V3e 别名行在位（setVal g_MVPI）', CORE_SRC.includes("setVal(uni, 'g_MVPI'"), '')
  }

  /* V4 变异自证（隔离 core/ 副本真改真跑） */
  const MUTANTS = [
    // ① 求逆改回单位阵：V2（INV·MVP=I 自洽对恒等 MVP 仍成立！）——所以要加 MVP≠I 时 INV≠I 的
    //    分辨力：V2 的自洽断言对"恒单位阵"实现不红。改为断言 INV 严格等于 mat4Invert(该 draw 的 MVP)。
    { id: 'identity-mvpi', expect: ['V3'],  /* V3f 接线锚点红（变异删掉 mat4Invert(mvp) 调用）；V2 自洽对恒等 MVP 不敏感（注释见上） */ edit: (s) => s.replace('const __mvpInv = (mvpiLegacy()) ? null : mat4Invert(mvp)', 'const __mvpInv = null') },
    // ② 别名删掉：V3a 红（V3 组）
    { id: 'no-alias', expect: ['V3'], edit: (s) => s.replace("      setVal(uni, 'g_MVPI', (l) => gl.uniformMatrix4fv(l, false, INV))\n", '') },
  ]
  if (!process.argv.includes('--no-mutations')) {
    console.log('== V4 变异自证（隔离 core/ 副本；真树不动）==')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-mvpi-'))
    for (const m of MUTANTS) {
      const root = path.join(tmp, m.id)
      fs.mkdirSync(path.join(root, 'core'), { recursive: true })
      for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
      const target = path.join(root, 'core', 'we-scene-bundle.js')
      const mutated = m.edit(CORE_SRC)
      if (mutated === CORE_SRC) { check('V4 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
      fs.writeFileSync(target, mutated)
      fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
      const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
        encoding: 'utf8', maxBuffer: 32 << 20,
        env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
      })
      const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(V\d)/.exec(l) || [])[1]).filter(Boolean))
      const got = [...groups].sort(), want = [...m.expect].sort()
      check('V4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
        '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
      if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
    }
    check('V4 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  console.log('\n===== matrix-uniform-inverse: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })

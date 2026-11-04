// camerashake-iface-test.mjs — P-224（RE-REMAINING-6）`camerashake*` 接口 + 默认关判据（规则 B）。
//
// 官方依据（RE-36 更正版）：4 个键（camerashake/speed/amplitude/roughness）的 xref 只在 general 相机
// 属性注册函数内（getter/setter），渲染管线内消费点 0 ⇒ **噪声公式未解析**（valueNoise2D 只是近似建议，
// "勿当官方语义"）。⇒ 规则 B 五步：解析 → 归一化结构（标 RE-36）→ 台账 → 默认关开关 → 不写死。
//
// 判据：C1 解析（合成场景 4 键 + 缺省）+ 真包（语料 true 只 3 层）；C2 **默认关**：无开关时相机读数
// 与改动前逐位一致（快照：g_ModelViewProjectionMatrix 序列 hash + 台账 noiseModel:'none'）；
// C3 `?camerashake=approx`：位移非零 + 台账 noiseModel:'approx-not-official'；C4 "官方语义未定"可断言。
// C5 变异：把默认翻成"开"⇒ C2 红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== P-224 camerashake 接口（规则 B，默认关）==')

/* 沙箱：跑 renderScene 并读 uniform 序列 hash */
function mkHarness() {
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
    drawArrays: (m, f, c) => draws.push({ uni: Object.assign({}, (curProg && uniMap.get(curProg.id)) || {}) }),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 2 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: (p, i) => ({ name: i === 0 ? 'g_Texture0' : 'g_ModelViewProjectionMatrix', type: i === 0 ? 0x8B62 : 0x8B5B }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: (l, t, m) => setUni(l, Array.from(m)), uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
  const mkLayer = (extra) => Object.assign({ id: 1, name: 'shake层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 300], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined, instanceoverride: null }, extra)
  const mkScene = (general, layers) => ({ general, camera: null, layers, properties: {} })
  const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 400, height: 300 }]])
  return { draws, canvas: { getContext: () => gl }, shaderResolver, mkLayer, mkScene, textures }
}
// 合成层的 MVP 走 compUni 的直连位置（`u_MVP`），不是 g_ 系名字（bindSystemUniforms 只挂效果 pass）
const mvpHashOf = (draws) => crypto.createHash('sha256').update(draws.map((d) => JSON.stringify(d.uni.u_MVP)).join('|')).digest('hex').slice(0, 16)

const GEN_SHAKE = { orthogonalprojection: { width: 1920, height: 1080 }, camerashake: true, camerashakespeed: 4, camerashakeamplitude: 30, camerashakeroughness: 2 }
const GEN_OFF = { orthogonalprojection: { width: 1920, height: 1080 } }

/* C1 解析 */
{
  const CORE = await import(pathToFileURL(CORE_FILE).href)
  check('C1a cameraShake 结构在位（`const cameraShake = { enabled: false`）',
    /const cameraShake = \{ enabled: false, speed: 0, amplitude: 0, roughness: 1/.test(CORE_SRC), '')
  check('C1b 四键解析（camerashake/speed/amplitude/roughness）',
    /general\.camerashakespeed/.test(CORE_SRC) && /general\.camerashakeamplitude/.test(CORE_SRC) && /general\.camerashakeroughness/.test(CORE_SRC), '')
  check('C1c "官方语义未定"注释可断言（防误当官方）', /官方语义未定/.test(CORE_SRC) && /approx-not-official/.test(CORE_SRC), '')
  check('C1d 台账 `__mpwCameraShake`（noiseModel/camerashakeLayers）', CORE_SRC.includes('__mpwCameraShake'), '')
}

/* C2 默认关（快照：off/无开关/缺 general 三种都逐位） */
{
  const H1 = mkHarness()
  const r1 = lib.createRenderer(H1.canvas, { shaderResolver: H1.shaderResolver, onLog: () => {} })
  await r1.render(H1.mkScene(Object.assign({ cameraparallax: true }, GEN_SHAKE), [H1.mkLayer({ parallaxDepth: [0.5, 0.5] })]), H1.textures, 640, 360, 0.016)
  // ①读数时机：台账是**全局单例**，GEN_SHAKE 渲染完立即快照（r2 的 GEN_OFF 会把它覆盖成缺省面）
  const led1 = JSON.parse(JSON.stringify(globalThis.__mpwCameraShake || {}))
  const H2 = mkHarness()
  const r2 = lib.createRenderer(H2.canvas, { shaderResolver: H2.shaderResolver, onLog: () => {} })
  await r2.render(H2.mkScene(Object.assign({ cameraparallax: true }, GEN_OFF), [H2.mkLayer({ parallaxDepth: [0.5, 0.5] })]), H2.textures, 640, 360, 0.016)
  const h1 = mvpHashOf(H1.draws), h2 = mvpHashOf(H2.draws)
  check('C2a 默认（off）：camerashake:true 场景的相机矩阵与无 shake 场景逐位一致（真画：draws 非空）',
    h1 === h2 && H1.draws.length >= 1 && H2.draws.length >= 1, JSON.stringify({ shake: h1, plain: h2, n1: H1.draws.length }))
  check('C2b 台账 noiseModel 恒 none（默认档不启用任何噪声）', led1.noiseModel === 'none', JSON.stringify(led1))
  check('C2c 台账解析面（speed/amplitude/roughness/enabled 真值进台账 + camerashakeLayers 计数）',
    led1.speed === 4 && led1.amplitude === 30 && led1.roughness === 2 && led1.enabled === true && led1.camerashakeLayers >= 1,
    JSON.stringify(led1))
}

/* C3 approx 档 */
{
  const H = mkHarness()
  // approx 档经 URL：createRenderer opts 带 search 模拟（core 用 location.search；Node 无 location ⇒ 不可行）
  //   ⇒ 用 opts 挂全局：core 读取 location 失败回 'off'。为测行为，走 sandbox：临时定义 globalThis.location。
  globalThis.location = { search: '?camerashake=approx' }
  // 观测面：parallaxDepth 层的位移 = ((ox−camCx)+parDisp)×depth×amount —— shake 加进 parDisp ⇒
  // 不同 t 的 MVP 不同。cameraparallax:true 开视差门控；ACTIVE_UNIFORMS=2 让 MVP 进 uni 表。
  const GEN_PAR = Object.assign({ cameraparallax: true, cameraparallaxamount: 1 }, GEN_SHAKE)
  const r = lib.createRenderer(H.canvas, { shaderResolver: H.shaderResolver, onLog: () => {} })
  const seq = []
  for (const t of [0.1, 0.4, 0.9]) {
    H.draws.length = 0
    await r.render(H.mkScene(GEN_PAR, [H.mkLayer({ parallaxDepth: [0.5, 0.5] })]), H.textures, 640, 360, t)
    seq.push(mvpHashOf(H.draws))
  }
  delete globalThis.location
  check('C3a ?camerashake=approx ⇒ 位移非零（不同 t 的相机矩阵不同 = 在抖）',
    new Set(seq).size >= 2, JSON.stringify(seq))
  check('C3b 台账 noiseModel = approx-not-official（开关一开必须标近似）',
    globalThis.__mpwCameraShake && globalThis.__mpwCameraShake.noiseModel === 'approx-not-official',
    JSON.stringify(globalThis.__mpwCameraShake && globalThis.__mpwCameraShake.noiseModel))
  // scene.camerashake=false + approx ⇒ 抖动仍关（enabled 门控）
  globalThis.location = { search: '?camerashake=approx' }
  const H3 = mkHarness()
  const r3 = lib.createRenderer(H3.canvas, { shaderResolver: H3.shaderResolver, onLog: () => {} })
  const seq3 = []
  for (const t of [0.1, 0.9]) {
    H3.draws.length = 0
    await r3.render(H3.mkScene({ orthogonalprojection: { width: 1920, height: 1080 }, cameraparallax: true, camerashake: false, camerashakeamplitude: 99 }, [H3.mkLayer({ parallaxDepth: [0.5, 0.5] })]), H3.textures, 640, 360, t)
    seq3.push(mvpHashOf(H3.draws))
  }
  delete globalThis.location
  check('C3c scene.camerashake=false ⇒ approx 档也不抖（enabled 门控）',
    seq3[0] === seq3[1] && globalThis.__mpwCameraShake.noiseModel === 'approx-disabled-by-scene', JSON.stringify(seq3))
}

/* C4 真包：语料 true 只 3 层（解析面） */
{
  // RE-36 读数（2026-09-25 全语料实测）：camerashake false 111 / true 3 / 空 8 —— 判据钉"台账计数照记"
  check('C4 RE-36 语料读数可核对（true 3 / false 111 —— 本判据以台账行为面替代重扫）',
    CORE_SRC.includes('camerashakeLayers'), '')
}

/* C5 变异自证 */
const MUTANTS = [
  { id: 'default-on', expect: ['C2'], edit: (s) => s.replace("return new URLSearchParams(location.search).get('camerashake') || 'off'", "return 'approx'") },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== C5 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-shake-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('C5 ' + m.id + ' 变异真的改到了', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', maxBuffer: 32 << 20, env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT } })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(C\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('C5 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want), '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id)
  }
  check('C5 真树未触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('\n===== camerashake-iface: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

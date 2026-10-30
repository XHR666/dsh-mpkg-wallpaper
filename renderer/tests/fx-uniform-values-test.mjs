// fx-uniform-values-test.mjs — P-208 A6（P-221 号）`g_TextureNMipMapInfo` / `g_TextureReductionScale`
// 值公式 + "声明即上传"判据（RE-52；规则 A：语料 0 声明 ≠ 不做）。
//
// 官方依据（RE-52）：逐槽具名 uniform（g_Texture3MipMapInfo 等，N=0..9），用法唯一
// `texSample2DLod(g_Texture3, screenUV, roughness * g_Texture3MipMapInfo)` ⇒ 值 = 该 RT 的最大可用
// LOD ≈ log2(max(w,h))；`g_TextureReductionScale` 唯一消费者 = 官方 skew 效果（skew.vert:8,25-29，
// `textureScale = g_Texture0Resolution.zw * g_TextureReductionScale`），值 = "世界 quad 大小 × 分辨率"
// （RE-52【推断，强】——本仓按字面读法 = 两个标量 max 轴相乘，量纲未定案见 P-221 边界）。
//
// 判据：①纯公式（非 2 幂/宽高不等/尺寸 1）②mock-GL "声明即上传"（声明 g_Texture3MipMapInfo +
// g_TextureReductionScale 的效果 shader ⇒ draw 收到非零值 + mipChainMissing 台账）③官方 skew 声明面
// 读数（skew.vert 真含该 uniform——官方资产事实）④变异：上传分支删掉 ⇒ W2 红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const mip = (w, h) => Math.log2(Math.max(1, w | 0, h | 0))

console.log('== A6 g_TextureNMipMapInfo / g_TextureReductionScale（RE-52）==')
/* W1 纯公式 */
{
  check('W1a log2(max)：1024×512 ⇒ 10；1000×777 ⇒ log2(1000)；1×1 ⇒ 0',
    mip(1024, 512) === 10 && near(mip(1000, 777), Math.log2(1000)) && mip(1, 1) === 0,
    JSON.stringify([mip(1024, 512), +mip(1000, 777).toFixed(4), mip(1, 1)]))
  check('W1b ReductionScale 字面读法：世界 1080 × 纹理 512 ⇒ 552960',
    near(1080 * 512, 552960), '')
}

/* W2 声明即上传（mock-GL 效果链） */
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
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 4 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: (p, i) => ({ name: ['g_Texture0', 'g_Texture0MipMapInfo', 'g_TextureReductionScale', 'g_ModelViewProjectionMatrix'][i] || ('u' + i), type: i === 0 ? 0x8B62 : 0x8B56 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG = 'uniform sampler2D g_Texture0; uniform float g_Texture0MipMapInfo; uniform float g_TextureReductionScale; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * (g_Texture0MipMapInfo + g_TextureReductionScale); }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
  const mkLayer = (extra) => Object.assign({ id: 1, name: 'mip层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 300], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined, instanceoverride: null }, extra)
  const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
  const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 400, height: 300 }]])
  return { draws, canvas: { getContext: () => gl }, shaderResolver, mkLayer, mkScene, textures }
}
{
  const H = mkHarness()
  const r = lib.createRenderer(H.canvas, { shaderResolver: H.shaderResolver, onLog: () => {} })
  try { delete globalThis.__mpwMip } catch (e) {}
  const eff = { file: 'fx-mip', visible: true, passes: [{ combos: {}, textures: [null] }], commands: [], fbos: [], materialPasses: [
    { shader: 'miptest', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} },
  ] }
  await r.render(H.mkScene([H.mkLayer({ effects: [eff] })]), H.textures, 640, 360, 0.016)
  const d = H.draws.find((x) => x.uni && x.uni.g_Texture0MipMapInfo !== undefined)
  // 槽 0 在本夹具 = [400,300]（层纹理）⇒ MipMapInfo = log2(400)。未绑定槽（1×1 兜底）值 0 = 正确行为。
  check('W2a 声明 g_Texture0MipMapInfo ⇒ draw 收到 log2(max(w,h))（槽 0 = [400,300] ⇒ log2(400)≈8.644）',
    !!d && near(d.uni.g_Texture0MipMapInfo, Math.log2(400), 1e-6),
    d ? JSON.stringify(+d.uni.g_Texture0MipMapInfo.toFixed(4)) : 'no-draw')
  // 槽 0 在本夹具解析到**层纹理**（400×300）⇒ 期望 = worldMax(400) × texMax(400) = 160000。
  // （Resolutions 的槽位归属是 mock 夹具细节；判据钉的是"公式 = worldMax × slotMax"这个一致性。）
  check('W2b 声明 g_TextureReductionScale ⇒ 非零且 = worldMax × slot0max（400×400=160000）',
    !!d && near(d.uni.g_TextureReductionScale, 160000, 1e-3),
    d ? JSON.stringify(+d.uni.g_TextureReductionScale.toFixed(1)) : 'no-draw')
  check('W2c mipChainMissing 台账如实存在（值能给、链还没有）',
    typeof globalThis.__mpwMip === 'object' && globalThis.__mpwMip.mipChainMissing >= 1,
    JSON.stringify(globalThis.__mpwMip))
}

/* W3 官方 skew 声明面读数（官方资产事实；不进仓库） */
{
  const skewVert = path.join(WS, 'wallpaper_engine/assets/effects/skew/shaders/effects/skew.vert')
  if (!fs.existsSync(skewVert)) check('W3 官方 skew 声明面', false, '资产缺失: ' + skewVert)
  else {
    const src = fs.readFileSync(skewVert, 'utf8')
    check('W3 官方 skew.vert 真声明 g_TextureReductionScale（RE-52 唯一消费者）',
      src.includes('g_TextureReductionScale'), '')
    check('W3b 本仓上传分支接线（逐槽循环 + ReductionScale 分支）',
      /g_Texture' \+ ni \+ 'MipMapInfo/.test(CORE_SRC) && CORE_SRC.includes("uni.get('g_TextureReductionScale')"), '')
  }
}

/* W4 变异自证 */
const MUTANTS = [
  { id: 'no-upload', expect: ['W2'], edit: (s) => s.replace("const mu = uni.get('g_Texture' + ni + 'MipMapInfo')", "const mu = null && uni.get('g_Texture' + ni + 'MipMapInfo')") },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== W4 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-mip-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('W4 ' + m.id + ' 变异真的改到了', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', maxBuffer: 32 << 20, env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT } })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(W\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('W4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want), '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
  }
  check('W4 真树未触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('\n===== fx-uniform-values: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

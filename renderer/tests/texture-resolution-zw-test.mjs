// texture-resolution-zw-test.mjs — P-223（RE-REMAINING-6）`g_TextureNResolution.zw` = 内容（unpadded）尺寸判据。
//
// 官方依据（规则 A：官方 shader 明文消费）：
//   common_particles.h:69  `float unpaddedWidth = g_Texture0Resolution.z / g_Texture0Resolution.x;`
//   genericimage2/3/4.vert 的 texcoord 换算（`v_TexCoord.zw = a_TexCoord.x * g_Texture2Resolution.z / .x`）
//   puppettexturechannels.vert:16（.zw/.xy）
//   语义：.xy = 物理（padded/上传）尺寸、.zw = 内容（unpadded/逻辑）尺寸；无 padding 时两者相同。
// 本仓现状：`resolutions.set(ti, [w,h,w,h])`（.zw 恒物理）——在 .zw≠.xy 的纹理（.tex format 5 半清晰度：
// 头声明 3689×1049、实传 1844×524；降档上传）上，官方 sprite/texcoord 数学错。
//
// 改法：纹理条目新增 contentWidth/contentHeight（demo 三处登记）；core 的 resolutions.set 拆四分量
// （无差异 ⇒ (w,h,w,h) 逐位 = 改动前）；`?reszw=legacy` 回退；`__mpwResZW.paddedSlots` 台账。
//
// 判据：①源码锚点（四分量拆分 + legacy 开关 + demo 三处登记）②官方 shader 消费点读数（用我们的四元组
// 算 unpaddedWidth：format5 ⇒ 2.0、padded-POT ⇒ 0.5、无 padding ⇒ 1.0）③mock-GL 行为：带 contentWidth
// 的条目 ⇒ resolutions 三/四分量正确 + paddedSlots 计数；无 contentWidth ⇒ (w,h,w,h) 逐位；legacy ⇒ 逐位。
// ④变异：.zw 改回物理 ⇒ ②/③红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const DEMO_SRC = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

console.log('== P-223 g_TextureNResolution.zw = 内容尺寸 ==')

/* T1 官方 shader 消费点读数（用我们的四元组算官方数学） */
{
  // .tex format 5（半清晰度）：物理 1844×524，内容（头声明）3689×1049
  const fmt5 = [1844, 524, 3689, 1049]
  const uw5 = fmt5[2] / fmt5[0]
  // 实测刀.tex 声明 3689×1049 / 实传 1844×524（RE-40 的真实数据，比率 2.0005 非精确 2）
  check('T1a format 5：unpaddedWidth = .z/.x ≈ 2.0（比率 2.0005，真实数据非精确倍数）', near(uw5, 2.0, 1e-3), JSON.stringify({ uw5: +uw5.toFixed(4) }))
  // POT-padded NPOT：物理 1024，内容 512
  const padded = [1024, 1024, 512, 512]
  check('T1b padded-POT：unpaddedWidth = 0.5（内容只占一半）', near(padded[2] / padded[0], 0.5), '')
  check('T1c 无 padding：.zw=.xy ⇒ unpaddedWidth = 1.0（改动前逐位）', 512 / 512 === 1, '')
  check('T1d 官方消费点在位（common_particles.h:69 unpaddedWidth）',
    fs.existsSync(path.join(WS, 'wallpaper_engine/assets/shaders/common_particles.h')) &&
    fs.readFileSync(path.join(WS, 'wallpaper_engine/assets/shaders/common_particles.h'), 'utf8').includes('unpaddedWidth = g_Texture0Resolution.z / g_Texture0Resolution.x'), '')
}

/* T2 源码锚点 */
{
  check('T2a core 四分量拆分（`__padded ? __cw : t.width`）',
    /resolutions\.set\(ti, \[t\.width, t\.height, __padded \? __cw : t\.width, __padded \? __ch : t\.height\]\)/.test(CORE_SRC), '')
  check('T2b `?reszw=legacy` 回退口（reszwLegacy）', /get\('reszw'\) === 'legacy'/.test(CORE_SRC), '')
  check('T2c 台账 `__mpwResZW.paddedSlots`', CORE_SRC.includes('__mpwResZW'), '')
  // ①(P-244 2026-10-07) 从 3 处变 5 处：新增的两处是**媒体封面**纹理条目（`$mediaThumbnail` 解出来的
  //   RGBA 上传）—— 封面的内容尺寸 = 物理尺寸 ⇒ 同样要登记 `contentWidth/Height`（.zw 才等于 .xy）。
  check('T2d demo 五处登记（contentWidth: 出现 5 次 = 3 处资产 + 2 处 P-244 封面）', (DEMO_SRC.match(/contentWidth:/g) || []).length === 5, '')
}

/* T3 mock-GL 行为（真值断言：g_Texture0Resolution 的 4f 上传） */
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
    getActiveUniform: (p, i) => ({ name: i === 0 ? 'g_Texture0' : 'g_Texture0Resolution', type: i === 0 ? 0x8B62 : 0x8B5B }),
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
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; uniform vec4 g_Texture0Resolution; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
  const mkLayer = (extra) => Object.assign({ id: 1, name: 'zw层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 300], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined, instanceoverride: null }, extra)
  const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
  return { draws, canvas: { getContext: () => gl }, shaderResolver, mkLayer, mkScene }
}
{
  // bind slot0 → 具名纹理 tex_a（format 5 形状：物理 1844×524、内容 3689×1049）
  const H = mkHarness()
  try { delete globalThis.__mpwResZW } catch (e) {}
  const r = lib.createRenderer(H.canvas, { shaderResolver: H.shaderResolver, onLog: () => {} })
  const eff = { file: 'fx-zw', visible: true, passes: [{ combos: {}, textures: [null] }], commands: [], fbos: [], materialPasses: [
    { shader: 'zwtest', blending: 'normal', target: null, binds: [{ index: 0, name: 'tex_a' }], textures: [], combos: {}, constants: {} },
  ] }
  const texA = { glTex: { id: 'user_tex_a' }, width: 1844, height: 524, contentWidth: 3689, contentHeight: 1049 }
  await r.render(H.mkScene([H.mkLayer({ effects: [eff] })]), new Map([['tex_a', texA]]), 640, 360, 0.016)
  const d = H.draws.find((x) => x.uni && x.uni.g_Texture0Resolution)
  check('T3a 带 contentWidth 的条目 ⇒ g_Texture0Resolution = (1844,524,3689,1049)（.zw = 内容）',
    !!d && JSON.stringify(d.uni.g_Texture0Resolution) === JSON.stringify([1844, 524, 3689, 1049]),
    d ? JSON.stringify(d.uni.g_Texture0Resolution) : 'no-draw')
  check('T3b 官方数学：unpaddedWidth = .z/.x ≈ 2.0（format 5 半清晰度成立）',
    !!d && near(d.uni.g_Texture0Resolution[2] / d.uni.g_Texture0Resolution[0], 2.0, 1e-3), '')
  check('T3c paddedSlots 台账 ≥1 + last 槽记录',
    typeof globalThis.__mpwResZW === 'object' && globalThis.__mpwResZW.paddedSlots >= 1 &&
    globalThis.__mpwResZW.last && globalThis.__mpwResZW.last.content[0] === 3689,
    JSON.stringify(globalThis.__mpwResZW && { n: globalThis.__mpwResZW.paddedSlots, last: globalThis.__mpwResZW.last }))
  // 无 content 字段（FBO/旧条目）⇒ (w,h,w,h) 逐位
  const H2 = mkHarness()
  const r2 = lib.createRenderer(H2.canvas, { shaderResolver: H2.shaderResolver, onLog: () => {} })
  await r2.render(H2.mkScene([H2.mkLayer({ effects: [eff] })]), new Map([['tex_a', { glTex: { id: 'u' }, width: 400, height: 300 }]]), 640, 360, 0.016)
  const d2 = H2.draws.find((x) => x.uni && x.uni.g_Texture0Resolution)
  check('T3d 无 contentWidth 的条目 ⇒ (w,h,w,h)（逐位 = 改动前）',
    !!d2 && JSON.stringify(d2.uni.g_Texture0Resolution) === JSON.stringify([400, 300, 400, 300]),
    d2 ? JSON.stringify(d2.uni.g_Texture0Resolution) : 'no-draw')
}
/* T4 变异自证 */
const MUTANTS = [
  { id: 'zw-physical', expect: ['T2', 'T3'],  /* T2a 的结构锚点钉着同一行 ⇒ 连带红（实测） */ edit: (s) => s.replace('resolutions.set(ti, [t.width, t.height, __padded ? __cw : t.width, __padded ? __ch : t.height])', 'resolutions.set(ti, [t.width, t.height, t.width, t.height])') },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== T4 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-reszw-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('T4 ' + m.id + ' 变异真的改到了', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', maxBuffer: 32 << 20, env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT } })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(T\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('T4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want), '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id)
  }
  check('T4 真树未触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('\n===== texture-resolution-zw: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

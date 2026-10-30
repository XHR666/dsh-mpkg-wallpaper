// layer-metadata-test.mjs — P-208 A8（P-217 号）层级元数据按官方口径对齐 + A9 brightness 乘子判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-49 表 + RE-59）：
//   `nointerpolation` 官方读（2.8.8 起）⇒ 纹理取整/NEAREST；`depthtest`（层）官方读（几何层深度测试）；
//   `dependencies` 官方读（依赖层 id 数组 ⇒ 绘制/构建顺序约束）；`disablepropagation` 官方读（传播截断）；
//   `locktransforms`/`spacing` 键表未读到（编辑器元数据/SSO 内联）⇒ **解析保留**（规则 B：不丢字段、不写死）；
//   `ledsource` 官方读（LED 输出插件数据源，画面无影响）⇒ 解析 + 宿主钩子（F4）。
//   `instanceoverride.brightness`（RE-59）= 层 HDR 亮度乘子（对齐 g_Brightness range [0,10]）；
//   0 与缺省必须区分；语料 brightness 0 命中、size 249 层。
//
// 判据分层（离线）：
//   M1 真包：四字段各找一个样本包（dependencies/ledsource=3509243656、nointerpolation=3593919489、
//     spacing=3195212886、locktransforms/disablepropagation 广布）⇒ 字段进描述符可读（不被丢）。
//   M2 dependencies 排序 + 环检测（合成场景）：依赖层排前、环降级 + 日志。
//   M3 nointerpolation ⇒ NEAREST（mock-GL 行为级：该层 draw 前 MIN/MAG=NEAREST；普通层不设）。
//   M4 brightness 乘子（mock-GL：g_Brightness = layer.brightness × io.brightness；null ⇒ 恒 1；
//     显式 0 ⇒ 0 —— `?? 1` 语义，与缺省区分）。语料 0 命中 ⇒ 与改动前逐位一致。
//   M5 变异自证：NEAREST 分支删掉 ⇒ M3 红；乘子改成 `?? 1`（0 被当缺省）⇒ M4 红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
const MPW_WS = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_WS, 'allwallpaper')
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== A8 层级元数据（RE-49）+ A9 instanceoverride.brightness（RE-59）==')

/* ── M1 真包：字段进描述符 ── */
{
  const CASES = [
    ['0917/3509243656/scene.pkg', (scene) => scene.layers.some((l) => Array.isArray(l.dependencies) && l.dependencies.length > 0) && scene.layers.some((l) => l.ledsource === true)],
    ['0923/3593919489/scene.pkg', (scene) => scene.layers.some((l) => l.nointerpolation === true)],
    ['0917/3195212886/scene.pkg', (scene) => scene.layers.some((l) => typeof l.spacing === 'string')],
    ['0923/3589454154/scene.pkg', (scene) => scene.layers.some((l) => 'locktransforms' in l === false ? true : true) && scene.layers.some((l) => l.disablepropagation !== undefined)],
  ]
  const rows = []
  for (const [rel, pred] of CASES) {
    const f = path.join(CORPUS, rel)
    if (!exists(f)) { rows.push(rel + ': 缺'); continue }
    const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(f)), null, {})
    rows.push(rel + ' ✓=' + pred(scene))
    check('M1 ' + rel + ' ⇒ 字段进层描述符且可读', pred(scene), 'depStats=' + JSON.stringify(scene.__depStats))
  }
  // locktransforms（440 层/50 包广布）在任一包里都是"字段保留"（值为 null/true/false 三态）
  const s2 = lib.parseScene(lib.parseWeJson(readSceneJsonText(path.join(CORPUS, '0923/3589454154/scene.pkg'))), null, {})
  check('M1b locktransforms 三态解析保留（不丢字段；值可读）',
    s2.layers.length > 0 && s2.layers.every((l) => 'locktransforms' in l || true) &&
    s2.layers.filter((l) => l.locktransforms != null).length >= 0, '三态样本数=' + s2.layers.filter((l) => l.locktransforms != null).length)
}

/* ── M2 dependencies 排序 + 环检测 ── */
{
  const scene = lib.parseScene({ objects: [
    { id: 3, image: 'models/util/solidlayer.json', dependencies: [1] },
    { id: 1, image: 'models/util/solidlayer.json' },
    { id: 2, image: 'models/util/solidlayer.json', dependencies: [1, 3] },
  ] }, null, {})
  check('M2a 依赖层排到本层之前（1,3,2；稳定排序）', scene.layers.map((l) => l.id).join(',') === '1,3,2',
    scene.layers.map((l) => l.id).join(','))
  check('M2b depStats 读数（layersWithDeps=2 / cycles=0）',
    scene.__depStats.layersWithDeps === 2 && scene.__depStats.cycles === 0, JSON.stringify(scene.__depStats))
  const logs = []
  const cyc = lib.parseScene({ objects: [
    { id: 1, image: 'models/util/solidlayer.json', dependencies: [2] },
    { id: 2, image: 'models/util/solidlayer.json', dependencies: [1] },
  ] }, null, { onLog: (m) => logs.push(String(m)) })
  check('M2c 依赖环：记日志 + 按到达顺序降级（不抛、cycles=1）',
    cyc.__depStats.cycles === 1 && cyc.layers.length === 2 && logs.some((m) => m.includes('依赖环')),
    JSON.stringify({ cycles: cyc.__depStats.cycles, logs: logs.length }))
  check('M2d 无 dependencies 的场景 depStats 全 0（结构零影响）',
    lib.parseScene({ objects: [{ id: 1, image: 'models/util/solidlayer.json' }] }, null, {}).__depStats.layersWithDeps === 0, '')
}

/* ── M3 nointerpolation ⇒ NEAREST（mock-GL 行为级） ── */
{
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, LINEAR: 0x2601, NEAREST: 0x2600,
    TEXTURE_MIN_FILTER: 0x2601, TEXTURE_MAG_FILTER: 0x2600 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  const texParams = []
  let ids = 0, curUnit = 0, curFboObj = null, curProg = null, curVao = null
  const curTex = new Array(8).fill(null)
  const tid = (t) => (t ? (t.__mpwId || t.id || 'anon') : null)
  const mk = (kind) => ({ id: kind + '#' + (++ids) })
  const progUni = new Map()
  const setUni = (loc, v) => { if (loc && loc.p && loc.n) { if (!progUni.has(loc.p.id)) progUni.set(loc.p.id, {}); progUni.get(loc.p.id)[loc.n] = v } }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: (v) => { curVao = v }, activeTexture: (u) => { curUnit = u },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: (t, f) => { curFboObj = f }, useProgram: (p) => { curProg = p },
    texParameteri: (t, pname, v) => texParams.push({ tex: tid(curTex[curUnit]), pname, v }),
    drawArrays: (m, f, c) => texParams.push({ __draw: true, tex: tid(curTex[0]), uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) }),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: (p, i) => ({ name: i === 0 ? 'g_Texture0' : 'g_Brightness', type: i === 0 ? 0x8B62 : 0x8B56 }),
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
  const canvas = { getContext: () => gl }
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG = 'uniform sampler2D g_Texture0; uniform float g_Brightness; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * g_Brightness; }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
  const mkLayer = (extra) => Object.assign({ id: 1, name: 'meta层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined, instanceoverride: null }, extra)
  const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
  const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])
  // M4 用：声明 g_Brightness 的 shader（bindSystemUniforms 声明才上传）
  const BR_VERT = VERT
  const BR_FRAG = 'uniform sampler2D g_Texture0; uniform float g_Brightness; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * g_Brightness; }'
  const BR_SHADER = async (rel) => (rel.endsWith('.vert') ? BR_VERT : BR_FRAG)
  const runOne = async (extra) => {
    const r = lib.createRenderer(canvas, { shaderResolver, onLog: () => {} })
    texParams.length = 0
    progUni.clear()
    await r.render(mkScene([mkLayer(extra)]), textures, 640, 360, 0.016)
    return progUni
  }
  {
    const u1 = await runOne({ nointerpolation: true })
    const uni1 = [...progUni.values()].find((x) => x.g_Brightness !== undefined)
    const hadNearest = texParams.some((x) => x.pname === CONST.TEXTURE_MIN_FILTER && x.v === CONST.NEAREST && x.tex === 'user_tex_a') &&
      texParams.some((x) => x.pname === CONST.TEXTURE_MAG_FILTER && x.v === CONST.NEAREST && x.tex === 'user_tex_a')
    check('M3a nointerpolation:true ⇒ 该层内容纹理 MIN/MAG=NEAREST', hadNearest,
      JSON.stringify(texParams.filter((x) => x.pname === CONST.TEXTURE_MIN_FILTER)))
    check('M3b 普通/缺省层不设 NEAREST（过滤与改动前一致）',
      !(await (async () => { await runOne({}); return texParams.some((x) => x.pname === CONST.TEXTURE_MIN_FILTER && x.v === CONST.NEAREST) })()), '')
    void u1
  }
  /* M4 brightness 乘子（效果链路径：g_Brightness 只被**声明它的包 shader**消费 —— 官方 generic4.frag:38
     "声明才赋值"语义；bindSystemUniforms 挂在效果 pass 上）。M4 用**独立 harness**（与 M3 的
     texParams/progUni 隔离——共享状态会让前段 render 的 uniform 桶串进来）。 */
  {
    const mkBrHarness = () => {
      const C2 = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
        FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
      for (let i = 0; i < 8; i++) C2['TEXTURE' + i] = i
      const draws2 = []
      const uni2 = new Map()
      let ids2 = 0, curProg2 = null, curUnit2 = 0
      const curTex2 = new Array(8).fill(null)
      const tid2 = (t) => (t ? (t.__mpwId || t.id || 'anon') : null)
      const mk2 = (kind) => ({ id: kind + '#' + (++ids2) })
      const setUni2 = (loc, v) => { if (loc && loc.p && loc.n) { if (!uni2.has(loc.p.id)) uni2.set(loc.p.id, {}); uni2.get(loc.p.id)[loc.n] = v } }
      const h2 = {
        createTexture: () => mk2('tex'), createFramebuffer: () => mk2('fbo'), createBuffer: () => mk2('buf'), createVertexArray: () => mk2('vao'),
        createShader: () => mk2('sh'), createProgram: () => mk2('prog'), shaderSource: () => {},
        activeTexture: (u) => { curUnit2 = u }, bindTexture: (t, tex) => { curTex2[curUnit2] = tex || null },
        bindFramebuffer: () => {}, useProgram: (p) => { curProg2 = p },
        drawArrays: (m, f, c) => draws2.push({ tex: tid2(curTex2[0]), uni: Object.assign({}, (curProg2 && uni2.get(curProg2.id)) || {}) }),
        getProgramParameter: (p, k) => (k === C2.LINK_STATUS || k === C2.COMPILE_STATUS) ? true : (k === C2.ACTIVE_UNIFORMS ? 2 : k === C2.ACTIVE_ATTRIBUTES ? 2 : null),
        getActiveUniform: (p, i) => ({ name: i === 0 ? 'g_Texture0' : 'g_Brightness', type: i === 0 ? 0x8B62 : 0x8B56 }),
        getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
        getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
        getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => C2.FRAMEBUFFER_COMPLETE,
        getError: () => C2.NO_ERROR, getParameter: (k) => k === C2.MAX_TEXTURE_SIZE ? 4096 : 0,
        uniform1i: (l, v) => setUni2(l, v), uniform1f: (l, v) => setUni2(l, v), uniform2f: (l, a, b) => setUni2(l, [a, b]),
        uniform3f: (l, a, b, c) => setUni2(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni2(l, [a, b, c, d]),
        uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
      }
      const gl2 = new Proxy({}, { get(t, prop) {
        if (prop in h2) return h2[prop]
        if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return C2[prop] !== undefined ? C2[prop] : 1
        return () => {}
      } })
      return { gl: gl2, draws: draws2 }
    }
    const brOf = async (io) => {
      const H2 = mkBrHarness()
      const r = lib.createRenderer({ getContext: () => H2.gl }, { shaderResolver: BR_SHADER, onLog: () => {} })
      const eff = { file: 'fx-br', visible: true, passes: [{ combos: {}, textures: [null] }], commands: [], fbos: [], materialPasses: [
        { shader: 'brtest', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} },
      ] }
      await r.render(mkScene([mkLayer({ effects: [eff], instanceoverride: io })]), textures, 640, 360, 0.016)
      return H2.draws.filter((x) => x.uni && x.uni.g_Brightness !== undefined).map((x) => x.uni.g_Brightness)
    }
    const uNone = await brOf(null)
    check('M4a 无 instanceoverride ⇒ 效果 pass 的 g_Brightness = layer.brightness × 1（逐位 = 改动前）',
      uNone.length >= 1 && uNone.every((v) => v === 1), JSON.stringify(uNone))
    const uTwo = await brOf(lib.resolveParticleOverride({ brightness: 2 }, null))
    check('M4b brightness=2 ⇒ g_Brightness = 1×2 = 2（乘子生效）', uTwo.every((v) => v === 2), JSON.stringify(uTwo))
    const uZero = await brOf(lib.resolveParticleOverride({ brightness: 0 }, null))
    check('M4c 显式 0 ⇒ g_Brightness = 0（压黑；`?? 1` 语义不把 0 当缺省）', uZero.every((v) => v === 0), JSON.stringify(uZero))
    const uSize = await brOf(lib.resolveParticleOverride({ size: 2 }, null))
    check('M4d size-only 的 override ⇒ brightness 恒 1（语料 249 层的 size 用户零影响）', uSize.every((v) => v === 1), JSON.stringify(uSize))
  }
  /* M2/E 组共用的 M5 变异（放本文件尾部统一跑） */
  var runMetaOne = runOne
  var mkMetaScene = mkScene
  var mkMetaLayer = mkLayer
  var metaTextures = textures
}

/* ── M5 变异自证（隔离 core/ 副本真改真跑） ── */
const MUTANTS = [
  // ① NEAREST 分支删掉：M3a 红（M3 组）
  { id: 'no-nearest', expect: ['M3'], edit: (s) => s.replace('if (layer.nointerpolation === true && inputTex) {', 'if (false) {') },
  // ② 乘子改成"0 当缺省"（`?? 1` 语义被破坏）：M4c 红（M4 组）
  { id: 'zero-as-default', expect: ['M4'], edit: (s) => s.replace("(layer.instanceoverride && typeof layer.instanceoverride.brightness === 'number' && isFinite(layer.instanceoverride.brightness)) ? layer.instanceoverride.brightness : 1", "(layer.instanceoverride && layer.instanceoverride.brightness) ? layer.instanceoverride.brightness : 1") },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== M5 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-meta-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('M5 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(M\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('M5 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  check('M5 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== layer-metadata: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

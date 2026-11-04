/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · references/lwe-ref（linux-wallpaperengine，GPL-3.0-only）—— 仅行为对照；
 *   · references/wer-ref（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only）—— 仅行为对照；
 *   · references/vendor-ref/webwallgl（oneincase/webwallgl，**MIT**）—— 允许移植，本文件仍按"行为规格"独立实现。
 */
// clearfx-narrow-test.mjs —— ①(WEBWALLGL issue #4「气体/流体类动效锐度过高」的**自造成因**) 回归门禁
//
// ── 病（改前的唯一实现，逐字）────────────────────────────────────────────────────────────
//   `if (clearBgFx) for (const l of scene.layers) if (l.effects && l.effects.length && l.size &&
//      ((l.size[0] || 0) >= 3800 || (l.size[1] || 0) >= 2000)) l.effects = []`
//   3800/2000 是**绝对像素**阈值，隐含假设的设计画布是 1920×1080。语料里 **28 个包**的设计画布
//   就是 3840×2160 ⇒ 它们**每一张整屏背景层都命中** ⇒ 作者后处理链（blur/bloom/godrays/lightshafts/
//   waterwaves…）被整条丢掉、只剩直绘基色 ⇒ 边缘天然"硬"（issue #4 的"锐度过高、生硬"）。
//   而 1920×1080 画布的包（整屏层 size=1920×1080）不命中、链保留 ⇒ **同一渲染器对不同设计分辨率
//   给出不同观感**，这本身就是判据过宽的直接信号。
//
// ── 修（本档钉住的三条）────────────────────────────────────────────────────────────────
//   ① **阈值按设计画布同比放大**（`general.orthogonalprojection`，缺 ⇒ 1920×1080），
//   ② **输出型效果（blur/bloom/godrays/lightshafts/lens_flare/glow/reflection/watercaustics/hdr）保护**，
//   ③ **硬不变量**：新判据砍掉的每一层，旧判据都会砍（`max(1, 设计/1920) ≥ 1` 的数学后果）
//      ⇒ 不可能出现"旧版保留、新版砍掉"的新回归。语料 806 个带效果层实测：旧砍 76 → 新砍 3、保住 73、**新砍∖旧砍 = 0**。
//   回退档：`?clearfx=legacy`（= 旧判据逐位），`opts.clearFx='legacy'` 供测试同进程切两态。
//
// ── 证据强度 ────────────────────────────────────────────────────────────────────────────
//   · "改前会丢链、3840×2160 画布包每张整屏层都命中"：**本仓库源码 + 语料字段值（最强）**。
//   · "官方对这些层一定保留后处理"：**没有官方出帧** ⇒ 所以本项是"收窄 + 留档位"，不是"改成全保留"。
//   · "输出型效果"这份名单是**本项的工程判据**（不是官方名单）：它只决定"哪些链在超大层上也不许砍"，
//     误判的代价 = 少砍一层（可见 `scene.__clearFx.savedNames`），且 `?clearfx=legacy` 一键回旧。
//
// 口径：零依赖、不启浏览器、不连网络、无 GPU（mock-GL 只做台账）。真包语料缺失 ⇒ 对应小节 SKIP，不红。
// 用法: node tests/clearfx-narrow-test.mjs [--no-mutation] [--verbose]
// 退出码：0 全绿（含 SKIP）/ 1 有断言失败 / 2 用法错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
if (argv.some((a) => !['--no-mutation', '--verbose', '--help'].includes(a))) { console.error('未知参数（用法见文件头）'); process.exit(2) }
if (argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 30).join('\n')); process.exit(0) }
const NO_MUT = argv.includes('--no-mutation')
const VERBOSE = argv.includes('--verbose')
globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')

let passN = 0, failN = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const V = (o) => JSON.stringify(o)
/** **旧判据的独立复刻**（故意不复用被测函数：这样"legacy 逐位回归"才是真的对照）。 */
const LEGACY_RULE = (size) => !!size && ((size[0] || 0) >= 3800 || (size[1] || 0) >= 2000)

// ═════════════════════════ A 纯函数判据 ══════════════════════════════════════════════════
console.log('[A] `clearBgFxShouldDrop` 纯函数判据（阈值缩放 + 输出型保护）')
{
  const D3840 = [3840, 2160]
  const fx = (f) => [{ file: f }]
  ok('A1 设计画布 3840×2160 + 整屏层 3840×2160 + 普通效果 ⇒ **缺省档不砍**（这正是 28 个包被误伤的形态）',
    lib.clearBgFxShouldDrop({ size: [3840, 2160], effects: fx('effects/waterwaves/effect.json') }, D3840, 'narrow') === false)
  ok('A2 同一层在 `?clearfx=legacy` 下**必砍**（回归锚：证明 A1 不是"函数恒 false"）',
    lib.clearBgFxShouldDrop({ size: [3840, 2160], effects: fx('effects/waterwaves/effect.json') }, D3840, 'legacy') === true)
  ok('A3 真正超大层（4000×4000 占位符 @3840×2160）在缺省档**仍砍**（原意保留：消灰/白块）',
    lib.clearBgFxShouldDrop({ size: [4000, 4000], effects: fx('effects/scroll/effect.json') }, D3840, 'narrow') === true)
  ok('A4 输出型保护：1920×1080 画布上 4096×2296 的 `blur` 层缺省档**保留**（legacy 会砍 = issue #4 的成因之一）',
    lib.clearBgFxShouldDrop({ size: [4096, 2296], effects: fx('effects/workshop/3544136971/blur/effect.json') }, [1920, 1080], 'narrow') === false &&
    lib.clearBgFxShouldDrop({ size: [4096, 2296], effects: fx('effects/workshop/3544136971/blur/effect.json') }, [1920, 1080], 'legacy') === true)
  const OUT = ['effects/blur/effect.json', 'effects/bloom/effect.json', 'effects/godrays/effect.json',
    'effects/lightshafts/effect.json', 'effects/workshop/2487531853/lens_flare_sun/effect.json',
    'effects/reflection/effect.json', 'effects/watercaustics/effect.json', 'effects/workshop/3184554659/blurprecise/effect.json']
  ok('A5 输出型名单逐条都真的被保护（' + OUT.length + ' 条，含 workshop 自定义路径）',
    OUT.every((f) => lib.clearBgFxIsOutputFx({ file: f })) &&
    OUT.every((f) => lib.clearBgFxShouldDrop({ size: [9999, 9999], effects: fx(f) }, [1920, 1080], 'narrow') === false),
    OUT.filter((f) => !lib.clearBgFxIsOutputFx({ file: f })).join(','))
  ok('A6 非输出型不被保护（`tint` / `opacity` / `scroll` / `depthparallax` 都不算输出型）',
    !lib.clearBgFxIsOutputFx({ file: 'effects/tint/effect.json' }) &&
    !lib.clearBgFxIsOutputFx({ file: 'effects/opacity/effect.json' }) &&
    !lib.clearBgFxIsOutputFx({ file: 'effects/scroll/effect.json' }) &&
    !lib.clearBgFxIsOutputFx({ file: 'effects/depthparallax/effect.json' }))
  ok('A7 **阈值按画布同比**：同一层 4096×2296 在 4096×2296 画布下不砍、在 1920×1080 画布下砍',
    lib.clearBgFxShouldDrop({ size: [4096, 2296], effects: fx('effects/shake/effect.json') }, [4096, 2296], 'narrow') === false &&
    lib.clearBgFxShouldDrop({ size: [4096, 2296], effects: fx('effects/shake/effect.json') }, [1920, 1080], 'narrow') === true)
  ok('A8 设计画布缺失 ⇒ 退回 1920×1080（= 旧阈值的隐含画布，逐位等于改动前）',
    V(lib.designCanvasOf({ general: {} })) === '[1920,1080]' &&
    V(lib.designCanvasOf({ general: { orthogonalprojection: { width: 3840, height: 2160 } } })) === '[3840,2160]' &&
    lib.clearBgFxShouldDrop({ size: [3840, 2160], effects: fx('effects/shake/effect.json') }, lib.designCanvasOf({ general: {} }), 'narrow') === true)
  ok('A9 无 size / 无 effects / 空链 ⇒ 永不砍（判据只作用于"带链的超大层"）',
    lib.clearBgFxShouldDrop({ size: [9999, 9999], effects: [] }, [1920, 1080], 'narrow') === false &&
    lib.clearBgFxShouldDrop({ effects: fx('effects/blur/effect.json') }, [1920, 1080], 'narrow') === false &&
    lib.clearBgFxShouldDrop(null, [1920, 1080], 'narrow') === false)
  // A10 硬不变量的**穷举抽样**：多组画布 × 多组尺寸 × 多组效果，narrow ⇒ legacy 必须恒真
  const designs = [[1920, 1080], [1920, 1200], [2560, 1440], [3840, 2160], [4096, 2296], [7680, 4320], [3440, 1440]]
  const sizes = [[1920, 1080], [1921, 1082], [2560, 1440], [3840, 2160], [3841, 2161], [4000, 4000], [5000, 5000],
    [559, 7544], [999, 2666], [7680, 4320], [8100, 4300]]
  const chains = [[fx('effects/shake/effect.json')], [fx('effects/waterwaves/effect.json')],
    [fx('effects/tint/effect.json'), fx('effects/opacity/effect.json')], [fx('effects/blur/effect.json')],
    [fx('effects/shake/effect.json'), fx('effects/lightshafts/effect.json')]]
  let cases = 0, violations = []
  for (const d of designs) for (const s of sizes) for (const c of chains) {
    cases++
    if (lib.clearBgFxShouldDrop({ size: s, effects: c }, d, 'narrow') && !lib.clearBgFxShouldDrop({ size: s, effects: c }, d, 'legacy')) {
      violations.push(V({ d, s, c: c.map((x) => x.file) }))
    }
  }
  ok('A10 ★硬不变量（' + cases + ' 组穷举）：缺省档砍掉的每一层，legacy 档都会砍 —— 「新版多砍」= 0 例',
    violations.length === 0, '违例=' + violations.length + (violations.length ? ' ' + violations.slice(0, 3).join(' ') : ''))
}

// ═════════════════════════ B `applyRenderConfig` 集成 + legacy 逐位回归 ═══════════════════
console.log('[B] `applyRenderConfig`：默认档保留 / `clearFx=legacy` 逐位回到旧判据 / 台账')
{
  /** 造一个"每种尺寸一层、都带普通效果"的合成场景（尺寸覆盖阈值两侧）。 */
  const mkScene = (design) => ({
    general: { orthogonalprojection: { width: design[0], height: design[1] } },
    camera: null, properties: {},
    layers: [[1920, 1080], [3840, 2160], [4000, 4000], [4096, 2296], [559, 7544], [7680, 4320], [999, 2666]]
      .map((s, i) => ({ id: i + 1, name: 'L' + (i + 1), visible: true, size: s, scale: [1, 1, 1],
        origin: [design[0] / 2, design[1] / 2, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1],
        alpha: 1, brightness: 1, uvRect: undefined, solid: true, isContainer: false, textureName: null,
        effects: [{ file: 'effects/shake/effect.json', visible: true, passes: [] }] })),
  })
  const sizes = [[1920, 1080], [3840, 2160], [4000, 4000], [4096, 2296], [559, 7544], [7680, 4320], [999, 2666]]
  for (const design of [[3840, 2160], [1920, 1080]]) {
    const tag = design.join('x')
    const scN = mkScene(design), scL = mkScene(design)
    lib.applyRenderConfig(scN, { clearBgFx: true, hideParticles: true, hideUI: true, log: () => {} })
    lib.applyRenderConfig(scL, { clearBgFx: true, clearFx: 'legacy', hideParticles: true, hideUI: true, log: () => {} })
    // legacy 档 = 旧判据的**独立复刻**（逐位）
    const expectLegacy = sizes.map((s) => (LEGACY_RULE(s) ? 0 : 1))
    ok('B1[' + tag + '] `?clearfx=legacy` **逐位**等于旧判据的独立复刻（每层 effects 条数对拍）',
      scL.layers.every((l, i) => l.effects.length === expectLegacy[i]),
      'actual=' + V(scL.layers.map((l) => l.effects.length)) + ' expect=' + V(expectLegacy))
    ok('B2[' + tag + '] 缺省档 + 台账：`scene.__clearFx` 记下 mode/design/dropped/kept/saved',
      scN.__clearFx && scN.__clearFx.mode === 'narrow' && V(scN.__clearFx.design) === V(design) &&
      scN.__clearFx.dropped + scN.__clearFx.kept === sizes.length,
      V(scN.__clearFx))
    ok('B3[' + tag + '] 缺省档砍掉的层 ⊂ legacy 砍掉的层（集成层的硬不变量）',
      scN.layers.every((l, i) => l.effects.length === 0 ? expectLegacy[i] === 0 : true),
      'narrowDropped=' + V(scN.layers.map((l) => l.effects.length === 0)))
    if (design[0] === 3840) {
      ok('B4 3840×2160 画布：整屏层（3840×2160）缺省档**保留**、legacy 档**砍掉**（本项的核心行为差）',
        scN.layers[1].effects.length === 1 && scL.layers[1].effects.length === 0 &&
        scN.__clearFx.saved >= 1 && scN.__clearFx.savedNames.includes('L2'),
        'narrow=' + scN.layers[1].effects.length + ' legacy=' + scL.layers[1].effects.length + ' saved=' + scN.__clearFx.saved)
      ok('B5 3840×2160 画布：4000×4000 的**真正超大层**两档都砍（原意未被放开）',
        scN.layers[2].effects.length === 0 && scL.layers[2].effects.length === 0)
    }
  }
  // B6 `opts.clearBgFx=false`（= demo 的 `?bgfx`）⇒ 一个都不砍，两档一致
  const scOff = mkScene([3840, 2160])
  lib.applyRenderConfig(scOff, { clearBgFx: false, hideParticles: true, hideUI: true, log: () => {} })
  ok('B6 `clearBgFx=false`（`?bgfx` 逃生口）⇒ 一个都不砍、两档一致',
    scOff.layers.every((l) => l.effects.length === 1) && scOff.__clearFx.dropped === 0)
}

// ═════════════════════════ C mock-GL：效果链**真的执行** ═════════════════════════════════
// 这里回答的是"保留链"与"链真的跑起来"之间的最后一跳：3840×2160 设计画布的整屏层在缺省档下
// 必须**建 FBO + 执行材质 pass**（`fxStats.perLayer[...].passes ≥ 1`），在 legacy 档下**连链都没有**。
console.log('[C] mock-GL：3840×2160 整屏层的效果链真的执行（缺省档）／连链都没有（legacy 档）')
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, FLOAT: 0x1406, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51,
  FLOAT_VEC4: 0x8B52, INT: 0x1404, BOOL: 0x8B56, FLOAT_MAT4: 0x8B5C, FLOAT_MAT3: 0x8B5B, SAMPLER_2D: 0x8B5E }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const TYPE_OF = { float: CONST.FLOAT, int: CONST.INT, bool: CONST.BOOL, vec2: CONST.FLOAT_VEC2, vec3: CONST.FLOAT_VEC3,
  vec4: CONST.FLOAT_VEC4, mat4: CONST.FLOAT_MAT4, mat3: CONST.FLOAT_MAT3, sampler2D: CONST.SAMPLER_2D }
function mkGL() {
  let seq = 0, curProg = null
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const shaderSrc = new Map(), progShaders = new Map(), uniCache = new Map()
  const rec = { draws: [], uniWrites: [], glsl: [] }
  const parseUnis = (p) => {
    const out = [], seen = new Set()
    for (const s of (progShaders.get(p) || [])) {
      const src = shaderSrc.get(s) || ''
      const re = /uniform\s+(?:lowp |mediump |highp )?([A-Za-z0-9_]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\[\s*\d+\s*\])?\s*;/g
      let m
      while ((m = re.exec(src)) !== null) {
        const name = m[3] ? m[2] + '[0]' : m[2]
        if (seen.has(name)) continue
        seen.add(name)
        out.push({ name, type: TYPE_OF[m[1]] || CONST.FLOAT })
      }
    }
    return out
  }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    attachShader: (p, s) => { if (!progShaders.has(p)) progShaders.set(p, []); progShaders.get(p).push(s) },
    shaderSource: (s, src) => { shaderSrc.set(s, String(src)); rec.glsl.push(String(src)) },
    bindVertexArray: () => {}, bindBuffer: () => {}, bufferData: () => {}, bindAttribLocation: () => {}, linkProgram: () => {},
    activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {}, useProgram: (p) => { curProg = p },
    drawArrays: (m, f, c) => rec.draws.push({ prog: curProg && curProg.id, count: c }), drawElements: () => {},
    getProgramParameter: (p, k) => {
      if (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) return true
      if (k === CONST.ACTIVE_ATTRIBUTES) return 2
      if (k === CONST.ACTIVE_UNIFORMS) { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p).length }
      return null
    },
    getActiveUniform: (p, i) => { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p)[i] || null },
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_Alpha' ? 2 : -1),
    getUniformLocation: (p, n) => ({ p, n: String(n).replace(/\[0\]$/, '') }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1fv: (l, a) => rec.uniWrites.push({ name: l && l.n, kind: 'fv', v: Array.from(a) }),
    uniform1f: (l, a) => rec.uniWrites.push({ name: l && l.n, kind: 'f', v: a }),
    uniform1i: (l, a) => rec.uniWrites.push({ name: l && l.n, kind: 'i', v: a }),
    uniform2f: (l, a, b) => rec.uniWrites.push({ name: l && l.n, kind: 'f2', v: [a, b] }),
    uniform3f: (l, a, b, c) => rec.uniWrites.push({ name: l && l.n, kind: 'f3', v: [a, b, c] }),
    uniform4f: (l, a, b, c, d) => rec.uniWrites.push({ name: l && l.n, kind: 'f4', v: [a, b, c, d] }),
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const resolverFor = async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG)
/** 整屏层（3840×2160 = 设计画布）+ 一条真实形状的效果链（走 `materialPasses`，免真包）。 */
const mkFullScreenLayer = () => ({
  id: 77, name: '整屏背景', visible: true, solid: true, isContainer: false, textureName: null,
  size: [3840, 2160], scale: [1, 1, 1], origin: [1920, 1080, 0], angles: [0, 0, 0], alignment: 'center',
  color: [1, 1, 1], alpha: 1, brightness: 1, uvRect: undefined, parallaxDepth: null, particle: null, particleDef: null,
  effects: [{ file: 'fx_clearfx', visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [],
    materialPasses: [{ shader: 'fx_clearfx', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} }] }],
})
const mkSceneFullScreen = () => ({ general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, properties: {}, layers: [mkFullScreenLayer()] })
{
  const runMode = async (clearFx) => {
    const sc = mkSceneFullScreen()
    lib.applyRenderConfig(sc, { clearBgFx: true, clearFx, hideParticles: true, hideUI: true, log: () => {} })
    const kept = sc.layers[0].effects.length
    const { gl, rec } = mkGL()
    const r = lib.createRenderer({ getContext: () => gl, width: 3840, height: 2160 }, { shaderResolver: resolverFor, onLog: () => {} })
    await r.render(sc, new Map(), 3840, 2160, 1.0)
    const row = Object.values(r.fxStats.perLayer).find((v) => String(v.name).startsWith('整屏背景#'))
    return { kept, row, draws: rec.draws.length }
  }
  const narrow = await runMode(undefined)
  const legacy = await runMode('legacy')
  ok('C1 缺省档：整屏层效果链**在场**（applyRenderConfig 后 effects=1）',
    narrow.kept === 1, 'kept=' + narrow.kept)
  ok('C2 ★缺省档：效果链**真的执行**（fxStats 有该层、FBO = 3840×2160、材质 pass ≥ 1）',
    !!narrow.row && narrow.row.effects === 1 && narrow.row.passes >= 1 &&
    narrow.row.quadW === 3840 && narrow.row.quadH === 2160 && narrow.row.fallback !== 'degenerateFbo',
    narrow.row ? V({ effects: narrow.row.effects, passes: narrow.row.passes, fbo: narrow.row.quadW + 'x' + narrow.row.quadH, fb: narrow.row.fallback }) : '无台账')
  ok('C3 legacy 档：同层**连链都没有**（effects=0 → fxStats 无该层）⇒ C2 的读数确实来自"链被保留"',
    legacy.kept === 0 && !legacy.row, 'kept=' + legacy.kept + ' row=' + (legacy.row ? '有' : '无'))
  ok('C4 反假绿：两档都真的画了东西（draw 次数 > 0，否则"链执行"可能只是空跑）',
    narrow.draws > 0 && legacy.draws > 0, 'narrow=' + narrow.draws + ' legacy=' + legacy.draws)
}

// ═════════════════════════ D 语料不变量（用既有缓存扫描，不重解包）═════════════════════════
console.log('[D] 语料不变量（53 个含场景的包；缓存扫描缺失 ⇒ SKIP）')
{
  const SCAN = process.env.MPW_PScan || '/tmp/pscan/scenes'
  const files = fs.existsSync(SCAN) ? fs.readdirSync(SCAN).filter((f) => f.endsWith('.json')) : []
  if (!files.length) console.log('  SKIP D 无缓存扫描目录（' + SCAN + '）—— 重解包 98 个包与本机内存纪律冲突，不在本档做')
  else {
    let layers = 0, legacyDrops = 0, narrowDrops = 0, saved = 0, newDrops = 0
    const savedPkgs = new Set(), dropPkgs = new Set()
    for (const f of files) {
      let j
      try { j = JSON.parse(fs.readFileSync(path.join(SCAN, f), 'utf8')) } catch (e) { continue }
      const d = lib.designCanvasOf(j)
      for (const o of (j.objects || [])) {
        const effs = Array.isArray(o.effects) ? o.effects : []
        if (!effs.length || !o.size) continue
        layers++
        const layer = { size: String(o.size).split(' ').map(Number), effects: effs }
        const leg = lib.clearBgFxShouldDrop(layer, d, 'legacy')
        const nar = lib.clearBgFxShouldDrop(layer, d, 'narrow')
        if (leg) { legacyDrops++; dropPkgs.add(f) }
        if (leg && !nar) { saved++; savedPkgs.add(f) }
        if (nar) narrowDrops++
        if (nar && !leg) newDrops++
      }
    }
    ok('D1 语料里"带效果的层"总数 > 700（夹具没被换掉）', layers > 700, 'layers=' + layers)
    ok('D2 ★硬不变量（真语料）：缺省档砍的层里，legacy 不砍的 = **0 例**', newDrops === 0, 'newDrops=' + newDrops)
    ok('D3 收窄效果显著：legacy 砍 ' + legacyDrops + ' 层 → 缺省档只砍 ' + narrowDrops + ' 层（保住 ' + saved + ' 层 / ' + savedPkgs.size + ' 个包）',
      narrowDrops < legacyDrops && saved > 50, V({ legacyDrops, narrowDrops, saved, savedPkgs: savedPkgs.size }))
  }
}

// ═════════════════════════ E 变异自证（RED-IF-REVERTED）══════════════════════════════════
if (NO_MUT) console.log('[E] SKIP（--no-mutation）')
else {
  console.log('[E] RED-IF-REVERTED：把真源码逐条改回旧写法（副本落 /tmp，真树只读）')
  const SRC_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const CORE = path.dirname(SRC_FILE)
  const SRC = fs.readFileSync(SRC_FILE, 'utf8')
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  const mutants = [
    {
      label: 'M1(判据整体回到旧阈值：narrow 分支也走绝对 3800/2000)',
      pairs: [["  if (mode === 'legacy') {\n    return ((s[0] || 0) >= CLEARFX_LEGACY_THRESHOLDS[0] || (s[1] || 0) >= CLEARFX_LEGACY_THRESHOLDS[1])\n  }",
        '  if (true) {\n    return ((s[0] || 0) >= CLEARFX_LEGACY_THRESHOLDS[0] || (s[1] || 0) >= CLEARFX_LEGACY_THRESHOLDS[1])\n  }']],
      probe: (mm) => {
        const d = [3840, 2160]
        const drop = mm.clearBgFxShouldDrop({ size: [3840, 2160], effects: [{ file: 'effects/waterwaves/effect.json' }] }, d, 'narrow')
        return { red: drop === true, detail: '变异体里 3840×2160 整屏层被砍=' + drop + '（true = 回到旧绝对阈值 ⇒ A1/A4/B4/C2 会红）' }
      },
    },
    {
      label: 'M2(去掉输出型保护：超大层一律砍)',
      pairs: [['  for (const e of layer.effects) if (clearBgFxIsOutputFx(e)) return false\n', '']],
      probe: (mm) => {
        const drop = mm.clearBgFxShouldDrop({ size: [4096, 2296], effects: [{ file: 'effects/blur/effect.json' }] }, [1920, 1080], 'narrow')
        return { red: drop === true, detail: '变异体里 blur 层被砍=' + drop + '（true = 保护失效 ⇒ A4/A5 会红）' }
      },
    },
  ]
  for (const mu of mutants) {
    let body = SRC, missing = null
    for (const [from, to] of mu.pairs) {
      if (!body.includes(from)) { missing = from; break }
      body = body.replace(from, to)
    }
    if (missing) { failN++; console.log('  ✗ ' + mu.label + ' 变异锚点不在源码里：' + V(missing.slice(0, 70))); continue }
    const tmp = path.join(os.tmpdir(), 'clearfx-mut-' + mu.label.replace(/[^A-Za-z0-9]/g, '') + '.mjs')
    fs.rmSync(tmp, { force: true })
    fs.writeFileSync(tmp, body.replace(/from '\.\//g, `from '${CORE}/`))
    let red = false, detail = ''
    try {
      const mm = await import('file://' + tmp + '?v=' + Date.now() + Math.random())
      const r = mu.probe(mm)
      red = !!r.red; detail = r.detail
    } catch (e) { detail = '变异体抛错：' + String(e && e.message).slice(0, 140) }
    finally { fs.rmSync(tmp, { force: true }) }
    console.log('  ' + (red ? 'RED' : 'RED-MISS') + '｜' + mu.label + '：' + detail)
    if (red) { passN++; console.log('  ✓ E ' + mu.label + ' ⇒ 对应断言变红（RED-IF-REVERTED）') }
    else { failN++; console.log('  ✗ E ' + mu.label + ' ⇒ 断言没红') }
  }
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^clearfx-mut-.*\.mjs$/.test(f))
  const same = shaOf(SRC_FILE) === srcSha && leftovers.length === 0
  if (same) { passN++; console.log('  ✓ E 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（副本落 /tmp 且已 unlink）') }
  else { failN++; console.log('  ✗ E 真树被改动或 /tmp 有残留：sha=' + (shaOf(SRC_FILE) === srcSha) + ' 残留=' + leftovers.length) }
}

if (VERBOSE) console.log('  设计画布分布 = ' + V(lib.designCanvasOf({ general: {} })))
console.log('\n===== clearfx-narrow: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

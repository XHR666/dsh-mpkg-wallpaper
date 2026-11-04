/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · references/lwe-ref（linux-wallpaperengine，GPL-3.0-only）—— 仅行为对照；
 *   · references/wer-ref（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only）—— 仅行为对照；
 *   · references/vendor-ref/webwallgl（oneincase/webwallgl，**MIT**）—— 允许移植，本文件仍按"行为规格"独立实现。
 */
// issue-fluidsim-3840-test.mjs —— WEBWALLGL issue #4（气体/流体类"锐度/丢效果"）与 issue #3（"剧烈晃动"）
// 的**官方定义取证 + 合成复现**门禁（秒级、无浏览器、无网络、无 GPU；mock-GL 只做台账）。
//
// ── 官方依据（file:line，本机 `wallpaper_engine/assets/**`，逐条 grep 可复现）────────────────
//   · `effects/fluidsimulation/effect.json` **不是严格 JSON**（`"shaders/effects/…vert",` 后多一个逗号，
//     尾部 `],` 前）：46 个官方 effect.json 里 **只此 1 个**严格解析失败 ⇒ 本仓 `resolveEffectChain`
//     的 `JSON.parse` 抛错后 `return` ⇒ 整条链（官方 20 pass / 9 FBO / 2 个 swap command）静默消失。
//   · `effects/shake/shaders/effects/shake.frag:17` `uniform float g_Amp; // {"material":"strength",…,
//     "default":0.1,"range":[0.01, 0.5]}`；`:64` DIRECTION=0 → `offset = offset*2.0-1.0`（∈[-1,1]）；
//     `:82-83` `vec2 texCoordOffset = offset * g_Amp * g_Amp * flowMask; gl_FragColor = texSample2D(g_Texture0,
//     texCoordOffset + v_TexCoord.xy)` ⇒ strength=0.5 时 **UV 上限 0.25（25%）**。
//   · `effects/foliagesway/shaders/effects/foliagesway.vert:8` `g_Strength … "default":0.4,"range":[0.01, 1]`；
//     `:50` UV 路 `v_Params.z = g_Strength * g_Strength * 0.005`；`:67-68` Vertex 路
//     `position.x += dot(sines, CAST4(1.0)) * g_Strength * 100.0 * weight * g_DirectionWeights.x`；
//     `foliagesway.frag:2` `// [COMBO] {"material":"ui_editor_properties_mode","combo":"MODE","type":"options",
//     "default":0,"options":{"Vertex":1,"UV":0}}` ⇒ 两条完全不同的位移通道，顶点路最大 4·strength·100。
//   · `effects/skew/shaders/effects/skew.vert:22-31` 同款 `MODE`（Vertex/UV）：Vertex 路改 `position`、
//     UV 路改 `v_TexCoord` ⇒ "Vertex 模式改几何、UV 模式改纹理坐标"是官方成对语义。
//
// ── 本档钉住的读数（合成场景：3840×2160 设计画布 + 整屏背景层 + 官方链）─────────────────────
//   缺省 narrow：blur(4)+godrays(5)+lightshafts(1) = **10 个材质 pass 真的执行**、FBO=3840×2160、
//                `scene.__clearFx` = dropped0/kept1/saved1；`clearfx=legacy`：effects=0、**0 pass、
//                0 个效果 FBO、只剩 1 次直绘**。同一场景 1920×1080 画布 **两档都保留** ⇒ 判据按设计画布。
//   shake：作者 `strength` 原样 `uniform1f`（0.1 / 0.5 / **5 超官方上界 10 倍** 都逐位进 shader）⇒ 本仓
//          `parseMaterialMeta` 只看 `"material"`/`"default"`，**不读 `range`、不夹取**。
//   foliagesway：作者 scene.json pass 的 `combos.MODE=1`（大写官方 combo 名）本仓认，顶点着色器编译
//          **Vertex 路**（含 `100.0`）；写小写 `mode` 不生效（combo 名大小写敏感）。
//   几何：同一层效果链里，链输入 copy pass 的 quad = **0..3840 像素** + `mat4Ortho(0,fboW,…)`；
//          材质 pass 的 quad = **NDC [-1,1]** + `IDENT_M4` ⇒ 相差 fboW/2 = 1920 倍。官方 position 空间
//          效应（foliagesway/skew 的 MODE=1）落在哪一种空间里，**官方产物里没有几何上传代码 ⇒ 未证实**；
//          本档只钉"我们两段几何不一致"这条代码事实。
//
// ── 变异自证（RED-IF-REVERTED）────────────────────────────────────────────────────────────
//   断言体收在 `coreChecks(L)` 里，同一套断言跑：真模块（全绿）→ 5 个变异体（各自期望红集）。
//   期望红集 == 实际红集时打印 `MUTANT-RED-OK`；真树 sha256 跑前跑后相同。
//
// 用法: node tests/issue-fluidsim-3840-test.mjs [--no-mutation] [--no-corpus] [--verbose]
// 退出码：0 全绿（含 SKIP）/ 1 有断言失败 / 2 用法错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
if (argv.some((a) => !['--no-mutation', '--no-corpus', '--verbose', '--help'].includes(a))) {
  console.error('未知参数（用法见文件头）'); process.exit(2)
}
if (argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 32).join('\n')); process.exit(0) }
const NO_MUT = argv.includes('--no-mutation')
const NO_CORPUS = argv.includes('--no-corpus')
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
const skip = (m) => console.log('  SKIP ' + m)

// ═════════════════════════ 0 官方资产定位 ═════════════════════════════════════════════════
const WE = process.env.MPW_WE || path.join(WS, 'wallpaper_engine')
const EFF = path.join(WE, 'assets', 'effects')
const ASH = path.join(WE, 'assets', 'shaders')
const hasOfficial = fs.existsSync(EFF)
const officialEffects = hasOfficial
  ? fs.readdirSync(EFF).filter((d) => { try { return fs.statSync(path.join(EFF, d)).isDirectory() } catch { return false } })
  : []

// ═════════════════════════ 1 假 pkg + 官方资产读取 ════════════════════════════════════════
// `resolveEffectChain(pkg, effect, readText)` 只用 `pkg.entries`/`dataStart`/`buf`/`fileSize`
// （core/we-scene-bundle.js `getEntry`）⇒ 拼一个等价对象即可，不必造真 PKG 二进制。
function fakePkg(files) {
  const names = Object.keys(files), chunks = [], entries = []
  let off = 0
  for (const n of names) { const b = Buffer.from(files[n]); entries.push({ name: n, offset: off, size: b.length }); chunks.push(b); off += b.length }
  const buf = Buffer.concat(chunks)
  return { magic: 'PKGV0024', version: '0024', count: entries.length, entries, dataStart: 0, fileSize: buf.length, buf }
}
/** 宽松 JSON：**只用于本测试列依赖**；进 pkg 的仍是官方原始字节，让仓库实现自己严格解析。 */
const looseJson = (s) => JSON.parse(s.replace(/,\s*([}\]])/g, '$1'))
/** 收官方某个效果自带的资产（effect.json + dependencies + passes[].material），路径按 WE 约定命名。 */
function collectOfficial(name, { loose = false } = {}) {
  const files = {}
  const base = path.join(EFF, name)
  const add = (abs, rel) => { if (fs.existsSync(abs)) files[rel] = fs.readFileSync(abs) }
  add(path.join(base, 'effect.json'), `effects/${name}/effect.json`)
  const raw = fs.readFileSync(path.join(base, 'effect.json'), 'utf8')
  const ej = loose ? looseJson(raw) : JSON.parse(raw)
  for (const d of (ej.dependencies || [])) if (d.startsWith('materials/') || d.startsWith('shaders/')) add(path.join(base, d), d)
  for (const p of (ej.passes || [])) if (p.material) add(path.join(base, p.material), p.material)
  return files
}
const readTextOf = (b) => new TextDecoder().decode(b)
const SHADER_CACHE = new Map()
function officialShader(rel) {
  if (!hasOfficial) return null
  if (SHADER_CACHE.has(rel)) return SHADER_CACHE.get(rel)
  const cands = [path.join(ASH, rel)]
  for (const d of officialEffects) cands.push(path.join(EFF, d, rel))
  let out = null
  for (const c of cands) if (fs.existsSync(c)) { out = fs.readFileSync(c, 'utf8'); break }
  SHADER_CACHE.set(rel, out)
  return out
}
const shaderResolver = async (rel) => officialShader(String(rel)) || ''

// ═════════════════════════ 2 mock GL（台账 + uniform 捕获 + 真 uniform 名）═════════════════
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
  const shaderText = new Map(), progShaders = new Map(), uniCache = new Map()
  const rec = { draws: [], uni: [], fboCreated: 0, uploads: [], glsl: [] }
  const bufData = new Map()
  let curBuf = null
  const parseUnis = (p) => {
    const out = [], seen = new Set()
    for (const s of (progShaders.get(p) || [])) {
      const src = shaderText.get(s) || ''
      const re = /uniform\s+(?:lowp |mediump |highp )?([A-Za-z0-9_]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\[\s*\d+\s*\])?\s*;/g
      let m
      while ((m = re.exec(src)) !== null) { const nm = m[3] ? m[2] + '[0]' : m[2]; if (seen.has(nm)) continue; seen.add(nm); out.push({ name: nm, type: TYPE_OF[m[1]] || CONST.FLOAT }) }
    }
    return out
  }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => { rec.fboCreated++; return mk('fbo') },
    createBuffer: () => { const b = mk('buf'); curBuf = b; return b }, createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    attachShader: (p, s) => { if (!progShaders.has(p)) progShaders.set(p, []); progShaders.get(p).push(s) },
    shaderSource: (s, src) => { shaderText.set(s, String(src)); rec.glsl.push(String(src)) },
    bindVertexArray: () => {}, bindBuffer: (t, b) => { curBuf = b },
    // 注：同一个 vbuf 会被 copy pass / composite 反复 bufferData ⇒ 上传序列另存一份（按 buffer id 存会互相覆盖）
    bufferData: (t, data) => { const arr = Array.from(data); rec.uploads.push(arr); if (curBuf) bufData.set(curBuf.id, arr) },
    bindAttribLocation: () => {}, linkProgram: () => {}, activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {},
    useProgram: (p) => { curProg = p },
    drawArrays: (m, f, c) => rec.draws.push({ prog: curProg && curProg.id, count: c, verts: curBuf ? bufData.get(curBuf.id) || null : null,
      src: (progShaders.get(curProg) || []).map((sh) => shaderText.get(sh) || '').join('\n') }),
    drawElements: () => {},
    getProgramParameter: (p, k) => {
      if (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) return true
      if (k === CONST.ACTIVE_ATTRIBUTES) return 2
      if (k === CONST.ACTIVE_UNIFORMS) { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p).length }
      return null
    },
    getActiveUniform: (p, i) => { if (!uniCache.has(p)) uniCache.set(p, parseUnis(p)); return uniCache.get(p)[i] || null },
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1),
    getUniformLocation: (p, n) => ({ p, n: String(n).replace(/\[0\]$/, '') }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1f: (l, a) => rec.uni.push({ name: l && l.n, v: a }),
    uniform1i: (l, a) => rec.uni.push({ name: l && l.n, v: a }),
    uniform2f: (l, a, b) => rec.uni.push({ name: l && l.n, v: [a, b] }),
    uniform3f: (l, a, b, c) => rec.uni.push({ name: l && l.n, v: [a, b, c] }),
    uniform4f: (l, a, b, c, d) => rec.uni.push({ name: l && l.n, v: [a, b, c, d] }),
    uniform1fv: (l, a) => rec.uni.push({ name: l && l.n, v: Array.from(a) }),
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}
/** 一次"官方效果链整屏层"渲染（`L` = 被测模块，默认真模块）：fxStats 行 + GL 台账 + 日志。 */
async function runChain({ chain, params = {}, combos = {}, layerSize, design, clearFx, clearBgFx = true, L = lib }) {
  const files = {}
  for (const n of chain) Object.assign(files, collectOfficial(n, { loose: true }))
  const pkg = fakePkg(files)
  const effs = chain.map((n) => {
    const e = { file: `effects/${n}/effect.json`, visible: true, passes: [{ combos: combos[n] || {}, constantshadervalues: params[n] || {}, textures: [] }] }
    L.resolveEffectChain(pkg, e, readTextOf)
    return e
  })
  const layer = { id: 77, name: '整屏背景', visible: true, solid: true, isContainer: false, textureName: null,
    size: layerSize, scale: [1, 1, 1], origin: [layerSize[0] / 2, layerSize[1] / 2, 0], angles: [0, 0, 0], alignment: 'center',
    color: [1, 1, 1], alpha: 1, brightness: 1, uvRect: undefined, parallaxDepth: null, particle: null, particleDef: null, effects: effs }
  const sc = { general: { orthogonalprojection: { width: design[0], height: design[1] } }, camera: null, properties: {}, layers: [layer] }
  const logs = []
  L.applyRenderConfig(sc, { clearBgFx, clearFx, hideParticles: true, hideUI: false, log: (m) => logs.push(String(m)) })
  const { gl, rec } = mkGL()
  const r = L.createRenderer({ getContext: () => gl, width: layerSize[0], height: layerSize[1] }, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  await r.render(sc, new Map(), layerSize[0], layerSize[1], 1.0)
  const row = Object.values(r.fxStats.perLayer)[0] || null
  const uni = {}
  for (const u of rec.uni) if (u.name && !(u.name in uni)) uni[u.name] = u.v
  const quads = []
  for (const v of rec.uploads) {
    if (!v.length) continue
    const xs = [], ys = []
    for (let i = 0; i + 4 < v.length; i += 5) { xs.push(v[i]); ys.push(v[i + 1]) }
    quads.push({ x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] })
  }
  return { row, uni, quads, draws: rec.draws.length, drawList: rec.draws, fboCreated: rec.fboCreated, logs, effectsKept: sc.layers[0].effects.length, clearFx: sc.__clearFx, glsl: rec.glsl }
}
/** 顶点着色器里编译了哪条位移路（官方 foliagesway/skew 的 MODE 两路各有独有常量）。 */
const vertHas = (x, re) => x.glsl.some((g) => /a_Position/.test(g) && re.test(g))

// ═════════════════════════ 3 断言体（对同一个 L 可反复跑 ⇒ 变异自证）══════════════════════
const CHAIN = ['blur', 'godrays', 'lightshafts']
const OFFICIAL_STRUCT = { blur: { passes: 4, fbos: 2 }, godrays: { passes: 5, fbos: 2 }, lightshafts: { passes: 1, fbos: 0 } }
const OFF_PASSES = OFFICIAL_STRUCT.blur.passes + OFFICIAL_STRUCT.godrays.passes + OFFICIAL_STRUCT.lightshafts.passes

/** @returns {Promise<Array<{id:string,ok:boolean,detail?:string,log?:string}>>} */
async function coreChecks(L) {
  const out = []
  const add = (id, okv, detail, log) => out.push({ id, ok: !!okv, detail: detail || '', log: log || '' })

  // A2 仓库实现解析官方链 = 官方 pass 数
  {
    const pkg = fakePkg(Object.assign({}, collectOfficial('blur', { loose: true }), collectOfficial('godrays', { loose: true }), collectOfficial('lightshafts', { loose: true })))
    const got = {}
    for (const n of Object.keys(OFFICIAL_STRUCT)) {
      const e = { file: `effects/${n}/effect.json`, visible: true, passes: [] }
      L.resolveEffectChain(pkg, e, readTextOf)
      got[n] = { passes: (e.materialPasses || []).length, fbos: (e.fbos || []).length }
    }
    add('A2', Object.keys(OFFICIAL_STRUCT).every((n) => got[n].passes === OFFICIAL_STRUCT[n].passes), V(got))
  }
  // A3 fluidsimulation：官方 20 pass / 9 FBO，**尾逗号**（官方 effect.json:402）现在被宽容解析吃下 ⇒ 链真的建起来
  //   ①(2026-09-24 主对话修) 这条断言原来是"钉住缺陷"（断言 `materialPasses === undefined`）；
  //   本仓随后加了 `parseWeJson`（容忍尾逗号/注释，见 core/we-scene-bundle.js 的 we-json 段）⇒ 断言改成**修好之后**的读数：
  //   链必须建起来（18 个材质 pass + 2 个 swap command），并且计数里能看到"这次是靠宽容解析过的"。
  //   反向证据仍在：变异 M5 把这一处换回严格 `JSON.parse` ⇒ 本断言必红。
  {
    const ej = looseJson(fs.readFileSync(path.join(EFF, 'fluidsimulation', 'effect.json'), 'utf8'))
    const offPasses = (ej.passes || []).length, offFbos = (ej.fbos || []).length
    const before = L.weJsonStats ? L.weJsonStats().trailingComma : null
    const e = { file: 'effects/fluidsimulation/effect.json', visible: true, passes: [] }
    L.resolveEffectChain(fakePkg(collectOfficial('fluidsimulation', { loose: true })), e, readTextOf)
    const gotPasses = e.materialPasses === undefined ? 'undefined' : e.materialPasses.length
    const gotCommands = e.commands === undefined ? 'undefined' : e.commands.length
    const after = L.weJsonStats ? L.weJsonStats().trailingComma : null
    add('A3', offPasses === 20 && offFbos === 9 && gotPasses === 18 && gotCommands === 2 &&
      (before === null || (after > before)), V({ offPasses, offFbos, gotPasses, gotCommands, trailingCommaBefore: before, trailingCommaAfter: after }))
  }
  // A4/A5/A6/A7/A8/A9 合成渲染
  {
    const d3840 = await runChain({ chain: CHAIN, layerSize: [3840, 2160], design: [3840, 2160], L })
    const d3840L = await runChain({ chain: CHAIN, layerSize: [3840, 2160], design: [3840, 2160], clearFx: 'legacy', L })
    const d1080 = await runChain({ chain: CHAIN, layerSize: [1920, 1080], design: [1920, 1080], L })
    const d1080L = await runChain({ chain: CHAIN, layerSize: [1920, 1080], design: [1920, 1080], clearFx: 'legacy', L })
    const R = (x) => 'eff=' + x.effectsKept + ' row=' + (x.row ? (x.row.passes + 'pass/' + x.row.quadW + 'x' + x.row.quadH + '/' + x.row.fallback) : 'none') + ' draws=' + x.draws + ' fbo=' + x.fboCreated
    add('A4', d3840.effectsKept === 3 && !!d3840.row && d3840.row.passes === OFF_PASSES && d3840.row.quadW === 3840 && d3840.row.quadH === 2160 && !d3840.row.fallback, R(d3840))
    add('A5', d3840L.effectsKept === 0 && !d3840L.row && d3840L.draws === 1 && d3840L.fboCreated === 0, R(d3840L))
    add('A6', d1080.effectsKept === 3 && !!d1080.row && d1080.row.passes === OFF_PASSES && d1080L.effectsKept === 3 && !!d1080L.row && d1080L.row.passes === OFF_PASSES, R(d1080) + ' | legacy ' + R(d1080L))
    add('A7', d3840.clearFx && d3840.clearFx.dropped === 0 && d3840.clearFx.kept === 1 && d3840.clearFx.saved === 1 && d3840L.clearFx && d3840L.clearFx.dropped === 1 && d3840L.clearFx.kept === 0,
      'narrow=' + V({ d: d3840.clearFx && d3840.clearFx.dropped, k: d3840.clearFx && d3840.clearFx.kept, s: d3840.clearFx && d3840.clearFx.saved }) + ' legacy=' + V({ d: d3840L.clearFx && d3840L.clearFx.dropped, k: d3840L.clearFx && d3840L.clearFx.kept }), d3840.logs.find((m) => /clearBgFx/.test(m)) || '')
    add('A8', d3840.logs.filter((m) => /clearBgFx/.test(m)).length === 1 && d3840L.logs.filter((m) => /clearBgFx/.test(m)).length === 1 &&
      !d3840.logs.some((m) => /\[CLEARFX\]/.test(m)) && !d3840L.logs.some((m) => /\[CLEARFX\]/.test(m)), '前缀是 ① clearBgFx(...)，没有 [CLEARFX]')
    add('A9', d3840.draws > 0 && d3840L.draws > 0 && d3840.draws > d3840L.draws, 'narrow=' + d3840.draws + ' legacy=' + d3840L.draws)
  }
  // B1 参数原样写入（含超官方 range）
  {
    const p = (s) => ({ shake: { strength: s, speed: 1, friction: '1 1', bounds: '0 1' } })
    const a = await runChain({ chain: ['shake'], params: p(0.1), layerSize: [3840, 2160], design: [3840, 2160], clearBgFx: false, L })
    const b = await runChain({ chain: ['shake'], params: p(0.5), layerSize: [3840, 2160], design: [3840, 2160], clearBgFx: false, L })
    const c = await runChain({ chain: ['shake'], params: p(5), layerSize: [3840, 2160], design: [3840, 2160], clearBgFx: false, L })
    add('B1', a.uni.g_Amp === 0.1 && b.uni.g_Amp === 0.5 && c.uni.g_Amp === 5 && !!a.row && a.row.passes === 1,
      'g_Amp=' + V([a.uni.g_Amp, b.uni.g_Amp, c.uni.g_Amp]) + ' passes=' + (a.row && a.row.passes))
  }
  // B3 / B3b：MODE 大写认、小写不认
  {
    const fp = { foliagesway: { strength: 1, speed: 1, phase: 0, power: 1, ratio: 0.3, scale: 0.05, scrolldirection: 0 } }
    const uvRun = await runChain({ chain: ['foliagesway'], params: fp, layerSize: [3840, 2160], design: [3840, 2160], clearBgFx: false, L })
    const vtxRun = await runChain({ chain: ['foliagesway'], params: fp, combos: { foliagesway: { MODE: 1 } }, layerSize: [3840, 2160], design: [3840, 2160], clearBgFx: false, L })
    const lowRun = await runChain({ chain: ['foliagesway'], params: fp, combos: { foliagesway: { mode: 1 } }, layerSize: [3840, 2160], design: [3840, 2160], clearBgFx: false, L })
    add('B3', vertHas(uvRun, /0\.005/) && !vertHas(uvRun, /100\.0/) && vertHas(vtxRun, /100\.0/) && !vertHas(vtxRun, /0\.005/),
      V({ uv路: vertHas(uvRun, /0\.005/), vertex路: vertHas(vtxRun, /100\.0/) }))
    add('B3b', vertHas(lowRun, /0\.005/) && !vertHas(lowRun, /100\.0/), '小写 mode=1 → 仍编译 UV 路（combo 名大小写敏感）')
    // B4 两段几何空间
    const px = vtxRun.quads.find((q) => q.x[1] >= 1000)
    // 材质 pass 的几何：找"顶点着色器里编译了 100.0（Vertex 路）"的那次 draw，看它实际用的顶点范围
    const rangeOf = (v) => { const xs = []; for (let i = 0; i + 4 < v.length; i += 5) xs.push(v[i]); return [Math.min(...xs), Math.max(...xs)] }
    const fxDraw = vtxRun.drawList.find((d) => d.verts && /100\.0/.test(d.src) && /a_Position/.test(d.src))
    const fxRange = fxDraw ? rangeOf(fxDraw.verts) : null
    add('B4', !!px && px.x[0] === 0 && px.x[1] === 3840 && !!fxRange && fxRange[0] === -1 && fxRange[1] === 1,
      V({ 链输入copy的quad: px ? px.x : null, 材质pass实际顶点范围: fxRange }))
  }
  return out
}

// ═════════════════════════ 4 跑真模块（全绿基线）+ 静态官方取证 ═══════════════════════════
console.log('[0] 官方资产：' + (hasOfficial ? officialEffects.length + ' 个效果目录 @ ' + EFF : '缺 ' + EFF + ' ⇒ A 段 SKIP'))
let realChecks = []
if (!hasOfficial) skip('A/B 段需要官方 assets/effects ⇒ 全部 SKIP')
else {
  const badJson = []
  for (const d of officialEffects) {
    const p = path.join(EFF, d, 'effect.json')
    if (!fs.existsSync(p)) continue
    try { JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { badJson.push(d + ' :: ' + String(e.message).slice(0, 60)) }
  }
  ok('A0 官方 ' + officialEffects.length + ' 个 effect.json：严格 JSON 解析失败 **只有 fluidsimulation**（尾逗号）',
    officialEffects.length >= 46 && badJson.length === 1 && badJson[0].startsWith('fluidsimulation'), 'fail=' + badJson.length + ' ' + badJson.join(' | '))
  const struct = {}
  for (const n of Object.keys(OFFICIAL_STRUCT)) {
    const ej = looseJson(fs.readFileSync(path.join(EFF, n, 'effect.json'), 'utf8'))
    struct[n] = { passes: (ej.passes || []).length, fbos: (ej.fbos || []).length }
  }
  ok('A1 官方链结构（宽松解析）与断言常量一致：' + V(struct),
    Object.keys(OFFICIAL_STRUCT).every((n) => struct[n].passes === OFFICIAL_STRUCT[n].passes && struct[n].fbos === OFFICIAL_STRUCT[n].fbos), V(OFFICIAL_STRUCT))

  // 官方参数定义（B0）
  const shakeFrag = fs.readFileSync(path.join(EFF, 'shake', 'shaders', 'effects', 'shake.frag'), 'utf8').split('\n')
  const folVert = fs.readFileSync(path.join(EFF, 'foliagesway', 'shaders', 'effects', 'foliagesway.vert'), 'utf8').split('\n')
  const folFrag = fs.readFileSync(path.join(EFF, 'foliagesway', 'shaders', 'effects', 'foliagesway.frag'), 'utf8')
  const sLine = shakeFrag.findIndex((l) => /"material":"strength"/.test(l)) + 1
  const fLine = folVert.findIndex((l) => /"material":"strength"/.test(l)) + 1
  const mLine = folFrag.split('\n').findIndex((l) => /"combo":"MODE"/.test(l)) + 1
  ok('B0 官方参数定义：shake.frag:' + sLine + ' `strength` default 0.1 range [0.01,0.5]；foliagesway.vert:' + fLine
    + ' `strength` default 0.4 range [0.01,1]；foliagesway.frag:' + mLine + ' `MODE` default 0 options {Vertex:1, UV:0}',
    /"material":"strength".*"default":0\.1,"range":\[0\.01, 0\.5\]/.test(shakeFrag[sLine - 1]) &&
    /"material":"strength".*"default":0\.4,"range":\[0\.01, 1\]/.test(folVert[fLine - 1]) &&
    /"combo":"MODE".*"default":0.*"Vertex":1,"UV":0/.test(folFrag), 'line ' + sLine + '/' + fLine + '/' + mLine)

  console.log('[A/B] 合成场景读数（`coreChecks` 同一套断言，随后用于变异自证）')
  realChecks = await coreChecks(lib)
  for (const c of realChecks) ok(c.id + (c.log ? '：' + c.log : ''), c.ok, c.detail)
  const A4 = realChecks.find((c) => c.id === 'A4'), A5 = realChecks.find((c) => c.id === 'A5'), A6 = realChecks.find((c) => c.id === 'A6')
  if (A4 && A5 && A6) {
    console.log('  读数表（官方链 blur+godrays+lightshafts，官方材质 pass 合计 ' + OFF_PASSES + '）：')
    console.log('    3840×2160 设计画布 / 3840×2160 整屏层  缺省 narrow : ' + A4.detail)
    console.log('    3840×2160 设计画布 / 3840×2160 整屏层  clearfx=legacy: ' + A5.detail)
    console.log('    1920×1080 设计画布 / 1920×1080 整屏层  narrow|legacy: ' + A6.detail)
  }
  // B2 纯公式读数（与实现无关，放静态段）
  const shakeUV = (amp) => amp * amp * 1.004
  const foliageUV = (strength, texW, texH, ratio = 0.3) => {
    const aspect = (texW / texH) * ratio
    return { x: 4 * (strength * strength * 0.005) * Math.abs(1 / aspect), y: 4 * (strength * strength * 0.005) * Math.abs(aspect) }
  }
  const su = shakeUV(0.5), fu = foliageUV(1, 3840, 2194)
  ok('B2 官方公式的位移上限：shake(strength=0.5) → ' + (su * 100).toFixed(2) + '% UV；foliagesway UV(strength=1, 3840×2194) → x '
    + (fu.x * 100).toFixed(2) + '% / y ' + (fu.y * 100).toFixed(2) + '% UV；foliagesway Vertex(strength=1) → 400 / 80 shader 位置单位',
    Math.abs(su - 0.251) < 0.002 && Math.abs(fu.x - 0.0381) < 0.001 && Math.abs(fu.y - 0.0105) < 0.001,
    V({ shakeUV: +su.toFixed(4), foliageUV: { x: +fu.x.toFixed(4), y: +fu.y.toFixed(4) } }))
}

// ═════════════════════════ 5 语料按官方参数名扫描（有界读）════════════════════════════════
console.log('[B5] 语料扫描（官方参数名 strength / combos.MODE；只读容器目录表 + scene.json 条目）')
if (NO_CORPUS) skip('--no-corpus')
else {
  const CORPUS = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper')
  if (!fs.existsSync(CORPUS)) skip('无 ' + CORPUS)
  else {
    const res = scanCorpusForShake(CORPUS, { maxFiles: Number(process.env.MPW_SHAKE_MAX || 260), maxSceneBytes: 16 << 20 })
    console.log('  扫过容器 ' + res.walked + ' 个（含 scene.json ' + res.withScene + '、解析成功 ' + res.parsed + '、异常 ' + res.skipped.length + '）')
    const wsCount = (a) => a.filter((r) => /workshop/.test(r.officialFile)).length
    console.log('  命中：shake ' + res.shake.length + ' 层（workshop 副本 ' + wsCount(res.shake) + '）/ foliagesway '
      + res.foliage.length + ' 层（workshop 副本 ' + wsCount(res.foliage) + '）')
    if (VERBOSE && res.skipped.length) console.log('    异常样例: ' + res.skipped.slice(0, 5).join(' | '))
    const top = (arr, k) => arr.slice().sort((a, b) => b[k] - a[k]).slice(0, 5)
    if (res.shake.length) {
      const maxUV = Math.max(...res.shake.map((r) => r.uv))
      const over = res.shake.filter((r) => r.strength > 0.5 || r.strength < 0.01).length
      const maxRow = res.shake.slice().sort((a, b) => b.uv - a.uv)[0]
      console.log('  shake top5: ' + top(res.shake, 'uv').map((r) => r.uv.toFixed(4) + '(strength=' + r.strength + ')').join('  '))
      ok('B5a 语料 shake：' + res.shake.length + ' 层，最大 UV 位移 ' + maxUV.toFixed(4) + ' = ' + (maxUV * 100).toFixed(2)
        + '% UV（strength=' + maxRow.strength + '，层 ' + maxRow.size.join('×') + '）；超官方 range ' + over + ' 层',
        res.shake.length > 0 && maxUV > 0, '最惨一层: ' + maxRow.officialFile)
      ok('B5b 语料 shake 最大位移 ≤ 官方上界（0.5 ⇒ amp²×1.004 ≤ 0.251 UV）', maxUV <= 0.251 + 1e-9, 'max=' + maxUV.toFixed(4))
    } else skip('语料里没有 shake 引用')
    if (res.foliage.length) {
      const mx = res.foliage.slice().sort((a, b) => b.uv - a.uv)[0]
      const modes = res.foliage.filter((r) => r.mode !== null).length
      const over = res.foliage.filter((r) => r.strength > 1).length
      const strength1 = res.foliage.filter((r) => r.strength >= 1).length
      console.log('  foliagesway top5: ' + top(res.foliage, 'uv').map((r) => r.uv.toFixed(4) + '(strength=' + r.strength + ')').join('  '))
      ok('B5c 语料 foliagesway：' + res.foliage.length + ' 层、最大 UV 位移 ' + mx.uv.toFixed(4) + ' = ' + (mx.uv * 100).toFixed(2)
        + '% UV（strength=' + mx.strength + '，层 ' + mx.size.join('×') + '）；显式设 MODE 的 ' + modes + ' 层；strength=官方上界(1) 的 ' + strength1 + ' 层；超 range ' + over + ' 层',
        res.foliage.length > 0 && mx.uv > 0, '（modes=0 ⇒ 语料没人用 Vertex 路；本仓仍会按 MODE 编译该路，见 B3）')
    } else skip('语料里没有 foliagesway 引用')
  }
}

// ═════════════════════════ 6 变异自证（RED-IF-REVERTED）═══════════════════════════════════
if (NO_MUT || !hasOfficial) console.log('[M] SKIP（' + (NO_MUT ? '--no-mutation' : '无官方资产') + '）')
else {
  console.log('[M] RED-IF-REVERTED：真源码逐条改回旧写法（副本落 /tmp，真树只读）')
  const SRC_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const CORE = path.dirname(SRC_FILE)
  const SRC = fs.readFileSync(SRC_FILE, 'utf8')
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  const mutants = [
    { label: 'M1(clearBgFx 判据回到绝对 3800/2000)', expect: ['A4', 'A7', 'A9'],
      pairs: [["  if (mode === 'legacy') {\n    return ((s[0] || 0) >= CLEARFX_LEGACY_THRESHOLDS[0] || (s[1] || 0) >= CLEARFX_LEGACY_THRESHOLDS[1])\n  }",
        '  if (true) {\n    return ((s[0] || 0) >= CLEARFX_LEGACY_THRESHOLDS[0] || (s[1] || 0) >= CLEARFX_LEGACY_THRESHOLDS[1])\n  }']] },
    { label: 'M2(效果 pass 几何从 PASS_QUAD(NDC) 换成像素 quad)', expect: ['B4'],
      pairs: [["      gl.bindVertexArray(fxVao) // 效果 pass 专用 VAO（主 vao 保持 vbuf 指针，供 copy/合成使用）\n      uploadQuad('pass', PASS_QUAD) // 维持 currentQuadKey 状态一致（绘制实际读 fxVao→quadVBO）",
        "      gl.bindVertexArray(fxVao) // 效果 pass 专用 VAO（主 vao 保持 vbuf 指针，供 copy/合成使用）\n      uploadQuad('pass', layerQuad(fboW, fboH)) // MUTANT"]], },
    { label: 'M3(combo 名大小写不敏感化)', expect: ['B3b'],
      pairs: [["    const key = shaderName + '|' + JSON.stringify(effectiveCombos)",
        "    for (const k of Object.keys(effectiveCombos)) { const up = k.toUpperCase(); if (up !== k && effectiveCombos[up] === undefined) effectiveCombos[up] = effectiveCombos[k] }\n    const key = shaderName + '|' + JSON.stringify(effectiveCombos)"]], },
    { label: 'M4(按官方 range 夹取 g_Amp/g_Strength)', expect: ['B1'],
      pairs: [["      const entry = matMeta && matMeta[matKey]\n      if (!entry) continue\n      setConstant(uni, entry.uniform, value)",
        "      const entry = matMeta && matMeta[matKey]\n      if (!entry) continue\n      let mx = value\n      if (typeof mx === 'number' && entry.uniform === 'g_Amp') mx = Math.min(0.5, Math.max(0.01, mx))\n      if (typeof mx === 'number' && entry.uniform === 'g_Strength') mx = Math.min(1, Math.max(0.01, mx))\n      setConstant(uni, entry.uniform, mx)"]], },
    /* ①(2026-09-24 主对话修) 方向反过来：源码**已经**用 `parseWeJson` 容忍尾逗号 ⇒ 变异体把这一处换回严格
       `JSON.parse`（= 修之前的行为）来证明"这条链能建起来"确实由宽容解析负责。 */
    { label: 'M5(这一处换回严格 JSON.parse ⇒ fluidsimulation 链解析不出来)', expect: ['A3'],
      pairs: [["    ej = parseWeJson(readText(entry))", "    ej = JSON.parse(readText(entry))"]], },
  ]
  for (const mu of mutants) {
    let body = SRC, missing = null
    for (const [from, to] of mu.pairs) {
      if (!body.includes(from)) { missing = from; break }
      body = body.replace(from, to)
    }
    if (missing) { failN++; console.log('  ✗ ' + mu.label + ' 变异锚点不在源码里：' + V(String(missing).slice(0, 70))); continue }
    const tmp = path.join(os.tmpdir(), 'fxmut-' + mu.label.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) + '.mjs')
    fs.rmSync(tmp, { force: true })
    fs.writeFileSync(tmp, body.replace(/from '\.\//g, `from '${CORE}/`))
    let red = [], detail = ''
    try {
      const mm = await import('file://' + tmp + '?v=' + Date.now() + Math.random())
      const got = await coreChecks(mm)
      red = got.filter((c) => !c.ok).map((c) => c.id)
      detail = got.filter((c) => !c.ok).map((c) => c.id + '(' + c.detail + ')').join(' ')
    } catch (e) { detail = '变异体跑挂：' + String(e && e.message).slice(0, 140) }
    finally { fs.rmSync(tmp, { force: true }) }
    const exp = mu.expect.join(','), act = red.join(',')
    const same = exp === act
    ok('MUTANT-RED-OK｜' + mu.label + '：期望红集 [' + exp + '] == 实际红集 [' + act + ']', same, detail.slice(0, 220))
  }
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^fxmut-.*\.mjs$/.test(f))
  const same = shaOf(SRC_FILE) === srcSha && leftovers.length === 0
  ok('M-end 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（副本落 /tmp 且已 unlink）', same,
    'sha相同=' + (shaOf(SRC_FILE) === srcSha) + ' /tmp残留=' + leftovers.length)
}

// ═════════════════════════ 7 语料扫描实现（有界读：目录表 + scene.json 条目）══════════════
function scanCorpusForShake(root, { maxFiles = 260, maxSceneBytes = 16 << 20 } = {}) {
  const out = { walked: 0, withScene: 0, parsed: 0, skipped: [], shake: [], foliage: [] }
  const files = []
  ;(function walk(d, dep) {
    if (dep > 3 || files.length >= maxFiles) return
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= maxFiles) return
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, dep + 1)
      else if (/\.(pkg|mpkg)$/i.test(e.name)) files.push(p)
    }
  })(root, 0)
  for (const p of files) {
    out.walked++
    let got = null
    try { got = readPkgEntry(p, 'scene.json', maxSceneBytes) } catch (e) { out.skipped.push(path.basename(p) + ':' + String(e.message).slice(0, 40)); continue }
    if (got === null) continue
    out.withScene++
    let j = null
    try { j = JSON.parse(got) } catch (e) { out.skipped.push(path.basename(p) + ':scene.json 解析失败'); continue }
    out.parsed++
    const design = (j.general && j.general.orthogonalprojection) || null
    for (const o of (j.objects || [])) {
      for (const e of (o.effects || [])) {
        const f = String(e.file || '')
        const isShake = /(^|\/)shake\/effect\.json$/i.test(f)
        const isFol = /(^|\/)foliagesway\/effect\.json$/i.test(f)
        if (!isShake && !isFol) continue
        const size = String(o.size || '0 0').trim().split(/\s+/).map(Number)
        const scale = String(o.scale || '1 1 1').trim().split(/\s+/).map(Number)
        const w = (size[0] || (design && design.width) || 1920) * (isFinite(scale[0]) ? scale[0] : 1)
        const h = (size[1] || (design && design.height) || 1080) * (isFinite(scale[1]) ? scale[1] : 1)
        for (const ps of (e.passes || [])) {
          const cv = ps.constantshadervalues || {}
          const strength = Number(cv.strength)
          if (!isFinite(strength)) continue
          const modeRaw = (ps.combos && (ps.combos.MODE !== undefined ? ps.combos.MODE : ps.combos.mode))
          const mode = modeRaw === undefined ? null : Number(modeRaw)
          const base = { file: p, officialFile: f, id: o.id, name: o.name, size: [w, h], strength, params: cv }
          if (isShake) out.shake.push(Object.assign({}, base, { uv: strength * strength * 1.004 }))
          else {
            const ratio = isFinite(Number(cv.ratio)) ? Number(cv.ratio) : 0.3
            const aspect = (w / h) * ratio
            const zmax = Math.max(Math.abs(1 / aspect), Math.abs(aspect))
            out.foliage.push(Object.assign({}, base, { mode, uv: 4 * (strength * strength * 0.005) * zmax, vtxUnits: 4 * strength * 100 }))
          }
        }
      }
    }
  }
  return out
}
/** 只读容器目录表 + 指定条目（内存有界；不整文件读）。 */
function readPkgEntry(file, want, maxBytes) {
  const fd = fs.openSync(file, 'r')
  try {
    const h = Buffer.alloc(4); fs.readSync(fd, h, 0, 4, 0)
    const ml = h.readUInt32LE(0)
    if (!(ml >= 1 && ml <= 64)) throw new Error('magicLen 异常')
    const mb = Buffer.alloc(ml); fs.readSync(fd, mb, 0, ml, 4)
    if (!/^(PKGV|PKGM|v\d)/i.test(mb.toString('latin1'))) throw new Error('非 PKG 容器')
    const cb = Buffer.alloc(4); fs.readSync(fd, cb, 0, 4, 4 + ml)
    const count = cb.readUInt32LE(0)
    if (count > 200000) throw new Error('入口数异常 ' + count)
    // ⚠ 条目数据的绝对偏移 = **整张目录表结束后的位置** + entry.offset（不是"读完后已前进的 pos"）
    let pos = 8 + ml, hit = null
    for (let i = 0; i < count; i++) {
      const nb = Buffer.alloc(4); fs.readSync(fd, nb, 0, 4, pos); pos += 4
      const nl = nb.readUInt32LE(0)
      const nbuf = Buffer.alloc(nl); fs.readSync(fd, nbuf, 0, nl, pos); pos += nl
      const ob = Buffer.alloc(8); fs.readSync(fd, ob, 0, 8, pos); pos += 8
      if (nbuf.toString('utf8') === want) hit = { offset: ob.readUInt32LE(0), size: ob.readUInt32LE(4) }
    }
    const tableEnd = pos
    if (!hit) return null
    hit = { off: tableEnd + hit.offset, size: hit.size }
    if (hit.size > maxBytes) throw new Error('scene.json 过大 ' + hit.size)
    const b = Buffer.alloc(hit.size); fs.readSync(fd, b, 0, hit.size, hit.off)
    return b.toString('utf8').replace(/^\uFEFF/, '')
  } finally { fs.closeSync(fd) }
}

console.log('\n===== issue-fluidsim-3840: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)

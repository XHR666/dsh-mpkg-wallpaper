// system-texture-slot-test.mjs — P-244 `$` 保留名（官方**系统纹理槽** `$mediaThumbnail` /
// `$mediaPreviousThumbnail`）的宿主解析判据。
//
// 背景（RE-44 + 上游产物门面）：`usertextures[i] = {name:"$mediaThumbnail",type:"system"}` 的像素
// = 正在播放曲目的封面。P-212 A2 只做完了**槽位声明**链（三形态 → 有效槽位名 + `textures[i]` 回落），
// 系统名的**像素解析**此前直接落到 `textures.get(name) || null` ⇒ 槽恒空（回落/透明）。
// P-244 补上解析：`$` 名 ⇒ 问宿主 `resolveTexture` 钩子（返回 `{glTex,width,height,…}`）；
// 命中即用且**不写回缓存**（封面会换）；未命中/无钩子 ⇒ `null`（= 旧行为）。回退口 `?mediaslot=legacy`。
//
// 判据分两层：
//   A 源码/纯函数层（无 GL）：开关与两条路径在位、台账可复位；
//   B mock-GL 端到端：真跑 `createRenderer().render()`，断言**真的绑上了宿主给的封面纹理**、
//     封面换了第二次渲染用新的（动态、无缓存）、无源时回落 `textures[i]`、legacy 下不问钩子。
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const CORE_SRC = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== A 源码 / 纯函数层 ==')
{
  check('A1 `systemTextureLedger` / `resetSystemTextureLedger` 导出且形状正确',
    typeof lib.systemTextureLedger === 'function' && typeof lib.resetSystemTextureLedger === 'function' &&
    (() => { lib.resetSystemTextureLedger(); const l = lib.systemTextureLedger(); return l.lookups === 0 && l.hits === 0 && l.misses === 0 && l.layerLookups === 0 && l.last === null })())
  lib.resetSystemTextureLedger()
  check('A2 `$` 分支在位（按首字符 0x24 判定，不是硬编码两个名字）',
    /name\.charCodeAt\(0\) === 0x24/.test(CORE_SRC) && CORE_SRC.includes("resolveSystemTexture(name, textures, 'pass')"))
  check('A3 回退口 `?mediaslot=legacy` 在位且只影响该分支',
    /get\('mediaslot'\) === 'legacy'/.test(CORE_SRC) && /!MEDIASLOT_LEGACY && name\.charCodeAt\(0\) === 0x24/.test(CORE_SRC))
  check('A4 层内容槽（材质级 `$` 名）也走系统槽解析器', /resolveSystemTexture\(layer\.textureName, textures, 'layer', \{ layer \}\)/.test(CORE_SRC))
  check('A5 `$` 名**不写回** textures 缓存（封面可换 ⇒ 不能钉死第一张）',
    /if \(dynName && !MEDIASLOT_LEGACY\)/.test(CORE_SRC) && !/textures\.set\(layer\.textureName, hookTexObj\) \} catch \{\}\s*\}\s*else/.test(CORE_SRC))
  check('A6 钩子载荷带 `systemTexture: true` + `where`（宿主可区分系统槽/远程资源两条链）',
    /systemTexture: true, where: where \|\| 'pass'/.test(CORE_SRC))
}

console.log('== B mock-GL 端到端（声明 → 宿主封面 → 真的绑上）==')
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
let ids = 0, curUnit = 0, curProg = null, curFbo = null
const curTex = new Array(8).fill(null)
const draws = []
const tid = (t) => (t ? (t.__mpwId || t.id || 'anon') : null)
const mk = (kind) => ({ id: kind + '#' + (++ids) })
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  useProgram: (p) => { curProg = p }, bindFramebuffer: (t, f) => { curFbo = f },
  drawArrays: (m, f, c) => draws.push({ prog: curProg && curProg.id, fbo: curFbo && curFbo.id, tex: curTex.map(tid) }),
  getUniformLocation: (p, n) => ({ p, n }), getProgramParameter: () => true, getShaderParameter: () => true,
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 2 }),
  getAttribLocation: () => 0, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
  uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
  uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const canvas = { getContext: () => gl }
const shaderResolver = async (rel) => (rel.endsWith('.vert')
  ? 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ v_TexCoord=a_TexCoord; gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0); }'
  : 'uniform sampler2D g_Texture0; uniform sampler2D g_Texture1; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture2D(g_Texture0,v_TexCoord) + texture2D(g_Texture1,v_TexCoord); }')
const mkLayer = (extra) => Object.assign({ id: 1, name: '封面槽层', visible: true, animLayers: false, solid: false, isContainer: false,
  textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
  alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
  effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
const textures = () => new Map([
  ['tex_a', { glTex: { __mpwId: 'layer_base' }, width: 100, height: 100 }],
  ['util/white', { glTex: { __mpwId: 'fallback_white' }, width: 1, height: 1 }],
])
// 一个材质级槽 1 = `$mediaThumbnail` 的效果 pass（场景级 textures[1] + usertextures[1] 成对，
//   与 RE-44 样本 `0917/3351163962 objects[119]` 同形）。
const fxEff = () => ({ file: 'fx', visible: true, passes: [{ combos: {}, textures: [null, 'util/white'], usertextures: [null, { name: '$mediaThumbnail', type: 'system' }] }],
  materialPasses: [{ shader: 'fx', blending: 'normal', target: null, binds: [], textures: [null, 'util/white'], combos: {}, constants: {} }] })
const slot1 = () => { for (let i = draws.length - 1; i >= 0; i--) { const d = draws[i]; if (d.tex[1]) return d.tex[1] } return null }

{
  // 阶段 1：**没有**媒体源（`media` 空）⇒ 槽位回落 `util/white`，钩子一次都不该被问
  lib.resetSystemTextureLedger()
  // 宿主钩子只有**一个**（`registerMpwHook` 是追加语义，多个钩子取第一个非空结果）——
  //   与 demo.html 的 `MPW-SYSTEMTEX` 块同款：钩子读一个可变的"当前封面"变量，换封面 = 换变量。
  let cover = null
  const seen = []
  lib.registerMpwHook('resolveTexture', (name, payload) => { seen.push({ name, sys: !!(payload && payload.systemTexture) }); return name === '$mediaThumbnail' ? cover : null })
  globalThis.__mpwUserTextures = { media: {} }
  const r = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  const sc = mkScene([mkLayer({ effects: [fxEff()] })])
  draws.length = 0
  await r.render(sc, textures(), 640, 360, 0.016)
  check('B1 无媒体源 ⇒ 槽位回落 `util/white`（不是透明/黑）', slot1() === 'fallback_white', 'slot1=' + slot1())
  check('B2 无媒体源 ⇒ **不**问 `$` 钩子（回落不触发宿主解析）', seen.length === 0 && lib.systemTextureLedger().lookups === 0, JSON.stringify(seen))

  // 阶段 2：宿主给出封面（`media['$mediaThumbnail']` + 钩子返回纹理）⇒ 该槽换成封面
  globalThis.__mpwUserTextures = { media: { $mediaThumbnail: '$mediaThumbnail' } }
  cover = { glTex: { __mpwId: 'cover_v1' }, width: 8, height: 8 }
  draws.length = 0
  await r.render(sc, textures(), 640, 360, 0.016)
  const led2 = lib.systemTextureLedger()
  check('B3 有媒体源 ⇒ 槽位解析为系统名并绑上宿主纹理', slot1() === 'cover_v1', 'slot1=' + slot1())
  check('B4 钩子被问且带 `systemTexture` 标记；台账 hits>0 / names 记到名字',
    seen.length > 0 && seen.every((s) => s.sys && s.name === '$mediaThumbnail') && led2.hits > 0 && led2.names.$mediaThumbnail > 0 && led2.last === '$mediaThumbnail',
    JSON.stringify({ seen: seen.slice(0, 2), led: led2 }))

  // 阶段 3：封面**换一张**（同一次挂载、同一个 textures 表）⇒ 第二次渲染必须用新纹理（无缓存）
  cover = { glTex: { __mpwId: 'cover_v2' }, width: 16, height: 16 }
  draws.length = 0
  await r.render(sc, textures(), 640, 360, 0.016)
  check('B5 换封面后同一挂载内即换（`$` 名不被缓存钉死）', slot1() === 'cover_v2', 'slot1=' + slot1())

  // 阶段 4：宿主没封面了（声明还在）⇒ 回落，不抛错
  cover = null
  draws.length = 0
  let threw = null
  try { await r.render(sc, textures(), 640, 360, 0.016) } catch (e) { threw = String(e && e.message || e) }
  check('B6 宿主没封面（声明还在）⇒ 回落/透明兜底且渲染不抛错', threw === null && slot1() !== 'cover_v1' && slot1() !== 'cover_v2',
    'threw=' + threw + ' slot1=' + slot1())
}

{
  // 阶段 5：`?mediaslot=legacy` ⇒ `$` 分支整条关掉（不问钩子；槽位按声明解析后落到透明兜底）
  lib.resetSystemTextureLedger()
  const seen = []
  lib.registerMpwHook('resolveTexture', (name) => { seen.push(name); return { glTex: { __mpwId: 'cover_legacy' }, width: 8, height: 8 } })
  globalThis.__mpwUserTextures = { media: { $mediaThumbnail: '$mediaThumbnail' } }
  globalThis.location = { search: '?mediaslot=legacy' }
  const r2 = createRenderer(canvas, { shaderResolver, onLog: () => {} })
  draws.length = 0
  await r2.render(mkScene([mkLayer({ effects: [fxEff()] })]), textures(), 640, 360, 0.016)
  delete globalThis.location
  check('B7 legacy 下 `$` 名不问钩子（lookups=0、没绑上 cover_legacy）',
    seen.length === 0 && lib.systemTextureLedger().lookups === 0 && slot1() !== 'cover_legacy',
    JSON.stringify({ seen, led: lib.systemTextureLedger(), slot1: slot1() }))
  check('B8 legacy 下渲染照常（层与 copy pass 仍绘制）', draws.length >= 2, 'draws=' + draws.length)
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败（P-244 系统纹理槽）')
process.exit(fail === 0 ? 0 : 1)

/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · `references/wer-ref`（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only）—— 与本项目 GPL-3.0-or-later 不兼容，仅行为对照；
 *   · `references/lwe-ref`（linux-wallpaperengine，GPL-3.0-only）—— 仅行为对照；
 *   · `references/vendor-ref/webwallgl`（oneincase/webwallgl，**MIT**）—— 允许移植，本文件仍按"行为规格"独立实现，
 *     引用处以 `file:line` 标注行为来源；血缘/许可台账见 docs/COPYING-RULES.md 与 THIRD-PARTY.md。
 */
// effects-degenerate-fbo-test.mjs — P-134 回归门禁（秒级、无浏览器、无网络、无 GPU）
//
// 覆盖用户第 ⑥ 号 bug「视频壁纸左侧 1/4 颜色反相」的三条根因（详见 docs/PATCHES.md P-134、
// 现场报告 docs/RENDER-BUGS-20260918.md §3）：
//   ① **无纹理层**（纯色 / 文本 / 容器）算效果链 FBO 尺寸时取了常量 1 ⇒ FBO 恒 1×1 ⇒ 下面的
//      `fboW < 2 || fboH < 2` 退化短路命中 ⇒ **效果链从不执行**，层退回"原始纯色 × colorBlendMode"
//      整块合成；纯色层#935 的 `colorBlendMode:23`（Phoenix ≈ 反相）就这样把 2998×987 的 quad
//      整块反相 = 用户看到的"左侧 1/4 反相"（3840 宽画布上可见 866.8px = 22.6%）。
//      判据：FBO 尺寸必须 = size×scale（实绘尺寸），`fallback` 不再是 `degenerateFbo`。
//   ② **size 缺省/为 0 的占位/容器层必须仍然塌成 1×1**（负面断言：兜底不许被顺手改坏）。
//   ③ 效果 pass 的 `g_AudioSpectrum{16,32,64}{Left,Right}`：渲染器此前**从不设置**（恒 0）⇒ 修好①
//      之后音频条会"什么都不画"。判据：有数据源（活视图 `hasSource=true`）⇒ 按分辨率写入**存在**的
//      uniform；无数据源 / `?bandfeed=off`（宿主不注入）⇒ **一个都不写**（= 与接线前逐位相同）。
//   ④ 同一材质 pass 的 vert/frag `[COMBO]` 默认值取**并集**（`Simple_Audio_Bars` 的 `BAR_STYLE`
//      只在 .vert 声明 ⇒ frag 曾按 0 编译，顶点/片元几何口径不一致）。
//
// 变异自证（RED-IF-REVERTED）：把真源码复制到 /tmp 后逐条改回旧写法，同一套断言必须变红；
// 变异副本手工 readFileSync/writeFileSync 生成（本机 `fs.cpSync` 抛 EINVAL），真树只读。
//
// 用法: node tests/effects-degenerate-fbo-test.mjs [--verbose]
// TODO(tests/run-all-tests.sh): **登记待办** —— 本文件尚未登记进门禁脚本（由主对话统一登记；别的线不要改 run-all-tests.sh）
import { WS } from './_root.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import * as lib from '../core/we-scene-bundle.js'

const VERBOSE = process.argv.includes('--verbose')
const MPW_WS = process.env.MPW_ROOT || WS
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(MPW_WS, 'allwallpaper', 'dd')
const PKG_ID = '3660962877'                       // 用户报的⑥号包（TEX 内嵌 MP4 的视频壁纸）
const PKG_DIR = path.join(SCENE_ROOT, PKG_ID)
const PKG_FILE = path.join(PKG_DIR, 'scene.pkg')
const dec = new TextDecoder()
const rd = (b) => dec.decode(b).replace(/^\uFEFF/, '')
const hasPkg = fs.existsSync(PKG_FILE)

let passN = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { passN++; if (VERBOSE) console.log('  ✓ ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) }
  else { fails.push(name + (detail !== undefined ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}
const skip = (m) => console.log('  SKIP ' + m + '（真包缺失 ⇒ 视作 PASS，不红）')

// ═════════════════════════ mock GL（按 shaderSource 真源码报 uniform + 捕获 uniform1fv） ═════════════════════════
// 关键：`getActiveUniform` 必须报**程序里真的存在**的 uniform —— 否则 `uni.get('g_AudioSpectrum32Left')`
// 永远 miss，"存在才设"这条判据就测不出来（报告 §3 的 probe935 的 mock 恒报 g_Texture0，正因如此）。
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
  FLOAT: 0x1406, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52, INT: 0x1404, BOOL: 0x8B56,
  FLOAT_MAT4: 0x8B5C, FLOAT_MAT3: 0x8B5B, SAMPLER_2D: 0x8B5E }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const TYPE_OF = { float: CONST.FLOAT, int: CONST.INT, bool: CONST.BOOL, vec2: CONST.FLOAT_VEC2, vec3: CONST.FLOAT_VEC3,
  vec4: CONST.FLOAT_VEC4, mat4: CONST.FLOAT_MAT4, mat3: CONST.FLOAT_MAT3, sampler2D: CONST.SAMPLER_2D }
function mkGL() {
  let seq = 0, curProg = null, curUnit = 0
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
        const name = m[3] ? m[2] + '[0]' : m[2]          // 数组 uniform 的真实上报名带 [0]（由 uni 缓存剥掉）
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
    activeTexture: (u) => { curUnit = u - CONST.TEXTURE0 }, bindTexture: () => {}, bindFramebuffer: () => {},
    useProgram: (p) => { curProg = p },
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
    // 位置对象带名字（真渲染器的 uniform 缓存按 getActiveUniform 报的名去查，这里必须同名）
    getUniformLocation: (p, n) => ({ p, n: String(n).replace(/\[0\]$/, '') }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1fv: (l, arr) => rec.uniWrites.push({ name: l && l.n, kind: 'fv', v: Array.from(arr) }),
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
const audioWrites = (rec) => rec.uniWrites.filter((w) => /^g_AudioSpectrum/.test(String(w.name)))

// ═════════════════════════ 合成夹具（形状与 tests/mock-gl-test.mjs 同源） ═════════════════════════
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
// 32 段频谱（= 本包音频条 shader 的 RESOLUTION 默认档）+ 一个 16 段变体（测"存在才设"）
const FRAG_AUDIO32 = 'uniform sampler2D g_Texture0; uniform float g_AudioSpectrum32Left[32]; uniform float g_AudioSpectrum32Right[32]; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) + vec4(g_AudioSpectrum32Left[0] + g_AudioSpectrum32Right[0]); }'
const FRAG_AUDIO16 = 'uniform sampler2D g_Texture0; uniform float g_AudioSpectrum16Left[16]; uniform float g_AudioSpectrum16Right[16]; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) + vec4(g_AudioSpectrum16Left[0]); }'
// ④端到端：**BAR_STYLE 只在 .vert 里声明**（真包 Simple_Audio_Bars 的形态）——frag 用同名 combo 选分支，
// 并集生效 ⇒ BAR_STYLE=1 分支（值 2.0）；没取并集 ⇒ frag 按无声明=0 ⇒ 7.0 分支。
const VERT_COMBO = [
  '// [COMBO] {"combo":"BAR_STYLE","default":1}',
  'attribute vec3 a_Position; attribute vec2 a_TexCoord;',
  'uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord;',
  '#if BAR_STYLE == 1',
  'float p134barV = 2.0;',
  '#else',
  'float p134barV = 7.0;',
  '#endif',
  'void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position, p134barV); v_TexCoord = a_TexCoord; }',
].join('\n')
const FRAG_COMBO = [
  'uniform sampler2D g_Texture0; varying vec2 v_TexCoord;',
  '#if BAR_STYLE == 1',
  'float p134bar = 2.0;',
  '#else',
  'float p134bar = 7.0;',
  '#endif',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * p134bar; }',
].join('\n')
const P134_ON = /p134bar\w*\s*=\s*2\.0/
const P134_OFF = /p134bar\w*\s*=\s*7\.0/
const resolverFor = (frag) => async (rel) => (rel.endsWith('.vert') ? VERT : frag)
const resolverCombo = async (rel) => (rel.endsWith('.vert') ? VERT_COMBO : FRAG_COMBO)
const mkEffect = (shader) => ({ file: 'fx_' + shader, visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [],
  materialPasses: [{ shader, blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} }] })
const mkLayer = (extra) => Object.assign({ id: 1, name: '层', visible: true, solid: false, isContainer: false,
  textureName: null, size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center',
  color: [1, 1, 1], alpha: 1, brightness: 1, effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, layers, properties: {} })
const TEX_MAP = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])
// 无纹理"纯色"层：与真包 objects[1]#935 同几何（500×500 × scale 5.99649/1.97301 = 2998×987）
const SOLID = () => mkLayer({ id: 935, name: '纯色', solid: true, textureName: null, color: [0.45098, 0.30196, 0.39608],
  colorBlendMode: 23, size: [500, 500], scale: [5.99649, 1.97301, 1], effects: [mkEffect('fx_stub')] })
const TEXTURED = () => mkLayer({ id: 937, name: '贴图层', solid: false, textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], effects: [mkEffect('fx_stub')] })
const byName = (fx, n) => Object.values(fx.perLayer).find((v) => String(v.name).startsWith(n + '#')) || null
// 16 段活视图（确定性值）：left[i]=(i+1)/16、right[i]=(16−i)/16 ⇒ 32 段 = 每段复制（floor(i/2)）
const bandView = (hasSource, kind) => {
  const v = { resolution: 16, left: new Float32Array(16), right: new Float32Array(16), average: new Float32Array(16), kind: 'test', hasSource: !!hasSource, revision: 1 }
  for (let i = 0; i < 16; i++) { v.left[i] = (i + 1) / 16; v.right[i] = (16 - i) / 16; v.average[i] = (v.left[i] + v.right[i]) / 2 }
  // ①(2026-09-24 任务 ⑫) 两个特例视图：真实源但**恰好全 0**（音乐暂停）/ 真实源但极小（1e-4）
  if (kind === 'zero-source') { v.hasSource = true; v.kind = 'analyser'; v.left.fill(0); v.right.fill(0); v.average.fill(0) }
  if (kind === 'tiny') { v.hasSource = true; v.kind = 'analyser'; v.left.fill(1e-4); v.right.fill(1e-4); v.average.fill(1e-4) }
  return v
}
const expUpsampled = (src, n) => Array.from({ length: n }, (_, i) => src[Math.floor(i * src.length / n)])

// ═════════════════════════ 共用检查体（真模块 + 变异副本各自跑一遍） ═════════════════════════
/** 返回 { checks:[{name,ok,detail}] }；`m` = bundle 模块（真模块或 /tmp 变异副本）。 */
async function suite(m, tag) {
  const res = []
  const push = (name, cond, detail) => res.push({ name: tag + '｜' + name, ok: !!cond, detail })
  const render = async (layers, frag, view, onDraw, opts) => {
    const { gl, rec } = mkGL()
    const r = m.createRenderer({ getContext: () => gl, width: 3840, height: 2160 },
      Object.assign({ shaderResolver: typeof frag === 'function' ? frag : resolverFor(frag), onLog: () => {}, onLayerDraw: onDraw }, opts || {}))
    try { m.setAudioBands(view || null) } catch { /* 变异副本可能没有这个导出 */ }
    await r.render(mkScene(layers), TEX_MAP, 3840, 2160, 1.0)
    return { r, rec }
  }
  // ── ① 无纹理层的效果链 FBO = 实绘尺寸（报告 §3.4 主修） ──
  {
    const { r, rec } = await render([SOLID(), TEXTURED()], FRAG, null)
    const s = byName(r.fxStats, '纯色')
    push('①a 无纹理纯色层**建了效果链 FBO**（不是 1×1）', !!s && s.quadW === 2998 && s.quadH === 987, s ? s.quadW + 'x' + s.quadH : '无台账')
    push('①b ★ FBO 尺寸 = size×scale 的实绘尺寸（旧写法恒 1×1 ⇒ degenerateFbo）', !!s && s.quadW === 2998 && s.quadH === 987 && !s.degenerate, s && JSON.stringify({ w: s.quadW, h: s.quadH, degenerate: !!s.degenerate }))
    push('①c `fallback` 不再是 degenerateFbo（退化短路不再命中）', !!s && s.fallback !== 'degenerateFbo', s && String(s.fallback))
    push('①d 链输入真的是层内容（white 哨兵 × layer.color，不是被短路直通）', !!s && s.inputKind === 'white' && s.copyDrawn === true, s && (s.inputKind + '/copyDrawn=' + s.copyDrawn))
    push('①e 该层材质 pass **真的执行了**（passes ≥ 1）', !!s && s.passes >= 1, s && String(s.passes))
    push('①f 链尾输出 = 效果 FBO（不是哨兵）', !!s && s.outKind === 'fbo' && s.outSize === '2998x987', s && (s.outKind + '/' + s.outSize))
    // 合成输入：`isWhite=true` = 拿 1×1 白兜底 × layer.color 整块合成（= 用户看到的整块反相）
    const draws = []
    await render([SOLID()], FRAG, null, (layer, info) => draws.push({ n: String(layer.name || layer.id), isWhite: info.isWhite, qw: Math.round(info.quadW), qh: Math.round(info.quadH) }))
    const d = draws.find((x) => x.n === '纯色')
    push('①g ★ 合成该层时的输入不再是 1×1 白哨兵（`onLayerDraw.isWhite` 由 true 变 false）', !!d && d.isWhite === false, d && JSON.stringify(d))
    // 有纹理层行为不变（回归护栏）
    const t = byName(r.fxStats, '贴图层')
    push('①h 有纹理层的 FBO 尺寸口径**不变**（400×400 = size×scale）', !!t && t.quadW === 400 && t.quadH === 400, t && t.quadW + 'x' + t.quadH)
  }
  // ── ② 负面断言：**零几何**的占位层仍然塌成 1×1（`|| 1` 兜底不许被改坏） ──
  //   ①(实测口径更正 P-134) 报告 §3.4 写的"`size=0` ⇒ `lw0=0` ⇒ 仍 1×1"**只对非 solid 层成立**：
  //   渲染器自己有一条 WE 语义回退（`core/we-scene-bundle.js` 的 "WE 语义：对象 size 为 0 时回退"，
  //   `layer.solid ⇒ size=[cam.projW,cam.projH]`），它在算 FBO 尺寸**之前**就把 solid 层的 size 改成了
  //   整屏 ⇒ 那类层的"实绘尺寸"本来就是整屏。语料实测：size 含 0 且带 effects 的层 14 个**全部
  //   `solid=false`**（⇒ 命中下面的早退分支），尺寸回退生效的 13 层**全部 fx=0** ⇒ 两种口径在语料上
  //   逐位相同（详见 P-134 台账"未证实项"）。这里按**可达**的三类零几何形态钉死：
  {
    // ②-1 `lw0 = size×scale = 0`（scale=0）⇒ `|| 1` 兜住 ⇒ 1×1（若有人把兜底写成裸 `lw0` ⇒ 0×0 FBO，这条红）
    const z0 = mkLayer({ id: 938, name: '零尺寸', solid: true, color: [1, 1, 1], size: [500, 500], scale: [0, 0, 1], effects: [mkEffect('fx_stub')] })
    const { r: r1 } = await render([z0], FRAG, null)
    const z = byName(r1.fxStats, '零尺寸')
    push('②a lw0=lh0=0（scale=0）的层**仍然**是 1×1 + degenerateFbo（`|| 1` 兜底未被改坏）',
      !!z && z.quadW === 1 && z.quadH === 1 && z.fallback === 'degenerateFbo', z && JSON.stringify({ w: z.quadW, h: z.quadH, fb: z.fallback }))
    // ②-2 作者 size=[0,0] + **非 solid** + 无纹理 ⇒ 命中既有早退（不建 FBO、不进台账）：逐位不变
    const z2 = mkLayer({ id: 939, name: '空占位', solid: false, textureName: null, size: [0, 0], scale: [1, 1, 1], effects: [mkEffect('fx_stub')] })
    const { r: r2 } = await render([z2], FRAG, null)
    push('②b size=[0,0] 的非 solid 空占位层仍走**早退**（不进 fxStats、不建 FBO，逐位不变）',
      byName(r2.fxStats, '空占位') === null, JSON.stringify(Object.keys(r2.fxStats.perLayer)))
    // ②-3 size=[0,0] + solid：渲染器自己的 WE 回退把 size 换成整屏投影 ⇒ FBO = 整屏（= 实绘尺寸，**不是** 1×1）
    const z3 = mkLayer({ id: 940, name: '整屏占位', solid: true, textureName: null, size: [0, 0], scale: [1, 1, 1], effects: [mkEffect('fx_stub')] })
    const { r: r3 } = await render([z3], FRAG, null)
    const z3r = byName(r3.fxStats, '整屏占位')
    push('②c size=[0,0] 的 **solid** 层：渲染器的 WE 回退先把它变成整屏投影 ⇒ FBO=投影尺寸（口径=实绘尺寸）',
      !!z3r && z3r.quadW === 3840 && z3r.quadH === 2160 && z3r.fallback !== 'degenerateFbo', z3r && z3r.quadW + 'x' + z3r.quadH)
  }
  // ── ③ 音频频谱 uniform：有源才写、存在才设、无源一个都不写 ──
  {
    // ③-1 有数据源 + 程序里声明 32 段 ⇒ 写入 32 段左右，且数值 = 16 段视图的上采样
    const v = bandView(true)
    const { rec } = await render([SOLID()], FRAG_AUDIO32, v)
    const aw = audioWrites(rec)
    const L = aw.find((w) => w.name === 'g_AudioSpectrum32Left'), R = aw.find((w) => w.name === 'g_AudioSpectrum32Right')
    push('③a 有数据源 ⇒ 写入 `g_AudioSpectrum32Left`（32 段）', !!L && L.kind === 'fv' && L.v.length === 32, L ? L.kind + '/' + L.v.length : '未写入')
    push('③b 有数据源 ⇒ 写入 `g_AudioSpectrum32Right`（32 段）', !!R && R.kind === 'fv' && R.v.length === 32, R ? R.kind + '/' + R.v.length : '未写入')
    push('③c ★ 左通道数值 = 16 段活视图的上采样（逐项相符，不是造数）', !!L && JSON.stringify(L.v) === JSON.stringify(expUpsampled(v.left, 32)), L && JSON.stringify(L.v.slice(0, 4)))
    push('③d ★ 右通道数值 = 16 段活视图的上采样（逐项相符）', !!R && JSON.stringify(R.v) === JSON.stringify(expUpsampled(v.right, 32)), R && JSON.stringify(R.v.slice(0, 4)))
    // ③-2 「存在才设」：程序只声明 16 段 ⇒ 只写 16 段，不凭空写 32/64
    const { rec: rec16 } = await render([SOLID()], FRAG_AUDIO16, bandView(true))
    const aw16 = audioWrites(rec16).map((w) => w.name)
    push('③e 程序只声明 16 段 ⇒ 只写 16 段（存在才设；不写 32/64）',
      aw16.includes('g_AudioSpectrum16Left') && aw16.includes('g_AudioSpectrum16Right') && !aw16.some((n) => /32|64/.test(n)), aw16.join(','))
    /* ③-3（★2026-09-24 任务 ⑫ **契约变更**）无数据源 ⇒ 写 **0.012 静音地板**，不再"一个都不写"。
       旧契约（钉死提交 151ce0a 的 `git show 151ce0a:core/we-scene-bundle.js`：
       `if (!v || !v.hasSource …) return 0`）会让作者 shader 拿到全 0 频谱 ⇒
       `enhanced_simple_audio_bars` 的 `barHeight = mix(max(u_BarBoundsX, minBarHeight), …, 0) = 0`
       ⇒ 零尺寸圆角盒 + 零宽 AA 过渡带 ⇒ `smoothstep(0,0,0)` 除零：本机 llvmpipe 判 0（整层不画）、
       部分驱动判 1（整层被 Bar Color(1 1 1) 以 alpha=1 铺满 = 用户报的白色实心块）。
       变更理由与上游依据（oneincase webwallgl 静音段 floorV=0.012）见 `AUDIO_SILENCE_FLOOR` 的注释。
       **旧行为没被删**：`opts.audioFloor=0` 分支仍逐位回到"一个都不写"（③f-legacy），可 A/B。 */
    const FLOOR = m.AUDIO_SILENCE_FLOOR
    const { rec: rec0 } = await render([SOLID()], FRAG_AUDIO32, null)
    const aw0 = audioWrites(rec0)
    push('③f ★ 没有活视图（`?bandfeed=off` 宿主不注入）⇒ 写**非退化**频谱（全部 = 静音地板 ' + FLOOR + '，不是全 0）',
      aw0.length > 0 && aw0.every((w) => w.v.length === 32 && w.v.every((x) => Math.abs(x - FLOOR) < 1e-9)),
      aw0.length + ' 次写入 / 首值 ' + (aw0[0] && aw0[0].v[0]))
    const { rec: recNS } = await render([SOLID()], FRAG_AUDIO32, bandView(false))
    const awNS = audioWrites(recNS)
    push('③g ★ 活视图在但 `hasSource=false`（auto 档无音轨无麦克风）⇒ 同样写静音地板（不喂全 0）',
      awNS.length > 0 && awNS.every((w) => w.v.every((x) => Math.abs(x - FLOOR) < 1e-9)), String(awNS.length))
    const { rec: recLegacy } = await render([SOLID()], FRAG_AUDIO32, null, null, { audioFloor: 0 })
    push('③f-legacy `opts.audioFloor=0` ⇒ **逐位回到旧契约**："没有活视图就一个都不写"（旧行为仍可测，未被删除）',
      audioWrites(recLegacy).length === 0, String(audioWrites(recLegacy).length))
    // 真实源**恰好全 0**（音乐暂停）也是退化输入 ⇒ 同样兜底；非零（哪怕极小）一律原样上传
    const { rec: recZeroSrc } = await render([SOLID()], FRAG_AUDIO32, bandView(true, 'zero-source'))
    const awZS = audioWrites(recZeroSrc)
    push('③g2 真实源但**恰好全 0**（音乐暂停/静音）⇒ 同样落地板（退化输入防线对真实源也生效）',
      awZS.length > 0 && awZS.every((w) => w.v.every((x) => Math.abs(x - FLOOR) < 1e-9)), String(awZS.length))
    const { rec: recTiny } = await render([SOLID()], FRAG_AUDIO32, bandView(true, 'tiny'))
    const awT = audioWrites(recTiny)
    push('③g3 真实源**非零但很小**（1e-4）⇒ 原样上传（不夹取作者的低音量输入）',
      awT.length > 0 && awT.every((w) => w.v.every((x) => Math.abs(x - 1e-4) < 1e-9)), awT[0] && String(awT[0].v[0]))
    push('③h 该程序**确实声明**了音频 uniform（⇒ 写/不写都作用在真实存在的 uniform 上）',
      rec0.glsl.some((s) => /uniform float g_AudioSpectrum32Left/.test(s)), rec0.glsl.length + ' 段 GLSL')
    const fi = m.audioBandsInfo()
    push('③i 地板写入进诊断面（`audioBandsInfo().floor`：值 + 写入次数 + 档位个数）',
      !!fi.floor && fi.floor.floor === FLOOR && fi.floor.writes > 0 && fi.floor.floorBands >= 1 && fi.floor.floorBands <= 3,
      JSON.stringify(fi.floor))
  }
  // ── ④ vert/frag 的 [COMBO] 默认值取并集（纯函数层，用合成源码，不依赖真包） ──
  {
    const vSrc = '// [COMBO] {"combo":"BAR_STYLE","default":1}\nuniform float u;\n'
    const fSrc = '// [COMBO] {"combo":"RESOLUTION","default":32}\nuniform float u;\n'
    const fMerged = m.withSiblingComboDefaults(fSrc, vSrc)
    const vMerged = m.withSiblingComboDefaults(vSrc, fSrc)
    push('④a frag 补到 vert 独有的声明（BAR_STYLE=1 进了 frag）', m.parseComboDefaults(fMerged).BAR_STYLE === 1, JSON.stringify(m.parseComboDefaults(fMerged)))
    push('④b vert 补到 frag 独有的声明（RESOLUTION=32 进了 vert）', m.parseComboDefaults(vMerged).RESOLUTION === 32, JSON.stringify(m.parseComboDefaults(vMerged)))
    push('④c 本方已有的声明不被对方覆盖（取并集，不是取后者）', m.parseComboDefaults(fMerged).RESOLUTION === 32 && m.parseComboDefaults(vMerged).BAR_STYLE === 1)
    const cSrc = '// [COMBO] {"combo":"X","default":7}\nuniform float u;\n'
    const cSib = '// [COMBO] {"combo":"X","default":9}\nuniform float u;\n'
    push('④d 两侧都声明且默认值不同 ⇒ **本方声明优先**（语料 0 命中，仅口径钉死）', m.parseComboDefaults(m.withSiblingComboDefaults(cSrc, cSib)).X === 7)
    push('④e 没有可补的声明时**逐字节不变**（幂等，不动既有源码）', m.withSiblingComboDefaults(cSrc, cSrc) === cSrc)
    // ④f/④g **端到端**：渲染路径真的把并集喂给了转译器（只看纯函数的话，把调用点改回去也测不出来）
    const { rec: recC } = await render([SOLID()], resolverCombo, null)
    const fragGlsl = recC.glsl.filter((s) => /out vec4 fragColor|gl_FragColor/.test(s))
    const vertGlsl = recC.glsl.filter((s) => /gl_Position/.test(s))
    push('④f ★ 端到端：frag 编译时拿到了 .vert 独有的 combo 默认值（BAR_STYLE=1 分支 = 2.0 被选中）',
      fragGlsl.some((s) => P134_ON.test(s)) && !fragGlsl.some((s) => P134_OFF.test(s)), fragGlsl.length + ' 段 frag GLSL')
    push('④g 端到端：vert 侧同一分支同样选中（两 stage 一套口径）',
      vertGlsl.some((s) => P134_ON.test(s)) && !vertGlsl.some((s) => P134_OFF.test(s)), vertGlsl.length + ' 段 vert GLSL')
  }
  return res
}

console.log('effects-degenerate-fbo（P-134）—— 真模块')
const main = await suite(lib, 'repo')
passN = 0
fails.length = 0
for (const c of main) { if (c.ok) passN++; else fails.push(c.name + (c.detail !== undefined ? ' — ' + c.detail : '')) }

// ═════════════════════════ ⑤ 真包端到端（真 shader + 真转译器 + 真效果链） ═════════════════════════
if (!hasPkg) skip('真包 ' + PKG_ID + '（' + PKG_FILE + '）')
else {
  const pkgBuf = fs.readFileSync(PKG_FILE)                       // Buffer 直接交给 parsePkg（不复制，控制峰值内存）
  const pkg = lib.parsePkg(pkgBuf)
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const scene = lib.parseScene(JSON.parse(rd(entry('scene.json'))))
  const proj = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'project.json'), 'utf8'))
  const schema = (proj.general && proj.general.properties) || {}
  const props = {}
  for (const [k, v] of Object.entries(schema)) if (v && typeof v === 'object' && v.value !== undefined) props[k] = Array.isArray(v.value) ? v.value : String(v.value)
  lib.applyRenderConfig(scene, { sceneId: PKG_ID, refrender: null, anchor: 'refcenter', clearBgFx: true, hideParticles: true, hideUI: true, properties: props, propertiesSchema: schema, log: () => {} })
  const HEADERS = new Map()
  for (const d of [path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'shaders')]) {
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) if (/^common.*\.h$/.test(f)) HEADERS.set(f, fs.readFileSync(path.join(d, f), 'utf8'))
  }
  const shaderResolver = async (rel) => { const e = entry(rel); if (e) return rd(e); return HEADERS.get(String(rel).split('/').pop()) ?? null }
  for (const l of scene.layers) for (const eff of (l.effects || [])) { try { lib.resolveEffectChain(pkg, eff, rd) } catch { /* ignore */ } }
  const textures = new Map()
  for (const l of scene.layers) {
    try {
      if (!l.image) continue
      const me = entry(l.image); if (!me) continue
      const mat = lib.resolveMaterial(JSON.parse(rd(me))); if (!mat) continue
      const mate = entry(mat.materialPath); if (!mate) continue
      const material = JSON.parse(rd(mate))
      const tn = material.passes && material.passes[0] && material.passes[0].textures && material.passes[0].textures[0]
      if (tn) { l.textureName = tn; if (!textures.has(tn)) textures.set(tn, { glTex: { id: 'tex_' + String(tn).slice(0, 20) }, width: 1024, height: 1024 }) }
    } catch { /* ignore */ }
  }
  const { gl, rec } = mkGL()
  const drawn = []
  const r = lib.createRenderer({ getContext: () => gl, width: 3840, height: 2160 }, {
    shaderResolver, onLog: () => {},
    onLayerDraw: (layer, info) => drawn.push({ n: String(layer.name || layer.id), bm: layer.colorBlendMode, isWhite: info.isWhite, qw: Math.round(info.quadW), qh: Math.round(info.quadH) }),
  })
  lib.setAudioBands(bandView(true))
  await r.render(scene, textures, 3840, 2160, 1.0)
  lib.setAudioBands(null)
  const s = byName(r.fxStats, '纯色')
  ok('⑤a 真包 3660962877「纯色#935」效果链 FBO = 2998×987（报告 §3.5 C-1 通过条件）',
    !!s && s.quadW === 2998 && s.quadH === 987, s && s.quadW + 'x' + s.quadH)
  ok('⑤b 真包该层 `fallback` 不再是 degenerateFbo、且 passes ≥ 1（报告 §3.5 C-1）',
    !!s && !s.fallback && s.passes >= 1, s && JSON.stringify({ fb: s.fallback, passes: s.passes, outKind: s.outKind }))
  const d = drawn.find((x) => x.n === '纯色')
  ok('⑤c 真包该层合成输入 `isWhite` = false（报告 §3.5 C-2）', !!d && d.isWhite === false, d && JSON.stringify(d))
  const realAudio = audioWrites(rec).filter((w) => /g_AudioSpectrum32(Left|Right)/.test(String(w.name)))
  ok('⑤d 真音频条 shader（RESOLUTION=32）在真包一帧里拿到了 32 段左右频谱（报告 §3.5 C-4 前半）',
    realAudio.length === 2 && realAudio.every((w) => w.v.length === 32), realAudio.map((w) => w.name + '/' + w.v.length).join(' '))
  ok('⑤e 真包音频条 shader 的 combo 口径：frag 也走了 BAR_STYLE=1 分支（报告 §3.5 C-6：frag 0 处 → 3 处）',
    (rec.glsl.filter((x) => /i_DCorrectingFactor/.test(x)) || []).length >= 2, rec.glsl.filter((x) => /i_DCorrectingFactor/.test(x)).length + ' 段 GLSL 带该分支')
}

// ═════════════════════════ ⑥ 同类面复扫：语料里"有 effects 但 degenerateFbo"必须归零 ═════════════════════════
{
  const dirs = fs.existsSync(SCENE_ROOT) ? fs.readdirSync(SCENE_ROOT).filter((d) => fs.existsSync(path.join(SCENE_ROOT, d, 'scene.pkg'))) : []
  if (!dirs.length) skip('语料根 ' + SCENE_ROOT)
  else {
    const MAX_MB = Number(process.env.P134_SCAN_MAX_MB || 150)
    let scanned = 0, skipped = 0
    const deg = []
    for (const id of dirs) {
      const fp = path.join(SCENE_ROOT, id, 'scene.pkg')
      const mb = fs.statSync(fp).size / 1048576
      if (mb > MAX_MB) { skipped++; continue }                    // 资源纪律：单包 >150MB 不整读
      try {
        const pkg = lib.parsePkg(fs.readFileSync(fp))
        const e = (n) => { const x = lib.getEntry(pkg, n); return x ? new Uint8Array(x) : null }
        const sc = lib.parseScene(JSON.parse(rd(e('scene.json'))))
        lib.applyRenderConfig(sc, { sceneId: id, refrender: null, anchor: 'refcenter', clearBgFx: true, hideParticles: true, hideUI: true, log: () => {} })
        const { gl } = mkGL()
        const rr = lib.createRenderer({ getContext: () => gl, width: 3840, height: 2160 }, { shaderResolver: resolverFor(FRAG), onLog: () => {} })
        lib.setAudioBands(null)
        await rr.render(sc, new Map(), 3840, 2160, 1.0)
        for (const row of Object.values(rr.fxStats.perLayer)) if (row.effects > 0 && (row.fallback === 'degenerateFbo' || row.degenerate)) deg.push(id + ' ' + row.name)
        scanned++
      } catch (err) { deg.push(id + ' 扫描抛错: ' + (err && err.message)) }
    }
    console.log('  语料复扫：包=' + scanned + '（SKIP >' + MAX_MB + 'MB：' + skipped + '）degenerateFbo 残留=' + deg.length)
    if (deg.length) console.log('   ' + deg.slice(0, 12).join('\n   '))
    ok('⑥ 同类面归零：语料里"有 effects 但 degenerateFbo"= 0（报告 §4.3 修前 32 层 / 9 包）', deg.length === 0, deg.slice(0, 6).join(' | '))
  }
}

// ═════════════════════════ ⑦ 变异自证（RED-IF-REVERTED）：改回旧写法 ⇒ 对应断言必须变红 ═════════════════════════
{
  console.log('\n⑦ RED-IF-REVERTED：把真源码逐条改回旧写法（副本落 /tmp，真树只读）')
  const SRC_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'core', 'we-scene-bundle.js')
  const SRC = fs.readFileSync(SRC_FILE, 'utf8')
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  const SIB = "src = { frag: withSiblingComboDefaults(fragSrc, vertSrc), vert: withSiblingComboDefaults(vertSrc, fragSrc), texCombos: parseTextureCombos(fragSrc) }"
  const mutants = [
    { label: 'M1(FBO 尺寸回到 : 1)', from: ': (lw0 || 1))', to: ': 1)', from2: ': (lh0 || 1))', to2: ': 1)',
      expect: (r) => r.some((c) => /①[ab]/.test(c.name) && !c.ok) && r.some((c) => /①g/.test(c.name) && !c.ok) },
    { label: 'M2(不写音频频谱 uniform)', from: '      // ①(P-134 ⑥ 第二处) 音频频谱 uniform：**只在这条效果 pass 路径上**写（无数据源 ⇒ 一个都不写）\n      bindAudioSpectrum(uni)\n', to: '',
      expect: (r) => r.some((c) => /③a/.test(c.name) && !c.ok) },
    { label: 'M3(combo 默认值不取并集)', from: SIB, to: 'src = { frag: fragSrc, vert: vertSrc, texCombos: parseTextureCombos(fragSrc) }',
      expect: (r) => r.some((c) => /④f/.test(c.name) && !c.ok) },
  ]
  const CORE = path.join(path.dirname(SRC_FILE))
  for (const mu of mutants) {
    if (!SRC.includes(mu.from) || (mu.from2 && !SRC.includes(mu.from2))) { ok('⑦ ' + mu.label + ' 变异生效（锚点在源码里）', false, '锚点不在源码里'); continue }
    let body = SRC.replace(mu.from, mu.to)
    if (mu.from2) body = body.replace(mu.from2, mu.to2)
    const tmp = path.join(os.tmpdir(), 'p134-mut-' + mu.label.replace(/[^A-Za-z0-9]/g, '') + '.mjs')
    fs.rmSync(tmp, { force: true })                              // L-02：写前先删，绝不写穿软链
    fs.writeFileSync(tmp, body.replace(/from '\.\//g, "from '" + CORE + '/'))
    let red = null, detail = ''
    try {
      const mm = await import('file://' + tmp)
      const res = await suite(mm, 'mut')
      red = mu.expect(res)
      const bad = res.filter((c) => !c.ok).map((c) => c.name.replace(/^mut｜/, ''))
      detail = '变异后变红的断言 ' + bad.length + ' 条：' + bad.slice(0, 3).join(' / ')
    } catch (e) { detail = '变异体抛错：' + String(e && e.message).slice(0, 120) }
    finally { fs.rmSync(tmp, { force: true }) }
    console.log('   RED ' + (red ? '变异生效' : '变异**没红**') + '｜' + mu.label + '：' + detail)
    ok('⑦ ' + mu.label + ' ⇒ 对应断言变红（RED-IF-REVERTED）', red === true, detail)
  }
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^p134-mut-.*\.mjs$/.test(f))
  ok('⑦ 真树 `core/we-scene-bundle.js` 跑前跑后 sha256 相同（变异副本落 /tmp 且已 unlink）',
    shaOf(SRC_FILE) === srcSha && leftovers.length === 0, srcSha.slice(0, 16) + ' /tmp 残留=' + leftovers.length)
}

console.log('\n===== effects-degenerate-fbo: ' + passN + ' 通过 / ' + fails.length + ' 失败 =====')
if (fails.length) console.log('失败项:\n  ' + fails.join('\n  '))
process.exit(fails.length ? 1 : 0)

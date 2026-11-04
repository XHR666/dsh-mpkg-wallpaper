/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // mock-GL 端到端验证 P0-1/2/5/6（v3：TEXTUREn 常量正确映射、参数索引修正、onLog 捕获）
// ①(P-59) 追加场景 4/5：粒子贴图解析/quad 几何/形状通道（tex.a）+ 粒子预算（默认档 / ?lowmem / ?pmax）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const logs = []
const events = { pointer: [], draw: [] }
let ids = 0, curVao = null, curUnit = 0, curFboObj = null, curProg = null, bufLast = null
const shaderSrcs = []
const curTex = new Array(8).fill(null)
const tid = (t) => (t ? (t.__mpwId || t.id || 'anon') : null)
const mk = (kind) => ({ id: kind + '#' + (++ids) })
const handlers = {
  createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
  createShader: () => mk('sh'), createProgram: () => mk('prog'),
  // mock 里 VERTEX_SHADER/FRAGMENT_SHADER 都退化成 1（CONST 无该键）→ 按内容筛选（见场景 4 (d)）
  shaderSource: (s, src) => { shaderSrcs.push(String(src)) },
  bindVertexArray: (v) => { curVao = v }, activeTexture: (u) => { curUnit = u },
  bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  vertexAttribPointer: (...a) => events.pointer.push({ vao: curVao && curVao.id, args: a }),
  bindFramebuffer: (t, f) => { curFboObj = f }, useProgram: (p) => { curProg = p },
  bufferData: (t, data) => { bufLast = data && data.length ? Float32Array.from(data) : null },
  drawArrays: (m, f, c) => events.draw.push({ prog: curProg && curProg.id, vao: curVao && curVao.id, fbo: curFboObj && curFboObj.id, tex: curTex.map(tid), count: c, verts: bufLast, uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) }),
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
  // ①(RE-31) 粒子 VS 属性槽：pos3@0 / uv2@1 / uv2B@2 / blend@3 / alpha@4（与真实 link 顺序一致）
  getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : n === 'a_TexCoordB' ? 2 : n === 'a_Blend' ? 3 : n === 'a_Alpha' ? 4 : -1,
  // ①(P-65) uniform 位置带名字 → 可断言 u_TexFmt 真的按贴图 format 上传（旧实现恒 {u:1} 无法区分）
  getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
  uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
  uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
  uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
}
const progUni = new Map()
function setUni(loc, v) { if (loc && loc.p && loc.n) { if (!progUni.has(loc.p.id)) progUni.set(loc.p.id, {}); progUni.get(loc.p.id)[loc.n] = v } }
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const canvas = { getContext: () => gl }
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG2 = 'uniform sampler2D g_Texture0; uniform sampler2D g_Texture1; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) + texture(g_Texture1, v_TexCoord); }'
const FRAG1 = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => rel.includes('blurx') ? (rel.endsWith('.vert') ? VERT : FRAG1) : (rel.endsWith('.vert') ? VERT : FRAG2)
function mkLayer(extra) {
  return Object.assign({ id: 1, name: '测试层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
}
const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])
let pass = 0, fail = 0
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }
const isFBO = (s) => typeof s === 'string' && /^tex#\d+$/.test(s)

// ---- 场景 1：blurprecise 型两 pass ----
{
  logs.length = 0
  const r = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  const initPtrs = events.pointer.splice(0)
  events.draw.length = 0
  const eff = { file: 'fx', visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [{ name: '_rt_FullCompoBuffer1' }], materialPasses: [
    { shader: 'blurx', blending: 'normal', target: '_rt_FullCompoBuffer1', binds: [], textures: [], combos: {}, constants: {} },
    { shader: 'blury', blending: 'normal', target: null, binds: [{ index: 0, name: '_rt_FullCompoBuffer1' }, { index: 1, name: 'previous' }], textures: [], combos: {}, constants: {} } ] }
  await r.render(mkScene([mkLayer({ effects: [eff] })]), textures, 640, 360, 0.016)
  const d = events.draw
  if (d.length !== 4) console.log('  [debug] logs=' + JSON.stringify((typeof logs !== 'undefined' ? logs : []).slice(-4)))
  if (d.length !== 4) console.log('  [debug] draws=' + JSON.stringify(d.map((x) => ({ prog: x.prog, vao: x.vao, tex: (x.tex || []).map((t) => t && String(t).slice(0, 14)) }))))
  check('共 4 次 draw（copy + fx0 + fx1 + 合成）', d.length === 4, '实际 ' + d.length)
  if (d.length === 4) {
    const fboA = d[1].tex[0]
    check('copy pass T0=层纹理 user_tex_a', d[0].tex[0] === 'user_tex_a', JSON.stringify(d[0].tex[0]))
    check('fx0 T0=链输入 fboA（asInput）', isFBO(fboA), JSON.stringify(fboA))
    check('★fx1 T0=命名 FBO（bind 生效；修复前=fboA）', isFBO(d[2].tex[0]) && d[2].tex[0] !== fboA, 'T0=' + JSON.stringify(d[2].tex[0]) + ' fboA=' + JSON.stringify(fboA))
    check('★fx1 T1=previous→链输入 fboA', d[2].tex[1] === fboA, JSON.stringify(d[2].tex[1]))
    check('合成读 fx 输出 FBO', isFBO(d[3].tex[0]) && d[3].tex[0] !== fboA, JSON.stringify(d[3].tex[0]))
    const ptrVaos = [...new Set(events.pointer.map(p => p.vao))]
    check('渲染期无指针设置落在主 vao 上（VAO 未被劫持）', !ptrVaos.includes(d[3].vao), 'ptrVaos=' + JSON.stringify(ptrVaos) + ' 主vao=' + d[3].vao)
    check('fx pass 用独立 fxVao（≠主 vao）', d[1].vao !== d[3].vao, 'fx=' + d[1].vao + ' 主=' + d[3].vao)
  }
}
// ---- 场景 2：反馈守卫 ----
{
  logs.length = 0
  const r2 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  events.draw.length = 0
  const eff2 = { file: 'fx2', visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [{ name: '_rt_X' }], materialPasses: [
    { shader: 'blurx', blending: 'normal', target: '_rt_X', binds: [{ index: 0, name: '_rt_X' }], textures: [], combos: {}, constants: {} } ] }
  await r2.render(mkScene([mkLayer({ effects: [eff2] })]), textures, 640, 360, 0.016)
  const d = events.draw
  check('反馈守卫日志触发', logs.some((m) => m.includes('反馈环拦截')), JSON.stringify(logs))
  check('守卫后采样纹理≠1x1/空（改绑了链输入 FBO）', d.length >= 2 && isFBO(d[1].tex[0]), JSON.stringify(d[1] && d[1].tex[0]))
}
// ---- 场景 3：粒子 alpha ----
{
  logs.length = 0
  const r3 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  const initPtrs = events.pointer.splice(0)
  events.draw.length = 0
  const def = { maxcount: 10, emitter: [{ name: 'boxrandom', rate: 100, distancemin: '0 0 0', distancemax: '10 10 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }], initializer: [{ name: 'lifetimerandom', min: 1, max: 2 }] }
  await r3.render(mkScene([mkLayer({ textureName: null, effects: [], particle: 'p', particleDef: def, particleTexName: 'tex_a' })]), textures, 640, 360, 0.5)
  // ①(RE-31)：stride 24 → 36（pos3 + uv2 + uv2B@20 + blend@28 + alpha@32）
  const partPtrs = initPtrs.filter((p) => p.args[4] === 36)
  // args = [index, size, type, normalized, stride, offset]
  const hasUvB = partPtrs.some((p) => p.args[0] === 2 && p.args[1] === 2 && p.args[5] === 20)
  const hasBlend = partPtrs.some((p) => p.args[0] === 3 && p.args[1] === 1 && p.args[5] === 28)
  const hasAlpha = partPtrs.some((p) => p.args[0] === 4 && p.args[1] === 1 && p.args[5] === 32)
  check('partVao 指针 stride=36（uv2B@20 / blend@28 / alpha@32）', partPtrs.length >= 4 && hasUvB && hasBlend && hasAlpha, JSON.stringify(initPtrs.map((p) => p.args)))
  const pdRaw = []
  check('粒子批绘制发生', events.draw.some((x) => x.count > 6), JSON.stringify(events.draw.map((x) => x.count)))
}
// ---- 场景 4：粒子层贴图解析 / quad 几何 / 形状通道（P-59 用户第 1/2/5/6 项回归） ----
//   背景：P-56 把粒子改成默认开后，真机看到「无贴图的白色三角形」。两个根因：
//     ① PARTICLE_FS 把 tex.r 当形状 → halo 类贴图（RGB 恒 255、形状在 alpha）alpha 恒 1 = 实心白 quad；
//     ② 六顶点表 cys 写错 → 第二三角形两顶点重合（面积 0）→ 每个粒子只画出半个 quad。
{
  logs.length = 0
  shaderSrcs.length = 0
  const r4 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  const def30 = { maxcount: 30, emitter: [{ name: 'boxrandom', rate: 300, distancemin: '0 0 0', distancemax: '40 40 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }],
    initializer: [{ name: 'lifetimerandom', min: 5, max: 10 }, { name: 'sizerandom', min: 20, max: 40 }] }
  const tex4 = new Map([
    ['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }],
    ['particle/halo', { glTex: { __mpwId: 'part_halo' }, width: 64, height: 64 }],
  ])
  // (a) 贴图没解析出来（层没有 particleTexName）→ 必须跳过，0 次粒子绘制
  events.draw.length = 0
  await r4.render(mkScene([mkLayer({ textureName: null, effects: [], particle: 'p', particleDef: def30, particleTexName: null })]), tex4, 640, 360, 0.5)
  const a4 = events.draw.filter((d) => d.count > 6)
  check('(a) 无贴图粒子层跳过（0 次粒子 draw，不画白块）', a4.length === 0, 'draws=' + JSON.stringify(events.draw.map((d) => d.count)))
  check('(a) 跳过计入 skippedTex 统计', r4.particleStats.skippedTex === 1, JSON.stringify(r4.particleStats))
  // (b) 贴图能解析（纹理表里有 glTex）→ 绘制，且绑定的是该贴图（绝不是渲染器 whiteTex）
  events.draw.length = 0
  await r4.render(mkScene([mkLayer({ textureName: null, effects: [], particle: 'p', particleDef: def30, particleTexName: 'particle/halo' })]), tex4, 640, 360, 0.5)
  const b4 = events.draw.filter((d) => d.count > 6)
  check('(b) 有贴图粒子层绘制 1 次批', b4.length === 1, 'draws=' + JSON.stringify(b4.map((d) => d.count)))
  check('(b) 绑定真实粒子贴图（≠ whiteTex）', !!b4[0] && b4[0].tex[0] === 'part_halo' && b4[0].tex[0] !== tid(r4.whiteTex),
    'tex=' + JSON.stringify(b4[0] && b4[0].tex) + ' whiteTex=' + tid(r4.whiteTex))
  // (c) quad 几何：两个三角形都非退化，且 UV 覆盖整图四角（不再退化成反对角线）
  if (b4[0] && b4[0].verts) {
    const v = b4[0].verts
    const area = (i) => (v[(i + 1) * 9 + 0] - v[i * 9 + 0]) * (v[(i + 2) * 9 + 1] - v[i * 9 + 1]) - (v[(i + 2) * 9 + 0] - v[i * 9 + 0]) * (v[(i + 1) * 9 + 1] - v[i * 9 + 1])
    const uv = []
    for (let k = 0; k < 6; k++) uv.push(v[k * 9 + 3].toFixed(3) + ',' + v[k * 9 + 4].toFixed(3))
    const corners = [...new Set(uv)].sort().join(' ')
    check('(c) 三角形 A 非退化', Math.abs(area(0)) > 1e-9, 'area=' + area(0))
    check('(c) 三角形 B 非退化（旧代码恒 0 = 只画半个 quad）', Math.abs(area(3)) > 1e-9, 'area=' + area(3))
    check('(c) UV 覆盖整图 0/1 四角', corners === '0.000,0.000 0.000,1.000 1.000,0.000 1.000,1.000', corners)
  } else check('(c) 顶点流可读', false, 'no verts')
  // (d) 形状通道：粒子 FS 必须乘纹理 alpha（官方 genericparticle.frag:43 语义），不得用 tex.r 当形状
  const pfs = shaderSrcs.filter((s) => s.includes('v_Blend') && s.includes('u_Alpha'))
  check('(d) 粒子 FS 捕获到（v_Blend/u_Alpha）', pfs.length > 0, 'shaders=' + shaderSrcs.length)
  check('(d) 粒子 FS 用纹理 alpha 当形状（tex.a），不用 tex.r', pfs.length > 0 && pfs.every((s) => /tex\.a/.test(s)) && !pfs.some((s) => /texR/.test(s)),
    pfs.map((s) => (s.match(/fragColor = [^;]+;/) || [''])[0]).join(' | '))
  // (d2) 真机同款贴图证据：halo 类贴图 RGB 恒 255、形状在 alpha（本地无官方资产则跳过）
  const HALO = `${MPW_WS}/wallpaper_engine/assets/materials/particle/halo.tex`
  if (fs.existsSync(HALO)) {
    const tx = lib.parseTex(new Uint8Array(fs.readFileSync(HALO)))
    const m0 = lib.decodeMip0(tx)
    let red255 = 0, aMin = 255, aMax = 0
    for (let i = 0; i < m0.width * m0.height; i++) { const o = i * 4; if (m0.rgba[o] === 255) red255++; const a = m0.rgba[o + 3]; if (a < aMin) aMin = a; if (a > aMax) aMax = a }
    const n = m0.width * m0.height
    check('(d2) 官方 halo.tex：red 恒 255（用 .r 当形状 = 实心白）且 alpha 有形状', red255 === n && aMin === 0 && aMax > 200,
      `red255=${red255}/${n} aMin=${aMin} aMax=${aMax}`)
  } else console.log('  SKIP (d2) 无官方 halo.tex（WE_ASSETS 缺失）')
}
// ---- 场景 5：粒子预算（P-59 用户第 2 项「直接两帧」） ----
{
  logs.length = 0
  const defBig = { maxcount: 30, emitter: [{ name: 'boxrandom', rate: 400, distancemin: '0 0 0', distancemax: '80 80 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }],
    initializer: [{ name: 'lifetimerandom', min: 5, max: 10 }, { name: 'sizerandom', min: 20, max: 40 }] }
  const mkPart = (i) => mkLayer({ id: 100 + i, name: 'p' + i, textureName: null, effects: [], particle: 'p', particleDef: defBig, particleTexName: 'particle/halo' })
  const tex5 = new Map([['particle/halo', { glTex: { __mpwId: 'part_halo' }, width: 64, height: 64 }]])
  // 默认档：数值必须与 README-DIAGNOSTICS 一致
  const r5 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  const b5 = r5.particleStats.budget
  check('默认档 perLayer=240 / total=1200 / layers=16', b5.perLayer === 240 && b5.total === 1200 && b5.layers === 16, JSON.stringify(b5))
  events.draw.length = 0
  await r5.render(mkScene([mkPart(1), mkPart(2), mkPart(3)]), tex5, 640, 360, 10)
  const p5 = events.draw.filter((d) => d.count > 6).map((d) => d.count / 6)
  const sum5 = p5.reduce((a, b) => a + b, 0)
  check('默认档：每层 ≤240 且整帧 ≤1200 粒', p5.every((n) => n <= 240) && sum5 <= 1200 && sum5 > 0, 'perLayer=' + JSON.stringify(p5) + ' sum=' + sum5)
  // 低内存档（?lowmem=1，插件对低内存设备自动透传）
  const savedLoc = globalThis.location
  globalThis.location = { search: '?lowmem=1' }
  const r6 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  globalThis.location = savedLoc
  const b6 = r6.particleStats.budget
  check('?lowmem=1 → perLayer=80 / total=320 / layers=6', b6.perLayer === 80 && b6.total === 320 && b6.layers === 6 && b6.tier === 'lowmem', JSON.stringify(b6))
  // ?pmax=<n> 现场调参
  globalThis.location = { search: '?pmax=7' }
  const r7 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  globalThis.location = savedLoc
  check('?pmax=7 → perLayer=7（档位不变）', r7.particleStats.budget.perLayer === 7 && r7.particleStats.budget.tier === 'default', JSON.stringify(r7.particleStats.budget))
  // 硬上限真的生效：3 层 × 30 粒，perLayer=4 / total=8 / layers=2 → ≤2 次 draw、每层 ≤4 粒、合计 ≤8
  const r8 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)), particleBudget: { perLayer: 4, total: 8, layers: 2, steps: 400, tier: 'test' } })
  events.draw.length = 0
  await r8.render(mkScene([mkPart(1), mkPart(2), mkPart(3)]), tex5, 640, 360, 10)
  const p8 = events.draw.filter((d) => d.count > 6).map((d) => d.count / 6)
  const s8 = r8.particleStats
  check('预算硬上限：≤2 层 / 每层 ≤4 粒 / 合计 ≤8', p8.length <= 2 && p8.every((n) => n <= 4) && p8.reduce((a, b) => a + b, 0) <= 8,
    'draws=' + JSON.stringify(p8) + ' stat=' + JSON.stringify({ layers: s8.layers, drawn: s8.drawn, alive: s8.alive, skippedBudget: s8.skippedBudget }))
  check('超预算层计入 skippedBudget', s8.skippedBudget >= 1, JSON.stringify(s8))
  // (f) renderer 分派（P-59 B → P-65 重写）：rope/ropetrail/spritetrail 现在走**官方几何**
  //     （rope/ropetrail = 按发射序/历史连 ribbon；spritetrail = 沿速度拉伸一条精灵），
  //     不再"按普通贴图 quad 近似"（那会把长条贴图画成竖线，用户第 8/9/10 项）。
  logs.length = 0
  events.draw.length = 0
  const r9 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  const ropeDef = Object.assign({}, defBig, { renderer: [{ id: 1, name: 'rope' }] })
  await r9.render(mkScene([mkLayer({ id: 900, name: 'Trails 2', textureName: null, effects: [], particle: 'p', particleDef: ropeDef, particleTexName: 'particle/halo' })]), tex5, 640, 360, 10)
  const p9 = events.draw.filter((d) => d.count > 6)
  check('(f) rope 层被绘制为 ribbon（段四边形，顶点数 = 6×段数）', p9.length === 1 && p9[0].count > 6 && p9[0].count % 6 === 0, 'draws=' + JSON.stringify(p9.map((d) => d.count)))
  check('(f) rope 层写进 particleStats.renderers', r9.particleStats.renderers.rope === 1, JSON.stringify(r9.particleStats.renderers))
  check('(f) rope 走官方几何 log（"官方几何"，不再写"未实现"）', logs.some((m) => m.includes('renderer=rope') && m.includes('官方几何')), JSON.stringify(logs.slice(-2)))
  check('(f) rope 段计入 particleStats.trailSegments/trailDrawn', r9.particleStats.trailSegments > 0 && r9.particleStats.trailDrawn === 1,
    JSON.stringify({ seg: r9.particleStats.trailSegments, drawn: r9.particleStats.trailDrawn }))
  // (f2) rope 的 V 方向（官方 genericropeparticle.vert:53-56「New particles are at the end of the array」）：
  //      trailPosition 越大 ⇒ uvMin 越小 ⇒ **最新端 V≈0、最老端 V≈1**。
  if (p9.length === 1 && p9[0].verts && p9[0].count >= 12) {
    const vv = p9[0].verts, nseg0 = p9[0].count / 6
    const vFirst = (vv[4] + vv[9 + 4]) / 2
    const lastB = (nseg0 - 1) * 6
    const vLast = (vv[lastB * 9 + 4] + vv[(lastB + 1) * 9 + 4]) / 2
    check('(f2) rope V 随段号递减（最新端 V≈0，官方 THICK 分支）', vFirst > vLast && vLast < 0.2 && vFirst > 0.8,
      `段0 V=${vFirst.toFixed(3)} 段${nseg0 - 1} V=${vLast.toFixed(3)}`)
  }
  // (g) 发射率上限（rate）：官方有 rate=5000 的定义；rateMul 必须按上限等比降（只降不升）
  logs.length = 0
  const r10 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)),
    particleBudget: { perLayer: 1000, total: 1000, layers: 8, steps: 400, rate: 240, tier: 'test' } })
  const fastDef = { maxcount: 1000, emitter: [{ name: 'boxrandom', rate: 1000, distancemin: '0 0 0', distancemax: '40 40 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }],
    initializer: [{ name: 'lifetimerandom', min: 20, max: 30 }, { name: 'sizerandom', min: 20, max: 40 }] }
  events.draw.length = 0
  await r10.render(mkScene([mkLayer({ id: 901, name: 'rate层', textureName: null, effects: [], particle: 'p', particleDef: fastDef, particleTexName: 'particle/halo' })]), tex5, 640, 360, 2)
  const drawn10 = events.draw.filter((d) => d.count > 6).reduce((a, d) => a + d.count / 6, 0)
  // rate 1000/s × 2s = 2000 粒（不限流）；限流到 240/s → ≲480 粒（留相位余量）
  check('(g) rate 1000/s 的层被限流（2s 内 ≲480 粒，不限流会 >1000）', drawn10 > 100 && drawn10 <= 520, 'drawn=' + drawn10)
  check('(g) 限流计入 rateCapped（只降不升）', r10.particleStats.rateCapped === 1 && r10.particleStats.rateCap === 240, JSON.stringify({ rc: r10.particleStats.rateCapped, cap: r10.particleStats.rateCap }))
  check('(g) 限流一次性 log（不静默）', logs.some((m) => m.includes('发射率') && m.includes('→ 240/s')), JSON.stringify(logs.slice(-2)))
}
// ---- 场景 6：P-65 粒子形状通道（TEX0FORMAT）+ trail 几何（用户第 8/9/10/12/13 项）----
//   ① 官方 common_fragment.h:92-113 ConvertTexture0Format：RG88→.rrrg、R8→(1,1,1,.r)、其余透传。
//      不做这一步时 particle/fog/fog1(R8)、particle/light/light_shafts_0、beam_1(RG88) 的
//      quad 四角 alpha 实测 1.000、不透明片元 100% = 用户第 12 项「红色的方块 + 中间一点黄色」。
//   ② 官方 common_particles.h:41-57 spritetrail：corner = P + size·right·(u−.5) − size·up·(v−.5)·ratio，
//      up = V̂ · min(|V|·length, maxlength) ⇒ 长条贴图沿速度拉伸，而不是轴对齐竖线（第 10 项）。
//   ③ 官方 genericropeparticle.vert：rope 把存活粒子按发射序连 ribbon；粒子全重合 ⇒ 段面积 0 ⇒ 不上屏
//      （Trails 2 / 3326873240 的"屏幕中间一摞竖条"就此消失，用户第 8/9 项）。
{
  logs.length = 0
  shaderSrcs.length = 0
  const r11 = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
  // (h) 粒子 FS 源码：必须含官方两分支 + u_TexFmt，且仍保留 P-59 的 tex.a 形状口径
  const pfs6 = shaderSrcs.filter((s) => s.includes('v_Blend') && s.includes('u_Alpha'))
  const fs6 = pfs6[pfs6.length - 1] || ''
  check('(h) 粒子 FS 有 u_TexFmt（TEX0FORMAT 入口）', /uniform\s+float\s+u_TexFmt/.test(fs6))
  check('(h) 粒子 FS 含 RG88 分支 vec4(s.r,s.r,s.r,s.g)（官方 _sample.rrrg）', /s\.r,\s*s\.r,\s*s\.r,\s*s\.g/.test(fs6))
  check('(h) 粒子 FS 含 R8 分支 vec4(1.0,1.0,1.0,s.r)', /1\.0,\s*1\.0,\s*1\.0,\s*s\.r/.test(fs6))
  check('(h) 粒子 FS 仍乘纹理 alpha（P-59 不回归）', /tex\.a/.test(fs6) && !/texR/.test(fs6))
  // (i) 真机同款贴图：官方 R8 fog1 / RG88 light_shafts_0 / ARGB halo，逐张核 format + 通道事实
  const WEA = `${MPW_WS}/wallpaper_engine/assets/materials/`
  const fmtOf = (rel) => { try { return lib.parseTex(new Uint8Array(fs.readFileSync(WEA + rel))).format } catch { return null } }
  if (fs.existsSync(WEA + 'particle/fog/fog1.tex')) {
    const t8 = lib.parseTex(new Uint8Array(fs.readFileSync(WEA + 'particle/fog/fog1.tex')))
    const m8 = lib.decodeMip0(t8)
    let a255 = 0, n8 = 0
    for (let i = 0; i < m8.width * m8.height; i++) { if (m8.rgba[i * 4 + 3] >= 250) a255++; n8++ }
    check('(i) 官方 fog1(R8) 的 alpha 恒 255（不转换 ⇒ 实心矩形 = 第 12 项红方块）', t8.format === 9 && a255 === n8, `fmt=${t8.format} a255=${a255}/${n8}`)
  } else console.log('  SKIP (i) 无官方 fog1.tex')
  const fmtR8 = fmtOf('particle/fog/fog1.tex'), fmtRG = fmtOf('particle/light/light_shafts_0.tex')
  check('(i) texFormatOf 优先级：texObj.format > glTex.__mpwTexFmt > rg88', (() => {
    const glT = { __mpwTexFmt: 9 }
    return lib.texFormatOf({ format: 8, glTex: glT, rg88: true }) === 8 &&
      lib.texFormatOf({ glTex: glT }) === 9 &&
      lib.texFormatOf({ glTex: {}, rg88: true }) === 8 &&
      lib.texFormatOf({ glTex: {} }) === -1
  })())
  // (j) 上传链路盖章：真 R8/RG88 .tex → decodeMip0 → makeTextureMip → glTex.__mpwTexFmt
  check('(j) decodeMip0 带 fmt + makeTextureMip 盖 __mpwTexFmt（R8=9 / RG88=8）', (() => {
    if (fmtR8 !== 9 || fmtRG !== 8) return false
    const dec8 = lib.decodeMip0(lib.parseTex(new Uint8Array(fs.readFileSync(WEA + 'particle/fog/fog1.tex'))))
    const decRG = lib.decodeMip0(lib.parseTex(new Uint8Array(fs.readFileSync(WEA + 'particle/light/light_shafts_0.tex'))))
    const t8 = lib.makeTextureMip(gl, [dec8], false), tRG = lib.makeTextureMip(gl, [decRG], true)
    return dec8.fmt === 9 && decRG.fmt === 8 && t8.__mpwTexFmt === 9 && tRG.__mpwTexFmt === 8
  })(), `fog1.fmt=${fmtR8} light_shafts_0.fmt=${fmtRG}`)
  // (k) 真的按贴图格式上传 u_TexFmt + shapeFrom 记账
  const texF = new Map([
    ['r8tex', { glTex: Object.assign({ __mpwId: 'r8' }, { __mpwTexFmt: 9 }), width: 1024, height: 1024, format: 9 }],
    ['rgtex', { glTex: Object.assign({ __mpwId: 'rg' }, { __mpwTexFmt: 8 }), width: 256, height: 512, format: 8 }],
    ['rgbatex', { glTex: { __mpwId: 'rgba' }, width: 64, height: 64, format: 0 }],
  ])
  const defSp = { maxcount: 6, emitter: [{ name: 'boxrandom', rate: 100, distancemin: '0 0 0', distancemax: '0 0 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }],
    initializer: [{ name: 'lifetimerandom', min: 20, max: 20 }, { name: 'sizerandom', min: 20, max: 20 }] }
  const mkP = (tex, extra) => mkLayer(Object.assign({ id: 910, name: 'p-' + tex, textureName: null, effects: [], particle: 'p', particleDef: defSp, particleTexName: tex }, extra || {}))
  for (const [tex, want, key] of [['r8tex', 9, 'r8'], ['rgtex', 8, 'rg88'], ['rgbatex', 0, 'rgba']]) {
    events.draw.length = 0
    const rr = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    await rr.render(mkScene([mkP(tex)]), texF, 640, 360, 5)
    const dd = events.draw.filter((d) => d.count > 6)
    check(`(k) ${key} 贴图：u_TexFmt 按 format 上传 (=${want})`, dd.length === 1 && dd[0].uni && dd[0].uni.u_TexFmt === want,
      'uni=' + JSON.stringify(dd[0] && dd[0].uni) + ' 期望 fmt=' + want)
    check(`(k) ${key} 贴图计入 particleStats.shapeFrom.${key}`, rr.particleStats.shapeFrom[key] === 1, JSON.stringify(rr.particleStats.shapeFrom))
  }
  // (l) spritetrail：长轴沿速度 + 沿速度拉伸 = size·min(|V|·length, maxlength)·textureRatio
  //     速度水平 (S,0)、贴图 64x64(ratio=1)、size=SZ → quad 宽 = SZ·min(S·L,ML)、高 = SZ
  //     注：mkScene 的投影是 1920x1080 → NDC 反解用 cam.projW/projH（不是画布 640x360）。
  {
    const S = 100, L = 0.1, ML = 100, SZ = 20, PW = 1920, PH = 1080
    const def = { maxcount: 4, renderer: [{ name: 'spritetrail', length: L, maxlength: ML }],
      emitter: [{ name: 'boxrandom', rate: 400, distancemin: '0 0 0', distancemax: '0 0 0', origin: '0 0 0', directions: '1 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 20, max: 20 }, { name: 'sizerandom', min: SZ, max: SZ }, { name: 'velocityrandom', min: S + ' 0 0', max: S + ' 0 0' }] }
    events.draw.length = 0
    const rs = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    await rs.render(mkScene([mkLayer({ id: 920, name: 'sp', textureName: null, effects: [], particle: 'p', particleDef: def, particleTexName: 'rgbatex' })]), texF, 640, 360, 3)
    const ds = events.draw.filter((d) => d.count > 6)
    if (!ds.length || !ds[0].verts) check('(l) spritetrail 顶点流可读', false, 'no verts')
    else {
      const v = ds[0].verts
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (let k = 0; k < ds[0].count; k++) { const X = v[k * 9], Y = v[k * 9 + 1]; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y }
      const wPx = (x1 - x0) / 2 * PW, hPx = (y1 - y0) / 2 * PH
      // ①(P-74 ②) quad 边长口径 = p.size/2（行为对照：第三方参考实现 wer-ref WPParticleRawGener.cpp:85
      //   在写顶点属性前先把 size 减半，减半值即 `common_particles.h:52-56` 展开式里的 `positionAndSize.w`；
      //   以 (uv−0.5) 跨度 1 展开 ⇒ 边长 = w）。
      //   P-65 及之前把 p.size 当跨度 ⇒ 这里是官方的 2×（`?psize=legacy` 可复现旧值）。
      const expW = SZ / 2 * Math.min(S * L, ML), expH = SZ / 2
      check('(l) spritetrail 沿速度拉伸：quad 宽 = size/2·min(|V|·length,maxlength)（官方口径）', Math.abs(wPx - expW) <= 2, `实测宽=${wPx.toFixed(1)} 期望=${expW}`)
      check('(l) spritetrail 横向宽度 = size/2（官方口径，垂直速度方向）', Math.abs(hPx - expH) <= 2, `实测高=${hPx.toFixed(1)} 期望=${expH}`)
      {
        const saved2 = globalThis.location
        globalThis.location = { search: '?psize=legacy' }
        events.draw.length = 0
        const rl = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
        await rl.render(mkScene([mkLayer({ id: 921, name: 'sp-legacy', textureName: null, effects: [], particle: 'p', particleDef: def, particleTexName: 'rgbatex' })]), texF, 640, 360, 3)
        globalThis.location = saved2
        const dl = events.draw.filter((d) => d.count > 6)
        if (!dl.length || !dl[0].verts) check('(l) ?psize=legacy 顶点流可读', false, 'no verts')
        else {
          const v2 = dl[0].verts
          let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
          for (let k = 0; k < dl[0].count; k++) { const X = v2[k * 9], Y = v2[k * 9 + 1]; if (X < a0) a0 = X; if (X > a1) a1 = X; if (Y < b0) b0 = Y; if (Y > b1) b1 = Y }
          const lw = (a1 - a0) / 2 * PW, lh = (b1 - b0) / 2 * PH
          check('(l) ?psize=legacy 复现 P-65 旧口径（宽高都 ×2）',
            Math.abs(lw - SZ * Math.min(S * L, ML)) <= 3 && Math.abs(lh - SZ) <= 3,
            `legacy 宽=${lw.toFixed(1)} 高=${lh.toFixed(1)}  期望=${SZ * Math.min(S * L, ML)}/${SZ}`)
        }
      }
    }
    check('(l) spritetrail 计入 renderers/trailLayers', rs.particleStats.renderers.spritetrail === 1 && rs.particleStats.trailLayers.spritetrail === 1, JSON.stringify(rs.particleStats.renderers))
  }
  // (m) rope 退化（Trails 2 真机形态）：粒子全重合 → **不上屏**（旧实现画出 19 条竖线）
  {
    const defRope = { maxcount: 20, renderer: [{ name: 'rope' }],
      emitter: [{ name: 'sphererandom', rate: 400, distancemin: '0 0 0', distancemax: '0 0 0', origin: '0 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 20, max: 20 }, { name: 'sizerandom', min: 10, max: 15 }],
      operator: [{ name: 'movement', drag: 0 }, { name: 'alphafade', fadeintime: 0.1, fadeouttime: 0.1 }] }
    logs.length = 0
    events.draw.length = 0
    const rr = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    await rr.render(mkScene([mkLayer({ id: 930, name: 'Trails 2', textureName: null, effects: [], particle: 'p', particleDef: defRope, particleTexName: 'rgbatex' })]), texF, 640, 360, 6)
    const dr = events.draw.filter((d) => d.count > 6)
    check('(m) rope 退化（粒子重合）→ 0 次粒子 draw（旧实现画 19 条竖线）', dr.length === 0, 'draws=' + JSON.stringify(dr.map((d) => d.count)))
    check('(m) 退化段计入 trailDegenerate', rr.particleStats.trailDegenerate >= 1, JSON.stringify({ deg: rr.particleStats.trailDegenerate, seg: rr.particleStats.trailSegments }))
    check('(m) 退化一次 log（不静默）', logs.some((m) => m.includes('0 有效段')), JSON.stringify(logs.slice(-2)))
  }
  // (n) ?trail=off 整层跳过；?trail=quad 退回 P-59 旧几何（A/B 开关真的有效）
  {
    const defRope = { maxcount: 6, renderer: [{ name: 'rope' }],
      emitter: [{ name: 'boxrandom', rate: 200, distancemin: '0 0 0', distancemax: '60 60 0', origin: '0 0 0', directions: '1 1 0', speedmin: 0, speedmax: 0 }],
      initializer: [{ name: 'lifetimerandom', min: 20, max: 20 }, { name: 'sizerandom', min: 10, max: 15 }] }
    const saved = globalThis.location
    globalThis.location = { search: '?trail=off' }
    events.draw.length = 0
    const ro = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    await ro.render(mkScene([mkLayer({ id: 940, name: 'off层', textureName: null, effects: [], particle: 'p', particleDef: defRope, particleTexName: 'rgbatex' })]), texF, 640, 360, 6)
    globalThis.location = saved
    const doff = events.draw.filter((d) => d.count > 6)
    check('(n) ?trail=off → 0 次粒子 draw + trailSkipped=1', doff.length === 0 && ro.particleStats.trailSkipped === 1 && ro.particleStats.trailMode === 'off',
      JSON.stringify({ draws: doff.length, s: ro.particleStats.trailSkipped, m: ro.particleStats.trailMode }))
    globalThis.location = { search: '?trail=quad' }
    events.draw.length = 0
    const rq = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    await rq.render(mkScene([mkLayer({ id: 941, name: 'quad层', textureName: null, effects: [], particle: 'p', particleDef: defRope, particleTexName: 'rgbatex' })]), texF, 640, 360, 6)
    globalThis.location = saved
    const dq = events.draw.filter((d) => d.count > 6)
    // 旧几何：每粒子 6 顶点（轴对齐 quad），合计 = 粒子数×6
    check('(n) ?trail=quad → 退回每粒子 6 顶点的轴对齐 quad（P-59 旧行为可 A/B）',
      dq.length === 1 && dq[0].count % 6 === 0 && rq.particleStats.trailSegments === 0 && rq.particleStats.trailMode === 'quad',
      JSON.stringify({ count: dq[0] && dq[0].count, seg: rq.particleStats.trailSegments, m: rq.particleStats.trailMode }))
  }
  // (o) ropetrail：每粒子位置历史连 ribbon（段数受 segments 上限约束）
  {
    const defRT = { maxcount: 8, renderer: [{ name: 'ropetrail', length: 0.5 }],
      emitter: [{ name: 'boxrandom', rate: 100, distancemin: '0 0 0', distancemax: '0 0 0', origin: '0 0 0', directions: '1 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 20, max: 20 }, { name: 'sizerandom', min: 10, max: 14 }, { name: 'velocityrandom', min: '60 0 0', max: '60 0 0' }],
      operator: [{ name: 'movement', drag: 0 }] }
    logs.length = 0
    events.draw.length = 0
    const rr = createRenderer(canvas, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    await rr.render(mkScene([mkLayer({ id: 950, name: 'rt层', textureName: null, effects: [], particle: 'p', particleDef: defRT, particleTexName: 'rgbatex' })]), texF, 640, 360, 4)
    const drt = events.draw.filter((d) => d.count > 6)
    check('(o) ropetrail 走历史 ribbon（>1 段且顶点数 = 6×段数）',
      drt.length === 1 && drt[0].count > 6 && drt[0].count % 6 === 0 && rr.particleStats.trailSegments > 1,
      JSON.stringify({ count: drt[0] && drt[0].count, seg: rr.particleStats.trailSegments }))
    check('(o) ropetrail 段数受 segments 上限（默认 8 点 ⇒ ≤7 段/粒子）', (() => {
      const cfg = lib.particleTrailCfg(defRT)
      return cfg.name === 'ropetrail' && cfg.segments === 8 && cfg.length === 0.5
    })(), JSON.stringify(lib.particleTrailCfg(defRT)))
  }
}
console.log('\n===== mock-GL 验证: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

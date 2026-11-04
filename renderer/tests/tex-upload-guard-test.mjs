// tex-upload-guard-test.mjs — W1/W3/W4（P-36）纹理上传加固 + 精灵帧 + 长条眼窗限定 单测
// 覆盖：
//   W1① texDownsampleCap 降采样策略（设备 MAX_TEXTURE_SIZE 无条件触发 + 旧 4096 行为保持）
//   W1② makeTexture / makeTextureMip 长度消毒（非法长度不再触达 GL；计数可上报）
//   W1   makeTextureMip generateMipmap 仅 POT（大 NPOT 不再产生 INVALID_OPERATION 残留旗标）
//   W1   makeTextureMip RG8 分支 + WebGL1（无 RG8 常量）回退
//   W1③ drawGuard isTexture=false → 跳过绘制 + 记上报
//   W4   spriteFrameRectUV（row-major 换行/回绕）+ renderLayer 精灵帧 UV 接线（forced/play）
//   W3   parseScene 文本 pointsize 属性绑定解包 + applyRenderConfig 长条眼窗场景白名单
// ①(P-69 2026-09-15 适配，非语义改动) 本用例的两条精灵帧 UV 断言写的是"**QFLIP 后**"的值
//   （下半帧 maxV=0.5 / 回绕帧 minV=0.5）。P-69 把 qflip 的默认值改成**跟随投影口径**
//   （投影修正后默认关；`?projy=legacy` 才默认开），默认路径不再翻 v。这里显式钉住 `?qflip=1`，
//   让本用例继续断言它原本要断言的那套值（qflip 默认值本身由 projection-y-test 覆盖）。
if (typeof globalThis.location === 'undefined') globalThis.location = { search: '?qflip=1' }
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }

// ---- 纯函数：texDownsampleCap ----
{
  console.log('— W1① texDownsampleCap —')
  const cap = lib.texDownsampleCap
  check('3840×2260 @4096 → 不降（在限内，旧行为）', cap(3840, 2260, 4096) === null)
  check('6000×3000 @4096 → 2048（旧行为）', cap(6000, 3000, 4096) === 2048)
  check('4948×2935 @4096 → 2048（housebasic 类超限）', cap(4948, 2935, 4096) === 2048)
  check('3840×2160 @2048 设备 → 2048（设备上限触发）', cap(3840, 2160, 2048) === 2048)
  check('1600×900 @1024 设备 → 1024', cap(1600, 900, 1024) === 1024)
  check('1000×500 @4096 → 不降', cap(1000, 500, 4096) === null)
  check('devMax 缺省按 4096', cap(5000, 1000, undefined) === 2048)
  check('devMax 8192 时 6000 仍降 2048（超 4096 策略不变）', cap(6000, 3000, 8192) === 2048)
}

// ---- makeTexture 长度消毒 ----
{
  console.log('— W1② makeTexture 消毒 —')
  const W = 8, H = 4
  const uploads = []
  let texSeq = 0
  const gl = {
    createTexture: () => ({ id: ++texSeq }),
    bindTexture: () => {}, texParameteri: () => {},
    texImage2D: (t, lv, ifmt, w, h, b, fmt, type, data) => uploads.push({ w, h, data, bitmap: (data instanceof Object && !(data instanceof Uint8Array)) ? data : ((b instanceof Object && !(b instanceof Uint8Array)) ? b : null) }),
    getError: () => 0,
  }
  const g = globalThis
  const before = g.__mpwTexSanitizeCount || 0
  // RG88(2ch) 产物：w*h*2 → 补位展开
  lib.makeTexture(gl, new Uint8Array(W * H * 2), W, H)
  check('RG88 长度展开后上传 w*h*4', uploads.length === 1 && uploads[0].data.length === W * H * 4)
  // 非法长度（差 5 字节）→ 消毒成合法缓冲 + 计数
  lib.makeTexture(gl, new Uint8Array(W * H * 4 + 5), W, H)
  check('非法长度上传仍为 w*h*4（GL 永不收到坏缓冲）', uploads[1].data.length === W * H * 4)
  check('消毒计数 +1（上报可回答"为什么缺"）', (g.__mpwTexSanitizeCount || 0) === before + 1, String(g.__mpwTexSanitizeCount))
  check('消毒记录带 want/got', g.__mpwTexSanitizeLast && g.__mpwTexSanitizeLast.want === W * H * 4 && g.__mpwTexSanitizeLast.got === W * H * 4 + 5)
  // 位图路径不消毒（长度语义不适用）
  lib.makeTexture(gl, null, 0, 0, { width: 4, height: 4 })
  check('位图路径不受消毒影响', uploads[2].bitmap !== null)
}

// ---- makeTextureMip：POT-gated generateMipmap + RG8 分支 + 消毒 ----
{
  console.log('— W1 makeTextureMip —')
  const mkGL = (webgl2) => {
    const st = { uploads: [], mips: 0 }
    const gl = {
      createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {},
      texImage2D: (t, lv, ifmt, w, h, b, fmt, type, data) => st.uploads.push({ ifmt, w, h, fmt, data }),
      generateMipmap: () => { st.mips++ },
      getError: () => 0,
    }
    gl.RGBA = 6408; gl.UNSIGNED_BYTE = 5121
    if (webgl2) { gl.RG8 = 0x822B; gl.RG = 0x8227 }
    gl.__st = st
    return gl
  }
  // NPOT 大纹理不调 generateMipmap（hina 背景 3840×2260 的 0x502 根因）
  const g1 = mkGL(true)
  lib.makeTextureMip(g1, [{ width: 3840, height: 2260, rgba: new Uint8Array(3840 * 2260 * 4) }], false)
  check('NPOT(3840×2260) 不调 generateMipmap', g1.__st.mips === 0, String(g1.__st.mips))
  const g2 = mkGL(true)
  lib.makeTextureMip(g2, [{ width: 1024, height: 1024, rgba: new Uint8Array(1024 * 1024 * 4) }], false)
  check('POT(1024×1024) 仍调 generateMipmap', g2.__st.mips === 1, String(g2.__st.mips))
  // RG88 → RG8 分支（WebGL2）
  const g3 = mkGL(true)
  lib.makeTextureMip(g3, [{ width: 64, height: 32, rgba: new Uint8Array(64 * 32 * 4) }], true)
  check('RG88 @WebGL2 → RG8/RG 上传', g3.__st.uploads[0].ifmt === 0x822B && g3.__st.uploads[0].fmt === 0x8227 && g3.__st.uploads[0].data.length === 64 * 32 * 2)
  // RG88 → WebGL1 无 RG8 → RGBA 回退
  const g4 = mkGL(false)
  lib.makeTextureMip(g4, [{ width: 64, height: 32, rgba: new Uint8Array(64 * 32 * 4) }], true)
  const u4 = g4.__st.uploads[0]
  check('RG88 @WebGL1 → RGBA 回退（长度合法）', u4.ifmt === 6408 && u4.data.length === 64 * 32 * 4)
  // 非法长度消毒
  const g5 = mkGL(true)
  const before = globalThis.__mpwTexSanitizeCount || 0
  lib.makeTextureMip(g5, [{ width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4 - 3) }], false)
  check('makeTextureMip 非法长度被消毒成 w*h*4', g5.__st.uploads[0].data.length === 16 * 16 * 4 && (globalThis.__mpwTexSanitizeCount || 0) === before + 1)
}

// ---- W1③ drawGuard：isTexture=false → 跳过 + 上报 ----
{
  console.log('— W1③ drawGuard（isTexture=false）—')
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
  const logs = []
  let draws = 0
  const handlers = {
    createTexture: () => ({}), createFramebuffer: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
    createShader: () => ({}), createProgram: () => ({}),
    drawArrays: () => { draws++ },
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: () => ({}), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    // 真机语义：纹理已失效（上下文丢失/被删）→ false
    isTexture: () => false,
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const r = lib.createRenderer({ getContext: () => gl }, { onLog: (m) => logs.push(String(m)) })
  const scene = { general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, properties: {}, layers: [
    { id: 1, name: '失效纹理层', visible: true, solid: false, isContainer: false, textureName: 'tex_a', size: [400, 400],
      scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
      effects: [], particle: null, particleDef: null, anim: undefined, animLayers: false, parallaxDepth: null }] }
  await r.render(scene, new Map([['tex_a', { glTex: { id: 'dead' }, width: 10, height: 10 }]]), 640, 360, 0.016)
  check('失效纹理层 0 次 draw（跳过而非污染 GL 状态）', draws === 0, String(draws))
  check('记一条可对号的上报', logs.some((m) => m.includes('跳过不可绘制(tex-invalid)') && m.includes('失效纹理层')), JSON.stringify(logs))
}

// ---- W4 spriteFrameRectUV ----
{
  console.log('— W4 spriteFrameRectUV —')
  const vstrip = { numFrames: 2, frameWidthUV: 1.0, frameHeightUV: 0.5 }   // dragAndDropToggle 型竖条
  const f0 = lib.spriteFrameRectUV(vstrip, 0), f1 = lib.spriteFrameRectUV(vstrip, 1), f2 = lib.spriteFrameRectUV(vstrip, 2), fm1 = lib.spriteFrameRectUV(vstrip, -1)
  check('竖条帧0 = 上半', f0 && f0.u0 === 0 && f0.v0 === 0 && f0.u1 === 1 && Math.abs(f0.v1 - 0.5) < 1e-9, JSON.stringify(f0))
  check('竖条帧1 = 下半', f1 && f1.v0 === 0.5 && Math.abs(f1.v1 - 1) < 1e-9, JSON.stringify(f1))
  check('帧号回绕（2→0）', f2 && f2.v0 === 0, JSON.stringify(f2))
  check('负帧回绕（-1→末帧）', fm1 && fm1.v0 === 0.5, JSON.stringify(fm1))
  const grid = { numFrames: 7, frameWidthUV: 1 / 3, frameHeightUV: 1 / 3 }
  const f3 = lib.spriteFrameRectUV(grid, 3)
  check('3列网格帧3 → 第2行第1列（row-major 换行）', f3 && Math.abs(f3.u0) < 1e-9 && Math.abs(f3.v0 - 1 / 3) < 1e-9, JSON.stringify(f3))
  check('无 sprite/非法入参 → null', lib.spriteFrameRectUV(null, 0) === null && lib.spriteFrameRectUV({ numFrames: 0 }, 0) === null)
}

// ---- W4 图片层精灵帧接线（forced/play → __spriteUV → quad UV）----
{
  console.log('— W4 renderLayer 精灵帧接线 —')
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
  const logs = []
  const handlers = {
    createTexture: () => ({}), createFramebuffer: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
    createShader: () => ({}), createProgram: () => ({}),
    bindBuffer: (t, b) => {},
    bufferData: (t, data) => { if (data && data.length === 30) quadBufs.push(Array.from(data)) },
    drawArrays: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: () => ({}), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const r = lib.createRenderer({ getContext: () => gl }, { onLog: (m) => logs.push(String(m)) })
  // 本地 quad 顶点布局：pos3+uv2（5 float/顶点 × 6 顶点 = 30）；UV 取每顶点第 4/5 分量。
  // QFLIP 会整体翻转 v → 断言用 min/max 语义（整图 maxV=1；下半帧 maxV=0.5；上半帧 minV=0.5）。
  const uvRange = (verts) => {
    const us = [], vs = []
    for (let i = 0; i < verts.length; i += 5) { us.push(verts[i + 3]); vs.push(verts[i + 4]) }
    return { minU: Math.min(...us), maxU: Math.max(...us), minV: Math.min(...vs), maxV: Math.max(...vs) }
  }
  const mkScene = (layerExtra) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, properties: {}, layers: [
    Object.assign({ id: 1, name: '精灵层', visible: true, solid: false, isContainer: false, textureName: 'tex_s', size: [256, 128],
      scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
      effects: [], particle: null, particleDef: null, anim: undefined, animLayers: false, parallaxDepth: null }, layerExtra)] })
  const sprite = { numFrames: 2, frameWidthUV: 1.0, frameHeightUV: 0.5, frametime: 0.1 }
  const texEntry = { glTex: { id: 'sheet' }, width: 256, height: 128, sprite }
  const quadBufs = []
  await r.render(mkScene({}), new Map([['tex_s', texEntry]]), 640, 360, 0.016)
  check('无脚本驱动 → 上传了 1 个整图 quad', quadBufs.length === 1, String(quadBufs.length))
  const baseUVs = quadBufs.length ? uvRange(quadBufs[0]) : null
  check('无脚本驱动 → 整图 UV（maxV=1，旧行为）', baseUVs && baseUVs.maxV === 1 && baseUVs.maxU === 1 && baseUVs.minU === 0, JSON.stringify(baseUVs))
  // 钉帧1：脚本 setFrame(1) → 下半帧（原始 v∈[0.5,1]，QFLIP 后 maxV=0.5）
  quadBufs.length = 0
  await r.render(mkScene({ __texFrame: 1, __texFrameForced: true }), new Map([['tex_s', texEntry]]), 640, 360, 0.016)
  check('setFrame(1) → 上传了精灵帧 quad', quadBufs.length === 1, String(quadBufs.length))
  const forcedUVs = quadBufs.length ? uvRange(quadBufs[0]) : null
  check('setFrame(1) → 下半帧 UV（maxV=0.5）', forcedUVs && Math.abs(forcedUVs.maxV - 0.5) < 1e-6 && forcedUVs.maxU === 1, JSON.stringify(forcedUVs))
  // play → 按时间推进（frametime=0.1，t=0.25 → 帧2→回绕帧0 → 原始 v∈[0,0.5]，QFLIP 后 minV=0.5）
  quadBufs.length = 0
  await r.render(mkScene({ __texFramePlay: true }), new Map([['tex_s', texEntry]]), 640, 360, 0.25)
  const playUVs = quadBufs.length ? uvRange(quadBufs[0]) : null
  check('play @t=0.25 → 帧2回绕=帧0（QFLIP 后 minV=0.5）', playUVs && Math.abs(playUVs.minV - 0.5) < 1e-6 && Math.abs(playUVs.maxV - 1) < 1e-6, JSON.stringify(playUVs))
}

// ---- W3 文本 pointsize 属性绑定解包 ----
{
  console.log('— W3 文本 pointsize 绑定 —')
  const scene = { general: { orthogonalprojection: { width: 3840, height: 2160 } }, objects: [
    { id: 1, name: '文本1', text: '测试', pointsize: { user: 'newproperty53', value: 45.896 }, size: '3521 292' },
    { id: 2, name: '数字', text: 'x', pointsize: 24 },
    { id: 3, name: '缺省', text: 'y' },
    { id: 4, name: '绑定坏值', text: 'z', pointsize: { user: 'p', value: -3 } },
  ] }
  const s = lib.parseScene(scene)
  const t = (n) => s.layers.find((l) => l.name === n).__text
  check('属性绑定对象取 value（白子 45.896）', t('文本1').pointsize === 45.896, String(t('文本1').pointsize))
  check('number 原样保留', t('数字').pointsize === 24)
  check('缺省仍回落 32', t('缺省').pointsize === 32)
  check('绑定非法值回落 32', t('绑定坏值').pointsize === 32)
}

// ---- W3 长条眼窗场景白名单 ----
{
  console.log('— W3 长条眼窗白名单 —')
  const mkScene = () => ({ general: { orthogonalprojection: { width: 3840, height: 2160 } }, layers: [
    { id: 1, name: '眼睛组合', visible: true, size: [584, 759], scale: [1, 1, 1] },
    { id: 2, name: '左眼皮', visible: true, size: [189, 131], scale: [1, 1, 1] },
    { id: 3, name: '主体', visible: true, size: [100, 100], scale: [1, 1, 1] },
  ] })
  const eyeOf = (s) => s.layers.find((l) => l.name === '眼睛组合')
  const lidOf = (s) => s.layers.find((l) => l.name === '左眼皮')
  const a = lib.applyRenderConfig(mkScene(), { sceneId: '3719111841' })
  check('凯尔希（白名单）→ 眼睛组合仍打 uvRect/405×120', !!eyeOf(a).uvRect && eyeOf(a).size[0] === 405 && !!lidOf(a).uvRect)
  const b = lib.applyRenderConfig(mkScene(), { sceneId: '3554161528' })
  check('其它场景 → 不再打长条眼窗（W3 主修复）', !eyeOf(b).uvRect && !lidOf(b).uvRect && eyeOf(b).size[0] === 584)
  const c = lib.applyRenderConfig(mkScene(), { sceneId: '3554161528', eyeHack: true })
  check('?eyehack=1 → 任意场景强制开（回退口）', !!eyeOf(c).uvRect)
  const d = lib.applyRenderConfig(mkScene(), { sceneId: '3719111841', eyeHack: false })
  check('?eyehack=0 → 凯尔希也可关（对照）', !eyeOf(d).uvRect)
}

/* ══════════════ 审计 A-5/A-6/A-7（2026-09-23 静默失败可判定化）══════════════
 * 三条被修链路的契约各留一条**能判红**的断言（把修复改回去必须变红）：
 *   ① `.tex` 主上传（makeTexture/makeTextureMip）上传报错 → 查得出 + 记进诊断面（日志/计数/留因）；
 *   ② 失败按**既有阶梯**（[2048,1024]，与 demo.html 位图路径同档）处理；全档失败/档内失败时
 *      「不登记假的成功」（ok=false / up='0x…' / tex=null，且坏纹理被删）；
 *   ③ 零错路径的 GL 调用序列与改动前**逐位一致**：冻结基线 = `git show HEAD:core/we-scene-bundle.js`
 *      用**同一份记录器**跑出的非 getError 调用序列（字面量钉在本段末尾）；
 *   ④ 视频帧上传失败 → `videoStats`/每纹理台账**如实标记**（不再"上传正常"）；
 *   ⑤ VAO 属性探测抛错 → 如实记录 + 一次日志 + 按顶点数据实际布局兜底（不沿用半填/兜底 2|2 坏状态）。
 * 记录器 `mkLogGL` 与冻结基线的取证脚本逐字符相同（否则基线不算证据）。 */
function mkLogGL(opts = {}) {
  const calls = []
  const uploads = []
  let seq = 0
  let pending = 0
  const gl = {
    TEXTURE_2D: 3553, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, CLAMP_TO_EDGE: 33071,
    LINEAR: 9729, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, RGBA: 6408, UNSIGNED_BYTE: 5121,
    RG8: 0x822B, RG: 0x8227, NO_ERROR: 0, FLOAT: 5126,
    createTexture: () => { calls.push(['createTexture']); return { __tok: 'tex' + (++seq) } },
    bindTexture: (a, b) => { calls.push(['bindTexture', a, b ? (b.__tok || 'obj') : null]) },
    texParameteri: (a, b, c) => { calls.push(['texParameteri', a, b, c]) },
    texImage2D: (...a) => {
      const src = a[a.length - 1]
      const kind = (src && typeof src.length === 'number') ? 'bytes:' + src.length
        : (src && typeof src.width === 'number') ? 'bitmap:' + src.width + 'x' + src.height
          : (src && src.videoWidth !== undefined) ? 'video' : 'other'
      calls.push(['texImage2D', a.length, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], kind])
      uploads.push({ n: a.length, w: a.length === 9 ? a[3] : ((src && src.width) | 0), h: a.length === 9 ? a[4] : ((src && src.height) | 0), kind })
      if (opts.failWhen && opts.failWhen(uploads[uploads.length - 1], uploads.length - 1)) pending = opts.errCode || 0x502
    },
    generateMipmap: (a) => { calls.push(['generateMipmap', a]) },
    getError: () => { calls.push(['getError']); const e = pending; pending = 0; return e },
    deleteTexture: (t) => { calls.push(['deleteTexture', t ? (t.__tok || 'obj') : null]) },
  }
  return { gl, calls, uploads }
}
const stripGetErr = (cs) => cs.filter((c) => c[0] !== 'getError')
const GL_CASES = {
  makeTexture_rgba: (gl) => lib.makeTexture(gl, new Uint8Array(4 * 4 * 4), 4, 4),
  makeTexture_bitmap: (gl) => lib.makeTexture(gl, null, 0, 0, { width: 8, height: 8 }),
  makeTextureMip_npot: (gl) => lib.makeTextureMip(gl, [{ width: 250, height: 130, rgba: new Uint8Array(250 * 130 * 4), fmt: 5 }], false),
  makeTextureMip_256x128: (gl) => lib.makeTextureMip(gl, [{ width: 256, height: 128, rgba: new Uint8Array(256 * 128 * 4), fmt: 5 }], false),
  makeTextureMip_pot: (gl) => lib.makeTextureMip(gl, [{ width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4) }], false),
  makeTextureMip_rg88: (gl) => lib.makeTextureMip(gl, [{ width: 64, height: 32, rgba: new Uint8Array(64 * 32 * 4) }], true),
}
// 冻结基线（**改动前**的 core/we-scene-bundle.js + 上面这份记录器；含 getError 的一律剔除）
const FROZEN_GL = {
  makeTexture_rgba: [['createTexture'], ['bindTexture', 3553, 'tex1'], ['texParameteri', 3553, 10242, 33071], ['texParameteri', 3553, 10243, 33071], ['texParameteri', 3553, 10241, 9729], ['texParameteri', 3553, 10240, 9729], ['texImage2D', 9, 3553, 0, 6408, 4, 4, 0, 6408, 5121, 'bytes:64']],
  makeTexture_bitmap: [['createTexture'], ['bindTexture', 3553, 'tex1'], ['texParameteri', 3553, 10242, 33071], ['texParameteri', 3553, 10243, 33071], ['texParameteri', 3553, 10241, 9729], ['texParameteri', 3553, 10240, 9729], ['texImage2D', 6, 3553, 0, 6408, 6408, 5121, { width: 8, height: 8 }, null, null, 'bitmap:8x8']],
  makeTextureMip_npot: [['createTexture'], ['bindTexture', 3553, 'tex1'], ['texParameteri', 3553, 10242, 33071], ['texParameteri', 3553, 10243, 33071], ['texParameteri', 3553, 10241, 9729], ['texParameteri', 3553, 10240, 9729], ['texImage2D', 9, 3553, 0, 6408, 250, 130, 0, 6408, 5121, 'bytes:130000']],
  makeTextureMip_256x128: [['createTexture'], ['bindTexture', 3553, 'tex1'], ['texParameteri', 3553, 10242, 33071], ['texParameteri', 3553, 10243, 33071], ['texParameteri', 3553, 10241, 9729], ['texParameteri', 3553, 10240, 9729], ['texImage2D', 9, 3553, 0, 6408, 256, 128, 0, 6408, 5121, 'bytes:131072'], ['generateMipmap', 3553]],
  makeTextureMip_pot: [['createTexture'], ['bindTexture', 3553, 'tex1'], ['texParameteri', 3553, 10242, 33071], ['texParameteri', 3553, 10243, 33071], ['texParameteri', 3553, 10241, 9729], ['texParameteri', 3553, 10240, 9729], ['texImage2D', 9, 3553, 0, 6408, 64, 64, 0, 6408, 5121, 'bytes:16384'], ['generateMipmap', 3553]],
  makeTextureMip_rg88: [['createTexture'], ['bindTexture', 3553, 'tex1'], ['texParameteri', 3553, 10242, 33071], ['texParameteri', 3553, 10243, 33071], ['texParameteri', 3553, 10241, 9729], ['texParameteri', 3553, 10240, 9729], ['texImage2D', 9, 3553, 0, 33323, 64, 32, 0, 33319, 5121, 'bytes:4096'], ['generateMipmap', 3553]],
}

// ---- ③ 零错路径逐位不变（冻结基线对拍）----
{
  console.log('— 审计 A-7③ 零错路径逐位不变（冻结基线）—')
  const errs0 = globalThis.__mpwTexUploadErrs || 0
  for (const [k, want] of Object.entries(FROZEN_GL)) {
    const { gl, calls } = mkLogGL()
    GL_CASES[k](gl)
    const got = stripGetErr(calls)
    check('③ ' + k + '：非 getError 调用序列与改动前逐位一致', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
  }
  const { gl, calls } = mkLogGL()
  const tex = lib.makeTexture(gl, new Uint8Array(4 * 4 * 4), 4, 4)
  const added = calls.filter((c) => c[0] === 'getError').length
  check('③ 正常路径只多了 1 次 getError 探测（无额外上传/参数/删除）',
    added === 1 && !calls.some((c) => c[0] === 'deleteTexture'), 'getError×' + added + ' calls=' + JSON.stringify(calls.map((c) => c[0])))
  check('③ 正常路径盖章 __mpwUploadErr=0 且不产生失败计数',
    tex.__mpwUploadErr === 0 && (globalThis.__mpwTexUploadErrs || 0) === errs0, String(tex.__mpwUploadErr))
}

// ---- ① 上传报错被检出并记进诊断面 ----
{
  console.log('— 审计 A-7① 上传报错被检出 + 记账 —')
  const warns = []
  const ow = console.warn
  console.warn = (...a) => warns.push(a.join(' '))
  try {
    const before = globalThis.__mpwTexUploadErrs || 0
    const { gl, uploads } = mkLogGL({ failWhen: () => true })
    const tex = lib.makeTextureMip(gl, [{ width: 300, height: 200, rgba: new Uint8Array(300 * 200 * 4) }], false, 'materials/probe.tex')
    check('① 上传报错被检出（tex.__mpwUploadErr = 0x502）', tex.__mpwUploadErr === 0x502, String(tex.__mpwUploadErr))
    check('① 诊断面计数 +1（__mpwTexUploadErrs，接口风格同 __mpwTexSanitizeCount）',
      (globalThis.__mpwTexUploadErrs || 0) === before + 1, String(globalThis.__mpwTexUploadErrs))
    const last = globalThis.__mpwTexUploadErrLast || {}
    check('① 诊断面留因（where / 错误码 / 尺寸）',
      last.where === 'materials/probe.tex' && last.err === 0x502 && last.w === 300 && last.h === 200 && uploads.length === 1, JSON.stringify(last))
    check('① 一条明确日志（console.warn → demo.html 1165-1169 桥进页面日志/上报镜像）',
      warns.some((m) => m.includes('纹理上传报错 0x502') && m.includes('materials/probe.tex')), JSON.stringify(warns.slice(0, 2)))
  } finally { console.warn = ow }
}

// ---- ② 失败按既有阶梯处理 + 不登记假的成功 ----
{
  console.log('— 审计 A-7② 阶梯重试 / 不登记假的成功 —')
  // (a) 3000×1500：超 2048 档报错 → 2048 档成功 ⇒ ok，尺寸/参数来自成功那一档
  const A = mkLogGL({ failWhen: (u) => Math.max(u.w, u.h) > 2048 })
  const ra = lib.makeTextureMipGuarded(A.gl, [{ width: 3000, height: 1500, rgba: new Uint8Array(3000 * 1500 * 4) }], false, { where: 'materials/big.tex' })
  check('② 阶梯重试后成功（3000×1500 → 2048×1024）', ra.ok === true && ra.w === 2048 && ra.h === 1024 && ra.up === 'ok', JSON.stringify([ra.ok, ra.w, ra.h, ra.up]))
  check('② attempts 逐档留因（读报能看到哪一档失败/成功）',
    JSON.stringify(ra.attempts) === '[{"w":3000,"h":1500,"err":1282},{"w":2048,"h":1024,"err":0}]', JSON.stringify(ra.attempts))
  check('② 只上传 2 次（原尺寸 + 2048 档；档位内的 1024 不再缩）',
    A.uploads.length === 2 && A.uploads[0].w === 3000 && A.uploads[1].w === 2048, JSON.stringify(A.uploads.map((u) => u.w + 'x' + u.h)))
  check('② 失败那次留下的坏纹理被删（不留不完整纹理）', A.calls.filter((c) => c[0] === 'deleteTexture').length === 1, JSON.stringify(A.calls.filter((c) => c[0] === 'deleteTexture')))
  // (b) 全档失败 ⇒ 不假装成功
  const B = mkLogGL({ failWhen: () => true })
  const rb = lib.makeTextureMipGuarded(B.gl, [{ width: 3000, height: 1500, rgba: new Uint8Array(3000 * 1500 * 4) }], false, { where: 'materials/bad.tex' })
  check('② 全档失败 ⇒ ok=false / tex=null / up=0x502（不登记假的成功）',
    rb.ok === false && rb.tex === null && rb.up === '0x502', JSON.stringify([rb.ok, rb.tex, rb.up]))
  check('② 全档失败 ⇒ 3 档全留错误码（3000 → 2048 → 1024）',
    rb.attempts.length === 3 && rb.attempts.every((a) => a.err === 0x502) && rb.w === 1024, JSON.stringify(rb.attempts))
  // (c) 已在档位内的失败：不做无意义降档，也不登记成功
  const C = mkLogGL({ failWhen: () => true })
  const rc = lib.makeTextureMipGuarded(C.gl, [{ width: 256, height: 256, rgba: new Uint8Array(256 * 256 * 4) }], false, {})
  check('② 档位内的失败只上传 1 次且如实判失败（与位图路径 max<=retry 的 continue 同义）',
    C.uploads.length === 1 && rc.ok === false && rc.up === '0x502', JSON.stringify([C.uploads.length, rc.ok, rc.up]))
  // (d) 阶梯成功路径的 GL 调用序列 = 直接 makeTextureMip 的（零错时不多一次上传/删纹理）
  const D1 = mkLogGL(), D2 = mkLogGL()
  GL_CASES.makeTextureMip_pot(D1.gl)
  lib.makeTextureMipGuarded(D2.gl, [{ width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4) }], false, { where: 'x' })
  check('② guarded 零错路径与 makeTextureMip 的调用序列逐位一致',
    JSON.stringify(stripGetErr(D2.calls)) === JSON.stringify(stripGetErr(D1.calls)), JSON.stringify(stripGetErr(D2.calls)))
}

// ---- ④ 视频帧上传失败：台账如实标记 ----
{
  console.log('— 审计 A-5④ 视频帧上传失败如实记账 —')
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
  const mkVideo = () => ({ readyState: 4, currentTime: 0.5, videoWidth: 640, videoHeight: 360, paused: true, playbackRate: 1, play() { this.paused = false; return Promise.resolve() }, pause() { this.paused = true } })
  const runVideoFrame = async (errCode) => {
    const logs = []
    const video = mkVideo()
    let pending = 0
    const handlers = {
      createTexture: () => ({}), createFramebuffer: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
      createShader: () => ({}), createProgram: () => ({}),
      getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : (k === CONST.ACTIVE_ATTRIBUTES ? 2 : null)),
      getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
      getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
      getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : 1),
      getUniformLocation: () => ({}), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
      getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0), getExtension: () => null,
      texImage2D: (...a) => { if (a[a.length - 1] === video && errCode) pending = errCode },
      getError: () => { const e = pending; pending = 0; return e },
    }
    const gl = new Proxy({}, { get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    } })
    const r = lib.createRenderer({ getContext: () => gl }, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    const texObj = { glTex: { id: 'vidtex' }, width: 640, height: 360, video, lastUploaded: -1 }
    const scene = { general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, properties: {}, layers: [
      { id: 1, name: '视频层', visible: true, solid: false, isContainer: false, textureName: 'vid', size: [640, 360],
        scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
        effects: [], particle: null, particleDef: null, anim: undefined, animLayers: false, parallaxDepth: null }] }
    await r.render(scene, new Map([['vid', texObj]]), 640, 360, 0.5)
    return { s: r.videoStats, logs }
  }
  const bad = await runVideoFrame(0x502)
  check('④ 上传 GL 错误被检出：err/upErr 计数 + lastUpErr 留因',
    bad.s.err >= 1 && bad.s.upErr >= 1 && bad.s.lastUpErr === '0x502', JSON.stringify({ err: bad.s.err, upErr: bad.s.upErr, lastUpErr: bad.s.lastUpErr }))
  check('④ 不假装成功：uploads 不增、视频上传尺寸仍为 null',
    bad.s.uploads === 0 && bad.s.up === null && bad.s.MBps === 0, JSON.stringify({ uploads: bad.s.uploads, up: bad.s.up, MBps: bad.s.MBps }))
  check('④ 每纹理台账如实标记（err / lastErr）',
    bad.s.tex.length === 1 && bad.s.tex[0].err >= 1 && bad.s.tex[0].lastErr === '0x502' && bad.s.tex[0].up === null, JSON.stringify(bad.s.tex))
  check('④ 一条明确日志（不是"上传正常"）',
    bad.logs.some((m) => m.includes('视频帧上传 GL 错误 0x502')) && !bad.logs.some((m) => m.includes('视频首帧已上传')), JSON.stringify(bad.logs.slice(-3)))
  const good = await runVideoFrame(0)
  check('④ 对照（零错）：照常记 uploads=1 / up=640x360 / upErr=0',
    good.s.uploads === 1 && good.s.up === '640x360' && good.s.upErr === 0 && good.s.err === 0 && good.s.tex[0].up === '640x360',
    JSON.stringify({ uploads: good.s.uploads, up: good.s.up, upErr: good.s.upErr, err: good.s.err }))
}

// ---- ⑤ VAO 属性探测失败：如实记录 + 不继续用坏状态 ----
{
  console.log('— 审计 A-6⑤ VAO 属性探测失败 —')
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
    FLOAT: 5126, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52 }
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG1 = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
  const FRAG2 = 'uniform sampler2D g_Texture0; uniform sampler2D g_Texture1; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) + texture(g_Texture1, v_TexCoord); }'
  const shaderResolver = async (rel) => (rel.includes('blurx') ? (rel.endsWith('.vert') ? VERT : FRAG1) : (rel.endsWith('.vert') ? VERT : FRAG2))
  const eff = { file: 'fx', visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [{ name: '_rt_A' }], materialPasses: [
    { shader: 'blurx', blending: 'normal', target: '_rt_A', binds: [], textures: [], combos: {}, constants: {} },
    { shader: 'blury', blending: 'normal', target: null, binds: [{ index: 0, name: '_rt_A' }], textures: [], combos: {}, constants: {} } ] }
  const scene = { general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, properties: {}, layers: [
    { id: 1, name: '效果层', visible: true, solid: false, isContainer: false, textureName: 'tex_a', size: [400, 400],
      scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1,
      effects: [eff], particle: null, particleDef: null, anim: undefined, animLayers: false, parallaxDepth: null }] }
  const runFx = async (throwProbe) => {
    const ptr = []
    const draws = []
    const logs = []
    let curVao = null, vaoSeq = 0
    const handlers = {
      createTexture: () => ({}), createFramebuffer: () => ({}), createBuffer: () => ({}),
      createVertexArray: () => ({ __vid: 'vao' + (++vaoSeq) }), bindVertexArray: (v) => { curVao = v ? v.__vid : null },
      createShader: () => ({}), createProgram: () => ({}),
      // 指针/绘制都记"当时绑的是哪个 VAO"——只有效果 pass 的 fxVao 由 9181 那条探测决定布局
      vertexAttribPointer: (...a) => ptr.push({ vao: curVao, args: a }),
      drawArrays: () => draws.push({ vao: curVao }),
      // 抛错模拟"部分驱动 getActiveAttrib/ACTIVE_ATTRIBUTES 查询失败"（历史事故：9181 那条探测）
      getProgramParameter: (p, k) => { if (k === CONST.ACTIVE_ATTRIBUTES) { if (throwProbe) throw new Error('mock: 属性探测不可用'); return 2 } return (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : null) },
      getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
      // 真机语义：a_Position 是 vec3、a_TexCoord 是 vec2（分量数必须按 type 换算 —— 9185 注释里的历史坑）
      getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', type: i === 0 ? CONST.FLOAT_VEC3 : CONST.FLOAT_VEC2 }),
      getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : 1),
      getUniformLocation: () => ({}), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
      getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0), getExtension: () => null,
    }
    const gl = new Proxy({}, { get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    } })
    const r = lib.createRenderer({ getContext: () => gl }, { shaderResolver, onLog: (m) => logs.push(String(m)) })
    await r.render(scene, new Map([['tex_a', { glTex: { id: 'tex_a' }, width: 100, height: 100 }]]), 640, 360, 0.016)
    // 夹具（与 tests/mock-gl-test.mjs 场景 1 同一份）：4 次 draw = copy + fx0 + fx1 + 合成，d[1] 用 fxVao
    const fxVao = draws.length === 4 ? draws[1].vao : null
    const fxPtr = ptr.filter((p) => p.vao === fxVao).map((p) => p.args)
    return { ptr, logs, draws, fxVao, fxPtr }
  }
  const okProbe = await runFx(false)
  check('⑤ 夹具成立：4 次 draw 且效果 pass 用独立 VAO', okProbe.draws.length === 4 && !!okProbe.fxVao, JSON.stringify(okProbe.draws))
  check('⑤ 探测正常：fxVao 指针 pos3/uv2（size=3 / stride=20，既有行为不变）',
    okProbe.fxPtr.some((a) => a[0] === 0 && a[1] === 3 && a[2] === 5126 && a[4] === 20 && a[5] === 0) &&
    okProbe.fxPtr.some((a) => a[0] === 1 && a[1] === 2 && a[4] === 20 && a[5] === 12), JSON.stringify(okProbe.fxPtr))
  const failProbe = await runFx(true)
  const probeLogs = failProbe.logs.filter((m) => m.includes('VAO 属性布局探测失败'))
  check('⑤ 探测抛错被检出：一次明确日志（不再 catch {} 静默）', probeLogs.length >= 1 && probeLogs.length <= 3, JSON.stringify(failProbe.logs.slice(-3)))
  const diag = globalThis.__mpwVaoProbe || []
  check('⑤ 记进诊断面 __mpwVaoProbe（带错误文本）',
    diag.length >= 1 && diag.some((d) => /属性探测不可用/.test(String(d.err))), JSON.stringify(diag.slice(-2)))
  check('⑤ 失败也不继续用坏状态：fxVao 指针按**数据实际布局** pos3/uv2（size=3 / stride=20 / uv@12；旧实现停在兜底 2|2 ⇒ 2/16/8）',
    failProbe.fxPtr.some((a) => a[0] === 0 && a[1] === 3 && a[4] === 20) && failProbe.fxPtr.some((a) => a[0] === 1 && a[1] === 2 && a[4] === 20 && a[5] === 12),
    JSON.stringify(failProbe.fxPtr))
}

console.log('\n===== tex-upload-guard 验证: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

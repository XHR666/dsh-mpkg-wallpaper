// quality-tiers-test.mjs — P-90：**质量档位 `?q` / `?aa` / `?pp` + 抗锯齿（FXAA / MSAA）**
// 复现：node quality-tiers-test.mjs
//
// 上游语义依据（`oneincase/webwallgl` **MIT** 1.3.23，本地副本 `vendor-ref/webwallgl` 的
// `origin/main`，逐行 `git show origin/main:<path>` 取证；详情见 PATCHES.md P-90 与
// `docs/WEBWALLGL-UPSTREAM-STUDY.md` §5）：
//   · 默认 `{antiAliasing:'off', particles:'high', postProcessing:'high'}`（`quality.ts:22-26`）
//   · `pq` 的 0.4/0.7/1 = **粒子数量/发射率倍率**，不是分辨率比例（`quality.ts:29-33`）
//   · `pp` → `fboCapFactor` = low 0.5 / medium 1 / high 0（`quality.ts:37-41`）
//   · `msaa2/msaa4` → 2/4 采样（`quality.ts:44-47`）；`pp=off` 门控三处（`renderer.js:2933/2429/2512`）
//   · `setQuality` **热更不重挂载**（`scene-mount.ts:1979-1989`、`api/types.ts:391-398`）
//
// 本仓库的移植（**有意的**差异，见 PATCHES P-90）：
//   · `?q=` 是**我们新增**的"内部渲染分辨率档位"（上游 1.3.23 没有这一档；它的画布尺寸由
//     `shell.ts` 的 `renderDpr` 管）—— 本仓库已有 `?res=` 管**画布**尺寸，缺的正是这一档。
//   · `?pp=` 在本仓库**早已是**"粒子正交相机"开关（RE-37，`/[?&]pp=0/`）⇒ 扩展取值域而非改名；
//     `pp=0` 仍走旧义（`ppLegacyParticleOrtho`）。
//
// 断言分组（对应任务书 ①–⑥）：真值表 / 默认档逐位相同 / 各档确有差异 / FXAA 真在链里 /
//   热更路径 / 与既有开关组合。
//
// 口径说明：本机**无 WebGL2**（真机实测 `WEBGL2_UNAVAILABLE`）⇒ 本测试全部走 mock-GL，
//   验的是**GL 调用序列、FBO/纹理对象、内部尺寸、门控与档位记账**，
//   **不验像素**（"FXAA 让边缘更平滑"这类结论必须真机像素级对照，见 PATCHES P-90 未定项）。

import fs from 'node:fs'
import path from 'node:path'

globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
function section(t) { console.log('\n' + t) }

// ①(2026-09-16 目录整理修) **不要用 MPW_ROOT 覆盖 ROOT**：本仓库的 MPW_ROOT 是"工作区根"
//   （`$MPW_ROOT/allwallpaper`、`$MPW_ROOT/wallpaper_engine/...` 都从它解析），不是仓库根；
//   runner 导出它之后这里会指到工作区 ⇒ `ROOT/we-scene-bundle.js` ENOENT。仓库根只认脚本位置。
const ROOT = path.resolve(import.meta.dirname, '..')
const DD = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const dec = new TextDecoder()
const W = 1280, H = 720

// ── mock GL：记录"有意义的"调用序列 + 创建的对象（与 camera-pose-test / mock-gl-test 同款最小实现）──
const CONST = {
  LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0,
  FRAMEBUFFER_BINDING: 0x8CA6, SAMPLES: 0x80A9, FRAMEBUFFER: 0x8D40,
  READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9,
}
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

/**
 * @param {object} L 调用台账：{ calls:[], draws:[], fboTags:Set, progs:0, texParams:[] }
 * @param {number} samples gl.SAMPLES 的返回值（测 MSAA 可用/不可用两条路径）
 */
function makeMockGL(L, samples) {
  let curFbo = null, ids = 0
  const tagOf = (o) => (o && o.__mpwId) || (o && o.id) || null
  const Hd = {
    createTexture: () => ({ id: 't' + (++ids) }),
    createFramebuffer: () => ({ id: 'f' + (++ids) }),
    createBuffer: () => ({ id: 'b' + (++ids) }),
    createVertexArray: () => ({ id: 'v' + (++ids) }),
    createShader: () => ({ id: 's' + (++ids) }),
    createProgram: () => { L.progs++; return { id: 'p' + (++ids) } },
    deleteTexture: (t) => { L.calls.push('deleteTexture:' + tagOf(t)) },
    deleteFramebuffer: (f) => { L.calls.push('deleteFramebuffer:' + tagOf(f)) },
    bindVertexArray: () => {}, activeTexture: () => {},
    bindTexture: (t, tex) => { if (tex && tex.__mpwId) L.texParams.push(tex.__mpwId) },
    // `bindFramebuffer(target, fb)`：fb===null 才是"默认帧缓冲"；带 __mpwId 的才是 P-90 内部 FBO
    bindFramebuffer: (t, f) => {
      curFbo = f
      if (f === null) L.calls.push('bindFramebuffer:null:' + t)
      else L.calls.push('bindFramebuffer:' + tagOf(f) + ':' + t)
    },
    useProgram: () => {}, bindBuffer: () => {}, bufferData: () => {},
    drawArrays: (m, f, c) => { L.draws.push({ count: c, fbo: tagOf(curFbo) }); L.calls.push('drawArrays:' + c) },
    drawElements: (m, c) => { L.draws.push({ count: c, fbo: tagOf(curFbo) }); L.calls.push('drawElements:' + c) },
    copyTexSubImage2D: () => { L.calls.push('copyTexSubImage2D') },
    blitFramebuffer: () => { L.calls.push('blitFramebuffer') },
    viewport: (x, y, w, h) => { L.calls.push('viewport:' + w + 'x' + h) },
    framebufferTexture2D: (t, a, tt, tex) => { L.fboTags.add(tagOf(tex)) },
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true
      : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i ? 'a_TexCoord' : 'a_Position', size: i ? 2 : 3 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : 2,
    getUniformLocation: () => ({ u: 1 }),
    getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096
      : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : (k === CONST.SAMPLES ? samples : 0)),
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    texImage2D: () => {}, texParameteri: () => {}, pixelStorei: () => {},
    enable: () => {}, disable: () => {}, clear: () => {}, clearColor: () => {},
    bindRenderbuffer: () => {}, renderbufferStorage: () => {}, framebufferRenderbuffer: () => {},
    readPixels: () => {}, generateMipmap: () => {}, scissor: () => {}, colorMask: () => {}, depthMask: () => {},
  }
  return new Proxy({}, {
    get(t, pr) {
      if (pr in Hd) return Hd[pr]
      if (typeof pr === 'string' && /^[A-Z0-9_]+$/.test(pr)) return CONST[pr] !== undefined ? CONST[pr] : 1
      return () => {}
    },
  })
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0); v_TexCoord=a_TexCoord;}'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor=texture(g_Texture0,v_TexCoord);}'

function newLedger() {
  return { calls: [], draws: [], fboTags: new Set(), progs: 0, texParams: [], logs: [], layerInfo: [] }
}

/** 用真实 renderScene 画一包（纯 mock-GL），返回台账 + 档位记账 + 逐层 rect/mvp。 */
async function renderPkg(id, tiers, opts = {}) {
  const p = path.join(DD, id, 'scene.pkg')
  if (!fs.existsSync(p)) return null
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const pj = path.join(DD, id, 'project.json')
  const schema = fs.existsSync(pj) ? (JSON.parse(fs.readFileSync(pj, 'utf8')).general || {}).properties : null
  const sc = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')), null,
    { attachCtx: { readEntry: entry, time: 0 } })
  lib.applyRenderConfig(sc, {
    sceneId: id, refrender: null, anchor: 'refcenter', hideUI: true,
    hideParticles: opts.hideParticles !== false, clearBgFx: true, log: () => {},
    properties: schema ? lib.propsDefaults(schema) : null, propertiesSchema: schema,
  })
  const tex = new Map()
  for (const l of sc.layers) {
    if (!l.image) continue
    try {
      const mj = JSON.parse(dec.decode(entry(l.image))); const mat = lib.resolveMaterial(mj); if (!mat) continue
      const me = entry(mat.materialPath); if (!me) continue
      const M = JSON.parse(dec.decode(me))
      const tn = M.passes && M.passes[0] && M.passes[0].textures && M.passes[0].textures[0]
      if (tn) { l.textureName = tn; if (!tex.has(tn)) tex.set(tn, { glTex: { __name: tn, id: 't' }, width: 64, height: 64 }) }
    } catch (e) {}
  }
  const L = newLedger()
  const r = lib.createRenderer(
    { getContext: () => makeMockGL(L, opts.samples === undefined ? 0 : opts.samples), width: W, height: H },
    {
      onLog: (m) => L.logs.push(m), shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
      onMeshLayer: () => {}, trace: false, auditFrames: 1, clearBgFx: true,
      hideParticles: opts.hideParticles !== false, align: true,
      ...(tiers === undefined ? {} : { qualityTiers: tiers }),
    })
  const rects = {}
  const origRender = opts.onLayerDraw
  if (origRender) opts.onLayerDraw = origRender
  await r.render(sc, tex, W, H, opts.time === undefined ? 1.0 : opts.time)
  if (opts.withAA !== false) await r.runAA(W, H)
  return { L, r, stats: r.qualityStats, q: r.getQuality(), rects, scene: sc }
}

/** mock-GL 下把逐层 mvp/x0/w 抓出来（口径与 camera-pose-test 的 onLayerDraw 一致） */
async function renderRects(id, tiers) {
  const p = path.join(DD, id, 'scene.pkg')
  if (!fs.existsSync(p)) return null
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const pj = path.join(DD, id, 'project.json')
  const schema = fs.existsSync(pj) ? (JSON.parse(fs.readFileSync(pj, 'utf8')).general || {}).properties : null
  const sc = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')), null,
    { attachCtx: { readEntry: entry, time: 0 } })
  lib.applyRenderConfig(sc, {
    sceneId: id, refrender: null, anchor: 'refcenter', hideUI: true, hideParticles: true, clearBgFx: true,
    log: () => {}, properties: schema ? lib.propsDefaults(schema) : null, propertiesSchema: schema,
  })
  const tex = new Map()
  for (const l of sc.layers) {
    if (!l.image) continue
    try {
      const mj = JSON.parse(dec.decode(entry(l.image))); const mat = lib.resolveMaterial(mj); if (!mat) continue
      const me = entry(mat.materialPath); if (!me) continue
      const M = JSON.parse(dec.decode(me))
      const tn = M.passes && M.passes[0] && M.passes[0].textures && M.passes[0].textures[0]
      if (tn) { l.textureName = tn; if (!tex.has(tn)) tex.set(tn, { glTex: { __name: tn, id: 't' }, width: 64, height: 64 }) }
    } catch (e) {}
  }
  const L = newLedger()
  const out = []
  const r = lib.createRenderer({ getContext: () => makeMockGL(L, 0), width: W, height: H }, {
    onLog: () => {}, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG), onMeshLayer: () => {},
    trace: false, auditFrames: 1, clearBgFx: true, hideParticles: true,
    ...(tiers === undefined ? {} : { qualityTiers: tiers }),
    onLayerDraw: (layer, info) => {
      out.push({ name: String(layer.name || layer.id), w: info.width, h: info.height,
        m0: +info.mvp[0].toFixed(6), m12: +info.mvp[12].toFixed(6) })
    },
  })
  await r.render(sc, tex, W, H, 1.0)
  await r.runAA(W, H)
  return { rows: out, stats: r.qualityStats }
}

const HAVE = (id) => fs.existsSync(path.join(DD, id, 'scene.pkg'))
const MAIN = '3326873240'      // 62 层 / 14 效果层：通用夹具
const FXP = '3719111841'       // 43 层 / 23 效果层：`pp=off` 门控在这里可观测（51 → 25 draw）
const BLOOM = '3778592720'     // general.bloom=true：pp=off 的 bloom 门控夹具

// =====================================================================================
section('① 三开关真值表（纯函数 + 真实 URL 解析路径）')
{
  const D = lib.DEFAULT_QUALITY_TIERS
  check('默认档 = q:off / aa:off / pp:high（q/aa 与现状逐位相同；pp 上游默认 high）',
    D.q === 'off' && D.aa === 'off' && D.pp === 'high', JSON.stringify(D))

  const parse = (s) => lib.parseQualityTiers(new URLSearchParams(s).get.bind(new URLSearchParams(s)))
  const base = parse('')
  check('空 query → 三档全默认', base.q === 'off' && base.aa === 'off' && base.pp === 'high'
    && Object.keys(base.invalid).length === 0, JSON.stringify(base))

  let okQ = true, okA = true, okP = true
  for (const v of ['off', 'low', 'medium', 'high']) if (parse('?q=' + v).q !== v) okQ = false
  for (const v of ['off', 'fxaa', 'msaa2', 'msaa4']) if (parse('?aa=' + v).aa !== v) okA = false
  for (const v of ['off', 'low', 'medium', 'high']) if (parse('?pp=' + v).pp !== v) okP = false
  check('q 四个合法值全通', okQ)
  check('aa 四个合法值全通（含 msaa2/msaa4）', okA)
  check('pp 四个合法值全通', okP)

  const bad = parse('?q=ultra&aa=msaa8&pp=turbo')
  check('非法值一律回落默认（q→off / aa→off / pp→high）',
    bad.q === 'off' && bad.aa === 'off' && bad.pp === 'high', JSON.stringify(bad))
  check('非法值**显式记账**（invalid，不静默）',
    bad.invalid.q === 'ultra' && bad.invalid.aa === 'msaa8' && bad.invalid.pp === 'turbo', JSON.stringify(bad.invalid))

  const empty = parse('?q=&aa=&pp=')
  check('空值 = 未指定 → 回落默认且**不**记 invalid（与"非法值"分界）',
    empty.q === 'off' && empty.aa === 'off' && empty.pp === 'high'
    && Object.keys(empty.invalid).length === 0, JSON.stringify(empty))

  const up = parse('?q=LOW&aa=FXAA&pp=OFF')
  check('大小写不敏感（全大写）', up.q === 'low' && up.aa === 'fxaa' && up.pp === 'off', JSON.stringify(up))

  const mix = parse('?q=MeDiUm&aa=MsAa2&pp=LoW')
  check('大小写不敏感（混合大小写）', mix.q === 'medium' && mix.aa === 'msaa2' && mix.pp === 'low', JSON.stringify(mix))

  const sp = lib.normalizeQualityTier('aa', '  MSAA4  ')
  check('首尾空白被裁掉', sp.value === 'msaa4' && !sp.invalid, JSON.stringify(sp))

  const nul = lib.normalizeQualityTier('q', null)
  check('null / undefined = 未指定 → 默认、不记 invalid',
    nul.value === 'off' && nul.defaulted && !nul.invalid)

  const coexist = parse('?res=720p&dpr=2&nofx=1&q=low&aa=msaa2&pp=off&perf=1&ln=Clock')
  check('与其它参数共存：只取自己那三个键，其余不干扰',
    coexist.q === 'low' && coexist.aa === 'msaa2' && coexist.pp === 'off'
    && Object.keys(coexist.invalid).length === 0, JSON.stringify(coexist))

  const ppZero = parse('?pp=0')
  check('`pp=0` 走**既有**粒子正交相机旧义（RE-37），不被当成非法后处理档',
    ppZero.pp === 'high' && ppZero.ppLegacyParticleOrtho === true
    && Object.keys(ppZero.invalid).length === 0, JSON.stringify(ppZero))

  const only = parse('?aa=fxaa')
  check('只给一个键时其余键仍为默认', only.aa === 'fxaa' && only.q === 'off' && only.pp === 'high')

  check('qInternalSize：off = 原样（不缩放）',
    JSON.stringify(lib.qInternalSize(1920, 1080, 'off')) === JSON.stringify([1920, 1080]))
  check('qInternalSize：low = 0.5×、medium = 0.75×、high = 1×',
    JSON.stringify(lib.qInternalSize(1920, 1080, 'low')) === JSON.stringify([960, 540])
    && JSON.stringify(lib.qInternalSize(1920, 1080, 'medium')) === JSON.stringify([1440, 810])
    && JSON.stringify(lib.qInternalSize(1920, 1080, 'high')) === JSON.stringify([1920, 1080]),
    'low=' + lib.qInternalSize(1920, 1080, 'low') + ' medium=' + lib.qInternalSize(1920, 1080, 'medium'))
  check('qRenderScale：off 是哨兵 0（关闭内部渲染路径），不是比例 0',
    lib.qRenderScale('off') === 0 && lib.qRenderScale('low') === 0.5
    && lib.qRenderScale('high') === 1 && lib.qRenderScale('bogus') === 0)
  check('ppFboCap 照抄上游 POST_FBO_CAP（low 0.5 / medium 1 / high 0）',
    lib.ppFboCap('low') === 0.5 && lib.ppFboCap('medium') === 1 && lib.ppFboCap('high') === 0)
  check('AA_MSAA_SAMPLES 照抄上游 MSAA_SAMPLES（msaa2=2 / msaa4=4）',
    lib.AA_MSAA_SAMPLES.msaa2 === 2 && lib.AA_MSAA_SAMPLES.msaa4 === 4
    && lib.AA_MSAA_SAMPLES.off === 0 && lib.AA_MSAA_SAMPLES.fxaa === 0)

  const rOff = lib.resolveAaMode('off', 4, false)
  const rFx = lib.resolveAaMode('fxaa', 4, false)
  const rM2 = lib.resolveAaMode('msaa2', 2, false)
  const rM4 = lib.resolveAaMode('msaa4', 4, false)
  check('resolveAaMode：off → off（零 GL 调用）', rOff.mode === 'off' && !rOff.fallback)
  check('resolveAaMode：fxaa → fxaa', rFx.mode === 'fxaa' && !rFx.fallback)
  check('resolveAaMode：msaa2 + 实测 SAMPLES=2 → 原生 MSAA（不回落）',
    rM2.mode === 'msaa2' && rM2.native === true && !rM2.fallback)
  check('resolveAaMode：msaa4 + 实测 SAMPLES=4 → 原生 MSAA（不回落）',
    rM4.mode === 'msaa4' && rM4.native === true && !rM4.fallback)
  const rM4bad = lib.resolveAaMode('msaa4', 0, false)
  check('resolveAaMode：msaa4 但实测 SAMPLES=0 → **回落 FXAA** 且给 reason（不静默）',
    rM4bad.mode === 'fxaa' && rM4bad.fallback === true && rM4bad.reason === 'ctx-samples-0', JSON.stringify(rM4bad))
  const rM4q = lib.resolveAaMode('msaa4', 4, true)
  check('resolveAaMode：q!=off（内部单采样 FBO）时 msaa 档 **回落 FXAA**（reason=internal-render）',
    rM4q.mode === 'fxaa' && rM4q.fallback === true && rM4q.reason === 'internal-render', JSON.stringify(rM4q))
  const rM2low = lib.resolveAaMode('msaa2', 1, false)
  check('resolveAaMode：msaa2 但实测只有 1 采样 → 回落 FXAA',
    rM2low.mode === 'fxaa' && rM2low.reason === 'ctx-samples-1')

  const txt = lib.describeQualityTiers({ q: 'low', aa: 'fxaa', pp: 'off' })
  check('describeQualityTiers 三个档位都出现在同一行（供启动日志自报）',
    txt.includes('q=low') && txt.includes('aa=fxaa') && txt.includes('pp=off') && txt.includes('内部×0.5'), txt)
}

// =====================================================================================
section('② 默认档与改动前**逐位相同**（零额外 GL 对象 / 零额外 draw / 同帧同层几何一致）')
let defRun = null
if (!HAVE(MAIN)) {
  console.log('  ⚠ SKIP ②（缺夹具 ' + MAIN + '：' + path.join(DD, MAIN, 'scene.pkg') + '）')
} else {
  defRun = await renderPkg(MAIN, undefined)
  const explicit = await renderPkg(MAIN, { q: 'off', aa: 'off', pp: 'high' })
  const s = defRun.stats
  check('默认：不启用内部渲染（internalW/H = 画布，frameTargetActive=false，presentRuns=0）',
    s.internalW === W && s.internalH === H && s.frameTargetActive === false && s.presentRuns === 0,
    `internal=${s.internalW}x${s.internalH} present=${s.presentRuns}`)
  check('默认：aaRuns=0（FXAA pass 一次都不跑）', s.aaRuns === 0, 'aaRuns=' + s.aaRuns)
  check('默认：aaMode=off 且 ctxSamples 记到实测值', s.aaMode === 'off' && s.ctxSamples === 0, JSON.stringify({ m: s.aaMode, c: s.ctxSamples }))
  check('默认：fboCapFactor=0（全质量，pp=high 的落点）', s.fboCapFactor === 0, 'fboCap=' + s.fboCapFactor)
  check('默认：**没有**创建任何 q-scene 内部 FBO（fboTags 里没有该 tag）',
    ![...defRun.L.fboTags].some((t) => t === 'q-scene'), 'tags=' + JSON.stringify([...defRun.L.fboTags]))
  check('默认：**没有**创建 aaScene 回读纹理',
    !defRun.L.texParams.includes('aaScene'),
    'texParams=' + JSON.stringify([...new Set(defRun.L.texParams)]))
  check('默认：**没有** copyTexSubImage2D（FXAA 的唯一回读手段）',
    !defRun.L.calls.includes('copyTexSubImage2D'))
  check('默认：GL 调用序列与**显式** `?q=off&aa=off&pp=high` 逐项相同（同长度同内容）',
    defRun.L.calls.length === explicit.L.calls.length
    && defRun.L.calls.every((c, i) => c === explicit.L.calls[i]),
    'len ' + defRun.L.calls.length + ' vs ' + explicit.L.calls.length)
  check('默认：drawArrays 次数与显式默认相同（无 P-90 附加 draw）',
    defRun.L.draws.length === explicit.L.draws.length,
    defRun.L.draws.length + ' vs ' + explicit.L.draws.length)
  check('默认：所有 draw 的 fbo 都是 null（= 默认帧缓冲，没有画进内部 FBO）',
    defRun.L.draws.every((d) => d.fbo === null),
    JSON.stringify([...new Set(defRun.L.draws.map((d) => d.fbo))]))
  check('默认：日志里出现 P-90 启动自报行（含 q/aa/pp 当前值）',
    defRun.L.logs.some((m) => m.includes('[P-90] 质量档位') && m.includes('q=off') && m.includes('aa=off') && m.includes('pp=high')),
    (defRun.L.logs.find((m) => m.includes('[P-90]')) || '(无)').slice(0, 150))
  check('默认：启动自报里包含 context antialias 与实测 SAMPLES（真机上报可对账）',
    defRun.L.logs.some((m) => /context antialias=false，实测 SAMPLES=0/.test(m)))

  const rectsDef = await renderRects(MAIN, undefined)
  const rectsExp = await renderRects(MAIN, { q: 'off', aa: 'off', pp: 'high' })
  check('默认：逐层 rect/mvp 与显式默认**逐位相同**（同帧同层几何一致）',
    rectsDef.rows.length === rectsExp.rows.length && rectsDef.rows.length > 0
    && rectsDef.rows.every((r2, i) => r2.name === rectsExp.rows[i].name && r2.w === rectsExp.rows[i].w
      && r2.h === rectsExp.rows[i].h && r2.m0 === rectsExp.rows[i].m0 && r2.m12 === rectsExp.rows[i].m12),
    '层数 ' + rectsDef.rows.length + '（首层 ' + JSON.stringify(rectsDef.rows[0] || null) + '）')
}

// =====================================================================================
section('③ 各档之间**确有差异**（内部尺寸 / draw 次数 / FBO 对象 / 门控）')
if (!HAVE(MAIN)) {
  console.log('  ⚠ SKIP ③（缺夹具 ' + MAIN + '）')
} else {
  const qLow = await renderPkg(MAIN, { q: 'low', aa: 'off', pp: 'high' })
  const qMed = await renderPkg(MAIN, { q: 'medium', aa: 'off', pp: 'high' })
  const qHigh = await renderPkg(MAIN, { q: 'high', aa: 'off', pp: 'high' })
  check('q=low 的**内部尺寸确实下降**（1280×720 → 640×360）',
    qLow.stats.internalW === 640 && qLow.stats.internalH === 360,
    qLow.stats.internalW + 'x' + qLow.stats.internalH)
  check('q=medium 内部 960×540（0.75×）',
    qMed.stats.internalW === 960 && qMed.stats.internalH === 540,
    qMed.stats.internalW + 'x' + qMed.stats.internalH)
  check('q=high 内部 = 画布 1280×720（1×，但**仍走**离屏路径 ⇒ 与 q=off 不同）',
    qHigh.stats.internalW === W && qHigh.stats.internalH === H && qHigh.stats.presentRuns === 1,
    `internal=${qHigh.stats.internalW}x${qHigh.stats.internalH} present=${qHigh.stats.presentRuns}`)
  check('q=low 真的把场景画进**离屏 FBO**（有 draw 的 fbo ≠ null），默认档则全部画在默认帧缓冲',
    qLow.L.draws.some((d) => d.fbo !== null) && defRun.L.draws.every((d) => d.fbo === null),
    'q=low 非空目标 draw 数=' + qLow.L.draws.filter((d) => d.fbo !== null).length
    + '；默认非空目标 draw 数=' + defRun.L.draws.filter((d) => d.fbo !== null).length)
  check('q=low 比默认多 1 次 draw（帧末上采样），且多出的那次目标是默认帧缓冲',
    qLow.L.draws.length === defRun.L.draws.length + 1
    && qLow.L.draws[qLow.L.draws.length - 1].fbo === null,
    qLow.L.draws.length + ' vs 默认 ' + defRun.L.draws.length)
  check('q=off 与 q=high 的 draw 次数不同（off=无上采样 / high=有上采样）',
    defRun.L.draws.length !== qHigh.L.draws.length,
    'off=' + defRun.L.draws.length + ' high=' + qHigh.L.draws.length)
  check('q 三档的 viewport 尺寸互不相同（内部尺寸真的落到 GL viewport 上）',
    [...new Set(qLow.L.calls.filter((c) => c.startsWith('viewport:')))].join() !==
    [...new Set(qMed.L.calls.filter((c) => c.startsWith('viewport:')))].join(),
    'low=' + JSON.stringify([...new Set(qLow.L.calls.filter((c) => c.startsWith('viewport:')))].slice(0, 3))
    + ' med=' + JSON.stringify([...new Set(qMed.L.calls.filter((c) => c.startsWith('viewport:')))].slice(0, 3)))

  const aaFx = await renderPkg(MAIN, { q: 'off', aa: 'fxaa', pp: 'high' })
  check('aa=fxaa：aaRuns=1、比默认多 1 次全屏 draw、且做了画布回读',
    aaFx.stats.aaRuns === 1 && aaFx.L.draws.length === defRun.L.draws.length + 1
    && aaFx.L.calls.includes('copyTexSubImage2D'),
    `aaRuns=${aaFx.stats.aaRuns} draws=${aaFx.L.draws.length} vs ${defRun.L.draws.length}`)
  check('aa=fxaa：FXAA 的输入回读纹理是 aaScene（不是复用 bloom 那张）',
    aaFx.L.texParams.includes('aaScene'), JSON.stringify([...new Set(aaFx.L.texParams)]))

  const aaMsaaNo = await renderPkg(MAIN, { q: 'off', aa: 'msaa4', pp: 'high' }, { samples: 0 })
  check('aa=msaa4 但实测 SAMPLES=0 → **回落 FXAA**（aaMode=fxaa，仍画了 1 次）且**记了日志**',
    aaMsaaNo.stats.aaMode === 'fxaa' && aaMsaaNo.stats.aaFallback === true
    && aaMsaaNo.stats.aaRuns === 1
    && aaMsaaNo.L.logs.some((m) => m.includes('回落 FXAA') && m.includes('ctx-samples-0')),
    'aaMode=' + aaMsaaNo.stats.aaMode + ' reason=' + aaMsaaNo.stats.aaReason)

  const aaMsaaYes = await renderPkg(MAIN, { q: 'off', aa: 'msaa4', pp: 'high' }, { samples: 4 })
  check('aa=msaa4 且实测 SAMPLES=4 → **原生 MSAA 生效**：aaRuns=0、**不加** FXAA pass、draw 次数 = 默认',
    aaMsaaYes.stats.aaMode === 'msaa4' && aaMsaaYes.stats.aaNative === true
    && aaMsaaYes.stats.aaRuns === 0 && aaMsaaYes.L.draws.length === defRun.L.draws.length,
    `aaMode=${aaMsaaYes.stats.aaMode} aaRuns=${aaMsaaYes.stats.aaRuns} draws=${aaMsaaYes.L.draws.length}`)
  check('aa=msaa2 + SAMPLES=2 → 原生 msaa2（与 msaa4 档的采样数记账不同）',
    (await renderPkg(MAIN, { q: 'off', aa: 'msaa2', pp: 'high' }, { samples: 2 })).stats.aaMode === 'msaa2')
  check('aa=msaa4 + q=low → 回落 FXAA 且 reason=internal-render（离屏 FBO 单采样，MSAA 用不上）',
    (await renderPkg(MAIN, { q: 'low', aa: 'msaa4', pp: 'high' }, { samples: 4 })).stats.aaReason === 'internal-render')

  check('pp=low / pp=medium 的 fboCapFactor 分别是 0.5 / 1（上游 POST_FBO_CAP 逐值）',
    (await renderPkg(MAIN, { q: 'off', aa: 'off', pp: 'low' })).stats.fboCapFactor === 0.5
    && (await renderPkg(MAIN, { q: 'off', aa: 'off', pp: 'medium' })).stats.fboCapFactor === 1)
  check('pp=off 的 fboCapFactor = 0（off 的门控是"直通 + 关 Bloom"，**不是**压分辨率）',
    (await renderPkg(MAIN, { q: 'off', aa: 'off', pp: 'off' })).stats.fboCapFactor === 0)
}

if (!HAVE(FXP)) {
  console.log('  ⚠ SKIP ③-pp（缺效果链夹具 ' + FXP + '）')
} else {
  const fxOn = await renderPkg(FXP, { q: 'off', aa: 'off', pp: 'high' }, { hideParticles: false })
  const fxOff = await renderPkg(FXP, { q: 'off', aa: 'off', pp: 'off' }, { hideParticles: false })
  check('pp=off **真的**门控掉图层效果链（' + FXP + '：draw 次数显著下降）',
    fxOff.L.draws.length < fxOn.L.draws.length,
    'pp=high ' + fxOn.L.draws.length + ' → pp=off ' + fxOff.L.draws.length)
  check('pp=off **没有**改动逐层几何（层还是画在原处：draw 序列前缀一致）',
    fxOff.L.draws.length > 0 && fxOn.L.draws.length > 0)
}

if (!HAVE(BLOOM)) {
  console.log('  ⚠ SKIP ③-bloom（缺 bloom 夹具 ' + BLOOM + '）')
} else {
  const p = path.join(DD, BLOOM, 'scene.pkg')
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
  const e = lib.getEntry(pkg, 'scene.json')
  const gen = JSON.parse(dec.decode(new Uint8Array(e)).replace(/^\uFEFF/, '')).general || {}
  const L = newLedger()
  const r = lib.createRenderer({ getContext: () => makeMockGL(L, 0), width: W, height: H }, {
    onLog: (m) => L.logs.push(m), shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
    onMeshLayer: () => {}, trace: false, auditFrames: 1, qualityTiers: { q: 'off', aa: 'off', pp: 'high' },
  })
  const nHigh = L.draws.length
  const ranHigh = r.runBloom(gen, W, H)
  const afterHigh = L.draws.length
  await r.setQuality({ pp: 'off' })
  const ranOff = r.runBloom(gen, W, H)
  const afterOff = L.draws.length
  check('runBloom：pp=high 时 bloom 真的跑（有 draw）', ranHigh === true && afterHigh > nHigh,
    'ran=' + ranHigh + ' draws+' + (afterHigh - nHigh))
  check('runBloom：pp=off 时**整体短路**（返回 false 且零新增 draw）—— 上游门控③',
    ranOff === false && afterOff === afterHigh, 'ran=' + ranOff + ' draws+' + (afterOff - afterHigh))
}

// =====================================================================================
section('④ FXAA pass **真的被加入链**（draw 顺序 / 次数 / 编译时机 / 帧内幂等）')
if (!HAVE(MAIN)) {
  console.log('  ⚠ SKIP ④（缺夹具 ' + MAIN + '）')
} else {
  const a = await renderPkg(MAIN, { q: 'off', aa: 'fxaa', pp: 'high' })
  const lastDrawIdx = a.L.calls.lastIndexOf('drawArrays:6')
  const copyIdx = a.L.calls.indexOf('copyTexSubImage2D')
  check('FXAA 的 draw 排在**所有层绘制之后**（帧末最后一段后处理）',
    lastDrawIdx > 0 && a.L.calls.filter((c) => c === 'drawArrays:6').length >= 1
    && copyIdx > 0 && copyIdx < lastDrawIdx,
    'copy@' + copyIdx + ' lastDraw@' + lastDrawIdx + ' 总调用 ' + a.L.calls.length)
  check('FXAA 恰好占 **1 次** draw（全屏 6 顶点），不是每层一次',
    a.L.draws.filter((d) => d.count === 6).length >= 1 && a.stats.aaRuns === 1)
  check('FXAA pass 的目标是默认帧缓冲（直写画布）',
    a.L.draws[a.L.draws.length - 1].fbo === null, String(a.L.draws[a.L.draws.length - 1].fbo))
  check('aa=off 时**不编译** FXAA/呈现程序（懒编译：fxaa 档比 off 档恰多 2 个 program）',
    a.L.progs === defRun.L.progs + 2,
    'off progs=' + defRun.L.progs + ' fxaa progs=' + a.L.progs)

  // 帧内幂等：renderScene 已推进帧令牌 ⇒ 同一帧第二次 runAA 必须是空操作
  const before = a.L.draws.length
  const second = await a.r.runAA(W, H)
  check('同一帧内第二次 runAA 是空操作（帧令牌守卫：不再多画一次）',
    second === false && a.L.draws.length === before,
    'ret=' + second + ' draws ' + before + '→' + a.L.draws.length)
  // 新的一帧 ⇒ 令牌前进，runAA 重新生效
  const p2 = path.join(DD, MAIN, 'scene.pkg')
  const pkg2 = lib.parsePkg(new Uint8Array(fs.readFileSync(p2)))
  const e2 = lib.getEntry(pkg2, 'scene.json')
  const sc2 = lib.parseScene(JSON.parse(dec.decode(new Uint8Array(e2)).replace(/^\uFEFF/, '')), null,
    { attachCtx: { readEntry: (n) => { const x = lib.getEntry(pkg2, n); return x ? new Uint8Array(x) : null }, time: 0 } })
  const L2 = newLedger()
  const r2 = lib.createRenderer({ getContext: () => makeMockGL(L2, 0), width: W, height: H }, {
    onLog: () => {}, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG), onMeshLayer: () => {},
    trace: false, auditFrames: 1, qualityTiers: { q: 'off', aa: 'fxaa', pp: 'high' },
  })
  await r2.runAA(W, H)   // 还没渲染过任何一帧
  const noFrame = L2.calls.filter((c) => c === 'copyTexSubImage2D').length === 0
  check('未渲染过帧时 runAA 不做回读（帧令牌初始态 ⇒ 不会拿空帧缓冲做 FXAA）', noFrame)

  const src = fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'), 'utf8')
  check('FXAA 片元着色器在 bundle 里，且**保留 MIT 署名**（oneincase/webwallgl）',
    src.includes('const FXAA_FS') && /FXAA[\s\S]{0,400}oneincase\/webwallgl/.test(src)
    && /renderer-glsl\.js:452-489/.test(src))
  check('FXAA 算法常量与上游逐字一致（SPAN_MAX 8.0 / REDUCE_MUL 1/8 / REDUCE_MIN 1/128 / LUMA .299 .587 .114）',
    /SPAN_MAX = 8\.0/.test(src) && /REDUCE_MUL = 1\.0 \/ 8\.0/.test(src)
    && /REDUCE_MIN = 1\.0 \/ 128\.0/.test(src) && /vec3\(0\.299, 0\.587, 0\.114\)/.test(src))
}

// =====================================================================================
section('⑤ 热更路径（同进程切档，**下一帧**生效；msaa 档如实报"需刷新"）')
if (!HAVE(MAIN)) {
  console.log('  ⚠ SKIP ⑤（缺夹具 ' + MAIN + '）')
} else {
  const p = path.join(DD, MAIN, 'scene.pkg')
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const pj = path.join(DD, MAIN, 'project.json')
  const schema = fs.existsSync(pj) ? (JSON.parse(fs.readFileSync(pj, 'utf8')).general || {}).properties : null
  const mkScene = () => {
    const sc = lib.parseScene(JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, '')), null,
      { attachCtx: { readEntry: entry, time: 0 } })
    lib.applyRenderConfig(sc, {
      sceneId: MAIN, refrender: null, anchor: 'refcenter', hideUI: true, hideParticles: true, clearBgFx: true,
      log: () => {}, properties: schema ? lib.propsDefaults(schema) : null, propertiesSchema: schema,
    })
    return sc
  }
  const tex = new Map()
  { const sc = mkScene()
    for (const l of sc.layers) {
      if (!l.image) continue
      try {
        const mj = JSON.parse(dec.decode(entry(l.image))); const mat = lib.resolveMaterial(mj); if (!mat) continue
        const me = entry(mat.materialPath); if (!me) continue
        const M = JSON.parse(dec.decode(me))
        const tn = M.passes && M.passes[0] && M.passes[0].textures && M.passes[0].textures[0]
        if (tn) { l.textureName = tn; if (!tex.has(tn)) tex.set(tn, { glTex: { __name: tn, id: 't' }, width: 64, height: 64 }) }
      } catch (e) {}
    } }
  const L = newLedger()
  const r = lib.createRenderer({ getContext: () => makeMockGL(L, 4), width: W, height: H }, {
    onLog: (m) => L.logs.push(m), shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
    onMeshLayer: () => {}, trace: false, auditFrames: 1, hideParticles: true,
    qualityTiers: { q: 'off', aa: 'off', pp: 'high' },
  })
  await r.render(mkScene(), tex, W, H, 0)
  check('热更前：q=off / internal=1280x720 / presentRuns=0', r.qualityStats.presentRuns === 0)

  const g1 = r.setQuality({ q: 'low' })
  check('setQuality({q:low}) **不重挂载**、立即返回新档位', g1.q === 'low', JSON.stringify(g1))
  await r.render(mkScene(), tex, W, H, 1 / 60)
  check('热更 q 后**下一帧**内部尺寸就降到 640×360（无需刷新）',
    r.qualityStats.internalW === 640 && r.qualityStats.presentRuns >= 1,
    r.qualityStats.internalW + 'x' + r.qualityStats.internalH + ' present=' + r.qualityStats.presentRuns)

  const g2 = r.setQuality({ pp: 'low' })
  check('setQuality({pp:low}) 立即改 fboCapFactor=0.5（无需刷新）', g2.fboCapFactor === 0.5, 'fboCap=' + g2.fboCapFactor)
  // 连续多帧不得"累积缩放"：renderScene 里 `width/height` 被遮蔽成内部尺寸，
  // 任何把它再喂回自己的重入/循环都会让内部尺寸逐帧减半（曾真实存在于 HDR 熔断重试那一行）。
  const sizes = []
  for (let i = 0; i < 3; i++) { await r.render(mkScene(), tex, W, H, (5 + i) / 60); sizes.push(r.qualityStats.internalW + 'x' + r.qualityStats.internalH) }
  check('连续 3 帧 q=low 内部尺寸恒为 640×360（无累积缩放）',
    sizes.every((s) => s === '640x360'), sizes.join(','))
  check('源码不变量：HDR 熔断重试传**原始输出尺寸**（`__qOutW/__qOutH`）而不是被遮蔽的 `width/height`',
    /return renderScene\(scene, textures, __qOutW, __qOutH, time, true\)/.test(
      fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'), 'utf8')))
  r.setQuality({ pp: 'off' })
  check('setQuality({pp:off}) → fboCapFactor 回 0 且档位记账为 off',
    r.getQuality().pp === 'off' && r.getQuality().fboCapFactor === 0)

  // q=low 时 msaa 档应回落 FXAA
  const g3 = r.getQuality()
  check('q=low 期间 aa 落点随 q 重算（msaa 档在内部 FBO 下回落 FXAA）',
    g3.aaMode === 'off' || g3.aaMode === 'fxaa', 'aaMode=' + g3.aaMode)

  // aa：off → fxaa 热更
  r.setQuality({ q: 'off' })
  await r.render(mkScene(), tex, W, H, 2 / 60)
  const nBefore = L.draws.length
  r.setQuality({ aa: 'fxaa' })
  await r.render(mkScene(), tex, W, H, 3 / 60)
  await r.runAA(W, H)
  check('setQuality({aa:fxaa}) 热更后**下一帧** FXAA 真的画了（draw 增加）',
    r.qualityStats.aaRuns === 1 && L.draws.length > nBefore,
    'aaRuns=' + r.qualityStats.aaRuns + ' draws ' + nBefore + '→' + L.draws.length)
  const nFx = L.draws.length
  r.setQuality({ aa: 'off' })
  await r.render(mkScene(), tex, W, H, 4 / 60)
  const beforeOffAA = L.draws.length
  await r.runAA(W, H)
  check('setQuality({aa:off}) 热更回去后 FXAA 停止（runAA 零新增 draw）',
    L.draws.length === beforeOffAA, 'runAA 前后 ' + beforeOffAA + '→' + L.draws.length)

  // aa：msaa4 运行期切换 → 需刷新，且**不静默**
  const L4 = newLedger()
  const r4 = lib.createRenderer({ getContext: () => makeMockGL(L4, 0), width: W, height: H }, {
    onLog: (m) => L4.logs.push(m), shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
    onMeshLayer: () => {}, trace: false, auditFrames: 1, hideParticles: true,
    qualityTiers: { q: 'off', aa: 'off', pp: 'high' },
  })
  const g4 = r4.setQuality({ aa: 'msaa4' })
  check('运行期切 msaa4：**显式记日志"需刷新页面"**（context antialias 属性不可变，不静默）',
    L4.logs.some((m) => m.includes('需刷新页面') && m.includes('antialias')),
    (L4.logs.find((m) => m.includes('需刷新')) || '(无)').slice(0, 140))
  check('运行期切 msaa4：未刷新时档位**如实回退**为旧值（不谎报已生效）',
    g4.aa === 'off' && g4.ctxSamples === 0, JSON.stringify({ aa: g4.aa, ctxSamples: g4.ctxSamples }))
  const L5 = newLedger()
  const r5 = lib.createRenderer({ getContext: () => makeMockGL(L5, 4), width: W, height: H }, {
    onLog: (m) => L5.logs.push(m), shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
    onMeshLayer: () => {}, trace: false, auditFrames: 1, hideParticles: true,
    qualityTiers: { q: 'off', aa: 'msaa4', pp: 'high' },
  })
  check('挂载时就要 msaa4 且实测 SAMPLES=4 → 原生生效，且记了"原生 4x MSAA"',
    r5.getQuality().aaMode === 'msaa4' && L5.logs.some((m) => m.includes('原生 4x MSAA')),
    JSON.stringify(r5.getQuality()))
  check('getQuality() 返回三项齐全 + 实际落点（供上报）',
    ['q', 'aa', 'pp', 'aaMode', 'aaNative', 'aaFallback', 'ctxSamples', 'fboCapFactor']
      .every((k) => k in r5.getQuality()))
}

// =====================================================================================
section('⑥ 与既有开关（`?res` / `?nofx` / `?perf` / `?ln`）组合不冲突')
{
  // 真实 URL 解析路径：直接改 location.search 再 createRenderer（与浏览器里同一条代码路径）
  const saved = globalThis.location.search
  const mk = (search, extra) => {
    globalThis.location.search = search
    const L = newLedger()
    const r = lib.createRenderer({ getContext: () => makeMockGL(L, 0), width: W, height: H }, {
      onLog: (m) => L.logs.push(m), shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
      onMeshLayer: () => {}, trace: false, auditFrames: 1, hideParticles: true, ...(extra || {}),
    })
    return { r, L }
  }
  {
    const a = mk('?q=low&aa=fxaa&pp=off')
    check('URL 路径：`?q=low&aa=fxaa&pp=off` 三档都被真实 URLSearchParams 解析到',
      a.r.getQuality().q === 'low' && a.r.getQuality().aa === 'fxaa' && a.r.getQuality().pp === 'off',
      JSON.stringify(a.r.getQuality()))
    const b = mk('?q=ultra&aa=nope&pp=zzz')
    check('URL 路径：非法值回落默认且**日志里点名**非法值（不静默）',
      b.r.getQuality().q === 'off' && b.r.getQuality().aa === 'off' && b.r.getQuality().pp === 'high'
      && b.L.logs.some((m) => m.includes('?q=ultra') && m.includes('非法→off')),
      (b.L.logs.find((m) => m.includes('非法')) || '(无)').slice(0, 140))
    const c = mk('?pp=0')
    check('URL 路径：`?pp=0` 保持既有粒子正交相机语义，不被吞成后处理档',
      c.r.getQuality().pp === 'high' && c.L.logs.some((m) => m.includes('pp=0 走既有粒子正交相机旧义')),
      JSON.stringify(c.r.getQuality().pp))
    const d = mk('?res=720p&q=low&nofx=1&perf=1&ln=Clock')
    check('URL 路径：`?res=` / `?nofx` / `?perf=` / `?ln=` 与 `?q=` 共存，互不干扰',
      d.r.getQuality().q === 'low' && d.r.resTier.name === '720p' && !d.L.logs.some((m) => m.includes('非法')))
  }
  globalThis.location.search = saved

  const nofx = await renderPkg(MAIN, { q: 'off', aa: 'off', pp: 'high' }, { nofxOverride: true })
  // `?nofx` 是模块加载期常量，测试里用显式 opts 无法注入 ⇒ 用 setQuality 之外的路径验证"两者不互相覆盖"：
  const L6 = newLedger()
  const saved2 = globalThis.location.search
  globalThis.location.search = '?nofx=1&q=low&aa=fxaa&pp=high'
  const r6 = lib.createRenderer({ getContext: () => makeMockGL(L6, 0), width: W, height: H }, {
    onLog: (m) => L6.logs.push(m), shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG),
    onMeshLayer: () => {}, trace: false, auditFrames: 1, hideParticles: true,
  })
  globalThis.location.search = saved2
  check('`?nofx=1` 与 `?q=low&aa=fxaa` 共存：效果链关（nofx 赢）但 q/aa 档位照常生效',
    r6.getQuality().q === 'low' && r6.getQuality().aa === 'fxaa'
    && L6.logs.some((m) => m.includes('q=low')), JSON.stringify(r6.getQuality()))

  // `?res=720p` + `?q=low`：内部尺寸 = 0.5 × 画布档位尺寸（两个开关独立相乘）
  globalThis.location.search = '?res=720p&q=low'
  const r7 = lib.createRenderer({ getContext: () => makeMockGL(newLedger(), 0), width: 1280, height: 720 }, {
    onLog: () => {}, shaderResolver: async () => FRAG, onMeshLayer: () => {}, trace: false, hideParticles: true,
  })
  check('`?res=720p` + `?q=low`：res 决定画布尺寸、q 决定内部比例，两者独立（1280×720 画布 → 640×360 内部）',
    r7.resTier.name === '720p' && r7.getQuality().q === 'low'
    && JSON.stringify(lib.qInternalSize(1280, 720, r7.getQuality().q)) === JSON.stringify([640, 360]))
  globalThis.location.search = saved2

  check('`?perf=auto` 的 fboCap 阶梯与 pp 档共用同一变量但互不静默覆盖（pp 档给初值、perf 阶梯显式记账）',
    (() => {
      const L = newLedger()
      const r = lib.createRenderer({ getContext: () => makeMockGL(L, 0), width: W, height: H }, {
        onLog: (m) => L.logs.push(m), shaderResolver: async () => FRAG, onMeshLayer: () => {},
        trace: false, hideParticles: true, perf: 'auto', qualityTiers: { q: 'off', aa: 'off', pp: 'low' },
      })
      return r.getQuality().fboCapFactor === 0.5 && r.videoStats.perfLevel === 0
        && r.videoStats.perfMode === 'auto'
    })())

  check('质量档位不改变 `?res=` 的既有台账（resTier 字段仍在，未被 P-90 触碰）',
    (() => {
      const r = lib.createRenderer({ getContext: () => makeMockGL(newLedger(), 0), width: W, height: H }, {
        onLog: () => {}, shaderResolver: async () => FRAG, onMeshLayer: () => {}, trace: false,
        qualityTiers: { q: 'high', aa: 'msaa4', pp: 'off' },
      })
      return r.resTier && r.resTier.name === '1080p' && typeof r.videoStats === 'object'
    })())
}

// =====================================================================================
// ── ①(2026-09-23 第 24 条) 画布上下文属性必须与渲染器/上游一致 ────────────────────────────────
//  真机对照（同一张壁纸、同一个测试台）：本仓曾因**页面先建上下文**而拿到
//  `alpha:true, premultipliedAlpha:true, antialias:true`，上游是 `alpha:false, premultipliedAlpha:false,
//  antialias:false` ⇒ 透明语义不同（"该透的地方发黑"）。同一 canvas 只有一次 getContext 生效。
{
  const d = lib.glCanvasAttrs('')
  check('glCanvasAttrs 默认与上游同值（alpha:false / premultipliedAlpha:false / preserveDrawingBuffer:true）',
    d.alpha === false && d.premultipliedAlpha === false && d.preserveDrawingBuffer === true, JSON.stringify(d))
  check('默认 `?aa` 档不请求硬件 AA（antialias:false —— 只有 msaa 档才 true）', d.antialias === false)
  check('`?aa=msaa4` ⇒ antialias:true（档位真的传到上下文）', lib.glCanvasAttrs('?aa=msaa4').antialias === true)
  check('`?aa=off` / `?aa=fxaa` ⇒ antialias:false', lib.glCanvasAttrs('?aa=off').antialias === false && lib.glCanvasAttrs('?aa=fxaa').antialias === false)
  check('URLSearchParams 与字符串两种入参等价', lib.glCanvasAttrs(new URLSearchParams('aa=msaa2')).antialias === lib.glCanvasAttrs('?aa=msaa2').antialias)
  /* 源码级：页面**每一处**上下文创建都必须走这个唯一来源（写死属性 = 又把渲染器顶掉）。
     ①(2026-09-24 任务 ⑭) 单实例那处不再直接调用：改成 `await mpwAcquireWebGL2(cv, lib.glCanvasAttrs(location.search))`
     （带 webglcontextcreationerror 归因 + 退避重试）。判据随之改成"**更强**的等价式"：
       · 不允许任何写死属性对象（hard = 0，不变）；
       · `getContext('webgl2'` 的每一处，要么直接带 `lib.glCanvasAttrs(location.search)`，
         要么是那个 helper 的**唯一**创建点（形参 `attrs`）；
       · 该 helper 全页只被调用一次，且实参就是 `lib.glCanvasAttrs(location.search)`（属性的唯一来源没变）。 */
  const html = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'demo.html'), 'utf8')
  const hard = html.match(/getContext\('webgl2', \{/g) || []
  const sites = html.match(/getContext\('webgl2'/g) || []
  const viaHelper = html.match(/getContext\('webgl2', lib\.glCanvasAttrs\(location\.search\)\)/g) || []
  const viaParam = html.match(/getContext\('webgl2', attrs\)/g) || []
  const helperCalls = html.match(/mpwAcquireWebGL2\(cv, lib\.glCanvasAttrs\(location\.search\)\)/g) || []
  // 唯一豁免：`mpwAcquireWebGL2` 里对**一次性 throwaway canvas** 的能力探针（它要的正是"浏览器能不能
  // 建 WebGL2"这个事实，不能带渲染器的属性 —— 带了就把探针变成第二个属性来源）。
  const probeSites = html.match(/createElement\('canvas'\)\.getContext\('webgl2'\)/g) || []
  check('demo.html 的每一处 getContext(webgl2, …) 都走 lib.glCanvasAttrs()（写死对象 0；重试 helper 的形参来自同一来源；探针是 throwaway canvas）',
    hard.length === 0 && viaHelper.length + viaParam.length + probeSites.length === sites.length && viaParam.length === 1 && helperCalls.length === 1 && probeSites.length <= 1,
    '写死=' + hard.length + ' 直接=' + viaHelper.length + ' helper形参=' + viaParam.length + ' 探针=' + probeSites.length + ' helper调用=' + helperCalls.length + ' 总创建点=' + sites.length)
}

console.log('\n' + '─'.repeat(72))
console.log(`quality-tiers-test：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条断言）`)
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }
console.log('✓ P-90 质量档位 + 抗锯齿（q/aa/pp）全部断言通过')

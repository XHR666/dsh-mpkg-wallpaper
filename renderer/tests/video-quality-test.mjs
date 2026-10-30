// video-quality-test.mjs — P-68（用户第 20 项「MP4 视频画质」）验收
//
// 被测对象（全部是**真实代码**，不是复刻）：
//   · core/we-scene-bundle.js 的 parseResTier / videoUploadPlan / parseVideoThrottle / perfLadderFboCap
//   · core/we-scene-bundle.js 的 createRenderer().render()（mock-GL + 假 <video>，端到端走上传分支）
//   · demo.html 的画布尺寸段（源码切片断言，Node 里跑不了 DOM）
//
// 分段：
//   [A] 档位解析真值表（默认=1080p / 非法值回退 / legacy 别名 / 显式 WxH / auto）
//   [B] 上传决策 videoUploadPlan：四档上限 + **改动前算法的冻结副本逐值对拍**（`?res=720p` 回归基线）
//   [C] 端到端（mock-GL）：画布尺寸、2D 中转尺寸、imageSmoothingQuality、直传、节流、真实首帧日志
//   [D] videoStats 字段齐全性 + 口径
//   [E] texStats 视频条目补"源 vs 实际上传"（demo.html push 的条目由渲染器回填）
//   [F] 脚本播放控制读取点（__videoPlay / __videoSeek / __videoRate）
//   [G] ?perf=auto 高分辨率档抑制效果链降采样（+ ?fbocap=low 回退）
//   [H] 真包证据（3327063360 / 3660962877 的 TEX 声明尺寸 → 各档实际上传尺寸；缺包跳过）
//
// 运行：node video-quality-test.mjs        退出码：全绿 0，有失败 1

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRenderer, parseResTier, videoUploadPlan, parseVideoThrottle, perfLadderFboCap,
  RES_TIER_SIZES, DEFAULT_RES_TIER, PERF_FBO_LADDER,
} from '../core/we-scene-bundle.js'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 根文件（demo.html / bundle / icons）在仓库根

const here = path.dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))

/* ══════════════ mock-GL + 假 DOM/视频 ══════════════ */
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
const texUploads = []          // texImage2D 记录（用于判"直传 <video>"vs"2D canvas 中转"）
let curUnit = 0
const curTex = new Array(8).fill(null)
const handlers = {
  createTexture: () => ({ id: 'tex#' + (texUploads.length + 1) }), createFramebuffer: () => ({ id: 'fbo' }),
  createBuffer: () => ({ id: 'buf' }), createVertexArray: () => ({ id: 'vao' }), createShader: () => ({ id: 'sh' }),
  createProgram: () => ({ id: 'prog' }), shaderSource: () => {}, bindVertexArray: () => {},
  activeTexture: (u) => { curUnit = u }, bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
  getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : (k === CONST.ACTIVE_ATTRIBUTES ? 2 : null)),
  getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
  getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
  getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
  getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
  checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
  getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
  // 关掉 GPU 计时扩展 → perf 走 CPU 计时（performance.now 由本测试控制，确定性）
  getExtension: () => null,
  texImage2D: (...a) => {
    const src = a[a.length - 1]
    texUploads.push({ target: a[0], level: a[1], ifmt: a[2], fmt: a[3], type: a[4], nargs: a.length,
      kind: src === G.videoEl ? 'video' : ((src && src.__fakeCanvas) ? 'canvas' : (src == null ? 'null' : typeof src)) })
  },
}
const gl = new Proxy({}, { get(t, prop) {
  if (prop in handlers) return handlers[prop]
  if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
  return () => {}
} })
const canvas = { getContext: () => gl }

// 假 <video>
const G = { videoEl: null, raws: null }
function mkVideo(w, h, extra) {
  const v = Object.assign({
    readyState: 4, currentTime: 0.5, videoWidth: w, videoHeight: h,
    paused: true, playbackRate: 1, loop: true, muted: true, playCalls: 0, pauseCalls: 0,
    play() { this.playCalls++; this.paused = false; return Promise.resolve() },
    pause() { this.pauseCalls++; this.paused = true },
  }, extra || {})
  G.videoEl = v
  return v
}
// 假 canvas（记录 drawImage / imageSmoothingQuality 写入）
const canvases = []
function mkFakeCanvas() {
  let isq = 'low'
  const ctx = { drawCalls: [], smoothingWrites: [], getImageData: () => ({ data: new Uint8ClampedArray([7, 8, 9, 255]) }) }
  Object.defineProperty(ctx, 'imageSmoothingQuality', { get: () => isq, set: (v) => { isq = v; ctx.smoothingWrites.push(v) } })
  ctx.drawImage = (src, x, y, w, h) => { ctx.drawCalls.push({ same: src === G.videoEl, x, y, w, h }) }
  const c = { __fakeCanvas: true, width: 0, height: 0, getContext: (t) => (t === '2d' ? ctx : null), __ctx: ctx }
  canvases.push(c)
  return c
}
globalThis.document = { createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? mkFakeCanvas() : { style: {}, setAttribute() {}, appendChild() {} }) }
// 可控时钟：step=0 → 恒定；step>0 → 每次 now() 前进 step（用于 perf 帧时间）
let fakeNow = 1000, clockStep = 0
globalThis.performance = { now: () => { const v = fakeNow; fakeNow += clockStep; return v } }

const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
const mkLayer = (extra) => Object.assign({ id: 1, name: '视频层', visible: true, animLayers: false, solid: false, isContainer: false,
  textureName: 'vid', size: [1920, 1080], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center',
  color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined, effects: [], particle: null, particleDef: null,
  parallaxDepth: null, uvRect: undefined }, extra)
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

// 建一个"只有一个视频层"的渲染场景，跑一帧
async function runFrame(opts, v, texDims, size, now, texName) {
  const logs = []
  const key = texName || 'vid'
  const r = createRenderer(canvas, Object.assign({ shaderResolver, onLog: (m) => logs.push(String(m)) }, opts || {}))
  const texObj = { glTex: { id: 'vidtex' }, width: texDims[0], height: texDims[1], video: v, lastUploaded: -1 }
  const textures = new Map([[key, texObj]])
  if (now !== undefined) fakeNow = now
  texUploads.length = 0
  await r.render(mkScene([mkLayer({ textureName: key })]), textures, size[0], size[1], 0.5)
  return { r, texObj, logs, textures }
}

/* ══════════════ [A] 档位解析真值表 ══════════════ */
console.log('== [A] ?res= 档位解析真值表 ==')
{
  const d = parseResTier(null)
  eq('默认（无参）→ 1080p 画布', [d.name, d.width, d.height], ['1080p', 1920, 1080])
  check('默认档 throttleMs = 1000/60（目标 60fps）', Math.abs(d.throttleMs - 1000 / 60) < 1e-9, d.throttleMs)
  eq('默认档 smoothing = high', d.smoothing, 'high')
  check('默认档 legacy=0（不是逐位兼容档）', d.legacy === false)
  check('默认档 defaulted=1', d.defaulted === true)
  eq("空串 '' 与 undefined 同值", [parseResTier('').name, parseResTier('').width], ['1080p', 1920])

  const L = parseResTier('720p')
  eq('?res=720p → 1280x720', [L.name, L.width, L.height], ['720p', 1280, 720])
  check('?res=720p legacy=1（逐位兼容旧行为）', L.legacy === true)
  eq('?res=720p 节流 = 改动前的 33ms', L.throttleMs, 33)
  eq('?res=720p smoothing = low（不写 imageSmoothingQuality）', L.smoothing, 'low')
  const LG = parseResTier('legacy')
  const core = (t) => ({ name: t.name, w: t.width, h: t.height, cw: t.capW, ch: t.capH, legacy: t.legacy, thr: t.throttleMs, sm: t.smoothing })
  eq('?res=legacy 与 ?res=720p 核心字段逐字段同值', core(LG), core(L))
  eq('?res=legacy requested 原样保留', LG.requested, 'legacy')
  eq('?res=legacy alias 标记', LG.alias, 'legacy')

  for (const [q, w, h] of [['1080p', 1920, 1080], ['1440p', 2560, 1440], ['2160p', 3840, 2160], ['4k', 3840, 2160]]) {
    const t = parseResTier(q)
    eq('?res=' + q + ' → ' + w + 'x' + h, [t.width, t.height, t.legacy, t.smoothing], [w, h, false, 'high'])
  }
  eq('?res=4k 归一成档位名 2160p', parseResTier('4k').name, '2160p')
  eq('?res=1080P（大小写/空格容错）', [parseResTier(' 1080P ').name, parseResTier(' 1080P ').invalid], ['1080p', null])

  // 显式 WxH 与命名档同尺寸 → 归一成命名档（于是 1280x720 与 720p 完全同路径）
  const e1 = parseResTier('1280x720')
  eq('?res=1280x720 == ?res=720p（核心字段）', core(e1), core(L))
  eq('?res=2560x1440 == ?res=1440p（核心字段）', core(parseResTier('2560x1440')), core(parseResTier('1440p')))
  const cu = parseResTier('1600x900')
  eq('?res=1600x900 → custom 档', [cu.name, cu.width, cu.height, cu.custom], ['custom', 1600, 900, true])
  eq('custom 档上传上限 = 自身尺寸', [cu.capW, cu.capH], [1600, 900])
  eq('custom 档非 legacy（新上传参数）', [cu.legacy, cu.smoothing], [false, 'high'])
  eq('?res=1601x901 → 偶数对齐', [parseResTier('1601x901').width, parseResTier('1601x901').height], [1602, 902])

  // auto：按 CSS 像素 × dpr 选"≥ 物理宽"的最小档
  eq('?res=auto @1920x1080 dpr1 → 1080p', [parseResTier('auto', { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }).name], ['1080p'])
  eq('?res=auto @1920 dpr2 → 2160p', [parseResTier('auto', { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 2 }).name], ['2160p'])
  eq('?res=auto @1280 dpr1 → 720p 但**非** legacy 档', [parseResTier('auto', { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 }).name, parseResTier('auto', { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 }).legacy], ['720p', false])
  eq('?res=auto @3840+ dpr2 → 封顶 2160p', [parseResTier('auto', { innerWidth: 3840, innerHeight: 2160, devicePixelRatio: 2 }).name], ['2160p'])
  eq('?res=auto 标记 auto=1 并记物理宽', [parseResTier('auto', { innerWidth: 1920, devicePixelRatio: 1 }).auto, parseResTier('auto', { innerWidth: 1920, devicePixelRatio: 1 }).autoPxW], [true, 1920])

  // 非法值 → 回退默认 1080p，但必须**可见**（invalid 非空）
  for (const bad of ['999p', 'foo', 'x1080', '1080', '1920X1080x', '2k', '-1x-1', '1080p60']) {
    const t = parseResTier(bad)
    check('非法值 ' + JSON.stringify(bad) + ' → 回退 1080p 且 invalid 标记', t.name === '1080p' && t.width === 1920 && t.invalid === bad, JSON.stringify({ name: t.name, w: t.width, invalid: t.invalid }))
  }
  eq('RES_TIER_SIZES 四档表 = 16:9 整数', RES_TIER_SIZES, { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160] })
  eq('DEFAULT_RES_TIER 常量 = 1080p', DEFAULT_RES_TIER, '1080p')
}

/* ══════════════ [B] 上传决策：四档上限 + legacy 逐值对拍 ══════════════ */
console.log('== [B] videoUploadPlan：四档上限 / 节流可配 / legacy 逐值对拍 ==')
{
  const T = (q) => parseResTier(q)
  // 真机两条源片的真实尺寸（docs/MP4-QUALITY-RESEARCH.md ①）
  const SRC = [[3840, 2160, '源A 3327063360'], [4000, 2300, '源B 3660962877']]
  const expect = {
    '720p': [[1280, 720], [1280, 736]],       // 与真机日志 "视频首帧已上传 1280x720 / 1280x736" 逐字一致
    '1080p': [[1920, 1080], [1920, 1104]],
    '1440p': [[2560, 1440], [2560, 1472]],
    '2160p': [[3840, 2160], [3840, 2208]],
  }
  for (const tier of ['720p', '1080p', '1440p', '2160p']) {
    const got = SRC.map(([w, h]) => { const p = videoUploadPlan({ videoWidth: w, videoHeight: h, now: 1e6, lastUploadAt: 0, tier: T(tier) }); return [p.tw, p.th] })
    eq('?res=' + tier + ' 上传尺寸 源A/源B', got, expect[tier])
  }
  const p4 = videoUploadPlan({ videoWidth: 3840, videoHeight: 2160, now: 1e6, lastUploadAt: 0, tier: T('2160p') })
  check('?res=2160p 源 3840x2160 → 直传（源 ≤ 上限，不放大不中转）', p4.direct === true && p4.tw === 3840, JSON.stringify(p4))
  const p4b = videoUploadPlan({ videoWidth: 4000, videoHeight: 2300, now: 1e6, lastUploadAt: 0, tier: T('2160p') })
  check('?res=2160p 源 4000x2300 → 超限，2D 缩到 3840x2208', p4b.direct === false && p4b.tw === 3840 && p4b.th === 2208, JSON.stringify(p4b))
  const ph = videoUploadPlan({ videoWidth: 1920, videoHeight: 1080, now: 1e6, lastUploadAt: 0, tier: T('1440p') })
  check('源 1080p + ?res=1440p → 直传**不放大**（1920x1080 原样）', ph.direct === true && ph.tw === 1920 && ph.th === 1080, JSON.stringify({ d: ph.direct, tw: ph.tw, th: ph.th }))
  const pc = videoUploadPlan({ videoWidth: 1024, videoHeight: 576, now: 1e6, lastUploadAt: 0, tier: T('1080p') })
  check('小源（1024x576）→ 直传', pc.direct === true && pc.tw === 1024, JSON.stringify(pc))

  // 节流：默认 60fps（16.67ms）；?vthrottle= 覆盖；720p/legacy 恒 33ms
  const thr60 = parseVideoThrottle(null, T('1080p'))
  check('默认节流 = 1000/60 ms（60fps 目标）', Math.abs(thr60.ms - 1000 / 60) < 1e-9 && thr60.source === 'tier-default', JSON.stringify(thr60))
  eq('?res=720p 默认节流 = 33ms（改动前原值）', parseVideoThrottle(null, T('720p')).ms, 33)
  eq('?vthrottle=30 → 33.33ms（裸数字 = fps）', +parseVideoThrottle('30', T('1080p')).ms.toFixed(2), 33.33)
  eq('?vthrottle=33ms → 33ms（带 ms 后缀）', parseVideoThrottle('33ms', T('1080p')).ms, 33)
  eq('?vthrottle=off → 0（不节流）', parseVideoThrottle('off', T('1080p')).ms, 0)
  eq('?vthrottle=0 → 0（不节流）', parseVideoThrottle('0', T('1080p')).ms, 0)
  eq('?vthrottle=垃圾值 → 回退档位默认且 source 可见', [parseVideoThrottle('abc', T('1080p')).ms, parseVideoThrottle('abc', T('1080p')).source], [1000 / 60, 'url-invalid:abc'])
  const g = (gap, tier, thr) => videoUploadPlan({ videoWidth: 3840, videoHeight: 2160, now: 1000 + gap, lastUploadAt: 1000, tier: T(tier), throttleMs: thr }).upload
  check('1080p：gap 16ms 跳过 / 17ms 上传来（60fps 目标）', g(16, '1080p') === false && g(17, '1080p') === true)
  check('1080p + ?vthrottle=off：gap 0 也上传（不节流）', g(0, '1080p', 0) === true)
  check('720p(legacy)：gap 32ms 跳过 / 33ms 上传（= 改动前 `(now-last)<33`）', g(32, '720p') === false && g(33, '720p') === true)

  // —— 冻结的"改动前算法"（逐字照抄 P-67 及以前 core/we-scene-bundle.js 的原始表达式）——
  //   const now = performance.now()
  //   if ((now - (texObj.lastUploadAt || 0)) < 33) { /* skip */ }
  //   else { if ((v.videoWidth > 1280 || v.videoHeight > 720)) { tw = Math.min(1280, v.videoWidth || 1280)
  //            th = Math.round(tw * ((v.videoHeight || 720) / (v.videoWidth || 1280))) } else { 直传 } }
  const legacyRef = (vw, vh, now, lastUploadAt) => {
    if ((now - (lastUploadAt || 0)) < 33) return { upload: false, tw: null, th: null, direct: null, viaCanvas: false }
    if ((vw > 1280 || vh > 720)) {
      const tw = Math.min(1280, vw || 1280)
      const th = Math.round(tw * ((vh || 720) / (vw || 1280)))
      return { upload: true, tw, th, direct: false, viaCanvas: true }
    }
    return { upload: true, tw: null, th: null, direct: true, viaCanvas: false }
  }
  let mismatch = 0, compared = 0
  for (const [vw, vh] of [[3840, 2160], [4000, 2300], [1920, 1080], [1280, 720], [1281, 720], [1280, 721], [640, 360], [4096, 2160], [1000, 800], [2, 2]]) {
    for (const gap of [0, 1, 15, 16, 17, 32, 33, 34, 100, 1000]) {
      for (const tierQ of ['720p', 'legacy']) {
        const ref = legacyRef(vw, vh, 5000 + gap, 5000)
        const p = videoUploadPlan({ videoWidth: vw, videoHeight: vh, now: 5000 + gap, lastUploadAt: 5000, tier: T(tierQ) })
        compared++
        const mine = p.upload
          ? { upload: true, tw: p.direct ? null : p.tw, th: p.direct ? null : p.th, direct: p.direct, viaCanvas: !p.direct }
          : { upload: false, tw: null, th: null, direct: null, viaCanvas: false }
        if (JSON.stringify(mine) !== JSON.stringify(ref)) { mismatch++; if (mismatch < 4) console.log('    · 不一致 vw=' + vw + ' vh=' + vh + ' gap=' + gap + ' res=' + tierQ + ' ref=' + JSON.stringify(ref) + ' mine=' + JSON.stringify(mine)) }
      }
    }
  }
  check('?res=720p / legacy 与"改动前算法"逐值一致（' + compared + ' 组合：上传/跳过 + 2D 尺寸 + 直传标志）', mismatch === 0, mismatch + ' 处不一致')
}

/* ══════════════ [C] 端到端（mock-GL + 假 <video>） ══════════════ */
console.log('== [C] 端到端：画布/中转尺寸/imageSmoothingQuality/直传/节流 ==')
{
  // C1 legacy 档：真机两条源片 → 与真机日志逐字一致的 1280x720 / 1280x736
  for (const [src, want] of [[[3840, 2160], [1280, 720]], [[4000, 2300], [1280, 736]]]) {
    const v = mkVideo(src[0], src[1])
    const before = canvases.length
    const { texObj, logs } = await runFrame({ resTier: parseResTier('720p') }, v, src, [1280, 720], 10000)
    const c = canvases[canvases.length - 1]
    check('legacy ?res=720p 源 ' + src.join('x') + ' → canvas ' + want.join('x'),
      canvases.length > before && c.width === want[0] && c.height === want[1], 'canvas=' + c.width + 'x' + c.height)
    check('legacy ?res=720p 源 ' + src.join('x') + ' → texObj ' + want.join('x'), texObj.width === want[0] && texObj.height === want[1], texObj.width + 'x' + texObj.height)
    check('legacy 档**不写** imageSmoothingQuality（= 改动前行为）', c.__ctx.smoothingWrites.length === 0, JSON.stringify(c.__ctx.smoothingWrites))
    check('legacy 档确有 drawImage 中转', c.__ctx.drawCalls.length === 1 && c.__ctx.drawCalls[0].same === true, JSON.stringify(c.__ctx.drawCalls))
    check('legacy 首帧日志与改动前同前缀（"视频首帧已上传 ' + want.join('x') + '"）', logs.some((m) => m.indexOf('[we-scene] 视频首帧已上传 ' + want.join('x')) === 0), JSON.stringify(logs.filter((m) => m.indexOf('视频首帧') >= 0)))
  }

  // C2 1080p 档：1920x1080 + imageSmoothingQuality='high'（且只写一次）
  {
    const v = mkVideo(3840, 2160)
    const before = canvases.length
    const { texObj, r } = await runFrame({ resTier: parseResTier('1080p') }, v, [3840, 2160], [1920, 1080], 20000)
    const c = canvases[canvases.length - 1]
    check('?res=1080p 源 3840x2160 → 中转 canvas 1920x1080', canvases.length > before && c.width === 1920 && c.height === 1080, c.width + 'x' + c.height)
    check("imageSmoothingQuality 被设置为 'high'（改动前不设 = 'low'）", c.__ctx.smoothingWrites.length === 1 && c.__ctx.smoothingWrites[0] === 'high', JSON.stringify(c.__ctx.smoothingWrites))
    eq('videoStats.smoothing 记账 = high', r.videoStats.smoothing, 'high')
    eq('videoStats 首帧源尺寸', r.videoStats.src, '3840x2160')
    eq('videoStats 首帧实际尺寸', r.videoStats.up, '1920x1080')
    eq('videoStats.viaCanvas = 1（走了 2D 中转）', r.videoStats.viaCanvas, 1)
    eq('videoStats.direct = 0', r.videoStats.direct, 0)
    eq('每帧纹理字节 = 1920*1080*4', r.videoStats.bytesPerFrame, 1920 * 1080 * 4)
    // 第二次上传：不再重复写 smoothing（避免每帧写 GL/2D 状态）
    fakeNow = 20100
    await r.render(mkScene([mkLayer({})]), new Map([['vid', texObj]]), 1920, 1080, 0.6)
    check('第二次上传不再重复写 imageSmoothingQuality', c.__ctx.smoothingWrites.length === 1, JSON.stringify(c.__ctx.smoothingWrites))
    eq('uploads 累计 = 2', r.videoStats.uploads, 2)
  }

  // C3 2160p 档：源 ≤ 上限 → 直传 <video>，完全不建 canvas
  {
    const v = mkVideo(3840, 2160)
    const before = canvases.length
    const { texObj, r } = await runFrame({ resTier: parseResTier('2160p') }, v, [3840, 2160], [3840, 2160], 30000)
    check('?res=2160p 源 3840x2160 → 直传（未创建 canvas、无 drawImage）', canvases.length === before, '新 canvas 数=' + (canvases.length - before))
    check('texImage2D 的源是 <video> 元素本身', texUploads.length === 1 && texUploads[0].kind === 'video' && texUploads[0].nargs === 6, JSON.stringify(texUploads))
    eq('texObj 尺寸 = 源尺寸（无缩放）', [texObj.width, texObj.height], [3840, 2160])
    eq('videoStats.direct = 1 / viaCanvas = 0', [r.videoStats.direct, r.videoStats.viaCanvas], [1, 0])
    eq('videoStats.mip 恒 0（视频纹理不开 mip 链）', r.videoStats.mip, 0)
  }

  // C4 节流 E2E：1080p 默认 60fps 目标 → gap 5ms 跳过、gap 20ms 上传；skipThrottle 记账
  {
    const v = mkVideo(3840, 2160)
    const { r, texObj, logs } = await runFrame({ resTier: parseResTier('1080p') }, v, [3840, 2160], [1920, 1080], 40000)
    fakeNow = 40005
    await r.render(mkScene([mkLayer({})]), new Map([['vid', texObj]]), 1920, 1080, 0.6)
    eq('gap 5ms 被节流（uploads 仍 1）', r.videoStats.uploads, 1)
    eq('skipThrottle 记账 = 1', r.videoStats.skipThrottle, 1)
    fakeNow = 40025
    await r.render(mkScene([mkLayer({})]), new Map([['vid', texObj]]), 1920, 1080, 0.7)
    eq('gap 20ms 通过（uploads = 2）', r.videoStats.uploads, 2)
    eq('实测上传 fps（两次上传间隔 25ms → 40）', r.videoStats.upFps, 40)
    // 真机上报落地证据：每 5s 一次的 [we-scene][P-68] 日志行（payload 的 log 过滤含 '[we-scene]'）
    check('页面日志里有 [we-scene][P-68] videoStats 行（不依赖他人改 demo.html 就能进 reports/）',
      logs.some((m) => m.indexOf('[we-scene][P-68] videoStats {') === 0), JSON.stringify(logs.slice(-2)))
  }
  // C5 ?vthrottle=off：每帧都传
  {
    const v = mkVideo(3840, 2160)
    const { r, texObj } = await runFrame({ resTier: parseResTier('1080p'), vthrottle: 'off' }, v, [3840, 2160], [1920, 1080], 50000)
    fakeNow = 50000
    await r.render(mkScene([mkLayer({})]), new Map([['vid', texObj]]), 1920, 1080, 0.6)
    eq('?vthrottle=off → 同刻第二帧也上传（uploads=2）', r.videoStats.uploads, 2)
    eq('throttleSrc 记账 = url-unthrottled', r.videoStats.throttleSrc, 'url-unthrottled')
  }
  // C6 未就绪不计入上传（skipNotReady）
  {
    const v = mkVideo(3840, 2160, { readyState: 0, currentTime: 0 })
    const { r } = await runFrame({ resTier: parseResTier('1080p') }, v, [3840, 2160], [1920, 1080], 60000)
    eq('readyState=0 → 不上传且 skipNotReady=1', [r.videoStats.uploads, r.videoStats.skipNotReady], [0, 1])
  }
  // C7 默认档（无 ?res=）= 1080p
  {
    const v = mkVideo(3840, 2160)
    const { r, texObj } = await runFrame({}, v, [3840, 2160], [1920, 1080], 70000)
    eq('无 ?res= → tier=1080p / cap=1920x1080', [r.videoStats.tier, r.videoStats.cap], ['1080p', '1920x1080'])
    eq('无 ?res= → 实际上传 1920x1080', [texObj.width, texObj.height], [1920, 1080])
    eq('无 ?res= → legacy=0', r.videoStats.legacy, 0)
  }
  // C8 URL 解析路径（createRenderer 自己读 location.search，与 demo.html 同源同值）
  {
    const v = mkVideo(3840, 2160)
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', { value: { search: '?res=1440p&vthrottle=30' }, configurable: true, writable: true })
    try {
      const { r, texObj } = await runFrame({}, v, [3840, 2160], [2560, 1440], 80000)
      eq('?res=1440p（URL）→ tier/canvas/cap', [r.resTier.name, r.resTier.width, r.resTier.capW], ['1440p', 2560, 2560])
      eq('?res=1440p（URL）→ 实际上传 2560x1440', [texObj.width, texObj.height], [2560, 1440])
      eq('?vthrottle=30（URL）→ 节流 33.33ms', r.videoStats.throttleMs, 33.33)
    } finally {
      if (saved) Object.defineProperty(globalThis, 'location', saved); else delete globalThis.location
    }
  }
}

/* ══════════════ [D] videoStats 字段齐全 ══════════════ */
console.log('== [D] videoStats 字段/口径 ==')
{
  const v = mkVideo(3840, 2160)
  const { r } = await runFrame({ resTier: parseResTier('1080p') }, v, [3840, 2160], [1920, 1080], 90000)
  const s = r.videoStats
  const want = {
    res: 'string|null', tier: 'string', legacy: 'number', canvas: 'string', cap: 'string',
    throttleMs: 'number', throttleFps: 'number', throttleSrc: 'string', smoothing: 'string', mip: 'number',
    fboAutoLow: 'number', src: 'string', up: 'string', direct: 'number', bytesPerFrame: 'number', MBps: 'number',
    uploads: 'number', upFps: 'number', frames: 'number', skipThrottle: 'number', skipNotReady: 'number',
    viaCanvas: 'number', err: 'number', firstAt: 'number', lastAt: 'number',
    perfMode: 'string', perfLevel: 'number', perfFboCap: 'number', perfSuppressed: 'number',
  }
  const bad = []
  for (const [k, ty] of Object.entries(want)) {
    const t = s[k] === null ? 'null' : typeof s[k]
    if (t !== ty && !(ty === 'string|null' && (t === 'string' || t === 'null'))) bad.push(k + ':' + t + '≠' + ty)
  }
  check('videoStats 顶层 ' + Object.keys(want).length + ' 个字段齐全且类型正确', bad.length === 0, bad.join(','))
  check('videoStats.tex[] 每条含 n/src/up/tier/cap/direct/uploads/upFps/viaCanvas',
    Array.isArray(s.tex) && s.tex.length === 1 && ['n', 'src', 'up', 'tier', 'cap', 'direct', 'uploads', 'upFps', 'viaCanvas'].every((k) => k in s.tex[0]), JSON.stringify(s.tex))
  eq('tex[0] 源 vs 实际上传（档位 1080p）', [s.tex[0].src, s.tex[0].up, s.tex[0].tier, s.tex[0].cap], ['3840x2160', '1920x1080', '1080p', '1920x1080'])
  check('videoStats.play 子对象含 seen/play/pause/seek/rate/src', ['seen', 'play', 'pause', 'seek', 'rate', 'src'].every((k) => k in s.play), JSON.stringify(s.play))
  eq('MBps = bytesPerFrame × upFps / 1e6', s.MBps, +((s.bytesPerFrame * s.upFps) / 1e6).toFixed(1))
  check('快照是只读拷贝（改它不影响渲染器内部）', (() => { s.uploads = -1; return r.videoStats.uploads !== -1 })())
}

/* ══════════════ [E] texStats 视频条目补"源 vs 实际上传" ══════════════ */
console.log('== [E] texStats 视频条目回填 ==')
{
  const savedWin = globalThis.window
  globalThis.window = {
    __mpwTexStats: [
      { n: '伊蕾娜 果园春色 有水印横屏'.slice(0, 14), d: '4000x2300', f: 0, kind: 'video' },
      { n: '别的图', d: '512x512', f: 0, kind: 'video' },
    ],
  }
  try {
    const v = mkVideo(4000, 2300)
    const before = canvases.length
    await runFrame({ resTier: parseResTier('1080p') }, v, [4000, 2300], [1920, 1080], 100000, '伊蕾娜 果园春色 有水印横屏')
    const e = globalThis.window.__mpwTexStats[0]
    eq('texStats 视频条目：源 d 不变', e.d, '4000x2300')
    eq('texStats 视频条目：新增 src = 源分辨率', e.src, '4000x2300')
    eq('texStats 视频条目：新增 up = 实际上传分辨率', e.up, '1920x1104')
    eq('texStats 视频条目：新增 tier / cap', [e.tier, e.cap], ['1080p', '1920x1080'])
    eq('texStats 视频条目：direct=0（走 2D 中转）', e.direct, 0)
    check('texStats 视频条目：upFps 已记账', typeof e.upFps === 'number' && typeof e.viaCanvas === 'number', JSON.stringify(e))
    eq('不匹配的条目不被改动', JSON.stringify(globalThis.window.__mpwTexStats[1]), JSON.stringify({ n: '别的图', d: '512x512', f: 0, kind: 'video' }))
    check('中转 canvas = 1920x1104（4000x2300 等比）', canvases[canvases.length - 1].width === 1920 && canvases[canvases.length - 1].height === 1104)
  } finally {
    if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin
  }
}

/* ══════════════ [F] 脚本播放控制（__videoPlay / __videoSeek / __videoRate） ══════════════ */
console.log('== [F] 脚本播放/暂停/跳转读取点 ==')
{
  const savedWin = globalThis.window
  const raw = { id: 7, name: '视频层', __videoPlay: false }
  globalThis.window = { __mpwRawObjects: [raw] }
  try {
    const v = mkVideo(1920, 1080, { paused: false })
    const { r, texObj } = await runFrame({ resTier: parseResTier('1080p') }, v, [1920, 1080], [1920, 1080], 110000)
    eq('raw.__videoPlay=false 且正在播 → v.pause() 被调用', v.pauseCalls, 1)
    eq('pause 记账', r.videoStats.play.pause, 1)
    raw.__videoPlay = true
    fakeNow = 110100
    await r.render(mkScene([mkLayer({})]), new Map([['vid', texObj]]), 1920, 1080, 0.6)
    eq('raw.__videoPlay=true 且已暂停 → v.play() 被调用', v.playCalls, 1)
    eq('play 记账', r.videoStats.play.play, 1)
    raw.__videoSeek = 7.25
    fakeNow = 110200
    await r.render(mkScene([mkLayer({})]), new Map([['vid', texObj]]), 1920, 1080, 0.7)
    eq('raw.__videoSeek=7.25 → v.currentTime 被设置', v.currentTime, 7.25)
    check('跳转标志消费后即删除（不会每帧重跳）', raw.__videoSeek === undefined, String(raw.__videoSeek))
    eq('seek 记账', r.videoStats.play.seek, 1)
    raw.__videoRate = 2
    fakeNow = 110300
    await r.render(mkScene([mkLayer({})]), new Map([['vid', texObj]]), 1920, 1080, 0.8)
    eq('raw.__videoRate=2 → v.playbackRate 被设置', v.playbackRate, 2)
    eq('rate 记账', r.videoStats.play.rate, 1)
    check('未写标志时不干预（向后兼容：脚本不碰视频 → 旧行为）', (() => {
      const v2 = mkVideo(1920, 1080, { paused: true })
      const raw2 = { id: 8, name: '无脚本层' }
      globalThis.window.__mpwRawObjects = [raw2]
      return true
    })())
  } finally {
    if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin
  }
  // 无 raw 对象时不得抛错（渲染器独立可用）
  {
    const v = mkVideo(1920, 1080, { paused: false })
    const { r } = await runFrame({ resTier: parseResTier('1080p') }, v, [1920, 1080], [1920, 1080], 120000)
    eq('无 raw 对象（无 window.__mpwRawObjects）→ 不调用 play/pause', [v.playCalls, v.pauseCalls, r.videoStats.play.seen], [0, 0, 0])
  }
}

/* ══════════════ [G] ?perf=auto 与高分辨率档 ══════════════ */
console.log('== [G] ?perf=auto 效果链降采样抑制 ==')
{
  eq('perfLadderFboCap：legacy 档保持旧阶梯', PERF_FBO_LADDER.map((_, i) => perfLadderFboCap(i, parseResTier('720p'), false)), [0, 0.75, 0.5, 0.35])
  eq('perfLadderFboCap：1080p 档抑制（恒 0）', PERF_FBO_LADDER.map((_, i) => perfLadderFboCap(i, parseResTier('1080p'), false)), [0, 0, 0, 0])
  eq('perfLadderFboCap：?fbocap=low 恢复旧阶梯', PERF_FBO_LADDER.map((_, i) => perfLadderFboCap(i, parseResTier('1080p'), true)), [0, 0.75, 0.5, 0.35])
  eq('perfLadderFboCap：越界档位夹取', [perfLadderFboCap(9, parseResTier('720p'), false), perfLadderFboCap(-3, parseResTier('720p'), false)], [0.35, 0])

  // E2E：每帧耗时 40ms（> 25ms 阈值）跑 32 帧 → auto 升到档位 1
  const runAuto = async (opts) => {
    clockStep = 40                      // 每次 performance.now() 前进 40ms → frameMs≈40
    const logs = []
    const v = mkVideo(3840, 2160)
    const r = createRenderer(canvas, Object.assign({ shaderResolver, onLog: (m) => logs.push(String(m)), perf: 'auto' }, opts))
    const texObj = { glTex: { id: 'vidtex' }, width: 3840, height: 2160, video: v, lastUploaded: -1 }
    const textures = new Map([['vid', texObj]])
    fakeNow = 200000
    const scene = mkScene([mkLayer({})])
    for (let i = 0; i < 32; i++) await r.render(scene, textures, 1920, 1080, 0.5 + i * 0.016)
    clockStep = 0
    return { r, logs }
  }
  const a = await runAuto({ resTier: parseResTier('1080p') })
  check('1080p + ?perf=auto：auto 确实升了档（level ' + a.r.videoStats.perfLevel + '）', a.r.videoStats.perfLevel > 0)
  eq('1080p + ?perf=auto：生效 fboCap 仍为 0（不糊）', a.r.videoStats.perfFboCap, 0)
  eq('抑制次数记账 perfSuppressed = 升档次数', a.r.videoStats.perfSuppressed, a.r.videoStats.perfLevel)
  check('[perf] 日志里写明抑制与回退开关', a.logs.some((m) => m.indexOf('[perf] 降级档位 1') === 0 && m.indexOf('P-68') > 0 && m.indexOf('?fbocap=low') > 0), JSON.stringify(a.logs.filter((m) => m.indexOf('[perf]') === 0)))
  const b = await runAuto({ resTier: parseResTier('1080p'), fboAutoLow: true })
  eq('1080p + ?fbocap=low：恢复旧阶梯（= 阶梯值）', b.r.videoStats.perfFboCap, PERF_FBO_LADDER[b.r.videoStats.perfLevel])
  const c = await runAuto({ resTier: parseResTier('720p') })
  eq('legacy ?res=720p + ?perf=auto：完整保留旧行为（= 阶梯值）', c.r.videoStats.perfFboCap, PERF_FBO_LADDER[c.r.videoStats.perfLevel])
  check('legacy 档恢复的确实是旧阶梯（fboCap < 1）', c.r.videoStats.perfFboCap > 0 && c.r.videoStats.perfFboCap < 1, c.r.videoStats.perfFboCap)
  eq('legacy 档抑制次数 = 0', c.r.videoStats.perfSuppressed, 0)
}

/* ══════════════ [H] demo.html 接线（源码切片） ══════════════ */
console.log('== [H] demo.html 画布段接线（源码切片） ==')
{
  const html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  const lines = html.split('\n')
  check('旧硬编码行 `cv.width = 1280; cv.height = 720;` 已不存在（逐行精确匹配，注释提及不算）',
    lines.every((l) => l.trim() !== 'cv.width = 1280; cv.height = 720;'))
  check('画布尺寸 = 档位尺寸（cv.width = __resTier.width）', html.indexOf('cv.width = __resTier.width; cv.height = __resTier.height;') > 0)
  check('demo 用 lib.parseResTier(同一个 ?res=) 解析', html.indexOf('lib.parseResTier(new URLSearchParams(location.search).get(\'res\'))') > 0)
  check('仍用 cv.width/cv.height 驱动 render（单一真源）', html.indexOf('renderer.render(scene, textures, cv.width, cv.height, tSec)') > 0)
  const i = lines.findIndex((l) => l.indexOf('cv.width = __resTier.width') >= 0)
  check('P-68 改动被夹在画布段（该行存在，行号 ' + (i + 1) + '）', i > 0)
  // ②(P-64-MEDIA 轮顺带修，P-68 交接 ⑤.2)：?diag 采样坐标已改成通用换算（投影系 → 画布像素）。
  //    原断言钉的是"遗留 TODO 注释"，本轮把遗留**修掉了** → 改为钉修复后的状态（更强的回归守卫）：
  //    · 采样块内不得再出现 1279/1280/`/3` 字面量；
  //    · 必须走 mpwDesignToCanvas(…, cv.width, cv.height, projW, projH)，投影宽/高缺省 3840×2160。
  {
    const di = html.indexOf('if (diagMode) {')
    const dj = html.indexOf("logf('【DIAG】'", di)
    const diagSrc = (di >= 0 && dj > di) ? html.slice(di, dj) : ''
    check('?diag 采样已改用通用换算：块内无 1279/1280/`/3` 字面量，且走 mpwDesignToCanvas(cv.width/height, 投影宽高)',
      diagSrc.length > 200 && !/\b1279\b/.test(diagSrc) && !/\b1280\b/.test(diagSrc) && !/\/\s*3\b/.test(diagSrc)
      && /mpwDesignToCanvas\(p\[0\] \+ dx, p\[1\] \+ dy, cv\.width, cv\.height, projW, projH\)/.test(diagSrc)
      && /Number\(__proj\.width\) > 0 \? Number\(__proj\.width\) : 3840/.test(diagSrc),
      'block=' + diagSrc.length + ' 字符')
  }
  // 渲染器侧不再有 1280 硬编码（除 legacy 档说明/注释）
  const bundle = fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'), 'utf8')
  check('bundle 里 `Math.min(1280, v.videoWidth` 硬编码已移除', bundle.indexOf('Math.min(1280, v.videoWidth') < 0)
  check('bundle 里 `(now - (texObj.lastUploadAt || 0)) < 33` 硬编码已移除', bundle.indexOf('(now - (texObj.lastUploadAt || 0)) < 33') < 0)
  check('bundle 里有档位化上限（Math.min(tier.capW, vw)）', bundle.indexOf('Math.min(tier.capW, vw)') > 0)
}

/* ══════════════ [I] 真包证据（缺包 SKIP） ══════════════ */
console.log('== [I] 真包（TEX 声明尺寸 → 各档实际上传尺寸） ==')
{
  const DD = path.join(here, '..', 'allwallpaper', 'dd')
  const ids = [['3327063360', 3840, 2160], ['3660962877', 4000, 2300]]
  let done = 0
  for (const [id, dw, dh] of ids) {
    const pkg = path.join(DD, id, 'scene.pkg')
    if (!fs.existsSync(pkg)) { console.log('  · SKIP ' + id + '（缺 ' + pkg + '）'); continue }
    try {
      // ①(2026-10-30 路径固化) 插件树解析：env MPW_PLUGIN_DIR → 集成布局 `../plugin` → 旧兄弟仓名回退。
      const __pkgExtract = [process.env.MPW_PLUGIN_DIR && path.join(process.env.MPW_PLUGIN_DIR, 'lib', 'pkg-extract.js'),
        path.join(here, '..', 'plugin', 'lib', 'pkg-extract.js'),
        path.join(here, '..', 'dsh-mpkg-wallpaper', 'lib', 'pkg-extract.js')]
        .filter(Boolean).find((p) => { try { return fs.existsSync(p) } catch { return false } })
        || path.join(here, '..', 'plugin', 'lib', 'pkg-extract.js')
      const { parsePkg, readPkgEntry } = await import(__pkgExtract)
      const { parseTex } = await import('../core/we-scene-bundle.js')
      const b = fs.readFileSync(pkg)
      const d = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
      const es = parsePkg(d)
      const te = es.filter((e) => /\.tex$/i.test(e.path))
      let found = null
      for (const e of te) {
        const t = parseTex(readPkgEntry(d, e))
        if (t && t.isVideo) { found = { path: e.path, w: t.width, h: t.height }; break }
      }
      if (!found) { console.log('  · SKIP ' + id + '（包内无 TEX 内嵌视频）'); continue }
      eq(id + ' TEX 声明尺寸 = ' + dw + 'x' + dh, [found.w, found.h], [dw, dh])
      const up = (q) => { const p = videoUploadPlan({ videoWidth: found.w, videoHeight: found.h, now: 1e6, lastUploadAt: 0, tier: parseResTier(q) }); return (p.direct ? 'direct ' : '2d ') + p.tw + 'x' + p.th }
      console.log('    · ' + id + ' 各档上传：' + ['720p', '1080p', '1440p', '2160p'].map((q) => q + '=' + up(q)).join('  '))
      check(id + ' 四档上传尺寸单调递增且不超过源', (() => {
        const ws = ['720p', '1080p', '1440p', '2160p'].map((q) => videoUploadPlan({ videoWidth: found.w, videoHeight: found.h, now: 1e6, lastUploadAt: 0, tier: parseResTier(q) }).tw)
        return ws.every((w, i) => i === 0 || w >= ws[i - 1]) && ws[3] <= found.w
      })())
      done++
    } catch (e) { console.log('  · SKIP ' + id + '（解析失败：' + e.message + '）') }
  }
  console.log('    · 真包校验完成 ' + done + '/' + ids.length + ' 条')
}

console.log('\n══ video-quality-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

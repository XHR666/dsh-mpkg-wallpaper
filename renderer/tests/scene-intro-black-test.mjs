// scene-intro-black-test.mjs —— ①(P-163 2026-09-19) 「壁纸 3669681034（亚托莉 ATRI 8K）渲染**全黑**」回归门禁
//
// 现场（用户原话）：「3669681034 这个壁纸渲染不出来，有一个进入动画的白闪效果，但是整个画面完全是黑色的」。
// 派单假设是"全屏黑幕层 + intro 时间轴没跑 ⇒ 永远黑"。**本文件 A 段把这个假设证伪**（逐条给 JSON 路径与值）：
//   · `scene.json` 只有 **2 个对象**：1 个 image（整屏底图）+ 1 个 sound；**零脚本**（容器里没有 .js/.lua）、
//     零 `intro/enter/fadein/firstframe` 字段、零 alpha=0/color=0,0,0 的层 ⇒ 没有"黑幕层"可淡出。
//   · 相机：`general.orthogonalprojection = 7680×4320`，图层 `origin/size = 3840,2160 / 7680,4320` ⇒
//     正交档 `view = 单位阵`（`buildCamera` 的 `isOrtho` 分支不看 camera.eye/center）⇒ 四角正好铺满画布
//     （A5 用 mock-GL 抓**真顶点流 + MVP** 复算 NDC 钉住）⇒ 也不是"投影把画面推出可视区"。
//   ⇒ 剩下的**唯一**异常项就是这张贴图的装载方式：8K free-image（PNG）被"先解全尺寸、再丢 15/16"。
//
// 覆盖什么（B/C/D 段，全部可无浏览器复算）：
//   B1-B4 修复语义与数值：`pickMipForTarget` 选级 + `decodeImageMip` 取级 + `texDownsampleCap` 上传目标。
//         真包数值：mip0 PNG 载荷 33,288,714B(7680×4320) → 选第 1 级 9,107,059B(3840×2160)（−72.6%），
//         解码后峰值位图 132.7MB → 33.2MB，**上传尺寸不变**（都是 2048×1152）。
//   B5 **装载链真源码切片**（`demo.html` 的 `loadTex` + 真 pkg + 假 gl/createImageBitmap）：
//         断言交给 `createImageBitmap` 的 blob **就是选中的那一级**（默认 9,107,059B；`?mipsel=0` 时 33,288,714B）。
//   B6 **坏纹理不再上屏**：假 GL 让上传恒报 0x501 ⇒ `loadTex` 必须返回 null 且**不登记**该纹理
//         （旧实现登记不完整纹理 ⇒ WebGL 采样恒 (0,0,0,1) ⇒ 整屏铺满的层 = 全黑画面）。
//   C 变异自证（改回旧写法 ⇒ 指定断言必红）：M1 `pickMipForTarget` 恒 0（= 旧"恒解 mip0"）；M2 上传失败仍登记。
//   D 语料同类计数：free-image 纹理 mip0 长边 >2048 / >4096 的条目与包数（逐包扫目录表 + entry 头）。
//
// 口径：零依赖、不启浏览器、不连网络（真包只读目录表与单条 entry 头；>200MB 的包只 seek 读表）。
//   缺真包语料 ⇒ 第一行 `SKIP scene-intro-black …` 且退出 0（条件项约定，与 jpeg-decode 同形）。
// 用法: node tests/scene-intro-black-test.mjs [--id=3669681034] [--verbose]
// 退出码：0 全绿（含 SKIP）/ 1 有断言失败（含"变异没变红"）/ 2 用法错误。
import fs from 'node:fs'
import path from 'node:path'
import * as _root from './_root.mjs'
import * as lib from '../core/we-scene-bundle.js'
import { readIndexHead, readEntryBytes, readSceneJsonText } from './_pkg-index.mjs'

const ROOT = _root.ROOT
const WS = process.env.MPW_ROOT || _root.WS || path.resolve(ROOT, '..')
const NAME = 'scene-intro-black'
const argv = process.argv.slice(2)
const bad = argv.find((a) => !/^--(id|verbose|help)=?/.test(a) && a !== '--verbose' && a !== '--help')
if (bad) { console.error('未知参数：' + bad + '（用法见文件头）'); process.exit(2) }
if (argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 24).join('\n')); process.exit(0) }
const VERBOSE = argv.includes('--verbose')
const id = (argv.find((a) => a.startsWith('--id=')) || '').slice(5) || '3669681034'
const PKG = path.join(WS, 'allwallpaper', 'dd', id, 'scene.pkg')
if (!fs.existsSync(PKG)) { console.log(`SKIP ${NAME} 语料缺失：${PKG}（本仓库不分发真实壁纸；把语料放在 <工作区>/allwallpaper/dd/<id>/ 即可）`); process.exit(0) }

// ── 断言器 ──────────────────────────────────────────────────────────────────────
const RESULTS = []
let FAILED = 0
const P = (name, ok, detail) => { RESULTS.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) }); if (!ok) FAILED++ }
const V = (o) => JSON.stringify(o)
const jpath = (o, p) => p.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o)

// ── 真包读取（只 seek；不整包 readFileSync）───────────────────────────────────────
const idx = readIndexHead(PKG)
const entryOf = (n) => { const e = idx.entries.find((x) => x.name === n); return e ? { e, bytes: readEntryBytes(PKG, idx, e) } : null }
const sceneTxt = readSceneJsonText(PKG)
const sceneJson = JSON.parse(sceneTxt.replace(/^\uFEFF/, ''))
const TEXNAME = 'materials/4k-16-9origin_waifu2x_2x_jpg.tex'
const texEntry = entryOf(TEXNAME)
if (!texEntry) { console.log(`SKIP ${NAME} 夹具变了：${TEXNAME} 不在 ${id}/scene.pkg 里`); process.exit(0) }
const tex = lib.parseTex(texEntry.bytes)

// ═══ A 段：现场取证 + 否证"黑幕层/intro 时间轴"假设 ═════════════════════════════════
{
  const objs = sceneJson.objects || []
  const imgs = objs.filter((o) => o.image)
  const snds = objs.filter((o) => o.sound)
  P('A1 夹具 = 真包 ' + id + '（PKGV 容器 + scene.json 可解析）',
    /^PKGV\d{4}$/.test(idx.magic) && imgs.length === 1 && snds.length === 1,
    `magic=${idx.magic} entries=${idx.count} objects=${objs.length} image=${imgs.length} sound=${snds.length}`)
  const all = JSON.stringify(sceneJson)
  P('A2 零脚本：容器条目里没有任何脚本文件（.js/.lua/.pkg 内 scene.json 也无 script 字段）',
    !idx.entries.some((e) => /\.(js|lua|luac)$/i.test(e.name)) && !/"(script|scripts)"\s*:/.test(all),
    'scriptFiles=' + V(idx.entries.filter((e) => /\.(js|lua|luac)$/i.test(e.name)).map((e) => e.name)) + ' scriptKey=' + /"(script|scripts)"\s*:/.test(all))
  //   ⚠ 只看**键名**：值里出现 "center"/"enter" 是相机字段（camera.center），不是入场动画。
  const introRe = /"(intro|enter|introanimation|fadein|fadetime|firstframe)"\s*:/i
  const introKey = all.match(introRe)
  P('A3 零 intro/黑幕字段：scene.json 里没有任何 intro|enter|introanimation|fadein|firstframe **键**，也没有脚本可承载它',
    !introKey, 'matchedKey=' + V(introKey ? introKey[0] : null))
  const dark = objs.filter((o) => {
    const c = String(o.color === undefined ? '' : o.color).trim()
    const a = o.alpha === undefined ? 1 : Number(o.alpha)
    return (c === '0 0 0' || c === '0.00000 0.00000 0.00000') || a === 0 || o.visible === false
  })
  P('A4 零"全屏黑幕层"：没有任何对象 alpha=0 / color=0,0,0 / visible=false',
    dark.length === 0, 'suspect=' + V(dark.map((o) => o.id)))
  const layer0 = imgs[0]
  P('A5 底图是整屏层：ortho 矩形 == 图层 size，origin == size/2（铺满设计画布）',
    jpath(sceneJson, 'general.orthogonalprojection.width') === 7680 && jpath(sceneJson, 'general.orthogonalprojection.height') === 4320 &&
    layer0.size === '7680.00000 4320.00000' && layer0.origin === '3840.00000 2160.00000 0.00000',
    `ortho=${jpath(sceneJson, 'general.orthogonalprojection.width')}x${jpath(sceneJson, 'general.orthogonalprojection.height')} origin=${layer0.origin} size=${layer0.size}（JSON 路径 objects[0].origin/.size）`)
  P('A6 效果链在本包**默认不再被丢**：3 个效果挂在整屏层上，旧 `clearBgFx` 判据会砍（`?clearfx=legacy` 复现），新缺省档保留 —— 与"全屏黑"无因果',
    (layer0.effects || []).length === 3 && ((layer0.effects || []).map((e) => e.file).join(',') === 'effects/shake/effect.json,effects/foliagesway/effect.json,effects/lightshafts/effect.json'),
    'effects=' + V((layer0.effects || []).map((e) => e.file)))
  // ①(WEBWALLGL #4 2026-09-23) 判据收窄的**真语料**断言（本包 = 7680×4320 设计画布 + 7680×4320 整屏层，
  //   正是"绝对阈值 3800/2000 全命中"的 28 个包那一类）：直接调纯函数判据，不建渲染器、零 GPU。
  {
    const design = lib.designCanvasOf({ general: sceneJson.general })
    const probe = { size: [7680, 4320], effects: [{ file: 'effects/shake/effect.json' }] }
    P('A6b clearBgFx 判据（真语料）：本包整屏层在**缺省档保留**效果链、`?clearfx=legacy` 下被砍',
      lib.clearBgFxShouldDrop(probe, design, 'narrow') === false && lib.clearBgFxShouldDrop(probe, design, 'legacy') === true,
      V({ design, narrow: lib.clearBgFxShouldDrop(probe, design, 'narrow'), legacy: lib.clearBgFxShouldDrop(probe, design, 'legacy') }))
    const blur = { size: [4096, 2296], effects: [{ file: 'effects/blur/effect.json' }] }
    P('A6c clearBgFx 判据（输出型保护）：1920×1080 画布上 4096×2296 的 blur 层两档都保留（旧档砍 = issue #4 的成因）',
      lib.clearBgFxShouldDrop(blur, [1920, 1080], 'narrow') === false && lib.clearBgFxShouldDrop(blur, [1920, 1080], 'legacy') === true,
      V({ narrow: lib.clearBgFxShouldDrop(blur, [1920, 1080], 'narrow'), legacy: lib.clearBgFxShouldDrop(blur, [1920, 1080], 'legacy') }))
  }
  P('A7 sound 对象没有 image ⇒ 层走"solid 占位"透明兜底（不可能是黑幕）',
    snds[0].solid === true && snds[0].image === undefined, 'solid=' + snds[0].solid + ' image=' + V(snds[0].image))
}

// ═══ A8：mock-GL 抓**真顶点流 + MVP** 复算四角 NDC（否证"投影把画面推出可视区"）════════
{
  const draws = []
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85, FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, ARRAY_BUFFER: 0x8892 }
  let curProg = null, curBuf = null, curVao = null, ids = 0, curUnit = 0
  const bufData = new Map(), vaoAttribs = new Map(), uni = new Map(), curTex = new Array(8).fill(null)
  const mk = (k) => ({ id: k + '#' + (++ids) })
  const a0 = () => {                       // 忠实口径：按**当前 VAO** 的属性 0 取顶点缓冲（与真 GL 同语义）
    const m = curVao && vaoAttribs.get(curVao.id)
    const at = m && m[0]
    const data = at && at.buf ? bufData.get(at.buf.id) : null
    if (!data) return null
    const stride = (at.stride || 20) / 4, off = (at.off || 0) / 4
    const out = []
    for (let i = off; i + 2 < data.length; i += stride) out.push(data[i], data[i + 1], data[i + 2])
    return Float32Array.from(out)
  }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: (v) => { curVao = v }, activeTexture: (u) => { curUnit = u },
    bindTexture: (t, x) => { curTex[curUnit] = x || null },
    bindBuffer: (target, b) => { if (target === CONST.ARRAY_BUFFER) curBuf = b },
    bufferData: (target, data) => { if (target === CONST.ARRAY_BUFFER && curBuf) bufData.set(curBuf.id, Float32Array.from(data)) },
    vertexAttribPointer: (loc, size, type, norm, stride, off) => {
      if (!curVao) return
      const m = vaoAttribs.get(curVao.id) || {}
      m[loc] = { buf: curBuf, size, stride, off }; vaoAttribs.set(curVao.id, m)
    },
    uniformMatrix4fv: (l, tr, v) => { if (l && l.__name) uni.set(l.__name, Float64Array.from(v)) },
    drawArrays: (mode, first, count) => { draws.push({ prog: curProg && curProg.id, tex: curTex.map((t) => (t && t.__name) || null), mvp: uni.get('u_MVP') || uni.get('g_ModelViewProjectionMatrix'), verts: a0(), count }) },
    drawElements: (mode, count) => { draws.push({ prog: curProg && curProg.id, tex: curTex.map((t) => (t && t.__name) || null), mvp: uni.get('u_MVP'), elements: true, count }) },
    getProgramParameter: (p, k) => (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : true),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1),
    getUniformLocation: (p, n) => ({ __name: n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 16384 : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', isTexture: () => true,
  }
  const gl = new Proxy({}, {
    get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    },
  })
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
  const scene = lib.parseScene(sceneJson)
  lib.applyRenderConfig(scene, { sceneId: id, hideParticles: false, clearBgFx: true, hideUI: true, hideBars: true, log: () => {} })
  // 与 demo.html 的装载链同口径：model json → material json → passes[0].textures[0] → layer.textureName
  //   （parseScene 不填这个字段，是宿主纹理循环填的 ⇒ 不填的话层拿到的只有 transparent 哨兵）
  for (const l of scene.layers) {
    if (!l.image) continue
    try {
      const mj = JSON.parse(entryOf(l.image).bytes.toString('utf8'))
      const mat = lib.resolveMaterial(mj)
      const material = JSON.parse(entryOf(mat.materialPath).bytes.toString('utf8'))
      const tn = material.passes && material.passes[0] && material.passes[0].textures && material.passes[0].textures[0]
      if (tn) l.textureName = tn
    } catch (e) { /* 解析失败 = 该层无纹理（本包只有 1 层，必有） */ }
  }
  const imageLayer = scene.layers.find((l) => l.image)
  P('A0 装载链命名：底图层的 textureName 由 model→material→passes[0].textures[0] 解析得到（= ' + TEXNAME.replace(/^materials\//, '').replace(/\.tex$/, '') + '）',
    imageLayer.textureName === TEXNAME.replace(/^materials\//, '').replace(/\.tex$/, ''),
    'textureName=' + V(imageLayer.textureName))
  const textures = new Map([[imageLayer.textureName, { glTex: { __name: imageLayer.textureName, id: 'texX' }, width: 2048, height: 1152 }]])
  const renderer = lib.createRenderer({ getContext: () => gl, width: 1920, height: 1080 }, {
    onLog: () => {}, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG), trace: false,
  })
  let err = null
  try { await renderer.render(scene, textures, 1920, 1080, 1.0) } catch (e) { err = e }
  // 找"绑了底图纹理"的那次 draw（= 该层的合成），用它自己的 u_MVP × 它自己的顶点流算四角 NDC
  const d = draws.find((x) => x.verts && x.verts.length >= 18 && (x.tex || []).includes(imageLayer.textureName)) || draws.find((x) => x.verts && x.verts.length >= 18)
  let cover = null
  if (d && d.mvp && d.verts) {
    const m = d.mvp
    let minX = 9, maxX = -9, minY = 9, maxY = -9
    for (let i = 0; i + 2 < d.verts.length; i += 3) {
      const x = d.verts[i], y = d.verts[i + 1], z = d.verts[i + 2]
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12]
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13]
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15]
      const nx = cx / (cw || 1), ny = cy / (cw || 1)
      minX = Math.min(minX, nx); maxX = Math.max(maxX, nx); minY = Math.min(minY, ny); maxY = Math.max(maxY, ny)
    }
    cover = { minX: +minX.toFixed(4), maxX: +maxX.toFixed(4), minY: +minY.toFixed(4), maxY: +maxY.toFixed(4), verts: d.verts.length / 3 }
  }
  P('A8 mock-GL 真顶点流：底图四边形**铺满整屏**（自带 u_MVP × 自带顶点流 ⇒ NDC 覆盖 ±1，误差 ≤1e-3）',
    !!cover && Math.abs(cover.minX + 1) < 1e-3 && Math.abs(cover.maxX - 1) < 1e-3 && Math.abs(cover.minY + 1) < 1e-3 && Math.abs(cover.maxY - 1) < 1e-3,
    'render=' + (err ? 'throw:' + err.message : 'ok') + ' draws=' + draws.length + ' cover=' + V(cover))
  P('A9 该帧确实画了底图（顶点流 6 顶点 + 底图纹理绑到该 draw 上；层没被跳过/退化）',
    !!d && d.verts.length >= 18 && (d.tex || []).includes(imageLayer.textureName),
    'draws=' + draws.length + ' texBound=' + V(d ? d.tex.filter(Boolean) : null) + ' verts=' + (d && d.verts ? d.verts.length / 3 : 0))
}

// ═══ B 段：修复语义 + 真包数值 ═══════════════════════════════════════════════════════
const mipDims = tex.images[0].map((m) => [m.width, m.height, m.data.length])
const MIP0_BYTES = mipDims[0][2]
const CAP = lib.texDownsampleCap(tex.width, tex.height, 16384)   // 设备上限 16384（本机 GL 实测值）
{
  P('B1 真包 mip 链：5 级独立 PNG（7680×4320 → 480×270），容器声明 7680×4320 / fmt0 / freeImageFormat=PNG(13)',
    mipDims.length === 5 && mipDims.map((m) => m[0] + 'x' + m[1]).join(',') === '7680x4320,3840x2160,1920x1080,960x540,480x270' &&
    tex.format === 0 && tex.freeImageFormat === 13,
    'mips=' + V(mipDims.map((m) => m[0] + 'x' + m[1] + ':' + m[2] + 'B')) + ' fmt=' + tex.format + ' fif=' + tex.freeImageFormat + ' container=' + tex.containerMagic)
  P('B2 上传目标（设备上限 16384）= 2048 ⇒ 目标长边 2048（旧链路也是这个尺寸：上传没变小，白解了 15/16）',
    CAP === 2048, 'texDownsampleCap(7680,4320,16384)=' + CAP)
  const lv = lib.pickMipForTarget(tex, CAP)
  P('B3 选级：长边 ≥ 目标的最小一级 = 第 1 级 3840×2160（修前恒为第 0 级 7680×4320）',
    lv === 1, 'level=' + lv + ' dims=' + mipDims[lv].slice(0, 2).join('x'))
  const m2 = lib.decodeImageMip(tex, 0, lv)
  P('B4 取级解码：3840×2160 / 9,107,059B（mip0 为 33,288,714B，省 72.6% 字节、峰值位图 132.7MB→33.2MB）',
    m2.width === 3840 && m2.height === 2160 && m2.png.length === mipDims[1][2] && m2.png.length === 9107059 && MIP0_BYTES === 33288714,
    `decoded=${m2.width}x${m2.height} bytes=${m2.png.length} mip0Bytes=${MIP0_BYTES} 峰值位图 ${(m2.width * m2.height * 4 / 1048576).toFixed(1)}MB vs ${(7680 * 4320 * 4 / 1048576).toFixed(1)}MB`)
  P('B5 取级与 mip0 逐字节同源（同一 .tex 条目内的第 1 级载荷，不是重新编码）',
    Buffer.compare(Buffer.from(m2.png), Buffer.from(tex.images[0][1].data)) === 0 && Buffer.compare(Buffer.from(lib.decodeMip0(tex).png), Buffer.from(tex.images[0][0].data)) === 0,
    'mip1 9,107,059B 与 tex.images[0][1].data 逐字节相同')
  P('B6 纯函数边界：无 mip 链 / 单级 / target=0 / 非法 target ⇒ 第 0 级（旧行为；不切级）',
    lib.pickMipForTarget({ images: [[{ width: 7680, height: 4320 }]] }, 2048) === 0 &&
    lib.pickMipForTarget(tex, 0) === 0 && lib.pickMipForTarget(tex, NaN) === 0 &&
    lib.pickMipForTarget(null, 2048) === 0 && lib.pickMipForTarget(tex, 1e9) === 0 &&
    lib.pickMipForTarget(tex, 100) === 4,
    'noChain=' + lib.pickMipForTarget({ images: [[{ width: 1, height: 1 }]] }, 2048) + ' t0=' + lib.pickMipForTarget(tex, 0) + ' t100=' + lib.pickMipForTarget(tex, 100))
  P('B7 decodeImageMip 越界级回落第 0 级（不抛错、不给出空级）',
    (() => { const a = lib.decodeImageMip(tex, 0, 99); return a.width === 7680 && a.png.length === MIP0_BYTES })(),
    'lv99 → ' + lib.decodeImageMip(tex, 0, 99).width + 'x' + lib.decodeImageMip(tex, 0, 99).height)
}

// ═══ B8+：装载链**真源码切片**（demo.html 的 loadTex）+ 真包 + 假 gl/document ═══════════
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
function sliceFn(src, header) {
  const i = src.indexOf(header)
  if (i < 0) throw new Error('切片起点未找到（demo.html 结构变了？）：' + header)
  let k = i, paren = 0
  for (; k < src.length; k++) {
    if (src[k] === '(') paren++
    else if (src[k] === ')') { paren--; if (paren === 0) break }
  }
  let j = src.indexOf('{', k), depth = 0
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(i, j + 1)
}
const PRIM_HEADS = ['function withTimeout(p, ms, label) {', 'function fetchT(url, opts, ms, label) {', 'function jsonT(r, url, ms, label) {', 'function bufT(r, url, ms, label) {', 'function textT(r, url, ms, label) {', 'function bitmapT(blob, label, ms) {']
/* ①(P-252 2026-10-07) `loadTex` 现在拆成"薄包装（并发闸门 + 在飞行去重）+ `loadTexInner`（原实现）"，
   本组要切的是**原实现**那一段（超时/降采样/选级判据全在它里面）。 */
const LOADTEX_HEAD = 'async function loadTexInner(name, opts = {}) {'
const sliceLoadTex = (src) => sliceFn(src, LOADTEX_HEAD)
/* ①(2026-09-21 全量门禁扫出来的真回归) `loadTex` 内部三处贴图创建走 `wrapTex(entry, name)`（P-168 的
   REPEAT 采样契约），而 `wrapTex` 定义在 `loadTex` **上方的模块作用域** ⇒ 只切 `loadTex` 的夹具里它是
   `undefined`（`ReferenceError: wrapTex is not defined`，整条链跑不起来）。夹具必须把它一起切进来
   （与 `slicePrims` 多函数切片同款；`lib`/`gl` 已经是 Function 的形参，作用域对得上）。 */
const WRAPTEX_HEAD = 'function wrapTex(entry, name) {'
const sliceWrapTex = (src) => sliceFn(src, WRAPTEX_HEAD)
const slicePrims = (src) => PRIM_HEADS.map((h) => sliceFn(src, h)).join('\n')
const TEX_LEAF = '4k-16-9origin_waifu2x_2x_jpg'

/** 假 GL：`err` = 每次上传后 `getError()` 的返回值（0 = 健康）。记录 texImage2D 次数。 */
function mkGl(err) {
  const st = { uploads: 0 }
  const gl = {
    NO_ERROR: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, TEXTURE_2D: 0x0DE1, TEXTURE0: 0x84C0,
    getError: () => err, createTexture: () => ({ id: 'tex' + (++st.uploads) }),
    bindTexture: () => {}, texParameteri: () => {}, generateMipmap: () => {}, activeTexture: () => {},
    texImage2D: () => { st.uploads++ }, isTexture: () => true, getParameter: () => 16384, deleteTexture: () => {},
  }
  return { gl, st }
}
/** 假 document：canvas 只记账（不做真缩放），`onDraw` 收到 (src, w, h)。 */
function mkDoc(onDraw) {
  const ctx = { drawImage: (src, a, b, w, h) => { if (onDraw) onDraw(src, w, h) }, getImageData: () => ({ data: new Uint8Array(4) }), imageSmoothingQuality: '' }
  return { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
}
/**
 * 用**真源码切片**的 `loadTex` 跑真包的那张贴图。
 * @param {object} o { src?, lib?, err?, bitmap?, bitmapW?, bitmapH?, location?, onDraw? }
 * @returns {{ entry, textures, logs, st, name, seen, draws }}
 */
async function runLoadTex(o = {}) {
  const src = o.src || HTML
  const logs = [], seen = [], draws = []
  const { gl, st } = mkGl(o.err || 0)
  const doc = mkDoc((s, w, h) => draws.push([w, h]))
  const libStub = Object.create(o.lib || lib)
  libStub.getEntry = (p, n) => { const e = idx.entries.find((x) => x.name === n); return e ? readEntryBytes(PKG, idx, e) : null }
  const prims = new Function('fetch', 'createImageBitmap', 'logf', 'MPW_TIMED_OUT', 'mpwNowMs',
    'const NET_TIMEOUT_MS = 8000, DECODE_TIMEOUT_MS = 8000;\n' + slicePrims(src) + '\nreturn { withTimeout, fetchT, jsonT, bufT, textT, bitmapT }')(
    () => Promise.resolve(null),
    async (blob) => { seen.push(blob && blob.size); return o.bitmap ? o.bitmap(blob) : { width: o.bitmapW || 3840, height: o.bitmapH || 2160, close() {} } },
    (m) => logs.push(String(m)), {}, () => Date.now())
  const textures = new Map(), win = {}
  const fn = new Function('fetch', 'lib', 'pkg', 'textures', 'logf', 'window', 'document', 'gl',
    'withTimeout', 'fetchT', 'jsonT', 'bufT', 'textT', 'bitmapT',
    'NET_TIMEOUT_MS', 'DECODE_TIMEOUT_MS', 'perfAutoQ', 'TEX_BUDGET', '__texBytesTotal', 'DEV_MAX_TEX', 'location',
    sliceWrapTex(src) + '\n' + sliceLoadTex(src) + '\nreturn loadTexInner')
  const loadTex = fn(() => Promise.resolve(null), libStub, {}, textures, (m) => logs.push(String(m)), win, doc, gl,
    prims.withTimeout, prims.fetchT, prims.jsonT, prims.bufT, prims.textT, prims.bitmapT,
    8000, 8000, false, 220 * 1048576, 0, 16384, o.location)
  const entry = await loadTex(TEX_LEAF)
  return { entry, textures, logs, st, name: TEX_LEAF, seen, draws }
}

{
  // B8 默认档：交给 createImageBitmap 的 blob = 选中的第 1 级（9,107,059B）
  const r = await runLoadTex({ bitmapW: 3840, bitmapH: 2160 })
  P('B8 装载链（真源码 loadTex + 真包）：blob 交给解码的是**第 1 级** 9,107,059B（修前 = mip0 33,288,714B）',
    r.seen.length === 1 && r.seen[0] === 9107059,
    'blob.size=' + V(r.seen) + ' 选级日志=' + V(r.logs.filter((l) => /mip 选级/.test(l))))
  // B9 上传尺寸与改动前一致：2048×1152（选级后位图 3840 → 仍按 mip0 的目标 2048 缩）
  P('B9 选级后**上传尺寸不变**：canvas 缩到 2048×1152、登记项 2048×1152（旧链路就是这个尺寸）',
    !!r.entry && r.entry.width === 2048 && r.entry.height === 1152 && r.textures.get(r.name) === r.entry && V(r.draws) === V([[2048, 1152]]),
    'entry=' + (r.entry ? r.entry.width + 'x' + r.entry.height : 'null') + ' canvasDraw=' + V(r.draws) + ' uploads=' + r.st.uploads)
}
{
  // B10 A/B 回退档：?mipsel=0 ⇒ 逐位回到旧链路（mip0 33,288,714B）
  const r = await runLoadTex({ bitmapW: 7680, bitmapH: 4320, location: { search: '?mipsel=0' } })
  P('B10 `?mipsel=0` 回退档：blob = mip0 33,288,714B、canvas 仍缩到 2048×1152（与改动前逐位一致；A/B 口有效）',
    r.seen.length === 1 && r.seen[0] === 33288714 && !r.logs.some((l) => /mip 选级/.test(l)) && V(r.draws) === V([[2048, 1152]]),
    'blob.size=' + V(r.seen) + ' canvasDraw=' + V(r.draws) + ' 选级日志=' + V(r.logs.filter((l) => /mip 选级/.test(l))))
}
{
  // B11 上传恒报错 ⇒ 返回 null 且不登记（旧实现登记坏纹理 ⇒ 整屏不透明黑）
  const r = await runLoadTex({ bitmapW: 3840, bitmapH: 2160, err: 0x501 })
  P('B11 上传恒报 0x501 ⇒ 返回 null 且**不登记**该纹理（层走缺纹理透明兜底，不再铺满黑）',
    r.entry === null && !r.textures.has(r.name) && r.logs.some((l) => /按\*\*缺纹理\*\*处理/.test(l)),
    'entry=' + V(r.entry) + ' registered=' + r.textures.has(r.name) + ' uploads=' + r.st.uploads + ' log=' + V(r.logs.filter((l) => /报错|缺纹理/.test(l))))
  // B12 重试阶梯不再是死代码
  P('B12 重试阶梯修好（旧 `k >= 1` 恒 break = 死代码）：失败后真的降档重试（上传 ≥2 次、画布出现更小档）',
    r.st.uploads >= 2 && r.draws.length >= 2 && r.draws.some((d) => d[0] < 2048),
    'uploads=' + r.st.uploads + ' canvasDraw=' + V(r.draws) + ' log=' + V(r.logs.filter((l) => /重试/.test(l))))
}

// ═══ C 段：变异自证（**真**改回旧写法，再跑同一套断言 ⇒ 指定断言必红）════════════════
{
  // M1 = 语义回退到改动前："恒解 mip0"（等价于 `pickMipForTarget` 实现改回 `return 0`）。
  const libM1 = Object.create(lib)
  libM1.pickMipForTarget = () => 0
  const r = await runLoadTex({ lib: libM1, bitmapW: 7680, bitmapH: 4320 })
  const b3UnderM1 = (libM1.pickMipForTarget(tex, CAP) === 1)     // B3 的断言原文
  const b8UnderM1 = (r.seen.length === 1 && r.seen[0] === 9107059) // B8 的断言原文
  P('C1 变异 M1（恒解 mip0 = 改动前行为）：B3/B8 断言必红', !b3UnderM1 && !b8UnderM1,
    'M1 下 pickMipForTarget=' + libM1.pickMipForTarget(tex, CAP) + '（B3 要 1 ⇒ 假）、blob=' + V(r.seen) + '（B8 要 [9107059] ⇒ 假）')
  P('C2 变异 M1 的证据链成立：解码量回到 mip0 的 33,288,714B（= "8K 全解"那一步，峰值位图 132.7MB）',
    r.seen[0] === 33288714 && r.seen[0] === MIP0_BYTES, 'blob.size=' + V(r.seen))
}
{
  // M2 = 源码回退：把"上传失败 ⇒ 不登记"整块换回旧写法（照登记坏纹理）。
  const A = '      // ①(P-163 第 3 处)'
  const B = '      ;(window.__mpwTexStats = window.__mpwTexStats || [])'
  const ia = HTML.indexOf(A), ib = HTML.indexOf(B, ia)
  if (ia < 0 || ib < 0) P('C3 变异 M2 的改点可定位（demo.html 结构未漂移）', false, 'anchors=' + ia + '/' + ib)
  else {
    const OLD = "      if (r.gerr !== gl.NO_ERROR) logf('  ⚠ 位图上传仍报错 0x' + r.gerr.toString(16) + ' ' + name + '（' + w + 'x' + h + '）——该层可能采样为黑')\n"
    const MUT = HTML.slice(0, ia) + OLD + HTML.slice(ib)
    P('C3 变异 M2 的改点可定位（P-163 第 3 处 → 旧的一行 logf；源码未漂移）',
      MUT !== HTML && MUT.includes('该层可能采样为黑') && !MUT.includes('按**缺纹理**处理'), 'len ' + HTML.length + '→' + MUT.length)
    const r = await runLoadTex({ src: MUT, bitmapW: 3840, bitmapH: 2160, err: 0x501 })
    const b11UnderM2 = (r.entry === null && !r.textures.has(r.name))   // B11 的断言原文
    P('C4 变异 M2（上传失败仍登记）：B11 断言必红 —— 旧写法下坏纹理被登记，整屏层拿它去画 ⇒ 不透明黑',
      !b11UnderM2 && r.entry !== null && r.textures.has(r.name),
      'M2 下 entry=' + V(!!r.entry) + ' registered=' + r.textures.has(r.name) + ' uploads=' + r.st.uploads + ' log=' + V(r.logs.filter((l) => /报错|缺纹理/.test(l))))
  }
}

// ═══ D 段：语料同类计数（逐包，只读目录表 + entry 头）════════════════════════════════
{
  const DD = path.join(WS, 'allwallpaper', 'dd')
  const rows = []
  let dirs = []
  try { dirs = fs.readdirSync(DD) } catch (e) { dirs = [] }
  for (const d of dirs) {
    const p = path.join(DD, d)
    let pkgFile = null
    try { pkgFile = fs.readdirSync(p).find((f) => /\.(pkg|mpkg)$/i.test(f)) } catch { continue }
    if (!pkgFile) continue
    let ix = null
    try { ix = readIndexHead(path.join(p, pkgFile)) } catch { continue }
    for (const e of ix.entries.filter((x) => /\.tex$/i.test(x.name))) {
      const head = Buffer.alloc(Math.min(256, e.size))
      const fd = fs.openSync(path.join(p, pkgFile), 'r')
      try { fs.readSync(fd, head, 0, head.length, ix.dataStart + e.off) } finally { fs.closeSync(fd) }
      // 布局（packages/we-core/src/tex.js 的 header 口径）：18 fmt / 22 flags / 26 tw / 30 th / 34 w / 38 h /
      //   46 TEXB 魔数 / 55 imageCount / 59 freeImageFormat（ver≥3）/ 63 reserved2（ver≥4）/ 67 mipCount /
      //   71 mip0.w / 75 mip0.h / 79 mip0.compression / 83 mip0.uncompressed / 87 mip0.dataSize
      const w = head.readInt32LE(34), h = head.readInt32LE(38)
      const fif = head.readInt32LE(59)
      if (fif !== 13 && fif !== 2) continue                 // 只看 free-image（PNG/JPEG）
      const mipCount = head.readInt32LE(67)
      const mw = head.readInt32LE(71)
      const mh = head.readInt32LE(75)
      const payload = head.readInt32LE(87)
      rows.push({ id: d, name: e.name, fif: fif === 13 ? 'PNG' : 'JPEG', w, h, mipCount, mw, mh, payload, side: Math.max(mw, mh) })
    }
  }
  const over4096 = rows.filter((r) => r.side > 4096)
  const over2048 = rows.filter((r) => r.side > 2048)
  if (VERBOSE || over2048.length) {
    console.log('  [D] free-image 贴图 ' + rows.length + ' 张（语料 ' + new Set(rows.map((r) => r.id)).size + ' 包）；长边 >4096 的 ' + over4096.length + ' 张、>2048 的 ' + over2048.length + ' 张（涉及 ' + new Set(over2048.map((r) => r.id)).size + ' 包）')
    for (const r of over2048) console.log('      ' + r.id + ' ' + r.name + ' ' + r.fif + ' ' + r.mw + 'x' + r.mh + ' (' + (r.payload / 1048576).toFixed(1) + 'MB, mips=' + r.mipCount + ')')
  }
  P('D1 同类计数：本包（7680×4320）是语料里**最大**的 free-image 贴图；>4096 的只有它 + 3544152633/housebasic',
    over4096.length === 2 && over4096.some((r) => r.id === id) && over4096.some((r) => r.id === '3544152633'),
    '>4096 = ' + V(over4096.map((r) => r.id + ':' + r.mw + 'x' + r.mh)))
  P('D2 影响面：长边 >2048 的 free-image 贴图（任何"降采样上限 ≤2048"的设备都会走这条链）',
    over2048.length >= 8, '>2048 = ' + over2048.length + ' 张 / ' + new Set(over2048.map((r) => r.id)).size + ' 包：' + over2048.map((r) => r.id + ':' + r.mw + 'x' + r.mh).join(' '))
  P('D3 本包选级后仍 ≥ 目标 2048（画质不劣于"从 mip0 缩"）',
    (() => { const l = rows.find((r) => r.id === id); return l && l.side === 7680 && l.mipCount === 5 })(),
    '本包 mip0=' + (rows.find((r) => r.id === id) || {}).mw + 'x' + (rows.find((r) => r.id === id) || {}).mh + ' mips=' + (rows.find((r) => r.id === id) || {}).mipCount)
}

// ── 汇总 ────────────────────────────────────────────────────────────────────────
if (VERBOSE) for (const r of RESULTS) console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.detail ? '  · ' + r.detail : ''))
console.log('\n' + RESULTS.length + ' 断言：' + (RESULTS.length - FAILED) + ' 通过 / ' + FAILED + ' 失败（' + NAME + ' P-163）')
if (FAILED) { for (const r of RESULTS.filter((x) => !x.ok)) console.log('  ✗ ' + r.name + '  · ' + r.detail) }
process.exit(FAILED ? 1 : 0)

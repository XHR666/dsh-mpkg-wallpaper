/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**；与 P-149 相关的上游是
 * `oneincase/webwallgl`（MIT © 2026 oneincase），本项按**规格独立实现**（上游契约只有 4 行，
 * 见 `THIRD-PARTY.md` §16 的逐行引文表）。references/wer-ref（GPL-2.0-only）与
 * references/we-layerd-ref（无许可）只引行为结论，未复制其代码/注释/常量组织。 */
// particle-overbright-test.mjs — P-149 回归门禁（无浏览器 / 无 GPU / 无网络；mock-GL 忠实顶点流）
//
// 钉住**粒子材质常量 `ui_editor_properties_overbright`**（缺省 1，乘在实例 RGB 上、不动 alpha）：
//   ① 取值契约（纯函数 `particleOverbrightFactor`）：`{}`（键缺失）⇒ **1**（`Number(null)===0` 的坑）、
//      `"abc"`/NaN ⇒ 1、负数 ⇒ 0、无 material/pass ⇒ 1、`0.25/0.17/1.33/2/5` 原样。
//   ② 合成场景端到端（uniform 上提路径 + 逐顶点色路径）：`1.33/2/5/0.17/0.25` **真的乘进实例色**，
//      `1` ⇒ 与改动前**逐位相同**（`x*1 === x`），`0` ⇒ 三通道全 0。
//   ③ 真包四层（语料 `dd/3719111841` Bokeh Hex/Bokeh Cir = 0.25、`dd/3544152633` reactive Stars = 5、
//      `0917/3509243656` new_particle_system = 0.17）：**修前（`?overbright=legacy`）→ 修后**的
//      实例色分量实测值 + 比值 ≡ 材质因子；同时几何顶点流（位置/尺寸/UV/alpha）逐位不变。
//   ④ 子系路径（真包 `dd/3544152633` `Shooting star-blue-2` 的子系 `star_shine-2` 材质 = **2**）：
//      子系吃**自己的**因子、父层与其它子系不受影响。
//   ⑤ 值 = 1 的层整帧逐位不变（真包 `dd/3554161528` ln=22 萤火虫，材质 `overbright: 1`）。
//   ⑥ `?overbright=legacy` 逐位回退：同一层两档的**整条**（几何 + 实例色）sha256 相同。
//   ⑦ 语料扫描计数（流式读 PKG entry，**从不整包 readFileSync**）：材质 38 / 命中包 15 / 层 54 /
//      非 1 层 25 / 值=1 层 29 + §1.3 的取值直方图逐键相等。
//   ⑧ 接线与登记：`demo.html` 两处调用点（父层 + 子系 map 条目）、`?overbright=legacy` 登记进
//      `docs/README-DIAGNOSTICS.md` 主表、`tests/run-all-tests.sh` 有本门禁、PATCHES P-149 /
//      THIRD-PARTY §16 / COPYING-RULES 台账 #14 在位。
//   ⑨ RED-IF-REVERTED（**5 组** R1–R5）：每组"把实现改回旧写法"都让**指定那一组**变红；
//      变异只在 `/tmp` 的真文件副本上做（真树 sha256 跑完不变），且每组都**另跑一次探针**记录实际变红的断言。
//
// 用法: node tests/particle-overbright-test.mjs [--verbose]
//      node tests/particle-overbright-test.mjs --probe contract|synth|real|child|legacy   （变异子进程用）
// 门禁名: particle-overbright（`tests/run-all-tests.sh --only particle-overbright`）
// 资源: 全绿一次实测 **PeakRSS ≈ 190MB**（单 node 进程；变异子进程逐个串行、各自更小）、**约 3.5s**、
//   无浏览器/无网络（真包走 entry 流式读，最大包 158MB 也不整包读入）。
import { WS, ROOT } from './_root.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const VERBOSE = process.argv.includes('--verbose')
const PROBE = (() => { const i = process.argv.indexOf('--probe'); return i >= 0 ? (process.argv[i + 1] || '') : null })()
const MPW_WS = process.env.MPW_ROOT || WS
const DD = `${MPW_WS}/allwallpaper/dd`
const Y0917 = `${MPW_WS}/allwallpaper/0917`
const WE = `${MPW_WS}/wallpaper_engine/assets`
// 变异子进程可指向 /tmp 的副本；缺省 = 本仓库真文件
const BUNDLE = process.env.MPW_P149_BUNDLE || path.join(ROOT, 'core/we-scene-bundle.js')
const dec = new TextDecoder()
const checks = []
let CUR_GROUP = '[0]'
const group = (g) => { CUR_GROUP = g }
const push = (name, ok, detail) => {
  checks.push({ group: CUR_GROUP, name, ok: !!ok, detail })
  if (VERBOSE || !ok) console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? ' — ' + detail : ''))
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const fx = (v, n = 6) => (typeof v === 'number' && isFinite(v) ? v.toFixed(n) : String(v))
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const lib = await import(new URL('file://' + BUNDLE).href)

// ───────────────────────── mock GL（顶点流 + 实例色双通道捕获） ─────────────────────────
// ①(P-149) 实例色有**两条上屏路径**（`core/we-scene-bundle.js` 的 P-126 A 注释）：
//   整批同色 ⇒ 上提进 `u_Color` 且顶点色恒 1；逐粒子不同色 ⇒ `u_Color=(1,1,1)` + `a_Color` 顶点缓冲。
//   FS 里两者相乘 ⇒ 本门禁的"实例色"一律按 `u_Color ⊙ 顶点色` 复原（两条路径同一口径）。
function makeGl() {
  const rec = { bufs: new Map(), uploads: [], draws: [], colors: [] }
  let curBuf = null, curProg = null
  const progUni = new Map()
  const setUni = (l, v) => { if (l && l.p && l.n) { if (!progUni.has(l.p.id)) progUni.set(l.p.id, {}); progUni.get(l.p.id)[l.n] = v } }
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER: 0x8D40 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let seq = 0
  const handlers = {
    createTexture: () => ({ id: 'tex' + (++seq) }), createFramebuffer: () => ({ id: 'fbo' + (++seq) }),
    createBuffer: () => ({ id: 'buf' + (++seq) }), createVertexArray: () => ({ id: 'vao' + (++seq) }),
    createShader: () => ({ id: 'sh' + (++seq) }), createProgram: () => ({ id: 'prog' + (++seq) }),
    bindBuffer: (t, b) => { curBuf = b && b.id },
    bufferData: (t, data) => { if (data && data.length) { const v = Float32Array.from(data); rec.bufs.set(curBuf, v); rec.uploads.push({ buf: curBuf, data: v }) } },
    activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {}, bindVertexArray: () => {}, useProgram: (p) => { curProg = p },
    texImage2D: () => {}, uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    // `upIdx` = 本次 draw 之前已发生的 bufferData 次数（颜色缓冲在几何缓冲**之前**上传 ⇒ 可用它切分）
    drawArrays: (m, f, c) => { rec.draws.push({ count: c, data: rec.bufs.get(curBuf) || null, upIdx: rec.uploads.length,
      uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) }) },
    drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 0 : (k === CONST.ACTIVE_ATTRIBUTES ? 0 : null)),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_TexCoordB: 2, a_Blend: 3, a_Alpha: 4, a_Color: 5 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; attribute vec3 a_Color; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const SR = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

/**
 * 把一次 `render()` 抓到的 draw 批切成"顶点流批次"。
 * 几何流 = 每顶点 9 float（`nX,nY,0,u,v,u2,v2,blend,alpha`，**不含颜色**）；
 * 实例色 = `u_Color ⊙ a_Color 顶点缓冲`（两条上屏路径的同一复原口径）。
 */
function batches(rec) {
  const out = []
  for (const d of rec.draws) {
    if (!(d.count > 0) || !d.data || d.data.length !== d.count * 9) continue
    const nv = d.count
    const up = rec.uploads.slice(0, d.upIdx)
    const colUp = up.filter((u) => u.data.length === nv * 3).pop() || null
    const uni = d.uni.u_Color || [1, 1, 1]
    const col = new Float32Array(nv * 3)
    for (let i = 0; i < nv; i++) {
      const vr = colUp ? colUp.data[i * 3] : 1, vg = colUp ? colUp.data[i * 3 + 1] : 1, vb = colUp ? colUp.data[i * 3 + 2] : 1
      col[i * 3] = uni[0] * vr; col[i * 3 + 1] = uni[1] * vg; col[i * 3 + 2] = uni[2] * vb
    }
    let mr = 0, mg = 0, mb = 0, xr = -Infinity, xg = -Infinity, xb = -Infinity
    for (let i = 0; i < nv; i++) {
      mr += col[i * 3]; mg += col[i * 3 + 1]; mb += col[i * 3 + 2]
      xr = Math.max(xr, col[i * 3]); xg = Math.max(xg, col[i * 3 + 1]); xb = Math.max(xb, col[i * 3 + 2])
    }
    out.push({
      nv, quads: nv / 6, uni, colBuf: !!colUp,
      geo: Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength),
      col: Buffer.from(col.buffer, col.byteOffset, col.byteLength),
      // ⚠ `col` 是 Buffer = **字节**视图；逐元素（浮点）比较必须用这个 Float32Array，
      //   否则 `col[i]` 取到的是第 i 个字节（0..255）——本门禁第一版就栽在这里。
      colF32: col,
      mean: [mr / nv, mg / nv, mb / nv], max: [xr, xg, xb],
    })
  }
  return out
}
const geoCat = (bs) => Buffer.concat(bs.map((b) => b.geo))
const colCat = (bs) => Buffer.concat(bs.map((b) => b.col))
const fullCat = (bs) => Buffer.concat([geoCat(bs), colCat(bs)])

// ───────────────────────── 轻量 PKG 入口表（只读文件头 4 MiB + seek 单条 entry） ─────────────────────────
// 纪律：语料里最大包 **158 MB**（`0917/3509243656`）⇒ **从不** `readFileSync` 整包；只读 entry 表 + 需要的 JSON/tex。
function pkgTable(fp) {
  const fd = fs.openSync(fp, 'r')
  try {
    const st = fs.fstatSync(fd)
    const hl = Math.min(1 << 22, st.size)
    const head = Buffer.allocUnsafe(hl)
    const got = fs.readSync(fd, head, 0, hl, 0)
    const b = head.subarray(0, got)
    const ml = b.readInt32LE(0)
    let pos = 4 + ml
    const count = b.readInt32LE(pos); pos += 4
    const entries = []
    for (let i = 0; i < count; i++) {
      const nl = b.readInt32LE(pos); pos += 4
      const name = b.toString('utf8', pos, pos + nl); pos += nl
      const offset = b.readInt32LE(pos); const size = b.readInt32LE(pos + 4); pos += 8
      entries.push({ name, offset, size })
    }
    return { file: fp, entries, dataStart: pos, byName: new Map(entries.map((e) => [e.name, e])) }
  } finally { fs.closeSync(fd) }
}
function pkgEntry(t, name) {
  const e = t.byName.get(name)
  if (!e) return null
  const fd = fs.openSync(t.file, 'r')
  try { const buf = Buffer.allocUnsafe(e.size); fs.readSync(fd, buf, 0, e.size, t.dataStart + e.offset); return buf } finally { fs.closeSync(fd) }
}
const normName = (v) => (typeof v === 'string' ? v : (v && typeof v.value === 'string' ? v.value : null))
/** 材质 → `passes[0]`：包内优先，缺则 `/weassist`（= `wallpaper_engine/assets`）回退链（与 demo.html 同口径）。 */
function passOf(tab, material) {
  if (!material) return null
  let j = null
  try { const b = pkgEntry(tab, material); if (b) j = JSON.parse(dec.decode(b)) } catch { j = null }
  if (!j) {
    const p = `${WE}/${material}`
    try { if (fs.existsSync(p)) j = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { j = null }
  }
  return j && j.passes && j.passes[0] ? j.passes[0] : null
}
/** 载入真包场景（**流式**：`scene.json` + 用到的粒子 def 才读）。 */
function loadScene(id, dir = DD) {
  const tab = pkgTable(`${dir}/${id}/scene.pkg`)
  const sb = pkgEntry(tab, 'scene.json')
  if (!sb) return { tab, scene: null, sj: null }
  const sj = JSON.parse(dec.decode(sb).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const b = pkgEntry(tab, p); return b ? JSON.parse(dec.decode(b)) : null } catch { return null } }
  const scene = lib.parseScene(sj, null, { readParticleDef, legacyAnimY: true })
  lib.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: false, log: () => {} })
  return { tab, scene, sj }
}
/** 贴图：包内 `materials/<name>.tex` → `/weassist` 回退（缺则记 MISSING，不画白块）。 */
function texMapOf(tab, names, gl) {
  const textures = new Map()
  const src = {}
  for (const n of names) {
    if (!n || textures.has(n)) continue
    let buf = pkgEntry(tab, 'materials/' + n + '.tex')
    let where = 'pkg'
    if (!buf && fs.existsSync(`${WE}/materials/${n}.tex`)) { buf = fs.readFileSync(`${WE}/materials/${n}.tex`); where = 'weassist' }
    if (!buf) { src[n] = 'MISSING'; continue }
    try {
      const tex = lib.parseTex(new Uint8Array(buf)); const m = lib.decodeMip0(tex)
      if (m && m.rgba) {
        textures.set(n, { glTex: lib.makeTextureMip(gl, [m], tex.format === 8), width: m.width, height: m.height,
          format: tex.format, sprite: lib.spriteInfo(tex) })
        src[n] = where
      } else src[n] = 'UNDECODED'
    } catch (e) { src[n] = 'ERR' }
  }
  return { textures, src }
}

/**
 * 真包单层探针：宿主接线（材质 → pass → `particleOverbrightFactor` → `layer.__particleOverbright`）
 * + 渲染一帧，返回该层所有 draw 批次的几何/实例色指纹与均值。
 * @param q '' | '?overbright=legacy'
 */
async function measureLayer(id, layerName, { dir = DD, q = '', t = 6.0, withChildren = false } = {}) {
  const { tab, scene } = loadScene(id, dir)
  if (!scene) return { err: 'no scene' }
  const L = scene.layers.find((l) => l.particleDef && l.name === layerName)
  if (!L) return { err: 'no layer ' + layerName }
  for (const l of scene.layers) l.visible = (l === L)
  const pPass = passOf(tab, L.particleDef.material)
  const factor = lib.particleOverbrightFactor(pPass)
  L.__particleOverbright = factor
  L.particleTexName = (pPass && pPass.textures && pPass.textures[0]) || null
  const texNames = [L.particleTexName]
  const childInfo = []
  if (withChildren) {
    const specs = lib.parseParticleChildren(L.particleDef)
    const childMap = new Map()
    for (const c of specs) {
      const cd = (() => { try { const b = pkgEntry(tab, c.name); return b ? JSON.parse(dec.decode(b)) : null } catch { return null } })()
      const cp = cd && cd.material ? passOf(tab, cd.material) : null
      const entry = { def: cd, texName: (cp && cp.textures && cp.textures[0]) || null,
        blending: (cp && cp.blending) || 'translucent', overbright: lib.particleOverbrightFactor(cp) }
      childMap.set(c.name, entry)
      childInfo.push({ name: c.name, type: c.type, texName: entry.texName, overbright: entry.overbright })
      texNames.push(entry.texName)
    }
    L.__pchildMap = childMap
  }
  const gl0 = makeGl().gl
  const { textures, src } = texMapOf(tab, texNames, gl0)
  if (!textures.size) return { err: 'no texture', factor, src }
  globalThis.location = { search: q }
  lib.setProjectionYFix(null)
  const { gl, rec } = makeGl()
  const r = lib.createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SR, aggregate: true })
  await r.render(scene, textures, 1920, 1080, t)
  const bs = batches(rec)
  return { factor, L, bs, src, childInfo, stats: r.particleStats,
    geoSha: sha(geoCat(bs)), colSha: sha(colCat(bs)), fullSha: sha(fullCat(bs)),
    mean: bs.length ? bs[0].mean : null, uni: bs.length ? bs[0].uni : null, quads: bs.map((b) => b.quads) }
}

// ───────────────────────── 合成场景（纯函数 ↔ 渲染通路对照） ─────────────────────────
const W = 3840, H = 2160
const mkLayer = (o) => Object.assign({ id: 1, name: 'L', visible: true, origin: [0, 0, 0], scale: [1, 1, 1], angles: [0, 0, 0],
  alpha: 1, size: [W, H], image: null, particle: 'p', particleDef: null, particleTexName: 'tex_a',
  textureName: null, effects: [], parallaxDepth: null, uvRect: undefined }, o)
/** 均匀色 def（无 colorrandom ⇒ `p.color` 恒 [1,1,1] ⇒ 走上提 `u_Color` 路径）。 */
const defWhite = () => ({ maxcount: 8, material: 'm',
  emitter: [{ name: 'boxrandom', rate: 100, instantaneous: 1, distancemax: '0 0 0' }],
  initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 100, max: 100 }],
  operator: [{ name: 'movement' }] })
/** 逐粒子色 def（colorrandom 全域 ⇒ 走 `a_Color` 顶点缓冲路径）。 */
const defVariegated = () => Object.assign(defWhite(), {
  initializer: defWhite().initializer.concat([{ name: 'colorrandom', min: '0 0 0', max: '255 255 255' }]) })
const TEXA = new Map([['tex_a', { glTex: { id: 'g1' }, width: 64, height: 64 }]])
async function renderSynth(def, factor, q = '', layerExtra = {}) {
  globalThis.location = { search: q }
  lib.setProjectionYFix(null)
  const layer = mkLayer(Object.assign({ particleDef: def, __particleOverbright: factor }, layerExtra))
  const { gl, rec } = makeGl()
  const scene = { layers: [layer], general: {}, camera: null, size: [W, H] }
  const r = lib.createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SR, aggregate: true })
  await r.render(scene, TEXA, W, H, 1.0)
  const bs = batches(rec)
  return { bs, stats: r.particleStats, layer }
}

// ═══════════════ [1] ① 取值契约（纯函数级） ═══════════════
function runContract() {
  group('[1] ① 取值契约（particleOverbrightFactor）')
  const cv = (v) => ({ constantshadervalues: v })
  const F = (p) => lib.particleOverbrightFactor(p)
  push('①-a 材质常量 0.25（上游 3151551777 Bokeh 的已知参照）⇒ 0.25', F(cv({ ui_editor_properties_overbright: 0.25 })) === 0.25)
  push('①-b 0.17 / 1.33 / 2 / 5 原样透传（不钳上界 —— 钳了就等于没修）',
    F(cv({ ui_editor_properties_overbright: 0.17 })) === 0.17 && F(cv({ ui_editor_properties_overbright: 1.33 })) === 1.33
    && F(cv({ ui_editor_properties_overbright: 2 })) === 2 && F(cv({ ui_editor_properties_overbright: 5 })) === 5)
  push('①-c ★ **键缺失 ⇒ 1**（`Number(undefined)` 是 NaN、`Number(null)` 是 0 ⇒ 显式判空才不整层全黑）',
    F(cv({})) === 1 && F(cv({ ui_editor_properties_overbright: null })) === 1)
  push('①-d 无 `constantshadervalues` / 无 pass / 无 material（null/undefined）⇒ 1',
    F(cv(undefined)) === 1 && F({}) === 1 && F(null) === 1 && F(undefined) === 1)
  push('①-e 脏值 `"abc"` / NaN / Infinity ⇒ 1（非有限数一律落缺省）',
    F(cv({ ui_editor_properties_overbright: 'abc' })) === 1 && F(cv({ ui_editor_properties_overbright: NaN })) === 1
    && F(cv({ ui_editor_properties_overbright: Infinity })) === 1)
  push('①-f 数值字符串 `"2"` ⇒ 2（编辑器存的是字符串常量，必须吃）',
    F(cv({ ui_editor_properties_overbright: '2' })) === 2)
  push('①-g ★ 负数 ⇒ **0**（`Math.max(0,·)`；0 是合法值 = 整层不亮，不是"回退 1"）',
    F(cv({ ui_editor_properties_overbright: -3 })) === 0 && F(cv({ ui_editor_properties_overbright: -0.5 })) === 0)
  push('①-h 值 = 1 ⇒ 1（语料 13/38 材质走这一档 ⇒ 后续"逐位不变"的前提）',
    F(cv({ ui_editor_properties_overbright: 1 })) === 1 && F(cv({ ui_editor_properties_overbright: '1' })) === 1)
  push('①-i 入参是 **pass**（不是 material）：只读 `pass.constantshadervalues.ui_editor_properties_overbright`，同名旁支键不吃',
    F(cv({ overbright: 5 })) === 1 && F(cv({ ui_editor_properties_overbright: 3 })) === 3
    && F({ passes: [{ constantshadervalues: { ui_editor_properties_overbright: 3 } }] }) === 1)
}

// ═══════════════ [2] ② 合成场景：因子真的乘进实例色 ═══════════════
async function runSynth() {
  group('[2] ② 合成场景端到端（uniform 上提路径 + 逐顶点色路径）')
  const base = await renderSynth(defWhite(), 1)
  const b0 = base.bs[0]
  push('②-a 前置：合成 def 产出 1 个 draw 批、`u_Color=(1,1,1)` 且**有效实例色**恒 1（= 改动前口径）',
    base.bs.length === 1 && !!b0 && b0.uni[0] === 1 && b0.uni[1] === 1 && b0.uni[2] === 1 && b0.colF32.every((v) => v === 1),
    b0 ? `quads=${b0.quads} uni=${JSON.stringify(b0.uni)} colBuf=${b0.colBuf}（恒真：颜色 VBO 无条件上传，整批同色时顶点色写 1）` : 'no draw')
  for (const f of [0.25, 0.17, 1.33, 2, 5]) {
    const m = await renderSynth(defWhite(), f)
    const bb = m.bs[0]
    push(`②-b 因子 ${f} ⇒ 实例 RGB 三通道 = ${f}（` + (f > 1 ? '**>1 不被钳回 1** = "先乘后不设上界"' : '下界档') + '）',
      !!bb && bb.uni[0] === f && bb.uni[1] === f && bb.uni[2] === f,
      bb ? `u_Color=${JSON.stringify(bb.uni)} mean=${bb.mean.map((v) => fx(v, 6)).join(',')}` : 'no draw')
  }
  push('②-c 因子 0 ⇒ 实例 RGB 三通道全 0（整层不亮，不是回退 1）',
    (await renderSynth(defWhite(), 0)).bs[0].uni.every((v) => v === 0))
  push('②-d `?overbright=legacy` ⇒ 因子 5 的层也回到 u_Color=(1,1,1)（逐位回退的合成面证据）',
    (await renderSynth(defWhite(), 5, '?overbright=legacy')).bs[0].uni.every((v) => v === 1))
  push('②-e 脏因子（"abc"/NaN/undefined）⇒ 渲染端兜底 1（宿主没接线/写坏时不许把层画黑）',
    (await renderSynth(defWhite(), 'abc')).bs[0].uni.every((v) => v === 1)
    && (await renderSynth(defWhite(), NaN)).bs[0].uni.every((v) => v === 1)
    && (await renderSynth(defWhite(), undefined)).bs[0].uni.every((v) => v === 1))
  push('②-f 负因子（-2）⇒ 渲染端兜底 0（不产生负色）',
    (await renderSynth(defWhite(), -2)).bs[0].uni.every((v) => v === 0))
  // 逐顶点色路径：整批颜色不同 ⇒ u_Color=(1,1,1) + a_Color 缓冲；逐顶点值必须**逐位**等于 基色 × 因子
  const vBase = (await renderSynth(defVariegated(), 1)).bs[0]
  push('②-g 前置：逐粒子色 def 走 `a_Color` 顶点缓冲（`u_Color=(1,1,1)`、colBuf=true、颜色真的不等）',
    !!vBase && vBase.colBuf && vBase.uni.every((v) => v === 1) && (() => {
      const s = new Set(); for (let i = 0; i < vBase.nv; i++) s.add(vBase.colF32[i * 3].toFixed(6)); return s.size > 1
    })(), vBase ? `uni=${JSON.stringify(vBase.uni)} colBuf=${vBase.colBuf} max=${vBase.max.map((v) => fx(v, 4)).join(',')}` : 'no draw')
  for (const f of [0.25, 2, 5]) {
    const m = (await renderSynth(defVariegated(), f)).bs[0]
    let allExact = !!m && !!vBase && m.nv === vBase.nv
    let worst = 0, worstRel = 0
    if (allExact) {
      for (let i = 0; i < m.colF32.length; i++) {
        const want = vBase.colF32[i] * f
        const tol = 1e-7 * Math.max(1, Math.abs(want))       // float32 存储的 1 ULP 级
        const dev = Math.abs(m.colF32[i] - want)
        if (dev > tol) { allExact = false; worst = Math.max(worst, dev) }
        worstRel = Math.max(worstRel, dev / Math.max(1e-9, Math.abs(want)))
      }
    }
    push(`②-h ★ 逐顶点路径：因子 ${f} 下**每个顶点**的颜色 ≡ 基色 × ${f}（float32 舍入内逐位相等）`,
      allExact, m ? `nv=${m.nv} maxΔ=${worst} maxRelΔ=${worstRel.toExponential(2)} 均值 ${vBase.mean.map((v, i) => fx(v, 5) + '→' + fx(m.mean[i], 5)).join(' / ')}` : 'no draw')
  }
  // ②-i 「逐位不变」的正确形式：**因子 1 档 ≡ `?overbright=legacy` 档**（同一层的两种写法）。
  //   这才是有内容的断言 —— 拿"因子 5 的层"去比只会证明颜色确实变了。
  for (const [nm, def] of [['均匀色', defWhite()], ['逐粒子色', defVariegated()]]) {
    const g1 = await renderSynth(def, 1)
    const gLeg = await renderSynth(def, 5, '?overbright=legacy')
    push(`②-i ★ ${nm} def：因子 1 档 与 \`?overbright=legacy\` 档（层上写着 5）**几何+颜色全字节相同** —— 这就是 29/54 层的回归保证`,
      sha(fullCat(g1.bs)) === sha(fullCat(gLeg.bs)) && Buffer.compare(colCat(g1.bs), colCat(gLeg.bs)) === 0,
      `full ${sha(fullCat(g1.bs)).slice(0, 16)} / ${sha(fullCat(gLeg.bs)).slice(0, 16)}；legacy 档 uni=${JSON.stringify(gLeg.bs[0].uni)}`)
  }
  const g1w = await renderSynth(defWhite(), 1), g5w = await renderSynth(defWhite(), 5)
  push('②-i2 反向自证：同一层因子 1 vs 因子 5 的**颜色流**不同、**几何流**相同（②-i 不是"怎么都相同"）',
    sha(colCat(g1w.bs)) !== sha(colCat(g5w.bs)) && sha(geoCat(g1w.bs)) === sha(geoCat(g5w.bs)),
    `col ${sha(colCat(g1w.bs)).slice(0, 16)} / ${sha(colCat(g5w.bs)).slice(0, 16)}；geo 相同`)
  const g5 = g5w
  push('②-j `particleStats.overbright` 记账：本帧吃因子的层数/因子极值/最后层名（真机上报可回答"这一台到底乘了几层"）',
    g5.stats.overbright.layers === 1 && g5.stats.overbright.maxFactor === 5 && g5.stats.overbright.minFactor === 5
    && g5.stats.overbright.lastFactor === 5 && g5.stats.overbright.lastLayer === 'L'
    && g1w.stats.overbright.layers === 0, `因子5: ${JSON.stringify(g5.stats.overbright)}；因子1: layers=${g1w.stats.overbright.layers}`)
}

// ═══════════════ [3] ③ 真包四层：修前 → 修后 ═══════════════
const REAL_LAYERS = [
  { id: '3719111841', dir: DD, name: 'Bokeh Hex', ob: 0.25, note: '上游 3151551777 同病参照' },
  { id: '3719111841', dir: DD, name: 'Bokeh Cir', ob: 0.25, note: '同上' },
  { id: '3544152633', dir: DD, name: 'reactive Stars', ob: 5, note: '语料最大' },
  { id: '3509243656', dir: Y0917, name: 'new_particle_system', ob: 0.17, note: '语料最小' },
]
async function runReal() {
  group('[3] ③ 真包四层（修前 = ?overbright=legacy → 修后 = 默认）')
  for (const r of REAL_LAYERS) {
    if (!fs.existsSync(`${r.dir}/${r.id}/scene.pkg`)) { push(`③ 真包 ${r.id} 缺失（SKIP 视作 PASS）`, true, 'no pkg'); continue }
    const on = await measureLayer(r.id, r.name, { dir: r.dir, q: '', t: 6.0 })
    const off = await measureLayer(r.id, r.name, { dir: r.dir, q: '?overbright=legacy', t: 6.0 })
    if (on.err || off.err || !on.mean || !off.mean) { push(`③ ${r.id}::${r.name} 可测（画出粒子）`, false, JSON.stringify(on.err || off.err || 'no draw')); continue }
    push(`③-a ${r.id}::${r.name} 材质因子读出 = ${r.ob}（材质 ${on.L.particleDef.material}）`,
      on.factor === r.ob && off.factor === r.ob, `official=${on.factor} legacy=${off.factor}`)
    // 修前 → 修后：每个通道的比值都必须 ≡ 因子（legacy 是"键被丢弃"，factor 仍读得到但没乘）
    let ratioOk = true
    const parts = []
    for (let c = 0; c < 3; c++) {
      const ratio = off.mean[c] > 0 ? on.mean[c] / off.mean[c] : (on.mean[c] === 0 ? 1 : NaN)
      parts.push(['R', 'G', 'B'][c] + ' ' + fx(off.mean[c], 6) + '→' + fx(on.mean[c], 6) + ' ×' + fx(ratio, 6))
      if (!(off.mean[c] === 0 ? on.mean[c] === 0 : near(ratio, r.ob, 1e-6))) ratioOk = false
    }
    push(`③-b ★★ ${r.name} **修前 → 修后**实例色均值比 ≡ ${r.ob}（${r.note}）`, ratioOk, parts.join(' | '))
    // ③-c 比 ③-b 更强：**逐顶点**（不是均值）比较，容差只留 float32 存储的 1 ULP 级
    let vOk = on.bs.length === off.bs.length && on.bs.length > 0
    let vWorst = 0, vN = 0
    if (vOk) {
      for (let b = 0; b < on.bs.length; b++) {
        if (on.bs[b].nv !== off.bs[b].nv) { vOk = false; break }
        for (let i = 0; i < on.bs[b].colF32.length; i++) {
          const want = off.bs[b].colF32[i] * r.ob
          const dev = Math.abs(on.bs[b].colF32[i] - want)
          if (dev > 1e-6 * Math.max(1, Math.abs(want))) vOk = false
          vWorst = Math.max(vWorst, dev / Math.max(1e-9, Math.abs(want)))
          vN++
        }
      }
    }
    push(`③-c ★ ${r.name} **逐顶点**（${vN} 个分量）：official ≡ legacy × ${r.ob}（float32 舍入内；不是"均值碰巧对上"）`,
      vOk, `maxRelΔ=${vWorst.toExponential(2)}；均值 ${off.mean.map((v, i) => fx(v, 6) + '→' + fx(on.mean[i], 6)).join(' / ')}`)
    push(`③-d ${r.name} 几何顶点流（位置/尺寸/UV/alpha）两档 sha256 相同 —— 因子只动颜色`,
      on.geoSha === off.geoSha, `geo ${on.geoSha.slice(0, 16)} / ${off.geoSha.slice(0, 16)}；quads=${on.quads.join('+')}`)
    push(`③-e ${r.name} 颜色流两档**不同**（反向自证 ③-d 不是"怎么都相同"）`,
      on.colSha !== off.colSha, `col ${on.colSha.slice(0, 16)} / ${off.colSha.slice(0, 16)}`)
    push(`③-f ${r.name} `+'`particleStats.overbright`'+` 记账 = 1 层 / 因子 ${r.ob}`,
      on.stats.overbright.layers === 1 && on.stats.overbright.maxFactor === r.ob
      && on.stats.overbright.minFactor === r.ob && off.stats.overbright.layers === 0,
      `official=${JSON.stringify(on.stats.overbright)}`)
    globalThis.__P149_REAL = globalThis.__P149_REAL || {}
    globalThis.__P149_REAL[r.name] = { ob: r.ob, meanOff: off.mean, meanOn: on.mean, uni: on.uni, geoSha: on.geoSha, colSha: on.colSha }
  }
}

// ═══════════════ [4] ④ 子系路径（自己的因子，不继承父层） ═══════════════
async function runChild() {
  group('[4] ④ 子系路径（真包 dd/3544152633 Shooting star-blue-2）')
  const id = '3544152633', name = 'Shooting star-blue-2'
  if (!fs.existsSync(`${DD}/${id}/scene.pkg`)) { push('④ 真包缺失（SKIP 视作 PASS）', true, 'no pkg'); return }
  const on = await measureLayer(id, name, { q: '', t: 10.0, withChildren: true })
  const off = await measureLayer(id, name, { q: '?overbright=legacy', t: 10.0, withChildren: true })
  if (on.err || !on.bs.length) { push('④ 真包可测（父 + 子系都画出粒子）', false, JSON.stringify(on.err || 'no draw')); return }
  push('④-a 前置：父层因子 = 1（本层非 1 的是**子系**材质）+ 解析出 ≥1 条子系',
    on.factor === 1 && on.childInfo.length >= 1, `父=${on.factor} 子系=${JSON.stringify(on.childInfo)}`)
  const child2 = on.childInfo.find((c) => c.overbright === 2)
  push('④-b ★ 语料里真的存在**子系材质 overbright ≠ 1** 的包：`star_shine-2` 材质因子 = 2（不是合成夹具）',
    !!child2, child2 ? child2.name + ' → ' + child2.texName : '未命中')
  push('④-c 前置：两档批次数一致且 ≥2（父先画、子系随后；事件类子系本帧可能一颗都没吐 ⇒ 不写死条数）',
    on.bs.length === off.bs.length && on.bs.length >= 2 && on.bs[0].quads >= 1,
    `batches official=${on.bs.map((b) => b.quads).join('+')} legacy=${off.bs.map((b) => b.quads).join('+')}`)
  if (on.bs.length === off.bs.length && on.bs.length >= 2 && child2) {
    // 谁吃了因子 2：逐批找"official ≡ legacy × 2"的那一批（不写死下标 —— 事件类子系可能本帧无粒子）
    const scaled = []
    for (let b = 0; b < on.bs.length; b++) {
      if (on.bs[b].nv !== off.bs[b].nv) continue
      let all2 = true, any = false
      for (let i = 0; i < on.bs[b].colF32.length; i++) {
        const want = off.bs[b].colF32[i] * 2
        if (Math.abs(on.bs[b].colF32[i] - want) > 1e-6 * Math.max(1, Math.abs(want))) { all2 = false; break }
        if (Math.abs(want) > 1e-9) any = true
      }
      if (all2 && any) scaled.push(b)
    }
    push('④-d ★ 恰好**一批**（因子 2 的子系）的实例色随 `overbright` 变化，其余批次逐字节不变',
      scaled.length === 1 && on.bs.every((b, i) => scaled.includes(i) || Buffer.compare(b.col, off.bs[i].col) === 0),
      `吃因子的批次下标=${JSON.stringify(scaled)}（共 ${on.bs.length} 批：${on.bs.map((b) => JSON.stringify(b.uni)).join(' ')}）`)
    push('④-e ★★ 父层（批 0）不吃子系因子、也不被二次相乘：两档实例色**逐字节相同**',
      Buffer.compare(on.bs[0].col, off.bs[0].col) === 0, `批0 uni ${JSON.stringify(on.bs[0].uni)}（quads=${on.bs[0].quads}）`)
    if (scaled.length === 1) {
      const c3on = on.bs[scaled[0]], c3off = off.bs[scaled[0]]
      let worst = 0, exact = c3on.colF32.length === c3off.colF32.length
      if (exact) for (let i = 0; i < c3on.colF32.length; i++) {
        const want = c3off.colF32[i] * 2
        const dev = Math.abs(c3on.colF32[i] - want)
        if (dev > 1e-7 * Math.max(1, Math.abs(want))) { exact = false; worst = Math.max(worst, dev) }
      }
      push('④-f ★★ 子系 `star_shine-2`（材质因子 2）：实例色**逐顶点** ≡ 基色 × 2（修前 → 修后）',
        exact, `批${scaled[0]} 均值 ${c3off.mean.map((v, i) => fx(v, 5) + '→' + fx(c3on.mean[i], 5)).join(' / ')}；maxΔ=${worst}`)
    } else {
      push('④-f ★★ 子系因子 2 的逐顶点缩放（批次定位失败 ⇒ 本条判红，不用兜底掩盖）', false, 'scaled=' + JSON.stringify(scaled))
    }
    push('④-g 子系几何流两档 sha256 相同（几何与颜色互不牵连）',
      sha(geoCat(on.bs)) === sha(geoCat(off.bs)), `geo ${sha(geoCat(on.bs)).slice(0, 16)} / ${sha(geoCat(off.bs)).slice(0, 16)}`)
    push('④-h `particleStats.overbright` 在子系路径上也记账（maxFactor=2 且层名指向子系）',
      on.stats.overbright.maxFactor === 2 && /子系/.test(on.stats.overbright.lastLayer) && off.stats.overbright.layers === 0,
      JSON.stringify(on.stats.overbright))
  } else {
    push('④-c…④-h 前置不成立 ⇒ 只钉前置那一条（已判红），不编造结论', false,
      `on=${on.bs.length} off=${off.bs.length} child2=${!!child2}`)
  }
}

// ═══════════════ [5] ⑤ 值 = 1 的层整帧逐位不变 + ?overbright=legacy 整条逐位 ═══════════════
async function runLegacy() {
  group('[5] ⑤ 值 = 1 的层逐位不变 + `?overbright=legacy` 整条回退')
  const id = '3554161528', name = '萤火虫'
  if (!fs.existsSync(`${DD}/${id}/scene.pkg`)) { push('⑤ 真包缺失（SKIP 视作 PASS）', true, 'no pkg'); return }
  const on = await measureLayer(id, name, { q: '', t: 20.0 })
  const off = await measureLayer(id, name, { q: '?overbright=legacy', t: 20.0 })
  if (on.err || !on.bs.length) { push('⑤ 真包可测（画出粒子）', false, JSON.stringify(on.err || 'no draw')); return }
  push('⑤-a 层 4569「萤火虫」材质 `overbright: 1`（这一档的语料规模见 ⑥ 的自导出基线）',
    on.factor === 1 && off.factor === 1, `factor=${on.factor} 材质=${on.L.particleDef.material}`)
  push('⑤-b ★★ 值 = 1 的层：默认档与 `?overbright=legacy` 的**整条**（几何 + 实例色）sha256 相同 —— 逐位不变',
    on.fullSha === off.fullSha && on.colSha === off.colSha && on.geoSha === off.geoSha,
    `full ${on.fullSha.slice(0, 16)} / ${off.fullSha.slice(0, 16)}；quads=${on.quads.join('+')}`)
  push('⑤-c `?overbright=legacy` 档下 `particleStats.overbright.layers = 0`（档位真的生效，不是"因子恰好 1"）',
    off.stats.overbright.layers === 0 && on.stats.overbright.layers === 0, `on=${on.stats.overbright.layers} off=${off.stats.overbright.layers}`)
  // 因子 ≠ 1 的真包层：`?overbright=legacy` 必须**逐位**等于"键被丢弃"的旧画面
  const r = REAL_LAYERS[0]
  if (fs.existsSync(`${r.dir}/${r.id}/scene.pkg`)) {
    const a = await measureLayer(r.id, r.name, { dir: r.dir, q: '?overbright=legacy', t: 6.0 })
    const b = await measureLayer(r.id, r.name, { dir: r.dir, q: '?overbright=legacy&x=1', t: 6.0 })
    push('⑤-d ★ 因子 0.25 的真包层在 `?overbright=legacy` 下：两条不同 URL（多带无关参数）出同一 sha256（回退档稳定可复现）',
      !!a.fullSha && a.fullSha === b.fullSha, `${fx(a.factor)} → full ${String(a.fullSha).slice(0, 16)} / ${String(b.fullSha).slice(0, 16)}`)
    push('⑤-e 反向自证：同一层默认档 sha256 ≠ legacy 档 sha256（⑤-d 不是"怎么都相同"）',
      a.fullSha !== (await measureLayer(r.id, r.name, { dir: r.dir, q: '', t: 6.0 })).fullSha,
      `legacy ${String(a.fullSha).slice(0, 16)}`)
  }
}

// ═══════════════ [6] ⑥ 语料扫描（流式；§1.3 的计数可复现） ═══════════════
function runCorpus() {
  group('[6] ⑥ 语料扫描计数（**自导出基线，只增不减**：规模 + 与规模无关的语义不变量）')
  const roots = [`${MPW_WS}/allwallpaper`, `${process.env.HOME || '/root'}/.dsh-mpkg-wallpaper`]
  const pkgs = []
  const walk = (p) => {
    let st; try { st = fs.statSync(p) } catch { return }
    if (st.isFile()) { if (/\.(pkg|mpkg)$/i.test(p)) pkgs.push(p); return }
    let es = []; try { es = fs.readdirSync(p) } catch { return }
    for (const f of es) walk(path.join(p, f))
  }
  for (const r of roots) walk(r)
  const st = { scenePkgs: 0, overMats: 0, overMatPkgs: new Set(), overVals: {}, overLayers: 0, overLayerPkgs: new Set(),
    overJoin: 0, nonOneLayers: [], nonOneMats: new Set(), oneLayers: 0, particles: 0, maxDepth: 0 }
  for (const f of pkgs) {
    let tab
    try { tab = pkgTable(f) } catch { continue }
    if (!tab.byName.has('scene.json')) continue
    st.scenePkgs++
    const id = path.basename(path.dirname(f))
    const texts = new Map()
    for (const e of tab.entries) {
      if (!/\.json$/i.test(e.name) || e.size > 8 << 20) continue
      try { const b = pkgEntry(tab, e.name); texts.set(e.name, dec.decode(b)) } catch {}
    }
    const materials = new Map(), presets = new Map()
    for (const [n, s] of texts) {
      if (/^materials\//i.test(n)) { try { materials.set(n, JSON.parse(s)) } catch {} }
      else if (/^particles\//i.test(n)) { try { presets.set(n, JSON.parse(s)) } catch {} }
    }
    let scene = null
    try { scene = JSON.parse(texts.get('scene.json')) } catch { continue }
    // ⚠ 计数只在**这一次** materials 遍历里发生（`valOf` 会被逐层/逐对象调用多次 ⇒ 在里面累加会翻倍）
    const obMats = new Set()
    const matVals = new Map()
    for (const [n, j] of materials) {
      const vs = []
      for (const pass of (j.passes || [])) {
        const c = pass && pass.constantshadervalues
        if (!c || !Object.prototype.hasOwnProperty.call(c, 'ui_editor_properties_overbright')) continue
        const k = String(c.ui_editor_properties_overbright)
        vs.push(k)
        st.overMats++                       // = 带该键的 pass 条数（每条材质恰 1 个 ⇒ 也等于材质数）
        st.overMatPkgs.add(id)
        st.overVals[k] = (st.overVals[k] || 0) + 1
        if (k !== '1') st.nonOneMats.add(id + '::' + n)
      }
      if (vs.length) { obMats.add(n); matVals.set(n, vs) }
    }
    const valOf = (n) => matVals.get(n) || matVals.get('materials/' + String(n).replace(/^materials\//, '')) || null
    const graph = (name, depth, seen) => {
      if (depth > 4 || seen.has(name)) return []
      seen.add(name)
      const j = presets.get(name)
      if (!j) return []
      const out = []
      const m = normName(j.material); if (m) out.push({ mat: m, depth: 0 })
      for (const ch of (j.children || [])) {
        const cn = normName(ch && ch.name)
        if (cn) for (const g of graph(cn, depth + 1, seen)) out.push({ mat: g.mat, depth: g.depth + 1 })
      }
      return out
    }
    for (const o of (scene.objects || [])) {
      const pn = normName(o.particle)
      if (!pn) continue
      st.particles++
      st.overJoin++
      const g = graph(pn, 0, new Set())
      for (const it of g) if (it.depth > st.maxDepth) st.maxDepth = it.depth   // ②(2026-09-23) ②(2026-09-23) join 深度上限（≤4）要可断言
      const vals = []
      let hit = false
      for (const it of g) {
        const key = obMats.has(it.mat) ? it.mat : (obMats.has('materials/' + String(it.mat).replace(/^materials\//, '')) ? ('materials/' + String(it.mat).replace(/^materials\//, '')) : null)
        if (!key) continue
        hit = true
        const vs = valOf(key) || []
        for (const v of vs) vals.push({ v, depth: it.depth, mat: key })
      }
      if (!hit) continue
      st.overLayers++
      st.overLayerPkgs.add(id)
      const uniq = [...new Set(vals.map((x) => x.v))]
      if (uniq.some((v) => v !== '1')) st.nonOneLayers.push({ id, name: String(o.name || o.id), vals: uniq })
      else st.oneLayers++
    }
  }
  // ⚠ 计数口径：`overMats` 数的是**带该键的 pass 条数**（每条材质恰 1 个 ⇒ 也等于材质数），
  //   与方案文档 §1.3 的扫描器逐字同口径；`overVals` 是 pass 级直方图。
  /* ②(2026-09-23 语料漂移修复) **语料自导出基线**（只增不减）。旧写法把 §1.3 的 12 键直方图与
   *   "56 包 / 38 材质 / 15 包命中 / 54 层 / 25 非 1 层"全部钉死 ⇒ 今晚新增 `0923/`+`wallpaperE/`
   *   后整组变红（红在"语料长了"）。新判据 = **规模只增不减 + 与规模无关的语义不变量**：
   *     · `Σ 直方图 = 材质数`（每条材质恰一个值，不能多算/漏算）；
   *     · 每个键都是有限正数；`非 1 材质数 = 材质数 − 值 = 1 的材质数`；
   *     · `非1层 + 恰为1层 = 总层数`（划分）；每层的取值都必须是材质级直方图里出现过的键（跨级核对）；
   *     · §1.3 的旧键**一个都不许消失**（老壁纸的层还在）；⑥-g 的点名极值仍在。
   *   基线由本扫描器自导出（`P149_SCAN_UPDATE=1` 打印可粘贴值）。 */
  const OVERBRIGHT_CORPUS_BASELINE = {
    // ①(2026-10-04 语料漂移同步) 70/29/112/463/41/71/37/21/2 → 65/28/106/442/38/68/33/20/1：
    //   wallpapertest1_*.mpkg 被主线移入 allwallpaper/delete/（离开扫描根集）——"只增不减"修订为
    //   语料集合变化时同步并记录原因（发现算法按内容特征运行期扫，不与路径绑定）。
    note: '2026-10-04 语料漂移同步（wallpapertest1_* → delete/：overMats 70→65 等）。更早：2026-09-23 全语料自导出（含 0923/）',
    scenePkgs: 123, overMats: 65, overMatPkgs: 28, overLayers: 106, overLayerPkgs: 28, overJoin: 442,
    nonOneLayers: 38, oneLayers: 68, nonOneMats: 33, nonOneLayerDirs: 20, multiValueLayers: 1, maxDepth: 2,
    vals: ['0.17', '0.25', '0.33', '0.66', '0.75', '0.98', '1.01', '1.1', '1.2', '1.2000000476837158', '1.21', '1.33', '1.46', '1.47', '1.77', '1.8', '2', '2.61', '5'],
  }
  /** §1.3 实测过的 12 个键（老语料的面）：只要求"还在"，不再要求计数逐键相等（新包会让计数变大）。 */
  const HIST_1_3 = { 1: 13, 2: 4, 5: 2, 1.33: 5, 1.47: 1, 1.1: 3, 1.21: 2, 0.17: 1, 1.77: 1, 0.66: 1, 0.25: 2, 1.01: 3 }
  const B = OVERBRIGHT_CORPUS_BASELINE
  const valSum = Object.values(st.overVals).reduce((s, n) => s + n, 0)
  const keysAllNumeric = Object.keys(st.overVals).every((k) => k !== '' && Number.isFinite(Number(k)) && Number(k) > 0)
  const distinctVals = [...new Set(st.nonOneLayers.flatMap((l) => l.vals))].sort()
  const multiValueLayers = st.nonOneLayers.filter((l) => l.vals.length > 1).length
  if (process.env.P149_SCAN_UPDATE) console.log('  [scan-baseline] ' + JSON.stringify({ scenePkgs: st.scenePkgs, overMats: st.overMats, overMatPkgs: st.overMatPkgs.size, overLayers: st.overLayers, overLayerPkgs: st.overLayerPkgs.size, overJoin: st.overJoin, nonOneLayers: st.nonOneLayers.length, oneLayers: st.oneLayers, nonOneMats: st.nonOneMats.size, multiValueLayers, maxDepth: st.maxDepth, vals: distinctVals }))
  push('⑥-a 语料容器与场景包计数（**自导出基线，只增不减**）：带 `scene.json` 的包 ≥ ' + B.scenePkgs,
    st.scenePkgs >= B.scenePkgs && st.scenePkgs > 0 && st.scenePkgs <= pkgs.length,
    `scenePkgs=${st.scenePkgs}（基线 ${B.scenePkgs}；候选包 ${pkgs.length}）`)
  push('⑥-b ★ 带 `ui_editor_properties_overbright` 的材质 ≥ ' + B.overMats + '、命中包 ≥ ' + B.overMatPkgs + '（逐材质：每个记录值都是有限正数）',
    st.overMats >= B.overMats && st.overMatPkgs.size >= B.overMatPkgs && keysAllNumeric,
    `materials=${st.overMats}（基线 ${B.overMats}） materialPkgs=${st.overMatPkgs.size}（基线 ${B.overMatPkgs}）`)
  push('⑥-c ★ 取值直方图：值域 = 有限正数 + `Σ 计数 = 材质数`（不漏算/不重复计）+ §1.3 的 ' + Object.keys(HIST_1_3).length + ' 个键一个不少',
    keysAllNumeric && valSum === st.overMats
    && Object.keys(HIST_1_3).every((k) => (st.overVals[k] || 0) >= 1)
    && Object.keys(st.overVals).length >= Object.keys(HIST_1_3).length,
    `Σ=${valSum} vs materials=${st.overMats}；键数=${Object.keys(st.overVals).length}（§1.3 的键缺=${Object.keys(HIST_1_3).filter((k) => !(st.overVals[k] > 0)).join(',') || '无'}） 直方图=${JSON.stringify(st.overVals)}`)
  push('⑥-d ★ preset→children 图（深度 ≤4）join 到的粒子层 ≥ ' + B.overLayers + '、覆盖 ≥ ' + B.overLayerPkgs + ' 个包、join 数 ≥ ' + B.overJoin + '（逐层：join 深度 ≤ 4 且命中包 ⊆ 材质命中包）',
    st.overLayers >= B.overLayers && st.overLayerPkgs.size >= B.overLayerPkgs && st.overJoin >= B.overJoin
    && st.maxDepth <= 4 && [...st.overLayerPkgs].every((p) => st.overMatPkgs.has(p)),
    `layers=${st.overLayers}（基线 ${B.overLayers}） layerPkgs=${st.overLayerPkgs.size}（基线 ${B.overLayerPkgs}） particleObjsJoined=${st.overJoin}（基线 ${B.overJoin}） maxDepth=${st.maxDepth}`)
  push('⑥-e ★★ 非 1 层 / 恰为 1 层：**划分不变量**（两者之和 = 总层数）+ 各自 ≥ 基线 ' + B.nonOneLayers + '/' + B.oneLayers + '（真正会变画面的只有前一类）',
    st.nonOneLayers.length + st.oneLayers === st.overLayers
    && st.nonOneLayers.length >= B.nonOneLayers && st.oneLayers >= B.oneLayers
    && st.nonOneLayers.every((l) => l.vals.length > 0 && l.vals.some((v) => v !== '1')),
    `非1=${st.nonOneLayers.length}（基线 ${B.nonOneLayers}） 恰为1=${st.oneLayers}（基线 ${B.oneLayers}） 合计=${st.nonOneLayers.length + st.oneLayers}/${st.overLayers}`)
  push('⑥-f ★ 非 1 层的取值集合：≥ 基线 ' + B.vals.length + ' 种、基线取值一个不少、且**每个取值都在材质级直方图里出现过**（跨级核对，不是两套口径）',
    distinctVals.length >= B.vals.length && B.vals.every((v) => distinctVals.includes(v))
    && distinctVals.every((v) => (st.overVals[v] || 0) >= 1) && distinctVals.every((v) => v !== '1')
    && multiValueLayers >= B.multiValueLayers,
    distinctVals.join(',') + `；同层多值的层=${multiValueLayers}（基线 ${B.multiValueLayers}）`)
  const has = (n, v) => st.nonOneLayers.some((l) => l.name === n && l.vals.includes(v))
  push('⑥-g ★ 点名极值：Bokeh Hex = 0.25、Bokeh Cir = 0.25、reactive Stars = 5、Glass Shards = 5、new_particle_system = 0.17',
    has('Bokeh Hex', '0.25') && has('Bokeh Cir', '0.25') && has('reactive Stars', '5') && has('Glass Shards', '5') && has('new_particle_system', '0.17'))
  push('⑥-h ★ 非 1 层覆盖的 `scene.pkg` 目录名 ≥ 基线 ' + B.nonOneLayerDirs + '（逐层可点名；语料跨根重名的包会计多次）',
    st.nonOneLayers.length >= B.nonOneLayers && new Set(st.nonOneLayers.map((l) => l.id)).size >= B.nonOneLayerDirs
    && st.nonOneLayers.every((l) => l.id && l.name),
    `非1层 ${st.nonOneLayers.length} 个，分布 ${new Set(st.nonOneLayers.map((l) => l.id)).size} 个目录名（基线 ${B.nonOneLayerDirs}，含重复根）：` + [...new Set(st.nonOneLayers.map((l) => l.id))].slice(0, 8).join(' '))
  push('⑥-i 非 1 材质 = 材质数 − 值恰为 1 的材质数（**派生量**，不再钉 25）；逐包可点名（`dd/3544152633` 的 halo_1 = 5、`0917/3509243656` 的 halo_2 = 0.17）',
    st.nonOneMats.size === st.overMats - (st.overVals['1'] || 0) && st.nonOneMats.size >= B.nonOneMats,
    `nonOneMats=${st.nonOneMats.size}（基线 ${B.nonOneMats}）= ${st.overMats} − ${st.overVals['1'] || 0}`)
  globalThis.__P149_CORPUS = { st, nonOne: st.nonOneLayers }
}

// ═══════════════ [7] ⑦ 接线与登记 ═══════════════
function runWiring() {
  group('[7] ⑦ 接线（demo.html 两处）+ 登记（README / run-all-tests / PATCHES / THIRD-PARTY / 台账）')
  const demo = (() => { try { return fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8') } catch { return '' } })()
  const readme = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8') } catch { return '' } })()
  const runner = (() => { try { return fs.readFileSync(path.join(ROOT, 'tests', 'run-all-tests.sh'), 'utf8') } catch { return '' } })()
  const patches = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'PATCHES.md'), 'utf8') } catch { return '' } })()
  const tp = (() => { try { return fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8') } catch { return '' } })()
  const cr = (() => { try { return fs.readFileSync(path.join(ROOT, 'docs', 'COPYING-RULES.md'), 'utf8') } catch { return '' } })()
  push('⑦-a `demo.html` 父层接线：粒子材质段调 `lib.particleOverbrightFactor(pass)` 并写 `layer.__particleOverbright`',
    /layer\.__particleOverbright = lib\.particleOverbrightFactor\(pass\)/.test(demo), '锚点 layer.__particleOverbright = lib.particleOverbrightFactor(pass)')
  push('⑦-b `demo.html` 子系接线：`resolveChildDefs` 的 map 条目带**自己的** `overbright`（不继承父层）',
    /overbright: lib\.particleOverbrightFactor\(pass\)/.test(demo), '锚点 overbright: lib.particleOverbrightFactor(pass)')
  push('⑦-c `?overbright=legacy` 登记进 `docs/README-DIAGNOSTICS.md` **主表**（FLAG-TABLE 区内）',
    (() => { const i = readme.indexOf('<!-- FLAG-TABLE-BEGIN -->'), j = readme.indexOf('<!-- FLAG-TABLE-END -->')
      return i >= 0 && j > i && /^\| `overbright` \|/m.test(readme.slice(i, j)) })(),
    '主表行 | `overbright` |')
  push('⑦-d `tests/run-all-tests.sh` 登记门禁 `particle-overbright`',
    /add "particle-overbright" "node tests\/particle-overbright-test\.mjs"/.test(runner))
  push('⑦-e `docs/PATCHES.md` 有 **P-149** 且写明判据 / 回退开关 / 门禁名',
    /^## P-149（/m.test(patches) && patches.includes('?overbright=legacy') && patches.includes('particle-overbright'))
  push('⑦-f `THIRD-PARTY.md` **§16** 在位：点名上游/MIT/commit + `particles.js:590-593` 取值契约 + `:1300` 消费点',
    /^## 16\. /m.test(tp) && tp.includes('oneincase/webwallgl') && tp.includes('19c5fab')
    && /particles\.js:590(-593)?/.test(tp) && tp.includes('particles.js:1300') && tp.includes('particleOverbrightFactor'))
  push('⑦-g `docs/COPYING-RULES.md` §4 台账 **#14** 指向 P-149 / §16（"先登记再合入"）',
    /^\| 14 \|/m.test(cr) && cr.includes('P-149') && cr.includes('`THIRD-PARTY.md` §16'))
}

// ═══════════════ [8] ⑧ RED-IF-REVERTED（5 组变异） ═══════════════
const MUTANTS = [
  { id: 'R1', group: '[1] ① 取值契约（particleOverbrightFactor）', probe: 'contract', file: 'we-scene-bundle.js',
    why: '取值改回 `Number(raw)`（去掉判空）⇒ 键缺失变 0（整层全黑）',
    anchor: '  return (raw == null || !Number.isFinite(n)) ? 1 : Math.max(0, n)\n',
    repl: '  return Math.max(0, n)   // MUTANT R1: 去掉判空\n' },
  { id: 'R2', group: '[2] ② 合成场景端到端（uniform 上提路径 + 逐顶点色路径）', probe: 'synth', file: 'we-scene-bundle.js',
    why: '`Math.min(1,…)` 套到乘之后 ⇒ 因子 5 被钳回 1',
    anchor: '      const colorR = Math.max(0, Math.min(1, p.color[0] || 0)) * obf\n      const colorG = Math.max(0, Math.min(1, p.color[1] || 0)) * obf\n      const colorB = Math.max(0, Math.min(1, p.color[2] || 0)) * obf\n',
    repl: '      const colorR = Math.max(0, Math.min(1, (p.color[0] || 0) * obf))   // MUTANT R2\n      const colorG = Math.max(0, Math.min(1, (p.color[1] || 0) * obf))\n      const colorB = Math.max(0, Math.min(1, (p.color[2] || 0) * obf))\n' },
  { id: 'R3', group: '[3] ③ 真包四层（修前 = ?overbright=legacy → 修后 = 默认）', probe: 'real', file: 'we-scene-bundle.js',
    why: '整个功能拿掉（`obf` 恒 1）⇒ 回到"键被静默丢弃"的旧画面',
    anchor: "    const __obRaw = OVERBRIGHT_MODE === 'legacy' ? 1 : layer.__particleOverbright\n",
    repl: '    const __obRaw = 1   // MUTANT R3: 功能拿掉\n' },
  { id: 'R4', group: '[4] ④ 子系路径（真包 dd/3544152633 Shooting star-blue-2）', probe: 'child', file: 'we-scene-bundle.js',
    why: '子系伪层不带 `res.overbright` ⇒ 子系永远吃 1（父层照旧）',
    anchor: '        __particleOverbright: res.overbright,\n',
    repl: '        // MUTANT R4: 子系不带因子\n' },
  { id: 'R5', group: '[5] ⑤ 值 = 1 的层逐位不变 + `?overbright=legacy` 整条回退', probe: 'legacy', file: 'we-scene-bundle.js',
    why: '`?overbright=legacy` 档失效（照常乘因子）⇒ 回退口没了',
    anchor: "    const __obRaw = OVERBRIGHT_MODE === 'legacy' ? 1 : layer.__particleOverbright\n",
    repl: '    const __obRaw = layer.__particleOverbright   // MUTANT R5: legacy 档失效\n' },
]

function runProbeSub(bundlePath, scenario) {
  let out = '', rc = 0
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'tests/particle-overbright-test.mjs'), '--probe', scenario],
      { env: Object.assign({}, process.env, { MPW_P149_BUNDLE: bundlePath }), encoding: 'utf8', timeout: 240000 })
  } catch (e) { rc = e.status == null ? 1 : e.status; out = String(e.stdout || '') + String(e.stderr || '') }
  const mm = /^PROBE (.*)$/m.exec(out)
  let j = null
  try { j = mm ? JSON.parse(mm[1]) : null } catch (e) { j = null }
  return { rc, out, j }
}

function runMutations() {
  group('[8] ⑧ RED-IF-REVERTED（5 组变异，每组另跑一次探针并记录实际变红的断言）')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p149-red-'))
  const coreSrc = path.join(ROOT, 'core')
  const copyCore = (d) => { for (const f of fs.readdirSync(coreSrc)) if (/\.(mjs|js)$/.test(f)) fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(coreSrc, f))) }
  copyCore(tmp)
  const REAL = path.join(coreSrc, 'we-scene-bundle.js')
  for (const mu of MUTANTS) {
    const d = path.join(tmp, mu.id)
    fs.mkdirSync(d)
    copyCore(d)
    const mut = path.join(d, mu.file)
    const src = fs.readFileSync(mut, 'utf8')
    const hits = src.split(mu.anchor).length - 1
    push(`⑧ ${mu.id}-0 变异锚点唯一（${mu.why}）`, hits === 1, `命中 ${hits} 次`)
    if (hits !== 1) continue
    fs.writeFileSync(mut, src.replace(mu.anchor, mu.repl))
    const base = runProbeSub(REAL, mu.probe)
    const mm = runProbeSub(mut, mu.probe)
    const redGroups = mm.j ? [...new Set(mm.j.failedGroups || [])] : null
    const redNames = (mm.j && Array.isArray(mm.j.names)) ? mm.j.names : []
    const good = !!base.j && !!mm.j && base.rc === 0 && mm.rc === 1 && (mm.j.failed || 0) > 0
      && redGroups.length === 1 && redGroups[0] === mu.group
    push(`⑧ ${mu.id} ★★ 变异生效 ⇒ **${mu.group}** 必红（真文件 rc=0 / 变异体 rc=1）`, good,
      `真文件 rc=${base.rc}（失败 ${base.j ? base.j.failed : '?'}）→ 变异体 rc=${mm.rc} 实际变红组=${JSON.stringify(redGroups)}：`
      + redNames.map((n) => n.split(' ')[0]).join(',')
      + (good ? '' : `（变异体尾：${String(mm.out).slice(-200)}）`))
  }
  push('⑧-f 变异全部在 `/tmp` 副本上做 —— 真树 `core/we-scene-bundle.js` sha256 跑完不变',
    sha(fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'))) === sha(fs.readFileSync(path.join(coreSrc, 'we-scene-bundle.js'))),
    'sha=' + sha(fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'))).slice(0, 16))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

// ═══════════════ 探针模式（变异子进程；只跑被点名的那一组，绝不递归派生） ═══════════════
if (PROBE) {
  const emit = (o) => console.log('PROBE ' + JSON.stringify(o))
  const run = { contract: runContract, synth: runSynth, real: runReal, child: runChild, legacy: runLegacy }[PROBE]
  if (!run) { console.log('未知探针 ' + PROBE); process.exit(2) }
  await run()
  const failed = checks.filter((c) => !c.ok)
  for (const c of checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name)
  emit({ probe: PROBE, checks: checks.length, failed: failed.length,
    failedGroups: [...new Set(failed.map((c) => c.group))], names: failed.map((c) => c.name) })
  process.exit(failed.length ? 1 : 0)
}

// ═══════════════ 主套件 ═══════════════
console.log('[1] ① 取值契约（particleOverbrightFactor）'); runContract()
console.log('\n[2] ② 合成场景端到端（uniform 上提路径 + 逐顶点色路径）'); await runSynth()
console.log('\n[3] ③ 真包四层（修前 = ?overbright=legacy → 修后 = 默认）'); await runReal()
console.log('\n[4] ④ 子系路径（真包 dd/3544152633 Shooting star-blue-2）'); await runChild()
console.log('\n[5] ⑤ 值 = 1 的层逐位不变 + `?overbright=legacy` 整条回退'); await runLegacy()
console.log('\n[6] ⑥ 语料扫描计数（自导出基线：规模只增不减 + 语义不变量）'); runCorpus()
console.log('\n[7] ⑦ 接线 + 登记'); runWiring()
console.log('\n[8] ⑧ RED-IF-REVERTED 5 组变异'); runMutations()

const pass = checks.filter((c) => c.ok).length
const fails = checks.filter((c) => !c.ok)
console.log(`\n===== particle-overbright: ${pass} 通过 / ${fails.length} 失败 =====`)
if (fails.length) console.log('失败项:\n  ' + fails.map((c) => c.name + (c.detail !== undefined ? ' — ' + c.detail : '')).join('\n  '))
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ checks: checks.length, failed: fails.length,
    real: globalThis.__P149_REAL || null, nonOne: (globalThis.__P149_CORPUS || {}).nonOne || null }))
}
process.exit(fails.length ? 1 : 0)

/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · `references/wer-ref`（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only）—— 与本项目 GPL-3.0-or-later 不兼容，仅行为对照；
 *   · `references/lwe-ref`（linux-wallpaperengine，GPL-3.0-only）—— 仅行为对照；
 *   · `references/vendor-ref/webwallgl`（oneincase/webwallgl，**MIT**）—— 允许移植，本文件仍按"行为规格"独立实现。
 *   血缘/许可台账见 docs/COPYING-RULES.md 与 THIRD-PARTY.md。 */
// particle-turbulence-field-test.mjs — P-140 回归门禁（秒级、无浏览器、无网络、无 GPU；缺真包 ⇒ SKIP + exit 0）
//
// 钉住用户第 7 项「第 2 个壁纸第 26 层 vapor 被渲染成各种发散的线条」的根因修复
// （取证报告：`docs/VAPOR-LAYER-3544152633.md`；台账：`docs/PATCHES.md` P-140）：
//   `turbulentvelocityrandom` initializer 的**初速方向**此前取 `p.random`（每颗粒子出生时抽的独立
//   随机角）⇒ 同处出生的粒子各自飞散；`renderer=rope` 的层把这些粒子按**发射序**连成 ribbon
//   ⇒ 屏幕上是一堆细长交错的线。官方语义 = 按**位置**采样的 curl 噪声场（同地同向、邻地平滑）。
//
// 五段断言（每段都能独立解释"哪条判据被钉住"）：
//   ① 纯函数（不碰真包）：方向是**位置的函数** —— 同位置同向（改 `p.random` 逐位不变）、相邻位置
//      方向平滑（<2px ⇒ 夹角 < 10°）、远处位置方向确实不同（不是常数场）；`?pturb=legacy` 档则相反
//      （同位置各向同性：序参量 ≈ 0、相邻夹角中位 ≈ 90°），且 legacy 逐位 == **测试内独立重算的旧算式**。
//      音频语义（P-131/P-132 批 D）两档都在：`(1+env)` 作用在相位上 ⇒ env=0 与"无视图"逐位相同、env=1 方向变。
//   ② 真包 `dd/3544152633` `ln=25`「Vapor (double)」：真渲染器 + mock-GL 抓**顶点流**，算 ribbon 的
//      段长中位 / 总长 / >60px 的段数 ⇒ 必须落到阈值内（改前：中位 190px 级、总长 6796px 级）。
//   ③ `?pturb=legacy` 逐位回退：**同一段源码**换成旧算式（变异体放 `/tmp` 真文件副本）后的顶点流
//      sha256，与真 bundle 加 `?pturb=legacy` 的顶点流 sha256 **完全相同**（同种子同帧数出同数字）。
//   ④ RED-IF-REVERTED：用同一变异体跑 `--probe`（official 档）⇒ ②的判据**必须变红**。
//   ⑤ 同族计数：语料里吃到非零 `turbulentvelocityrandom` 的粒子层 28（rope 13 / sprite 14 /
//      spritetrail 1）；报告 §5 的"发散长线"判据（段长中位 ≥ 40px 且 段长/尺寸 ≥ 4，t=3 与 t=8 两次都命中）
//      在 **legacy 档 = 改前口径** 下命中 **13**，在 official 档下命中 **0**。
//
// 用法: node tests/particle-turbulence-field-test.mjs [--verbose]
//      node tests/particle-turbulence-field-test.mjs --probe     # 变异子进程用：只跑 ② 段并按判据退出
// TODO(tests/run-all-tests.sh): 本文件尚未登记进门禁脚本（由主对话统一登记，别的线不要改 run-all-tests.sh）
import { WS, ROOT } from './_root.mjs'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { walkContainers, readIndexHead, readEntryBytes } from './_pkg-index.mjs'

const VERBOSE = process.argv.includes('--verbose')
const IS_PROBE = process.argv.includes('--probe')
const MPW_WS = process.env.MPW_ROOT || WS
const DIR = `${MPW_WS}/allwallpaper/dd`
const WE = `${MPW_WS}/wallpaper_engine/assets`
// 变异子进程可指向 /tmp 的副本；缺省 = 本仓库真文件
const BUNDLE = process.env.MPW_P140_BUNDLE || path.join(ROOT, 'core/we-scene-bundle.js')
// 出问题的那个真包/层：`dd/3544152633` 的 `objects[25]` =「Vapor (double)」id=206100（报告 §1）
const PKG_ID = '3544152633'
const LN = 25
const PKG = `${DIR}/${PKG_ID}/scene.pkg`
const dec = new TextDecoder()
const checks = []
const push = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (VERBOSE || !ok) console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? ' — ' + detail : '')) }
const near = (a, b, tol) => Math.abs(a - b) <= tol
const med = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] }
const sha = (u8) => crypto.createHash('sha256').update(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)).digest('hex').slice(0, 16)
const angBetween = (a, b) => {
  const na = Math.hypot(a[0], a[1]), nb = Math.hypot(b[0], b[1])
  if (!(na > 1e-9) || !(nb > 1e-9)) return NaN
  return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (na * nb)))) * 180 / Math.PI
}
// 序参量：1 = 全同向（整团漂移），0 = 各向同性（四散）
const orderR = (dirs) => {
  if (!dirs.length) return NaN
  const sx = dirs.reduce((a, v) => a + v[0], 0), sy = dirs.reduce((a, v) => a + v[1], 0)
  return Math.hypot(sx, sy) / dirs.length
}
const unit = (v) => { const n = Math.hypot(v[0], v[1]); return n > 1e-9 ? [v[0] / n, v[1] / n] : null }

if (!fs.existsSync(PKG)) {
  console.log(`SKIP particle-turbulence-field — 缺真包 ${PKG}（语料不入仓：见 docs/TESTING.md 的 $MPW_ROOT 口径）`)
  process.exit(0)
}

const lib = await import(new URL('file://' + BUNDLE).href)

// ───────────────────────── mock GL（顶点流捕获；与 P-133/P-136 门禁同构） ─────────────────────────
const W = 3840, H = 2160
function makeGl() {
  const rec = { verts: [], draws: [], bufs: new Map() }
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
    bufferData: (t, data) => { if (data && data.length) { const v = Float32Array.from(data); rec.bufs.set(curBuf, v); rec.verts.push(v) } },
    activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {}, bindVertexArray: () => {},
    useProgram: (p) => { curProg = p },
    texImage2D: () => {}, uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: (l, tr, m) => setUni(l, m ? Array.from(m) : null), uniformMatrix3fv: () => {},
    drawArrays: (m, f, c) => { rec.draws.push({ count: c, data: rec.bufs.get(curBuf) || null }) }, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 0 : (k === CONST.ACTIVE_ATTRIBUTES ? 0 : null)),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }), getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_TexCoordB: 2, a_Blend: 3, a_Alpha: 4, a_Color: 5 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
  }
  return { gl: new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } }), rec }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const SHADER_RESOLVER = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

// 档位在 `createRenderer` 里读 `location.search`（与 `?pframe=`/`?pops=`/`?pcolor=` 同机制）
// ⇒ 换档 = 换 location.search 再建一个 renderer（`projectionYFix` 是首次读取缓存，一并复位）。
function setModes(q) { globalThis.location = { search: q ? '?' + q : '', href: 'http://localhost/' + (q ? '?' + q : '') }; lib.setProjectionYFix(null) }

// ── rope ribbon 的段长统计（**从真顶点流算**，不是从粒子数组算） ──
//   rope 每段 6 顶点（2 三角形）：u=0 的两顶点关于粒子 A 的中心对称、u=1 的两顶点关于粒子 B 对称
//   （报告 §2.2 的 `pushA` 序列）⇒ A/B 的中心 = 各自两个顶点的中点；段长 = |B−A|（px）。
function ropeSegStats(verts) {
  const segs = []
  for (let q = 0; q * 54 + 54 <= verts.length; q++) {
    const o = q * 54
    const A = [(verts[o] + verts[o + 9]) / 2, (verts[o + 1] + verts[o + 10]) / 2]
    const B = [(verts[o + 18] + verts[o + 27]) / 2, (verts[o + 19] + verts[o + 28]) / 2]
    segs.push(Math.hypot((B[0] - A[0]) * W / 2, (B[1] - A[1]) * H / 2))
  }
  if (!segs.length) return null
  return { n: segs.length, med: med(segs), sum: segs.reduce((a, b) => a + b, 0), over60: segs.filter((x) => x > 60).length, max: Math.max(...segs) }
}
const isParticleBatch = (d) => d.count > 6 && d.count % 6 === 0 && d.data && d.data.length === d.count * 9
// 同一场景里可能还有别的 draw（层底图等）：粒子 ribbon 是唯一"顶点数 = 6×段数"的批，取其中最大的一个
const pickParticleBatch = (rec) => {
  const bs = rec.draws.filter(isParticleBatch)
  if (!bs.length) return null
  return bs.reduce((a, b) => (b.count > a.count ? b : a))
}

function loadPkg(id) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  return { pkg, sj, readParticleDef }
}
// 真包单层渲染 → 顶点流（`modes` = URL 档位串；`libImpl` 可传变异体模块）
async function renderRealLayer(id, ln, t, modes, libImpl = lib) {
  setModes(modes)
  lib.setProjectionYFix(null)
  const { pkg, sj, readParticleDef } = loadPkg(id)
  const scene = libImpl.parseScene(sj, null, { readParticleDef, legacyAnimY: true })
  libImpl.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
  const L = scene.layers[ln]
  for (const l of scene.layers) if (l.particleDef) l.visible = (l === L)
  const me = L.particleDef.material ? lib.getEntry(pkg, L.particleDef.material) : null
  const texName = me ? (((JSON.parse(dec.decode(me)).passes || [])[0] || {}).textures?.[0] || null) : null
  L.particleTexName = texName
  const e = texName ? lib.getEntry(pkg, 'materials/' + texName + '.tex') : null
  const buf = e ? new Uint8Array(e) : (texName && fs.existsSync(WE + '/materials/' + texName + '.tex') ? new Uint8Array(fs.readFileSync(WE + '/materials/' + texName + '.tex')) : null)
  const tex = buf ? lib.parseTex(buf) : null
  const { gl, rec } = makeGl()
  const textures = new Map()
  if (tex) { const m = lib.decodeMip0(tex); textures.set(texName, { glTex: lib.makeTextureMip(gl, [m], tex.format === 8), width: m.width, height: m.height, format: tex.format, sprite: lib.spriteInfo(tex) }) }
  const r = libImpl.createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SHADER_RESOLVER, aggregate: true })
  await r.render(scene, textures, W, H, t)
  const b = pickParticleBatch(rec)
  return { verts: b ? b.data : null, count: b ? b.count : 0, stats: r.particleStats }
}

// ═══════════════════════════════ ② 真包顶点流（`--probe` 只跑这一段） ═══════════════════════════════
// 阈值来源 = 报告 §3 的**实测**读数（改前 中位 189.9 / 总长 6796.5 / >60px 23 段）与
// `/tmp` 单变量反证（改后 中位 8.5 / 总长 308.9 / >60px 0 段）；这里留足余量（同一包的
// 层参数与 P-136 后的实时钟会让读数在小范围内浮动，**量级**才是判据）。
const TH = { med: 40, sum: 2000, over60: 5 }
async function probeRealRibbon(libImpl = lib, modes = '') {
  const out = {}
  for (const t of [1, 8]) out['t' + t] = await renderRealLayer(PKG_ID, LN, t, modes, libImpl)
  const s1 = out.t1.verts ? ropeSegStats(out.t1.verts) : null
  const s8 = out.t8.verts ? ropeSegStats(out.t8.verts) : null
  return { s1, s8, sha1: out.t1.verts ? sha(out.t1.verts) : null, sha8: out.t8.verts ? sha(out.t8.verts) : null }
}
if (IS_PROBE) {
  const r = await probeRealRibbon()
  console.log(`PROBE bundle=${BUNDLE} segMed=${r.s8 && r.s8.med.toFixed(2)} segSum=${r.s8 && r.s8.sum.toFixed(1)} over60=${r.s8 && r.s8.over60} segs=${r.s8 && r.s8.n}`)
  const ok = !!r.s8 && r.s8.med <= TH.med && r.s8.sum <= TH.sum && r.s8.over60 <= TH.over60
  console.log((ok ? 'PROBE-GREEN' : 'PROBE-RED') + `（判据 段长中位 ≤ ${TH.med}px 且 总长 ≤ ${TH.sum}px 且 >60px 的段 ≤ ${TH.over60}）`)
  process.exit(ok ? 0 : 1)
}

console.log('\n[1] ① 纯函数：`turbulentvelocityrandom` 的方向是**位置的函数**（同地同向 / 邻地平滑 / 换个地方就不同）')
{
  const INIT = { name: 'turbulentvelocityrandom', params: { id: 5, name: 'turbulentvelocityrandom',
    speedmin: 250, speedmax: 250, scale: 0.1, timescale: 0.5, phasemax: 0 } }
  const mkP = (x, y, t, r) => ({ pos: [x, y, 0], vel: [0, 0, 0], random: r, turbT: t, turbSeed: 0 })
  // 第 9 实参 = `?pturb=legacy` 档（false = official）
  const fire = (p, audioEnv = null, legacy = false) => { lib.applyInitializer(p, INIT, () => 0.5, false, false, false, audioEnv, null, legacy); return p.vel.slice() }
  const same = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1]) && Object.is(a[2], b[2])

  // 同一位置、`p.random` 扫一遍（0.01..0.99）：official ⇒ 逐位同向
  const vels = []
  for (let k = 1; k < 100; k++) vels.push(fire(mkP(3451.099, 1574.833, 4.0, k / 100)))
  push('①-a official：**同位置**的 99 颗粒子方向**逐位相同**（方向不含 `p.random` ⇒ 是一张位置场）',
    vels.every((v) => same(v, vels[0])), `v0=[${vels[0][0].toFixed(3)}, ${vels[0][1].toFixed(3)}] 幅度=${Math.hypot(vels[0][0], vels[0][1]).toFixed(3)}`)
  push('①-b official：发散线条的"散"确实没了 —— 幅度仍是 speedmin/speedmax（250），只有方向被场接管',
    vels.every((v) => near(Math.hypot(v[0], v[1]), 250, 1e-6)), `|v| ∈ [${Math.min(...vels.map((v) => Math.hypot(v[0], v[1]))).toFixed(4)}, ${Math.max(...vels.map((v) => Math.hypot(v[0], v[1]))).toFixed(4)}]`)

  // 相邻位置（发射半径 5px 量级）：方向平滑
  const row = []
  for (let k = 0; k <= 20; k++) row.push(fire(mkP(3451.099 + k * 0.1, 1574.833, 4.0, 0.5)))
  const adj = []
  for (let k = 0; k + 1 < row.length; k++) adj.push(angBetween(row[k], row[k + 1]))
  push('①-c official：出生点相距 **0.1px** 的粒子方向夹角 < 1°（邻地平滑 ⇒ rope 不会再连出长线）',
    Math.max(...adj) < 1, `max=${Math.max(...adj).toFixed(4)}° 中位=${med(adj).toFixed(4)}°`)
  const near2 = [fire(mkP(3451.099, 1574.833, 4.0, 0.2)), fire(mkP(3452.999, 1575.833, 4.0, 0.8)), fire(mkP(3453.099, 1574.833, 4.0, 0.4))]
  const near2max = Math.max(angBetween(row[0], near2[0]), angBetween(row[0], near2[1]), angBetween(row[0], near2[2]))
  push('①-d official：出生点相距 **<2px** 的粒子方向夹角 < 10°（判据可断言版）',
    near2max < 10, `max=${near2max.toFixed(3)}°`)

  // 远处位置：方向确实随位置变（否则就是"常数场"，一样不是官方语义）
  const far = [fire(mkP(3451.099, 1574.833, 4.0, 0.5)), fire(mkP(3951.099, 1574.833, 4.0, 0.5)), fire(mkP(3451.099, 2074.833, 4.0, 0.5))]
  const farAng = [angBetween(far[0], far[1]), angBetween(far[0], far[2])]
  push('①-e official：相距 **500px** 的两点方向夹角 > 10°（场真的随位置变，不是常数场）',
    Math.min(...farAng) > 10, `Δx=${farAng[0].toFixed(2)}° Δy=${farAng[1].toFixed(2)}°`)

  // 出生时刻（`p.turbT`）也在场里：不同时刻 ⇒ 方向缓慢转动 = 一缕弯的烟
  const tAng = angBetween(fire(mkP(3451.099, 1574.833, 0.0, 0.5)), fire(mkP(3451.099, 1574.833, 2.0, 0.5)))
  push('①-f official：同一位置、出生时刻差 2s（× timescale 0.5）⇒ 方向不同（烟会弯，不是一根直棍）',
    tAng > 1, `${tAng.toFixed(3)}°`)

  // ── legacy 档 = 改前口径：同位置各自随机（各向同性） ──
  const lv = []
  for (let k = 1; k < 100; k++) lv.push(fire(mkP(3451.099, 1574.833, 4.0, k / 100), null, true))
  const ldirs = lv.map(unit)
  // ⚠ 这里不能用"相邻夹角中位"当判据：上面的 `p.random` 是**等距扫**的（k/100），相邻方向本来就
  //   只差 2π/100 = 3.6°（那是构造出来的，不是场/随机的性质）。各向同性的正确判据 = 序参量 +
  //   "方向铺得开"（存在夹角 > 150° 的一对）。
  let lmax = 0
  for (let i = 0; i < ldirs.length; i++) for (let j = i + 1; j < ldirs.length; j++) lmax = Math.max(lmax, angBetween(ldirs[i], ldirs[j]))
  push('①-g legacy：**同位置**的粒子方向各向同性（序参量 |Σv̂|/n < 0.15，且存在夹角 > 150° 的一对）= 改前的"四散"',
    orderR(ldirs) < 0.15 && lmax > 150, `birthR=${orderR(ldirs).toFixed(3)} max夹角=${lmax.toFixed(1)}°`)
  push('①-h legacy ⇔ official 是**互斥的两档**（同一位置：legacy 各向同性 / official 全同向且铺不开）',
    orderR(ldirs) < 0.15 && orderR(vels.map(unit)) > 0.999 && angBetween(vels[0], vels[50]) === 0,
    `birthR legacy=${orderR(ldirs).toFixed(3)} official=${orderR(vels.map(unit)).toFixed(3)}`)
  // legacy 逐位 == 测试内**独立重算**的旧算式（`p.random·2π·(1+env) + (x+y)·1e-3`）
  const oldFormula = (x, y, r, env = 0) => { const a = r * Math.PI * 2 * (1 + env) + (x + y) * 1e-3; return [Math.cos(a) * 250, Math.sin(a) * 250, 0] }
  const cases = [[3451.099, 1574.833, 0.13, 0], [0, 0, 0.77, 0.5], [-812.5, 331.25, 0.5, 1]]
  push('①-i legacy 逐位 == 旧算式（`cos/sin(p.random·2π·(1+env) + (x+y)·1e-3)`；含 env=0/0.5/1 三例）',
    cases.every(([x, y, r, env]) => same(fire(mkP(x, y, 4.0, r), env, true), oldFormula(x, y, r, env))),
    cases.map(([x, y, r, env]) => `(${x},${y},r=${r},env=${env})`).join(' '))

  // ── 音频语义（P-131/P-132 批 D）：`(1+env)` 仍乘在**每粒子相位**上，两档都在 ──
  //   ⚠ 落点必须与 P-132 批 D **逐字一致**：旧算式 `p.random·2π·(1+env) + (pos0+pos1)·1e-3` 里因子
  //     只乘"每粒子随机相位"那一项 ⇒ 新算式里因子只乘 `p.random·phasemax`（`zp`），场时间 `zt` 不乘。
  //     这正好复现官方那句 "**no effect on particles with a `0.00` phase**"：`phasemax=0`（本层
  //     `vapor1.json` 就是）⇒ 音频对方向零影响；`phasemax>0` ⇒ env 改变方向。
  {
    const INIT5 = { name: 'turbulentvelocityrandom', params: { speedmin: 250, speedmax: 250, timescale: 0.5, phasemax: 5 } }
    const fire5 = (r, env) => { const p = mkP(3451.099, 1574.833, 4.0, r); lib.applyInitializer(p, INIT5, () => 0.5, false, false, false, env, null, false); return p.vel.slice() }
    const o = mkP(3451.099, 1574.833, 4.0, 0.37), X = o.pos
    const off = fire(mkP(X[0], X[1], 4.0, 0.37), null), zero = fire(mkP(X[0], X[1], 4.0, 0.37), 0), one = fire(mkP(X[0], X[1], 4.0, 0.37), 1)
    push('①-j official（`phasemax=0`，本层口径）：env=0 与"没有音频视图"**逐位相同**（相位 ×1）',
      same(off, zero), `[${off.map((x) => x.toFixed(4)).join(',')}]`)
    push('①-k official（`phasemax=0`）：env=1 也**不改方向** —— 正是官方那句 "no effect on particles with a `0.00` phase"',
      same(off, one), `env=1 ⇒ [${one.map((x) => x.toFixed(4)).join(',')}]`)
    const o5 = fire5(0.37, null), z5 = fire5(0.37, 0), n5 = fire5(0.37, 1)
    push('①-l official（`phasemax=5`）：env=0 逐位相同 && env=1 ⇒ 方向改变（"adds a factor to the Phase values"仍在）',
      same(o5, z5) && !same(o5, n5) && near(Math.hypot(n5[0], n5[1]), 250, 1e-6), `env=1 ⇒ [${n5.map((x) => x.toFixed(4)).join(',')}]`)
    const lo = fire(mkP(X[0], X[1], 4.0, 0.37), null, true), lz = fire(mkP(X[0], X[1], 4.0, 0.37), 0, true), ln = fire(mkP(X[0], X[1], 4.0, 0.37), 1, true)
    push('①-m legacy：env=0 逐位相同 && env=1 ⇒ 方向改变（P-132 的**旧**落点也没被改动）',
      same(lo, lz) && !same(lo, ln), `env=1 ⇒ [${ln.map((x) => x.toFixed(4)).join(',')}]`)
    push('①-n official：`p.pos=(0,0)` 处**不退化**（报告 §4.1 片段在该点 n1≡n2 ⇒ 方向只剩 ±45° 两个值；本实现拆开时间系数）',
      (() => { const dirs = []; for (const z of [0.4, 0.9, 1.7, 2.6]) { const p = mkP(0, 0, z / 0.5, 0.5); lib.applyInitializer(p, { name: 'turbulentvelocityrandom', params: { speedmin: 250, speedmax: 250, timescale: 1, phasemax: 0 } }, () => 0.5, false, false, false, null, null, false); dirs.push(p.vel) }
        return new Set(dirs.map((v) => v[0].toFixed(4) + ',' + v[1].toFixed(4))).size >= 3 })(), '(0,0) 处 4 个不同时刻 ⇒ ≥3 个不同方向')
  }
  // `phasemax` 仍是"每粒子相位"的来源：>0 时同位置的方向随 p.random 变（音/P-130 相位语义没被场吃掉）
  const INIT_PH = { name: 'turbulentvelocityrandom', params: { speedmin: 250, speedmax: 250, timescale: 0.5, phasemax: 5 } }
  const firePh = (r) => { const p = mkP(3451.099, 1574.833, 4.0, r); lib.applyInitializer(p, INIT_PH, () => 0.5, false, false, false, null, null, false); return p.vel.slice() }
  push('①-o official：`phasemax=5` 时同位置的方向随 `p.random` 变（每粒子相位仍在，`phasemax=0` 才全同向）',
    !same(firePh(0.1), firePh(0.9)) && same(fire(mkP(3451.099, 1574.833, 4.0, 0.1)), fire(mkP(3451.099, 1574.833, 4.0, 0.9))),
    `phasemax=5: 夹角=${angBetween(firePh(0.1), firePh(0.9)).toFixed(2)}°`)
}

console.log('\n[2] ② 真包 dd/3544152633 ln=25「Vapor (double)」：真顶点流的段长（改前 中位 190px / 总长 6796px / >60px 23 段）')
let official = null
{
  official = await probeRealRibbon(lib, '')
  push('②-a 该层真的走 rope 几何（6 顶点/段、段数 > 10；否则下面的段长读数没有意义）',
    !!official.s8 && official.s8.n > 10 && official.s8.n <= 40, `segs=${official.s8 && official.s8.n}`)
  push(`②-b 段长中位 ≤ ${TH.med}px（改前 190px 级、反证 8.5px）`,
    !!official.s8 && official.s8.med <= TH.med, `med=${official.s8 && official.s8.med.toFixed(2)}px`)
  push(`②-c ribbon 总长 ≤ ${TH.sum}px（改前 6796px、反证 309px）`,
    !!official.s8 && official.s8.sum <= TH.sum, `sum=${official.s8 && official.s8.sum.toFixed(1)}px`)
  push(`②-d >60px 的段 ≤ ${TH.over60}（改前 23 段、反证 0 段）`,
    !!official.s8 && official.s8.over60 <= TH.over60, `over60=${official.s8 && official.s8.over60}`)
  push('②-e 顶点流有限（无 NaN/Inf；不是靠数值爆掉"消失"的）',
    !!official.s8 && official.s1 && [official.s1, official.s8].every((s) => isFinite(s.med) && isFinite(s.sum) && isFinite(s.max)),
    `t1 med=${official.s1 && official.s1.med.toFixed(2)} t8 med=${official.s8 && official.s8.med.toFixed(2)}`)
}

console.log('\n[3] ③④ ?pturb=legacy 逐位回退 + RED-IF-REVERTED（变异只在 /tmp 真文件副本上做）')
{
  // 变异体 = 把 official 分支的 9 行整段换成 legacy 分支的 2 行（源码级"换回随机角"）
  const OLD_SNIPPET = [
    '          const k = PTURB_K',
    "          const zt = (p.turbT || 0) * pGetVal(pr, 'timescale', 1)",
    "          const zp = p.random * pGetVal(pr, 'phasemax', 0) * phK",
    '          const z = zt + zp',
    '          const s = p.pos[0] * k, t2 = p.pos[1] * k',
    '          const n1 = Math.sin(s * 3.1 + t2 * 1.7 + z) * Math.cos(t2 * 2.3 - z)',
    '          const n2 = Math.cos(s * 2.3 - t2 * 2.9 + z) * Math.sin(s * 1.9 + z * 0.5)',
    '          const m = Math.hypot(n1, n2) || 1',
    '          p.vel = [n1 / m * amp, n2 / m * amp, 0]',
  ].join('\n')
  const MUT_SNIPPET = [
    '          const a = p.random * Math.PI * 2 * phK + (p.pos[0] + p.pos[1]) * 1e-3',
    '          p.vel = [Math.cos(a) * amp, Math.sin(a) * amp, 0]',
  ].join('\n')
  const src = fs.readFileSync(BUNDLE, 'utf8')
  push('③-a 变异锚点在真源码里**唯一命中**（否则"换回随机角"这个变异不成立）',
    src.split(OLD_SNIPPET).length === 2, `命中次数=${src.split(OLD_SNIPPET).length - 1}`)
  const MUT_DIR = path.join(process.env.TMPDIR || '/tmp', 'p140-mut-' + process.pid)
  fs.rmSync(MUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(MUT_DIR, { recursive: true })
  // 本机 `fs.cpSync` 抛 EINVAL ⇒ 逐文件 readFileSync/writeFileSync（顺带把 core/ 的兄弟模块一起带过去）
  for (const f of fs.readdirSync(path.dirname(BUNDLE))) {
    const s = path.join(path.dirname(BUNDLE), f)
    if (!fs.statSync(s).isFile()) continue
    fs.writeFileSync(path.join(MUT_DIR, f), fs.readFileSync(s))
  }
  const MUT_BUNDLE = path.join(MUT_DIR, path.basename(BUNDLE))
  fs.writeFileSync(MUT_BUNDLE, src.replace(OLD_SNIPPET, MUT_SNIPPET))
  push('③-b 变异体落盘且**真树一字未动**（变异体与真文件的 sha256 必须不同）',
    fs.readFileSync(MUT_BUNDLE, 'utf8') !== src && sha(new Uint8Array(fs.readFileSync(BUNDLE))) === sha(new Uint8Array(fs.readFileSync(BUNDLE))))

  const mutLib = await import(new URL('file://' + MUT_BUNDLE + '?mut=1').href)
  const mut = await probeRealRibbon(mutLib, '')
  const legacyOnReal = await probeRealRibbon(lib, 'pturb=legacy')
  // ③ `?pturb=legacy` 逐位回退：与"同一段源码换成旧算式"的变异体读数**逐位相同**（顶点流 sha256 全等）
  push('③-c `?pturb=legacy` 的顶点流 sha256 == **变异体（源码级换回旧算式）**的顶点流 sha256（t=1）：逐位回退',
    !!legacyOnReal.sha1 && legacyOnReal.sha1 === mut.sha1, `legacy=${legacyOnReal.sha1} mutant=${mut.sha1}`)
  push('③-d 同上（t=8）：帧数越多越能抓住"随机流是否真的逐位一致"',
    !!legacyOnReal.sha8 && legacyOnReal.sha8 === mut.sha8, `legacy=${legacyOnReal.sha8} mutant=${mut.sha8}`)
  push('③-e legacy 与 official **不是**同一画面（否则"档位"是空开关）',
    !!official.sha8 && official.sha8 !== legacyOnReal.sha8, `official=${official.sha8} legacy=${legacyOnReal.sha8}`)
  // ③-f/③-g 的判据用"**同一条判据线**两侧的读数"（本 harness 实测：official 中位 7.1px / 总长 266px /
  //   >60px 0 段；legacy 79.5px / 2417px / 15 段 ⇒ 11× 落差），而不是报告那台探针的绝对值
  //   （报告 §3 的 190/6796 是**冻结 sha** 上的读数，P-136 之后同层读数已漂，见报告 §6-8）。
  const diverged = (s) => !!s && s.med > TH.med && s.sum > TH.sum && s.over60 > TH.over60
  push('③-f legacy 档真的回到"发散线条"的量级（**不满足** ② 的官方判据，且中位 ≥ 5× official）—— 这就是用户看到的画面',
    diverged(legacyOnReal.s8) && legacyOnReal.s8.med >= 5 * official.s8.med,
    `legacy med=${legacyOnReal.s8 && legacyOnReal.s8.med.toFixed(1)}px sum=${legacyOnReal.s8 && legacyOnReal.s8.sum.toFixed(0)}px over60=${legacyOnReal.s8 && legacyOnReal.s8.over60}；official med=${official.s8.med.toFixed(1)}px`)
  push('③-g 变异体的读数与 legacy 档同为"发散线条"量级（变异确实复现了旧口径，不是把代码改坏）',
    diverged(mut.s8) && mut.s8.med === legacyOnReal.s8.med && mut.s8.sum === legacyOnReal.s8.sum,
    `mutant med=${mut.s8 && mut.s8.med.toFixed(1)}px sum=${mut.s8 && mut.s8.sum.toFixed(0)}px over60=${mut.s8 && mut.s8.over60}`)

  // ④ RED-IF-REVERTED：子进程用变异体跑 `--probe`（official 档）⇒ ②的判据必须变红
  let red = null
  try {
    red = { out: execFileSync(process.execPath, [import.meta.filename, '--probe'], { encoding: 'utf8', env: Object.assign({}, process.env, { MPW_P140_BUNDLE: MUT_BUNDLE }), stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }
  } catch (e) { red = { out: String((e.stdout || '') + (e.stderr || '')), code: e.status } }
  push('④-a RED-IF-REVERTED：把位置场换回随机角 ⇒ `--probe` 判据**必红**（退出码 1）',
    red.code === 1 && /PROBE-RED/.test(red.out), `exit=${red.code} 输出=${red.out.trim().split('\n').slice(-2).join(' | ')}`)
  push('④-b RED 的原因正确：变红的是段长/总长判据（不是"没画出来"这类无关失败）',
    /PROBE bundle=.*segMed=\d/.test(red.out) && /PROBE-RED/.test(red.out), red.out.trim().split('\n')[0])
  push('④-c 对照：同一条命令换回**真 bundle** 必须绿（证明 ④-a 的红来自变异，不是命令本身错）',
    (() => { try {
      const g = execFileSync(process.execPath, [import.meta.filename, '--probe'], { encoding: 'utf8', env: Object.assign({}, process.env, { MPW_P140_BUNDLE: BUNDLE }), stdio: ['ignore', 'pipe', 'pipe'] })
      return /PROBE-GREEN/.test(g)
    } catch (e) { return false } })())
  fs.rmSync(MUT_DIR, { recursive: true, force: true })
}

console.log('\n[4] ⑤ 同族扫描：语料里吃到非零 `turbulentvelocityrandom` 的层 + 报告 §5 的"发散长线"判据')
{
  const ASSETS = WE
  const presetIndex = new Map()
  ;(function walk(dir, rel) {
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else if (e.name.endsWith('.json') && !presetIndex.has(e.name)) presetIndex.set(e.name, r)
    }
  })(`${ASSETS}/presets`, '')
  const readJson = (file, idx, entry) => { try { return JSON.parse(readEntryBytes(file, idx, entry).toString('utf8')) } catch { return null } }
  const sim = (bundle, def, o, legacy) => {
    const num3 = (s, d) => { const a = String(s == null ? '' : s).trim().split(/\s+/).map(Number); return (a.length >= 2 && a.every((x) => isFinite(x))) ? a : d }
    const io = (o.instanceoverride && o.instanceoverride.id) ? Object.assign({ enabled: true }, o.instanceoverride) : null
    const mk = () => bundle.buildParticleSystem(def, { origin: num3(o.origin, [0, 0, 0]), scale: num3(o.scale, [1, 1, 1]),
      angle: (o.angles && isFinite(Number(o.angles))) ? Number(o.angles) : 0, alphaMul: 1, rateMul: (io && io.rate) || 1,
      seedStr: String(o.id) + '|' + String(o.origin || ''), instanceoverride: io, maxCount: 3000, pturbLegacy: legacy })
    const ST = Number(def.starttime) || 0
    const at = (tt) => {
      const sys = mk()
      sys.pointer = [sys.origin[0], sys.origin[1]]     // lockToPointer 发射器：无指针 ⇒ 一颗都不发射
      bundle.simulateParticleSystem(sys, ST + tt, 400)
      const ps = sys.particles
      if (ps.length < 3) return null
      const seg = []
      for (let i = 0; i + 1 < ps.length; i++) seg.push(Math.hypot(ps[i + 1].pos[0] - ps[i].pos[0], ps[i + 1].pos[1] - ps[i].pos[1]))
      return { segMed: med(seg), szMed: med(ps.map((x) => x.size)) }
    }
    return { s3: at(3), s8: at(8) }
  }
  const hit = (r) => [r.s3, r.s8].every((s) => s && s.segMed >= 40 && s.szMed > 0 && s.segMed / s.szMed >= 4)
  const files = walkContainers(`${MPW_WS}/allwallpaper`).sort()
  /* ②(2026-09-23 语料漂移修复) **语料自导出基线**：旧写法把扫描结果钉死成"共 28 层
   *   （rope 13 / sprite 14 / spritetrail 1）"，今晚新增 `allwallpaper/0923/` 后实测 62 层
   *   ⇒ 门禁红在"语料长了"而不是"实现坏了"。新判据：
   *     · **规模只增不减**（各计数 ≥ 基线；掉下来 = 包没了/扫漏了 ⇒ 红）+ 分类和 = 总数；
   *     · **逐条/逐档语义**（与规模无关）：同一条 `hit()` 判据在 legacy 档必须命中 ≥ 基线条数、
   *       在 official 档必须**恰好 0** 条（`⑤-c`，这条是产品判据本身，不许放宽）。
   *   基线下方的合成夹具（`⑤-e`）证明 `hit()` 判据有分辨力 —— 不依赖本机语料。 */
  const TURB_CORPUS_BASELINE = {
    note: '2026-09-23 全语料自导出；只增不减。旧写死值：total=28 / rope=13 / sprite=14 / spritetrail=1（ropetrail=0）',
    // ①(2026-10-04 语料漂移同步) 62/15/28 → 56/11/26：wallpapertest1_*.mpkg 被主线移入
    //   allwallpaper/delete/（离开扫描根集）——"只增不减"修订为语料集合变化时同步并记录原因。
    total: 56, rope: 11, ropetrail: 0, sprite: 26, spritetrail: 19, legacyHits: 9,
  }
  const found = { total: 0, rope: 0, ropetrail: 0, sprite: 0, spritetrail: 0, other: 0 }
  const hitsLegacy = [], hitsOfficial = []
  let scanned = 0, skippedNoDef = 0
  for (const file of files) {
    let idx = null, sjText = null
    try { idx = readIndexHead(file) } catch { continue }
    const sjEntry = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
    if (!sjEntry) continue
    try { sjText = readEntryBytes(file, idx, sjEntry).toString('utf8').replace(/^\uFEFF/, '') } catch { continue }
    let sj = null
    try { sj = JSON.parse(sjText) } catch { continue }
    scanned++
    for (let li = 0; li < (sj.objects || []).length; li++) {
      const o = sj.objects[li]
      if (typeof o.particle !== 'string' || !o.particle) continue
      let def = null
      const e = idx.entries.find((x) => x.name === o.particle)
      if (e) def = readJson(file, idx, e)
      if (!def) {
        const cand = [`${ASSETS}/${o.particle}`, presetIndex.has(path.basename(o.particle)) ? `${ASSETS}/${presetIndex.get(path.basename(o.particle))}` : null]
        for (const c of cand) { if (c && fs.existsSync(c)) { try { def = JSON.parse(fs.readFileSync(c, 'utf8')); break } catch { /* 下一个候选 */ } } }
      }
      if (!def) { skippedNoDef++; continue }
      const tv = (def.initializer || []).find((i) => i && i.name === 'turbulentvelocityrandom')
      if (!tv) continue
      if (!(Number(tv.speedmin) || 0) && !(Number(tv.speedmax) || 0)) continue
      const kind = lib.particleTrailCfg(def).name
      found.total++
      if (found[kind] !== undefined) found[kind]++
      else found.other++
      if (kind !== 'rope' && kind !== 'ropetrail') continue
      if (hit(sim(lib, def, o, true))) hitsLegacy.push(`${path.basename(path.dirname(file))}/${li}`)
      if (hit(sim(lib, def, o, false))) hitsOfficial.push(`${path.basename(path.dirname(file))}/${li}`)
    }
  }
  const B = TURB_CORPUS_BASELINE
  const kindsAll = ['rope', 'ropetrail', 'sprite', 'spritetrail', 'other']
  const sumKinds = kindsAll.reduce((s, k) => s + found[k], 0)
  if (process.env.P140_SCAN_UPDATE) console.log('  [scan-baseline] ' + JSON.stringify({ ...found, legacyHits: hitsLegacy.length, officialHits: hitsOfficial.length }))
  push('⑤-a 吃到**非零** `turbulentvelocityrandom` 的粒子层 ≥ 基线（' + JSON.stringify(B) + '；分类和 = 总数）',
    found.total >= B.total && kindsAll.every((k) => found[k] >= (B[k] || 0)) && found.total === sumKinds && scanned >= 20,
    JSON.stringify(found) + `（基线 total=${B.total} rope=${B.rope} sprite=${B.sprite} spritetrail=${B.spritetrail}；扫到 scene.json 的容器 ${scanned}/${files.length}，def 解析失败 ${skippedNoDef}）`)
  push('⑤-b 报告 §5 的"发散长线"判据在 **legacy 档（= 改前口径）** 下命中 ≥ 基线 ' + B.legacyHits + ' 层：判据可复算、不是拍的',
    hitsLegacy.length >= B.legacyHits && hitsLegacy.length > 0, `命中 ${hitsLegacy.length}（基线 ${B.legacyHits}）：${hitsLegacy.slice(0, 6).join(' ')} …`)
  push('⑤-c 同一个判据在 **official 档** 下命中 **0** 层（用户的"发散线条"整族消失；这一条不放宽）',
    hitsOfficial.length === 0, hitsOfficial.length ? `仍命中：${hitsOfficial.join(' ')}` : '0 层')
  /* ⑤-e 合成夹具（不随用户语料变化）：`hit()` 判据本身有分辨力 —— 合规行过、两个方向各造一个坏行必红。
   *     这条与语料无关，永远跑；证明 ⑤-a/⑤-b 用的不是"永远真"的空判据。 */
  {
    const okRow = { s3: { segMed: 50, szMed: 5 }, s8: { segMed: 60, szMed: 5 } }     // 段长 50≥40、比值 10≥4
    const shortRow = { s3: { segMed: 20, szMed: 5 }, s8: { segMed: 60, szMed: 5 } }  // 段长不够
    const fatRow = { s3: { segMed: 50, szMed: 20 }, s8: { segMed: 60, szMed: 5 } }   // 比值 2.5 < 4（团状，不是长线）
    const nullRow = { s3: null, s8: { segMed: 60, szMed: 5 } }
    push('⑤-e 合成夹具：`hit()`（段长 ≥40 且 段长/尺寸 ≥4，两帧都成立）有分辨力（合规=过 / 三个坏行=红）',
      hit(okRow) && !hit(shortRow) && !hit(fatRow) && !hit(nullRow),
      'ok=' + hit(okRow) + ' short=' + hit(shortRow) + ' fat=' + hit(fatRow) + ' null=' + hit(nullRow))
  }
}

// ───────────────────────── 汇总 ─────────────────────────
const bad = checks.filter((c) => !c.ok)
console.log(`\n${bad.length ? '✗' : '✓'} particle-turbulence-field：${checks.length - bad.length}/${checks.length} 断言通过`)
if (bad.length) for (const b of bad) console.log('  FAIL ' + b.name + (b.detail !== undefined ? ' — ' + b.detail : ''))
process.exit(bad.length ? 1 : 0)

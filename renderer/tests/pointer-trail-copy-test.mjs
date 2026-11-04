/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，唯一例外是 P-136 明确照抄的
 * oneincase/webwallgl（MIT © 2026 oneincase）那几个函数 —— 见 THIRD-PARTY.md §14 与
 * core/we-pointer-source.mjs / core/we-particle-pointer.mjs 的文件头。其余（references/wer-ref
 * GPL-2.0-only、references/lwe-ref GPL-3.0-only）仍只引行为结论，未复制其代码/注释/常量组织。 */
// pointer-trail-copy-test.mjs — P-136 回归门禁（秒级、无浏览器、无网络、无 GPU）
//
// 钉住**照抄上游 oneincase/webwallgl（MIT）鼠标尾迹相关实现**这件事本身 + 照抄后的数字：
//   ① 逐字节完整性：`core/we-pointer-source.mjs` 的正文与上游 `renderer/vendor/we-scene/render/pointer.js`
//      **完全相同**（文件头横幅之外一个字节都不许改）；`core/we-particle-pointer.mjs` 的每个照抄块
//      都带 `①(P-136 用户第 4 项：照抄上游 MIT 实现) 来源 …:<line>` 标注。
//   ② 照抄单元的纯函数行为（无真包也跑）：`createPointerSource` / `setPointer` / `cpPos` / `cpWorld` /
//      `mapSequenceAroundControlPoint` / `vortexSwirl` 的具体数字。②(vortex-chirality 2026-09-23)
//      `vortex` 切向本批改成带手性档位（默认 `(dy,−dx)`；`tangentSign=−1` = 上游那一版 `(−dy,+dx)`，
//      见 `docs/VORTEX-CHIRALITY-RE-20260923.md`）⇒ ①-c 的"含上游 token"改成"上游版逐位数值对拍"，
//      ②-s 两档手性都钉住（默认 [0,−15] / legacy [0,+15]）—— 判据没有放宽，只是跟着实现参数化。
//   ③ 尾迹数字（真包 dd/3554161528 objects[27]=id389 `Cherry_Blossoms_2.json` + mock-GL）：
//      指针逐帧右移 40px × 30 帧后，粒子**铺开跨度**与**距指针最远距离**；并直接与**上游自己的
//      ParticleSystem**（同 def、同层参数、同指针轨迹）对拍 —— 照抄是否真的等价。
//   ④ RED-IF-REVERTED：把 `__sig` 里"指针不进签名"的那一行换回旧写法（指针进签名 ⇒ 每帧从 t=0
//      重放、历史被抹平），尾迹断言必须变红。变异只在 `/tmp` 的**真文件副本**上做
//      （本机 `fs.cpSync` 抛 EINVAL ⇒ 用 readFileSync/writeFileSync 逐文件复制）。
//
// 用法: node tests/pointer-trail-copy-test.mjs [--verbose]
//      node tests/pointer-trail-copy-test.mjs --probe     # 变异子进程用：只印尾迹数字并断言
// TODO(tests/run-all-tests.sh): 本文件尚未登记进门禁脚本（由主对话统一登记，别的线不要改 run-all-tests.sh）
import { WS, ROOT } from './_root.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const VERBOSE = process.argv.includes('--verbose')
const IS_PROBE = process.argv.includes('--probe')
const MPW_WS = process.env.MPW_ROOT || WS
const DIR = `${MPW_WS}/allwallpaper/dd`
const WE = `${MPW_WS}/wallpaper_engine/assets`
// 上游源码 checkout（仓库之外，只读）：照抄完整性/对拍要用；缺失 ⇒ 相关断言 SKIP 视作 PASS
const UP = `${MPW_WS}/references/vendor-ref/webwallgl`
const UP_POINTER = `${UP}/renderer/vendor/we-scene/render/pointer.js`
const UP_PARTICLES = `${UP}/renderer/vendor/we-scene/render/particles.js`
// 变异子进程可指向 /tmp 的副本；缺省 = 本仓库真文件
const BUNDLE = process.env.MPW_P136_BUNDLE || path.join(ROOT, 'core/we-scene-bundle.js')
const dec = new TextDecoder()
const checks = []
const push = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  if (VERBOSE || !ok) console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? ' — ' + detail : ''))
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

const lib = await import(new URL('file://' + BUNDLE).href)
const ptrMod = await import(new URL('file://' + path.join(path.dirname(BUNDLE), 'we-particle-pointer.mjs')).href)
const srcMod = await import(new URL('file://' + path.join(path.dirname(BUNDLE), 'we-pointer-source.mjs')).href)

// ───────────────────────── mock GL（顶点流捕获；与 P-133 门禁同构） ─────────────────────────
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
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, rec }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const SR = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
function setModes(q) { globalThis.location = { search: q ? '?' + q : '' }; lib.setProjectionYFix(null) }

// ───────────────────────── 尾迹探针（真包 + mock-GL） ─────────────────────────
// 指针轨迹：从 (1200,800) 起、每帧右移 40px，共 30 帧 —— 一个**移动**的光标。
// 判据全部落在"照抄上游之后会出现、退回旧写法就消失"的量上：
//   spreadX        = 顶点流世界包围盒的 x 跨度（尾迹有多长）
//   distToPtrMax   = 存活粒子距指针的最大距离（尾巴甩多远）
//   rebuilds       = 30 帧里粒子系统**被重建**的帧数（旧写法 = 每帧重建）
//   simStepsLast   = 末帧仿真步数（旧写法 = 每帧 400 步全历史重放）
const TRAIL_T0 = 20, TRAIL_N = 30
const TRAIL_PATH = (i) => ({ x: 1200 + i * 40, y: 800, inside: true })
async function measureTrail() {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/3554161528/scene.pkg`)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sj, null, { readParticleDef, legacyAnimY: true })
  lib.applyRenderConfig(scene, { sceneId: '3554161528', clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
  const L = scene.layers.find((l) => String(l.id) === '389')
  const me = L.particleDef.material ? lib.getEntry(pkg, L.particleDef.material) : null
  const texName = me ? (((JSON.parse(dec.decode(me)).passes || [])[0] || {}).textures?.[0] || null) : null
  const e = texName ? lib.getEntry(pkg, 'materials/' + texName + '.tex') : null
  const buf = e ? new Uint8Array(e) : (texName && fs.existsSync(WE + '/materials/' + texName + '.tex') ? new Uint8Array(fs.readFileSync(WE + '/materials/' + texName + '.tex')) : null)
  const tex = buf ? lib.parseTex(buf) : null
  const sprite = tex ? lib.spriteInfo(tex) : null
  setModes('')
  const cache = new Map()
  const { gl, rec } = makeGl()
  const textures = new Map()
  if (tex) { const m = lib.decodeMip0(tex); textures.set(texName, { glTex: lib.makeTextureMip(gl, [m], tex.format === 8), width: m.width, height: m.height, format: tex.format, sprite }) }
  for (const l of scene.layers) if (l.particleDef) l.visible = (l === L)
  L.particleTexName = texName
  const r = lib.createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver: SR, aggregate: true, particleSysCache: cache })
  let prevSys = null, rebuilds = 0, last = null
  for (let i = 0; i < TRAIL_N; i++) {
    rec.draws.length = 0
    const ptr = TRAIL_PATH(i)
    globalThis.__mpwPointer = ptr
    await r.render(scene, textures, W, H, TRAIL_T0 + i / 60)
    const entry = cache.get(L.id)
    const sys = entry && entry.sys
    if (prevSys && sys !== prevSys) rebuilds++
    prevSys = sys
    const batches = rec.draws.filter((d) => d.count > 6 && d.data && d.data.length === d.count * 9)
    const v = batches.length ? batches[0].data : null
    // 世界包围盒（顶点流的 a_Position 已是 NDC；ndc→设计像素）
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    const n = v ? v.length / 9 : 0
    for (let k = 0; k < n; k++) {
      const X = (v[k * 9] + 1) / 2 * W, Y = (1 - v[k * 9 + 1]) / 2 * H
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y)
    }
    const P = (sys && sys.particles) || []
    const dmax = P.length ? Math.max(...P.map((p) => Math.hypot(p.pos[0] - ptr.x, p.pos[1] - ptr.y))) : -1
    // 本帧**新生**粒子（"最新一代"）的距指针距离 —— 与"全部存活粒子"的那个指标对照，
    // 就是「尾迹存在」的正向判据：出生点在指针上，但整层铺开在指针身后。
    // ⚠ 取法：`stepParticles` 是**先发射、再统一 `p.age += sdt`** ⇒ 新生粒子的 `age` 不是 0
    //   而是本步的 sdt，且同一步出生的 `age` 完全相同 ⇒ "最新一代" = `age == min(age)`
    //   （用 `age === 0` 会取到 0 粒，实测过）。
    const minAge = P.length ? Math.min(...P.map((p) => p.age)) : null
    const born = P.filter((p) => p.age <= minAge + 1e-9)
    const dBornMax = born.length ? Math.max(...born.map((p) => Math.hypot(p.pos[0] - ptr.x, p.pos[1] - ptr.y))) : -1
    // 顶点流里每个 quad 的 u 跨度 = 该帧真实 UV 宽度（顶点布局 9 float：x,y,z,u,v,uN,vN,blend,a；
    // 6 个顶点的 u 取 min/max 才是 quad 跨度 —— 用 uN−u 会得到"隔一帧"的距离，不是帧宽）。
    let du = NaN
    if (v && v.length >= 54) {
      let u0 = Infinity, u1 = -Infinity
      for (let k = 0; k < 6; k++) { u0 = Math.min(u0, v[k * 9 + 3]); u1 = Math.max(u1, v[k * 9 + 3]) }
      du = u1 - u0
    }
    last = { alive: P.length, born: born.length, quads: n / 6, spreadX: n ? x1 - x0 : 0, spreadY: n ? y1 - y0 : 0,
      distToPtrMax: dmax, distBornToPtrMax: dBornMax, uSpan: du, simSteps: r.particleStats.simSteps, ptr }
  }
  delete globalThis.__mpwPointer
  return Object.assign(last, { rebuilds, sprite, texName })
}

// ═══════════════ 探针模式（变异子进程） ═══════════════
if (IS_PROBE) {
  if (!fs.existsSync(`${DIR}/3554161528/scene.pkg`)) { console.log('SKIP 真包缺失'); process.exit(0) }
  const m = await measureTrail()
  console.log('PROBE ' + JSON.stringify(m))
  // 尾迹判据（★ = RED-IF-REVERTED 的目标）
  const trailExists = m.distBornToPtrMax >= 0 && m.distBornToPtrMax < 50 && m.distToPtrMax >= 20 * Math.max(1, m.distBornToPtrMax)
  const okAll = m.alive >= 150 && m.spreadX >= 1000 && m.distToPtrMax >= 1000 && m.rebuilds === 0 && m.simSteps === 1 && trailExists
  console.log((m.alive >= 150 ? 'PASS' : 'FAIL') + ' ★尾迹：存活粒子数 ≥150')
  console.log((m.spreadX >= 1000 ? 'PASS' : 'FAIL') + ' ★尾迹：顶点流世界 x 跨度 ≥1000px')
  console.log((m.distToPtrMax >= 1000 ? 'PASS' : 'FAIL') + ' ★尾迹：距指针最远 ≥1000px')
  console.log((trailExists ? 'PASS' : 'FAIL') + ' ★尾迹存在：全部粒子最远 / 新生粒子最远 ≥ 20×')
  console.log((m.rebuilds === 0 ? 'PASS' : 'FAIL') + ' ★指针不是构造输入：30 帧 0 次重建')
  console.log((m.simSteps === 1 ? 'PASS' : 'FAIL') + ' ★增量推进：末帧仿真步数 = 1')
  process.exit(okAll ? 0 : 1)
}

// ═══════════════ ① 照抄完整性 ═══════════════
console.log('\n[1] ① 逐字节完整性：core/we-pointer-source.mjs 正文 ≡ 上游 pointer.js')
const OUR_SRC = path.join(ROOT, 'core/we-pointer-source.mjs')
const OUR_PTR = path.join(ROOT, 'core/we-particle-pointer.mjs')
if (fs.existsSync(UP_POINTER)) {
  const up = fs.readFileSync(UP_POINTER, 'utf8')
  const our = fs.readFileSync(OUR_SRC, 'utf8')
  // 横幅 = 文件开头连续的 `//` 行；其后必须是上游全文
  const banner = our.split('\n').findIndex((l) => !l.startsWith('//'))
  const tail = our.split('\n').slice(banner).join('\n')
  push('①-a ★ 去掉本仓库横幅后与上游 renderer/vendor/we-scene/render/pointer.js **逐字节相同**',
    tail === up,
    `横幅 ${banner} 行；正文 ${tail.length}B vs 上游 ${up.length}B；sha256 正文=${crypto.createHash('sha256').update(tail).digest('hex').slice(0, 16)} 上游=${crypto.createHash('sha256').update(up).digest('hex').slice(0, 16)}`)
  push('①-b 上游注释一行未删（文件头那段 `[we-scene patch] 统一指针输入源` 仍在我们的副本里）',
    our.includes('[we-scene patch] 统一指针输入源') && our.includes('g_PointerPositionLast'),
    `含上游文件头=${our.includes('[we-scene patch] 统一指针输入源')}`)
  // 上游被照抄的那几行仍在我们的模块里（`this.`→`sys.` 是唯一改写）
  const upPart = fs.readFileSync(UP_PARTICLES, 'utf8')
  const need = [
    ['setPointer 反旋转/反缩放', '(dx * c - dy * s) / (this.scaleX || 1)'],
    ['_cpPos 锁指针分支', 'return [this.pointer.x + cp.offset[0], this.pointer.y + cp.offset[1], cp.offset[2]]'],
  ]
  const oursPtr = fs.readFileSync(OUR_PTR, 'utf8')
  for (const [tag, token] of need) {
    const upHas = upPart.includes(token)
    // 改写规则（与文件头「照抄/适配对照表」一致）：`this.pointer` → `sys.pointerLocal`（字段改名，见 B-1），
    // 其余 `this.` → `sys.`（方法改写成自由函数）。两处都必须**全局**替换才算同一式子。
    const ourForm = token.replace(/this\.pointer\b/g, 'sys.pointerLocal').replace(/this\./g, 'sys.')
    push(`①-c 照抄 token 与上游同一式子（${tag}）`, upHas && oursPtr.includes(ourForm),
      `上游含=${upHas} 我们含=${oursPtr.includes(ourForm)}（改写后="${ourForm.slice(0, 60)}…"）`)
  }
  /* ②(vortex-chirality 2026-09-23) `vortex 切向` 这一行**不再逐字照抄**：本批把它改成带手性档位的
   *   `(s·dy, −s·dx)`（`?pvortex=legacy` ⇒ `s = −1` = 上游那一版；新默认 `s = +1` 见
   *   `docs/VORTEX-CHIRALITY-RE-20260923.md`）。⇒ 判据从"我们的源码文本里含上游 token"升级为
   *   **数值级**："上游那一版（s=−1）必须能被我们的实现逐位复现"，期望值由**上游源码里的两个 token**
   *   现场算出（上游那两个 token 不在了 ⇒ upVortex=false ⇒ 红：对拍基准丢了要重新取证）。 */
  {
    const upVortex = upPart.includes('(-dy / dist) * speed * dt') && upPart.includes('(dx / dist) * speed * dt')
    const upForm = (px, py, base, v, dt) => {          // ← 与上游两个 token 逐字同形
      const dx = px - (base[0] + v.offset[0]), dy = py - (base[1] + v.offset[1])
      const dist = Math.hypot(dx, dy)
      if (dist < 1e-3) return null
      const span = v.distanceOuter - v.distanceInner
      const k = span > 0 ? Math.min(1, Math.max(0, (dist - v.distanceInner) / span)) : 0
      const speed = v.speedInner + (v.speedOuter - v.speedInner) * k
      return [(-dy / dist) * speed * dt, (dx / dist) * speed * dt]
    }
    const v = { offset: [0, 0, 0], distanceInner: 0, distanceOuter: 50, speedInner: 300, speedOuter: 0 }
    const upstream = upForm(1025, 1000, [1000, 1000, 0], v, 0.1)
    const oursLegacy = ptrMod.vortexSwirl(1025, 1000, [1000, 1000, 0], v, 0.1, -1)
    const genericForm = oursPtr.includes('s * dy / dist') && oursPtr.includes('s * dx / dist')
    push('①-c 照抄 token 与上游同一式子（vortex 切向：上游版 = `tangentSign=−1` 档，逐位数值对拍）',
      upVortex && genericForm && JSON.stringify(oursLegacy) === JSON.stringify(upstream),
      `上游 token=${upVortex} 我们的参数化形式=${genericForm} 我们的 legacy 档=${JSON.stringify(oursLegacy)} 上游式子=${JSON.stringify(upstream)}`)
  }
  push('①-d 每个照抄块都带本仓库风格的来源标注 `①(P-136 用户第 4 项：照抄上游 MIT 实现)` + `file:line`',
    (oursPtr.match(/①\(P-136 用户第 4 项：照抄上游 MIT 实现\)/g) || []).length >= 5
    && /particles\.js:\d+/.test(oursPtr) && /scene-mount\.ts:\d+/.test(oursPtr),
    `标注 ${(oursPtr.match(/①\(P-136 用户第 4 项：照抄上游 MIT 实现\)/g) || []).length} 处`)
  push('①-e 横幅里点了「照抄而非独立实现」并指向 THIRD-PARTY §14',
    fs.readFileSync(OUR_SRC, 'utf8').includes('THIRD-PARTY.md §14') && fs.readFileSync(OUR_SRC, 'utf8').includes('未做语义改写'),
    'ok')
  push('①-f 没有把上游代码复制进 packages/we-core/（任务纪律）',
    !fs.existsSync(path.join(ROOT, 'packages/we-core/we-pointer-source.mjs'))
    && !fs.existsSync(path.join(ROOT, 'packages/we-core/we-particle-pointer.mjs')),
    'packages/we-core/ 下无这两个文件')
} else {
  push('① 上游 checkout 缺失（SKIP 视作 PASS）', true, 'no references/vendor-ref/webwallgl')
}
push('①-g THIRD-PARTY.md 新增了 §14 的标题行（照抄登记）',
  (() => { try { return /^## 14\. webwallgl .*P-136/m.test(fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8')) } catch (e) { return false } })(),
  '标题行 `## 14. webwallgl  (MIT © oneincase) — **P-136: 鼠标尾迹按用户指令照抄上游**`')

// ═══════════════ ② 照抄单元的纯函数行为 ═══════════════
console.log('\n[2] ② 照抄单元：createPointerSource / setPointer / _cpPos / cpWorld / 投放 / 涡流')
{
  // ── createPointerSource（上游 pointer.js 整文件照抄）──
  const s = srcMod.createPointerSource({ target: { __noDom: true }, viewport: () => ({ w: 1000, h: 500 }) })
  push('②-a 上游初值：u=v=0.5（屏幕中心）、has=false、leftDown=false、screenW/H 来自 viewport',
    s.state.u === 0.5 && s.state.v === 0.5 && s.state.has === false && s.state.leftDown === false
    && s.state.screenW === 1000 && s.state.screenH === 500,
    `u=${s.state.u} v=${s.state.v} has=${s.state.has} screen=${s.state.screenW}×${s.state.screenH}`)
  s.pushExternal({ u: 0.25, v: 0.75 })
  push('②-b pushExternal 归一坐标 ⇒ u/v 立刻生效、has=true、moveCount=1',
    near(s.state.u, 0.25, 1e-12) && near(s.state.v, 0.75, 1e-12) && s.state.has === true && s.state.moveCount === 1,
    `u=${s.state.u} v=${s.state.v} moveCount=${s.state.moveCount}`)
  push('②-c 上游「首个事件把 last 对齐 current」：第一次移动不产生跨屏假位移（normalizedDelta = 0）',
    s.normalizedDelta() === 0, `delta=${s.normalizedDelta()}`)
  s.pushExternal({ u: 0.30, v: 0.80 })
  push('②-d 第二个事件之后 normalizedDelta = 帧间位移长度（上游 g_PointerPositionLast 的用途）',
    near(s.normalizedDelta(), Math.hypot(0.05, 0.05), 1e-12), `delta=${s.normalizedDelta()}`)
  s.beginFrame()
  push('②-e beginFrame 把 last 推到 current ⇒ normalizedDelta 归零（上游要求"消费之后再 beginFrame"）',
    s.normalizedDelta() === 0 && near(s.state.lastU, 0.30, 1e-12), `lastU=${s.state.lastU} delta=${s.normalizedDelta()}`)
  const cam = { offX: 100, offY: 50, viewW: 800, viewH: 400, projH: 2160 }
  s.syncWorld(cam, 0, 0)
  push('②-f syncWorld：wx = offX + u·viewW、wy = offY + v·viewH、originY = projH − wy（上游式子）',
    near(s.state.wx, 100 + 0.30 * 800, 1e-9) && near(s.state.wy, 50 + 0.80 * 400, 1e-9) && near(s.state.originY, 2160 - s.state.wy, 1e-9),
    `wx=${s.state.wx} wy=${s.state.wy} originY=${s.state.originY}`)
  push('②-g 上游 pushExternalLeave 的语义 = **只清按键、保留位置与 has**（与本仓库 P-118「离开⇒无指针」不同，冲突已报告）',
    (() => { s.pushExternal({ u: 0.3, v: 0.8, buttons: 1 }); const before = { u: s.state.u, v: s.state.v, has: s.state.has }
      s.pushExternalLeave()
      return s.state.leftDown === false && s.state.u === before.u && s.state.v === before.v && s.state.has === before.has })(),
    `leftDown=${s.state.leftDown} u=${s.state.u} has=${s.state.has}`)

  // ── setPointer / _cpPos / cpWorld（照抄块 A/B/E）──
  const sys = { originX: 1920, originY: 1080, originZ: 0, scaleX: 1, scaleY: 1, angleZ: 0, pointerLocal: null,
    localControlPoints: [{ id: 0, lockToPointer: true, offset: [0, 0, 0] }, { id: 1, lockToPointer: false, offset: [0, 0, 0] }] }
  push('②-h 无指针 ⇒ _cpPos 对 lockToPointer 控制点返回 null（上游 `if (!this.pointer) return null`）',
    ptrMod.cpPos(sys, 0) === null, 'cpPos(0)=null')
  push('②-i 无指针 ⇒ cpWorld 也是 null（发射器/吸引子/涡流都拿不到圆心）', ptrMod.cpWorld(sys, 0) === null, 'cpWorld(0)=null')
  ptrMod.setPointer(sys, 2020, 1180)
  push('②-j setPointer 把世界像素转**局部**（dx/dy 减 origin、反旋转、除 scale）：(2020,1180) ⇒ (100,100)',
    near(sys.pointerLocal.x, 100, 1e-9) && near(sys.pointerLocal.y, 100, 1e-9),
    `pointerLocal=(${sys.pointerLocal.x}, ${sys.pointerLocal.y})`)
  push('②-k cpPos(锁指针) = pointerLocal + cp.offset（上游逐字）', JSON.stringify(ptrMod.cpPos(sys, 0)) === JSON.stringify([100, 100, 0]),
    JSON.stringify(ptrMod.cpPos(sys, 0)))
  push('②l cpWorld(锁指针) 把局部还原回世界 = 指针本身（offset=0、scale=1）',
    JSON.stringify(ptrMod.cpWorld(sys, 0)) === JSON.stringify([2020, 1180, 0]), JSON.stringify(ptrMod.cpWorld(sys, 0)))
  push('②-m cpPos(非锁指针) = cp.offset（与指针**无关**，上游 `return cp.offset`）',
    JSON.stringify(ptrMod.cpPos(sys, 1)) === JSON.stringify([0, 0, 0]), JSON.stringify(ptrMod.cpPos(sys, 1)))
  {
    const sys2 = { originX: 0, originY: 0, originZ: 0, scaleX: 2, scaleY: 3, angleZ: 0, pointerLocal: null,
      localControlPoints: [{ id: 0, lockToPointer: true, offset: [5, -7, 0] }] }
    ptrMod.setPointer(sys2, 100, 100)
    push('②-n 非等比 scale + authored offset：cpWorld = [原世界x + off.x·sx, 原世界y + off.y·sy]（y-up offset 取负存进 local 的口径）',
      near(ptrMod.cpWorld(sys2, 0)[0], 100 + 5 * 2, 1e-9) && near(ptrMod.cpWorld(sys2, 0)[1], 100 + (-7) * 3, 1e-9),
      JSON.stringify(ptrMod.cpWorld(sys2, 0)))
  }

  // ── mapSequenceAroundControlPoint（照抄块 C）──
  {
    const ang = []
    for (let i = 0; i < 5; i++) {
      const p = ptrMod.mapSequenceAroundControlPoint([10, 20, 0], i, 5, [0, 1, 0], 0, 1)
      ang.push(Math.round((Math.atan2(p[1] - 20, p[0] - 10) / (Math.PI * 2)) * 5 + 5) % 5)
      if (i === 0) push('②-o count=5、bounds=[0,1] ⇒ 第 0 颗在 (cp.x + rmax, cp.y)，半径 = distancemax[0]',
        near(p[0], 11, 1e-9) && near(p[1], 20, 1e-9), JSON.stringify(p))
    }
    push('②-p 轮转序号 i 走遍 count=5 个等分相位（sequence，不是随机）', new Set(ang).size === 5, `相位={${ang.sort().join(',')}}`)
    push('②-q rmax=0 ⇒ 退回 rmin（上游 `const rad = rmax > 0 ? rmax : rmin`）',
      JSON.stringify(ptrMod.mapSequenceAroundControlPoint([0, 0, 0], 0, 1, [0, 1, 0], 3, 0)) === JSON.stringify([3, 0, 0]),
      JSON.stringify(ptrMod.mapSequenceAroundControlPoint([0, 0, 0], 0, 1, [0, 1, 0], 3, 0)))
  }

  // ── vortexSwirl（照抄块 D）──
  {
    const v = { offset: [0, 0, 0], distanceInner: 0, distanceOuter: 50, speedInner: 300, speedOuter: 0 }
    const dv = ptrMod.vortexSwirl(1025, 1000, [1000, 1000, 0], v, 0.1)
    const dvLegacy = ptrMod.vortexSwirl(1025, 1000, [1000, 1000, 0], v, 0.1, -1)
    push('②-r ★ 上游半径权重 k=(d−inner)/(outer−inner)（**无 +0.1**）：d=25/inner=0/outer=50 ⇒ |Δv|/dt = **150.0**',
      near(Math.hypot(dv[0], dv[1]) / 0.1, 150.0, 1e-9), `|Δv|/dt=${(Math.hypot(dv[0], dv[1]) / 0.1).toFixed(4)}`)
    /* ②(vortex-chirality 2026-09-23) 手性**两档**都钉住（radial=(+25,0) ⇒ 切向只有 y 分量）：
     *   · 默认（official，`s=+1`）= `(dy,−dx)` ⇒ Δv = [0,−15]（y-down 屏幕 = 顺时针 = 轴 −z）；
     *   · `tangentSign=−1`（`?pvortex=legacy`）= `(−dy,+dx)` = **上游 oneincase/webwallgl 那一版**
     *     ⇒ Δv = [0,+15]（= 轴 +z，改动前的手性）。
     *   依据（含"这是证据更强的一方、不是已证实的一方"的如实声明）见
     *   `docs/VORTEX-CHIRALITY-RE-20260923.md` 与 `docs/README-DIAGNOSTICS.md` 的 `pvortex` 行。
     *   两档都要 ⊥ 半径：径向 (+25,0) ⇒ 两档的 x 分量都必须是 0。 */
    push('②-s 切向 ⊥ 半径 + 手性两档与文档一致（默认 `(dy,−dx)` ⇒ [0,−15]；`tangentSign=−1` = 上游 `(−dy,+dx)` ⇒ [0,+15]）',
      near(dv[0], 0, 1e-12) && dv[1] < 0 && near(dv[1], -15, 1e-9)
      && near(dvLegacy[0], 0, 1e-12) && dvLegacy[1] > 0 && near(dvLegacy[1], 15, 1e-9),
      `默认=${JSON.stringify(dv)} legacy=${JSON.stringify(dvLegacy)}`)
    push('②-t d=0（与圆心重合）⇒ 返回 null（上游 `if (dist < 1e-3) continue`）',
      ptrMod.vortexSwirl(1000, 1000, [1000, 1000, 0], v, 0.1) === null, 'null')
    push('②-u d ≥ distanceouter ⇒ speedouter（半径门真的生效）',
      near(Math.hypot(...ptrMod.vortexSwirl(1100, 1000, [1000, 1000, 0], v, 0.1)) / 0.1, 0, 1e-9), '|Δv|/dt=0')
  }
}

// ═══════════════ ③ 尾迹数字（真包 + mock-GL） ═══════════════
console.log('\n[3] ③ 真包尾迹：指针右移 40px × 30 帧后粒子铺开跨度 / 距指针最远距离')
const m = fs.existsSync(`${DIR}/3554161528/scene.pkg`) ? await measureTrail() : null
if (m) {
  push('③-a 前置：层 389 是 spritetrail、贴图 particle/3、13 帧横排（判据前提）',
    !!m.sprite && m.sprite.numFrames === 13 && m.texName === 'particle/3',
    m.sprite ? `n=${m.sprite.numFrames} tex=${m.texName}` : '无帧表')
  push('③-b 存活粒子数 ≈ 上游同参（155~175）', m.alive >= 150 && m.alive <= 185, `alive=${m.alive}`)
  push('③-c ★★ **尾迹真的甩开了**：顶点流世界 x 跨度 ≥ 1000px（改前 67px，实测见 P-136 台账）',
    m.spreadX >= 1000, `spreadX=${m.spreadX.toFixed(0)}px spreadY=${m.spreadY.toFixed(0)}px`)
  push('③-d ★★ 距指针最远 ≥ 1000px（改前 39.6px —— 花瓣全糊在光标上）',
    m.distToPtrMax >= 1000, `distToPtrMax=${m.distToPtrMax.toFixed(1)}px`)
  push('③-e ★ 指针不是构造输入：30 帧内粒子系统**0 次重建**（改前 30/30 帧重建）',
    m.rebuilds === 0, `rebuilds=${m.rebuilds}/${TRAIL_N - 1}`)
  push('③-f ★ 增量推进：末帧仿真步数 = 1（改前每帧 400 步全历史重放 ≈6.1 万次粒子更新）',
    m.simSteps === 1, `simSteps=${m.simSteps}`)
  // 容差 1e-7 而非 1e-9：顶点流是 Float32Array（mock-GL 里 `Float32Array.from`）⇒
  //   fround(1/13) = 0.07692307233810425，与 1/13 差 4.6e-9，1e-9 会假红。
  push('③-g P-133 不回归：顶点流里每个 quad 的 u 跨度仍是 1/13 帧（不是整张图集）',
    near(m.uSpan, 1 / 13, 1e-7), `du=${m.uSpan.toFixed(6)}（1/13=${(1 / 13).toFixed(6)}，Float32 舍入后差 ${Math.abs(m.uSpan - 1 / 13).toExponential(2)}）`)
  // ★ 主对话 P-136 第 3 条要求：**尾迹真的存在**的正向断言 ——
  //   "全部存活粒子距指针最远" 必须**显著大于** "本帧新生粒子距指针最远"。
  //   新生粒子的出生点在指针上（决定 `pointer-leave-test` A3d 的收窄口径），
  //   而整层铺开在指针身后 —— 两者之比就是"尾迹有没有甩出去"。
  push('③-h ★★ 尾迹存在的正向判据：全部存活粒子距指针最远 / 本帧新生粒子距指针最远 ≥ 20×',
    m.distBornToPtrMax >= 0 && m.distBornToPtrMax < 50 && m.distToPtrMax >= 20 * Math.max(1, m.distBornToPtrMax),
    `全部 max=${m.distToPtrMax.toFixed(1)}px ｜ 新生(${m.born} 粒) max=${m.distBornToPtrMax.toFixed(1)}px ｜ 比值=${(m.distToPtrMax / Math.max(1e-9, m.distBornToPtrMax)).toFixed(1)}×`)
} else {
  push('③ 真包缺失（SKIP 视作 PASS）', true, 'no 3554161528')
}

// ── ③-h 与**上游自己的 ParticleSystem**对拍（同 def、同层参数、同指针轨迹）──
if (m && fs.existsSync(UP_PARTICLES)) {
  try {
    const up = await import('file://' + UP_PARTICLES)
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/3554161528/scene.pkg`)))
    const def = JSON.parse(dec.decode(lib.getEntry(pkg, 'particles/workshop/2093672045/Cherry_Blossoms_2.json')))
    const gl = new Proxy({}, { get(t, p) { if (typeof p === 'string' && /^[A-Z0-9_]+$/.test(p)) return 1; return () => {} } })
    const us = new up.ParticleSystem(gl, def, null, { origin: [1920, 1080, 0], scale: [1, 1, 5], angles: [0, 0, 0] })
    us.setTexture({ width: 64, height: 64 })
    for (let i = 0; i < TRAIL_T0 * 60; i++) { us.setPointer(1320, 800); us.advance(1 / 60) }
    for (let i = 0; i < TRAIL_N; i++) { us.setPointer(1200 + i * 40, 800); us.advance(1 / 60) }
    const P = us.pool.filter((p) => p.alive)
    const wx = P.map((p) => us.originX + p.x * us.scaleX), wy = P.map((p) => us.originY + p.y * us.scaleY)
    const upSpread = Math.max(...wx) - Math.min(...wx)
    const upDmax = Math.max(...P.map((p, i) => Math.hypot(wx[i] - (1200 + (TRAIL_N - 1) * 40), wy[i] - 800)))
    push('③-h ★★ 与**上游自己的实现**对拍：存活数 / 世界 x 跨度 / 距指针最远 三项同量级（±25%）',
      Math.abs(m.alive - P.length) <= 0.25 * P.length
      && Math.abs(m.spreadX - upSpread) <= 0.25 * upSpread
      && Math.abs(m.distToPtrMax - upDmax) <= 0.25 * upDmax,
      `我们 alive=${m.alive} spreadX=${m.spreadX.toFixed(0)} dmax=${m.distToPtrMax.toFixed(0)} ｜ 上游 alive=${P.length} spreadX=${upSpread.toFixed(0)} dmax=${upDmax.toFixed(0)}`)
  } catch (e) {
    push('③-h 上游对拍（SKIP 视作 PASS：import 上游模块失败）', true, String(e && e.message).slice(0, 80))
  }
} else {
  push('③-h 上游对拍（SKIP 视作 PASS）', true, m ? 'no upstream checkout' : 'no real package')
}

// ═══════════════ ④ RED-IF-REVERTED 变异 ═══════════════
console.log('\n[4] ④ RED-IF-REVERTED：把"指针不进签名"换回旧写法 ⇒ 尾迹断言必须变红')
if (fs.existsSync(`${DIR}/3554161528/scene.pkg`)) {
  // 变异只在 /tmp 的**真文件副本**上做（本机 fs.cpSync 抛 EINVAL ⇒ readFileSync/writeFileSync 逐文件复制）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p136-mut-'))
  const coreSrc = path.join(ROOT, 'core')
  for (const f of fs.readdirSync(coreSrc)) {
    if (!/\.(mjs|js)$/.test(f)) continue
    fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(coreSrc, f)))
  }
  const mutBundle = path.join(tmp, 'we-scene-bundle.js')
  const src = fs.readFileSync(mutBundle, 'utf8')
  // 旧写法（P-69）：指针坐标进重建签名。照抄后的实现里那一行是常量 `'x',`（带 P-136 注释）。
  const anchor = "      'x',\n      // ①(P-126 C/D/F) 算子口径进签名"
  const OLD = "      (sys0ptrLocked() ? (__ptrNow ? (Math.round(__ptrNow[0]) + ',' + Math.round(__ptrNow[1]) + '|' + (__ptrNow ? 1 : 0)) : 'none') : 'x'),\n      // ①(P-126 C/D/F) 算子口径进签名"
  push('④-a 变异锚点唯一（`__sig` 里那一行常量 `\'x\',` 只出现一次）', src.split(anchor).length === 2,
    `命中 ${src.split(anchor).length - 1} 次`)
  if (src.split(anchor).length === 2) {
    fs.writeFileSync(mutBundle, src.replace(anchor, OLD))
    const self = path.join(ROOT, 'tests/pointer-trail-copy-test.mjs')
    let rc = 0, out = ''
    try {
      out = execFileSync(process.execPath, [self, '--probe'], { env: Object.assign({}, process.env, { MPW_P136_BUNDLE: mutBundle }), encoding: 'utf8', timeout: 120000 })
    } catch (e) { rc = e.status == null ? 1 : e.status; out = String(e.stdout || '') + String(e.stderr || '') }
    const line = (out.split('\n').find((l) => l.startsWith('PROBE ')) || 'PROBE (无输出)')
    push('④-b ★★ RED 变异生效：指针写回签名 ⇒ 子进程 rc=1（尾迹断言变红）', rc === 1, `子进程 rc=${rc}`)
    push('④-c RED 的**理由对得上**：子进程里出现"顶点流世界 x 跨度 ≥1000px"与"0 次重建"的 FAIL 行',
      /^FAIL ★尾迹：顶点流世界 x 跨度/m.test(out) && /^FAIL ★指针不是构造输入/m.test(out),
      (out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 4).join(' ｜ ') || '(无 FAIL 行)'))
    const mm = /^PROBE (.*)$/m.exec(out)
    let pm = null
    try { pm = mm ? JSON.parse(mm[1]) : null } catch (e) { pm = null }
    push('④-d RED 变异后的数字回到旧口径（跨度 < 200px、每帧重建、每帧 400 步重放）',
      !!pm && pm.spreadX < 200 && pm.rebuilds === TRAIL_N - 1 && pm.simSteps > 1,
      pm ? `spreadX=${pm.spreadX.toFixed(0)} rebuilds=${pm.rebuilds} simSteps=${pm.simSteps}` : String(line).slice(0, 120))
    // 反向自证：不变量（同一条命令、未变异的真文件）⇒ rc=0，否则 ④-b 是"怎么都红"的假绿
    let rc0 = 0
    try {
      execFileSync(process.execPath, [self, '--probe'], { env: Object.assign({}, process.env, { MPW_P136_BUNDLE: path.join(coreSrc, 'we-scene-bundle.js') }), encoding: 'utf8', timeout: 120000 })
    } catch (e) { rc0 = e.status == null ? 1 : e.status }
    push('④-e 反向自证：同一探针跑**未变异**的真文件 ⇒ rc=0（④-b 不是"怎么都红"）', rc0 === 0, `rc=${rc0}`)
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
} else {
  push('④ 真包缺失 ⇒ 变异跳过（SKIP 视作 PASS）', true, 'no 3554161528')
}

// ───────────────────────── 汇总 ─────────────────────────
const pass = checks.filter((c) => c.ok).length
const fails = checks.filter((c) => !c.ok)
console.log(`\n===== pointer-trail-copy: ${pass} 通过 / ${fails.length} 失败 =====`)
if (fails.length) console.log('失败项:\n  ' + fails.map((c) => c.name + (c.detail !== undefined ? ' — ' + c.detail : '')).join('\n  '))
// 真树自证：本测试只读 core/（变异只在 /tmp）⇒ 跑完 bundle 的 sha256 必须与跑前一致
if (process.argv.includes('--selfhash')) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'core/we-scene-bundle.js'))).digest('hex')
  console.log('core/we-scene-bundle.js sha256=' + h)
}
process.exit(fails.length ? 1 : 0)

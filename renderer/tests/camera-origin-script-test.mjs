// camera-origin-script-test.mjs — ①(P-120) 相机 origin 逐属性脚本：**真渲染路径**的接线判据 (a)-(d) + 红-if-reverted
//
// 复现：node tests/camera-origin-script-test.mjs [--machine] [--no-mutation]
//
// 背景（量化证据见 `tests/camera-script-origin-probe.mjs`，本文件是它的"渲染路径对拍"）：
//   语料里相机对象的 `origin` 是 `{script:…, value:…}` 的那种：②(2026-09-23) 起**运行期发现**，
//   实测 **16 个包**（15 个用同一段 781 字符脚本，sha256 `151da98895ccdaed…`；`0923/3605722997`
//   是另一段脚本），作者原意 = 按用户属性滑块算镜头位置：
//     `value.x = scriptProperties.x * engine.canvasSize.x`（y 同理）。
//   静态 `.value`（编辑器保存时刻的快照）与宿主求值结果差 **Δx −2434.38477 / Δy −725.25116**。
//   渲染器此前只认 `{animation}`（`cameraNode.active`）⇒ 这些包的相机 origin **完全没接线**。
//   ①(P-120) 起：相机解析路径用**既有脚本宿主**（`elysia/scene-scripts.js`）的求值结果代替静态 `.value`。
//
// 本文件的判据（每条都能变红；`--machine` 时额外吐 `P120CHK <id> <pass|fail> <name>` 供变异跑解析）：
//   (a) 发现的脚本相机包（运行期发现；2026-09-23 实测 16 个）：`renderer.cameraOriginScript.value` ==
//       **独立参考求值**（真宿主 + 全场景 + 新缓存）且 ≠ 冻结的静态快照 ⇒ "真的跑了脚本，不是抄 `.value`"
//       （唯一例外 = 脚本求值恰好 == 快照的巧合包，须由独立参考求值证实，见 a3 注释）。
//   (b) 反向不变：语料里**没有脚本**的包（`dd/3554161528` 关键帧 origin、`0917/3509243656` 静态字符串 origin）
//       与"接线关"逐位相同；顺带覆盖"发现的包在 project.json 默认属性下取景逐位不变"。
//   (c) 用户属性变化 ⇒ 相机 origin 跟着变：`project.json` 默认值 vs 把 `x3` 改 0.25 两档对拍
//       （求值 0→960，非满幅层实绘矩形 Δx = −960）。
//   (d) 求值失败（坏脚本 / 坏宿主）⇒ **不抛**，且相机 origin 只有"回退静态快照"或"不施加"两种落点
//       （`d*` 故意写成"变异安全"形式：接线被撤时落点 = 不施加，同样为真 ⇒ 反转后 (d) 仍绿）。
//   (x) 接线期才有的证据（台账 state / 回退计数 / 日志痕迹）；**不**参与"反转后 (b)(d) 仍绿"的判据。
//   (m) 红-if-reverted：/tmp 隔离副本（**真文件副本**）里把接线改回"不跑脚本" ⇒ (a)(c) 必红、(b)(d) 仍绿；
//       同时证明**真树未被改动**（`core/*.js` sha256 + `git status --porcelain` 跑前跑后逐字相同）。
//
// 【只读、无浏览器】只 import `core/we-scene-bundle.js` 与 `elysia/scene-scripts.js`；不改真树任何文件
//   （唯一写盘 = /tmp 下的隔离副本，跑完删掉）。本机无 GPU/WebGL2 且禁止启动浏览器 ⇒ 全部结论都是
//   **数值/矩阵/字符串级**（mock GL + `onLayerDraw` 的实绘矩形），**不含任何像素/成像结论**。
// 【资源纪律】不整包读语料：发现的包走"表头前缀 + scene.json 精确切片"（见 `sliceScene`），
//   只有 2 个对照包真读整包（`dd/3327063360` 60MB、`dd/3554161528` 23MB —— 与 `camera-pose-test` 同一口径）。
//
// 【退出码】0 = 判据全过（含 SKIP）；1 = 有判据红/工具自身出错；2 = 用法错误。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'

const argv = process.argv.slice(2)
for (const a of argv) {
  if (a !== '--machine' && a !== '--no-mutation') { fs.writeSync(2, '用法错误：未知开关 ' + JSON.stringify(a) + '\n用法：node tests/camera-origin-script-test.mjs [--machine] [--no-mutation]\n'); process.exit(2) }
}
const MACHINE = argv.includes('--machine')
const NO_MUTATION = argv.includes('--no-mutation')

// 工具自身出错一律**响亮**报错（不静默 rc=1：本项曾经因为一处未捕获异常只留 3 行输出）
process.on('uncaughtException', (e) => { fs.writeSync(2, 'P120 未捕获异常: ' + ((e && e.stack) || e) + '\n'); process.exit(1) })
process.on('unhandledRejection', (e) => { fs.writeSync(2, 'P120 未处理的 Promise 拒绝: ' + ((e && e.stack) || e) + '\n'); process.exit(1) })

globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')
const host = await import('../elysia/scene-scripts.js')

// ①(P-120) 与 demo.html 同一件事：把**本页已经在用的**脚本宿主交给 bundle 的相机分支。
//   本文件走 `setCameraScriptHost()`（模块注册口）；下面的"坏宿主"用例走 `opts.cameraScriptHost`。
lib.setCameraScriptHost(host)

const MPW_WS = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_WS, 'allwallpaper')
const W = 3840, H = 2160
const CANVAS = { x: W, y: H }          // 与探针同一参考分辨率（脚本的 engine.canvasSize）
const SCRIPT_SHA = '151da98895ccdaed'  // 14 个包同一段脚本（探针实测；本文件用运行期算出的 sha 校验前缀）
const dec = new TextDecoder()

// ───────────────────────── 计票（真计票；`P120CHK` 行供变异跑解析）─────────────────────────
// 输出一律走 `fs.writeSync(1, …)`（**不用 console.log**）：本机实测 `0917/3462491575` 包里的作者脚本
// 会执行 `console.log = () => {}`，而脚本沙箱共享真的 `console` 对象 ⇒ 用 console.log 打的判据输出
// 会被**全局静音**（本文件第一版就这样"跑完只剩 3 行"）。脚本宿主自身的 console 输出也在下面
// `withMutedConsole()` 里被拦下（与 `camera-script-origin-probe.mjs` 同一口径）。
const out = (line) => { try { fs.writeSync(1, line + '\n') } catch (e) { /* stdout 不可写：不拖垮判据 */ } }
let pass = 0, fail = 0, skipN = 0
const fails = []
function check(id, name, ok, detail) {
  if (ok) pass++; else { fail++; fails.push(id + ' ' + name) }
  out((ok ? '  ✓ ' : '  ✗ ') + id + ' ' + name + (detail ? '  [' + detail + ']' : ''))
  out('P120CHK ' + id + ' ' + (ok ? 'pass' : 'fail') + ' ' + name)
}
const skip = (id, name, why) => { skipN++; out('  ↷ SKIP ' + id + ' ' + name + (why ? '  [' + why + ']' : '')); out('P120CHK ' + id + ' skip ' + name) }
const note = (s) => out('  · ' + s)
// 作者脚本的 console 输出既不污染本工具的 stdout，也别让它把 console.log 换掉（换掉了要还原）
const REAL_CONSOLE = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
function withMutedConsole(fn) {
  const restore = () => { for (const k of Object.keys(REAL_CONSOLE)) { try { console[k] = REAL_CONSOLE[k] } catch (e) { /* ignore */ } } }
  for (const k of Object.keys(REAL_CONSOLE)) { try { console[k] = () => {} } catch (e) { /* ignore */ } }
  try { return fn() } finally { restore() }
}
async function withMutedConsoleAsync(fn) {
  const restore = () => { for (const k of Object.keys(REAL_CONSOLE)) { try { console[k] = REAL_CONSOLE[k] } catch (e) { /* ignore */ } } }
  for (const k of Object.keys(REAL_CONSOLE)) { try { console[k] = () => {} } catch (e) { /* ignore */ } }
  try { return await fn() } finally { restore() }
}

// ───────────────────────── mock GL（与 camera-pose-test 同款最小实现）─────────────────────────
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, FRAMEBUFFER_BINDING: 0x8CA6 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function makeMockGL() {
  let curFbo = null, ids = 0
  const Hd = {
    createTexture: () => ({ id: 't' + (++ids) }), createFramebuffer: () => ({ id: 'f' + (++ids) }),
    createBuffer: () => ({ id: 'b' + (++ids) }), createVertexArray: () => ({ id: 'v' + (++ids) }),
    createShader: () => ({ id: 's' + (++ids) }), createProgram: () => ({ id: 'p' + (++ids) }),
    bindVertexArray: () => {}, activeTexture: () => {}, bindTexture: () => {},
    bindFramebuffer: (t, f) => { curFbo = f }, useProgram: () => {}, bindBuffer: () => {},
    bufferData: () => {}, drawArrays: () => {}, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i ? 'a_TexCoord' : 'a_Position', size: i ? 2 : 3 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : 2,
    getUniformLocation: () => ({ u: 1 }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? curFbo : 0),
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {}, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  }
  return new Proxy({}, { get(t, pr) {
    if (pr in Hd) return Hd[pr]
    if (typeof pr === 'string' && /^[A-Z0-9_]+$/.test(pr)) return CONST[pr] !== undefined ? CONST[pr] : 1
    return () => {}
  } })
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0); v_TexCoord=a_TexCoord;}'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor=texture(g_Texture0,v_TexCoord);}'

// ───────────────────────── 包内条目读取（**不整包读**；口径抄自 camera-script-origin-probe.mjs）─────────────────────────
/** 读一个包容器：表头（parsePkg 只依赖表头）+ 想要的条目切片（getEntry）。前缀不够按 4 倍增长。 */
function readContainer(file, want) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    let cap = 1 << 16, pkg = null
    for (;;) {
      const buf = Buffer.alloc(Math.min(cap, size))
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      try { pkg = lib.parsePkg(new Uint8Array(buf.buffer, buf.byteOffset, n)); break } catch (e) {
        if (cap >= (1 << 26)) throw new Error('表头读不出来（已读到 ' + cap + ' 字节）: ' + e.message)
        cap *= 4
      }
    }
    const parts = {}
    for (const name of want) {
      const e = pkg.entries.find((x) => x.name === name)
      if (!e) { parts[name] = null; continue }
      const off = pkg.dataStart + e.offset
      if (off + e.size > size) throw new Error('条目 ' + name + ' 越界')
      const slice = Buffer.alloc(e.size)
      const got = fs.readSync(fd, slice, 0, e.size, off)
      if (got !== e.size) throw new Error('条目 ' + name + ' 只读到 ' + got + '/' + e.size)
      parts[name] = slice
    }
    return { magic: pkg.magic, entries: pkg.entries.length, parts, size }
  } finally { fs.closeSync(fd) }
}
/** 表头切片解析（14 包走这条：只读 64KB 前缀 + scene.json）。 */
function sliceScene(file) {
  const c = readContainer(file, ['scene.json', 'project.json'])
  if (!c.parts['scene.json']) throw new Error('包内没有 scene.json: ' + file)
  const raw = JSON.parse(dec.decode(c.parts['scene.json']).replace(/^\uFEFF/, ''))
  let proj = null
  const onDisk = path.join(path.dirname(file), 'project.json')
  if (fs.existsSync(onDisk)) { try { proj = JSON.parse(fs.readFileSync(onDisk, 'utf8').replace(/^\uFEFF/, '')) } catch { proj = null } }
  if (!proj && c.parts['project.json']) { try { proj = JSON.parse(dec.decode(c.parts['project.json']).replace(/^\uFEFF/, '')) } catch { proj = null } }
  return { raw, proj, entry: () => null, pkg: null }
}
/** 整包读（只在两个对照包上用；口径与 camera-pose-test 的 gpuRects 相同）。 */
function fullScene(file) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const raw = JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, ''))
  let proj = null
  const onDisk = path.join(path.dirname(file), 'project.json')
  if (fs.existsSync(onDisk)) { try { proj = JSON.parse(fs.readFileSync(onDisk, 'utf8').replace(/^\uFEFF/, '')) } catch { proj = null } }
  return { raw, proj, entry, pkg }
}

// ───────────────────────── 相机对象 / 求值 / 渲染 ─────────────────────────
const parseVec = (s) => String(s).trim().split(/\s+/).map(Number)
const vecOf = (node) => {                                  // 测试**自己**的读值口径（不复用 bundle 的，避免两边同一处错）
  const t = (node && typeof node === 'object' && !Array.isArray(node))
    ? ('value' in node ? String(node.value) : (('x' in node) ? (node.x + ' ' + node.y + ' ' + (node.z || 0)) : ''))
    : String(node)
  const p = parseVec(t)
  return p.length ? [p[0], p[1], p[2] || 0] : null
}
const eq3 = (a, b, eps = 1e-9) => !!a && !!b && Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps
const camObjOf = (raw) => (raw.objects || []).find((o) => o && typeof o.camera === 'string')
const propsOf = (proj) => {
  const schema = (proj && proj.general && proj.general.properties) || null
  return schema ? lib.propsDefaults(schema) : null
}
/** 参考求值：**真宿主 + 全场景 + 全新缓存**（独立于 bundle 的相机局部求值）⇒ (a) 的对拍基准。 */
function refHostEval(raw, userProps) {
  const clone = JSON.parse(JSON.stringify(raw))
  const errs = []
  withMutedConsole(() => host.applySceneScripts(clone, 0, {
    renderObjects: clone.objects, userProps: userProps || {}, canvasSize: CANVAS,
    scriptCache: host.createScriptCache(), frametime: 1 / 60,
    onError: (stage, e) => { try { errs.push(stage + ': ' + ((e && e.message) || e)) } catch { /* ignore */ } },
  }))
  const cam = camObjOf(clone)
  return { value: cam ? vecOf(cam.origin) : null, errs, script: cam && cam.origin && typeof cam.origin === 'object' ? String(cam.origin.script || '') : '' }
}
/**
 * 真渲染一帧（`lib.createRenderer` + mock GL + `render`），返回
 * `{ledger, rects, cam, logs, threw, err}`。`rects` 只在 `full` 包上有值（无纹理的层不画）。
 */
async function renderScene(opt) {
  const scn = opt.scene
  const props = (opt.userProps !== undefined) ? opt.userProps : propsOf(scn.proj)
  const scene = lib.parseScene(scn.raw, null, { attachCtx: { readEntry: scn.entry, time: 0 } })
  lib.applyRenderConfig(scene, {
    sceneId: opt.id, refrender: null, anchor: 'refcenter', hideUI: true, hideParticles: true, clearBgFx: true, log: () => {},
    properties: props, propertiesSchema: (scn.proj && scn.proj.general && scn.proj.general.properties) || null,
  })
  const rects = {}
  const logs = []
  const tex = new Map()
  if (scn.pkg) {   // 整包读的对照包：按 camera-pose-test 的口径给每层注入假纹理，层才会真的画
    for (const l of scene.layers) {
      if (!l.image) continue
      try {
        const mj = JSON.parse(dec.decode(scn.entry(l.image))); const mat = lib.resolveMaterial(mj); if (!mat) continue
        const me = scn.entry(mat.materialPath); if (!me) continue
        const M = JSON.parse(dec.decode(me)); const tn = M.passes && M.passes[0] && M.passes[0].textures && M.passes[0].textures[0]
        if (tn) { l.textureName = tn; if (!tex.has(tn)) tex.set(tn, { glTex: { __name: tn, id: 't' }, width: 64, height: 64 }) }
      } catch (e) { /* 该层纹理接不上 → 不画，不影响相机判据 */ }
    }
  }
  const r = lib.createRenderer({ getContext: () => makeMockGL(), width: W, height: H }, {
    onLog: (m) => { logs.push(String(m)) }, shaderResolver: async (rel) => (rel.endsWith('.vert') ? VERT : FRAG), onMeshLayer: () => {},
    trace: false, auditFrames: 0, hideParticles: true, clearBgFx: true, campose: opt.campose, cam: opt.cam,
    cameraScript: { userProps: props, canvasSize: CANVAS },
    ...(opt.cameraScript !== undefined ? { cameraScript: opt.cameraScript } : {}),
    ...(opt.cameraScriptHost !== undefined ? { cameraScriptHost: opt.cameraScriptHost } : {}),
    onLayerDraw: (layer, info) => {
      if (info.width !== W) return
      const nm = String(layer.name || layer.id).slice(0, 18)
      if (rects[nm]) return
      const m = info.mvp
      const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
      const scr = (v, n) => (v * 0.5 + 0.5) * n
      const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
      const x0 = Math.round(scr(Math.min(A[0], B[0]), W)), x1 = Math.round(scr(Math.max(A[0], B[0]), W))
      rects[nm] = { x0, w: x1 - x0, m0: +m[0].toFixed(7), m12: +m[12].toFixed(6) }
    },
  })
  let threw = false, err = ''
  try {
    const t0 = opt.t === undefined ? 0 : opt.t
    await withMutedConsoleAsync(() => r.render(scene, tex, W, H, t0))
    if (opt.repeat) for (let i = 1; i < opt.repeat; i++) await withMutedConsoleAsync(() => r.render(scene, tex, W, H, t0))
  } catch (e) { threw = true; err = (e && e.message) || String(e) }
  return { ledger: r.cameraOriginScript, rects, cam: scene.cameraNode, logs, threw, err }
}
const sameRects = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length || ka.length === 0) return false
  return ka.every((k) => b[k] && a[k].x0 === b[k].x0 && a[k].w === b[k].w && a[k].m0 === b[k].m0)
}

// ════════════════════════════════════════════════════════════════════════════
// ① 语料里的 `origin.script` 相机包 —— **按内容特征在运行期发现**（不与文件名/目录名绑定）
//   ②(2026-09-23 语料漂移修复) 此前这里写死 14 条路径（表来自探针报告）。今晚语料两处变化
//   把这份清单打穿了：①`wallpapertest1/*.mpkg` → `wallpapertest1_*.mpkg` **重命名**（4 条路径
//   不存在 ⇒ SKIP ⇒ 覆盖 14→10）；②新增 `allwallpaper/0923/` 里又有 2 个脚本相机包（漏扫）。
//   ⇒ 改成**发现**：容器 `scene.json` 的 `objects[]` 里 `typeof o.camera === 'string'` 且
//   `o.origin` 是 `{script:<字符串>}` —— 与 `tests/camera-script-origin-probe.mjs` 的命中判据
//   同一行代码。包怎么改名、语料怎么加根都不影响覆盖；"包变少/扫漏了"由下面的基线兜住。
// ════════════════════════════════════════════════════════════════════════════
const CAM_CORPUS_BASELINE = {
  // ①(2026-10-04 语料漂移同步) 基线 16/15/15 → 14/13/13：主线语料整理把 wallpapertest1_*.mpkg 移入
  //   `allwallpaper/delete/`（离开扫描根集，同 package-matrix --absorb-new 的"消失行"纪律）——
  //   其中 2 个是 origin.script 相机包 ⇒ 发现数 16→14、主脚本 15→13、eval≠static 15→13（巧合包 1 不变）。
  //   "只增不减"修订为：**语料集合变化时基线同步并在此记录原因**（发现算法本身按内容特征运行期发现，
  //   不与路径绑定 ⇒ 包改名/移动不影响覆盖，只影响总数）。
  note: '2026-10-04 语料漂移同步（wallpapertest1_* → delete/，16/15/15 → 14/13/13）。更早：2026-09-23 全语料自导出（写死清单 → 发现式）',
  discovered: 14,   // 语料里 origin.script 相机包总数
  mainScript: 13,   // 用主脚本（SCRIPT_SHA）的包数
  notStatic: 13,    // 求值结果与静态快照不同的包数（第 14 个是脚本求值 == 快照的巧合包，见 a3）
}
function discoverScriptCamPkgs() {
  const found = []
  const walk = (d, depth) => {
    if (depth > 3 || !fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) { walk(fp, depth + 1); continue }
      if (!/\.(pkg|mpkg)$/i.test(e.name)) continue
      let raw = null
      try { raw = sliceScene(fp).raw } catch (err) { continue }        // 无 scene.json / 读不了 ⇒ 不是命中
      const cam = camObjOf(raw)
      if (!cam || !cam.origin || typeof cam.origin !== 'object' || typeof cam.origin.script !== 'string') continue
      found.push(path.relative(MPW_WS, fp))
    }
  }
  walk(CORPUS, 0)
  return found.sort()
}
const SCRIPT_CAM_PKGS = discoverScriptCamPkgs()
const NO_SCRIPT_PKGS = {
  anim: 'allwallpaper/dd/3554161528/scene.pkg',       // origin = {animation:…}（语料唯一关键帧相机）
  stat: 'allwallpaper/0917/3509243656/scene.pkg',     // origin = "0 0 6"（静态字符串；语料唯一 3D/透视包）
}

// ════════════════════════════════════════════════════════════════════════════
// ② (a) 发现的脚本相机包：相机 origin == 宿主求值结果（且 ≠ 静态快照）
// ════════════════════════════════════════════════════════════════════════════
out('\n══ (a) 发现的 `origin.script` 相机包（' + SCRIPT_CAM_PKGS.length + ' 个，运行期发现）：渲染路径的相机 origin == 宿主求值结果 ══')
{
  let okPackages = 0, evalOK = 0, notStatic = 0, coincidences = 0, missing = 0
  const shaGroups = new Map()   // 脚本 sha → 包 id 列表（a5：逐段脚本点名）
  for (const rel of SCRIPT_CAM_PKGS) {
    const file = path.join(MPW_WS, rel)
    const id = rel.replace(/^allwallpaper\//, '').replace(/\/(scene\.pkg|[^/]+\.mpkg)$/i, '')   // 与探针 pkgIdOf 同口径
    if (!fs.existsSync(file)) { missing++; skip('a', id + ' 包不存在（语料变了）', rel); continue }
    let scn = null
    try { scn = sliceScene(file) } catch (e) { missing++; skip('a', id + ' 读包失败', e.message); continue }
    const camRaw = camObjOf(scn.raw)
    const srcLen = camRaw && camRaw.origin && typeof camRaw.origin === 'object' && typeof camRaw.origin.script === 'string' ? camRaw.origin.script.length : 0
    if (!srcLen) { missing++; skip('a', id + ' 该包的相机 origin 不是脚本（语料变了）', 'script len=' + srcLen); continue }
    const sha16 = crypto.createHash('sha256').update(camRaw.origin.script).digest('hex').slice(0, 16)
    if (!shaGroups.has(sha16)) shaGroups.set(sha16, [])
    shaGroups.get(sha16).push(id)
    const ref = refHostEval(scn.raw, propsOf(scn.proj))
    const r = await renderScene({ id, scene: scn })
    const led = r.ledger
    const ledVec = led && led.value ? led.value : null
    okPackages++
    check('a1', id + ' 渲染路径有相机 origin 脚本台账且 state=ok', !!(led && led.state === 'ok'), led ? ('state=' + led.state + (led.why ? ' why=' + led.why : '')) : 'ledger=null')
    if (ledVec && ref.value && eq3(ledVec, ref.value, 1e-6)) evalOK++
    check('a2', id + ' 相机 origin 逐分量 == 独立参考求值 ' + JSON.stringify(ref.value), !!(ledVec && ref.value && eq3(ledVec, ref.value, 1e-6)), 'not台=' + JSON.stringify(ledVec) + ' 参考=' + JSON.stringify(ref.value))
    const st = r.cam && r.cam.originStatic ? r.cam.originStatic : null
    const notStaticPkg = !!(ledVec && st && !eq3(ledVec, st, 1e-6))
    if (notStaticPkg) notStatic++
    /* ②(2026-09-23) 例外要**被第二条独立路径证实**才允许：`0923/3605722997` 的脚本在默认属性下算出的
     *   origin 恰好与静态快照数值相同（Δ=0）⇒ "≠ 快照"对它不可能成立（这不是回归，是巧合）。
     *   落点 = "≠ 快照" **或** "独立参考求值也 == 快照"。变异体里 `ledVec` 为 null ⇒ 仍必然红，
     *   所以 m4「逐包判据全红」不受影响。 */
    const coincident = !!(ledVec && st && eq3(ledVec, st, 1e-6) && ref.value && eq3(ref.value, st, 1e-6))
    if (coincident) coincidences++
    check('a3', id + ' 相机 origin ≠ 冻结静态快照 ' + JSON.stringify(st) + (coincident ? '（本包脚本求值 == 快照，独立参考求值同值 ⇒ 记为巧合，不算回归）' : ''),
      !!(ledVec && st && (notStaticPkg || coincident)), '静态=' + JSON.stringify(st) + ' Δx=' + (ledVec && st ? (ledVec[0] - st[0]).toFixed(5) : '-'))
  }
  const mainPkgs = shaGroups.get(SCRIPT_SHA) || []
  const otherGroups = [...shaGroups.entries()].filter(([k]) => k !== SCRIPT_SHA)
  note('脚本分组：' + [...shaGroups.entries()].map(([k, v]) => k + '×' + v.length).join(' | '))
  check('a4', '(a) 覆盖 ' + CAM_CORPUS_BASELINE.discovered + '+ 个包（自导出基线）且逐包求值成功',
    okPackages >= CAM_CORPUS_BASELINE.discovered && evalOK === okPackages && missing === 0,
    '包=' + okPackages + '（基线 ' + CAM_CORPUS_BASELINE.discovered + '） 求值对齐=' + evalOK + ' 跳过=' + missing)
  check('a5', '(a) 主脚本（sha256 前缀 ' + SCRIPT_SHA + '）覆盖 ≥ ' + CAM_CORPUS_BASELINE.mainScript + ' 个包；其余脚本逐段点名且同样跑了 a1/a2/a3',
    !!SCRIPT_SHA && mainPkgs.length >= CAM_CORPUS_BASELINE.mainScript && otherGroups.every(([, v]) => v.length > 0),
    [...shaGroups.entries()].map(([k, v]) => k + '×' + v.length + (k === SCRIPT_SHA ? '(主)' : '')).join(',')
    + (otherGroups.length ? '；非主脚本：' + otherGroups.map(([k, v]) => k + ' → ' + v.join('/')).join(' ') : ''))
  check('a6', '(a) 求值结果 != 静态快照的包数 ≥ ' + CAM_CORPUS_BASELINE.notStatic + '，且每个包要么"≠快照"要么"巧合（参考求值同值）"（没有解释不了的包）',
    notStatic >= CAM_CORPUS_BASELINE.notStatic && notStatic + coincidences === okPackages,
    notStatic + '/' + okPackages + '（基线 ' + CAM_CORPUS_BASELINE.notStatic + '；巧合包 ' + coincidences + '）')
}

// ════════════════════════════════════════════════════════════════════════════
// ③ (c) 用户属性变化 ⇒ 相机 origin 跟着变（+ 默认属性下取景逐位不变）
//    用整包真读的 `dd/3327063360`（= 任务书点名的代表例，60MB，camera-pose-test 同款口径）
// ════════════════════════════════════════════════════════════════════════════
out('\n══ (c) 用户属性 → 相机 origin：project.json 默认值 vs x3=0.25 ══')
{
  const rel = 'allwallpaper/dd/3327063360/scene.pkg'
  const file = path.join(MPW_WS, rel)
  if (!fs.existsSync(file)) { skip('c', '缺包 ' + rel, '') } else {
    const scn = fullScene(file)
    const p0 = propsOf(scn.proj)
    const p1 = Object.assign({}, p0, { x3: 0.25 })
    const ref0 = refHostEval(scn.raw, p0), ref1 = refHostEval(scn.raw, p1)
    const r0 = await renderScene({ id: 'dd/3327063360', scene: scn, userProps: p0 })
    const r1 = await renderScene({ id: 'dd/3327063360', scene: scn, userProps: p1 })
    const off = await renderScene({ id: 'dd/3327063360', scene: scn, userProps: p0, cameraScript: 'off' })
    const v0 = r0.ledger && r0.ledger.value, v1 = r1.ledger && r1.ledger.value
    note('默认 userProps：求值 ' + JSON.stringify(v0) + ' / 参考 ' + JSON.stringify(ref0.value) + ' / 静态 ' + JSON.stringify(r0.cam && r0.cam.originStatic))
    note('x3=0.25    ：求值 ' + JSON.stringify(v1) + ' / 参考 ' + JSON.stringify(ref1.value))
    check('c1', '默认用户属性 ⇒ 求值结果 == 参考求值 ' + JSON.stringify(ref0.value), !!(v0 && ref0.value && eq3(v0, ref0.value, 1e-6)), 'not台=' + JSON.stringify(v0))
    check('c2', '默认用户属性 ⇒ **取景逐位不变**（与"接线关"的实绘矩形逐值相同）', sameRects(r0.rects, off.rects), Object.keys(r0.rects).length + ' 层')
    check('c3', '改一个用户属性（x3 0→0.25）⇒ 相机 origin 跟着变：' + JSON.stringify(ref0.value) + ' → ' + JSON.stringify(ref1.value),
      !!(v0 && v1 && !eq3(v0, v1, 1e-9) && ref1.value && eq3(v1, ref1.value, 1e-6)), 'Δ=' + (v0 && v1 ? (v1[0] - v0[0]) : '-'))
    const moved = Object.keys(r0.rects).filter((k) => r1.rects[k] && r1.rects[k].x0 !== r0.rects[k].x0)
    const dx = moved.length ? r1.rects[moved[0]].x0 - r0.rects[moved[0]].x0 : null
    check('c4', '改属性后**取景真的跟着动**：非满幅层 Δx == −960（' + moved.length + ' 层位移）',
      moved.length > 0 && moved.every((k) => r1.rects[k].x0 - r0.rects[k].x0 === -960) && dx === -960, moved.slice(0, 3).map((k) => k + ' Δx=' + (r1.rects[k].x0 - r0.rects[k].x0)).join(' | '))
    const rRep = await renderScene({ id: 'dd/3327063360', scene: scn, userProps: p0, repeat: 2 })
    const ev = rRep.cam && rRep.cam.originEvalStats ? rRep.cam.originEvalStats.evals : -1
    check('c5', '同签名连渲两帧只求值一次（第二次 cached=true）⇒ 重算是"按输入签名"不是每帧无脑跑', ev === 1 && rRep.ledger && rRep.ledger.cached === true, 'evals=' + ev + ' cached=' + (rRep.ledger && rRep.ledger.cached))
    // 第二个输入：**canvasSize**（脚本里的 `engine.canvasSize`）。x3=0.5 时 0.5×3840=1920 vs 0.5×1920=960
    const p2 = Object.assign({}, p0, { x3: 0.5 })
    const refBig = refHostEval(scn.raw, p2)                                             // 参考口径固定 3840×2160（CANVAS）
    const rBig = await renderScene({ id: 'dd/3327063360', scene: scn, cameraScript: { userProps: p2, canvasSize: { x: 3840, y: 2160 } } })
    const rSmall = await renderScene({ id: 'dd/3327063360', scene: scn, cameraScript: { userProps: p2, canvasSize: { x: 1920, y: 1080 } } })
    const vBig = rBig.ledger && rBig.ledger.value, vSmall = rSmall.ledger && rSmall.ledger.value
    check('c6', 'canvasSize 变化 ⇒ 相机 origin 跟着重算（x3=0.5：3840→1920 / 1920→960，与参考求值同值）',
      !!(vBig && vSmall && Math.abs(vBig[0] - 1920) < 1e-6 && Math.abs(vSmall[0] - 960) < 1e-6 && refBig.value && Math.abs(refBig.value[0] - 1920) < 1e-6),
      '3840 画布=' + JSON.stringify(vBig) + ' 1920 画布=' + JSON.stringify(vSmall) + ' 参考(3840)=' + JSON.stringify(refBig.value))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ④ (b) 反向：**没有脚本**的包逐值不变
// ════════════════════════════════════════════════════════════════════════════
out('\n══ (b) 反向：无脚本相机包（关键帧 / 静态字符串）逐值不变；无脚本字段的包相机节点为 null ══')
{
  const rel = NO_SCRIPT_PKGS.anim
  const file = path.join(MPW_WS, rel)
  if (!fs.existsSync(file)) { skip('b', '缺包 ' + rel, '') } else {
    const scn = fullScene(file)
    const on = await renderScene({ id: 'dd/3554161528', scene: scn })
    const off = await renderScene({ id: 'dd/3554161528', scene: scn, cameraScript: 'off' })
    check('b1', 'dd/3554161528（关键帧 origin）接线开/关的实绘矩形**逐位相同**', sameRects(on.rects, off.rects), Object.keys(on.rects).length + ' 层')
    check('b2', 'dd/3554161528 相机节点仍是"关键帧驱动"（active=true）且**没有** origin 脚本字段',
      !!(on.cam && on.cam.active === true && !on.cam.originScriptSrc && !on.cam.originScriptAnchor), 'active=' + (on.cam && on.cam.active) + ' src=' + (on.cam && on.cam.originScriptSrc))
    // 该包 origin 是 `{animation:…}`（没有 script 字段）⇒ P-120 的相机脚本分支**根本不进**：
    // 台账在"接线开"与"接线关"两档都必须是 null（进了就是判据漂了）。
    check('b3', 'dd/3554161528 两档都没有相机 origin 脚本台账（P-120 分支不进）', on.ledger === null && off.ledger === null, 'on=' + JSON.stringify(on.ledger) + ' off=' + JSON.stringify(off.ledger))
  }
  const rel2 = NO_SCRIPT_PKGS.stat
  const file2 = path.join(MPW_WS, rel2)
  if (!fs.existsSync(file2)) { skip('b', '缺包 ' + rel2, '') } else {
    const scn2 = sliceScene(file2)
    const r = await renderScene({ id: '0917/3509243656', scene: scn2 })
    const cam0 = r.cam
    const cam = lib.buildCamera(lib.parseScene(scn2.raw, null, { attachCtx: { readEntry: () => null, time: 0 } }), W, H, {})
    check('b4', '0917/3509243656（静态字符串 origin）没有 origin 脚本字段、无台账', !!(!cam0.originScriptSrc && r.ledger === null), 'src=' + (cam0 && cam0.originScriptSrc) + ' ledger=' + JSON.stringify(r.ledger))
    check('b5', '0917/3509243656 冻结静态快照仍等于作者原文 "0 0 6"（逐值不变）', eq3(cam0.originStatic, [0, 0, 6], 1e-9), JSON.stringify(cam0.originStatic))
    check('b6', '0917/3509243656 透视档仍按**作者静态 origin** 节点锚定（projKind=persp / anchor=node / dist=6）',
      cam.projKind === 'persp' && cam.projAnchor === 'node' && Math.abs(cam.perspDist - 6) < 1e-9, 'kind=' + cam.projKind + ' anchor=' + cam.projAnchor + ' dist=' + cam.perspDist)
  }
  const rel3 = 'allwallpaper/dd/3544152633/scene.pkg'
  const file3 = path.join(MPW_WS, rel3)
  if (!fs.existsSync(file3)) { skip('b', '缺无相机节点的对照包 dd/3544152633', '') } else {
    const scn3 = sliceScene(file3)
    const r = await renderScene({ id: 'dd/3544152633', scene: scn3 })
    check('b7', '无相机节点的包：cameraNode===null 且不产生任何相机 origin 台账', r.cam === null && r.ledger === null, 'cam=' + r.cam + ' ledger=' + JSON.stringify(r.ledger))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ⑤ (d) 求值失败 ⇒ 回退静态快照且**不抛**（坏脚本 / 坏宿主）
//    `d*` 一律写成"变异安全"形式：接线被撤时落点 = 不施加，同样为真 ⇒ 反转后 (d) 仍绿（见 (m)）。
//    `x*` 是**接线期才有**的痕迹证据（台账 state / 回退计数 / 日志），不参与"反转后仍绿"的判据。
// ════════════════════════════════════════════════════════════════════════════
out('\n══ (d) 坏脚本 / 坏宿主：不抛 + 只可能"回退静态快照"或"不施加" ══')
{
  const rel = 'allwallpaper/dd/3327063360/scene.pkg'
  const file = path.join(MPW_WS, rel)
  if (!fs.existsSync(file)) { skip('d', '缺包 ' + rel, '') } else {
    const scn = fullScene(file)
    // 坏脚本：在原文脚本尾部接一段语法错误（编译失败 ⇒ 宿主 entry.error）
    const badRaw = JSON.parse(JSON.stringify(scn.raw))
    const badCam = camObjOf(badRaw)
    badCam.origin.script = String(badCam.origin.script) + '\nthis is not valid javascript (((\n'
    const badScene = { raw: badRaw, proj: scn.proj, entry: scn.entry, pkg: scn.pkg }
    const rBad = await renderScene({ id: 'bad-script', scene: badScene })
    const badStatic = rBad.cam ? rBad.cam.originStatic : null
    const applied = rBad.ledger ? rBad.ledger.value : null
    check('d1', '坏脚本：renderScene **不抛**且落点 ∈ {回退静态快照, 不施加}', rBad.threw === false && (applied === null || eq3(applied, badStatic, 1e-9)),
      'threw=' + rBad.threw + (rBad.err ? ' err=' + rBad.err : '') + ' 应用=' + JSON.stringify(applied) + ' 静态=' + JSON.stringify(badStatic))
    check('d2', '坏脚本：落点绝无第三种可能（半成品/NaN 都会红）',
      rBad.threw === false && (applied === null ? true : (eq3(applied, badStatic, 1e-9) && !!badStatic)), JSON.stringify(applied))
    // 坏宿主：applySceneScripts 直接抛
    const badHost = { applySceneScripts: () => { throw new Error('P-120 坏宿主（测试夹具）') }, createScriptCache: () => ({ map: new Map(), shared: {} }) }
    const rHost = await renderScene({ id: 'bad-host', scene: scn, cameraScriptHost: badHost })
    const applied2 = rHost.ledger ? rHost.ledger.value : null
    const static2 = rHost.cam ? rHost.cam.originStatic : null
    check('d3', '坏宿主（applySceneScripts 抛）：renderScene **不抛**且落点 ∈ {回退静态快照, 不施加}',
      rHost.threw === false && (applied2 === null || eq3(applied2, static2, 1e-9)), 'threw=' + rHost.threw + ' 应用=' + JSON.stringify(applied2))
    // x*：接线期的可观测痕迹（台账 + 计数 + 日志）
    if (rBad.ledger) {
      check('x1', '坏脚本：台账 state=' + rBad.ledger.state + '（static/error）且回退计数 ≥1',
        (rBad.ledger.state === 'static' || rBad.ledger.state === 'error') && rBad.ledger.fallbacks >= 1 && eq3(rBad.ledger.value, badStatic, 1e-9),
        'state=' + rBad.ledger.state + ' fallbacks=' + rBad.ledger.fallbacks + ' why=' + String(rBad.ledger.why).slice(0, 60))
      check('x2', '坏脚本：日志里有一条 P-120 的失败痕迹（不是静默回退）', rBad.logs.some((m) => m.indexOf('P-120') >= 0 && m.indexOf('回退静态快照') >= 0), rBad.logs.filter((m) => m.indexOf('P-120') >= 0).slice(0, 1).join(''))
    } else note('x1/x2（接线期的痕迹判据）在本副本里不适用：接线被撤 ⇒ 没有台账 —— 见 (m) 的隔离副本证据')
    if (rHost.ledger) {
      check('x3', '坏宿主：台账 state=' + rHost.ledger.state + '（static/error）且 value == 静态快照',
        (rHost.ledger.state === 'static' || rHost.ledger.state === 'error') && eq3(rHost.ledger.value, static2, 1e-9),
        'state=' + rHost.ledger.state + ' why=' + String(rHost.ledger.why).slice(0, 60))
    } else note('x3 在本副本里不适用（无台账）')
    // 开关：显式 'off' ⇒ 保持不施加（回到改动前），且台账留下原因
    const rOff = await renderScene({ id: 'switch-off', scene: scn, cameraScript: 'off' })
    check('x4', "开关 opts.cameraScript='off' ⇒ 不施加（落点 = null）且台账 state='off'",
      rOff.ledger !== null && rOff.ledger.state === 'off' && rOff.ledger.value === null, 'state=' + (rOff.ledger && rOff.ledger.state))
    // 无用户属性表 ⇒ 不施加（不套用编辑器残留；改动前行为）
    const rNoUp = await renderScene({ id: 'no-userprops', scene: scn, cameraScript: {} })
    check('x5', '没有用户属性表 ⇒ 不施加（state=nouserprops；绝不套用静态残留）',
      rNoUp.ledger !== null && rNoUp.ledger.state === 'nouserprops' && rNoUp.ledger.value === null, 'state=' + (rNoUp.ledger && rNoUp.ledger.state))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ⑥ (m) 红-if-reverted：/tmp 隔离副本（真文件副本）里把接线改回"不跑脚本"
// ════════════════════════════════════════════════════════════════════════════
if (!NO_MUTATION) {
  out('\n══ (m) 红-if-reverted：隔离副本改回"不跑脚本" ⇒ (a)(c) 必红、(b)(d) 仍绿 ══')
  const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const gitStatus = () => {
    const r = spawnSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8', timeout: 30000 })
    return (r.stdout || '') + (r.stderr || '')
  }
  const realShaBefore = sha(BUNDLE)
  const realStatusBefore = gitStatus()
  const coreShasBefore = fs.readdirSync(path.join(ROOT, 'core')).sort().map((f) => f + ':' + sha(path.join(ROOT, 'core', f))).join('\n')
  // 真文件副本（**不用 fs.cpSync**：本机 fs.cpSync 抛 EINVAL；类型判据一律 statSync，不用 Dirent.isFile()）
  const copyTree = (src, dst) => {
    let st = null
    try { st = fs.statSync(src) } catch { return 0 }
    if (st.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true })
      let n = 0
      for (const name of fs.readdirSync(src)) {
        if (name === 'node_modules' || name === '.git' || name === 'reports') continue
        n += copyTree(path.join(src, name), path.join(dst, name))
      }
      return n
    }
    if (!st.isFile()) return 0
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, fs.readFileSync(src))
    return 1
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p120-mutant-'))
  try {
    let copied = 0
    copied += copyTree(path.join(ROOT, 'core'), path.join(tmp, 'core'))
    copied += copyTree(path.join(ROOT, 'elysia'), path.join(tmp, 'elysia'))
    copied += copyTree(path.join(ROOT, 'tests', '_root.mjs'), path.join(tmp, 'tests', '_root.mjs'))
    copied += copyTree(path.join(ROOT, 'tests', 'camera-origin-script-test.mjs'), path.join(tmp, 'tests', 'camera-origin-script-test.mjs'))
    copied += copyTree(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'))
    note('隔离副本 = ' + tmp + '（真文件副本 ' + copied + ' 个文件；不含 node_modules/reports/语料）')
    // 入口脚本必须是**真文件副本**（不是软链/硬链共享）：inode 不同 + 内容 sha256 相同
    const cTest = path.join(tmp, 'tests', 'camera-origin-script-test.mjs')
    const rTest = path.join(ROOT, 'tests', 'camera-origin-script-test.mjs')
    check('m1', '隔离副本的入口脚本是真文件副本（inode 不同且内容 sha256 相同）',
      fs.statSync(cTest).ino !== fs.statSync(rTest).ino && sha(cTest) === sha(rTest), 'ino ' + fs.statSync(cTest).ino + ' vs ' + fs.statSync(rTest).ino)
    // 变异：把接线改回"不跑脚本"（把 origin 脚本分支的守卫置 false —— 一行、最小面）
    const cBundle = path.join(tmp, 'core', 'we-scene-bundle.js')
    const src = fs.readFileSync(cBundle, 'utf8')
    const anchor = "} else if (__camposeMode === 'full' && !force && camNode.originScriptSrc) {"
    const hits = src.split(anchor).length - 1
    check('m2', '变异点存在且唯一（`originScriptSrc` 相机分支守卫）', hits === 1, '命中 ' + hits + ' 次')
    if (hits === 1) {
      fs.writeFileSync(cBundle, src.split(anchor).join("} else if (false && __camposeMode === 'full' && !force && camNode.originScriptSrc) {   // 变异 M：接线改回\"不跑脚本\""))
      // 子进程：隔离副本里跑同一套判据（--no-mutation 防递归；--machine 取逐条状态）
      const env = Object.assign({}, process.env, { MPW_ROOT: MPW_WS, MPW_REPO_ROOT: tmp })
      const child = spawnSync(process.execPath, [cTest, '--machine', '--no-mutation'], { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024, env })
      const out = String(child.stdout || '') + String(child.stderr || '')
      const rootLine = (out.match(/^P120ROOT (.*)$/m) || [])[1] || ''
      check('m3', '子进程真的在隔离副本里跑（ROOT == ' + tmp + '）', path.resolve(rootLine) === path.resolve(tmp), 'ROOT=' + rootLine + ' rc=' + child.status)
      const rows = out.split('\n').map((l) => /^P120CHK (\S+) (\S+) /.exec(l)).filter(Boolean).map((m) => ({ id: m[1], st: m[2] }))
      const tally = (p) => { const a = rows.filter((r) => r.id.startsWith(p) && r.st !== 'skip'); return { n: a.length, fail: a.filter((r) => r.st === 'fail').length } }
      const A = tally('a'), B = tally('b'), C = tally('c'), D = tally('d'), X = tally('x')
      // (a) 里逐包的 a1/a2/a3（42 条）+ a4/a6 都必须红；只有 **a5（脚本 sha 一致，纯解析层）** 允许留绿
      const aPer = rows.filter((r) => /^a[123]$/.test(r.id))
      const aMustBeRed = rows.filter((r) => /^a[12346]$/.test(r.id))
      note('变异体计票：a=' + A.n + '(红' + A.fail + ') b=' + B.n + '(红' + B.fail + ') c=' + C.n + '(红' + C.fail + ') d=' + D.n + '(红' + D.fail + ') x=' + X.n + '(红' + X.fail + ') rc=' + child.status)
      check('m4', '变异体里 (a) 逐包判据（a1/a2/a3 共 ' + aPer.length + ' 条 + a4/a6）全部变红', aPer.length >= 42 && aMustBeRed.every((r) => r.st === 'fail') && aPer.every((r) => r.st === 'fail'), '逐包 ' + aPer.filter((r) => r.st === 'fail').length + '/' + aPer.length + '；a4/a6=' + rows.filter((r) => /^a[46]$/.test(r.id)).map((r) => r.st).join(','))
      // (c) 的 c1/c3/c4 是"求值/位移跟着变"（必须红）；c2 是"默认属性下取景不变"（**必须留绿**：
      // 变异体里 on/off 两档本来就相同 ⇒ 它证明的是"没有回归"，不是"接线在"）。
      const cById = (idv) => (rows.find((r) => r.id === idv) || {}).st
      check('m5', '变异体里 (c) 的求值/位移判据（c1/c3/c4）全部变红，而 c2（默认属性取景不变）留绿',
        cById('c1') === 'fail' && cById('c3') === 'fail' && cById('c4') === 'fail' && cById('c2') === 'pass',
        'c1=' + cById('c1') + ' c2=' + cById('c2') + ' c3=' + cById('c3') + ' c4=' + cById('c4') + ' c5=' + cById('c5'))
      check('m6', '变异体里 (b) **仍全绿**（无脚本包逐值不变）', B.n >= 4 && B.fail === 0, 'b 共 ' + B.n + ' 条，红 ' + B.fail)
      check('m7', '变异体里 (d) **仍全绿**（坏脚本/坏宿主不抛、落点两态之一）', D.n >= 3 && D.fail === 0, 'd 共 ' + D.n + ' 条，红 ' + D.fail)
      check('m8', '变异体整体 rc=1（有判据红 ⇒ 不冒充通过）', child.status === 1, 'rc=' + child.status)
      check('m9', '接线期才有的痕迹判据 (x) 在变异体里变红（证明 (a)(c) 的红不是"整轮跑不起来"）', X.n >= 1 && X.fail >= 1, 'x 共 ' + X.n + ' 条，红 ' + X.fail)
      if (MACHINE) { fs.writeSync(2, '--- 变异体输出（P120CHK 行）---\n' + rows.map((r) => r.id + ' ' + r.st).join(' ') + '\n') }
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  // 真树未被改动证明：跑前跑后 sha256（core/*.js 逐个）+ `git status --porcelain` 逐字相同
  const realShaAfter = sha(BUNDLE)
  const realStatusAfter = gitStatus()
  const coreShasAfter = fs.readdirSync(path.join(ROOT, 'core')).sort().map((f) => f + ':' + sha(path.join(ROOT, 'core', f))).join('\n')
  check('m10', '真树 core/we-scene-bundle.js sha256 跑前跑后一致', realShaBefore === realShaAfter, realShaBefore.slice(0, 16))
  check('m11', '真树 core/* 全部文件 sha256 跑前跑后一致', coreShasBefore === coreShasAfter, fs.readdirSync(path.join(ROOT, 'core')).length + ' 个文件')
  check('m12', '真树 `git status --porcelain` 跑前跑后逐字一致（未新增/未改动）', realStatusBefore === realStatusAfter, realStatusBefore.split('\n').filter(Boolean).length + ' 行未提交改动（跑前=跑后）')
}

// ════════════════════════════════════════════════════════════════════════════
// ⑦ 汇总
// ════════════════════════════════════════════════════════════════════════════
out('\nP120ROOT ' + ROOT)
const maxRssMb = Math.round((process.resourceUsage ? process.resourceUsage().maxRSS : process.memoryUsage().rss) / 1024)
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skipN + '；本进程峰值 RSS ≈ ' + maxRssMb + ' MB)')
if (fail) { out('\n' + fail + ' 项失败：'); for (const n of fails) out('  - ' + n) }
out(fail === 0 ? '\nALL PASS （' + pass + ' 项' + (skipN ? '，另 SKIP ' + skipN : '') + '）' : '\n' + fail + ' 项失败')
out('口径声明：本工具全程无浏览器、无 GPU/WebGL，输出只有脚本/数值/矩阵/实绘矩形；**不含任何像素/成像结论**。')
process.exit(fail ? 1 : 0)

// demo-videobase-order-test.mjs — 缺陷 1："**视频作最底层 + 场景层叠加**"块在 `scene` 还是 null 时执行
// ⇒ 必然抛 `can't access property "general", scene is null` ⇒ 被 catch 吞成一行日志
// ⇒ 该特性**从未生效**（真机 60 个 PKGM0014 = 视频 + scene.json 的包只画出清屏色）。
//
// 取证原文：docs/MPKG-SWEEP-20260923.md §3（真机日志 `⚠ 视频底层失败: can't access property "general",
//   scene is null`；`tests/mpkg-videobase-order-probe.mjs` 用 `page.route()` 在内存里把该块搬到
//   `parseScene` 之后 ⇒ 日志变 `🎬 视频底层已加入`、`scene.json 解析: 2 layers → 3 layers`）。
// 本文件把它变成**离线门禁**（不开浏览器、不加载真包、不写仓库产物）：
//   ① 源码序判据：块的物理位置必须在 `scene = lib.parseScene(...)` **之后**、`window.__sceneLayers`
//      发布与首帧之前（前者=不再抛，后者=层序 0 真的参与首帧绘制）；
//   ② 执行判据：按**源码里两件事的先后**依次执行（parse → 块），用合成包（真 lib.getEntry）跑
//      页面里那段块的**原文**，断言层数 2→3、视频层在**最前**、几何取自 scene.general；
//   ③ 对照判据：`scene === null` 时执行同一段 = 复现改动前的真机错误行；`?novideo=1` 时整块跳过；
//   ④ mock-GL 判据：把②的结果交给真 `renderScene`，首帧第 1 次绘制必须就是 `__videoBase`；
//   ⑤ 变异自证：在 /tmp 隔离副本里把该块**搬回 parseScene 之前**（＝改动前的仓库状态）再跑本文件，
//      主进程断言"期望的那几条必红"。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { ROOT } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const IS_MUTANT = (process.argv.find((a) => a.startsWith('--mutant=')) || '').slice('--mutant='.length) || null
const DEMO = path.join(ROOT, 'demo.html')
const html = fs.readFileSync(DEMO, 'utf8')
// bundle 从 ROOT 动态导入：`--mutant` 子进程带 `MPW_REPO_ROOT=<tmp 副本>` 时用的是副本里的 bundle
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)

let pass = 0, fail = 0
const results = []
function check(name, cond, detail, group) {
  const ok = !!cond
  if (ok) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
  results.push({ name, ok, group: group || 'main' })
}

// ─────────────────────────── demo.html 里那两个锚点 + 块原文 ───────────────────────────
const BEGIN = '  // ═══ MPW-VIDEOBASE-BEGIN ═══'
const END = '  // ═══ MPW-VIDEOBASE-END ═══'
const PARSE_ANCHOR = '  scene = ATT_LEGACY'
const PUBLISH_ANCHOR = '  if (MPW_WRITE_GLOBALS) { try { window.__sceneLayers = scene.layers }'
const CFG_ANCHOR = 'lib.applyRenderConfig(scene, {'
const RENDER_ANCHOR = 'renderer.render('
const CATCH = "  } catch (e) { logf('⚠ 视频底层失败: ' + e.message) }"

const iBegin = html.indexOf(BEGIN), iEnd = html.indexOf(END)
const iParse = html.indexOf(PARSE_ANCHOR), iPublish = html.indexOf(PUBLISH_ANCHOR)
const iCfg = html.indexOf(CFG_ANCHOR), iRender = html.indexOf(RENDER_ANCHOR)
const iTry = iBegin >= 0 ? html.indexOf('  try {', iBegin) : -1
const iCatch = iTry >= 0 ? html.indexOf(CATCH, iTry) : -1
const blockSrc = (iTry >= 0 && iCatch >= 0) ? html.slice(iTry, iCatch + CATCH.length) : ''

console.log('== 缺陷 1：__videoBase（视频作最底层）块的位置与行为（离线判据，不开浏览器）==')
{
  const lineOf = (i) => (i < 0 ? '?' : html.slice(0, i).split('\n').length)
  console.log('   demo.html: 块 ' + lineOf(iBegin) + '…' + lineOf(iEnd) + ' 行 · `scene = lib.parseScene` ' + lineOf(iParse) + ' 行 · __sceneLayers 发布 ' + lineOf(iPublish) + ' 行')
}
if (IS_MUTANT) console.log('   ⚠ 变异模式：' + IS_MUTANT + '（隔离副本 root=' + ROOT + '）')

// ---- ① 源码序判据 ----
const N_O1 = 'O1 块起始位置在 `scene = lib.parseScene(...)` 之后（⇒ 执行到它时 scene 非 null）'
const N_O2 = 'O2 块结束在 `window.__sceneLayers` 发布之前（⇒ 测试台逐层隔离拿到的数组含视频层）'
const N_O3 = 'O3 块结束在 applyRenderConfig 与首帧 renderer.render( 之前（⇒ 层序 0 在首帧前生效）'
const N_O4 = 'O4 全文件只有一处 `scene.layers.unshift({ id: -10001`（搬移没留下第二份副本）'
check(N_O1, iBegin > iParse && iParse >= 0, 'block@' + iBegin + ' parse@' + iParse)
check(N_O2, iEnd > iBegin && iEnd < iPublish, 'end@' + iEnd + ' publish@' + iPublish)
check(N_O3, iEnd < iCfg && iEnd < iRender, 'end@' + iEnd + ' cfg@' + iCfg + ' render@' + iRender)
check(N_O4, (html.match(/scene\.layers\.unshift\(\{ id: -10001/g) || []).length === 1,
  'hits=' + (html.match(/scene\.layers\.unshift\(\{ id: -10001/g) || []).length)

// ─────────────────────────── 执行环境：合成包 + 桩 DOM + mock GL ───────────────────────────
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function makeMockGL(getLayer) {
  let ids = 0, curUnit = 0, curProg = null
  const curTex = new Array(8).fill(null)
  const draws = []
  const mk = (k) => ({ id: k + '#' + (++ids) })
  const snap = () => ({ __layer: getLayer ? getLayer() : null, tex0: curTex[0] })
  const gl = {
    __draws: draws,
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u - CONST.TEXTURE0 },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: () => {}, useProgram: (p) => { curProg = p }, bindBuffer: () => {},
    texImage2D: () => {}, drawArrays: () => draws.push(snap()), drawElements: () => draws.push(snap()),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'u_Tex', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  return new Proxy(gl, { get(t, prop) {
    if (prop in t) return t[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
}

/** 合成 `.mpkg` 的**目录+数据**布局（与 `lib.getEntry` 的取数口径逐位一致：entries/dataStart/buf/fileSize）。 */
function fakePkg(files) {
  const chunks = [], entries = []
  let off = 0
  for (const [name, bytes] of files) {
    const b = Buffer.from(bytes)
    entries.push({ name, offset: off, size: b.length })
    chunks.push(b); off += b.length
  }
  const buf = Buffer.concat(chunks)
  return { entries, dataStart: 0, fileSize: buf.length, buf }
}
/** 合成包：project.json + 1 个 mp4 条目（"视频 + scene.json"型 PKGM0014 的最小形态）。 */
const MKG_PKG = () => fakePkg([
  ['project.json', Buffer.from(JSON.stringify({ file: 'wallpaper.mp4', general: { file: 'wallpaper.mp4' } }))],
  ['scene.json', Buffer.from(JSON.stringify({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, objects: [] }))],
  ['wallpaper.mp4', Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])],
])
/** 合成 scene.json：2 个对象（走真 parseScene ⇒ 真实层对象，含渲染器需要的全部字段）。 */
const SYN_SCENE = () => ({
  general: { orthogonalprojection: { width: 1920, height: 1080 } },
  objects: [
    { id: 1, name: '底图', image: 'images/bg.tex', size: '1920 1080', origin: '960 540 0' },
    { id: 2, name: '文字', image: 'images/txt.tex', size: '400 100', origin: '960 980 0' },
  ],
})

function mkEnv(search) {
  const logs = []
  const videos = []
  const textures = new Map()
  const gl = makeMockGL(null)
  const doc = {
    body: { appendChild: (el) => videos.push(el) },
    createElement: () => {
      const v = { style: {}, attrs: {}, src: '', loop: false, muted: false, playsInline: false, readyState: 0, currentTime: 0,
        setAttribute: (k, val) => { v.attrs[k] = val }, load: () => {}, play: () => Promise.resolve() }
      return v
    },
  }
  return { logs, videos, textures, gl, doc, location: { search: search || '' }, pkg: MKG_PKG(),
    logf: (m) => logs.push(String(m)), rd: (u8) => new TextDecoder().decode(u8) }
}
if (!blockSrc) { console.log('  ✗ 无法从 demo.html 抽出视频底层块原文（锚点缺失）'); process.exit(1) }
// 执行**页面里那段块的原文**（只注入它引用的 9 个自由变量；不改一个字符）
const runBlock = new Function('scene', 'textures', 'pkg', 'lib', 'gl', 'logf', 'rd', 'document', 'location', blockSrc)

/** 按源码里两件事的先后执行：`scene = lib.parseScene(...)` 与视频底层块。 */
function runInSourceOrder(env) {
  let scene = null
  const evs = [{ k: 'parse', idx: iParse }, { k: 'video', idx: iBegin }].sort((a, b) => a.idx - b.idx)
  const order = evs.map((e) => e.k).join('→')
  for (const ev of evs) {
    if (ev.k === 'parse') scene = lib.parseScene(structuredClone(SYN_SCENE()), null, {})
    else runBlock(scene, env.textures, env.pkg, lib, env.gl, env.logf, env.rd, env.doc, env.location)
  }
  return { scene, order }
}

// ---- ③ 对照判据：scene === null（＝改动前的执行条件）与 `?novideo=1` ----
const N_N1 = 'N1 对照：`scene === null` 时执行同一段 ⇒ 落到 catch，日志原文含 "general"/scene is null（改动前的真机错误）'
{
  const env = mkEnv('')
  runBlock(null, env.textures, env.pkg, lib, env.gl, env.logf, env.rd, env.doc, env.location)
  const hit = env.logs.find((m) => /视频底层失败/.test(m)) || ''
  check(N_N1, /视频底层失败/.test(hit) && /general/.test(hit) && /null/.test(hit) && !/视频底层已加入/.test(env.logs.join('\n')),
    JSON.stringify(env.logs))
}
const N_C1 = 'C1 对照：`?novideo=1` ⇒ 块整体跳过（层数不变、纹理表不登记 __videoBase）'
{
  const env = mkEnv('?novideo=1')
  const { scene } = runInSourceOrder(env)
  check(N_C1, scene.layers.length === 2 && !env.textures.has('__videoBase') && env.videos.length === 0,
    'layers=' + scene.layers.length + ' tex=' + env.textures.has('__videoBase') + ' videos=' + env.videos.length)
}

// ---- ② 执行判据：按源码序跑 ----
const env = mkEnv('')
const { scene, order } = runInSourceOrder(env)
const names = scene.layers.map((l) => l.name)
console.log('   源码序: ' + order + ' · 层名: ' + JSON.stringify(names) + ' · 纹理表: ' + JSON.stringify([...env.textures.keys()]))
const N_B1 = 'B1 按源码序执行（parse → 块）⇒ 日志出现 `🎬 视频底层已加入`（不再是 ⚠ 失败）'
const N_B2 = 'B2 层数 2 → 3'
const N_B3 = 'B3 视频层在层列表**最前**（index 0），场景两层相对序不变（视频先画 ⇒ 场景层叠加在其上）'
const N_B4 = 'B4 视频层几何取自 `scene.general.orthogonalprojection`（1920×1080 ⇒ origin [960,540,0] / size [1920,1080]）'
const N_B5 = 'B5 纹理表登记 `__videoBase`（entry.video = 新建的 <video>，占位 glTex = 1×1 全 0）'
const vLayer = scene.layers[0] || {}
check(N_B1, env.logs.some((m) => /🎬 视频底层已加入/.test(m)), JSON.stringify(env.logs))
check(N_B2, scene.layers.length === 3, 'layers=' + scene.layers.length)
check(N_B3, names.join(',') === '__videoBase,底图,文字', JSON.stringify(names))
check(N_B4, vLayer.id === -10001 && vLayer.name === '__videoBase' && vLayer.textureName === '__videoBase' &&
  JSON.stringify(vLayer.origin) === '[960,540,0]' && JSON.stringify(vLayer.size) === '[1920,1080]' && vLayer.visible === true,
  JSON.stringify({ id: vLayer.id, origin: vLayer.origin, size: vLayer.size, visible: vLayer.visible }))
{
  const e = env.textures.get('__videoBase')
  check(N_B5, !!e && e.video === env.videos[0] && !!e.glTex && e.width === 3840 && e.height === 2160,
    JSON.stringify({ has: !!e, videoSame: !!e && e.video === env.videos[0], glTex: !!(e && e.glTex) }))
}

// ---- ④ mock-GL：首帧绘制序 ----
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D u_Tex; uniform vec4 u_Color4; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(u_Tex, v_TexCoord) * u_Color4; }'
const N_D1 = 'D1 mock GL 真 renderScene：首帧第 1 次绘制就是 `__videoBase`（层序 0 = 最先绘制）'
{
  let curLayerIdx = -1
  const gl = makeMockGL(() => curLayerIdx)
  const rlogs = []
  const r = lib.createRenderer({ getContext: () => gl, width: 1920, height: 1080 }, {
    onLog: (m) => { rlogs.push(String(m)); const m1 = /^\[首帧\] #(\d+) /.exec(String(m)); if (m1) curLayerIdx = Number(m1[1]); else if (String(m).includes('层循环结束')) curLayerIdx = -2 },
    shaderResolver: async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG),
    trace: false, auditFrames: 1, copyBackground: false, hideParticles: true, align: true,
  })
  for (const l of scene.layers) if (l.textureName === undefined && l.name !== '__videoBase') l.textureName = 'images/' + l.name + '.tex'
  await r.render(scene, env.textures, 1920, 1080, 0)
  const draws = gl.__draws
  const vTex = env.textures.get('__videoBase').glTex
  check(N_D1, draws.length === 3 && draws[0].__layer === 0 && draws[0].tex0 === vTex,
    'draws=' + JSON.stringify(draws.map((d) => ({ layer: d.__layer, tex: d.tex0 && (d.tex0 === vTex ? '__videoBase' : d.tex0.__mpwId) }))) + ' log0=' + JSON.stringify(rlogs.filter((m) => /^\[首帧\]/.test(m)).slice(0, 2)))
}

// ─────────────────────────── ⑤ 变异自证：把块搬回 parseScene 之前（＝改动前的仓库状态） ───────────────────────────
/** ①(本机实测) `/tmp` 是 tmpfs 且 `fs.cpSync(recursive)` 在其上抛 `EINVAL` ⇒ 逐文件拷贝。 */
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}
/** 把 MPW-VIDEOBASE 段（含 BEGIN/END 标记）整段搬回 `scene = ATT_LEGACY` 之前。 */
function moveBlockBeforeParse(src) {
  const b = src.indexOf(BEGIN), e = src.indexOf(END)
  if (b < 0 || e < 0) return src
  const block = src.slice(b, e + END.length) + '\n'
  const rest = src.slice(0, b) + src.slice(e + END.length + 1)
  const ai = rest.indexOf(PARSE_ANCHOR)
  if (ai < 0) return src
  return rest.slice(0, ai) + block + rest.slice(ai)
}
const MUTANTS = [{
  id: 'videobase-before-parse',
  what: '把视频底层块搬回 parseScene 之前（＝本缺陷的仓库原状）⇒ 顺序判据 + "真的加入层列表"全部必红',
  apply: moveBlockBeforeParse,
  expect: [N_O1, N_B1, N_B2, N_B3, N_B4, N_D1],
}]

if (IS_MUTANT) {
  const spec = MUTANTS.find((m) => m.id === IS_MUTANT)
  if (!spec) { console.error('未知变异 id: ' + IS_MUTANT); process.exit(2) }
  const got = results.filter((r) => !r.ok).map((r) => r.name).sort()
  const want = spec.expect.slice().sort()
  const same = JSON.stringify(got) === JSON.stringify(want)
  console.log((same ? 'MUTANT-RED-OK ' : 'MUTANT-MISMATCH ') + IS_MUTANT +
    '\n   期望红(' + want.length + '): ' + JSON.stringify(want) + '\n   实际红(' + got.length + '): ' + JSON.stringify(got))
  process.exit(same ? 0 : 1)
}

console.log('\n-- 变异自证（在隔离副本里把块搬回 parseScene 之前，再跑本文件）--')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-videobase-mutant-'))
  try {
    fs.copyFileSync(DEMO, path.join(tmp, 'demo.html'))
    copyTree(path.join(ROOT, 'core'), path.join(tmp, 'core'))
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'))
    for (const m of MUTANTS) {
      const src = fs.readFileSync(path.join(tmp, 'demo.html'), 'utf8')
      const out = m.apply(src)
      if (out === src) { check(`MM-${m.id} 突变补丁命中源码`, false, '搬移串未命中 ⇒ 变异无效，本段读数不算数'); continue }
      fs.writeFileSync(path.join(tmp, 'demo.html'), out)
      const r = spawnSync(process.execPath, [FILE, '--mutant=' + m.id],
        { env: Object.assign({}, process.env, { MPW_REPO_ROOT: tmp }), encoding: 'utf8', timeout: 180000, maxBuffer: 8 << 20 })
      const lines = String(r.stdout || '').split('\n').filter((s) => /MUTANT-(RED-OK|MISMATCH)|期望红|实际红/.test(s))
      const line = lines.find((s) => /MUTANT-(RED-OK|MISMATCH)/.test(s)) || ''
      console.log('   ' + (lines.map((s) => s.trim()).join(' ⏎ ') || ('（子进程无 MUTANT 标记行，exit=' + r.status + '）')))
      check(`MM-${m.id} 必红：${m.what}`, r.status === 0 && /MUTANT-RED-OK/.test(line),
        (line.trim() || ('exit=' + r.status)) + (r.stderr ? ' stderr=' + String(r.stderr).trim().split('\n').slice(-1)[0] : ''))
      fs.writeFileSync(path.join(tmp, 'demo.html'), src)   // 还原
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}

console.log('\n===== __videoBase 顺序: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

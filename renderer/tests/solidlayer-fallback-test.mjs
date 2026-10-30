// solidlayer-fallback-test.mjs — 缺陷 2：`[TRANSPARENT_FALLBACK] 纯色`（显式 `models/util/solidlayer*`
// 层被"透明兜底"整层吞掉）
//
// 取证原文：docs/MPKG-SWEEP-20260923.md §4（真机包 `wallpapertest1_…alone 孤独の少女….mpkg`
//   第 51 层 `name="纯色"`、`image="models/util/solidlayer.json"`、**无 `color` 字段**（WE 语义 = 白）、
//   `size=1000×1000`；同场景只有这一层用该模型）。
// 代码路径（core/we-scene-bundle.js · renderLayer）：
//   · parse 段：`image` 以 `models/util/solidlayer` 开头 ⇒ `layer.solid = true`（**显式纯色层**，
//     与 `solid:true 且无 image` 的作者占位层不同一支；后者见 P-41 A4）；
//   · `BUILTIN_MATERIALS['materials/util/solidlayer.json'].passes[0].textures = []` ⇒ 无纹理是**设计**；
//   · 旧 `__solidColored` = `solid && !effTex && color≠白` ⇒ 没写 color（=白）时 false
//     ⇒ `WHITE_FALLBACK` 默认 false ⇒ `srcTex = transparentTex`（1×1 全 0）⇒ 整层消失。
// 修法（本文件所钉）：`if (__solidModel) return true`（`__solidModel` = `layer.image` 前缀判定）。
//
// 本文件**不加载任何真包**（那个包 3.7GB，真机加载曾把 Firefox 内容进程推到 3.7GB / 系统可用 1.43GB
//   ⇒ 按"不许 OOM"口径不再跑它）：合成 scene.json 走**真 parseScene** + mock GL 走**真 renderScene**，
//   用渲染器自己的逐层台账 `opts.onLayerDraw({isWhite,isTransparent})` 断言"这一层最终绑了哪张兜底纹理"。
// 变异自证：`--mutant` 模式在 /tmp 隔离副本上**真改** core/we-scene-bundle.js 后重跑本文件，
//   主进程断言"期望的那几条必红"（M1 删掉新分支 ⇒ A0/A1 必红；M2 放宽成"所有 solid 都算纯色"
//   ⇒ B0 作者占位层必红）。不开浏览器、不依赖语料、不写仓库内产物。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { ROOT } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const IS_MUTANT = (process.argv.find((a) => a.startsWith('--mutant=')) || '').slice('--mutant='.length) || null
// ①(mock-GL 口径) bundle 从 **ROOT 动态导入**（而不是 `../core/...` 静态导入）：
//   这样 `--mutant` 子进程一旦带 `MPW_REPO_ROOT=<tmp 副本>`，导入的就是**被改过的副本**。
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)

let pass = 0, fail = 0
const results = []
function check(name, cond, detail, group) {
  const ok = !!cond
  if (ok) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
  results.push({ name, ok, group: group || 'main' })
}

// ─────────────────────────── mock GL（口径同 tests/package-matrix.mjs） ───────────────────────────
// 1×1 上传打标：全 255 → `__solid='white'`（bundle 的 whiteTex）、全 0 → `'transparent'`（transparentTex）。
// drawArrays 在绘制瞬间记录"当前 TEXTURE0 + 当前 uniform 快照 + 归属层号（由 `[首帧] #N` 日志驱动）"。
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function makeMockGL(getLayer) {
  let ids = 0, curUnit = 0, curProg = null
  const curTex = new Array(8).fill(null)
  const progUni = new Map()
  const draws = []
  const mk = (k) => ({ id: k + '#' + (++ids) })
  const setUni = (l, v) => { if (l && l.p && l.n) { if (!progUni.has(l.p.id)) progUni.set(l.p.id, {}); progUni.get(l.p.id)[l.n] = v } }
  const snap = () => ({ __layer: getLayer(), tex0: curTex[0], uni: Object.assign({}, (curProg && progUni.get(curProg.id)) || {}) })
  const gl = {
    __draws: draws,
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u - CONST.TEXTURE0 },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: () => {}, useProgram: (p) => { curProg = p }, bindBuffer: () => {},
    texImage2D: (target, level, ifmt, w, h, b, fmt, type, data) => {
      const tex = curTex[curUnit]
      if (!tex || w !== 1 || h !== 1 || !data || data.length < 4) return
      let all = data[0]; for (let i = 1; i < 4; i++) if (data[i] !== all) { all = -1; break }
      if (all === 255) tex.__solid = 'white'
      else if (all === 0) tex.__solid = 'transparent'
    },
    drawArrays: () => draws.push(snap()), drawElements: () => draws.push(snap()),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'u_Tex', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v),
    uniform2f: (l, a, b) => setUni(l, [a, b]), uniform3f: (l, a, b, c) => setUni(l, [a, b, c]),
    uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]), uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  return new Proxy(gl, { get(t, prop) {
    if (prop in t) return t[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
}

const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D u_Tex; uniform vec4 u_Color4; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(u_Tex, v_TexCoord) * u_Color4; }'
const shaderResolver = async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG)

// ─────────────────────────── 合成夹具（最小复现真机第 51 层） ───────────────────────────
const SYN = () => ({
  general: { orthogonalprojection: { width: 1920, height: 1080 } },
  objects: [
    // ① 真机 `alone 孤独の少女` 第 51 层的最小复现：显式纯色层模型 + **无 color 字段**
    { id: 51, name: '纯色', image: 'models/util/solidlayer.json', size: '1000 1000', origin: '960 540 0' },
    // ② 同模型 + 作者显式写白（旧谓词对它也判 false ⇒ 同样被吞；钉住"color 不是区分依据"）
    { id: 52, name: '纯色显式白', image: 'models/util/solidlayer.json', color: '1 1 1', size: '200 200', origin: '300 300 0' },
    // ③ 对照（P-41 A4 设计路径）：`solid:true` 且**无 image** 的作者占位/容器层 ⇒ 必须仍然透明
    { id: 53, name: '占位层', solid: true, size: '200 200', origin: '500 500 0' },
    // ④ 对照：无 image 但有色 ⇒ 既有 `whiteTex × color4` 画法必须不变
    { id: 54, name: '占位层有色', solid: true, color: '0.2 0.6 0.2', size: '200 200', origin: '700 700 0' },
    // ⑤ 对照：非 solid 且声明纹理但纹理表里没有 ⇒ 默认透明兜底必须不变（`?whitefallback` 未开）
    { id: 55, name: '缺纹理层', image: 'images/不存在.png', size: '200 200', origin: '900 900 0' },
  ],
})
const W = 1920, H = 1080

async function renderFixture() {
  const logs = []
  const layerDraws = []
  let curLayerIdx = -1
  const gl = makeMockGL(() => curLayerIdx)
  const scene = lib.parseScene(SYN(), null, {})
  // 纹理装载阶段（真 demo 在这里把 image/material 派生的纹理名写到 layer.textureName；本夹具只模拟
  // "声明了但表里没有"的那一支 ⑤）。显式纯色层/占位层**不该**有 textureName（无纹理是设计）。
  const l55 = scene.layers.find((l) => l.id === 55)
  if (l55) l55.textureName = 'images/不存在.png'
  const renderer = lib.createRenderer({ getContext: () => gl, width: W, height: H }, {
    onLog: (m) => {
      logs.push(String(m))
      const m1 = /^\[首帧\] #(\d+) /.exec(String(m))
      if (m1) curLayerIdx = Number(m1[1])
      else if (String(m).includes('层循环结束')) curLayerIdx = -2
    },
    onLayerDraw: (layer, info) => layerDraws.push({ id: layer.id, name: layer.name, isWhite: !!info.isWhite, isTransparent: !!info.isTransparent }),
    shaderResolver, trace: false, auditFrames: 1, copyBackground: false, hideParticles: true, align: true,
  })
  await renderer.render(scene, new Map(), W, H, 0)
  return { scene, renderer, draws: gl.__draws, logs, layerDraws }
}

console.log('== 缺陷 2：[TRANSPARENT_FALLBACK] 显式纯色层（合成夹具 + mock GL，不加载真包）==')
console.log('   包夹具 : 合成 scene.json（真 parseScene + 真 renderScene）· bundle=' + path.relative(ROOT, path.join(ROOT, 'core', 'we-scene-bundle.js')))
if (IS_MUTANT) console.log('   ⚠ 变异模式：' + IS_MUTANT + '（隔离副本 root=' + ROOT + '）')

// ---- P 段：parse 侧（夹具本身是否真的复现了"两支不可区分"） ----
const parsed = lib.parseScene(SYN(), null, {})
const L = (id) => parsed.layers.find((l) => l.id === id)
check('P1 夹具 parseScene：image=solidlayer.json ⇒ layer.solid=true（走"显式纯色层"支）',
  L(51) && L(51).solid === true && L(51).image === 'models/util/solidlayer.json', JSON.stringify(L(51) && { solid: L(51).solid, image: L(51).image }))
check('P2 无 color 字段 ⇒ layer.color=[1,1,1]（WE 语义 = 白；旧谓词判 false 的直接原因）',
  L(51) && Array.isArray(L(51).color) && L(51).color.join(',') === '1,1,1', JSON.stringify(L(51) && L(51).color))
check('P3 对照：无 image 的 solid 占位层同样 solid=true / color=[1,1,1]（⇒ 唯一可用的区分依据是 layer.image）',
  L(53) && L(53).solid === true && L(53).image === null && L(53).color.join(',') === '1,1,1',
  JSON.stringify(L(53) && { solid: L(53).solid, image: L(53).image, color: L(53).color }))

// ---- A/B 段：mock GL 真 renderScene ----
const R = await renderFixture()
const draws = R.layerDraws
const byId = (id) => draws.find((d) => d.id === id)
const N_A0 = 'A0 显式纯色层（solidlayer.json + 无 color）⇒ 画 whiteTex，不是透明兜底'
const N_A1 = 'A1 显式纯色层 + 显式白 color ⇒ 同样画 whiteTex（color 不是区分依据）'
const N_B0 = 'B0 作者占位层（solid 且无 image/color）⇒ 仍走透明兜底（P-41 A4 不回归）'
const N_B1 = 'B1 作者占位层 + 非白 color ⇒ 仍画 whiteTex（既有颜色填充路径不变）'
const N_B2 = 'B2 非 solid 且声明纹理但表里没有 ⇒ 仍透明（默认；?whitefallback 未开）'
const N_C0 = 'C0 五层各画一次且绘制序 = objects 序（夹具没被隐藏/跳过污染）'
const N_C1 = 'C1 whiteTex 身份判据与 GL 台账一致（onLayerDraw.isWhite ⇔ mock GL 收到全 255 / 全 0 上传）'

check(N_A0, byId(51) && byId(51).isWhite === true, 'reads=' + JSON.stringify(byId(51)))
check(N_A1, byId(52) && byId(52).isWhite === true, 'reads=' + JSON.stringify(byId(52)))
check(N_B0, byId(53) && byId(53).isWhite === false && byId(53).isTransparent === true, 'reads=' + JSON.stringify(byId(53)))
check(N_B1, byId(54) && byId(54).isWhite === true, 'reads=' + JSON.stringify(byId(54)))
check(N_B2, byId(55) && byId(55).isTransparent === true && byId(55).isWhite === false, 'reads=' + JSON.stringify(byId(55)))
check(N_C0, draws.length === 5 && draws.map((d) => d.id).join(',') === '51,52,53,54,55', 'layerDraws=' + JSON.stringify(draws))
// onLayerDraw 的 isWhite/isTransparent 与 mock GL 独立观测（texImage2D 打标 + whiteTex 身份）逐层一致
{
  const glSentinel = new Map(R.draws.map((d) => [d.__layer, d.tex0 && (d.tex0 === R.renderer.whiteTex ? 'white' : (d.tex0.__solid || 'other'))]))
  const ok = draws.every((d, i) => {
    const s = glSentinel.get(i)
    return s === (d.isWhite ? 'white' : d.isTransparent ? 'transparent' : 'other')
  })
  check(N_C1, ok, 'glSentinel=' + JSON.stringify([...glSentinel]) + ' ledger=' + JSON.stringify(draws.map((d) => (d.isWhite ? 'white' : d.isTransparent ? 'transparent' : 'other'))))
}
check('C2 修好的这一支不再依赖 `?whitefallback=1`（默认档就是纯色，不是"开开关才对"）',
  R.logs.every((m) => !/whitefallback/.test(m)))
console.log('   逐层读数: ' + JSON.stringify(draws))
if (R.logs.length) console.log('   渲染日志(尾3): ' + JSON.stringify(R.logs.slice(-3)))

// ─────────────────────────── 变异自证（/tmp 隔离副本上真改 bundle 再跑本文件） ───────────────────────────
/** ①(本机实测) `/tmp` 是 tmpfs 且 `fs.cpSync(recursive)` 在其上抛 `EINVAL` ⇒ 逐文件拷贝（mkdir+copyFile 均正常）。 */
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

const MUTANTS = [
  {
    id: 'M1-solidmodel-branch-removed',
    what: '删掉 `if (__solidModel) return true`（＝退回旧谓词）⇒ A0/A1 必红',
    apply: (src) => src.replace('        if (__solidModel) return true   // 显式纯色层模型：无纹理是设计；color 缺省 = 白\n', ''),
    expect: [N_A0, N_A1],
  },
  {
    id: 'M2-solidmodel-branch-broadened',
    what: '放宽成"所有 solid 层都当纯色"（`if (__solidModel) return true` → `return true`）⇒ B0 作者占位层必红',
    apply: (src) => src.replace('        if (__solidModel) return true   // 显式纯色层模型：无纹理是设计；color 缺省 = 白',
      '        return true   // MUTANT：把"显式纯色层"放宽成"所有 solid 层"'),
    expect: [N_B0],
  },
]

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

console.log('\n-- 变异自证（真改隔离副本里的 core/we-scene-bundle.js 后重跑本文件）--')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-solidlayer-mutant-'))
  const target = path.join(tmp, 'core', 'we-scene-bundle.js')
  try {
    // ①(本机实测) `fs.cpSync(recursive)` 在本机 /tmp（tmpfs）上抛 EINVAL ⇒ 手写逐文件拷贝（只 12 个文件）
    copyTree(path.join(ROOT, 'core'), path.join(tmp, 'core'))
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'))
    for (const m of MUTANTS) {
      const src = fs.readFileSync(target, 'utf8')
      const out = m.apply(src)
      if (out === src) { check(`MM-${m.id} 突变补丁命中源码`, false, '替换串未命中 ⇒ 变异无效，本段读数不算数'); continue }
      fs.writeFileSync(target, out)
      const r = spawnSync(process.execPath, [FILE, '--mutant=' + m.id],
        { env: Object.assign({}, process.env, { MPW_REPO_ROOT: tmp }), encoding: 'utf8', timeout: 180000, maxBuffer: 8 << 20 })
      const lines = String(r.stdout || '').split('\n').filter((s) => /MUTANT-(RED-OK|MISMATCH)|期望红|实际红/.test(s))
      const line = lines.find((s) => /MUTANT-(RED-OK|MISMATCH)/.test(s)) || ''
      console.log('   ' + (lines.map((s) => s.trim()).join(' ⏎ ') || ('（子进程无 MUTANT 标记行，exit=' + r.status + '）')))
      check(`MM-${m.id} 必红：${m.what}`, r.status === 0 && /MUTANT-RED-OK/.test(line),
        (line.trim() || ('exit=' + r.status)) + (r.stderr ? ' stderr=' + String(r.stderr).trim().split('\n').slice(-1)[0] : ''))
      fs.writeFileSync(target, src)   // 还原：下一个变异从干净源码出发
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}

console.log('\n===== solidlayer 透明兜底: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

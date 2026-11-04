// hlsl2glsl-wiring-test.mjs —— ①(P-114 2026-09-18) **"渲染路径到底在跑哪份 hlsl2glsl"** 的仪器化证明
//
// 为什么要有这一项：P0-5 的原文是"把 vendor/hlsl2glsl/ 接进 bundle 的转译路径"。审计（同日）发现
// bundle 用的是**自研**那份（`core/we-scene-bundle.js:4106` 定义、`:7268-7269` 调用，全文件 0 处引用
// vendor），而 `hlsl2glsl-coverage-test.mjs` 当时 import 的是 vendored ⇒ **门禁守着一份没在跑的实现**。
// 本项把"在跑的是哪份"变成**会变红**的断言，方法是**仪器化真渲染路径**（不读注释、不猜 combos）：
//
//   · 把 `core/we-scene-bundle.js` 的**真源码**复制到临时模块，只在渲染路径的转译调用点**插两行探针**
//     （记录 `shaderName/stage/effectiveCombos`）—— 探针不改行为（W2d 用"两次渲染捕获到的 GLSL 集合
//     逐字节相同"来证明这一点），但它把渲染器**真正用的 combos** 变成可观测量；
//   · 用 mock-GL 捕获 `gl.shaderSource()` 真正收到的 GLSL（写法与 tests/mock-gl-test.mjs 同源）；
//   · 逐字节对拍：捕获值 == 自研实现的输出（同 shader/同 combos/同 resolver）**且 ≠ vendored 的输出**。
//
// 真实性边界（如实写，别当它不存在）：**转译输入 100% 来自真包** —— shader 字节、effect 链、combos、include
// 解析器都取自 `allwallpaper/dd/<id>/scene.pkg` 与渲染器自身；只有**承载该效果链的那一层**是合成的
// （`mkCarrierLayer`）。原因：本机无 GPU/文字渲染器/蒙皮数据，语料里这些 shader 只挂在**文字层/蒙皮 mesh 层**
// 上，Node 里那些层根本进不到效果链（实测 3715743282 的 blur_precise_gaussian 只挂在文字层，直接渲染该包
// 一帧 ⇒ `shaderResolver` 0 次调用、效果链从未转译）。合成载体层正是 mock-gl-test.mjs 已在用的写法。
//
// 断言分三层（缺语料/缺 glslangValidator 时对应用例 SKIP-视作-PASS，与仓内真包类条件项同口径）：
//   W1 结构  ：bundle 源码 0 处引用 `vendor/hlsl2glsl`；渲染路径调用点在位；导出绑定 ≠ vendored 函数。
//   W2 仪器化：探针拿到渲染器真实调用；捕获的 GLSL 逐字节 = 自研输出；glslangValidator 真编译过。
//   W3 **RED-IF-REVERTED**：把同一份探针模块再反向变异成"接 vendored"（改真源码切片：注入 vendored
//      import + 重命名自研函数声明 ⇒ 调用点落到 vendored），同一帧重跑：捕获值必须**变成 vendored 的
//      输出**（且 glslang 在场时**真编译不过**）⇒ W2 的判定确实会翻转。绿色运行也打印 RED 行
//      （`audio-band-wiring-test.mjs` 同款写法）。
//
// 运行：node tests/hlsl2glsl-wiring-test.mjs        （全过输出 ALL PASS；~4s）
// 依据与数字：docs/PATCHES.md P-114；docs/HLSL2GLSL-COVERAGE.md（工作区根）的 P-114 附注。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import * as lib from '../core/we-scene-bundle.js'
import { hlsl2glsl as WIRED } from '../core/we-scene-bundle.js'
import { hlsl2glsl as VENDORED } from '../vendor/hlsl2glsl/hlsl2glsl.js'
import { ROOT } from './_root.mjs'

let pass = 0, fail = 0
const fails = []
// 真断言助手（`(name, cond, detail) => cond ? pass++ : fail++`）；**不要**写成恒真的 ok(n,d)
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const skipNote = (m) => console.log('  SKIP ' + m + '（条件项：缺数据视作 PASS，不红）')

console.log('hlsl2glsl 接线证明（P-114）')

// ───────────────────────── W1 结构断言（不需要语料） ─────────────────────────
console.log('\n== W1 结构：bundle 的转译入口 ==')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const bundleSrc = fs.readFileSync(BUNDLE, 'utf8')
const vendorRefs = (bundleSrc.match(/vendor\/hlsl2glsl/g) || []).length
ok('W1a bundle 源码 0 处引用 vendor/hlsl2glsl', vendorRefs === 0, vendorRefs + ' 处')
const callFrag = "hlsl2glsl(src.frag, 'frag', effectiveCombos, resolver)"
const callVert = "hlsl2glsl(src.vert, 'vert', effectiveCombos, resolver)"
ok('W1b 渲染路径调用点在位（getEffectProgram 内，frag+vert）', bundleSrc.includes(callFrag) && bundleSrc.includes(callVert),
  (bundleSrc.includes(callFrag) ? 'frag✓' : 'frag✗') + ' ' + (bundleSrc.includes(callVert) ? 'vert✓' : 'vert✗'))
ok('W1c 渲染路径的转译入口 = 本文件 import 的自研实现（同一模块内绑定）', typeof WIRED === 'function' && lib.hlsl2glsl === WIRED, 'arity=' + WIRED.length)
ok('W1d 自研实现 ≠ vendored 实现（两份确实是不同函数）', WIRED !== VENDORED, 'arity ' + WIRED.length + ' vs ' + VENDORED.length)

// ───────────────────────── 语料/工具（缺则整段 SKIP） ─────────────────────────
// ①(P-114) 包解析用**渲染器自己的** `parsePkg/getEntry`（与 tests/glsl-validate.mjs 同源），
//   不引入工作区里的 pkg-extract：本项要测的就是渲染路径，少一个外部依赖少一处口径漂移。
const WS = process.env.MPW_ROOT || path.resolve(ROOT, '..')
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')
const GLSLANG = (() => { try { return execFileSync('sh', ['-c', 'command -v glslangValidator'], { encoding: 'utf8' }).trim() } catch { return '' } })()
const HEADERS = new Map()
for (const d of [path.join(ROOT, 'shaders'), ROOT]) {
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d)) if (/^common.*\.h$/.test(f) && !HEADERS.has(f)) HEADERS.set(f, fs.readFileSync(path.join(d, f), 'utf8'))
}
const includeResolver = (n) => HEADERS.get(String(n).split('/').pop()) ?? null
const td = new TextDecoder()
const rd = (b) => td.decode(b).replace(/^\uFEFF/, '')
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const TMP = process.env.TMPDIR || '/tmp'

console.log('\n== W2/W3 仪器化：真渲染路径的 gl.shaderSource() 收到哪份 GLSL ==')
if (!fs.existsSync(SCENE_ROOT)) skipNote('hlsl2glsl-wiring（无语料根 ' + SCENE_ROOT + '）')
else {
  // 找一个**判别力** shader：自研真编译过 / vendored 编不过（"两份只是文本不同"不足以证明谁在跑），
  // 并把它所在的**真 effect 链**记下来。包按体积升序扫，命中即停（实测命中 3715743282@3.7MB）。
  const cands = fs.readdirSync(SCENE_ROOT).map((id) => ({ id, fp: path.join(SCENE_ROOT, id, 'scene.pkg') }))
    .filter((c) => fs.existsSync(c.fp)).map((c) => ({ ...c, bytes: fs.statSync(c.fp).size }))
    .sort((a, b) => a.bytes - b.bytes)
  const MAX_MB = Number(process.env.MPW_H2G_WIRE_MAX_MB || 32)
  let target = null
  for (const c of cands) {
    if (c.bytes / 1048576 > MAX_MB) continue
    let pkg
    try { pkg = lib.parsePkg(fs.readFileSync(c.fp)) } catch { continue }
    let scene = null
    try { scene = lib.parseScene(JSON.parse(rd(lib.getEntry(pkg, 'scene.json'))), null) } catch { scene = null }
    if (!scene) { pkg = null; continue }
    for (const l of scene.layers) {
      for (const eff of l.effects || []) {
        if (!eff.visible) continue
        lib.resolveEffectChain(pkg, eff, rd)
        for (const mp of eff.materialPasses || []) {
          if (!mp.shader) continue
          for (const stage of ['frag', 'vert']) {
            const full = 'shaders/' + mp.shader + '.' + stage
            const buf = lib.getEntry(pkg, full)
            if (buf === null) continue
            const src = rd(buf)
            const wOut = WIRED(src, stage, {}, includeResolver)
            const vOut = VENDORED(src, stage, {}, includeResolver, '')
            if (wOut === vOut) continue
            if (GLSLANG) {
              const cw = compiles(wOut, stage), cv = compiles(vOut, stage)
              if (!(cw === 'OK' && cv !== 'OK')) continue
            }
            target = { pkgId: c.id, pkg, eff, shader: mp.shader, stage, full, sha: sha(Buffer.from(buf)).slice(0, 8), src }
            break
          }
          if (target) break
        }
        if (target) break
      }
      if (target) break
    }
    if (target) break
    pkg = null
    await new Promise((r) => setImmediate(r))
  }
  if (!target) skipNote('hlsl2glsl-wiring（' + MAX_MB + 'MB 以内的包里找不到"两份实现判定不同"的 shader）')
  else {
    console.log('  判别用 shader: ' + target.pkgId + ' ' + target.full + ' sha=' + target.sha +
      (GLSLANG ? '（自研真编译过 / vendored 编不过）' : '（无 glslang ⇒ 只按输出文本差异判别）'))
    const shaderResolver = async (rel) => {
      const name = String(rel).replace(/^shaders\//, '')
      const e = lib.getEntry(target.pkg, 'shaders/' + name)
      if (e !== null) return rd(e)
      return HEADERS.get(name.split('/').pop()) ?? null
    }
    // 合成载体层 + **真 effect 链**（见文件头"真实性边界"）：本机没有文字/蒙皮渲染器，语料里这些 shader
    // 只挂在文字层/蒙皮层上，直接渲染真包一帧效果链根本不会被执行（实测 shaderResolver 0 次调用）。
    const carrier = mkCarrierLayer(target.eff)
    const scene = { general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers: [carrier], properties: {} }
    const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])

    // ── 探针模块：真源码 + 转译调用点前插两行记录（不改行为；W2d 证明这一点） ──
    const probed = instrument(bundleSrc)
    ok('W2a 探针是**对真源码的定点插入**（只动转译调用点，插 2 行）', probed.changed, probed.note)
    const probedPath = path.join(TMP, 'mpw-h2g-probed-' + process.pid + '.mjs')
    fs.writeFileSync(probedPath, probed.src)
    const cap0 = mkCaptureGL()
    const r0 = lib.createRenderer(cap0.canvas, { shaderResolver, onLog: () => {} })
    await r0.render(scene, textures, 640, 360, 0.016)
    const mlib = await import(pathToFileURL(probedPath).href)
    const cap1 = mkCaptureGL()
    const probes = []
    globalThis.__mpwH2GProbe = (name, stage, combos) => probes.push({ name, stage, combos })
    const r1 = mlib.createRenderer(cap1.canvas, { shaderResolver, onLog: () => {} })
    await r1.render(scene, textures, 640, 360, 0.016)
    delete globalThis.__mpwH2GProbe
    ok('W2b 探针确实被渲染路径调用（拿到渲染器真实的 shaderName/combos）', probes.length > 0, probes.length + ' 次转译调用')
    const sameSet = cap0.sources.length === cap1.sources.length && cap0.sources.every((s, i) => s === cap1.sources[i])
    ok('W2c 插探针不改行为（两次渲染捕获到的 GLSL 集合逐字节相同）', sameSet,
      cap0.sources.length + ' vs ' + cap1.sources.length + ' 个 GLSL')

    const rec = probes.find((p) => p.name === target.shader && p.stage === target.stage)
    ok('W2d 判别 shader 这一次转译被探针记录到', !!rec, rec ? 'combos=' + JSON.stringify(rec.combos) : '未记录到 ' + target.shader + '.' + target.stage)
    // ①(P-134 ⑥ 第三处) 渲染路径编译的源 = 本 stage 源码 + **对方 stage 独有**的 `[COMBO]` 声明（并集，
    //   见 `withSiblingComboDefaults`）⇒ W2e/W2f/W3 的期望值必须按**同一口径**构造（断言语义不变：
    //   仍然证明"送进 gl.shaderSource 的是自研实现的输出"）。sibling 缺失（包内只有单 stage）⇒ 空串。
    const renderSrc = () => {
      const stageSrc = rd(lib.getEntry(target.pkg, target.full))
      const sibPath = target.full.replace(/\.(frag|vert)$/, (m0, ext) => (ext === 'frag' ? '.vert' : '.frag'))
      const sibBuf = lib.getEntry(target.pkg, sibPath)
      return lib.withSiblingComboDefaults(stageSrc, sibBuf === null ? '' : rd(sibBuf))
    }
    if (rec) {
      const src = renderSrc()
      const expectW = WIRED(src, target.stage, rec.combos, includeResolver)
      const expectV = VENDORED(src, target.stage, rec.combos, includeResolver)   // 渲染路径是 4 参调用（无 siblingSrc）
      const got = cap1.sources.find((s) => s === expectW)
      ok('W2e gl.shaderSource 收到的 GLSL 逐字节 = 自研实现在同一 (shader, combos) 下的输出', !!got,
        got ? expectW.length + ' 字节' : '捕获 ' + cap1.sources.length + ' 个 GLSL，无一等于自研输出（' + expectW.length + ' 字节）')
      ok('W2f 同一输入下 vendored 的输出 ≠ 捕获值（⇒ "谁在跑"这条断言有判别力）', expectV !== expectW && !cap1.sources.includes(expectV),
        'vendored ' + expectV.length + ' 字节 vs 自研 ' + expectW.length + ' 字节' + (GLSLANG ? '；vendored 编译: ' + compiles(expectV, target.stage).slice(0, 60) : ''))
      if (GLSLANG && got) ok('W2g 捕获到的 GLSL 过 glslangValidator（真 GLSL ES 300 编译）', compiles(got, target.stage) === 'OK', compiles(got, target.stage))
      else if (!GLSLANG) skipNote('W2g（无 glslangValidator ⇒ 不做真编译）')
    }

    // ── W3 RED-IF-REVERTED：同一份探针模块再变异成"接 vendored"，同一帧必须换个结果 ──
    const mut = mutateToVendored(probed.src)
    ok('W3a 变异生效（注入 vendored import + 重命名自研声明 ⇒ 调用点落到 vendored）', mut.changed, mut.note)
    const mutPath = path.join(TMP, 'mpw-h2g-mutant-' + process.pid + '.mjs')
    const red = []
    if (mut.changed) {
      fs.writeFileSync(mutPath, mut.src)
      try {
        const xlib = await import(pathToFileURL(mutPath).href)
        const cap2 = mkCaptureGL()
        const r2 = xlib.createRenderer(cap2.canvas, { shaderResolver, onLog: () => {} })
        await r2.render(scene, textures, 640, 360, 0.016)
        if (rec) {
          const src = renderSrc()                       // ①(P-134 ⑥) 与渲染路径同口径（并集）
          const expectW = WIRED(src, target.stage, rec.combos, includeResolver)
          const expectV = VENDORED(src, target.stage, rec.combos, includeResolver)
          const gotV = cap2.sources.find((s) => s === expectV)
          const gotW = cap2.sources.find((s) => s === expectW)
          if (gotV && !gotW) red.push('变异后捕获到的是 **vendored** 的输出、不再是自研的 ⇒ W2e 会变红')
          if (GLSLANG && gotV) {
            const cv = compiles(gotV, target.stage)
            if (cv !== 'OK') red.push('变异后捕获的 GLSL 真编译**不过**（' + cv.slice(0, 100) + '）⇒ W2g 会变红')
          }
        } else red.push('（W2d 未记录到该 shader ⇒ 无法判红）')
      } catch (e) { red.push('变异体渲染抛错：' + String(e && e.message).slice(0, 120)) }
    }
    ok('W3b RED-IF-REVERTED：变异成"接 vendored"后 W2 的判定确实翻转', red.length >= (GLSLANG ? 2 : 1), red.length + ' 条')
    for (const x of red) console.log('   RED ' + x)
    for (const p of [probedPath, mutPath]) { try { fs.rmSync(p, { force: true }) } catch { /* ignore */ } }
  }
}

// ───────────────────────── 工具 ─────────────────────────
function compiles(src, stage) {
  if (!GLSLANG) return 'NO-GLSLANG'
  const fp = path.join(TMP, 'mpw-h2g-wire-' + process.pid + '-' + Math.abs(hashStr(src)) + (stage === 'vert' ? '.vert' : '.frag'))
  try { fs.writeFileSync(fp, src); execFileSync(GLSLANG, ['-S', stage, fp], { stdio: 'pipe', timeout: 20000 }); return 'OK' }
  catch (e) {
    const txt = ((Buffer.from(e.stdout || '')).toString() + Buffer.from(e.stderr || '')).trim()
    const first = txt.split('\n').map((l) => l.trim()).filter((l) => l && !/\.(frag|vert)$/.test(l))[0]
    return first || ('EXIT ' + e.status)
  }
  finally { try { fs.unlinkSync(fp) } catch { /* ignore */ } }
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
// 载体层（合成，只为让效果链真的被执行；形状与 tests/mock-gl-test.mjs 的 mkLayer 同源）
function mkCarrierLayer(eff) {
  return {
    id: 1, name: 'P-114 载体层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [eff], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined,
  }
}
// 把 bundle 的真源码搬到临时模块（3 个相对 import 改绝对路径），并在渲染路径的转译调用点前插探针。
function toTempModule(src) {
  return src.replace(/from '\.\/([^']+)'/g, (all, f) => 'from ' + JSON.stringify(path.join(ROOT, 'core', f)))
}
function instrument(src) {
  let out = toTempModule(src)
  const anchors = [
    "      const fragGlsl = hlsl2glsl(src.frag, 'frag', effectiveCombos, resolver)",
    "      const vertGlsl = hlsl2glsl(src.vert, 'vert', effectiveCombos, resolver)",
  ]
  let n = 0
  for (const a of anchors) {
    if (!out.includes(a)) continue
    const stage = a.includes("'frag'") ? 'frag' : 'vert'
    out = out.replace(a, "      if (globalThis.__mpwH2GProbe) globalThis.__mpwH2GProbe(shaderName, '" + stage + "', effectiveCombos)\n" + a)
    n++
  }
  return { changed: n === 2, src: out, note: n === 2 ? '真源码 + 2 行探针（相对 import 3 处改绝对）' : '只插到 ' + n + '/2 个调用点（源码已变）' }
}
// 反向变异（改的是 bundle 的**真源码切片**）：注入 vendored import + 把自研函数声明改名 ⇒
// 渲染路径里 `hlsl2glsl(...)` 这个模块内绑定就落到 vendored 那份上（= "把 vendored 接进去"的样子）。
function mutateToVendored(src) {
  // ①(P-198 2026-09-25) 形参表允许尾随可选参（P-198 给自研实现加了第 5 个可选参 `search` = 三条新转译规则的
  //   回退口，**不是** siblingSrc）；改名时**原样保留形参表**，变异语义（"把 vendored 接进去"）一字不变。
  const declRe = /export function hlsl2glsl\(src, stage, combos, includeResolver(?:, [A-Za-z_$][\w$]*)?\) \{/
  if (!declRe.test(src)) return { changed: false, note: '找不到自研函数声明（源码已变）' }
  const vendorAbs = path.join(ROOT, 'vendor', 'hlsl2glsl', 'hlsl2glsl.js')
  let out = "import { hlsl2glsl as __vendoredH2G } from " + JSON.stringify(vendorAbs) + "\nconst hlsl2glsl = __vendoredH2G\n" + src
  out = out.replace(declRe, (all) => all.replace('export function hlsl2glsl(', 'export function hlsl2glslInRepoSrcText('))
  return { changed: true, src: out, note: 'in-repo 声明改名 + vendored 注入' }
}
// mock-GL：只做"能被 createRenderer 跑起来 + 捕获 shaderSource"的最小面（与 tests/mock-gl-test.mjs 同源写法）
function mkCaptureGL() {
  const sources = []
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85, FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  let ids = 0
  const mk = (k) => ({ id: k + '#' + (++ids) })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    shaderSource: (s, src) => { sources.push(String(src)) },
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS ? true : k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_TexCoordB: 2, a_Blend: 3, a_Alpha: 4 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0),
  }
  const gl = new Proxy({}, {
    get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    },
  })
  return { sources, canvas: { getContext: () => gl } }
}

console.log('\n' + '─'.repeat(72))
console.log(fail ? '✗ hlsl2glsl 接线证明：' + fail + ' 项失败 / ' + pass + ' 项通过\n  - ' + fails.join('\n  - ') : 'ALL PASS（' + pass + ' 项断言）')
process.exit(fail ? 1 : 0)

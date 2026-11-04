// effect-prelude-common-test.mjs —— ①(ISSUE0924A2 "效果链编译失败"线) 官方效果 shader 的
//   `#include "common.h"` 符号（M_PI_2 / M_PI_HALF / M_PI / SQRT_2 / SQRT_3 / rotateVec2 / greyscale /
//   hsv2rgb / rgb2hsv）在**编译期一定可用**的判据集。
//
// 背景（真因逐行证据见 docs/reports-issue0924a2-line-D.md，本文件只做"会变红"的断言）：
//   · 宿主装载层取头文件的 URL 老写法是 `'/' + name.replace('shaders/','')` ⇒ `/common.h`，而渲染器页
//     宿主的**静态面先命中**这条路径（:8902 实测 404「静态文件不存在：/common.h」）；
//   · 取回的空串又被 `headerCache.set(name, txt || '')` 永久缓存 ⇒ `#include` 被展开成**空**
//     （空串不是 null ⇒ 老 `preprocess()` 连 `// [include 缺失: …]` 都不写）；
//   · ⇒ M_PI_2/rotateVec2 整批符号消失 ⇒ GLSL 编译期 `undeclared identifier` ⇒
//     「跳过编译失败的 pass」⇒ 整条效果链 break ⇒ 该层退化成背景拷贝。
//   实测对拍（本仓 + 真包 shaders/effects/{shake,foliagesway}）：空 include 状态下 M_PI_2 落在
//   转译产物第 **42** 行、rotateVec2 落在第 **50** 行 —— 与用户真机日志的 `0:42` / `0:50` 逐号一致。
//
// 断言分四层（缺语料/缺 glslangValidator 时对应用例 SKIP-视作-PASS，与仓内真包类条件项同口径）：
//   E1 口径      ：内置等价头的数值与官方 `wallpaper_engine/assets/shaders/common.h` **逐值一致**
//                  （M_PI_2 = 2π = 6.28318530718，**不是** π/2），官方函数名一个不缺。
//   E2 防漂移    ：内置头与本仓自研 `shaders/common.h` **token 级相同**（改一边不改另一边 ⇒ 红）。
//   E3 三态解析  ：`makeEffectIncludeResolver()`（生产路径同一份）：服务器正文优先 / 空串 ⇒ 内置兜底 /
//                  没取过 ⇒ 记 missing 回 null；名字归一（`shaders/common.h` ≡ `common.h`）。
//   E4 空串留痕  ：'' 不再被当"包含成功"（产物里必须留 `// [include 缺失: …]`）。
//   E5 真拼装    ：官方资产 + **真包** shader 走生产 `assembleEffectShaderSources()`（模拟 404 宿主）
//                  ⇒ 9 个符号在位 + glslangValidator 真编译 **0 error**。
//   E6 变异必红  ：同一拼装把 resolver 换回 `() => ''`（= 改动前的净效果）⇒ 真编译**必须**报
//                  `undeclared identifier` / `no matching overloaded function found`（E5 的绿不是白来的）。
//   E7 URL 接线  ：`demo.html` 的候选顺序第一项必须是 `/shaders/<base>`（旧 `/common.h` 单拼法不再当主路径）；
//                  两个宿主在跑时按 HTTP 实测第一/第二候选 **200 且含 M_PI_2**。
//
// 用法：node tests/effect-prelude-common-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as lib from '../core/we-scene-bundle.js'
import { ROOT, WS } from './_root.mjs'

let pass = 0
let fail = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const skipNote = (m) => console.log('  SKIP ' + m + '（条件项：缺数据视作 PASS，不红）')
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')

console.log('效果 shader 公共头（common.h）编译期可用性判据（ISSUE0924A2）')

const WE_COMMON = path.join(WS, 'wallpaper_engine', 'assets', 'shaders', 'common.h')
const REPO_COMMON = path.join(ROOT, 'shaders', 'common.h')
const PKG_0923 = path.join(WS, 'allwallpaper', '0923', '2887099508', 'scene.pkg')
const BUILTIN = lib.WE_BUILTIN_SHADER_HEADERS['common.h'] || ''
const SYMBOLS = ['M_PI', 'M_PI_HALF', 'M_PI_2', 'SQRT_2', 'SQRT_3', 'rotateVec2', 'greyscale', 'hsv2rgb', 'rgb2hsv']

/* ── glslangValidator：真编译器（缺则降到"文本判据"档，报告里写明）────────────────────────── */
const HAS_GLSLANG = (() => { try { execFileSync('glslangValidator', ['--version'], { stdio: 'pipe' }); return true } catch { return false } })()
const glslangErrors = (stage, code) => {
  const f = path.join(os.tmpdir(), 'mpw-prelude-' + Math.random().toString(36).slice(2) + (stage === 'vert' ? '.vert' : '.frag'))
  fs.writeFileSync(f, code)
  try {
    execFileSync('glslangValidator', ['-S', stage, f], { stdio: 'pipe' })
    return []
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '')
    return out.split('\n').filter((l) => /ERROR:/.test(l)).map((l) => l.trim())
  } finally { try { fs.unlinkSync(f) } catch {} }
}
/** 注释 + 空白归一后的 token 序列（E2 防漂移比对用；`//` 与 `/* *​/` 都去掉）。 */
const tokensOf = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .match(/[A-Za-z_]\w*|\d+\.?\d*|[^\s\w]/g) || []
const normTokens = (src) => tokensOf(src).join(' ')

console.log('\n== E1 数值口径：与官方 common.h 逐值一致 ==')
ok('E1a 内置头非空（WE_BUILTIN_SHADER_HEADERS["common.h"] 存在）', BUILTIN.length > 0, BUILTIN.length + 'B')
if (!fs.existsSync(WE_COMMON)) {
  skipNote('缺官方资产 ' + WE_COMMON)
} else {
  const off = fs.readFileSync(WE_COMMON, 'utf8')
  const macros = (src) => {
    const m = {}
    for (const ln of String(src).split(/\r?\n/)) {
      // 官方资产是 **CRLF** 行尾 ⇒ 行尾必须容 `\r`（否则一条都对不上，判据会假红）
      const d = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+(-?\d+(?:\.\d+)?)[ \t\r]*$/.exec(ln)
      if (d) m[d[1]] = Number(d[2])
    }
    return m
  }
  const om = macros(off), bm = macros(BUILTIN)
  for (const k of ['M_PI', 'M_PI_HALF', 'M_PI_2', 'SQRT_2', 'SQRT_3']) {
    ok('E1b 宏 ' + k + ' 与官方逐值一致', om[k] !== undefined && bm[k] === om[k], '官方=' + om[k] + ' 内置=' + bm[k])
  }
  // 这条是用户点名的那条：官方名字叫 M_PI_2 但值是 **2π**（整圈），不是 π/2
  ok('E1c ★ M_PI_2 = 2π = 6.28318530718（**不是** π/2=1.5707963…）',
    bm.M_PI_2 === 6.28318530718 && Math.abs(bm.M_PI_2 - 2 * Math.PI) < 1e-9 && Math.abs(bm.M_PI_2 - Math.PI / 2) > 1,
    'M_PI_2=' + bm.M_PI_2)
  ok('E1d M_PI_HALF = π/2（官方口径：这个才是半π）', Math.abs(bm.M_PI_HALF - Math.PI / 2) < 1e-9, 'M_PI_HALF=' + bm.M_PI_HALF)
  // 官方文件里出现的每个函数：内置头必须同名定义
  const fnNames = [...new Set((off.match(/\b(vec[234]|float|mat[234])\s+([A-Za-z_]\w*)\s*\(/g) || [])
    .map((s) => /([A-Za-z_]\w*)\s*\($/.exec(s.trim()) ? /([A-Za-z_]\w*)\s*\($/.exec(s.trim())[1] : null).filter(Boolean))]
  const missingFn = fnNames.filter((f) => !new RegExp('\\b' + f + '\\s*\\(').test(BUILTIN))
  ok('E1e 官方定义的函数在内置头里都有同名实现', missingFn.length === 0, '官方=' + fnNames.join(',') + (missingFn.length ? ' 缺=' + missingFn.join(',') : ''))
  const gw = /dot\(\s*color\s*,\s*vec3\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)\s*\)/.exec(off)
  const bw = /dot\(\s*color\s*,\s*vec3\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)\s*\)/.exec(BUILTIN)
  ok('E1f greyscale 亮度权重与官方一致（0.11/0.59/0.3，写法 0.30 同值）',
    !!gw && !!bw && gw.slice(1).map(Number).every((v, i) => Math.abs(v - Number(bw[i + 1])) < 1e-12),
    '官方=' + (gw ? gw.slice(1).join(',') : '?') + ' 内置=' + (bw ? bw.slice(1).join(',') : '?'))
}
for (const s of SYMBOLS) ok('E1g 内置头含符号 ' + s, new RegExp('\\b' + s + '\\b').test(BUILTIN))

console.log('\n== E2 防漂移：内置头 ≡ 本仓自研 shaders/common.h（token 级）==')
if (!fs.existsSync(REPO_COMMON)) skipNote('缺 ' + REPO_COMMON)
else ok('E2a 内置头与 shaders/common.h 的 token 序列逐项相同（改一边不改另一边 ⇒ 红）',
  normTokens(fs.readFileSync(REPO_COMMON, 'utf8')) === normTokens(BUILTIN),
  'tokens 内置=' + tokensOf(BUILTIN).length + ' 自研=' + tokensOf(fs.readFileSync(REPO_COMMON, 'utf8')).length)

console.log('\n== E3 include 三态解析（makeEffectIncludeResolver = 生产路径同一份）==')
{
  const serverText = '#define M_PI_2 6.28318530718\nvec2 rotateVec2(vec2 v, float r) { return v; }\n'
  const r1 = lib.makeEffectIncludeResolver(new Map([['common.h', serverText]]), new Set())
  ok('E3a 服务器正文优先（逐字返回，不被内置头覆盖）', r1('common.h') === serverText)
  const missing = new Set()
  const r2 = lib.makeEffectIncludeResolver(new Map([['common.h', '']]), missing)
  const fallback = r2('common.h')
  ok('E3b ★ 取过但为空（404/超时）⇒ 内置等价头兜底（不再返回空）', typeof fallback === 'string' && fallback.length > 0 && fallback === BUILTIN)
  ok('E3c 兜底不产生 missing 记录（已解析 ⇒ 不该再触发重取）', missing.size === 0, 'missing=' + missing.size)
  const missing2 = new Set()
  const r3 = lib.makeEffectIncludeResolver(new Map(), missing2)
  ok('E3d 没取过 ⇒ 回 null 并记 missing（由调用方统一取一次）', r3('common.h') === null && missing2.has('common.h'))
  ok('E3e 名字归一：shaders/common.h ≡ common.h ≡ ./common.h',
    lib.resolveEffectInclude('shaders/common.h', '') === BUILTIN && lib.resolveEffectInclude('./common.h', '') === BUILTIN && lib.resolveEffectInclude('COMMON.H', '') === BUILTIN)
  ok('E3f 未收录的头不兜底（返回 null，由调用方按"缺失"记账）', lib.resolveEffectInclude('common_blending.h', '') === null)
}

console.log('\n== E4 空串不再被当"包含成功"（preprocess 留痕）==')
{
  const fake = 'varying vec4 v_TexCoord;\n#include "common.h"\nvoid main() { gl_FragColor = vec4(M_PI_2); }\n'
  const withEmpty = lib.hlsl2glsl(fake, 'frag', {}, () => '')
  ok('E4a 空 include ⇒ 产物留 `// [include 缺失: common.h]` 痕迹（改动前：静默无痕）',
    withEmpty.includes('[include 缺失: common.h]'), withEmpty.split('\n').filter((l) => /缺失/.test(l))[0] || '(无)')
  const withNull = lib.hlsl2glsl(fake, 'frag', {}, () => null)
  ok('E4b null include 同样留痕', withNull.includes('[include 缺失: common.h]'))
  const withBuiltin = lib.hlsl2glsl(fake, 'frag', {}, (f) => lib.resolveEffectInclude(f, ''))
  ok('E4c 兜底路径下无"缺失"痕迹且 M_PI_2 已展开成 6.28318530718',
    !withBuiltin.includes('[include 缺失:') && !/\bM_PI_2\b/.test(withBuiltin) && withBuiltin.includes('6.28318530718'))
}

/* ── E5/E6：官方资产 + 真包 shader，走**生产拼装函数**；宿主按 404（取回空串）模拟 ───────────── */
const official = (name) => {
  const p = path.join(WS, 'wallpaper_engine', 'assets', 'effects', name, 'shaders', 'effects', name)
  const out = {}
  for (const ext of ['frag', 'vert']) { try { out[ext] = fs.readFileSync(p + '.' + ext, 'utf8') } catch { out[ext] = null } }
  return out
}
const pkgShaders = (() => {
  try {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG_0923)))
    return (n) => { const e = pkg.entries.find((x) => x.name === n); return e ? rd(lib.getEntry(pkg, e.name)) : null }
  } catch { return null }
})()

/** 一次"宿主 404"拼装（resolver 走生产三态：cache 里是空串 = 取过但没拿到） */
const assemble404 = (fragSrc, vertSrc, combos = {}) => lib.assembleEffectShaderSources({
  fragSrc, vertSrc, combos,
  resolveInclude: lib.makeEffectIncludeResolver(new Map([['common.h', '']]), new Set()),
})
/** 每个被测对象 = 一对 (frag, vert) + 标签（拼装要按对走：兄弟 stage 的 combo 默认值是同一条链） */
const pairs = []
for (const n of ['shake', 'foliagesway']) {
  const o = official(n)
  if (o.frag) pairs.push({ tag: '官方资产 ' + n, fragSrc: o.frag, vertSrc: o.vert || '' })
}
if (pkgShaders) {
  for (const n of ['shake', 'foliagesway']) {
    const f = pkgShaders('shaders/effects/' + n + '.frag'), v = pkgShaders('shaders/effects/' + n + '.vert')
    if (f) pairs.push({ tag: '真包 0923/2887099508 ' + n, fragSrc: f, vertSrc: v || '' })
  }
} else skipNote('缺真包 ' + PKG_0923 + '（真包那两组用例跳过）')

console.log('\n== E5 生产拼装（模拟 404 宿主）⇒ 符号在位 + 真编译 0 error ==' + (HAS_GLSLANG ? '（glslangValidator）' : '（无 glslangValidator：文本判据档）'))
for (const p of pairs) {
  const asm = assemble404(p.fragSrc, p.vertSrc, {})
  for (const stage of ['frag', 'vert']) {
    const src = stage === 'frag' ? p.fragSrc : p.vertSrc
    if (!src) continue
    const code = stage === 'frag' ? asm.frag : asm.vert
    const need = SYMBOLS.filter((s) => new RegExp('\\b' + s + '\\b').test(src))
    // 源里用到的宏必须被展开成数值；用到的函数必须有定义
    const unresolved = need.filter((s) => (/^[A-Z_0-9]+$/.test(s)
      ? new RegExp('\\b' + s + '\\b').test(code)
      : !new RegExp('\\b(vec[234]|float)\\s+' + s + '\\s*\\(').test(code)))
    const label = p.tag + '.' + stage
    ok('E5a ' + label + '：用到的符号全部解析（' + (need.join(',') || '无') + '）', unresolved.length === 0, unresolved.length ? '未解析=' + unresolved.join(',') : 'ok')
    ok('E5b ' + label + '：产物无 `include 缺失` 痕迹（common.h 已由内置头兜底）', !code.includes('[include 缺失:'), (code.match(/\[include 缺失:[^\]]*\]/g) || []).join(',') || '(无)')
    if (HAS_GLSLANG) {
      const errs = glslangErrors(stage, code)
      const undeclared = errs.filter((l) => /undeclared identifier|no matching overloaded function/.test(l))
      ok('E5c ' + label + '：glslangValidator 真编译 0 error', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '0 error')
      ok('E5d ' + label + '：无 undeclared / no matching overloaded（用户真机那两条报文）', undeclared.length === 0, undeclared.slice(0, 2).join(' | ') || '(无)')
    } else skipNote(label + ' 的真编译（未装 glslangValidator）')
  }
  if (/shake$/.test(p.tag)) {
    ok('E5e ★ ' + p.tag + '.frag：M_PI_2 展开成 6.28318530718（真机 `0:42 undeclared identifier` 那一行）',
      !/\bM_PI_2\b/.test(asm.frag) && asm.frag.includes('6.28318530718'))
  }
  if (/foliagesway$/.test(p.tag)) {
    ok('E5f ★ ' + p.tag + '.vert：rotateVec2 有 vec2 重载且在位（真机 `0:50 no matching overloaded function` 那一行）',
      /\bvec2\s+rotateVec2\s*\(\s*vec2\s+v\s*,\s*float\s+angle\s*\)/.test(asm.vert) && /rotateVec2\(/.test(asm.vert))
  }
}

console.log('\n== E6 变异：resolver 换回"恒空解析"（= 改动前的净效果）⇒ 必红 ==')
// 只对**真的含 `#include "common.h"`** 的源做变异（例如官方 `shake.vert` 根本没 include ⇒ 变异无意义，
// 对它报"没变红"是假红）。源里 include 的清单同时打印出来，便于复核本组用例的覆盖面。
const usesCommonH = (s) => /#include\s+"common\.h"/.test(String(s || ''))
for (const p of pairs) {
  for (const stage of ['frag', 'vert']) {
    const src = stage === 'frag' ? p.fragSrc : p.vertSrc
    if (!src) continue
    const label = p.tag + '.' + stage
    if (!usesCommonH(src)) { skipNote(label + ' 源码里没有 `#include "common.h"` ⇒ 变异不适用'); continue }
    // 变异态 = 老行为：include 一律解析成空串（老 preprocess 对空串按"成功"处理 ⇒ 连痕迹都没有）。
    // 这里用**当前的** preprocess（会把空串判缺失并留痕）以证明"符号真的没了"，两者报错同一类。
    const code = lib.hlsl2glsl(src, stage, {}, () => '')
    const macroLeft = /\b(M_PI|M_PI_2|M_PI_HALF|SQRT_2|SQRT_3)\b/.test(code)
    const fnLeft = /\b(rotateVec2|greyscale|hsv2rgb|rgb2hsv)\b/.test(code)
    ok('E6a ' + label + '：变异态符号确实丢了（宏/函数名残留）', macroLeft || fnLeft, '宏残留=' + macroLeft + ' 函数残留=' + fnLeft)
    ok('E6b ' + label + '：变异态在 GLSL 里留 `include 缺失` 痕迹（改动前是**静默**的）', code.includes('[include 缺失: common.h]'))
    if (HAS_GLSLANG) {
      const errs = glslangErrors(stage, code)
      const hit = errs.filter((l) => /undeclared identifier|no matching overloaded function/.test(l))
      ok('E6c ' + label + '：变异态真编译**必须**报 undeclared / no matching overloaded（E5 的绿不是白来的）',
        hit.length > 0, (hit[0] || errs[0] || '(竟然编译通过)').slice(0, 140))
    } else skipNote(label + ' 的变异真编译（未装 glslangValidator）')
  }
}

console.log('\n== E7 URL 接线：demo.html 候选顺序 + 宿主 HTTP 实测 ==')
{
  const demo = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  const start = demo.indexOf('const headerUrls = (name)')
  const body = start >= 0 ? demo.slice(start, demo.indexOf('};', start) + 2) : ''
  ok('E7a demo.html 的 headerUrls 第一候选是 `/shaders/<base>`（本仓自研头，:8899/:8902 都 200）',
    /return\s*\[\s*'\/shaders\/'\s*\+\s*base\s*,/.test(body.replace(/\s+/g, ' ')), body.replace(/\s+/g, ' ').slice(0, 120))
  ok('E7b 第二候选是 `/weassist/shaders/<base>`（官方头兜底）', /'\/weassist\/shaders\/'\s*\+\s*base/.test(body))
  ok('E7c 旧单拼法 `const url = \'/\' + name.replace(\'shaders/\', \'\')` 已不在主路径（改回去 ⇒ 本项红）',
    !/const url = '\/' \+ name\.replace\('shaders\/', ''\)/.test(demo))
  ok('E7d 失败不再被永久缓存成空头（失败也写时间戳，含退避常量 HEADER_FAIL_RETRY_MS）',
    /HEADER_FAIL_RETRY_MS/.test(demo) && /headerCache\.set\(name, \{ txt: txt \|\| '', at: mpwNowMs\(\) \}\)/.test(demo))
  ok('E7e 取不到时**有告警**（真机日志此前完全静默）', /公共头文件取不到/.test(demo))
  const bundle = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
  ok('E7f 渲染器侧接线在位：getEffectProgram 用 makeEffectIncludeResolver(includeCache, missing)',
    bundle.includes('makeEffectIncludeResolver(includeCache, missing)'))
  // 生产路径**故意**保留"两行 hlsl2glsl"的源码形态（三个既有门禁的探针/变异锚点钉着它，见 bundle 内注释）；
  // 这里断言的是"拼装口径 = 合并兄弟 combo + 逐 stage 转译"这件事在位，而不是某个函数名。
  ok('E7g 渲染器侧接线在位：拼装 = 兄弟 combo 合并 + 逐 stage hlsl2glsl（探针锚点未被改名）',
    bundle.includes("hlsl2glsl(src.frag, 'frag', effectiveCombos, resolver)") &&
    bundle.includes("hlsl2glsl(src.vert, 'vert', effectiveCombos, resolver)") &&
    bundle.includes('frag: withSiblingComboDefaults(fragSrc, vertSrc)'))
  for (const port of [8899, 8902]) {
    const base = 'http://127.0.0.1:' + port
    let hits = 0
    for (const u of ['/shaders/common.h', '/weassist/shaders/common.h']) {
      try {
        const r = await fetch(base + u, { signal: AbortSignal.timeout(4000) })
        const t = await r.text()
        if (r.ok && /M_PI_2/.test(t) && /6\.28318530718/.test(t)) hits++
      } catch { /* 服务没起 */ }
    }
    if (hits === 0) skipNote(':' + port + ' 未运行 ⇒ 跳过该宿主的 HTTP 实测')
    else ok('E7h :' + port + ' 上 headerUrls 的前两个候选至少一个可取到 common.h（含 M_PI_2=2π）', hits > 0, hits + '/2 命中')
  }
}

console.log('\n' + '─'.repeat(72))
console.log(fail
  ? '✗ 效果公共头判据：' + fail + ' 项失败 / ' + pass + ' 项通过\n  - ' + fails.join('\n  - ')
  : 'ALL PASS（' + pass + ' 项断言）' + (HAS_GLSLANG ? '［真编译器档：glslangValidator］' : '［无 glslangValidator ⇒ 文本判据档］'))
process.exit(fail ? 1 : 0)

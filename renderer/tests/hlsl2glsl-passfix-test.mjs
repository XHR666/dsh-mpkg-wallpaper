// hlsl2glsl-passfix-test.mjs —— ①(P-198 2026-09-25 转译线) **四条"整条效果 pass 被静默跳过"的转译缺口**
//   的判据：每条都做到"**改前报文能复现 → 改后 0 error**"，并且**修法关掉必须变红**。
//
// 缺口出处：`docs/reports-renderer-gap-matrix.md` §6.2（同一份清单也登记在
//   `工作区 `docs/` 下的状态汇总文档（`STATUS-ALL-ITEMS`）` 第 1.1 节第 13 条），四条 = 四个真包：
//
//   ① `allwallpaper/0923/3602673806` · `workshop/2795521260/effects/color_grading`
//      链接失败 `Varying 'v_TexCoord' is not linkable between attached shaders`（**本仓独有**）。
//      根因：`.vert:6 varying vec4 v_TexCoord` / `.frag:70 varying vec2 v_TexCoord` —— 转译函数**逐 stage
//      各转各的**（`varying → in/out` 那一步），从不比较两张表的类型；D3D 按寄存器语义容忍宽度差，
//      GLSL ES 链接器不容忍。⇒ 缺的是"转译后的**跨 stage 对账**"，不是某条正则。
//      改法：`reconcileStageVaryings(vertGlsl, fragGlsl)`（顶点侧为准：加宽/收窄**片元 in**，
//      裸引用补 swizzle；顶点侧永不改写）。落点：`core/we-scene-bundle.js` 的 `assembleEffectShaderSources()`
//      **与** 渲染路径 `getEffectProgram()`（链接前）。
//   ② `allwallpaper/0917/3600630828` · `workshop/2084198056/effects/Simple_Audio_Bars`
//      编译失败 `ERROR: 0:488: 'float' : syntax error`（**本仓独有**）。
//      根因：`.frag:16 #define DEG2PCT 0.00277… // 1 / 360` —— 宏登记把**行尾注释一起**当宏体
//      （`(.*)$` 吃到行尾）⇒ `float a = x * DEG2PCT;` 展开成 `… * 0.00277… // 1 / 360;`，**分号被注释吃掉**。
//      C 预处理语义：注释在翻译阶段 3 就换成空白，宏体不含注释。
//      改法：`stripDirectiveComment()`（`expandMacrosIn` / `preprocess` / `collectMacros` 三处登记点）。
//   ③ `allwallpaper/0923/3690417937` · `effects/glitter_prepare`（两边都跳）
//      `.vert:5 varying vec2 v_TexCoord` / `.frag:10 varying vec4 v_TexCoord`（片元只在声明行提到它）。
//      ⇒ 同一个 `reconcileStageVaryings()` 的**收窄**方向。
//   ④ `allwallpaper/0923/3653641024` · `workshop/3485726739/effects/phantomtransitionfx`（两边都跳）
//      4a `ERROR: 0:24: '=' : assigning non-constant to 'const highp float'`
//         —— `.frag:109 const float FEATHER = u_Feather * 0.5;`：GLSL ES 3.0 要求**文件级** const 的初值是
//         常量表达式（去掉 const 也不行：非 const 全局初值同样要求常量表达式）⇒ 只能把初值搬到使用点。
//         改法：`inlineNonConstGlobals()`。
//      4b 4a 修好后**才浮出来**的第二个错 `0:86 '==' : wrong operand types … 'highp float' and 'const int'`
//         —— `.frag:346 gl_FragColor = pixelMask == 1 ? t1 : pixelColor;`（HLSL 允许 `float == int`，
//         GLSL ES 没有 int↔float 的 `==` 重载）。改法：2e3 规则（只认"本文件里 `float <名>` 声明的标量"）。
//
// 断言分四层（缺语料 / 缺 glslangValidator 时对应用例 SKIP-视作-PASS，与仓内真包类条件项同口径）：
//   A 合成夹具   ：四条规则各自 **legacy 报文复现** + **默认 0 error**；含 4 条"不许动"的反向护栏
//                  （片元读超宽分量 / 收窄方向有裸引用 / 同宽幂等 / 多声明符 const / 注释里的 `==`）。
//   B 真包档     ：五个真包（四条缺口 + `0923/3662790108` 的同一族 `color_grading`，真机上是"等满 8s 仍全黑"）
//                  逐条 `legacy ⇒ 原样报文` / `默认 ⇒ stage 编译 0 error + link 0 error`。
//   C 语料对拍   ：有界语料上 `legacy` vs `默认` 逐 stage 真编译 ⇒ **0 回归** + "legacy 能编过的产物
//                  剥注释后逐字节不变"（= 改动不许碰任何现在能编过的代码）。
//   D 变异自证   ：①四个回退口关掉 ⇒ A/B 的"0 error"必须变红；②**真源码切片变异**（副本落 os.tmpdir()）
//                  把修法逐条反转 ⇒ 对应夹具必须变红；③真树 sha256 跑前跑后相同。
//   E 渲染路径   ：mock-GL 捕获 `gl.shaderSource()`：真渲染路径（`getEffectProgram`）送进 GL 的 frag
//                  **真的**被对账过（`in vec4`）；同一夹具的**切片变异**（删掉渲染路径那两行）⇒ 变回 `in vec2`。
//
// 回退口（四条，缺省全开；主表见 docs/README-DIAGNOSTICS.md）：
//   `?macrocomment=legacy` · `?constglobal=legacy` · `?cmpint=legacy` · `?varyinglink=legacy`
//
// 用法：node tests/hlsl2glsl-passfix-test.mjs
//       MPW_P198_CORPUS=1 node tests/hlsl2glsl-passfix-test.mjs       # C 段全语料对拍（默认只跑有界子集）
//       MPW_P198_MAX_MB=200 node tests/hlsl2glsl-passfix-test.mjs    # C 段单包体积上限（默认 128MB）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import * as LIB from '../core/we-scene-bundle.js'
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
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

console.log('P-198 效果 pass 转译缺口判据（① ② ③ ④）')

// ── 真编译器档（glslangValidator；缺了就整档 SKIP-视作-PASS）──
let GLSLANG = true
try { execFileSync('glslangValidator', ['--version'], { stdio: 'pipe' }) } catch { GLSLANG = false }
const COMPILE_SKIP = { ok: null, err: 'SKIP（无 glslangValidator）' }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p198-'))
let seq = 0
const compiles = (stage, src) => {
  if (!GLSLANG) return COMPILE_SKIP
  const f = path.join(TMP, 'c' + (++seq) + '.' + stage)
  fs.writeFileSync(f, src)
  try { execFileSync('glslangValidator', ['-S', stage, f], { stdio: 'pipe' }); return { ok: true, err: '' } } catch (e) {
    const o = ((e.stdout ? Buffer.from(e.stdout).toString() : '') + (e.stderr ? Buffer.from(e.stderr).toString() : '')).trim()
    return { ok: false, err: (o.split('\n').find((l) => /ERROR/.test(l)) || o.split('\n')[0] || 'EXIT ' + e.status).trim() }
  }
}
const links = (vert, frag) => {
  if (!GLSLANG) return COMPILE_SKIP
  const vf = path.join(TMP, 'l' + (++seq) + '.vert')
  const ff = path.join(TMP, 'l' + seq + '.frag')
  fs.writeFileSync(vf, vert); fs.writeFileSync(ff, frag)
  try { execFileSync('glslangValidator', ['-l', vf, ff], { stdio: 'pipe' }); return { ok: true, err: '' } } catch (e) {
    const o = ((e.stdout ? Buffer.from(e.stdout).toString() : '') + (e.stderr ? Buffer.from(e.stderr).toString() : '')).trim()
    return { ok: false, err: o.split('\n').filter((l) => /ERROR|stage:/.test(l)).slice(0, 3).join(' ').trim() }
  }
}
// 注释挖空（保长度、保换行）：用于"改动只落在注释里"的判定
const blank = (s) => {
  let o = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') { o += ' '; i++ } o += '\n'; continue }
    if (s[i] === '/' && s[i + 1] === '*') {
      o += '  '; i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { o += (s[i] === '\n' ? '\n' : ' '); i++ }
      o += '  '; i++
      continue
    }
    o += s[i]
  }
  return o
}

const LEGACY_ALL = '?macrocomment=legacy&constglobal=legacy&cmpint=legacy&varyinglink=legacy'
const legacyOf = (k) => '?' + k + '=legacy'
/** 走生产纯函数镜像跑一对 stage：`search` 为 null ⇒ 全部规则缺省档。 */
const asm = (fragSrc, vertSrc, search, combos = {}) =>
  LIB.assembleEffectShaderSources({ fragSrc, vertSrc, combos, resolveInclude: null, search })

/* ═══════════════════════ A 合成夹具（不需语料/网络）═══════════════════════ */
console.log('\n== A 合成夹具：四条规则各自"legacy 报文复现 / 缺省 0 error" ==')

// A1 ② `#define` 行尾注释
const SRC_DEF_V = 'attribute vec3 a_Position; uniform mat4 g_ModelViewProjectionMatrix; void main(){ gl_Position = mul(vec4(a_Position, 1.0), g_ModelViewProjectionMatrix); }\n'
const SRC_DEF_F = [
  'uniform sampler2D g_Texture0;',
  'varying vec2 v_TexCoord;',
  '#define DEG2PCT 0.0027777777777777777777777777777 // 1 / 360',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * DEG2PCT; }',
].join('\n')
{
  const a = asm(SRC_DEF_F, SRC_DEF_V, LEGACY_ALL).frag
  const b = asm(SRC_DEF_F, SRC_DEF_V, null).frag
  ok('A1a ② legacy：宏体带注释 ⇒ 展开把行尾 `;` 吃掉（产物里能看见 `// 1 / 360;`）', /\/\/ 1 \/ 360;/.test(a),
    (a.split('\n').find((l) => /1 \/ 360/.test(l)) || '(未命中)').trim().slice(0, 90))
  const ca = compiles('frag', a)
  ok('A1b ② legacy：真编译器复现 `syntax error`（报文与真包同族）',
    ca.ok === null || (ca.ok === false && /syntax error/i.test(ca.err)), ca.err.slice(0, 110))
  const cb = compiles('frag', b)
  ok('A1c ② 缺省：产物里宏体不含注释、真编译 0 error', !/1 \/ 360/.test(b) && (cb.ok === null || cb.ok === true), cb.err.slice(0, 110))
}
// A1d 边界：`#define X // 只有注释` ⇒ 宏体按 C 语义是**空**（本仓既有约定：空体展开成 `1`），不许把后面代码注释掉
{
  const src = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;', '#define FLAG // 只有注释', 'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * 1.0; }'].join('\n')
  const b = asm(src, SRC_DEF_V, null).frag
  ok('A1d ② 边界：`#define X // 注释`（空体）不把后续代码注释掉，真编译 0 error',
    (compiles('frag', b).ok !== false) && !/\/\/ 只有注释/.test(b), (b.split('\n').find((l) => /FLAG|只有注释/.test(l)) || '(无残留)').trim().slice(0, 80))
}
// A1e 边界：`#if` 求值吃到注释（`preprocess()` 的 defs 也要剥）
//   现场取 `#if ON == 0`（**假**条件）：legacy 会把 `(1 // 开关) == 0` 喂给自写求值器 —— 它在 `//` 处
//   读不到 `==`，于是把整个条件当**真**（走错分支）；缺省档剥掉注释 ⇒ 正确判假。
{
  const src = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;', '#define ON 1 // 开关', '#if ON == 0', 'float p198on = 7.0;', '#else', 'float p198on = 2.0;', '#endif',
    'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * p198on; }'].join('\n')
  const a = asm(src, SRC_DEF_V, LEGACY_ALL).frag
  const b = asm(src, SRC_DEF_V, null).frag
  ok('A1e ② 边界：`#define ON 1 // 开关` + `#if ON == 0`（假）⇒ 缺省判假走 `#else`（2.0），legacy 把条件算成真',
    /p198on = 2\.0/.test(b) && /p198on = 7\.0/.test(a), 'legacy=7.0(错) 缺省=2.0(对)')
}

// A2 ④ 文件级 const 依赖 uniform
const SRC_CONST_F = [
  'uniform sampler2D g_Texture0;',
  'uniform float u_Feather;',
  'varying vec2 v_TexCoord;',
  'const float FEATHER = u_Feather * 0.5;',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * FEATHER; }',
].join('\n')
{
  const a = asm(SRC_CONST_F, SRC_DEF_V, LEGACY_ALL).frag
  const b = asm(SRC_CONST_F, SRC_DEF_V, null).frag
  const ca = compiles('frag', a)
  ok('A2a ④ legacy：真编译器复现 `global const initializers must be constant`',
    ca.ok === null || (ca.ok === false && /const initializers must be constant/.test(ca.err)), ca.err.slice(0, 120))
  const cb = compiles('frag', b)
  ok('A2b ④ 缺省：声明被"内联 + 留痕"替换，真编译 0 error',
    (cb.ok === null || cb.ok === true) && /\[P-198 ④ 内联非常量全局 const：FEATHER = u_Feather \* 0\.5\]/.test(b) && /\(u_Feather \* 0\.5\)/.test(b),
    cb.err.slice(0, 110))
}
// A2c 边界：多声明符不内联（不静默）
{
  const src = ['uniform sampler2D g_Texture0;', 'uniform float u_F;', 'varying vec2 v_TexCoord;',
    'const float p198a = u_F * 0.5, p198b = 1.0;', 'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * p198a * p198b; }'].join('\n')
  LIB.h2gPassFixStatsReset()
  const b = asm(src, SRC_DEF_V, null).frag
  const st = LIB.h2gPassFixStats
  ok('A2c ④ 边界：多声明符 `const float a = u*0.5, b = 1.0;` **不内联**、原样保留 + 计数',
    /const float p198a = u_F \* 0\.5, p198b = 1\.0;/.test(b) && st.constGlobalKeep === 1 && st.constGlobalKeepReasons['多声明符'] === 1,
    JSON.stringify({ keep: st.constGlobalKeep, reasons: st.constGlobalKeepReasons }))
}

// A3 ④-b 标量 float 与裸整数字面量比较
const SRC_CMP_F = [
  'uniform sampler2D g_Texture0;',
  'uniform float u_M;',
  'varying vec2 v_TexCoord;',
  'void main(){ float pixelMask = texture(g_Texture0, v_TexCoord).r * u_M;',
  '  gl_FragColor = pixelMask == 1 ? vec4(1.0) : vec4(0.0); }',
].join('\n')
{
  const a = asm(SRC_CMP_F, SRC_DEF_V, LEGACY_ALL).frag
  const b = asm(SRC_CMP_F, SRC_DEF_V, null).frag
  const ca = compiles('frag', a)
  ok('A3a ④-b legacy：真编译器复现 `wrong operand types … float … int`',
    ca.ok === null || (ca.ok === false && /wrong operand types/.test(ca.err) && /int/.test(ca.err)), ca.err.slice(0, 130))
  const cb = compiles('frag', b)
  ok('A3b ④-b 缺省：字面量补 `.0`，真编译 0 error', /pixelMask == 1\.0/.test(b) && (cb.ok === null || cb.ok === true), cb.err.slice(0, 110))
}
// A3c 边界：注释里的 `sat == 0` 一个字符都不许动
{
  const src = ['uniform sampler2D g_Texture0;', 'uniform float u_S;', 'varying vec2 v_TexCoord;',
    'void main(){ float sat = u_S; // sat == 0 时按 0 处理', '  gl_FragColor = texture(g_Texture0, v_TexCoord) * sat; }'].join('\n')
  const b = asm(src, SRC_DEF_V, null).frag
  ok('A3c ④-b 边界：注释正文里的 `sat == 0` **不被改写**（只改注释之外的正文）', /\/\/ sat == 0 时按 0 处理/.test(b),
    (b.split('\n').find((l) => /sat ==/.test(l)) || '(未命中)').trim().slice(0, 90))
}

// A4 ① 顶点更宽 ⇒ 加宽片元 + 裸引用补 swizzle
const V_WIDE = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix;\nvarying vec4 v_TexCoord;\nvoid main(){ gl_Position = mul(vec4(a_Position, 1.0), g_ModelViewProjectionMatrix); v_TexCoord.xy = a_TexCoord; }\n'
const F_NARROW_BARE = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;',
  'void main(){ vec2 uv = v_TexCoord - 0.5; gl_FragColor = texture(g_Texture0, v_TexCoord) + vec4(uv, 0.0, 0.0); }'].join('\n')
{
  const a = asm(F_NARROW_BARE, V_WIDE, LEGACY_ALL)
  const b = asm(F_NARROW_BARE, V_WIDE, null)
  const la = links(a.vert, a.frag)
  ok('A4a ① legacy：单 stage 各自编过、**链接**才报 `Types must match`（这就是"整条 pass 被跳过"的现场）',
    la.ok === null || (la.ok === false && /Types must match/.test(la.err)), la.err.slice(0, 130))
  const lb = links(b.vert, b.frag)
  ok('A4b ① 缺省：片元 `in` 加宽到 vec4、裸引用补 `.xy` ⇒ 链接 0 error',
    (lb.ok === null || lb.ok === true) && /^\s*in vec4 v_TexCoord;/m.test(b.frag) && /v_TexCoord\.xy - 0\.5/.test(b.frag) && /texture\(g_Texture0, v_TexCoord\.xy\)/.test(b.frag),
    lb.err.slice(0, 110))
  ok('A4c ① 顶点侧**永不改写**（收窄顶点会丢掉它确实写入的分量）', b.vert === a.vert)
}
// A5 ③ 片元更宽 ⇒ 收窄片元（片元只在声明行提到它）
const V_NARROW = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix;\nvarying vec2 v_TexCoord;\nvoid main(){ gl_Position = mul(vec4(a_Position, 1.0), g_ModelViewProjectionMatrix); v_TexCoord.xy = a_TexCoord; }\n'
const F_WIDE_UNUSED = ['uniform sampler2D g_Texture0;', 'varying vec4 v_TexCoord;',
  'void main(){ gl_FragColor = texture(g_Texture0, vec2(0.5, 0.5)); }'].join('\n')
{
  const a = asm(F_WIDE_UNUSED, V_NARROW, LEGACY_ALL)
  const b = asm(F_WIDE_UNUSED, V_NARROW, null)
  const la = links(a.vert, a.frag)
  const lb = links(b.vert, b.frag)
  ok('A5a ③ legacy：链接复现 `Types must match`（vert vec2 / frag vec4）',
    la.ok === null || (la.ok === false && /Types must match/.test(la.err)), la.err.slice(0, 130))
  ok('A5b ③ 缺省：片元 `in` 收窄到 vec2 ⇒ 链接 0 error',
    (lb.ok === null || lb.ok === true) && /^\s*in vec2 v_TexCoord;/m.test(b.frag), lb.err.slice(0, 110))
}
// A6 边界：片元读了超出顶点宽度的分量 ⇒ **不许**收窄（原样 + 计数）
{
  const f = ['uniform sampler2D g_Texture0;', 'varying vec4 v_TexCoord;',
    'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord.zw); }'].join('\n')
  LIB.h2gPassFixStatsReset()
  const b = asm(f, V_NARROW, null)
  const st = LIB.h2gPassFixStats
  ok('A6 ③ 边界：片元读了 `.zw`（超出顶点宽度）⇒ 不动 + `varyingUnresolved` 计数带原因',
    /^\s*in vec4 v_TexCoord;/m.test(b.frag) && st.varyingUnresolved === 1 && st.varyingUnresolvedReasons['v_TexCoord:片元读了超出顶点宽度的分量'] === 1,
    JSON.stringify({ unresolved: st.varyingUnresolved, reasons: st.varyingUnresolvedReasons }))
}
// A7 边界：收窄方向上片元还有**裸引用** ⇒ 不动（宽度语义不可确证）
{
  const f = ['uniform sampler2D g_Texture0;', 'varying vec4 v_TexCoord;',
    'void main(){ vec4 c = v_TexCoord; gl_FragColor = texture(g_Texture0, c.xy); }'].join('\n')
  LIB.h2gPassFixStatsReset()
  const b = asm(f, V_NARROW, null)
  const st = LIB.h2gPassFixStats
  ok('A7 ③ 边界：收窄方向片元仍有裸引用 ⇒ 不动 + 计数带原因',
    /^\s*in vec4 v_TexCoord;/m.test(b.frag) && st.varyingUnresolvedReasons['v_TexCoord:收窄方向片元仍有裸引用'] === 1,
    JSON.stringify(st.varyingUnresolvedReasons))
}
// A8 幂等：两侧同宽 ⇒ 逐字节不变 + 计数全 0
{
  LIB.h2gPassFixStatsReset()
  const a = asm(F_NARROW_BARE, V_NARROW, LEGACY_ALL)
  const b = asm(F_NARROW_BARE, V_NARROW, null)
  const st = LIB.h2gPassFixStats
  ok('A8 ①③ 幂等：两侧同宽 ⇒ 两个 stage 逐字节相同、对账计数全 0',
    a.frag === b.frag && a.vert === b.vert && st.varyingWiden === 0 && st.varyingNarrow === 0 && st.varyingUnresolved === 0)
}

/* ═══════════════════════ B 真包档（条件项：语料不在就 SKIP）═══════════════════════ */
console.log('\n== B 真包档：四条缺口的"改前报文 / 改后 0 error"逐条对拍 ==')
const HEADERS = path.join(ROOT, 'shaders')
const readHeader = (f) => {
  const p = path.join(HEADERS, f)
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  return LIB.builtinShaderHeader ? LIB.builtinShaderHeader(f) : null
}
const CASES = [
  { tag: '①', dir: '0923/3602673806', shader: 'workshop/2795521260/effects/color_grading', kind: 'link', before: /Types must match/, why: 'varying 宽度跨 stage 不一致（vert vec4 / frag vec2）' },
  { tag: '②', dir: '0917/3600630828', shader: 'workshop/2084198056/effects/Simple_Audio_Bars', kind: 'compile', before: /syntax error/, why: '`#define DEG2PCT … // 1 / 360` 的行尾注释进了宏体' },
  { tag: '③', dir: '0923/3690417937', shader: 'effects/glitter_prepare', kind: 'link', before: /Types must match/, why: 'varying 宽度跨 stage 不一致（vert vec2 / frag vec4）' },
  { tag: '④', dir: '0923/3653641024', shader: 'workshop/3485726739/effects/phantomtransitionfx', kind: 'compile', before: /const initializers must be constant/, why: '文件级 const 依赖 uniform（+ 第二个 `float == int`）' },
  { tag: '⑤', dir: '0923/3662790108', shader: 'workshop/3637654840/effects/color_grading', kind: 'link', before: /Types must match/, why: '同一族 color_grading（真机读数"等满 8s 仍全黑"，见 §6.2 的第 4 位小数）' },
]
let corpusRows = null
const missing = []
for (const c of CASES) {
  const pkgPath = path.join(WS, 'allwallpaper', c.dir, 'scene.pkg')
  if (!fs.existsSync(pkgPath)) { missing.push(c.dir); continue }
  let pkg, scene
  try {
    pkg = LIB.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
    scene = LIB.parseScene(JSON.parse(rd(LIB.getEntry(pkg, 'scene.json'))), null)
  } catch (e) { skipNote(c.tag + ' ' + c.dir + ' 解析失败（' + String(e && e.message).slice(0, 60) + '）'); continue }
  // 找**可见层**效果链上的这个 pass，拿它真实的 combos
  let hit = null
  for (const L of scene.layers) {
    if (!L.visible) continue
    for (const e of L.effects || []) {
      try { LIB.resolveEffectChain(pkg, e, rd) } catch { continue }
      const ps = e.materialPasses || []
      for (let i = 0; i < ps.length; i++) {
        if (ps[i].shader !== c.shader) continue
        hit = { combos: { ...(ps[i].combos || {}), ...(((e.passes || [])[i] || {}).combos || {}) } }
      }
      if (hit) break
    }
    if (hit) break
  }
  if (!hit) { skipNote(c.tag + ' ' + c.dir + '：场景里没有可见层引用 ' + c.shader); continue }
  const v = rd(LIB.getEntry(pkg, 'shaders/' + c.shader + '.vert'))
  const f = rd(LIB.getEntry(pkg, 'shaders/' + c.shader + '.frag'))
  const combo = JSON.stringify(hit.combos)
  const A = LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos: hit.combos, resolveInclude: readHeader, search: LEGACY_ALL })
  const B = LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos: hit.combos, resolveInclude: readHeader })
  const probe = (g) => (c.kind === 'link'
    ? { stage: compiles('vert', g.vert).ok !== false && compiles('frag', g.frag).ok !== false ? links(g.vert, g.frag) : { ok: false, err: '(stage 编译失败)' }, l: true }
    : { stage: compiles('frag', g.frag), l: false })
  const pa = probe(A), pb = probe(B)
  const ea = c.kind === 'link' ? pa.stage.err : (compiles('frag', A.frag).err)
  ok(c.tag + 'a 改前报文复现（legacy）· ' + c.why, pa.stage.ok === null || (pa.stage.ok === false && c.before.test(ea)), ea.slice(0, 120))
  ok(c.tag + 'b 改后 stage 编译 0 error · ' + c.shader, pb.stage.ok === null || pb.stage.ok === true, (pb.stage.err || '').slice(0, 110))
  if (c.kind === 'link') {
    const lb = links(B.vert, B.frag)
    ok(c.tag + 'c 改后 **链接** 0 error（整条 pass 不再被跳过）', lb.ok === null || lb.ok === true, lb.err.slice(0, 110))
  }
  console.log('      combos=' + combo)
}
if (missing.length) skipNote('语料缺这些包（换机/换语料时按条件项）：' + missing.join(', '))

/* ═══════════════════════ C 语料对拍（0 回归）═══════════════════════ */
console.log('\n== C 语料对拍：`legacy` vs `缺省` 逐 stage 真编译（0 回归 + 剥注释逐字节不变）==')
{
  const MAX_ONE_MB = Number(process.env.MPW_P198_MAX_MB || 128)
  const FULL = process.env.MPW_P198_CORPUS === '1'
  const MAX_PKGS = Number(process.env.MPW_P198_MAX_PKGS || (FULL ? 999 : 4))
  const MAX_ALL_MB = Number(process.env.MPW_P198_MAX_ALL_MB || (FULL ? 4096 : 320))
  const roots = ['dd', '0923', '0917', 'wallpaperE']
  const cands = []
  for (const root of roots) {
    const d = path.join(WS, 'allwallpaper', root)
    if (!fs.existsSync(d)) continue
    for (const id of fs.readdirSync(d)) {
      const p = path.join(d, id, 'scene.pkg')
      if (!fs.existsSync(p)) continue
      const mb = fs.statSync(p).size / 1048576
      if (mb > MAX_ONE_MB) continue
      cands.push({ root, id, p, mb })
    }
  }
  cands.sort((a, b) => a.mb - b.mb)
  const picked = []
  let sum = 0
  for (const c of cands) { if (picked.length >= MAX_PKGS || sum + c.mb > MAX_ALL_MB) break; picked.push(c); sum += c.mb }
  if (!picked.length) skipNote('找不到语料（' + WS + '/allwallpaper）')
  else {
    const rows = []
    for (const c of picked) {
      let pkg, scene
      try {
        pkg = LIB.parsePkg(new Uint8Array(fs.readFileSync(c.p)))
        scene = LIB.parseScene(JSON.parse(rd(LIB.getEntry(pkg, 'scene.json'))), null)
      } catch { continue }
      const seen = new Set()
      for (const L of scene.layers) {
        if (!L.visible) continue
        for (const e of L.effects || []) {
          if (!e.visible) continue
          try { LIB.resolveEffectChain(pkg, e, rd) } catch { continue }
          const ps = e.materialPasses || []
          for (let i = 0; i < ps.length; i++) {
            const mp = ps[i]
            if (!mp.shader || mp.copyCommand) continue
            const combos = { ...(mp.combos || {}), ...(((e.passes || [])[i] || {}).combos || {}) }
            const key = mp.shader + '|' + JSON.stringify(combos)
            if (seen.has(key)) continue
            seen.add(key)
            const ve = LIB.getEntry(pkg, 'shaders/' + mp.shader + '.vert')
            const fe = LIB.getEntry(pkg, 'shaders/' + mp.shader + '.frag')
            if (ve === null || fe === null) continue
            const v = rd(ve), f = rd(fe)
            const a = LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos, resolveInclude: readHeader, search: LEGACY_ALL })
            const b = LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos, resolveInclude: readHeader })
            for (const st of ['frag', 'vert']) {
              const ca = compiles(st, a[st])
              const cb = a[st] === b[st] ? ca : compiles(st, b[st])
              const la = ca.ok === true ? links(a.vert, a.frag) : null
              const lb = (cb.ok === true && la) ? (a.vert === b.vert && a.frag === b.frag ? la : links(b.vert, b.frag)) : null
              rows.push({
                id: c.root + '/' + c.id + '::' + mp.shader + '.' + st, stage: st,
                beforeOk: ca.ok === true && (!la || la.ok === true),
                afterOk: cb.ok === true && (!lb || lb.ok === true),
                sameCode: blank(a[st]) === blank(b[st]), byteSame: a[st] === b[st],
              })
            }
          }
        }
      }
    }
    corpusRows = rows
    const strict = GLSLANG && rows.length > 0
    console.log('  语料: ' + picked.length + '/' + cands.length + ' 包（单包 ≤' + MAX_ONE_MB + 'MB，累计 ≤' + MAX_ALL_MB + 'MB' +
      (FULL ? '，MPW_P198_CORPUS=1' : '，有界子集') + '）· 作业 ' + rows.length + ' 个 stage')
    if (!strict) skipNote('无 glslangValidator 或语料为空 ⇒ C 段只记读数')
    else {
      const regress = rows.filter((r) => r.beforeOk && !r.afterOk)
      ok('C1 **0 回归**：legacy 能编译+链接的 stage，缺省档必须也能（' + rows.filter((r) => r.beforeOk).length + ' 个基线绿）',
        regress.length === 0, regress.slice(0, 4).map((r) => r.id).join(' | '))
      const semantic = rows.filter((r) => r.beforeOk && r.afterOk && !r.sameCode)
      ok('C2 legacy 能编过的产物 ⇒ 缺省档**剥注释后逐字节不变**（改动只落在注释里或本来编不过的 shader 上）',
        semantic.length === 0, semantic.slice(0, 4).map((r) => r.id).join(' | '))
      const fixed = rows.filter((r) => !r.beforeOk && r.afterOk)
      console.log('  · 读数：改前过 ' + rows.filter((r) => r.beforeOk).length + ' / 改后过 ' + rows.filter((r) => r.afterOk).length +
        ' / 修好 ' + fixed.length + ' / 仍不过 ' + rows.filter((r) => !r.beforeOk && !r.afterOk).length +
        ' / 逐字节有变 ' + rows.filter((r) => !r.byteSame).length)
      for (const r of fixed.slice(0, 10)) console.log('    ✅ ' + r.id)
    }
  }
}

/* ═══════════════════════ D 变异自证 ═══════════════════════ */
console.log('\n== D 变异自证（RED-IF-REVERTED）==')
// D1 四个回退口：关掉 ⇒ A 段对应夹具必须回到 legacy 产物（= A 段的 a/b 判定会翻转）
{
  const pairs = [
    ['macrocomment', SRC_DEF_F, 'frag', /1 \/ 360;/],
    ['constglobal', SRC_CONST_F, 'frag', /global const initializers must be constant|const float FEATHER = u_F?e?ather/],
    ['cmpint', SRC_CMP_F, 'frag', /== 1 ?\?/],
    ['varyinglink', F_NARROW_BARE, 'frag', /^\s*in vec2 v_TexCoord;/m],
  ]
  let red = 0
  for (const [k, src, stage, re] of pairs) {
    const withOff = asm(src, k === 'varyinglink' ? V_WIDE : SRC_DEF_V, legacyOf(k))
    const on = asm(src, k === 'varyinglink' ? V_WIDE : SRC_DEF_V, null)
    const off = withOff[stage]
    if (off !== on[stage] && re.test(off)) red++
    else console.log('    （' + k + ' 回退口未改变产物：' + JSON.stringify(off.split('\n').find((l) => re.test(l)) || '(未命中)') + '）')
  }
  ok('D1 四个回退口各自能**关掉**对应修法（关掉后产物回到改动前形态）', red === 4, red + '/4')
}
// D2 真源码切片变异：把四条修法逐条反转 ⇒ 对应夹具必须变红（副本落 os.tmpdir()，真树只读）
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const MUTANTS = [
  { tag: 'macrocomment（宏体不剥注释）', from: 'const body = fx.macroComment ? stripDirectiveComment(dm[3]).trim() : dm[3].trim()', to: 'const body = dm[3].trim()',
    probe: (m) => /\/\/ 1 \/ 360;/.test(m.assembleEffectShaderSources({ fragSrc: SRC_DEF_F, vertSrc: SRC_DEF_V, combos: {}, resolveInclude: null }).frag) },
  { tag: 'constglobal（不内联非常量全局 const）', from: '  if (fixes.constGlobal) code = inlineNonConstGlobals(code, h2gPassFixStats)', to: '',
    probe: (m) => /const float FEATHER = u_Feather \* 0\.5;/.test(m.assembleEffectShaderSources({ fragSrc: SRC_CONST_F, vertSrc: SRC_DEF_V, combos: {}, resolveInclude: null }).frag) },
  { tag: 'cmpint（比较不补 .0）', from: '  if (floatScalarNames.size && fixes.cmpInt) {', to: '  if (false) {',
    probe: (m) => /pixelMask == 1 \?/.test(m.assembleEffectShaderSources({ fragSrc: SRC_CMP_F, vertSrc: SRC_DEF_V, combos: {}, resolveInclude: null }).frag) },
  { tag: 'varyinglink（不对账跨 stage 宽度）', from: '  const rec = reconcileStageVaryings(vert, frag, search)', to: '  const rec = { frag, vert, changed: false }',
    probe: (m) => /^\s*in vec2 v_TexCoord;/m.test(m.assembleEffectShaderSources({ fragSrc: F_NARROW_BARE, vertSrc: V_WIDE, combos: {}, resolveInclude: null }).frag) },
]
const shaOf = (f) => execFileSync('sha256sum', [f], { encoding: 'utf8' }).split(/\s+/)[0]
// 变异副本落 os.tmpdir() 时必须把 `from './xxx.mjs'` 改成绝对路径（bundle 是切片拼装产物，有兄弟模块；
// 写法与 tests/hlsl2glsl-width-table-test.mjs:536 / hlsl2glsl-wiring-test.mjs:244 同源）
const toTempModule = (src) => src.replace(/from '\.\/([^']+)'/g, (all, f) => 'from ' + JSON.stringify(path.join(ROOT, 'core', f)))
{
  const realShaBefore = shaOf(BUNDLE)
  const realSrc = fs.readFileSync(BUNDLE, 'utf8')
  let redOk = 0
  for (const mu of MUTANTS) {
    if (realSrc.split(mu.from).length !== 2) { ok('D2 ' + mu.tag + '：切片在真源码里恰好一次', false, '锚点不在源码里或出现多次'); continue }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p198mut-'))
    const fp = path.join(dir, 'we-scene-bundle.js')
    fs.writeFileSync(fp, toTempModule(realSrc.replace(mu.from, mu.to)))
    let red = false
    try {
      const m = await import(pathToFileURL(fp).href)
      red = mu.probe(m)
    } catch (e) { red = false; console.log('    （变异模块跑不起来：' + String(e && e.message).slice(0, 90) + '）') }
    finally { fs.rmSync(dir, { recursive: true, force: true }) }
    ok('D2 ' + mu.tag + ' ⇒ 对应夹具回到改动前形态（判据会红）', red)
    if (red) redOk++
  }
  ok('D3 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（变异只落 os.tmpdir() 副本）', shaOf(BUNDLE) === realShaBefore, realShaBefore.slice(0, 16))
  console.log('    MUTANT-RED-OK ' + redOk + '/' + MUTANTS.length + ' 组切片变异各自命中')
}

/* ═══════════════════════ E 渲染路径端到端（mock-GL）═══════════════════════ */
console.log('\n== E 渲染路径端到端：`getEffectProgram` 送进 `gl.shaderSource()` 的 frag 真的对过账 ==')
{
  // mock-GL 最小面（与 tests/effects-degenerate-fbo-test.mjs / hlsl2glsl-wiring-test.mjs 同源写法）
  const CONST = {
    LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, SAMPLER_2D: 0x8B5E,
  }
  const mkGL = () => {
    const glsl = []
    let ids = 0
    const mk = (k) => ({ id: k + '#' + (++ids) })
    const handlers = {
      createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
      createShader: () => mk('sh'), createProgram: () => mk('prog'),
      shaderSource: (s, src) => glsl.push(String(src)),
      getProgramParameter: (p, k) => (k === CONST.LINK_STATUS ? true : k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
      getActiveUniform: () => ({ name: 'g_Texture0', type: CONST.SAMPLER_2D }),
      getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
      getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1 }[n] ?? -1),
      getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
      checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
      getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0), getShaderInfoLog: () => '', getProgramInfoLog: () => '',
      activeTexture: () => {}, bindTexture: () => {}, bindFramebuffer: () => {}, useProgram: () => {}, drawArrays: () => {},
    }
    const gl = new Proxy({}, {
      get(t, prop) {
        if (prop in handlers) return handlers[prop]
        if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
        return () => {}
      },
    })
    return { gl, glsl }
  }
  const layer = {
    id: 1, name: 'p198载体', visible: true, solid: true, isContainer: false, textureName: null,
    size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center',
    color: [1, 1, 1], alpha: 1, brightness: 1, particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined,
    effects: [{ file: 'fx_p198', visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [],
      materialPasses: [{ shader: 'p198_varying', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} }] }],
  }
  const scene = { general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, layers: [layer], properties: {} }
  const resolver = async (rel) => (rel.endsWith('.vert') ? V_WIDE : F_NARROW_BARE)
  const renderOnce = async (m) => {
    const { gl, glsl } = mkGL()
    const r = m.createRenderer({ getContext: () => gl, width: 3840, height: 2160 }, { shaderResolver: resolver, onLog: () => {} })
    await r.render(scene, new Map(), 3840, 2160, 1.0)
    return glsl
  }
  try {
    const glsl = await renderOnce(LIB)
    const frag = glsl.filter((s) => /fragColor|gl_FragColor/.test(s))
    ok('E1 渲染路径真送出了对账后的 frag（`in vec4 v_TexCoord;` + `.xy` 补在裸引用上）',
      frag.some((s) => /^\s*in vec4 v_TexCoord;/m.test(s) && /v_TexCoord\.xy - 0\.5/.test(s)),
      frag.length + ' 段 frag GLSL')
    // E2 同一夹具的**渲染路径切片变异**（删掉链接前那一步）⇒ 送出未对账的 frag
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p198wire-'))
    const fp = path.join(dir, 'we-scene-bundle.js')
    const from = '      const rec = reconcileStageVaryings(vertGlsl, fragGlsl)\n      const fragLinked = rec.changed ? rec.frag : fragGlsl\n      const vertLinked = rec.changed ? rec.vert : vertGlsl\n'
    const to = '      const fragLinked = fragGlsl\n      const vertLinked = vertGlsl\n'
    const src = fs.readFileSync(BUNDLE, 'utf8')
    let red = false
    let anchored = false
    try {
      if (src.split(from).length !== 2) console.log('    （渲染路径切片锚点不在源码里）')
      else {
        anchored = true
        fs.writeFileSync(fp, toTempModule(src.replace(from, to)))
        const m = await import(pathToFileURL(fp).href)
        const glsl2 = await renderOnce(m)
        const frag2 = glsl2.filter((s) => /fragColor|gl_FragColor/.test(s))
        red = frag2.some((s) => /^\s*in vec2 v_TexCoord;/m.test(s))
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    ok('E2 变异：删掉渲染路径那一步 ⇒ 送进 GL 的 frag 回到 `in vec2`（E1 的绿不是白来的）', anchored && red)
  } catch (e) {
    skipNote('mock-GL 端到端跑不起来（' + String(e && e.message).slice(0, 100) + '）')
  }
}

fs.rmSync(TMP, { recursive: true, force: true })
console.log('\n' + '─'.repeat(72))
console.log(fail ? '✗ P-198 转译缺口判据：' + fail + ' 项失败 / ' + pass + ' 项通过\n  - ' + fails.join('\n  - ')
  : 'ALL PASS（' + pass + ' 项断言' + (GLSLANG ? '，真编译器档 glslangValidator' : '；**无 glslangValidator ⇒ 编译类断言全部 SKIP**') + '）')
process.exit(fail ? 1 : 0)

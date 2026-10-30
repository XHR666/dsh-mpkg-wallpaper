/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照/移植出处**，不复制其代码/注释/常量组织/错误文案：
 *   · `vendor/hlsl2glsl/hlsl2glsl.js` 是 `oneincase/webwallgl`（**MIT**）的逐字节 vendored 副本，
 *     许可与台账见 `THIRD-PARTY.md` §9；上游同许可 ⇒ 规则可移植。本文件只**断言**移植结果。
 *   · `references/wer-ref`（GPL-2.0-only）、`references/lwe-ref`（GPL-3.0-only）与本项目
 *     GPL-3.0-or-later 不兼容，本文件不引用其任何内容。
 */
// hlsl2glsl-width-table-test.mjs —— [P-115 2026-09-23] 上游**宽度表整族**（9 / 9-3 / 9a-2）移植到
//   **内联实现**（`core/we-scene-bundle.js` 的 `hlsl2glsl`，= **渲染路径真正在跑的那一份**，
//   `:9586-9587` 调用）之后的判据。上游出处与落点：
//     · 规则 9    `vendor/hlsl2glsl/hlsl2glsl.js:644-673`（宽度表本体 :655-665、裸标识符赋值截断 :668-673）
//     · 规则 9-3  同文件 :674-697（复合赋值向量截断；原始现场 `vec2 strength; strength *= 500.0 /
//                 g_Texture0Resolution;`，壁纸 3351179520）
//     · 规则 9a-2 同文件 :699-779（声明式初始化的标量/窄向量截断；vecW :723-756）
//   移植块在内联实现里的落点：`core/we-scene-bundle.js:5687-5888`（注释头 + 三条规则），
//   计数器导出在同文件 `:5513-5529`（`h2gWidthStats` / `h2gWidthStatsReset`）。
//
// ── 为什么必须有这一项（不是"覆盖率的边角"）─────────────────────────────────────────────────
//   这三条规则治的是一类**静默失败**：HLSL 允许"窄左值 = 宽右值"（隐式截断），GLSL ES 不允许 ⇒
//   转译产物编不过 ⇒ 驱动拒绝整条 pass ⇒ 渲染器只 `console.warn` 后跳过 ⇒ **效果在画面上消失、
//   控制台没有红**。判据因此钉在**转译产物的字节**上（不靠"跑一遍看有没有效果"）。
//
// ── 判据（三段；零 GPU、零浏览器）──────────────────────────────────────────────────────────
//   A 合成夹具（10 组 / 24 断言）：覆盖 9 / 9-3 / 9a-2 三条规则的真阳性 + 四类边界：
//     已声明 float 的标量右值、同名 float 与 vecN 并存、等宽/更宽左值、带 swizzle 出形态、
//     **缺 resolution uniform 声明**、多个内建、非采样器上下文、**sibling 源缺失**（内联实现 arity=4）。
//     每个真阳性夹具都做 `glslangValidator` **真编译**（缺席则 SKIP-视作-PASS）。
//   A′(G 线 2026-09-25 新增，A27-A35)：规则 **9-W「表达式级宽度推断」**（ISSUE0924A2「效果链编译失败」
//     线的第三段）—— 二元两侧宽度不同（两个方向）/ 声明截断 / int 字面量与 int 表达式 ⊗ 浮点向量 /
//     `const float = <int 表达式>` / 分量式内建的标量广播；每条都配真编译与**独立分桶计数**断言，
//     外加两条边界（"一条都不许动"与"推不出 ⇒ 原样保留 + 只计自己的桶"）。
//   B 真语料对拍（条件项：真壁纸不随仓库分发）：全语料去重后每个 `shaders/*.frag|vert` 的
//     **移植前/后 sha256 逐条比对**，"before" 参考实现 = 当前源码**单切片关掉宽度表**的临时副本；
//     断言：① 变化集 == 预期集（G 线后 **16 条**，语料摘要一致时按**精确相等**判；摘要变了则打印 DRIFT 并退到
//     "新增变化项必须本来编不过"）；② **任何移植前能编译的 shader 输出逐位不变**（0 回归）；
//     ③ 预期新增可编译的 2 条真编译过；④ `unresolved`（宽度推不出、原样保留）的现场逐条打印。
//   C 分辨力自证（RED-IF-REVERTED，内建，不依赖改回文件）：3 组变异落在 `os.tmpdir()` 副本上 ——
//     ① 关掉宽度表；② 把 9-3 的宽度比较方向写反；③ 把"推不出宽度 ⇒ 原样保留 + 计数"改成静默补 swizzle。
//     每组打印实际红集，与**按规则推出来的**期望红集比对，相等才打印 `MUTANT-RED-OK`。
//
// 用法：node tests/hlsl2glsl-width-table-test.mjs [--no-mutation] [--no-corpus]
//   环境：MPW_ROOT（工作区根）/ MPW_SCENE_ROOT（语料根）/ MPW_W9_MAX_MB（单包上限，默认 128）
// 退出码：0 = 全过（条件项 SKIP 视作 PASS）；1 = 有真失败；2 = 用法错误
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import * as LIB from '../core/we-scene-bundle.js'

const NO_MUTATION = process.argv.includes('--no-mutation')
const NO_CORPUS = process.argv.includes('--no-corpus')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const td = new TextDecoder()
const rd = (b) => td.decode(b).replace(/^\uFEFF/, '')

// ── 断言登记：每组是 `{ name, fn(api) -> { pass, detail } }`；变异自证就是"重跑同一组、比红集" ──
const CASES = []
const C = (name, fn) => { CASES.push({ name, fn }) }

// ── glslangValidator（可选：在场就做真编译，缺席则 SKIP-视作-PASS）──────────────────────────
const GLSLANG = (() => {
  for (const p of ['/usr/bin/glslangValidator', '/usr/local/bin/glslangValidator']) if (fs.existsSync(p)) return p
  try { return execFileSync('sh', ['-c', 'command -v glslangValidator'], { encoding: 'utf8' }).trim() || null } catch { return null }
})()
function compiles(src, stage) {
  if (!GLSLANG) return { ok: null, err: 'NO-GLSLANG' }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2gw9-'))
  const f = path.join(dir, 'a' + (stage === 'vert' ? '.vert' : '.frag'))
  try {
    fs.writeFileSync(f, src)
    execFileSync(GLSLANG, ['-S', stage, f], { stdio: 'pipe', timeout: 20000 })
    return { ok: true, err: '' }
  } catch (e) {
    const txt = String((e.stdout || '') + (e.stderr || ''))
    return { ok: false, err: txt.split('\n').map((l) => l.trim()).filter((l) => /ERROR/.test(l)).slice(0, 2).join(' | ') }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// ── 夹具（原文形态全部取自真语料；注释里标出对应的真 shader）────────────────────────────────
// F1 规则 9 真阳性：`varying vec2 v_NoiseCoord; … v_NoiseCoord = v_TexCoord;`（v_TexCoord 是 vec4）
//    —— 真语料 `0923/3278399262 shaders/effects/cloudmotion.vert:31`
const F9 = [
  'uniform vec4 g_Texture0Resolution;',
  'varying vec4 v_TexCoord;',
  'varying vec2 v_NoiseCoord;',
  'void main() {',
  '\tv_TexCoord = vec4(0.0);',
  '\tv_NoiseCoord = v_TexCoord;',
  '\tv_NoiseCoord.x *= g_Texture0Resolution.x / g_Texture0Resolution.y;',
  '\tgl_Position = vec4(0.0);',
  '}',
  '',
].join('\n')
// F2 规则 9-3 真阳性：上游 :675 点名的原文（壁纸 3351179520）
const F93 = [
  'uniform vec4 g_Texture0Resolution;',
  'void main() {',
  '\tvec2 s;',
  '\ts *= 500.0 / g_Texture0Resolution;',
  '\tgl_FragColor = vec4(s, 0.0, 1.0);',
  '}',
  '',
].join('\n')
// F3 规则 9a-2（float + 采样调用）：`float mask = texSample2D(g_Texture1, uv);`（sharpener_filter 形状）
const F9A2_FLOAT_TEX = [
  'uniform sampler2D g_Texture1;',
  'varying vec2 v_TexCoord;',
  'void main() {',
  '\tfloat mask = texSample2D(g_Texture1, v_TexCoord);',
  '\tgl_FragColor = vec4(mask);',
  '}',
  '',
].join('\n')
// F4 规则 9a-2（窄向量 + 采样调用）：`vec3 albedo = texSample2D(g_Texture0, uv);`（cutout_vignette / shimmer）
const F9A2_VEC_TEX = [
  'uniform sampler2D g_Texture0;',
  'varying vec2 v_TexCoord;',
  'void main() {',
  '\tvec3 albedo = texSample2D(g_Texture0, v_TexCoord);',
  '\tgl_FragColor = vec4(albedo, 1.0);',
  '}',
  '',
].join('\n')
// F5a 规则 9a-2（显式 vecN 构造）：`vec3 finalColor = vec4(a,b,c,0.1);`（chromatic_aberration）
const F9A2_CONSTRUCT = [
  'varying vec4 rValue;',
  'varying vec4 gValue;',
  'varying vec4 bValue;',
  'void main() {',
  '\tvec3 finalColor = vec4(rValue.r, gValue.g, bValue.b, 0.1);',
  '\tgl_FragColor = vec4(finalColor, 1.0);',
  '}',
  '',
].join('\n')
// F5b 规则 9a-2（float = 向量标识符 * 标量）：`float pointer = g_PointerPosition * u_pointerSpeed;`
const F9A2_VECID_MUL = [
  'uniform vec2 g_PointerPosition;',
  'uniform float u_pointerSpeed;',
  'void main() {',
  '\tfloat pointer = g_PointerPosition * u_pointerSpeed;',
  '\tgl_FragColor = vec4(pointer);',
  '}',
  '',
].join('\n')
// F6 规则 9 的边界：等宽、更宽左值、`float = float` —— **一条都不许动**
//    （`a4 = b2;` 属于**另一族**"标量/窄→宽"广播 = 上游 9b，本批**未移植**，所以它也保持原样）
const F9_BOUNDARY = [
  'uniform vec4 g_Texture0Resolution;',
  'void main() {',
  '\tvec4 a4; vec4 b4; vec2 b2; vec2 a2; float fa; float fb;',
  '\ta4 = b4;',
  '\ta4 = b2;',
  '\ta2 = b2;',
  '\tfa = fb;',
  '\tgl_FragColor = a4;',
  '}',
  '',
].join('\n')
// F7 规则 9-3 的边界：**已声明 float 的标量右值**、**出形态（带 swizzle / 多运算符）**、
//    **等宽左值**、**非采样器上下文**（`rgb2hsv(...)` 返回值宽度不可确证）—— 全部逐字不动、且**不计数**
const F93_BOUNDARY = [
  'uniform vec4 g_Texture0Resolution;',
  'uniform float u_scale;',
  'vec3 rgb2hsv(vec3 c);',
  'void main() {',
  '\tvec2 s;',
  '\ts *= u_scale;',
  '\ts *= g_Texture0Resolution.xy * 2.0;',
  '\tvec3 v = rgb2hsv(vec3(1.0));',
  '\tfloat f = 1.0;',
  '\ts *= f;',
  '\tvec4 w;',
  '\tw *= g_Texture0Resolution;',
  '\tgl_FragColor = vec4(s, v.x) + w;',
  '}',
  '',
].join('\n')
// F8 缺 resolution uniform 声明：`g_Texture0Resolution` 名字在册（WE 内建）但**本文件没有声明** ⇒
//    宽度不可确证 ⇒ 必须**原样保留并计数**（不许凭空补 `.xy`、更不许替换成 1.0）；产物必须**编不过**
//    （"响亮地失败"而不是"静默产出错值"）
const F93_NO_DECL = [
  'void main() {',
  '\tvec2 s;',
  '\ts *= 500.0 / g_Texture0Resolution;',
  '\tgl_FragColor = vec4(s, 0.0, 1.0);',
  '}',
  '',
].join('\n')
// F10 规则 9 的"宽度推不出"：右值是**名字在册但本文件没声明**的 WE 内建 ⇒ 原样保留 + 计数
//     （对应上游 :671 的 `if (!lw || !rw || lw >= rw) return all`；本移植把它拆成"不动"与"计数"两支）
const F9_UNKNOWN_RHS = [
  'void main() {',
  '\tvec2 a;',
  '\ta = g_SomeUndeclaredBuiltin;',
  '\tgl_FragColor = vec4(a, 0.0, 1.0);',
  '}',
  '',
].join('\n')
// F9 多个内建：两个 resolution 各自按自己的声明宽度截断
const F93_MULTI = [
  'uniform vec4 g_Texture0Resolution;',
  'uniform vec4 g_Texture1Resolution;',
  'void main() {',
  '\tvec2 s0;',
  '\tvec2 s1;',
  '\ts0 *= 500.0 / g_Texture0Resolution;',
  '\ts1 *= 2.0 / g_Texture1Resolution;',
  '\tgl_FragColor = vec4(s0, s1);',
  '}',
  '',
].join('\n')

// ── F9W_* 夹具（G 线 2026-09-25 新增）：规则 9-W「表达式级宽度推断」────────────────────────
//   每条夹具的形态与**真包现场**一一对应（出处写在名字里；逐条见 docs/reports-issue0924a2-line-G.md）：
//   二元两侧宽度不同（真包 clipping_mask.frag:53 / ____________________.frag:159 / iris_movement__.vert:167）、
//   声明截断 + int 字面量 ⊗ 浮点向量（shadow.vert:37）、`const float = <int 表达式>`
//   （godrays_cast.frag:46）、标量广播（shadow.vert 同一行的 `max(1.0, <vec2>)`）、
//   int 变量 ⊗ 浮点标量（godrays_cast.frag:53 `i / sampleDrop`）。
const F9W_BIN_L = [
  'uniform sampler2D g_Texture0;',
  'uniform vec2 u_scaleCenter;',
  'uniform float u_scale;',
  'varying vec4 v_TexCoord;',
  'void main() {',
  '\tvec2 uv = (v_TexCoord * 2.0 - 1.0 - (u_scaleCenter * 2.0 - 1.0)) / u_scale;',
  '\tgl_FragColor = texSample2D(g_Texture0, uv);',
  '}',
  '',
].join('\n')
const F9W_BIN_R = [
  'uniform vec4 g_Texture0Resolution;',
  'uniform float g_Strength;',
  'void main() {',
  '\tvec2 strength = (vec2(500) / g_Texture0Resolution) * g_Strength;',
  '\tgl_FragColor = vec4(strength, 0.0, 1.0);',
  '}',
  '',
].join('\n')
const F9W_INT_DECL = [
  'uniform vec2 u_offset;',
  'void main() {',
  '\tfloat atFactor = (1 + abs(u_offset) * 2.0) * 1.0;',
  '\tgl_FragColor = vec4(atFactor);',
  '}',
  '',
].join('\n')
const F9W_CONST_INT = [
  'uniform vec4 g_Tex;',
  'void main() {',
  '\tconst int sampleCount = 30;',
  '\tconst float sampleDrop = sampleCount - 1;',
  '\tgl_FragColor = g_Tex * sampleDrop;',
  '}',
  '',
].join('\n')
const F9W_BCAST = [
  'uniform vec2 u_scale;',
  'void main() {',
  '\tvec2 v = max(1.0, abs(u_scale));',
  '\tgl_FragColor = vec4(v, 0.0, 1.0);',
  '}',
  '',
].join('\n')
const F9W_INT_VAR = [
  'uniform vec4 g_Tex;',
  'void main() {',
  '\tconst int n = 30;',
  '\tfloat drop = n - 1.0;',
  '\tgl_FragColor = g_Tex * (n / 30.0) + drop;',
  '}',
  '',
].join('\n')
// 边界：等宽 / 标量 ⊗ 向量 / 矩阵 / 整数算术 —— **一条都不许动**，且 9-W 五个计数器全 0
//   （`int k = i + 1;` 是"整数算术保持整数语义"的判别位：谁把它浮点化，A34 必红）
const F9W_KEEP = [
  'uniform sampler2D g_Tex;',
  'uniform vec2 u_a;',
  'mat4 m;',
  'void main() {',
  '\tvec2 v = u_a * 2.0 / 3.0;',
  '\tvec2 w = u_a + u_a;',
  '\tvec4 c = texture(g_Tex, u_a);',
  '\tvec4 x = c * m;',
  '\tint i = 3;',
  '\tint k = i + 1;',
  '\tgl_FragColor = vec4(v + w, 0.0, 1.0) * x * float(k);',
  '}',
  '',
].join('\n')
// 宽度推不出来的形态（未声明的名字）⇒ 原样保留 + 只计进**本规则自己的**桶（不动既有 unresolved）
const F9W_UNPROVABLE = [
  'uniform sampler2D g_Tex;',
  'void main() {',
  '\tvec4 c = texture(g_Tex, vec2(0.5));',
  '\tgl_FragColor = c * u_undeclaredVec;',
  '}',
  '',
].join('\n')
// **同名 float 与 vecN 并存 ⇒ 不猜**：`#include` 展开后公共头里的 `float c`（形参/局部）会污染本文件
//   真声明为 `vec3 c` 的局部 —— 真包 0923/3479521040 `lens_flare_sun.frag:98` 实测：本规则的**假阳性**
//   把本来**编得过**的 `c += vec3(0,0,0) + f0 / 1.0;` 截成 `.x`（被 B2「移植前能编译的输出逐位不变」抓住）。
const F9W_AMBIG = [
  'uniform float f0;',
  'float c;',
  'void main() {',
  '\tvec3 c = vec3(0, 0, 0);',
  '\tc += vec3(0, 0, 0) + f0 / 1.0;',
  '\tgl_FragColor = vec4(c, 1.0);',
  '}',
  '',
].join('\n')

// ── A 段 ─────────────────────────────────────────────────────────────────────────────────
C('A1 规则 9 真阳性：`v_NoiseCoord = v_TexCoord;` ⇒ 右值补 `.xy`', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F9, 'vert', {}, null)
  const hit = /v_NoiseCoord = v_TexCoord\.xy;/.test(out)
  return { pass: hit, detail: (out.split('\n').find((l) => /v_NoiseCoord =/.test(l)) || '(未找到)').trim() }
})
C('A2 规则 9 真阳性产物过 glslangValidator（GLSL ES 300）', ({ hlsl2glsl }) => {
  const c = compiles(hlsl2glsl(F9, 'vert', {}, null), 'vert')
  return { pass: c.ok !== false, detail: c.ok === null ? 'SKIP（无 glslangValidator）' : (c.ok ? 'OK' : c.err) }
})
C('A3 规则 9 真阳性计数器 = {rule9:1, unresolved:0}', ({ hlsl2glsl, stats, reset }) => {
  reset(); hlsl2glsl(F9, 'vert', {}, null)
  const pass = stats.rule9 === 1 && stats.unresolved === 0
  return { pass, detail: JSON.stringify(stats) }
})
C('A4 规则 9-3 真阳性：`s *= 500.0 / g_Texture0Resolution;` ⇒ 右值补 `.xy`', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F93, 'frag', {}, null)
  const hit = /s \*= 500\.0 \/ g_Texture0Resolution\.xy;/.test(out)
  return { pass: hit, detail: (out.split('\n').find((l) => /s \*=/.test(l)) || '(未找到)').trim() }
})
C('A5 规则 9-3 真阳性产物过 glslangValidator', ({ hlsl2glsl }) => {
  const c = compiles(hlsl2glsl(F93, 'frag', {}, null), 'frag')
  return { pass: c.ok !== false, detail: c.ok === null ? 'SKIP（无 glslangValidator）' : (c.ok ? 'OK' : c.err) }
})
C('A6 规则 9-3 真阳性计数器 = {rule93:1, unresolved:0}', ({ hlsl2glsl, stats, reset }) => {
  reset(); hlsl2glsl(F93, 'frag', {}, null)
  const pass = stats.rule93 === 1 && stats.unresolved === 0
  return { pass, detail: JSON.stringify(stats) }
})
C('A7 规则 9a-2（float + 采样）：`float mask = texSample2D(...)` ⇒ `(texture(...)).x`', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F9A2_FLOAT_TEX, 'frag', {}, null)
  const hit = /float mask = \(texture\(g_Texture1, v_TexCoord\)\)\.x;/.test(out)
  return { pass: hit, detail: (out.split('\n').find((l) => /float mask/.test(l)) || '(未找到)').trim() }
})
C('A8 规则 9a-2（float + 采样）产物过 glslangValidator', ({ hlsl2glsl }) => {
  const c = compiles(hlsl2glsl(F9A2_FLOAT_TEX, 'frag', {}, null), 'frag')
  return { pass: c.ok !== false, detail: c.ok === null ? 'SKIP（无 glslangValidator）' : (c.ok ? 'OK' : c.err) }
})
C('A9 规则 9a-2（窄向量 + 采样）：`vec3 albedo = texSample2D(...)` ⇒ `(texture(...)).xyz`', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F9A2_VEC_TEX, 'frag', {}, null)
  const hit = /vec3 albedo = \(texture\(g_Texture0, v_TexCoord\)\)\.xyz;/.test(out)
  return { pass: hit, detail: (out.split('\n').find((l) => /vec3 albedo/.test(l)) || '(未找到)').trim() }
})
C('A10 规则 9a-2（窄向量 + 采样）产物过 glslangValidator', ({ hlsl2glsl }) => {
  const c = compiles(hlsl2glsl(F9A2_VEC_TEX, 'frag', {}, null), 'frag')
  return { pass: c.ok !== false, detail: c.ok === null ? 'SKIP（无 glslangValidator）' : (c.ok ? 'OK' : c.err) }
})
C('A11 规则 9a-2（显式 vecN 构造）：`vec3 x = vec4(...)` ⇒ `.xyz`', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F9A2_CONSTRUCT, 'frag', {}, null)
  const hit = /vec3 finalColor = \(vec4\(rValue\.r, gValue\.g, bValue\.b, 0\.1\)\)\.xyz;/.test(out)
  return { pass: hit, detail: (out.split('\n').find((l) => /vec3 finalColor/.test(l)) || '(未找到)').trim() }
})
C('A12 规则 9a-2（float = 向量标识符 * 标量）⇒ 整式外包 `.x`', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F9A2_VECID_MUL, 'frag', {}, null)
  const hit = /float pointer = \(g_PointerPosition \* u_pointerSpeed\)\.x;/.test(out)
  return { pass: hit, detail: (out.split('\n').find((l) => /float pointer/.test(l)) || '(未找到)').trim() }
})
C('A13 规则 9 边界：等宽 / 更宽左值 / float=float 一律逐字不变', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F9_BOUNDARY, 'frag', {}, null)
  const keep = ['a4 = b4;', 'a4 = b2;', 'a2 = b2;', 'fa = fb;']
  const miss = keep.filter((k) => !out.includes(k))
  return { pass: miss.length === 0, detail: miss.length ? '被改了：' + miss.join(' ') : keep.join(' ') }
})
C('A14 规则 9 边界：不动就不计数（三个计数器全 0）', ({ hlsl2glsl, stats, reset }) => {
  reset(); hlsl2glsl(F9_BOUNDARY, 'frag', {}, null)
  const pass = stats.rule9 === 0 && stats.rule93 === 0 && stats.rule9a2 === 0 && stats.unresolved === 0
  return { pass, detail: JSON.stringify(stats) }
})
C('A15 规则 9-3 边界：标量右值 / 出形态 / 等宽 / 非采样器上下文 逐字不变', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F93_BOUNDARY, 'frag', {}, null)
  const keep = ['s *= u_scale;', 's *= g_Texture0Resolution.xy * 2.0;', 's *= f;', 'w *= g_Texture0Resolution;', 'vec3 v = rgb2hsv(vec3(1.0));']
  const miss = keep.filter((k) => !out.includes(k))
  return { pass: miss.length === 0, detail: miss.length ? '被改了：' + miss.join(' ') : keep.join(' ') }
})
C('A16 规则 9-3 边界：合法标量/出形态不计数（4 个计数器全 0）', ({ hlsl2glsl, stats, reset }) => {
  reset(); hlsl2glsl(F93_BOUNDARY, 'frag', {}, null)
  const pass = stats.rule9 === 0 && stats.rule93 === 0 && stats.rule9a2 === 0 && stats.unresolved === 0
  return { pass, detail: JSON.stringify(stats) }
})
C('A17 缺 resolution uniform：`g_Texture0Resolution` 原样保留（不补 swizzle、不替换常量）', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F93_NO_DECL, 'frag', {}, null)
  const kept = out.includes('s *= 500.0 / g_Texture0Resolution;')
  const noSubst = !/g_Texture0Resolution\.xy/.test(out) && !/1\.0 \/ 1\.0|vec4\(1\.0\)/.test(out)
  return { pass: kept && noSubst, detail: (out.split('\n').find((l) => /s \*=/.test(l)) || '(未找到)').trim() }
})
C('A18 缺 resolution uniform：如实计数（unresolved=1，原因 9-3-rhs-type-unknown）', ({ hlsl2glsl, stats, reset }) => {
  reset(); hlsl2glsl(F93_NO_DECL, 'frag', {}, null)
  const pass = stats.unresolved === 1 && stats.unresolvedReasons['9-3-rhs-type-unknown'] === 1
  return { pass, detail: JSON.stringify(stats) }
})
C('A19 缺 resolution uniform：产物**编不过**（响亮失败，不是静默错值）', ({ hlsl2glsl }) => {
  const c = compiles(hlsl2glsl(F93_NO_DECL, 'frag', {}, null), 'frag')
  return { pass: c.ok !== true, detail: c.ok === null ? 'SKIP（无 glslangValidator）' : (c.ok ? '⚠ 竟然编过了（说明有静默兜底）' : c.err) }
})
C('A20 多个内建：两个 resolution 各按自己的声明宽度截断', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F93_MULTI, 'frag', {}, null)
  const hit = /s0 \*= 500\.0 \/ g_Texture0Resolution\.xy;/.test(out) && /s1 \*= 2\.0 \/ g_Texture1Resolution\.xy;/.test(out)
  return { pass: hit, detail: JSON.stringify(out.split('\n').filter((l) => /\*=/.test(l)).map((l) => l.trim())) }
})
C('A21 多个内建：计数器 rule93=2', ({ hlsl2glsl, stats, reset }) => {
  reset(); hlsl2glsl(F93_MULTI, 'frag', {}, null)
  return { pass: stats.rule93 === 2, detail: JSON.stringify(stats) }
})
C('A22 sibling 源缺失：内联实现**不接收 sibling 源**（P-198 起第 5 参是 `search` 回退口，不是 `siblingSrc`）', ({ hlsl2glsl }) => {
  // ①(P-198 2026-09-25) 断言的**意图**没变（P-114：转译函数只看得见一个 stage，跨 stage 信息走
  //   `withSiblingComboDefaults()` / `reconcileStageVaryings()`），改的是判定方式：原来按 `arity === 4`，
  //   而 P-198 给同一个函数加了第 5 个可选参 `search`（`?macrocomment=`/`?constglobal=`/`?cmpint=` 回退口，
  //   见 `tests/hlsl2glsl-passfix-test.mjs`）⇒ 改成**看形参表**里有没有 `siblingSrc`。
  //   `arity === 4` 这个旧口径已不可能成立（HTML 之外的调用方也要能传回退口），把它钉住等于禁止加参数。
  const fnSrc = String(hlsl2glsl)
  const params = fnSrc.slice(fnSrc.indexOf('(') + 1, fnSrc.indexOf(')')).split(',').map((s) => s.trim())
  return {
    pass: params.length >= 4 && !params.includes('siblingSrc') && params[0] === 'src' && params[1] === 'stage',
    detail: 'arity=' + hlsl2glsl.length + ' params=[' + params.join(', ') + ']',
  }
})
C('A23 sibling 源缺失：多传第 5 参不改变产物（本族只读**本文件**的声明，不需要兄弟 stage）', ({ hlsl2glsl }) => {
  const a = hlsl2glsl(F93, 'frag', {}, null)
  const b = hlsl2glsl(F93, 'frag', {}, null, 'varying vec2 v_D;\nvoid main() { gl_Position = vec4(0.0); }\n')
  return { pass: a === b && /g_Texture0Resolution\.xy/.test(b), detail: a === b ? '逐字节相同（' + a.length + ' B）' : '产物不同！' }
})
C('A24 sibling 源缺失：兄弟原文里的同名 varying 不影响本文件的宽度表', ({ hlsl2glsl }) => {
  const sib = 'varying vec4 v_TexCoord;\nvoid main() { v_TexCoord = vec4(1.0); gl_Position = vec4(0.0); }\n'
  const out = hlsl2glsl(F9, 'vert', {}, null, sib)
  return { pass: /v_NoiseCoord = v_TexCoord\.xy;/.test(out), detail: (out.split('\n').find((l) => /v_NoiseCoord =/.test(l)) || '').trim() }
})
C('A25 规则 9 宽度推不出（右值未声明）：逐字保留（不猜宽度）', ({ hlsl2glsl }) => {
  const out = hlsl2glsl(F9_UNKNOWN_RHS, 'frag', {}, null)
  const kept = out.includes('a = g_SomeUndeclaredBuiltin;')
  return { pass: kept, detail: (out.split('\n').find((l) => /a = /.test(l)) || '(未找到)').trim() }
})
C('A26 规则 9 宽度推不出：如实计数（unresolved=1 / 9-rhs-width-unknown）', ({ hlsl2glsl, stats, reset }) => {
  reset(); hlsl2glsl(F9_UNKNOWN_RHS, 'frag', {}, null)
  const pass = stats.unresolved === 1 && stats.unresolvedReasons['9-rhs-width-unknown'] === 1 && stats.rule9 === 0
  return { pass, detail: JSON.stringify(stats) }
})

// ── A 段（G 线 2026-09-25 新增）：规则 9-W「表达式级宽度推断」的真阳性 + 边界 ──────────────
//   `stats.rule9W*` 是**独立分桶**：既有 9 / 9-3 / 9a-2 的计数口径在下面每条里都一并钉住（必须为 0），
//   免得"新规则顺手改了老规则的账"。
C('A27 规则 9-W 二元两侧宽度不同（左宽右窄）：`(vec4 表达式 - vec2)` ⇒ 左边补 `.xy`', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_BIN_L, 'frag', {}, null)
  const hit = /vec2 uv = \(\(v_TexCoord \* 2\.0 - 1\.0\)\.xy - \(u_scaleCenter \* 2\.0 - 1\.0\)\) \/ u_scale;/.test(out)
  const st = { bin: stats.rule9Wbin, decl: stats.rule9Wdecl, int: stats.rule9Wint, konst: stats.rule9Wconst, bcast: stats.rule9Wbcast, old: stats.rule9 + stats.rule93 + stats.rule9a2 }
  return { pass: hit && stats.rule9Wbin === 1 && st.old === 0, detail: (out.split('\n').find((l) => /vec2 uv/.test(l)) || '(未找到)').trim() + ' :: ' + JSON.stringify(st) }
})
C('A28 规则 9-W 二元两侧宽度不同：产物过 glslangValidator（GLSL ES 300）', ({ hlsl2glsl }) => {
  const c = compiles(hlsl2glsl(F9W_BIN_L, 'frag', {}, null), 'frag')
  return { pass: c.ok !== false, detail: c.ok === null ? 'SKIP（无 glslangValidator）' : (c.ok ? 'OK' : c.err) }
})
C('A29 规则 9-W 二元两侧宽度不同（右宽左窄）：`(vec2 / vec4)` ⇒ 右边补 `.xy`', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_BIN_R, 'frag', {}, null)
  const hit = /vec2 strength = \(vec2\(500\) \/ g_Texture0Resolution\.xy\) \* g_Strength;/.test(out)
  const c = compiles(out, 'frag')
  return { pass: hit && stats.rule9Wbin === 1 && c.ok !== false, detail: (out.split('\n').find((l) => /vec2 strength/.test(l)) || '(未找到)').trim() + ' :: ' + (c.ok === null ? 'SKIP' : c.err || 'OK') }
})
C('A30 规则 9-W int 字面量 ⊗ 浮点向量 + 声明截断：`float x = (1 + <vec2>) * 1.0` ⇒ `1.0` + `.x`', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_INT_DECL, 'frag', {}, null)
  const hit = /float atFactor = \(\(1\.0 \+ abs\(u_offset\) \* 2\.0\) \* 1\.0\)\.x;/.test(out)
  const c = compiles(out, 'frag')
  const st = { decl: stats.rule9Wdecl, int: stats.rule9Wint, unres: stats.rule9Wunresolved }
  return { pass: hit && stats.rule9Wdecl === 1 && stats.rule9Wint === 1 && stats.rule9Wunresolved === 0 && c.ok !== false,
    detail: (out.split('\n').find((l) => /float atFactor/.test(l)) || '(未找到)').trim() + ' :: ' + JSON.stringify(st) + ' ' + (c.ok === null ? 'SKIP' : c.err || 'OK') }
})
C('A31 规则 9-W `const float x = <int 表达式>` ⇒ `float(<int 表达式>)`（GLSL ES const 初始化不容 int）', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_CONST_INT, 'frag', {}, null)
  const hit = /const float sampleDrop = float\(sampleCount - 1\);/.test(out)
  const c = compiles(out, 'frag')
  return { pass: hit && stats.rule9Wconst === 1 && stats.rule9Wint === 0 && c.ok !== false,
    detail: (out.split('\n').find((l) => /sampleDrop/.test(l)) || '(未找到)').trim() + ' :: ' + (c.ok === null ? 'SKIP' : c.err || 'OK') }
})
C('A32 规则 9-W 标量广播：`max(1.0, <vec2>)` ⇒ `max(vec2(1.0), <vec2>)`（GLSL 无此重载）', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_BCAST, 'frag', {}, null)
  const hit = /vec2 v = max\(vec2\(1\.0\), abs\(u_scale\)\);/.test(out)
  const c = compiles(out, 'frag')
  return { pass: hit && stats.rule9Wbcast === 1 && stats.rule9Wunresolved === 0, detail: (out.split('\n').find((l) => /vec2 v/.test(l)) || '(未找到)').trim() + ' :: ' + (c.ok === null ? 'SKIP' : c.err || 'OK') }
})
C('A33 规则 9-W int 表达式 ⊗ 浮点标量：`n - 1.0` / `n / 30.0` ⇒ 给 int 一侧套 `float(...)`', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_INT_VAR, 'frag', {}, null)
  const hit = /float drop = float\(n\) - 1\.0;/.test(out) && /\(float\(n\) \/ 30\.0\)/.test(out)
  const c = compiles(out, 'frag')
  const keep = /const int n = 30;/.test(out)     // 整数声明本身不许被"浮点化"
  return { pass: hit && keep && stats.rule9Wint === 2 && c.ok !== false,
    detail: out.split('\n').map((l) => l.trim()).filter((l) => /float drop|g_Tex \*|const int/.test(l)).join(' | ') + ' :: ' + (c.ok === null ? 'SKIP' : c.err || 'OK') }
})
C('A34 规则 9-W 边界：等宽 / 标量⊗向量 / 矩阵 / 整数算术 —— 逐字不变且五个计数器全 0', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_KEEP, 'frag', {}, null)
  const keep = ['vec2 v = u_a * 2.0 / 3.0;', 'vec2 w = u_a + u_a;', 'vec4 c = texture(g_Tex, u_a);', 'vec4 x = c * m;', 'int k = i + 1;']
  const miss = keep.filter((k) => !out.includes(k))
  const zero = stats.rule9Wbin === 0 && stats.rule9Wdecl === 0 && stats.rule9Wint === 0 && stats.rule9Wconst === 0 && stats.rule9Wbcast === 0
  const c = compiles(out, 'frag')
  return { pass: miss.length === 0 && zero && c.ok !== false,
    detail: (miss.length ? '被改了：' + miss.join(' ') : keep.length + ' 条逐字保留') + ' · ' + JSON.stringify({ bin: stats.rule9Wbin, decl: stats.rule9Wdecl, int: stats.rule9Wint, konst: stats.rule9Wconst, bcast: stats.rule9Wbcast, unres: stats.rule9Wunresolved, old: stats.rule9 + stats.rule93 + stats.rule9a2 }) }
})
C('A35 规则 9-W 宽度推不出（未声明的名字）：逐字保留 + 只计本规则自己的桶', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_UNPROVABLE, 'frag', {}, null)
  const kept = out.includes('fragColor = c * u_undeclaredVec;')
  const pass = kept && stats.rule9Wunresolved === 1 && stats.rule9WunresolvedReasons['9W-operand-width-unprovable'] === 1 &&
    stats.rule9Wbin === 0 && stats.unresolved === 0 && Object.keys(stats.unresolvedReasons).length === 0
  return { pass, detail: (out.split('\n').find((l) => /u_undeclaredVec/.test(l)) || '(未找到)').trim() + ' :: ' + JSON.stringify({ w: stats.rule9WunresolvedReasons, old: stats.unresolved }) }
})
C('A36 ★ 同名 float 与 vecN 并存 ⇒ 不猜（真包 lens_flare_sun.frag:98 的假阳性回归守门人）', ({ hlsl2glsl, stats, reset }) => {
  reset()
  const out = hlsl2glsl(F9W_AMBIG, 'frag', {}, null)
  const kept = out.includes('c += vec3(0, 0, 0) + f0 / 1.0;')
  const c = compiles(out, 'frag')
  const zero = stats.rule9Wbin === 0 && stats.rule9Wdecl === 0 && stats.rule9Wint === 0 && stats.rule9Wconst === 0 && stats.rule9Wbcast === 0
  return { pass: kept && zero && stats.rule9WunresolvedReasons['9W-width-ambiguous-float-and-vec'] === 1 && c.ok !== false,
    detail: (out.split('\n').find((l) => /c \+=/.test(l)) || '(未找到)').trim() + ' :: ' + JSON.stringify({ zero, w: stats.rule9WunresolvedReasons }) + ' ' + (c.ok === null ? 'SKIP' : c.err || 'OK') }
})

// ── 变异工具：把**真源码**定点切片改写后落到 os.tmpdir()，只用于自证（真树不动）────────────
const toTempModule = (src) => src.replace(/from '\.\/([^']+)'/g, (all, f) => 'from ' + JSON.stringify(path.join(ROOT, 'core', f)))
function loadMutant(src, slices, tag) {
  let out = src
  for (const [a, b] of slices) {
    if (src.split(a).length !== 2) throw new Error('切片在真源码里不是**恰好一次**（' + tag + '）：' + a.slice(0, 70))
    out = out.replace(a, b)
  }
  if (out === src) throw new Error('变异没有生效（切片没匹配上）: ' + tag)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2gw9mut-'))
  const fp = path.join(dir, 'we-scene-bundle.js')
  fs.writeFileSync(fp, toTempModule(out))
  return { dir, url: pathToFileURL(fp).href }
}
// 变异都是**定点切片**（[原文, 替换文] 对；loadMutant 会断言每段原文在真源码里恰好出现一次）。
// ① 关掉宽度表收集 ⇒ `w9Width.size === 0` ⇒ 整个移植块不执行（= **移植前**的行为，B 段的 before 参考）
const MUT_NO_TABLE = [[
  '      while ((w9m = w9re.exec(w9Src)) !== null) w9Width.set(w9m[3], Number(w9m[2]))',
  '      while ((w9m = w9re.exec(w9Src)) !== null) { /* MUTANT: 宽度表关掉 */ }',
]]
// ② 把 9-3 的宽度比较方向写反（`rw <= lw ⇒ 不动` 写成 `rw >= lw ⇒ 不动`）
const MUT_FLIP_93 = [[
  '        if (rw <= lw) return all                             // 右值不比左值宽（含纯标量右值）⇒ 合法，不动',
  '        if (rw >= lw) return all                             // MUTANT: 方向写反',
]]
// ③ 把"推不出宽度 ⇒ 原样保留 + 计数"改成"静默补 swizzle"（规则 9 与规则 9-3 各一处）
const MUT_SILENT = [
  ["        if (!rw) { w9Miss('9-rhs-width-unknown'); return all }   // 右值类型不明 ⇒ 保留原样 + 计数",
    "        if (!rw) { h2gWidthStats.rule9++; return pre + lhs + ' = ' + rhs + '.' + W9_SW[lw] + ';' }   // MUTANT: 静默补"],
  ["            if (!w9Float.has(id)) { w9Miss('9-3-rhs-type-unknown'); return all }   // 既不是已知向量也不是已声明 float",
    '            if (!w9Float.has(id)) { rw = lw + 1; continue }   // MUTANT: 静默当成更宽的向量'],
]

// ── B 段：真语料对拍（条件项）──────────────────────────────────────────────────────────────
const MPW_ROOT = process.env.MPW_ROOT || WS
const SCENE_ROOTS = process.env.MPW_SCENE_ROOT
  ? [process.env.MPW_SCENE_ROOT]
  : [path.join(MPW_ROOT, 'allwallpaper', 'dd'), path.join(MPW_ROOT, 'allwallpaper', 'wallpaperE'),
    path.join(MPW_ROOT, 'allwallpaper', 'wallpapertest1'), path.join(MPW_ROOT, 'allwallpaper', '0917'),
    path.join(MPW_ROOT, 'allwallpaper', '0923')]
// ①(2026-10-30 路径固化) 插件解析器候选：env → 集成布局 `ROOT/../plugin` → 旧兄弟仓名回退。
const PKG_EXTRACT = process.env.MPW_PKG_EXTRACT
  || (fs.existsSync(path.join(ROOT, '..', 'plugin', 'lib', 'pkg-extract.js'))
    ? path.join(ROOT, '..', 'plugin', 'lib', 'pkg-extract.js')
    : (fs.existsSync(path.join(MPW_ROOT, 'dsh-mpkg-wallpaper', 'lib', 'pkg-extract.js'))
      ? path.join(MPW_ROOT, 'dsh-mpkg-wallpaper', 'lib', 'pkg-extract.js') : null))
// **预期变化集**（按规则**推出来**的，不是"跑一遍抄下来"的）：4 条，全部出自"移植前编不过"的那批。
// 身份 = `<包相对 MPW_ROOT 的路径>::<包内条目路径>`；`why` 写清是哪条规则、认哪个声明。
const EXPECT_CHANGED = [
  { id: 'allwallpaper/0923/3278399262/scene.pkg::shaders/effects/cloudmotion.vert', why: '规则 9：`varying vec2 v_NoiseCoord; v_NoiseCoord = v_TexCoord;`（v_TexCoord=vec4）', must: /v_NoiseCoord = v_TexCoord\.xy;/, compiles: true },
  { id: 'allwallpaper/0923/3582367840/scene.pkg::shaders/effects/shimmer.frag', why: '规则 9a-2：`vec3 shimmerColor = texSample2D(g_Texture3, …)`（返回 vec4）', must: /vec3 shimmerColor = \(texture\(g_Texture3,[^\n]*\)\)\.xyz;/, compiles: true },
  { id: 'allwallpaper/0923/3690417937/scene.pkg::shaders/workshop/2138904733/effects/cutout_vignette.frag', why: '规则 9a-2：`vec3 albedo = texSample2D(g_Texture0, …)`（返回 vec4）+ ②(G 线) 9-W 二元截断 `v_TexCoord`(vec3) - `vec2(u_offset)` ⇒ `.xy`', must: /length\(abs\(v_TexCoord\.xy - vec2\(u_offset\)\)/, compiles: true },
  { id: 'allwallpaper/0923/2902406982/scene.pkg::shaders/workshop/2423877731/effects/chromatic_aberration.frag', why: '规则 9a-2：`float pointer = g_PointerPosition * u_pointerSpeed;` + `vec3 finalColor = vec4(…)` + ②(G 线) 9-W 二元截断 `(u_rOffset * timer + pointer).xy` + **fmod 重写**', must: /\(u_rOffset \* timer \+ pointer\)\.xy\)/, compiles: true },
  // ①(ISSUE0924A2 2026-09-24 渲染器"效果链编译失败"线) **变化集从 4 条变 5 条是新增规则 9-S 造成的**，
  //   不是回归（明细见 docs/reports-issue0924a2-line-D.md §3）。同文件里另有"二元运算两侧宽度不同"的
  //   形态（`v_TexCoord * 2.0 - vec2(...)`）⇒ ②(G 线)规则 9-W 接着把它治了，故本条 `compiles` 由
  //   `false` **显式改为 `true`**（真编译口径见 §4.3；不是放宽语义，是"旧输出本来就编不过"）。
  { id: 'allwallpaper/0923/2902406982/scene.pkg::shaders/workshop/2800594362/effects/clipping_mask.frag', why: '规则 9-S + **9-W**：采样坐标 `.xy` + 二元截断 `(v_TexCoord * 2.0 - 1.0).xy`', must: /\(\(v_TexCoord \* 2\.0 - 1\.0\)\.xy - \(u_texScaleCenter \* 2\.0 - 1\.0\)\)/, compiles: true },
  // ── ②(G 线 2026-09-25) 规则 9-W（表达式级宽度推断）+ `fmod` 重写带来的**新增**变化项 ──────────────
  //   **每一条都先经 B2 验过"改前编不过"**（否则就是回归，不许进这个白名单）：真编译器档逐条读数见
  //   docs/reports-issue0924a2-line-G.md §4.3。`why` 写清是哪条子规则、认哪个声明。
  { id: 'allwallpaper/0917/3588181703/scene.pkg::shaders/workshop/2973943998/effects/iris_movement__.vert', why: '9-W 二元截断：`transformedCursorPosition`(vec4) * `g_CursorScale`(vec2) ⇒ `.xy`', must: /vec2 da = transformedCursorPosition\.xy \* g_CursorScale/, compiles: true },
  { id: 'allwallpaper/0923/3653641024/scene.pkg::shaders/workshop/3221939295/effects/____________________.frag', why: '9-W 二元截断（**截右侧**）：`vec2(500) / g_Texture0Resolution`(vec4) ⇒ `.xy`', must: /\(vec2\(500\) \/ g_Texture0Resolution\.xy\)/, compiles: true },
  { id: 'allwallpaper/0923/3653641024/scene.pkg::shaders/effects/godrays_cast.frag', why: '9-W `const float = <int 表达式>` ⇒ `float(sampleCount - 1)` + int 表达式 ⊗ 浮点标量 ⇒ `float(i)`', must: /const float sampleDrop = float\(sampleCount - 1\);/, compiles: true },
  { id: 'allwallpaper/0923/3479521040/scene.pkg::shaders/workshop/3088030303/effects/shadow.vert', why: '9-W int 字面量 ⊗ 浮点向量（`1` ⇒ `1.0`）+ 声明截断（`.x`）+ 标量广播（`max(vec2(1.0), …)`）；**该 shader 仍编不过**，卡在另一族（顶点写 attribute）', must: /float atFactor = \(\(1\.0 \+ \(abs\(u_shadowOffset\) \+ abs\(g_ParallaxPosition \* u_ParallaxScale\)\) \* 2\.0\) \* max\(vec2\(1\.0\), abs\(u_ShadowScale\)\)\)\.x;/, compiles: false },
  { id: 'allwallpaper/0923/3521337568/scene.pkg::shaders/effects/shine_cast.frag', why: '9-W `const float = <int 表达式>` + `i / sampleDrop` ⇒ `float(...)`（effects/ 与 workshop/ 两份同名源各一条）', must: /const float sampleDrop = float\(sampleCount - 1\);/, compiles: true },
  { id: 'allwallpaper/0923/3521337568/scene.pkg::shaders/workshop/2865559209/effects/shine_cast.frag', why: '9-W 同上（工坊副本）', must: /const float sampleDrop = float\(sampleCount - 1\);/, compiles: true },
  { id: 'allwallpaper/0917/3233141951/scene.pkg::shaders/workshop/2114826643/effects/shift_hue.frag', why: '9-W 分量式内建**向量实参**截断：`mix(albedo`(vec4)`, newAlbedo`(vec3)`, mask)` ⇒ `albedo.xyz`（GLSL 无此重载）', must: /albedo\.rgb = mix\(albedo\.xyz, newAlbedo, mask\);/, compiles: true },
  { id: 'allwallpaper/dd/3327063360/scene.pkg::shaders/workshop/2193274282/effects/hue_shift.frag', why: '9-W 同上（另一份同名源：`mix(vec4, vec3, float)` ⇒ `albedo.xyz`）', must: /albedo\.rgb = mix\(albedo\.xyz, newAlbedo, mask\);/, compiles: true },
  { id: 'allwallpaper/0923/3653641024/scene.pkg::shaders/workshop/3021673417/effects/Simple_Audio_Bars.frag', why: '9-W int 表达式 ⊗ 浮点标量：`bar * u_BarOpacity` ⇒ `float(bar) * …`（两处，现用分支里 `bar` 是 `int`）；**该 shader 仍编不过**，卡在另一族：既有 `%`→`mod` 重写不看目标类型（`uint barFreq1 = mod(frequency, 32.0);` ⇒ float→uint）', must: /float\(bar\) \* u_BarOpacity/, compiles: false },
  { id: 'allwallpaper/0923/3690417937/scene.pkg::shaders/effects/glitter_prepare.vert', why: '9-W int 字面量 ⊗ 浮点向量：`vec2(…) * 5` ⇒ `* 5.0`', must: /vec2\(a_TexCoord\.x, a_TexCoord\.y\) \* 5\.0;/, compiles: true },
  { id: 'allwallpaper/dd/3544152633/scene.pkg::shaders/workshop/3200298808/effects/edgedetection.frag', why: '9-W int 字面量 ⊗ 浮点向量：`(sample21 - sample01) * 2` ⇒ `* 2.0`（两处；同文件另有 9 条右值解析放弃 = 原样保留）', must: /\(sample21 - sample01\) \* 2\.0/, compiles: true },
]
// 语料快照（2026-09-23 本机全量跑出来的真值，钉住"变化集精确相等"的判定口径）：
//   `shaders` = 去重后的 shader 文件数；`sourceDigest` = 全部 shader **源** sha256 排序后拼接的 sha256。
//   语料变了（新增/删除壁纸）⇒ DRIFT：打印差异，并把断言降级成"新增变化项必须本来编不过"（仍不许回归）。
const CORPUS_SNAPSHOT = { shaders: 276, sourceDigest: '225640c1649b94585d7c05ccb3db6179ce9ec65f74821ac04026f96aa72b980c' }

async function runCorpus(api, beforeApi, headApi) {
  if (!PKG_EXTRACT || !fs.existsSync(PKG_EXTRACT)) return { skip: '找不到包解析器 ' + PKG_EXTRACT }
  const pkgs = []
  for (const root of SCENE_ROOTS) {
    if (!fs.existsSync(root)) continue
    const walk = (d, depth) => {
      if (depth > 3) return
      let ents = []
      try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const fp = path.join(d, e.name)
        if (e.isDirectory()) walk(fp, depth + 1)
        else if (/\.(pkg|mpkg)$/i.test(e.name)) { try { pkgs.push({ fp, bytes: fs.statSync(fp).size }) } catch { /* ignore */ } }
      }
    }
    walk(root, 0)
  }
  if (!pkgs.length) return { skip: '无候选包（' + SCENE_ROOTS.join(' / ') + '）' }
  pkgs.sort((a, b) => a.bytes - b.bytes)
  const ONE_MB = Number(process.env.MPW_W9_MAX_MB || 1024)
  const picked = pkgs.filter((p) => p.bytes / 1048576 <= ONE_MB)
  if (!picked.length) return { skip: '候选包都超过单包上限 ' + ONE_MB + 'MB' }
  // include 头表（仓库自研 common*.h；口径同 hlsl2glsl-coverage-test.mjs）
  const HEADERS = new Map()
  for (const d of [path.join(ROOT, 'shaders'), ROOT]) {
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) if (/^common.*\.h$/.test(f) && !HEADERS.has(f)) HEADERS.set(f, fs.readFileSync(path.join(d, f), 'utf8'))
  }
  const includeResolver = (n) => HEADERS.get(String(n).split('/').pop()) ?? null
  const { parsePkg, readPkgEntry } = await import(pathToFileURL(PKG_EXTRACT).href)
  const seen = new Set()
  const rows = []
  const totals = { widthDecls: 0, rule9: 0, rule93: 0, rule9a2: 0, ruleSample2D: 0, rule9Wbin: 0, rule9Wdecl: 0, rule9Wint: 0, rule9Wconst: 0, rule9Wbcast: 0, rule9Warg: 0, rule9Wunresolved: 0, ruleFmod: 0, unresolved: 0 }
  const reasons = {}
  const reasons9W = {}
  const srcShas = []
  const headDiff = []
  let headCompared = 0
  for (const p of picked) {
    let data = null
    try { data = fs.readFileSync(p.fp) } catch { continue }
    let idx = null
    try { idx = parsePkg(data) } catch { data = null; continue }
    for (const e of idx.filter((x) => /(^|\/)shaders\//i.test(x.path) && /\.(vert|frag)$/i.test(x.path))) {
      let buf = null
      try { buf = Buffer.from(readPkgEntry(data, e)) } catch { continue }
      const sSha = sha256(buf)
      if (seen.has(sSha)) continue
      seen.add(sSha)
      const stage = /\.vert$/i.test(e.path) ? 'vert' : 'frag'
      const src = rd(buf)
      let before = null; let after = null; let afterErr = ''
      try { before = beforeApi.hlsl2glsl(src, stage, {}, includeResolver) } catch { /* before 抛错也照实记 */ }
      api.reset()   // ⚠ 计数器是**模块级累加**的 ⇒ 每个 shader 之前必须清零，否则 totals 会平方级重复累加
      try { after = api.hlsl2glsl(src, stage, {}, includeResolver) } catch (ex) { afterErr = String(ex && ex.message).slice(0, 120) }
      // "before" 参考实现的可信度：与**移植前真源码**（git HEAD 版）逐 shader 逐字节对齐（见 B0）
      if (headApi) {
        headCompared++
        let head = null
        try { head = headApi.hlsl2glsl(src, stage, {}, includeResolver) } catch (ex) { head = 'THREW:' + String(ex && ex.message) }
        if (head !== before) { headDiff.push(path.relative(MPW_ROOT, p.fp) + '::' + e.path) }
      }
      const st = { ...api.stats, unresolvedReasons: { ...api.stats.unresolvedReasons }, rule9WunresolvedReasons: { ...api.stats.rule9WunresolvedReasons } }
      for (const k of ['widthDecls', 'rule9', 'rule93', 'rule9a2', 'ruleSample2D', 'rule9Wbin', 'rule9Wdecl', 'rule9Wint', 'rule9Wconst', 'rule9Wbcast', 'rule9Warg', 'rule9Wunresolved', 'ruleFmod', 'unresolved']) totals[k] += st[k]
      for (const [k, v] of Object.entries(st.unresolvedReasons)) reasons[k] = (reasons[k] || 0) + v
      for (const [k, v] of Object.entries(st.rule9WunresolvedReasons)) reasons9W[k] = (reasons9W[k] || 0) + v
      rows.push({
        id: path.relative(MPW_ROOT, p.fp) + '::' + e.path,
        stage, sSha,
        changed: before !== after,
        before, after, afterErr,
        stats: st,
      })
      srcShas.push(sSha)
    }
    data = null
    await new Promise((r) => setImmediate(r))   // 让 GC 有机会回收大 Buffer（内存只有一名额）
  }
  srcShas.sort()
  return {
    rows, totals, reasons, reasons9W,
    digest: sha256(srcShas.join('\n')),
    pkgs: picked.length, pkgsAll: pkgs.length, oneMb: ONE_MB, headDiff, headCompared,
  }
}

// ── C 段：变异自证 ─────────────────────────────────────────────────────────────────────────
async function redSetOf(src, mutate, tag) {
  const { dir, url } = loadMutant(src, mutate, tag)
  try {
    const m = await import(url)
    const api = { hlsl2glsl: m.hlsl2glsl, stats: m.h2gWidthStats, reset: m.h2gWidthStatsReset }
    const red = []
    for (const c of CASES) {
      let r = { pass: false, detail: 'threw' }
      try { r = await c.fn(api) } catch (e) { r = { pass: false, detail: 'threw: ' + String(e && e.message).slice(0, 80) } }
      if (!r.pass) red.push(c.name)
    }
    return red
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
// **期望红集**（按规则推出来，不是"跑一遍抄下来"的）：
//   ①关掉宽度表 ⇒ 凡依赖移植块的正断言（A1-A12）+ 依赖计数的断言（A16/A18/A26）+ 语料相关的
//     A20/A21/A23/A24 全红。**绿的三条**是"只断言不许动"的单向断言，关掉规则时它们**必然**仍绿，
//     所以**不在**期望红集里（这也是分辨力方向性的证据）：
//       · A13 / A15（等宽、更宽左值、标量右值 ⇒ 逐字不变）—— 规则没跑，自然没动；
//       · A14 / A16（边界形态"不计数"= 全 0）—— 规则没跑，计数器当然是 0；
//       · A17 / A25（宽度推不出 ⇒ 逐字保留）—— 规则没跑，当然逐字保留。
//     它们的"另一半"（A3/A6/A21/A26/A18 的**计数**、A1/A4/A7/A9/A11/A12 的**改写**）才是判别位。
const EXPECT_RED_NO_TABLE = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A18', 'A20', 'A21', 'A23', 'A24', 'A26',
  // ②(G 线 2026-09-25) 规则 9-W 的真阳性/计数断言：9-W 也在这个 `if (w9Width.size > 0)` 闸门内
  //   ⇒ 关掉宽度表时**一条都不跑** ⇒ 凡断言"改写了/计数了"的 A27-A33、A35 全红。
  //   A34 不在期望红集里：它断言的是"不许动 + 计数为 0"这种**单向**结论 —— 规则没跑当然仍成立
  //   （与 A13/A15 同类，是分辨力方向性的证据，不是漏洞）。
  'A27', 'A28', 'A29', 'A30', 'A31', 'A32', 'A33', 'A35', 'A36']
//   ②9-3 比较方向写反（`rw >= lw ⇒ 不动`）⇒ 真阳性 A4/A6/A20/A21/A23 不再补 swizzle ⇒ 红；
//     A16 因为"纯标量右值"也会掉进 `rw=0 ⇒ 继续` 而多计一次 rule93 ⇒ 红；
//     规则 9 与 9a-2 的断言、以及"逐字不变"类（A13/A15/A17/A25/A34）不受影响 ⇒ 绿。
//     **A5 从期望红集里移出（G 线 2026-09-25）**：A5 断言的是 F93 产物的**真编译**结果，而 G 段新增的
//     规则 9-W 是 9-3 的超集 —— 9-3 方向写反后，9-W 仍然会兜住 `s *= 500.0 / g_Texture0Resolution`
//     （截右为 `(500.0 / g_Texture0Resolution).xy`，写法不同但同样合法）⇒ 产物**仍然编得过** ⇒ A5 变绿。
//     这不是"判据失效"：同一形态的**文本精确**断言 A4 仍红，而 A5 的语义从此由 A29 那一族接棒。
const EXPECT_RED_FLIP_93 = ['A4', 'A6', 'A16', 'A20', 'A21', 'A23']
//   ③"推不出 ⇒ 原样保留 + 计数"改成静默处理 ⇒ 规则 9 的 A25（逐字保留）/A26（计数）红；
//     9-3 那一半只红 A18（**计数**）—— 实测发现它**红不了 A17**：静默分支即便走到最后，
//     补 swizzle 的那一步也是按宽度表找标识符的，未声明的 `g_Texture0Resolution` 不在表里 ⇒
//     连 `.xy` 都补不上（字节没变）。这说明 9-3 的"安全网"是**双保险**（计数 + 未声明就补不上），
//     而 9 的"未声明"分支是**单保险**（只有计数）—— 如实记进期望红集。
const EXPECT_RED_SILENT = ['A18', 'A25', 'A26']

// ── 跑 ────────────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0
const fails = []
const line = (okFlag, name, detail) => {
  console.log((okFlag ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''))
  if (okFlag) pass++; else { fail++; fails.push(name) }
}
const realShaBefore = sha256(fs.readFileSync(BUNDLE))
const api = { hlsl2glsl: LIB.hlsl2glsl, stats: LIB.h2gWidthStats, reset: LIB.h2gWidthStatsReset }

console.log('hlsl2glsl 宽度表整族（上游 9 / 9-3 / 9a-2）移植判据（P-115）')
console.log('  被测实现 : core/we-scene-bundle.js 的 hlsl2glsl（= 渲染路径在跑的那份；arity=' + LIB.hlsl2glsl.length + '）')
console.log('  上游出处 : vendor/hlsl2glsl/hlsl2glsl.js:644-673(9) / :674-697(9-3) / :699-779(9a-2)')
console.log('  校验器   : ' + (GLSLANG || '（无 glslangValidator ⇒ 真编译一节 SKIP-视作-PASS）'))

console.log('\n== A 合成夹具（10 组；真阳性 + 四类边界）==')
for (const c of CASES) {
  let r
  try { r = await c.fn(api) } catch (e) { r = { pass: false, detail: 'THREW ' + String(e && e.message).slice(0, 120) } }
  line(r.pass, c.name, r.detail)
}

console.log('\n== B 真语料对拍（条件项：真壁纸不随仓库分发）==')
if (NO_CORPUS) console.log('  SKIP B（--no-corpus）')
else {
  const noTable = loadMutant(fs.readFileSync(BUNDLE, 'utf8'), MUT_NO_TABLE, 'no-table')
  let beforeApi = null
  try { const m = await import(noTable.url); beforeApi = { hlsl2glsl: m.hlsl2glsl } } finally { /* 目录留到结束再删 */ }
  // B0 的参照物：**移植前的真源码** = `git show HEAD:core/we-scene-bundle.js`。只在"HEAD 里还没有移植块"时
  //   可用 —— 一旦本次改动被提交，HEAD 就变成带移植块的版本 ⇒ 这条自动 SKIP（不再假装是"移植前"）。
  let headApi = null; let headDir = null
  try {
    const headSrc = execFileSync('git', ['show', 'HEAD:core/we-scene-bundle.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (headSrc.includes('h2gWidthStats')) console.log('  B0 参照物: git HEAD 已含移植块（本次改动已提交）⇒ "before ≡ 移植前真源码" 自动 SKIP')
    else {
      headDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2gw9head-'))
      const hfp = path.join(headDir, 'we-scene-bundle.js')
      fs.writeFileSync(hfp, toTempModule(headSrc))
      const hm = await import(pathToFileURL(hfp).href)
      headApi = { hlsl2glsl: hm.hlsl2glsl }
      console.log('  B0 参照物: git HEAD:core/we-scene-bundle.js sha256=' + sha256(headSrc).slice(0, 16) + '（不含移植块）')
    }
  } catch (e) { console.log('  B0 参照物: 取不到 git HEAD 版（' + String(e && e.message).slice(0, 60) + '）⇒ 该项 SKIP') }
  const R = await runCorpus(api, beforeApi, headApi)
  fs.rmSync(noTable.dir, { recursive: true, force: true })
  if (headDir) fs.rmSync(headDir, { recursive: true, force: true })
  if (R.skip) console.log('  SKIP B（' + R.skip + '）')
  else {
    const changed = R.rows.filter((r) => r.changed)
    const changedIds = changed.map((r) => r.id)
    const expectIds = EXPECT_CHANGED.map((e) => e.id)
    console.log('  语料: ' + R.pkgs + '/' + R.pkgsAll + ' 包（单包上限 ' + R.oneMb + 'MB）· 去重 shader ' + R.rows.length +
      ' · 变化集 ' + changed.length + ' 条')
    console.log('  sourceDigest = ' + R.digest)
    console.log('  计数器: ' + JSON.stringify(R.totals) + ' · unresolved 原因: ' + JSON.stringify(R.reasons))
    console.log('  9-W 自己的 unresolved 原因: ' + JSON.stringify(R.reasons9W))
    console.log('  变化明细（逐条列出）：')
    for (const r of changed) console.log('    · ' + r.id + '  [' + r.stage + '] ' + JSON.stringify(r.stats))
    // 逐条 sha256 口径：before/after 各自 sha256（未变的条目 before===after ⇒ sha 相同）
    const shaChanged = changed.map((r) => r.id)
    // B0：证明"before 参考实现"确实是**移植前**的行为（关掉宽度表 = 那三条规则一条都不跑），
    //     方法是拿 `git show HEAD:` 的真源码逐 shader 逐字节对拍；取不到/已提交则 SKIP。
    if (R.headCompared > 0) {
      line(R.headDiff.length === 0, 'B0 before 参考实现 ≡ 移植前真源码（git HEAD 版）逐 shader 逐字节',
        R.headDiff.length ? R.headDiff.slice(0, 3).join(',') + ' …共 ' + R.headDiff.length + ' 条不同' : R.headCompared + ' 个 shader 全部一致')
    } else console.log('  SKIP B0（HEAD 已含移植块或取不到 git；before 参考实现按注释口径自证）')
    line(R.rows.length >= 20, 'B1 语料规模达到可判定下限（≥20 去重 shader）', String(R.rows.length))
    const wasPass = changed.filter((r) => {
      const c = compiles(r.before, r.stage)
      return c.ok === true
    })
    line(wasPass.length === 0, 'B2 **任何移植前能编译的 shader 输出逐位不变**（0 回归）',
      wasPass.length ? wasPass.map((r) => r.id).join(',') : '变化 ' + shaChanged.length + ' 条，全部来自移植前编不过的那批')
    const snapshotMatch = R.digest === CORPUS_SNAPSHOT.sourceDigest && R.rows.length === CORPUS_SNAPSHOT.shaders
    if (snapshotMatch) {
      line(changedIds.slice().sort().join('\n') === expectIds.slice().sort().join('\n'),
        'B3 变化集 == 预期集（精确相等，' + expectIds.length + ' 条）',
        changedIds.length === expectIds.length ? '逐条一致' : '多/少：' + JSON.stringify({ 实际: changedIds, 预期: expectIds }))
    } else {
      console.log('  DRIFT 语料与记录快照不同（记录 ' + CORPUS_SNAPSHOT.shaders + '/' + String(CORPUS_SNAPSHOT.sourceDigest).slice(0, 16) +
        '，本次 ' + R.rows.length + '/' + R.digest.slice(0, 16) + '）⇒ "变化集精确相等"降级为"新增变化项必须本来编不过"')
      const extra = changed.filter((r) => !expectIds.includes(r.id))
      line(extra.every((r) => compiles(r.before, r.stage).ok !== true),
        'B3′ 语料已变：新增变化项必须全部来自"移植前编不过"的那批', extra.length + ' 条新增变化')
    }
    for (const e of EXPECT_CHANGED) {
      const r = R.rows.find((x) => x.id === e.id)
      line(!!r && r.changed && e.must.test(r.after || ''), 'B4 ' + e.id.split('::')[1] + ' :: ' + e.why,
        r ? (r.changed ? '已在位' : '**没有变化**') : '语料里不存在该 shader（换机/换语料时按 DRIFT 口径）')
    }
    for (const e of EXPECT_CHANGED) {
      const r = R.rows.find((x) => x.id === e.id)
      if (!r) { line(true, 'B5 ' + e.id.split('::')[1] + ' 真编译口径', 'SKIP（语料无此 shader）'); continue }
      const cb = compiles(r.before, r.stage); const ca = compiles(r.after, r.stage)
      line(cb.ok !== true && ca.ok === e.compiles, 'B5 ' + e.id.split('::')[1] + '：移植前 ' +
        (cb.ok === null ? 'SKIP' : (cb.ok ? '编过' : '编不过')) + ' ⇒ 移植后 ' + (ca.ok === null ? 'SKIP' : (ca.ok ? '编过' : '编不过')),
        ca.ok === null ? 'SKIP（无 glslangValidator）' : (ca.ok ? 'OK' : ca.err))
    }
    const knownReasons = new Set(['9-rhs-width-unknown', '9-3-rhs-type-unknown', '9-3-rhs-type-ambiguous', '9-3-rhs-width-conflict', '9a2-float-head-vector-but-width-unprovable', '9a2-vec-head-wider-but-width-unprovable'])
    line(Object.keys(R.reasons).every((k) => knownReasons.has(k)), 'B6 unresolved（宽度推不出、原样保留）的原因都在已知词表内、且逐条打印',
      JSON.stringify(R.reasons))
    // B7（G 线 2026-09-25）：9-W 一族**自己的** unresolved 桶也必须可读、且在已知词表内 ——
    //   与既有 `unresolved` 分开是硬要求（"新规则要有自己的分桶计数，别把旧桶搅乱"）。
    const known9W = new Set(['9W-operand-width-unprovable', '9W-int-operand-not-literal', '9W-builtin-shape-unmodelled', '9W-width-ambiguous-float-and-vec', '9W-rhs-parse-bail', '9W-stmt-shape-bail'])
    line(Object.keys(R.reasons9W).every((k) => known9W.has(k)), 'B7 9-W 自己的 unresolved 原因都在已知词表内、且逐条打印（不动既有 unresolved 桶）',
      JSON.stringify(R.reasons9W) + ' · 既有桶=' + JSON.stringify(R.reasons))
  }
}

console.log('\n== C 分辨力自证（3 组变异；只跑夹具集，语料对拍不重复跑）==')
let mutationChecked = 0
if (NO_MUTATION) {
  console.log('  SKIP C（--no-mutation）')
} else {
  const realSrc = fs.readFileSync(BUNDLE, 'utf8')
  const groups = [
    { tag: 'no-table（关掉宽度表收集）', mut: MUT_NO_TABLE, expect: EXPECT_RED_NO_TABLE },
    { tag: 'flip-9-3（9-3 宽度比较方向写反）', mut: MUT_FLIP_93, expect: EXPECT_RED_FLIP_93 },
    { tag: 'silent（推不出宽度 ⇒ 静默补 swizzle）', mut: MUT_SILENT, expect: EXPECT_RED_SILENT },
  ]
  for (const g of groups) {
    const red = (await redSetOf(realSrc, g.mut, g.tag)).map((n) => n.slice(0, n.indexOf(' ')) || n)
    const exp = g.expect.slice().sort().join(',')
    const act = red.slice().sort().join(',')
    const same = exp === act
    if (same) mutationChecked++
    line(same, 'C ' + g.tag + ' :: 期望红集 == 实际红集', '期望 [' + exp + '] 实际 [' + act + ']')
    if (same) console.log('    MUTANT-RED-OK ' + g.tag + ' 期望红集 == 实际红集（' + red.length + ' 条）')
    else console.log('    MUTANT-RED-MISMATCH ' + g.tag + ' 期望 [' + exp + '] 实际 [' + act + ']')
  }
}

const realShaAfter = sha256(fs.readFileSync(BUNDLE))
line(realShaBefore === realShaAfter, 'D1 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（变异只落 os.tmpdir() 副本）',
  realShaBefore.slice(0, 16))

console.log('\n' + '─'.repeat(72))
console.log(fail ? '✗ 宽度表整族移植判据：' + fail + ' 项失败 / ' + pass + ' 项通过\n  - ' + fails.join('\n  - ')
  : 'ALL PASS（' + pass + ' 项断言' + (NO_MUTATION ? '' : '，变异自证 ' + mutationChecked + '/3 组') + '）')
process.exit(fail ? 1 : 0)

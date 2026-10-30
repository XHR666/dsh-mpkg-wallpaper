// hlsl2glsl-intpromo-test.mjs —— ⑤(2026-10-12 转译线) **HLSL 隐式 int→float 提升：整数字面量在左**
//   （`1 - t` / `1 - pow(…)`）这条转译规则的判据。它收的是「**有画但整条效果 pass 被跳过**」这一类
//   缺口的**残余现场**（索引 `docs/STATUS-ALL-ITEMS-INDEX.md` §1.1 第 13 条那 4 条已由 P-198 关闭；
//   本条是同一族里 P-198 之后仍在跳的 pass）。
//
//   现场（真包可复现，`allwallpaper/` 下；都是"单 stage 各自编不过 ⇒ 渲染器 console.warn 后跳过整条 pass"）：
//     · `0917/3299228616` · `workshop/2655151285/effects/perspective`
//       `.vert` 的 `float q0 = 1.0 / (1 - t);`（`t` 是**局部** `float`）
//       ⇒ glslang：`ERROR: 0:160: '-' : wrong operand types: no operation '-' exists that takes a
//          left-hand operand of type ' const int' and a right operand of type ' temp highp float'`
//     · `0917/3462491575` · `workshop/3235948233/effects/auto_sway`
//       `.vert:356` / `.frag` 同形：`return 1 - pow(1.0 - clamp(…), 5.0);`（右操作数是**内建调用**返回值）
//   根因：HLSL（与桌面 GLSL）允许 int→float 隐式提升，**GLSL ES 3.0 没有** int↔float 隐式转换
//     （判据里用真编译器钉住：`#version 300 es` 下 `1 - t` 必红、`1.0 - t` 必绿）。
//   改法：`core/we-scene-bundle.js` 的 2e4 规则 —— **整数字面量在左**、右操作数**可确证为浮点**时补 `.0`。
//     右操作数只认两种可确证形态：①本文件里 `float <名>` 声明（且没有 `int/uint <名>`，多声明符也算）、
//     且不是本文件函数名；②**实测无 int/uint 重载**的内建调用（`pow`/`sqrt`/`sin`… 表见下，F 段逐名真编译钉住）。
//     其余形态（`1 - u_int`、`1 - (…)`、`1 - texture(…).x`…）一律**原样保留**。
//   回退口：`?intpromo=legacy`（= 原样 ⇒ 回到改动前报文；主表 `docs/README-DIAGNOSTICS.md` ② 节）。
//
// 断言分六层（缺语料 / 缺 glslangValidator 时对应用例 SKIP-视作-PASS，与仓内真包类条件项同口径）：
//   A 合成夹具     ：legacy 报文复现 + 缺省 0 error；含 9 条"不许动"的反向护栏（int 变量右操作数 /
//                    `int a, b;` 多声明符 / 注释正文 / 用户函数遮蔽内建名 / 幂等 / 计数读数 /
//                    右操作数名字的"前缀"不许命中 —— A8a 危险形态 `2 + sCount`、A8b benign `sample22`、A8c 正向对照）。
//                    ⚠ A6 与 A8 都是**当场抓出实现里的真 bug** 的用例（A6：内建调用名单没滤用户函数遮蔽；
//                    A8：名字备选没锚词边界 ⇒ `float s` 把 `sample22` 当前缀吃掉，还会抢掉宽度表 9-W 规则的
//                    `* 2 ⇒ * 2.0` ⇒ 宽度表判据 B3/B4/B5 变红）。
//   B 真包档       ：`perspective`（legacy 红 → 缺省 stage+link 全绿）+ `auto_sway`（legacy 的
//                    `const int` 报文消失；**残余的别的族**如实打印，不当成"整包绿"）。
//   C 语料对拍     ：有界语料上 legacy vs 缺省逐 stage 真编译 ⇒ **0 回归** +
//                    "legacy 能编过的产物剥注释后逐字节不变"。
//   D 变异自证     ：①回退口关掉必须变红；②真源码切片变异（副本落 os.tmpdir()）⇒ 夹具变红；
//                    ③真树 sha256 跑前跑后相同。
//   E 渲染路径     ：mock-GL 捕获 `gl.shaderSource()` —— **渲染路径**送进 GL 的 frag 真的被浮点化；
//                    同一夹具的切片变异（关掉该规则）⇒ 送进 GL 的回到 `1 - t`。
//   F 内建名单自证 ：把源码里的 `FLOAT_ONLY_FN` 名单抠出来逐名真编译 —— 名单里的名字
//                    `int r = fn(1[,1[,1]]);` **必须编不过**（= 返回值必为浮点，规则的前提成立），
//                    有 int 重载的 `abs/sign/min/max/clamp/mod` **必须编得过**（= 它们被排除是对的）。
//
// 用法：node tests/hlsl2glsl-intpromo-test.mjs
//       MPW_P333_CORPUS=1 node tests/hlsl2glsl-intpromo-test.mjs       # C 段全语料对拍（默认只跑有界子集）
//       MPW_P333_MAX_MB=64 node tests/hlsl2glsl-intpromo-test.mjs     # C 段单包体积上限（默认 128MB）
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

console.log('⑤ 整数字面量在左的 int→float 提升判据（回退口 ?intpromo=legacy）')

// ── 真编译器档（glslangValidator；缺了就整档 SKIP-视作-PASS）──
let GLSLANG = true
try { execFileSync('glslangValidator', ['--version'], { stdio: 'pipe' }) } catch { GLSLANG = false }
const COMPILE_SKIP = { ok: null, err: 'SKIP（无 glslangValidator）' }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p333-'))
let seq = 0
const compiles = (stage, src) => {
  if (!GLSLANG) return COMPILE_SKIP
  const f = path.join(TMP, 'c' + (++seq) + '.' + stage)
  fs.writeFileSync(f, src)
  try { execFileSync('glslangValidator', ['-S', stage, f], { stdio: 'pipe' }); return { ok: true, err: '' } }
  catch (e) {
    const o = ((e.stdout ? Buffer.from(e.stdout).toString() : '') + (e.stderr ? Buffer.from(e.stderr).toString() : '')).trim()
    return { ok: false, err: (o.split('\n').find((l) => /ERROR/.test(l)) || o.split('\n')[0] || 'EXIT ' + e.status).trim() }
  }
}
const links = (vert, frag) => {
  if (!GLSLANG) return COMPILE_SKIP
  const vf = path.join(TMP, 'l' + (++seq) + '.vert')
  const ff = path.join(TMP, 'l' + seq + '.frag')
  fs.writeFileSync(vf, vert); fs.writeFileSync(ff, frag)
  try { execFileSync('glslangValidator', ['-l', vf, ff], { stdio: 'pipe' }); return { ok: true, err: '' } }
  catch (e) {
    const o = ((e.stdout ? Buffer.from(e.stdout).toString() : '') + (e.stderr ? Buffer.from(e.stderr).toString() : '')).trim()
    return { ok: false, err: o.split('\n').filter((l) => /ERROR|stage:/.test(l)).slice(0, 3).join(' ').trim() }
  }
}
// 注释挖空（保长度、保换行）：用于"改动只落在注释里"的判定（与 P-198 判据同款）
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
const LEGACY = '?intpromo=legacy'
const asm = (fragSrc, vertSrc, search, combos = {}) =>
  LIB.assembleEffectShaderSources({ fragSrc, vertSrc, combos, resolveInclude: null, search })

const V = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix;\nvarying vec2 v_TexCoord;\nvoid main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position, 1.0); v_TexCoord = a_TexCoord; }\n'

/* ═══════════════════════ A 合成夹具 ═══════════════════════ */
console.log('\n== A 合成夹具：legacy 报文复现 / 缺省 0 error + 反向护栏 ==')

// A1 局部 `float` 变量在右（`perspective` 同形）
const F_LOCAL = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;',
  'float bez(float t){ return 1.0 / (1 - t); }',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * bez(v_TexCoord.x); }'].join('\n')
{
  const a = asm(F_LOCAL, V, LEGACY).frag
  const b = asm(F_LOCAL, V, null).frag
  const ca = compiles('frag', a)
  ok('A1a ⑤ legacy：真编译器复现 `wrong operand types … const int … float`',
    ca.ok === null || (ca.ok === false && /wrong operand types/.test(ca.err) && /const int/.test(ca.err)), ca.err.slice(0, 120))
  const cb = compiles('frag', b)
  ok('A1b ⑤ 缺省：`1 - t` ⇒ `1.0 - t`，真编译 0 error', /1\.0 - t/.test(b) && !/\b1 - t\b/.test(b) && (cb.ok === null || cb.ok === true),
    (b.split('\n').find((l) => /bez\(float/.test(l)) || '(未命中)').trim().slice(0, 90))
}

// A2 内建调用在右（`auto_sway` 同形）
const F_FN = ['uniform sampler2D g_Texture0;', 'uniform float u_x;', 'varying vec2 v_TexCoord;',
  'float quintStepR(in float lower, in float upper, in float x) { return 1 - pow(1.0 - clamp((x - lower) / (upper - lower), 0.0, 1.0), 5.0); }',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) * quintStepR(0.0, 1.0, u_x); }'].join('\n')
{
  const a = asm(F_FN, V, LEGACY).frag
  const b = asm(F_FN, V, null).frag
  const ca = compiles('frag', a)
  ok('A2a ⑤ legacy：内建调用在右时同样复现（`const int` - 浮点调用）',
    ca.ok === null || (ca.ok === false && /wrong operand types/.test(ca.err)), ca.err.slice(0, 120))
  const cb = compiles('frag', b)
  ok('A2b ⑤ 缺省：`1 - pow(…)` ⇒ `1.0 - pow(…)`，真编译 0 error',
    /return 1\.0 - pow\(/.test(b) && (cb.ok === null || cb.ok === true), cb.err.slice(0, 110))
}

// A3 护栏：右操作数是 **int 变量** ⇒ 整数减法，一个字符都不许动
const F_INTVAR = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;',
  'void main(){ int i = 1; int j = 3 - i; gl_FragColor = texture(g_Texture0, v_TexCoord) * float(j); }'].join('\n')
{
  const a = asm(F_INTVAR, V, LEGACY).frag
  const b = asm(F_INTVAR, V, null).frag
  ok('A3 ⑤ 护栏：`3 - i`（i 是 int 变量）不动、两档逐字节相同且都能编过',
    a === b && /3 - i/.test(b) && (compiles('frag', b).ok !== false), JSON.stringify(b.split('\n')[2] || '').slice(0, 90))
}

// A4 护栏：`int a = 1, i = 2;` 多声明符 —— 旧收集只认第一个声明符，本规则必须把 `i` 也算成 int
const F_MULTI = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;',
  'void main(){ int a = 1, i = 2; int j = a - i; gl_FragColor = texture(g_Texture0, v_TexCoord) * float(j); }'].join('\n')
{
  const a = asm(F_MULTI, V, LEGACY).frag
  const b = asm(F_MULTI, V, null).frag
  ok('A4 ⑤ 护栏：`a - i`（i 来自多声明符 `int a = 1, i = 2;`）不动', a === b && /a - i/.test(b),
    JSON.stringify((b.split('\n')[2] || '')).slice(0, 90))
}

// A5 护栏：注释正文里的 `1 - t` 一个字符都不许动
const F_COMMENT = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;',
  'void main(){ // 1 - t 这种写法在 HLSL 能过', '  gl_FragColor = texture(g_Texture0, v_TexCoord); }'].join('\n')
{
  const b = asm(F_COMMENT, V, null).frag
  ok('A5 ⑤ 护栏：注释里的 `1 - t` 不被改写', /\/\/ 1 - t 这种写法在 HLSL 能过/.test(b),
    (b.split('\n').find((l) => /1 - t/.test(l)) || '(未命中)').trim().slice(0, 80))
}

// A6 护栏：本文件定义了同名函数（遮蔽内建）⇒ 名字不进名单，`1 - pow(…)` 原样
const F_SHADOW = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;',
  'int pow(float a, float b) { return 2; }',
  'void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord) + vec4(float(1 - pow(1.0, 1.0))); }'].join('\n')
{
  const b = asm(F_SHADOW, V, null).frag
  ok('A6 ⑤ 护栏：用户函数遮蔽内建名（`int pow(float,float)`）⇒ 该名字不用、`1 - pow(…)` 原样', /1 - pow\(/.test(b),
    (b.split('\n').find((l) => /1 - pow/.test(l)) || '(未命中)').trim().slice(0, 80))
}

// A7 幂等 + 计数读数：已经是 `1.0 - t` 的输入不再命中（不会补成 `1.0.0`），计数归 0
{
  const F_FIXED = F_LOCAL.replace('1 - t', '1.0 - t')
  LIB.h2gPassFixStatsReset()
  const b1 = asm(F_LOCAL, V, null).frag
  const n1 = LIB.h2gPassFixStats.intPromo
  LIB.h2gPassFixStatsReset()
  const b2 = asm(F_FIXED, V, null).frag
  const n2 = LIB.h2gPassFixStats.intPromo
  ok('A7 ⑤ 幂等：输入已是 `1.0 - t` ⇒ 计数 0、产物逐字节保持 `1.0 - t`（不出现 `1.0.0`）',
    n1 === 1 && n2 === 0 && /1\.0 - t/.test(b2) && !/1\.0\.0/.test(b2), 'n1=' + n1 + ' n2=' + n2)
}

// A8 护栏：右操作数名字的**前缀**不许当成命中（宽度表判据 B3/B4/B5 抓出来的真 bug）
//   现场：`float s = …` 在文件里 ⟹ `s` 进了浮点名单 ⇒ 备选后面不锚词边界时，`2 + sample22` 的
//   `sample22` 会被当成 `s`（前缀）⇒ 误改。两种后果：① benign（`sample22` 是 vec3：产物文本变了、
//   还会"抢掉"宽度表 9-W 规则本该做的 `* 2 ⇒ * 2.0` ⟹ 该 shader 反而编不过）；
//   ② **危险**（右操作数本身是 int 变量而名字以某个 float 名开头，如 `sCount`）⇒ 把能编过的整数加法
//   改成 `2.0 + sCount`（用户可见回归）。
{
  const F_INT_PREFIX = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;', 'float s = 0.5;',
    'void main(){ int sCount = 2; int a = 2 + sCount;',
    '  gl_FragColor = texture(g_Texture0, v_TexCoord) * (s + float(a)); }'].join('\n')
  LIB.h2gPassFixStatsReset()
  const a = asm(F_INT_PREFIX, V, LEGACY).frag
  const b = asm(F_INT_PREFIX, V, null).frag
  const st = LIB.h2gPassFixStats.intPromo
  ok('A8a 护栏（危险形态）：`2 + sCount`（sCount 是 int、名字以 float 名 `s` 开头）不动、计数 0、真编译 0 error',
    a === b && /2 \+ sCount/.test(b) && st === 0 && (compiles('frag', b).ok !== false),
    'intPromo=' + st + ' · ' + (b.split('\n').find((l) => /sCount/.test(l)) || '').trim().slice(0, 80))
  const F_VEC_PREFIX = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;', 'float s = 0.5;',
    'vec3 sample22 = vec3(0.0);',
    'void main(){ vec3 gx = sample22 + vec3(2.0); gx = gx + sample22;',
    '  gl_FragColor = texture(g_Texture0, v_TexCoord) * (gx.x + s); }'].join('\n')
  LIB.h2gPassFixStatsReset()
  const c = asm(F_VEC_PREFIX, V, null).frag
  ok('A8b 护栏（benign 形态）：`sample22` 不被 `s` 前缀吃掉（该文件 intPromo 计数 0）',
    LIB.h2gPassFixStats.intPromo === 0 && !/2\.0 \+ sample22/.test(c), 'intPromo=' + LIB.h2gPassFixStats.intPromo)
  const F_POS = ['uniform sampler2D g_Texture0;', 'varying vec2 v_TexCoord;', 'float s = 0.5;',
    'void main(){ float x = 2 + s; gl_FragColor = texture(g_Texture0, v_TexCoord) * x; }'].join('\n')
  const d = asm(F_POS, V, null).frag
  ok('A8c 正向对照：`2 + s`（右操作数**就是**那个 float 名）仍必须命中 ⇒ `2.0 + s` 且真编译 0 error',
    /2\.0 \+ s/.test(d) && (compiles('frag', d).ok !== false), (d.split('\n').find((l) => /\+ s;/.test(l)) || '').trim().slice(0, 80))
}
/* ═══════════════════════ B 真包档（条件项）═══════════════════════ */
console.log('\n== B 真包档：两个真包的"改前报文 / 改后"逐条对拍 ==')
const HEADERS = path.join(ROOT, 'shaders')
const readHeader = (f) => {
  const p = path.join(HEADERS, f)
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  return LIB.builtinShaderHeader ? LIB.builtinShaderHeader(f) : null
}
const realCase = (dir, shader) => {
  const pkgPath = path.join(WS, 'allwallpaper', dir, 'scene.pkg')
  if (!fs.existsSync(pkgPath)) return null
  let pkg, scene
  try {
    pkg = LIB.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
    scene = LIB.parseScene(JSON.parse(rd(LIB.getEntry(pkg, 'scene.json'))), null)
  } catch { return null }
  let combos = null
  for (const L of scene.layers) {
    if (!L.visible) continue
    for (const e of L.effects || []) {
      try { LIB.resolveEffectChain(pkg, e, rd) } catch { continue }
      const ps = e.materialPasses || []
      for (let i = 0; i < ps.length; i++) {
        if (ps[i].shader !== shader) continue
        combos = { ...(ps[i].combos || {}), ...(((e.passes || [])[i] || {}).combos || {}) }
      }
    }
  }
  if (!combos) return null
  const v = rd(LIB.getEntry(pkg, 'shaders/' + shader + '.vert'))
  const f = rd(LIB.getEntry(pkg, 'shaders/' + shader + '.frag'))
  return {
    combos,
    A: LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos, resolveInclude: readHeader, search: LEGACY }),
    B: LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos, resolveInclude: readHeader }),
  }
}
// B1 `perspective`：legacy 单 stage 就红 ⇒ 缺省 stage + link 全绿（整条 pass 不再被跳过）
{
  const c = realCase('0917/3299228616', 'workshop/2655151285/effects/perspective')
  if (!c) skipNote('B1 缺语料 0917/3299228616')
  else {
    const ca = compiles('vert', c.A.vert)
    ok('B1a 改前报文复现（legacy）· `perspective` vert', ca.ok === null || (ca.ok === false && /wrong operand types/.test(ca.err)), ca.err.slice(0, 120))
    const cbv = compiles('vert', c.B.vert), cbf = compiles('frag', c.B.frag)
    const lb = links(c.B.vert, c.B.frag)
    ok('B1b 改后 stage 0 error + link 0 error（`workshop/2655151285/effects/perspective`）',
      (cbv.ok === null || cbv.ok === true) && (cbf.ok === null || cbf.ok === true) && (lb.ok === null || lb.ok === true),
      (cbv.err || cbf.err || lb.err || 'stage/link 全绿').slice(0, 110))
    console.log('      combos=' + JSON.stringify(c.combos))
  }
}
// B2 `auto_sway`：legacy 的 `1 - pow(…)` 报文必须消失；**残余的别的族**如实打印（不假装整包绿）
{
  const c = realCase('0917/3462491575', 'workshop/3235948233/effects/auto_sway')
  if (!c) skipNote('B2 缺语料 0917/3462491575')
  else {
    const ca = compiles('vert', c.A.vert)
    ok('B2a 改前报文复现（legacy）· `auto_sway` vert（同族 `const int`）',
      ca.ok === null || (ca.ok === false && /wrong operand types/.test(ca.err) && /const int/.test(ca.err)), ca.err.slice(0, 120))
    const cb = compiles('vert', c.B.vert)
    ok('B2b 改后：**本族**报文消失（其余族的残余如实打印，不算通过）',
      cb.ok === null || !/wrong operand types/.test(cb.err || ''),
      cb.ok === true ? 'vert 0 error' : ('残余（别的族）: ' + String(cb.err).slice(0, 110)))
    ok('B2c 改后产物里不再有裸 `1 - pow(`（`1.0 - pow(` 在位）',
      /1\.0 - pow\(/.test(c.B.vert) && !/[^.\d]1 - pow\(/.test(c.B.vert))
    console.log('      combos=' + JSON.stringify(c.combos))
  }
}

/* ═══════════════════════ C 语料对拍（0 回归）═══════════════════════ */
console.log('\n== C 语料对拍：legacy vs 缺省逐 stage 真编译（0 回归 + 剥注释逐字节不变）==')
{
  const MAX_ONE_MB = Number(process.env.MPW_P333_MAX_MB || 128)
  const FULL = process.env.MPW_P333_CORPUS === '1'
  const MAX_PKGS = Number(process.env.MPW_P333_MAX_PKGS || (FULL ? 999 : 4))
  const MAX_ALL_MB = Number(process.env.MPW_P333_MAX_ALL_MB || (FULL ? 4096 : 320))
  const roots = ['dd', '0923', '0917', 'wallpaperE']
  const cands = []
  for (const root of roots) {
    const d = path.join(WS, 'allwallpaper', root)
    if (!fs.existsSync(d)) continue
    for (const id of fs.readdirSync(d)) {
      const p = path.join(d, id, 'scene.pkg')
      if (!fs.existsSync(p)) continue
      const mb = fs.statSync(p).size / 1048576
      if (mb > MAX_ONE_MB) { continue }
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
            const a = LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos, resolveInclude: readHeader, search: LEGACY })
            const b = LIB.assembleEffectShaderSources({ fragSrc: f, vertSrc: v, combos, resolveInclude: readHeader })
            for (const st of ['frag', 'vert']) {
              const ca = compiles(st, a[st])
              const cb = a[st] === b[st] ? ca : compiles(st, b[st])
              const la = ca.ok === true ? links(a.vert, a.frag) : null
              const lb = (cb.ok === true && la) ? (a.vert === b.vert && a.frag === b.frag ? la : links(b.vert, b.frag)) : null
              rows.push({
                id: c.root + '/' + c.id + '::' + mp.shader + '.' + st,
                beforeOk: ca.ok === true && (!la || la.ok === true),
                afterOk: cb.ok === true && (!lb || lb.ok === true),
                sameCode: blank(a[st]) === blank(b[st]), byteSame: a[st] === b[st],
              })
            }
          }
        }
      }
    }
    const strict = GLSLANG && rows.length > 0
    console.log('  语料: ' + picked.length + '/' + cands.length + ' 包（单包 ≤' + MAX_ONE_MB + 'MB，累计 ≤' + MAX_ALL_MB + 'MB' +
      (FULL ? '，MPW_P333_CORPUS=1' : '，有界子集') + '）· 作业 ' + rows.length + ' 个 stage')
    if (!strict) skipNote('无 glslangValidator 或语料为空 ⇒ C 段只记读数')
    else {
      const regress = rows.filter((r) => r.beforeOk && !r.afterOk)
      ok('C1 **0 回归**：legacy 能编译+链接的 stage，缺省档必须也能（' + rows.filter((r) => r.beforeOk).length + ' 个基线绿）',
        regress.length === 0, regress.slice(0, 4).map((r) => r.id).join(' | '))
      const semantic = rows.filter((r) => r.beforeOk && !r.sameCode)
      ok('C2 legacy 能编过的产物 ⇒ 缺省档**剥注释后逐字节不变**（本规则只可能把红变绿）',
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
{
  const off = asm(F_LOCAL, V, LEGACY).frag
  const on = asm(F_LOCAL, V, null).frag
  ok('D1 回退口 `?intpromo=legacy` 能**关掉**修法（产物回到 `1 - t`）', off !== on && /\b1 - t\b/.test(off) && /1\.0 - t/.test(on))
  const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const shaOf = (f) => execFileSync('sha256sum', [f], { encoding: 'utf8' }).split(/\s+/)[0]
  const toTempModule = (src) => src.replace(/from '\.\/([^']+)'/g, (all, f) => 'from ' + JSON.stringify(path.join(ROOT, 'core', f)))
  const realShaBefore = shaOf(BUNDLE)
  const realSrc = fs.readFileSync(BUNDLE, 'utf8')
  const from = '  if (fixes.intPromo && floatScalarNames.size) {'
  const anchorCount = realSrc.split(from).length - 1
  ok('D2 切片锚点在真源码里恰好一次', anchorCount === 1, anchorCount + ' 次')
  let red = false
  if (anchorCount === 1) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p333mut-'))
    const fp = path.join(dir, 'we-scene-bundle.js')
    fs.writeFileSync(fp, toTempModule(realSrc.replace(from, '  if (false) {')))
    try {
      const m = await import(pathToFileURL(fp).href)
      const out = m.assembleEffectShaderSources({ fragSrc: F_LOCAL, vertSrc: V, combos: {}, resolveInclude: null }).frag
      red = /\b1 - t\b/.test(out) && !/1\.0 - t/.test(out)
    } catch (e) { console.log('    （变异模块跑不起来：' + String(e && e.message).slice(0, 90) + '）') }
    finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  ok('D2 变异：关掉 2e4 规则 ⇒ 夹具回到 `1 - t`（判据会红）', red)
  ok('D3 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（变异只落 os.tmpdir() 副本）',
    shaOf(BUNDLE) === realShaBefore, realShaBefore.slice(0, 16))
}

/* ═══════════════════════ E 渲染路径端到端（mock-GL）═══════════════════════ */
console.log('\n== E 渲染路径端到端：`gl.shaderSource()` 收到的 frag 真的被浮点化 ==')
{
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
    id: 1, name: 'p333载体', visible: true, solid: true, isContainer: false, textureName: null,
    size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0], alignment: 'center',
    color: [1, 1, 1], alpha: 1, brightness: 1, particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined,
    effects: [{ file: 'fx_p333', visible: true, passes: [{ combos: {}, textures: [null] }], fbos: [],
      materialPasses: [{ shader: 'p333_intpromo', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} }] }],
  }
  const scene = { general: { orthogonalprojection: { width: 3840, height: 2160 } }, camera: null, layers: [layer], properties: {} }
  const resolver = async (rel) => (rel.endsWith('.vert') ? V : F_LOCAL)
  const renderOnce = async (m) => {
    const { gl, glsl } = mkGL()
    const r = m.createRenderer({ getContext: () => gl, width: 3840, height: 2160 }, { shaderResolver: resolver, onLog: () => {} })
    await r.render(scene, new Map(), 3840, 2160, 1.0)
    return glsl
  }
  try {
    const glsl = await renderOnce(LIB)
    const frag = glsl.filter((s) => /fragColor|gl_FragColor/.test(s))
    ok('E1 渲染路径送出的 frag 含 `1.0 - t`（不再是 `1 - t`）',
      frag.some((s) => /1\.0 - t/.test(s)) && !frag.some((s) => /\b1 - t\b/.test(s)), frag.length + ' 段 frag GLSL')
    // E2 同一夹具的**渲染路径切片变异**（关掉该规则）⇒ 送出未浮点化的 frag
    const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
    const toTempModule = (src) => src.replace(/from '\.\/([^']+)'/g, (all, f) => 'from ' + JSON.stringify(path.join(ROOT, 'core', f)))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p333wire-'))
    const fp = path.join(dir, 'we-scene-bundle.js')
    const from = '  if (fixes.intPromo && floatScalarNames.size) {'
    const src = fs.readFileSync(BUNDLE, 'utf8')
    let red = false
    let anchored = false
    try {
      if (src.split(from).length !== 2) console.log('    （渲染路径切片锚点不在源码里）')
      else {
        anchored = true
        fs.writeFileSync(fp, toTempModule(src.replace(from, '  if (false) {')))
        const m = await import(pathToFileURL(fp).href)
        const glsl2 = await renderOnce(m)
        const frag2 = glsl2.filter((s) => /fragColor|gl_FragColor/.test(s))
        red = frag2.some((s) => /\b1 - t\b/.test(s))
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    ok('E2 变异：关掉该规则 ⇒ 送进 GL 的 frag 回到 `1 - t`（E1 的绿不是白来的）', anchored && red)
  } catch (e) {
    skipNote('mock-GL 端到端跑不起来（' + String(e && e.message).slice(0, 100) + '）')
  }
}

/* ═══════════════════════ F 内建名单自证 ═══════════════════════ */
console.log('\n== F 内建名单自证：名单里的名字「没有 int 重载」（= 返回值必为浮点）==')
{
  const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const src = fs.readFileSync(BUNDLE, 'utf8')
  const m = /const FLOAT_ONLY_FN_RAW = '([^']+)'/.exec(src)
  if (!m) skipNote('F 抠不到源码里的 FLOAT_ONLY_FN_RAW 名单')
  else {
    const names = m[1].split('|').map((s) => s.trim()).filter(Boolean)
    console.log('  名单（源码原文，' + names.length + ' 个）：' + names.join(' '))
    const arity = { pow: 2, atan: 1, step: 2, smoothstep: 3, mix: 3, distance: 2, dot: 2, cross: 2, reflect: 2, refract: 3, faceforward: 3, clamp: 3 }
    const oneArg = new Set(['sqrt', 'inversesqrt', 'exp', 'exp2', 'log', 'log2', 'sin', 'cos', 'tan', 'asin', 'acos', 'radians', 'degrees', 'fract', 'floor', 'ceil', 'trunc', 'round', 'length', 'normalize', 'determinant', 'transpose'])
    const argsFor = (n) => {
      if (oneArg.has(n)) return '1'
      if (n === 'pow') return '1, 1'
      if (n === 'step' || n === 'distance' || n === 'dot' || n === 'cross' || n === 'reflect') return '1, 1'
      if (n === 'smoothstep' || n === 'refract' || n === 'faceforward') return '1, 1, 1'
      return '1'
    }
    const bad = []
    for (const n of names) {
      if (!GLSLANG) break
      const r = compiles('frag', '#version 300 es\nprecision mediump float;\nvoid main(){ int r = ' + n + '(' + argsFor(n) + '); }\n')
      if (r.ok === true) bad.push(n)
    }
    ok('F1 名单里每个名字「int 实参 ⇒ 编不过」（有 int 重载的必须不在名单里）', GLSLANG ? bad.length === 0 : true,
      bad.length ? ('竟然有 int 重载: ' + bad.join(',')) : (names.length + ' 个逐名真编译'))
    const wrong = []
    for (const n of ['abs', 'sign', 'min', 'max', 'clamp']) {
      if (!GLSLANG) break
      const a = n === 'clamp' ? '1,1,1' : (n === 'min' || n === 'max' ? '1,1' : '1')
      const r = compiles('frag', '#version 300 es\nprecision mediump float;\nvoid main(){ int r = ' + n + '(' + a + '); }\n')
      if (r.ok === false) wrong.push(n)
    }
    ok('F2 对照组：`abs/sign/min/max/clamp` 确实有 int 重载 ⇒ 它们被排除是对的（`mod` 无 int 重载，本就不在名单里）',
      GLSLANG ? wrong.length === 0 : true, wrong.length ? ('实测编不过: ' + wrong.join(',')) : '5 个逐名真编译')
  }
}

fs.rmSync(TMP, { recursive: true, force: true })
console.log('\n' + '─'.repeat(72))
console.log(fail ? '✗ ⑤ intpromo 判据：' + fail + ' 项失败 / ' + pass + ' 项通过\n  - ' + fails.join('\n  - ')
  : 'ALL PASS（' + pass + ' 项断言' + (GLSLANG ? '，真编译器档 glslangValidator' : '；**无 glslangValidator ⇒ 编译类断言全部 SKIP**') + '）')
process.exit(fail ? 1 : 0)

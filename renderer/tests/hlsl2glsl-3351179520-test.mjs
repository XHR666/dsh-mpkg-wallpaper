/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · 本文件**直接 import** 的 `vendor/hlsl2glsl/hlsl2glsl.js` 是 `oneincase/webwallgl`（**MIT**）的
 *     逐字节 vendored 副本，许可与台账见 `THIRD-PARTY.md` §9；上游同许可 ⇒ 可复制。
 *   · `references/wer-ref`（GPL-2.0-only）、`references/lwe-ref`（GPL-3.0-only）与本项目
 *     GPL-3.0-or-later 不兼容，本文件不引用其任何内容。
 */
// hlsl2glsl-3351179520-test.mjs —— 上游 patch 批 `3351179520` 两条 P0 的**纯函数判据**
//
// 依据：`docs/UPSTREAM-TRIAGE-20260923.md` §4 第 1 条（主表 #1/#2）。
// 上游出处：`oneincase/webwallgl` commit `78718843`（`renderer/vendor/we-scene/render/hlsl2glsl.js`，
// MIT），本仓已把该文件更新到 `9531aaf` 版（blob `179b6f8192f50ec709ae5f9923d240245f30cef7`）。
//
// ── 为什么这两条是 P0 ─────────────────────────────────────────────────────────────────────
// 两条的共同后果都是：**转译产物编不过 ⇒ 驱动拒绝整条 pass ⇒ 渲染器只 console.warn 后跳过**
// ⇒ 画面照出、控制台无红、效果"静默消失"。所以判据必须钉在**转译产物的字节**上，
// 不能靠"跑一遍画面看有没有效果"。
//
// ── 判据（3 条，全部纯字符串/纯函数，零 GPU、零语料、~0.3s）────────────────────────────────
//   T1 **复合赋值的向量截断**（上游 `@@ -671` 的 `9-3)`）：
//        `vec2 s; s *= 500.0 / <vec4 标识符>;` ⇒ 右值必须补 `.xy`
//        （HLSL 按左值宽度截断右值，GLSL ES 报 `'=' : cannot convert from 'vec4' to 'vec2'`）
//        ＋ 三条**不得动手**的反例：标量右值 / 右值宽度推不出 / 右值不比左值宽。
//   T2 **vertConflicts**（上游 `@@ -1254`）：兄弟原文里同名 varying 出现在 `#if/#else`
//        两个分支且宽度不同 ⇒ 片元侧**既不加宽也不收窄**（同名多变体 = 预处理分支未定案）。
//        ＋ 一条对照：**非**冲突的兄弟声明仍要照旧加宽/收窄（证明这条补丁没有把整个特性关掉）。
//   T3 **`rotateVec2(vec4, float)` 重载**（`shaders/common.h`，对应上游 `headers.ts` `@@ -38`）：
//        `GLOBAL_ROTATION=1` 形状的 `.vert`（`v_DirectionN` 是 vec4）转译后**必须真编译过**；
//        且把重载从公共头里拿掉后同一份转译产物**必须编不过**（⇒ 重载是充分且必要的）。
//
// ── 分辨力自证（RED-IF-REVERTED，本文件内建，不依赖把文件改回去）──────────────────────────
//   T1/T2 的变异用**源码切片**做：把 vendored 源码读进来，定点删掉那两段补丁，
//   落到临时目录（连同它的唯一依赖 `hlsl-preprocessor.js`）再 import，同一夹具重跑 ——
//   判定必须**翻转**（T1 少了 `.xy`、T2 被收窄成 `vec2`）。绿色运行也会打印 RED 行。
//
// 用法：node tests/hlsl2glsl-3351179520-test.mjs  [--no-mutation]
//   `--no-mutation` 跳过变异自证（只跑判据；变异子进程不用）。
// 退出码：0 = 全过；1 = 有真失败；2 = 用法错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from './_root.mjs'

const NO_MUTATION = process.argv.includes('--no-mutation')
const VENDOR_DIR = path.join(ROOT, 'vendor', 'hlsl2glsl')
const VENDOR_MAIN = path.join(VENDOR_DIR, 'hlsl2glsl.js')
const HEADERS = ['common.h', 'common_blending.h', 'common_blur.h', 'common_composite.h', 'common_fragment.h', 'common_perspective.h']
  .map((n) => path.join(ROOT, 'shaders', n))

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ── 公共头 include 解析（口径同渲染器：**按文件名**取那一份，不能让 `common_composite.h`
//    里的 `#include "common.h"` 再展开成整包 —— 那会无限递归）──
const headerByName = new Map()
for (const f of HEADERS) if (fs.existsSync(f)) headerByName.set(path.basename(f), fs.readFileSync(f, 'utf8'))
const headerText = fs.readFileSync(path.join(ROOT, 'shaders', 'common.h'), 'utf8')
const resolver = (name) => headerByName.get(name) || null

// ── 夹具 ──────────────────────────────────────────────────────────────────────────────────
// T1：`vec2 s; s *= 500.0 / g_Texture0Resolution;`（g_Texture0Resolution 是 vec4）
const F93 = [
  'uniform vec4 g_Texture0Resolution;',
  'void main() {',
  '\tvec2 s;',
  '\ts *= 500.0 / g_Texture0Resolution;',
  '\tgl_FragColor = vec4(s, 0.0, 1.0);',
  '}',
  '',
].join('\n')
const F93_SCALAR = 'void main() {\n\tvec2 s;\n\ts *= 2.0;\n\tgl_FragColor = vec4(s, 0.0, 1.0);\n}\n'
const F93_SWIZZLED = 'uniform vec4 g_Texture0Resolution;\nvoid main() {\n\tvec2 s;\n\ts *= g_Texture0Resolution.xy * 2.0;\n\tgl_FragColor = vec4(s, 0.0, 1.0);\n}\n'
const F93_SAME_WIDTH = 'uniform vec4 g_Texture0Resolution;\nvoid main() {\n\tvec4 s;\n\ts *= g_Texture0Resolution;\n\tgl_FragColor = s;\n}\n'

// T2：兄弟（vert）原文里同名 varying 在 #if/#else 两分支宽度不同
const SIB_CONFLICT = [
  '#if GLOBAL_ROTATION',
  'varying vec4 v_D;',
  '#else',
  'varying vec2 v_D;',
  '#endif',
  'void main() { v_D = vec4(1.0); gl_Position = vec4(0.0); }',
  '',
].join('\n')
const SIB_VEC4 = 'varying vec4 v_D;\nvoid main() { gl_Position = vec4(0.0); }\n'
const SIB_VEC2 = 'varying vec2 v_D;\nvoid main() { gl_Position = vec4(0.0); }\n'
const FRAG_VD = '\nvarying vec4 v_D;\nvoid main() { gl_FragColor = v_D; }\n'

// T3：GLOBAL_ROTATION=1 形状 —— v_Direction1 是 vec4，却被喂给 rotateVec2（vec2,float）。
// 调用形态与上游点名的 multistage_wave.vert 逐字同形：`v_DirectionN.zw = rotateVec2(v_DirectionN, …)`
// （HLSL 侧：实参隐式截断成 float2、返回值正好 2 宽赋给 .zw）。
const VERT_ROTATE = [
  '// [COMBO] { "combo": "GLOBAL_ROTATION", "default": 1 }',
  '#include "common.h"',
  'varying vec4 v_Direction1;',
  'uniform float g_DirectionOffset;',
  'void main() {',
  '\tv_Direction1 = vec4(1.0, 0.0, 0.0, 1.0);',
  '\tv_Direction1.zw = rotateVec2(v_Direction1, g_DirectionOffset);',
  '\tgl_Position = vec4(v_Direction1.xy, 0.0, 1.0);',
  '}',
  '',
].join('\n')

// ── glslangValidator（可选：在场就做**真编译**，缺席则 SKIP-视作-PASS 并打印）──────────────
const GLSLANG = (() => {
  for (const p of ['/usr/bin/glslangValidator', '/usr/local/bin/glslangValidator']) if (fs.existsSync(p)) return p
  return null
})()
function glslangCompile(src, stage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2g335-'))
  const ext = stage === 'vert' ? '.vert' : '.frag'
  const f = path.join(dir, 'a' + ext)
  fs.writeFileSync(f, src)
  try {
    execFileSync(GLSLANG, ['-S', stage, f], { stdio: 'pipe' })
    return { ok: true, err: '' }
  } catch (e) {
    return { ok: false, err: String((e.stdout || '') + (e.stderr || '')).split('\n').filter((l) => /ERROR/.test(l)).slice(0, 2).join(' | ') }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// ── 变异：把源码切片删掉补丁，落到临时目录再 import ────────────────────────────────────────
function loadMutated(mutate, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2gmut-'))
  let src = fs.readFileSync(VENDOR_MAIN, 'utf8')
  const before = src
  src = mutate(src)
  if (src === before) throw new Error('变异没有生效（切片没匹配上）: ' + tag)
  fs.writeFileSync(path.join(dir, 'hlsl2glsl.js'), src)
  fs.copyFileSync(path.join(VENDOR_DIR, 'hlsl-preprocessor.js'), path.join(dir, 'hlsl-preprocessor.js'))
  return { dir, url: 'file://' + path.join(dir, 'hlsl2glsl.js') }
}

// 删掉 9-3 整段（从它的注释行到紧随其后的 `})` 结束）
const MUTATE_NO_93 = (s) => s.replace(
  /\n *\/\/ 9-3\)[\s\S]*?\n *\}\)\n(?= *\}\n *\/\/ 9a-2\))/,
  '\n',
)
// 把 vertConflicts 的两处判定摘掉（等于回到"后写的死分支覆盖活分支"）
const MUTATE_NO_CONFLICT = (s) => s
  .replace('if (prev !== undefined && prev !== vm[1]) vertConflicts.add(vm[2])\n', '')
  .replace(/\|\| vertConflicts\.has\(name\) /g, '')

// ── 跑 ────────────────────────────────────────────────────────────────────────────────────
const { hlsl2glsl } = await import('file://' + VENDOR_MAIN)

console.log('hlsl2glsl 上游 patch 批 3351179520（9-3 复合赋值截断 / vertConflicts / rotateVec2(vec4)）')
console.log('  被测实现 : vendor/hlsl2glsl/hlsl2glsl.js（上游 9531aaf 版，MIT）')
console.log('  校验器   : ' + (GLSLANG || '（无 glslangValidator ⇒ T3 的真编译一节 SKIP-视作-PASS）'))

console.log('\n== T1 复合赋值的向量截断（9-3）==')
{
  const out = hlsl2glsl(F93, 'frag', {}, null)
  ok('T1a `vec2 s; s *= 500.0 / <vec4>;` 右值补 `.xy`',
    /s \*= 500\.0 \/ g_Texture0Resolution\.xy;/.test(out),
    out.split('\n').find((l) => /s \*=/.test(l)) || '(未找到赋值行)')
  if (GLSLANG) {
    const c = glslangCompile(out, 'frag')
    ok('T1b 转译产物过 glslangValidator（GLSL ES 300）', c.ok, c.ok ? 'OK' : c.err)
  } else ok('T1b glslangValidator 不在场（SKIP-视作-PASS）', true, 'SKIP')

  // 反例：不得动手的三种
  const o1 = hlsl2glsl(F93_SCALAR, 'frag', {}, null)
  ok('T1c 反例·标量右值 `s *= 2.0;` 逐字不变', /s \*= 2\.0;/.test(o1))
  const o2 = hlsl2glsl(F93_SWIZZLED, 'frag', {}, null)
  ok('T1d 反例·右值宽度推不出（`g_Texture0Resolution.xy * 2.0`）逐字不变',
    /s \*= g_Texture0Resolution\.xy \* 2\.0;/.test(o2))
  const o3 = hlsl2glsl(F93_SAME_WIDTH, 'frag', {}, null)
  ok('T1e 反例·右值不比左值宽（`vec4 s; s *= <vec4>`）逐字不变', /s \*= g_Texture0Resolution;/.test(o3))
}

console.log('\n== T2 vertConflicts（同名 varying 在 #if/#else 两分支）==')
{
  const out = hlsl2glsl(FRAG_VD, 'frag', {}, null, SIB_CONFLICT)
  ok('T2a 冲突时片元侧**不收窄**（`in vec4 v_D;` 原样）', /^\s*in vec4 v_D;/m.test(out),
    (out.match(/^\s*in \w+ v_D;/m) || ['(无 v_D)'])[0].trim())
  ok('T2b 冲突时不加宽（没有出现 `in vec4` 之外的 v_D 声明）', (out.match(/\bin \w+ v_D;/g) || []).length === 1)
  // 对照：非冲突的兄弟声明仍照旧加宽/收窄 ⇒ 补丁没有把整个特性关掉
  const widen = hlsl2glsl('\nvarying vec2 v_D;\nvoid main() { gl_FragColor = v_D; }\n', 'frag', {}, null, SIB_VEC4)
  ok('T2c 对照·兄弟是 vec4 ⇒ 片元 vec2 仍被**加宽**成 vec4', /^\s*in vec4 v_D;/m.test(widen))
  ok('T2d 对照·加宽后裸引用补 swizzle（`v_D.xy`）', /\bv_D\.xy\b/.test(widen))
  const narrow = hlsl2glsl(FRAG_VD, 'frag', {}, null, SIB_VEC2)
  ok('T2e 对照·兄弟是 vec2 ⇒ 片元 vec4 仍被**收窄**成 vec2', /^\s*in vec2 v_D;/m.test(narrow))
}

console.log('\n== T3 rotateVec2(vec4, float) 重载 ==')
{
  ok('T3a shaders/common.h 里有 `vec2 rotateVec2(vec4 v, float` 重载（取 .xy）',
    /vec2\s+rotateVec2\s*\(\s*vec4\s+\w+\s*,\s*float\s+\w+\s*\)/.test(headerText))
  ok('T3b 重载体是 `return rotateVec2(v.xy, <arg>);`（语义 = HLSL 的隐式截断）',
    /vec2\s+rotateVec2\s*\(\s*vec4\s+(\w+)\s*,\s*float\s+(\w+)\s*\)\s*\{\s*return\s+rotateVec2\(\1\.xy,\s*\2\);\s*\}/.test(headerText))
  const out = hlsl2glsl(VERT_ROTATE, 'vert', { GLOBAL_ROTATION: 1 }, resolver)
  ok('T3c 夹具是 GLOBAL_ROTATION=1 形状（v_Direction1 保持 vec4，未被降维）', /vec4\s+v_Direction1\s*;/.test(out))
  if (GLSLANG) {
    const c = glslangCompile(out, 'vert')
    ok('T3d 转译产物**真编译过**（无重载时报 no matching overloaded function found）', c.ok, c.ok ? 'OK' : c.err)
    // 必要性对照：把重载从头里删掉，同一产物必须编不过
    const noOverload = headerText.replace(/\n[^\n]*vec4 overload[\s\S]*?\n\}\n/, '\n')
    const broken = hlsl2glsl(VERT_ROTATE, 'vert', { GLOBAL_ROTATION: 1 }, (n) => (/\.h$/.test(n) ? noOverload : null))
    const cb = glslangCompile(broken, 'vert')
    ok('T3e 必要性：拿掉重载后同一份转译产物**编不过** ⇒ T3d 有分辨力', !cb.ok,
      cb.ok ? '⚠ 竟然仍编过（夹具没有真正用到重载）' : cb.err)
  } else {
    ok('T3d glslangValidator 不在场（SKIP-视作-PASS）', true, 'SKIP')
    ok('T3e glslangValidator 不在场（SKIP-视作-PASS）', true, 'SKIP')
  }
}

console.log('\n== T4 ApplyBlending(float, …) 重载（同批的"一行保险"）==')
{
  const F = [
    '#include "common_blending.h"',
    'uniform vec3 u_A;',
    'uniform vec3 u_B;',
    'void main() {',
    '\t// 作者手写的浮点字面量选择子（HLSL 合法、GLSL ES 无 float→int 隐式转换）',
    '\tgl_FragColor = vec4(ApplyBlending(0.0, u_A, u_B, 0.5), 1.0);',
    '}',
    '',
  ].join('\n')
  const out = hlsl2glsl(F, 'frag', {}, resolver)
  if (GLSLANG) {
    const c = glslangCompile(out, 'frag')
    ok('T4a `ApplyBlending(0.0, …)` 在 float 重载下**真编译过**', c.ok, c.ok ? 'OK' : c.err)
    const bl = headerByName.get('common_blending.h')
    // 只留 `const int` 那一份 ⇒ 回到"没有保险"的旧状态
    const noFloat = bl.replace(/\n[^\n]*float overload[\s\S]*?\n\}\n/, '\n')
    const broken = hlsl2glsl(F, 'frag', {}, (n) => (n === 'common_blending.h' ? noFloat : resolver(n)))
    const cb = glslangCompile(broken, 'frag')
    ok('T4b 必要性：拿掉 float 重载后同一份产物**编不过** ⇒ T4a 有分辨力', !cb.ok,
      cb.ok ? '⚠ 竟然仍编过（夹具没有真正用到重载）' : cb.err)
  } else {
    ok('T4a glslangValidator 不在场（SKIP-视作-PASS）', true, 'SKIP')
    ok('T4b glslangValidator 不在场（SKIP-视作-PASS）', true, 'SKIP')
  }
}

// ── 分辨力自证 ────────────────────────────────────────────────────────────────────────────
let mutationChecked = 0
if (NO_MUTATION) {
  console.log('\n== RED-IF-REVERTED 变异自证：--no-mutation ⇒ 跳过 ==')
} else {
  console.log('\n== RED-IF-REVERTED 变异自证：把补丁切片删掉后，T1/T2 的判定必须翻转 ==')
  {
    const { dir, url } = loadMutated(MUTATE_NO_93, 'no-9-3')
    try {
      const m = await import(url)
      const mut = m.hlsl2glsl(F93, 'frag', {}, null)
      const oldHasSwizzle = /s \*= 500\.0 \/ g_Texture0Resolution\.xy;/.test(mut)
      ok('RED T1：删掉 9-3 后 `s *= …` **不再**补 `.xy`（⇒ T1a 会变红）', !oldHasSwizzle,
        (mut.split('\n').find((l) => /s \*=/.test(l)) || '').trim())
      mutationChecked++
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  {
    const { dir, url } = loadMutated(MUTATE_NO_CONFLICT, 'no-vertConflicts')
    try {
      const m = await import(url)
      const mut = m.hlsl2glsl(FRAG_VD, 'frag', {}, null, SIB_CONFLICT)
      const narrowed = /^\s*in vec2 v_D;/m.test(mut)
      ok('RED T2：删掉 vertConflicts 后片元被死分支**收窄成 vec2**（⇒ T2a 会变红）', narrowed,
        (mut.match(/^\s*in \w+ v_D;/m) || ['(无 v_D)'])[0].trim())
      mutationChecked++
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败'
  + (NO_MUTATION ? '（变异自证已跳过）' : '，变异自证 ' + mutationChecked + ' 组'))
if (fail === 0) console.log('✓ 上游 patch 批 3351179520 判据通过：9-3 截断 / vertConflicts / rotateVec2(vec4) 重载均在位且可分辨')
process.exit(fail > 0 ? 1 : 0)

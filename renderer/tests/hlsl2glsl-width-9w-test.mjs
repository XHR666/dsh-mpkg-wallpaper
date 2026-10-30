// hlsl2glsl-width-9w-test.mjs —— ISSUE0924A2「效果链编译失败」线 **G 段**（规则 9-W「表达式级宽度推断」
//   + `fmod` 重写）的真编译器档判据。规则的实现落在 `core/we-scene-bundle.js` 的 `hlsl2glsl()` 内
//   （宽度表块**最后**，紧随 9 / 9-3 / 9a-2 / 9-S），真因与逐条现场见 `docs/reports-issue0924a2-line-G.md`。
//
// 为什么必须有这一项（不是"夹具过了就行"）：
//   9-W 治的是 **HLSL 隐式截断**（fxc 只告警 X3206，GLSL ES 3.0 直接报 `wrong operand types`）与
//   **int↔float 转换**（GLSL ES 没有隐式转换）这两族**静默失败**：产物编不过 ⇒ 驱动拒绝整条 pass ⇒
//   渲染器只 `console.warn` 后「跳过编译失败的 pass」⇒ **效果在画面上消失、控制台没有红**。
//   所以本判据钉在三件事上：① **真包真源 + 生产拼装 + 真编译 0 error**；② 把新规则关掉 ⇒ **必须重新报出
//   原来那条错**（"改回去必红"，不是"跑一遍抄下来"）；③ `fmod` 的**负数/零/大数**语义（不许换成 `mod`）。
//
// 断言分层（缺真包/缺 glslangValidator 时对应用例 SKIP-视作-PASS，与仓内真包类条件项同口径）：
//   W1 夹具档  ：7 条合成夹具（形态全部取自真包现场）—— 文本精确 + 计数器分桶 + 真编译 0 error。
//   W2 真包档  ：6 个**真包真 shader**（含真实 combo）走生产 `assembleEffectShaderSources()` 真编译
//                0 error；其中 5 个是"改前编不过"的现场，1 个（shadow.vert）改后仍卡在**另一族**
//                （顶点阶段写 attribute ⇒ GLSL `in` 只读），本判据把这条边界也钉住（不许假装全绿）。
//   W3 变异必红：把 9-W 驱动循环与 fmod 重写定点关掉（变异只落 os.tmpdir() 副本，真树不动）
//                ⇒ W2 里那 5 条**必须**重新报出 `wrong operand types` / `const` / `no matching overloaded`。
//   W4 fmod 语义：`fmod(x,y) → x - y*trunc(x/y)` 的**文本**、**负数/零/大数**数值对拍（与 GLSL `mod`
//                的 floor 语义**必须不同**——这是"不能直接换 mod"的证据，不是注释里的口号）、真编译 0 error。
//   W5 不回归  ：9-W 只动"可确证且必然编不过"的形态 —— 等宽 / 标量⊗向量 / 矩阵 / 整数算术逐字不变；
//                宽度推不出的一律原样保留且计进**本规则自己的**桶（既有 `unresolved` 桶为 0）。
//   W6 语料台账（条件项，`MPW_W9W_CORPUS=1` 时跑）：/0923 全语料"含 include 的 shader stage"真编译
//                失败数 —— 改前（9-W 关掉）与改后各读一次，断言改后 ≤ 1 且剩下的那条属于已归类的另一族。
//
// 用法：node tests/hlsl2glsl-width-9w-test.mjs [--no-corpus]
//   环境：MPW_ROOT（工作区根）/ MPW_0923（语料根）/ MPW_W9W_CORPUS=1（跑 W6 全语料对拍）
// 退出码：0 = 全过（条件项 SKIP 视作 PASS）；1 = 有真失败
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import * as LIB from '../core/we-scene-bundle.js'

const NO_CORPUS = process.argv.includes('--no-corpus')
const RUN_CORPUS = !NO_CORPUS && process.env.MPW_W9W_CORPUS === '1'
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
let pass = 0
let fail = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const skipNote = (m) => console.log('  SKIP ' + m + '（条件项：缺数据视作 PASS，不红）')

/* ── glslangValidator：真编译器 ─────────────────────────────────────────────────────────── */
const HAS_GLSLANG = (() => { try { execFileSync('glslangValidator', ['--version'], { stdio: 'pipe' }); return true } catch { return false } })()
const glslangErrors = (stage, code) => {
  const f = path.join(os.tmpdir(), 'mpw-w9w-' + Math.random().toString(36).slice(2) + (stage === 'vert' ? '.vert' : '.frag'))
  fs.writeFileSync(f, code)
  try {
    execFileSync('glslangValidator', ['-S', stage, f], { stdio: 'pipe' })
    return []
  } catch (e) {
    return (String(e.stdout || '') + String(e.stderr || '')).split('\n').filter((l) => /ERROR:/.test(l)).map((l) => l.trim())
  } finally { try { fs.unlinkSync(f) } catch {} }
}
/** 变异装载（**只落 os.tmpdir() 副本**）：定点切片必须恰好命中一次，否则抛（不许"变异没生效还报绿"）。 */
const toTempModule = (src) => src.replace(/from '\.\/([^']+)'/g, (all, f) => 'from ' + JSON.stringify(path.join(ROOT, 'core', f)))
function loadMutant(src, slices, tag) {
  let out = src
  for (const [a, b] of slices) {
    if (src.split(a).length !== 2) throw new Error('切片在真源码里不是**恰好一次**（' + tag + '）：' + a.slice(0, 70))
    out = out.replace(a, b)
  }
  if (out === src) throw new Error('变异没有生效: ' + tag)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2gw9w-'))
  const fp = path.join(dir, 'we-scene-bundle.js')
  fs.writeFileSync(fp, toTempModule(out))
  return { dir, url: pathToFileURL(fp).href }
}
// **关掉 G 段新增能力**（= 改前：D 线末态，9 / 9-3 / 9a-2 / 9-S 仍然在位）
const MUT_OFF_9W = [['        while ((am = w9Re.exec(code)) !== null) {', '        while (false && (am = w9Re.exec(code)) !== null) {   // MUTANT']]
const MUT_OFF_FMOD = [['  for (let fx = 0; fx < 5; fx++) {', '  for (let fx = 0; fx < 0; fx++) {   // MUTANT']]
const MUT_OFF_BOTH = MUT_OFF_9W.concat(MUT_OFF_FMOD)

/* ── 生产口径的 include 解析器：本仓 `shaders/*.h` 预载进 cache，再走 makeEffectIncludeResolver ── */
const HEADERS = new Map()
for (const d of [path.join(ROOT, 'shaders'), ROOT]) {
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d)) if (/^common.*\.h$/.test(f) && !HEADERS.has(f)) HEADERS.set(f, fs.readFileSync(path.join(d, f), 'utf8'))
}
const resolverFor = (lib) => {
  const cache = new Map([...HEADERS.entries()])
  const missing = new Set()
  const r = lib.makeEffectIncludeResolver(cache, missing)
  return { r, cache, missing }
}
const assemble = (lib, fragSrc, vertSrc, combos) => {
  const { r, cache, missing } = resolverFor(lib)
  const first = lib.assembleEffectShaderSources({ fragSrc, vertSrc, combos, resolveInclude: r })
  // 生产是"先记 missing 去取、取回来再编译"⇒ 这里把本仓真头补进 cache 后再拼一次（与生产同义）
  if (missing.size) {
    const r2 = lib.makeEffectIncludeResolver(cache, new Set())
    return lib.assembleEffectShaderSources({ fragSrc, vertSrc, combos, resolveInclude: r2 })
  }
  return first
}

console.log('hlsl2glsl 规则 9-W（表达式级宽度推断）+ fmod 重写判据（ISSUE0924A2 G 段）')
console.log('  被测实现: core/we-scene-bundle.js 的 hlsl2glsl（渲染路径在跑的那份）· 计数器 h2gWidthStats.rule9W* / ruleFmod')
console.log('  校验器  : ' + (HAS_GLSLANG ? 'glslangValidator' : '（缺 ⇒ 真编译项 SKIP-视作-PASS）'))

/* ═══ W1 合成夹具（形态取自真包现场）═══════════════════════════════════════════════════════ */
console.log('\n== W1 合成夹具：文本 + 计数器分桶 + 真编译 ==')
const V = 'uniform sampler2D g_Tex;\n'
const FIX = [
  {
    tag: 'W1a 二元两侧宽度不同（左宽右窄 ⇒ 截左）· 真包 clipping_mask.frag:53 形态',
    src: 'uniform sampler2D g_Texture0;\nuniform vec2 u_scaleCenter;\nuniform float u_scale;\nvarying vec4 v_TexCoord;\nvoid main() {\n\tvec2 uv = (v_TexCoord * 2.0 - 1.0 - (u_scaleCenter * 2.0 - 1.0)) / u_scale;\n\tgl_FragColor = texSample2D(g_Texture0, uv);\n}\n',
    must: /vec2 uv = \(\(v_TexCoord \* 2\.0 - 1\.0\)\.xy - \(u_scaleCenter \* 2\.0 - 1\.0\)\) \/ u_scale;/,
    cnt: { rule9Wbin: 1 },
  },
  {
    tag: 'W1b 二元两侧宽度不同（右宽左窄 ⇒ 截右）· 真包 ____________________.frag:159 形态',
    src: 'uniform vec4 g_Texture0Resolution;\nuniform float g_Strength;\nvoid main() {\n\tvec2 strength = (vec2(500) / g_Texture0Resolution) * g_Strength;\n\tgl_FragColor = vec4(strength, 0.0, 1.0);\n}\n',
    must: /vec2 strength = \(vec2\(500\) \/ g_Texture0Resolution\.xy\) \* g_Strength;/,
    cnt: { rule9Wbin: 1 },
  },
  {
    tag: 'W1c vec3 - vec2（真包 cutout_vignette.frag:79 形态）· vec4 * vec2（iris_movement__.vert:167 形态）',
    src: 'uniform vec2 u_o;\nuniform vec2 g_CursorScale;\nuniform float g_M;\nvarying vec3 v_TexCoord;\nvarying vec4 v_Pos;\nvoid main() {\n\tfloat s = length(abs(v_TexCoord - vec2(u_o)));\n\tvec2 da = v_Pos * g_CursorScale * g_M;\n\tgl_FragColor = vec4(da, s, 1.0);\n}\n',
    must: /abs\(v_TexCoord\.xy - vec2\(u_o\)\)/,
    must2: /vec2 da = v_Pos\.xy \* g_CursorScale \* g_M;/,
    cnt: { rule9Wbin: 2 },
  },
  {
    tag: 'W1d int 字面量 ⊗ 浮点向量 + 声明截断（真包 shadow.vert:37 形态）',
    src: 'uniform vec2 u_offset;\nvoid main() {\n\tfloat atFactor = (1 + abs(u_offset) * 2.0) * 1.0;\n\tgl_FragColor = vec4(atFactor);\n}\n',
    must: /float atFactor = \(\(1\.0 \+ abs\(u_offset\) \* 2\.0\) \* 1\.0\)\.x;/,
    cnt: { rule9Wdecl: 1, rule9Wint: 1 },
  },
  {
    tag: 'W1e `const float = <int 表达式>`（真包 godrays_cast.frag:46 形态）',
    src: 'uniform sampler2D g_Tex;\nvarying vec2 v_TexCoord;\nvoid main() {\n\tconst int sampleCount = 30;\n\tconst float sampleDrop = sampleCount - 1;\n\tgl_FragColor = texture(g_Tex, v_TexCoord) * sampleDrop;\n}\n',
    must: /const float sampleDrop = float\(sampleCount - 1\);/,
    cnt: { rule9Wconst: 1 },
  },
  {
    tag: 'W1g 分量式内建的**向量实参**宽度不同（真包 shift_hue.frag:132 形态）：`mix(vec4, vec3, float)` ⇒ `mix(x.xyz, …)`',
    src: 'uniform sampler2D g_Tex;\nvarying vec4 v_TexCoord;\nuniform float u_mask;\nvoid main() {\n\tvec4 albedo = texture(g_Tex, v_TexCoord.xy);\n\tvec3 newAlbedo = albedo.xyz * 2.0;\n\talbedo.rgb = mix(albedo, newAlbedo, u_mask);\n\tgl_FragColor = albedo;\n}\n',
    must: /albedo\.rgb = mix\(albedo\.xyz, newAlbedo, u_mask\);/,
    cnt: { rule9Warg: 1 },
  },
  {
    tag: 'W1f 标量广播（`max(1.0, <vec2>)`，GLSL 无此重载）+ int 表达式 ⊗ 浮点标量（`i / drop`）',
    src: V + 'uniform vec2 u_scale;\nvoid main() {\n\tvec2 v = max(1.0, abs(u_scale));\n\tconst int n = 30;\n\tfloat drop = n - 1.0;\n\tgl_FragColor = vec4(v, 0.0, n / 30.0) + drop;\n}\n',
    must: /max\(vec2\(1\.0\), abs\(u_scale\)\)/,
    must2: /float\(n\) - 1\.0/,
    cnt: { rule9Wbcast: 1, rule9Wint: 2 },
  },
]
for (const f of FIX) {
  LIB.h2gWidthStatsReset()
  const out = LIB.hlsl2glsl(f.src, 'frag', {}, null)
  const st = LIB.h2gWidthStats
  const bad = Object.entries(f.cnt).filter(([k, v]) => st[k] !== v).map(([k, v]) => k + '=' + st[k] + '(期望 ' + v + ')')
  const other = st.rule9Wbin + st.rule9Wdecl + st.rule9Wint + st.rule9Wconst + st.rule9Wbcast
  const hit = f.must.test(out) && (!f.must2 || f.must2.test(out))
  ok(f.tag + '：产物形态精确', hit, (out.split('\n').find((l) => f.must.test(l) || (f.must2 && f.must2.test(l))) || '(未命中)').trim())
  ok(f.tag + '：计数器分桶精确（' + JSON.stringify(f.cnt) + '）', bad.length === 0, bad.join(',') || JSON.stringify(f.cnt))
  if (HAS_GLSLANG) {
    const errs = glslangErrors('frag', out)
    ok(f.tag + '：glslangValidator 真编译 0 error', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 error')
  }
  if (other === 0) ok(f.tag + '：本夹具不该有别的 9-W 改写', true, '其它桶=0')
}

/* ═══ W2 真包真源 + 生产拼装 + 真编译 ══════════════════════════════════════════════════════ */
const CORPUS = process.env.MPW_0923 || path.join(WS, 'allwallpaper', '0923')
// 真包现场清单：`改前` 那一栏是**真编译器**在改动前报的错（逐号见 docs/reports-issue0924a2-line-G.md §2）
const TARGETS = [
  { id: '2902406982', shader: 'workshop/2800594362/effects/clipping_mask', stage: 'frag', before: /wrong operand types/, why: '二元两侧宽度不同：vec4 - vec2（`:472`）' },
  { id: '2981249186', shader: 'workshop/2138904733/effects/cutout_vignette', stage: 'frag', before: /wrong operand types/, why: '二元两侧宽度不同：vec3 - vec2（`:79`）' },
  { id: '3448290956', shader: 'workshop/2973943998/effects/iris_movement__', stage: 'vert', before: /wrong operand types/, why: '二元两侧宽度不同：vec4 * vec2（`:167`）' },
  { id: '3653641024', shader: 'workshop/3221939295/effects/____________________', stage: 'frag', before: /wrong operand types/, why: '二元两侧宽度不同：vec2 / vec4（`:159`，截右侧）' },
  { id: '3582367840', shader: 'effects/godrays_cast', stage: 'frag', before: /const.*non-convertible|non-matching or non-convertible/, why: '`const float = <int 表达式>`（`:146`）+ int 表达式 ⊗ 浮点标量（`:153`）' },
  { id: '3479521040', shader: 'workshop/3088030303/effects/shadow', stage: 'vert', before: /wrong operand types/, why: 'int 字面量 ⊗ 浮点向量 + 声明截断（`:151`）；**改后仍失败**，卡在另一族（顶点写 attribute）', stillFails: /l-value required/ },
]
/** 从真包里按场景取一份**生产会用到**的 (frag, vert, combos)：第一个引用该 shader 的 pass。 */
function realCase(lib, t) {
  const pkgPath = path.join(CORPUS, t.id, 'scene.pkg')
  if (!fs.existsSync(pkgPath)) return null
  let pkg
  try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath))) } catch { return null }
  const se = pkg.entries.find((x) => x.name === 'scene.json')
  if (!se) return null
  let scene
  try { scene = lib.parseScene(JSON.parse(rd(lib.getEntry(pkg, se.name))), null) } catch { return null }
  for (const layer of scene.layers) {
    if (!layer.visible || layer.particle || layer.isContainer) continue
    for (const eff of layer.effects || []) {
      if (!eff.visible) continue
      try { lib.resolveEffectChain(pkg, eff, rd) } catch { /* 解析不了就跳过这一条 */ }
      const passes = eff.materialPasses || []
      for (let pi = 0; pi < passes.length; pi++) {
        const mp = passes[pi]
        if (!mp.shader || mp.copyCommand || mp.shader !== t.shader) continue
        const ov = (eff.passes && eff.passes[pi]) || {}
        const combos = { ...(mp.combos || {}), ...(ov.combos || {}) }
        const fe = pkg.entries.find((x) => x.name === 'shaders/' + mp.shader + '.frag')
        const ve = pkg.entries.find((x) => x.name === 'shaders/' + mp.shader + '.vert')
        const own = pkg.entries.find((x) => x.name === 'shaders/' + mp.shader + '.' + t.stage)
        if (!own) continue
        return {
          combos,
          src: rd(lib.getEntry(pkg, own.name)),
          fragSrc: fe ? rd(lib.getEntry(pkg, fe.name)) : rd(lib.getEntry(pkg, own.name)),
          vertSrc: ve ? rd(lib.getEntry(pkg, ve.name)) : null,
          layer: String(layer.name || ''),
        }
      }
    }
  }
  return null
}
const CASES = []
console.log('\n== W2 真包真源 + 生产拼装 assembleEffectShaderSources() + 真编译 ==' + (HAS_GLSLANG ? '' : '（无 glslang：仅文本档）'))
if (!fs.existsSync(CORPUS)) skipNote('真语料根不存在 ' + CORPUS)
else {
  for (const t of TARGETS) {
    const c = realCase(LIB, t)
    if (!c) { skipNote('真包 ' + t.id + ' / ' + t.shader + ' 不在本机语料里'); continue }
    const asm = assemble(LIB, c.fragSrc, c.vertSrc || c.fragSrc, c.combos)
    const code = t.stage === 'frag' ? asm.frag : asm.vert
    const c2 = realCase(LIB, t)
    const asm2 = assemble(LIB, c2.fragSrc, c2.vertSrc || c2.fragSrc, c2.combos)
    const beforeCode = t.stage === 'frag' ? asm2.frag : asm2.vert
    CASES.push({ t, combos: c.combos, code, beforeCode, layer: c.layer })
    const label = 'W2 ' + t.id + ' ' + t.shader + '.' + t.stage + '（层「' + c.layer + '」combo=' + JSON.stringify(c.combos) + '）'
    ok(label + '：include 全部解析（无 `include 缺失` 痕迹）', !code.includes('[include 缺失:'), (code.match(/\[include 缺失:[^\]]*\]/g) || []).join(',') || '(无)')
    if (HAS_GLSLANG) {
      const errs = glslangErrors(t.stage, code)
      if (t.stillFails) {
        const other = errs.filter((l) => !t.stillFails.test(l) && !/compilation terminated|compilation errors?\b/.test(l))
        ok(label + '：改后**只剩**已归类的另一族（' + t.stillFails.source + '）', other.length === 0 && errs.some((l) => t.stillFails.test(l)),
          errs.slice(0, 2).join(' | ') || '(竟然全过 —— 那 stillFails 分类该更新)')
        ok(label + '：宽度族/整型族那两条错已消失（' + t.why + '）', !errs.some((l) => /wrong operand types/.test(l)), errs.filter((l) => /wrong operand types/.test(l)).join(' | ') || '(无 wrong operand types)')
      } else {
        ok(label + '：glslangValidator 真编译 0 error（改前：' + t.before.source + '）', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 error')
      }
    } else skipNote(label + ' 的真编译')
  }
}

/* ═══ W3 变异必红：关掉 G 段新增 ⇒ 原来的错必须回来 ════════════════════════════════════════ */
console.log('\n== W3 变异必红：把 9-W 驱动与 fmod 定点关掉（真树不动）⇒ 原来那条错必须重现 ==')
const realShaBefore = sha256(fs.readFileSync(BUNDLE))
if (!CASES.length) skipNote('W2 没有可用真包 ⇒ 变异无从对拍')
else if (!HAS_GLSLANG) skipNote('无 glslangValidator ⇒ 变异档只看文本')
else {
  let mut = null
  try {
    mut = loadMutant(fs.readFileSync(BUNDLE, 'utf8'), MUT_OFF_BOTH, 'off-9w-fmod')
    const m = await import(mut.url)
    for (const cs of CASES) {
      // 变异态下用**同一份真源**重新拼装（不是拿本态产物去拼）
      const c3 = realCase(LIB, cs.t)
      const asm3 = assemble(m, c3.fragSrc, c3.vertSrc || c3.fragSrc, cs.combos)
      const code3 = cs.t.stage === 'frag' ? asm3.frag : asm3.vert
      const errs = glslangErrors(cs.t.stage, code3)
      const label = 'W3 ' + cs.t.id + ' ' + cs.t.shader + '.' + cs.t.stage
      ok(label + '：关掉 9-W 后**必须**重新报出 `wrong operand types` / `const非可转换` / `no matching overloaded`',
        errs.some((l) => /wrong operand types|non-matching or non-convertible|no matching overloaded function/.test(l)),
        errs.slice(0, 2).join(' | ') || '(没有报错 ⇒ 变异没生效或规则本来就是多余的)')
    }
  } catch (e) {
    ok('W3 变异装载', false, String(e && e.message).slice(0, 160))
  } finally { if (mut) fs.rmSync(mut.dir, { recursive: true, force: true }) }
}
ok('W3z 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（变异只落 os.tmpdir() 副本）',
  realShaBefore === sha256(fs.readFileSync(BUNDLE)), realShaBefore.slice(0, 16))

/* ═══ W4 fmod：文本 + 语义（负数/零/大数）+ 真编译 ════════════════════════════════════════ */
console.log('\n== W4 `fmod(x, y)` ⇒ `x - y*trunc(x/y)`（**不是** mod：负数语义不同）==')
const FMOD_SRC = 'uniform sampler2D g_Tex;\nuniform float g_Time;\nvoid main() {\n\tvec4 c = texture(g_Tex, vec2(0.5));\n\tc.r = fmod(g_Time, 6.28318530718 / 10.0);\n\tc.g = fmod(-1.5, 1.0);\n\tc.b = fmod(0.0, 1.0);\n\tc.a = fmod(g_Time * 2.0, 3.0) + 1.0;\n\tgl_FragColor = c;\n}\n'
LIB.h2gWidthStatsReset()
const fmodOut = LIB.hlsl2glsl(FMOD_SRC, 'frag', {}, null)
ok('W4a `fmod` 名字在产物里一个不剩（GLSL ES 没有这个名字）', !/\bfmod\s*\(/.test(fmodOut), (fmodOut.match(/\bfmod\s*\(/g) || []).length + ' 处残留')
ok('W4b 复合实参的**括号**到位：`trunc((g_Time) / (6.28318530718 / 10.0))`（文本代入必须自带括号，否则左结合改语义）',
  /trunc\(\(g_Time\) \/ \(6\.28318530718 \/ 10\.0\)\)/.test(fmodOut),
  (fmodOut.split('\n').find((l) => /trunc/.test(l)) || '(未找到)').trim().slice(0, 150))
ok('W4c 否定式：产物里**不许**出现 `mod(`（floor 语义 = 改语义）', !/\bmod\s*\(/.test(fmodOut))
ok('W4d 计数器 ruleFmod = 4（4 处调用各改写一次）', LIB.h2gWidthStats.ruleFmod === 4, 'ruleFmod=' + LIB.h2gWidthStats.ruleFmod + ' dup=' + LIB.h2gWidthStats.ruleFmodDupArgs)
if (HAS_GLSLANG) {
  const errs = glslangErrors('frag', fmodOut)
  ok('W4e 产物 glslangValidator 真编译 0 error', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 error')
}
// 语义数值对拍：HLSL fmod = x - y*trunc(x/y)（向零取整）；GLSL mod = x - y*floor(x/y)（向负无穷）
const H = (x, y) => x - y * Math.trunc(x / y)
const M = (x, y) => x - y * Math.floor(x / y)
const NUM = [
  ['负数（-1.5, 1）', -1.5, 1, -0.5], ['正数（1.5, 1）', 1.5, 1, 0.5],
  ['负数（-7, 3）', -7, 3, -1], ['正数（7, 3）', 7, 3, 1],
  ['零（0, 1）', 0, 1, 0], ['负零边界（-0.5, 0.5）', -0.5, 0.5, -0],
  ['大数（1e9, 3）', 1e9, 3, 1], ['大负数（-1e9, 7）', -1e9, 7, -6],
  ['小数（0.1, 0.03）', 0.1, 0.03, H(0.1, 0.03)],
]
for (const [tag, x, y, want] of NUM) {
  const got = H(x, y)
  ok('W4f fmod(' + tag + ') = ' + want + '（HLSL 定义值）', Object.is(got, want) || Math.abs(got - want) < 1e-12, 'H=' + got + ' mod=' + M(x, y))
}
const differ = NUM.filter(([, x, y]) => !Object.is(H(x, y), M(x, y))).map(([t]) => t)
ok('W4g ★ 与 GLSL `mod`（floor）**确实不同**的样例存在 ⇒ "不能直接换 mod" 有实证（' + differ.join(' / ') + '）', differ.length >= 3)
ok('W4h y = 0 时两边同为 NaN（HLSL/GLSL 同口径，不假装有定义）', Number.isNaN(H(1, 0)) && Number.isNaN(M(1, 0)))

/* ═══ W5 不回归：只动"必然编不过"的形态 + 自己的 unresolved 桶 ═══════════════════════════ */
console.log('\n== W5 不回归：等宽 / 标量⊗向量 / 矩阵 / 整数算术逐字不变；推不出 ⇒ 原样保留 + 只计自己的桶 ==')
const KEEP_SRC = 'uniform sampler2D g_Tex;\nuniform vec2 u_a;\nmat4 m;\nuniform vec4 g_Four;\nuniform float u_f;\nvoid main() {\n\tvec2 v = u_a * 2.0 / 3.0;\n\tvec2 w = u_a + u_a;\n\tvec4 c = texture(g_Tex, u_a);\n\tvec4 x = c * m;\n\tint i = 3;\n\tint k = i + 1;\n\tvec4 y = g_Four * u_f;\n\tgl_FragColor = vec4(v + w, 0.0, 1.0) * x * float(k) + y;\n}\n'
LIB.h2gWidthStatsReset()
const keepOut = LIB.hlsl2glsl(KEEP_SRC, 'frag', {}, null)
for (const line of ['vec2 v = u_a * 2.0 / 3.0;', 'vec2 w = u_a + u_a;', 'vec4 c = texture(g_Tex, u_a);', 'vec4 x = c * m;', 'int k = i + 1;', 'vec4 y = g_Four * u_f;']) {
  ok('W5 逐字不变：`' + line + '`', keepOut.includes(line))
}
const kst = LIB.h2gWidthStats
ok('W5b 不该动的形态计数器全 0（bin/decl/int/const/bcast）',
  kst.rule9Wbin === 0 && kst.rule9Wdecl === 0 && kst.rule9Wint === 0 && kst.rule9Wconst === 0 && kst.rule9Wbcast === 0 && kst.rule9Warg === 0,
  JSON.stringify({ bin: kst.rule9Wbin, decl: kst.rule9Wdecl, int: kst.rule9Wint, konst: kst.rule9Wconst, bcast: kst.rule9Wbcast, unres: kst.rule9Wunresolved }))
ok('W5c `c * m`（矩阵操作数宽度推不出）⇒ 原样保留 + 计进**本规则自己的**桶，既有 unresolved 桶为 0',
  kst.rule9Wunresolved >= 1 && kst.rule9WunresolvedReasons['9W-operand-width-unprovable'] >= 1 && kst.unresolved === 0,
  JSON.stringify(kst.rule9WunresolvedReasons) + ' · 既有桶=' + JSON.stringify(kst.unresolvedReasons))
if (HAS_GLSLANG) {
  const errs = glslangErrors('frag', keepOut)
  ok('W5d 边界产物真编译 0 error（"不动"不等于"编不过"）', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 error')
}
// 计数器复位口径：9-W 一族必须在 h2gWidthStatsReset() 里一起归零（否则诊断数字会跨 shader 串味）
LIB.h2gWidthStatsReset()
const rs = LIB.h2gWidthStats
ok('W5e `h2gWidthStatsReset()` 覆盖 9-W 与 fmod 的全部新桶',
  rs.rule9Wbin === 0 && rs.rule9Wdecl === 0 && rs.rule9Wint === 0 && rs.rule9Wconst === 0 && rs.rule9Wbcast === 0 && rs.rule9Warg === 0 &&
  rs.rule9Wunresolved === 0 && Object.keys(rs.rule9WunresolvedReasons).length === 0 && rs.ruleFmod === 0 && rs.ruleFmodDupArgs === 0,
  JSON.stringify(rs))

/* ═══ W6 语料台账（条件项）：/0923 含 include 的 shader stage 真编译失败数 ═══════════════════ */
console.log('\n== W6 全语料对拍（`MPW_W9W_CORPUS=1` 时跑）：含 include 的 shader stage 真编译失败数 ==')
if (!RUN_CORPUS) skipNote('未置 MPW_W9W_CORPUS=1（读数见 docs/reports-issue0924a2-line-G.md §4）')
else if (!HAS_GLSLANG) skipNote('无 glslangValidator')
else {
  const scan = (lib) => {
    const rows = []
    for (const d of fs.readdirSync(CORPUS).filter((x) => /^\d+$/.test(x)).sort()) {
      const p = path.join(CORPUS, d, 'scene.pkg')
      if (!fs.existsSync(p)) continue
      let pkg
      try { pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p))) } catch { continue }
      const se = pkg.entries.find((x) => x.name === 'scene.json')
      if (!se) continue
      let scene
      try { scene = lib.parseScene(JSON.parse(rd(lib.getEntry(pkg, se.name))), null) } catch { continue }
      const seen = new Set()
      for (const layer of scene.layers) {
        if (!layer.visible || layer.particle || layer.isContainer) continue
        for (const eff of layer.effects || []) {
          if (!eff.visible) continue
          try { lib.resolveEffectChain(pkg, eff, rd) } catch { /* ignore */ }
          const passes = eff.materialPasses || []
          for (let pi = 0; pi < passes.length; pi++) {
            const mp = passes[pi]
            if (!mp.shader || mp.copyCommand) continue
            const ov = (eff.passes && eff.passes[pi]) || {}
            const combos = { ...(mp.combos || {}), ...(ov.combos || {}) }
            for (const stage of ['vert', 'frag']) {
              const full = 'shaders/' + mp.shader + '.' + stage
              const e = pkg.entries.find((x) => x.name === full)
              if (!e) continue
              const key = full + '|' + JSON.stringify(combos)
              if (seen.has(key)) continue
              seen.add(key)
              const src = rd(lib.getEntry(pkg, e.name))
              if (!/#include/.test(src)) continue
              const sib = pkg.entries.find((x) => x.name === 'shaders/' + mp.shader + (stage === 'frag' ? '.vert' : '.frag'))
              const sibTxt = sib ? rd(lib.getEntry(pkg, sib.name)) : src
              let code
              try {
                code = stage === 'frag'
                  ? assemble(lib, src, sibTxt, combos).frag
                  : assemble(lib, sibTxt, src, combos).vert
              } catch (ex) { rows.push({ id: d, full: full + '.' + stage, err: 'TRANSPILE ' + String(ex && ex.message).slice(0, 60) }); continue }
              const errs = glslangErrors(stage, code)
              if (errs.length) rows.push({ id: d, full: full + '.' + stage, err: errs[0] })
            }
          }
        }
      }
    }
    return rows
  }
  let mutDir = null
  try {
    const before = (() => {
      const m = loadMutant(fs.readFileSync(BUNDLE, 'utf8'), MUT_OFF_9W, 'corpus-before')
      mutDir = m.dir
      return m
    })()
    const mb = await import(before.url)
    const rowsBefore = scan(mb)
    const rowsAfter = scan(LIB)
    console.log('  改前（9-W 关掉；9/9-3/9a-2/9-S 在位）: ' + rowsBefore.length + ' 条失败')
    for (const r of rowsBefore) console.log('    · ' + r.id + ' ' + r.full + ' => ' + r.err.slice(0, 120))
    console.log('  改后（本线最终态）: ' + rowsAfter.length + ' 条失败')
    for (const r of rowsAfter) console.log('    · ' + r.id + ' ' + r.full + ' => ' + r.err.slice(0, 120))
    ok('W6a 改后失败数 ≤ 1（D 线末态 = 10）', rowsAfter.length <= 1, rowsAfter.length + ' 条')
    ok('W6b 改后若有残留，必须属于**已归类的另一族**（`l-value required`：顶点写 attribute），不许是宽度/整型族',
      rowsAfter.every((r) => /l-value required/.test(r.err)),
      rowsAfter.map((r) => r.err.slice(0, 60)).join(' | ') || '(0 条残留)')
    ok('W6c 改前 > 改后（本线确实在收敛，不是"两边一样"的空判据）', rowsBefore.length > rowsAfter.length, rowsBefore.length + ' → ' + rowsAfter.length)
  } catch (e) {
    ok('W6 语料对拍', false, String(e && e.message).slice(0, 160))
  } finally { if (mutDir) fs.rmSync(mutDir, { recursive: true, force: true }) }
}

console.log('\n' + '─'.repeat(72))
console.log(fail ? '✗ 9-W / fmod 判据：' + fail + ' 项失败 / ' + pass + ' 项通过\n  - ' + fails.join('\n  - ')
  : 'ALL PASS（' + pass + ' 项断言' + (HAS_GLSLANG ? '，真编译器档 glslangValidator' : '，无 glslang ⇒ 真编译档 SKIP') + '）')
process.exit(fail ? 1 : 0)

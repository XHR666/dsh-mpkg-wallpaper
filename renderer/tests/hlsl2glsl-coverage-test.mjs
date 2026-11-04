// hlsl2glsl-coverage-test.mjs —— P-93 覆盖率门禁 + **P-114 对准在跑的实现（wired）**
//
// 复现：node hlsl2glsl-coverage-test.mjs          # 人读
//       node hlsl2glsl-coverage-test.mjs --json   # 机读
//       MPW_H2G_MAX_PKGS=8 node hlsl2glsl-coverage-test.mjs   # 多取几个包（更接近文档的 15 包口径）
//       MPW_H2G_IMPL=vendor node hlsl2glsl-coverage-test.mjs  # 只测 vendored 那份（**非默认**，用于复核 P-114 的取舍）
//
// 依据：`docs/SIMILAR-PROJECTS-RESEARCH.md` §6.3 的 P1 完成判据原文 ——
//   「`hlsl2glsl` 作为**可选**效果路径接入 + 覆盖率回归门禁（用 `docs/HLSL2GLSL-COVERAGE.md` 的语料口径）
//     ⇒ **新增门禁项，把 98.2% 这个数字变成会变红的断言**（而不是文档里的数字）」
// P-93 当时只做了**后半句**（覆盖率回归门禁），且门禁 import 的是 `vendor/hlsl2glsl/` —— 而渲染路径
// 用的是 `core/we-scene-bundle.js` 里自研的那份（`:4106` 定义、`:7268-7269` 调用，全文件 0 处引用 vendor）
// ⇒ 门禁当时守的是**没在跑的实现**（audit 2026-09-18 指出，本文件据此改）。
//
// ①(P-114 2026-09-18) **本门禁现在守"在跑的那份"**：默认 import `core/we-scene-bundle.js` 的
//   `hlsl2glsl`（= 渲染路径调用的同一个模块内绑定），并新增"接线身份"断言（vendored 那份跑赢才算红）。
//   取舍证据（为什么**不**把 vendored 接进去）：真实渲染路径口径下（11 包 128 个 effect-chain 作业、
//   真 combos）自研 128/128 真编译通过、vendored 120/128 —— vendored 有 8 个作业编不过而自研全过，
//   反方向 0 个。见 PATCHES.md P-114 与 docs/HLSL2GLSL-COVERAGE.md 的 P-114 附注。
//
// ②(P-114) **括号平衡检查改成"剥注释/字符串后再数"**：旧口径直接数全文，而自研实现**保留注释**
//   （vendored 那份 stripComments），我们自己 `shaders/common*.h` 的注释正文里就有不成对的 `(`
//   ⇒ 旧口径把**注释散文**算成了"括号不平衡"，14 个 shader 被误判为"可疑"（glslangValidator 真编译
//   全部通过）。改后仍打印**原文计数**作对照，判定用剥注释后的计数（更严格地对应真实 GLSL 语法）。
//
// 口径（与 `docs/HLSL2GLSL-COVERAGE.md` §2.1 的三态定义**逐条对齐**）：
//   · 候选 = `<语料根>/<id>/scene.pkg`，取包内 `shaders/**` 下 `.frag/.vert`，按 **sha256 内容去重**
//   · `通过`   = 产出 ∧ 无 HLSL 残留 token ∧ 括号/花括号平衡 ∧ （有 glslangValidator 时）GLSL ES 300 真编译过
//   · `可疑`   = 产出但上面任一条不成立
//   · `抛错`   = `hlsl2glsl()` 抛异常（**任何一条都算回归**，文档基线是 0）
//   · 语料**只在作者机存在**（真实壁纸不随仓库分发，P-87）⇒ 找不到包时 **SKIP 不红**（条件项）。
//
// 语料裁剪（**本机内存只有一名额**：仓库门禁文档明确记录过"内存压力导致假超时"的坑）：
//   默认最多 4 个包、单包 ≤128MB、累计 ≤320MB，**按体积升序**取（小包先跑，先拿到结论）。
//   语料文件数 ≥ 文档口径 114 时按 98.2% 断言；被裁剪时按回归下限 95% 断言并**明确打印这是子集**。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
// ①(P-114) **被测实现 = 渲染路径真正在用的那份**：`core/we-scene-bundle.js` 的 `hlsl2glsl`
//   （`:4106` 定义、`:7268-7269` 被渲染路径调用；同一模块内绑定 ⇒ 这里 import 到的就是它）。
import * as WIRED_LIB from '../core/we-scene-bundle.js'
// ①(P-114) vendored 那份**不再是**被测对象，只用于"为什么没接它"的可复核对照（见文件末尾 A/B 段）。
import { hlsl2glsl as VENDORED } from '../vendor/hlsl2glsl/hlsl2glsl.js'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const IMPL_NAME = process.env.MPW_H2G_IMPL === 'vendor' ? 'vendor' : 'wired'
const hlsl2glsl = IMPL_NAME === 'vendor' ? VENDORED : WIRED_LIB.hlsl2glsl
// 自研那份不收第 5 参 siblingSrc（跨 stage 合并 [COMBO] 默认值是 vendored 的能力）；多传的实参被忽略。
// ①(P-114 / P-198 2026-09-25) "第 5 参 = siblingSrc" 按**形参名**判，不按 arity：P-198 给内联实现加了
//   第 5 个可选参 `search`（三条新转译规则的回退口，见 tests/hlsl2glsl-passfix-test.mjs），arity 从 4 变 5
//   —— 但那个参数**不是** siblingSrc，P-114 的结论（内联实现不合并跨 stage 的 [COMBO] 默认值）一字不变。
const WIRED_TAKES_SIBLING = IMPL_NAME === 'vendor'
  ? VENDORED.length >= 5
  : (() => {
    const s = String(WIRED_LIB.hlsl2glsl)
    return s.slice(s.indexOf('(') + 1, s.indexOf(')')).split(',').map((x) => x.trim()).includes('siblingSrc')
  })()

const HERE = ROOT
const JSON_OUT = process.argv.includes('--json')
const MAX_PKGS = Number(process.env.MPW_H2G_MAX_PKGS || 4)
const MAX_ONE_MB = Number(process.env.MPW_H2G_MAX_ONE_MB || 128)
const MAX_ALL_MB = Number(process.env.MPW_H2G_MAX_ALL_MB || 320)
const DOC_TOTAL = 114          // 文档口径的去重文件数（§1.2）
const DOC_RATIO = 0.982        // 文档口径的覆盖率（112/114，§0 第 1 条）
const SUBSET_RATIO = 0.95      // 语料被裁剪时的回归下限

// ── 与服务器同序的包解析器解析链（缺了就没语料可读 ⇒ 条件项 SKIP） ──
// ①(2026-10-30 路径固化) 解析链补集成布局候选：插件树 = ROOT 的兄弟目录 `plugin/`（改名自 dsh-mpkg-wallpaper）；
//   旧兄弟仓名保留为回退（原检出仍可跑）。顺序：env → 本仓自带 → 集成插件 → 旧兄弟仓。
const MPW_ROOT = process.env.MPW_ROOT || path.resolve(HERE, '..')
const PKG_EXTRACT = process.env.MPW_PKG_EXTRACT
  || (fs.existsSync(path.join(HERE, 'pkg-extract.mjs')) ? path.join(HERE, 'pkg-extract.mjs')
    : (fs.existsSync(path.join(HERE, '..', 'plugin', 'lib', 'pkg-extract.js')) ? path.join(HERE, '..', 'plugin', 'lib', 'pkg-extract.js')
      : path.join(MPW_ROOT, 'dsh-mpkg-wallpaper', 'lib', 'pkg-extract.js')))
if (!fs.existsSync(PKG_EXTRACT)) {
  console.log('SKIP hlsl2glsl-coverage（找不到包解析器 ' + PKG_EXTRACT + '；装法见 docs/PACKAGING.md §2）')
  process.exit(0)
}
// 语料根：显式 MPW_SCENE_ROOT > MPW_ROOT/allwallpaper/dd > <repo>/samples
const SCENE_ROOT = process.env.MPW_SCENE_ROOT
  || [path.join(MPW_ROOT, 'allwallpaper', 'dd'), path.join(HERE, 'samples')].find((d) => { try { return fs.statSync(d).isDirectory() } catch { return false } })
if (!SCENE_ROOT) { console.log('SKIP hlsl2glsl-coverage（无语料根）'); process.exit(0) }

const { parsePkg, readPkgEntry } = await import(PKG_EXTRACT)

const cands = []
try {
  for (const id of fs.readdirSync(SCENE_ROOT)) {
    const fp = path.join(SCENE_ROOT, id, 'scene.pkg')
    try { const st = fs.statSync(fp); if (st.isFile()) cands.push({ id, fp, bytes: st.size, mtimeMs: st.mtimeMs }) } catch { /* 非包 */ }
  }
} catch { /* 语料根读不了 ⇒ 下面按无候选 SKIP */ }
if (!cands.length) { console.log('SKIP hlsl2glsl-coverage（' + SCENE_ROOT + ' 下没有 <id>/scene.pkg；真实壁纸不随仓库分发，见 samples/README.md）'); process.exit(0) }

// 按体积升序裁剪（内存友好优先）
cands.sort((a, b) => a.bytes - b.bytes)
const picked = []
let acc = 0
for (const c of cands) {
  if (picked.length >= MAX_PKGS) break
  if (c.bytes / 1048576 > MAX_ONE_MB) continue
  if ((acc + c.bytes) / 1048576 > MAX_ALL_MB) continue
  picked.push(c); acc += c.bytes
}
if (!picked.length) { console.log('SKIP hlsl2glsl-coverage（候选包都超过单包上限 ' + MAX_ONE_MB + 'MB）'); process.exit(0) }

// ── include 解析：用**本仓库自研**的 common*.h（不复制上游头表；见 vendor/hlsl2glsl/README.md §2） ──
// ①(2026-09-16 目录整理) 6 个自研 shader 头从仓库根移入 `shaders/`（根目录瘦身）；
//   这里扫 `ROOT/shaders`，并保留对旧落点（根）的兼容。
const HEADER_DIRS = [path.join(ROOT, 'shaders'), ROOT, HERE]
const HEADERS = new Map()
for (const dir of HEADER_DIRS) {
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir)) {
    if (/^common.*\.h$/.test(f) && !HEADERS.has(f)) { try { HEADERS.set(f, fs.readFileSync(path.join(dir, f), 'utf8')) } catch { /* ignore */ } }
  }
}
const includeResolver = (name) => HEADERS.get(String(name).split('/').pop()) ?? null

// ── glslangValidator（可选：有则按文档的"严格三态"，无则退化成"产出+残留检查"并如实标注） ──
let GLSLANG = ''
try { GLSLANG = execFileSync('sh', ['-c', 'command -v glslangValidator'], { encoding: 'utf8' }).trim() } catch { GLSLANG = '' }
function compiles(src, stage) {
  if (!GLSLANG) return null
  const ext = stage === 'vert' ? '.vert' : '.frag'
  const fp = path.join(process.env.TMPDIR || '/tmp', 'mpw-h2g-' + process.pid + '-' + Math.abs(hash(src)) + ext)
  try {
    fs.writeFileSync(fp, src)
    execFileSync(GLSLANG, ['-S', stage === 'vert' ? 'vert' : 'frag', fp], { stdio: 'pipe', timeout: 20000 })
    return true
  } catch { return false } finally { try { fs.unlinkSync(fp) } catch { /* ignore */ } }
}
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }

// ── 抽取语料（逐包顺序处理，用完立刻释放，避免叠加占用） ──
const uniq = new Map()   // sha256 → { name, stage, src, pkgs:[], path }
const pkgReport = []
for (const c of picked) {
  let data = null
  try {
    data = fs.readFileSync(c.fp)
    const idx = parsePkg(data)
    const sh = idx.filter((e) => /(^|\/)shaders\//i.test(e.path) && /\.(vert|frag)$/i.test(e.path))
    let n = 0
    for (const e of sh) {
      let buf = null
      try { buf = Buffer.from(readPkgEntry(data, e)) } catch { continue }
      const sha = crypto.createHash('sha256').update(buf).digest('hex')
      const stage = /\.vert$/i.test(e.path) ? 'vert' : 'frag'
      if (!uniq.has(sha)) uniq.set(sha, { sha, name: path.basename(e.path), stage, src: buf.toString('utf8'), pkgs: [], path: e.path })
      uniq.get(sha).pkgs.push(c.id)
      n++
    }
    pkgReport.push({ id: c.id, mb: +(c.bytes / 1048576).toFixed(1), entries: idx.length, shaderRefs: n })
  } catch (e) {
    pkgReport.push({ id: c.id, mb: +(c.bytes / 1048576).toFixed(1), error: String(e && e.message).slice(0, 120) })
  }
  data = null
  await new Promise((r) => setImmediate(r))     // 让 GC 有机会回收大 Buffer
}

const files = [...uniq.values()].sort((a, b) => a.stage.localeCompare(b.stage) || a.name.localeCompare(b.name))
if (!files.length) { console.log('SKIP hlsl2glsl-coverage（' + picked.length + ' 个包内没有 shaders/**/*.frag|vert）'); process.exit(0) }

// ── 逐文件过转译器 ──
const RESIDUAL = /\b(float[234]x?[234]?|tex2D|cbuffer|SamplerState|SV_Target|SV_Position|TEXCOORD\d|\[unroll\]|static const|half[234]?)\b/
// ①(P-114) 剥注释与字符串字面量：括号平衡必须数**真的 GLSL 语法**，不能数注释散文。
//   实证（2026-09-18）：自研实现保留注释（vendored stripComments），而 `shaders/common*.h` 的注释正文里
//   就有不成对的 `(`（如 "(and the wallpaper packages they come from)" 跨行）⇒ 旧口径把 14 个
//   **glslangValidator 真编译通过**的 shader 判成"括号不平衡 ⇒ 可疑"。这里剥掉再数（原文计数仍打印）。
function stripCommentsAndStrings(s) {
  let out = '', i = 0
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue }
    if (s[i] === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue }
    if (s[i] === '"' || s[i] === "'") { const q = s[i++]; while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++ } i++; out += ' '; continue }
    out += s[i++]
  }
  return out
}
function count(s, ch) { let n = 0; for (const c of s) if (c === ch) n++; return n }
// 三态判定（与文档 §2.1 逐条对齐）；`raw` 只作诊断，不参与判定
function runOne(impl, f, sibling) {
  let out = null, err = ''
  try { out = impl(f.src, f.stage, {}, (n) => includeResolver(n), sibling ? sibling.src : '') } catch (e) { err = String(e && e.message).slice(0, 120) }
  if (!out) return { out, err, verdict: 'throw', reason: err }
  const code = stripCommentsAndStrings(out)
  const balanced = count(code, '{') === count(code, '}') && count(code, '(') === count(code, ')')
  const rawBalanced = count(out, '{') === count(out, '}') && count(out, '(') === count(out, ')')
  const residual = RESIDUAL.test(code)
  const cok = balanced && !residual ? compiles(out, f.stage) : false
  const verdict = (balanced && !residual && cok !== false) ? 'pass' : 'suspect'
  return { out, err, verdict, balanced, rawBalanced, residual, cok, reason: residual ? 'HLSL 残留 token' : (!balanced ? '括号不平衡' : (cok === false ? 'GLSL ES 300 编不过' : '')) }
}
const COMPARE = process.env.MPW_H2G_COMPARE !== '0'   // 默认做 A/B 对照（复核 P-114 的取舍）；=0 只跑被测实现
const rows = []
for (const f of files) {
  const sibling = files.find((o) => o.stage !== f.stage && o.path.replace(/\.(vert|frag)$/i, '') === f.path.replace(/\.(vert|frag)$/i, ''))
  const r = runOne(hlsl2glsl, f, sibling)
  const v = COMPARE ? runOne(VENDORED, f, sibling) : null
  rows.push({ name: f.name, stage: f.stage, pkgs: [...new Set(f.pkgs)].length, sha: f.sha, ...r, v })
}

const passN = rows.filter((r) => r.verdict === 'pass').length
const suspect = rows.filter((r) => r.verdict === 'suspect')
const thrown = rows.filter((r) => r.verdict === 'throw')
const ratio = passN / rows.length
const isDocCorpus = files.length >= DOC_TOTAL
// 门槛可被环境变量**抬高**（只允许抬高不允许压低）：用于自证"这条断言真的会变红"。
//   ⚠ ①(P-114) 口径变了：被测实现改成在跑的自研那份后本机是 **46/46 = 100%** ⇒ 旧的
//   `MPW_H2G_MIN_RATIO=0.999` **不再会红**（1.0 ≥ 0.999）。现在可复现的自证是把被测实现指回 vendored：
//     `MPW_H2G_IMPL=vendor MPW_H2G_MIN_RATIO=0.99 node hlsl2glsl-coverage-test.mjs; echo rc=$?` ⇒ rc=1
//   另外 `MPW_H2G_IMPL=vendor` 单跑复现 P-93 记录的 45/46 = 97.8%（口径未被我改坏）。
const floor = Math.max(isDocCorpus ? DOC_RATIO : SUBSET_RATIO, Number(process.env.MPW_H2G_MIN_RATIO || 0))

let failN = 0
const fails = []
const check = (name, ok, detail) => { if (!ok) { failN++; fails.push(name + (detail ? ' — ' + detail : '')) } console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : '')) }

console.log('hlsl2glsl 覆盖率门禁（P-93 覆盖率 + P-114 对准在跑的实现）')
console.log('  被测实现 : ' + (IMPL_NAME === 'wired' ? '自研 core/we-scene-bundle.js:4106（= 渲染路径 :7268-7269 调用同一个绑定）' : '⚠ vendored vendor/hlsl2glsl/（MPW_H2G_IMPL=vendor：只为复核 P-114 取舍，不是渲染路径在跑的）'))
console.log('  语料根   : ' + SCENE_ROOT)
console.log('  取样包   : ' + picked.length + '/' + cands.length + '（' + pkgReport.map((r) => r.id + '@' + r.mb + 'MB').join(', ') + '）')
console.log('  去重文件 : ' + files.length + '（frag ' + rows.filter((r) => r.stage === 'frag').length + ' / vert ' + rows.filter((r) => r.stage === 'vert').length + '）' + (isDocCorpus ? '' : '  ⚠ 子集（文档口径 ' + DOC_TOTAL + '）'))
console.log('  校验器   : ' + (GLSLANG || '未安装 → 本次为**非严格口径**（产出 + 残留/括号检查）'))
console.log('  结果     : 通过 ' + passN + ' / 可疑 ' + suspect.length + ' / 抛错 ' + thrown.length + ' ⇒ ' + (ratio * 100).toFixed(1) + '%（文档基线 ' + (DOC_RATIO * 100).toFixed(1) + '%）')
if (suspect.length) for (const s of suspect.slice(0, 10)) console.log('    · 可疑 ' + s.stage + ' ' + s.name + '：' + s.reason)
if (thrown.length) for (const s of thrown.slice(0, 10)) console.log('    · 抛错 ' + s.stage + ' ' + s.name + '：' + s.reason)

check('语料规模达到可判定下限（≥20 去重文件）', files.length >= 20, String(files.length))
check('0 个抛错（文档基线 0）', thrown.length === 0, thrown.map((t) => t.name).join(','))
check('覆盖率 ≥ ' + (floor * 100).toFixed(1) + '%' + (isDocCorpus ? '（文档口径全量）' : '（子集回归下限）'), ratio >= floor, (ratio * 100).toFixed(1) + '% = ' + passN + '/' + rows.length)
check('include 解析器非空（仓库自研 common*.h 在位）', HEADERS.size > 0, [...HEADERS.keys()].join(' '))
check('每个"可疑"都带得出原因（不是静默降级）', suspect.every((s) => !!s.reason))

// ── ①(P-114) 接线身份：本门禁守的必须是**渲染路径在跑的那份实现** ──
// 三条断言合起来的效果：谁把渲染路径换成 vendored 那份（= 反转 P-114 的决定）⇒ 这里变红。
console.log('\n①(P-114) 接线身份（门禁守的是哪份实现）')
const BUNDLE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const bundleSrc = fs.readFileSync(BUNDLE, 'utf8')
const renderCallFrag = "hlsl2glsl(src.frag, 'frag', effectiveCombos, resolver)"
const renderCallVert = "hlsl2glsl(src.vert, 'vert', effectiveCombos, resolver)"
check('被测实现 = bundle 导出的 `hlsl2glsl`（同一模块内绑定；IMPL=' + IMPL_NAME + '）',
  IMPL_NAME !== 'wired' || WIRED_LIB.hlsl2glsl === hlsl2glsl,
  IMPL_NAME !== 'wired' ? 'MPW_H2G_IMPL=vendor ⇒ 本条按设计跳过' : (typeof hlsl2glsl === 'function' ? 'arity=' + hlsl2glsl.length : 'not a function'))
check('bundle 源码 0 处引用 vendor/hlsl2glsl（渲染路径没接 vendored 那份）',
  !/vendor\/hlsl2glsl/.test(bundleSrc), String((bundleSrc.match(/vendor\/hlsl2glsl/g) || []).length) + ' 处')
check('渲染路径调用点在位（core/we-scene-bundle.js 的 getEffectProgram）',
  bundleSrc.includes(renderCallFrag) && bundleSrc.includes(renderCallVert),
  renderCallFrag + ' / ' + renderCallVert)
console.log('  · vendored 那份收第 5 参 siblingSrc：' + (VENDORED.length >= 5) + '；被测实现收：' + WIRED_TAKES_SIBLING +
  (WIRED_TAKES_SIBLING ? '' : '（自研实现不合并跨 stage 的 [COMBO] 默认值，靠 `:4334/:4358` 的自有修复过语料）'))

// ── ①(P-114) A/B 对照：**为什么没把 vendored 接进去**（可复核的取舍证据）──
let cmp = null
if (COMPARE) {
  const wiredOnly = rows.filter((r) => r.verdict === 'pass' && r.v.verdict !== 'pass')
  const vendoredOnly = rows.filter((r) => r.verdict !== 'pass' && r.v.verdict === 'pass')
  cmp = { wiredPass: passN, vendoredPass: rows.filter((r) => r.v.verdict === 'pass').length, files: rows.length,
    wiredOnly: wiredOnly.map((r) => r.stage + ' ' + r.name), vendoredOnly: vendoredOnly.map((r) => r.stage + ' ' + r.name) }
  console.log('\n①(P-114) A/B 对照（同语料同口径，' + (GLSLANG ? '严格：glslangValidator 真编译' : '非严格：无 glslang') + '）')
  console.log('  · 被测实现(在跑) : ' + cmp.wiredPass + '/' + rows.length + ' = ' + (cmp.wiredPass / rows.length * 100).toFixed(1) + '%')
  console.log('  · vendored(未接) : ' + cmp.vendoredPass + '/' + rows.length + ' = ' + (cmp.vendoredPass / rows.length * 100).toFixed(1) + '%')
  console.log('  · 只有被测实现过 : ' + (wiredOnly.length ? wiredOnly.map((r) => r.stage + ' ' + r.name).join(', ') : '（无）'))
  console.log('  · 只有 vendored 过: ' + (vendoredOnly.length ? vendoredOnly.map((r) => r.stage + ' ' + r.name).join(', ') : '（无）'))
  check('vendored 不存在"被测实现编不过而它编得过"的文件（⇒ 换成 vendored 不会提升本语料覆盖率）',
    vendoredOnly.length === 0, vendoredOnly.map((r) => r.stage + ' ' + r.name).join(','))
  check('被测实现覆盖率 ≥ vendored（P-114：门禁守的必须是至少不更差的那份）',
    cmp.wiredPass >= cmp.vendoredPass, cmp.wiredPass + ' vs ' + cmp.vendoredPass)
  console.log('  · 取舍证据（只有被测实现过）: ' + wiredOnly.length + ' 个' + (wiredOnly.length ? '' : '（本机语料上两份持平 —— **不是**红，只说明证据随语料变）'))
}

if (JSON_OUT) console.log(JSON.stringify({ impl: IMPL_NAME, sceneRoot: SCENE_ROOT, pkgs: pkgReport, files: files.length, docTotal: DOC_TOTAL, strict: !!GLSLANG, pass: passN, suspect: suspect.length, throw: thrown.length, ratio, floor, wiring: { bundleRefsVendor: (bundleSrc.match(/vendor\/hlsl2glsl/g) || []).length, wiredTakesSibling: WIRED_TAKES_SIBLING }, compare: cmp, ok: failN === 0 }))
console.log('\n' + '─'.repeat(72))
if (failN) { console.log('✗ hlsl2glsl 覆盖率回归：' + failN + ' 条断言失败\n  - ' + fails.join('\n  - ')); process.exit(1) }
console.log('✓ hlsl2glsl 覆盖率回归通过（' + passN + '/' + rows.length + ' = ' + (ratio * 100).toFixed(1) + '%；文档基线 ' + (DOC_RATIO * 100).toFixed(1) + '%）')

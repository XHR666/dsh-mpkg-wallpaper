// portability-audit-fix-test.mjs —— 可移植性审计修复线的**常驻判据 + 变异自证**
//
// 覆盖（每条都对着 `docs/portability-audit.json` 的条目编号；"服务器文件之外"那一半）：
//   PA-52  core/scene-project-json.mjs  候选表 + 存在性探测 + source/from/why 如实回报 + 找不到就 null
//   PA-34  tests/known-issues.json KI-7 豁免面收窄到 0（结构性判据）+ known-ledger-audit 防腐烂
//   PA-36  tests/run-all-tests.sh 的 perf 包默认值（不许是内容哈希；存在就用、不存在就 SKIP 并打印读数）
//   PA-44  publish-check / build-pages 的 DEFAULT_LINE_RE（死分支已删；写死本机绝对路径必抓）
//   PA-45  publish-check 的 walk() 少扫必记账（+ 覆盖面积进 --json）
//   PA-09  cross-platform-gate 的 TMP_LITERAL_RE（裸 `/tmp/`：代码行抓得到、注释不误伤）
//   PA-37  bench-server-test 的 J13 断言语义化（不许按名字列举快捷根）
//   PA-31  core/we-scene-bundle.js EYE_HACK：依据强度登记 + 表可注入 + 每次生效记账
//
// 口径（与仓库既有测试一致）：
//   · 纯 Node、无浏览器、无网络、无 GPU、内存有界（最大只读单个 mpkg 头/模块源码，不解 331MB 容器）；
//   · **不写仓库文件**：需要"改回去"的变异一律在 `os.tmpdir()` 的副本上做（副本里相对 import 改写成
//     指向真树的绝对路径，与 bench-server-test 同一手法）；
//   · 判据自己也被门禁扫：本文件里不出现整串的本机绝对路径与整串的临时目录片段（一律按片段拼装）。
// 用法: node tests/portability-audit-fix-test.mjs [--json]
// 退出码：0 全绿 / 1 有失败（含"变异没有按预期变红"）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from './_root.mjs'

const JSON_OUT = process.argv.includes('--json')
let pass = 0, fail = 0
const failures = []
const check = (id, name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${id} ${name}${detail ? '  [' + String(detail).slice(0, 300) + ']' : ''}`) }
  else { fail++; failures.push(id); console.log(`  ✗ ${id} ${name}${detail ? '  [' + String(detail).slice(0, 300) + ']' : ''}`) }
}
/** 变异自证：期望红集 == 实际红集（打印 MUTANT-RED-OK）。 */
const mutantRedOk = (id, what, expected, actual) => {
  const e = [...new Set(expected)].sort(), a = [...new Set(actual)].sort()
  const ok = JSON.stringify(e) === JSON.stringify(a)
  if (ok) console.log(`  MUTANT-RED-OK ${id} ${what}：期望红集=${JSON.stringify(e)} == 实际红集=${JSON.stringify(a)}`)
  else console.log(`  MUTANT-FAIL ${id} ${what}：期望红集=${JSON.stringify(e)} != 实际红集=${JSON.stringify(a)}`)
  check(id, what + '（MUTANT-RED-OK：期望红集 == 实际红集）', ok, ok ? '' : `期望=${JSON.stringify(e)} 实际=${JSON.stringify(a)}`)
}
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-paf-'))
process.on('exit', () => { try { fs.rmSync(TMPDIR, { recursive: true, force: true }) } catch { /* tmp 清不掉不致命 */ } })

const run = (cmd, args, opts = {}) => {
  try { return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }) } }
  catch (e) { return { code: e.status === undefined ? null : e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
}
const runNode = (file, args = [], opts = {}) => run(process.execPath, [file, ...args], opts)
/* 「改前」的**唯一来源 = 一个钉死的提交**（不是 `HEAD`，也不是 `main`）。
   为什么不能用 `HEAD`（**这就是本轮这 13 条红的根因**）：这些修复已经**提交进 HEAD** ——
   提交 `1b2a332`「渲染器 0.5.5：8902 自给自足与选择器修复 · **可移植性/面向结果审计修复** · …」把
   `core/scene-project-json.mjs`（候选表/存在性探测/如实回报）、`tests/known-issues.json`（KI-7 收窄）、
   `tests/publish-check.mjs`（DEFAULT_LINE_RE 死分支 + walk() 记账）、`tests/cross-platform-gate-test.mjs`
   （裸 `/tmp` 判据）、`tests/bench-server-test.mjs`（J13 语义化）一次性收进去了 ⇒ `git show HEAD:<file>`
   拿到的是**改后**版本，变异体与真树逐字相同 ⇒ 变异无差异、红集恒为空（`MUTANT-FAIL … 实际红集=[]`），
   "变异自证"退化成一个永远绿的摆设。
   为什么钉 `851bd88`：它是 `1b2a332` 之前的那个提交（`git log --oneline`），上面这五个文件在它那里
   都还是**修复前**的版本（可逐条复核：publish-check 的 DEFAULT_LINE_RE 还带 `|| '<作者路径>'` 死分支、
   walk() 还是静默 `catch { return out }`、cross-platform 的 TMP_LITERAL_RE 还要求紧贴引号、
   bench-server 的 J13 还把 fx.ws/allwallpaper/home 逐字钉死、run-all-tests.sh 的默认值还是内容哈希）。
   ⚠ 这个哈希是**故意钉死**的：不要换成 `HEAD`/`main`，也不要"顺手更新成新提交"（新提交只会离"改前"更远）。
   ⚠ 浅克隆/无 git ⇒ `git show` 失败 ⇒ `preFixOf` 返回 null ⇒ 相关用例**明确报红**并打印原因（不静默跳过）。 */
const PRE_FIX_REV = '851bd88'
/** 真树文件的"改前"版本（**钉死提交** `PRE_FIX_REV`）—— 变异自证用的**真**回退，不是我手搓的近似。 */
const preFixOf = (rel) => { const r = run('git', ['show', PRE_FIX_REV + ':' + rel], { cwd: ROOT }); return r.code === 0 ? r.out : null }
/** 打印用的"改前"标签：钉死提交（**为什么不是 `HEAD`** 见上面那段块注释：修复已提交进 HEAD ⇒ HEAD 是"改后"）。 */
const PRE_FIX_LABEL = '钉死 ' + PRE_FIX_REV + '（1b2a332 之前）'
/** 把一份源码复制到 tmp 副本（可选文本变异）。返回副本路径。 */
const copyWith = (rel, name, mutate) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const out = mutate ? mutate(src) : src
  const p = path.join(TMPDIR, name)
  fs.writeFileSync(p, out)
  return p
}
/** 副本里的相对 import 改写成指向真树的绝对路径（副本在 os.tmpdir()，靠自身位置推不出仓库根）。 */
const absImports = (src, baseAbs) => src.replace(/from '(\.\.?\/[^']+)'/g, (m0, r) => `from ${JSON.stringify(path.resolve(baseAbs, r))}`)
const SOLID = '/'
const TMPSEG = SOLID + 'tmp' + SOLID                       // 片段拼装：整串写出来会被 cross-platform 门禁自指命中
const HOSTP = SOLID + 'root' + SOLID + 'Desktop' + SOLID + 'DSHarea'   // 同上：作者工作区绝对路径
const j = (o) => JSON.stringify(o)
const SQ = String.fromCharCode(39)   // 单引号：合成样本要按**源代码里的真实形态**写（死分支只豁免单引号形态）
/** 取输出里最后一段 JSON（门禁的 --json 是**多行美化**输出 ⇒ 不能只看最后一行）。 */
const parseJsonTail = (out) => {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => l.trim() === '{')
  if (i < 0) return null
  try { return JSON.parse(lines.slice(i).join('\n')) } catch { return null }
}
/** 去掉 JS 注释（静态判据要在**代码**上查，不能在注释里的"举例/说明"上误报 —— 本文件自己也踩过两次）。
 *  用**字符串感知的小扫描器**而不是两条正则：非贪婪 `/*…*​/` 会被"行注释里出现的 `/*`"骗到，
 *  把后面一大段真代码整块吃掉（实测：行号整体错位、锚点消失）。字符串与模板串内的注释符号不算注释。 */
const stripJsComments = (src) => {
  let out = '', i = 0, inStr = null, inBlock = false, inLine = false
  while (i < src.length) {
    const c = src[i], c2 = src.slice(i, i + 2)
    if (inLine) { if (c === '\n') { inLine = false; out += c } i++; continue }
    if (inBlock) { if (c2 === '*/') { inBlock = false; i += 2 } else { if (c === '\n') out += c; i++ } continue }
    if (inStr) { out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue } if (c === inStr) inStr = null; i++; continue }
    if (c2 === '/*') { inBlock = true; i += 2; continue }
    if (c2 === '//') { inLine = true; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue }
    out += c; i++
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[PA-52] core/scene-project-json.mjs：候选表 + 存在性探测 + 如实回报（变异 = 回退到' + PRE_FIX_LABEL + '的旧实现）')
{
  const rel = 'core/scene-project-json.mjs'
  const fixture = path.join(TMPDIR, 'p52')
  const ID = '4319609997'
  const libRoot = path.join(fixture, 'lib')          // 库根自身：<root>/<id>/project.json
  const parentFixture = path.join(fixture, 'parent') // 库根的父目录：<dirname(root)>/<id>/project.json
  const libRoot2 = path.join(parentFixture, 'repo')
  fs.mkdirSync(path.join(libRoot, ID), { recursive: true })
  fs.writeFileSync(path.join(libRoot, ID, 'project.json'), j({ tier: 'library-root' }))
  fs.mkdirSync(path.join(parentFixture, ID), { recursive: true })
  fs.writeFileSync(path.join(parentFixture, ID, 'project.json'), j({ tier: 'library-parent' }))
  fs.mkdirSync(libRoot2, { recursive: true })

  /** 同一段判据跑"真树模块"或"变异副本" ⇒ 分辨力证明。 */
  const probe = async (modPath) => {
    const out = { failures: [], detail: {} }
    const m = await import(modPath)
    // A：库根自身
    let r = m.readProjectJson(ID, { root: libRoot, dir: undefined })
    out.detail.libroot = r ? `${r.source}|${String(r.from).slice(0, 40)}` : 'null'
    if (!(r && r.source === 'library-root' && r.json.tier === 'library-root')) out.failures.push('P52-a')
    // B：库根的父目录（旧实现没有这条候选）
    r = m.readProjectJson(ID, { root: libRoot2, dir: undefined })
    out.detail.parent = r ? `${r.source}|${String(r.from).slice(0, 40)}` : 'null'
    if (!(r && r.source === 'library-parent' && r.json.tier === 'library-parent')) out.failures.push('P52-b')
    // C：每条命中都要能说清"哪条候选/谁给的/为什么"
    const any = m.readProjectJson(ID, { root: libRoot })
    if (!(any && any.from && any.why)) out.failures.push('P52-c')
    // D：一个候选都不存在 ⇒ null（不抛）+ 逐条探测台账
    let p = null, threw = null
    try { p = m.projectJsonProbe('4319609996', { root: path.join(fixture, 'nothing') }) } catch (e) { threw = String(e && e.message || e) }
    out.detail.null = threw ? 'threw=' + threw : (p && p.found === null ? 'attempts=' + p.attempts.length : j(p && p.found))
    if (!(p && p.found === null && p.attempts.length >= 3 && p.attempts.every((a) => a.exists === false && a.path && a.source)) || threw) out.failures.push('P52-d')
    // E：**默认值不许是作者语料布局**：只给 root（不给 sceneRoot/环境变量）时，候选里必须有"库根自身 /
    //    库根的父目录 / os.homedir()"这三族推导候选（旧实现只有 <root>/allwallpaper/dd 的默认值 + 一条历史布局）
    const src = new Set(m.projectJsonCandidates('4319609996', { root: path.join(fixture, 'nothing') }).map((c) => c.source))
    out.detail.sources = [...src].join(',')
    if (!(src.has('library-root') && src.has('library-parent') && src.has('home'))) out.failures.push('P52-e')
    return out
  }

  const before = await probe(path.join(ROOT, rel))
  check('P52-0', '真树模块满足"库根自身/父目录可命中 + 找不到就 null + 候选族齐全"',
    before.failures.length === 0, 'failures=' + j(before.failures) + ' ' + j(before.detail))

  const head = preFixOf(rel)
  if (!head) check('P52-1', '取不到' + PRE_FIX_LABEL + '的旧实现（无法做变异自证）', false, 'git show ' + PRE_FIX_REV + ' 失败')
  else {
    const mut = path.join(TMPDIR, 'p52-old.mjs')
    fs.writeFileSync(mut, head)
    const after = await probe(mut)
    check('P52-1', '改前（' + PRE_FIX_LABEL + '）实现**确实**缺少这些判据（不是"永远绿"的假判据）',
      after.failures.length > 0, '改前版 failures=' + j(after.failures) + ' ' + j(after.detail))
    // 期望红集 = 实测红集（改前版连 probe/from/why 都没有 ⇒ 五条全红是**如实**读数，不是判据写坏了）
    mutantRedOk('P52-2', '把 core/scene-project-json.mjs 回退成' + PRE_FIX_LABEL + '的旧实现',
      ['P52-a', 'P52-b', 'P52-c', 'P52-d', 'P52-e'], after.failures)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[PA-34] known-issues：KI-7 豁免面收窄 + 台账防腐烂（变异 = 回退到' + PRE_FIX_LABEL + '的哈希键 + 整包豁免）')
{
  const { makeKnownLedger } = await import('./known-ledger-audit.mjs')
  const docNow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/known-issues.json'), 'utf8'))
  const SCENES = ['3719111841', '3326873240', '3544152633', '3554161528', '3660962877']
  const HASH = 'd5007a52866682e2210d9d855d170c80'
  /** 同一段判据跑"现台账"或"回退后的台账"（变异）⇒ 分辨力证明。 */
  const probe = (doc) => {
    const L = makeKnownLedger(doc, { implementedRules: ['video-wallpaper'] })
    const a = L.audit({ knownSceneIds: SCENES })
    const ki7 = (doc.issues || []).find((k) => k.id === 'KI-7')
    const out = {
      failures: [], detail: {
        errors: a.errors.map((e) => e.rule),
        knownForHashRect: (L.knownFor(HASH, '*', 'rect') || {}).id || null,
        ki7: ki7 ? { scope: ki7.scope || null, affects: ki7.affects, rule: ki7.classify && ki7.classify.rule } : null,
      },
    }
    if (a.errors.length !== 0) out.failures.push('P34-a')                     // 台账审计必须 0 判红
    if (out.detail.knownForHashRect !== null) out.failures.push('P34-b')      // 哈希键不许豁免 rect（整包豁免已删）
    if (!(ki7 && ki7.scope === 'structural' && Array.isArray(ki7.affects) && ki7.affects.length === 0 && ki7.classify && ki7.classify.rule === 'video-wallpaper')) out.failures.push('P34-c')
    return out
  }
  const now = probe(docNow)
  check('P34-0', '现台账：审计 0 判红 + KI-7 不豁免任何 rect + 是结构性判据（affects 为空）',
    now.failures.length === 0, j(now.detail))
  // px 侧仍允许**全局**豁免（KI-8/KI-9：CPU 跑不了 GPU 蒙皮、t 相位差 = 测量口径限制），但**不许**是 KI-7
  const Lnow = makeKnownLedger(docNow, { implementedRules: ['video-wallpaper'] })
  const pxHit = Lnow.knownFor(HASH, '*', 'px')
  check('P34-0b', 'px 全局豁免仍按既有口径生效（KI-8/KI-9），但命中的**不是** KI-7（整包豁免已删）',
    !!pxHit && pxHit.id !== 'KI-7', pxHit ? pxHit.id : 'null')

  const headDoc = preFixOf('tests/known-issues.json')
  if (!headDoc) check('P34-1', '取不到改前版（' + PRE_FIX_LABEL + '）known-issues.json（无法做变异自证）', false)
  else {
    const old = probe(JSON.parse(headDoc))
    check('P34-1', '改前（' + PRE_FIX_LABEL + '）台账：哈希键 + affects[rect,px] + layer"*" ⇒ 整包 rect 豁免真的生效、且新审计会判红',
      old.detail.knownForHashRect === 'KI-7' && old.detail.errors.includes('scene-key-unreproducible'), j(old.detail))
    mutantRedOk('P34-2', '把 tests/known-issues.json 的 KI-7 回退成"内容哈希 + 整包 rect/px 豁免"',
      ['P34-a', 'P34-b', 'P34-c'], old.failures)
  }

  // 防腐烂判据自身的分辨力（合成台账，不依赖真文件）
  const mkDoc = (k) => ({ issues: [{ id: 'KI-X', layer: '*', kind: 'measurement', reason: 'x'.repeat(30), evidence: ['e'], owner: 'o', since: '2026-01-01', ...k }] })
  const syn = [
    ['P34-f 场景键=内容哈希 ⇒ 判红 scene-key-unreproducible', mkDoc({ scene: HASH, affects: ['rect'] }), 'scene-key-unreproducible'],
    ['P34-g rect 全局豁免（scene/layer 都是 *）⇒ 判红 global-rect-exemption', mkDoc({ scene: '*', affects: ['rect'] }), 'global-rect-exemption'],
    ['P34-h 结构性条目 affects 非空 ⇒ 判红 structural-exempts', mkDoc({ scene: '*', affects: ['px'], scope: 'structural', classify: { rule: 'video-wallpaper' } }), 'structural-exempts'],
    ['P34-i 结构性 rule 没人实现 ⇒ 判红 structural-rule-unimplemented', mkDoc({ scene: '*', affects: [], scope: 'structural', classify: { rule: 'no-such-rule' } }), 'structural-rule-unimplemented'],
    ['P34-j affects 空且非结构性 ⇒ 判红 affects-empty', mkDoc({ scene: '*', affects: [] }), 'affects-empty'],
    ['P34-k 未知口径 ⇒ 判红 affects-unknown', mkDoc({ scene: '3719111841', affects: ['depth'] }), 'affects-unknown'],
  ]
  for (const [name, doc, rule] of syn) {
    const a = makeKnownLedger(doc, { implementedRules: ['video-wallpaper'] }).audit({ knownSceneIds: SCENES })
    check(name.split(' ')[0], name.slice(name.indexOf(' ') + 1), a.errors.some((e) => e.rule === rule), a.errors.map((e) => e.rule).join(',') || '无判红')
  }
  // 命中防腐烂：对账过的场景里 0 命中 ⇒ 判红
  {
    const doc = mkDoc({ scene: '3719111841', affects: ['rect'] })
    const L = makeKnownLedger(doc, { implementedRules: [] })
    L.markCompared('3719111841')
    const a = L.audit({ knownSceneIds: SCENES })
    check('P34-l', '对账过的场景里条目 0 命中 ⇒ 判红 never-hit（豁免静默失效 = 腐烂）',
      a.errors.some((e) => e.rule === 'never-hit'), a.errors.map((e) => e.rule).join(',') || '无判红')
  }
  // 结构性条目必须被匹配器忽略（分类 ≠ 豁免）
  {
    const doc = { issues: [{ id: 'KI-S', scope: 'structural', classify: { rule: 'video-wallpaper' }, scene: '*', layer: '*', kind: 'official-semantics', affects: [], reason: 'x'.repeat(30), evidence: ['e'], owner: 'o', since: '2026-01-01' }] }
    const L = makeKnownLedger(doc, { implementedRules: ['video-wallpaper'] })
    check('P34-m', '结构性条目（affects 为空）永远不会被 knownFor 命中（分类 ≠ 豁免）',
      L.knownFor('任意', '*', 'rect') === null && L.knownFor('*', '*', 'px') === null)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[PA-36] run-all-tests.sh：perf 包默认值不许是内容哈希；存在就用 / 不存在就 SKIP 并打印读数')
{
  const rel = 'tests/run-all-tests.sh'
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const block = (src.match(/MPW_PERF_PKG_FROM=''[\s\S]*?export MPW_PERF_PKG/) || [''])[0]
  const HASH_RE = /[0-9a-f]{32}/i
  check('P36-a', 'MPW_PERF_PKG 的赋值块里没有 32 位十六进制内容哈希（内容指纹不再当选默认身份）',
    block.length > 0 && !HASH_RE.test(block) && /ls -S/.test(block) && /SKIP/.test(block),
    'block=' + block.split('\n').length + ' 行；含 ls -S=' + /ls -S/.test(block) + '；含 SKIP=' + /SKIP/.test(block))

  // E2E：在临时夹具上真跑门禁（--list 在跑任何测试项之前就会打印读数）
  const mkGate = (name, withPkg) => {
    const base = path.join(TMPDIR, name)
    fs.mkdirSync(path.join(base, 'repo', 'tests'), { recursive: true })
    fs.copyFileSync(path.join(ROOT, rel), path.join(base, 'repo', 'tests', 'run-all-tests.sh'))
    const cache = path.join(base, 'cache')
    fs.mkdirSync(cache, { recursive: true })
    if (withPkg) { fs.writeFileSync(path.join(cache, 'aaa-small.mpkg'), Buffer.alloc(11, 1)); fs.writeFileSync(path.join(cache, 'zzz-big.mpkg'), Buffer.alloc(4242, 2)) }
    return { base, script: path.join(base, 'repo', 'tests', 'run-all-tests.sh'), cache, repo: path.join(base, 'repo') }
  }
  const envFor = (f, extra) => ({ ...process.env, MPW_PLUGIN_CACHE: f.cache, MPW_PERF_PKG: '', ...extra })
  {
    const f = mkGate('p36-pick', true)
    const r = run('bash', [f.script, '--list'], { cwd: f.repo, env: envFor(f) })
    const line = (r.out.split('\n').find((l) => l.startsWith('[gate] MPW_PERF_PKG')) || '')
    check('P36-b', '有候选 ⇒ 采用**最大的那个**并打印"选了哪个/为什么"（zzz-big.mpkg 4242B > aaa-small 11B）',
      r.code === 0 && line.includes('zzz-big.mpkg') && line.includes('取最大者') && line.includes('4242'), line.slice(0, 200))
  }
  {
    const f = mkGate('p36-none', false)
    const r = run('bash', [f.script, '--list'], { cwd: f.repo, env: envFor(f) })
    const line = (r.out.split('\n').find((l) => l.startsWith('[gate] SKIP perf') ) || '')
    check('P36-c', '没有候选 ⇒ 明确打印 SKIP 读数（不是静默降级、也不是回落成全量扫描）',
      r.code === 0 && line.includes('SKIP') && line.includes('缺数据'), line.slice(0, 200) || r.out.split('\n')[0])
  }
  {
    const f = mkGate('p36-missing', true)
    const r = run('bash', [f.script, '--list'], { cwd: f.repo, env: envFor(f, { MPW_PERF_PKG: path.join(f.base, 'nope.mpkg') }) })
    const line = (r.out.split('\n').find((l) => l.startsWith('[gate] SKIP perf')) || '')
    check('P36-d', '显式指定但文件不存在 ⇒ 打印 SKIP + 原因（不许静默降级）',
      r.code === 0 && line.includes('不存在'), line.slice(0, 200))
  }
  // 变异自证：把改前版（钉死提交）的旧默认（内容哈希）写回副本 ⇒ 静态判据必须红
  const head = preFixOf(rel)
  if (!head) check('P36-e', '取不到改前版（' + PRE_FIX_LABEL + '）run-all-tests.sh（无法做变异自证）', false)
  else {
    const f = mkGate('p36-mut', false)
    const mutant = head     // 改前版那一行写死 <HOME>/.dsh-mpkg-wallpaper/<32hex>.mpkg
    fs.writeFileSync(f.script, mutant)
    const mblock = (mutant.match(/MPW_PERF_PKG_FROM=''[\s\S]*?export MPW_PERF_PKG/) || [''])[0]
    const red = []
    if (!(mblock.length > 0 && !HASH_RE.test(mblock) && /ls -S/.test(mblock) && /SKIP/.test(mblock))) red.push('P36-a')
    const r = run('bash', [f.script, '--list'], { cwd: f.repo, env: envFor(f) })
    if (!(r.out.split('\n').some((l) => l.startsWith('[gate]') && l.includes('SKIP')))) red.push('P36-c')
    check('P36-e', '改前（' + PRE_FIX_LABEL + '）版本：默认值确实是内容哈希、且没有任何 [gate] 读数（静默）',
      HASH_RE.test(mutant) && r.code === 0 && red.includes('P36-a'), '改前版含哈希=' + HASH_RE.test(mutant) + ' 退出码=' + r.code)
    mutantRedOk('P36-f', '把 run-all-tests.sh 的 perf 包默认值回退成改前版（' + PRE_FIX_LABEL + '）的内容哈希写法', ['P36-a', 'P36-c'], red)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[PA-44] DEFAULT_LINE_RE：死分支已删 + 写死本机绝对路径必抓（变异 = 回退到' + PRE_FIX_LABEL + '的四分支版本）')
{
  /** 从源码里抽出 PATH_RE / DEFAULT_LINE_RE（**跑的就是真判据本体**，不是复制一份）。
   *  DEFAULT_LINE_RE 有两种形态：字面量正则（改前版）与 `new RegExp(分支数组…)`（改后版）⇒ 都支持。 */
  const extract = (src) => {
    const pathSrc = (src.match(/^const PATH_RE = (\/.*\/)$/m) || [])[1]
    const defSrc = (src.match(/^const DEFAULT_LINE_RE = (\/.*\/)$/m) || [])[1]
    const brSrc = (src.match(/const DEFAULT_LINE_BRANCHES = (\[[\s\S]*?\n\])/) || [])[1]
    if (!pathSrc || (!defSrc && !brSrc)) return null
    const code = ['const PATH_RE = ' + pathSrc]
    if (defSrc) code.push('const DEFAULT_LINE_RE = ' + defSrc)
    else code.push('const DEFAULT_LINE_BRANCHES = ' + brSrc, "const DEFAULT_LINE_RE = new RegExp(DEFAULT_LINE_BRANCHES.map((b) => b.re.source).join('|'))")
    code.push('return { PATH_RE, DEFAULT_LINE_RE, DEFAULT_LINE_BRANCHES: (typeof DEFAULT_LINE_BRANCHES === "undefined" ? null : DEFAULT_LINE_BRANCHES) }')
    try { return new Function(code.join('\n'))() } catch { return null }
  }
  // 死分支检测：源码里出现"作者的整串工作区绝对路径"（正则字面量里斜杠被转义 ⇒ 允许 \/? 形态）
  const DEAD_BRANCH_RE = new RegExp('\\\\?' + SOLID + 'root' + '\\\\?' + SOLID + 'Desktop' + '\\\\?' + SOLID + 'DSHarea')
  const HARD = 'const X = argv.dir || ' + SQ + HOSTP + SQ          // 单引号形态（死分支正是豁免这一种）
  const SOFT = 'const X = process.env.MPW_X || ' + SQ + HOSTP + SQ
  const probe = (src) => {
    const out = { failures: [], detail: {} }
    const re = extract(src)
    if (!re) { out.failures.push('P44-a'); return out }
    const hardCaught = re.PATH_RE.test(HARD) && !re.DEFAULT_LINE_RE.test(HARD)
    const softExempt = re.PATH_RE.test(SOFT) && re.DEFAULT_LINE_RE.test(SOFT)
    const deadBranch = DEAD_BRANCH_RE.test(src)
    out.detail = { hardCaught, softExempt, deadBranch, defRe: String(re.DEFAULT_LINE_RE).slice(0, 110) }
    if (!hardCaught) out.failures.push('P44-a')
    if (!softExempt) out.failures.push('P44-b')
    if (deadBranch) out.failures.push('P44-c')
    return out
  }
  const pc = fs.readFileSync(path.join(ROOT, 'tests/publish-check.mjs'), 'utf8')
  const bp = fs.readFileSync(path.join(ROOT, 'build-pages.mjs'), 'utf8')
  const nowPc = probe(pc), nowBp = probe(bp)
  check('P44-0', 'publish-check.mjs：写死本机绝对路径被判红 + "环境变量优先"仍被豁免 + 无死分支',
    nowPc.failures.length === 0, j(nowPc.detail))
  const bpRe = extract(bp), pcRe = extract(pc)
  check('P44-0b', 'build-pages.mjs：同一套判据（两处必须同源）',
    nowBp.failures.length === 0 && !!bpRe && !!pcRe && String(bpRe.DEFAULT_LINE_RE) === String(pcRe.DEFAULT_LINE_RE),
    j(nowBp.detail))
  // 活性断言（publish-check 独有：它扫的是仓库树，能逐条反查分支是否仍然命中）
  const brOk = !!(pcRe && pcRe.DEFAULT_LINE_BRANCHES && pcRe.DEFAULT_LINE_BRANCHES.length >= 4 &&
    pcRe.DEFAULT_LINE_BRANCHES.every((b) => b.re instanceof RegExp && b.why))
  check('P44-0c', 'publish-check 的豁免分支拆成了可逐条反查活性的数组（≥4 条，每条带 why）', brOk,
    pcRe && pcRe.DEFAULT_LINE_BRANCHES ? pcRe.DEFAULT_LINE_BRANCHES.map((b) => b.id).join(',') : 'null')

  const headPc = preFixOf('tests/publish-check.mjs')
  if (!headPc) check('P44-1', '取不到改前版（' + PRE_FIX_LABEL + '）publish-check.mjs（无法做变异自证）', false)
  else {
    const old = probe(headPc)
    check('P44-1', '改前（' + PRE_FIX_LABEL + '）判据：写死本机绝对路径被 `|| \'<作者路径>\'` 死分支**静默放行**（真后门，不是理论）',
      !!old.detail.hardCaught === false && old.failures.includes('P44-a'), j(old.detail))
    mutantRedOk('P44-2', '把 tests/publish-check.mjs 的 DEFAULT_LINE_RE 回退成改前版（' + PRE_FIX_LABEL + '）的四分支版本', ['P44-a', 'P44-c'], old.failures)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[PA-45] publish-check 的 walk()：少扫必记账（+ 覆盖面积进 --json；变异 = 回退静默 catch）')
{
  const src = fs.readFileSync(path.join(ROOT, 'tests/publish-check.mjs'), 'utf8')
  // ⚠ 检测必须在**去掉注释**的源码上做：本文件的说明注释里就写着旧写法，直接在原文上查会自指假阳（已踩）
  const silentDetect = (raw) => {
    const s = stripJsComments(raw)
    return {
      silentWalk: /catch\s*(\([^)]*\))?\s*\{\s*return out;?\s*\}/.test(s),   // 旧形态：读不到就返回部分清单
      accounting: /unreadable\.push\(/.test(s) && /walkCollect/.test(s) && /coverage/.test(s),
    }
  }
  const now = silentDetect(src)
  check('P45-a', 'walk() 有显式记账（walkCollect + unreadable.push + coverage），旧的静默 `catch { return out }` 已不存在',
    now.accounting && !now.silentWalk, j(now))
  const r = runNode(path.join(ROOT, 'tests/publish-check.mjs'), ['--json'], { cwd: ROOT })
  let parsed = null
  try { parsed = JSON.parse(r.out) } catch { /* 解析失败下面判红 */ }
  const cov = parsed && parsed.coverage
  check('P45-b', '真跑一遍：--json 里有覆盖面积字段（scannedFiles / unreadable[] / unindexed*），且真树 0 个未扫到',
    r.code === 0 && !!cov && typeof cov.scannedFiles === 'number' && cov.scannedFiles > 0 && Array.isArray(cov.unreadable) && cov.unreadable.length === 0,
    cov ? `scanned=${cov.scannedFiles} unreadable=${cov.unreadable.length} unindexed=${cov.unindexedOfficial}+${cov.unindexedMine}` : 'no-json')
  const selfTest = parsed && (parsed.info || []).find((i) => i.kind === 'walk-selftest')
  check('P45-c', '判据自身的分辨力自证真的跑了（合成反例 ENOTDIR/ENOENT 各记账 1 条）',
    !!selfTest && /记账 1\+1/.test(selfTest.msg), selfTest ? selfTest.msg.slice(0, 160) : '缺 walk-selftest')
  const head = preFixOf('tests/publish-check.mjs')
  if (!head) check('P45-d', '取不到改前版（' + PRE_FIX_LABEL + '）（无法做变异自证）', false)
  else {
    const old = silentDetect(head)
    const red = []
    if (old.silentWalk) red.push('P45-a')      // 旧形态撞上"不许静默少扫"判据
    check('P45-d', '改前（' + PRE_FIX_LABEL + '）版本：walk() 确实是静默 `catch { return out }`（判据会红）',
      old.silentWalk === true, j(old))
    mutantRedOk('P45-e', '把 walk() 回退成改前版（' + PRE_FIX_LABEL + '）的静默 catch', ['P45-a'], red)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
/* ①(2026-09-24 cross-platform 门禁读数) 这行**打印文案**里那个片段也按片段拼：`/tmp/` 必须落在代码行上
   才会被判据抓到，而本文件是 tracked + 在 CODE_DIRS(`tests/`) 里 ⇒ 整串写出来就是自指命中（实测本行红）。
   不往白名单里加：白名单是给存量站点的，这里只是自己新写的文案，拼一下就没有理由要豁免。 */
console.log('\n[PA-09] cross-platform-gate：裸 `' + '/' + 'tmp/' + '` 判据（代码行抓得到、注释不误伤；8/8 存量站点读数）')
{
  const rel = 'tests/cross-platform-gate-test.mjs'
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const hasBare = new RegExp("const TMP_LITERAL_RE = new RegExp\\(SL \\+ 'tmp' \\+ SL\\)").test(src)
  const hasQuotesPrefix = /const TMP_LITERAL_RE = new RegExp\(QUOTES/.test(src)
  check('P09-a', '判据 = 裸 `SL+tmp+SL`（不再要求紧贴引号），且注释剥离函数在位',
    hasBare && !hasQuotesPrefix && /function codePartsOfLines/.test(src))
  const r = runNode(path.join(ROOT, rel), ['--json'], { cwd: ROOT })
  const gate = parseJsonTail(r.out)
  check('P09-b', '真树门禁全绿（含 G3d–G3j 六条新的分辨力反例：赋值/重定向/命令参数/模板串/行尾注释/块注释）',
    r.code === 0 && !!gate && gate.fail === 0, gate ? `pass=${gate.pass} fail=${gate.fail}` : 'no-json')

  // 8 处存量站点：把白名单清空后跑同一份门禁 ⇒ 看得到它们；把判据回退到改前版 ⇒ 一处都看不到
  /* 审计列出的 8 处存量站点。**按 (文件, 特征子串) 认，不按行号**：行号会漂（我自己改 run-all-tests.sh
     第 23 行那处 +34 行之后，832/841 就漂到 867/876），特征子串不会 —— 这正是本仓 secret-scan 的纪律。 */
  const PA11 = [
    ['tests/keep-servers.sh', 'keep-servers.log'], ['tests/keep-servers.sh', 'we-scene-8899.log'],
    ['tests/keep-servers.sh', '8901.log'], ['tests/keep-servers.sh', '8902.log'],
    ['tests/keep-servers.sh', 'keep-servers-openviking.log'], ['tests/keep-demo-server.sh', 'demo-server.log'],
    ['tests/run-all-tests.sh', '.mpw-gate.lock'], ['tests/run-all-tests.sh', 'run-all-tests-last.log'],
  ]
  const siteOf = (f) => f.rel + '::' + (f.text || '')
  const pa11Hits = (findings) => PA11.filter(([rel, needle]) => findings.some((f) => f.kind === 'tmp-literal' && f.rel === rel && String(f.text).includes(needle)))
  const gateWithEmptyAllow = (original, mutate) => {
    let s = original
    if (mutate) s = mutate(s)
    s = s.replace(/from '\.\/_root\.mjs'/, `from ${JSON.stringify(path.join(ROOT, 'tests/_root.mjs'))}`)
    s = s.replace(/const ALLOW = \[[\s\S]*?\n\]/, 'const ALLOW = []   // 变异：清空白名单，只看判据本身能看见什么')
    return copyWith(rel, 'gate-' + Math.random().toString(36).slice(2) + '.mjs', () => s)
  }
  const sitesHit = (mutate) => {
    const p = gateWithEmptyAllow(src, mutate)
    const rr = runNode(p, ['--json'], { cwd: ROOT })
    const g = parseJsonTail(rr.out)
    const lit = ((g && g.findings) || []).filter((f) => f.kind === 'tmp-literal')
    return { findings: lit, all: lit.map((f) => `${f.rel}:${f.line}`).sort(), code: rr.code }
  }
  const nowSites = sitesHit(null)
  const hit8 = pa11Hits(nowSites.findings)
  check('P09-c', `放宽后的判据能看见审计列出的 8 处存量站点（${hit8.length}/8）`, hit8.length === 8,
    `命中=${hit8.length}/8；该副本判红集大小=${nowSites.all.length}（白名单已清空，红是预期的）`)
  const headGate = preFixOf(rel)
  if (!headGate) check('P09-d', '取不到改前版（' + PRE_FIX_LABEL + '）（无法做变异自证）', false)
  else {
    // 改前判据 + 清空白名单：直接跑改前版（它自己就带"要求紧贴引号"那版判据）
    const p = copyWith(rel, 'gate-head.mjs', () => headGate.replace(/from '\.\/_root\.mjs'/, `from ${JSON.stringify(path.join(ROOT, 'tests/_root.mjs'))}`).replace(/const ALLOW = \[[\s\S]*?\n\]/, 'const ALLOW = []'))
    const rr = runNode(p, ['--json'], { cwd: ROOT })
    const g = parseJsonTail(rr.out)
    const oldLit = ((g && g.findings) || []).filter((f) => f.kind === 'tmp-literal')
    const oldHit = pa11Hits(oldLit)
    const missed = PA11.filter((x) => !oldHit.includes(x)).map(([rel, needle]) => rel + '::' + needle)
    check('P09-d', `改前（钉死 ${PRE_FIX_REV}）判据对审计列的 8 处：漏检 ${missed.length}/8（期望 8/8 全漏 ⇒ 这正是 PA-09 要修的）`,
      missed.length === 8, `改前版命中=${8 - missed.length}/8`)
    mutantRedOk('P09-e', '把 TMP_LITERAL_RE 回退成改前版（' + PRE_FIX_LABEL + '）的"紧贴引号"版本（漏检集必须 == 审计列的 8 处）',
      PA11.map(([rel, needle]) => rel + '::' + needle), missed)
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[PA-37] bench-server-test 的 J13：断言语义化（不许按名字列举快捷根；变异 = 回退成' + PRE_FIX_LABEL + '的钉死版）')
{
  const rel = 'tests/bench-server-test.mjs'
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  // 块 = 从 `const fsRootsR = …` 到下一条同缩进语句（改前版与改后版的结尾文案不同 ⇒ 不能用文案当锚）
  const j13Block = (raw) => {
    const s = stripJsComments(raw)
    const i = s.indexOf("const fsRootsR = await request(P3, 'GET', '/api/fs/roots')")
    if (i < 0) return ''
    const j = s.indexOf('\n    const fsList = await request', i)
    return s.slice(i, j > 0 ? j : i + 4000)
  }
  const detect = (s) => {
    const b = j13Block(s)
    const pins = [
      { id: 'names-workspace', re: /r\.path === fx\.ws\b/ },
      { id: 'names-allwallpaper', re: /path\.join\(fx\.ws, 'allwallpaper'\)/ },
      { id: 'names-home-by-value', re: /r\.path === os\.homedir\(\)/ },
    ].filter((p) => p.re.test(b)).map((p) => p.id)
    const contract = ['existsTruthful', 'flagsContract', 'dedupedPaths', 'labelsDerived', 'hasLibrary', 'hasLibraryParent', 'hasHome', 'ABS_IN_LABEL'].filter((k) => b.includes(k))
    return { block: b, pins, contract }
  }
  const now = detect(src)
  check('P37-a', 'J13 断言里没有任何"按名字列举快捷根"的表达式（工作区 / allwallpaper / home 逐字相等）',
    now.block.length > 0 && now.pins.length === 0, 'pins=' + j(now.pins))
  check('P37-b', 'J13 断言的是契约（exists 如实 / listable⇒reason / path 去重 / 标签只由 basename+角色词拼 / 含库根+其上一级+home）',
    now.contract.length === 8, '命中契约判据=' + j(now.contract))
  // 分辨力证明的**harness 支持**：MUTATIONS 里必须有 mustStayGreen 那条（删掉作者式根仍须绿）
  check('P37-c', '变异 harness 支持"必须仍然绿"的变异，且登记了 J13 分辨力证明（J2）',
    /mustStayGreen/.test(src) && /J2 删掉/.test(src) && /H-快捷根契约破坏/.test(src))
  const head = preFixOf(rel)
  if (!head) check('P37-d', '取不到改前版（' + PRE_FIX_LABEL + '）（无法做变异自证）', false)
  else {
    const old = detect(head)
    check('P37-d', '改前（' + PRE_FIX_LABEL + '）J13：确实把 fx.ws / allwallpaper / os.homedir() 三条逐字钉死',
      old.pins.length === 3, 'pins=' + j(old.pins))
    mutantRedOk('P37-e', '把 J13 回退成改前版（' + PRE_FIX_LABEL + '）的"按名字列举根"版本', ['P37-a'], old.pins.length ? ['P37-a'] : [])
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[PA-31] EYE_HACK：依据强度登记 + 表可注入 + 每次生效记账（行为逐位不变）')
{
  const rel = 'core/we-scene-bundle.js'
  const mkScene = () => ({ layers: [
    { id: 115, name: '眼睛组合', size: [584, 759], scale: [0.69297, 0.69297, 1] },
    { id: 116, name: '左眼皮', uvRect: [0, 0, 1, 1] },
    { id: 117, name: '右眼上眼睑', uvRect: [0, 0, 1, 1] },
    { id: 118, name: '主体', size: [10, 10], scale: [1, 1, 1] },
  ] })
  const probe = async (modPath) => {
    const out = { failures: [], detail: {} }
    const lib = await import(modPath)
    const ids = lib.eyeHackSceneIds({})
    const rows = ids.map((id) => lib.eyeHackEntry(id))
    // a：内置表的每条 id 都必须有"依据强度 + 证据 + 标定前后尺寸"登记（防腐烂：光有 id = 面向结果）
    const registered = ids.length > 0 && rows.every((e) => e && e.kind && /weak|strong/.test(String(e.strength)) && e.evidence && Array.isArray(e.authored) && Array.isArray(e.target))
    out.detail.table = ids.length + ' 条；字段齐=' + registered
    if (!registered) out.failures.push('P31-a')
    // b：内置命中 → 行为不变 + 台账如实
    const logs = []
    const s1 = mkScene(); lib.applyRenderConfig(s1, { sceneId: ids[0], log: (m) => logs.push(m) })
    const eye = s1.layers[0]
    const sizeOk = Math.abs(eye.size[0] * eye.scale[0] - 405) < 1e-6 && Math.abs(eye.size[1] * eye.scale[1] - 120) < 1e-6
    const uvOk = j(eye.uvRect) === j([0.04, 0.3, 0.96, 0.7]) && j(s1.layers[1].uvRect) === j([0.08, 0.1, 0.92, 0.9])
    const led = s1.__eyeHackLedger
    out.detail.builtin = `${j(eye.uvRect)} size×scale=${eye.size[0] * eye.scale[0]}`;
    if (!(sizeOk && uvOk && led && led.inBuiltinTable === true && led.source === 'builtin-table' && led.applied.length === 3 && /依据=|依据强度/.test(logs[0] || ''))) out.failures.push('P31-b')
    // c：非白名单场景不动
    const s2 = mkScene(); lib.applyRenderConfig(s2, { sceneId: '3554161528' })
    if (!(s2.__eyeHackLedger === undefined && s2.layers[0].uvRect === undefined)) out.failures.push('P31-c')
    // d：注入表 ⇒ 任何场景都能启用，且台账标明"未登记/依据未知"
    const s3 = mkScene(); const logs3 = []
    lib.applyRenderConfig(s3, { sceneId: '3554161528', eyeHackSceneIds: ['3554161528'], log: (m) => logs3.push(m) })
    const l3 = s3.__eyeHackLedger
    out.detail.inject = l3 ? l3.source + '|' + l3.inBuiltinTable : 'null'
    if (!(l3 && l3.inBuiltinTable === false && /injected/.test(l3.source) && j(s3.layers[0].uvRect) === j([0.04, 0.3, 0.96, 0.7]) && /未登记/.test(logs3[0] || ''))) out.failures.push('P31-d')
    // e：开关仍然双向可用
    const s4 = mkScene(); lib.applyRenderConfig(s4, { sceneId: ids[0], eyeHack: false })
    const s5 = mkScene(); lib.applyRenderConfig(s5, { sceneId: '3554161528', eyeHack: true })
    if (!(s4.__eyeHackLedger === undefined && s4.layers[0].uvRect === undefined && s5.layers[0].uvRect && s5.__eyeHackLedger.source.includes('opts.eyeHack'))) out.failures.push('P31-e')
    return out
  }
  const now = await probe(path.join(ROOT, rel))
  check('P31-0', '真树：登记齐 + 台账如实 + 注入可换标定集 + 开关双向 + 行为逐位不变（size×scale ≡ 405×120）',
    now.failures.length === 0, 'failures=' + j(now.failures) + ' ' + j(now.detail))
  // 变异 1：把"表可注入"那一支删掉 ⇒ 注入用例必须红
  const mutInject = copyWith(rel, 'bundle-noinject.mjs', (s) => {
    const line = "  if (opts.eyeHackSceneIds !== undefined && opts.eyeHackSceneIds !== null && opts.eyeHackSceneIds !== '') return [...new Set(norm(opts.eyeHackSceneIds))]\n"
    if (!s.includes(line)) return s
    return s.replace(line, '  // 变异：删掉注入支（只认内置表）\n')
  })
  const mutInjectAbs = (() => { const p = path.join(TMPDIR, 'bundle-noinject-abs.mjs'); fs.writeFileSync(p, absImports(fs.readFileSync(mutInject, 'utf8'), path.join(ROOT, 'core'))); return p })()
  const after1 = await probe(mutInjectAbs)
  check('P31-1', '变异（删掉注入支）确实让"表可注入"用例变红', after1.failures.includes('P31-d'), j(after1.failures))
  mutantRedOk('P31-2', '删掉 eyeHackSceneIds 的注入支', ['P31-d'], after1.failures)
  // 变异 2：把内置表的 evidence 字段抠掉 ⇒ 依据强度登记判据必须红
  const mutEv = copyWith(rel, 'bundle-noev.mjs', (s) => s.replace(/\n    evidence: 'CALIBRATION-3719111841[\s\S]*?',\n/, '\n'))
  const mutEvAbs = (() => { const p = path.join(TMPDIR, 'bundle-noev-abs.mjs'); fs.writeFileSync(p, absImports(fs.readFileSync(mutEv, 'utf8'), path.join(ROOT, 'core'))); return p })()
  const after2 = await probe(mutEvAbs)
  check('P31-3', '变异（抠掉依据/证据登记）确实让"依据强度登记"用例变红', after2.failures.includes('P31-a'), j(after2.failures))
  mutantRedOk('P31-4', '把内置标定表的 evidence 登记删掉', ['P31-a'], after2.failures)
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log(`\n结果: ${pass} 通过, ${fail} 失败` + (fail ? `（红：${failures.join(' ')}）` : ''))
if (JSON_OUT) console.log('PORTABILITY-AUDIT-FIX-JSON ' + j({ pass, fail, failures }))
process.exit(fail ? 1 : 0)

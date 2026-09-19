// tools/token-namespace-test.mjs —— MASTER-TODO §5 第 1 项 / P0-3「磨砂·主题一致性 = 同一套 token 命名空间」
//
// 本文件回答一个**只能靠对比才能回答**的问题：
//   "把四个表面的宿主 token 消费搬进 --mpw-* SSOT" 这次结构性重构，**默认档的视觉取值变了吗**？
//
// 做法（结构性判据；本机无 GPU、无头 Firefox 不合成 backdrop-filter ⇒ 不声称任何像素结论）：
//   ① 取 `git show HEAD:lib/client.js` 当 **before**，工作树 lib/client.js 当 **after**
//      （`--before <path>` 可指定；夹具走 mkdtemp，806KB < 1MB，exit 兜底删除）
//   ② 用 tools/_stub.mjs 分别调 `__mpwBuildCss(patch)`（与 style-scope-guard / css-matrix 同口径）
//      遍历 615 组设置（按源码 boolFields/numFields 自动枚举，实跑打印条数；开关增减时数字随之变化）；
//   ③ 对每条规则解析选择器与声明，挑出"打在四个表面上的 底色/磨砂/模糊"声明，
//      用产物里自己的 token 定义（SSOT 的 body 块等）**递归代换 var()** ⇒ 得到"符号化取值"；
//   ④ 按 (设置组合, 表面, 亮/暗档, 属性) 收集**取值集合**，before 与 after 必须**完全一致**
//      ⇒ 结构变了、取值没变（重构而非重设计）。宿主自定义 token 保持符号名，两侧同样处理。
//
// 另外三条结构断言（brief 的 (a)(b)）：
//   (a) 共享表面 token 的定义点必须**唯一**且是 `body`（不能是 :root/html：宿主把 --dsw-*
//       定义在 body，写在 :root 会 guaranteed-invalid 并继承下去 —— 见 lib/client.js emitSurfaceTokens 注释）
//   (b) 四个表面必须各自引用到共享 --mpw-* 名（清单写在本文件 SURFACES）
//   (c) 分辨力：把"表面改回直接读宿主 token"与"共享 token 挪到 :root"两种回退做成变异，必须变红
//
// 用法:
//   node tools/token-namespace-test.mjs                 # 全量（含变异自证）
//   node tools/token-namespace-test.mjs --no-mutations  # 只跑等价性 + 结构断言（调试用）
//   node tools/token-namespace-test.mjs --before <file> # 指定 before 副本
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const clientPath = path.join(repoRoot, 'lib', 'client.js')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const NO_MUT = process.argv.includes('--no-mutations')
const fromGit = argOf('--from-git', 'HEAD')
/* 变异自证：子进程用 MPW_TOKEN_MUT_CLIENT 指定"被我改坏的 after 副本" */
const afterPath = process.env.MPW_TOKEN_MUT_CLIENT ? path.resolve(process.env.MPW_TOKEN_MUT_CLIENT) : clientPath

/* 真实断言助手（本仓教训：ok(name, detail) 恒真 = 假绿，不许再出现） */
let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

/* ── 四个表面 + 必须引用到的共享 token（brief 要求"列出来"） ── */
const SURFACES = [
  { id: 'top', name: '顶栏', re: /\.wSkVaW_header|\[class\*="wSkVaW_header"\]|header\[class\*="_header_"\]/,
    tokens: ['--mpw-surface-frost-top', '--mpw-surface-frost-top-light', '--mpw-surface-opaque-top', '--mpw-hdr-blur'] },
  { id: 'side', name: '侧栏', re: /sidebarCol|\.hHd-Xa_root|\[data-slot="sidebar"\]|\[data-sidebar-right-panel\]|\[data-dockkit-(pane|strip|surface)\]/,
    tokens: ['--mpw-surface-side', '--mpw-surface-side-frost', '--mpw-surface-rs-dock', '--mpw-chrome-blur', '--mpw-chrome-alpha'] },
  { id: 'panel', name: '面板',
    re: /\[role="(dialog|alertdialog|menu|listbox|tooltip)"\]|settingsArea|class\*="_overlay"|class\*="_menu"|class\*="_popover"|class\*="_denseList"|data-dsh-surface|\.mpw_dialog|\.mpw_glassHost|\[data-cordis-panel\]/,
    tokens: ['--mpw-surface-panel', '--mpw-surface-panel-frost', '--mpw-surface-pop', '--mpw-surface-dialog-dark'] },
  { id: 'rail', name: '时间线条', re: /\.eGxaPq_|\.Y0dWHa_|qBU-ya|_1p9O6q_|turn-rail/,
    tokens: ['--mpw-rail-ink', '--mpw-rail-halo'] },
]
const SURFACE_PROPS = /^(background|background-color|background-image|backdrop-filter|-webkit-backdrop-filter)$/
const INTERACTION_PSEUDO = /:(hover|focus|focus-visible|focus-within|active|disabled|checked|target|placeholder)\b/
const NESTED_SUBJECT = /(button|input|select|textarea|svg|img|\[class\*="(button|Button|icon|Icon|badge|logo|mode|segmented|primary|status|Status|item|Item))/

/* ── CSS 解析（与 tools/style-scope-guard.mjs 同口径的精简副本：本文件只读产物、不判作用域） ── */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ')
function parseRules(css) {
  const t = stripComments(css)
  const out = []
  const walk = (start, end) => {
    let i = start, prelude = ''
    while (i < end) {
      const c = t[i]
      if (c === '{') {
        let depth = 1, j = i + 1
        while (j < end && depth > 0) { if (t[j] === '{') depth++; else if (t[j] === '}') depth--; j++ }
        const head = prelude.trim()
        if (head.startsWith('@')) {
          const name = (head.match(/^@([a-zA-Z-]+)/) || [, ''])[1].toLowerCase()
          if (['media', 'supports', 'layer', 'container', 'scope', 'document'].includes(name)) walk(i + 1, j - 1)
        } else if (head) out.push({ selector: head.replace(/\s+/g, ' ').trim(), body: t.slice(i + 1, j - 1) })
        i = j; prelude = ''
        continue
      }
      if (c === ';' && prelude.trim().startsWith('@')) { prelude = ''; i++; continue }
      prelude += c; i++
    }
  }
  walk(0, t.length)
  return out
}
function splitTopLevel(s, seps = ',') {
  const out = []; let depth = 0, quote = null, cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) { cur += c; if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (depth === 0 && seps.includes(c)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
function parseDeclarations(body) {
  const out = []
  for (const chunk of splitTopLevel(body, ';')) {
    const i = chunk.indexOf(':')
    if (i <= 0) continue
    const prop = chunk.slice(0, i).trim()
    if (!/^(--[A-Za-z0-9-]+|[a-zA-Z-]+)$/.test(prop)) continue
    let value = chunk.slice(i + 1).trim().replace(/!important\s*$/i, '').trim()
    out.push({ prop, value })
  }
  return out
}

/** 产物里所有自定义属性定义：prop → Set(值)。共享 token 只应有一个定义点，其余（宿主 token 被我们覆盖）允许多个。 */
function tokenDefs(rules) {
  const m = new Map()
  for (const r of rules) for (const d of parseDeclarations(r.body)) {
    if (!d.prop.startsWith('--')) continue
    if (!m.has(d.prop)) m.set(d.prop, new Map())
    m.get(d.prop).set(d.value, (m.get(d.prop).get(d.value) || 0) + 1)
  }
  return m
}
/** 把值里的 var(--x[, fallback]) 用产物自己的定义递归代换（宿主定义不在产物里 ⇒ 保持符号名） */
function resolveValue(value, defs, depth = 0) {
  if (depth > 12) return value
  let out = String(value), changed = false
  out = out.replace(/var\((--[A-Za-z0-9-]+)(\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (all, name, _c, fb) => {
    const cand = defs.get(name)
    if (cand && cand.size === 1) { changed = true; return resolveValue([...cand.keys()][0], defs, depth + 1) }
    if (cand && cand.size > 1) { changed = true; return '‹多定义:' + name + '›' }
    if (fb !== undefined) { changed = true; return resolveValue(fb.trim(), defs, depth + 1) }
    return name   // 宿主自定义 token：保持符号名（两侧同样处理）
  })
  return changed ? resolveValue(out, defs, depth + 1) : out
}
/* ⚠ 必须先判 :not([data-ds-dark-theme])：它的字面量里也含 [data-ds-dark-theme]，
   反过来的判序会把**亮色档规则**当成暗色档（自证时抓到过这个洞：顶栏取值变异因此漏判）。 */
const variantOf = (sel) => (/:not\(\[data-ds-dark-theme\]\)/.test(sel) ? 'light' : (/\[data-ds-dark-theme\]/.test(sel) ? 'dark' : 'any'))
const isSurfaceSubject = (selector, re) => splitTopLevel(selector, ',').some((part) => {
  if (!re.test(part) || INTERACTION_PSEUDO.test(part)) return false
  const steps = splitTopLevel(part.replace(/([>+~])/g, ' $1 '), ' ')
  const last = steps[steps.length - 1] || ''
  return re.test(last) && !NESTED_SUBJECT.test(last)
})

/* ── 组合集：与 style-scope-guard 的 buildCases 同口径（核心 9 开关全枚举 + 单开 + 数值极值 + 无壁纸 + lgTest） ── */
function buildCases(src) {
  const grab = (n) => { const m = new RegExp(n + '\\s*=\\s*\\[([^\\]]*)\\]').exec(src); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [] }
  const bools = grab('const boolFields').filter((b) => !['lgTest', 'enabled', 'forceEnabled'].includes(b))
  const nums = grab('const numFields')
  const P = (p) => Object.assign({ image: true, enabled: true }, p)
  const CORE = ['sidebar', 'unifyTint', 'headerBg', 'headerBlur', 'float', 'lgCss', 'aquaMask', 'aquaTint', 'rightSidebarBlur']
  const cases = []
  cases.push(['默认（全关）', P({})])
  cases.push(['全部布尔开', P(Object.fromEntries(bools.map((b) => [b, true])))])
  cases.push(['无壁纸源', { image: false, webUrl: '', enabled: true }])
  cases.push(['灰字自定义色', P({ fontColorGray: true, fontColorGrayColor: '#123456' })])
  cases.push(['液态玻璃测试模式', P({ lgTest: true })])
  for (const b of bools) cases.push(['单开:' + b, P({ [b]: true })])
  for (const n of (nums.length ? nums : ['opacity', 'blur', 'sidebarAlpha', 'bsRevealAlpha'])) {
    cases.push([`数值:${n}=0`, P({ [n]: 0 })])
    cases.push([`数值:${n}=100`, P({ [n]: 100 })])
  }
  for (let m = 0; m < (1 << CORE.length); m++) {
    const patch = {}
    CORE.forEach((k, i) => { patch[k] = !!(m & (1 << i)) })
    cases.push(['core#' + m, P(patch)])
  }
  return cases
}

/** 简单特异度（够用即可：本判据只比较"表面容器上的底色/磨砂"这一小组声明） */
function specificity(part) {
  const ids = (part.match(/#[A-Za-z0-9_-]+/g) || []).length
  const cls = (part.match(/\.[A-Za-z0-9_\\-]+|\[[^\]]*\]|:(?!:)[a-z-]+(?:\([^)]*\))?/g) || []).length
  const el = (part.match(/(^|[\s>+~])[a-zA-Z][a-zA-Z0-9-]*/g) || []).length
  return ids * 10000 + cls * 100 + el
}
/** 按"亮/暗上下文"取该上下文的 token 定义表（any 档规则两边都算） */
function defsFor(rules, context) {
  const relevant = rules.filter((r) => { const v = variantOf(r.selector); return context === 'dark' ? v !== 'light' : v !== 'dark' })
  return tokenDefs(relevant)
}
/**
 * 一组设置下的"四表面**有效**取值指纹"：Map(`${context}|${surface}|${prop}` → 符号化取值)。
 * 用一个**极小的层叠模型**取代"取值集合"：只对"表面容器本身的 底色/磨砂/模糊"声明，
 * 按 (亮/暗上下文 → 选择器特异度 → 源码顺序) 取生效值。这样 before/after 即使把
 * "一条靠 token 继承实现主题自适应"的规则拆成"亮/暗各一条显式规则"（本次重构正是如此），
 * 只要**最终生效值**没变就判等 —— 反之只要生效值变了就判红。
 */
/* 运行时门控：选择器里带 **正向** [data-mpw-*] 属性（JS 在特定功能开启时才打），
   例如 [data-mpw-hdr-translucent] / [data-mpw-rsblur="on"]。这类规则在"默认档"里不生效，
   但它们特异性更高，会在只看 CSS 的层叠模型里**盖住**基础规则、让判据失去分辨力
   （自证时抓到过：顶栏基础规则的变异被 [data-mpw-hdr-translucent] 规则掩盖）。
   所以每个上下文算**两个状态**：default（跳过运行时门控规则）/ gated（全都算）。 */
const positiveRuntimeGate = (sel) => /\[data-mpw-/.test(String(sel).replace(/:not\(\[data-mpw-[^\]]*\]\)/g, ''))

function fingerprint(css, state = 'gated') {
  const rules = parseRules(css)
  const out = new Map()
  for (const context of ['light', 'dark']) {
    const defs = defsFor(rules, context)
    const best = new Map()   // key → { spec, value, order }
    let order = 0
    for (const r of rules) {
      order++
      if (state === 'default' && positiveRuntimeGate(r.selector)) continue
      const v = variantOf(r.selector)
      if (context === 'dark' ? v === 'light' : v === 'dark') continue
      const decls = parseDeclarations(r.body)
      for (const s of SURFACES) {
        if (!isSurfaceSubject(r.selector, s.re)) continue
        // 生效候选：表面**主语**那一片分片里特异度最高的分片
        const parts = splitTopLevel(r.selector, ',').filter((part) => {
          if (!s.re.test(part) || INTERACTION_PSEUDO.test(part)) return false
          const steps = splitTopLevel(part.replace(/([>+~])/g, ' $1 '), ' ')
          const last = steps[steps.length - 1] || ''
          return s.re.test(last) && !NESTED_SUBJECT.test(last)
        })
        if (!parts.length) continue
        const spec = Math.max(...parts.map(specificity))
        for (const d of decls) {
          if (!SURFACE_PROPS.test(d.prop)) continue
          const k = `${state}|${context}|${s.id}|${d.prop}`
          const cur = best.get(k)
          // 同特异度：源码在后的胜（x := 后者）；更高特异度：直接取代
          if (!cur || spec > cur.spec || (spec === cur.spec && order >= cur.order)) {
            best.set(k, { spec, order, value: resolveValue(d.value, defs) })
          }
        }
      }
    }
    for (const [k, v] of best) out.set(k, v.value)
  }
  return out
}

function buildAllWith(clientFile, cases, casesFile) {
  const out = path.join(os.tmpdir(), 'mpw-token-emit-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json')
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--emit', clientFile, '--json', out]
    .concat(casesFile ? ['--cases', casesFile] : []), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('emit 子进程失败：' + ((r.stderr || r.stdout || '').split('\n').slice(-6).join(' ')))
  const arr = JSON.parse(fs.readFileSync(out, 'utf8'))
  try { fs.rmSync(out, { force: true }) } catch { /* 删不掉也不抛 */ }
  return arr
}
if (process.argv.includes('--emit')) {
  const file = argOf('--emit', clientPath)
  const jsonOut = argOf('--json', '')
  /* ①(NP-1) before/after 必须用**同一份**用例表：`--cases <json>` 由父进程下发。
     为什么必须下发：`buildCases()` 的布尔清单是从源码里的 `const boolFields` 抠出来的，
     而 before 文件（`git show HEAD:lib/client.js`）**没有**这一轮新加的那个键 ⇒
     子进程若按 before 自己重建用例表就会少 N 条（N = 本轮新增的开关数），
     长度对不上 → 报"emit 结果条数与组合数不一致"，把"新增一个开关"误判成产物漂移。
     这不是放宽判据：**用例表本来就该由 after（当前产物）定义**，before 只是同一批设置下的对照；
     真正要比的"四表面生效值"判据一条没少。 */
  const casesArg = argOf('--cases', '')
  const caseList = casesArg ? JSON.parse(fs.readFileSync(casesArg, 'utf8')) : buildCases(fs.readFileSync(file, 'utf8'))
  const loaded = loadPlugin({ clientPath: file, settings: {}, quiet: true })
  if (loaded.applyErrors.length) { console.error('apply() 报错：' + loaded.applyErrors.slice(0, 2).join(' | ')); process.exit(1) }
  if (typeof globalThis.__mpwBuildCss !== 'function') { console.error('未暴露 __mpwBuildCss'); process.exit(1) }
  const arr = caseList.map(([name, patch]) => {
    let css = ''
    try { css = String(globalThis.__mpwBuildCss(patch) || '') } catch (e) { css = '/*BUILD_ERROR*/' + (e && e.message) }
    return { name, css }
  })
  fs.writeFileSync(jsonOut || path.join(os.tmpdir(), 'mpw-token-emit.json'), JSON.stringify(arr))
  process.exit(0)
}

/* ── 主流程 ── */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-token-ns-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

const beforeArg = argOf('--before', '')
const beforePath = beforeArg ? path.resolve(beforeArg) : path.join(tmpRoot, 'client-before.js')
if (!beforeArg) fs.writeFileSync(beforePath, execFileSync('git', ['show', fromGit + ':lib/client.js'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }))
console.log(`══ 表面 token 命名空间（§5 第1项 / P0-3）══`)
console.log(`before = ${beforeArg ? beforePath : 'git ' + fromGit + ':lib/client.js'}（${(fs.statSync(beforePath).size / 1024).toFixed(0)} KB） · after = ${path.relative(repoRoot, afterPath)}`)

const src = fs.readFileSync(afterPath, 'utf8')
const cases = buildCases(src)
/* ①(NP-1) 同一份用例表下发给两个 emit 子进程（见 --cases 处的长注释） */
const casesFile = path.join(tmpRoot, 'cases.json')
fs.writeFileSync(casesFile, JSON.stringify(cases))
const before = buildAllWith(beforePath, cases, casesFile)
const after = buildAllWith(afterPath, cases, casesFile)
if (before.length !== cases.length || after.length !== cases.length) { console.error('✗ emit 结果条数与组合数不一致'); process.exit(1) }
console.log(`设置组合 ${cases.length} 组 · before ${before.length} / after ${after.length}\n`)

/* 调试用：--dump <substr> 打印第一组设置里匹配键的 before/after 取值（排查指纹为什么相等/不等） */
const dumpKey = argOf('--dump', '')
if (dumpKey) {
  const n = Number(argOf('--dump-case', '0')) || 0
  const fb = new Map([...fingerprint(before[n].css, 'default'), ...fingerprint(before[n].css, 'gated')])
  const fa = new Map([...fingerprint(after[n].css, 'default'), ...fingerprint(after[n].css, 'gated')])
  console.log(`--dump ${dumpKey} @ case[${n}] = ${cases[n][0]}`)
  for (const k of new Set([...fb.keys(), ...fa.keys()])) {
    if (!k.includes(dumpKey)) continue
    console.log(`   ${k}\n     before: ${fb.get(k)}\n     after : ${fa.get(k)}`)
  }
}

/* ── 断言 1：默认档 + 全组合的"取值指纹"逐键相等（重构而非重设计） ── */
console.log('== A. 表面取值等价（before ↔ after，符号化代换后逐键比对）==')
let diffKeys = 0, diffCases = 0, keysChecked = 0
const samples = []
for (let i = 0; i < cases.length; i++) {
  const fb = new Map([...fingerprint(before[i].css, 'default'), ...fingerprint(before[i].css, 'gated')])
  const fa = new Map([...fingerprint(after[i].css, 'default'), ...fingerprint(after[i].css, 'gated')])
  const keys = new Set([...fb.keys(), ...fa.keys()])
  let caseBad = false
  for (const k of keys) {
    keysChecked++
    const vb = fb.get(k)
    const va = fa.get(k)
    if (vb !== va) {
      diffKeys++; caseBad = true
      if (samples.length < 6) samples.push(`${cases[i][0]} · ${k}\n      before: ${vb === undefined ? '(无)' : vb}\n      after : ${va === undefined ? '(无)' : va}`)
    }
  }
  if (caseBad) diffCases++
}
ok(`★ 四表面底色/磨砂**生效值**在 ${cases.length} 组设置 × 亮/暗 × 默认/门控态下逐键相等`,
  diffKeys === 0, diffKeys ? `${diffKeys} 个键不一致（${diffCases} 组设置）\n      ` + samples.join('\n      ') : `比对 ${keysChecked} 个 (状态, 亮/暗, 表面, 属性) 键`)

// 表面规则里不得再出现共享 token 的**定义**（值必须只在 SSOT 一处给）
let surfaceDefs = []
for (let i = 0; i < after.length; i++) {
  for (const r of parseRules(after[i].css)) {
    for (const s of SURFACES) {
      if (!isSurfaceSubject(r.selector, s.re)) continue
      for (const d of parseDeclarations(r.body)) {
        if (/^--mpw-(surface-|chrome-|rs-|hdr-)/.test(d.prop)) surfaceDefs.push(`${cases[i][0]} · ${r.selector} · ${d.prop}`)
      }
    }
  }
}
ok('★ 表面规则里不再定义共享 --mpw-* 表面 token（定义只在 SSOT）', surfaceDefs.length === 0, surfaceDefs.slice(0, 3).join(' | '))

/* ── 断言 2：共享 token 的定义点唯一，且必须是 body（不是 :root） ── */
console.log('\n== B. 共享表面 token 的定义点（SSOT）==')
const defSites = new Map()  // token → Set(selector)
let rootScopedHostRef = []
for (let i = 0; i < after.length; i++) {
  const rules = parseRules(after[i].css)
  const defs = tokenDefs(rules)
  for (const r of rules) {
    for (const d of parseDeclarations(r.body)) {
      if (!/^--mpw-(surface-|chrome-|rs-|hdr-)/.test(d.prop)) continue
      if (!defSites.has(d.prop)) defSites.set(d.prop, new Set())
      defSites.get(d.prop).add(r.selector)
      // ★ 宿主 token 定义在 body ⇒ 引用了 --dsw-* 的 SSOT 定义绝不能落在 :root / html 上
      if (/^(:root|html)$/.test(r.selector) && /var\(--dsw-/.test(d.value)) rootScopedHostRef.push(`${cases[i][0]} · ${r.selector} · ${d.prop}`)
    }
  }
}
const multi = [...defSites].filter(([, s]) => s.size > 1)
ok('★ 每枚共享 --mpw-* 表面 token 只有一个定义点', multi.length === 0,
  multi.length ? multi.slice(0, 4).map(([t, s]) => `${t} → ${[...s].join(' , ')}`).join(' | ') : `${defSites.size} 枚 token，各 1 处`)
const notBody = [...defSites].filter(([, s]) => ![...s].every((x) => x === 'body'))
ok('★ 共享 token 的定义点是 body（宿主 --dsw-* 定义在 body，写 :root 会 guaranteed-invalid 并继承）',
  notBody.length === 0, notBody.length ? notBody.slice(0, 3).map(([t, s]) => `${t} → ${[...s].join(',')}`).join(' | ') : '全部落在 body')
ok('★ 没有任何"引用宿主 token 的共享定义"落在 :root/html 上', rootScopedHostRef.length === 0, rootScopedHostRef.slice(0, 3).join(' | '))

/* ── 断言 3：四个表面各自引用到共享 --mpw-*（清单显式列出） ── */
console.log('\n== C. 四个表面引用共享 --mpw-* 清单 ==')
const refAll = new Map()
for (let i = 0; i < after.length; i++) {
  for (const r of parseRules(after[i].css)) {
    for (const s of SURFACES) {
      if (!isSurfaceSubject(r.selector, s.re)) continue
      const body = r.body
      for (const t of s.tokens) if (body.includes('var(' + t)) {
        if (!refAll.has(s.id)) refAll.set(s.id, new Set())
        refAll.get(s.id).add(t)
      }
    }
  }
}
for (const s of SURFACES) {
  const got = [...(refAll.get(s.id) || [])]
  ok(`${s.name} 引用共享 token`, got.length > 0, `期望至少 1 枚（清单：${s.tokens.join(' ')}）→ 实际引用：${got.join(' ') || '(无)'}`)
}

/* ── 断言 4：变异必须变红（分辨力自证） ── */
if (!NO_MUT) {
  console.log('\n== D. 分辨力自证：把重构"改回去"必须让上面的断言变红 ==')
  const MUTS = [
    {
      id: 'ssot-value-drift',
      why: '只改 SSOT 里顶栏磨砂的一处取值（35% → 28%）——共享定义点被改动必须被取值等价判据抓到',
      mut: (s) => s.replace('tok("--mpw-surface-frost-top", `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${hdrAlpha}%, transparent)`);',
        'tok("--mpw-surface-frost-top", `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${Math.max(0, hdrAlpha - 7)}%, transparent)`);'),
      expect: 'A',
    },
    {
      id: 'ssot-back-to-root',
      why: '把 SSOT 定义块从 body 挪回 :root（宿主 token 在 body ⇒ 值 guaranteed-invalid 并继承给后代）',
      mut: (s) => s.replace('   并继承下去（历史事故机制）。账本：docs/TOKEN-NAMESPACE.md */\nbody {\n${decls}',
        '   并继承下去（历史事故机制）。账本：docs/TOKEN-NAMESPACE.md */\n:root {\n${decls}'),
      expect: 'B',
    },
    {
      id: 'surface-value-replaced',
      why: '基础规则不再走共享 token，换成一个不同的字面量 —— 生效值变了，A 组必须变红',
      mut: (s) => s.replace('.wSkVaW_header {\n\tbackground-color: var(--mpw-surface-frost-top) !important;',
        '.wSkVaW_header {\n\tbackground-color: rgba(9, 9, 9, 0.9) !important;'),
      expect: 'A',
    },
  ]
  for (const m of MUTS) {
    const mutated = m.mut(src)
    if (mutated === src) { ok(`变异 ${m.id} 注入成功`, false, '注入点没匹配上（源码改了？）'); continue }
    const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--before', beforePath, '--no-mutations'], {
      encoding: 'utf8', env: { ...process.env, MPW_TOKEN_MUT_CLIENT: copy },
        })
    const out = (r.stdout || '') + (r.stderr || '')
    // 断言名会改，这里按"哪一组断言变红"匹配（A 组 = 取值等价；B 组 = SSOT 定义点）
    const failedA = /✗ ★ (四表面底色|表面规则里不再定义)/.test(out)
    const failedB = /✗ ★ (每枚共享|共享 token 的定义点是 body|没有任何)/.test(out)
    const got = failedA ? 'A' : (failedB ? 'B' : (r.status === 0 ? 'PASS' : 'FAIL(其它)'))
    ok(`变异 ${m.id}：期望 ${m.expect} 变红，实际 ${got}`, got === m.expect, `${m.why}  [exit=${r.status}]`)
  }
}

cleanup()
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 表面 token 命名空间未通过'); process.exit(1) }
console.log('✓ 表面 token 命名空间通过：四表面取值与重构前逐键相等 + SSOT 唯一定义点（body）+ 四表面接线齐全')

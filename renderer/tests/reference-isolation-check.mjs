// reference-isolation-check.mjs — 参考资料隔离护栏（2026-09-17，依律师意见落地）
//
// 背景：工作区里有 6 个第三方参考副本（现集中在 `references/**`）与 1 个取证归档（`Delete/**`，
// 例如 `Delete/we-official-shaders/`）。它们**从未被本项目 import、从未进构建** —— 这个事实此前
// 只写在文档里（`docs/WER-REF-LICENSE-AUDIT.md` §2.1 的实测 grep）。文档会过期，断言不会。
// 本脚本把该事实变成**机器可检查的断言**，每条都有判别力自检（见 `selfTest`）：
//
//   ① ref-import-free      仓库内全部源码/测试/脚本中，**0 处** import / require / readFile /
//                          fetch 的**实参位置**指向参考副本或归档目录。
//                          （注释里出现路径文字是**允许**的 —— 那正是"行为对照"引注的写法。）
//   ② pack-and-site-clean  `npm pack --dry-run` 的文件清单 + `build-pages.mjs` 的 `_site` 产物中，
//                          **0 个**文件来自上述目录。
//   ③ ignore-and-whitelist `.gitignore` 覆盖这些目录（它们本就在仓库外，规则是双保险），且
//                          `package.json` 的 `files` 白名单一旦收录它们 → 断言立即变红。
//   ④ legacy-path-shim     工作区根的同名旧路径**只允许是符号链接**且解析到 `references/**`；
//                          一旦被换回**真实目录**（= 内容回流仓库外根目录）立即变红。
//
// 为什么有 ④：目录归一后旧路径仍需可解析（历史取证命令 `git -C …/wer-ref remote -v`、
// `docs-check` 的"被引用文件必须存在"校验都按旧路径走）。链接是**零内容重定向**，不是第二份副本。
//
// 用法: node tests/reference-isolation-check.mjs [--json]
// 只读：唯一写入是 os.tmpdir() 下的临时站点构建产物（用完即删）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const DSHAREA = process.env.MPW_ROOT || path.resolve(ROOT, '..')
const JSON_OUT = process.argv.includes('--json')

// —— 断言对象：危险目录名（工作区根那一层）与旧路径名 ——
const DANGER_DIRS = ['references', 'Delete']
const LEGACY_NAMES = ['wer-ref', 'we-layerd-ref', 'lwe-ref', 'dsbw-ref', 'vendor-ref', 'reference']

// 路径文字形态（含 `../` 与引号变体）
const DANGER_TEXT = new RegExp(
  '(?:' + [
    'references[\\\\/]',
    'references["\']',
    '\\bDelete[\\\\/]',
    '\\bDelete["\']',
    '\\bwer-ref\\b',
    '\\bwe-layerd-ref\\b',
    '\\blwe-ref\\b',
    '\\bdsbw-ref\\b',
    '\\bvendor-ref\\b',
    '\\breference[\\\\/]',
  ].join('|') + ')'
)

// 实参位置语法（调用形态；单独出现路径文字不算）
const CALL_RES = [
  /\bimport\s*\(/,
  /\bimport\b[^\n]*\bfrom\b/,
  /\brequire\s*\(/,
  /\breadFileSync\s*\(/,
  /\breadFile\s*\(/,
  /\bcreateReadStream\s*\(/,
  /\bfetch\s*\(/,
  /\bimportScripts\s*\(/,
  /\bexecFileSync\s*\(/,
  /\bexecSync\s*\(/,
  /\bexec\s*\(/,
  /\bspawnSync\s*\(/,
  /\bnew\s+URL\s*\(/,
  /\bcopyFileSync\s*\(/,
  /\bcpSync\s*\(/,
]

const SCAN_EXT = new Set([
  '.mjs', '.js', '.cjs', '.mts', '.cts', '.jsx', '.tsx',
  '.json', '.sh', '.bash', '.html', '.htm', '.css', '.yml', '.yaml', '.py',
])
const SKIP_DIR = new Set(['.git', 'node_modules', '_site', 'reports', '__pycache__'])
const HASH_EXT = new Set(['.sh', '.bash', '.yml', '.yaml', '.py'])
const HTML_EXT = new Set(['.html', '.htm'])

// ── 注释剥离（字符串感知；注释里的路径文字按口径**允许**存在）──
export function stripComments(src, ext) {
  // 说明：本函数是**扫描器的一部分**，逐字符状态机 —— 不依赖正则近似，避免把字符串里的
  // `//` 误当注释、或把块注释里的代码误当"实参位置"。
  const hash = HASH_EXT.has(ext)
  const html = HTML_EXT.has(ext)
  let out = ''
  let i = 0
  let lineStart = true
  const n = src.length
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (c === '/' && c2 === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? n : e + 2
      for (let k = i; k < end; k++) out += src[k] === '\n' ? '\n' : ' '
      i = end; continue
    }
    if (c === '/' && c2 === '/') {
      let e = src.indexOf('\n', i)
      if (e < 0) e = n
      out += ' '.repeat(e - i); i = e; continue
    }
    if (html && c === '<' && src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4)
      const end = e < 0 ? n : e + 3
      for (let k = i; k < end; k++) out += src[k] === '\n' ? '\n' : ' '
      i = end; continue
    }
    if (hash && c === '#' && lineStart) {
      let e = src.indexOf('\n', i)
      if (e < 0) e = n
      out += ' '.repeat(e - i); i = e; continue
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        if (src[i] === c) { out += c; i++; break }
        if (src[i] === '\n') { out += '\n'; lineStart = true; i++; continue }
        out += src[i]; i++
      }
      lineStart = false
      continue
    }
    out += c
    if (c === '\n') lineStart = true
    else if (!/\s/.test(c)) lineStart = false
    i++
  }
  return out
}

// ── 判定：相对路径是否落在隔离区 ──
export function isDangerPath(rel) {
  if (typeof rel !== 'string' || !rel) return false
  const segs = rel.split(/[\\/]+/).filter(Boolean)
  const first = segs[0]
  if (DANGER_DIRS.includes(first)) return true
  if (LEGACY_NAMES.includes(first)) return true
  if (segs.includes('..')) return false
  return DANGER_DIRS.some((d) => segs.includes(d)) || LEGACY_NAMES.some((d) => segs.includes(d))
}

// ── 扫描器：返回 {hits, files, mentions} ──
export function scanTree(root, { skip = SKIP_DIR, exts = SCAN_EXT } = {}) {
  const hits = []
  const mentions = []
  let files = 0
  const walk = (dir) => {
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (skip.has(e.name)) continue
      const p = path.join(dir, e.name)
      let st = null
      try { st = fs.lstatSync(p) } catch { continue }
      if (st.isSymbolicLink()) continue          // 不跟随符号链接（参考副本内部有指向仓库 demo 的链接）
      if (st.isDirectory()) { walk(p); continue }
      if (!st.isFile()) continue
      const ext = path.extname(e.name).toLowerCase()
      if (!exts.has(ext)) continue
      files++
      const rel = path.relative(root, p)
      let src = ''
      try { src = fs.readFileSync(p, 'utf8') } catch { continue }
      const raw = src.split('\n')
      raw.forEach((line, i) => { if (DANGER_TEXT.test(line)) mentions.push({ file: rel, line: i + 1 }) })
      const stripped = stripComments(src, ext).split('\n')
      stripped.forEach((line, i) => {
        if (!DANGER_TEXT.test(line)) return
        if (!CALL_RES.some((re) => re.test(line))) return
        hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) })
      })
    }
  }
  walk(root)
  return { hits, mentions, files }
}

// ── 判别力自检：断言本身必须"能变红" ──
export function selfTest() {
  const t = []
  const ok = (name, cond) => t.push({ name, ok: !!cond })

  // 样本里的路径按**片段拼装**：本文件自身也在扫描范围内（**不给自己开豁免**），
  // 逐字写死 `references/…` 会让护栏扫到自己的样本 —— 那不是假阳性，是自指。
  const REFS = 'references' + '/'
  const DEL = 'Delete' + '/'
  const WER = 'wer' + '-ref' + '/'
  const VEN = 'vendor' + '-ref' + '/'
  const hitsOf = (src, ext = '.mjs') => stripComments(src, ext).split('\n')
    .filter((l) => DANGER_TEXT.test(l) && CALL_RES.some((re) => re.test(l))).length

  // ① 扫描器：注入一条引用必须命中；注释里的同样文字必须**不**命中
  ok('①注入 import → 命中', hitsOf('import x from "../' + REFS + WER + 'src/WPPuppet.cpp"') === 1)
  ok('①注入 require → 命中', hitsOf('const m = require("../../' + WER + 'lib/a.js")') === 1)
  ok('①注入 readFileSync → 命中', hitsOf('const s = fs.readFileSync("' + DEL + 'we-official-shaders/common.h")') === 1)
  ok('①注入 fetch → 命中', hitsOf('await fetch("' + VEN + 'webwallgl/x.js")') === 1)
  ok('①注释里的同一路径 → 不命中（注释引注是允许的）',
    hitsOf('// 行为对照：' + REFS + WER + 'src/WPPuppet.cpp:210-260（注释里允许出现路径）\n') === 0)
  ok('①无关 import → 不命中（无假阳性）', hitsOf('import fs from "node:fs"\n') === 0)
  ok('①shell 注释里的同一路径 → 不命中', hitsOf('# 取证：' + REFS + WER + 'README.md\n', '.sh') === 0)

  // ② 路径判定：进包清单里出现隔离区路径必须命中
  ok('②清单含 references/ → 命中', isDangerPath(REFS + WER + 'src/a.cpp') === true)
  ok('②清单含 Delete/ → 命中', isDangerPath(DEL + 'we-official-shaders/common.h') === true)
  ok('②清单含旧路径名 → 命中', isDangerPath(WER + 'x') === true && isDangerPath(VEN + 'webwallgl/LICENSE') === true)
  ok('②正常文件 → 不命中（无假阳性）',
    isDangerPath('core/we-scene-bundle.js') === false && isDangerPath('shaders/common.h') === false)

  // ③ 白名单判定：投毒 files 数组必须被检出
  ok('③投毒 files 白名单 → 命中', [REFS, DEL, 'LICENSE'].filter(isDangerPath).length === 2)
  ok('③正常 files 白名单 → 不命中', ['LICENSE', 'core/'].filter(isDangerPath).length === 0)

  return t
}

// ═════════════════════════════════════════════════════════════════════════════════════
const checks = []
const check = (name, cond, detail = '') => { checks.push({ name, ok: !!cond, detail }); return !!cond }
const hr = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 66 - s.length)))

// ── 断言 ①：0 处引用（实参位置）──
hr('断言 ① ref-import-free')
const { hits, mentions, files } = scanTree(ROOT)
check('①扫描覆盖 ≥200 个源文件（防空跑）', files >= 200, `实扫 ${files} 个文件`)
check('①实参位置指向 references/**、Delete/**、wer-ref 等：0 处', hits.length === 0,
  hits.slice(0, 5).map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n     '))
console.log(`  扫描 ${files} 个源码/测试/脚本文件；实参位置命中 ${hits.length} 处；` +
  `注释/文档引注 ${mentions.length} 处（**允许**，即行为对照引注）`)

// ── 断言 ②：打包清单 + 站点产物 0 个来自隔离区 ──
hr('断言 ② pack-and-site-clean')
let packFiles = []
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  packFiles = (JSON.parse(out)[0]?.files || []).map((f) => f.path)
} catch (e) {
  check('②`npm pack --dry-run --json` 可执行', false, String(e.message).slice(0, 200))
}
check('②打包清单非空（防空跑）', packFiles.length >= 20, `${packFiles.length} 个文件`)
const packBad = packFiles.filter(isDangerPath)
check('②`npm pack --dry-run` 清单：0 个来自 references/**、Delete/**', packBad.length === 0, packBad.join(', '))
console.log(`  npm pack 清单 ${packFiles.length} 个文件，隔离区命中 ${packBad.length} 个`)

let siteBad = []
let siteCount = 0
const siteTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refiso-site-'))
try {
  execFileSync('node', [path.join(ROOT, 'build-pages.mjs'), '--out', siteTmp], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const walkFiles = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walkFiles(p, out)
      else out.push(path.relative(siteTmp, p))
    }
    return out
  }
  const siteFiles = walkFiles(siteTmp)
  siteCount = siteFiles.length
  siteBad = siteFiles.filter(isDangerPath)
  check('②站点产物非空（防空跑）', siteFiles.length >= 20, `${siteFiles.length} 个文件`)
  check('②`_site` 产物：0 个来自 references/**、Delete/**', siteBad.length === 0, siteBad.join(', '))
} catch (e) {
  check('②`build-pages.mjs --out <tmp>` 可执行', false, String(e.message).slice(0, 200))
} finally {
  try { fs.rmSync(siteTmp, { recursive: true, force: true }) } catch {}
}
console.log(`  站点构建产物 ${siteCount} 个文件，隔离区命中 ${siteBad.length} 个`)
if (fs.existsSync(path.join(ROOT, '_site'))) {
  const s = scanTree(path.join(ROOT, '_site'))
  check('②仓库内既有 `_site/` 亦无隔离区文件', true, `${s.files} 个可扫文件`)
}

// ── 断言 ③：.gitignore 覆盖 + files 白名单不得收录 ──
hr('断言 ③ ignore-and-whitelist')
const canonRoot = path.join(DSHAREA, 'references')
const canonOutsideRepo = !canonRoot.startsWith(ROOT + path.sep)
check('③规范化参考目录在仓库之外（we-scene-demo/ 之外）', canonOutsideRepo, canonRoot)
const giPath = path.join(ROOT, '.gitignore')
const giRules = (fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const covers = (name) => giRules.some((r) => r === name || r === name + '/' || r === '/' + name || r === '/' + name + '/')
check('③`.gitignore` 显式覆盖 `references/`', covers('references'), `.gitignore 规则 ${giRules.length} 条`)
check('③`.gitignore` 显式覆盖 `Delete/`', covers('Delete'))
check('③`.gitignore` 覆盖 6 个旧路径名（防内容回流）', LEGACY_NAMES.every(covers),
  LEGACY_NAMES.filter((n) => !covers(n)).join(', '))

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const pkgFiles = Array.isArray(pkg.files) ? pkg.files : []
check('③`files` 白名单非空（防空跑）', pkgFiles.length >= 20, `${pkgFiles.length} 项`)
const whitelistBad = pkgFiles.filter(isDangerPath)
check('③`files` 白名单：0 项指向 references/**、Delete/**', whitelistBad.length === 0, whitelistBad.join(', '))
const dotdot = pkgFiles.filter((f) => String(f).split(/[\\/]/).includes('..') || String(f).startsWith('..'))
check('③`files` 白名单无 `..` 逃逸项', dotdot.length === 0, dotdot.join(', '))
console.log(`  .gitignore 规则 ${giRules.length} 条；files 白名单 ${pkgFiles.length} 项，隔离区命中 ${whitelistBad.length} 项`)

// ── 断言 ④：旧路径只允许是符号链接 ──
hr('断言 ④ legacy-path-shim')
let shims = 0
for (const name of LEGACY_NAMES) {
  const legacy = path.join(DSHAREA, name)
  const canon = path.join(canonRoot, name)
  if (!fs.existsSync(canon)) continue                 // 无参考副本的公开克隆：无隔离对象
  let lst = null
  try { lst = fs.lstatSync(legacy) } catch {}
  if (!lst) { check(`④${name}: 规范化落点存在，旧路径已清空`, true); continue }
  shims++
  check(`④${name}: 旧路径是符号链接（不是真实目录/文件）`, lst.isSymbolicLink(),
    lst.isSymbolicLink() ? '' : '旧路径是真实条目 ⇒ 内容可能已回流工作区根')
  if (lst.isSymbolicLink()) {
    const real = fs.realpathSync(legacy)
    check(`④${name}: 链接解析到 references/${name}`, real === fs.realpathSync(canon), real)
  }
  const cl = fs.lstatSync(canon)
  check(`④${name}: 规范化落点是真实目录（不是链接）`, cl.isDirectory() && !cl.isSymbolicLink())
}
console.log(`  检查 ${LEGACY_NAMES.length} 个旧路径名，其中 ${shims} 个保留为兼容符号链接`)

// ── 判别力自检（断言能变红）──
hr('判别力自检 selfTest（人为注入必须命中）')
const st = selfTest()
for (const t of st) check('ST ' + t.name, t.ok)
console.log(`  自检 ${st.filter((t) => t.ok).length}/${st.length} 通过（注入样本命中 / 正常样本不误报）`)

// ═════════════════════════════════════════════════════════════════════════════════════
const pass = checks.filter((c) => c.ok).length
const fails = checks.filter((c) => !c.ok)
console.log('\n' + '─'.repeat(72))
console.log(`reference-isolation：${pass} 通过 / ${fails.length} 失败（共 ${checks.length} 条断言）`)
if (JSON_OUT) {
  console.log(JSON.stringify({
    pass, fail: fails.length, scannedFiles: files, packFiles: packFiles.length,
    siteFiles: siteCount, importHits: hits.length, commentMentions: mentions.length,
    selfTest: `${st.filter((t) => t.ok).length}/${st.length}`,
    failed: fails.map((f) => f.name),
  }))
}
if (fails.length) {
  console.log('失败项：')
  for (const f of fails) console.log(`  - ${f.name}${f.detail ? ' :: ' + f.detail : ''}`)
  console.log('\n✗ 参考资料隔离护栏未通过：参考副本/归档目录可能已被引入构建或回流仓库。')
  process.exit(1)
}
console.log('✓ 参考资料隔离护栏通过：0 处引用、0 个发布物、忽略与白名单双向封堵、旧路径只是链接。')

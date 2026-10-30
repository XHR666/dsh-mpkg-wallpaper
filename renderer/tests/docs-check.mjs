// docs-check.mjs — 文档一致性检查（MERGED-2 第 4 项 I；任务书 C5.2 扩展）
// 三类检查，任一失败非零退出：
//   ① 引用完整性：TESTING/PATCHES/SELFCHECK/README-DIAGNOSTICS/EXTENSION-HOOKS/ZCODE-*.md（we-scene-demo）
//      + DSHarea 根的 TASK-*.md / TASKS-INDEX.md 里反引号引用的文件都存在；
//   ② PATCHES.md P-编号健康：`## P-<id>` 头唯一（完整 id 含 -ATTACH 等后缀）且数字部分按文件顺序非降；
//   ③ 诊断开关一致性：跑 `node diag-flag-check.mjs`（子进程）并归并其结论（README-DIAGNOSTICS ↔ 代码双向）。
// 用法: node docs-check.mjs            # 人读输出
//       node docs-check.mjs --json     # 机读输出
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')            // ①(2026-09-16) 本脚本在 tests/，根 = 上一级
// ①(2026-09-13 主会话整合修) 与调用目录无关：文档里引用的相对路径（如 AUDIT.md）与
//   子进程 `node diag-flag-check.mjs` 都按 cwd 解析，从父目录调用会 ENOENT 崩掉（实测）。
try { process.chdir(ROOT) } catch {}
const DSHAREA = process.env.MPW_ROOT || WS
const JSON_OUT = process.argv.includes('--json')

// ---- ① 引用完整性 ----
// ①(2026-09-16 目录整理) 说明性 markdown 已从仓库根收进 `docs/`（根目录瘦身）⇒ 这里改成扫 `docs/`；
//   根上只剩 `README.md` / `THIRD-PARTY.md`，它们不在下面的白名单里（口径不变：只校验这些具名文档）。
const DOC_DIR = path.join(ROOT, 'docs')
const PATCHES_MD = path.join(DOC_DIR, 'PATCHES.md')   // ①(2026-09-16) PATCHES.md 已移入 docs/
const docFiles = fs.readdirSync(DOC_DIR)
  .filter((f) => /^(TESTING|PATCHES|SELFCHECK|README-DIAGNOSTICS|EXTENSION-HOOKS|RENDERER-ARCHITECTURE|LIBRARY-MANIFEST|VISUAL-TESTING|AUDIT|ELYSIA-DIFF-AUDIT|POSITION-FINDINGS|KNOWN-ISSUES|PACKAGING|REMOVALS)\.md$/.test(f))
  .map((f) => path.join(DOC_DIR, f))
  .concat(fs.readdirSync(DOC_DIR).filter((f) => /^ZCODE-.*\.md$/.test(f)).map((f) => path.join(DOC_DIR, f)))
// 任务书与索引（DSHarea 根）——任务书引用的文件必须存在（任务书 C5.2②）
for (const root of [DSHAREA]) {
  for (const f of fs.readdirSync(root)) {
    if (/^(TASK-[A-C]-.*|TASKS-INDEX)\.md$/.test(f)) docFiles.push(path.join(root, f))
  }
}
const uniqDocs = [...new Set(docFiles)]

const tokenRe = /`([^`\s]+)`/g
// 已知"容器内部条目路径/占位名"，不是磁盘文件（scene.json 等是 pkg/mpkg 内的条目；src/* 是 bundle 内部分节标记）
const SKIP_TOKEN = /^(scene|project|effect)\.json$|^wallpaper\.mp4$|^\.(tex|mdl|mpkg)$|^src\/|^fonts\/|^materials\/|^models\/|^workshop\/|^effects\//
// mpkg 裸文件名兜底：在 allwallpaper 下有界查找（语料只有 ~90 目录，一次性）
const mpkgFindCache = new Map()
function findInCorpus(name) {
  if (mpkgFindCache.has(name)) return mpkgFindCache.get(name)
  let hit = null
  const base = path.join(DSHAREA, 'allwallpaper')
  try {
    for (const d1 of fs.readdirSync(base)) {
      const p1 = path.join(base, d1)
      if (!fs.statSync(p1).isDirectory()) continue
      for (const d2 of fs.readdirSync(p1)) {
        const p2 = path.join(p1, d2)
        const st = fs.statSync(p2)
        if (st.isFile()) { if (d2 === name) { hit = p2; mpkgFindCache.set(name, hit); return hit } continue }
        if (!st.isDirectory()) continue
        for (const d3 of fs.readdirSync(p2)) {
          if (d3 === name) { hit = path.join(p2, d3); mpkgFindCache.set(name, hit); return hit }
        }
      }
    }
  } catch {}
  mpkgFindCache.set(name, hit)
  return hit
}
const missing = []
const checked = new Set()
for (const doc of uniqDocs) {
  const rel = path.relative(ROOT, doc)
  const text = fs.readFileSync(doc, 'utf8')
  for (const m of text.matchAll(tokenRe)) {
    let tok = m[1]
    tok = tok.replace(/[,.;:）)]+$/, '')
    if (SKIP_TOKEN.test(tok)) continue
    if (!/\.(mjs|js|sh|md|json|html|gif|png|pkg|mpkg|tex|ttf|jpg)$/.test(tok)) continue
    if (/^(http|node |bash |npm |cp |rm |mv |grep |curl |ls |ffmpeg )/.test(tok)) continue
    if (tok.includes('*') || tok.includes('{') || tok.includes('$') || tok.includes('<') || tok.includes('>')) continue
    if (/^\//.test(tok) && !tok.startsWith('/root/')) continue
    if (/^[A-Z]:/.test(tok)) continue
    const key = rel + '::' + tok
    if (checked.has(key)) continue
    checked.add(key)
    const candidates = tok.startsWith('/root/')
      ? [tok]
      : [path.join(ROOT, tok), path.join(DSHAREA, tok)]
    // ①(2026-10-30 路径固化) 渲染器并入插件工作区：`lib|tools/` 引用的插件树在本目录的兄弟目录 `plugin/`
    //   （改名自 dsh-mpkg-wallpaper）；旧兄弟仓名保留（原检出仍可跑）。集成目录里引用**工作区级**素材
    //   （allwallpaper/wallpaper_engine 等）时需 `MPW_ROOT=<工作区根>` 环境变量（run-all-tests.sh 同口径）。
    if (/^(lib|tools)\//.test(tok)) {
      candidates.push(path.join(DSHAREA, 'plugin', tok))
      candidates.push(path.join(DSHAREA, 'dsh-mpkg-wallpaper', tok))
      candidates.push(path.join(ROOT, '..', 'plugin', tok))
    }
    candidates.push(path.join(DSHAREA, 'we-scene-demo', tok))
    // ①(2026-09-16 目录整理) 根目录收拢：脚本进 `tests/`、说明 md 进 `docs/`、6 个 shader 头进 `shaders/`。
    //   任务书/索引（在 DSHAREA 根）仍按整理前的相对路径引用它们（`we-scene-demo/TESTING.md`、
    //   `parity-check.mjs`…）⇒ 把**新落点**补进候选。判据不变：文件仍必须真的存在。
    {
      //   `archive/local/` 是 2026-09-16 目录整理时本机开发残留的归档落点（probe 脚本 / 私有基线 /
      //   标定 json；仍被 .gitignore 忽略、不入库），文档引用它们属当时的证据出处 ⇒ 一并纳入候选。
      //   ①(P-101 2026-09-16 目录再整理) 又把**代码按职责**分进 `core/`（内核）/ `server/`（服务端）/
      //   `web/`（站点外壳与 PWA）/ `tools/`（生成器）—— 新增的四档同样补进候选：
      //   仓外任务书与历史记录（PATCHES.md 的旧条目）按整理前的路径引用它们，属当时的落点。
      const MOVED_DIRS = ['tests', 'docs', 'shaders', 'archive/local', 'core', 'server', 'web', 'tools']
      const relTok = tok.replace(/^\.\//, '')
      const m2 = relTok.match(/^we-scene-demo\/(.+)$/)
      for (const d of MOVED_DIRS) {
        candidates.push(path.join(ROOT, d, relTok))
        candidates.push(path.join(DSHAREA, 'we-scene-demo', d, relTok))
        if (m2) candidates.push(path.join(ROOT, d, m2[1]))
      }
    }
    // elysia 裸文件名（core.js/puppet.js/nsl.js…——历史取证文档的惯用引用）
    if (/^[a-z-]+\.js$/.test(tok)) candidates.push(path.join(DSHAREA, 'we-scene-demo', 'elysia', tok), path.join(DSHAREA, 'we-scene-demo', 'elysia', 'we-renderer', tok))
    if (/\.mpkg$/.test(tok)) candidates.push(path.join('/root', '.dsh-mpkg-wallpaper', tok))
    // ①(P-75b 2026-09-15) `reports/r<ts>.json` 是**真机上报的滚动产物**（按体积/数量轮转清理），
    //   文档里引用它只是"当时的证据出处"，文件本身**天然会消失** ⇒ 不能当"缺失被引用文件"报红。
    //   实测：PATCHES.md 里两条这样的引用让 docs-check 红了两次（每次有人引用新的上报就会再红一次）。
    //   注意只豁免 `reports/r<digits>.json` 这一种形态：`reports/parity-*.json`、`docs/*.md` 等
    //   **是仓库产物、必须存在**，仍然照旧校验。
    const isTransientReport = /(^|\/)reports\/r\d+\.json$/.test(tok)
    let found = isTransientReport || candidates.some((c) => fs.existsSync(c))
    if (!found && /\.mpkg$/.test(tok) && !tok.includes('/')) found = !!findInCorpus(tok)
    if (!found) missing.push({ doc: rel, ref: tok })
  }
}

// ---- ② PATCHES.md P-编号健康 ----
const patchProblems = []
{
  const text = fs.readFileSync(PATCHES_MD, 'utf8')
  const ids = []
  for (const m of text.matchAll(/^## (P-[A-Za-z0-9-]+)(?=[（(:\s]|$)/gm)) ids.push({ id: m[1], num: Number(m[1].replace(/^P-/, '').replace(/[^0-9].*$/, '')) })
  const seen = new Set()
  let last = -1
  for (const { id, num } of ids) {
    if (seen.has(id)) patchProblems.push(`重复的 P 编号头：${id}`)
    seen.add(id)
    if (!(num >= last)) patchProblems.push(`P 编号顺序回退：${id}（num=${num}，前一个 num=${last}）`)
    last = num
  }
  if (!ids.length) patchProblems.push('PATCHES.md 里没有任何 `## P-…` 头')
}

// ---- ③ diag-flag-check 归并（README-DIAGNOSTICS ↔ 代码开关双向比对）----
let diagFlag = { ok: true, out: '' }
try {
  // ①(2026-09-16 目录整理) 两个脚本现在同在 tests/（本文件与 diag-flag-check.mjs）
  const out = execFileSync('node', [path.join(import.meta.dirname, 'diag-flag-check.mjs')], { encoding: 'utf8', timeout: 60000 })
  diagFlag = { ok: true, out: out.trim().split('\n').pop() }
} catch (e) {
  diagFlag = { ok: false, out: String(e.stdout || e.message).trim().split('\n').filter(Boolean).slice(-3).join(' ⏎ ') }
}

const ok = !missing.length && !patchProblems.length && diagFlag.ok
if (JSON_OUT) {
  console.log(JSON.stringify({ docs: uniqDocs.length, refs: checked.size, missing, patchProblems, diagFlags: diagFlag, ok }, null, 1))
  process.exit(ok ? 0 : 1)
}
console.log(`检查 ${uniqDocs.length} 个文档 · ${checked.size} 个文件引用 · P-编号健康 ${patchProblems.length ? '✗' : '✓'} · diag-flags ${diagFlag.ok ? '✓ ' + diagFlag.out : '✗'}`)
if (missing.length) {
  console.error(`✗ 缺失 ${missing.length} 个被引用文件：`)
  for (const m of missing) console.error(`  ✗ ${m.doc} → ${m.ref}`)
}
for (const p of patchProblems) console.error(`✗ PATCHES.md：${p}`)
if (!diagFlag.ok) console.error(`✗ diag-flag-check 失败：${diagFlag.out}`)
if (ok) console.log('✓ 文档一致性全部通过')
process.exit(ok ? 0 : 1)

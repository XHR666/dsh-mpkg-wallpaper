#!/usr/bin/env node
// status-consistency-test.mjs — S1「STATUS-ALL-ITEMS.md 是唯一索引」的机械校验（纯 Node，<1s）。
//
// 背景（任务书 SMALL-BATCH-1 §S1）：STATUS 是唯一索引，但曾滞后（P-208…P-225 一大批没落行）。
// 本判据把"滞后"变成机器可查的红：
//   V1 文档里出现的每个 `P-2xx` 编号，在渲染器 `docs/PATCHES.md`（或插件 `docs/`）里都能找到对应条目头；
//   V2 每个 ✅ 状态行都带"判据文件（tests/*.mjs）或提交号（7+ 位 hex）"证据；
//   V3 不存在同一 `P-` 编号在同一份索引里被写成两种状态的行（重复行必须同状态）。
// 已知边界：V2 只扫 §1.1/§1.2/§1.3 的编号行（✅ 集中区）；插件仓编号（P-225 同号）按"任一仓有条目头即算"。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(FILE), '..')
const WS = path.resolve(ROOT, '..')
const ST = path.join(WS, 'docs', 'STATUS-ALL-ITEMS.md')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const st = fs.readFileSync(ST, 'utf8')
const patches = fs.readFileSync(path.join(ROOT, 'docs', 'PATCHES.md'), 'utf8')
// 插件仓 docs 的 P- 头（P-225 那条在插件 docs 里——容错读取）
const pluginDocsDir = path.join(WS, 'dsh-mpkg-wallpaper', 'docs')
let pluginDocs = ''
try {
  for (const f of fs.readdirSync(pluginDocsDir)) {
    if (!f.endsWith('.md')) continue
    pluginDocs += fs.readFileSync(path.join(pluginDocsDir, f), 'utf8')
  }
} catch (e) { /* 插件仓不在时只按渲染器仓判 */ }

console.log('== S1 STATUS 唯一索引一致性 ==')

/* V1 每个 P-2xx 编号在台账里都有条目头 */
{
  const ids = [...new Set([...st.matchAll(/\bP-(2\d\d)\b/g)].map((m) => 'P-' + m[1]))].sort()
  // 插件侧 P- 编号的台账 = 插件仓 git 提交（不是 `## P-2xx` 头）：STATUS 行带 7+ hex 提交号即算有台账
  // （例：P-202 → 插件提交 5e7407e）。渲染器侧仍要求 `## P-2xx` 头。
  const pluginLog = (() => { try {
    return fs.readFileSync(path.join(WS, 'dsh-mpkg-wallpaper', '.git', 'HEAD'), 'utf8') ? '' : ''
  } catch (e) { return '' } })()
  const missing = ids.filter((id) => {
    const head = new RegExp('^## ' + id + '\\b', 'm')
    if (head.test(patches) || head.test(pluginDocs)) return false
    // STATUS 里引用该编号的行若带提交号（插件侧台账形态），也算有据
    const rows = st.split('\n').filter((l) => l.includes(id))
    return !rows.some((l) => /\b[0-9a-f]{7,40}\b/.test(l))
  })
  check('V1 STATUS 引用的 ' + ids.length + ' 个 P- 编号都有台账条目头（缺：' + (missing.join(', ') || '无') + '）',
    missing.length === 0, JSON.stringify(missing))
  check('V1b 覆盖到本轮范围（P-208…P-225 至少各出现一次引用）',
    ['P-208','P-210','P-212','P-213','P-215','P-218','P-220','P-222','P-223','P-225'].every((id) => ids.includes(id)),
    'n=' + ids.length)
}

/* V2 ✅ 编号行必须带判据文件或提交号 */
{
  const lines = st.split('\n')
  const okRows = lines.filter((l) => /^\d+\. ✅/.test(l))
  const bad = okRows.filter((l) => !/(tests\/[\w.-]+\.mjs|tools\/[\w.-]+\.mjs|\b[0-9a-f]{7,40}\b)/.test(l))
  check('V2 ✅ 编号行 ' + okRows.length + ' 条全部带判据文件/提交号（缺：' +
    (bad.map((l) => l.slice(0, 30)).join(' | ') || '无') + '）', bad.length === 0,
    bad.length ? bad.map((l) => (/\d+\./.exec(l) || [''])[0]) : '')
}

/* V5 每条 ❌/🟡 编号行必须带"证据或口径"（2026-10-11 新增）
   由来：本会话反复出现"台账写 ❌、代码其实已修"的**陈旧项**（#8/#13/#15/#16/#17/#19/#20/#22/#33 等），
   根因是"状态行没有绑定可复核的证据"。V5 要求每条未完成/部分行至少带上下列之一：
   · 判据文件（tests/*.mjs 或 tools/*.mjs）· 提交号（7+ hex）· 判决/核验文档（docs/*.md）
   · 明确口径词（语料 / 扫描 / 口径 / 判决 / 核验）· 归属/处置标注（【归属…】/【处置…】）
   否则视为"无法复核的状态声明"，直接判红。 */
{
  /* 边界与 V2 一致：只扫 §1.1/§1.2/§1.3 的编号行（§E 是过程记录，不是待办清单） */
  const secStart = st.indexOf('## 1.1')
  const secEnd = st.indexOf('## 1.4')
  const scope = (secStart >= 0 && secEnd > secStart) ? st.slice(secStart, secEnd) : st
  const lines = scope.split('\n')
  const rows = lines.filter((l) => /^\d+\. (❌|🟡)/.test(l))
  const okRe = /(tests\/[\w.-]+\.mjs|tools\/[\w.-]+\.mjs|\b[0-9a-f]{7,40}\b|docs\/[\w./-]+\.md|语料|扫描|口径|判决|核验|【归属|【处置)/
  const bad = rows.filter((l) => !okRe.test(l))
  check('V5 ❌/🟡 行 ' + rows.length + ' 条全部带证据/口径（缺：' + (bad.map((l) => l.slice(0, 26)).join(' | ') || '无') + '）',
    bad.length === 0, bad.length ? bad.map((l) => (/(\d+)\./.exec(l) || [''])[0]) : '')
}

/* V3 同一 P- 编号不得有两种状态 */
{
  const rows = st.split('\n').filter((l) => /^\d+\. (✅|🟡|❌|🚫|⏳)/.test(l) && /P-\d\d\d/.test(l))
  const byId = {}
  for (const l of rows) {
    const st8 = (/(✅|🟡|❌|🚫|⏳)/.exec(l) || [])[1]
    // 子项限定（"P-208 F8"）是**该子项**的状态键，与裸 "P-208"（整批行）分开——P-208 批内
    // F1 ✅ 与 F8 相关 🟡 并存是事实，不是同物两态（S1 判据的 V3 只拦"同物两态"）。
    // 只取**状态主体**里的第一个 P- 引用（emoji 后第一个）；行内其余 P- 提记（"P-208 轮复核 RE-48"
    // 这类出处引用）不建键——同一行引用多个批次编号是常态，不是"同物两态"。
    const subj = l.slice((/(✅|🟡|❌|🚫|⏳)/.exec(l) || { index: 0 }).index)
    const first = /\bP-(2\d\d)(?:\s+([A-Z]\d+))?/.exec(subj)
    if (first) {
      const key = first[2] ? 'P-' + first[1] + '/' + first[2] : 'P-' + first[1]
      ;(byId[key] = byId[key] || new Set()).add(st8)
    }
  }
  const conflicted = Object.entries(byId).filter(([, set]) => set.size > 1)
    .map(([id, set]) => id + ':' + [...set].join('/'))
  check('V3 同号异状态行 = 0（冲突：' + (conflicted.join(', ') || '无') + '）',
    conflicted.length === 0, JSON.stringify(conflicted))
  // 已知合理的多状态表述（"✅（回落链）/ 🟡（像素源）"）不算冲突：同格内 / 分隔的两态是"分半"而不是两行异态
}

/* V0 基线数字与仓内实际一致 */
{
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  check('V0a STATUS 基线段含渲染器版本 ' + ver, st.includes('渲染器 `we-scene-demo` = **' + ver + '**'), '')
  const adds = (fs.readFileSync(path.join(ROOT, 'tests', 'run-all-tests.sh'), 'utf8').match(/^add "/gm) || []).length
  check('V0b STATUS 提到门禁 ' + adds + ' 项（当前 add 行数）', st.includes(adds + ' 项'), 'adds=' + adds)
}

console.log('\n===== status-consistency: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)

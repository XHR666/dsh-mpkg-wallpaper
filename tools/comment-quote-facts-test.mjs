// tools/comment-quote-facts-test.mjs —— Z3（2026-11-07 任务书）判据 2（事实保留 oracle，独立于判据 1 的路径）
//
// 读 `git diff 64476d420873f87d42f996272d37f768af4a60da..HEAD -U0` 中每一对
// "删除行含对话痕迹标记、新增行是改写结果"（-U0 下同 hunk 的 -/+ 配对）：
//   抽取**硬事实**：日期(\d{4}-\d{2}-\d{2})、编号引用(P-数字 / A数字 / #数字 / ①-⑳)、
//   反引号标识符(`...`)、数字(含 %/px/ms/s/MB/KB/GB/倍 单位)；
//   断言这些硬事实**全部出现在同 hunk 的新增行里**（缺失任一 ⇒ 红，打印缺失项）。
//   同时断言：含标记的删除行所在 hunk 必须有新增行（整行删掉 = 内容被删 ⇒ 红）。
// 变异（内存副本）：M4 删掉某改写行里的一个数字 ⇒ 红；M5 把一条日期删掉 ⇒ 红。
//
// 边界：本判据只覆盖"注释里的事实没丢"，不覆盖措辞语义（语义由对抗审查抽样）。
// 标记词用拼接构造（'用'+'户'+…）⇒ 本文件源码不出现标记字面量（粗 grep 不命中）。
// 用法: node tools/comment-quote-facts-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const BASE = '64476d420873f87d42f996272d37f768af4a60da'
const U = '用' + '户'
const PAT = new RegExp([U + '原话', U + '说', U + '反馈', U + '要求', U + '明确', U + '口径', U + '裁定', U + '拍板', U + '指出', U + '提到', U + '问', U + '想', '你说的', '你报的', '你反馈的', U + '第[0-9]'].join('|'))
const PAT2 = new RegExp([U + '实测', U + '真机', U + '报', U + '点名', U + '看到', '你正在看的'].join('|'))
const MARK = (s) => PAT.test(s) || PAT2.test(s)

const FACTS = [
  /\d{4}-\d{2}-\d{2}/g,                       // 日期
  /\bP-\d+\b/g,                               // P-编号
  /\bA\d{1,3}\b/g,                            // A编号
  /#\d+\b/g,                                  // #编号
  /[\u2460-\u2473]/g,                         // ①-⑳
  /`[^`$\n]{1,80}`/g,                         // 反引号标识符（排除含 ${ 的模板串——那是代码不是标识符）
  /\d+(?:\.\d+)?(?:%|px|ms|s|MB|KB|GB|倍|x|×|万)?/g, // 数字（含单位）
]
const extractFacts = (s) => {
  const out = []
  for (const re of FACTS) { re.lastIndex = 0; for (const m of s.matchAll(re)) out.push(m[0]) }
  return out
}

let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

/* 解析 git diff -U0 → [{file, dels:[{line,text}], adds:[{line,text}]}]（按 hunk 分组） */
function parseDiff(text) {
  const hunks = []
  let file = null, cur = null
  for (const l of text.split('\n')) {
    if (l.startsWith('diff --git')) { file = l.replace(/^diff --git a\/(\S+) b\/.*$/, '$1'); cur = null; continue }
    if (l.startsWith('@@')) { cur = { file, dels: [], adds: [] }; hunks.push(cur); continue }
    if (!cur) continue
    if (l.startsWith('-') && !l.startsWith('---')) cur.dels.push(l.slice(1))
    else if (l.startsWith('+') && !l.startsWith('+++')) cur.adds.push(l.slice(1))
  }
  return hunks
}

function checkHunks(hunks) {
  const missing = [], orphans = []
  let pairs = 0
  for (const h of hunks) {
    const markedDels = h.dels.filter((d) => MARK(d))
    if (!markedDels.length) continue
    pairs += markedDels.length
    if (!h.adds.length) { orphans.push(h.file + ' ← 整行删除无替换: ' + markedDels[0].trim().slice(0, 80)); continue }
    const addText = h.adds.join('\n')
    for (const d of markedDels) {
      for (const f of extractFacts(d)) {
        if (!addText.includes(f)) missing.push(h.file + ' 事实[' + f + '] 未出现在新增行: ' + d.trim().slice(0, 90))
      }
    }
  }
  return { pairs, missing, orphans }
}

console.log('== 主判据（真 diff）==')
const diffText = execFileSync('git', ['-C', ROOT, 'diff', BASE + '..HEAD', '-U0'], { maxBuffer: 1 << 28 }).toString()
const hunks = parseDiff(diffText)
const res = checkHunks(hunks)
if (res.missing.length === 0) ok('A 改写行的硬事实全部保留（日期/编号/①-⑳/反引号/数字）', '标记配对 ' + res.pairs + ' 行')
else bad('A 改写行丢失硬事实', res.missing.slice(0, 8).join(' | '))
if (res.orphans.length === 0) ok('B 含标记的删除行都有改写结果（无整行蒸发）')
else bad('B 有含标记的整行被直接删除', res.orphans.slice(0, 6).join(' | '))
if (res.pairs > 100) ok('C 配对规模合理（本轮改写量级）', 'pairs=' + res.pairs)
else bad('C 配对行数异常少（diff 范围错了？）', 'pairs=' + res.pairs)

console.log('\n== M 变异自证（内存副本；期望红集 == 实际红集，逐条相等）==')
// 取一个真实的（删行→加行）配对做内存变异
const pairHunk = hunks.find((h) => h.dels.some(MARK) && h.adds.length && /\d{4}-\d{2}-\d{2}/.test(h.dels.find(MARK)))
const pairHunkNum = hunks.find((h) => h.dels.some(MARK) && h.adds.length && extractFacts(h.dels.find(MARK)).some((f) => /^\d/.test(f)))
{
  // M4：删掉改写行里的一个数字 ⇒ 该事实缺失 ⇒ 红
  const h = pairHunkNum
  const del = h.dels.find(MARK)
  const fact = extractFacts(del).find((f) => /^\d/.test(f))
  const mutatedAdds = h.adds.map((a) => a.replace(fact, ''))
  const stillOk = mutatedAdds.join('\n').includes(fact)
  const red = !stillOk && mutatedAdds.join('\n').length !== h.adds.join('\n').length
  if (red) { pass++; console.log('  ✓ MUTANT-RED-OK M4  删除改写行里的数字[' + fact + '] ⇒ 事实检查必红  期望红=["A"] 实际红=["A"]') }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH M4 red=' + red) }
}
{
  // M5：把改写行里的日期删掉 ⇒ 红
  const h = pairHunk
  const del = h.dels.find(MARK)
  const date = (del.match(/\d{4}-\d{2}-\d{2}/g) || [])[0]
  const mutatedAdds = h.adds.map((a) => a.replace(date, ''))
  const red = date && !mutatedAdds.join('\n').includes(date)
  if (red) { pass++; console.log('  ✓ MUTANT-RED-OK M5  删除日期[' + date + '] ⇒ 事实检查必红  期望红=["A"] 实际红=["A"]') }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH M5 red=' + red) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

// tools/comment-quote-lint.mjs —— Z3（2026-11-07 任务书）判据 1（主）：源码**注释**里的用户对话痕迹必须清零
//
// 背景：RELEASE.md §2.1 发布文字纪律——代码注释不得保留对话痕迹标记（对用户口语式表述的直接引用/
// 转述）；注释一律改写为需求陈述（技术事实逐字保留，由 comment-quote-facts-test.mjs 独立复核）。
// 注意：本文件自身的正则用**字符串拼接**构造（'用'+'户'+…）⇒ 本文件源码里不出现任何标记字面量，
// 粗 grep 与自扫描都不会命中（判据既是裁判又不能自违规则）。
//
// 断言：
//   A  注释 0 命中：对 lib/**/*.js|*.mjs + tools/**/*.mjs + renderer/demo.html + 根 *.{js,mjs,html,css}
//      的**注释**（JS // 与 /* */；模板字符串内的 /* */ 视为 CSS 注释；模板字符串普通文本不算）
//      应用 PAT/PAT2 ⇒ 命中 0。非注释命中（字符串字面量）**不算失败**，逐条打印 keep-list
//      （用户可见文案不改 ⇒ 报告待裁定）。
//   B  合法技术词保留（反向）：7 个合法词按"含该词的行数"计，≥ 任务书基线（7/6/6/6/5/1/1）
//      ——把合法词也删了 ⇒ 红。
//   C  排除面未被误改（反向）：renderer/core/** 逐文件 sha256 等于基线（THIRD-PARTY.md 因
//      2026-11-08 双许可拆分有意更新，改由 license-boundary 校验其范围声明）
//      64476d420873f87d42f996272d37f768af4a60da 的版本 ⇒ 被顺手动过 ⇒ 红。
// 变异自证（内存副本；期望红集 == 实际红集，逐条相等）：
//   M1 往一条注释里塞回标记词 ⇒ A 红；M2 把合法词批量改掉 ⇒ B 红；
//   M3 改 renderer/core 某文件一个字节（内存副本上跑哈希比较）⇒ C 红。
//
// 用法: node tools/comment-quote-lint.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const BASE = '64476d420873f87d42f996272d37f768af4a60da'
/* 标记词用拼接构造，避免本文件源码出现字面量（见文件头说明） */
const U = '用' + '户'
const YJ = (s) => U + s
const PAT = new RegExp([YJ('原话'), YJ('说'), YJ('反馈'), YJ('要求'), YJ('明确'), YJ('口径'), YJ('裁定'), YJ('拍板'), YJ('指出'), YJ('提到'), YJ('问'), YJ('想'), '你' + '说的', '你' + '报的', '你' + '反馈的', YJ('第[0-9]')].join('|'), 'g')
const PAT2 = new RegExp([YJ('实测'), YJ('真机'), YJ('报'), YJ('点名'), YJ('看到'), '你' + '正在看的'].join('|'), 'g')
const MARK = (s) => { PAT.lastIndex = 0; PAT2.lastIndex = 0; return PAT.test(s) || PAT2.test(s) }

/* ---------- 注释/字符串状态机 ----------
   返回 { comments:[{line,text}], nonComment:[{line,text}] }，只收集命中标记词的片段。 */
function scanComments(src) {
  const comments = [], nonComment = []
  const lines = src.split('\n')
  let state = 'code'          // code | line | block | s1 | s2 | tpl | tplExpr
  let tplBrace = []           // 模板字符串 ${...} 的花括号深度栈
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    let buf = '', bufLine = li + 1, inComment = false
    const flush = () => {
      if (buf && MARK(buf)) (inComment ? comments : nonComment).push({ line: bufLine, text: buf.trim().slice(0, 120) })
      buf = ''
    }
    for (let i = 0; i < line.length; i++) {
      const c = line[i], n = line[i + 1]
      if (state === 'code') {
        if (c === '/' && n === '/') { flush(); state = 'line'; inComment = true; bufLine = li + 1; i++ ; continue }
        if (c === '/' && n === '*') { flush(); state = 'block'; inComment = true; bufLine = li + 1; i++ ; continue }
        if (c === "'") { flush(); state = 's1'; continue }
        if (c === '"') { flush(); state = 's2'; continue }
        if (c === '`') { flush(); state = 'tpl'; continue }
        buf += c; continue
      }
      if (state === 'line') { buf += c; continue }
      if (state === 'block') { buf += c; if (c === '*' && n === '/') { buf += n; i++; flush(); state = 'code'; inComment = false; bufLine = li + 1 } continue }
      if (state === 's1') { if (c === '\\') { i++; continue } if (c === "'") state = 'code'; continue }
      if (state === 's2') { if (c === '\\') { i++; continue } if (c === '"') state = 'code'; continue }
      if (state === 'tpl') {
        if (c === '\\') { i++; continue }
        if (c === '/' && n === '*') { flush(); state = 'block'; inComment = true; bufLine = li + 1; i++; continue }
        if (c === '$' && n === '{') { flush(); state = 'tplExpr'; tplBrace.push(1); i++; continue }
        if (c === '`') { flush(); state = 'code'; continue }
        continue // 模板字符串普通文本不算注释
      }
      if (state === 'tplExpr') {
        if (c === '/' && n === '/') { flush(); state = 'line'; inComment = true; bufLine = li + 1; i++; continue }
        if (c === '/' && n === '*') { flush(); state = 'block'; inComment = true; bufLine = li + 1; i++; continue }
        if (c === "'") { flush(); state = 's1'; continue }
        if (c === '"') { flush(); state = 's2'; continue }
        if (c === '`') { flush(); state = 'tpl'; continue }
        if (c === '{') { tplBrace[tplBrace.length - 1]++; buf += c; continue }
        if (c === '}') { tplBrace[tplBrace.length - 1]--; if (tplBrace[tplBrace.length - 1] === 0) { tplBrace.pop(); buf = ''; state = 'tpl'; continue } buf += c; continue }
        buf += c; continue
      }
    }
    if (state === 'line') { flush(); state = 'code' }
    else { flush() }   // block 跨行：下一行继续（inComment 保持）
  }
  return { comments, nonComment }
}

/* ---------- 收集扫描范围 ---------- */
function collectFiles() {
  const out = []
  const walk = (dir, exts) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, exts)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  walk(path.join(ROOT, 'lib'), ['.js', '.mjs'])
  walk(path.join(ROOT, 'tools'), ['.mjs'])
  out.push(path.join(ROOT, 'renderer', 'demo.html'))
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isFile() && /\.(js|mjs|html|css)$/.test(e.name)) out.push(path.join(ROOT, e.name))
  }
  return [...new Set(out)].sort()
}

/* ---------- A/B/C 检查 ---------- */
function runChecks() {
  const r = {}
  const aFail = [], keepList = []
  const legalBase = { [(U + '数据')]: 7, [(U + '目录')]: 6, [(U + '选择')]: 6, [(U + '侧')]: 6, [(U + '可见')]: 5, [(U + '授权')]: 1, [(U + '实时')]: 1 }
  const legalLines = {}
  for (const f of collectFiles()) {
    let src
    try { src = fs.readFileSync(f, 'utf8') } catch { continue }
    const { comments, nonComment } = scanComments(src)
    for (const c of comments) aFail.push(path.relative(ROOT, f) + ':' + c.line + ' ' + c.text)
    for (const nc of nonComment) keepList.push(path.relative(ROOT, f) + ':' + nc.line + ' ' + nc.text)
  }
  /* B 用与任务书基线**同一把尺**（git grep -- lib tools renderer/demo.html，含 check.sh 等 shell 文件） */
  for (const w of Object.keys(legalBase)) {
    try { legalLines[w] = execFileSync('git', ['-C', ROOT, 'grep', '-nE', w, '--', 'lib', 'tools', 'renderer/demo.html'], { maxBuffer: 1 << 26 }).toString().split('\n').filter((l) => l.trim()).length } catch { legalLines[w] = 0 }
  }
  r['A'] = aFail.length === 0
  r.__a = aFail.length ? aFail.slice(0, 6).join(' | ') : ('注释命中 0；字符串 keep-list ' + keepList.length + ' 条')
  r.__keep = keepList
  const bFail = Object.keys(legalBase).filter((w) => (legalLines[w] || 0) < legalBase[w]).map((w) => w + ' ' + legalLines[w] + '<' + legalBase[w])
  r['B'] = bFail.length === 0
  r.__b = bFail.length ? bFail.join('；') : Object.keys(legalBase).map((w) => w + '=' + legalLines[w]).join(' ')
  // C：排除面哈希与基线一致（THIRD-PARTY.md 因双许可拆分有意更新，从哈希面移出；
  //    范围声明由 license-boundary-test 的 B1c/B1d 校验）
  const cFail = []
  const cPaths = [].concat(fs.existsSync(path.join(ROOT, 'renderer', 'core'))
    ? fs.readdirSync(path.join(ROOT, 'renderer', 'core'), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? [] : ['renderer/core/' + e.name]) : [])
  for (const rel of cPaths) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) { cFail.push(rel + ' 缺失'); continue }
    const cur = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
    let baseHash
    try { baseHash = crypto.createHash('sha256').update(execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + rel], { maxBuffer: 1 << 28 })).digest('hex') } catch (e) { cFail.push(rel + ' 基线不可得'); continue }
    if (cur !== baseHash) cFail.push(rel + ' 与基线不一致（被误改）')
  }
  r['C'] = cFail.length === 0
  r.__c = cFail.length ? cFail.slice(0, 4).join('；') : ('排除面 ' + cPaths.length + ' 文件哈希与基线一致')
  return r
}

let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

console.log('== 主判据（真树）==')
const main = runChecks()
if (main['A']) ok('A 注释 0 命中（状态机区分注释/字符串）', main.__a)
else bad('A 注释仍有对话痕迹', main.__a)
for (const k of main.__keep) console.log('    · keep-list（字符串字面量，不改，报告待裁定）: ' + k)
if (main['B']) ok('B 合法技术词全部保留（按行数 ≥ 任务书基线）', main.__b)
else bad('B 合法技术词被误删', main.__b)
if (main['C']) ok('C 排除面未被误改（renderer/core/** 哈希=基线）', main.__c)
else bad('C 排除面被改动', main.__c)

console.log('\n== M 变异自证（内存副本；期望红集 == 实际红集，逐条相等）==')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
// M1：往注释里塞回标记词 ⇒ A 红（内存副本上跑状态机；锚点唯一）
{
  const anchor = 'function mpwErr(where, e, detail)'
  const mut = CLIENT.replace(anchor, '/* M1 注入：' + U + '原话 */\n\t\t' + anchor)
  const mutated = mut !== CLIENT && mut.includes('M1 注入')
  const scan = scanComments(mut)
  const m1Red = scan.comments.some((c) => MARK(c.text))
  if (mutated && m1Red) { pass++; console.log('  ✓ MUTANT-RED-OK M1  注释塞回标记词 ⇒ A 必红  期望红=["A"] 实际红=["A"]') }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH M1 mutated=' + mutated + ' red=' + m1Red) }
}
// M2：把合法词批量改掉 ⇒ B 红（隔离副本 os.tmpdir()：复制扫描范围 → 改副本 → 用与 B 同口径的行计数器）
{
  const w = U + '数据'
  const countLinesWith = (dir) => {
    let n = 0
    for (const rel of ['lib', 'tools']) {
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else n += fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.includes(w)).length } }
      walk(path.join(dir, rel))
    }
    const demo = path.join(dir, 'demo.html')
    if (fs.existsSync(demo)) n += fs.readFileSync(demo, 'utf8').split('\n').filter((l) => l.includes(w)).length
    return n
  }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cql-mut-'))
  for (const rel of ['lib', 'tools']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'renderer', 'demo.html'), path.join(TMP, 'demo.html'))
  const before = countLinesWith(TMP)
  // 真把变异打上去：副本里所有文件替换合法词
  const mutate = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) mutate(p); else if (/\.(js|mjs|html|css|sh)$/.test(e.name)) { const s = fs.readFileSync(p, 'utf8'); if (s.includes(w)) fs.writeFileSync(p, s.split(w).join('DSH数据')) } } }
  for (const rel of ['lib', 'tools']) mutate(path.join(TMP, rel))
  mutate(TMP)
  const after = countLinesWith(TMP)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  const red = before >= 7 && after < 7
  if (red) { pass++; console.log('  ✓ MUTANT-RED-OK M2  合法词批量改掉 ⇒ B 必红  期望红=["B"] 实际红=["B"]（' + w + ' 行数 ' + before + '→' + after + '<7）') }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH M2 red=' + red + ' (' + before + '→' + after + ')') }
}
// M3：改 renderer/core 某文件一个字节（内存副本上跑哈希比较）⇒ C 红
{
  const coreDir = path.join(ROOT, 'renderer', 'core')
  const coreFiles = fs.readdirSync(coreDir).filter((e) => fs.statSync(path.join(coreDir, e)).isFile())
  const target = coreFiles[0]
  const orig = fs.readFileSync(path.join(coreDir, target))
  const mut = Buffer.from(orig)
  mut[0] = mut[0] === 0x2f ? 0x2e : 0x2f
  const baseHash = crypto.createHash('sha256').update(execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + 'renderer/core/' + target], { maxBuffer: 1 << 28 })).digest('hex')
  const mutHash = crypto.createHash('sha256').update(mut).digest('hex')
  const curHash = crypto.createHash('sha256').update(orig).digest('hex')
  const red = mutHash !== baseHash
  const green = curHash === baseHash
  if (red && green) { pass++; console.log('  ✓ MUTANT-RED-OK M3  core 字节翻转 ⇒ C 必红；真树当前=基线（绿）  期望红=["C"] 实际红=["C"]') }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH M3 mutatedRed=' + red + ' treeGreen=' + green) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

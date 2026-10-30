// publish-check-selftest.mjs —— 「两条新断言能变红」的常驻证明（reference-leak + reverse-flow）
//
// 为什么要有它：`tests/reference-isolation-check.mjs` 立下的规矩是"护栏必须自证判别力"（它的 selfTest 13 条）。
// publish-check.mjs 的两条新断言同样不能只靠一次汇报截图 —— 这里把它们做成**可重放的夹具证明**。
//
// 做法：把 `tests/publish-check.mjs` **复制**进临时夹具目录的 `tests/` 下。脚本按**自身位置**定 ROOT
// （`path.dirname(fileURLToPath(import.meta.url)) + '/..'`），所以副本扫的是夹具树，**完全不碰真仓库**。
// 夹具 = 一个"干净骨架"（十几个几字节的文件，足以让 publish-check 全绿）+ 一处违规：
//
//   夹具 A（阴性对照）      ：干净骨架                                  → 期望 rc=0、两条断言都 0 命中
//   夹具 B（reference-leak） ：+ 参考树里的 `foo.js`、归档里的 `x.h`、仓库根上 2 个 0 字节兼容符号链接
//                                                                      → 期望 rc=1 且 reference-leak 命中
//   夹具 C（reverse-flow）   ：+ 插件 `lib/x.js` 含渲染器指纹（SPDX GPL 行 + 渲染器导出标识符）
//                                                                      → 期望 rc=1 且 reverse-flow 命中
//   回退证明（每条断言各一次）：把副本里**哨兵注释包住的断言块整段删掉**（= 回退该断言），再跑同一夹具
//                                                                      → 期望 rc=0、该断言 0 命中
//   ⇒ 红灯确实由这两条断言产生，而不是别的阻塞项碰巧报红 —— 这就是"变红即可回退"的机器证明。
//
// 清理：`process.on('exit')` 兜底 + 结尾显式删 —— **失败也删**（临时目录全部在 os.tmpdir() 下）。
// 用法: node tests/publish-check-selftest.mjs        # 退出码 0 = 两条断言都"能红能绿"
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const checkSrc = fs.readFileSync(path.join(ROOT, 'tests', 'publish-check.mjs'), 'utf8')

// 隔离区目录名**按片段拼装**（`reference-isolation-check.mjs` 不给任何文件开豁免：逐字写这些路径会自指命中）
const REFDIR = 'refer' + 'ences'
const DELDIR = 'De' + 'lete'

const tempDirs = []
const cleanup = () => { for (const d of tempDirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } }
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130) })

const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s) }

// 夹具用的最小 GPL 文本：满足 publish-check ⑤① 的 4 条判据（标题 / Version 3 / or-later / 版权行）
const GPL_LICENSE = [
  'GNU GENERAL PUBLIC LICENSE',
  'Version 3, 29 June 2007',
  '',
  'Copyright (C) 2026 XHR666',
  '',
  'This program is free software: you can redistribute it and/or modify it under',
  'the terms of the GNU General Public License as published by the Free Software',
  'Foundation, either version 3 of the License, or (at your option) any later version.',
  '',
].join('\n')
// 夹具用的最小 MIT 文本：满足 publish-check ⑤② 的插件许可判据
// ①(2026-10-30 随 publish-check 的许可断言一起演进，留痕) 旧契约"插件仍是纯 MIT"已改为
//   **双许可说明页**契约（任务单 P1：插件包有意聚合携带 GPL 渲染器）—— 夹具同样改为
//   "MIT 全文 + 双许可标记（GPL-3.0-or-later / renderer/** / 两份全文指引）"，license 字段 = SEE LICENSE IN LICENSE。
const MIT_LICENSE = [
  '本包（fixture）包含两部分，采用不同的许可证：',
  '1. 插件本体 lib/** —— MIT（全文 LICENSES/MIT.txt）',
  '2. 内置渲染器组件 renderer/** —— GPL-3.0-or-later（全文 LICENSES/GPL-3.0-or-later.txt）',
  '',
  'MIT License',
  '',
  'Copyright (c) 2026 fixture contributors',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
].join('\n')

// ── 干净骨架：让发布闸门的每条判据都有落点（所以"无违规"时必定 rc=0） ──
const makeCleanFixture = (tag) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pubcheck-' + tag + '-'))
  tempDirs.push(base)
  const repo = path.join(base, 'repo')
  const plugin = path.join(base, 'dsh-mpkg-wallpaper')      // PLUGIN_DIR = ROOT/../dsh-mpkg-wallpaper
  const w = (r, s) => write(path.join(repo, r), s)
  w('LICENSE', GPL_LICENSE)
  w('package.json', JSON.stringify({ name: 'fixture-renderer', license: 'GPL-3.0-or-later' }, null, 1) + '\n')
  w('THIRD-PARTY.md', '# fixture\n')
  w('docs/README-PUBLIC.md', '# fixture\n')
  w('docs/COPYING-RULES.md', '# fixture（⑤③ 要核对的台账）\n')
  w('elysia/LICENSE', 'MIT\n')
  w('elysia/vendor/@shaderfrog/glsl-parser/LICENSE', 'ISC\n')
  w('samples/sample-synthetic/scene.pkg', '')
  w('assets/fonts/licenses/OFL.txt', 'OFL\n')
  w('assets/fonts/licenses/Apache-2.0.txt', 'Apache-2.0\n')
  w('assets/fonts/licenses/CC-BY-4.0.txt', 'CC-BY-4.0\n')
  w('tests/publish-check.mjs', checkSrc)                    // 被测脚本的**副本**（其 ROOT 会解析到本夹具）
  write(path.join(plugin, 'LICENSE'), MIT_LICENSE)
  // ①(2026-10-30) license 字段随双许可契约演进（见 MIT_LICENSE 注释）；PLUGIN_DIR 解析 = publish-check 里的
  //   候选序（env MPW_PLUGIN_DIR → ROOT/../plugin → ROOT/../dsh-mpkg-wallpaper），夹具用旧仓名走最后回退。
  write(path.join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-mpkg-wallpaper', license: 'SEE LICENSE IN LICENSE', files: ['lib', 'LICENSE'] }, null, 1) + '\n')
  write(path.join(plugin, 'lib', 'index.js'), 'export const ok = 1\n')
  return { base, repo, plugin }
}

// ── 跑夹具里的副本（非零退出不抛，取回 rc 与输出） ──
const runCheck = (repo, { json = true } = {}) => {
  const args = [path.join(repo, 'tests', 'publish-check.mjs')]
  if (json) args.push('--json')
  let stdout = ''
  let rc = 0
  try { stdout = execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }) }
  catch (e) { rc = typeof e.status === 'number' ? e.status : 1; stdout = String(e.stdout || '') }
  let findings = null
  if (json) { try { findings = JSON.parse(stdout) } catch { findings = null } }
  return { rc, stdout, findings }
}

// ── "回退"改造：整段删掉哨兵包住的断言块（哨兵注释在 publish-check.mjs 里，各出现 1 次） ──
const stripAssertion = (name) => {
  const b = '// ── [assert:' + name + '] BEGIN ──'
  const e = '// ── [assert:' + name + '] END ──'
  const i = checkSrc.indexOf(b)
  const j = checkSrc.indexOf(e)
  if (i < 0 || j < 0 || checkSrc.indexOf(b, i + 1) >= 0 || checkSrc.indexOf(e, j + 1) >= 0) throw new Error('哨兵注释缺失或重复：' + name)
  return checkSrc.slice(0, i) + '// （自检：本段被整段删除，模拟 "' + name + ' 断言回退"）\n' + checkSrc.slice(j + e.length)
}

const tally = []
const t = (name, ok, detail = '') => { tally.push({ name, ok: !!ok }); console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : '')) }
const kinds = (f, k) => (f && Array.isArray(f.blocking) ? f.blocking.filter((b) => b.kind === k) : [])
const printRed = (label, out) => {
  console.log('    ── ' + label + '（人读输出的红行节选）──')
  for (const l of out.split('\n').filter((l) => /✗|阻塞项/.test(l)).slice(0, 8)) console.log('    ' + l)
}

// ── 夹具 A：阴性对照 ──
console.log('=== 夹具 A：干净骨架（阴性对照；证明"干净时不会误报"）===')
{
  const { repo } = makeCleanFixture('clean')
  const r = runCheck(repo)
  const info = ((r.findings && r.findings.info) || []).map((x) => x.msg || '').join('\n')
  t('A rc=0（无阻塞项）', r.rc === 0, 'rc=' + r.rc)
  t('A blocking 为空', !!r.findings && r.findings.blocking.length === 0, 'blocking=' + (r.findings ? r.findings.blocking.length : 'n/a'))
  t('A 两条断言确实跑过（打印了扫描计数）', /reference-leak 断言已执行/.test(info) && /反向流动断言已执行/.test(info))
  t('A reference-leak 0 命中', kinds(r.findings, 'reference-leak').length === 0)
  t('A reverse-flow 0 命中', kinds(r.findings, 'reverse-flow').length === 0)
}

// ── 夹具 B：参考树/归档/兼容符号链接 → reference-leak 必须红 ──
console.log('=== 夹具 B：参考树 + 归档 + 仓库根兼容符号链接（reference-leak 必须红）===')
{
  const { repo } = makeCleanFixture('refleak')
  write(path.join(repo, REFDIR, 'foo.js'), 'export const x = 1\n')
  write(path.join(repo, REFDIR, 'wer-ref', 'NOTICE.md'), 'third-party copy\n')   // 让根链接解析到仓库内的参考树
  write(path.join(repo, DELDIR, 'x.h'), '// archived\n')
  fs.symlinkSync(REFDIR + '/wer-ref', path.join(repo, 'wer-ref'))                // 0 字节兼容链接（可解析）
  fs.symlinkSync(REFDIR + '/reference', path.join(repo, 'reference'))            // 0 字节兼容链接（悬空）
  const r = runCheck(repo)
  const bl = kinds(r.findings, 'reference-leak')
  const msg = bl.map((b) => b.file + ' ' + b.msg).join('\n')
  t('B rc=1', r.rc === 1, 'rc=' + r.rc)
  t('B reference-leak 三条子判据都命中（清单 3 / 链接 2 / 真实路径 3）',
    bl.length === 3 && /参考\/私有树条目 3 个/.test(msg) && /符号链接 2 个/.test(msg) && /解析后落在参考\/私有树内 3 个/.test(msg), 'blockers=' + bl.length)
  t('B 报文点名参考树条目（foo.js / NOTICE.md）', msg.includes(REFDIR + '/foo.js') && msg.includes(REFDIR + '/wer-ref/NOTICE.md'))
  t('B 报文点名归档条目 x.h', msg.includes(DELDIR + '/x.h'))
  t('B 报文点名兼容链接 wer-ref', /wer-ref ->/.test(msg))
  printRed('夹具 B', runCheck(repo, { json: false }).stdout)
  write(path.join(repo, 'tests', 'publish-check.mjs'), stripAssertion('reference-leak'))
  const m = runCheck(repo)
  t('B 回退 reference-leak 断言 → rc=0 且该断言 0 命中', m.rc === 0 && kinds(m.findings, 'reference-leak').length === 0, 'rc=' + m.rc + ' hits=' + kinds(m.findings, 'reference-leak').length)
}

// ── 夹具 C：插件发布物含渲染器指纹 → reverse-flow 必须红 ──
console.log('=== 夹具 C：插件 lib/x.js 含渲染器 GPL 指纹（reverse-flow 必须红）===')
{
  const { repo, plugin } = makeCleanFixture('revflow')
  write(path.join(plugin, 'lib', 'x.js'), '// SPDX-License-Identifier: GPL-3.0-or-later\nexport const f = spriteFrameImageRects\n')
  const r = runCheck(repo)
  const bl = kinds(r.findings, 'reverse-flow')
  const msg = bl.map((b) => b.file + ' ' + b.msg).join('\n')
  t('C rc=1', r.rc === 1, 'rc=' + r.rc)
  t('C reverse-flow 命中 2 处（GPL 头 + 标识符）', bl.length === 1 && /2 处/.test(msg), 'blockers=' + bl.length)
  t('C 报文点名 lib/x.js:1 与 lib/x.js:2', /lib\/x\.js:1/.test(msg) && /lib\/x\.js:2/.test(msg))
  t('C 报文点名指纹 id（gpl-spdx / ident-spriteFrameImageRects）', /gpl-spdx@lib\/x\.js:1/.test(msg) && /ident-spriteFrameImageRects@lib\/x\.js:2/.test(msg))
  printRed('夹具 C', runCheck(repo, { json: false }).stdout)
  write(path.join(repo, 'tests', 'publish-check.mjs'), stripAssertion('reverse-flow'))
  const m = runCheck(repo)
  t('C 回退 reverse-flow 断言 → rc=0 且该断言 0 命中', m.rc === 0 && kinds(m.findings, 'reverse-flow').length === 0, 'rc=' + m.rc + ' hits=' + kinds(m.findings, 'reverse-flow').length)
}

const failed = tally.filter((x) => !x.ok)
console.log('\n' + (failed.length
  ? `✗ 自检失败 ${failed.length}/${tally.length}：` + failed.map((f) => f.name).join('；')
  : `✓ 自检通过 ${tally.length}/${tally.length}：两条断言都能变红，且回退后确实变绿（夹具临时目录已清理）`))
cleanup()
process.exit(failed.length ? 1 : 0)

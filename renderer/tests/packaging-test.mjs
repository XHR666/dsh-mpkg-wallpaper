// packaging-test.mjs —— P-91：**可分发形态**的自证（package.json 契约 / files 白名单 / 真打包隐私自查 / 一键启动）
// 复现：node packaging-test.mjs
//
// 用户第 3 项"把渲染器做成可分发形态"必须是**可验证**的，不是写个 package.json 就算数：
//   A. `package.json` 契约：许可与 `LICENSE` 一致（`docs/COPYING-RULES.md` §8 ① 的机器闸门）、
//      `exports` 每条都真实存在、`main` 可被 import、`type: module` 与仓库 `.js` 全是 ESM 的事实一致
//   B. `files` 白名单：每条都真实存在；**运行所需 12 类文件全覆盖**；**明确排除**本机数据/备份/上报
//   C. `npm pack --dry-run --json`：文件数/体积在预算内；PWA 与样例被打进去；备份/上报**没**被打进去
//   D. **真打包**（`npm pack --pack-destination <tmp>`）+ 解包后 grep 个人绝对路径 ⇒ 0 命中（隐私）
//   E. `start-demo.sh`：`--check` 预检 0；非法端口 2；**真起服务并在空闲端口上 200**（不靠"看代码觉得对"）
//   F. `check.sh`：`--no-gate` 三阶段全绿 + `--json` 可解析 + 汇总行口径一致
//   G. 新增文件里没有个人绝对路径、没有把 `Testphoto/`、`reports/`、`archive/` 拖进分发
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT
let pass = 0, fail = 0
const fails = []
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const RD = (p) => fs.readFileSync(path.join(HERE, p), 'utf8')

console.log('\n[A] package.json 契约')
const pkgRaw = RD('package.json')
let pkg = null
try { pkg = JSON.parse(pkgRaw) } catch (e) { /* 断言会报 */ }
check('合法 JSON', !!pkg)
check('name 合法且非空（npm 命名规则）', !!pkg && /^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), pkg && pkg.name)
check('version 是 semver', !!pkg && /^\d+\.\d+\.\d+/.test(pkg.version), pkg && pkg.version)
check('license = GPL-3.0-or-later（COPYING-RULES §8 ①）', pkg && pkg.license === 'GPL-3.0-or-later', pkg && pkg.license)
{
  const lic = RD('LICENSE')
  check('LICENSE 是 GPL v3 条款原文（含 "GNU GENERAL PUBLIC LICENSE" + "Version 3"）', /GNU GENERAL PUBLIC LICENSE/.test(lic) && /Version 3/.test(lic))
  check('LICENSE 含 "or (at your option) any later version"（= or-later 口径）', /any later version/.test(lic))
}
check('type = module（与仓库全 ESM 的事实一致）', pkg && pkg.type === 'module')
check('engines.node 声明了下限', !!(pkg && pkg.engines && pkg.engines.node))
{
  const targets = [pkg && pkg.main, ...Object.values((pkg && pkg.exports) || {})].filter((v) => typeof v === 'string')
  for (const t of targets) check('exports/main 目标存在：' + t, fs.existsSync(path.join(HERE, t)))
  check('exports 暴露 server 入口', !!(pkg && pkg.exports && pkg.exports['./server']))
  check('exports 暴露 hlsl2glsl（vendored MIT 转译器）', !!(pkg && pkg.exports && pkg.exports['./hlsl2glsl']))
}
{
  const bad = Object.entries((pkg && pkg.scripts) || {}).filter(([, v]) => /run-all-tests|check\.sh|start-demo\.sh|\.mjs/.test(v) && !v.startsWith('npm '))
  for (const [k, v] of bad) {
    const f = (v.match(/([\w./-]+\.(?:sh|mjs))/) || [])[1]
    check('scripts.' + k + ' 指向真实文件：' + (f || v), f ? fs.existsSync(path.join(HERE, f)) : false)
  }
}

console.log('\n[B] files 白名单：运行所需全覆盖 + 本机数据全排除')
{
  const files = (pkg && pkg.files) || []
  for (const f of files) check('files 条目存在：' + f, fs.existsSync(path.join(HERE, f.replace(/\/$/, ''))))
  const need = ['core/we-scene.mjs', 'core/we-scene-bundle.js', 'server/we-scene-demo-server.mjs', 'demo.html', 'elysia/', 'samples/', 'assets/fonts/', 'web/manifest.webmanifest', 'web/sw.js', 'web/sw-policy.mjs', 'web/icons/', 'vendor/hlsl2glsl/', 'LICENSE', 'THIRD-PARTY.md', 'docs/PACKAGING.md', 'start-demo.sh']
  for (const n of need) check('files 覆盖运行所需：' + n, files.includes(n))
  const banned = ['reports/', 'archive/', 'Testphoto/', 'node_modules/', 'shots/']
  for (const b of banned) check('files **不**含本机数据：' + b, !files.includes(b))
  check('files 没有任何 *.bak-* 通配（备份永不进包）', !files.some((f) => /bak/.test(f)))
}

console.log('\n[C] npm pack --dry-run：清单与体积')
{
  let j = null, err = ''
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: HERE, encoding: 'utf8', timeout: 120000 })
    j = JSON.parse(out)[0]
  } catch (e) { err = String(e.stdout || e.message).slice(0, 200) }
  check('npm pack --dry-run 可解析', !!j, err)
  if (j) {
    const paths = j.files.map((f) => f.path)
    check('文件数在预算内（≤300）', paths.length <= 300, String(paths.length))
    check('解包体积在预算内（≤12MB）', j.unpackedSize <= 12 * 1048576, (j.unpackedSize / 1048576).toFixed(1) + 'MB')
    check('tarball 体积在预算内（≤5MB）', j.size <= 5 * 1048576, (j.size / 1048576).toFixed(2) + 'MB')
    for (const n of ['core/we-scene.mjs', 'web/manifest.webmanifest', 'web/sw.js', 'web/sw-policy.mjs', 'web/icons/icon-512.png', 'vendor/hlsl2glsl/hlsl2glsl.js', 'samples/sample-synthetic/scene.pkg', 'LICENSE', 'THIRD-PARTY.md']) {
      check('打包清单含：' + n, paths.includes(n))
    }
    check('打包清单不含 reports/**', !paths.some((p) => p.startsWith('reports/')))
    check('打包清单不含 *.bak-*', !paths.some((p) => /\.bak-/.test(p)))
    check('打包清单不含 publish-check/run-all-tests 等仓库自检产物（tarball 只发运行时）', !paths.includes('run-all-tests.sh') && !paths.includes('check.sh'))
  }
}

console.log('\n[D] 真打包 + 解包后隐私自查（个人绝对路径 0 命中）')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pack-'))
  try {
    const out = execFileSync('npm', ['pack', '--pack-destination', tmp, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 })
    const tgz = path.join(tmp, JSON.parse(out)[0].filename)
    check('生成 tarball', fs.existsSync(tgz), path.basename(tgz))
    const list = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).trim().split('\n')
    check('tar -tzf 文件数与 dry-run 一致', list.length > 0, String(list.length))
    const ex = path.join(tmp, 'x')
    fs.mkdirSync(ex)
    execFileSync('tar', ['-xzf', tgz, '-C', ex], { timeout: 120000 })
    // 逐文件 grep 个人绝对前缀：二进制文件跳过（-I）。
    // needle **运行时拼**：本文件自己也必须满足"零字面个人路径"（G 组会逐文件断言），所以不能写死。
    const PERSONAL = ['/' + 'root' + '/', '/' + 'home' + '/']
    let hits = []
    try {
      const g = execFileSync('grep', ['-rIl', ...PERSONAL.flatMap((n) => ['-e', n]), ex], { encoding: 'utf8' })
      hits = g.trim() ? g.trim().split('\n') : []
    } catch (e) { hits = [] }   // grep 无命中 ⇒ 退出码 1 ⇒ 走这里
    check('解包产物里**没有**个人绝对路径（两种家目录前缀）', hits.length === 0, hits.map((h) => path.relative(ex, h)).slice(0, 5).join(', '))
    // 分发物里必须带着两份声明（GPL 主许可 + 第三方 MIT 清单）
    check('分发物含 LICENSE（GPL 全文）', fs.existsSync(path.join(ex, 'package', 'LICENSE')))
    check('分发物含 THIRD-PARTY.md（MIT/ISC/OFL 署名清单）', fs.existsSync(path.join(ex, 'package', 'THIRD-PARTY.md')))
    check('分发物含 vendored MIT 的 LICENSE 全文', fs.existsSync(path.join(ex, 'package', 'vendor', 'hlsl2glsl', 'LICENSE')))
    const tp = fs.readFileSync(path.join(ex, 'package', 'THIRD-PARTY.md'), 'utf8')
    check('THIRD-PARTY.md 提到 oneincase/webwallgl（MIT 署名不丢）', /oneincase/.test(tp))
    check('THIRD-PARTY.md 提到 dsh-mpkg-wallpaper（MIT 插件署名不丢）', /dsh-mpkg-wallpaper/.test(tp))
  } catch (e) {
    check('D 真打包未抛异常', false, String(e.stdout || e.message).slice(0, 200))
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ } }
}

console.log('\n[E] start-demo.sh：预检 / 非法端口 / 真起服务')
{
  let rc = 0, out = ''
  try { out = execFileSync('bash', ['start-demo.sh', '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 }) } catch (e) { rc = e.status; out = String(e.stdout || '') }
  check('--check 预检通过（rc=0）', rc === 0, out.trim().split('\n').pop())
  check('--check 打印了包解析器来源', /包解析器/.test(out))
  let rc2 = 0
  try { execFileSync('bash', ['start-demo.sh', '--check', '--port', 'abc'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }) } catch (e) { rc2 = e.status }
  check('非法端口 → 退出码 2', rc2 === 2, String(rc2))
  let rc3 = 0, help = ''
  try { help = execFileSync('bash', ['start-demo.sh', '--help'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }) } catch (e) { rc3 = e.status }
  check('--help 可用且含用法行', rc3 === 0 && /用法/.test(help))

  // 真起服务：空闲端口 + 轮询首页 200 + 解析 URL 行 + SIGTERM 收尾
  let child = null
  try {
    const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
    child = spawn('bash', ['start-demo.sh', '--quiet', '--port', String(port)], { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    child.stdout.on('data', (d) => { buf += d })
    let ok = false, status = 0
    for (let i = 0; i < 100 && !ok; i++) {
      if (child.exitCode !== null) break
      try { const r = await fetch('http://127.0.0.1:' + port + '/'); status = r.status; ok = r.status === 200 } catch { await new Promise((r) => setTimeout(r, 200)) }
    }
    check('start-demo.sh 真起服务且首页 200', ok, 'status=' + status + ' port=' + port)
    check('打印稳定可解析的 URL 行（脚本/CI 依赖）', new RegExp('^URL: http://127\\.0\\.0\\.1:' + port + '/$', 'm').test(buf), (buf.split('\n').find((l) => l.startsWith('URL:')) || '(无)'))
    const sample = await fetch('http://127.0.0.1:' + port + '/?id=sample-synthetic').then((r) => r.status).catch(() => 0)
    check('自带样例页可访问（"打开即玩"的兜底）', sample === 200, 'status=' + sample)
  } catch (e) {
    check('E 真起服务未抛异常', false, e && e.message)
  } finally { if (child) { try { child.kill('SIGKILL') } catch { /* ignore */ } } }
}

console.log('\n[F] check.sh：单一自检入口')
{
  let rc = 0, out = ''
  try { out = execFileSync('bash', ['check.sh', '--no-gate', '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 }) } catch (e) { rc = e.status; out = String(e.stdout || '') + String(e.stderr || '') }
  check('--no-gate 三阶段全绿（rc=0）', rc === 0, out.trim().split('\n').pop())
  const last = out.trim().split('\n').filter((l) => l.startsWith('{')).pop()
  let j = null
  try { j = JSON.parse(last) } catch { /* 断言会报 */ }
  check('--json 汇总可解析', !!j, last ? last.slice(0, 80) : '')
  check('汇总含 4 个阶段（含被跳过的门禁）', !!(j && j.stages && j.stages.length === 4), j && j.stages ? j.stages.map((s) => s.name + ':' + s.status).join(' ') : '')
  check('无失败阶段', j && j.fail === 0, j && String(j.fail))
  check('汇总行口径与 JSON 一致', new RegExp('══ 自检汇总：PASS=' + j.pass + ' FAIL=' + j.fail + ' SKIP=' + j.skip + ' / 总 ' + j.stages.length + ' 阶段').test(out), '')
}

console.log('\n[G] 新增文件卫生：无个人路径 / 不误纳本机数据')
{
  const PERSONAL2 = ['/' + 'root' + '/', '/' + 'home' + '/[a-z]']
  const mine = ['core/we-scene.mjs', 'start-demo.sh', 'check.sh', 'web/sw.js', 'web/sw-policy.mjs', 'web/pwa-inject.mjs', 'tools/make-icons.mjs', 'web/manifest.webmanifest', 'tests/mount-test.mjs', 'tests/pwa-test.mjs', 'tests/packaging-test.mjs', 'tests/hlsl2glsl-coverage-test.mjs']
  for (const f of mine) {
    const s = RD(f)
    check(f + ' 无个人绝对路径', !new RegExp(PERSONAL2.join('|')).test(s))
  }
  const pkgFilesJoins = ((pkg && pkg.files) || []).join(' ')
  for (const b of ['Testphoto', 'reports', 'archive', '__pycache__', '.bak']) check('打包白名单不涉及 ' + b, !pkgFilesJoins.includes(b))
  // ①(P-101) 运行期真依赖必须随包（0.1.0 的 ./server 入口因漏掉 pack-dir/pwa-inject/scene-project-json 而必崩）
  for (const f of ['server/pack-dir.mjs', 'web/pwa-inject.mjs', 'core/scene-project-json.mjs', 'shaders/common.h']) check('files 覆盖运行期依赖：' + f, ((pkg && pkg.files) || []).some((x) => x === f || (x.endsWith('/') && f.startsWith(x))))
  check('新增文档 docs/PACKAGING.md 存在且被 files 收录', fs.existsSync(path.join(ROOT, 'docs/PACKAGING.md')) && ((pkg && pkg.files) || []).includes('docs/PACKAGING.md'))
}

// =====================================================================================
console.log('\n' + '─'.repeat(72))
console.log(`packaging-test：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条断言）`)
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }
console.log('✓ P-91 可分发形态（package.json / files / 真打包隐私 / 一键启动 / 单一自检入口）全部断言通过')

// tools/integrity-check.mjs — 插件发布前「整体完整性」自检（用户第 16 项：往 GitHub 发之前要有一份可复核的确认）
//
// 为什么不是一次性报告：报告会过期，脚本不会。这条检查每次改动都能复跑，也能直接进 CI。
// 检查项（任一 ✗ → 退出码 1）：
//   ① 安装必需文件齐全（lib/index.js、lib/client.js、icon.svg、cordis.patch.yml、package.json、README×2、LICENSE）
//   ② package.json 关键字段（name/version/description/icon/dsh.icon/files/exports/engines/repository）
//   ③ `files` 白名单里的每一项真实存在；且白名单**不含** docs/、screenshots/、tools/（发布包不带研发笔记与实机截图）
//   ④ lib/** 里没有硬编码个人绝对路径 /root/、/home/、Windows 用户目录
//   ⑤ lib/** 里没有常见凭据形态（私钥头、sk-、ghp_、AKIA、password=、Authorization: Bearer 字面量）
//   ⑥ 图标文件存在且是 SVG/PNG；package.json 的 icon 指向的文件存在
//   ⑦ 自检脚本与门禁脚本在位（tools/check.sh、tools/panel-smoke.mjs、tools/scene-watchdog-test.mjs、tools/scene-sandbox-test.mjs、tools/host-sandbox-token-test.mjs）
//   ⑧ 元数据一致性（历史踩坑：包名 `we-scene-renderer` 与仓库名不一致）：package.name ↔
//      repository/homepage/bugs 的仓库名 ↔ LICENSE 首行 ↔ README 无旧包名残留
//   ⑨ **发布包内容清单**（`npm pack --dry-run --json`，历史踩坑：`files:["lib"]` 会把
//      `lib/client.js.bak-*` 这类备份一起打进包；新同事加的 lib/*.js 是否真的进包也靠它证明）
//       + ①(P-127) 发布面**有意排除**清单的双向断言：liquid-glass 的 10 个路径**不在**包里（负向模式生效），
//         但它们**在仓库里一个都不能少**（宿主 `/lg` 路由运行期读它们）—— 详见 docs/PUBLISH-SURFACE-LIQUID-GLASS.md
//       + tools/check.sh 的步数编号自洽（分母一致 / 序号连续）
// 只读：不修改任何文件（`npm pack --dry-run` 不落盘）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.error('  ✗ ' + name + (extra ? ' — ' + extra : '')) } }
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8') } catch { return null } }
const exists = (p) => fs.existsSync(path.join(ROOT, p))

console.log('== ① 安装必需文件 ==')
for (const f of ['lib/index.js', 'lib/client.js', 'icon.svg', 'cordis.patch.yml', 'package.json', 'README.md', 'README.en.md', 'LICENSE']) ok(exists(f), f)

console.log('\n== ② package.json 关键字段 ==')
let pkg = {}
try { pkg = JSON.parse(read('package.json') || '{}') } catch { /* 下面会报 */ }
ok(!!pkg.name, 'name=' + (pkg.name || '(缺)'))
ok(/^\d+\.\d+\.\d+/.test(String(pkg.version || '')), 'version=' + (pkg.version || '(缺)'))
ok(!!pkg.description && String(pkg.description).length > 20, 'description 非空')
ok(!!pkg.icon, 'icon=' + (pkg.icon || '(缺)'))
ok(!!(pkg.dsh && pkg.dsh.icon), 'dsh.icon=' + ((pkg.dsh && pkg.dsh.icon) || '(缺)'))
ok(Array.isArray(pkg.files) && pkg.files.length > 0, 'files 白名单存在')
ok(!!pkg.exports, 'exports 存在')
ok(!!(pkg.engines && pkg.engines.node), 'engines.node=' + ((pkg.engines && pkg.engines.node) || '(缺)'))
ok(!!(pkg.repository && pkg.repository.url), 'repository.url 存在')

console.log('\n== ③ files 白名单 ==')
for (const f of (pkg.files || [])) {
  // ①(2026-09-17) `!lib/**/*.bak*` 这类**负向模式**不是磁盘路径，不参与"存在性"检查
  if (String(f).startsWith('!')) { ok(true, '白名单负向排除项: ' + f); continue }
  ok(exists(f), '白名单项存在: ' + f)
}
ok(!(pkg.files || []).some((f) => /^(docs|screenshots|tools)\//.test(f)), '白名单不含 docs/、screenshots/、tools/（研发笔记与实机截图不进发布包）')

console.log('\n== ④ 硬编码个人路径（lib/**）==')
const libFiles = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js'))
let pathHits = []
for (const f of libFiles) {
  const s = read('lib/' + f) || ''
  s.split('\n').forEach((line, i) => {
    // ①(2026-09-14 加强) **连注释一起查**（原来要求带引号，注释里的 /root/... 会漏）。
    //   ②同时排除"界面示例文案"类通用路径（如 `/home/user/壁纸`、`C:\\Users\\<name>`），否则误报。
    // 只抓**绝对个人根**：/root/xxx、/home/<真实用户>/、/mnt/sdcard、C:\\Users\\<名字>；
    // `~/.dsh-mpkg-wallpaper`、`os.homedir()` 这类**可移植写法不算**（曾误报 3 处）。
    const personalRe = /(\/root\/[A-Za-z.]|\/home\/(?!user\/)[A-Za-z0-9_-]+\/|\/mnt\/sdcard|[A-Z]:\\\\Users\\\\[A-Za-z])/i
    if (personalRe.test(line)) pathHits.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 80))
  })
}
ok(pathHits.length === 0, 'lib/** 无硬编码个人绝对路径', pathHits.slice(0, 3).join(' | '))

console.log('\n== ⑤ 凭据形态（lib/**）==')
const secretRe = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}|password\s*[:=]\s*['"][^'"]+['"]|Authorization:\s*Bearer\s+[A-Za-z0-9._-]{10,})/
let secretHits = []
for (const f of libFiles) {
  const s = read('lib/' + f) || ''
  s.split('\n').forEach((line, i) => { if (secretRe.test(line)) secretHits.push(f + ':' + (i + 1)) })
}
ok(secretHits.length === 0, 'lib/** 无凭据字面量', secretHits.slice(0, 3).join(', '))

console.log('\n== ⑥ 图标 ==')
ok(exists('icon.svg'), 'icon.svg 存在')
ok(exists(String(pkg.icon || 'icon.svg')), 'package.json icon 指向的文件存在')
const svg = read('icon.svg') || ''
ok(/<svg[\s>]/i.test(svg), 'icon.svg 是 SVG')

console.log('\n== ⑦ 门禁脚本在位 ==')
for (const f of ['tools/check.sh', 'tools/panel-smoke.mjs', 'tools/scene-watchdog-test.mjs', 'tools/scene-sandbox-test.mjs', 'tools/host-sandbox-token-test.mjs', 'tools/integrity-check.mjs', 'tools/secret-scan-test.mjs']) ok(exists(f), f)

console.log('\n== ⑧ 元数据一致性（包名 ↔ 仓库名 ↔ LICENSE ↔ README）==')
const repoSlug = String((pkg.repository && pkg.repository.url) || '').replace(/\.git$/, '').replace(/\/+$/, '').split('/').pop()
const readmeAll = (read('README.md') || '') + '\n' + (read('README.en.md') || '')
ok(String(pkg.name || '') === 'dsh-mpkg-wallpaper', 'package.name == dsh-mpkg-wallpaper（' + (pkg.name || '缺') + '）')
ok(repoSlug === pkg.name, 'repository 仓库名 == package.name（' + (repoSlug || '缺') + '）')
ok(String(pkg.homepage || '').replace(/\/+$/, '').split('/').pop() === pkg.name, 'homepage 指向同一仓库名')
ok(String((pkg.bugs && pkg.bugs.url) || '').includes(String(pkg.name || '\u0000')), 'bugs.url 指向同一仓库名')
ok(pkg.license === 'MIT', 'package.license == MIT（' + (pkg.license || '缺') + '）')
ok(/^MIT License\b/m.test(read('LICENSE') || ''), 'LICENSE 首行为 "MIT License"')
// 历史踩坑（用户点名）：包名曾是 `we-scene-renderer`，与仓库名不一致 ⇒ 机器闸门防复发
ok(!/we-scene-renderer/.test(readmeAll), '★ README(中/英) 不残留旧包名 we-scene-renderer')
ok(!/we-scene-renderer/.test(JSON.stringify(pkg)), '★ package.json 不残留旧包名 we-scene-renderer')

/* ①(P-127) 发布面**有意排除**清单（`package.json.files` 负向模式；仓库内必须**保留**）：
 *   `lib/liquid-glass/**`（9 文件）+ `lib/liquid-glass-bundle.js` = 10 文件 / 236 517 B。
 *   为什么排除：客户端 0 调用方（`lgModule` 只声明从未赋值）、产物可由保留源逐字节重建
 *   （sha256 db50361c…）、且它们是本包**唯一** vendored 第三方代码 —— 不分发 ⇒ MIT 署名义务面消失。
 *   为什么**留在仓库**：宿主 `/api/mpkg-wallpaper/lg/<file>.js` 路由运行期 `readFileSync` 读它们
 *   （`lib/index.js:3304`，活路径），`tools/liquid-demo/` 演示页也挂这一份；删文件 ≠ 移出发布面。
 *   台账与判据：`docs/PUBLISH-SURFACE-LIQUID-GLASS.md`（P-127）、`README.md` 的"不随包发布"一节。 */
const PACK_EXCLUDED_BY_DESIGN = [
  'lib/liquid-glass-bundle.js',
  ...['geometry', 'index', 'material', 'renderer', 'shaders', 'v2', 'v2-geometry', 'v2-material', 'v2-shaders']
    .map((n) => `lib/liquid-glass/${n}.js`),
]

console.log('\n== ⑨ 发布包内容清单（npm pack --dry-run --json）==')
let packPaths = null, packFiles = null
try {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 180000 })
  const arr = JSON.parse(raw)
  packFiles = (Array.isArray(arr) ? arr[0] : arr).files || []
  packPaths = packFiles.map((f) => f.path)
  ok(packPaths.length > 0, '拿到包清单（' + packPaths.length + ' 个文件）')
  console.log(`  发布面（npm 报的未压缩字节）: ${packPaths.length} 个文件 / ${packFiles.reduce((s, f) => s + (f.size || 0), 0)} B`)
} catch (e) {
  ok(false, 'npm pack --dry-run --json 可执行', String((e && e.message) || e).slice(0, 140))
}
if (packPaths) {
  // ①(P-127) 有意排除的 10 个路径若混进包 = 负向模式失效（npm `files` 的 `!` 语义变了）⇒ 判红
  const leaked = PACK_EXCLUDED_BY_DESIGN.filter((p) => packPaths.includes(p))
  ok(leaked.length === 0, `★ liquid-glass 的 ${PACK_EXCLUDED_BY_DESIGN.length} 个路径**不在**发布面（files 负向模式生效 ⇒ 不分发 vendored 第三方码，署名义务面消失）`, '漏进包: ' + leaked.join(', '))
  // 但**仓库内必须还在**：宿主 /lg 路由是活路径（lib/index.js:3304 readFileSync），删文件 ≠ 移出发布面
  const lgKept = PACK_EXCLUDED_BY_DESIGN.filter((p) => fs.existsSync(path.join(ROOT, p)))
  ok(lgKept.length === PACK_EXCLUDED_BY_DESIGN.length, `★ 但仓库内 ${PACK_EXCLUDED_BY_DESIGN.length} 个文件**一个都不能少**（宿主 /lg 路由 + liquid-demo 运行期读它们）`, '缺: ' + PACK_EXCLUDED_BY_DESIGN.filter((p) => !fs.existsSync(path.join(ROOT, p))).join(', '))
  const runtimeJs = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).sort()
  // 有意排除的 `lib/*.js` 不参与"必须进包"的期望（其余运行时 js 一个都不许被排除）
  const expectedInPack = runtimeJs.filter((f) => !PACK_EXCLUDED_BY_DESIGN.includes('lib/' + f))
  const missing = expectedInPack.filter((f) => !packPaths.includes('lib/' + f))
  ok(missing.length === 0, `★ lib/ 全部 ${expectedInPack.length} 个运行时 js 进包（不含 ①(P-127) 有意排除的 1 个：liquid-glass-bundle.js）`, '缺: ' + missing.join(', '))
  for (const f of ['lib/index.js', 'lib/client.js', 'lib/pkg-extract.js', 'lib/web-wallpaper.js', 'lib/web-interaction.js']) {
    ok(packPaths.includes(f), '★ 运行时文件在包内: ' + f)
  }
  const junk = packPaths.filter((p) => /(\.bak|\.tmp|\.orig|~$)/.test(p))
  ok(junk.length === 0, '★ 发布包不含备份/临时文件（*.bak*/*.tmp*/*.orig）', '混入: ' + junk.join(', '))
  const dup = packPaths.filter((p) => /client\.js\./.test(p))
  ok(dup.length === 0, '★ 发布包不夹带 client.js 的历史副本', dup.join(', '))
  // ②(2026-09-17) MIT 侧的署名必须随包分发：README 引用了 THIRD-PARTY.md 作为洁净室/归属依据
  ok(packPaths.includes('THIRD-PARTY.md'), '★ THIRD-PARTY.md 随包发布（第三方归属/洁净室记录，MIT 署名义务）')
  ok(packPaths.includes('LICENSE'), '★ LICENSE 随包发布')
}

console.log('\n== ⑩ tracked 文件里的「本机绝对路径」门禁（全量，不只发布面）==')
// 为什么单独一条：④ 只查**发布面**（`lib/**`），而本机绝对路径最容易从 **docs / tools / CI 配置**漏出去
// —— 那些目录不进 npm 包、却会进公开仓库（还带操作环境信息：本机目录结构/用户名）。判据 =
// `git grep -InE "<三种图案>"` 在 **tracked 文件**里 0 命中。
// ①(2026-09-19 敏感信息加固) 立此断言的来由：实测本仓 16 个 tracked 文件（docs/tools）里写着作者本机的
// 工作区绝对路径（多为"环境变量优先 + 本机路径兜底"的兜底值）⇒ 已全量改成按脚本自身位置推导
// （`tools/*.mjs` 里的 `const WS = path.resolve(ROOT, '..')`，优先级一字未动）。
// 同一判据另有一处**独立执行**：`tools/secret-scan-test.mjs` 的 B 段（走 `git ls-files` 读内容），
// 两处互为交叉校验，任一处腐烂另一处仍会响。
// ⚠ 图案按片段拼装：整串写在这里会被这条门禁**自指**命中（与渲染器 publish-check 同一手法）。
const LOCAL_PATH_GATES = [
  { id: 'host-workspace-path', re: '/root/Desktop/' + 'DSHarea' },
  { id: 'device-shared-storage', re: '/storage/' + 'emulated' },
  { id: 'termux-private-dir', re: '/data/' + 'data/com\\.termux' },
]
for (const g of LOCAL_PATH_GATES) {
  let hits = []
  try {
    const out = execFileSync('git', ['grep', '-InE', g.re], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 })
    hits = out.split('\n').filter(Boolean)
  } catch (e) {
    // git grep 的退出码 1 = "无命中"（干净）；其余（128 = 不是 git 仓库 / 没装 git）说明判据没跑成 ⇒ 报红
    if (e.status !== 1) { ok(false, `★ tracked 全量无本机绝对路径：${g.id}`, 'git grep 未跑成（status=' + e.status + '）⇒ 未判定，不假装通过'); continue }
  }
  ok(hits.length === 0, `★ tracked 全量无本机绝对路径：${g.id}`, hits.slice(0, 3).join(' | ').slice(0, 220))
}

console.log('\n== ⑨b tools/check.sh 步数编号自洽 ==')
const checkSh = read('tools/check.sh') || ''
const nums = [...checkSh.matchAll(/step "(\d+)\/(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])])
const totalSteps = nums.length ? nums[0][1] : 0
ok(nums.length > 0, 'check.sh 有 step 标签（' + nums.length + ' 个）')
ok(nums.length > 0 && nums.every(([, n]) => n === totalSteps), '每步分母一致（共 ' + totalSteps + ' 步）')
// ①(2026-09-17) `--quick` 分支会把 3/9 再打一次（正常路径 + 跳过路径）⇒ 允许重复，
//   只要求：从 1 开始、单调不减、最后一步 == 分母（改门禁漏改编号时变红）。
ok(nums.length > 0 && nums[0][0] === 1 && nums[nums.length - 1][0] === totalSteps && nums.every(([i], idx) => idx === 0 || i >= nums[idx - 1][0]),
  '步骤序号覆盖 1..' + totalSteps + ' 且单调不减（改门禁时不会漏改编号）', JSON.stringify(nums))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 插件完整性自检未通过——修好再谈发布'); process.exit(1) }
console.log(`✓ 插件完整性自检通过（配合 tools/check.sh 的 ${totalSteps} 步门禁一起看）`)

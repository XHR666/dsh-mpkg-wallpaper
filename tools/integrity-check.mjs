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
// 只读：不修改任何文件。
import fs from 'node:fs'
import path from 'node:path'
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
for (const f of (pkg.files || [])) ok(exists(f), '白名单项存在: ' + f)
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
for (const f of ['tools/check.sh', 'tools/panel-smoke.mjs', 'tools/scene-watchdog-test.mjs', 'tools/scene-sandbox-test.mjs', 'tools/host-sandbox-token-test.mjs', 'tools/integrity-check.mjs']) ok(exists(f), f)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 插件完整性自检未通过——修好再谈发布'); process.exit(1) }
console.log('✓ 插件完整性自检通过（配合 tools/check.sh 的 5 步门禁一起看）')

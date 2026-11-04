// publish-check.mjs —— 公开仓库发布前的自动闸门（第16项）。
//
// 为什么要有它：本项目的公开副本踩过两类"发出去才发现"的坑 ——
//   ① 个人绝对路径 / 私有库清单 / 实机截图（隐私）；
//   ② **专有文件混入**：`common*.h` 一度与 Wallpaper Engine 官方着色器头逐字节相同（法律）。
// 人工核查会漏，脚本不会。每次准备发布前跑一遍；也可直接进 CI。
//
// 用法:
//   node publish-check.mjs              # 扫描当前树（默认 = 本文件所在目录）
//   node publish-check.mjs --json       # 机读
//   node publish-check.mjs --assets /path/to/wallpaper_engine/assets   # 指定 WE 官方资产根做"逐字节相同"比对
//   node publish-check.mjs --max-mb 50  # 单文件告警阈值（默认 50；>100MB 是 GitHub 硬上限，永远算失败）
//
// 只读：不修改任何文件。退出码 0 = 可以进入人工复核；1 = 有阻塞项。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ①(2026-09-16 目录整理) 本脚本已移入 tests/，仓库根 = 上一级；扫描/体积闸门口径不变（仍扫整棵树）。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF_PATH = fileURLToPath(import.meta.url)   // ①(PA-44) 自指文件：活性反查时要排除自己（图案会命中自身）
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const JSON_OUT = has('--json')
const MAX_MB = Number(val('--max-mb', '50'))
const WE_ASSETS = val('--assets', process.env.MPW_WE_ASSETS || '')

// 不属于"要发布的仓库"的本地目录（本机数据/缓存/上报），扫描时跳过
const SKIP_DIRS = new Set(['.git', 'node_modules', 'reports', '__pycache__', 'archive', 'Testphoto'])
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mpkg', '.pkg', '.flac', '.mp3'])

// ①(2026-09-14 自查修复) **不要**依赖 readdir 的 dirent 类型：本机（PRoot/overlay）下
//   `Dirent.isFile()` 对部分普通文件返回 false → 7 个 common*.h 里漏掉 5 个，发布闸门差点漏报专有文件。
//   改为逐项 `lstat` 判定（慢一点但正确）。
// ①(PA-45 2026-09-24 可移植性审计) 这里原来是 `catch { return out }`：**目录读不到就静默返回部分清单**，
//   于是发布闸门"少扫一片还打 ✓" —— 正是"让现象消失"。现在：读不到的目录/文件**逐条记账**（路径 + errno），
//   汇总成**阻塞项**（下面的 [assert:walk-unreadable] 段），`--json` 里也能看到 unreadable[]；
//   `walk()` 返回 `{ files, unreadable }`（所有调用点已同步改）。判别力自证：同段用**合成反例**
//   （非目录路径 ⇒ ENOTDIR、不存在路径 ⇒ ENOENT）证明"读不到真的会被记下来"，不靠权限位（root 下 chmod 无效）。
const walkCollect = (dir, out, unreadable, readdir) => {
  let ents = []
  try { ents = readdir(dir, { withFileTypes: true }) } catch (e) {
    unreadable.push({ kind: 'dir', path: dir, code: (e && e.code) || null, error: (e && e.message) || String(e) })
    return out
  }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    let st = null
    try { st = fs.lstatSync(p) } catch (e) { unreadable.push({ kind: 'entry', path: p, code: (e && e.code) || null, error: (e && e.message) || String(e) }); continue }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkCollect(p, out, unreadable, readdir) }
    else if (st.isFile()) out.push(p)
  }
  return out
}
/** 扫一棵树。返回 `{files, unreadable}`：**少扫了什么必须能被看见**（PA-45）。 */
const walk = (dir) => { const found = []; const unreadable = []; walkCollect(dir, found, unreadable, fs.readdirSync); return { files: found, unreadable } }

// ── 忽略清单（.gitignore.public）：**只报"真正会进仓库"的问题**，否则会把已排除的本机数据算成阻塞 ──
const IGNORE_FILE = path.join(ROOT, '.gitignore.public')
let ignoreRules = []
if (fs.existsSync(IGNORE_FILE)) {
  ignoreRules = fs.readFileSync(IGNORE_FILE, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}
// ①(2026-09-14 修) 原来的 glob 处理太天真：`*.bak-*` 会被当成"以 .bak-* 结尾"的字面量匹配（永远不命中）。
//   改为 glob→正则（支持 `*` 与 `?`），并同时匹配 basename 与相对路径。
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$')
const ignoreRes = ignoreRules.map((r) => ({ dir: r.endsWith('/'), re: globToRe(r.replace(/\/$/, '')) }))
// ①(2026-09-14 自查修复) 目录规则必须逐层比对**目录名**；此前用"文件自身首段"去 startsWith，
//   导致任何目录规则都会连带排除同一顶层目录下的所有文件（实测把 samples/** 254MB 全部误排）。
const isIgnored = (relPath) => {
  const segs = relPath.split(path.sep).join('/').split('/')
  const base = segs[segs.length - 1]
  const dirs = segs.slice(0, -1)
  return ignoreRes.some(({ dir, re }) => {
    if (dir) return dirs.some((d) => re.test(d))
    return re.test(base) || re.test(segs.join('/')) || dirs.some((d) => re.test(d))
  })
}
const rootScan = walk(ROOT)
const allFiles = rootScan.files
const skippedByIgnore = allFiles.filter((p) => isIgnored(path.relative(ROOT, p)))
const files = allFiles.filter((p) => !isIgnored(path.relative(ROOT, p)))
const rel = (p) => path.relative(ROOT, p)
const findings = { blocking: [], warnings: [], info: [] }
// ①(PA-45) **覆盖面积**的机读字段（`--json` 里直接看得到；不是只有一句人读文案）：
//   扫了多少 / 哪些目录条目读不到 / 官方索引少建了几个。
const coverage = { scannedFiles: 0, unreadable: [], weUnreadable: [], unindexedOfficial: 0, unindexedMine: 0, skipDirs: [...SKIP_DIRS].sort() }

// ── [assert:walk-unreadable] BEGIN ──
//   ①(PA-45) 判据本体 + **判别力自证**放同一段：合成反例必须被记进 unreadable[]，否则判据自己就是哑的。
//   反例都用"真实存在但读不了"的形态，不需要权限位（root 下 000 目录照样可读 ⇒ chmod 造不出失败）：
//     · `<ROOT>/LICENSE/<子路径>`：父级是普通文件 ⇒ readdir 抛 ENOTDIR；
//     · `<ROOT>/.<不可能存在的名字>` ⇒ ENOENT。
{
  const probe = (p) => { const out = []; const un = []; walkCollect(p, out, un, fs.readdirSync); return un }
  const probeNotDir = probe(path.join(ROOT, 'LICENSE', 'not-a-dir'))
  const probeMissing = probe(path.join(ROOT, '.mpw-no-such-dir-' + '4f2a19'))
  const stamp = (u) => (u[0] && u[0].code) || 'null'
  const selfOk = probeNotDir.length === 1 && probeMissing.length === 1 &&
    ['ENOTDIR', 'ENOENT'].includes(stamp(probeNotDir)) && stamp(probeMissing) === 'ENOENT' && !!probeNotDir[0].path
  if (!selfOk) findings.blocking.push({ kind: 'walk-selftest', file: 'tests/publish-check.mjs', msg: '`walk()` 的"读不到必记账"判据自身失效（合成反例未被记进 unreadable ⇒ 发布闸门又会静默少扫）' })
  findings.info.push({ kind: 'walk-selftest', msg: `walk 记账判据已执行：合成反例 ENOTDIR/ENOENT 各 1 条 → 记账 ${probeNotDir.length}+${probeMissing.length} 条（${stamp(probeNotDir)}/${stamp(probeMissing)}）；真树未扫到 ${rootScan.unreadable.length} 条` })
  findings.info.push({ kind: 'walk-scan', msg: `扫描面（walk 逐条记账口径）：${allFiles.length} 个文件，未扫到 ${rootScan.unreadable.length} 个目录/条目` })
  coverage.scannedFiles = allFiles.length; coverage.unreadable = rootScan.unreadable
  if (rootScan.unreadable.length) {
    findings.blocking.push({
      kind: 'walk-unreadable', file: rel(rootScan.unreadable[0].path),
      msg: `发布闸门**少扫**了 ${rootScan.unreadable.length} 个目录/条目（读不到 ⇒ 覆盖面积缩小，不许打 ✓）：`
        + rootScan.unreadable.slice(0, 20).map((u) => rel(u.path) + '（' + (u.code || '?') + '）').join('、')
        + (rootScan.unreadable.length > 20 ? `…（共 ${rootScan.unreadable.length} 条，见 --json 的 unreadable[]）` : ''),
    })
  }
}
// ── [assert:walk-unreadable] END ──

// ── ③-0 证据化标注（2026-09-17，按律师意见） ──
//   背景：`--assets` 跑起来时，"与 WE 官方资产逐字节相同 / 去注释后相同 / 同名有效行重合"这三条判据
//   会在**字体二进制**上报 11 条 —— 它们是因为**上游同一份文件**（WE 也内置了同一个上游构建）而命中，
//   不是"从 WE 安装目录复制来的"（取件渠道与 sha256 见 `THIRD-PARTY.md` §4.1；未改一字节见 §4.2）。
//   口径要求（不改判据、不静默）：
//     ① **仍照常打印**每一条命中（绝不改成静默通过）；
//     ② 打印时**附证据引用**（THIRD-PARTY.md 的具体章节 + 来源 URL/sha256 所在列）；
//     ③ 结论从"不得发布"改为"已复核来源，非 WE 复制 —— 但**每次发布前仍须人工复核这一行**"。
//   本段**只改文案与分类**：扫描逻辑、门禁判据、`--json` 的字段结构一律不动。
const EVIDENCE_FONTS = 'REVIEWED：已确认来源为上游同一文件，非 WE 复制；证据 THIRD-PARTY.md §4.1（逐文件 URL/取件日期 2026-09-15/sha256）+ §4.2（逐字节未修改）+ §4.4（与 WE 副本的字节对照，仅信息性）。**发布前仍需人工复核本行**'
const EVIDENCE_SHADERS = 'REVIEWED：已确认保留部分为公开标准公式/接口签名/格式 id（ITU-R BT.601 等），非 WE 专有表达；证据 THIRD-PARTY.md §4A（含中英声明原文与双刃剑事实标注）+ §4A.2（待律师确认）。**发布前仍需人工复核本行**'
const BINARY_EXT = /\.(ttf|otf|woff2?|eot|mpkg|pkg|tex|mdl|dds|bin|wasm|zip|7z|gz|br|pdf|ico|woff)$/i
const sourceFile = (relPath) => (/(^|\/)(assets\/fonts|shaders)\//.test(relPath) ? EVIDENCE_FONTS : EVIDENCE_SHADERS)
const isBinaryish = (p) => { try { return BINARY_EXT.test(p) || fs.readFileSync(p).subarray(0, 8000).includes(0) } catch { return false } }
// 给一条命中挂上"证据引用"（note）。命中**仍留在 findings.blocking 里** → 退出码与打印行数都不变。
const withNote = (f, note) => { if (note && !f.note) f.note = note; return f }

// ── ① 体积：GitHub 单文件硬上限 100MB（超了推送直接被拒） ──
const sizes = files.map((p) => ({ p, mb: fs.statSync(p).size / 1048576 })).sort((a, b) => b.mb - a.mb)
for (const { p, mb } of sizes) {
  if (mb > 100) findings.blocking.push({ kind: 'size', file: rel(p), msg: `${mb.toFixed(1)}MB > GitHub 100MB 硬上限（推送会被拒）` })
  else if (mb > MAX_MB) findings.warnings.push({ kind: 'size', file: rel(p), msg: `${mb.toFixed(1)}MB > ${MAX_MB}MB 告警阈值` })
}
findings.info.push({ kind: 'size', msg: `按 .gitignore.public 排除 ${skippedByIgnore.length} 个本机文件后，扫描 ${files.length} 个文件，合计 ${(sizes.reduce((s, x) => s + x.mb, 0)).toFixed(1)}MB；最大 ${sizes[0] ? sizes[0].mb.toFixed(1) + 'MB (' + rel(sizes[0].p) + ')' : '—'}` })

// ── ② 隐私：个人绝对路径 / 私有库清单 / 凭据（文本文件才扫） ──
// ①(2026-09-14 加强) 凭据形态：私钥头 / 常见厂商 key / JWT / 赋值式口令。
//   注意 `\.key$` 这类**文件名**规则不要写成行内正则——JS 里的 `ev.key`、`cfg.key` 会被误报（本机实测 4/4 全是误报）。
const SECRET_RE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}|\bAIza[0-9A-Za-z_-]{30,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{20,}|(access_token|api[_-]?key|apikey|passwd|password)\s*[:=]\s*['"][^'"]{12,}['"]|cookie\s*[:=]\s*['"][^'"]{20,}['"])/i
// 文件名级：私钥/证书/密钥文件本身
const SECRET_FILE_RE = /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519|\.env(\..+)?|[^/]+\.(pem|p12|pfx|jks|keystore))$/i
// ①(去个人化) 覆盖面补齐 2026-09-16：原来只认作者工作区路径 `/root/Desktop/`、`/home/<user>/`、`C:\Users\`，
//   结果**漏掉了同类本机路径**：插件下载缓存（root 家目录下的同名点目录）与设备/SD 语料根
//   （实测各漏 15+ 处，含 `known.json`、`known-issues.json`）。
//   现把它们并入 PATH_RE；"环境变量优先 + 作者本机默认值"的写法仍由 DEFAULT_LINE_RE 豁免。
const PATH_RE = /(\/root\/Desktop\/|\/root\/\.dsh-mpkg-wallpaper|\/mnt\/sdcard\/|\/home\/[a-z]+\/|C:\\\\?Users\\\\?[A-Za-z]+)/
// ①(PA-44 2026-09-24 可移植性审计) 这里原来还有一个分支 `|| '<作者工作区绝对路径>'`：去个人化之后
//   tracked 树里**已经没有任何这样的字面量** ⇒ 该分支永不命中（腐烂），但它**仍然生效**：
//   一旦有人写回 `const X = argv.dir || '<作者工作区绝对路径>'`（不带 `process.env` ⇒ 躲过第一个分支），
//   这条门禁会**静默放行**，而 secret-scan-test 的 B 段会判红 ⇒ 两处判据不一致。
//   现在：分支拆成**可逐条反查活性**的数组（每条必须在某个发布物文件里仍然命中，否则判红，见下），
//   并且临时写死本机绝对路径**必须**被这条判据抓到（合成自证，见 [assert:path-exemption] 段）。
const DEFAULT_LINE_BRANCHES = [
  { id: 'env-default', re: /process\.env\.[A-Z_]+ \|\|/, why: '环境变量优先的兜底写法' },
  { id: 'mpw-var-default', re: /MPW_[A-Z_]+ \|\|/, why: 'MPW_* 变量优先的兜底写法' },
  { id: 'mpw-root-shell-default', re: /\$\{MPW_ROOT:-/, why: 'shell 里的 ${MPW_ROOT:-…} 默认值' },
  { id: 'depersonalize-note', re: /\/\/ ①\(去个人化\)/, why: '"本行已去个人化、可覆盖"的显式标注' },
]
const DEFAULT_LINE_RE = new RegExp(DEFAULT_LINE_BRANCHES.map((b) => b.re.source).join('|'))
const branchHits = new Map(DEFAULT_LINE_BRANCHES.map((b) => [b.id, 0]))
for (const p of files) {
  if (SECRET_FILE_RE.test(rel(p))) { findings.blocking.push({ kind: 'secret-file', file: rel(p), msg: '疑似私钥/证书/环境变量文件，不要进公开仓库' }); continue }
  if (SKIP_EXT.has(path.extname(p).toLowerCase())) continue
  let s = ''
  try { if (fs.statSync(p).size > 4 * 1048576) continue; s = fs.readFileSync(p, 'utf8') } catch { continue }
  s.split('\n').forEach((line, i) => {
    if (SECRET_RE.test(line)) findings.blocking.push({ kind: 'secret', file: rel(p) + ':' + (i + 1), msg: '疑似凭据字面量' })
    if (PATH_RE.test(line) && !DEFAULT_LINE_RE.test(line)) findings.warnings.push({ kind: 'path', file: rel(p) + ':' + (i + 1), msg: '出现个人绝对路径（若非"环境变量默认值"需改造）' })
    for (const b of DEFAULT_LINE_BRANCHES) if (b.re.test(line)) branchHits.set(b.id, branchHits.get(b.id) + 1)
  })
}
// ── [assert:path-exemption] BEGIN ──
//   ①(PA-44) 两条都要活着：①**活性**——每个豁免分支必须在发布物里仍然命中（0 命中 = 腐烂 = 判红，
//   与 secret-scan-test.mjs C 段同一纪律；自指文件本行排除，避免"图案自己命中自己"把活性造假）；
//   ②**判别力**——合成一行"写死本机绝对路径"必须被判据抓到（改前：被 `|| '<作者路径>'` 分支豁免 ⇒ 放行）。
{
  const SELF = rel(SELF_PATH)
  /* ⚠ 活性反查要求"这就是真仓库"：`tests/publish-check-selftest.mjs` 会把本脚本复制进 os.tmpdir() 的
     **裸夹具树**（骨架文件十几个，豁免分支一条都不在场）⇒ 那里必须退化为"未判定 + warning"，
     否则本项会把"夹具树本来就没有那些写法"误判成"白名单腐烂"，把自检的三条回退证明一起带红
     （与 ②D tracked 面、以及 publish-check-selftest 的既有降级口径同源）。 */
  const inWorkTree = (() => {
    try {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      return top !== '' && fs.realpathSync(top) === fs.realpathSync(ROOT)
    } catch { return false }
  })()
  const stale = !inWorkTree ? [] : DEFAULT_LINE_BRANCHES.filter((b) => {
    const n = [...files].filter((p) => rel(p) !== SELF).reduce((acc, p) => {
      if (SKIP_EXT.has(path.extname(p).toLowerCase())) return acc
      try { if (fs.statSync(p).size > 4 * 1048576) return acc; return acc + fs.readFileSync(p, 'utf8').split('\n').filter((l) => b.re.test(l)).length } catch { return acc }
    }, 0)
    return n === 0
  }).map((b) => b.id)
  const HARD = "const X = argv.dir || '" + '/root' + '/Desktop/' + 'DSHarea' + "'"
  const SOFT = "const X = process.env.MPW_X || '" + '/root' + '/Desktop/' + 'DSHarea' + "'"
  const hardCaught = PATH_RE.test(HARD) && !DEFAULT_LINE_RE.test(HARD)
  const softExempt = PATH_RE.test(SOFT) && DEFAULT_LINE_RE.test(SOFT)
  findings.info.push({ kind: 'path-exemption', msg: `豁免分支活性：${DEFAULT_LINE_BRANCHES.map((b) => b.id + '=' + branchHits.get(b.id)).join(' ')}`
    + (inWorkTree ? `（自指文件已排除再数一遍：${stale.length ? '有 0 命中的分支' : '全部仍有命中'}）` : '（**未判定**：ROOT 不是 git 工作树根 —— 裸夹具树，本项按既有口径降级）') })
  if (!inWorkTree) findings.warnings.push({ kind: 'path-exemption-liveness', file: rel(ROOT), msg: 'DEFAULT_LINE_RE 的"每条分支必须仍然命中"**未执行**：ROOT 不是 git 工作树的根（裸夹具树里那些写法本就不在场）⇒ 不假装查过' })
  else if (stale.length) findings.blocking.push({ kind: 'path-exemption-stale', file: 'tests/publish-check.mjs', msg: `DEFAULT_LINE_RE 有 ${stale.length} 个分支**永不命中**（腐烂：豁免的目标不存在了，却还留着后门）：${stale.join('、')} ⇒ 删分支或改判据` })
  if (!hardCaught) findings.blocking.push({ kind: 'path-exemption-selftest', file: 'tests/publish-check.mjs', msg: '判别力自证失败：写死本机绝对路径的合成行**没有被判红**（PATH_RE 命中且 DEFAULT_LINE_RE 未命中这一条不成立）⇒ 豁免判据失效' })
  if (!softExempt) findings.blocking.push({ kind: 'path-exemption-selftest', file: 'tests/publish-check.mjs', msg: '判别力自证失败：「环境变量优先 + 本机默认值」的合成行**没有**被既有豁免口径放行 ⇒ 豁免口径写坏了' })
}
// ── [assert:path-exemption] END ──
// 私有库清单类文件（内嵌本机包列表/路径）
for (const p of files) {
  const b = path.basename(p)
  if (/^(library-manifest|package-matrix|package-baseline|perf-matrix|perf-baseline)\.json$/.test(b)) {
    findings.blocking.push({ kind: 'private-list', file: rel(p), msg: '内嵌本机壁纸/工坊清单与路径，**不要进公开仓库**' })
  }
}

// ── 公共小工具：U-4 两条发布面断言共用（**故意放在哨兵块之外**，见 tests/publish-check-selftest.mjs 的"断言回退"证明） ──
const segsOf = (p) => String(p).split(/[\\/]+/).filter(Boolean)
const fmtList = (arr, n = 20) => arr.slice(0, n).join('、') + (arr.length > n ? `…（共 ${arr.length} 个）` : '')

// ── ②B 参考资料隔离：发布物清单里 **0 个**参考/私有树条目（U-4，2026-09-17 由并发线交接落地） ──
//   不变量：第三方参考副本（`references/**`）与取证归档（`Delete/**`）**永远不得进入发布物**；旧工作区根上的
//   6 个 0 字节兼容符号链接（`wer-ref`…`reference`）同样不得被发布 —— 链接本体不是发布物，**跟随它也不能把
//   参考副本的字节夹带进来**（walk() 本就不跟随符号链接；本段再把"解析后的真实路径"独立查一遍）。
//   形状（U-4 建议的等价写法）：files.filter((p) => /(^|\/)(references|Delete|…)(\/|$)/.test(rel(p))).length === 0。
//   与 `tests/reference-isolation-check.mjs`（源码 import 面 / npm pack 面 / .gitignore 面 / 旧路径链接面）互补：
//   那边查"代码有没有引用参考副本"，这边查"**发布物清单里有没有参考副本本身**"（发布前最后一道）。
const REF_TREES = ['references', 'Delete', 'vendor-ref', 'we-layerd-ref', 'wer-ref', 'lwe-ref', 'dsbw-ref', 'reference', 'tmp', 'probe-out']
const REF_TREE_SET = new Set(REF_TREES)
// 仓库内相对路径判据：**任一片段**命中即算落在参考/私有树里（含 `vendor/wer-ref/x` 这种嵌套形态）
const inRefTree = (p) => segsOf(p).some((s) => REF_TREE_SET.has(s))
// 绝对/真实路径判据：只认"仓库内 / 工作区根"这两处的同名目录。**不能**拿绝对路径的任一片段去比 ——
// 那样任何位于 `…/tmp/…` 下的合法检出（CI、临时夹具）都会被 `tmp` 整棵树误伤（实测：夹具里 12~15 个正常文件全被误报）。
const REF_ROOTS = REF_TREES.flatMap((n) => [path.join(ROOT, n), path.join(ROOT, '..', n)])
const underRefRoot = (abs) => !!abs && REF_ROOTS.some((r) => abs === r || abs.startsWith(r + path.sep))
// ── [assert:reference-leak] BEGIN ──
// ②B-1 发布物清单（已按 .gitignore.public 过滤）里 0 个参考/私有树条目
const refLeakEntries = files.filter((p) => inRefTree(rel(p)))
// ②B-2 符号链接：名字命中 / 字面目标命中 / **解析后真实路径**命中 → 都算夹带渠道（悬空链接也照报）
const linkScan = []
const walkLinks = (dir) => {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    let st = null
    try { st = fs.lstatSync(p) } catch { continue }
    if (st.isSymbolicLink()) {
      const target = (() => { try { return fs.readlinkSync(p) } catch { return '' } })()
      const resolved = (() => { try { return fs.realpathSync(p) } catch { return '' } })()
      linkScan.push({ p, target, resolved, size: st.size })
    } else if (st.isDirectory() && !SKIP_DIRS.has(e.name) && !REF_TREE_SET.has(e.name)) walkLinks(p)
  }
}
walkLinks(ROOT)
// 字面目标按**链接所在目录**解析（悬空链接也能判定），再与真实路径一起做"是否落在参考根内"的包含判据
const linkTargetAbs = (l) => (path.isAbsolute(l.target) ? l.target : path.resolve(path.dirname(l.p), l.target))
const refLeakLinks = linkScan.filter((l) => REF_TREE_SET.has(path.basename(l.p)) || underRefRoot(linkTargetAbs(l)) || underRefRoot(l.resolved))
// ②B-3 "跟随链接"复核：发布物清单里每个文件的**真实路径**都不得落在参考/私有树内
const followedInto = []
for (const p of files) {
  const rp = (() => { try { return fs.realpathSync(p) } catch { return '' } })()
  if (underRefRoot(rp)) followedInto.push(rel(p) + ' → ' + rp)
}
if (refLeakEntries.length) findings.blocking.push({ kind: 'reference-leak', file: rel(refLeakEntries[0]), msg: `发布物清单里出现参考/私有树条目 ${refLeakEntries.length} 个 → 参考副本与取证归档**永不得发布**（` + fmtList(refLeakEntries.map(rel)) + `）` })
if (refLeakLinks.length) findings.blocking.push({ kind: 'reference-leak', file: rel(refLeakLinks[0].p) + ' -> ' + refLeakLinks[0].target, msg: `仓库里出现指向参考/私有树的符号链接 ${refLeakLinks.length} 个 → 链接本体不得发布，跟随它会夹带参考副本字节（` + fmtList(refLeakLinks.map((l) => rel(l.p) + ' -> ' + l.target + (l.resolved ? '（解析到 ' + l.resolved + '）' : '（悬空）'))) + `）` })
if (followedInto.length) findings.blocking.push({ kind: 'reference-leak', file: followedInto[0], msg: `发布物里有文件解析后落在参考/私有树内 ${followedInto.length} 个 → 符号链接夹带（` + fmtList(followedInto) + `）` })
// 断言可被看见：无论是否命中都打印扫描口径（U-4 要求"能看出断言确实跑过"）
findings.info.push({ kind: 'reference-leak', msg: `reference-leak 断言已执行：扫描 ${files.length} 个发布物路径 + ${linkScan.length} 个符号链接（仓库根 ${linkScan.filter((l) => path.dirname(l.p) === ROOT).length} 个）+ ${files.length} 个真实路径复核 → 命中 ${refLeakEntries.length + refLeakLinks.length + followedInto.length} 条（隔离对象：${REF_TREES.join('/、')}/）` })
// ── [assert:reference-leak] END ──

// ── ②D tracked 文件里的「本机绝对路径」门禁（**全量**，不是只看发布面） ──
//   为什么单独一条：上面 ② 段的 PATH_RE 只看"发布物清单"（已按 .gitignore.public 过滤），而本机绝对路径
//   最容易从 **docs / tests / tools / CI 配置** 漏出去 —— 公开仓库不该带操作环境信息（本机目录结构/用户名），
//   也顺带让文档在任何机器上可读。判据 = `git grep -InE "<三种图案>"` 在 **tracked 文件**里 0 命中。
//   ①(2026-09-19 敏感信息加固) 立此断言的直接来由：实测渲染器 73 个 tracked 文件、插件 16 个 tracked 文件里
//   都写着作者本机的工作区绝对路径（多为"环境变量优先 + 本机路径兜底"的兜底值）⇒ 已全量改成按脚本位置推导。
//   ⚠ 不在 git 工作树里时（`tests/publish-check-selftest.mjs` 会把本脚本复制进 os.tmpdir() 的裸夹具树）
//     **无法**判定 tracked 面 ⇒ 退化为警告 + 在 info 里明说"本项未执行"，绝不假装查过。
//     同一判据另有一处**独立执行**：`tests/secret-scan-test.mjs` 的 B 段（走 `git ls-files` 读内容），
//     两处互为交叉校验，任一处腐烂另一处仍会响。
//   ⚠ 图案按片段拼装：整串写在本文件里会被这条门禁**自指**命中（与 ②B 的 REF_TREES 处理同一道理）。
const LOCAL_PATH_GATES = [
  { id: 'host-workspace-path', re: '/root/Desktop/' + 'DSHarea' },
  { id: 'device-shared-storage', re: '/storage/' + 'emulated' },
  { id: 'termux-private-dir', re: '/data/' + 'data/com\\.termux' },
]
// ── [assert:tracked-local-paths] BEGIN ──
{
  const inWorkTree = (() => {
    try {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      return top !== '' && fs.realpathSync(top) === fs.realpathSync(ROOT)
    } catch { return false }
  })()
  if (!inWorkTree) {
    findings.warnings.push({ kind: 'tracked-local-paths', file: rel(ROOT), msg: 'ROOT 不是 git 工作树的根 ⇒ 无法判定 tracked 面，本项**未执行**（真仓库里必跑；裸夹具树里属预期）' })
  } else {
    const gateHits = []
    for (const g of LOCAL_PATH_GATES) {
      let out = ''
      try {
        out = execFileSync('git', ['grep', '-InE', g.re], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 })
      } catch (e) {
        // git grep 的退出码 1 = "无命中"（干净）；其余（128=不是仓库…）说明判据没跑成 ⇒ 报红，不静默
        if (e.status !== 1) findings.blocking.push({ kind: 'tracked-local-paths', file: 'tests/publish-check.mjs', msg: `git grep 未跑成（status=${e.status}）⇒ tracked 面未判定，不假装通过` })
        continue
      }
      for (const l of out.split('\n').filter(Boolean)) gateHits.push({ id: g.id, at: l.split(':').slice(0, 2).join(':') })
    }
    if (gateHits.length) findings.blocking.push({ kind: 'tracked-local-paths', file: gateHits[0].at, msg: `tracked 文件里出现本机绝对路径 ${gateHits.length} 处 → 公开仓库不得带操作环境信息；兜底默认请按脚本自身位置推导（` + fmtList(gateHits.map((h) => h.id + '@' + h.at)) + `）` })
    findings.info.push({ kind: 'tracked-local-paths', msg: `tracked 面本机绝对路径门禁已执行：git grep -InE × ${LOCAL_PATH_GATES.length} 种图案（${LOCAL_PATH_GATES.map((g) => g.id).join('/')}）→ 命中 ${gateHits.length} 条` })
  }
}
// ── [assert:tracked-local-paths] END ──

// ── ③ 专有文件混入：与 WE 官方资产逐字节相同（common*.h 就是这么抓到的） ──
if (WE_ASSETS && fs.existsSync(WE_ASSETS)) {
  // ①(PA-45 2026-09-24) 原来这里的每个 `catch {}` 都是**静默**：目录读不到 ⇒ `walk()` 少返回一批；
  //   单个官方文件读不到 ⇒ 它**不进索引** ⇒ "逐字节相同"这条比对就漏掉它。现在全部**计数 + 进 warnings**，
  //   并在 --json 里出字段（unreadable / unindexed 两族）。
  const unreadableWE = []
  const weScan = (() => {
    const a = walk(WE_ASSETS), b = walk(WE_ASSETS)
    unreadableWE.push(...a.unreadable, ...b.unreadable)
    return a.files
  })()
  let unindexedOfficial = 0
  const official = new Map() // sha256 → 官方相对路径
  for (const p of weScan) {
    try { if (fs.statSync(p).size > 2 * 1048576) continue; official.set(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), path.relative(WE_ASSETS, p)) } catch { unindexedOfficial++ }
  }
  // ①(2026-09-14 自查加强) **归一化比对**：只比字节哈希会被“加注释/改空白式改写”骗过
  //   （实测：某次“重写”去掉注释后与原文逐行 100% 相同）。故再建一份去注释/空白的索引。
  const normText = (t) => t.split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()).filter((l) => l.length > 3).join('\n')
  const officialNorm = new Map()
  for (const p of weScan) {
    try {
      if (fs.statSync(p).size > 2 * 1048576) continue
      const nt = normText(fs.readFileSync(p, 'utf8'))
      if (nt) officialNorm.set(nt, path.relative(WE_ASSETS, p))
    } catch { unindexedOfficial++ }
  }
  let hits = 0
  let unindexedMine = 0
  for (const p of files) {
    if (SKIP_EXT.has(path.extname(p).toLowerCase())) continue
    let buf = null
    try { if (fs.statSync(p).size > 2 * 1048576) continue; buf = fs.readFileSync(p) } catch { unindexedMine++; continue }
    const h = crypto.createHash('sha256').update(buf).digest('hex')
    if (official.has(h)) { hits++; findings.blocking.push(withNote({ kind: 'proprietary', file: rel(p), msg: '与 WE 官方资产逐字节相同：' + official.get(h) + '（不得随公开仓库分发）' }, sourceFile(rel(p)))) }
    // ①归一化二次比对：去掉注释/空白后若与官方完全相同 = 照抄再排版，同样阻塞
    try {
      const nt = normText(fs.readFileSync(p, 'utf8'))
      if (nt && officialNorm.has(nt)) { hits++; findings.blocking.push(withNote({ kind: 'proprietary-normalized', file: rel(p), msg: '去掉注释/空白后与 WE 官方完全相同：' + officialNorm.get(nt) + '（等同照抄再排版，不得发布）' }, sourceFile(rel(p)))) }
    } catch { unindexedMine++ }
  }
  if (unreadableWE.length) findings.warnings.push({ kind: 'proprietary-unreadable', file: 'tests/publish-check.mjs', msg: `WE 官方资产树有 ${unreadableWE.length} 个目录/条目**读不到** ⇒ 官方索引不完整（比对覆盖面积缩小）：` + fmtList(unreadableWE.map((u) => path.relative(WE_ASSETS, u.path) + '（' + (u.code || '?') + '）')) })
  coverage.weUnreadable = unreadableWE; coverage.unindexedOfficial = unindexedOfficial; coverage.unindexedMine = unindexedMine
  if (unindexedOfficial || unindexedMine) findings.warnings.push({ kind: 'proprietary-unindexed', file: 'tests/publish-check.mjs', msg: `未建入索引的文件：官方侧 ${unindexedOfficial} 个 / 本仓侧 ${unindexedMine} 个（读失败或超 2MB 上限之外）⇒ "逐字节相同"这类比对对它们是**没查**，不是查过` })
  // ①(2026-09-14 加强 v3) **按同名文件的有效行重合率**判定"照抄再排版"：
  //   整文件归一化太严格（少一行就漏判），而逐行重合率对"加注释/改空白/换行序"都稳。
  const sigLines = (p) => { try { return new Set(fs.readFileSync(p, 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()).filter((l) => l.length > 3)) } catch { return new Set() } }
  const officialByName = new Map()
  for (const p of weScan) { try { const b = path.basename(p); if (!officialByName.has(b)) officialByName.set(b, p) } catch { unindexedOfficial++ } }
  for (const p of files) {
    const b = path.basename(p)
    const op = officialByName.get(b)
    if (!op) continue
    const mine = sigLines(p), off = sigLines(op)
    if (!off.size) continue
    let same = 0
    for (const l of off) if (mine.has(l)) same++
    const ratio = same / off.size
    // ③-2 二进制同名文件（字体等）：**有效行重合**这条判据对二进制没有意义（"行"是随机字节切出来的），
    //   所以这里**不把它当"照抄再排版"的证据**，而是照常打印 + 附"为什么"与来源行号（THIRD-PARTY.md §4.1）。
    if (isBinaryish(p)) {
      if (ratio >= 0.5) findings.warnings.push(withNote({ kind: 'proprietary-overlap-binary' + (ratio >= 0.9 ? '-high' : ''), file: rel(p), msg: `与 WE 官方同名二进制文件"有效行"重合 ${(ratio * 100).toFixed(0)}%（${same}/${off.size}）→ **该判据对二进制无语义**（行由随机字节切出），改判据不改发现：见 note` }, (/(^|\/)assets\/fonts\//.test(rel(p)) ? EVIDENCE_FONTS : EVIDENCE_SHADERS)))
      continue
    }
    if (ratio >= 0.9) findings.blocking.push(withNote({ kind: 'proprietary-overlap', file: rel(p), msg: `有效行与 WE 官方同名文件重合 ${(ratio * 100).toFixed(0)}%（${same}/${off.size}）→ 属"照抄再排版"，不得发布` }, sourceFile(rel(p))))
    else if (ratio >= 0.5) findings.warnings.push(withNote({ kind: 'proprietary-overlap', file: rel(p), msg: `与 WE 官方同名文件有效行重合 ${(ratio * 100).toFixed(0)}% → 请人工确认是否独立实现` }, sourceFile(rel(p))))
  }
  findings.info.push({ kind: 'proprietary', msg: `与 WE 官方资产比对：${official.size} 个官方文件做索引，命中 ${hits} 个（逐条打印，附证据引用 note；口径见 THIRD-PARTY.md §4.1/§4A）；未扫到目录 ${unreadableWE.length} 个 / 未建入索引 ${unindexedOfficial + unindexedMine} 个（**覆盖面积**口径，见 warnings）` })
} else {
  findings.warnings.push({ kind: 'proprietary', msg: '未提供 WE 资产根（--assets / MPW_WE_ASSETS）→ 跳过"专有文件混入"比对（建议发布前务必跑一次）' })
}

// ── ④ 发布必需文件 ──
const REQUIRED = ['LICENSE', 'THIRD-PARTY.md', 'docs/README-PUBLIC.md', 'elysia/LICENSE', 'elysia/vendor/@shaderfrog/glsl-parser/LICENSE', 'samples/sample-synthetic/scene.pkg']
for (const f of REQUIRED) {
  if (!fs.existsSync(path.join(ROOT, f))) findings.blocking.push({ kind: 'missing', file: f, msg: '发布必需文件缺失' })
}

// ── ⑤ 许可一致性自检（P-89，2026-09-16：渲染器切 GPL-3.0-or-later，插件保持 MIT） ──
//    ① LICENSE ↔ package.json.license 一致（渲染器无 package.json，则以 LICENSE 自证为准）
//    ② 发布物里不含插件的 GPL 违规内容（插件必须仍是 MIT，且不得被 vendored 进本 GPL 仓库）
//    ③ docs/COPYING-RULES.md 与 THIRD-PARTY.md 在位
//    ④ vendored webwallgl 的 MIT 声明与字体许可文件都在
const licensePath = path.join(ROOT, 'LICENSE')
const SPDX_WANT = 'GPL-3.0-or-later'
try {
  const lic = fs.readFileSync(licensePath, 'utf8')
  // ①-a LICENSE 必须是 GNU GPL v3 条款原文（首行/关键词）
  const firstLine = lic.split('\n').find((l) => l.trim()) || ''
  const hasGplTitle = /GNU GENERAL PUBLIC LICENSE/.test(firstLine)
  const hasVersion3 = /Version 3,\s*29 June 2007/.test(lic)
  const hasOrLater = /either version 3 of the License, or \(at your option\)\s+any later version/.test(lic.replace(/\s+/g, ' '))
  const hasHolder = /Copyright \(C\) 2026 XHR666/.test(lic)
  if (!hasGplTitle) findings.blocking.push({ kind: 'license', file: 'LICENSE', msg: `首行不是 GNU GPL 标题（实际：${JSON.stringify(firstLine.trim())}）` })
  if (!hasVersion3 || !hasOrLater) findings.blocking.push({ kind: 'license', file: 'LICENSE', msg: 'LICENSE 缺少 "Version 3, 29 June 2007" 或 "or any later version" 措辞（必须声明 GPL-3.0-**or-later**）' })
  if (!hasHolder) findings.blocking.push({ kind: 'license', file: 'LICENSE', msg: 'LICENSE 缺少版权声明 "Copyright (C) 2026 XHR666"' })
  // ①-b package.json 若存在，license 字段必须与 SPDX 一致
  const pkgPath = path.join(ROOT, 'package.json')
  if (fs.existsSync(pkgPath)) {
    let pkg = null
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch { findings.blocking.push({ kind: 'license', file: 'package.json', msg: 'JSON 解析失败，无法核对 license 字段' }) }
    if (pkg) {
      if (pkg.license !== SPDX_WANT) findings.blocking.push({ kind: 'license', file: 'package.json', msg: `license = ${JSON.stringify(pkg.license)}，与 LICENSE 的 ${SPDX_WANT} 不一致` })
      else findings.info.push({ kind: 'license', msg: `package.json license=${SPDX_WANT} 与 LICENSE 一致` })
    }
  } else {
    findings.info.push({ kind: 'license', msg: `仓库无 package.json（渲染器是 .mjs + demo.html）→ 许可一致性以 LICENSE 自证为准（${SPDX_WANT}，含版权声明与 or-later 措辞）` })
  }
} catch (e) {
  findings.blocking.push({ kind: 'license', file: 'LICENSE', msg: '读取失败：' + ((e && e.message) || e) })
}

// ② 插件侧许可核对（**2026-10-30 随"渲染器并入插件工作区"演进，留痕**）
//   旧契约（分离两仓时代）：插件 LICENSE 必须是纯 MIT 文本、license 字段 === 'MIT' —— 那时
//   "插件包里出现 GPL 文本"只可能是污染。任务单 P1（docs/ZCODE-RENDERER-INTEGRATION-TASK-ORDER.md）之后，
//   插件包**有意**以"聚合"形态随包携带渲染器（renderer/**，GPL-3.0-or-later），根 LICENSE 改为
//   **双许可说明页**、`license` 字段改为 "SEE LICENSE IN LICENSE" —— 所以本断言改为钉住新契约：
//     · LICENSE 必须同时含 MIT 全文（Permission is hereby granted）与双许可标记（GPL-3.0-or-later + renderer/** + 两份全文指引）
//       ⇒ 缺任何一半都红：全 MIT = 渲染器没声明（合规问题）；全 GPL = MIT 部分丢失。
//     · `license` 字段必须 === 'SEE LICENSE IN LICENSE'（标回 'MIT' = 包内含 GPL 却标纯 MIT，分发合规问题）。
//   反向流动指纹扫描（下方 [assert:reverse-flow]）的**牙齿保留**：只扫 MIT 面（发布清单里 renderer/** 之外
//   的文件）—— renderer/** 本身就是被许可的 GPL 载荷，其指纹由本仓 LICENSE/打包判据负责。
//   插件目录解析（路径固化 2026-10-30）：本工作区里插件树叫 `plugin/`（ROOT 的兄弟目录）；
//   env `MPW_PLUGIN_DIR` 可显式覆盖；旧兄弟仓名 `dsh-mpkg-wallpaper` 保留为回退（原检出仍可跑）。
const PLUGIN_CANDIDATES = [
  process.env.MPW_PLUGIN_DIR,
  path.join(ROOT, '..', 'plugin'),
  path.join(ROOT, '..', 'dsh-mpkg-wallpaper'),
].filter(Boolean)
const PLUGIN_DIR = PLUGIN_CANDIDATES.find((p) => fs.existsSync(path.join(p, 'LICENSE'))) || PLUGIN_CANDIDATES[PLUGIN_CANDIDATES.length - 1]
if (fs.existsSync(PLUGIN_DIR)) {
  try {
    const plic = fs.readFileSync(path.join(PLUGIN_DIR, 'LICENSE'), 'utf8')
    const hasMit = /Permission is hereby granted/.test(plic)
    const hasDual = plic.includes('GPL-3.0-or-later') && plic.includes('renderer/**')
      && plic.includes('LICENSES/MIT.txt') && plic.includes('LICENSES/GPL-3.0-or-later.txt')
    if (!hasMit || !hasDual) findings.blocking.push({ kind: 'license', file: '../plugin/LICENSE', msg: '插件 LICENSE 不是双许可说明页（需同时含 MIT 全文与 GPL-3.0-or-later/renderer/**/LICENSES 指引）→ 渲染器随包分发但未声明，或 MIT 部分丢失' })
    else findings.info.push({ kind: 'license', msg: '插件 plugin：LICENSE 为双许可说明页（MIT lib/** + GPL-3.0-or-later renderer/**）' })
    const ppkg = path.join(PLUGIN_DIR, 'package.json')
    if (hasDual && fs.existsSync(ppkg)) {
      try {
        const j = JSON.parse(fs.readFileSync(ppkg, 'utf8'))
        if (j.license !== 'SEE LICENSE IN LICENSE') findings.blocking.push({ kind: 'license', file: '../plugin/package.json', msg: `插件 license = ${JSON.stringify(j.license)}，应为 "SEE LICENSE IN LICENSE"（包内含 GPL 时标纯 MIT 是误导）` })
      } catch { findings.warnings.push({ kind: 'license', file: '../plugin/package.json', msg: 'JSON 解析失败，未核对 license 字段' }) }
    }
  } catch { findings.warnings.push({ kind: 'license', file: '../plugin/LICENSE', msg: '插件 LICENSE 读取失败 → 未核对"双许可说明页"' }) }
} else {
  findings.warnings.push({ kind: 'license', msg: '未找到插件目录（plugin/ 或 dsh-mpkg-wallpaper/）→ 跳过"插件许可形态"核对（独立发布本仓库时属正常）' })
}
// ②-b 本仓库不得 vendored 插件的任何文件（借用应改为 import 外部包并在 THIRD-PARTY.md 声明）
const vendoredPlugin = files.filter((p) => /(^|\/)dsh-mpkg-wallpaper(\/|$)/.test(rel(p)) || /(^|\/)pkg-extract\.(mjs|js)$/.test(rel(p)))
if (vendoredPlugin.length) findings.blocking.push({ kind: 'license', file: rel(vendoredPlugin[0]), msg: `本仓库出现插件的 vendored 副本（${vendoredPlugin.length} 个文件）→ 改为 import 外部包，并在 THIRD-PARTY.md 声明其 MIT` })

// ── ⑤②-c 反向流动断言（`docs/COPYING-RULES.md` §2.2）：MIT 插件的**发布物**里不得出现渲染器（GPL）指纹 ──
//   规则：MIT → GPL **允许**单向流动（§2.1：进入后该副本按 GPL 分发，原 MIT 声明保留）；GPL → MIT **禁止**
//   （§2.2：不得复制、改写、逐行翻译、粘贴注释/常量顺序）。本仓库 GPL-3.0-or-later，插件 MIT ⇒ 渲染器代码不得进插件。
//   反方向是**合法**的：**渲染器 import 插件的 `lib/pkg-extract.js` 解析契约**（MIT → GPL）——
//   见 `server/pack-dir.mjs:77`（`await import(… 'dsh-mpkg-wallpaper/lib/pkg-extract.js')`）与
//   `docs/COMPLIANCE-REVIEW.md` 第 11 行（"方向 = MIT → GPL-3.0-or-later 允许单向流动"）。
//   因此 `parsePkg` / `readPkgEntry` / `parseTex` / `getEntry` 这类**插件自有**的契约名（插件 `lib/pkg-extract.js:2240`
//   导出、渲染器 import），以及 `--mpw-*` / `data-mpw-*` **插件自有**标记，**一律不是渲染器指纹**：
//   import 与署名都合法，**把渲染器代码抄进 MIT 插件才非法**。本断言只认下面这张显式清单。
//   入选标准（每条都要"能独立判别"）：① 在渲染器里唯一或稀缺；② 命名是项目特有概念，不是通用 API/算法名；
//   ③ 实测插件发布物 0 命中。通用名（`lz4Decompress`、`parseTex`、`parseVec3`…）**故意不收**：它们可能是
//   各自独立实现的同名函数，收了就是假阳性。
const RENDERER_FINGERPRINTS = [
  { id: 'gpl-title', re: /GNU GENERAL PUBLIC LICENSE/, src: 'LICENSE 首行', why: 'GPL 条款标题；MIT 产物出现它 = GPL 文本整体流入' },
  { id: 'gpl-spdx', re: /SPDX-License-Identifier:\s*GPL-3\.0/, src: 'LICENSE:697', why: '渲染器 SPDX 标识；插件若带此标识 = 自认 GPL 代码' },
  { id: 'renderer-copyright', re: /Copyright \(C\) 2026 XHR666/, src: 'LICENSE', why: '渲染器版权行（大小写敏感）；插件 LICENSE 是 `Copyright (c) 2026 dsh-mpkg-wallpaper contributors`，两者不同' },
  { id: 'renderer-pkg-name', re: /wallpaper-engine-web-loader/, src: 'package.json:2', why: '渲染器 npm 包名；出现在插件产物里即意味着渲染器包内文本被搬入。若将来只作**署名引注**（如 README 写"配套渲染器"），必须登记进下面的例外清单并写明理由，不得静默放宽' },
  { id: 'ident-spriteFrameImageRects', re: /\bspriteFrameImageRects\b/, src: 'core/we-scene-bundle.js:348', why: '渲染器内部导出：WE 精灵表 frameValue → 图块矩形（项目特有概念，不是任何公开 API 名）' },
  { id: 'ident-spriteMultiImages', re: /\bspriteMultiImages\b/, src: 'core/we-scene-bundle.js:307', why: '渲染器内部导出：多图精灵预算（`SPRITE_SET_BUDGET`），项目特有' },
  { id: 'ident-coerceImageAlphaMode', re: /\bcoerceImageAlphaMode\b/, src: 'core/we-scene-bundle.js:968', why: '渲染器内部导出：WE `alpha mode` 语义归一（0..1 / 0..100 值域），项目特有' },
  { id: 'ident-evalPropAnimation', re: /\bevalPropAnimation\b/, src: 'core/we-scene-bundle.js:812', why: '渲染器内部导出：属性关键帧求值入口（五条标识符里判别力最弱的一条，仍保留 —— 独立实现不会撞出同名**导出**）' },
  { id: 'ident-slotOfTimeLayer', re: /\bslotOfTimeLayer\b/, src: 'core/we-scene-bundle.js:1236', why: '渲染器内部导出：WE 时间层时段解析，项目特有命名' },
]
// 例外清单：只允许**具名、有理由**的共享契约/署名字符串（空数组 = 无例外）。**当前实测为空**：
//   插件发布物里确有渲染器**路径/文档**引注（如 `we-scene-demo/RENDERER-SANDBOX-CONTRACT.md`、`we-scene-demo/docs/DATA-LIMITS.md`）
//   与裸 `GPL-3.0` 的具名引注（`lib/web-wallpaper.js:19` 写明"只走 HTTP 协议，不 import/内嵌其任何代码"、
//   `README.md:391` 的 unmpkg 上游许可），但它们**不在**上面的指纹集里 —— 它们是署名/事实引注，不是渲染器代码指纹。
//   若将来确有**共享契约**字符串被镜像（`docs/COPYING-RULES.md` 或 `core/web-frame-geometry.mjs` 里登记的协议 token），
//   在此逐条登记 `{ id, files: ['*'], reason: '…' }`；`reason` 为空的条目会被忽略并告警（禁止"静默放宽"）。
const REVERSE_FLOW_EXCEPTIONS = [
  // ①(2026-10-30 聚合分发，具名豁免) `LICENSES/GPL-3.0-or-later.txt` 是**随包分发的 GPL 全文本体**
  //   （任务单 P1；GPLv3 §4 要求再分发时随附许可全文）——它命中 GPL 文本类指纹是"声明本身"，不是渲染器代码。
  //   豁免范围只限这一个文件：`lib/**`、README、THIRD-PARTY 等其余 MIT 面文件出现同类指纹**仍然照红**。
  { id: 'gpl-title', files: ['LICENSES/GPL-3.0-or-later.txt'], reason: '该文件是随包分发的 GPLv3 许可全文本体（聚合分发必须随附），命中 GPL 标题属声明而非代码' },
  { id: 'gpl-spdx', files: ['LICENSES/GPL-3.0-or-later.txt'], reason: '同上：GPL 全文末尾的 SPDX 标识行随许可文本一起分发' },
  { id: 'renderer-copyright', files: ['LICENSES/GPL-3.0-or-later.txt'], reason: '同上：GPL 全文附带的版权行（FSF/渲染器作者），属许可文本本体' },
]
// npm `files` 用 minimatch 语义：`**/` 可匹配 0 层目录（`lib/**/*.bak*` 必须能命中 `lib/client.js.bak-*`）
const pluginGlobRe = (g) => {
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*' }
      else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}
// ── [assert:reverse-flow] BEGIN ──
if (fs.existsSync(PLUGIN_DIR)) {   // 独立发布本仓库时插件目录不存在 → ⑤② 已有的告警已覆盖，这里不重复报
  const reverseFlow = (() => {
    let pkg = null
    try { pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf8')) } catch { return { skip: 'package.json 读取/解析失败（无法确定发布面）' } }
    const entries = Array.isArray(pkg.files) ? pkg.files.map(String) : []
    if (!entries.length) return { skip: 'package.json.files 为空（无法确定发布面）' }
    // (a) 读**发布文件清单**：package.json.files（含 `!` 负向规则），纯 fs 展开 —— 不跑 npm、不碰插件工作树
    const excRes = entries.filter((e) => e.startsWith('!')).map((e) => pluginGlobRe(e.slice(1)))
    const listed = new Set()
    const add = (p) => { const r = path.relative(PLUGIN_DIR, p).split(path.sep).join('/'); if (!excRes.some((re) => re.test(r))) listed.add(p) }
    for (const e of entries.filter((x) => !x.startsWith('!'))) {
      const abs = path.join(PLUGIN_DIR, e)
      let st = null
      try { st = fs.lstatSync(abs) } catch { continue }
      if (st.isDirectory()) {
        const stack = [abs]
        while (stack.length) {
          const d = stack.pop()
          let ents = []
          try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
          for (const x of ents) {
            const p = path.join(d, x.name)
            let s2 = null
            try { s2 = fs.lstatSync(p) } catch { continue }
            if (s2.isDirectory()) stack.push(p)
            else if (s2.isFile()) add(p)
          }
        }
      } else if (st.isFile()) add(abs)
    }
    const publishFiles = [...listed].sort()
    // (b) 逐文件扫渲染器指纹（只扫文本；二进制跳过但计入口径）
    // ②(2026-10-30 随"渲染器并入插件工作区"演进，留痕) 插件发布面现在**有意**含 `renderer/**`
    //   （任务单 P1：随包分发的 GPL 渲染器，其指纹由 renderer/LICENSE / 打包判据负责）。
    //   本断言的牙齿 = **MIT 面**（renderer/** 之外的发布文件，lib/** 与顶层文件）不许出现渲染器指纹
    //   —— 那才是"GPL 代码抄进 MIT 侧"的信号。`renderer/**` 整体跳过，不算放宽：它自带完整许可与来源声明。
    const mitPublishFiles = publishFiles.filter((p) => {
      const r = path.relative(PLUGIN_DIR, p).split(path.sep).join('/')
      return !(r === 'renderer' || r.startsWith('renderer/'))
    })
    const hits = []
    let textScanned = 0
    for (const p of mitPublishFiles) {
      let s = ''
      try { if (fs.statSync(p).size > 2 * 1048576) continue; s = fs.readFileSync(p, 'utf8') } catch { continue }
      if (s.includes('\u0000')) continue
      textScanned++
      const lines = s.split('\n')
      const rp = path.relative(PLUGIN_DIR, p).split(path.sep).join('/')
      for (let i = 0; i < lines.length; i++) {
        for (const fp of RENDERER_FINGERPRINTS) {
          if (!fp.re.test(lines[i])) continue
          const ex = REVERSE_FLOW_EXCEPTIONS.find((x) => x.id === fp.id && String(x.reason || '').trim() && (x.files || ['*']).some((g) => pluginGlobRe(g).test(rp)))
          if (ex) continue
          hits.push({ fp, file: rp, line: i + 1 })
        }
      }
    }
    const emptyReason = REVERSE_FLOW_EXCEPTIONS.filter((x) => !String(x.reason || '').trim()).map((x) => x.id)
    // 敏感度自检：每条指纹至少要命中一个**渲染器**样本文件，否则正则写错时断言会静默变哑
    const SENS = ['LICENSE', 'package.json', 'core/we-scene-bundle.js', 'core/web-frame-geometry.mjs']
    const sensTexts = SENS.map((f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8') } catch { return '' } })
    const weak = RENDERER_FINGERPRINTS.filter((fp) => !sensTexts.some((t) => fp.re.test(t))).map((fp) => fp.id)
    return { publishFiles, mitCount: mitPublishFiles.length, textScanned, hits, emptyReason, weak, sensTotal: RENDERER_FINGERPRINTS.length - weak.length }
  })()
  if (reverseFlow.skip) {
    findings.warnings.push({ kind: 'reverse-flow', file: '../dsh-mpkg-wallpaper/package.json', msg: `反向流动断言跳过：${reverseFlow.skip}` })
  } else {
    if (reverseFlow.hits.length) findings.blocking.push({ kind: 'reverse-flow', file: '../dsh-mpkg-wallpaper/' + reverseFlow.hits[0].file + ':' + reverseFlow.hits[0].line, msg: `MIT 插件发布物里出现渲染器（GPL）指纹 ${reverseFlow.hits.length} 处 → 违反 COPYING-RULES §2.2"GPL 不得流入 MIT 插件"（` + fmtList(reverseFlow.hits.map((h) => `${h.fp.id}@${h.file}:${h.line}`)) + `）` })
    if (reverseFlow.emptyReason.length) findings.warnings.push({ kind: 'reverse-flow', file: 'tests/publish-check.mjs', msg: `例外清单条目缺 reason（已忽略，禁止静默放宽）：${reverseFlow.emptyReason.join('、')}` })
    if (reverseFlow.weak.length) findings.warnings.push({ kind: 'reverse-flow-selftest', file: 'tests/publish-check.mjs', msg: `指纹敏感度自检：${reverseFlow.weak.join('、')} 在渲染器样本（LICENSE、package.json、core/we-scene-bundle.js、core/web-frame-geometry.mjs）里 0 命中 → 正则可能失效（断言变哑）` })
    findings.info.push({ kind: 'reverse-flow', msg: `反向流动断言已执行：插件 package.json.files 展开 ${reverseFlow.publishFiles.length} 个发布文件（MIT 面 ${reverseFlow.mitCount} 个被扫，renderer/** ${reverseFlow.publishFiles.length - reverseFlow.mitCount} 个按聚合分发豁免；文本 ${reverseFlow.textScanned} 个被扫；指纹 ${RENDERER_FINGERPRINTS.length} 条，敏感度自检 ${reverseFlow.sensTotal}/${RENDERER_FINGERPRINTS.length}；例外 ${REVERSE_FLOW_EXCEPTIONS.length} 条）→ 命中 ${reverseFlow.hits.length} 条` })
  }
}
// ── [assert:reverse-flow] END ──

// ③ 复制/许可规则文档与第三方声明必须随仓库
const COPYING_CANDIDATES = [path.join(ROOT, 'docs', 'COPYING-RULES.md'), path.join(ROOT, '..', 'docs', 'COPYING-RULES.md')]
const COPYING_HIT = COPYING_CANDIDATES.find((p) => fs.existsSync(p))
if (!COPYING_HIT) findings.blocking.push({ kind: 'license', file: 'docs/COPYING-RULES.md', msg: '单向流动规则/借鉴台账文档缺失（本仓库 docs/ 或工作区 docs/ 都没有）' })
else findings.info.push({ kind: 'license', msg: '复制规则台账：' + path.relative(ROOT, COPYING_HIT) + '（+ THIRD-PARTY.md）' })
if (!fs.existsSync(path.join(ROOT, 'THIRD-PARTY.md'))) findings.blocking.push({ kind: 'license', file: 'THIRD-PARTY.md', msg: '第三方声明缺失' })

// ④ vendored webwallgl（若有）必须带 MIT 声明；字体许可文件必须齐全
const webwallglFiles = files.filter((p) => /webwallgl/i.test(rel(p)))
if (webwallglFiles.length) {
  const withMit = webwallglFiles.some((p) => /(^|\/)(LICENSE|COPYING)/i.test(rel(p)) && /MIT/i.test((() => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } })()))
  if (!withMit) findings.blocking.push({ kind: 'license', file: rel(webwallglFiles[0]), msg: 'Vendored webwallgl 未随附 MIT 声明（缺 LICENSE/COPYING 或其中无 MIT 字样）' })
  else findings.info.push({ kind: 'license', msg: `Vendored webwallgl：${webwallglFiles.length} 个文件，MIT 声明在位` })
} else {
  findings.info.push({ kind: 'license', msg: 'Vendored webwallgl：未 vendored（仓库外研读副本）→ 无需随附声明；将来引入必须登记 THIRD-PARTY.md' })
}
// ④b (P-93) **任何 `vendor/<x>/` 下的 vendored 代码都必须带自己的许可全文**：
//   ④ 那条是按"路径里含 webwallgl"抓的（历史写法），抓不到"上游文件被改名后放进我们自己的目录"
//   这类 vendoring —— P-93 的 `vendor/hlsl2glsl/` 正是如此（路径里没有上游名，于是 ④ 只报了 1 个文件）。
//   这里补一条**目录级**规则：`vendor/*/` 里只要有代码文件，就必须 ① 有 LICENSE/COPYING 且含许可关键字、
//   ② 在 `THIRD-PARTY.md` 里被点名（否则"已署名"只是口头承诺，删掉声明也没人拦）。
const vendorDir = path.join(ROOT, 'vendor')
if (fs.existsSync(vendorDir)) {
  const thirdPartyText = (() => { try { return fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8') } catch { return '' } })()
  for (const d of fs.readdirSync(vendorDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const dp = path.join(vendorDir, d.name)
    let ents = []
    try { ents = fs.readdirSync(dp) } catch { continue }
    const code = ents.filter((n) => /\.(js|mjs|cjs|ts|tsx|glsl|vert|frag|h|inc)$/i.test(n))
    if (!code.length) continue
    const lic = ents.find((n) => /^(LICENSE|COPYING|NOTICE)/i.test(n))
    const licText = lic ? (() => { try { return fs.readFileSync(path.join(dp, lic), 'utf8') } catch { return '' } })() : ''
    const hasSpdx = /MIT|ISC|Apache|BSD|OFL|GPL|CC-BY|zlib|Unlicense/i.test(licText)
    if (!lic || !hasSpdx) findings.blocking.push({ kind: 'license', file: 'vendor/' + d.name + '/', msg: 'vendored 代码缺少许可全文（需 LICENSE/COPYING 且含 MIT/ISC/Apache/… 关键字）' })
    else if (!thirdPartyText.includes(d.name)) findings.blocking.push({ kind: 'license', file: 'vendor/' + d.name + '/', msg: `THIRD-PARTY.md 未点名 vendored 目录 "${d.name}"（署名必须随仓库分发）` })
    else findings.info.push({ kind: 'license', msg: `Vendored 目录 vendor/${d.name}/：${code.length} 个代码文件，${lic} 在位且 THIRD-PARTY.md 已点名` })
  }
}

const fontsDir = path.join(ROOT, 'assets', 'fonts')
const fontLicDir = path.join(fontsDir, 'licenses')
if (!fs.existsSync(fontLicDir)) findings.blocking.push({ kind: 'license', file: 'assets/fonts/licenses/', msg: '字体许可目录缺失（OFL/Apache/CC-BY 全文必须随仓库）' })
else {
  const licFiles = fs.readdirSync(fontLicDir)
  const need = [
    ['OFL 全文', (n) => /OFL/i.test(n)],
    ['Apache-2.0 全文', (n) => /^Apache-2\.0\.txt$/i.test(n)],
    ['CC-BY-4.0 归属声明', (n) => /^CC-BY-4\.0/i.test(n)],
  ]
  const missing = need.filter(([, f]) => !licFiles.some(f)).map(([label]) => label)
  if (missing.length) findings.blocking.push({ kind: 'license', file: 'assets/fonts/licenses/', msg: '字体许可文件缺失：' + missing.join('、') + `（现有 ${licFiles.length} 个）` })
  else findings.info.push({ kind: 'license', msg: `字体许可：${licFiles.length} 个文件（OFL 全文 / Apache-2.0 / CC-BY-4.0 归属都在位）；逐文件 SPDX 与来源证据见 THIRD-PARTY.md §4.1（目录级 SPDX：OFL-1.1 AND CC-BY-4.0 AND LicenseRef-BVFonts-Freeware-2006）` })
  const fontFiles = fs.readdirSync(fontsDir).filter((n) => /\.(ttf|otf)$/i.test(n))
  if (!fontFiles.length) findings.warnings.push({ kind: 'license', file: 'assets/fonts/', msg: '未发现随仓库分发的字体文件（若已全部移除，请同步清理 THIRD-PARTY.md §4 与 assets/fonts/README.md）' })
}

// ── 输出 ──
findings.coverage = coverage   // ①(PA-45) 覆盖面积机读字段（--json 与 warnings 同一份数据，不另算一套）
if (JSON_OUT) { console.log(JSON.stringify(findings, null, 1)); process.exit(findings.blocking.length ? 1 : 0) }
for (const f of findings.info) console.log('· ' + (f.file ? f.file + ' — ' : '') + f.msg)
// ③-3 打印时附 `note`（证据引用/复核结论）。**命中的行数与退出码都不变** —— 见文件头 ③-0 的说明。
for (const w of findings.warnings.slice(0, 20)) { console.log('  ⚠ ' + w.file + ' — ' + w.msg); if (w.note) console.log('      note=' + w.note) }
if (findings.warnings.length > 20) console.log(`  …还有 ${findings.warnings.length - 20} 条`)
if (findings.blocking.length) {
  const reviewed = findings.blocking.filter((b) => b.note).length
  console.log(`\n✗ 阻塞项 ${findings.blocking.length} 条（发布前必须处理${reviewed ? `；其中 ${reviewed} 条带 note = 已复核来源，仍需逐条人工确认` : ''}）：`)
  for (const b of findings.blocking.slice(0, 30)) { console.log('  ✗ ' + b.file + ' — ' + b.msg); if (b.note) console.log('      note=' + b.note) }
  console.log('\n提示：把"删除候选"移入 ../Delete/ 而不是删除；改造完重跑本脚本直到 0 阻塞项，再由用户确认发布。')
  console.log('说明：带 note=（REVIEWED）的条目**不是**静默放行 —— 它们仍逐条打印、仍需人工复核 `note` 指向的证据后才能进入下一步；note 的证据引用格式见 THIRD-PARTY.md §4.1/§4A。')
  process.exit(1)
}
console.log('\n✓ 无阻塞项：可以进入人工复核（**发布仍需用户明确确认**）')

// pack-closure-test.mjs —— **发布面闭合性**门禁：真打一个 tarball、解开、把入口**真的 import 一次**，
//   再静态核对"代码里引用的相对模块与 URL 资源都在包里"。反方向也查：包里不许有"发了但谁也引不到"的运行时代码。
//
// 为什么需要它（2026-09-20 真实事故：0.2.0 已经发出去才发现）：
//   `package.json.files` 是**白名单**：新增源文件如果没人往白名单里加，它就不会进 tarball。
//   0.1.1 → 0.2.0 之间新增了 `core/we-pointer-source.mjs`、`core/we-particle-pointer.mjs`、
//   `server/pkg-entry-index.mjs`，三张都**没**进白名单 ⇒ 装下来的包一 `import` 就炸：
//     Cannot find module '…/core/we-particle-pointer.mjs' imported from '…/core/we-scene-bundle.js'
//   `packaging-test.mjs` 查的是"白名单里每条路径**存在**"（方向反了）：它管不了"代码 import 了但白名单里没有"。
//   本文件补上那个反方向，而且**以真实装载为准**（静态扫描只当第二道网）。
//
// 判据（任一不满足 ⇒ 退出码 1）：
//   A `npm pack --pack-destination <tmp> --json` 真打包 ⇒ 清单非空 + `main`/`exports` 目标都在包里；
//   B **真装载**（决定性判据）：解开 tarball
//     B1 `core/we-scene.mjs` / `core/we-scene-bundle.js` / `vendor/hlsl2glsl/hlsl2glsl.js` 三个入口
//        在**解开的包内**能被 `import()` 起来（消费者第一件事就是这个）；
//     B2 两个服务入口（`server/we-scene-demo-server.mjs`、`…-8902.mjs`）能在包内**启动到打印 banner**
//        且 stderr 没有 `Cannot find module` / `ERR_MODULE_NOT_FOUND`（跑 `PORT=0`，验完即杀）；
//   C 静态核对（第二道网，覆盖 URL 资源与 HTML 引用）：
//     C1 从入口走相对 import 闭包，每条都要在包里解析到；
//     C2 代码/页面里引用的**绝对 URL** 都能映射到包内文件（服务端挂载口径 + 下面那张别名表）；
//     C3 两份**明确不随包发布**的引用登记在案（每条给出理由与"谁引用"）；
//   D 反向：包里的运行时代码不许有"谁也引不到"的死文件；
//   E 复现力自证：把一条**被 import 的模块**从包里删掉（模拟"新增文件忘了进白名单"）⇒ B1 必须变红。
//
// 用法: node tests/pack-closure-test.mjs [--json]
// 退出码：0 全绿 / 1 有失败
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const JSON_OUT = process.argv.includes('--json')

let pass = 0, fail = 0
const results = []
const check = (name, cond, detail = '') => {
  const ok = !!cond
  results.push({ name, ok, detail: String(detail).slice(0, 400) })
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + String(detail).slice(0, 220) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  [' + String(detail).slice(0, 400) + ']' : '')) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-packclosure-'))
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp 清不掉不致命 */ } })

// ── A 真打包 ───────────────────────────────────────────────────────────────────────────────────────
const packOut = execFileSync('npm', ['pack', '--pack-destination', tmp, '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 })
const packInfo = JSON.parse(packOut)[0] || {}
const tgz = path.join(tmp, String(packInfo.filename || ''))
const shipped = (packInfo.files || []).map((f) => String(f.path).replace(/\\/g, '/')).filter(Boolean)
const shippedSet = new Set(shipped)
check('A1 `npm pack` 打出 tarball 且清单非空（发布面以 npm 自己的展开为准）',
  fs.existsSync(tgz) && shipped.length > 50, `${packInfo.filename} · ${shipped.length} 个文件 · ${(packInfo.size / 1048576).toFixed(2)}MB`)

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const exportTargets = []
for (const v of Object.values(pkg.exports || {})) {
  if (typeof v === 'string') exportTargets.push(v)
  else if (v && typeof v === 'object') for (const t of Object.values(v)) if (typeof t === 'string') exportTargets.push(t)
}
const jsEntries = [...new Set([pkg.main, ...exportTargets].filter(Boolean).map((s) => s.replace(/^\.\//, '')))]
const missingEntries = jsEntries.filter((e) => e !== 'package.json' && !shippedSet.has(e))
check('A2 `main` 与 `exports` 的每个目标都在包里（入口本身先别缺）', jsEntries.length >= 4 && missingEntries.length === 0,
  '入口=' + jsEntries.join(',') + (missingEntries.length ? ' —— 缺:' + missingEntries.join(',') : ''))

// ── B 真装载（决定性判据）──────────────────────────────────────────────────────────────────────────
const extract = path.join(tmp, 'x')
fs.mkdirSync(extract, { recursive: true })
execFileSync('tar', ['-xzf', tgz, '-C', extract], { stdio: ['ignore', 'pipe', 'pipe'] })
const PKG = path.join(extract, 'package')
check('B0 tarball 解开后是 `package/`（布局符合 npm 约定）', fs.existsSync(path.join(PKG, 'package.json')), PKG)

/** 在**解开的包内**真 import 三个入口。子进程做：一个入口炸了不影响其余，且不会污染本进程的模块缓存。 */
const importScript = `
const list = ${JSON.stringify(['core/we-scene.mjs', 'core/we-scene-bundle.js', 'vendor/hlsl2glsl/hlsl2glsl.js'])}
const out = []
for (const rel of list) {
  try { const m = await import(new URL(rel, ${JSON.stringify(pathToFileURL(PKG).href + '/')})); out.push({ rel, ok: true, exports: Object.keys(m).length }) }
  catch (e) { out.push({ rel, ok: false, err: (e && (e.code || e.message)) || String(e) }) }
}
console.log('IMPORT-JSON ' + JSON.stringify(out))
`
const imp = spawnSync(process.execPath, ['--input-type=module', '-e', importScript], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 })
const impLine = (imp.stdout || '').split('\n').filter((l) => l.startsWith('IMPORT-JSON ')).pop()
let impRows = []
try { impRows = JSON.parse(impLine.slice('IMPORT-JSON '.length)) } catch { impRows = [] }
const badImports = impRows.filter((r) => !r.ok)
check('B1 **消费者视角**：`import("wallpaper-engine-web-loader")` 那三个入口在解开的包里真的能 import 起来',
  impRows.length === 3 && badImports.length === 0,
  badImports.length ? badImports.map((r) => r.rel + ' ⇒ ' + r.err).join(' ; ') : impRows.map((r) => r.rel + '(' + r.exports + ' 导出)').join(' · '))
/** 服务入口：跑 `PORT=0` 到打印 banner；只看 stderr 有没有"找不到模块"。 */
for (const rel of ['server/we-scene-demo-server.mjs', 'server/we-scene-demo-server-8902.mjs']) {
  const r = spawnSync(process.execPath, [path.join(PKG, rel)], {
    encoding: 'utf8', timeout: 9000, maxBuffer: 32 * 1024 * 1024,
    // ⚠ MPW_ROOT 用**真工作区根**（`<repo>/..`）：README「自带服务器需要一个包解析器（MIT 插件
    //   dsh-mpkg-wallpaper 的 lib/pkg-extract.js）：把它与渲染器放在同一父目录即可」—— 这正是本仓的布局；
    //   语料根指到不存在的目录（不读用户壁纸），reports 落 tmp（不写工作区）。
    env: { ...process.env, PORT: '0', MPW_SCENE_ROOT: path.join(tmp, 'no-corpus'), MPW_ROOT: path.resolve(ROOT, '..'), MPW_REPORTS_DIR: path.join(tmp, 'reports'), MPW_OPEN_CMD: '/bin/true' },
  })
  const err = String(r.stderr || '')
  const out = String(r.stdout || '')
  const bad = /Cannot find module|ERR_MODULE_NOT_FOUND/.test(err + out)
  check('B2 服务入口在包内能启动（`' + rel + '`，PORT=0）：stderr 无"找不到模块"',
    !bad, bad ? (err + out).split('\n').filter((l) => /Cannot find module|ERR_MODULE_NOT_FOUND/.test(l)).slice(0, 2).join(' | ') : '已跑到 banner 后被杀（timeout=' + (r.error && r.error.code) + '）')
}

// ── C 静态核对（第二道网）──────────────────────────────────────────────────────────────────────────
/** 只删**行首/块**注释：避免"注释里出现 import 字样"造成假红；用状态机而不是正则，免得字符串里的 `/*` 把代码吃掉。 */
function stripJsComments(src) {
  let out = '', i = 0, mode = null   // mode: null | "'" | '"' | '`' | '//' | '/*'
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (mode === null) {
      if (c === '/' && n === '/') { mode = '//'; i += 2; continue }
      if (c === '/' && n === '*') { mode = '/*'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') mode = c
      out += c; i++; continue
    }
    if (mode === '//') { if (c === '\n') { mode = null; out += c } i++; continue }
    if (mode === '/*') { if (c === '*' && n === '/') { mode = null; i += 2; continue } if (c === '\n') out += c; i++; continue }
    // 字符串/模板里：照抄，处理转义与闭合
    if (c === '\\') { out += c + (n || ''); i += 2; continue }
    if (c === mode) mode = null
    out += c; i++
  }
  return out
}
const CAND = (t) => [t, t + '.mjs', t + '.js', t + '.cjs', t + '.json', t + '/index.mjs', t + '/index.js', t + '/index.json']
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.\.?\/[^'"]+)['"]/g
const HTML_REF_RE = /(?:src|href)\s*=\s*["'](\.\.?\/[^"']+)["']/g
const URL_REF_RE = /['"`](\/[A-Za-z0-9._@-][A-Za-z0-9._@/-]*\.(?:mjs|js|cjs|json|html|css|wasm|png|jpg|jpeg|gif|webp|svg|ttf|otf|woff2?|pkg|mpkg))['"`]/g
/** 显然**不是包内资源**的宿主路径前缀（运行期临时目录/用户目录）：扫到就跳过，别当成"包缺文件"。 */
const HOST_PATH_PREFIXES = ['/tmp/', '/var/', '/root/', '/home/', '/data/', '/proc/', '/dev/']
/** 服务端挂载口径：`/x` ⇒ 仓库根 / `web/` / `core/` / `assets/`（都是真存在的映射，见 server/**）。 */
const URL_MOUNT_TRIES = [(u) => u.replace(/^\//, ''), (u) => 'web/' + u.replace(/^\//, ''), (u) => 'core/' + u.replace(/^\//, ''), (u) => 'assets/' + u.replace(/^\//, '')]
/** **服务端别名路由**：URL ≠ 包内路径，但服务端把它映射到某个真文件。
 *  这里**从服务端源码自动提取**（`path.join(CORE_DIR, 'x')` 那几行就是"根 URL ⇒ core/ 下文件"的映射表），
 *  免得手抄一张会腐烂的表；提取不到任何一条时判据会红（说明服务端改了写法，得回来看这里）。 */
function coreAliasesFromServer() {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'we-scene-demo-server.mjs'), 'utf8')
  const m = new Map([['/bundle.js', { file: 'core/we-scene-bundle.js', why: '服务端把 /bundle.js 映射到 core/we-scene-bundle.js（产物根文件名约定）' }]])
  const re = /path\.join\(CORE_DIR,\s*'([^']+)'\)/g
  let x
  while ((x = re.exec(src))) m.set('/' + x[1], { file: 'core/' + x[1], why: 'server/we-scene-demo-server.mjs 的 CORE_DIR 路由表' })
  return m
}
const URL_ALIASES = coreAliasesFromServer()
check('C0 服务端别名表能从源码提取到（`CORE_DIR` 路由）', URL_ALIASES.size >= 5, [...URL_ALIASES.keys()].join(' '))
/** 明确**不随包发布**的引用（每条都要写清理由；判据要求那句话真的能在引用文件里找到，防"白名单变遮羞布"）。 */
const NOT_SHIPPED_OK = [
  /* ①(2026-10-12 集成修正 **按意图订正**)：本轮 C2 报的那 4 条 `… → /effect.json` **根本不是绝对 URL** ——
     它们是**相对资产路径被三段拼接切出来的片段**：`'effects/' + <dir> + '/effect.json'`（内置效果
     「磁流体 cuiliuti」的资产相对路径，`WE_BUILTIN_EFFECT_FILES` 的键口径）。`URL_REF_RE` 只看形状
     （引号后紧跟 `/` + 已知扩展名收尾）⇒ 片段撞上了它。**所以修法在代码侧**（core/we-scene-bundle.js
     与 demo.html 把整条路径写进一个模板串：运行期字符串逐字节不变，只是字面量里不再有"长得像绝对
     URL"的片段）。**不要**在这里登记 `/effect.json`，两个理由：
       ① 那条 URL 在代码里**根本不存在** —— 登记要写"它为什么不是磁盘文件"，只能编（`why` 会描述成
          `effects/<dir>/effect.json` 那个**相对**路径，与被登记的 `/effect.json` 不是同一个东西）；
       ② 登记即豁免（`x.url === u && x.in === rel && raw.includes(u)`）⇒ 这两个文件里**任何**真正的
          `/effect.json` 引用会被永久放行，判据就在这里放空。真·运行期生成、不对应磁盘文件的确实有：
          `effects/<dir>/effect.json`（内存表生成、包内与 `/weassist` 双 miss），但它**是相对路径**，
          C2 只认以 `/` 开头的字符串 ⇒ 本来就管不着它，不需要（也不该）登记。
     变异自证（本轮实测）：把任一处改回三段拼接 ⇒ C2 立刻变红；塞一条**真**绝对 URL
     （如 `fetch('/effects/wwgl_cuiliuti/effect.json')`）⇒ C2 也变红（证明这里不登记没有把判据放空）。
     ⭐ 上面这三条读数**已不是注释**：`MPW_PACKCLOSURE_MUTATE=1` 跑本文件末的 §M 段（M-a/M-b/M-c，
     逐条打印"期望 == 实际"；缺省不跑、C2 读数一字不变）。 */
  { url: './demo/', in: 'index.html', why: '测试台目录（66MB，含本机构建残留）按 docs/RELEASE.md §5 不进 tarball；落地页那条链接在包里会 404，是已登记的口径' },
  /* `index.html:12-14` 三条品牌图 `<link>`（32 / 192 / apple-touch 同 192）与上面 `./demo/` **完全同类**，故同一口径登记：
     ①产物侧成立：`build-pages.mjs` 的 `['web/icons', 'icons']` 把真源 `web/icons/**` 拷成产物根的 `./icons/*`；
     ②npm 包白名单（`package.json.files`）只有 `web/icons/`、不含根 `icons/` ⇒ tarball 里这两条会 404。
     真源唯一（`web/icons/**`），仓库根**不再**留第二份品牌图副本。 */
  { url: './icons/brand-32.png', in: 'index.html', why: `由构建产物提供、不进 npm 包：build-pages.mjs 的 ['web/icons', 'icons'] 把真源 web/icons/** 拷成产物 ./icons/*；package.json.files 白名单不含根 icons/，与 ./demo/ 那条同类` },
  { url: './icons/brand-192.png', in: 'index.html', why: `同上（index.html:13-14 两条 link 共用这一份 192 图，故只需登记一条 url）` },
  { url: './demo/mpw-select.js', in: 'demo.html', why: '测试台自绘下拉：demo.html 引用它，但测试台整体不进包（同上）' },
  { url: './demo/mpw-select-math.mjs', in: 'demo.html', why: '同上一行' },
  { url: '/diag-flags.json', in: 'web/sw-policy.mjs', why: '面板开关数据源随站点外壳发布，不在 npm 运行面（docs/PACKAGING.md 的白名单口径）' },
  { url: '/demo/mpw-select.js', in: 'web/sw-policy.mjs', why: '测试台自绘下拉，属测试台（同上不进包）' },
  { url: '/demo/mpw-select-math.mjs', in: 'web/sw-policy.mjs', why: '测试台自绘下拉的纯函数模块（同上不进包）' },
  { url: '/demo/mpw-select.js', in: 'web/sw.js', why: 'SW 自己的预缓存清单里也列了测试台那两个模块（同上不进包）' },
  { url: '/demo/mpw-select-math.mjs', in: 'web/sw.js', why: '同上一行' },
  { url: '/diag-flags.json', in: 'server/we-scene-demo-server.mjs', why: '服务端的静态路由表里登记了这个数据源（随站点外壳发布，不在 npm 运行面）' },
  /* ①(2026-09-24 P-177「:8902 自给自足」那轮) `:8902` 现在也**本地直供**渲染器根路由（不再只反代 :8899）⇒
     `RENDERER_LOCAL_EXACT` 里新增了 `/diag-flags.json`，于是这条 URL 多出第三个引用点（C2 因此变红）。
     为什么仍是"不进包"（与上面 8899 / sw-policy 两条同口径，且这不是偷懒）：`web/diag-flags.json` 是
     **开发期生成物** —— 由 `tests/diag-flag-check.mjs` 从源码抓取后写出（只读代码 + 只写这一个文件），
     随站点外壳发布；`package.json.files` 白名单里没有它，面板离线时用 client.js 的**内置副本**
     （`tools/panel-smoke.mjs` 断言两者集合一致，见 docs/README-DIAGNOSTICS.md「与面板/校验的关系」）。
     代价（讲清楚，别含糊）：npm 包内单独 `node server/we-scene-demo-server-8902.mjs` 时这条 URL 会 404 ⇒
     面板速查区回落到内置副本（功能不缺，只少了"在线数据源"；与 8899 在包内的行为逐字相同）。
     另一条路（加进 `package.json.files`）被否：那会把一份带 `generatedAt` 时间戳的**开发期快照**
     永久冻进 tarball，且与 sw-policy 那条"面板数据源不进包"的既有登记自相矛盾。
     防腐烂：下面 C2b 断言这个文件**确实不在包里**（哪天它进了包，这条登记就成了遮羞布 ⇒ 必须回来删）。 */
  { url: '/diag-flags.json', in: 'server/we-scene-demo-server-8902.mjs', why: '`:8902` 本地直供的渲染器静态路由（RENDERER_LOCAL_EXACT）登记了这个数据源；它是开发期生成物（tests/diag-flag-check.mjs 产出）随站点外壳发布、不在 npm 运行面 ⇒ 面板离线用内置副本，代价 = 包内这条 404（与 8899 逐字同口径）' },
  { url: '/demo/mpw-select.js', in: 'server/we-scene-demo-server.mjs', why: '服务端的静态路由表里提到测试台模块（测试台不进包）' },
  { url: '/demo/mpw-select-math.mjs', in: 'server/we-scene-demo-server.mjs', why: '同上一行' },
  /* `:8902` 服务里那条**产物写死的 iframe 路径**指向的是上游渲染器产物（在 `demo/assets/**` 里），
     而 `demo/` 整体不进 tarball（见 docs/RELEASE.md §5）⇒ 与上一条同一口径；服务自己会以 404 如实回应。 */
  { url: '/wallpaper-engine-webgl/renderer/index.html', in: 'server/we-scene-demo-server-8902.mjs', why: '测试台 iframe 写死的渲染器页路径：产物在 demo/（按 docs/RELEASE.md §5 不进包）' },
]
/** 明确**依赖包外**的引用（下游自备，理由要与仓库文档逐字对得上，判据会去核对那句 needle）。 */
const EXTERNAL_OK = [
  {
    url: '/dsh-mpkg-wallpaper/lib/pkg-extract.js', in: 'server/we-scene-demo-server.mjs',
    why: '包解析器是**另一个仓库**（MIT 插件）；README「直接从源码跑」节写明：把它与渲染器放同一父目录，或用 MPW_PKG_EXTRACT= 指定',
    needleIn: 'README.md', needle: 'MPW_PKG_EXTRACT',
  },
]
const htmlEntries = shipped.filter((f) => /\.html$/.test(f))
/* ①(`:8902` 服务是**随包发布但不在 `exports` 里**的独立入口：`node server/we-scene-demo-server-8902.mjs`）
   ⇒ 它必须也当闭包根：否则它 import 的东西（例如 `server/upload-policy.mjs`）会被 D1 判成"发了没人引用的死文件"
   （实测踩到）。这条与 `DYNAMIC_OK` 里的"文档登记的独立入口"是同一条事实，两处都要一致。 */
const standaloneEntries = shipped.filter((f) => f === 'server/we-scene-demo-server-8902.mjs')
const entries = [...jsEntries, ...htmlEntries, ...standaloneEntries]

function closure(fileSet, entryList) {
  const visited = new Set()
  const missingImports = []
  const missingUrls = []
  const visit = (rel) => {
    if (visited.has(rel)) return
    visited.add(rel)
    let raw = ''
    try { raw = fs.readFileSync(path.join(PKG, rel), 'utf8') } catch { try { raw = fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch { return } }
    if (!/\.(mjs|js|cjs|html|htm)$/.test(rel)) return
    const src = stripJsComments(raw)
    let m
    /** 解析一个相对说明符：先当文件系统路径，再当**服务端 URL 别名**（`./bundle.js`、`../../we-scene-bundle.js`
     *  这类在文件系统里不存在，但服务端按 URL 映射到 `core/` 下的真文件），最后看"已登记不进包"的清单。 */
    const resolveSpec = (relFile, spec) => {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relFile), spec))
      const hit = CAND(target).find((c) => fileSet.has(c))
      if (hit) return { hit }
      const alias = URL_ALIASES.get('/' + target)
      if (alias && fileSet.has(alias.file)) return { hit: alias.file }
      /** ①(收口"登记即成") 登记必须**可核对**：被登记的那条 `url`（或它等价的 target 写法）必须真的
       *  出现在 `in` 指定文件的内容里。绝对 URL 分支本来就有这道 `raw.includes(u)`（见下面 URL_REF_RE
       *  那段的 `x.url === u && x.in === rel && raw.includes(u)`），相对分支此前只比 `url`/`in`，
       *  于是"只要登记就放行"—— 登记会退化成遮羞布。这里补齐，不满足就照常落到 `{ missing }` 报红。 */
      const registeredReallyReferenced = (x) => {
        const t = path.posix.normalize(path.posix.join(path.posix.dirname(relFile), x.url))
        return raw.includes(x.url) || raw.includes(t) || raw.includes('./' + t)
      }
      const excused = NOT_SHIPPED_OK.some((x) => x.in === relFile
        && (x.url === spec || x.url === './' + target || x.url === target)
        && registeredReallyReferenced(x))
      if (excused) return { excused: true }
      return { missing: target }
    }
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(src))) {
      const r = resolveSpec(rel, m[1])
      if (r.hit) visit(r.hit)
      else if (!r.excused) missingImports.push({ from: rel, spec: m[1], target: r.missing })
    }
    if (/\.html?$/.test(rel)) {
      HTML_REF_RE.lastIndex = 0
      while ((m = HTML_REF_RE.exec(src))) {
        const r = resolveSpec(rel, m[1])
        if (r.hit) visit(r.hit)
        else if (!r.excused) missingImports.push({ from: rel, spec: m[1], target: r.missing, html: true })
      }
    }
    URL_REF_RE.lastIndex = 0
    while ((m = URL_REF_RE.exec(src))) {
      const u = m[1]
      if (HOST_PATH_PREFIXES.some((pre) => u.startsWith(pre))) continue   // 宿主临时/用户路径：不是包内资源
      const direct = URL_MOUNT_TRIES.map((f) => f(u)).find((c) => fileSet.has(c))
      const alias = URL_ALIASES.get(u)
      const aliasHit = alias && fileSet.has(alias.file)
      const excused = NOT_SHIPPED_OK.some((x) => x.url === u && x.in === rel && raw.includes(u))
      const external = EXTERNAL_OK.some((x) => {
        if (x.url !== u || x.in !== rel || !raw.includes(u)) return false
        try { return fs.readFileSync(path.join(ROOT, x.needleIn), 'utf8').includes(x.needle) } catch { return false }
      })
      if (direct || aliasHit || excused || external) { if (direct) visit(direct); if (aliasHit) visit(alias.file); continue }
      missingUrls.push({ from: rel, url: u })
    }
  }
  for (const e of entryList) if (fileSet.has(e)) visit(e)
  return { visited, missingImports, missingUrls }
}
const { visited, missingImports, missingUrls } = closure(shippedSet, entries)
check('C1 入口闭包内每条**相对 import** 都能在包里解析到（含扩展名候选与 index.*）', missingImports.length === 0,
  missingImports.length ? missingImports.slice(0, 6).map((x) => x.from + ' → ' + x.spec).join(' ; ') + (missingImports.length > 6 ? ` …共 ${missingImports.length} 条` : '') : '闭包 ' + visited.size + ' 个模块')
check('C2 代码/页面里引用的**绝对 URL** 都能映射到包内文件（挂载口径 + 别名表 + 已登记的不进包项）', missingUrls.length === 0,
  missingUrls.length ? missingUrls.slice(0, 6).map((x) => x.from + ' → ' + x.url).join(' ; ') + (missingUrls.length > 6 ? ` …共 ${missingUrls.length} 条` : '') : 'URL 引用全部命中')
/* ①(2026-09-24) C2 那条 `/diag-flags.json` 登记的**承重性**自证：它必须真的不在包里（= 登记是必要的），
   否则"登记"就退化成遮羞布（把一条本可以正常解析的引用挡掉）⇒ 那时该回来删登记而不是留着。
   这条同时是"改回去必红"的等价证据：把登记删掉 ⇒ C2 立刻红（`server/we-scene-demo-server-8902.mjs →
   /diag-flags.json` 无法映射，正是本轮修前的读数）。 */
check('C2b 该登记**承重**：`web/diag-flags.json` 确实不在包里（开发期生成物，`package.json.files` 不含它）⇒ 删掉登记 C2 必红',
  !shippedSet.has('web/diag-flags.json'), 'inPkg=' + shippedSet.has('web/diag-flags.json') + '（若变成 true ⇒ 回来删 NOT_SHIPPED_OK 里那条）')
check('C3 闭包至少走到 25 个模块（防止"入口只剩一个空壳"也算绿）', visited.size >= 25, 'visited=' + visited.size)

// ── D 反向：运行时代码不许有死文件 ──────────────────────────────────────────────────────────────────
const RUNTIME_DIRS = ['core/', 'server/', 'web/', 'elysia/', 'vendor/']
const runtimeShipped = shipped.filter((f) => RUNTIME_DIRS.some((d) => f.startsWith(d)) && /\.(mjs|js|cjs)$/.test(f))
// 由**运行期动态 import / 宿主直接当脚本跑**取用的：每条都给出可核对的引用点（判据会去文件里找那句话）。
const DYNAMIC_OK = new Map([
  ['web/sw-policy.mjs', { in: 'web/sw.js', needle: "from './sw-policy.mjs'", why: 'SW 的 module worker 按相对说明符 import' }],
  ['server/we-scene-demo-server.mjs', { in: 'package.json', needle: '"server/we-scene-demo-server.mjs"', why: 'exports["./server"] 指向它（也是 start-demo.sh 的入口）' }],
  ['server/we-scene-demo-server-8902.mjs', { in: 'docs/RELEASE.md', needle: 'server/we-scene-demo-server-8902.mjs', why: '文档登记的独立入口（`node server/…-8902.mjs` 起一站式测试台）' }],
  // 上游 vendor 树自带的**空 stub**（文件内容只有 `export {}`）：vendor 整树按原样分发，不单独裁剪
  //   （裁剪会让 THIRD-PARTY/许可校验与上游逐字节对不上）。
  ['elysia/vendor/@shaderfrog/glsl-parser/preprocessor/preprocessor-node.js',
    { in: 'elysia/vendor/@shaderfrog/glsl-parser/preprocessor/preprocessor-node.js', needle: 'export {}', why: '上游 vendor 空 stub，vendor 整树原样分发' }],
])
const dead = []
for (const f of runtimeShipped) {
  if (visited.has(f)) continue
  const ex = DYNAMIC_OK.get(f)
  if (ex) {
    let ok = false
    try { ok = fs.readFileSync(path.join(ROOT, ex.in), 'utf8').includes(ex.needle) } catch { ok = false }
    if (ok) continue
    dead.push(f + '（登记理由核对失败：' + ex.in + ' 里找不到 ' + ex.needle + '）')
    continue
  }
  dead.push(f)
}
check('D1 包里的运行时代码**没有"发了但谁也引不到"的死文件**（否则要么收窄白名单，要么补接线）',
  dead.length === 0, dead.length ? dead.slice(0, 8).join(', ') + (dead.length > 8 ? ` …共 ${dead.length} 个` : '') : `运行时代码 ${runtimeShipped.length} 个全部可达`)

// ── E 复现力自证：从包里删掉一条被 import 的模块 ⇒ B1 必红 ──────────────────────────────────────────
{
  const victim = ['core/we-particle-pointer.mjs', 'core/we-pointer-source.mjs'].find((f) => shippedSet.has(f)) ||
    [...visited].find((f) => /^core\/we-.*\.mjs$/.test(f) && f !== 'core/we-scene.mjs')
  if (!victim) {
    check('E1 找到可删的"被 import 的模块"做剔除实验', false, '包里没有 core/we-*.mjs')
  } else {
    const copyDir = path.join(tmp, 'mutant')
    fs.mkdirSync(copyDir, { recursive: true })
    execFileSync('tar', ['-xzf', tgz, '-C', copyDir], { stdio: ['ignore', 'pipe', 'pipe'] })
    const victimAbs = path.join(copyDir, 'package', victim)
    fs.rmSync(victimAbs, { force: true })
    const script = `
try { await import(new URL(${JSON.stringify('core/we-scene.mjs')}, ${JSON.stringify(pathToFileURL(path.join(copyDir, 'package')).href + '/')})); console.log('MUTANT-OK') }
catch (e) { console.log('MUTANT-FAIL ' + ((e && (e.code || e.message)) || e)) }
`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 })
    const red = /MUTANT-FAIL/.test(r.stdout || '')
    check('E1 把「' + victim + '」从包里删掉（模拟"新增文件忘了进白名单"）⇒ 真装载必须失败（= 这条判据有分辨力）',
      red, red ? (r.stdout || '').split('\n').filter((l) => l.startsWith('MUTANT-FAIL'))[0].slice(0, 160) : '居然还能 import ⇒ 判据没有分辨力')
  }
}

// ── M 变异自证（**可选段**：只有 `MPW_PACKCLOSURE_MUTATE=1` 才跑；缺省不进来 ⇒ 读数与耗时一字不变）──────
/* ①(2026-10-12 收尾 P-334 留下的技术债；纪律见台账 §40.5「没有能失败的自证 ⇒ 绿不算绿」，台账 §40.6 记账)
   上面 `NOT_SHIPPED_OK` 里那段注释写着三条**实测读数**，但注释**不是断言** —— 判据哪天悄悄退化成恒绿也没人
   发现。本段把这三条变成**可执行**的（**只新增**：C2/C2b/其余断言的判定逻辑一行不动，`NOT_SHIPPED_OK`
   里也不新增任何 `/effect.json` 登记）：
     M-a `core/we-scene-bundle.js` 的 `effectPath` 改回三段拼接（= P-334 修之前的"假 URL 片段"复现；**无登记**）
         ⇒ C2 必须**红**（红集恰好一条：`core/we-scene-bundle.js → /effect.json`）；
     M-b `demo.html` 塞一条**真**绝对 URL `fetch('/effects/wwgl_cuiliuti/effect.json')`（包内不存在；**无登记**）
         ⇒ C2 必须**红**；
     M-c `demo.html` 塞**真**绝对 URL `fetch('/effect.json')` + **放回一条登记** ⇒ C2 必须**变绿**
         ← **反向**断言：它证明"登记 = 豁免"⇒ 这正是 P-334 **只改代码侧、不登记**的理由（登记会把该文件里
         **任何**真 `/effect.json` 引用永久放行 ⇒ 判据在这里放空）。
   隔离口径（**绝不碰真树**）：变异只写进 `PKG` —— 本文件开头 `fs.mkdtempSync` + `npm pack` + `tar -xzf`
   解开的**包副本**（在 `os.tmpdir()` 下、不在仓库里；E1 那份 `tmp/mutant` 是另一棵，互不影响），每条
   变异跑完**逐字节还原**，假登记**用完即弹**（只活在运行期这一瞬间，绝不写进源码常量）。
   为什么**原样复用** `closure()` 而不是另写一段"C2 纯文本提取"：`closure()` 只从 `PKG`（优先）与 `ROOT`
   取文件 ⇒ 把**同一份** `shippedSet` / `entries` / `NOT_SHIPPED_OK` 喂给它，得到的红/绿**就是 C2 自己的
   红/绿**（同一个函数、同一份入参）；另写一套必然与真判据**漂移**，那才是"永远绿的空壳"。
   开销：开关打开时多跑 4 次 `closure()`（读 ~100 个文件，毫秒级；**不**再打一次包）；缺省下本段零开销。
   前提：以"未变异时 C2 绿"为基准（C2 那条已断言）—— 基线本就红时下面会连带 `MUTANT-MISMATCH`，不掩盖。 */
const MUTATE = process.env.MPW_PACKCLOSURE_MUTATE === '1'
if (!MUTATE) {
  console.log('  · 变异自证段 SKIP（缺省不跑；`MPW_PACKCLOSURE_MUTATE=1` 跑三条：三段拼接回退 / 真绝对 URL / 真 URL + 登记）')
} else {
  const BT = '`'
  const Q = "'"
  /** ① 本文件里**不写**那条登记的字面量（`url` + `:` + 空格 + 单引号 + `/effect.json`）：它只能在运行期
   *  拼出来，守卫（`grep -c` 那条必须为 0）才保持 0。变异文本里的 `fetch('/effect.json')` 是**被测输入**，
   *  不是登记 —— 两者别混（假登记对象在下面 `FAKE_REG`，用完即弹）。 */
  const U_EFFECT = '/' + 'effect.json'
  const U_MISS = '/effects/wwgl_cuiliuti/effect.json'
  const fetchLine = (u) => '    void fetch(' + Q + u + Q + ')'
  const A_EFFECTPATH = 'effectPath: ' + BT + 'effects/${d.dir}/effect.json' + BT + ','
  const A_FILEOF = 'const fileOf = (fx) => ' + BT + 'effects/${fx.dir}/effect.json' + BT
  const FAKE_REG = { url: U_EFFECT, in: 'demo.html', why: '② M-c 用的**假登记**（运行期 push / 用完 splice；源码 `NOT_SHIPPED_OK` 里没有它）：只为证明"登记 = 豁免真 URL"而存在' }
  const REG_COUNT = NOT_SHIPPED_OK.length   // 变异前的登记条数（收尾对拍"假登记已弹出"）
  const MUTATIONS = [
    {
      id: 'M-a', label: '`core/we-scene-bundle.js` 的 `effectPath` 改回三段拼接（假 URL 片段复现，**无登记**）',
      file: 'core/we-scene-bundle.js', from: A_EFFECTPATH,
      to: "effectPath: 'effects/' + d.dir + '/effect.json',",
      reg: null, expectGreen: false, expectRed: ['core/we-scene-bundle.js → ' + U_EFFECT],
    },
    {
      id: 'M-b', label: '`demo.html` 塞**真**绝对 URL `fetch(' + Q + U_MISS + Q + ')`（包内不存在，**无登记**）',
      file: 'demo.html', from: A_FILEOF, to: A_FILEOF + '\n' + fetchLine(U_MISS),
      reg: null, expectGreen: false, expectRed: ['demo.html → ' + U_MISS],
    },
    {
      id: 'M-c', label: '`demo.html` 塞**真**绝对 URL `fetch(' + Q + U_EFFECT + Q + ')` + **放回一条登记**（反向：登记即豁免）',
      file: 'demo.html', from: A_FILEOF, to: A_FILEOF + '\n' + fetchLine(U_EFFECT),
      reg: FAKE_REG, expectGreen: true, expectRed: [],
    },
  ]
  /** 只判 C2：**原样**调 `closure()`（与上面 C2 那条同一个函数、同一份入参）⇒ 绿 ⟺ `missingUrls` 为空。 */
  const runC2 = () => {
    const c = closure(shippedSet, entries)
    const redSet = [...new Set(c.missingUrls.map((x) => x.from + ' → ' + x.url))].sort()
    return { green: c.missingUrls.length === 0, redSet }
  }
  const base = runC2()
  console.log('  MUTANT-BASELINE 未变异时 C2 ' + (base.green ? '绿（红集 []）' : '**红**（红集 ' + JSON.stringify(base.redSet) + '）')
    + ' —— 变异都在包副本 `' + path.relative(os.tmpdir(), PKG) + '` 上跑（与真树同源，**绝不碰真树**）')
  let mutOk = 0
  const mutRows = []
  const originals = new Map()   // 变异前的包副本内容（跑完逐字节对拍 ⇒ 证明"隔离副本用完即还原"）
  for (const m of MUTATIONS) {
    const abs = path.join(PKG, m.file)
    let before = null, actual = null, broke = ''
    try {
      before = fs.readFileSync(abs, 'utf8')
      if (!originals.has(m.file)) originals.set(m.file, before)
      const n = before.split(m.from).length - 1
      if (n !== 1) broke = '锚点在包副本里出现 ' + n + ' 次（期望恰 1 次）⇒ 源码改过？回来对锚点 ' + JSON.stringify(m.from)
      else {
        fs.writeFileSync(abs, before.replace(m.from, m.to))
        if (m.reg) NOT_SHIPPED_OK.push(m.reg)
        actual = runC2()
      }
    } catch (e) { broke = '隔离副本读写失败：' + ((e && e.message) || String(e)) }
    finally {
      if (m.reg) { const i = NOT_SHIPPED_OK.indexOf(m.reg); if (i >= 0) NOT_SHIPPED_OK.splice(i, 1) }
      if (before !== null) { try { fs.writeFileSync(abs, before) } catch (e) { broke = broke || ('还原隔离副本失败：' + ((e && e.message) || String(e))) } }
    }
    const same = !broke && !!actual && actual.green === m.expectGreen && JSON.stringify(actual.redSet) === JSON.stringify(m.expectRed)
    const expTxt = m.expectGreen ? 'C2 绿（红集 []）' : 'C2 红（红集 ' + JSON.stringify(m.expectRed) + '）'
    const actTxt = actual ? ('C2 ' + (actual.green ? '绿' : '红') + '（红集 ' + JSON.stringify(actual.redSet) + '）') : '变异没生效'
    console.log('  ' + (same ? (m.expectGreen ? 'MUTANT-GREEN-OK ' : 'MUTANT-RED-OK ') : 'MUTANT-MISMATCH ') + m.id
      + ' ' + m.label + ' 期望=' + expTxt + ' 实际=' + actTxt + (broke ? ' ⚠ ' + broke : ''))
    mutRows.push({ id: m.id, ok: same, expect: m.expectGreen ? 'green' : 'red', actual: actual ? (actual.green ? 'green' : 'red') : 'not-applied', redSet: actual ? actual.redSet : null })
    if (same) mutOk++
    else { fail++; results.push({ name: 'M ' + m.id + ' 变异自证（' + m.label + '）', ok: false, detail: '期望=' + expTxt + ' 实际=' + actTxt + (broke ? ' ⚠ ' + broke : '') }) }
  }
  /** 收尾自证：隔离副本**逐字节还原** + 假登记**已弹出**（否则下一条变异会从脏副本出发，读数不可信）。 */
  const dirty = [...originals.keys()].filter((rel) => fs.readFileSync(path.join(PKG, rel), 'utf8') !== originals.get(rel))
  const regGone = !NOT_SHIPPED_OK.includes(FAKE_REG) && NOT_SHIPPED_OK.length === REG_COUNT
  const clean = dirty.length === 0 && regGone
  console.log('  ' + (clean ? 'MUTANT-RESTORE-OK ' : 'MUTANT-RESTORE-FAIL ') + '隔离副本已逐字节还原（' + [...originals.keys()].join(', ')
    + '）且假登记已弹出（`NOT_SHIPPED_OK` ' + NOT_SHIPPED_OK.length + ' 条 == 变异前的 ' + REG_COUNT + ' 条）'
    + (clean ? '' : ' —— 差异：' + (dirty.join(', ') || '无') + (regGone ? '' : ' · 登记条数/内容不对')))
  if (!clean) { fail++; results.push({ name: 'M 隔离副本还原 + 假登记弹出', ok: false, detail: '差异：' + (dirty.join(', ') || '无') + ' regGone=' + regGone }) }
  console.log('  MUTANT-SUMMARY ' + mutOk + '/' + MUTATIONS.length + ' 期望 == 实际' + (mutOk === MUTATIONS.length
    ? '（M-a/M-b 证明 C2 会红、M-c 证明"登记即豁免" ⇒ C2 不是恒绿判据；本段**不进** pass 计数 ⇒ 缺省/打开都是 13/13）'
    : ' ⇒ 有变异没按期望走：本段**计入失败**（退出码非零）'))
  console.log('  MUTANT-JSON ' + JSON.stringify(mutRows))
}

console.log(`\n────\npack-closure-test：${pass} 通过 / ${fail} 失败（包内 ${shipped.length} 个文件，静态可达 ${visited.size} 个模块）`)
if (JSON_OUT) console.log('PACK-CLOSURE-TEST-JSON ' + JSON.stringify({ ok: fail === 0, shipped: shipped.length, visited: visited.size, failed: results.filter((r) => !r.ok) }))
process.exit(fail ? 1 : 0)

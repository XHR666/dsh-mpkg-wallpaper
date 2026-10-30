// build-pages.mjs —— 把仓库打成 GitHub Pages 的**纯静态**产物（P-93；形态口径见 docs/ONLINE-DEMO.md）
//
// 用法:
//   node build-pages.mjs                 # 产出到 ./_site（--out 可改）
//   node build-pages.mjs --out /tmp/site
//   node build-pages.mjs --json          # 机读摘要
//
// 设计约束（照 docs/ONLINE-DEMO.md §3 逐条落地）：
//   ① **零依赖、不联网**：只用 node: 内置模块（CI 里也不跑 pnpm install）；
//   ② **不改任何源文件**：整棵树是"读 + 拷贝"，源仓库保持原样；
//   ③ **显式白名单**（下面的 PAGES_KEEP_*）：站点只放"能看的东西"，测试脚本 / 服务端 /
//      打包工具 / 本机清单**一律不进产物**。白名单是发布面的**唯一**口径，读得出来、审得动；
//   ④ 产物里 `demo/` 出现两次：`/demo/`（规范入口）与 `/WEwebLoader/`（**站点路径名 = 产品名**，P-127）。
//      为什么必须两份：上游静态产物（minified、**不可重建**）里写死了站点路径的绝对形状
//      `/wallpaper-engine-webgl/renderer/index.html`（iframe src，3 处）、
//      `/wallpaper-engine-webgl/default-wallpaper/index.html`（渲染器页内兜底壁纸）与 `/wallpaper-engine-webgl/sw.js`；
//      Pages 只能从仓库根发布 ⇒ 根下必须有一份真拷贝，那几条才不 404。
//      **仓库里只有一份物理文件**（demo/ 是真源，第二份只存在于构建产物里，且是真实拷贝不是软链）。
//   ④-b P-127：旧路径 `/wallpaper-engine-webgl/` **只放极小重定向页**（不 404，也不留第二份真源）。
//      名字与落点是**单一真源** `tools/site-paths.mjs`（测试 D12 直接 import 它做断言）。
//   ⑤ 写 `.nojekyll`：否则 Jekyll 会吃掉下划线开头的文件；
//   ⑥ 软链**跟随解引用**（demo/samples → ../samples）：Pages 不解析软链，产物里必须是真文件。
import fs from 'node:fs'
import path from 'node:path'
// ④-b(P-127) 站点 URL 路径的单一真源（新名 / 旧名 / 旧路径要放哪几张重定向页）
import { SITE_MOUNT, SITE_MOUNT_LEGACY, LEGACY_REDIRECTS, legacyRedirectHtml } from './tools/site-paths.mjs'

const ROOT = import.meta.dirname
const argv = process.argv.slice(2)
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const JSON_OUT = argv.includes('--json')
const OUT = path.resolve(ROOT, val('--out', '_site'))

// ── 发布面白名单（目录 + 具名文件）──
// ①(2026-09-16 目录整理) **不发 `docs/` 开发文档树**：站点是给访客看的 demo。白名单是发布面的**唯一**口径。
// ①(P-101 2026-09-16 目录再整理) 仓库按职责分层（`core/` 内核、`server/` 服务端、`web/` 站点外壳、`tools/` 生成器）
//   ⇒ 具名文件从"根级文件名集合"改为**显式 `[仓库内落点, 产物内落点]` 映射**：
//   仓库里怎么放 ≠ 线上什么 URL，**线上路径与收拢前逐字一致**（/demo.html、/sw.js、/manifest.webmanifest…）。
// ①(P-139 2026-09-19 补) `elysia/we-renderer/puppet.js` 以 `../../core/attach-transform.mjs` import
//   （P-139 把采样器收敛到"唯一实现处"时改成从 core 取）⇒ 产物里**必须有 `core/` 目录**，
//   否则 Pages 上该 import 解析到 `/<repo>/core/attach-transform.mjs` ⇒ 404 ⇒ 同一条"整图断掉"。
const PAGES_KEEP_DIRS = ['core', 'demo', 'samples', 'assets', 'vendor', 'elysia', 'extensions']
const PAGES_KEEP_FILES = [
  ['index.html', 'index.html'],                       // 落地页（Pages 的 /）
  ['demo.html', 'demo.html'],                         // 渲染器 demo
  ['README.md', 'README.md'],
  ['README.en.md', 'README.en.md'],                         // 落地页 ./README.md + ONLINE-DEMO §2 的口径
  ['docs/COPYING-RULES.md', 'docs/COPYING-RULES.md'], // 落地页 ./docs/COPYING-RULES.md（只发这一份开发文档）
  ['web/diag.html', 'diag.html'],
  ['web/probe.html', 'probe.html'],
  ['web/manifest.webmanifest', 'manifest.webmanifest'],
  ['web/sw.js', 'sw.js'],
  ['web/sw-policy.mjs', 'sw-policy.mjs'],
  ['web/icons', 'icons'],                             // 目录（PWA 图标）
  // ①(2026-09-23 第二轮品牌清理 · 用户③) 浏览器**默认**请求的 `/favicon.ico`：给产物放一份真文件，
  //   否则没写 <link rel=icon> 的页（如上游产物 demo.html，本仓不许改它）在 Pages 上标签页无图标。
  //   内容 = 品牌图 32×32 PNG（浏览器按内容嗅探，扩展名只影响 Pages 发的 content-type）。
  ['web/icons/brand-32.png', 'favicon.ico'],
  // 内核：`elysia/demo-elysia.js` 以相对路径 `../we-scene-bundle.js` 取它 ⇒ 产物根必须有同名文件；
  // demo.html 用相对说明符 `./bundle.js` ⇒ 产物根同时要有 `bundle.js`（自带服务器的 /bundle.js 路由读同一份）。
  ['core/we-scene-bundle.js', 'we-scene-bundle.js'],
  ['core/we-scene-bundle.js', 'bundle.js'],
  ['core/we-scene.mjs', 'we-scene.mjs'],
  ['core/attach-transform.mjs', 'attach-transform.mjs'],
  // ①(§5-⑨ 真机基线快照 2026-09-17) demo.html 以相对说明符 `./baseline-metrics.mjs` import 它
  //   （自带服务器的 `/baseline-metrics.mjs` 路由读同一份 core/ 文件）⇒ 产物根必须有同名文件。
  ['core/baseline-metrics.mjs', 'baseline-metrics.mjs'],
  // ①(P-111 2026-09-17 帧几何/音频频段接线) 同形两条：`core/we-scene-bundle.js` 以 `./web-frame-geometry.mjs`
  //   import、`demo.html` 以 `./audio-band-array.mjs` import（浏览器按**相对说明符**解析 ⇒ 与 `attach-transform.mjs`
  //   一样，产物根必须有同名文件；自带服务器的同名路由读同一份 core/ 文件）。
  ['core/web-frame-geometry.mjs', 'web-frame-geometry.mjs'],
  ['core/audio-band-array.mjs', 'audio-band-array.mjs'],
  // ①(2026-09-23 第 ⑥ 条) web 壁纸宿主契约与 shim（demo.html 的相对 import ⇒ 产物根同名）
  ['core/web-frame-host.mjs', 'web-frame-host.mjs'],
  ['core/we-web-shim.mjs', 'we-web-shim.mjs'],
  ['core/puppet-skin.js', 'puppet-skin.js'],
  // ①(P-136 用户第 4 项「照抄上游鼠标尾迹」2026-09-19 补漏) `core/we-scene-bundle.js` 新增两个**同目录** import
  //   （`./we-pointer-source.mjs` / `./we-particle-pointer.mjs`）⇒ 产物根必须有同名文件；否则浏览器把 404 当
  //   "模块 MIME 类型不合法"拒绝加载、**整条 module 图断在这里**（页面永远停在 `loading…`，控制台只说
  //   "脚本资源加载失败：(inline module)"）。事故现场：8899 路由 + 本表 + `web/sw.js` **三处同时**漏了这两个名字。
  //   防复发：`tests/core-module-wiring-test.mjs`（逐条解析浏览器会加载的相对 import，断言三处在位）。
  ['core/we-pointer-source.mjs', 'we-pointer-source.mjs'],
  ['core/we-particle-pointer.mjs', 'we-particle-pointer.mjs'],
  // ②(P-228l 2026-10-05) `core/we-scene-bundle.js` 的又一个同目录 import（`./we-animation.mjs` = 属性动画运行时）
  //   ⇒ 产物根同样必须有同名文件（漏了就是同一场"整条 module 图断掉"事故）。
  ['core/we-animation.mjs', 'we-animation.mjs'],
  ['tools/make-sample.mjs', 'make-sample.mjs'],
  ['server/pack-dir.mjs', 'pack-dir.mjs'],
  // 法律文本按根发布（README/落地页都按根链接）
  ['LICENSE', 'LICENSE'], ['THIRD-PARTY.md', 'THIRD-PARTY.md'],
]
// 白名单目录里也不发的形状（测试/闸门/上报产物）
const PAGES_SKIP_RE = [
  /-test\.mjs$/, /-check\.mjs$/, /-audit\.mjs$/, /-scan\.mjs$/, /-verify\.mjs$/, /-probe\.mjs$/,
  /^(run-all-tests\.sh|check\.sh|start-demo\.sh|keep-demo-server\.sh)$/,
  /^\.gitignore/, /(^|\/)\.DS_Store$/,
]
const skipByShape = (name) => PAGES_SKIP_RE.some((r) => r.test(name))

// ── 显式**排除**表：即使被上面两份白名单收进来也绝不进产物 ──
// ①(2026-09-16 CI 回归修复) 这两个是**服务端 / 打包工具**，纯静态站点用不到，而它们都带
//   "环境变量优先、作者本机路径作默认值"的写法（`opts.root || process.env.MPW_ROOT || '<作者本机工作区>/…'`）⇒
//   一旦进产物，**隐私闸门必然命中**。
//   事故经过（证据留痕，勿删）：`.github/workflows/pages.yml` 曾用 `rm -f _site/<这两个>` **事后补救**，
//   但白名单仍把它们拷进 `_site` ⇒ 本地 `node build-pages.mjs` 得到的产物与 CI 发出去的不是同一份，
//   而且任何人删掉那行 `rm` 就会让 Pages 构建在第 5 步自检上红（run 35015130033 就是这么红的）。
//   修法 = 把"不发"写回**唯一口径**（白名单）本身 + 构建末尾内建隐私闸门（见下），
//   于是"本地构建通过" ⟺ "CI 的自检通过"，不再靠 workflow 里的命令兜底。
const PAGES_DENY_FILES = new Set(['core/scene-project-json.mjs', 'server/we-scene-demo-server.mjs'])
// ①(P-101) 显式映射下这些文件**根本不在清单里**；本集合保留为纵深防御：
//   万一将来有人把 `core/` `server/` 整目录加进 PAGES_KEEP_DIRS，拷贝循环也会在这里拦住它们。
const PAGES_DENY_BASENAMES = new Set([...PAGES_DENY_FILES].map((p) => p.split('/').pop()))

// ── 产物隐私闸门：口径与仓库级 `publish-check.mjs` 的 ② 逐字同源 ──
//   PATH_RE        = 个人绝对路径形状（本机工作区 / 私有包目录 / SD 卡 / 常见家目录 / Windows 用户目录）；
//   DEFAULT_LINE_RE = 豁免"环境变量优先 + 作者本机默认值"的**刻意**写法（`process.env.X || '<默认值>'`）。
//   为什么闸门要放**构建里**而不只在 workflow 里：本脚本的输出就是要发出去的那一份 ——
//   只有构建自己拒绝产出带个人路径的产物，"本地绿"才等于"线上绿"（事故见上面的 ①）。
const PATH_RE = /(\/root\/Desktop\/|\/root\/\.dsh-mpkg-wallpaper|\/mnt\/sdcard\/|\/home\/[a-z]+\/|C:\\Users\\[A-Za-z]+)/
// ①(PA-44 2026-09-24 可移植性审计) 这里原来还有一个分支 `|| '<作者工作区绝对路径>'`：
//   去个人化之后产物里**已经没有任何这样的字面量** ⇒ 该分支永不命中（腐烂），但仍**生效** ——
//   一旦有人写回 `const X = argv.dir || '<作者工作区绝对路径>'`（不带 `process.env` ⇒ 躲过第一个分支），
//   构建闸门会**静默放行**（而仓库级 publish-check / secret-scan 会判红 ⇒ 两处判据不一致）。
//   现在删掉该死分支；判别力用**同段合成自证**钉住（写死本机绝对路径必须红、环境变量默认值口径必须放行）：
//   判据自己哑了 ⇒ 构建直接退出码 1，而不是"产物看起来干净"。
const DEFAULT_LINE_RE = /process\.env\.[A-Z_]+ \|\||MPW_[A-Z_]+ \|\||\$\{MPW_ROOT:-|\/\/ ①\(去个人化\)/

const copied = []
const skipped = []
function copyFile(src, dst, rel) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  copied.push(rel)
}
function copyTree(srcDir, dstDir, relBase) {
  fs.mkdirSync(dstDir, { recursive: true })
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = relBase ? relBase + '/' + e.name : e.name
    if (skipByShape(e.name)) { skipped.push(rel); continue }
    if (PAGES_DENY_FILES.has(e.name)) { skipped.push(rel + ' (显式排除：含作者本机默认路径)'); continue }
    const src = path.join(srcDir, e.name)
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'reports' || e.name === '__pycache__') { skipped.push(rel + '/'); continue }
    // ⚠ 软链**目录**必须跟随（真机踩到：`demo/samples → ../samples` 是软链目录，
    //   只看 `e.isDirectory()` 会把它整个漏掉 ⇒ 产物里没有 `demo/samples/` ⇒ 默认壁纸 404）。
    //   这里的判据一律用 statSync（跟随软链），不用 Dirent。
    let st = null
    try { st = fs.statSync(src) } catch { skipped.push(rel + ' (断链)'); continue }
    if (st.isDirectory()) { copyTree(src, path.join(dstDir, e.name), rel); continue }
    if (!st.isFile()) { skipped.push(rel + ' (非普通文件)'); continue }
    copyFile(src, path.join(dstDir, e.name), rel)
  }
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
for (const d of PAGES_KEEP_DIRS) {
  const src = path.join(ROOT, d)
  if (!fs.existsSync(src)) { skipped.push(d + '/ (不存在)'); continue }
  copyTree(src, path.join(OUT, d), d)
}
for (const [from, to] of PAGES_KEEP_FILES) {
  const src = path.join(ROOT, from)
  if (!fs.existsSync(src)) { skipped.push(from + ' (不存在)'); continue }
  if (PAGES_DENY_FILES.has(from) || PAGES_DENY_BASENAMES.has(path.basename(from))) { skipped.push(from + ' (显式排除：服务端/打包工具，含作者本机默认路径)'); continue }
  const st = fs.statSync(src)
  if (st.isDirectory()) { copyTree(src, path.join(OUT, to), to); continue }
  copyFile(src, path.join(OUT, to), to)
}

// ④ 第二份测试台：demo/ → WEwebLoader/（只为产物里那几条写死的绝对路径）
//    ①(P-127 2026-09-19) 挂载点名从旧名 `wallpaper-engine-webgl/` 改成**站点路径名 = 产品名** `WEwebLoader/`
//    （用户裁定：他看到要走 URL 路径的旧名 ⇒ 地址栏也换）。旧路径不再整份拷贝，只放重定向页（见 ④-b）。
const DEMO_SRC = path.join(ROOT, 'demo')
const ALIAS = path.join(OUT, SITE_MOUNT)
if (!fs.existsSync(path.join(OUT, 'demo', 'index.html'))) {
  console.error('✗ 产物里没有 demo/index.html —— 测试台真源缺失，构建中止')
  process.exit(1)
}
copyTree(DEMO_SRC, ALIAS, SITE_MOUNT)

// ④-b 旧路径 `/wallpaper-engine-webgl/`：**只有重定向页**（极小、noindex、带 query 的原址跳转）。
//   为什么不整份拷贝：那是第二份真源，改一处要记得改两处（历史事故：两份手改漂移）；
//   为什么不干脆 404：旧链接/书签/深链（`renderer/index.html` 会被 `#open` 新窗口直接打开）必须还有落点。
const LEGACY_DIR = path.join(OUT, SITE_MOUNT_LEGACY)
for (const rel of LEGACY_REDIRECTS) {
  const dst = path.join(LEGACY_DIR, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(dst, legacyRedirectHtml(rel))
}

// ⑤ 关掉 Jekyll
fs.writeFileSync(path.join(OUT, '.nojekyll'), '')

// 完整性自检：产物必须能直接当站点用（这几条缺一个就是"发上去才发现"）
const MUST = ['index.html', 'demo.html', 'bundle.js', 'we-scene-bundle.js', 'sw.js', 'manifest.webmanifest',
  'demo/index.html', 'demo/bench-patch.js', 'demo/LICENSE-webwallgl-MIT.txt',
  // ①(P-136/P-139 2026-09-19 补) 四个"浏览器按相对说明符去取"的内核文件：漏一个 = 整条 module 图断掉。
  //   `we-pointer-source.mjs`/`we-particle-pointer.mjs` 由**产物根的** bundle 取（同目录 import）；
  //   `core/attach-transform.mjs` 由 `elysia/we-renderer/puppet.js` 以 `../../core/...` 取。
  'we-pointer-source.mjs', 'we-particle-pointer.mjs', 'core/attach-transform.mjs', 'we-animation.mjs',
  `${SITE_MOUNT}/index.html`, `${SITE_MOUNT}/bench-patch.js`,
  `${SITE_MOUNT}/renderer/index.html`, 'samples/sample-synthetic/scene.pkg',
  'samples/sample-synthetic/project.json', 'THIRD-PARTY.md', 'LICENSE', '.nojekyll',
  // ④-b(P-127) 旧路径：这三张重定向页缺一个，对应的旧深链就是 404
  ...LEGACY_REDIRECTS.map((rel) => `${SITE_MOUNT_LEGACY}/${rel}`)]
const missing = MUST.filter((f) => !fs.existsSync(path.join(OUT, f)))
if (missing.length) {
  console.error('✗ 产物缺少必需文件：' + missing.join('、'))
  process.exit(1)
}
// ④-b(P-127) 旧路径下的自检两条（都要能变红）：
//   ① 内容必须是"极小重定向页"（noindex + meta refresh + location.replace + 体积上限）；
//   ② 目录里**只能**有这几张重定向页 —— 谁把整棵树拷回旧路径，产物里就又多一份真源，构建当场红。
for (const rel of LEGACY_REDIRECTS) {
  const p2 = path.join(LEGACY_DIR, rel)
  const html = fs.readFileSync(p2, 'utf8')
  const size = Buffer.byteLength(html)
  const bad = []
  if (!/name="robots" content="noindex,nofollow"/.test(html)) bad.push('缺 noindex')
  if (!/http-equiv="refresh" content="0; url=/.test(html)) bad.push('缺 meta refresh')
  if (!/location\.replace\(/.test(html)) bad.push('缺 location.replace')
  if (!/location\.search/.test(html)) bad.push('跳转没带 query')
  if (size > 4096) bad.push('体积 ' + size + ' B 超 4 KB')
  if (bad.length) {
    console.error(`✗ 旧路径重定向页不合规 ${SITE_MOUNT_LEGACY}/${rel}：${bad.join('、')}`)
    process.exit(1)
  }
}
const legacyFiles = []
const collectLegacy = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p2 = path.join(d, e.name)
    if (e.isDirectory()) { collectLegacy(p2); continue }
    legacyFiles.push(path.relative(LEGACY_DIR, p2).split(path.sep).join('/'))
  }
}
collectLegacy(LEGACY_DIR)
const strays = legacyFiles.filter((f) => !LEGACY_REDIRECTS.includes(f))
if (strays.length) {
  console.error(`✗ 旧路径 ${SITE_MOUNT_LEGACY}/ 下出现了非重定向页文件（旧路径只放重定向页，不许第二份真源）：` + strays.join('、'))
  process.exit(1)
}
// 显式递归（不用 readdirSync({recursive:true})：那是 Node 20.1+ 才有，而 engines 只保证 >=20）
const countFiles = (d) => {
  let n = 0
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p2 = path.join(d, e.name)
    if (e.isDirectory()) n += countFiles(p2)
    else if (e.isFile()) n++
  }
  return n
}

// ── 产物隐私闸门（与 publish-check.mjs 的 ② 同口径）──
//   不变量："构建通过" ⇒ "产物里除刻意保留的作者默认值外，零个人绝对路径"。
//   放在这里而不是只在 workflow：本函数产出的**就是**发上去的那一份，本地绿必须等于线上绿。
const walkFiles = (d, base = d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p2 = path.join(d, e.name)
    if (e.isDirectory()) walkFiles(p2, base, out)
    else if (e.isFile()) out.push(path.relative(base, p2))
  }
  return out
}
const privacyHits = []
// ── [assert:privacy-predicate] BEGIN ──
//   ①(PA-44) 合成自证：判据必须能抓住"不带 process.env 的写死本机绝对路径"，且仍放行
//   "环境变量优先 + 本机默认值"的刻意写法。片段按 `+` 拼装（整串写出来会被自己这条判据自指命中）。
{
  const HOSTPATH = '/root' + '/Desktop/' + 'DSHarea'
  const CASES = [
    { id: 'hardcoded-no-override', line: 'const X = argv.dir || ' + JSON.stringify(HOSTPATH), must: 'flag' },
    { id: 'env-default-exempt', line: 'const X = process.env.MPW_X || ' + JSON.stringify(HOSTPATH), must: 'exempt' },
    { id: 'mpw-var-exempt', line: 'const X = MPW_X || ' + JSON.stringify(HOSTPATH), must: 'exempt' },
    { id: 'shell-default-exempt', line: 'D="${MPW_ROOT:-' + HOSTPATH + '}"', must: 'exempt' },
  ]
  const bad = CASES.filter((c) => {
    const caught = PATH_RE.test(c.line) && !DEFAULT_LINE_RE.test(c.line)
    return c.must === 'flag' ? !caught : caught
  })
  if (bad.length) {
    console.error('✗ 产物隐私判据的**判别力自证失败**：' + bad.map((c) => c.id).join('、') + ' ⇒ 疑似有人把"死分支"写回去了，或路径图案被改坏；构建中止（不产出"看起来干净"的产物）')
    process.exit(1)
  }
  console.log('  · 隐私判据自证：写死本机绝对路径必抓 + 三种可覆盖写法放行（' + CASES.length + ' 条合成样本）')
}
// ── [assert:privacy-predicate] END ──
for (const rel of walkFiles(OUT)) {
  if (/\.(png|jpg|jpeg|gif|webp|ttf|otf|woff2?|pkg|mpkg|mp4|ico|map)$/i.test(rel)) continue // 二进制，不做文本扫描（与 publish-check 同）
  let text = ''
  try { if (fs.statSync(path.join(OUT, rel)).size > 4 * 1048576) continue; text = fs.readFileSync(path.join(OUT, rel), 'utf8') } catch { continue }
  text.split('\n').forEach((line, i) => {
    if (PATH_RE.test(line) && !DEFAULT_LINE_RE.test(line)) privacyHits.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 100))
  })
}
if (privacyHits.length) {
  console.error('✗ 产物里出现个人绝对路径（' + privacyHits.length + ' 处；若是"环境变量优先 + 作者默认值"的刻意写法，请确认命中行含 process.env.X || / MPW_X || 形态）：')
  for (const h of privacyHits.slice(0, 10)) console.error('  ✗ ' + h)
  if (privacyHits.length > 10) console.error('  …还有 ' + (privacyHits.length - 10) + ' 处')
  process.exit(1)
}

const summary = { out: OUT, files: countFiles(OUT), demoStagedTwice: true, alias: SITE_MOUNT, legacyRedirects: LEGACY_REDIRECTS.length, nojekyll: true, must: MUST.length, denied: PAGES_DENY_FILES.size, privacyOk: true, skipped: skipped.length }
if (JSON_OUT) console.log(JSON.stringify(summary, null, 1))
else {
  console.log(`✓ Pages 产物：${OUT}`)
  console.log(`  · 文件 ${summary.files} 个（白名单口径：PAGES_KEEP_DIRS / PAGES_KEEP_FILES）`)
  console.log(`  · demo/ 与 ${SITE_MOUNT}/ 两份（后者是产物里写死的绝对路径所需）`)
  console.log(`  · 旧路径 ${SITE_MOUNT_LEGACY}/ 只有 ${LEGACY_REDIRECTS.length} 张重定向页（noindex + 带 query 跳转；非重定向页文件 = 构建红）`)
  console.log('  · .nojekyll 已写；必需文件自检 ' + MUST.length + ' 项全过')
  console.log(`  · 隐私闸门通过：产物零个人绝对路径（显式排除 ${PAGES_DENY_FILES.size} 个含本机默认路径的服务端文件）`)
}

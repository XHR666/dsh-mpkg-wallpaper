// core-module-wiring-test.mjs —— ①2026-09-19 **P0 事故防复发**：浏览器会加载的每个文件，它的**相对 import**
// 必须同时在三处有位：①8899 服务器路由 ②`build-pages.mjs` 的产物根映射（或 `PAGES_KEEP_DIRS` 里的目录）
// ③`web/sw.js` 的预缓存（离线首屏）。
//
// 事故现场（P-136 引入、用户第 4 项那批）：`core/we-scene-bundle.js` 新增两个同目录 import
// （`./we-pointer-source.mjs` / `./we-particle-pointer.mjs`），而**三处同时**没登记 ⇒ 浏览器把 `/bundle.js`
// （服务器直接发 `core/we-scene-bundle.js` 的字节）解析出的 `/we-pointer-source.mjs` 得到 404，
// 按"模块 MIME 类型不合法"拒绝加载 ⇒ **整条 module 图断掉**：`window.__mpwModuleStarted` 永远 false、
// 页面停在 `loading…`。而所有门禁当时都是绿的 —— 因为它们跑的是 Node（直接按文件系统相对路径解析，看不见 404）。
//
// 本文件做的就是"把那个盲区变成断言"：
//   1. 列出**浏览器会去加载**的入口文件 + 它们在服务器上对应的 URL；
//   2. 解析其中所有**相对说明符** import（含 `import()` 与 `<script src>`），按 URL 解析规则算出最终 URL；
//   3. 逐条断言：目标文件存在、且在三处登记齐（没登记的报出来，并指出是哪一处缺）。
//
// 秒级、无浏览器、无网络。新增 core/elysia 模块后若三处漏登记，这里**先红**，而不是等用户看到白屏。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

let pass = 0; let fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const serverSrc = read('server/we-scene-demo-server.mjs')
const buildSrc = read('build-pages.mjs')
const swSrc = read('web/sw.js')

/** 浏览器入口：`servedUrl` = 服务器上这个文件的 URL（相对 import 就是相对它解析的）。 */
const ENTRIES = [
  { file: 'core/we-scene-bundle.js', servedUrl: '/bundle.js', note: '8899 `/bundle.js` 直接发这个文件' },
  { file: 'core/we-scene-bundle.js', servedUrl: '/we-scene-bundle.js', note: 'elysia 侧按相对路径取它' },
  { file: 'core/we-scene-bundle.js', servedUrl: '/core/we-scene-bundle.js', note: '`/core/**` 路由（P-139 新增）' },
  { file: 'elysia/we-renderer/puppet.js', servedUrl: '/elysia/we-renderer/puppet.js', note: '`/elysia/**` 路由' },
  { file: 'elysia/scene-scripts.js', servedUrl: '/elysia/scene-scripts.js', note: '`/elysia/**` 路由' },
  { file: 'core/we-pointer-source.mjs', servedUrl: '/we-pointer-source.mjs', note: '产物根同名文件' },
  { file: 'core/we-particle-pointer.mjs', servedUrl: '/we-particle-pointer.mjs', note: '产物根同名文件' },
  { file: 'demo/mpw-select.js', servedUrl: '/demo/mpw-select.js', note: '自绘下拉（用户第 6 项）' },
  /* ⚠ 2026-09-23 补：**页面本体**此前不在被扫描的入口里 —— 于是"给 demo.html 加一条产物根同名 import
     但没登记"这种改动可以一路绿灯（本轮就发生过：`./web-frame-host.mjs` ⇒ 8899 404 ⇒ 页面停在
     `loading…`，而 A/A2 全绿，因为 A2 只跑在被扫的入口上）。页面是最大的一张相对 import 表，必须扫。 */
  { file: 'demo.html', servedUrl: '/demo.html', note: '渲染器页本体（8899 `/` 发它）' },
]

/** 从源码里抠出所有相对说明符（静态 import / 动态 import() / export … from）。 */
function relSpecifiers(src) {
  const out = new Set()
  const pats = [
    /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
  ]
  for (const re of pats) for (const m of src.matchAll(re)) {
    const s = m[1]
    if (s.startsWith('.')) out.add(s)
  }
  return [...out]
}

/** URL 解析（浏览器口径：相对 servedUrl，处理 ./ 与 ../，丢掉 query/hash）。 */
function resolveUrl(servedUrl, spec) {
  const base = servedUrl.replace(/[?#].*$/, '')
  const stack = base.split('/').slice(0, -1)   // 目录部分
  for (const seg of spec.replace(/[?#].*$/, '').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') stack.pop()
    else stack.push(seg)
  }
  return '/' + stack.filter(Boolean).join('/')
}

/** URL → 仓库文件（本仓库的产物根映射约定：根目录同名文件住在 `core/`）。 */
function urlToRepoFile(url) {
  /* ⚠ 产物根同名映射**不是**统一的：`/bundle.js` 是 `core/we-scene-bundle.js` 的服务器 URL（见 ENTRIES
     第 1 行的 note），不是 `core/bundle.js`。把 demo.html 纳入扫描后这条立刻暴露成假红 ⇒ 在这里显式列出
     已知例外，而不是放宽判据。 */
  if (url === '/bundle.js') return 'core/we-scene-bundle.js'
  const rel = url.slice(1)
  const cands = []
  if (url.startsWith('/demo/') || url.startsWith('/elysia/') || url.startsWith('/core/')
    || url.startsWith('/web/') || url.startsWith('/assets/') || url.startsWith('/vendor/')) cands.push(rel)
  cands.push('core/' + rel, 'demo/' + rel, rel)
  for (const c of cands) { try { if (fs.statSync(path.join(ROOT, c)).isFile()) return c } catch { /* next */ } }
  return null
}

const isMapped = (url) => buildSrc.includes(`'${url.slice(1)}'`)          // 产物根同名文件
const isDirKept = (url) => {
  const dirs = (buildSrc.match(/PAGES_KEEP_DIRS = \[([^\]]*)\]/) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  return dirs.some((d) => url.startsWith('/' + d + '/'))
}
const isRouted = (url) => serverSrc.includes(`'${url}'`) || (url.startsWith('/core/') && serverSrc.includes("p.startsWith('/core/')"))
const isPrecached = (url) => swSrc.includes(`'${url}'`)

console.log('== A 逐入口解析相对 import，并核对三处登记 ==')
const problems = []
for (const e of ENTRIES) {
  const src = read(e.file)
  const specs = relSpecifiers(src)
  if (!fs.existsSync(path.join(ROOT, e.file))) { problems.push(`${e.file} 不存在`); continue }
  const rows = specs.map((s) => ({ s, url: resolveUrl(e.servedUrl, s) }))
  console.log(`\n· ${e.file}  ← served as ${e.servedUrl}（${e.note}）：${rows.length} 个相对 import`)
  for (const r of rows) {
    //  ①**URL 不是仓库路径**：产物根的 `/x.mjs` 按约定来自 `core/x.mjs`（本仓库的"产物根同名文件"映射），
    //    `/demo/**` 来自 `demo/**`、`/core/**` 来自 `core/**`、`/elysia/**` 来自 `elysia/**`。
    const repoFile = urlToRepoFile(r.url)
    const exists = !!repoFile && fs.existsSync(path.join(ROOT, repoFile))
    ok(exists, `A 目标文件存在：${e.file} → ${r.s} ⇒ ${r.url}`, exists ? `→ ${repoFile}` : '（URL 解析不到仓库文件！）')
    if (!exists) problems.push(`${e.file} → ${r.url} 解析不到仓库文件`)
    /* ⚠ A2（2026-09-23 补的盲区）：「文件存在」**不等于**「浏览器取得到」。本轮给 demo.html 加了两条
       `./web-frame-host.mjs` / `./we-web-shim.mjs`（产物根同名），文件都在、A 全绿，可 8899 的产物根
       是**固定名单**（通用路由只覆盖 `/core/**`）⇒ 页面报「脚本资源加载失败：(inline module)」、整条
       module 图断掉，而这条门禁当时是绿的。现在逐条断言**解析出的 URL 真的有人服务**。 */
    const served = isRouted(r.url) || isDirKept(r.url)
    ok(served, `A2 目标 URL 真有人服务：${e.file} → ${r.s} ⇒ ${r.url}`,
      served ? '' : '（8899 路由与 Pages 目录都没有它 ⇒ 浏览器 404 = 整条 module 图断掉）')
    if (!served) problems.push(`${e.file} → ${r.url} 没有服务方`)
  }
}
void problems

console.log('\n== B 三处接线（服务器路由 / Pages 映射 / SW 预缓存）==')
// 只看"产物根同名文件"与"目录路由"两类：核心模块在两个入口下被解析成不同 URL，逐个核对
const REQUIRED = [
  { url: '/attach-transform.mjs', file: 'core/attach-transform.mjs', why: 'bundle 的 ./attach-transform.mjs' },
  { url: '/puppet-skin.js', file: 'core/puppet-skin.js', why: 'bundle 的 ./puppet-skin.js' },
  { url: '/web-frame-geometry.mjs', file: 'core/web-frame-geometry.mjs', why: 'bundle / demo.html 的相对 import' },
  { url: '/audio-band-array.mjs', file: 'core/audio-band-array.mjs', why: 'demo.html 的相对 import' },
  { url: '/baseline-metrics.mjs', file: 'core/baseline-metrics.mjs', why: 'demo.html 的相对 import' },
  // ①(P-136) 这两个是本次 P0 事故的主角
  { url: '/we-pointer-source.mjs', file: 'core/we-pointer-source.mjs', why: 'bundle 的 ./we-pointer-source.mjs' },
  { url: '/we-particle-pointer.mjs', file: 'core/we-particle-pointer.mjs', why: 'bundle 的 ./we-particle-pointer.mjs' },
  // ①(P-139) elysia 侧以 ../../core/... 取它 ⇒ 解析成 /core/...
  { url: '/core/attach-transform.mjs', file: 'core/attach-transform.mjs', why: 'puppet.js 的 ../../core/attach-transform.mjs' },
  // ①(用户第 6 项) 自绘下拉
  { url: '/demo/mpw-select.js', file: 'demo/mpw-select.js', why: 'demo.html 的 ./demo/mpw-select.js' },
  { url: '/demo/mpw-select-math.mjs', file: 'demo/mpw-select-math.mjs', why: '被 mpw-select.js 相对 import' },
]
for (const r of REQUIRED) {
  const exists = fs.existsSync(path.join(ROOT, r.file))
  const mapped = isMapped(r.url) || isDirKept(r.url)
  const routed = isRouted(r.url)
  const precached = isPrecached(r.url)
  ok(exists, `B ${r.url} 源文件在（${r.why}）`, r.file)
  ok(routed, `B ${r.url} 有 **8899 服务器路由**（缺它 = 页面停在 loading…）`, routed ? '' : `（${r.why}）`)
  ok(mapped, `B ${r.url} 在 **Pages 产物**里（同名映射或 PAGES_KEEP_DIRS 目录）`, mapped ? '' : `（${r.why}）`)
  // 预缓存只对"首屏 module 图"必需；`/core/**` 目前不进 sw 列表（核心里只有 puppet 取它，属可选失败面）
  if (!r.url.startsWith('/core/')) {
    ok(precached, `B ${r.url} 在 **sw.js 预缓存**里（离线首屏）`, precached ? '' : `（${r.why}）`)
  }
}

console.log('\n== C 反向：产物根目录下的 .mjs 都必须有人登记（防"加了文件忘了接线"）==')
const coreFiles = fs.readdirSync(path.join(ROOT, 'core')).filter((f) => /\.(mjs|js)$/.test(f))
const coreImported = new Set()
for (const e of ENTRIES) for (const s of relSpecifiers(read(e.file))) {
  const url = resolveUrl(e.servedUrl, s)
  const m = url.match(/^\/([^/]+\.(?:mjs|js))$/) || url.match(/^\/core\/([^/]+\.(?:mjs|js))$/)
  if (m) coreImported.add(m[1])
}
const unregistered = [...coreImported].filter((f) => coreFiles.includes(f) &&
  !(serverSrc.includes(`'/${f}'`) || buildSrc.includes(`'${f}'`)))
ok(unregistered.length === 0, 'C 每个被 import 的 core 文件都在服务器或产物映射里登记',
  unregistered.length ? `未登记：${unregistered.join(', ')}` : `${coreImported.size} 个被 import 的 core 文件全部登记`)

console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}`)
process.exitCode = fail ? 1 : 0

// demo-check.mjs —— 在线 demo（demo/ + 落地页 + Pages 形态）的仓库侧自查（P-96）
//
// 与 `vendor-ref/ww-pages/bench-patch.test.mjs` 的分工：
//   · 那边测**补丁行为**（263 断言，含 T28 单一真源）；
//   · 这边测**发布形态**：真源唯一性、零个人路径、Pages 产物可构建、广告/免责声明逐字在位。
// 用法: node demo-check.mjs [--json]     退出码 0 = 通过
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')            // ①(2026-09-16) 本脚本在 tests/，根 = 上一级
const JSON_OUT = process.argv.includes('--json')
let pass = 0, fail = 0
const check = (name, cond, detail) => { if (cond) { pass++; if (!JSON_OUT) console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const DEMO = 'demo'
const demoIndex = path.join(ROOT, DEMO, 'index.html')
const landing = path.join(ROOT, 'index.html')

// ---- D1 形态：三个入口都在 ----
{
  check('D1 落地页在仓库根（Pages 的 /）', fs.existsSync(landing))
  check('D1 测试台在 demo/（Pages 的 /demo/）', fs.existsSync(demoIndex))
  check('D1 渲染器 demo（/demo.html）与合成样例说明（/samples/README.md）都在',
    fs.existsSync(path.join(ROOT, 'demo.html')) && fs.existsSync(path.join(ROOT, 'samples', 'README.md')))
  check('D1 发布形态文档在位', fs.existsSync(path.join(ROOT, 'docs', 'ONLINE-DEMO.md')))
  check('D1 Pages 构建脚本 + workflow 在位',
    fs.existsSync(path.join(ROOT, 'build-pages.mjs')) && fs.existsSync(path.join(ROOT, '.github', 'workflows', 'pages.yml')))
}

// ---- D2 单一真源：bench-patch.js 只有一份物理文件 ----
{
  const real = fs.realpathSync(path.join(ROOT, DEMO, 'bench-patch.js'))
  check('D2 demo/bench-patch.js 是仓库内的真源', real === path.join(ROOT, DEMO, 'bench-patch.js'), real)
  // 全树扫描：除真源外，任何 bench-patch.js 都必须是软链（不许出现第二个物理副本）
  const hits = []
  const walk = (d) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '_site') continue
      const p2 = path.join(d, e.name)
      if (e.isDirectory()) walk(p2)
      else if (e.name === 'bench-patch.js') hits.push(p2)
    }
  }
  walk(ROOT)
  const physical = hits.filter((p2) => { try { return !fs.lstatSync(p2).isSymbolicLink() } catch { return false } })
  check('D2 仓库内 bench-patch.js 的物理副本恰好一份（其余只能是软链）',
    physical.length === 1 && physical[0] === path.join(ROOT, DEMO, 'bench-patch.js'),
    physical.map((p2) => path.relative(ROOT, p2)).join(', '))
}

// ---- D3 零个人绝对路径 / 零真实壁纸 ----
{
  const bad = []
  const walk = (d) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '_site') continue
      const p2 = path.join(d, e.name)
      if (e.isDirectory()) walk(p2)
      else if (e.isFile() && /\.(html|js|mjs|css|json|webmanifest|md|txt|yml)$/.test(e.name)) {
        let t = ''
        try { t = fs.readFileSync(p2, 'utf8') } catch { continue }
        if (t.includes('/ro' + 'ot/')) bad.push(path.relative(ROOT, p2))
      }
    }
  }
  // 只扫**本批新增/改写的面**：demo/、docs/ONLINE-DEMO.md、.github/、以及根级新文件。
  // 仓库里既有的测试/工具脚本（含"环境变量优先 + 作者本机默认值"写法）不在本脚本的口径内 ——
  // 那是 `publish-check.mjs` 的 ② 在管（它对 DEFAULT_LINE_RE 有豁免）。
  walk(path.join(ROOT, DEMO))
  walk(path.join(ROOT, '.github'))
  // ①(2026-09-16 目录整理) demo-check 自身已移入 tests/（路径随移动同步，扫描面不变）
  for (const f of ['index.html', 'build-pages.mjs', 'tests/demo-check.mjs', 'docs/ONLINE-DEMO.md']) {
    const p2 = path.join(ROOT, f)
    if (!fs.existsSync(p2)) { bad.push(f + ' (缺失)'); continue }
    // 与 publish-check.mjs 的 ② 同口径：注释里的"去个人化"标记行属于豁免写法（本仓库既有的闸门就长这样）
    const lines = fs.readFileSync(p2, 'utf8').split('\n')
    if (lines.some((l) => l.includes('/ro' + 'ot/') && !/去个人化/.test(l))) bad.push(f)
  }
  check('D3 新增面零个人绝对路径（demo/ + .github/ + 落地页 + 构建/自查脚本 + 形态文档）',
    bad.length === 0, [...new Set(bad)].slice(0, 5).join(', '))
  const pkgs = []
  const walkPkg = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '_site') continue
      const p2 = path.join(d, e.name)
      if (e.isDirectory()) walkPkg(p2)
      else if (/\.(pkg|mpkg|webm|mp4|flac|mp3)$/i.test(e.name)) pkgs.push(p2)
    }
  }
  walkPkg(path.join(ROOT, DEMO)); walkPkg(path.join(ROOT, 'samples'))
  const real = pkgs.filter((p2) => !/sample-synthetic/.test(p2))
  check('D3 demo/ 与 samples/ 里除合成样例以外没有任何壁纸包（真实壁纸零入库）', real.length === 0, real.join(', '))
  const samplePkg = path.join(ROOT, 'samples', 'sample-synthetic', 'scene.pkg')
  const buf = fs.readFileSync(samplePkg)
  check('D3 合成样例字节数与 README 记载一致（33 299 B）+ 容器魔数 PKGV',
    buf.length === 33299 && buf.slice(0, 16).toString('latin1').includes('PKGV'), String(buf.length))
}

// ---- D4 落地页：免责声明逐字 + 三个入口 + 许可链接 ----
{
  const h = read('index.html')
  const ZH = `**免责声明** 本项目与 Wallpaper Engine 官方**无任何关联**，不包含 Wallpaper Engine 本体、Steam 创意工坊内容或任何受版权保护的壁纸资源。本项目**不分发**任何壁纸包（scene 场景包、视频壁纸、网页壁纸）、预览图、音视频或美术素材；仓库内随附的字体仅为各自许可允许再分发的开源字体，逐条见 THIRD-PARTY。用户需自行提供**合法获得**的壁纸，并自行承担因读取、转换或播放相关内容而产生的合规责任。"Wallpaper Engine" 及其相关名称与标识为其各自权利人的商标，本项目仅出于说明兼容性之目的进行指称。本项目渲染器以 GPL-3.0-or-later 发布、插件以 MIT 发布；第三方组件与参考资料（**仅行为对照、未复制代码**）的许可与归属见 THIRD-PARTY.md 与 docs/COPYING-RULES.md。`
  const EN = `**Disclaimer** This project is **not affiliated with Wallpaper Engine** in any way. It does not include the Wallpaper Engine application, any Steam Workshop content, or any copyrighted wallpaper assets. It **does not redistribute** wallpaper packages (scene, video, or web), preview images, audio/video, or artwork; the fonts bundled in this repository are only those open-licensed fonts whose licences permit redistribution (see THIRD-PARTY). **Users must supply their own lawfully obtained wallpapers** and are solely responsible for compliance when reading, converting, or playing such content. "Wallpaper Engine" and related names and marks belong to their respective owners and are referenced here only to describe compatibility. The renderer is released under GPL-3.0-or-later and the plugin under MIT; see THIRD-PARTY.md and docs/COPYING-RULES.md for third-party components and reference material (used for **behavioural comparison only — no code was copied**).`
  // 落地页把 markdown 的 **粗体** 渲染成 <strong>；比对时把两侧都归一化到纯文本
  const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  const norm = (s) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  const text = plain(h)
  check('D4 中文免责声明逐字在位', text.includes(norm(ZH)), '缺失')
  check('D4 英文免责声明逐字在位', text.includes(norm(EN)), '缺失')
  check('D4 三个入口链接都在（./demo/ · ./demo.html · ./samples/README.md）',
    /href="\.\/demo\/"/.test(h) && /href="\.\/demo\.html"/.test(h) && /href="\.\/samples\/README\.md"/.test(h))
  check('D4 许可与致谢链接都在（LICENSE / THIRD-PARTY.md / COPYING-RULES.md / README.md）',
    /href="\.\/LICENSE"/.test(h) && /href="\.\/THIRD-PARTY\.md"/.test(h) &&
    /href="\.\/docs\/COPYING-RULES\.md"/.test(h) && /href="\.\/README\.md"/.test(h))
  /* ①(2026-09-20 用户要求) 落地页/测试台的署名与许可只留**一行链接**指向仓库 README 的「许可与归属」章节；
     两份上游 MIT 全文文件仍在仓库里（下一条 D5 断言文件存在），只是不再逐处列出链接。 */
  check('D4 落地页的许可归属指向仓库 README「许可与归属」章节（不再堆全文链接）',
    /README\.md/.test(h) && /许可与归属|License & credits/.test(h))
  check('D4 落地页不含赞赏/收款入口（二维码图与收款卡片都没加回来）',
    !/sponsor|wechat\.png|alipay\.png|收款码|赞赏码/i.test(h) &&
    /赞赏二维码已移除，本项目不接受也不展示任何收款方式/.test(h))
  check('D4 落地页零外链资源（无第三方 CDN / 无统计脚本：只有 https 的说明性链接）',
    !/<(script|link)[^>]+(src|href)="https?:/.test(h))
}

// ---- D5 测试台入口：相对路径 + 在线横幅 + 许可 ----
{
  const h = read(path.join(DEMO, 'index.html'))
  check('D5 测试台入口相对本页（base + assets + 补丁），两个挂载点都成立',
    /<base href="\.\/" \/>/.test(h) && /src="\.\/assets\/bench-DSKWIqmS\.js"/.test(h) && /src="\.\/bench-patch\.js"/.test(h) &&
    !/src="\/wallpaper-engine-webgl\//.test(h))
  // ①(2026-09-17 新样式，用户第 5 条) 静态横幅搬进「说明」页（#page-docs）的"在线版会少什么"一节 +
  //   头部「设置」弹层的一句说明；归属外链收进设置弹层，id 用 *-footer 专名（文档视图那张卡片已整块删除）。
  check('D5 页面上写清"在线版没有本机后端"（说明页 + 设置弹层，中英双语、纯静态不依赖 JS/后端）',
    /id="page-docs"/.test(h) && /没有本机 Node 后端/.test(h) && /no local Node backend/i.test(h) &&
    /api\/\*/.test(h) && /选择文件夹/.test(h))
  check('D5 测试台设置弹层只留一行「许可与归属」链接（指向本仓 README 的对应章节）',
    /id="credit-link-footer"[^>]*href="https:\/\/github\.com\/XHR666\/wallpaper-engine-web-loader#/.test(h) &&
    !/id="credit-repo-footer"/.test(h) && !/bench-credit-license/.test(h))
  check('D5 上游 MIT 声明两份都在（不许只有一份）',
    fs.existsSync(path.join(ROOT, DEMO, 'LICENSE-webwallgl-MIT.txt')) && fs.existsSync(path.join(ROOT, DEMO, 'LICENSE-webwallgl')))
  check('D5 测试台不引用任何真实壁纸（只认 samples/sample-synthetic）',
    !/sample-synthetic|scene\.pkg/.test(h) || !/allwallpaper|workshop\/content/i.test(h))
  const patch = read(path.join(DEMO, 'bench-patch.js'))
  check('D5 默认壁纸指向合成样例（defaultSamplePlan → ./samples/sample-synthetic/scene.pkg）',
    /DEMO_SAMPLE_REL = 'samples\/sample-synthetic\/'/.test(patch) && /defaultSamplePlan/.test(patch))
  check('D5 合成样例在 demo/ 里可达（软链解析到 samples/，不复制第二份）', (() => {
    const p2 = path.join(ROOT, DEMO, 'samples', 'sample-synthetic', 'scene.pkg')
    if (!fs.existsSync(p2)) return false
    const st = fs.lstatSync(path.join(ROOT, DEMO, 'samples'))
    return st.isSymbolicLink() || true   // 软链或真目录都行，但内容必须是那一份（下一条比对大小）
  })())
}

// ---- D6 Pages 产物可构建 + 自检通过（零依赖、不联网）----
{
  let ok = false, out = ''
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'build-pages.mjs'), '--out', path.join(ROOT, '_site'), '--json'],
      { cwd: ROOT, encoding: 'utf8', timeout: 180_000 })
    ok = true
  } catch (e) { out = String(e.stdout || e.message) }
  // ①(2026-09-19 P-127) 原来这里写死"12 项"（MUST 后来已经长到十几项）⇒ 去掉数字，只判"全过"
  check('D6 build-pages.mjs 退出码 0（产物必需文件自检 + 旧路径重定向页自检全过）', ok, out.slice(0, 200))
  if (ok) {
    const must = ['index.html', 'demo.html', 'bundle.js', 'we-scene-bundle.js', 'sw.js', 'manifest.webmanifest',
      'demo/index.html', 'demo/bench-patch.js', 'demo/LICENSE-webwallgl-MIT.txt',
      // ④(P-127 2026-09-19) 站点路径改名：别名挂载点 = WEwebLoader/；旧名只留重定向页（下面单独断言）
      'WEwebLoader/index.html', 'WEwebLoader/bench-patch.js',
      'WEwebLoader/renderer/index.html', 'samples/sample-synthetic/scene.pkg', '.nojekyll',
      'wallpaper-engine-webgl/index.html', 'wallpaper-engine-webgl/renderer/index.html',
      'wallpaper-engine-webgl/default-wallpaper/index.html',
      // 真机踩到过：`demo/samples` 是**软链目录**，只判 `Dirent.isDirectory()` 会把它整个漏掉
      // ⇒ 产物里没有 demo/samples/ ⇒ 线上默认壁纸 fetch 404。这条断言就是那个坑的钉子。
      'demo/samples/sample-synthetic/scene.pkg', 'demo/samples/sample-synthetic/project.json',
      'WEwebLoader/samples/sample-synthetic/scene.pkg']
    check('D6 产物里必需文件齐（含挂载点 WEwebLoader/、旧路径三张重定向页与 .nojekyll）',
      must.every((f) => fs.existsSync(path.join(ROOT, '_site', f))))
    check('D6 产物是真实文件而非软链（Pages 不解析软链）',
      !fs.lstatSync(path.join(ROOT, '_site', 'samples', 'sample-synthetic', 'scene.pkg')).isSymbolicLink() &&
      !fs.lstatSync(path.join(ROOT, '_site', 'demo', 'bench-patch.js')).isSymbolicLink())
    let leak = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p2 = path.join(d, e.name)
        if (e.isDirectory()) walk(p2)
        else if (/\.(html|js|mjs|css|json|md|txt)$/.test(e.name)) {
          // 与 publish-check.mjs 的 ② 同口径：**排除**"环境变量优先 + 作者本机默认值"的写法
          // （仓库里既有的渲染器脚本就是这么写的；这不属于"泄漏"，闸门本身也豁免它）
          try {
            const lines = fs.readFileSync(p2, 'utf8').split('\n')
            const hit = lines.some((l) => l.includes('/ro' + 'ot/') && !/process\.env\.[A-Z_]+ \|\||MPW_[A-Z_]+ \|\||去个人化/.test(l))
            if (hit) leak.push(path.relative(ROOT, p2))
          } catch {}
        }
      }
    }
    walk(path.join(ROOT, '_site'))
    check('D6 产物里零个人绝对路径（Pages workflow 的 grep 闸门同口径）', leak.length === 0, leak.slice(0, 4).join(', '))
    const siteDemo = path.join(ROOT, '_site', 'demo', 'bench-patch.js')
    const siteAlias = path.join(ROOT, '_site', 'WEwebLoader', 'bench-patch.js')
    check('D6 产物的两份 bench-patch.js 字节相同（同一次拷贝，不可能漂移）',
      fs.readFileSync(siteDemo).equals(fs.readFileSync(siteAlias)))
    // ④-b(P-127) 真产物里的旧路径：三张重定向页 + **零**非重定向页文件（不许第二份真源）
    const legacyDir = path.join(ROOT, '_site', 'wallpaper-engine-webgl')
    const legacyRels = []
    const walkLegacy = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p2 = path.join(d, e.name)
        if (e.isDirectory()) walkLegacy(p2)
        else legacyRels.push(path.relative(legacyDir, p2).split(path.sep).join('/'))
      }
    }
    walkLegacy(legacyDir)
    check('D6 旧路径下只有 3 张重定向页（index / renderer / default-wallpaper），没有第二份真源',
      legacyRels.length === 3 && ['index.html', 'renderer/index.html', 'default-wallpaper/index.html'].every((r) => legacyRels.includes(r)),
      legacyRels.join(', '))
    const stub = fs.readFileSync(path.join(legacyDir, 'index.html'), 'utf8')
    check('D6 真产物里的旧路径重定向页四件套齐（noindex + meta refresh + location.replace + 带 query）',
      /name="robots" content="noindex,nofollow"/.test(stub) && /http-equiv="refresh" content="0; url=/.test(stub) &&
      /location\.replace\(/.test(stub) && /location\.search/.test(stub) && Buffer.byteLength(stub) <= 4096,
      Buffer.byteLength(stub) + ' B')
    check('D6 旧路径不再有 bench-patch.js 拷贝（那条绝对路径靠重定向页兜底，不靠第二份真源）',
      !fs.existsSync(path.join(legacyDir, 'bench-patch.js')))
    fs.rmSync(path.join(ROOT, '_site'), { recursive: true, force: true })
  }
}

// ---- D7 HTML 的 id 唯一性（通用闸门，第七批新增）----
// 为什么是通用闸门：同页两个同 id ⇒ querySelector / querySelectorAll('#x')[0] 只认第一个，
// 第二份永远接不到标签同步或事件。第七批实测撞过两次（产物 #pick-file 被插两份；
// 页脚 #credit-title/#credit-link 与文档视图 #sponsor-card 里那两个撞 id）。
// 先去注释与 script/style 正文再数：注释里提一嘴 id="x"、JS 字符串里写 id="x" 都不是"同页两个同 id"
// （实测假阳性：demo.html 的 <script id="mpw-log-panel"> 正文注释里又提了一次同名 id）。
{
  const SKIP_DIRS = new Set(['.git', '_site', 'node_modules', 'archive', 'vendor', 'elysia', 'samples', '.github'])
  const files = []
  const walk = (d) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name)) }
      else if (/\.html$/i.test(e.name)) files.push(path.join(d, e.name))
    }
  }
  walk(ROOT)
  const strip = (h) => String(h)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const bad = []
  for (const f of files) {
    let html = ''
    try { html = strip(fs.readFileSync(f, 'utf8')) } catch { continue }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
    const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))]
    if (dup.length) bad.push(path.relative(ROOT, f) + ' → ' + dup.join(','))
  }
  check('D7 全仓 HTML 的 id 唯一性（去注释/script 正文后扫 ' + files.length + ' 个文件；重复即红）', bad.length === 0, bad.join(' | '))
  const demoHtml = strip(read(path.join(DEMO, 'index.html')))
  const cnt = (id) => (demoHtml.match(new RegExp('id="' + id + '"', 'g')) || []).length
  check('D7 测试台两个选择器入口各一份（#pick-lib / #pick-file）', cnt('pick-lib') === 1 && cnt('pick-file') === 1, '#pick-lib=' + cnt('pick-lib') + ' #pick-file=' + cnt('pick-file'))
  // ①(2026-09-17 新样式) 原文档视图那张"渲染核心原作者"卡片整块删除 ⇒ 旧 id 计数必须为 0；
  //   归属只保留设置弹层里的 *-footer 一份（各 1）。
  check('D7 归属只留设置弹层里的**一行**链接（#credit-line-footer / #credit-link-footer 各 1；旧的 title/repo/许可全文节点已 0）',
    cnt('credit-title') === 0 && cnt('credit-link') === 0 && cnt('credit-title-footer') === 0 && cnt('credit-repo-footer') === 0 &&
    cnt('credit-line-footer') === 1 && cnt('credit-link-footer') === 1 && !/bench-credit-license/.test(demoHtml),
    JSON.stringify({ t: cnt('credit-title'), l: cnt('credit-link'), tf: cnt('credit-title-footer'), rf: cnt('credit-repo-footer'), line: cnt('credit-line-footer'), lf: cnt('credit-link-footer'), lic: /bench-credit-license/.test(demoHtml) }))
}


// ---- D8 首屏静态布局 CSS 与补丁里的 SITE_LAYOUT_CSS 必须逐条等价（2026-09-18"一帧全屏放大"修复的防漂移断言）
{
  const html = read(path.join(DEMO, 'index.html'))
  const patchSrc = read(path.join(DEMO, 'bench-patch.js'))
  const mStatic = html.match(/<style id="bench-shell-static">([\s\S]*?)<\/style>/)
  const mArr = patchSrc.match(/const SITE_LAYOUT_CSS = \[([\s\S]*?)\]\.join\(''\)/)
  check('D8 首屏静态外壳 CSS 在位（<style id="bench-shell-static">）', !!mStatic && mStatic[1].length > 4000, mStatic ? String(mStatic[1].length) + 'B' : '缺失')
  check('D8 head 里同步加 html.bench-shell 类（首帧即生效），且 ?shell=off 时跳过',
    /classList\.add\('bench-shell'\)/.test(html) && /shell=\(off\|0\|false\|no\)/.test(html))
  if (mStatic && mArr) {
    const items = [...mArr[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"))
    const norm = (t) => t.replace(/\s+/g, ' ').trim()
    // 注意顺序：先把 CSS 按行切开再逐行归一化（先 norm 会把整份 CSS 折成一行 ⇒ 集合里只剩一个大串，永远比不中）
    const staticSet = new Set(mStatic[1].split('\n').map(norm).filter((l) => l && l.includes('{')))
    const missing = []
    for (const it of items) {
      if (!it.includes('{')) continue                                  // 纯注释条目跳过
      if (it.startsWith('@media')) continue
      const i = it.indexOf('{')
      const sels = it.slice(0, i).split(',').map((x) => x.trim())
      const rest = norm(it.slice(i))
      const want = norm(sels.map((x) => (x.startsWith('html[') ? x : 'html.bench-shell ' + x)).join(', ') + rest)
      if (!staticSet.has(want)) missing.push(want.slice(0, 70))
    }
    check('D8 静态 CSS 覆盖补丁 SITE_LAYOUT_CSS 的每条布局规则（逐条比对，漂移即红）', missing.length === 0,
      missing.length ? missing.slice(0, 3).join(' | ') + ' …共' + missing.length : '逐条一致')
  }
}

// ---- D9 窄屏判定的静态把守（2026-09-18 平板"桌面版网站"修复的防回归断言）
// 为什么要有这一组：窄屏那条路**在无头环境里最容易"看起来修好了"**——CSS 大括号少一个、
// `.bench-narrow` 规则被 @media 包住/漏在外面、判定阈值改回 860，页面在桌面宽度下全都不报错，
// 只有真机（手机/平板）才看得出来。这里把它钉成**纯静态**断言，任何一条被改坏都会红。
{
  const html = read(path.join(DEMO, 'index.html'))
  const mStatic = html.match(/<style id="bench-shell-static">([\s\S]*?)<\/style>/)
  const cssRaw = mStatic ? mStatic[1] : ''
  // ⚠ 先剥注释再数大括号：2026-09-18 自测时，注释里写了一个 `}` 就让"平衡检查"误报（与 P-114.2 的
  //   "括号检查数了注释散文"是同一类假阳性）⇒ 所有结构判定都在剥注释后的文本上做。
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ')
  check('D9 首屏静态样式块在位且 >4KB', cssRaw.length > 4000, cssRaw.length + 'B')

  // ① 大括号平衡（剥注释）
  let depth = 0, firstNeg = -1
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') { depth--; if (depth < 0 && firstNeg < 0) firstNeg = i }
  }
  check('D9 静态样式块大括号平衡（剥注释；depth 归零且不出现多余的 }）', depth === 0 && firstNeg < 0,
    'depth=' + depth + (firstNeg >= 0 ? '；首个多余 } 在偏移 ' + firstNeg + '（' + JSON.stringify(css.slice(Math.max(0, firstNeg - 40), firstNeg + 2)) + '）' : ''))

  // ② 判定阈值唯一、> 980（桌面版网站的布局视口**恒为 980px** ⇒ 阈值 ≤980 等于永不命中）
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const head = scripts.find((s) => s.includes('bench-narrow')) || ''
  // 只看 `var narrow = …` 这一条**判定表达式**里的比较（`vw <= 1100` 是 bench-mid 的另一件事，不算）
  const narrowExpr = (head.match(/var\s+narrow\s*=([^\n]*)/) || [])[1] || ''
  const ths = [...narrowExpr.matchAll(/\bvw\s*<=\s*(\d+)/g)].map((m) => Number(m[1]))
  check('D9 窄屏判定表达式里阈值恰好一处、且 =1180（> 980）', ths.length === 1 && ths[0] === 1180,
    'narrow 表达式=' + JSON.stringify(narrowExpr.trim()) + ' ⇒ 阈值 ' + JSON.stringify(ths))
  check('D9 阈值不是 860（历史值：980 > 860 ⇒ 桌面模式手机/平板永不命中）', !ths.includes(860) && !/\bvw\s*<=\s*860\b/.test(head))
  check('D9 判定仍在**首屏同步**路径上（加类之前不许出现 addEventListener/DOMContentLoaded 等待）',
    /classList\.add\('bench-narrow'\)/.test(head) && (head.indexOf('addEventListener') < 0 || head.indexOf("classList.add('bench-narrow')") < head.indexOf('addEventListener')))

  // ③ 类块**不许**被 @media 包住（历史 bug：@media 开头那一行被删掉 ⇒ 孤立规则 + 多余 `}` + 末尾规则泄漏到桌面）
  const firstNarrow = css.indexOf('html.bench-shell.bench-narrow')
  const safetyAt = css.indexOf('@media (max-width:1180px)')
  check('D9 `.bench-narrow` 类块在 @media 之外（从第一条类规则到安全网之间不许出现 @media）',
    firstNarrow >= 0 && safetyAt > firstNarrow && css.slice(firstNarrow, safetyAt).indexOf('@media') < 0,
    'firstNarrow=' + firstNarrow + ' safetyAt=' + safetyAt)
  check('D9 无"自己是自己后代"的死选择器（`.bench-narrow  html.bench-shell …`）', !/bench-narrow\s+html\.bench-shell/.test(css))

  // ④⑤ 规则级判定：统一成"元素集合 + 声明"的规范键（选择器列表逐个剥前缀，逗号列表不许被当成一个整体）
  const canon = (sel) => sel.split(',').map((s) => s.trim().replace(/^html\.bench-shell(\.bench-narrow)?\s+/, '')).filter(Boolean).sort().join(' | ')
  const leaf = (t) => [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
    const sel = m[1].trim().replace(/\s+/g, ' ')
    return { narrow: sel.includes('bench-narrow'), key: canon(sel), decl: m[2].trim().replace(/\s+/g, ' ') }
  })
  const classRules = new Set(leaf(css.slice(firstNarrow, safetyAt)).filter((r) => r.narrow).map((r) => r.key + '{' + r.decl + '}'))
  const safetyRules = leaf(safetyAt >= 0 ? css.slice(safetyAt) : '')
  const drift = safetyRules.filter((r) => !classRules.has(r.key + '{' + r.decl + '}'))
  check('D9 安全网（@media ≤1180）的每条规则都在 `.bench-narrow` 类块里有逐字同款（零漂移）',
    safetyRules.length >= 5 && drift.length === 0,
    '安全网规则 ' + safetyRules.length + ' 条' + (drift.length ? '，漂移 ' + drift.length + '：' + drift.slice(0, 2).map((r) => r.key + '{' + r.decl + '}').join(' | ') : ''))

  // ⑤ 本该"只在窄屏生效"的三条规则不许有**非窄屏**版本（历史 bug：末尾 4 条裸在顶层 ⇒ 桌面工具栏/标签/弹层被一起缩小）
  const NARROW_ONLY = [
    ['#toolbar label, #toolbar .mini', 'font-size:11px'],
    ['.site-tab', 'padding:0 9px;font-size:12.5px'],
    ['#settings-pop', 'width:min(92vw,330px);right:0'],
  ]
  const leaked = []
  for (const [sel, decl] of NARROW_ONLY) {
    const key = canon(sel)                                        // 期望键也走同一套规范化（排序/去前缀），免得手写顺序对不上
    const hits = leaf(css).filter((r) => r.key === key)
    if (!hits.some((r) => r.narrow && r.decl === decl)) leaked.push('缺窄屏版本：' + key)
    for (const r of hits.filter((x) => !x.narrow && x.decl === decl)) leaked.push(r.key + '{' + r.decl + '}')
  }
  check('D9 窄屏专属的三条规则：既有 `.bench-narrow` 版本、又没有裸在桌面宽度上的版本', leaked.length === 0, leaked.join(' | '))

  // ⑥ 横向溢出必须在**根元素**上裁（body 那条在部分引擎不传播到视口；实测 Firefox 能横拖 1960px）
  check('D9 根元素裁横向溢出（html.bench-shell{overflow-x:hidden}）与 body 那条并存',
    /html\.bench-shell\{overflow-x:hidden\}/.test(css) && /html\.bench-shell body\{overflow-x:hidden\}/.test(css))
}

// ---- D10 品牌位（2026-09-18 用户改名：旧名 WebWallGL → 新名 WEwebLoader）
// 为什么要判"语境"而不是"全文零命中"：(B) **上游归属位必须保留原样** —— 指向上游 `oneincase/webwallgl`
// （MIT）的归属行、外链、许可文件名（`demo/LICENSE-webwallgl*`）里对上游项目的称呼是**许可要求**，
// 删了就是合规问题。所以这一组钉住四条，任何一条被改坏都会红：
//   ① 品牌位（`<title>` / `<h1>` / `#site-brand` / manifest 的 name+short_name）里**零旧名**；
//   ② 旧名在整页里的**每一处出现**都必须落在归属语境（上下文窗口内有 oneincase / LICENSE-webwallgl / MIT / 上游 / upstream）；
//   ③ 归属本身仍在（上游外链 + 两份 MIT 许可文件名 + 归属行里的旧名计数）—— 否则"零命中"会是假绿；
//   ④ 新名 `WEwebLoader` 在产品面**真的出现**（防"删掉旧名却没换上新名"这种假绿）。
{
  const OLD = /webwallgl/i
  const NEW = 'WEwebLoader'
  const FILES = ['index.html', 'demo/index.html', 'demo/renderer/index.html', 'demo/default-wallpaper/index.html', 'demo/manifest.webmanifest']
  const texts = Object.fromEntries(FILES.map((f) => [f, read(f)]))
  const title = (h) => ((h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim()
  const countOld = (s) => [...s.matchAll(/webwallgl/gi)].length

  // ① 品牌位零旧名
  const slots = []
  for (const f of FILES) {
    if (f.endsWith('.webmanifest')) continue
    slots.push([f + ' <title>', title(texts[f])])
    if (f === 'index.html') slots.push([f + ' <h1>', (texts[f].match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || ''])
    if (f === 'demo/index.html') slots.push([f + ' #site-brand', (texts[f].match(/<div id="site-brand">([\s\S]*?)<\/div>/) || [])[1] || ''])
  }
  const dirty = slots.filter(([, t]) => OLD.test(t)).map(([n]) => n)
  check('D10 品牌位零旧名（' + slots.map(([n]) => n).join(' / ') + '）', dirty.length === 0, dirty.join(', '))
  const mfRaw = texts['demo/manifest.webmanifest']
  const mf = JSON.parse(mfRaw)
  check('D10 PWA 名已是新名、manifest 全文零旧名',
    mf.short_name === NEW && String(mf.name).startsWith(NEW) && !OLD.test(mfRaw),
    JSON.stringify({ name: mf.name, short_name: mf.short_name }))
  check('D10 渲染器页（无归属内容）全文零旧名',
    !OLD.test(texts['demo/renderer/index.html']), 'demo/renderer/index.html')
  // ①(2026-09-18) 兜底壁纸页是**上游产物原样再分发**的一个普通 HTML（改名前与上游 public/default-wallpaper/index.html
  //   逐字节相同），页面上那行大标题就是产品名 ⇒ 同属 (A) 品牌位；它没有归属内容，所以判"全文零旧名 + 新名在位"。
  check('D10 兜底壁纸页（无归属内容）全文零旧名且已是新名',
    !OLD.test(texts['demo/default-wallpaper/index.html']) && texts['demo/default-wallpaper/index.html'].includes(NEW),
    'demo/default-wallpaper/index.html')

  // ② 旧名的每一处出现都必须在归属/出处语境里
  //   "归属/出处语境"的判据词：上游项目名（oneincase/upstream/上游）、许可（MIT）、许可文件名、
  //   以及"上游产物"这类**出处说明**（落地页卡片 "在线测试台（打过补丁的 WebWallGL 产物）" 就是这一类：
  //   它指称的是上游产物、不是本产品的自称 ⇒ 属 (B) 保留位）。真正要拦的是"我们以旧名自称"。
  const CTX = /oneincase|LICENSE-webwallgl|MIT|上游|upstream|产物|artifact|redistribution|再分发/i
  for (const f of ['index.html', 'demo/index.html']) {
    const lines = texts[f].split('\n')
    const bad = []
    lines.forEach((l, i) => {
      if (!OLD.test(l)) return
      const win = lines.slice(Math.max(0, i - 3), i + 4).join(' ')
      if (!CTX.test(win)) bad.push((i + 1) + ':' + l.trim().slice(0, 64))
    })
    check('D10 ' + f + '：旧名只出现在归属/出处语境（oneincase / MIT / LICENSE-webwallgl / 上游 / 产物）',
      bad.length === 0, bad.slice(0, 3).join(' | '))
  }

  // ③ 归属仍在（不许为了让上面几条变绿而删归属；也防"零命中"假绿）
  check('D10 归属未被改名的顺手删除（上游外链 + 两份 MIT 许可文件名在测试台与落地页都在）',
    /github\.com\/oneincase\/webwallgl/.test(texts['demo/index.html']) && /github\.com\/oneincase\/webwallgl/.test(texts['index.html']) &&
    /LICENSE-webwallgl-MIT\.txt/.test(texts['demo/index.html']) && /LICENSE-webwallgl"/.test(texts['demo/index.html']) &&
    /LICENSE-webwallgl-MIT\.txt/.test(texts['index.html']) && /LICENSE-webwallgl"/.test(texts['index.html']))
  check('D10 归属行里的旧名计数未归零（上游署名不许被"改名"顺手清掉）',
    countOld(texts['demo/index.html']) >= 4 && countOld(texts['index.html']) >= 4,
    'demo/index.html=' + countOld(texts['demo/index.html']) + ' index.html=' + countOld(texts['index.html']))

  // ④ 新名真的出现
  const missingNew = FILES.filter((f) => !texts[f].includes(NEW))
  check('D10 新名 ' + NEW + ' 在产品面真的出现（' + FILES.length + ' 个文件全覆盖）', missingNew.length === 0, missingNew.join(', '))
  check('D10 渲染器页 <title> 已是新名', title(texts['demo/renderer/index.html']) === NEW + ' Renderer', title(texts['demo/renderer/index.html']))
  check('D10 测试台 SW 的自述已改名（demo/sw.js 首行注释）', /WEwebLoader/.test(read('demo/sw.js').split('\n')[0]))

  // ⑤ ⑧(2026-09-18 裁定 1) 测试台**运行期呈现**的品牌名 = WEwebLoader —— 头部品牌位与 document.title 由补丁在
  //   呈现层覆盖（静态 <title> / DICT app.title / minified 产物被门禁 T1/T5/T8 与许可口径钉住，一律不动）。
  //   这一节只做纯函数 + 源码级断言（不跑浏览器）；同一条链路的冷启动真跑断言在仓外 bench-patch.test.mjs 的 T5b。
  {
    const patchSrc = read('demo/bench-patch.js')
    const artifact = read('demo/assets/bench-DSKWIqmS.js')
    const P = await import(pathToFileURL(path.join(ROOT, DEMO, 'bench-patch.js')).href)
    // (a) 决策纯函数
    check('D10 运行期品牌：默认 = WEwebLoader / 回退 = 上游名',
      P.appBrandPlan({}).name === NEW && P.appBrandPlan({}).overridden === true &&
      P.appBrandPlan({ override: false, upstreamTitle: 'wallpaper-engine-webgl' }).name === 'wallpaper-engine-webgl' &&
      P.appBrandPlan({ override: false, upstreamTitle: 'wallpaper-engine-webgl' }).overridden === false,
      JSON.stringify([P.appBrandPlan({}), P.appBrandPlan({ override: false, upstreamTitle: 'x' })]))
    // (b) 写 DOM：品牌名 + <title>，**不碰**版本号元素
    check('D10 运行期品牌：只写品牌名与 <title>，版本号元素不动',
      (() => {
        const brandEl = { textContent: 'wallpaper-engine-webgl' }, versionEl = { textContent: 'v1.3.16' }, doc = { title: 'wallpaper-engine-webgl' }
        const plan = P.applySiteBrand({ override: true, upstreamTitle: 'wallpaper-engine-webgl', brandEl, doc })
        return plan.name === NEW && brandEl.textContent === NEW && doc.title === NEW && versionEl.textContent === 'v1.3.16'
      })())
    // (c) 回退开关：?brand=upstream / ?appname=upstream|0|off；且 ?brand=0 只关媒体品牌、不关站点品牌
    check('D10 运行期品牌回退开关（?brand=upstream 与 ?appname=upstream 都能还原上游名）',
      P.readPatchFlags('').appname === true &&
      P.readPatchFlags('?brand=upstream').appname === false && P.readPatchFlags('?brand=upstream').brand === true &&
      P.readPatchFlags('?appname=upstream').appname === false && P.readPatchFlags('?appname=0').appname === false &&
      P.readPatchFlags('?brand=0').appname === true && P.readPatchFlags('?brand=0').brand === false)
    // (d) 静态钉子**仍在**（改了它们会撞 T5/T8/T1 与许可口径）：静态 <title>、DICT app.title、minified 产物 2 处
    check('D10 静态钉子未被动（<title> 与 DICT app.title 仍是上游名，产物 app.title 仍是 2 处）',
      title(texts['demo/index.html']) === 'wallpaper-engine-webgl' && P.DICT.zh['app.title'] === 'wallpaper-engine-webgl' &&
      P.DICT.en['app.title'] === 'wallpaper-engine-webgl' &&
      (artifact.match(/"app\.title":"wallpaper-engine-webgl"/g) || []).length === 2)
    // (e) 源码级：覆盖必须在 applyStaticI18n **之后**重放（否则语言一切换就变回上游名）+ 选择器指向真实节点
    const langBlock = patchSrc.slice(patchSrc.indexOf('function applyLang('), patchSrc.indexOf('function applyLang(') + 1600)
    check('D10 运行期品牌覆盖挂在语言切换链上、且在 applyStaticI18n 之后',
      langBlock.indexOf('applyStaticI18n(doc, curLang)') >= 0 && langBlock.indexOf('applySiteBrandNow()') > langBlock.indexOf('applyStaticI18n(doc, curLang)'),
      'applyStaticI18n@' + langBlock.indexOf('applyStaticI18n(doc, curLang)') + ' applySiteBrandNow@' + langBlock.indexOf('applySiteBrandNow()'))
    check('D10 运行期品牌覆盖的选择器指向真实存在的品牌位（#site-brand 的 data-i18n="app.title"）',
      /doc\.querySelector\('\[data-i18n="app\.title"\]'\)/.test(patchSrc) &&
      /<span class="brand-name" data-i18n="app\.title">/.test(texts['demo/index.html']))
  }
}

// ---- D11（2026-09-19 用户第 ⑪/⑫/⑬ 条）三条真机 bug 的静态把守 + 纯函数判据 ----
// 为什么是静态的：这三条都发生在**真机平板**（980×690 横屏"桌面版网站"）——
//   ⑪ 输出区整块排在折叠线以下；⑫a「收起」被自己的 CSS 锁顶掉；⑫b 设置弹层被自己的"点击捕手"盖住；
//   ⑬ 下拉浮层被祖先的 overflow 裁成一块。它们都**不是**逻辑错，而是布局/层叠/裁剪的错
//   ⇒ 用"源码级结构 + 纯函数几何"钉住，任何一条被改回去都会红（见 P-123）。
{
  const html = read(path.join(DEMO, 'index.html'))
  const patchSrc = read(path.join(DEMO, 'bench-patch.js'))
  const vendorCss = read(path.join(DEMO, 'assets', 'bench-HtRiuWm6.css'))
  const mStatic = html.match(/<style id="bench-shell-static">([\s\S]*?)<\/style>/)
  const cssRaw = mStatic ? mStatic[1] : ''
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const P = await import(pathToFileURL(path.join(ROOT, DEMO, 'bench-patch.js')).href)
  const declOf = (re) => { const m = css.match(re); return m ? m[1] : null }
  const hasLine = (t) => cssRaw.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).includes(t)

  // ⑪ 输出区：可见高度下限 + 首屏顺序（舞台之后、面板之前）
  const logsFloorSel = 'html.bench-shell.bench-narrow #main:not(.logs-collapsed) #logs'
  const logsFloor = hasLine(logsFloorSel + '{min-height:clamp(180px,38vh,320px)}')
  check('D11 ⑪ 窄屏给输出区 #logs 一个可见高度下限（clamp(180px,38vh,320px)，收起态除外）', logsFloor)
  const floorPx = Number((declOf(/min-height:clamp\((\d+)px/) || '0'))
  check('D11 ⑪ 下限至少 180px（≈9 行 @12px/1.55；改小即红）', floorPx >= 180, floorPx + 'px')
  check('D11 ⑪ 下限的收起态豁免用的是 #main:not(.logs-collapsed)（收起是用户显式选择，不许被下限顶开）',
    /#main:not\(\.logs-collapsed\) #logs\{min-height/.test(css) &&
    /#main\.logs-collapsed/.test(read(path.join(DEMO, 'assets', 'bench-HtRiuWm6.css'))))
  check('D11 ⑪ 窄屏把 #main 排到面板之前（#workbench 容器改 flex 列 + #main{order:-1}）',
    /#workbench\{display:flex!important;flex-direction:column;height:auto!important\}/.test(css) &&
    /#main\{display:flex!important;flex-direction:column;order:-1;height:auto!important;overflow:visible\}/.test(css))
  // 安全网（@media ≤1180）里也必须有逐字同款（head 脚本没跑成时同样成立）
  check('D11 ⑪ 安全网 @media 里两条同款齐全（下限 + 顺序）',
    /html\.bench-shell #main:not\(\.logs-collapsed\) #logs\{min-height:clamp\(180px,38vh,320px\)\}/.test(css) &&
    /html\.bench-shell #workbench\{display:flex!important;flex-direction:column;height:auto!important\}/.test(css) &&
    /html\.bench-shell #main\{display:flex!important;flex-direction:column;order:-1;height:auto!important;overflow:visible\}/.test(css))
  // 首屏可见高度的**算术复核**（常量来自 2026-09-19 真机 980×690 实测：header=62、切换栏=32、
  //   工具条=112、舞台=48vh=331；面板的 max-height 是 clamp(140px,22vh,320px) ⇒ 152px/个）。
  //   ⚠ 这里**读 CSS 里的顺序**决定面板算不算在输出上面 —— 把 `#main{order:-1}` 改回去这条就红。
  {
    const vh = 690, firstScreen = vh - 62
    const stage = Math.round(vh * 0.48)
    const reordered = /#main\{display:flex!important;flex-direction:column;order:-1;height:auto!important;overflow:visible\}/.test(css)
    const panelPx = Math.min(320, Math.round(vh * 0.22))
    const panelsAbove = reordered ? 0 : 2 * panelPx
    const logsAbove = firstScreen - (panelsAbove + 32 + 112 + stage)
    check('D11 ⑪ 980×690 首屏内输出区可见高度 ≥120px（顺序 + 面板高度一起算；改回旧顺序为负 ⇒ 整块在折叠线以下）',
      reordered && logsAbove >= 120, '顺序=' + (reordered ? '舞台之后' : '面板之后') + '，可见高度 ' + logsAbove + 'px')
  }

  // ⑫a「壁纸配置」可收起：类规则必须**排在** #props[hidden] 之后（同特异度 ⇒ 靠源序取胜）+ JS 链路在位
  const atPropsHidden = css.indexOf('#props[hidden]{display:flex!important}')
  const atPropsCollapsed = css.indexOf('#props.bench-props-collapsed{display:none!important}')
  const specOf = (sel) => {
    const ids = (sel.match(/#[\w-]+/g) || []).length
    const cls = (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/\[[^\]]+\]/g) || []).length
    const el = (sel.replace(/[#.][\w-]+|\[[^\]]+\]|:not\([^)]*\)/g, ' ').match(/[a-z]+/gi) || []).length
    return ids * 100 + cls * 10 + el
  }
  check('D11 ⑫a #props.bench-props-collapsed 的 display:none!important 在 #props[hidden] 之后（源序决胜）',
    atPropsHidden >= 0 && atPropsCollapsed > atPropsHidden, 'hidden@' + atPropsHidden + ' collapsed@' + atPropsCollapsed)
  check('D11 ⑫a 两条规则**同特异度**（不等就说明"靠源序"的论证不成立）',
    specOf('html.bench-shell #props[hidden]') === specOf('html.bench-shell #props.bench-props-collapsed'),
    specOf('html.bench-shell #props[hidden]') + ' vs ' + specOf('html.bench-shell #props.bench-props-collapsed'))
  check('D11 ⑫a SITE_LAYOUT_CSS 与静态表都带这条锁（D8 之外再点一次名，防只改一处）',
    patchSrc.includes("'#props.bench-props-collapsed{display:none!important}'") &&
    css.includes('html.bench-shell #props.bench-props-collapsed{display:none!important}'))
  check('D11 ⑫a JS：收起按钮 / 工具栏按钮 / 持久化 / 产物处理器摘除 四件都在',
    /propsCloseBtn\.addEventListener\('click'/.test(patchSrc) &&
    /setPropsCollapsed\(!propsCollapsedNow\(\)\)/.test(patchSrc) &&
    /propsToggleBtn\.onclick = null/.test(patchSrc) &&
    /PROPS_COLLAPSED_KEY = 'bench-props-collapsed'/.test(patchSrc) &&
    /setPropsCollapsed, propsCollapsed: propsCollapsedNow/.test(patchSrc))
  check('D11 ⑫a JS：产物那条 `#workspace.props-open`（会白丢 360px 舞台宽）被主动摘掉',
    /ws\.classList\.remove\('props-open'\)/.test(patchSrc) && /#workspace\.props-open\{grid-template-columns:minmax\(0,1fr\) 360px\}/.test(vendorCss))

  // ⑫b 设置弹层不再被自己的"点击捕手"盖住：捕手 z-index 必须 < #site-header 的 30 < 弹层的 40
  const catcherZ = Number((declOf(/#settings-catcher\{[^}]*z-index:(\d+)/) || 'NaN'))
  const headerZ = Number((declOf(/#site-header\{[^}]*z-index:(\d+)/) || 'NaN'))
  const popZ = Number((declOf(/#settings-pop\{[^}]*z-index:(\d+)/) || 'NaN'))
  check('D11 ⑫b 捕手 z-index < #site-header 的 30 < 弹层的 40（header 是层叠上下文 ⇒ 弹层的 40 只在它内部有效）',
    catcherZ < headerZ && headerZ < popZ, 'catcher=' + catcherZ + ' header=' + headerZ + ' pop=' + popZ)
  check('D11 ⑫b 弹层确实在 #site-header 内部（这才让"捕手盖住整个 header"成立；也才是这条判据的前提）',
    html.indexOf('<header id="site-header">') < html.indexOf('id="settings-pop"') &&
    html.indexOf('id="settings-pop"') < html.indexOf('</header>'))
  check("D11 ⑫b 捕手仍然挂在 body 上 + 事件仍是 pointerdown/click 两条（改挂点会改变裁剪/层叠前提）",
    /catcher\.parentNode !== D\.body\) D\.body\.appendChild\(catcher\)/.test(patchSrc) &&
    /catcher\.addEventListener\('pointerdown'/.test(patchSrc) && /catcher\.addEventListener\('click'/.test(patchSrc))

  // ⑫c 主题两态（深色 / 浅色，去掉"跟随系统"）
  check('D11 ⑫c 纯函数：两态循环 + 历史 auto 迁移（不再有第三态）',
    P.nextThemeMode('dark') === 'light' && P.nextThemeMode('light') === 'dark' &&
    P.themePlan('auto', true).mode === 'dark' && P.themePlan('bogus', false).mode === 'light' &&
    P.normalizeThemeMode('light', true) === 'light')
  check('D11 ⑫c DICT 仍保留 theme.auto/dark/light 三键（T1 与上游 i18n.ts 逐键比对；键在、UI 不用）',
    !!P.DICT.zh['theme.auto'] && !!P.DICT.zh['theme.dark'] && !!P.DICT.zh['theme.light'] &&
    !!P.DICT.en['theme.auto'] && !!P.DICT.en['theme.dark'] && !!P.DICT.en['theme.light'])
  check('D11 ⑫c 静态 HTML：两个开关在位、旧的"跟随系统"行与它的 i18n 钩子已删',
    /id="theme-dark"/.test(html) && /id="theme-light"/.test(html) &&
    /data-i18n="theme\.dark"/.test(html) && /data-i18n="theme\.light"/.test(html) &&
    !/id="theme-state"/.test(html) && !/data-i18n(-title)?="theme\.auto"/.test(html))
  check('D11 ⑫c JS：不再用 theme.auto 渲染标题/文案（标题只在 dark/light 两态下写；theme.auto 只留在 DICT 里）',
    !/tr\(curLang\(\), 'theme\.' \+ mode\)/.test(patchSrc) &&
    /\(themeBtn\.dataset\.mode === 'dark' \|\| themeBtn\.dataset\.mode === 'light'\)\) themeBtn\.title = t\(curLang, 'theme\.' \+ themeBtn\.dataset\.mode\)/.test(patchSrc) &&
    /themeBtn\.onclick = \(\) => applyThemeMode\(nextThemeMode\(currentThemeMode\(\)\)\)/.test(patchSrc) &&
    // DICT 定义行以外，全文不许再出现 theme.auto 的**取值/按键拼接**
    !/theme\.'\s*\+\s*\(?mode\b/.test(patchSrc) &&
    (patchSrc.split('\n').filter((l) => !l.includes('export const DICT')).join('\n').match(/'theme\.auto'/g) || []).length === 0)
  /* ⑥(2026-09-20 用户第 6 条「暗色模式小月亮图标不居中」)：判据从"写了 flex 居中"升级成**几何居中的三件事
     同时在场** —— ①按钮 `border:0`（产物 `.act` 的 `border-left:2px` 在 `*{box-sizing:border-box}` 下
     会把内容盒推右 1px，实测就是这个）②容器居中（flex/`place-items`）③图标 `display:block;line-height:1`。
     真正的几何判据（中心偏差 ≤1px、两主题各一次）在 tests/bench-ui-headless-test.mjs 的 G 组。 */
  check('D11 ⑥ 图标居中：.theme-btn 去边框 + flex/place-items 居中 + 内联 svg 块级化（去掉基线降部留白）',
    /#site-actions \.theme-btn\{[^}]*border:0[^}]*display:inline-flex;align-items:center;justify-content:center;place-items:center;padding:0;line-height:1[^}]*\}/.test(css) &&
    /#theme-toggle \.ic\{display:block;flex:none\}/.test(css) &&
    /#theme-toggle svg\.ic\{display:block;line-height:1;margin:0;vertical-align:middle\}/.test(css))
  check('D11 ⑥ 三条居中声明在 SITE_LAYOUT_CSS 里也有（D8 逐条比对之外再点名）',
    patchSrc.includes("display:inline-flex;align-items:center;justify-content:center;place-items:center;padding:0;line-height:1") &&
    patchSrc.includes("'#theme-toggle .ic{display:block;flex:none}'") &&
    patchSrc.includes("'#theme-toggle svg.ic{display:block;line-height:1;margin:0;vertical-align:middle}'"))

  // ⑬ 下拉浮层：position:fixed + 自己算坐标 + 祖先链上没有会"抓走"固定定位的 transform/contain
  check('D11 ⑬ .bench-rd-list 改成 position:fixed（脱离 #toolbar{overflow:auto} / #workbench{overflow:hidden} 的裁剪）',
    /html\.bench-shell \.bench-rd-list\{position:fixed;z-index:70;top:auto;left:auto;min-width:0;max-height:min\(280px,42vh\);overflow-y:auto\}/.test(css) &&
    /\.bench-rd-list \{[\s\S]{0,120}position: absolute;/.test(vendorCss))
  check('D11 ⑬ 产物那条 min-width:100% 被 min-width:0 覆盖（fixed 下 100% 会等于视口宽）',
    /\.bench-rd-list\{[^}]*min-width:0/.test(css))
  check('D11 ⑬ 固定定位的祖先链上只有 #pages-track 会裁（contain:paint）——其余祖先不得声明 transform/filter/contain/will-change',
    (() => {
      // 祖先集合 = 树上从 .bench-rd 到 body 的**每个**元素（工位/属性面板/设置弹层三处下拉都覆盖）
      const anc = ['#toolbar', '#editor-chrome', '#main', '#workspace', '#workbench', '#page-console', '.page',
        '#props-body', '#props', '#sidebar', '.lang-box', '#settings-pop', '#site-actions', '#site-header']
      // 逐条规则解析选择器：只要某个"复合选择器片段"恰好是祖先之一，就检查它的声明
      const bad = []
      for (const src of [vendorCss, css]) {
        for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const sels = m[1].split(',').map((s) => s.trim().split(/\s+/)).flat()
          const hit = anc.find((a) => sels.some((tok) => tok === a || tok.startsWith(a + ':') || tok.startsWith(a + '.')))
          if (!hit) continue
          const decl = m[2]
          const danger = decl.match(/(^|;)\s*(transform|filter|perspective|will-change|contain)\s*:\s*([^;]+)/)
          if (danger && !/^none$/i.test(String(danger[3]).trim())) bad.push(hit + '{' + danger[0].trim() + '}')
        }
      }
      return bad.length === 0 && /#pages-track\{[^}]*contain:paint/.test(css)
    })())
  check('D11 ⑬ 展开时按 dropdownLayerPlan 写内联坐标（**减掉包含块原点**：`#pages-track{contain:paint}` 抓走 fixed 定位），且在 addEventListener(\'scroll\',…,true) / resize 时收起',
    /const plan = dropdownLayerPlan\(rect, clip, vp, list\.scrollHeight \|\| 280\)/.test(patchSrc) &&
    /const off = layerFixedOffset\(clip, inside\)/.test(patchSrc) &&
    /list\.style\.top = \(plan\.top - off\.dy\) \+ 'px'/.test(patchSrc) &&
    /list\.style\.left = \(plan\.left - off\.dx\) \+ 'px'/.test(patchSrc) &&
    /* ①(2026-09-22 用户第 29 条) **契约更新**（旧 → 新）：旧契约只要求"scroll ⇒ closeAll"；新契约要求
       捕获监听仍在、且**浮层自己内部的滚动不再关它**（下拉列表 `overflow-y:auto` 可滚，一滚滚轮就关 =
       用户报的那个 bug）。这里同样要求"非内部的滚动仍然收起" —— 是加严不是放宽。
       ⚠⑦(2026-09-25) **再次收窄**（旧 → 新，理由同 `demo/mpw-select.js` 与 `bench-dropdown-theme-test` 29 组）：
       捕获监听连**与锚点无关**的容器滚动也收得到 —— 实测日志窗 `#logbody` 在场景加载时自己往下跟，
       250ms 内滚 4 次，刚展开的下拉被收掉（"点开就没了"）。新契约 = **只有可能移动锚点的滚动源**
       （视口/文档、或该浮层锚点 `d.btn` 的祖先）才收起，判据走同一份纯函数 `scrollAffectsAnchor`。
       "浮层内部跳过"与 `resize ⇒ closeAll` 两条**逐字保留**（是收窄之外的原意，没有放宽）。 */
    /addEventListener\('scroll', \(e\) => \{[\s\S]{0,900}?d\.wrap\.contains\(t\)[\s\S]{0,120}?return/.test(patchSrc) &&
    /* ⚠⑦(2026-09-25) 再次加严：收起前先判"**锚点 rect 真的动了**"（`d.anchorMoved()`，浮层坐标就是按它算的），
       拿不到 rect 才退回事件源判据 `scrollAffectsAnchor(t, d.btn, doc)`。为什么必须两条都在：只看源会被
       "先滚动、后展开"的**异步** scroll 事件骗（已经滚完的那次在展开后才到达 ⇒ 刚打开就被收掉，门禁 M7 实测红过）；
       只看 rect 则在桩 DOM（无布局）下永远判不出 ⇒ 退回源判据。 */
    /typeof d\.anchorMoved === 'function' \? d\.anchorMoved\(\) : null[\s\S]{0,300}?scrollAffectsAnchor\(t, d\.btn, doc\)[\s\S]{0,120}?if \(affected\) d\.close\(\)/.test(patchSrc) &&
    /const anchorMoved = \(\) => \{[\s\S]{0,420}?return null/.test(patchSrc) &&
    /addEventListener\('resize', \(\) => closeAll\(null\)\)/.test(patchSrc))
  // ⑬b(P-158 用户第 2 条) 为什么要有它：fixed 后代的包含块被 `#pages-track{contain:paint}` 抓走 ⇒
  //   内联 left/top 是相对它而不是视口（实测差一个 header = 44px，就是用户看到的"缝"）。
  //   锚不在 `#pages-track` 里（设置弹层 #lang 在 header 里）⇒ 偏移必须是 0。
  check('D11 ⑬b layerFixedOffset：锚在 `#pages-track` 里 ⇒ 偏移 = 它的 left/top；不在里面 ⇒ 0（视口坐标系）',
    (() => {
      const inside = P.layerFixedOffset({ left: 0, top: 44, right: 1360, bottom: 882 }, true)
      const outside = P.layerFixedOffset({ left: 0, top: 44, right: 1360, bottom: 882 }, false)
      return inside.dx === 0 && inside.dy === 44 && outside.dx === 0 && outside.dy === 0
    })())
  check('D11 ⑬ position() 在 wrap.classList.add(\'open\') **之后**调用（display:none 时 scrollHeight=0 会量错）',
    (() => {
      const i = patchSrc.indexOf("const open = () => {")
      const blk = patchSrc.slice(i, i + 1200)
      const atOpen = blk.indexOf("wrap.classList.add('open')")
      const atPos = blk.indexOf('position()', atOpen)
      return i > 0 && atOpen > 0 && atPos > atOpen
    })())
  // 纯函数几何：三条判据（放得下 → 贴下方并在裁剪盒内；放不下 → 翻上方；触到右边界 → 夹回来）
  {
    const clip = { left: 0, top: 62, right: 980, bottom: 690 }
    const vp = { width: 980, height: 690 }
    // 触发器位置取**修复后**的窄屏首屏布局（切换栏 32px 之后 ⇒ 工具条第一行 ≈94px）
    const fit = P.dropdownLayerPlan({ left: 98, top: 94, right: 230, bottom: 118, width: 132, height: 24 }, clip, vp, 280)
    check('D11 ⑬ 几何①：980×690 下 132px 触发器 + 280px 列表 ⇒ placement=below 且整块落在裁剪盒内（真机改前 inViewport=false）',
      fit.placement === 'below' && fit.left === 98 && fit.top === 120 &&
      fit.top + fit.maxHeight <= clip.bottom && fit.left + fit.width <= clip.right,
      JSON.stringify(fit))
    // ⑬c(P-158 用户第 2 条判据)「列表上/下边缘与触发框的间距 ≤ 2px」——两个方向都要贴合：
    //   below ⇒ 列表上边缘贴触发框下边缘；above ⇒ 列表下边缘贴触发框上边缘。
    //   （放在 up 之后：两条判据要一起算。）
    const up = P.dropdownLayerPlan({ left: 300, top: 640, right: 432, bottom: 664, width: 132, height: 24 }, clip, vp, 280)
    check('D11 ⑬c 贴合判据：below 的 anchorTop − 触发框 bottom ≤ 2px，above 的 触发框 top − anchorBottom ≤ 2px',
      (fit.anchorTop - 118) <= 2 && (fit.anchorTop - 118) >= 0 && (640 - up.anchorBottom) <= 2 && (640 - up.anchorBottom) >= 0,
      JSON.stringify({ belowGap: fit.anchorTop - 118, aboveGap: 640 - up.anchorBottom }))
    check('D11 ⑬ 几何②：触发器贴近底边 ⇒ 翻到上方（top < 触发器 top，且不越出裁剪盒上沿）',
      up.placement === 'above' && up.top < 640 && up.top >= clip.top && up.top + up.maxHeight <= 640,
      JSON.stringify(up))
    const right = P.dropdownLayerPlan({ left: 940, top: 100, right: 1072, bottom: 124, width: 132, height: 24 }, { left: 0, top: 62, right: 980, bottom: 690 }, vp, 280)
    check('D11 ⑬ 几何③：触发器贴右边界 ⇒ 左缘夹回裁剪盒内（不横溢出）',
      right.left === 980 - 132, JSON.stringify(right))
  }
}

/** D12 ③ 的**判据体**（函数化：反向自证要在 /tmp 隔离副本上跑**同一套**判据）。返回 [名称, 通过?, 细节]。
 *  只读 root 下的四样东西：全树 renderer-*.js 计数、渲染器页的**可执行引用**、
 *  `demo/renderer/adapter-boot.mjs` 的取模块路径、`core/renderer-adapter.mjs` 的契约面；
 *  再对**真模块**跑一次"缺产物 ⇒ 明确 SKIP"的选择开关。 */
function rendererArtifactPlan(root, A) {
  const rd = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8') } catch (e) { return '' } }
  const artifacts = []
  const skipDirs = new Set(['.git', 'node_modules', '_site'])
  const walk = (d) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    for (const e of ents) {
      if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(path.join(d, e.name)); continue }
      if (/^renderer-.*\.js$/.test(e.name)) artifacts.push(path.relative(root, path.join(d, e.name)))
    }
  }
  walk(root)
  const page = rd(DEMO + '/renderer/index.html')
  const boot = rd(DEMO + '/renderer/adapter-boot.mjs')
  const core = rd('core/renderer-adapter.mjs')
  /* 「页面不再引用产物」判的是**引用面**（script src / link href），不是"文件名在全文 0 命中" ——
     注释里写清"以前引用的是哪个文件"是留痕，判红就是假红（假红比不判更坏）。 */
  const refs = []
  const re = /<(script|link)\b[^>]*?\b(src|href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
  let m
  while ((m = re.exec(page))) refs.push(m[3].replace(/^["']|["']$/g, ''))
  const reg = A.createRendererRegistry(A.builtinRendererAdapters({}))
  const skipPlan = A.resolveRendererSelection({
    registry: reg, embed: true,
    url: 'https://example.invalid/wallpaper-engine-webgl/renderer/index.html?type=scene&src=1',
  })
  return [
    ['A 仓内不再内置上游渲染器产物（全树 renderer-*.js 计数 = 0；塞回来必红）', artifacts.length === 0, artifacts.join(', ') || '(0 份)'],
    ['B 渲染器页改由适配器契约驱动（引用面只有 ./adapter-boot.mjs，不再引用任何 renderer-*.js）',
      refs.length > 0 && !refs.some((u) => /renderer-.*\.js/.test(u)) && /core\/renderer-adapter\.mjs/.test(boot), refs.join(' | ')],
    ['C 适配器契约在位（契约版本 + 实例七件套 + 注册表 + 两档内置适配器在同一份 core 模块里）',
      /mpw-renderer-adapter@1/.test(core) && /RENDERER_ADAPTER_METHODS\s*=/.test(core) && /createRendererRegistry\s*\(/.test(core)
      && /createRepoRendererAdapter\s*\(/.test(core) && /createExternalRendererAdapter\s*\(/.test(core), 'core/renderer-adapter.mjs ' + core.length + ' B'],
    ['D 产物缺失时**明确 SKIP**（skipped=true / available=false / 有原因 / 有配置指引；不是静默通过）',
      skipPlan.skipped === true && skipPlan.available === false && !!skipPlan.reason && /SKIP/.test(skipPlan.notice) && /rendererSrc/.test(skipPlan.notice),
      JSON.stringify({ skipped: skipPlan.skipped, reason: skipPlan.reason })],
  ]
}

// ---- D12（2026-09-19 ⑨ 用户裁定"旧名在 URL 路径上"）站点路径改名 /wallpaper-engine-webgl/ → /WEwebLoader/ ----
// 为什么要这三组：
//   ① **构建侧**：路径名的单一真源是 `tools/site-paths.mjs` —— 新名要在、旧名**只**以"极小重定向页"形态出现
//      （旧路径再出现真源拷贝 = 第二份真源，改一处忘一处）；
//   ② **产品面**：用户点得到的链接/引用里不许再有旧路径；而**运行期改写必须同时认旧+新两个前缀** ——
//      产物是 minified、不可重建的，里面写死的是旧名（只认新名 ⇒ 线上 iframe 404）；
//   ③ **反向钉子**：localStorage 键 / DOM 属性名 / 上游归属 / 静态品牌钉子**一个都不许**被"顺手改名"
//      （改名改名，改的是 URL 路径，不是用户数据与许可口径）。
{
  const S = await import(pathToFileURL(path.join(ROOT, 'tools', 'site-paths.mjs')).href)
  const P = await import(pathToFileURL(path.join(ROOT, DEMO, 'bench-patch.js')).href)
  const buildSrc = read('build-pages.mjs')
  const patchSrc = read('demo/bench-patch.js')
  const yml = read('.github/workflows/pages.yml')

  // ①-1 名字照抄（大小写）+ 单一真源
  check('D12 ① 站点路径名逐字照抄用户给的大小写（WEwebLoader）+ 旧名常量在同处',
    S.SITE_MOUNT === 'WEwebLoader' && S.SITE_MOUNT_LEGACY === 'wallpaper-engine-webgl' &&
    JSON.stringify(S.SITE_PATH_ALIASES) === JSON.stringify(['/WEwebLoader/', '/wallpaper-engine-webgl/']),
    JSON.stringify([S.SITE_MOUNT, S.SITE_MOUNT_LEGACY, S.SITE_PATH_ALIASES]))

  // ①-2 build-pages.mjs 用真源常量挂别名：新路径在、旧路径不再被 copyTree
  check('D12 ① build-pages.mjs 的别名落点 = SITE_MOUNT（新名），且不再把真源拷进旧路径',
    /const ALIAS = path\.join\(OUT, SITE_MOUNT\)/.test(buildSrc) &&
    /copyTree\(DEMO_SRC, ALIAS, SITE_MOUNT\)/.test(buildSrc) &&
    !/path\.join\(OUT, 'wallpaper-engine-webgl'\)/.test(buildSrc) &&
    !/copyTree\(DEMO_SRC, [^)]*SITE_MOUNT_LEGACY/.test(buildSrc) &&
    /from '\.\/tools\/site-paths\.mjs'/.test(buildSrc),
    'ALIAS/copyTree 口径')

  // ①-3 旧路径 = "极小重定向页"形态（五件套：noindex / meta refresh / location.replace / 带 query / ≤4 KB）
  const stubs = S.LEGACY_REDIRECTS.map((rel) => [rel, S.legacyRedirectHtml(rel)])
  const stubBad = stubs.filter(([, html]) =>
    !(/name="robots" content="noindex,nofollow"/.test(html) && /http-equiv="refresh" content="0; url=/.test(html) &&
      /location\.replace\(/.test(html) && /location\.search/.test(html) && Buffer.byteLength(html) <= 4096))
  check('D12 ① 旧路径重定向页五件套（noindex + meta refresh + location.replace + 带 query + ≤4 KB）×' + stubs.length + ' 张',
    stubs.length >= 3 && stubBad.length === 0, stubBad.map(([r]) => r).join(', ') || 'ok')

  // ①-4 跳转目标是**相对**地址、且深链回同层新路径（不是一律回首页）
  check('D12 ① 重定向目标是相对地址（Pages 是子路径站点：绝对 /WEwebLoader/ 会指到域名根）',
    S.LEGACY_REDIRECTS.every((rel) => {
      const t = S.legacyRedirectTarget(rel)
      return t.startsWith('../') && t.includes(S.SITE_MOUNT) && !t.includes(S.SITE_MOUNT_LEGACY)
    }),
    S.LEGACY_REDIRECTS.map((rel) => rel + '→' + S.legacyRedirectTarget(rel)).join(' '))
  check('D12 ① 深链跳回同层新路径（renderer / default-wallpaper 不许只跳回首页）',
    S.legacyRedirectTarget('index.html') === '../WEwebLoader/' &&
    S.legacyRedirectTarget('renderer/index.html') === '../../WEwebLoader/renderer/index.html' &&
    S.legacyRedirectTarget('default-wallpaper/index.html') === '../../WEwebLoader/default-wallpaper/index.html',
    S.LEGACY_REDIRECTS.map((rel) => rel + '→' + S.legacyRedirectTarget(rel)).join(' '))
  check('D12 ① 重定向落点覆盖产物里写死的那三条绝对路径的原目录（sw.js 有意不放：线上不该有旧 SW 域）',
    ['index.html', 'renderer/index.html', 'default-wallpaper/index.html'].every((r) => S.LEGACY_REDIRECTS.includes(r)) &&
    !S.LEGACY_REDIRECTS.includes('sw.js'))

  // ①-5 CI 自检跟上（独立第二双眼睛；与 build-pages 的自检同口径）
  check('D12 ① .github/workflows/pages.yml 自检改判新挂载点 + 旧路径只允许重定向页',
    /test -f _site\/WEwebLoader\/index\.html/.test(yml) &&
    /test -f _site\/WEwebLoader\/bench-patch\.js/.test(yml) &&
    /test ! -f _site\/wallpaper-engine-webgl\/bench-patch\.js/.test(yml) &&
    /default-wallpaper\/index\.html/.test(yml))

  // ②-1 产品面 HTML：没有指向旧路径的可点链接/资源引用
  const htmlFiles = ['index.html', 'demo.html', 'demo/index.html', 'demo/renderer/index.html', 'demo/default-wallpaper/index.html']
  const badLinks = []
  for (const f of htmlFiles) {
    for (const m of read(f).matchAll(/(?:href|src|action)="([^"]*)"/g)) {
      if (m[1].includes('/wallpaper-engine-webgl')) badLinks.push(f + ' → ' + m[1])
    }
  }
  check('D12 ② 产品面 HTML 里没有指向旧路径的 href/src/action（' + htmlFiles.length + ' 个页面）',
    badLinks.length === 0, badLinks.slice(0, 4).join(' | '))

  // ②-2 文档里给用户点的 markdown 链接
  const mdBad = []
  for (const f of ['README.md', 'THIRD-PARTY.md', 'docs/ONLINE-DEMO.md']) {
    for (const m of read(f).matchAll(/\]\(([^)\s]*wallpaper-engine-webgl[^)\s]*)\)/g)) mdBad.push(f + ' → ' + m[1])
  }
  check('D12 ② README / THIRD-PARTY / ONLINE-DEMO 里没有指向旧路径的 markdown 链接',
    mdBad.length === 0, mdBad.slice(0, 4).join(' | '))

  // ②-3 运行期前缀改写：旧名（产物里写死的）+ 新名（改名后写的）都认；不认识的 URL 原样放行
  check('D12 ② 运行期前缀改写认旧+新两个前缀，且落到相对本页（产物 minified 改不了 ⇒ 必须两边都认）',
    P.demoAssetUrl('/wallpaper-engine-webgl/renderer/index.html?_t=1', './') === './renderer/index.html?_t=1' &&
    P.demoAssetUrl('/WEwebLoader/renderer/index.html?_t=1', './') === './renderer/index.html?_t=1' &&
    P.demoAssetUrl('/WEwebLoader/default-wallpaper/index.html', '../') === '../default-wallpaper/index.html' &&
    P.demoAssetUrl('/demo/other.js', './') === '/demo/other.js' &&
    P.demoAssetUrl('https://example.com/x', './') === 'https://example.com/x',
    [P.demoAssetUrl('/wallpaper-engine-webgl/renderer/index.html', './'), P.demoAssetUrl('/WEwebLoader/renderer/index.html', './')].join(' | '))
  check('D12 ② sitePathAliasOf 只认这两个前缀（别的绝对路径不算站点路径）',
    P.sitePathAliasOf('/WEwebLoader/x') === '/WEwebLoader/' &&
    P.sitePathAliasOf('/wallpaper-engine-webgl/x') === '/wallpaper-engine-webgl/' &&
    P.sitePathAliasOf('/other/x') === '' && P.sitePathAliasOf('') === '')

  // ②-4 补丁自己的 iframe src 用新名（旧名只作为 minified 产物的遗留前缀被兼容）
  check('D12 ② 补丁自己发起的 iframe src 用新站点路径（不再自己写旧名）',
    /fr\.src = '\/' \+ SITE_MOUNT \+ '\/renderer\/index\.html\?_t='/.test(patchSrc) &&
    !/fr\.src = '\/wallpaper-engine-webgl\/renderer/.test(patchSrc))

  // ②-5 构建侧与补丁侧的名字口径逐字一致（两侧各改一半 = 线上 404，必须一次红）
  check('D12 ② 构建侧与补丁侧的名字/别名表逐字一致（改一半就红）',
    P.SITE_MOUNT === S.SITE_MOUNT && P.SITE_MOUNT_LEGACY === S.SITE_MOUNT_LEGACY &&
    JSON.stringify(P.SITE_PATH_ALIASES) === JSON.stringify(S.SITE_PATH_ALIASES) &&
    P.demoPrefixFor('/WEwebLoader/') === './' && P.demoPrefixFor('/wallpaper-engine-webgl/renderer/') === './' &&
    P.demoPrefixFor('/demo/renderer/') === './')

  // ③-1 反向钉子：localStorage 键没被顺手改名（改了 = 丢用户设置）
  //   `webwallgl-theme` 是**补丁与产物共写**的键（两边各存一处）⇒ 判"两侧都还在"（一边单独改名同样丢设置）；
  //   其余三个键只在产物（minified、不可重建）里，`bench-props-collapsed` 只在补丁里 ⇒ 各判各的落点。
  const bundle = read('demo/assets/bench-DSKWIqmS.js')
  const keySpec = [['webwallgl-theme', patchSrc], ['webwallgl-theme', bundle], ['webwallgl-lang', bundle],
    ['webwallgl-fx', bundle], ['we-bench-pointer-push', bundle], ['bench-props-collapsed', patchSrc]]
  const lostKeys = keySpec.filter(([k, src]) => !src.includes(k)).map(([k, src]) => k + '@' + (src === bundle ? '产物' : '补丁'))
  check('D12 ③ localStorage 键一个都没改（webwallgl-theme ×2 落点 + -lang / -fx / we-bench-pointer-push / bench-props-collapsed）',
    lostKeys.length === 0, lostKeys.join(', '))
  /* ①(P-350 2026-10-16 用户口径「把上游渲染器移除，留一个可扩展的接口」) 这两条钉子**换契约**：
     旧：「上游产物**有且仅有一份** renderer-*.js」+「产物里含 data-webwallgl-gl」
     新：「**仓库内不再内置上游产物**」（全树 renderer-*.js 计数 = **0**；谁塞回来必红）
         + 「渲染器页改由**适配器契约**驱动」
         + 「产物缺失时**明确 SKIP**（available=false + 原因 + 配置指引；绝不静默通过）」
     为什么不只是删掉：删断言 = 门禁不再回答"上游产物有没有偷偷回来"。新契约比旧的**更强**
     （旧的只查 demo/assets 那一份；新的查全树 0 份 + 适配器在位 + 缺失时的 SKIP 语义）。
     反向自证：在 /tmp 隔离副本里放回一份假产物 ⇒ 第一条必红（打印「期望红集 == 实际红集」）。 */
  {
    const A = await import(pathToFileURL(path.join(ROOT, 'core', 'renderer-adapter.mjs')).href)
    for (const [name, cond, detail] of rendererArtifactPlan(ROOT, A)) check('D12 ③ ' + name, cond, detail)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-demo-check-artifact-'))
    fs.mkdirSync(path.join(tmp, DEMO, 'assets'), { recursive: true })
    fs.mkdirSync(path.join(tmp, DEMO, 'renderer'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'core'), { recursive: true })
    for (const rel of [[DEMO + '/renderer/index.html'], [DEMO + '/renderer/adapter-boot.mjs'], ['core/renderer-adapter.mjs']]) {
      fs.copyFileSync(path.join(ROOT, ...rel), path.join(tmp, ...rel))
    }
    fs.writeFileSync(path.join(tmp, DEMO, 'assets', 'renderer-FAKE123.js'), '/* 假产物：只用于反向自证 */\n')
    const red = rendererArtifactPlan(tmp, A).filter((r) => !r[1]).map((r) => String(r[0]).slice(0, 1))
    check('D12 ③ 反向自证（隔离副本塞回一份假产物 ⇒ 期望红集 == 实际红集）', red.join(',') === 'A',
      '期望红集=[A] 实际红集=[' + red.join(' ') + '] 副本=' + tmp)
  }

  // ③-2 反向钉子：上游归属 / 许可文件名 / 静态品牌钉子都没动
  check('D12 ③ 上游归属与许可文件没被"顺手改名"（oneincase/webwallgl 外链 + 两份 LICENSE-webwallgl*）',
    /github\.com\/oneincase\/webwallgl/.test(read('demo/index.html')) && /github\.com\/oneincase\/webwallgl/.test(read('index.html')) &&
    fs.existsSync(path.join(ROOT, DEMO, 'LICENSE-webwallgl-MIT.txt')) && fs.existsSync(path.join(ROOT, DEMO, 'LICENSE-webwallgl')))
  check('D12 ③ 静态品牌钉子仍是上游名（<title> / DICT app.title / ?appname=upstream 回退）',
    /<title>wallpaper-engine-webgl<\/title>/.test(read('demo/index.html')) &&
    P.DICT.zh['app.title'] === 'wallpaper-engine-webgl' && P.DICT.en['app.title'] === 'wallpaper-engine-webgl' &&
    P.appBrandPlan({ override: false, upstreamTitle: 'wallpaper-engine-webgl' }).name === 'wallpaper-engine-webgl' &&
    P.appBrandPlan({}).name === 'WEwebLoader')
}

// ---- D12 ④（P-129：P-127 改名留下的小缺口 —— 线上点「新窗口」404）window.open 前缀改写 ----
// 断言实体在 `tests/open-rewrite-check.mjs`（**秒级、零 spawn 的独立入口**，也在这里被 D12 ④ 一起跑）。
// 为什么要独立成文件：本文件的 D6 会 spawn 重活 `build-pages.mjs`（本机被压崩过，任务书禁止随手跑整个文件），
// 而 P-129 的判据要能"秒级单独验证 + 在 /tmp 的真文件变异副本上把**变异后的补丁模块**直接喂进同一套断言"。
{
  const S4 = await import(pathToFileURL(path.join(ROOT, 'tools', 'site-paths.mjs')).href)
  const P4 = await import(pathToFileURL(path.join(ROOT, DEMO, 'bench-patch.js')).href)
  const { runOpenRewriteChecks } = await import(pathToFileURL(path.join(ROOT, 'tests', 'open-rewrite-check.mjs')).href)
  runOpenRewriteChecks({ check, P: P4, S: S4, ROOT, read })
}

if (JSON_OUT) console.log(JSON.stringify({ pass, fail }, null, 1))
else console.log(`\n===== demo-check: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)

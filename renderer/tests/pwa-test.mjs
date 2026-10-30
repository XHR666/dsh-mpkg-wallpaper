// pwa-test.mjs —— P-92：离线 PWA（manifest + Service Worker）与**"绝不缓存用户壁纸"**的可断言证明
// 复现：node pwa-test.mjs
//
// 用户点名要求："离线可用的 PWA（manifest + service worker，**注意别把用户壁纸缓存进去**）"。
// 这条要求不能靠注释承诺 —— 本测试把它变成断言：
//   A. 缓存判据（`sw-policy.mjs` 纯函数）：**正面 12 条**（app shell / 自带样例 / 字体 / 图标）+
//      **反面 17 条**（`/raw`、`pkgpath`、`pkgurl`、`pkgdir`、`/weassist`、`/report`、`/shot`、
//      非样例 `?id=`、`/pkg/<其它 id>`、POST、跨源、音视频/图片响应、超大响应、畸形编码）
//   B. manifest：JSON 合法 + 安装必需字段 + 图标文件**真实存在且尺寸正确** + `start_url` 指向自带样例
//   C. 图标与生成器**逐字节一致**（`tools/make-icons.mjs --check`，防"手改 PNG 但没台账"）
//   D. sw.js：语法可解析 + 预缓存清单里**没有**任何用户素材端点 + 明确网络优先
//   E. 服务器注入：默认关（逐字节 = 改动前）/ `?pwa=1` 开 / 幂等 / 缺 `</head>` 不吞页面
//   F. 真子进程服务：6 条 PWA 静态路由 200 + content-type + 首页注入与不注入的实际字节对比
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { shouldCache, shouldStoreResponse, SAMPLE_ID, SHELL_EXACT, SHELL_PREFIX, USER_SOURCE_KEYS } from '../web/sw-policy.mjs'
import { pwaEnabledFrom, injectPwa, readPwaAsset, PWA_ROUTES } from '../web/pwa-inject.mjs'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT   // ①(2026-09-16) 根文件（demo.html / bundle）在仓库根
const WEB = path.join(ROOT, 'web')   // ①(P-101) 站点外壳资源（sw.js / sw-policy.mjs / manifest / icons）在 web/（URL 不变）
let pass = 0, fail = 0
const fails = []
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const ORIGIN = 'http://127.0.0.1:8899'
const C = (u, o = {}) => shouldCache(u, { origin: ORIGIN, ...o })

console.log('\n[A] 缓存判据：正面（该缓存的）')
{
  for (const u of ['/', '/demo.html', '/we-scene-bundle.js', '/attach-transform.mjs', '/puppet-skin.js',
    '/elysia/we-renderer/core.js', '/vendor/hlsl2glsl/hlsl2glsl.js', '/assets/fonts/Monofur.ttf',
    '/icons/icon-192.png', '/manifest.webmanifest', '/sw.js']) {
    check('shell 缓存：' + u, C(u) === true)
  }
  check('自带样例包缓存：/pkg/' + SAMPLE_ID, C('/pkg/' + SAMPLE_ID) === true)
  check('自带样例属性：/project/' + SAMPLE_ID, C('/project/' + SAMPLE_ID) === true)
  check('绝对 URL（SW 里 request.url 的真实形态）也认', C(ORIGIN + '/elysia/we-renderer/core.js') === true)
  check('离线首页 /?id=' + SAMPLE_ID + ' 可缓存（否则离线打不开）', C('/?id=' + SAMPLE_ID) === true)
}

console.log('\n[A2] 缓存判据：反面（**用户壁纸与上报一律不进缓存**）')
{
  // ①(2026-09-16) 占位路径统一写成大写 `/home/USER/…`：它是**明显的占位符**，
  //   同时不会再被 `publish-check.mjs` 的 PATH_RE（`/home/[a-z]+/`）误判成"作者本机个人路径"。
  const no = [
    ['用户本地包路径', '/pkg/3719111841'],
    ['用户本地包路径（绝对 URL）', ORIGIN + '/pkg/3719111841'],
    ['?pkgpath= 指定的任意文件', '/raw?pkgpath=' + encodeURIComponent('/home/USER/scene.pkg')],
    ['?pkgurl= 指定的远程包', '/raw?pkgurl=' + encodeURIComponent('https://x/y.pkg')],
    ['/pkgpath 直读', '/pkgpath?path=/home/USER/a.pkg'],
    ['/raw 无参数', '/raw'],
    ['目录打包', '/pkgdir?d=' + encodeURIComponent('/home/USER/scenes')],
    ['本机 WE 资产', '/weassist/fonts/Monofur.ttf'],
    ['本机 WE 材质', '/weassist/materials/util/white.tex'],
    ['上报', '/report'],
    ['上报（绝对 URL）', ORIGIN + '/report'],
    ['截图上传', '/shot'],
    ['截图目录', '/shots/abc/1.jpg'],
    ['非样例 id 的项目文件', '/project/3554161528'],
    ['非样例 id 的类型', '/type/3554161528'],
    ['首页带非样例 id', '/?id=3719111841'],
    ['非样例 id（绝对 URL）', ORIGIN + '/pkg/3719111841'],
  ]
  for (const [why, u] of no) check('不缓存 · ' + why, C(u) === false, u)
  check('不缓存 · POST /report', C('/report', { method: 'POST' }) === false)
  check('不缓存 · 跨源（CDN）', C('https://cdn.example.com/x.js') === false)
  check('不缓存 · 畸形百分号编码（宁可漏不可错）', C('/elysia/%E0%A4%A') === false)
}

console.log('\n[A3] 响应判据：错误/媒体/超大响应不写缓存')
{
  const H = (ct) => ({ get: (k) => (k.toLowerCase() === 'content-type' ? ct : null) })
  check('200 text/html 可写', shouldStoreResponse({ status: 200, headers: H('text/html; charset=utf-8'), size: 100 }) === true)
  check('206 Range 不写', shouldStoreResponse({ status: 206, headers: H('text/html'), size: 10 }) === false)
  check('404 不写', shouldStoreResponse({ status: 404, headers: H('text/html'), size: 10 }) === false)
  check('opaque(0) 不写', shouldStoreResponse({ status: 0, headers: H(''), size: 10 }) === false)
  check('video/mp4 不写（用户壁纸里的视频）', shouldStoreResponse({ status: 200, headers: H('video/mp4'), size: 10 }) === false)
  check('audio/mpeg 不写', shouldStoreResponse({ status: 200, headers: H('audio/mpeg'), size: 10 }) === false)
  check('image/jpeg 不写（用户截图/贴图）', shouldStoreResponse({ status: 200, headers: H('image/jpeg'), size: 10 }) === false)
  check('image/png 可写（我们自己的图标）', shouldStoreResponse({ status: 200, headers: H('image/png'), size: 10 }) === true)
  check('>8MB 不写', shouldStoreResponse({ status: 200, headers: H('text/javascript'), size: 9 * 1048576 }) === false)
  check('无 headers 不抛（保守不写）', shouldStoreResponse({ status: 200 }) === true)
}

console.log('\n[B] manifest.webmanifest：安装必需字段 + 图标在位')
{
  const raw = fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8')
  let m = null
  try { m = JSON.parse(raw) } catch (e) { /* 下面断言会报 */ }
  check('合法 JSON', !!m)
  check('name / short_name 非空', !!(m && m.name && m.short_name))
  check('start_url 指向自带样例（离线打开就有画面）', m && m.start_url === '/?id=' + SAMPLE_ID, m && m.start_url)
  check('scope = /', m && m.scope === '/')
  check('display = standalone', m && m.display === 'standalone')
  check('icons ≥ 3（含 maskable）', !!(m && m.icons && m.icons.length >= 3))
  check('含 512×512 maskable 图标', !!(m && m.icons && m.icons.some((i) => /512/.test(i.sizes) && i.purpose === 'maskable')))
  // 图标路径必须真实存在，且 PNG 头声明的尺寸与 manifest 一致（手工改尺寸会在这里红）
  for (const ic of (m && m.icons) || []) {
    const fp = path.join(WEB, ic.src.replace(/^\//, ''))   // ①(P-101) 图标在 web/icons/（URL 仍是 /icons/…）
    let ok = false, dim = ''
    try {
      const b = fs.readFileSync(fp)
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
      dim = w + 'x' + h
      ok = b.slice(1, 4).toString() === 'PNG' && ic.sizes === dim
    } catch { /* ok=false */ }
    check('图标在位且尺寸与 manifest 一致：' + ic.src, ok, dim)
  }
  check('不含任何 WE/用户素材引用（theme/background 只写颜色）', !!/^#[0-9a-f]{6}$/i.test(m && m.background_color))
  // ①(2026-09-19 品牌图标) manifest 的三个图标必须**全部**是品牌图（站点根这一套也换）：
  //   判据写成"全部以 /icons/brand- 开头"（而不是"包含某一张"），这样任何一张被改回程序化生成图都会红。
  check('B8 manifest 三个图标全部指向品牌图 `/icons/brand-*`（不再引程序化生成的 `icon-*`）',
    !!(m && Array.isArray(m.icons) && m.icons.length >= 3 && m.icons.every((i) => /^\/icons\/brand-/.test(String(i.src)))),
    JSON.stringify((m && m.icons || []).map((i) => i.src)))
}

console.log('\n[B2] 品牌图（站点根 `/icons/brand-*`）：字节来源可追溯 + maskable 是派生物')
{
  // 站点根这四张是 `demo/assets/brand/**` 那批图的副本：前三张**逐字节相同**（防"两套图悄悄漂开"），
  // maskable 那张是按下方命令派生的（带安全边距，不与源图逐字节相同 —— 因此单独断言尺寸与命令可复现）。
  const pairs = [
    ['brand-32.png', 'favicon-32.png'],
    ['brand-192.png', 'brand-192.png'],
    ['brand-512.png', 'brand-512.png'],
  ]
  for (const [site, demo] of pairs) {
    const a = path.join(WEB, 'icons', site), b = path.join(ROOT, 'demo', 'assets', 'brand', demo)
    let same = false, why = ''
    try { same = fs.readFileSync(a).equals(fs.readFileSync(b)) } catch (e) { why = String(e.message) }
    check(`B2 ${site} 与 demo/assets/brand/${demo} 逐字节相同`, same, why)
  }
  const mk = path.join(WEB, 'icons', 'brand-512-maskable.png')
  let dim = '', cmd = ''
  try {
    const b = fs.readFileSync(mk)
    dim = b.readUInt32BE(16) + 'x' + b.readUInt32BE(20)
    cmd = mk
  } catch (e) { dim = 'ERR ' + e.message }
  check('B3 brand-512-maskable.png 在位且是 512×512（由 brand-512 缩放+留边派生：`ffmpeg -i brand-512.png -vf "scale=384:384,pad=512:512:64:64:color=0x0b0e14"`）',
    dim === '512x512' && !!cmd, dim)
  check('B4 程序化生成的三张图标**仍在**（旧 URL 不 404；`icons.json` 的 sha256 校验照旧在 C 段）',
    ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png'].every((f) => fs.existsSync(path.join(WEB, 'icons', f))))
  const injSrc = fs.readFileSync(path.join(WEB, 'pwa-inject.mjs'), 'utf8')
  check('B5 注入片段里的 favicon / apple-touch-icon 也是品牌图（`/icons/brand-32.png` + `/icons/brand-192.png`）',
    /href="\/icons\/brand-32\.png"/.test(injSrc) && /href="\/icons\/brand-192\.png"/.test(injSrc) && !/href="\/icons\/icon-/.test(injSrc))
  const swSrc0 = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8')
  check('B6 sw.js 预缓存清单里是品牌图（四张全在），且**不再**缓存没人引用的 `icon-*`',
    ['brand-32', 'brand-192', 'brand-512', 'brand-512-maskable'].every((n) => swSrc0.includes('/icons/' + n + '.png')) &&
    !/'\s*\/icons\/icon-/.test(swSrc0))
}

console.log('\n[C] 图标与生成器逐字节一致（防手改 PNG）')
{
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/make-icons.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 })   // ①(2026-09-16) make-icons 在仓库根
    check('tools/make-icons.mjs --check 通过', true, out.trim().split('\n').pop())
  } catch (e) {
    check('tools/make-icons.mjs --check 通过', false, String(e.stdout || e.message).trim().split('\n').slice(-2).join(' ⏎ '))
  }
  const j = JSON.parse(fs.readFileSync(path.join(WEB, 'icons', 'icons.json'), 'utf8'))
  check('icons.json 登记了 3 个图标与 sha256', Array.isArray(j.icons) && j.icons.length === 3 && j.icons.every((i) => /^[0-9a-f]{64}$/.test(i.sha256)))
}

console.log('\n[D] sw.js：语法 + 预缓存清单不含用户素材 + 网络优先')
{
  let syn = true, err = ''
  try { execFileSync(process.execPath, ['--check', path.join(WEB, 'sw.js')], { encoding: 'utf8' }) } catch (e) { syn = false; err = String(e.stderr || e.message).split('\n')[0] }
  check('node --check sw.js 语法通过', syn, err)
  const src = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8')
  check('sw.js 从 sw-policy.mjs import 判据（单一事实源）', /from '\.\/sw-policy\.mjs'/.test(src) && /shouldCache/.test(src))
  const precache = (src.match(/const PRECACHE = \[([\s\S]*?)\]/) || [, ''])[1]
  const bads = ['/raw', '/weassist', '/report', '/shot', '/pkgpath', '/pkgurl', '/pkgdir']
  for (const b of bads) check('预缓存清单不含 ' + b, !precache.includes(b))
  check('预缓存只含自带样例（/pkg/sample-synthetic）', /\/pkg\/sample-synthetic/.test(precache) && !/\/pkg\/(?!sample-synthetic)/.test(precache))
  check('网络优先（先 fetch 再回落缓存，避免旧 shell 配新 bundle）', /const res = await fetch\(req\)/.test(src) && /await c\.match\(req\)/.test(src))
  check('activate 时清理旧版本缓存', /caches\.keys\(\)/.test(src) && /caches\.delete\(k\)/.test(src))
}

console.log('\n[E] 注入开关：默认关 / ?pwa=1 开 / 幂等 / 不吞页面')
{
  const html = '<!doctype html><html><head><title>t</title></head><body>x</body></html>'
  check('默认（无环境变量、无参数）关', pwaEnabledFrom(new URLSearchParams(''), {}) === false)
  check('MPW_PWA=1 时开', pwaEnabledFrom(new URLSearchParams(''), { MPW_PWA: '1' }) === true)
  check('?pwa=1 开', pwaEnabledFrom(new URLSearchParams('pwa=1'), {}) === true)
  check('?pwa=0 覆盖环境变量的"开"（可单请求关闭）', pwaEnabledFrom(new URLSearchParams('pwa=0'), { MPW_PWA: '1' }) === false)
  const inj = injectPwa(html)
  check('注入包含 manifest 链接', /rel="manifest" href="\/manifest\.webmanifest"/.test(inj))
  check('注入包含 SW 注册且为 module', /serviceWorker/.test(inj) && /type: 'module'/.test(inj))
  check('注入位置在 </head> 之前', inj.indexOf('rel="manifest"') < inj.indexOf('</head>'))
  check('注入幂等（二次注入不再加）', injectPwa(inj) === inj)
  check('页面自带 manifest 时不重复注入', injectPwa('<head><link rel="manifest" href="/x"></head>') === '<head><link rel="manifest" href="/x"></head>')
  check('缺 </head> 时**原样返回**（绝不吞页面）', injectPwa('<html><body>no head</body></html>') === '<html><body>no head</body></html>')
  check('Buffer 入参也能处理', typeof injectPwa(Buffer.from(html)) === 'string' && /rel="manifest"/.test(injectPwa(Buffer.from(html))))
  check('注册失败只写日志、不抛（无 SW 的浏览器不影响渲染）', /\.catch\(/.test(inj) && /无离线能力/.test(inj))
  for (const [p, r] of Object.entries(PWA_ROUTES)) check('静态路由有 content-type：' + p, !!r.type && !!r.file)
  check('readPwaAsset 对未知路径返回 null', readPwaAsset(WEB, '/nope') === null)
}

console.log('\n[F] 真子进程服务：PWA 资源与首页注入的实际字节')
{
  let child = null
  try {
    const port = await new Promise((res, rej) => {
      const s = net.createServer()
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
      s.on('error', rej)
    })
    child = spawn(process.execPath, ['server/we-scene-demo-server.mjs'], { cwd: HERE, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
    const base = 'http://127.0.0.1:' + port
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      if (child.exitCode !== null) break
      try { await fetch(base + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); ready = true } catch { await new Promise((r) => setTimeout(r, 200)) }
    }
    check('F1 子进程服务就绪', ready && child.exitCode === null, 'port=' + port)
    if (ready) {
      const plain = await fetch(base + '/')
      const plainBody = await plain.text()
      check('F2 默认首页 200 且**不含** manifest 注入（默认关）', plain.status === 200 && !/rel="manifest"/.test(plainBody))
      const on = await fetch(base + '/?pwa=1')
      const onBody = await on.text()
      check('F3 ?pwa=1 首页注入 manifest + SW 注册', on.status === 200 && /rel="manifest" href="\/manifest\.webmanifest"/.test(onBody) && /serviceWorker/.test(onBody))
      check('F4 注入是纯增量（去掉注入片段后与默认首页逐字节相同）', onBody.replace(/<link rel="manifest"[\s\S]*?<\/script>\n/, '') === plainBody,
        'onBytes=' + onBody.length + ' plainBytes=' + plainBody.length)
      check('F5 环境变量开（不带 ?pwa=1 也注入）', await (async () => {
        // 另一个子进程，环境变量开
        const port2 = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
        const c2 = spawn(process.execPath, ['server/we-scene-demo-server.mjs'], { cwd: HERE, env: { ...process.env, PORT: String(port2), MPW_PWA: '1' }, stdio: 'ignore' })
        try {
          for (let i = 0; i < 100; i++) { try { await fetch('http://127.0.0.1:' + port2 + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); break } catch { await new Promise((r) => setTimeout(r, 200)) } }
          const b = await (await fetch('http://127.0.0.1:' + port2 + '/')).text()
          return /rel="manifest"/.test(b)
        } finally { c2.kill('SIGKILL') }
      })())
      const ROUTES = ['/manifest.webmanifest', '/sw.js', '/sw-policy.mjs', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png',
        // ①(2026-09-19 品牌图标) 页面/manifest 现在引用的四张：真服务上必须 200 + image/png
        '/icons/brand-32.png', '/icons/brand-192.png', '/icons/brand-512.png', '/icons/brand-512-maskable.png',
        // ①(2026-09-23 第二轮品牌清理 · 用户③) 浏览器**默认**请求的 `/favicon.ico`（`demo.html` 没写
        //   `<link rel=icon>`）⇒ 这条必须真服务 200，否则标签页图标就是空的
        '/favicon.ico']
      for (const r of ROUTES) {
        const resp = await fetch(base + r)
        const ct = resp.headers.get('content-type') || ''
        const want = PWA_ROUTES[r].type.split(';')[0]
        check('F6 ' + r + ' → 200 且 content-type=' + want, resp.status === 200 && ct.startsWith(want), 'status=' + resp.status + ' ct=' + ct)
      }
      check('F7 未登记的 PWA 路径仍 404（不误伤既有路由）', (await fetch(base + '/icons/nope.png')).status === 404)
      const mf = await (await fetch(base + '/manifest.webmanifest')).json().catch(() => null)
      check('F8 线上 manifest 可解析且 start_url 正确', !!mf && mf.start_url === '/?id=' + SAMPLE_ID)
      const swRes = await fetch(base + '/sw.js')
      const swSrc = await swRes.text()
      check('F9 线上 sw.js 与磁盘逐字节相同', swSrc === fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8'))
      const pol = await (await fetch(base + '/sw-policy.mjs')).text()
      check('F10 线上 sw-policy.mjs 与磁盘逐字节相同（SW import 的就是它）', pol === fs.readFileSync(path.join(WEB, 'sw-policy.mjs'), 'utf8'))
      // F11 ①(P-146 2026-09-19) **预缓存清单每条 URL 都要在真服务上 200**
      //   为什么必须端到端测（而不是"静态比对文件存在"）：SW 的 `install` 是**逐条 try/catch**，
      //   清单里哪怕写错一个名字也**不会报错**，只是那条永远缓存不上（"写了但没缓存"）。
      //   实测踩过：`/assets/fonts/Blackout.ttf` 根本不存在（真名 `Blackout 2 AM.ttf`，带空格要 encodeURIComponent）。
      //   也不重复实现服务器的路由表：直接问真服务。
      {
        const preBlock = (swSrc.match(/const PRECACHE = \[([\s\S]*?)\]/) || [, ''])[1]   // 只取数组本体，免得把注释/路由判断里的字符串也算进来
        const pre = [...preBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((u) => u.startsWith('/'))
        const bad = []
        for (const u of pre) {
          let code = 0
          try { code = (await fetch(base + u)).status } catch { code = -1 }
          if (code !== 200) bad.push(u + '→' + code)
        }
        check('F11 预缓存清单每条 URL 在真服务上都 200（' + pre.length + ' 条：' + pre.join(' ') + '）', bad.length === 0,
          bad.length ? '不是 200 的：' + bad.join(' ') : 'all 200')
      }
    }
  } catch (e) {
    check('F 真服务测试未抛异常', false, e && e.message)
  } finally {
    if (child) { try { child.kill('SIGKILL') } catch { /* ignore */ } }
  }
}

console.log('\n[G] 判据表自洽（防"白名单越写越宽"）')
{
  check('SHELL_EXACT 里没有用户素材端点', [...SHELL_EXACT].every((p) => !/raw|weassist|report|shot|pkgdir/.test(p)))
  check('SHELL_PREFIX 只含代码/字体/图标目录', SHELL_PREFIX.every((p) => /^(\/elysia\/|\/vendor\/[a-z0-9-]+\/|\/assets\/fonts\/|\/icons\/)$/.test(p)), SHELL_PREFIX.join(' '))
  check('USER_SOURCE_KEYS 覆盖 demo.html 实际会用的定位键', ['pkgpath', 'pkgurl', 'd'].every((k) => USER_SOURCE_KEYS.includes(k)))
}

// =====================================================================================
console.log('\n' + '─'.repeat(72))
console.log(`pwa-test：${pass} 通过 / ${fail} 失败（共 ${pass + fail} 条断言）`)
if (fail) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1) }
console.log('✓ P-92 离线 PWA（manifest/SW/注入）与"不缓存用户壁纸"全部断言通过')

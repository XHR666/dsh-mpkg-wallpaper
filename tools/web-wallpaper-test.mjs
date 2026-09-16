// tools/web-wallpaper-test.mjs — 网页（web）类壁纸回归（I 项：沙箱 iframe + WE API shim 注入）
//
// 覆盖（每条断言对应一个真实失败模式/规格事实）：
//   A 类型判定：web / scene / video / unknown 四态 + **声明与内容不符**（内容优先）+ 真目录夹具
//   B iframe sandbox：最小必要集 = 只要 allow-scripts（无 allow-same-origin ⇒ 不透明源）+ 三档属性
//   C shim 注入顺序：`<head>` 最前、作者脚本之前；无 head / 残缺 HTML；幂等；`</script>` 转义
//   D shim API 名单：与参考实现 oneincase/webwallgl（MIT，仅参考未复制）的覆盖/差异清单一致；
//                    文档 docs/WEB-WALLPAPER.md 与差异表同步
//   E shim 运行时（vm + 假 DOM）：属性重放、音频、媒体晚注册回放、目录池、文件 URL 改写、
//                    暂停/静音/倍速策略、**作者脚本抛错被兜住并上报**、未知 op 不炸
//   F 洁净度：插件不含任何 GPL 代码/派生物（注释剥离后按标识符 grep）+ 无跨仓硬路径依赖
//
// 参考基准（**不读对方仓库/本机副本**，按规格字面量自建，见 docs/COPYING-RULES.md §3.3）：
//   oneincase/webwallgl，MIT，commit b61e8910ae0a176288aed99ce9a93a13ea07df57（本机研读副本未入库）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { Writable } from 'node:stream'
import { loadPlugin } from './_stub.mjs'
import {
  WEB_KIND, SHIM_ATTR, SHIM_QUERY_KEY, SHIM_MSG, SHIM_VERSION, SHIM_API_NAMES, SHIM_CONTROL_OPS,
  WEB_SANDBOX_ATTR, WEB_SANDBOX_COMPAT_ATTR, WEB_SHIM_REFERENCE, WEB_SHIM_SOURCE,
  detectWebWallpaperKind, detectWallpaperDir, declaredTypeOf, declaredFileOf,
  isShimRequest, webPolicyFromQuery, buildSeedScript, rewriteWebEntryHtml, webAssetCorsHeaders,
  listWallpaperFiles, readProjectJson,
} from '../lib/web-wallpaper.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.error('  ✗ ' + name) } }
const eq = (a, b, name) => ok(a === b, name + (a === b ? '' : `（got=${JSON.stringify(a)} want=${JSON.stringify(b)}）`))
const tick = () => new Promise((r) => setTimeout(r, 0))
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/* ══════════════════ A. 类型判定（内容优先） ══════════════════ */
console.log('\n== A. 类型判定：web / scene / video / unknown 四态（内容优先，声明只作线索）==')
{
  // A1 声明 web + 有 index.html → web
  const a1 = detectWebWallpaperKind({ files: ['index.html', 'assets/app.js', 'preview.jpg'], project: { general: { type: 'web', file: 'index.html' } } })
  eq(a1.kind, WEB_KIND.WEB, 'A1 声明 web + index.html → web')
  eq(a1.reason, 'declared-html', 'A1 判定依据 = declared-html')
  eq(a1.entry, 'index.html', 'A1 入口 = index.html')
  eq(a1.mismatch, false, 'A1 声明与内容一致（mismatch=false）')

  // A2 无 project.json，仅内容 → web
  const a2 = detectWebWallpaperKind({ files: ['index.html', 'style.css'] })
  eq(a2.kind, WEB_KIND.WEB, 'A2 无 project.json（只有 index.html）→ web')
  eq(a2.reason, 'html-entry', 'A2 判定依据 = html-entry')
  eq(a2.declared, null, 'A2 无声明时 declared=null')

  // A3 声明 web 但内容是 scene.pkg（**既有教训：别只信声明**）
  const a3 = detectWebWallpaperKind({ files: ['scene.pkg', 'preview.jpg'], project: { general: { type: 'web' } } })
  eq(a3.kind, WEB_KIND.SCENE, 'A3 声明 web + scene.pkg → scene（内容优先）')
  eq(a3.mismatch, true, 'A3 标记声明与内容不符（mismatch=true）')
  eq(a3.reason, 'scene-container', 'A3 判定依据 = scene-container')

  // A4 声明 scene 但只有 index.html → web
  const a4 = detectWebWallpaperKind({ files: ['index.html'], project: { general: { type: 'scene', file: 'scene.pkg' } } })
  eq(a4.kind, WEB_KIND.WEB, 'A4 声明 scene + 只有 index.html → web')
  eq(a4.mismatch, true, 'A4 mismatch=true（声明 scene 与实际不符）')

  // A5 声明 video + 真有视频 → video；声明 video 但只有 html → web
  const a5 = detectWebWallpaperKind({ files: ['wall.mp4'], project: { general: { type: 'video', file: 'wall.mp4' } } })
  eq(a5.kind, WEB_KIND.VIDEO, 'A5 声明 video + wall.mp4 → video')
  eq(a5.reason, 'declared-video', 'A5 判定依据 = declared-video')
  const a5b = detectWebWallpaperKind({ files: ['index.html'], project: { general: { type: 'video', file: 'missing.mp4' } } })
  eq(a5b.kind, WEB_KIND.WEB, 'A5b 声明 video 但只有 index.html → web')
  eq(a5b.mismatch, true, 'A5b mismatch=true（声明 video 与实际不符）')

  // A6 仅内容：视频 / 松散场景 / 空目录 / 应用
  eq(detectWebWallpaperKind({ files: ['a.webm', 'preview.gif'] }).kind, WEB_KIND.VIDEO, 'A6 只有视频文件 → video')
  eq(detectWebWallpaperKind({ files: ['scene.json', 'tex/a.tex'] }).kind, WEB_KIND.SCENE, 'A6 松散 scene.json → scene')
  const a6u = detectWebWallpaperKind({ files: [] })
  eq(a6u.kind, WEB_KIND.UNKNOWN, 'A6 空目录 → unknown')
  eq(a6u.reason, 'no-files', 'A6 空目录判定依据 = no-files')
  const a6d = detectWebWallpaperKind({ files: ['x.txt'], project: { general: { type: 'web' } } })
  eq(a6d.kind, WEB_KIND.UNKNOWN, 'A6 声明 web 但没有任何 web 内容 → unknown（不硬信声明）')
  eq(a6d.reason, 'declared-unmatched', 'A6 判定依据 = declared-unmatched')
  const a6app = detectWebWallpaperKind({ files: ['wallpaper64.exe'], project: { general: { type: 'application' } } })
  eq(a6app.kind, WEB_KIND.UNKNOWN, 'A6 application/exe → unknown（绝不执行）')
  eq(a6app.reason, 'excluded-application', 'A6 判定依据 = excluded-application')
  eq(a6app.mismatch, false, 'A6 排除态不算"声明不符"')

  // A7 html + video 并存：看声明；无声明 → web（html 是入口）
  eq(detectWebWallpaperKind({ files: ['index.html', 'bg.mp4'], project: { general: { type: 'video', file: 'bg.mp4' } } }).kind, WEB_KIND.VIDEO, 'A7 声明 video 且 html+mp4 并存 → video')
  eq(detectWebWallpaperKind({ files: ['index.html', 'bg.mp4'] }).kind, WEB_KIND.WEB, 'A7 无声明且 html+mp4 并存 → web')

  // A8 嵌套入口（general.file 指向子目录）/ 多视频按体积挑
  const a8 = detectWebWallpaperKind({ files: ['web/index.html', 'readme.txt'], project: { general: { type: 'web', file: 'web/index.html' } } })
  eq(a8.entry, 'web/index.html', 'A8 general.file 指向子目录 → 入口取声明值')
  const a8b = detectWebWallpaperKind({ files: ['small.mp4', 'big.mp4'], sizes: { 'small.mp4': 1024, 'big.mp4': 1024 * 1024 * 900 } })
  eq(a8b.entry, 'big.mp4', 'A8 多视频候选 → 按体积取最大（内容优先于文件名）')

  // A9 声明解析：general.type 优先，兼容顶层 type；反斜杠/./ 归一
  eq(declaredTypeOf({ general: { type: 'Web' }, type: 'scene' }), 'web', 'A9 general.type 优先且小写化')
  eq(declaredTypeOf({ type: ' video ' }), 'video', 'A9 顶层 type 兼容 + 去空白')
  eq(declaredFileOf({ general: { file: '.\\sub\\index.htm' } }), 'sub/index.htm', 'A9 入口路径归一（反斜杠/./）')

  // A10 真目录夹具（detectWallpaperDir）：内容优先 + mpkg 收藏夹识别
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-web-'))
  const webDir = path.join(tmp, 'webwall')
  fs.mkdirSync(path.join(webDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(webDir, 'project.json'), JSON.stringify({ title: 'T', general: { type: 'web', file: 'index.html', properties: {} } }))
  fs.writeFileSync(path.join(webDir, 'index.html'), '<html><head><script src="assets/a.js"></script></head><body></body></html>')
  fs.writeFileSync(path.join(webDir, 'assets', 'a.js'), 'void 0')
  const dWeb = detectWallpaperDir(webDir)
  eq(dWeb.kind, WEB_KIND.WEB, 'A10 真目录（project.json=web + index.html 子目录资源）→ web')
  eq(dWeb.files.length, 3, 'A10 递归列出目录内 3 个文件')
  eq(readProjectJson(webDir).title, 'T', 'A10 readProjectJson 读到标题')

  const sceneDir = path.join(tmp, 'scenewall')
  fs.mkdirSync(sceneDir, { recursive: true })
  fs.writeFileSync(path.join(sceneDir, 'project.json'), JSON.stringify({ general: { type: 'web' } }))   // 谎报 web
  fs.writeFileSync(path.join(sceneDir, 'scene.pkg'), Buffer.from([0x50, 0x4b, 0x47, 0x56]))
  const dScene = detectWallpaperDir(sceneDir)
  eq(dScene.kind, WEB_KIND.SCENE, 'A10 真目录（谎报 web + 有 scene.pkg）→ scene')
  eq(dScene.mismatch, true, 'A10 真目录 mismatch=true')

  const mpkgDir = path.join(tmp, 'collection')
  fs.mkdirSync(mpkgDir, { recursive: true })
  fs.writeFileSync(path.join(mpkgDir, 'a.mpkg'), Buffer.from([1]))
  fs.writeFileSync(path.join(mpkgDir, 'b.mpkg'), Buffer.from([2]))
  const dMpkg = detectWallpaperDir(mpkgDir)
  eq(dMpkg.mpkgs.length, 2, 'A10 纯 .mpkg 收藏夹 → 列出 2 个 mpkg（folderMpkg 分支的数据源）')
  eq(dMpkg.signals.html, null, 'A10 收藏夹无 html 信号')
  ok(listWallpaperFiles(mpkgDir).length === 2, 'A10 listWallpaperFiles 读到 2 个文件')
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
}

/* ══════════════════ B. iframe sandbox 属性集 ══════════════════ */
console.log('\n== B. 沙箱 iframe：最小必要集 + 三档（网页 shim / 场景 strict / 兼容）==')
{
  eq(WEB_SANDBOX_ATTR, 'allow-scripts', 'B1 shim 通道沙箱 = 只要 allow-scripts')
  ok(!/allow-same-origin/.test(WEB_SANDBOX_ATTR), 'B2 不含 allow-same-origin（否则「可执行脚本 + 同源」= 可摘自己的 sandbox）')
  ok(!/allow-popups|allow-top-navigation|allow-modals|allow-forms|allow-downloads|allow-storage-access/.test(WEB_SANDBOX_ATTR), 'B2 不含任何额外放行（弹窗/顶层导航/模态/表单/下载）')
  ok(/allow-same-origin/.test(WEB_SANDBOX_COMPAT_ATTR), 'B3 兼容模式属性集保留 allow-same-origin（Live2D 设置面板依赖它，见文档「已知限制」）')
  ok(SHIM_VERSION >= 1 && Number.isInteger(SHIM_VERSION), 'B3 shim 版本为整数')
  eq(SHIM_QUERY_KEY, 'mpwshim', 'B3 注入标记查询键 = mpwshim')

  // 跨源策略：只给沙箱帧的不透明源（Origin: null）放行读取
  const corsNull = webAssetCorsHeaders('null')
  ok(!!corsNull && corsNull['access-control-allow-origin'] === 'null', 'B4 Origin: null（沙箱帧）→ ACAO: null（帧内 fetch 可用）')
  eq(webAssetCorsHeaders('https://evil.example'), null, 'B4 真实站点 Origin → 不给 ACAO（读不到本机壁纸文件）')
  eq(webAssetCorsHeaders(undefined), null, 'B4 无 Origin → 不加头（同源子资源本来就不需要 CORS）')

  // 客户端常量与宿主模块必须逐字一致（源码守卫；两侧各自独立实现，靠断言对齐）
  const client = read('lib/client.js')
  ok(/const MPW_WEB_SANDBOX_ATTR = "allow-scripts";/.test(client), 'B5 client.js 的 MPW_WEB_SANDBOX_ATTR 与宿主模块一致')
  ok(new RegExp('const MPW_WEB_COMPAT_ATTR = "' + WEB_SANDBOX_COMPAT_ATTR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '";').test(client), 'B5 client.js 的兼容模式属性集与宿主模块逐字一致')
  ok(client.indexOf('MPW_WEB_SHIM_TIMEOUT_MS') > 0, 'B5 client.js 有 shim 握手超时兜底')
  const plugin = loadPlugin({ quiet: true })
  const T = globalThis.__mpwWebTest
  ok(!!T && typeof T.sandboxAttr === 'function', 'B6 客户端测试钩子 __mpwWebTest 已暴露')
  eq(T.sandboxAttr('/api/mpkg-wallpaper/custom-folder/W/index.html?mpwshim=1&mpwmute=1'), 'allow-scripts', 'B6 shim URL → 不透明源沙箱')
  eq(T.sandboxAttr('/api/mpkg-wallpaper/custom-folder/W/index.html'), WEB_SANDBOX_COMPAT_ATTR, 'B6 无标记的普通网页壁纸 URL → 兼容集（旧行为）')
  eq(T.sandboxAttr('http://127.0.0.1:8899/?pkgurl=x&sandbox=strict'), 'allow-scripts allow-pointer-lock', 'B6 渲染器 strict URL → 场景 strict 集（不受网页通道影响）')
  ok(T.isShimUrl('a?mpwshim=1') && !T.isShimUrl('a?mpwshim=0') && !T.isShimUrl('a?xmpwshim=1'), 'B6 shim 标记识别只认 mpwshim=1 且按参数边界')
  // URL 身份 = 壁纸身份，不含策略参数：拨静音/倍速/暂停**不该**重载壁纸（重动画壁纸重载很贵）
  const ua = '/api/mpkg-wallpaper/custom-folder/W/index.html?mpwshim=1&mpwmute=1&mpwspeed=1&mpwpause=0'
  const ub = '/api/mpkg-wallpaper/custom-folder/W/index.html?mpwshim=1&mpwmute=0&mpwspeed=2&mpwpause=1'
  eq(T.stripPolicy(ua), T.stripPolicy(ub), 'B7 策略参数被剥离 → 两次 URL 身份相同（不触发重载）')
  eq(T.stripPolicy(ua), '/api/mpkg-wallpaper/custom-folder/W/index.html?mpwshim=1', 'B7 剥离后保留 shim 标记与路径')
  ok(T.stripPolicy('/a/index.html') === '/a/index.html', 'B7 无策略参数时原样返回')
  ok(!plugin.applyErrors.length, 'B6 载入/接线期无 apply 错误')
}

/* ══════════════════ C. shim 注入顺序 ══════════════════ */
console.log('\n== C. shim 注入：作者脚本之前、幂等、转义 ==')
{
  const authorHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><script src="app.js"></script><script>var x=1;</script></head><body><script src="late.js"></script></body></html>'
  const out = rewriteWebEntryHtml(authorHtml, { seedScript: buildSeedScript({ muted: true, speed: 1, paused: false }, 'index.html') })
  const iShim = out.indexOf(SHIM_ATTR)
  const iSeed = out.indexOf(SHIM_ATTR + '-seed')
  const iAuthor = out.indexOf('app.js')
  const iAuthorInline = out.indexOf('var x=1;')
  const iLate = out.indexOf('late.js')
  ok(iShim > 0, 'C1 shim 已注入')
  ok(iShim < iAuthor, 'C2 shim 在作者外链脚本之前')
  ok(iShim < iAuthorInline, 'C2 shim 在作者内联脚本之前')
  ok(iShim < iLate, 'C2 shim 在 body 尾部脚本之前')
  ok(iSeed > iShim && iSeed < iAuthor, 'C3 种子脚本在 shim 之后、作者脚本之前')
  ok(out.indexOf('<head>') >= 0 && out.indexOf(SHIM_ATTR) < out.indexOf('<meta charset'), 'C3 插在 <head> 开始标签之后（最前）')
  eq(rewriteWebEntryHtml(out, {}).length, out.length, 'C4 幂等：已注入的 HTML 原样返回')
  eq((out.match(new RegExp(SHIM_ATTR, 'g')) || []).length, 2, 'C4 只注入一次 shim + 一次种子脚本')

  const noHead = rewriteWebEntryHtml('<html><body><script src="a.js"></script></body></html>')
  ok(noHead.indexOf('<head>') > 0 && noHead.indexOf(SHIM_ATTR) < noHead.indexOf('a.js'), 'C5 无 <head> → 自造 head 且 shim 仍在作者脚本前')
  const fragment = rewriteWebEntryHtml('<div>裸片段</div><script src="a.js"></script>')
  ok(/^<!DOCTYPE html>/.test(fragment) && fragment.indexOf(SHIM_ATTR) < fragment.indexOf('a.js'), 'C5 残缺 HTML → 整段包裹且顺序正确')

  const escaped = rewriteWebEntryHtml('<head></head>', { shimSource: 'var s = "</script><b>";' })
  ok(escaped.indexOf('<\\/script') > 0 && escaped.split('</script>').length === 2, 'C6 shim 源码里的 </script> 被转义（不会提前闭合宿主 script 标签）')

  const empty = rewriteWebEntryHtml('')
  ok(empty.indexOf(SHIM_ATTR) > 0, 'C6 空 HTML 也能得到可用外壳（不抛错）')
  ok(rewriteWebEntryHtml(null).indexOf(SHIM_ATTR) > 0, 'C6 null 输入不抛错（宿主读到空文件时仍可用）')

  // 宿主侧接线：请求标记 → 注入；策略从查询串取
  ok(isShimRequest('/api/mpkg-wallpaper/custom-folder/W/index.html?mpwshim=1'), 'C7 ?mpwshim=1 → 判定为注入请求')
  ok(!isShimRequest('/api/mpkg-wallpaper/custom-folder/W/index.html'), 'C7 无标记 → 不注入（旧 URL 行为不变）')
  const pol = webPolicyFromQuery('/x/index.html?mpwshim=1&mpwmute=0&mpwspeed=1.5&mpwpause=1')
  ok(pol && pol.muted === false && pol.speed === 1.5 && pol.paused === true, 'C7 策略从查询串解析（静音/倍速/暂停）')
  eq(webPolicyFromQuery('/x/index.html'), null, 'C7 无标记时不给策略')
  ok(webPolicyFromQuery('?mpwshim=1&mpwspeed=99').speed === 1, 'C7 越界倍速被夹回 1（不把 99 倍速塞进作者页面）')
  const seed = buildSeedScript({ muted: false, speed: 2, paused: true }, 'sub/a.html')
  ok(/^window\.__mpwWebSeed=/.test(seed) && /"speed":2/.test(seed) && /"entry":"sub\/a.html"/.test(seed), 'C7 种子脚本内容正确')
  const nasty = rewriteWebEntryHtml('<head></head>', { seedScript: buildSeedScript({}, 'x"></script><script>bad()') })
  ok((nasty.match(/<\/script>/g) || []).length === 2 && nasty.indexOf('<\\/script') > 0, 'C7 种子脚本里的 </script> 字面量被转义（真实闭合标签只有注入的两个）')

  // 宿主路由源码守卫：注入点必须在两条网页壁纸资源路由上（不是新增旁路）
  const host = read('lib/index.js')
  ok(/serveWebAsset\(req, res, join\(customDir, folder\), file, 'custom'\)/.test(host), 'C8 /custom-folder 走统一的注入资源分发')
  ok(/serveWebAsset\(req, res, rec\.dir, file, 'library'\)/.test(host), 'C8 /library-web 走统一的注入资源分发')
  ok(host.indexOf('detectWallpaperDir(sub)') > 0, 'C8 /custom-dir 扫描改用内容优先判定')
  ok(host.indexOf('__mpw-list.json') > 0, 'C8 宿主提供目录清单虚拟文件（slideshow 文件池）')
}

/* ══════════════════ D. shim API 名单 / 与参考实现的差异 ══════════════════ */
console.log('\n== D. shim API 名单与参考实现（webwallgl，MIT）的覆盖/差异 ==')
{
  const expected = [
    'wallpaperPropertyListener',
    'wallpaperRegisterAudioListener',
    'wallpaperRegisterMediaPropertiesListener',
    'wallpaperRegisterMediaThumbnailListener',
    'wallpaperRegisterMediaPlaybackListener',
    'wallpaperRegisterMediaTimelineListener',
    'wallpaperRegisterMediaStatusListener',
    'wallpaperRequestRandomFileForProperty',
    'wallpaperMediaIntegration',
    'wallpaperPluginListener',
  ]
  eq(SHIM_API_NAMES.slice().sort().join(','), expected.slice().sort().join(','), 'D1 shim API 名单与规格字面量一致（10 项）')
  for (const k of WEB_SHIM_REFERENCE.covered) ok(SHIM_API_NAMES.indexOf(k) >= 0, 'D2 参考实现覆盖的 ' + k + ' 本实现也覆盖')
  eq(WEB_SHIM_REFERENCE.vendored, false, 'D3 参考实现**未 vendored**（仅参考未复制）')
  eq(WEB_SHIM_REFERENCE.spdx, 'MIT', 'D3 参考实现 SPDX = MIT')
  ok(/^[0-9a-f]{40}$/.test(WEB_SHIM_REFERENCE.commit), 'D3 台账 commit 为 40 位 sha1（可追溯）')
  ok(WEB_SHIM_REFERENCE.notCovered.length >= 5, 'D4 差异清单列出 ≥5 项「参考有、本实现有意不做」')
  ok(WEB_SHIM_REFERENCE.extras.length >= 3, 'D4 差异清单列出本实现独有项（架构不同导致）')
  eq(SHIM_CONTROL_OPS.length, 14, 'D4 控制指令白名单 14 项（9 项控制 + 5 项交互注入，postMessage op）')

  // 文档同步：差异表的每一条都必须能在 docs/WEB-WALLPAPER.md 里找到（文档/代码不许漂移）
  let doc = ''
  try { doc = read('docs/WEB-WALLPAPER.md') } catch {}
  ok(!!doc, 'D5 docs/WEB-WALLPAPER.md 存在')
  for (const s of WEB_SHIM_REFERENCE.notCovered) ok(doc.indexOf(s) >= 0, 'D5 文档写明差异项：' + s)
  for (const s of WEB_SHIM_REFERENCE.extras) ok(doc.indexOf(s) >= 0, 'D5 文档写明本实现独有项：' + s)
  for (const k of SHIM_API_NAMES) ok(doc.indexOf(k) >= 0, 'D5 文档 API 表包含 ' + k)
  ok(doc.indexOf('allow-scripts') >= 0 && doc.indexOf('allow-same-origin') >= 0, 'D5 文档写明 sandbox 策略与两项属性')
  ok(/WEBWALLGL|webwallgl/.test(doc), 'D5 文档写明参考来源（MIT 署名要求）')
}

/* ══════════════════ E. shim 运行时（vm + 假 DOM） ══════════════════ */
console.log('\n== E. shim 运行时：属性重放 / 音频 / 媒体 / 文件池 / 策略 / 抛错兜底 ==')
function makeShimEnv(seed) {
  const posted = []
  const media = []
  const parent = { postMessage: (m, o) => posted.push({ m, o }) }
  const ev = () => {
    const h = Object.create(null)
    return {
      addEventListener(type, fn) { (h[type] = h[type] || []).push(fn) },
      removeEventListener() {},
      dispatch(type, e) { for (const fn of (h[type] || []).slice()) fn(e) },
      has: (t) => !!(h[t] && h[t].length),
    }
  }
  const winEv = ev(), docEv = ev()
  class FakeElement {
    constructor() { this.attrs = {} }
    setAttribute(k, v) { this.attrs[k] = v }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null }
  }
  class FakeStyle { constructor() { this.props = {} } setProperty(k, v) { this.props[k] = v } getPropertyValue(k) { return this.props[k] || '' } }
  class FakeMedia {
    constructor(tag) { this.tagName = tag; this.paused = false; this.muted = false; this.playbackRate = 1; this.plays = 0; this.pauses = 0 }
    play() { this.paused = false; this.plays++; return Promise.resolve() }
    pause() { this.paused = true; this.pauses++ }
  }
  const docEl = new FakeElement()
  const doc = {
    readyState: 'complete',
    documentElement: docEl,
    body: new FakeElement(),
    baseURI: 'http://127.0.0.1:3080/api/mpkg-wallpaper/custom-folder/W1/index.html',
    addEventListener: docEv.addEventListener,
    removeEventListener() {},
    querySelectorAll: (sel) => (/audio|video/.test(String(sel)) ? media.slice() : []),
  }
  const sandbox = {
    console, URL, Math, Object, Array, Number, String, JSON, Date, Error, Proxy, WeakMap, Promise, isFinite, parseInt, parseFloat,
    queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval, document: doc, location: { href: doc.baseURI },
    Element: FakeElement, HTMLElement: FakeElement, CSSStyleDeclaration: FakeStyle,
    HTMLImageElement: class extends FakeElement {}, HTMLMediaElement: class extends FakeElement {},
    HTMLSourceElement: class extends FakeElement {}, HTMLScriptElement: class extends FakeElement {},
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (f) => setTimeout(() => f(Date.now()), 0), cancelAnimationFrame: () => {},
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.parent = parent
  sandbox.addEventListener = winEv.addEventListener
  sandbox.removeEventListener = () => {}
  // 宿主注入的种子脚本（window.__mpwWebSeed）——必须在 shim 之前写入，模拟 HTML 里的注入顺序
  if (seed) sandbox.__mpwWebSeed = seed
  const ctx = vm.createContext(sandbox)
  vm.runInContext(WEB_SHIM_SOURCE, ctx, { filename: 'mpw-we-shim.js' })
  return { sandbox, ctx, posted, media, parent, winEv, docEv, FakeElement, FakeMedia, docEl }
}
{
  const env = makeShimEnv()
  const { sandbox, posted } = env
  ok(sandbox.__mpwWebShimInstalled === true && sandbox.__mpwWebShimVersion === SHIM_VERSION, 'E1 shim 已安装并标版本')
  const ready = posted.filter((p) => p.m.op === 'ready')
  eq(ready.length, 1, 'E1 安装即向父页报到（ready）')
  eq(ready[0].m.mpw, SHIM_MSG, 'E1 消息带协议标记 ' + SHIM_MSG)
  eq(ready[0].o, '*', 'E1 targetOrigin 用 "*"（不透明源下唯一可行）')
  vm.runInContext(WEB_SHIM_SOURCE, env.ctx, { filename: 'mpw-we-shim-again.js' })
  eq(posted.filter((p) => p.m.op === 'ready').length, 1, 'E1 重复注入幂等（只报到一次）')

  // E2 API 全部就位
  for (const k of SHIM_API_NAMES) ok(k in sandbox, 'E2 暴露 ' + k)
  eq(sandbox.wallpaperMediaIntegration.PLAYBACK_STOPPED, 0, 'E2 PLAYBACK_STOPPED=0')
  eq(sandbox.wallpaperMediaIntegration.PLAYBACK_PLAYING, 1, 'E2 PLAYBACK_PLAYING=1')
  eq(sandbox.wallpaperMediaIntegration.PLAYBACK_PAUSED, 2, 'E2 PLAYBACK_PAUSED=2')
  eq(typeof sandbox.wallpaperPluginListener.onPluginLoaded, 'function', 'E2 wallpaperPluginListener 空实现（作者 if 判断不崩）')
  ok(!Object.keys(sandbox).some((k) => k.indexOf('$media') === 0), 'E2 不暴露 $media*（那是场景脚本 API，网页壁纸无此接口——见文档差异表）')

  // E3 属性：先推后赋值 → 赋值后补发全量；增量合并
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'props', props: { a: { value: 1 } } })
  const seen = []
  sandbox.wallpaperPropertyListener = {
    applyUserProperties: (p) => seen.push(p),
    applyGeneralProperties: (g) => seen.push({ g }),
    setPaused: (v) => seen.push({ paused: v }),
  }
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'props', props: { b: { value: 2 } } })
  const last = seen[seen.length - 1]
  ok(!!last && last.a && last.a.value === 1 && last.b && last.b.value === 2, 'E3 属性表是合并快照（晚到的键也在，作者不会读到缺字段的表）')
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'general', general: { fps: 30 } })
  ok(seen.some((x) => x.g && x.g.fps === 30), 'E3 applyGeneralProperties 可达')
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'pause', value: true })
  ok(seen.some((x) => x.paused === true), 'E3 setPaused 可达')

  // E4 音频：暂停期间不下发（官方暂停语义 = 冻结），恢复后继续
  let bands = null
  sandbox.wallpaperRegisterAudioListener((a) => { bands = a })
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'audio', bands: [1, 2] })
  eq(bands, null, 'E4 暂停期间音频不下发')
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'pause', value: false })
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'audio', bands: [3, 4] })
  ok(!!bands && bands[1] === 4, 'E4 恢复后音频下发到作者回调')
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'audio', bands: 'not-an-array' })
  ok(!!bands && bands[1] === 4, 'E4 非法音频数据被忽略（不污染作者状态）')

  // E5 媒体：晚注册回放最近一帧（作者常在 DOMContentLoaded 后才 Register）
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'media', payload: { op: 'playback', state: 1 } })
  let got = null
  sandbox.wallpaperRegisterMediaPlaybackListener((m) => { got = m })
  ok(!!got && got.state === 1, 'E5 媒体监听器晚注册 → 回放最近一帧')
  let thumb = null
  sandbox.wallpaperRegisterMediaThumbnailListener((m) => { thumb = m })
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'media', payload: { op: 'thumbnail', thumbnail: 'data:image/png;base64,AA' } })
  ok(!!thumb && thumb.op === 'thumbnail', 'E5 缩略图通道可达')
  ok(sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'media', payload: { op: 'nope' } }) === false, 'E5 未知媒体类别返回 false（不抛错）')

  // E6 目录池 / 随机文件
  let rnd = ['x', 'y']
  sandbox.wallpaperRequestRandomFileForProperty('file', (n, f) => { rnd = [n, f] })
  eq(rnd[1], '', 'E6 池为空时回调空串（作者侧普遍 if(p) 守卫）')
  const added = []
  sandbox.wallpaperPropertyListener.userDirectoryFilesAddedOrChanged = (p, f) => added.push([p, f])
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'directory', prop: 'file', files: ['a.png', 'b.png', 'a.png'] })
  ok(!!added.length && added[0][1].length === 2, 'E6 目录新增去重后回调 userDirectoryFilesAddedOrChanged')
  sandbox.wallpaperRequestRandomFileForProperty('file', (n, f) => { rnd = [n, f] })
  ok(rnd[0] === 'file' && /^[ab]\.png$/.test(rnd[1]), 'E6 随机文件从池中取')
  const removed = []
  sandbox.wallpaperPropertyListener.userDirectoryFilesRemoved = (p, f) => removed.push(f)
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'directory-remove', prop: 'file', files: ['a.png'] })
  ok(removed.length === 1 && removed[0][0] === 'a.png', 'E6 目录移除回调可达')

  // E7 帧内媒体策略：静音/倍速/暂停（沙箱下父页读不到帧内 DOM，只能这样下达）
  const v = new env.FakeMedia('VIDEO')
  env.media.push(v)
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', muted: true, speed: 1.5 })
  ok(v.muted === true && v.playbackRate === 1.5, 'E7 策略：静音 + 倍速作用到帧内 media')
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', muted: false, speed: 1 })
  eq(v.muted, false, 'E7 解除静音只解开「我们自己静的」元素')
  const playStart = v.plays, pauseStart = v.pauses
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'pause', value: true })
  ok(v.pauses === pauseStart + 1 && v.paused === true, 'E7 暂停：冻结帧内 media')
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'pause', value: false })
  ok(v.plays === playStart + 1 && v.paused === false, 'E7 恢复：解冻帧内 media')
  // 作者主动 muted 的元素不被我们解开
  const a2 = new env.FakeMedia('AUDIO'); a2.muted = true; env.media.push(a2)
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', muted: true })
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', muted: false })
  eq(a2.muted, true, 'E7 作者自己静音的元素保持静音（不越权）')

  // E8 文件 URL 改写：官方 CEF 以文件系统为源，作者写 file:///…
  const base = 'http://127.0.0.1:3080/api/mpkg-wallpaper/custom-folder/W1/index.html'
  eq(sandbox.__mpwRewriteFileUrl('file:///files/a.png'), 'http://127.0.0.1:3080/api/mpkg-wallpaper/custom-folder/W1/files/a.png', 'E8 file:///files/a.png → 同目录 HTTP 资源')
  eq(sandbox.__mpwRewriteFileUrl('file:///Users/x/a.png'), '', 'E8 绝对系统路径无法映射 → 空串（作者侧有守卫，胜过 404 黑图）')
  eq(sandbox.__mpwRewriteFileUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png', 'E8 非 file: URL 原样放行')
  ok(/^url\("http:\/\/127\.0\.0\.1:3080\/api\/mpkg-wallpaper\/custom-folder\/W1\/files\/b\.png"\)$/.test(sandbox.__mpwRewriteFileUrl('url("file:///files/b.png")')), 'E8 CSS url() 也改写（background-image 场景）')
  eq(sandbox.__mpwRewriteFileUrl('file:///'), '', 'E8 空 file:/// → 空串（否则会请求壁纸根目录）')
  const el = new env.FakeElement()
  el.setAttribute('src', 'file:///files/c.png')
  ok(/\/files\/c\.png$/.test(el.getAttribute('src')), 'E8 setAttribute("src") 钩子生效')
  // 绝对路径不含 base 拼接（不因 baseURI 为空而抛）
  ok(typeof sandbox.__mpwRewriteFileUrl(123) === 'number', 'E8 非字符串输入原样返回（不改写不抛错）')

  // E9 作者脚本抛错被兜住并上报（不能拖垮插件，更不能阻断后续通道）
  const before = posted.filter((p) => p.m.op === 'error').length
  sandbox.wallpaperPropertyListener = { applyUserProperties: () => { throw new Error('author-boom') } }
  let escaped = null
  try { sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'props', props: { z: { value: 9 } } }) } catch (e) { escaped = e }
  eq(escaped, null, 'E9 作者 applyUserProperties 抛错被 shim 吞掉（不外泄）')
  const errs = posted.filter((p) => p.m.op === 'error')
  ok(errs.length === before + 1 && errs[errs.length - 1].m.kind === 'listener' && /author-boom/.test(errs[errs.length - 1].m.message), 'E9 抛错上报父页（kind=listener + 原文）')
  sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'ping' })
  ok(posted.filter((p) => p.m.op === 'pong').length >= 1, 'E9 抛错后通道照旧可用（ping→pong）')
  let threw = false
  try { sandbox.wallpaperRequestRandomFileForProperty('file', () => { throw new Error('cb-boom') }) } catch (e) { threw = true }
  ok(!threw, 'E9 随机文件回调抛错也被兜住')
  // window error / unhandledrejection → 上报；资源 404 不报（否则刷屏）
  const e0 = posted.filter((p) => p.m.op === 'error').length
  env.winEv.dispatch('error', { error: new Error('win-boom'), message: 'win-boom' })
  ok(posted.filter((p) => p.m.op === 'error').length === e0 + 1, 'E9 window error 上报父页')
  env.winEv.dispatch('error', { target: { tagName: 'IMG' }, message: '' })
  ok(posted.filter((p) => p.m.op === 'error').length === e0 + 1, 'E9 资源加载错误不上报（不刷父页日志）')
  env.winEv.dispatch('unhandledrejection', { reason: new Error('rej') })
  ok(posted.filter((p) => p.m.op === 'error').length === e0 + 2, 'E9 未捕获 Promise 拒绝上报')
  // 错误预算：限流后不再上报（不会把父页日志打爆）
  for (let i = 0; i < 80; i++) env.winEv.dispatch('error', { error: new Error('flood-' + i) })
  ok(posted.filter((p) => p.m.op === 'error').length <= e0 + 55, 'E9 错误上报有预算上限（限流生效）')

  // E10 控制通道：来源校验（只认父窗口）+ 未知 op 不炸
  env.docEv.dispatch('message', { source: { evil: true }, data: { mpw: SHIM_MSG, op: 'props', props: { evil: { value: 1 } } } })
  const probe = []
  sandbox.wallpaperPropertyListener = { applyUserProperties: (p) => probe.push(p) }
  env.docEv.dispatch('message', { source: env.parent, data: { mpw: SHIM_MSG, op: 'props', props: { good: { value: 2 } } } })
  const lastProbe = probe[probe.length - 1] || {}
  ok(!!lastProbe.good && !lastProbe.evil, 'E10 非父窗口来源的消息被丢弃、父窗口消息被接受（任意页面不能控制壁纸）')
  ok(sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'not-a-real-op' }) === false, 'E10 未知 op 返回 false（白名单外一律不动）')
  ok(sandbox.__mpwWebControl(null) === false, 'E10 非法消息体不抛错')
}

// E11 种子脚本（宿主注入的 window.__mpwWebSeed）先于 shim 写入 → 首帧策略即成立
{
  const env2 = makeShimEnv({ v: SHIM_VERSION, entry: 'index.html', policy: { muted: false, speed: 2, paused: true } })
  const v2 = new env2.FakeMedia('VIDEO')
  env2.media.push(v2)
  env2.sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy' })
  ok(v2.muted === false && v2.playbackRate === 2, 'E11 种子脚本策略在首帧生效（未静音 + 2 倍速）')
  const seen2 = []
  env2.sandbox.wallpaperPropertyListener = { setPaused: (x) => seen2.push(x) }
  env2.sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'pause', value: true })
  ok(seen2.indexOf(true) >= 0, 'E11 种子里的暂停状态经控制通道补发给作者')

  // E12 控制指令白名单：宿主侧名单里的每个 op 都能被 shim 处理且不抛错
  const env3 = makeShimEnv()
  for (const op of SHIM_CONTROL_OPS) {
    const payload = { op, props: {}, general: {}, files: [], payload: { op: 'playback' }, value: false, muted: false, speed: 1, bands: [] }
    let t = null
    try { env3.sandbox.__mpwWebControl(Object.assign({ mpw: SHIM_MSG }, payload)) } catch (e) { t = e }
    eq(t, null, 'E12 op=' + op + ' 不抛错')
  }
}

/* ══════════════════ E13. 帧内交互合成（消息 → 假 DOM 事件） ══════════════════ */
console.log('\n== E13. 交互注入：控制消息 → 帧内合成 DOM 事件（命中元素/边缘/哨兵值） ==')
{
  /** 造一个"够真"的假 DOM：querySelectorAll 只用于 media 策略，事件靠 dispatchEvent 记录。 */
  function makeIxEnv() {
    const posted = []
    const parent = { postMessage: (m, o) => posted.push({ m, o }) }
    const ev = () => {
      const h = Object.create(null)
      return {
        addEventListener(t, fn) { (h[t] = h[t] || []).push(fn) },
        removeEventListener() {},
        dispatch(t, e) { for (const fn of (h[t] || []).slice()) fn(e) },
      }
    }
    const winEv = ev(), docEv = ev()
    const log = []
    class Node {
      constructor(tag) { this.tagName = String(tag || '').toUpperCase(); this.children = []; this.parentNode = null; this.listeners = {}; this.attrs = {} }
      appendChild(c) { c.parentNode = this; this.children.push(c); return c }
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn) }
      removeEventListener() {}
      setAttribute(k, v) { this.attrs[k] = v }
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null }
      dispatchEvent(e) {
        if (!e || !e.type) return true
        // 冒泡：沿 parentNode 链把同一事件对象交给每个监听器（与浏览器语义一致，测试靠它验证"挂 document 的作者也能收到"）
        let n = this
        while (n) {
          const arr = n.listeners[e.type] || []
          for (const fn of arr.slice()) { try { fn.call(n, e) } catch (err) { log.push('throw:' + e.type) } }
          n = e.bubbles === false ? null : n.parentNode
        }
        return true
      }
      querySelectorAll() { return [] }
    }
    const html = new Node('html'), body = new Node('body'), canvas = new Node('canvas'), btn = new Node('div')
    html.appendChild(body); body.appendChild(canvas); body.appendChild(btn)
    const docEv2 = ev()
    const doc = {
      readyState: 'complete', documentElement: html, body, activeElement: body,
      baseURI: 'http://127.0.0.1:3080/api/mpkg-wallpaper/custom-folder/W1/index.html',
      addEventListener: (t, fn) => { docEv.addEventListener(t, fn); docEv2.addEventListener(t, fn) }, removeEventListener() {},
      querySelectorAll: () => [],
      elementFromPoint: (x, y) => (x >= 0 && y >= 0 ? (y > 50 ? btn : canvas) : null),
      execCommand: () => true,
    }
    class FakeEvt {
      constructor(type, init) { this.type = type; Object.assign(this, init || {}); this.defaultPrevented = false }
      preventDefault() { this.defaultPrevented = true }
    }
    const sandbox = {
      console, URL, Math, Object, Array, Number, String, JSON, Date, Error, Proxy, WeakMap, Promise, isFinite, parseInt, parseFloat,
      queueMicrotask, setTimeout, clearTimeout, document: doc, location: { href: doc.baseURI, screenX: 0, screenY: 0 },
      innerWidth: 1280, innerHeight: 720,
      addEventListener: winEv.addEventListener, removeEventListener() {},
      Event: FakeEvt, MouseEvent: FakeEvt, PointerEvent: FakeEvt, WheelEvent: FakeEvt, KeyboardEvent: FakeEvt,
      Element: Node, HTMLElement: Node, CSSStyleDeclaration: class { setProperty() {} getPropertyValue() { return '' } },
      HTMLImageElement: Node, HTMLMediaElement: Node, HTMLSourceElement: Node, HTMLScriptElement: Node,
      HTMLInputElement: class extends Node { constructor() { super('INPUT'); this.value = ''; this.maxLength = -1 } },
      HTMLTextAreaElement: class extends Node { constructor() { super('TEXTAREA'); this.value = ''; this.maxLength = -1 } },
      MutationObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: (f) => setTimeout(() => f(Date.now()), 0), cancelAnimationFrame: () => {},
    }
    sandbox.window = sandbox; sandbox.self = sandbox; sandbox.parent = parent
    const ctx = vm.createContext(sandbox)
    vm.runInContext(WEB_SHIM_SOURCE, ctx, { filename: 'mpw-we-shim.js' })
    // 记录作者视角收到的事件（挂 canvas 与 document 两条路径）
    const seen = []
    const rec = (ev) => seen.push({ type: ev.type, x: ev.clientX, y: ev.clientY, button: ev.button, buttons: ev.buttons, detail: ev.detail, ctrl: ev.ctrlKey, key: ev.key, deltaY: ev.deltaY, wheelDelta: ev.wheelDelta })
    // 监听器要挂在**命中元素本身**上：canvas 事件不冒泡到兄弟节点（btn），
    // 只挂 canvas 会漏掉「命中元素变化后事件打到 btn」这一类（测试会假绿）。
    for (const t of ['pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mouseenter', 'mouseleave', 'wheel', 'mousewheel', 'keydown', 'keyup']) {
      canvas.addEventListener(t, rec)
      btn.addEventListener(t, rec)
    }
    // document 路径：验证"作者挂在 document/window 上靠冒泡收到"（语料里 15 张这么写）
    const onDoc = (ev) => { if (ev.target === doc || ev.target === body) rec(ev) }
    for (const t of ['pointermove', 'mousemove', 'click']) docEv2.addEventListener(t, onDoc)
    const send = (msg) => sandbox.__mpwWebControl(Object.assign({ mpw: SHIM_MSG }, msg))
    return { sandbox, parent, posted, doc, canvas, btn, seen, send, winEv, docEv }
  }

  const e = makeIxEnv()
  const types = () => e.seen.map((s) => s.type)

  // ① 命中元素派发：y<=50 命中 canvas、y>50 命中按钮；两条路径都要能收到（冒泡）
  e.send({ op: 'pointer', x: 10, y: 10, buttons: 0 })
  ok(types().indexOf('pointermove') >= 0 && types().indexOf('mousemove') >= 0, 'E13-1 指针移动 → pointermove + mousemove（两种监听器都能收到）')
  ok(e.seen.some((s) => s.type === 'mousemove' && s.x === 10 && s.y === 10), 'E13-1 clientX/clientY = 父页换算后的帧内像素')
  ok(types().indexOf('pointerover') >= 0 && types().indexOf('pointerenter') >= 0, 'E13-2 首次进入补 over/enter（作者靠它启动 hover 动画）')
  e.seen.length = 0
  e.send({ op: 'pointer', x: 10, y: 10, buttons: 0 })
  eq(e.seen.length, 0, 'E13-2 位置未变 → 一个事件都不发（静止不等于在动）')
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 0 })   // 越过边界：换命中元素
  ok(types().indexOf('pointerout') >= 0 && types().indexOf('pointerleave') >= 0 && types().indexOf('pointerover') >= 0,
    'E13-2 命中元素变化 → 补 out/leave（旧元素）+ over/enter（新元素）')

  // ② button 哨兵值：移动/悬停类必须是 -1（填 0 会让 GameMaker 一族认为左键一直按着）
  const mv = e.seen.filter((s) => s.type === 'mousemove').pop()
  eq(mv.button, -1, 'E13-3 mousemove.button = -1（W3C「无按键变化」哨兵）')
  const ov = e.seen.filter((s) => s.type === 'pointerover').pop()
  eq(ov.button, -1, 'E13-3 pointerover.button = -1')

  // ③ 按下/抬起/click 边缘合成：down/up 同一元素才发 click；重复 push 不重复发
  e.seen.length = 0
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 1 })
  ok(types().indexOf('pointerdown') >= 0 && types().indexOf('mousedown') >= 0, 'E13-4 按下 → pointerdown + mousedown')
  eq(e.seen.filter((s) => s.type === 'mousedown').pop().button, 0, 'E13-4 mousedown.button = 0（左键）')
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 1 })
  eq(types().filter((t) => t === 'mousedown').length, 1, 'E13-4 掩码未变 → 不重复派发 down（轮询推送不会变成连点）')
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 0 })
  ok(types().indexOf('pointerup') >= 0 && types().indexOf('click') >= 0, 'E13-4 抬起 → up + click（click 由边缘合成）')
  eq(e.seen.filter((s) => s.type === 'click').pop().buttons, 0, 'E13-4 click.buttons = 0')
  // 双击：同一元素 500ms 内第二次
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 1 })
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 0 })
  eq(e.seen.filter((s) => s.type === 'dblclick').length, 1, 'E13-4 两次快速点击 → dblclick')
  // 拖拽（down/up 命中不同元素）不发 click
  e.seen.length = 0
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 1 })
  e.send({ op: 'pointer', x: 10, y: 10, buttons: 1 })
  e.send({ op: 'pointer', x: 10, y: 10, buttons: 0 })
  eq(e.seen.filter((s) => s.type === 'click').length, 0, 'E13-4 拖拽（按下与抬起命中不同元素）不发 click')

  // ④ 非有限值 / 越界一律丢弃
  e.seen.length = 0
  e.send({ op: 'pointer', x: NaN, y: 10, buttons: 0 })
  eq(e.seen.length, 0, 'E13-5 NaN 坐标 → 不派发（否则作者位移积分一次性污染成 NaN）')
  e.send({ op: 'pointer', x: 'x', y: 10, buttons: 0 })
  eq(e.seen.length, 0, 'E13-5 非数值坐标 → 不派发')

  // ⑤ 滚轮：modern wheel 与 legacy mousewheel 两路都发；wheelDelta 与 deltaY 反号；空/NaN 丢弃
  e.seen.length = 0
  e.send({ op: 'pointer', x: 10, y: 10, buttons: 0 })
  e.seen.length = 0
  e.send({ op: 'wheel', x: 10, y: 10, dx: 0, dy: 120, mode: 0 })
  ok(types().indexOf('wheel') >= 0 && types().indexOf('mousewheel') >= 0, 'E13-6 滚轮两路都发（语料里多数作者只听 mousewheel）')
  const wh = e.seen.filter((s) => s.type === 'wheel').pop()
  const mw = e.seen.filter((s) => s.type === 'mousewheel').pop()
  eq(wh.deltaY, 120, 'E13-6 wheel.deltaY 原样（不做缩放换算）')
  eq(mw.wheelDelta, -144, 'E13-6 mousewheel.wheelDelta = -deltaY*1.2（与真实 Chromium 同号同量级）')
  eq(mw.button, -1, 'E13-6 滚轮不是按键变化 → button = -1')
  e.seen.length = 0
  e.send({ op: 'wheel', x: 10, y: 10, dx: 0, dy: 0, mode: 0 })
  eq(e.seen.length, 0, 'E13-6 零增量（惯性尾声）→ 不发')
  e.send({ op: 'wheel', x: 10, y: 10, dx: 0, dy: NaN, mode: 0 })
  eq(e.seen.length, 0, 'E13-6 NaN 增量 → 不发（不是静默变 0）')

  // ⑥ 离开/失焦：补 up（按下态复位）+ leave 链
  e.seen.length = 0
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 1 })
  e.send({ op: 'blur' })
  ok(types().indexOf('mouseup') >= 0 && types().indexOf('mouseleave') >= 0, 'E13-7 blur → 补一次 up + leave 链（作者的 hover/按下态不会永久卡住）')

  // ⑦ 键盘：keydown/keyup 到 activeElement；text 只在按下时给；mods 掩码
  e.doc.activeElement = e.canvas
  e.seen.length = 0
  e.send({ op: 'key', down: true, key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, mods: 0 })
  e.send({ op: 'key', down: false, key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, mods: 0 })
  e.send({ op: 'key', down: true, key: 'a', code: 'KeyA', keyCode: 65, mods: 0, text: 'a' })
  ok(types().indexOf('keydown') >= 0 && types().indexOf('keyup') >= 0, 'E13-8 键盘 → keydown/keyup 到 activeElement（canvdocument 上的监听器经冒泡也收到）')
  const kd = e.seen.filter((s) => s.type === 'keydown').pop()
  eq(kd.key, 'a', 'E13-8 字母键 key 透传')
  eq(e.seen.filter((s) => s.type === 'keydown')[0].ctrl, false, 'E13-8 无修饰键 → ctrlKey=false')
  e.send({ op: 'key', down: true, key: 'a', code: 'KeyA', keyCode: 65, mods: 1 })
  ok(e.seen.filter((s) => s.type === 'keydown').pop().ctrl === true, 'E13-8 修饰键掩码 bit0 → ctrlKey=true')
  e.send({ op: 'key', down: true, key: '', keyCode: 0 })
  eq(types().filter((t) => t === 'keydown').length, 3, 'E13-8 空 key → 不派发（不给作者垃圾事件）')

  // ⑧ 暂停期间一律丢弃（官方暂停语义 = 冻结渲染进程；注入事件会让作者状态在冻结中继续走）
  e.seen.length = 0
  e.send({ op: 'pause', value: true })
  e.send({ op: 'pointer', x: 30, y: 30, buttons: 0 })
  e.send({ op: 'wheel', x: 30, y: 30, dx: 0, dy: 100, mode: 0 })
  e.send({ op: 'key', down: true, key: 'a', keyCode: 65 })
  eq(e.seen.filter((s) => ['pointermove', 'mousemove', 'wheel', 'mousewheel', 'keydown'].indexOf(s.type) >= 0).length, 0, 'E13-9 暂停期间交互消息全部丢弃（冻结语义）')
  e.send({ op: 'pause', value: false })
  e.send({ op: 'pointer', x: 31, y: 31, buttons: 0 })
  ok(e.seen.some((s) => s.type === 'mousemove'), 'E13-9 恢复后照常注入')

  // ⑨ 交互开关：关闭时帧内主动清掉 hover/按下态（不会留残留）
  e.seen.length = 0
  e.send({ op: 'pointer', x: 10, y: 80, buttons: 1 })
  e.send({ op: 'interact', on: false })
  ok(types().indexOf('mouseleave') >= 0, 'E13-10 interact:false → 清理 hover/按下态')
  eq(e.send({ op: 'interact', on: true }), true, 'E13-10 interact:true 被接受（白名单内）')

  // ⑩ 来源校验：非父窗口不能注入事件
  e.seen.length = 0
  e.docEv.dispatch('message', { source: { evil: true }, data: { mpw: SHIM_MSG, op: 'pointer', x: 5, y: 5, buttons: 0 } })
  eq(e.seen.length, 0, 'E13-11 非父窗口来源的交互消息被丢弃（任意页面不能操纵壁纸交互）')
}

/* ══════════════════ F. 洁净度（无 GPL 代码 / 无跨仓硬路径） ══════════════════ */
console.log('\n== F. 洁净度：插件不含任何 GPL 代码/派生物 ==')
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const libFiles = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js'))
  const GPL_PROJECT_MARKERS = /wer-ref|lwe-ref|wallpaper-engine-renderer|open-wallpaper-engine|wallpaper-scene-renderer|linux-wallpaperengine|we-layerd/i
  // 注：GPL-3.0 是**渲染器**的许可，插件文档/注释里合法提及（协议边界说明）→ 这里只查 GPL-2.0（不可借的那类）与 GPL 许可全文
  const LICENSE_TEXT_MARKERS = /GNU General Public License|GNU Lesser General Public|Free Software Foundation|GPL-2\.0/i
  const codeHits = [], textHits = []
  for (const f of libFiles) {
    const raw = read('lib/' + f)
    const code = stripComments(raw)
    code.split('\n').forEach((line, i) => { if (GPL_PROJECT_MARKERS.test(line)) codeHits.push(f + ':' + (i + 1)) })
    raw.split('\n').forEach((line, i) => { if (LICENSE_TEXT_MARKERS.test(line)) textHits.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 70)) })
  }
  eq(codeHits.length, 0, 'F1 lib/** 代码里无 GPL-2.0-only 项目的派生标识符（注释剥离后 grep）' + (codeHits.length ? ' → ' + codeHits.join(', ') : ''))
  eq(textHits.length, 0, 'F1 lib/** 无 GPL 许可文本/版本标识（含注释）' + (textHits.length ? ' → ' + textHits.join(' | ') : ''))
  eq((read('LICENSE').split('\n')[0] || '').trim(), 'MIT License', 'F2 插件 LICENSE 首行仍为 MIT')
  eq(JSON.parse(read('package.json')).license, 'MIT', 'F2 package.json license = MIT')

  // 不 import/内嵌渲染器：lib/** 不得 import 出包外、代码里不得出现 GPL 侧仓库名
  const crossHits = []
  for (const f of libFiles) {
    const code = stripComments(read('lib/' + f))
    code.split('\n').forEach((line, i) => {
      if (/from\s+['"]\.\.\/|require\(\s*['"]\.\.\/|we-scene-demo|vendor-ref/.test(line)) crossHits.push('lib/' + f + ':' + (i + 1))
    })
  }
  eq(crossHits.length, 0, 'F3 lib/** 无跨仓硬路径依赖 / 不引用渲染器或研读副本' + (crossHits.length ? ' → ' + crossHits.join(', ') : ''))
  // 本测试自身也不许在运行时读外部仓库（基准一律按规格字面量自建，见 docs/COPYING-RULES.md §3.3）
  const self = read('tools/web-wallpaper-test.mjs')
  const absRoot = '/' + 'root/'
  ok(!/readFileSync\([^)]*(we-scene-demo|vendor-ref|DSHarea)/.test(self) && self.indexOf(absRoot) < 0, 'F3 测试不读渲染器/研读副本/绝对个人路径（基准自建）')
  const ww = read('lib/web-wallpaper.js')
  ok(/from 'node:(fs|path)'/.test(ww) && !/require\(/.test(ww), 'F3 web-wallpaper.js 只用 node 内置模块（宿主侧文件/字符串处理，不拉运行时依赖）')
  ok(read('lib/index.js').indexOf("from './web-wallpaper.js'") > 0, 'F3 宿主 index.js 从本仓模块引入（不复制粘贴一份实现）')
}


/* ══════════════════ G. 宿主路由端到端（真 index.js + 临时 DSH_HOME） ══════════════════ */
console.log('\n== G. 宿主路由端到端：真注入 / 无标记零回归 / CORS / 清单 / 内容优先扫描 ==')
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-wehome-'))
  const customRoot = path.join(home, 'custom')
  // ① 谎报 web 的场景包目录（内容优先 → scene）
  const liar = path.join(customRoot, 'liar-scene')
  fs.mkdirSync(liar, { recursive: true })
  fs.writeFileSync(path.join(liar, 'project.json'), JSON.stringify({ title: 'LIAR', general: { type: 'web' } }))
  fs.writeFileSync(path.join(liar, 'scene.pkg'), Buffer.from([0x50, 0x4b, 0x47, 0x56, 0, 0, 0, 0]))
  // ② 正常网页壁纸目录
  const web = path.join(customRoot, 'web-wall')
  fs.mkdirSync(path.join(web, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(web, 'project.json'), JSON.stringify({
    title: 'WEBWALL',
    general: { type: 'web', file: 'index.html', properties: { color: { type: 'color', value: '1 0 0' }, img: { type: 'file' } } },
  }))
  const authorHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><script src="assets/app.js"></script></head><body>hi</body></html>'
  fs.writeFileSync(path.join(web, 'index.html'), authorHtml)
  fs.writeFileSync(path.join(web, 'assets', 'app.js'), 'window.wallpaperPropertyListener={applyUserProperties:function(p){}};')
  fs.writeFileSync(path.join(web, 'shot.png'), Buffer.alloc(8, 1))
  // ③ 纯 mpkg 收藏夹（folderMpkg 分支）
  const coll = path.join(customRoot, 'coll')
  fs.mkdirSync(coll, { recursive: true })
  fs.writeFileSync(path.join(coll, 'a.mpkg'), Buffer.from([1]))
  fs.writeFileSync(path.join(coll, 'b.mpkg'), Buffer.from([2]))
  // 宿主设置的落点在临时 DSH_HOME 内（不碰真实用户目录）：直接写 custom-dir.json
  fs.mkdirSync(path.join(home, '.dsh-mpkg-wallpaper'), { recursive: true })
  fs.writeFileSync(path.join(home, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: customRoot }))
  process.env.DSH_HOME = home
  const { apply } = await import('../lib/index.js')
  const routes = []
  apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } })
  ok(routes.some((r) => r.kind === 'prefix' && r.path === '/api/mpkg-wallpaper/custom-folder'), 'G1 /custom-folder 前缀路由已注册（网页壁纸资源通道）')

  class Res extends Writable {
    constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
    _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
    writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
    get body() { return Buffer.concat(this.chunks) }
  }
  const call = async (pathName, { method = 'GET', origin, body } = {}) => {
    const route = routes.find((r) => (r.kind === 'prefix' && pathName.startsWith(r.path)) || (r.kind === 'exact' && pathName.split('?')[0] === r.path))
    if (!route) throw new Error('无该路由: ' + pathName)
    const res = new Res()
    const done = new Promise((resolve) => res.on('finish', resolve))
    const req = {
      method, url: pathName, headers: origin === undefined ? {} : { origin },
      [Symbol.asyncIterator]: async function* () { if (body != null) yield Buffer.from(body) },
      on(ev, cb) { if (ev === 'data' && body != null) cb(Buffer.from(body)); if (ev === 'end') cb() },
    }
    await route.handler(req, res)
    await Promise.race([done, new Promise((r) => setTimeout(r, 3000))])
    return { status: res.status, headers: res.headers, text: res.body.toString('utf8') }
  }

  const entry = '/api/mpkg-wallpaper/custom-folder/web-wall/index.html'
  const inj = await call(entry + '?mpwshim=1&mpwmute=1&mpwspeed=1&mpwpause=0', { origin: 'null' })
  eq(inj.status, 200, 'G2 入口（带 mpwshim=1）→ 200')
  ok(/text\/html/.test(inj.headers['content-type'] || ''), 'G2 content-type = text/html')
  ok(inj.headers['access-control-allow-origin'] === 'null', 'G2 Origin:null（沙箱帧）→ ACAO: null（帧内 fetch/子资源可用）')
  const shimAt = inj.text.indexOf('data-mpw-we-shim="1"')
  const seedAt = inj.text.indexOf('data-mpw-we-shim-seed')
  const authorAt = inj.text.indexOf('assets/app.js')
  ok(shimAt > 0 && seedAt > shimAt && authorAt > seedAt, 'G2 真响应里顺序 = shim → 种子 → 作者脚本')
  ok(/"entry":"index\.html"/.test(inj.text) && /"policy":\{"muted":true/.test(inj.text), 'G2 种子脚本带入口与策略（URL 上的 mpwmute 被采纳）')
  ok(inj.text.indexOf('__mpwWebShimInstalled') > 0 && inj.text.indexOf('wallpaperRegisterAudioListener') > 0, 'G2 注入的是真 shim（含 API 定义）')

  const plain = await call(entry)
  eq(plain.text, authorHtml, 'G3 无 mpwshim 标记 → 响应体与磁盘文件逐字节一致（旧 URL 零回归）')
  ok(plain.text.indexOf('data-mpw-we-shim') < 0, 'G3 无标记不注入')
  const evil = await call(entry + '?mpwshim=1', { origin: 'https://evil.example' })
  eq(evil.headers['access-control-allow-origin'], undefined, 'G4 真实站点 Origin → 无 ACAO（读不到本机壁纸文件）')
  ok(evil.text.indexOf('data-mpw-we-shim') > 0, 'G4 注入与来源无关（注入只看标记；CORS 才看来源）')

  const asset = await call('/api/mpkg-wallpaper/custom-folder/web-wall/assets/app.js', { origin: 'null' })
  eq(asset.status, 200, 'G4 子资源（作者脚本）可取')
  eq(asset.headers['access-control-allow-origin'], 'null', 'G4 子资源同样只对 Origin:null 放行')
  eq(asset.text, fs.readFileSync(path.join(web, 'assets', 'app.js'), 'utf8'), 'G4 子资源内容未被改写（只有 html 注入）')

  const list = await call('/api/mpkg-wallpaper/custom-folder/web-wall/__mpw-list.json')
  const lj = (() => { try { return JSON.parse(list.text) } catch { return {} } })()
  ok(lj.ok === true && Array.isArray(lj.files) && lj.files.indexOf('shot.png') >= 0 && lj.files.indexOf('assets/app.js') < 0, 'G5 __mpw-list.json = 壁纸目录内的媒体文件（slideshow 池；非媒体不进池）')

  const trav = await call('/api/mpkg-wallpaper/custom-folder/web-wall/..%2F..%2Fetc%2Fpasswd')
  ok(trav.status === 403 || trav.status === 404, 'G6 目录穿越被拒（status=' + trav.status + '）')

  const scan = await call('/api/mpkg-wallpaper/custom-dir', { method: 'POST', body: JSON.stringify({ dir: customRoot }) })
  const scanJson = (() => { try { return JSON.parse(scan.text) } catch { return {} } })()
  eq(scan.status, 200, 'G7 /custom-dir 扫描 200')
  const byName = {}
  for (const f of (scanJson.files || [])) byName[f.name] = f
  eq((byName['liar-scene'] || {}).type, 'scene', 'G7 谎报 web 但含 scene.pkg → 扫描结果按 scene（内容优先，端到端）')
  eq((byName['liar-scene'] || {}).declaredType, 'web', 'G7 原始声明 web 仍随条目返回（诊断用）')
  eq((byName['web-wall'] || {}).type, 'web', 'G7 真网页壁纸 → web')
  eq((byName['web-wall'] || {}).media, 'index.html', 'G7 入口 = index.html')
  const collRows = (scanJson.files || []).filter((f) => f.name === 'coll')
  eq(collRows.length, 2, 'G7 纯 .mpkg 收藏夹 → 2 条 folderMpkg（旧行为保留）')
  ok(collRows.every((r) => r.folderMpkg === true), 'G7 folderMpkg 标记在位')
  try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)

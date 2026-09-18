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
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Writable } from 'node:stream'
import { loadPlugin } from './_stub.mjs'
import {
  WEB_KIND, SHIM_ATTR, SHIM_QUERY_KEY, SHIM_MSG, SHIM_VERSION, SHIM_API_NAMES, SHIM_CONTROL_OPS,
  WEB_SANDBOX_ATTR, WEB_SANDBOX_COMPAT_ATTR, WEB_SHIM_REFERENCE, WEB_SHIM_SOURCE,
  detectWebWallpaperKind, detectWallpaperDir, declaredTypeOf, declaredFileOf,
  isShimRequest, webPolicyFromQuery, buildSeedScript, rewriteWebEntryHtml, webAssetCorsHeaders,
  listWallpaperFiles, readProjectJson,
  // ①(WP-1) 存储 facade / 宿主音量 / CSP / 源级改写
  WEB_STORE_ROUTE, WEB_STORE_QUERY_KEY, WEB_STORE_MAX_VALUE, WEB_STORE_MAX_KEYS, WEB_STORE_MAX_BYTES,
  MEDIA_AUDIO_ROUTE, MEDIA_AUDIO_DEFAULTS, normalizeMediaAudio, mediaAudioReport, mediaAudioPatchForEntry,
  hasBlockingCsp, rewriteWebFileUrlsInHtml, webStoreFromQuery, sanitizeWebStore, webWallId, fileUrlToPath,
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
  // ①(WP-1) 调用点追加了 wallKey 实参（存储隔离键）⇒ 正则只锚定"统一分发"这件事本身
  ok(/serveWebAsset\(req, res, join\(customDir, folder\), file, 'custom'/.test(host), 'C8 /custom-folder 走统一的注入资源分发')
  ok(/serveWebAsset\(req, res, rec\.dir, file, 'library'/.test(host), 'C8 /library-web 走统一的注入资源分发')
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
  // ①(WP-1) **照抄**的登记：台账里必须逐行写下出处，且文档/包内声明都要能查到
  //   （照抄是允许的，但"登记"必须是机器可核对的，不能只写在提交信息里）
  ok(Array.isArray(WEB_SHIM_REFERENCE.copied) && WEB_SHIM_REFERENCE.copied.length >= 1, 'D3 台账登记了照抄项（copied 非空）')
  ok(WEB_SHIM_REFERENCE.notCovered.length >= 4, 'D4 差异清单列出 ≥4 项「参考有、本实现有意不做」')
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
  for (const c of WEB_SHIM_REFERENCE.copied) {
    ok(/^renderer\/src\/[\w.-]+\.(ts|js):\d+-\d+$/.test(String(c.from || '')), 'D3 照抄出处是「文件:起-止行」形态：' + c.from)
    ok(!!c.what, 'D3 照抄项写明是什么：' + c.from)
    ok(doc.indexOf(c.from) >= 0, 'D5 文档写明照抄出处：' + c.from)
    let tp = ''
    try { tp = read('THIRD-PARTY.md') } catch {}
    ok(tp.indexOf(c.from) >= 0 && /照抄/.test(tp), 'D5 THIRD-PARTY.md 有该照抄项的登记与「照抄」字样：' + c.from)
  }
}

/* ══════════════════ E. shim 运行时（vm + 假 DOM） ══════════════════ */
console.log('\n== E. shim 运行时：属性重放 / 音频 / 媒体 / 文件池 / 策略 / 抛错兜底 ==')
function makeShimEnv(seed, opts = {}) {
  const posted = []
  const media = []
  const fetchCalls = []
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
  // ①(WP-1) 帧内媒体要带 **volume/muted 原型访问器**：主音量钩子挂的是 `HTMLMediaElement.prototype.volume`，
  //   没有真描述符时钩子会正确地"不装"——那样就测不到"作者值 × 主音量"的合成了（假绿的反面：假红）。
  class FakeMedia {
    constructor(tag) { this.tagName = tag; this.paused = false; this.__muted = false; this.playbackRate = 1; this.plays = 0; this.pauses = 0; this.__volume = 1 }
    play() { this.paused = false; this.plays++; return Promise.resolve() }
    pause() { this.paused = true; this.pauses++ }
  }
  Object.defineProperty(FakeMedia.prototype, 'muted', {
    configurable: true, enumerable: true,
    get() { return !!this.__muted }, set(v) { this.__muted = !!v },
  })
  Object.defineProperty(FakeMedia.prototype, 'volume', {
    configurable: true, enumerable: true,
    get() { return this.__volume }, set(v) { this.__volume = Number(v) },
  })
  class FakeAudio extends FakeMedia { constructor(src) { super('AUDIO'); this.src = src } }
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
    HTMLImageElement: class extends FakeElement {}, HTMLMediaElement: FakeMedia,
    HTMLSourceElement: class extends FakeElement {}, HTMLScriptElement: class extends FakeElement {},
    Audio: FakeAudio,   // ①(WP-1) `new Audio()`（不进 DOM）也要被主音量覆盖
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (f) => setTimeout(() => f(Date.now()), 0), cancelAnimationFrame: () => {},
    // ①(WP-1) 帧内存储/音量测试需要：DOMException（配额异常名）、WeakRef（活实例登记）、fetch 探针
    DOMException: class DOMException extends Error { constructor(msg, name) { super(msg); this.name = name || 'Error' } },
    WeakRef,
    fetch: (url, init) => { fetchCalls.push({ url, init }); return Promise.resolve({ ok: true }) },
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.parent = parent
  sandbox.addEventListener = winEv.addEventListener
  sandbox.removeEventListener = () => {}
  // ①(WP-1) 不透明源下的真 localStorage：**访问即抛** SecurityError（Chrome 行为）。
  //   `opts.storageWorks: true` 用来做负面对照：真 storage 可用时 shim **不得**接管。
  const fakeRealStore = {
    data: Object.create(null),
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, String(k)) ? this.data[String(k)] : null },
    setItem(k, v) { this.data[String(k)] = String(v) },
    removeItem(k) { delete this.data[String(k)] },
    clear() { this.data = Object.create(null) },
    key(i) { return Object.keys(this.data)[Number(i) || 0] ?? null },
    get length() { return Object.keys(this.data).length },
  }
  if (opts.storageWorks) sandbox.localStorage = fakeRealStore
  else Object.defineProperty(sandbox, 'localStorage', { configurable: true, get() { throw new sandbox.DOMException('Access is denied for this document.', 'SecurityError') } })
  // 宿主注入的种子脚本（window.__mpwWebSeed）——必须在 shim 之前写入，模拟 HTML 里的注入顺序
  if (seed) sandbox.__mpwWebSeed = seed
  const ctx = vm.createContext(sandbox)
  // ①(WP-1) `skipShim`：H0 要在 shim 装 facade **之前**看夹具本身（否则观测到的是 facade）
  if (!opts.skipShim) vm.runInContext(WEB_SHIM_SOURCE, ctx, { filename: 'mpw-we-shim.js' })
  return { sandbox, ctx, posted, media, parent, winEv, docEv, FakeElement, FakeMedia, FakeAudio, docEl, fetchCalls, fakeRealStore }
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

/* ══════════════════ H. ①(WP-1) 帧内存储 facade ══════════════════ */
console.log('\n== H. ①(WP-1) 帧内存储：不透明源下 localStorage 会抛 SecurityError ⇒ facade + 宿主持久化 ==')
{
  // H0 前置事实：不透明源（沙箱帧）里 `window.localStorage` **访问即抛**（我们的假 DOM 照此建模）
  const broken = makeShimEnv(null, { skipShim: true })
  let threw = null
  try { void broken.sandbox.localStorage } catch (e) { threw = e }
  ok(!!threw && threw.name === 'SecurityError', 'H0 夹具成立：不透明源下真 localStorage 访问抛 SecurityError（Chrome 行为）')

  // H1 装了 facade：读写不抛、内存权威、快照从种子回灌
  const env = makeShimEnv({ v: SHIM_VERSION, entry: 'index.html', policy: { muted: true, speed: 1, paused: false }, wall: 'w1abc', store: { id: 'w1abc', url: WEB_STORE_ROUTE, persist: true, snap: { theme: 'dark' } } })
  const { sandbox } = env
  ok(!!sandbox.__mpwWebStore && sandbox.__mpwWebStore.installed === true, 'H1 不透明源 ⇒ 装 facade（localStorage 不再抛）')
  eq(sandbox.localStorage.getItem('theme'), 'dark', 'H1 宿主已存快照回灌到帧内（刷新后作者设置还在）')
  eq(sandbox.localStorage.getItem('nope'), null, 'H1 未存的键 → null（与真 Storage 同形）')
  sandbox.localStorage.setItem('theme', 'light')
  eq(sandbox.localStorage.getItem('theme'), 'light', 'H1 setItem 立即生效（同步内存语义）')
  eq(sandbox.localStorage.length, 1, 'H1 length 反映键数')
  eq(sandbox.localStorage.key(0), 'theme', 'H1 key(i) 可取键名')
  sandbox.localStorage.removeItem('theme')
  eq(sandbox.localStorage.getItem('theme'), null, 'H1 removeItem 生效')

  // H2 属性写法（真 Storage 支持 `store.foo = '1'`，语料里有作者这么用）
  sandbox.localStorage.foo = 'bar'
  eq(sandbox.localStorage.getItem('foo'), 'bar', 'H2 属性写法 store.foo=… 等价 setItem（Proxy 对齐真 Storage）')
  eq(sandbox.localStorage.foo, 'bar', 'H2 读属性写法也返回同一值')

  // H3 持久化：写回宿主 /web-store（text/plain = CORS 简单请求，不透明源下不触发 preflight）
  sandbox.localStorage.setItem('vol', '0.4')
  sandbox.__mpwWebStore.flush()
  const post = env.fetchCalls.filter((c) => c.init && c.init.method === 'POST')
  ok(post.length >= 1, 'H3 写入排进宿主回写通道（fetch 被调用）')
  const last = JSON.parse(String(post[post.length - 1].init.body))
  eq(last.w, 'w1abc', 'H3 回写带壁纸隔离键 wallId')
  ok(last.k === 'vol' && last.v === '0.4', 'H3 回写带键值')
  ok(/text\/plain/.test(String(post[post.length - 1].init.headers['content-type'])), 'H3 用 text/plain（不触发 preflight —— 不透明源下 preflight 会失败）')
  sandbox.localStorage.removeItem('foo')
  sandbox.__mpwWebStore.flush()
  const del = JSON.parse(String(env.fetchCalls.filter((c) => c.init && c.init.method === 'POST').pop().init.body))
  eq(del.del, 'foo', 'H3 删除也回写（del 键）')

  // H4 配额：与宿主同一套上限，超限抛 QuotaExceededError（与真 Storage 同形，作者按名字捕获）
  let quota = null
  try { sandbox.localStorage.setItem('big', 'x'.repeat(WEB_STORE_MAX_VALUE + 10)) } catch (e) { quota = e }
  ok(!!quota && quota.name === 'QuotaExceededError', 'H4 单值超限抛 QuotaExceededError（不静默吞数据）')
  eq(sandbox.localStorage.getItem('big'), null, 'H4 超限写入不落内存（不写半截值）')

  // H5 显式关闭（?mpwstore=0 ⇒ seed.store=false）：**不装 facade** ⇒ 行为回到改动前（访问照旧抛）
  const off = makeShimEnv({ v: SHIM_VERSION, entry: 'index.html', policy: { muted: true, speed: 1, paused: false }, store: false })
  eq((off.sandbox.__mpwWebStore || {}).installed, false, 'H5 store:false ⇒ facade 未安装（负面对照）')
  let offThrew = null
  try { void off.sandbox.localStorage } catch (e) { offThrew = e }
  ok(!!offThrew && offThrew.name === 'SecurityError', 'H5 关掉时逐字节回旧行为：真 localStorage 照旧抛（不越权接管）')

  // H6 真 storage 可用（同源测试台/将来的兼容路径）⇒ 一个字节都不动
  const realEnv = makeShimEnv(null, { storageWorks: true })
  eq((realEnv.sandbox.__mpwWebStore || {}).installed, false, 'H6 真 localStorage 可用 ⇒ 不接管（最小干预）')
  realEnv.sandbox.localStorage.setItem('k', 'v')
  eq(realEnv.fakeRealStore.getItem('k'), 'v', 'H6 作者写的还是浏览器真 storage（我们没插一层影子）')

  // H7 没有种子（旧宿主/直接打开页面）：仍给内存 facade —— "抛 SecurityError"是白屏真因，不能留着
  const noSeed = makeShimEnv()
  ok(!!noSeed.sandbox.__mpwWebStore && noSeed.sandbox.__mpwWebStore.installed === true, 'H7 无种子也装内存 facade（没有回写通道 ⇒ persist=false）')
  eq(noSeed.sandbox.__mpwWebStore.persist, false, 'H7 无种子时不假装有持久化')
  noSeed.sandbox.localStorage.setItem('a', 'b')
  eq(noSeed.fetchCalls.length, 0, 'H7 无回写通道 ⇒ 一个网络请求都不发')
}

/* ══════════════════ I. ①(WP-1) 主音量（宿主音量 × 作者音量）══════════════════ */
console.log('\n== I. ①(WP-1) 主音量：宿主显式给音量才接管；默认路径一个字段都不动 ==')
{
  // I1 默认（种子里没有 volume）⇒ 钩子不装、元素 volume 不被写（旧行为逐字节）
  const def = makeShimEnv({ v: SHIM_VERSION, entry: 'index.html', policy: { muted: true, speed: 1, paused: false } })
  const dv = new def.FakeMedia('VIDEO')
  def.media.push(dv)
  def.sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', muted: true, speed: 1 })
  eq(def.sandbox.__mpwWebAudio.hooked(), false, 'I1 默认档：主音量钩子**不装**（不接管作者音量）')
  eq(dv.volume, 1, 'I1 默认档：元素 volume 一个字节都没被改写')

  // I2 宿主给了音量（种子 policy.volume=0.5）⇒ 作者 0.5 × 宿主 0.5 = 0.25
  const env = makeShimEnv({ v: SHIM_VERSION, entry: 'index.html', policy: { muted: false, speed: 1, paused: false, volume: 0.5 } })
  const v = new env.FakeMedia('VIDEO')
  env.media.push(v)
  ok(env.sandbox.__mpwWebAudio.hooked() === true && env.sandbox.__mpwWebAudio.master() === 0.5, 'I2 种子里有 volume ⇒ 钩子装上且主音量=0.5')
  v.volume = 0.5
  eq(v.volume, 0.5, 'I2 作者读回自己的音量（不被主音量污染 —— 否则作者会把自己的值越写越小）')
  eq(v.__volume, 0.25, 'I2 实际生效音量 = 作者值 × 宿主音量（官方 CEF 口径）')
  // 宿主改音量（父页 op:policy 带 volume）→ 活实例立刻刷新
  env.sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', volume: 0 })
  eq(v.__volume, 0, 'I2 宿主把主音量调到 0 ⇒ 实际音量 0')
  env.sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', volume: 1 })
  eq(v.__volume, 0.5, 'I2 宿主调回 1 ⇒ 回落成作者值 0.5')
  eq(v.muted, false, 'I2 未静音策略下作者的元素不被静音（muted 语义未变）')

  // I3 `new Audio()` 不进 DOM：包构造器登记活实例，主音量变化也要覆盖到
  const a = new env.sandbox.Audio('bgm.mp3')   // 走 shim 包的构造器（模拟作者 `new Audio()`）
  a.volume = 1
  env.sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', volume: 0.25 })
  eq(a.volume, 1, 'I3 new Audio() 的作者音量读回仍是 1')
  eq(a.__volume, 0.25, 'I3 new Audio()（不进 DOM）也被主音量覆盖')

  // I4 静音语义不变：作者主动 muted 的元素不因"宿主音量>0"被解开
  const own = new env.FakeMedia('AUDIO')
  own.muted = true
  env.media.push(own)
  env.sandbox.__mpwWebControl({ mpw: SHIM_MSG, op: 'policy', muted: false, volume: 1 })
  eq(own.muted, true, 'I4 作者自己静音的元素保持静音（不越权）')

  // I5 宿主侧音频状态：默认仍静音（用户第 6 项的硬要求）+ 语义归一
  const rep0 = mediaAudioReport(MEDIA_AUDIO_DEFAULTS)
  ok(rep0.muted === true && rep0.audible === false, 'I5 宿主默认档：muted=true ⇒ audible=false（默认仍静音）')
  eq(mediaAudioPatchForEntry(MEDIA_AUDIO_DEFAULTS), null, 'I5 默认档不下发音量给网页壁纸帧（种子里连 volume 键都不出现）')
  const on = normalizeMediaAudio({ muted: false, volume: 0.4 }, MEDIA_AUDIO_DEFAULTS)
  ok(on.explicit === true && mediaAudioReport(on).audible === true, 'I5 显式打开 ⇒ audible=true（主机/UI 调 setMuted(false) 的等价路径）')
  eq(mediaAudioReport(normalizeMediaAudio({ pause: true }, on)).audible, false, 'I5 pause() ⇒ audible=false')
  eq(mediaAudioReport(normalizeMediaAudio({ volume: 0 }, on)).audible, false, 'I5 volume=0 ⇒ audible=false（音量 0 不算有声）')
  eq(normalizeMediaAudio({ volume: 9 }, on).volume, 1, 'I5 volume 夹到 [0,1]（不把 9 塞进播放器）')
  eq(normalizeMediaAudio({ volume: -3 }, on).volume, 0, 'I5 负值夹到 0')
  const reset = normalizeMediaAudio({ reset: true }, on)
  ok(reset.muted === true && reset.explicit === false && mediaAudioReport(reset).audible === false, 'I5 reset ⇒ 回默认档（muted=true / explicit=false）')
  eq(mediaAudioReport(normalizeMediaAudio({ hasAudio: true }, on)).hasAudio, true, 'I5 hasAudio 可由客户端上报（宿主如实回报）')
  eq(mediaAudioPatchForEntry(on).volume, 0.4, 'I5 显式档下发给帧的音量 = 0.4')
}

/* ══════════════════ J. ①(WP-1) CSP 判定与 HTML 源级改写（宿主纯函数）══════════════════ */
console.log('\n== J. ①(WP-1) CSP 阻塞判定（照抄上游）+ HTML 源级 file:/// 改写 ==')
{
  ok(hasBlockingCsp('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'">') === true, 'J1 script-src 无 unsafe-inline ⇒ 挡 inline shim（判定 true）')
  ok(hasBlockingCsp("<meta http-equiv='Content-Security-Policy' content=\"script-src 'self'\">") === true, 'J1 单引号属性写法也认（上游同款正则）')
  ok(hasBlockingCsp('<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\'">') === false, 'J1 unsafe-inline ⇒ 不挡（判定 false）')
  ok(hasBlockingCsp('<meta http-equiv="Content-Security-Policy" content="script-src *">') === false, 'J1 通配 * ⇒ 不挡')
  ok(hasBlockingCsp('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">') === false, 'J1 没有 script-src 指令 ⇒ 不判（保守，不误伤可注入页面）')
  ok(hasBlockingCsp('<html><head><meta charset="utf-8"></head></html>') === false, 'J1 无 CSP 页面 ⇒ false')

  const rw = rewriteWebFileUrlsInHtml('<img src="file:///files/a b.png"><a href=\'file:///x/y.htm\'>x</a><video poster="file:///p.jpg"></video><div style="background:url(file:///img/c.png)"></div><img src="https://cdn.example/d.png">', { basePath: '/api/mpkg-wallpaper/custom-folder/W1/' })
  ok(rw.count === 4, 'J2 改了 4 处（src/href/poster/url()），非 file: 的 https 不动（count=' + rw.count + '）')
  ok(rw.html.indexOf('src="/api/mpkg-wallpaper/custom-folder/W1/files/a%20b.png"') > 0, 'J2 空格被编码（不产生坏 URL）')
  ok(rw.html.indexOf("href='/api/mpkg-wallpaper/custom-folder/W1/x/y.htm'") > 0, 'J2 保留原引号风格')
  ok(rw.html.indexOf('url(/api/mpkg-wallpaper/custom-folder/W1/img/c.png)') > 0, 'J2 style 里的 url(file:///…) 也改写')
  ok(rw.html.indexOf('https://cdn.example/d.png') > 0, 'J2 非 file: URL 原样')
  const abs = rewriteWebFileUrlsInHtml('<img src="file:///Users/me/a.png"><img src="file:///C:/x/b.png"><img src="file:///">')
  eq(abs.count, 0, 'J2 绝对系统路径/盘符/空 file:/// 一律不改（映射不了就不猜）')
  const noScript = rewriteWebFileUrlsInHtml('<script>var p="file:///files/a.png";</script>')
  eq(noScript.count, 0, 'J2 **不碰 script 文本**（作者写 `\'file:///\'+v` 的合成由 shim 运行时钩子负责，源级乱改会破坏作者逻辑）')
  const none = rewriteWebFileUrlsInHtml('<img src="a.png">')
  ok(none.count === 0 && none.html === '<img src="a.png">', 'J2 无 file: ⇒ 逐字节原样（零回归）')

  ok(webStoreFromQuery('/x/index.html?mpwshim=1').on === true && webStoreFromQuery('/x/index.html?mpwshim=1').persist === true, 'J3 ?mpwshim=1 ⇒ 存储 facade 默认开 + 持久化')
  ok(webStoreFromQuery('/x/index.html?mpwshim=1&mpwstore=0').on === false, 'J3 ?mpwstore=0 ⇒ 关（负面对照入口）')
  ok(webStoreFromQuery('/x/index.html?mpwshim=1&mpwstore=mem').on === true && webStoreFromQuery('/x/index.html?mpwshim=1&mpwstore=mem').persist === false, 'J3 ?mpwstore=mem ⇒ 只内存不落盘')
  ok(webStoreFromQuery('/x/index.html').on === false, 'J3 无 mpwshim ⇒ 不涉及（旧 URL 零回归）')
  ok(webPolicyFromQuery('/x/index.html?mpwshim=1').volume === undefined, 'J3 默认策略里**没有** volume 键（默认路径对象形状逐字节不变）')
  eq(webPolicyFromQuery('/x/index.html?mpwshim=1&mpwvol=0.3').volume, 0.3, 'J3 URL 显式给 mpwvol 才出现 volume 键')
  // 种子：不传 extras ⇒ 与改动前逐字节一致（硬编码参考串）
  eq(buildSeedScript({ muted: true, speed: 1, paused: false }, 'index.html'),
    'window.__mpwWebSeed={"v":1,"entry":"index.html","policy":{"muted":true,"speed":1,"paused":false}};',
    'J3 默认种子脚本与改动前**逐字节一致**（关掉新能力 = 旧行为）')
  const seeded = buildSeedScript({ muted: true, speed: 1, paused: false }, 'index.html', { wall: 'abc123', store: { id: 'abc123', url: WEB_STORE_ROUTE, persist: true, snap: {} } })
  ok(/"wall":"abc123"/.test(seeded) && /"url":"\/api\/mpkg-wallpaper\/web-store"/.test(seeded), 'J3 extras 才追加 wall/store（含回写 URL）')
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

  /* ══════════════ K. ①(WP-1) 宿主媒体音频控制 + 帧内存储路由（端到端）══════════════ */
  console.log('  -- K. ①(WP-1) /media-audio（用户第 6 项）+ /web-store（存储 facade 落点）')
  const parse = (r) => { try { return JSON.parse(r.text) } catch { return {} } }
  const audioUrl = '/api/mpkg-wallpaper/media-audio'

  // K1 默认档：**默认仍静音**（用户第 6 项硬要求）
  const a0 = parse(await call(audioUrl))
  ok(a0.ok === true && a0.muted === true && a0.volume === 1 && a0.playing === true, 'K1 默认档 muted=true / volume=1 / playing=true')
  eq(a0.audible, false, 'K1 默认档 audible=false（**默认仍静音**，除非宿主显式打开）')
  eq(a0.explicit, false, 'K1 默认档 explicit=false（宿主没接管音频）')

  // K2 setMuted(false)：宿主显式打开 ⇒ 有声
  const a1 = parse(await call(audioUrl, { method: 'POST', body: JSON.stringify({ muted: false }) }))
  ok(a1.muted === false && a1.audible === true && a1.explicit === true, 'K2 setMuted(false) ⇒ muted=false / audible=true / explicit=true')

  // K3 setMediaVolume(v)：夹取 + 音量 0 不算有声
  const a2 = parse(await call(audioUrl, { method: 'POST', body: JSON.stringify({ volume: 0 }) }))
  ok(a2.volume === 0 && a2.audible === false, 'K3 setMediaVolume(0) ⇒ audible=false（音量 0 不算有声）')
  const a3 = parse(await call(audioUrl, { method: 'POST', body: JSON.stringify({ volume: 7 }) }))
  ok(a3.volume === 1 && a3.audible === true, 'K3 setMediaVolume(7) ⇒ 夹到 1（不把 7 塞进播放器）')

  // K4 pause()/play()：播放控制
  const a4 = parse(await call(audioUrl, { method: 'POST', body: JSON.stringify({ pause: true }) }))
  ok(a4.playing === false && a4.audible === false, 'K4 pause() ⇒ playing=false / audible=false')
  const a5 = parse(await call(audioUrl, { method: 'POST', body: JSON.stringify({ play: true }) }))
  ok(a5.playing === true && a5.audible === true, 'K4 play() ⇒ playing=true / audible=true')

  // K5 宿主是权威且可落盘复核（UI 线可直接读这个文件/接口，不需要我们做 UI）
  const audioFile = path.join(home, '.dsh-mpkg-wallpaper', 'media-audio.json')
  const persisted = (() => { try { return JSON.parse(fs.readFileSync(audioFile, 'utf8')) } catch { return {} } })()
  ok(persisted.muted === false && persisted.volume === 1 && persisted.playing === true, 'K5 状态落盘（重启后宿主口径不变；文件 = DATA_DIR/media-audio.json）')

  // K6 宿主显式接管 ⇒ 网页壁纸帧的种子带 muted/volume（音频交给宿主）
  const injAudio = await call(entry + '?mpwshim=1&mpwmute=1&mpwspeed=1&mpwpause=0', { origin: 'null' })
  ok(/"muted":false/.test(injAudio.text) && /"volume":1/.test(injAudio.text), 'K6 宿主接管后种子下发 muted/volume（帧内按宿主音量合成）')

  // K7 回默认档 ⇒ 种子里**不出现** volume（负面对照：默认路径逐字节回旧行为）
  const back = parse(await call(audioUrl, { method: 'POST', body: JSON.stringify({ reset: true }) }))
  eq(back.audible, false, 'K7 reset ⇒ 回默认档（audible=false）')
  const injDefault = await call(entry + '?mpwshim=1&mpwmute=1&mpwspeed=1&mpwpause=0', { origin: 'null' })
  // 注意：断言必须只看**种子 JSON**——注入体里还有整份 shim 源码，它自己就含 "volume" 字样
  const seedJson = (/window\.__mpwWebSeed=(\{.*?\});/.exec(injDefault.text) || [])[1] || ''
  ok(seedJson && seedJson.indexOf('"volume"') < 0, 'K7 默认档种子里没有 volume 键（关掉时零回归）')
  ok(/"policy":\{"muted":true,"speed":1,"paused":false\}/.test(seedJson), 'K7 默认档 policy 形状与改动前一致')

  // K8 存储路由：写入 / 读回 / 壁纸间隔离 / 非法键 / 超大值 / CORS
  const storeUrl = '/api/mpkg-wallpaper/web-store'
  const s1 = parse(await call(storeUrl, { method: 'POST', origin: 'null', body: JSON.stringify({ w: 'wallA', k: 'theme', v: 'dark' }) }))
  ok(s1.ok === true, 'K8 /web-store 写入 ok')
  const s2 = parse(await call(storeUrl + '?w=wallA', { origin: 'null' }))
  eq((s2.store || {}).theme, 'dark', 'K8 读回同一壁纸的键')
  const s3 = parse(await call(storeUrl + '?w=wallB'))
  eq(Object.keys(s3.store || {}).length, 0, 'K8 壁纸间隔离（不同 wallId 互不可见）')
  const s4 = await call(storeUrl, { method: 'POST', body: JSON.stringify({ w: '../etc', k: 'x', v: 'y' }) })
  eq(s4.status, 400, 'K8 非法 wallId ⇒ 400（存储键不许带路径/穿越）')
  const s5 = parse(await call(storeUrl, { method: 'POST', body: JSON.stringify({ w: 'wallA', k: 'big', v: 'x'.repeat(WEB_STORE_MAX_VALUE + 1) }) }))
  ok(s5.ok === false && s5.error === 'too large', 'K8 单值超限被拒（不落半截值）')
  const s6 = await call(storeUrl + '?w=wallA', { origin: 'null' })
  eq(s6.headers['access-control-allow-origin'], 'null', 'K8 Origin:null（沙箱帧）⇒ ACAO: null（帧内 facade 才写得进）')
  const s7 = await call(storeUrl, { method: 'OPTIONS', origin: 'null' })
  eq(s7.status, 204, 'K8 OPTIONS ⇒ 204（预检兜底；实际请求用 text/plain 不触发预检）')
  // 落盘是 debounce 的（防止作者每帧写 localStorage 时打爆磁盘）⇒ 这里等一个节拍再看文件
  await new Promise((r) => setTimeout(r, 600))
  const storeFile = path.join(home, '.dsh-mpkg-wallpaper', 'web-store.json')
  const storeOnDisk = (() => { try { return JSON.parse(fs.readFileSync(storeFile, 'utf8')) } catch { return null } })()
  ok(!!storeOnDisk && ((storeOnDisk.wallA || {}).store || {}).theme === 'dark', 'K8 存储落盘在 DATA_DIR（debounce 后仍会写；重启后仍在）')

  // K9 已存快照进种子：帧内 facade 首帧就能读到（作者设置面板刷新不丢）
  const wallId = webWallId('custom', 'web-wall', 'index.html')
  await call(storeUrl, { method: 'POST', origin: 'null', body: JSON.stringify({ w: wallId, k: 'scale', v: '1.5' }) })
  const injStore = await call(entry + '?mpwshim=1&mpwmute=1&mpwspeed=1&mpwpause=0', { origin: 'null' })
  ok(injStore.text.indexOf('"scale":"1.5"') > 0 && injStore.text.indexOf('"wall":"' + wallId + '"') > 0, 'K9 已存键进种子（帧内 localStorage.getItem 首帧即命中）')

  // K10 ?mpwstore=0：不装 facade + 种子与旧版的差异**只有** store:false 一个字段
  const injOff = await call(entry + '?mpwshim=1&mpwstore=0', { origin: 'null' })
  ok(/"store":false/.test(injOff.text), 'K10 ?mpwstore=0 ⇒ 种子里显式 store:false（关掉存储 facade）')
  ok(injOff.text.indexOf('"wall"') < 0, 'K10 关掉时不带 wall（不泄露存储隔离键）')
  const legacySeed = buildSeedScript({ muted: true, speed: 1, paused: false }, 'index.html')
  const offSeed = (/window\.__mpwWebSeed=(\{.*?\});/.exec(injOff.text) || [])[1] || ''
  eq(offSeed.replace(',"store":false', ''), legacySeed.replace(/^window\.__mpwWebSeed=/, '').replace(/;$/, ''), 'K10 关掉时的种子 = 旧种子字面量 + 唯一一个 store:false（最小差异，可机器核对）')

  // K11 CSP：自带 CSP 挡 inline script 的入口 ⇒ 不注入、原样返回 + x-mpw-shim-skipped:csp 留痕
  const cspDir = path.join(customRoot, 'web-csp')
  fs.mkdirSync(cspDir, { recursive: true })
  const cspHtml = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><script src="app.js"></script></head><body>csp</body></html>'
  fs.writeFileSync(path.join(cspDir, 'index.html'), cspHtml)
  const cspRes = await call('/api/mpkg-wallpaper/custom-folder/web-csp/index.html?mpwshim=1', { origin: 'null' })
  eq(cspRes.text, cspHtml, 'K11 CSP 页面响应体与磁盘逐字节一致（不注入必被拒的 inline shim）')
  eq(cspRes.headers['x-mpw-shim-skipped'], 'csp', 'K11 留痕 x-mpw-shim-skipped: csp（诊断可判"为什么没有 shim"）')

  // K12 HTML 里写死的 file:///：源级改写（运行时钩子够不到的形态）
  const srcDir = path.join(customRoot, 'web-src')
  fs.mkdirSync(srcDir, { recursive: true })
  const srcHtml = '<!DOCTYPE html><html><head><script src="app.js"></script></head><body><img src="file:///files/a.png" style="background:url(file:///img/b.png)"></body></html>'
  fs.writeFileSync(path.join(srcDir, 'index.html'), srcHtml)
  const srcRes = await call('/api/mpkg-wallpaper/custom-folder/web-src/index.html?mpwshim=1', { origin: 'null' })
  ok(srcRes.text.indexOf('src="/api/mpkg-wallpaper/custom-folder/web-src/files/a.png"') > 0, 'K12 源级改写：HTML 属性里的 file:/// → 同源路径（解析器产出的属性也覆盖到）')
  ok(srcRes.text.indexOf('url(/api/mpkg-wallpaper/custom-folder/web-src/img/b.png)') > 0, 'K12 源级改写：style 里的 url(file:///…) 也改')
  const srcPlain = await call('/api/mpkg-wallpaper/custom-folder/web-src/index.html')
  eq(srcPlain.text, srcHtml, 'K12 无 mpwshim 标记 ⇒ 一个字节都不改（源级改写只在注入路径上）')

  try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
}

/* ══════════════════ L. ①(WP-1) 真语料计数（决定"我们必须实现哪些 API"）══════════════════ */
console.log('\n== L. ①(WP-1) 真语料：web 类壁纸的 WE API 计数 + 文档表同步 + sha256 ==')
const CORPUS_APIS = [
  ...SHIM_API_NAMES,
  'applyUserProperties', 'applyGeneralProperties', 'setPaused',
  'userDirectoryFilesAddedOrChanged', 'userDirectoryFilesRemoved',
]
const CORPUS_SIGNALS = ['localStorage', 'sessionStorage', 'indexedDB', 'AudioContext', 'new Audio(', 'file:///']
const CORPUS_NON_API = ['wallpaperAudioListener', 'wallpaperSettings', '__weh', '$mediaThumbnail', '$mediaProperties', 'wallpaperRegisterMediaListener']
const CORPUS_TEXT_RE = /\.(html?|xhtml|js|mjs|cjs|json|css|txt|xml|vue|svelte)$/i
const CORPUS_SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.cache'])

/** 真语料扫描（有界：深度 6 / 每张壁纸最多 400 个文本文件 / 单文件 ≤4MB 才读）。
 *  判定用**生产实现** detectWallpaperDir（不重写一份判定，免得量的是另一套规则）。 */
function scanWebCorpus(root) {
  const listFiles = (dir, depth, out) => {
    if (depth > 6 || out.length > 400) return
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!CORPUS_SKIP.has(e.name)) listFiles(p, depth + 1, out) }
      else if (e.isFile() && CORPUS_TEXT_RE.test(e.name)) out.push(p)
    }
  }
  const dirs = []
  const find = (d, depth) => {
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    if (ents.some((x) => x.name === 'project.json')) dirs.push(d)
    if (depth >= 4) return
    for (const e of ents) if (e.isDirectory() && !CORPUS_SKIP.has(e.name) && !e.name.startsWith('.')) find(path.join(d, e.name), depth + 1)
  }
  for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) find(path.join(root, e.name), 0)
  const apis = {}, signals = {}, nonApi = {}, entries = []
  const bump = (bag, id, hits) => { bag[id] = bag[id] || { hits: 0, walls: 0 }; bag[id].hits += hits; bag[id].walls++ }
  for (const dir of dirs) {
    let det = null
    try { det = detectWallpaperDir(dir) } catch { continue }
    if (det.kind !== WEB_KIND.WEB || !det.entry) continue
    const files = []
    listFiles(dir, 0, files)
    let sha = ''
    try { sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, det.entry))).digest('hex') } catch { sha = '' }
    const hits = {}
    for (const f of files) {
      let src = ''
      try { if (fs.statSync(f).size > 4 * 1024 * 1024) continue; src = fs.readFileSync(f, 'utf8') } catch { continue }
      for (const id of [...CORPUS_APIS, ...CORPUS_SIGNALS, ...CORPUS_NON_API]) {
        const n = src.split(id).length - 1
        if (n > 0) hits[id] = (hits[id] || 0) + n
      }
    }
    for (const id of CORPUS_APIS) if (hits[id]) bump(apis, id, hits[id])
    for (const id of CORPUS_SIGNALS) if (hits[id]) bump(signals, id, hits[id])
    for (const id of CORPUS_NON_API) if (hits[id]) bump(nonApi, id, hits[id])
    entries.push({ id: path.relative(root, dir), entry: det.entry, sha256: sha })
  }
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1].hits - a[1].hits || (a[0] < b[0] ? -1 : 1)))
  entries.sort((a, b) => (a.id < b.id ? -1 : 1))
  return { root: path.basename(root), walls: entries.length, apis: sortObj(apis), signals: sortObj(signals), nonApi: sortObj(nonApi), entries }
}

/** 插件缓存里的 mpkg 容器：只读**头部有界字节**数条目名（不整包读；本机 5 个容器里有 331MB 的）。 */
function scanMpkgCache(dir) {
  const out = { files: 0, entries: 0, html: 0, js: 0 }
  let names = []
  try { names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mpkg')) } catch { return out }
  for (const f of names) {
    out.files++
    let fd = null
    try {
      fd = fs.openSync(path.join(dir, f), 'r')
      const buf = Buffer.alloc(2 * 1024 * 1024)
      const got = fs.readSync(fd, buf, 0, buf.length, 0)
      const b = buf.subarray(0, got)
      let pos = 0
      const vl = b.readUInt32LE(pos); pos += 4 + vl
      const total = b.readUInt32LE(pos); pos += 4
      for (let i = 0; i < total; i++) {
        const nl = b.readUInt32LE(pos); pos += 4
        const name = b.toString('utf8', pos, pos + nl); pos += nl + 8
        out.entries++
        if (/\.(x?html?)$/i.test(name)) out.html++
        else if (/\.m?js$/i.test(name)) out.js++
      }
    } catch { /* 头部读不到就按已统计的算 */ } finally { if (fd !== null) { try { fs.closeSync(fd) } catch { /* 忽略 */ } } }
  }
  return out
}

const CORPUS_ROOT = process.env.MPW_ROOT ? path.join(process.env.MPW_ROOT, 'allwallpaper') : path.join(ROOT, '..', 'allwallpaper')
const CORPUS_MPKG_DIR = path.join(os.homedir(), '.dsh-mpkg-wallpaper')
const corpus = fs.existsSync(CORPUS_ROOT) ? scanWebCorpus(CORPUS_ROOT) : null
const mpkgCache = scanMpkgCache(CORPUS_MPKG_DIR)

if (process.argv.includes('--corpus-json')) {
  // 给文档用：把下面这段 JSON 贴进 docs/WEB-WALLPAPER.md 的 MPW-CORPUS-COUNTS 区块
  console.log(JSON.stringify({ corpus, mpkgCache }, null, 2))
  process.exit(0)
}

/** 文档里的语料计数区块（人读是表，机器读是这段 JSON；两边必须一致 ⇒ 防文档漂移） */
function readCorpusDocBlock() {
  let doc = ''
  try { doc = read('docs/WEB-WALLPAPER.md') } catch { return null }
  const m = /<!-- MPW-CORPUS-COUNTS:BEGIN -->([\s\S]*?)<!-- MPW-CORPUS-COUNTS:END -->/.exec(doc)
  if (!m) return null
  const j = /```json\s*([\s\S]*?)```/.exec(m[1])
  if (!j) return null
  try { return JSON.parse(j[1]) } catch { return null }
}
{
  if (!corpus) {
    console.log('  (跳过：本机无语料 ' + CORPUS_ROOT + '；设 MPW_ROOT 或把 allwallpaper/ 放在仓库同级）')
    ok(true, 'L0 语料不在位 ⇒ 跳过计数断言（不假装通过；doc 区块仍需存在）')
  } else {
    ok(corpus.walls >= 1, 'L1 真语料里判定出 web 类壁纸 ' + corpus.walls + ' 张')
    // 逐 API：有命中的**必须**我们有实现（这就是"必须实现哪些"的直接依据）
    for (const [api, st] of Object.entries(corpus.apis)) {
      ok(WEB_SHIM_SOURCE.indexOf(api) >= 0, `L2 语料命中 ${api}（${st.hits} 次 / ${st.walls} 张）⇒ 已实现`)
    }
    // 反向：0 命中的官方 API **不删**（跨语料通用性；上游 42 张语料里 Media*Listener 有 2 张命中）
    for (const api of SHIM_API_NAMES) ok(WEB_SHIM_SOURCE.indexOf(api) >= 0, 'L2 官方 API 全量在位：' + api)
    // 语料给出的"为什么需要新能力"的证据
    ok((corpus.signals['localStorage'] || { walls: 0 }).walls >= 4, 'L3 localStorage 命中的壁纸数 ≥4（本机实测 4/8；⇒ 存储 facade 不是凭空加的：不透明源下访问即抛 SecurityError）')
    ok((corpus.signals['file:///'] || { walls: 0 }).walls >= 1, 'L3 file:/// 命中的壁纸数 ≥1（⇒ 文件 URL 改写 + 源级改写有真语料依据）')
    ok(((corpus.signals['new Audio('] || { walls: 0 }).walls + (corpus.signals['AudioContext'] || { walls: 0 }).walls) >= 1, 'L3 帧内音频（new Audio/AudioContext）命中的壁纸数 ≥1（⇒ 主音量有真语料依据）')
    ok(mpkgCache.files === 0 || mpkgCache.html === 0, 'L4 插件缓存 mpkg 容器里的 web 条目数 = ' + mpkgCache.html + '（扫了 ' + mpkgCache.files + ' 个容器 / ' + mpkgCache.entries + ' 条目）⇒ 缓存语料对本项无输入（不假装有）')

    const docBlock = readCorpusDocBlock()
    ok(!!docBlock, 'L5 文档含机器可读的语料计数区块（MPW-CORPUS-COUNTS）')
    if (docBlock) {
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
      ok(same(docBlock.corpus.apis, corpus.apis), 'L5 文档 API 计数表与实测**逐项一致**（不一致 ⇒ 语料变了：重跑 node tools/web-wallpaper-test.mjs --corpus-json 并更新 docs）')
      ok(same(docBlock.corpus.signals, corpus.signals), 'L5 文档信号计数（localStorage/file:/// 等）与实测逐项一致')
      eq(docBlock.corpus.walls, corpus.walls, 'L5 文档 web 壁纸张数与实测一致')
      ok(same(docBlock.corpus.entries.map((e) => [e.id, e.entry, e.sha256]), corpus.entries.map((e) => [e.id, e.entry, e.sha256])),
        'L5 文档登记的入口 sha256 与真树逐一相同（真语料取指纹证据；语料被改动 ⇒ 本条变红是"语料变了"而不是代码 bug）')
      eq(docBlock.mpkgCache.html, mpkgCache.html, 'L5 文档里 mpkg 缓存的 web 条目数与实测一致')
    }
    // 非 WE 官方标识符的判定（"0 命中且上游也没实现 ⇒ 不写代码"的反面：语料里有，但那是作者自己的东西）
    for (const [id, st] of Object.entries(corpus.nonApi)) {
      ok(SHIM_API_NAMES.indexOf(id) < 0, `L6 ${id}（语料 ${st.hits} 次 / ${st.walls} 张）不是 WE API ⇒ 不进 API 名单（作者自有符号/打包产物）`)
    }
  }
  // 文档"未实现/不需要"一节必须列出 0 命中且上游也没实现的项（不许只写在回复里）
  const doc = (() => { try { return read('docs/WEB-WALLPAPER.md') } catch { return '' } })()
  ok(/^#{2,3}[^\n]*未实现\s*\/\s*不需要/m.test(doc), 'L7 文档有「未实现/不需要」一节（0 命中且上游也没实现的东西写在里面，不写代码）')
  for (const k of ['$mediaThumbnail', 'indexedDB', 'wallpaperRegisterMediaListener']) ok(doc.indexOf(k) >= 0, 'L7 文档写明不实现：' + k)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)

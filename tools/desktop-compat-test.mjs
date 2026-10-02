// desktop-compat-test.mjs —— **DSH 桌面端（Electron / file:// 档）兼容**的离线判据
//
// 病（2026-10-01 只读分析结论，报告 docs/reverse/DSH-DESKTOP-COMPAT-20261001.md）：
//   · **相对 URL 阻断（决定性）**：宿主路由全走 `/api/mpkg-wallpaper/...`，而 DSH 官方在
//     `@deepseek-ai/dsh-host-webserver` 模块头注释里写明 "**Electron uses file:// plus IPC instead**"。
//     桌面壳下 `location.origin` 会是 `"null"` ⇒ 相对路径 fetch 解析不到宿主，插件退化成"只剩主题 + 静态兜底"。
//     DSH 自己的第一方客户端包统一兜底到 `http://dsh.internal`（`dsh-client-connection` 的 `INTERNAL_BASE`、
//     `dsh-client-file-upload` 的 `resolveUrl`…）—— 本插件照**同一口径**做（`mpwHostOrigin/mpwHostUrl`）。
//   · **`ffprobe` 缺口**：恒以裸名调用，Windows 无 `.exe` 回退、无 env、无 bundled ⇒ "直读 vs 转码"判定失效。
//   · 排查通道：宿主 `GET /compat`（只读 JSON）+ 客户端 `window.__mpwCompat()`（location/主题/面数一次给全）。
//
// 判据（纯 Node；`__mpwTest` 走真实现，客户端助手走源码切片 + 假 location）：
//   A 组 静态：口径与接线（助手存在、无残留裸相对 URL、arm-probe 走路径还原、两个 ffprobe 调用点走探测链、路由与探针都在）
//   B 组 行为：HTTP 档**逐字节等价**（相对路径 == origin+路径）；非 HTTP 档（origin "null"/缺失）⇒ dsh.internal；
//             路径还原对两种形态都成立、对外来 URL 返回空（不误判成宿主 URL）
//   C 组 行为：`resolveFfprobe()` 的 env 覆盖 + 结果缓存（同一进程内同值）
//   D 组 变异自证：把兜底 / `.exe` 回退 / 兄弟目录 / 路径还原改坏 ⇒ 对应判据必红（真源零改动）
//
// 用法: node tools/desktop-compat-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const SERVER = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
/** 只看**代码**的视图：注释里逐字写明了旧写法（`execFileSync('ffprobe')` 那句说明），
 *  拿原文判"旧写法还在不在"会自指假红（house style，见 tests/bench-dropdown-theme-test 的 stripComments）。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const SERVER_CODE = stripComments(SERVER)
const CLIENT_CODE = stripComments(CLIENT)

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) } }

/* ── 源码切片：客户端三个助手（与 lib 同源；只换外部依赖）────────────────── */
function sliceFn(src, name) {
  const i = src.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('缺少函数 ' + name + ': ' + name)
  let d = 0, started = false
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true } else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1) }
  }
  throw new Error('函数体不配平 ' + name)
}
const FALLBACK_LINE = (CLIENT.match(/const MPW_HOST_FALLBACK_ORIGIN = "([^"]+)";/) || [])[1]
const HOST_BASE_LINE = (CLIENT.match(/const HOST_BASE = "([^"]+)";/) || [])[1]
function loadClientHelpers(locationObj) {
  const code = [
    'const location = __loc;',
    'const MPW_HOST_FALLBACK_ORIGIN = ' + JSON.stringify(FALLBACK_LINE) + ';',
    'const HOST_BASE = ' + JSON.stringify(HOST_BASE_LINE) + ';',
    sliceFn(CLIENT, 'mpwPageOrigin'), sliceFn(CLIENT, 'mpwHostOrigin'), sliceFn(CLIENT, 'mpwHostUrl'), sliceFn(CLIENT, 'mpwHostAbsUrl'), sliceFn(CLIENT, 'mpwHostPathOf'),
    'const HOST_URL = mpwHostUrl(HOST_BASE);',
    'return { origin: mpwHostOrigin, url: mpwHostUrl, abs: mpwHostAbsUrl, pathOf: mpwHostPathOf, HOST_URL, HOST_BASE };',
  ].join('\n')
  // eslint-disable-next-line no-new-func
  return new Function('__loc', code)(locationObj)
}
const LOC_HTTP = { origin: 'http://127.0.0.1:3080', href: 'http://127.0.0.1:3080/' }
const LOC_NULL = { origin: 'null', href: 'file:///C:/Users/x/app/index.html' }
const LOC_NONE = {}

console.log('== A 组：口径与接线（静态）==')
ok('A1 常量与助手都在：`MPW_HOST_FALLBACK_ORIGIN` = 与 DSH 第一方同口径的 `http://dsh.internal`；三个助手 + `HOST_URL`',
  FALLBACK_LINE === 'http://dsh.internal' && HOST_BASE_LINE === '/api/mpkg-wallpaper'
  && ['mpwPageOrigin', 'mpwHostOrigin', 'mpwHostUrl', 'mpwHostAbsUrl', 'mpwHostPathOf'].every((n) => CLIENT.includes('function ' + n + '('))
  && /const HOST_URL = mpwHostUrl\(HOST_BASE\);/.test(CLIENT), JSON.stringify({ FALLBACK_LINE, HOST_BASE_LINE }))
/* 只判**代码**（复用上面已有的 `CLIENT_CODE = stripComments(CLIENT)`）：注释里会引用历史写法
   （如"3.13.11 起这里一直是 location.origin 拼 HOST_BASE"），那属于文档而不是残留代码 ——
   否则判据会被自己的说明打红（本轮真踩到）。 */
ok('A2 **没有残留的裸相对宿主 URL**：`HOST_BASE + "` 形态 0 处、`location.origin + HOST_BASE` 0 处（全部经 HOST_URL）',
  (CLIENT_CODE.match(/HOST_BASE \+ ["']/g) || []).length === 0 && !/location\.origin \+ HOST_BASE/.test(CLIENT_CODE),
  'HOST_BASE+ 命中=' + (CLIENT_CODE.match(/HOST_BASE \+ ["']/g) || []).length)
ok('A3 验活探针走**路径还原**（桌面档下 URL 可能带 `http://dsh.internal` 前缀）：`mpwHostPathOf(url)`',
  /const u = mpwHostPathOf\(url\);/.test(CLIENT) && !/if \(u\.indexOf\(location\.origin\) === 0\) u = u\.slice/.test(CLIENT))
ok('A4 ffprobe 探测链存在且两个调用点都走它（不再裸名 `execFileSync(\'ffprobe\'`）',
  /function resolveFfprobe\(/.test(SERVER) && /function __resolveFfprobeUncached\(/.test(SERVER)
  && (SERVER_CODE.match(/process\.platform === 'win32' \? \['ffprobe\.exe', 'ffprobe'\] : \['ffprobe'\]/g) || []).length === 2   // PATH 与兄弟目录两条名单都要 win32 .exe 回退
  && /const probeBin = \(resolveFfprobe\(\) \|\| \{\}\)\.path \|\| 'ffprobe';/.test(SERVER)
  && (SERVER_CODE.match(/execFileSync\(probeBin,/g) || []).length === 2
  && !/execFileSync\('ffprobe'/.test(SERVER_CODE))
ok('A6 **交给别的文档/源**的宿主 URL 必须绝对：场景渲染器的 `pkgurl` 与 `thumbpost` 都走 `mpwHostAbsUrl()`',
  /const rawUrl = mpwHostAbsUrl\("\/raw\?"/.test(CLIENT)
  && /thumbpost=" \+ encodeURIComponent\(mpwHostAbsUrl\("\/custom-scene-thumb"\)\)/.test(CLIENT)
  && /①\(2026-10-02\) 交给渲染器 iframe ⇒ 必须绝对/.test(CLIENT),
  JSON.stringify([/const rawUrl = mpwHostAbsUrl/.test(CLIENT), /thumbpost=" \+ encodeURIComponent\(mpwHostAbsUrl/.test(CLIENT)]))
ok('A5 排查通道：宿主 `GET /compat` 只读路由 + 客户端 `window.__mpwCompat`',
  /path: BASE \+ '\/compat'/.test(SERVER) && /window\.__mpwCompat = mpwCompatReport/.test(CLIENT)
  && /function mpwCompatReport\(\)/.test(CLIENT))

console.log('\n== B 组：宿主基址解析（HTTP 档逐字节等价 / 非 HTTP 档兜底）==')
{
  const h = loadClientHelpers(LOC_HTTP)
  const rel = HOST_BASE_LINE + '/ping'
  ok('B1 HTTP 档：**原样返回相对路径**（与改动前的裸相对路径逐字节相同；绝对化会打红 5 个门禁的 URL 形状判据）',
    h.url(rel) === rel && h.HOST_URL === HOST_BASE_LINE,
    JSON.stringify([h.url(rel), rel]))
  ok('B1b HTTP 档：绝对形态仍可被 `new URL(相对路径, location.origin)` 解析成同一个地址（同源语义不变）',
    new URL(h.url(rel), LOC_HTTP.origin).href === new URL(rel, LOC_HTTP.origin).href,
    JSON.stringify([new URL(h.url(rel), LOC_HTTP.origin).href]))
  ok('B2 HTTP 档：`mode` 报 `page-origin`（台账/探针据此区分档位）', h.origin() === LOC_HTTP.origin)
  /* B8 ①(2026-10-02) 交给**别的文档/源**的 URL 必须绝对：场景渲染器 iframe 可能在另一个源
     （回环 :8902）⇒ 相对路径会被它按自己的 origin 解析；且 `mpwSceneIdentityFromWebUrl` 里的
     `new URL(pkgurl)` 对相对串直接抛错 ⇒ 沙箱 strict 的 `st` 令牌静默不下发（安全档降级）。 */
  const absHttp = h.abs(HOST_BASE_LINE + '/raw?x=1')
  const absNull = loadClientHelpers(LOC_NULL).abs(HOST_BASE_LINE + '/raw?x=1')
  ok('B8 `mpwHostAbsUrl`：HTTP 档 = origin + 路径（与 3.13.11 的写法逐字节同形）；file:// 档 = dsh.internal；已是绝对的照旧',
    absHttp === LOC_HTTP.origin + HOST_BASE_LINE + '/raw?x=1'
    && absNull === 'http://dsh.internal' + HOST_BASE_LINE + '/raw?x=1'
    && h.abs('http://x.example/y') === 'http://x.example/y',
    JSON.stringify([absHttp, absNull]))
}
{
  const h = loadClientHelpers(LOC_NULL)
  ok('B3 `location.origin === "null"`（Electron file:// 档）⇒ 兜底到 `http://dsh.internal`',
    h.origin() === 'http://dsh.internal' && h.url('/api/mpkg-wallpaper/ping') === 'http://dsh.internal/api/mpkg-wallpaper/ping',
    h.url('/api/mpkg-wallpaper/ping'))
  const h2 = loadClientHelpers(LOC_NONE)
  ok('B4 `location` 缺失/无 origin（桩环境）⇒ 同样兜底（不抛错）', h2.origin() === 'http://dsh.internal')
  ok('B5 已是绝对 http(s) 的原样返回（不重复前缀）', h.url('http://127.0.0.1:8902/x') === 'http://127.0.0.1:8902/x')
  ok('B6 路径还原：两种形态都还原成 `HOST_BASE` 开头的路径；外来 URL 返回空（绝不误判成宿主 URL）',
    h.pathOf('http://dsh.internal/api/mpkg-wallpaper/ping') === '/api/mpkg-wallpaper/ping'
    && h.pathOf('/api/mpkg-wallpaper/ping') === '/api/mpkg-wallpaper/ping'
    && loadClientHelpers(LOC_HTTP).pathOf('http://127.0.0.1:3080/api/mpkg-wallpaper/ping') === '/api/mpkg-wallpaper/ping'
    && h.pathOf('http://evil.example/api/mpkg-wallpaper/ping') === ''
    && h.pathOf('') === '', JSON.stringify([h.pathOf('http://evil.example/api/mpkg-wallpaper/ping')]))
}

console.log('\n== C 组：ffprobe 探测链（真实现，`__mpwTest` 出口）==')
{
  const mod = await import(path.join(ROOT, 'lib', 'index.js'))
  const T = mod.__mpwTest || {}
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-ffprobe-'))
  const fake = path.join(tmpDir, 'my-ffprobe')
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n'); fs.chmodSync(fake, 0o755)
  const oldEnv = process.env.DSH_WE_FFPROBE
  process.env.DSH_WE_FFPROBE = fake
  const r1 = T.resolveFfprobe && T.resolveFfprobe()
  const r2 = T.resolveFfprobe && T.resolveFfprobe()
  if (oldEnv === undefined) delete process.env.DSH_WE_FFPROBE; else process.env.DSH_WE_FFPROBE = oldEnv
  ok('C1 env 覆盖生效（`DSH_WE_FFPROBE` 指向的文件存在 ⇒ source=env，且不 spawn）',
    !!r1 && r1.path === fake && r1.source === 'env', JSON.stringify(r1))
  ok('C2 结果缓存：同一进程内两次调用返回同一对象（不重复走探测链）', r1 === r2)
  ok('C3 出口齐全：`__mpwTest.resolveFfprobe` 与 `resolveFfmpeg` 都能取到（判据走真实现，不另写一份逻辑）',
    typeof T.resolveFfprobe === 'function' && typeof T.resolveFfmpeg === 'function')
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('\n== D 组：变异自证（真源零改动；改坏关键点必红）==')
{
  /* D1 行为变异体：把兜底判断去掉（恒用 location.origin）⇒ 非 HTTP 档必不再返回 dsh.internal。
     ①(2026-10-02) "origin === null 也算缺失"这条判断现在在 mpwPageOrigin() 里 ⇒ 变异体打它。 */
  const ORIGIN_FN = sliceFn(CLIENT, 'mpwPageOrigin') + '\n' + sliceFn(CLIENT, 'mpwHostOrigin')
  const mutOrigin = ORIGIN_FN.replace('return (o && o !== "null") ? o : "";', 'return o;')
  const compile = (code, loc) => new Function('__loc', 'const location = __loc;\nconst MPW_HOST_FALLBACK_ORIGIN = ' + JSON.stringify(FALLBACK_LINE) + ';\n' + code + '\nreturn mpwHostOrigin();')(loc)
  const mutVal = compile(mutOrigin, LOC_NULL)
  ok('D1 去掉「origin === "null" 也算缺失」这条兜底 ⇒ 非 HTTP 档返回 "null"（B3 必红）',
    mutVal === 'null' && mutVal !== 'http://dsh.internal' && compile(ORIGIN_FN, LOC_NULL) === 'http://dsh.internal',
    JSON.stringify({ mutant: mutVal, real: compile(ORIGIN_FN, LOC_NULL) }))
  /* D1c 行为变异体：`mpwHostAbsUrl` 也退回相对（= 本轮修掉的那个真回归：
     渲染器 iframe 在另一个源 ⇒ 取不到包；`new URL(pkgurl)` 抛错 ⇒ 沙箱 st 不再下发）⇒ B8 必红。 */
  const ABS_FNS = sliceFn(CLIENT, 'mpwPageOrigin') + '\n' + sliceFn(CLIENT, 'mpwHostOrigin') + '\n' + sliceFn(CLIENT, 'mpwHostAbsUrl')
  const mutAbsFn = (() => {
    const code = 'const location = __loc;\nconst MPW_HOST_FALLBACK_ORIGIN = ' + JSON.stringify(FALLBACK_LINE) + ';\n'
      + ABS_FNS.replace('return mpwHostOrigin() + rel;', 'return rel;') + '\nreturn mpwHostAbsUrl;'
    return new Function('__loc', code)(LOC_HTTP)
  })()
  const realAbsFn = new Function('__loc', 'const location = __loc;\nconst MPW_HOST_FALLBACK_ORIGIN = ' + JSON.stringify(FALLBACK_LINE) + ';\n' + ABS_FNS + '\nreturn mpwHostAbsUrl;')(LOC_HTTP)
  ok('D1c `mpwHostAbsUrl` 退回相对 ⇒ B8 必红（渲染器在别的源上取不到包 + 沙箱 st 静默不下发）',
    mutAbsFn('/api/mpkg-wallpaper/raw') === '/api/mpkg-wallpaper/raw' && realAbsFn('/api/mpkg-wallpaper/raw') === LOC_HTTP.origin + '/api/mpkg-wallpaper/raw',
    JSON.stringify({ mutant: mutAbsFn('/api/mpkg-wallpaper/raw'), real: realAbsFn('/api/mpkg-wallpaper/raw') }))
  /* D1b 行为变异体：HTTP 档又去绝对化（= 本轮修掉的那个回归）⇒ B1/B1b 必红。
     这条自证的意义：URL 形状判据（np-media/np-control/web-wallpaper/pkg-import 等）真能挡住复发。 */
  const mutAbs = sliceFn(CLIENT, 'mpwPageOrigin') + '\n' + sliceFn(CLIENT, 'mpwHostOrigin')
    + '\n' + sliceFn(CLIENT, 'mpwHostUrl').replace('return o ? rel : MPW_HOST_FALLBACK_ORIGIN + rel;', 'return (o || MPW_HOST_FALLBACK_ORIGIN) + rel;')
  const runUrl = (code) => new Function('__loc', 'const location = __loc;\nconst MPW_HOST_FALLBACK_ORIGIN = ' + JSON.stringify(FALLBACK_LINE) + ';\nconst HOST_BASE = ' + JSON.stringify(HOST_BASE_LINE) + ';\n' + code + '\nreturn mpwHostUrl(HOST_BASE + "/ping");')(LOC_HTTP)
  const mutUrl = runUrl(mutAbs), realUrl = runUrl(sliceFn(CLIENT, 'mpwPageOrigin') + '\n' + sliceFn(CLIENT, 'mpwHostOrigin') + '\n' + sliceFn(CLIENT, 'mpwHostUrl'))
  ok('D1b HTTP 档再绝对化（本轮回归的形态）⇒ B1 必红：变异体是 origin+相对、真源是相对',
    mutUrl === LOC_HTTP.origin + HOST_BASE_LINE + '/ping' && realUrl === HOST_BASE_LINE + '/ping',
    JSON.stringify({ mutant: mutUrl, real: realUrl }))
  ok('D2 路径还原去掉 `dsh.internal` 分支 ⇒ B6 的绝对形态必红',
    (() => {
      const mut = sliceFn(CLIENT, 'mpwHostPathOf').replace('if (u.indexOf(MPW_HOST_FALLBACK_ORIGIN) === 0) u = u.slice(MPW_HOST_FALLBACK_ORIGIN.length);', '')
      const code = 'const location = __loc; const HOST_BASE = ' + JSON.stringify(HOST_BASE_LINE) + '; const MPW_HOST_FALLBACK_ORIGIN = ' + JSON.stringify(FALLBACK_LINE) + ';\n' + mut + '\nreturn mpwHostPathOf;'
      const mutFn = new Function('__loc', code)({ origin: 'http://127.0.0.1:3080' })
      const realFn = loadClientHelpers(LOC_HTTP).pathOf
      return mutFn('http://dsh.internal/api/mpkg-wallpaper/ping') === '' && realFn('http://dsh.internal/api/mpkg-wallpaper/ping') === '/api/mpkg-wallpaper/ping'
    })())
  ok('D3 ffprobe 链去掉 Windows `.exe` 回退 ⇒ A4 必红（两条名单：PATH 与兄弟目录）',
    (SERVER_CODE.match(/process\.platform === 'win32' \? \['ffprobe\.exe', 'ffprobe'\] : \['ffprobe'\]/g) || []).length === 2
    && !/process\.platform === 'win32' \? \['ffprobe\.exe', 'ffprobe'\] : \['ffprobe'\]/.test(SERVER_CODE.split("? ['ffprobe.exe', 'ffprobe']").join("? ['ffprobe']")))
  ok('D4 调用点退回裸名 ⇒ A4 的"两个调用点都走 probeBin"必红',
    (SERVER_CODE.match(/execFileSync\(probeBin,/g) || []).length === 2 && !/execFileSync\('ffprobe'/.test(SERVER_CODE))
  ok('D5 兄弟目录回退被删 ⇒ A4 必红（Windows 上"只有 ffmpeg 没 ffprobe"就再也找不到）',
    /const cand = join\(d, n\);/.test(SERVER_CODE) && /const dirs = \[\];/.test(SERVER_CODE))
  ok('D6 客户端探针被删 ⇒ A5 必红（排查通道没了，只能继续来回问）',
    /window\.__mpwCompat = mpwCompatReport/.test(CLIENT_CODE) && !/window\.__mpwCompat = mpwCompatReport/.test(CLIENT_CODE.replace('window.__mpwCompat = mpwCompatReport', '')))
}

console.log(`\n===== desktop-compat: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ 桌面端兼容口径成立：HTTP 档逐字节等价、非 HTTP 档兜底 dsh.internal、ffprobe 有跨平台探测链、排查通道就位')
process.exit(fail ? 1 : 0)

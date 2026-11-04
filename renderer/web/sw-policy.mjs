// sw-policy.mjs —— P-92：Service Worker 的**缓存判据**（纯函数，单一事实源）
//
// 为什么把判据单独放一个文件（而不是写死在 sw.js 里）：
//   ① Service Worker 里的逻辑**在 Node 里跑不了**（没有 `self`/`caches`），写死就等于"只能靠肉眼审"；
//      抽成纯函数后 `pwa-test.mjs` 能对**每一条** URL 逐条断言（含反面用例），这是本仓库"可对账"的习惯。
//   ② 用户点名要求"**注意别把用户壁纸缓存进去**"。这件事必须能用断言证明，而不是靠注释承诺。
//
// ⛔ 最高优先规则：**默认不缓存**。只有 `shouldCache()` 明确返回 true 的 URL 才进 Cache Storage。
//   即"白名单 + 结构判据"，不是黑名单 —— 黑名单漏一条就是用户素材落盘。
//
// 用户素材的入口形态（全部**排除**在外，逐条有反面断言）：
//   · `/raw?path=…`（服务器从任意白名单目录读文件）
//   · `/pkgpath=…` / `?pkgurl=…` / `/pkgdir?d=…`（任意本地目录 / 远程 URL 打成的包）
//   · `/pkg/<id>` 里 id **不是**自带的 `sample-synthetic`（作者/工坊壁纸）
//   · `/weassist/**`（用户本机 WE 安装目录的资产）
//   · `/report`、`/shot`、`/shots/**`（用户上报与截图，含画面内容）
//   · 任何非 GET / 跨源 / 带 Authorization 的请求

/** 自带的、可安全离线缓存的**唯一**场景 id（程序化生成，无第三方素材；见 samples/README.md）。 */
export const SAMPLE_ID = 'sample-synthetic'

/** 精确匹配的 app shell（我们的代码/清单，只有一个字节都不来自用户素材的文件）。 */
export const SHELL_EXACT = new Set([
  '/',
  '/index.html',
  '/demo.html',
  '/manifest.webmanifest',
  '/sw.js',
  '/we-scene-bundle.js',
  '/bundle.js',
  '/attach-transform.mjs',
  '/puppet-skin.js',
  '/diag-flags.json',
  // ①(2026-09-19 P0 事故修复) 首屏 module 图里"浏览器按相对说明符去取"的自有模块：漏一个 ⇒ 页面停在 loading…。
  //   与 sw.js 的 PRECACHE 清单必须同步（`tests/core-module-wiring-test.mjs` B 段逐条断言）。
  '/we-pointer-source.mjs',
  '/we-particle-pointer.mjs',
  '/web-frame-geometry.mjs',
  '/audio-band-array.mjs',
  '/baseline-metrics.mjs',
  '/core/attach-transform.mjs',
  '/demo/mpw-select.js',
  '/demo/mpw-select-math.mjs',
])

/** 前缀匹配的 app shell 目录。**每一个都是本仓库自有的代码/字体**（不含任何 WE 或工坊素材）。 */
export const SHELL_PREFIX = [
  '/elysia/',            // 渲染器模块（本仓库自有 + vendored ISC 解析器）
  '/vendor/hlsl2glsl/',  // vendored MIT 转译器（本仓库签发，见 THIRD-PARTY.md §7）
  '/assets/fonts/',      // 7 个逐文件署名的字体（THIRD-PARTY.md §4）
  '/icons/',             // PWA 图标（程序化生成）
]

/** 自带样例的**三个**端点（id 写死；不含任何 `?id=` 通配）。 */
export const SAMPLE_URLS = new Set([
  '/pkg/' + SAMPLE_ID,
  '/project/' + SAMPLE_ID,
  '/type/' + SAMPLE_ID,
])

/** URL 里出现这些查询键 ⇒ 一定是用户指定的素材位置 ⇒ 永不缓存（`id` 见 `shouldCache` 的样例例外）。 */
export const USER_SOURCE_KEYS = ['pkgpath', 'pkgurl', 'd', 'path', 'dir', 'url', 'id']

/** 相对 URL 的占位源（相对路径入参时用；SW 里必须显式传 `origin`）。 */
export const PLACEHOLDER = 'http://placeholder.invalid'

/**
 * 该请求能不能进 Cache Storage？
 * @param {string} rawUrl 请求 URL（**SW 里 `request.url` 是绝对 URL**，所以必须传 `origin`；站内相对路径也可）
 * @param {{method?:string, origin?:string}} [init] 请求属性（method 默认 GET；origin 默认占位源）
 * @returns {boolean}
 */
export function shouldCache(rawUrl, init = {}) {
  const method = String(init.method || 'GET').toUpperCase()
  if (method !== 'GET') return false                     // 上报/截图是 POST，天然排除
  const base = String(init.origin || PLACEHOLDER)
  let u
  try {
    u = new URL(String(rawUrl), base)
  } catch { return false }
  // 跨源（含 CDN）一律不缓存：本渲染器按设计不需要任何第三方源，出现即视为用户/宿主注入
  if (u.origin !== base) return false
  let p
  try { p = decodeURI(u.pathname) } catch { return false }   // 畸形百分号编码 ⇒ 不缓存（宁可漏，不可错）
  // 用户素材定位查询键 ⇒ 直接否，不看路径。`id` 是唯一例外：**只有**自带样例的 id 放行
  // （否则离线首页 `/?id=sample-synthetic` 打不开；而 `/pkg/<其它 id>` 在任何位置都不缓存）。
  for (const k of USER_SOURCE_KEYS) {
    if (!u.searchParams.has(k)) continue
    if (k === 'id' && u.searchParams.get('id') === SAMPLE_ID) continue
    return false
  }
  // 用户素材/上报端点（即便不带查询键）
  if (p === '/raw' || p.startsWith('/raw/')) return false
  if (p === '/report' || p === '/shot' || p === '/diag') return false
  if (p.startsWith('/shots/') || p.startsWith('/weassist/') || p.startsWith('/pkgdir')) return false
  // 自带样例：只有 id 逐字等于 sample-synthetic 才认（`/pkg/<其它 id>` 一律不缓存）
  if (SAMPLE_URLS.has(p)) return true
  if (/^\/(pkg|project|type)\//.test(p)) return false
  if (SHELL_EXACT.has(p)) return true
  if (SHELL_PREFIX.some((pre) => p.startsWith(pre))) return true
  return false
}

/**
 * 响应能不能写进缓存？（防止"请求判据过了、但响应其实是错误页/视频/超大文件"）
 * @param {{status?:number, headers?:{get:(k:string)=>string|null}, size?:number}} res
 */
export function shouldStoreResponse(res) {
  if (!res) return false
  if (res.status !== 200) return false                   // 206/404/500/opaque(0) 一律不写
  let ct = ''
  try { ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '') } catch { ct = '' }
  // 音视频/图片不进缓存：用户壁纸里的贴图与视频最容易从这些 content-type 漏进来
  if (/^(video|audio)\//i.test(ct)) return false
  if (/^image\/(?!png|svg)/i.test(ct)) return false      // 只允许我们自己的 png/svg 图标
  if (Number(res.size) > 8 * 1048576) return false       // 单文件上限 8MB（bundle 506KB，最大余量充足）
  return true
}

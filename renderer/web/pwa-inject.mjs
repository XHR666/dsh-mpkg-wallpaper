// pwa-inject.mjs —— P-92：把 PWA 三件（manifest 链接 / 主题色 / Service Worker 注册）**注入首页 HTML**
//
// 为什么用"服务器注入"而不是直接改 `demo.html`：
//   `demo.html` 是 5,700 行的单页应用、**同一时刻只允许一条线改**（并发编辑会互相覆盖）。
//   PWA 是纯增量的"外壳能力"，与渲染逻辑零耦合 ⇒ 放在服务器侧做成**可关的注入**，
//   既避免抢文件，也让"要不要 PWA"变成部署时的一个开关而不是代码里的既成事实。
//
// 开关（默认**关**，因为它会写 Cache Storage）：
//   · 服务端环境变量 `MPW_PWA=1`  ⇒ 该服务器上所有首页都注入（部署一次即可，推荐）
//   · 单次请求 `?pwa=1` / `?pwa=0` ⇒ 覆盖环境变量（临时试用 / 明确关闭）
//   注意：这是**服务器侧**开关，不在 `diag-flag-check.mjs` 的抓取源里
//   （它只扫 `core/we-scene-bundle.js` / `demo.html` / `elysia/**/*.js` / 插件 `lib/client.js`），
//   因此 README-DIAGNOSTICS 的"代码 ↔ 文档双向 0 差异"口径不受影响；登记处见 docs/PACKAGING.md §4。
import fs from 'node:fs'
import path from 'node:path'

/** 注入的静态片段（幂等：已含 `rel="manifest"` 就整段跳过）。 */
export const PWA_HEAD_HTML = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="#0b0e14">',
  // ①(2026-09-19 品牌图标) 浏览器标签图标换成**仓库所有者提供的图**：`/icons/brand-*.png`
  //   （源图 = `demo/assets/brand/**`，站点根这侧是同一批图的副本；`/icons/` 下的程序化生成图**仍保留**
  //    且 `icons.json` 的 sha256 照旧可校验 —— 只是不再是页面引用的那张）。
  '<link rel="icon" type="image/png" sizes="32x32" href="/icons/brand-32.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/icons/brand-192.png">',
  '<link rel="apple-touch-icon" sizes="192x192" href="/icons/brand-192.png">',
  '<script type="module">',
  '// ①(P-92) 离线能力（可选）：注册失败 = 只是没有离线，不影响任何渲染功能。',
  '//   `sw.js` 是 module worker（判据从 sw-policy.mjs import）；不支持的浏览器会 reject，这里静默降级。',
  "if ('serviceWorker' in navigator) {",
  "  navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' })",
  "    .catch((e) => { try { console.warn('[P-92] Service Worker 注册失败（无离线能力，渲染不受影响）:', e && e.message) } catch (x) {} })",
  '}',
  '</script>',
].join('\n')

/** 本服务器为 PWA 新增的静态路由（`/icons/` 是前缀匹配）。 */
export const PWA_ROUTES = {
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/sw.js': { file: 'sw.js', type: 'text/javascript; charset=utf-8' },
  '/sw-policy.mjs': { file: 'sw-policy.mjs', type: 'text/javascript; charset=utf-8' },
  // ①(2026-09-19) 品牌图（页面/manifest 现在引用的就是这四张）
  '/icons/brand-32.png': { file: path.join('icons', 'brand-32.png'), type: 'image/png' },
  '/icons/brand-192.png': { file: path.join('icons', 'brand-192.png'), type: 'image/png' },
  '/icons/brand-512.png': { file: path.join('icons', 'brand-512.png'), type: 'image/png' },
  '/icons/brand-512-maskable.png': { file: path.join('icons', 'brand-512-maskable.png'), type: 'image/png' },
  // 程序化生成的那三张**保留路由**（旧 URL 仍 200：书签/缓存里的引用不该 404；`icons.json` 的校验也照旧）
  '/icons/icon-192.png': { file: path.join('icons', 'icon-192.png'), type: 'image/png' },
  '/icons/icon-512.png': { file: path.join('icons', 'icon-512.png'), type: 'image/png' },
  '/icons/icon-512-maskable.png': { file: path.join('icons', 'icon-512-maskable.png'), type: 'image/png' },
  // ①(2026-09-23 第二轮品牌清理 · 用户③) 浏览器**默认**请求的 `/favicon.ico`：`demo.html` 里没有
  //   `<link rel=icon>`（上游产物，本仓不许改它）⇒ 不拦这条路径时标签页图标是空的（实测 404）。
  //   发的是品牌图 32×32 PNG（浏览器按**内容**嗅探，这里 content-type 如实写 image/png）。
  //   注意：这条路由与**注入开关无关** —— 注入（HTML 片段）默认关，但静态路由一直可用。
  '/favicon.ico': { file: path.join('icons', 'brand-32.png'), type: 'image/png' },
}

/**
 * 本次请求要不要注入 PWA？优先级：显式 `?pwa=` > 环境变量 `MPW_PWA` > 默认关。
 * @param {URLSearchParams|{get:(k:string)=>string|null}} params
 * @param {Record<string,string|undefined>} [env]
 */
export function pwaEnabledFrom(params, env = {}) {
  const q = params && typeof params.get === 'function' ? params.get('pwa') : null
  if (q === '1' || q === 'true' || q === '') return true
  if (q !== null) return false                    // 显式给值但不是真值（`?pwa=0`）⇒ 关
  const e = env && env.MPW_PWA
  return e === '1' || e === 'true'
}

/**
 * 把 PWA 片段插到 `</head>` 前。**幂等**、**缺 `</head>` 时原样返回**（绝不吞掉页面）。
 * @param {string|Buffer} html
 * @returns {string} 注入后的 HTML（调用方负责再编码成 Buffer）
 */
export function injectPwa(html) {
  const s = typeof html === 'string' ? html : Buffer.from(html).toString('utf8')
  if (/rel=["']manifest["']/.test(s)) return s     // 已经注入过（或页面自带）⇒ 不重复
  const i = s.indexOf('</head>')
  if (i < 0) return s
  return s.slice(0, i) + PWA_HEAD_HTML + '\n' + s.slice(i)
}

/** 读一个 PWA 静态路由；文件缺失返回 null（路由层给 404）。 */
export function readPwaAsset(dirname, pathname) {
  const r = PWA_ROUTES[pathname]
  if (!r) return null
  const fp = path.join(dirname, r.file)
  try { return { buf: fs.readFileSync(fp), type: r.type } } catch { return null }
}

// sw.js —— P-92：离线可用的 Service Worker（**只缓存 app shell**）
//
// 注册方式（由 server/we-scene-demo-server.mjs 在 `?pwa=1` / `MPW_PWA=1` 时注入）：
//   navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' })
//
// 三条设计决定（都是"更保守的那条"）：
//   ① **module worker**：判据从 `sw-policy.mjs` import（单一事实源）。代价是要求浏览器支持
//      module service worker（Chrome/Edge 91+、Safari 16.4+、Firefox 111+）；不支持时
//      `register()` 直接 reject ⇒ 页面只是**没有离线能力**，不影响任何渲染功能（注册失败只写日志）。
//   ② **网络优先 + 缓存兜底**（不是 cache-first）：本机服务器随时可能换包/改代码，
//      cache-first 会让人看到旧 bundle 却查不出原因。离线时才回落到缓存。
//   ③ **不缓存任何用户素材**：判据在 `sw-policy.mjs`（默认拒绝 + 白名单），
//      并有逐条反面断言的测试 `pwa-test.mjs`。
//
// 版本号变更 ⇒ 旧缓存整批清理（避免"旧 shell + 新 bundle"的错配）。
const VERSION = 'v3'   // ①(P-146 2026-09-19) 预缓存清单改了一条**错名** URL（见下 `/assets/fonts/Blackout%202%20AM.ttf`）
                       //   ⇒ 换版本让旧缓存整批清理，否则老客户端会一直用"少了那张字体"的 v2 清单
                       // ①(P-143 2026-09-19) 首屏 module 图新增 6 个自有模块 ⇒ 换版本让旧缓存整批清理
                       // （v1 → v2）
// ①(2026-09-23 第二轮品牌清理 · 用户第 2 项裁定 A) 缓存名前缀从 `we-scene-shell-`（本仓库旧内部名）
//   改成 `wewebloader-shell-`（产品名），与 `demo/sw.js` 的 `wewebloader-bench-v1` 同一口径。
//   同样**不需要迁移代码**：下面的 `activate` 按名字删掉一切 != CACHE 的缓存 ⇒ 老客户端下一轮
//   自动回收旧 shell，代价只是重新预缓存一次（离线可用性不受影响：HTML 本来就是网络优先）。
const CACHE = 'wewebloader-shell-' + VERSION
const PRECACHE = [
  '/',
  // ①(P-146 2026-09-19 修错名) 这里原本写的是 `/demo.html` —— 服务器**没有**这条路由（`server/we-scene-demo-server.mjs:377`
  //   只认 `/` 与 `/index.html`，两者都读 `demo.html`），于是那条预缓存**永远 404**、静默失败。
  //   判据同上：`tests/pwa-test.mjs` F11 逐条问真服务要 200（这条断言就是把两个错名一起抓出来的）。
  '/index.html',
  '/manifest.webmanifest',
  '/we-scene-bundle.js',
  '/attach-transform.mjs',
  '/puppet-skin.js',
  // ①(P-136 2026-09-19) bundle 新增的两个同目录 import：预缓存漏了它们 = 离线首屏整图断掉（同 8899 路由那次事故）
  '/we-pointer-source.mjs',
  '/we-particle-pointer.mjs',
  '/we-animation.mjs',   // ②(P-228l) bundle 的 ./we-animation.mjs（属性动画运行时）
  '/web-frame-geometry.mjs',
  '/audio-band-array.mjs',
  /* ①(2026-09-23 第 ⑥ 条) web 帧宿主契约 + shim（首屏 module 图的一部分） */
  '/web-frame-host.mjs',
  '/we-web-shim.mjs',
  '/baseline-metrics.mjs',
  '/core/attach-transform.mjs',
  '/demo/mpw-select.js',
  '/demo/mpw-select-math.mjs',
  '/pkg/sample-synthetic',
  '/project/sample-synthetic',
  '/type/sample-synthetic',
  // ①(P-146 2026-09-19 修错名) 这里原本写的是 `/assets/fonts/Blackout.ttf` —— **仓库里没有这个文件**
  //   （真名 `assets/fonts/Blackout 2 AM.ttf`，带空格 ⇒ URL 必须 `encodeURIComponent`，与 `demo.html:3688`
  //   的 `repoFontUrl()` 同一口径）。原来那条每次安装都静默 404（`install` 里逐条 try/catch，不报错），
  //   等于"写了但没缓存"。判据：`tests/pwa-test.mjs` 的 F11 —— 预缓存清单**每条 URL 都要在真服务上 200**。
  '/assets/fonts/Blackout%202%20AM.ttf',
  // ①(2026-09-19 品牌图标) 预缓存换成页面/manifest 真正引用的那四张（`/icons/brand-*`，仓库所有者提供的图）。
  //   程序化生成的三张 `icon-*.png` 仍是**可访问**的路由（`PWA_ROUTES` 里保留），只是不再进预缓存清单
  //   —— 缓存里不该躺没人引用的字节（离线首屏用哪张就缓存哪张）。
  '/icons/brand-32.png',
  '/icons/brand-192.png',
  '/icons/brand-512.png',
  '/icons/brand-512-maskable.png',
]

import { shouldCache, shouldStoreResponse } from './sw-policy.mjs'

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE)
    // 逐个 add：**任何一个 404 都不许让整次安装失败**（预缓存清单里有可选字体时尤其重要）
    await Promise.all(PRECACHE.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'reload' })
        if (shouldStoreResponse(res)) await c.put(u, res)
      } catch { /* 预缓存失败不影响安装 */ }
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  // 非 GET / 跨源 / 用户素材：**完全不拦截**（不读缓存、不写缓存，交给网络）
  if (!shouldCache(req.url, { method: req.method, origin: self.location.origin })) return
  e.respondWith((async () => {
    try {
      const res = await fetch(req)
      if (shouldStoreResponse(res)) {
        const c = await caches.open(CACHE)
        // 导航请求（`/`）用 URL 本身做键，避免 `?pwa=1&id=…` 的组合爆炸
        c.put(req.mode === 'navigate' ? url.pathname : req, res.clone()).catch(() => {})
      }
      return res
    } catch (err) {
      const c = await caches.open(CACHE)
      const hit = (await c.match(req)) || (req.mode === 'navigate' ? await c.match(url.pathname) : null) || (req.mode === 'navigate' ? await c.match('/') : null)
      if (hit) return hit
      return new Response('离线且未缓存：' + url.pathname, { status: 504, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }
  })())
})

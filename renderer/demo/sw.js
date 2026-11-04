/* WEwebLoader 测试台 Service Worker（纯静态托管用，本地 dev 不注册）。
 *
 * 策略：
 *   - HTML 导航 network-first：在线永远拿最新版，离线回落缓存（部署后老客户端
 *     最多滞后一次访问，不会被 SW 钉死在旧版）；
 *   - 带哈希的 assets / 图标等静态资源 cache-first（文件名变 = URL 变，天然免失效）；
 *   - /api/*、/diag 后端端点完全不拦（只在本地 dev 存在，缓存它们只会制造混乱）。
 *
 * 内部路径全部相对 SW 自身位置，GitHub Pages 的 /WEwebLoader/ 子路径（P-127 前的旧名
 * /wallpaper-engine-webgl/ 只留重定向页，不再放 SW）与根路径部署通吃。
 * 缓存名 `wewebloader-bench-v1`（2026-09-23 第二轮品牌清理 · 用户第 2 项裁定 A）：旧名
 * `webwallgl-bench-v2` 含**上游项目名**，按规则① 统一成产品名。它是缓存标识、不含路径成分，
 * 改名的唯一副作用是让已装 SW 的旧缓存白留一轮 —— `activate` 里按名字清理（下面那个
 * `keys().filter(k => k !== VERSION)`），所以**不需要任何迁移代码**，一轮之后自动回收。
 * P-127.5-③ 当初"不动"的理由（不含路径成分）仍然成立，本轮是**品牌口径**优先于"少一轮白留"。
 */
const VERSION = "wewebloader-bench-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(["./", "./renderer/index.html", "./manifest.webmanifest"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  // 后端端点（dev server / 宿主）：直连，绝不拦截
  if (path.includes("/api/") || path.endsWith("/diag") || path.includes("/media/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((hit) => hit || caches.match("./")),
        ),
    );
    return;
  }

  const ext = path.split(".").pop().toLowerCase();
  if (!["js", "css", "png", "svg", "webmanifest", "json", "woff2"].includes(ext)) return;

  // ①(修正 2026-09-17 真机事故) **没有内容哈希的文件必须 network-first**，
  //   否则"缓存优先"会把旧版补丁钉住：补丁（bench-patch.js）不带 hash，而 HTML 是 network-first ⇒
  //   浏览器拿到**新 HTML + 旧补丁**的混合体 —— 真机表现：整页布局错乱、左上角出现 nav.console/nav.docs
  //   这种未翻译的键名（旧补丁的词典里没有这些键）、README 视图被当成首页、控制台不渲染。
  //   带哈希的 assets 仍然 cache-first（文件名变=URL 变，天然免失效）；离线时全部回落缓存。
  const IMMUTABLE = /\.[0-9a-zA-Z_-]{8,}\.(js|css)$/.test(path) || /\/icons\//.test(path);
  if (!IMMUTABLE) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(event.request, copy)) }
          return res;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});

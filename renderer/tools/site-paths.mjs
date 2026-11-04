// tools/site-paths.mjs —— 站点 URL 路径的**单一真源**（P-127：`/wallpaper-engine-webgl/` → `/WEwebLoader/`）
//
// 为什么单独成模块（而不是把常量写在 build-pages.mjs 里）：这些名字有三个消费方，必须**逐字**一致 ——
//   ① `build-pages.mjs`：产物里挂哪几个路径、旧路径下放什么；
//   ② `tests/demo-check.mjs` 的 D12：把"新路径在 / 旧路径只剩重定向页"钉成可跑断言（本模块可直接 import）；
//   ③ `demo/bench-patch.js`：浏览器侧的运行期前缀改写。⚠ **它不能 import 本模块** —— 产物里只拷 `demo/`，
//      `tools/` 不进站点（见 build-pages.mjs 的白名单），所以那边复制了同名常量，
//      由 D12 断言"两侧逐字一致"（防两边各改一半）。
//
// 口径（用户 2026-09-19 裁定：他看到要走 URL 路径的那处旧名 ⇒ 地址栏也要换）：
//   · `WEwebLoader`（大小写**照抄**）= 现名 / 规范挂载点；
//   · `wallpaper-engine-webgl` = 旧名，产物里**只保留极小重定向页**（不 404、也不再放第二份真源）。
//
// 不在此列（有意保留，见 docs/PATCHES.md P-127.2）：localStorage 键（`webwallgl-theme` 等）、
// DOM 属性名（`data-webwallgl-gl`）、上游归属（`oneincase/webwallgl`、`LICENSE-webwallgl*`）、
// 静态 `<title>` / `DICT['app.title']`（它们是品牌门禁 T5/T8/T1 与许可口径的钉子，且**不是** URL）、
// npm 包名、`docs/PATCHES.md` 的历史记录。
export const SITE_MOUNT = 'WEwebLoader'
export const SITE_MOUNT_LEGACY = 'wallpaper-engine-webgl'

/** 旧路径下要放的**重定向页**：[产物内相对落点]。
 *  为什么是三条而不是一条：产物里**不可重建**的 minified 包（`demo/assets/*.js`）写死了三条绝对路径 ——
 *    `/wallpaper-engine-webgl/renderer/index.html`（测试台 iframe，3 处）、
 *    `/wallpaper-engine-webgl/default-wallpaper/index.html`（渲染器页内兜底壁纸）、
 *    `/wallpaper-engine-webgl/sw.js`（SW 注册，运行期已被补丁改写成相对路径）；
 *  只放 `/index.html` 一张会让"深链/新窗口"直接 404（`#open` 走的就是 renderer 那条）。
 *  `sw.js` **不放**重定向页：重定向一份 SW 只会把旧缓存域带进来，而线上本就不该有 SW
 *  （补丁把注册改写成相对本页 + 失败静默，见 docs/ONLINE-DEMO.md §6）。 */
export const LEGACY_REDIRECTS = [
  'index.html',
  'renderer/index.html',
  'default-wallpaper/index.html',
]

/** 旧路径里的落点 → 相对本页的新地址。
 *  为什么用**相对**地址而不是 `/WEwebLoader/`：Pages 是从仓库根发布的**子路径**站点
 *  （线上根 = `/wallpaper-engine-web-loader/`）⇒ 以 `/` 开头的绝对路径指到域名根，只有根部署才成立。
 *  递归深度 = 目录层数 + 1（`index.html` → `../`；`a/b.html` → `../../`）。 */
export function legacyRedirectTarget(rel) {
  const clean = String(rel == null ? '' : rel).replace(/^\/+/, '')
  const depth = clean.split('/').length // 'index.html' → 1（文件自己占一层）⇒ '../' 正好回到挂载点父目录
  const tail = clean === 'index.html' ? '' : clean
  return '../'.repeat(depth) + SITE_MOUNT + '/' + tail
}

/** 旧路径里的落点 → 给用户看的**新路径**（绝对形状，纯展示用；不是跳转目标）。 */
export function legacyRedirectDisplay(rel) {
  const clean = String(rel == null ? '' : rel).replace(/^\/+/, '')
  return '/' + SITE_MOUNT + '/' + (clean === 'index.html' ? '' : clean)
}

/** 一张极小重定向页（≈0.9 KB）。四件必须做的事：
 *   ① `noindex,nofollow` —— 旧地址不该再被搜索引擎收录；
 *   ② `location.replace(…)` —— 解析期就跳，并把 `?query#hash` **原样带过去**
 *      （深链带 `?src=…` 的壁纸参数，丢了就是白跳）；
 *   ③ `<meta http-equiv="refresh" content="0; url=…">` —— 无 JS 兜底（顺序放在脚本**之后**，
 *      免得 0 秒刷新先跑、把 query 丢掉）；
 *   ④ 一句人话：已改名 + 新地址（中英各一行）+ 一个可点的链接。 */
export function legacyRedirectHtml(rel) {
  const to = legacyRedirectTarget(rel)
  const shown = legacyRedirectDisplay(rel)
  const from = '/' + SITE_MOUNT_LEGACY + '/' + (String(rel).replace(/^\/+/, '') === 'index.html' ? '' : String(rel).replace(/^\/+/, ''))
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>已改名：${from} → ${shown}</title>
<script>location.replace(${JSON.stringify(to)} + location.search + location.hash)</script>
<meta http-equiv="refresh" content="0; url=${to}">
</head>
<body>
<h1>这个地址已改名 / This address has moved</h1>
<p>旧地址 <code>${from}</code> 已改名为 <a href="${to}"><code>${shown}</code></a>，正在自动跳转（查询串会保留）。</p>
<p><code>${from}</code> is now <a href="${to}"><code>${shown}</code></a> — you will be redirected automatically (query string preserved).</p>
</body>
</html>
`
}

/** 运行期前缀改写要认的绝对前缀（旧名 + 新名）：产物里的 minified 包写死旧名，改名后新写的代码用新名。 */
export const SITE_PATH_ALIASES = ['/' + SITE_MOUNT + '/', '/' + SITE_MOUNT_LEGACY + '/']

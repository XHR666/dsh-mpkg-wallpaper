# PAGES-BUILD-INTEGRITY.md —— 线上 demo（GitHub Pages）构建面**完整性核对**

> **核实对象**：`build-pages.mjs` 产物 + `web/sw.js` / `web/sw-policy.mjs` 预缓存，是否在最近这批
> 模块化改动（`demo/mpw-select.js`、`demo/mpw-select-math.mjs`、`core/we-pointer-source.mjs`、
> `core/we-particle-pointer.mjs`、`core/attach-transform.mjs`）之后**仍然完整**。
> **为什么这是 P0**：2026-09-19 真的出过一次「首屏 module 图漏登记 ⇒ 白屏」（`docs/PATCHES.md` **P-143.0**）：
> 相对 import 在产物里解析成**产物根 URL**，一处漏登记 ⇒ 404 ⇒ 浏览器按「MIME 类型不合法」拒绝 ⇒
> **整条 module 图断在这里**，页面永远停在 `loading…`，而当时**所有 Node 门禁都是绿的**。
>
> **核对时间**：2026-09-19 12:35–12:45（本机） · **仓库 HEAD**：`ace0c28`（P-146）
> **结论一句话**：**产物面完整、SW 面完整**；发现 **1 处新漏（`demo/now-playing/*` 不在任何预缓存清单里）+ 1 条写错文件名的预缓存条目（`Blackout.ttf`）+ 1 条已过期的旧结论（旧路径 SW 注册）**，
> 详见 §3、§6。**本批新增/拆分的 5 个模块，产物与 SW 两侧都是 5/5 全登记，无缺。**

---

## 0. 怎么复核这份文档（三条命令，都不联网、不开浏览器）

```bash
node tests/core-module-wiring-test.mjs           # 静态依赖图 × 三处接线（64 断言）
T=$(mktemp -d); node build-pages.mjs --out "$T"  # 真跑产物（默认写 ./_site，这里改写临时目录）
node tests/pwa-test.mjs                          # SW 判据表 + 真服务（107 断言）
```

本次三条的实测结果：**64 PASS / 0 FAIL**、构建 `✓ 232 个文件 / 必需文件自检 23 项全过 / 隐私闸门通过`、
**107 PASS / 0 FAIL**。

---

## 1. 依赖图：浏览器真的会去加载哪些相对路径

口径 = **相对说明符**（`./`、`../`）在浏览器里按 **URL** 解析，不是按文件系统解析。
所以「仓库里怎么放」与「线上什么 URL」是两件事 —— 这正是 P-143 事故的本质。

### 1.1 `demo/` 面上的相对 import（`grep -rnE "from '\.\.?/|import\('\.\.?/" demo/ --exclude-dir=node_modules`）

| 加载者（仓库文件） | 相对说明符 | 解析成的产物 URL | 谁在用它 |
|---|---|---|---|
| `demo/index.html:22` | `./assets/bench-DSKWIqmS.js` | `/WEwebLoader/assets/bench-DSKWIqmS.js` | 上游 minified 产物（**不可重建**） |
| `demo/index.html:23` | `./assets/modulepreload-polyfill-B5Qt9EMX.js` | `/WEwebLoader/assets/…` | modulepreload polyfill |
| `demo/index.html:24` | `./assets/bench-HtRiuWm6.css` | `/WEwebLoader/assets/…` | 首屏样式 |
| `demo/index.html:30` | `./now-playing/now-playing.css` | `/WEwebLoader/now-playing/now-playing.css` | NowPlaying 样式（P-142） |
| `demo/index.html:883` | `./bench-patch.js` | `/WEwebLoader/bench-patch.js` | 本仓补丁层（`<script type="module">`） |
| `demo/bench-patch.js:70` | `./mpw-select.js` | `/WEwebLoader/mpw-select.js` | 用户第 6 项：自绘下拉 |
| `demo/bench-patch.js:1470` | `import('./now-playing/dist/now-playing.js')` | `/WEwebLoader/now-playing/dist/now-playing.js` | 声音控件（**动态** import，只在点开时取） |
| `demo/mpw-select.js:22` | `./mpw-select-math.mjs` | `/WEwebLoader/mpw-select-math.mjs` | 纯决策逻辑（被自绘下拉取） |
| `demo/now-playing/index.html:144` | `import("./dist/now-playing.js")` | 同目录（独立演示页，非首屏） | NowPlaying standalone 页 |
| `demo/now-playing/index.html:145` | `import("./now-playing-math.mjs")` | 同上 | 同上 |
| `demo/sw.js`（SW 自身） | — | 无相对 import | 测试台 SW（纯静态托管用） |

> `demo/now-playing/node_modules/**`（**未入库**，`git ls-files` 计数 0）里有成百条 `./`、`../` —— 那是
> react/lucide 的源码树，**不进发布面**（`build-pages.mjs` 的 `copyTree` 显式跳过 `node_modules`），不在核对范围。
> 实际发货的是**已构建**的 `demo/now-playing/dist/now-playing.js`（自足 ESM，React 已内联）。

### 1.2 渲染核心面（在 `demo.html` 与 `/elysia/**` 里被相对 import）

| 加载者 | 相对说明符 | 解析成的产物 URL |
|---|---|---|
| `core/we-scene-bundle.js:3` | `./attach-transform.mjs` | `/attach-transform.mjs` |
| `core/we-scene-bundle.js:6` | `./puppet-skin.js` | `/puppet-skin.js` |
| `core/we-scene-bundle.js:17` | `./web-frame-geometry.mjs` | `/web-frame-geometry.mjs` |
| `core/we-scene-bundle.js:28` | `./we-particle-pointer.mjs` | `/we-particle-pointer.mjs` |
| `core/we-scene-bundle.js:29` | `./we-pointer-source.mjs` | `/we-pointer-source.mjs` |
| `core/we-scene-bundle.js:37` | `./audio-band-array.mjs` | `/audio-band-array.mjs` |
| `core/attach-transform.mjs:23` | `./puppet-skin.js` | 同目录（`/core/puppet-skin.js` 或根同名） |
| `elysia/we-renderer/puppet.js:2-3` | `./math.js`、`../buffer.js` | `/elysia/we-renderer/math.js`、`/elysia/buffer.js` |
| `elysia/we-renderer/puppet.js:6` | `../../core/attach-transform.mjs` | **`/core/attach-transform.mjs`**（P-139 引入，产物根**之外**） |
| `elysia/scene-scripts.js:18-19` | `./nsl.js`、`./scene-script-apis.js` | `/elysia/…` |
| `demo.html:1048-1077` | `./bundle.js`、`./elysia/…`、`./baseline-metrics.mjs`、`./audio-band-array.mjs`、`./web-frame-geometry.mjs`、`./demo/mpw-select.js` | 产物根同名 / `/elysia/…` / `/demo/mpw-select.js` |

### 1.3 登记表（模块 → 是否登记 → 证据行）

「登记」= 产物里**真的会有这个文件**。`build-pages.mjs` 的登记有两条通道：
**(a) 具名映射** `PAGES_KEEP_FILES`（`[仓库内落点, 产物内落点]`）与 **(b) 整目录** `PAGES_KEEP_DIRS`
（`:42`：`core, demo, samples, assets, vendor, elysia, extensions`）。
`web/sw.js` 的 `PRECACHE` 是第三条（离线首屏，只在 `?pwa=1` / `MPW_PWA=1` 时才注册，见 §6-②）。

| 产物 URL（浏览器会来取的那个） | 仓库源 | 产物里登记？ | 证据 | SW 预缓存？ |
|---|---|---|---|---|
| `/attach-transform.mjs` | `core/attach-transform.mjs` | ✅ 具名 | `build-pages.mjs:59` | ✅ `sw.js:23` |
| `/puppet-skin.js` | `core/puppet-skin.js` | ✅ 具名 | `build-pages.mjs:68` | ✅ `sw.js:24` |
| `/web-frame-geometry.mjs` | `core/web-frame-geometry.mjs` | ✅ 具名 | `build-pages.mjs:66` | ✅ `sw.js:28` |
| `/audio-band-array.mjs` | `core/audio-band-array.mjs` | ✅ 具名 | `build-pages.mjs:67` | ✅ `sw.js:29` |
| `/baseline-metrics.mjs` | `core/baseline-metrics.mjs` | ✅ 具名 | `build-pages.mjs:62` | ✅ `sw.js:30` |
| **`/we-pointer-source.mjs`** | `core/we-pointer-source.mjs` | ✅ 具名 | `build-pages.mjs:74` | ✅ `sw.js:26` |
| **`/we-particle-pointer.mjs`** | `core/we-particle-pointer.mjs` | ✅ 具名 | `build-pages.mjs:75` | ✅ `sw.js:27` |
| `/core/attach-transform.mjs` | `core/attach-transform.mjs` | ✅ 整目录（`core/`） | `build-pages.mjs:42`（+ `MUST` `:183`） | ➖ 不在（`/core/**` 有意不预缓存，P-143.4-②） |
| `/bundle.js`、`/we-scene-bundle.js` | `core/we-scene-bundle.js` | ✅ 具名 ×2 | `build-pages.mjs:56`、`:57` | ✅ `sw.js:22` |
| `/we-scene.mjs` | `core/we-scene.mjs` | ✅ 具名 | `build-pages.mjs:58` | ➖ 不在（非首屏） |
| `/demo/mpw-select.js` | `demo/mpw-select.js` | ✅ 整目录（`demo/`） | `build-pages.mjs:42` | ✅ `sw.js:32` |
| `/demo/mpw-select-math.mjs` | `demo/mpw-select-math.mjs` | ✅ 整目录（`demo/`） | `build-pages.mjs:42` | ✅ `sw.js:33` |
| `/WEwebLoader/mpw-select.js`、`/WEwebLoader/mpw-select-math.mjs` | 同上 | ✅ 第二份拷贝 ④ | `build-pages.mjs:162`（`copyTree(DEMO_SRC, ALIAS, SITE_MOUNT)`） | ➖ 同源清单只列一次（`/demo/**` 与 `/WEwebLoader/**` 是**两份物理拷贝**，见 §3-②） |
| `/WEwebLoader/bench-patch.js` | `demo/bench-patch.js` | ✅ ④ 第二份 | `build-pages.mjs:162` | ➖ 不在（补丁层，网络优先即可） |
| **`/WEwebLoader/now-playing/dist/now-playing.js`** | `demo/now-playing/dist/now-playing.js` | ✅ ④ 第二份 | `build-pages.mjs:162` | ❌ **不在任何预缓存清单** |
| **`/WEwebLoader/now-playing/now-playing-math.mjs`** | `demo/now-playing/now-playing-math.mjs` | ✅ ④ 第二份 | `build-pages.mjs:162` | ❌ **同上** |
| `/WEwebLoader/now-playing/now-playing.css` | `demo/now-playing/now-playing.css` | ✅ ④ 第二份 | `build-pages.mjs:162` | ❌ 同上（CSS 不在 `SHELL_EXACT`） |
| `/WEwebLoader/sw.js` | `demo/sw.js` | ✅ ④ 第二份 | `build-pages.mjs:162` | ➖ 自身（SW 脚本不走 fetch 缓存） |
| `/WEwebLoader/assets/*` | `demo/assets/*` | ✅ ④ 第二份 | `build-pages.mjs:162` | ➖ 不在（带 hash，`demo/sw.js` 里 cache-first） |
| `/elysia/…`（顶层 11 个 `.js`/`.mjs` + `elysia/we-renderer/` 16 个；产物里 `elysia/` 共 **74** 个文件） | `elysia/**` | ✅ 整目录 | `build-pages.mjs:42` | ✅ 前缀白名单 `sw-policy.mjs:48`（`/elysia/`） |
| `/samples/sample-synthetic/**` | `samples/**` | ✅ 整目录（软链跟随解引用，`:126-131`） | `build-pages.mjs:42` | ✅ 三个端点 `sw-policy.mjs:55-59` |
| `/samples/sample-synthetic/scene.pkg` | `samples/**` | ✅ `MUST` 自检 | `build-pages.mjs:185` | ✅ `/pkg/sample-synthetic` |
| `/manifest.webmanifest`、`/sw-policy.mjs`、`/icons/**` | `web/**` | ✅ 具名映射 | `build-pages.mjs:48-53` | ✅ `sw.js` / `SHELL_PREFIX` |

**结论**：**本批新增/拆分的 5 个模块，产物侧 5/5 全登记**（`we-pointer-source.mjs`、`we-particle-pointer.mjs`、
`attach-transform.mjs` 三条走**具名映射**；`mpw-select.js`、`mpw-select-math.mjs` 走 **`demo/` 整目录**）。
没有发现 P-143 那种「相对 import 在产物里没有落点」的漏。

### 1.4 最容易漏的那一个：`core/we-pointer-source.mjs` 抽查 ✅

```text
$ find <产物> -maxdepth 2 -name "we-pointer-source.mjs"
/tmp/pagesbuild.7ldsfi/we-pointer-source.mjs        # 16670 B —— 产物根同名文件（bundle.js 的 ./ 解析落点）
/tmp/pagesbuild.7ldsfi/core/we-pointer-source.mjs   # 16670 B —— 整目录 core/（/core/** 路由的落点）
```

**两份都在**（这正是 P-143 事故的当事文件）。`we-particle-pointer.mjs`、`attach-transform.mjs` 同样两份俱在。

---

## 2. 真跑一次产物构建（实测输出）

**脚本的副作用（先读再跑）**：`build-pages.mjs` **默认写 `./_site`**，并 `fs.rmSync(OUT, {recursive:true, force:true})`
**先清空**目标目录（`:137`）。它**不碰任何源文件**（设计约束 ②「整棵树是读 + 拷贝」，`:10`）。
另有**第二个隐式落点**：仓库里 `demo/` 是**唯一物理真源**，产物里的 `/WEwebLoader/` 只是拷贝 ④（`:153-162`），
所以构建**不会**写 `web/`、也不会写 `demo/`。因此本次**改写临时目录**、仓库 `_site/` 保持不存在（`.gitignore` 也已忽略 `_site/`）。

```console
$ T=$(mktemp -d /tmp/pagesbuild.XXXXXX)
$ node --max-old-space-size=200 build-pages.mjs --out "$T"
✓ Pages 产物：/tmp/pagesbuild.7ldsfi
  · 文件 232 个（白名单口径：PAGES_KEEP_DIRS / PAGES_KEEP_FILES）
  · demo/ 与 WEwebLoader/ 两份（后者是产物里写死的绝对路径所需）
  · 旧路径 wallpaper-engine-webgl/ 只有 3 张重定向页（noindex + 带 query 跳转；非重定向页文件 = 构建红）
  · .nojekyll 已写；必需文件自检 23 项全过
  · 隐私闸门通过：产物零个人绝对路径（显式排除 2 个含本机默认路径的服务端文件）
EXIT=0
```

跑前 `free -m`：`total 15432 / used 8549 / available 6477`（本机同时有 5 条并行线，故一律 `--max-old-space-size=200`）。
`--help` **不存在**：脚本只用 `--out` / `--json` 两个开关（`:29-32`），传 `--help` 会被忽略并按默认跑（**会写 `_site`**，所以别拿它探路）。

### 2.1 产物逐项核对（`ls` / `find`，非推理）

| 产物路径 | 大小 | 在？ |
|---|---|---|
| `we-pointer-source.mjs` / `core/we-pointer-source.mjs` | 16670 B / 16670 B | ✅ / ✅ |
| `we-particle-pointer.mjs` / `core/we-particle-pointer.mjs` | 20392 B / 20392 B | ✅ / ✅ |
| `attach-transform.mjs` / `core/attach-transform.mjs` | 32642 B / 32642 B | ✅ / ✅ |
| `puppet-skin.js` / `core/puppet-skin.js` | 10873 B | ✅ / ✅ |
| `web-frame-geometry.mjs` / `audio-band-array.mjs` / `baseline-metrics.mjs` | 6969 / 15441 / 34117 B | ✅ |
| `bundle.js` / `we-scene-bundle.js` | 746284 B / 746284 B | ✅ / ✅ |
| `demo/mpw-select.js` / `demo/mpw-select-math.mjs` | 13456 B / 5665 B | ✅ / ✅ |
| `WEwebLoader/mpw-select.js` / `WEwebLoader/mpw-select-math.mjs` | 13456 B / 5665 B | ✅ / ✅ |
| `WEwebLoader/bench-patch.js` | 300528 B | ✅ |
| `WEwebLoader/now-playing/dist/now-playing.js` | 234145 B | ✅ |
| `WEwebLoader/now-playing/now-playing-math.mjs` | 14838 B | ✅ |
| `WEwebLoader/now-playing/now-playing.css` | 14672 B | ✅ |
| `WEwebLoader/assets/bench-DSKWIqmS.js` · `renderer-BOSoB05I.js` · `modulepreload-polyfill-*.js` · `*.css` | 129059 / 809476 / 1887 B | ✅ |
| `WEwebLoader/renderer/index.html` · `WEwebLoader/default-wallpaper/index.html` | 1814 / 4341 B | ✅ |
| `WEwebLoader/sw.js`（= `demo/sw.js`，`cmp` 逐字节相同） | 3842 B | ✅ |
| `elysia/we-renderer/puppet.js`、`elysia/buffer.js`、`elysia/scene-scripts.js`、`elysia/nsl.js`、`elysia/scene-script-apis.js`、`elysia/demo-elysia.js`、`elysia/media-*.js`、`elysia/multi-instance.js` | — | ✅ 全在 |
| `core/scene-project-json.mjs` | — | ✅ **实测在**（`find` 命中；`PAGES_DENY_BASENAMES` 只拦**产物根同名**那一份，`core/**` 按 P-101 口径整目录保留 —— 有意如此） |
| `sw.js` · `sw-policy.mjs` | 3842 / 6369 B | ✅ |
| `wallpaper-engine-webgl/{index,renderer/index,default-wallpaper/index}.html` | 3 张重定向页 | ✅（且**没有** `sw.js` —— 有意为之，§6-①） |

**仓库未被污染**：构建后 `_site/` 仍不存在；`git status --short` 与构建前逐字相同（只有任务开始前就存在的
`M core/we-particle-pointer.mjs`、`M core/we-scene-bundle.js`、`M demo.html`、`?? tests/particle-children-test.mjs`）。

### 2.2 HTTP 抽查（临时端口 **18742**，用完即关；没碰 :8899 / :8901 / :8902）

用一次性只读静态服务（`/tmp/pages-serve-check.mjs`，跑完进程退出、端口释放），抓 26 条 URL：

```text
OK   200  text/html; charset=utf-8          /WEwebLoader/index.html
OK   200  text/javascript; charset=utf-8    /WEwebLoader/mpw-select.js
OK   200  text/javascript; charset=utf-8    /WEwebLoader/mpw-select-math.mjs
OK   200  text/javascript; charset=utf-8    /WEwebLoader/sw.js
OK   200  text/html; charset=utf-8          /WEwebLoader/renderer/index.html
OK   200  text/javascript; charset=utf-8    /WEwebLoader/now-playing/dist/now-playing.js
OK   200  text/javascript; charset=utf-8    /WEwebLoader/now-playing/now-playing-math.mjs
OK   200  text/html; charset=utf-8          /demo/index.html
OK   200  text/javascript; charset=utf-8    /demo/mpw-select.js
OK   200  text/javascript; charset=utf-8    /demo/mpw-select-math.mjs
OK   200  text/javascript; charset=utf-8    /sw.js
OK   200  text/javascript; charset=utf-8    /sw-policy.mjs
OK   200  text/javascript; charset=utf-8    /we-pointer-source.mjs
OK   200  text/javascript; charset=utf-8    /we-particle-pointer.mjs
OK   200  text/javascript; charset=utf-8    /attach-transform.mjs
OK   200  text/javascript; charset=utf-8    /puppet-skin.js
OK   200  text/javascript; charset=utf-8    /web-frame-geometry.mjs
OK   200  text/javascript; charset=utf-8    /audio-band-array.mjs
OK   200  text/javascript; charset=utf-8    /baseline-metrics.mjs
OK   200  text/javascript; charset=utf-8    /core/attach-transform.mjs
OK   200  text/javascript; charset=utf-8    /bundle.js
OK   200  application/manifest+json         /manifest.webmanifest
OK   200  text/html; charset=utf-8          /demo.html
OK   200  application/octet-stream          /samples/sample-synthetic/scene.pkg
OK   200  text/html; charset=utf-8          /wallpaper-engine-webgl/index.html
FAIL 404  text/plain                        /wallpaper-engine-webgl/sw.js     ← 预期：旧路径只放 3 张重定向页
```

- **`.mjs` / `.js` 全部拿到 `text/javascript`，没有一条空 MIME**（空 MIME 才是 P-143 白屏的直接死因）。
- 最后一条 404 是**预期**（旧路径 `wallpaper-engine-webgl/` 按设计只有 3 张重定向页，`build-pages.mjs:164-225`
  甚至在产物里断言「旧路径**只能**有这几张页」）。它对本页**无害**，但与 §6-① 的旧结论有关，**必须一起读**。
- ⚠ **本机静态服务的 MIME 表是我写的，不等于 GitHub Pages 的 MIME 表**。Pages 侧的 `.mjs` 真实响应头
  **本次没有验证**（无法联网抓 oneincase.github.io 的响应头）。若要在线上出事时有据可查，
  应加一条"线上 HEAD 抓 `.mjs` 的 content-type"的联网门禁 —— 见 §7-④。本次**唯一**的线上级间接证据是：
  这个地址历史上能正常渲染（P-143 之后用户没有再报白屏），说明 Pages 至少把 `.mjs` 当 JS 发了。

---

## 3. Service Worker 面

### 3.1 `web/sw.js` 的 `PRECACHE`（20 条）逐条点名核对

| `PRECACHE` 条目 | 产物里存在？ | 备注 |
|---|---|---|
| `/` | ✅ `index.html` | 落地页 |
| `/demo.html` | ✅ | 渲染器 demo |
| `/manifest.webmanifest` | ✅ | |
| `/we-scene-bundle.js` | ✅ | |
| `/attach-transform.mjs` | ✅ | |
| `/puppet-skin.js` | ✅ | |
| `/we-pointer-source.mjs` | ✅ | **本批新模块** |
| `/we-particle-pointer.mjs` | ✅ | **本批新模块** |
| `/web-frame-geometry.mjs` | ✅ | |
| `/audio-band-array.mjs` | ✅ | |
| `/baseline-metrics.mjs` | ✅ | |
| `/core/attach-transform.mjs` | ✅ | P-139 新增（`/core/**` 唯一的预缓存条目） |
| `/demo/mpw-select.js` | ✅ | **本批新模块** |
| `/demo/mpw-select-math.mjs` | ✅ | **本批新模块** |
| `/pkg|project|type/sample-synthetic` | ✅ 三个端点 | 自带合成样例（HTTP 端点，不是静态文件；`sw-policy.mjs:55-59`） |
| `/assets/fonts/Blackout.ttf` | ❌ **404** | **文件名对不上**：产物里真名是 `assets/fonts/Blackout 2 AM.ttf`（带空格），见 §6-③ |
| `/icons/icon-192.png`、`/icons/icon-512.png` | ✅ | |

**19/20 条目在产物里有落点**（唯一落空的是那条写错文件名的字体，见 §6-③；SW 安装逐条 `try/catch` + 不因 404 失败，
所以它是"静默少缓存一个字体"，不是坏件）。

> **路径语义**（容易被误读，写清楚）：SW 注册在 `/WEwebLoader/sw.js` 时 scope = `/WEwebLoader/`，
> 清单里的 `'/we-pointer-source.mjs'` 是 **SW 脚本相对**解析 ⇒ 实际请求 `/WEwebLoader/we-pointer-source.mjs`，
> 与该文件的真实落点一致 ✅。所以同一份 `web/sw.js` 在根部署（`?pwa=1` 的 :1430）与子路径部署
> （`/WEwebLoader/`）下都对 —— 这也是清单里**不能**写 `/WEwebLoader/…` 前缀的原因。

### 3.2 `sw-policy.mjs` 的 `SHELL_EXACT` 与 `PRECACHE` 自洽性

- `SHELL_EXACT`（`sw-policy.mjs:23-44`，实测 **18** 条）与 `PRECACHE`（`sw.js:18-40`，实测 20 条）的**代码/模块部分逐条对应**：
  两个清单共有的**代码类 URL = 17 条**（`/`、`/index.html`、`/demo.html`、`/manifest.webmanifest`、`/sw.js`、
  `/we-scene-bundle.js`、`/bundle.js`、`/attach-transform.mjs`、`/puppet-skin.js`、`/diag-flags.json`、
  `/we-pointer-source.mjs`、`/we-particle-pointer.mjs`、`/web-frame-geometry.mjs`、`/audio-band-array.mjs`、
  `/baseline-metrics.mjs`、`/core/attach-transform.mjs`、`/demo/mpw-select.js`、`/demo/mpw-select-math.mjs`），
  `PRECACHE` 比它多的 7 条全是**非代码类**（3 条合成样例端点走 `SAMPLE_URLS`、字体与图标走 `SHELL_PREFIX`
  `sw-policy.mjs:47-52`）⇒ 口径自洽，**没有"清单里有、判据里没有"的条目**。
  新增的 8 条（`we-pointer-source.mjs` / `we-particle-pointer.mjs` / `web-frame-geometry.mjs` /
  `audio-band-array.mjs` / `baseline-metrics.mjs` / `core/attach-transform.mjs` / `demo/mpw-select.js` /
  `demo/mpw-select-math.mjs`）**两边都有**，P-143 的「清单加了、判据不加 ⇒ `shouldCache()` 拒缓存 ⇒ 加了也白加」没复发。
- 实测 `shouldCache()`：`/demo/mpw-select.js` → `true`、`/demo/mpw-select-math.mjs` → `true`、
  `/we-pointer-source.mjs` → `true`、`/we-particle-pointer.mjs` → `true`、`/bundle.js` → `true`。
- **缺口（本次新发现，非 P-143 遗留）**：`SHELL_EXACT` **没有** `/demo/index.html`（测试台首屏）与
  `/demo/now-playing/**`（`now-playing.css` / `dist/now-playing.js` / `now-playing-math.mjs`）⇒
  这三条**不在白名单**，`shouldCache()` 一律 `false` ⇒ 只在运行期由 `fetch` 兜底（`demo/sw.js` 的 network-first
  分支）缓存，**离线首屏拿不到它们**。
  影响评级：**P2**（不是白屏；`demo/index.html` 的导航请求会被 `demo/sw.js` 的 navigate 分支缓存，
  CSS 与 now-playing 在离线时缺，降级为无样式/无声音控件）。

### 3.3 `VERSION` 需不需要递增？→ **不需要（本批）**

- 现值 `web/sw.js:16` `VERSION = 'v2'`，注释写明是 **P-143 首屏 6 个模块**那次 `v1 → v2`。
- 本次核对**没有新增任何模块名**（新模块早就在清单里了），所以「`v2` 的清单 ≠ 线上 `v2` 的清单」这种
  错配**不存在**。
- 一条独立风险（与 `VERSION` 无关但要写下来）：`bundle.js` 是**不带 hash** 的 URL。
  理论上「旧的 `bundle.js`（`v1` 时期缓存的，只有 1 个相对 import）+ 新的 `we-pointer-source.mjs`」不会发生 ——
  因为 `v1 → v2` 那次已经在 `activate` 里把**整批旧缓存删掉**了。

### 3.4 结论一句话

> **产物侧：本批 5 个模块 5/5 全登记、全在产物里（实测），无缺。**
> **SW 侧：本批 5 个模块 5/5 在 `PRECACHE` 且 `SHELL_EXACT` 同步（无缺）；与本批无关的缺/错共 4 条：
> `demo/index.html` + `demo/now-playing/**`（3 条，P2，离线降级）+ `/assets/fonts/Blackout.ttf`（1 条，文件名写错 ⇒ 静默 404，P3）。
> `VERSION` 无需递增。**

---

## 4. 门禁现状

| 门禁 | 断言数 | 本次实测 | 覆盖什么 |
|---|---|---|---|
| `tests/core-module-wiring-test.mjs` | **64** | **64 PASS / 0 FAIL** | A 段：8 个入口的相对 import 逐条 URL 解析 + 目标文件存在；B 段：10 个必需 URL × 三处登记（服务器路由 / Pages 映射 / SW 预缓存）；C 段：反向（被 import 的 `core/*` 必须有人登记） |
| `tests/pwa-test.mjs` | **107** | **107 PASS / 0 FAIL** | SW 判据表逐条正/反断言 + 真服务（manifest/SW/注入 + `content-type`）+ 「不含用户素材」 |

### 4.1 未被守卫覆盖的东西（→ 建议新增的断言，**本次不改测试文件**）

按价值排序，**建议 `tests/core-module-wiring-test.mjs` 加这 5 条**（都属于"改几十行、能钉住一整类事故"）：

1. **把 `demo/index.html` 加进 `ENTRIES`**（`servedUrl: '/WEwebLoader/index.html'`），并让 `relSpecifiers()` 也吃
   `<script src>` / `<link href>` / `import("…")`。
   *为什么*：`demo/index.html` 现在是**测试台真源**，它的 5 条相对路径一条都不在守卫里；
   本次它是**人工 `grep` + `ls` 核对的**，下次改一行 `./now-playing/…` 没人拦。
   *断言形态*：`A 目标文件存在：demo/index.html → ./now-playing/now-playing-math.mjs ⇒ /WEwebLoader/now-playing/now-playing-math.mjs`，
   并断言它在 `<产物>/WEwebLoader/` 下存在（`demo/` 与 `WEwebLoader/` 两份拷贝都要）。

2. **反向检查扩到 `demo/now-playing/dist/**` 与 `demo/assets/**`**：产物根里"被 HTML 相对引用"的文件必须存在。
   *为什么*：`demo/now-playing/dist/now-playing.js` 是**构建产物**（不是源），最容易被 `rm -rf dist` 或
   `.gitignore` 误伤，而它是声音控件（P-142）的**动态** import —— 动态 import 404 不会白屏，只会静默失效。
   *断言形态*：`fs.existsSync('demo/now-playing/dist/now-playing.js')` + 产物侧同名存在。

3. **`PRECACHE` × `SHELL_EXACT` 交叉互查**（现在只查 `REQUIRED` 那 10 条）：
   *断言形态*：`ok([...precacheModulePaths].every(p => SHELL_EXACT.has(p)), 'PRECACHE 里每条代码路径都在 SHELL_EXACT 里（否则清单加了也白加）')`
   + 反向 `SHELL_EXACT.has('/demo/index.html')` 之类的"测试台首屏资源是否补齐"提示（本批为**已知缺口**，
   建议按"先红后补"或显式 `KNOWN_GAPS` 白名单落一条，避免它悄悄长成 P0）。

4. **旧路径不许有第二份真源**（构建里有，门禁里没有）：断言 `LEGACY_REDIRECTS` **不含** `sw.js`，
   且产物 `wallpaper-engine-webgl/` 下**只**有 3 张页 —— 与 §6-① 那条已过期的旧结论配套。

5. **`PRECACHE` 每条 URL 都要在产物里有落点**（本次实测 19/20，唯一落空的是 §6-③ 的字体）：
   *断言形态*：对每条 `PRECACHE` 条目（HTTP 端点类的 3 条白名单除外）断言
   `fs.existsSync(path.join(<产物>, u.replace(/^\//,'') || 'index.html'))`。
   *为什么*：这条能**当场**抓住"文件名写错/字体改名/目录挪位"这类静默 404 —— 而这类错误现在完全无声
   （安装逐条 try/catch，`sw.js:47-53`）。建议同时断言"清单里的文件名与 `assets/fonts/` 实际文件名集合一致"。

### 4.2 一条我**没有**验证的

`tests/x11-e2e/*`（真机门禁）**本次一条都没跑**：它们要 X11/浏览器，而本任务硬约束禁止启动浏览器，
且本机同时有 5 条并行线（内存 15 GB / 已用 8.5 GB）。所以「线上页面在浏览器里真的不白屏」这件事，
本文件只证到 **静态 + 本机静态服务**这一层（`.mjs` 一律 `text/javascript`、依赖图无 404 断点）。

---

## 5. 以后新增 demo 模块时的**三处登记清单**（P-143 白屏根因的 checklist）

> 事故的教训不是"某个文件忘了加"，而是「**同一个名字要出现在三个地方，而三处互不知道**」。
> 所以清单必须按"三处"写，而不是按"文件"写。

新增**任何一个会被浏览器按相对说明符去取的文件**（`core/*.mjs`、`core/*.js`、`demo/*.js`、`demo/*.mjs`）时：

- [ ] **①8899 服务器路由** —— `server/we-scene-demo-server.mjs`
      - 落在**产物根同名**的文件（`core/x.mjs` ⇒ `/x.mjs`）：加具名路由（参照 `server/we-scene-demo-server.mjs:452` 的
        `p === '/we-pointer-source.mjs' || p === '/we-particle-pointer.mjs'`）。
      - 落在 `/core/<file>`：**不用加**（`server/we-scene-demo-server.mjs:460` 的 `p.startsWith('/core/')` 已按扩展名放行）。
      - 落在 `/demo/**`：**不用加**（`server/we-scene-demo-server.mjs:489` 的具名两条只为"8899 与 Pages 同形"，
        `demo/` 整目录本就可达）。
- [ ] **②`build-pages.mjs` 产物映射** —— 二选一，**必须**落一个：
      - **具名映射**：`PAGES_KEEP_FILES` 加 `['core/x.mjs', 'x.mjs']`（产物根同名，参照 `:74-75`）；
        同时把名字加进 `MUST` 自检数组（`:178-188`）—— 这是**构建自己会红**的那道闸。
      - **整目录**：确认它落在 `PAGES_KEEP_DIRS`（`:42`）里的某个目录下（`core/`、`demo/`、`elysia/` 已覆盖）。
        注意 `PAGES_SKIP_RE`（`:82-86`）的**形状排除**：`*-test.mjs` / `*-check.mjs` / `*-audit.mjs` /
        `*-scan.mjs` / `*-verify.mjs` / `*-probe.mjs` **一律不发** —— 模块名别踩这些后缀。
      - ⚠ 产物里 `demo/` 有**两份**（`/demo/` 规范入口 + `/WEwebLoader/` 站点路径名，`:153-162`）：
        新增 `demo/**` 文件**两份都自动有**，但"跑一次 `node build-pages.mjs --out <tmp>` 再 `ls`"是唯一能证的事。
- [ ] **③`web/sw.js` 预缓存（离线首屏）** —— 二选一：
      - 加进 `PRECACHE`（`:18-40`）**并且**加进 `web/sw-policy.mjs` 的 `SHELL_EXACT`（`:23-44`）。
        **两条缺一条都等于没加**：只加 `PRECACHE` ⇒ `shouldCache()` 拒缓存（P-143 踩过）。
      - **`VERSION` 递增**（`sw.js:16`）—— 判据：**清单内容变了就递增**（换版本 ⇒ `activate` 里整批清旧缓存，
        避免「旧 shell + 新 bundle」错配）。只改代码不改清单 ⇒ 不用动。
- [ ] **④门禁**：`node tests/core-module-wiring-test.mjs` 必须**先红后绿**（若它没红，说明这个文件没被任何
      `ENTRIES` 覆盖 ⇒ 顺手把入口补进 `ENTRIES`，否则等于没护栏）。
- [ ] **⑤收尾自检**（三条命令，注意**别覆盖**仓库 `_site/`，用 `--out` 到临时目录）：
      ```bash
      node tests/core-module-wiring-test.mjs
      T=$(mktemp -d); node build-pages.mjs --out "$T" && find "$T" -name '<新文件名>'
      node tests/pwa-test.mjs
      ```

**反例（P-143 现场，逐字对照）**：新增 `we-pointer-source.mjs` / `we-particle-pointer.mjs` 时，
① 路由表漏、② 产物映射漏、③ `PRECACHE` + `SHELL_EXACT` 漏 —— **三处同时漏** ⇒ 产物里没有该文件 ⇒
`/bundle.js` 的 `./we-pointer-source.mjs` 解析到 404 ⇒ 浏览器「模块 MIME 类型不合法」拒绝 ⇒
`window.__mpwModuleStarted` 永远 `false`，页面停在 `loading…`，而**当时所有 Node 门禁全绿**。

---

## 6. 三条"顺带核到、单独记一笔"的发现

### ① 旧结论已过期：产物里那条 `/wallpaper-engine-webgl/sw.js` 注册**不会**打到真 SW

`docs/PATCHES.md`（P-127 段落）写着：**旧路径 `/wallpaper-engine-webgl/` 只放 3 张重定向页，
`sw.js` 有意不放**，并据此判断"线上本就没有 SW 注册"。本次核对发现该判断需要更正：

- `demo/assets/bench-DSKWIqmS.js`（**不可重建**的 minified 产物）**末行**逐字是：
  `"serviceWorker"in navigator&&navigator.serviceWorker.register("/wallpaper-engine-webgl/sw.js").catch(()=>{})`
- `demo/bench-patch.js:4334-4336` 把 `navigator.serviceWorker.register` 包了一层 `demoAssetUrl(u, './')` 改写。
  实测该函数：`'/wallpaper-engine-webgl/sw.js'` → `'./sw.js'` ⇒ 在 `/WEwebLoader/index.html` 下解析为
  **`/WEwebLoader/sw.js`（产物里真实存在，3842 B，与 `demo/sw.js` 逐字节相同）** ✅
- **但执行顺序不利**：`demo/index.html:22` 先跑 `bench-DSKWIqmS.js`（**module 脚本按 DOM 顺序求值**），
  `demo/index.html:883` 才跑 `bench-patch.js`。注册调用发生在**包装器装上之前** ⇒ 那次调用仍打到
  旧路径 ⇒ 新版产物里该 URL 是 **404（text/html）** ⇒ 浏览器按"不合法 MIME"拒绝 ⇒ `.catch(()=>{})` 吞掉。
- **净影响**：页面**不受影响**（这正是上游 `.catch(()=>{})` 的设计），控制台会有一条被吞掉的注册失败；
  而**新版 `demo/sw.js` 在线上其实注册不上** —— 这与仓库既定口径「线上不留 SW，避免被 SW 钉住旧版」
  （`docs/ONLINE-DEMO.md §6` / `bench-patch.js:4329` 注释）**方向一致**，所以**不建议**为此改产物或加第二份 SW。

### ② 根路径 `web/sw.js` 在 Pages 线上**从未注册**（它的清单只对 :1430 `?pwa=1` 有意义）

`web/pwa-inject.mjs:22-30` 是**服务器侧注入**（`?pwa=1` 或 `MPW_PWA=1` 才注入 `navigator.serviceWorker.register('/sw.js')`），
且它**只作用于该服务器返回的 `demo.html` 首页**。Pages 产物是**纯静态**：`demo/index.html` 里 `serviceWorker` 出现 **0 次**，
`demo.html` 里也没有注册。⇒ §3.1 那张 `PRECACHE` 表是**开发服务器 PWA 模式**的覆盖面，
线上测试台的实际离线能力由 `demo/sw.js`（旧路径注册失败，见 ①）决定。
**这条不改变本次结论**（"SW 侧覆盖完整"仍然成立于它自己的适用面），但写清楚能避免下次
"改了 `PRECACHE` 却以为改了线上的离线行为"。

### ③ `PRECACHE` 里那条字体**文件名写错**（静默 404，白写一条）

`web/sw.js:37` 写的是 `'/assets/fonts/Blackout.ttf'`，而产物（与仓库）里字体真名是
**`assets/fonts/Blackout 2 AM.ttf`**（带空格，见 `THIRD-PARTY.md:166` 的逐文件署名行）：

```console
$ ls <产物>/assets/fonts/
Blackout 2 AM.ttf   monof55.ttf   NotoSans-Regular.ttf   PixelOperator8.ttf
RobotoMono-Regular.ttf   Segment7Standard.otf   spincycle_3d_ot.otf   Twemoji.Mozilla.ttf   licenses/   README.md
```

- 后果：SW 安装时对该 URL `fetch` 拿到 404（或服务端 404 页），`shouldStoreResponse()` 因 `status !== 200`
  拒存 ⇒ 该字体**永远不在缓存里**。因为安装是**逐条 try/catch、不因 404 失败**（`web/sw.js:47-53`），
  所以症状是"离线时某个字体缺失"，不会报错 —— `web/sw.js:47` 的注释里那句"预缓存清单里有可选字体时尤其重要"
  其实就是在为这条兜底。
- 为什么没被门禁抓住：`tests/pwa-test.mjs` 的 D 段只断言"预缓存清单里**没有**用户素材端点"，
  **不断言清单里每条 URL 都真的有落点**；`tests/core-module-wiring-test.mjs` 只覆盖 module 图。
- 修法（**本次不改**，交给主对话定）：要么把名字改成 `'/assets/fonts/Blackout%202%20AM.ttf'`（URL 编码），
  要么从清单里删掉它（离线少一个可选字体），并加一条"PRECACHE 每条都在产物里"的断言（§4.1-③ 的延伸）。

---

## 7. 诚实清单（没验到的 / 只做了静态推理的）

1. **没有开浏览器**（硬约束）：没有跑 `tests/x11-e2e/*`，没有真加载线上页面。
   「首屏不白屏」在**浏览器里**成立这件事，本文**没有**直接证据；只有「依赖图无 404 断点 + 真产物文件齐全 +
   本机静态服务 `.mjs` 一律 `text/javascript`」这条链。
2. **没有联网**：没抓 `https://oneincase.github.io/...` 的响应头。所以 §2.2 的 `Content-Type` **只代表我的
   临时服务**，不代表 GitHub Pages 的 MIME 表。Pages 对 `.mjs` 的真实 MIME 是**未验证**项（见 §7-④）。
3. **`demo/index.html` 的浏览器运行期路径**（`bench-patch.js` 的 `iframe.src` setter 改写、`window.open` 改写、
   NowPlaying 的动态 import）只做了**纯函数级**推理（直接 `import` `demo/bench-patch.js` 到 Node 里调用
   `demoAssetUrl()` 实测映射结果），没有在真 DOM 里跑。
4. **没改任何测试文件**（按要求交给主对话）。§4.1 的 4 条建议是**建议**，当前门禁**仍然缺**这两块覆盖：
   `demo/index.html` 的 5 条相对路径、`now-playing` 动态 import。
5. **GH Actions 的 `pages.yml` 自检**本次**没有执行**（只在本地跑了同名命令）；它的 8 条 `test -f` + 旧路径
   重定向页断言与 `build-pages.mjs` 的 `MUST`（23 项）**内容一致**，属静态阅读所得。
6. **`core/we-particle-pointer.mjs` / `core/we-scene-bundle.js` / `demo.html` 的工作区改动**（`git status` 里的
   `M`）本次**没有核对它们的新增内容**是否引入新的相对 import —— 我只按**当前工作区状态**（`HEAD ace0c28` +
   未提交改动）解析了依赖图。若那三条线又新增相对 import，**请重跑 §0 的三条命令**。
7. **未验证**：`demo/sw.js` 的 `addAll(["./", "./renderer/index.html", "./manifest.webmanifest"])` 在第
   `①②` 条改动之后是否仍在真机上装得上（旧路径注册失败这条链见 §6-①）。

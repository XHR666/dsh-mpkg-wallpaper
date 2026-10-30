# WEwebLoader (浏览器端Wallpaper Engine壁纸渲染器)

**[中文](README.md)** | [English](README.en.md)

在浏览器里**实时渲染 Wallpaper Engine 的场景壁纸**（`scene.pkg` / 本仓库的 `.mpkg` 容器 / workshop 源目录），
不需要 Wallpaper Engine、不需要 Windows、不需要 GPU 专用驱动 —— 一个本机 Node 静态服务器 + 支持 WebGL2 的浏览器即可。

- 已发布 npm：[wallpaper-engine-web-loader@0.5.20](https://www.npmjs.com/package/wallpaper-engine-web-loader)
- [在线 demo](https://xhr666.github.io/wallpaper-engine-web-loader/)
- 导航：[快速开始](#1-快速开始) ｜ [主要特性](#2-主要特性支持什么--不支持什么) ｜ [加载一张壁纸](#3-加载一张壁纸) ｜ [开发与测试](#6-开发与测试) ｜ [已知限制](#7-已知限制) ｜ [常见问题](#8-常见问题) ｜ [许可与免责声明](#10-许可与免责声明)

**搜索关键词 / 别名（Search aliases）**：**WEwebLoader** · WE Web Loader · we-web-loader ·
wallpaper-engine-web-loader · WE 场景壁纸网页渲染器 · 壁纸引擎网页渲染器 —— 上面任何一个都应能找到本仓库；
npm 包名与仓库名**保持不变**（`wallpaper-engine-web-loader`），在线 demo 在
<https://xhr666.github.io/wallpaper-engine-web-loader/>。

> **命名说明（2026-09-19）**：本项目有两个名称
> - **WEwebLoader**
> - npm 包名与仓库名仍是 **`wallpaper-engine-web-loader`**

> **参照来源许可声明**：`wer-ref/`（`Aromatic05/wallpaper-engine-renderer`，`catsout/wallpaper-scene-renderer` 的 fork，**GPL-2.0-only**）与
> `we-layerd-ref/`（`Aromatic05/we-layerd`，**无许可**）都是**仓库外的第三方参考实现**，不是 WE 官方代码、不是"真值源"，
> 仅用于**行为对照**：**不得复制、改写、逐行翻译其代码、注释、常量组织或错误文案**。血缘自查记录在**工作区内部文档**
> `<工作区>/docs/reverse/WER-REF-LICENSE-AUDIT.md`（**不随本仓库分发**，故不在仓库内）。

**本文件是主 README（GitHub 首页展示），面向"第一次跑起来"与"现在支持什么"。**
面向下载者的说明见 `docs/README-PUBLIC.md`；第三方代码与许可的**法律文本以 `THIRD-PARTY.md` 为准**，
复制/借鉴台账见 `docs/COPYING-RULES.md`；逐层开关主表见 `docs/README-DIAGNOSTICS.md`；测试见 `docs/TESTING.md`；
架构见 `docs/RENDERER-ARCHITECTURE.md`；真机基线快照（FPS/启动/切换耗时趋势，`?baseline=1` + `tools/baseline-diff.mjs` 回归闸门）见 `docs/BASELINE.md`；逐轮记录见 `docs/PATCHES.md`。

---

## 1. 快速开始

四条路，按"你想干什么"选；命令都可以直接复制：

| 我想… | 走哪条 | 需要什么 |
|---|---|---|
| 马上看一张壁纸 | **A. 自带服务器** | Node ≥ 20 |
| 只要静态托管 / 部署到 Pages | **B. 静态站（只读）** | Node ≥ 20（构建期） |
| 把渲染器嵌进我自己的站点 / app | **C. npm 依赖** | 自己的构建链 |
| 改渲染器代码 / 跑门禁 | **D. 从源码跑** | Node ≥ 20（+ 可选 `npm install`） |

### A. 用自带服务器（推荐，功能最全）
```bash
git clone https://github.com/XHR666/wallpaper-engine-web-loader.git
cd wallpaper-engine-web-loader
bash start-demo.sh                     # 预检 + 起服务（默认 8899）；等价：node server/we-scene-demo-server.mjs
# 浏览器打开 http://127.0.0.1:8899/
```
- 换端口：`PORT=9000 bash start-demo.sh`（或 `bash start-demo.sh --port 9000`）；只想预检不起服务：`bash start-demo.sh --check`；起来后自动开浏览器：`--open`。
- **首次跑必看**：本机没有语料时（本仓库**不分发**任何真实壁纸），页面会**明确提示**并自动渲染自带的合成样例；
  也可以直接打开 `http://127.0.0.1:8899/?id=sample-synthetic`。
- 自带服务器提供：包/目录读取、`/report` 上报落盘、`/weassist` WE 资产兜底、CORS（供 iframe 嵌入）、
  离线 PWA（`web/manifest.webmanifest` + `web/sw.js`，**缓存判据明确排除用户壁纸**，见 `tests/pwa-test.mjs`）。
- 要"**带后端的测试台页面**"（壁纸库列表 / 属性保存 / 删除 / 渲染器诊断流都要能用）：那是**另一个**服务 ——
  `node server/we-scene-demo-server-8902.mjs` ⇒ 打开 `http://127.0.0.1:8902/`（一个 origin 同时提供 `demo/` 静态面 +
  测试台要的 **≥17 个** `/api/*` + 渲染器 iframe 页 + `/media/dev` 媒体面 + `/diag` 诊断流；见 `docs/BENCH-8902.md`）。

### B. 任意静态服务器（只读模式）
```bash
node build-pages.mjs                   # 零依赖、不联网：产出静态站点到 ./_site（白名单 + 隐私闸门 + 必需文件自检）
python3 -m http.server 8899 -d _site   # 或 npx serve _site
# 浏览器打开 http://127.0.0.1:8899/demo.html?id=sample-synthetic
```
- 在线版就是这个形态：<https://xhr666.github.io/wallpaper-engine-web-loader/>（构建脚本 `build-pages.mjs`，CI 见 `.github/workflows/pages.yml`）。
- **只读模式的代价**：没有服务器端点 ⇒ 包代理、`/report` 落盘、WE 资产兜底、目录打包（`/pkgdir`）都不可用；
  只能用**浏览器直接取得到**的包（自带样例，或与页面同源的 `scene.pkg`）。
- **PWA 是可选的**：默认关；只有**自带服务器**加 `MPW_PWA=1` 才注入（`MPW_PWA=1 bash start-demo.sh`，或单次请求 `?pwa=1`）。
  静态托管不会自动获得离线能力。
- 也可以只用 `npm pack` 的产物（解开即是可静态托管的目录）：
```bash
npm pack wallpaper-engine-web-loader@0.5.20       # 得到 wallpaper-engine-web-loader-0.5.20.tgz
tar -xzf wallpaper-engine-web-loader-0.5.20.tgz   # 解开得到 package/（含 demo.html / elysia/ / samples/ 等）
```

### C. npm 安装（把渲染器作为依赖嵌进你自己的站点/app）
```bash
npm i wallpaper-engine-web-loader@0.5.20     # 锁定已发布版本；或 npm i wallpaper-engine-web-loader 跟随 latest
```
最小用法（`parsePkg` / `parseScene` / `mount` 三个入口都已实测跑通）：
```js
import fs from 'node:fs'
import { mount, parseScene } from 'wallpaper-engine-web-loader'         // 库入口 = core/we-scene.mjs
import { parsePkg, getEntry } from 'wallpaper-engine-web-loader/bundle' // 低层解析 = core/we-scene-bundle.js

const pkg       = parsePkg(new Uint8Array(fs.readFileSync('scene.pkg')))
const sceneJson = JSON.parse(new TextDecoder().decode(getEntry(pkg, 'scene.json')))
const project   = JSON.parse(fs.readFileSync('project.json', 'utf8'))   // 没有属性表就传 null
const scene     = parseScene(sceneJson, project, {})

// 浏览器里挂载（mount 要 requestAnimationFrame；Node 端由宿主注入 opts.raf）
const h = mount('#stage', { scene, textures /* Map<名字, {glTex}>，与 demo.html 同形状 */ })
h.setQuality({ q: 'high', aa: 'fxaa', pp: 'high' })   // 热更新，不用重新挂载
h.dispose()
```
- `mount` 的职责边界**只有**"画布 + 帧循环 + 帧末后处理链"：**取包 / 解包 / 贴图上传 / 字体 / 音频 / 上报 / UI 面板**都属宿主侧
  （完整参考实现是 `demo.html` 的 `bootInstance()`，帧序与 `mount` 逐条一致）。
- 返回句柄字段：`{ canvas, renderer, scene, running, frameCount, start, stop, dispose, resize, setQuality, getQuality, setScene, setTextures }`。
- 其它子路径导出：`wallpaper-engine-web-loader/server`（自带服务器）、`/hlsl2glsl`（vendored MIT 转译器）。

### D. 直接从源码跑（本地/开发推荐）
```bash
bash start-demo.sh                    # 预检 + 起服务器（默认 8899）
npm install                           # 可选：装了 typescript，`types-check` 那一项才会真跑（不装则该项 SKIP，不假装通过）
bash check.sh                         # 发布/自检的唯一入口
```
- **自带服务器不需要任何外部仓库**：容器解析由**本仓自带**的 `pkg-parse.mjs`（MIT，薄封装 `packages/we-core/src/pkg.js` ✓，同时导出 `parsePkg`/`readPkgEntry` ✓）提供 ⇒ 克隆本仓即可直接跑 ✓（**若装了姊妹插件则优先用它的完整能力**——含 `parsePkgIndex` 索引快路径 ✓；没装就用自带 ✓）。
  只有需要**场景/纹理抽取**（`extractScene*` / `extractTex*`，在姊妹插件里）时才用 `MPW_PKG_EXTRACT=/绝对路径/pkg-extract.js` 指过去 ✓（可选，非必需）。
  历史提示：旧版 README 曾要求把 MIT 插件放在同一父目录**即可，
  —— **该要求已作废** ✗：`start-demo.sh` 的预检现在应当命中本仓根的 `pkg-parse.mjs` ✓。
- 真实壁纸请放仓库**外**，用 `MPW_SCENE_ROOT` / `?pkgpath=` / `?pkgurl=` 指过去（见 §3/§4）。
- 逐层调试 `/?ln=1`；诊断页 `/diag` 与 `/probe`；页内自检 `/?selfcheck=1`。

### 环境要求与"装好了没有"的自检
- **Node ≥ 20**（`package.json` 的 `engines.node` = `>=20`；脚本用到 `??`、可选链、顶层 await、`node:` 前缀内置模块；**ESM only**，无 CJS 出口）。
- 浏览器侧需要 **WebGL2**（无 GPU 会退回 CPU 路径，明显更慢）。
- 自检就是 §6 里的 `bash check.sh`：它是**唯一入口**，一条命令回答"现在能不能发"。

---

## 2. 主要特性（支持什么 / 不支持什么）

### 支持的输入
- **`scene.pkg`**（WE 场景包）、本项目的 **`.mpkg` 容器**、**workshop 源目录**（服务器即时打包成容器再喂给渲染器）。
- 三种指路方式：`?id=<目录名>`、`?pkgpath=<白名单内绝对路径>`、`?pkgurl=<URL>`（服务器代理抓取，绕 CORS）。见 §3。

### 渲染管线里已经有的（按职责分层）
- **容器与资源解析**：PKG 容器读写（`tools/pkg-patch.mjs` 可改 `scene.json` 后重打包，做受控 A/B）、
  TEX 纹理解码（`TEXV0005` + `TEXI0001` + `TEXB0001~0004` 容器）、MDL 网格、`project.json` 查找链（`core/scene-project-json.mjs`）。
- **场景组合**：image 图层与组合容器、附件锚点变换（`core/attach-transform.mjs`）、
  蒙皮（`core/puppet-skin.js`）、动画（`core/we-animation.mjs`）、CFF 文本与随仓库分发的开源字体（`assets/fonts/`）。
- **粒子**：粒子系统与算子（`sphererandom` / `vortex` / `turbulence` / `controlpointattract` / `sizechange` / `alphachange` …）、
  指针交互（`core/we-particle-pointer.mjs` / `core/we-pointer-source.mjs`）。
- **效果链**：模糊 / 云 / 水波 / 上帝光 / 景深视差等（`elysia/we-renderer/effects/**`）；
  HLSL→GLSL 转译器 `vendor/hlsl2glsl/`（**逐字节 vendored**，MIT）。
- **脚本**：场景脚本运行时（`elysia/scene-scripts.js`）+ WE API shim（`core/we-web-shim.mjs`）。
- **音频**：sound 层清单与播放、频段数组（`core/audio-band-array.mjs`）。音频**不随仓库分发**：载入含音频的包时由页面**在你本地现场解析**。
- **视频**：内嵌 mp4 / 视频纹理。
- **画面控制**：质量档 `?q` / `?aa` / `?pp` 与 `setQuality()` 热更新；显示选项（镜像 / 亮度 / 对比度 / 饱和度 / 色相）；
  帧几何 `legacy|cover`（`core/web-frame-geometry.mjs`）；时段固定 `?time=` / `?hour=`。
- **诊断与回归**：逐层调试 `?ln=N`、诊断页 `/diag` 与 `/probe`、页内自检 `?selfcheck=1`、
  真机基线 `?baseline=1` + `node tools/baseline-diff.mjs` 回归闸门、首帧逐层审计 `?audit=N`。
  开关主表**当前 238 条**（`docs/README-DIAGNOSTICS.md`，由 `diag-flag-check` 与代码**双向对拍**，读数以实跑为准）。

### 明确不做的 / 做不到的
- **需要 WebGL2**；无 GPU 时退回 CPU 路径 ⇒ 功能受限、明显更慢。
- **复杂的蒙皮 / 粒子 / 效果链仍在持续完善** —— 未结项清单见 `tests/known-issues.json` 与 `docs/PATCHES.md`。
- **不分发任何真实壁纸**：仓库只带一个**程序化生成**的合成样例（`samples/sample-synthetic*`）。
- **不分发 WE 官方资产**（官方着色器头 / 粒子预设 / 字体 / 音频 / 视频）：6 个 shader 头是本仓库**自研的 API 兼容实现**，
  WE 安装目录只在**运行时**按 `MPW_WE_ASSETS` 读取（找不到就跳过）。
- **只读模式（无后端）**下：壁纸库列表、属性保存、`/report`、WE 资产兜底都不可用（控件置灰并写明原因）。

---

## 3. 加载一张壁纸

| 方式 | URL | 说明 |
|---|---|---|
| 内置样例 | `?id=sample-synthetic` | 仓库**唯一**自带的场景：程序化生成的合成样例（无第三方素材），见 `samples/` |
| 打开首页 | 无 `?id=` | 本机没有默认语料时页面会**明确提示**并自动改渲染上面的合成样例 |
| 本地包文件 | `?pkgpath=/绝对路径/scene.pkg` | 服务器白名单内的路径（白名单用 `MPW_ALLOW_DIRS` 覆盖，冒号分隔；仓库自带 `samples/` 已在默认白名单里） |
| 远程包 URL | `?pkgurl=https://…/scene.pkg` | 服务器**代理抓取**（绕 CORS） |
| **workshop 源目录** | `?pkgurl=http://127.0.0.1:8899/pkgdir?d=/绝对目录` | 服务器**即时把目录打包成容器**再喂给渲染器；`/pkgdir?scan=1` 可列出可打包目录 |
| 包 id | `?id=<目录名>` | 在 `MPW_SCENE_ROOT` 的候选档与 `<repo>/samples` 里按目录名匹配；**真实壁纸要你自己提供语料** |

调试开关（`?ln=<N>` 逐层、`?time=` / `?hour=` 固定时段、`?showui` 显示被隐藏的 UI 层、`?selfcheck=1` 页内自检…）
的**完整主表**见 `docs/README-DIAGNOSTICS.md`。

---

## 4. 环境变量（都有默认值，不改即等价于作者本机）

| 变量 | 默认 | 用途 |
|---|---|---|
| `PORT` | `8899` | 监听端口（**8899 = 本仓自带 demo 服务**，`server/we-scene-demo-server.mjs`；**8902 = 一站式测试台**，`server/we-scene-demo-server-8902.mjs`，插件默认指向它 —— 两者互不影响 ✓） |
| `MPW_ROOT` | 本仓库的父目录 | 其它路径的基准（`$MPW_ROOT/allwallpaper`、`$MPW_ROOT/wallpaper_engine/assets`…） |
| `MPW_SCENE_ROOT` | 存在的第一个：`$MPW_ROOT/allwallpaper/dd` → `$MPW_ROOT/allwallpaper` → `<repo>/samples`；都不存在则是一个**明确不存在**的占位路径（启动日志会写明，`?id=` 一律 404） | `?id=` 的包目录根 |
| `MPW_REPORTS_DIR` | `$MPW_ROOT/reports` | `/report` 上报落盘目录（只保留最新 60 份） |
| `MPW_WE_ASSETS` | 自动探测本机 Steam/WE 安装目录 | WE 官方资产兜底（着色器/粒子预设/材质）；**不随仓库分发**，找不到就跳过 |
| `MPW_ALLOW_DIRS` | 若干本地目录 + `<repo>/samples` | `?pkgpath=`/`/pkgdir` 的路径白名单（冒号分隔，**整体覆盖**默认值） |
| `MPW_PLUGIN_CACHE` / `MPW_SD_ROOT` | 插件下载缓存 / 备用语料根 | 语料扫描工具的额外根目录（`MPW_SD_ROOT` **只在显式设置时**才进白名单） |
| `MPW_PKG_EXTRACT` | 先 `<repo>/pkg-parse.mjs`，否则 `<父目录>/dsh-mpkg-wallpaper/lib/pkg-extract.js` | 包解析器（公开副本请把 `pkg-extract.mjs` 放在仓库根，或用本变量指绝对路径） |
| `MPW_PWA` | 关 | `1` = 首页注入 PWA（manifest + SW 注册）；单次请求可用 `?pwa=1` 覆盖 |
| `MPW_BIND` | `127.0.0.1` | 监听地址（默认只绑回环） |

---

## 5. 目录结构（按"处理壁纸数据的职责"分层）

| 路径 | 职责 |
|---|---|
| 根 | **入口**：`README.md`、`LICENSE`、`THIRD-PARTY.md`、`package.json`、`start-demo.sh`（启动）、`check.sh`（自检）、`build-pages.mjs`（构建）、`index.html`（落地页）、`demo.html`（渲染器页，即站点根） |
| `core/` | **解析与渲染内核**：`we-scene.mjs`（库入口 `mount()`）、`we-scene-bundle.js`（PKG/TEX/MDL 解析 + WebGL2 渲染器）、`scene-project-json.mjs`（project.json 查找链）、`attach-transform.mjs`（附件锚点）、`puppet-skin.js`（蒙皮）、`we-animation.mjs`、`we-particle-pointer.mjs`、`we-web-shim.mjs`、`web-frame-geometry.mjs`、`audio-band-array.mjs` |
| `server/` | **本机服务端与打包 IO**：`we-scene-demo-server.mjs`（`:8899` 渲染器页：静态服务 + `/report` `/baseline` `/weassist` `/pkgdir` 等路由）、`we-scene-demo-server-8902.mjs`（`:8902` 一站式测试台：静态面 + `/api/*` + 渲染器 iframe + 媒体面 + `/diag` 流 + `/report` `/baseline` 落盘）、`pack-dir.mjs`（源目录 → `.mpkg` 容器） |
| `web/` | **站点外壳与离线资产**：`sw.js` + `sw-policy.mjs`（SW 与缓存判据）、`pwa-inject.mjs`（首页注入）、`manifest.webmanifest`、`icons/`（页面与安装图标：`brand-*` 为仓库所有者提供的图，`icon-*` 为脚本生成）、`diag.html` / `probe.html`（诊断页，对应路由 `/diag`、`/probe`）、`diag-flags.json`（面板开关数据源，脚本生成） |
| `tools/` | **生成器与取证工具**：`make-sample.mjs`（合成样例，确定性）、`make-icons.mjs`（PWA 图标，确定性）、`pkg-patch.mjs`（PKG 容器读写：改 `scene.json` 后重打包 ⇒ "同一份输入喂两档"的受控 A/B；`--self-test` 自检往返逐字节相同）、`baseline-diff.mjs`（基线差异表）、`script-deobfuscate.mjs`（作者混淆脚本按字段去混淆成可读正文） |
| `tests/` | 全量回归与闸门（`run-all-tests.sh` 一键；`docs-check` / `publish-check` / `diag-flag-check` 三项静态闸门） |
| `docs/` | 说明与审计文档（`README-DIAGNOSTICS.md`、`PACKAGING.md`、`RELEASE.md`、`README-PUBLIC.md`、`RENDERER-ARCHITECTURE.md`、`BASELINE.md`、`TESTING.md`、`PATCHES.md`、`COPYING-RULES.md`…） |
| `elysia/` `vendor/` `shaders/` | CPU 渲染器移植（MIT，见 §11.1(1)）、vendored 第三方（MIT/ISC）、6 个自研 API 兼容 shader 头 |
| `samples/` `demo/` `assets/` `extensions/` | 合成样例（唯一自带场景）、WebWallGL 在线测试台（MIT 产物再分发）、随仓库分发的开源字体、扩展钩子示例 |
| `archive/` | 本机归档（**不入库**，`publish-check` 跳过） |

> 站点根 = 仓库根：Pages 直接发布仓库根，`index.html` / `demo.html` / `samples/` / `elysia/` 等**站点入口必须在根**；
> 其余代码按职责进 `core/ server/ web/ tools/`，线上 URL（`/demo.html`、`/sw.js`、`/manifest.webmanifest`…）与整理前**逐字一致**。

---

## 6. 开发与测试

```bash
bash start-demo.sh --check             # 只预检（Node 版本 / 包解析器落点 / 端口 / 语料），不起服务
bash check.sh                          # 发布/自检的唯一入口：三项静态闸门 + 全量回归
bash check.sh --no-gate                # 只跑三项静态闸门（秒级，提交前用）
bash check.sh --fast                   # 全量回归跳最慢项
bash check.sh --json                   # 末尾追加机读汇总
npm run test                           # = bash tests/run-all-tests.sh
npm run test:fast                      # = bash tests/run-all-tests.sh --fast
bash tests/run-all-tests.sh --list     # 列出回归项（当前 **242** 项（新增判据会增长 ⇒ **以 `bash tests/run-all-tests.sh --list` 的输出为准**）；slow 项 --fast 跳过，条件项无数据自动 SKIP）
node tests/docs-check.mjs              # 文档反引号引用完整性 + P-编号健康 + 开关双向一致
node tests/publish-check.mjs           # 隐私/体积/专有文件（发布前唯一必须 0 阻塞的一项）
node tests/diag-flag-check.mjs         # 代码开关 ↔ docs/README-DIAGNOSTICS.md 主表双向 0 差异
node tests/demo-check.mjs              # 在线发布形态自检
node tools/make-sample.mjs             # 重新生成合成样例（确定性：同参数同 sha256）
node tools/pkg-patch.mjs --self-test   # PKG 容器读写往返逐字节自检
node tools/baseline-diff.mjs <旧.json> <新.json>   # 基线逐指标差异表（退化 → 退出码 1）
```

- `bash check.sh --json` 的末行形如 `{"pass":N,"fail":N,"skip":N,"stages":[…]}`；四项全通过时 `pass=4`、`fail=0`，
  任一阶段失败都会打印 `失败阶段：…`、列出失败项并以**退出码 1** 结束（退出码语义由 `check.sh` 自身定义）。
- `npm install` 是**可选**的：不装 `typescript` 时 `types-check` 会打印 SKIP（"未装 typescript ⇒ SKIP，不假装通过"）。
- 发布前的完整前置/命令/验证/回滚流程见 `docs/RELEASE.md`；打包与分发形态见 `docs/PACKAGING.md`。

---

## 7. 已知限制

- 需要 WebGL2；无 GPU 时会退回 CPU 路径（功能受限、明显更慢）。
- 复杂的蒙皮/粒子/效果链仍在持续完善，问题清单与进展见 `tests/known-issues.json` 与 `docs/PATCHES.md`。
- 音频不会随仓库分发：载入含音频的包时，由页面**在你本地现场解析**播放/导出（详见渲染器顶栏音频面板）。
- 纯静态（无后端）形态下，壁纸库列表、属性保存、`/report`、WE 资产兜底都不可用（控件置灰并写明原因）。
- 本仓库**不分发**任何真实壁纸、预览图、音视频或 WE 官方资产；只带一个程序化生成的合成样例。

---

## 8. 常见问题

**Q：跑起来了，但页面说没有壁纸 / 一片空白？**
本仓库**不带真实壁纸**。直接开 `http://127.0.0.1:8899/?id=sample-synthetic` 看自带合成样例；
要看自己的壁纸，用 `?pkgpath=/绝对路径/scene.pkg`（需在 `MPW_ALLOW_DIRS` 白名单内）或把目录放到 `MPW_SCENE_ROOT` 下再用 `?id=<目录名>`。

**Q：`start-demo.sh` 报"找不到包解析器（pkg-extract）"？**（**本仓自带解析器后，正常克隆不会再出现** ✓）
原因：预检在三处找解析器，**第一处就是本仓根的 `pkg-parse.mjs`**（自带 ✓）。真报这个错，通常意味着工作副本缺了该文件或用旧版启动脚本。修法（任选）：
本仓自带 `pkg-parse.mjs` ⇒ **正常克隆不会出现**；若仍报错：把该文件放回仓库根 ✓、或用 `MPW_PKG_EXTRACT=/绝对路径/pkg-extract.js` 指向姊妹插件（**只为场景/纹理抽取**，可选 ✓）。

**Q：默认端口 8899 被占用？**
`PORT=9000 bash start-demo.sh` 或 `bash start-demo.sh --port 9000`（`start-demo.sh` 会先探测再回退，并把最终 URL 打出来）。

**Q：静态托管（B 方案）里为什么有些功能是灰的？**
只读模式没有服务器端点 ⇒ 包代理、`/report`、WE 资产兜底、`/pkgdir` 目录打包都不可用，界面会置灰并写明原因。需要这些功能就用 A 方案。

**Q：`?id=` 一律 404？**
说明 `MPW_SCENE_ROOT` 的**所有候选都不存在**（启动日志会打印生效值与原因）。用 `?pkgpath=` / `?pkgurl=`，或设置 `MPW_SCENE_ROOT` 指向你自己的语料目录。

**Q：怎么确认"装好了、现在能不能发"？**
`bash check.sh`（唯一入口）。只想跑秒级的静态闸门：`bash check.sh --no-gate`；要机读汇总：`bash check.sh --json`。

**Q：可以商用 / 二次分发吗？**
渲染器自有代码是 **GPL-3.0-or-later**（见 §10、§12 与 `LICENSE`）。再分发时**必须**同时携带本仓库的 GPL 源码、
`THIRD-PARTY.md` 与其中登记的第三方许可声明（含 MIT 插件 `dsh-mpkg-wallpaper` 的声明）。本文件不是法律意见。

---

## 9. 数据上限与自动上报（默认关）

自动上报**默认关**：不写 `?report=auto` 就一个定时器都不建；手动上报是用户显式动作，不受开关影响。
一切"会自动写盘 / 写 localStorage"的东西都有**数量 + 字节上限**，超限按**最旧先删**并打日志（`[prune]` / `[limits]`）：

| 落盘物 | 上限 | 清理时机 |
|---|---|---|
| `reports/r*.json`（`/report`，自动路径另限 4 次） | 60 份，与 selfcheck 合计 64MB | 写入前、写入后各一次 |
| `reports/selfcheck-*.json`（`/diag` 自检/性能摘要） | 40 份 | 同上 |
| `reports/shots/<id>/*`（`/shot` 连拍） | 每 id 400 帧 / 200MB；全部 id 合计 500MB | 同上；全局超限时删"所有 id 里最旧的一帧" |
| 插件 diag 快照（宿主端） | 50 个 / 32MB | 启动清理一次 + 写入前后 |
| `localStorage['mpw-props:<壁纸id>']` | 24 键 / 单值 64KB / 合计 512KB | LRU 淘汰 |

上限常量各有**唯一来源**，别处散写无效；逐项清单、清理日志格式、会变红的断言与未定项见 `docs/DATA-LIMITS.md`（门禁 `data-limits`）。

---

## 10. 许可与免责声明

> **免责声明**
> 本项目与 Wallpaper Engine 官方**无任何关联**，不包含 Wallpaper Engine 本体、Steam 创意工坊内容或任何受版权保护的壁纸资源。本项目**不分发**任何壁纸包（scene 场景包、视频壁纸、网页壁纸）、预览图、音视频或美术素材；仓库内随附的字体仅为各自许可允许再分发的开源字体，逐条见 THIRD-PARTY。用户需自行提供**合法获得**的壁纸，并自行承担因读取、转换或播放相关内容而产生的合规责任。"Wallpaper Engine" 及其相关名称与标识为其各自权利人的商标，本项目仅出于说明兼容性之目的进行指称。本项目渲染器以 GPL-3.0-or-later 发布、插件以 MIT 发布；第三方组件与参考资料（**仅行为对照、未复制代码**）的许可与归属见 THIRD-PARTY.md 与 docs/COPYING-RULES.md。
>
> *（上段按项目所有者指定原文采用。须并列阅读 §11 的两条例外：`oneincase/webwallgl`（MIT）的 FXAA 片元着色器为**逐字复制**、其 HLSL→GLSL 转译器为**逐字节 vendored**（MIT 声明均已保留，§11.1(2)）；`Aromatic05/wallpaper-engine-renderer`（GPL-2.0-only）曾被审计判定有 **2 处点状同源**，**已于 2026-09-16 按书面规格按规格独立实现**（`docs/PATCHES.md` **P-95**，行为逐位一致，§11.4(2)），剩余未定项只有**法律定性**（审计 U-1/U-5）。RePKG 的许可已核实为 **MIT**（§11.4(7)）。）*

> **Disclaimer**
> This project is **not affiliated with Wallpaper Engine** in any way. It does not include the Wallpaper Engine application, any Steam Workshop content, or any copyrighted wallpaper assets. It **does not redistribute** wallpaper packages (scene, video, or web), preview images, audio/video, or artwork; the fonts bundled in this repository are only those open-licensed fonts whose licences permit redistribution (see THIRD-PARTY). **Users must supply their own lawfully obtained wallpapers** and are solely responsible for compliance when reading, converting, or playing such content. "Wallpaper Engine" and related names and marks belong to their respective owners and are referenced here only to describe compatibility. The renderer is released under GPL-3.0-or-later and the plugin under MIT; see THIRD-PARTY.md and docs/COPYING-RULES.md for third-party components and reference material (used for **behavioural comparison only — no code was copied**).
>
> *The paragraph above is reproduced verbatim at the project owner's request. Read it together with the two exceptions in §11: the FXAA fragment shader in `oneincase/webwallgl` (MIT) is a **verbatim copy**, and its HLSL→GLSL translator is **vendored byte-for-byte** (MIT notices retained, §11.1(2)); and `Aromatic05/wallpaper-engine-renderer` (GPL-2.0-only), where our audit once found **two point-like same-origin fragments**, was **clean-room rewritten from a written specification on 2026-09-16** (`docs/PATCHES.md` **P-95** — behaviour bit-identical, §11.4(2)), the only remaining open items being the **legal characterisation** (audit U-1/U-5). RePKG's licence is **MIT** (verified, §11.4(7)).*

- **本项目自有代码：GNU GPL 第 3 版或更新版本（`GPL-3.0-or-later`）**，全文见仓库 `LICENSE`
  （上半部分 = GNU GPL v3 条款原文，未改动；末尾附版权声明与 "either version 3 … or (at your option) any later version" 措辞）。SPDX 标识：`GPL-3.0-or-later`。
- **本仓库不含任何 WE（Wallpaper Engine）素材**：不分发 `scene.pkg`/`.mpkg`、贴图、官方着色器头、音频、视频或任何工坊作品；
  自带样例只有程序化生成的 `samples/sample-synthetic*`。
- **容器解析不依赖任何外部仓库**：由本仓 `pkg-parse.mjs` + `packages/we-core/**`（**MIT** ✓）提供。姊妹插件 `dsh-mpkg-wallpaper`（**MIT**）**仅在需要场景/纹理抽取能力时可选使用** ✓；借用在 MIT → GPL 的允许方向上，
  **插件的 MIT 声明随之保留**，不得被本仓库的 GPL 覆盖或删除。
- 第三方组件的逐条归属、许可全文与复制台账见 `THIRD-PARTY.md` 与 `docs/COPYING-RULES.md`；换 GPL 的决定与落地记录见 `docs/PATCHES.md` P-89。本文件不是法律意见。

---

## 11. 参考与致谢 / References & Credits

本节逐个列出本项目**真正参考过的**上游项目，并区分三种性质：① **复制了代码/素材**（必须保留其许可声明）；② **作为依赖 import**（非复制）；
③ **仅"行为/格式对照"**（未复制代码）。**凡本机无法证实的一律写"未定/待核"，不臆想**；法律文本与全文许可以 `THIRD-PARTY.md` 为准，复制台账以 `docs/COPYING-RULES.md` 为准。
标 `<工作区>/…` 的文档属于**工作区内部记录**（不随本仓库分发），故在仓库里按绝对定位写出，避免被误当成仓内相对路径。
### 11.1 复制了代码 —— 必须保留其许可声明

#### (1) elysia395/dsh-wallpaper-engine — MIT
- 仓库：<https://github.com/elysia395/dsh-wallpaper-engine> ｜ 许可：**MIT**（`Copyright (c) 2026 elysia395`）
- **复制/衍生（到文件级）**：`elysia/**` 与 `core/attach-transform.mjs` 是上游 `lib/we-renderer/**` 与 `lib/*.js` 的**移植/衍生作品**：
  - `elysia/we-renderer/**` —— 43 个文件里 **30 个与上游逐字节相同**（`cmp` 逐字节核对）；其余 13 个只带浏览器可移植性补丁（最小的只改 2 行 import 路径，最大的 `textures.js` 135 行差异）。覆盖：CPU 场景渲染器核心、`model.js`+`mdl.js`（MDL 解析）、`puppet.js`（骨骼/蒙皮网格光栅化）、`effects/**`（模糊/云/水波/上帝光/景深视差等效果实现）、`glsl/**`（GLSL 解释器与 HLSL→GLSL 转译）、`jpeg.js`、`camera.js`、`bloom.js`、`canvas.js`、`text.js`。
  - `elysia/font-render.js`（1 行差）、`elysia/scene-scripts.js`（311 行差，已在上游基础上大幅扩展）、`elysia/scene-script-apis.js`（56 行差）—— 场景脚本运行时与 CFF 文字光栅化。
  - `core/attach-transform.mjs` —— 上游 **4 个函数的逐字移植**（`_mdlAnchors` / `_puppetBoneFinal` / `_attachmentOffset` / `resolveTransform`），用于附件锚点变换。
  - 合计 69 个文件 / 约 1.15 MiB。渲染器部分由上游贡献者 **YV3507** 编写（`lib/we-renderer/` 下全部 16 个提交），以 PR #47 于 2026-08-25 合并。
- **许可声明保留在**：`elysia/LICENSE`（MIT 全文，随目录分发）、`THIRD-PARTY.md` §1（MIT 全文）、`docs/COPYING-RULES.md` §4 台账 **#1**。
- **未定/待核**：`elysia/scene-scripts.js` 与 `wer-ref` 内嵌 C++ 字符串之间共享的 JS，其真实来源（elysia MIT 还是共同的 WE-API 祖先）**未定**；建议的三方 diff 尚未做。

#### (2) oneincase/webwallgl — MIT
- 仓库：<https://github.com/oneincase/webwallgl> ｜ 许可：**MIT**（`Copyright (c) 2026 oneincase`）｜ 核对基准 commit：`fdfc578a577d0e680a9cfe2cf2e3e825d3cd2372`（v1.3.23，2026-09-15）
- **复制了什么（到行级）**：上游 `renderer/vendor/we-scene/render/renderer-glsl.js` 里的 **`FXAA_FRAG`（452–489 行）逐字**搬进 `core/we-scene-bundle.js`，常量名 **`FXAA_FS`**（归一化后 38/38 行 GLSL 完全一致，算法常量同上游：`SPAN_MAX=8.0`、`REDUCE_MUL=1/8`、`REDUCE_MIN=1/128`、`LUMA=(.299,.587,.114)`）。
- **整文件 vendored（P-93）**：`vendor/hlsl2glsl/` = 上游 HLSL→GLSL 转译器的**逐字节副本**（`hlsl2glsl.js` 95,759 B / 1693 行、`hlsl-preprocessor.js` 14,920 B / 418 行，加上游 `LICENSE` 1,085 B；三者 sha256 见 `THIRD-PARTY.md` §9.1，**一个字符都没改**）。未 vendored：`render/headers.ts`（本项目传自己的 `common*.h`）。当前唯一消费者是覆盖度门禁 `tests/hlsl2glsl-coverage-test.mjs`，渲染器自身着色器路径尚未接线。
- **仅行为对照（不是复制）**：`?q`/`?aa`/`?pp` 质量档位与 `setQuality` 热更新 API（AA/`pp` 的常量**取值表**按值取自 MIT 的 `quality.ts`，已致谢）、pass 编排（`runAAPass`、回读纹理、帧令牌幂等、`resolveAaMode`、MSAA 回退策略）、顶点阶段复用本仓库既有的全屏三角 `BLOOM_VS`；插件侧 `lib/web-wallpaper.js`（WE API shim）**0 行复制**。
- **静态产物再分发**：`demo/**` 是**打过本项目补丁的 WebWallGL 在线测试台静态产物**（`demo/assets/renderer-*.js`、`demo/assets/bench-*.js`、`demo/index.html` 等上游产物**原样再分发**；`demo/bench-patch.js` 是本项目的运行期补丁，属 GPL-3.0-or-later，不改动 minified 产物）⇒ **MIT 声明随目录分发**：`demo/LICENSE-webwallgl-MIT.txt`（MIT 全文 + 署名 + 说明哪些是上游、哪些是我们的）。`demo/` 内**不含任何壁纸包、预览图、音视频或工坊内容**，默认场景是本仓库自带的合成样例。详见 `THIRD-PARTY.md` §6.4 与 `docs/ONLINE-DEMO.md`。
- **许可声明保留在**：`core/we-scene-bundle.js` 中 `FXAA_FS` 上方的来源注释、`vendor/hlsl2glsl/LICENSE`、`THIRD-PARTY.md` **§6 与 §9**（MIT 全文）、`docs/COPYING-RULES.md` §4 台账 **#6**（FXAA）与 **#8**（转译器）。研读记录：`<工作区>/docs/reverse/WEBWALLGL-UPSTREAM-STUDY.md`、`<工作区>/docs/reverse/WEBWALLGL-DEMO-STUDY.md`。

#### (3) @shaderfrog/glsl-parser 7.0.1 — ISC（Andrew Ray）
- 仓库：<https://github.com/ShaderFrog/glsl-parser> ｜ 许可：**ISC**（依其 `package.json` 的 `"license": "ISC"`、`"author": "Andrew Ray"`）
- **复制了什么**：整体 **vendored、未修改** —— `elysia/vendor/@shaderfrog/glsl-parser/`（19 个文件 / 665,659 B），被 `elysia/we-renderer/glsl/{executor,preprocess}.js` 使用（GLSL 解释器的解析前端）。
- **许可声明保留在**：`elysia/vendor/@shaderfrog/glsl-parser/LICENSE`、`elysia/LICENSE`、`THIRD-PARTY.md` §2。
- **未定/待核（重要）**：上游仓库**没有** LICENSE 文件、README 也无许可章节（GitHub `/license` = 404，npm 包内 `/LICENSE` = 404）⇒ 那个 LICENSE 文件是**我们按包元数据补写**的；其中版权年 `2022` 是依 npm 首发日期**推定**，非上游原文。

### 11.2 随仓库分发的第三方素材 —— 必须保留其许可

- **字体（8 个文件 + 13 个许可/声明文件）** —— 逐文件的**上游 URL、取得日期、字节数、sha256、版权行**见 `THIRD-PARTY.md` §4.1，许可全文随仓库放在 `assets/fonts/licenses/`：

| 文件 | 许可 | 上游 |
|---|---|---|
| Blackout 2 AM.ttf | OFL-1.1（RFN Blackout） | <https://github.com/theleagueof/blackout> |
| monof55.ttf | OFL-1.1 | Debian fonts-monofur 1.0 上游 tarball |
| NotoSans-Regular.ttf | OFL-1.1 | <https://github.com/notofonts/noto-fonts> |
| RobotoMono-Regular.ttf | OFL-1.1（**非** Apache-2.0；WE 里那份 2015 构建才是） | <https://github.com/googlefonts/RobotoMono> |
| Segment7Standard.otf | OFL-1.1（RFN Segment7） | fontlibrary.org /en/font/segment7 |
| Twemoji.Mozilla.ttf | 美术 CC-BY-4.0 / 代码 Apache-2.0 | <https://github.com/mozilla/twemoji-colr>（v0.7.0） |
| spincycle_3d_ot.otf | 作者 freeware 条款（Jess Latham / bvfonts.com） | <https://www.bvfonts.com/>（逐条条件对照见 THIRD-PARTY.md §4.6.1） |

  **硬性 provenance 规则**：`assets/fonts/` 里**没有任何文件取自 Wallpaper Engine 安装目录**；WE 自带的字体目录只在**运行时**读取（`/weassist/fonts/<name>`），从不作为打包来源。
  **故意不打包**（**未随仓库打包**；其中 `8bitOperatorPlus8-Regular.ttf` 的缺口已由作者后继字体 `PixelOperator8.ttf`（**CC0-1.0**，已随仓库）补齐，见 `THIRD-PARTY.md` §4.1/§4.7）：Alcubierre.otf、Atami-Regular.otf、CursedTimerUlil-Aznm.ttf、Lazer84.ttf、kust.ttf、opensticks.ttf、summer85.ttf、8bitOperatorPlus8-Regular.ttf —— 见 THIRD-PARTY.md §4.7。
- **Peggy（MIT）** —— **仅致谢，未分发**：`elysia/vendor/@shaderfrog/glsl-parser/parser/parser.js` 是 Peggy 1.2.0 的机器生成产物（<https://peggyjs.org>）。见 `THIRD-PARTY.md` §3。

### 11.3 作为依赖 import（非复制代码）

#### dsh-mpkg-wallpaper — MIT
- 仓库：<https://github.com/XHR666/dsh-mpkg-wallpaper> ｜ 许可：**MIT**
- **参考/使用方式**：渲染器的 `parsePkg` / `readPkgEntry` **来自本仓 MIT 的 `we-core`**（`pkg-parse.mjs` 转出）；插件提供的**抽取**函数为可选扩展。这是**依赖**，不是复制来的代码。
- **是否直接复制过代码**：**否**。
- **义务**：再分发本渲染器时**必须携带插件的 MIT 声明**；插件**保持 MIT**，不得被本仓库的 GPL 覆盖（MIT → GPL 是允许的单向流动；反向禁止）。机器校验：`tests/publish-check.mjs` 断言插件包里**没有** GPL 文本。

### 11.4 仅"行为/格式对照"，未复制代码（逐项说明）

#### (1) Almamu/linux-wallpaperengine — GPL-3.0-only
- 仓库：<https://github.com/Almamu/linux-wallpaperengine> ｜ 许可：**GPL-3.0-only**（其 `packaging/archlinux/PKGBUILD` 写 `license=('GPL-3.0-only')`）
- **参考了什么（到文件/功能级）**：作为 `.tex` 容器与粒子/对象属性的**格式与默认值权威**，在代码注释里逐处标注依据：纹理容器格式（实测 `TEXV0005` + `TEXI0001` + `TEXB0001~0004`）—— 与 `TextureParser` 对照；非 MP4 时降级为 **V3 布局**；对象属性默认值 `ObjectParser.cpp:770`（`lengthDefault = (name=="ropetrail") ? 1.0 : 0.05`）；粒子初始化器 `CParticle.cpp:767-778`（`createVelocityRandomInitializer`）与控制点 flags。
- **是否直接复制过代码**：**否**（`docs/COPYING-RULES.md` §4 台账中**没有**它的条目 ⇒ 从未借用）。本机检出副本在仓库外的 `lwe-ref/`，不入库。
- **未定/待核**：粒子 flags 的 bit 定义在 `lwe-ref` / `wer-ref` 里**都找不到权威出处** ⇒ 标注"未定"。

#### (2) Aromatic05/wallpaper-engine-renderer — GPL-2.0-only ✅ 点状同源已按规格独立实现
- 仓库：<https://github.com/Aromatic05/wallpaper-engine-renderer> ｜ 许可：**GPL-2.0-only**（为 `catsout/wallpaper-scene-renderer` 的 fork）
- **处置结果（2026-09-16 按规格独立实现）**：审计判定的 **2 处点状同源**（α 归一化、alignment 偏移）**已按 `docs/COPYING-RULES.md` §5"五步独立实现"流程重写，旧实现已从 `core/we-scene-bundle.js` 删除**；审计的原始判定（含已删除的旧标识符）保留在 `<工作区>/docs/reverse/WER-REF-LICENSE-AUDIT.md` §3.4：
  ①**先写行为规格** `docs/IMAGE-ALPHA-ALIGN-SPEC.md`（α 归一化真值表与"不得做什么"、alignment token 文法与优先级、验收判据）；
  ②**只依据规格实现**：`coerceImageAlphaMode` + `classifyAlphaDomain`/`saturateUnitInterval`（分类与换算分离 + 具名常量 `ALPHA_UNIT_MAX`/`ALPHA_PERCENT_MAX`），`alignmentOffsetForToken` + `readAlignmentAxisSigns` + `ALIGNMENT_HALF_SHIFTS`（**token 字形与偏移量彻底解耦成查表**，键为符号二元组）；
  ③**五维可证明不同**：命名、分支结构、常量组织、数据结构形态、注释文字（"逐分支同构"在 `core/we-scene-bundle.js` 已 0 处）；
  ④**测试不依赖上游**：`tests/clean-room-alpha-align-test.mjs` 只读规格与真语料；
  ⑤**行为差异：无** —— 该测试 **1014 pass / 0 fail**（含"与改前实现 `Object.is` 逐位对拍"与 6 个真包 / 408 层语料回归）。
  同类更弱的痕迹也已清零：`__makeNoopVideoTexture` 全仓 **0 命中**，视差注释里的上游表达式与 `WPNodeTransformResolver.cpp:154-156` 行号已删。
- **登记留痕**：`docs/PATCHES.md` **P-95**（按规格独立实现专条，含五维差异表与可复跑证据）；`<工作区>/docs/reverse/WER-REF-LICENSE-AUDIT.md` §3.4 已加 **"✅ 事后追加（处置结果）"**（原文判定保留不改，另附处置后对照与血缘复测）。
- **规模与结论**：曾为**点状**（约 2 个函数 / ~11 行），从不是段落级或文件级移植；全仓库对其 **0 处 import/require/readFile**；逐字层面 **0 处注释复制、0 处错误串复制、0 处常量表照抄**。
- **未定/待核**：**法律定性** —— 审计 §7 的 **U-1**（"曾构成 GPL-2.0-only 衍生"这一判断本身仍需律师意见）与 **U-5**（清单是否穷尽）**仍未结案**；代码层的处置与留痕不替代法律意见。
- **已收尾的一致性项**：编号统一为 **P-95**（源码注释、验收测试、`docs/RENDERER-ARCHITECTURE.md`、`THIRD-PARTY.md` 全部改为 P-95；`docs/PATCHES.md` 里的 P-91 是另一件事 = "分发形态"）。
- 本机检出副本在仓库外的 `wer-ref/`（565 文件 / 9.2M），**不入库**；`docs/COPYING-RULES.md` 的可借表把它列为"❌ 不可借"（重写后也不再需要"借"）。

#### (3) catsout/wallpaper-scene-renderer — GPL-2.0-only
- 仓库：<https://github.com/catsout/wallpaper-scene-renderer> ｜ 许可：**GPL-2.0-only**（**已归档**，默认分支 `master`）
- **参考了什么**：仅两件事 —— ① `wer-ref` 的**已归档上游 fork 父项目**（两者 LICENSE 为同一 blob）；② 作为"官方行为对不对"的**第三方旁证**，**只引用其行为结论**。
- **是否直接复制过代码**：**否**；本项目**本机没有独立检出副本**。
- **未定/待核**：它与 `waywallen/open-wallpaper-engine` 之间的**逐文件血缘**只在"仓库自述"层面成立（README 全文为 "Moved to …"、同一 LICENSE blob、创建/归档相隔 9 分钟），**未**逐 commit 证实。

#### (4) waywallen/waywallen — MIT
- 仓库：<https://github.com/waywallen/waywallen> ｜ 许可：**MIT**（`bridge/LICENSE` 亦为 MIT，同一持有人）
- **参考了什么**：**仅架构先例** —— "宽松许可宿主 + copyleft 渲染器作为独立进程"的分层方式（依据其 `plugin.toml.in` 的 `[renderers.wescene-renderer]` 段），用以佐证 GPL 组件与 MIT 宿主可以并存而不互相污染。
- **是否直接复制过代码**：**否**（该许可从未被行使，台账中无条目）。

#### (5) waywallen/open-wallpaper-engine — GPL-2.0-only
- 仓库：<https://github.com/waywallen/open-wallpaper-engine> ｜ 许可：**GPL-2.0-only**
- **参考了什么**：**零接触**（只出现在许可兼容性分析"❌ 不可借"，以及 `wer-ref` 自己的迁移说明 —— 那是**上游之间的**血缘，与本仓库无关）。**是否复制过代码**：**否**。

#### (6) aqnya/unmpkg — GPL-3.0（仅 `.mpkg` 格式参考）
- 仓库：<https://github.com/aqnya/unmpkg> ｜ 许可：**GPL-3.0** ｜ **参考了什么**：仅 `.mpkg` 二进制**格式**。**是否复制过代码**：**否**；自述参考它的那个解析脚本（38 行）已于 2026-09-16 删除（因无法排除代码级血缘）。**未定/待核**："仅参考格式"这一声明**无法在本机证实**（本机无检出副本）。

#### (7) notscuffed/repkg — **MIT**（2026-09-16 核实结案）
- 仓库：<https://github.com/notscuffed/repkg> ｜ 许可：**MIT**（`Copyright (c) 2019 notscuffed`）
- **依据**：上游 `LICENSE` 原文（MIT 全文，2026-09-16 首次复核、**2026-09-17 复验** <https://raw.githubusercontent.com/notscuffed/repkg/master/LICENSE>）+ 项目所有者确认。既有文档里记成 GPL 的一侧（`docs/COPYING-RULES.md`、`<工作区>/docs/misc/PLUGIN-POLLUTION-AUDIT.md`、插件 README ×2 等）**系本仓库早期误记，已作废更正**——**逐处更正已在 2026-09-17 全部落地**，清单见工作区根 `<工作区>/docs/licensing/LICENSE-COMPAT-REVIEW.md` §10.1；规则修订见 `docs/COPYING-RULES.md` §6 + **§9.10**。
- **参考了什么**：作为 `.tex` 解码的**格式/取值权威**被引用（RG88 约定 `(rgb=G, a=R)`、与 ImageSharp `Rgba32` 一致、灰度=第二通道 G / alpha=第一通道 R 等）。
- **是否直接复制过代码**：**否（逐字）**。`core/we-scene-bundle.js` 里"BC1/BC2/BC3 **逐行对齐 RePKG 的 LibSquish 移植实现**"这一句若有事实基础，也属 MIT → GPL 的**允许方向**，署名与条款见 `THIRD-PARTY.md`；自述参考它的 267 行脚本已于 2026-09-16 删除。本机**无检出副本**（工作区未 vendor）。

#### (8) Aromatic05/we-layerd — **无许可（保留所有权利）**
- 仓库：<https://github.com/Aromatic05/we-layerd> ｜ 许可：**无 LICENSE 文件 = 保留所有权利**（比 GPL 更严）
- **许可查证（2026-09-17，L2）**：GitHub API `"license": null`；上游根目录无 `LICENSE`/`COPYING`/`NOTICE`；
  `Cargo.toml`（根 + 4 个成员 crate）**无 `license`/`license-file`/`repository`**；上游**自己的打包元数据自认无许可**
  （`package/archlinux/PKGBUILD:9` = `license=('custom:unlicensed')`，`package/fedora/we-layerd.spec:8` = `License: LicenseRef-Unlicensed`）。
  **另**：其 `.gitmodules` 把 **GPL-2.0-only** 的 `Aromatic05/wallpaper-engine-renderer`（pin `89dfcd86…`，= 本工作区 `wer-ref/`）
  作为渲染核心子模块捆入 ⇒ 连"照它的实现自写"都要避开该子模块。
- **参考了什么**：仅作一次行为对照（"该功能为零实现"的旁证）。**是否直接复制过代码**：**否**（全仓引用 = 26 文件 / 37 行**纯文字**，
  `import`/`readFile` **0** 命中）。本机检出副本在仓库外的 `we-layerd-ref/`，**不入库**、**不进任何产物**。
- **处置判定**：`docs/COPYING-RULES.md` **§9.8**（L2 完成 ⇒ 保持零引入）；无许可 / 不兼容上游的通用阶梯见同文件 **§9（L1–L5）**。

### 11.5 仅在许可兼容性研究中评估 —— **未参考其代码**

- **NixaXI/AnisPaper** — 仓库 <https://github.com/NixaXI/AnisPaper> ｜ 许可：**GPL-3.0**（其 `LICENSE` 只写 GPL-3.0，而项目自述多处写 or-later ⇒ **表述冲突，保守按 GPL-3.0-only 对待**，**未定/待核**）。
  **未参考其代码**：本仓库记录明确写着"本轮未借其代码"，本机**无检出副本**；它只出现在许可兼容性分析里（实为 C++/CMake + Qt + KDE Plasma 6）。

### 11.6 调研过但**未采用**（列出以说明"没参考过就不写进上面"）

`Paradox07127/macos-wallpaperengine`（MIT）、`oneincase/WallpaperEM`（MIT）、`pbadgpmeb22791-sketch/dsh-we-wallpaper`（MIT）—— 仅调研；
`lucaschnabel42/wallgl`（**无许可 ⇒ 不可借用**）、`NikoPit/wallpaper-engine-assets`（`license: null` ⇒ 不能作为"可分发"的先例）—— 明确排除；
`enenesser/earth-webgl`（检索噪声，不是同类项目）。

### 11.7 Wallpaper Engine 本体（专有）—— 不随仓库分发

- Wallpaper Engine 为 Valve/Steam 上的**专有软件**，其资产受 Steam 订户协议约束。本仓库**不分发**任何 WE 资产：
  贴图、官方着色器头、粒子预设、字体、音频、视频、工坊作品一律不含；运行时从**用户自己的** WE 安装按 `MPW_WE_ASSETS` 读取。
- 本项目内部 shader 实际引用的 6 个头已全部换成**自研的 API 兼容实现**
  （`shaders/common.h` / `common_blending.h` / `common_blur.h` / `common_composite.h` / `common_fragment.h` / `common_perspective.h`），
  每个文件头注明 `Original implementation for this project; API-compatible with the shader includes used here. No third-party code.`
- `common_vertex.h` **故意不发布**（管线零引用、`BuildTangentSpace` 零调用；重写后与 WE 原件"有效行 100% 重合"故不算独立实现产物）：
  留痕范围正式记为 **6 个**，原件与替换件都保留在仓库外的证据归档里；三条事实与复现命令见 `<工作区>/docs/misc/COMMON-HEADERS-REPLACEMENT.md` **§1.1**。

---

## 12. 许可与归属（License & credits）

> 本节是**交付物面板里的那一个链接**的落点（`:8902` 测试台「设置 → 归属与许可」只留一行链接指到这里，
> 不再在页面上堆署名与许可全文）。口径与 `THIRD-PARTY.md`、`docs/COPYING-RULES.md` 三处一致；
> 如发现不一致，**以事实为准**并同步修正这三处。

| 对象 | 许可 | 说明 |
| --- | --- | --- |
| **本仓库**（渲染器 / 自带服务器 / 测试台） | **GPL-3.0-or-later** | 全文见仓库根 `LICENSE`。分发本仓库或其衍生作品时，必须同样以 GPL-3.0-or-later 提供源码 |
| **上游渲染核心**：WebWallGL（[oneincase/webwallgl](https://github.com/oneincase/webwallgl)） | **MIT** | 本仓库的渲染核心由它**独立重写/移植**而来；MIT 许可要求保留其版权与许可声明 —— 全文见 `demo/LICENSE-webwallgl-MIT.txt` 与 `demo/LICENSE-webwallgl`（**文件随仓库保留**，只是不再在页面上单独列出链接） |
| **其它第三方组件**（vendored 转译器、字体、参考实现等） | 逐条登记 | 见 [`THIRD-PARTY.md`](THIRD-PARTY.md)：每条都给出版本、来源、许可与"是否随包分发" |
| **Wallpaper Engine 本体与其资产** | 专有（Valve/Steam） | **不随本仓库分发**；运行时只从**用户自己的** WE 安装读取（见 §11.7） |
| **真实壁纸包**（工坊作品 / 用户语料） | 各自作者所有 | **不随本仓库分发**：仓库只带一个**自造的合成样例**（`tools/make-sample.mjs` 生成），用户语料留在仓库外，用 `MPW_SCENE_ROOT` / `?pkgpath=` 指过去 |

**为什么页面上只留一个链接**：署名与许可全文属于**仓库文档**（GPL 要求"随分发提供"的是仓库里的
`LICENSE` / `THIRD-PARTY.md` / 两个上游 MIT 全文文件），把全文贴进产品界面既不利于阅读、也会随版本漂移；
界面只负责**把你指到唯一的权威位置**。

---

*本节与 `THIRD-PARTY.md`、`docs/COPYING-RULES.md` 的口径核对记录见 `docs/PATCHES.md`；
如发现三者不一致，**以事实为准**并同步修正这三处。*

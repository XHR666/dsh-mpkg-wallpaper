# PACKAGING —— 分发形态、离线 PWA、一键启动与自检入口（P-91 / P-92 / P-93）

> 依据：`<工作区>/docs/reverse/SIMILAR-PROJECTS-RESEARCH.md` **§6.1 第 1 条**（"分发形态：单文件 ESM + 打开即玩的静态 Demo
> —— 这是**唯一**能让我们 §5.1 的护城河被人看见的动作"）与 **§4.3**（分发与可见性：我们的结构性劣势）。
> 本文件是这些动作的**唯一的操作与自证手册**；渲染能力本身见 `docs/RENDERER-ARCHITECTURE.md`，逐层调试开关见
> `README-DIAGNOSTICS.md`，对外介绍见 `docs/README-PUBLIC.md`。
>
> ⚠ **免责声明**（版权 / 非官方 / 不附带任何 WE 素材）**以仓库 README 首屏为准**（由建仓线写入）；
> 本文件不重复表述，避免两份口径打架。

---

## 1. 三条命令（先看这个）

```bash
cd we-scene-demo

bash start-demo.sh                 # ① 一键启动：预检 → 起服务 → 打印 URL（Ctrl-C 停）
bash check.sh                      # ② 唯一自检入口：docs/publish/diag-flags + 全量门禁
npm pack --dry-run                 # ③ 分发自证：文件清单 + 体积（**不发布**）
```

| 命令 | 干什么 | 退出码 |
|---|---|---|
| `bash start-demo.sh` | 预检（node 版本 / 包解析器落点 / 语料 / 样例 / 端口）+ 起 `server/we-scene-demo-server.mjs` | 0 正常；2 用法错；3 预检失败 |
| `bash start-demo.sh --check` | **只预检**（CI 与首次排障用，不起服务） | 0 / 3 |
| `bash check.sh` | 4 阶段：`docs-check` → `publish-check` → `diag-flag-check` → `run-all-tests.sh` | 0 全过；1 有失败 |
| `bash check.sh --no-gate` | 只跑前 3 项静态自检（秒级；提交前用） | 0 / 1 |
| `bash check.sh --fast` | 门禁跳最慢项（等价 `run-all-tests.sh --fast`） | 0 / 1 |
| `node core/we-scene.mjs` | 不是 CLI；这是**库入口**（见 §3） | — |

**首次跑不通时先看 `bash start-demo.sh --check` 的输出** —— 它把"缺包解析器 / 缺语料 / 端口被占 / node 太老"
四类最常见的第一次失败提前说清，而不是让页面白屏。

---

## 2. 依赖解析：包解析器在哪（**唯一真正的外部依赖**）

渲染器**不解析** pkg 容器本身：包解析器在 **MIT 许可的插件 `dsh-mpkg-wallpaper`**（`lib/pkg-extract.js`，
2,252 行）。渲染器 import 它的发布产物，方向是 **MIT → GPL（允许）**，插件的 MIT 声明必须随渲染器分发保留
（规则 `docs/COPYING-RULES.md` §2.1，署名 `THIRD-PARTY.md` §7）。

解析链与 `server/we-scene-demo-server.mjs` **逐条同序**（`start-demo.sh --check` 用的是同一顺序）：

1. 环境变量 `MPW_PKG_EXTRACT` 指向任意一份 pkg-extract 的绝对路径（最高优先）
2. 同目录 `<repo>/pkg-extract.mjs`（自足分发：把插件产物复制过来，**保留其 MIT 声明**）
3. `<MPW_ROOT>/dsh-mpkg-wallpaper/lib/pkg-extract.js`（默认 `MPW_ROOT` = 本仓库父目录）

三条都不成立时 `start-demo.sh --check` 会**列出这三条修法**并 `exit 3`，不会让你面对一个 500 的服务器。

---

## 3. 分发形态

### 3.1 npm 包（`package.json`）

| 字段 | 值 | 说明 |
|---|---|---|
| `name` | `wallpaper-engine-web-loader` | 由建仓线拍板；本机实测 **npm 上未被占用** |
| `version` | `0.4.0` | 与 `core/we-scene.mjs` 的 `VERSION` **必须一致**（`mount-test.mjs` 断言）；发布流程见 `docs/RELEASE.md` |
| `license` | `GPL-3.0-or-later` | 与 `LICENSE` 一致 ⇒ `docs/COPYING-RULES.md` §8 ① 的机器闸门 |
| `type` | `module` | 仓库内所有 JS 模块都是 ESM（无 CJS，`packaging-test.mjs` 会扫） |
| `private` | `true` | **发布锁**：本机 npm 未登录前不允许 `npm publish`；发布由建仓线在登录后删除这一行 |
| `exports` | `.` → `core/we-scene.mjs`、`./bundle`、`./server`、`./hlsl2glsl`、`./package.json` | 每条目标都真实存在（断言过） |
| `files` | 39 条白名单 | 只发**运行时 + 公开文档 + 自带样例/字体/图标**；不含 `reports/`、`archive/`、`Testphoto/`、`*.bak-*`。**闭合性由 `tests/pack-closure-test.mjs` 钉住**（0.2.0 漏过三个新增模块 ⇒ 包一 import 就炸，见 `docs/PATCHES.md` P-167） |
| — | **白名单里没有整目录的 `docs/`** | 逐文件写 `docs/UNTOUCHED-AREAS.md` 而不是 `docs/`：目录级白名单会让**任何**后来加进 `docs/` 的文件（可能含作者个人绝对路径）静默进包；`packaging-test.mjs` 的 D 组就是这条的机器闸门 |

**tarball 只发运行时，不发测试台**：`run-all-tests.sh`、`check.sh`、60+ 个 `*-test.mjs` 都**不在** `files` 里。
门禁要配齐语料与夹具才有意义，把它塞进 tarball 只会让下载者跑出一堆 SKIP/FAIL 的假象。
门禁属于 **git 仓库**（§1 的 `bash check.sh`），tarball 属于**运行时**。

`npm pack` 实测（2026-09-16，`--dry-run`）：

```
161 文件（含 README.md + README.en.md）· tarball ≈2.63MB · 解包 ≈6.82MB · 最大单文件 core/we-scene-bundle.js（体积以 `node tests/packaging-test.mjs` 的实测读数为准）
打包清单含：core/we-scene.mjs / web/manifest.webmanifest / web/sw.js / web/sw-policy.mjs / web/icons/*.png /
            vendor/hlsl2glsl/* / samples/sample-synthetic/scene.pkg / LICENSE / THIRD-PARTY.md
打包清单不含：reports/** 、*.bak-* 、run-all-tests.sh 、check.sh
```

### 3.2 库入口 `mount(container, opts)`（P-91）

```js
import { mount } from 'we-scene-renderer'          // 或 './we-scene.mjs'
const h = mount('#stage', { scene, textures, onLog: console.log })
h.setQuality({ q: 'high', aa: 'fxaa', pp: 'high' }) // P-90 的三档，热更不重挂载
h.dispose()
```

**职责边界（故意做窄）**：`mount` 只负责 **画布 → 上下文 → 帧循环 → 帧末链（render → bloom → AA → hooks）→ 生命周期**；
**取包/解包/贴图上传/字体/音频/上报/面板**仍属**宿主装载层**，参考实现是 `demo.html` 的 `bootInstance()`
（帧序与本模块**逐条一致**，差异只在"谁提供素材"）。

依赖注入点：`opts.createRenderer` / `opts.raf` / `opts.cancelRaf` / `opts.now` / `opts.document`
—— 有了它们，`mount` 在 Node 里能被**桩渲染器**完整测试（`mount-test.mjs`，40 断言），不需要真 GL。

### 3.3 单文件 ESM 产物

`core/we-scene-bundle.js`（506KB，141 个导出）就是"单文件 ESM"，浏览器直接
`import { createRenderer } from '/we-scene-bundle.js'`。**本仓不做压缩/转译**：仓库的复现文化要求
"线上字节 = 仓库字节"（`pwa-test.mjs` F9/F10 就是这么断言 SW 与判据文件的）。

---

## 4. 离线 PWA（P-92）

### 4.1 开关（**默认关**）

| 开关 | 作用 |
|---|---|
| `MPW_PWA=1 node server/we-scene-demo-server.mjs` | 该服务器上**所有**首页都注入（部署一次，推荐） |
| `http://…/?pwa=1` / `?pwa=0` | 单次请求覆盖环境变量（临时试用 / 明确关闭） |

默认关的理由：它会写 Cache Storage。只有明确要"装成应用 / 离线可用"的部署才该打开。

> 这是**服务器侧**开关：`diag-flag-check.mjs` 的抓取源是 `core/we-scene-bundle.js` / `demo.html` /
> `elysia/**/*.js` / 插件 `lib/client.js`，**不含** `server/we-scene-demo-server.mjs` ⇒ README-DIAGNOSTICS 的
> "代码 ↔ 文档双向 0 差异"口径不受影响（登记处就是本节）。

### 4.2 结构

| 文件 | 作用 |
|---|---|
| `web/manifest.webmanifest` | `start_url = /?id=sample-synthetic`（**离线打开就有画面**）、`display: standalone`、3 个图标（含 maskable） |
| `web/sw.js` | **module** service worker：网络优先 + 缓存兜底；`activate` 清旧版本缓存 |
| `web/sw-policy.mjs` | **缓存判据**（纯函数、单一事实源）：`shouldCache()` / `shouldStoreResponse()` |
| `web/pwa-inject.mjs` | 首页注入（幂等；缺 `</head>` 原样返回）+ PWA 静态路由表 |
| `web/icons/` | 程序化生成的图标（`node tools/make-icons.mjs`，确定性、无第三方素材）+ `web/icons/icons.json` 的 sha256 台账 |

### 4.3 **绝不缓存用户壁纸**（用户点名要求，可断言）

判据是**白名单**而不是黑名单（黑名单漏一条就是把用户素材写进磁盘）：

- ✅ 缓存：`/`、`/demo.html`、bundle、`/elysia/**`、`/vendor/hlsl2glsl/**`、`/assets/fonts/**`、`/icons/**`、
  `manifest`/`sw`，以及**自带合成样例**的 `/pkg|project|type/sample-synthetic`
- ⛔ 不缓存：`/raw`、`?pkgpath=`、`?pkgurl=`、`/pkgdir?d=`、`/weassist/**`（用户本机 WE 资产）、
  `/report`、`/shot`、`/shots/**`、**任何非 `sample-synthetic` 的 `?id=` 与 `/pkg/<id>`**、
  非 GET、跨源、`video/*`/`audio/*`/`image/jpeg` 响应、>8MB 响应、畸形百分号编码

`pwa-test.mjs` 把这些逐条写成断言（正面 16 条 / 反面 21 条 / 响应判据 10 条，共 **107 条**）。
浏览器支持：module service worker 需 Chrome/Edge 91+、Safari 16.4+、Firefox 111+；**不支持时只是没有离线**，
`register()` 失败只写一条 `console.warn`，渲染功能完全不受影响（注入脚本里显式 `.catch`）。

---

## 5. 自检与 CI（`bash check.sh`）

`check.sh` **不改变**任何一项的语义与退出码，只做"依次跑 + 汇总 + 一条退出码"：

| 阶段 | 回答什么问题 | 关键口径 |
|---|---|---|
| `docs-check.mjs` | 文档互相引用的文件都在吗？P-编号健康吗？ | 15+ 文档 / 376+ 文件引用 / 0 缺失 |
| `publish-check.mjs` | **现在能不能发**？隐私 / 体积 / 专有文件 / vendored 许可 | 必须 `blocking: []`；零个人绝对路径；`vendor/*/` 必须有许可全文且在 `THIRD-PARTY.md` 被点名（P-93 新增的 ④b 规则） |
| `diag-flag-check.mjs` | 代码开关 ↔ `README-DIAGNOSTICS.md` 主表双向一致吗？ | 0 差异（当前 117 ↔ 117） |
| `run-all-tests.sh` | 全量回归 | 项数用 `bash run-all-tests.sh --list` 首行取（**不要写死数字**） |

CI 里建议就一行：

```bash
cd we-scene-demo && bash check.sh --fast
```

---

## 6. 未做 / 未定（诚实列）

| # | 项 | 现状 |
|---|---|---|
| 1 | **`npm publish`** | ⚪ **未发**。包名已定且 `npm view` 显示未占用；本机默认 registry 是镜像站、需显式 `--registry=https://registry.npmjs.org` 才认 token。发布由建仓线执行；`private: true` 是发布锁 |
| 2 | **GitHub Pages 在线试玩** | ⚪ **未部署**。静态托管下 `/pkg/<id>`、`/weassist` 等服务器端点在设计上不可用（合成样例需要 `/pkg/sample-synthetic`）⇒ Pages 需要先做"纯静态模式"的装载层（把自带样例改成静态路径），**未做** |
| 3 | **`mount()` 的素材装载层** | ⚪ 只做了"画布/帧循环/生命周期"这一半；取包/贴图上传仍要宿主自己写（§3.2 的边界） |
| 4 | **hlsl2glsl 接入可选效果路径** | ⚪ vendored + 覆盖率门禁已做（P-93），但在 `core/we-scene-bundle.js` 里**接线未做**（该文件由并发线独占） |
| 5 | **type 声明（`.d.ts`）** | ⚪ 无。`mount()` 的契约在 `mount-test.mjs` 里以断言形式存在 |
| 6 | **tarball 的 `files` 白名单** | ⚠ 我（P-91）只加了 `sw-policy.mjs`（①P-101 起在 `web/`）、移出 `check.sh`；其余条目由建仓线维护，若两边同时改同一字段会互相覆盖 |

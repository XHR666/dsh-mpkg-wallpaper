# liquid-glass 重复副本清理（审计附 B 第 8 条 / B7）—— 逐副本取证与处置

> 2026-09-18（本次提交的机器日期；任务书里写作 09-19）。任务来源：`../docs/PLUGIN-POLLUTION-AUDIT.md:212`（另见 `:37`、`:50`）的建议
> ——"建议顺手删掉 `lib/liquid-glass-bundle.js` 与 `tools/liquid-demo/vendor/` 的重复副本，
> 缩小许可证表面积"；编号见 `../docs/REMAINING-WORK-20260918-B.md:105`（B7）。
>
> **那条建议写在 `lgCss` 修好之前**。2026-09-18 `lgCss`（纯 CSS/SVG 液态玻璃）首次真正启用，
> 所以本轮**先取证、不假设这些文件是死副本**。
>
> **结论一句话**：真重复只有一处（`tools/liquid-demo/vendor/`，9 文件与 `lib/liquid-glass/`
> **sha256 两两相同**）——**已删，并把演示页改成加载唯一那一份**；
> `lib/liquid-glass/**` 与 `lib/liquid-glass-bundle.js` **不删**（前者被宿主路由在运行期读取且在
> 发布白名单内；后者不是逐字节副本、是可由前者确定性重建的发布内产物）。
> 审计第 8 条据此**部分执行、部分降级/作废**（见 §8）。

---

> **⚠ 口径更新（2026-09-19，`docs/PUBLISH-SURFACE-LIQUID-GLASS.md` P-127）**：本文里凡是
> "在发布白名单内 / 随包发布 / 删它属发布面决定"的表述（§1②、§4 第 6 项、§6.1、§8 第 1 行）
> **已被 P-127 取代**：用户已拍板移出发布面，`files` 加了负向模式
> `!lib/liquid-glass/**` + `!lib/liquid-glass-bundle.js` ⇒ 这 10 个文件**不再随包分发**
> （实测发布面 22 文件 / 1 626 235 B → 12 文件 / 1 389 781 B），**仓库内保留不变**
> （宿主 `/lg` 路由与演示页照旧）。本文其余取证（引用面/身份/sha256/删副本）**仍然有效**，
> 历史记录不改写。

## P-122 处置摘要

| 文件 / 组 | 是什么 | 运行期引用 | 发布面（`files:["lib"]`） | 处置 |
|---|---|---|---|---|
| `lib/liquid-glass/*.js`（9 文件，129 097 B，5830 行） | 外部 MIT 项目 `apple-liquid-glass-webgl` 的 vendored WebGL 渲染器库 | **有**：宿主 `/api/mpkg-wallpaper/lg/*` 路由 `readFileSync` 读取（`lib/index.js:3304`） | **在包内**（9/9） | **保留（唯一一份）** |
| `lib/liquid-glass-bundle.js`（107 420 B，2611 行） | `tools/build-lg-bundle.mjs` 把上面 7 个 V2 文件拼成的单文件产物 | 无（客户端不再内联它，见 §5） | **在包内** | **保留**（非逐字节副本 ⇒ 不满足"重复副本"判据） |
| `tools/liquid-demo/vendor/*.js`（9 文件，129 097 B） | 演示页的同一份库的**第二份物理副本** | 仅被演示页 `index.html` import | 不在（`tools/` 不在白名单） | **已删**（sha256 9/9 与 `lib/liquid-glass/` 相同），演示页改指唯一一份 |

---

## 1. 引用面取证（原始命令与分类计数）

```bash
grep -rn "liquid-glass\|liquidGlass\|mpw-lg-warp\|lgCss" lib/ tools/ package.json README*.md docs/ --include=* | grep -v node_modules
```

原始输出 **101 行**，按文件聚合：

```
     26 lib/client.js                 ← 全部是 `lgCss`（CSS 版开关），**不是**这套 vendored 库
     17 tools/switch-wiring-test.mjs  ← lgCss 判据
     10 README.en.md            9 README.md            4 docs/TOKEN-NAMESPACE.md
      4 tools/bundle-equivalence-test.mjs   4 tools/build-bundle.mjs
      3 tools/probe-out/style-scope.json    3 tools/liquid-demo/server.mjs
      3 tools/build-lg-bundle.mjs           3 lib/index.js
      2 tools/style-scope-guard.mjs         2 tools/panel-smoke.mjs
      2 tools/inline-lg-bundle.mjs          2 tools/inline-lg-b64.mjs
      1 tools/token-namespace-test.mjs      1 tools/probe-out/bundle-manifest.json
      1 tools/liquid-demo/index.html        1 tools/frost-rail-test.mjs
      1 tools/css-matrix.mjs                1 tools/check.sh
      1 tools/better-sidebar-compat-test.mjs
```

四类分清（这是本轮的关键区分）：

**① 运行期引用（`lib/**`，删了就坏）——29 行，其中真正指向这套库的只有 3 行**

```
lib/index.js:3294    // ①(新) 液态玻璃(测试)：静态托管 liquid-glass 渲染器源码（浏览器动态 import）。
lib/index.js:3295    // 路径 /api/mpkg-wallpaper/lg/<file>.js → lib/liquid-glass/<file>（防穿越，只允许 .js）。
lib/index.js:3304    const lgDir = join(fileURLToPath(new URL('.', import.meta.url)), 'liquid-glass');
```

`lib/index.js:3299-3314` 注册 `kind:'prefix'` 的 `/api/mpkg-wallpaper/lg` 路由，命中时对
`lib/liquid-glass/<file>` 做 `existsSync/statSync/readFileSync` 并以 `text/javascript` 回包。
**这是活代码路径**：删掉目录 ⇒ 该路由从"200 + 逐字节原文"变成 404。
无客户端调用方（`lib/client.js` 里 `liquid-glass` 0 命中、无 `import()` / `lgModule` 读取），
所以它是**"可达但无调用方"的路由**，不是死文件。

`lib/client.js` 的 26 行命中全是 `lgCss`/`lgCssAmount`/`url(#mpw-lg-warp)`（CSS/SVG 版玻璃的
开关与标记），与 `lib/liquid-glass/` 无任何关系——**两者同名不同物**，这是审计当时最容易混的一处。

**② 发布面（`package.json`）——字面命中 0 行，但是"隐式进包"**

```json
"files": ["lib", "!lib/**/*.bak*", "!lib/**/*.tmp*", "!lib/**/*.orig",
          "icon.svg", "cordis.patch.yml", "README.md", "README.en.md", "THIRD-PARTY.md", "LICENSE"]
"exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" }
```

`files:["lib"]` 是**目录级**白名单 ⇒ `lib/liquid-glass/**`（9 文件）与
`lib/liquid-glass-bundle.js` 都随包发布；`exports` 不导出它们（只导出 index/client/package.json）。
按 `files` 语义模拟发布面（不跑 `npm pack`）：白名单命中 **21 个文件 / 1582 KB**（不含 npm 恒带的
`package.json`），其中 `lib/liquid-glass/` **9 个 / 129 097 B**、`lib/liquid-glass-bundle.js`
**107 420 B** 在内，`tools/` 下**任何**文件都不在内。旁证：`node tools/integrity-check.mjs` 第 ⑨ 节
（内部 `npm pack --dry-run --json`）报 **22 个文件**（含 `package.json`）、
`✓ ★ lib/ 全部 6 个运行时 js 进包`、`✓ ★ LICENSE 随包发布`、`✓ ★ THIRD-PARTY.md 随包发布`。

**③ 构建/测试引用**

| 文件 | 引用什么 | 删了会怎样 |
|---|---|---|
| `tools/build-lg-bundle.mjs:8` | 读 `lib/liquid-glass/` 的 7 个 V2 文件 → 写 `lib/liquid-glass-bundle.js` | 构建工具失效 |
| `tools/inline-lg-bundle.mjs:8` | 读 `lib/liquid-glass-bundle.js` | 失效（该工具的占位区已不存在，见 §5） |
| `tools/inline-lg-b64.mjs:10` | 读 `lib/liquid-glass-bundle.js` | 同上 |
| `tools/build-bundle.mjs:660-673` | `--check`：伴生 `liquid-glass/` 在 ⇒ `/lg/v2-geometry.js` 必须 200 且与源码逐字节相同；不在 ⇒ 必须 404 | 删目录 ⇒ 伴生布局断言失去对象 |
| `tools/bundle-equivalence-test.mjs:259-263` | 把 `ROOT/lib/liquid-glass/v2-geometry.js` 复制进夹具，断言 200 + 逐字节相同 | **删目录 ⇒ `copyFileSync` ENOENT，该测试直接崩**（本轮未跑它：不在允许的秒级清单内，仅静态取证） |
| `tools/better-sidebar-compat-test.mjs:114` | 只是注释（说明为何不整目录 `cpSync`） | 无影响 |
| `tools/probe-out/{style-scope,bundle-manifest}.json` | 探针产物（`.gitignore` 忽略），非测试输入 | 无影响 |

**④ 纯历史副本**：`tools/liquid-demo/vendor/**`（9 文件，本次删除）、
`lib/client.js.bak-20260907`（`files` 负向模式排除，不进包）。

---

## 2. 逐副本身份：sha256 / 行数 / 首行

```
FILE                                   SHA256(前16)      LINES  FIRST LINE
lib/liquid-glass/geometry.js           260e9d6a6960554f   229   // CPU mirror of the shape maths in FS_GLASS.
tools/liquid-demo/vendor/geometry.js   260e9d6a6960554f   229   ← 相同
lib/liquid-glass/index.js              1accae280917af69   483   import { GlassRenderer, MIPS } from './renderer.js';
tools/liquid-demo/vendor/index.js      1accae280917af69   483   ← 相同
lib/liquid-glass/material.js           632f030e7bafccac   130   // Physical + artistic parameters of the material.
tools/liquid-demo/vendor/material.js   632f030e7bafccac   130   ← 相同
lib/liquid-glass/renderer.js           6037f8129f31d4cc   640   import { VS_FULLSCREEN, VS_GLASS, ... } from './shaders.js';
tools/liquid-demo/vendor/renderer.js   6037f8129f31d4cc   640   ← 相同
lib/liquid-glass/shaders.js            e11c8493ec561084   787   // GLSL sources for the Liquid Glass replica.
tools/liquid-demo/vendor/shaders.js    e11c8493ec561084   787   ← 相同
lib/liquid-glass/v2-geometry.js        3029655dbb38a6cc    65   // CPU mirror of the V2 transparent shader's geometry.
tools/liquid-demo/vendor/v2-geometry.js 3029655dbb38a6cc  65   ← 相同
lib/liquid-glass/v2.js                 cd8deca3e8ec9994   537   import { GlassRenderer } from './renderer.js';
tools/liquid-demo/vendor/v2.js         cd8deca3e8ec9994   537   ← 相同
lib/liquid-glass/v2-material.js        2100f2b4f211b94f    71   // V2 is the clear optical material from the transparent renderer.
tools/liquid-demo/vendor/v2-material.js 2100f2b4f211b94f  71   ← 相同
lib/liquid-glass/v2-shaders.js         708e94b1ce273fcc   269   // The V2 clear/transparent optical model.
tools/liquid-demo/vendor/v2-shaders.js 708e94b1ce273fcc   269   ← 相同
lib/liquid-glass-bundle.js             db50361cfd3d8606  2611   // 自动生成：液态玻璃单一 bundle（build-lg-bundle.mjs），勿手改
```

**9/9 组两两 sha256 相同 ⇒ 这 9 对是**逐字节相同的重复副本**（判据达成）。
`liquid-glass-bundle.js` **与任何保留文件都不逐字节相同**（它是带转换的拼接产物）⇒
按本轮判据**不算**重复副本。

文件系统旁证：`lib/liquid-glass/*.js` 与 `lib/liquid-glass-bundle.js` 的 `nlink` 均为 **2**
（`tools/liquid-demo/vendor/*.js` 为 1）——即仓库之外还有第二组硬链接（备份）。删除仓库内路径
**不释放磁盘、也不动那份备份**；未在 `/root`、`/tmp`、工作区（≤4 层）内找到第二路径，**未证实项**见 §9。

---

## 3. 删了什么（唯一一处真重复）

```
删除：tools/liquid-demo/vendor/{geometry,index,material,renderer,shaders,
                              v2-geometry,v2,v2-material,v2-shaders}.js
      9 文件 / 129 097 B（sha256 与 lib/liquid-glass/ 同名文件 9/9 相同）
```

判据链（三条同时成立才删）：

1. **逐字节相同**：9/9 sha256 相同（§2）。
2. **不在发布白名单**：`files` 只含 `lib`，`tools/` 不进包（§1② 模拟 + integrity ⑨ 旁证）。
3. **不是测试夹具**：`grep -rn vendor tools/*.mjs tools/*.sh tools/*.py` 无一处指向该目录
   （3 处命中是 `web-wallpaper-test.mjs` 里另一概念的 `vendored`）；只有演示页 `index.html`
   自己 import 它。

**但"演示页还在用它"⇒ 不能只删不接**。故同时改两处，让演示页加载唯一那一份（`lib/liquid-glass/`）：

- `tools/liquid-demo/server.mjs`：新增 `/lg/` 挂载 → `<repo>/lib/liquid-glass/`，
  只允许 `.js`、拒绝 `/`、`\`、`..`（与宿主 `/lg` 路由同口径）；原目录服务与穿越防护不变。
- `tools/liquid-demo/index.html:63`：`from './vendor/v2.js'` → `from '/lg/v2.js'`。

依赖闭包核对：从 `v2.js` 出发可达 **7** 个模块
（`v2, renderer, geometry, shaders, v2-shaders, v2-material, v2-geometry`），
目录内共 **9** 个（多出 V1 入口 `index.js` 与 `material.js`，演示页不使用）⇒ 挂载整目录即可满足全部依赖。
渲染器内部 `import './v2-material.js?frost-ratio=1'` 这类**带 query 的 import** 由
`url.pathname`（天然剥离 query）正确落到 `/lg/v2-material.js`——已实测（见 §4）。

真实 HTTP 面端到端验证（短时本地服务，**未启动任何浏览器**）：

```
node tools/liquid-demo/server.mjs 3089 &        # timeout 25 秒自清理
GET /                       → HTTP=200 bytes=9197   服务出的 import 行: from '/lg/v2.js'
GET /lg/v2.js               → 200  byte-identical
GET /lg/renderer.js         → 200  byte-identical
GET /lg/geometry.js         → 200  byte-identical
GET /lg/shaders.js          → 200  byte-identical
GET /lg/v2-shaders.js       → 200  byte-identical
GET /lg/v2-material.js      → 200  byte-identical
GET /lg/v2-geometry.js      → 200  byte-identical
GET /lg/v2-material.js?frost-ratio=1 → 200  byte-identical（query 兼容）
GET /lg/..%2findex.html     → 403（穿越防护仍有效）
GET /lg/v2.js.bak           → 403（扩展名白名单仍有效）
GET /vendor/v2.js           → 404（旧副本路径，如预期）
```

---

## 4. "删了不坏"判据：允许清单内的 6 项秒级测试，逐个退出码

全部**串行**单跑（内存紧张，不与任何其它进程并行）：

| # | 命令 | 删除前 | 删除后 |
|---|---|---|---|
| 1 | `node tools/panel-smoke.mjs` | **exit 0**（面板冒烟 5/5 通过） | **exit 0**（5/5 通过） |
| 2 | `node tools/switch-wiring-test.mjs` | **exit 0**（26 通过 / 0 失败） | **exit 0**（26 通过 / 0 失败） |
| 3 | `node tools/css-matrix.mjs` | **exit 0**（1115 组设置） | **exit 0**（1115 组设置） |
| 4 | `node tools/style-scope-guard.mjs` | **exit 0**（233 OK / 134 ALLOWLISTED / 0 RED） | **exit 0**（同左） |
| 5 | `node tools/build-bundle.mjs --check` | **exit 0**（19 通过 / 0 失败） | **exit 0**（19 通过 / 0 失败） |
| 6 | `node tools/integrity-check.mjs` | **exit 0**（61 通过 / 0 失败） | **exit 0**（61 通过 / 0 失败） |

理由：本次删除只动 `tools/liquid-demo/`（不进包、无测试依赖），上述 6 项都不读该目录；
真正可能受影响的 `tools/bundle-equivalence-test.mjs` 读的是 `lib/liquid-glass/`——**未删**，
故不受影响（该测试不在允许的秒级清单内，本轮只做静态取证，不跑）。

---

## 5. 反向自证：把**保留**那份的 1 个字节改坏（只在 `/tmp` 副本里）

真树全程未改（§5.6）。实验在 `/tmp/lg-mut`（`cp -a lib tools dist package.json ...` 的副本）内做：

| 步 | 操作 | 结果 |
|---|---|---|
| S1 | 副本原样、默认布局（`dist/` 旁**无** `liquid-glass/`） | `--check` **exit 0**；走 404 分支 |
| S2 | `cp -r lib/liquid-glass dist/liquid-glass`（伴生布局） | `--check` **exit 0**；`✓ /lg/v2-geometry.js：伴生 liquid-glass/ 在 ⇒ 200 且与源码逐字节相同 [len=2847]` |
| S3 | **变异**：`v2-geometry.js` 第 1 行 `V2 transparent` → `V3 transparent`（1 字节，sha256 `3029655d…` → `2c63fa99…`） | `--check` **exit 1**，变红断言：<br>`✗ /lg/v2-geometry.js：伴生 liquid-glass/ 在 ⇒ 200 且与源码逐字节相同 → len=2847`<br>`对拍结果: 18 通过, 1 失败` |
| S4 | 同一个变异 + 默认布局（去掉 `dist/liquid-glass/`） | `--check` **exit 0** ⇒ **覆盖盲区**：默认布局下此测试只断言 `/lg/*` 404，**不校验保留副本内容** |
| S5 | 还原该字节（从真树 copy 回）+ 伴生布局 | `--check` **exit 0**，该断言重新变绿（因果闭合） |
| S6 | `sha256sum -c /tmp/keep-before.sha256`（跑前快照：9 文件 + bundle） | **10/10 成功，exit 0 ⇒ 真树逐字节未改动** |

**自证结论**：`lib/liquid-glass/v2-geometry.js` 的**内容真的流经运行期路径**
（宿主 `/lg` 路由 `readFileSync` → 回包字节），被改 1 字节就会被机器判据抓到 ⇒ 它是**被引用、被检验**的
活文件，不是"删了也没人管"的死副本。

**同时暴露的覆盖盲区（诚实记录）**：在**默认布局**（`dist/` 旁无 `liquid-glass/`）下，
允许清单内的 6 项测试**没有一项**校验该目录的**内容**（只断言 404 分支）；
能抓到内容变异的只有"伴生布局"分支（`cp -r lib/liquid-glass dist/` 后跑 `--check`）
与未在秒级清单内的 `bundle-equivalence-test.mjs`（它只做 复制↔原文 对拍，
两侧同源 ⇒ 对内容变异其实也不敏感）。**即：保留副本的内容目前只有"伴生布局 + `--check`"这一条机器判据。**

---

## 6. 为什么 `lib/liquid-glass-bundle.js` 不删（对审计第 8 条的降级）

1. **在发布白名单内**（`files:["lib"]` ⇒ 随包发布）。删它 = 改发布面，属"发布决定"，不是"清副本"。
2. **不是逐字节重复副本**：它是 `tools/build-lg-bundle.mjs` 的**转换型拼接产物**（去 `import`、
   `export`→声明、`v2.js` 的 `SHAPES`→`SHAPES_V2` 重命名、加 `// ===== <file> =====` 分隔）。
   按本轮判据（逐字节相同才叫重复副本）它不达标。
3. **可由保留那份确定性重建**（在 `/tmp` 副本实测）：
   `node tools/build-lg-bundle.mjs` → 产物 sha256 `db50361cfd3d8606…` 与仓库里已提交的
   `lib/liquid-glass-bundle.js` **逐字节相同** ⇒ 源与产物一一对应、无独立信息，但也**不是死副本**：
   它是构建工具的输出与两个 inline 工具的输入。
4. 顺带查明的**文档漂移**（不在本轮改动范围，故只记录）：`README.md:566`/`README.en.md:568`
   写它"入库是因为它是**运行期输入**（被 `tools/inline-lg-bundle.mjs` 写进 `lib/client.js`
   的模板常量）"——**该说法已不成立**：`lib/client.js` 里既无 `LG_BUNDLE_B64` 也无
   `LG_BUNDLE_SRC` 常量（全文件 `B64` 命中仅 1 行，是 `:5015` 的**注释**），
   两个 inline 工具现在跑起来会直接报 `client.js 缺少 … 占位区`。
   ⇒ 它是**构建期产物**，不是运行期输入。建议后续单独一行更正 README（本轮不碰 README，
   避免与其它并行任务在同一文件上交叉提交）。

---

## 7. 第三方登记（`THIRD-PARTY.md` §1.3 已更新）

- 出处：外部 MIT 项目 **`apple-liquid-glass-webgl`**（"复用 …（MIT，零依赖）源码 →
  `lib/liquid-glass/` + `vendor/`"）。**唯一记录是提交 `d13019d`**
  （2026-08-24，`feat: 液态玻璃(测试) tab + …`）；仓库内**没有**上游 URL/commit/版本号，**未证实项**见 §9。
- 许可：MIT（**要求**随副本携带版权与许可声明）。
- **核对出来的问题（已在 THIRD-PARTY 里更正）**：§1.3 原写"其 MIT 声明随文件保留"——
  **不成立**。对 9 个文件 + bundle 逐个 grep，命中数全为 0：

  ```
  'MIT License' => 0   'Copyright (c)' => 0   'Copyright ©' => 0
  'SPDX-License-Identifier' => 0   'Permission is hereby granted' => 0
  'github' / 'http' / 'apple-liquid' / 'upstream' / '来源' => 0
  ```

  ⇒ 保留副本**不带任何上游署名**，署名义务目前只由 `THIRD-PARTY.md`（+ 提交记录）承担。
  已在 §1.3 写明该事实与 sha256 清单，并把"补上游 LICENSE 正文"列为未证实项。
- sha256 清单（10 项，与 §2 同）：已登记进 `THIRD-PARTY.md` §1.3。

---

## 8. 审计第 8 条的销账（哪些作废、哪些降级、哪些执行）

| 审计原话 | 复核结论 |
|---|---|
| `:212`"删掉 `lib/liquid-glass-bundle.js` … 的重复副本，缩小许可证表面积" | **降级为保留**：在发布白名单内、非逐字节副本、可由保留源确定性重建（§6）。删它属发布面决定（应并入一次版本/发布决策），不由清理动作顺手做 |
| `:212`"删掉 … `tools/liquid-demo/vendor/` 的重复副本" | **已执行**：9/9 逐字节相同、不在白名单、非测试夹具；演示页改指唯一一份并实测通过（§3） |
| `:37`"同一份 vendored 副本存了两处" | **属实并已消除**：现在仓库内该库**只有一份**物理副本（`lib/liquid-glass/`）。⚠ 但 `nlink=2` 说明仓库外仍有硬链接备份，不在本轮范围（§9） |
| `:37`/`:212`"已是**无运行时引用**的死文件"/"遗留死文件" | **作废**：`lib/liquid-glass/` 被宿主 `/lg` 路由在运行期 `readFileSync` 读取（`lib/index.js:3304`）＝**无调用方的可达路由**。准确说法是"客户端无引用、宿主仍托管、随包发布"。README:74/545 与 `:72/549` 的"死文件"定性同样偏重，属文档漂移 |
| `:50`"`tools/liquid-demo/**` 与 `lib/liquid-glass/` 同 md5" | 属实（已消重） |

**销账口径**：`tools/liquid-demo/vendor/**` 从"疑似污染"名单**移除（已删）**；
`lib/liquid-glass/**` 与 `lib/liquid-glass-bundle.js` 从"疑似污染"名单**移除（复核后保留，理由入档）**；
许可证表面积净减 129 097 B（仓库内该库副本数 2 → 1）。

---

## 9. 未证实项 / 残留风险

1. **上游 URL、commit、版本号、上游 LICENSE 正文均未被记录**：全工作区只有字符串
   `apple-liquid-glass-webgl`（`THIRD-PARTY.md:44`、`docs/PLUGIN-POLLUTION-AUDIT.md:37/212`、
   `docs/archive/PROGRESS.md:1017`）。联网检索返回若干同名/近名的候选项目，但**没有一个能被证实
   就是本副本的上游**（本轮不猜、不落 URL）。⇒ MIT 署名义务目前**不能**逐字满足；
   补法：找到上游后把其 LICENSE 正文与版权行落到 `THIRD-PARTY.md` 或随附文件。
2. **保留副本的内容覆盖只有一条判据**：默认布局下 6 项秒级测试都不校验其内容（§5 S4 实测）；
   能抓内容变异的只有"伴生布局 + `build-bundle.mjs --check`"。建议（未做，需发布面/门禁决定）：
   在 `tools/check.sh` 里加一条对 `lib/liquid-glass/` 的 sha256 清单断言。
3. **仓库外第二组硬链接未定位**（`nlink=2`，`/root`、`/tmp`、工作区 ≤4 层内未找到第二路径）：
   删除仓库内路径不释放磁盘；那份备份是否含同一内容、是否也需要清理，**未证实**。
4. **演示页的 WebGL 渲染未在浏览器里验证**（本轮硬约束：禁止启动任何浏览器；本机无 X11）。
   已证的只是 HTTP 面（7/7 模块 200 且逐字节相同、query 兼容、403/404 防护）。
   `--check` / 秒级测试都不覆盖这个演示页。
5. **未跑**（不在允许清单内或属重活）：`bash tools/check.sh`（12 步，第 9 步起无头 Firefox）、
   `npm pack`、`tools/bundle-equivalence-test.mjs`、`tools/better-sidebar-compat-test.mjs`。
   其中 `bundle-equivalence-test.mjs` 对本轮结论的影响已静态取证（它读 `lib/liquid-glass/`，未删）。
6. **README 两处漂移未改**（§6.4 的"运行期输入"、§8 的"死文件"定性）：为避免与并行任务在同一文件
   交叉提交，只在本文件记录，建议由单线任务一次性更正。

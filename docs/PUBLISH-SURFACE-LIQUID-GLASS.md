# 把 liquid-glass 移出**发布面**（发布面 −10 文件 / −236 517 B）

> 2026-09-19（本机日期；任务书写作 09-19）。来源：`../docs/ANSWER-REMAINING-AND-API-20260918.md` §3 的
> **S-1**（发布面体积，`:346`）、**S-3**（留源删产物，`:348`）、**S-5(B)**（署名义务面，`:360`）三条
> —— 原文把这三条列为"**需用户拍板**"，**用户已拍板：「Liquid glass 移出发布面」**。
> 承接：`docs/LIQUID-GLASS-DEDUP.md`（P-122，去重那轮；本文只做**发布面**动作，**不动仓库内文件**）。
>
> **编号说明**：写入前实测 `grep -n '^## P-1' docs/*.md` ⇒ 本仓 docs 里最高是 **P-122**；
> 但 **P-123/P-124/P-125 已被并行线占号**（`we-scene-demo/docs/PATCHES.md:8631/8638-8640`
> 明确写"P-122/P-123 是并行线占号，故用 P-124"），且 **P-126 也已被占**
> （`we-scene-demo/docs/AUDIT.md:22` 逐粒子 RGB 修复）⇒ 本节取 **P-127**（下一个空闲号）。

---

## P-127 一句话结论

`package.json` 的 `files: ["lib"]` 是**目录级**白名单 ⇒ `lib/liquid-glass/**`（9 文件）+
`lib/liquid-glass-bundle.js` 共 **10 文件 / 236 517 B** 随包发布。本轮给 `files` 加两条**负向模式**
把它们移出发布面：**发布面 22 文件 / 1 626 235 B ⇒ 12 文件 / 1 389 781 B**（`npm pack --dry-run --json` 实测），
**仓库内 10 个文件一个不少**（宿主 `/api/mpkg-wallpaper/lg` 路由是活路径，`lib/index.js:3304` 运行期
`readFileSync` 读它们；`tools/liquid-demo/` 演示页也挂这一份）。
净效果：**少分发 10 个文件**、**不再分发本包唯一一份 vendored 第三方码** ⇒ **MIT 署名义务面随之消失**
（S-5(B)）；同时 `lib/` 里**其它**运行时 js（`client.js`/`index.js`/`pkg-extract.js`/`web-wallpaper.js`/
`web-interaction.js`）**一个都没被排除**（`tools/integrity-check.mjs` 的成员断言逐条钉住）。

---

## 1. 改了什么（两处，共 3 行代码 + 2 条断言）

```jsonc
// package.json（负向模式必须排在目录级白名单 "lib" 之后；npm 的 files 按顺序套用 gitignore 式规则）
"files": [
  "lib",
  "!lib/**/*.bak*",
  "!lib/**/*.tmp*",
  "!lib/**/*.orig",
  "!lib/liquid-glass/**",          // ← ①(P-127) 9 个源文件
  "!lib/liquid-glass-bundle.js",   // ← ①(P-127) 1 个派生产物
  "icon.svg", …
]
```

`tools/integrity-check.mjs` 第 ⑨ 节新增**双向**机器断言（发布面这件事不能只靠"手工看一眼"）：

| 断言 | 抓什么 |
|---|---|
| `★ liquid-glass 的 10 个路径**不在**发布面（files 负向模式生效）` | 负向模式被删/被写错（`!lib/liquidglass/**` 这类拼写漂移）⇒ 文件漏进包 ⇒ **判红**（实测见 §4 变异） |
| `★ 但仓库内 10 个文件**一个都不能少**（宿主 /lg 路由 + liquid-demo 运行期读它们） | 后人把"移出发布面"误读成"删文件" ⇒ 宿主路由与演示页一起坏 ⇒ **判红** |
| `★ lib/ 全部 5 个运行时 js 进包（不含有意排除的 1 个）` | 原断言是"`lib/*.js` **全部**进包"，移出后它**必然红** ⇒ 改成"期望进包集合 = 全部 − 有意排除"，**其余一个都不许少** |

> 诚实记录：这条改动让 `integrity-check` 的通过条数从 **61 → 65**（`files` 里两条负向模式各计入
> 一条 `白名单负向排除项` 断言 ⇒ +2；两条新断言 ⇒ +2）。任务书的判据写的是"仍 61/0"，
> 但**原 61 条里的"全部 lib/*.js 进包"在移出后不可能同时为真**，只能改口径；数字变化已如实登记。

---

## 2. 发布面实测（`npm pack --dry-run --json`，改前 / 改后各一次）

| | 文件数 | 未压缩字节(npm 报的 Σ`files[].size`) | tarball |
|---|---|---|---|
| **改前** | **22** | **1 626 235 B** | 530 687 B |
| **改后** | **12** | **1 389 781 B** | 未取（省一次 pack；差值与下方逐项相加自洽） |
| 净变化 | **−10** | **−236 454 B** | — |

差值自洽：被排除的 10 个文件 **236 517 B**，`package.json` 因加两条负向模式 **+63 B**
（1 673 → 1 736 B）⇒ −236 517 + 63 = **−236 454 B** ✓。

**被排除的 10 个文件（改前 `npm pack --dry-run --json` 原始清单里逐个核过）**：

```
  107420  lib/liquid-glass-bundle.js
   20634  lib/liquid-glass/v2.js
   16732  lib/liquid-glass/index.js
   13338  lib/liquid-glass/v2-shaders.js
    9388  lib/liquid-glass/geometry.js
    4797  lib/liquid-glass/material.js
   24762  lib/liquid-glass/renderer.js
   34499  lib/liquid-glass/shaders.js
    2847  lib/liquid-glass/v2-geometry.js
    2100  lib/liquid-glass/v2-material.js
----------  合计 129 097 B（9 个源文件）+ 107 420 B（派生产物）= 236 517 B
```

**改后发布面 12 个文件**（= 改前 22 个 **减去**上面 10 个；成员由断言逐条钉住，总数由
`拿到包清单（12 个文件）` 钉住）：
`LICENSE`、`README.md`、`README.en.md`、`THIRD-PARTY.md`、`cordis.patch.yml`、`icon.svg`、
`package.json`、`lib/client.js`、`lib/index.js`、`lib/pkg-extract.js`、`lib/web-wallpaper.js`、
`lib/web-interaction.js`。
> 口径：改后清单是**推导**（22 − 10 = 12，且每个成员都有断言）而不是再跑一次 pack 枚举的；
> 复核命令见 §6"需要主对话串行跑"。

---

## 3. 为什么"排除"而不是"删除"（四个证据）

| # | 证据 | 命令 / 位置 |
|---|---|---|
| 1 | **宿主路由是活代码路径**：`kind:'prefix'` 的 `/api/mpkg-wallpaper/lg` 命中 `.js` 时 `readFileSync(lib/liquid-glass/<file>)` 并以 `text/javascript` 回包 | `lib/index.js:3294-3314` |
| 2 | **缺目录时优雅降级**：`lgDir` 在 **handler 内**求值，`existsSync(target)` 不成立 ⇒ `404 {ok:false,error:'not found'}`（**注册期不读目录** ⇒ 从 npm 安装、没有 `lib/liquid-glass/` 的副本**不会**因为这条路由而加载失败） | 同上 `:3304-3308`（本轮逐行核过；**未**跑 HTTP 实测） |
| 3 | **客户端 0 调用方**：`lgModule`（`lib/client.js:4331`）全仓只此一处、**从未赋值**；`lib/client.js` 里 `liquid-glass` 字面命中 0（26 处全是**同名不同物**的 `lgCss`，见 P-122 §1①） | `grep -c 'liquid-glass' lib/client.js` ⇒ 0 |
| 4 | **产物可逐字节重建**：`node tools/build-lg-bundle.mjs` 的产物 sha256 `db50361cfd3d8606…` 与入库那份相同 ⇒ 排除产物不丢信息 | `docs/LIQUID-GLASS-DEDUP.md` §6.3、`THIRD-PARTY.md` §1.3 末 |

⇒ 从**发布面**移出（`files` 负向模式）同时满足两件事：**npm 用户不再收到 236 KB 的零调用方代码**，
而**本机开发 / 演示 / 宿主 `/lg` 路由照旧**（文件仍在仓库里）。

**行为变化的唯一一处（如实记录）**：从 npm 装出来的副本上，`GET /api/mpkg-wallpaper/lg/<file>.js`
由"200 + 逐字节原文"变成 **404**。因为**包内 0 调用方**（证据 3），可观测影响面只有"包外未知第三方"；
本机（仓库内开发/演示）不受影响。

---

## 4. 判据（实跑；本轮硬约束：禁止启动任何浏览器）

### 4.1 `node tools/integrity-check.mjs` —— **65/0**（改前基线 61/0）

```
== ⑨ 发布包内容清单（npm pack --dry-run --json）==
  ✓ 拿到包清单（12 个文件）
  发布面（npm 报的未压缩字节）: 12 个文件 / 1389781 B
  ✓ ★ liquid-glass 的 10 个路径**不在**发布面（files 负向模式生效 ⇒ 不分发 vendored 第三方码，署名义务面消失）
  ✓ ★ 但仓库内 10 个文件**一个都不能少**（宿主 /lg 路由 + liquid-demo 运行期读它们）
  ✓ ★ lib/ 全部 5 个运行时 js 进包（不含 ①(P-127) 有意排除的 1 个：liquid-glass-bundle.js）
  ✓ ★ 运行时文件在包内: lib/index.js
  ✓ ★ 运行时文件在包内: lib/client.js
  ✓ ★ 运行时文件在包内: lib/pkg-extract.js
  ✓ ★ 运行时文件在包内: lib/web-wallpaper.js
  ✓ ★ 运行时文件在包内: lib/web-interaction.js
  ✓ ★ 发布包不含备份/临时文件（*.bak*/*.tmp*/*.orig）
  ✓ ★ 发布包不夹带 client.js 的历史副本
  ✓ ★ THIRD-PARTY.md 随包发布（第三方归属/洁净室记录，MIT 署名义务）
  ✓ ★ LICENSE 随包发布
结果: 65 通过, 0 失败
✓ 插件完整性自检通过（配合 tools/check.sh 的 12 步门禁一起看）
```

### 4.2 四项秒级测试（串行单跑，逐个退出码）

| # | 命令 | rc | 输出摘要 |
|---|---|---|---|
| 1 | `node tools/panel-smoke.mjs` | **0** | 5/5 通过 |
| 2 | `node tools/switch-wiring-test.mjs` | **0** | 26 通过 / 0 失败（P-127 未动它） |
| 3 | `node tools/css-matrix.mjs` | **0** | 1115 组设置全过 |
| 4 | `node tools/style-scope-guard.mjs` | **0** | 233 OK / 134 ALLOWLISTED / 0 RED |

理由：本改动只动 `package.json.files` 与 `tools/integrity-check.mjs`，不碰 `lib/**` 一个字节，
上述测试的输入（`lib/client.js`、注入 CSS）逐字节未变 ⇒ 绿是"同输入同输出"，不是"放宽断言"。

### 4.3 变异自证（RED-if-reverted；在 `/tmp/p127-mut` 副本里做，真树不动）

`tar -c --exclude=node_modules --exclude=.git --exclude=dist . | tar -x -C /tmp/p127-mut` 复制整仓，
在副本里**只**把 `package.json` 的两条负向模式删掉（= 回到改前状态），跑 `node tools/integrity-check.mjs`：

```
== ⑨ 发布包内容清单（npm pack --dry-run --json）==
  ✓ 拿到包清单（22 个文件）                      ← 又回到 22 个（同时**第二次独立复现了改前基线**）
  发布面（npm 报的未压缩字节）: 22 个文件 / 1626236 B
  ✗ ★ liquid-glass 的 10 个路径**不在**发布面（files 负向模式生效 ⇒ 不分发 vendored 第三方码，署名义务面消失） — 漏进包: lib/liquid-glass-bundle.js, lib/liquid-glass/geometry.js, lib/liquid-glass/index.js, lib/liquid-glass/material.js, lib/liquid-glass/renderer.js, lib/liquid-glass/shaders.js, lib/liquid-glass/v2.js, lib/liquid-glass/v2-geometry.js, lib/liquid-glass/v2-material.js, lib/liquid-glass/v2-shaders.js
  ✓ ★ 但仓库内 10 个文件**一个都不能少**（宿主 /lg 路由 + liquid-demo 运行期读它们）
RC=1
```

⇒ 这条断言真的在盯着"发布面"，不是恒真断言；去掉负向模式 ⇒ **退出码 1**，并把 10 个漏进包的路径逐个列出。
（副本里 1 626 236 B 比真树改前多 **1 B**：副本的 `package.json` 被 `JSON.stringify(…,2)` 重写过，
与内容无关；真树改前数字以 §2 那次真树 pack 的 **1 626 235 B** 为准。）

### 4.4 未跑（本轮硬约束）

`bash tools/check.sh`（12 步，第 9 步起无头 Firefox）、`update-plugin.sh`、`npm publish`、
`tools/bundle-equivalence-test.mjs`（约 20s，本轮额度留给 ③ 的变异自证）、任何浏览器/真机观感验证。
静态取证：`bundle-equivalence-test.mjs:259-263` 与 `build-bundle.mjs --check` 读的是
**`lib/liquid-glass/`（保留未动）**，不读 `package.json.files` ⇒ 不受本改动影响（**推理，未跑**）。

---

## 5. 署名义务面（S-5(B)）

- **移出发布面 ⇒ 不再分发 ⇒ MIT 的"随副本携带版权与许可声明"义务面消失**：npm 包里**没有**
  这 10 个文件了（§2/§4.1 断言），所以"包里那份 vendored 码没有上游版权行"这个问题**不再由本包承担**。
- **但仓库内仍保留 10/10 文件**，所以 `THIRD-PARTY.md` §1.3 **继续如实登记**：
  出处（仅提交 `d13019d` 一句话，无可证实上游 URL）、许可（MIT）、
  **文件内无版权行/无许可正文的实测事实**、以及 **10 个 sha256**。
  ⇒ 口径从"我们随包分发一份没有署名的第三方码"改成"**该码只存在于源码仓库、不再分发**；
  一旦有人要**再分发**（fork / 单独打包 / 再 vendor），**必须先补齐上游 LICENSE 正文与版权行**"。
- **仍未证实项（继承 P-122 §9 第 1 项，未变）**：上游 URL / commit / 版本号 / LICENSE 正文
  一个都没被证实 ⇒ 若将来要重新纳入发布面，这条缺口会立刻复现。

---

## 6. 未证实项 / 残留风险（**不许当已解决**）

1. **改后发布面清单是推导的**（22 − 10 = 12 + 成员断言），没有第二次枚举打印。
   复核命令（主对话串行跑）：`cd dsh-mpkg-wallpaper && npm pack --dry-run --json | node -e "…"`，
   或直接看 3.7.3 发布后 `npm view dsh-mpkg-wallpaper dist.fileCount`（**未核实该字段名**）。
2. **`/lg` 路由在"从 npm 安装"的副本上是 404**（§3 末）：静态读码证明**优雅降级**，
   但本轮**禁止起浏览器/未跑 HTTP 实测** ⇒ 判据待主对话（`curl` 一次即可，不必开浏览器）。
3. **`nlink=2`（仓库外还有一组硬链接备份）** 仍未定位（P-122 §9 第 3 项）：移出发布面**不涉及**它。
4. **`lib/client.js.bak-20260907`**（480 471 B，S-2）仍在仓库、仍靠 `!lib/**/*.bak*` 不进包；
   本轮**没删**（不在 ① 的授权范围）。
5. **`glass.*` 家族里另有 5 个孤儿 i18n 键**（`glass.title`/`glass.desc`/`glass.color`/
   `glass.color.hint`/`glass.alpha`，全仓**无 `t("…")` 调用点**）与 2 个无读取点的设置字段
   （`glassColor`/`glassAlpha`）—— 与 ② 的 `glassWindow` 同源（WebGL 时代的"液态玻璃（elysia395 方案）"
   分区残留）。**本轮只处理 `glassWindow`（②）**，这 5+2 项**只登记、不动**，留给下一轮一次性裁定。

---

## 7. 本轮改动文件清单（提交只含这些）

| 文件 | 改什么 |
|---|---|
| `package.json` | `files` 加两条负向模式（`!lib/liquid-glass/**`、`!lib/liquid-glass-bundle.js`）；**未动 `version`** |
| `tools/integrity-check.mjs` | 第 ⑨ 节 +2 条双向断言、`lib/*.js 进包`口径改为"全部 − 有意排除"、打印发布面字节；表头注释同步 |
| `README.md` / `README.en.md` | 结构树与两条注记的"随包发布"口径改成"**不进发布包**（`files` 负向模式）/仓库内保留/宿主 `/lg` 仍是活路径"；顺带写清"移出发布面 ⇒ 署名义务面消失，仓库内仍保留并登记 sha256" |
| `THIRD-PARTY.md` | §1.3 的"发布面"一行 + 结尾补 S-5(B) 口径 |
| `docs/PUBLISH-SURFACE-LIQUID-GLASS.md` | 本文件（P-127） |
| `tools/check.sh` | 仅一处**注释**里"已证实失效未修的（lgCss/sessionFollow/glassWindow）"过期清单（② 一并更正） |

**未改**：`lib/**` 一个字节都没动（`lib/liquid-glass/**` + bundle 保留原样，sha256 不变）；
`tools/liquid-demo/**`、`tools/build-lg-bundle.mjs`、`tools/build-bundle.mjs`、`docs/LIQUID-GLASS-DEDUP.md`（P-122 的历史记录不改写）。

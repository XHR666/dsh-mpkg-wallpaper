# `vendor/hlsl2glsl/` —— vendored 上游 HLSL→GLSL 转译器（**MIT**）

本目录是 **`oneincase/webwallgl`（MIT © 2026 oneincase）** 的两个文件的**逐字节副本**，用于
`docs/HLSL2GLSL-COVERAGE.md` §0 结论的**可复现门禁**（把"真实语料 112/114 = 98.2%"从文档里的数字
变成会变红的断言，见 `hlsl2glsl-coverage-test.mjs`）。依据：`docs/SIMILAR-PROJECTS-RESEARCH.md` §6.1 第 3 条
（"借上游实现，不重写"）与 `docs/COPYING-RULES.md` §2.1（MIT → GPL ✅，须保留 MIT 声明）。

## 1. 逐文件台账

| 本仓路径 | 上游路径 | 上游 blob | 字节 | 行数 | sha256 | SPDX |
|---|---|---|---|---|---|---|
| `hlsl2glsl.js` | `renderer/vendor/we-scene/render/hlsl2glsl.js` | `179b6f8192f50ec709ae5f9923d240245f30cef7`（`9531aaf`） | 95,759 | 1693 | `af4c0a2ac04f2c15132858964e40dd2f1f09e08684e0c668e1ab8c72e720dec3` | MIT |
| `hlsl-preprocessor.js` | `renderer/vendor/we-scene/render/hlsl-preprocessor.js` | `5544c1359a61c2ee5dd137b6ec1fa46b1a1ae65b`（`d6dd5bc`） | 14,920 | 418 | `ced8a2ceaea4e0137dfc185b248529eaf8051ae61ad8f632fdc5084c941ec907` | MIT |
| `LICENSE` | `LICENSE` | （仓库根） | 1,085 | 21 | `857432ca4f48930e6079aca25164c27b791576ee2a7d3e3c9d6a92a089fe4948` | MIT |

- **来源仓库**：`oneincase/webwallgl`（本地检出 `../vendor-ref/webwallgl`，`origin/main`）
- **commit**：`hlsl2glsl.js` = **`9531aaf69ed54221054529fb97ee3843a6c065c1`**（2026-09-22T12:10:34Z = 20:10+0800，本轮上游终点）；
  `hlsl-preprocessor.js` 自 `d6dd5bc31de0bd5e88e3003025cf27edd0c1f010`（2026-09-21）起未变。
  P-93 首版取自 `fdfc578a577d0e680a9cfe2cf2e3e825d3cd2372`（1.3.23，2026-09-15 22:56:43 +0800）。
- **引入日期**：2026-09-16（P-93 首版）；**2026-09-23 把 `hlsl2glsl.js` 更新到 `9531aaf`**（§1.1）
- **引入人**：渲染器侧（P-93；2026-09-23 更新 = 上游分诊）
- **进哪个仓库**：`we-scene-demo`（GPL-3.0-or-later）
- **处置**：**逐字节复制，未改一字**（每个副本 = 上游对应 commit 的 blob；验证命令见 §1.1）。
  署名与许可全文：`THIRD-PARTY.md` §7（§9 台账）；`docs/COPYING-RULES.md` §4 台账 #8。

### 1.1 2026-09-23 更新：`hlsl2glsl.js` → `9531aaf`（上游 patch 批 `3351179520`）

**为什么**：依据 `docs/UPSTREAM-TRIAGE-20260923.md` §4 第 1 条（主表 #1/#2 两条 **P0**）—— 上游在
commit `78718843`（2026-09-22）给转译器补了两条规则；缺了它们时**整条 pass 编译失败、却被静默跳过**
（画面照出、控制台无红）：

1. **9-3) 复合赋值的向量截断**：`vec2 s; s *= 500.0 / g_Texture0Resolution;` —— HLSL 按左值宽度截断右值，
   GLSL ES 报 `'=' : cannot convert from 'vec4' to 'vec2'`。右值宽度**可确证**时补 `.xy`，推不出就不动。
2. **`vertConflicts`**：同名 varying 出现在兄弟原文的 `#if/#else` 两个分支且宽度不同时，片元侧**既不加宽
   也不收窄**（旧口径被"后写的死分支"覆盖 ⇒ `calWaveData(vec4)` 调用报废，multistage_wave 整类消失）。

**怎么取的**：`web_fetch` 单文件抓上游 raw（`raw.githubusercontent.com/…/9531aaf/renderer/vendor/we-scene/render/hlsl2glsl.js`）
＋ GitHub contents API 取 blob/size。**没有** `git clone`、**没有** `npm install`、**没有** `git fetch`
（本机 `references/vendor-ref/webwallgl` 的 `origin/main` 仍停在 `d6dd5bc`，**没有** `78718843/9531aaf` 的对象）。

**验证（可复现）**：

```bash
cd we-scene-demo
git hash-object vendor/hlsl2glsl/hlsl2glsl.js   # 179b6f8192f50ec709ae5f9923d240245f30cef7 = 上游 blob
sha256sum vendor/hlsl2glsl/hlsl2glsl.js         # af4c0a2ac04f2c15132858964e40dd2f1f09e08684e0c668e1ab8c72e720dec3
# 与"上一版"（= 上游 d6dd5bc 的 blob 66efe02d…）逐行差 = 恰好 3 个 hunk（+38 / −3）：
git -C ../references/vendor-ref/webwallgl show d6dd5bc:renderer/vendor/we-scene/render/hlsl2glsl.js \
  | diff -u - vendor/hlsl2glsl/hlsl2glsl.js | grep '^@@'
# 期望：@@ -671,6 +671,30 @@ / @@ -1254,15 +1278,26 @@ / @@ -1296,7 +1331,7 @@
node tests/hlsl2glsl-3351179520-test.mjs                      # 两条补丁的纯函数判据（含"改回去必红"变异）
node tests/hlsl2glsl-coverage-test.mjs                        # 覆盖率门禁（默认测**渲染路径在跑的那份**）
MPW_H2G_IMPL=vendor node tests/hlsl2glsl-coverage-test.mjs    # 只测本目录这份
```

**覆盖率影响**：本机 4 包 / 46 去重文件的子集上，`MPW_H2G_IMPL=vendor` 更新前后**都是 45/46 = 97.8%**
（"只升不降"成立：该子集没有触发这两条新规则 ⇒ 持平）。默认档（bundle 内联实现）同为 45/46。

⚠ **本目录这份不改变今天的画面**：`tests/hlsl2glsl-wiring-test.mjs` 的仪器化证明渲染路径调用的是
`core/we-scene-bundle.js` 内联的**另一份**实现（arity 4，**不接受** `siblingSrc`），本目录这份目前只被
覆盖率门禁消费。更新它的价值 = ① 门禁守的参考实现与上游同步；② P-114 的 A/B 取舍证据不过期。
**渲染路径上的两条同族缺口仍在**：bundle 内联实现里既没有 `9 / 9a-2 / 9-3` 那条"向量宽度表"规则族，
也没有跨 stage 的 varying 加宽/收窄（结构上就没有 `vertConflicts` 的对象）—— 实测同一夹具在 bundle 内联
实现下 `s *= 500.0 / g_Texture0Resolution;` **原样保留**（= GLSL ES 编译失败）。修它需要先把整族规则移植
过去，属于独立一条，见 `THIRD-PARTY.md` §9。


## 2. 只 vendored 了这些，**没有** vendored 什么（边界）

| 上游文件 | 是否引入 | 理由 |
|---|---|---|
| `render/hlsl2glsl.js` | ✅ 是 | 转译器主体；只 `import` 同目录的 `hlsl-preprocessor.js`，**自足** |
| `render/hlsl-preprocessor.js` | ✅ 是 | 上者的唯一依赖（宏展开/`#if` 折叠/`splitArgs`） |
| `render/headers.ts` | ❌ 否 | include **解析器由调用方注入**（`hlsl2glsl(src, stage, combos, includeResolver, siblingSrc)` 第 4 参）；本仓用**自己的** `common*.h`（`docs/COMMON-HEADERS-REPLACEMENT.md`），不复制上游头表 |
| `render/quality.ts` | ❌ 否 | P-90 已声明：只对齐档位语义、**实现自写** |
| `renderer.js` / `renderer-glsl.js` / `shaders/**` | ❌ 否 | 与本次门禁无关；`renderer-glsl.js` 的 `FXAA_FRAG` 是**另一条独立登记**（台账 #6） |

## 3. 复现（本目录自证）

```bash
cd we-scene-demo
sha256sum vendor/hlsl2glsl/*.js vendor/hlsl2glsl/LICENSE     # 与上表逐行比对
node vendor/hlsl2glsl/hlsl2glsl.js 2>/dev/null; echo "rc=$?（无副作用：只定义函数）"
node hlsl2glsl-coverage-test.mjs                             # 覆盖率门禁（无语料时 SKIP，不红）
```

⚠ **本目录的代码按 MIT 分发**，但它是 `we-scene-demo`（GPL-3.0-or-later）的一部分：
再分发时**两份声明都要保留**（见 `THIRD-PARTY.md` §7 与本目录 `LICENSE`）。

# OPENSOURCE-BORROW-PLAN —— 可借用开源清单 + 官方优先取证阶梯 + 落点表

> **本文是什么**：回答用户两条原话的**可执行**结论 ——
> ①「几个上游中相同的地方写了不同的函数、互相冲突 ⇒ 去反编译官方渲染器，或以官方为准」；
> ②「去找优秀开源项目，我是 GPL-3.0-or-later，能借的直接借」。
> **本文不是什么**：不是法律意见（口径同 `we-scene-demo/docs/COPYING-RULES.md:3`）；不是改动计划 ——
> **本文只新建，不改任何代码 / 测试 / 配置，不 `git add`/`commit`，不跑浏览器**。
>
> - 审计日期：**2026-09-24**（外部链接均为当日抓取；本机行号以当日工作树为准）
> - 本仓许可：**GPL-3.0-or-later**（`we-scene-demo/LICENSE` 35,147 B，末尾写明 "either version 3 … or (at your option) any later version"）
> - 既有归属纪律：`we-scene-demo/docs/COPYING-RULES.md`（单向流动 §2 · 台账 §4 · 阶梯 §9）、`we-scene-demo/THIRD-PARTY.md`
> - 路径口径：仓内文件写 `we-scene-demo/<仓内路径>:行号`；**仓外**（工作区根）文件写 `DSHarea/<路径>:行号` —— 用户要求"说路径要说清楚"

---

## ① 一句话结论

**最值得借的 3 个（按性价比排序）：**

1. **`Almamu/linux-wallpaperengine`（GPL-3.0-only，C++，4,619★）** —— **唯一"整族可借 + 能直接和官方资产对拍"的一手源**，而且**本机已有真 clone**（`DSHarea/lwe-ref/`，312 文件，HEAD `b016d7d1…`）。它把 WE 方言的 `#define` 头、`scene.json`/`effect.json`/material 的字段级解析、粒子算子全写成了可读 C++ ⇒ 冲突时"照谁"有第三方书面依据（但**不是官方**，见 §③ 阶梯）。
2. **`notscuffed/repkg`（MIT，C#，3,758★）+ `masterLazy/RePKG.Neo`（Apache-2.0，其活跃 fork）** —— PKG 容器 / TEX 编解码的**事实标准**。本仓 `we-scene-demo/docs/COPYING-RULES.md:414-423`（§9.10）已把 repkg 许可定案为 MIT；可直接借它的**格式/取值约定**与 TEX 编解码表。
3. **官方设计文档站 [`docs.wallpaperengine.io`](https://docs.wallpaperengine.io/sitemap.xml)（厂商自己写的，非第三方）** —— 不是"项目"，但**是本次调研最大的增量**：它把着色器方言、类型转换宏、预处理器差异、粒子算子的**字段语义**写成了可引用的官方法定文本。**多个"上游互相冲突"的点在这一层就能定案，不需要反编译**（§④ 的 C5 就是实例）。

**最该小心的 1 个：`wangkaxds/we-scene` 与 `wangkaxds/dsh-aurora-wallpaper`（均 MIT）—— 它们不是"第三方可借对象"，而是我们自己 `core/we-scene-bundle.js` 的上游祖先，并且本仓缺它们的 MIT 声明。**

证据（全部本机可复现）：

| 事实 | 证据 |
|---|---|
| 我们已署名的 `oneincase/webwallgl` 内部有一个 **vendored 第三方树** `renderer/vendor/we-scene/**` | 本机检出 `DSHarea/references/vendor-ref/webwallgl/renderer/vendor/we-scene/`（34 个 js/ts + 自己的 `LICENSE`） |
| 该目录自带的 `LICENSE` **不是** oneincase，而是 **MIT © 2026 aurora-wallpaper contributors**（1,085 B） | `DSHarea/references/vendor-ref/webwallgl/renderer/vendor/we-scene/LICENSE:3`；与 `https://raw.githubusercontent.com/wangkaxds/we-scene/main/LICENSE` 逐字同文 |
| 上游树**早于** webwallgl 仓库存在 | `wangkaxds/we-scene` created **2026-08-15T20:26:56Z**（[API](https://api.github.com/repos/wangkaxds/we-scene)）；`wangkaxds/dsh-aurora-wallpaper` created **2026-08-15T09:49:08Z**（[API](https://api.github.com/repos/wangkaxds/dsh-aurora-wallpaper)）；`oneincase/webwallgl` created **2026-09-04T06:30:49Z**（[API](https://api.github.com/repos/oneincase/webwallgl)） |
| webwallgl 是**下游**（它给这份代码打补丁并用 `[we-scene patch]` 标注） | `we-scene-demo/vendor/hlsl2glsl/hlsl2glsl.js:22` 等多处 `// [we-scene patch]` |
| 我们的 `core/we-scene-bundle.js` 与该树长块逐字相同 | 与 webwallgl 全仓 92 个 js/ts 做「>40 字符整行逐字相同」比对，**命中前 15 名全部落在 `renderer/vendor/we-scene/**`**：`render/renderer.js` 145/1389 行、`render/hlsl2glsl.js` 69/651、`pkg/tex-codecs.js` 41/66 = 62.1%、`pkg/container.js` 15/18 = 83.3%、`render/noise.js` 10/10 = 100%；最长逐字公共子串 **512–2048+ 字符**。对照 `elysia/**`（我们已署名的另一上游，`THIRD-PARTY.md:16`）最长仅 **24–64 字符** |
| 本仓**直接引用**了该路径，但只署名 `oneincase` | `we-scene-demo/demo.html:4938` 引用 `references/vendor-ref/webwallgl/renderer/vendor/we-scene/render/audio.js`；`we-scene-demo/THIRD-PARTY.md` §14 写 "整块照抄上游 `oneincase/webwallgl`（MIT © 2026 oneincase）：… ← `renderer/vendor/we-scene/render/particles.js:663-672`…" |
| **本仓对 `aurora` 零命中** | `grep -rni --exclude-dir=node_modules --exclude-dir=.git aurora we-scene-demo/` ⇒ **0 命中** |

⇒ **结论（可执行）**：这不是许可冲突，是**归属缺口**。按 `we-scene-demo/docs/COPYING-RULES.md:29`（§2.1「原 MIT 声明必须保留」）+ §4 台账六列（`:73`），**应补一条 `we-scene` 条目与 MIT 声明**；补录行见 §⑤-3。同时 ⇒ `we-scene` **不能当"独立第三方"来借**（从它借＝把已有血缘再引一遍），但它是**我们最该先读的上游**：读它比读 webwallgl 的 5.6 倍膨胀版更容易定位原始语义。

---

## ② 候选表

> **判定口径**（沿用本仓既有规则，不另立）：
> - **✅ 可直接借用**：许可与本仓 GPL-3.0-or-later 兼容 ⇒ 可复制代码，**必须**按 `we-scene-demo/docs/COPYING-RULES.md:73`（§4 台账六列：来源仓库 / 上游路径 / commit·tag / SPDX / 日期 / 谁引入·进哪个仓 / 处置）登记，并在 `we-scene-demo/THIRD-PARTY.md` 附许可全文与逐文件清单。
> - **📖 只能当参考**：许可不兼容 ⇒ **只可读行为结论**，严禁复制代码/注释/常量组织/错误文案（判定口径见 `we-scene-demo/docs/COPYING-RULES.md:32`）。
> - **❌ 不可用**：无许可（保留所有权利）或 GPL-2.0-only（与 GPL-3.0 双向不兼容）。
> - **⚠ 特殊**：是我们自己的上游祖先 / 已借但有缺口 —— 处置写在各行。

### 2.1 可直接借用（许可兼容）

| 项目 | 语言 | SPDX（证据） | 可借用性 | 具体能借什么（模块/文件级） | 借来后落到我们哪个文件/判据 | 需补的归属/声明 |
|---|---|---|---|---|---|---|
| **`Almamu/linux-wallpaperengine`** | C++ / OpenGL | **GPL-3.0-only**。证据：本机 `DSHarea/lwe-ref/LICENSE` blob = `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7`（35,149 B，GPLv3 全文、**无项目声明**）；**打包元数据** `DSHarea/lwe-ref/packaging/archlinux/PKGBUILD:9` 逐字 `license=('GPL-3.0-only')`；全仓 `SPDX-License-Identifier` **0 命中**（审计全文 `DSHarea/docs/LICENSE-COMPAT-REVIEW.md:54-93`，判定行 `:64`） | ✅ **可借**（本仓 §2.3 已判 `we-scene-demo/docs/COPYING-RULES.md:41`）⚠ 见 §⑤-1 的**分发口径前置动作** | ① **WE 方言的 `#define` 头**：`lwe-ref/src/WallpaperEngine/Render/Shaders/ShaderUnit.cpp:22` 的 `SHADER_HEADER` 宏（`mul`/`saturate`/`frac`/`atan2`/`ddx`/`ddy`/`texSample2D`/`CAST2..4`/`float2..4` 全表 —— **与官方文档 §S0 的方言清单逐条对得上**）② **着色器注解解析**：同文件 `:96` `preprocessVariables()`（`// [COMBO] {json}` 与 `uniform <type> <name>; // {json}` 两种注解）、`:442` `parseComboConfiguration()` ③ **数据解析器**：`src/WallpaperEngine/Data/Parsers/{ObjectParser,EffectParser,MaterialParser,ProjectParser,PropertyParser,ShaderConstantParser,PackageParser,TextureParser}.cpp` ④ **模型/字段名**：`Data/Model/{Object,Effect,Material,Project,Wallpaper,Property}.h` ⑤ **粒子算子**：`Render/Objects/CParticle.cpp`（vortex `:1384`、controlpointattract `:1463` 是 §④ 冲突 C3/C4 的一方依据）⑥ **TEX 容器**：`Data/Parsers/PackageParser.cpp` + `Data/Utils/BinaryReader.cpp` | ①→ `we-scene-demo/shaders/common*.h`（6 个）+ `we-scene-demo/vendor/hlsl2glsl/hlsl-preprocessor.js` 的头部注入；**判据**：与官方文档方言清单逐条对齐（见 §③-S0）②→ `we-scene-demo/vendor/hlsl2glsl/hlsl-preprocessor.js` 的 combo 注解解析 + `we-scene-demo/core/we-scene-bundle.js` 的 combo 表 ③④→ `we-scene-demo/core/scene-project-json.mjs` + `core/we-scene-bundle.js` 场景/效果解析段；**判据**：官方 `wallpaper_engine/assets/effects/**` **46 个 `effect.json` 全量解析成功**（含 `fluidsimulation/effect.json:402` 的尾逗号容忍 —— 见 `DSHarea/docs/OFFICIAL-WE-ARTIFACTS-20260924.md:16` 速览第 8 条）⑤→ `we-scene-demo/core/we-particle-pointer.mjs`（`vortexSwirl` 等）+ `core/we-scene-bundle.js` 粒子算子段 ⑥→ `we-scene-demo/core/we-scene-bundle.js` 的 pkg/tex 读取段 | **`we-scene-demo/THIRD-PARTY.md` 新增一节**（GPL-3.0 全文 + 逐文件清单 + 上游 commit `b016d7d1fdcf4e5fd2f9c9fa420a8aaa07fee02d`）+ **`we-scene-demo/docs/COPYING-RULES.md` §4 台账新行**（六列齐全）。⚠ 许可流向 MIT↔GPL 边界见 §⑤-1 |
| **`notscuffed/repkg`** | C# / .NET | **MIT**。证据：[API `license.spdx_id = "MIT"`](https://api.github.com/repos/notscuffed/repkg)；`https://raw.githubusercontent.com/notscuffed/repkg/master/LICENSE`（`Copyright (c) 2019 notscuffed`）；本仓已定案 `we-scene-demo/docs/COPYING-RULES.md:414-423`（§9.10，含"2026-09-17 项目所有者确认"） | ✅ **可借**（格式/取值约定 + 代码皆可） | `RePKG.Core/Texture/**`（TEX 头/mip 链/格式枚举）、`RePKG.Core/Package/**`（PKG 索引结构）、TEX→图片的格式判定顺序。**注意**：它是 C#，我们借的是**格式事实与判定顺序**，代码需移植为 JS | `we-scene-demo/core/we-scene-bundle.js` 的 tex-codecs / pkg 读取段；**判据**：`DSHarea/allwallpaper/` 98 个容器（77 mpkg + 21 pkg，头部分布见 `we-scene-demo/docs/MDLE-VERDICT.md:29-30`）逐包解出条目数与魔数普查一致 | `we-scene-demo/THIRD-PARTY.md` 新节（MIT 全文 + 上游 commit + 逐文件清单）+ §4 台账新行。**当前无 vendored 副本** ⇒ 若只引"格式事实"仍需台账（§9.7 留痕字段） |
| **`masterLazy/RePKG.Neo`** | C# / WPF | **Apache-2.0**。证据：[API `license.spdx_id = "Apache-2.0"`](https://api.github.com/repos/masterLazy/RePKG.Neo)，且同一响应 `"fork": true`、`"parent"/"source" = notscuffed/repkg` | ✅ **可借**（Apache-2.0 → GPL-3.0 兼容；**不可**进 MIT 侧插件） | 相对 repkg 的**增量**：`PKGV0024` 之类新容器版本支持、TEX 新格式、以及它的 GUI 层暴露出的**用户实测格式清单** | `we-scene-demo/core/we-scene-bundle.js` 的容器版本分支；**判据**：本机容器头分布里 `PKGV0024=6`（`we-scene-demo/docs/MDLE-VERDICT.md:30`，同一行还有 `PKGV0023=7 PKGV0022=6 PKGV0021=1 PKGV0020=1 PKGM0018=10 PKGM0014=67`）能解 | 同 repkg；**须附 Apache-2.0 的 `NOTICE` 处理**（若上游带 NOTICE 文件需一并保留） |
| **`Paradox07127/macos-wallpaperengine`** | Swift / Metal | **MIT**。证据：[API `license.spdx_id = "MIT"`](https://api.github.com/repos/Paradox07127/macos-wallpaperengine)（54★，created 2025-02-22，pushed 2026-09-22） | ✅ **可借**（MIT → GPL 单向允许） | **相机 / 透视 / 后处理链的结构与顺序**（Metal 代码可读性高、体量 1,294 文件、单一作者风格一致）；本仓的空白项「透视层 3D 倾斜无样本」可在此找**行为契约**（`DSHarea/docs/SIMILAR-PROJECTS-RESEARCH.md:131`） | `we-scene-demo/core/we-scene-bundle.js` 的 `buildCamera` / 后处理段；`we-scene-demo/shaders/common_perspective.h` | `THIRD-PARTY.md` 新节 + §4 台账行。**若只读行为契约未复制代码** ⇒ 按 §9.7 留痕（无台账代码行） |
| **`waywallen/waywallen`** | Vala / GTK | **MIT**。证据：本仓核实表 `DSHarea/docs/LICENSE-COMPAT-REVIEW.md:47`（`LICENSE` blob `95deddccae8f62bc61a5c67d4016d561a3936e6d`，1,064 B，另有 `bridge/LICENSE` 同版权人；SPDX 结论行 `:268`） | ✅ **可借** | **进程/沙箱边界先例**：把 GPL-2.0-only 渲染器作为**独立 spawn 的 renderer 二进制**挂在 MIT 插件边界外（`DSHarea/docs/LICENSE-COMPAT-REVIEW.md:26-27`，实现细节 `:410`、`plugin.toml.in` 的 `spawn_version = 10` 见 `:419`）。这正是本仓 `THIRD-PARTY.md:502-523`（§4B.1）红线的**现成实物样板**。⚠ **只当架构先例，不当法律结论**：同一审计的 U4 逐字写"技术上确实独立 spawn … 但'独立进程是否 = 独立作品'取决于耦合程度与司法辖区，**没有任何自动规则**"（`DSHarea/docs/LICENSE-COMPAT-REVIEW.md:514`） | 参考落地到 `we-scene-demo/docs/PACKAGING.md` 的打包边界章节 + `we-scene-demo/THIRD-PARTY.md` §4B | 仅在文档引用其架构先例 ⇒ 按 §9.7 留痕即可；若复制打包清单片段则走 §4 台账 |
| **`AzPepoze/linux-wallpaperengine`**（用户点名的"同名前缀另一个仓库"；`AzPozepe` 拼写 = 不存在，正确是 **`AzPepoze`**） | C++（Sokol；topics 里残留 `golang`/`raylib` 是历史） | **GPL-3.0**。证据：[API `license.spdx_id = "GPL-3.0"`](https://api.github.com/repos/AzPepoze/linux-wallpaperengine)，且**同一响应 `"fork": false` 且无 `parent`/`source` 字段** ⇒ **不是 `Almamu` 的 fork，是另起炉灶的同名项目**（26★，created 2026-01-15，pushed 2026-08-23）；`https://raw.githubusercontent.com/AzPepoze/linux-wallpaperengine/main/LICENSE` = GPLv3 全文，**且"How to Apply"样板里被填进了 `Copyright (C) 2026 AzPepoze`**（与 Almamu 那份留占位符不同） | ✅ **可借**（GPL-3.0 → GPL-3.0-or-later 兼容）**但不推荐** | **不建议借**：① 它的 `README.md` FEATURE SUPPORT 自述大面积 `[ ]` 未实现（Scene layers/puppet/timeline/lighting/3D **全空**，`Particle systems` 为 `[-]`）② 与 `Almamu` 同为 **Linux 原生 + Vulkan/Slang**，我们借不了它的渲染路径。**唯一可借点** = 与 Almamu 实现**分歧处**的第三方第二意见（例如它的 `scene.json` 字段解释若有出入，可作 S5 的交叉验证） | 仅在有**具体分歧点**时读对应文件；不整体引入 | 若引用：`THIRD-PARTY.md` 新节 + §4 台账行，SPDX = `GPL-3.0`（**不是** `-only`：它的 LICENSE 把版权人填进了 or-later 样板，与 Almamu 的裸文本不同；但两者都按兼容处理） |
| **`NixaXI/AnisPaper`** | C++ / Qt / Plasma 6 | **GPL-3.0-or-later（依项目自述，6 处）/ `LICENSE` 本身只写 GPL-3.0**。证据：`DSHarea/docs/LICENSE-COMPAT-REVIEW.md:130-186`（含 `THIRD_PARTY_NOTICES.md:3`、`packaging/kwin/.../metadata.json:8` 等逐字原文；`LICENSE` blob 与 lwe 同一份 `f288702d…`，"给多了"的风险注在 `:186`） | ✅ **可借**，但**保守按 `GPL-3.0-only` 对待**（本仓 `we-scene-demo/docs/COPYING-RULES.md:42` 记为"未定项"） | ① **静态链接 lwe 的打包写法**（它的 `-Wl,--whole-archive wallpaperengine-core` 自述 + KDE 打包清单）② `src/renderers/scene_renderer.cpp` 的渲染器接入顺序 | 参考落地 `we-scene-demo/docs/PACKAGING.md`；**当前无借用需求**（我们是浏览器端，不静态链接） ⇒ **建议保持"仅行为对照"** | 若将来借用：`THIRD-PARTY.md` 新节 + §4 台账行；**SPDX 写 `GPL-3.0-only`**（写 `or-later` 是"给多了"，理由见 `DSHarea/docs/LICENSE-COMPAT-REVIEW.md:186`） |

### 2.2 只能当参考（许可不兼容 —— 严禁复制代码）

| 项目 | 语言 | SPDX（证据） | 判定 | 允许做什么 | 禁止做什么 |
|---|---|---|---|---|---|
| **`catsout/wallpaper-scene-renderer`** | C++ / OpenGL | **GPL-2.0-only**（已归档）。证据：`DSHarea/docs/LICENSE-COMPAT-REVIEW.md:95-111`：`LICENSE` blob `d159169d1050894d3ea3b98e1c965c4058208fe1`、18,092 B，`:2` = `Version 2, June 1991` 无 `+`；`src/**` 零许可头 | 📖 仅行为对照 | 读它的**行为结论**（早期最完整的 scene 解析实现，作第三方旁证） | 复制/改写/逐行翻译代码·注释·常量组织·错误文案；**不得进入任何发布产物** |
| **`Aromatic05/wallpaper-engine-renderer`**（本机 `DSHarea/wer-ref/`） | C++ | **GPL-2.0-only**。证据：`we-scene-demo/docs/COPYING-RULES.md:44`；审计 `DSHarea/docs/WER-REF-LICENSE-AUDIT.md` | 📖 仅行为对照（且已判出 **2 处点状同源**并已按规格独立实现，P-95） | 读行为结论；它带**注释的推理**（`DSHarea/wer-ref/src/backend/scene/internal/parser/WPParticleParser.cpp:705-710` 的屏幕手性说明、`:735-737` 对 lwe 门限除 2 的经验补偿说明）是 §④-C3/C4 的关键旁证 | 同上一行；`import`/`require`/`readFile` 命中须为 **0**（`:44`） |
| **`waywallen/open-wallpaper-engine`** | Vala/GTK 等 | **GPL-2.0-only**（`LICENSE` blob 同上 `d159169d…`）。证据 `we-scene-demo/docs/COPYING-RULES.md:46` | 📖 仅行为对照 | 同上（是 `catsout` 的官方迁移目标，同一血脉 ⇒ **不是两票**） | 同上 |
| **`Aromatic05/we-layerd`**（本机 `DSHarea/we-layerd-ref/`） | Rust | **无任何许可 ⇒ 保留所有权利**。证据：`we-scene-demo/docs/COPYING-RULES.md:45,360-395`（§9.8 完整 L2 查证：上游 `/license` = 404；`PKGBUILD:9` = `license=('custom:unlicensed')`；`.spec:8` = `LicenseRef-Unlicensed`） | ❌ **不可借（比 GPL 更严）** | 只可读行为结论 | 复制代码；进入产物；**连"照它的实现自写"都要避开其 `third_party/wallpaper-engine-renderer` 子模块**（GPL-2.0-only，pin `89dfcd86…`） |
| **`lucaschnabel42/wallgl`** | — | **无许可**（= 保留所有权利），且仓库为空壳（0 KB）。证据：`DSHarea/docs/SIMILAR-PROJECTS-RESEARCH.md:65` | ❌ **不可用** | —— | 连参考实现都没有 |

### 2.3 ⚠ 特殊：是我们自己的上游祖先（不是第三方）

| 项目 | 语言 | SPDX（证据） | 判定 | 能借什么 | 落点 | 需补的归属 |
|---|---|---|---|---|---|---|
| **`wangkaxds/we-scene`** | JavaScript（ESM，WebGL2） | **MIT © 2026 aurora-wallpaper contributors**。证据：[API `spdx_id = "MIT"`](https://api.github.com/repos/wangkaxds/we-scene)（created 2026-08-15）；`https://raw.githubusercontent.com/wangkaxds/we-scene/main/LICENSE`（1,085 B）**逐字等于** `DSHarea/references/vendor-ref/webwallgl/renderer/vendor/we-scene/LICENSE` | ⚠ **不是第三方可借对象**（是我们 `core/we-scene-bundle.js` 的上游祖先，经 webwallgl 进来）；**必须补署名** | **它的原始模块划分**（`src/pkg/container.js`、`src/pkg/texture.js`、`src/render/renderer.js`、`src/render/hlsl2glsl.js`、`src/scene/parse.js`、`src/scene/effects-parse.js`）是**定位我们 bundle 里"哪段来自哪里"的最短路径**（我们的 bundle 与它的逐字公共子串 512–2048+ 字符；与 webwallgl 的 5.6 倍膨胀版对照更难读） | 只读定位；不需要改代码 | **`we-scene-demo/THIRD-PARTY.md` 新增一条 `we-scene` 声明 + `we-scene-demo/docs/COPYING-RULES.md` §4 台账新行** —— 补录行见 §⑤-3 |
| **`wangkaxds/dsh-aurora-wallpaper`** | JavaScript（DSH 插件） | **MIT**。证据：[API `spdx_id = "MIT"`](https://api.github.com/repos/wangkaxds/dsh-aurora-wallpaper)（created 2026-08-15T09:49:08Z，pushed 2026-08-22）；README 末段逐字 "MIT —— 见 LICENSE" | ⚠ 同 we-scene：**它是 we-scene 的父插件**（其 README 逐字："场景渲染引擎是独立 ES 模块，已单独开源 **wangkaxds/we-scene**"；we-scene README 逐字："本仓库即从中提取"）⇒ 与我们的 `core/we-scene-bundle.js` **同源** | 只读事实记录；**建议不引**（引它等于引 we-scene，多一层无收益） | —— | 同上一条即可覆盖（同一版权人 `aurora-wallpaper contributors`）；若要单独成行，SPDX = MIT、Copyright = `2026 aurora-wallpaper contributors` |

### 2.4 已在用、本次只需确认口径（不重查）

| 项目 | SPDX | 本仓既有口径（不重查，仅指路） |
|---|---|---|
| `oneincase/webwallgl` | MIT © 2026 oneincase | `we-scene-demo/docs/COPYING-RULES.md:48`（§2.3 行）+ §4 台账 #6/#8/#12/#13/#14/#15（`:84,86,97-100`）；`we-scene-demo/THIRD-PARTY.md` §6/§9/§11/§12/§14/§15/§16。**⚠ 其中凡引用 `renderer/vendor/we-scene/**` 的条目，其真正版权方是 aurora-wallpaper contributors（见 §2.3）** |
| `elysia395/dsh-wallpaper-engine` | MIT © 2026 elysia395 | `we-scene-demo/THIRD-PARTY.md:16-38`（§1，含"`elysia/**` 与 `core/attach-transform.mjs` 为衍生作品"的显式声明；`:30` PR #47 merged 2026-08-25）；[API](https://api.github.com/repos/elysia395/dsh-wallpaper-engine) created 2026-08-16，337★ |
| `@shaderfrog/glsl-parser` 7.0.1 | ISC | `we-scene-demo/docs/COPYING-RULES.md:80`（台账 #2） |
| Lucide 图标 / 7 个字体 | ISC / OFL-1.1 / Apache-2.0 / CC-BY-4.0 | `we-scene-demo/docs/COPYING-RULES.md:81-82,90`（台账 #3/#11） |

### 2.5 官方反编译/逆向产物盘点（用户点名的"有没有已经反编译出来的东西"）

**结论：本机与公开检索都找不到任何"官方渲染器反编译产物"。这条要如实说"没有"，不要写成"未查到"就含糊过去。**

| 找什么 | 结果 | 证据 |
|---|---|---|
| 本机是否有官方反编译产物（IDA/Ghidra 数据库、伪 C、符号还原） | ❌ **完全没有** | `DSHarea/docs/VORTEX-CHIRALITY-RE-20260923.md`（证据强度表首行："官方反编译产物 ❌ 完全没有 —— WE 是闭源原生 C++/D3D11，本机没有任何 IDA/Ghidra 产物"）；本机工具普查：`ghidra`/`rizin`/`radare2`/`r2`/`jadx`/`apktool`/`dex2jar`/`smali`/`wine`/`dotnet`/`mono` **全部不存在**（`command -v` 逐个实测） |
| 公开是否有官方渲染器 deobfuscation / 反编译仓库 | ❌ 未检索到（检索词含 `wallpaper64.exe reverse engineering decompiled`、`wallpaper engine Ghidra/IDA database`） | 本次 4 轮 `web_search` 未返回任何此类项目；返回的都是**重写**（linux/macOS 原生）或**解包工具**（repkg 系），不是反编译产物 |
| 我们**已有**的官方一手产物（这才是"官方优先"的真正弹药） | ✅ 见 §③-S1/S2/S3 | `DSHarea/docs/OFFICIAL-WE-ARTIFACTS-20260924.md:16`（一页速览 8 条全在讲这些产物的读数） |

---

## ③ "官方优先"取证阶梯（遇到上游冲突时按什么顺序取证）

> **原则**：**逐级向上、能停就停**；**同级以"厂商自己写的文本" > "厂商自己的二进制读数" > "第三方代码"**；
> **每一级都要能给出可复制的命令或可点开的 URL**。用户原话："以官方的来" —— 本节把"官方"拆成 **4 个官方层级（S0–S4）**，再加 **4 个第三方层级（S5–S8）** 明确排在官方之后。

### 3.1 阶梯总览（冲突仲裁顺序：S0 最强）

| 级 | 名称 | 是什么 | 什么时候用它就能定案 | 本机可用性 |
|---|---|---|---|---|
| **S0** | **官方设计文档** | 厂商自己的文档站 <https://docs.wallpaperengine.io/sitemap.xml>（**本次新引入的层级**） | 冲突点是**字段语义 / 方言规则 / API 行为** | ✅ 联网可读（无需本机 WE） |
| **S1** | **官方磁盘资产** | `DSHarea/wallpaper_engine/assets/**`（137 个 shader 文件 + 46 个 effect 目录 + preset）与 `DSHarea/Steam/steamapps/common/wallpaper_engine/**` | 冲突点是 **shader 源码 / effect 参数表 / 默认值** | ✅ 本机 1.3 GB，只读 |
| **S2** | **官方类型声明** | `lib.sceneScript.d.ts`（**2.4 本机**：`DSHarea/docs/_official-extract/lib.sceneScript.d.ts`，1,629 行；**2.8 在 Steam 树**：`DSHarea/Steam/steamapps/common/wallpaper_engine/.../lib.sceneScript.d.ts`，2,570 行） | 冲突点是 **SceneScript API 成员名/签名/默认值** | ✅ 本机两份 |
| **S3** | **官方二进制字符串 / 导出符号** | `strings -a -n 5` + `nm -D`（Android `.so` **保留 61,287 条已定义符号**） | 冲突点是 **成员名是否存在 / 某属性有无读者** | ✅ 本机可做，见 §3.3 |
| **S4** | **官方二进制反汇编** | `llvm-objdump -d --start-address=<VA> --stop-address=<VA>` + `python3` + **capstone 5.0.7** | 冲突点是**公式/常量/分支顺序** | ✅ 本机可做，见 §3.3 |
| **S5** | **GPL-3.0 借用实现** | `Almamu/linux-wallpaperengine`（`DSHarea/lwe-ref/`，GPL-3.0-only） | 上面都拿不到时的**书面第三方依据**（可借 ⇒ 可复制） | ✅ 本机真 clone |
| **S6** | **MIT 借用实现** | `oneincase/webwallgl`、`notscuffed/repkg`、`Paradox07127/macos-wallpaperengine`（**`wangkaxds/we-scene` 见 §2.3，是我们自己的上游祖先，不按"借用对象"处理**） | 同上（可借） | ✅（webwallgl 有本机检出；repkg / macos 需联网） |
| **S7** | **不兼容参考实现** | `wer-ref/`（GPL-2.0-only）、`we-layerd-ref/`（无许可）、`catsout`、`waywallen/open-wallpaper-engine` | **只读行为结论**；**它们之间的"票数"不算独立证据**（同源要合并计数） | ✅ 本机两份 |
| **S8** | 我们自己的实现 | `we-scene-demo/core/**` | 永远是被检验方，不是依据 | ✅ |

### 3.2 分级判据：哪些冲突类型本机现在就能定案

| 冲突类型 | 能定案的最强级 | 结论 |
|---|---|---|
| 官方 shader 里某个 uniform/宏的**语义** | **S1** | ✅ **本机立刻可定案**（读官方 shader 源码即可；§④-C2 是实例） |
| 官方 effect 的**参数名/默认值/取值域** | **S1** | ✅ 立刻可定案（46 个 `effect.json` + `preview/scene.json` 全在；读数见 `DSHarea/docs/OFFICIAL-WE-ARTIFACTS-20260924.md:241-390`） |
| SceneScript API 成员与签名 | **S2** | ✅ 立刻可定案（1,629 行 2.4 版 + 2,570 行 2.8 版） |
| **着色器方言/类型转换规则** | **S0** | ✅ 立刻可定案（官方文档 `shader/syntax.html` 逐条列了 `mul`/`saturate`/`frac`/`atan2`/`ddx`/`ddy`/`texSample2D`/`CAST2/3/4/3X3`，且明写"shaders are translated into HLSL"） |
| **粒子算子/效果的字段语义** | **S0** | ✅ 立刻可定案（`particles/component/operator.html` 把 vortex / control point force 等逐字段写清） |
| 引擎内部的**数值公式与常量**（平滑系数、门限、手性符号） | **S4**（桌面）/ **S3+S4**（Android） | ⚠ **需要反编译**；部分**已做过**（§④-C1 已有真公式）；**部分做不了**（§④-C3：官方产物里对手性沉默） |
| 某属性在 Android 构建里**有没有读者** | **S3** | ✅ 立刻可定案（`nm -D` + 反汇编读 `Scene+offset`；实例见 `DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md:279`：`cameraparallaxdelay` 在 arm64 构建**读者为 0**，是安卓构建差异） |

### 3.3 本机可做的与需反编译的：命令与工具（含踩过的坑）

**工具普查（本次实测，`command -v` 逐个跑）**：可用 = `objdump`、`aarch64-linux-gnu-objdump`、`llvm-objdump`、`nm`、`llvm-nm`、`readelf`、`llvm-readobj`、`strings`、`unzip`、`python3`（+ **capstone 5.0.7**）、`node`、`file`、`xxd`；**不存在** = `7z`、`jadx`、`apktool`、`dex2jar`、`smali`/`baksmali`、`rizin`/`radare2`、`ghidra`、`wine`、`dotnet`、`mono`。架构 = **aarch64**（无 Windows）。

> ⚠ **硬坑（先踩过）**：本机 GNU `objdump` **读不了 x86-64 PE**（只支持 `pei-aarch64-little`）⇒ 反汇编 Windows 二进制**必须**用 `llvm-objdump`。
> 证据：`DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md:512-525`（逐行命令与两种输出的原文）。

```bash
# ── S1：官方 shader / effect 资产（无需任何工具链）────────────────────────
grep -rn 'g_ParallaxPosition' DSHarea/wallpaper_engine/assets/{shaders,effects}/
#   ⇒ effects/depthparallax/shaders/effects/depthparallax.vert:5,44,48
#     effects/depthparallax/preview/shaders/effects/depthparallax.frag:18,67,71,75
ls DSHarea/wallpaper_engine/assets/effects | wc -l      # ⇒ 46
find DSHarea/wallpaper_engine/assets/shaders -type f | wc -l   # ⇒ 137

# ── S2：官方类型声明（本机两份，2.4 与 2.8）──────────────────────────────
wc -l DSHarea/docs/_official-extract/lib.sceneScript.d.ts                     # ⇒ 1629（2.4）
wc -l "DSHarea/Steam/steamapps/common/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts"  # ⇒ 2570（2.8）

# ── S3：Android 官方 .so 的导出符号（符号保留最全，读 Scene::* 用这个）────
cd /tmp && unzip -o -q "$DSHAREA/Androidapk/壁纸引擎_2.8.8.apk" 'lib/arm64-v8a/libscenejni.so' -d apk-tmp
nm -D apk-tmp/lib/arm64-v8a/libscenejni.so | grep _ZN5Scene      # 60 条 Scene::* 符号
#   实例：_ZN5Scene16Update3DParallaxEv = 0x25567a8（OFFICIAL-PARALLAX-RE §一页速览 1）

# ── S4：反汇编（Windows 用 llvm-objdump；Android 用 objdump/llvm-objdump）─
llvm-objdump -d --start-address=0x14014b608 --stop-address=0x14014b7f0 \
  DSHarea/wallpaper_engine/bin/wallpaper64.exe            # ⇒ 视差平滑系数所在函数
objdump -d --start-address=0x25567a8 --stop-address=0x2556af8 \
  apk-tmp/lib/arm64-v8a/libscenejni.so                    # ⇒ Scene::Update3DParallax
#   地址是 VA/RVA：先从 section header 把数值减 ImageBase 0x140000000
#   capstone 兜底（本机已有 5.0.7）：python3 -c 'import capstone; ...'
```

**本机可做的**：S0（联网）/ S1 / S2 / S3 / S4 全部可做。
**必须"真机/真机出帧"才能做的（本机做不到，如实登记）**：任何**画面级**定论（"照谁之后画面与 WE 一致"）—— 本机只有 Linux/Android 工具链、**无 Windows、无 WE 运行环境**；FACT 见 `DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md:626-639`（§B-2「桌面侧没有的东西」，避免后人重复找）。
**取样脚本**：`DSHarea/docs/_official-extract/REGENERATE.md`（22 行，APK 解包 + `strings` 生成命令，可一键重跑）。

---

## ④ 冲突场景清单（3 个我们已知的具体冲突 + "照谁"）

> 选的都是**本仓已有记录、能追到 file:line**的真冲突，不是假想。

### C1｜视差平滑系数：我们 `1 − exp(−dt·ln100/delay)` vs 官方 `min(1.0, (1 − delay/3.0) × 10.0 × dt)`

| 项 | 内容 |
|---|---|
| 冲突双方 | **我们**：`k = 1 − exp(−dt·ln100/delay)`（指数逼近）；**官方**：`k = min(1.0, (1 − delay/3.0) × 10.0 × dt)`（线性、只封顶不夹下界） |
| **照谁** | **照官方（S4 已定案）** |
| 依据 | `DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md:57-60`：`wallpaper64.exe` `0x14014b6c2`–`0x14014b71b` 的指令序列 `movss 0x318(%rbx)`(=delay) → `divss 3.0` → `subss` → `mulss 10.0` → `mulss dt` → `comiss 1.0` + `ja`（只封顶到 1，不夹下界）。复现命令：`llvm-objdump -d --start-address=0x14014b608 --stop-address=0x14014b7f0 DSHarea/wallpaper_engine/bin/wallpaper64.exe` |
| 量化差距 | 官方默认 `delay = 0.1`、60 fps ⇒ 官方 `k ≈ 0.161`，本仓 `≈ 0.537` ⇒ **本仓比官方快 3.3 倍**；`delay = 1` 时反过来（官方 0.111 vs 本仓 0.0742） |
| 落地判据 | 改 `we-scene-demo/core/we-scene-bundle.js` 的视差平滑段 + 新增断言（`delay=0.1`/`dt=1/60` ⇒ 0.161；`delay=1` ⇒ 0.111）；保留 `?parallax=legacy`（既有回退开关已在 `we-scene-demo/docs/README-DIAGNOSTICS.md` 主表） |
| 注意 | **作用域限定桌面构建**：Android `libscenejni.so` 里 `Scene+696`（`cameraparallaxdelay`）**读者为 0**，用的是 `min(dt·impl[5348], 1.0)` + 常量 `0.1`（`DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md:279`）⇒ 若同时对齐 Android，"照谁"要分平台 |

### C2｜`g_ParallaxPosition` 的语义：任务书说的 `(0.5 − mouse) ∘ depth × amount` vs 官方 shader 里的"归一化位置（0..1，中心 0.5）"

| 项 | 内容 |
|---|---|
| **照谁** | **照官方 shader 源码（S1 定案，不需要反编译）** —— 它是**归一化位置**，不是偏移量 |
| 依据 | 官方 `DSHarea/wallpaper_engine/assets/effects/depthparallax/shaders/effects/depthparallax.vert:5,44-46`：`uniform vec2 g_ParallaxPosition;` … `vec2 prlxInput = g_ParallaxPosition * 2 - 1;`（`*2-1` 只在"位置型 0..1"输入下成立）；同目录 `preview/.../depthparallax.frag:67,71,75` 三处也按"位置"用它 |
| 我们现在的状态 | **已经是对的**：`we-scene-demo/core/we-scene-bundle.js` 的 `uniform2f(g_ParallaxPosition, parallaxState.x, parallaxState.y)`（`DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md:36` 第 4 条判定"本仓是对的"） |
| 落地判据 | **无需改代码**；把这个结论写成断言（防止将来有人按错误的"偏移量"口径改回去），并修正任何仍写 `(0.5 − mouse)` 的文档表述 |
| 为什么这是好例子 | 冲突的根源是**名字被混用**：`(0.5 − mouse) ∘ depth × amount` 是**层位移公式**的名字，被安到了这个 uniform 上。S1 一层就定案 |

### C3｜粒子 vortex 切向手性：`(−dy, +dx)` vs `(dy, −dx)`

| 项 | 内容 |
|---|---|
| 冲突双方（**已去重，且经本次复核后"票数"口径需修正**） | **`(−dy,+dx)`（= `axis × radial`，我们现在的实现）**：`DSHarea/lwe-ref/src/WallpaperEngine/Render/Objects/CParticle.cpp:1384` 逐字 `glm::vec3 tangent = glm::cross (axis, radialVector);`。**`(dy,−dx)`（= `radial × axis`）**：`DSHarea/wer-ref/src/backend/scene/internal/parser/WPParticleParser.cpp:711` 逐字 `Vector3d tangent = relative.cross(axis);`；`oneincase/webwallgl` commit `78718843`（2026-09-22，v1.4.1）的**带理由单向翻转** |
| ⚠ 计数纪律 | ① `wer-ref` 与 `waywallen/open-wallpaper-engine` **同源**（`we-scene-demo/docs/COPYING-RULES.md:46`）⇒ **不是两票**；② 我们那份 minified `renderer-BOSoB05I.js` 是 webwallgl 的**旧版预构建产物** ⇒ **也不是独立证据**；③ **本次复核新增**：`wer-ref` 的翻转**理由不是"引擎语义不同"，而是屏幕手性** —— `DSHarea/wer-ref/src/backend/scene/internal/parser/WPParticleParser.cpp:705-710` 注释逐字："Hanabi's **screen-space handedness** makes **axis-cross-radial** bend each emitted arm to the viewer's left; **reverse the tangent** so every petal turns right…"。⇒ `wer-ref` 与 `lwe` 在**引擎算子数学上可能本就一致**，差异只在 y 轴朝向约定 ⇒ **"2 票 vs 1 票"的说法不成立；真正要定的是"官方用哪种屏幕手性"** |
| **照谁** | ⚠ **本机不能定案，官方沉默** —— 只能"照证据更强的一方"，且**必须保留回退档** |
| 依据 | `DSHarea/docs/VORTEX-CHIRALITY-RE-20260923.md:10-27`：官方反编译产物 **❌ 完全没有**；官方文档仅"模式/字段"级（**不含方向定义**）；官方 `assets/presets/magic/*` 锁定了字段集但**对手性沉默**；结论表述为"`(dy,−dx)` 是第三方实现中的多数且是较新、带对齐理由的一方 … **不是'已证实'而是'证据更强的一方'**" |
| **最短反编译路径（若要把这一条从"证据更强"升级为"已证实"）** | 目标 = **官方粒子 vortex 的切向符号**。① **Android 优先**（符号保留最全）：`nm -D apk-tmp/lib/arm64-v8a/libscenejni.so \| grep -i -E 'Particle\|Vortex'` 找出算子函数，再 `objdump -d --start-address=… --stop-address=…`；② **桌面兜底**：`llvm-objdump` 反汇编 `wallpaper64.exe`，用 `strings` 交叉定位 vortex 字段名字符串（`vortex`/`distanceinner`/`speedinner`）→ 从其 xref 找属性注册点 → 顺藤找消费点（方法学同 `DSHarea/docs/OFFICIAL-PARALLAX-RE-20260924.md:640-700` §B-3/B-4 已经走通的那条路）；③ 工具 = `python3` + `capstone 5.0.7`（本机已有） |
| 落地判据 | 现状=老符号 + **必须留 `?pvortex=legacy` 档位**（与 `DSHarea/docs/UPSTREAM-TRIAGE-20260923.md:55` 的建议一致）；**未与官方出帧对拍前不要默默翻默认值** |

### C4｜粒子 controlpointattract 门限：官方文档说"最大作用距离"，两个上游却都"除 2"

| 项 | 内容 |
|---|---|
| 冲突双方 | **webwallgl（新，2026-09-22）**：门限 = `threshold` **不除 2**；**lwe（`DSHarea/lwe-ref/src/WallpaperEngine/Render/Objects/CParticle.cpp:1463` 逐字 `float threshold = thresholdValue->getFloat () / 2.0f;`）+ wer-ref（`DSHarea/wer-ref/src/backend/scene/internal/parser/WPParticleParser.cpp:738` 逐字 `const double threshold = static_cast<double>(c.threshold) * 0.5;`）**：门限 = `threshold × 0.5` |
| **照谁（本次复核后，结论比原记录更强）** | ⚠ **官方文档站在 webwallgl 一边** ⇒ **此条应从"不采纳"升级为"待 S4 定案，且现行实现有可疑"** |
| 依据 | ① 官方文档 <https://docs.wallpaperengine.io/en/scene/particles/component/operator.html>（"Control point force" 节）逐字：**"Distance: The maximum distance of the force."** —— 若门限就是最大作用距离，"除 2"会把作用半径缩掉一半，文档没有任何"直径/半径"换算暗示；② **本次复核挖到的关键事实**：`wer-ref` 的"除 2"**不是引擎语义主张**，而是**逐壁纸的经验补偿** —— `DSHarea/wer-ref/src/backend/scene/internal/parser/WPParticleParser.cpp:735-737` 注释逐字："linux-wallpaperengine halves the authored threshold before applying the two **Cherry_Blossoms_2.json** controlpointattract operators. Without that, the broad attract/repel pair overreaches and pulls the blossom into center-to-arm lines."；③ 其配对的 lwe 代码 `CParticle.cpp:1463` 是**无条件**除 2（没有壁纸判断）⇒ 两条上游的关系是"wer-ref 为某一张壁纸把 lwe 的硬编码调参照抄过来"，**因此这两条不能作为"官方语义"的证据**。`DSHarea/docs/UPSTREAM-TRIAGE-20260923.md:60` 当时写"两条参考实现一致 ⇒ 不采纳"，**该推理链在本轮被推翻** |
| 最短定案路径 | S4：反汇编官方 control-point-force 算子的距离比较点（Android `.so` 优先 / 桌面 `llvm-objdump` 兜底）。**在此之前建议把这条从"已定"改标为"待定"**，并把现有 `?pops=legacy` 档位明确对应到"除 2 / 不除 2"两种口径 |
| 落地判据 | `we-scene-demo/core/we-scene-bundle.js:5176`（`pGetVal(pr, 'threshold', 512) * 0.5`）与 `:5199`（`sys.popsLegacy ? (d > thr) : (d < thr)` 分支；档位登记在 `:4136`）：门限值应提为具名常量 + `?pops=legacy` 双档，断言两档的吸引半径比 = 2 |

### C5｜HLSL 向量宽度 / 隐式截断：上游加"宽度表/重载" vs 官方资产"根本没这种写法"

| 项 | 内容 |
|---|---|
| 冲突双方 | **上游（webwallgl `78718843`）**：给 `hlsl2glsl.js` 加"复合赋值的向量截断"与 `vertConflicts`；给公共头加 `vec2 rotateVec2(vec4, float)` 重载、`ApplyBlending(float, …)` 重载。**官方资产**：`assets/shaders/**` 里"更宽右值赋给窄左值"= **0 处**、`texture(sampler, vec4)` = **0 处** |
| **照谁** | **两边都照，但不是同一层**：① **规则要不要加** ⇒ **照官方文档（S0）**：官方文档逐字写明"shaders are **translated into HLSL**"并给出 `CAST2/3/4/3X3` 宏 ⇒ **HLSL 的隐式截断是官方语义的一部分**，故上游的宽度规则是**合法超集**，应保留；② **"官方资产里 0 处"** 说明的是**官方自己的 shader 不依赖它**，对应结论是"**真触发来自第三方语料，不是官方**" |
| 依据 | 官方文档 <https://docs.wallpaperengine.io/en/scene/shader/syntax.html>：`## Type Casting`（"Since shaders are translated into HLSL, it is recommended to use the following casting macros…"）；官方资产普查 `DSHarea/docs/OFFICIAL-WE-ARTIFACTS-20260924.md:442`（§3.4 "官方**不使用**'宽度表'那种'更宽右值赋给窄左值'的写法（0 处）"）与 `:426`（§3.3 `texture(sampler, vec4)` = 0） |
| 落地状态（**已落地，不是待办**） | 我们**已经借了这两处**：`we-scene-demo/shaders/common.h:39-48`（`rotateVec2(vec4, float)` 重载 + 注释解释 HLSL/GLSL 差异）；`we-scene-demo/shaders/common_blending.h:293-302`（`ApplyBlending(float, …)` 重载） |
| 落地判据 | 已有：`we-scene-demo/vendor/hlsl2glsl/hlsl2glsl.js`（逐字节 vendored，覆盖率门禁 `tests/hlsl2glsl-coverage-test.mjs`，实测 **112/114 = 98.2%**，官方 effects 样本 **99.3%**，见 `DSHarea/docs/HLSL2GLSL-COVERAGE.md:10-14`）|

---

## ⑤ 风险与不做（宁可说做不到）

### 5.1 明确"不可用 / 不能复制"清单

| # | 对象 | 为什么不能用 | 边界（连什么都不能做） | 证据 |
|---|---|---|---|---|
| 1 | `Aromatic05/wallpaper-engine-renderer`（本机 `DSHarea/wer-ref/`） | **GPL-2.0-only**，与 GPL-3.0 **双向不兼容** | 不得复制/改写/逐行翻译代码、注释、常量组织、错误文案；**不得进入任何发布产物**；`import`/`require`/`readFile` 命中须为 0 | `we-scene-demo/docs/COPYING-RULES.md:44` |
| 2 | `Aromatic05/we-layerd`（本机 `DSHarea/we-layerd-ref/`） | **无任何许可 ⇒ 保留所有权利（比 GPL 更严）** | 同上；**连"照它的实现自写"都要避开其 GPL-2.0-only 子模块**（pin `89dfcd86…`） | `we-scene-demo/docs/COPYING-RULES.md:45,360-395`（§9.8 完整 L2 查证） |
| 3 | `catsout/wallpaper-scene-renderer` | **GPL-2.0-only**（已归档） | 只读行为结论 | `DSHarea/docs/LICENSE-COMPAT-REVIEW.md:95-111` |
| 4 | `waywallen/open-wallpaper-engine` | **GPL-2.0-only** | 只读行为结论 | `we-scene-demo/docs/COPYING-RULES.md:46` |
| 5 | `lucaschnabel42/wallgl` | **无许可**（且是空壳） | 连参考实现都没有 | `DSHarea/docs/SIMILAR-PROJECTS-RESEARCH.md:65` |
| 6 | 任何 `AGPL` 代码 | 进 MIT 侧插件禁止；进渲染器也无必要 | 不引 | `we-scene-demo/docs/COPYING-RULES.md:306-309`（§9.5 白名单/黑名单） |
| 7 | **官方 WE 资产（`assets/**` 的 shader / effect / preset / 字体）** | Wallpaper Engine 是商业软件；**不得随仓库分发其资产** | 只可**运行期读用户本机安装**；**不得 rehost**、不得内嵌进产物 | `DSHarea/docs/SIMILAR-PROJECTS-RESEARCH.md:370`（§6.2 第 4 条）+ `:145-146`（waywallen Flatpak 沙箱的制度性证据："连最激进的打包者也不 rehost WE 资产"） |
| 8 | **官方反编译/反汇编产物** | 本机与公开检索**都不存在**；且官方 EULA 限制分发衍生反汇编 | 反汇编结果**只作本机校准依据**，不要作为文件随仓分发 | `DSHarea/docs/VORTEX-CHIRALITY-RE-20260923.md:10` 前证据表；`DSHarea/docs/REVERSE-FEASIBILITY.md:23`（EULA 提示段逐字："避免分发衍生反汇编产物"） |
| 9 | **GPL 代码进 MIT 侧插件（`dsh-mpkg-wallpaper`）** | 方向性硬红线 | 不得复制、改写、逐行翻译、粘贴注释/常量顺序；跨仓测试也不得"切片执行"对方文件 | `we-scene-demo/docs/COPYING-RULES.md:32`（§2.2）+ `:56-71`（§3 协议边界规则 3.1–3.4） |

### 5.2 借 `GPL-3.0-only` 代码的**前置动作**（不是可选）

本仓规则允许 `GPL-3.0-only` 进渲染器（`we-scene-demo/docs/COPYING-RULES.md:36,41`），但**分发口径会随之收窄**：
含 `-only` 部分的工作**不能按 `or-later` 对外授权**。同一审计当时给出的建议也正是"**选 GPL-3.0（且写成 `GPL-3.0-only`）**"
（`DSHarea/docs/LICENSE-COMPAT-REVIEW.md:21`），而本仓最终落在 `or-later`。⇒ 若真的从 `Almamu/linux-wallpaperengine` 复制代码，**必须同批**做两件事：
① `we-scene-demo/THIRD-PARTY.md` §5（本仓自身许可节，`:527`）标注"包含 GPL-3.0-only 部分"；
② `we-scene-demo/README.md` / `README.en.md` 的许可段与 `we-scene-demo/tests/publish-check.mjs` 的许可一致性检查（`we-scene-demo/docs/COPYING-RULES.md:193-198`，§8 第①条）同步调整。
**在此之前不要动代码** —— 先改口径、再借实现。

### 5.3 归属缺口补录（本节是 §① 的落地动作）

**动作**：在 `we-scene-demo/THIRD-PARTY.md` 新增一节 + 在 `we-scene-demo/docs/COPYING-RULES.md` §4 台账（`:73`）新增一行。可复制文本：

```markdown
## 17. we-scene  (MIT © 2026 aurora-wallpaper contributors) — **溯源补录：经 oneincase/webwallgl vendored 树进入**

  Upstream:  https://github.com/wangkaxds/we-scene
  Licence:   MIT
  Copyright: Copyright (c) 2026 aurora-wallpaper contributors
  Created:   2026-08-15T20:26:56Z（早于 oneincase/webwallgl 的 2026-09-04T06:30:49Z）
  Evidence:  oneincase/webwallgl 的 vendored 树 `renderer/vendor/we-scene/LICENSE`
             （1,085 B）与本仓 `vendor/hlsl2glsl/` 同源；本仓 `demo.html:4938` 与
             `THIRD-PARTY.md` §14 均直接引用 `renderer/vendor/we-scene/**`，
             但只署名 oneincase。
  Scope:     `core/we-scene-bundle.js` 与 `renderer/vendor/we-scene/**` 存在
             512–2048+ 字符的逐字公共子串（render/renderer.js / hlsl2glsl.js /
             pkg/tex-codecs.js / pkg/container.js / render/noise.js 等）。
  Action:    MIT 声明须随分发保留（COPYING-RULES §2.1）。本条目为**补录**，
             不改变任何既有条目的结论；`oneincase/webwallgl` 的既有条目全部继续有效。
```

```markdown
| 16 | `wangkaxds/we-scene` | `src/**`（经 `oneincase/webwallgl` 的 `renderer/vendor/we-scene/**` 间接进入） | `main`（created 2026-08-15；SHA 待取） | MIT | 2026-09-24（判定日）/ 溯源补录 | 本轮审计 | we-scene-demo | **补录**：`THIRD-PARTY.md` §17；MIT 全文 + `LICENSE`（1,085 B）随仓 |
```

### 5.4 本计划**不做**的事（明确列出）

| 不做 | 理由 |
|---|---|
| 不主张"从零反编译重写渲染器" | 本机**无 Windows、无 WE 运行环境**；`DSHarea/docs/REVERSE-FEASIBILITY.md:18` 粗估"逆向核心 20～45 人日"，且该报告自己的推荐路线就是"**不主张'从零逆向重写渲染器'** … 只把原生二进制当**权威基准/oracle**，做**外科手术式**的定向逆向"（`:21`，每行为校准约 3～7 人日） |
| 不引入 `AnisPaper` / `open-wallpaper-engine` 的任何代码 | 当前无需求（我们是浏览器端，不静态链接 lwe）；且前者 only/or-later 表述冲突，保守按 `GPL-3.0-only` 对待（`we-scene-demo/docs/COPYING-RULES.md:42`） |
| 不引入 Web 类壁纸（iframe + shim）整条线 | 已有结论：成本高、与 MIT 插件侧职责重叠、差异化在 scene（`DSHarea/docs/SIMILAR-PROJECTS-RESEARCH.md:367`，§6.2 第 1 条） |
| 不为了"对齐上游"翻任何默认值 | 一律"加档位 + 留 `?*=legacy`"，未与官方出帧对拍前不翻默认（本轮 C3/C4 都按这条） |
| 不把官方资产或反汇编产物写进仓库 | §5.1 第 7/8 条 |
| 不在没有画面证据时把"第三方多数"说成"官方" | 用户要求以官方为准 ⇒ **"没有官方依据"必须明说**（C3 的处理方式即范例） |

### 5.5 本轮的未结项（如实登记，不粉饰）

| # | 未结项 | 缺什么 | 最短补救路径 |
|---|---|---|---|
| U1 | C3 vortex 手性 | 官方方向定义（官方文档沉默、`assets/presets/magic/*` 沉默、本机无官方反编译产物） | §④-C3 的 S4 路径（Android `.so` 优先） |
| U2 | C4 controlpointattract 门限 | 官方算子的距离比较点 | 同上；**在定案前把该条从"已定"改标"待定"**，并把 `?pops=legacy` 明确对应到"除 2 / 不除 2"两档（本轮已把"两条参考实现一致 ⇒ 不采纳"的旧推理链推翻，见 §④-C4 依据 ②③） |
| U3 | `wangkaxds/we-scene` 的 `main` HEAD SHA | 本轮只取了 `LICENSE`/`README`/7 个模块的 raw 内容与 API 元数据，**未取全仓 SHA** | `curl -s https://api.github.com/repos/wangkaxds/we-scene/commits/main` |
| U4 | webwallgl 是"从 we-scene 起步"的**直接**证据（首个 commit 的该路径内容） | 本轮靠"目录名 + 路径名 + 时间序 + `[we-scene patch]` 标注 + 长块逐字相同"作证，**尚未取 webwallgl 首个 commit 的该路径 blob** | `curl -s 'https://api.github.com/repos/oneincase/webwallgl/commits?path=renderer/vendor/we-scene&per_page=1&until=2026-09-06'` |
| U5 | `masterLazy/RePKG.Neo` 相对 repkg 的**具体增量** | 本轮只核了许可与 fork 关系 | 取两仓 `PKG`/`TEX` 目录的 diff |

---

## 附录 A｜本计划全部外部证据链接

| 用途 | URL | 抓取日 |
|---|---|---|
| 官方设计文档（**S0**）sitemap | <https://docs.wallpaperengine.io/sitemap.xml> | 2026-09-24 |
| 官方：着色器方言与类型转换（**S0**，C5 定案） | <https://docs.wallpaperengine.io/en/scene/shader/syntax.html> | 2026-09-24 |
| 官方：粒子算子字段语义（**S0**，C4 依据） | <https://docs.wallpaperengine.io/en/scene/particles/component/operator.html> | 2026-09-24 |
| 官方：SceneScript `IScene`（**S0/S2** 交叉核对） | <https://docs.wallpaperengine.io/en/scene/scenescript/reference/class/IScene.html> | 2026-09-24 |
| `Almamu/linux-wallpaperengine` API（SPDX `GPL-3.0`） | <https://api.github.com/repos/Almamu/linux-wallpaperengine> | 2026-09-24 |
| `Almamu/...` LICENSE 原文（GPLv3 全文） | <https://raw.githubusercontent.com/Almamu/linux-wallpaperengine/master/LICENSE> | 2026-09-24 |
| `Almamu/...` 着色器方言头（C5 / S5 借用对象） | <https://raw.githubusercontent.com/Almamu/linux-wallpaperengine/main/src/WallpaperEngine/Render/Shaders/ShaderUnit.cpp> | 2026-09-24 |
| `AzPepoze/linux-wallpaperengine` API（**同名不同项目**，非 fork） | <https://api.github.com/repos/AzPepoze/linux-wallpaperengine> | 2026-09-24 |
| `AzPepoze/...` LICENSE（GPLv3 + `Copyright (C) 2026 AzPepoze`） | <https://raw.githubusercontent.com/AzPepoze/linux-wallpaperengine/main/LICENSE> | 2026-09-24 |
| `notscuffed/repkg` API（MIT） | <https://api.github.com/repos/notscuffed/repkg> | 2026-09-24 |
| `masterLazy/RePKG.Neo` API（Apache-2.0，fork of repkg） | <https://api.github.com/repos/masterLazy/RePKG.Neo> | 2026-09-24 |
| `wangkaxds/we-scene` API（MIT，created 2026-08-15） | <https://api.github.com/repos/wangkaxds/we-scene> | 2026-09-24 |
| `wangkaxds/we-scene` LICENSE（© 2026 aurora-wallpaper contributors） | <https://raw.githubusercontent.com/wangkaxds/we-scene/main/LICENSE> | 2026-09-24 |
| `wangkaxds/we-scene` README（模块划分，用于定位） | <https://raw.githubusercontent.com/wangkaxds/we-scene/main/README.md> | 2026-09-24 |
| `wangkaxds/dsh-aurora-wallpaper` API（MIT，created 2026-08-15） | <https://api.github.com/repos/wangkaxds/dsh-aurora-wallpaper> | 2026-09-24 |
| `wangkaxds/dsh-aurora-wallpaper` README（自述引擎为 we-scene） | <https://raw.githubusercontent.com/wangkaxds/dsh-aurora-wallpaper/main/README.md> | 2026-09-24 |
| `oneincase/webwallgl` API（MIT，created 2026-09-04） | <https://api.github.com/repos/oneincase/webwallgl> | 2026-09-24 |
| `oneincase/webwallgl` README（无 we-scene 署名） | <https://raw.githubusercontent.com/oneincase/webwallgl/main/README.md> | 2026-09-24 |
| `elysia395/dsh-wallpaper-engine` API（MIT，337★） | <https://api.github.com/repos/elysia395/dsh-wallpaper-engine> | 2026-09-24 |
| `Paradox07127/macos-wallpaperengine` API（MIT） | <https://api.github.com/repos/Paradox07127/macos-wallpaperengine> | 2026-09-24 |
| `NixaXI/AnisPaper`（GPL-3.0；only/or-later 冲突详见本仓审计） | <https://github.com/NixaXI/AnisPaper> | 2026-09-24 |

## 附录 B｜本计划全部本机引用（可当场复核）

```bash
# ── 归属缺口（§① / §5.3）────────────────────────────────────────────
grep -rni --exclude-dir=node_modules --exclude-dir=.git aurora we-scene-demo/     # ⇒ 0 命中
head -3 references/vendor-ref/webwallgl/renderer/vendor/we-scene/LICENSE          # ⇒ Copyright (c) 2026 aurora-wallpaper contributors
sed -n '4938p' we-scene-demo/demo.html                                            # ⇒ 引用 renderer/vendor/we-scene/render/audio.js

# ── 官方一手产物（§③-S1/S2）────────────────────────────────────────
grep -n 'g_ParallaxPosition' wallpaper_engine/assets/effects/depthparallax/shaders/effects/depthparallax.vert
ls wallpaper_engine/assets/effects | wc -l                                        # ⇒ 46
find wallpaper_engine/assets/shaders -type f | wc -l                              # ⇒ 137
wc -l docs/_official-extract/lib.sceneScript.d.ts                                 # ⇒ 1629（2.4 版权威表）

# ── 许可（§②）──────────────────────────────────────────────────────
sed -n '9p' lwe-ref/packaging/archlinux/PKGBUILD                                  # ⇒ license=('GPL-3.0-only')
node -e 'const fs=require("fs"),c=require("crypto");const b=fs.readFileSync("lwe-ref/LICENSE");
  console.log(c.createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex"))'
#   ⇒ f288702d2fa16d3cdf0035b15a9fcbc552cd88e7

# ── 冲突场景（§④）──────────────────────────────────────────────────
sed -n '57,61p'   docs/OFFICIAL-PARALLAX-RE-20260924.md      # C1 平滑系数真公式 + 3.3 倍
sed -n '10,27p'   docs/VORTEX-CHIRALITY-RE-20260923.md       # C3 结论与证据强度
sed -n '55p;60p'  docs/UPSTREAM-TRIAGE-20260923.md           # C3/C4 的两条上游变更（★ 结论已被本轮修正）
sed -n '442p'     docs/OFFICIAL-WE-ARTIFACTS-20260924.md     # C5 官方"0 处"普查

# ── 本轮新增核实：C3 的"票数"修正 + C4 的"经验补偿"事实 ────────────────
sed -n '1384p' lwe-ref/src/WallpaperEngine/Render/Objects/CParticle.cpp
#   ⇒ glm::vec3 tangent = glm::cross (axis, radialVector);      （= (−dy,+dx)）
sed -n '1463p' lwe-ref/src/WallpaperEngine/Render/Objects/CParticle.cpp
#   ⇒ float threshold = thresholdValue->getFloat () / 2.0f;     （无条件除 2）
sed -n '705,711p' wer-ref/src/backend/scene/internal/parser/WPParticleParser.cpp
#   ⇒ 注释：screen-space handedness … reverse the tangent；代码：relative.cross(axis)
sed -n '735,738p' wer-ref/src/backend/scene/internal/parser/WPParticleParser.cpp
#   ⇒ 注释：linux-wallpaperengine halves the authored threshold … Cherry_Blossoms_2.json

# ── S5 借用对象的行锚点（§2.1）──────────────────────────────────────
grep -n 'define SHADER_HEADER\|void ShaderUnit::preprocessVariables\|void ShaderUnit::parseComboConfiguration' \
  lwe-ref/src/WallpaperEngine/Render/Shaders/ShaderUnit.cpp    # ⇒ :22 / :96 / :442
```

---

*本文件是唯一新增文件；写作过程未修改 `we-scene-demo/**` 的任何代码、测试或配置，未 `git add`/`commit`，未启动浏览器。*

# COMPLIANCE-REVIEW —— "来源—许可—证据"清单（机器可读友好）

> **这是什么**：本仓库**逐组件**的合规台账。每一行 = **组件/文件 ｜ 来源 ｜ 许可 ｜ 证据（URL / 日期 / sha256）
> ｜ 合规状态 ｜ 待办**。给律师、给发布前复核、也给脚本解析用。
> **口径**：本项目主张**独立实现（independent implementation）**，**不主张洁净室**（依据与逐项事实见
> `docs/REIMPLEMENTATION-STATEMENTS.md`；规则见 `docs/COPYING-RULES.md` **§5.1**）。
> **不是法律意见**；标 "待律师" 的行**必须**由律师定性，工程处置不替代法律意见。
> **日期**：2026-09-17 · **落点**：`docs/COMPLIANCE-REVIEW.md` · 维护规则：**引入/移除任何第三方材料必须同期改本表**。

---

## 0. 状态码（机器可读）

| 状态码 | 含义 | 发布闸门 |
|---|---|---|
| `OK` | 事实已固定、许可已满足、证据可复现 | 允许分发 |
| `OK-ATTRIB` | 许可允许，但**必须**携带署名/许可全文（已在位） | 允许分发（署名缺失即阻塞） |
| `REVIEWED` | 会被门禁**打印**的项（如与 WE 副本字节相同/有效行重合）——**已确认来源为上游同一文件，非 WE 复制**，仍**照常打印**并附证据引用 | 允许分发，但**每次发布前人工复核一行** |
| `PENDING-COUNSEL` | 合规动作已完成，**法律定性待律师** | 允许分发 + **主动披露**（不得声称"已结案"） |
| `HOLD` | 有未决风险，**不得**进入产物 | **阻塞**，除名或整改前不可发布 |

> **`REVIEWED` 与 `OK` 的区别**：`OK` 是"没有异常"，`REVIEWED` 是"**有异常但已查明来源**"——
> 后者**不静默**：`node tests/publish-check.mjs --assets <WE 资产根>` 每次都会把它们**打印出来**，
> 并附 `THIRD-PARTY.md` 的章节引用与来源证据。**"打印但已解释" ≠ "放行"**。

---

## 1. 主表（逐行覆盖）

| # | 组件 / 文件 | 来源（上游） | 许可（SPDX） | 证据（URL / 日期 / sha256） | 状态 | 待办 |
|---|---|---|---|---|---|---|
| 1 | `core/we-scene-bundle.js` 的 **`src/render/effects.js` 那节**（CPU 效果链：混合模式 / HSL / 像素颜色效果 / 位移 / waterflow） | 原件 = WE 专有 shader/效果（轴①）；重写依据 = 公开标准（W3C Compositing and Blending Level 1、PDF 1.7 §11.3、GLSL 规范）+ 本项目契约 | 本项目 `GPL-3.0-or-later`（新实现）；不得含 WE 表达 | 规格 `docs/EFFECTS-COMPUTE-SPEC.md`；测试 `tests/clean-room-effects-blend-test.mjs`（312 断言）+ 语料 `tests/effects-corpus.mjs`；留痕 `docs/PATCHES.md` **P-100-R1**；口径声明 `docs/REIMPLEMENTATION-STATEMENTS.md` §2 | `PENDING-COUNSEL` | 审计 §7 **Q1/Q5**：重写**前**的"逐行翻译"自认是否已充分消除 ⇒ **待律师** |
| 2 | `wer-ref/`（`Aromatic05/wallpaper-engine-renderer`，仓库外只读副本） | <https://github.com/Aromatic05/wallpaper-engine-renderer>（`catsout/wallpaper-scene-renderer` 的 fork），HEAD `89dfcd86de2dc0ae537bc136046c5ed05733e7b7` | **`GPL-2.0-only`**（`LICENSE` 18,092 B；blob `d159169d1050894d3ea3b98e1c965c4058208fe1`） | 行为对照审计：`../docs/WER-REF-LICENSE-AUDIT.md`（逐字复制 0 处、段落级 0 处；2 处点状同源）；`import`/`require`/`readFile` 指向该目录 = **0 命中**（`grep -rnE "(import\|require\|readFile…)[^\n]{0,80}wer-ref"`） | `PENDING-COUNSEL` | ① 与 `GPL-3.0-or-later` **双向不兼容** ⇒ 永不进产物、永不复制；② 两处点状同源的法律定性 **U-1** 待律师；③ 清单穷尽性 **U-5** 待律师 |
| 3 | `shaders/common.h`、`common_blending.h`、`common_blur.h`、`common_composite.h`、`common_fragment.h`、`common_perspective.h`（**6 个**） | 原件 = WE 专有 `assets/shaders/common*.h`（本机只读，未分发；原件归档 `Delete/we-official-shaders/`，7 个含 `common_vertex.h`） | 本项目 `GPL-3.0-or-later`；其中 BT.601 权重/标准色彩变换矩阵 = **公开标准的事实性内容** | 声明与理由 `THIRD-PARTY.md` **§4A**（含中英双语声明原文）；残留清单 `../docs/WER-REF-LICENSE-AUDIT.md` §4.3；留痕 `docs/COMMON-HEADERS-REPLACEMENT.md`；首行免责 `// Original implementation for this project; … No third-party code.`；sha256：`013b5bd2…`（`common.h`）等 6 条 | `PENDING-COUNSEL`（**合并原则**） | §4A.2 的**双刃剑**：重写后有效行与 WE 原件**仍高度重合**（`common_vertex.h` 100%，故**不发布**）⇒ 定性 **待律师**（Q3/Q4） |
| 4 | `shaders/common_vertex.h` | 同上（**故意不发布**） | 不适用（不随仓库分发） | 不发布的理由与两份归档：`../Delete/we-official-shaders/common_vertex.h`（`7bc1bc8a…`）、`…-leftover/common_vertex.h`（`f02b7694…`）；留痕 `docs/COMMON-HEADERS-REPLACEMENT.md` §1.1 + `docs/PATCHES.md` **P-95**；引用面 = 0（`BuildTangentSpace` 零调用点） | `OK` | 若将来要恢复该文件，必须**先**做成真正的独立实现并重新过 §4A ⇒ 当前**不恢复** |
| 5 | `assets/fonts/` **7 个字体**（`Blackout 2 AM.ttf`、`monof55.ttf`、`NotoSans-Regular.ttf`、`RobotoMono-Regular.ttf`、`Segment7Standard.otf`、`Twemoji.Mozilla.ttf`、`spincycle_3d_ot.otf`） | 逐文件见 `THIRD-PARTY.md` **§4.1**（上游官方渠道：GitHub raw / GitHub release / Debian 上游 tarball / FontLibrary 下载包 / 作者站点 bvfonts.com）；**取件日期 2026-09-15**；**无一取自 WE 安装目录** | 5×`OFL-1.1` + 1×`CC-BY-4.0`（Twemoji 美术）+ 1×`LicenseRef-BVFonts-Freeware-2006`（本地定义，作者 freeware 条款）；目录级：`OFL-1.1 AND CC-BY-4.0 AND LicenseRef-BVFonts-Freeware-2006` | 逐文件 URL + 取件日期 + 字节数 + **sha256**：`48e96e2a…`（Blackout）、`02567677…`（monof55）、`b85c38ec…`（NotoSans）、`af0bff75…`（RobotoMono）、`f35b8ce7…`（Segment7）、`6d90152e…`（Twemoji）、`cc4a580a…`（spincycle）；未修改 = 逐字节上游原件；许可全文 12 个文件在 `assets/fonts/licenses/` | `OK-ATTRIB` | ① `spincycle_3d_ot.otf` 的作者条款**逐条义务表**（`THIRD-PARTY.md` §4.6.1）与 4 条未定项 **待律师**；② SPDX 的 `LicenseRef-` 命名 **待确认**；③ 复验配方 §4.8 |
| 6 | `vendor/hlsl2glsl/`（`hlsl2glsl.js` + `hlsl-preprocessor.js` + `LICENSE`） | `oneincase/webwallgl` @ `fdfc578a577d0e680a9cfe2cf2e3e825d3cd2372`（v1.3.23，2026-09-15） | **`MIT`** | **逐字节 vendored**：`hlsl2glsl.js` sha256 `c5fc3002…`（77,953 B）、`hlsl-preprocessor.js` `0583682e…`（14,971 B）、`LICENSE` `857432ca…`；`git diff origin/main` 为空；署名 `THIRD-PARTY.md` §9（含"哪些**没有** vendored"边界表） | `OK-ATTRIB` | MIT 声明必须随产物（`publish-check` ④b 已机器断言）；**转译器尚未接线**（属功能待办，非合规待办） |
| 7 | `core/we-scene-bundle.js` 的 `FXAA_FS` 常量 | `oneincase/webwallgl` @ `fdfc578a…`，`renderer/vendor/we-scene/render/renderer-glsl.js` 的 `FXAA_FRAG`（上游 452–489 行） | **`MIT`** | **逐字复制**：38/38 GLSL 行无 token 差异（常量 `SPAN_MAX`/`REDUCE_MUL`/`REDUCE_MIN`/`LUMA` 全为上游值）；署名 `THIRD-PARTY.md` §6（含 MIT 全文） | `OK-ATTRIB` | 无（署名与全文在位）；`?aa=fxaa` 的实现自写部分**不属**本行 |
| 8 | `demo/**`（WebWallGL 静态构建，含 `renderer-*.js` / `bench-*.js` / `index.html` / `sw.js` 等） | `oneincase/webwallgl` 静态构建 + 本项目补丁 `demo/bench-patch.js` | **`MIT`**（上游构建） + 本项目 `GPL-3.0-or-later`（补丁） | 双份等效 MIT 声明随目录：`demo/LICENSE-webwallgl-MIT.txt` + `demo/LICENSE-webwallgl`；`publish-check` ④ 对任何 `webwallgl` 路径强制要求带 MIT 的 LICENSE/COPYING | `OK-ATTRIB` | 两份 LICENSE **都不得删除**；`demo/` 不得混入壁纸内容（现为自造合成样例 `samples/sample-synthetic/`） |
| 9 | `elysia/**` + `core/attach-transform.mjs` | `elysia395/dsh-wallpaper-engine`（PR #47，merged 2026-08-25） | **`MIT`** | 上游 MIT 全文在 `elysia/LICENSE`；署名 `THIRD-PARTY.md` §1（逐文件列表：`we-renderer/**`、`font-render.js`、`scene-scripts.js`、`scene-script-apis.js`、`core/attach-transform.mjs`） | `OK-ATTRIB` | 30/43 文件与上游逐字节相同（属**允许**的同许可内移植）；`scene-scripts.js`/`scene-script-apis.js` 为"移植并扩展"⇒ 改动须继续保留 MIT 声明 |
| 10 | `elysia/vendor/@shaderfrog/glsl-parser/`（7.0.1，整包 vendored） | <https://github.com/ShaderFrog/glsl-parser> | **`ISC`**（上游未发 LICENSE 文件，声明来自其 `package.json`） | `elysia/vendor/@shaderfrog/glsl-parser/LICENSE` 在位（ISC 文本 + 说明"由包元数据重建"）；署名 `THIRD-PARTY.md` §2 | `OK-ATTRIB` | 生成代码的 Peggy 仅为**礼节性致谢**（§3），Peggy 本体未分发 |
| 11 | `dsh-mpkg-wallpaper`（MIT 插件）的包解析器 `lib/pkg-extract.js` —— 被渲染器 **import**（`server/pack-dir.mjs`、`server/we-scene-demo-server.mjs`） | <https://github.com/XHR666/dsh-mpkg-wallpaper> | **`MIT`**（插件保持 MIT；`package.json.license` = `MIT`） | 渲染器 `THIRD-PARTY.md` §7；`publish-check` ⑤② 断言"插件 LICENSE 仍是纯 MIT（无 GPL 文本）"且"本仓库未 vendored 插件文件"；方向 = **MIT → GPL-3.0-or-later 允许单向流动**（`COPYING-RULES.md` §2.1） | `OK-ATTRIB` | **反向禁止**：渲染器 GPL 代码不得进入 MIT 插件（§2.2） |
| 12 | 图标：`demo/bench-patch.js` 的 `DIR_ICONS`（`folder`/`file`/`house`/`check`/`x` + 备用的 `arrow-up`/`search`） | `lucide-icons/lucide`（npm `lucide-static@0.545.0`） | **`ISC`**（源自 Feather 的部分为 `MIT`） | 5 条 `d`/`cx,cy,r` 于 2026-09-17 与 jsDelivr 上该版本**逐字节**比对相同；全文 `demo/LICENSE-lucide-ISC.txt`；逐图标表 `THIRD-PARTY.md` §13 + `docs/ICONS-NEEDED.md`；台账 #11 | `OK-ATTRIB` | 只取几何、无 vendored 文件、无依赖、无图标字体（保持这条边界） |
| 13 | 参考/行为对照登记（**未取代码**）：`linux-wallpaperengine`（GPL-3.0-only）、`catsout/wallpaper-scene-renderer`（GPL-2.0-only）、`waywallen/waywallen`（MIT）、`waywallen/open-wallpaper-engine`（GPL-2.0-only）、`aqnya/unmpkg`（GPL-3.0）、`notscuffed/repkg`（**MIT，2026-09-17 定案**）、`we-layerd-ref/`（**无许可 ⇒ 保留所有权利**，上游打包元数据自认 `custom:unlicensed`）、`Almamu/linux-wallpaperengine` | 逐条见 `THIRD-PARTY.md` §8 与 `docs/COPYING-RULES.md` §2.3 | 各异（见左） | `THIRD-PARTY.md` §8 逐行"Code copied? **No**"；`we-layerd-ref` 完整 L2 证据表 `docs/COPYING-RULES.md` §9.8；引用面统计（26 文件 / 37 行**纯文字**、`import`/`readFile` **0** 命中）§9.8.1；RePKG 定案 §9.10 | `OK`（均为零引入） | ① 每轮发布前复核上游许可状态（`§9.11`）；② 任一对象若要真借用 ⇒ 先走 §9 阶梯 L1–L5，再改本表 |
| 14 | 本项目自有代码与文档 | 本仓库 | **`GPL-3.0-or-later`**（`LICENSE` = GPL v3 原文 + 版权声明 + "or any later version"） | `package.json.license` = `GPL-3.0-or-later`（`publish-check` ⑤① 断言一致）；`THIRD-PARTY.md` §5 声明"§1–§4 的 MIT/ISC/OFL/Apache/CC-BY 通知**不因本仓库 GPL 而被重新许可**" | `OK` | CLA：**暂不引入**，保留"首个外部 PR 时启用"的决定点（`COPYING-RULES.md` §7.4） |
| 15 | 边界架构：MIT 插件 ↔ GPL 渲染器 | 两仓（本仓库 + `dsh-mpkg-wallpaper`） | 各自的 SPDX 不变 | `THIRD-PARTY.md` **§4B**：不同进程/iframe、标准 Web 协议（`?pkgurl=`、`postMessage`、经 `contentWindow` 校验）、各自可独立运行、互不 import 对方代码；契约 `docs/RENDERER-SANDBOX-CONTRACT.md` §1–§2 | `OK` | ⚠ **边界失效条件**：将来以 Tauri 等打包分发时，渲染器**必须是独立 sidecar 进程，不得编译进同一二进制**（§4B.1）⇒ 打包前**先**过许可评审 |
| 16 | 隐私/发布面（**非许可行，但同属发布闸门**） | — | — | `tests/publish-check.mjs` ②（个人绝对路径 / 凭据 / 私钥文件）与 ①（>100 MB 单文件）——发布前必须 **0 阻塞**；私有清单文件（`library-manifest.json` 等）**禁止**进公开仓库 | `OK` | 每次发布前跑 `node tests/publish-check.mjs`；`--assets` 再跑一次拿 `REVIEWED` 行 |

---

## 2. 发布前必须跑的机器闸门（轻量项）

```bash
cd "$(git rev-parse --show-toplevel)"      # 仓库根（= we-scene-demo）
node tests/docs-check.mjs        # 文档引用完整性 + P 编号健康 + 诊断开关一致性（期望 rc=0）
node tests/publish-check.mjs     # 隐私 / 体积 / 许可一致性 / vendored 署名 / 字体许可（期望 0 阻塞）
# 拿到 WE 资产根时（复核字体与 common*.h 的"与 WE 副本关系"，期望：仅 REVIEWED 行，无阻塞）：
node tests/publish-check.mjs --assets "$MPW_WE_ASSETS"   # WE 资产根：本机默认 = 仓库父目录下的 wallpaper_engine/assets
```

**怎么读 `REVIEWED` 行**：脚本会把"与 WE 官方资产逐字节相同 / 去注释后相同 / 同名有效行重合 ≥ 阈值"的每一次命中
**照常打印**，并在消息后附上 `note=` —— `note` 就是**证据引用**（形如
`REVIEWED: 已确认来源为上游同一文件，非 WE 复制；证据 THIRD-PARTY.md §4.1 …`）。
**这不是静默通过**：命中行仍逐条可见；发布人必须**逐条**确认 `note` 指向的证据成立，才能进入人工复核。

---

## 3. 与其它文档的关系（谁说什么）

| 文档 | 角色 |
|---|---|
| `THIRD-PARTY.md` | **发布通知**（shipping notice）：许可全文、逐文件证据、"我们是什么/不是什么"的对外表述 |
| `docs/COMPLIANCE-REVIEW.md`（本文） | **台账**：一行一组件，含状态码与待办；发布前复核的入口 |
| `docs/REIMPLEMENTATION-STATEMENTS.md` | **事实声明**：谁接触过什么、重写依据、谁写谁复核、"独立实现而非洁净室" |
| `docs/COPYING-RULES.md` | **规则**：单向流动、协议边界、借鉴台账、L1–L5 处置阶梯、§5.1 术语口径、§7.4 CLA 决定点 |
| `docs/TAKEDOWN-RESPONSE.md` | **应急流程**：收到主张/下架要求时的 72h 模板与"先删后议"清单 |
| `../docs/WER-REF-LICENSE-AUDIT.md`（工作区根，仓库外） | **取证记录**：血缘审计原始判定（**逐字保留**）+ §7.2 口径更正 |
| `docs/PATCHES.md` | **只增不改的历史台账**：每次处置的留痕（P-89 / P-95 / P-100-R1 / P-102 / P-103 …） |

---

## 4. 已知待办（**逐文件**登记，避免"改了半套被当成已收口"）

> 这批"洁净室"字样**不在** 2026-09-17 口径更正的改动范围内（属历史台账 / 其它并发线 / 代码注释），
> 但**对外表述必须最终一致** ⇒ 登记在此，逐条销账。**清单本身不改历史判定文字**。

| # | 文件 | 情况 | 建议动作 | 归属 |
|---|---|---|---|---|
| T-1 | `README.md`（本仓库根，§7.4(2)、§7.1(2) 等处） | 仍写"已于 2026-09-16 按书面规格**洁净室重写**" | 改为"按规格**独立实现**（不主张洁净室）"+ 指向 `docs/REIMPLEMENTATION-STATEMENTS.md` | 发布面文档线 |
| T-2 | `docs/README-PUBLIC.md`（本仓库） | 同上（"P-95 洁净室"、"L1 洁净室重写"） | 同上；§9 的阶梯名同步为"按规格独立实现" | 发布面文档线 |
| T-3 | `docs/PATCHES.md`（本仓库，P-89/P-95/P-100-R1 标题与正文） | 历史台账，**只增不改** | **不改历史**；可在最新编号下追加一条"口径更正"引用 §5.1 与本文档 | 台账线（正在写入） |
| T-4 | `core/we-scene-bundle.js`、`core/audio-band-array.mjs` 等**代码注释** | 注释里仍有"洁净室重写/洁净室实现" | 改为"独立实现（按规格）"；**不改任何逻辑**；改后重跑对应门禁 | 代码线（并发中） |
| T-5 | `docs/IMAGE-ALPHA-ALIGN-SPEC.md`、`docs/EFFECTS-COMPUTE-SPEC.md` | 顶部写"供**洁净室重写**使用" | 改为"供**按规格独立实现**使用；实现者可能接触过原件 ⇒ 本项目不主张洁净室" | 规格文档线 |
| T-6 | `docs/ELYSIA-DIFF-AUDIT.md:46` | "（`src/render/effects.js` 节，**洁净室重写**）" | 改为"独立实现（P-100-R1）" | 审计文档线 |
| T-7 | `tests/clean-room-alpha-align-test.mjs`、`tests/clean-room-effects-blend-test.mjs`（**文件名**） | 文件名里含 `clean-room-` | **暂不改名**（改名会牵动 `tests/run-all-tests.sh` 注册项与多份文档引用，属**并发禁令**范围内的文件）⇒ 在测试头部注释里加一句口径说明：`// 文件名沿用历史命名；本项目主张"独立实现"，不主张洁净室（见 docs/COPYING-RULES.md §5.1）` | 测试线（并发中） |
| T-8 | 本文件 §1 第 1/2/3 行的 `PENDING-COUNSEL` | 法律定性未结 | 律师意见到手后：**逐行**更新状态码与结论，并把"已结案"写进 `THIRD-PARTY.md` 对应节 + `docs/PATCHES.md` 新编号 | **用户/律师** |

**销账规则**：每完成一条，把该行状态改为 `DONE（日期 + 证据）`，**不删除该行**（保留改动痕迹）。

# COPYING-RULES —— 许可单向流动规则、借鉴台账与协议边界

> 适用仓库：`dsh-mpkg-wallpaper`（DSH 插件，**MIT**）与 `we-scene-demo`（浏览器端 WE 场景渲染器，**GPL-3.0-or-later**）。
> 本文是工程规则，**不是法律意见**；出现疑问时以各仓库 `LICENSE` 全文与原始上游许可为准，必要时咨询律师。
> 落地记录：`we-scene-demo/PATCHES.md` P-89（2026-09-16）；事实依据：`LICENSE-COMPAT-REVIEW.md`、`PLUGIN-POLLUTION-AUDIT.md`。

---

## 1. 现状（2026-09-16 起）

| 仓库 | 许可 | 依据文件 |
|---|---|---|
| `dsh-mpkg-wallpaper`（插件，DSH 宿主侧） | **MIT**（保持不变） | `dsh-mpkg-wallpaper/LICENSE` 首行 `MIT License`；`package.json` `"license": "MIT"` |
| `we-scene-demo`（渲染器） | **GPL-3.0-or-later** | `we-scene-demo/LICENSE` = GNU GPL v3 条款原文（35,147 字节，逐字节未改）+ 末尾版权声明与 "either version 3 … or (at your option) any later version" |

**依赖方向是既成事实**：渲染器 import 插件的包解析器（`we-scene-demo-server.mjs` 等 12 个 `.mjs`、34 处引用
`parsePkg`/`readPkgEntry`）。因此渲染器分发时**必须携带插件的 MIT 声明**（`THIRD-PARTY.md` §7）。

---

## 2. 单向流动规则（硬规则）

```
  dsh-mpkg-wallpaper (MIT)  ──✅ 允许──▶  we-scene-demo (GPL-3.0-or-later)
  we-scene-demo (GPL)       ──❌ 禁止──▶  dsh-mpkg-wallpaper (MIT)
  任何第三方 GPL-3.0 代码    ──⚠️ 只允许──▶ we-scene-demo，且必须登记台账（§4）
```

2.1 **MIT → GPL ✅**：MIT 代码可以进 GPL 项目；进入后该副本按 GPL 分发，但**原 MIT 声明必须保留**
（渲染器的 `THIRD-PARTY.md`、`LICENSE` 附近的第三方清单就是为此存在）。

2.2 **GPL → MIT ❌**：GPL 代码**不得**进入插件（不得复制、改写、逐行翻译、粘贴注释/常量顺序）。
判定不看"改了变量名没有"，看**表达是否同源**：判定顺序、位掩码、错误文案、注释文字、
常量组织方式、数据结构形态同时对上 = 同源。

2.3 **第三方 GPL-3.0 → 渲染器**：只有 GPL-3.0（含 `-only`/`-or-later`）代码允许进渲染器；
**GPL-2.0-only 不可借**（与 GPL-3.0 不兼容）。据 `LICENSE-COMPAT-REVIEW.md`：

| 上游 | 许可 | 能否借进渲染器 |
|---|---|---|
| `linux-wallpaperengine` | GPL-3.0-only | ✅ 可借（须台账 + 保留声明） |
| `AnisPaper` | GPL-3.0 | ✅ 可借（注意其 only/or-later 表述冲突，未定项） |
| `catsout/wallpaper-scene-renderer` | GPL-2.0-only | ❌ 不可借 |
| `Aromatic05/wallpaper-engine-renderer`（本机 `wer-ref/`） | **GPL-2.0-only** | ❌ **不可借**（与 GPL-3.0 双向不兼容）。**仅行为对照 / 独立实现（按规格，不主张洁净室；见 §5.1）**：可读其行为结论，**严禁复制代码、注释、常量组织或错误文案**；**不得进入任何发布产物**。本机副本 = `wer-ref/`（仓库外，从未被 import / readFile） |
| `Aromatic05/we-layerd`（本机 `we-layerd-ref/`） | ⚠ **无许可**（上游 `/license` = HTTP 404；本机 `LICENSE*`/`COPYING*` = 0 个；`Cargo.toml` 无 `license`/`repository` 字段；**上游自己的打包元数据自认 `custom:unlicensed` / `LicenseRef-Unlicensed`**）⇒ **保留所有权利** | ❌ **不可借**（比 GPL 更严）。**仅行为对照 / 独立实现（按规格，不主张洁净室；见 §5.1）**：只可读行为结论，**严禁复制代码**；**不得进入任何发布产物**。本机副本 = `we-layerd-ref/`。**另注**：其 `.gitmodules` 把 **GPL-2.0-only** 的 `Aromatic05/wallpaper-engine-renderer` 作为渲染核心子模块捆进来（pin `89dfcd86…`，= 本工作区 `wer-ref/`）⇒ 连"照它的实现自写"都要避开该子模块。**完整 L2 查证与处置判定见 §9.8** |
| `waywallen/open-wallpaper-engine` | GPL-2.0-only | ❌ 不可借 |
| `waywallen/waywallen` | MIT | ✅ 可借（按 MIT 署名；若进渲染器同样登记） |
| `oneincase/webwallgl` | MIT | ✅ 可借（**P-90 已借**：`FXAA_FRAG` 一个 shader，见 §4 台账 #6 与 `THIRD-PARTY.md` §6；**P-93 已借**：转译器两个文件**逐字节 vendored** 到 `we-scene-demo/vendor/hlsl2glsl/`，见 §4 台账 #8 与 `THIRD-PARTY.md` §9；其余仍只作研读对照） |
| `elysia395/dsh-wallpaper-engine` | MIT | ✅ 已借（`elysia/**`、`attach-transform.mjs`，见 `THIRD-PARTY.md` §1） |

2.4 **工作流（用户拍板）**：以后**先改 MIT 的插件，GPL 的渲染器再借用**。反向（先在渲染器写完再
"搬回"插件）一律禁止——这正是 2026-09-16 的**按规格独立实现**要修掉的历史问题（当时写作"洁净室重写"，该口径已按 §5.1 更正）。

---

## 3. 协议边界规则（插件侧）

3.1 插件**不得** import、内嵌、转译渲染器的任何 GPL 代码；渲染器是 GPL 侧，插件是 MIT 侧。

3.2 两侧只能走**进程 / HTTP 协议**交互（例：插件宿主路由 `/raw`（Range/206）、
`/custom-scene-audio`、`/custom-scene-video-check`）。协议本身（路由名、字段名、JSON 形状）
不受版权保护，可以自由对齐——但**实现**必须各写各的。

3.3 跨仓测试也不得"切片执行"对方文件：插件测试**不得**读取 / `new Function()` 执行渲染器的
`demo.html` 区块当基准（旧的 `tools/audio-scan-test.mjs` 就是这么做的，已在 P-89 删除 ~40 行）。
需要基准时：**写规格 → 按规格字面量在插件测试内自建期望值**。

3.4 插件仓库**不得**对渲染器仓库产生硬路径依赖（`../we-scene-demo/**`）；反之亦然（渲染器
可以 import 插件的发布产物，但不应依赖插件的开发机路径）。

---

## 4. 借鉴台账（每引入一处第三方代码必须登记）

格式（一行一条，必须六列齐全）：

| # | 来源仓库 | 文件（上游路径） | commit / tag | SPDX | 引入日期 | 谁引入 | 进哪个仓库 | 处置 |
|---|---|---|---|---|---|---|---|---|
| 1 | `elysia395/dsh-wallpaper-engine` | `lib/we-renderer/**`、`lib/*.js` 四个函数 | PR #47（merged 2026-08-25） | MIT | 2026-08 | 渲染器作者 YV3507 | we-scene-demo | 已署名（`THIRD-PARTY.md` §1 + `elysia/LICENSE`） |
| 2 | `@shaderfrog/glsl-parser` 7.0.1 | 整包（vendored） | 7.0.1 | ISC | 2026-08 | 同上 | we-scene-demo | 已补 `elysia/vendor/@shaderfrog/glsl-parser/LICENSE` |
| 3 | 字体 7 个文件（Blackout/monofur/Noto/RobotoMono/Segment7/Twemoji） | `assets/fonts/**` | 见 `THIRD-PARTY.md` §4.1 逐文件 URL+sha256 | OFL-1.1 / Apache-2.0 / CC-BY-4.0 | 2026-09-15 | 渲染器侧（P-86） | we-scene-demo | 已逐文件署名 + 许可全文随仓 |
| 4 | 渲染器 `demo.html` `MPW-AUDIO-PANEL` 区块（P-57，2026-09-14，当时渲染器为 MIT） | 音轨判定/收集（约 210 行同源改写） | 未提交工作区（插件侧从未提交） | MIT（当时） | 2026-09-15 | 插件侧 | **曾被改写进插件（违反 §2.4 方向）** | **2026-09-16 按规格独立实现替换**（当时写作"洁净室重写"）（`docs/AUDIO-TRACK-SPEC.md`；见 `dsh-mpkg-wallpaper/THIRD-PARTY.md` §1） |
| 5 | `oneincase/webwallgl` | 仅研读对照（`vendor-ref/webwallgl` 在仓库外） | — | MIT | 2026-09 | — | 未分发 | 未 vendored；若引入需升级为正式条目 |
| 6 | `oneincase/webwallgl` | `renderer/vendor/we-scene/render/renderer-glsl.js` 的 `FXAA_FRAG`（上游 452–489 行） | `fdfc578a577d0e680a9cfe2cf2e3e825d3cd2372`（1.3.23，2026-09-15） | MIT | 2026-09-16 | 渲染器侧（P-90） | we-scene-demo | **已署名**：`THIRD-PARTY.md` §6 升级为完整条目（含 MIT 全文 + 逐文件表 + 字节级核对结论「38/38 行 GLSL 无差异」）→ 落点是 `we-scene-bundle.js` 的 `FXAA_FS` 常量。**仅此一个 shader**；`quality.ts` **未**复制（只对齐档位语义，实现自写） |
| 7 | `oneincase/webwallgl` | `renderer/src/web-shim.js`、`renderer/src/web.ts`、`renderer/src/web-rewrite.ts`（**仅研读 API 名单与语义**） | `b61e8910ae0a176288aed99ce9a93a13ea07df57` | MIT | 2026-09-16 | 插件侧（缺口 I 项：web 类壁纸） | **dsh-mpkg-wallpaper（MIT）** | **仅参考、未复制代码**（无 vendored 文件、无逐行翻译）：`lib/web-wallpaper.js` 的 WE API 名单与语义按该项目对照，实现（属性时序、URL 改写、postMessage 控制协议、错误边界）为本仓库自写；差异清单 `dsh-mpkg-wallpaper/docs/WEB-WALLPAPER.md` §10，机器断言 `tools/web-wallpaper-test.mjs` D4/D5（含"参考未 vendored"与 API 名单一致性） |
| 8 | `oneincase/webwallgl` | `renderer/vendor/we-scene/render/hlsl2glsl.js`（blob `179b6f8192f50ec709ae5f9923d240245f30cef7…`）、`renderer/vendor/we-scene/render/hlsl-preprocessor.js`（blob `dd9dba1d…`） | `fdfc578a577d0e680a9cfe2cf2e3e825d3cd2372`（1.3.23，2026-09-15） | MIT | 2026-09-16 | 渲染器侧（P-93） | we-scene-demo | **已署名**：`THIRD-PARTY.md` §9（含 MIT 全文 + 逐文件 blob/sha256 表 + "哪些**没有** vendored"边界表）；落点 `vendor/hlsl2glsl/`（**逐字节**副本，`git diff origin/main -- <两路径>` 为空，含上游 `LICENSE`）。用途 = 覆盖率门禁 `hlsl2glsl-coverage-test.mjs`（把 98.2% 变成会变红的断言）；**渲染器着色器路径尚未接线** |
| 9 | `oneincase/webwallgl` | `renderer/src/web.ts` 的 `webPointerToClient`（366–383）、`webCoverViewport`（577–593）、`measureWebLetterbox`/`WEB_ASPECT_*`（561–635）（**仅对齐行为契约**：u/v → 帧内 client 像素、覆盖式视口取内容比例并居中裁切、内容比例只认内在尺寸） | `b61e8910ae0a176288aed99ce9a93a13ea07df57`（1.3.16，2026-09-15） | MIT | 2026-09-16 | 渲染器侧（P-102） | we-scene-demo | **规格先行**：`docs/WEB-FRAME-GEOMETRY-SPEC.md`（只写公开契约与算法事实）→ 按规格新写 `core/web-frame-geometry.mjs`（命名/参数形态/三态适配/常量组织/回退开关均不同，差异清单见规格 §6）与 `tests/web-frame-geometry-test.mjs`（T4e 机器断言本行存在）。**未复制代码**（无 vendored、无逐行翻译）；回退开关 `?frame=legacy`（登记在 `docs/README-DIAGNOSTICS.md` 主表）；署名与 MIT 全文见 `THIRD-PARTY.md` §11 |
| 10 | `oneincase/webwallgl` | `renderer/src/web.ts` 的 `packWebAudioArray`/`packWebAudioArrayInto`（63–87）、`shapeWebAudioBand`/`WEB_SIM_AUDIO_GAIN`/`WEB_SIM_AUDIO_GAMMA`（106–134）、注入源 driver 分支（168–228）（**仅对齐行为契约**：128 元频段数组=左 0..63+右 64..127、0..1 钳位、γ 对比扩展曲线、"频谱要尖"的观感） | `b61e8910ae0a176288aed99ce9a93a13ea07df57`（1.3.16，2026-09-15） | MIT | 2026-09-16 | 渲染器侧（P-103） | we-scene-demo | **规格先行**：`docs/AUDIO-BAND-SPEC.md`（只写公开契约）→ 按规格新写 `core/audio-band-array.mjs`（命名/打包形态/常量覆盖方式/真实源口径/模拟源状态模型/新增诊断均不同，差异清单见规格 §5）与 `tests/audio-band-array-test.mjs`（T4b 机器断言本行存在）。**未复制代码**；纯函数模拟源（无内部状态、无 dt）与 `bandStats` 诊断为本实现独有；**尚未接线**（渲染器目前没有实时频谱源，见规格 §6）；署名与 MIT 全文见 `THIRD-PARTY.md` §12 |

> **①(P-111 2026-09-17) 本表 #9/#10 曾在本轮文档整理里被整行删掉**（`THIRD-PARTY.md` §11/§12、
> `docs/WEB-FRAME-GEOMETRY-SPEC.md`、`docs/AUDIO-BAND-SPEC.md`、`docs/PATCHES.md:6088/6356` 五处指针随即悬空，
> `web-frame-geometry` / `audio-band-array` 两测试的 T4e/T4b 变红）。**两处上游都是 MIT、不是 §9 阶梯对象**
> （§9 的适用范围 = 无许可 / 许可不兼容）⇒ 仍应登记在本台账；现按 §5.1 口径（"按规格独立实现"）补回。

| 11 | `lucide-icons/lucide` v0.545.0 | `icons/*.svg` 的 path 数据（folder/file/house/arrow-up/search/check/x，**内联进 `demo/bench-patch.js` 的 SVG 工厂**，非引入图标包） | v0.545.0 | ISC（部分 path 源自 Feather，MIT） | 2026-09-16 | 测试台补丁（用户第 8 批） | we-scene-demo（`demo/` 产物随页分发） | 已署名（`THIRD-PARTY.md` Lucide 条目 + `demo/LICENSE-lucide-ISC.txt` 随页分发；零外部依赖，不走 CDN） |

| 12 | `oneincase/webwallgl` | `renderer/vendor/we-scene/render/pointer.js:1-320`（**整文件逐字节**）、`renderer/vendor/we-scene/render/particles.js` 的 `:663-672`/`:686-697`/`:830-851`/`:1010-1024`/`:1154-1163`、`renderer/src/scene-mount.ts` 的 `:655-676`/`:1670-1676`（**照抄**，非按规格重写） | `b61e8910ae0a176288aed99ce9a93a13ea07df57`（`pointer.js` blob `c3ddfe91372c7006123ed6f374443625516bc322` 在 `fdfc578` 上相同；`particles.js`/`scene-mount.ts` 两版本不同 ⇒ 行号以 `b61e891` 为准） | MIT | 2026-09-20 | 渲染器侧（P-136，**用户直接指示**："你直接把 oneincase 跟鼠标尾迹有关的代码，你看看直接复制过来就算了"） | we-scene-demo | **已署名**：`THIRD-PARTY.md` §14（含"这份代码是照抄而非独立实现"的显式声明、逐 `file:line` 落点表、逐行「照抄/适配」对照表 A-1/B-1/B-2/C-1/D-1/E-1、改前/改后数字表）；落点 `core/we-pointer-source.mjs`（新，整文件逐字节）、`core/we-particle-pointer.mjs`（新）、`core/we-scene-bundle.js`（接线）。**纪律变更**：本节是继 §6（FXAA shader）/§9（HLSL→GLSL 翻译器）之后的**第三处逐字例外**，且首次由"只引行为结论"改为"允许复制" —— 变更依据与边界见 §14.1/§14.2；`packages/we-core/` **未**放入任何上游代码。门禁 `tests/pointer-trail-copy-test.mjs`（44 断言，含 RED-IF-REVERTED） |
| 13 | `oneincase/webwallgl` | `renderer/vendor/we-scene/render/particles.js` 的 `:698-707`（`attachFollow`）、`:709-713`（`leaderParticle`）、`:724-743`（`_syncFollow`）（**照抄**，非按规格重写）；外加 `renderer/src/scene-mount.ts:1449-1559`（`buildParticleSystem` 递归建子系）的**结构/语义移植**（深度守卫 `depth > 3`、`followMode` 判定、子系图层变换合成、`instanceoverride` 继承 —— **未复制代码**） | `b61e8910ae0a176288aed99ce9a93a13ea07df57`（与 #12 同一 commit；行号已在该 checkout 上逐条回读核对） | MIT | 2026-09-19 | 渲染器侧（P-144 粒子批次 B：粒子 `children` 子系/拖尾全家族，**用户"照上游实现接上"的指示延续 #12 的纪律变更**） | we-scene-demo | **已署名**：`THIRD-PARTY.md` §15（含"这三块是照抄、接线层只移植语义"的显式声明、逐 `file:line` 落点表、逐行「照抄/适配」对照表 G-1/H-1/I-1/I-2/I-3、§15.4 语义移植表、§15.5 改前/改后数字表）；落点 `core/we-particle-pointer.mjs` 的块 **G/H/I**（`attachFollow`/`leaderParticle`/`syncFollow`，函数头逐个标注上游出处行号）+ `core/we-scene-bundle.js`（接线：`renderParticleChildren`/`prepareParticleChildSys`，均为自写）。本仓库自写的 `syncFollowOrigin`（适配层，注释明写"不是照抄"）**不在**本条内；`packages/we-core/` **未**放入任何上游代码。门禁 `tests/particle-children-test.mjs`（61 断言，含 6 组 RED-IF-REVERTED 与 ⑧-a/⑧-b 本条台账的机器断言） |
| 14 | `oneincase/webwallgl` | `renderer/vendor/we-scene/render/particles.js` 的 `:590-592`（`overbright` 取值契约，4 行）与 `:1300`（消费点 `bright = (this._ov.brightness \|\| 1) * (this.overbright ?? 1)`）、`:1341-1344`（`(a.r+b.r)*0.5*bright` 三通道、alpha 不乘）（**仅对齐行为契约**，按规格独立实现） | `19c5fab`（上游 1.3.x 的 overbright 修复提交；行号已在该 checkout 上逐条回读核对） | MIT | 2026-09-19 | 渲染器侧（P-149 派单 A：粒子材质 `ui_editor_properties_overbright`，方案 `docs/UPSTREAM-PORT-PLAN-20260919.md` §1） | we-scene-demo | **按规格独立实现**：`docs/UPSTREAM-PORT-PLAN-20260919.md` §1.1 只写公开契约 → 契约唯一实现在 `core/we-scene-bundle.js::particleOverbrightFactor`（纯函数、可直测；上游写在实例构造里，命名/参数形态/兜底顺序/回退开关均不同），消费点在粒子色段乘三通道（两条上屏路径同一因子），宿主 `demo.html` 两处接线（父层 + 子系 map 条目）。**未复制代码**（无 vendored、无逐行翻译）；回退开关 `?overbright=legacy`（登记在 `docs/README-DIAGNOSTICS.md` 主表）；署名与逐行引文表见 `THIRD-PARTY.md` §16；门禁 `tests/particle-overbright-test.mjs`（91 断言 = 功能 80 + 变异自证 11；5 组 RED-IF-REVERTED，⑦-f/⑧-a…⑧-g 机器断言本行与 §16 在位） |
| 15 | `oneincase/webwallgl` | `renderer/src/web-shim.js`（**本仓产物里已有的那份 shim 常量**：`demo/assets/renderer-BOSoB05I.js` 内的模板字符串，44 811 B） | —（不引上游新版本；用的是**本仓已分发的**产物） | MIT | 2026-09-19 | 渲染器侧（P-160） | we-scene-demo | **未新增第三方代码、未 vendored、未逐行翻译**：本批**没有**照抄插件仓 `dsh-mpkg-wallpaper/lib/web-wallpaper.js`（P-144/P-149 那种「照抄 + 登记」路线**不适用**），而是运行时从本仓 `demo/assets/renderer-*.js` 里**读出**渲染器自带的 shim 常量（纯函数 `shimFromRendererSource`，只做转义还原与契约校验）注入到同源 web 入口 ⇒ 与渲染器「跨源路径」逐字等价。上游署名与 MIT 全文沿用既有条目（`THIRD-PARTY.md` §1 及 `demo/LICENSE-webwallgl-MIT.txt` / `demo/LICENSE-webwallgl`）。机器断言 `tests/bench-shell-fixes-test.mjs` E2a–E2e + C8–C11（含「取的是本仓产物那份 / 契约齐全 / 幂等 / 非 HTML 拒绝」） |
| 16 | `wangkaxds/we-scene`（经 `oneincase/webwallgl` 的 vendored 子树取用） | `renderer/vendor/we-scene/**`（`render/**`、`pkg/**`、`scene/**`、`headers.ts`） | vendored 子树内 `LICENSE`（1085 B，与上游 `wangkaxds/we-scene/LICENSE` 逐字节相同） | **MIT** © 2026 aurora-wallpaper contributors | 2026-09（P-90 那条 FXAA/转译器血缘一并覆盖） | 渲染器线（继承 P-90 取用路径） | we-scene-demo（`core/we-scene-bundle.js` 内含其逐字块 512–2048+ 字符） | **已补署名**：`THIRD-PARTY.md` §6C（事实链 + MIT 全文）；旧 webwallgl 行不改（我们确实经它取用） |
| 17 | `oneincase/webwallgl` | `renderer/vendor/we-scene/render/renderer.js` 的**效果 pass 纹理绑定循环**新增 17 行（上游 PR #6：`ti >= 1 && !entry.fbo && entry.glTex && entry.samplerWrapRepeat !== true` ⇒ 置 `TEXTURE_WRAP_S/T = REPEAT`；本仓落到 `core/we-scene-bundle.js` 的 `fxSlotWrap()`/`texWrapForced()` + 绑定循环一处调用） | PR #6 head `5c5a6aa5e7`（merged 2026-09-23，作者 **yuxilao**） | MIT | 2026-09-24 | 渲染器侧（P-194） | we-scene-demo | 已署名：本次改动**逐行对照上游 diff 写成同形实现**并在 P-194/README-DIAGNOSTICS 注明来源与 PR；**未 vendored 上游文件**，只借用该 17 行的判定口径与 `samplerWrapRepeat` 字段名（便于对拍） |
| 18 | `oneincase/webwallgl` | `renderer/vendor/we-scene/render/animation.js`（`:96-175` `sampleChannel` / `:177-193` `wrapFrame` / `:212-247` `crossedEvents` / `:260-276` `linkAnimations` / `:282-440` `createAnimation`）——**依赖无关移植**（函数分解、播放头语义、手柄公式按上游；非逐字：`this.` → 闭包，`def.relative` 的读取位置按语料实测改正）；外加 `renderer/vendor/we-scene/render/renderer.js:1100-1125`（「播放中才 advance、求值每帧照做」）与 `renderer/src/scene-mount.ts:3090-3140`（层载体写回 + `visible` 阶跃）的**结构/语义移植**（**未复制代码**） | `b61e8910ae0a176288aed99ce9a93a13ea07df57`（与 #12/#13 同一 commit；行号已在该 checkout 上逐条 `grep -n` 回读核对） | MIT | 2026-10-05 | 渲染器侧（P-228l 图层属性动画语义批次） | we-scene-demo | **已署名**：`THIRD-PARTY.md` §17（含「依赖无关移植」声明、逐函数对照表、四处适配差异、未移植边界表）；落点 `core/we-animation.mjs`（唯一实现处，纯函数、无 DOM/GL）+ `core/we-scene-bundle.js` 接线（`ANIM_MODE_RUNTIME`/`applyLayerAnims`/`advanceSceneAnimations`/`sceneAnimDiag`）+ `demo.html` 帧循环 + `elysia/scene-scripts.js::setAnimationResolver`（本仓自写）；回退开关 `?anim=legacy`（登记在 `docs/README-DIAGNOSTICS.md` 主表）；门禁 `tests/anim-semantics-test.mjs`（72 断言，含 3 组变异自证） |

新增条目要求：**commit/tag 必填**（拿不到就写"未提交/工作区"并说明）、**SPDX 必填**、
**日期与引入人必填**；进渲染器的 GPL-3.0 条目还要在 `THIRD-PARTY.md` 附许可全文与文件清单。

---

## 5. 按规格独立实现（spec-first independent re-implementation）流程

当某段代码被判定同源而必须保住 MIT 侧时，按以下顺序做（P-89 的实际做法）：

1. 写**规格文档**：只写公开格式事实与该模块的对外契约（输入/输出/不变量/边界），
   放进 MIT 仓库（例 `dsh-mpkg-wallpaper/docs/AUDIO-TRACK-SPEC.md`）。
2. **只依据规格**重新实现；旧段直接删除（不保留"注释掉的老代码"）。
3. 实现必须与原版在这些维度上**可证明不同**：① 命名 ② 分支/判定顺序 ③ 常量组织方式
   ④ 错误文案与注释 ⑤ 边界处理。差异清单记入 `THIRD-PARTY.md`。
4. 测试**不得**依赖对方仓库；改为对规格表格的独立断言 + 自造夹具（覆盖判定表、收集去重、
   边界：无/多音轨、同名不同目录、损坏头）。
5. 行为差异必须写明（例：`0xFFF1` ADTS 由 `audio/mpeg` 修正为 `audio/aac`）。

### 5.1 术语口径（2026-09-17 按律师意见定案 —— **不再自称洁净室**）

> **规则**：本项目**主张的是"独立实现（independent implementation）"，不是"洁净室重写（clean-room rewrite）"。**
> 理由：洁净室的法律基础是"**实现者未接触原件**"；本项目中相关实现者在重写时**确实接触过原件**
> （读了源码 / 上游引用 / 比对过二进制），**不满足**洁净室要件。继续自称洁净室会被直接攻击，
> 因此**主动改口径**，并把此前文档/注释里"已洁净室重写"的表述**一律更正**。

| 情形 | 允许的写法 | **禁止**的写法 |
|---|---|---|
| **我们**对已接触过的原件做重写（本项目至今的全部样本：P-95、P-100-R1、6 个 `common*.h`） | "**按规格独立实现**" / "**独立实现**"；加上一句"**实现者接触过原件，不主张洁净室**" | "洁净室重写" / "clean-room rewrite" |
| **我们**对**从未接触**的原件按公开契约实现（理论上可以真洁净室） | 可以写"洁净室"；**但必须能证明"未接触"**（留痕：谁写的、见过什么、规格从哪来） | 只凭"我们觉得没抄"就说洁净室 |
| **第三方项目**在未接触我方代码的前提下写出等价物（§9 L5/L4 语境，指**对方**） | "该项目是洁净室产物" | 拿来形容我们自己 |
| **流程名**（§9 的 L1） | 保留 `L1`，动作名写作"**按规格独立实现**"；括号里可注"历史写法：洁净室重写" | 在**结果描述**里写洁净室 |

**留痕要求（与 §9.7 同格式，缺一列视为未留痕）**：任何一次 L1 动作，除 §9.7 的字段外，**必须再写两列**：

| 追加字段 | 内容 |
|---|---|
| **实现者是否接触过原件** | `是 / 否` + **接触方式**（读了哪个文件/哪些引用/比对过哪个二进制）＋**接触发生在规格书面化之前还是之后** |
| **本文的主张** | "独立实现（不主张洁净室）"或"洁净室（附未接触证明）"；**含不确定项时显式写"待律师确认"** |

**当前项目的逐项事实声明**：`we-scene-demo/docs/REIMPLEMENTATION-STATEMENTS.md`（四类对象：`effects.js` 那节 /
`normalizeImageAlpha` / `imageAlignmentOffset` / `common*.h`；逐项写"是否阅读过原件 = 是"、重写依据、谁写谁复核、待律师确认项）。
**该文件是本规则的落地样本，也是自查清单**：新增任何"重写"动作时，同一批必须在该文件追加一节。

> **本节是"怎么重写"；"遇到无许可 / 许可不兼容的上游该按什么顺序处置"见 §9 的 L1–L5 阶梯。**
> 本节 = 阶梯的 **L1** 的具体做法。

---

## 6. `tools/*.py` 删除记录（P-89，2026-09-16）

`dsh-mpkg-wallpaper/tools/` 下 4 个 Python 工具**已删除**，原因是**无法排除与 GPL 项目存在代码级血缘**
（`unmpkg.py` 自述 "format from aqnya/unmpkg"（GPL-3.0）；`tex2png.py` 自述参考 `notscuffed/repkg`
（**当时误记为 GPL；2026-09-17 核实为 MIT**，见下））：

| 删除的文件 | 行数 | md5（删前） | 删除理由 |
|---|---|---|---|
| `tools/unmpkg.py` | 38 | `ed665b75bfd6…` | 自述格式来源 `aqnya/unmpkg`（GPL-3.0），无法排除代码级血缘 |
| `tools/tex2png.py` | 267 | `ac85955599c3…` | 自述参考 `notscuffed/repkg`（**2026-09-17 定案 = MIT**，非 GPL；删除理由随之改为"与 `unmpkg.py` 同批研究脚本，同一标准处理"，见 §9.10） |
| `tools/mdl_explorer.py` | 75 | `418db8e95573…` | 与上两者同一批研究脚本，同一标准处理（无法自证血缘） |
| `tools/xref.py` | 94 | `b4fffcf46ef1…` | 依赖 capstone 反汇编 wallpaper64.exe，研究脚本，同一标准处理 |

**分发口径**：`package.json` 的 `files` 白名单不含 `tools/`，所以它们**不进 npm 包**；
但本仓库是**公开 git 仓库**，`tools/` 仍随仓库分发 ⇒ 按"分发"处理，血缘存疑即删除。
**未删**：`tools/check.sh`（8 步门禁）与 `tools/*.mjs`（测试/基准）——它们是插件质量门禁的基础，
且都是本仓库自写、无外部血缘。

---

## 7. CLA（贡献者许可协议）说明

7.1 现状：**未引入 CLA**。两仓库按各自 `LICENSE` 接收贡献（插件 MIT；渲染器 GPL-3.0-or-later）——
以 GPL/MIT 接收的贡献**不能**直接用于闭源授权。

7.2 若将来要对插件做**闭源商业授权**（双许可），需要：
- 引入 **CLA**（贡献者把版权许可授予维护者，允许在其它许可下再分发），并在 `CONTRIBUTING` 中显著提示；
- 逐个追溯**已合并**贡献者的同意（GitHub 提交历史 + 联系方式）；
- CLA 只对**签署之后**的贡献生效，历史贡献仍需单独取得授权。

7.3 在此之前，任何"把插件闭源/换许可"的动作都**不得**进行（`LICENSE` 保持 MIT）。

7.4 **CLA 决定点（2026-09-17 记录）**：**暂不引入 CLA**，但**保留"首个外部 PR 时启用"的决定点** ——
理由：CLA 是**将来做双许可 / 商业授权**（把 MIT 插件同时按闭源商业条款授权）的**前置条件**，
而它的成本（贡献者要签署、历史贡献要逐个追溯）**只在真有外部贡献时才划算**。因此：
① 仓库现在**不建** CLA 机器人、不在 `CONTRIBUTING` 里要求签署；
② **触发点** = 收到**第一个外部贡献者的 PR** 时，先决定"是否启用 CLA"，**再合并**（合并后再补签，历史贡献就要逐个追溯，成本高得多）；
③ 决定与理由**写进本节**（追加一行日期 + 结论），并在 `we-scene-demo/docs/COMPLIANCE-REVIEW.md` 的流程项里同步；
④ 在此之前，按 §7.1–§7.3 的口径接收贡献（GPL/MIT 各自 `LICENSE`），**不得**对外宣称"可商业授权"。

---

## 8. 发布前自检（机器闸门）

- 渲染器：`node we-scene-demo/publish-check.mjs` 必须 **0 阻塞**，其中许可一致性四条：
  ① `LICENSE` 与 `package.json.license`（若存在）一致且为 GPL-3.0-or-later；
  ② 发布物不含插件的 GPL 违规内容（插件包里不得出现 GPL 文本）；
  ③ `COPYING-RULES.md` 与 `THIRD-PARTY.md` 在位；
  ④ vendored `webwallgl` 的 MIT 声明与字体许可文件在位（未 vendored 时按"不适用"记录）。
- 插件：`cd dsh-mpkg-wallpaper && bash tools/check.sh` 必须 8 步全绿；`LICENSE` 仍为 MIT。
- 任何"借来的"代码：先在本文件 §4 台账登记，再合入。

> **参照来源许可声明**：本文档引用的 `wer-ref/` 是**第三方参考实现**
> （`Aromatic05/wallpaper-engine-renderer`，为 `catsout/wallpaper-scene-renderer` 的 fork，
> **GPL-2.0-only**），**不是 Wallpaper Engine 官方代码，也不是"真值源"**。
> 与本项目渲染器（GPL-3.0-or-later）**许可不兼容**：仅用于**行为对照**，
> **不得复制、改写、逐行翻译其代码、注释、常量组织或错误文案**。
> `we-layerd-ref/`（`Aromatic05/we-layerd`）**无任何许可**（保留所有权利），同样只可读行为结论。
> 血缘自查结论见 `docs/WER-REF-LICENSE-AUDIT.md`。

---

> **路径口径（根副本特有）**：本节沿用本仓库既有约定 —— 指**渲染器侧**文件时写裸名或仓内路径
> （`THIRD-PARTY.md`、`docs/IMAGE-ALPHA-ALIGN-SPEC.md`、`tests/…`、`core/…`），均指 `we-scene-demo/` 内；
> 指本目录（工作区根 `docs/`）时写同目录裸名（`LICENSE-COMPAT-REVIEW.md`、`WER-REF-LICENSE-AUDIT.md`）。

## 9. 无许可 / 许可不兼容依赖的处置阶梯（L1–L5，2026-09-17 用户拍板落地）

> **适用范围**：任何**无许可**（无 `LICENSE`/`COPYING`、上游 `/license` = 404、元数据无 `license` 字段
> ⇒ 默认**保留所有权利**）或**许可不兼容**（与本仓库许可双向不兼容，典型 = GPL-2.0-only ↔ GPL-3.0-or-later）的上游。
> **执行原则**：**逐级向下走，能停就停**（L1 能解决就绝不到 L2 ……）；**每级都要留痕**（§9.7）；**绝不"先抄后议"**。
> **与 §2.3 的关系**：§2.3 是"能不能借"的一览表，本节是"借不到时怎么办"的**可执行阶梯**。
> **用户原话（2026-09-17）**：「对于无 license 的仓库，那就直接**洁净室重写**，或者查看他的 **Cargo**，
> 然后再去**自写插件**；实在不行看看能不能**增量重写**，或者查看有没有**类似的开源项目、但是有协议的**
> （即使方向不大相同，但有类似的相同点）。对于**不兼容的 License**，也执行上述同样的操作。
> 如果上面几个方法都无法实现，那就**先把代码写进去，但是单独分成一块**，要保证**可用性**，
> 也要保证**随时可以删除**（不是说别人一发现就偷偷删除，而是作者联系我时，我可以主动去删除）。
> 后续再碰到类似问题，就按上面的处理方法同样处理。」
>
> **口径注（2026-09-17）**：用户原话里的"洁净室重写"是当时的说法。按律师意见，本项目**不再自称洁净室**
> （洁净室要求"实现者未接触原件"，我们做不到也不应声称）⇒ 阶梯 **L1 的动作名与结论描述一律写作"按规格独立实现"**，
> 详见 **§5.1**。**用户原话逐字保留，不改写**。

### 9.1 阶梯总览

| 级 | 名称 | 一句话 | 适用条件（什么时候用这一级） | 停止条件 |
|---|---|---|---|---|
| **L1** | **按规格独立实现**（历史写法"洁净室重写"，见 §5.1） | 规格先行，只依规格实现 | 我们知道**要什么行为**，且该行为可用公开格式/契约完整描述 | 规格写得出来 ⇒ 停在这一级，**不再往下** |
| **L2** | **查上游来源** | 先读元数据，找真正的上游许可 | **任何**"无许可/不明"判定**之前**强制执行 | 找到 permissive 上游 ⇒ 按 §4 台账借用；只有更严 ⇒ 转 L1/L3 |
| **L3** | **自写等价实现**（含**增量重写**） | 不借代码，自己写等价物；大改造时逐模块替换 | L1 规格写不出（黑盒行为太多）、L2 无可用许可 | 只借"行为事实"，不借"表达" |
| **L4** | **换许可兼容的类似项目** | 找同/近方向但许可兼容的项目 | L1–L3 成本过高，或存在现成同类 | 许可必须在白名单；**禁 GPL-2.0-only 与无许可** |
| **L5** | **隔离块**（最后手段） | 写进去，但**单独成块 + 可一键禁用 + 可整体删除** | L1–L4 全部不可行，**且该功能对可用性必需** | 必须同时满足 §9.6 六条硬要求 |

### 9.2 L1 按规格独立实现（历史写法"洁净室重写"）

**适用条件**：行为可用**公开事实**（格式规范、协议契约、输入/输出表、边界条件）完整描述；
不读对方实现也能写出规格。

**做法**：§5 的五步（规格文档 → 只依规格实现 → 五维可证明不同 → 测试不依赖对方仓库 → 写明行为差异）；
旧段**直接删除**，不留"注释掉的老代码"。

**记录要求**：规格文件路径、旧实现删除范围（file:line + 行数）、五维差异清单、符合性测试与断言数、`PATCHES.md` 编号。

**验收**：① 规格文档在**目标仓库内**且不含对方代码摘录；② 符合性测试全绿（能"与改前逐位对拍"时优先对拍）；
③ 全仓 `grep` 对方目录名在**代码路径**上 0 命中；④ §4 台账有对应行。

**本仓库先例**：P-89（插件侧音轨段）、**P-95**（`normalizeImageAlpha` / `alignmentOffsetForToken`，
规格 `docs/IMAGE-ALPHA-ALIGN-SPEC.md`，1008 断言含逐位对拍）、**P-100-R1**（CPU 效果链 4 处自认 + 12 处引注）。

### 9.3 L2 查上游来源（**先查，再判**）

**适用条件**：任何"无许可 / 许可不明"判定**之前**强制执行。**只看仓库根有没有 `LICENSE` 不算查过**——
用户原话点名"查看他的 **Cargo**"，本仓库把这条推广到**所有生态的元数据 + 打包元数据**。

**做法**：按顺序读**元数据**（这些是**作者自己写的许可声明**，证据力强于我们的推断）：

| 生态 | 必读字段 / 文件 | 备注 |
|---|---|---|
| Rust | `Cargo.toml` 的 `license` / `license-file` / `repository` / `homepage`；**workspace 全部成员的 `Cargo.toml`**（`[workspace] members` 要逐个展开）；`Cargo.lock` 的依赖树 | `license-file` 常指向非根目录；成员 crate 可能各自声明 |
| Node | `package.json` 的 `license` / `licenses` / `repository` / `private`；`node_modules/*/LICENSE` | 上游可能只在自己的 fork/发布包里写过 |
| Go | `go.mod`（+ `vendor/modules.txt`）；`pkg.go.dev` 的 license 字段 | |
| Python | `pyproject.toml` / `setup.py` 的 `license` 与 `classifiers`；`PKG-INFO` | |
| **打包元数据**（最易被忽略、却最权威） | **Arch `PKGBUILD` 的 `license=()`**；**Fedora/RPM `.spec` 的 `License:`**；Debian `debian/copyright`；Flatpak/AppImage/Nix 清单 | 上游**自己的发行者**写下 `unlicensed` = **作者自认无许可**，是直接证据 |
| 托管平台 | GitHub/GitLab API 的 `license` 字段与 `/license` 端点、`git log --format=%B` 里的 "add LICENSE" 提交 | API 只是**检测**，不是法律声明；与元数据冲突时**以元数据为准** |
| 子模块 / 捆绑 | `.gitmodules`、`git submodule status`、`vendor/`、`third_party/`、`subprojects/` | **上游可能把许可更严的代码作为子模块捆进来**（见 §9.8 的实物样本） |

**记录要求**：逐字段**原文**（带 `file:line`）+ 抓取日期 + 上游 commit/tag + 结论（SPDX 或 `NONE`）。
**没读到某个字段，不得声称"该字段不存在"**——要写"已查 X / Y / Z，均为空"。

**验收**：判定表每行都有「查了哪些元数据 / 原文 / 日期 / commit」四要素。

### 9.4 L3 自写等价实现（含**增量重写**）

**适用条件**：L1 规格写不出来（行为是黑盒，规格本身要读对方实现才能得到），L2 也没给出可用许可。

**做法**：
- **不要"借"，要"另写"**：可以把它当**可执行黑盒**（跑起来看输入/输出），**不得**把它的代码当参考稿；
- **增量重写**（用户点名的形态）：**逐模块替换**而不是一次性重写大文件 —— 每次只换一个模块/函数，
  换完立刻跑该模块的门禁；**不允许**新旧实现长期并存（禁 `if (useNew) … else 旧实现` 这种常驻分支）；
- 每一次增量都要有**独立可验证的等价性证据**（对拍用例、语料重放、逐位比较）；
- **行为差异必须写明**（例：`0xFFF1` ADTS 由 `audio/mpeg` 修正为 `audio/aac`）。

**记录要求**：每次增量的范围（旧 file:line → 新 file:line）、等价性证据（命令 + 结果）、行为差异清单、
"旧实现已删除"的 grep 证据。

**验收**：① 门禁全绿；② 旧实现的函数名/常量在**代码路径** 0 命中（注释里的历史说明可留 1 处并标注"已删除"）；
③ 差异清单进规格文档或 `THIRD-PARTY.md`。

### 9.5 L4 找许可兼容的类似项目

**适用条件**：L1–L3 成本过高且存在同/近方向项目。**"方向不大相同但有相同点"也算**（用户原话）。

**做法**：在 §2.3 的"✅ 可借"集合里找**同一问题的最接近解**（哪怕它解决的是另一个渲染器 / 另一个平台的同一子问题）；
借用按 §2.1 + §4 台账走（保留原始声明 + 登记六列 + 在 `THIRD-PARTY.md` 附许可全文与文件清单）。

- **许可白名单**：MIT、ISC、Apache-2.0、BSD-2/3-Clause、CC0-1.0、OFL-1.1、Unlicense、Zlib、MIT-0。
- **许可黑名单**：**GPL-2.0-only**（与 GPL-3.0-or-later 双向不兼容）、**无许可**（比 GPL 更严）、
  任何与 GPL-3.0 组合不兼容的 `-only` copyleft；`AGPL` 进 MIT 侧同样禁止。

**记录要求**：新上游 commit/tag + SPDX + 引入日期 + 引入人（§4 六列）+ **"为什么它和原目标等价"**的一段说明
（方向不同也要写清相同点）。

**验收**：§4 台账新行 + `THIRD-PARTY.md` 完整条目 + 门禁里新增可复现声明（如 `vendor/` 逐字节核对）。

### 9.6 L5 隔离块（最后手段 —— **写进去，但随时能整体拿掉**）

**适用条件**（四问全"是"才允许）：① L1–L4 全部试过且留下**失败理由**；② 该功能对**可用性必需**；
③ 不引入它会让功能显著不可用；④ 负责人已知情（记在 `docs/PENDING-DECISIONS.md` 对应条目）。

**六条硬要求（缺一不可）**：

| # | 要求 | 判据 |
|---|---|---|
| **L5-1** | **独立文件 / 独立目录** | 该块的全部文件落在一个**可枚举的路径集合**里（例 `blocks/<name>/**` 或单文件 `core/<name>.block.mjs`），**不得**与主线代码混写在同一文件 |
| **L5-2** | **界面或配置里一键禁用** | 有明确开关（UI 勾选 / 配置键 / URL 参数），默认值**必须**登记进 `docs/README-DIAGNOSTICS.md` 主表；**关闭时不加载该块**（不是"加载了不执行"） |
| **L5-3** | **可随时整体删除** | 删掉该路径集合后：其余功能 200 / 门禁绿；**无残留引用**（`grep` 该块标识符在其余代码 0 命中；最多允许 1 处"存在性探测"的动态加载） |
| **L5-4** | **公开说明** | 公开面 README + `THIRD-PARTY.md` §8 **各写一段**：**"此块因上游许可不明/不兼容，作者要求即删"** + 上游 URL + commit + 删除路径 |
| **L5-5** | **不偷偷删除** | 见 §9.11：删除动作必须**公开留痕**（`PATCHES.md` / `CHANGELOG` 写"删了什么、为什么、谁要求的"） |
| **L5-6** | **不扩散** | 块内代码**不得**被主线 import 后再被其它模块间接依赖（只允许单向：主线 → 块，且经由 L5-2 的开关）；**不得**把块内代码复制到别处 |

**记录要求**：路径集合清单（逐文件）、开关名与默认值、**可复制粘贴的删除步骤**、上游 URL + commit + 许可状态、
"L1–L4 为什么不行"的逐级记录、`PENDING-DECISIONS.md` 条目号。

**验收（机器断言，本仓库落地形态）**：
1. **关掉开关后该块不加载**：以关闭态启动 → 断言该块**未被读取** / 未进模块图 / 其资源请求返回 404
   （或诊断面板里该块状态 = `disabled`）；
2. **删除该目录后其余功能仍在**：临时把路径集合移出 → 跑定向子集（`docs-check` + `publish-check` + 该功能冒烟）→ 期望 rc=0 → 恢复。

**当前状态（2026-09-17）**：本仓库**没有任何 L5 块**（不存在代码采用无许可/不兼容上游）⇒ 上述两条断言**不预建**
（没有对象可断言）；**第一个 L5 块出现时，块与断言必须同批落地**（否则视为未满足 L5 验收，不得合入）。

### 9.7 留痕字段（与 §4 台账**同格式**，L1–L5 通用）

每一级动作都要在 §4 台账或对应审计文档里留下**同一组字段**（缺一列视为未留痕）：

| 字段 | 内容 | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|---|
| **来源仓库** | `org/repo` + URL | ✅ | ✅ | ✅ | ✅ | ✅ |
| **文件（上游路径）** | 逐文件列出；"零引入"也要写"未引用任何文件" | ✅ | ✅ | ✅ | ✅ | ✅ |
| **commit / tag** | 完整 40 位 sha（拿不到就写"未提交/工作区"+ 理由） | ✅ | ✅ | ✅ | ✅ | ✅ |
| **SPDX** | 判定结果；`NONE` 也必须写 `NONE`（不许留空） | ✅ | ✅ | ✅ | ✅ | ✅ |
| **日期** | `YYYY-MM-DD`（**判定日**与**引入日**分开写） | ✅ | ✅ | ✅ | ✅ | ✅ |
| **谁引入 / 谁判定** | 人或线（例"渲染器侧（P-95）"） | ✅ | ✅ | ✅ | ✅ | ✅ |
| **进哪个仓库** | `we-scene-demo` / `dsh-mpkg-wallpaper` / **未分发** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **处置** | 级号 + 一句结果（例"L1 按规格独立实现，规格 `docs/X-SPEC.md`"） | ✅ | ✅ | ✅ | ✅ | ✅ |
| **依据原文** | L2 的元数据原文摘录（`file:line` + 抓取日期）；其它级写"无许可/不兼容"的事实来源 | — | ✅ | ✅ | — | ✅ |

> **与 §4 的关系**：L1/L3 通常**不产生** §4 台账行（没有第三方代码进入）；但**必须**有本节的留痕字段，
> 落在 `PATCHES.md` 小节或审计文档里。L4 借用**必须**进 §4 台账（六列齐全）。

### 9.8 存量对象判定（一）：`we-layerd-ref/`（`Aromatic05/we-layerd`，**无许可**）

**L2 查证（2026-09-17 执行，全部可复现）**：

| 查什么 | 结果（原文 / 证据） |
|---|---|
| 根 `Cargo.toml` 的 `license` / `license-file` / `repository` | **三者均不存在**：`we-layerd-ref/Cargo.toml` 第 1–4 行是 `[package] name = "we-layerd" / version = "0.2.9" / edition = "2021"`，第 6 行直接进 `[workspace]`；全文无 `license` 字样 |
| 其余成员 crate 的 `Cargo.toml`（`xtask` / `apps/we-gui` / `crates/we-renderer-sys` / `crates/we-renderer` / `crates/we-core`） | `grep -n -E "^\s*license\|license-file\|SPDX" --include=*.toml` ⇒ **0 命中** |
| 根目录文件清单（上游 `main`，GitHub `contents/` API，2026-09-17） | `.cargo/ .github/ .gitignore .gitmodules .rustfmt.toml Cargo.lock Cargo.toml README.md apps/ build.rs clippy.toml config.example.toml contrib/ crates/ docs/ package/ screenshot/ src/ third_party/ xtask/` ⇒ **无 `LICENSE` / `COPYING` / `NOTICE`** |
| 本机副本 `LICENSE*` / `COPYING*` / `NOTICE*` | **0 个**；本机 HEAD `82f9a0695c0c1fdf01eb429fb9675750a9dde55c`（2026-09-06，"chore: start 0.2.9 development"）= 上游 `main` tip，工作树干净 |
| 托管平台 | `GET https://api.github.com/repos/Aromatic05/we-layerd` ⇒ **`"license": null`**（抓取 2026-09-17）；`/license` 端点 = 404（审计时记录） |
| **发行元数据（作者自认；本阶梯新增的取证手段）** | ① `package/archlinux/PKGBUILD:9` ⇒ **`license=('custom:unlicensed')`**；② `package/fedora/we-layerd.spec:8` ⇒ **`License: LicenseRef-Unlicensed`**，同文件第 61–62 行原文：*"The project source currently has no published license. This spec is intended for local package builds until the project adopts a distributable license."*；③ `package/README.md` 末段原文：*"The repository currently has no project license file. These definitions are therefore local test packages, not submission-ready Fedora or Ubuntu packages."* |
| **`.gitmodules` + 子模块 pin（关键发现）** | `third_party/wallpaper-engine-renderer` → `https://github.com/Aromatic05/wallpaper-engine-renderer.git`，pin **`89dfcd86de2dc0ae537bc136046c5ed05733e7b7`**（`git submodule status`）——**正是本工作区 `wer-ref/` 的 HEAD** ⇒ 它的**渲染核心是捆进来的 GPL-2.0-only 第三方**（`wer-ref/LICENSE` = GNU GPL v2 全文，18,092 B；PKGBUILD 还会安装 `libwallpaper-engine-renderer.so`），**不是它自己的代码** |

**判定 = L2 已执行完毕 ⇒ 当前无需 L1/L3/L4/L5**：我们对它**零代码引入**——
既没有"抄来的段"需要按规格独立实现，也没有"缺失功能"需要自写；唯一用途是一次**行为事实**旁证（"该特性在那里是零实现"）。
**动作 = 保持零引入（行为事实级对照）**，不产生任何代码改动。

- **将来若要它的某个具体实现**：先 **L1**（其 `README.md` 与 `docs/*.md` 是自有文档，公开行为描述足以写规格）；
  **L4 现成候选** = `linux-wallpaperengine`（**GPL-3.0-only**，与本仓库 GPL-3.0-or-later **兼容**；同为 Linux 原生 WE 运行时）
  与 `waywallen/waywallen`（**MIT**，架构先例）；两者都不行**且**功能对可用性必需时才考虑 **L5**。
- **明确禁止**：不得把 `we-layerd-ref/third_party/wallpaper-engine-renderer`（GPL-2.0-only）或其产出的
  `libwallpaper-engine-renderer.so` 当作可借来源 —— 它比 we-layerd 本身**许可更严**（§2.3 已列 ❌）。
- **工作量估计**：判定本身**已完成（本轮 0 人时增量）**；**后续代码动作 = 0**（除非将来出现具体借用需求，届时按上面三步走）。

#### 9.8.1 `we-layerd` 在本仓库的引用面（**全部是文字，零代码 / 零读取**）

| 类别 | 命中 | 说明 |
|---|---|---|
| **`import` / `require` / `readFile` / `readFileSync` / `createReadStream`** | **0**（`grep -rn -E "(import\|require\|readFile\|readFileSync\|createReadStream)[^\n]{0,80}(we-layerd-ref\|we-layerd)" we-scene-demo/` ⇒ 0 命中） | **从未被加载** |
| **代码/测试里的"参照来源许可声明"样板** | **18 个文件**（`demo.html`、`core/we-scene-bundle.js`、`core/attach-transform.mjs`、`core/puppet-skin.js`、`elysia/scene-scripts.js`，加 `tests/` 下 12 个 `*.mjs` 与 `tests/run-all-tests.sh`） | 纯文字免责段，**无代码**。`demo.html` 与 `core/**` 是**其它并行线正在编辑**的文件 ⇒ **本轮只统计、不改** |
| **文档 / 声明表** | **8 个文件**（本文件 §2.3/§9、`THIRD-PARTY.md` §8/§10、`README.md` §7.4(8)、`docs/EFFECTS-COMPUTE-SPEC.md`、`docs/ELYSIA-DIFF-AUDIT.md`、`docs/PATCHES.md`、`docs/README-DIAGNOSTICS.md`、`docs/RENDERER-ARCHITECTURE.md`） | 许可与边界说明 |
| **合计** | **26 个文件 / 37 行**（排除 `.git/`） | |
| **发布产物** | **0**：`package.json` 的 `files` 白名单不含任何 `*-ref/`；`publish-check.mjs` 的 `REQUIRED` 与 vendored 检查也不含 | 无许可代码**不进产物** |
| **结论** | 对仓库产物**零影响**；唯一动作 = 保持现有中性标注（第三方参考实现 + 无许可 + 仅行为对照 + 未取代码） | |

### 9.9 存量对象判定（二）：GPL-2.0-only 项目（`wer-ref/` 等）—— **处置已合规，交叉引用 P-95**

- **规则**：GPL-2.0-only 与 GPL-3.0-or-later **双向不兼容**（论证见 同目录 `LICENSE-COMPAT-REVIEW.md` §3.1 与
  同目录 `WER-REF-LICENSE-AUDIT.md` §1.3）⇒ **不得进入本仓库任何产物**，连"改写 / 逐行翻译 / 抄注释与常量顺序"都不行（§2.2 判定口径）。
- **已执行的处置（本阶梯的 L1 实物）**：`wer-ref/`（`Aromatic05/wallpaper-engine-renderer`，HEAD `89dfcd86…`，
  `LICENSE` = GPL v2 全文）被本仓库自己的审计判出 **2 处点状同源**（`normalizeImageAlpha`、`alignmentOffsetForToken`，
  约 2 函数 / ~11 行）⇒ 按 §5 / **L1** 按规格独立实现：规格 `docs/IMAGE-ALPHA-ALIGN-SPEC.md` →
  按规格新写 `coerceImageAlphaMode` / `classifyAlphaDomain` / `saturateUnitInterval` / `alignmentOffsetForToken` /
  `readAlignmentAxisSigns` / `ALIGNMENT_HALF_SHIFTS` → 符合性测试 `tests/clean-room-alpha-align-test.mjs`
  （**1008 pass / 0 fail**，含与改前 `Object.is` 逐位对拍）→ 旧实现删除 → 留痕 `docs/PATCHES.md` **P-95** +
  `THIRD-PARTY.md` §8 + 同目录 `WER-REF-LICENSE-AUDIT.md` §3.4「✅ 事后追加」。
- **本轮核实（2026-09-17）**：① `import/require/readFile` 指向 `wer-ref` = **0 命中**；② `wer-ref/` 在仓库**之外**，不进任何产物；
  ③ 两处弱形态（公式级注释、命名级注释）已随 P-95 清理。
- **仍未结案（不属本阶梯）**：**法律定性**（审计 §7 **U-1 / U-5**：重写前那 2 处**是否曾**构成衍生作品）**需律师意见**；
  代码层处置与留痕**不替代**法律意见。
- **同族清单**（一律按本节口径）：`wer-ref/`（GPL-2.0-only）、`catsout/wallpaper-scene-renderer`（GPL-2.0-only，无本机副本）、
  `waywallen/open-wallpaper-engine`（GPL-2.0-only）。

### 9.10 RePKG 许可定案（**MIT**，2026-09-17）

- **结论**：`notscuffed/repkg` = **MIT**（`Copyright (c) 2019 notscuffed`）。
- **依据**：① 上游 `LICENSE` 原文（<https://raw.githubusercontent.com/notscuffed/repkg/master/LICENSE>，
  **2026-09-17 复核 = MIT 全文**）；② **项目所有者确认**（2026-09-17：「notscuffed/repkg 就是 MIT」）。
- **判定**：MIT 属**许可兼容**方向 ⇒ 一切"格式 / 取值约定"引用都落在 §2.1 的允许方向；
  若将来要 vendored 它的**任何代码**，按 §4 台账登记 + 保留 MIT 声明 + `THIRD-PARTY.md` 附全文。**当前无 vendored 副本**。
- **历史误记已作废**：早期把它记成 GPL 的一侧（本文件 §6、插件 README、`docs/PLUGIN-POLLUTION-AUDIT.md` 等）**一律更正为 MIT**；
  逐处清单见 同目录 `LICENSE-COMPAT-REVIEW.md` §10。

### 9.11 不偷偷删除（硬承诺）

1. **绝不"被发现了才偷偷删"**：任何删除（我们主动收口，或权利人要求）都**必须**在 `docs/PATCHES.md` / `CHANGELOG`
   留下**公开记录**：删了哪些文件（路径 + 行数 + 摘要）、为什么删、谁要求的（权利人联系 → 记录日期与要求内容，
   **但不公开其隐私信息**）。
2. **权利人联系时的处置**：收到权利人（或平台转达）的下架 / 澄清要求 ⇒ **先删后议**（默认 72 小时内移除，不等法律定性）；
   即使我们认为要求有误，**删除仍然执行**，之后再另行沟通恢复条件。
3. **主动巡检**：每轮发布前对"无许可 / 不兼容"对象的**上游许可状态**至少复核一次（上游可能**补上** LICENSE，也可能**收紧**）
   ⇒ 结论写进 `THIRD-PARTY.md` §8 与本文件 §9；上游补上 permissive 许可 = 有机会把该对象从"仅行为对照"升级为 §4 正式条目。
4. **同标准处理**（用户原话"后续再碰到类似问题，就按上面的处理方法同样处理"）：**新出现**的任何无许可 / 不兼容上游，
   **第一步就是 §9.3 的 L2**，再按阶梯逐级向下，**不得**跳级、**不得**先抄后议。
